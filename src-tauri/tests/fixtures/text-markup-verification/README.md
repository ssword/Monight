# Native text-markup verification evidence

`monight-offset-underline.pdf` is a **known failure**, not an admitted tool fixture.
It reproduces [#118](https://github.com/ssword/Monight/issues/118), found while
verifying #116 on macOS 27.0.1 / Preview 11.0 (2026-10-22).

SHA-256: `fd502f88b4fe5fc33718694495ec970d1c3719737c6cf74628a8b4a2f42f63bd`.

It was saved through the native path by an identified local Monight candidate:
base `e586d8c74b6d05a322a188d8a4813fe5c84ef4c8`, candidate patch SHA-256
`f9c98dbde64dc275c017c35f937ba2bc12c6fdb08a24c30c299e60c35a699963`, executable
SHA-256 `23d6350f86815542a6ff14e57b733a7b0aac0d9a2eacba3deee9f843b996bb3f`.
The patch temporarily exposed the tools for verification; it was subsequently
removed from source. Full provenance is in
[`docs/issue-115-page-rotation-verification.md`](../../../../docs/issue-115-page-rotation-verification.md).

The source was the existing Preview-supported external-reader fixture, copied
to disposable files. Preview rotated page 1 and created Underline/StrikeOut on
page 2. Monight edited their contents and the existing lower Text note, rotated
page 1 again, then created the two native marks on page 3 through its text
selection UI. This file was copied after the save; no PDF dictionary was
synthesized or repaired for this evidence.

On page 3, `sun third page` is 24pt text at baseline y=720. The Monight-created
Underline for `sun` has `/Rect [72 708 113 746]`, with its appearance stroke at
y=709, visibly detached below the glyphs in Preview and Poppler. The adjacent
native Strikethrough covers `third`. Neither tool is admitted by this file.

Keep this input unchanged when diagnosing the selection geometry; use new
disposable outputs for edits. The retained local candidate patch and archive
are under `artifacts/issue-115-116/2026-10-22/` on the verification Mac.

## Acrobat contents-edit appearance mismatch (#119)

Two additional known-failure snapshots reproduce
[#119](https://github.com/ssword/Monight/issues/119). Neither admits a tool.

- `acrobat-text-markups.pdf`, SHA-256
  `dc7084f81ce46e8c6e95cd46c36eed60aa07fa99f788426c497cf89ed57237ea`:
  the owner created native Underline on `moon` and Strikethrough on `lower` in
  Acrobat Reader 26.002.21901 and saved. Page rotations are `[0,0,0]`.
- `acrobat-text-markups-edited.pdf`, SHA-256
  `e593e6dde8987d6f688f44eab667219ac22120982a8bcba5bfd66ed3d60b87c8`:
  Codex edited both annotation contents in the candidate, rotated page 1 left,
  edited its existing Text note and Highlight, and created a Strikethrough on
  page 3's `third`. Saved through the native path, then reopened in Acrobat.
  Page rotations are `[270,0,0]`.

Text, decoded page contents and MediaBoxes match on all pages. Both native
text markups retain Acrobat's padded Rect and QuadPoints, but their regenerated
appearance uses a tight BBox and identity Matrix. Acrobat stretches the strokes
beyond their words. See the
[#116 verification record](../../../../docs/issue-116-text-markup-verification.md)
for exact native geometry and the native screenshot location.
