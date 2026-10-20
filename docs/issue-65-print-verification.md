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

A debug DMG built successfully before the final issue #66 switch with:

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


## Native macOS verification, 2026-10-20 (#80 / #88)

The earlier packaged initialization blocker is superseded by actual native printing
in a local release-profile app. The browser iframe's print call produced no dialog
on macOS; the adapter now uses PDFKit with the current prepared bytes in memory.
Visible supported markup is included even when its PDF Print flag is absent, without
changing source flags or exposing hidden objects. Other platforms keep browser printing.

The tester (Codex with owner assistance for Acrobat mouse actions) used macOS 27.0.1
(26A434), Acrobat Reader 26.002.21901, and local app executable SHA-256
`629b971b1028091c381770fcda9fa0d7ea7694d5f7580bdfce411d67d7f2e888`.
Print and Cmd+P opened native three-page panels. PDF output under Sepia, 150% zoom,
and 90-degree viewing rotation was upright and unfiltered in Acrobat and PDFium.
A new unsaved lower-line Highlight appeared in the print but not the source; source
bytes and the dirty indicator remained unchanged. A permitted read-only Ink companion
also opened the native print panel, with Save still blocked after Cancel.

Two real PDFKit tests cover visible/hidden markup flags, unchanged input bytes,
invalid/locked input rejection, and permitted read-only input. Three frontend adapter
tests cover current-byte handoff, native errors, and the other-platform fallback.
Full provenance, output names, source-conflict setup, and the separate #91 recovery
cleanup failure are in [the issue-80 record](issue-80-acrobat-verification.md).
These are identified local candidate results, not a downloaded universal CI-bundle test.
