use std::{collections::HashMap, sync::Arc};

use tokio::sync::{Mutex, RwLock};

use super::{
    backend::{
        BackendOpenContext, BackendSession, DiscardLifecycleSink, DiscardOutputSink,
        SessionBackend, SessionLifecycleSink, TerminalOutputSink,
    },
    error::SessionError,
    model::{
        BackendType, OpenLocalSessionRequest, SessionId, SessionSnapshot, SessionStateChanged,
        TerminalDimensions,
    },
    state::SessionState,
};

const MAX_INPUT_BYTES: usize = 64 * 1024;

#[derive(Clone)]
struct RegisteredSession {
    snapshot: SessionSnapshot,
    backend_session: Arc<dyn BackendSession>,
}

pub struct SessionRegistry {
    backend: Arc<dyn SessionBackend>,
    sessions: Arc<RwLock<HashMap<SessionId, RegisteredSession>>>,
}

impl SessionRegistry {
    pub fn new(backend: Arc<dyn SessionBackend>) -> Self {
        Self {
            backend,
            sessions: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub async fn open_local(
        &self,
        request: OpenLocalSessionRequest,
    ) -> Result<SessionSnapshot, SessionError> {
        self.open_local_with_output(
            request,
            Arc::new(DiscardOutputSink),
            Arc::new(DiscardLifecycleSink),
        )
        .await
    }

    pub async fn open_local_with_output(
        &self,
        request: OpenLocalSessionRequest,
        output_sink: Arc<dyn TerminalOutputSink>,
        lifecycle_sink: Arc<dyn SessionLifecycleSink>,
    ) -> Result<SessionSnapshot, SessionError> {
        self.open_local_with_id(SessionId::new(), request, output_sink, lifecycle_sink)
            .await
    }

    pub async fn open_local_with_id(
        &self,
        session_id: SessionId,
        request: OpenLocalSessionRequest,
        output_sink: Arc<dyn TerminalOutputSink>,
        lifecycle_sink: Arc<dyn SessionLifecycleSink>,
    ) -> Result<SessionSnapshot, SessionError> {
        let registry_lifecycle_sink = Arc::new(RegistryLifecycleSink {
            sessions: Arc::clone(&self.sessions),
            external: lifecycle_sink,
            registration: Mutex::new(LifecycleRegistration::default()),
        });
        let context = BackendOpenContext {
            session_id: session_id.clone(),
            output_sink,
            lifecycle_sink: registry_lifecycle_sink.clone(),
        };
        let opened = self.backend.open(request, context).await?;
        let snapshot = SessionSnapshot {
            session_id: session_id.clone(),
            backend_type: BackendType::Local,
            state: SessionState::Ready,
            shell: Some(opened.shell),
        };
        let registered = RegisteredSession {
            snapshot: snapshot.clone(),
            backend_session: opened.session,
        };

        let snapshot = registry_lifecycle_sink
            .register(session_id, registered)
            .await;

        Ok(snapshot)
    }

    pub async fn snapshot(&self, session_id: &SessionId) -> Result<SessionSnapshot, SessionError> {
        self.registered_session(session_id)
            .await
            .map(|registered| registered.snapshot)
    }

    pub async fn write(&self, session_id: &SessionId, input: &[u8]) -> Result<(), SessionError> {
        if input.len() > MAX_INPUT_BYTES {
            return Err(SessionError::InputTooLarge {
                actual: input.len(),
                maximum: MAX_INPUT_BYTES,
            });
        }

        self.registered_session(session_id)
            .await?
            .backend_session
            .write(input)
            .await
    }

    pub async fn resize(
        &self,
        session_id: &SessionId,
        size: TerminalDimensions,
    ) -> Result<(), SessionError> {
        self.registered_session(session_id)
            .await?
            .backend_session
            .resize(size)
            .await
    }

    pub async fn interrupt(&self, session_id: &SessionId) -> Result<(), SessionError> {
        self.registered_session(session_id)
            .await?
            .backend_session
            .interrupt()
            .await
    }

    pub async fn close(&self, session_id: &SessionId) -> Result<(), SessionError> {
        let registered = match self.registered_session(session_id).await {
            Ok(session) => session,
            Err(SessionError::SessionNotFound { .. }) => return Ok(()),
            Err(error) => return Err(error),
        };
        registered.backend_session.close().await?;
        self.sessions.write().await.remove(session_id);
        Ok(())
    }

    pub async fn close_all(&self) -> Result<(), SessionError> {
        let session_ids = self
            .sessions
            .read()
            .await
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        let mut first_error = None;
        for session_id in session_ids {
            if let Err(error) = self.close(&session_id).await {
                first_error.get_or_insert(error);
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    async fn registered_session(
        &self,
        session_id: &SessionId,
    ) -> Result<RegisteredSession, SessionError> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| SessionError::SessionNotFound {
                session_id: session_id.clone(),
            })
    }
}

struct RegistryLifecycleSink {
    sessions: Arc<RwLock<HashMap<SessionId, RegisteredSession>>>,
    external: Arc<dyn SessionLifecycleSink>,
    registration: Mutex<LifecycleRegistration>,
}

#[derive(Default)]
struct LifecycleRegistration {
    registered: bool,
    pending_state: Option<SessionState>,
}

impl RegistryLifecycleSink {
    async fn register(
        &self,
        session_id: SessionId,
        mut registered: RegisteredSession,
    ) -> SessionSnapshot {
        let mut registration = self.registration.lock().await;
        if let Some(state) = registration.pending_state {
            registered.snapshot.state = state;
        }
        let snapshot = registered.snapshot.clone();
        if !is_terminal_state(registered.snapshot.state) {
            self.sessions.write().await.insert(session_id, registered);
        }
        registration.registered = true;
        snapshot
    }
}

#[async_trait::async_trait]
impl SessionLifecycleSink for RegistryLifecycleSink {
    async fn send(&self, event: SessionStateChanged) -> Result<(), SessionError> {
        let mut registration = self.registration.lock().await;
        if !registration.registered {
            registration.pending_state = Some(event.state);
        } else {
            let mut sessions = self.sessions.write().await;
            if let Some(registered) = sessions.get_mut(&event.session_id) {
                registered.snapshot.state = event.state;
            }
            if is_terminal_state(event.state) {
                sessions.remove(&event.session_id);
            }
        }
        drop(registration);
        self.external.send(event).await
    }
}

fn is_terminal_state(state: SessionState) -> bool {
    matches!(state, SessionState::Closed | SessionState::Failed)
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;
    use tokio::sync::mpsc;

    use super::SessionRegistry;
    use crate::session::{
        backend::{
            BackendOpenContext, BackendSession, OpenedBackendSession, SessionBackend,
            SessionLifecycleSink,
        },
        error::SessionError,
        local_pty::LocalPtyBackend,
        model::{OpenLocalSessionRequest, SessionId, SessionStateChanged, TerminalDimensions},
        state::SessionState,
    };

    #[derive(Clone, Default)]
    struct RecordingBackend {
        state: Arc<Mutex<RecordingState>>,
    }

    #[derive(Default)]
    struct RecordingState {
        closed_sessions: usize,
        writes: Vec<Vec<u8>>,
        sizes: Vec<TerminalDimensions>,
    }

    struct RecordingSession {
        state: Arc<Mutex<RecordingState>>,
    }

    struct ImmediatelyClosingBackend;

    struct LifecycleChannelSink {
        sender: mpsc::UnboundedSender<SessionStateChanged>,
    }

    #[async_trait]
    impl SessionLifecycleSink for LifecycleChannelSink {
        async fn send(&self, event: SessionStateChanged) -> Result<(), SessionError> {
            self.sender
                .send(event)
                .map_err(|_| SessionError::OutputChannelClosed)
        }
    }

    #[async_trait]
    impl SessionBackend for RecordingBackend {
        async fn open(
            &self,
            request: OpenLocalSessionRequest,
            _context: BackendOpenContext,
        ) -> Result<OpenedBackendSession, SessionError> {
            Ok(OpenedBackendSession {
                shell: request
                    .shell
                    .unwrap_or_else(|| "/bin/test-shell".to_owned()),
                session: Arc::new(RecordingSession {
                    state: Arc::clone(&self.state),
                }),
            })
        }
    }

    #[async_trait]
    impl SessionBackend for ImmediatelyClosingBackend {
        async fn open(
            &self,
            request: OpenLocalSessionRequest,
            context: BackendOpenContext,
        ) -> Result<OpenedBackendSession, SessionError> {
            context
                .lifecycle_sink
                .send(SessionStateChanged {
                    session_id: context.session_id,
                    state: SessionState::Closed,
                })
                .await?;
            Ok(OpenedBackendSession {
                shell: request
                    .shell
                    .unwrap_or_else(|| "/bin/test-shell".to_owned()),
                session: Arc::new(RecordingSession {
                    state: Arc::new(Mutex::new(RecordingState::default())),
                }),
            })
        }
    }

    #[async_trait]
    impl BackendSession for RecordingSession {
        async fn write(&self, input: &[u8]) -> Result<(), SessionError> {
            self.state.lock().unwrap().writes.push(input.to_vec());
            Ok(())
        }

        async fn resize(&self, size: TerminalDimensions) -> Result<(), SessionError> {
            self.state.lock().unwrap().sizes.push(size);
            Ok(())
        }

        async fn interrupt(&self) -> Result<(), SessionError> {
            Ok(())
        }

        async fn close(&self) -> Result<(), SessionError> {
            self.state.lock().unwrap().closed_sessions += 1;
            Ok(())
        }
    }

    fn open_request() -> OpenLocalSessionRequest {
        OpenLocalSessionRequest {
            shell: None,
            args: Vec::new(),
            cwd: None,
            dimensions: TerminalDimensions::try_new(80, 24).unwrap(),
        }
    }

    #[tokio::test]
    async fn closing_a_registered_session_removes_it() {
        let backend = RecordingBackend::default();
        let registry = SessionRegistry::new(Arc::new(backend.clone()));
        let snapshot = registry.open_local(open_request()).await.unwrap();

        registry.close(&snapshot.session_id).await.unwrap();

        assert!(registry.snapshot(&snapshot.session_id).await.is_err());
        assert_eq!(backend.state.lock().unwrap().closed_sessions, 1);
    }

    #[tokio::test]
    async fn duplicate_close_is_idempotent() {
        let backend = RecordingBackend::default();
        let registry = SessionRegistry::new(Arc::new(backend.clone()));
        let snapshot = registry.open_local(open_request()).await.unwrap();

        registry.close(&snapshot.session_id).await.unwrap();
        registry.close(&snapshot.session_id).await.unwrap();

        assert_eq!(backend.state.lock().unwrap().closed_sessions, 1);
    }

    #[tokio::test]
    async fn unknown_session_rejects_write() {
        let registry = SessionRegistry::new(Arc::new(RecordingBackend::default()));

        let result = registry.write(&SessionId::new(), b"pwd\n").await;

        assert!(matches!(result, Err(SessionError::SessionNotFound { .. })));
    }

    #[tokio::test]
    async fn oversized_input_is_rejected_before_backend_dispatch() {
        let backend = RecordingBackend::default();
        let registry = SessionRegistry::new(Arc::new(backend.clone()));
        let snapshot = registry.open_local(open_request()).await.unwrap();
        let oversized_input = vec![b'x'; 65_537];

        let result = registry.write(&snapshot.session_id, &oversized_input).await;

        assert!(matches!(result, Err(SessionError::InputTooLarge { .. })));
        assert!(backend.state.lock().unwrap().writes.is_empty());
    }

    #[tokio::test]
    async fn independent_sessions_dispatch_input_and_resize() {
        let backend = RecordingBackend::default();
        let registry = SessionRegistry::new(Arc::new(backend.clone()));
        let first = registry.open_local(open_request()).await.unwrap();
        let second = registry.open_local(open_request()).await.unwrap();
        let resized = TerminalDimensions::try_new(120, 40).unwrap();

        registry.write(&first.session_id, b"first\n").await.unwrap();
        registry.resize(&second.session_id, resized).await.unwrap();

        let state = backend.state.lock().unwrap();
        assert_eq!(state.writes, vec![b"first\n".to_vec()]);
        assert_eq!(state.sizes, vec![resized]);
    }

    #[tokio::test]
    async fn close_all_releases_every_registered_session() {
        let backend = RecordingBackend::default();
        let registry = SessionRegistry::new(Arc::new(backend.clone()));
        let first = registry.open_local(open_request()).await.unwrap();
        let second = registry.open_local(open_request()).await.unwrap();

        registry.close_all().await.unwrap();

        assert!(registry.snapshot(&first.session_id).await.is_err());
        assert!(registry.snapshot(&second.session_id).await.is_err());
        assert_eq!(backend.state.lock().unwrap().closed_sessions, 2);
    }

    #[tokio::test]
    #[cfg_attr(target_os = "windows", ignore = "interactive PTY input is flaky under Windows CI shells")]
    async fn natural_shell_exit_removes_the_registered_session() {
        let registry = SessionRegistry::new(Arc::new(LocalPtyBackend::new()));
        let (lifecycle_sender, mut lifecycle_receiver) = mpsc::unbounded_channel();
        let request = OpenLocalSessionRequest {
            shell: Some(test_shell()),
            args: Vec::new(),
            cwd: None,
            dimensions: TerminalDimensions::try_new(80, 24).unwrap(),
        };
        let snapshot = registry
            .open_local_with_output(
                request,
                Arc::new(crate::session::backend::DiscardOutputSink),
                Arc::new(LifecycleChannelSink {
                    sender: lifecycle_sender,
                }),
            )
            .await
            .unwrap();

        registry
            .write(&snapshot.session_id, test_exit_command().as_bytes())
            .await
            .unwrap();
        let lifecycle_event =
            tokio::time::timeout(std::time::Duration::from_secs(3), lifecycle_receiver.recv())
                .await
                .unwrap()
                .unwrap();

        assert_eq!(lifecycle_event.session_id, snapshot.session_id);
        assert_eq!(lifecycle_event.state, SessionState::Closed);
        assert!(matches!(
            registry.snapshot(&snapshot.session_id).await,
            Err(SessionError::SessionNotFound { .. })
        ));
    }

    fn test_shell() -> String {
        #[cfg(target_os = "windows")]
        {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_owned())
        }

        #[cfg(not(target_os = "windows"))]
        {
            "/bin/sh".to_owned()
        }
    }

    fn test_exit_command() -> String {
        #[cfg(target_os = "windows")]
        {
            "exit\r\n".to_owned()
        }

        #[cfg(not(target_os = "windows"))]
        {
            "exit\n".to_owned()
        }
    }

    #[tokio::test]
    async fn exit_during_open_does_not_leave_a_registered_session() {
        let registry = SessionRegistry::new(Arc::new(ImmediatelyClosingBackend));
        let (lifecycle_sender, mut lifecycle_receiver) = mpsc::unbounded_channel();

        let snapshot = registry
            .open_local_with_output(
                open_request(),
                Arc::new(crate::session::backend::DiscardOutputSink),
                Arc::new(LifecycleChannelSink {
                    sender: lifecycle_sender,
                }),
            )
            .await
            .unwrap();
        let lifecycle_event = lifecycle_receiver.recv().await.unwrap();

        assert_eq!(lifecycle_event.state, SessionState::Closed);
        assert_eq!(snapshot.state, SessionState::Closed);
        assert!(matches!(
            registry.snapshot(&snapshot.session_id).await,
            Err(SessionError::SessionNotFound { .. })
        ));
    }
}
