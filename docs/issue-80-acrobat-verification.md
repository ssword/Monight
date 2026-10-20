# Issue #80: Acrobat interoperability verification

Observation date: 2026-10-20 (Asia/Shanghai). Operators: Codex through native computer
control, assisted by the repository owner for Acrobat's mouse-only operations.
Acrobat is available; the no-tester fallback does not apply. This record contains
actual observations, reproduced failures, and their verified fixes. Candidate identity and CI status are distinguished below.

## Environment and build identity

| Evidence | Value |
| --- | --- |
| OS | macOS 27.0.1, build 26A434 |
| External reader | Adobe Acrobat Reader 26.002.21901 |
| Initial installed Monight | 0.6.0; executable SHA-256 `1b9e65f923bcce09738d05d523fe3c4018b8e12c37948c0e13e855d91c5f4ef2`; source/CI provenance unknown |
| Source baseline | `5933b7109af46020289bc935372e7ca1c629aa11`, including completed #79 |
| Fixed local Monight | Release-profile app bundle built from that baseline plus this change; executable SHA-256 `c5eef671aa413f7044db5c4ba94015224900289ba38f4f44832143720ba946b3` |
| Native-print local candidate | Release-profile app executable SHA-256 `629b971b1028091c381770fcda9fa0d7ea7694d5f7580bdfce411d67d7f2e888`; same annotation fixes plus PDFKit printing in this PR |
| Final Popup-cleanup candidate | Executable SHA-256 `ebcb2ed694bfd4fdfe11bb78f90ca43d22f6b55e2585ddddb3452b54d4fa0939`; adds pre-write Popup preparation and retains exact-byte verification |
| Fixed bundle | `src-tauri/target/release/bundle/macos/Monight.app`; Tauri CLI 2.11.2, rustc 1.99.0, Node 24.19.0 |
| Baseline packaging | [Run 39399798091](https://github.com/ssword/Monight/actions/runs/39399798091), all three platform jobs passed at `5933b71`; does not cover these fixes |
| Candidate limit | CI artifact download remained incomplete; desktop observations use identified local/installed builds, not that artifact |

The annotation-fix revision `6455d8fa969b8d29e72690a2edcf65326f96f18e` passed
[CI 39436496813](https://github.com/ssword/Monight/actions/runs/39436496813) and all
three jobs of [candidate packaging 39436497953](https://github.com/ssword/Monight/actions/runs/39436497953).
Artifact name: `macos-6455d8f`. The desktop observations use the identified locally
built release-profile `.app` artifacts, not the downloaded universal CI artifact.
The printing revision `84010147cb81561a35c44d77e013863bc27790e3` also passed
[CI 39440133939](https://github.com/ssword/Monight/actions/runs/39440133939) and all
three jobs of [candidate packaging 39440124855](https://github.com/ssword/Monight/actions/runs/39440124855).
Its identified local candidate archive is `local-macos-8401014.app.tar.gz`, SHA-256
`fc61efb2600cf989c65ba8e73967ef9003980659d27bed34f12967617068028c`.
Final code revision: `c2d1c8d4a33f6cda7f753bdd221c137c0998d6be`.
[CI 39443065781](https://github.com/ssword/Monight/actions/runs/39443065781) passed
every macOS, Windows, Linux, browser-contract, and dependency-audit job.
Final candidate packaging: [run 39443061858](https://github.com/ssword/Monight/actions/runs/39443061858).
The exact local candidate archive is `local-macos-c2d1c8d.app.tar.gz`, SHA-256
`ffd8e6fe7b718343f6a7449f3c6a036b5886f051df8816c4d64c0c7e6619d013`.
Rebuilding from the committed revision reproduced the tested executable checksum
`ebcb2ed694bfd4fdfe11bb78f90ca43d22f6b55e2585ddddb3452b54d4fa0939`.
The archive and machine-readable candidate manifest are retained in the ignored
evidence directory. These fields identify the tested local candidate independently
of the CI universal bundle; no download or test of that universal bundle is claimed. A green packaging
job alone does not establish cross-reader behavior.

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
MediaBoxes, rotations, metadata, and outline. These historical-fixture operations establish installed-build observations.
The fresh local-candidate cycle below independently covers creation through the UI.

### Fresh Guest creation and repeated hand-offs

Created a Highlight on `moon first page` and a sticky Text note through Monight's
ready-made Annotate toolbar in the fixed local release build. Native inspection
confirmed default author `Guest` and no reply relationship:

- Highlight ID `160f9817-b19e-47a7-8fc1-8fd72558bb12`, contents
  `Monight fresh Guest highlight 80`, Rect `[72, 708, 252, 746]`.
- Text ID `af82a06e-c05b-4af3-91f6-60685f398b14`, contents
  `Monight fresh Guest note 80`, Rect `[328, 548, 352, 572]` (24pt).

Saved `evidence/monight-fresh-guest.pdf`. Acrobat showed both as native Guest
objects; the owner edited/post-saved them to `Acrobat edited fresh Guest highlight 80`
and `Acrobat edited fresh Guest note 80`. The same IDs/Rects remained, and Acrobat
wrote `ssword` as their author (`evidence/acrobat-fresh-guest-edited.pdf`).

Restarted into the local native-print candidate. Monight reopened both edits,
re-edited/post-saved to `Monight second fresh highlight 80` and
`Monight second fresh note 80` (`evidence/monight-fresh-second-save.pdf`). Opened a
separate copy in Acrobat; the owner again edited/post-saved to
`Acrobat second fresh highlight 80` and `Acrobat second fresh note 80`. Same IDs,
no `/IRT` replies (`evidence/acrobat-fresh-second-save.pdf`). The owner deleted both
and saved (`evidence/acrobat-fresh-deleted.pdf`); native inspection found only the
two Links among supported objects. Monight reopened `fresh-guest-second-save.pdf`
and displayed its empty comments state. No annotation was flattened in saved PDFs.

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
  retry retains edits. The unknown-icon Preview failure was recorded separately and later
  fixed in engine exports by #94.
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

Acrobat opened the fixed Monight Save As. The owner edited/post-saved the same
new objects to `Acrobat verified fixed highlight 80` and `Acrobat verified fixed note 80`.
Stable native IDs, no `/IRT`, and the 24pt note Rect were confirmed in
`evidence/acrobat-fixed-reedited.pdf`. The owner deleted those two objects and saved
`evidence/acrobat-fixed-deleted.pdf`. Original `comment-native` and Ada's note remained;
Monight reopened the returned file and showed exactly those two comments.

The final `acrobat-unsupported-final.pdf` was also opened in the native-print build:
Save/Save As were disabled with the registered unsupported-content reason. Cmd+P
opened a native three-page print panel; Cancel retained the read-only protection.

### Monight deletion and Popup bookkeeping (#92)

An additional desktop check initially failed: deleting both new Acrobat objects in
Monight removed their parent entries from `/Annots`, but their Popup children still
referenced the removed dictionaries. Acrobat displayed four comments despite the
vanished appearances. Native inspection limited to direct Highlight/Text entries had
missed this; the failed output is `evidence/monight-deletion-popup-failure.pdf`.
[#92](https://github.com/ssword/Monight/issues/92) records the reproduced failure.

The final fix detaches orphan Popup children only for supported Highlight/Text parents
absent from that page's annotation array. Live Popups survive; unsupported parents are
not normalized. It runs as explicit native preparation before Reader Actions' exact-byte
write check, including Recovery Draft export. Native Save also validates this at its
boundary and verifies unrelated Document Content before and after normalization. No
byte-verification or protected-document guard is weakened.

The regression first failed on the actual Acrobat fixture/engine export. It now checks
Save, Save As, preparation byte-idempotence, retained original Popup, and preservation.
The shared reader contract additionally compares all non-Popup annotation dictionaries
with the engine export and rejects Popups linked to removed supported parents.
Frontend tests verify preparation failure stops writes, mismatched reopened bytes still
fail, and unsaved state is retained.

In the final local candidate (`ebcb2ed…`), opened a fresh supported copy as
`final-monight-delete-acrobat.pdf`, deleted the new Text and Highlight through the comment
menus, and saved. The tab became clean. Saved bytes contain the two original Text notes,
their one live Popup, and both Links; no deleted parents or orphan Popup children remain
in the page array (`evidence/monight-deleted-acrobat-created.pdf`). Save As to
`final-popup-cleaned-save-as.pdf` completed and switched the tab identity. Acrobat opened
that distinct output and displayed exactly two comments: `Monight re-edited Acrobat note 80`
and Ada's `Attributed comment`. It did not list either deleted comment.

The same final candidate then printed that deleted result under Sepia, 150% zoom,
and 90-degree viewing rotation to `final-printed-after-deletion.pdf`. Acrobat and
PDFium showed upright, white pages with the two retained note icons and no deleted
highlight/note. Printing did not resurrect either comment.

## Saved and printed transforms

With Sepia active, 150% zoom, and a 90-degree clockwise viewing rotation, performed
Save As to `fixed-saved-under-transforms.pdf` in the fixed local app. Native inspection
confirmed unchanged decoded page contents, text, MediaBoxes, rotations, metadata,
and outline. Acrobat displayed upright white pages and four separate native comments.
All six final canonical fixture pages were also rendered with PDFium and inspected.

The first fixed annotation build still produced no native print dialog, recorded
as [#88](https://github.com/ssword/Monight/issues/88). The maintainer chose to fix it.
The macOS adapter now sends current prepared bytes to PDFKit in memory on the main
thread. Other platforms retain their browser print adapter. PDF permissions are
checked again by PDFKit; no temporary source copy is written to disk.

The first native print opened a dialog but omitted a Highlight with `/F 0`. The
final adapter sets the print flag on visible supported Highlight/Text objects only
in its separate in-memory document. Hidden objects remain hidden; unsupported
objects keep their existing print behavior. It never changes source flags.

With final local binary `629b971…`, Print and Cmd+P both opened native macOS panels.
Save as PDF produced upright, unfiltered pages. Cancel left the source SHA-256
unchanged and preserved its Reading Position/Visual State.

For an actual unsaved-print check, copied the canonical Acrobat supported source to
`dirty-print-source.pdf`, opened it, then appended a PDF comment externally to create
a deliberate conflict preventing autosave. Created a new lower-line Highlight in
Monight; the tab remained dirty and reported the conflict. Applied Sepia, 150% zoom,
and 90-degree viewing rotation, then Cmd+P → PDF → Save as PDF to
`final-printed-unsaved-under-transforms.pdf`. The native output has three upright
A4 pages (printer paper size, not a saved-Document geometry change), original note
icons and first-line Highlight, plus the new lower-line Highlight absent from the
source. Acrobat and PDFium both showed unfiltered white pages and the highlights.
The source checksum was unchanged; Monight still displayed `Unsaved changes` after
printing. Thus printing used current live bytes and did not acknowledge the edit.

Cleanup exposed a separate post-write Recovery Draft authorization failure on Save As
from that artificial conflict ([#91](https://github.com/ssword/Monight/issues/91)).
`unsaved-print-recovered.pdf` was written with both highlights and inspected before
closing/discarding only the disposable test session. This failure is not represented
as a successful Save As, and is separate from ordinary round-trip Save As above.

## Automated validation

- `npm test`: 367 tests in 45 files passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 75 tests passed on macOS (including two real PDFKit print-preparation tests), including final
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

Both desktop annotation directions and saved/printed transforms now have actual
observations. No additional tool was enabled. The maintainer chose to fix interoperability failures and continue, and separately approved fixing printing. Fixes for #86,
#87, #88, and #92 pass their local checks. The separate conflict/recovery report #91
is retained for follow-up. The final code CI passed; candidate packaging is linked above for its recorded
outcome. All requested Acrobat matrix cells contain actual observations and exact
local-candidate identity. This closes the interoperability evidence work through PR #89;
it does not assert that the downloaded universal CI bundle was used, resolve the
separate #91 fault-injection recovery issue, or complete the broader #66 desktop matrix.
