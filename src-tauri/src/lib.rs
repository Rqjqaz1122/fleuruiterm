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
#[cfg(target_os = "macos")]
use std::collections::HashSet;
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
#[cfg(target_os = "macos")]
const WINDOW_ZOOM_ANIMATION_DURATION: Duration = Duration::from_millis(360);
#[cfg(target_os = "macos")]
const WINDOW_ZOOM_FRAME_INTERVAL: Duration = Duration::from_millis(16);
const MENU_ACTION_EVENT: &str = "fleurterm://menu-action";
const APPLICATION_EXIT_REQUESTED_EVENT: &str = "fleurterm://application-exit-requested";
const MENU_NEW_TERMINAL: &str = "new-terminal";
const MENU_CLOSE_TAB: &str = "close-tab";
const MENU_NEXT_TAB: &str = "next-tab";
const MENU_PREVIOUS_TAB: &str = "previous-tab";
const MENU_OPEN_SETTINGS: &str = "open-settings";
const MENU_TOGGLE_AI: &str = "toggle-ai";
const MENU_CLEAR_TERMINAL: &str = "clear-terminal";

#[cfg(any(not(target_os = "macos"), test))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowZoomAction {
    Maximize,
    Unmaximize,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[cfg(target_os = "macos")]
impl WindowBounds {
    const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq)]
struct MacosWindowFrame {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[cfg(target_os = "macos")]
impl MacosWindowFrame {
    const fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }
}

#[cfg(target_os = "macos")]
fn macos_window_frame_for_bounds(
    start_frame: MacosWindowFrame,
    start_bounds: WindowBounds,
    current_bounds: WindowBounds,
    scale_factor: f64,
) -> MacosWindowFrame {
    let start_bottom = f64::from(start_bounds.y) + f64::from(start_bounds.height);
    let current_bottom = f64::from(current_bounds.y) + f64::from(current_bounds.height);
    MacosWindowFrame::new(
        start_frame.x + (f64::from(current_bounds.x) - f64::from(start_bounds.x)) / scale_factor,
        start_frame.y - (current_bottom - start_bottom) / scale_factor,
        start_frame.width
            + (f64::from(current_bounds.width) - f64::from(start_bounds.width)) / scale_factor,
        start_frame.height
            + (f64::from(current_bounds.height) - f64::from(start_bounds.height)) / scale_factor,
    )
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct WindowZoomTransition {
    target_bounds: WindowBounds,
    restore_bounds_after: Option<WindowBounds>,
}

#[derive(Default)]
struct WindowZoomState {
    #[cfg(target_os = "macos")]
    runtime: Mutex<WindowZoomRuntimeState>,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct WindowZoomRuntimeState {
    restore_bounds_by_window: HashMap<String, WindowBounds>,
    animating_window_labels: HashSet<String>,
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
async fn toggle_window_zoom(
    window: tauri::Window,
    zoom_state: tauri::State<'_, WindowZoomState>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return toggle_macos_window_zoom(&window, zoom_state.inner()).await;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = zoom_state;
        let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
        match next_window_zoom_action(is_maximized) {
            WindowZoomAction::Maximize => window.maximize().map_err(|error| error.to_string()),
            WindowZoomAction::Unmaximize => window.unmaximize().map_err(|error| error.to_string()),
        }
    }
}

#[cfg(any(not(target_os = "macos"), test))]
fn next_window_zoom_action(is_maximized: bool) -> WindowZoomAction {
    if is_maximized {
        WindowZoomAction::Unmaximize
    } else {
        WindowZoomAction::Maximize
    }
}

#[cfg(target_os = "macos")]
fn next_macos_window_zoom_transition(
    restore_bounds: Option<WindowBounds>,
    current_bounds: WindowBounds,
    work_area_bounds: WindowBounds,
) -> WindowZoomTransition {
    match restore_bounds {
        Some(target_bounds) => WindowZoomTransition {
            target_bounds,
            restore_bounds_after: None,
        },
        None => WindowZoomTransition {
            target_bounds: work_area_bounds,
            restore_bounds_after: Some(current_bounds),
        },
    }
}

#[cfg(target_os = "macos")]
fn interpolate_window_bounds(
    start_bounds: WindowBounds,
    target_bounds: WindowBounds,
    progress: f64,
) -> WindowBounds {
    let normalized_progress = progress.clamp(0.0, 1.0);
    let eased_progress = 1.0 - (1.0 - normalized_progress).powi(3);
    let x = interpolate_i32(start_bounds.x, target_bounds.x, eased_progress);
    let right_edge = interpolate_i64(
        i64::from(start_bounds.x) + i64::from(start_bounds.width),
        i64::from(target_bounds.x) + i64::from(target_bounds.width),
        eased_progress,
    );
    let width = u32::try_from((right_edge - i64::from(x)).max(0)).unwrap_or(u32::MAX);
    WindowBounds::new(
        x,
        interpolate_i32(start_bounds.y, target_bounds.y, eased_progress),
        width,
        interpolate_u32(start_bounds.height, target_bounds.height, eased_progress),
    )
}

#[cfg(target_os = "macos")]
fn interpolate_i32(start: i32, target: i32, progress: f64) -> i32 {
    (f64::from(start) + (f64::from(target) - f64::from(start)) * progress).round() as i32
}

#[cfg(target_os = "macos")]
fn interpolate_i64(start: i64, target: i64, progress: f64) -> i64 {
    (start as f64 + (target - start) as f64 * progress).round() as i64
}

#[cfg(target_os = "macos")]
fn interpolate_u32(start: u32, target: u32, progress: f64) -> u32 {
    (f64::from(start) + (f64::from(target) - f64::from(start)) * progress).round() as u32
}

#[cfg(target_os = "macos")]
async fn toggle_macos_window_zoom(
    window: &tauri::Window,
    zoom_state: &WindowZoomState,
) -> Result<(), String> {
    let current_position = window.outer_position().map_err(|error| error.to_string())?;
    let current_size = window.outer_size().map_err(|error| error.to_string())?;
    let current_bounds = WindowBounds::new(
        current_position.x,
        current_position.y,
        current_size.width,
        current_size.height,
    );
    let window_label = window.label();
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "WINDOW_MONITOR_UNAVAILABLE".to_string())?;
    let work_area = monitor.work_area();
    let work_area_bounds = WindowBounds::new(
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
    );
    let transition = {
        let mut runtime = zoom_state
            .runtime
            .lock()
            .map_err(|_| "WINDOW_ZOOM_STATE_UNAVAILABLE".to_string())?;
        if !runtime
            .animating_window_labels
            .insert(window_label.to_string())
        {
            return Ok(());
        }
        let restore_bounds = runtime.restore_bounds_by_window.get(window_label).copied();
        next_macos_window_zoom_transition(restore_bounds, current_bounds, work_area_bounds)
    };

    let animation_result =
        animate_window_bounds(window, current_bounds, transition.target_bounds).await;
    let mut runtime = zoom_state
        .runtime
        .lock()
        .map_err(|_| "WINDOW_ZOOM_STATE_UNAVAILABLE".to_string())?;
    runtime.animating_window_labels.remove(window_label);
    if animation_result.is_ok() {
        match transition.restore_bounds_after {
            Some(bounds) => {
                runtime
                    .restore_bounds_by_window
                    .insert(window_label.to_string(), bounds);
            }
            None => {
                runtime.restore_bounds_by_window.remove(window_label);
            }
        }
    }
    animation_result
}

#[cfg(target_os = "macos")]
async fn animate_window_bounds(
    window: &tauri::Window,
    start_bounds: WindowBounds,
    target_bounds: WindowBounds,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let mut previous_bounds = start_bounds;
    loop {
        let elapsed = started_at.elapsed();
        let progress = elapsed.as_secs_f64() / WINDOW_ZOOM_ANIMATION_DURATION.as_secs_f64();
        let current_bounds = interpolate_window_bounds(start_bounds, target_bounds, progress);
        apply_macos_window_frame(window, previous_bounds, current_bounds).await?;
        if progress >= 1.0 {
            return Ok(());
        }
        previous_bounds = current_bounds;
        tokio::time::sleep(WINDOW_ZOOM_FRAME_INTERVAL).await;
    }
}

#[cfg(target_os = "macos")]
async fn apply_macos_window_frame(
    window: &tauri::Window,
    previous_bounds: WindowBounds,
    current_bounds: WindowBounds,
) -> Result<(), String> {
    use objc2_app_kit::NSWindow;

    let scale_factor = window.scale_factor().map_err(|error| error.to_string())?;
    if !scale_factor.is_finite() || scale_factor <= 0.0 {
        return Err("WINDOW_SCALE_FACTOR_INVALID".to_string());
    }

    let window_for_update = window.clone();
    let (result_sender, result_receiver) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let update_result = (|| {
                let native_window_pointer = window_for_update
                    .ns_window()
                    .map_err(|error| error.to_string())?;
                let native_window = unsafe { &*native_window_pointer.cast::<NSWindow>() };
                let mut native_frame = NSWindow::frame(native_window);
                let target_frame = macos_window_frame_for_bounds(
                    MacosWindowFrame::new(
                        native_frame.origin.x,
                        native_frame.origin.y,
                        native_frame.size.width,
                        native_frame.size.height,
                    ),
                    previous_bounds,
                    current_bounds,
                    scale_factor,
                );
                native_frame.origin.x = target_frame.x;
                native_frame.origin.y = target_frame.y;
                native_frame.size.width = target_frame.width;
                native_frame.size.height = target_frame.height;
                NSWindow::setFrame_display(native_window, native_frame, true);
                Ok(())
            })();
            let _ = result_sender.send(update_result);
        })
        .map_err(|error| error.to_string())?;

    result_receiver
        .await
        .map_err(|_| "WINDOW_FRAME_UPDATE_CANCELLED".to_string())?
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
        .manage(WindowZoomState::default())
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
    #[cfg(target_os = "macos")]
    use super::{
        MacosWindowFrame, WINDOW_ZOOM_ANIMATION_DURATION, WindowBounds, interpolate_window_bounds,
        macos_window_frame_for_bounds, next_macos_window_zoom_transition,
    };
    use serde_json::json;
    #[cfg(target_os = "macos")]
    use std::time::Duration;

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

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_window_zoom_uses_work_area_bounds_and_restores_previous_bounds() {
        let current_bounds = WindowBounds::new(120, 80, 1180, 760);
        let work_area_bounds = WindowBounds::new(0, 25, 1728, 1080);

        let maximize_transition =
            next_macos_window_zoom_transition(None, current_bounds, work_area_bounds);
        assert_eq!(maximize_transition.target_bounds, work_area_bounds);
        assert_eq!(
            maximize_transition.restore_bounds_after,
            Some(current_bounds)
        );

        let restore_transition = next_macos_window_zoom_transition(
            maximize_transition.restore_bounds_after,
            work_area_bounds,
            work_area_bounds,
        );
        assert_eq!(restore_transition.target_bounds, current_bounds);
        assert_eq!(restore_transition.restore_bounds_after, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_window_zoom_animation_uses_eased_window_bounds() {
        let start_bounds = WindowBounds::new(100, 80, 1000, 700);
        let target_bounds = WindowBounds::new(0, 25, 1728, 1080);

        assert_eq!(
            interpolate_window_bounds(start_bounds, target_bounds, 0.0),
            start_bounds
        );
        assert_eq!(
            interpolate_window_bounds(start_bounds, target_bounds, 1.0),
            target_bounds
        );

        let halfway_bounds = interpolate_window_bounds(start_bounds, target_bounds, 0.5);
        assert!(halfway_bounds.x < 50);
        assert!(halfway_bounds.y < 53);
        assert!(halfway_bounds.width > 1364);
        assert!(halfway_bounds.height > 890);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_window_zoom_animation_keeps_the_right_edge_on_its_eased_path() {
        let start_bounds = WindowBounds::new(100, 80, 1000, 700);
        let target_bounds = WindowBounds::new(0, 25, 1728, 1080);

        let current_bounds = interpolate_window_bounds(start_bounds, target_bounds, 0.3);
        let current_right_edge = i64::from(current_bounds.x) + i64::from(current_bounds.width);

        assert_eq!(current_right_edge, 1513);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_window_zoom_converts_outer_bounds_to_one_native_frame() {
        let start_bounds = WindowBounds::new(200, 100, 1000, 800);
        let current_bounds = WindowBounds::new(100, 50, 1200, 1000);
        let start_frame = MacosWindowFrame::new(100.0, 200.0, 500.0, 400.0);

        assert_eq!(
            macos_window_frame_for_bounds(start_frame, start_bounds, current_bounds, 2.0),
            MacosWindowFrame::new(50.0, 125.0, 600.0, 500.0)
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_window_zoom_animation_uses_a_readable_duration() {
        assert_eq!(WINDOW_ZOOM_ANIMATION_DURATION, Duration::from_millis(360));
    }

    #[test]
    fn macos_window_background_matches_application_canvas() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.macos.conf.json")).unwrap();

        assert_eq!(
            config["app"]["windows"][0]["backgroundColor"],
            json!("#000000")
        );
        assert_eq!(config["app"]["macOSPrivateApi"], json!(true));
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
