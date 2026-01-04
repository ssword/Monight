// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::read_pdf_file,
            commands::get_file_name,
            commands::get_file_directory,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Show window after setup complete
            window.show().unwrap();

            // Log startup
            #[cfg(debug_assertions)]
            println!("Monight (墨页) started successfully!");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
