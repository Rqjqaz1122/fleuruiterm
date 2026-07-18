pub mod ipc;
pub mod session;

use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, fs, io::ErrorKind};
use ipc::session_commands::{
    AppState, session_ack_output, session_close, session_interrupt, session_open_local,
    session_resize, session_write,
};
use tauri::Manager;

const APP_SETTINGS_FILE_NAME: &str = "settings.json";
const CONNECTION_PASSWORD_TARGET_PREFIX: &str = "FleurTerm/ConnectionPassword/";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettingsPayload {
    exists: bool,
    path: String,
    settings: Option<Value>,
    error: Option<String>,
}

#[tauri::command]
fn load_app_settings(app: tauri::AppHandle) -> Result<AppSettingsPayload, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    let path = directory.join(APP_SETTINGS_FILE_NAME);
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(settings) => Ok(AppSettingsPayload { exists: true, path: path.display().to_string(), settings: Some(settings), error: None }),
            Err(error) => Ok(AppSettingsPayload { exists: true, path: path.display().to_string(), settings: None, error: Some(format!("Failed to parse settings: {error}")) }),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(AppSettingsPayload { exists: false, path: path.display().to_string(), settings: None, error: None }),
        Err(error) => Ok(AppSettingsPayload { exists: false, path: path.display().to_string(), settings: None, error: Some(format!("Failed to read settings: {error}")) }),
    }
}

#[tauri::command]
fn save_app_settings(app: tauri::AppHandle, settings: Value) -> Result<String, String> {
    let directory = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(APP_SETTINGS_FILE_NAME);
    fs::write(&path, serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn load_connection_passwords(connection_ids: Vec<String>) -> Result<HashMap<String, String>, String> {
    connection_ids.into_iter().filter_map(|id| read_connection_password(&id).transpose().map(|password| password.map(|value| (id, value)))).collect()
}

#[tauri::command]
fn save_connection_password(connection_id: String, password: String) -> Result<(), String> { write_connection_password(&connection_id, &password) }

#[tauri::command]
fn delete_connection_password(connection_id: String) -> Result<(), String> { remove_connection_password(&connection_id) }

#[tauri::command]
fn set_window_opacity(window: tauri::Window, opacity: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        apply_window_opacity(hwnd, opacity)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
        let _ = opacity;
        Ok(())
    }
}

fn password_target(connection_id: &str) -> String { format!("{CONNECTION_PASSWORD_TARGET_PREFIX}{connection_id}") }

#[cfg(target_os = "windows")]
fn apply_window_opacity(hwnd: windows::Win32::Foundation::HWND, opacity: f64) -> Result<(), String> {
    use windows::Win32::{
        Foundation::COLORREF,
        UI::WindowsAndMessaging::{
            GetWindowLongW, LWA_ALPHA, SetLayeredWindowAttributes, SetWindowLongW, GWL_EXSTYLE,
            WS_EX_LAYERED,
        },
    };

    let alpha = (opacity.clamp(0.58, 1.0) * 255.0).round() as u8;

    unsafe {
        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if alpha >= 255 {
            if ex_style & WS_EX_LAYERED.0 != 0 {
                SetWindowLongW(hwnd, GWL_EXSTYLE, (ex_style & !WS_EX_LAYERED.0) as i32);
            }
            return Ok(());
        }

        if ex_style & WS_EX_LAYERED.0 == 0 {
            SetWindowLongW(hwnd, GWL_EXSTYLE, (ex_style | WS_EX_LAYERED.0) as i32);
        }

        SetLayeredWindowAttributes(hwnd, COLORREF(0), alpha, LWA_ALPHA)
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn read_connection_password(connection_id: &str) -> Result<Option<String>, String> {
    use windows::{core::PCWSTR, Win32::Security::Credentials::{CredFree, CredReadW, CRED_TYPE_GENERIC}};
    let target = wide(&password_target(connection_id));
    let mut credential = std::ptr::null_mut();
    unsafe { match CredReadW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None, &mut credential) {
        Ok(()) if !credential.is_null() => { let entry = &*credential; let bytes = std::slice::from_raw_parts(entry.CredentialBlob, entry.CredentialBlobSize as usize); let result = String::from_utf8(bytes.to_vec()).map(Some).map_err(|error| error.to_string()); CredFree(credential.cast()); result },
        Ok(()) => Ok(None),
        Err(error) if matches!(error.code().0 as u32, 1168 | 0x80070490) => Ok(None),
        Err(error) => Err(error.to_string()),
    }}
}
#[cfg(not(target_os = "windows"))]
fn read_connection_password(_: &str) -> Result<Option<String>, String> { Ok(None) }

#[cfg(target_os = "windows")]
fn write_connection_password(connection_id: &str, password: &str) -> Result<(), String> {
    use windows::{core::PWSTR, Win32::Security::Credentials::{CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC}};
    let target = wide(&password_target(connection_id)); let user = wide("FleurTerm"); let mut secret = password.as_bytes().to_vec();
    let credential = CREDENTIALW { Type: CRED_TYPE_GENERIC, TargetName: PWSTR(target.as_ptr() as *mut _), CredentialBlobSize: secret.len() as u32, CredentialBlob: secret.as_mut_ptr(), Persist: CRED_PERSIST_LOCAL_MACHINE, UserName: PWSTR(user.as_ptr() as *mut _), ..Default::default() };
    unsafe { CredWriteW(&credential, 0).map_err(|error| error.to_string()) }
}
#[cfg(not(target_os = "windows"))]
fn write_connection_password(_: &str, _: &str) -> Result<(), String> { Ok(()) }

#[cfg(target_os = "windows")]
fn remove_connection_password(connection_id: &str) -> Result<(), String> { use windows::{core::PCWSTR, Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC}}; let target = wide(&password_target(connection_id)); unsafe { match CredDeleteW(PCWSTR(target.as_ptr()), CRED_TYPE_GENERIC, None) { Ok(()) => Ok(()), Err(error) if matches!(error.code().0 as u32, 1168 | 0x80070490) => Ok(()), Err(error) => Err(error.to_string()) } } }
#[cfg(not(target_os = "windows"))]
fn remove_connection_password(_: &str) -> Result<(), String> { Ok(()) }
#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain(std::iter::once(0)).collect() }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            session_open_local,
            session_ack_output,
            session_write,
            session_resize,
            session_interrupt,
            session_close,
            load_app_settings,
            save_app_settings,
            load_connection_passwords,
            save_connection_password,
            delete_connection_password,
            set_window_opacity
        ])
        .build(tauri::generate_context!())
        .expect("failed to build FleurTerm desktop application");

    application.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            let state = app_handle.state::<AppState>();
            if let Err(error) = tauri::async_runtime::block_on(state.close_all()) {
                tracing::error!(code = error.code, message = %error.message, "failed to close terminal sessions during application exit");
            }
        }
    });
}
