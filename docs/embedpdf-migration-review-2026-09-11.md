# EmbedPDF migration completion review — 2026-09-11

Reviewed `develop` at `72db55c` plus the uncommitted worktree changes to `embedpdf-smoke.html`,
`src/application.ts`, `src/embedpdf-smoke.ts`, `src/reader/document-intake.ts`,
`src/styles/reader-shell.css`, and two test files. The comparison is `git diff 921df19...HEAD`,
from immediately before the first EmbedPDF implementation (#56) through the final slice (#66):
232 files, roughly 14k insertions and 10k deletions.

The question under review: does the work from the #55 specification through #66 achieve all of
the stated goals? The review follows two separate axes. **Spec** checks the code and recorded
evidence against #55 and the acceptance criteria of #66. **Standards** checks the diff against
`CONTEXT.md`, the ADRs, and a baseline of code smells. Findings are not merged or ranked across
axes.

## Assessment

The #55 behavior is largely implemented in code, but #66 is not complete. The remaining gaps are
evidence and CI, plus one defect in the protected-document guard. The packaged-app matrix and the
Preview/Acrobat interoperability matrix in `issue-66-verification.md` contain no recorded
evidence, the last CI run on `develop` failed, and the ten commits that finish #65 and #66 have not
been pushed. Issues #57 through #66 remain open on the tracker; only #56 is closed.

## Verification performed

| Check | Result and limit |
| --- | --- |
| `npm test` (with worktree changes) | 40 files, 346 tests passed on this macOS host |
| `npm run lint` | Failed: pre-existing formatting in `design/app-icon-2026/Monight.icon/icon.json` |
| `gh run list` | Last `develop` CI run (2026-09-10, `7c0f964`) failed; see Spec finding 3 |
| `gh issue list` | #55, #57–#66 open; #56 closed |
| Dependency and asset greps | No `pdfjs-dist`, worker wiring, or CDN URLs in `package.json`, `vite.config.ts`, or `src/` |
| Layering greps | No `@tauri-apps` imports under `src/reader/`; `@embedpdf` imports only under `src/app/` and smoke scripts |

No Windows/Linux execution, packaged Tauri interaction, Preview/Acrobat round trip, or native
file-write verification was performed by this review. Slice verification documents were read as
the repository's own claims and checked against the code, not re-executed.

## Spec findings

### Missing or partial

**1. Per-platform packaged-app smoke evidence is empty.**
#66: "Record native packaged-app smoke evidence for each platform, including tester, date, OS and
application versions, CI run, build artifact, and outcomes." `docs/issue-66-verification.md:41-54`
lists 12 workflows across macOS, Windows, and Linux. Every cell is `Pending`.

**2. The Preview/Acrobat interoperability matrix is empty.**
#66: "Consolidate the enabled-tool interoperability matrix for Preview and Acrobat, including both
directions, re-edit/delete/re-save." `docs/issue-66-verification.md:61-66` lists four round-trip
directions; every cell is `Pending`. `docs/issue-63-annotation-tools-and-attribution.md:49-50`
records that no complete Preview round trip exists and Acrobat is not installed. Only `highlight`
and `textComment` are enabled (`src/app/embedpdf-document-surface.ts:60`), which is permitted by
#55 ("Disable individual creation/editing tools that fail those checks"), but even those two
tools lack the required evidence. #55 user stories 4, 21, and 22 are therefore not demonstrated.

**3. CI is failing and the final commits are unpushed.**
#66: "Pass complete TypeScript and Rust CI on macOS, Windows, and Linux." The last CI run on
`develop` (2026-09-10, commit `7c0f964`, run 34424752998) failed. All three TypeScript jobs failed
at the Lint step on `design/app-icon-2026/Monight.icon/icon.json`. The Rust dependency audit failed
on RUSTSEC-2026-0187 (`lopdf` 0.34.0, stack overflow on deeply nested objects; fixed in 0.42.0).
The Rust test jobs passed on all three platforms. Ten commits after `7c0f964`, including #65 and
#66, are ahead of `origin/develop` and have no CI record.

**4. Native evidence for print, close/Quit, and protected documents is still pending.**
#66: "Record actual evidence for native print, Save/Save As, close/Quit, intake, and
protected-document handling. Do not mark pending manual/platform checks complete from mocked
tests." `docs/issue-65-print-verification.md:33` records the native print dialog as blocked.
`docs/issue-61-close-quit-verification.md:31` leaves native close/Quit pending.
`docs/issue-64-protected-document-verification.md:85-86` leaves the packaged matrix pending. Only
`docs/issue-60-save-verification.md:28` records a named macOS observation.

**5. Tracker state does not reflect completion.**
#66: "Verify completion against parent spec #55 without closing or modifying that parent issue."
#57–#66 are still open. Nothing in the repository or tracker records that the intermediate slices
were accepted.

### Implementation that looks wrong

**6. The deep-nesting guard runs after the vulnerable parse.**
#64 commit `c227daa` "fail closed on deeply nested PDFs". The depth limit in
`src-tauri/src/pdf_save.rs:356` is applied while walking dictionaries, but the walk starts from
`lopdf::Document::load_mem` at `pdf_save.rs:393`. RUSTSEC-2026-0187 describes unbounded recursion
inside `load_mem` itself, so a crafted file still aborts the process before the guard runs. The
fix is to upgrade `lopdf` to 0.42.0 or later; the post-parse depth check alone does not close the
issue.

### Not asked for

**7. Window is shown and focused before Reading Session restoration.**
Worktree change at `src/application.ts:634-639` calls `currentWindow.show()` and `setFocus()`
before `setupTauriListeners`. The comment explains EmbedPDF needs a visible WebView to publish
layout frames. #55 and #66 do not request this lifecycle change, and no CI run covers it yet. It
may be a necessary fix, but it should be recorded and tested as such.

### Verified as conforming

- PDF.js runtime, dependency, and worker wiring are gone. `src/__tests__/code-health.test.ts:87-88`
  guards against reintroduction. The only `import.meta.env` use is `DEV` logging; no viewer gate
  remains.
- EmbedPDF 2.15.0 is pinned. WASM and fonts load from `/embedpdf/` (`embedpdf-document-surface.ts:58-59`),
  the stamp library is disabled, and the UI stylesheet URL is `null`.
- Legacy annotation data is preserved: `src/scripts/settings.ts:337` deletes the old `settings`
  key only when no `annotations` value exists. No production code deletes user PDFs.
- Signed, encrypted, and permission-restricted PDFs are read-only with specific reasons
  (`pdf_save.rs:405-420`), matching #55's "Blocking unsafe editing is the specified acceptable
  outcome".
- The Guest attribution default exists (`src/reader/native-pdf-editing.ts:7`) and is exercised
  by the annotation smoke.

## Standards findings

Layering rules from ADR 0002 hold: reader domain modules import no Tauri or EmbedPDF code, and
`src/reader/` uses no glossary-avoided names such as `viewer` or `tab`. The following are
baseline smells and judgement calls, not documented-standard breaches.

### S1 — Duplicated interrupt paths in Document Intake

`src/reader/document-intake.ts:650-660` adds `interrupt()` alongside the existing
`interruptRestoration()`. Both set `restorationInterrupted` and abort a set of controllers; the
new `activeOperations` set is a superset of `activeRestorations`. After the worktree change,
`interruptRestoration()` has no production caller (`src/application.ts:387` and `:517` now call
`interrupt()`); only tests use it. Merge the two into one method and one set.

### S2 — Names no longer honest after reuse

`waitForRestorationWork` and `restorationInterruption` (`document-intake.ts:207-222`) are now
also used on the explicit `open()` path (`document-intake.ts:336-341`). The "restoration" prefix
misdescribes them. Rename to reflect intake work generally.

### S3 — One large surface module with several reasons to change

`src/app/embedpdf-document-surface.ts` is a new 1410-line module holding viewer configuration,
font preloading, rendering, annotation editing, and print preparation. Divergent Change: it will be
edited for unrelated reasons. Consider splitting configuration and font loading from the surface
lifecycle.

## Summary

| Axis | Findings | Most serious |
| --- | --- | --- |
| Spec | 7 (5 missing/partial, 1 wrong, 1 not asked for) | Packaged-app and Preview/Acrobat matrices are empty while CI is failing and final commits are unpushed |
| Standards | 3 judgement calls | Duplicated interrupt path with a dead public method |

## What remains for #66

1. Fix the lint failure in `design/app-icon-2026/Monight.icon/icon.json` and upgrade `lopdf` to
   0.42.0 or later, then push and obtain a green CI run on all three platforms.
2. Execute the packaged-app matrix on macOS, Windows, and Linux and fill every cell of
   `issue-66-verification.md` with tester, date, versions, CI run, artifact, and outcome.
3. Execute the Preview and Acrobat round trips for highlight and text comment in both directions
   and record them; disable either tool if it fails.
4. Record native print, close/Quit, and protected-document observations in the slice documents.
5. Record the window show/focus change as an intended lifecycle behavior and cover it in tests.

Improvement and feature candidates beyond #66 are collected in the
[2026-09-11 improvement backlog](improvement-backlog-2026-09-11.md).
