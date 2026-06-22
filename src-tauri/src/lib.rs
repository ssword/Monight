// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::Parser;
use serde::Serialize;
use std::path::PathBuf;
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

fn dispatch_open_payload(app: &tauri::AppHandle, payload: CliPayload) {
    let _ = commands::fit_main_window_for_pdf(app.clone(), true);
    store_pending_payload(app, payload.clone());

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("cli-open-files", payload);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn path_from_open_candidate(candidate: String) -> Option<PathBuf> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(url) = url::Url::parse(trimmed) {
        if url.scheme() == "file" {
            return url.to_file_path().ok();
        }
    }

    Some(PathBuf::from(trimmed))
}

pub(crate) fn paths_from_legacy_file_open_payload(payload: &str) -> Vec<PathBuf> {
    if payload.is_empty() {
        return Vec::new();
    }

    let mut files: Vec<String> = Vec::new();

    if let Ok(list) = serde_json::from_str::<Vec<String>>(payload) {
        files.extend(list);
    } else if let Ok(single) = serde_json::from_str::<String>(payload) {
        files.push(single);
    } else {
        files.push(payload.to_string());
    }

    files
        .into_iter()
        .filter_map(path_from_open_candidate)
        .collect()
}

pub(crate) fn payload_from_file_paths<I>(files: I, page: Option<u32>) -> Option<CliPayload>
where
    I: IntoIterator<Item = PathBuf>,
{
    let valid_files = files
        .into_iter()
        .filter_map(|file| std::fs::canonicalize(file).ok())
        .filter(|canonical| canonical.exists() && is_supported_extension(canonical))
        .map(|canonical| canonical.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    if valid_files.is_empty() {
        None
    } else {
        Some(CliPayload {
            files: valid_files,
            page,
        })
    }
}

pub(crate) fn payload_from_opened_urls(urls: &[url::Url]) -> Option<CliPayload> {
    payload_from_file_paths(
        urls.iter().filter_map(|url| {
            if url.scheme() == "file" {
                url.to_file_path().ok()
            } else {
                None
            }
        }),
        None,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
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
                let app_handle_for_open = app_handle.clone();
                app_handle.listen("tauri://file-open", move |event| {
                    let payload = event.payload();
                    if let Some(payload) =
                        payload_from_file_paths(paths_from_legacy_file_open_payload(payload), None)
                    {
                        dispatch_open_payload(&app_handle_for_open, payload);
                    }
                });
            }

            // If files were provided via CLI, emit event to frontend
            if !cli.files.is_empty() {
                let paths = cli.files.into_iter().map(PathBuf::from);
                if let Some(payload) = payload_from_file_paths(paths, cli.page) {
                    #[cfg(debug_assertions)]
                    println!("Opening files from CLI: {:?}", payload.files);

                    // Store and emit event (frontend will also pull pending on ready)
                    dispatch_open_payload(&app_handle, payload);
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
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = event {
            if let Some(payload) = payload_from_opened_urls(&urls) {
                dispatch_open_payload(app, payload);
            }
        }
    });
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

    #[test]
    fn test_legacy_file_open_payload_accepts_raw_path() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");

        let payload = payload_from_file_paths(
            paths_from_legacy_file_open_payload(fixture.to_string_lossy().as_ref()),
            None,
        )
        .expect("raw path payload should be accepted");

        assert_eq!(payload.files, vec![fixture.to_string_lossy().to_string()]);
        assert_eq!(payload.page, None);
    }

    #[test]
    fn test_legacy_file_open_payload_accepts_file_url() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let file_url = url::Url::from_file_path(&fixture).expect("fixture should become file URL");

        let payload =
            payload_from_file_paths(paths_from_legacy_file_open_payload(file_url.as_str()), None)
                .expect("file URL payload should be accepted");

        assert_eq!(payload.files, vec![fixture.to_string_lossy().to_string()]);
        assert_eq!(payload.page, None);
    }

    #[test]
    fn test_opened_urls_accepts_file_urls() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let file_url = url::Url::from_file_path(&fixture).expect("fixture should become file URL");

        let payload =
            payload_from_opened_urls(&[file_url]).expect("opened file URL should be accepted");

        assert_eq!(payload.files, vec![fixture.to_string_lossy().to_string()]);
        assert_eq!(payload.page, None);
    }
}
