# iTerminal MCP Server

MCP Server for iTerminal SSH Connection Manager - Control SSH servers through Claude and other AI assistants.

## Features

- 🔌 **SSH Connection Management** - Create, test, and manage SSH connections
- 💻 **Command Execution** - Execute commands on remote servers
- 📊 **System Monitoring** - Real-time CPU, memory, disk metrics
- 📁 **File Operations** - List directories, create folders, rename/delete files
- 🤖 **AI Integration** - Works with any MCP client (Claude, Cursor, ZCode, OpenCode, ...)
- 🪶 **Bundled with the app** - No npm install, updates follow app releases

## Installation

MCP server 不再发布到 npm，而是**随 iTerminal 桌面应用分发**（位于 app 内
`Contents/Resources/mcp-bundle/`）。接入任意 AI 工具的推荐方式：

1. 打开 iTerminal → 设置 → MCP，点击 **复制安装指令**
2. 把指令粘贴给 AI 工具（对话发送即可），它会自己写入 MCP 配置并启用
3. 重启该 AI 工具的 MCP 会话后生效

指令注册的是稳定启动器 `~/.iterminal/bin/mcp-launcher.mjs`（由 app 启动时自动
刷新指向）：**app 升级或更换安装位置后无需重新注册**，AI 工具下次拉起 MCP
会话即使用新版。

### 手动配置（可选）

如需手动配置，等效条目为（以 macOS 默认安装为例，路径可从安装指令中获取）：

```json
{
  "mcpServers": {
    "iterminal": {
      "type": "stdio",
      "command": "/opt/homebrew/bin/node",
      "args": ["~/.iterminal/bin/mcp-launcher.mjs"]
    }
  }
}
```

> 注意 `args` 中的路径需展开为绝对路径（多数客户端不解析 `~`）。
> OpenCode 等使用 `command` 数组格式的客户端：`"command": ["<node>", "<launcher 绝对路径>"]`。

### Prerequisites

- iTerminal desktop app must be running with the HTTP API enabled on port 27149
- Node.js 18+（launcher 需要；建议 20+）

## Available Tools

| Tool | Description |
|------|-------------|
| `iter_status` | Check iTerminal API service status |
| `iter_connect` | Create SSH connection (idempotent: reuses active connection to same host) |
| `iter_disconnect` | Disconnect SSH connection |
| `iter_test_connection` | Test SSH connection without persisting |
| `iter_list_connections` | List all active SSH connections |
| `iter_exec` | Execute command on remote server (60s, tail-keep truncation at 128KB) |
| `iter_monitor` | Get system metrics (CPU/memory/disk) |
| `iter_list_dir` | List remote directory contents (compact text lines) |
| `iter_mkdir` | Create directory on remote server |
| `iter_rm` | Delete file on remote server |
| `iter_rename` | Rename file or directory |
| `iter_read_file` | Read remote file (default 64KB cap) |
| `iter_write_file` | Write remote file |
| `iter_upload_file` / `iter_upload_folder` | Upload with optional sudo, poll via `iter_transfer_status` |
| `iter_download_file` | Download, poll via `iter_transfer_status` |
| `iter_quick_connect` | Connect saved profile by **name / IP / IP fragment** (e.g. `11.114`) |
| `iter_list_saved_connections` | List saved profiles (compact text) |
| `iter_save_connection` | Save new connection |
| `iter_list_processes` | Top processes by memory (default 20) |
| `iter_kill_process` | Kill process by pid |
| `iter_compress` / `iter_extract` | tar.gz compress / extract |
| `iter_search_files` | Glob search files |

Token 消耗优化：返回统一紧凑序列化，大列表（目录/进程/连接）转紧凑文本行。

## Usage Examples

Once configured with Claude, you can use natural language:

```
"Connect to my production server at 192.168.1.100"
"Check the CPU usage on the connected server"
"List files in /var/log"
"Run 'docker ps' on the server"
"Create a new directory /tmp/myapp"
```

## API Reference

The MCP server connects to iTerminal's local HTTP API at `http://127.0.0.1:27149`.

### Connection Management

```typescript
// Connect
{
  id: "my-server",
  host: "192.168.1.100",
  port: 22,
  username: "root",
  password: "********"
}

// Execute command
{
  id: "my-server",
  command: "docker ps"
}

// Monitor system
{
  id: "my-server"
}
```

### File Operations

```typescript
// List directory
{
  id: "my-server",
  path: "/var/log"
}

// Create directory
{
  id: "my-server",
  path: "/tmp/newdir"
}

// Rename
{
  id: "my-server",
  old_path: "/tmp/old.txt",
  new_path: "/tmp/new.txt"
}
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode
npm run dev

# Run locally
node dist/index.js
```

## Architecture

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Claude/AI     │─────►│  MCP Server     │─────►│ iTerminal API   │
│                 │ MCP  │  (this package) │ HTTP │  (port 27149)   │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                                          │
                                                          │ SSH
                                                          ▼
                                                  ┌─────────────────┐
                                                  │  Remote Server  │
                                                  └─────────────────┘
```

## Related

- [iTerminal](https://github.com/iTophua/iterminal) - Main desktop application
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP specification

## License

MIT