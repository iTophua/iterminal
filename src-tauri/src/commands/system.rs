use font_kit::source::SystemSource;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FontInfo {
    pub family: String,
    pub is_monospace: bool,
}

#[tauri::command]
pub async fn get_system_fonts() -> Vec<FontInfo> {
    tokio::task::spawn_blocking(|| {
        let source = SystemSource::new();
        let mut fonts: Vec<FontInfo> = Vec::new();
        let mut seen_families: HashSet<String> = HashSet::new();

        if let Ok(handles) = source.all_fonts() {
            for handle in handles {
                if let Ok(font) = handle.load() {
                    let family_name = font.family_name();
                    if !seen_families.contains(&family_name) {
                        let is_monospace = font.is_monospace();
                        seen_families.insert(family_name.clone());
                        fonts.push(FontInfo {
                            family: family_name,
                            is_monospace,
                        });
                    }
                }
            }
        }

        fonts.sort_by(|a, b| {
            if a.is_monospace != b.is_monospace {
                b.is_monospace.cmp(&a.is_monospace)
            } else {
                a.family.to_lowercase().cmp(&b.family.to_lowercase())
            }
        });

        fonts
    })
    .await
    .unwrap_or_else(|e| {
        eprintln!("Failed to spawn font loading task: {}", e);
        Vec::new()
    })
}

#[tauri::command]
pub async fn get_monospace_fonts() -> Vec<String> {
    tokio::task::spawn_blocking(|| {
        let source = SystemSource::new();
        let mut fonts: HashSet<String> = HashSet::new();

        if let Ok(handles) = source.all_fonts() {
            for handle in handles {
                if let Ok(font) = handle.load() {
                    if font.is_monospace() {
                        let family_name = font.family_name();
                        fonts.insert(family_name);
                    }
                }
            }
        }

        let mut result: Vec<String> = fonts.into_iter().collect();
        result.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
        result
    })
    .await
    .unwrap_or_else(|e| {
        eprintln!("Failed to spawn font loading task: {}", e);
        Vec::new()
    })
}

#[tauri::command]
pub async fn save_window_state(app_handle: AppHandle) -> Result<(), String> {
    let windows = app_handle.webview_windows();
    let window = windows
        .get("main")
        .ok_or("Window not found")?;
    
    let position = window.outer_position().map_err(|e: tauri::Error| e.to_string())?;
    let size = window.outer_size().map_err(|e: tauri::Error| e.to_string())?;
    let maximized = window.is_maximized().map_err(|e: tauri::Error| e.to_string())?;
    
    let state = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        maximized,
    };
    
    let state_json = serde_json::to_string(&state).map_err(|e| e.to_string())?;
    
    crate::commands::db::save_setting("window_state".to_string(), state_json)?;
    
    Ok(())
}

#[tauri::command]
pub async fn restore_window_state(app_handle: AppHandle) -> Result<(), String> {
    let windows = app_handle.webview_windows();
    let window = windows
        .get("main")
        .ok_or("Window not found")?;
    
    let state_json = crate::commands::db::get_setting("window_state".to_string())?;
    
    if let Some(json) = state_json {
        let state: WindowState = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        
        if state.maximized {
            window.maximize().map_err(|e: tauri::Error| e.to_string())?;
        } else {
            window
                .set_size(tauri::Size::Physical(tauri::PhysicalSize {
                    width: state.width,
                    height: state.height,
                }))
                .map_err(|e: tauri::Error| e.to_string())?;
            
            window
                .set_position(tauri::Position::Physical(tauri::PhysicalPosition {
                    x: state.x,
                    y: state.y,
                }))
                .map_err(|e: tauri::Error| e.to_string())?;
        }
    }
    
    Ok(())
}
