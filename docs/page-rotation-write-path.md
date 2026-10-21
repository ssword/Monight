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

⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y elsewhere) and Edit ▸ Undo/Redo are the reader
commands `edit.undo` / `edit.redo`, which dispatch `undoEdit` / `redoEdit`; EmbedPDF's own
`history:` shortcuts are removed so there is one path. With focus in a text field (Search,
a dialog, a note) they undo that field's typing instead. Cut, Copy, Paste and Select All stay
the platform's predefined items.

## Rotate controls and the verification gate (issue #114)

Rotate is offered by the toolbar Rotate button (click: Rotate Left, Option/Alt-click: Rotate
Right), Tools ▸ Rotate Left / Rotate Right, and the ⌘L / ⌘R shortcuts (Ctrl+L / Ctrl+R on
Windows and Linux). All three run the same reader commands (`tools.rotate.left`,
`tools.rotate.right` in `src/app/reader-commands.ts`), which dispatch `rotatePages` for the pages
selected in the Thumbnails sidebar, or the current page when none are selected. Thumbnail
selection (⇧-click range, ⌘/Ctrl-click toggle; a plain click ends it) is transient: it is cleared
on Document switch or when Thumbnails closes and is never persisted. Protected Documents disable
the button and menu items with their reason; a shortcut is refused by the Reader Action with it.

Everything is behind `PAGE_ROTATION_VERIFIED` (`src/lib/verification-gates.ts`). While it is `false`
the button's toolbar slot is empty, the Tools menu's `tools.rotate` section (filled inline from
TypeScript; Rust cannot see the constant) has no items, the commands do not exist, and the
Rotate keybind actions are not defaults, not stored, and not shown in Settings. The browser
reload chords (Ctrl+R, Ctrl+Shift+R, F5) never reach WebView2 either way.

Opening the gate is a one-line change. Keybind defaults revision 4 (`RotateLeft: ⌘L`,
`RotateRight: ⌘R`) carries `gate: 'pageRotation'`, so it does not count towards the stored
defaults version while closed. Once open, a fresh install gets ⌘L/⌘R with its other defaults;
an install stored under an earlier version applies revision 4 in order; and an install already
stamped with a later version while the gate was closed still applies it, because none of its
actions is stored yet. As with every revision, a default that collides with a chord the reader
chose is dropped, and once stored the Rotate bindings are the reader's.

The Thumbnails sidebar re-renders a page's thumbnail whenever its Page Rotation changes (a
rotation or its undo/redo): the rendering state carries each page's live rotation
(`DocumentRenderingState.pageRotations`), and the Thumbnails view re-renders only the pages
whose rotation differs from the last refresh.
