use std::path::Path;
use tauri::command;

/// Read a PDF file from the filesystem and return as byte array
#[command]
pub async fn read_pdf_file(path: String) -> Result<Vec<u8>, String> {
    // Validate file exists
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err(format!("File not found: {}", path));
    }

    // Validate file extension
    match file_path.extension().and_then(|e| e.to_str()) {
        Some("pdf") => {}
        _ => return Err("Invalid file type. Only PDF files are supported.".to_string()),
    }

    // Read file contents
    std::fs::read(file_path).map_err(|e| format!("Failed to read file: {}", e))
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
}
