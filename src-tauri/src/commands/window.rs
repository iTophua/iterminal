use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::RwLock;

static WINDOW_DATA: Lazy<Arc<RwLock<HashMap<String, String>>>> =
    Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

#[tauri::command]
pub async fn create_terminal_window(
    app: tauri::AppHandle,
    connection_id: String,
    connection_name: String,
    username: String,
    host: String,
    connection_data: String,
) -> Result<String, String> {
    let window_label = format!("terminal_{}", connection_id);
    let window_title = format!("{} - {}@{}", connection_name, username, host);

    // 先存储数据，再创建窗口
    WINDOW_DATA
        .write()
        .await
        .insert(window_label.clone(), connection_data);

    let builder = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::App(format!("index.html#/terminal-window?label={}", window_label).into()),
    )
    .title(&window_title)
    .inner_size(1200.0, 800.0)
    .min_inner_size(600.0, 400.0)
    .resizable(true);

    #[cfg(debug_assertions)]
    let builder = builder.devtools(true);

    builder.build().map_err(|e: tauri::Error| e.to_string())?;

    Ok(window_label)
}

#[tauri::command]
pub async fn get_terminal_window_data(window_label: String) -> Result<String, String> {
    let data = WINDOW_DATA.write().await.remove(&window_label);
    data.ok_or_else(|| "No data found for this window".to_string())
}

#[tauri::command]
pub async fn close_terminal_window(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&window_label) {
        window.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}
