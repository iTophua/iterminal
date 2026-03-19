use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;

const ENCRYPTION_KEY: &[u8; 32] = b"iterminal_32byte_encryption_key!";

pub fn encrypt_password(password: &str) -> String {
    let cipher = Aes256Gcm::new(ENCRYPTION_KEY.into());
    let mut rng = rand::thread_rng();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, password.as_bytes())
        .expect("encryption failed");

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
    let cipher = Aes256Gcm::new(ENCRYPTION_KEY.into());
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher.decrypt(nonce, ciphertext).ok()?;

    String::from_utf8(plaintext).ok()
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
}
