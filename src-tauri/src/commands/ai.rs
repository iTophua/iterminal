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

/// 调用 OpenAI 兼容的 /v1/chat/completions
async fn call_chat(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
    system: &str,
    user: &str,
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
            "messages": [
                { "role": "system", "content": system },
                { "role": "user", "content": user }
            ],
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

    let content = match call_chat(&base_url, api_key.as_deref(), &model, system, user).await {
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
    match call_chat(&base, resolved_key.as_deref(), &model, "You are a helper.", "ping")
        .await
    {
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
}
