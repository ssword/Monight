# EmbedPDF Reading Session verification — issue #58

The development-gated EmbedPDF surface retains Reading Session as the authority for
ordered Documents, the active Document, Reading Position, and Visual State. Select it
with `VITE_PDF_SURFACE=embedpdf`; PDF.js remains the default during the migration.

## Integration contract

- Intake and startup restoration use the existing transactional workspace adapters,
  including canonical-path deduplication and failed-Document pruning.
- The supported layouts are single (horizontal, no spread), continuous (vertical,
  no spread), and spread (horizontal, odd-page spread). Choosing vertical reading
  from a spread returns to continuous mode. The unsupported even-page spread command
  is disabled because Reading Session cannot represent it.
- Manual zoom and fit intentions remain distinct. Semantic visual changes preserve
  the page-relative reading anchor. Fit recalculation restores that anchor after the
  viewer's delayed resize calculation. Viewer gesture zoom retains its focal point
  and commits its resulting manual intention without executing the zoom again.
- Intermediate layout metrics are excluded from settled observations. New projections
  invalidate queued observations; closed/reopened Document generations reject old
  callbacks. Cancelled or disposed rendering projections do nothing.
- Monight owns configurable reader shortcuts. Its capture listener leaves editable
  inputs and tab focus navigation to their controls. Equivalent viewer shortcuts are
  removed; remaining viewer tool shortcuts run only for the visible Document.
- Filters apply once to page layers inside the pinned viewer's viewport, excluding
  chrome. The selector is specific to EmbedPDF 2.15.0 and covered by a browser contract;
  revalidate it when upgrading the package.

`DocumentWorkspace.viewTransform(filePath)` returns a detached, read-only
`DocumentViewTransform`: actual scale, Zoom Intent, viewing rotation, view mode, and
filter CSS. It describes presentation only. `viewingRotation` excludes PDF-authored
page orientation. Save and print must consume Document Content rather than apply this
transform to PDF bytes. This slice does not implement native annotation saving or the
new print pipeline.

## Runtime evidence

`npm run test:embedpdf-offline` now runs the Reading Session contract as well as the
existing offline rendering and navigation contracts. The existing Linux CI browser
step invokes the same command. All HTTP requests outside the local test origin are
blocked. The new harness uses the actual pinned viewer, WASM, fonts, Reader Actions,
Document workspace, Intake, startup restoration, preset buttons, and keyboard adapters.
Only PDF source/desktop storage are substituted with authored fixture bytes and
browser-local storage.

Verified locally in Chromium on macOS:

- A dark preset filters rendered pages without filtering toolbar buttons.
- Zoom and viewport resize preserve a within-page anchor; fit width remains a fit intent.
- Ctrl+0 runs reset zoom once, custom bindings override conflicting viewer tools, and
  removing a binding does not leave the old viewer shortcut active.
- Ready-made zoom, rotation, and layout commands reach Reading Session snapshots.
  Relative zoom persists the resulting scale, and rapid rotations during rendering
  retain every requested turn.
- Three Documents retain their order, active identity, different zoom intentions,
  rotations, view modes, and filters across duplicate activation, reload, and tab changes.
- Presentation projections do not change settled session state; Ctrl-wheel zoom
  preserves the physical point under the pointer and updates both live rendering
  and the saved manual intent/Reading Position.
- Duplicate saved aliases collapse to one Document; an invalid PDF is pruned and its
  provisional surface is disposed without preventing the other Documents from restoring.
- A PDF with native 90-degree orientation preserves a within-page anchor under all four
  viewing rotations. Document Content bytes remain identical through those transforms.

Focused unit contracts additionally verify stale-generation callbacks and cancelled or
disposed projections, plus configured shortcuts while a Document tab has focus.
Existing Reading Session, Reading Position, Zoom Intent,
presentation, rendering-adapter, and desktop/menu tests remain in place.

The complete local suite passed: 51 frontend test files / 390 tests and 34 Rust
tests. TypeScript/Vite build and Biome lint passed. Vite retains its existing
large-chunk advisory during the two-engine migration.

This is browser-runtime evidence, not packaged Tauri WebView, native trackpad, or
Windows/Linux desktop interaction evidence. The cross-platform desktop gates remain
required for the final migration. No Preview/Acrobat annotation interoperability or
PDF-write verification is claimed by this reading slice.
