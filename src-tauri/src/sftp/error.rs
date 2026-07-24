use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SftpError {
    #[error("invalid SFTP request")]
    InvalidRequest,
    #[error("invalid remote path")]
    InvalidRemotePath,
    #[error("SFTP session was not found")]
    SessionNotFound,
    #[error("server host key is unknown")]
    UnknownHostKey,
    #[error("server host key does not match known_hosts")]
    HostKeyMismatch,
    #[error("SFTP authentication failed")]
    AuthenticationFailed,
    #[error("SFTP connection failed: {0}")]
    ConnectionFailed(String),
    #[error("remote SFTP operation failed: {0}")]
    RemoteOperationFailed(String),
    #[error("local file operation failed: {0}")]
    LocalFileOperationFailed(String),
    #[error("SFTP worker failed")]
    WorkerFailed,
    #[error("SFTP operation was cancelled")]
    Cancelled,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicSftpError {
    pub code: &'static str,
    pub message: &'static str,
}

impl From<SftpError> for PublicSftpError {
    fn from(error: SftpError) -> Self {
        match error {
            SftpError::InvalidRequest | SftpError::InvalidRemotePath => Self {
                code: "SFTP_INVALID_REQUEST",
                message: "The SFTP request is invalid",
            },
            SftpError::SessionNotFound => Self {
                code: "SFTP_SESSION_NOT_FOUND",
                message: "The SFTP session is no longer available",
            },
            SftpError::UnknownHostKey => Self {
                code: "SFTP_HOST_KEY_UNKNOWN",
                message: "Connect in the terminal and accept the server host key first",
            },
            SftpError::HostKeyMismatch => Self {
                code: "SFTP_HOST_KEY_MISMATCH",
                message: "The server host key does not match known_hosts",
            },
            SftpError::AuthenticationFailed => Self {
                code: "SFTP_AUTHENTICATION_FAILED",
                message: "Unable to authenticate the SFTP connection",
            },
            SftpError::ConnectionFailed(_) => Self {
                code: "SFTP_CONNECTION_FAILED",
                message: "Unable to connect to the SFTP server",
            },
            SftpError::RemoteOperationFailed(_) => Self {
                code: "SFTP_REMOTE_OPERATION_FAILED",
                message: "The remote SFTP operation failed",
            },
            SftpError::LocalFileOperationFailed(_) => Self {
                code: "SFTP_LOCAL_FILE_FAILED",
                message: "The local file operation failed",
            },
            SftpError::WorkerFailed => Self {
                code: "SFTP_WORKER_FAILED",
                message: "The SFTP operation could not be completed",
            },
            SftpError::Cancelled => Self {
                code: "SFTP_CANCELLED",
                message: "The SFTP operation was cancelled",
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PublicSftpError, SftpError};

    #[test]
    fn public_authentication_errors_are_stable_and_safe() {
        let error = PublicSftpError::from(SftpError::AuthenticationFailed);
        assert_eq!(error.code, "SFTP_AUTHENTICATION_FAILED");
        assert_eq!(error.message, "Unable to authenticate the SFTP connection");
        assert!(!error.message.to_lowercase().contains("password"));
    }

    #[test]
    fn missing_sessions_use_a_stable_code() {
        let error = PublicSftpError::from(SftpError::SessionNotFound);
        assert_eq!(error.code, "SFTP_SESSION_NOT_FOUND");
    }
}
