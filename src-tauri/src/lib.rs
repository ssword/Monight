// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::Parser;
use serde::Serialize;
use std::collections::VecDeque;
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

#[derive(Clone, Copy, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalOpenSource {
    CommandLine,
    OperatingSystem,
}

/// Ordered external Document request sent to the frontend intake adapter.
#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenPayload {
    files: Vec<String>,
    page: Option<u32>,
    source: ExternalOpenSource,
}

#[derive(Default)]
pub struct PendingExternalOpenPayloads(Mutex<VecDeque<ExternalOpenPayload>>);

pub(crate) fn is_supported_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false)
}

pub(crate) fn queue_external_open_payload_inner(
    state: &PendingExternalOpenPayloads,
    payload: ExternalOpenPayload,
) {
    let mut guard = state.0.lock().unwrap();
    guard.push_back(payload);
}

pub(crate) fn take_external_open_payloads_inner(
    state: &PendingExternalOpenPayloads,
) -> Vec<ExternalOpenPayload> {
    let mut guard = state.0.lock().unwrap();
    guard.drain(..).collect()
}

fn dispatch_external_open_payload(app: &tauri::AppHandle, payload: ExternalOpenPayload) {
    let _ = commands::fit_main_window_for_pdf(app.clone(), true);
    let state = app.state::<PendingExternalOpenPayloads>();
    queue_external_open_payload_inner(state.inner(), payload);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("external-open-files-available", ());
        let _ = window.show();
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn payload_from_requested_paths(
    files: Vec<String>,
    page: Option<u32>,
    source: ExternalOpenSource,
) -> Option<ExternalOpenPayload> {
    if files.is_empty() {
        None
    } else {
        Some(ExternalOpenPayload {
            files,
            page,
            source,
        })
    }
}

fn authorize_requested_paths<I>(
    document_intake: &document_intake::DocumentIntake,
    files: I,
) -> Vec<String>
where
    I: IntoIterator<Item = PathBuf>,
{
    let files = files.into_iter().collect::<Vec<_>>();
    document_intake.authorize(files.iter().cloned());
    files
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

pub(crate) fn payload_from_cli_paths<I>(
    document_intake: &document_intake::DocumentIntake,
    files: I,
    page: Option<u32>,
) -> Option<ExternalOpenPayload>
where
    I: IntoIterator<Item = PathBuf>,
{
    let files = authorize_requested_paths(document_intake, files);
    payload_from_requested_paths(files, page, ExternalOpenSource::CommandLine)
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
) -> Option<ExternalOpenPayload> {
    let files = authorize_requested_paths(
        document_intake,
        urls.iter().filter_map(|url| {
            if url.scheme() == "file" {
                url.to_file_path().ok()
            } else {
                None
            }
        }),
    );
    payload_from_requested_paths(files, None, ExternalOpenSource::OperatingSystem)
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
) -> Option<ExternalOpenPayload>
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
            dispatch_external_open_payload(app, payload);
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
        .manage(PendingExternalOpenPayloads::default())
        .manage(document_intake::DocumentIntake::default())
        .invoke_handler(tauri::generate_handler![
            commands::read_pdf_file,
            commands::open_pdf_dialog,
            commands::describe_pdf_file,
            commands::get_file_name,
            commands::get_file_directory,
            commands::open_settings,
            commands::set_print_enabled,
            commands::fit_main_window_for_pdf,
            commands::take_external_open_payloads,
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
            let document_intake = app.state::<document_intake::DocumentIntake>();
            for store_name in ["settings.json", "recent-documents.json"] {
                let store = app.store(store_name)?;
                let persisted_store =
                    serde_json::Value::Object(store.entries().into_iter().collect());
                document_intake.authorize_persisted_snapshot(&persisted_store);
            }

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
                dispatch_external_open_payload(app_handle, payload);
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
                dispatch_external_open_payload(app, payload);
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
        let state = PendingExternalOpenPayloads::default();

        let payload_a = ExternalOpenPayload {
            files: vec!["/tmp/one.pdf".to_string()],
            page: None,
            source: ExternalOpenSource::CommandLine,
        };
        let payload_b = ExternalOpenPayload {
            files: vec!["/tmp/two.pdf".to_string()],
            page: Some(7),
            source: ExternalOpenSource::CommandLine,
        };
        queue_external_open_payload_inner(&state, payload_a.clone());
        queue_external_open_payload_inner(&state, payload_b.clone());
        let taken = take_external_open_payloads_inner(&state);
        assert_eq!(taken, vec![payload_a, payload_b]);

        let live_payload = ExternalOpenPayload {
            files: vec!["/tmp/live.pdf".to_string()],
            page: Some(3),
            source: ExternalOpenSource::CommandLine,
        };
        queue_external_open_payload_inner(&state, live_payload.clone());
        assert_eq!(
            take_external_open_payloads_inner(&state),
            vec![live_payload]
        );
    }

    #[test]
    fn external_open_payload_serializes_for_the_frontend_adapter() {
        let payload = ExternalOpenPayload {
            files: vec!["/tmp/report.pdf".to_string()],
            page: Some(6),
            source: ExternalOpenSource::CommandLine,
        };

        assert_eq!(
            serde_json::to_value(payload).expect("payload should serialize"),
            serde_json::json!({
                "files": ["/tmp/report.pdf"],
                "page": 6,
                "source": "commandLine",
            })
        );
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
        assert_eq!(payload.source, ExternalOpenSource::OperatingSystem);
        assert!(commands::read_pdf_bytes(payload.files[0].clone(), &document_intake).is_ok());
        assert!(
            commands::read_pdf_bytes(denied.to_string_lossy().to_string(), &document_intake)
                .is_err()
        );
        std::fs::remove_file(denied).expect("test copy should be removed");
    }

    #[test]
    fn os_opened_event_preserves_missing_paths_for_independent_frontend_outcomes() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let missing = fixture.with_file_name("missing-associated.pdf");
        let urls = [
            url::Url::from_file_path(&missing).expect("missing path should become a file URL"),
            url::Url::from_file_path(&fixture).expect("fixture should become a file URL"),
        ];
        let document_intake = document_intake::DocumentIntake::default();

        let payload = payload_from_opened_urls(&document_intake, &urls)
            .expect("file association paths should be forwarded in order");

        assert_eq!(
            payload.files,
            vec![
                missing.to_string_lossy().to_string(),
                fixture.to_string_lossy().to_string(),
            ]
        );
        assert!(
            commands::read_pdf_bytes(fixture.to_string_lossy().to_string(), &document_intake)
                .is_ok()
        );
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
        assert_eq!(payload.source, ExternalOpenSource::CommandLine);
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
    fn cli_preserves_requested_order_and_does_not_transfer_page_past_an_invalid_first_path() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let missing = fixture.with_file_name("missing-first.pdf");
        let document_intake = document_intake::DocumentIntake::default();

        let payload = payload_from_cli_paths(
            &document_intake,
            [missing.clone(), fixture.clone()],
            Some(9),
        )
        .expect("requested CLI paths should be forwarded for independent intake outcomes");

        assert_eq!(
            payload.files,
            vec![
                missing.to_string_lossy().to_string(),
                fixture.to_string_lossy().to_string(),
            ]
        );
        assert_eq!(payload.page, Some(9));
        assert!(
            commands::read_pdf_bytes(fixture.to_string_lossy().to_string(), &document_intake)
                .is_ok()
        );
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
