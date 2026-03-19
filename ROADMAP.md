# iTerminal 开发计划

> 基于代码分析整理的功能完善路线图  
> 更新时间：2026-03-19
> 
> **最近完成：**
> - ✅ 密码加密存储 (AES-256-GCM + SQLite)
> - ✅ SSH 密钥认证 (OpenSSH/PEM 格式)
> - ✅ 完整测试覆盖 (前端 68 + 后端 16 + E2E 18)
> - ✅ 终端输出导出 (工具栏导出按钮)
> - ✅ 清屏快捷键 (Ctrl+L)
> - ✅ 自动重连 (断开检测 + 重连 UI)
> - ✅ 快捷键配置 (设置面板)
> - ✅ 分屏终端 (水平分屏)
> - ✅ 会话保存/恢复 (应用关闭保存 + 启动恢复)

---

## 目录

1. [当前功能概览](#一当前功能概览)
2. [功能开发计划](#二功能开发计划)
   - [SSH 终端功能](#21-ssh-终端功能)
   - [连接管理功能](#22-连接管理功能)
   - [SFTP 文件管理功能](#23-sftp-文件管理功能)
   - [系统监控功能](#24-系统监控功能)
   - [MCP 集成功能](#25-mcp-集成功能)
   - [用户体验和设置](#26-用户体验和设置)
3. [优先级汇总](#三优先级汇总)
4. [版本规划](#四版本规划)
5. [技术实现参考](#五技术实现参考)

---

## 一、当前功能概览

| 模块 | 已实现功能 | 完成度 |
|------|-----------|--------|
| **SSH 终端** | 多标签会话、字体主题配置、搜索、右键菜单、系统监控/文件管理/MCP日志面板 | 70% |
| **连接管理** | CRUD、分组、克隆、在线检测、快速导入、测试连接、密钥认证 | 85% |
| **SFTP 文件** | 目录浏览、上传下载、拖拽上传、文件操作、权限修改、压缩、传输进度 | 75% |
| **系统监控** | CPU/内存/磁盘监控、自动刷新、MCP iter_monitor | 50% |
| **MCP 集成** | 11个工具、配置管理、OpenCode/Claude支持、操作日志、npm发布 | 80% |
| **用户体验** | 应用主题、终端主题、字体配置、错误提示、帮助文档 | 65% |

---

## 二、功能开发计划

### 2.1 SSH 终端功能

#### ✅ 已实现

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 多标签/多会话 | ✅ | Terminal.tsx:891-904 |
| 字体/字号配置 | ✅ | SettingsPanel.tsx:238-266 |
| 终端主题 (5个预设) | ✅ | terminal-themes.ts |
| 光标样式/闪烁 | ✅ | SettingsPanel.tsx:208-232 |
| 回滚缓冲区配置 | ✅ | SettingsPanel.tsx:181-193 |
| 终端搜索 (Ctrl+F) | ✅ | Terminal.tsx:613-631 |
| 右键菜单 | ✅ | Terminal.tsx:552-611 |
| 选中即复制 | ✅ | SettingsPanel.tsx:195-206 |
| 系统监控面板 | ✅ | MonitorPanel.tsx |
| 文件管理面板 | ✅ | FileManagerPanel.tsx |
| MCP 日志面板 | ✅ | McpLogPanel.tsx |
| 全屏模式 | ✅ | Terminal.tsx:491-517 |
| 悬浮工具栏 | ✅ | Terminal.tsx:676-831 |
| 终端输出导出 | ✅ | Terminal.tsx:717-763 |
| 清屏快捷键 (Ctrl+L) | ✅ | Terminal.tsx:245-248 |
| 自动重连 | ✅ | Terminal.tsx:374-426, ssh.rs:284-333 |

#### ❌ 待开发

| 功能 | 优先级 | 说明 | 预估工时 |
|------|--------|------|----------|
| **快捷键配置** | 🔴 高 | 设置面板菜单项已存在但禁用 | 1-2天 |
| **终端链接检测** | 🟡 中 | 无法点击 URL/文件路径进行打开 | 1天 |

---

### 2.2 连接管理功能

#### ✅ 已实现

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 连接 CRUD | ✅ | Connections.tsx:172-221 |
| 测试连接 | ✅ | Connections.tsx:246-278 |
| 连接分组 | ✅ | Connection 接口有 group 字段 |
| 分组筛选 | ✅ | Connections.tsx:163-170 |
| 连接克隆 | ✅ | Connections.tsx:190-200 |
| 在线状态检测 | ✅ | Connections.tsx:72-160 |
| 快速导入 | ✅ | Connections.tsx:348-461 |

#### ❌ 待开发

| 功能 | 优先级 | 说明 | 预估工时 |
|------|--------|------|----------|
| **主机密钥验证** | 🔴 高 | check_server_key 无条件返回 true，存在中间人攻击风险 | 0.5天 |
| **连接导入/导出** | 🟡 中 | 无完整导出功能，换机/备份麻烦 | 0.5天 |
| **最近连接历史** | 🟡 中 | 无连接历史记录，效率问题 | 0.5天 |
| **批量删除** | 🟡 中 | 无法批量操作连接 | 0.5天 |
| **批量移动分组** | 🟡 中 | 无法批量更改连接分组 | 0.5天 |
| **跳板机/代理** | 🟡 中 | 无 ProxyJump 或 SOCKS 代理支持，企业环境必需 | 2-3天 |
| **批量执行命令** | 🟡 中 | 后端 execute_command 已实现，前端无 UI | 1天 |
| **收藏连接** | 🟢 低 | 无收藏/星标功能 | 0.5天 |

---

### 2.3 SFTP 文件管理功能

#### ✅ 已实现

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 树形/列表视图浏览 | ✅ | FileManagerPanel.tsx:1119-1300 |
| 路径导航 | ✅ | FileManagerPanel.tsx:1006-1055 |
| 上传文件/文件夹 | ✅ | FileManagerPanel.tsx:401-459, sftp.rs:270-701 |
| 下载文件 | ✅ | FileManagerPanel.tsx:701-763, sftp.rs:390-509 |
| 拖拽上传 | ✅ | FileManagerPanel.tsx:597-699 |
| 传输冲突处理 | ✅ | FileManagerPanel.tsx:361-399 |
| 文件 CRUD | ✅ | FileManagerPanel.tsx:777-842 |
| 权限修改 (chmod) | ✅ | FileManagerPanel.tsx:844-854, sftp.rs:241-257 |
| 文件压缩 | ✅ | FileManagerPanel.tsx:856-868, sftp.rs:703-748 |
| 传输进度显示 | ✅ | Transfers.tsx:396-421 |
| 取消传输 | ✅ | Transfers.tsx:130-138 |
| 重试失败传输 | ✅ | Transfers.tsx:140-195 |

#### ❌ 待开发

| 功能 | 优先级 | 说明 | 预估工时 |
|------|--------|------|----------|
| **文件预览** | 🔴 高 | 无法预览文件内容，需下载查看 | 2天 |
| **文件编辑** | 🔴 高 | 无法在线编辑保存，修改文件麻烦 | 2-3天 |
| **传输暂停/恢复** | 🔴 高 | 仅支持取消，大文件传输不友好 | 1-2天 |
| **文件搜索** | 🟡 中 | 无搜索功能，大量文件时效率低 | 1天 |
| **解压功能** | 🟡 中 | 只有压缩，无解压 | 0.5天 |
| **文件夹下载** | 🟡 中 | 代码提示"暂不支持" | 1天 |
| **文件复制/移动** | 🟡 中 | 无跨目录复制移动功能 | 1天 |
| **断点续传** | 🟢 低 | 大文件传输中断需重新开始 | 2天 |

---

### 2.4 系统监控功能

#### ✅ 已实现

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| CPU 监控 | ✅ | ssh.rs:421-539, MonitorPanel.tsx |
| 内存监控 | ✅ | ssh.rs:421-539, MonitorPanel.tsx |
| 磁盘监控 | ✅ | ssh.rs:421-539, MonitorPanel.tsx |
| 自动刷新 (1/3/5/10秒) | ✅ | MonitorPanel.tsx |
| 暂停/恢复刷新 | ✅ | MonitorPanel.tsx |
| 颜色标识 (<70%绿/70-90%黄/>90%红) | ✅ | MonitorPanel.tsx |
| MCP iter_monitor | ✅ | mcp/src/index.ts:163-172 |

#### ❌ 待开发

| 功能 | 优先级 | 说明 | 预估工时 |
|------|--------|------|----------|
| **网络监控** | 🔴 高 | 无流量/连接数监控，运维盲区 | 1天 |
| **进程管理** | 🔴 高 | 无进程列表/杀死进程功能 | 1-2天 |
| **历史数据图表** | 🟡 中 | 只有实时数据，无趋势展示 | 1-2天 |
| **独立监控页面** | 🟡 中 | 当前仅为侧边栏面板 | 1天 |
| **Docker 管理** | 🟢 低 | 无容器状态查看和操作 | 3-4天 |

---

### 2.5 MCP 集成功能

#### ✅ 已实现

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 11 个 MCP 工具 | ✅ | mcp/src/index.ts |
| MCP 配置管理 | ✅ | SettingsPanel.tsx:347-540 |
| OpenCode/Claude 配置模板 | ✅ | SettingsPanel.tsx |
| 操作日志面板 | ✅ | McpLogPanel.tsx |
| 日志过滤/导出 | ✅ | McpLogPanel.tsx |
| npm 发布 | ✅ | v1.0.4 |
| 完整文档 | ✅ | mcp/README.md |

**已实现的 MCP 工具列表：**
| 工具名称 | 功能 |
|----------|------|
| iter_status | 检查 API 服务状态 |
| iter_connect | 创建 SSH 连接 |
| iter_disconnect | 断开 SSH 连接 |
| iter_test_connection | 测试连接 |
| iter_list_connections | 列出活跃连接 |
| iter_exec | 执行远程命令 |
| iter_monitor | 获取系统监控数据 |
| iter_list_dir | 列出目录内容 |
| iter_mkdir | 创建目录 |
| iter_rm | 删除文件 |
| iter_rename | 重命名文件/目录 |

#### ❌ 待开发

| 功能 | 优先级 | 说明 | 预估工时 |
|------|--------|------|----------|
| **文件上传/下载工具** | 🔴 高 | MCP 未暴露 SFTP 功能，AI 无法传输文件 | 1天 |
| **SSH 密钥认证** | 🔴 高 | MCP 连接仅支持密码 | 1-2天 |
| **连接持久化** | 🟡 中 | 每次需重新 iter_connect，体验不佳 | 1天 |
| **自动重连** | 🟡 中 | 断开后无重连机制 | 0.5天 |
| **实时终端交互** | 🟡 中 | 仅有命令执行，无交互式 Shell | 2天 |
| **SSE 实时推送** | 🟢 低 | 当前为同步请求/响应模式 | 1天 |
| **超时/并发配置** | 🟢 低 | 参数硬编码在代码中 | 0.5天 |
| **WebSocket 传输** | 🟢 低 | 仅有 stdio，可增加 WebSocket 支持 | 1-2天 |

---

### 2.6 用户体验和设置

#### ✅ 已实现

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 应用主题 (浅/深/跟随系统) | ✅ | themeStore.ts |
| 终端主题 (5个预设) | ✅ | terminal-themes.ts |
| 字体/字号配置 | ✅ | SettingsPanel.tsx |
| 光标样式配置 | ✅ | SettingsPanel.tsx |
| 错误提示 (Ant Design message) | ✅ | 各组件 |
| 确认对话框 | ✅ | Modal 组件 |
| 连接状态颜色标识 | ✅ | Connections.tsx |
| 帮助文档 | ✅ | README.md |
| MCP 配置 UI | ✅ | SettingsPanel.tsx |

#### ❌ 待开发

| 功能 | 优先级 | 说明 | 预估工时 |
|------|--------|------|----------|
| **快捷键配置** | 🔴 高 | 设置面板菜单项已存在但禁用 | 1-2天 |
| **窗口位置记忆** | 🟡 中 | 不保存用户调整的窗口大小/位置 | 0.5天 |
| **应用托盘图标** | 🟡 中 | 无最小化到托盘功能 | 1天 |
| **国际化/多语言** | 🟢 低 | 仅简体中文 | 3-5天 |
| **自动更新** | 🟢 低 | 无版本检查和自动更新机制 | 1-2天 |

---

## 三、优先级汇总

### 🔴 高优先级 (核心功能缺失)

| 序号 | 模块 | 功能 | 预估工时 | 说明 |
|------|------|------|----------|------|
| 1 | 安全 | 主机密钥验证 | 0.5天 | 中间人攻击风险 |
| 2 | 终端 | 分屏功能 | 2-3天 | 运维对比操作刚需 |
| 3 | 终端 | 会话保存/恢复 | 1天 | 用户体验刚需 |
| 4 | SFTP | 文件预览 | 2天 | 高频操作 |
| 5 | SFTP | 文件编辑 | 2-3天 | 高频操作 |
| 6 | SFTP | 传输暂停/恢复 | 1-2天 | 大文件传输必需 |
| 7 | 监控 | 网络监控 | 1天 | 运维盲区 |
| 8 | 监控 | 进程管理 | 1-2天 | 运维常用 |
| 9 | MCP | 文件上传/下载工具 | 1天 | AI 无法传输文件 |
| 10 | UX | 快捷键配置 | 1-2天 | 设置入口已存在 |

**高优先级总工时：约 12-16 天**

---

### 🟡 中优先级 (体验提升)

| 序号 | 模块 | 功能 | 预估工时 |
|------|------|------|----------|
| 1 | 终端 | 终端链接检测 | 1天 |
| 2 | 连接 | 连接导入/导出 | 0.5天 |
| 3 | 连接 | 最近连接历史 | 0.5天 |
| 4 | 连接 | 批量操作 | 0.5天 |
| 5 | 连接 | 跳板机/代理支持 | 2-3天 |
| 6 | SFTP | 文件搜索 | 1天 |
| 7 | SFTP | 解压功能 | 0.5天 |
| 8 | SFTP | 文件夹下载 | 1天 |
| 9 | 监控 | 历史数据图表 | 1-2天 |
| 10 | 监控 | 告警功能 | 1天 |
| 11 | MCP | 连接持久化 | 1天 |
| 12 | UX | 窗口位置记忆 | 0.5天 |
| 13 | UX | 托盘图标 | 1天 |

**中优先级总工时：约 12-15 天**

---

### 🟢 低优先级 (锦上添花)

| 序号 | 模块 | 功能 | 预估工时 |
|------|------|------|----------|
| 1 | 终端 | 会话重命名 | 0.5天 |
| 2 | 终端 | 标签拖拽排序 | 0.5天 |
| 3 | 连接 | 收藏连接 | 0.5天 |
| 4 | SFTP | 断点续传 | 2天 |
| 5 | SFTP | 书签目录 | 0.5天 |
| 6 | SFTP | 传输限速 | 0.5天 |
| 7 | 监控 | 多服务器对比 | 1天 |
| 8 | 监控 | Docker 管理 | 3-4天 |
| 9 | UX | 国际化 | 3-5天 |
| 10 | UX | 自动更新 | 1-2天 |

**低优先级总工时：约 13-17 天**

---

## 四、版本规划

### ✅ v1.1.0 - 安全增强版 (已完成)

**目标：解决安全问题，满足生产环境基本要求**

| 功能 | 状态 | 完成时间 |
|------|------|----------|
| 密码加密存储 | ✅ 完成 | 2026-03-19 |
| SSH 密钥认证 | ✅ 完成 | 2026-03-19 |
| 完整测试覆盖 | ✅ 完成 | 2026-03-19 |

---

### ✅ v1.2.0 - 终端增强版 (已完成)

**目标：提升终端核心体验**

| 功能 | 优先级 | 状态 |
|------|--------|------|
| 输出导出 | 🔴 高 | ✅ 完成 |
| 清屏快捷键 | 🟡 中 | ✅ 完成 |
| 自动重连 | 🔴 高 | ✅ 完成 |
| 快捷键配置 | 🔴 高 | ✅ 完成 |
| 分屏终端 | 🔴 高 | ✅ 完成 |
| 会话保存/恢复 | 🔴 高 | ✅ 完成 |

---

### v1.3.0 - 文件管理增强版 (预计 1 周)

**目标：完善 SFTP 功能**

| 功能 | 优先级 | 工时 |
|------|--------|------|
| 文件预览 | 🔴 高 | 2天 |
| 文件编辑 | 🔴 高 | 2-3天 |
| 传输暂停/恢复 | 🔴 高 | 1-2天 |
| 文件搜索 | 🟡 中 | 1天 |
| 解压功能 | 🟡 中 | 0.5天 |

---

### v1.4.0 - 监控增强版 (预计 1 周)

**目标：完善系统监控功能**

| 功能 | 优先级 | 工时 |
|------|--------|------|
| 网络监控 | 🔴 高 | 1天 |
| 进程管理 | 🔴 高 | 1-2天 |
| 历史数据图表 | 🟡 中 | 1-2天 |
| 告警功能 | 🟡 中 | 1天 |

---

### v1.5.0 - MCP 增强版 (预计 0.5 周)

**目标：完善 MCP 集成**

| 功能 | 优先级 | 工时 |
|------|--------|------|
| 文件上传/下载工具 | 🔴 高 | 1天 |
| 连接持久化 | 🟡 中 | 1天 |

---

### v1.6.0 - 体验优化版 (预计 1 周)

**目标：提升整体用户体验**

| 功能 | 优先级 | 工时 |
|------|--------|------|
| 连接导入/导出 | 🟡 中 | 0.5天 |
| 最近连接历史 | 🟡 中 | 0.5天 |
| 跳板机/代理支持 | 🟡 中 | 2-3天 |
| 窗口位置记忆 | 🟡 中 | 0.5天 |
| 托盘图标 | 🟡 中 | 1天 |

---

## 五、技术实现参考

### 5.1 密码加密存储

```typescript
// 使用 Web Crypto API 加密
async function encryptPassword(password: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  )
  return btoa(String.fromCharCode(...iv) + String.fromCharCode(...new Uint8Array(encrypted)))
}

// 生成密钥（首次启动时）
async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}
```

### 5.2 主机密钥验证

```rust
// ssh.rs - 实现 known_hosts 验证
use russh::known_hosts::{KnownHosts, KnownHostError};

fn check_server_key<'a>(
    server_public_key: &'a PublicKey,
    host: &str,
    port: u16,
) -> Result<bool, KnownHostError> {
    let known_hosts = KnownHosts::new(home_dir()?.join(".ssh/known_hosts"))?;
    
    match known_hosts.check(host, port, server_public_key) {
        KnownHostError::KeyChanged => {
            // 警告用户可能存在中间人攻击
            Err(KnownHostError::KeyChanged)
        }
        KnownHostError::NotFound => {
            // 新主机，提示用户确认
            Ok(true) // 或让用户确认
        }
        _ => Ok(true),
    }
}
```

### 5.3 SSH 密钥认证

```rust
// ssh.rs - 密钥认证实现
use russh::keys::{load_secret_key, key::KeyPair};

pub async fn connect_with_key(
    handle: &mut Handle,
    username: &str,
    key_path: &str,
    passphrase: Option<&str>,
) -> Result<bool, Error> {
    let key_pair = load_secret_key(key_path, passphrase.map(|s| s.to_string()))?;
    let auth_result = handle
        .authenticate_publickey(username, Arc::new(key_pair))
        .await?;
    
    Ok(auth_result)
}
```

### 5.4 终端分屏实现

```typescript
// 使用 react-split 或自定义实现
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

function TerminalSplitView() {
  return (
    <PanelGroup direction="horizontal">
      <Panel defaultSize={50}>
        <TerminalSession id="session-1" />
      </Panel>
      <PanelResizeHandle />
      <Panel defaultSize={50}>
        <TerminalSession id="session-2" />
      </Panel>
    </PanelGroup>
  )
}
```

### 5.5 文件预览实现

```rust
// sftp.rs - 添加文件内容读取命令
#[tauri::command]
pub async fn read_file_content(
    connection_id: String,
    path: String,
    max_size: Option<u64>, // 限制大小，防止读取超大文件
) -> Result<FileContent, String> {
    let sftp = get_sftp_session(&connection_id).await?;
    let mut file = sftp.open(&path).await.map_err(|e| e.to_string())?;
    
    let max = max_size.unwrap_or(1024 * 1024); // 默认 1MB
    let mut buffer = vec![0u8; max as usize];
    let bytes_read = file.read(&mut buffer).await.map_err(|e| e.to_string())?;
    buffer.truncate(bytes_read);
    
    Ok(FileContent {
        content: String::from_utf8_lossy(&buffer).to_string(),
        size: bytes_read as u64,
        truncated: bytes_read as u64 >= max,
    })
}
```

### 5.6 网络监控实现

```rust
// ssh.rs - 添加网络统计命令
#[tauri::command]
pub async fn get_network_stats(connection_id: String) -> Result<NetworkStats, String> {
    let output = execute_command(connection_id, "cat /proc/net/dev".to_string()).await?;
    
    // 解析 /proc/net/dev
    // Inter-|   Receive                                                |  Transmit
    //  face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    //    eth0: 1234567  1234    0    0    0     0          0         0  7654321  4321    0    0    0     0       0          0
    
    let interfaces = parse_network_stats(&output);
    Ok(NetworkStats { interfaces })
}
```

### 5.7 进程管理实现

```rust
// ssh.rs - 添加进程管理命令
#[tauri::command]
pub async fn list_processes(connection_id: String) -> Result<Vec<ProcessInfo>, String> {
    // 使用 ps aux 获取进程列表
    let output = execute_command(
        connection_id,
        "ps aux --sort=-%mem | head -50".to_string()
    ).await?;
    
    let processes = parse_ps_output(&output);
    Ok(processes)
}

#[tauri::command]
pub async fn kill_process(connection_id: String, pid: u32, signal: Option<String>) -> Result<(), String> {
    let sig = signal.unwrap_or_else(|| "TERM".to_string());
    execute_command(connection_id, format!("kill -{} {}", sig, pid)).await?;
    Ok(())
}
```

---

## 六、操作优化建议

### 6.1 终端体验优化

| 问题 | 建议 | 优先级 |
|------|------|--------|
| 工具栏遮挡终端 | 添加「自动隐藏工具栏」选项，鼠标移到右上角时展开 | 🟡 中 |
| 右键菜单功能单一 | 添加「在文件管理器中打开当前目录」「复制当前路径」 | 🟡 中 |
| SFTP 路径不同步 | 终端 `cd` 后文件管理器自动同步路径 | 🟢 低 |

### 6.2 文件管理优化

| 问题 | 建议 | 优先级 |
|------|------|--------|
| 文件夹上传进度不明确 | 显示"已上传文件数/总文件数"和总体进度 | 🟡 中 |
| 列表视图排序 | 记住用户排序偏好 | 🟢 低 |

### 6.3 连接管理优化

| 问题 | 建议 | 优先级 |
|------|------|--------|
| 端口探测延迟 3 秒 | 改为后台异步检测，不阻塞 UI | 🟢 低 |
| 快速导入格式固定 | 支持更多格式解析 | 🟢 低 |

### 6.4 系统监控优化

| 问题 | 建议 | 优先级 |
|------|------|--------|
| 无告警阈值 | CPU/内存/磁盘超过阈值时变色或弹窗提醒 | 🟡 中 |
| 刷新间隔固定 | 已实现可配置刷新间隔 | ✅ 完成 |

---

## 七、用户反馈收集

建议在应用中添加反馈入口，收集真实用户需求：

1. **设置页面** - 添加「反馈建议」入口
2. **GitHub Issues** - 引导用户提交功能请求
3. **版本更新弹窗** - 新版本发布时展示新功能

---

*文档创建时间：2026-03-13*  
*最后更新：2026-03-19 - 基于代码分析整理*