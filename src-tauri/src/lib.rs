// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::Parser;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

mod commands;
mod document_intake;
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
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
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
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn payload_from_authorized_paths(files: Vec<String>, page: Option<u32>) -> Option<CliPayload> {
    if files.is_empty() {
        None
    } else {
        Some(CliPayload { files, page })
    }
}

pub(crate) fn payload_from_cli_paths<I>(
    document_intake: &document_intake::DocumentIntake,
    files: I,
    page: Option<u32>,
) -> Option<CliPayload>
where
    I: IntoIterator<Item = PathBuf>,
{
    let files = document_intake.authorize(files);
    payload_from_authorized_paths(files, page)
}

fn authorize_dropped_paths<I>(document_intake: &document_intake::DocumentIntake, paths: I)
where
    I: IntoIterator<Item = PathBuf>,
{
    document_intake.authorize(paths);
}

pub(crate) fn payload_from_opened_urls(
    document_intake: &document_intake::DocumentIntake,
    urls: &[url::Url],
) -> Option<CliPayload> {
    let files = document_intake.authorize(urls.iter().filter_map(|url| {
        if url.scheme() == "file" {
            url.to_file_path().ok()
        } else {
            None
        }
    }));
    payload_from_authorized_paths(files, None)
}

pub(crate) fn parse_cli_or_default<I, T>(args: I) -> Cli
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let filtered = args.into_iter().filter(|arg| {
        let arg: std::ffi::OsString = arg.clone().into();
        !arg.to_string_lossy().starts_with("-psn_")
    });

    Cli::try_parse_from(filtered).unwrap_or(Cli {
        files: Vec::new(),
        page: None,
    })
}

pub(crate) fn payload_from_cli_args<I, T>(
    document_intake: &document_intake::DocumentIntake,
    args: I,
    working_directory: Option<&std::path::Path>,
) -> Option<CliPayload>
where
    I: IntoIterator<Item = T>,
    T: Into<std::ffi::OsString> + Clone,
{
    let cli = parse_cli_or_default(args);
    let paths = cli.files.into_iter().map(|file| {
        let path = PathBuf::from(file);
        match working_directory {
            Some(directory) if path.is_relative() => directory.join(path),
            _ => path,
        }
    });

    payload_from_cli_paths(document_intake, paths, cli.page)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        let document_intake = app.state::<document_intake::DocumentIntake>();
        let working_directory = PathBuf::from(cwd);

        if let Some(payload) = payload_from_cli_args(
            document_intake.inner(),
            args,
            Some(working_directory.as_path()),
        ) {
            dispatch_open_payload(app, payload);
        } else if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(PendingCliPayload(Mutex::new(None)))
        .manage(document_intake::DocumentIntake::default())
        .invoke_handler(tauri::generate_handler![
            commands::read_pdf_file,
            commands::open_pdf_dialog,
            commands::get_file_name,
            commands::get_file_directory,
            commands::open_settings,
            commands::set_print_enabled,
            commands::fit_main_window_for_pdf,
            commands::take_cli_payload,
            commands::validate_open_path,
            commands::open_external_url,
        ])
        .on_webview_event(|webview, event| {
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let document_intake = webview.state::<document_intake::DocumentIntake>();
                authorize_dropped_paths(document_intake.inner(), paths.clone());
            }
        })
        .setup(|app| {
            let store = app.store("settings.json")?;
            let persisted_store = serde_json::Value::Object(store.entries().into_iter().collect());
            let document_intake = app.state::<document_intake::DocumentIntake>();
            document_intake.authorize_persisted_snapshot(&persisted_store);

            let window = app.get_webview_window("main").unwrap();
            let app_handle = app.handle();

            // Create and set application menu
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;

            // If files were provided via CLI, emit event to frontend. Malformed
            // arguments produce no payload but do not prevent the app launching.
            if let Some(payload) =
                payload_from_cli_args(document_intake.inner(), std::env::args(), None)
            {
                #[cfg(debug_assertions)]
                println!("Opening files from CLI: {:?}", payload.files);

                // Store and emit event (frontend will also pull pending on ready)
                dispatch_open_payload(app_handle, payload);
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
            let document_intake = app.state::<document_intake::DocumentIntake>();
            if let Some(payload) = payload_from_opened_urls(document_intake.inner(), &urls) {
                dispatch_open_payload(app, payload);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copied_pdf_fixture(name: &str) -> PathBuf {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let directory = std::env::temp_dir().join(format!(
            "monight-entry-channel-tests-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).expect("test directory should be created");
        let copy = directory.join(name);
        std::fs::copy(fixture, &copy).expect("PDF fixture should be copied");
        copy
    }

    fn script_src(csp: &str) -> &str {
        csp.split(';')
            .map(str::trim)
            .find(|directive| directive.starts_with("script-src "))
            .expect("CSP should define script-src")
    }

    fn html_csp(html: &str) -> &str {
        let marker = "content=\"";
        let csp_start = html
            .find("Content-Security-Policy")
            .and_then(|meta_start| {
                html[meta_start..]
                    .find(marker)
                    .map(|offset| meta_start + offset)
            })
            .map(|marker_start| marker_start + marker.len())
            .expect("HTML should define a Content-Security-Policy meta tag");
        let csp_end = html[csp_start..]
            .find('"')
            .map(|offset| csp_start + offset)
            .expect("CSP content attribute should be terminated");

        &html[csp_start..csp_end]
    }

    #[test]
    fn test_shipped_csp_disallows_inline_scripts_and_retains_pdf_and_print_support() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
        let tauri_csp = config["app"]["security"]["csp"]
            .as_str()
            .expect("Tauri config should define CSP");
        let csp_policies = [
            tauri_csp,
            html_csp(include_str!("../../index.html")),
            html_csp(include_str!("../../settings.html")),
        ];

        for csp in csp_policies {
            let scripts = script_src(csp);
            assert!(!scripts
                .split_whitespace()
                .any(|source| source == "'unsafe-inline'"));
            assert!(scripts
                .split_whitespace()
                .any(|source| source == "'wasm-unsafe-eval'"));
            assert!(csp
                .split(';')
                .map(str::trim)
                .any(|directive| directive == "frame-src blob:"));
        }
    }

    #[test]
    fn test_shipped_config_disables_the_global_tauri_ipc_object() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");

        assert_eq!(config["app"]["withGlobalTauri"].as_bool(), Some(false));
    }

    #[test]
    fn test_shipped_artifacts_exclude_shell_and_retain_the_opener() {
        let cargo_manifest = include_str!("../Cargo.toml");
        let cargo_lock = include_str!("../Cargo.lock");
        let npm_manifest: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).expect("valid npm manifest");
        let npm_lock: serde_json::Value =
            serde_json::from_str(include_str!("../../package-lock.json"))
                .expect("valid npm lockfile");
        let runtime_source = include_str!("lib.rs");
        let shell_plugin = concat!("tauri-plugin-", "shell");
        let shell_registration = concat!("tauri_plugin_", "shell::init()");

        assert!(!cargo_manifest
            .lines()
            .any(|line| line.trim_start().starts_with(&format!("{shell_plugin} ="))));
        assert!(cargo_manifest
            .lines()
            .any(|line| line.trim_start().starts_with("tauri-plugin-opener =")));
        assert!(!cargo_lock
            .lines()
            .any(|line| line.trim() == format!("name = \"{shell_plugin}\"")));
        assert!(npm_manifest["dependencies"][format!("@tauri-apps/{shell_plugin}")].is_null());
        assert!(npm_lock["packages"][format!("node_modules/@tauri-apps/{shell_plugin}")].is_null());
        assert!(!runtime_source.contains(shell_registration));
    }

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
    fn drag_and_drop_authorizes_only_the_dropped_document() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let denied = copied_pdf_fixture("drag-denied.pdf");
        let document_intake = document_intake::DocumentIntake::default();

        authorize_dropped_paths(&document_intake, [fixture.clone()]);

        assert!(
            commands::read_pdf_bytes(fixture.to_string_lossy().to_string(), &document_intake)
                .is_ok()
        );
        assert!(
            commands::read_pdf_bytes(denied.to_string_lossy().to_string(), &document_intake)
                .is_err()
        );
        std::fs::remove_file(denied).expect("test copy should be removed");
    }

    #[test]
    fn os_opened_event_authorizes_only_its_file_url() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let denied = copied_pdf_fixture("opened-event-denied.pdf");
        let file_url = url::Url::from_file_path(&fixture).expect("fixture should become file URL");
        let document_intake = document_intake::DocumentIntake::default();

        let payload = payload_from_opened_urls(&document_intake, &[file_url])
            .expect("opened file URL should be accepted");

        assert_eq!(payload.files, vec![fixture.to_string_lossy().to_string()]);
        assert_eq!(payload.page, None);
        assert!(commands::read_pdf_bytes(payload.files[0].clone(), &document_intake).is_ok());
        assert!(
            commands::read_pdf_bytes(denied.to_string_lossy().to_string(), &document_intake)
                .is_err()
        );
        std::fs::remove_file(denied).expect("test copy should be removed");
    }

    #[test]
    fn cli_authorizes_only_its_document() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let denied = copied_pdf_fixture("cli-denied.pdf");
        let document_intake = document_intake::DocumentIntake::default();

        let payload = payload_from_cli_paths(&document_intake, [fixture], Some(4))
            .expect("CLI Document should be accepted");

        assert_eq!(payload.page, Some(4));
        assert!(commands::read_pdf_bytes(payload.files[0].clone(), &document_intake).is_ok());
        assert!(
            commands::read_pdf_bytes(denied.to_string_lossy().to_string(), &document_intake)
                .is_err()
        );
        std::fs::remove_file(denied).expect("test copy should be removed");
    }

    #[test]
    fn malformed_cli_arguments_fall_back_to_launching_without_documents() {
        let cli = parse_cli_or_default(["monight", "--not-a-real-flag", "value"]);

        assert!(cli.files.is_empty());
        assert_eq!(cli.page, None);
    }

    #[test]
    fn forwarded_arguments_route_through_document_intake() {
        let working_directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let expected =
            std::fs::canonicalize(working_directory.join("sample.pdf")).expect("fixture exists");
        let document_intake = document_intake::DocumentIntake::default();

        let payload = payload_from_cli_args(
            &document_intake,
            ["monight", "--page", "5", "sample.pdf"],
            Some(working_directory.as_path()),
        )
        .expect("forwarded arguments should produce a CLI payload");

        assert_eq!(payload.files, vec![expected.to_string_lossy().to_string()]);
        assert_eq!(payload.page, Some(5));
        assert!(commands::read_pdf_bytes(payload.files[0].clone(), &document_intake).is_ok());
    }

    #[test]
    fn test_only_pdf_is_a_supported_document_extension() {
        assert!(is_supported_extension(std::path::Path::new("report.pdf")));
        assert!(is_supported_extension(std::path::Path::new("REPORT.PDF")));
        assert!(!is_supported_extension(std::path::Path::new("form.xdp")));
        assert!(!is_supported_extension(std::path::Path::new("form.fdf")));
        assert!(!is_supported_extension(std::path::Path::new("form.xfdf")));
    }

    #[test]
    fn test_bundle_only_registers_pdf_file_associations() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid Tauri config");
        let associations = config["bundle"]["fileAssociations"]
            .as_array()
            .expect("file associations should be an array");
        let extensions = associations
            .iter()
            .flat_map(|association| {
                association["ext"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
            })
            .collect::<Vec<_>>();

        assert_eq!(extensions, vec!["pdf"]);
    }
}
