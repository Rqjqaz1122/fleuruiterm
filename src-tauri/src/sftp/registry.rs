use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};

use uuid::Uuid;

use crate::session::model::SessionId;

use super::{
    error::SftpError,
    model::{SftpDirectoryEntry, SftpEntryKind, sort_entries},
    path::{join_remote_child, normalize_remote_path},
};

pub trait SftpOperations: Send {
    fn list_directory(
        &mut self,
        path: &str,
        cancelled: &AtomicBool,
    ) -> Result<Vec<SftpDirectoryEntry>, SftpError>;

    fn upload_file(
        &mut self,
        local_path: &Path,
        remote_path: &str,
        cancelled: &AtomicBool,
    ) -> Result<(), SftpError>;

    fn download_file(
        &mut self,
        remote_path: &str,
        local_path: &Path,
        cancelled: &AtomicBool,
    ) -> Result<(), SftpError>;

    fn entry_kind(
        &mut self,
        remote_path: &str,
        cancelled: &AtomicBool,
    ) -> Result<SftpEntryKind, SftpError>;

    fn remove_file(&mut self, remote_path: &str, cancelled: &AtomicBool) -> Result<(), SftpError>;

    fn remove_directory(
        &mut self,
        remote_path: &str,
        cancelled: &AtomicBool,
    ) -> Result<(), SftpError>;
}

struct RegisteredSftpSession {
    terminal_session_id: SessionId,
    operations: Mutex<Box<dyn SftpOperations>>,
    cancelled: AtomicBool,
}

type SharedSftpSession = Arc<RegisteredSftpSession>;

#[derive(Clone, Default)]
pub struct SftpRegistry {
    sessions: Arc<Mutex<HashMap<String, SharedSftpSession>>>,
}

impl SftpRegistry {
    pub fn insert(
        &self,
        terminal_session_id: SessionId,
        operations: Box<dyn SftpOperations>,
    ) -> Result<String, SftpError> {
        let session_id = Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .insert(
                session_id.clone(),
                Arc::new(RegisteredSftpSession {
                    terminal_session_id,
                    operations: Mutex::new(operations),
                    cancelled: AtomicBool::new(false),
                }),
            );
        Ok(session_id)
    }

    pub async fn list_directory(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<SftpDirectoryEntry>, SftpError> {
        let path = normalize_remote_path(path).map_err(|_| SftpError::InvalidRemotePath)?;
        let session = self.session(session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            ensure_active(&session.cancelled)?;
            let mut operations = session
                .operations
                .lock()
                .map_err(|_| SftpError::WorkerFailed)?;
            let mut entries = operations.list_directory(&path, &session.cancelled)?;
            sort_entries(&mut entries);
            Ok(entries)
        })
        .await
        .map_err(|_| SftpError::WorkerFailed)?
    }

    pub async fn upload_files(
        &self,
        session_id: &str,
        remote_directory: &str,
        local_paths: Vec<PathBuf>,
    ) -> Result<(), SftpError> {
        let remote_directory =
            normalize_remote_path(remote_directory).map_err(|_| SftpError::InvalidRemotePath)?;
        let upload_paths = local_paths
            .into_iter()
            .map(|local_path| {
                if !local_path.is_absolute() || !local_path.is_file() {
                    return Err(SftpError::InvalidRequest);
                }
                let file_name = local_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or(SftpError::InvalidRequest)?;
                let remote_path = join_remote_child(&remote_directory, file_name)
                    .map_err(|_| SftpError::InvalidRemotePath)?;
                Ok((local_path, remote_path))
            })
            .collect::<Result<Vec<_>, SftpError>>()?;
        if upload_paths.is_empty() {
            return Err(SftpError::InvalidRequest);
        }
        let session = self.session(session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            ensure_active(&session.cancelled)?;
            let mut operations = session
                .operations
                .lock()
                .map_err(|_| SftpError::WorkerFailed)?;
            for (local_path, remote_path) in upload_paths {
                ensure_active(&session.cancelled)?;
                operations.upload_file(&local_path, &remote_path, &session.cancelled)?;
            }
            Ok(())
        })
        .await
        .map_err(|_| SftpError::WorkerFailed)?
    }

    pub async fn download_file(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: PathBuf,
    ) -> Result<(), SftpError> {
        let remote_path =
            normalize_remote_path(remote_path).map_err(|_| SftpError::InvalidRemotePath)?;
        if !local_path.is_absolute() || local_path.parent().is_none_or(|parent| !parent.is_dir()) {
            return Err(SftpError::InvalidRequest);
        }
        let session = self.session(session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            ensure_active(&session.cancelled)?;
            session
                .operations
                .lock()
                .map_err(|_| SftpError::WorkerFailed)?
                .download_file(&remote_path, &local_path, &session.cancelled)
        })
        .await
        .map_err(|_| SftpError::WorkerFailed)?
    }

    pub async fn delete_entry(&self, session_id: &str, remote_path: &str) -> Result<(), SftpError> {
        let remote_path =
            normalize_remote_path(remote_path).map_err(|_| SftpError::InvalidRemotePath)?;
        if remote_path == "/" {
            return Err(SftpError::InvalidRequest);
        }
        let session = self.session(session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            ensure_active(&session.cancelled)?;
            let mut operations = session
                .operations
                .lock()
                .map_err(|_| SftpError::WorkerFailed)?;
            delete_remote_entry(operations.as_mut(), &remote_path, &session.cancelled)
        })
        .await
        .map_err(|_| SftpError::WorkerFailed)?
    }

    pub fn close(&self, session_id: &str) -> Result<(), SftpError> {
        if let Some(session) = self
            .sessions
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .remove(session_id)
        {
            session.cancelled.store(true, Ordering::SeqCst);
        }
        Ok(())
    }

    pub fn close_for_terminal(&self, terminal_session_id: &SessionId) -> Result<(), SftpError> {
        let mut sessions = self.sessions.lock().map_err(|_| SftpError::WorkerFailed)?;
        sessions.retain(|_, session| {
            let keep = &session.terminal_session_id != terminal_session_id;
            if !keep {
                session.cancelled.store(true, Ordering::SeqCst);
            }
            keep
        });
        Ok(())
    }

    pub fn close_all(&self) -> Result<(), SftpError> {
        let mut sessions = self.sessions.lock().map_err(|_| SftpError::WorkerFailed)?;
        for session in sessions.values() {
            session.cancelled.store(true, Ordering::SeqCst);
        }
        sessions.clear();
        Ok(())
    }

    fn session(&self, session_id: &str) -> Result<SharedSftpSession, SftpError> {
        self.sessions
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .get(session_id)
            .cloned()
            .ok_or(SftpError::SessionNotFound)
    }
}

fn delete_remote_entry(
    operations: &mut dyn SftpOperations,
    remote_path: &str,
    cancelled: &AtomicBool,
) -> Result<(), SftpError> {
    ensure_active(cancelled)?;
    let entry_kind = operations.entry_kind(remote_path, cancelled)?;
    if entry_kind != SftpEntryKind::Directory {
        return operations.remove_file(remote_path, cancelled);
    }
    for child in operations.list_directory(remote_path, cancelled)? {
        let child_path = join_remote_child(remote_path, &child.name)
            .map_err(|_| SftpError::InvalidRemotePath)?;
        delete_remote_entry(operations, &child_path, cancelled)?;
    }
    operations.remove_directory(remote_path, cancelled)
}

fn ensure_active(cancelled: &AtomicBool) -> Result<(), SftpError> {
    if cancelled.load(Ordering::SeqCst) {
        Err(SftpError::Cancelled)
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        path::Path,
        sync::{
            Arc, Mutex,
            atomic::{AtomicBool, Ordering},
        },
        time::Duration,
    };

    use super::{SftpOperations, SftpRegistry};
    use crate::session::model::SessionId;
    use crate::sftp::{
        error::SftpError,
        model::{SftpDirectoryEntry, SftpEntryKind},
    };

    type UploadedFiles = Arc<Mutex<Vec<(String, Vec<u8>)>>>;
    type RemovedEntries = Arc<Mutex<Vec<(String, RemovalKind)>>>;

    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum RemovalKind {
        File,
        Directory,
    }

    #[derive(Default)]
    struct FakeSftpOperations {
        directories: HashMap<String, Vec<SftpDirectoryEntry>>,
        uploaded: UploadedFiles,
        downloads: HashMap<String, Vec<u8>>,
        entry_kinds: HashMap<String, SftpEntryKind>,
        removed_entries: RemovedEntries,
    }

    struct BlockingSftpOperations {
        started: Arc<AtomicBool>,
    }

    impl SftpOperations for BlockingSftpOperations {
        fn list_directory(
            &mut self,
            _path: &str,
            cancelled: &AtomicBool,
        ) -> Result<Vec<SftpDirectoryEntry>, SftpError> {
            self.started.store(true, Ordering::SeqCst);
            while !cancelled.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(SftpError::Cancelled)
        }

        fn upload_file(
            &mut self,
            _local_path: &Path,
            _remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            unreachable!()
        }

        fn download_file(
            &mut self,
            _remote_path: &str,
            _local_path: &Path,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            unreachable!()
        }

        fn entry_kind(
            &mut self,
            _remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<SftpEntryKind, SftpError> {
            unreachable!()
        }

        fn remove_file(
            &mut self,
            _remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            unreachable!()
        }

        fn remove_directory(
            &mut self,
            _remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            unreachable!()
        }
    }

    impl SftpOperations for FakeSftpOperations {
        fn list_directory(
            &mut self,
            path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<Vec<SftpDirectoryEntry>, SftpError> {
            Ok(self.directories.get(path).cloned().unwrap_or_default())
        }

        fn upload_file(
            &mut self,
            local_path: &Path,
            remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            let content = std::fs::read(local_path)
                .map_err(|error| SftpError::LocalFileOperationFailed(error.to_string()))?;
            self.uploaded
                .lock()
                .unwrap()
                .push((remote_path.to_owned(), content));
            Ok(())
        }

        fn download_file(
            &mut self,
            remote_path: &str,
            local_path: &Path,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            let content = self
                .downloads
                .get(remote_path)
                .ok_or_else(|| SftpError::RemoteOperationFailed("missing fake file".to_owned()))?;
            std::fs::write(local_path, content)
                .map_err(|error| SftpError::LocalFileOperationFailed(error.to_string()))
        }

        fn entry_kind(
            &mut self,
            remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<SftpEntryKind, SftpError> {
            self.entry_kinds
                .get(remote_path)
                .copied()
                .ok_or_else(|| SftpError::RemoteOperationFailed("missing fake entry".to_owned()))
        }

        fn remove_file(
            &mut self,
            remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            self.removed_entries
                .lock()
                .unwrap()
                .push((remote_path.to_owned(), RemovalKind::File));
            Ok(())
        }

        fn remove_directory(
            &mut self,
            remote_path: &str,
            _cancelled: &AtomicBool,
        ) -> Result<(), SftpError> {
            self.removed_entries
                .lock()
                .unwrap()
                .push((remote_path.to_owned(), RemovalKind::Directory));
            Ok(())
        }
    }

    #[tokio::test]
    async fn closing_a_registered_session_removes_it() {
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(SessionId::new(), Box::new(FakeSftpOperations::default()))
            .unwrap();
        registry.close(&session_id).unwrap();
        assert!(matches!(
            registry.list_directory(&session_id, "/").await,
            Err(SftpError::SessionNotFound)
        ));
    }

    #[tokio::test]
    async fn lists_and_sorts_registered_directory_entries() {
        let mut operations = FakeSftpOperations::default();
        operations.directories.insert(
            "/".to_owned(),
            vec![
                entry("z.txt", SftpEntryKind::File),
                entry("alpha", SftpEntryKind::Directory),
            ],
        );
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(SessionId::new(), Box::new(operations))
            .unwrap();
        let entries = registry.list_directory(&session_id, "/").await.unwrap();
        assert_eq!(entries[0].name, "alpha");
    }

    #[tokio::test]
    async fn upload_uses_only_the_selected_file_name() {
        let directory = tempfile::tempdir().unwrap();
        let local_path = directory.path().join("report.txt");
        std::fs::write(&local_path, b"content").unwrap();
        let uploaded = Arc::new(Mutex::new(Vec::new()));
        let operations = FakeSftpOperations {
            uploaded: Arc::clone(&uploaded),
            ..Default::default()
        };
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(SessionId::new(), Box::new(operations))
            .unwrap();
        registry
            .upload_files(&session_id, "/incoming", vec![local_path])
            .await
            .unwrap();
        assert_eq!(
            uploaded.lock().unwrap().as_slice(),
            &[("/incoming/report.txt".to_owned(), b"content".to_vec())]
        );
    }

    #[tokio::test]
    async fn downloads_a_remote_file_to_the_selected_destination() {
        let directory = tempfile::tempdir().unwrap();
        let local_path = directory.path().join("report.txt");
        let mut operations = FakeSftpOperations::default();
        operations
            .downloads
            .insert("/remote/report.txt".to_owned(), b"downloaded".to_vec());
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(SessionId::new(), Box::new(operations))
            .unwrap();

        registry
            .download_file(&session_id, "/remote/report.txt", local_path.clone())
            .await
            .unwrap();

        assert_eq!(std::fs::read(local_path).unwrap(), b"downloaded");
    }

    #[tokio::test]
    async fn recursively_deletes_directory_contents_before_the_directory() {
        let removed_entries = Arc::new(Mutex::new(Vec::new()));
        let mut operations = FakeSftpOperations {
            removed_entries: Arc::clone(&removed_entries),
            ..Default::default()
        };
        operations
            .entry_kinds
            .insert("/archive".to_owned(), SftpEntryKind::Directory);
        for (path, kind) in [
            ("/archive/nested", SftpEntryKind::Directory),
            ("/archive/nested/inner.txt", SftpEntryKind::File),
            ("/archive/report.txt", SftpEntryKind::File),
            ("/archive/latest", SftpEntryKind::Symlink),
        ] {
            operations.entry_kinds.insert(path.to_owned(), kind);
        }
        operations.directories.insert(
            "/archive".to_owned(),
            vec![
                entry("nested", SftpEntryKind::Directory),
                entry("report.txt", SftpEntryKind::File),
                entry("latest", SftpEntryKind::Symlink),
            ],
        );
        operations.directories.insert(
            "/archive/nested".to_owned(),
            vec![entry("inner.txt", SftpEntryKind::File)],
        );
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(SessionId::new(), Box::new(operations))
            .unwrap();

        registry
            .delete_entry(&session_id, "/archive")
            .await
            .unwrap();

        assert_eq!(
            removed_entries.lock().unwrap().as_slice(),
            &[
                ("/archive/nested/inner.txt".to_owned(), RemovalKind::File),
                ("/archive/nested".to_owned(), RemovalKind::Directory),
                ("/archive/report.txt".to_owned(), RemovalKind::File),
                ("/archive/latest".to_owned(), RemovalKind::File),
                ("/archive".to_owned(), RemovalKind::Directory),
            ]
        );
    }

    #[tokio::test]
    async fn checks_each_child_kind_before_recursive_deletion() {
        let removed_entries = Arc::new(Mutex::new(Vec::new()));
        let mut operations = FakeSftpOperations {
            removed_entries: Arc::clone(&removed_entries),
            ..Default::default()
        };
        operations
            .entry_kinds
            .insert("/archive".to_owned(), SftpEntryKind::Directory);
        operations
            .entry_kinds
            .insert("/archive/latest".to_owned(), SftpEntryKind::Symlink);
        operations.directories.insert(
            "/archive".to_owned(),
            vec![entry("latest", SftpEntryKind::Directory)],
        );
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(SessionId::new(), Box::new(operations))
            .unwrap();

        registry
            .delete_entry(&session_id, "/archive")
            .await
            .unwrap();

        assert_eq!(
            removed_entries.lock().unwrap().as_slice(),
            &[
                ("/archive/latest".to_owned(), RemovalKind::File),
                ("/archive".to_owned(), RemovalKind::Directory),
            ]
        );
    }

    #[tokio::test]
    async fn rejects_deleting_the_remote_root_directory() {
        let mut operations = FakeSftpOperations::default();
        operations
            .entry_kinds
            .insert("/".to_owned(), SftpEntryKind::Directory);
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(SessionId::new(), Box::new(operations))
            .unwrap();

        assert!(matches!(
            registry.delete_entry(&session_id, "/").await,
            Err(SftpError::InvalidRequest)
        ));
    }

    #[tokio::test]
    async fn closing_a_terminal_removes_only_its_sftp_sessions() {
        let registry = SftpRegistry::default();
        let first_terminal = SessionId::new();
        let second_terminal = SessionId::new();
        let first_sftp = registry
            .insert(
                first_terminal.clone(),
                Box::new(FakeSftpOperations::default()),
            )
            .unwrap();
        let second_sftp = registry
            .insert(second_terminal, Box::new(FakeSftpOperations::default()))
            .unwrap();

        registry.close_for_terminal(&first_terminal).unwrap();

        assert!(matches!(
            registry.list_directory(&first_sftp, "/").await,
            Err(SftpError::SessionNotFound)
        ));
        assert!(registry.list_directory(&second_sftp, "/").await.is_ok());
    }

    #[tokio::test]
    async fn closing_a_terminal_cancels_its_inflight_operation() {
        let registry = SftpRegistry::default();
        let terminal_session_id = SessionId::new();
        let started = Arc::new(AtomicBool::new(false));
        let sftp_session_id = registry
            .insert(
                terminal_session_id.clone(),
                Box::new(BlockingSftpOperations {
                    started: Arc::clone(&started),
                }),
            )
            .unwrap();
        let operation_registry = registry.clone();
        let operation = tokio::spawn(async move {
            operation_registry
                .list_directory(&sftp_session_id, "/")
                .await
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            while !started.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        registry.close_for_terminal(&terminal_session_id).unwrap();

        assert!(matches!(
            tokio::time::timeout(Duration::from_secs(1), operation)
                .await
                .unwrap()
                .unwrap(),
            Err(SftpError::Cancelled)
        ));
    }

    fn entry(name: &str, kind: SftpEntryKind) -> SftpDirectoryEntry {
        SftpDirectoryEntry {
            name: name.to_owned(),
            path: format!("/{name}"),
            kind,
            size: None,
            modified_at: None,
            permissions: None,
        }
    }
}
