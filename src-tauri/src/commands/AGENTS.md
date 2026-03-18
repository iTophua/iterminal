# Commands Module

Tauri command handlers for SSH operations (russh 0.50 + russh-sftp 2.1).

## Structure

```
commands/
├── mod.rs      # Module exports
├── ssh.rs      # SSH connection, shell, command execution (~540 lines)
├── sftp.rs     # SFTP file operations (~630 lines)
├── license.rs  # License validation (~260 lines)
├── api.rs      # HTTP API server for MCP (~200 lines)
└── system.rs   # System info (fonts) (~50 lines)
```

## Where to Look

| 符号 | 类型 | 文件 | 角色 |
|------|------|------|------|
| `SshClientHandler` | struct | ssh.rs | russh Handler 实现 |
| `SshSession` | struct | ssh.rs | SSH 连接 (Handle + Connection 凭据) |
| `ShellSession` | struct | ssh.rs | Shell 会话 (cancel_tx, resize_tx, write_tx) |
| `SESSIONS` | static | ssh.rs | Global SSH session storage (RwLock<HashMap>) |
| `SHELLS` | static | ssh.rs | Shell session storage (RwLock<HashMap>) |
| `connect_ssh` | async fn | ssh.rs | TCP + auth + License check (10s timeout) |
| `get_shell` | async fn | ssh.rs | Spawns PTY + tokio task with Events |
| `write_shell` | async fn | ssh.rs | Sends data via mpsc channel |
| `resize_shell` | async fn | ssh.rs | Sends resize via mpsc channel |
| `disconnect_ssh` | async fn | ssh.rs | Sends cancel signal, closes all |
| `execute_command` | async fn | ssh.rs | Execute remote command |
| `get_system_monitor` | async fn | ssh.rs | Get system stats (CPU, memory, disk) |
| `SftpSessionState` | struct | sftp.rs | SFTP 会话 (Arc<SftpSession>) |
| `create_sftp_connection` | async fn | sftp.rs | 创建独立 SFTP SSH 连接 |
| `get_sftp_session` | async fn | sftp.rs | 获取或创建 SFTP 会话 |
| `upload_file` | async fn | sftp.rs | 后台上传 (tokio::spawn + Events) |
| `download_file` | async fn | sftp.rs | 后台下载 (tokio::spawn + Events) |
| `compress_file` | async fn | sftp.rs | 远程压缩 (tar -czf) |
| `list_directory` | async fn | sftp.rs | 列出目录内容 |
| `is_directory` | async fn | sftp.rs | 检查远程路径是否为目录 |
| `is_local_directory` | async fn | sftp.rs | 检查本地路径是否为目录 |
| `LicenseType` | enum | license.rs | Free/Personal/Professional/Enterprise |
| `LicenseInfo` | struct | license.rs | License 信息 (类型、功能、过期时间) |
| `LICENSE_INFO` | static | license.rs | Global license state (RwLock) |
| `verify_license` | async fn | license.rs | 验证 License Key 格式和校验和 |
| `get_license` | async fn | license.rs | 获取当前 License 信息 |
| `get_max_connections` | async fn | license.rs | 返回最大连接数 (免费版 3, 付费版 999) |
| `check_connection_limit` | async fn | license.rs | 检查是否超限 |
| `start_api_server_command` | async fn | api.rs | 启动 HTTP API (端口 27149) |
| `stop_api_server` | async fn | api.rs | 停止 API 服务器 |
| `is_api_server_running` | async fn | api.rs | 检查 API 状态 |
| `get_monospace_fonts` | async fn | system.rs | 获取系统等宽字体列表 |

## Tauri Events Architecture

```
前端                              后端
  │──── listen("shell-output-{id}") ───►│  监听事件
  │                                     │
  │◄─── emit("shell-output-{id}", data) │  有数据时推送
  │                                     │
  │──── listen("transfer-progress-{id}")─►│ 监听传输进度
  │                                     │
  │◄─── emit("transfer-progress-{id}") ──│ 每 200ms 推送
  │                                     │
  │◄─── emit("transfer-complete-{id}") ──│ 传输完成
```

## SSH Connection Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     SSH Connection 1 (Shell)                 │
├─────────────────────────────────────────────────────────────┤
│  SESSIONS[id] = SshSession { handle, connection }           │
│  用于: 终端会话、命令执行、系统监控                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     SSH Connection 2 (SFTP)                  │
├─────────────────────────────────────────────────────────────┤
│  SFTP_SESSIONS[id] = SftpSessionState { session }           │
│  用于: 文件传输，独立连接，不阻塞 Shell                       │
└─────────────────────────────────────────────────────────────┘
```

**关键代码 - SFTP 独立连接**：

```rust
async fn create_sftp_connection(connection: &SSHConnection) -> Result<Arc<SftpSession>, String> {
    // 创建全新的 SSH 连接，不复用 SESSIONS
    let mut handle = russh::client::connect(config, &addr_str, SshClientHandler).await?;
    // 认证...
    // 打开 SFTP channel...
}
```

## File Transfer Background Execution

```rust
#[tauri::command]
pub async fn upload_file(...) -> Result<String, String> {
    let sftp = get_sftp_session(&connection_id).await?;  // 独立连接
    let task_id_clone = task_id.clone();

    tokio::spawn(async move {
        // 后台传输
        let mut buffer = vec![0u8; 65536];  // 64KB buffer
        let mut last_progress_update = std::time::Instant::now();

        loop {
            // 读取、写入...
            transferred += n as u64;

            // 每 200ms 发送进度事件
            if last_progress_update.elapsed().as_millis() > 200 {
                let _ = app.emit(&format!("transfer-progress-{}", task_id_clone), ...);
                last_progress_update = std::time::Instant::now();
            }
        }

        // 发送完成事件
        let _ = app.emit(&format!("transfer-complete-{}", task_id_clone), ...);
    });

    Ok(task_id)  // 立即返回，不等待完成
}
```

## Conventions

- **Storage**: All state in `once_cell::Lazy<RwLock<HashMap>>` keyed by connection/shell ID
- **Events**: Shell output pushed via `AppHandle.emit()`, not polled
- **Shell task**: `get_shell` spawns tokio task; `cancel_tx` oneshot controls it
- **Async I/O**: Native async/await with russh, no blocking mode needed
- **Auth priority**: Password first, then key file (key auth TODO)
- **Shell ID format**: `{connection_id}-shell-{timestamp_ms}`
- **Event name format**: `shell-output-{shell_id}`, `transfer-progress-{task_id}`
- **SFTP connection**: Independent SSH connection, not shared with Shell
- **Progress events**: Limited to every 200ms to avoid IPC blocking

## ShellSession Channel Design

```
ShellSession {
    cancel_tx: oneshot::Sender<()>,    // 取消信号
    resize_tx: mpsc::Sender<(u32, u32)>, // resize 命令
    write_tx: mpsc::Sender<Vec<u8>>,   // 数据写入
}
```

## Key Functions

### connect_ssh
- DNS resolution with timeout (10s)
- SSH handshake with timeout (10s)
- Password authentication with timeout (5s)
- Stores `SshSession { handle, connection }` for later SFTP use

### get_shell
- Opens PTY channel
- Spawns tokio task with `tokio::select!` loop
- Emits `shell-output-{shellId}` events to frontend

### upload_file / download_file
- Creates independent SSH connection via `create_sftp_connection`
- Spawns background tokio task
- Returns `task_id` immediately
- Emits progress events every 200ms
- Emits complete event when done

### compress_file
- Uses existing SSH session from SESSIONS
- Executes `tar -czf` command remotely
- Waits for command completion

## Anti-Patterns

- **Don't** hold SESSIONS write lock across async operations
- **Don't** use `#[async_trait]` with russh Handler - use native async fn
- **Don't** forget to send cancel signal before closing shell
- **Don't** call `channel.wait()` without `mut` reference
- **Don't** use `entry.metadata().await` - it returns FileAttributes directly, not a Future
- **Don't** forget to wrap `SftpSession` in `Arc` for cloning between functions
- **Don't** share SSH connection between Shell and SFTP - use independent connections
- **Don't** emit progress events too frequently - limit to every 200ms
- **Don't** use blocking operations in Tauri commands - use `tokio::spawn`