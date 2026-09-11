# Desktop adapter verification

Issue #39 verifies that platform adapters preserve the same Document Intake, Reading Session,
Reader Action, and Document Query behavior on macOS, Windows, and Linux. Platform branching must
remain in the adapters listed below; it must not enter those domain modules.

The focused repair evidence and pending native matrix for issue #52 are recorded in
[`issue-52-verification.md`](issue-52-verification.md).

## EmbedPDF migration

The earlier evidence applies to the retired PDF.js reader at its recorded revision and is not
proof for the replacement engine. Issue #66 makes pinned EmbedPDF 2.15.0 the only production
viewer and removes the build-time engine/editing gates. Record the exact revision and artifact
for every new verification pass.

The Linux frontend CI job runs `npm run test:embedpdf-offline` after installing Chromium. That
check exercises local WASM/fonts, rendering, navigation, zoom, page-link interception, annotations,
saving, recovery, and print preparation. It does not replace packaged desktop or cross-reader
evidence.

Re-run the platform smoke matrix using release-candidate artifacts. It must cover native
annotation Save/Save As and reopen, failed/conflicting writes, Save/Discard/Cancel
on close and Quit, crash recovery, protected PDFs, unsaved-annotation printing, and offline
operation. Native annotation round trips with Preview and Acrobat are separate acceptance
evidence. All of these migration-specific packaged checks remain pending; see the
[engine migration review](pdf-engine-review-2026-09-09.md).

## Automated contract gate

The `CI` workflow runs the complete TypeScript and Rust suites on `macos-latest`,
`windows-latest`, and `ubuntu-latest`. A change is not desktop-verified until all six matrix jobs
pass.

The suites cover these repeatable adapter checks:

| Capability | Automated seam |
| --- | --- |
| File-dialog and multi-file intake | Rust dialog authorization plus TypeScript Document Intake outcome coverage |
| Drag-and-drop | Rust dropped-path authorization plus TypeScript Tauri drag/drop routing |
| OS open/file association | Rust opened-URL payload creation plus TypeScript external-open routing |
| Command-line intake and page targeting | Rust CLI payload parsing plus TypeScript startup restoration and page-scoping coverage |
| Main-window close and whole-app Quit | TypeScript awaited-flush guards plus Rust exit interception |
| Auxiliary-window close | TypeScript window-scoped close guard |
| Printing | Shared in-memory/browser print contract plus Reader Action routing |
| External links | Shared in-memory/Tauri contract plus Rust URL-policy tests |
| Restoration and concurrency regressions | Document Intake, Reader Actions, Reading Session, and startup-restoration suites |

## Platform smoke record

For release candidates, record one native packaged-app pass per platform. Use two valid PDFs, one
invalid or missing PDF path, and one encrypted PDF. Link the CI run and release artifact used.

| Check | macOS | Windows | Linux |
| --- | --- | --- | --- |
| CI run and artifact | Pending | Pending | Pending |
| Multi-select file dialog opens valid PDFs and reports the invalid path once | Pending | Pending | Pending |
| Drag-and-drop opens valid paths and reports a mixed invalid path independently | Pending | Pending | Pending |
| OS file association opens valid paths and reports a mixed invalid path independently | Pending | Pending | Pending |
| CLI opens valid paths after an invalid first path; `--page` is not transferred | Pending | Pending | Pending |
| Main-window close waits for a final flush | Pending | Pending | Pending |
| Application Quit waits for a final flush | Pending | Pending | Pending |
| Closing Settings leaves the main window and Reading Session active | Pending | Pending | Pending |
| Print opens the native print flow for the active Document | Pending | Pending | Pending |
| HTTPS, HTTP, and mail links open; unsafe schemes remain blocked | Pending | Pending | Pending |
| Encrypted restoration can succeed or cancel without persisting a password | Pending | Pending | Pending |

Record the tester, date, OS version, CI URL, artifact identifier, and any failure details in each
completed cell or in a linked issue comment. Do not mark a platform complete from another
platform's result.

## Intentional platform differences

- macOS receives operating-system file-open requests through Tauri's `Opened` run event.
- Windows and Linux receive subsequent command-line/file-association requests through the Tauri
  single-instance plugin.
- All three paths produce the same ordered external-open payload consumed by Document Intake.
- Printing uses the webview's hidden PDF frame and therefore delegates the final dialog and print
  lifecycle to the platform webview.
- Window show, focus, and unminimize calls stay in the Tauri adapter. Reading Session, Reader
  Actions, and Document Intake contain no operating-system branches.
