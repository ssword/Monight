//! External-reader-to-Monight contract (#79). Every reader registered in
//! `tests/fixtures/external/manifest.json` is checked against the classification and
//! preservation outcomes its tester observed, so an lopdf upgrade cannot silently change them.

use crate::pdf_save::{editing_status, PdfSave};
use crate::test_support::fixture_path;
use serde_json::Value;

fn manifest() -> Value {
    let path = fixture_path("external/manifest.json");
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

fn readers() -> Vec<Value> {
    manifest()["readers"].as_array().unwrap().clone()
}

fn fixture(name: &str) -> Vec<u8> {
    std::fs::read(fixture_path(&format!("external/{name}"))).unwrap()
}

fn required_str(reader: &Value, key: &str) -> String {
    reader[key]
        .as_str()
        .unwrap_or_else(|| panic!("reader {} has no {key}", reader["id"]))
        .to_owned()
}

/// The Monight classification a tester observed for a registered fixture.
#[derive(Debug, PartialEq)]
enum Classification {
    Editable,
    ReadOnly { reason: String },
}

fn observed(reader: &Value, key: &str) -> Classification {
    match required_str(reader, key).as_str() {
        "editable" => Classification::Editable,
        "read-only" => Classification::ReadOnly {
            reason: required_str(reader, "unsupportedReason"),
        },
        other => panic!("reader {}: unknown classification {other}", reader["id"]),
    }
}

#[test]
fn registry_lists_at_least_one_external_reader() {
    assert!(!readers().is_empty());
}

#[test]
fn safety_inspection_matches_observed_classification() {
    for reader in readers() {
        let id = required_str(&reader, "id");
        for (fixture_key, observed_key) in [
            ("supportedFixture", "supportedObservedClassification"),
            ("unsupportedFixture", "unsupportedObservedClassification"),
        ] {
            let status = editing_status(&fixture(&required_str(&reader, fixture_key)));
            let expected = match observed(&reader, observed_key) {
                Classification::Editable => None,
                Classification::ReadOnly { reason } => Some(reason),
            };
            assert_eq!(status, expected, "{id} {fixture_key}");
        }
    }
}

/// The Document Content that no Annotation edit may change.
#[derive(Debug, PartialEq)]
struct DocumentContent {
    pages: Vec<PageContent>,
    links: Vec<String>,
    outline: Vec<String>,
    metadata: String,
}

#[derive(Debug, PartialEq)]
struct PageContent {
    media_box: String,
    rotation: String,
    content: Vec<u8>,
    text: String,
}

/// Formats `object` independently of dictionary key order and object numbering, naming
/// page references by page number.
fn canonical(
    document: &lopdf::Document,
    pages: &[lopdf::ObjectId],
    object: &lopdf::Object,
) -> String {
    use lopdf::Object;
    match object {
        Object::Reference(id) => match pages.iter().position(|page| page == id) {
            Some(index) => format!("page {}", index + 1),
            None => canonical(document, pages, document.get_object(*id).unwrap()),
        },
        Object::Dictionary(dictionary) => {
            let mut entries: Vec<_> = dictionary
                .iter()
                .map(|(key, value)| {
                    format!(
                        "/{} {}",
                        String::from_utf8_lossy(key),
                        canonical(document, pages, value)
                    )
                })
                .collect();
            entries.sort();
            format!("<<{}>>", entries.join(" "))
        }
        Object::Array(items) => format!(
            "[{}]",
            items
                .iter()
                .map(|item| canonical(document, pages, item))
                .collect::<Vec<_>>()
                .join(" ")
        ),
        Object::Integer(value) => value.to_string(),
        Object::Real(value) => value.to_string(),
        other => format!("{other:?}"),
    }
}

fn document_content(bytes: &[u8]) -> DocumentContent {
    use lopdf::Object;
    let document = lopdf::Document::load_mem(bytes).unwrap();
    let page_ids: Vec<_> = document.get_pages().into_values().collect();
    let field = |dictionary: &lopdf::Dictionary, key: &[u8]| {
        dictionary
            .get(key)
            .map(|value| canonical(&document, &page_ids, value))
            .unwrap_or_default()
    };
    let mut pages = Vec::new();
    let mut links = Vec::new();
    for (number, id) in document.get_pages() {
        let page = document.get_dictionary(id).unwrap();
        pages.push(PageContent {
            media_box: field(page, b"MediaBox"),
            rotation: field(page, b"Rotate"),
            content: document.get_page_content(id).unwrap(),
            text: document.extract_text(&[number]).unwrap(),
        });
        for annotation in document.get_page_annotations(id).unwrap() {
            if annotation.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Link") {
                links.push(format!(
                    "page {number} {} {} {}",
                    field(annotation, b"Rect"),
                    field(annotation, b"A"),
                    field(annotation, b"Dest")
                ));
            }
        }
    }
    let mut outline = Vec::new();
    let catalog = document.catalog().unwrap();
    if let Ok(outlines) = catalog.get(b"Outlines") {
        let root = document.dereference(outlines).unwrap().1.as_dict().unwrap();
        let mut pending = vec![(0, root.get(b"First").ok().cloned())];
        while let Some((depth, item)) = pending.pop() {
            let Some(item) = item else { continue };
            let item = document.dereference(&item).unwrap().1.as_dict().unwrap();
            outline.push(format!(
                "{depth} {} {} {}",
                field(item, b"Title"),
                field(item, b"Dest"),
                field(item, b"A")
            ));
            pending.push((depth, item.get(b"Next").ok().cloned()));
            pending.push((depth + 1, item.get(b"First").ok().cloned()));
        }
    }
    let metadata = match document.trailer.get(b"Info") {
        Ok(info) => canonical(&document, &page_ids, info),
        Err(_) => String::new(),
    };
    DocumentContent {
        pages,
        links,
        outline,
        metadata,
    }
}

/// Annotations of subtypes Monight cannot author, which a save must carry through unchanged.
fn unsupported_annotations(bytes: &[u8]) -> Vec<String> {
    use lopdf::Object;
    let document = lopdf::Document::load_mem(bytes).unwrap();
    let page_ids: Vec<_> = document.get_pages().into_values().collect();
    let mut annotations = Vec::new();
    for (number, id) in document.get_pages() {
        for annotation in document.get_page_annotations(id).unwrap() {
            let subtype = annotation
                .get(b"Subtype")
                .and_then(Object::as_name)
                .unwrap();
            if ![b"Highlight".as_slice(), b"Text", b"Popup", b"Link"].contains(&subtype) {
                let mut annotation = annotation.clone();
                // Popup and parent links are renumbered on save.
                annotation.remove(b"Popup");
                annotation.remove(b"P");
                annotations.push(format!(
                    "page {number} {}",
                    canonical(&document, &page_ids, &Object::Dictionary(annotation))
                ));
            }
        }
    }
    annotations
}

/// Exports written by the Chromium contract (`--write-annotation-fixtures`).
fn export(reader: &Value, stage: &str) -> Vec<u8> {
    fixture(&format!(
        "exports/{}-{stage}.pdf",
        required_str(reader, "id")
    ))
}

/// Saves `bytes` over a copy of `source` through the native Save path.
fn save_over(source: &[u8], bytes: &[u8]) -> (Result<Vec<u8>, String>, Vec<u8>) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("external.pdf");
    std::fs::write(&path, source).unwrap();
    let writer = PdfSave::default();
    let token = writer.capture_source(&path, source).unwrap();
    let outcome = writer.write_original(&token, bytes);
    (outcome, std::fs::read(&path).unwrap())
}

/// Native Save may detach orphan Popup bookkeeping, but must retain every other
/// annotation value from the engine export and return exactly the bytes on disk.
fn assert_saved_export(exported: &[u8], saved: &[u8]) {
    fn values(bytes: &[u8]) -> Vec<String> {
        let document = lopdf::Document::load_mem(bytes).unwrap();
        let pages = document.get_pages().into_values().collect::<Vec<_>>();
        let mut values = Vec::new();
        for page in &pages {
            for annotation in document.get_page_annotations(*page).unwrap() {
                if annotation
                    .get(b"Subtype")
                    .and_then(lopdf::Object::as_name)
                    .ok()
                    == Some(b"Popup")
                {
                    continue;
                }
                let mut annotation = annotation.clone();
                annotation.remove(b"Popup");
                annotation.remove(b"P");
                values.push(canonical(
                    &document,
                    &pages,
                    &lopdf::Object::Dictionary(annotation),
                ));
            }
        }
        values
    }
    assert_eq!(
        values(saved),
        values(exported),
        "Native Save changed a non-Popup annotation"
    );
    assert_eq!(document_content(saved), document_content(exported));
    let document = lopdf::Document::load_mem(saved).unwrap();
    for page in document.get_pages().values() {
        let Ok(array) = document.get_dictionary(*page).unwrap().get(b"Annots") else {
            continue;
        };
        let (_, array) = document.dereference(array).unwrap();
        let annots = array.as_array().unwrap();
        for annotation in document.get_page_annotations(*page).unwrap() {
            if annotation
                .get(b"Subtype")
                .and_then(lopdf::Object::as_name)
                .ok()
                != Some(b"Popup")
            {
                continue;
            }
            let Ok(parent) = annotation.get(b"Parent") else {
                continue;
            };
            let (id, parent) = document.dereference(parent).unwrap();
            let subtype = parent
                .as_dict()
                .unwrap()
                .get(b"Subtype")
                .and_then(lopdf::Object::as_name)
                .unwrap();
            if subtype == b"Highlight" || subtype == b"Text" {
                assert!(
                    annots
                        .iter()
                        .any(|entry| document.dereference(entry).unwrap().0 == id),
                    "Saved Popup still references a deleted supported annotation"
                );
            }
        }
    }
}

#[test]
fn native_save_accepts_monight_exports_without_changing_document_content() {
    for reader in readers() {
        let id = required_str(&reader, "id");
        let input = fixture(&required_str(&reader, "supportedFixture"));
        for stage in ["edited", "deleted"] {
            let exported = export(&reader, stage);
            let (outcome, on_disk) = save_over(&input, &exported);
            let saved = outcome.unwrap_or_else(|error| panic!("{id} {stage}: {error}"));
            assert_eq!(on_disk, saved, "{id} {stage}");
            assert_saved_export(&exported, &saved);
            assert_eq!(
                document_content(&saved),
                document_content(&input),
                "{id} {stage}"
            );
        }
    }
}

/// The normal appearance of the one Text note with `contents` by `author`: its stream
/// dictionary geometry and decoded drawing operators.
fn note_appearance(bytes: &[u8], contents: &str, author: &str) -> (String, Vec<u8>) {
    use lopdf::{decode_text_string, Object};
    let document = lopdf::Document::load_mem(bytes).unwrap();
    let pages: Vec<_> = document.get_pages().into_values().collect();
    let notes: Vec<_> = pages
        .iter()
        .flat_map(|page| document.get_page_annotations(*page).unwrap())
        .filter(|annotation| {
            let text = |key: &[u8]| annotation.get(key).and_then(decode_text_string).ok();
            annotation.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Text")
                && text(b"Contents").as_deref() == Some(contents)
                && text(b"T").as_deref() == Some(author)
        })
        .collect();
    assert_eq!(
        notes.len(),
        1,
        "expected one note {contents:?} by {author:?}"
    );
    let appearance = notes[0].get(b"AP").unwrap();
    let appearance = document
        .dereference(appearance)
        .unwrap()
        .1
        .as_dict()
        .unwrap();
    let normal = document
        .dereference(appearance.get(b"N").unwrap())
        .unwrap()
        .1;
    let stream = normal.as_stream().unwrap();
    let field = |key: &[u8]| {
        stream
            .dict
            .get(key)
            .map(|value| canonical(&document, &pages, value))
            .unwrap_or_default()
    };
    (
        format!("BBox {} Matrix {}", field(b"BBox"), field(b"Matrix")),
        stream.get_plain_content().unwrap(),
    )
}

#[test]
fn contents_edits_keep_the_external_readers_note_appearance() {
    for reader in readers() {
        let id = required_str(&reader, "id");
        let input = fixture(&required_str(&reader, "supportedFixture"));
        let edited = export(&reader, "edited");
        for selector in reader["annotationSelectors"].as_array().unwrap() {
            if selector["subtype"] != "/Text" {
                continue;
            }
            let contents = selector["contents"].as_str().unwrap();
            let author = selector["author"].as_str().unwrap();
            // The Chromium contract's edit, in src/embedpdf-external-readers-smoke.ts.
            let edited_contents = format!("Monight edited {contents}");
            assert_eq!(
                note_appearance(&edited, &edited_contents, author),
                note_appearance(&input, contents, author),
                "{id}: editing a note's contents replaced its appearance"
            );
        }
    }
}

fn outline_entries(entries: &Value) -> usize {
    entries
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            if entry.is_array() {
                outline_entries(entry)
            } else {
                1
            }
        })
        .sum()
}

#[test]
fn document_content_covers_the_inventoried_pages_outline_links_and_metadata() {
    let manifest = manifest();
    for reader in readers() {
        let name = required_str(&reader, "supportedFixture");
        let inventory = &manifest["files"][&name];
        let content = document_content(&fixture(&name));
        assert_eq!(
            content.outline.len(),
            outline_entries(&inventory["outline"]),
            "{name}"
        );
        let links = inventory["pages"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|page| page["annotations"].as_array().unwrap())
            .filter(|annotation| annotation["Subtype"] == "/Link")
            .count();
        assert_eq!(content.links.len(), links, "{name}");
        assert_eq!(
            content.pages.len(),
            inventory["pages"].as_array().unwrap().len(),
            "{name}"
        );
        for (key, value) in inventory["metadata"].as_object().unwrap() {
            let entry = format!("{key} ({})", value.as_str().unwrap());
            assert!(content.metadata.contains(&entry), "{name} lacks {entry}");
        }
    }
}

#[test]
fn unsupported_fixture_outcome_matches_observation() {
    for reader in readers() {
        let id = required_str(&reader, "id");
        let input = fixture(&required_str(&reader, "unsupportedFixture"));
        assert!(
            !unsupported_annotations(&input).is_empty(),
            "{id}: the unsupported fixture has no unsupported Annotation"
        );
        match observed(&reader, "unsupportedObservedClassification") {
            Classification::ReadOnly { reason } => {
                let (outcome, on_disk) = save_over(&input, &input);
                assert_eq!(outcome, Err(reason), "{id}: native save must refuse it");
                assert_eq!(on_disk, input, "{id}: refused save changed the file");
            }
            Classification::Editable => {
                let exported = export(&reader, "unsupported-edited");
                let (outcome, on_disk) = save_over(&input, &exported);
                let saved = outcome.unwrap_or_else(|error| panic!("{id}: {error}"));
                assert_eq!(on_disk, saved, "{id}");
                assert_saved_export(&exported, &saved);
                assert_eq!(
                    document_content(&exported),
                    document_content(&input),
                    "{id}"
                );
                assert_eq!(
                    unsupported_annotations(&saved),
                    unsupported_annotations(&input),
                    "{id}: re-save changed the unsupported Annotation"
                );
            }
        }
    }
}
