use crate::db::crypto::{decrypt_password, encrypt_password};
use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub key_file: Option<String>,
    pub group_name: Option<String>,
    pub tags: Option<String>,
    pub last_connected_at: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: Option<String>,
    pub terminal_font: Option<String>,
    pub terminal_font_size: Option<u16>,
    pub terminal_scrollback: Option<u32>,
    pub terminal_cursor_style: Option<String>,
    pub terminal_cursor_blink: Option<bool>,
    pub terminal_copy_on_select: Option<bool>,
    pub terminal_theme: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportData {
    pub version: String,
    pub exported_at: String,
    pub connections: Vec<ConnectionRecord>,
    pub settings: Option<AppSettings>,
}

lazy_static::lazy_static! {
    static ref DB_PATH: Mutex<Option<String>> = Mutex::new(None);
}

fn get_db() -> SqlResult<Connection> {
    let guard = DB_PATH.lock().unwrap();
    let path = guard.as_ref().expect("Database not initialized");
    Connection::open(path)
}

#[tauri::command]
pub fn init_database(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    let db_path = app_dir.join("iterminal.db");
    let path_str = db_path.to_string_lossy().to_string();

    {
        let mut guard = DB_PATH.lock().map_err(|e| e.to_string())?;
        *guard = Some(path_str.clone());
    }

    let conn = Connection::open(&path_str).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            host TEXT NOT NULL,
            port INTEGER DEFAULT 22,
            username TEXT NOT NULL,
            password TEXT,
            key_file TEXT,
            group_name TEXT,
            tags TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    if let Err(e) = conn.execute("ALTER TABLE connections ADD COLUMN key_file TEXT", []) {
        if !e.to_string().contains("duplicate column") {
            eprintln!("Warning: Failed to add key_file column: {}", e);
        }
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    if let Err(e) = conn.execute(
        "ALTER TABLE connections ADD COLUMN last_connected_at TEXT",
        [],
    ) {
        if !e.to_string().contains("duplicate column") {
            eprintln!("Warning: Failed to add last_connected_at column: {}", e);
        }
    }

    Ok(true)
}

#[tauri::command]
pub fn get_connections() -> Result<Vec<ConnectionRecord>, String> {
    let conn = get_db().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, password, key_file, group_name, tags, last_connected_at, created_at, updated_at FROM connections ORDER BY name"
    ).map_err(|e| e.to_string())?;

    let connections = stmt
        .query_map([], |row| {
            let password_encrypted: Option<String> = row.get(5)?;
            let password = password_encrypted.and_then(|enc| decrypt_password(&enc));

            Ok(ConnectionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                password,
                key_file: row.get(6)?,
                group_name: row.get(7)?,
                tags: row.get(8)?,
                last_connected_at: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let result: Vec<ConnectionRecord> = connections.filter_map(|c| c.ok()).collect();
    Ok(result)
}

#[tauri::command]
pub fn save_connection(connection: ConnectionRecord) -> Result<bool, String> {
    let conn = get_db().map_err(|e| e.to_string())?;

    let encrypted_password = connection.password.as_ref().map(|p| encrypt_password(p));

    conn.execute(
        "INSERT OR REPLACE INTO connections (id, name, host, port, username, password, key_file, group_name, tags, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)",
        rusqlite::params![
            connection.id,
            connection.name,
            connection.host,
            connection.port,
            connection.username,
            encrypted_password,
            connection.key_file,
            connection.group_name,
            connection.tags,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn delete_connection(id: String) -> Result<bool, String> {
    let conn = get_db().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM connections WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn get_setting(key: String) -> Result<Option<String>, String> {
    let conn = get_db().map_err(|e| e.to_string())?;

    let result: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [&key], |row| {
            row.get(0)
        })
        .ok();

    Ok(result)
}

#[tauri::command]
pub fn save_setting(key: String, value: String) -> Result<bool, String> {
    let conn = get_db().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        [&key, &value],
    )
    .map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn export_connections() -> Result<String, String> {
    let connections = get_connections()?;

    let export_data = ExportData {
        version: "1.0".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        connections,
        settings: None,
    };

    serde_json::to_string_pretty(&export_data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_connections(json_data: String, merge: bool) -> Result<usize, String> {
    let import_data: ExportData = serde_json::from_str(&json_data).map_err(|e| e.to_string())?;

    if !merge {
        let conn = get_db().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM connections", [])
            .map_err(|e| e.to_string())?;
    }

    let mut imported_count = 0;
    for conn in import_data.connections {
        save_connection(conn)?;
        imported_count += 1;
    }

    Ok(imported_count)
}

#[tauri::command]
pub fn export_all_data() -> Result<String, String> {
    let connections = get_connections()?;

    let settings = AppSettings {
        theme: get_setting("theme".to_string())?,
        terminal_font: get_setting("terminal_font".to_string())?,
        terminal_font_size: get_setting("terminal_font_size".to_string())?
            .and_then(|s| s.parse().ok()),
        terminal_scrollback: get_setting("terminal_scrollback".to_string())?
            .and_then(|s| s.parse().ok()),
        terminal_cursor_style: get_setting("terminal_cursor_style".to_string())?,
        terminal_cursor_blink: get_setting("terminal_cursor_blink".to_string())?
            .and_then(|s| s.parse().ok()),
        terminal_copy_on_select: get_setting("terminal_copy_on_select".to_string())?
            .and_then(|s| s.parse().ok()),
        terminal_theme: get_setting("terminal_theme".to_string())?,
    };

    let export_data = ExportData {
        version: "1.0".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        connections,
        settings: Some(settings),
    };

    serde_json::to_string_pretty(&export_data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_all_data(json_data: String) -> Result<usize, String> {
    let import_data: ExportData = serde_json::from_str(&json_data).map_err(|e| e.to_string())?;

    let conn = get_db().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM connections", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM settings", [])
        .map_err(|e| e.to_string())?;

    let mut imported_count = 0;
    for c in import_data.connections {
        save_connection(c)?;
        imported_count += 1;
    }

    if let Some(settings) = import_data.settings {
        if let Some(v) = settings.theme {
            save_setting("theme".to_string(), v)?;
        }
        if let Some(v) = settings.terminal_font {
            save_setting("terminal_font".to_string(), v)?;
        }
        if let Some(v) = settings.terminal_font_size {
            save_setting("terminal_font_size".to_string(), v.to_string())?;
        }
        if let Some(v) = settings.terminal_scrollback {
            save_setting("terminal_scrollback".to_string(), v.to_string())?;
        }
        if let Some(v) = settings.terminal_cursor_style {
            save_setting("terminal_cursor_style".to_string(), v)?;
        }
        if let Some(v) = settings.terminal_cursor_blink {
            save_setting("terminal_cursor_blink".to_string(), v.to_string())?;
        }
        if let Some(v) = settings.terminal_copy_on_select {
            save_setting("terminal_copy_on_select".to_string(), v.to_string())?;
        }
        if let Some(v) = settings.terminal_theme {
            save_setting("terminal_theme".to_string(), v)?;
        }
    }

    Ok(imported_count)
}

#[tauri::command]
pub fn migrate_from_localstorage(connections_json: String) -> Result<usize, String> {
    let connections: Vec<ConnectionRecord> =
        serde_json::from_str(&connections_json).map_err(|e| e.to_string())?;

    let mut migrated_count = 0;
    for conn in connections {
        save_connection(conn)?;
        migrated_count += 1;
    }

    Ok(migrated_count)
}

#[tauri::command]
pub fn record_connection_history(id: String) -> Result<(), String> {
    let conn = get_db().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    conn.execute(
        "UPDATE connections SET last_connected_at = ? WHERE id = ?",
        [&now, &id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_recent_connections(limit: Option<usize>) -> Result<Vec<ConnectionRecord>, String> {
    let conn = get_db().map_err(|e| e.to_string())?;
    let limit = limit.unwrap_or(10);

    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, password, key_file, group_name, tags, last_connected_at, created_at, updated_at FROM connections WHERE last_connected_at IS NOT NULL ORDER BY last_connected_at DESC LIMIT ?"
    ).map_err(|e| e.to_string())?;

    let connections = stmt
        .query_map([limit as i32], |row| {
            let password_encrypted: Option<String> = row.get(5)?;
            let password = password_encrypted.and_then(|enc| decrypt_password(&enc));

            Ok(ConnectionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                port: row.get(3)?,
                username: row.get(4)?,
                password,
                key_file: row.get(6)?,
                group_name: row.get(7)?,
                tags: row.get(8)?,
                last_connected_at: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(connections)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex as StdMutex};

    fn init_test_db() -> Arc<StdMutex<Connection>> {
        let conn = Connection::open_in_memory().expect("Failed to create in-memory DB");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 22,
                username TEXT NOT NULL,
                password TEXT,
                key_file TEXT,
                group_name TEXT,
                tags TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )
        .expect("Failed to create connections table");

        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )
        .expect("Failed to create settings table");

        Arc::new(StdMutex::new(conn))
    }

    fn save_connection_test(
        db: &Arc<StdMutex<Connection>>,
        connection: &ConnectionRecord,
    ) -> Result<bool, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;

        let encrypted_password = connection.password.as_ref().map(|p| encrypt_password(p));

        conn.execute(
            "INSERT OR REPLACE INTO connections (id, name, host, port, username, password, key_file, group_name, tags, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)",
            rusqlite::params![
                connection.id,
                connection.name,
                connection.host,
                connection.port,
                connection.username,
                encrypted_password,
                connection.key_file,
                connection.group_name,
                connection.tags,
            ],
        ).map_err(|e| e.to_string())?;

        Ok(true)
    }

    fn get_connections_test(
        db: &Arc<StdMutex<Connection>>,
    ) -> Result<Vec<ConnectionRecord>, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;

        let mut stmt = conn.prepare(
            "SELECT id, name, host, port, username, password, key_file, group_name, tags, created_at, updated_at FROM connections ORDER BY name"
        ).map_err(|e| e.to_string())?;

        let connections = stmt
            .query_map([], |row| {
                let password_encrypted: Option<String> = row.get(5)?;
                let password = password_encrypted.and_then(|enc| decrypt_password(&enc));

                Ok(ConnectionRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get(3)?,
                    username: row.get(4)?,
                    password,
                    key_file: row.get(6)?,
                    group_name: row.get(7)?,
                    tags: row.get(8)?,
                    last_connected_at: None,
                    created_at: row.get(9)?,
                    updated_at: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let result: Vec<ConnectionRecord> = connections.filter_map(|c| c.ok()).collect();
        Ok(result)
    }

    fn delete_connection_test(db: &Arc<StdMutex<Connection>>, id: &str) -> Result<bool, String> {
        let conn = db.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM connections WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    #[test]
    fn test_save_and_get_connection() {
        let db = init_test_db();

        let conn = ConnectionRecord {
            id: "conn-1".to_string(),
            name: "Test Server".to_string(),
            host: "192.168.1.1".to_string(),
            port: 22,
            username: "root".to_string(),
            password: Some("secret123".to_string()),
            key_file: None,
            group_name: Some("Production".to_string()),
            tags: Some(r#"["tag1","tag2"]"#.to_string()),
            last_connected_at: None,
            created_at: None,
            updated_at: None,
        };

        save_connection_test(&db, &conn).unwrap();

        let connections = get_connections_test(&db).unwrap();
        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0].id, "conn-1");
        assert_eq!(connections[0].name, "Test Server");
        assert_eq!(connections[0].password, Some("secret123".to_string()));
    }

    #[test]
    fn test_password_encryption_in_db() {
        let db = init_test_db();

        let conn = ConnectionRecord {
            id: "conn-1".to_string(),
            name: "Test".to_string(),
            host: "localhost".to_string(),
            port: 22,
            username: "user".to_string(),
            password: Some("my_password".to_string()),
            key_file: None,
            group_name: None,
            tags: None,
            last_connected_at: None,
            created_at: None,
            updated_at: None,
        };

        save_connection_test(&db, &conn).unwrap();

        let connections = get_connections_test(&db).unwrap();
        assert_eq!(connections[0].password, Some("my_password".to_string()));
    }

    #[test]
    fn test_delete_connection() {
        let db = init_test_db();

        let conn = ConnectionRecord {
            id: "conn-1".to_string(),
            name: "Test".to_string(),
            host: "localhost".to_string(),
            port: 22,
            username: "user".to_string(),
            password: None,
            key_file: None,
            group_name: None,
            tags: None,
            last_connected_at: None,
            created_at: None,
            updated_at: None,
        };

        save_connection_test(&db, &conn).unwrap();
        assert_eq!(get_connections_test(&db).unwrap().len(), 1);

        delete_connection_test(&db, "conn-1").unwrap();
        assert_eq!(get_connections_test(&db).unwrap().len(), 0);
    }

    #[test]
    fn test_update_connection() {
        let db = init_test_db();

        let conn = ConnectionRecord {
            id: "conn-1".to_string(),
            name: "Original".to_string(),
            host: "localhost".to_string(),
            port: 22,
            username: "user".to_string(),
            password: None,
            key_file: None,
            group_name: None,
            tags: None,
            last_connected_at: None,
            created_at: None,
            updated_at: None,
        };

        save_connection_test(&db, &conn).unwrap();

        let updated = ConnectionRecord {
            id: "conn-1".to_string(),
            name: "Updated".to_string(),
            host: "192.168.1.1".to_string(),
            port: 2222,
            username: "admin".to_string(),
            password: Some("newpass".to_string()),
            key_file: None,
            group_name: Some("Production".to_string()),
            tags: None,
            last_connected_at: None,
            created_at: None,
            updated_at: None,
        };

        save_connection_test(&db, &updated).unwrap();

        let connections = get_connections_test(&db).unwrap();
        assert_eq!(connections.len(), 1);
        assert_eq!(connections[0].name, "Updated");
        assert_eq!(connections[0].host, "192.168.1.1");
        assert_eq!(connections[0].port, 2222);
        assert_eq!(connections[0].password, Some("newpass".to_string()));
    }

    #[test]
    fn test_settings_crud() {
        let db = init_test_db();
        let conn = db.lock().unwrap();

        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('theme', 'dark')",
            [],
        )
        .unwrap();

        let result: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .ok();

        assert_eq!(result, Some("dark".to_string()));

        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('theme', 'light')",
            [],
        )
        .unwrap();

        let updated: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'theme'",
                [],
                |row| row.get(0),
            )
            .ok();

        assert_eq!(updated, Some("light".to_string()));
    }

    #[test]
    fn test_multiple_connections() {
        let db = init_test_db();

        for i in 1..=5 {
            let conn = ConnectionRecord {
                id: format!("conn-{}", i),
                name: format!("Server {}", i),
                host: format!("192.168.1.{}", i),
                port: 22,
                username: "root".to_string(),
                password: Some(format!("pass{}", i)),
                key_file: None,
                group_name: None,
                tags: None,
                last_connected_at: None,
                created_at: None,
                updated_at: None,
            };
            save_connection_test(&db, &conn).unwrap();
        }

        let connections = get_connections_test(&db).unwrap();
        assert_eq!(connections.len(), 5);

        for conn in &connections {
            assert!(conn.password.is_some());
            let password = conn.password.as_ref().unwrap();
            assert!(password.starts_with("pass"));
        }
    }
}
