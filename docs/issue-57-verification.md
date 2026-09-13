# Issue #57 — Find and navigate Document Content

Implemented against baseline `aa9a0954508b14a12ffb21da50a15531248a6ce1` on
2026-09-09. The EmbedPDF 2.15.0 surface remains selected only by
`VITE_PDF_SURFACE=embedpdf`; PDF.js remains the default. This record supplements
the earlier engine review without rewriting its historical findings.

## Behavior

- Document Query search uses the engine's read-only search API, independently of
  the ready-made viewer's interactive query, result selection, and cancellation.
- Search-result and thumbnail movement settles Reading Position through Reader
  Actions. Page-change notifications no longer request a second jump. Scroll
  observations during Reading Position projection cannot overwrite a requested
  bookmark destination with a different dominant visible page.
- Retained search presentation selects the exact occurrence and routes navigation
  through the originating Document's Reader Action. Clearing or replacing search,
  including changes through the ready-made panel, cancels older pending reveals.
- Ready-made outline links use the same Reader Action/external-link adapter as
  page links. Nested entries and duplicate titles retain their correct targets.
- Workspace callbacks capture the originating surface lifetime; callbacks from a
  closed surface cannot change a reopened Document at the same path.
- Editable inputs inside the viewer shadow root keep caret keys instead of
  dispatching global reader shortcuts. The existing gated CSS continues to hide
  duplicate legacy PDF navigation, search, and sidebar controls.

## Verification

Run `npm run test:embedpdf-offline` for both the existing offline font/render check
and the new composed navigation contract. The latter uses actual EmbedPDF/PDFium
with Document workspace and Reader Actions, an authored three-page fixture, and
Playwright Chromium. The harness HTML is a development entry and is not included
in the production build inputs.

Verified locally on macOS with Chromium:

- Actual mouse text selection and copying to the browser clipboard.
- Visible search-result selection, cross-page and same-page occurrence navigation,
  and settled within-page Reading Position.
- Read-only query isolation while interactive search is open, query failure
  isolation, and metadata/outline/thumbnail retrieval without a PDF.js handle.
- Nested/duplicate outline entries, precise internal destinations, page links,
  external outline links, and adapter rejection of a prohibited URL scheme.
- No extra page jump after native viewer navigation; no stale commit after a
  ready-made query change overlaps a delayed retained navigation.
- Fresh search UI after switching Documents or closing/reopening the same path;
  empty and failing interactive searches clear preceding results.
- Shadow-input caret keys and operation with external HTTP(S) requests blocked.

The workspace contract additionally verifies captured inactive-Document targets,
stale Query suppression, and ignored callbacks after closing/reopening a path.
The actual native URL policy is covered by existing Rust tests; the browser
harness substitutes the native invocation boundary and does not launch an OS
browser.

Validation: 51 TypeScript test files / 389 tests, 34 Rust tests, TypeScript/Vite
build, Biome lint, and the combined Chromium smoke passed. Vite's existing
large-chunk warnings remain. CI now installs Chromium and runs the combined
smoke in the Linux frontend job while retaining the existing TypeScript/Rust OS
matrices. Remote CI and Windows/Linux native packages were not executed locally.

## Review

Separate Standards and Spec reviews each found one actionable item. The Standards
finding led to asserting visible same-page selection and within-page Reading
Position, rather than only a plugin result index. The Spec finding led to
invalidating pending reveals when the ready-made query, flags, or search session
changes; the new browser regression reproduced the stale navigation before the
fix and passed afterward.

The outline adapter depends on the pinned snippet's `.outline-tree` DOM because
2.15.0 exposes no bookmark-activation hook. Its runtime contract must run when
upgrading EmbedPDF. Packaged Tauri/WebView verification and the broader reading,
annotation, save, recovery, and final-default-switch gates remain subsequent
migration work; this slice does not claim those results.
