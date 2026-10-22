# Issue #115: native Page Rotation round trips

Status (2026-10-22): Preview native round trips passed; Rotate is admitted.
`PAGE_ROTATION_VERIFIED` is `true`. The owner explicitly waived Acrobat rotation
because persistent rotation requires a paid Acrobat subscription. ADR 0003 and
the reader-chrome spec record the amendment. Annotation-tool interoperability
requirements are unchanged; neither #116 tool is admitted.

## Candidate identity

The prerequisites are on `feature/preview-reader-chrome`, not the `develop`
checkout initially present on this Mac. The local verification branch is
`codex/verify-rotation-text-markups`.

| Evidence | Value |
| --- | --- |
| Base revision | `e586d8c74b6d05a322a188d8a4813fe5c84ef4c8` |
| Candidate delta | `artifacts/issue-115-116/2026-10-22/candidate.patch` |
| Delta SHA-256 | `f9c98dbde64dc275c017c35f937ba2bc12c6fdb08a24c30c299e60c35a699963` |
| Executable SHA-256 | `23d6350f86815542a6ff14e57b733a7b0aac0d9a2eacba3deee9f843b996bb3f` |
| Local archive | `artifacts/issue-115-116/2026-10-22/local-candidate.app.tar.gz` |
| Archive SHA-256 | `c65b3deb1ed9e6d781b305433bd9dedfe7ed4d4b9d29b667c6dacbf61751395e` |
| Build | `npm ci --ignore-scripts --prefer-offline`; `npm run tauri -- build --bundles app` |
| OS | macOS 27.0.1, build 26A434 |
| Runtime | Monight 0.6.0; EmbedPDF 2.15.0; Tauri 2.11.2; Node 24.19.0 |
| External reader | Preview 11.0 |
| External reader | Acrobat Reader 26.002.21901 (installed Info.plist) |

The delta temporarily exposes Rotate, Underline and Strikethrough for native
verification and allows the two text-markup subtypes through the native save
adapter. It is not evidence that the features have already passed. The executable
and archive identify the tested candidate independently of subsequent source edits.

Operator: Codex through computer use; the owner moved Monight to the built-in
MacBook display after its custom Window menu and toolbar drag region did not
provide a usable move operation. Preview windows were moved with Window > Move
to Built-in Retina Display. Only disposable fixture copies were edited.

## Observations

1. Copied `src-tauri/tests/fixtures/external/preview-supported.pdf` to
   `preview-origin.pdf`. In Preview, rotated its first page left and saved.
   Inspection confirmed rotations `[270, 0, 0]`, with the existing Highlight,
   Text notes and Links retained.
2. Opened a copy, `preview-authored.pdf`, in the candidate. The rotated text,
   Highlight and note icons were aligned. Opened the existing lower Text note
   through its Comment > Edit action and changed its contents. Rotated the first
   page left again in Monight and saved: `[180, 0, 0]`.
3. Opened a saved copy, `preview-monight-edited.pdf`, in Preview. The upside-down
   text and existing Highlight/notes remained aligned. The edited note opened its
   native popover and accepted a second edit, `Preview rotated note re-edited 115`.

The initial note edit used keyboard typing that produced the literal contents
`Pevriw erotated noe teide din oM`; that is recorded as observed, not silently
replaced with the intended text. Subsequent edits used paste or accessibility
values. Preview accepted the exact saved contents before the second edit.

The same disposable PDFs also carry the #116 text-markup checks; the evidence
inventory distinguishes each retained file by checksum and native dictionary.

## Acrobat return observations

The owner created Underline and Strikethrough in `acrobat-origin.pdf` and saved,
then reported that the context-menu Rotate was universal. Saved-file inspection
still shows `[0,0,0]`; this does not satisfy the Acrobat-authored persistent
Page Rotation direction.

The owner subsequently explicitly applied that Rotate command in the
`acrobat-origin.pdf` tab, saved again and reported `rotated and saved`.
Reinspection confirms that the file is byte-for-byte unchanged: SHA-256
`dc7084f81ce46e8c6e95cd46c36eed60aa07fa99f788426c497cf89ed57237ea`, effective
page rotations `[0,0,0]`, and no `/Rotate` in any page or its parent Pages
dictionary. This observed command changes the reader's view, not the PDF's
Page Rotation. This is a limitation of the tested Acrobat Reader workflow,
not evidence of a Monight rotation-writing failure.

Opened a copy in the candidate, edited both text-markup contents, rotated page 1
left, and edited the existing Acrobat Text note and Highlight contents through
their editors. The native save produced `[270,0,0]` and the exact contents:
`Acrobat rotated note edited in Monight 115` and
`Acrobat rotated highlight edited in Monight 115`.

Opened `acrobat-return.pdf` in Acrobat on the built-in display. The page appeared
rotated, the Highlight and note icons remained attached to their page locations,
and Acrobat's comment list displayed the exact edited contents. Native Acrobat
editing of the rotated Highlight and note has not been executed because its
custom controls reject computer-use clicks. The reverse persistent rotation
direction remains unavailable in the observed Reader workflow.

The return also exposed a separate failure in contents-edited Underline/StrikeOut
appearances, now [#119](https://github.com/ssword/Monight/issues/119), recorded in
the [#116 record](issue-116-text-markup-verification.md). This is not attributed to
rotation: their appearances were regenerated during the preceding contents edits.

| Snapshot | SHA-256 | Page rotations |
| --- | --- | --- |
| `acrobat-origin.pdf` | `dc7084f81ce46e8c6e95cd46c36eed60aa07fa99f788426c497cf89ed57237ea` | 0, 0, 0 |
| `acrobat-return-before.pdf` / `acrobat-return.pdf` | `e593e6dde8987d6f688f44eab667219ac22120982a8bcba5bfd66ed3d60b87c8` | 270, 0, 0 |

Those two snapshots retain identical decoded page contents, text and MediaBoxes.
The PDFs are retained in `src-tauri/tests/fixtures/text-markup-verification/` as
`acrobat-text-markups.pdf` and `acrobat-text-markups-edited.pdf` for #119.

## Automated checks

| Check | Result |
| --- | --- |
| `npm test -- --run src/__tests__/page-rotation.test.ts src/__tests__/embedpdf-document-surface.test.ts` | 30 passed |
| `cargo test --lib pdf_save::tests::real_embedpdf_page_rotation_saves_with_its_annotations_unchanged` | Passed |
| `npm run test:embedpdf-offline` | Passed: offline assets, Reading Session, native annotations/printing, both existing external-reader contracts, navigation, Chromium and WebKit scrolling |
| Restored production gates: Highlight button, markup toolbar, reader commands, Rotate button and shortcuts | 80 tests passed |
| Restored native text-markup preservation contract | Passed |

The offline command required execution outside the network sandbox to start its
local HTTP server. These automated checks do not substitute for native Acrobat
observations.

## Evidence

Local evidence is under `artifacts/issue-115-116/2026-10-22/`, with an inspection
script and `evidence-inventory.json` containing SHA-256, decoded page-content
hashes, text, MediaBoxes, rotations and annotation Rects/QuadPoints. The original
repository fixtures are unchanged.

Retained PDF snapshots (SHA-256, 2026-10-22):

| File | SHA-256 | Page rotations |
| --- | --- | --- |
| `preview-origin.pdf` (Preview-authored rotation and text markups) | `1ca1bf1611771ba79a1ea03d2c80c9288db966af1f725f8770d97d304bc4974a` | 270, 0, 0 |
| `monight-created-markups.pdf` (Monight rotation, note and markup edits) | `fd502f88b4fe5fc33718694495ec970d1c3719737c6cf74628a8b4a2f42f63bd` | 180, 0, 0 |
| `preview-monight-edited.pdf` (Preview re-edited note and removed Underline) | `abd2152749e470e0adbf73a5c780581c7d9029eaf9696dbc9a18e925552fb833` | 180, 0, 0 |

Independent inspection confirms identical extracted text, MediaBoxes and decoded
page-content hashes across those three snapshots. Annotation edits and page
rotation were not flattened into page content. The middle snapshot is also
retained in the repository as
`src-tauri/tests/fixtures/text-markup-verification/monight-offset-underline.pdf`
because it reproduces [#118](https://github.com/ssword/Monight/issues/118).

## Completed Preview acceptance and final candidate

The initial temporary admissions were removed and the bundle rebuilt (executable
SHA-256 `84d1fb22fbd99d15f23081e3655c78d033cccf6ee6205c0724ccfbde4f12132b`).
After the owner waived Acrobat rotation, the final candidate enabled only Rotate.
Underline and Strikethrough remain absent and preserved/locked.

| Final candidate | Value |
| --- | --- |
| Base revision | `a192768f6220fc542b0d8a9b3d1762ea6480d8c6` |
| Compiled source delta | `artifacts/issue-115-116/2026-10-22/rotation-only-candidate.patch` |
| Delta SHA-256 | `da17b72409c4cb3f28d79ee7a00df374b7ed4587aec770c421ae41b27130e339` |
| Executable SHA-256 | `45b42cab35037c7c994bc09ea063c395a11d0a85046cd15daefa42ab0eb73926` |
| Archive SHA-256 | `29ded95816fd8c1575522e22de24e2402ec2a5094cfb23d7ce2f715e6c606ee0` |
| Archive | `artifacts/issue-115-116/2026-10-22/rotation-only-candidate.app.tar.gz` |

1. In native Preview, opened a disposable copy of `preview-monight-edited.pdf`
   at rotation 180. Selected the existing Highlight and used Remove Note, then
   saved. Inspection confirmed its Contents was removed while the Highlight,
   Rect and QuadPoints remained. The exact Preview-edited Text note remained.
2. Reopened the result in the final Monight candidate on the built-in display.
   The rotated Highlight and note icons aligned. Its comment pane showed
   `Preview rotated note re-edited 115` and a blank Highlight comment.
3. Edited the existing Text note to `Preview rotation note final Monight 115`
   and Highlight to `Preview rotation highlight final Monight 115`. Rotated page 1
   left and saved; inspection confirmed `[90,0,0]` and both exact contents.
4. Opened the output in native Preview, moved its window to Built-in Retina
   Display, and visually confirmed the 90-degree page and aligned marks/icons.
   Preview's native Highlights and Notes sidebar showed both exact edited
   contents. Screenshot: `evidence/preview-rotation-final-native.png`.

The two snapshots are retained under
`src-tauri/tests/fixtures/page-rotation-verification/` with checksums and provenance
in its README. The Preview-edited input SHA-256 is
`d3d97eb2869f93fb144b6ea6b6806d7ba392a1e62197efcb7a8eb4f185970497`;
the Monight output SHA-256 is
`dc99e180ed47c78740aabb36b5d4d6c4aa660535bef59e27217522fdcc557696`.
Decoded page contents and MediaBoxes are identical. Annotation subtypes are
unchanged; Rect/QuadPoints differ only by float serialization below 0.0001pt.
No flattening occurred.

Both required Preview directions and native editing of existing Text notes and
Highlights passed. Historical Acrobat observations above remain evidence but
are not an acceptance gate under the owner's amendment.

Final candidate: `npm test` passed 621 tests in 66 files;
`npm run tauri -- build --bundles app` passed; `npm run lint` passed with five
existing `!important` warnings in the design preview. The earlier native save
test and Chromium/WebKit offline suite passed as recorded above.
