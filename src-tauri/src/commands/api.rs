use axum::{
    extract::Path,
    http::{Method, StatusCode},
    response::{IntoResponse, Json},
    routing::{delete, get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use tower_http::cors::CorsLayer;

use super::db::{self, ConnectionRecord};
use super::sftp::{self, FileEntry};
use super::ssh::{self, CommandResult, MonitorData, SSHConnection};

use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;

static API_RUNNING: AtomicBool = AtomicBool::new(false);
static API_CANCELLATION_TOKEN: Lazy<RwLock<Option<CancellationToken>>> =
    Lazy::new(|| RwLock::new(None));

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionState {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiOperation {
    pub timestamp: String,
    pub operation: String,
    pub connection_id: Option<String>,
    pub details: String,
    pub success: bool,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(msg: &str) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.to_string()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectRequest {
    pub id: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecRequest {
    pub command: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PathRequest {
    pub path: String,
}

pub struct ApiState {
    pub app_handle: AppHandle,
    /// API 鉴权 token（为空则不校验）
    pub token: Option<String>,
}

fn emit_operation(
    app: &AppHandle,
    operation: &str,
    connection_id: Option<&str>,
    details: &str,
    success: bool,
    error: Option<&str>,
    result: Option<&str>,
) {
    let log = ApiOperation {
        timestamp: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        operation: operation.to_string(),
        connection_id: connection_id.map(|s| s.to_string()),
        details: details.to_string(),
        success,
        error: error.map(|s| s.to_string()),
        result: result.map(|s| s.to_string()),
    };

    // 持久化到 DB（供独立日志页面查询历史）
    db::save_mcp_log(operation, connection_id, details, success, error, result);

    let _ = app.emit("api-operation", &log);

    if let Some(id) = connection_id {
        let _ = app.emit(
            "connection-state-changed",
            serde_json::json!({
                "connectionId": id,
                "operation": operation,
                "success": success
            }),
        );

        // 同步到前端终端：
        // - exec 除外——exec handler 单独 emit 含完整输出的活动通知
        // - 连接管理类（connect/disconnect/quick_connect/list_saved）不需要显示在终端
        //   （连接建立时 shell 可能还没创建，写了也看不到）
        match operation {
            "exec" | "connect" | "disconnect" | "quick_connect" | "list_saved" => {}
            _ => {
            let label = match operation {
                "list_dir" => format!("\r\n\x1b[36m[MCP] ls {}\x1b[0m\r\n", details),
                "mkdir" => format!("\r\n\x1b[36m[MCP] mkdir {}\x1b[0m\r\n", details),
                "rm" => format!("\r\n\x1b[36m[MCP] rm {}\x1b[0m\r\n", details),
                "rename" => format!("\r\n\x1b[36m[MCP] mv {}\x1b[0m\r\n", details),
                "read_file" => format!("\r\n\x1b[36m[MCP] cat {}\x1b[0m\r\n", details),
                "write_file" => format!("\r\n\x1b[36m[MCP] write {}\x1b[0m\r\n", details),
                "upload" => format!("\r\n\x1b[36m[MCP] upload {}\x1b[0m\r\n", details),
                "download" => format!("\r\n\x1b[36m[MCP] download {}\x1b[0m\r\n", details),
                _ => format!("\r\n\x1b[36m[MCP] {} {}\x1b[0m\r\n", operation, details),
            };
            emit_mcp_activity(app, id, &label);
            }
        }
    }
}

/// 发送增强的连接状态变更事件，附带连接信息（供前端自动打开终端）。
///
/// 与 emit_operation 的区别：这个附带 connection 对象，让前端无需再查 DB。
/// 仅在 connect/quick_connect 成功时调用。
async fn emit_connection_opened(
    app: &AppHandle,
    connection_id: &str,
    name: Option<&str>,
    host: &str,
    port: u16,
    username: &str,
) {
    let _ = app.emit(
        "connection-opened",
        serde_json::json!({
            "connectionId": connection_id,
            "connection": {
                "id": connection_id,
                "name": name.unwrap_or(host),
                "host": host,
                "port": port,
                "username": username
            }
        }),
    );
}

/// MCP 操作时把操作内容同步 emit 给前端终端，让用户能看到 AI 在做什么。
///
/// 前端 Terminal.tsx 订阅 `mcp-activity` 事件，按 connectionId 找到对应 xterm，
/// 把 `text` 写入终端显示。这样 MCP（iterminal-mcp-server）执行的命令和文件操作
/// 不会在前端"隐身"——用户能看到完整的操作记录。
fn emit_mcp_activity(app: &AppHandle, connection_id: &str, text: &str) {
    let _ = app.emit(
        "mcp-activity",
        serde_json::json!({
            "connectionId": connection_id,
            "text": text
        }),
    );
}

pub fn create_api_router(app_handle: AppHandle, token: Option<String>) -> Router {
    let state = Arc::new(ApiState { app_handle, token: token.clone() });

    Router::new()
        .route("/api/status", get(get_status))
        .route("/api/connections", get(list_connections))
        .route("/api/connections", post(create_connection))
        .route("/api/connections/{id}", delete(delete_connection))
        .route("/api/connections/{id}/test", post(test_connection_handler))
        .route("/api/connections/{id}/exec", post(execute_command_handler))
        .route("/api/connections/{id}/monitor", get(get_monitor_handler))
        .route("/api/connections/{id}/files", get(list_files_handler))
        .route(
            "/api/connections/{id}/mkdir",
            post(create_directory_handler),
        )
        .route("/api/connections/{id}/rm", post(delete_file_handler))
        .route("/api/connections/{id}/rename", post(rename_file_handler))
        .route("/api/connections/{id}/read_file", post(read_file_handler))
        .route("/api/connections/{id}/write_file", post(write_file_handler))
        .route("/api/connections/{id}/upload", post(upload_file_handler))
        .route(
            "/api/connections/{id}/download",
            post(download_file_handler),
        )
        .route("/api/saved-connections", get(list_saved_connections))
        .route("/api/saved-connections", post(save_and_connect_handler))
        .route(
            "/api/saved-connections/{id}/connect",
            post(quick_connect_handler),
        )
        .route(
            "/api/connections/{id}/network-stats",
            get(get_network_stats_handler),
        )
        .route(
            "/api/connections/{id}/processes",
            get(list_processes_handler),
        )
        .route(
            "/api/connections/{id}/kill-process",
            post(kill_process_handler),
        )
        .route("/api/connections/{id}/compress", post(compress_handler))
        .route("/api/connections/{id}/extract", post(extract_handler))
        .route(
            "/api/connections/{id}/search-files",
            get(search_files_handler),
        )
        .route(
            "/api/connections/{id}/upload-folder",
            post(upload_folder_handler),
        )
        .route(
            "/api/connections/{id}/create-file",
            post(create_file_handler),
        )
        .route(
            "/api/connections/{id}/delete-directory",
            post(delete_directory_handler),
        )
        .layer(axum::middleware::from_fn_with_state(
            token.clone(),
            auth_middleware,
        ))
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "http://localhost:1430".parse().unwrap(),
                    "http://127.0.0.1:1430".parse().unwrap(),
                    "http://localhost:27149".parse().unwrap(),
                    "http://127.0.0.1:27149".parse().unwrap(),
                ])
                .allow_methods([Method::GET, Method::POST, Method::DELETE])
                .allow_headers(tower_http::cors::Any),
        )
        .with_state(state)
}

/// Token 鉴权 middleware：校验 Authorization: Bearer {token}。
/// /api/status 白名单不校验（健康检查）。token 为 None 时跳过（兼容旧版）。
async fn auth_middleware(
    axum::extract::State(expected_token): axum::extract::State<Option<String>>,
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> axum::response::Response {
    // 无 token 配置 → 不校验
    let expected = match &expected_token {
        Some(t) if !t.is_empty() => t.clone(),
        _ => return next.run(req).await,
    };

    // 健康检查白名单
    if req.uri().path() == "/api/status" {
        return next.run(req).await;
    }

    // 校验 Authorization header
    let auth_header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok());

    match auth_header {
        Some(h) if h.starts_with("Bearer ") => {
            let provided = &h[7..];
            if provided == expected {
                next.run(req).await
            } else {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(ApiResponse::<serde_json::Value>::error("Invalid token")),
                )
                    .into_response()
            }
        }
        _ => (
            StatusCode::UNAUTHORIZED,
            Json(ApiResponse::<serde_json::Value>::error(
                "Missing or invalid Authorization header",
            )),
        )
            .into_response(),
    }
}

async fn get_status() -> Json<ApiResponse<serde_json::Value>> {
    Json(ApiResponse::success(serde_json::json!({
        "name": "iTerminal API",
        "version": "1.0.0",
        "status": "running"
    })))
}

async fn list_connections() -> Json<ApiResponse<Vec<ConnectionState>>> {
    let sessions = ssh::SESSIONS.read().await;
    let connections: Vec<ConnectionState> = sessions
        .iter()
        .map(|(id, session)| ConnectionState {
            id: id.clone(),
            host: session.connection.host.clone(),
            port: session.connection.port,
            username: session.connection.username.clone(),
            connected: true,
        })
        .collect();
    drop(sessions);
    Json(ApiResponse::success(connections))
}

async fn create_connection(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Json(payload): Json<ConnectRequest>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    let connection = SSHConnection {
        host: payload.host.clone(),
        port: payload.port.unwrap_or(22),
        username: payload.username.clone(),
        password: payload.password.clone(),
        key_file: None,
    };

    let details = format!(
        "{}@{}:{}",
        payload.username,
        payload.host,
        payload.port.unwrap_or(22)
    );

    match ssh::connect_ssh(payload.id.clone(), connection).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "connect",
                Some(&payload.id),
                &details,
                true,
                None,
        None,
            );
            // 通知前端自动打开终端（附带连接信息）
            emit_connection_opened(
                &state.app_handle,
                &payload.id,
                None,
                &payload.host,
                payload.port.unwrap_or(22),
                &payload.username,
            )
            .await;
            Ok(Json(ApiResponse::success(payload.id)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "connect",
                Some(&payload.id),
                &details,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn delete_connection(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    let sessions = ssh::SESSIONS.read().await;
    let info = sessions.get(&id).map(|s| {
        format!(
            "{}@{}:{}",
            s.connection.username, s.connection.host, s.connection.port
        )
    });
    drop(sessions);

    match ssh::disconnect_ssh(id.clone()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "disconnect",
                Some(&id),
                &info.unwrap_or_default(),
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "disconnect",
                Some(&id),
                &id,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn test_connection_handler(
    Json(payload): Json<ConnectRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    let connection = SSHConnection {
        host: payload.host,
        port: payload.port.unwrap_or(22),
        username: payload.username,
        password: payload.password,
        key_file: None,
    };

    match ssh::test_connection(connection).await {
        Ok(_) => Ok(Json(ApiResponse::success(true))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e)))),
    }
}

async fn execute_command_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<ExecRequest>,
) -> Result<Json<ApiResponse<CommandResult>>, (StatusCode, Json<ApiResponse<CommandResult>>)> {
    let full_command = payload.command.clone();

    match ssh::execute_command(id.clone(), payload.command).await {
        Ok(result) => {
            // exec 记录命令输出到日志（截断到 2000 字符，防止大输出撑爆 DB）
            let output_for_log = if result.output.is_empty() && result.error.is_none() {
                None
            } else {
                let combined = if let Some(stderr) = &result.error {
                    format!("{}{}", result.output, stderr)
                } else {
                    result.output.clone()
                };
                Some(if combined.len() > 2000 {
                    format!("{}…\n(截断，完整输出共 {} 字符)", &combined[..2000], combined.chars().count())
                } else {
                    combined
                })
            };
            emit_operation(
                &state.app_handle,
                "exec",
                Some(&id),
                &full_command,
                result.success,
                result.error.as_deref(),
                output_for_log.as_deref(),
            );
            // 同步到前端终端：显示命令 + 输出 + 退出码
            let mut activity = format!("\r\n\x1b[36m[MCP] $\x1b[0m {}\r\n", full_command);
            if !result.output.is_empty() {
                activity.push_str(&result.output);
                if !result.output.ends_with('\n') {
                    activity.push('\n');
                }
            }
            if let Some(stderr) = &result.error {
                if !stderr.is_empty() {
                    activity.push_str(stderr);
                    if !stderr.ends_with('\n') {
                        activity.push('\n');
                    }
                }
            }
            activity.push_str(&format!(
                "\x1b[{}m[MCP] exit code: {}\x1b[0m\r\n",
                if result.success { "36" } else { "31" },
                if result.success { 0 } else { 1 }
            ));
            emit_mcp_activity(&state.app_handle, &id, &activity);
            Ok(Json(ApiResponse::success(result)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "exec",
                Some(&id),
                &full_command,
                false,
                Some(&e),
        None,
            );
            let activity = format!(
                "\r\n\x1b[36m[MCP] $\x1b[0m {}\r\n\x1b[31m[MCP] error: {}\x1b[0m\r\n",
                full_command, e
            );
            emit_mcp_activity(&state.app_handle, &id, &activity);
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn get_monitor_handler(
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<MonitorData>>, (StatusCode, Json<ApiResponse<MonitorData>>)> {
    match ssh::get_system_monitor(id).await {
        Ok(data) => Ok(Json(ApiResponse::success(data))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e)))),
    }
}

async fn list_files_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<ApiResponse<Vec<FileEntry>>>, (StatusCode, Json<ApiResponse<Vec<FileEntry>>>)> {
    let path = params
        .get("path")
        .cloned()
        .unwrap_or_else(|| "/".to_string());

    match sftp::list_directory(id.clone(), path.clone()).await {
        Ok(entries) => {
            emit_operation(&state.app_handle, "list_dir", Some(&id), &path, true, None, None);
            Ok(Json(ApiResponse::success(entries)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "list_dir",
                Some(&id),
                &path,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn create_directory_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<PathRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match sftp::create_directory(id.clone(), payload.path.clone()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "mkdir",
                Some(&id),
                &payload.path,
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "mkdir",
                Some(&id),
                &payload.path,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn delete_file_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<PathRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match sftp::delete_file(id.clone(), payload.path.clone()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "rm",
                Some(&id),
                &payload.path,
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "rm",
                Some(&id),
                &payload.path,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn rename_file_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<serde_json::Value>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    let old_path = payload
        .get("old_path")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let new_path = payload
        .get("new_path")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match sftp::rename_file(id.clone(), old_path.to_string(), new_path.to_string()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "rename",
                Some(&id),
                &format!("{} -> {}", old_path, new_path),
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "rename",
                Some(&id),
                &format!("{} -> {}", old_path, new_path),
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ReadFileRequest {
    pub path: String,
    pub max_size: Option<u64>,
}

async fn read_file_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<ReadFileRequest>,
) -> Result<Json<ApiResponse<sftp::FileContent>>, (StatusCode, Json<ApiResponse<sftp::FileContent>>)>
{
    let max_size = payload.max_size.unwrap_or(1024 * 1024);

    match sftp::read_file_content(id.clone(), payload.path.clone(), Some(max_size)).await {
        Ok(content) => {
            emit_operation(
                &state.app_handle,
                "read_file",
                Some(&id),
                &payload.path,
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(content)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "read_file",
                Some(&id),
                &payload.path,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WriteFileRequest {
    pub path: String,
    pub content: String,
}

async fn write_file_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<WriteFileRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match sftp::write_file_content(id.clone(), payload.path.clone(), payload.content.clone()).await
    {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "write_file",
                Some(&id),
                &payload.path,
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "write_file",
                Some(&id),
                &payload.path,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadRequest {
    pub local_path: String,
    pub remote_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferResult {
    pub success: bool,
    pub bytes_transferred: u64,
    pub error: Option<String>,
}

async fn upload_file_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<UploadRequest>,
) -> Result<Json<ApiResponse<TransferResult>>, (StatusCode, Json<ApiResponse<TransferResult>>)> {
    let task_id = format!("mcp-upload-{}", chrono::Utc::now().timestamp_millis());

    let result = sftp::upload_file_sync(
        id.clone(),
        task_id.clone(),
        payload.local_path.clone(),
        payload.remote_path.clone(),
    )
    .await;

    let details = format!("{} -> {}", payload.local_path, payload.remote_path);

    match result {
        Ok(bytes) => {
            emit_operation(&state.app_handle, "upload", Some(&id), &details, true, None, None);
            Ok(Json(ApiResponse::success(TransferResult {
                success: true,
                bytes_transferred: bytes,
                error: None,
            })))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "upload",
                Some(&id),
                &details,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadRequest {
    pub remote_path: String,
    pub local_path: String,
}

async fn download_file_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<DownloadRequest>,
) -> Result<Json<ApiResponse<TransferResult>>, (StatusCode, Json<ApiResponse<TransferResult>>)> {
    let task_id = format!("mcp-download-{}", chrono::Utc::now().timestamp_millis());

    let result = sftp::download_file_sync(
        id.clone(),
        task_id.clone(),
        payload.remote_path.clone(),
        payload.local_path.clone(),
    )
    .await;

    let details = format!("{} -> {}", payload.remote_path, payload.local_path);

    match result {
        Ok(bytes) => {
            emit_operation(
                &state.app_handle,
                "download",
                Some(&id),
                &details,
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(TransferResult {
                success: true,
                bytes_transferred: bytes,
                error: None,
            })))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "download",
                Some(&id),
                &details,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn list_saved_connections(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
) -> Json<ApiResponse<Vec<ConnectionRecord>>> {
    match db::get_connections() {
        Ok(connections) => {
            emit_operation(
                &state.app_handle,
                "list_saved",
                None,
                &format!("{} 条已保存连接", connections.len()),
                true,
                None,
        None,
            );
            Json(ApiResponse::success(connections))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "list_saved",
                None,
                "读取已保存连接",
                false,
                Some(&e),
        None,
            );
            Json(ApiResponse::error(&e))
        }
    }
}

/// 保存新连接并可选自动连接。
/// POST /api/saved-connections
#[derive(Debug, Serialize, Deserialize)]
pub struct SaveConnectionRequest {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    pub key_file: Option<String>,
    /// 是否保存后自动连接
    #[serde(default)]
    pub auto_connect: bool,
}

async fn save_and_connect_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Json(payload): Json<SaveConnectionRequest>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    let port = payload.port.unwrap_or(22);
    let id = format!("conn-{}", chrono::Utc::now().timestamp_millis());

    // 保存到 DB
    let record = ConnectionRecord {
        id: id.clone(),
        name: payload.name.clone(),
        host: payload.host.clone(),
        port,
        username: payload.username.clone(),
        password: payload.password.clone(),
        key_file: payload.key_file.clone(),
        group_name: None,
        tags: None,
        last_connected_at: None,
        created_at: None,
        updated_at: None,
        sort_order: None,
    };
    db::save_connection(record).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e)))
    })?;

    let details = format!("{}@{}:{}", payload.username, payload.host, port);
    emit_operation(
        &state.app_handle,
        "save_connection",
        None,
        &format!("保存连接 {} ({})", payload.name, details),
        true,
        None,
None,
    );

    // 自动连接
    if payload.auto_connect {
        let connection = SSHConnection {
            host: payload.host.clone(),
            port,
            username: payload.username.clone(),
            password: payload.password.clone(),
            key_file: payload.key_file.clone(),
        };
        match ssh::connect_ssh(id.clone(), connection).await {
            Ok(_) => {
                emit_operation(
                    &state.app_handle,
                    "connect",
                    Some(&id),
                    &details,
                    true,
                    None,
            None,
                );
                emit_connection_opened(
                    &state.app_handle,
                    &id,
                    Some(&payload.name),
                    &payload.host,
                    port,
                    &payload.username,
                )
                .await;
            }
            Err(e) => {
                emit_operation(
                    &state.app_handle,
                    "connect",
                    Some(&id),
                    &details,
                    false,
                    Some(&e),
            None,
                );
                return Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))));
            }
        }
    }

    Ok(Json(ApiResponse::success(id)))
}

async fn quick_connect_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    let connections = db::get_connections()
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))?;

    let record = connections.iter().find(|c| c.id == id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ApiResponse::error("连接未找到")),
        )
    })?;

    let password = record.password.clone().unwrap_or_default();
    let connection = SSHConnection {
        host: record.host.clone(),
        port: record.port,
        username: record.username.clone(),
        password: Some(password),
        key_file: record.key_file.clone(),
    };

    let details = format!("{}@{}:{}", record.username, record.host, record.port);
    // 克隆前端需要的信息（emit_connection_opened 用）
    let conn_name = record.name.clone();
    let conn_host = record.host.clone();
    let conn_port = record.port;
    let conn_username = record.username.clone();

    match ssh::connect_ssh(id.clone(), connection).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "quick_connect",
                Some(&id),
                &details,
                true,
                None,
        None,
            );
            // 通知前端自动打开终端
            emit_connection_opened(
                &state.app_handle,
                &id,
                Some(&conn_name),
                &conn_host,
                conn_port,
                &conn_username,
            )
            .await;
            Ok(Json(ApiResponse::success(id)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "quick_connect",
                Some(&id),
                &details,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn get_network_stats_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<ssh::NetworkStats>>, (StatusCode, Json<ApiResponse<ssh::NetworkStats>>)>
{
    match ssh::get_network_stats(id.clone()).await {
        Ok(stats) => {
            emit_operation(&state.app_handle, "network_stats", Some(&id), "网络统计", true, None, None);
            Ok(Json(ApiResponse::success(stats)))
        }
        Err(e) => {
            emit_operation(&state.app_handle, "network_stats", Some(&id), "网络统计", false, Some(&e), None);
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn list_processes_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<
    Json<ApiResponse<Vec<ssh::ProcessInfo>>>,
    (StatusCode, Json<ApiResponse<Vec<ssh::ProcessInfo>>>),
> {
    match ssh::list_processes(id.clone()).await {
        Ok(processes) => {
            emit_operation(&state.app_handle, "list_processes", Some(&id), &format!("{} 个进程", processes.len()), true, None, None);
            Ok(Json(ApiResponse::success(processes)))
        }
        Err(e) => {
            emit_operation(&state.app_handle, "list_processes", Some(&id), "进程列表", false, Some(&e), None);
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KillProcessRequest {
    pub pid: u32,
}

async fn kill_process_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<KillProcessRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match ssh::kill_process(id.clone(), payload.pid, None).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "kill_process",
                Some(&id),
                &format!("pid: {}", payload.pid),
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "kill_process",
                Some(&id),
                &format!("pid: {}", payload.pid),
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CompressRequest {
    pub source_path: String,
    pub target_path: String,
}

async fn compress_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<CompressRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match sftp::compress_file(
        id.clone(),
        payload.source_path.clone(),
        payload.target_path.clone(),
    )
    .await
    {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "compress",
                Some(&id),
                &format!("{} -> {}", payload.source_path, payload.target_path),
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "compress",
                Some(&id),
                &format!("{} -> {}", payload.source_path, payload.target_path),
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExtractRequest {
    pub file_path: String,
    pub target_dir: String,
}

async fn extract_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<ExtractRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match sftp::extract_file(
        id.clone(),
        payload.file_path.clone(),
        payload.target_dir.clone(),
    )
    .await
    {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "extract",
                Some(&id),
                &format!("{} -> {}", payload.file_path, payload.target_dir),
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "extract",
                Some(&id),
                &format!("{} -> {}", payload.file_path, payload.target_dir),
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn search_files_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<
    Json<ApiResponse<Vec<sftp::SearchResult>>>,
    (StatusCode, Json<ApiResponse<Vec<sftp::SearchResult>>>),
> {
    let path = params
        .get("path")
        .cloned()
        .unwrap_or_else(|| "/".to_string());
    let pattern = params
        .get("pattern")
        .cloned()
        .unwrap_or_else(|| "*".to_string());
    let max_results: u32 = params
        .get("max_results")
        .and_then(|s| s.parse().ok())
        .unwrap_or(100);

    match sftp::search_files(id.clone(), path.clone(), pattern.clone(), Some(max_results)).await {
        Ok(results) => {
            emit_operation(
                &state.app_handle,
                "search_files",
                Some(&id),
                &format!("path={}, pattern={}", path, pattern),
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(results)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "search_files",
                Some(&id),
                &format!("path={}, pattern={}", path, pattern),
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadFolderRequest {
    pub local_path: String,
    pub remote_path: String,
}

async fn upload_folder_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<UploadFolderRequest>,
) -> Result<Json<ApiResponse<TransferResult>>, (StatusCode, Json<ApiResponse<TransferResult>>)> {
    let task_id = format!(
        "mcp-upload-folder-{}",
        chrono::Utc::now().timestamp_millis()
    );
    let app_handle = state.app_handle.clone();

    match sftp::upload_folder(
        id,
        payload.local_path.clone(),
        payload.remote_path.clone(),
        task_id,
        app_handle,
    )
    .await
    {
        Ok(result) => {
            emit_operation(
                &state.app_handle,
                "upload_folder",
                None,
                &format!("{} -> {}", payload.local_path, payload.remote_path),
                result.success,
                result.error.as_deref(),
        None,
            );
            Ok(Json(ApiResponse::success(TransferResult {
                success: result.success,
                bytes_transferred: result.bytes_transferred,
                error: result.error,
            })))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "upload_folder",
                None,
                &format!("{} -> {}", payload.local_path, payload.remote_path),
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn create_file_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<PathRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match sftp::create_file(id.clone(), payload.path.clone(), None).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "create_file",
                Some(&id),
                &payload.path,
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "create_file",
                Some(&id),
                &payload.path,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn delete_directory_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
    Json(payload): Json<PathRequest>,
) -> Result<Json<ApiResponse<bool>>, (StatusCode, Json<ApiResponse<bool>>)> {
    match sftp::delete_directory(id.clone(), payload.path.clone()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "delete_directory",
                Some(&id),
                &payload.path,
                true,
                None,
        None,
            );
            Ok(Json(ApiResponse::success(true)))
        }
        Err(e) => {
            emit_operation(
                &state.app_handle,
                "delete_directory",
                Some(&id),
                &payload.path,
                false,
                Some(&e),
        None,
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

// ============ API Token 鉴权 ============

const MCP_TOKEN_SETTING_KEY: &str = "mcp_api_token";

/// token 文件路径：~/.iterminal/mcp_token
fn mcp_token_file_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".iterminal").join("mcp_token"))
}

/// 生成 32 字节随机 token（hex 编码 = 64 字符）
fn generate_random_token() -> String {
    use rand::Rng;
    let bytes: [u8; 32] = rand::thread_rng().gen();
    hex::encode(bytes)
}

/// 将 token 写入文件供 MCP 服务器读取（权限 0600）
fn write_token_file(token: &str) {
    if let Some(path) = mcp_token_file_path() {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if std::fs::write(&path, token).is_ok() {
            // Unix 下设置 0600 权限
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
            }
        }
    }
}

/// 确保 token 存在：DB 有则读，没有则生成并存 DB + 写文件。
/// 每次启动 API 服务（打开 MCP 开关）都会无条件用 DB 的 token 覆盖文件，
/// 保证 DB 与文件始终一致，避免 MCP 服务器读到过期 token 而鉴权失败。
fn ensure_mcp_token() -> Option<String> {
    // 尝试从 DB 读
    if let Ok(Some(stored)) = super::db::get_setting_inner(MCP_TOKEN_SETTING_KEY) {
        if !stored.is_empty() {
            // 无条件回写：确保文件内容与 DB 一致
            // （之前只在文件不存在时写，一旦两者脱节就永远修复不了，导致 401）
            write_token_file(&stored);
            return Some(stored);
        }
    }

    // 生成新 token
    let token = generate_random_token();
    let _ = super::db::save_setting_inner(MCP_TOKEN_SETTING_KEY, &token);
    write_token_file(&token);
    Some(token)
}

/// 获取当前 MCP token（明文，供设置页展示）
#[tauri::command]
pub async fn get_mcp_token() -> Result<Option<String>, String> {
    Ok(super::db::get_setting_inner(MCP_TOKEN_SETTING_KEY)?)
}

/// 重置 token：生成新的，存 DB + 写文件。
/// 注意：需要重启 API 服务才能生效（新连接用新 token）。
#[tauri::command]
pub async fn reset_mcp_token() -> Result<String, String> {
    let token = generate_random_token();
    super::db::save_setting_inner(MCP_TOKEN_SETTING_KEY, &token)?;
    write_token_file(&token);
    Ok(token)
}

pub async fn start_api_server(app_handle: AppHandle) {
    let cancel_token = CancellationToken::new();

    {
        let mut token_guard = API_CANCELLATION_TOKEN.write().await;
        *token_guard = Some(cancel_token.clone());
    }

    API_RUNNING.store(true, Ordering::SeqCst);

    // 生成或读取 API 鉴权 token
    let api_token = ensure_mcp_token();

    let app = create_api_router(app_handle, api_token);
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], 27149));

    println!("iTerminal API Server running on http://{}", addr);

    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind API server: {}", e);
            API_RUNNING.store(false, Ordering::SeqCst);
            return;
        }
    };

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            cancel_token.cancelled().await;
            println!("API Server shutting down...");
        })
        .await
        .ok();

    API_RUNNING.store(false, Ordering::SeqCst);
    println!("API Server stopped");
}

#[tauri::command]
pub async fn is_api_server_running() -> bool {
    API_RUNNING.load(Ordering::SeqCst)
}

#[tauri::command]
pub async fn stop_api_server() -> Result<bool, String> {
    if !API_RUNNING.load(Ordering::SeqCst) {
        return Ok(false);
    }

    let token_guard = API_CANCELLATION_TOKEN.read().await;
    if let Some(token) = token_guard.as_ref() {
        token.cancel();
    }

    for _ in 0..50 {
        if !API_RUNNING.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    Ok(true)
}

#[tauri::command]
pub async fn start_api_server_command(app_handle: AppHandle) -> Result<bool, String> {
    if API_RUNNING.load(Ordering::SeqCst) {
        return Ok(true);
    }

    {
        let token_guard = API_CANCELLATION_TOKEN.read().await;
        if let Some(token) = token_guard.as_ref() {
            if token.is_cancelled() {
                drop(token_guard);
                let mut token_guard = API_CANCELLATION_TOKEN.write().await;
                *token_guard = None;
            }
        }
    }

    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            start_api_server(app_handle).await;
        });
    });

    for _ in 0..50 {
        if API_RUNNING.load(Ordering::SeqCst) {
            return Ok(true);
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    }

    Err("Failed to start API server".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_response_success() {
        let response: ApiResponse<String> = ApiResponse::success("test data".to_string());
        assert!(response.success);
        assert_eq!(response.data, Some("test data".to_string()));
        assert!(response.error.is_none());
    }

    #[test]
    fn test_api_response_error() {
        let response: ApiResponse<String> = ApiResponse::error("something went wrong");
        assert!(!response.success);
        assert!(response.data.is_none());
        assert_eq!(response.error, Some("something went wrong".to_string()));
    }

    #[test]
    fn test_connection_state() {
        let state = ConnectionState {
            id: "conn-1".to_string(),
            host: "192.168.1.1".to_string(),
            port: 22,
            username: "root".to_string(),
            connected: true,
        };
        assert_eq!(state.id, "conn-1");
        assert_eq!(state.host, "192.168.1.1");
        assert!(state.connected);
    }

    #[test]
    fn test_api_operation() {
        let op = ApiOperation {
            timestamp: "2024-01-01 12:00:00".to_string(),
            operation: "connect".to_string(),
            connection_id: Some("conn-1".to_string()),
            details: "Connected to server".to_string(),
            success: true,
            error: None,
        };
        assert_eq!(op.operation, "connect");
        assert!(op.success);
    }

    #[test]
    fn test_connect_request() {
        let req = ConnectRequest {
            id: "conn-1".to_string(),
            host: "192.168.1.1".to_string(),
            port: Some(22),
            username: "root".to_string(),
            password: Some("secret".to_string()),
        };
        assert_eq!(req.id, "conn-1");
        assert_eq!(req.port, Some(22));
    }

    #[test]
    fn test_exec_request() {
        let req = ExecRequest {
            command: "ls -la".to_string(),
        };
        assert_eq!(req.command, "ls -la");
    }

    #[test]
    fn test_path_request() {
        let req = PathRequest {
            path: "/home/user".to_string(),
        };
        assert_eq!(req.path, "/home/user");
    }
}
