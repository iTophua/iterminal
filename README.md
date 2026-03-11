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
| Rust | - | 后端 SSH 实现 (ssh2) |

### 核心特性

- 🚀 **轻量高效** - 基于 Tauri，内存占用低，启动速度快
- 🔐 **安全可靠** - 本地存储连接信息，数据安全有保障
- 🖥️ **多标签管理** - 支持同时打开多个 SSH 会话
- 🔍 **终端搜索** - 支持终端内容全文搜索
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
| 删除连接 | 删除单个或批量删除连接 |
| 复制连接 | 快速复制现有配置 |
| 连接测试 | 测试 SSH 连通性和延迟 |
| 快速连接 | 一键打开 SSH 终端 |

#### 1.3 连接配置

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
- ➖ **收起** - 收起工具栏为小球形态

#### 2.4 右键菜单

中文右键菜单支持：
- **复制** - 复制选中内容
- **粘贴** - 粘贴剪贴板内容到终端
- **全选** - 全选终端内容

### 3. 文件管理（开发中）

- 双栏文件管理器
- 本地和远程文件浏览
- 文件上传/下载
- 文件操作（新建、删除、重命名）

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
│   │   └── Sidebar.tsx         # 侧边栏
│   ├── pages/                  # 页面组件
│   │   ├── Terminal.tsx        # 终端页面
│   │   ├── Connections.tsx     # 连接管理
│   │   └── FileManager.tsx     # 文件管理（开发中）
│   ├── stores/                 # Zustand 状态管理
│   │   └── terminalStore.ts    # 连接/会话状态
│   └── styles/                 # 全局样式
│       └── global.css          # xterm.js 样式覆盖
├── src-tauri/                  # Rust 后端
│   ├── src/
│   │   ├── main.rs             # Tauri 入口
│   │   ├── lib.rs              # 模块声明
│   │   └── commands/           # Tauri 命令
│   │       ├── ssh.rs          # SSH 操作
│   │       └── sftp.rs         # SFTP（开发中）
│   ├── Cargo.toml              # Rust 依赖
│   ├── tauri.conf.json         # Tauri 配置
│   └── capabilities/           # 权限配置
├── package.json                # npm 依赖
├── vite.config.ts              # Vite 配置
└── tsconfig.json               # TypeScript 配置
```

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

- [ ] 文件管理功能
- [ ] 密码加密存储
- [ ] SFTP 文件传输
- [ ] 快捷键支持
- [ ] 主题切换
- [ ] 多语言支持
- [ ] 连接导入/导出

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