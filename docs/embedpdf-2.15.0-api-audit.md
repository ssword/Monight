# EmbedPDF 2.15.0 API audit

Audited on 2026-09-08 for issue 56 against the installed `@embedpdf/snippet` package and its matching `2.15.0` dependencies. Monight pins the exact release instead of relying on the `latest` tag or development-branch documentation.

## APIs used in the read-only slice

- `EmbedPDF.init` and `EmbedPdfContainer.registry` mount the ready-made viewer and expose its initialized plugin registry.
- `DocumentManagerCapability.openDocumentBuffer`, `retryDocument`, `getDocument`, and `closeDocument` support byte-based native intake, password retry, publication checks, and disposal.
- `ScrollCapability.forDocument` provides page count, current page, page navigation, page-change events, and horizontal/vertical strategies for Monight's single/continuous View Modes.
- `ScrollCapability.onLayoutReady` defines initial presentation readiness. Monight does not publish a live Document until the first measurable viewer layout has completed.
- `ZoomCapability.forDocument` provides manual zoom, fit width, fit page, zoom in/out, and zoom-change events.
- `RotateCapability.forDocument` and `SpreadCapability.forDocument` project retained Visual State.
- `CommandsCapability.forDocument.execute` routes Monight's retained Find shortcut to the ready-made viewer's `panel:toggle-search` command.
- The ready-made viewer registers fixed `Ctrl+F` and `Meta+F` shortcuts for that command. Monight removes those shortcut mappings after plugin initialization so its configurable Find binding remains the sole keyboard owner while the EmbedPDF toolbar button and command action continue to work.
- `AnnotationPluginConfig.autoOpenLinks` is disabled. In pinned release `2.15.0`, ready-made link rendering uses either a normal SVG hit area or a locked-mode HTML hit area. A capture-phase adapter derives the clicked page from the rendered layout, matches the hit area to public `AnnotationScope.getAnnotations()` data on that page, and stops EmbedPDF selection/navigation. EmbedPDF's raw target is translated at this adapter boundary into an external URL or normalized Reading Position before the originating Document dispatches `activateDocumentTarget`.
- `SearchCapability.forDocument`, the PDF engine metadata/bookmark methods, and `ThumbnailCapability.forDocument` back existing Document Query boundaries without exposing EmbedPDF handles.

## Offline configuration

- `PDFViewerConfig.wasmUrl` is set to `/embedpdf/pdfium.wasm`.
- The gated surface uses EmbedPDF's direct engine (`worker: false`). The worker bootstrap did not
  settle in the Vite/Tauri-style runtime, while the direct engine initializes from the same local
  WASM and keeps PDF processing inside the application process.
- `PDFViewerConfig.fontFallback` points only to `/embedpdf/fonts/` and includes local Latin, Simplified Chinese, Traditional Chinese, Japanese, Korean, Arabic, and Hebrew regular fallback fonts.
- The direct engine's built-in browser fallback loader uses synchronous XHR, which Chromium does not
  permit with an `ArrayBuffer` response on the main thread. Monight therefore preloads the local
  font files asynchronously once and supplies an in-memory synchronous `fontLoader` to PDFium.
- `PDFViewerConfig.fonts.ui` uses the system font stack with no stylesheet URL; signature fonts are disabled in this read-only slice.
- `PDFViewerConfig.stamp` disables both remote stamp manifests and the mutable default stamp
  library. The package otherwise requests its default manifest from jsDelivr during startup.
- Annotation, redaction, insertion, export, protection, capture, print, and library-owned open/close controls are disabled. Monight retains its existing print adapter and shell controls. PDF permissions remain enforced and modifying contents, annotations, and forms is explicitly denied.

Run `npm run test:embedpdf-offline` to launch the actual `2.15.0` runtime with external requests blocked. The harness opens a generated two-page PDF that references an unembedded Simplified Chinese font, navigates to page 2, increases zoom, and verifies that the page image contains visible glyph pixels with the local WASM and fallback-font configuration.
