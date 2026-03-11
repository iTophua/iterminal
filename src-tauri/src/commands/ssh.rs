use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SSHConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub key_file: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

lazy_static::lazy_static! {
    static ref SESSIONS: Mutex<HashMap<String, Session>> = Mutex::new(HashMap::new());
    static ref SHELLS: Mutex<HashMap<String, Arc<Mutex<ssh2::Channel>>>> = Mutex::new(HashMap::new());
    static ref RUNNING: Mutex<HashMap<String, bool>> = Mutex::new(HashMap::new());
    // 连接级别的锁，防止并发 get_shell
    static ref SHELL_LOCKS: Mutex<HashMap<String, Arc<Mutex<()>>>> = Mutex::new(HashMap::new());
}

#[tauri::command]
pub fn connect_ssh(id: String, connection: SSHConnection) -> Result<bool, String> {
    {
        let sessions = SESSIONS.lock().unwrap();
        if sessions.contains_key(&id) {
            return Ok(true);
        }
    }

    let addr = format!("{}:{}", connection.host, connection.port);
    let tcp = TcpStream::connect(&addr).map_err(|e| e.to_string())?;
    tcp.set_read_timeout(Some(Duration::from_secs(30))).ok();
    tcp.set_write_timeout(Some(Duration::from_secs(30))).ok();

    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| e.to_string())?;

    if let Some(password) = &connection.password {
        session
            .userauth_password(&connection.username, password)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else if let Some(key_file) = &connection.key_file {
        session
            .userauth_pubkey_file(
                &connection.username,
                None,
                std::path::Path::new(key_file),
                None,
            )
            .map_err(|e| format!("Key auth failed: {}", e))?;
    }

    if !session.authenticated() {
        return Err("Authentication failed".to_string());
    }

    SESSIONS.lock().unwrap().insert(id, session);
    Ok(true)
}

#[tauri::command]
pub fn disconnect_ssh(id: String) -> Result<bool, String> {
    let prefix = format!("{}-shell", id);

    // 收集需要停止的keys
    let keys_to_stop: Vec<String> = {
        let running = RUNNING.lock().unwrap();
        running
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect()
    };

    // 停止读取线程
    {
        let mut running = RUNNING.lock().unwrap();
        for k in &keys_to_stop {
            running.insert(k.clone(), false);
        }
    }

    // 关闭shells
    {
        let mut shells = SHELLS.lock().unwrap();
        for k in &keys_to_stop {
            if let Some(ch) = shells.remove(k) {
                ch.lock().unwrap().close().ok();
            }
        }
    }

    // 关闭session
    if let Some(session) = SESSIONS.lock().unwrap().remove(&id) {
        session.disconnect(None, "Disconnected", None).ok();
    }

    Ok(true)
}

#[tauri::command]
pub fn execute_command(id: String, command: String) -> Result<CommandResult, String> {
    let sessions = SESSIONS.lock().unwrap();
    let session = sessions.get(&id).ok_or("Session not found")?;

    // 临时设置为阻塞模式以执行命令
    session.set_blocking(true);

    let mut channel = session.channel_session().map_err(|e| e.to_string())?;
    channel.exec(&command).map_err(|e| e.to_string())?;

    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|e| e.to_string())?;
    channel.wait_close().ok();

    // 恢复非阻塞模式
    session.set_blocking(false);

    Ok(CommandResult {
        success: channel.exit_status().unwrap_or(1) == 0,
        output,
        error: None,
    })
}

#[tauri::command]
pub fn test_connection(connection: SSHConnection) -> Result<bool, String> {
    let addr = format!("{}:{}", connection.host, connection.port);
    let tcp = TcpStream::connect(&addr).map_err(|e| e.to_string())?;
    tcp.set_read_timeout(Some(Duration::from_secs(10))).ok();

    let mut session = Session::new().map_err(|e| e.to_string())?;
    session.set_tcp_stream(tcp);
    session.handshake().map_err(|e| e.to_string())?;

    if let Some(password) = &connection.password {
        session
            .userauth_password(&connection.username, password)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else if let Some(key_file) = &connection.key_file {
        session
            .userauth_pubkey_file(
                &connection.username,
                None,
                std::path::Path::new(key_file),
                None,
            )
            .map_err(|e| format!("Key auth failed: {}", e))?;
    }

    session.disconnect(None, "Test complete", None).ok();
    Ok(session.authenticated())
}

#[tauri::command]
pub fn get_shell(id: String, _app: AppHandle) -> Result<String, String> {
    // 获取连接级别的锁
    let shell_lock = {
        let locks = SHELL_LOCKS.lock().unwrap();
        locks.get(&id).cloned().unwrap_or_else(|| {
            let lock = Arc::new(Mutex::new(()));
            drop(locks);
            SHELL_LOCKS.lock().unwrap().insert(id.clone(), lock.clone());
            lock
        })
    };

    // 获取锁，防止同一连接的并发 get_shell
    let _guard = shell_lock.lock().unwrap();

    // 收集该连接的所有 shell_id
    let prefix = format!("{}-shell", &id);
    let shell_ids: Vec<String> = SHELLS
        .lock()
        .unwrap()
        .keys()
        .filter(|k| k.starts_with(&prefix))
        .cloned()
        .collect();

    // 暂停所有 reader thread
    for sid in &shell_ids {
        RUNNING.lock().unwrap().insert(sid.clone(), false);
    }
    // 等待 reader thread 停止
    std::thread::sleep(Duration::from_millis(50));

    // 创建 channel - 使用阻塞模式
    let (channel, shell_id) = {
        let sessions = SESSIONS.lock().unwrap();
        let session = sessions.get(&id).ok_or("Session not found")?;

        // 切换到阻塞模式
        session.set_blocking(true);

        let mut channel = session.channel_session().map_err(|e| e.to_string())?;

        // PTY 模式设置
        let mut modes = ssh2::PtyModes::new();
        modes.set_character(ssh2::PtyModeOpcode::ECHO, Some(1 as char));

        channel
            .request_pty("xterm", Some(modes), Some((80, 24, 0, 0)))
            .map_err(|e| e.to_string())?;
        channel.shell().map_err(|e| e.to_string())?;

        // 切换回非阻塞模式
        session.set_blocking(false);

        let shell_id = format!(
            "{}-shell-{}",
            id,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );

        (channel, shell_id)
    };

    // 恢复所有 reader thread
    for sid in &shell_ids {
        RUNNING.lock().unwrap().insert(sid.clone(), true);
    }
    let channel_arc = Arc::new(Mutex::new(channel));
    SHELLS
        .lock()
        .unwrap()
        .insert(shell_id.clone(), channel_arc.clone());

    Ok(shell_id)
}
#[tauri::command]
pub fn write_shell(id: String, data: String) -> Result<bool, String> {
    let shells = SHELLS.lock().unwrap();
    let channel = shells.get(&id).ok_or("Shell not found")?;

    let mut ch = channel.lock().unwrap();
    let bytes = data.as_bytes();
    let mut written = 0;

    while written < bytes.len() {
        match ch.write(&bytes[written..]) {
            Ok(n) if n > 0 => {
                written += n;
            }
            Ok(_) => continue,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok(true)
}

#[tauri::command]
pub fn close_shell(id: String) -> Result<bool, String> {
    RUNNING.lock().unwrap().insert(id.clone(), false);
    if let Some(ch) = SHELLS.lock().unwrap().remove(&id) {
        ch.lock().unwrap().close().ok();
    }
    Ok(true)
}

/// 启动 shell 的 reader thread（前端准备好后调用）
#[tauri::command]
pub fn start_shell_reader(id: String, app: AppHandle) -> Result<bool, String> {
    let channel_arc = SHELLS
        .lock()
        .unwrap()
        .get(&id)
        .ok_or("Shell not found")?
        .clone();
    
    // 标记为运行中
    RUNNING.lock().unwrap().insert(id.clone(), true);
    
    // 启动 reader thread
    let shell_id_clone = id.clone();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        loop {
            // 检查是否应该暂停
            let is_running = RUNNING
                .lock()
                .unwrap()
                .get(&shell_id_clone)
                .copied()
                .unwrap_or(false);
            if !is_running {
                // 检查 shell 是否还存在
                if !SHELLS.lock().unwrap().contains_key(&shell_id_clone) {
                    break;
                }
                // 暂停中，等待恢复
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }

            let mut data = Vec::new();
            let mut should_break = false;

            {
                let mut ch = channel_arc.lock().unwrap();
                let mut buf = [0u8; 8192];
                match ch.read(&mut buf) {
                    Ok(n) if n > 0 => {
                        data.extend_from_slice(&buf[..n]);
                    }
                    Ok(_) => {
                        if ch.eof() {
                            should_break = true;
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                    Err(_) => {}
                }
            }

            // 有数据时通过 Event 推送到前端
            if !data.is_empty() {
                let data_str = String::from_utf8_lossy(&data).to_string();
                let event_name = format!("shell-output-{}", shell_id_clone);

                let _ = app_handle.emit(&event_name, &data_str);
            }

            if should_break {
                // 发送 EOF 事件
                let event_name = format!("shell-output-{}", shell_id_clone);
                let _ = app_handle.emit(&event_name, serde_json::json!({"eof": true}));
                break;
            }

            std::thread::sleep(Duration::from_millis(5));
        }
    });

    Ok(true)
}
/// 调整终端 PTY 尺寸
#[tauri::command]
pub fn resize_shell(id: String, cols: u16, rows: u16) -> Result<bool, String> {
    let shells = SHELLS.lock().unwrap();
    let channel = shells.get(&id).ok_or("Shell not found")?;
    
    let mut ch = channel.lock().unwrap();
    ch.request_pty_size(cols as u32, rows as u32, None, None)
        .map_err(|e| format!("Failed to resize PTY: {}", e))?;
    
    Ok(true)
}

