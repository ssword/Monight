use std::{collections::HashSet, path::PathBuf, sync::Mutex};

use crate::is_supported_extension;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct DocumentPath(PathBuf);

impl DocumentPath {
    fn canonicalize(path: PathBuf) -> Result<Self, String> {
        let raw_path = path.to_string_lossy();
        if !path.exists() {
            return Err(format!("File not found: {raw_path}"));
        }

        let canonical = std::fs::canonicalize(&path)
            .map_err(|error| format!("Invalid path: {raw_path} ({error})"))?;
        if !is_supported_extension(&canonical) {
            let extension = canonical.extension().and_then(|value| value.to_str());
            let label = extension
                .map(|value| format!(".{value}"))
                .unwrap_or_else(|| "no extension".to_string());
            return Err(format!(
                "Unsupported file type {label}. Only PDF files are supported."
            ));
        }

        Ok(Self(canonical))
    }

    fn to_path_string(&self) -> String {
        self.0.to_string_lossy().to_string()
    }
}

#[derive(Default)]
pub(crate) struct DocumentIntake {
    authorized_documents: Mutex<HashSet<DocumentPath>>,
}

impl DocumentIntake {
    pub(crate) fn authorize<I>(&self, paths: I) -> Vec<String>
    where
        I: IntoIterator<Item = PathBuf>,
    {
        let documents = paths
            .into_iter()
            .filter_map(|path| DocumentPath::canonicalize(path).ok())
            .collect::<Vec<_>>();

        self.authorized_documents
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .extend(documents.iter().cloned());

        documents
            .into_iter()
            .map(|path| path.to_path_string())
            .collect()
    }

    pub(crate) fn authorize_persisted_snapshot(&self, persisted_store: &serde_json::Value) {
        const PERSISTED_DOCUMENT_LISTS: [&str; 6] = [
            "/readingSession/documents",
            "/recentFiles",
            "/settings/readingSession/documents",
            "/settings/recentFiles",
            "/settings/lastSession/tabs",
            "/settings/lastSession/documents",
        ];

        for pointer in PERSISTED_DOCUMENT_LISTS {
            let paths = persisted_store
                .pointer(pointer)
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|document| document.get("filePath"))
                .filter_map(serde_json::Value::as_str)
                .map(PathBuf::from);
            self.authorize(paths);
        }
    }

    pub(crate) fn read(&self, path: String) -> Result<Vec<u8>, String> {
        let document = DocumentPath::canonicalize(PathBuf::from(path))?;
        let is_authorized = self
            .authorized_documents
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .contains(&document);
        if !is_authorized {
            return Err("Document path is not authorized for reading".to_string());
        }

        std::fs::read(document.0).map_err(|error| format!("Failed to read file: {error}"))
    }

    pub(crate) fn validate(&self, path: String) -> Result<String, String> {
        DocumentPath::canonicalize(PathBuf::from(path)).map(|document| document.to_path_string())
    }
}
