use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Mutex;
use std::collections::HashMap;
use std::time::Duration;
use std::sync::Arc;

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
    static ref SHELL_OUTPUTS: Mutex<HashMap<String, Vec<u8>>> = Mutex::new(HashMap::new());
    static ref RUNNING: Mutex<HashMap<String, bool>> = Mutex::new(HashMap::new());
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
        session.userauth_password(&connection.username, password)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else if let Some(key_file) = &connection.key_file {
        session.userauth_pubkey_file(&connection.username, None, std::path::Path::new(key_file), None)
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
        running.keys().filter(|k| k.starts_with(&prefix)).cloned().collect()
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

    // 清理输出缓冲区
    {
        let mut outputs = SHELL_OUTPUTS.lock().unwrap();
        for k in &keys_to_stop {
            outputs.remove(k);
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
    channel.read_to_string(&mut output).map_err(|e| e.to_string())?;
    channel.wait_close().ok();

    // 恢复非阻塞模式（如果有shell在使用）
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
        session.userauth_password(&connection.username, password)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else if let Some(key_file) = &connection.key_file {
        session.userauth_pubkey_file(&connection.username, None, std::path::Path::new(key_file), None)
            .map_err(|e| format!("Key auth failed: {}", e))?;
    }

    session.disconnect(None, "Test complete", None).ok();
    Ok(session.authenticated())
}

#[tauri::command]
pub fn get_shell(id: String) -> Result<String, String> {
    println!("[DEBUG] get_shell called for connection: {}", id);

    let sessions = SESSIONS.lock().unwrap();
    let session = sessions.get(&id).ok_or("Session not found")?;

    // 确保session在阻塞模式
    session.set_blocking(true);

    let mut channel = session.channel_session().map_err(|e| e.to_string())?;

    // 设置终端模式，启用 echo (值为 1)
    let mut modes = ssh2::PtyModes::new();
    modes.set_character(ssh2::PtyModeOpcode::ECHO, Some(1 as char));

    channel.request_pty("xterm", Some(modes), Some((80, 24, 0, 0))).map_err(|e| e.to_string())?;
    channel.shell().map_err(|e| e.to_string())?;

    // 设置为非阻塞模式
    session.set_blocking(false);

    let shell_id = format!("{}-shell-{}", id,
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis());

    let channel_arc = Arc::new(Mutex::new(channel));
    SHELLS.lock().unwrap().insert(shell_id.clone(), channel_arc.clone());
    SHELL_OUTPUTS.lock().unwrap().insert(shell_id.clone(), Vec::new());
    RUNNING.lock().unwrap().insert(shell_id.clone(), true);

    println!("[DEBUG] get_shell successful, shell_id: {}", shell_id);

    let shell_id_clone = shell_id.clone();
    std::thread::spawn(move || {
        println!("[DEBUG] Reader thread started for shell: {}", shell_id_clone);
        loop {
            if !RUNNING.lock().unwrap().get(&shell_id_clone).copied().unwrap_or(false) {
                println!("[DEBUG] Reader thread stopped for shell: {}", shell_id_clone);
                break;
            }

            let mut data = Vec::new();
            let mut should_break = false;

            {
                let mut ch = channel_arc.lock().unwrap();
                let mut buf = [0u8; 8192];
                match ch.read(&mut buf) {
                    Ok(n) if n > 0 => {
                        data.extend_from_slice(&buf[..n]);
                        println!("[DEBUG] Reader thread read {} bytes from shell: {}", n, shell_id_clone);
                    }
                    Ok(_) => {
                        if ch.eof() {
                            should_break = true;
                            println!("[DEBUG] Reader thread EOF for shell: {}", shell_id_clone);
                        }
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        //println!("[DEBUG] Reader thread WouldBlock for shell: {}", shell_id_clone);
                    }
                    Err(e) => {
                        println!("[DEBUG] Reader thread error: {:?} for shell: {}", e, shell_id_clone);
                    }
                }
            }

            if !data.is_empty() {
                SHELL_OUTPUTS.lock().unwrap().get_mut(&shell_id_clone).map(|o| o.extend_from_slice(&data));
            }

            if should_break { break; }
            std::thread::sleep(Duration::from_millis(5));
        }
    });

    Ok(shell_id)
}

#[tauri::command]
pub fn write_shell(id: String, data: String) -> Result<bool, String> {
    let shells = SHELLS.lock().unwrap();
    let channel = shells.get(&id).ok_or("Shell not found")?;

    println!("[DEBUG] write_shell - id: {}, data length: {}", id, data.len());
    println!("[DEBUG] write_shell - data: {:?}", data);

    let mut ch = channel.lock().unwrap();
    let bytes = data.as_bytes();
    let mut written = 0;

    while written < bytes.len() {
        match ch.write(&bytes[written..]) {
            Ok(n) if n > 0 => {
                written += n;
                println!("[DEBUG] write_shell - wrote {} bytes, total: {}/{}", n, written, bytes.len());
            }
            Ok(_) => continue,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                println!("[DEBUG] write_shell - WouldBlock, sleeping");
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(e) => {
                println!("[DEBUG] write_shell - error: {}", e);
                return Err(e.to_string())
            }
        }
    }
    println!("[DEBUG] write_shell - completed successfully");
    Ok(true)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellReadResult {
    pub data: String,
    pub eof: bool,
}

#[tauri::command]
pub fn read_shell(id: String) -> Result<ShellReadResult, String> {
    let mut outputs = SHELL_OUTPUTS.lock().unwrap();
    if let Some(buffer) = outputs.get_mut(&id) {
        if buffer.is_empty() {
            return Ok(ShellReadResult { data: "".to_string(), eof: false });
        }
        let data = String::from_utf8_lossy(buffer).to_string();
        buffer.clear();
        Ok(ShellReadResult { data, eof: false })
    } else {
        Ok(ShellReadResult { data: "".to_string(), eof: true })
    }
}

#[tauri::command]
pub fn close_shell(id: String) -> Result<bool, String> {
    RUNNING.lock().unwrap().insert(id.clone(), false);
    if let Some(ch) = SHELLS.lock().unwrap().remove(&id) {
        ch.lock().unwrap().close().ok();
    }
    SHELL_OUTPUTS.lock().unwrap().remove(&id);
    Ok(true)
}