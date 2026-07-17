pub mod ipc;
pub mod session;

use ipc::session_commands::{
    AppState, session_close, session_interrupt, session_open_local, session_resize, session_write,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            session_open_local,
            session_write,
            session_resize,
            session_interrupt,
            session_close
        ])
        .run(tauri::generate_context!())
        .expect("failed to run FleurTerm desktop application");
}
