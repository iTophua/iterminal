use font_kit::source::SystemSource;
use serde::Serialize;
use std::collections::HashSet;

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
