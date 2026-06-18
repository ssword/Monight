// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::Parser;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Listener, Manager};

mod commands;
mod menu;

/// Command line arguments for Monight PDF viewer
#[derive(Parser, Debug, Clone)]
#[command(name = "Monight")]
#[command(about = "Monight (墨页) - A modern PDF reader", long_about = None)]
struct Cli {
    /// PDF file(s) to open
    #[arg(value_name = "FILE")]
    files: Vec<String>,

    /// Page number to open (applies to first file only)
    #[arg(short, long, value_name = "PAGE")]
    page: Option<u32>,
}

/// Payload sent to frontend with CLI arguments
#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct CliPayload {
    files: Vec<String>,
    page: Option<u32>,
}

pub struct PendingCliPayload(pub Mutex<Option<CliPayload>>);

pub(crate) fn is_supported_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "pdf" | "xdp" | "fdf" | "xfdf"
            )
        })
        .unwrap_or(false)
}

pub(crate) fn store_pending_payload_inner(state: &PendingCliPayload, payload: CliPayload) {
    let mut guard = state.0.lock().unwrap();
    if let Some(existing) = guard.as_mut() {
        existing.files.extend(payload.files);
        if existing.page.is_none() {
            existing.page = payload.page;
        }
    } else {
        *guard = Some(payload);
    }
}

pub(crate) fn take_cli_payload_inner(state: &PendingCliPayload) -> Option<CliPayload> {
    let mut guard = state.0.lock().unwrap();
    guard.take()
}

fn store_pending_payload(app: &tauri::AppHandle, payload: CliPayload) {
    let state = app.state::<PendingCliPayload>();
    store_pending_payload_inner(state.inner(), payload);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(PendingCliPayload(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::read_pdf_file,
            commands::get_file_name,
            commands::get_file_directory,
            commands::open_settings,
            commands::set_print_enabled,
            commands::fit_main_window_for_pdf,
            commands::take_cli_payload,
            commands::validate_open_path,
            commands::open_external_url,
        ])
        .setup(|app| {
            // Parse command line arguments (ignore macOS Finder -psn_* argument)
            let cli = Cli::parse_from(std::env::args().filter(|arg| !arg.starts_with("-psn_")));
            let window = app.get_webview_window("main").unwrap();
            let app_handle = app.handle();

            // Create and set application menu
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            // Handle files opened via file association (double-click in OS)
            // macOS/iOS/Windows send tauri://file-open event
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "windows"))]
            {
                let window_for_open = window.clone();
                let app_handle_for_open = app_handle.clone();
                app_handle.listen("tauri://file-open", move |event| {
                    let payload = event.payload();
                    if payload.is_empty() {
                        return;
                    }

                    let mut files: Vec<String> = Vec::new();

                    if let Ok(list) = serde_json::from_str::<Vec<String>>(payload) {
                        files.extend(list);
                    } else if let Ok(single) = serde_json::from_str::<String>(payload) {
                        files.push(single);
                    } else {
                        files.push(payload.to_string());
                    }

                    let mut valid_files = Vec::new();
                    for file_path in files {
                        if let Ok(canonical) = std::fs::canonicalize(&file_path) {
                            if canonical.exists() && is_supported_extension(&canonical) {
                                valid_files.push(canonical.to_string_lossy().to_string());
                            }
                        }
                    }

                    if !valid_files.is_empty() {
                        let payload = CliPayload {
                            files: valid_files,
                            page: None,
                        };
                        let _ =
                            commands::fit_main_window_for_pdf(app_handle_for_open.clone(), true);
                        store_pending_payload(&app_handle_for_open, payload.clone());
                        let _ = window_for_open.emit("cli-open-files", payload);
                    }
                });
            }

            // If files were provided via CLI, emit event to frontend
            if !cli.files.is_empty() {
                // Validate and canonicalize paths
                let mut valid_files = Vec::new();
                for file in cli.files {
                    if let Ok(canonical) = std::fs::canonicalize(&file) {
                        if canonical.exists() && is_supported_extension(&canonical) {
                            valid_files.push(canonical.to_string_lossy().to_string());
                        } else {
                            #[cfg(debug_assertions)]
                            eprintln!("File not found: {}", file);
                        }
                    } else {
                        #[cfg(debug_assertions)]
                        eprintln!("Invalid path: {}", file);
                    }
                }

                // Only emit if we have valid files
                if !valid_files.is_empty() {
                    let payload = CliPayload {
                        files: valid_files,
                        page: cli.page,
                    };

                    #[cfg(debug_assertions)]
                    println!("Opening files from CLI: {:?}", payload.files);

                    // Store and emit event (frontend will also pull pending on ready)
                    let _ = commands::fit_main_window_for_pdf(app_handle.clone(), true);
                    store_pending_payload(&app_handle, payload.clone());
                    window.emit("cli-open-files", payload)?;
                }
            }

            // Show window after setup complete
            window.show().unwrap();

            // Log startup
            #[cfg(debug_assertions)]
            println!("Monight (墨页) started successfully!");

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pending_cli_payload_flow() {
        let state = PendingCliPayload(Mutex::new(None));

        let payload = CliPayload {
            files: vec!["/tmp/a.pdf".to_string()],
            page: Some(2),
        };
        store_pending_payload_inner(&state, payload.clone());
        let taken = take_cli_payload_inner(&state).expect("payload should be present");
        assert_eq!(taken, payload);
        assert!(take_cli_payload_inner(&state).is_none());

        let payload_a = CliPayload {
            files: vec!["/tmp/one.pdf".to_string()],
            page: None,
        };
        let payload_b = CliPayload {
            files: vec!["/tmp/two.pdf".to_string()],
            page: Some(7),
        };
        store_pending_payload_inner(&state, payload_a);
        store_pending_payload_inner(&state, payload_b);
        let merged = take_cli_payload_inner(&state).expect("merged payload should be present");
        assert_eq!(merged.files, vec!["/tmp/one.pdf", "/tmp/two.pdf"]);
        assert_eq!(merged.page, Some(7));
    }
}
