use std::sync::Arc;

use async_trait::async_trait;

use super::{
    error::SessionError,
    model::{OpenLocalSessionRequest, TerminalDimensions},
};

pub struct OpenedBackendSession {
    pub shell: String,
    pub session: Arc<dyn BackendSession>,
}

#[async_trait]
pub trait SessionBackend: Send + Sync {
    async fn open(
        &self,
        request: OpenLocalSessionRequest,
    ) -> Result<OpenedBackendSession, SessionError>;
}

#[async_trait]
pub trait BackendSession: Send + Sync {
    async fn write(&self, input: &[u8]) -> Result<(), SessionError>;

    async fn resize(&self, size: TerminalDimensions) -> Result<(), SessionError>;

    async fn interrupt(&self) -> Result<(), SessionError>;

    async fn close(&self) -> Result<(), SessionError>;
}
