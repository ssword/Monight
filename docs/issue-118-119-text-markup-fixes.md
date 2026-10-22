# Issues #118 and #119: selection and text-markup appearance fixes

Status (2026-10-22): code fixes implemented; automated regressions and targeted
native Preview/Acrobat observations passed. Underline and Strikethrough remain
absent from the verified-tools list. This is a fix record, not full #116 admission.

## Candidate and scope

- Base: `30ce574` on `codex/verify-rotation-text-markups` (PR #120).
- Fix revision: `f2cad8e940f268dce5d3bb5edddee9e653916b05` on
  `codex/fix-text-markup-geometry`.
- Monight 0.6.0; pinned EmbedPDF 2.15.0; local bundled PDFium and fonts.
- Native readers: Preview 11.0 and Acrobat Reader 26.002.21901,
  macOS 27.0.1 (26A434). Computer-use windows were placed on the built-in display.
- The browser harness composes the production Document surface and verified native
  export path. It unlocks tools only inside the disposable harness. The production
  verified-tools list, native save permissions and preservation checks are unchanged.
  No new packaged-app native Save claim is made by this browser export evidence.

## #118: selection geometry

The pinned engine obtains both loose font bounds and tight glyph bounds. Selection
used the former; the bundled fallback font produced a 38pt-high rectangle for the
fixture's 24pt Helvetica `sun`. PDFium places an Underline 1pt inside the bottom
of that rectangle, giving the observed y=709 stroke below the y=720 baseline.

The engine geometry adapter keeps horizontal advances and hit-test ink bounds,
but derives vertical selection bounds from each measured glyph's ink plus stroke
clearance: 2pt minimum, scaling to 8% of font size. This is clearance around measured
ink, not an assumed baseline correction. Whitespace borrows nearby visible ink;
missing ink metrics retain the engine fallback. The corrected geometry feeds the
selection plugin itself, covering both immediate markup and active text-markup tools.

The exact original `sun` selection now has Rect `[72,718,113,735]` and an Underline
at y=719. Multiline selection on Helvetica 24pt, Times-Italic 14pt with descenders,
and Courier-Bold 32pt produces three separate segments. Their generated lines are
y=713, 656 and 598.44 respectively, below their measured ink. The selection test
uses the real geometry and selection capability, not manually supplied rectangles.
Active-tool pointer drags also exercise Underline, Strikethrough and Highlight.

The authored font fixture is `selection-fonts.pdf`, generated with ReportLab using
those three standard fonts, baselines 720/660/600, page size 612×792 and text
`sun third page`, `gypsy descenders`, `CAPITALS mixed`. SHA-256:
`e82a0a489404ff10c5d9249c3db22bb8e79c0915c997067820920232a11b0b3b`.

## #119: comment-only and visual edits

Contents/author updates to Underline and StrikeOut now use the same appearance
preservation principle as Text notes. If Rect, segment rectangles, colour, opacity,
stroke width and blend mode are unchanged, the existing appearance is retained.
Save/reopen of the genuine Acrobat input retains byte-identical decoded appearance
programs, original line widths and native raster pixels. BBox/Matrix differ at most
by PDF float serialization below 0.0001pt.

Genuine visual edits still use the pinned generator. A narrow direct-PDFium adapter
reinstalls its simple stroke program using `FPDFAnnot_SetAP`, which creates a BBox
from the retained annotation Rect. The appearance then maps 1:1 instead of stretching
its tight quad box across Acrobat's padded Rect. Translucent strokes retain the
normal opacity resource; opaque strokes remove the redundant resource operator.
Non-Normal blend appearances and unknown generated resources fail closed rather
than silently losing resources. Existing non-Normal appearances on comment-only
edits are preserved. This adapter is limited to the two stroke markup types.

The API's Rect/BBox behavior is documented in the
[PDFium implementation](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/fpdfsdk/fpdf_annot.cpp).
Real-engine checks cover both subtypes, colour plus opacity, movement and opaque
colour changes. Reopened appearance raster widths match their QuadPoints within
1pt. An injected SetAP failure blocks export even though the plugin can swallow
individual commit failures; restoring the API allows an explicit retry to repair
and export. No preservation check is relaxed.

## Native observations

1. Preview opened `contents.pdf` with native Underline/Strikethrough and exact
   `Contents only 10` / `Contents only 12` comments. Both strokes remained attached
   to `moon` / `lower`, with their original width and placement.
2. Acrobat opened the same output and displayed the exact comments and correctly
   placed native strokes. Its Window menu offered Move to 27M2N2500NF, confirming
   the window was on the MacBook display.
3. Both readers opened `fonts.pdf`: all three Underlines sat beneath their glyphs,
   including the italic descenders. Both opened `active.pdf`: the `sun` Underline,
   Times Strikethrough and Courier Highlight aligned with the selected text.
4. Acrobat opened `colour.pdf`. The translucent green strokes stayed within their
   words, with no padded-Rect stretch. This visual-edit case was also checked after
   save/reopen by real-engine raster assertions for both subtypes.
5. In Preview's native Underline popover on a disposable `active.pdf`, changed the
   comment to `Preview edited corrected underline 118`, used Done and saved. Saved
   bytes confirmed that exact native Contents. Retained as `preview-return.pdf`.
6. Reopened that native Preview output through the production Monight surface and
   edited both markup comments again. Verified export retained the appearance
   pixels. Acrobat opened `preview-return-monight.pdf` and showed correctly placed
   strokes plus `Contents only 10` / `Contents only 12` in its native comment list.

Local screenshots are under `artifacts/text-markup-fixes/`:
`preview-contents.png`, `preview-fonts.png`, `preview-active.png`,
`acrobat-contents.png`, `acrobat-fonts.png`, `acrobat-colour.png`,
`acrobat-active.png`, and `acrobat-preview-return.png`.

## Regression checks and evidence

- `npm test`: 623 tests in 67 files passed.
- `npm run build`: passed.
- `npm run lint`: passed, five existing design-preview warnings.
- `npm run test:embedpdf-offline`: passed, including existing external-reader,
  protected-document, rotation/printing, navigation and scrolling checks; the new
  text-markup suite runs in both Chromium and WebKit.
- After adding the final opaque branch and resource guard, the production build
  and targeted text-markup suite passed again in both browsers.
- Fault injection restoring each original bug path made the new checks fail:
  `Contents-only 10 changed native appearance pixels` and
  `Selection still uses oversized loose font bounds` respectively.
- Independent pypdf inspection confirms unchanged decoded page contents for all
  Acrobat-derived outputs, original appearance programs on comment-only edits,
  and BBox equal to Rect with identity mapping on visual edits.

Durable input/output PDFs and exact checksums are under
`src-tauri/tests/fixtures/text-markup-verification/fixed/README.md`. The original
known-failure PDFs are retained unchanged for comparison. Re-run the browser suite
to regenerate local outputs in `artifacts/text-markup-fixes/`; IDs of newly created
annotations vary by run.

## Remaining #116 admission work

These fixes do not add either tool to `VERIFIED_MARKUP_TOOLS` or loosen native save
permissions. The full native create/edit/delete/return matrix, including native
Acrobat editing of Monight-created marks, remains an explicit #116 requirement.
The earlier Acrobat custom-control computer-use limitation still applies; native
Acrobat display observations above are not recorded as native edit/delete actions.
