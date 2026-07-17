use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::error::SessionError;
use super::state::SessionState;

const MAX_TERMINAL_COLUMNS: u16 = 1_000;
const MAX_TERMINAL_ROWS: u16 = 1_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BackendType {
    Local,
    Ssh,
}

#[derive(Clone, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(transparent)]
pub struct SessionId(Uuid);

impl SessionId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDimensions {
    columns: u16,
    rows: u16,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub session_id: SessionId,
    pub backend_type: BackendType,
    pub state: SessionState,
    pub shell: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub session_id: SessionId,
    pub sequence: u64,
    pub payload: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStateChanged {
    pub session_id: SessionId,
    pub state: SessionState,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenLocalSessionRequest {
    pub shell: Option<String>,
    pub dimensions: TerminalDimensions,
}

impl TerminalDimensions {
    pub fn try_new(columns: u16, rows: u16) -> Result<Self, SessionError> {
        if columns == 0 || rows == 0 || columns > MAX_TERMINAL_COLUMNS || rows > MAX_TERMINAL_ROWS {
            return Err(SessionError::InvalidTerminalDimensions { columns, rows });
        }

        Ok(Self { columns, rows })
    }

    pub fn columns(self) -> u16 {
        self.columns
    }

    pub fn rows(self) -> u16 {
        self.rows
    }
}

#[cfg(test)]
mod tests {
    use super::{BackendType, SessionId, SessionSnapshot, TerminalChunk, TerminalDimensions};
    use crate::session::state::SessionState;

    #[test]
    fn terminal_dimensions_reject_zero_columns() {
        let result = TerminalDimensions::try_new(0, 24);

        assert!(result.is_err());
    }

    #[test]
    fn terminal_dimensions_accept_maximum_size() {
        let size = TerminalDimensions::try_new(1_000, 1_000).unwrap();

        assert_eq!(size.columns(), 1_000);
        assert_eq!(size.rows(), 1_000);
    }

    #[test]
    fn terminal_dimensions_reject_oversized_rows() {
        let result = TerminalDimensions::try_new(80, 1_001);

        assert!(result.is_err());
    }

    #[test]
    fn session_ids_are_unique() {
        let first = SessionId::new();
        let second = SessionId::new();

        assert_ne!(first, second);
    }

    #[test]
    fn backend_type_serializes_with_stable_name() {
        let serialized = serde_json::to_string(&BackendType::Local).unwrap();

        assert_eq!(serialized, "\"local\"");
    }

    #[test]
    fn session_snapshot_serializes_with_camel_case_fields() {
        let snapshot = SessionSnapshot {
            session_id: SessionId::new(),
            backend_type: BackendType::Local,
            state: SessionState::Ready,
            shell: Some("/bin/zsh".to_owned()),
        };

        let serialized = serde_json::to_value(snapshot).unwrap();

        assert_eq!(serialized["backendType"], "local");
        assert_eq!(serialized["state"], "ready");
        assert_eq!(serialized["shell"], "/bin/zsh");
        assert!(serialized.get("sessionId").is_some());
    }

    #[test]
    fn terminal_chunk_preserves_binary_payload_and_sequence() {
        let chunk = TerminalChunk {
            session_id: SessionId::new(),
            sequence: 1,
            payload: vec![0, 13, 255],
        };

        let serialized = serde_json::to_value(chunk).unwrap();

        assert_eq!(serialized["sequence"], 1);
        assert_eq!(serialized["payload"], serde_json::json!([0, 13, 255]));
    }
}
