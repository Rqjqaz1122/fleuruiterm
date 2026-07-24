use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State, ipc::Channel};
use tokio::sync::{Mutex, Notify, OwnedSemaphorePermit, RwLock, Semaphore};

use crate::{
    session::{
        backend::TerminalOutputSink,
        error::SessionError,
        local_pty::LocalPtyBackend,
        model::{
            OpenLocalSessionRequest, SessionId, SessionSnapshot, SessionStateChanged,
            TerminalChunk, TerminalDimensions,
        },
        registry::SessionRegistry,
        state::SessionState,
    },
    sftp::{
        SftpConnectionProfile, SftpError, SftpRegistry, TerminalSftpBindings,
        load_saved_ssh_profile,
    },
};

pub struct AppState {
    registry: Arc<SessionRegistry>,
    output_flows: OutputFlowMap,
    sftp_bindings: TerminalSftpBindings,
    sftp_registry: SftpRegistry,
}

type OutputFlowMap = Arc<RwLock<HashMap<SessionId, Arc<OutputFlowControl>>>>;

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: Arc::new(SessionRegistry::new(Arc::new(LocalPtyBackend::new()))),
            output_flows: Arc::new(RwLock::new(HashMap::new())),
            sftp_bindings: TerminalSftpBindings::default(),
            sftp_registry: SftpRegistry::default(),
        }
    }

    pub async fn close_all(&self) -> Result<(), PublicSessionError> {
        self.registry
            .close_all()
            .await
            .map_err(PublicSessionError::from)?;
        self.output_flows.write().await.clear();
        self.sftp_bindings.clear().map_err(sftp_session_error)?;
        self.sftp_registry.close_all().map_err(sftp_session_error)?;
        Ok(())
    }

    pub async fn active_sftp_profile(
        &self,
        session_id: &SessionId,
    ) -> Result<SftpConnectionProfile, SftpError> {
        let snapshot = self
            .registry
            .snapshot(session_id)
            .await
            .map_err(|_| SftpError::SessionNotFound)?;
        if snapshot.state != SessionState::Ready {
            return Err(SftpError::SessionNotFound);
        }
        self.sftp_bindings.profile(session_id)
    }

    pub fn sftp_registry(&self) -> &SftpRegistry {
        &self.sftp_registry
    }

    pub fn reconcile_sftp_bindings(&self, settings: &serde_json::Value) -> Result<(), SftpError> {
        for session_id in self.sftp_bindings.invalidate_changed_profiles(settings)? {
            self.sftp_registry.close_for_terminal(&session_id)?;
        }
        Ok(())
    }

    async fn bind_sftp_profile(
        &self,
        session_id: SessionId,
        profile: SftpConnectionProfile,
    ) -> Result<(), PublicSessionError> {
        let snapshot = self
            .registry
            .snapshot(&session_id)
            .await
            .map_err(PublicSessionError::from)?;
        if snapshot.state != SessionState::Ready {
            return Err(saved_connection_error());
        }
        self.sftp_bindings
            .insert(session_id.clone(), profile)
            .map_err(sftp_session_error)?;
        if self.registry.snapshot(&session_id).await.is_err() {
            self.close_terminal_sftp(&session_id)?;
            return Err(saved_connection_error());
        }
        Ok(())
    }

    fn close_terminal_sftp(&self, session_id: &SessionId) -> Result<(), PublicSessionError> {
        self.sftp_bindings
            .remove(session_id)
            .map_err(sftp_session_error)?;
        self.sftp_registry
            .close_for_terminal(session_id)
            .map_err(sftp_session_error)
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
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    connection_profile_id: Option<String>,
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
    flow: Arc<OutputFlowControl>,
}

struct ChannelLifecycleSink {
    channel: Channel<SessionStateChanged>,
    output_flows: OutputFlowMap,
    sftp_bindings: TerminalSftpBindings,
    sftp_registry: SftpRegistry,
}

#[async_trait]
impl crate::session::backend::SessionLifecycleSink for ChannelLifecycleSink {
    async fn send(&self, event: SessionStateChanged) -> Result<(), SessionError> {
        if matches!(
            event.state,
            crate::session::state::SessionState::Closed
                | crate::session::state::SessionState::Failed
        ) {
            self.output_flows.write().await.remove(&event.session_id);
            self.sftp_bindings.remove(&event.session_id).map_err(|_| {
                SessionError::BackendFailure {
                    operation: "remove SFTP terminal binding",
                    message: "SFTP binding state is unavailable".to_owned(),
                }
            })?;
            self.sftp_registry
                .close_for_terminal(&event.session_id)
                .map_err(|_| SessionError::BackendFailure {
                    operation: "close terminal SFTP sessions",
                    message: "SFTP registry state is unavailable".to_owned(),
                })?;
        }
        self.channel
            .send(event)
            .map_err(|_| SessionError::OutputChannelClosed)
    }
}

#[async_trait]
impl TerminalOutputSink for ChannelOutputSink {
    async fn send(&self, chunk: TerminalChunk) -> Result<(), SessionError> {
        self.flow.reserve(chunk.sequence).await?;
        if self.channel.send(chunk.clone()).is_err() {
            self.flow.release(chunk.sequence).await;
            return Err(SessionError::OutputChannelClosed);
        }
        Ok(())
    }

    async fn finish(&self) -> Result<(), SessionError> {
        self.flow.wait_for_drain().await;
        Ok(())
    }
}

struct OutputFlowControl {
    permits: Arc<Semaphore>,
    in_flight: Mutex<BTreeMap<u64, OwnedSemaphorePermit>>,
    drained: Notify,
}

impl OutputFlowControl {
    fn new(max_in_flight: usize) -> Self {
        Self {
            permits: Arc::new(Semaphore::new(max_in_flight)),
            in_flight: Mutex::new(BTreeMap::new()),
            drained: Notify::new(),
        }
    }

    async fn reserve(&self, sequence: u64) -> Result<(), SessionError> {
        let permit = Arc::clone(&self.permits)
            .acquire_owned()
            .await
            .map_err(|error| SessionError::BackendFailure {
                operation: "reserve terminal output window",
                message: error.to_string(),
            })?;
        self.in_flight.lock().await.insert(sequence, permit);
        Ok(())
    }

    async fn acknowledge(&self, sequence: u64) -> Result<(), SessionError> {
        let mut in_flight = self.in_flight.lock().await;
        let expected_sequence = in_flight.keys().next().copied();
        if expected_sequence != Some(sequence) {
            return Err(SessionError::BackendFailure {
                operation: "acknowledge terminal output",
                message: format!(
                    "expected sequence {expected_sequence:?}, received sequence {sequence}"
                ),
            });
        }
        in_flight.remove(&sequence);
        if in_flight.is_empty() {
            self.drained.notify_waiters();
        }
        Ok(())
    }

    async fn release(&self, sequence: u64) {
        let mut in_flight = self.in_flight.lock().await;
        in_flight.remove(&sequence);
        if in_flight.is_empty() {
            self.drained.notify_waiters();
        }
    }

    async fn wait_for_drain(&self) {
        loop {
            let notified = self.drained.notified();
            if self.in_flight.lock().await.is_empty() {
                return;
            }
            notified.await;
        }
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
            message: public_message(&error).to_owned(),
        }
    }
}

#[tauri::command]
pub async fn session_open_local(
    app: AppHandle,
    state: State<'_, AppState>,
    request: OpenLocalSessionInput,
    on_output: Channel<TerminalChunk>,
    on_state: Channel<SessionStateChanged>,
) -> Result<SessionSnapshot, PublicSessionError> {
    let sftp_profile = resolve_sftp_profile(&app, &request)?;
    let snapshot = open_local_session(&state, request, on_output, on_state).await?;
    if let Some(profile) = sftp_profile {
        state
            .bind_sftp_profile(snapshot.session_id.clone(), profile)
            .await?;
    }
    Ok(snapshot)
}

async fn open_local_session(
    state: &AppState,
    request: OpenLocalSessionInput,
    on_output: Channel<TerminalChunk>,
    on_state: Channel<SessionStateChanged>,
) -> Result<SessionSnapshot, PublicSessionError> {
    let dimensions = validate_dimensions(request.columns, request.rows)?;
    let session_id = SessionId::new();
    let flow = Arc::new(OutputFlowControl::new(8));
    state
        .output_flows
        .write()
        .await
        .insert(session_id.clone(), Arc::clone(&flow));
    let output_sink = Arc::new(ChannelOutputSink {
        channel: on_output,
        flow,
    });
    let open_result = state
        .registry
        .open_local_with_id(
            session_id.clone(),
            OpenLocalSessionRequest {
                shell: request.shell,
                args: request.args,
                cwd: request.cwd,
                dimensions,
            },
            output_sink,
            Arc::new(ChannelLifecycleSink {
                channel: on_state,
                output_flows: Arc::clone(&state.output_flows),
                sftp_bindings: state.sftp_bindings.clone(),
                sftp_registry: state.sftp_registry.clone(),
            }),
        )
        .await;
    if open_result.is_err() {
        state.output_flows.write().await.remove(&session_id);
    }
    open_result.map_err(PublicSessionError::from)
}

#[tauri::command]
pub async fn session_ack_output(
    state: State<'_, AppState>,
    session_id: SessionId,
    sequence: u64,
) -> Result<(), PublicSessionError> {
    let flow = state
        .output_flows
        .read()
        .await
        .get(&session_id)
        .cloned()
        .ok_or_else(|| PublicSessionError::from(SessionError::SessionNotFound { session_id }))?;
    flow.acknowledge(sequence)
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
        .map_err(PublicSessionError::from)?;
    state.output_flows.write().await.remove(&session_id);
    state.close_terminal_sftp(&session_id)?;
    Ok(())
}

fn resolve_sftp_profile(
    app: &AppHandle,
    request: &OpenLocalSessionInput,
) -> Result<Option<SftpConnectionProfile>, PublicSessionError> {
    let Some(connection_id) = request.connection_profile_id.as_deref() else {
        return Ok(None);
    };
    let profile = load_saved_ssh_profile(app, connection_id).map_err(sftp_session_error)?;
    if !profile.matches_terminal_command(request.shell.as_deref(), &request.args) {
        return Err(saved_connection_error());
    }
    Ok(Some(profile))
}

fn saved_connection_error() -> PublicSessionError {
    PublicSessionError {
        code: "SAVED_CONNECTION_UNAVAILABLE",
        message: "The saved SSH connection is unavailable".to_owned(),
    }
}

fn sftp_session_error(_error: SftpError) -> PublicSessionError {
    PublicSessionError {
        code: "SFTP_STATE_UNAVAILABLE",
        message: "The terminal SFTP state is unavailable".to_owned(),
    }
}

fn public_message(error: &SessionError) -> &'static str {
    match error {
        SessionError::InvalidStateTransition { .. } => {
            "The terminal session changed state unexpectedly"
        }
        SessionError::InvalidTerminalDimensions { .. } => "The terminal size is invalid",
        SessionError::SessionNotFound { .. } => "The terminal session is no longer available",
        SessionError::InputTooLarge { .. } => "Terminal input is too large",
        SessionError::ShellUnavailable { .. } => "The selected shell is unavailable",
        SessionError::OutputChannelClosed => "The terminal output connection was closed",
        SessionError::BackendFailure { .. } => "The local terminal operation failed",
    }
}

fn validate_dimensions(columns: u16, rows: u16) -> Result<TerminalDimensions, SessionError> {
    TerminalDimensions::try_new(columns, rows)
}

#[cfg(test)]
mod tests {
    use std::{sync::Arc, time::Duration};

    use tauri::ipc::Channel;
    use tokio::sync::mpsc;

    use super::{
        AppState, OpenLocalSessionInput, OutputFlowControl, PublicSessionError, open_local_session,
        validate_dimensions,
    };
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
        assert_eq!(public.message, "Terminal input is too large");
    }

    #[test]
    fn missing_session_maps_to_stable_public_code() {
        let public = PublicSessionError::from(SessionError::SessionNotFound {
            session_id: crate::session::model::SessionId::new(),
        });

        assert_eq!(public.code, "SESSION_NOT_FOUND");
    }

    #[tokio::test]
    async fn output_flow_waits_until_the_previous_sequence_is_acknowledged() {
        let flow = Arc::new(OutputFlowControl::new(1));
        flow.reserve(1).await.unwrap();
        let waiting_flow = Arc::clone(&flow);
        let waiting = tokio::spawn(async move { waiting_flow.reserve(2).await });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());

        flow.acknowledge(1).await.unwrap();

        tokio::time::timeout(Duration::from_secs(1), waiting)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn output_flow_rejects_a_forward_acknowledgement() {
        let flow = OutputFlowControl::new(2);
        flow.reserve(1).await.unwrap();
        flow.reserve(2).await.unwrap();

        let result = flow.acknowledge(2).await;

        assert!(result.is_err());
        flow.acknowledge(1).await.unwrap();
        flow.acknowledge(2).await.unwrap();
        flow.wait_for_drain().await;
    }

    #[tokio::test]
    #[cfg_attr(
        target_os = "windows",
        ignore = "PTY output delivery is flaky under Windows CI shells"
    )]
    async fn startup_output_observes_a_registered_flow() {
        let state = AppState::new();
        let output_flows = Arc::clone(&state.output_flows);
        let (output_sender, mut output_receiver) = mpsc::unbounded_channel();
        let output_channel = Channel::new(move |_| {
            output_sender
                .send(
                    output_flows
                        .try_read()
                        .map(|flows| !flows.is_empty())
                        .unwrap_or(false),
                )
                .unwrap();
            Ok(())
        });
        let (lifecycle_sender, mut lifecycle_receiver) = mpsc::unbounded_channel();
        let lifecycle_channel = Channel::new(move |_| {
            lifecycle_sender.send(()).unwrap();
            Ok(())
        });

        let snapshot = open_local_session(
            &state,
            OpenLocalSessionInput {
                shell: Some(test_echo_shell()),
                args: test_echo_args(),
                cwd: None,
                connection_profile_id: None,
                columns: 80,
                rows: 24,
            },
            output_channel,
            lifecycle_channel,
        )
        .await
        .unwrap();
        let flow_was_registered =
            tokio::time::timeout(Duration::from_secs(3), output_receiver.recv())
                .await
                .unwrap()
                .unwrap();

        assert!(flow_was_registered);
        let flow = state
            .output_flows
            .read()
            .await
            .get(&snapshot.session_id)
            .cloned()
            .unwrap();
        flow.acknowledge(1).await.unwrap();
        tokio::time::timeout(Duration::from_secs(3), lifecycle_receiver.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(state.output_flows.read().await.is_empty());
    }

    fn test_echo_shell() -> String {
        #[cfg(target_os = "windows")]
        {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_owned())
        }

        #[cfg(not(target_os = "windows"))]
        {
            "/bin/echo".to_owned()
        }
    }

    fn test_echo_args() -> Vec<String> {
        #[cfg(target_os = "windows")]
        {
            vec!["/C".to_owned(), "echo".to_owned(), "ready".to_owned()]
        }

        #[cfg(not(target_os = "windows"))]
        {
            vec!["ready".to_owned()]
        }
    }
}
