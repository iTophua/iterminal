# Commands Module

Tauri command handlers for SSH operations.

## Structure

```
commands/
├── mod.rs      # Module exports
├── ssh.rs      # SSH connection, shell, command execution (377 lines)
└── sftp.rs     # SFTP operations (placeholder, ~50 lines)
```

## Where to Look

| 符号 | 类型 | 行号 | 角色 |
|--------|------|------|------|
| `SESSIONS` | lazy_static | 27 | Global SSH session storage |
| `SHELLS` | lazy_static | 28 | PTY channel per shell |
| `RUNNING` | lazy_static | 29 | Thread control flags |
| `SHELL_LOCKS` | lazy_static | 31 | Connection-level locks |
| `connect_ssh` | fn | 35 | TCP + auth, stores session |
| `get_shell` | fn | 161 | Spawns PTY + reader thread with Events |
| `write_shell` | fn | 287 | Writes to channel (handles EWOULDBLOCK) |
| `close_shell` | fn | 340 | Stops thread, closes channel |
| `disconnect_ssh` | fn | 70 | Stops threads, closes all channels |

## Tauri Events Architecture

```
前端                              后端
  │──── listen("shell-output-{id}") ───►│  监听事件
  │                                     │
  │◄─── emit("shell-output-{id}", data) │  有数据时推送
```

**关键代码**：

```rust
// get_shell 中启动 reader thread
let app_handle = app.clone();
std::thread::spawn(move || {
    loop {
        // 读取数据
        let data = channel.read();
        
        // 推送到前端
        let event_name = format!("shell-output-{}", shell_id);
        app_handle.emit(&event_name, data);
    }
});
```

## Conventions

- **Storage**: All state in `lazy_static!` HashMaps keyed by connection/shell ID
- **Events**: Shell output pushed via `AppHandle.emit()`, not polled
- **Shell threading**: `get_shell` spawns reader thread; `RUNNING` flag controls it
- **Non-blocking I/O**: `session.set_blocking(false)` after PTY setup
- **Auth priority**: Password first, then key file
- **Shell ID format**: `{connection_id}-shell-{timestamp_ms}`
- **Event name format**: `shell-output-{shell_id}`

## Session Creation Synchronization

**问题**：同一 Session 上并发创建 Channel 会冲突

**方案**：

```rust
// 1. 获取连接级别锁
let shell_lock = SHELL_LOCKS.lock().unwrap()
    .get(&id).cloned().unwrap_or_else(|| { /* 创建新锁 */ });
let _guard = shell_lock.lock().unwrap();

// 2. 暂停所有 reader thread
for sid in &shell_ids {
    RUNNING.lock().unwrap().insert(sid.clone(), false);
}
std::thread::sleep(Duration::from_millis(50));

// 3. 创建 channel (阻塞模式)
session.set_blocking(true);
let channel = session.channel_session()?;
session.set_blocking(false);

// 4. 恢复 reader thread
for sid in &shell_ids {
    RUNNING.lock().unwrap().insert(sid.clone(), true);
}
```

## Anti-Patterns

- **Don't** hold SESSIONS lock across operations - use scoped locks
- **Don't** call `set_blocking(true)` during active shell reads
- **Don't** forget to set `RUNNING=false` before closing shell
- **Don't** use `SHELL_OUTPUTS` buffer - removed, use Events instead
- **Don't** modify SFTP code - it's a placeholder