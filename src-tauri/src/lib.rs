mod credential_vault;
#[cfg(target_os = "windows")]
mod credentials;
pub mod ipc;
pub mod session;

use credential_vault::{CredentialVault, CredentialVaultError, platform_device_identifier};
use ipc::session_commands::{
    AppState, session_ack_output, session_close, session_interrupt, session_open_local,
    session_resize, session_write,
};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, fs, io::ErrorKind, sync::Mutex};
use tauri::Manager;
use zeroize::Zeroize;

const APP_SETTINGS_FILE_NAME: &str = "settings.json";
const CREDENTIAL_VAULT_FILE_NAME: &str = "credentials.vault";
const CREDENTIAL_INSTALLATION_KEY_FILE_NAME: &str = "credentials.key";
const MIN_WINDOW_OPACITY: f64 = 0.58;
const MAX_WINDOW_OPACITY: f64 = 1.0;

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
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let path = directory.join(APP_SETTINGS_FILE_NAME);
    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(settings) => Ok(AppSettingsPayload {
                exists: true,
                path: path.display().to_string(),
                settings: Some(settings),
                error: None,
            }),
            Err(error) => Ok(AppSettingsPayload {
                exists: true,
                path: path.display().to_string(),
                settings: None,
                error: Some(format!("Failed to parse settings: {error}")),
            }),
        },
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(AppSettingsPayload {
            exists: false,
            path: path.display().to_string(),
            settings: None,
            error: None,
        }),
        Err(error) => Ok(AppSettingsPayload {
            exists: false,
            path: path.display().to_string(),
            settings: None,
            error: Some(format!("Failed to read settings: {error}")),
        }),
    }
}

#[tauri::command]
fn save_app_settings(app: tauri::AppHandle, settings: Value) -> Result<String, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(APP_SETTINGS_FILE_NAME);
    fs::write(
        &path,
        serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn load_connection_passwords(
    connection_ids: Vec<String>,
    vault: tauri::State<'_, Mutex<CredentialVault>>,
) -> Result<HashMap<String, String>, String> {
    #[cfg(target_os = "macos")]
    {
        return vault
            .lock()
            .map_err(|_| "VAULT_STATE_UNAVAILABLE".to_string())?
            .load_passwords(&connection_ids)
            .map_err(|error| error.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let _ = vault;
        return credentials::load_connection_passwords(&connection_ids);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = vault;
        let _ = connection_ids;
        Ok(HashMap::new())
    }
}

#[tauri::command]
fn save_connection_password(
    connection_id: String,
    mut password: String,
    vault: tauri::State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let result = vault
        .lock()
        .map_err(|_| "VAULT_STATE_UNAVAILABLE".to_string())?
        .save_password(&connection_id, &password)
        .map_err(|error| error.to_string());

    #[cfg(target_os = "windows")]
    let result = {
        let _ = vault;
        credentials::save_connection_password(&connection_id, &password)
    };

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let result = {
        let _ = vault;
        Ok(())
    };

    password.zeroize();
    result
}

#[tauri::command]
fn delete_connection_password(
    connection_id: String,
    vault: tauri::State<'_, Mutex<CredentialVault>>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return vault
            .lock()
            .map_err(|_| "VAULT_STATE_UNAVAILABLE".to_string())?
            .delete_password(&connection_id)
            .map_err(|error| error.to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let _ = vault;
        return credentials::delete_connection_password(&connection_id);
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = vault;
        let _ = connection_id;
        Ok(())
    }
}

#[tauri::command]
fn set_window_opacity(window: tauri::Window, opacity: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        apply_window_opacity(hwnd, opacity)
    }

    #[cfg(target_os = "macos")]
    {
        apply_window_opacity(window, opacity)
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = window;
        let _ = opacity;
        Ok(())
    }
}

fn normalize_window_opacity(opacity: f64) -> f64 {
    opacity.clamp(MIN_WINDOW_OPACITY, MAX_WINDOW_OPACITY)
}

fn device_identifier_for_vault(identifier_result: Result<String, CredentialVaultError>) -> String {
    match identifier_result {
        Ok(identifier) => identifier,
        Err(error) => {
            tracing::warn!(%error, "device-bound credential storage is unavailable");
            String::new()
        }
    }
}

#[cfg(target_os = "macos")]
fn apply_window_opacity(window: tauri::Window, opacity: f64) -> Result<(), String> {
    use objc2_app_kit::NSWindow;

    let normalized_opacity = normalize_window_opacity(opacity);
    let window_for_update = window.clone();
    window
        .run_on_main_thread(move || match window_for_update.ns_window() {
            Ok(native_window) => {
                let native_window = unsafe { &*native_window.cast::<NSWindow>() };
                native_window.setAlphaValue(normalized_opacity);
            }
            Err(error) => {
                tracing::error!(%error, "failed to access the native macOS window");
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn apply_window_opacity(
    hwnd: windows::Win32::Foundation::HWND,
    opacity: f64,
) -> Result<(), String> {
    use windows::Win32::{
        Foundation::COLORREF,
        UI::WindowsAndMessaging::{
            GWL_EXSTYLE, GetWindowLongW, LWA_ALPHA, SetLayeredWindowAttributes, SetWindowLongW,
            WS_EX_LAYERED,
        },
    };

    let alpha = (normalize_window_opacity(opacity) * 255.0).round() as u8;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .setup(|app| {
            let directory = app.path().app_config_dir()?;
            let device_identifier = device_identifier_for_vault(platform_device_identifier());
            app.manage(Mutex::new(CredentialVault::new(
                directory.join(CREDENTIAL_VAULT_FILE_NAME),
                directory.join(CREDENTIAL_INSTALLATION_KEY_FILE_NAME),
                device_identifier,
            )));
            Ok(())
        })
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
            if let Ok(mut credential_vault) = app_handle
                .state::<Mutex<CredentialVault>>()
                .lock()
            {
                credential_vault.lock();
            }
            let state = app_handle.state::<AppState>();
            if let Err(error) = tauri::async_runtime::block_on(state.close_all()) {
                tracing::error!(code = error.code, message = %error.message, "failed to close terminal sessions during application exit");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        credential_vault::CredentialVaultError, device_identifier_for_vault,
        normalize_window_opacity,
    };

    #[test]
    fn window_opacity_is_limited_to_the_supported_range() {
        assert_eq!(normalize_window_opacity(0.2), 0.58);
        assert_eq!(normalize_window_opacity(0.75), 0.75);
        assert_eq!(normalize_window_opacity(1.4), 1.0);
    }

    #[test]
    fn device_identifier_failure_does_not_abort_application_setup() {
        let identifier =
            device_identifier_for_vault(Err(CredentialVaultError::DeviceIdentifierUnavailable));

        assert!(identifier.is_empty());
    }
}
