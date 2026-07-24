use std::{
    fs::{File, OpenOptions},
    io,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    time::Duration,
};

use ssh2::{CheckResult, KeyboardInteractivePrompt, KnownHostFileKind, Prompt, Session};

use super::{
    error::SftpError,
    model::{OpenSftpRequest, SftpAuthMethod, SftpDirectoryEntry, SftpEntryKind},
    path::normalize_remote_path,
    registry::SftpOperations,
};

const CONNECTION_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_TIMEOUT_MILLISECONDS: u32 = 30_000;

pub struct Ssh2SftpConnection {
    _session: Session,
    sftp: ssh2::Sftp,
}

impl Ssh2SftpConnection {
    pub fn connect(request: &OpenSftpRequest, password: Option<&str>) -> Result<Self, SftpError> {
        request.validate()?;
        let tcp_stream = connect_tcp(&request.host, request.port)?;
        tcp_stream
            .set_read_timeout(Some(CONNECTION_TIMEOUT))
            .map_err(connection_error)?;
        tcp_stream
            .set_write_timeout(Some(CONNECTION_TIMEOUT))
            .map_err(connection_error)?;

        let mut session = Session::new().map_err(connection_error)?;
        session.set_tcp_stream(tcp_stream);
        session.set_timeout(SESSION_TIMEOUT_MILLISECONDS);
        session.handshake().map_err(connection_error)?;
        verify_host_key(&session, &request.host, request.port)?;
        authenticate(&session, request, password)?;
        let sftp = session.sftp().map_err(remote_error)?;
        Ok(Self {
            _session: session,
            sftp,
        })
    }

    pub fn home_directory(&self) -> Result<String, SftpError> {
        let path = self
            .sftp
            .realpath(Path::new("."))
            .map_err(remote_error)?
            .to_string_lossy()
            .into_owned();
        normalize_remote_path(&path).map_err(|_| SftpError::InvalidRemotePath)
    }
}

impl SftpOperations for Ssh2SftpConnection {
    fn list_directory(&mut self, path: &str) -> Result<Vec<SftpDirectoryEntry>, SftpError> {
        self.sftp
            .readdir(Path::new(path))
            .map_err(remote_error)?
            .into_iter()
            .map(|(remote_path, metadata)| {
                let name = remote_path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .ok_or_else(|| {
                        SftpError::RemoteOperationFailed(
                            "remote entry name is not valid UTF-8".to_owned(),
                        )
                    })?
                    .to_owned();
                let remote_path = normalize_remote_path(&remote_path.to_string_lossy())
                    .map_err(|_| SftpError::InvalidRemotePath)?;
                Ok(SftpDirectoryEntry {
                    name,
                    path: remote_path,
                    kind: entry_kind(metadata.perm),
                    size: metadata.size,
                    modified_at: metadata.mtime,
                    permissions: metadata.perm.map(format_permissions),
                })
            })
            .collect()
    }

    fn upload_file(&mut self, local_path: &Path, remote_path: &str) -> Result<(), SftpError> {
        let mut local_file = File::open(local_path).map_err(local_file_error)?;
        let mut remote_file = self
            .sftp
            .create(Path::new(remote_path))
            .map_err(remote_error)?;
        io::copy(&mut local_file, &mut remote_file).map_err(remote_error)?;
        remote_file.close().map_err(remote_error)
    }

    fn download_file(&mut self, remote_path: &str, local_path: &Path) -> Result<(), SftpError> {
        let mut remote_file = self
            .sftp
            .open(Path::new(remote_path))
            .map_err(remote_error)?;
        let mut local_file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(local_path)
            .map_err(local_file_error)?;
        let result = io::copy(&mut remote_file, &mut local_file)
            .map_err(remote_error)
            .and_then(|_| local_file.sync_all().map_err(local_file_error));
        if result.is_err() {
            let _ = std::fs::remove_file(local_path);
        }
        result
    }
}

fn connect_tcp(host: &str, port: u16) -> Result<TcpStream, SftpError> {
    let addresses = (host, port).to_socket_addrs().map_err(connection_error)?;
    let mut last_error = None;
    for address in addresses {
        match TcpStream::connect_timeout(&address, CONNECTION_TIMEOUT) {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error
        .map(connection_error)
        .unwrap_or_else(|| SftpError::ConnectionFailed("host has no address".to_owned())))
}

fn verify_host_key(session: &Session, host: &str, port: u16) -> Result<(), SftpError> {
    let known_hosts_path = known_hosts_path().ok_or(SftpError::UnknownHostKey)?;
    if !known_hosts_path.is_file() {
        return Err(SftpError::UnknownHostKey);
    }
    let mut known_hosts = session.known_hosts().map_err(connection_error)?;
    known_hosts
        .read_file(&known_hosts_path, KnownHostFileKind::OpenSSH)
        .map_err(connection_error)?;
    let (host_key, _) = session.host_key().ok_or_else(|| {
        SftpError::ConnectionFailed("server did not provide a host key".to_owned())
    })?;
    match known_hosts.check_port(host, port, host_key) {
        CheckResult::Match => Ok(()),
        CheckResult::NotFound => Err(SftpError::UnknownHostKey),
        CheckResult::Mismatch => Err(SftpError::HostKeyMismatch),
        CheckResult::Failure => Err(SftpError::ConnectionFailed(
            "known_hosts verification failed".to_owned(),
        )),
    }
}

fn known_hosts_path() -> Option<PathBuf> {
    dirs::home_dir().map(|home_directory| home_directory.join(".ssh").join("known_hosts"))
}

fn authenticate(
    session: &Session,
    request: &OpenSftpRequest,
    password: Option<&str>,
) -> Result<(), SftpError> {
    match request.auth_method {
        SftpAuthMethod::Agent => {
            authenticate_with_agent(session, &request.user);
        }
        SftpAuthMethod::PublicKey => {
            authenticate_with_keys(session, request, password);
        }
        SftpAuthMethod::Password => {
            authenticate_with_password(session, &request.user, password);
        }
        SftpAuthMethod::KeyboardInteractive => {
            authenticate_keyboard_interactive(session, &request.user, password);
        }
        SftpAuthMethod::Auto => {
            authenticate_with_agent(session, &request.user);
            authenticate_with_keys(session, request, password);
            authenticate_with_password(session, &request.user, password);
            authenticate_keyboard_interactive(session, &request.user, password);
        }
    }
    if session.authenticated() {
        Ok(())
    } else {
        Err(SftpError::AuthenticationFailed)
    }
}

fn authenticate_with_agent(session: &Session, user: &str) {
    if session.authenticated() {
        return;
    }
    let Ok(mut agent) = session.agent() else {
        return;
    };
    if agent.connect().is_err() || agent.list_identities().is_err() {
        return;
    }
    if let Ok(identities) = agent.identities() {
        for identity in identities {
            if agent.userauth(user, &identity).is_ok() && session.authenticated() {
                break;
            }
        }
    }
    let _ = agent.disconnect();
}

fn authenticate_with_keys(session: &Session, request: &OpenSftpRequest, passphrase: Option<&str>) {
    if session.authenticated() {
        return;
    }
    for private_key_path in candidate_private_key_paths(request) {
        if session
            .userauth_pubkey_file(&request.user, None, &private_key_path, passphrase)
            .is_ok()
            && session.authenticated()
        {
            break;
        }
    }
}

fn candidate_private_key_paths(request: &OpenSftpRequest) -> Vec<PathBuf> {
    let mut paths = request
        .private_key_paths
        .iter()
        .filter(|path| !path.trim().is_empty())
        .map(|path| expand_home_directory(path))
        .collect::<Vec<_>>();
    if let Some(ssh_directory) = dirs::home_dir().map(|home| home.join(".ssh")) {
        for file_name in ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"] {
            let path = ssh_directory.join(file_name);
            if path.is_file() && !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

fn expand_home_directory(path: &str) -> PathBuf {
    if let Some(relative_path) = path.strip_prefix("~/") {
        return dirs::home_dir()
            .map(|home_directory| home_directory.join(relative_path))
            .unwrap_or_else(|| PathBuf::from(path));
    }
    PathBuf::from(path)
}

fn authenticate_with_password(session: &Session, user: &str, password: Option<&str>) {
    if session.authenticated() {
        return;
    }
    if let Some(password) = password {
        let _ = session.userauth_password(user, password);
    }
}

fn authenticate_keyboard_interactive(session: &Session, user: &str, password: Option<&str>) {
    if session.authenticated() {
        return;
    }
    if let Some(password) = password {
        let mut prompter = PasswordPrompter { password };
        let _ = session.userauth_keyboard_interactive(user, &mut prompter);
    }
}

struct PasswordPrompter<'password> {
    password: &'password str,
}

impl KeyboardInteractivePrompt for PasswordPrompter<'_> {
    fn prompt<'prompt>(
        &mut self,
        _username: &str,
        _instructions: &str,
        prompts: &[Prompt<'prompt>],
    ) -> Vec<String> {
        prompts.iter().map(|_| self.password.to_owned()).collect()
    }
}

fn entry_kind(permissions: Option<u32>) -> SftpEntryKind {
    match permissions.unwrap_or(0) & 0o170000 {
        0o040000 => SftpEntryKind::Directory,
        0o120000 => SftpEntryKind::Symlink,
        _ => SftpEntryKind::File,
    }
}

fn format_permissions(permissions: u32) -> String {
    let kind = match entry_kind(Some(permissions)) {
        SftpEntryKind::Directory => 'd',
        SftpEntryKind::Symlink => 'l',
        SftpEntryKind::File => '-',
    };
    let mut formatted = String::with_capacity(10);
    formatted.push(kind);
    for (mask, symbol) in [
        (0o400, 'r'),
        (0o200, 'w'),
        (0o100, 'x'),
        (0o040, 'r'),
        (0o020, 'w'),
        (0o010, 'x'),
        (0o004, 'r'),
        (0o002, 'w'),
        (0o001, 'x'),
    ] {
        formatted.push(if permissions & mask == 0 { '-' } else { symbol });
    }
    formatted
}

fn connection_error(error: impl std::fmt::Display) -> SftpError {
    SftpError::ConnectionFailed(error.to_string())
}

fn remote_error(error: impl std::fmt::Display) -> SftpError {
    SftpError::RemoteOperationFailed(error.to_string())
}

fn local_file_error(error: impl std::fmt::Display) -> SftpError {
    SftpError::LocalFileOperationFailed(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{entry_kind, format_permissions};
    use crate::sftp::model::SftpEntryKind;

    #[test]
    fn formats_unix_permissions() {
        assert_eq!(format_permissions(0o100644), "-rw-r--r--");
        assert_eq!(format_permissions(0o040755), "drwxr-xr-x");
    }

    #[test]
    fn maps_remote_file_types() {
        assert_eq!(entry_kind(Some(0o040755)), SftpEntryKind::Directory);
        assert_eq!(entry_kind(Some(0o120777)), SftpEntryKind::Symlink);
        assert_eq!(entry_kind(Some(0o100644)), SftpEntryKind::File);
    }
}
