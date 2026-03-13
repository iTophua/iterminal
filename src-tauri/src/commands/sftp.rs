use serde::{Deserialize, Serialize};
use ssh2::Sftp;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

lazy_static::lazy_static! {
    static ref TRANSFER_CANCELLED: Mutex<HashMap<String, bool>> = Mutex::new(HashMap::new());
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

fn is_cancelled(task_id: &str) -> bool {
    TRANSFER_CANCELLED.lock().unwrap().get(task_id).copied().unwrap_or(false)
}

fn set_cancelled(task_id: &str, cancelled: bool) {
    TRANSFER_CANCELLED.lock().unwrap().insert(task_id.to_string(), cancelled);
}

fn clear_cancelled(task_id: &str) {
    TRANSFER_CANCELLED.lock().unwrap().remove(task_id);
}

fn with_session<F, T>(connection_id: &str, operation: F) -> Result<T, String>
where
    F: FnOnce(&ssh2::Session) -> Result<T, String>,
{
    let session = {
        let sftp_sessions = crate::commands::ssh::SFTP_SESSIONS.lock().unwrap();
        sftp_sessions
            .get(connection_id)
            .ok_or_else(|| "SFTP session not found".to_string())?
            .clone()
    };

    session.set_blocking(true);
    let result = operation(&session);
    session.set_blocking(false);

    result
}

fn with_session_blocking<F, T>(connection_id: &str, operation: F) -> Result<T, String>
where
    F: FnOnce(&ssh2::Session) -> Result<T, String>,
{
    let session = {
        let sftp_sessions = crate::commands::ssh::SFTP_SESSIONS.lock().unwrap();
        sftp_sessions
            .get(connection_id)
            .ok_or_else(|| "SFTP session not found".to_string())?
            .clone()
    };

    session.set_blocking(true);
    let result = operation(&session);

    result
}

#[tauri::command]
pub fn list_directory(connection_id: String, path: String) -> Result<Vec<FileEntry>, String> {
    with_session(&connection_id, |session| {
        let sftp = session.sftp().map_err(|e| e.to_string())?;

        let entries = sftp.readdir(Path::new(&path)).map_err(|e| e.to_string())?;
        let mut result: Vec<FileEntry> = entries
            .into_iter()
            .map(|(path_buf, stat)| {
                let name = path_buf
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path_buf.to_string_lossy().to_string());
                let full_path = path_buf.to_string_lossy().to_string();
                let is_dir = stat.is_dir();
                let size = if is_dir { 0 } else { stat.size.unwrap_or(0) };
                let modified = stat
                    .mtime
                    .map(|t| {
                        chrono::DateTime::from_timestamp(t as i64, 0)
                            .map(|dt| dt.format("%Y-%m-%d %H:%M").to_string())
                            .unwrap_or_else(|| "-".to_string())
                    })
                    .unwrap_or_else(|| "-".to_string());
                let permissions = stat.perm.map(|p| format!("{:o}", p & 0o777));
                FileEntry {
                    name,
                    path: full_path,
                    is_directory: is_dir,
                    size,
                    modified,
                    permissions,
                }
            })
            .collect();

        result.sort_by(|a, b| {
            if a.is_directory && !b.is_directory {
                std::cmp::Ordering::Less
            } else if !a.is_directory && b.is_directory {
                std::cmp::Ordering::Greater
            } else {
                a.name.to_lowercase().cmp(&b.name.to_lowercase())
            }
        });

        Ok(result)
    })
}

#[tauri::command]
pub fn create_file(connection_id: String, path: String) -> Result<bool, String> {
    with_session(&connection_id, |session| {
        let sftp = session.sftp().map_err(|e| e.to_string())?;
        let mut file = sftp.create(Path::new(&path)).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn create_directory(connection_id: String, path: String) -> Result<bool, String> {
    with_session(&connection_id, |session| {
        let sftp = session.sftp().map_err(|e| e.to_string())?;
        sftp.mkdir(Path::new(&path), 0o755)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn rename_file(
    connection_id: String,
    old_path: String,
    new_path: String,
) -> Result<bool, String> {
    with_session(&connection_id, |session| {
        let sftp = session.sftp().map_err(|e| e.to_string())?;
        sftp.rename(Path::new(&old_path), Path::new(&new_path), None)
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
}

#[tauri::command]
pub fn chmod_file(connection_id: String, path: String, mode: String) -> Result<bool, String> {
    with_session(&connection_id, |session| {
        let mode_num =
            u32::from_str_radix(&mode, 8).map_err(|_| "Invalid permission mode".to_string())?;
        let sftp = session.sftp().map_err(|e| e.to_string())?;

        let stat = sftp
            .stat(Path::new(&path))
            .map_err(|e| format!("Failed to stat '{}': {}", path, e))?;

        let mut new_stat = stat.clone();
        new_stat.perm = Some(mode_num);

        sftp.setstat(Path::new(&path), new_stat)
            .map_err(|e| format!("Failed to chmod '{}': {}", path, e))?;

        Ok(true)
    })
}

#[tauri::command]
pub fn delete_file(connection_id: String, path: String) -> Result<bool, String> {
    with_session(&connection_id, |session| {
        let sftp = session.sftp().map_err(|e| e.to_string())?;
        sftp.unlink(Path::new(&path)).map_err(|e| e.to_string())?;
        Ok(true)
    })
}

fn remove_dir_recursive(sftp: &Sftp, path: &Path) -> Result<(), String> {
    let entries = sftp.readdir(path).map_err(|e| e.to_string())?;
    for (entry_path, stat) in entries {
        let name = entry_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        // 跳过 . 和 .. 目录
        if name == "." || name == ".." {
            continue;
        }
        if stat.is_dir() {
            remove_dir_recursive(sftp, &entry_path)?;
        } else {
            sftp.unlink(&entry_path).map_err(|e| e.to_string())?;
        }
    }
    sftp.rmdir(path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_directory(connection_id: String, path: String) -> Result<bool, String> {
    with_session(&connection_id, |session| {
        let sftp = session.sftp().map_err(|e| e.to_string())?;
        remove_dir_recursive(&sftp, Path::new(&path))?;
        Ok(true)
    })
}

#[tauri::command]
pub async fn upload_file(
    app: AppHandle,
    task_id: String,
    connection_id: String,
    local_path: String,
    remote_path: String,
) -> Result<TransferResult, String> {
    clear_cancelled(&task_id);
    
    tokio::task::spawn_blocking(move || {
        with_session_blocking(&connection_id, |session| {
            let sftp = session.sftp().map_err(|e| e.to_string())?;

            let mut local_file = std::fs::File::open(&local_path)
                .map_err(|e| format!("Failed to open local file: {}", e))?;
            
            let file_size = std::fs::metadata(&local_path)
                .map(|m| m.len())
                .unwrap_or(0);

            let mut remote_file = sftp
                .create(Path::new(&remote_path))
                .map_err(|e| format!("Failed to create remote file: {}", e))?;

            let mut buffer = [0u8; 8192];
            let mut total = 0u64;
            let mut last_emit = Instant::now();

            loop {
                if is_cancelled(&task_id) {
                    let _ = sftp.unlink(Path::new(&remote_path));
                    clear_cancelled(&task_id);
                    return Ok(TransferResult {
                        success: false,
                        bytes_transferred: total,
                        error: Some("Cancelled".to_string()),
                        cancelled: true,
                    });
                }
                
                let n = local_file
                    .read(&mut buffer)
                    .map_err(|e| format!("Failed to read: {}", e))?;
                if n == 0 {
                    break;
                }
                remote_file
                    .write_all(&buffer[..n])
                    .map_err(|e| format!("Failed to write: {}", e))?;
                total += n as u64;

                if last_emit.elapsed().as_millis() >= 100 {
                    let _ = app.emit(&format!("transfer-progress-{}", task_id), serde_json::json!({
                        "transferred": total,
                        "total": file_size
                    }));
                    last_emit = Instant::now();
                }
            }

            let _ = app.emit(&format!("transfer-progress-{}", task_id), serde_json::json!({
                "transferred": total,
                "total": file_size
            }));

            remote_file
                .flush()
                .map_err(|e| format!("Failed to flush: {}", e))?;

            Ok(TransferResult {
                success: true,
                bytes_transferred: total,
                error: None,
                cancelled: false,
            })
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn download_file(
    app: AppHandle,
    task_id: String,
    connection_id: String,
    remote_path: String,
    local_path: String,
) -> Result<TransferResult, String> {
    clear_cancelled(&task_id);
    
    tokio::task::spawn_blocking(move || {
        with_session_blocking(&connection_id, |session| {
            let sftp = session.sftp().map_err(|e| e.to_string())?;

            let mut remote_file = sftp
                .open(Path::new(&remote_path))
                .map_err(|e| format!("Failed to open remote file: {}", e))?;
            
            let file_size = sftp
                .stat(Path::new(&remote_path))
                .map(|s| s.size.unwrap_or(0))
                .unwrap_or(0);

            let mut local_file = std::fs::File::create(&local_path)
                .map_err(|e| format!("Failed to create local file: {}", e))?;

            let mut buffer = [0u8; 8192];
            let mut total = 0u64;
            let mut last_emit = Instant::now();

            loop {
                if is_cancelled(&task_id) {
                    std::fs::remove_file(&local_path).ok();
                    clear_cancelled(&task_id);
                    return Ok(TransferResult {
                        success: false,
                        bytes_transferred: total,
                        error: Some("Cancelled".to_string()),
                        cancelled: true,
                    });
                }
                
                let n = remote_file
                    .read(&mut buffer)
                    .map_err(|e| format!("Failed to read: {}", e))?;
                if n == 0 {
                    break;
                }
                local_file
                    .write_all(&buffer[..n])
                    .map_err(|e| format!("Failed to write: {}", e))?;
                total += n as u64;

                if last_emit.elapsed().as_millis() >= 100 {
                    let _ = app.emit(&format!("transfer-progress-{}", task_id), serde_json::json!({
                        "transferred": total,
                        "total": file_size
                    }));
                    last_emit = Instant::now();
                }
            }

            let _ = app.emit(&format!("transfer-progress-{}", task_id), serde_json::json!({
                "transferred": total,
                "total": file_size
            }));

            local_file
                .flush()
                .map_err(|e| format!("Failed to flush: {}", e))?;

            Ok(TransferResult {
                success: true,
                bytes_transferred: total,
                error: None,
                cancelled: false,
            })
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn upload_folder(
    app: AppHandle,
    task_id: String,
    connection_id: String,
    local_path: String,
    remote_path: String,
) -> Result<TransferResult, String> {
    clear_cancelled(&task_id);
    
    fn get_dir_size(path: &Path) -> u64 {
        let mut total = 0u64;
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    total += get_dir_size(&path);
                } else if let Ok(metadata) = entry.metadata() {
                    total += metadata.len();
                }
            }
        }
        total
    }

    fn upload_dir_recursive(
        sftp: &ssh2::Sftp,
        local_dir: &Path,
        remote_dir: &str,
        total: &mut u64,
        total_size: u64,
        app: &AppHandle,
        task_id: &str,
        last_emit: &mut Instant,
    ) -> Result<bool, String> {
        sftp.mkdir(Path::new(remote_dir), 0o755).ok();

        let entries =
            std::fs::read_dir(local_dir).map_err(|e| format!("Failed to read directory: {}", e))?;

        for entry in entries {
            if is_cancelled(task_id) {
                return Ok(true);
            }
            
            let entry = entry.map_err(|e| e.to_string())?;
            let local_entry_path = entry.path();
            let file_name = local_entry_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let remote_entry_path = format!("{}/{}", remote_dir, file_name);

            if local_entry_path.is_dir() {
                let cancelled = upload_dir_recursive(sftp, &local_entry_path, &remote_entry_path, total, total_size, app, task_id, last_emit)?;
                if cancelled {
                    return Ok(true);
                }
            } else {
                let mut local_file = std::fs::File::open(&local_entry_path)
                    .map_err(|e| format!("Failed to open {}: {}", local_entry_path.display(), e))?;
                let mut remote_file = sftp
                    .create(Path::new(&remote_entry_path))
                    .map_err(|e| format!("Failed to create {}: {}", remote_entry_path, e))?;

                let mut buffer = [0u8; 8192];
                loop {
                    if is_cancelled(task_id) {
                        return Ok(true);
                    }
                    
                    let n = local_file.read(&mut buffer).map_err(|e| e.to_string())?;
                    if n == 0 {
                        break;
                    }
                    remote_file
                        .write_all(&buffer[..n])
                        .map_err(|e| e.to_string())?;
                    *total += n as u64;

                    if last_emit.elapsed().as_millis() >= 100 {
                        let _ = app.emit(&format!("transfer-progress-{}", task_id), serde_json::json!({
                            "transferred": *total,
                            "total": total_size
                        }));
                        *last_emit = Instant::now();
                    }
                }
                remote_file.flush().map_err(|e| e.to_string())?;
            }
        }
        Ok(false)
    }

    tokio::task::spawn_blocking(move || {
        with_session_blocking(&connection_id, |session| {
            let sftp = session.sftp().map_err(|e| e.to_string())?;
            let mut total = 0u64;
            let mut last_emit = Instant::now();
            
            let total_size = get_dir_size(Path::new(&local_path));
            
            let cancelled = upload_dir_recursive(&sftp, Path::new(&local_path), &remote_path, &mut total, total_size, &app, &task_id, &mut last_emit)?;
            
            if cancelled {
                clear_cancelled(&task_id);
                return Ok(TransferResult {
                    success: false,
                    bytes_transferred: total,
                    error: Some("Cancelled".to_string()),
                    cancelled: true,
                });
            }

            let _ = app.emit(&format!("transfer-progress-{}", task_id), serde_json::json!({
                "transferred": total,
                "total": total_size
            }));

            Ok(TransferResult {
                success: true,
                bytes_transferred: total,
                error: None,
                cancelled: false,
            })
        })
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn compress_file(
    connection_id: String,
    source_path: String,
    output_path: String,
) -> Result<bool, String> {
    fn is_safe_path_char(c: char) -> bool {
        c.is_alphanumeric() || c == '/' || c == '.' || c == '_' || c == '-' || c == '~'
    }

    if source_path.starts_with('-') || !source_path.chars().all(is_safe_path_char) {
        return Err(format!("Invalid source path: {}", source_path));
    }
    if output_path.starts_with('-') || !output_path.chars().all(is_safe_path_char) {
        return Err(format!("Invalid output path: {}", output_path));
    }

    with_session(&connection_id, |session| {
        let mut channel = session
            .channel_session()
            .map_err(|e| format!("Failed to open channel: {}", e))?;

        let cmd = format!("tar -czf -- '{}' '{}'", output_path, source_path);
        channel.exec(&cmd).map_err(|e| e.to_string())?;

        let mut output = String::new();
        channel.read_to_string(&mut output).ok();
        channel.close().ok();

        let exit_status = channel.exit_status().map_err(|e| e.to_string())?;
        if exit_status != 0 {
            return Err(format!("Compression failed with exit code {}", exit_status));
        }

        Ok(true)
    })
}

#[tauri::command]
pub fn open_folder(path: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
pub fn open_file_location(path: String) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file location: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(format!("/select,{}", path))
            .spawn()
            .map_err(|e| format!("Failed to open file location: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        let dir = std::path::Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        Command::new("xdg-open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("Failed to open file location: {}", e))?;
    }

    Ok(true)
}

#[tauri::command]
pub fn cancel_transfer(task_id: String) -> Result<bool, String> {
    set_cancelled(&task_id, true);
    Ok(true)
}
