use serde::Serialize;
use std::{
    collections::HashMap,
    fs::OpenOptions,
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

#[derive(Default)]
pub struct PdfSave {
    destinations: Mutex<HashMap<String, PathBuf>>,
    next: AtomicU64,
}

impl PdfSave {
    pub fn authorize(&self, path: &Path) -> Result<SaveDestination, String> {
        let title = path
            .file_name()
            .ok_or("Choose a PDF file name")?
            .to_str()
            .ok_or("Invalid file name")?
            .to_string();
        if !title.to_lowercase().ends_with(".pdf") {
            return Err("Choose a .pdf destination".into());
        }
        let parent = path
            .parent()
            .ok_or("Missing destination directory")?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let path = parent.join(&title);
        if path.symlink_metadata().is_ok() {
            return Err("Destination already exists; choose a new PDF name".into());
        }
        let token = self.next.fetch_add(1, Ordering::Relaxed).to_string();
        self.destinations
            .lock()
            .map_err(|e| e.to_string())?
            .insert(token.clone(), path.clone());
        Ok(SaveDestination {
            token,
            canonical_path: path.to_str().ok_or("Invalid destination path")?.to_string(),
            title,
        })
    }
    pub fn release(&self, token: &str) {
        if let Ok(mut destinations) = self.destinations.lock() {
            destinations.remove(token);
        }
    }
    pub fn write_new(
        &self,
        token: &str,
        bytes: &[u8],
        original: &[u8],
    ) -> Result<(PathBuf, Vec<u8>), String> {
        let path = self
            .destinations
            .lock()
            .map_err(|e| e.to_string())?
            .remove(token)
            .ok_or("Save destination was not authorized or has already been used")?;
        verify_preservation(original, bytes)?;
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("Cannot create new PDF: {e}"))?;
        // A failed write may leave an incomplete new file. Never remove by path here:
        // another process could replace it. The original is never opened for writing.
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("PDF write failed; edits retained: {e}"))?;
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut reopened = Vec::new();
        file.read_to_end(&mut reopened).map_err(|e| e.to_string())?;
        if reopened != bytes {
            return Err("Written PDF verification failed".into());
        }
        // Reopen by name too, ensuring the selected path still identifies our bytes.
        if std::fs::read(&path).map_err(|e| e.to_string())? != bytes {
            return Err("Destination changed while saving".into());
        }
        Ok((path, reopened))
    }
}

const EDITABLE_ANNOTATIONS: &[&[u8]] = &[b"Highlight", b"Text", b"Popup"];

fn load_editable(bytes: &[u8]) -> Result<lopdf::Document, String> {
    let document = lopdf::Document::load_mem(bytes)
        .map_err(|e| format!("PDF safety inspection failed: {e}"))?;
    if document.trailer.has(b"Encrypt") {
        return Err("Encrypted or permission-restricted PDFs are read-only".into());
    }
    fn inspect(object: &lopdf::Object) -> Result<(), String> {
        use lopdf::Object;
        match object {
            Object::Dictionary(dict) | Object::Stream(lopdf::Stream { dict, .. }) => {
                if dict.has(b"ByteRange")
                    || dict.get(b"Type").and_then(Object::as_name).ok() == Some(b"Sig")
                    || dict.get(b"FT").and_then(Object::as_name).ok() == Some(b"Sig")
                {
                    return Err("Digitally signed PDFs are read-only".into());
                }
                if dict.has(b"AcroForm") || dict.has(b"XFA") {
                    return Err(
                        "PDF form preservation has not been verified; this Document is read-only"
                            .into(),
                    );
                }
                if dict.get(b"Type").and_then(Object::as_name).ok() == Some(b"Annot") {
                    let subtype = dict
                        .get(b"Subtype")
                        .and_then(Object::as_name)
                        .map_err(|_| "Unknown embedded annotation; saving is blocked")?;
                    if !EDITABLE_ANNOTATIONS.contains(&subtype) {
                        return Err("Unsupported embedded annotations cannot yet be safely preserved; this Document is read-only".into());
                    }
                }
                for (_, child) in dict.iter() {
                    inspect(child)?;
                }
            }
            Object::Array(items) => {
                for child in items {
                    inspect(child)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    for object in document.objects.values() {
        inspect(object)?;
    }
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
        assert!(writer.authorize(&path).is_err());
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
        assert!(writer.authorize(&alias).is_err());
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
