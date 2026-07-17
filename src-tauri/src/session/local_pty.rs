use std::{
    env,
    io::{ErrorKind, Read, Write},
    path::Path,
    sync::{Arc, Mutex},
};

use async_trait::async_trait;
use portable_pty::{Child, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::{sync::mpsc, task::JoinHandle};

use super::{
    backend::{
        BackendOpenContext, BackendSession, OpenedBackendSession, SessionBackend,
        TerminalOutputSink,
    },
    error::SessionError,
    model::{OpenLocalSessionRequest, SessionId, TerminalChunk, TerminalDimensions},
};

const OUTPUT_QUEUE_CAPACITY: usize = 32;
const OUTPUT_BUFFER_BYTES: usize = 64 * 1024;

pub struct LocalPtyBackend;

impl LocalPtyBackend {
    pub fn new() -> Self {
        Self
    }
}

impl Default for LocalPtyBackend {
    fn default() -> Self {
        Self::new()
    }
}

struct LocalPtySession {
    master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    child: Arc<Mutex<Option<Box<dyn Child + Send + Sync>>>>,
    output_task: Mutex<Option<JoinHandle<Result<(), SessionError>>>>,
}

struct CreatedPty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
}

#[async_trait]
impl SessionBackend for LocalPtyBackend {
    async fn open(
        &self,
        request: OpenLocalSessionRequest,
        context: BackendOpenContext,
    ) -> Result<OpenedBackendSession, SessionError> {
        let shell = resolve_shell(request.shell)?;
        let dimensions = request.dimensions;
        let shell_for_spawn = shell.clone();
        let created = tokio::task::spawn_blocking(move || create_pty(&shell_for_spawn, dimensions))
            .await
            .map_err(|error| backend_failure("spawn PTY task", error))??;

        let (sender, receiver) = mpsc::channel(OUTPUT_QUEUE_CAPACITY);
        spawn_output_reader(created.reader, sender);
        let output_task = tokio::spawn(forward_output(
            receiver,
            context.session_id,
            context.output_sink,
        ));
        let session = LocalPtySession {
            master: Arc::new(Mutex::new(Some(created.master))),
            writer: Arc::new(Mutex::new(Some(created.writer))),
            child: Arc::new(Mutex::new(Some(created.child))),
            output_task: Mutex::new(Some(output_task)),
        };

        Ok(OpenedBackendSession {
            shell,
            session: Arc::new(session),
        })
    }
}

#[async_trait]
impl BackendSession for LocalPtySession {
    async fn write(&self, input: &[u8]) -> Result<(), SessionError> {
        let writer = Arc::clone(&self.writer);
        let input = input.to_vec();
        tokio::task::spawn_blocking(move || {
            let mut guard = writer
                .lock()
                .map_err(|error| backend_failure("lock PTY writer", error))?;
            let writer = guard.as_mut().ok_or_else(|| SessionError::BackendFailure {
                operation: "write PTY input",
                message: "session is already closed".to_owned(),
            })?;
            writer
                .write_all(&input)
                .map_err(|error| backend_failure("write PTY input", error))?;
            writer
                .flush()
                .map_err(|error| backend_failure("flush PTY input", error))
        })
        .await
        .map_err(|error| backend_failure("join PTY write task", error))?
    }

    async fn resize(&self, size: TerminalDimensions) -> Result<(), SessionError> {
        let master = Arc::clone(&self.master);
        tokio::task::spawn_blocking(move || {
            let guard = master
                .lock()
                .map_err(|error| backend_failure("lock PTY master", error))?;
            let master = guard.as_ref().ok_or_else(|| SessionError::BackendFailure {
                operation: "resize PTY",
                message: "session is already closed".to_owned(),
            })?;
            master
                .resize(to_pty_size(size))
                .map_err(|error| backend_failure("resize PTY", error))
        })
        .await
        .map_err(|error| backend_failure("join PTY resize task", error))?
    }

    async fn interrupt(&self) -> Result<(), SessionError> {
        self.write(&[3]).await
    }

    async fn close(&self) -> Result<(), SessionError> {
        let master = Arc::clone(&self.master);
        let writer = Arc::clone(&self.writer);
        let child = Arc::clone(&self.child);
        tokio::task::spawn_blocking(move || {
            writer
                .lock()
                .map_err(|error| backend_failure("lock PTY writer", error))?
                .take();
            master
                .lock()
                .map_err(|error| backend_failure("lock PTY master", error))?
                .take();
            if let Some(mut child) = child
                .lock()
                .map_err(|error| backend_failure("lock PTY child", error))?
                .take()
            {
                if child
                    .try_wait()
                    .map_err(|error| backend_failure("poll PTY child", error))?
                    .is_none()
                {
                    child
                        .kill()
                        .map_err(|error| backend_failure("kill PTY child", error))?;
                }
                child
                    .wait()
                    .map_err(|error| backend_failure("wait for PTY child", error))?;
            }
            Ok(())
        })
        .await
        .map_err(|error| backend_failure("join PTY close task", error))??;

        if let Some(task) = self
            .output_task
            .lock()
            .map_err(|error| backend_failure("lock output task", error))?
            .take()
        {
            task.abort();
        }

        Ok(())
    }
}

fn resolve_shell(requested: Option<String>) -> Result<String, SessionError> {
    let shell = requested.unwrap_or_else(default_shell);
    if Path::new(&shell).is_file() {
        Ok(shell)
    } else {
        Err(SessionError::ShellUnavailable { shell })
    }
}

fn default_shell() -> String {
    env::var("SHELL")
        .ok()
        .filter(|shell| Path::new(shell).is_file())
        .unwrap_or_else(platform_default_shell)
}

#[cfg(target_os = "windows")]
fn platform_default_shell() -> String {
    env::var("COMSPEC").unwrap_or_else(|_| {
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe".to_owned()
    })
}

#[cfg(not(target_os = "windows"))]
fn platform_default_shell() -> String {
    "/bin/sh".to_owned()
}

fn create_pty(shell: &str, dimensions: TerminalDimensions) -> Result<CreatedPty, SessionError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(to_pty_size(dimensions))
        .map_err(|error| backend_failure("open PTY", error))?;
    let mut command = CommandBuilder::new(shell);
    command.env("TERM", "xterm-256color");
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| backend_failure("spawn shell", error))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| backend_failure("clone PTY reader", error))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| backend_failure("take PTY writer", error))?;

    Ok(CreatedPty {
        master: pair.master,
        writer,
        child,
        reader,
    })
}

fn to_pty_size(size: TerminalDimensions) -> PtySize {
    PtySize {
        rows: size.rows(),
        cols: size.columns(),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn spawn_output_reader(mut reader: Box<dyn Read + Send>, sender: mpsc::Sender<Vec<u8>>) {
    tokio::task::spawn_blocking(move || {
        let mut buffer = vec![0; OUTPUT_BUFFER_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read_bytes) => {
                    if sender.blocking_send(buffer[..read_bytes].to_vec()).is_err() {
                        break;
                    }
                }
                Err(error) if error.kind() == ErrorKind::Interrupted => continue,
                Err(error) => {
                    tracing::warn!(error = %error, "PTY output reader stopped");
                    break;
                }
            }
        }
    });
}

async fn forward_output(
    mut receiver: mpsc::Receiver<Vec<u8>>,
    session_id: SessionId,
    output_sink: Arc<dyn TerminalOutputSink>,
) -> Result<(), SessionError> {
    let mut sequence = 0_u64;
    while let Some(payload) = receiver.recv().await {
        sequence = sequence
            .checked_add(1)
            .ok_or_else(|| SessionError::BackendFailure {
                operation: "sequence terminal output",
                message: "terminal output sequence overflow".to_owned(),
            })?;
        output_sink.send(TerminalChunk {
            session_id: session_id.clone(),
            sequence,
            payload,
        })?;
    }
    Ok(())
}

fn backend_failure(operation: &'static str, error: impl std::fmt::Display) -> SessionError {
    SessionError::BackendFailure {
        operation,
        message: error.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use tokio::sync::mpsc;

    use super::{LocalPtyBackend, forward_output, resolve_shell};
    use crate::session::{
        backend::{BackendOpenContext, SessionBackend, TerminalOutputSink},
        error::SessionError,
        model::{OpenLocalSessionRequest, SessionId, TerminalChunk, TerminalDimensions},
    };

    #[derive(Default)]
    struct RecordingOutputSink {
        chunks: Mutex<Vec<TerminalChunk>>,
    }

    impl TerminalOutputSink for RecordingOutputSink {
        fn send(&self, chunk: TerminalChunk) -> Result<(), SessionError> {
            self.chunks.lock().unwrap().push(chunk);
            Ok(())
        }
    }

    struct ChannelOutputSink {
        sender: mpsc::UnboundedSender<TerminalChunk>,
    }

    impl TerminalOutputSink for ChannelOutputSink {
        fn send(&self, chunk: TerminalChunk) -> Result<(), SessionError> {
            self.sender
                .send(chunk)
                .map_err(|_| SessionError::OutputChannelClosed)
        }
    }

    #[test]
    fn explicit_existing_shell_is_selected() {
        let shell = resolve_shell(Some("/bin/sh".to_owned())).unwrap();

        assert_eq!(shell, "/bin/sh");
    }

    #[test]
    fn unavailable_shell_is_rejected() {
        let result = resolve_shell(Some("/definitely-missing/fleurterm-shell".to_owned()));

        assert!(matches!(result, Err(SessionError::ShellUnavailable { .. })));
    }

    #[tokio::test]
    async fn output_sequence_starts_at_one_and_increases() {
        let session_id = SessionId::new();
        let sink = Arc::new(RecordingOutputSink::default());
        let (sender, receiver) = mpsc::channel(2);
        sender.send(vec![b'a']).await.unwrap();
        sender.send(vec![b'b']).await.unwrap();
        drop(sender);

        forward_output(receiver, session_id, sink.clone())
            .await
            .unwrap();

        let chunks = sink.chunks.lock().unwrap();
        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].sequence, 1);
        assert_eq!(chunks[1].sequence, 2);
    }

    #[tokio::test]
    async fn local_shell_emits_command_output() {
        let backend = LocalPtyBackend::new();
        let session_id = SessionId::new();
        let (sender, mut receiver) = mpsc::unbounded_channel();
        let sink = Arc::new(ChannelOutputSink { sender });
        let request = OpenLocalSessionRequest {
            shell: Some("/bin/sh".to_owned()),
            dimensions: TerminalDimensions::try_new(80, 24).unwrap(),
        };
        let context = BackendOpenContext {
            session_id,
            output_sink: sink,
        };
        let opened = backend.open(request, context).await.unwrap();

        opened
            .session
            .write(b"printf 'fleurterm-ready\\n'\n")
            .await
            .unwrap();

        let output = tokio::time::timeout(std::time::Duration::from_secs(3), async move {
            let mut output = Vec::new();
            while let Some(chunk) = receiver.recv().await {
                output.extend(chunk.payload);
                if output
                    .windows(b"fleurterm-ready".len())
                    .any(|window| window == b"fleurterm-ready")
                {
                    break;
                }
            }
            output
        })
        .await
        .unwrap();

        opened.session.close().await.unwrap();
        assert!(
            output
                .windows(b"fleurterm-ready".len())
                .any(|window| window == b"fleurterm-ready")
        );
    }
}
