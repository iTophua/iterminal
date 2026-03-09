# iTerminal - SSH Connection Manager

**技术栈:** Tauri 2 + React 19 + TypeScript + Vite + Ant Design + xterm.js + Rust (ssh2)

## 结构

```
.
├── src/                    # React 前端
│   ├── main.tsx            # 入口，ConfigProvider 配置
│   ├── App.tsx             # 路由 + 布局 (顶部栏/侧边栏/内容区/状态栏)
│   ├── components/         # 公共组件
│   ├── pages/              # 页面组件 (见 src/pages/AGENTS.md)
│   └── styles/             # 全局 CSS (xterm 样式覆盖)
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # Tauri 入口，注册命令
│   │   ├── lib.rs          # 模块声明
│   │   ├── commands/       # Tauri 命令 (见 src-tauri/src/commands/AGENTS.md)
│   │   └── db/             # 数据库模块 (未完成)
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── package.json            # npm 依赖
├── vite.config.ts          # Vite 配置 (端口 1430)
└── tsconfig.json           # TypeScript 配置 (strict 模式)
```

## 查找指南

| 任务 | 位置 | 说明 |
|------|------|------|
| 添加新 SSH 功能 | `src-tauri/src/commands/ssh.rs` | 核心 SSH 逻辑 |
| 添加新页面 | `src/pages/` | 创建组件 + 在 App.tsx 添加路由 |
| 修改终端样式 | `src/styles/global.css` | xterm.js CSS 覆盖 |
| 添加 Tauri 命令 | `src-tauri/src/commands/` + `main.rs` | 创建命令 + 注册 |
| 修改侧边栏 | `src/components/Sidebar.tsx` | 分组导航逻辑 |
| 连接数据持久化 | `src/pages/Connections.tsx` | localStorage 存储 |

## 代码映射

| 符号 | 类型 | 位置 | 角色 |
|------|------|------|------|
| `connect_ssh` | fn | `src-tauri/src/commands/ssh.rs:34` | SSH 连接 |
| `get_shell` | fn | `src-tauri/src/commands/ssh.rs:159` | 创建 PTY shell |
| `read_shell` | fn | `src-tauri/src/commands/ssh.rs:277` | 读取 shell 输出 |
| `write_shell` | fn | `src-tauri/src/commands/ssh.rs:238` | 写入 shell 输入 |
| `Terminal` | 组件 | `src/pages/Terminal.tsx:18` | 终端页面 |
| `Connections` | 组件 | `src/pages/Connections.tsx:28` | 连接管理页面 |
| `Sidebar` | 组件 | `src/components/Sidebar.tsx:15` | 侧边栏导航 |

## 约定

**前端 (React/TypeScript):**
- 组件使用函数式组件 + hooks
- 状态管理使用 localStorage（无 Zustand store）
- 样式内联，主题色 `#00b96b`，背景 `#1E1E1E`
- TypeScript strict 模式，`noUnusedLocals: true`

**后端 (Rust):**
- SSH 会话存储在 `lazy_static!` 的 `Mutex<HashMap<String, Session>>`
- Shell 读取使用独立线程，非阻塞模式
- 所有 Tauri 命令返回 `Result<T, String>`

## 反模式

- **不要**在 `src-tauri/src/db/` 添加代码 - 模块未完成
- **不要**使用 Zustand store - 项目用 localStorage
- **不要**修改 xterm.js 内部样式 - 用 `src/styles/global.css` 覆盖
- **不要**同步阻塞 SSH 操作 - 使用非阻塞模式

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
- Shell 读取循环 500ms 间隔（`Terminal.tsx:182`）