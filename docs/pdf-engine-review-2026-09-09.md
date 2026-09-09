# PDF engine migration review — 2026-09-09

Reviewed `develop` at `aa9a095`, with a clean starting worktree. The migration comparison is
`git diff 921df19...HEAD`, from immediately before the first EmbedPDF implementation. The review
also covers the surrounding application, reader domain, TypeScript tests, Rust desktop adapters,
CI/release configuration, glossary, ADRs, specification, and verification documents.

## Assessment

The engine replacement is not complete. PDF.js remains the default; `VITE_PDF_SURFACE=embedpdf`
selects a read-only EmbedPDF surface. Issue #56 explicitly permits that temporary coexistence.
The native annotation/save/recovery work and final default switch remain tracked in #59–#66;
navigation and Reading Session completion are tracked in #57–#58. The tracker still lists
#56–#66 as open. A merged commit mentioning #56 is not evidence that all its criteria passed.

The existing tests remain useful for the current default reader and engine-independent domain
behavior. Their passing result does not establish equivalent EmbedPDF behavior. Real-runtime
checks found defects that substitute-based tests and the existing offline smoke do not detect.
Keep the development gate until the reading regressions and planned acceptance gates are met.

## Verification performed

| Check | Result and limit |
| --- | --- |
| `npm test` | 51 files, 388 tests passed |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | 34 tests passed on this macOS host |
| `npm run lint` | Passed |
| `npm run build` | TypeScript and Vite passed; large-chunk warnings remain |
| `npm run test:embedpdf-offline` | Actual Chromium runtime passed: local fonts/WASM, visible glyphs, page navigation, zoom, and page-link interception; external HTTP requests blocked |
| Additional composed Chromium probe | Real EmbedPDF + Document Intake + Document workspace + Reader Actions; reproduced scroll reset and a read-only search changing Reading Session |
| Editable-input probe | Actual viewer input event reaches the document with `target=EMBEDPDF-CONTAINER`, `composedPath()[0]=INPUT`; the real KeybindManager matches ArrowRight to `nextPage` |

The initial offline smoke could not start its local server in the filesystem/network sandbox;
it passed when rerun with the required permission. This was an execution-environment limitation,
not a failing viewer assertion. Additional browser probes used a temporary harness, not a new
committed regression suite. The documentation changes from this review do not fix the defects.

No Windows/Linux execution, packaged Tauri interaction, Preview/Acrobat round trip, or annotation
file-write verification was performed. Existing CI configuration was inspected; remote CI results
were not treated as current proof. The stock smoke runs a Vite development page, not the production
artifact under a native WebView and its CSP.

## Standards findings

### S1 — P1: page observations become new navigation commands

[EmbedPDF surface, line 605](../src/app/embedpdf-document-surface.ts#L605) subscribes to
`scroll.onPageChange` and calls `pageNavigationRequested`. The installed scroll plugin emits this
event when normal scrolling changes the dominant visible page. The workspace translates it into
`goToPage`, whose Reader Action projects `{page, location: 0}`. The existing position observation
has already reported the actual within-page location, so the extra command moves the reader.

In the composed browser probe, scrolling to offset **1850** reported page 2/location **0.1553**,
then caused `goToPage(2)` and snapped to offset **1614**, page 2/location **0.0063**. This is a
visible continuous-reading regression and can also overwrite precise search/bookmark targets.
It conflicts with ADR 0001's separation of semantic actions and settled state observations.

Use the existing Reading Position observation path for completed viewer movement. Distinguish
an input requesting navigation from notification that navigation already happened. Add a real
composed browser check asserting that crossing a page boundary does not issue another jump.

### S2 — P2: a Document Query changes interactive search and settled state

[EmbedPDF surface, line 799](../src/app/embedpdf-document-surface.ts#L799) calls the interactive
search plugin from `DocumentContent.search`. Installed `@embedpdf/plugin-search` changes the
active query/results, aborts an earlier search, activates search, and selects its first result.
This conflicts with the glossary's read-only Document Query and the specification's query boundary.

With the ready-made search panel open, calling `reader.query().search('你')` on page 2 of the
two-page required-font fixture moved the active Document to page 1 and advanced the Reading Session
revision from **5 to 7**. With the panel closed, the same probe returned matches without changing
the Reading Session; the panel state is a necessary reproduction condition for that visible effect.

Use the engine's read-only search API for Document Queries, independently of interactive viewer
search. Verify query/result selection, Reading Position, cancellation isolation, and session
revision with the panel both open and closed.

## Spec findings

The first two findings above also fail the specified preservation of Reading Position and the
read-only Query boundary. Three further integration gaps affect retained behavior:

### P2: visual filters affect viewer chrome

[EmbedPDF surface, line 791](../src/app/embedpdf-document-surface.ts#L791) assigns the CSS filter
to the entire `embedpdf-container`, including its shadow toolbar, search field, and panels.
The old PDF.js implementation filters page canvases. Issue #58 explicitly requires filters on the
reading surface without unintentionally changing viewer chrome. Strong brightness/inversion
settings can make controls unreadable. Scope filters to document rendering and verify a preset
changes page pixels while leaving controls usable. This finding is source-confirmed.

### P2: external outline links bypass Reader Actions

The interception in [EmbedPDF surface, line 555](../src/app/embedpdf-document-surface.ts#L555)
recognizes page annotation hit areas. The installed snippet's bookmark component handles URI
actions separately using `window.open(uri, '_blank')`. Disabling `annotations.autoOpenLinks`
does not intercept those outline links. They therefore bypass the originating-Document Reader
Action and native external-link adapter, potentially opening the wrong context or failing in a
desktop WebView. This conflicts with the spec's semantic Document-scoped command boundary.

Route ready-made outline links through the same semantic link path. Test an outline URI action,
an internal outline destination, tab changes, and rejected schemes with the actual viewer.
This is source-confirmed; a packaged-app symptom was not reproduced in this review.

### P2: editable viewer inputs are mistaken for reader shortcuts

[KeybindManager, line 137](../src/scripts/keybind-manager.ts#L137) checks only `event.target` for
an editable element, while [the document listener](../src/app/dom-events.ts#L177) handles the
bubbled event. Shadow DOM retargets it to the EmbedPDF host. In the actual viewer input probe,
ArrowRight matched `nextPage` even though the event originated in an input. The application's
handler prevents the default caret action and executes the reader shortcut.

Inspect the composed event path for editable elements and cover viewer inputs in a real-browser
keyboard test. Existing light-DOM editable-target tests remain valid but miss this new integration.

Native editing, explicit Save/Save As, recovery, author attribution, and unsaved-annotation printing
are intentionally unfinished slices, not accidental omissions from the read-only #56 scope.
No change to the agreed product scope is justified by these findings.

## Which tests remain valid?

| Test family | Assessment | Required action |
| --- | --- | --- |
| Reading Session/store, Recent Documents, Intake, Reader Actions, workspace, startup restoration | Still valid: canonical identity, ordered operations, revisions, persistence failures, stale work, and independent outcomes remain required | Keep; add composed real-viewer cases where plugin events feed back into these boundaries |
| Rust intake authorization, CLI/OS events, URL policy, existing close handshake | Still valid desktop contracts | Keep; add native write/recovery/close-cancellation coverage when those adapters land |
| `rendering-adapter-contract` and `document-content-adapter-contract` | Currently run substitute and PDF.js adapters only; no EmbedPDF equivalence proof | Reuse engine-neutral behavior for EmbedPDF, separating PDF.js-only page-handle assumptions; run runtime-dependent assertions in a browser |
| `embedpdf-document-surface` | Useful adapter wiring/failure cleanup checks; most workflows inject a fake `EmbedPdfViewerRuntime`; other tests assert helper mappings/configuration | Keep useful behavioral cases; add production event, password retry/cancel, query isolation, disposal, and Reading Position coverage |
| `embedpdf-offline-assets` and offline browser smoke | Useful existence/pinning and real render/link/font checks, respectively | Run smoke explicitly in CI; extend to composed workflows and production/native artifacts; file size alone cannot establish correct asset behavior |
| PDFViewer load, fit-position, gesture-zoom, dimensions, scroll-geometry, output-scale, PDF-engine tests | Valid for the still-default PDF.js implementation; some construct `PDFViewer.prototype` or assert private helper order | Keep during coexistence; replace user-visible behavior coverage for EmbedPDF before removing PDF.js, then retire implementation-only tests with removed code |
| Annotation authority/storage and annotation portions of durable persistence/lifecycle tests | Correct for the current default reader's local annotation store; not the target model of saved annotations | Keep only while that reader is shipped; replace with native PDF save/reopen, dirty revisions, recovery, and explicit close decisions, preserving session/recent persistence tests |
| `performance-benchmarks` | Tests report construction and a substitute clock, not renderer performance | Collect an actual EmbedPDF baseline; retain formatter tests only as formatter tests |
| Source-string code-health checks | Narrow structural safeguards, not runtime architecture proof | Keep useful invariants; do not count them as validation of engine independence or query purity |

The CI frontend matrix currently executes lint, build, and `npm test`; it does **not** run the
Playwright smoke. A green matrix can therefore miss a WASM/runtime regression. Preserve all six
TypeScript/Rust OS jobs and add an explicit browser gate rather than replacing domain tests.

Before the final switch, the browser/native workflow set should cover continuous scrolling,
within-page restore under all rotations and fit modes, viewport/gesture changes, tab switching,
search and outline destinations, shadow inputs, filters, password retries, failed rendering,
and teardown. Later slices additionally require actual PDF annotation round trips, protected
documents, write conflicts/failures, edit-during-save, Save As identity, cancellable close/Quit,
recovery revision/privacy rules, and printing unsaved annotations. Mocked export bytes do not
establish any cross-reader portability guarantee.

## Decisions and document maintenance

**Retain ADR 0001's Reading Session authority, semantic Reader Actions, canonical Intake,
generation-bound Queries, and adapter seams.** The observed defects are integration violations,
not evidence these decisions should be abandoned.

**ADR 0002 already supersedes the PDF.js choice and separate durable annotation authority.**
Keep explicit Save, native non-flattened annotations, conflict protection, read-only protected
documents where necessary, recovery privacy, and interoperability acceptance. The legacy store
and its flush behavior must not be relabeled as PDF-native saving. No new ADR is needed for the
already-approved migration or for correcting the regressions above.

**Reassess implementation mechanics with evidence.** The direct main-thread engine, eagerly
preloaded fonts, and per-Document viewer registries need measurements of responsiveness, startup,
multi-Document memory, and teardown. PDF.js canvas limits and geometry tests do not establish those
properties. The existing API audit records the worker-bootstrap difficulty; benchmark before
accepting that workaround as the final performance design. Link interception also depends on the
pinned viewer's DOM shape and needs actual-runtime regression coverage on package upgrades.

Factual documentation changes made with this review:

- README distinguishes the default reader from the gated viewer, documents the selector, and
  explains how the separate runtime smoke differs from the unit suite.
- ADR 0002 and the parent specification no longer incorrectly say implementation has not started.
- Desktop verification distinguishes historical PDF.js evidence, current browser checks, and
  pending migration-specific native acceptance.
- Performance documentation calls for a separate EmbedPDF baseline.
- The old Tauri plan, issue queue snapshot, and July code review are marked historical.
- `CONTEXT.md` remains a glossary; migration status belongs in this review and the implementation
  records. Existing historical verification results are preserved rather than rewritten as new proof.

Prioritize the scroll feedback fix, query isolation, input handling, link routing, and filter
scope; add their real-runtime regressions and CI gate as the related implementation changes land.
Then complete #57–#66 against the existing accepted requirements and retire the PDF.js path only
at the final switch. This review changes documentation only and does not mark any issue complete.

Axis totals: Standards **2** findings (highest severity P1, scroll feedback); Spec **5** findings
(highest severity P1, Reading Position regression). Two findings overlap, for **5 unique code
findings**, plus the test-coverage and documentation gaps described separately above.
