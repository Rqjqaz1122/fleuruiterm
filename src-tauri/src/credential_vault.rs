use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use argon2::Argon2;
use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::Zeroizing;

const VAULT_FILE_VERSION: u8 = 1;
const KEY_LENGTH: usize = 32;
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 12;
const MINIMUM_PASSPHRASE_LENGTH: usize = 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CredentialVaultStatus {
    Unconfigured,
    Locked,
    Unlocked,
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CredentialVaultError {
    #[error("VAULT_ALREADY_CONFIGURED")]
    AlreadyConfigured,
    #[error("VAULT_CORRUPTED")]
    Corrupted,
    #[error("VAULT_INVALID_PASSPHRASE")]
    InvalidPassphrase,
    #[error("VAULT_IO_ERROR: {0}")]
    Io(String),
    #[error("VAULT_LOCKED")]
    Locked,
    #[error("VAULT_NOT_CONFIGURED")]
    NotConfigured,
    #[error("VAULT_PASSPHRASE_TOO_SHORT")]
    PassphraseTooShort,
}

#[derive(Deserialize, Serialize)]
struct EncryptedVaultFile {
    version: u8,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Default, Deserialize, Serialize)]
struct CredentialVaultPayload {
    passwords: HashMap<String, String>,
}

pub struct CredentialVault {
    path: PathBuf,
    key: Option<Zeroizing<[u8; KEY_LENGTH]>>,
}

impl CredentialVault {
    pub fn new(path: PathBuf) -> Self {
        Self { path, key: None }
    }

    pub fn status(&self) -> CredentialVaultStatus {
        if !self.path.exists() {
            CredentialVaultStatus::Unconfigured
        } else if self.key.is_some() {
            CredentialVaultStatus::Unlocked
        } else {
            CredentialVaultStatus::Locked
        }
    }

    pub fn configure(&mut self, passphrase: &str) -> Result<(), CredentialVaultError> {
        if self.path.exists() {
            return Err(CredentialVaultError::AlreadyConfigured);
        }
        validate_passphrase(passphrase)?;

        let mut salt = [0_u8; SALT_LENGTH];
        OsRng.fill_bytes(&mut salt);
        let key = derive_key(passphrase, &salt)?;
        let encrypted_file = encrypt_payload(&CredentialVaultPayload::default(), &key, &salt)?;
        write_encrypted_file(&self.path, &encrypted_file)?;
        self.key = Some(key);
        Ok(())
    }

    pub fn unlock(&mut self, passphrase: &str) -> Result<(), CredentialVaultError> {
        let encrypted_file = read_encrypted_file(&self.path)?;
        let salt = decode_fixed::<SALT_LENGTH>(&encrypted_file.salt)?;
        let key = derive_key(passphrase, &salt)?;
        decrypt_payload(
            &encrypted_file,
            &key,
            CredentialVaultError::InvalidPassphrase,
        )?;
        self.key = Some(key);
        Ok(())
    }

    pub fn lock(&mut self) {
        self.key = None;
    }

    #[cfg(test)]
    pub fn load_password(
        &self,
        connection_id: &str,
    ) -> Result<Option<String>, CredentialVaultError> {
        let payload = self.read_unlocked_payload()?;
        Ok(payload.passwords.get(connection_id).cloned())
    }

    pub fn load_passwords(
        &self,
        connection_ids: &[String],
    ) -> Result<HashMap<String, String>, CredentialVaultError> {
        let payload = self.read_unlocked_payload()?;
        Ok(connection_ids
            .iter()
            .filter_map(|connection_id| {
                payload
                    .passwords
                    .get(connection_id)
                    .map(|password| (connection_id.clone(), password.clone()))
            })
            .collect())
    }

    pub fn save_password(
        &self,
        connection_id: &str,
        password: &str,
    ) -> Result<(), CredentialVaultError> {
        let mut payload = self.read_unlocked_payload()?;
        payload
            .passwords
            .insert(connection_id.to_string(), password.to_string());
        self.write_unlocked_payload(&payload)
    }

    pub fn delete_password(&self, connection_id: &str) -> Result<(), CredentialVaultError> {
        let mut payload = self.read_unlocked_payload()?;
        payload.passwords.remove(connection_id);
        self.write_unlocked_payload(&payload)
    }

    fn read_unlocked_payload(&self) -> Result<CredentialVaultPayload, CredentialVaultError> {
        let key = self.key.as_ref().ok_or_else(|| match self.status() {
            CredentialVaultStatus::Unconfigured => CredentialVaultError::NotConfigured,
            CredentialVaultStatus::Locked | CredentialVaultStatus::Unlocked => {
                CredentialVaultError::Locked
            }
        })?;
        let encrypted_file = read_encrypted_file(&self.path)?;
        decrypt_payload(&encrypted_file, key, CredentialVaultError::Corrupted)
    }

    fn write_unlocked_payload(
        &self,
        payload: &CredentialVaultPayload,
    ) -> Result<(), CredentialVaultError> {
        let key = self.key.as_ref().ok_or(CredentialVaultError::Locked)?;
        let current_file = read_encrypted_file(&self.path)?;
        let salt = decode_fixed::<SALT_LENGTH>(&current_file.salt)?;
        let encrypted_file = encrypt_payload(payload, key, &salt)?;
        write_encrypted_file(&self.path, &encrypted_file)
    }
}

fn validate_passphrase(passphrase: &str) -> Result<(), CredentialVaultError> {
    if passphrase.chars().count() < MINIMUM_PASSPHRASE_LENGTH {
        return Err(CredentialVaultError::PassphraseTooShort);
    }
    Ok(())
}

fn derive_key(
    passphrase: &str,
    salt: &[u8; SALT_LENGTH],
) -> Result<Zeroizing<[u8; KEY_LENGTH]>, CredentialVaultError> {
    let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
    Argon2::default()
        .hash_password_into(passphrase.as_bytes(), salt, key.as_mut())
        .map_err(|_| CredentialVaultError::Corrupted)?;
    Ok(key)
}

fn encrypt_payload(
    payload: &CredentialVaultPayload,
    key: &[u8; KEY_LENGTH],
    salt: &[u8; SALT_LENGTH],
) -> Result<EncryptedVaultFile, CredentialVaultError> {
    let plaintext =
        Zeroizing::new(serde_json::to_vec(payload).map_err(|_| CredentialVaultError::Corrupted)?);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CredentialVaultError::Corrupted)?;
    let mut nonce_bytes = [0_u8; NONCE_LENGTH];
    OsRng.fill_bytes(&mut nonce_bytes);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_slice())
        .map_err(|_| CredentialVaultError::Corrupted)?;
    Ok(EncryptedVaultFile {
        version: VAULT_FILE_VERSION,
        salt: STANDARD_NO_PAD.encode(salt),
        nonce: STANDARD_NO_PAD.encode(nonce_bytes),
        ciphertext: STANDARD_NO_PAD.encode(ciphertext),
    })
}

fn decrypt_payload(
    encrypted_file: &EncryptedVaultFile,
    key: &[u8; KEY_LENGTH],
    decryption_error: CredentialVaultError,
) -> Result<CredentialVaultPayload, CredentialVaultError> {
    if encrypted_file.version != VAULT_FILE_VERSION {
        return Err(CredentialVaultError::Corrupted);
    }
    let nonce_bytes = decode_fixed::<NONCE_LENGTH>(&encrypted_file.nonce)?;
    let ciphertext = STANDARD_NO_PAD
        .decode(&encrypted_file.ciphertext)
        .map_err(|_| CredentialVaultError::Corrupted)?;
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| CredentialVaultError::Corrupted)?;
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(Nonce::from_slice(&nonce_bytes), ciphertext.as_slice())
            .map_err(|_| decryption_error)?,
    );
    serde_json::from_slice(plaintext.as_slice()).map_err(|_| CredentialVaultError::Corrupted)
}

fn read_encrypted_file(path: &Path) -> Result<EncryptedVaultFile, CredentialVaultError> {
    if !path.exists() {
        return Err(CredentialVaultError::NotConfigured);
    }
    let content = fs::read_to_string(path).map_err(io_error)?;
    serde_json::from_str(&content).map_err(|_| CredentialVaultError::Corrupted)
}

fn write_encrypted_file(
    path: &Path,
    encrypted_file: &EncryptedVaultFile,
) -> Result<(), CredentialVaultError> {
    let parent = path.parent().ok_or(CredentialVaultError::Corrupted)?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let temporary_path = path.with_extension("vault.tmp");
    let content =
        serde_json::to_vec_pretty(encrypted_file).map_err(|_| CredentialVaultError::Corrupted)?;
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary_path).map_err(io_error)?;
    file.write_all(&content).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(io_error)?;
    }
    fs::rename(temporary_path, path).map_err(io_error)
}

fn decode_fixed<const LENGTH: usize>(value: &str) -> Result<[u8; LENGTH], CredentialVaultError> {
    STANDARD_NO_PAD
        .decode(value)
        .map_err(|_| CredentialVaultError::Corrupted)?
        .try_into()
        .map_err(|_| CredentialVaultError::Corrupted)
}

fn io_error(error: std::io::Error) -> CredentialVaultError {
    CredentialVaultError::Io(error.to_string())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{CredentialVault, CredentialVaultError, CredentialVaultStatus};

    const TEST_PASSPHRASE: &str = "correct horse battery staple";

    #[test]
    fn stores_passwords_only_in_encrypted_form() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let mut vault = CredentialVault::new(path.clone());

        assert_eq!(vault.status(), CredentialVaultStatus::Unconfigured);
        vault
            .configure(TEST_PASSPHRASE)
            .expect("vault configuration should succeed");
        vault
            .save_password("server-a", "ssh-password")
            .expect("password saving should succeed");

        let stored = fs::read_to_string(path).expect("vault file should be readable");
        assert!(!stored.contains("server-a"));
        assert!(!stored.contains("ssh-password"));
    }

    #[test]
    fn requires_unlock_after_the_in_memory_key_is_cleared() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let mut vault = CredentialVault::new(path);

        vault
            .configure(TEST_PASSPHRASE)
            .expect("vault configuration should succeed");
        vault
            .save_password("server-a", "ssh-password")
            .expect("password saving should succeed");
        vault.lock();

        assert_eq!(vault.status(), CredentialVaultStatus::Locked);
        assert_eq!(
            vault.load_password("server-a"),
            Err(CredentialVaultError::Locked)
        );

        vault
            .unlock(TEST_PASSPHRASE)
            .expect("correct passphrase should unlock the vault");
        assert_eq!(
            vault
                .load_password("server-a")
                .expect("password loading should succeed")
                .as_deref(),
            Some("ssh-password")
        );
    }

    #[test]
    fn rejects_an_incorrect_passphrase() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let mut vault = CredentialVault::new(path);

        vault
            .configure(TEST_PASSPHRASE)
            .expect("vault configuration should succeed");
        vault.lock();

        assert_eq!(
            vault.unlock("incorrect passphrase"),
            Err(CredentialVaultError::InvalidPassphrase)
        );
        assert_eq!(vault.status(), CredentialVaultStatus::Locked);
    }

    #[test]
    fn loads_requested_passwords_and_removes_deleted_entries() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let mut vault = CredentialVault::new(path);

        vault
            .configure(TEST_PASSPHRASE)
            .expect("vault configuration should succeed");
        vault
            .save_password("server-a", "password-a")
            .expect("first password should be saved");
        vault
            .save_password("server-b", "password-b")
            .expect("second password should be saved");

        let requested = vault
            .load_passwords(&["server-b".to_string(), "missing".to_string()])
            .expect("requested passwords should load");
        assert_eq!(requested.len(), 1);
        assert_eq!(
            requested.get("server-b").map(String::as_str),
            Some("password-b")
        );

        vault
            .delete_password("server-b")
            .expect("password deletion should succeed");
        assert!(
            vault
                .load_passwords(&["server-b".to_string()])
                .expect("remaining vault should load")
                .is_empty()
        );
    }
}
