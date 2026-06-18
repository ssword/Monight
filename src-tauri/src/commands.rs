use std::path::Path;
use tauri::{
    command, AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::{is_supported_extension, take_cli_payload_inner, CliPayload, PendingCliPayload};

const PDF_VIEW_MIN_WIDTH: f64 = 1000.0;
const PDF_VIEW_MAX_WIDTH: f64 = 1320.0;
const PDF_VIEW_MIN_HEIGHT: f64 = 650.0;
const PDF_VIEW_WIDTH_RATIO: f64 = 0.62;
const PDF_VIEW_EDGE_PADDING: f64 = 24.0;

#[derive(Debug, PartialEq)]
struct PdfWindowFrame {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

fn scaled_pixels(value: f64, scale_factor: f64) -> u32 {
    (value * scale_factor).round().max(1.0) as u32
}

fn calculate_pdf_window_frame(
    work_x: i32,
    work_y: i32,
    available_width: u32,
    available_height: u32,
    scale_factor: f64,
) -> PdfWindowFrame {
    let min_width = scaled_pixels(PDF_VIEW_MIN_WIDTH, scale_factor).min(available_width.max(1));
    let max_width = scaled_pixels(PDF_VIEW_MAX_WIDTH, scale_factor).min(available_width.max(1));
    let edge_padding = scaled_pixels(PDF_VIEW_EDGE_PADDING, scale_factor);
    let padded_max_width = available_width.saturating_sub(edge_padding).max(1);
    let width = ((available_width as f64 * PDF_VIEW_WIDTH_RATIO).round() as u32).clamp(
        min_width.min(padded_max_width),
        max_width.min(padded_max_width),
    );
    let height = available_height.max(1);
    let x = work_x + ((available_width.saturating_sub(width) / 2) as i32);

    PdfWindowFrame {
        width,
        height,
        x,
        y: work_y,
    }
}

/// Read and validate a PDF file, returning raw bytes.
/// This is the pure, testable core — no Tauri dependencies.
pub(crate) fn read_pdf_bytes(path: String) -> Result<Vec<u8>, String> {
    // Validate file exists
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    // Validate file extension
    if !is_supported_extension(file_path) {
        let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("");
        let ext_label = if ext.is_empty() {
            "no extension".to_string()
        } else {
            format!(".{}", ext)
        };
        return Err(format!(
            "Unsupported file type {}. Only PDF, XDP, FDF, and XFDF files are supported.",
            ext_label
        ));
    }

    // Read file contents
    std::fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Read a PDF file and return raw bytes via Tauri's binary response mechanism.
#[command]
pub async fn read_pdf_file(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = read_pdf_bytes(path)?;
    Ok(tauri::ipc::Response::new(bytes))
}

pub(crate) fn validate_external_url(raw_url: &str) -> Result<Url, String> {
    let url = Url::parse(raw_url).map_err(|_| "Invalid external link URL".to_string())?;

    match url.scheme() {
        "http" | "https" => {
            if url.host_str().is_none() {
                return Err("External web links must include a host".to_string());
            }
        }
        "mailto" => {
            if url.path().trim().is_empty() {
                return Err("Email links must include an address".to_string());
            }
        }
        _ => {
            return Err("Blocked unsupported PDF link scheme".to_string());
        }
    }

    Ok(url)
}

#[command]
pub async fn open_external_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = validate_external_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| format!("Failed to open external link: {}", e))
}

/// Extract filename from full path
#[command]
pub fn get_file_name(path: String) -> String {
    Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Unknown")
        .to_string()
}

/// Get the parent directory of a file path
#[command]
pub fn get_file_directory(path: String) -> String {
    Path::new(&path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string()
}

/// Open settings window
#[command]
pub async fn open_settings(app: AppHandle) -> Result<(), String> {
    // Check if settings window already exists
    if let Some(window) = app.get_webview_window("settings") {
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Get main window to use as parent
    let main_window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;

    // Determine the URL based on whether we're in development or production
    #[cfg(debug_assertions)]
    let url = WebviewUrl::External("http://localhost:1420/settings.html".parse().unwrap());

    #[cfg(not(debug_assertions))]
    let url = WebviewUrl::App("settings.html".into());

    // Create settings window
    WebviewWindowBuilder::new(&app, "settings", url)
        .title("Settings - Monight")
        .parent(&main_window)
        .map_err(|e| e.to_string())?
        .inner_size(700.0, 500.0)
        .resizable(false)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Enable or disable the Print menu item
#[command]
pub fn set_print_enabled(app: AppHandle, enabled: bool) {
    if let Some(menu) = app.menu() {
        if let Some(item) = menu.get("print") {
            if let Some(menu_item) = item.as_menuitem() {
                menu_item.set_enabled(enabled).ok();
            }
        }
    }
}

/// Fit the main window for comfortable PDF reading.
#[command]
pub fn fit_main_window_for_pdf(app: AppHandle, fill_available_height: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Main window not found")?;
    let scale_factor = window.scale_factor().map_err(|e| e.to_string())?;

    if !fill_available_height {
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let width = size
            .width
            .max(scaled_pixels(PDF_VIEW_MIN_WIDTH, scale_factor));
        let height = size
            .height
            .max(scaled_pixels(PDF_VIEW_MIN_HEIGHT, scale_factor));

        if width != size.width || height != size.height {
            window
                .set_size(PhysicalSize::new(width, height))
                .map_err(|e| e.to_string())?;
            window.center().map_err(|e| e.to_string())?;
        }

        return Ok(());
    }

    let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? else {
        window.maximize().map_err(|e| e.to_string())?;
        return Ok(());
    };

    let work_area = monitor.work_area();
    let frame = calculate_pdf_window_frame(
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
        monitor.scale_factor(),
    );

    window
        .set_size(PhysicalSize::new(frame.width, frame.height))
        .map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(frame.x, frame.y))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get and clear any pending CLI-open payloads
#[command]
pub fn take_cli_payload(state: State<PendingCliPayload>) -> Option<CliPayload> {
    take_cli_payload_inner(state.inner())
}

/// Validate and canonicalize a file path for opening
#[command]
pub fn validate_open_path(path: String) -> Result<String, String> {
    let raw_path = Path::new(&path);
    if !raw_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    let canonical =
        std::fs::canonicalize(raw_path).map_err(|e| format!("Invalid path: {} ({})", path, e))?;

    if !is_supported_extension(&canonical) {
        let ext = canonical.extension().and_then(|e| e.to_str()).unwrap_or("");
        let ext_label = if ext.is_empty() {
            "no extension".to_string()
        } else {
            format!(".{}", ext)
        };
        return Err(format!(
            "Unsupported file type {}. Only PDF, XDP, FDF, and XFDF files are supported.",
            ext_label
        ));
    }

    Ok(canonical.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_file_name() {
        assert_eq!(
            get_file_name("/path/to/document.pdf".to_string()),
            "document.pdf"
        );
    }

    #[test]
    fn test_get_file_directory() {
        assert_eq!(
            get_file_directory("/path/to/document.pdf".to_string()),
            "/path/to"
        );
    }

    #[test]
    fn test_pdf_window_frame_uses_logical_width_on_retina() {
        let frame = calculate_pdf_window_frame(0, 48, 3456, 2112, 2.0);

        assert_eq!(frame.height, 2112);
        assert_eq!(frame.width, 2143);
        assert_eq!(frame.x, 656);
        assert_eq!(frame.y, 48);
    }

    #[test]
    fn test_pdf_window_frame_fits_small_displays() {
        let frame = calculate_pdf_window_frame(0, 0, 900, 700, 1.0);

        assert_eq!(frame.height, 700);
        assert_eq!(frame.width, 876);
        assert_eq!(frame.x, 12);
        assert_eq!(frame.y, 0);
    }

    #[test]
    fn test_read_pdf_bytes_returns_correct_content() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sample.pdf");
        let expected = std::fs::read(&fixture).expect("fixture should be readable");

        let result = read_pdf_bytes(fixture.to_string_lossy().to_string());

        assert!(
            result.is_ok(),
            "read_pdf_bytes should succeed for a valid PDF"
        );
        let bytes = result.unwrap();
        assert_eq!(bytes.len(), expected.len());
        assert_eq!(bytes, expected);
    }

    #[test]
    fn test_read_pdf_bytes_rejects_unsupported_extension() {
        let fixture =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/readme.txt");

        let result = read_pdf_bytes(fixture.to_string_lossy().to_string());

        assert!(result.is_err(), "read_pdf_bytes should reject .txt files");
        let err = result.unwrap_err();
        assert!(
            err.contains("Unsupported file type"),
            "error should mention unsupported type, got: {}",
            err
        );
        assert!(
            err.contains(".txt"),
            "error should mention the actual extension, got: {}",
            err
        );
    }

    #[test]
    fn test_read_pdf_bytes_errors_for_missing_file() {
        let missing = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/does_not_exist.pdf");

        let result = read_pdf_bytes(missing.to_string_lossy().to_string());

        assert!(
            result.is_err(),
            "read_pdf_bytes should fail for missing files"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("File not found"),
            "error should mention file not found, got: {}",
            err
        );
    }

    #[test]
    fn test_validate_external_url_allows_safe_schemes() {
        assert!(validate_external_url("https://example.com/report").is_ok());
        assert!(validate_external_url("http://example.com/report").is_ok());
        assert!(validate_external_url("mailto:user@example.com").is_ok());
    }

    #[test]
    fn test_validate_external_url_blocks_unsafe_schemes() {
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("data:text/html,hello").is_err());
    }

    #[test]
    fn test_validate_external_url_requires_web_host() {
        assert!(validate_external_url("https://").is_err());
    }
}
