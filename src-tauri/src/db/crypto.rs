use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;

const ENCRYPTION_KEY: &[u8; 32] = b"iterminal_secret_key_32bytes!!";

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

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .ok()?;

    String::from_utf8(plaintext).ok()
}