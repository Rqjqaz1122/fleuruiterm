use thiserror::Error;

use super::model::SessionId;
use super::state::SessionState;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SessionError {
    #[error("session cannot transition from {current:?} to {requested:?}")]
    InvalidStateTransition {
        current: SessionState,
        requested: SessionState,
    },
    #[error("invalid terminal dimensions: columns={columns}, rows={rows}")]
    InvalidTerminalDimensions { columns: u16, rows: u16 },
    #[error("session not found: {session_id:?}")]
    SessionNotFound { session_id: SessionId },
    #[error("terminal input exceeds {maximum} bytes: actual={actual}")]
    InputTooLarge { actual: usize, maximum: usize },
    #[error("shell is unavailable: {shell}")]
    ShellUnavailable { shell: String },
    #[error("terminal output channel is closed")]
    OutputChannelClosed,
    #[error("PTY operation failed during {operation}: {message}")]
    BackendFailure {
        operation: &'static str,
        message: String,
    },
}
