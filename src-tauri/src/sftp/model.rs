use serde::{Deserialize, Serialize};
use std::path::Path;

use super::error::SftpError;

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpAuthMethod {
    #[default]
    Auto,
    Password,
    PublicKey,
    Agent,
    KeyboardInteractive,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SftpConnectionProfile {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth_method: SftpAuthMethod,
    pub private_key_paths: Vec<String>,
}

impl SftpConnectionProfile {
    pub fn validate(&self) -> Result<(), SftpError> {
        let required_values = [&self.connection_id, &self.host, &self.user];
        if self.port == 0
            || required_values
                .iter()
                .any(|value| value.trim().is_empty() || value.contains('\0'))
        {
            return Err(SftpError::InvalidRequest);
        }
        Ok(())
    }

    pub fn matches_terminal_command(&self, shell: Option<&str>, args: &[String]) -> bool {
        let is_ssh = shell
            .and_then(|value| Path::new(value).file_name())
            .and_then(|value| value.to_str())
            == Some("ssh");
        if !is_ssh {
            return false;
        }
        let expected_target = format!("{}@{}", self.user, self.host);
        let expected_port = self.port.to_string();
        let has_target = args.iter().any(|argument| argument == &expected_target);
        let has_port = args
            .windows(2)
            .any(|pair| pair[0] == "-p" && pair[1] == expected_port);
        has_target && has_port
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct OpenSftpResponse {
    pub sftp_session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SftpEntryKind {
    Directory,
    File,
    Symlink,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpDirectoryEntry {
    pub name: String,
    pub path: String,
    pub kind: SftpEntryKind,
    pub size: Option<u64>,
    pub modified_at: Option<u64>,
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListSftpDirectoryResponse {
    pub path: String,
    pub entries: Vec<SftpDirectoryEntry>,
}

pub fn sort_entries(entries: &mut [SftpDirectoryEntry]) {
    entries.sort_by(|left, right| {
        entry_kind_rank(left.kind)
            .cmp(&entry_kind_rank(right.kind))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn entry_kind_rank(kind: SftpEntryKind) -> u8 {
    match kind {
        SftpEntryKind::Directory => 0,
        SftpEntryKind::File => 1,
        SftpEntryKind::Symlink => 2,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SftpAuthMethod, SftpConnectionProfile, SftpDirectoryEntry, SftpEntryKind, sort_entries,
    };

    #[test]
    fn validates_required_connection_fields() {
        let request = SftpConnectionProfile {
            connection_id: "server-a".to_owned(),
            host: "10.7.121.81".to_owned(),
            port: 22,
            user: "root".to_owned(),
            auth_method: SftpAuthMethod::Agent,
            private_key_paths: Vec::new(),
        };
        assert!(request.validate().is_ok());
        assert!(
            SftpConnectionProfile {
                host: String::new(),
                ..request
            }
            .validate()
            .is_err()
        );
    }

    #[test]
    fn orders_directories_before_files_then_by_name() {
        let mut entries = vec![
            entry("z.txt", SftpEntryKind::File),
            entry("Beta", SftpEntryKind::Directory),
            entry("alpha", SftpEntryKind::Directory),
        ];
        sort_entries(&mut entries);
        assert_eq!(entries[0].name, "alpha");
        assert_eq!(entries[1].name, "Beta");
        assert_eq!(entries[2].name, "z.txt");
    }

    fn entry(name: &str, kind: SftpEntryKind) -> SftpDirectoryEntry {
        SftpDirectoryEntry {
            name: name.to_owned(),
            path: format!("/{name}"),
            kind,
            size: None,
            modified_at: None,
            permissions: None,
        }
    }
}
