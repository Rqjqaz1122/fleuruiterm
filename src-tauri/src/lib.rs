pub mod ipc;
pub mod session;

use ipc::session_commands::{
    AppState, session_close, session_interrupt, session_open_local, session_resize, session_write,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            session_open_local,
            session_write,
            session_resize,
            session_interrupt,
            session_close
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
