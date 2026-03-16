# 更新日志

本项目的所有重要变更都将记录在此文件中。

## [1.0.0] - 2026-03-16

### 新增功能

- SSH 连接管理，支持多会话
- SFTP 文件浏览器，支持上传/下载/拖拽上传
- 实时系统监控（CPU、内存、磁盘）
- MCP 服务器集成，支持 AI 助手（Claude 等）
- 多标签终端，支持搜索功能
- 连接分组和标签管理
- 中文界面支持

### MCP 工具

| 工具 | 说明 |
|------|------|
| `iter_status` | 检查 iTerminal API 服务状态 |
| `iter_connect` | 创建 SSH 连接 |
| `iter_disconnect` | 断开 SSH 连接 |
| `iter_test_connection` | 测试 SSH 连接 |
| `iter_list_connections` | 列出活跃连接 |
| `iter_exec` | 在远程服务器执行命令 |
| `iter_monitor` | 获取系统监控数据 |
| `iter_list_dir` | 列出远程目录 |
| `iter_mkdir` | 创建目录 |
| `iter_rm` | 删除文件 |
| `iter_rename` | 重命名文件/目录 |

### 技术栈

- 前端：Tauri 2 + React 19 + TypeScript 5
- 后端：Rust + russh + russh-sftp
- MCP：Model Context Protocol SDK
- 跨平台：支持 macOS、Windows、Linux