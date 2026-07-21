use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

#[cfg(target_os = "macos")]
use std::process::Command;

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{Engine, engine::general_purpose::STANDARD_NO_PAD};
use rand::{RngCore, rngs::OsRng};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use zeroize::{Zeroize, Zeroizing};

const VAULT_FILE_VERSION: u8 = 2;
const LEGACY_VAULT_FILE_VERSION: u8 = 1;
const INSTALLATION_KEY_FILE_VERSION: u8 = 1;
const KEY_LENGTH: usize = 32;
const INSTALLATION_SECRET_LENGTH: usize = 32;
const SALT_LENGTH: usize = 16;
const NONCE_LENGTH: usize = 12;
const ARGON2_MEMORY_COST_KIB: u32 = 19_456;
const ARGON2_ITERATIONS: u32 = 2;
const ARGON2_PARALLELISM: u32 = 1;
const KDF_IDENTIFIER: &str = "argon2id-v19-m19456-t2-p1";
const LEGACY_BACKUP_SUFFIX: &str = ".master-password.bak";
const INACCESSIBLE_BACKUP_SUFFIX: &str = ".inaccessible.bak";
const TEMPORARY_FILE_SUFFIX: &str = ".tmp";

#[derive(Debug, Error, Eq, PartialEq)]
pub enum CredentialVaultError {
    #[error("VAULT_CORRUPTED")]
    Corrupted,
    #[error("VAULT_DEVICE_IDENTIFIER_UNAVAILABLE")]
    DeviceIdentifierUnavailable,
    #[error("VAULT_DEVICE_MISMATCH")]
    DeviceMismatch,
    #[error("VAULT_INSTALLATION_KEY_MISSING")]
    InstallationKeyMissing,
    #[error("VAULT_IO_ERROR: {0}")]
    Io(String),
    #[error("VAULT_UNSUPPORTED_VERSION")]
    UnsupportedVersion,
}

#[derive(Deserialize, Serialize)]
struct EncryptedVaultFile {
    version: u8,
    #[serde(default)]
    kdf: String,
    salt: String,
    nonce: String,
    ciphertext: String,
}

#[derive(Deserialize)]
struct InstallationKeyFile {
    version: u8,
    secret: String,
}

#[derive(Serialize)]
struct InstallationKeyFileRef<'a> {
    version: u8,
    secret: &'a str,
}

#[derive(Default, Deserialize, Serialize)]
struct CredentialVaultPayload {
    passwords: HashMap<String, String>,
}

impl Drop for CredentialVaultPayload {
    fn drop(&mut self) {
        self.passwords.values_mut().for_each(Zeroize::zeroize);
    }
}

pub struct CredentialVault {
    path: PathBuf,
    installation_key_path: PathBuf,
    device_identifier: String,
    key: Option<Zeroizing<[u8; KEY_LENGTH]>>,
}

impl CredentialVault {
    pub fn new(path: PathBuf, installation_key_path: PathBuf, device_identifier: String) -> Self {
        Self {
            path,
            installation_key_path,
            device_identifier,
            key: None,
        }
    }

    pub fn lock(&mut self) {
        self.key = None;
    }

    #[cfg(test)]
    pub fn load_password(
        &mut self,
        connection_id: &str,
    ) -> Result<Option<String>, CredentialVaultError> {
        let payload = self.read_payload()?;
        Ok(payload.passwords.get(connection_id).cloned())
    }

    pub fn load_passwords(
        &mut self,
        connection_ids: &[String],
    ) -> Result<HashMap<String, String>, CredentialVaultError> {
        let payload = self.read_payload()?;
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
        &mut self,
        connection_id: &str,
        password: &str,
    ) -> Result<(), CredentialVaultError> {
        let mut payload = match self.read_payload() {
            Ok(payload) => payload,
            Err(error) if is_recoverable_vault_error(&error) => {
                self.back_up_inaccessible_vault()?;
                self.read_payload()?
            }
            Err(error) => return Err(error),
        };
        payload
            .passwords
            .insert(connection_id.to_string(), password.to_string());
        self.write_payload(&payload)
    }

    pub fn delete_password(&mut self, connection_id: &str) -> Result<(), CredentialVaultError> {
        if !self.path.exists() {
            return Ok(());
        }
        let mut payload = match self.read_payload() {
            Ok(payload) => payload,
            Err(error) if is_recoverable_vault_error(&error) => {
                self.back_up_inaccessible_vault()?;
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        if let Some(mut removed_password) = payload.passwords.remove(connection_id) {
            removed_password.zeroize();
        }
        self.write_payload(&payload)
    }

    fn read_payload(&mut self) -> Result<CredentialVaultPayload, CredentialVaultError> {
        self.ensure_ready()?;
        let key = self.key.as_ref().ok_or(CredentialVaultError::Corrupted)?;
        let encrypted_file = read_encrypted_file(&self.path)?;
        decrypt_payload(&encrypted_file, key, CredentialVaultError::DeviceMismatch)
    }

    fn write_payload(&self, payload: &CredentialVaultPayload) -> Result<(), CredentialVaultError> {
        let key = self.key.as_ref().ok_or(CredentialVaultError::Corrupted)?;
        let current_file = read_encrypted_file(&self.path)?;
        let salt = decode_fixed::<SALT_LENGTH>(&current_file.salt)?;
        let encrypted_file = encrypt_payload(payload, key, &salt)?;
        write_encrypted_file(&self.path, &encrypted_file)
    }

    fn ensure_ready(&mut self) -> Result<(), CredentialVaultError> {
        if self.key.is_some() {
            return Ok(());
        }
        if self.device_identifier.trim().is_empty() {
            return Err(CredentialVaultError::DeviceIdentifierUnavailable);
        }

        self.back_up_legacy_vault()?;
        let vault_exists = self.path.exists();
        let installation_secret = if self.installation_key_path.exists() {
            read_installation_secret(&self.installation_key_path)?
        } else if vault_exists {
            return Err(CredentialVaultError::InstallationKeyMissing);
        } else {
            create_installation_secret(&self.installation_key_path)?
        };

        if vault_exists {
            let encrypted_file = read_encrypted_file(&self.path)?;
            validate_current_version(&encrypted_file)?;
            let salt = decode_fixed::<SALT_LENGTH>(&encrypted_file.salt)?;
            let key = derive_device_key(
                &installation_secret,
                self.device_identifier.as_bytes(),
                &salt,
            )?;
            decrypt_payload(&encrypted_file, &key, CredentialVaultError::DeviceMismatch)?;
            self.key = Some(key);
            return Ok(());
        }

        let mut salt = [0_u8; SALT_LENGTH];
        OsRng.fill_bytes(&mut salt);
        let key = derive_device_key(
            &installation_secret,
            self.device_identifier.as_bytes(),
            &salt,
        )?;
        let encrypted_file = encrypt_payload(&CredentialVaultPayload::default(), &key, &salt)?;
        write_encrypted_file(&self.path, &encrypted_file)?;
        self.key = Some(key);
        Ok(())
    }

    fn back_up_legacy_vault(&self) -> Result<(), CredentialVaultError> {
        if !self.path.exists() {
            return Ok(());
        }
        let encrypted_file = read_encrypted_file(&self.path)?;
        match encrypted_file.version {
            VAULT_FILE_VERSION => Ok(()),
            LEGACY_VAULT_FILE_VERSION => {
                fs::rename(&self.path, next_legacy_backup_path(&self.path)?).map_err(io_error)
            }
            _ => Err(CredentialVaultError::UnsupportedVersion),
        }
    }

    fn back_up_inaccessible_vault(&mut self) -> Result<(), CredentialVaultError> {
        let (vault_backup_path, key_backup_path) =
            next_inaccessible_backup_paths(&self.path, &self.installation_key_path)?;
        if self.path.exists() {
            fs::rename(&self.path, vault_backup_path).map_err(io_error)?;
        }
        if self.installation_key_path.exists() {
            fs::rename(&self.installation_key_path, key_backup_path).map_err(io_error)?;
        }
        self.key = None;
        Ok(())
    }
}

fn derive_device_key(
    installation_secret: &[u8; INSTALLATION_SECRET_LENGTH],
    device_identifier: &[u8],
    salt: &[u8; SALT_LENGTH],
) -> Result<Zeroizing<[u8; KEY_LENGTH]>, CredentialVaultError> {
    let mut key_material = Zeroizing::new(Vec::with_capacity(
        INSTALLATION_SECRET_LENGTH + 1 + device_identifier.len(),
    ));
    key_material.extend_from_slice(installation_secret);
    key_material.push(0);
    key_material.extend_from_slice(device_identifier);
    let mut key = Zeroizing::new([0_u8; KEY_LENGTH]);
    let parameters = Params::new(
        ARGON2_MEMORY_COST_KIB,
        ARGON2_ITERATIONS,
        ARGON2_PARALLELISM,
        Some(KEY_LENGTH),
    )
    .map_err(|_| CredentialVaultError::Corrupted)?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, parameters)
        .hash_password_into(key_material.as_slice(), salt, key.as_mut())
        .map_err(|_| CredentialVaultError::Corrupted)?;
    Ok(key)
}

fn create_installation_secret(
    path: &Path,
) -> Result<Zeroizing<[u8; INSTALLATION_SECRET_LENGTH]>, CredentialVaultError> {
    let mut secret = Zeroizing::new([0_u8; INSTALLATION_SECRET_LENGTH]);
    OsRng.fill_bytes(secret.as_mut());
    let encoded_secret = Zeroizing::new(STANDARD_NO_PAD.encode(secret.as_slice()));
    let key_file = InstallationKeyFileRef {
        version: INSTALLATION_KEY_FILE_VERSION,
        secret: encoded_secret.as_str(),
    };
    write_private_json_file(path, &key_file)?;
    Ok(secret)
}

fn read_installation_secret(
    path: &Path,
) -> Result<Zeroizing<[u8; INSTALLATION_SECRET_LENGTH]>, CredentialVaultError> {
    let content = Zeroizing::new(fs::read_to_string(path).map_err(io_error)?);
    let key_file: InstallationKeyFile =
        serde_json::from_str(&content).map_err(|_| CredentialVaultError::Corrupted)?;
    if key_file.version != INSTALLATION_KEY_FILE_VERSION {
        return Err(CredentialVaultError::UnsupportedVersion);
    }
    let encoded_secret = Zeroizing::new(key_file.secret);
    decode_fixed::<INSTALLATION_SECRET_LENGTH>(&encoded_secret).map(Zeroizing::new)
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
        kdf: KDF_IDENTIFIER.to_string(),
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
    validate_current_version(encrypted_file)?;
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
    let content = fs::read_to_string(path).map_err(io_error)?;
    serde_json::from_str(&content).map_err(|_| CredentialVaultError::Corrupted)
}

fn write_encrypted_file(
    path: &Path,
    encrypted_file: &EncryptedVaultFile,
) -> Result<(), CredentialVaultError> {
    write_private_json_file(path, encrypted_file)
}

fn write_private_json_file<T: Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), CredentialVaultError> {
    let parent = path.parent().ok_or(CredentialVaultError::Corrupted)?;
    fs::create_dir_all(parent).map_err(io_error)?;
    let temporary_path = temporary_path(path)?;
    let content = Zeroizing::new(
        serde_json::to_vec_pretty(value).map_err(|_| CredentialVaultError::Corrupted)?,
    );
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary_path).map_err(io_error)?;
    file.write_all(content.as_slice()).map_err(io_error)?;
    file.sync_all().map_err(io_error)?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(io_error)?;
    }
    fs::rename(temporary_path, path).map_err(io_error)
}

fn validate_current_version(
    encrypted_file: &EncryptedVaultFile,
) -> Result<(), CredentialVaultError> {
    if encrypted_file.version == VAULT_FILE_VERSION && encrypted_file.kdf == KDF_IDENTIFIER {
        Ok(())
    } else {
        Err(CredentialVaultError::UnsupportedVersion)
    }
}

fn temporary_path(path: &Path) -> Result<PathBuf, CredentialVaultError> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(CredentialVaultError::Corrupted)?;
    Ok(path.with_file_name(format!("{file_name}{TEMPORARY_FILE_SUFFIX}")))
}

fn next_legacy_backup_path(path: &Path) -> Result<PathBuf, CredentialVaultError> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(CredentialVaultError::Corrupted)?;
    let first_candidate = path.with_file_name(format!("{file_name}{LEGACY_BACKUP_SUFFIX}"));
    if !first_candidate.exists() {
        return Ok(first_candidate);
    }
    for index in 2..=u16::MAX {
        let candidate = path.with_file_name(format!("{file_name}{LEGACY_BACKUP_SUFFIX}.{index}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(CredentialVaultError::Io(
        "no available legacy vault backup name".to_string(),
    ))
}

fn next_inaccessible_backup_paths(
    vault_path: &Path,
    key_path: &Path,
) -> Result<(PathBuf, PathBuf), CredentialVaultError> {
    for index in 1..=u16::MAX {
        let suffix = if index == 1 {
            INACCESSIBLE_BACKUP_SUFFIX.to_string()
        } else {
            format!("{INACCESSIBLE_BACKUP_SUFFIX}.{index}")
        };
        let vault_candidate = path_with_suffix(vault_path, &suffix)?;
        let key_candidate = path_with_suffix(key_path, &suffix)?;
        if !vault_candidate.exists() && !key_candidate.exists() {
            return Ok((vault_candidate, key_candidate));
        }
    }
    Err(CredentialVaultError::Io(
        "no available inaccessible vault backup name".to_string(),
    ))
}

fn path_with_suffix(path: &Path, suffix: &str) -> Result<PathBuf, CredentialVaultError> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(CredentialVaultError::Corrupted)?;
    Ok(path.with_file_name(format!("{file_name}{suffix}")))
}

fn is_recoverable_vault_error(error: &CredentialVaultError) -> bool {
    matches!(
        error,
        CredentialVaultError::Corrupted
            | CredentialVaultError::DeviceMismatch
            | CredentialVaultError::InstallationKeyMissing
            | CredentialVaultError::UnsupportedVersion
    )
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

pub fn platform_device_identifier() -> Result<String, CredentialVaultError> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("/usr/sbin/ioreg")
            .args(["-rd1", "-c", "IOPlatformExpertDevice"])
            .output()
            .map_err(io_error)?;
        if !output.status.success() {
            return Err(CredentialVaultError::DeviceIdentifierUnavailable);
        }
        let stdout = String::from_utf8(output.stdout)
            .map_err(|_| CredentialVaultError::DeviceIdentifierUnavailable)?;
        parse_platform_uuid(&stdout).ok_or(CredentialVaultError::DeviceIdentifierUnavailable)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(format!("fleurterm-platform-{}", std::env::consts::OS))
    }
}

fn parse_platform_uuid(output: &str) -> Option<String> {
    const PROPERTY_NAME: &str = "\"IOPlatformUUID\"";

    output.lines().find_map(|line| {
        let (_, value) = line.split_once(PROPERTY_NAME)?;
        let (_, quoted_value) = value.split_once("= \"")?;
        let (identifier, _) = quoted_value.split_once('"')?;
        let trimmed = identifier.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::{CredentialVault, CredentialVaultError, parse_platform_uuid};

    const TEST_DEVICE_IDENTIFIER: &str = "test-device-a";

    fn create_vault(directory: &tempfile::TempDir) -> CredentialVault {
        CredentialVault::new(
            directory.path().join("credentials.vault"),
            directory.path().join("credentials.key"),
            TEST_DEVICE_IDENTIFIER.to_string(),
        )
    }

    #[test]
    fn stores_passwords_only_in_encrypted_form() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let mut vault = create_vault(&directory);

        vault
            .save_password("server-a", "ssh-password")
            .expect("password saving should succeed");

        let stored = fs::read_to_string(path).expect("vault file should be readable");
        assert!(!stored.contains("server-a"));
        assert!(!stored.contains("ssh-password"));
        assert!(stored.contains("\"kdf\": \"argon2id-v19-m19456-t2-p1\""));
    }

    #[test]
    fn reopens_the_vault_without_a_user_passphrase() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let key_path = directory.path().join("credentials.key");
        let mut vault = CredentialVault::new(
            path.clone(),
            key_path.clone(),
            TEST_DEVICE_IDENTIFIER.to_string(),
        );

        vault
            .save_password("server-a", "ssh-password")
            .expect("password saving should succeed");
        drop(vault);

        let mut reopened = CredentialVault::new(path, key_path, TEST_DEVICE_IDENTIFIER.to_string());
        assert_eq!(
            reopened
                .load_password("server-a")
                .expect("password loading should succeed")
                .as_deref(),
            Some("ssh-password")
        );
    }

    #[test]
    fn rejects_vault_files_copied_to_a_different_device() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let key_path = directory.path().join("credentials.key");
        let mut vault = CredentialVault::new(
            path.clone(),
            key_path.clone(),
            TEST_DEVICE_IDENTIFIER.to_string(),
        );

        vault
            .save_password("server-a", "ssh-password")
            .expect("password saving should succeed");
        drop(vault);

        let mut copied_vault = CredentialVault::new(path, key_path, "test-device-b".to_string());

        assert_eq!(
            copied_vault.load_password("server-a"),
            Err(CredentialVaultError::DeviceMismatch)
        );
    }

    #[test]
    fn rebuilds_an_inaccessible_vault_when_a_replacement_password_is_saved() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        let key_path = directory.path().join("credentials.key");
        let mut vault = CredentialVault::new(path, key_path, TEST_DEVICE_IDENTIFIER.to_string());
        vault
            .save_password("server-a", "old-password")
            .expect("original password should be saved");
        drop(vault);

        let mut moved_device = CredentialVault::new(
            directory.path().join("credentials.vault"),
            directory.path().join("credentials.key"),
            "test-device-b".to_string(),
        );
        assert_eq!(
            moved_device.load_password("server-a"),
            Err(CredentialVaultError::DeviceMismatch)
        );

        moved_device
            .save_password("server-a", "replacement-password")
            .expect("saving a replacement should rebuild the inaccessible vault");

        assert_eq!(
            moved_device
                .load_password("server-a")
                .expect("replacement password should load")
                .as_deref(),
            Some("replacement-password")
        );
        assert!(
            directory
                .path()
                .join("credentials.vault.inaccessible.bak")
                .exists()
        );
        assert!(
            directory
                .path()
                .join("credentials.key.inaccessible.bak")
                .exists()
        );
    }

    #[test]
    fn rebuilds_a_vault_after_its_installation_key_is_lost() {
        let directory = tempdir().expect("temporary directory should be available");
        let key_path = directory.path().join("credentials.key");
        let mut vault = create_vault(&directory);
        vault
            .save_password("server-a", "old-password")
            .expect("original password should be saved");
        drop(vault);
        fs::remove_file(&key_path).expect("installation key should be removed for the test");

        let mut reopened = create_vault(&directory);
        assert_eq!(
            reopened.load_password("server-a"),
            Err(CredentialVaultError::InstallationKeyMissing)
        );
        reopened
            .save_password("server-a", "replacement-password")
            .expect("saving should create a new installation key and vault");

        assert_eq!(
            reopened
                .load_password("server-a")
                .expect("replacement password should load")
                .as_deref(),
            Some("replacement-password")
        );
    }

    #[test]
    fn preserves_a_master_password_vault_as_a_legacy_backup() {
        let directory = tempdir().expect("temporary directory should be available");
        let path = directory.path().join("credentials.vault");
        fs::write(
            &path,
            r#"{"version":1,"salt":"legacy","nonce":"legacy","ciphertext":"legacy"}"#,
        )
        .expect("legacy vault should be written");
        let mut vault = create_vault(&directory);

        let passwords = vault
            .load_passwords(&["server-a".to_string()])
            .expect("a fresh device vault should replace the legacy vault");

        assert!(passwords.is_empty());
        assert!(
            directory
                .path()
                .join("credentials.vault.master-password.bak")
                .exists()
        );
        let current = fs::read_to_string(path).expect("new vault should be readable");
        assert!(current.contains("\"version\": 2"));
    }

    #[test]
    fn loads_requested_passwords_and_removes_deleted_entries() {
        let directory = tempdir().expect("temporary directory should be available");
        let mut vault = create_vault(&directory);
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

    #[cfg(unix)]
    #[test]
    fn restricts_the_installation_key_to_the_current_user() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempdir().expect("temporary directory should be available");
        let key_path = directory.path().join("credentials.key");
        let mut vault = create_vault(&directory);

        vault
            .save_password("server-a", "ssh-password")
            .expect("password saving should succeed");

        let mode = fs::metadata(key_path)
            .expect("installation key metadata should be available")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn parses_the_macos_platform_uuid_from_ioreg_output() {
        let output = r#"    "IOPlatformUUID" = "E26A5B79-5B2B-4B87-A8D8-123456789ABC""#;

        assert_eq!(
            parse_platform_uuid(output).as_deref(),
            Some("E26A5B79-5B2B-4B87-A8D8-123456789ABC")
        );
    }
}
