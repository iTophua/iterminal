use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

#[tauri::command]
pub async fn create_terminal_window(
    app: tauri::AppHandle,
    connection_id: String,
    sessions_json: String,
    connection_name: String,
) -> Result<String, String> {
    let window_label = format!("terminal_{}", connection_id);
    
    let url = format!(
        "/terminal-window?connectionId={}&sessions={}&name={}",
        urlencoding::encode(&connection_id),
        urlencoding::encode(&sessions_json),
        urlencoding::encode(&connection_name)
    );

    let window_title = format!("iTerminal - {}", connection_name);

    WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::App(url.parse().unwrap())
    )
    .title(&window_title)
    .inner_size(1200.0, 800.0)
    .min_inner_size(600.0, 400.0)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    Ok(window_label)
}

#[tauri::command]
pub async fn close_terminal_window(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&window_label) {
        window.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}