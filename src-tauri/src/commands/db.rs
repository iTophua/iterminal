use crate::db::crypto::{decrypt_password, encrypt_password, migrate_encrypted_password};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
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
    pub sort_order: Option<i32>,
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
    static ref DB_INITIALIZED: AtomicBool = AtomicBool::new(false);
}

fn get_db() -> Result<Connection, String> {
    if !DB_INITIALIZED.load(Ordering::SeqCst) {
        return Err("Database not initialized. Call init_database() first.".to_string());
    }
    let guard = DB_PATH.lock().map_err(|e| e.to_string())?;
    let path = guard.as_ref().ok_or("Database path not set")?;
    Connection::open(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn init_database(app_handle: tauri::AppHandle) -> Result<bool, String> {
    if DB_INITIALIZED.load(Ordering::SeqCst) {
        return Ok(true);
    }

    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;

    // 开发模式使用独立的数据库文件，避免污染生产数据
    #[cfg(debug_assertions)]
    let db_name = "iterminal-dev.db";

    #[cfg(not(debug_assertions))]
    let db_name = "iterminal.db";

    let db_path = app_dir.join(db_name);
    let path_str = db_path.to_string_lossy().to_string();

    {
        let mut guard = DB_PATH.lock().map_err(|e| e.to_string())?;
        *guard = Some(path_str.clone());
    }

    let conn = Connection::open(&path_str).map_err(|e| e.to_string())?;

    // 启用 WAL 模式提升并发性能
    conn.pragma_update(None, "journal_mode", &"WAL")
        .map_err(|e| format!("Failed to enable WAL mode: {}", e))?;

    // 设置 busy_timeout，并发访问时等待而非立即失败
    conn.pragma_update(None, "busy_timeout", &5000)
        .map_err(|e| format!("Failed to set busy_timeout: {}", e))?;

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

    if let Err(e) = conn.execute(
        "ALTER TABLE connections ADD COLUMN sort_order INTEGER DEFAULT 0",
        [],
    ) {
        if !e.to_string().contains("duplicate column") {
            eprintln!("Warning: Failed to add sort_order column: {}", e);
        }
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS command_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            count INTEGER DEFAULT 1,
            UNIQUE(connection_id, text)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_command_history_connection 
         ON command_history(connection_id, timestamp DESC)",
        [],
    )
    .map_err(|e| e.to_string())?;

    cleanup_expired_command_history(&conn)?;

    cleanup_invalid_command_history(&conn)?;

    migrate_passwords_if_needed(&conn)?;

    DB_INITIALIZED.store(true, Ordering::SeqCst);

    Ok(true)
}

fn migrate_passwords_if_needed(conn: &Connection) -> Result<(), String> {
    // 检查是否已完成迁移
    let migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'password_migration_v2'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "false".to_string())
        == "true";

    if migrated {
        return Ok(());
    }

    // 获取所有连接的 id 和 password
    let mut stmt = conn
        .prepare("SELECT id, password FROM connections WHERE password IS NOT NULL")
        .map_err(|e| e.to_string())?;

    let records: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    if records.is_empty() {
        // 没有需要迁移的密码，直接标记完成
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('password_migration_v2', 'true')",
            [],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let mut migrated_count = 0;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    for (id, encrypted) in records {
        let (needs_migrate, new_encrypted) = migrate_encrypted_password(Some(&encrypted));

        if needs_migrate {
            if let Some(new_pass) = new_encrypted {
                tx.execute(
                    "UPDATE connections SET password = ?1 WHERE id = ?2",
                    rusqlite::params![new_pass, id],
                )
                .map_err(|e| e.to_string())?;
                migrated_count += 1;
            }
        }
    }

    // 标记迁移完成
    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('password_migration_v2', 'true')",
        [],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    if migrated_count > 0 {
        println!(
            "[Database] Migrated {} passwords to new encryption key",
            migrated_count
        );
    }

    Ok(())
}

#[tauri::command]
pub fn get_connections() -> Result<Vec<ConnectionRecord>, String> {
    let conn = get_db()?;

    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, password, key_file, group_name, tags, last_connected_at, created_at, updated_at, sort_order FROM connections ORDER BY sort_order, name"
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
                sort_order: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for c in connections {
        match c {
            Ok(record) => result.push(record),
            Err(e) => eprintln!("[Database] Failed to parse connection row: {}", e),
        }
    }
    Ok(result)
}

#[tauri::command]
pub fn save_connection(connection: ConnectionRecord) -> Result<bool, String> {
    let conn = get_db()?;

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
    let conn = get_db()?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM command_history WHERE connection_id = ?1",
        [&id],
    )
    .map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM connections WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn get_setting(key: String) -> Result<Option<String>, String> {
    let conn = get_db()?;

    let result: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [&key], |row| {
            row.get(0)
        })
        .ok();

    Ok(result)
}

#[tauri::command]
pub fn save_setting(key: String, value: String) -> Result<bool, String> {
    let conn = get_db()?;

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

    let conn = get_db()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    if !merge {
        tx.execute("DELETE FROM connections", [])
            .map_err(|e| e.to_string())?;
    }

    let mut imported_count = 0;
    for record in import_data.connections {
        let encrypted_password = record.password.as_ref().map(|p| encrypt_password(p));
        tx.execute(
            "INSERT OR REPLACE INTO connections (id, name, host, port, username, password, key_file, group_name, tags, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)",
            rusqlite::params![
                record.id,
                record.name,
                record.host,
                record.port,
                record.username,
                encrypted_password,
                record.key_file,
                record.group_name,
                record.tags,
            ],
        ).map_err(|e| e.to_string())?;
        imported_count += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
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

    let conn = get_db()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM connections", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM settings", [])
        .map_err(|e| e.to_string())?;

    let mut imported_count = 0;
    for record in import_data.connections.clone() {
        let encrypted_password = record.password.as_ref().map(|p| encrypt_password(p));
        tx.execute(
            "INSERT OR REPLACE INTO connections (id, name, host, port, username, password, key_file, group_name, tags, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)",
            rusqlite::params![
                record.id,
                record.name,
                record.host,
                record.port,
                record.username,
                encrypted_password,
                record.key_file,
                record.group_name,
                record.tags,
            ],
        ).map_err(|e| e.to_string())?;
        imported_count += 1;
    }

    if let Some(settings) = import_data.settings {
        for (key, value) in [
            ("theme", settings.theme),
            ("terminal_font", settings.terminal_font),
            ("terminal_cursor_style", settings.terminal_cursor_style),
            ("terminal_theme", settings.terminal_theme),
        ] {
            if let Some(v) = value {
                tx.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                    [key, &v],
                )
                .map_err(|e| e.to_string())?;
            }
        }

        for (key, value) in [
            (
                "terminal_font_size",
                settings.terminal_font_size.map(|v| v.to_string()),
            ),
            (
                "terminal_scrollback",
                settings.terminal_scrollback.map(|v| v.to_string()),
            ),
            (
                "terminal_cursor_blink",
                settings.terminal_cursor_blink.map(|v| v.to_string()),
            ),
            (
                "terminal_copy_on_select",
                settings.terminal_copy_on_select.map(|v| v.to_string()),
            ),
        ] {
            if let Some(v) = value {
                tx.execute(
                    "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                    [key, &v],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported_count)
}

#[tauri::command]
pub fn migrate_from_localstorage(connections_json: String) -> Result<usize, String> {
    let conn = get_db()?;

    // 检查是否已迁移过
    let migrated: bool = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'localstorage_migrated'",
            [],
            |row| row.get::<_, String>(0),
        )
        .unwrap_or_else(|_| "false".to_string())
        == "true";

    if migrated {
        return Ok(0); // 已迁移过，不再重复迁移
    }

    let connections: Vec<ConnectionRecord> =
        serde_json::from_str(&connections_json).map_err(|e| e.to_string())?;

    if connections.is_empty() {
        return Ok(0);
    }

    let total_count = connections.len();

    // 检查数据库是否已有连接数据
    let existing_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM connections", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    let mut migrated_count = 0;
    for record in connections {
        let encrypted_password = record.password.as_ref().map(|p| encrypt_password(p));

        // 使用 INSERT OR IGNORE 避免覆盖已有数据
        let result = tx.execute(
            "INSERT OR IGNORE INTO connections (id, name, host, port, username, password, key_file, group_name, tags, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP)",
            rusqlite::params![
                record.id,
                record.name,
                record.host,
                record.port,
                record.username,
                encrypted_password,
                record.key_file,
                record.group_name,
                record.tags,
            ],
        );

        if let Ok(rows_affected) = result {
            if rows_affected > 0 {
                migrated_count += 1;
            }
        }
    }

    // 标记迁移完成
    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('localstorage_migrated', 'true')",
        [],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    if migrated_count > 0 {
        println!(
            "[Database] Migrated {} connections from localStorage ({} skipped, already exist)",
            migrated_count,
            total_count - migrated_count
        );
    } else if existing_count > 0 {
        println!(
            "[Database] Skipped localStorage migration: {} connections already in database",
            existing_count
        );
    }

    Ok(migrated_count)
}

#[tauri::command]
pub fn record_connection_history(id: String) -> Result<(), String> {
    let conn = get_db()?;
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
    let conn = get_db()?;
    let limit = limit.unwrap_or(10);

    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, password, key_file, group_name, tags, last_connected_at, created_at, updated_at, sort_order FROM connections WHERE last_connected_at IS NOT NULL ORDER BY last_connected_at DESC LIMIT ?"
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
                sort_order: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(connections)
}

#[tauri::command]
pub fn update_connection_order(order: Vec<(String, i32)>) -> Result<bool, String> {
    let conn = get_db()?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;

    for (id, sort_order) in order {
        tx.execute(
            "UPDATE connections SET sort_order = ? WHERE id = ?",
            rusqlite::params![sort_order, id],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

const MAX_HISTORY_PER_CONNECTION: i32 = 1000;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommandHistoryRecord {
    pub text: String,
    pub timestamp: i64,
    pub count: i32,
}

#[tauri::command]
pub fn get_command_history(connection_id: String) -> Result<Vec<CommandHistoryRecord>, String> {
    let conn = get_db()?;

    let mut stmt = conn
        .prepare(
            "SELECT text, timestamp, count FROM command_history 
             WHERE connection_id = ?1 
             ORDER BY timestamp DESC 
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let records = stmt
        .query_map(
            rusqlite::params![connection_id, MAX_HISTORY_PER_CONNECTION],
            |row| {
                Ok(CommandHistoryRecord {
                    text: row.get(0)?,
                    timestamp: row.get(1)?,
                    count: row.get(2)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(records)
}

#[tauri::command]
pub fn save_command(connection_id: String, text: String) -> Result<(), String> {
    let conn = get_db()?;
    let now = chrono::Utc::now().timestamp_millis();

    conn.execute(
        "INSERT INTO command_history (connection_id, text, timestamp, count) 
         VALUES (?1, ?2, ?3, 1)
         ON CONFLICT(connection_id, text) DO UPDATE SET 
           timestamp = excluded.timestamp,
           count = MIN(count + 1, 999)",
        rusqlite::params![connection_id, text, now],
    )
    .map_err(|e| e.to_string())?;

    cleanup_old_history(&conn, &connection_id)?;

    Ok(())
}

#[tauri::command]
pub fn clear_command_history(connection_id: String) -> Result<(), String> {
    let conn = get_db()?;

    conn.execute(
        "DELETE FROM command_history WHERE connection_id = ?1",
        [connection_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

fn cleanup_old_history(conn: &Connection, connection_id: &str) -> Result<(), String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM command_history WHERE connection_id = ?1",
            [connection_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    if count > MAX_HISTORY_PER_CONNECTION as i64 {
        let delete_count = count - MAX_HISTORY_PER_CONNECTION as i64;
        conn.execute(
            "DELETE FROM command_history WHERE id IN (
                SELECT id FROM command_history 
                WHERE connection_id = ?1 
                ORDER BY timestamp ASC 
                LIMIT ?2
            )",
            rusqlite::params![connection_id, delete_count],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

const COMMAND_HISTORY_EXPIRE_DAYS: i64 = 90;

fn cleanup_expired_command_history(conn: &Connection) -> Result<(), String> {
    let expire_threshold =
        chrono::Utc::now().timestamp_millis() - (COMMAND_HISTORY_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

    let deleted = conn
        .execute(
            "DELETE FROM command_history WHERE timestamp < ?1",
            [expire_threshold],
        )
        .map_err(|e| e.to_string())?;

    if deleted > 0 {
        println!(
            "[Database] Cleaned up {} expired command history records (older than {} days)",
            deleted, COMMAND_HISTORY_EXPIRE_DAYS
        );
    }

    Ok(())
}

fn cleanup_invalid_command_history(conn: &Connection) -> Result<(), String> {
    let deleted = conn
        .execute("DELETE FROM command_history WHERE text LIKE '%\t%'", [])
        .map_err(|e| e.to_string())?;

    if deleted > 0 {
        println!(
            "[Database] Cleaned up {} invalid command history records (containing tab characters)",
            deleted
        );
    }

    Ok(())
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
