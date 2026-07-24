use std::{path::PathBuf, sync::Mutex};

use tauri::State;
use zeroize::Zeroize;

use crate::{
    credential_vault::CredentialVault,
    sftp::{
        ListSftpDirectoryResponse, OpenSftpRequest, OpenSftpResponse, PublicSftpError, SftpError,
        SftpRegistry, Ssh2SftpConnection, normalize_remote_path,
    },
};

#[tauri::command]
pub async fn sftp_open(
    request: OpenSftpRequest,
    registry: State<'_, SftpRegistry>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<OpenSftpResponse, PublicSftpError> {
    request.validate().map_err(PublicSftpError::from)?;
    let mut password =
        load_connection_password(&request.connection_id, &vault).map_err(PublicSftpError::from)?;
    let connection_result = tauri::async_runtime::spawn_blocking(move || {
        let result: Result<(Ssh2SftpConnection, String), SftpError> = (|| {
            let connection = Ssh2SftpConnection::connect(&request, password.as_deref())?;
            let path = connection.home_directory()?;
            Ok((connection, path))
        })();
        if let Some(secret) = password.as_mut() {
            secret.zeroize();
        }
        result
    })
    .await
    .map_err(|_| PublicSftpError::from(SftpError::WorkerFailed))?
    .map_err(PublicSftpError::from)?;
    let (connection, path) = connection_result;
    let sftp_session_id = registry
        .insert(Box::new(connection))
        .map_err(PublicSftpError::from)?;
    Ok(OpenSftpResponse {
        sftp_session_id,
        path,
    })
}

#[tauri::command]
pub async fn sftp_list_directory(
    sftp_session_id: String,
    path: String,
    registry: State<'_, SftpRegistry>,
) -> Result<ListSftpDirectoryResponse, PublicSftpError> {
    let path = normalize_remote_path(&path)
        .map_err(|_| PublicSftpError::from(SftpError::InvalidRemotePath))?;
    let entries = registry
        .list_directory(&sftp_session_id, &path)
        .await
        .map_err(PublicSftpError::from)?;
    Ok(ListSftpDirectoryResponse { path, entries })
}

#[tauri::command]
pub async fn sftp_upload_files(
    sftp_session_id: String,
    remote_directory: String,
    local_paths: Vec<String>,
    registry: State<'_, SftpRegistry>,
) -> Result<(), PublicSftpError> {
    registry
        .upload_files(
            &sftp_session_id,
            &remote_directory,
            local_paths.into_iter().map(PathBuf::from).collect(),
        )
        .await
        .map_err(PublicSftpError::from)
}

#[tauri::command]
pub async fn sftp_download_file(
    sftp_session_id: String,
    remote_path: String,
    local_path: String,
    registry: State<'_, SftpRegistry>,
) -> Result<(), PublicSftpError> {
    registry
        .download_file(&sftp_session_id, &remote_path, PathBuf::from(local_path))
        .await
        .map_err(PublicSftpError::from)
}

#[tauri::command]
pub fn sftp_close(
    sftp_session_id: String,
    registry: State<'_, SftpRegistry>,
) -> Result<(), PublicSftpError> {
    registry
        .close(&sftp_session_id)
        .map_err(PublicSftpError::from)
}

fn load_connection_password(
    connection_id: &str,
    vault: &State<'_, Mutex<CredentialVault>>,
) -> Result<Option<String>, SftpError> {
    #[cfg(target_os = "macos")]
    {
        return vault
            .lock()
            .map_err(|_| SftpError::WorkerFailed)?
            .load_passwords(&[connection_id.to_owned()])
            .map_err(|_| SftpError::AuthenticationFailed)
            .map(|mut passwords| passwords.remove(connection_id));
    }

    #[cfg(target_os = "windows")]
    {
        let _ = vault;
        return crate::credentials::load_connection_passwords(&[connection_id.to_owned()])
            .map_err(|_| SftpError::AuthenticationFailed)
            .map(|mut passwords| passwords.remove(connection_id));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = connection_id;
        let _ = vault;
        Ok(None)
    }
}
