use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransferResult {
    pub success: bool,
    pub bytes_transferred: u64,
    pub error: Option<String>,
}

#[tauri::command]
pub fn list_directory(_ssh_id: String, _path: String) -> Result<Vec<FileEntry>, String> {
    // Placeholder - requires active SSH session
    Ok(vec![])
}

#[tauri::command]
pub fn upload_file(_ssh_id: String, _local_path: String, _remote_path: String) -> Result<TransferResult, String> {
    // Placeholder
    Ok(TransferResult {
        success: true,
        bytes_transferred: 0,
        error: None,
    })
}

#[tauri::command]
pub fn download_file(_ssh_id: String, _remote_path: String, _local_path: String) -> Result<TransferResult, String> {
    // Placeholder
    Ok(TransferResult {
        success: true,
        bytes_transferred: 0,
        error: None,
    })
}