use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAGIC: &[u8; 8] = b"MONDRFT1";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftMetadata {
    pub document_path: String,
    pub source_version: String,
    pub edited_revision: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftInput {
    pub document_path: String,
    pub source_version: String,
    pub edited_revision: u64,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftReconciliation {
    pub previous_document_path: String,
    pub document_path: String,
    pub persisted_revision: u64,
    pub source_bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryDraftRepair {
    pub document_path: String,
    pub source_bytes: Vec<u8>,
    pub edited_revision: u64,
    pub draft_bytes: Vec<u8>,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DraftInspection {
    None {
        source_version: String,
    },
    Protected,
    Stale {
        source_version: String,
    },
    Available {
        source_version: String,
        draft: DraftMetadata,
    },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconciledSource {
    pub source_version: String,
}

#[derive(Default)]
pub struct RecoveryDrafts {
    authorized_sources: Mutex<HashMap<String, String>>,
}

fn version(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn draft_path(root: &Path, document_path: &str) -> PathBuf {
    root.join(format!(
        "{:x}.draft",
        Sha256::digest(document_path.as_bytes())
    ))
}

fn canonical_source(document_path: &str, source_bytes: &[u8]) -> Result<String, String> {
    let path = Path::new(document_path)
        .canonicalize()
        .map_err(|error| format!("Recovery Draft source is unavailable: {error}"))?;
    let current = std::fs::read(&path)
        .map_err(|error| format!("Recovery Draft source could not be read: {error}"))?;
    if current != source_bytes {
        return Err("Recovery Draft source changed while opening; reload the Document".into());
    }
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Recovery Draft source path is invalid".into())
}

fn encode(metadata: &DraftMetadata, bytes: &[u8]) -> Result<Vec<u8>, String> {
    let header = serde_json::to_vec(metadata).map_err(|error| error.to_string())?;
    let mut encoded = Vec::with_capacity(MAGIC.len() + 8 + header.len() + bytes.len());
    encoded.extend_from_slice(MAGIC);
    encoded.extend_from_slice(&(header.len() as u64).to_le_bytes());
    encoded.extend_from_slice(&header);
    encoded.extend_from_slice(bytes);
    Ok(encoded)
}

fn decode(path: &Path) -> Result<(DraftMetadata, Vec<u8>), String> {
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut magic = [0; 8];
    file.read_exact(&mut magic)
        .map_err(|error| error.to_string())?;
    if &magic != MAGIC {
        return Err("Recovery Draft format is invalid".into());
    }
    let mut length = [0; 8];
    file.read_exact(&mut length)
        .map_err(|error| error.to_string())?;
    let header_len = usize::try_from(u64::from_le_bytes(length))
        .map_err(|_| "Recovery Draft header is too large")?;
    if header_len > 1024 * 1024 {
        return Err("Recovery Draft header is too large".into());
    }
    let mut header = vec![0; header_len];
    file.read_exact(&mut header)
        .map_err(|error| error.to_string())?;
    let metadata = serde_json::from_slice(&header).map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok((metadata, bytes))
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_atomic(root: &Path, destination: &Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(root, std::fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    let mut staged = tempfile::NamedTempFile::new_in(root).map_err(|error| error.to_string())?;
    staged
        .write_all(bytes)
        .and_then(|_| staged.as_file().sync_all())
        .map_err(|error| format!("Recovery Draft write failed: {error}"))?;
    if destination.exists() {
        let staged_path = staged
            .into_temp_path()
            .keep()
            .map_err(|error| error.to_string())?;
        let previous = crate::pdf_replace::replace_preserving(&staged_path, destination)?;
        remove_if_present(&previous)?;
    } else {
        staged
            .persist_noclobber(destination)
            .map_err(|error| format!("Recovery Draft write failed: {}", error.error))?;
    }
    #[cfg(unix)]
    std::fs::File::open(root)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("Recovery Draft completion is uncertain: {error}"))?;
    Ok(())
}

impl RecoveryDrafts {
    pub fn inspect(
        &self,
        root: &Path,
        document_path: &str,
        source_bytes: &[u8],
    ) -> Result<DraftInspection, String> {
        if crate::pdf_save::editing_status(source_bytes).is_some() {
            if let Ok(mut sources) = self.authorized_sources.lock() {
                sources.remove(document_path);
            }
            return Ok(DraftInspection::Protected);
        }
        let canonical_path = canonical_source(document_path, source_bytes)?;
        let source_version = version(source_bytes);
        self.authorized_sources
            .lock()
            .map_err(|error| error.to_string())?
            .insert(canonical_path.clone(), source_version.clone());
        let path = draft_path(root, &canonical_path);
        if !path.exists() {
            return Ok(DraftInspection::None { source_version });
        }
        let (draft, bytes) = match decode(&path) {
            Ok(draft) => draft,
            Err(_) => {
                remove_if_present(&path)?;
                return Ok(DraftInspection::Stale { source_version });
            }
        };
        if draft.document_path != canonical_path
            || draft.source_version != source_version
            || draft.edited_revision == 0
            || crate::pdf_save::editing_status(&bytes).is_some()
        {
            remove_if_present(&path)?;
            return Ok(DraftInspection::Stale { source_version });
        }
        Ok(DraftInspection::Available {
            source_version,
            draft,
        })
    }

    pub fn write(&self, root: &Path, draft: RecoveryDraftInput) -> Result<(), String> {
        if draft.edited_revision == 0 {
            return Err("Recovery Draft revision must be edited".into());
        }
        let authorized = self
            .authorized_sources
            .lock()
            .map_err(|error| error.to_string())?
            .get(&draft.document_path)
            .is_some_and(|source_version| source_version == &draft.source_version);
        if !authorized {
            return Err("Recovery Draft source is not authorized".into());
        }
        if crate::pdf_save::editing_status(&draft.bytes).is_some() {
            return Err(
                "Protected or unsafe PDF content cannot be stored as a Recovery Draft".into(),
            );
        }
        let metadata = DraftMetadata {
            document_path: draft.document_path,
            source_version: draft.source_version,
            edited_revision: draft.edited_revision,
        };
        let encoded = encode(&metadata, &draft.bytes)?;
        write_atomic(root, &draft_path(root, &metadata.document_path), &encoded)
    }

    pub fn read(
        &self,
        root: &Path,
        document_path: &str,
        source_version: &str,
        edited_revision: u64,
    ) -> Result<Vec<u8>, String> {
        let authorized = self
            .authorized_sources
            .lock()
            .map_err(|error| error.to_string())?
            .get(document_path)
            .is_some_and(|value| value == source_version);
        if !authorized {
            return Err("Recovery Draft source is not authorized".into());
        }
        let (metadata, bytes) = decode(&draft_path(root, document_path))?;
        if metadata.document_path != document_path
            || metadata.source_version != source_version
            || metadata.edited_revision != edited_revision
        {
            return Err("Recovery Draft changed before it could be restored".into());
        }
        Ok(bytes)
    }

    pub fn remove(&self, root: &Path, document_path: &str) -> Result<(), String> {
        remove_if_present(&draft_path(root, document_path))
    }

    pub fn repair_after_write(
        &self,
        root: &Path,
        repair: RecoveryDraftRepair,
    ) -> Result<ReconciledSource, String> {
        if repair.edited_revision == 0 {
            return Err("Recovery Draft revision must be edited".into());
        }
        if crate::pdf_save::editing_status(&repair.source_bytes).is_some()
            || crate::pdf_save::editing_status(&repair.draft_bytes).is_some()
        {
            return Err("Protected or unsafe PDF content cannot use Recovery Drafts".into());
        }
        let document_path = canonical_source(&repair.document_path, &repair.source_bytes)?;
        let source_version = version(&repair.source_bytes);
        let metadata = DraftMetadata {
            document_path: document_path.clone(),
            source_version: source_version.clone(),
            edited_revision: repair.edited_revision,
        };
        let path = draft_path(root, &document_path);
        write_atomic(root, &path, &encode(&metadata, &repair.draft_bytes)?)?;
        if canonical_source(&repair.document_path, &repair.source_bytes).is_err() {
            remove_if_present(&path)?;
            return Err("Recovery Draft source changed during repair; reload the Document".into());
        }
        self.authorized_sources
            .lock()
            .map_err(|error| error.to_string())?
            .insert(document_path, source_version.clone());
        Ok(ReconciledSource { source_version })
    }

    pub fn reconcile(
        &self,
        root: &Path,
        reconciliation: RecoveryDraftReconciliation,
    ) -> Result<ReconciledSource, String> {
        if crate::pdf_save::editing_status(&reconciliation.source_bytes).is_some() {
            return Err("Protected or unsafe PDF content cannot use Recovery Drafts".into());
        }
        let document_path =
            canonical_source(&reconciliation.document_path, &reconciliation.source_bytes)?;
        let previous_authorization = self
            .authorized_sources
            .lock()
            .map_err(|error| error.to_string())?
            .get(&reconciliation.previous_document_path)
            .cloned()
            .ok_or("Recovery Draft source is not authorized")?;
        let previous_path = draft_path(root, &reconciliation.previous_document_path);
        let previous = if previous_path.exists() {
            let draft = decode(&previous_path)?;
            if draft.0.document_path != reconciliation.previous_document_path
                || draft.0.source_version != previous_authorization
            {
                return Err("Recovery Draft does not match its live Document".into());
            }
            Some(draft)
        } else {
            None
        };
        let destination_path = draft_path(root, &document_path);
        if destination_path != previous_path {
            remove_if_present(&destination_path)?;
        }
        let source_version = version(&reconciliation.source_bytes);
        match previous {
            Some((mut metadata, bytes))
                if metadata.edited_revision > reconciliation.persisted_revision =>
            {
                metadata.document_path = document_path.clone();
                metadata.source_version = source_version.clone();
                write_atomic(root, &destination_path, &encode(&metadata, &bytes)?)?;
                if destination_path != previous_path {
                    remove_if_present(&previous_path)?;
                }
            }
            _ => remove_if_present(&previous_path)?,
        }
        let mut sources = self
            .authorized_sources
            .lock()
            .map_err(|error| error.to_string())?;
        if document_path != reconciliation.previous_document_path {
            sources.remove(&reconciliation.previous_document_path);
        }
        sources.insert(document_path, source_version.clone());
        Ok(ReconciledSource { source_version })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pdf() -> Vec<u8> {
        use lopdf::{dictionary, Document, Object, Stream};
        let mut document = Document::with_version("1.7");
        let pages = document.new_object_id();
        let content = document.add_object(Stream::new(dictionary! {}, b"BT ET".to_vec()));
        let page = document.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages,
            "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
            "Contents" => content,
        });
        document.objects.insert(
            pages,
            Object::Dictionary(
                dictionary! { "Type" => "Pages", "Kids" => vec![page.into()], "Count" => 1 },
            ),
        );
        let root = document.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages });
        document.trailer.set("Root", root);
        let mut bytes = Vec::new();
        document.save_to(&mut bytes).unwrap();
        bytes
    }

    fn source_fixture(directory: &Path, name: &str) -> (PathBuf, Vec<u8>) {
        let bytes = pdf();
        let path = directory.join(name);
        std::fs::write(&path, &bytes).unwrap();
        (path.canonicalize().unwrap(), bytes)
    }

    fn changed_pdf(mut bytes: Vec<u8>) -> Vec<u8> {
        bytes.extend_from_slice(b"\n% externally changed\n");
        bytes
    }

    #[test]
    fn draft_survives_restart_and_requires_the_same_source_version() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("drafts");
        let (source, bytes) = source_fixture(directory.path(), "source.pdf");
        let path = source.to_string_lossy().to_string();
        let first_run = RecoveryDrafts::default();
        let source_version = match first_run.inspect(&root, &path, &bytes).unwrap() {
            DraftInspection::None { source_version } => source_version,
            result => panic!("unexpected inspection: {result:?}"),
        };
        first_run
            .write(
                &root,
                RecoveryDraftInput {
                    document_path: path.clone(),
                    source_version: source_version.clone(),
                    edited_revision: 4,
                    bytes: bytes.clone(),
                },
            )
            .unwrap();

        let restarted = RecoveryDrafts::default();
        let draft = match restarted.inspect(&root, &path, &bytes).unwrap() {
            DraftInspection::Available { draft, .. } => draft,
            result => panic!("unexpected inspection: {result:?}"),
        };
        assert_eq!(draft.edited_revision, 4);
        assert_eq!(
            restarted
                .read(&root, &path, &source_version, draft.edited_revision)
                .unwrap(),
            bytes
        );

        let (unrelated, unrelated_bytes) = source_fixture(directory.path(), "unrelated.pdf");
        assert!(matches!(
            restarted
                .inspect(&root, &unrelated.to_string_lossy(), &unrelated_bytes)
                .unwrap(),
            DraftInspection::None { .. }
        ));

        let changed = changed_pdf(bytes);
        std::fs::write(&source, &changed).unwrap();
        assert!(matches!(
            RecoveryDrafts::default()
                .inspect(&root, &path, &changed)
                .unwrap(),
            DraftInspection::Stale { .. }
        ));
        assert!(!draft_path(&root, &path).exists());
    }

    #[test]
    fn reconciliation_keeps_only_newer_edits_and_rebases_save_as_identity() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("drafts");
        let (source, bytes) = source_fixture(directory.path(), "source.pdf");
        let path = source.to_string_lossy().to_string();
        let drafts = RecoveryDrafts::default();
        let source_version = match drafts.inspect(&root, &path, &bytes).unwrap() {
            DraftInspection::None { source_version } => source_version,
            result => panic!("unexpected inspection: {result:?}"),
        };
        drafts
            .write(
                &root,
                RecoveryDraftInput {
                    document_path: path.clone(),
                    source_version,
                    edited_revision: 5,
                    bytes: bytes.clone(),
                },
            )
            .unwrap();
        let destination = directory.path().join("copy.pdf");
        let saved = changed_pdf(bytes.clone());
        std::fs::write(&destination, &saved).unwrap();
        let destination = destination
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .to_string();

        let reconciled = drafts
            .reconcile(
                &root,
                RecoveryDraftReconciliation {
                    previous_document_path: path.clone(),
                    document_path: destination.clone(),
                    persisted_revision: 4,
                    source_bytes: saved.clone(),
                },
            )
            .unwrap();

        assert!(!draft_path(&root, &path).exists());
        assert!(matches!(
            drafts.inspect(&root, &destination, &saved).unwrap(),
            DraftInspection::Available { draft, .. }
                if draft.edited_revision == 5 && draft.document_path == destination
        ));
        assert_eq!(reconciled.source_version, version(&saved));

        drafts
            .reconcile(
                &root,
                RecoveryDraftReconciliation {
                    previous_document_path: destination.clone(),
                    document_path: destination.clone(),
                    persisted_revision: 5,
                    source_bytes: saved,
                },
            )
            .unwrap();
        assert!(!draft_path(&root, &destination).exists());
    }

    #[test]
    fn post_write_repair_replaces_a_stale_draft_and_authorizes_future_captures() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("drafts");
        let (source, original) = source_fixture(directory.path(), "source.pdf");
        let path = source.to_string_lossy().to_string();
        let drafts = RecoveryDrafts::default();
        let old_version = match drafts.inspect(&root, &path, &original).unwrap() {
            DraftInspection::None { source_version } => source_version,
            result => panic!("unexpected inspection: {result:?}"),
        };
        drafts
            .write(
                &root,
                RecoveryDraftInput {
                    document_path: path.clone(),
                    source_version: old_version,
                    edited_revision: 1,
                    bytes: original.clone(),
                },
            )
            .unwrap();

        let written = changed_pdf(original.clone());
        std::fs::write(&source, &written).unwrap();
        let repaired = drafts
            .repair_after_write(
                &root,
                RecoveryDraftRepair {
                    document_path: path.clone(),
                    source_bytes: written.clone(),
                    edited_revision: 2,
                    draft_bytes: original.clone(),
                },
            )
            .unwrap();

        assert_eq!(repaired.source_version, version(&written));
        assert!(matches!(
            drafts.inspect(&root, &path, &written).unwrap(),
            DraftInspection::Available { draft, .. } if draft.edited_revision == 2
        ));
        drafts
            .write(
                &root,
                RecoveryDraftInput {
                    document_path: path,
                    source_version: repaired.source_version,
                    edited_revision: 3,
                    bytes: original,
                },
            )
            .unwrap();
    }

    #[test]
    fn uninspected_or_protected_documents_cannot_write_drafts() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("drafts");
        let (source, bytes) = source_fixture(directory.path(), "source.pdf");
        let path = source.to_string_lossy().to_string();

        assert!(RecoveryDrafts::default()
            .write(
                &root,
                RecoveryDraftInput {
                    document_path: path,
                    source_version: version(&bytes),
                    edited_revision: 1,
                    bytes,
                },
            )
            .unwrap_err()
            .contains("not authorized"));
        assert!(!root.exists());

        let mut protected = lopdf::Document::load_mem(&pdf()).unwrap();
        protected.trailer.set(
            "Encrypt",
            lopdf::dictionary! { "Filter" => "Standard", "V" => 1, "R" => 2, "P" => -64 },
        );
        let mut protected_bytes = Vec::new();
        protected.save_to(&mut protected_bytes).unwrap();
        std::fs::write(&source, &protected_bytes).unwrap();
        assert_eq!(
            RecoveryDrafts::default()
                .inspect(&root, &source.to_string_lossy(), &protected_bytes)
                .unwrap(),
            DraftInspection::Protected
        );
        assert!(!root.exists());
    }

    #[test]
    fn inspection_serializes_with_the_frontend_contract_names() {
        let value = serde_json::to_value(DraftInspection::Available {
            source_version: "source-v1".into(),
            draft: DraftMetadata {
                document_path: "/docs/report.pdf".into(),
                source_version: "source-v1".into(),
                edited_revision: 3,
            },
        })
        .unwrap();

        assert_eq!(value["status"], "available");
        assert_eq!(value["sourceVersion"], "source-v1");
        assert_eq!(value["draft"]["documentPath"], "/docs/report.pdf");
        assert_eq!(value["draft"]["editedRevision"], 3);
    }
}
