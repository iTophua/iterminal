use once_cell::sync::Lazy;
use russh::client::{Handle, Handler, KeyboardInteractiveAuthResponse};
use russh::{ChannelMsg, Disconnect, MethodKind};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::time::Duration;
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot, RwLock};

use super::auth_prompt::{self, AuthPrompt, AuthQuestion};
use super::host_key::{self, HostKeyChallenge, HostKeyPolicy, HostKeyReport};
use super::license::get_max_connections;

/// 认证方式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Password,
    PublicKey,
    /// 本机 ssh-agent 里的密钥
    Agent,
}

impl AuthMethod {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "password" => Some(AuthMethod::Password),
            "publickey" => Some(AuthMethod::PublicKey),
            "agent" => Some(AuthMethod::Agent),
            _ => None,
        }
    }
}

/// 一次连接需要的全部信息。新增字段都带 serde(default)：老的调用方只传
/// host/port/username/password/key_file 也照样能用
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SSHConnection {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub key_file: Option<String>,
    /// 私钥口令（私钥本身加了口令时必填）
    #[serde(default)]
    pub key_passphrase: Option<String>,
    /// 认证方式；不传则按 key_file / password 推断
    #[serde(default)]
    pub auth_method: Option<AuthMethod>,
    /// 跳板机：已保存连接的 id，连接经它转发
    #[serde(default)]
    pub jump_host_id: Option<String>,
    /// 服务器 keyboard-interactive 提问的预备回答，按提问顺序取用（MCP 调用方可预先给出）；
    /// 用完或不传则交给用户在界面上回答
    #[serde(default)]
    pub auth_answers: Option<Vec<String>>,
}

/// 解析请求里写的认证方式；不认识的值报错而不是悄悄忽略
pub(crate) fn parse_auth_method(value: &str) -> Result<AuthMethod, String> {
    AuthMethod::parse(value).ok_or_else(|| {
        format!(
            "auth_method 无效: {}（可选 password / publickey / agent）",
            value
        )
    })
}

impl SSHConnection {
    /// 由已保存的连接记录构造
    pub(crate) fn from_record(record: &super::db::ConnectionRecord) -> Self {
        Self {
            host: record.host.clone(),
            port: record.port,
            username: record.username.clone(),
            password: record.password.clone(),
            key_file: record.key_file.clone(),
            key_passphrase: record.key_passphrase.clone(),
            auth_method: record.auth_method.as_deref().and_then(AuthMethod::parse),
            jump_host_id: record.jump_host_id.clone(),
            auth_answers: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    /// 命令超时被强制终止（如 tail -f），output 含超时前已收到的输出
    #[serde(default)]
    pub timed_out: bool,
    /// stdout/stderr 超过 1MB 上限被截断
    #[serde(default)]
    pub output_truncated: bool,
}

/// SSH 客户端回调。目前只负责主机密钥校验，见 host_key.rs
pub struct SshClientHandler {
    host: String,
    port: u16,
    policy: HostKeyPolicy,
    /// 需要用户确认的主机密钥放这里；随后建连失败，由调用方取出交给界面
    challenge: Arc<std::sync::Mutex<Option<HostKeyChallenge>>>,
}

impl SshClientHandler {
    pub fn new(host: String, port: u16, policy: HostKeyPolicy) -> (Self, HostKeyReport) {
        let report = HostKeyReport::default();
        (
            Self {
                host,
                port,
                policy,
                challenge: report.0.clone(),
            },
            report,
        )
    }
}

impl Handler for SshClientHandler {
    type Error = anyhow::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        let report = HostKeyReport(self.challenge.clone());
        Ok(host_key::verify(
            &self.host,
            self.port,
            server_public_key,
            self.policy,
            report,
        )
        .await)
    }
}

pub struct SshSession {
    pub handle: Arc<Handle<SshClientHandler>>,
    pub connection: SSHConnection,
    /// 经跳板机连接时持有的跳板链，见 EstablishedSession
    pub jumps: Vec<Arc<Handle<SshClientHandler>>>,
}

pub struct ShellSession {
    pub cancel_tx: oneshot::Sender<()>,
    pub resize_tx: mpsc::Sender<(u32, u32)>,
    pub write_tx: mpsc::Sender<Vec<u8>>,
}

pub static SESSIONS: Lazy<RwLock<HashMap<String, SshSession>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

static SHELLS: Lazy<RwLock<HashMap<String, ShellSession>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

async fn cleanup_connection(connection_id: &str) {
    // 使用 "-shell-" 结尾的 prefix，确保精确匹配该 connection 的 shell，
    // 避免误清理其他 connection 的 shell（例如 id 为 "abc-shell-xxx" 的 connection）
    let prefix = format!("{}-shell-", connection_id);
    {
        let mut shells = SHELLS.write().await;
        let shell_ids: Vec<String> = shells
            .keys()
            .filter(|k| k.starts_with(&prefix))
            .cloned()
            .collect();
        for shell_id in shell_ids {
            if let Some(shell) = shells.remove(&shell_id) {
                let _ = shell.cancel_tx.send(());
            }
        }
    }
    
    super::sftp::close_sftp_session(connection_id).await;

    // 清理该连接的所有端口转发：accept loop 持有 Arc<Handle> 副本，
    // 必须在此 abort 并移除，否则 SESSIONS.remove 后底层连接因引用计数 > 0 不会真正关闭。
    super::port_forward::cleanup_forwards(connection_id).await;
}

/// 建连超时：TCP + 握手 + 主机密钥校验
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// 认证超时。企业服务器认证栈可能很慢（PAM/sssd/LDAP、GSSAPI 等 DNS 反查），
/// 实测有服务器 password 认证响应需要 10s+，5s 会把"慢"误判为"超时"。
/// OpenSSH 客户端 LoginGraceTime 默认 120s，20s 已足够保守。
const AUTH_TIMEOUT: Duration = Duration::from_secs(20);

/// 建好的 SSH 连接（尚未登记到 SESSIONS）
pub struct EstablishedSession {
    pub handle: Handle<SshClientHandler>,
    /// 经跳板机连接时持有的跳板链（由外到内）。它们被 drop 会连带断开隧道，
    /// 必须和 handle 活得一样久
    pub jumps: Vec<Arc<Handle<SshClientHandler>>>,
}

/// 跳板机最多叠几层
const MAX_JUMP_DEPTH: usize = 3;

/// 用跳板机之前的检查：层数上限、成环
fn check_jump(jump_id: &str, jump_name: &str, depth: usize, path: &[String]) -> Result<(), String> {
    if depth >= MAX_JUMP_DEPTH {
        return Err(format!("跳板机层数超过 {} 层", MAX_JUMP_DEPTH));
    }
    if path.iter().any(|id| id == jump_id) {
        return Err(format!(
            "跳板机配置成环（{}），请检查各连接的跳板机设置",
            jump_name
        ));
    }
    Ok(())
}

/// 建连失败的文案：有待确认的主机密钥时带回挑战（见 host_key::CHALLENGE_PREFIX），
/// 否则是普通说明。error 为 None 表示超时。
fn connect_error(report: &HostKeyReport, error: Option<&anyhow::Error>) -> String {
    if let Some(challenge) = report.take() {
        return challenge.to_error_string();
    }
    match error {
        Some(e)
            if matches!(
                e.downcast_ref::<russh::Error>(),
                Some(russh::Error::UnknownKey)
            ) =>
        {
            "主机密钥校验未通过".to_string()
        }
        Some(e) => format!("连接失败: {}", e),
        None => "连接超时，请检查网络或服务器地址".to_string(),
    }
}

/// 建立 SSH 连接并完成认证，不登记到 SESSIONS。
/// 终端连接、测试连接、SFTP 的独立连接都走这里——主机密钥校验和认证方式只有这一份实现。
/// app 用来在需要用户回答验证提问时通知界面；传 None 则这类提问直接报错
pub(crate) async fn establish_session(
    connection: &SSHConnection,
    policy: HostKeyPolicy,
    app: Option<&AppHandle>,
) -> Result<EstablishedSession, String> {
    establish_session_inner(connection.clone(), policy, 0, Vec::new(), app).await
}

/// path 是这一路连接正在使用的跳板机 id，用来发现 A→B→A 这样的环。
/// 参数全部取值而非借用：递归的 async fn 一旦带借用参数，spawn 处就会报
/// Send is not general enough（高阶生命周期）
async fn establish_session_inner(
    connection: SSHConnection,
    policy: HostKeyPolicy,
    depth: usize,
    path: Vec<String>,
    app: Option<&AppHandle>,
) -> Result<EstablishedSession, String> {
    let mut config = russh::client::Config::default();
    config.keepalive_interval = Some(Duration::from_secs(30));
    config.keepalive_max = 3;
    let config = Arc::new(config);
    let (handler, report) = SshClientHandler::new(connection.host.clone(), connection.port, policy);

    let (connect_result, jumps) = match connection.jump_host_id.clone() {
        Some(jump_id) => {
            let jump_record = load_saved_connection(&jump_id)?;
            check_jump(&jump_id, &jump_record.name, depth, &path)?;
            let mut path = path;
            path.push(jump_id);
            let jump_connection = SSHConnection::from_record(&jump_record);
            // 递归调用装箱，否则 future 类型无限大
            let jump_session = Box::pin(establish_session_inner(
                jump_connection,
                policy,
                depth + 1,
                path,
                app,
            ))
            .await?;

            // 目标主机名交给跳板机去解析：内网域名常常只有堡垒机解析得了
            let EstablishedSession {
                handle: jump_handle,
                mut jumps,
            } = jump_session;
            let jump_handle = Arc::new(jump_handle);
            let channel = jump_handle
                .channel_open_direct_tcpip(
                    connection.host.clone(),
                    connection.port as u32,
                    "127.0.0.1",
                    0,
                )
                .await
                .map_err(|e| {
                    format!(
                        "跳板机 {} 无法转发到 {}:{}: {}",
                        jump_record.name, connection.host, connection.port, e
                    )
                })?;
            jumps.push(jump_handle);
            (
                tokio::time::timeout(
                    CONNECT_TIMEOUT,
                    russh::client::connect_stream(config, channel.into_stream(), handler),
                )
                .await,
                jumps,
            )
        }
        None => {
            let addr = format!("{}:{}", connection.host, connection.port);
            let socket_addr = addr
                .to_socket_addrs()
                .ok()
                .and_then(|mut a| a.next())
                .ok_or("解析地址失败")?;
            (
                tokio::time::timeout(
                    CONNECT_TIMEOUT,
                    russh::client::connect(config, &socket_addr.to_string(), handler),
                )
                .await,
                Vec::new(),
            )
        }
    };

    let mut handle = match connect_result {
        Ok(Ok(handle)) => handle,
        Ok(Err(e)) => return Err(connect_error(&report, Some(&e))),
        Err(_) => return Err(connect_error(&report, None)),
    };

    authenticate(&mut handle, &connection, app).await?;

    Ok(EstablishedSession { handle, jumps })
}

/// 按 id 取一条已保存的连接（跳板机用）
fn load_saved_connection(id: &str) -> Result<super::db::ConnectionRecord, String> {
    super::db::get_connections()?
        .into_iter()
        .find(|record| record.id == id)
        .ok_or_else(|| "找不到跳板机的连接配置，请重新选择".to_string())
}

/// 认证。Err 的文案直接给用户看
async fn authenticate(
    handle: &mut Handle<SshClientHandler>,
    connection: &SSHConnection,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    match resolve_auth_method(connection) {
        AuthMethod::Password => {
            match authenticate_with_password(handle, connection).await? {
                PasswordAttempt::Accepted => Ok(()),
                PasswordAttempt::Rejected {
                    keyboard_interactive: true,
                } => {
                    // 密码被拒，但服务器开放 keyboard-interactive：开了二次验证（动态口令、
                    // 短信验证码）或只认问答式登录的服务器只能从这里进
                    authenticate_keyboard_interactive(handle, connection, app, true).await
                }
                PasswordAttempt::Rejected { .. } => Err("认证失败".to_string()),
            }
        }
        AuthMethod::PublicKey => authenticate_with_key(handle, connection).await,
        AuthMethod::Agent => authenticate_with_agent(handle, connection).await,
    }
}

/// 这次连接用哪种认证。没指定时沿用老行为：有密钥文件用密钥，否则用密码
fn resolve_auth_method(connection: &SSHConnection) -> AuthMethod {
    connection.auth_method.unwrap_or(if connection.key_file.is_some() {
        AuthMethod::PublicKey
    } else {
        AuthMethod::Password
    })
}

/// 密码认证的结果。被拒时带上服务器是否还开放 keyboard-interactive
enum PasswordAttempt {
    Accepted,
    Rejected { keyboard_interactive: bool },
}

async fn authenticate_with_password(
    handle: &mut Handle<SshClientHandler>,
    connection: &SSHConnection,
) -> Result<PasswordAttempt, String> {
    let Some(password) = &connection.password else {
        return Err("未提供认证信息".to_string());
    };
    let auth_result = tokio::time::timeout(
        AUTH_TIMEOUT,
        handle.authenticate_password(&connection.username, password),
    )
    .await;

    match auth_result {
        Ok(Ok(russh::client::AuthResult::Success)) => Ok(PasswordAttempt::Accepted),
        Ok(Ok(russh::client::AuthResult::Failure { remaining_methods })) => {
            Ok(PasswordAttempt::Rejected {
                keyboard_interactive: remaining_methods.contains(&MethodKind::KeyboardInteractive),
            })
        }
        Ok(Err(e)) => Err(format!("认证失败: {}", e)),
        Err(_) => Err("认证超时".to_string()),
    }
}

/// 一轮 keyboard-interactive 认证里最多来回几问
const MAX_PROMPT_ROUNDS: usize = 8;

/// 提问像不像在要密码：不回显，且文案带 password / 密码 之类
fn is_password_prompt(prompt: &russh::client::Prompt) -> bool {
    if prompt.echo {
        return false;
    }
    let text = prompt.prompt.to_lowercase();
    text.contains("password") || text.contains("passwd") || text.contains("密码")
}

/// keyboard-interactive 认证：服务器一问一答（密码提示、动态口令、短信验证码……）。
///
/// 像密码的提问先用保存的密码自动回答；password_rejected 为 true 表示这把密码刚被拒过，
/// 不再自动提交。其余提问优先用预先给的 auth_answers，没有就交给用户。
async fn authenticate_keyboard_interactive(
    handle: &mut Handle<SshClientHandler>,
    connection: &SSHConnection,
    app: Option<&AppHandle>,
    password_rejected: bool,
) -> Result<(), String> {
    let mut password_spent = password_rejected;
    let mut prepared = connection.auth_answers.clone().unwrap_or_default().into_iter();
    let mut responses: Option<Vec<String>> = None;
    let mut asked_user = false;

    for _ in 0..MAX_PROMPT_ROUNDS {
        // 超时只管网络往返，等用户回答的时间不算在内
        let reply = if let Some(answers) = responses.take() {
            tokio::time::timeout(
                AUTH_TIMEOUT,
                handle.authenticate_keyboard_interactive_respond(answers),
            )
            .await
        } else {
            tokio::time::timeout(
                AUTH_TIMEOUT,
                handle.authenticate_keyboard_interactive_start(
                    &connection.username,
                    None::<String>,
                ),
            )
            .await
        };

        match reply {
            Ok(Ok(KeyboardInteractiveAuthResponse::Success)) => return Ok(()),
            Ok(Ok(KeyboardInteractiveAuthResponse::Failure { .. })) => {
                return Err(if asked_user {
                    "交互式验证未通过".to_string()
                } else {
                    "认证失败".to_string()
                });
            }
            Ok(Ok(KeyboardInteractiveAuthResponse::InfoRequest {
                name,
                instructions,
                prompts,
            })) => {
                // 刚被拒过的密码又被单独问一次：再提交一遍只会多留一条失败记录
                if password_rejected && prompts.len() == 1 && is_password_prompt(&prompts[0]) {
                    return Err("认证失败".to_string());
                }

                let mut answers = vec![String::new(); prompts.len()];
                let mut for_user = Vec::new();
                for (index, prompt) in prompts.iter().enumerate() {
                    let automatic = if is_password_prompt(prompt) && !password_spent {
                        password_spent = true;
                        connection.password.clone()
                    } else {
                        prepared.next()
                    };
                    match automatic {
                        Some(answer) => answers[index] = answer,
                        None => for_user.push(index),
                    }
                }

                if !for_user.is_empty() {
                    asked_user = true;
                    let user_answers =
                        ask_user(app, connection, &name, &instructions, &prompts, &for_user)
                            .await?;
                    for (index, answer) in for_user.into_iter().zip(user_answers) {
                        answers[index] = answer;
                    }
                }
                responses = Some(answers);
            }
            Ok(Err(e)) => return Err(format!("交互式验证失败: {}", e)),
            Err(_) => return Err("认证超时".to_string()),
        }
    }
    Err("服务器的验证提问轮数超出预期".to_string())
}

/// 把需要用户回答的提问发给界面并等回答
#[allow(clippy::too_many_arguments)]
fn build_question(
    connection: &SSHConnection,
    name: &str,
    instruction: &str,
    prompts: &[russh::client::Prompt],
    indexes: &[usize],
) -> AuthQuestion {
    AuthQuestion {
        id: String::new(),
        host: connection.host.clone(),
        port: connection.port,
        username: connection.username.clone(),
        name: name.to_string(),
        instruction: instruction.to_string(),
        prompts: indexes
            .iter()
            .map(|&index| AuthPrompt {
                prompt: prompts[index].prompt.clone(),
                echo: prompts[index].echo,
            })
            .collect(),
    }
}

async fn ask_user(
    app: Option<&AppHandle>,
    connection: &SSHConnection,
    name: &str,
    instruction: &str,
    prompts: &[russh::client::Prompt],
    indexes: &[usize],
) -> Result<Vec<String>, String> {
    auth_prompt::ask(
        app,
        build_question(connection, name, instruction, prompts, indexes),
    )
    .await
}

async fn authenticate_with_key(
    handle: &mut Handle<SshClientHandler>,
    connection: &SSHConnection,
) -> Result<(), String> {
    let Some(key_file) = &connection.key_file else {
        return Err("未提供认证信息".to_string());
    };
    let key_path = shellexpand::tilde(key_file).into_owned();
    let key_pair = russh::keys::load_secret_key(&key_path, connection.key_passphrase.as_deref())
        .map_err(|e| {
            format!(
                "加载密钥文件失败: {}。请确认路径正确、格式为 OpenSSH/PEM；私钥设了口令的话请填写私钥口令",
                e
            )
        })?;

    let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);

    let auth_result = tokio::time::timeout(
        AUTH_TIMEOUT,
        handle.authenticate_publickey(&connection.username, key_with_hash),
    )
    .await;

    match auth_result {
        Ok(Ok(auth)) if auth.success() => Ok(()),
        Ok(Ok(_)) => Err("密钥认证失败。请检查密钥是否已添加到服务器".to_string()),
        Ok(Err(e)) => Err(format!(
            "密钥认证失败: {}。请检查密钥是否已添加到服务器",
            e
        )),
        Err(_) => Err("密钥认证超时".to_string()),
    }
}

/// 用本机 ssh-agent 里的密钥认证（YubiKey、1Password、系统 agent 等都在此列）。
/// agent 里可能有多把钥匙，逐把尝试，任何一把被接受即成功。
async fn authenticate_with_agent(
    handle: &mut Handle<SshClientHandler>,
    connection: &SSHConnection,
) -> Result<(), String> {
    // Unix 走 SSH_AUTH_SOCK；Windows 走 OpenSSH 代理服务的命名管道。
    // 保留具体的流类型、不要转成 trait 对象（dynamic()）：那样这个 async fn 的 future
    // 在 spawn 处会被判成 Send is not general enough（高阶生命周期推导不过去）
    #[cfg(unix)]
    let mut agent = russh::keys::agent::client::AgentClient::connect_env()
        .await
        .map_err(|_| agent_unavailable())?;
    #[cfg(windows)]
    let mut agent = russh::keys::agent::client::AgentClient::connect_named_pipe(
        r"\\.\pipe\openssh-ssh-agent",
    )
    .await
    .map_err(|_| agent_unavailable())?;

    let identities = tokio::time::timeout(AUTH_TIMEOUT, agent.request_identities())
        .await
        .map_err(|_| "连接 ssh-agent 超时".to_string())?
        .map_err(|e| format!("读取 ssh-agent 里的密钥失败: {}", e))?;
    if identities.is_empty() {
        return Err("ssh-agent 里没有密钥，请先用 ssh-add 添加".to_string());
    }

    let mut last_error = None;
    for key in identities {
        let attempt = tokio::time::timeout(
            AUTH_TIMEOUT,
            handle.authenticate_publickey_with(&connection.username, key, None, &mut agent),
        )
        .await;
        match attempt {
            Ok(Ok(auth)) if auth.success() => return Ok(()),
            Ok(Ok(_)) => {}
            Ok(Err(e)) => last_error = Some(e.to_string()),
            Err(_) => return Err("ssh-agent 认证超时".to_string()),
        }
    }
    Err(match last_error {
        Some(e) => format!(
            "ssh-agent 认证失败: {}。请确认 agent 里的公钥已添加到服务器",
            e
        ),
        None => "ssh-agent 认证失败。请确认 agent 里的公钥已添加到服务器".to_string(),
    })
}

fn agent_unavailable() -> String {
    #[cfg(unix)]
    {
        "连不上 ssh-agent（环境变量 SSH_AUTH_SOCK 没设置或 agent 没在运行）。         从程序坞启动的应用读不到 shell 里设置的环境变量：请改用密钥文件认证，         或用 launchctl setenv SSH_AUTH_SOCK 指向 agent 的套接字"
            .to_string()
    }
    #[cfg(windows)]
    {
        "连不上 ssh-agent。请确认 OpenSSH Authentication Agent 服务正在运行".to_string()
    }
}

#[tauri::command]
pub async fn connect_ssh(
    id: String,
    connection: SSHConnection,
    app: AppHandle,
) -> Result<bool, String> {
    connect_ssh_with(id, connection, HostKeyPolicy::RequireTrusted, Some(app)).await
}

/// 应用界面一律严格校验主机密钥；MCP 链路由调用方显式说明是否自动信任新主机
pub(crate) async fn connect_ssh_with(
    id: String,
    connection: SSHConnection,
    policy: HostKeyPolicy,
    app: Option<AppHandle>,
) -> Result<bool, String> {
    {
        let sessions = SESSIONS.read().await;
        if sessions.contains_key(&id) {
            return Ok(true);
        }
    }

    let max_connections = get_max_connections().await;
    let current_count = SESSIONS.read().await.len() as u32;
    if current_count >= max_connections {
        return Err(format!(
            "免费版最多支持 {} 个连接，请升级专业版解锁无限连接",
            max_connections
        ));
    }

    let EstablishedSession { handle, jumps } =
        establish_session(&connection, policy, app.as_ref()).await?;

    {
        let mut sessions = SESSIONS.write().await;
        if sessions.contains_key(&id) {
            return Ok(true);
        }
        sessions.insert(
            id,
            SshSession {
                handle: Arc::new(handle),
                connection,
                jumps,
            },
        );
    }
    Ok(true)
}

#[tauri::command]
pub async fn disconnect_ssh(id: String) -> Result<bool, String> {
    close_session(&id).await;
    Ok(true)
}

/// 断开并移除一条会话，连同它的 SFTP 连接和端口转发
pub(crate) async fn close_session(id: &str) {
    cleanup_connection(id).await;

    if let Some(session) = SESSIONS.write().await.remove(id) {
        let _ = session
            .handle
            .disconnect(Disconnect::ByApplication, "Disconnected", "en")
            .await;
    }
}

/// exec 默认超时：tail -f / journalctl -f 等不退出的命令会永久占用 channel
/// （泄漏 session 配额、内存无限增长），超时后强制收 channel 返回已收到的输出。
const EXEC_TIMEOUT_SECS: u64 = 60;

/// 单个输出流的上限（stdout / stderr 各 1MB）。超出部分继续消费但丢弃：
/// 若不消费，TCP 背压会卡住远端命令导致永远等不到 EOF；若全收，内存会随输出无限增长。
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

/// 从 channel 收集 stdout/stderr 直到 EOF/Close，返回 (exit_code, 是否截断)。
/// 数据写入调用方传入的 Vec，超时被取消时已收数据不丢失。
async fn collect_channel_output(
    channel: &mut russh::Channel<russh::client::Msg>,
    output: &mut Vec<u8>,
    error_output: &mut Vec<u8>,
) -> (Option<u32>, bool) {
    fn append_capped(buf: &mut Vec<u8>, data: &[u8]) -> bool {
        if buf.len() >= MAX_OUTPUT_BYTES {
            return true;
        }
        let room = MAX_OUTPUT_BYTES - buf.len();
        if data.len() > room {
            buf.extend_from_slice(&data[..room]);
            true
        } else {
            buf.extend_from_slice(data);
            false
        }
    }

    let mut exit_code: Option<u32> = None;
    let mut truncated = false;
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { data } => {
                if append_capped(output, &data) {
                    truncated = true;
                }
            }
            ChannelMsg::ExtendedData { data, ext } => {
                if ext == 1 && append_capped(error_output, &data) {
                    truncated = true;
                }
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = Some(exit_status);
                // 不直接 return：继续等 EOF，确保 channel 完整关闭
            }
            ChannelMsg::Eof => break,
            ChannelMsg::Close => break,
            _ => {}
        }
    }
    (exit_code, truncated)
}

#[tauri::command]
pub async fn execute_command(id: String, command: String) -> Result<CommandResult, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    channel
        .exec(true, command.as_str())
        .await
        .map_err(|e| e.to_string())?;

    let mut output = Vec::new();
    let mut error_output = Vec::new();
    let mut exit_code: Option<u32> = None;
    let mut truncated = false;
    let timed_out = match tokio::time::timeout(
        Duration::from_secs(EXEC_TIMEOUT_SECS),
        collect_channel_output(&mut channel, &mut output, &mut error_output),
    )
    .await
    {
        Ok((ec, tr)) => {
            exit_code = ec;
            truncated = tr;
            false
        }
        Err(_) => true,
    };

    // 显式关闭 channel，确保远程 sshd 侧资源释放
    // （Docker 轮询等高频 exec 场景下，不关闭会累积半关闭 channel 导致泄漏）
    let _ = channel.eof();
    let _ = channel.close().await;

    // 超时 = 命令未正常结束，success 报 false；exit_code 缺失时维持原语义（报 true）
    let success = !timed_out && exit_code.map(|c| c == 0).unwrap_or(true);
    Ok(CommandResult {
        success,
        output: String::from_utf8_lossy(&output).to_string(),
        error: if error_output.is_empty() { None } else { Some(String::from_utf8_lossy(&error_output).to_string()) },
        timed_out,
        output_truncated: truncated,
    })
}

/// 带 stdin 写入的 exec，用于 sudo -S 通过 stdin 喂密码。
/// exec 后若有 input，通过 channel.data() 写入；整体包 30s 超时，防 sudo 卡死。
/// 不改 execute_command 本身（docker/ai 在用，防回归），新增独立函数。
pub async fn execute_command_with_input(
    id: String,
    command: String,
    input: Option<String>,
) -> Result<CommandResult, String> {
    let result = tokio::time::timeout(Duration::from_secs(30), async {
        let sessions = SESSIONS.read().await;
        let session = sessions.get(&id).ok_or("Session not found")?;
        let mut channel = session
            .handle
            .channel_open_session()
            .await
            .map_err(|e| e.to_string())?;
        drop(sessions);

        channel
            .exec(true, command.as_str())
            .await
            .map_err(|e| e.to_string())?;

        // exec 后立即写 stdin（sudo -S 会从 stdin 读密码）
        if let Some(input_data) = &input {
            // 略微延迟，让远程进程（sudo）启动并准备好读 stdin
            tokio::time::sleep(Duration::from_millis(100)).await;
            channel
                .data(input_data.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            // 写完关闭 stdin，让 sudo 知道密码输入结束
            let _ = channel.eof().await;
        }

        let mut output = Vec::new();
        let mut error_output = Vec::new();
        let (exit_code, truncated) =
            collect_channel_output(&mut channel, &mut output, &mut error_output).await;

        let _ = channel.eof();
        let _ = channel.close().await;

        let success = exit_code.map(|c| c == 0).unwrap_or(true);
        Ok(CommandResult {
            success,
            output: String::from_utf8_lossy(&output).to_string(),
            error: if error_output.is_empty() {
                None
            } else {
                Some(String::from_utf8_lossy(&error_output).to_string())
            },
            timed_out: false,
            output_truncated: truncated,
        })
    })
    .await;

    match result {
        Ok(inner) => inner,
        Err(_) => Err("命令执行超时（30s），可能 sudo 需要密码但未配置或密码错误".to_string()),
    }
}

#[tauri::command]
pub async fn test_connection(connection: SSHConnection, app: AppHandle) -> Result<bool, String> {
    test_connection_with(connection, HostKeyPolicy::RequireTrusted, Some(app)).await
}

/// 测试连接：完整走一遍握手、主机密钥校验和认证，随即断开
pub(crate) async fn test_connection_with(
    connection: SSHConnection,
    policy: HostKeyPolicy,
    app: Option<AppHandle>,
) -> Result<bool, String> {
    let EstablishedSession {
        handle,
        jumps: _,
    } = establish_session(&connection, policy, app.as_ref()).await?;
    let _ = handle
        .disconnect(Disconnect::ByApplication, "Test complete", "en")
        .await;
    Ok(true)
}

#[tauri::command]
pub async fn get_shell(id: String, app: AppHandle) -> Result<String, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    // 请求 PTY 时关闭 ECHO（终端模式 opcode 53），使 shell 启动时不回显 stdin。
    // 这样后端通过 data() 注入的 CWD 钩子脚本不会被回显到终端，注入后再用
    // stty echo 恢复正常回显。比前端过滤 PTY 回显更可靠（VS Code 同款做法）。
    channel
        .request_pty(true, "xterm", 80, 24, 0, 0, &[(russh::Pty::ECHO, 0)])
        .await
        .map_err(|e| e.to_string())?;
    channel
        .request_shell(true)
        .await
        .map_err(|e| e.to_string())?;

    // 注入 OSC 7 CWD 上报钩子：每次提示符出现前，shell 发送当前目录给终端。
    // 前端解析 OSC 7 (file://host/path) 后更新文件管理面板路径，实现终端 cd 后面板跟随。
    // bash 用 PROMPT_COMMAND，zsh 用 precmd，sh/fish 兜底不注入（不影响功能）。
    // PROMPT_COMMAND 用 ${PROMPT_COMMAND:+;$PROMPT_COMMAND} 追加（而非覆盖）用户已有配置。
    //
    // 必须单行注入：多行脚本会让 bash 对每个未完结行输出 PS2 续行提示符（">"）。
    // PS2 是 shell 主动输出，PTY 关 ECHO 只能抑制输入回显、拦不住它，
    // 表现为连接后终端出现一串 "> > > >"。单行 + 末尾换行让 bash 一次读完
    // 整条命令，只输出一个新提示符；开头不带换行，避免额外空行提示符。
    //
    // 整行必须对 POSIX sh（dash）可解析：shell 先解析整行再执行，行尾的 stty echo
    // 是恢复回显的唯一机会，任何分支里出现 bash/zsh 专属语法（如 zsh 的数组追加
    // precmd_functions+=(...)）都会让 dash 直接抛 Syntax error、整行作废，
    // ECHO 永远开不回来——表现为连上后输入内容不可见。故 zsh 分支用
    // eval '...' 包裹：对其他 shell 只是一个字符串参数，仅 zsh 运行时执行。
    let cwd_hook = r#"__iterminal_cwd_report() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-localhost}" "$PWD"; }; if [ -n "$BASH_VERSION" ]; then PROMPT_COMMAND="__iterminal_cwd_report${PROMPT_COMMAND:+;$PROMPT_COMMAND}"; elif [ -n "$ZSH_VERSION" ]; then eval 'precmd_functions+=(__iterminal_cwd_report)'; fi; stty echo 2>/dev/null
"#;
    let _ = channel.data(cwd_hook.as_bytes()).await;

    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(10);
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(100);

    let shell_id = format!("{}-shell-{}", id, chrono::Utc::now().timestamp_millis());

    let shell_id_clone = shell_id.clone();
    let app_handle = app.clone();
    let connection_id = id.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,

                Some((cols, rows)) = resize_rx.recv() => {
                    if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                        eprintln!("Resize error for {}: {}", shell_id_clone, e);
                    }
                }

                Some(data) = write_rx.recv() => {
                    if let Err(e) = channel.data(&data[..]).await {
                        eprintln!("Write error for {}: {}", shell_id_clone, e);
                        cleanup_connection(&connection_id).await;
                        let _ = app_handle.emit(
                            &format!("connection-disconnected-{}", connection_id),
                            serde_json::json!({ "reason": "write_failed", "shell_id": shell_id_clone })
                        );
                        break;
                    }
                }

                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let data_str = String::from_utf8_lossy(&data).to_string();
                            let event_name = format!("shell-output-{}", shell_id_clone);
                            let _ = app_handle.emit(&event_name, &data_str);
                        }
                        Some(ChannelMsg::Eof) => {
                            let event_name = format!("shell-output-{}", shell_id_clone);
                            let _ = app_handle.emit(&event_name, serde_json::json!({"eof": true}));
                            break;
                        }
                        None => {
                            cleanup_connection(&connection_id).await;
                            let _ = app_handle.emit(
                                &format!("connection-disconnected-{}", connection_id),
                                serde_json::json!({ "reason": "channel_closed", "shell_id": shell_id_clone })
                            );
                            break;
                        }
                        Some(ChannelMsg::Close) => {
                            cleanup_connection(&connection_id).await;
                            let _ = app_handle.emit(
                                &format!("connection-disconnected-{}", connection_id),
                                serde_json::json!({ "reason": "server_close", "shell_id": shell_id_clone })
                            );
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    SHELLS.write().await.insert(
        shell_id.clone(),
        ShellSession {
            cancel_tx,
            resize_tx,
            write_tx,
        },
    );
    Ok(shell_id)
}

/// 打开容器交互终端（docker exec -it）。
///
/// 复用 get_shell 的 PTY + reader 机制，唯一区别：用 exec 执行
/// `docker exec -it {container} {shell}` 而非 request_shell。
/// shell_id 用同样的 `{connectionId}-shell-{ts}` 前缀，保证 cleanup_connection
/// 能正常 reap；注册进同一个 SHELLS，write_shell/resize_shell/close_shell 零改动复用。
#[tauri::command]
pub async fn get_docker_shell(
    id: String,
    container_id: String,
    app: AppHandle,
) -> Result<String, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    channel
        .request_pty(true, "xterm", 80, 24, 0, 0, &[])
        .await
        .map_err(|e| e.to_string())?;

    // docker exec -it：进入容器交互。优先 bash，容器若无 bash 会报错（前端提示）
    let exec_cmd = format!("docker exec -it {} bash", container_id);
    channel.exec(true, exec_cmd.as_str()).await.map_err(|e| e.to_string())?;

    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    let (resize_tx, mut resize_rx) = mpsc::channel::<(u32, u32)>(10);
    let (write_tx, mut write_rx) = mpsc::channel::<Vec<u8>>(100);

    let shell_id = format!("{}-shell-{}", id, chrono::Utc::now().timestamp_millis());

    let shell_id_clone = shell_id.clone();
    let app_handle = app.clone();

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,

                Some((cols, rows)) = resize_rx.recv() => {
                    if let Err(e) = channel.window_change(cols, rows, 0, 0).await {
                        eprintln!("Resize error for docker shell {}: {}", shell_id_clone, e);
                    }
                }

                Some(data) = write_rx.recv() => {
                    if let Err(e) = channel.data(&data[..]).await {
                        eprintln!("Write error for docker shell {}: {}", shell_id_clone, e);
                        let _ = app_handle.emit(
                            &format!("shell-output-{}", shell_id_clone),
                            serde_json::json!({"eof": true}),
                        );
                        break;
                    }
                }

                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let data_str = String::from_utf8_lossy(&data).to_string();
                            let event_name = format!("shell-output-{}", shell_id_clone);
                            let _ = app_handle.emit(&event_name, &data_str);
                        }
                        Some(ChannelMsg::Eof) => {
                            let event_name = format!("shell-output-{}", shell_id_clone);
                            let _ = app_handle.emit(&event_name, serde_json::json!({"eof": true}));
                            break;
                        }
                        None | Some(ChannelMsg::Close) => {
                            // docker exec 退出（exit/容器停止）不清理整个连接，
                            // 只通知前端 shell 结束
                            let event_name = format!("shell-output-{}", shell_id_clone);
                            let _ = app_handle.emit(&event_name, serde_json::json!({"eof": true}));
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }
    });

    SHELLS.write().await.insert(
        shell_id.clone(),
        ShellSession {
            cancel_tx,
            resize_tx,
            write_tx,
        },
    );
    Ok(shell_id)
}

#[tauri::command]
pub async fn write_shell(id: String, data: String) -> Result<bool, String> {
    let shells = SHELLS.read().await;
    let shell = shells.get(&id).ok_or("Shell not found")?;
    shell
        .write_tx
        .send(data.into_bytes())
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn close_shell(id: String) -> Result<bool, String> {
    if let Some(shell) = SHELLS.write().await.remove(&id) {
        let _ = shell.cancel_tx.send(());
    }
    Ok(true)
}

#[tauri::command]
pub async fn start_shell_reader(_id: String, _app: AppHandle) -> Result<bool, String> {
    // russh 版本中 reader 已在 get_shell 中启动，此函数保留以保持前端兼容性
    Ok(true)
}

#[tauri::command]
pub async fn resize_shell(id: String, cols: u16, rows: u16) -> Result<bool, String> {
    let shells = SHELLS.read().await;
    let shell = shells.get(&id).ok_or("Shell not found")?;
    shell
        .resize_tx
        .send((cols as u32, rows as u32))
        .await
        .map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn check_port_reachable(host: String, port: u16) -> Result<bool, String> {
    let addr = format!("{}:{}", host, port);
    let socket_addr = addr.to_socket_addrs().ok().and_then(|mut a| a.next());
    let Some(socket_addr) = socket_addr else {
        return Ok(false);
    };
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::TcpStream::connect(&socket_addr),
    )
    .await;
    Ok(result.is_ok() && result.unwrap().is_ok())
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SystemInfo {
    pub hostname: String,
    pub os: String,
    pub kernel: String,
    pub uptime: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CpuInfo {
    pub usage: f32,
    pub cores: u32,
    pub load_avg: String,
    pub per_core_usage: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MemoryInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub usage_percent: f32,
    pub swap_total: u64,
    pub swap_used: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskInfo {
    pub filesystem: String,
    pub mount_point: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub usage_percent: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MonitorData {
    pub system: SystemInfo,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub disks: Vec<DiskInfo>,
}

fn parse_disk_size(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    // df -h 对小于 10G 的容量输出一位小数（如 "1.9G"），必须用 f64 解析再取整
    let num_str = s.trim_end_matches(|c| c == 'K' || c == 'M' || c == 'G' || c == 'T');
    let num: f64 = num_str.parse().unwrap_or(0.0);

    let mb = if s.ends_with('T') {
        num * 1024.0 * 1024.0
    } else if s.ends_with('G') {
        num * 1024.0
    } else if s.ends_with('M') {
        num
    } else if s.ends_with('K') {
        num / 1024.0
    } else {
        num * 1024.0
    };
    mb.round() as u64
}

#[tauri::command]
pub async fn get_system_monitor(id: String) -> Result<MonitorData, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    let script = r#"
echo "<<H>>";hostname
echo "<<O>>";cat /etc/os-release 2>/dev/null|grep PRETTY_NAME|cut -d'"' -f2||echo Linux
echo "<<K>>";uname -r
echo "<<U>>";uptime -p 2>/dev/null|sed 's/up //'||echo unknown
echo "<<C>>";nproc
echo "<<L>>";cat /proc/loadavg
echo "<<P>>";top -bn1 2>/dev/null|grep -E 'Cpu|CPU'|head -1|awk '{print $2}'|cut -d'%' -f1||echo 0
echo "<<PC>>";mpstat -P ALL 1 1 2>/dev/null|awk '/Average/&&$2!="CPU"{print 100-$NF}'||for i in $(seq 0 $(($(nproc)-1)));do echo 0;done
echo "<<M>>";free -m|grep -E '^Mem|^Swap'
echo "<<D>>";df -h 2>/dev/null|grep '^/dev'||true
"#;

    channel
        .exec(true, script)
        .await
        .map_err(|e| e.to_string())?;

    let mut output = Vec::new();
    while let Some(msg) = channel.wait().await {
        if let ChannelMsg::Data { data } = msg {
            output.extend_from_slice(&data);
        }
    }

    // 显式关闭 channel，避免半关闭状态泄漏（监控面板高频轮询场景）
    let _ = channel.eof();
    let _ = channel.close().await;

    let output_str = String::from_utf8_lossy(&output).to_string();
    let mut section = "";
    let (mut hostname, mut os, mut kernel, mut uptime) = (
        "unknown".to_string(),
        "Linux".to_string(),
        "unknown".to_string(),
        "unknown".to_string(),
    );
    let (mut cores, mut load_avg, mut cpu_usage) = (1u32, "N/A".to_string(), 0.0f32);
    let mut per_core_usage: Vec<f32> = Vec::new();
    let (mut mem_total, mut mem_used, mut mem_free, mut swap_total, mut swap_used) =
        (0u64, 0u64, 0u64, 0u64, 0u64);
    let mut disks: Vec<DiskInfo> = Vec::new();

    for line in output_str.lines() {
        let trimmed = line.trim();
        if trimmed.contains("<<H>>") {
            section = "h";
            continue;
        }
        if trimmed.contains("<<O>>") {
            section = "o";
            continue;
        }
        if trimmed.contains("<<K>>") {
            section = "k";
            continue;
        }
        if trimmed.contains("<<U>>") {
            section = "u";
            continue;
        }
        if trimmed.contains("<<C>>") {
            section = "c";
            continue;
        }
        if trimmed.contains("<<L>>") {
            section = "l";
            continue;
        }
        if trimmed.contains("<<P>>") {
            section = "p";
            continue;
        }
        if trimmed.contains("<<PC>>") {
            section = "pc";
            continue;
        }
        if trimmed.contains("<<M>>") {
            section = "m";
            continue;
        }
        if trimmed.contains("<<D>>") {
            section = "d";
            continue;
        }

        match section {
            "h" => {
                hostname = trimmed.to_string();
                section = "";
            }
            "o" => {
                os = trimmed.to_string();
                section = "";
            }
            "k" => {
                kernel = trimmed.to_string();
                section = "";
            }
            "u" => {
                uptime = trimmed.to_string();
                section = "";
            }
            "c" => {
                cores = trimmed.parse().unwrap_or(1);
                section = "";
            }
            "l" => {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 3 {
                    load_avg = format!("{} / {} / {}", parts[0], parts[1], parts[2]);
                }
                section = "";
            }
            "p" => {
                cpu_usage = trimmed.parse().unwrap_or(0.0);
                section = "";
            }
            "pc" => {
                if let Ok(v) = trimmed.parse::<f32>() {
                    per_core_usage.push(v);
                }
            }
            "m" => {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if trimmed.starts_with("Mem:") && parts.len() >= 4 {
                    mem_total = parts[1].parse().unwrap_or(0);
                    mem_used = parts[2].parse().unwrap_or(0);
                    mem_free = parts[3].parse().unwrap_or(0);
                } else if trimmed.starts_with("Swap:") && parts.len() >= 3 {
                    swap_total = parts[1].parse().unwrap_or(0);
                    swap_used = parts[2].parse().unwrap_or(0);
                }
            }
            "d" => {
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 6 {
                    disks.push(DiskInfo {
                        filesystem: parts[0].to_string(),
                        mount_point: parts[5].to_string(),
                        total: parse_disk_size(parts[1]),
                        used: parse_disk_size(parts[2]),
                        available: parse_disk_size(parts[3]),
                        usage_percent: parts[4].trim_end_matches('%').parse().unwrap_or(0.0),
                    });
                }
            }
            _ => {}
        }
    }

    if per_core_usage.is_empty() {
        for _ in 0..cores {
            per_core_usage.push(cpu_usage);
        }
    }

    Ok(MonitorData {
        system: SystemInfo {
            hostname,
            os,
            kernel,
            uptime,
        },
        cpu: CpuInfo {
            usage: cpu_usage,
            cores,
            load_avg,
            per_core_usage,
        },
        memory: MemoryInfo {
            total: mem_total,
            used: mem_used,
            free: mem_free,
            usage_percent: if mem_total > 0 {
                (mem_used as f64 / mem_total as f64 * 100.0) as f32
            } else {
                0.0
            },
            swap_total,
            swap_used,
        },
        disks,
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkInterface {
    pub name: String,
    pub rx_bytes: u64,
    pub rx_packets: u64,
    pub rx_errors: u64,
    pub tx_bytes: u64,
    pub tx_packets: u64,
    pub tx_errors: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkStats {
    pub interfaces: Vec<NetworkInterface>,
}

#[tauri::command]
pub async fn get_network_stats(id: String) -> Result<NetworkStats, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    channel
        .exec(true, "cat /proc/net/dev")
        .await
        .map_err(|e| e.to_string())?;

    let mut output = Vec::new();
    while let Some(msg) = channel.wait().await {
        if let ChannelMsg::Data { data } = msg {
            output.extend_from_slice(&data);
        }
    }

    // 显式关闭 channel，避免半关闭状态泄漏（监控面板高频轮询场景）
    let _ = channel.eof();
    let _ = channel.close().await;

    let output_str = String::from_utf8_lossy(&output).to_string();
    let mut interfaces: Vec<NetworkInterface> = Vec::new();

    for line in output_str.lines().skip(2) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 17 {
            continue;
        }

        let name = parts[0].trim_end_matches(':').to_string();

        if name == "lo" {
            continue;
        }

        let rx_bytes = parts[1].parse().unwrap_or(0);
        let rx_packets = parts[2].parse().unwrap_or(0);
        let rx_errors = parts[3].parse().unwrap_or(0);
        let tx_bytes = parts[9].parse().unwrap_or(0);
        let tx_packets = parts[10].parse().unwrap_or(0);
        let tx_errors = parts[11].parse().unwrap_or(0);

        interfaces.push(NetworkInterface {
            name,
            rx_bytes,
            rx_packets,
            rx_errors,
            tx_bytes,
            tx_packets,
            tx_errors,
        });
    }

    Ok(NetworkStats { interfaces })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub user: String,
    pub cpu: f32,
    pub mem: f32,
    pub vsz: u64,
    pub rss: u64,
    pub command: String,
}

#[tauri::command]
pub async fn list_processes(id: String) -> Result<Vec<ProcessInfo>, String> {
    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    channel
        .exec(true, "ps aux --sort=-%mem | head -50")
        .await
        .map_err(|e| e.to_string())?;

    let mut output = Vec::new();
    while let Some(msg) = channel.wait().await {
        if let ChannelMsg::Data { data } = msg {
            output.extend_from_slice(&data);
        }
    }

    // 显式关闭 channel，避免半关闭状态泄漏（监控面板高频轮询场景）
    let _ = channel.eof();
    let _ = channel.close().await;

    let output_str = String::from_utf8_lossy(&output).to_string();
    let mut processes: Vec<ProcessInfo> = Vec::new();

    for line in output_str.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 11 {
            continue;
        }

        let pid = parts[1].parse().unwrap_or(0);
        let user = parts[0].to_string();
        let cpu = parts[2].parse().unwrap_or(0.0);
        let mem = parts[3].parse().unwrap_or(0.0);
        let vsz = parts[4].parse().unwrap_or(0);
        let rss = parts[5].parse().unwrap_or(0);
        let command = parts[10..].join(" ");

        processes.push(ProcessInfo {
            pid,
            user,
            cpu,
            mem,
            vsz,
            rss,
            command,
        });
    }

    Ok(processes)
}

#[tauri::command]
pub async fn kill_process(id: String, pid: u32, signal: Option<String>) -> Result<(), String> {
    let sig = signal.unwrap_or_else(|| "TERM".to_string());

    if !sig.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Invalid signal name".to_string());
    }

    let sessions = SESSIONS.read().await;
    let session = sessions.get(&id).ok_or("Session not found")?;
    let mut channel = session
        .handle
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;
    drop(sessions);

    let cmd = format!("kill -{} {}", sig, pid);

    channel
        .exec(true, cmd.as_str())
        .await
        .map_err(|e| e.to_string())?;

    let mut exit_status: u32 = 0;
    while let Some(msg) = channel.wait().await {
        if let ChannelMsg::ExitStatus {
            exit_status: status,
        } = msg
        {
            exit_status = status;
        }
    }

    if exit_status != 0 {
        return Err(format!(
            "kill command failed with exit code {}",
            exit_status
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_method_parses_and_serializes() {
        assert_eq!(parse_auth_method("agent").unwrap(), AuthMethod::Agent);
        assert_eq!(parse_auth_method("publickey").unwrap(), AuthMethod::PublicKey);
        assert_eq!(parse_auth_method("password").unwrap(), AuthMethod::Password);
        assert!(parse_auth_method("key").is_err());
        // 存库用的字符串形式
        assert_eq!(serde_json::to_string(&AuthMethod::Agent).unwrap(), "\"agent\"");
    }

    #[test]
    fn old_callers_without_new_fields_still_deserialize() {
        let connection: SSHConnection = serde_json::from_str(
            r#"{"host":"10.0.0.1","port":22,"username":"root","password":"pw","key_file":null}"#,
        )
        .unwrap();
        assert_eq!(connection.key_passphrase, None);
        assert_eq!(connection.auth_method, None);
        assert_eq!(connection.jump_host_id, None);
        // 老行为：没指定认证方式时，有密钥文件用密钥
        assert_eq!(resolve_auth_method(&connection), AuthMethod::Password);
        let with_key = SSHConnection {
            key_file: Some("~/.ssh/id_ed25519".into()),
            ..connection
        };
        assert_eq!(resolve_auth_method(&with_key), AuthMethod::PublicKey);
    }

    #[test]
    fn explicit_auth_method_wins_over_inference() {
        let connection = SSHConnection {
            key_file: Some("~/.ssh/id_ed25519".into()),
            auth_method: Some(AuthMethod::Agent),
            ..Default::default()
        };
        assert_eq!(resolve_auth_method(&connection), AuthMethod::Agent);
    }

    #[test]
    fn jump_checks_reject_cycles_and_too_many_layers() {
        let path = vec!["b".to_string(), "c".to_string()];
        assert!(check_jump("a", "a", 0, &path).is_ok());
        assert!(check_jump("b", "web-b", 0, &path).unwrap_err().contains("成环"));
        assert!(check_jump("b", "web-b", 0, &path).unwrap_err().contains("web-b"));
        assert!(check_jump("a", "a", MAX_JUMP_DEPTH, &path)
            .unwrap_err()
            .contains("超过 3 层"));
    }

    #[test]
    fn password_like_prompts_are_recognized() {
        let prompt = |text: &str, echo| russh::client::Prompt {
            prompt: text.into(),
            echo,
        };
        assert!(is_password_prompt(&prompt("Password: ", false)));
        assert!(is_password_prompt(&prompt("user@host's password:", false)));
        assert!(is_password_prompt(&prompt("请输入密码:", false)));
        // 动态口令、验证码不算密码，哪怕同样不回显
        assert!(!is_password_prompt(&prompt("Verification code:", false)));
        // 回显的提问（用户名之类）也不算
        assert!(!is_password_prompt(&prompt("Password: ", true)));
    }

    #[test]
    fn question_carries_only_the_prompts_left_for_the_user() {
        let connection = SSHConnection {
            host: "10.0.0.1".into(),
            port: 2222,
            username: "ops".into(),
            ..Default::default()
        };
        let prompts = vec![
            russh::client::Prompt {
                prompt: "Password:".into(),
                echo: false,
            },
            russh::client::Prompt {
                prompt: "Verification code:".into(),
                echo: false,
            },
            russh::client::Prompt {
                prompt: "Region".into(),
                echo: true,
            },
        ];
        let question = build_question(
            &connection,
            "Google Authenticator",
            "Enter code",
            &prompts,
            &[1, 2],
        );
        assert_eq!(
            (question.host.as_str(), question.port, question.username.as_str()),
            ("10.0.0.1", 2222, "ops")
        );
        assert_eq!(question.name, "Google Authenticator");
        assert_eq!(question.instruction, "Enter code");
        assert_eq!(
            question.prompts,
            vec![
                AuthPrompt {
                    prompt: "Verification code:".into(),
                    echo: false
                },
                AuthPrompt {
                    prompt: "Region".into(),
                    echo: true
                },
            ]
        );
    }
}
