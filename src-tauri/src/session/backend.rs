use std::sync::Arc;

use async_trait::async_trait;

use super::{
    error::SessionError,
    model::{
        OpenLocalSessionRequest, SessionId, SessionStateChanged, TerminalChunk, TerminalDimensions,
    },
};

#[async_trait]
pub trait TerminalOutputSink: Send + Sync {
    async fn send(&self, chunk: TerminalChunk) -> Result<(), SessionError>;

    async fn finish(&self) -> Result<(), SessionError> {
        Ok(())
    }
}

#[async_trait]
pub trait SessionLifecycleSink: Send + Sync {
    async fn send(&self, event: SessionStateChanged) -> Result<(), SessionError>;
}

pub struct BackendOpenContext {
    pub session_id: SessionId,
    pub output_sink: Arc<dyn TerminalOutputSink>,
    pub lifecycle_sink: Arc<dyn SessionLifecycleSink>,
}

pub struct DiscardOutputSink;
pub struct DiscardLifecycleSink;

#[async_trait]
impl TerminalOutputSink for DiscardOutputSink {
    async fn send(&self, _chunk: TerminalChunk) -> Result<(), SessionError> {
        Ok(())
    }
}

#[async_trait]
impl SessionLifecycleSink for DiscardLifecycleSink {
    async fn send(&self, _event: SessionStateChanged) -> Result<(), SessionError> {
        Ok(())
    }
}

pub struct OpenedBackendSession {
    pub shell: String,
    pub session: Arc<dyn BackendSession>,
}

#[async_trait]
pub trait SessionBackend: Send + Sync {
    async fn open(
        &self,
        request: OpenLocalSessionRequest,
        context: BackendOpenContext,
    ) -> Result<OpenedBackendSession, SessionError>;
}

#[async_trait]
pub trait BackendSession: Send + Sync {
    async fn write(&self, input: &[u8]) -> Result<(), SessionError>;

    async fn resize(&self, size: TerminalDimensions) -> Result<(), SessionError>;

    async fn interrupt(&self) -> Result<(), SessionError>;

    async fn close(&self) -> Result<(), SessionError>;
}
