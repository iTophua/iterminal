//! 连接过程中的交互式提问：服务器的 keyboard-interactive 验证（密码提示、动态口令、短信验证码……）。
//!
//! 建连由后端发起，问题是服务器在握手途中提的，答案只有用户知道。
//! 这里把问题作为事件交给主窗口，原地等回答（有超时），再回给服务器。
//! MCP 发起的连接同样适用——问题弹在应用窗口里，由坐在电脑前的人回答。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use once_cell::sync::Lazy;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// 等用户回答的时长。动态口令、短信验证码一般几十秒内能拿到，放宽到 5 分钟
const ANSWER_TIMEOUT: Duration = Duration::from_secs(300);

static NEXT_ID: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AuthPrompt {
    pub prompt: String,
    /// true：正常显示输入内容；false：按密码处理，遮住输入
    pub echo: bool,
}

/// 发给界面的一道题
#[derive(Debug, Clone, Serialize)]
pub struct AuthQuestion {
    pub id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    /// 服务器给的标题与说明（如 "Verification code"）
    pub name: String,
    pub instruction: String,
    /// 需要用户回答的问题
    pub prompts: Vec<AuthPrompt>,
}

#[derive(Debug, PartialEq, Eq)]
enum Answer {
    Given(Vec<String>),
    Cancelled,
}

static PENDING: Lazy<Mutex<HashMap<String, oneshot::Sender<Answer>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn pending() -> std::sync::MutexGuard<'static, HashMap<String, oneshot::Sender<Answer>>> {
    PENDING.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// 登记一道题，拿到等回答的接收端
fn register(question: &AuthQuestion) -> oneshot::Receiver<Answer> {
    let (sender, receiver) = oneshot::channel();
    pending().insert(question.id.to_string(), sender);
    receiver
}

/// 把用户的回答交给正在等的那个连接；None 表示用户取消
fn reply(id: &str, answers: Option<Vec<String>>) -> Result<(), String> {
    let sender = pending().remove(id).ok_or("这个提问已不在等待回答")?;
    sender
        .send(answers.map_or(Answer::Cancelled, Answer::Given))
        .map_err(|_| "连接已结束".to_string())
}

/// 向用户提问并等待回答。用户取消或超时都返回 Err。
/// app 为 None 表示这条连接没法弹窗（SFTP 的独立连接），直接报错。
pub(crate) async fn ask(app: Option<&AppHandle>, mut question: AuthQuestion) -> Result<Vec<String>, String> {
    let Some(app) = app else {
        return Err("服务器要求交互式验证（如动态口令），当前操作无法回答".to_string());
    };
    question.id = format!(
        "auth-{}-{}",
        std::process::id(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    );
    let receiver = register(&question);

    // 只弹在主窗口：每个终端窗口各弹一个的话，回答完其它的还挂着
    if let Err(e) = app.emit_to("main", "ssh-auth-question", &question) {
        let _ = pending().remove(&question.id);
        return Err(format!("无法显示验证提问: {}", e));
    }

    let answer = match tokio::time::timeout(ANSWER_TIMEOUT, receiver).await {
        Ok(Ok(answer)) => answer,
        Ok(Err(_)) => return Err("连接已取消".to_string()),
        Err(_) => {
            let _ = pending().remove(&question.id);
            return Err("等待验证回答超时，请重试".to_string());
        }
    };
    match answer {
        Answer::Given(answers) => Ok(answers),
        Answer::Cancelled => Err("已取消验证".to_string()),
    }
}

/// 用户在验证提问框里作答；answers 为 None 表示取消
#[tauri::command]
pub fn answer_auth_question(id: String, answers: Option<Vec<String>>) -> Result<bool, String> {
    reply(&id, answers)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn question(id: &str) -> AuthQuestion {
        AuthQuestion {
            id: id.into(),
            host: "10.0.0.1".into(),
            port: 22,
            username: "root".into(),
            name: "Verification code".into(),
            instruction: String::new(),
            prompts: vec![AuthPrompt {
                prompt: "Verification code:".into(),
                echo: false,
            }],
        }
    }

    #[test]
    fn answer_reaches_the_waiting_connection() {
        let receiver = register(&question("q1"));
        assert!(reply("q1", Some(vec!["123456".into()])).is_ok());
        assert_eq!(receiver.blocking_recv(), Ok(Answer::Given(vec!["123456".into()])));
    }

    #[test]
    fn cancel_and_unknown_questions() {
        let receiver = register(&question("q2"));
        assert!(reply("q2", None).is_ok());
        assert_eq!(receiver.blocking_recv(), Ok(Answer::Cancelled));

        // 已回答过的、不存在的 id 都不能重复回答
        assert!(reply("q2", None).is_err());
        assert!(reply("nope", None).is_err());
    }

    #[test]
    fn abandoned_question_reports_disconnected() {
        let receiver = register(&question("q3"));
        drop(receiver);
        assert!(reply("q3", Some(vec!["x".into()])).is_err());
    }
}
