use once_cell::sync::Lazy;
use russh_sftp::client::SftpSession;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

fn validate_path(path: &str) -> Result<String, String> {
    let path = path.trim();

    if path.is_empty() {
        return Err("路径不能为空".to_string());
    }

    if path.contains('\0') {
        return Err("路径包含非法字符".to_string());
    }

    let normalized = path.replace('\\', "/");

    let suspicious_patterns = ["../", "/..", "//..", "~/"];
    for pattern in suspicious_patterns {
        if normalized.contains(pattern) {
            return Err("路径包含非法序列".to_string());
        }
    }

    let dangerous_starts = ["/etc/passwd", "/etc/shadow", "/root/.ssh"];
    for dangerous in dangerous_starts {
        if normalized.starts_with(dangerous) || normalized.starts_with(&format!("/{}", dangerous)) {
            return Err("禁止访问系统敏感目录".to_string());
        }
    }

    Ok(normalized)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: String,
    pub permissions: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferResult {
    pub success: bool,
    pub bytes_transferred: u64,
    pub error: Option<String>,
    pub cancelled: bool,
}

pub struct SftpSessionState {
    pub session: Arc<SftpSession>,
}

static SFTP_SESSIONS: Lazy<RwLock<HashMap<String, SftpSessionState>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

static TRANSFER_CANCELLED: Lazy<RwLock<HashMap<String, bool>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

static TRANSFER_PAUSED: Lazy<RwLock<HashMap<String, bool>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

async fn create_sftp_connection(
    connection: &super::ssh::SSHConnection,
) -> Result<Arc<SftpSession>, String> {
    use super::ssh::SshClientHandler;
    use std::net::ToSocketAddrs;

    let addr = format!("{}:{}", connection.host, connection.port);
    let socket_addr = addr
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .ok_or("解析地址失败")?;

    let config = Arc::new(russh::client::Config::default());
    let addr_str = socket_addr.to_string();
    let handler = SshClientHandler::new(connection.host.clone(), connection.port);

    let mut handle = russh::client::connect(config, &addr_str, handler)
        .await
        .map_err(|e| format!("SFTP连接失败: {}", e))?;

    if let Some(password) = &connection.password {
        let auth = handle
            .authenticate_password(&connection.username, password)
            .await
            .map_err(|e| format!("SFTP认证失败: {}", e))?;
        if !auth.success() {
            return Err("SFTP认证失败".to_string());
        }
    } else if let Some(key_file) = &connection.key_file {
        let key_path = shellexpand::tilde(key_file).into_owned();
        let key_pair = russh::keys::load_secret_key(&key_path, None)
            .map_err(|e| format!("加载密钥文件失败: {}", e))?;
        let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
        let auth = handle
            .authenticate_publickey(&connection.username, key_with_hash)
            .await
            .map_err(|e| format!("SFTP密钥认证失败: {}", e))?;
        if !auth.success() {
            return Err("SFTP密钥认证失败".to_string());
        }
    } else {
        return Err("SFTP需要密码或密钥认证".to_string());
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open SFTP channel: {}", e))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Failed to request SFTP subsystem: {}", e))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Failed to create SFTP session: {}", e))?;

    Ok(Arc::new(sftp))
}

async fn get_sftp_session(connection_id: &str) -> Result<Arc<SftpSession>, String> {
    let sessions = SFTP_SESSIONS.read().await;
    if let Some(state) = sessions.get(connection_id) {
        return Ok(state.session.clone());
    }
    drop(sessions);

    let ssh_sessions = super::ssh::SESSIONS.read().await;
    let ssh_session = ssh_sessions
        .get(connection_id)
        .ok_or("SSH session not found")?;

    let sftp = create_sftp_connection(&ssh_session.connection).await?;

    SFTP_SESSIONS.write().await.insert(
        connection_id.to_string(),
        SftpSessionState {
            session: sftp.clone(),
        },
    );

    Ok(sftp)
}

#[tauri::command]
pub async fn list_directory(connection_id: String, path: String) -> Result<Vec<FileEntry>, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    let entries = sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut result = Vec::new();
    for entry in entries {
        let metadata = entry.metadata();
        let is_dir = metadata.is_dir();

        let size = if is_dir {
            0
        } else {
            metadata.size.unwrap_or(0)
        };

        let modified = metadata
            .mtime
            .map(|t| {
                let datetime = chrono::DateTime::from_timestamp(t as i64, 0)
                    .unwrap_or_else(|| chrono::Utc::now());
                datetime.format("%Y-%m-%d %H:%M:%S").to_string()
            })
            .unwrap_or_else(|| "unknown".to_string());

        let permissions = metadata.permissions.map(|p| format!("{:o}", p));

        let file_name = entry.file_name();
        let full_path = if path.ends_with('/') {
            format!("{}{}", path, file_name)
        } else {
            format!("{}/{}", path, file_name)
        };

        result.push(FileEntry {
            name: file_name,
            path: full_path,
            is_directory: is_dir,
            size,
            modified,
            permissions,
        });
    }

    Ok(result)
}

#[tauri::command]
pub async fn create_file(
    connection_id: String,
    path: String,
    content: Option<String>,
) -> Result<bool, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    use russh_sftp::protocol::OpenFlags;

    let mut file = sftp
        .open_with_flags(
            &path,
            OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
        )
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    if let Some(data) = content {
        file.write_all(data.as_bytes())
            .await
            .map_err(|e| format!("Failed to write content: {}", e))?;
        file.flush()
            .await
            .map_err(|e| format!("Failed to flush: {}", e))?;
    }

    file.shutdown()
        .await
        .map_err(|e| format!("Failed to close file: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn create_directory(connection_id: String, path: String) -> Result<bool, String> {
    let sftp = get_sftp_session(&connection_id).await?;

    sftp.create_dir(&path)
        .await
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn rename_file(
    connection_id: String,
    old_path: String,
    new_path: String,
) -> Result<bool, String> {
    let old_path = validate_path(&old_path)?;
    let new_path = validate_path(&new_path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    sftp.rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Failed to rename: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn delete_file(connection_id: String, path: String) -> Result<bool, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    sftp.remove_file(&path)
        .await
        .map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn delete_directory(connection_id: String, path: String) -> Result<bool, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    sftp.remove_dir(&path)
        .await
        .map_err(|e| format!("Failed to delete directory: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn chmod_file(connection_id: String, path: String, mode: i32) -> Result<bool, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    use russh_sftp::protocol::FileAttributes;

    let metadata = FileAttributes {
        permissions: Some(mode as u32),
        ..Default::default()
    };

    sftp.set_metadata(&path, metadata)
        .await
        .map_err(|e| format!("Failed to change permissions: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn file_exists(connection_id: String, path: String) -> Result<bool, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    match sftp.metadata(&path).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContent {
    pub content: String,
    pub size: u64,
    pub truncated: bool,
    pub encoding: String,
}

#[tauri::command]
pub async fn read_file_content(
    connection_id: String,
    path: String,
    max_size: Option<u64>,
) -> Result<FileContent, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    let metadata = sftp
        .metadata(&path)
        .await
        .map_err(|e| format!("获取文件信息失败: {}", e))?;
    let file_size = metadata.size.unwrap_or(0);

    let max = max_size.unwrap_or(1024 * 1024);
    let truncated = file_size > max;

    let read_size = if truncated {
        max as usize
    } else {
        file_size as usize
    };
    let mut buffer = vec![0u8; read_size];
    let mut file = sftp
        .open(&path)
        .await
        .map_err(|e| format!("打开文件失败: {}", e))?;
    let bytes_read = file
        .read(&mut buffer)
        .await
        .map_err(|e| format!("读取文件失败: {}", e))?;
    buffer.truncate(bytes_read);

    let (content, encoding) = if is_binary(&buffer) {
        (hex_encode(&buffer), "binary".to_string())
    } else {
        (
            String::from_utf8_lossy(&buffer).to_string(),
            "text".to_string(),
        )
    };

    Ok(FileContent {
        content,
        size: file_size,
        truncated,
        encoding,
    })
}

fn is_binary(data: &[u8]) -> bool {
    if data.is_empty() {
        return false;
    }
    let sample_len = std::cmp::min(data.len(), 8192);
    let sample = &data[..sample_len];
    let null_count = sample.iter().filter(|&&b| b == 0).count();
    null_count > sample_len / 10
}

fn hex_encode(data: &[u8]) -> String {
    data.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
pub async fn write_file_content(
    connection_id: String,
    path: String,
    content: String,
) -> Result<bool, String> {
    let path = validate_path(&path)?;
    let sftp = get_sftp_session(&connection_id).await?;

    let mut file = sftp
        .create(&path)
        .await
        .map_err(|e| format!("创建文件失败: {}", e))?;

    file.write_all(content.as_bytes())
        .await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(true)
}

#[tauri::command]
pub async fn upload_file(
    connection_id: String,
    local_path: String,
    remote_path: String,
    task_id: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let remote_path = validate_path(&remote_path)?;
    let sftp = get_sftp_session(&connection_id).await?;
    let task_id_clone = task_id.clone();

    tokio::spawn(async move {
        use russh_sftp::protocol::OpenFlags;
        use tauri::Emitter;

        let mut local_file = match tokio::fs::File::open(&local_path).await {
            Ok(f) => f,
            Err(e) => {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to open local file: {}", e) }),
                );
                return;
            }
        };

        let total_size = match local_file.metadata().await {
            Ok(m) => m.len(),
            Err(e) => {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to get metadata: {}", e) }),
                );
                return;
            }
        };

        let mut remote_file = match sftp
            .open_with_flags(
                &remote_path,
                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
            )
            .await
        {
            Ok(f) => f,
            Err(e) => {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to create remote file: {}", e) }),
                );
                return;
            }
        };

        let mut buffer = vec![0u8; 65536];
        let mut transferred: u64 = 0;
        let mut cancelled = false;
        let mut paused = false;
        let mut last_progress_update = std::time::Instant::now();

        loop {
            if TRANSFER_CANCELLED
                .read()
                .await
                .get(&task_id_clone)
                .copied()
                .unwrap_or(false)
            {
                cancelled = true;
                break;
            }

            if TRANSFER_PAUSED
                .read()
                .await
                .get(&task_id_clone)
                .copied()
                .unwrap_or(false)
            {
                if !paused {
                    paused = true;
                    let _ = app.emit(
                        &format!("transfer-paused-{}", task_id_clone),
                        serde_json::json!({ "paused": true }),
                    );
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                continue;
            }

            if paused {
                paused = false;
                let _ = app.emit(
                    &format!("transfer-resumed-{}", task_id_clone),
                    serde_json::json!({ "resumed": true }),
                );
            }

            let n = match local_file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    let _ = app.emit(
                        &format!("transfer-complete-{}", task_id_clone),
                        serde_json::json!({ "success": false, "error": format!("Failed to read: {}", e) }),
                    );
                    return;
                }
            };

            if let Err(e) = remote_file.write_all(&buffer[..n]).await {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to write: {}", e) }),
                );
                return;
            }

            transferred += n as u64;

            if last_progress_update.elapsed().as_millis() > 200 {
                let _ = app.emit(
                    &format!("transfer-progress-{}", task_id_clone),
                    serde_json::json!({
                        "transferred": transferred,
                        "total": total_size,
                        "percentage": if total_size > 0 { (transferred * 100 / total_size) as u8 } else { 0 },
                        "paused": paused
                    }),
                );
                last_progress_update = std::time::Instant::now();
            }
        }

        let _ = remote_file.flush().await;
        let _ = remote_file.shutdown().await;

        TRANSFER_CANCELLED.write().await.remove(&task_id_clone);
        TRANSFER_PAUSED.write().await.remove(&task_id_clone);

        let _ = app.emit(
            &format!("transfer-complete-{}", task_id_clone),
            serde_json::json!({
                "success": !cancelled,
                "bytes_transferred": transferred,
                "cancelled": cancelled
            }),
        );
    });

    Ok(task_id)
}

#[tauri::command]
pub async fn download_file(
    connection_id: String,
    remote_path: String,
    local_path: String,
    task_id: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let remote_path = validate_path(&remote_path)?;
    let sftp = get_sftp_session(&connection_id).await?;
    let task_id_clone = task_id.clone();

    tokio::spawn(async move {
        use russh_sftp::protocol::OpenFlags;
        use tauri::Emitter;

        let mut remote_file = match sftp.open_with_flags(&remote_path, OpenFlags::READ).await {
            Ok(f) => f,
            Err(e) => {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to open remote file: {}", e) }),
                );
                return;
            }
        };

        let total_size = match remote_file.metadata().await {
            Ok(m) => m.len(),
            Err(e) => {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to get metadata: {}", e) }),
                );
                return;
            }
        };

        let mut local_file = match tokio::fs::File::create(&local_path).await {
            Ok(f) => f,
            Err(e) => {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to create local file: {}", e) }),
                );
                return;
            }
        };

        let mut buffer = vec![0u8; 65536];
        let mut transferred: u64 = 0;
        let mut cancelled = false;
        let mut paused = false;
        let mut last_progress_update = std::time::Instant::now();

        loop {
            if TRANSFER_CANCELLED
                .read()
                .await
                .get(&task_id_clone)
                .copied()
                .unwrap_or(false)
            {
                cancelled = true;
                break;
            }

            if TRANSFER_PAUSED
                .read()
                .await
                .get(&task_id_clone)
                .copied()
                .unwrap_or(false)
            {
                if !paused {
                    paused = true;
                    let _ = app.emit(
                        &format!("transfer-paused-{}", task_id_clone),
                        serde_json::json!({ "paused": true }),
                    );
                }
                tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                continue;
            }

            if paused {
                paused = false;
                let _ = app.emit(
                    &format!("transfer-resumed-{}", task_id_clone),
                    serde_json::json!({ "resumed": true }),
                );
            }

            let n = match remote_file.read(&mut buffer).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    let _ = app.emit(
                        &format!("transfer-complete-{}", task_id_clone),
                        serde_json::json!({ "success": false, "error": format!("Failed to read: {}", e) }),
                    );
                    return;
                }
            };

            if let Err(e) = local_file.write_all(&buffer[..n]).await {
                let _ = app.emit(
                    &format!("transfer-complete-{}", task_id_clone),
                    serde_json::json!({ "success": false, "error": format!("Failed to write: {}", e) }),
                );
                return;
            }

            transferred += n as u64;

            if last_progress_update.elapsed().as_millis() > 200 {
                let _ = app.emit(
                    &format!("transfer-progress-{}", task_id_clone),
                    serde_json::json!({
                        "transferred": transferred,
                        "total": total_size,
                        "percentage": if total_size > 0 { (transferred * 100 / total_size) as u8 } else { 0 },
                        "paused": paused
                    }),
                );
                last_progress_update = std::time::Instant::now();
            }
        }

        let _ = local_file.flush().await;
        let _ = remote_file.shutdown().await;

        TRANSFER_CANCELLED.write().await.remove(&task_id_clone);
        TRANSFER_PAUSED.write().await.remove(&task_id_clone);

        let _ = app.emit(
            &format!("transfer-complete-{}", task_id_clone),
            serde_json::json!({
                "success": !cancelled,
                "bytes_transferred": transferred,
                "cancelled": cancelled
            }),
        );
    });

    Ok(task_id)
}

#[tauri::command]
pub async fn upload_folder(
    connection_id: String,
    local_path: String,
    remote_path: String,
    task_id: String,
    app: tauri::AppHandle,
) -> Result<TransferResult, String> {
    let sftp = get_sftp_session(&connection_id).await?;
    let task_id_clone = task_id.clone();
    let app_clone = app.clone();

    fn count_files_and_size(local: &std::path::Path) -> (u64, u64) {
        let mut count = 0u64;
        let mut size = 0u64;
        if let Ok(entries) = std::fs::read_dir(local) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_dir() {
                        let (sub_count, sub_size) = count_files_and_size(&entry.path());
                        count += sub_count;
                        size += sub_size;
                    } else {
                        count += 1;
                        if let Ok(metadata) = entry.metadata() {
                            size += metadata.len();
                        }
                    }
                }
            }
        }
        (count, size)
    }

    let local = std::path::Path::new(&local_path);
    let (total_files, total_size) = count_files_and_size(local);

    let _ = app.emit(
        &format!("transfer-progress-{}", task_id_clone),
        serde_json::json!({
            "transferred": 0,
            "total": total_size,
            "totalFiles": total_files,
            "completedFiles": 0,
            "percentage": 0
        }),
    );

    tokio::spawn(async move {
        use tauri::Emitter;

        let mut completed_files = 0u64;
        let mut transferred = 0u64;
        let mut cancelled = false;
        let mut last_progress_update = std::time::Instant::now();

        fn copy_dir_recursive<'a>(
            sftp: &'a Arc<SftpSession>,
            local: &'a std::path::Path,
            remote: &'a str,
            transferred: &'a mut u64,
            completed_files: &'a mut u64,
            total_files: u64,
            total_size: u64,
            task_id: &'a str,
            app: &'a tauri::AppHandle,
            last_progress_update: &'a mut std::time::Instant,
            cancelled: &'a mut bool,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>>
        {
            Box::pin(async move {
                if TRANSFER_CANCELLED
                    .read()
                    .await
                    .get(task_id)
                    .copied()
                    .unwrap_or(false)
                {
                    *cancelled = true;
                    return Ok(());
                }

                sftp.create_dir(remote).await.ok();

                let mut entries = tokio::fs::read_dir(local)
                    .await
                    .map_err(|e| format!("Failed to read directory: {}", e))?;

                while let Some(entry) = entries
                    .next_entry()
                    .await
                    .map_err(|e| format!("Failed to read entry: {}", e))?
                {
                    if *cancelled {
                        break;
                    }

                    let name = entry.file_name().to_string_lossy().to_string();
                    let local_sub = entry.path();
                    let remote_sub = format!("{}/{}", remote, name);

                    if entry
                        .file_type()
                        .await
                        .map_err(|e| format!("Failed to get file type: {}", e))?
                        .is_dir()
                    {
                        copy_dir_recursive(
                            sftp,
                            &local_sub,
                            &remote_sub,
                            transferred,
                            completed_files,
                            total_files,
                            total_size,
                            task_id,
                            app,
                            last_progress_update,
                            cancelled,
                        )
                        .await?;
                    } else {
                        use russh_sftp::protocol::OpenFlags;
                        let mut local_file = tokio::fs::File::open(&local_sub)
                            .await
                            .map_err(|e| format!("Failed to open local file: {}", e))?;

                        let file_size = local_file.metadata().await.map(|m| m.len()).unwrap_or(0);

                        let mut remote_file = sftp
                            .open_with_flags(
                                &remote_sub,
                                OpenFlags::CREATE | OpenFlags::TRUNCATE | OpenFlags::WRITE,
                            )
                            .await
                            .map_err(|e| format!("Failed to create remote file: {}", e))?;

                        tokio::io::copy(&mut local_file, &mut remote_file)
                            .await
                            .map_err(|e| format!("Failed to copy file: {}", e))?;

                        remote_file.shutdown().await.ok();

                        *transferred += file_size;
                        *completed_files += 1;

                        if last_progress_update.elapsed().as_millis() > 200 {
                            let _ = app.emit(
                                &format!("transfer-progress-{}", task_id),
                                serde_json::json!({
                                    "transferred": *transferred,
                                    "total": total_size,
                                    "totalFiles": total_files,
                                    "completedFiles": *completed_files,
                                    "percentage": if total_size > 0 { (*transferred * 100 / total_size) as u8 } else { 0 }
                                }),
                            );
                            *last_progress_update = std::time::Instant::now();
                        }
                    }
                }

                Ok(())
            })
        }

        let result = copy_dir_recursive(
            &sftp,
            std::path::Path::new(&local_path),
            &remote_path,
            &mut transferred,
            &mut completed_files,
            total_files,
            total_size,
            &task_id_clone,
            &app_clone,
            &mut last_progress_update,
            &mut cancelled,
        )
        .await;

        TRANSFER_CANCELLED.write().await.remove(&task_id_clone);

        let _ = app_clone.emit(
            &format!("transfer-complete-{}", task_id_clone),
            serde_json::json!({
                "success": result.is_ok() && !cancelled,
                "bytes_transferred": transferred,
                "cancelled": cancelled,
                "error": result.err().map(|e| e.to_string())
            }),
        );
    });

    Ok(TransferResult {
        success: true,
        bytes_transferred: 0,
        error: None,
        cancelled: false,
    })
}

#[tauri::command]
pub async fn compress_file(
    connection_id: String,
    source_path: String,
    output_path: String,
) -> Result<bool, String> {
    let sessions = super::ssh::SESSIONS.read().await;
    let session = sessions
        .get(&connection_id)
        .ok_or("SSH session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    drop(sessions);

    let command = format!("tar -czf \"{}\" \"{}\"", output_path, source_path);
    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut output = Vec::new();
    let mut exit_status: u32 = 0;
    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { data } => output.extend_from_slice(&data),
            russh::ChannelMsg::ExtendedData { data, ext } => {
                if ext == 1 {
                    output.extend_from_slice(&data);
                }
            }
            russh::ChannelMsg::ExitStatus {
                exit_status: status,
            } => {
                exit_status = status;
            }
            russh::ChannelMsg::Eof => break,
            _ => {}
        }
    }

    if exit_status != 0 {
        let error_msg = String::from_utf8_lossy(&output).to_string();
        return Err(format!(
            "压缩失败 (exit code {}): {}",
            exit_status, error_msg
        ));
    }

    Ok(true)
}

#[tauri::command]
pub async fn extract_file(
    connection_id: String,
    file_path: String,
    target_dir: String,
) -> Result<bool, String> {
    let sessions = super::ssh::SESSIONS.read().await;
    let session = sessions
        .get(&connection_id)
        .ok_or("SSH session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    drop(sessions);

    let command = if file_path.ends_with(".tar.gz") || file_path.ends_with(".tgz") {
        format!(
            "mkdir -p \"{}\" && tar -xzf \"{}\" -C \"{}\"",
            target_dir, file_path, target_dir
        )
    } else if file_path.ends_with(".tar.bz2") || file_path.ends_with(".tbz2") {
        format!(
            "mkdir -p \"{}\" && tar -xjf \"{}\" -C \"{}\"",
            target_dir, file_path, target_dir
        )
    } else if file_path.ends_with(".tar.xz") || file_path.ends_with(".txz") {
        format!(
            "mkdir -p \"{}\" && tar -xJf \"{}\" -C \"{}\"",
            target_dir, file_path, target_dir
        )
    } else if file_path.ends_with(".tar") {
        format!(
            "mkdir -p \"{}\" && tar -xf \"{}\" -C \"{}\"",
            target_dir, file_path, target_dir
        )
    } else if file_path.ends_with(".zip") {
        format!(
            "mkdir -p \"{}\" && unzip -o \"{}\" -d \"{}\"",
            target_dir, file_path, target_dir
        )
    } else if file_path.ends_with(".gz") {
        let output_file = file_path.trim_end_matches(".gz");
        format!(
            "mkdir -p \"{}\" && gunzip -c \"{}\" > \"{}/{}\"",
            target_dir,
            file_path,
            target_dir,
            output_file.rsplit('/').next().unwrap_or("file")
        )
    } else if file_path.ends_with(".bz2") {
        let output_file = file_path.trim_end_matches(".bz2");
        format!(
            "mkdir -p \"{}\" && bunzip2 -c \"{}\" > \"{}/{}\"",
            target_dir,
            file_path,
            target_dir,
            output_file.rsplit('/').next().unwrap_or("file")
        )
    } else if file_path.ends_with(".xz") {
        let output_file = file_path.trim_end_matches(".xz");
        format!(
            "mkdir -p \"{}\" && xz -dc \"{}\" > \"{}/{}\"",
            target_dir,
            file_path,
            target_dir,
            output_file.rsplit('/').next().unwrap_or("file")
        )
    } else {
        return Err("不支持的压缩格式".to_string());
    };

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut output = Vec::new();
    let mut exit_status: u32 = 0;
    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { data } => output.extend_from_slice(&data),
            russh::ChannelMsg::ExtendedData { data, ext } => {
                if ext == 1 {
                    output.extend_from_slice(&data);
                }
            }
            russh::ChannelMsg::ExitStatus {
                exit_status: status,
            } => {
                exit_status = status;
            }
            russh::ChannelMsg::Eof => break,
            _ => {}
        }
    }

    if exit_status != 0 {
        let error_msg = String::from_utf8_lossy(&output).to_string();
        return Err(format!(
            "解压失败 (exit code {}): {}",
            exit_status, error_msg
        ));
    }

    Ok(true)
}

#[tauri::command]
pub async fn open_folder(path: String) -> Result<bool, String> {
    let _ = std::process::Command::new("open").arg(&path).status();
    Ok(true)
}

#[tauri::command]
pub async fn open_file_location(path: String) -> Result<bool, String> {
    let parent = std::path::Path::new(&path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or(path);
    let _ = std::process::Command::new("open").arg(&parent).status();
    Ok(true)
}

async fn ensure_remote_directory(
    sftp: &russh_sftp::client::SftpSession,
    path: &str,
) -> Result<(), String> {
    if path.is_empty() || path == "/" {
        return Ok(());
    }

    let mut current = String::new();
    for part in path.split('/') {
        if part.is_empty() {
            continue;
        }
        current.push('/');
        current.push_str(part);

        match sftp.create_dir(&current).await {
            Ok(_) => {}
            Err(e) => {
                if !e.to_string().contains("exists") && !e.to_string().contains("Failure") {
                    return Err(format!("创建目录失败: {}", e));
                }
            }
        }
    }
    Ok(())
}

pub async fn upload_file_sync(
    connection_id: String,
    task_id: String,
    local_path: String,
    remote_path: String,
) -> Result<u64, String> {
    let sftp = get_sftp_session(&connection_id).await?;

    let mut local_file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| format!("无法打开本地文件: {}", e))?;

    let metadata = local_file
        .metadata()
        .await
        .map_err(|e| format!("无法获取文件信息: {}", e))?;
    let _total_size = metadata.len();

    let remote_parent = remote_path
        .rfind('/')
        .map(|i| &remote_path[..i])
        .unwrap_or("/");
    ensure_remote_directory(&sftp, remote_parent).await?;

    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("无法创建远程文件: {}", e))?;

    let mut buffer = vec![0u8; 65536];
    let mut transferred: u64 = 0;

    loop {
        if TRANSFER_CANCELLED.read().await.contains_key(&task_id) {
            return Err("传输已取消".to_string());
        }

        while TRANSFER_PAUSED.read().await.contains_key(&task_id) {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        let n = local_file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("读取失败: {}", e))?;

        if n == 0 {
            break;
        }

        remote_file
            .write_all(&buffer[..n])
            .await
            .map_err(|e| format!("写入失败: {}", e))?;

        transferred += n as u64;
    }

    Ok(transferred)
}

pub async fn download_file_sync(
    connection_id: String,
    task_id: String,
    remote_path: String,
    local_path: String,
) -> Result<u64, String> {
    let sftp = get_sftp_session(&connection_id).await?;

    let mut remote_file = sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("无法打开远程文件: {}", e))?;

    let local_parent = std::path::Path::new(&local_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("/"));

    tokio::fs::create_dir_all(&local_parent).await.ok();

    let mut local_file = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| format!("无法创建本地文件: {}", e))?;

    let mut buffer = vec![0u8; 65536];
    let mut transferred: u64 = 0;

    loop {
        if TRANSFER_CANCELLED.read().await.contains_key(&task_id) {
            return Err("传输已取消".to_string());
        }

        while TRANSFER_PAUSED.read().await.contains_key(&task_id) {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        let n = remote_file
            .read(&mut buffer)
            .await
            .map_err(|e| format!("读取失败: {}", e))?;

        if n == 0 {
            break;
        }

        local_file
            .write_all(&buffer[..n])
            .await
            .map_err(|e| format!("写入失败: {}", e))?;

        transferred += n as u64;
    }

    Ok(transferred)
}

#[tauri::command]
pub async fn cancel_transfer(task_id: String) -> Result<bool, String> {
    TRANSFER_CANCELLED.write().await.insert(task_id, true);
    Ok(true)
}

#[tauri::command]
pub async fn pause_transfer(task_id: String) -> Result<bool, String> {
    TRANSFER_PAUSED.write().await.insert(task_id, true);
    Ok(true)
}

#[tauri::command]
pub async fn resume_transfer(task_id: String) -> Result<bool, String> {
    TRANSFER_PAUSED.write().await.remove(&task_id);
    Ok(true)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SearchResult {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: String,
}

#[tauri::command]
pub async fn search_files(
    connection_id: String,
    path: String,
    pattern: String,
    max_results: Option<u32>,
) -> Result<Vec<SearchResult>, String> {
    let sessions = super::ssh::SESSIONS.read().await;
    let session = sessions
        .get(&connection_id)
        .ok_or("SSH session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| format!("Failed to open channel: {}", e))?;
    drop(sessions);

    let max = max_results.unwrap_or(100);
    let escaped_pattern = pattern.replace('"', "\\\"").replace('\'', "'\\''");
    let escaped_path = path.replace('"', "\\\"").replace('\'', "'\\''");

    // 尝试使用 find，如果不存在则使用 ls -R 作为替代
    let command = format!(
        r#"command -v find >/dev/null 2>&1 && find "{}" -iname "*{}*" 2>/dev/null | head -n {} || ls -R "{}" 2>/dev/null | grep -i "{}" | head -n {}"#,
        escaped_path, escaped_pattern, max, escaped_path, escaped_pattern, max
    );

    eprintln!("[search_files] Executing command: {}", command);

    channel
        .exec(true, command)
        .await
        .map_err(|e| format!("Failed to execute command: {}", e))?;

    let mut output = Vec::new();
    let mut stderr = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            russh::ChannelMsg::Data { data } => output.extend_from_slice(&data),
            russh::ChannelMsg::ExtendedData { data, ext } => {
                if ext == 1 {
                    stderr.extend_from_slice(&data);
                }
            }
            russh::ChannelMsg::Eof => break,
            _ => {}
        }
    }

    let output_str = String::from_utf8_lossy(&output);
    let stderr_str = String::from_utf8_lossy(&stderr);
    eprintln!("[search_files] stdout: {}", output_str);
    eprintln!("[search_files] stderr: {}", stderr_str);
    let mut results: Vec<SearchResult> = Vec::new();

    for line in output_str.lines() {
        let full_path = line.trim();
        if full_path.is_empty() {
            continue;
        }
        let name = full_path
            .rsplit('/')
            .next()
            .unwrap_or(full_path)
            .to_string();

        results.push(SearchResult {
            name,
            path: full_path.to_string(),
            is_directory: false,
            size: 0,
            modified: String::new(),
        });
    }

    Ok(results)
}

#[tauri::command]
pub async fn is_directory(connection_id: String, path: String) -> Result<bool, String> {
    let sftp = get_sftp_session(&connection_id).await?;

    let metadata = sftp
        .metadata(&path)
        .await
        .map_err(|e| format!("Failed to get metadata: {}", e))?;

    Ok(metadata.is_dir())
}

#[tauri::command]
pub async fn is_local_directory(path: String) -> Result<bool, String> {
    let metadata = tokio::fs::metadata(&path)
        .await
        .map_err(|e| format!("Failed to get local metadata: {}", e))?;

    Ok(metadata.is_dir())
}

pub async fn close_sftp_session(connection_id: &str) {
    SFTP_SESSIONS.write().await.remove(connection_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_binary_detects_binary() {
        let binary_data = vec![0u8, 1, 2, 3, 0, 5, 6, 0, 8, 9, 0, 11, 12];
        assert!(is_binary(&binary_data));
    }

    #[test]
    fn test_is_binary_detects_text() {
        let text_data = b"Hello, World! This is a text file with normal content.".to_vec();
        assert!(!is_binary(&text_data));
    }

    #[test]
    fn test_is_binary_empty_data() {
        let empty_data: Vec<u8> = vec![];
        assert!(!is_binary(&empty_data));
    }

    #[test]
    fn test_is_binary_small_null_ratio() {
        let mut data = vec![0u8; 100];
        for i in 0..95 {
            data[i] = b'a';
        }
        assert!(!is_binary(&data));
    }

    #[test]
    fn test_is_binary_high_null_ratio() {
        let mut data = vec![b'a'; 100];
        for i in 0..15 {
            data[i] = 0;
        }
        assert!(is_binary(&data));
    }

    #[test]
    fn test_hex_encode_basic() {
        let data = vec![0x48, 0x65, 0x6c, 0x6c, 0x6f];
        let result = hex_encode(&data);
        assert_eq!(result, "48 65 6c 6c 6f");
    }

    #[test]
    fn test_hex_encode_empty() {
        let data: Vec<u8> = vec![];
        let result = hex_encode(&data);
        assert_eq!(result, "");
    }

    #[test]
    fn test_hex_encode_all_zeros() {
        let data = vec![0u8, 0, 0];
        let result = hex_encode(&data);
        assert_eq!(result, "00 00 00");
    }

    #[test]
    fn test_file_content_struct() {
        let content = FileContent {
            content: "test content".to_string(),
            size: 100,
            truncated: false,
            encoding: "text".to_string(),
        };
        assert_eq!(content.content, "test content");
        assert_eq!(content.size, 100);
        assert!(!content.truncated);
        assert_eq!(content.encoding, "text");
    }

    #[test]
    fn test_file_content_truncated() {
        let content = FileContent {
            content: "partial".to_string(),
            size: 10_000_000,
            truncated: true,
            encoding: "text".to_string(),
        };
        assert!(content.truncated);
        assert_eq!(content.size, 10_000_000);
    }

    #[test]
    fn test_transfer_result() {
        let result = TransferResult {
            success: true,
            bytes_transferred: 1024,
            error: None,
            cancelled: false,
        };
        assert!(result.success);
        assert_eq!(result.bytes_transferred, 1024);
        assert!(!result.cancelled);
    }

    #[test]
    fn test_transfer_result_failed() {
        let result = TransferResult {
            success: false,
            bytes_transferred: 0,
            error: Some("Connection failed".to_string()),
            cancelled: false,
        };
        assert!(!result.success);
        assert_eq!(result.error, Some("Connection failed".to_string()));
    }

    #[test]
    fn test_transfer_result_cancelled() {
        let result = TransferResult {
            success: false,
            bytes_transferred: 512,
            error: None,
            cancelled: true,
        };
        assert!(result.cancelled);
    }

    #[test]
    fn test_search_result() {
        let result = SearchResult {
            name: "test.txt".to_string(),
            path: "/home/user/test.txt".to_string(),
            is_directory: false,
            size: 1024,
            modified: "2024-01-15".to_string(),
        };
        assert_eq!(result.name, "test.txt");
        assert_eq!(result.path, "/home/user/test.txt");
        assert!(!result.is_directory);
        assert_eq!(result.size, 1024);
    }

    #[test]
    fn test_search_result_directory() {
        let result = SearchResult {
            name: "documents".to_string(),
            path: "/home/user/documents".to_string(),
            is_directory: true,
            size: 0,
            modified: "2024-01-15".to_string(),
        };
        assert!(result.is_directory);
    }
}
