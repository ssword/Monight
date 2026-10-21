# Page Rotation write path (issue #105)

Page Rotation is a Document edit ([ADR 0003](adr/0003-preview-style-chrome-over-headless-embedpdf.md)).
EmbedPDF 2.15 exposes no engine API for writing a page's `/Rotate`, so one mechanism was chosen.

## Mechanism: PDFium's page-rotation setter on the live Document

`rotatePages` (in `src/app/embedpdf-native-annotation-editing.ts`) calls PDFium's
`FPDFPage_SetRotation` on the viewer's open Document. It reaches the setter through a narrow
adapter over the direct (main-thread) engine executor (`pdfiumPageRotationSetter`), and then
updates the viewer's page model, layout, and rendering.

There is no second path for writing the PDF. Save, Save As, Recovery Drafts, and printing all
serialize the live Document with `saveAsCopy`, so each one carries the rotation. The bytes then
go through the same native verification as Annotation edits: `prepare_pdf_save`,
`verify_preservation`, external-conflict detection, and reading the file back. On the native
side, `verify_preservation` accepts exactly one new kind of change: a page's own `/Rotate`
becoming another quarter turn, or being removed so the page inherits again.

The alternative was for the native side (lopdf) to rewrite `/Rotate` during Save. It was
rejected for three reasons:

- The viewer still needs PDFium's in-memory rotation to display the turned page.
- A Rust rewrite would add a second write path that Recovery Drafts and printing would also
  have to apply.
- The rewrite would not be exercised by the browser verification harness.

## Annotations stay on their text

The viewer opens Documents with normalized rotation, so Annotation geometry lives in
unrotated page space and each page's rotation is applied when the page is laid out. A Page
Rotation therefore never touches Annotation coordinates. Export verification now reopens
exported bytes with the same normalization. Before this change, verification compared
normalized live geometry with rotated reopened geometry, so saving any annotated page that
already had a `/Rotate` failed with "Native annotation verification failed".

## Undo and Reader Action

Each rotation is registered on the viewer's history timeline (topic `page-rotation`), the same
timeline Annotation edits use, so ⌘Z undoes rotations and markup in order. Input adapters
dispatch:

```ts
{ type: 'rotatePages', pages: number[] /* 1-based */, direction: 'clockwise' | 'counterclockwise', filePath?: string }
{ type: 'undoEdit', filePath?: string }
{ type: 'redoEdit', filePath?: string }
```

`readerAction.rotatePages(pages, direction, filePath?)` builds the first action. On read-only,
signed, or protected Documents these actions are refused with the existing explanation.
