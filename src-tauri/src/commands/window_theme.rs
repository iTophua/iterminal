use tauri::Manager;

#[tauri::command]
pub async fn set_window_background_color(
    app: tauri::AppHandle,
    color: String,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        set_bg_color(&window, &color).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

fn set_bg_color(
    window: &tauri::WebviewWindow,
    color: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    let (r, g, b, a) = parse_hex_color(color)?;
    
    #[cfg(target_os = "macos")]
    {
        set_bg_color_macos(window, r, g, b, a)?;
    }
    
    #[cfg(target_os = "windows")]
    {
        let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, a)));
    }

    #[cfg(target_os = "linux")]
    {
        let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, a)));
    }
    
    Ok(())
}

#[cfg(target_os = "macos")]
fn set_bg_color_macos(
    window: &tauri::WebviewWindow,
    r: u8, g: u8, b: u8, a: u8,
) -> Result<(), Box<dyn std::error::Error>> {
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::Object;
    
    unsafe {
        let ns_window_ptr = window.ns_window()?;
        let ns_window: *mut Object = ns_window_ptr as *mut Object;
        
        if !ns_window.is_null() {
            let r_f64: f64 = r as f64 / 255.0;
            let g_f64: f64 = g as f64 / 255.0;
            let b_f64: f64 = b as f64 / 255.0;
            let a_f64: f64 = a as f64 / 255.0;
            
            let color_obj: *mut Object = msg_send![
                class!(NSColor),
                colorWithCalibratedRed: r_f64
                green: g_f64
                blue: b_f64
                alpha: a_f64
            ];
            
            let _: () = msg_send![ns_window, setBackgroundColor: color_obj];
            
            let is_opaque: bool = a >= 254;
            let _: () = msg_send![ns_window, setOpaque: is_opaque];
        }
    }
    
    Ok(())
}

fn parse_hex_color(hex: &str) -> Result<(u8, u8, u8, u8), String> {
    let hex = hex.trim_start_matches('#');
    
    match hex.len() {
        6 => {
            let r = u8::from_str_radix(&hex[0..2], 16).map_err(|_| "Invalid red".to_string())?;
            let g = u8::from_str_radix(&hex[2..4], 16).map_err(|_| "Invalid green".to_string())?;
            let b = u8::from_str_radix(&hex[4..6], 16).map_err(|_| "Invalid blue".to_string())?;
            Ok((r, g, b, 255))
        }
        8 => {
            let r = u8::from_str_radix(&hex[0..2], 16).map_err(|_| "Invalid red".to_string())?;
            let g = u8::from_str_radix(&hex[2..4], 16).map_err(|_| "Invalid green".to_string())?;
            let b = u8::from_str_radix(&hex[4..6], 16).map_err(|_| "Invalid blue".to_string())?;
            let a = u8::from_str_radix(&hex[6..8], 16).map_err(|_| "Invalid alpha".to_string())?;
            Ok((r, g, b, a))
        }
        _ => Err("Color must be #RRGGBB or #RRGGBBAA format".to_string()),
    }
}
