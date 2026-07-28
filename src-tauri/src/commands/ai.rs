//! AI 助手模块
//!
//! 通用 OpenAI 兼容客户端：用户填 Base URL + API Key，调用 /v1/chat/completions。
//! 支持 DeepSeek、MiMo、OpenAI、Ollama、LM Studio 等所有 OpenAI 兼容服务。
//!
//! Pro 功能（feature key: ai_assistant）。Free 构建中 check_feature 返回 false，
//! ai_analyze 会拒绝。代码在公开仓库，但受 license 校验守门；无任何编译时密钥。
//!
//! API Key 经 AES-GCM 加密后存数据库 settings 表（key=ai_config），不是编译时常量。

use serde::{Deserialize, Serialize};

use super::db::{get_setting_inner, save_setting_inner};
use super::license::check_feature;
use crate::db::crypto::{decrypt_password, encrypt_password};

// 流式输出所需
use once_cell::sync::Lazy;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, RwLock};
use tokio::task::JoinHandle;
use tokio_stream::StreamExt;

/// settings 表中的 key
const AI_CONFIG_KEY: &str = "ai_config";

/// AI 分析请求类型
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiKind {
    /// 解释报错日志
    ExplainError,
    /// 把自然语言转成 shell 命令
    NatLangToCommand,
}

/// AI 分析结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiResult {
    pub success: bool,
    pub answer: String,
    /// 可直接执行的修复命令（如有）
    pub suggested_command: Option<String>,
}

/// AI 配置（持久化到数据库的明文结构，apiKey 字段会加密）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AiConfigStored {
    /// 如 https://api.deepseek.com 或 http://localhost:11434
    base_url: String,
    /// AES-GCM 加密后的密文
    encrypted_api_key: Option<String>,
    /// 模型 id，如 deepseek-chat / llama3
    model: String,
}

/// 返回给前端的 AI 配置（apiKey 脱敏）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfig {
    pub base_url: String,
    /// 是否已配置 API Key（不回传明文）
    pub has_api_key: bool,
    pub model: String,
}

// ============ 工具函数 ============

/// URL 规范化：去尾 /，若不含 /v1 则补 /v1。
///
/// 用户填 `https://api.deepseek.com`、`https://api.deepseek.com/v1`、
/// `http://localhost:11434/` 都能正确处理成 `.../v1`。
fn normalize_base_url(input: &str) -> String {
    let trimmed = input.trim().trim_end_matches('/');
    if trimmed.ends_with("/v1") {
        trimmed.to_string()
    } else {
        format!("{}/v1", trimmed)
    }
}

/// 从数据库读取原始存储结构（含加密 apiKey，不解密）。未配置返回 None。
fn load_stored_config() -> Result<Option<AiConfigStored>, String> {
    let raw = match get_setting_inner(AI_CONFIG_KEY)? {
        Some(s) if !s.trim().is_empty() => s,
        _ => return Ok(None),
    };
    let cfg: AiConfigStored = serde_json::from_str(&raw)
        .map_err(|e| format!("AI 配置解析失败: {}", e))?;
    Ok(Some(cfg))
}

/// 从数据库读取配置（解密 apiKey）。未配置时返回 None。
fn load_config() -> Result<Option<(String, Option<String>, String)>, String> {
    let cfg = match load_stored_config()? {
        Some(c) => c,
        None => return Ok(None),
    };
    let api_key = cfg.encrypted_api_key.and_then(|enc| decrypt_password(&enc));
    Ok(Some((cfg.base_url, api_key, cfg.model)))
}

/// 提取 Markdown 代码块中的命令。
///
/// 取首个非空 ``` 代码块；都没有时，若整段是单行短文本（且不像句子）则当作命令，否则 None。
///
/// 设计：prompt 已要求模型只给一条命令，所以取第一个块即可，无需跨块挑语言。
fn extract_command(content: &str) -> Option<String> {
    let mut in_block = false;
    let mut buf: Vec<String> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            if !in_block {
                in_block = true;
                buf.clear();
            } else {
                // 块结束：取首个非空代码块即返回
                in_block = false;
                let code = buf.join("\n").trim().to_string();
                if !code.is_empty() {
                    return Some(code);
                }
            }
        } else if in_block {
            buf.push(line.to_string());
        }
    }

    // 循环未返回（无代码块）：若整段是单行短文本（且不像句子）则当作命令
    None.or_else(|| {
        let single = content.trim();
        if !single.is_empty()
            && !single.contains('\n')
            && single.len() < 200
            && !single.ends_with('。')
        {
            Some(single.to_string())
        } else {
            None
        }
    })
}

/// 构造系统 prompt
fn system_prompt(kind: &AiKind) -> &'static str {
    match kind {
        AiKind::ExplainError => {
            "你是一位资深的 Linux/Unix 系统工程师，擅长诊断终端报错。\n\
             用户会给你一段终端输出或报错日志。请：\n\
             1. 用简洁的中文解释报错原因；\n\
             2. 给出可执行的修复建议；\n\
             3. 如果有可以直接运行的 shell 命令，放在一个 ```bash 代码块里输出。\n\
             回答控制在 200 字以内，直奔重点，不要寒暄。"
        }
        AiKind::NatLangToCommand => {
            "你是一位 Linux/Unix 命令行专家。用户用自然语言描述想做的事情，\
             请输出对应的 shell 命令。要求：\n\
             - 把命令放在一个 ```bash 代码块里；\n\
             - 代码块前可加一句简短说明（不超过一句）；\n\
             - 只给最常用的可移植写法，不要罗列多种变体。"
        }
    }
}

// ============ LLM 调用 ============

/// 一条 chat 消息（OpenAI 格式）
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChatMessage {
    role: String,    // system | user | assistant
    content: String,
}

impl ChatMessage {
    fn system(content: impl Into<String>) -> Self {
        Self { role: "system".into(), content: content.into() }
    }
    fn user(content: impl Into<String>) -> Self {
        Self { role: "user".into(), content: content.into() }
    }
    fn assistant(content: impl Into<String>) -> Self {
        Self { role: "assistant".into(), content: content.into() }
    }
}

/// 调用 OpenAI 兼容的 /v1/chat/completions
async fn call_chat(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[ChatMessage],
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

    let url = format!("{}/chat/completions", base_url);

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "stream": false
        }));

    // 本地推理引擎（Ollama / LM Studio）不强校验，但带了也无妨
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;

    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        // 截断超长错误响应
        let snippet = if body.len() > 500 {
            format!("{}...", &body[..500])
        } else {
            body
        };
        return Err(format!("LLM 服务返回 {} : {}", status.as_u16(), snippet));
    }

    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("响应不是合法 JSON: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| "响应中未找到 choices[0].message.content".to_string())?;

    Ok(content.to_string())
}

// ============ Tauri 命令 ============

/// AI 分析（Pro 功能）
#[tauri::command]
pub async fn ai_analyze(text: String, kind: AiKind) -> Result<AiResult, String> {
    // Pro 功能校验
    if !check_feature("ai_assistant").await {
        return Err("AI 助手是专业版功能，请激活 Pro License 后使用".into());
    }

    // 读配置
    let (base_url_raw, api_key, model) = match load_config()? {
        Some(c) => c,
        None => {
            return Ok(AiResult {
                success: false,
                answer: "尚未配置 AI 服务。请到「设置 → AI 助手」填写 Base URL、API Key 和模型。".into(),
                suggested_command: None,
            })
        }
    };

    let base_url = normalize_base_url(&base_url_raw);

    let system = system_prompt(&kind);
    let user = text.trim();
    if user.is_empty() {
        return Err("待分析内容为空".into());
    }

    let messages = vec![
        ChatMessage::system(system),
        ChatMessage::user(user),
    ];
    let content = match call_chat(&base_url, api_key.as_deref(), &model, &messages).await {
        Ok(c) => c,
        Err(e) => {
            return Ok(AiResult {
                success: false,
                answer: format!("调用 LLM 失败: {}", e),
                suggested_command: None,
            })
        }
    };

    // 自然语言转命令时提取代码块作为建议命令
    let suggested = match kind {
        AiKind::NatLangToCommand => extract_command(&content),
        AiKind::ExplainError => extract_command(&content),
    };

    Ok(AiResult {
        success: true,
        answer: content,
        suggested_command: suggested,
    })
}

/// 获取 AI 配置（apiKey 脱敏）
#[tauri::command]
pub async fn get_ai_config() -> Result<AiConfig, String> {
    let (base_url, api_key, model) = match load_config()? {
        Some(c) => c,
        None => {
            return Ok(AiConfig {
                base_url: String::new(),
                has_api_key: false,
                model: String::new(),
            })
        }
    };
    Ok(AiConfig {
        base_url,
        has_api_key: api_key.is_some(),
        model,
    })
}

/// 保存 AI 配置。
///
/// - `api_key` 传 None 表示保持原有 key 不变；传 Some("") 表示清空；
///   传 Some("sk-xxx") 表示更新。
#[tauri::command]
pub async fn save_ai_config(
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<AiConfig, String> {
    let base_url = normalize_base_url(&base_url);

    // apiKey 取舍：None=保持原样；Some("")=清空；Some("sk-xxx")=加密更新
    let encrypted_api_key: Option<String> = match api_key.as_deref().map(str::trim) {
        None => load_stored_config()?.and_then(|c| c.encrypted_api_key),
        Some("") => None,
        Some(k) => Some(encrypt_password(k)),
    };

    let has_key = encrypted_api_key.is_some();
    let stored = AiConfigStored {
        base_url: base_url.clone(),
        encrypted_api_key,
        model: model.clone(),
    };
    let json = serde_json::to_string(&stored)
        .map_err(|e| format!("序列化配置失败: {}", e))?;
    save_setting_inner(AI_CONFIG_KEY, &json)?;

    Ok(AiConfig {
        base_url,
        has_api_key: has_key,
        model,
    })
}

/// 解析最终使用的 API Key：传入非空就用传入的；否则回退到已存的。
///
/// 用于 list_ai_models / test_ai_connection：用户在 UI 上可能只改了 baseUrl
/// 没重新输入密钥，此时用已存的密钥即可。
fn resolve_api_key(input: Option<&str>) -> Result<Option<String>, String> {
    if let Some(k) = input {
        let k = k.trim();
        if !k.is_empty() {
            return Ok(Some(k.to_string()));
        }
    }
    // 回退到已存配置
    match load_config()? {
        Some((_, stored_key, _)) => Ok(stored_key),
        None => Ok(None),
    }
}

/// 拉取可用模型列表（GET /v1/models）
#[tauri::command]
pub async fn list_ai_models(base_url: String, api_key: Option<String>) -> Result<Vec<String>, String> {
    let base = normalize_base_url(&base_url);
    let resolved_key = resolve_api_key(api_key.as_deref())?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

    let url = format!("{}/models", base);
    let mut req = client.get(&url).header("Content-Type", "application/json");
    if let Some(k) = resolved_key.as_deref() {
        req = req.bearer_auth(k);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body = resp
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {}", e))?;
    if !status.is_success() {
        let snippet = if body.len() > 300 { &body[..300] } else { &body };
        return Err(format!("服务返回 {} : {}", status.as_u16(), snippet));
    }

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("响应不是合法 JSON: {}", e))?;

    let models = json["data"]
        .as_array()
        .ok_or_else(|| "响应中未找到 data 数组".to_string())?;

    let mut ids: Vec<String> = models
        .iter()
        .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
        .collect();
    ids.sort();
    Ok(ids)
}

/// 测试连接（发一次最短的 chat 请求验证连通 + 鉴权）
#[tauri::command]
pub async fn test_ai_connection(
    base_url: String,
    api_key: Option<String>,
    model: String,
) -> Result<String, String> {
    let base = normalize_base_url(&base_url);
    if model.trim().is_empty() {
        return Err("请先填写模型名称或拉取模型".into());
    }
    let resolved_key = resolve_api_key(api_key.as_deref())?;
    // 用最短请求探测
    let messages = vec![
        ChatMessage::system("You are a helper."),
        ChatMessage::user("ping"),
    ];
    match call_chat(&base, resolved_key.as_deref(), &model, &messages).await {
        Ok(content) => {
            // 截断显示
            let preview = if content.len() > 80 {
                format!("{}...", &content[..80])
            } else {
                content
            };
            Ok(format!("连接成功。模型回复: {}", preview))
        }
        Err(e) => Err(e),
    }
}

// ============ 多轮对话 ============

/// 终端上下文快照（前端采集，随对话消息发送）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalContext {
    /// 活动终端最近 N 行输出（已截断）
    pub recent_output: Option<String>,
    /// 当前选中的文本
    pub selection: Option<String>,
    /// 当前工作目录（来自 SFTP 文件管理，可能为空）
    pub cwd: Option<String>,
}

/// chat 系统提示词：强调运维助手 + 善用上下文
fn chat_system_prompt() -> &'static str {
    "你是一位资深 Linux/Unix 运维助手，正在协助用户管理 SSH 服务器。\n\
     用户消息可能附带当前终端的上下文（最近输出、选中的文本、当前目录），\n\
     请基于这些上下文回答。要求：\n\
     - 回答简洁，用中文；\n\
     - 给出的 shell 命令放在一个 ```bash 代码块里；\n\
     - 不要臆测缺失的信息，必要时先问用户；\n\
     - 涉及危险操作（rm、kill、重启服务、改权限）时提醒风险。"
}

/// 把终端上下文拼成模型易识别的文本（XML 标签包裹）
fn format_context_text(ctx: &TerminalContext) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(s) = ctx.selection.as_deref() {
        if !s.trim().is_empty() {
            parts.push(format!("<selected_text>\n{}\n</selected_text>", s.trim()));
        }
    }
    if let Some(o) = ctx.recent_output.as_deref() {
        if !o.trim().is_empty() {
            // 后端兜底再截一次（前端应已截断），防止前端漏截导致 token 爆炸
            let truncated = truncate_lines(o.trim(), 200);
            parts.push(format!("<recent_terminal_output>\n{}\n</recent_terminal_output>", truncated));
        }
    }
    if let Some(c) = ctx.cwd.as_deref() {
        if !c.trim().is_empty() {
            parts.push(format!("<current_directory>{}</current_directory>", c.trim()));
        }
    }
    parts.join("\n\n")
}

/// 截断终端输出到最多 max_lines 行，避免 token 爆炸
fn truncate_lines(s: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = s.lines().collect();
    if lines.len() <= max_lines {
        return s.to_string();
    }
    let start = lines.len() - max_lines;
    let mut out = format!("...（已省略前 {} 行）...\n", start);
    out.push_str(&lines[start..].join("\n"));
    out
}

/// 多轮对话返回的消息，直接复用 db 模块的 AiMessage
pub use super::db::AiMessage;

/// 多轮对话发送一条用户消息，返回 assistant 回复。
///
/// Pro 功能（ai_assistant）。流程：
/// 1. 读取对话历史 → 构造 messages
/// 2. 把终端上下文拼进本轮 user 消息前部
/// 3. 存 user 消息 → 调 LLM → 存 assistant 消息 → 返回
/// 4. 首条消息时自动用 user_text 前 20 字作对话标题
#[tauri::command]
pub async fn ai_chat(
    conversation_id: String,
    user_text: String,
    context: Option<TerminalContext>,
) -> Result<AiMessage, String> {
    // Pro 功能校验
    if !check_feature("ai_assistant").await {
        return Err("AI 助手是专业版功能，请激活 Pro License 后使用".into());
    }

    // 读配置
    let (base_url_raw, api_key, model) = match load_config()? {
        Some(c) => c,
        None => {
            return Err("尚未配置 AI 服务。请到「设置 → AI 助手」填写 Base URL、API Key 和模型。".into());
        }
    };
    let base_url = normalize_base_url(&base_url_raw);

    let user_text = user_text.trim();
    if user_text.is_empty() {
        return Err("消息内容为空".into());
    }

    // 构造发给模型的 user 内容（上下文 + 原文）
    let context_text = match context.as_ref().map(format_context_text) {
        Some(t) if !t.is_empty() => format!(
            "以下是当前终端的上下文，供你参考：\n\n{}\n\n---\n\n我的问题：\n{}",
            t, user_text
        ),
        _ => user_text.to_string(),
    };

    // 读取历史消息
    let history = super::db::get_ai_messages(conversation_id.clone())
        .map_err(|e| format!("读取对话历史失败: {}", e))?;

    // 是否首条消息（用于自动生成标题）
    let is_first = history.is_empty();

    // 存 user 消息（存原文 user_text，上下文快照存 context JSON 字段）
    let context_json = match &context {
        Some(ctx) => serde_json::to_string(ctx).ok(),
        None => None,
    };
    super::db::save_ai_message(
        conversation_id.clone(),
        "user".into(),
        user_text.to_string(),
        context_json,
    )
    .map_err(|e| format!("保存消息失败: {}", e))?;

    // 构造完整 messages：system + 截断历史 + 本轮（应用滑动窗口 + token 上限）
    let messages = build_messages_with_context_limit(
        chat_system_prompt(),
        &history,
        &context_text,
    );

    // 调 LLM
    let reply = call_chat(&base_url, api_key.as_deref(), &model, &messages)
        .await
        .map_err(|e| format!("调用 LLM 失败: {}", e))?;

    // 存 assistant 回复
    let assistant_msg = super::db::save_ai_message(
        conversation_id.clone(),
        "assistant".into(),
        reply.clone(),
        None,
    )
    .map_err(|e| format!("保存回复失败: {}", e))?;

    // 首条消息：自动生成标题（取 user_text 前 20 字）
    if is_first {
        let title: String = user_text.chars().take(20).collect();
        let title = if user_text.chars().count() > 20 {
            format!("{}…", title)
        } else {
            title
        };
        let _ = super::db::rename_ai_conversation(conversation_id, title);
    }

    Ok(assistant_msg)
}

// ============ 流式输出 ============

/// SSE 解析：从一行 SSE 数据中提取 delta.content（若无则返回 None）。
///
/// 输入是单个 SSE 事件的数据部分（已去掉 `data: ` 前缀的 JSON 串）。
/// 返回 (delta_content, is_done)。`[DONE]` 时 is_done=true。
fn parse_sse_delta(data: &str) -> (Option<String>, bool) {
    let trimmed = data.trim();
    if trimmed == "[DONE]" {
        return (None, true);
    }
    if trimmed.is_empty() {
        return (None, false);
    }
    let json: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return (None, false), // 忽略非 JSON 行（如注释/心跳）
    };
    let delta = json["choices"][0]["delta"]["content"]
        .as_str()
        .map(|s| s.to_string());
    (delta, false)
}

/// 把 SSE 原始字节缓冲按事件拆分。
///
/// SSE 事件以空行（`\n\n`）分隔。返回 (完整事件列表, 剩余未完成的缓冲)。
/// 每个事件可能含多行 `data:`，这里按行返回所有 `data:` 内容。
fn split_sse_events(buf: &str) -> (Vec<Vec<String>>, String) {
    let mut events: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::new();
    let mut remainder = String::new();

    for line in buf.split_inclusive('\n') {
        if line.ends_with('\n') {
            let line_content = line.trim_end_matches('\n');
            if line_content.is_empty() {
                // 事件结束
                if !current.is_empty() {
                    events.push(std::mem::take(&mut current));
                }
            } else if let Some(data) = line_content.strip_prefix("data:") {
                current.push(data.trim_start_matches(' ').to_string());
            }
            // 其它行（如 `event:`/`id:`/注释）忽略
        } else {
            // 末尾不完整行
            remainder = line.to_string();
        }
    }
    (events, remainder)
}

/// 活跃的流式对话任务
struct ActiveChat {
    task: JoinHandle<()>,
    cancel: oneshot::Sender<()>,
}

static CHATS: Lazy<RwLock<HashMap<String, ActiveChat>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// 流式调用 OpenAI 兼容 /v1/chat/completions。
///
/// 每个 token 通过 `on_delta` 回调返回。返回完整的拼接内容。
async fn call_chat_stream<F>(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[ChatMessage],
    mut on_delta: F,
) -> Result<String, String>
where
    F: FnMut(&str),
{
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

    let url = format!("{}/chat/completions", base_url);
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "stream": true
        }));
    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        let snippet = if body.len() > 500 { format!("{}...", &body[..500]) } else { body };
        return Err(format!("LLM 服务返回 {} : {}", status.as_u16(), snippet));
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("读取流失败: {}", e))?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        let (events, remainder) = split_sse_events(&buf);
        buf = remainder;

        for data_lines in events {
            for data in data_lines {
                let (delta, is_done) = parse_sse_delta(&data);
                if is_done {
                    return Ok(full);
                }
                if let Some(d) = delta {
                    on_delta(&d);
                    full.push_str(&d);
                }
            }
        }
    }

    // 流自然结束（无 [DONE]）：处理剩余缓冲
    if !buf.trim().is_empty() {
        let (events, _) = split_sse_events(&format!("{}\n\n", buf));
        for data_lines in events {
            for data in data_lines {
                let (delta, is_done) = parse_sse_delta(&data);
                if is_done {
                    return Ok(full);
                }
                if let Some(d) = delta {
                    on_delta(&d);
                    full.push_str(&d);
                }
            }
        }
    }

    Ok(full)
}

/// 流式多轮对话。立即返回 request_id，结果通过事件 ai-chat-chunk-{requestId} 推送。
///
/// 事件 payload 为 ChatChunk：`{delta}` 增量 / `{done:true}` 结束 / `{error}` 出错。
#[tauri::command]
pub async fn ai_chat_stream(
    conversation_id: String,
    user_text: String,
    context: Option<TerminalContext>,
    request_id: String,
    app: AppHandle,
    agent_mode: Option<bool>,
    connection_id_for_agent: Option<String>,
) -> Result<(), String> {
    if !check_feature("ai_assistant").await {
        return Err("AI 助手是专业版功能，请激活 Pro License 后使用".into());
    }

    let (base_url_raw, api_key, model) = match load_config()? {
        Some(c) => c,
        None => {
            return Err("尚未配置 AI 服务。请到「设置 → AI 助手」填写 Base URL、API Key 和模型。".into());
        }
    };
    let base_url = normalize_base_url(&base_url_raw);

    let user_text = user_text.trim().to_string();
    if user_text.is_empty() {
        return Err("消息内容为空".into());
    }

    let context_text = match context.as_ref().map(format_context_text) {
        Some(t) if !t.is_empty() => format!(
            "以下是当前终端的上下文，供你参考：\n\n{}\n\n---\n\n我的问题：\n{}",
            t, user_text
        ),
        _ => user_text.clone(),
    };

    // 读历史 + 存 user 消息 + 构造 messages（应用滑动窗口 + token 上限）
    let history = super::db::get_ai_messages(conversation_id.clone())
        .map_err(|e| format!("读取对话历史失败: {}", e))?;
    let is_first = history.is_empty();

    let context_json = match &context {
        Some(ctx) => serde_json::to_string(ctx).ok(),
        None => None,
    };
    super::db::save_ai_message(
        conversation_id.clone(),
        "user".into(),
        user_text.clone(),
        context_json,
    )
    .map_err(|e| format!("保存消息失败: {}", e))?;

    let messages = build_messages_with_context_limit(
        chat_system_prompt(),
        &history,
        &context_text,
    );

    let event_name = format!("ai-chat-chunk-{}", request_id);

    // 判断是否走 Agent 模式
    let use_agent = agent_mode.unwrap_or(false)
        && connection_id_for_agent.is_some();

    let (cancel_tx, mut cancel_rx) = oneshot::channel::<()>();
    let app_for_task = app.clone();
    let conv_id = conversation_id.clone();
    let evt = event_name.clone();
    let req_id = request_id.clone();

    let task: JoinHandle<()> = tokio::spawn(async move {
        let result: Result<String, String> = if use_agent {
            // ---- Agent 模式 ----
            // 把 ChatMessage 转为 serde_json::Value，并替换 system prompt
            let conn_id = connection_id_for_agent.as_ref().unwrap().clone();
            let mut agent_messages: Vec<serde_json::Value> = Vec::new();
            agent_messages.push(serde_json::json!({
                "role": "system",
                "content": agent_system_prompt()
            }));
            // 历史消息（跳过原 system）
            for m in &messages {
                if m.role == "system" {
                    continue;
                }
                agent_messages.push(serde_json::json!({
                    "role": m.role,
                    "content": m.content
                }));
            }

            // Agent loop 内部通过 try_recv 检查取消
            run_agent_loop(
                &base_url,
                api_key.as_deref(),
                &model,
                agent_messages,
                &conn_id,
                &app_for_task,
                &evt,
                &mut cancel_rx,
                &req_id,
            )
            .await
        } else {
            // ---- 普通流式模式 ----
            let result = tokio::select! {
                _ = &mut cancel_rx => {
                    let _ = app_for_task.emit(&evt, ChatChunk {
                        delta: None, done: true, error: Some("已停止".into()), tool: None,
                    });
                    return;
                }
                r = call_chat_stream(&base_url, api_key.as_deref(), &model, &messages, |d| {
                    let _ = app_for_task.emit(&evt, ChatChunk {
                        delta: Some(d.to_string()), done: false, error: None, tool: None,
                    });
                }) => r
            };
            result
        };

        match result {
            Ok(full) => {
                // 存 assistant 回复
                let _ = super::db::save_ai_message(
                    conv_id.clone(),
                    "assistant".into(),
                    full,
                    None,
                );
                let _ = app_for_task.emit(&evt, ChatChunk {
                    delta: None, done: true, error: None, tool: None,
                });
            }
            Err(e) => {
                let _ = app_for_task.emit(&evt, ChatChunk {
                    delta: None, done: true, error: Some(e), tool: None,
                });
            }
        }
    });

    CHATS.write().await.insert(
        request_id.clone(),
        ActiveChat { task, cancel: cancel_tx },
    );

    // 首条消息自动生成标题
    if is_first {
        let title: String = user_text.chars().take(20).collect();
        let title = if user_text.chars().count() > 20 {
            format!("{}…", title)
        } else {
            title
        };
        let _ = super::db::rename_ai_conversation(conversation_id, title);
    }

    Ok(())
}

/// 停止正在进行的流式对话
#[tauri::command]
pub async fn stop_ai_chat(request_id: String) -> Result<bool, String> {
    let mut chats = CHATS.write().await;
    if let Some(chat) = chats.remove(&request_id) {
        let _ = chat.cancel.send(()); // 协作式取消（让 task 发 done 事件）
        chat.task.abort(); // 硬取消兜底
        Ok(true)
    } else {
        Ok(false) // 不存在视为已结束
    }
}

// ============ 上下文管理（滑动窗口 + token 估算）============

/// 保留最近多少轮对话（1 轮 = 1 条 user + 1 条 assistant）
const CONTEXT_KEEP_RECENT_ROUNDS: usize = 6;
/// 上下文 token 硬上限（为 system prompt + 模型输出预留空间）
/// 大多数模型上下文窗口 ≥ 4K；这里保守地限制历史部分
const CONTEXT_MAX_TOKENS: usize = 6000;

/// 粗略估算字符串的 token 数（约 4 字符 = 1 token，中文字符密度更高按 2 字符算）。
/// 不引入 tiktoken 等重依赖，误差可接受（用于截断决策而非精确计费）。
fn estimate_tokens(text: &str) -> usize {
    let cjk_count = text.chars().filter(|c| {
        (*c >= '\u{4E00}' && *c <= '\u{9FFF}')      // CJK 统一汉字
        || (*c >= '\u{3040}' && *c <= '\u{30FF}')    // 平假名 + 片假名
        || (*c >= '\u{AC00}' && *c <= '\u{D7A3}')    // 韩文音节
    }).count();

    let other_chars = text.chars().count() - cjk_count;
    // CJK 字符约 1 字符 = 1 token；英文约 4 字符 = 1 token；至少 1 token
    let other_tokens = if other_chars == 0 { 0 } else { (other_chars + 3) / 4 };
    (cjk_count + other_tokens).max(1)
}

/// 从历史消息中构造发给 LLM 的 messages 数组，应用滑动窗口 + token 上限。
///
/// 策略：
/// 1. system prompt 永远保留
/// 2. 保留最近 N 轮对话（user + assistant 配对）
/// 3. 如果仍超 token 上限，从最早的历史开始丢弃，直到满足限制
///
/// 返回完整的 messages 数组（system + 截断后的历史 + 本轮 user）。
fn build_messages_with_context_limit(
    system_prompt: &str,
    history: &[super::db::AiMessage],
    current_user_text: &str,
) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage::system(system_prompt)];

    // 只保留 user / assistant 消息，按时间顺序（DB 已按 created_at ASC 返回）
    let history_msgs: Vec<&super::db::AiMessage> = history
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .collect();

    // 配对成轮次（user + assistant），从后往前保留最近 N 轮。
    // 倒序遍历（i 从 len 递减），用 insert(0,...) 保持正序输出。
    let mut recent: Vec<&super::db::AiMessage> = Vec::new();
    let mut rounds = 0usize;
    let mut i = history_msgs.len();

    while i > 0 && rounds < CONTEXT_KEEP_RECENT_ROUNDS {
        i -= 1;
        let msg = &history_msgs[i];
        recent.insert(0, msg);

        // 如果当前是 assistant 且前一条是 user → 配对保留（算同一轮）
        if msg.role == "assistant" && i > 0 && history_msgs[i - 1].role == "user" {
            i -= 1;
            recent.insert(0, &history_msgs[i]);
        }
        rounds += 1;
    }

    // 计算当前保留消息的 token 估算
    let system_tokens = estimate_tokens(system_prompt);
    let user_tokens = estimate_tokens(current_user_text);
    let mut budget = CONTEXT_MAX_TOKENS.saturating_sub(system_tokens + user_tokens);

    // 从最新的消息往前保留，直到 token 预算用完
    let mut kept: Vec<&super::db::AiMessage> = Vec::new();
    for msg in recent.iter().rev() {
        let t = estimate_tokens(&msg.content);
        if t > budget {
            break;
        }
        budget -= t;
        kept.insert(0, *msg);
    }

    // 如果截断导致开头是 assistant 消息（没有对应 user），去掉它
    // （某些模型要求第一条非 system 消息是 user）
    while kept.first().map_or(false, |m| m.role == "assistant") {
        kept.remove(0);
    }

    for m in &kept {
        match m.role.as_str() {
            "user" => messages.push(ChatMessage::user(&m.content)),
            "assistant" => messages.push(ChatMessage::assistant(&m.content)),
            _ => {}
        }
    }

    messages.push(ChatMessage::user(current_user_text));
    messages
}

// ============ AI Agent（智能体）============

/// Agent 最大工具调用轮次（防死循环）
/// 诊断类任务（如 OOM 排查、链路分析）常需连续执行 8-12 个命令收集信息，
/// 设为 20 给足空间，仍能防止真正的死循环。
const MAX_AGENT_ROUNDS: usize = 20;

/// 工具执行输出截断字符数（防 token 爆炸）
const TOOL_OUTPUT_MAX_CHARS: usize = 4000;

/// Agent 系统提示词
fn agent_system_prompt() -> &'static str {
    "你是一位资深 Linux/Unix 运维专家，具备 SSH 服务器管理能力。\n\
     你可以使用工具在远程服务器上执行命令来诊断和解决问题。\n\n\
     工作方式：\n\
     1. 分析用户问题，决定需要哪些信息\n\
     2. 调用工具执行命令收集信息（一次调用一个工具）\n\
     3. 基于结果分析，如需更多信息继续调用工具\n\
     4. 信息充足后给出诊断结论和建议\n\n\
     规则：\n\
     - 优先用只读命令（ps, docker ps, free, cat, ls, systemctl status）收集信息\n\
     - 不要随意修改系统，涉及修改操作时先说明目的\n\
     - 命令执行结果会自动返回给你，不需要用户手动复制\n\
     - 最终回复用中文，命令用 ```bash 代码块\n\
     - 涉及危险操作（rm、kill、重启服务）时提醒风险"
}

/// Agent 可用的工具定义（OpenAI function calling 格式）
fn agent_tools() -> serde_json::Value {
    serde_json::json!([
        {
            "type": "function",
            "function": {
                "name": "exec_command",
                "description": "在远程服务器上执行 shell 命令，返回 stdout。用于查看系统状态、诊断问题。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": {
                            "type": "string",
                            "description": "要执行的 shell 命令"
                        }
                    },
                    "required": ["command"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "读取远程服务器上的文件内容（前 100 行）。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "文件的绝对路径"
                        }
                    },
                    "required": ["path"]
                }
            }
        }
    ])
}

/// 危险命令模式列表（匹配到则需用户确认）
const DANGER_PATTERNS: &[&str] = &[
    "rm -rf", "rm -fr", "rmdir", "mkfs", "dd if=", "shutdown", "reboot",
    "halt", "init 0", "init 6", ">/dev/sd", ":(){ :|:& };:",
    "chmod -r 777 /", "chmod 777", "mv /* ", "| sh", "| bash", "|/sh", "|/bash",
    "kill -9 1", "kill -9 -1", "killall", "iptables -f", "userdel", "usermod",
    "docker rm", "docker rmi", "docker system prune", "docker volume rm",
    "drop table", "drop database", "truncate table",
    "passwd", "chage", "visudo", "systemctl stop", "systemctl disable",
    "service stop", "fdisk", "parted", "wipefs",
];

/// 检测命令是否危险（需要用户确认）
fn is_dangerous_command(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();
    for pattern in DANGER_PATTERNS {
        if lower.contains(pattern) {
            return true;
        }
    }
    false
}

/// 工具执行事件（推送给前端展示中间步骤）
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolEvent {
    name: String,
    args: String,
    /// running | done | confirm
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    success: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    confirm_id: Option<String>,
}

/// ChatChunk 扩展：增加 tool 字段
/// （重新定义，覆盖原有 ChatChunk）
#[derive(Debug, Clone, Serialize)]
struct ChatChunk {
    delta: Option<String>,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<ToolEvent>,
}

/// LLM tool call 解析结果
struct ToolCallInfo {
    /// OpenAI tool_call id
    id: String,
    /// 函数名
    name: String,
    /// 参数值（已从 JSON 中提取出的可读字符串）
    args: String,
}

/// LLM 响应：可能包含 tool_calls 或最终文本
struct LlmToolResponse {
    /// 最终文本回复（无 tool_calls 时有值）
    content: String,
    /// 工具调用列表
    tool_calls: Vec<ToolCallInfo>,
    /// 原始 assistant 消息 JSON（含 tool_calls），用于加入历史
    raw_assistant_msg: serde_json::Value,
}

/// 带工具调用能力的 LLM 请求（非流式）
async fn call_chat_with_tools(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[serde_json::Value],
) -> Result<LlmToolResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

    let url = format!("{}/chat/completions", base_url);
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "tools": agent_tools(),
            "tool_choice": "auto",
            "temperature": 0.2,
            "stream": false
        }));

    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        let snippet = if body.len() > 500 {
            format!("{}...", &body[..500])
        } else {
            body
        };
        return Err(format!("LLM 服务返回 {} : {}", status.as_u16(), snippet));
    }

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("响应不是合法 JSON: {}", e))?;

    let msg = &json["choices"][0]["message"];

    // 提取 tool_calls（如果有）
    let mut tool_calls = Vec::new();
    if let Some(tc_array) = msg["tool_calls"].as_array() {
        for tc in tc_array {
            let id = tc["id"].as_str().unwrap_or("").to_string();
            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
            let args_raw = tc["function"]["arguments"].as_str().unwrap_or("{}");

            // 从 JSON 参数中提取可读的参数值
            let args_display = extract_tool_args(&name, args_raw);

            tool_calls.push(ToolCallInfo {
                id,
                name,
                args: args_display,
            });
        }
    }

    let content = msg["content"].as_str().unwrap_or("").to_string();

    // 构造原始 assistant 消息（含 tool_calls 的完整结构，用于历史）
    let raw_assistant_msg = msg.clone();

    Ok(LlmToolResponse {
        content,
        tool_calls,
        raw_assistant_msg,
    })
}

/// 从工具调用的 JSON 参数中提取可读的参数值（用于前端展示）
fn extract_tool_args(name: &str, args_json: &str) -> String {
    let parsed: serde_json::Value = match serde_json::from_str(args_json) {
        Ok(v) => v,
        Err(_) => return args_json.to_string(),
    };
    match name {
        "exec_command" => parsed["command"].as_str().unwrap_or(args_json).to_string(),
        "read_file" => parsed["path"].as_str().unwrap_or(args_json).to_string(),
        _ => args_json.to_string(),
    }
}

/// 执行一个工具调用，返回 (output, success)
async fn execute_tool(
    name: &str,
    args_json: &str,
    connection_id: &str,
) -> Result<(String, bool), String> {
    let parsed: serde_json::Value = serde_json::from_str(args_json).unwrap_or_default();

    let (command, _cmd_desc) = match name {
        "exec_command" => {
            let cmd = parsed["command"]
                .as_str()
                .ok_or("缺少 command 参数")?;
            (cmd.to_string(), cmd.to_string())
        }
        "read_file" => {
            let path = parsed["path"].as_str().ok_or("缺少 path 参数")?;
            (format!("head -n 100 '{}'", path), format!("读取 {}", path))
        }
        _ => return Err(format!("未知工具: {}", name)),
    };

    // 调用 SSH execute_command
    let result = super::ssh::execute_command(connection_id.to_string(), command)
        .await
        .map_err(|e| format!("命令执行失败: {}", e))?;

    let mut output = result.output;
    if let Some(err) = &result.error {
        if !err.trim().is_empty() {
            output.push_str("\n[stderr] ");
            output.push_str(err);
        }
    }

    // 截断超长输出（按字符边界安全截断，避免切到 UTF-8 多字节字符中间）
    if output.len() > TOOL_OUTPUT_MAX_CHARS {
        let truncated: String = output.chars().take(TOOL_OUTPUT_MAX_CHARS).collect();
        output = format!(
            "{}...\n（已截断，共 {} 字符）",
            truncated,
            output.chars().count()
        );
    }

    Ok((output, result.success))
}

/// Agent 循环：自主调用工具 → 分析结果 → 最终回复
///
/// 返回最终文本回复（已通过事件流式推送）。
async fn run_agent_loop(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: Vec<serde_json::Value>,
    connection_id: &str,
    app: &AppHandle,
    event_name: &str,
    cancel_rx: &mut oneshot::Receiver<()>,
    request_id: &str,
) -> Result<String, String> {
    let mut current_messages = messages;

    for _round in 0..MAX_AGENT_ROUNDS {
        // 检查取消（非阻塞）
        match cancel_rx.try_recv() {
            Ok(_) | Err(oneshot::error::TryRecvError::Closed) => {
                return Err("已取消".into());
            }
            Err(oneshot::error::TryRecvError::Empty) => {}
        }

        // 1. 调用 LLM（带 tools）
        let response = call_chat_with_tools(base_url, api_key, model, &current_messages).await?;

        // 2. 如果有 tool_calls → 执行工具
        if !response.tool_calls.is_empty() {
            // 把 assistant 的 tool_calls 消息加入历史
            current_messages.push(response.raw_assistant_msg);

            for call in &response.tool_calls {
                // 通知前端：工具开始执行
                let _ = app.emit(
                    event_name,
                    ChatChunk {
                        delta: None,
                        done: false,
                        error: None,
                        tool: Some(ToolEvent {
                            name: call.name.clone(),
                            args: call.args.clone(),
                            status: "running".into(),
                            result: None,
                            success: None,
                            confirm_id: None,
                        }),
                    },
                );

                // 3. 危险命令 → 前端确认
                if is_dangerous_command(&call.args) {
                    let confirm_id = format!("confirm-{}-{}", request_id, gen_id());

                    // 通知前端：需要确认
                    let _ = app.emit(
                        event_name,
                        ChatChunk {
                            delta: None,
                            done: false,
                            error: None,
                            tool: Some(ToolEvent {
                                name: call.name.clone(),
                                args: call.args.clone(),
                                status: "confirm".into(),
                                result: None,
                                success: None,
                                confirm_id: Some(confirm_id.clone()),
                            }),
                        },
                    );

                    // 等待用户确认
                    let approved = wait_for_confirmation(&confirm_id).await;

                    if !approved {
                        // 用户拒绝 → 告诉 AI
                        let tool_result_msg = serde_json::json!({
                            "role": "tool",
                            "tool_call_id": call.id,
                            "content": "用户拒绝了此命令的执行"
                        });
                        current_messages.push(tool_result_msg);

                        let _ = app.emit(
                            event_name,
                            ChatChunk {
                                delta: None,
                                done: false,
                                error: None,
                                tool: Some(ToolEvent {
                                    name: call.name.clone(),
                                    args: call.args.clone(),
                                    status: "done".into(),
                                    result: Some("用户拒绝执行".into()),
                                    success: Some(false),
                                    confirm_id: None,
                                }),
                            },
                        );
                        continue;
                    }
                }

                // 4. 执行工具
                // 重新构造原始 args JSON 用于 execute_tool
                let key = if call.name == "exec_command" { "command" } else { "path" };
                let args_json = serde_json::json!({ key: call.args }).to_string();

                let (output, success) = match execute_tool(&call.name, &args_json, connection_id).await {
                    Ok(r) => r,
                    Err(e) => (e, false),
                };

                // 通知前端：工具执行完成
                let _ = app.emit(
                    event_name,
                    ChatChunk {
                        delta: None,
                        done: false,
                        error: None,
                        tool: Some(ToolEvent {
                            name: call.name.clone(),
                            args: call.args.clone(),
                            status: "done".into(),
                            result: Some(output.chars().take(500).collect()),
                            success: Some(success),
                            confirm_id: None,
                        }),
                    },
                );

                // 5. 结果加入历史（tool role 消息）
                let tool_result_msg = serde_json::json!({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": output
                });
                current_messages.push(tool_result_msg);
            }
            // 继续下一轮 LLM 调用
            continue;
        }

        // 6. 无 tool_calls → 最终回复，流式输出
        if !response.content.is_empty() {
            // 用非流式结果直接推送（不再二次请求）
            let _ = app.emit(
                event_name,
                ChatChunk {
                    delta: Some(response.content.clone()),
                    done: false,
                    error: None,
                    tool: None,
                },
            );
            return Ok(response.content);
        }

        // content 和 tool_calls 都为空（异常情况）
        return Err("AI 未返回有效响应".into());
    }

    // 到达轮次上限：不再直接报错，而是发一次不带 tools 的请求让 AI 基于已收集的信息做总结。
    // 这样即使工具调用较多，用户也能拿到有价值的诊断结论，而不是一个干巴巴的错误。
    // 在历史末尾追加一条提示，引导 AI 输出总结。
    current_messages.push(serde_json::json!({
        "role": "user",
        "content": "已达到工具调用轮次上限，请基于目前已收集的信息给出诊断结论和建议，不要再调用工具。"
    }));

    match call_chat_summary(base_url, api_key, model, &current_messages).await {
        Ok(summary) => {
            let _ = app.emit(
                event_name,
                ChatChunk {
                    delta: Some(summary.clone()),
                    done: false,
                    error: None,
                    tool: None,
                },
            );
            Ok(summary)
        }
        Err(e) => Err(format!(
            "Agent 已执行 {} 轮工具调用，尝试生成总结时失败：{}",
            MAX_AGENT_ROUNDS, e
        )),
    }
}

/// 不带 tools 的普通聊天请求，用于 agent 达到轮次上限后的总结。
async fn call_chat_summary(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    messages: &[serde_json::Value],
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {}", e))?;

    let url = format!("{}/chat/completions", base_url);
    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": model,
            "messages": messages,
            "temperature": 0.2,
            "stream": false
        }));

    if let Some(key) = api_key {
        req = req.bearer_auth(key);
    }

    let resp = req.send().await.map_err(|e| format!("请求失败: {}", e))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败: {}", e))?;

    if !status.is_success() {
        let snippet = if body.len() > 500 {
            format!("{}...", &body[..500])
        } else {
            body
        };
        return Err(format!("LLM 服务返回 {} : {}", status.as_u16(), snippet));
    }

    let json: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("响应不是合法 JSON: {}", e))?;

    Ok(json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string())
}

/// 生成简单唯一 ID（时间戳纳秒 + 随机数后缀，避免同毫秒碰撞）
fn gen_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    // 线性同余快速随机，不追求密码学安全，只需避免碰撞
    let rand = (ts as u64).wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    format!("{:016x}{:04x}", ts, (rand >> 48) & 0xffff)
}

// ---- 危险命令确认机制 ----

/// 等待用户确认的全局通道
static CONFIRMATIONS: Lazy<tokio::sync::Mutex<HashMap<String, oneshot::Sender<bool>>>> =
    Lazy::new(|| tokio::sync::Mutex::new(HashMap::new()));

/// 注册一个确认请求，返回 Receiver。前端确认后通过 confirm_agent_tool 触发。
async fn wait_for_confirmation(confirm_id: &str) -> bool {
    let (tx, rx) = oneshot::channel::<bool>();
    CONFIRMATIONS.lock().await.insert(confirm_id.to_string(), tx);
    // 等待用户响应（最长 5 分钟超时）
    let result = tokio::time::timeout(std::time::Duration::from_secs(300), rx).await;
    // 超时后清理 entry，避免泄漏
    if result.is_err() {
        CONFIRMATIONS.lock().await.remove(confirm_id);
    }
    match result {
        Ok(Ok(approved)) => approved,
        _ => false, // 超时或发送端丢弃 → 视为拒绝
    }
}

/// 前端调用：确认或拒绝危险命令
#[tauri::command]
pub async fn confirm_agent_tool(confirm_id: String, approved: bool) -> Result<bool, String> {
    let mut map = CONFIRMATIONS.lock().await;
    if let Some(tx) = map.remove(&confirm_id) {
        let _ = tx.send(approved);
        Ok(true)
    } else {
        Ok(false) // 确认 ID 不存在（可能已超时）
    }
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_base_url() {
        // 不带 /v1 自动补
        assert_eq!(
            normalize_base_url("https://api.deepseek.com"),
            "https://api.deepseek.com/v1"
        );
        // 带 /v1 保持
        assert_eq!(
            normalize_base_url("https://api.deepseek.com/v1"),
            "https://api.deepseek.com/v1"
        );
        // 尾部斜杠去除
        assert_eq!(
            normalize_base_url("http://localhost:11434/"),
            "http://localhost:11434/v1"
        );
        // 空格去除
        assert_eq!(
            normalize_base_url("  https://api.openai.com  "),
            "https://api.openai.com/v1"
        );
        // Ollama 默认端口
        assert_eq!(
            normalize_base_url("http://127.0.0.1:11434"),
            "http://127.0.0.1:11434/v1"
        );
    }

    #[test]
    fn test_extract_command_bash_block() {
        let content = "可以用这条命令查看:\n```bash\nls -la /var/log\n```\n完成。";
        assert_eq!(extract_command(content), Some("ls -la /var/log".to_string()));
    }

    #[test]
    fn test_extract_command_plain_block() {
        let content = "```\nfree -m\n```";
        assert_eq!(extract_command(content), Some("free -m".to_string()));
    }

    #[test]
    fn test_extract_command_takes_first_block() {
        // 多个块：取首个非空块（prompt 已要求只给一条命令）
        let content = "```\nfoo\n```\n```bash\nls\n```";
        assert_eq!(extract_command(content), Some("foo".to_string()));
    }

    #[test]
    fn test_extract_command_no_block_single_line() {
        // 无代码块但单行短文本且不像句子，当作命令
        assert_eq!(extract_command("df -h"), Some("df -h".to_string()));
    }

    #[test]
    fn test_extract_command_no_block_sentence() {
        // 中文句号结尾，不像命令
        assert_eq!(extract_command("这是说明文字。"), None);
    }

    #[test]
    fn test_extract_command_empty() {
        assert_eq!(extract_command(""), None);
    }

    #[test]
    fn test_system_prompt_not_empty() {
        assert!(!system_prompt(&AiKind::ExplainError).is_empty());
        assert!(!system_prompt(&AiKind::NatLangToCommand).is_empty());
    }

    #[test]
    fn test_chat_message_serialization() {
        // 验证序列化结果符合 OpenAI 格式 { role, content }
        let m = ChatMessage::user("hello");
        let v: serde_json::Value = serde_json::to_value(&m).unwrap();
        assert_eq!(v["role"], "user");
        assert_eq!(v["content"], "hello");
    }

    #[test]
    fn test_chat_message_constructors() {
        assert_eq!(ChatMessage::system("s").role, "system");
        assert_eq!(ChatMessage::user("u").role, "user");
        assert_eq!(ChatMessage::assistant("a").role, "assistant");
    }

    #[test]
    fn test_format_context_text_all_fields() {
        let ctx = TerminalContext {
            recent_output: Some("line1\nline2".into()),
            selection: Some("err text".into()),
            cwd: Some("/var/log".into()),
        };
        let text = format_context_text(&ctx);
        assert!(text.contains("<selected_text>"));
        assert!(text.contains("err text"));
        assert!(text.contains("<recent_terminal_output>"));
        assert!(text.contains("<current_directory>/var/log</current_directory>"));
    }

    #[test]
    fn test_format_context_text_empty_omitted() {
        let ctx = TerminalContext {
            recent_output: Some("   \n  ".into()), // 仅空白
            selection: None,
            cwd: None,
        };
        let text = format_context_text(&ctx);
        assert!(text.is_empty(), "纯空白字段应被省略");
    }

    #[test]
    fn test_format_context_text_none() {
        let ctx = TerminalContext {
            recent_output: None,
            selection: None,
            cwd: None,
        };
        assert!(format_context_text(&ctx).is_empty());
    }

    #[test]
    fn test_truncate_lines_short() {
        assert_eq!(truncate_lines("a\nb", 5), "a\nb");
    }

    #[test]
    fn test_truncate_lines_long() {
        let input: String = (0..10).map(|i| format!("line{}", i)).collect::<Vec<_>>().join("\n");
        let out = truncate_lines(&input, 3);
        assert!(out.contains("已省略前 7 行"));
        assert!(out.contains("line7"));
        assert!(out.contains("line9"));
        assert!(!out.contains("line0"));
    }

    #[test]
    fn test_truncate_lines_empty() {
        assert_eq!(truncate_lines("", 5), "");
    }

    #[test]
    fn test_chat_system_prompt_not_empty() {
        assert!(!chat_system_prompt().is_empty());
    }

    #[test]
    fn test_parse_sse_delta_content() {
        let data = r#"{"choices":[{"delta":{"content":"hello"}}]}"#;
        let (delta, done) = parse_sse_delta(data);
        assert_eq!(delta, Some("hello".to_string()));
        assert!(!done);
    }

    #[test]
    fn test_parse_sse_delta_done() {
        let (delta, done) = parse_sse_delta("[DONE]");
        assert_eq!(delta, None);
        assert!(done);
    }

    #[test]
    fn test_parse_sse_delta_empty() {
        let (delta, done) = parse_sse_delta("");
        assert_eq!(delta, None);
        assert!(!done);
    }

    #[test]
    fn test_parse_sse_delta_no_content_field() {
        // role-only delta（首个 chunk 常见，只有 role 没有 content）
        let data = r#"{"choices":[{"delta":{"role":"assistant"}}]}"#;
        let (delta, done) = parse_sse_delta(data);
        assert_eq!(delta, None);
        assert!(!done);
    }

    #[test]
    fn test_parse_sse_delta_invalid_json() {
        let (delta, done) = parse_sse_delta("not json");
        assert_eq!(delta, None);
        assert!(!done);
    }

    #[test]
    fn test_split_sse_events_basic() {
        let input = "data: {\"a\":1}\n\ndata: {\"b\":2}\n\n";
        let (events, remainder) = split_sse_events(input);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0], vec![r#"{"a":1}"#.to_string()]);
        assert_eq!(events[1], vec![r#"{"b":2}"#.to_string()]);
        assert!(remainder.is_empty());
    }

    #[test]
    fn test_split_sse_events_partial_remainder() {
        // 末尾不完整事件应留在 remainder
        let input = "data: {\"a\":1}\n\ndata: {\"b\":2";
        let (events, remainder) = split_sse_events(input);
        assert_eq!(events.len(), 1);
        assert!(remainder.contains(r#"{"b":2"#));
    }

    #[test]
    fn test_split_sse_events_multiline_data() {
        // 一个事件内多行 data:（OpenAI 实际不用，但要能容错）
        let input = "data: line1\ndata: line2\n\n";
        let (events, remainder) = split_sse_events(input);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], vec!["line1".to_string(), "line2".to_string()]);
        assert!(remainder.is_empty());
    }

    // ---- 上下文管理测试 ----

    fn make_msg(role: &str, content: &str) -> super::super::db::AiMessage {
        super::super::db::AiMessage {
            id: format!("{}-{}", role, content.len()),
            conversation_id: "test".into(),
            role: role.into(),
            content: content.into(),
            context: None,
            created_at: 0,
        }
    }

    #[test]
    fn test_estimate_tokens_english() {
        // 英文约 4 字符 = 1 token；"hello world!" = 12 chars → ceil(12/4) = 3
        let tokens = estimate_tokens("hello world!");
        assert_eq!(tokens, 3);
    }

    #[test]
    fn test_estimate_tokens_chinese() {
        // 中文 1 字符 ≈ 1 token；"你好世界" = 4 CJK chars
        let tokens = estimate_tokens("你好世界");
        assert_eq!(tokens, 4);
    }

    #[test]
    fn test_estimate_tokens_mixed() {
        // 混合："你好" (2 CJK) + "hello" (5 other → ceil(5/4)=2) = 4
        let tokens = estimate_tokens("你好hello");
        assert_eq!(tokens, 4);
    }

    #[test]
    fn test_estimate_tokens_empty() {
        assert_eq!(estimate_tokens(""), 1);
    }

    #[test]
    fn test_build_messages_short_history() {
        // 短历史：全部保留
        let history = vec![
            make_msg("user", "hello"),
            make_msg("assistant", "hi there"),
        ];
        let messages = build_messages_with_context_limit("SYSTEM", &history, "new question");
        // system + 2 历史 + 1 本轮 = 4
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[0].content, "SYSTEM");
        assert_eq!(messages[1].role, "user");
        assert_eq!(messages[2].role, "assistant");
        assert_eq!(messages[3].content, "new question");
    }

    #[test]
    fn test_build_messages_truncates_old_rounds() {
        // 超过 6 轮的历史，应该只保留最近的
        let mut history = Vec::new();
        for i in 0..10 {
            history.push(make_msg("user", &format!("question {}", i)));
            history.push(make_msg("assistant", &format!("answer {}", i)));
        }
        let messages = build_messages_with_context_limit("S", &history, "current");
        // system + 最多 6 轮 (12 条) + 本轮 = 最多 14
        assert!(messages.len() <= 14);
        assert!(messages.len() >= 3); // 至少 system + 1 轮 + 本轮
        // 最后一条是本轮
        assert_eq!(messages.last().unwrap().content, "current");
        // 最早的 question 0 应该被丢弃
        let history_first = &messages[1].content;
        assert!(
            !history_first.contains("question 0"),
            "question 0 should be truncated, got: {}",
            history_first
        );
    }

    #[test]
    fn test_build_messages_keeps_correct_pairing() {
        // 验证 user/assistant 配对正确
        let history = vec![
            make_msg("user", "q0"),
            make_msg("assistant", "a0"),
            make_msg("user", "q1"),
            make_msg("assistant", "a1"),
        ];
        let messages = build_messages_with_context_limit("S", &history, "current");
        // 全部保留（2 轮 < 6 轮限制）
        assert_eq!(messages.len(), 6); // system + 4 + current
        assert_eq!(messages[1].content, "q0");
        assert_eq!(messages[2].content, "a0");
        assert_eq!(messages[3].content, "q1");
        assert_eq!(messages[4].content, "a1");
        assert_eq!(messages[5].content, "current");
    }

    #[test]
    fn test_build_messages_no_leading_assistant() {
        // 截断后不应以 assistant 消息开头（除非前面有 user）
        let mut history = vec![
            make_msg("assistant", "orphan reply"),  // 没有 user 配对
        ];
        for i in 0..6 {
            history.push(make_msg("user", &format!("q{}", i)));
            history.push(make_msg("assistant", &format!("a{}", i)));
        }
        let messages = build_messages_with_context_limit("S", &history, "current");
        // 第 1 条历史消息不应是 orphan assistant
        assert!(
            messages[1].role != "assistant" || messages.len() <= 2,
            "messages should not start with orphan assistant"
        );
    }

    #[test]
    fn test_build_messages_empty_history() {
        let messages = build_messages_with_context_limit("S", &[], "first message");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[1].content, "first message");
    }

    #[test]
    fn test_is_dangerous_command() {
        assert!(is_dangerous_command("rm -rf /"));
        assert!(is_dangerous_command("docker rm -f abc123"));
        assert!(is_dangerous_command("shutdown -h now"));
        assert!(!is_dangerous_command("docker ps -a"));
        assert!(!is_dangerous_command("free -m"));
        assert!(!is_dangerous_command("cat /etc/nginx/nginx.conf"));
    }
}
