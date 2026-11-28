//! 主机密钥校验：连接前核对服务器身份，防止把密码发到冒充的机器上（中间人）。
//!
//! 信任记录放在应用自己的 known_hosts 表里，每台主机的每种密钥类型一条；
//! 用户的 ~/.ssh/known_hosts 只读不写——里面已有的信任直接沿用，冲突同样告警。
//! 需要用户确认时建连以「挑战」错误结束（见 [`CHALLENGE_PREFIX`]），由调用方弹窗、
//! 记下信任后重连。后端不替用户做信任决定，唯一例外是调用方显式要求的
//! [`HostKeyPolicy::AcceptNew`]（等同 OpenSSH 的 accept-new，只自动接受首次见到的密钥）。

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use base64::Engine;
use russh::keys::{HashAlg, PublicKey, PublicKeyBase64};
use serde::{Deserialize, Serialize};

use super::db;

/// 主机密钥挑战错误串的前缀，其后是 JSON 序列化的 [`HostKeyChallenge`]。
/// 应用界面与 MCP 链路都靠它区分「需要用户确认」和普通连接失败。
pub const CHALLENGE_PREFIX: &str = "HOST_KEY_CHALLENGE:";

/// 连接时遇到未信任的主机密钥怎么办
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKeyPolicy {
    /// 必须已信任，否则建连失败并返回挑战
    RequireTrusted,
    /// 首次见到的密钥直接记下并继续；已信任的密钥变了仍然拒绝
    AcceptNew,
}

/// 一把主机公钥：存储用的原始内容，外加给人核对的指纹
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HostKeyInfo {
    /// 密钥类型，如 ssh-ed25519
    pub key_type: String,
    /// 公钥内容（SSH 线格式 blob 的 base64，即 known_hosts 每行的第三段）
    pub key: String,
    /// SHA256 指纹，与 `ssh-keygen -lf` 的输出一致
    pub fingerprint: String,
}

impl HostKeyInfo {
    fn of(public: &PublicKey) -> Self {
        Self {
            key_type: public.algorithm().to_string(),
            key: base64::engine::general_purpose::STANDARD.encode(public.public_key_bytes()),
            fingerprint: public.fingerprint(HashAlg::Sha256).to_string(),
        }
    }

    /// 由信任记录的入参构造。类型名与内容对不上、内容不是公钥的都拒绝，不把坏数据写进信任记录。
    pub fn parse(key_type: &str, key: &str) -> Result<Self, String> {
        let text = format!("{} {}", key_type.trim(), key.trim());
        PublicKey::from_openssh(&text)
            .map(|public| Self::of(&public))
            .map_err(|_| "主机密钥格式无效".to_string())
    }
}

/// 核对结论
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Verdict {
    /// 与信任记录一致
    Trusted,
    /// 这台主机的这种密钥第一次见到
    Unknown,
    /// 与之前信任的密钥不一致——可能是服务器重装，也可能是中间人
    Changed(HostKeyInfo),
}

/// 拿收到的密钥对同一类型的信任记录：有记录且一致才算信任；
/// 同类型记录存在但内容不同按「变化」处理，没有同类型记录按「首次见到」。
/// 与 OpenSSH 一致——known_hosts 只比对同类型的行。
fn classify(presented: &HostKeyInfo, stored: Option<&HostKeyInfo>) -> Verdict {
    match stored {
        Some(stored) if stored.key == presented.key => Verdict::Trusted,
        Some(stored) => Verdict::Changed(stored.clone()),
        None => Verdict::Unknown,
    }
}

/// 需要用户确认的主机密钥
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HostKeyChallenge {
    /// 这台主机的这种密钥第一次见到
    Unknown {
        host: String,
        port: u16,
        presented: HostKeyInfo,
    },
    /// 与之前信任的密钥不一致
    Changed {
        host: String,
        port: u16,
        presented: HostKeyInfo,
        trusted: HostKeyInfo,
    },
}

impl HostKeyChallenge {
    pub(crate) fn to_error_string(&self) -> String {
        format!(
            "{}{}",
            CHALLENGE_PREFIX,
            serde_json::to_string(self).unwrap_or_default()
        )
    }
}

/// 从建连错误里取出主机密钥挑战；不是挑战返回 None
pub fn parse_challenge(error: &str) -> Option<HostKeyChallenge> {
    serde_json::from_str(error.strip_prefix(CHALLENGE_PREFIX)?).ok()
}

/// 挑战转成给人看的说明，供没法弹窗的调用方（SFTP 建连）使用；不是挑战返回 None
pub fn describe(error: &str) -> Option<String> {
    let challenge = parse_challenge(error)?;
    Some(match challenge {
        HostKeyChallenge::Unknown {
            host,
            port,
            presented,
        } => format!(
            "尚未信任 {}:{} 的主机密钥（{} {}），请先在终端里连接一次并确认",
            host, port, presented.key_type, presented.fingerprint
        ),
        HostKeyChallenge::Changed {
            host,
            port,
            presented,
            trusted,
        } => format!(
            "{}:{} 的主机密钥已变化（原 {} {}，现为 {} {}），请在终端里连接一次并确认是否可信",
            host, port, trusted.key_type, trusted.fingerprint, presented.key_type, presented.fingerprint
        ),
    })
}

/// 主机名统一成小写再查/存：域名不区分大小写，避免同一台机器记成两条
fn normalize_host(host: &str) -> String {
    host.trim().to_lowercase()
}

/// 核对服务器密钥。阻塞（读数据库和 known_hosts 文件），需放在 blocking 线程里跑。
fn check_sync(host: &str, port: u16, presented: &HostKeyInfo, policy: HostKeyPolicy) -> Verdict {
    let verdict = classify(
        presented,
        db_stored(host, port, &presented.key_type).as_ref(),
    );
    if verdict != Verdict::Unknown {
        return verdict;
    }

    let verdict = classify(
        presented,
        openssh_stored(host, port, &presented.key_type).as_ref(),
    );
    if verdict != Verdict::Unknown {
        return verdict;
    }

    // 自动信任只有真的记下来了才算数：记不下来就照常返回挑战，让用户来确认
    if policy == HostKeyPolicy::AcceptNew && db_trust(host, port, presented).is_ok() {
        return Verdict::Trusted;
    }
    Verdict::Unknown
}

/// 应用自己的信任记录里，这台主机、这种类型的密钥
fn db_stored(host: &str, port: u16, key_type: &str) -> Option<HostKeyInfo> {
    let conn = db::get_db().ok()?;
    let key = conn
        .query_row(
            "SELECT key FROM known_hosts WHERE host = ?1 AND port = ?2 AND key_type = ?3",
            rusqlite::params![host, port, key_type],
            |row| row.get::<_, String>(0),
        )
        .ok()?;
    HostKeyInfo::parse(key_type, &key).ok()
}

fn db_trust(host: &str, port: u16, info: &HostKeyInfo) -> Result<(), String> {
    let conn = db::get_db()?;
    conn.execute(
        "INSERT OR REPLACE INTO known_hosts (host, port, key_type, key, first_seen_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
        rusqlite::params![host, port, info.key_type, info.key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 用户 OpenSSH known_hosts 里这台主机、这种类型的密钥。
/// 读不出来（没有文件、行损坏、@cert-authority 之类带标记的行）一律当作没有：
/// 后果只是多问一次用户，不会放行错误的密钥。
fn openssh_stored(host: &str, port: u16, key_type: &str) -> Option<HostKeyInfo> {
    let path = openssh_known_hosts_path()?;
    let entries = russh::keys::known_hosts::known_host_keys_path(host, port, &path).ok()?;
    entries
        .iter()
        .map(|(_, public)| HostKeyInfo::of(public))
        .find(|info| info.key_type == key_type)
}

fn openssh_known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".ssh").join("known_hosts"))
}

/// 建连期间主机密钥校验的结果出口：需要用户确认时把挑战放在这里，
/// 建连随后失败，调用方取出来交给界面
#[derive(Clone, Default)]
pub struct HostKeyReport(pub(crate) Arc<Mutex<Option<HostKeyChallenge>>>);

impl HostKeyReport {
    /// 取出（并清空）待确认的挑战
    pub fn take(&self) -> Option<HostKeyChallenge> {
        self.0.lock().ok().and_then(|mut slot| slot.take())
    }
}

/// 核对服务器密钥。返回 false 表示拒绝，待确认的挑战已放进 report。
pub async fn verify(
    host: &str,
    port: u16,
    public: &PublicKey,
    policy: HostKeyPolicy,
    report: HostKeyReport,
) -> bool {
    let host = normalize_host(host);
    let presented = HostKeyInfo::of(public);
    let verdict = {
        let host = host.clone();
        let presented = presented.clone();
        tokio::task::spawn_blocking(move || check_sync(&host, port, &presented, policy))
            .await
            // 校验本身出错也不放行，按「首次见到」交给用户确认
            .unwrap_or(Verdict::Unknown)
    };

    let challenge = match &verdict {
        Verdict::Trusted => return true,
        Verdict::Unknown => HostKeyChallenge::Unknown {
            host,
            port,
            presented,
        },
        Verdict::Changed(trusted) => HostKeyChallenge::Changed {
            host,
            port,
            presented,
            trusted: trusted.clone(),
        },
    };
    if let Ok(mut slot) = report.0.lock() {
        *slot = Some(challenge);
    }
    false
}

#[derive(Debug, Serialize, Deserialize)]
pub struct KnownHostRecord {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub key: String,
    pub fingerprint: String,
    pub first_seen_at: Option<String>,
}

/// 已信任的主机密钥列表
#[tauri::command]
pub fn get_known_hosts() -> Result<Vec<KnownHostRecord>, String> {
    let conn = db::get_db()?;
    let mut stmt = conn
        .prepare("SELECT host, port, key_type, key, first_seen_at FROM known_hosts ORDER BY host, port, key_type")
        .map_err(|e| e.to_string())?;

    let records = stmt
        .query_map([], |row| {
            let key_type: String = row.get(2)?;
            let key: String = row.get(3)?;
            // 指纹不落库，读的时候由公钥算出，和校验时的口径一致
            let fingerprint = HostKeyInfo::parse(&key_type, &key)
                .map(|info| info.fingerprint)
                .unwrap_or_default();
            Ok(KnownHostRecord {
                host: row.get(0)?,
                port: row.get(1)?,
                key_type,
                key,
                fingerprint,
                first_seen_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for record in records {
        match record {
            Ok(record) => result.push(record),
            Err(e) => eprintln!("[HostKey] Failed to parse known_hosts row: {}", e),
        }
    }
    Ok(result)
}

/// 记下对一把主机密钥的信任（用户在确认框里点了「信任」之后调用）
#[tauri::command]
pub fn trust_host_key(host: String, port: u16, key_type: String, key: String) -> Result<bool, String> {
    let info = HostKeyInfo::parse(&key_type, &key)?;
    db_trust(&normalize_host(&host), port, &info)?;
    Ok(true)
}

/// 忘记一台主机的密钥；不给 key_type 就忘掉它的全部类型
#[tauri::command]
pub fn forget_host_key(host: String, port: u16, key_type: Option<String>) -> Result<bool, String> {
    let conn = db::get_db()?;
    let host = normalize_host(&host);
    match key_type {
        Some(key_type) => conn.execute(
            "DELETE FROM known_hosts WHERE host = ?1 AND port = ?2 AND key_type = ?3",
            rusqlite::params![host, port, key_type],
        ),
        None => conn.execute(
            "DELETE FROM known_hosts WHERE host = ?1 AND port = ?2",
            rusqlite::params![host, port],
        ),
    }
    .map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    // GitHub 公开的 ED25519 主机密钥
    const GITHUB_ED25519: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";
    const ANOTHER_ED25519: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIJdD7y3aLq454yWBdwLWbieU1ebz9/cu7/QEXn9OIeZJ";

    fn info(body: &str) -> HostKeyInfo {
        HostKeyInfo::parse("ssh-ed25519", body).unwrap()
    }

    /// 用系统 ssh-keygen 算同一把钥匙的指纹，确认我们的格式与 OpenSSH 一致
    fn openssh_fingerprint(body: &str) -> Option<String> {
        let path = std::env::temp_dir().join(format!("iterminal-hostkey-test-{}.pub", std::process::id()));
        std::fs::write(&path, format!("ssh-ed25519 {body}\n")).ok()?;
        let output = std::process::Command::new("ssh-keygen").arg("-lf").arg(&path).output().ok()?;
        let _ = std::fs::remove_file(&path);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let fingerprint = stdout.lines().next()?.split_whitespace().nth(1)?.to_string();
        Some(fingerprint)
    }

    #[test]
    fn fingerprint_matches_openssh() {
        let github = info(GITHUB_ED25519);
        assert_eq!(github.key_type, "ssh-ed25519");
        assert_eq!(github.key, GITHUB_ED25519);
        assert_eq!(github.fingerprint, "SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU");
        if let Some(expected) = openssh_fingerprint(ANOTHER_ED25519) {
            assert_eq!(info(ANOTHER_ED25519).fingerprint, expected);
        }
    }

    #[test]
    fn parse_rejects_bad_input() {
        // 类型名与内容对不上
        assert!(HostKeyInfo::parse("ssh-rsa", GITHUB_ED25519).is_err());
        assert!(HostKeyInfo::parse("ssh-ed25519", "not base64!!").is_err());
        assert!(HostKeyInfo::parse("ssh-ed25519", "").is_err());
    }

    #[test]
    fn classify_trusted_changed_unknown() {
        let presented = info(GITHUB_ED25519);
        assert_eq!(classify(&presented, Some(&presented)), Verdict::Trusted);
        assert_eq!(classify(&presented, None), Verdict::Unknown);

        let old = info(ANOTHER_ED25519);
        assert_eq!(classify(&presented, Some(&old)), Verdict::Changed(old.clone()));
        // 同一把钥匙、类型大小写不同的主机名不影响内容比对
        assert_eq!(classify(&presented, Some(&info(GITHUB_ED25519))), Verdict::Trusted);
    }

    #[test]
    fn challenge_round_trips_through_error_string() {
        let presented = info(GITHUB_ED25519);
        let unknown = HostKeyChallenge::Unknown {
            host: "web1.example.com".into(),
            port: 2222,
            presented: presented.clone(),
        };
        let error = unknown.to_error_string();
        assert!(error.starts_with("HOST_KEY_CHALLENGE:"));
        assert_eq!(parse_challenge(&error), Some(unknown.clone()));

        let trusted = info(ANOTHER_ED25519);
        let changed = HostKeyChallenge::Changed {
            host: "10.0.0.5".into(),
            port: 22,
            presented: presented.clone(),
            trusted: trusted.clone(),
        };
        assert_eq!(parse_challenge(&changed.to_error_string()), Some(changed));
    }

    #[test]
    fn ordinary_errors_are_not_challenges() {
        assert_eq!(parse_challenge("连接失败: Connection refused"), None);
        assert_eq!(parse_challenge("HOST_KEY_CHALLENGE:not json"), None);
        assert_eq!(describe("认证失败"), None);
    }

    #[test]
    fn describe_mentions_fingerprints() {
        let unknown = HostKeyChallenge::Unknown {
            host: "web1".into(),
            port: 22,
            presented: info(GITHUB_ED25519),
        };
        let text = describe(&unknown.to_error_string()).unwrap();
        assert!(text.contains("web1:22"), "{text}");
        assert!(text.contains("ssh-ed25519"), "{text}");
        assert!(text.contains("SHA256:"), "{text}");

        let changed = HostKeyChallenge::Changed {
            host: "web1".into(),
            port: 22,
            presented: info(GITHUB_ED25519),
            trusted: info(ANOTHER_ED25519),
        };
        let text = describe(&changed.to_error_string()).unwrap();
        assert!(text.contains("已变化"), "{text}");
        // 新旧两个指纹都要出现，用户才能对比
        let fp_new = info(GITHUB_ED25519).fingerprint;
        let fp_old = info(ANOTHER_ED25519).fingerprint;
        assert!(text.contains(&fp_new) && text.contains(&fp_old), "{text}");
    }

    #[test]
    fn report_holds_one_challenge_until_taken() {
        let report = HostKeyReport::default();
        assert_eq!(report.take(), None);
        let slot = &report.0;
        *slot.lock().unwrap() = Some(HostKeyChallenge::Unknown {
            host: "h".into(),
            port: 22,
            presented: info(GITHUB_ED25519),
        });
        assert!(report.take().is_some());
        assert_eq!(report.take(), None);
    }

    #[test]
    fn host_names_are_normalized() {
        assert_eq!(normalize_host("  Web1.Example.COM "), "web1.example.com");
    }
}
