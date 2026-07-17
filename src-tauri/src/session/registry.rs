use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;

use super::{
    backend::{BackendSession, SessionBackend},
    error::SessionError,
    model::{BackendType, OpenLocalSessionRequest, SessionId, SessionSnapshot, TerminalDimensions},
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
    sessions: RwLock<HashMap<SessionId, RegisteredSession>>,
}

impl SessionRegistry {
    pub fn new(backend: Arc<dyn SessionBackend>) -> Self {
        Self {
            backend,
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn open_local(
        &self,
        request: OpenLocalSessionRequest,
    ) -> Result<SessionSnapshot, SessionError> {
        let opened = self.backend.open(request).await?;
        let session_id = SessionId::new();
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

        self.sessions.write().await.insert(session_id, registered);

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
        let registered = self.sessions.write().await.remove(session_id);

        match registered {
            Some(session) => session.backend_session.close().await,
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

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use async_trait::async_trait;

    use super::SessionRegistry;
    use crate::session::{
        backend::{BackendSession, OpenedBackendSession, SessionBackend},
        error::SessionError,
        model::{OpenLocalSessionRequest, SessionId, TerminalDimensions},
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

    #[async_trait]
    impl SessionBackend for RecordingBackend {
        async fn open(
            &self,
            request: OpenLocalSessionRequest,
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
}
