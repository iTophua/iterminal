//! 导入用户的 ~/.ssh/config。老用户往往已经有几十条 Host 配置，
//! 让他们一条条重录是迁移路上最大的摩擦。

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use super::db::{self, ConnectionRecord};

/// ~/.ssh/config 里的一个 Host 块
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshConfigEntry {
    /// Host 后面的别名（连接时用的名字），导入后作为连接名
    pub alias: String,
    /// HostName；没写时就是别名本身
    pub host_name: String,
    pub port: u16,
    pub user: Option<String>,
    /// 第一条 IdentityFile
    pub identity_file: Option<String>,
    /// ProxyJump 指向的跳板机别名
    pub proxy_jump: Option<String>,
    /// 这一条用了没法照搬的配置（如 ProxyCommand），导入时跳过
    pub unsupported: Option<String>,
    /// Host 所在的行号，提示用
    pub line: usize,
}

#[derive(Debug, Default, Serialize)]
pub struct SshConfigImportResult {
    pub imported: usize,
    /// 跳过的别名：已存在同样主机/端口/用户名的连接
    pub skipped: Vec<String>,
}

struct Block {
    patterns: Vec<String>,
    options: Vec<(String, String)>,
    line: usize,
}

/// OpenSSH 的 Host 通配：`*` 任意长度、`?` 单个字符，不区分大小写
fn pattern_matches(pattern: &str, alias: &str) -> bool {
    fn glob(pattern: &[u8], alias: &[u8]) -> bool {
        match (pattern, alias) {
            ([], []) => true,
            ([b'*', rest @ ..], _) => glob(rest, alias) || matches!(alias, [_, tail @ ..] if glob(pattern, tail)),
            ([b'?', p_rest @ ..], [_, a_rest @ ..]) => glob(p_rest, a_rest),
            ([expected, p_rest @ ..], [actual, a_rest @ ..]) => {
                expected.eq_ignore_ascii_case(actual) && glob(p_rest, a_rest)
            }
            _ => false,
        }
    }
    glob(pattern.as_bytes(), alias.as_bytes())
}

/// 一行 → (小写关键字, 值)。`Key Value` 与 `Key=Value` 两种写法都认
fn parse_line(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let key_end = line
        .find(|c: char| c.is_whitespace() || c == '=')
        .unwrap_or(line.len());
    let key = line[..key_end].to_ascii_lowercase();
    let value = line[key_end..]
        .trim_start_matches(|c: char| c == '=' || c.is_whitespace())
        .trim()
        .trim_matches('"');
    Some((key, value.to_string()))
}

/// 这个块对给定别名是否生效：至少一个正向模式命中，且没有负向模式（!开头）命中
fn block_applies(block: &Block, alias: &str) -> bool {
    let mut positive = false;
    for pattern in &block.patterns {
        if let Some(negated) = pattern.strip_prefix('!') {
            if pattern_matches(negated, alias) {
                return false;
            }
        } else if pattern_matches(pattern, alias) {
            positive = true;
        }
    }
    positive
}

fn build_entry(alias: &str, line: usize, blocks: &[Block]) -> SshConfigEntry {
    let mut entry = SshConfigEntry {
        alias: alias.to_string(),
        host_name: String::new(),
        port: 22,
        user: None,
        identity_file: None,
        proxy_jump: None,
        unsupported: None,
        line,
    };
    // OpenSSH 的规则：每个参数以最先出现的为准，所以见过的关键字不再覆盖
    let mut seen = HashSet::new();
    for block in blocks {
        if !block_applies(block, alias) {
            continue;
        }
        for (key, value) in &block.options {
            if !seen.insert(key.as_str()) {
                continue;
            }
            match key.as_str() {
                "hostname" => entry.host_name = value.clone(),
                "user" => entry.user = Some(value.clone()),
                "port" => entry.port = value.parse().unwrap_or(22),
                "identityfile" => entry.identity_file = Some(value.clone()),
                "proxyjump" if value != "none" => entry.proxy_jump = Some(value.clone()),
                "proxycommand" => entry.unsupported = Some("ProxyCommand".to_string()),
                _ => {}
            }
        }
    }
    if entry.host_name.is_empty() {
        entry.host_name = alias.to_string();
    }
    entry
}

/// 解析 ssh config：每个具体的 Host 别名一条，按文件里的先后顺序。
///
/// - 带 `*` / `?` 的 Host 只给别的条目当默认值，本身不是一台机器
/// - `Host a b` 多个别名只取第一个
/// - `Match` 块的条件离不开实际连接，整块不当默认值用
pub fn parse_ssh_config(text: &str) -> Vec<SshConfigEntry> {
    let mut blocks: Vec<Block> = Vec::new();
    for (index, raw) in text.lines().enumerate() {
        let Some((key, value)) = parse_line(raw) else {
            continue;
        };
        if key == "host" {
            blocks.push(Block {
                patterns: value.split_whitespace().map(str::to_string).collect(),
                options: Vec::new(),
                line: index + 1,
            });
        } else if key == "match" {
            blocks.push(Block {
                patterns: Vec::new(),
                options: Vec::new(),
                line: index + 1,
            });
        } else if let Some(block) = blocks.last_mut() {
            block.options.push((key, value));
        }
    }

    let mut entries: Vec<SshConfigEntry> = Vec::new();
    for block in &blocks {
        let Some(alias) = block.patterns.first() else {
            continue;
        };
        if alias.contains('*') || alias.contains('?') || alias.starts_with('!') {
            continue;
        }
        if entries.iter().any(|entry| entry.alias.eq_ignore_ascii_case(alias)) {
            continue;
        }
        entries.push(build_entry(alias, block.line, &blocks));
    }
    entries
}

fn config_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|home| home.join(".ssh").join("config"))
}

fn read_text() -> Result<String, String> {
    let path = config_path().ok_or("找不到用户主目录")?;
    std::fs::read_to_string(&path).map_err(|_| format!("读不到 {}（文件不存在或没有权限）", path.display()))
}

fn local_username() -> Option<String> {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .ok()
        .filter(|name| !name.is_empty())
}

/// 预览 ~/.ssh/config 里可导入的 Host
#[tauri::command]
pub fn preview_ssh_config() -> Result<Vec<SshConfigEntry>, String> {
    Ok(parse_ssh_config(&read_text()?))
}

/// 界面用：把预览里选中的条目存成连接
#[tauri::command]
pub fn import_ssh_config(
    entries: Vec<SshConfigEntry>,
    group: Option<String>,
) -> Result<SshConfigImportResult, String> {
    import(&entries, group.as_deref())
}

/// 把预览里选中的条目存成连接。
///
/// - 没写 User 的用本机用户名（与 OpenSSH 一致）
/// - 主机/端口/用户名都相同的连接已存在时跳过，重复导入不会堆出重复项
/// - ProxyJump 指向的别名如果也在这次导入里（或已有同名连接），自动接上跳板机
pub fn import(entries: &[SshConfigEntry], group: Option<&str>) -> Result<SshConfigImportResult, String> {
    let existing = db::get_connections()?;
    let taken: HashSet<(String, u16, String)> = existing
        .iter()
        .map(|record| (record.host.to_lowercase(), record.port, record.username.to_lowercase()))
        .collect();

    let stamp = chrono::Utc::now().timestamp_millis();
    // 别名 → 连接 id：ProxyJump 靠它找到跳板机
    let mut id_by_alias: std::collections::HashMap<String, String> = existing
        .iter()
        .map(|record| (record.name.to_lowercase(), record.id.clone()))
        .collect();
    let mut plan: Vec<(usize, ConnectionRecord)> = Vec::new();
    let mut result = SshConfigImportResult::default();

    for (index, entry) in entries.iter().enumerate() {
        let username = entry
            .user
            .clone()
            .or_else(local_username)
            .unwrap_or_else(|| "root".to_string());
        let key = (entry.host_name.to_lowercase(), entry.port, username.to_lowercase());
        if taken.contains(&key) {
            result.skipped.push(entry.alias.clone());
            continue;
        }
        let id = format!("conn-sshcfg-{}-{}", stamp, index);
        id_by_alias.insert(entry.alias.to_lowercase(), id.clone());
        plan.push((index, ConnectionRecord {
            id,
            name: entry.alias.clone(),
            host: entry.host_name.clone(),
            port: entry.port,
            username,
            password: None,
            key_file: entry.identity_file.clone(),
            key_passphrase: None,
            auth_method: entry.identity_file.as_ref().map(|_| "publickey".to_string()),
            jump_host_id: None,
            group_name: group.map(str::to_string),
            tags: Some("[\"ssh-config\"]".to_string()),
            last_connected_at: None,
            created_at: None,
            updated_at: None,
            sort_order: None,
        }));
    }

    // 跳板机都规划完再回填：ProxyJump 可以指向文件里排在后面的 Host
    for (index, record) in &mut plan {
        if let Some(jump) = &entries[*index].proxy_jump {
            record.jump_host_id = id_by_alias.get(&jump.to_lowercase()).cloned();
        }
    }

    for (_, record) in plan {
        db::save_connection(record)?;
        result.imported += 1;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
# 个人服务器
Host bastion
  HostName 203.0.113.10
  User deploy
  IdentityFile ~/.ssh/id_ed25519

Host web1 web1-alt
    HostName 10.0.0.5
    Port 2222
    ProxyJump bastion
    IdentityFile ~/.ssh/work_key
    IdentityFile ~/.ssh/id_rsa

Host app.internal
    HostName app-1.corp

Host KEY=FORM
    Port=2201

Host *.internal
    User ops
    Port 2200

Host *
    ServerAliveInterval 60
    User fallback
    Port 2222

Match host "special*" exec "true"
    User someone

Host via-command
    HostName example.net
    ProxyCommand nc %h %p
"#;

    fn entry<'a>(entries: &'a [SshConfigEntry], alias: &str) -> &'a SshConfigEntry {
        entries.iter().find(|e| e.alias == alias).unwrap_or_else(|| panic!("{alias} not parsed"))
    }

    #[test]
    fn parses_concrete_hosts_in_order() {
        let entries = parse_ssh_config(SAMPLE);
        let aliases: Vec<&str> = entries.iter().map(|e| e.alias.as_str()).collect();
        // 多别名只取第一个；通配 Host 和 Match 块不是机器
        assert_eq!(aliases, ["bastion", "web1", "app.internal", "KEY=FORM", "via-command"]);
    }

    #[test]
    fn first_value_wins_and_star_block_fills_defaults() {
        let entries = parse_ssh_config(SAMPLE);
        let bastion = entry(&entries, "bastion");
        assert_eq!(bastion.host_name, "203.0.113.10");
        assert_eq!(bastion.user.as_deref(), Some("deploy"));
        assert_eq!(bastion.identity_file.as_deref(), Some("~/.ssh/id_ed25519"));
        // 自己没写端口，取 Host * 的
        assert_eq!(bastion.port, 2222);

        let web1 = entry(&entries, "web1");
        assert_eq!(web1.port, 2222);
        assert_eq!(web1.proxy_jump.as_deref(), Some("bastion"));
        // 多条 IdentityFile 只取第一条；User 没写，取 Host * 的
        assert_eq!(web1.identity_file.as_deref(), Some("~/.ssh/work_key"));
        assert_eq!(web1.user.as_deref(), Some("fallback"));
    }

    #[test]
    fn wildcard_blocks_apply_before_global_defaults() {
        let entries = parse_ssh_config(SAMPLE);
        let app = entry(&entries, "app.internal");
        assert_eq!(app.host_name, "app-1.corp");
        // *.internal 排在 Host * 前面，先出现的生效
        assert_eq!(app.user.as_deref(), Some("ops"));
        assert_eq!(app.port, 2200);
    }

    #[test]
    fn unsupported_and_edge_cases() {
        let entries = parse_ssh_config(SAMPLE);
        assert_eq!(entry(&entries, "via-command").unsupported.as_deref(), Some("ProxyCommand"));
        // HostName 里带 %h 之类记号的不展开
        let token = parse_ssh_config("Host odd\n  HostName %h.example.com\n");
        assert_eq!(token[0].host_name, "%h.example.com");
        // Key=Value 写法；关键字大小写不敏感；没写 HostName 时用别名
        let form = entry(&entries, "KEY=FORM");
        assert_eq!(form.port, 2201);
        assert_eq!(form.host_name, "KEY=FORM");
        // 自己写了 User/Port 的条目不被后面的 Host * 覆盖
        assert_eq!(entry(&entries, "web1").user.as_deref(), Some("fallback"));
        assert!(parse_ssh_config("").is_empty());
        assert!(parse_ssh_config("# only a comment\n\n").is_empty());
    }

    #[test]
    fn host_patterns() {
        assert!(pattern_matches("*", "anything"));
        assert!(pattern_matches("Web*", "webserver-01"));
        assert!(pattern_matches("app?.internal", "app1.internal"));
        assert!(!pattern_matches("app?.internal", "app12.internal"));
        assert!(!pattern_matches("bastion", "bastion2"));
        // 取反：命中负向模式时整块不生效
        let block = Block {
            patterns: vec!["*.corp".into(), "!skip.corp".into()],
            options: vec![],
            line: 1,
        };
        assert!(block_applies(&block, "app.corp"));
        assert!(!block_applies(&block, "skip.corp"));
        assert!(!block_applies(&block, "example.net"));
    }
}
