# iTerminal - SSH Connection Manager

**Generated:** 2026-03-13
**Commit:** 8fbd6ce
**Branch:** main

**技术栈:** Tauri 2.10 + React 19.2 + TypeScript 5.9 + Vite 7.3 + Ant Design 6.3 + xterm.js 5.3 + Rust (ssh2 0.9)

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React)                          │
├─────────────────────────────────────────────────────────────┤
│  Terminal.tsx                                               │
│  ├─ listen("shell-output-{id}") ──────► 监听 shell 输出事件   │
│  └─ invoke('write_shell') ────────────► 发送用户输入          │
├─────────────────────────────────────────────────────────────┤
│  terminalStore (Zustand)                                    │
│  ├─ connectedConnections: Connection[]                      │
│  └─ activeSessionId: string                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Tauri IPC / Events
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        后端 (Rust)                           │
├─────────────────────────────────────────────────────────────┤
│  get_shell(id, AppHandle)                                   │
│  ├─ 创建 SSH channel                                        │
│  └─ spawn reader thread                                     │
│       └─ emit("shell-output-{id}", data) ──► 推送到前端      │
├─────────────────────────────────────────────────────────────┤
│  全局状态 (lazy_static)                                     │
│  ├─ SESSIONS: HashMap<id, Session>                          │
│  ├─ SHELLS: HashMap<id, Channel>                            │
│  └─ RUNNING: HashMap<id, bool>                              │
└─────────────────────────────────────────────────────────────┘
```

## 结构

```
.
├── src/                        # React 前端
│   ├── main.tsx                # 入口，ConfigProvider 配置
│   ├── App.tsx                 # 路由 + 布局
│   ├── components/             # 公共组件
│   │   └── Sidebar.tsx         # 侧边栏 (分组导航 + 终端入口)
│   ├── pages/                  # 页面组件
│   │   ├── Terminal.tsx        # 终端页面 (Events 监听)
│   │   ├── Connections.tsx     # 连接管理 (CRUD + 测试连接)
│   │   └── FileManager.tsx     # 文件管理 (占位)
│   ├── stores/                 # Zustand 状态管理
│   │   └── terminalStore.ts    # 连接/会话/文件管理/传输状态
│   ├── utils/                  # 工具函数
│   └── styles/                 # 全局 CSS
│       └── global.css          # xterm.js 样式覆盖
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 入口，注册命令
│   │   ├── lib.rs              # 模块声明
│   │   ├── commands/           # Tauri 命令
│   │   │   ├── ssh.rs          # SSH 操作 (Events 推送)
│   │   │   └── sftp.rs         # SFTP (占位)
│   │   └── db/                 # 数据库 (未完成)
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置
│   └── icons/                  # 应用图标
├── package.json                # npm 依赖
├── vite.config.ts              # Vite 配置 (端口 1430)
└── tsconfig.json               # TypeScript 配置 (strict 模式)
```

## 查找指南

| 任务 | 位置 | 说明 |
|------|------|------|
| 添加新 SSH 功能 | `src-tauri/src/commands/ssh.rs` | 核心 SSH 逻辑 |
| 修改终端事件监听 | `src/pages/Terminal.tsx` | Events 订阅/取消订阅 |
| 修改状态管理 | `src/stores/terminalStore.ts` | 连接/会话/文件管理/传输状态 |
| 添加新页面 | `src/pages/` | 创建组件 + 在 App.tsx 添加路由 |
| 修改终端样式 | `src/styles/global.css` | xterm.js CSS 覆盖 |
| 添加 Tauri 命令 | `src-tauri/src/commands/` + `main.rs` | 创建命令 + 注册 |

## 代码映射

| 符号 | 类型 | 位置 | 角色 |
|------|------|------|------|
| `get_shell` | fn | `src-tauri/src/commands/ssh.rs:161` | 创建 PTY shell + 启动 Events 推送 |
| `write_shell` | fn | `src-tauri/src/commands/ssh.rs:287` | 写入 shell 输入 |
| `connect_ssh` | fn | `src-tauri/src/commands/ssh.rs:35` | SSH 连接 |
| `disconnect_ssh` | fn | `src-tauri/src/commands/ssh.rs:70` | 断开连接 |
| `Terminal` | 组件 | `src/pages/Terminal.tsx:14` | 终端页面 |
| `Connections` | 组件 | `src/pages/Connections.tsx:10` | 连接管理页面 |
| `useTerminalStore` | hook | `src/stores/terminalStore.ts:54` | 状态管理 |

## 核心设计

### 1. Tauri Events 实时通信

**前端监听** → **后端推送**，避免轮询。

**事件名格式**: `shell-output-{shellId}`

**关键实现**:
- 后端: `get_shell` 中启动 reader thread，循环调用 `app_handle.emit(event_name, data)`
- 前端: `listen<string>(eventName, (event) => terminal.write(event.payload))`
- 清理: 关闭会话时调用 `unlisten()` 取消订阅

### 2. 多连接多会话管理

**架构**：

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

**UI 结构**：

```
┌─ 连接 Tab (username@host) ─────────────────────┐
│  ┌─ 会话 Tab ────┬─ 会话 Tab ────┬─ + 新建 ──┐ │
│  │ 会话1    [x]  │ 会话2    [x]  │           │ │
│  └───────────────┴───────────────┴───────────┘ │
│  ┌─ 工具栏 ───────────────────────────────────┐ │
│  │                    [复制] [搜索] [全屏]    │ │
│  └───────────────────────────────────────────┘ │
│  ┌─ xterm.js 终端区域 ───────────────────────┐ │
│  │  $ _                                      │ │
│  └───────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘
```

### 3. 会话创建同步机制

**问题**：同一 Session 上并发创建 Channel 会冲突

**方案**：连接级别锁 + 暂停 reader thread

```rust
// 1. 获取连接级别锁
let shell_lock = SHELL_LOCKS.lock().unwrap().get(&id).cloned()...;
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

## 约定

**前端 (React/TypeScript):**
- 组件使用函数式组件 + hooks
- 状态管理使用 Zustand (`terminalStore`)
- 连接数据持久化使用 localStorage
- 样式内联，主题色 `#00b96b`，背景 `#1E1E1E`
- TypeScript strict 模式

**后端 (Rust):**
- SSH 会话存储在 `lazy_static!` 的 `Mutex<HashMap<String, Session>>`
- Shell 读取使用独立线程，通过 Tauri Events 推送数据
- 所有 Tauri 命令返回 `Result<T, String>`
- 使用 `AppHandle.emit()` 推送事件到前端

## 反模式

- **不要**在 `src-tauri/src/db/` 添加代码 - 模块未完成
- **不要**使用轮询方式读取 shell 输出 - 使用 Events
- **不要**修改 xterm.js 内部样式 - 用 `src/styles/global.css` 覆盖
- **不要**同步阻塞 SSH 操作 - 使用非阻塞模式
- **不要**在 reader thread 持有 SESSIONS 锁 - 会阻塞其他操作

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
- SFTP 功能为占位符，未实现
- 连接数据存储在 `localStorage` key `iterminal_connections`
- Shell 输出通过 Events 推送，事件名格式 `shell-output-{shellId}`
- 关闭会话时需调用 `unlisten()` 取消事件订阅
- 无 CI/CD 配置（无 .github 目录）
- 无测试文件