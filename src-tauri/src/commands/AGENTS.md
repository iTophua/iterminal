# Commands Module

Tauri command handlers for SSH operations.

## Structure

```
commands/
├── mod.rs      # Module exports
├── ssh.rs      # SSH connection, shell, command execution (299 lines)
└── sftp.rs     # SFTP operations (placeholder, 43 lines)
```

## Where to Look

| Symbol | Type | Line | Role |
|--------|------|------|------|
| `SESSIONS` | lazy_static | 27 | Global SSH session storage |
| `SHELLS` | lazy_static | 28 | PTY channel per shell |
| `SHELL_OUTPUTS` | lazy_static | 29 | Byte buffer for async reads |
| `RUNNING` | lazy_static | 30 | Thread kill switches |
| `connect_ssh` | fn | 34 | TCP + auth, stores session |
| `get_shell` | fn | 159 | Spawns PTY + reader thread |
| `read_shell` | fn | 277 | Drains output buffer |
| `write_shell` | fn | 238 | Writes to channel (handles EWOULDBLOCK) |
| `disconnect_ssh` | fn | 68 | Stops threads, closes channels, drops session |

## Conventions

- **Storage**: All state in `lazy_static!` HashMaps keyed by connection/shell ID
- **Shell threading**: `get_shell` spawns reader thread; `RUNNING` flag stops it
- **Non-blocking I/O**: `session.set_blocking(false)` after PTY setup
- **Auth priority**: Password first, then key file
- **Shell ID format**: `{connection_id}-shell-{timestamp_ms}`
- **PTY echo**: Enabled via `PtyModeOpcode::ECHO` (line 172)

## Anti-Patterns

- **Don't** hold locks across await points - lock/unlock in scopes only
- **Don't** call `set_blocking(true)` during active shell reads
- **Don't** forget to set `RUNNING=false` before closing shell
- **Don't** modify SFTP code - it's a placeholder
