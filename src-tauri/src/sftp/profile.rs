use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
};

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::{APP_SETTINGS_FILE_NAME, session::model::SessionId};

use super::{
    error::SftpError,
    model::{SftpAuthMethod, SftpConnectionProfile},
};

#[derive(Clone, Default)]
pub struct TerminalSftpBindings {
    profiles: Arc<Mutex<HashMap<SessionId, SftpConnectionProfile>>>,
}

impl TerminalSftpBindings {
    pub fn insert(
        &self,
        session_id: SessionId,
        profile: SftpConnectionProfile,
    ) -> Result<(), SftpError> {
        self.profiles
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .insert(session_id, profile);
        Ok(())
    }

    pub fn profile(&self, session_id: &SessionId) -> Result<SftpConnectionProfile, SftpError> {
        self.profiles
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .get(session_id)
            .cloned()
            .ok_or(SftpError::SessionNotFound)
    }

    pub fn remove(&self, session_id: &SessionId) -> Result<(), SftpError> {
        self.profiles
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .remove(session_id);
        Ok(())
    }

    pub fn clear(&self) -> Result<(), SftpError> {
        self.profiles
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .clear();
        Ok(())
    }

    pub fn invalidate_changed_profiles(
        &self,
        settings: &Value,
    ) -> Result<Vec<SessionId>, SftpError> {
        let mut invalidated = Vec::new();
        let mut profiles = self.profiles.lock().map_err(|_| SftpError::WorkerFailed)?;
        profiles.retain(|session_id, profile| {
            let unchanged = parse_saved_ssh_profile(settings, &profile.connection_id)
                .is_ok_and(|current| current == *profile);
            if !unchanged {
                invalidated.push(session_id.clone());
            }
            unchanged
        });
        Ok(invalidated)
    }
}

pub fn load_saved_ssh_profile(
    app: &AppHandle,
    connection_id: &str,
) -> Result<SftpConnectionProfile, SftpError> {
    let settings_path = app
        .path()
        .app_config_dir()
        .map_err(local_settings_error)?
        .join(APP_SETTINGS_FILE_NAME);
    let content = fs::read_to_string(settings_path).map_err(local_settings_error)?;
    let settings = serde_json::from_str(&content).map_err(local_settings_error)?;
    parse_saved_ssh_profile(&settings, connection_id)
}

pub fn parse_saved_ssh_profile(
    settings: &Value,
    connection_id: &str,
) -> Result<SftpConnectionProfile, SftpError> {
    let persisted = serde_json::from_value::<PersistedSettings>(settings.clone())
        .map_err(local_settings_error)?;
    let connection = persisted
        .workbench
        .and_then(|workbench| {
            workbench
                .connections
                .into_iter()
                .find(|connection| connection.id == connection_id && connection.method == "ssh")
        })
        .ok_or(SftpError::InvalidRequest)?;
    let profile = SftpConnectionProfile {
        connection_id: connection.id,
        host: connection.host,
        port: if connection.port == 0 {
            22
        } else {
            connection.port
        },
        user: connection.user,
        auth_method: connection.auth_method,
        private_key_paths: connection.private_keys,
    };
    profile.validate()?;
    Ok(profile)
}

#[derive(Deserialize)]
struct PersistedSettings {
    workbench: Option<PersistedWorkbench>,
}

#[derive(Deserialize)]
struct PersistedWorkbench {
    #[serde(default)]
    connections: Vec<PersistedConnection>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedConnection {
    id: String,
    method: String,
    #[serde(default)]
    host: String,
    #[serde(default)]
    user: String,
    #[serde(default)]
    port: u16,
    #[serde(default)]
    auth_method: SftpAuthMethod,
    #[serde(default)]
    private_keys: Vec<String>,
}

fn local_settings_error(error: impl std::fmt::Display) -> SftpError {
    SftpError::LocalFileOperationFailed(error.to_string())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{TerminalSftpBindings, parse_saved_ssh_profile};
    use crate::{
        session::model::SessionId,
        sftp::model::{SftpAuthMethod, SftpConnectionProfile},
    };

    #[test]
    fn resolves_an_authoritative_saved_ssh_profile() {
        let settings = json!({
            "workbench": {
                "connections": [{
                    "id": "server-a",
                    "method": "ssh",
                    "host": "server.example.com",
                    "user": "deploy",
                    "port": 2222,
                    "authMethod": "publicKey",
                    "privateKeys": ["~/.ssh/id_ed25519"]
                }]
            }
        });

        let profile = parse_saved_ssh_profile(&settings, "server-a").unwrap();

        assert_eq!(profile.connection_id, "server-a");
        assert_eq!(profile.host, "server.example.com");
        assert_eq!(profile.port, 2222);
        assert_eq!(profile.user, "deploy");
        assert_eq!(profile.auth_method, SftpAuthMethod::PublicKey);
        assert_eq!(profile.private_key_paths, ["~/.ssh/id_ed25519"]);
    }

    #[test]
    fn rejects_non_ssh_and_missing_saved_profiles() {
        let settings = json!({
            "workbench": {
                "connections": [{
                    "id": "local-a",
                    "method": "local",
                    "host": "",
                    "user": "",
                    "port": 0
                }]
            }
        });

        assert!(parse_saved_ssh_profile(&settings, "local-a").is_err());
        assert!(parse_saved_ssh_profile(&settings, "missing").is_err());
    }

    #[test]
    fn terminal_bindings_keep_an_immutable_profile_snapshot() {
        let bindings = TerminalSftpBindings::default();
        let session_id = SessionId::new();
        let profile = profile();

        bindings
            .insert(session_id.clone(), profile.clone())
            .unwrap();

        assert_eq!(bindings.profile(&session_id).unwrap(), profile);
        bindings.remove(&session_id).unwrap();
        assert!(bindings.profile(&session_id).is_err());
    }

    #[test]
    fn saved_profile_matches_only_its_ssh_terminal_command() {
        let profile = SftpConnectionProfile {
            port: 2222,
            ..profile()
        };

        assert!(profile.matches_terminal_command(
            Some("ssh"),
            &[
                "-p".to_owned(),
                "2222".to_owned(),
                "deploy@server.example.com".to_owned()
            ],
        ));
        assert!(!profile.matches_terminal_command(
            Some("ssh"),
            &[
                "-p".to_owned(),
                "2222".to_owned(),
                "deploy@other.example.com".to_owned()
            ],
        ));
        assert!(!profile.matches_terminal_command(Some("zsh"), &[]));
    }

    #[test]
    fn changed_saved_profiles_invalidate_existing_terminal_bindings() {
        let bindings = TerminalSftpBindings::default();
        let session_id = SessionId::new();
        bindings.insert(session_id.clone(), profile()).unwrap();
        let changed_settings = json!({
            "workbench": {
                "connections": [{
                    "id": "server-a",
                    "method": "ssh",
                    "host": "changed.example.com",
                    "user": "deploy",
                    "port": 22,
                    "authMethod": "agent"
                }]
            }
        });

        let invalidated = bindings
            .invalidate_changed_profiles(&changed_settings)
            .unwrap();

        assert_eq!(invalidated.as_slice(), std::slice::from_ref(&session_id));
        assert!(bindings.profile(&session_id).is_err());
    }

    fn profile() -> SftpConnectionProfile {
        SftpConnectionProfile {
            connection_id: "server-a".to_owned(),
            host: "server.example.com".to_owned(),
            port: 22,
            user: "deploy".to_owned(),
            auth_method: SftpAuthMethod::Agent,
            private_key_paths: Vec::new(),
        }
    }
}
