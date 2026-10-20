# Desktop adapter verification

Issue #39 verifies that platform adapters preserve the same Document Intake, Reading Session,
Reader Action, and Document Query behavior on macOS, Windows, and Linux. Platform branching must
remain in the adapters listed below; it must not enter those domain modules.

The historical focused repair evidence and unexecuted native matrix for issue #52 are recorded in
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
evidence. The [consolidated matrices and candidate identities](issue-66-verification.md)
were reconciled on 2026-10-20 for #81. macOS has identified local release-profile
observations for native Highlight/Text round trips, ordinary Save/Save As, unsupported
Ink protection, and native PDFKit printing with unsaved annotations and no viewing
transforms ([#80 record](issue-80-acrobat-verification.md)). A complete downloaded-CI-bundle
runbook is not demonstrated. Windows and Linux have green automated and packaging
runs but no supplied native execution records. Preview Text interoperability and
conflict/Save As recovery remain open as [#94](https://github.com/ssword/Monight/issues/94)
and [#91](https://github.com/ssword/Monight/issues/91).

Release candidates come from the manually dispatched `Release Candidate` GitHub Actions workflow.
It produces unsigned macOS, Windows, and Linux artifacts without creating a tag or GitHub release.
Every completed evidence cell must cite the workflow run URL, the platform artifact name, and the
SHA-256 checksum from that artifact's `manifest.txt` file.
Execute these cells with the concrete steps and fixture mapping in the
[release-candidate test runbook](release-candidate-test-runbook.md).

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
| Printing | Reader Action routing, macOS PDFKit preparation/native adapter contracts, and browser fallback contract |
| External links | Shared in-memory/Tauri contract plus Rust URL-policy tests |
| Restoration and concurrency regressions | Document Intake, Reader Actions, Reading Session, and startup-restoration suites |

## Platform smoke record

For release candidates, record one native packaged-app pass per platform. Use two valid PDFs, one
invalid or missing PDF path, and one encrypted PDF. Link the CI run and release artifact used.

Evidence audit date: 2026-10-20. “Not executed” records the complete smoke check
not run in this reconciliation, with no supporting execution record supplied; it
is not a pass. Closed #76–#78 checklists have no evidence comments. Full per-platform
limits are in the [matrix evidence scope](issue-66-verification.md#matrix-evidence-scope).

| Check | macOS | Windows | Linux |
| --- | --- | --- | --- |
| CI run and artifact | Local candidate only: [revision, archive/executable checksums, CI and packaging](issue-66-verification.md#current-code-and-candidate-evidence-2026-10-20); downloaded CI-bundle smoke not executed (2026-10-20): no run recorded | CI/packaging passed; installed-artifact check not executed (2026-10-20): no Windows desktop record ([candidate](issue-66-verification.md#current-code-and-candidate-evidence-2026-10-20)) | CI/packaging passed; installed-artifact check not executed (2026-10-20): no Linux desktop record ([candidate](issue-66-verification.md#current-code-and-candidate-evidence-2026-10-20)) |
| Multi-select file dialog opens valid PDFs and reports the invalid path once | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| Drag-and-drop opens valid paths and reports a mixed invalid path independently | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| OS file association opens valid paths and reports a mixed invalid path independently | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| CLI opens valid paths after an invalid first path; `--page` is not transferred | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| Main-window close waits for a final flush | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| Application Quit waits for a final flush | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| Closing Settings leaves the main window and Reading Session active | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| Print opens the native print flow for the active Document | Observed, 2026-10-20: local release-profile candidate opens Print/Cmd+P panels, including permitted read-only input; saved output includes unsaved markup without viewing transforms; source/dirty state retained ([tester, versions, checksums and runs](issue-80-acrobat-verification.md)); CI-bundle rerun not executed: no run recorded | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| HTTPS, HTTP, and mail links open; unsafe schemes remain blocked | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |
| Encrypted restoration can succeed or cancel without persisting a password | Not executed (2026-10-20): no complete native smoke record supplied | Not executed (2026-10-20): no Windows desktop record supplied | Not executed (2026-10-20): no Linux desktop record supplied |

Record tester, date, OS/application version, CI URL, artifact identifier/checksum,
and observed outcome for each future execution. A platform remains unverified until
its own native record exists. The local macOS print observation covers that subset
and does not supply the remaining smoke outcomes.

## Intentional platform differences

- macOS receives operating-system file-open requests through Tauri's `Opened` run event.
- Windows and Linux receive subsequent command-line/file-association requests through the Tauri
  single-instance plugin.
- All three paths produce the same ordered external-open payload consumed by Document Intake.
- macOS sends current prepared PDF bytes to PDFKit in memory on the main thread for the native
  print panel. PDF permissions are checked again, and visible supported markup receives a print
  flag only in the separate in-memory print document. Windows and Linux retain the hidden PDF
  frame/browser print adapter; their native desktop print flows remain unverified here.
- Window show, focus, and unminimize calls stay in the Tauri adapter. The main window is shown and
  focused before Reading Session restoration because EmbedPDF publishes layout frames only from a
  visible WebView; the splash remains interactive while restoration continues. An early Quit skips
  the show. Reading Session, Reader Actions, and Document Intake contain no operating-system
  branches.
