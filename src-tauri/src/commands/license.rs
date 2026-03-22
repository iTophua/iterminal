use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;

/// License 类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LicenseType {
    Free,
    Personal,
    Professional,
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
            LicenseType::Personal => write!(f, "个人版"),
            LicenseType::Professional => write!(f, "专业版"),
            LicenseType::Enterprise => write!(f, "企业版"),
        }
    }
}

/// License 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseInfo {
    pub license_type: LicenseType,
    pub expires_at: Option<String>,
    pub features: Vec<String>,
    pub is_valid: bool,
    pub max_connections: u32,
    pub email: Option<String>,
}

impl Default for LicenseInfo {
    fn default() -> Self {
        Self {
            license_type: LicenseType::Free,
            expires_at: None,
            features: vec![
                "basic_ssh".to_string(),
                "basic_sftp".to_string(),
                "basic_monitor".to_string(),
            ],
            is_valid: true,
            max_connections: 3,
            email: None,
        }
    }
}

/// 全局 License 状态
static LICENSE_ACTIVE: AtomicBool = AtomicBool::new(false);
static LICENSE_BYPASS: AtomicBool = AtomicBool::new(false);
static LICENSE_INFO: Lazy<RwLock<Option<LicenseInfo>>> = Lazy::new(|| RwLock::new(None));

/// 获取 License 信息
pub async fn get_license_info() -> LicenseInfo {
    let guard = LICENSE_INFO.read().await;
    guard.clone().unwrap_or_default()
}

/// 检查功能是否可用
pub async fn check_feature(feature: &str) -> bool {
    if LICENSE_BYPASS.load(Ordering::SeqCst) {
        return true;
    }
    let info = get_license_info().await;
    info.features.contains(&feature.to_string()) || info.features.contains(&"*".to_string())
}

/// 获取最大连接数
pub async fn get_max_connections() -> u32 {
    if LICENSE_BYPASS.load(Ordering::SeqCst) {
        return 999;
    }
    let info = get_license_info().await;
    info.max_connections
}

fn get_features(license_type: &LicenseType) -> Vec<String> {
    match license_type {
        LicenseType::Free => vec![
            "basic_ssh".to_string(),
            "basic_sftp".to_string(),
            "basic_monitor".to_string(),
        ],
        LicenseType::Personal => vec![
            "basic_ssh".to_string(),
            "basic_sftp".to_string(),
            "basic_monitor".to_string(),
            "ai_assistant".to_string(),
            "snippets".to_string(),
            "themes".to_string(),
            "unlimited_connections".to_string(),
        ],
        LicenseType::Professional => vec![
            "basic_ssh".to_string(),
            "basic_sftp".to_string(),
            "basic_monitor".to_string(),
            "ai_assistant".to_string(),
            "snippets".to_string(),
            "themes".to_string(),
            "unlimited_connections".to_string(),
            "team_collab".to_string(),
            "audit_log".to_string(),
        ],
        LicenseType::Enterprise => vec!["*".to_string()],
    }
}

/// 获取最大连接数（根据 License 类型）
fn get_max_connections_for_type(license_type: &LicenseType) -> u32 {
    match license_type {
        LicenseType::Free => 3,
        LicenseType::Personal => 999,
        LicenseType::Professional => 999,
        LicenseType::Enterprise => 999,
    }
}

/// 计算校验和（简单实现）
fn calculate_checksum(parts: &[&str]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    for part in parts {
        part.hash(&mut hasher);
    }
    format!("{:X}", hasher.finish())
}

/// 验证 License Key 格式
/// 格式: IT-{version}-{type}-{random}-{checksum}
/// 示例: IT-1-PERSONAL-ABC123XYZ-XX
fn validate_license_format(key: &str) -> Result<(String, LicenseType, String), String> {
    if !key.starts_with("IT-") {
        return Err("无效的 License 格式：必须以 IT- 开头".into());
    }

    let parts: Vec<&str> = key.split('-').collect();
    if parts.len() != 5 {
        return Err("无效的 License 格式：格式应为 IT-{version}-{type}-{random}-{checksum}".into());
    }

    let version = parts[1].to_string();
    let license_type = match parts[2] {
        "FREE" => LicenseType::Free,
        "PERSONAL" => LicenseType::Personal,
        "PRO" => LicenseType::Professional,
        "ENTERPRISE" => LicenseType::Enterprise,
        _ => return Err(format!("未知的 License 类型: {}", parts[2])),
    };
    let random = parts[3].to_string();
    let checksum = parts[4].to_string();

    // 验证校验和
    let expected_checksum = calculate_checksum(&[&version, parts[2], &random]);
    if checksum != expected_checksum {
        return Err("License 校验和验证失败".into());
    }

    Ok((version, license_type, random))
}

/// 生成 License Key（用于测试）
#[allow(dead_code)]
fn generate_license_key(license_type: &LicenseType) -> String {
    use rand::Rng;
    
    let version = "1";
    let type_str = match license_type {
        LicenseType::Free => "FREE",
        LicenseType::Personal => "PERSONAL",
        LicenseType::Professional => "PRO",
        LicenseType::Enterprise => "ENTERPRISE",
    };
    
    let random: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(10)
        .map(char::from)
        .collect();
    
    let checksum = calculate_checksum(&[version, type_str, &random]);
    
    format!("IT-{}-{}-{}-{}", version, type_str, random, checksum)
}

/// 验证 License Key（Tauri 命令）
#[tauri::command]
pub async fn verify_license(key: String) -> Result<LicenseInfo, String> {
    // 1. 验证格式
    let (_version, license_type, _random) = validate_license_format(&key)?;

    // 2. TODO: 在线验证（可选，后续实现）
    // if let Ok(response) = verify_online(&key).await {
    //     if !response.valid {
    //         return Err("License 已失效或被吊销".into());
    //     }
    // }

    // 3. 构建 License 信息
    let info = LicenseInfo {
        license_type: license_type.clone(),
        expires_at: Some("2026-12-31".into()), // TODO: 从服务器获取
        features: get_features(&license_type),
        is_valid: true,
        max_connections: get_max_connections_for_type(&license_type),
        email: None,
    };

    // 4. 更新全局状态
    LICENSE_ACTIVE.store(true, Ordering::SeqCst);
    let mut guard = LICENSE_INFO.write().await;
    *guard = Some(info.clone());

    Ok(info)
}

/// 获取当前 License 信息（Tauri 命令）
#[tauri::command]
pub async fn get_license() -> LicenseInfo {
    get_license_info().await
}

/// 检查功能是否可用（Tauri 命令）
#[tauri::command]
pub async fn is_feature_available(feature: String) -> bool {
    check_feature(&feature).await
}

/// 检查连接数是否超限（Tauri 命令）
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

/// 清除 License（用于测试/注销）
#[tauri::command]
pub async fn clear_license() {
    LICENSE_ACTIVE.store(false, Ordering::SeqCst);
    let mut guard = LICENSE_INFO.write().await;
    *guard = None;
}

/// 设置 License 限制跳过（开发/测试用）
#[cfg(debug_assertions)]
#[tauri::command]
pub fn set_license_bypass(bypass: bool) {
    LICENSE_BYPASS.store(bypass, Ordering::SeqCst);
}

#[cfg(not(debug_assertions))]
#[tauri::command]
pub fn set_license_bypass(_bypass: bool) {
    eprintln!("set_license_bypass is only available in debug builds");
}

/// 获取 License 限制跳过状态
#[tauri::command]
pub fn is_license_bypassed() -> bool {
    LICENSE_BYPASS.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_validate_license() {
        let key = generate_license_key(&LicenseType::Personal);
        let result = validate_license_format(&key);
        assert!(result.is_ok());
        let (_, license_type, _) = result.unwrap();
        assert_eq!(license_type, LicenseType::Personal);
    }

    #[test]
    fn test_invalid_license_format() {
        let result = validate_license_format("INVALID-KEY");
        assert!(result.is_err());
    }

    #[test]
    fn test_features() {
        let free_features = get_features(&LicenseType::Free);
        assert!(free_features.contains(&"basic_ssh".to_string()));
        assert!(!free_features.contains(&"ai_assistant".to_string()));

        let pro_features = get_features(&LicenseType::Professional);
        assert!(pro_features.contains(&"ai_assistant".to_string()));
        assert!(pro_features.contains(&"team_collab".to_string()));
    }
}