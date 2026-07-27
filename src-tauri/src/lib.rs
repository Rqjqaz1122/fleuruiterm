mod credential_vault;
#[cfg(target_os = "windows")]
mod credentials;
pub mod ipc;
pub mod session;
pub mod sftp;

use credential_vault::{CredentialVault, CredentialVaultError, platform_device_identifier};
use ipc::session_commands::{
    AppState, session_ack_output, session_close, session_interrupt, session_open_local,
    session_resize, session_write,
};
use ipc::sftp_commands::{
    sftp_close, sftp_download_file, sftp_list_directory, sftp_open, sftp_upload_files,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    io::Write,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{
    Emitter, Manager, Runtime,
    menu::{AboutMetadataBuilder, Menu, MenuBuilder, MenuItem, SubmenuBuilder},
};
use zeroize::Zeroize;

pub(crate) const APP_SETTINGS_FILE_NAME: &str = "settings.json";
const TERMINAL_WORKSPACE_FILE_NAME: &str = "workspace.json";
const CREDENTIAL_VAULT_FILE_NAME: &str = "credentials.vault";
const CREDENTIAL_INSTALLATION_KEY_FILE_NAME: &str = "credentials.key";
const MIN_WINDOW_OPACITY: f64 = 0.58;
const MAX_WINDOW_OPACITY: f64 = 1.0;
const MENU_ACTION_EVENT: &str = "fleurterm://menu-action";
const APPLICATION_EXIT_REQUESTED_EVENT: &str = "fleurterm://application-exit-requested";
const MENU_NEW_TERMINAL: &str = "new-terminal";
const MENU_CLOSE_TAB: &str = "close-tab";
const MENU_NEXT_TAB: &str = "next-tab";
const MENU_PREVIOUS_TAB: &str = "previous-tab";
const MENU_OPEN_SETTINGS: &str = "open-settings";
const MENU_TOGGLE_AI: &str = "toggle-ai";
const MENU_CLEAR_TERMINAL: &str = "clear-terminal";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowZoomAction {
    Maximize,
    Unmaximize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettingsPayload {
    exists: bool,
    path: String,
    settings: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedTerminalWorkspace {
    version: u8,
    active_tab_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    settings_tab_index: Option<usize>,
    tabs: Vec<PersistedTerminalTab>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PersistedTerminalTab {
    id: String,
    title: String,
    launch: PersistedTerminalLaunch,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum PersistedTerminalLaunch {
    Local {
        #[serde(skip_serializing_if = "Option::is_none")]
        shell: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        args: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cwd: Option<String>,
    },
    SavedConnection {
        connection_profile_id: String,
    },
}

#[derive(Default)]
struct ApplicationExitState {
    approved: AtomicBool,
}

impl ApplicationExitState {
    fn approve(&self) {
        self.approved.store(true, Ordering::SeqCst);
    }

    fn revoke(&self) {
        self.approved.store(false, Ordering::SeqCst);
    }

    fn take_approval(&self) -> bool {
        self.approved.swap(false, Ordering::SeqCst)
    }
}

fn should_intercept_application_exit(approved: bool, exit_code: Option<i32>) -> bool {
    !approved && exit_code != Some(tauri::RESTART_EXIT_CODE)
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
fn save_app_settings(
    app: tauri::AppHandle,
    settings: Value,
    state: tauri::State<'_, AppState>,
) -> Result<String, String> {
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
    state
        .reconcile_sftp_bindings(&settings)
        .map_err(|error| error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn load_terminal_workspace(
    app: tauri::AppHandle,
) -> Result<Option<PersistedTerminalWorkspace>, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    let path = directory.join(TERMINAL_WORKSPACE_FILE_NAME);
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content)
            .map(Some)
            .map_err(|error| format!("Failed to parse terminal workspace: {error}")),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read terminal workspace: {error}")),
    }
}

#[tauri::command]
fn save_terminal_workspace(
    app: tauri::AppHandle,
    workspace: PersistedTerminalWorkspace,
) -> Result<String, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join(TERMINAL_WORKSPACE_FILE_NAME);
    let mut temporary_file =
        tempfile::NamedTempFile::new_in(&directory).map_err(|error| error.to_string())?;
    serde_json::to_writer_pretty(temporary_file.as_file_mut(), &workspace)
        .map_err(|error| error.to_string())?;
    temporary_file
        .as_file_mut()
        .write_all(b"\n")
        .map_err(|error| error.to_string())?;
    temporary_file
        .as_file_mut()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary_file
        .persist(&path)
        .map_err(|error| error.error.to_string())?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn approve_application_exit(
    app: tauri::AppHandle,
    exit_state: tauri::State<'_, ApplicationExitState>,
) {
    exit_state.approve();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        app.state::<ApplicationExitState>().revoke();
    });
}

#[tauri::command]
fn revoke_application_exit(exit_state: tauri::State<'_, ApplicationExitState>) {
    exit_state.revoke();
}

#[tauri::command]
fn complete_application_exit(
    app: tauri::AppHandle,
    exit_state: tauri::State<'_, ApplicationExitState>,
) {
    exit_state.approve();
    app.exit(0);
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

#[tauri::command]
fn toggle_window_zoom(window: tauri::Window) -> Result<(), String> {
    let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
    match next_window_zoom_action(is_maximized) {
        WindowZoomAction::Maximize => window.maximize().map_err(|error| error.to_string()),
        WindowZoomAction::Unmaximize => window.unmaximize().map_err(|error| error.to_string()),
    }
}

fn next_window_zoom_action(is_maximized: bool) -> WindowZoomAction {
    if is_maximized {
        WindowZoomAction::Unmaximize
    } else {
        WindowZoomAction::Maximize
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

fn build_application_menu<R: Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    let about_metadata = AboutMetadataBuilder::new()
        .name(Some("FleurTerm"))
        .version(Some(app.package_info().version.to_string()))
        .comments(Some("FleurUI terminal workspace"))
        .website(Some("https://github.com/Rqjqaz1122/fleuruiterm"))
        .website_label(Some("FleurTerm on GitHub"))
        .build();

    let settings_item =
        MenuItem::with_id(app, MENU_OPEN_SETTINGS, "Settings…", true, None::<&str>)?;
    let new_terminal_item =
        MenuItem::with_id(app, MENU_NEW_TERMINAL, "New Terminal", true, None::<&str>)?;
    let close_tab_item = MenuItem::with_id(app, MENU_CLOSE_TAB, "Close Tab", true, None::<&str>)?;
    let next_tab_item = MenuItem::with_id(app, MENU_NEXT_TAB, "Next Tab", true, None::<&str>)?;
    let previous_tab_item =
        MenuItem::with_id(app, MENU_PREVIOUS_TAB, "Previous Tab", true, None::<&str>)?;
    let toggle_ai_item = MenuItem::with_id(
        app,
        MENU_TOGGLE_AI,
        "Toggle AI Assistant",
        true,
        None::<&str>,
    )?;
    let clear_terminal_item = MenuItem::with_id(
        app,
        MENU_CLEAR_TERMINAL,
        "Clear Terminal",
        true,
        None::<&str>,
    )?;

    let application_menu = SubmenuBuilder::new(app, "FleurTerm")
        .about(Some(about_metadata.clone()))
        .separator()
        .item(&settings_item)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_terminal_item)
        .separator()
        .item(&close_tab_item)
        .build()?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&clear_terminal_item)
        .item(&toggle_ai_item)
        .separator()
        .fullscreen()
        .build()?;
    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .item(&next_tab_item)
        .item(&previous_tab_item)
        .separator()
        .bring_all_to_front()
        .build()?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .about_with_text("About FleurTerm", Some(about_metadata))
        .build()?;

    MenuBuilder::new(app)
        .items(&[
            &application_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()
}

fn menu_command(menu_item_id: &str) -> Option<&'static str> {
    match menu_item_id {
        MENU_NEW_TERMINAL => Some(MENU_NEW_TERMINAL),
        MENU_CLOSE_TAB => Some(MENU_CLOSE_TAB),
        MENU_NEXT_TAB => Some(MENU_NEXT_TAB),
        MENU_PREVIOUS_TAB => Some(MENU_PREVIOUS_TAB),
        MENU_OPEN_SETTINGS => Some(MENU_OPEN_SETTINGS),
        MENU_TOGGLE_AI => Some(MENU_TOGGLE_AI),
        MENU_CLEAR_TERMINAL => Some(MENU_CLEAR_TERMINAL),
        _ => None,
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .menu(build_application_menu)
        .on_menu_event(|app, event| {
            if let Some(command) = menu_command(event.id().as_ref()) {
                if let Err(error) = app.emit(MENU_ACTION_EVENT, command) {
                    tracing::error!(%error, command, "failed to dispatch application menu action");
                }
            }
        })
        .manage(AppState::new())
        .manage(ApplicationExitState::default())
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
            sftp_open,
            sftp_list_directory,
            sftp_upload_files,
            sftp_download_file,
            sftp_close,
            load_app_settings,
            save_app_settings,
            load_terminal_workspace,
            save_terminal_workspace,
            approve_application_exit,
            revoke_application_exit,
            complete_application_exit,
            load_connection_passwords,
            save_connection_password,
            delete_connection_password,
            set_window_opacity,
            toggle_window_zoom
        ])
        .build(tauri::generate_context!())
        .expect("failed to build FleurTerm desktop application");

    application.run(|app_handle, event| {
        let tauri::RunEvent::ExitRequested { code, api, .. } = event else {
            return;
        };
        let exit_state = app_handle.state::<ApplicationExitState>();
        if should_intercept_application_exit(exit_state.take_approval(), code) {
            api.prevent_exit();
            if let Err(error) = app_handle.emit(APPLICATION_EXIT_REQUESTED_EVENT, ()) {
                tracing::error!(%error, "failed to request terminal workspace flush before exit");
            }
            return;
        }
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
    });
}

#[cfg(test)]
mod tests {
    use super::{
        ApplicationExitState, MENU_CLEAR_TERMINAL, MENU_NEW_TERMINAL, PersistedTerminalLaunch,
        PersistedTerminalTab, PersistedTerminalWorkspace, WindowZoomAction,
        credential_vault::CredentialVaultError, device_identifier_for_vault, menu_command,
        next_window_zoom_action, normalize_window_opacity, should_intercept_application_exit,
    };
    use serde_json::json;

    #[test]
    fn window_opacity_is_limited_to_the_supported_range() {
        assert_eq!(normalize_window_opacity(0.2), 0.58);
        assert_eq!(normalize_window_opacity(0.75), 0.75);
        assert_eq!(normalize_window_opacity(1.4), 1.0);
    }

    #[test]
    fn window_zoom_action_uses_the_current_tauri_maximized_state() {
        assert_eq!(next_window_zoom_action(false), WindowZoomAction::Maximize);
        assert_eq!(next_window_zoom_action(true), WindowZoomAction::Unmaximize);
    }

    #[test]
    fn device_identifier_failure_does_not_abort_application_setup() {
        let identifier =
            device_identifier_for_vault(Err(CredentialVaultError::DeviceIdentifierUnavailable));

        assert!(identifier.is_empty());
    }

    #[test]
    fn application_menu_ids_map_to_frontend_commands() {
        assert_eq!(menu_command(MENU_NEW_TERMINAL), Some("new-terminal"));
        assert_eq!(menu_command(MENU_CLEAR_TERMINAL), Some("clear-terminal"));
        assert_eq!(menu_command("copy"), None);
    }

    #[test]
    fn terminal_workspace_schema_rejects_sensitive_launch_fields() {
        let workspace = json!({
            "version": 1,
            "activeTabId": "tab-1",
            "tabs": [{
                "id": "tab-1",
                "title": "Production",
                "launch": {
                    "type": "savedConnection",
                    "connectionProfileId": "production",
                    "password": "secret"
                }
            }]
        });

        assert!(serde_json::from_value::<PersistedTerminalWorkspace>(workspace).is_err());
    }

    #[test]
    fn terminal_workspace_schema_accepts_saved_connection_references() {
        let workspace = json!({
            "version": 1,
            "activeTabId": "tab-1",
            "tabs": [{
                "id": "tab-1",
                "title": "Production",
                "launch": {
                    "type": "savedConnection",
                    "connectionProfileId": "production"
                }
            }]
        });

        let parsed = serde_json::from_value::<PersistedTerminalWorkspace>(workspace)
            .expect("saved connection workspace should be valid");
        let serialized = serde_json::to_value(parsed).expect("workspace should serialize");

        assert_eq!(
            serialized["tabs"][0]["launch"]["connectionProfileId"],
            "production"
        );
        assert!(serialized["tabs"][0]["launch"].get("password").is_none());
    }

    #[test]
    fn terminal_workspace_omits_absent_local_launch_fields() {
        let workspace = PersistedTerminalWorkspace {
            version: 1,
            active_tab_id: Some("local-tab".to_string()),
            settings_tab_index: None,
            tabs: vec![PersistedTerminalTab {
                id: "local-tab".to_string(),
                title: "Local".to_string(),
                launch: PersistedTerminalLaunch::Local {
                    shell: None,
                    args: None,
                    cwd: None,
                },
            }],
        };

        let serialized = serde_json::to_value(workspace).expect("workspace should serialize");

        assert_eq!(serialized["tabs"][0]["launch"], json!({ "type": "local" }));
    }

    #[test]
    fn terminal_workspace_schema_accepts_settings_tab_metadata() {
        let workspace = json!({
            "version": 2,
            "activeTabId": "app-settings",
            "settingsTabIndex": 1,
            "tabs": [{
                "id": "local-tab",
                "title": "Local",
                "launch": { "type": "local" }
            }]
        });

        let parsed = serde_json::from_value::<PersistedTerminalWorkspace>(workspace)
            .expect("settings tab metadata should be valid");
        let serialized = serde_json::to_value(parsed).expect("workspace should serialize");

        assert_eq!(serialized["settingsTabIndex"], 1);
        assert_eq!(serialized["activeTabId"], "app-settings");
    }

    #[test]
    fn application_exit_is_intercepted_until_workspace_flush_is_approved() {
        assert!(should_intercept_application_exit(false, None));
        assert!(!should_intercept_application_exit(true, None));
        assert!(!should_intercept_application_exit(
            false,
            Some(tauri::RESTART_EXIT_CODE)
        ));
    }

    #[test]
    fn application_exit_approval_is_consumed_once() {
        let exit_state = ApplicationExitState::default();
        exit_state.approve();

        assert!(exit_state.take_approval());
        assert!(!exit_state.take_approval());
    }
}
