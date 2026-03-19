use once_cell::sync::Lazy;
use russh::client::{Handle, Handler};
use russh::{ChannelMsg, Disconnect};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot, RwLock};

use super::license::get_max_connections;

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

pub struct SshClientHandler;

impl Handler for SshClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        // SECURITY: 跳过主机密钥验证，生产环境应实现 known_hosts 验证
        Ok(true)
    }
}

pub struct SshSession {
    pub handle: Handle<SshClientHandler>,
    pub connection: SSHConnection,
}

pub struct ShellSession {
    pub cancel_tx: oneshot::Sender<()>,
    pub resize_tx: mpsc::Sender<(u32, u32)>,
    pub write_tx: mpsc::Sender<Vec<u8>>,
}

pub static SESSIONS: Lazy<RwLock<HashMap<String, SshSession>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

static SHELLS: Lazy<RwLock<HashMap<String, ShellSession>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

#[tauri::command]
pub async fn connect_ssh(id: String, connection: SSHConnection) -> Result<bool, String> {
    if SESSIONS.read().await.contains_key(&id) {
        return Ok(true);
    }

    let current_count = SESSIONS.read().await.len() as u32;
    let max_connections = get_max_connections().await;
    if current_count >= max_connections {
        return Err(format!(
            "免费版最多支持 {} 个连接，请升级专业版解锁无限连接",
            max_connections
        ));
    }

    let addr = format!("{}:{}", connection.host, connection.port);
    let socket_addr = addr
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .ok_or("解析地址失败")?;

    let config = Arc::new(russh::client::Config::default());
    let addr_str = socket_addr.to_string();

    let connect_result = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        russh::client::connect(config, &addr_str, SshClientHandler)
    ).await;

    let mut handle = match connect_result {
        Ok(Ok(handle)) => handle,
        Ok(Err(e)) => return Err(format!("连接失败: {}", e)),
        Err(_) => return Err("连接超时，请检查网络或服务器地址".to_string()),
    };

let auth_success = if let Some(password) = &connection.password {
        let auth_result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            handle.authenticate_password(&connection.username, password)
        ).await;

        match auth_result {
            Ok(Ok(auth)) => auth.success(),
            Ok(Err(e)) => return Err(format!("认证失败: {}", e)),
            Err(_) => return Err("认证超时".to_string()),
        }
    } else if let Some(key_file) = &connection.key_file {
        let key_path = shellexpand::tilde(key_file).into_owned();
        let key_pair = russh::keys::load_secret_key(&key_path, None)
            .map_err(|e| format!("加载密钥文件失败: {}。请确保文件路径正确且格式为 OpenSSH/PEM", e))?;

        let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(
            Arc::new(key_pair),
            None,
        );

        let auth_result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            handle.authenticate_publickey(&connection.username, key_with_hash)
        ).await;

        match auth_result {
            Ok(Ok(auth)) => auth.success(),
            Ok(Err(e)) => return Err(format!("密钥认证失败: {}。请检查密钥是否已添加到服务器", e)),
            Err(_) => return Err("密钥认证超时".to_string()),
        }
    } else {
        return Err("未提供认证信息".to_string());
    };

    if !auth_success {
        return Err("认证失败".to_string());
    }

    SESSIONS.write().await.insert(id, SshSession { handle, connection });
    Ok(true)
}

#[tauri::command]
pub async fn disconnect_ssh(id: String) -> Result<bool, String> {
    let prefix = format!("{}-shell", &id);
    {
        let mut shells = SHELLS.write().await;
        let shell_ids: Vec<String> = shells
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for shell_id in shell_ids {
            if let Some(shell) = shells.remove(&shell_id) {
                let _ = shell.cancel_tx.send(());
            }
        }
    }

    // 关闭 SFTP 会话
    super::sftp::close_sftp_session(&id).await;

    if let Some(session) = SESSIONS.write().await.remove(&id) {
        let _ = session
            .handle
            .disconnect(Disconnect::ByApplication, "Disconnected", "en")
            .await;
    }
    Ok(true)
}

#[tauri::command]
pub async fn execute_command(id: String, command: String) -> Result<CommandResult, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    channel
        .exec(true, command.as_str())
        .await
        .map_err(|e| e.to_string())?;

    let mut output = Vec::new();
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => output.extend_from_slice(&data),
            ChannelMsg::ExitStatus { exit_status } => {
                return Ok(CommandResult {
                    success: exit_status == 0,
                    output: String::from_utf8_lossy(&output).to_string(),
                    error: None,
                });
            }
            ChannelMsg::Eof => break,
            _ => {}
        }
    }

    Ok(CommandResult {
        success: true,
        output: String::from_utf8_lossy(&output).to_string(),
        error: None,
    })
}

#[tauri::command]
pub async fn test_connection(connection: SSHConnection) -> Result<bool, String> {
    let addr = format!("{}:{}", connection.host, connection.port);
    let socket_addr = addr
        .to_socket_addrs()
        .ok()
        .and_then(|mut a| a.next())
        .ok_or("解析地址失败")?;

    let config = Arc::new(russh::client::Config::default());
    let mut handle = russh::client::connect(config, &socket_addr.to_string(), SshClientHandler)
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    let auth_success = if let Some(password) = &connection.password {
        handle
            .authenticate_password(&connection.username, password)
            .await
            .map(|auth| auth.success())
            .unwrap_or(false)
    } else if let Some(key_file) = &connection.key_file {
        let key_path = shellexpand::tilde(key_file).into_owned();
        match russh::keys::load_secret_key(&key_path, None) {
            Ok(key_pair) => {
                let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(
                    Arc::new(key_pair),
                    None,
                );
                handle
                    .authenticate_publickey(&connection.username, key_with_hash)
                    .await
                    .map(|auth| auth.success())
                    .unwrap_or(false)
            }
            Err(_) => false
        }
    } else {
        false
    };

    let _ = handle
        .disconnect(Disconnect::ByApplication, "Test complete", "en")
        .await;
    Ok(auth_success)
}

#[tauri::command]
pub async fn get_shell(id: String, app: AppHandle) -> Result<String, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    channel
        .request_pty(true, "xterm", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| e.to_string())?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| e.to_string())?;

    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(10);
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(100);

    let shell_id = format!(
        "{}-shell-{}",
        id,
        chrono::Utc::now().timestamp_millis()
    );

    let shell_id_clone = shell_id.clone();
    let app_handle = app.clone();
    let connection_id = id.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,

                Some((cols, rows)) = resize_rx.recv() => {
                    if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                        eprintln!("Resize error for {}: {}", shell_id_clone, e);
                    }
                }

                Some(data) = write_rx.recv() => {
                    if let Err(e) = channel.data(&data[..]).await {
                        eprintln!("Write error for {}: {}", shell_id_clone, e);
                        let _ = app_handle.emit(
                            &format!("connection-disconnected-{}", connection_id),
                            serde_json::json!({ "reason": "write_failed", "shell_id": shell_id_clone })
                        );
                        break;
                    }
                }

                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let data_str = String::from_utf8_lossy(&data).to_string();
                            let event_name = format!("shell-output-{}", shell_id_clone);
                            let _ = app_handle.emit(&event_name, &data_str);
                        }
                        Some(ChannelMsg::Eof) => {
                            let event_name = format!("shell-output-{}", shell_id_clone);
                            let _ = app_handle.emit(&event_name, serde_json::json!({"eof": true}));
                            break;
                        }
                        None => {
                            let _ = app_handle.emit(
                                &format!("connection-disconnected-{}", connection_id),
                                serde_json::json!({ "reason": "channel_closed", "shell_id": shell_id_clone })
                            );
                            break;
                        }
                        Some(ChannelMsg::Close) => {
                            let _ = app_handle.emit(
                                &format!("connection-disconnected-{}", connection_id),
                                serde_json::json!({ "reason": "server_close", "shell_id": shell_id_clone })
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    SHELLS.write().await.insert(
        shell_id.clone(),
        ShellSession {
            cancel_tx,
            resize_tx,
            write_tx,
        },
    );
    Ok(shell_id)
}

#[tauri::command]
pub async fn write_shell(id: String, data: String) -> Result<bool, String> {
    let shells = SHELLS.read().await;
    let shell = shells.get(&id).ok_or("Shell not found")?;
    shell
        .write_tx
        .send(data.into_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn close_shell(id: String) -> Result<bool, String> {
    if let Some(shell) = SHELLS.write().await.remove(&id) {
        let _ = shell.cancel_tx.send(());
    }
    Ok(true)
}

#[tauri::command]
pub async fn start_shell_reader(_id: String, _app: AppHandle) -> Result<bool, String> {
    // russh 版本中 reader 已在 get_shell 中启动，此函数保留以保持前端兼容性
    Ok(true)
}

#[tauri::command]
pub async fn resize_shell(id: String, cols: u16, rows: u16) -> Result<bool, String> {
    let shells = SHELLS.read().await;
    let shell = shells.get(&id).ok_or("Shell not found")?;
    shell
        .resize_tx
        .send((cols as u32, rows as u32))
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn check_port_reachable(host: String, port: u16) -> Result<bool, String> {
    let addr = format!("{}:{}", host, port);
    let socket_addr = addr.to_socket_addrs().ok().and_then(|mut a| a.next());
    let Some(socket_addr) = socket_addr else {
        return Ok(false);
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&socket_addr),
    )
    .await;
    Ok(result.is_ok() && result.unwrap().is_ok())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub uptime: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CpuInfo {
    pub usage: f32,
    pub cores: u32,
    pub load_avg: String,
    pub per_core_usage: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub usage_percent: f32,
    pub swap_total: u64,
    pub swap_used: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskInfo {
    pub filesystem: String,
    pub mount_point: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub usage_percent: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorData {
    pub system: SystemInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub disks: Vec<DiskInfo>,
}

fn parse_disk_size(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    let num_str = s.trim_end_matches(|c| c == 'K' || c == 'M' || c == 'G' || c == 'T');
    let num = num_str.parse::<u64>().unwrap_or(0);

    let mb = if s.ends_with('T') {
        num * 1024 * 1024
    } else if s.ends_with('G') {
        num * 1024
    } else if s.ends_with('M') {
        num
    } else if s.ends_with('K') {
        num / 1024
    } else {
        num * 1024
    };
    mb
}

#[tauri::command]
pub async fn get_system_monitor(id: String) -> Result<MonitorData, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    let script = r#"
echo "<<H>>";hostname
echo "<<O>>";cat /etc/os-release 2>/dev/null|grep PRETTY_NAME|cut -d'"' -f2||echo Linux
echo "<<K>>";uname -r
echo "<<U>>";uptime -p 2>/dev/null|sed 's/up //'||echo unknown
echo "<<C>>";nproc
echo "<<L>>";cat /proc/loadavg
echo "<<P>>";top -bn1 2>/dev/null|grep -E 'Cpu|CPU'|head -1|awk '{print $2}'|cut -d'%' -f1||echo 0
echo "<<PC>>";mpstat -P ALL 1 1 2>/dev/null|awk '/Average/&&$2!="CPU"{print 100-$NF}'||for i in $(seq 0 $(($(nproc)-1)));do echo 0;done
echo "<<M>>";free -m|grep -E '^Mem|^Swap'
echo "<<D>>";df -h 2>/dev/null|grep '^/dev'||true
"#;

    channel
        .exec(true, script)
        .await
        .map_err(|e| e.to_string())?;

    let mut output = Vec::new();
    while let Some(msg) = channel.wait().await {
        if let ChannelMsg::Data { data } = msg {
            output.extend_from_slice(&data);
        }
    }

    let output_str = String::from_utf8_lossy(&output).to_string();
    let mut section = "";
    let (mut hostname, mut os, mut kernel, mut uptime) =
        ("unknown".to_string(), "Linux".to_string(), "unknown".to_string(), "unknown".to_string());
    let (mut cores, mut load_avg, mut cpu_usage) = (1u32, "N/A".to_string(), 0.0f32);
    let mut per_core_usage: Vec<f32> = Vec::new();
    let (mut mem_total, mut mem_used, mut mem_free, mut swap_total, mut swap_used) =
        (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut disks: Vec<DiskInfo> = Vec::new();

    for line in output_str.lines() {
        let trimmed = line.trim();
        if trimmed.contains("<<H>>") { section = "h"; continue; }
        if trimmed.contains("<<O>>") { section = "o"; continue; }
        if trimmed.contains("<<K>>") { section = "k"; continue; }
        if trimmed.contains("<<U>>") { section = "u"; continue; }
        if trimmed.contains("<<C>>") { section = "c"; continue; }
        if trimmed.contains("<<L>>") { section = "l"; continue; }
        if trimmed.contains("<<P>>") { section = "p"; continue; }
        if trimmed.contains("<<PC>>") { section = "pc"; continue; }
        if trimmed.contains("<<M>>") { section = "m"; continue; }
        if trimmed.contains("<<D>>") { section = "d"; continue; }

        match section {
            "h" => { hostname = trimmed.to_string(); section = ""; }
            "o" => { os = trimmed.to_string(); section = ""; }
            "k" => { kernel = trimmed.to_string(); section = ""; }
            "u" => { uptime = trimmed.to_string(); section = ""; }
            "c" => { cores = trimmed.parse().unwrap_or(1); section = ""; }
            "l" => {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 3 {
                    load_avg = format!("{} / {} / {}", parts[0], parts[1], parts[2]);
                }
                section = "";
            }
            "p" => { cpu_usage = trimmed.parse().unwrap_or(0.0); section = ""; }
            "pc" => { if let Ok(v) = trimmed.parse::<f32>() { per_core_usage.push(v); } }
            "m" => {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if trimmed.starts_with("Mem:") && parts.len() >= 4 {
                    mem_total = parts[1].parse().unwrap_or(0);
                    mem_used = parts[2].parse().unwrap_or(0);
                    mem_free = parts[3].parse().unwrap_or(0);
                } else if trimmed.starts_with("Swap:") && parts.len() >= 3 {
                    swap_total = parts[1].parse().unwrap_or(0);
                    swap_used = parts[2].parse().unwrap_or(0);
                }
            }
            "d" => {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 6 {
                    disks.push(DiskInfo {
                        filesystem: parts[0].to_string(),
                        mount_point: parts[5].to_string(),
                        total: parse_disk_size(parts[1]),
                        used: parse_disk_size(parts[2]),
                        available: parse_disk_size(parts[3]),
                        usage_percent: parts[4].trim_end_matches('%').parse().unwrap_or(0.0),
                    });
                }
            }
            _ => {}
        }
    }

    if per_core_usage.is_empty() {
        for _ in 0..cores { per_core_usage.push(cpu_usage); }
    }

    Ok(MonitorData {
        system: SystemInfo { hostname, os, kernel, uptime },
        cpu: CpuInfo { usage: cpu_usage, cores, load_avg, per_core_usage },
        memory: MemoryInfo {
            total: mem_total,
            used: mem_used,
            free: mem_free,
            usage_percent: if mem_total > 0 { (mem_used as f64 / mem_total as f64 * 100.0) as f32 } else { 0.0 },
            swap_total,
            swap_used,
        },
        disks,
    })
}