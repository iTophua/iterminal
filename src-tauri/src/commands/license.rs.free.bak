//! License 模块 - 免费版（Free）实现
//!
//! 这是公开仓库中的 stub 实现。
//! - 默认且仅支持 Free 套餐
//! - 不含任何签名密钥、不含 HMAC 算法、不含 bypass 后门
//! - Pro/Enterprise 功能一律返回不可用
//!
//! 构建 Pro 版时，本文件会被 `iterminal-pro/scripts/build-pro.sh`
//! 用私有仓库的完整实现（含 HMAC-SHA256 校验）覆盖。
//!
//! ⚠️ 修改本文件时，必须同步修改 iterminal-pro/src-tauri/src/commands/license.rs，
//!    保持公开 API（命令名、函数签名、结构体字段）一致。

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

/// License 类型
///
/// 免费版 stub 中只会有 `Free`。
/// Pro 构建会扩展为 Free / Pro / Enterprise。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum LicenseType {
    /// 免费版
    Free,
    /// 专业版（stub 不可达，仅占位保证枚举与前端兼容）
    Pro,
    /// 企业版（stub 不可达）
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

/// 免费版的功能列表
///
/// 基础功能 + Docker 管理（2026-07 下沉到免费版）。
/// Pro/Enterprise 专属 feature（snippets、ai_assistant、port_forward、
/// cloud_sync、audit_log、team_collab）在免费版不可用。
fn free_features() -> Vec<String> {
    vec![
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
    ]
}

/// 免费版最大连接数
const FREE_MAX_CONNECTIONS: u32 = 3;

// ============ 全局状态 ============

static LICENSE_INFO: Lazy<RwLock<LicenseInfo>> = Lazy::new(|| {
    RwLock::new(LicenseInfo {
        license_type: LicenseType::Free,
        expires_at: None,
        features: free_features(),
        is_valid: true,
        max_connections: FREE_MAX_CONNECTIONS,
        email: None,
    })
});

/// 启动时初始化（免费版无需持久化，保留接口以与 Pro 实现对齐）
pub async fn init_from_storage() {
    // 免费版：无操作
}

/// 获取 License 信息
pub async fn get_license_info() -> LicenseInfo {
    LICENSE_INFO.read().await.clone()
}

/// 检查功能是否可用
///
/// 免费版仅允许 `free_features()` 中的功能。
/// Pro feature（snippets、ai_assistant 等）一律返回 false。
pub async fn check_feature(feature: &str) -> bool {
    let info = get_license_info().await;
    info.features.contains(&feature.to_string())
}

/// 获取最大连接数
pub async fn get_max_connections() -> u32 {
    get_license_info().await.max_connections
}

// ============ Tauri 命令 ============

/// 验证 License Key
///
/// 免费版 stub：任何 Key 都校验失败，返回错误。
/// 真正的校验逻辑在 Pro 构建的注入实现中。
#[tauri::command]
pub async fn verify_license(_key: String) -> Result<LicenseInfo, String> {
    Err("当前为免费版构建，不支持 License 激活。请使用专业版安装包。".into())
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

/// 清除 License（免费版无操作，保留接口对齐）
#[tauri::command]
pub async fn clear_license() {
    // 免费版无持久化状态可清
}

// ============ 测试 ============

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_free_features_no_pro() {
        assert!(check_feature("basic_ssh").await);
        assert!(check_feature("themes").await);
        // Pro 功能不可用
        assert!(!check_feature("snippets").await);
        assert!(!check_feature("ai_assistant").await);
        assert!(!check_feature("port_forward").await);
        assert!(!check_feature("cloud_sync").await);
    }

    #[tokio::test]
    async fn test_max_connections_is_three() {
        assert_eq!(get_max_connections().await, FREE_MAX_CONNECTIONS);
    }

    #[tokio::test]
    async fn test_verify_license_always_fails() {
        let result = verify_license("IT-1-PRO-anything-anything".into()).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_default_is_free() {
        let info = get_license_info().await;
        assert_eq!(info.license_type, LicenseType::Free);
        assert_eq!(info.max_connections, 3);
    }
}
