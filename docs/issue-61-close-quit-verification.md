# Issue #61: unsaved work on close and Quit

Implementation and local verification, 2026-09-09. Scope: [issue #61](https://github.com/ssword/Monight/issues/61), on `develop`, starting at `80207593f277a2ab5529f2abb78f7bdd1a59f3f5`.

## Behavior

Reader Actions owns Save/Discard/Cancel for closing a Document and preparing application shutdown. Toolbar and native close commands use that policy. EmbedPDF's competing document-close controls remain disabled; Monight retains Document tab ownership.

Close decisions serialize, repeated requests coalesce, and existing saves finish before a decision. Save uses the existing native persistence and verification boundary. A failed save offers retry, Save As, Discard, or Cancel; cancelling a destination dialog aborts close. Save As follows the live runtime to its new Document path.

Discard authorizes only the observed runtime and annotation revision. It does not export PDF bytes, write the original, or mark annotations saved. During Quit, Discard decisions are staged: cancelling a later decision preserves the open Documents and edits. Successful saves remain saved. Late edits invalidate teardown authorization.

Native main-window close and application Quit prepare all Documents before flushing Reading Session and other automatic persistence. Cancellation resumes Document Intake and interaction. Settings-window close remains independent. Clean and edited closes both coalesce and reject stale runtime generations, including close/reopen races.

## Automated verification

- `npm test`: 52 files, 428 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 48 tests passed, including real native filesystem save contracts and native Quit handshake tests.
- `npm run build`: TypeScript and Vite build passed; existing large-chunk warning remains.
- `npm run lint`: passed.
- TDD and regression coverage at Reader Actions, Document workspace, dialog, and lifecycle seams includes cancellation, Save errors/retry, Save As cancellation/identity, multiple edited Documents, repeated mixed requests, delayed writes, edits arriving during Save/Discard, stale viewer callbacks, clean close/reopen generations, and restored usability.

Code review used separate Standards and Spec reviewers. Standards reported no findings. Spec identified a clean-close generation race; it was reproduced, fixed, regression-tested, and re-reviewed with no remaining actionable implementation findings.

## Historical native verification attempt (2026-09-09)

Host: macOS 26.6.2 (25G83), Tauri 2.11.2, application version 2.0.0. A development-gated macOS debug bundle built successfully using `VITE_PDF_SURFACE=embedpdf VITE_NATIVE_PDF_EDITING=1` and the isolated identifier `art.monight.issue61`.

Desktop automation timed out (`-10005: timeoutReached`) when accessing both the normal and isolated native app, including selection by the isolated bundle identifier. No native Save/Discard/Cancel outcome was observed. The test processes were stopped. The bundle build preceded the final clean-close race fix and is not final-build acceptance evidence.

That attempt did not demonstrate native close/Quit on macOS or packaged behavior on Windows/Linux. Run the existing desktop matrix with two edited fixture PDFs: cancel window close and Quit, continue editing/opening/navigating, retry with Save and Discard, cancel Save As, exercise repeated mixed requests, and close Settings independently. The development gates described above were subsequently removed by #66; this historical attempt and substitute-adapter tests do not establish native acceptance.


## Reconciled native status — 2026-10-20 (#81)

Not executed in this reconciliation on macOS, Windows, or Linux: the complete native
Save/Discard/Cancel, failed-save retry, cancelled Save As, continued usability, multi-Document
Quit, and Settings independence runbook has no supplied execution record. The closed
#76–#78 checklists contain no evidence comments. See the
[consolidated matrix and per-platform limits](issue-66-verification.md#native-workflow-matrix).

ADR 0002 was amended on 2026-10-20 to save annotations automatically after edits and
again on close/Quit. Save/Save As/Discard/Cancel choices are required when automatic
saving fails. The behavior section above describes the original explicit-save design;
future native runs must exercise the current automatic-save failure paths rather than
expect a prompt after every ordinary edited close. #80's annotation/print observations
do not constitute a close/Quit acceptance pass.
