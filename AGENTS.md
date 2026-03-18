# iTerminal - SSH Connection Manager

**Generated:** 2026-03-18
**Commit:** 5267740
**Branch:** main

**技术栈:** Tauri 2.10 + React 19.2 + TypeScript 5.9 + Vite 7.3 + Ant Design 6.3 + xterm.js 5.3 + Rust (russh 0.50 + russh-sftp 2.1)

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
├─────────────────────────────────────────────────────────────┤
│  Terminal.tsx                                               │
│  ├─ listen("shell-output-{id}") ──────► 监听 shell 输出事件   │
│  └─ invoke('write_shell') ────────────► 发送用户输入          │
├─────────────────────────────────────────────────────────────┤
│  FileManagerPanel.tsx                                       │
│  ├─ listen("transfer-progress-{id}") ──► 监听传输进度         │
│  └─ listen("transfer-complete-{id}") ──► 监听传输完成         │
├─────────────────────────────────────────────────────────────┤
│  terminalStore (Zustand)                                    │
│  ├─ connectedConnections: Connection[]                      │
│  └─ activeSessionId: string                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Tauri IPC / Events
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     后端 (Rust + russh)                      │
├─────────────────────────────────────────────────────────────┤
│  get_shell(id, AppHandle)                                   │
│  ├─ 创建 SSH channel (async)                                │
│  └─ tokio::spawn reader task                                │
│       └─ tokio::select! { resize, write, wait() }           │
│       └─ emit("shell-output-{id}", data) ──► 推送到前端      │
├─────────────────────────────────────────────────────────────┤
│  upload_file / download_file                                │
│  ├─ 创建独立 SSH 连接 (不阻塞 Shell)                         │
│  └─ tokio::spawn 后台传输任务                                │
│       └─ 每 200ms emit("transfer-progress-{id}")            │
│       └─ emit("transfer-complete-{id}") 完成通知             │
├─────────────────────────────────────────────────────────────┤
│  全局状态 (once_cell::Lazy + tokio::RwLock)                  │
│  ├─ SESSIONS: HashMap<id, SshSession>                       │
│  ├─ SHELLS: HashMap<id, ShellSession>                       │
│  └─ SFTP_SESSIONS: HashMap<id, SftpSessionState>            │
└─────────────────────────────────────────────────────────────┘
```

## SSH 连接架构

```
┌─────────────────────────────────────────────────────────────┐
│                     SSH Connection 1 (Shell)                 │
├─────────────────────────────────────────────────────────────┤
│  用于终端会话、命令执行、系统监控                              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     SSH Connection 2 (SFTP)                  │
├─────────────────────────────────────────────────────────────┤
│  用于文件传输，独立连接，不阻塞 Shell                         │
└─────────────────────────────────────────────────────────────┘
```

**设计决策**: SFTP 使用独立 SSH 连接，确保文件传输时终端保持响应。

## 结构

```
.
├── src/                        # React 前端
│   ├── main.tsx                # 入口，ConfigProvider 配置
│   ├── App.tsx                 # 路由 + 布局
│   ├── components/             # 公共组件
│   │   ├── Sidebar.tsx         # 侧边栏 (分组导航 + 终端入口)
│   │   └── FileManagerPanel.tsx # 文件管理面板
│   ├── pages/                  # 页面组件
│   │   ├── Terminal.tsx        # 终端页面 (Events 监听)
│   │   ├── Connections.tsx     # 连接管理 (CRUD + 测试连接)
│   │   └── Transfers.tsx       # 传输管理
│   ├── stores/                 # Zustand 状态管理
│   │   ├── terminalStore.ts    # 连接/会话状态
│   │   └── transferStore.ts    # 传输记录/进度状态
│   ├── utils/                  # 工具函数
│   └── styles/                 # 全局 CSS
│       └── global.css          # xterm.js 样式覆盖
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 入口，注册命令
│   │   ├── lib.rs              # 模块声明
│   │   └── commands/           # Tauri 命令
│   │       ├── ssh.rs          # SSH 操作 (async + Events)
│   │       ├── sftp.rs         # SFTP 文件传输 (russh-sftp)
│   │       ├── license.rs      # License 验证 (存根/Pro)
│   │       ├── api.rs          # HTTP API 服务器 (axum)
│   │       └── system.rs       # 系统信息 (字体等)
│   │   └── db/                 # 数据库 (未完成)
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置
│   └── icons/                  # 应用图标
├── mcp/                        # MCP 服务器 (独立 npm 包)
│   └── src/index.ts            # MCP 工具定义 (iter_*)
├── package.json                # npm 依赖
├── vite.config.ts              # Vite 配置 (端口 1430)
└── tsconfig.json               # TypeScript 配置 (strict 模式)
```

## 查找指南

| 任务 | 位置 | 说明 |
|------|------|------|
| 添加新 SSH 功能 | `src-tauri/src/commands/ssh.rs` | 核心 SSH 逻辑 (russh async API) |
| 添加新 SFTP 功能 | `src-tauri/src/commands/sftp.rs` | 文件传输逻辑 |
| License 验证 | `src-tauri/src/commands/license.rs` | 存根版本，Pro 版在私有仓库 |
| HTTP API 服务器 | `src-tauri/src/commands/api.rs` | MCP 桥接 API (axum, 端口 27149) |
| 修改终端事件监听 | `src/pages/Terminal.tsx` | Events 订阅/取消订阅 |
| 修改文件管理 UI | `src/components/FileManagerPanel.tsx` | 文件树、上传下载 |
| 修改传输状态 | `src/stores/transferStore.ts` | 传输记录、进度 |
| 修改状态管理 | `src/stores/terminalStore.ts` | 连接/会话状态 |
| License 状态 | `src/stores/licenseStore.ts` | License 验证状态 (Zustand) |
| 添加新页面 | `src/pages/` | 创建组件 + 在 App.tsx 添加路由 |
| 修改终端样式 | `src/styles/global.css` | xterm.js CSS 覆盖 |
| 添加 Tauri 命令 | `src-tauri/src/commands/` + `main.rs` | 创建命令 + 注册 |
| MCP 工具定义 | `mcp/src/index.ts` | iter_* 工具 (iter_connect, iter_exec 等) |

## 代码映射

| 符号 | 类型 | 文件 | 角色 |
|------|------|------|------|
| `SshClientHandler` | struct | `ssh.rs` | russh Handler 实现 |
| `SshSession` | struct | `ssh.rs` | SSH 连接 (Handle + Connection 凭据) |
| `ShellSession` | struct | `ssh.rs` | Shell 会话 (cancel_tx, resize_tx, write_tx) |
| `SESSIONS` | static | `ssh.rs` | Global SSH session storage |
| `SHELLS` | static | `ssh.rs` | Shell session storage |
| `connect_ssh` | async fn | `ssh.rs` | SSH 连接 (10s 超时) + License 检查 |
| `get_shell` | async fn | `ssh.rs` | 创建 PTY + tokio::spawn 任务 |
| `write_shell` | async fn | `ssh.rs` | 通过 mpsc channel 写入 |
| `resize_shell` | async fn | `ssh.rs` | 通过 mpsc channel resize |
| `disconnect_ssh` | async fn | `ssh.rs` | 断开连接 |
| `execute_command` | async fn | `ssh.rs` | 执行远程命令 |
| `SftpSessionState` | struct | `sftp.rs` | SFTP 会话 (Arc<SftpSession>) |
| `create_sftp_connection` | async fn | `sftp.rs` | 创建独立 SFTP 连接 |
| `upload_file` | async fn | `sftp.rs` | 后台上传 (tokio::spawn) |
| `download_file` | async fn | `sftp.rs` | 后台下载 (tokio::spawn) |
| `compress_file` | async fn | `sftp.rs` | 远程压缩 (tar -czf) |
| `list_directory` | async fn | `sftp.rs` | 列出目录内容 |
| `LicenseType` | enum | `license.rs` | Free/Personal/Professional/Enterprise |
| `LicenseInfo` | struct | `license.rs` | License 信息 (类型、功能、连接数限制) |
| `verify_license` | async fn | `license.rs` | 验证 License Key |
| `get_max_connections` | async fn | `license.rs` | 获取最大连接数 (免费版 3) |
| `start_api_server_command` | async fn | `api.rs` | 启动 HTTP API 服务器 (端口 27149) |
| `useLicenseStore` | hook | `licenseStore.ts` | License 状态管理 (Zustand) |
| `useTerminalStore` | hook | `terminalStore.ts` | 连接/会话状态 (Zustand) |
| `useTransferStore` | hook | `transferStore.ts` | 传输状态 (Zustand) |

## 核心设计

### 1. Tauri Events 实时通信

**前端监听** → **后端推送**，避免轮询。

| 事件类型 | 格式 | 用途 |
|----------|------|------|
| Shell 输出 | `shell-output-{shellId}` | 终端数据推送 |
| 传输进度 | `transfer-progress-{taskId}` | 文件传输进度 |
| 传输完成 | `transfer-complete-{taskId}` | 传输结束通知 |

### 2. russh Async 架构

**优势**：
- 原生 async/await，无需用线程模拟
- `Handle` 可 clone，避免锁竞争
- `tokio::select!` 同时处理 resize、写入、读取

**关键代码**：

```rust
tokio::spawn(async move {
    loop {
        tokio::select! {
            _ = &mut cancel_rx => break,
            Some((cols, rows)) = resize_rx.recv() => {
                channel.window_change(cols, rows, 0, 0).await
            }
            Some(data) = write_rx.recv() => {
                channel.data(&data[..]).await
            }
            msg = channel.wait() => {
                // 推送到前端
            }
        }
    }
});
```

### 3. 文件传输后台执行

**设计原则**: 文件传输不阻塞 UI 和终端。

```rust
#[tauri::command]
pub async fn upload_file(...) -> Result<String, String> {
    let sftp = get_sftp_session(&connection_id).await?;  // 独立连接
    let task_id_clone = task_id.clone();
    
    tokio::spawn(async move {
        // 后台传输
        // 每 200ms 发送进度事件
        // 完成时发送 complete 事件
    });
    
    Ok(task_id)  // 立即返回，不等待完成
}
```

**进度事件优化**:
- 缓冲区: 64KB
- 进度事件频率: 每 200ms 一次（避免 IPC 阻塞）

### 4. 多连接多会话管理

```
connectedConnections: [
  {
    connectionId: "conn-1",
    connection: Connection,
    sessions: [
      { id: "sess-1", shellId: "shell-1", title: "会话1" },
      { id: "sess-2", shellId: "shell-2", title: "会话2" }
    ],
    activeSessionId: "sess-1"
  }
]
```

### 5. ShellSession 通道设计

```
ShellSession {
    cancel_tx: oneshot::Sender<()>,    // 取消信号
    resize_tx: mpsc::Sender<(u32, u32)>, // resize 命令
    write_tx: mpsc::Sender<Vec<u8>>,   // 数据写入
}
```

### 6. 导航架构

**URL 查询参数传递分组**:
- `/connections` - 全部分组
- `/connections?group=生产环境` - 指定分组

**原因**: 避免 `location.state` 在相同 URL 下不触发重新渲染的问题。

## 约定

**前端 (React/TypeScript):**
- 组件使用函数式组件 + hooks
- 状态管理使用 Zustand
- 连接数据持久化使用 localStorage
- 样式内联，主题色 `#00b96b`，背景 `#1E1E1E`
- TypeScript strict 模式

**后端 (Rust + russh):**
- SSH 会话存储在 `once_cell::Lazy` 的 `tokio::RwLock<HashMap>`
- Shell 数据使用 `tokio::select!` 同时处理多个事件
- 文件传输使用 `tokio::spawn` 后台执行
- SFTP 使用独立 SSH 连接
- 所有 Tauri 命令支持 async

## 反模式

- **不要**在 `src-tauri/src/db/` 添加代码 - 模块未完成
- **不要**使用轮询方式读取 shell 输出 - 使用 Events
- **不要**修改 xterm.js 内部样式 - 用 `src/styles/global.css` 覆盖
- **不要**在同步上下文中直接调用 russh async API - 使用 `tokio::spawn`
- **不要**在 `get_shell` 中忘记处理 resize 和写入事件
- **不要**使用 `entry.metadata().await` - russh-sftp 直接返回 FileAttributes
- **不要**使用 `location.state` 传递分组 - 使用 URL 查询参数
- **不要**频繁发送进度事件 - 限制在每 200ms 一次
- **不要**在公开仓库修改 `license.rs` 的 `SECRET_KEY` - Pro 版在私有仓库
- **不要**跳过 License 连接数检查 - 免费版限制 3 个连接
- **不要**直接构建商业版 - 使用 `../iterminal-pro/scripts/build-pro.sh`

## 命令

```bash
# 开发
npm run dev

# 构建
npm run build

# Tauri 开发
npm run tauri dev

# Tauri 构建
npm run tauri build
```

## 注意事项

- 开发端口固定 1430（`vite.config.ts`）
- MCP API 端口 27149（`api.rs`）
- SFTP 使用独立 SSH 连接，不阻塞终端
- 文件传输在后台执行，通过 Events 通知前端
- 连接数据存储在 `localStorage` key `iterminal_connections`
- Shell 输出通过 Events 推送，事件名格式 `shell-output-{shellId}`
- 关闭会话时需调用 `unlisten()` 取消事件订阅
- 无 CI/CD 配置（无 .github 目录）
- 测试框架: Vitest + @testing-library/react（测试覆盖低，仅 themeStore 有完整测试）
- russh 使用原生 async/await，需要 Rust 1.75+
- License 系统: 免费版 3 连接限制，付费版无限连接
- 商业版构建: `../iterminal-pro/scripts/build-pro.sh` (从私有仓库复制代码后构建)
- MCP 已发布到 npm: `iterminal-mcp-server@1.0.4`

## 安全注意事项

- **主机密钥验证已跳过** - `check_server_key` 无条件返回 true
- 生产环境应实现 known_hosts 验证或让用户确认新主机
- 密钥认证功能尚未实现