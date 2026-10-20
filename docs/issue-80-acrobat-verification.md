# Issue #80: Acrobat interoperability verification

Observation date: 2026-10-20 (Asia/Shanghai). Operators: Codex through native computer
control, assisted by the repository owner for Acrobat's mouse-only operations.
Acrobat is available; the no-tester fallback does not apply. This record contains
actual observations and failures, not a completed release-candidate sign-off.

## Environment and build identity

| Evidence | Value |
| --- | --- |
| OS | macOS 27.0.1, build 26A434 |
| External reader | Adobe Acrobat Reader 26.002.21901 |
| Initial installed Monight | 0.6.0; executable SHA-256 `1b9e65f923bcce09738d05d523fe3c4018b8e12c37948c0e13e855d91c5f4ef2`; source/CI provenance unknown |
| Source baseline | `5933b7109af46020289bc935372e7ca1c629aa11`, including completed #79 |
| Fixed local Monight | Release-profile app bundle built from that baseline plus this change; executable SHA-256 `c5eef671aa413f7044db5c4ba94015224900289ba38f4f44832143720ba946b3` |
| Fixed bundle | `src-tauri/target/release/bundle/macos/Monight.app`; Tauri CLI 2.11.2, rustc 1.99.0, Node 24.19.0 |
| Baseline packaging | [Run 39399798091](https://github.com/ssword/Monight/actions/runs/39399798091), all three platform jobs passed at `5933b71`; does not cover these fixes |
| Candidate limit | CI artifact download remained incomplete; desktop observations use identified local/installed builds, not that artifact |

A fresh CI run and release candidate covering the fixes are still required. A green
packaging job alone does not establish cross-reader behavior.

## Monight objects through Acrobat and back

All evidence paths below are relative to the ignored archive
`artifacts/issue-80/2026-10-20/`; the canonical fixtures are committed separately.

| Evidence | Actual operation and observed native result |
| --- | --- |
| `evidence/acrobat-edited-both.pdf` | Opened a copy of Monight's committed native annotated fixture in Acrobat. Edited the original Guest Highlight and Text to `Acrobat edited Monight highlight 80` and `Acrobat edited Monight note 80`, posted and saved. Same native objects, author changed by Acrobat to `ssword`; Ada's note and Links retained. |
| `evidence/monight-first-save.pdf` | Installed Monight opened those objects, re-edited contents to `Monight re-edited Acrobat highlight 80` and `Monight re-edited Acrobat note 80`, saved. Native IDs `highlight-native` and `comment-native` retained. |
| `evidence/acrobat-second-save.pdf` | Acrobat re-edited original Highlight to `Acrobat second edit highlight 80`. The similarly named note text was accidentally added as a reply to the Highlight; it is not original Text edit evidence. |
| `evidence/acrobat-deleted.pdf` | Acrobat deleted that Highlight and its reply, saved; original Text remained. Not counted as original Text deletion. |
| `evidence/acrobat-original-note-resaved.pdf` | Owner used original Text menu → Edit, posted `Acrobat second edit original note 80`, saved. Same `/NM comment-native`, no `/IRT`: actual in-place re-edit confirmed. |
| `evidence/acrobat-original-note-deleted.pdf` | Owner deleted that same original Text and saved; `/NM comment-native` absent, Ada's note and new Acrobat objects retained. |

Native inspection confirms actual Highlight/Text dictionaries, rather than flattened
page graphics. First Acrobat save retained decoded page contents, extracted text,
MediaBoxes, rotations, metadata, and outline. These historical-fixture operations
establish installed-build observations; fresh creation in the fixed candidate UI
has not yet been executed and must not be inferred from fixture provenance.

## Acrobat-created objects through Monight

The owner newly created independent Acrobat Highlight and Text objects, containing
`Acrobat native highlight 80` and `Acrobat native note 80`. Their author is `ssword`
as written by Acrobat. The supported snapshot retains the original Text, Ada's note,
and Links; it precedes deletion of the original Text above. Its companion is the
same snapshot with one Acrobat pencil `/Ink` stroke. See the
[fixture provenance](../src-tauri/tests/fixtures/external/README.md#acrobat-provenance-80)
and [inventories](../src-tauri/tests/fixtures/external/manifest.json).

The input exposed two product failures:

- [#86](https://github.com/ssword/Monight/issues/86): PDFium regenerated the note's
  24pt Rect as 20pt. The fix restores the current live Rect through the public engine
  update API with appearance regeneration disabled, then reopens exported bytes to
  verify them. It preserves deliberate moves/resizes and rejects failed correction;
  retry retains edits. The existing unknown-icon Preview failure remains recorded.
- [#87](https://github.com/ssword/Monight/issues/87): Acrobat's empty AcroForm resource
  scaffolding caused an unnecessary form-protection block. The fix permits only an
  empty Fields array plus well-typed default resources/appearance options. Actual
  fields, XFA, signature flags, unknown keys, and malformed structures remain blocked;
  native Save still checks the entire unrelated content graph.

The maintainer explicitly chose “Fix the failures and continue testing.” No tool was
disabled or newly enabled.

The fixed local desktop build opened `native-fixed-supported.pdf` as editable.
Through the comments sidebar, edited the new note and highlight to
`Monight fixed Acrobat note 80` and `Monight fixed Acrobat highlight 80`, then saved.
The same note ID retained Rect `[258.60999, 721.30402, 282.60999, 745.30402]`, matching
input `[258.61, 721.304, 282.61, 745.304]` within 0.01pt. Author remained `ssword`.
Native safety and the shared real-engine contract classify the final Ink companion
read-only with `Unsupported embedded annotations cannot yet be safely preserved; this Document is read-only`.

Acrobat re-edit/deletion of the fixed export and its subsequent Monight reopening
are still being executed; the automated runtime did complete edit/delete/reopen on
both new objects. Automated success is not substituted for desktop mouse steps.

## Saved and printed transforms

With Sepia active, 150% zoom, and a 90-degree clockwise viewing rotation, performed
Save As to `fixed-saved-under-transforms.pdf` in the fixed local app. Native inspection
confirmed unchanged decoded page contents, text, MediaBoxes, rotations, metadata,
and outline. Acrobat displayed upright white pages and four separate native comments.
All six final canonical fixture pages were also rendered with PDFium and inspected.

Clicking Print in the fixed desktop app produced no native dialog or output. Earlier
installed-build Print and Cmd+P attempts had the same result. [#88](https://github.com/ssword/Monight/issues/88) records this failure. Desktop printed output
is unverified; the automated prepared-print-byte check passes but does not prove
native dialog integration. This is a failed desktop printing observation, not a pass.

## Automated validation

- `npm test`: 361 tests in 44 files passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 72 tests passed, including final
  Acrobat source/export preservation and strict empty-form cases.
- `npm run test:embedpdf-offline`: passed native annotation creation/export/reopen,
  deliberate note move/resize, injected geometry-correction failure and retry,
  protected/native prepared printing, Reading Session, navigation, both registered
  external readers, and Chromium/WebKit wheel scrolling.
- Fresh external exports generated by the actual pinned runtime for Rust's shared
  contract; input Acrobat geometry tolerance remains 0.01pt with no known-failure override.
- Build and lint passed (existing unrelated lint warnings remain).

## Computer-control limits and acceptance status

Acrobat's new and classic interfaces expose document menus but not annotation controls
to accessibility; coordinate clicks fail with `AXError.notImplemented`. The owner
approved classic mode and performed the mouse-only edits, posting, drawing, and deletion.
Every claimed edit/delete was independently inspected in saved bytes; replies were
not counted as edits. No private user document was modified.

Issue #80 remains open until remaining desktop cycles, printing failure disposition,
and fresh candidate/CI evidence satisfy its acceptance criteria. The issue-66 matrix
links here for each observed outcome and explicitly identifies unexecuted steps.
