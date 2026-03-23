# iTerminal - SSH Connection Manager

**Generated:** 2026-03-22
**Branch:** main

**技术栈:** Tauri 2.10 + React 19.2 + TypeScript 5.9 + Vite 7.3 + Ant Design 6.3 + xterm.js 6.0 + Rust (russh 0.50 + russh-sftp 2.1)

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
├─────────────────────────────────────────────────────────────┤
│  Terminal.tsx (主窗口)                                       │
│  ├─ listen("shell-output-{id}") ──────► 监听 shell 输出事件   │
│  └─ invoke('write_shell') ────────────► 发送用户输入          │
├─────────────────────────────────────────────────────────────┤
│  TerminalWindow.tsx (新窗口)                                 │
│  ├─ listen("terminal-window-init") ───► 监听初始化事件        │
│  ├─ restoreConnection() ──────────────► 恢复连接到 store      │
│  └─ 渲染 <Terminal /> ───────────────── 复用主窗口组件         │
├─────────────────────────────────────────────────────────────┤
│  FileManagerPanel.tsx                                       │
│  ├─ listen("transfer-progress-{id}") ──► 监听传输进度         │
│  └─ listen("transfer-complete-{id}") ──► 监听传输完成         │
├─────────────────────────────────────────────────────────────┤
│  terminalStore (Zustand)                                    │
│  ├─ connectedConnections: ConnectedConnection[]             │
│  │   └─ rootPane: SplitPane (支持嵌套分屏)                   │
│  ├─ restoreConnection() ──────────────► 恢复连接（新窗口）    │
│  └─ activeConnectionId: string                              │
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
│  create_terminal_window                                      │
│  ├─ 创建新 WebviewWindow                                     │
│  └─ emit("terminal-window-init", data) ──► 发送初始化数据    │
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
│   ├── App.tsx                 # 路由 + 布局（含 /terminal-window 路由）
│   ├── components/             # 公共组件
│   │   ├── Sidebar.tsx         # 侧边栏 (分组导航 + 终端入口)
│   │   ├── FileManagerPanel.tsx # 文件管理面板 (主组件)
│   │   └── fileManager/        # 文件管理子模块
│   │       ├── types.ts        # 类型定义
│   │       ├── utils.ts        # 工具函数
│   │       ├── Modals.tsx      # Modal 组件
│   │       ├── ContextMenu.tsx # 右键菜单
│   │       ├── FileList.tsx    # 文件列表
│   │       └── hooks/          # 自定义 hooks
│   │           ├── useFileManager.ts     # 核心状态
│   │           ├── useFileOperations.ts  # 文件操作
│   │           ├── useTransfer.ts        # 上传下载
│   │           └── useDragDrop.ts        # 拖拽处理
│   ├── pages/                  # 页面组件
│   │   ├── Terminal.tsx        # 终端页面 (主窗口 + 新窗口共用)
│   │   ├── TerminalWindow.tsx  # 新窗口入口（监听 event + 复用 Terminal）
│   │   ├── terminal/           # 终端相关子模块
│   │   │   ├── components/     # 终端组件（PaneToolbar, ContextMenu 等）
│   │   │   └── hooks/          # 终端 hooks（useConnectionDrag 等）
│   │   ├── Connections.tsx     # 连接管理 (CRUD + 测试连接)
│   │   └── Transfers.tsx       # 传输管理
│   ├── stores/                 # Zustand 状态管理
│   │   ├── terminalStore.ts    # 连接/会话状态（含 restoreConnection）
│   │   └── transferStore.ts    # 传输记录/进度状态
│   ├── utils/                  # 工具函数
│   │   └── paneUtils.ts        # SplitPane 辅助函数
│   └── styles/                 # 全局 CSS
│       └── global.css          # xterm.js 样式覆盖
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 入口，注册命令
│   │   ├── lib.rs              # 模块声明
│   │   └── commands/           # Tauri 命令
│   │       ├── ssh.rs          # SSH 操作 (async + Events)
│   │       ├── sftp.rs         # SFTP 文件传输 (russh-sftp)
│   │       ├── window.rs       # 新窗口创建命令
│   │       ├── license.rs      # License 验证 (存根/Pro)
│   │       ├── api.rs          # HTTP API 服务器 (axum)
│   │       └── system.rs       # 系统信息 (字体等)
│   │   └── db/                 # 数据库 (SQLite + 加密存储)
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置
│   └── icons/                  # 应用图标
├── mcp/                        # MCP 服务器 (独立 npm 包)
│   └── src/index.ts            # MCP 工具定义 (iter_*)
├── docs/                       # 项目文档
│   ├── 优化实施计划.md         # 优化进度跟踪
│   ├── 新窗口功能实施方案.md   # 新窗口功能文档
│   └── 组件拆分进度.md         # 组件拆分状态
├── package.json                # npm 依赖
├── vite.config.ts              # Vite 配置 (端口 1430)
└── tsconfig.json               # TypeScript 配置 (strict 模式)
```

## 查找指南

| 任务 | 位置 | 说明 |
|------|------|------|
| 添加新 SSH 功能 | `src-tauri/src/commands/ssh.rs` | 核心 SSH 逻辑 (russh async API) |
| 添加新 SFTP 功能 | `src-tauri/src/commands/sftp.rs` | 文件传输逻辑 |
| 新窗口功能 | `src-tauri/src/commands/window.rs` | 创建新窗口 Tauri 命令 |
| 数据库操作 | `src-tauri/src/commands/db.rs` | 连接 CRUD、加密存储 |
| 数据库服务层 | `src/services/database.ts` | 前端数据库服务封装 |
| License 验证 | `src-tauri/src/commands/license.rs` | 存根版本，Pro 版在私有仓库 |
| HTTP API 服务器 | `src-tauri/src/commands/api.rs` | MCP 桥接 API (axum, 端口 27149) |
| 修改终端事件监听 | `src/pages/Terminal.tsx` | Events 订阅/取消订阅 |
| 修改新窗口逻辑 | `src/pages/TerminalWindow.tsx` | Event 监听 + restoreConnection |
| 拖拽到新窗口检测 | `src/pages/terminal/hooks/useConnectionDrag.ts` | 边缘检测 hook |
| 新窗口视觉提示 | `src/pages/terminal/components/DragToNewWindowOverlay.tsx` | 拖拽提示组件 |
| 修改文件管理 UI | `src/components/FileManagerPanel.tsx` | 文件树、上传下载，使用 hooks 拆分逻辑 |
| 修改传输状态 | `src/stores/transferStore.ts` | 传输记录、进度 |
| 修改状态管理 | `src/stores/terminalStore.ts` | 连接/会话状态、restoreConnection |
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
| `connect_ssh` | async fn | `ssh.rs` | SSH 连接 (10s 超时) + License 检查，支持密码/密钥认证 |
| `test_connection` | async fn | `ssh.rs` | 测试连接，支持密码/密钥认证 |
| `get_shell` | async fn | `ssh.rs` | 创建 PTY + tokio::spawn 任务 |
| `write_shell` | async fn | `ssh.rs` | 通过 mpsc channel 写入 |
| `resize_shell` | async fn | `ssh.rs` | 通过 mpsc channel resize |
| `disconnect_ssh` | async fn | `ssh.rs` | 断开连接 |
| `execute_command` | async fn | `ssh.rs` | 执行远程命令 |
| `get_system_monitor` | async fn | `ssh.rs` | 获取系统监控数据 |
| `get_network_stats` | async fn | `ssh.rs` | 获取网络接口统计 |
| `list_processes` | async fn | `ssh.rs` | 列出进程列表 |
| `kill_process` | async fn | `ssh.rs` | 终止进程 |
| `SftpSessionState` | struct | `sftp.rs` | SFTP 会话 (Arc<SftpSession>) |
| `create_sftp_connection` | async fn | `sftp.rs` | 创建独立 SFTP 连接 |
| `upload_file` | async fn | `sftp.rs` | 后台上传 (tokio::spawn) |
| `download_file` | async fn | `sftp.rs` | 后台下载 (tokio::spawn) |
| `compress_file` | async fn | `sftp.rs` | 远程压缩 (tar -czf) |
| `extract_file` | async fn | `sftp.rs` | 远程解压 (tar/unzip) |
| `search_files` | async fn | `sftp.rs` | 文件搜索 (find 命令) |
| `read_file_content` | async fn | `sftp.rs` | 文件预览 |
| `write_file_content` | async fn | `sftp.rs` | 文件编辑 |
| `pause_transfer` | async fn | `sftp.rs` | 暂停传输 |
| `resume_transfer` | async fn | `sftp.rs` | 恢复传输 |
| `list_directory` | async fn | `sftp.rs` | 列出目录内容 |
| `create_terminal_window` | async fn | `window.rs` | 创建新窗口 + 发送初始化事件 |
| `close_terminal_window` | async fn | `window.rs` | 关闭新窗口 |
| `LicenseType` | enum | `license.rs` | Free/Personal/Professional/Enterprise |
| `LicenseInfo` | struct | `license.rs` | License 信息 (类型、功能、连接数限制) |
| `verify_license` | async fn | `license.rs` | 验证 License Key |
| `get_max_connections` | async fn | `license.rs` | 获取最大连接数 (免费版 3) |
| `start_api_server_command` | async fn | `api.rs` | 启动 HTTP API 服务器 (端口 27149) |
| `init_database` | async fn | `db.rs` | 初始化 SQLite 数据库 |
| `get_connections` | async fn | `db.rs` | 获取所有连接 |
| `save_connection` | async fn | `db.rs` | 保存连接 (密码加密) |
| `delete_connection` | async fn | `db.rs` | 删除连接 |
| `export_connections` | async fn | `db.rs` | 导出连接 (JSON) |
| `import_connections` | async fn | `db.rs` | 导入连接 |
| `encrypt_password` | fn | `db/crypto.rs` | AES-256-GCM 加密 |
| `decrypt_password` | fn | `db/crypto.rs` | AES-256-GCM 解密 |
| `useLicenseStore` | hook | `licenseStore.ts` | License 状态管理 (Zustand) |
| `useTerminalStore` | hook | `terminalStore.ts` | 连接/会话状态 (Zustand) |
| `useTransferStore` | hook | `transferStore.ts` | 传输状态 (Zustand) |
| `SplitPane` | interface | `terminalStore.ts` | 分屏数据结构（支持嵌套） |
| `splitPane` | fn | `terminalStore.ts` | 创建分屏 |
| `closePane` | fn | `terminalStore.ts` | 关闭分屏 |
| `restoreConnection` | fn | `terminalStore.ts` | 恢复连接（新窗口） |
| `updateSessionShellId` | fn | `terminalStore.ts` | 更新会话 shellId |
| `getAllSessions` | fn | `paneUtils.ts` | 获取 pane 中所有会话 |
| `findPaneBySessionId` | fn | `paneUtils.ts` | 根据会话 ID 查找 pane |
| `useConnectionDragToNewWindow` | hook | `useConnectionDrag.ts` | 拖拽到边缘检测 |

## 核心设计

### 1. Tauri Events 实时通信

**前端监听** → **后端推送**，避免轮询。

| 事件类型 | 格式 | 用途 |
|----------|------|------|
| Shell 输出 | `shell-output-{shellId}` | 终端数据推送 |
| 传输进度 | `transfer-progress-{taskId}` | 文件传输进度 |
| 传输完成 | `transfer-complete-{taskId}` | 传输结束通知 |
| 新窗口初始化 | `terminal-window-init` | 新窗口连接数据传递 |

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

### 4. 多连接多会话管理（SplitPane 模型）

**数据结构**:
```
connectedConnections: [
  {
    connectionId: "conn-1",
    connection: Connection,
    rootPane: SplitPane {
      id: "pane-1",
      sessions: [
        { id: "sess-1", shellId: "shell-1", title: "会话1" },
        { id: "sess-2", shellId: "shell-2", title: "会话2" }
      ],
      activeSessionId: "sess-1",
      // 分屏后:
      splitDirection: "horizontal",
      children: [
        { id: "pane-1", sessions: [...] },
        { id: "pane-2", sessions: [...] }
      ],
      sizes: [50, 50]
    }
  }
]
```

**SplitPane 特性**:
- 支持递归嵌套分屏
- 每个 pane 可包含多个 sessions（共享标签栏）
- 每个 pane 独立管理 activeSessionId
- 使用 `react-resizable-panels` 实现可调整大小的分屏
- 每个 pane 有独立的 Tabs 组件显示该 pane 的 sessions
- 关闭 pane 最后一个 session 时自动关闭整个 pane

**会话标签架构**:
```
连接 Tab（顶层）
└── 分屏区域
    ├── 左 pane
    │   └── Tabs: [会话1, 会话2, +新建]
    └── 右 pane
        └── Tabs: [会话3, +新建]
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
- 连接数据通过 `src/services/database.ts` 存储到后端 SQLite
- 样式内联，主题色 `#00b96b`，背景 `#1E1E1E`
- TypeScript strict 模式

**后端 (Rust + russh):**
- SSH 会话存储在 `once_cell::Lazy` 的 `tokio::RwLock<HashMap>`
- Shell 数据使用 `tokio::select!` 同时处理多个事件
- 文件传输使用 `tokio::spawn` 后台执行
- SFTP 使用独立 SSH 连接
- 所有 Tauri 命令支持 async

## 反模式

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
- **不要**为新窗口创建独立的简化版组件 - 复用 `Terminal.tsx`
- **不要**在新窗口中重新实现终端逻辑 - 使用 `restoreConnection()` 共享 store

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

# 前端测试
npm run test:run

# 后端测试
cd src-tauri && cargo test --lib

# E2E 测试
npm run test:e2e
```

## 注意事项

- 开发端口固定 1430（`vite.config.ts`）
- MCP API 端口 27149（`api.rs`）
- SFTP 使用独立 SSH 连接，不阻塞终端
- 文件传输在后台执行，通过 Events 通知前端
- 连接数据存储在后端 SQLite，密码使用 AES-256-GCM 加密
- Shell 输出通过 Events 推送，事件名格式 `shell-output-{shellId}`
- 关闭会话时需调用 `unlisten()` 取消事件订阅
- 无 CI/CD 配置（无 .github 目录）
- 测试覆盖: 前端 101 tests, 后端 38 tests, E2E 18 tests
- russh 使用原生 async/await，需要 Rust 1.75+
- License 系统: 免费版 3 连接限制，付费版无限连接
- 商业版构建: `../iterminal-pro/scripts/build-pro.sh` (从私有仓库复制代码后构建)
- MCP 已发布到 npm: `iterminal-mcp-server@1.0.4`

## 新窗口功能

**拖拽连接到边缘创建新窗口**：
- 拖拽连接 tab 到窗口边缘 60px 区域触发
- 显示绿色边框视觉提示
- 释放后创建新窗口，包含完整终端功能

**新窗口架构**：
```
TerminalWindow.tsx
    └── 解析 URL 获取 windowLabel
    └── 调用 get_terminal_window_data 获取连接数据
    └── 连接 SSH + 获取新 shellId
    └── restoreConnection() 到 store
    └── 渲染 <Terminal singleConnectionMode /> 复用主窗口组件
```

**新窗口特性**：
- 复用主窗口 Terminal 组件，功能完全一致
- 全屏按钮在右侧工具栏顶部
- 关闭最后一个会话后自动关闭窗口
- 不显示空状态页面

**主窗口空状态**：
- 显示最近 5 个连接，点击直接连接
- 显示「连接管理」按钮跳转到连接页面

**权限配置** (`capabilities/default.json`)：
- `windows: ["*"]` 允许所有窗口（包括新窗口）访问权限
- `core:event:allow-listen` 允许事件监听
- `core:window:allow-close` 允许关闭窗口

## 安全注意事项

- **主机密钥验证已跳过** - `check_server_key` 无条件返回 true
- 生产环境应实现 known_hosts 验证或让用户确认新主机
- **认证方式**：支持密码认证和 SSH 密钥认证
  - 密码：AES-256-GCM 加密存储
  - 密钥：支持 OpenSSH 和 PEM 格式私钥文件
  - 密钥路径支持 `~` 展开（如 `~/.ssh/id_rsa`）