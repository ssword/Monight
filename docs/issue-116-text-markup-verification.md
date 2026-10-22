# Issue #116: native Underline and Strikethrough round trips

Status (2026-10-22): both subtypes failed native verification and remain absent.
Underline creation placement is tracked in #118; regeneration of Acrobat-authored
Underline and Strikethrough appearances is tracked in #119. Temporary admission
changes were removed from source. Neither feature is accepted for release.
Candidate identity, build, archive and source-delta checksums are in the
[#115 record](issue-115-page-rotation-verification.md#candidate-identity).

## Preview observations

- In Preview 11.0, created an Underline on `moon` and a Strikethrough on `second`
  on page 2 of disposable `preview-origin.pdf`, then saved. Native dictionaries
  are `/Underline` and `/StrikeOut`, authored by `Andrew Chen`; these were not
  synthesized or flattened.
- Opened a copy in the candidate. Both marks rendered on their words. Added
  contents `Preview underline edited in Monight 116` and
  `Preview strikeout edited in Monight 116` through their comment editors,
  saved, then opened a copy in Preview. Preview exposed both as native markups
  with the exact edited contents.
- Preview offered `Remove Underline` and `Remove Strikethrough`. Underline
  removal was saved; the Strikethrough removal attempt was interrupted by a
  user-focus change and is not counted as completed.
- In Monight, selected Underline and Strikethrough through the candidate's
  dropdown and marked `sun` and `third` on page 3. Saved native objects are
  authored by `Guest`, with `/Underline` Rect `[72,708,113,746]` and
  `/StrikeOut` Rect `[113,708,174,746]`. Retained as
  `monight-created-markups.pdf`.

## Reproduced Underline failure: #118

Native Preview inspection of page 3 of `monight-created-markups.pdf` shows the
Underline visibly detached below `sun`. The saved page content is
`BT /F1 24 Tf 72 720 Td (sun third page) Tj ET`; the Underline appearance is
`1 w 72 709 m 113 709 l S`. It is 11pt below the text baseline. Poppler renders
the same displacement. Preview's own mark on the same 24pt fixture text used
a 24pt-high quad, whereas Monight selected a 38pt-high quad.

Filed [#118](https://github.com/ssword/Monight/issues/118) with the reproduction,
geometry and candidate checksums. No claim is made that an arbitrary vertical
offset would be a correct fix across fonts or scripts. Both text-selection
paths (immediate selection markup and active-tool markup) need coverage when
the geometry is fixed.

The unchanged native failure PDF is retained at
`src-tauri/tests/fixtures/text-markup-verification/monight-offset-underline.pdf`,
SHA-256 `fd502f88b4fe5fc33718694495ec970d1c3719737c6cf74628a8b4a2f42f63bd`.
The local native screenshot is `evidence/monight-markups-preview.png`; the
independent render is `rendered/monight-created-markups.png` under the evidence
root below. This native creation failure prevents Underline admission even
though Preview-authored Underline contents survived Monight editing and reopening.

Monight-created Strikethrough renders through its selected word in native Preview.
The attempted native contents edit was interrupted by a user-focus change; later
accessibility value, colour-menu and popup attempts did not change the saved
annotation. None is counted as a successful native edit. This remains an
unexecuted matrix cell, distinct from the reproduced Acrobat failure below.

The candidate showed a Recovery Draft warning during the second creation:
`Recovery Draft source changed since inspection; reopen the Document`.
Saved bytes independently contained both new markups. This is not evidence that
Recovery Draft persistence passed; the existing #91 work remains separate.

## Acrobat observations and computer-use limits

Acrobat was moved to the MacBook display. Initial capture repeatedly failed with
ScreenCaptureKit error -3811; the owner reopened Acrobat and capture recovered.
The native menu subsequently offered `Move to 27M2N2500NF`, confirming the active
window was on the built-in display.

The PDF and Comment toolbar are visible, but coordinate actions on those controls
fail with `AXError.notImplemented`, matching the limitation in the
[#80 record](issue-80-acrobat-verification.md#computer-control-limits-and-acceptance-status).
The owner created the two marks in disposable `acrobat-origin.pdf`, saved and
reported completion. Inspection confirms native `/Underline` on `moon` and
`/StrikeOut` on `lower` in page 1's lower line, authored by `ssword`. Reader version
is 26.002.21901, read from Acrobat's installed Info.plist. Saved page rotations
remain `[0,0,0]`: the owner's report of a universal context-menu Rotate does not
establish a persistent Page Rotation.

Codex opened a copy, `acrobat-authored.pdf`, in the same candidate on the built-in
display. The blue Underline and red Strikethrough initially aligned with their
words. Added contents `Acrobat underline edited in Monight 116` and
`Acrobat strikeout edited in Monight 116` through the comment editors, saved,
rotated page 1 left, and edited the existing Highlight and Text note. Native
inspection confirmed the exact contents and rotation `[270,0,0]`. Created a new
Monight Strikethrough on page 3's `third`, then retained and opened
`acrobat-return.pdf` in Acrobat. Acrobat displayed the edited contents and the
rotated page, but the page 1 text-markup strokes extended beyond their words.

## Reproduced external appearance failure: #119

Filed [#119](https://github.com/ssword/Monight/issues/119). Both markup types keep
their Acrobat-authored padded `/Rect` and `/QuadPoints`, but a contents edit
regenerates a tight appearance `/BBox` with an identity `/Matrix`. Mapping that
appearance onto the still-padded Rect stretches the stroke. Its width, colour
precision and vertical position also change. Native Acrobat visibly reproduces
the changed geometry; it is not inferred solely from dictionary differences.

| Native object | Retained Rect | Original appearance | Regenerated appearance |
| --- | --- | --- | --- |
| Underline | `[63.7267,412.866,140.297,444.078]` | BBox equals Rect; Matrix translates by `[-63.7267,-412.866]`; x=72..132.0238, y=418.5636, width=1.734 | BBox `[72,414.6,132.024,442.344]`; identity Matrix; x=72..132.024, y=415.6, width=1 |
| StrikeOut | `[130.423,412.866,204.304,444.078]` | BBox equals Rect; Matrix translates by `[-130.423,-412.866]`; x=138.6958..196.0309, y=426.4904, width=1.734 | BBox `[138.696,414.6,196.031,442.344]`; identity Matrix; x=138.696..196.031, y=428.472, width=1 |

The Text-note appearance-preservation wrapper currently handles Text only.
The issue calls for a minimal contents-only real-engine regression and correctly
mapped appearances on genuine visual edits, without loosening preservation checks.
The evidence includes Page Rotation, but this does not establish rotation as the
cause: the contents edits regenerate appearances before the rotation.

Durable native fixtures and SHA-256:

| File under `src-tauri/tests/fixtures/text-markup-verification/` | SHA-256 |
| --- | --- |
| `acrobat-text-markups.pdf` (owner-authored input, `[0,0,0]`) | `dc7084f81ce46e8c6e95cd46c36eed60aa07fa99f788426c497cf89ed57237ea` |
| `acrobat-text-markups-edited.pdf` (candidate output, `[270,0,0]`) | `e593e6dde8987d6f688f44eab667219ac22120982a8bcba5bfd66ed3d60b87c8` |

All three pages retain identical decoded page-content bytes, extracted text and
MediaBoxes. The native screenshot is
`artifacts/issue-115-116/2026-10-22/evidence/acrobat-return-geometry.png`.

## Outstanding acceptance

- Monight-created marks: native Preview inspection/edit/delete and return to
  Monight.
- After fixing #119, repeat both Acrobat directions, including native editing
  and deletion. Appearance failure currently prevents admission before that
  matrix can be counted as passed.
- Only passing subtypes may join `VERIFIED_MARKUP_TOOLS`; native save permissions
  must agree, while unrelated unverified annotation types remain preserved/locked.

Decision: neither subtype is added to `VERIFIED_MARKUP_TOOLS` by this work.
Underline requires #118 and #119; Strikethrough requires #119. Both also require
their remaining native edit/delete/return cells after fixes.
With the candidate delta removed, the 80 Highlight/toolbar/menu/Rotate control
tests and the native external-text-markup preservation test pass. The candidate
also passed the full Chromium/WebKit EmbedPDF offline suite; automated fixture
contracts do not establish the missing native Acrobat observations.

Local evidence and the inspection script are under
`artifacts/issue-115-116/2026-10-22/`. The saved temporary candidate was quit and
the local bundle rebuilt with the restored source gates; the archive in the
#115 record retains the actual tested temporary candidate.
