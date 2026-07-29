//! SSH 端口转发（本地转发，等同于 ssh -L）
//!
//! Pro 功能（feature key: port_forward）。Free 构建中 check_feature 返回 false，
//! start_port_forward 会拒绝。代码在公开仓库，但受 license 校验守门。

use once_cell::sync::Lazy;
use russh::client::Msg;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio::task::JoinHandle;

use super::license::check_feature;
use super::ssh::SESSIONS;

static FORWARD_ID_COUNTER: AtomicU64 = AtomicU64::new(1);

/// 一个活跃的端口转发
struct ActiveForward {
    /// 监听任务句柄（停止时 abort）
    listener_task: JoinHandle<()>,
    connection_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
}

static FORWARDS: Lazy<RwLock<HashMap<String, ActiveForward>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardInfo {
    pub id: String,
    pub connection_id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
}

/// 启动本地端口转发（ssh -L local_port:remote_host:remote_port）
#[tauri::command]
pub async fn start_port_forward(
    connection_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<PortForwardInfo, String> {
    // Pro 功能校验
    if !check_feature("port_forward").await {
        return Err("端口转发是专业版功能，请激活 Pro License 后使用".into());
    }

    // 参数校验
    if remote_host.trim().is_empty() {
        return Err("远程主机不能为空".into());
    }
    if remote_port == 0 {
        return Err("远程端口无效".into());
    }

    // 拿到 SSH 会话的 handle 引用（clone Arc，避免长时间持锁）
    let handle = {
        let sessions = SESSIONS.read().await;
        sessions
            .get(&connection_id)
            .map(|s| s.handle.clone())
            .ok_or_else(|| format!("SSH 连接不存在: {}", connection_id))?
    };

    // 绑定本地端口
    let listener = TcpListener::bind(("127.0.0.1", local_port))
        .await
        .map_err(|e| format!("本地端口 {} 绑定失败: {}", local_port, e))?;

    let actual_local_port = listener.local_addr().map(|a| a.port()).unwrap_or(local_port);
    let forward_id = format!("pf-{}", FORWARD_ID_COUNTER.fetch_add(1, Ordering::SeqCst));
    let remote_host_clone = remote_host.clone();

    // 监听任务：每个进来的 TCP 连接开一个 SSH channel 双向桥接。
    // 停止依赖 stop_port_forward 调用 listener_task.abort()。
    let listener_task = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((tcp_stream, peer_addr)) => {
                    let handle = handle.clone();
                    let remote_host = remote_host_clone.clone();
                    tokio::spawn(async move {
                        let channel = match handle
                            .channel_open_direct_tcpip(
                                &remote_host,
                                remote_port as u32,
                                peer_addr.ip().to_string(),
                                peer_addr.port() as u32,
                            )
                            .await
                        {
                            Ok(c) => c,
                            Err(e) => {
                                eprintln!("[port_forward] 打开 SSH channel 失败: {}", e);
                                return;
                            }
                        };
                        bridge(tcp_stream, channel).await;
                    });
                }
                Err(e) => {
                    eprintln!("[port_forward] accept 失败: {}", e);
                    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                }
            }
        }
    });

    let info = PortForwardInfo {
        id: forward_id.clone(),
        connection_id,
        local_port: actual_local_port,
        remote_host,
        remote_port,
    };

    FORWARDS.write().await.insert(
        forward_id,
        ActiveForward {
            listener_task,
            connection_id: info.connection_id.clone(),
            local_port: actual_local_port,
            remote_host: info.remote_host.clone(),
            remote_port,
        },
    );

    Ok(info)
}

/// 双向桥接：TCP <-> SSH channel
async fn bridge(tcp: tokio::net::TcpStream, channel: russh::Channel<Msg>) {
    let stream = channel.into_stream();
    // tokio::io::split 把同时实现 AsyncRead+AsyncWrite 的流拆成独立的读写两半
    let (stream_read, stream_write) = tokio::io::split(stream);
    let (tcp_read, tcp_write) = tcp.into_split();

    // TCP -> SSH
    let mut tcp_read = tcp_read;
    let mut stream_write = stream_write;
    // SSH -> TCP
    let mut stream_read = stream_read;
    let mut tcp_write = tcp_write;

    // select! 任一方向结束即整体结束，避免单边断开后另一边长期挂起泄漏连接
    tokio::select! {
        _ = tokio::io::copy(&mut tcp_read, &mut stream_write) => {}
        _ = tokio::io::copy(&mut stream_read, &mut tcp_write) => {}
    }
}

/// 停止端口转发
#[tauri::command]
pub async fn stop_port_forward(forward_id: String) -> Result<bool, String> {
    let mut forwards = FORWARDS.write().await;
    if let Some(fwd) = forwards.remove(&forward_id) {
        fwd.listener_task.abort();
        Ok(true)
    } else {
        Err(format!("端口转发不存在: {}", forward_id))
    }
}

/// 连接断开时统一清理该连接的所有端口转发。
///
/// disconnect_ssh → cleanup_connection 调用此函数，确保该连接的所有 accept loop
/// 被终止并释放其持有的 Arc<Handle> 克隆。否则 SESSIONS.remove 后底层 SSH 连接
/// 因转发任务仍持有 Handle 副本（Arc 引用计数 > 0）而无法真正关闭，造成资源泄漏。
pub async fn cleanup_forwards(connection_id: &str) {
    let mut forwards = FORWARDS.write().await;
    let ids: Vec<String> = forwards
        .iter()
        .filter(|(_, f)| f.connection_id == connection_id)
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        if let Some(fwd) = forwards.remove(&id) {
            fwd.listener_task.abort();
        }
    }
}

/// 列出活跃的端口转发
#[tauri::command]
pub async fn list_port_forwards() -> Vec<PortForwardInfo> {
    let forwards = FORWARDS.read().await;
    forwards
        .iter()
        .map(|(id, f)| PortForwardInfo {
            id: id.clone(),
            connection_id: f.connection_id.clone(),
            local_port: f.local_port,
            remote_host: f.remote_host.clone(),
            remote_port: f.remote_port,
        })
        .collect()
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_forward_id_format() {
        let id = format!("pf-{}", FORWARD_ID_COUNTER.fetch_add(1, Ordering::SeqCst));
        assert!(id.starts_with("pf-"));
    }

    #[tokio::test]
    async fn test_list_empty() {
        let list = list_port_forwards().await;
        // 仅验证函数可调用（FORWARDS 可能有其它测试遗留，不断言长度）
        let _ = list;
    }
}
