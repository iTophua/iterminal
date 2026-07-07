//! AI 助手模块 - 免费版（Free）stub
//!
//! Free 构建中 ai_analyze 永远返回错误，提示需要 Pro。
//! Pro 构建时本文件会被 iterminal-pro 的实现覆盖（含真实 LLM 调用 + 私有 API Key）。
//!
//! ⚠️ 修改本文件时，必须同步 iterminal-pro/src-tauri/src/commands/ai.rs，
//!    保持公开 API（命令名、参数）一致。

use serde::{Deserialize, Serialize};

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

/// AI 分析（Free stub：永远失败）
///
/// Pro 构建会注入真实实现：调用 LLM 服务，使用私有 API Key。
#[tauri::command]
pub async fn ai_analyze(text: String, kind: AiKind) -> Result<AiResult, String> {
    // 故意使用 text 避免 unused 警告，并保留参数语义
    let _ = (&text, &kind);
    Err("AI 助手是专业版功能，请激活 Pro License 后使用".into())
}
