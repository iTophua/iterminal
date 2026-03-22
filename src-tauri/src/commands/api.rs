use axum::{
    extract::Path,
    http::{Method, StatusCode},
    response::Json,
    routing::{delete, get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tower_http::cors::CorsLayer;
use tokio_util::sync::CancellationToken;

use super::ssh::{self, SSHConnection, CommandResult, MonitorData};
use super::sftp::{self, FileEntry};
use super::db::{self, ConnectionRecord};

use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;

static API_RUNNING: AtomicBool = AtomicBool::new(false);
static API_CANCELLATION_TOKEN: Lazy<RwLock<Option<CancellationToken>>> = Lazy::new(|| RwLock::new(None));

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
}

fn emit_operation(
    app: &AppHandle,
    operation: &str,
    connection_id: Option<&str>,
    details: &str,
    success: bool,
    error: Option<&str>,
) {
    let log = ApiOperation {
        timestamp: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        operation: operation.to_string(),
        connection_id: connection_id.map(|s| s.to_string()),
        details: details.to_string(),
        success,
        error: error.map(|s| s.to_string()),
    };
    
    let _ = app.emit("api-operation", &log);
    
    if let Some(id) = connection_id {
        let _ = app.emit("connection-state-changed", serde_json::json!({
            "connectionId": id,
            "operation": operation,
            "success": success
        }));
    }
}

pub fn create_api_router(app_handle: AppHandle) -> Router {
    let state = Arc::new(ApiState { app_handle });

    Router::new()
        .route("/api/status", get(get_status))
        .route("/api/connections", get(list_connections))
        .route("/api/connections", post(create_connection))
        .route("/api/connections/{id}", delete(delete_connection))
        .route("/api/connections/{id}/test", post(test_connection_handler))
        .route("/api/connections/{id}/exec", post(execute_command_handler))
        .route("/api/connections/{id}/monitor", get(get_monitor_handler))
        .route("/api/connections/{id}/files", get(list_files_handler))
        .route("/api/connections/{id}/mkdir", post(create_directory_handler))
        .route("/api/connections/{id}/rm", post(delete_file_handler))
        .route("/api/connections/{id}/rename", post(rename_file_handler))
        .route("/api/connections/{id}/read_file", post(read_file_handler))
        .route("/api/connections/{id}/write_file", post(write_file_handler))
        .route("/api/connections/{id}/upload", post(upload_file_handler))
        .route("/api/connections/{id}/download", post(download_file_handler))
        .route("/api/saved-connections", get(list_saved_connections))
        .route("/api/saved-connections/{id}/connect", post(quick_connect_handler))
        .route("/api/connections/{id}/network-stats", get(get_network_stats_handler))
        .route("/api/connections/{id}/processes", get(list_processes_handler))
        .route("/api/connections/{id}/kill-process", post(kill_process_handler))
        .route("/api/connections/{id}/compress", post(compress_handler))
        .route("/api/connections/{id}/extract", post(extract_handler))
        .route("/api/connections/{id}/search-files", get(search_files_handler))
        .route("/api/connections/{id}/upload-folder", post(upload_folder_handler))
        .route("/api/connections/{id}/create-file", post(create_file_handler))
        .route("/api/connections/{id}/delete-directory", post(delete_directory_handler))
        .layer(
            CorsLayer::new()
                .allow_origin([
                    "http://localhost:1430".parse().unwrap(),
                    "http://127.0.0.1:1430".parse().unwrap(),
                    "http://localhost:27149".parse().unwrap(),
                    "http://127.0.0.1:27149".parse().unwrap(),
                ])
                .allow_methods([Method::GET, Method::POST, Method::DELETE])
                .allow_headers(tower_http::cors::Any)
        )
        .with_state(state)
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

    let details = format!("{}@{}:{}", payload.username, payload.host, payload.port.unwrap_or(22));
    
    match ssh::connect_ssh(payload.id.clone(), connection).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "connect",
                Some(&payload.id),
                &details,
                true,
                None,
            );
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
        format!("{}@{}:{}", s.connection.username, s.connection.host, s.connection.port)
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
            emit_operation(
                &state.app_handle,
                "exec",
                Some(&id),
                &full_command,
                result.success,
                result.error.as_deref(),
            );
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
            );
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
    let path = params.get("path").cloned().unwrap_or_else(|| "/".to_string());
    
    match sftp::list_directory(id.clone(), path.clone()).await {
        Ok(entries) => {
            emit_operation(
                &state.app_handle,
                "list_dir",
                Some(&id),
                &path,
                true,
                None,
            );
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
    let old_path = payload.get("old_path").and_then(|v| v.as_str()).unwrap_or("");
    let new_path = payload.get("new_path").and_then(|v| v.as_str()).unwrap_or("");
    
    match sftp::rename_file(id.clone(), old_path.to_string(), new_path.to_string()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "rename",
                Some(&id),
                &format!("{} -> {}", old_path, new_path),
                true,
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
    Path(id): Path<String>,
    Json(payload): Json<ReadFileRequest>,
) -> Result<Json<ApiResponse<sftp::FileContent>>, (StatusCode, Json<ApiResponse<sftp::FileContent>>)> {
    let max_size = payload.max_size.unwrap_or(1024 * 1024);
    
    match sftp::read_file_content(id.clone(), payload.path.clone(), Some(max_size)).await {
        Ok(content) => Ok(Json(ApiResponse::success(content))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e)))),
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
    match sftp::write_file_content(id.clone(), payload.path.clone(), payload.content.clone()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "write_file",
                Some(&id),
                &payload.path,
                true,
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
    ).await;
    
    let details = format!("{} -> {}", payload.local_path, payload.remote_path);
    
    match result {
        Ok(bytes) => {
            emit_operation(
                &state.app_handle,
                "upload",
                Some(&id),
                &details,
                true,
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
                "upload",
                Some(&id),
                &details,
                false,
                Some(&e),
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
    ).await;
    
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
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn list_saved_connections() -> Json<ApiResponse<Vec<ConnectionRecord>>> {
    match db::get_connections() {
        Ok(connections) => Json(ApiResponse::success(connections)),
        Err(e) => Json(ApiResponse::error(&e)),
    }
}

async fn quick_connect_handler(
    axum::extract::State(state): axum::extract::State<Arc<ApiState>>,
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<String>>, (StatusCode, Json<ApiResponse<String>>)> {
    let connections = db::get_connections()
        .map_err(|e| (StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))?;
    
    let record = connections
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(ApiResponse::error("连接未找到"))))?;
    
    let password = record.password.clone().unwrap_or_default();
    let connection = SSHConnection {
        host: record.host.clone(),
        port: record.port,
        username: record.username.clone(),
        password: Some(password),
        key_file: record.key_file.clone(),
    };
    
    let details = format!("{}@{}:{}", record.username, record.host, record.port);
    
    match ssh::connect_ssh(id.clone(), connection).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "quick_connect",
                Some(&id),
                &details,
                true,
                None,
            );
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
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn get_network_stats_handler(
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<ssh::NetworkStats>>, (StatusCode, Json<ApiResponse<ssh::NetworkStats>>)> {
    match ssh::get_network_stats(id).await {
        Ok(stats) => Ok(Json(ApiResponse::success(stats))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e)))),
    }
}

async fn list_processes_handler(
    Path(id): Path<String>,
) -> Result<Json<ApiResponse<Vec<ssh::ProcessInfo>>>, (StatusCode, Json<ApiResponse<Vec<ssh::ProcessInfo>>>)> {
    match ssh::list_processes(id).await {
        Ok(processes) => Ok(Json(ApiResponse::success(processes))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e)))),
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
    match sftp::compress_file(id.clone(), payload.source_path.clone(), payload.target_path.clone()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "compress",
                Some(&id),
                &format!("{} -> {}", payload.source_path, payload.target_path),
                true,
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
    match sftp::extract_file(id.clone(), payload.file_path.clone(), payload.target_dir.clone()).await {
        Ok(_) => {
            emit_operation(
                &state.app_handle,
                "extract",
                Some(&id),
                &format!("{} -> {}", payload.file_path, payload.target_dir),
                true,
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
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

async fn search_files_handler(
    Path(id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Result<Json<ApiResponse<Vec<sftp::SearchResult>>>, (StatusCode, Json<ApiResponse<Vec<sftp::SearchResult>>>)> {
    let path = params.get("path").cloned().unwrap_or_else(|| "/".to_string());
    let pattern = params.get("pattern").cloned().unwrap_or_else(|| "*".to_string());
    let max_results: u32 = params.get("max_results").and_then(|s| s.parse().ok()).unwrap_or(100);

    match sftp::search_files(id, path, pattern, Some(max_results)).await {
        Ok(results) => Ok(Json(ApiResponse::success(results))),
        Err(e) => Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e)))),
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
    let task_id = format!("mcp-upload-folder-{}", chrono::Utc::now().timestamp_millis());
    let app_handle = state.app_handle.clone();
    
    match sftp::upload_folder(id, payload.local_path.clone(), payload.remote_path.clone(), task_id, app_handle).await {
        Ok(result) => {
            emit_operation(
                &state.app_handle,
                "upload_folder",
                None,
                &format!("{} -> {}", payload.local_path, payload.remote_path),
                result.success,
                result.error.as_deref(),
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
            );
            Err((StatusCode::BAD_REQUEST, Json(ApiResponse::error(&e))))
        }
    }
}

pub async fn start_api_server(app_handle: AppHandle) {
    let cancel_token = CancellationToken::new();
    
    {
        let mut token_guard = API_CANCELLATION_TOKEN.write().await;
        *token_guard = Some(cancel_token.clone());
    }
    
    API_RUNNING.store(true, Ordering::SeqCst);
    
    let app = create_api_router(app_handle);
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