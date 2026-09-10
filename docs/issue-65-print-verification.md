# Issue 65 annotated print verification

Date: 2026-09-10

## Automated evidence

`npm run test:embedpdf-offline` exercises the pinned EmbedPDF 2.15.0 runtime in Chromium.
The smoke workflow creates native highlight and comment annotations, keeps them unsaved, applies
Monight viewing rotation, zoom, and filters, and prepares print bytes. Reopening those bytes verifies
that the current annotations are present and the viewing rotation was not written into the PDF.
The workflow also verifies that printing leaves the live Document dirty.

The same smoke workflow opens the protected fixtures as read-only Documents and prepares print
output when their PDF permissions allow printing. Editing export remains denied.

Reader Actions contract tests verify that print uses the captured Document generation, sends the
live prepared bytes through the shared print adapter, performs no PDF write, and leaves Document
identity, Reading Session state, and unsaved state unchanged. Closing the captured generation before
preparation completes suppresses the stale print operation.

## Packaged macOS check

A development-gated debug DMG built successfully with:

```sh
VITE_PDF_SURFACE=embedpdf VITE_NATIVE_PDF_EDITING=1 npm run tauri:build -- --debug
```

The mounted application launched from the DMG. This check exposed and fixed Tauri raw byte-response
normalization for numeric arrays, typed views, and isolation-realm `ArrayBuffer` values. After that
fix, Document Intake advanced past the previous `Invalid PDF source byte response` failure.

Native print-dialog evidence remains blocked: the development-gated EmbedPDF surface did not finish
opening the annotated fixture in the packaged app, so Reader Actions correctly reported that no PDF
was open when Print was invoked. The real EmbedPDF print-byte behavior is covered by the browser
smoke above; the packaged surface initialization blocker must be resolved before final desktop print
evidence can be collected.
