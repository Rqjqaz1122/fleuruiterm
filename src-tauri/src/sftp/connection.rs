use std::{
    fs::File,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

use ssh2::{CheckResult, KeyboardInteractivePrompt, KnownHostFileKind, Prompt, Session};

use super::{
    error::SftpError,
    model::{SftpAuthMethod, SftpConnectionProfile, SftpDirectoryEntry, SftpEntryKind},
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
    pub fn connect(
        request: &SftpConnectionProfile,
        password: Option<&str>,
    ) -> Result<Self, SftpError> {
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
    fn list_directory(
        &mut self,
        path: &str,
        cancelled: &AtomicBool,
    ) -> Result<Vec<SftpDirectoryEntry>, SftpError> {
        ensure_not_cancelled(cancelled)?;
        let entries = self.sftp.readdir(Path::new(path)).map_err(remote_error)?;
        ensure_not_cancelled(cancelled)?;
        Ok(entries
            .into_iter()
            .filter_map(|(remote_path, metadata)| {
                let name = remote_path.file_name()?.to_str()?.to_owned();
                let remote_path = normalize_remote_path(&remote_path.to_string_lossy()).ok()?;
                Some(SftpDirectoryEntry {
                    name,
                    path: remote_path,
                    kind: entry_kind(metadata.perm),
                    size: metadata.size,
                    modified_at: metadata.mtime,
                    permissions: metadata.perm.map(format_permissions),
                })
            })
            .collect::<Vec<_>>())
    }

    fn upload_file(
        &mut self,
        local_path: &Path,
        remote_path: &str,
        cancelled: &AtomicBool,
    ) -> Result<(), SftpError> {
        ensure_not_cancelled(cancelled)?;
        let mut local_file = File::open(local_path).map_err(local_file_error)?;
        let mut remote_file = self
            .sftp
            .create(Path::new(remote_path))
            .map_err(remote_error)?;
        copy_upload(&mut local_file, &mut remote_file, cancelled)?;
        remote_file.close().map_err(remote_error)
    }

    fn download_file(
        &mut self,
        remote_path: &str,
        local_path: &Path,
        cancelled: &AtomicBool,
    ) -> Result<(), SftpError> {
        ensure_not_cancelled(cancelled)?;
        let mut remote_file = self
            .sftp
            .open(Path::new(remote_path))
            .map_err(remote_error)?;
        persist_download(&mut remote_file, local_path, cancelled)
    }

    fn entry_kind(
        &mut self,
        remote_path: &str,
        cancelled: &AtomicBool,
    ) -> Result<SftpEntryKind, SftpError> {
        ensure_not_cancelled(cancelled)?;
        self.sftp
            .lstat(Path::new(remote_path))
            .map(|metadata| entry_kind(metadata.perm))
            .map_err(remote_error)
    }

    fn remove_file(&mut self, remote_path: &str, cancelled: &AtomicBool) -> Result<(), SftpError> {
        ensure_not_cancelled(cancelled)?;
        self.sftp
            .unlink(Path::new(remote_path))
            .map_err(remote_error)
    }

    fn remove_directory(
        &mut self,
        remote_path: &str,
        cancelled: &AtomicBool,
    ) -> Result<(), SftpError> {
        ensure_not_cancelled(cancelled)?;
        self.sftp
            .rmdir(Path::new(remote_path))
            .map_err(remote_error)
    }
}

fn persist_download(
    reader: &mut impl Read,
    local_path: &Path,
    cancelled: &AtomicBool,
) -> Result<(), SftpError> {
    let parent_directory = local_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or(SftpError::InvalidRequest)?;
    let mut temporary_file =
        tempfile::NamedTempFile::new_in(parent_directory).map_err(local_file_error)?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        ensure_not_cancelled(cancelled)?;
        let bytes_read = reader.read(&mut buffer).map_err(remote_error)?;
        if bytes_read == 0 {
            break;
        }
        temporary_file
            .as_file_mut()
            .write_all(&buffer[..bytes_read])
            .map_err(local_file_error)?;
    }
    temporary_file
        .as_file_mut()
        .sync_all()
        .map_err(local_file_error)?;
    temporary_file
        .persist(local_path)
        .map(|_| ())
        .map_err(|error| local_file_error(error.error))
}

fn copy_upload(
    reader: &mut impl Read,
    writer: &mut impl Write,
    cancelled: &AtomicBool,
) -> Result<(), SftpError> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        ensure_not_cancelled(cancelled)?;
        let bytes_read = reader.read(&mut buffer).map_err(local_file_error)?;
        if bytes_read == 0 {
            return Ok(());
        }
        writer
            .write_all(&buffer[..bytes_read])
            .map_err(remote_error)?;
    }
}

fn ensure_not_cancelled(cancelled: &AtomicBool) -> Result<(), SftpError> {
    if cancelled.load(Ordering::SeqCst) {
        Err(SftpError::Cancelled)
    } else {
        Ok(())
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
    request: &SftpConnectionProfile,
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

fn authenticate_with_keys(
    session: &Session,
    request: &SftpConnectionProfile,
    passphrase: Option<&str>,
) {
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

fn candidate_private_key_paths(request: &SftpConnectionProfile) -> Vec<PathBuf> {
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
        let [prompt] = prompts else {
            return Vec::new();
        };
        let normalized_prompt = prompt.text.to_ascii_lowercase();
        if prompt.echo
            || (!normalized_prompt.contains("password")
                && !normalized_prompt.contains("passphrase"))
        {
            return Vec::new();
        }
        vec![self.password.to_owned()]
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
    use std::{
        borrow::Cow,
        io::{self, Cursor, Read},
        sync::atomic::AtomicBool,
    };

    use ssh2::{KeyboardInteractivePrompt, Prompt};

    use super::{PasswordPrompter, entry_kind, format_permissions, persist_download};
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

    #[test]
    fn download_replaces_the_destination_only_after_a_complete_copy() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("report.txt");
        std::fs::write(&destination, b"previous").unwrap();

        persist_download(
            &mut Cursor::new(b"replacement"),
            &destination,
            &AtomicBool::new(false),
        )
        .unwrap();

        assert_eq!(std::fs::read(destination).unwrap(), b"replacement");
    }

    #[test]
    fn failed_download_preserves_an_existing_destination() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("report.txt");
        std::fs::write(&destination, b"previous").unwrap();

        assert!(
            persist_download(&mut FailingReader, &destination, &AtomicBool::new(false),).is_err()
        );

        assert_eq!(std::fs::read(destination).unwrap(), b"previous");
    }

    #[test]
    fn keyboard_interactive_answers_only_one_hidden_password_prompt() {
        let mut prompter = PasswordPrompter { password: "secret" };

        let password_response = prompter.prompt(
            "deploy",
            "",
            &[Prompt {
                text: Cow::Borrowed("Password: "),
                echo: false,
            }],
        );
        let otp_response = prompter.prompt(
            "deploy",
            "",
            &[Prompt {
                text: Cow::Borrowed("Verification code: "),
                echo: false,
            }],
        );

        assert_eq!(password_response, ["secret"]);
        assert!(otp_response.is_empty());
    }

    #[test]
    fn keyboard_interactive_rejects_echoed_and_multi_prompt_challenges() {
        let mut prompter = PasswordPrompter { password: "secret" };

        let echoed = prompter.prompt(
            "deploy",
            "",
            &[Prompt {
                text: Cow::Borrowed("Password: "),
                echo: true,
            }],
        );
        let multiple = prompter.prompt(
            "deploy",
            "",
            &[
                Prompt {
                    text: Cow::Borrowed("Password: "),
                    echo: false,
                },
                Prompt {
                    text: Cow::Borrowed("OTP: "),
                    echo: false,
                },
            ],
        );

        assert!(echoed.is_empty());
        assert!(multiple.is_empty());
    }

    struct FailingReader;

    impl Read for FailingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> io::Result<usize> {
            Err(io::Error::other("injected read failure"))
        }
    }
}
