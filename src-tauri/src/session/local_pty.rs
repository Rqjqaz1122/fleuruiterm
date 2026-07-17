use std::{
    env,
    io::{ErrorKind, Read, Write},
    path::Path,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use async_trait::async_trait;
use portable_pty::{Child, ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use tokio::{
    sync::{mpsc, oneshot},
    task::{AbortHandle, JoinHandle},
    time::Instant,
};

use super::{
    backend::{
        BackendOpenContext, BackendSession, OpenedBackendSession, SessionBackend,
        SessionLifecycleSink, TerminalOutputSink,
    },
    error::SessionError,
    model::{
        OpenLocalSessionRequest, SessionId, SessionStateChanged, TerminalChunk, TerminalDimensions,
    },
    state::SessionState,
};

const OUTPUT_QUEUE_CAPACITY: usize = 32;
const OUTPUT_BUFFER_BYTES: usize = 64 * 1024;
const OUTPUT_BATCH_INTERVAL: std::time::Duration = std::time::Duration::from_millis(24);
const OUTPUT_DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);
const SESSION_SHUTDOWN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

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
    killer: Arc<Mutex<Option<Box<dyn ChildKiller + Send + Sync>>>>,
    child_exited: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
    reader_task: Mutex<Option<JoinHandle<()>>>,
    output_task: Mutex<Option<JoinHandle<()>>>,
    lifecycle_task: Mutex<Option<JoinHandle<Result<(), SessionError>>>>,
}

struct CreatedPty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Box<dyn Read + Send>,
}

struct LifecycleSupervisorContext {
    session_id: SessionId,
    lifecycle_sink: Arc<dyn SessionLifecycleSink>,
    output_done: oneshot::Receiver<Result<(), SessionError>>,
    output_abort_handle: AbortHandle,
    child_exited: Arc<AtomicBool>,
    closing: Arc<AtomicBool>,
    reader_done: oneshot::Receiver<()>,
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
        let BackendOpenContext {
            session_id,
            output_sink,
            lifecycle_sink,
        } = context;
        let shell_for_spawn = shell.clone();
        let created = tokio::task::spawn_blocking(move || create_pty(&shell_for_spawn, dimensions))
            .await
            .map_err(|error| backend_failure("spawn PTY task", error))??;

        let (sender, receiver) = mpsc::channel(OUTPUT_QUEUE_CAPACITY);
        let (reader_done_sender, reader_done_receiver) = oneshot::channel();
        let reader_task = spawn_output_reader(created.reader, sender, reader_done_sender);
        let killer = created.child.clone_killer();
        let child_exited = Arc::new(AtomicBool::new(false));
        let closing = Arc::new(AtomicBool::new(false));
        let (output_done_sender, output_done_receiver) = oneshot::channel();
        let output_session_id = session_id.clone();
        let output_task = tokio::spawn(async move {
            let result = forward_output(receiver, output_session_id, output_sink).await;
            let _ = output_done_sender.send(result);
        });
        let lifecycle_task = spawn_lifecycle_supervisor(
            created.child,
            LifecycleSupervisorContext {
                session_id,
                lifecycle_sink,
                output_done: output_done_receiver,
                output_abort_handle: output_task.abort_handle(),
                child_exited: Arc::clone(&child_exited),
                closing: Arc::clone(&closing),
                reader_done: reader_done_receiver,
            },
        );
        let session = LocalPtySession {
            master: Arc::new(Mutex::new(Some(created.master))),
            writer: Arc::new(Mutex::new(Some(created.writer))),
            killer: Arc::new(Mutex::new(Some(killer))),
            child_exited,
            closing,
            reader_task: Mutex::new(Some(reader_task)),
            output_task: Mutex::new(Some(output_task)),
            lifecycle_task: Mutex::new(Some(lifecycle_task)),
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
        self.closing.store(true, Ordering::Release);
        if let Some(output_task) = self
            .output_task
            .lock()
            .map_err(|error| backend_failure("lock output task", error))?
            .as_ref()
        {
            output_task.abort();
        }
        let master = Arc::clone(&self.master);
        let writer = Arc::clone(&self.writer);
        let killer = Arc::clone(&self.killer);
        let child_exited = Arc::clone(&self.child_exited);
        tokio::task::spawn_blocking(move || {
            writer
                .lock()
                .map_err(|error| backend_failure("lock PTY writer", error))?
                .take();
            master
                .lock()
                .map_err(|error| backend_failure("lock PTY master", error))?
                .take();
            let mut killer_guard = killer
                .lock()
                .map_err(|error| backend_failure("lock PTY killer", error))?;
            if let Some(killer) = killer_guard.as_mut() {
                if !child_exited.load(Ordering::Acquire)
                    && let Err(error) = killer.kill()
                    && !child_exited.load(Ordering::Acquire)
                {
                    return Err(backend_failure("kill PTY child", error));
                }
                killer_guard.take();
            }
            Ok(())
        })
        .await
        .map_err(|error| backend_failure("join PTY close task", error))??;

        let lifecycle_task = self
            .lifecycle_task
            .lock()
            .map_err(|error| backend_failure("lock lifecycle task", error))?
            .take();
        if let Some(mut task) = lifecycle_task {
            match tokio::time::timeout(SESSION_SHUTDOWN_TIMEOUT, &mut task).await {
                Ok(join_result) => {
                    join_result
                        .map_err(|error| backend_failure("join lifecycle task", error))??;
                }
                Err(_) => {
                    self.lifecycle_task
                        .lock()
                        .map_err(|error| backend_failure("restore lifecycle task", error))?
                        .replace(task);
                    return Err(SessionError::BackendFailure {
                        operation: "close PTY session",
                        message: "timed out waiting for PTY child shutdown".to_owned(),
                    });
                }
            }
        }

        let output_task = self
            .output_task
            .lock()
            .map_err(|error| backend_failure("lock output task", error))?
            .take();
        if let Some(task) = output_task {
            match task.await {
                Ok(()) => {}
                Err(error) if error.is_cancelled() => {}
                Err(error) => return Err(backend_failure("join output task", error)),
            }
        }

        let reader_task = self
            .reader_task
            .lock()
            .map_err(|error| backend_failure("lock output reader task", error))?
            .take();
        if let Some(task) = reader_task {
            task.await
                .map_err(|error| backend_failure("join output reader task", error))?;
        }

        Ok(())
    }
}

fn spawn_lifecycle_supervisor(
    mut child: Box<dyn Child + Send + Sync>,
    context: LifecycleSupervisorContext,
) -> JoinHandle<Result<(), SessionError>> {
    tokio::spawn(async move {
        let LifecycleSupervisorContext {
            session_id,
            lifecycle_sink,
            mut output_done,
            output_abort_handle,
            child_exited,
            closing,
            reader_done,
        } = context;
        let wait_result = tokio::task::spawn_blocking(move || child.wait())
            .await
            .map_err(|error| backend_failure("join child wait task", error))?;
        if wait_result.is_ok() {
            child_exited.store(true, Ordering::Release);
        }
        let output_result = match tokio::time::timeout(OUTPUT_DRAIN_TIMEOUT, &mut output_done).await
        {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => Err(backend_failure("receive output completion", error)),
            Err(_) => {
                output_abort_handle.abort();
                let _ = output_done.await;
                Err(SessionError::BackendFailure {
                    operation: "drain PTY output",
                    message: "timed out waiting for terminal output consumption".to_owned(),
                })
            }
        };
        reader_done
            .await
            .map_err(|error| backend_failure("receive output reader completion", error))?;
        let closing_requested = closing.load(Ordering::Acquire);
        let state = if wait_result.is_ok() && (output_result.is_ok() || closing_requested) {
            SessionState::Closed
        } else {
            SessionState::Failed
        };
        lifecycle_sink
            .send(SessionStateChanged { session_id, state })
            .await?;
        wait_result.map_err(|error| backend_failure("wait for PTY child", error))?;
        if closing_requested {
            Ok(())
        } else {
            output_result
        }
    })
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

fn spawn_output_reader(
    mut reader: Box<dyn Read + Send>,
    sender: mpsc::Sender<Vec<u8>>,
    reader_done: oneshot::Sender<()>,
) -> JoinHandle<()> {
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
        let _ = reader_done.send(());
    })
}

async fn forward_output(
    mut receiver: mpsc::Receiver<Vec<u8>>,
    session_id: SessionId,
    output_sink: Arc<dyn TerminalOutputSink>,
) -> Result<(), SessionError> {
    let mut sequence = 0_u64;
    let mut pending = None;
    loop {
        let first = match pending.take() {
            Some(bytes) => bytes,
            None => match receiver.recv().await {
                Some(bytes) => bytes,
                None => break,
            },
        };
        let mut payload = first;
        let deadline = Instant::now() + OUTPUT_BATCH_INTERVAL;
        while payload.len() < OUTPUT_BUFFER_BYTES {
            match tokio::time::timeout_at(deadline, receiver.recv()).await {
                Ok(Some(next)) if payload.len() + next.len() <= OUTPUT_BUFFER_BYTES => {
                    payload.extend(next);
                }
                Ok(Some(next)) => {
                    pending = Some(next);
                    break;
                }
                Ok(None) | Err(_) => break,
            }
        }
        sequence = sequence
            .checked_add(1)
            .ok_or_else(|| SessionError::BackendFailure {
                operation: "sequence terminal output",
                message: "terminal output sequence overflow".to_owned(),
            })?;
        output_sink
            .send(TerminalChunk {
                session_id: session_id.clone(),
                sequence,
                payload,
            })
            .await?;
    }
    output_sink.finish().await
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

    use async_trait::async_trait;
    use tokio::sync::mpsc;

    use super::{LocalPtyBackend, SessionState, forward_output, resolve_shell};
    use crate::session::{
        backend::{BackendOpenContext, SessionBackend, TerminalOutputSink},
        error::SessionError,
        model::{OpenLocalSessionRequest, SessionId, TerminalChunk, TerminalDimensions},
    };

    #[derive(Default)]
    struct RecordingOutputSink {
        chunks: Mutex<Vec<TerminalChunk>>,
    }

    #[async_trait]
    impl TerminalOutputSink for RecordingOutputSink {
        async fn send(&self, chunk: TerminalChunk) -> Result<(), SessionError> {
            self.chunks.lock().unwrap().push(chunk);
            Ok(())
        }
    }

    struct ChannelOutputSink {
        sender: mpsc::UnboundedSender<TerminalChunk>,
    }

    struct LifecycleChannelSink {
        sender: mpsc::UnboundedSender<crate::session::model::SessionStateChanged>,
    }

    struct BlockingFinishOutputSink {
        finish_started: Arc<tokio::sync::Notify>,
        allow_finish: Arc<tokio::sync::Notify>,
    }

    #[async_trait]
    impl crate::session::backend::SessionLifecycleSink for LifecycleChannelSink {
        async fn send(
            &self,
            event: crate::session::model::SessionStateChanged,
        ) -> Result<(), SessionError> {
            self.sender
                .send(event)
                .map_err(|_| SessionError::OutputChannelClosed)
        }
    }

    #[async_trait]
    impl TerminalOutputSink for ChannelOutputSink {
        async fn send(&self, chunk: TerminalChunk) -> Result<(), SessionError> {
            self.sender
                .send(chunk)
                .map_err(|_| SessionError::OutputChannelClosed)
        }
    }

    #[async_trait]
    impl TerminalOutputSink for BlockingFinishOutputSink {
        async fn send(&self, _chunk: TerminalChunk) -> Result<(), SessionError> {
            Ok(())
        }

        async fn finish(&self) -> Result<(), SessionError> {
            self.finish_started.notify_one();
            self.allow_finish.notified().await;
            Ok(())
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
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].sequence, 1);
        assert_eq!(chunks[0].payload, b"ab");
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
            lifecycle_sink: Arc::new(crate::session::backend::DiscardLifecycleSink),
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

    #[tokio::test]
    async fn natural_shell_exit_is_reaped_and_reported_closed() {
        let backend = LocalPtyBackend::new();
        let session_id = SessionId::new();
        let (lifecycle_sender, mut lifecycle_receiver) = mpsc::unbounded_channel();
        let request = OpenLocalSessionRequest {
            shell: Some("/bin/sh".to_owned()),
            dimensions: TerminalDimensions::try_new(80, 24).unwrap(),
        };
        let context = BackendOpenContext {
            session_id: session_id.clone(),
            output_sink: Arc::new(crate::session::backend::DiscardOutputSink),
            lifecycle_sink: Arc::new(LifecycleChannelSink {
                sender: lifecycle_sender,
            }),
        };
        let opened = backend.open(request, context).await.unwrap();

        opened.session.write(b"exit\n").await.unwrap();
        let event =
            tokio::time::timeout(std::time::Duration::from_secs(3), lifecycle_receiver.recv())
                .await
                .unwrap()
                .unwrap();

        assert_eq!(event.session_id, session_id);
        assert_eq!(event.state, SessionState::Closed);
        opened.session.close().await.unwrap();
    }

    #[tokio::test]
    async fn natural_exit_waits_for_terminal_output_consumption() {
        let backend = LocalPtyBackend::new();
        let session_id = SessionId::new();
        let (lifecycle_sender, mut lifecycle_receiver) = mpsc::unbounded_channel();
        let finish_started = Arc::new(tokio::sync::Notify::new());
        let allow_finish = Arc::new(tokio::sync::Notify::new());
        let context = BackendOpenContext {
            session_id,
            output_sink: Arc::new(BlockingFinishOutputSink {
                finish_started: Arc::clone(&finish_started),
                allow_finish: Arc::clone(&allow_finish),
            }),
            lifecycle_sink: Arc::new(LifecycleChannelSink {
                sender: lifecycle_sender,
            }),
        };
        let request = OpenLocalSessionRequest {
            shell: Some("/bin/sh".to_owned()),
            dimensions: TerminalDimensions::try_new(80, 24).unwrap(),
        };
        let opened = backend.open(request, context).await.unwrap();

        opened
            .session
            .write(b"printf 'tail-output\\n'; exit\n")
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(3), finish_started.notified())
            .await
            .unwrap();
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(100),
                lifecycle_receiver.recv(),
            )
            .await
            .is_err()
        );

        allow_finish.notify_one();
        let event =
            tokio::time::timeout(std::time::Duration::from_secs(3), lifecycle_receiver.recv())
                .await
                .unwrap()
                .unwrap();
        assert_eq!(event.state, SessionState::Closed);
        opened.session.close().await.unwrap();
    }

    #[tokio::test]
    async fn explicit_close_cancels_pending_output_consumption() {
        let backend = LocalPtyBackend::new();
        let session_id = SessionId::new();
        let (lifecycle_sender, mut lifecycle_receiver) = mpsc::unbounded_channel();
        let finish_started = Arc::new(tokio::sync::Notify::new());
        let context = BackendOpenContext {
            session_id,
            output_sink: Arc::new(BlockingFinishOutputSink {
                finish_started: Arc::clone(&finish_started),
                allow_finish: Arc::new(tokio::sync::Notify::new()),
            }),
            lifecycle_sink: Arc::new(LifecycleChannelSink {
                sender: lifecycle_sender,
            }),
        };
        let request = OpenLocalSessionRequest {
            shell: Some("/bin/sh".to_owned()),
            dimensions: TerminalDimensions::try_new(80, 24).unwrap(),
        };
        let opened = backend.open(request, context).await.unwrap();
        opened
            .session
            .write(b"printf 'pending-output\\n'; exit\n")
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(3), finish_started.notified())
            .await
            .unwrap();

        tokio::time::timeout(std::time::Duration::from_secs(1), opened.session.close())
            .await
            .unwrap()
            .unwrap();
        let event = lifecycle_receiver.recv().await.unwrap();
        assert_eq!(event.state, SessionState::Closed);
    }
}
