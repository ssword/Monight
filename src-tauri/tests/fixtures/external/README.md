# External-reader fixtures for issues #75, #79, and #80

Created on 2026-10-20 using Preview 11.0 on macOS 27.0.1 (26A434).
Operator: Codex through native computer control, explicitly requested by the user.
These are actual Preview saves, not programmatically generated substitutes.
They are agent-operated observations, not a human sign-off.

Monight was the installed `/Applications/Monight.app`, version 0.6.0. Its executable
SHA-256 is recorded in `manifest.json`. Its source revision and CI artifact provenance
were not established. Do not attribute these results to the historical release candidate
or use them to claim a verified candidate pass.

## Inputs for #79

`manifest.json` registers external readers in `readers` and inventories the two canonical
Preview inputs in `files`. Each inventory entry contains its SHA-256, size, metadata, outline, page text,
decoded page-content checksum, page geometry, and native Annotation values. Annotation
rectangles and QuadPoints use PDF points, with zero-based page indexes in the inventory.
Select externally authored objects by subtype, contents, and author, rather than assuming
Preview supplied a stable `/NM`. Preview's author value is retained as written by Preview.

| File | Observed Monight classification | Relevant objects |
| --- | --- | --- |
| `preview-supported.pdf` | Editable | Preview-authored Highlight and Text, original Guest Text, two original Links, and Popup objects |
| `preview-unsupported.pdf` | Read-only: `Unsupported embedded annotations; saving is blocked` | Same supported objects plus one Preview Rectangle (`/Square`) |

The 0.01-point tolerance in the registration is an intended serialization tolerance,
not permission to accept the observed 4-point shrink of the Preview note. #79 should
expose that failure rather than change the expected input geometry to the broken output.
The Acrobat inputs and their separate provenance are described below. The automated #79 contracts have
since been implemented; see [Automated contracts](#automated-contracts-79).

## Automated contracts (#79)

Two contracts iterate over `readers` in `manifest.json`, so every registered reader is
checked on each CI run:

- **Offline Chromium** (`src/embedpdf-external-readers-smoke.ts`, run by
  `npm run test:embedpdf-offline` on Linux): opens the supported fixture with the pinned
  EmbedPDF runtime; finds each `annotationSelectors` entry as exactly one native object
  with the selector's subtype, contents, and author; checks its Rect (and QuadPoints for
  markup) against the inventory within `geometryTolerancePoints`; selects it, edits its
  contents, exports, reopens, deletes it, and exports again. Other Annotations must be
  unchanged throughout.
- **Rust** (`src-tauri/src/external_reader_contract.rs`, run by `cargo test` on all three
  platforms): asserts the observed classification of both fixtures, that native Save
  accepts both exports over the supported fixture without changing its Document Content
  (pages, page text, Links, outline, and metadata), and either that native Save refuses
  the unsupported fixture with `unsupportedReason` (`read-only`) or, when it is
  `editable`, that native Save accepts its Monight export (`unsupported-edited`, which the
  Chromium contract then produces) with Document Content and the unsupported
  Annotations unchanged.

Exports are not byte-for-byte reproducible (PDFium names Annotations and stamps dates), so
CI does not compare them with the committed copies. Instead the Linux frontend job runs the
offline contracts with `--write-annotation-fixtures` and then runs the Rust contract on
that run's exports. The committed exports keep `cargo test` meaningful on every platform. They are raw
engine exports. Native Save detaches orphan Popup children of removed supported
parents (#92), then verifies Document Content again and returns the actual bytes on
disk. The shared native contract verifies every non-Popup annotation value against
the engine export and rejects retained Popups pointing to deleted supported parents;
byte equality with the unnormalized engine output is no longer the correct assertion.

`knownGeometryFailures` pins geometry that is known to be broken after a Monight stage,
instead of the input geometry. The Chromium contract prints each as `KNOWN FAILURE` and
fails when the observed geometry no longer matches, so a fix or a further change forces
the entry to be revisited. The Preview note's 24-to-20-point shrink is registered this way.

### Registering another reader

To register an Acrobat fixture, commit `acrobat-supported.pdf` and
`acrobat-unsupported.pdf` with provenance, add their inventories under `files`, and add a
`readers` entry with the same fields as `preview-11`: a unique `id`, both fixture
names, both observed classifications, `unsupportedReason` when read-only,
`annotationSelectors`, `geometryTolerancePoints`, and any `knownGeometryFailures`. Then
refresh the exports the Rust contract checks and commit them:

```bash
node scripts/verify-embedpdf-offline.mjs --write-annotation-fixtures
git status -- src-tauri/tests/fixtures/external/exports
```

No test code changes are needed.

## Acrobat provenance (#80)

Created on 2026-10-20 using Adobe Acrobat Reader 26.002.21901 on macOS 27.0.1
(26A434). Operators: Codex through native computer control and the repository owner
for mouse interactions unavailable through the computer-control interface. These are
real Acrobat saves; no PDF authoring library generated or edited their objects.

1. Copied the committed `native-annotations/annotated.pdf` to a disposable path.
   Acrobat edited its original Guest Highlight and Text contents; Monight re-edited
   both and saved. Acrobat then re-edited and deleted the original objects, in
   separate observed steps. The original Text deletion happened after the canonical
   supported snapshot; the snapshot still contains that original Text.
2. The owner created a new Highlight (`Acrobat native highlight 80`) and a new Text
   (`Acrobat native note 80`) in Acrobat and saved. Both are independent objects,
   with no `/IRT` reply relationship, authored `ssword` as written by Acrobat.
   Preserved this save as `acrobat-supported.pdf`. The highlight is on the first
   text line; the sticky note has a 24-by-24-point Rect. Ada's original note and
   both Links remain. Acrobat also wrote an empty AcroForm resource dictionary.
3. Copied that supported snapshot to a companion path. The owner added one pencil
   stroke in blank space and saved in Acrobat. Preserved those exact bytes as
   `acrobat-unsupported.pdf`; native inspection confirms one additional `/Ink`.
   An earlier experimental companion with two Ink objects is not the canonical input.
4. The newly authored supported input exposed #86 (Text geometry shrank to 20pt)
   and #87 (empty AcroForm blocked editing). The owner chose to fix both and continue.
   With the fixes, the actual runtime contract preserves the 24pt Rect within 0.01pt,
   edits and deletes both selected objects, and the Rust contract accepts the exports
   while preserving unrelated Document Content. The Ink companion remains read-only
   with `Unsupported embedded annotations cannot yet be safely preserved; this Document is read-only`.
5. The fixed local desktop build opened the supported input as editable, edited its
   new note and highlight through the comments sidebar, and saved. Native inspection
   confirmed the same note ID and unchanged 24pt Rect. Save As under Sepia, 150% zoom,
   and 90-degree viewing rotation retained original page content and geometry;
   Acrobat displayed upright, unfiltered pages and four native comments.

`acrobat-reader-26` registers the new objects as selectors. Canonical checksums,
geometry, page content, metadata, outline, and other native objects are inventoried
in `manifest.json`. The shared contracts iterate over this reader without a special
Acrobat branch. No additional creation tool is enabled.

All six final canonical pages were rendered with PDFium and visually inspected:
readable upright content, with one visible pencil stroke only in the companion.
Intermediate evidence is retained in the ignored repository-relative archive
`artifacts/issue-80/2026-10-20/`. See the
[verification record](../../../../docs/issue-80-acrobat-verification.md) for build
identity, desktop outcomes, remaining failures, and candidate acceptance limits.

## Preview provenance

1. Copied `../native-annotations/annotated.pdf` to a writable working directory. Opened
   it in Preview and selected Highlights and Notes. Preview showed Guest highlight,
   Guest comment, and Ada Lovelace comment as native objects.
2. Opened the highlight's popup and changed its contents to
   `Preview edited Monight highlight`. Tried opening/editing the original Guest note;
   the editor did not open and its text remained `Native comment`. This is a failure,
   not a completed edit.
3. Removed the Ada Lovelace note through Preview's Remove Note action.
4. Added a native Preview note containing `Preview native note 75`.
5. Selected the lower text and used Preview's annotation style controls. An intermediate
   Underline was removed. The resulting yellow Highlight spans both the first and lower
   text lines and is authored by Preview; its contents were changed using the popup to
   `Preview native highlight 75`. The final file contains no Underline annotation.
6. Saved in Preview and preserved the bytes as `preview-supported.pdf`, before any
   subsequent Monight edits. This includes Preview's rewrite/combination of the initial
   highlight; do not describe it as two independent surviving highlights.
7. Copied that file, opened the copy in Preview, added a Rectangle through Shapes,
   acknowledged the non-redaction notice, and saved as `preview-unsupported.pdf`.
8. Opened both files in installed Monight. The supported file allowed editing; the
   unsupported file displayed its explicit explanation and disabled Save and Save As.

## Supporting round-trip evidence (outside Git)

The seven intermediate PDFs below are retained under the repository-relative archive
`artifacts/issue-75/2026-10-20/`, which is ignored by Git. The same archive is synced to
the remote project. Its separate `manifest.json` includes all nine PDFs, and `rendered/`
contains visual QA images. These files document one installed-build session; #79 should
generate new exports from the canonical inputs rather than treat these outputs as goldens.

| Evidence file | Actual operations |
| --- | --- |
| `evidence/monight-resaved.pdf` | Opened the supported input in Monight; edited Preview note and highlight contents to `Monight re-edited Preview note 75` and `Monight re-edited Preview highlight 75`; deleted the original Guest comment; saved. |
| `evidence/preview-second-save.pdf` | Opened that Monight export in Preview; edited highlight to `Preview second edit highlight 75`; note text editor did not open; removed note using Remove Note; saved. |
| `evidence/saved-under-transforms.pdf` | Save As in Monight with 150% zoom, 90-degree clockwise viewing rotation, and Sepia active; Preview showed upright, unfiltered pages and native annotations. |
| `evidence/monight-created.pdf` | Opened a copy of native `original.pdf` in installed Monight; created highlight and text comment with default Guest author and contents `Monight Guest highlight 75` and `Monight Guest note 75`; saved. |
| `evidence/preview-edited-guest.pdf` | Opened those Guest objects in Preview; edited highlight to `Preview edited Guest highlight 75`; note editor did not open; deleted note; saved. |
| `evidence/monight-second-save.pdf` | Reopened the Preview-returned Guest file in Monight under a separate working path; confirmed one comment and deleted note absent; re-edited highlight to `Monight second edit Guest highlight 75`; saved. |
| `evidence/preview-deleted-all.pdf` | Opened the second Monight save in Preview; opened highlight editor, changed its contents again, then removed Highlight and saved. Only Links and residual Popup objects remain; “all” refers to visible highlight/note markup, not every `/Annot`. |

The two copies used for repeated hand-offs keep original and intermediate evidence
separate and avoid testing against an already-open stale document. All existing input
PDFs in `native-annotations/` were left unchanged.

## Failures and limits

- Preview displayed/selects/deletes Monight notes but did not open their text editor.
  The same happened to the newly created Guest note. A Preview-authored note's editor
  opened before Monight re-save and did not open after that save. Root cause is unproven.
- Native inspection also found that Monight re-save changed the Preview note's Rect
  from `[220.6667, 372.0833, 244.6667, 396.0833]` (24 by 24 points) to
  `[220.6667, 372.08331, 240.6667, 392.08331]` (20 by 20 points).
- Print button and Cmd+P on the transformed supported file produced no native print
  panel. No printed PDF exists; printed-transform verification could not be completed.
- No additional Monight creation tool was enabled. Preview's Rectangle is intentionally
  unsupported input. Preview round-trip acceptance remains failed, and #75 stays open.

The detailed verification record and ready-to-file failure reports are in
[`docs/issue-75-preview-verification.md`](../../../../docs/issue-75-preview-verification.md).
