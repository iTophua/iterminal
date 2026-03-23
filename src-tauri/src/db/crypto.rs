use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;
use std::collections::hash_map::DefaultHasher;
use std::env;
use std::hash::{Hash, Hasher};

fn get_stable_machine_id() -> String {
    let mut components = Vec::new();

    // 1. Hostname - 通常不会改变
    if let Ok(hostname) =
        env::var("HOSTNAME").or_else(|_| hostname::get().map(|h| h.to_string_lossy().to_string()))
    {
        components.push(hostname);
    }

    // 2. 用户名 - macOS/Linux 通常是稳定的
    if let Ok(user) = env::var("USER").or_else(|_| env::var("USERNAME")) {
        components.push(user);
    }

    // 3. HOME 路径 - 用户目录位置
    if let Ok(home) = env::var("HOME") {
        components.push(home);
    } else if let Some(home_dir) = dirs::home_dir() {
        components.push(home_dir.to_string_lossy().to_string());
    }

    // 4. 平台特定的机器标识
    #[cfg(target_os = "macos")]
    {
        // macOS: 使用硬件 UUID (IOPlatformUUID)
        if let Ok(output) = std::process::Command::new("ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("IOPlatformUUID") {
                    if let Some(uuid) = line.split('"').nth(3) {
                        components.push(uuid.to_string());
                        break;
                    }
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        // Windows: 使用机器 GUID
        if let Ok(output) = std::process::Command::new("reg")
            .args([
                "query",
                "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography",
                "/v",
                "MachineGuid",
            ])
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                if line.contains("MachineGuid") {
                    if let Some(guid) = line.split_whitespace().last() {
                        components.push(guid.to_string());
                        break;
                    }
                }
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 使用 /etc/machine-id
        if let Ok(machine_id) = std::fs::read_to_string("/etc/machine-id") {
            components.push(machine_id.trim().to_string());
        } else if let Ok(machine_id) = std::fs::read_to_string("/var/lib/dbus/machine-id") {
            components.push(machine_id.trim().to_string());
        }
    }

    // 5. 开发模式标识 - 确保开发和生产使用不同的密钥
    #[cfg(debug_assertions)]
    components.push("dev-mode".to_string());

    components.join("|")
}

fn derive_encryption_key() -> [u8; 32] {
    let machine_id = get_stable_machine_id();

    // 使用多轮哈希增加强度
    let mut hasher = DefaultHasher::new();
    machine_id.hash(&mut hasher);
    let hash1 = hasher.finish();

    let mut hasher2 = DefaultHasher::new();
    format!("{}-iterminal-v2", hash1).hash(&mut hasher2);
    let hash2 = hasher2.finish();

    let mut hasher3 = DefaultHasher::new();
    format!("{}-salt-{}", hash2, machine_id.len()).hash(&mut hasher3);
    let hash3 = hasher3.finish();

    let mut hasher4 = DefaultHasher::new();
    format!("{}-final", hash3).hash(&mut hasher4);
    let hash4 = hasher4.finish();

    let mut key = [0u8; 32];
    key[0..8].copy_from_slice(&hash1.to_le_bytes());
    key[8..16].copy_from_slice(&hash2.to_be_bytes());
    key[16..24].copy_from_slice(&hash3.to_le_bytes());
    key[24..32].copy_from_slice(&hash4.to_be_bytes());

    key
}

static ENCRYPTION_KEY: once_cell::sync::Lazy<[u8; 32]> =
    once_cell::sync::Lazy::new(derive_encryption_key);

// 老版本密钥派生（用于迁移旧数据）
fn derive_legacy_encryption_key() -> [u8; 32] {
    let mut hasher = DefaultHasher::new();

    if let Ok(home) = env::var("HOME") {
        home.hash(&mut hasher);
    }

    if let Ok(user) = env::var("USER") {
        user.hash(&mut hasher);
    }

    if let Ok(path) = env::var("PATH") {
        path.hash(&mut hasher);
    }

    let hash1 = hasher.finish();

    let mut hasher2 = DefaultHasher::new();
    format!("{}-{}", hash1, "iterminal-salt").hash(&mut hasher2);
    let hash2 = hasher2.finish();

    let mut key = [0u8; 32];
    key[0..8].copy_from_slice(&hash1.to_le_bytes());
    key[8..16].copy_from_slice(&hash2.to_le_bytes());
    key[16..24].copy_from_slice(&hash1.to_be_bytes());
    key[24..32].copy_from_slice(&hash2.to_be_bytes());

    key
}

static LEGACY_ENCRYPTION_KEY: once_cell::sync::Lazy<[u8; 32]> =
    once_cell::sync::Lazy::new(derive_legacy_encryption_key);

pub fn encrypt_password(password: &str) -> String {
    let cipher = Aes256Gcm::new_from_slice(&*ENCRYPTION_KEY).expect("Invalid key size");
    let mut rng = rand::thread_rng();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .expect("Encryption failed");

    let mut combined = nonce_bytes.to_vec();
    combined.extend(ciphertext);

    BASE64.encode(combined)
}

pub fn decrypt_password(encrypted: &str) -> Option<String> {
    let combined = BASE64.decode(encrypted).ok()?;
    if combined.len() < 12 {
        return None;
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(&*ENCRYPTION_KEY).ok()?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;

    String::from_utf8(plaintext).ok()
}

fn decrypt_with_legacy_key(encrypted: &str) -> Option<String> {
    let combined = BASE64.decode(encrypted).ok()?;
    if combined.len() < 12 {
        return None;
    }

    let (nonce_bytes, ciphertext) = combined.split_at(12);
    let cipher = Aes256Gcm::new_from_slice(&*LEGACY_ENCRYPTION_KEY).ok()?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;

    String::from_utf8(plaintext).ok()
}

/// 迁移用老密钥加密的密码到新密钥
/// 返回 (是否需要迁移, 迁移后的新密文)
/// 如果返回 (false, None)，说明密码为空或无需迁移
/// 如果返回 (true, new_encrypted)，说明迁移成功
/// 如果返回 (false, Some(_))，说明用新密钥能解密，无需迁移
pub fn migrate_encrypted_password(encrypted: Option<&str>) -> (bool, Option<String>) {
    let encrypted = match encrypted {
        Some(e) if !e.is_empty() => e,
        _ => return (false, None), // 空密码，无需迁移
    };

    // 先尝试用新密钥解密
    if decrypt_password(encrypted).is_some() {
        return (false, Some(encrypted.to_string())); // 已经是新格式，无需迁移
    }

    // 尝试用老密钥解密
    if let Some(password) = decrypt_with_legacy_key(encrypted) {
        // 用新密钥重新加密
        let new_encrypted = encrypt_password(&password);
        return (true, Some(new_encrypted));
    }

    // 两个密钥都解密不了，可能是损坏的数据
    (false, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let password = "my_secret_password_123";
        let encrypted = encrypt_password(password);

        assert_ne!(encrypted, password);
        assert!(encrypted.len() > password.len());

        let decrypted = decrypt_password(&encrypted);
        assert_eq!(decrypted, Some(password.to_string()));
    }

    #[test]
    fn test_encrypt_produces_different_ciphertext() {
        let password = "same_password";
        let encrypted1 = encrypt_password(password);
        let encrypted2 = encrypt_password(password);

        assert_ne!(encrypted1, encrypted2);

        assert_eq!(decrypt_password(&encrypted1), Some(password.to_string()));
        assert_eq!(decrypt_password(&encrypted2), Some(password.to_string()));
    }

    #[test]
    fn test_decrypt_invalid_base64() {
        let result = decrypt_password("not_valid_base64!!!");
        assert_eq!(result, None);
    }

    #[test]
    fn test_decrypt_too_short() {
        let short_encrypted = BASE64.encode(vec![1, 2, 3]);
        let result = decrypt_password(&short_encrypted);
        assert_eq!(result, None);
    }

    #[test]
    fn test_decrypt_wrong_key() {
        let encrypted = encrypt_password("password");

        let wrong_key: &[u8; 32] = b"12345678901234567890123456789012";
        let cipher = Aes256Gcm::new(wrong_key.into());

        let combined = BASE64.decode(&encrypted).unwrap();
        let (nonce_bytes, ciphertext) = combined.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        let result = cipher.decrypt(nonce, ciphertext);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_password() {
        let encrypted = encrypt_password("");
        let decrypted = decrypt_password(&encrypted);
        assert_eq!(decrypted, Some(String::new()));
    }

    #[test]
    fn test_unicode_password() {
        let password = "密码测试🔐🔥";
        let encrypted = encrypt_password(password);
        let decrypted = decrypt_password(&encrypted);
        assert_eq!(decrypted, Some(password.to_string()));
    }

    #[test]
    fn test_machine_id_stability() {
        let id1 = get_stable_machine_id();
        let id2 = get_stable_machine_id();
        assert_eq!(id1, id2, "Machine ID should be consistent within a session");
    }
}
