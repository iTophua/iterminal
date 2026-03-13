use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
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
    pub static ref SESSIONS: Mutex<HashMap<String, Session>> = Mutex::new(HashMap::new());
    pub static ref SFTP_SESSIONS: Mutex<HashMap<String, Session>> = Mutex::new(HashMap::new());
    pub static ref SHELLS: Mutex<HashMap<String, Arc<Mutex<ssh2::Channel>>>> = Mutex::new(HashMap::new());
    pub static ref RUNNING: Mutex<HashMap<String, bool>> = Mutex::new(HashMap::new());
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

    // 解析地址（支持域名和 IP）
    let socket_addr = match addr.to_socket_addrs() {
        Ok(mut addrs) => addrs.next(),
        Err(e) => return Err(format!("Failed to resolve address: {}", e)),
    };

    let Some(socket_addr) = socket_addr else {
        return Err("Failed to resolve address".to_string());
    };

    // 创建主 session（用于 shell）- 5 秒连接超时
    let tcp = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(5))
        .map_err(|e| format!("连接失败: {}", e))?;
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

    SESSIONS.lock().unwrap().insert(id.clone(), session);

    // 创建独立 SFTP session - 5 秒连接超时
    let sftp_tcp = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(5))
        .map_err(|e| format!("SFTP 连接失败: {}", e))?;
    sftp_tcp
        .set_read_timeout(Some(Duration::from_secs(30)))
        .ok();
    sftp_tcp
        .set_write_timeout(Some(Duration::from_secs(30)))
        .ok();

    let mut sftp_session = Session::new().map_err(|e| e.to_string())?;
    sftp_session.set_tcp_stream(sftp_tcp);
    sftp_session.handshake().map_err(|e| e.to_string())?;

    if let Some(password) = &connection.password {
        sftp_session
            .userauth_password(&connection.username, password)
            .map_err(|e| format!("SFTP auth failed: {}", e))?;
    } else if let Some(key_file) = &connection.key_file {
        sftp_session
            .userauth_pubkey_file(
                &connection.username,
                None,
                std::path::Path::new(key_file),
                None,
            )
            .map_err(|e| format!("SFTP key auth failed: {}", e))?;
    }

    if sftp_session.authenticated() {
        SFTP_SESSIONS.lock().unwrap().insert(id, sftp_session);
    }

    Ok(true)
}

#[tauri::command]
pub fn disconnect_ssh(id: String) -> Result<bool, String> {
    let prefix = format!("{}-shell", id);

    let keys_to_stop: Vec<String> = {
        let running = RUNNING.lock().unwrap();
        running
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect()
    };

    {
        let mut running = RUNNING.lock().unwrap();
        for k in &keys_to_stop {
            running.insert(k.clone(), false);
        }
    }

    {
        let mut shells = SHELLS.lock().unwrap();
        for k in &keys_to_stop {
            if let Some(ch) = shells.remove(k) {
                ch.lock().unwrap().close().ok();
            }
        }
    }

    if let Some(session) = SESSIONS.lock().unwrap().remove(&id) {
        session.disconnect(None, "Disconnected", None).ok();
    }

    if let Some(sftp_session) = SFTP_SESSIONS.lock().unwrap().remove(&id) {
        sftp_session
            .disconnect(None, "SFTP Disconnected", None)
            .ok();
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

    // 解析地址
    let socket_addr = match addr.to_socket_addrs() {
        Ok(mut addrs) => addrs.next(),
        Err(e) => return Err(format!("Failed to resolve address: {}", e)),
    };

    let Some(socket_addr) = socket_addr else {
        return Err("Failed to resolve address".to_string());
    };

    // 5 秒连接超时
    let tcp = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(5))
        .map_err(|e| format!("连接失败: {}", e))?;
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

#[tauri::command]
pub fn check_port_reachable(host: String, port: u16) -> Result<bool, String> {
    let addr = format!("{}:{}", host, port);

    // 解析地址（支持域名和 IP）
    let socket_addr = match addr.to_socket_addrs() {
        Ok(mut addrs) => addrs.next(),
        Err(_) => None,
    };

    let Some(socket_addr) = socket_addr else {
        return Ok(false);
    };

    // 5 秒连接超时
    let result = TcpStream::connect_timeout(&socket_addr, Duration::from_secs(5));

    Ok(result.is_ok())
}

// ==================== 系统监控 ====================

/// 解析磁盘大小字符串（支持 K, M, G, T 后缀）
fn parse_disk_size(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }

    let multiplier = if s.ends_with('T') {
        1024 * 1024
    } else if s.ends_with('G') {
        1024
    } else if s.ends_with('M') {
        1
    } else if s.ends_with('K') {
        1 / 1024
    } else {
        1024 // 无后缀默认按 GB 处理
    };

    let num_str = s.trim_end_matches(|c| c == 'K' || c == 'M' || c == 'G' || c == 'T');
    num_str.parse::<u64>().unwrap_or(0) * multiplier
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

#[tauri::command]
pub fn get_system_monitor(id: String) -> Result<MonitorData, String> {
    // 获取连接级别的锁，防止与 get_shell 并发
    let shell_lock = {
        let locks = SHELL_LOCKS.lock().unwrap();
        locks.get(&id).cloned().unwrap_or_else(|| {
            let lock = Arc::new(Mutex::new(()));
            drop(locks);
            SHELL_LOCKS.lock().unwrap().insert(id.clone(), lock.clone());
            lock
        })
    };
    let _guard = shell_lock.lock().unwrap();

    let prefix = format!("{}-shell", &id);
    let sids: Vec<String> = SHELLS
        .lock()
        .unwrap()
        .keys()
        .filter(|k| k.starts_with(&prefix))
        .cloned()
        .collect();
    for s in &sids {
        RUNNING.lock().unwrap().insert(s.clone(), false);
    }
    std::thread::sleep(Duration::from_millis(50));

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

    let res = {
        let ss = SESSIONS.lock().unwrap();
        let sess = ss.get(&id).ok_or("Session not found")?;
        sess.set_blocking(true);
        let mut ch = sess.channel_session().map_err(|e| e.to_string())?;
        ch.exec(script).map_err(|e| e.to_string())?;
        let mut out = String::new();
        ch.read_to_string(&mut out).map_err(|e| e.to_string())?;
        ch.wait_close().ok();
        sess.set_blocking(false);

        let mut sec = "";
        let (mut h, mut o, mut k, mut u) = (
            "unknown".into(),
            "Linux".into(),
            "unknown".into(),
            "unknown".into(),
        );
        let (mut cr, mut la, mut cu) = (1u32, "N/A".into(), 0.0f32);
        let mut pcu: Vec<f32> = Vec::new();
        let (mut mt, mut mu, mut mf, mut st, mut su) = (0u64, 0u64, 0u64, 0u64, 0u64);
        let mut dsk: Vec<DiskInfo> = Vec::new();

        for l in out.lines() {
            let t = l.trim();
            if t.contains("<<H>>") {
                sec = "h";
                continue;
            }
            if t.contains("<<O>>") {
                sec = "o";
                continue;
            }
            if t.contains("<<K>>") {
                sec = "k";
                continue;
            }
            if t.contains("<<U>>") {
                sec = "u";
                continue;
            }
            if t.contains("<<C>>") {
                sec = "c";
                continue;
            }
            if t.contains("<<L>>") {
                sec = "l";
                continue;
            }
            if t.contains("<<P>>") {
                sec = "p";
                continue;
            }
            if t.contains("<<PC>>") {
                sec = "pc";
                continue;
            }
            if t.contains("<<M>>") {
                sec = "m";
                continue;
            }
            if t.contains("<<D>>") {
                sec = "d";
                continue;
            }

            match sec {
                "h" => {
                    h = t.to_string();
                    sec = "";
                }
                "o" => {
                    o = t.to_string();
                    sec = "";
                }
                "k" => {
                    k = t.to_string();
                    sec = "";
                }
                "u" => {
                    u = t.to_string();
                    sec = "";
                }
                "c" => {
                    cr = t.parse().unwrap_or(1);
                    sec = "";
                }
                "l" => {
                    let p: Vec<&str> = t.split_whitespace().collect();
                    if p.len() >= 3 {
                        la = format!("{} / {} / {}", p[0], p[1], p[2]);
                    }
                    sec = "";
                }
                "p" => {
                    cu = t.parse().unwrap_or(0.0);
                    sec = "";
                }
                "pc" => {
                    if let Ok(v) = t.parse::<f32>() {
                        pcu.push(v);
                    }
                }
                "m" => {
                    let p: Vec<&str> = t.split_whitespace().collect();
                    if t.starts_with("Mem:") && p.len() >= 4 {
                        mt = p[1].parse().unwrap_or(0);
                        mu = p[2].parse().unwrap_or(0);
                        mf = p[3].parse().unwrap_or(0);
                    } else if t.starts_with("Swap:") && p.len() >= 3 {
                        st = p[1].parse().unwrap_or(0);
                        su = p[2].parse().unwrap_or(0);
                    }
                }
                "d" => {
                    let p: Vec<&str> = t.split_whitespace().collect();
                    if p.len() >= 6 {
                        dsk.push(DiskInfo {
                            filesystem: p[0].to_string(),
                            mount_point: p[5].to_string(),
                            total: parse_disk_size(p[1]),
                            used: parse_disk_size(p[2]),
                            available: parse_disk_size(p[3]),
                            usage_percent: p[4].trim_end_matches('%').parse().unwrap_or(0.0),
                        });
                    }
                }

                _ => {}
            }
        }
        if pcu.is_empty() {
            for _ in 0..cr {
                pcu.push(cu);
            }
        }

        Ok(MonitorData {
            system: SystemInfo {
                hostname: h,
                os: o,
                kernel: k,
                uptime: u,
            },
            cpu: CpuInfo {
                usage: cu,
                cores: cr,
                load_avg: la,
                per_core_usage: pcu,
            },
            memory: MemoryInfo {
                total: mt,
                used: mu,
                free: mf,
                usage_percent: if mt > 0 {
                    (mu as f64 / mt as f64 * 100.0) as f32
                } else {
                    0.0
                },
                swap_total: st,
                swap_used: su,
            },
            disks: dsk,
        })
    };

    for s in &sids {
        RUNNING.lock().unwrap().insert(s.clone(), true);
    }
    res
}
