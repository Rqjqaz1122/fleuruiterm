use thiserror::Error;

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
}
