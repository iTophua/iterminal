# iTerminal - SSH 连接管理器

一款基于 Tauri 2 + React 构建的现代化 SSH 连接管理工具，专注于提供高效的 SSH 连接管理和终端操作体验。

## 项目介绍

### 背景

iTerminal 是一款类似于 XTerminal 的 SSH 连接管理工具，旨在帮助开发者和运维人员更便捷地管理多台服务器。

### 技术栈

| 技术 | 版本 | 说明 |
|------|------|------|
| Tauri | 2.x | 跨平台桌面应用框架 |
| React | 19.x | 前端 UI 框架 |
| TypeScript | 5.x | 类型安全的 JavaScript |
| Vite | 7.x | 下一代前端构建工具 |
| Ant Design | 6.x | 企业级 UI 组件库 |
| xterm.js | 5.x | 终端模拟器 |
| Zustand | 5.x | 轻量级状态管理 |
| Rust | 1.75+ | 后端 SSH 实现 |
| russh | 0.50 | Rust SSH 客户端库 |
| russh-sftp | 2.1 | Rust SFTP 客户端库 |

### 核心特性

- 🚀 **轻量高效** - 基于 Tauri，内存占用低，启动速度快
- 🔐 **安全可靠** - AES-256-GCM 加密存储连接信息，支持 SSH 密钥认证
- 🖥️ **多标签管理** - 支持同时打开多个 SSH 会话
- 📐 **终端分屏** - 支持水平/垂直分屏，可拖拽调整大小
- 🔍 **终端搜索** - 支持终端内容全文搜索
- ⌨️ **快捷键系统** - 丰富的快捷键支持，可自定义
- 📁 **文件管理** - SFTP 文件浏览、上传下载、拖拽上传、文件搜索、压缩解压
- 📊 **系统监控** - 实时 CPU、内存、磁盘监控面板
- 🤖 **MCP 支持** - 内置 MCP 服务器，支持 AI 助手集成
- 🪟 **多窗口支持** - 拖拽连接到边缘创建新窗口
- 📋 **中文支持** - 完整的中文界面和右键菜单
- 🌍 **跨平台** - 支持 Windows、macOS、Linux

### 目标用户

- 开发者
- 系统运维工程师
- DevOps 工程师
- 需要管理多台服务器的技术人员

---

## 应用图片

<div style="display: flex; overflow-x: auto; gap: 10px; white-space: nowrap;">
  <img src="https://github.com/user-attachments/assets/4068ff65-8c11-44ed-92bc-c4db42a6103e" alt="image" style="height: 300px; width: auto; flex-shrink: 0;" />
  <img src="https://github.com/user-attachments/assets/e89feda1-7843-410a-a731-379bf8a8fac4" alt="image" style="height: 300px; width: auto; flex-shrink: 0;" />
  <img src="https://github.com/user-attachments/assets/789a9a53-f748-4e42-abd2-6f0a4246de01" alt="image" style="height: 300px; width: auto; flex-shrink: 0;" />
  <img src="https://github.com/user-attachments/assets/a123419b-5548-4c03-83fe-f29848a957d1" alt="image" style="height: 300px; width: auto; flex-shrink: 0;" />
</div>


## 安装与打包

### 环境要求

#### 通用要求

- Node.js >= 18.x
- Rust >= 1.75
- npm 或 pnpm

#### Windows

- [Microsoft Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（选择 "Desktop development with C++"）
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（Windows 10/11 通常已内置）

#### macOS

- Xcode Command Line Tools: `xcode-select --install`

#### Linux (Ubuntu/Debian)

```bash
sudo apt update
sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
```

### 开发环境搭建

```bash
# 1. 克隆项目
git clone <repository-url>
cd iTerminal

# 2. 安装依赖
npm install

# 3. 启动开发模式
npm run tauri dev
```

### 生产环境打包

```bash
# 构建并打包应用
npm run tauri build
```

### 打包输出

构建完成后，安装包位于 `src-tauri/target/release/bundle/` 目录：

| 平台 | 输出格式 | 文件位置 |
|------|---------|---------|
| Windows | `.msi` / `.exe` | `bundle/msi/` `bundle/nsis/` |
| macOS | `.dmg` / `.app` | `bundle/dmg/` `bundle/macos/` |
| Linux | `.deb` / `.AppImage` | `bundle/deb/` `bundle/appimage/` |

---

## 功能介绍

### 1. 连接管理

#### 1.1 连接列表

- 卡片式展示所有 SSH 连接
- 分组管理（自定义分组）
- 标签分类
- 实时显示连接状态（在线/离线）
- 支持按名称、IP、标签搜索筛选
- 连接排序、批量管理

#### 1.2 连接操作

| 操作 | 说明 |
|------|------|
| 新建连接 | 创建新的 SSH 连接配置 |
| 编辑连接 | 修改现有连接信息 |
| 删除连接 | 删除单个连接 |
| 复制连接 | 快速复制现有配置创建新连接 |
| 连接测试 | 测试 SSH 连通性和认证 |
| 快速连接 | 一键打开 SSH 终端 |
| 导入/导出 | JSON 格式批量导入导出连接 |
| 复制 IP | 一键复制服务器 IP 地址 |

#### 1.3 连接状态

- **在线** - 端口可达（绿色指示灯）
- **离线** - 端口不可达（灰色指示灯）
- **连接中** - 正在建立连接（蓝色指示灯）

> 💡 启动后自动检测所有连接状态，定期刷新。

#### 1.4 连接配置

**基本配置：**
- 连接名称
- 分组
- 标签
- 主机名/IP 地址
- 端口（默认 22）
- 用户名

**认证方式：**
- 密码认证
- SSH 密钥认证（支持 OpenSSH 和 PEM 格式）

### 2. SSH 终端

#### 2.1 多标签管理

- 支持同时打开多个 SSH 会话
- 连接级别标签页（每个连接可创建多个会话）
- 标签页显示服务器名称/IP
- 会话状态标识

#### 2.2 终端分屏

- 支持水平/垂直分屏
- 可拖拽调整分屏大小
- 每个分屏独立会话管理
- 拖拽会话标签创建新分屏

#### 2.3 终端功能

| 功能 | 快捷键/操作 |
|------|------------|
| 终端模拟 | 完整的 xterm.js 终端 |
| 彩色输出 | 支持 ANSI 颜色 |
| 复制 | 工具栏按钮 / 右键菜单 / CmdOrCtrl+Shift+C |
| 粘贴 | 右键菜单 / CmdOrCtrl+Shift+V |
| 全选 | 右键菜单 |
| 搜索 | 工具栏搜索按钮 / CmdOrCtrl+F |
| 全屏 | 工具栏全屏按钮 |
| 分屏 | CmdOrCtrl+D 水平 / CmdOrCtrl+Shift+D 垂直 |
| 新建会话 | CmdOrCtrl+T |
| 关闭会话 | CmdOrCtrl+W |

#### 2.4 工具栏

悬浮工具栏提供快捷操作：
- 📋 **复制** - 复制选中的终端内容
- 🔍 **搜索** - 打开搜索栏，搜索终端内容
- 🖥️ **全屏** - 窗口最大化并收起侧边栏
- 📊 **系统监控** - 打开实时监控面板
- 📁 **文件管理** - 打开 SFTP 文件管理面板
- ➖ **收起** - 收起工具栏为小球形态

#### 2.5 多窗口支持

- 拖拽连接标签到窗口边缘创建新窗口
- 新窗口保留完整终端功能
- 窗口位置自动记忆

### 3. 文件管理

#### 3.1 文件浏览

- SFTP 协议远程文件浏览
- 树形目录结构展示
- 路径输入框快速跳转
- 显示/隐藏隐藏文件
- 文件大小显示

#### 3.2 文件操作

| 操作 | 说明 |
|------|------|
| 新建文件 | 创建空文件 |
| 新建文件夹 | 创建目录 |
| 重命名 | 修改文件/文件夹名称 |
| 删除 | 删除文件或目录 |
| 修改权限 | chmod 权限设置 |
| 压缩 | 远程 tar.gz 压缩 |
| 解压 | 支持 tar.gz/zip/gz 等格式 |
| 文件搜索 | 远程文件搜索 |
| 文件预览 | 文本文件预览 |
| 文件编辑 | 在线编辑远程文件 |
| 复制文件名 | 复制选中文件名 |
| 复制路径 | 复制完整路径 |

#### 3.3 文件传输

- **上传文件** - 支持多文件选择上传
- **上传文件夹** - 整个文件夹上传
- **拖拽上传** - 直接拖拽文件到面板上传
- **下载文件** - 选择保存位置下载
- **传输进度** - 实时显示传输进度
- **暂停/恢复** - 支持传输暂停和恢复

### 4. 系统监控

#### 4.1 监控面板

实时显示服务器状态，自动刷新：

**系统信息：**
- 主机名
- 操作系统
- 内核版本
- 运行时间

**CPU 监控：**
- 总体使用率
- 各核心使用率（可视化）
- 核心数量
- 负载均值

**内存监控：**
- 内存使用率（可视化）
- 已用/总量/可用
- Swap 使用情况

**磁盘监控：**
- 各挂载点使用率
- 已用/总量/可用空间
- 使用率百分比

**进程管理：**
- 进程列表（按内存排序）
- 进程终止

#### 4.2 状态指示

- 🟢 绿色 - 使用率 < 70%
- 🟡 黄色 - 使用率 70% - 90%
- 🔴 红色 - 使用率 > 90%

### 5. MCP 服务器

内置 MCP (Model Context Protocol) 服务器，支持 AI 助手集成：

- 通过 HTTP API 控制 SSH 连接
- 支持命令执行、文件操作、系统监控
- 可与 Claude 等 AI 助手集成

---

## 项目结构

```
iTerminal/
├── src/                        # React 前端
│   ├── main.tsx                # 应用入口
│   ├── App.tsx                 # 路由 + 布局
│   ├── components/             # 公共组件
│   │   ├── Sidebar.tsx         # 侧边栏
│   │   ├── FileManagerPanel.tsx # 文件管理面板
│   │   ├── MonitorPanel.tsx    # 系统监控面板
│   │   ├── SettingsPanel.tsx   # 设置面板
│   │   └── fileManager/        # 文件管理子模块
│   ├── pages/                  # 页面组件
│   │   ├── Terminal.tsx        # 终端页面
│   │   ├── TerminalWindow.tsx  # 新窗口终端
│   │   ├── Connections.tsx     # 连接管理
│   │   └── Transfers.tsx       # 传输管理
│   ├── stores/                 # Zustand 状态管理
│   │   ├── terminalStore.ts    # 连接/会话状态
│   │   └── transferStore.ts    # 传输记录状态
│   ├── services/               # 服务层
│   │   ├── database.ts         # 数据库服务
│   │   └── sftp.ts             # SFTP 服务
│   ├── utils/                  # 工具函数
│   │   ├── paneUtils.ts        # 分屏工具
│   │   └── TerminalManager.ts  # 终端管理
│   └── styles/                 # 全局样式
│       └── global.css          # xterm.js 样式覆盖
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 入口
│   │   ├── lib.rs              # 模块声明
│   │   ├── db/                 # 数据库
│   │   │   ├── schema.sql      # 数据库结构
│   │   │   └── crypto.rs       # 加密模块
│   │   └── commands/           # Tauri 命令
│   │       ├── ssh.rs          # SSH 操作
│   │       ├── sftp.rs         # SFTP 文件传输
│   │       ├── db.rs           # 数据库操作
│   │       ├── api.rs          # HTTP API 服务器
│   │       └── window.rs       # 窗口管理
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置
│   └── capabilities/           # 权限配置
├── mcp/                        # MCP 服务器
│   └── src/index.ts            # MCP 工具定义
├── package.json                # npm 依赖
├── vite.config.ts              # Vite 配置
└── tsconfig.json               # TypeScript 配置
```

---

## 安全注意事项

| 风险项 | 当前状态 | 建议 |
|--------|----------|------|
| 密码存储 | AES-256-GCM 加密存储 | 安全 |
| 主机密钥验证 | 已跳过 | 后续版本将支持 known_hosts |
| 密钥认证 | 已实现 | 推荐使用密钥认证 |
| 会话超时 | 无自动锁定 | 手动断开不使用的连接 |

---

## 常见问题

### Q: 无法连接服务器？

1. 检查网络连通性
2. 确认 SSH 服务已启动
3. 验证用户名和密码/密钥
4. 检查防火墙设置

### Q: Windows 打包失败？

1. 确保已安装 Visual Studio Build Tools
2. 选择 "Desktop development with C++" 工作负载
3. 安装 WebView2 Runtime

### Q: macOS 提示无法打开？

1. 系统偏好设置 → 安全性与隐私
2. 点击「仍要打开」
3. 或使用命令：`xattr -cr iTerminal.app`

### Q: 终端显示乱码？

1. 检查服务器 locale 设置
2. 确保终端字体支持 UTF-8
3. 尝试调整终端字体

---

## 开发计划

### 已完成功能

- [x] SSH 连接管理
- [x] 多会话终端
- [x] 终端搜索功能
- [x] SFTP 文件管理
- [x] 文件上传/下载
- [x] 拖拽上传
- [x] 系统监控面板
- [x] 远程文件压缩/解压
- [x] 密钥认证
- [x] 密码加密存储
- [x] 连接导入/导出
- [x] 断线自动重连
- [x] 快捷键系统
- [x] 分屏终端
- [x] 终端主题配置
- [x] 文件预览/编辑
- [x] 文件搜索
- [x] 传输暂停/恢复
- [x] MCP 服务器
- [x] 多窗口支持

### 计划功能

- [ ] 文件夹下载
- [ ] 断点续传
- [ ] 进程管理增强
- [ ] Docker 管理
- [ ] 主题切换
- [ ] 多语言支持
- [ ] 命令片段/Snippets

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request