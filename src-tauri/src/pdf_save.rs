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
        let normalized = prepare_supported_popups(bytes)?;
        let bytes = normalized.as_deref().unwrap_or(bytes);
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
        let normalized = prepare_supported_popups(bytes)?;
        let bytes = normalized.as_deref().unwrap_or(bytes);
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

const EDITABLE_ANNOTATIONS: &[&[u8]] =
    &[b"Highlight", b"Text", b"Popup", b"Underline", b"StrikeOut"];
// Never edited by Monight (the viewer locks them); saving must carry them through
// unchanged. Unverified Squiggly markup can arrive from other PDF readers.
const PRESERVED_ANNOTATIONS: &[&[u8]] = &[b"Link", b"Squiggly"];

/// A Popup belongs to an Annotation Monight edits: any editable subtype but Popup.
fn is_editable_popup_parent(subtype: &[u8]) -> bool {
    subtype != b"Popup" && EDITABLE_ANNOTATIONS.contains(&subtype)
}

fn is_supported_annotation(subtype: &[u8]) -> bool {
    EDITABLE_ANNOTATIONS.contains(&subtype) || PRESERVED_ANNOTATIONS.contains(&subtype)
}

pub fn prepare_save(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if let Some(normalized) = prepare_supported_popups(bytes)? {
        verify_preservation(bytes, &normalized)?;
        Ok(normalized)
    } else {
        Ok(bytes.to_vec())
    }
}

// Keep native Popup relationships usable in both readers. Acrobat follows orphaned
// children back to deleted comments; Preview cannot reopen a Text note's editor
// without a linked Popup after reload (even for its own exported notes). Preserve
// existing live relationships and all note properties, including appearance/Rect.
fn prepare_supported_popups(bytes: &[u8]) -> Result<Option<Vec<u8>>, String> {
    use lopdf::{dictionary, Object};
    let mut document = load_editable(bytes)?;
    let mut changed = false;
    for page_id in document.get_pages().values() {
        let page = document
            .get_dictionary(*page_id)
            .map_err(|e| e.to_string())?;
        let Ok(array) = page.get(b"Annots") else {
            continue;
        };
        let (_, array) = document.dereference(array).map_err(|e| e.to_string())?;
        let annots = array.as_array().map_err(|e| e.to_string())?.clone();
        let live_ids = annots
            .iter()
            .filter_map(|entry| document.dereference(entry).ok().and_then(|(id, _)| id))
            .collect::<std::collections::HashSet<_>>();
        let mut retained = Vec::new();
        for entry in &annots {
            let (id, object) = document.dereference(entry).map_err(|e| e.to_string())?;
            let mut annotation = object.as_dict().map_err(|e| e.to_string())?.clone();
            let orphaned =
                if annotation.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Popup") {
                    annotation
                        .get(b"Parent")
                        .ok()
                        .and_then(|parent| document.dereference(parent).ok())
                        .is_some_and(|(id, parent)| {
                            id.is_some_and(|id| !live_ids.contains(&id))
                                && parent
                                    .as_dict()
                                    .ok()
                                    .and_then(|parent| parent.get(b"Subtype").ok())
                                    .and_then(|subtype| subtype.as_name().ok())
                                    .is_some_and(is_editable_popup_parent)
                        })
                } else {
                    false
                };
            if orphaned {
                changed = true;
                continue;
            }
            if annotation.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Text")
                && !annotation.has(b"Popup")
            {
                // /Parent needs an indirect reference, including for a direct Text
                // dictionary embedded in /Annots. Do not recreate existing notes.
                let note_id = id.unwrap_or_else(|| document.new_object_id());
                let popup_id = document.add_object(dictionary! {
                    "Type" => "Annot",
                    "Subtype" => "Popup",
                    "Rect" => vec![0.into(), 0.into(), 200.into(), 100.into()],
                    "Parent" => note_id,
                    "P" => *page_id,
                    "Open" => false,
                });
                annotation.set("Popup", popup_id);
                document
                    .objects
                    .insert(note_id, Object::Dictionary(annotation));
                retained.push(Object::Reference(note_id));
                retained.push(Object::Reference(popup_id));
                changed = true;
            } else {
                retained.push(entry.clone());
            }
        }
        if retained != annots {
            document
                .get_dictionary_mut(*page_id)
                .map_err(|e| e.to_string())?
                .set("Annots", Object::Array(retained));
            changed = true;
        }
    }
    if !changed {
        return Ok(None);
    }
    let mut normalized = Vec::new();
    document
        .save_to(&mut normalized)
        .map_err(|e| e.to_string())?;
    Ok(Some(normalized))
}

fn preserved_page_annotations(
    document: &lopdf::Document,
    page: lopdf::ObjectId,
) -> Result<Vec<lopdf::Dictionary>, String> {
    let page = document.get_dictionary(page).map_err(|e| e.to_string())?;
    let Ok(annots) = page.get(b"Annots") else {
        return Ok(Vec::new());
    };
    let (_, array) = document.dereference(annots).map_err(|e| e.to_string())?;
    let mut preserved = Vec::new();
    for entry in array.as_array().map_err(|e| e.to_string())? {
        let (_, annotation) = document.dereference(entry).map_err(|e| e.to_string())?;
        let annotation = annotation.as_dict().map_err(|e| e.to_string())?;
        let subtype = annotation
            .get(b"Subtype")
            .and_then(lopdf::Object::as_name)
            .map_err(|e| e.to_string())?;
        if PRESERVED_ANNOTATIONS.contains(&subtype) {
            preserved.push(annotation.clone());
        }
    }
    Ok(preserved)
}

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

// Acrobat may add default form resources when saving annotations, even when
// there are no fields. Accept only that empty scaffolding; retain the normal
// content-graph preservation check when saving it.
fn is_empty_form_scaffolding(document: &lopdf::Document, object: &lopdf::Object) -> bool {
    use lopdf::Object;
    let Ok((_, Object::Dictionary(form))) = document.dereference(object) else {
        return false;
    };
    if !form
        .get(b"Fields")
        .ok()
        .and_then(|fields| document.dereference(fields).ok())
        .and_then(|(_, fields)| fields.as_array().ok())
        .is_some_and(Vec::is_empty)
    {
        return false;
    }
    form.iter().all(|(key, value)| match key.as_slice() {
        b"Fields" => true,
        b"DA" => value.as_str().is_ok(),
        b"DR" => document
            .dereference(value)
            .is_ok_and(|(_, resources)| resources.as_dict().is_ok()),
        b"NeedAppearances" => value.as_bool().is_ok(),
        _ => false,
    })
}

fn load_editable(bytes: &[u8]) -> Result<lopdf::Document, String> {
    let parsed = std::thread::scope(|scope| -> Result<_, String> {
        let worker = std::thread::Builder::new()
            .name("pdf-safety-inspection".into())
            .stack_size(8 * 1024 * 1024)
            .spawn_scoped(scope, || lopdf::Document::load_mem(bytes))
            .map_err(|e| format!("PDF safety inspection failed to start: {e}"))?;
        worker
            .join()
            .map_err(|_| "PDF safety inspection parser stopped unexpectedly".to_string())
    })?;
    let document = parsed.map_err(|e| format!("PDF safety inspection failed: {e}"))?;

    if let Some(encryption) = &document.encryption_state {
        if !encryption
            .permissions()
            .contains(lopdf::Permissions::ANNOTABLE)
        {
            return Err(
                "PDF permissions prohibit annotation editing; this Document is read-only".into(),
            );
        }
        return Err("Encrypted PDFs are read-only because Save, Save As, and Recovery Drafts cannot preserve their protection".into());
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
    if document.reference_table.entries.iter().any(|(id, entry)| {
        use lopdf::xref::XrefEntry;
        let object_id = match entry {
            XrefEntry::Normal { generation, .. } => Some((*id, *generation)),
            XrefEntry::Compressed { .. } => Some((*id, 0)),
            XrefEntry::Free | XrefEntry::UnusableFree => None,
        };
        object_id.is_some_and(|object_id| !document.objects.contains_key(&object_id))
    }) {
        return Err(
            "PDF object nesting exceeds the safety inspection limit; this Document is read-only"
                .into(),
        );
    }

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
    visit_document_dictionaries(&document, |dictionary| {
        if dictionary.has(b"XFA")
            || dictionary.has(b"FT")
            || dictionary
                .get(b"AcroForm")
                .is_ok_and(|form| !is_empty_form_scaffolding(&document, form))
        {
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
            if !is_supported_annotation(subtype) {
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
                if !is_supported_annotation(subtype) {
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
    // relying on object numbers surviving PDFium's serialization. Page annotation lists
    // may change only in their editable entries; preserved ones are compared below and
    // all other annotations are blocked at intake. On a mismatch, `path` is left naming
    // where the graphs diverge so the refusal can say what changed.
    fn within(
        segment: String,
        a: &lopdf::Object,
        b: &lopdf::Object,
        before: &lopdf::Document,
        after: &lopdf::Document,
        seen: &mut std::collections::HashSet<(lopdf::ObjectId, lopdf::ObjectId)>,
        path: &mut Vec<String>,
    ) -> bool {
        path.push(segment);
        let matched = same(a, b, before, after, seen, path);
        if matched {
            path.pop();
        }
        matched
    }
    fn same(
        a: &lopdf::Object,
        b: &lopdf::Object,
        before: &lopdf::Document,
        after: &lopdf::Document,
        seen: &mut std::collections::HashSet<(lopdf::ObjectId, lopdf::ObjectId)>,
        path: &mut Vec<String>,
    ) -> bool {
        use lopdf::Object;
        if path.len() > 200 {
            path.push("(nesting limit)".into());
            return false;
        }
        if let (Object::Reference(aid), Object::Reference(bid)) = (a, b) {
            if !seen.insert((*aid, *bid)) {
                return true;
            }
        }
        let (Ok((_, a)), Ok((_, b))) = (before.dereference(a), after.dereference(b)) else {
            path.push("(unresolvable reference)".into());
            return false;
        };
        match (a, b) {
            (Object::Dictionary(a), Object::Dictionary(b)) => {
                let page = a.get(b"Type").and_then(Object::as_name).ok() == Some(b"Page");
                // PDFium names every annotation and generates missing appearances on
                // save. Preserved annotations may also be reached through the structure
                // tree, so the allowance applies wherever they are compared.
                let preserved = a
                    .get(b"Subtype")
                    .and_then(Object::as_name)
                    .is_ok_and(|subtype| PRESERVED_ANNOTATIONS.contains(&subtype));
                let generated = |key: &[u8]| {
                    preserved
                        && !a.has(key)
                        && [b"NM".as_slice(), b"AP", b"PDFIUM_HasGeneratedAP"].contains(&key)
                };
                // Page Rotation is a Document edit: a page's own /Rotate may change to
                // any quarter turn (or be removed to inherit again), never to anything else.
                let rotation_edit = |key: &[u8]| {
                    page && key == b"Rotate"
                        && b.get(key).map_or(true, |rotation| {
                            rotation.as_i64().is_ok_and(|degrees| degrees % 90 == 0)
                        })
                };
                let keys = a.iter().map(|(k, _)| k).chain(b.iter().map(|(k, _)| k));
                keys.filter(|k| {
                    !(page && k.as_slice() == b"Annots") && !generated(k) && !rotation_edit(k)
                })
                .all(|key| {
                    let segment = format!("/{}", String::from_utf8_lossy(key));
                    match (a.get(key), b.get(key)) {
                        (Ok(a), Ok(b)) => within(segment, a, b, before, after, seen, path),
                        _ => {
                            path.push(segment);
                            false
                        }
                    }
                })
            }
            (Object::Array(a), Object::Array(b)) => {
                if a.len() != b.len() {
                    path.push("(array length)".into());
                    return false;
                }
                a.iter().zip(b).enumerate().all(|(index, (a, b))| {
                    within(format!("[{index}]"), a, b, before, after, seen, path)
                })
            }
            (Object::Stream(a), Object::Stream(b)) => {
                let decoded = |s: &lopdf::Stream| {
                    if s.dict.has(b"Filter") {
                        s.decompressed_content().ok()
                    } else {
                        Some(s.content.clone())
                    }
                };
                let (decoded_a, decoded_b) = (decoded(a), decoded(b));
                // Image codecs such as DCTDecode cannot be decoded here; those streams
                // must keep their encoded bytes and encoding parameters unchanged.
                let content = match (&decoded_a, &decoded_b) {
                    (Some(_), Some(_)) => decoded_a == decoded_b,
                    _ => a.content == b.content,
                };
                let mut ad = a.dict.clone();
                let mut bd = b.dict.clone();
                ad.remove(b"Length");
                bd.remove(b"Length");
                if decoded_a.is_some() && decoded_b.is_some() {
                    for key in [b"Filter".as_slice(), b"DecodeParms"] {
                        ad.remove(key);
                        bd.remove(key);
                    }
                }
                if !content {
                    path.push("(stream data)".into());
                    return false;
                }
                same(
                    &Object::Dictionary(ad),
                    &Object::Dictionary(bd),
                    before,
                    after,
                    seen,
                    path,
                )
            }
            (Object::Integer(a), Object::Real(b)) => *a as f64 == f64::from(*b),
            (Object::Real(a), Object::Integer(b)) => f64::from(*a) == *b as f64,
            (Object::String(a, _), Object::String(b, _)) => a == b,
            _ => a == b,
        }
    }
    let changed = |path: &[String]| {
        format!(
            "Saving blocked: unrelated PDF content or metadata changed at {}",
            path.concat()
        )
    };
    for key in [b"Root".as_slice(), b"Info"] {
        let mut path = vec![String::from_utf8_lossy(key).into_owned()];
        match (before.trailer.get(key), after.trailer.get(key)) {
            (Ok(a), Ok(b)) if same(a, b, &before, &after, &mut seen, &mut path) => {}
            (Err(_), Err(_)) => {}
            _ => return Err(changed(&path)),
        }
    }
    let (before_pages, after_pages) = (before.get_pages(), after.get_pages());
    if before_pages.len() != after_pages.len() {
        return Err(changed(&["page count".into()]));
    }
    for ((number, before_page), after_page) in before_pages.iter().zip(after_pages.values()) {
        let a = preserved_page_annotations(&before, *before_page)?;
        let b = preserved_page_annotations(&after, *after_page)?;
        let mut path = Vec::new();
        if a.len() != b.len()
            || !a.into_iter().zip(b).all(|(a, b)| {
                same(
                    &lopdf::Object::Dictionary(a),
                    &lopdf::Object::Dictionary(b),
                    &before,
                    &after,
                    &mut seen,
                    &mut path,
                )
            })
        {
            return Err(format!(
                "Saving blocked: links or other preserved annotations changed on page {number}"
            ));
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
        let prepared = prepare_save(annotated).unwrap();
        assert_eq!(writer.write_original(&token, annotated).unwrap(), prepared);
        assert_eq!(std::fs::read(&source).unwrap(), prepared);
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
        assert_eq!(
            std::fs::read(&target).unwrap(),
            prepare_save(annotated).unwrap()
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let selected = writer.authorize(&target).unwrap();
        assert!(writer
            .write_destination(&selected.token, &token, b"invalid PDF")
            .is_err());
        assert_eq!(
            std::fs::read(&target).unwrap(),
            prepare_save(annotated).unwrap()
        );
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
                assert_eq!(
                    std::fs::read(&path).unwrap(),
                    prepare_save(annotated).unwrap()
                );
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
            .set("MediaBox", vec![0.into(), 0.into(), 300.into(), 300.into()]);
        let mut bytes = Vec::new();
        damaged.save_to(&mut bytes).unwrap();
        let selected = writer.authorize(&dir.join("damaged.pdf")).unwrap();
        assert!(writer
            .write_new(&selected.token, &bytes, &original)
            .is_err());
        assert!(!dir.join("damaged.pdf").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    fn with_page_rotation(
        original: &[u8],
        pages_rotation: Option<i64>,
        page: lopdf::Object,
    ) -> Vec<u8> {
        let mut document = lopdf::Document::load_mem(original).unwrap();
        let id = *document.get_pages().values().next().unwrap();
        if let Some(inherited) = pages_rotation {
            let parent = document
                .get_dictionary(id)
                .unwrap()
                .get(b"Parent")
                .unwrap()
                .as_reference()
                .unwrap();
            document
                .get_object_mut(parent)
                .unwrap()
                .as_dict_mut()
                .unwrap()
                .set("Rotate", inherited);
        }
        document
            .get_object_mut(id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("Rotate", page);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).unwrap();
        bytes
    }

    fn first_page_rotation(bytes: &[u8]) -> Option<i64> {
        let document = lopdf::Document::load_mem(bytes).unwrap();
        let id = *document.get_pages().values().next().unwrap();
        document
            .get_dictionary(id)
            .unwrap()
            .get(b"Rotate")
            .ok()
            .map(|rotation| rotation.as_i64().unwrap())
    }

    #[test]
    fn page_rotation_is_saved_like_an_annotation_edit_with_conflict_detection() {
        let dir = directory();
        let source = dir.join("source.pdf");
        let original = pdf();
        std::fs::write(&source, &original).unwrap();
        let writer = PdfSave::default();
        let token = writer.capture_source(&source, &original).unwrap();
        let rotated = with_page_rotation(&original, None, 90.into());
        let reopened = writer.write_original(&token, &rotated).unwrap();
        assert_eq!(first_page_rotation(&reopened), Some(90));
        assert_eq!(
            first_page_rotation(&std::fs::read(&source).unwrap()),
            Some(90)
        );
        // Rotating back is a further edit of the saved version.
        let restored = with_page_rotation(&reopened, None, 0.into());
        assert_eq!(
            first_page_rotation(&writer.write_original(&token, &restored).unwrap()),
            Some(0)
        );
        std::fs::write(&source, b"external changes").unwrap();
        assert!(writer
            .write_original(&token, &rotated)
            .unwrap_err()
            .contains("conflict"));
        assert_eq!(std::fs::read(&source).unwrap(), b"external changes");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn page_rotation_edits_accept_only_quarter_turns_including_over_inherited_rotation() {
        let original = with_page_rotation(&pdf(), Some(90), lopdf::Object::Null);
        let mut document = lopdf::Document::load_mem(&original).unwrap();
        let id = *document.get_pages().values().next().unwrap();
        document
            .get_object_mut(id)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .remove(b"Rotate");
        let mut inherited = Vec::new();
        document.save_to(&mut inherited).unwrap();
        for rotation in [0, 180, 270, -90, 450] {
            verify_preservation(
                &inherited,
                &with_page_rotation(&inherited, None, rotation.into()),
            )
            .unwrap();
        }
        for rotation in [
            lopdf::Object::from(45),
            lopdf::Object::Real(90.5),
            "90".into(),
        ] {
            assert!(verify_preservation(
                &inherited,
                &with_page_rotation(&inherited, None, rotation)
            )
            .unwrap_err()
            .ends_with("/Rotate"));
        }
        // The inherited value itself is Document structure, not a Page Rotation edit.
        assert!(verify_preservation(
            &inherited,
            &with_page_rotation(&inherited, Some(180), 90.into())
        )
        .is_err());
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
    fn undecodable_images_compare_by_encoded_bytes_and_refusals_name_the_change() {
        use lopdf::{dictionary, Object, Stream};
        let with_image = |data: &[u8]| {
            let mut doc = lopdf::Document::load_mem(&pdf()).unwrap();
            let image = doc.add_object(Stream::new(
                dictionary! { "Type" => "XObject", "Subtype" => "Image", "Filter" => "DCTDecode" },
                data.to_vec(),
            ));
            let page = *doc.get_pages().values().next().unwrap();
            doc.get_object_mut(page)
                .unwrap()
                .as_dict_mut()
                .unwrap()
                .set(
                    "Resources",
                    dictionary! { "XObject" => dictionary! { "Im1" => image } },
                );
            let mut bytes = Vec::new();
            doc.save_to(&mut bytes).unwrap();
            bytes
        };
        // Not decodable as JPEG; only the encoded bytes can be compared.
        let original = with_image(b"\xff\xd8 not really a jpeg");
        verify_preservation(&original, &original).unwrap();
        let error =
            verify_preservation(&original, &with_image(b"\xff\xd8 another image")).unwrap_err();
        assert_eq!(
            error,
            "Saving blocked: unrelated PDF content or metadata changed at \
             Root/Pages/Kids[0]/Resources/XObject/Im1(stream data)"
        );
        let mut doc = lopdf::Document::load_mem(&original).unwrap();
        doc.objects
            .values_mut()
            .filter_map(|object| object.as_stream_mut().ok())
            .find(|stream| stream.dict.has(b"Filter"))
            .unwrap()
            .dict
            .set("Filter", Object::Name(b"JPXDecode".to_vec()));
        let mut recoded = Vec::new();
        doc.save_to(&mut recoded).unwrap();
        assert!(verify_preservation(&original, &recoded)
            .unwrap_err()
            .ends_with("/Im1/Filter"));
    }

    #[test]
    fn unverified_squiggly_markup_keeps_the_document_editable_and_survives_saves_unchanged() {
        use lopdf::{dictionary, Object};
        for subtype in ["Squiggly"] {
            let mut doc = lopdf::Document::load_mem(&pdf()).unwrap();
            let markup = doc.add_object(dictionary! {
                "Subtype" => subtype,
                "Rect" => vec![72.into(), 650.into(), 260.into(), 685.into()],
                "QuadPoints" => vec![72.into(), 685.into(), 260.into(), 685.into(), 72.into(), 650.into(), 260.into(), 650.into()],
            });
            let page = *doc.get_pages().values().next().unwrap();
            let save = |doc: &mut lopdf::Document, annots: Vec<Object>| {
                doc.get_object_mut(page)
                    .unwrap()
                    .as_dict_mut()
                    .unwrap()
                    .set("Annots", annots);
                let mut bytes = Vec::new();
                doc.save_to(&mut bytes).unwrap();
                bytes
            };
            let original = save(&mut doc, vec![markup.into()]);
            assert_eq!(editing_status(&original), None, "{subtype}");
            let highlight = doc.add_object(dictionary! { "Subtype" => "Highlight" });
            let highlighted = save(&mut doc, vec![markup.into(), highlight.into()]);
            verify_preservation(&original, &highlighted).unwrap();
            let removed = save(&mut doc, vec![highlight.into()]);
            assert!(
                verify_preservation(&original, &removed).is_err(),
                "{subtype}"
            );
        }
    }

    #[test]
    fn native_admission_snapshots_pass_save_preservation() {
        macro_rules! admission {
            ($file:literal) => {
                include_bytes!(concat!(
                    "../tests/fixtures/text-markup-verification/admission/",
                    $file,
                    ".pdf"
                ))
                .as_slice()
            };
        }
        let acrobat_original =
            include_bytes!("../tests/fixtures/text-markup-verification/acrobat-text-markups.pdf");
        for (original, edited, deleted) in [
            (
                admission!("acrobat-edited-snapshot"),
                admission!("acrobat-roundtrip-final"),
                admission!("acrobat-monight-deleted"),
            ),
            (
                admission!("preview-edited-snapshot"),
                admission!("preview-roundtrip-final"),
                admission!("preview-monight-deleted"),
            ),
            (
                acrobat_original.as_slice(),
                admission!("acrobat-origin-edited"),
                admission!("acrobat-origin-deleted"),
            ),
            (
                admission!("preview-origin-input"),
                admission!("preview-origin-edited"),
                admission!("preview-origin-deleted"),
            ),
        ] {
            verify_preservation(original, edited).unwrap();
            verify_preservation(original, deleted).unwrap();
        }
    }

    #[test]
    fn admitted_native_text_markups_can_be_edited_and_deleted_with_their_popups() {
        use lopdf::Object;
        let original =
            include_bytes!("../tests/fixtures/text-markup-verification/acrobat-text-markups.pdf");
        let mut document = lopdf::Document::load_mem(original).unwrap();
        let mut admitted_markup_ids = std::collections::HashSet::new();
        for (id, object) in document.objects.iter_mut() {
            let Ok(annotation) = object.as_dict_mut() else {
                continue;
            };
            if matches!(
                annotation.get(b"Subtype").and_then(Object::as_name).ok(),
                Some(b"Underline" | b"StrikeOut")
            ) {
                annotation.set("Contents", Object::string_literal("Admission edit"));
                admitted_markup_ids.insert(*id);
            }
        }
        assert_eq!(admitted_markup_ids.len(), 2);
        let mut edited = Vec::new();
        document.save_to(&mut edited).unwrap();
        verify_preservation(original, &edited).unwrap();
        for page in document.get_pages().values() {
            let entries = document
                .get_dictionary(*page)
                .unwrap()
                .get(b"Annots")
                .and_then(Object::as_array)
                .cloned()
                .unwrap_or_default();
            let retained = entries
                .into_iter()
                .filter(|entry| {
                    !entry
                        .as_reference()
                        .is_ok_and(|id| admitted_markup_ids.contains(&id))
                })
                .collect::<Vec<_>>();
            document
                .get_dictionary_mut(*page)
                .unwrap()
                .set("Annots", retained);
        }
        let mut deleted = Vec::new();
        document.save_to(&mut deleted).unwrap();
        let prepared = prepare_save(&deleted).unwrap();
        verify_preservation(original, &prepared).unwrap();
        let saved = lopdf::Document::load_mem(&prepared).unwrap();
        let mut popups = 0;
        for page in saved.get_pages().values() {
            let entries = saved
                .get_dictionary(*page)
                .unwrap()
                .get(b"Annots")
                .unwrap()
                .as_array()
                .unwrap();
            for entry in entries {
                let (_, object) = saved.dereference(entry).unwrap();
                let annotation = object.as_dict().unwrap();
                let subtype = annotation.get(b"Subtype").unwrap().as_name().unwrap();
                assert!(!matches!(subtype, b"Underline" | b"StrikeOut"));
                if subtype == b"Popup" {
                    popups += 1;
                    let parent = annotation.get(b"Parent").unwrap().as_reference().unwrap();
                    assert!(entries
                        .iter()
                        .any(|item| item.as_reference().ok() == Some(parent)));
                }
            }
        }
        assert_eq!(popups, 4, "Unrelated Text/Highlight popups must survive");
        assert_eq!(prepare_save(&prepared).unwrap(), prepared);
    }

    #[test]
    fn links_are_editable_and_must_survive_saves_unchanged() {
        use lopdf::{dictionary, Object};
        let set_annots = |doc: &mut lopdf::Document, annots: Vec<Object>| {
            let page = *doc.get_pages().values().next().unwrap();
            doc.get_object_mut(page)
                .unwrap()
                .as_dict_mut()
                .unwrap()
                .set("Annots", annots);
            let mut bytes = Vec::new();
            doc.save_to(&mut bytes).unwrap();
            bytes
        };
        let mut doc = lopdf::Document::load_mem(&pdf()).unwrap();
        let link = doc.add_object(dictionary! {
            "Type" => "Annot",
            "Subtype" => "Link",
            "Rect" => vec![72.into(), 650.into(), 260.into(), 685.into()],
            "A" => dictionary! { "S" => "URI", "URI" => Object::string_literal("https://example.com") },
        });
        // Tagged PDFs also reach their links through the structure tree.
        let structure = doc.add_object(dictionary! {
            "Type" => "StructTreeRoot",
            "K" => dictionary! { "Type" => "OBJR", "Obj" => link },
        });
        let root = doc.trailer.get(b"Root").unwrap().as_reference().unwrap();
        doc.get_object_mut(root)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("StructTreeRoot", structure);
        let original = set_annots(&mut doc, vec![link.into()]);
        assert_eq!(editing_status(&original), None);

        // PDFium names existing annotations and flags generated appearances on save.
        let saved_link = doc.get_object_mut(link).unwrap().as_dict_mut().unwrap();
        saved_link.set("NM", Object::string_literal("pdfium-name"));
        saved_link.set("PDFIUM_HasGeneratedAP", true);
        let comment = doc.add_object(dictionary! { "Type" => "Annot", "Subtype" => "Text" });
        let commented = set_annots(&mut doc, vec![link.into(), comment.into()]);
        let removed = set_annots(&mut doc, vec![comment.into()]);
        doc.get_object_mut(link)
            .unwrap()
            .as_dict_mut()
            .unwrap()
            .set("A", dictionary! { "S" => "URI", "URI" => Object::string_literal("https://evil.example") });
        let rewritten = set_annots(&mut doc, vec![link.into(), comment.into()]);

        let dir = directory();
        let writer = PdfSave::default();
        let selected = writer.authorize(&dir.join("commented.pdf")).unwrap();
        writer
            .write_new(&selected.token, &commented, &original)
            .unwrap();
        for (name, damaged) in [("removed.pdf", removed), ("rewritten.pdf", rewritten)] {
            let selected = writer.authorize(&dir.join(name)).unwrap();
            assert!(writer
                .write_new(&selected.token, &damaged, &original)
                .is_err());
            assert!(!dir.join(name).exists());
        }
        std::fs::remove_dir_all(dir).unwrap();
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
    fn popup_preparation_keeps_existing_relationships_and_handles_direct_text_notes() {
        use lopdf::{dictionary, Object};
        let original = include_bytes!("../tests/fixtures/external/acrobat-supported.pdf");
        let before = lopdf::Document::load_mem(original).unwrap();
        let prepared = prepare_save(original).unwrap();
        let after = lopdf::Document::load_mem(&prepared).unwrap();
        // Keep the existing Popup dictionary and the parent's reference verbatim.
        for (id, object) in &before.objects {
            let Ok(annotation) = object.as_dict() else {
                continue;
            };
            if annotation.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Popup") {
                let mut saved = after.get_dictionary(*id).unwrap().clone();
                let mut expected = annotation.clone();
                let saved_rect = saved.remove(b"Rect").unwrap();
                let expected_rect = expected.remove(b"Rect").unwrap();
                for (a, b) in saved_rect
                    .as_array()
                    .unwrap()
                    .iter()
                    .zip(expected_rect.as_array().unwrap())
                {
                    assert!((a.as_float().unwrap() - b.as_float().unwrap()).abs() < 0.001);
                }
                assert_eq!(saved, expected);
            }
            if let Ok(popup) = annotation.get(b"Popup") {
                assert_eq!(
                    after.get_dictionary(*id).unwrap().get(b"Popup").unwrap(),
                    popup
                );
            }
        }
        let mut direct = lopdf::Document::load_mem(&pdf()).unwrap();
        let page = *direct.get_pages().values().next().unwrap();
        direct.get_dictionary_mut(page).unwrap().set(
            "Annots",
            vec![Object::Dictionary(dictionary! {
                "Subtype" => "Text", "Contents" => Object::string_literal("Direct note"),
                "Rect" => vec![72.into(), 650.into(), 96.into(), 674.into()],
            })],
        );
        let mut bytes = Vec::new();
        direct.save_to(&mut bytes).unwrap();
        let prepared = prepare_save(&bytes).unwrap();
        let document = lopdf::Document::load_mem(&prepared).unwrap();
        let entries = document
            .get_dictionary(page)
            .unwrap()
            .get(b"Annots")
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(entries.len(), 2);
        let note_id = entries[0].as_reference().unwrap();
        let popup_id = entries[1].as_reference().unwrap();
        assert_eq!(
            document
                .get_dictionary(note_id)
                .unwrap()
                .get(b"Popup")
                .unwrap()
                .as_reference()
                .unwrap(),
            popup_id
        );
        assert_eq!(
            document
                .get_dictionary(popup_id)
                .unwrap()
                .get(b"Parent")
                .unwrap()
                .as_reference()
                .unwrap(),
            note_id
        );
        assert_eq!(prepare_save(&prepared).unwrap(), prepared);
    }

    #[test]
    fn deleting_acrobat_markup_removes_its_popup_children_on_save_and_save_as() {
        let original = include_bytes!("../tests/fixtures/external/acrobat-supported.pdf");
        let deleted =
            include_bytes!("../tests/fixtures/external/exports/acrobat-reader-26-deleted.pdf");
        let assert_no_orphan_popups = |bytes: &[u8]| {
            let document = lopdf::Document::load_mem(bytes).unwrap();
            let mut popup_count = 0;
            for page in document.get_pages().values() {
                let page = document.get_dictionary(*page).unwrap();
                let Ok(annots) = page.get(b"Annots") else {
                    continue;
                };
                let (_, array) = document.dereference(annots).unwrap();
                let annots = array.as_array().unwrap();
                for entry in annots {
                    let (_, object) = document.dereference(entry).unwrap();
                    let annotation = object.as_dict().unwrap();
                    if annotation
                        .get(b"Subtype")
                        .and_then(lopdf::Object::as_name)
                        .ok()
                        == Some(b"Popup")
                    {
                        popup_count += 1;
                        let parent = annotation.get(b"Parent").unwrap().as_reference().unwrap();
                        assert!(annots.iter().any(|item| item.as_reference().ok() == Some(parent)),
                            "Retained Popup points to a removed annotation; Acrobat resurrects its comment");
                    }
                }
            }
            assert_eq!(
                popup_count, 2,
                "Both remaining Text notes need live Popups, including the original one"
            );
        };
        let prepared = prepare_save(deleted).unwrap();
        assert_no_orphan_popups(&prepared);
        assert_eq!(
            prepare_save(&prepared).unwrap(),
            prepared,
            "Preparation must be byte-idempotent"
        );
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("source.pdf");
        std::fs::write(&path, original).unwrap();
        let saves = PdfSave::default();
        let source = saves.capture_source(&path, original).unwrap();
        let destination = saves.authorize(&dir.path().join("saved-as.pdf")).unwrap();
        let (_, saved_as) = saves
            .write_destination(&destination.token, &source, deleted)
            .unwrap();
        assert_no_orphan_popups(&saved_as);
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let saved = saves.write_original(&source, deleted).unwrap();
        assert_no_orphan_popups(&saved);
        verify_preservation(original, &saved).unwrap();
        verify_preservation(original, &saved_as).unwrap();
    }

    #[test]
    fn only_demonstrably_empty_form_scaffolding_is_editable() {
        use lopdf::{dictionary, Object};

        let empty = || Object::Array(Vec::new());
        let cases = [
            (dictionary! { "Fields" => empty() }, true),
            (
                dictionary! {
                    "Fields" => empty(),
                    "DA" => Object::string_literal("/Helv 0 Tf 0 g"),
                    "DR" => dictionary! {},
                    "NeedAppearances" => false,
                },
                true,
            ),
            (dictionary! {}, false),
            (dictionary! { "Fields" => Object::Null }, false),
            (
                dictionary! { "Fields" => Object::string_literal("not an array") },
                false,
            ),
            (
                dictionary! { "Fields" => vec![Object::Dictionary(dictionary! { "FT" => "Tx" })] },
                false,
            ),
            (
                dictionary! { "Fields" => empty(), "XFA" => Object::Null },
                false,
            ),
            (dictionary! { "Fields" => empty(), "SigFlags" => 0 }, false),
            (
                dictionary! { "Fields" => empty(), "Unknown" => true },
                false,
            ),
            (dictionary! { "Fields" => empty(), "DA" => 42 }, false),
            (dictionary! { "Fields" => empty(), "DR" => empty() }, false),
            (
                dictionary! { "Fields" => empty(), "NeedAppearances" => Object::Null },
                false,
            ),
        ];
        for (form, editable) in cases {
            for indirect in [false, true] {
                let mut document = lopdf::Document::load_mem(&pdf()).unwrap();
                let form = if indirect {
                    Object::Reference(document.add_object(form.clone()))
                } else {
                    Object::Dictionary(form.clone())
                };
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
                    .set("AcroForm", form.clone());
                let mut bytes = Vec::new();
                document.save_to(&mut bytes).unwrap();
                assert_eq!(editing_status(&bytes).is_none(), editable, "{form:?}");
            }
        }

        // Empty Fields must not hide a field dictionary elsewhere in the PDF.
        let mut document = lopdf::Document::load_mem(&pdf()).unwrap();
        let fields = document.add_object(empty());
        let resources = document.add_object(dictionary! {});
        let form = document.add_object(dictionary! { "Fields" => fields, "DR" => resources });
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
            .set("AcroForm", form);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).unwrap();
        assert_eq!(editing_status(&bytes), None);
        document.add_object(
            dictionary! { "FT" => "Tx", "V" => Object::string_literal("private field") },
        );
        bytes.clear();
        document.save_to(&mut bytes).unwrap();
        assert!(editing_status(&bytes)
            .unwrap()
            .contains("PDF form preservation"));
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
        let status = std::thread::Builder::new()
            .stack_size(512 * 1024)
            .spawn(move || editing_status(&bytes))
            .unwrap()
            .join()
            .unwrap();

        assert_eq!(
            status.as_deref(),
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
    fn real_embedpdf_page_rotation_saves_with_its_annotations_unchanged() {
        let original = include_bytes!("../tests/fixtures/native-annotations/original.pdf");
        let rotated = include_bytes!("../tests/fixtures/native-annotations/rotated.pdf");
        let dir = directory();
        let source = dir.join("source.pdf");
        std::fs::write(&source, original).unwrap();
        let writer = PdfSave::default();
        let token = writer.capture_source(&source, original).unwrap();
        let reopened = writer
            .write_original(&token, &prepare_save(rotated).unwrap())
            .unwrap();
        let document = lopdf::Document::load_mem(&reopened).unwrap();
        let rotations: Vec<_> = document
            .get_pages()
            .values()
            .map(|id| {
                document
                    .get_dictionary(*id)
                    .unwrap()
                    .get(b"Rotate")
                    .map_or(0, |rotation| rotation.as_i64().unwrap())
            })
            .collect();
        assert_eq!(rotations, vec![90, 0, 0]);
        let page = document
            .get_dictionary(*document.get_pages().get(&1).unwrap())
            .unwrap();
        let (_, annots) = document.dereference(page.get(b"Annots").unwrap()).unwrap();
        let subtypes: Vec<_> = annots
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| {
                let (_, annotation) = document.dereference(entry).unwrap();
                annotation
                    .as_dict()
                    .unwrap()
                    .get(b"Subtype")
                    .unwrap()
                    .as_name()
                    .unwrap()
                    .to_vec()
            })
            .collect();
        for subtype in [b"Highlight".as_slice(), b"Text"] {
            assert!(subtypes.iter().any(|s| s == subtype));
        }
        assert_eq!(subtypes.iter().filter(|s| *s == b"Link").count(), 2);
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
        assert_eq!(
            objects
                .iter()
                .filter(|d| d.get(b"Subtype").unwrap().as_name().unwrap() == b"Link")
                .count(),
            2
        );
        let selected = writer.authorize(&dir.join("deleted.pdf")).unwrap();
        writer
            .write_new(&selected.token, deleted, annotated)
            .unwrap();
        std::fs::remove_dir_all(dir).unwrap();
    }
}
