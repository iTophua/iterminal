//! iTerminal Pro License 验证模块（私有，不公开）
//!
//! 三级套餐：Free / Pro / Enterprise
//! 签名算法：HMAC-SHA256
//! 持久化：~/.iterminal/license.dat

use hmac::{Hmac, Mac};
use once_cell::sync::Lazy;
use rand::Rng;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::sync::RwLock;

type HmacSha256 = Hmac<Sha256>;

/// ⚠️ License 签名密钥。请勿泄露、勿提交到公开仓库。
///
/// 2026-07-07 轮换：旧密钥 `ITERMINAL_PRO_SECRET_KEY_2026_CHANGE_THIS`
/// 已随公开仓库泄露，全部作废。
///
/// 生成方式：`openssl rand -hex 32`
/// 当前值：fcd2e469afe0d468c7fed44d7b28858abde99f42a07bd6b9c8ed8ba1f4854e01
const SECRET_KEY: [u8; 32] = [
    0xfc, 0xd2, 0xe4, 0x69, 0xaf, 0xe0, 0xd4, 0x68, 0xc7, 0xfe, 0xd4, 0x4d, 0x7b, 0x28, 0x85, 0x8a,
    0xbd, 0xe9, 0x9f, 0x42, 0xa0, 0x7b, 0xd6, 0xb9, 0xc8, 0xed, 0x8b, 0xa1, 0xf4, 0x85, 0x4e, 0x01,
];

/// License Key 版本
const KEY_VERSION: &str = "1";

/// License 类型
///
/// 2026-07-07 简化：原 `Personal` 套餐合并到 `Pro`，原 `Professional` 更名为 `Pro`。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum LicenseType {
    /// 免费版：基础 SSH/SFTP/监控，最多 3 连接
    Free,
    /// 专业版：无限连接 + AI 助手 + 命令片段库 + 端口转发 + 云同步
    Pro,
    /// 企业版：全部功能 + Docker 管理 + 审计日志 + 团队协作
    Enterprise,
}

impl Default for LicenseType {
    fn default() -> Self {
        Self::Free
    }
}

impl std::fmt::Display for LicenseType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LicenseType::Free => write!(f, "免费版"),
            LicenseType::Pro => write!(f, "专业版"),
            LicenseType::Enterprise => write!(f, "企业版"),
        }
    }
}

impl LicenseType {
    /// License Key 中的类型字符串
    fn as_key_str(&self) -> &'static str {
        match self {
            LicenseType::Free => "FREE",
            LicenseType::Pro => "PRO",
            LicenseType::Enterprise => "ENTERPRISE",
        }
    }

    fn from_key_str(s: &str) -> Option<Self> {
        match s {
            "FREE" => Some(LicenseType::Free),
            "PRO" => Some(LicenseType::Pro),
            "ENTERPRISE" => Some(LicenseType::Enterprise),
            _ => None,
        }
    }
}

/// License 信息（序列化给前端）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub license_type: LicenseType,
    pub expires_at: Option<String>,
    pub features: Vec<String>,
    pub is_valid: bool,
    pub max_connections: u32,
    pub email: Option<String>,
}

impl LicenseInfo {
    /// Free 版默认信息
    fn free_default() -> Self {
        Self {
            license_type: LicenseType::Free,
            expires_at: None,
            features: Self::features_for(LicenseType::Free),
            is_valid: true,
            max_connections: Self::max_connections_for(LicenseType::Free),
            email: None,
        }
    }

    /// 各套餐的功能列表
    fn features_for(license_type: LicenseType) -> Vec<String> {
        match license_type {
            LicenseType::Free => vec![
                "basic_ssh".into(),
                "basic_sftp".into(),
                "basic_monitor".into(),
                "terminal_links".into(),
                "folder_download".into(),
                "file_copy_move".into(),
                "broadcast_input".into(),
                "proxy_jump".into(),
                "themes".into(),
                "docker_mgmt".into(),
            ],
            LicenseType::Pro => vec![
                // Free 全部
                "basic_ssh".into(),
                "basic_sftp".into(),
                "basic_monitor".into(),
                "terminal_links".into(),
                "folder_download".into(),
                "file_copy_move".into(),
                "broadcast_input".into(),
                "proxy_jump".into(),
                "themes".into(),
                "docker_mgmt".into(),
                // Pro 专属
                "unlimited_connections".into(),
                "snippets".into(),
                "ai_assistant".into(),
                "port_forward".into(),
                "cloud_sync".into(),
            ],
            // Enterprise 走通配，未来加新功能自动包含
            LicenseType::Enterprise => vec!["*".into()],
        }
    }

    fn max_connections_for(license_type: LicenseType) -> u32 {
        match license_type {
            LicenseType::Free => 3,
            LicenseType::Pro | LicenseType::Enterprise => 999,
        }
    }
}

// ============ 全局状态 ============

static LICENSE_INFO: Lazy<RwLock<LicenseInfo>> =
    Lazy::new(|| RwLock::new(LicenseInfo::free_default()));

/// 启动时从持久化文件加载（失败回退 Free）
pub async fn init_from_storage() {
    if let Some(info) = load_persisted_license().await {
        let mut guard = LICENSE_INFO.write().await;
        *guard = info;
    }
}

/// 获取 License 信息
pub async fn get_license_info() -> LicenseInfo {
    LICENSE_INFO.read().await.clone()
}

/// 检查功能是否可用
pub async fn check_feature(feature: &str) -> bool {
    let info = get_license_info().await;
    info.features.contains(&feature.to_string()) || info.features.contains(&"*".to_string())
}

/// 获取最大连接数
pub async fn get_max_connections() -> u32 {
    get_license_info().await.max_connections
}

// ============ License Key 签名与校验 ============

/// 计算签名：HMAC-SHA256(version || type_str || random)，取前 8 字节 hex 大写
fn compute_signature(version: &str, type_str: &str, random: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(&SECRET_KEY).expect("HMAC key 长度错误");
    mac.update(version.as_bytes());
    mac.update(type_str.as_bytes());
    mac.update(random.as_bytes());
    let bytes = mac.finalize().into_bytes();
    // 取前 8 字节（16 hex 字符），足够防暴力且 Key 简洁
    hex::encode(&bytes[..8]).to_uppercase()
}

/// 生成 License Key（仅供 generate-license 工具调用）
pub fn generate_license_key(license_type: LicenseType, email: Option<&str>) -> String {
    let type_str = license_type.as_key_str();
    let random: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(12)
        .map(char::from)
        .collect();
    let signature = compute_signature(KEY_VERSION, type_str, &random);
    let key = format!(
        "IT-{}-{}-{}-{}",
        KEY_VERSION, type_str, random, signature
    );
    if let Some(e) = email {
        println!("License Key for {}: {}", e, key);
    }
    key
}

/// 校验 License Key 格式与签名
fn validate_license_key(key: &str) -> Result<LicenseType, String> {
    if !key.starts_with("IT-") {
        return Err("无效的 License 格式：必须以 IT- 开头".into());
    }
    let parts: Vec<&str> = key.split('-').collect();
    if parts.len() != 5 {
        return Err(
            "无效的 License 格式：应为 IT-{version}-{type}-{random}-{signature}".into(),
        );
    }
    let version = parts[1];
    let type_str = parts[2];
    let random = parts[3];
    let signature = parts[4];

    let license_type = LicenseType::from_key_str(type_str)
        .ok_or_else(|| format!("未知的 License 类型: {}", type_str))?;

    let expected = compute_signature(version, type_str, random);
    if signature != expected {
        return Err("License 校验失败：签名不匹配".into());
    }
    Ok(license_type)
}

// ============ 持久化 ============

/// 持久化文件路径：~/.iterminal/license.dat
///
/// 文件内容为纯文本：第一行 License Key，第二行 email（可选）。
/// 安全性由 HMAC 签名保证——篡改文件内容会导致签名校验失败。
fn persistence_path() -> Option<std::path::PathBuf> {
    dirs::home_dir().map(|h| h.join(".iterminal").join("license.dat"))
}

async fn load_persisted_license() -> Option<LicenseInfo> {
    let path = persistence_path()?;
    let content = tokio::fs::read_to_string(&path).await.ok()?;
    let mut iter = content.lines();
    let key = iter.next()?.trim();
    let email = iter
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let license_type = validate_license_key(key).ok()?;
    Some(LicenseInfo {
        license_type,
        expires_at: Some("2099-12-31".into()),
        features: LicenseInfo::features_for(license_type),
        is_valid: true,
        max_connections: LicenseInfo::max_connections_for(license_type),
        email,
    })
}

async fn persist_license(key: &str, email: Option<&str>) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(path) = persistence_path() {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let mut content = key.to_string();
        if let Some(e) = email {
            content.push('\n');
            content.push_str(e);
        }
        let mut file = std::fs::File::create(&path)?;
        file.write_all(content.as_bytes())?;
    }
    Ok(())
}

async fn clear_persisted_license() {
    if let Some(path) = persistence_path() {
        let _ = tokio::fs::remove_file(&path).await;
    }
}

// ============ Tauri 命令 ============

/// 验证并激活 License Key
#[tauri::command]
pub async fn verify_license(key: String) -> Result<LicenseInfo, String> {
    let license_type = validate_license_key(&key)?;

    let info = LicenseInfo {
        license_type,
        expires_at: Some("2099-12-31".into()),
        features: LicenseInfo::features_for(license_type),
        is_valid: true,
        max_connections: LicenseInfo::max_connections_for(license_type),
        email: None,
    };

    {
        let mut guard = LICENSE_INFO.write().await;
        *guard = info.clone();
    }

    if let Err(e) = persist_license(&key, None).await {
        eprintln!("License 持久化失败（不影响本次使用）: {}", e);
    }

    Ok(info)
}

/// 获取当前 License 信息
#[tauri::command]
pub async fn get_license() -> LicenseInfo {
    get_license_info().await
}

/// 检查功能是否可用
#[tauri::command]
pub async fn is_feature_available(feature: String) -> bool {
    check_feature(&feature).await
}

/// 检查连接数是否超限
#[tauri::command]
pub async fn check_connection_limit(current_count: u32) -> Result<bool, String> {
    let max = get_max_connections().await;
    if current_count >= max {
        Err(format!(
            "免费版最多支持 {} 个连接，请升级专业版解锁无限连接",
            max
        ))
    } else {
        Ok(true)
    }
}

/// 清除 License（注销 / 回退 Free）
#[tauri::command]
pub async fn clear_license() {
    clear_persisted_license().await;
    let mut guard = LICENSE_INFO.write().await;
    *guard = LicenseInfo::free_default();
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_validate_pro() {
        let key = generate_license_key(LicenseType::Pro, None);
        assert!(key.starts_with("IT-1-PRO-"));
        let t = validate_license_key(&key).unwrap();
        assert_eq!(t, LicenseType::Pro);
    }

    #[test]
    fn test_generate_and_validate_enterprise() {
        let key = generate_license_key(LicenseType::Enterprise, None);
        let t = validate_license_key(&key).unwrap();
        assert_eq!(t, LicenseType::Enterprise);
    }

    #[test]
    fn test_generate_and_validate_free() {
        let key = generate_license_key(LicenseType::Free, None);
        let t = validate_license_key(&key).unwrap();
        assert_eq!(t, LicenseType::Free);
    }

    #[test]
    fn test_invalid_signature() {
        // 正确格式但签名错误
        let fake = "IT-1-PRO-AAAAAAAAAAAA-0000000000000000";
        assert!(validate_license_key(fake).is_err());
    }

    #[test]
    fn test_invalid_format() {
        assert!(validate_license_key("INVALID").is_err());
        assert!(validate_license_key("IT-1-PRO-short").is_err());
    }

    #[test]
    fn test_tampered_type() {
        // 用 Pro 的签名但改成 Enterprise（应失败：签名不匹配）
        let key = generate_license_key(LicenseType::Pro, None);
        let parts: Vec<&str> = key.split('-').collect();
        let tampered = format!("IT-{}-ENTERPRISE-{}-{}", parts[1], parts[3], parts[4]);
        assert!(validate_license_key(&tampered).is_err());
    }

    #[test]
    fn test_features_progression() {
        let free = LicenseInfo::features_for(LicenseType::Free);
        let pro = LicenseInfo::features_for(LicenseType::Pro);
        let ent = LicenseInfo::features_for(LicenseType::Enterprise);

        // Free 没有 snippets/ai_assistant
        assert!(!free.contains(&"snippets".to_string()));
        assert!(!free.contains(&"ai_assistant".to_string()));
        // Pro 有
        assert!(pro.contains(&"snippets".to_string()));
        assert!(pro.contains(&"ai_assistant".to_string()));
        // Enterprise 是通配
        assert_eq!(ent, vec!["*".to_string()]);
    }

    #[test]
    fn test_max_connections() {
        assert_eq!(LicenseInfo::max_connections_for(LicenseType::Free), 3);
        assert_eq!(LicenseInfo::max_connections_for(LicenseType::Pro), 999);
        assert_eq!(
            LicenseInfo::max_connections_for(LicenseType::Enterprise),
            999
        );
    }
}
