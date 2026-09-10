use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDestination {
    pub token: String,
    pub canonical_path: String,
    pub title: String,
}

struct FileVersion {
    identity: same_file::Handle,
    modified: std::time::SystemTime,
    bytes: Vec<u8>,
}

impl FileVersion {
    fn read(path: &Path) -> Result<Self, String> {
        if std::fs::symlink_metadata(path)
            .map_err(|e| format!("File conflict: {e}"))?
            .file_type()
            .is_symlink()
        {
            return Err("File conflict: source was replaced by a symbolic link".into());
        }
        let mut file = std::fs::File::open(path).map_err(|e| format!("File conflict: {e}"))?;
        let before = file.metadata().map_err(|e| e.to_string())?;
        if !before.is_file() {
            return Err("Choose a regular PDF file".into());
        }
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        let after = file.metadata().map_err(|e| e.to_string())?;
        if before.modified().ok() != after.modified().ok() || before.len() != after.len() {
            return Err("File conflict: source changed while reading".into());
        }
        let version = Self {
            identity: same_file::Handle::from_file(file).map_err(|e| e.to_string())?,
            modified: after.modified().map_err(|e| e.to_string())?,
            bytes,
        };
        let current =
            same_file::Handle::from_path(path).map_err(|e| format!("File conflict: {e}"))?;
        if version.identity != current {
            return Err("File conflict: source was replaced".into());
        }
        Ok(version)
    }
    fn matches(&self, other: &Self) -> bool {
        self.identity == other.identity
            && self.modified == other.modified
            && self.bytes == other.bytes
    }
}

struct Source {
    path: PathBuf,
    version: FileVersion,
}
struct Destination {
    path: PathBuf,
    version: Option<FileVersion>,
}
#[derive(Default)]
struct SaveState {
    sources: HashMap<String, Source>,
    destinations: HashMap<String, Destination>,
}
#[derive(Default)]
pub struct PdfSave {
    state: Mutex<SaveState>,
    next: AtomicU64,
    #[cfg(test)]
    write_hook: Option<fn(WritePhase, &Path) -> Result<(), String>>,
}

#[cfg(test)]
#[derive(Clone, Copy, PartialEq)]
enum WritePhase {
    Staged,
    BeforeReplace,
    BeforeSync,
    BeforeRollback,
}

impl PdfSave {
    #[cfg(test)]
    fn with_write_hook(hook: fn(WritePhase, &Path) -> Result<(), String>) -> Self {
        Self {
            write_hook: Some(hook),
            ..Self::default()
        }
    }
    pub fn capture_source(&self, path: &Path, bytes: &[u8]) -> Result<String, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let version = FileVersion::read(&path)?;
        if version.bytes != bytes {
            return Err("File conflict: source changed while opening; reload the Document".into());
        }
        let token = self.next.fetch_add(1, Ordering::Relaxed).to_string();
        state
            .sources
            .insert(token.clone(), Source { path, version });
        Ok(token)
    }
    pub fn release_source(&self, token: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.sources.remove(token);
        }
    }
    pub fn authorize(&self, path: &Path) -> Result<SaveDestination, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        let title = path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Choose a PDF file name")?
            .to_string();
        if !title.to_lowercase().ends_with(".pdf") {
            return Err("Choose a .pdf destination".into());
        }
        let path = match path.symlink_metadata() {
            Ok(_) => path.canonicalize().map_err(|e| e.to_string())?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => path
                .parent()
                .ok_or("Missing destination directory")?
                .canonicalize()
                .map_err(|e| e.to_string())?
                .join(&title),
            Err(e) => return Err(e.to_string()),
        };
        let version = if path.exists() {
            Some(FileVersion::read(&path)?)
        } else {
            None
        };
        let token = self.next.fetch_add(1, Ordering::Relaxed).to_string();
        let result = SaveDestination {
            token: token.clone(),
            canonical_path: path.to_str().ok_or("Invalid destination path")?.to_string(),
            title: path
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or("Invalid name")?
                .to_string(),
        };
        state
            .destinations
            .insert(token, Destination { path, version });
        Ok(result)
    }
    pub fn release(&self, token: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.destinations.remove(token);
        }
    }
    pub fn write_original(&self, token: &str, bytes: &[u8]) -> Result<Vec<u8>, String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        let source = state
            .sources
            .get(token)
            .ok_or("Source Document is no longer authorized")?;
        verify_preservation(&source.version.bytes, bytes)?;
        let version = write_pdf(
            &source.path,
            Some(&source.version),
            bytes,
            #[cfg(test)]
            self.write_hook,
        )?;
        let reopened = version.bytes.clone();
        state.sources.get_mut(token).unwrap().version = version;
        Ok(reopened)
    }
    pub fn write_destination(
        &self,
        token: &str,
        source_token: &str,
        bytes: &[u8],
    ) -> Result<(PathBuf, Vec<u8>), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        let original = state
            .sources
            .get(source_token)
            .ok_or("Source Document is no longer authorized")?
            .version
            .bytes
            .clone();
        Self::write_selected(
            &mut state,
            token,
            bytes,
            &original,
            #[cfg(test)]
            self.write_hook,
        )
    }
    #[cfg(test)]
    pub fn write_new(
        &self,
        token: &str,
        bytes: &[u8],
        original: &[u8],
    ) -> Result<(PathBuf, Vec<u8>), String> {
        let mut state = self.state.lock().map_err(|e| e.to_string())?;
        Self::write_selected(&mut state, token, bytes, original, self.write_hook)
    }
    fn write_selected(
        state: &mut SaveState,
        token: &str,
        bytes: &[u8],
        original: &[u8],
        #[cfg(test)] hook: Option<fn(WritePhase, &Path) -> Result<(), String>>,
    ) -> Result<(PathBuf, Vec<u8>), String> {
        let destination = state
            .destinations
            .remove(token)
            .ok_or("Save destination was not authorized or has already been used")?;
        if state.sources.values().any(|source| {
            source.path == destination.path
                || destination
                    .version
                    .as_ref()
                    .is_some_and(|v| v.identity == source.version.identity)
        }) {
            return Err(
                "Save As destination is already open; use Save for the current Document".into(),
            );
        }
        verify_preservation(original, bytes)?;
        let reopened = write_pdf(
            &destination.path,
            destination.version.as_ref(),
            bytes,
            #[cfg(test)]
            hook,
        )?;
        Ok((destination.path, reopened.bytes))
    }
}

fn write_pdf(
    path: &Path,
    expected: Option<&FileVersion>,
    bytes: &[u8],
    #[cfg(test)] hook: Option<fn(WritePhase, &Path) -> Result<(), String>>,
) -> Result<FileVersion, String> {
    let parent = path.parent().ok_or("Missing destination directory")?;
    let check = || -> Result<(), String> {
        match expected {
            Some(expected) if expected.matches(&FileVersion::read(path)?) => Ok(()),
            None if path.symlink_metadata().is_err_and(|e| e.kind() == std::io::ErrorKind::NotFound) => Ok(()),
            _ => Err("File conflict: destination changed, was replaced, or disappeared. Choose Save As or discard and reload.".into()),
        }
    };
    check()?;
    let mut staged = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Cannot stage PDF; try Save As: {e}"))?;
    if expected.is_some() {
        let permissions = std::fs::metadata(path)
            .map_err(|e| e.to_string())?
            .permissions();
        if permissions.readonly() {
            return Err("File is read-only; choose Save As".into());
        }
        staged
            .as_file()
            .set_permissions(permissions)
            .map_err(|e| e.to_string())?;
    }
    staged
        .write_all(bytes)
        .and_then(|_| staged.as_file().sync_all())
        .map_err(|e| format!("PDF write failed; edits retained: {e}"))?;
    #[cfg(test)]
    if let Some(hook) = hook {
        hook(WritePhase::Staged, path)?;
    }
    staged.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut verified = Vec::new();
    staged
        .read_to_end(&mut verified)
        .map_err(|e| e.to_string())?;
    if verified != bytes {
        return Err("Staged PDF verification failed".into());
    }
    check()?;
    #[cfg(test)]
    if let Some(hook) = hook {
        hook(WritePhase::BeforeReplace, path)?;
    }
    let backup = if let Some(expected) = expected {
        let staged_path = staged.into_temp_path().keep().map_err(|e| e.to_string())?;
        let backup = crate::pdf_replace::replace_preserving(&staged_path, path)?;
        // Verify the actual displaced inode, closing the check/rename race. A
        // competing replacement is restored; every displaced version is retained.
        if !FileVersion::read(&backup).is_ok_and(|displaced| expected.matches(&displaced)) {
            #[cfg(test)]
            if let Some(hook) = hook {
                hook(WritePhase::BeforeRollback, path)?;
            }
            let recovery = crate::pdf_replace::replace_preserving(&backup, path)
                .map(|p| p.display().to_string())
                .unwrap_or_else(|e| format!("{} ({e})", backup.display()));
            return Err(format!("File conflict during replacement; save was not accepted. Edits retained. Additional file version retained at {recovery}"));
        }
        Some(backup)
    } else {
        staged
            .persist_noclobber(path)
            .map_err(|e| format!("PDF creation failed; edits retained: {e}"))?;
        None
    };
    #[cfg(test)]
    if let Some(hook) = hook {
        hook(WritePhase::BeforeSync, path)?;
    }
    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|dir| dir.sync_all())
        .map_err(|e| format!("PDF completion uncertain; edits retained: {e}"))?;
    let reopened = FileVersion::read(path)?;
    if reopened.bytes != bytes {
        return Err("File conflict: destination changed during save; edits retained".into());
    }
    if let Some(backup) = backup {
        // Only remove the verified previous version after the new name is durable.
        std::fs::remove_file(&backup).map_err(|e| {
            format!(
                "PDF saved but cleanup uncertain; edits retained. Previous version at {}: {e}",
                backup.display()
            )
        })?;
    }
    Ok(reopened)
}

const EDITABLE_ANNOTATIONS: &[&[u8]] = &[b"Highlight", b"Text", b"Popup"];

fn visit_pdf_dictionaries(
    object: &lopdf::Object,
    depth: usize,
    visitor: &mut impl FnMut(&lopdf::Dictionary) -> Result<(), String>,
) -> Result<(), String> {
    use lopdf::Object;

    if depth > 200 {
        return Err(
            "PDF object nesting exceeds the safety inspection limit; this Document is read-only"
                .into(),
        );
    }
    match object {
        Object::Dictionary(dictionary)
        | Object::Stream(lopdf::Stream {
            dict: dictionary, ..
        }) => {
            visitor(dictionary)?;
            for (_, child) in dictionary.iter() {
                visit_pdf_dictionaries(child, depth + 1, visitor)?;
            }
        }
        Object::Array(items) => {
            for child in items {
                visit_pdf_dictionaries(child, depth + 1, visitor)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn visit_document_dictionaries(
    document: &lopdf::Document,
    mut visitor: impl FnMut(&lopdf::Dictionary) -> Result<(), String>,
) -> Result<(), String> {
    for object in document.objects.values() {
        visit_pdf_dictionaries(object, 0, &mut visitor)?;
    }
    Ok(())
}

fn load_editable(bytes: &[u8]) -> Result<lopdf::Document, String> {
    let document = lopdf::Document::load_mem(bytes)
        .map_err(|e| format!("PDF safety inspection failed: {e}"))?;

    let mut contains_signature = false;
    visit_document_dictionaries(&document, |dictionary| {
        contains_signature |= (dictionary.has(b"ByteRange") && dictionary.has(b"Contents"))
            || (dictionary.get(b"FT").and_then(lopdf::Object::as_name).ok() == Some(b"Sig")
                && dictionary
                    .get(b"V")
                    .is_ok_and(|value| !matches!(value, lopdf::Object::Null)));
        Ok(())
    })?;
    if contains_signature {
        return Err("Digitally signed PDFs are read-only to preserve their signatures".into());
    }
    if document.trailer.has(b"Encrypt") {
        let annotation_editing_allowed = document
            .get_encrypted()
            .ok()
            .and_then(|encryption| encryption.get(b"P").ok())
            .and_then(|permissions| permissions.as_i64().ok())
            .is_some_and(|permissions| permissions as u32 & 0x20 != 0);
        if !annotation_editing_allowed {
            return Err(
                "PDF permissions prohibit annotation editing; this Document is read-only".into(),
            );
        }
        return Err("Encrypted PDFs are read-only because Save, Save As, and Recovery Drafts cannot preserve their protection".into());
    }
    visit_document_dictionaries(&document, |dictionary| {
        if dictionary.has(b"AcroForm") || dictionary.has(b"XFA") {
            return Err(
                "PDF form preservation has not been verified; this Document is read-only".into(),
            );
        }
        if dictionary
            .get(b"Type")
            .and_then(lopdf::Object::as_name)
            .ok()
            == Some(b"Annot")
        {
            let subtype = dictionary
                .get(b"Subtype")
                .and_then(lopdf::Object::as_name)
                .map_err(|_| "Unknown embedded annotation; saving is blocked")?;
            if !EDITABLE_ANNOTATIONS.contains(&subtype) {
                return Err("Unsupported embedded annotations cannot yet be safely preserved; this Document is read-only".into());
            }
        }
        Ok(())
    })?;
    // Annotation dictionaries are not required to carry /Type /Annot.
    for id in document.get_pages().values() {
        let page = document.get_dictionary(*id).map_err(|e| e.to_string())?;
        if let Ok(annots) = page.get(b"Annots") {
            let (_, array) = document.dereference(annots).map_err(|e| e.to_string())?;
            for entry in array.as_array().map_err(|e| e.to_string())? {
                let (_, annotation) = document.dereference(entry).map_err(|e| e.to_string())?;
                let subtype = annotation
                    .as_dict()
                    .and_then(|d| d.get(b"Subtype"))
                    .and_then(lopdf::Object::as_name)
                    .map_err(|e| e.to_string())?;
                if !EDITABLE_ANNOTATIONS.contains(&subtype) {
                    return Err("Unsupported embedded annotations; saving is blocked".into());
                }
            }
        }
    }
    Ok(document)
}

pub fn editing_status(bytes: &[u8]) -> Option<String> {
    load_editable(bytes).err()
}

fn verify_preservation(original: &[u8], bytes: &[u8]) -> Result<(), String> {
    let before = load_editable(original)?;
    let after = load_editable(bytes)?;
    let mut seen = std::collections::HashSet::new();
    // Compare the reachable content graph, resolving references rather than
    // relying on object numbers surviving PDFium's serialization. Only supported page
    // annotation lists may change; all other annotations are blocked at intake.
    fn same(
        a: &lopdf::Object,
        b: &lopdf::Object,
        before: &lopdf::Document,
        after: &lopdf::Document,
        seen: &mut std::collections::HashSet<(lopdf::ObjectId, lopdf::ObjectId)>,
        depth: usize,
    ) -> bool {
        use lopdf::Object;
        if depth > 200 {
            return false;
        }
        if let (Object::Reference(aid), Object::Reference(bid)) = (a, b) {
            if !seen.insert((*aid, *bid)) {
                return true;
            }
        }
        let Ok((_, a)) = before.dereference(a) else {
            return false;
        };
        let Ok((_, b)) = after.dereference(b) else {
            return false;
        };
        match (a, b) {
            (Object::Dictionary(a), Object::Dictionary(b)) => {
                let page = a.get(b"Type").and_then(Object::as_name).ok() == Some(b"Page");
                let keys = a.iter().map(|(k, _)| k).chain(b.iter().map(|(k, _)| k));
                keys.filter(|k| !(page && k.as_slice() == b"Annots"))
                    .all(|key| match (a.get(key), b.get(key)) {
                        (Ok(a), Ok(b)) => same(a, b, before, after, seen, depth + 1),
                        _ => false,
                    })
            }
            (Object::Array(a), Object::Array(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .zip(b)
                        .all(|(a, b)| same(a, b, before, after, seen, depth + 1))
            }
            (Object::Stream(a), Object::Stream(b)) => {
                let decoded = |s: &lopdf::Stream| {
                    if s.dict.has(b"Filter") {
                        s.decompressed_content().ok()
                    } else {
                        Some(s.content.clone())
                    }
                };
                let mut ad = a.dict.clone();
                let mut bd = b.dict.clone();
                for key in [b"Length".as_slice(), b"Filter", b"DecodeParms"] {
                    ad.remove(key);
                    bd.remove(key);
                }
                let content = decoded(a);
                content.is_some()
                    && content == decoded(b)
                    && same(
                        &Object::Dictionary(ad),
                        &Object::Dictionary(bd),
                        before,
                        after,
                        seen,
                        depth + 1,
                    )
            }
            (Object::Integer(a), Object::Real(b)) => *a as f64 == f64::from(*b),
            (Object::Real(a), Object::Integer(b)) => f64::from(*a) == *b as f64,
            (Object::String(a, _), Object::String(b, _)) => a == b,
            _ => a == b,
        }
    }
    for key in [b"Root".as_slice(), b"Info"] {
        match (before.trailer.get(key), after.trailer.get(key)) {
            (Ok(a), Ok(b)) if same(a, b, &before, &after, &mut seen, 0) => {}
            (Err(_), Err(_)) => {}
            _ => return Err("Saving blocked: unrelated PDF content or metadata changed".into()),
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn pdf() -> Vec<u8> {
        use lopdf::{dictionary, Document, Object, Stream};
        let mut doc = Document::with_version("1.7");
        let pages = doc.new_object_id();
        let content = doc.add_object(Stream::new(dictionary! {}, b"BT ET".to_vec()));
        let page = doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages, "MediaBox" => vec![0.into(),0.into(),612.into(),792.into()], "Contents" => content });
        doc.objects.insert(
            pages,
            Object::Dictionary(
                dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 },
            ),
        );
        let root = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        doc.trailer.set("Root", root);
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        bytes
    }
    fn directory() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "monight-save-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn existing_save_checks_loaded_version_and_supports_repeated_native_round_trips() {
        let dir = directory();
        let source = dir.join("source.pdf");
        let original = include_bytes!("../tests/fixtures/native-annotations/original.pdf");
        let annotated = include_bytes!("../tests/fixtures/native-annotations/annotated.pdf");
        let deleted = include_bytes!("../tests/fixtures/native-annotations/deleted.pdf");
        std::fs::write(&source, original).unwrap();
        let writer = PdfSave::default();
        let token = writer.capture_source(&source, original).unwrap();
        assert_eq!(writer.write_original(&token, annotated).unwrap(), annotated);
        assert_eq!(std::fs::read(&source).unwrap(), annotated);
        assert_eq!(writer.write_original(&token, deleted).unwrap(), deleted);
        std::fs::write(&source, b"external changes").unwrap();
        assert!(writer
            .write_original(&token, annotated)
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(std::fs::read(&source).unwrap(), b"external changes");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_as_replaces_only_the_selected_version_and_blocks_open_aliases() {
        let dir = directory();
        let original = pdf();
        let path = dir.join("copy.pdf");
        std::fs::write(&path, b"previous destination").unwrap();
        let writer = PdfSave::default();
        let selected = writer.authorize(&path).unwrap();
        writer
            .write_new(&selected.token, &original, &original)
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let source = writer.capture_source(&path, &original).unwrap();
        let alias = dir.join("hardlink.pdf");
        std::fs::hard_link(&path, &alias).unwrap();
        let selected = writer.authorize(&alias).unwrap();
        assert!(writer
            .write_new(&selected.token, &original, &original)
            .unwrap_err()
            .contains("already open"));
        writer.release_source(&source);
        let selected = writer.authorize(&path).unwrap();
        std::fs::write(&path, b"external destination changes").unwrap();
        assert!(writer
            .write_new(&selected.token, &original, &original)
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"external destination changes"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn original_save_refuses_disappearance_identical_replacement_and_failed_validation() {
        for scenario in ["missing", "replaced", "damaged", "readonly"] {
            let dir = directory();
            let path = dir.join("source.pdf");
            let bytes = pdf();
            std::fs::write(&path, &bytes).unwrap();
            let writer = PdfSave::default();
            let token = writer.capture_source(&path, &bytes).unwrap();
            match scenario {
                "missing" => std::fs::remove_file(&path).unwrap(),
                "replaced" => {
                    std::fs::rename(&path, dir.join("old.pdf")).unwrap();
                    std::fs::write(&path, &bytes).unwrap();
                }
                "readonly" => {
                    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
                    permissions.set_readonly(true);
                    std::fs::set_permissions(&path, permissions).unwrap();
                }
                _ => {}
            }
            assert!(writer
                .write_original(
                    &token,
                    if scenario == "damaged" {
                        b"invalid"
                    } else {
                        &bytes
                    }
                )
                .is_err());
            if scenario != "missing" {
                assert_eq!(std::fs::read(&path).unwrap(), bytes);
            }
            if scenario == "readonly" {
                let mut permissions = std::fs::metadata(&path).unwrap().permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                permissions.set_readonly(false);
                std::fs::set_permissions(&path, permissions).unwrap();
            }
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn concurrent_source_generations_cannot_overwrite_each_other() {
        use std::sync::{Arc, Barrier};
        let dir = directory();
        let path = dir.join("source.pdf");
        let original = include_bytes!("../tests/fixtures/native-annotations/original.pdf");
        let annotated = include_bytes!("../tests/fixtures/native-annotations/annotated.pdf");
        let deleted = include_bytes!("../tests/fixtures/native-annotations/deleted.pdf");
        std::fs::write(&path, original).unwrap();
        let writer = Arc::new(PdfSave::default());
        let a = writer.capture_source(&path, original).unwrap();
        let b = writer.capture_source(&path, original).unwrap();
        let barrier = Arc::new(Barrier::new(2));
        let jobs: Vec<_> = [
            (a.clone(), annotated.as_slice()),
            (b.clone(), deleted.as_slice()),
        ]
        .into_iter()
        .map(|(token, bytes)| {
            let writer = writer.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                writer.write_original(&token, bytes)
            })
        })
        .collect();
        let outcomes: Vec<_> = jobs.into_iter().map(|job| job.join().unwrap()).collect();
        assert_eq!(outcomes.iter().filter(|r| r.is_ok()).count(), 1);
        let persisted = std::fs::read(&path).unwrap();
        assert_eq!(
            &persisted,
            outcomes.iter().find_map(|r| r.as_ref().ok()).unwrap()
        );
        writer.release_source(&a);
        writer.release_source(&b);
        assert!(writer.write_original(&a, original).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), persisted);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn destination_writes_require_a_live_source_and_preserve_its_native_content() {
        let dir = directory();
        let path = dir.join("source.pdf");
        let original = include_bytes!("../tests/fixtures/native-annotations/original.pdf");
        let annotated = include_bytes!("../tests/fixtures/native-annotations/annotated.pdf");
        std::fs::write(&path, original).unwrap();
        let writer = PdfSave::default();
        let token = writer.capture_source(&path, original).unwrap();
        let target = dir.join("copy.pdf");
        let selected = writer.authorize(&target).unwrap();
        assert!(writer
            .write_destination(&selected.token, "unknown", annotated)
            .is_err());
        assert!(!target.exists());
        writer
            .write_destination(&selected.token, &token, annotated)
            .unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), annotated);
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let selected = writer.authorize(&target).unwrap();
        assert!(writer
            .write_destination(&selected.token, &token, b"invalid PDF")
            .is_err());
        assert_eq!(std::fs::read(&target).unwrap(), annotated);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replacement_race_restores_the_competing_file_and_does_not_accept_the_save() {
        let dir = directory();
        let path = dir.join("source.pdf");
        let original = pdf();
        std::fs::write(&path, &original).unwrap();
        let writer = PdfSave::with_write_hook(|phase, path| {
            if phase == WritePhase::BeforeReplace {
                std::fs::rename(path, path.with_extension("prior")).unwrap();
                std::fs::write(path, b"competing writer's replacement").unwrap();
            }
            Ok(())
        });
        let source = writer.capture_source(&path, &original).unwrap();
        assert!(writer
            .write_original(&source, &original)
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            b"competing writer's replacement"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn failed_race_rollback_retains_both_versions_for_explicit_recovery() {
        let dir = directory();
        let path = dir.join("source.pdf");
        let original = pdf();
        std::fs::write(&path, &original).unwrap();
        let writer = PdfSave::with_write_hook(|phase, path| {
            if phase == WritePhase::BeforeReplace {
                std::fs::write(path, b"competing edits").unwrap();
            }
            if phase == WritePhase::BeforeRollback {
                std::fs::rename(path, path.with_extension("moved")).unwrap();
            }
            Ok(())
        });
        let source = writer.capture_source(&path, &original).unwrap();
        let error = writer.write_original(&source, &original).unwrap_err();
        assert!(error.contains("conflict"));
        assert!(error.contains("retained at"));
        let retained: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| std::fs::read(entry.path()).unwrap())
            .collect();
        assert!(retained.contains(&b"competing edits".to_vec()));
        assert!(retained.contains(&original));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn staged_failure_preserves_original_and_uncertain_durability_retains_previous_version() {
        for phase in [WritePhase::Staged, WritePhase::BeforeSync] {
            let dir = directory();
            let path = dir.join("source.pdf");
            let original = include_bytes!("../tests/fixtures/native-annotations/original.pdf");
            let annotated = include_bytes!("../tests/fixtures/native-annotations/annotated.pdf");
            std::fs::write(&path, original).unwrap();
            let hook = match phase {
                WritePhase::Staged => |point, _: &Path| {
                    if point == WritePhase::Staged {
                        Err("Injected staged write failure".into())
                    } else {
                        Ok(())
                    }
                },
                _ => |point, _: &Path| {
                    if point == WritePhase::BeforeSync {
                        Err("Injected durability failure".into())
                    } else {
                        Ok(())
                    }
                },
            };
            let writer = PdfSave::with_write_hook(hook);
            let source = writer.capture_source(&path, original).unwrap();
            assert!(writer.write_original(&source, annotated).is_err());
            if phase == WritePhase::Staged {
                assert_eq!(std::fs::read(&path).unwrap(), original);
            } else {
                assert_eq!(std::fs::read(&path).unwrap(), annotated);
                assert!(std::fs::read_dir(&dir)
                    .unwrap()
                    .filter_map(Result::ok)
                    .any(|entry| entry.path() != path
                        && std::fs::read(entry.path()).unwrap() == original));
                // Uncertain completion does not advance the authorized source version.
                assert!(writer
                    .write_original(&source, annotated)
                    .unwrap_err()
                    .contains("conflict"));
            }
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn new_file_round_trip_preserves_original_and_authorization_is_single_use() {
        let dir = directory();
        let original = pdf();
        let source = dir.join("source.pdf");
        std::fs::write(&source, &original).unwrap();
        let writer = PdfSave::default();
        let selected = writer.authorize(&dir.join("copy.pdf")).unwrap();
        let (path, read_back) = writer
            .write_new(&selected.token, &original, &original)
            .unwrap();
        assert_eq!(read_back, original);
        assert_eq!(std::fs::read(path).unwrap(), original);
        assert_eq!(std::fs::read(source).unwrap(), original);
        assert!(writer
            .write_new(&selected.token, &original, &original)
            .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn writer_refuses_existing_raced_and_unselected_destinations() {
        let dir = directory();
        let writer = PdfSave::default();
        let original = pdf();
        let path = dir.join("copy.pdf");
        let selection = writer.authorize(&path).unwrap();
        std::fs::write(&path, b"other reader's work").unwrap();
        assert!(writer
            .write_new(&selection.token, &original, &original)
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"other reader's work");
        let replacement = writer.authorize(&path).unwrap();
        writer.release(&replacement.token);
        assert!(writer.write_new("unknown", &original, &original).is_err());
        let selection = writer.authorize(&dir.join("cancelled.pdf")).unwrap();
        writer.release(&selection.token);
        assert!(writer
            .write_new(&selection.token, &original, &original)
            .is_err());
        assert!(!dir.join("cancelled.pdf").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn writer_blocks_content_damage_before_creating_a_file() {
        let dir = directory();
        let writer = PdfSave::default();
        let original = pdf();
        let mut damaged = lopdf::Document::load_mem(&original).unwrap();
        let id = *damaged.get_pages().values().next().unwrap();
        damaged
            .get_object_mut(id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Rotate", 90);
        let mut bytes = Vec::new();
        damaged.save_to(&mut bytes).unwrap();
        let selected = writer.authorize(&dir.join("damaged.pdf")).unwrap();
        assert!(writer
            .write_new(&selected.token, &bytes, &original)
            .is_err());
        assert!(!dir.join("damaged.pdf").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn protected_and_unsupported_documents_are_read_only() {
        use lopdf::{dictionary, Object};
        for annotation in [
            dictionary! { "FT" => "Sig", "ByteRange" => vec![0.into(), 100.into()] },
            dictionary! { "Subtype" => "Ink" },
        ] {
            let mut doc = lopdf::Document::load_mem(&pdf()).unwrap();
            let id = doc.add_object(annotation);
            let page = *doc.get_pages().values().next().unwrap();
            doc.get_object_mut(page)
                .unwrap()
                .as_dict_mut()
                .unwrap()
                .set("Annots", vec![Object::Reference(id)]);
            let mut bytes = Vec::new();
            doc.save_to(&mut bytes).unwrap();
            assert!(editing_status(&bytes).is_some());
        }
        let mut doc = lopdf::Document::load_mem(&pdf()).unwrap();
        doc.trailer.set(
            "Encrypt",
            dictionary! { "Filter" => "Standard", "V" => 1, "R" => 2, "P" => -64 },
        );
        let mut bytes = Vec::new();
        doc.save_to(&mut bytes).unwrap();
        assert!(editing_status(&bytes).is_some());
    }

    #[test]
    fn protected_fixture_matrix_reports_specific_read_only_reasons() {
        for ((_, bytes), reason) in crate::test_support::protected_pdf_fixtures()
            .into_iter()
            .zip([
            "PDF permissions prohibit annotation editing; this Document is read-only",
            "Encrypted PDFs are read-only because Save, Save As, and Recovery Drafts cannot preserve their protection",
            "Digitally signed PDFs are read-only to preserve their signatures",
        ])
        {
            assert_eq!(editing_status(bytes).as_deref(), Some(reason));
        }
    }

    #[test]
    fn empty_signature_field_is_not_treated_as_an_applied_signature() {
        use lopdf::{dictionary, Object};

        let mut document = lopdf::Document::load_mem(&pdf()).unwrap();
        let widget = document.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Widget",
            "FT" => "Sig",
            "V" => Object::Null,
        });
        let form = document.add_object(dictionary! { "Fields" => vec![widget.into()] });
        let root = document
            .trailer
            .get(b"Root")
            .unwrap()
            .as_reference()
            .unwrap();
        document
            .get_object_mut(root)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("AcroForm", Object::Reference(form));
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).unwrap();

        assert_eq!(
            editing_status(&bytes).as_deref(),
            Some("PDF form preservation has not been verified; this Document is read-only")
        );
    }

    #[test]
    fn excessive_object_nesting_fails_safety_inspection_closed() {
        use lopdf::{dictionary, Object};

        let mut document = lopdf::Document::load_mem(&pdf()).unwrap();
        let mut nested = Object::Null;
        for _ in 0..=201 {
            nested = Object::Dictionary(dictionary! { "Next" => nested });
        }
        document.add_object(nested);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).unwrap();

        assert_eq!(
            editing_status(&bytes).as_deref(),
            Some("PDF object nesting exceeds the safety inspection limit; this Document is read-only")
        );
    }

    #[test]
    fn protected_documents_cannot_use_save_or_save_as() {
        for (name, bytes) in crate::test_support::protected_pdf_fixtures() {
            let dir = directory();
            let source = dir.join(format!("{name}.pdf"));
            std::fs::write(&source, bytes).unwrap();
            let writer = PdfSave::default();
            let source_token = writer.capture_source(&source, bytes).unwrap();

            assert!(writer.write_original(&source_token, bytes).is_err());
            assert_eq!(std::fs::read(&source).unwrap(), bytes);

            let destination_path = dir.join(format!("{name}-copy.pdf"));
            let destination = writer.authorize(&destination_path).unwrap();
            assert!(writer
                .write_destination(&destination.token, &source_token, bytes)
                .is_err());
            assert!(!destination_path.exists());
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

    #[test]
    fn filesystem_read_only_source_can_save_as_when_pdf_policy_allows_editing() {
        let dir = directory();
        let source = dir.join("read-only.pdf");
        let bytes = include_bytes!("../tests/fixtures/native-annotations/original.pdf");
        std::fs::write(&source, bytes).unwrap();
        let mut permissions = std::fs::metadata(&source).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&source, permissions).unwrap();
        let writer = PdfSave::default();
        let source_token = writer.capture_source(&source, bytes).unwrap();

        assert!(writer.write_original(&source_token, bytes).is_err());
        let destination_path = dir.join("editable-copy.pdf");
        let destination = writer.authorize(&destination_path).unwrap();
        writer
            .write_destination(&destination.token, &source_token, bytes)
            .unwrap();
        assert_eq!(std::fs::read(&destination_path).unwrap(), bytes);
        assert_eq!(std::fs::read(&source).unwrap(), bytes);

        let mut permissions = std::fs::metadata(&source).unwrap().permissions();
        #[allow(clippy::permissions_set_readonly_false)]
        permissions.set_readonly(false);
        std::fs::set_permissions(&source, permissions).unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_destinations_cannot_replace_the_original_even_after_selection() {
        let dir = directory();
        let writer = PdfSave::default();
        let bytes = pdf();
        let source = dir.join("source.pdf");
        std::fs::write(&source, &bytes).unwrap();
        let alias = dir.join("alias.pdf");
        let selected = writer.authorize(&alias).unwrap();
        std::os::unix::fs::symlink(&source, &alias).unwrap();
        assert!(writer.write_new(&selected.token, &bytes, &bytes).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), bytes);
        let alias_selection = writer.authorize(&alias).unwrap();
        assert_eq!(
            PathBuf::from(alias_selection.canonical_path),
            source.canonicalize().unwrap()
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn real_embedpdf_native_annotations_survive_disk_round_trip_without_content_changes() {
        let original = include_bytes!("../tests/fixtures/native-annotations/original.pdf");
        let annotated = include_bytes!("../tests/fixtures/native-annotations/annotated.pdf");
        let deleted = include_bytes!("../tests/fixtures/native-annotations/deleted.pdf");
        let dir = directory();
        let writer = PdfSave::default();
        let selected = writer.authorize(&dir.join("annotated.pdf")).unwrap();
        let (_, reopened) = writer
            .write_new(&selected.token, annotated, original)
            .unwrap();
        let document = lopdf::Document::load_mem(&reopened).unwrap();
        let page = document
            .get_dictionary(*document.get_pages().get(&1).unwrap())
            .unwrap();
        let (_, annots) = document.dereference(page.get(b"Annots").unwrap()).unwrap();
        let objects: Vec<_> = annots
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| document.dereference(entry).unwrap().1.as_dict().unwrap())
            .collect();
        let highlight = objects
            .iter()
            .find(|d| d.get(b"Subtype").unwrap().as_name().unwrap() == b"Highlight")
            .unwrap();
        assert_eq!(
            highlight
                .get(b"QuadPoints")
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            8
        );
        assert!(objects
            .iter()
            .any(|d| d.get(b"Subtype").unwrap().as_name().unwrap() == b"Text"));
        let selected = writer.authorize(&dir.join("deleted.pdf")).unwrap();
        writer
            .write_new(&selected.token, deleted, annotated)
            .unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
