use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{State, ipc::Channel};

use crate::session::{
    backend::TerminalOutputSink,
    error::SessionError,
    local_pty::LocalPtyBackend,
    model::{
        OpenLocalSessionRequest, SessionId, SessionSnapshot, TerminalChunk, TerminalDimensions,
    },
    registry::SessionRegistry,
};

pub struct AppState {
    registry: Arc<SessionRegistry>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(SessionRegistry::new(Arc::new(LocalPtyBackend::new()))),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenLocalSessionInput {
    shell: Option<String>,
    columns: u16,
    rows: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicSessionError {
    pub code: &'static str,
    pub message: String,
}

struct ChannelOutputSink {
    channel: Channel<TerminalChunk>,
}

impl TerminalOutputSink for ChannelOutputSink {
    fn send(&self, chunk: TerminalChunk) -> Result<(), SessionError> {
        self.channel
            .send(chunk)
            .map_err(|_| SessionError::OutputChannelClosed)
    }
}

impl From<SessionError> for PublicSessionError {
    fn from(error: SessionError) -> Self {
        let code = match &error {
            SessionError::InvalidStateTransition { .. } => "INVALID_STATE_TRANSITION",
            SessionError::InvalidTerminalDimensions { .. } => "INVALID_TERMINAL_DIMENSIONS",
            SessionError::SessionNotFound { .. } => "SESSION_NOT_FOUND",
            SessionError::InputTooLarge { .. } => "INPUT_TOO_LARGE",
            SessionError::ShellUnavailable { .. } => "SHELL_UNAVAILABLE",
            SessionError::OutputChannelClosed => "OUTPUT_CHANNEL_CLOSED",
            SessionError::BackendFailure { .. } => "BACKEND_FAILURE",
        };

        Self {
            code,
            message: error.to_string(),
        }
    }
}

#[tauri::command]
pub async fn session_open_local(
    state: State<'_, AppState>,
    request: OpenLocalSessionInput,
    on_output: Channel<TerminalChunk>,
) -> Result<SessionSnapshot, PublicSessionError> {
    let dimensions = validate_dimensions(request.columns, request.rows)?;
    let output_sink = Arc::new(ChannelOutputSink { channel: on_output });
    state
        .registry
        .open_local_with_output(
            OpenLocalSessionRequest {
                shell: request.shell,
                dimensions,
            },
            output_sink,
        )
        .await
        .map_err(PublicSessionError::from)
}

#[tauri::command]
pub async fn session_write(
    state: State<'_, AppState>,
    session_id: SessionId,
    input: Vec<u8>,
) -> Result<(), PublicSessionError> {
    state
        .registry
        .write(&session_id, &input)
        .await
        .map_err(PublicSessionError::from)
}

#[tauri::command]
pub async fn session_resize(
    state: State<'_, AppState>,
    session_id: SessionId,
    columns: u16,
    rows: u16,
) -> Result<(), PublicSessionError> {
    let dimensions = validate_dimensions(columns, rows)?;
    state
        .registry
        .resize(&session_id, dimensions)
        .await
        .map_err(PublicSessionError::from)
}

#[tauri::command]
pub async fn session_interrupt(
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<(), PublicSessionError> {
    state
        .registry
        .interrupt(&session_id)
        .await
        .map_err(PublicSessionError::from)
}

#[tauri::command]
pub async fn session_close(
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<(), PublicSessionError> {
    state
        .registry
        .close(&session_id)
        .await
        .map_err(PublicSessionError::from)
}

fn validate_dimensions(columns: u16, rows: u16) -> Result<TerminalDimensions, SessionError> {
    TerminalDimensions::try_new(columns, rows)
}

#[cfg(test)]
mod tests {
    use super::{PublicSessionError, validate_dimensions};
    use crate::session::error::SessionError;

    #[test]
    fn invalid_dimensions_are_rejected_before_registry_dispatch() {
        let result = validate_dimensions(0, 24);

        assert!(matches!(
            result,
            Err(SessionError::InvalidTerminalDimensions { .. })
        ));
    }

    #[test]
    fn input_size_error_maps_to_stable_public_code() {
        let public = PublicSessionError::from(SessionError::InputTooLarge {
            actual: 65_537,
            maximum: 65_536,
        });

        assert_eq!(public.code, "INPUT_TOO_LARGE");
        assert!(public.message.contains("65536"));
    }

    #[test]
    fn missing_session_maps_to_stable_public_code() {
        let public = PublicSessionError::from(SessionError::SessionNotFound {
            session_id: crate::session::model::SessionId::new(),
        });

        assert_eq!(public.code, "SESSION_NOT_FOUND");
    }
}
