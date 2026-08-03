use std::sync::Mutex;

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroize;

use crate::{
    credential_vault::CredentialVault,
    ipc::session_commands::AppState,
    session::model::SessionId,
    sftp::{
        ListSftpDirectoryResponse, OpenSftpResponse, PublicSftpError, SftpError,
        Ssh2SftpConnection, load_saved_ssh_profile, normalize_remote_path,
    },
};

#[derive(Clone, Copy, Debug, serde::Deserialize, Eq, PartialEq)]
pub enum SftpDialogLocale {
    #[serde(rename = "en-US")]
    English,
    #[serde(rename = "zh-CN")]
    Chinese,
}

struct SftpDialogLabels {
    upload_files: &'static str,
    download_file: &'static str,
}

fn sftp_dialog_labels(locale: SftpDialogLocale) -> SftpDialogLabels {
    match locale {
        SftpDialogLocale::English => SftpDialogLabels {
            upload_files: "Upload files",
            download_file: "Download file",
        },
        SftpDialogLocale::Chinese => SftpDialogLabels {
            upload_files: "上传文件",
            download_file: "下载文件",
        },
    }
}

#[tauri::command]
pub async fn sftp_open(
    app: AppHandle,
    terminal_session_id: SessionId,
    state: State<'_, AppState>,
    vault: State<'_, Mutex<CredentialVault>>,
) -> Result<OpenSftpResponse, PublicSftpError> {
    let request = state
        .active_sftp_profile(&terminal_session_id)
        .await
        .map_err(PublicSftpError::from)?;
    let current_profile =
        load_saved_ssh_profile(&app, &request.connection_id).map_err(PublicSftpError::from)?;
    if current_profile != request {
        state
            .sftp_registry()
            .close_for_terminal(&terminal_session_id)
            .map_err(PublicSftpError::from)?;
        return Err(PublicSftpError::from(SftpError::InvalidRequest));
    }
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
    let sftp_session_id = state
        .sftp_registry()
        .insert(terminal_session_id, Box::new(connection))
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
    state: State<'_, AppState>,
) -> Result<ListSftpDirectoryResponse, PublicSftpError> {
    let path = normalize_remote_path(&path)
        .map_err(|_| PublicSftpError::from(SftpError::InvalidRemotePath))?;
    let entries = state
        .sftp_registry()
        .list_directory(&sftp_session_id, &path)
        .await
        .map_err(PublicSftpError::from)?;
    Ok(ListSftpDirectoryResponse { path, entries })
}

#[tauri::command]
pub async fn sftp_upload_files(
    app: AppHandle,
    sftp_session_id: String,
    remote_directory: String,
    locale: SftpDialogLocale,
    state: State<'_, AppState>,
) -> Result<bool, PublicSftpError> {
    let labels = sftp_dialog_labels(locale);
    let selected_paths = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(labels.upload_files)
            .blocking_pick_files()
    })
    .await
    .map_err(|_| PublicSftpError::from(SftpError::WorkerFailed))?;
    let Some(selected_paths) = selected_paths else {
        return Ok(false);
    };
    let local_paths = selected_paths
        .into_iter()
        .map(|file_path| file_path.into_path().map_err(|_| SftpError::InvalidRequest))
        .collect::<Result<Vec<_>, _>>()
        .map_err(PublicSftpError::from)?;
    state
        .sftp_registry()
        .upload_files(&sftp_session_id, &remote_directory, local_paths)
        .await
        .map_err(PublicSftpError::from)?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_download_file(
    app: AppHandle,
    sftp_session_id: String,
    remote_path: String,
    suggested_file_name: String,
    locale: SftpDialogLocale,
    state: State<'_, AppState>,
) -> Result<bool, PublicSftpError> {
    validate_suggested_file_name(&suggested_file_name).map_err(PublicSftpError::from)?;
    let labels = sftp_dialog_labels(locale);
    let selected_path = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(labels.download_file)
            .set_file_name(suggested_file_name)
            .blocking_save_file()
    })
    .await
    .map_err(|_| PublicSftpError::from(SftpError::WorkerFailed))?;
    let Some(selected_path) = selected_path else {
        return Ok(false);
    };
    let local_path = selected_path
        .into_path()
        .map_err(|_| PublicSftpError::from(SftpError::InvalidRequest))?;
    state
        .sftp_registry()
        .download_file(&sftp_session_id, &remote_path, local_path)
        .await
        .map_err(PublicSftpError::from)?;
    Ok(true)
}

#[tauri::command]
pub async fn sftp_delete_entry(
    sftp_session_id: String,
    remote_path: String,
    state: State<'_, AppState>,
) -> Result<(), PublicSftpError> {
    state
        .sftp_registry()
        .delete_entry(&sftp_session_id, &remote_path)
        .await
        .map_err(PublicSftpError::from)
}

#[tauri::command]
pub fn sftp_close(
    sftp_session_id: String,
    state: State<'_, AppState>,
) -> Result<(), PublicSftpError> {
    state
        .sftp_registry()
        .close(&sftp_session_id)
        .map_err(PublicSftpError::from)
}

fn validate_suggested_file_name(file_name: &str) -> Result<(), SftpError> {
    let trimmed = file_name.trim();
    if trimmed.is_empty() || matches!(trimmed, "." | "..") || trimmed.contains(['/', '\\', '\0']) {
        return Err(SftpError::InvalidRequest);
    }
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::{SftpDialogLocale, sftp_dialog_labels};

    #[test]
    fn file_dialog_titles_follow_the_selected_locale() {
        let english = sftp_dialog_labels(SftpDialogLocale::English);
        let chinese = sftp_dialog_labels(SftpDialogLocale::Chinese);

        assert_eq!(english.upload_files, "Upload files");
        assert_eq!(english.download_file, "Download file");
        assert_eq!(chinese.upload_files, "上传文件");
        assert_eq!(chinese.download_file, "下载文件");
    }
}
