use rusqlite::{Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionRecord {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub group_name: Option<String>,
    pub tags: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
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
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
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
            group_name TEXT,
            tags TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    ).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    ).map_err(|e| e.to_string())?;

    Ok(true)
}

#[tauri::command]
pub fn get_connections() -> Result<Vec<ConnectionRecord>, String> {
    let conn = get_db().map_err(|e| e.to_string())?;

    let mut stmt = conn.prepare(
        "SELECT id, name, host, port, username, password, group_name, tags, created_at, updated_at FROM connections ORDER BY name"
    ).map_err(|e| e.to_string())?;

    let connections = stmt.query_map([], |row| {
        Ok(ConnectionRecord {
            id: row.get(0)?,
            name: row.get(1)?,
            host: row.get(2)?,
            port: row.get(3)?,
            username: row.get(4)?,
            password: row.get(5)?,
            group_name: row.get(6)?,
            tags: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?;

    let result: Vec<ConnectionRecord> = connections.filter_map(|c| c.ok()).collect();
    Ok(result)
}

#[tauri::command]
pub fn save_connection(connection: ConnectionRecord) -> Result<bool, String> {
    let conn = get_db().map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR REPLACE INTO connections (id, name, host, port, username, password, group_name, tags, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)",
        rusqlite::params![
            connection.id,
            connection.name,
            connection.host,
            connection.port,
            connection.username,
            connection.password,
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