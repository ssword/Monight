# Highlight re-verification after #127

Status: **PASS**, 2026-10-22, using #127's triaged acceptance criteria. Comment-only
saves preserve native Highlight appearance programs and resources. RGB channels
stay within ±1/255; geometry stays within 0.001pt. Highlight remains admitted in
`VERIFIED_MARKUP_TOOLS`. This supersedes the failed admission in the
[original #124 record](issue-124-highlight-verification.md), which is retained
with its original inputs and failed outputs.

## Candidate

- Exact packaged source: `c01d681f2c8ff43a5bbf3ba50f4a044ae16de689` on
  `codex/reverify-highlight`. All production source at this revision is identical
  to `develop` at `a7d4638`, including merged PR #128 (`40a0dc0`, `58a9ac8`).
  The merge retains the earlier #124 evidence without carrying its suspension
  over the merged fix. Subsequent changes add evidence, verification references
  and test coverage/drivers only.
- Monight 0.6.0, EmbedPDF 2.15.0, macOS 27.0.1 (26A434), Preview 11.0,
  Acrobat Reader 26.002.21901.
- Build: `npm run tauri -- build --bundles app --config
  src-tauri/tests/fixtures/highlight-verification/candidate-config.json`.
  Product/identifier: `Monight 124 Verification` / `art.monight.verification124`.
- Executable SHA-256:
  `04ba161e60c215956fe920267721ab990614aea4d26519de68993c4490fef498`.
- Monight's window was moved to the MacBook display by the owner. Preview was
  moved with its native Window menu; Acrobat's menu offered the external display
  as the move destination, confirming it was already on the MacBook display.

## Method and results

All annotation edits use the packaged app or the named native reader. Python
inspects saved bytes read-only. No native annotation stage is synthesized or
repaired. All documents are disposable copies of the two-page synthetic fixture,
with page rotations 0 and 90, mixed fonts and descenders, and all five colours.

The genuine Preview/Acrobat intermediate saves from the original matrix are
reused as regression inputs. This repeats every previously failing Monight save
leg on exactly the files that exposed #127; it does not claim that the owner
repeated the Acrobat creation/reply actions. The original native actions and
their provenance are described in the [earlier record](issue-124-highlight-verification.md).

| Save leg on the fixed candidate | Result |
| --- | --- |
| Ten Monight marks edited in Preview → Monight comment edits → Preview reopen | All five colours on both rotations; all ten exact comments; byte-identical decoded native appearances |
| Ten Preview-created marks → Monight comments → Preview reopen | All ten native appearances/resources preserved; correct placement and exact comments on both rotations |
| Ten Monight marks plus two Acrobat-created headings and two attached replies → Monight comments → Acrobat reopen | All twelve native appearances/resources preserved; all exact parent comments and both original replies/parent identities retained |
| Fresh Monight creation on the fixed build → Preview → Monight → Acrobat | Five colours on each rotation display correctly in both native readers; Preview edits to yellow page 1 and purple page 2 survive Monight re-edit/save and Acrobat reopen |
| Genuine Monight colour edit of Preview-origin yellow to Blue | Exactly one appearance regenerated, correct Blue RGB, `/BM /Multiply`; all other appearances and page content preserved |

The fresh run uses active Highlight-tool drags across the text, including vertical
drags along rotated text. Preview's native note bubbles add
`Fixed Preview fresh yellow page 1 - 124` and
`Fixed Preview fresh purple page 2 - 124`. Monight replaces those with
`Fixed Monight fresh {yellow|purple} page {1|2} - 124`. The final native Acrobat
view shows those comments beside the correctly placed marks.

Every regression input Highlight gets an exact
`Fixed Monight {Preview|Preview-origin|Acrobat} {colour|heading} page {1|2} - 124`
comment. The verifier matches by page/QuadPoints and geometric row, so native
annotation ordering on rotated pages cannot mix up the colour/comment pairing.
Acrobat's original two `/Text` replies remain attached through `/IRT`, unchanged.

The six fixed PDFs retain decoded page content, MediaBox/CropBox and Page
Rotation. Highlights remain native annotations with QuadPoints and appearance
streams; output is not flattened. Appearance programs and resources are compared
after resolving object references and compression. BBox/Matrix allow only the
existing 0.001pt float serialization tolerance (observed BBox drift: 0.00001pt).
Colour tolerance is the explicitly accepted ±1/255 from #127; it is separate
from the byte-exact decoded appearance-program requirement.

During rapid fresh creation, Save once refused an export with “Annotations changed
during export; retry Save”; live edits remained, and retry succeeded. A transient
Recovery Draft source-change warning was also observed. Neither was bypassed;
all retained PDFs passed subsequent inspection. These observations do not establish
the broader crash-recovery matrix or a new guarantee about Recovery Drafts.

## Durable evidence

Fixtures, [checksums](../src-tauri/tests/fixtures/highlight-verification/fixed/SHA256SUMS)
and the [read-only verifier](../src-tauri/tests/fixtures/highlight-verification/fixed/verify.py)
are under `src-tauri/tests/fixtures/highlight-verification/fixed/`.

| File | SHA-256 |
| --- | --- |
| `preview-return-monight.pdf` | `7f6156b808c7e2b77a4a10390b2cf5a2e073e79913fcae79e2aa87aba90e6a44` |
| `preview-origin-monight.pdf` | `83689541df850c6b8f4234d9e844a938a285474cf9505ed65fa0835ab6dc62b1` |
| `acrobat-return-monight.pdf` | `0a2aff03623c8694485d24c07965bef36980e537e0fa90f83545d29e84438116` |
| `fresh-preview-input.pdf` | `71abba7c5eb39f65f78a037977e8094d08786e11fca1a5e2fc07b409a88e20ea` |
| `fresh-roundtrip-final.pdf` | `5089e02d87243911292554fccd4e1549467d256c3fd1fff67f83ea1d556d22d8` |
| `visual-colour-monight.pdf` | `9965566eb9d2a23e8bc46a096025a757ce120f3721fad15a5e0b65dc20b6e92a` |

`fresh-preview-input.pdf` is the fixed build's fresh creation **after Preview's two
native edits**; `fresh-roundtrip-final.pdf` is its subsequent Monight save. The
other inputs remain in the parent fixture directory with their original checksums.

Native screenshots:

- Preview-return [page 1](evidence/issue-124-fixed/preview-return-page1.png),
  [page 2](evidence/issue-124-fixed/preview-return-page2.png).
- Preview-origin [page 1](evidence/issue-124-fixed/preview-origin-page1.png),
  [page 2](evidence/issue-124-fixed/preview-origin-page2.png).
- Acrobat-return [page 1](evidence/issue-124-fixed/acrobat-return-page1.png),
  [page 2](evidence/issue-124-fixed/acrobat-return-page2.png), including replies.
- Fresh creation in Preview [page 1](evidence/issue-124-fixed/fresh-preview-page1.png),
  [page 2](evidence/issue-124-fixed/fresh-preview-page2.png); final return in Acrobat
  [page 1](evidence/issue-124-fixed/fresh-acrobat-page1.png),
  [page 2](evidence/issue-124-fixed/fresh-acrobat-page2.png).

## Automated validation

- Production isolated macOS app build and final frontend production build passed.
- `npm run lint` passes with five pre-existing design-preview warnings.
- Fixed evidence verifier passes: 32 native appearances/resources and exact
  comments; native identities, geometry and replies; fresh five-colour return;
  genuine colour edit with Multiply blend; six PDF checksums.
- `npm test`: 655 tests across 70 files pass. Frontend tests include the #127 appearance-path regressions for comment edits,
  colour edits and opacity edits, plus the existing save-failure retention checks.
  Opacity regeneration is automated coverage, not a claimed native-reader action.
- Full offline Chromium/WebKit suite passes: Reading Session/chrome, native
  annotation editing and protected printing, text-markup visual/selection checks,
  external-reader contracts, navigation/search, and wheel scrolling.
- The suite needed two driver corrections on this Mac: establish a real page text
  selection after Zoom to Fit before asserting Copy, and use `ControlOrMeta+F`
  for Find. Clipboard contents and navigation assertions remain enforced.

This is Highlight interoperability admission for #124/#127, not a claim of
completion of the migration's wider platform, recovery or release matrices.
