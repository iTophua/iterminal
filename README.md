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
- 🔐 **安全可靠** - 本地存储连接信息，数据安全有保障
- 🖥️ **多标签管理** - 支持同时打开多个 SSH 会话
- 🔍 **终端搜索** - 支持终端内容全文搜索
- 📁 **文件管理** - SFTP 文件浏览、上传下载、拖拽上传
- 📊 **系统监控** - 实时 CPU、内存、磁盘监控面板
- 📋 **中文支持** - 完整的中文界面和右键菜单
- 🌍 **跨平台** - 支持 Windows、macOS、Linux

### 目标用户

- 开发者
- 系统运维工程师
- DevOps 工程师
- 需要管理多台服务器的技术人员

---

## 安装与打包

### 环境要求

#### 通用要求

- Node.js >= 18.x
- Rust >= 1.70
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

### GitHub Actions 自动打包

创建 `.github/workflows/build.yml` 实现跨平台自动打包：

```yaml
name: Build and Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest
            target: x86_64-pc-windows-msvc
          - os: macos-latest
            target: x86_64-apple-darwin
          - os: ubuntu-latest
            target: x86_64-unknown-linux-gnu

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Setup Rust
        uses: dtolnay/rust-action@stable

      - name: Install dependencies (Linux)
        if: matrix.os == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev

      - name: Install npm dependencies
        run: npm install

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'iTerminal ${{ github.ref_name }}'
          releaseDraft: true
          prerelease: false
          args: --target ${{ matrix.target }}
```

---

## 功能介绍

### 1. 连接管理

#### 1.1 连接列表

- 卡片式展示所有 SSH 连接
- 分组管理（全部、生产环境、开发环境、测试环境）
- 实时显示连接状态（在线/离线）
- 支持按名称、IP、标签搜索筛选

#### 1.2 连接操作

| 操作 | 说明 |
|------|------|
| 新建连接 | 创建新的 SSH 连接配置 |
| 编辑连接 | 修改现有连接信息 |
| 删除连接 | 删除单个连接 |
| 复制连接 | 快速复制现有配置创建新连接 |
| 连接测试 | 测试 SSH 连通性和认证 |
| 快速连接 | 一键打开 SSH 终端 |
| 快速导入 | 按格式粘贴批量导入连接 |
| 复制 IP | 一键复制服务器 IP 地址 |
| 复制信息 | 复制完整连接信息 |

#### 1.3 连接状态

- **在线** - 端口可达（绿色指示灯）
- **离线** - 端口不可达（灰色指示灯）
- **连接中** - 正在建立连接（蓝色指示灯）

> 💡 启动后自动检测所有连接状态，每 10 分钟刷新一次。

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

### 2. SSH 终端

#### 2.1 多标签管理

- 支持同时打开多个 SSH 会话
- 连接级别标签页（每个连接可创建多个会话）
- 标签页显示服务器名称/IP
- 会话状态标识

#### 2.2 终端功能

| 功能 | 快捷键/操作 |
|------|------------|
| 终端模拟 | 完整的 xterm.js 终端 |
| 彩色输出 | 支持 ANSI 颜色 |
| 复制 | 工具栏按钮 / 右键菜单 |
| 粘贴 | 右键菜单 |
| 全选 | 右键菜单 |
| 搜索 | 工具栏搜索按钮 |
| 全屏 | 工具栏全屏按钮（窗口最大化 + 自动收起侧边栏） |

#### 2.3 工具栏

悬浮工具栏提供快捷操作：
- 📋 **复制** - 复制选中的终端内容
- 🔍 **搜索** - 打开搜索栏，搜索终端内容
- 🖥️ **全屏** - 窗口最大化并收起侧边栏
- 📊 **系统监控** - 打开实时监控面板
- 📁 **文件管理** - 打开 SFTP 文件管理面板
- ➖ **收起** - 收起工具栏为小球形态

#### 2.4 右键菜单

中文右键菜单支持：
- **复制** - 复制选中内容
- **粘贴** - 粘贴剪贴板内容到终端
- **全选** - 全选终端内容

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
| 删除 | 删除文件或空文件夹 |
| 修改权限 | chmod 权限设置 |
| 压缩 | 远程 tar.gz 压缩 |
| 复制文件名 | 复制选中文件名 |
| 复制路径 | 复制完整路径 |

#### 3.3 文件传输

- **上传文件** - 支持多文件选择上传
- **上传文件夹** - 整个文件夹上传
- **拖拽上传** - 直接拖拽文件到面板上传
- **下载文件** - 选择保存位置下载
- **传输进度** - 实时显示传输进度

> ⚠️ 注意：文件夹下载暂不支持，需先压缩后下载。

### 4. 系统监控

#### 4.1 监控面板

实时显示服务器状态，每 3 秒自动刷新：

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

#### 4.2 状态指示

- 🟢 绿色 - 使用率 < 70%
- 🟡 黄色 - 使用率 70% - 90%
- 🔴 红色 - 使用率 > 90%

---

## 使用指南

### 快速开始

#### 第一步：创建连接

1. 启动 iTerminal
2. 点击左侧导航栏「连接管理」
3. 点击「新建连接」按钮
4. 填写连接信息：
   - 名称：`我的服务器`
   - 主机：`192.168.1.100`
   - 端口：`22`
   - 用户名：`root`
   - 密码：`********`
   - 分组：`生产环境`
5. 点击「保存」

#### 第二步：测试连接

1. 在连接列表中找到刚创建的连接
2. 点击「测试」按钮
3. 查看连接状态和延迟

#### 第三步：连接服务器

1. 点击「连接」按钮
2. 自动跳转到终端页面
3. 开始使用 SSH 终端

### 多会话管理

#### 创建多个会话

1. 在终端页面，点击会话标签栏的「+ 新建」
2. 自动创建新的会话并连接

#### 切换会话

- 点击会话标签切换
- 点击连接标签切换不同服务器

### 终端操作

#### 使用搜索功能

1. 点击工具栏「🔍」按钮
2. 输入搜索关键词
3. 使用「←」「→」按钮导航搜索结果
4. 按 Enter 键跳转到下一个匹配

#### 全屏模式

1. 点击工具栏「⛶」按钮
2. 窗口自动最大化，侧边栏自动收起
3. 再次点击退出全屏

#### 使用右键菜单

1. 在终端区域右键点击
2. 选择需要的操作：
   - 复制：复制选中内容
   - 粘贴：粘贴内容到终端
   - 全选：全选终端内容

### 搜索和筛选

#### 搜索连接

1. 在连接管理页面顶部搜索框输入关键词
2. 实时过滤匹配的连接

#### 按分组筛选

1. 点击左侧导航栏的分组名称
2. 显示该分组下的所有连接

### 数据存储

连接配置存储在浏览器 localStorage 中：
- 存储键：`iterminal_connections`
- 侧边栏状态：`iterminal_sidebar_collapsed`

> ⚠️ 注意：当前密码为明文存储，后续版本将支持加密存储。

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
│   │   └── MonitorPanel.tsx    # 系统监控面板
│   ├── pages/                  # 页面组件
│   │   ├── Terminal.tsx        # 终端页面
│   │   ├── Connections.tsx     # 连接管理
│   │   └── Transfers.tsx       # 传输管理
│   ├── stores/                 # Zustand 状态管理
│   │   ├── terminalStore.ts    # 连接/会话状态
│   │   └── transferStore.ts    # 传输记录状态
│   └── styles/                 # 全局样式
│       └── global.css          # xterm.js 样式覆盖
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 入口
│   │   ├── lib.rs              # 模块声明
│   │   └── commands/           # Tauri 命令
│   │       ├── ssh.rs          # SSH 操作 + 系统监控
│   │       ├── sftp.rs         # SFTP 文件传输
│   │       └── db.rs           # 数据库（开发中）
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置
│   └── capabilities/           # 权限配置
├── package.json                # npm 依赖
├── vite.config.ts              # Vite 配置
└── tsconfig.json               # TypeScript 配置
```

---

## 安全注意事项

> ⚠️ 以下安全风险当前版本存在，生产环境使用请注意：

| 风险项 | 当前状态 | 建议 |
|--------|----------|------|
| 密码存储 | 明文存储在 localStorage | 避免在生产环境存储敏感密码 |
| 主机密钥验证 | 已跳过 | 后续版本将支持 known_hosts |
| 密钥认证 | 未实现 | 后续版本支持 |
| 会话超时 | 无自动锁定 | 手动断开不使用的连接 |

---

## 常见问题

### Q: 无法连接服务器？

1. 检查网络连通性
2. 确认 SSH 服务已启动
3. 验证用户名和密码
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
- [x] 远程文件压缩

### 计划功能

- [ ] 密钥认证
- [ ] 密码加密存储
- [ ] 连接导入/导出
- [ ] 断线自动重连
- [ ] 快捷键系统
- [ ] 命令片段/Snippets
- [ ] 分屏终端
- [ ] 终端主题配置
- [ ] 文件预览/编辑
- [ ] 文件夹下载
- [ ] 断点续传
- [ ] 进程管理
- [ ] Docker 管理
- [ ] 主题切换
- [ ] 多语言支持

---

## 许可证

MIT License

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 项目
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request