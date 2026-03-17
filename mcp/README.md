# iTerminal MCP Server

MCP Server for iTerminal SSH Connection Manager - Control SSH servers through Claude and other AI assistants.

## Features

- 🔌 **SSH Connection Management** - Create, test, and manage SSH connections
- 💻 **Command Execution** - Execute commands on remote servers
- 📊 **System Monitoring** - Real-time CPU, memory, disk metrics
- 📁 **File Operations** - List directories, create folders, rename/delete files
- 🤖 **AI Integration** - Works with Claude Desktop and other MCP clients

## Installation

### Via npx (Recommended)

```bash
npx iterminal-mcp-server
```

### Via npm

```bash
npm install -g iterminal-mcp-server
iterminal-mcp
```

## Configuration

### OpenCode (推荐)

OpenCode 是一款强大的 AI 编程助手，支持 MCP 协议。配置步骤：

1. 打开配置文件 `~/.config/opencode/opencode.jsonc`
2. 在 `mcp` 字段中添加 iTerminal 配置：

```json
{
  "mcp": {
    "iterminal": {
      "type": "local",
      "command": ["npx", "iterminal-mcp-server"],
      "enabled": true
    }
  }
}
```

3. 重启 OpenCode 生效

**配置说明：**

| 字段 | 说明 |
|------|------|
| `type` | 固定为 `"local"`，表示本地 MCP 服务器 |
| `command` | 启动命令，使用 npx 直接运行 npm 包 |
| `enabled` | 是否启用该 MCP 服务器 |

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "iterminal": {
      "command": "npx",
      "args": ["iterminal-mcp-server"]
    }
  }
}
```

### Cursor / Windsurf

在 AI 设置中添加 MCP 服务器：

```json
{
  "mcpServers": {
    "iterminal": {
      "command": "npx",
      "args": ["iterminal-mcp-server"]
    }
  }
}
```

### Prerequisites

- iTerminal desktop app must be running with the HTTP API enabled on port 27149
- Node.js 18+ (for npx)
- SSH credentials for your servers

## Available Tools

| Tool | Description |
|------|-------------|
| `iter_status` | Check iTerminal API service status |
| `iter_connect` | Create SSH connection |
| `iter_disconnect` | Disconnect SSH connection |
| `iter_test_connection` | Test SSH connection without persisting |
| `iter_list_connections` | List all active SSH connections |
| `iter_exec` | Execute command on remote server |
| `iter_monitor` | Get system metrics (CPU/memory/disk) |
| `iter_list_dir` | List remote directory contents |
| `iter_mkdir` | Create directory on remote server |
| `iter_rm` | Delete file on remote server |
| `iter_rename` | Rename file or directory |

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