# Issue #94: Preview Text Annotation geometry and editing

Status: the geometry symptom is fixed and verified in the pinned engine. The Preview
editor symptom is **not verified**: no macOS/Preview session has run against this
change. This record does not claim Preview acceptance. The original #75 failure and its
provenance limits ([record](issue-75-preview-verification.md)) remain unchanged.

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

## Editor symptom: unresolved

Not established. The failing notes (the Preview note after Monight save and a fresh
Monight Guest note) share a PDFium-generated appearance (page-coordinate BBox with an
identity Matrix), `/NM`, and dates without a time zone. Preview's working note has none
of these. After this fix, an edited Preview note keeps Preview's own appearance stream.
That may restore its editor, but this is unverified. Notes that Monight creates still
carry PDFium's appearance, and nothing here changes them.

Single-variable diagnostic PDFs for a Preview session are in the ignored archive
`artifacts/issue-94/2026-10-20/preview-editor-diagnostics/` (see its README). Change the
creation path only after a Preview run identifies the decisive difference.

## Automated checks run (Linux, 2026-10-20)

| Check | Result |
| --- | --- |
| `node scripts/verify-embedpdf-offline.mjs --write-annotation-fixtures` | Chromium contracts passed, including `preview-11` and `acrobat-reader-26`, with no `KNOWN FAILURE`. The final WebKit scrolling step could not launch because this host lacks WebKit system libraries; it was not run. |
| `cargo test` (`src-tauri`) | 76 passed, including new `contents_edits_keep_the_external_readers_note_appearance`. The test fails against the previous exports. |
| `npm test`, `npx tsc --noEmit`, `npm run lint` | Passed (368 tests); lint reports 5 warnings in files outside this change. |

## Still required for acceptance

On macOS with Preview, using a candidate with identified revision, CI, and packaging:
Preview → Monight → Preview and Monight → Preview → Monight note edit/save/delete/reopen
cycles. Also rerun the Save/Save As and Preview interoperability checks, then record the
candidate identity, OS and reader versions, tester, and outcomes. Run the diagnostics
first to resolve the editor symptom for Monight-created notes.
