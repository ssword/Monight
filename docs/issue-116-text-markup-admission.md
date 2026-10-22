# Issue #116: Underline and Strikethrough admission

Status (2026-10-22): both subtypes pass the native Preview and Acrobat matrix
in both directions. Admit Underline and Strikethrough to the verified-tools list
and native save permissions. Highlight remains the default text-markup tool.
The [original failed verification](issue-116-text-markup-verification.md) and
[#118/#119 fix record](issue-118-119-text-markup-fixes.md) retain their provenance.

## Candidate identity

- Base revision: `fa437d96e80e212dfdec0ec78ffaa0b7f4bcc18f`, PR #121,
  branch `codex/fix-text-markup-geometry`; includes fix revision
  `f2cad8e940f268dce5d3bb5edddee9e653916b05`.
- Monight 0.6.0, EmbedPDF 2.15.0, macOS 27.0.1 (26A434), Preview 11.0,
  Acrobat Reader 26.002.21901.
- Packaged verification app: `Monight 116 Verification.app`, identifier
  `art.monight.verification116`. It used an isolated Reading Session and only
  disposable copies of synthetic fixtures. Verification windows were on the
  MacBook built-in display; newly opened Preview windows were moved there
  through its Window menu before observations.
- Exact pre-build delta is retained as
  [`candidate.patch.gz`](../src-tauri/tests/fixtures/text-markup-verification/admission/candidate.patch.gz),
  decompressed SHA-256 `68a7d5c44d3b884a72fbfb7eb6d8d3cb0bf22bee07ed7ed550ae1ed40e7e98e9`.
  It exposed both tools and admitted their native save/delete path for this test.
- Tested executable SHA-256:
  `d7354747af5824712ddec7344065db0e27c95aac5026ea1a9c8d6d5dd5ac32e6`.
  Local archive `artifacts/issue-116-admission/candidate.app.tar.gz` SHA-256:
  `14a551ac4a74ae806ccfc274a0308f76700fc3053cafbf0e6c19c6458d69fc11`.
- Final source replaces temporary list ordering/icons with Highlight first and
  the proper Underline/Strikethrough icons and this verification reference.
  The native save behavior is the tested candidate behavior. Its final packaged
  `Monight.app` executable SHA-256 is
  `2fae2774b67b069e9332b0be5c51e3fb1128308e5be3d9bc508ca1337ee3dce7`.

## Native matrix

Every row covers both `/Underline` and `/StrikeOut`. Creation, comment edits,
and deletions were saved through the named application's interface, then read
from the resulting PDF; no evidence PDF was synthesized or repaired afterward.

| Direction and operation | Preview | Acrobat Reader |
| --- | --- | --- |
| Monight creates two marks, reader displays native marks and comments | Pass: Underline `sun`, Strikethrough `gypsy` | Pass: same marks and placement |
| Reader edits both comments, saves; Monight reopens exact values | Pass: `Preview edited Underline 116` / `Preview edited Strikethrough 116` | Pass: `Acrobat edited Underline 116` / `Acrobat edited Strikethrough 116` |
| Monight re-edits both returned comments, saves; reader reopens | Pass: exact `Monight re-edited Preview … 116` values | Pass: exact `Monight re-edited Acrobat … 116` values |
| Reader deletes both marks, saves; Monight reopens | Pass: no comments/marks | Pass: no comments/marks |
| Monight deletes reader-edited marks, saves; reader reopens | Pass: unmarked text | Pass: unmarked text |
| Reader creates native marks; Monight edits both comments and saves; reader reopens | Pass: native page 2 Underline `moon` and Strikethrough `second`, exact `Monight edited Preview-origin … 116` values | Pass: native page 1 Underline `moon` and Strikethrough `lower`, exact `Monight edited Acrobat-origin … 116` values |
| Monight deletes reader-created marks, saves; reader reopens | Pass: page 2 unmarked; three unrelated comments retained | Pass: lower line unmarked; four unrelated comments retained |

Acrobat's annotation controls reject computer-use clicks with
`AXError.notImplemented`, as in the earlier #80/#116 records. The owner performed
both comment edits and both complete annotation deletions in disposable
`acrobat-created.pdf`, saving after each requested step and reporting `saved`
and `deleted`. Inspection of separately retained saved states establishes the
exact native edits and absence after deletion. All Monight edits/deletions,
Preview actions, native reopen operations and visual observations were performed
through computer use. The owner's paid-Acrobat rotation waiver concerns #115
only; no annotation matrix cell was waived.

Native screenshots retained in this repository:

- [Preview reader-origin edits](evidence/issue-116/preview-origin-edited-native.png)
  and [deletion](evidence/issue-116/preview-origin-deleted-native.png).
- [Acrobat reader-origin edits](evidence/issue-116/acrobat-origin-edited-native.png)
  and [deletion](evidence/issue-116/acrobat-origin-deleted-native.png).
- Monight re-edits reopened in
  [Preview](evidence/issue-116/preview-roundtrip-final-native.png) and
  [Acrobat](evidence/issue-116/acrobat-roundtrip-final-native.png).
- Returned marks deleted by Monight reopened in
  [Preview](evidence/issue-116/preview-monight-deleted-native.png) and
  [Acrobat](evidence/issue-116/acrobat-monight-deleted-native.png).

## Saved-file contracts

All 13 saved snapshots retain the input's decoded page-content bytes, MediaBox,
CropBox and page rotation. All 12 markup appearances compared across native-reader
and Monight comment-only edits retain byte-identical decoded appearance programs,
Rect, QuadPoints, BBox and Matrix. This directly covers the #119 stretching failure.
The created Underline has Rect `[72,718,113,735]` and the Strikethrough
`[72,655,110,670]`; both remain attached to their text in the native readers.

All six deletion snapshots contain neither Underline nor StrikeOut in page
annotation arrays. Preview's own deletion output retains two orphan Popup
objects. Monight reopens it with no annotation comments; native save normalization
now removes orphan popups for either admitted parent type. The native regression
also requires the unrelated Text/Highlight popups to survive and cleanup to be
idempotent. Links and unverified Squiggly remain protected by preservation checks.

The [retained fixture directory](../src-tauri/tests/fixtures/text-markup-verification/admission/README.md)
contains unchanged native input/output PDFs, full SHA-256 checksums, an annotation
inventory and `verify.py` (pypdf) to repeat these byte/geometry/deletion checks.
Original inputs are the existing `selection-fonts.pdf`, `acrobat-text-markups.pdf`,
and the retained native `preview-origin-input.pdf`.

| Retained saved snapshot | SHA-256 |
| --- | --- |
| `monight-created-snapshot.pdf` | `4279029d96823863d707d7203552a54606dba4efa9bb5ab951311cbf787c6dd6` |
| `acrobat-edited-snapshot.pdf` | `b7a05f7efc14252bdff2ddfc17937227ea4b14d29e910a27ea4db7a87981b9ad` |
| `acrobat-deleted-return.pdf` | `5fc43117a96edd2f2ba19885887cc3ec27dcafc79f691b693d2753267203cfbe` |
| `acrobat-roundtrip-final.pdf` | `73454c620e773e4b9e0150dd6dbe686a059a1e08e463c788a6cc54167c3c022b` |
| `acrobat-monight-deleted.pdf` | `81cac0996235f3b274d829507ac76a6905e4dec454986b58eb882f077f9adaf2` |
| `acrobat-origin-edited.pdf` | `2378a2c39aa9a67c80a2d8d566b21c89a9d9da694a86c706c84d5c7bd23e9e17` |
| `acrobat-origin-deleted.pdf` | `dfc610a3c458e06d974cc7b102b7ea131ad3b2185cd5b939713cd6331659e6dd` |
| `preview-edited-snapshot.pdf` | `d2cff286bda5b325b40c687c336a985509d1642fefb002925bfc7aca5a264cf3` |
| `preview-deleted-return.pdf` | `26f400b276a6638ac76c9b396c2a127a9904f1d3966c1fd3a5a40419dc0db148` |
| `preview-roundtrip-final.pdf` | `435412f332f9dbf84d014b90d65d1e1b90aedd84471c9f56c45a4bfa115b2160` |
| `preview-monight-deleted.pdf` | `2092159650fb58b77edd8523a91187599d73a87adc0d15567f5ecaa54bce51e7` |
| `preview-origin-edited.pdf` | `0a4f1290e3e85884316c3b018e1964964883a5646d16df237986947c6bfcfb04` |
| `preview-origin-deleted.pdf` | `70df1057820c0738cb212f3d97fee17982958a3b5c1f00a23c27e74087535f6e` |

## Production gates and validation

`VERIFIED_MARKUP_TOOLS` alone supplies the new entries to the Highlight dropdown,
Tools ▸ Annotate, and the engine's allowed tools. Native save permissions now
allow both subtypes' edits/deletion and clean their orphan popups. Unrelated
unverified tools stay absent/locked; no general preservation check was removed.
The historical #118/#119 failure fixtures remain unchanged.

- `npm test`: 623 tests across 67 files passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 96 tests passed.
- `npm run lint`: passed, with five existing design-preview style warnings.
- `npm run tauri -- build --bundles app`: production app build passed.
- `npm run test:embedpdf-offline`: full Chromium/WebKit suite passed, including
  native text-markup, external-reader, print, navigation and scrolling contracts.
- Retained `verify.py`: all page, appearance and deletion contracts passed.
