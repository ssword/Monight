# Issue #94: Preview Text Annotation geometry and editing

Status (2026-10-21): both the geometry and Preview Text editor symptoms pass the
native round trips below on the identified local release candidate. The original #75
failure and its provenance limits ([record](issue-75-preview-verification.md)) remain
unchanged. This verifies #94 on macOS/Preview; it does not establish acceptance of the
entire migration or Windows/Linux native execution.

## Root cause: geometry (reproduced on Linux with the pinned engine)

Reproduced with `@embedpdf/snippet` 2.15.0 in headless Chromium, opening
`src-tauri/tests/fixtures/external/preview-supported.pdf`:

- Preview writes its note without `/Name`. The engine reads that as
  `PdfAnnotationName.Unknown`, and every note update writes that name back through
  `EPDFAnnot_SetName`. For `Unknown`, that call deletes the note's `/AP` stream. Probing
  each setter individually, `SetName(Unknown)` was the only one that removed the
  stream; color, opacity, flags, author, contents, and `SetName(Comment)` kept it.
- With the stream gone, PDFium generates its own icon on reload. That sets a 20pt Rect
  and writes a non-standard `/PDFIUM_HasGeneratedAP` key. This happens even with
  `regenerateAppearance: false`, so the #86 Rect restoration could not fix this note.
- Separately, the annotation plugin commits every contents edit as an update with
  appearance regeneration. That replaced every external note's own appearance with
  PDFium's, Acrobat's included.

## Fix

`src/app/embedpdf-native-annotation-editing.ts` wraps the engine's
`updatePageAnnotation` for Text notes:

- An absent or unrecognized `/Name` is written as `/Note`, the icon such a note displays
  (ISO 32000-1, 12.5.6.4). This avoids the deleting `SetName(Unknown)` call. The written
  dictionary now has `/Name /Note`, which Preview's input did not have.
- The note's appearance is regenerated only when its Rect, color, opacity, or icon
  changes from the current native object. A contents or author edit keeps the reader's
  own appearance stream and Rect. Moves keep the plugin's no-regeneration option, and
  the #86 Rect restoration still runs after any regeneration.

The Unknown-icon exception in the export verification is removed, and so is the
`preview-11` `knownGeometryFailures` entry. The contract now checks the original
input geometry at the existing 0.01pt tolerance.

Fresh engine export of the Preview note
(`src-tauri/tests/fixtures/external/exports/preview-11-edited.pdf`): Rect
`[220.6667, 372.08331, 244.6667, 396.08331]` (24pt), with Preview's original appearance
stream (BBox `[0 0 24 24]`) unchanged. The Acrobat note now also keeps Acrobat's own
`/N` and `/R` streams. Before this change both were replaced by PDFium's icon.

## Editor symptom: linked native Popups

On macOS 27.0.1 / Preview 11.0, retaining the appearance alone did not restore the
editor. Neither removing `/NM`, restoring the date's time zone, removing `/Name`, nor
removing `/AP` alone made the lower Text note open. A disposable fresh Preview-created
note also stopped opening its editor after save/close/reopen without a Popup.

Adding a native `/Popup` reference to the Text note and a `/Popup` annotation with a
reciprocal `/Parent` reference in the same page's `/Annots` restored the editor. The
same note then survived Preview edit/save/close/reopen. This is an observed reader
compatibility requirement, not a claim that PDF requires Popups for every Text note.
The isolated diagnostic files are retained under
`artifacts/issue-94/2026-10-21/diagnostics/`; those diagnostic variants were synthesized
with pypdf and are not externally authored fixtures.

`pdf_save::prepare_supported_popups` now adds a closed native Popup only to Text notes
that lack one. It preserves existing live Popup dictionaries/references, note IDs,
authors, contents, Rects and appearance streams. Direct Text dictionaries receive an
indirect reference so `/Parent` can refer to them. The existing orphan-Popup cleanup
still removes children of deleted supported annotations. Preparation is byte-idempotent,
runs before the frontend's exact-byte write verification (including Recovery Drafts),
and is checked again at the native Save/Save As boundary. Protected/unsupported PDF
checks and unrelated-content verification remain in force. No tool was disabled,
no note was flattened, and the geometry tolerance remains 0.01 points.

## Automated checks run (Linux, 2026-10-20)

| Check | Result |
| --- | --- |
| `node scripts/verify-embedpdf-offline.mjs --write-annotation-fixtures` | Chromium contracts passed, including `preview-11` and `acrobat-reader-26`, with no `KNOWN FAILURE`. The final WebKit scrolling step could not launch because this host lacks WebKit system libraries; it was not run. |
| `cargo test` (`src-tauri`) | 76 passed, including new `contents_edits_keep_the_external_readers_note_appearance`. The test fails against the previous exports. |
| `npm test`, `npx tsc --noEmit`, `npm run lint` | Passed (368 tests); lint reports 5 warnings in files outside this change. |

## Native candidate and verification (2026-10-21)

Operator: Codex through native computer control, explicitly requested by the owner.
The owner manually confirmed the initial lower-note failure, moved Monight to the
MacBook screen when its custom menu lacked a move command, and restarted Preview
after the interrupted attempt described below. Counted edit/save/delete operations
were performed by Codex on disposable copies on the built-in display.

| Evidence | Value |
| --- | --- |
| OS | macOS 27.0.1, build 26A434 |
| Reader | Preview 11.0 |
| Monight | 0.6.0, EmbedPDF 2.15.0, Tauri 2.11.2 |
| Tested code revision | `934b7cb8cdff4a9d991923cc1afdc2721315d8ef` |
| Local build | `npm run tauri -- build --bundles app`; Node 24.19.0, rustc 1.99.0 |
| Executable | `src-tauri/target/release/bundle/macos/Monight.app/Contents/MacOS/monight` |
| Executable SHA-256 | `93785170c3360ef22fd0a0955afdf93f7a814097d142c5eb8a15618403c04da7` |
| Local archive | `artifacts/issue-94/2026-10-21/local-macos-934b7cb.app.tar.gz` |
| Archive SHA-256 | `b3bc811ac9cc52c0269384fb9e23280bee855a242cc2476fc5e567a075af4fb2` |
| CI | [39529663774](https://github.com/ssword/Monight/actions/runs/39529663774), all jobs passed |
| Candidate packaging | [39529661391](https://github.com/ssword/Monight/actions/runs/39529661391), macOS/Windows/Linux passed |

Desktop tests used the identified local `.app`, not a downloaded universal CI bundle.
The initial code revision `1dfdd20` passed application checks/packaging but failed the
npm audit on the existing Vite 7.3.6 lockfile. Revision `934b7cb` updates that dev
dependency to 7.3.7 ([advisory](https://github.com/advisories/GHSA-698v-4r3x-3vcv));
`npm audit --audit-level=high` now passes. Rebuilding reproduced the same executable
checksum. Documentation-only follow-ups do not change the tested code.

All following evidence paths are relative to `artifacts/issue-94/2026-10-21/evidence/`.

| Direction / operation | Native observations and evidence |
| --- | --- |
| Preview → Monight → Preview, first pass | Opened a copy of `preview-supported.pdf`. Monight comment menu → Edit → `Monight edited Preview note 94 first`; Save became clean. Preview double-click opened the Text editor, then saved `Preview returned note 94 first`. Snapshots: `preview-origin-monight-first.pdf`, `preview-origin-preview-first.pdf`; screenshot `preview-origin-editor.png`. |
| Same Preview note, second pass | Monight reopened the returned text, edited/saved `Monight edited Preview note 94 second`. Preview reopened its editor and saved `Preview returned note 94 second`. Snapshots: `preview-origin-monight-second.pdf`, `preview-origin-preview-second.pdf`. ID `3be3c5f7-1aef-4152-abbb-47a8f47d3b6d` remained stable after its first engine load; original author Andrew Chen retained; no `/IRT` reply. |
| Preview deletion and return | Preview → Remove Note → Save removed that Text and its Popup. Monight reopened the result and listed exactly the retained Guest note and Preview Highlight. `preview-origin-preview-deleted.pdf` retains one Text and no orphan Popup. |
| Fresh Monight Guest creation | In a copy of `native-annotations/original.pdf`, used Annotate → Comment, placed the note and posted `Monight fresh Guest note 94 first`, then Save. `guest-monight-first.pdf` records author Guest, native Text ID `8d946a8f-fb12-4199-b4f6-e441f4b48b03`, Rect `[373, 558, 397, 582]` (24pt). |
| Save As under viewing transforms | With Sepia, 150% zoom and clockwise 90° viewing rotation, Save As created `monight-guest-save-as.pdf` and switched the active Document path. Original `monight-created.pdf` retained the first contents. Preview showed upright white pages and opened the Guest note editor. Screenshot: `guest-preview-editor.png`. |
| Monight → Preview → Monight, repeated | Preview edited/saved `Preview edited fresh Guest note 94 first`; Monight reopened and edited/saved `Monight fresh Guest note 94 second`; Preview reopened its editor and edited/saved `Preview edited fresh Guest note 94 second`; Monight reopened that exact text. Snapshots: `guest-preview-first.pdf`, `guest-monight-second.pdf`, `guest-preview-second.pdf`. Same ID, author Guest and 24pt Rect throughout; no `/IRT`. |
| Monight deletion and Preview reopen | Deleted the returned Guest note through Monight's comment menu and saved. Monight showed empty comments. Preview reopened the result with no note in Highlights and Notes. `guest-monight-deleted.pdf` contains only the two original Links; no Text/Popup remains. Screenshot: `guest-deleted-preview.png`. |
| Unsupported Preview content | Opened a disposable `preview-unsupported.pdf`. Monight reported `Unsupported embedded annotations; saving is blocked`, with Save and Save As disabled. SHA-256 remains identical to the original fixture. Screenshot: `preview-unsupported-monight.png`. |

Native inspection confirms the Preview note keeps Rect
`[220.6667, 372.0833, 244.6667, 396.0833]` (the second engine save serializes the y
coordinates as `372.08331` / `396.08331`, within 0.01pt). The newly created Guest note
keeps its intentional 24pt Rect. Both kinds remain Text annotations rather than page
content. Existing note appearances survive Monight contents edits.

`inspect-evidence.py` and `evidence-inventory.json` in the ignored archive record every
PDF checksum and assert stable IDs, authors, no reply substitution, 0.01pt geometry,
reciprocal Popup relationships, deletion and absence of orphan Popups. For each
Monight stage, decoded page-content hashes, extracted text, page boxes/rotation,
Links, outline and document metadata equal its immediate input. Original Save As
source and unsupported input are retained. Five representative first pages were
rendered with PDFium and visually inspected; the saved pages remain upright,
unfiltered and legible, with the intended annotations/deletions.

One early scripted Preview save stopped responding. A read-only stack sample showed
its main thread waiting in macOS `NSDocument` save serialization; causation was not
established. It is retained as `preview-hang-sample.txt`, not counted as a pass.
After the owner restarted Preview, the same candidate/PDF passed both full repeated
cycles using separate, verified editor-commit and Save steps. No speculative PDF
normalization was added in response to that interruption.

## Final automated checks

- `cargo test --offline --manifest-path src-tauri/Cargo.toml`: **80 passed** on macOS,
  including regressions for missing Popup links, existing Popup preservation, direct
  Text dictionaries, byte-idempotence and orphan cleanup on Save/Save As. The new
  missing-Popup regression failed before the implementation.
- `npm test`: **368 passed**; `npm run build` and `npm run lint` pass (five existing
  warnings in `design/`).
- `node scripts/verify-embedpdf-offline.mjs`: all contracts pass, including Preview and
  Acrobat geometry with no known failure, protected/annotated printing, and Chromium
  **and WebKit** scrolling.
- `npm audit --audit-level=high`, Rust formatting and `git diff --check`: pass.
- CI and all three candidate packaging jobs pass for the exact tested code revision.
