use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use uuid::Uuid;

use super::{
    error::SftpError,
    model::{SftpDirectoryEntry, sort_entries},
    path::{join_remote_child, normalize_remote_path},
};

pub trait SftpOperations: Send {
    fn list_directory(&mut self, path: &str) -> Result<Vec<SftpDirectoryEntry>, SftpError>;

    fn upload_file(&mut self, local_path: &Path, remote_path: &str) -> Result<(), SftpError>;

    fn download_file(&mut self, remote_path: &str, local_path: &Path) -> Result<(), SftpError>;
}

type SharedSftpOperations = Arc<Mutex<Box<dyn SftpOperations>>>;

#[derive(Clone, Default)]
pub struct SftpRegistry {
    sessions: Arc<Mutex<HashMap<String, SharedSftpOperations>>>,
}

impl SftpRegistry {
    pub fn insert(&self, operations: Box<dyn SftpOperations>) -> Result<String, SftpError> {
        let session_id = Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .insert(session_id.clone(), Arc::new(Mutex::new(operations)));
        Ok(session_id)
    }

    pub async fn list_directory(
        &self,
        session_id: &str,
        path: &str,
    ) -> Result<Vec<SftpDirectoryEntry>, SftpError> {
        let path = normalize_remote_path(path).map_err(|_| SftpError::InvalidRemotePath)?;
        let operations = self.session(session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            let mut operations = operations.lock().map_err(|_| SftpError::WorkerFailed)?;
            let mut entries = operations.list_directory(&path)?;
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
        let operations = self.session(session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            let mut operations = operations.lock().map_err(|_| SftpError::WorkerFailed)?;
            for (local_path, remote_path) in upload_paths {
                operations.upload_file(&local_path, &remote_path)?;
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
        if local_path.as_os_str().is_empty() {
            return Err(SftpError::InvalidRequest);
        }
        let operations = self.session(session_id)?;
        tauri::async_runtime::spawn_blocking(move || {
            operations
                .lock()
                .map_err(|_| SftpError::WorkerFailed)?
                .download_file(&remote_path, &local_path)
        })
        .await
        .map_err(|_| SftpError::WorkerFailed)?
    }

    pub fn close(&self, session_id: &str) -> Result<(), SftpError> {
        self.sessions
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .remove(session_id);
        Ok(())
    }

    pub fn close_all(&self) -> Result<(), SftpError> {
        self.sessions
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .clear();
        Ok(())
    }

    fn session(&self, session_id: &str) -> Result<SharedSftpOperations, SftpError> {
        self.sessions
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .get(session_id)
            .cloned()
            .ok_or(SftpError::SessionNotFound)
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        path::Path,
        sync::{Arc, Mutex},
    };

    use super::{SftpOperations, SftpRegistry};
    use crate::sftp::{
        error::SftpError,
        model::{SftpDirectoryEntry, SftpEntryKind},
    };

    #[derive(Default)]
    struct FakeSftpOperations {
        directories: HashMap<String, Vec<SftpDirectoryEntry>>,
        uploaded: Arc<Mutex<Vec<(String, Vec<u8>)>>>,
        downloads: HashMap<String, Vec<u8>>,
    }

    impl SftpOperations for FakeSftpOperations {
        fn list_directory(&mut self, path: &str) -> Result<Vec<SftpDirectoryEntry>, SftpError> {
            Ok(self.directories.get(path).cloned().unwrap_or_default())
        }

        fn upload_file(&mut self, local_path: &Path, remote_path: &str) -> Result<(), SftpError> {
            let content = std::fs::read(local_path)
                .map_err(|error| SftpError::LocalFileOperationFailed(error.to_string()))?;
            self.uploaded
                .lock()
                .unwrap()
                .push((remote_path.to_owned(), content));
            Ok(())
        }

        fn download_file(&mut self, remote_path: &str, local_path: &Path) -> Result<(), SftpError> {
            let content = self
                .downloads
                .get(remote_path)
                .ok_or_else(|| SftpError::RemoteOperationFailed("missing fake file".to_owned()))?;
            std::fs::write(local_path, content)
                .map_err(|error| SftpError::LocalFileOperationFailed(error.to_string()))
        }
    }

    #[tokio::test]
    async fn closing_a_registered_session_removes_it() {
        let registry = SftpRegistry::default();
        let session_id = registry
            .insert(Box::new(FakeSftpOperations::default()))
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
        let session_id = registry.insert(Box::new(operations)).unwrap();
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
        let session_id = registry.insert(Box::new(operations)).unwrap();
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
        let session_id = registry.insert(Box::new(operations)).unwrap();

        registry
            .download_file(&session_id, "/remote/report.txt", local_path.clone())
            .await
            .unwrap();

        assert_eq!(std::fs::read(local_path).unwrap(), b"downloaded");
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
