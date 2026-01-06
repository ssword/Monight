// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, Emitter, Listener};
use clap::Parser;
use serde::Serialize;

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
#[derive(Clone, Serialize)]
struct CliPayload {
    files: Vec<String>,
    page: Option<u32>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::read_pdf_file,
            commands::get_file_name,
            commands::get_file_directory,
            commands::open_settings,
            commands::set_print_enabled,
        ])
        .setup(|app| {
            // Parse command line arguments
            let cli = Cli::parse();
            let window = app.get_webview_window("main").unwrap();

            // Create and set application menu
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            // Handle files opened via file association (double-click in OS)
            // macOS/iOS/Windows send tauri://file-open event
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "windows"))]
            {
                let window_for_open = window.clone();
                app.handle().listen("tauri://file-open", move |event| {
                    let file_path = event.payload();

                    // Validate and canonicalize the path
                    if let Ok(canonical) = std::fs::canonicalize(file_path) {
                        // Check if file exists and has supported extension
                        if canonical.exists() {
                            let ext = canonical.extension().and_then(|e| e.to_str());
                            if ext == Some("pdf") || ext == Some("xdp") || ext == Some("fdf") || ext == Some("xfdf") {
                                let payload = CliPayload {
                                    files: vec![canonical.to_string_lossy().to_string()],
                                    page: None,
                                };
                                let _ = window_for_open.emit("cli-open-files", payload);
                            }
                        }
                    }
                });
            }

            // If files were provided via CLI, emit event to frontend
            if !cli.files.is_empty() {
                // Validate and canonicalize paths
                let mut valid_files = Vec::new();
                for file in cli.files {
                    if let Ok(canonical) = std::fs::canonicalize(&file) {
                        if canonical.exists() {
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

                    // Emit event after window is ready
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
