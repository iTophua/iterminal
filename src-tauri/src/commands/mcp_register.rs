//! MCP server 安装指令生成。
//!
//! MCP server 随 app bundle 分发（tauri resources: mcp-bundle/），不在 npm 发布。
//! 接入方式为"引导 agent 自安装"：把生成的指令文本发给任意 AI 客户端，
//! 由它自己写入 MCP 配置——不为各家配置格式做适配，天然覆盖所有客户端。

use tauri::{AppHandle, Manager};

/// 探测 node 可执行文件：先 which（终端启动时 PATH 完整），
/// 再扫常见安装位（Finder/Dock 启动的 GUI app PATH 不含 homebrew/nvm）。
fn find_node() -> Option<String> {
    let which = if cfg!(windows) { "where" } else { "which" };
    if let Ok(out) = std::process::Command::new(which).arg("node").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout);
            if let Some(first) = s.lines().next() {
                let first = first.trim();
                if !first.is_empty() {
                    return Some(first.to_string());
                }
            }
        }
    }
    let candidates: &[&str] = if cfg!(windows) {
        &[
            r"C:\Program Files\nodejs\node.exe",
            r"C:\Program Files (x86)\nodejs\node.exe",
        ]
    } else {
        &[
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
        ]
    };
    candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}

/// app 内 MCP server 入口脚本路径（tauri resources）
fn mcp_script_path(app: &AppHandle) -> Result<String, String> {
    // dev 模式 resources 未打包，直接用源码树产物（cwd = src-tauri）
    #[cfg(debug_assertions)]
    {
        let dev = std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join("../mcp/dist/index.js");
        if let Ok(p) = dev.canonicalize() {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    let p = dir.join("mcp-bundle").join("dist").join("index.js");
    if !p.exists() {
        return Err(format!("应用内未找到 MCP server（{}），请重新安装 iTerminal", p.display()));
    }
    Ok(p.to_string_lossy().to_string())
}

/// 稳定 launcher：客户端注册的是 `~/.iterminal/bin/mcp-launcher.mjs`（home 下永久不变），
/// launcher 内部指向 app 内置 server。app 每次启动刷新指向，升级/换安装位置后
/// 客户端无需重新注册（"新装 app 打开后 MCP 自动更新"）。
pub fn sync_launcher(app: &AppHandle) -> Result<String, String> {
    let script = mcp_script_path(app)?;
    let home = dirs::home_dir().ok_or("无法定位用户主目录")?;
    let bin = home.join(".iterminal").join("bin");
    std::fs::create_dir_all(&bin).map_err(|e| format!("创建目录失败: {e}"))?;
    let launcher = bin.join("mcp-launcher.mjs");

    // 候选链：生成时嵌入的当前路径在前；app 缺席时按各平台常见安装位置兜底
    let mut candidates = vec![script.clone()];
    if cfg!(target_os = "macos") {
        candidates.push(format!(
            "{}/Applications/iTerminal.app/Contents/Resources/mcp-bundle/dist/index.js",
            home.display()
        ));
        candidates.push("/Applications/iTerminal.app/Contents/Resources/mcp-bundle/dist/index.js".into());
    } else if cfg!(windows) {
        candidates.push(format!(
            "{}\\AppData\\Local\\Programs\\iTerminal\\resources\\mcp-bundle\\dist\\index.js",
            home.display()
        ));
    } else {
        candidates.push("/usr/lib/iterminal/resources/mcp-bundle/dist/index.js".into());
        candidates.push("/usr/share/iterminal/resources/mcp-bundle/dist/index.js".into());
    }
    let candidates_js = serde_json::to_string(&candidates).map_err(|e| e.to_string())?;

    let content = format!(
        r#"#!/usr/bin/env node
// 由 iTerminal 自动生成，请勿手动修改。
// 客户端 MCP 配置指向本文件（永久稳定）；app 启动时会更新内部指向，
// 升级或更换安装位置后自动使用新版 MCP server，客户端无需重新注册。
import {{ existsSync }} from "node:fs";

const candidates = {candidates_js};
const target = candidates.find((p) => existsSync(p));
if (!target) {{
  console.error("[iterminal-mcp] 未找到 iTerminal 内置 MCP server，请先安装并启动 iTerminal 应用");
  process.exit(1);
}}
await import(target);
"#
    );

    // 幂等：内容没变不重写（避免每次启动都动 mtime）
    if std::fs::read_to_string(&launcher).map(|c| c == content).unwrap_or(false) {
        return Ok(launcher.to_string_lossy().to_string());
    }
    std::fs::write(&launcher, &content).map_err(|e| format!("写入 launcher 失败: {e}"))?;
    // 可执行权限（配合 shebang，客户端可直接把本文件作为 command）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&launcher, std::fs::Permissions::from_mode(0o755));
    }
    Ok(launcher.to_string_lossy().to_string())
}

/// 手动触发 launcher 同步（正常由 app 启动自动执行）
#[tauri::command]
pub async fn sync_mcp_launcher(app: AppHandle) -> Result<String, String> {
    sync_launcher(&app)
}

/// 组装"发给任意 AI agent 的安装指令"：由 agent 自己改自己的 MCP 配置。
#[tauri::command]
pub async fn get_mcp_install_instruction(app: AppHandle) -> Result<String, String> {
    let launcher = sync_launcher(&app)?;
    let node = find_node();
    let node_desc = match &node {
        Some(path) => format!("command 用 `{path}`（node 绝对路径）"),
        None => "command 用 `node`（需在 PATH 中；找不到时请先安装 Node.js）".to_string(),
    };
    Ok(format!(
        "请帮我注册 iTerminal 的 MCP server：名称 `iterminal`，stdio 传输，{node_desc}，args 为 `[\"{launcher}\"]`。\
该路径是 iTerminal 的稳定启动器，app 升级后自动使用新版，无需重新注册。\
前提：保持 iTerminal 应用运行（其 API 监听 127.0.0.1:27149；MCP server 会自动读取 ~/.iterminal/mcp_token 完成鉴权，无需配置环境变量）。\
请把它写入你的 MCP 配置并启用，之后重启 MCP 会话即可使用 iter_* 系列工具。"
    ))
}
