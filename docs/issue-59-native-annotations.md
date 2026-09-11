# Issue #59: development native annotations and new-file Save As

Implementation and automated verification: Codex, 2026-09-09, macOS arm64,
EmbedPDF snippet 2.15.0 and its bundled PDFium runtime. Issue #59 remains open:
Full Preview/Acrobat interoperability and packaged desktop validation are not established.

## Try the development workflow

Run `VITE_PDF_SURFACE=embedpdf VITE_NATIVE_PDF_EDITING=1 npm run tauri:dev`.
The default reader is unchanged. Select Highlight or Comment in EmbedPDF's ready-made
annotation toolbar. Edit/delete with the native selection UI or comment panel; use
its undo/redo controls. New authors default to Guest. A separate dot on each edited
tab indicates unsaved annotations. The tab's Save As button or Cmd/Ctrl+S opens a
native destination dialog. Choose a previously nonexistent `.pdf` name.

Save As captures the originating Document, runtime generation, and edited revision.
It writes exclusively, syncs, reads back the file, verifies its bytes, and prepares
it in a second EmbedPDF surface before changing the originating tab's canonical
Document path. The live editing surface is retained after this verification so
edits made while saving are not discarded. Reading Position, Visual State, tab
order, and another active Document are retained. Only the captured revision is
acknowledged; subsequent edits remain unsaved. Duplicate save requests coalesce.
The original file is never opened for writing. A failed/cancelled operation keeps
the original live identity and unsaved work. If writing succeeded but preparation
failed/cancelled, the new copy remains on disk and is not advertised as the live
Document. A partial write can also leave a new file; retry with a fresh name.

Close and Quit are blocked while there are dirty native Documents or pending saves.
Teardown also rechecks for late edits after flushing; cancellation resumes intake.
These are development safeguards, not the later Save/Discard/Cancel experience.
Forced process termination can still lose edits: recovery drafts are a later slice.
No old Monight-only annotation storage is loaded by the EmbedPDF surface.

## Conservative safety policy

Native inspection uses lopdf 0.34 to parse actual PDF dictionaries, including indirect
annotation arrays. Encrypted, restricted, signed, malformed, form-bearing, and
unsupported-annotation PDFs remain read-only with an explanation. Filesystem
read-only sources are eligible for Save As when the PDF itself passes inspection.
Only Highlight, Text (comment), and Popup annotations are admitted in this slice.
The native writer compares the original and exported reachable PDF content graph,
resolving references and decoding streams, allowing changes only to supported page
annotation lists. Metadata, outline, page contents/resources and authored geometry
must match. Unverified content transformations block saving before file creation.

**Observed limitation:** EmbedPDF adds `/AP`, `/NM`, and `/PDFIUM_HasGeneratedAP` to
existing link annotations when loading/exporting. The initial real-runtime fixture
with links was rejected by the preservation check. Documents containing Link
annotations therefore remain read-only. This is a recorded compatibility limitation,
not permission to silently alter unsupported annotations. Other unsupported types
also block editing/saving. Built-in exports, protection, form editing, redaction,
stamps, signatures, grouping and unsupported annotation tools are disabled/locked.
Reading rotation and filters are not passed to native export.

The native writer accepts only a single-use destination authorization issued by the
main reader's native Save As dialog. Exclusive creation rejects existing files,
hardlinks, symlinks and files created after selection. There is no overwrite API.
The main-reader IPC check prevents the settings window from using save authorizations.

## Automated evidence

Final checks passed: 402 TypeScript tests in 51 files, 40 Rust tests, TypeScript
typechecking/production build, Biome lint, Rust formatting and Clippy with warnings
denied. The complete offline browser suite passed, including reading, navigation
and native annotations. The production build retains its existing large-chunk warning.

- Workspace/Reader Actions tests cover dirty tabs, native-byte reopen before identity
  changes, callbacks after reidentification, tab switching, newer edits during writing,
  cancelled dialogs/preparation, export/write/reopen failures, changed readback bytes,
  existing open destinations, and dirty-document close/teardown guards.
- Native filesystem tests cover a real write/readback, single-use/cancelled/unknown
  authorizations, raced destinations, symlinks, original preservation, protected and
  unsupported PDFs, and rejection of unrelated page rotation changes.
- `npm run test:embedpdf-offline` runs the actual pinned viewer with external requests
  blocked. Its annotation smoke creates Highlight/Text annotations, performs undo/redo,
  exports, reopens, selects, edits, deletes and re-saves, checking Guest attribution and
  native geometry. It exercises real plugin APIs; it is not evidence of all UI gestures
  or another application's interoperability.
- `src-tauri/tests/fixtures/native-annotations/{original,annotated,deleted}.pdf` are
  real runtime outputs from that smoke. The Rust test writes/reopens those exports,
  inspects native `/Highlight`, `/Text`, and `/QuadPoints`, and checks content preservation.
  Regenerate intentionally with
  `node scripts/verify-embedpdf-offline.mjs --write-annotation-fixtures`.

## Review and additional safeguards

The required Standards/Spec reviews found an individual-close timing gap and an
upstream annotation-commit failure hazard. Close now rechecks dirty state immediately
before disposal, including after presentation exit; a regression test covers a late edit.
The pinned plugin uses `allSettled` for native mutations and can acknowledge a failed
mutation. Export now opens the serialized bytes in a separate engine Document and
compares expected annotation IDs, types, pages, contents, authors, colors, opacity
and geometry before permitting any native write. Geometry uses sub-millipoint
float tolerance; hex colors are case-insensitive and opacity follows the runtime's
8-bit quantization. PDFium standardizes note icons to 20pt squares anchored at the
same lower-left PDF point (the UI uses a 24pt hit box); the smoke asserts that exact
native rectangle, while highlight quads must match their selected text rectangle.
The browser smoke injects engine create, update and delete failures and asserts export
fails while the live work and unsaved state remain, then restores the engine and retries
the same live work successfully. Because the plugin may incorrectly mark failed
mutations synced, an explicit retry reconciles the current live annotations through
the public engine API before re-verifying the exported bytes; UI and undo history
remain intact. The repeated native subtype policy was
consolidated into one constant.

### Standards review

No remaining actionable findings after the close guard and shared subtype policy fixes.

### Spec review

No remaining actionable implementation findings after the close race, false save
success and retry fixes. Full interoperability and packaged desktop acceptance remain
partial as detailed below. Final review counts: Standards 0 implementation findings;
Spec 0 implementation findings, with external acceptance gates outstanding.

## Acceptance still pending

Partial Preview inspection: Codex, 2026-09-09, macOS 26.6.2, Preview 11.0.
The actual generated `annotated.pdf` displays its yellow highlight and note icon;
double-clicking the note opens a native editable text area containing “Native comment”.
The fixture was not changed. This establishes rendering/comment recognition only.
No complete Preview or Acrobat round-trip pass is claimed. Acrobat is not installed on this host.
For **each reader in both directions**, record tester, date, OS, app version and
build: create highlight/comment, Save As, reopen, select, change contents/color,
delete, re-save; inspect geometry, contents and author as well as appearance.
Also exercise on-page text-selection highlight creation and comment-panel gestures
in the packaged Tauri app, native dialog cancellation, protected/read-only sources,
and supported desktop packages. CI and Windows/Linux packaged verification remain
separate release gates. Keep native editing development-gated until this evidence
and the subsequent save/lifecycle/recovery slices land.
