# Issue 66 EmbedPDF completion verification

Evidence reconciled: 2026-10-20 for [#81](https://github.com/ssword/Monight/issues/81).
The original automated/packaging baseline below is dated 2026-09-15.

The historical release candidate is `fd76e86f64300de7a9ff06a0c9dfbc5d8cd12514`
(Monight 2.0.0). The later Acrobat/print observations use Monight 0.6.0 local
release-profile candidates at annotation revision `6455d8f`, printing revision
`8401014`, and final Popup-cleanup revision `c2d1c8d4a33f6cda7f753bdd221c137c0998d6be`.
They were merged into `develop` at `38be53e2356e51ae53a9103535faeb944b85029a` through
[PR #89](https://github.com/ssword/Monight/pull/89). Exact candidate checksums and
CI/packaging runs appear below and in the [Acrobat record](issue-80-acrobat-verification.md).
These version numbers identify different artifacts; the 2.0.0 artifact is not evidence
for the later 0.6.0 fixes.

No tool was disabled or newly enabled. Annotation/save/Acrobat rows were re-run
through #80 after geometry, empty-form, printing, and Popup fixes. Preview rows were
not re-run against that final candidate. The complete packaged-app runbook was not
executed in this reconciliation; its unrecorded checks are explicitly dated below.
This documentation close-out does not establish release acceptance for parent
[#68](https://github.com/ssword/Monight/issues/68).

## Implemented migration

- Pinned EmbedPDF 2.15.0 is the only production document surface. The build-time viewer and
  native-editing gates are removed.
- Native PDF safety inspection, Save/Save As, Recovery Drafts, and annotated printing are composed
  for every application start. A failed safety inspection keeps the Document read-only.
- PDF.js, its worker/dependency wiring, the PDF.js rendering/content adapters, the duplicate search
  and document-sidebar UI, and the permanent Monight annotation authority/store are removed.
- Legacy annotation values are not imported into PDFs and are not deleted. Existing migration logic
  leaves the legacy value in `settings.json` without exposing a cleanup path.
- Reading Session, Recent Document, filters, presets, presentation, and configurable Reader Action
  shortcuts remain owned by their existing modules. Find opens EmbedPDF's ready-made search panel.

## Historical automated evidence (2026-09-15)

Release-candidate revision:
[`fd76e86f64300de7a9ff06a0c9dfbc5d8cd12514`](https://github.com/ssword/Monight/commit/fd76e86f64300de7a9ff06a0c9dfbc5d8cd12514).
This is the `develop` commit containing the Document Intake consolidation, both EmbedPDF surface
decomposition slices, the release-candidate packaging workflow, and the tester kit.

CI run:
[`34864785777`](https://github.com/ssword/Monight/actions/runs/34864785777). The run passed every
macOS, Windows, and Linux job, including Linux offline Chromium contracts, npm audit, RustSec, and
the repository security audit.

| Check | Result |
| --- | --- |
| `npm run lint` | Pass on macOS, Windows, and Linux; 135 files checked on each platform |
| `npm run build` | Pass on macOS, Windows, and Linux; 75 modules transformed on each platform |
| `npm test` | Pass on macOS, Windows, and Linux; 353 tests in 42 files on each platform |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Pass; 63 tests on macOS and Linux, 62 on Windows (one Unix-only test is conditionally excluded) |
| `npm run test:embedpdf-offline` | Pass on Linux Chromium: offline rendering, Reading Session, protected/native annotated printing, and navigation contracts |
| `npm audit --audit-level=high` | Pass; 0 vulnerabilities |
| Rust dependency audit | Pass; 0 vulnerabilities (informational dependency warnings do not fail the configured audit) |

## Historical release-candidate packaging evidence (2026-09-15)

The manually dispatched `Release Candidate` workflow passed on all three platforms before its
bundles were selected for the native matrix. The initial successful workflow-validation run is
packaging evidence only; the second successful dispatch is the release candidate.

| Evidence | Result |
| --- | --- |
| Workflow-validation run | [`34865827344`](https://github.com/ssword/Monight/actions/runs/34865827344); `macos-fd76e86`, `windows-fd76e86`, `linux-fd76e86`; all three jobs passed; not the release candidate |
| Release-candidate run | [`34867012199`](https://github.com/ssword/Monight/actions/runs/34867012199); all three jobs passed at `fd76e86f64300de7a9ff06a0c9dfbc5d8cd12514` |
| macOS artifact | `macos-fd76e86`: `Monight.app.tar.gz` SHA-256 `25e66d9fee98af77398dadd6262ac12d87758845552fea7ccb43ecd4687c52ff`; `Monight_2.0.0_universal.dmg` SHA-256 `4aa5935f70bafd6a2e298aa244ffd12582859065ad02cbe015f341f23986a18f` |
| Windows artifact | `windows-fd76e86`: `Monight_2.0.0_x64-setup.exe` SHA-256 `400206f5b5673588e80cdbbc000e53a5d5b26e453412790cf549fb32805618c7`; `Monight_2.0.0_x64_en-US.msi` SHA-256 `d0da7f5dce7c2efbc9ce2c70328a4424734a7a235244005e542844c21097ed30` |
| Linux artifact | `linux-fd76e86`: `Monight_2.0.0_amd64.deb` SHA-256 `94947eb038cb318c54923d9734c4e5a08d0089194b501d8a8a412a30546ef0d4`; `Monight-2.0.0-1.x86_64.rpm` SHA-256 `8a7ba35d78f7856008f8ca12b209c63d9be4657c7090498d308e8915aaef1fff`; `Monight_2.0.0_amd64.AppImage` SHA-256 `cda55dde7b6ec5cc32cda785d3523a9a282d78e86d9cb12941362f3f67ca1321` |
| Application and toolchains | Monight 2.0.0; Node.js 24.20.0; npm 11.19.0; rustc 1.98.1 (`48a229cea`, 2026-09-01); Cargo 1.98.1 (`797e8a9bc`, 2026-08-05); Tauri CLI 2.11.2 on every platform |

The seven downloaded bundles were checksummed independently after download; every SHA-256 and byte
size matched its artifact manifest.

## Current code and candidate evidence (2026-10-20)

| Evidence | Result and limit |
| --- | --- |
| Final behavior-changing revision | `c2d1c8d4a33f6cda7f753bdd221c137c0998d6be`; [CI 39443065781](https://github.com/ssword/Monight/actions/runs/39443065781) passed all platform, browser-contract, and dependency-audit jobs |
| Final candidate packaging | [39443061858](https://github.com/ssword/Monight/actions/runs/39443061858) passed macOS, Windows, and Linux packaging; artifacts `macos-c2d1c8d`, `windows-c2d1c8d`, `linux-c2d1c8d`; packaging alone is not a desktop test |
| Observed local macOS candidate | `local-macos-c2d1c8d.app.tar.gz`, SHA-256 `ffd8e6fe7b718343f6a7449f3c6a036b5886f051df8816c4d64c0c7e6619d013`; executable SHA-256 `ebcb2ed694bfd4fdfe11bb78f90ca43d22f6b55e2585ddddb3452b54d4fa0939`; provenance and earlier candidates in [#80 record](issue-80-acrobat-verification.md#environment-and-build-identity) |
| Merged code baseline | `38be53e2356e51ae53a9103535faeb944b85029a`; [CI 39447253352](https://github.com/ssword/Monight/actions/runs/39447253352) passed; incorporates the final code and provenance documents |
| Fresh local review checks on merged baseline | 2026-10-20, Codex, macOS: 75 Rust tests, 100 targeted frontend tests, and `npm run test:embedpdf-offline` passed, including both external-reader contracts and Chromium/WebKit wheel scrolling; the Preview geometry known failure is still reported |

The final #81 documentation commit and its CI run are linked from the tracker
comments on #55 and #66 after CI completes. Those comments identify the documentation
revision separately from the observed application candidates; documentation changes
here do not invalidate the existing behavior observations.

## Evidence invalidation

Any later code change that touches the behavior covered by an evidence row invalidates that row.
Re-run affected rows against a new release candidate; unaffected rows keep their existing evidence
with the original revision noted. If an Annotation tool is disabled after a failed round trip,
re-run only the annotation, save, and interoperability rows.

## Native workflow matrix

Each cell records the evidence audit on 2026-10-20. “Not executed” means the
complete packaged runbook was not executed in this reconciliation and no adequate
record was found in the repository or #76–#78 comments. It does not assert that nobody
ever tried the workflow. Checked boxes and closed tracker state supply no missing
provenance. Partial observations remain linked rather than promoted to a full pass.
Use the [release-candidate test runbook](release-candidate-test-runbook.md) for reruns.

| Workflow | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Native intake methods and canonical deduplication | Not executed (2026-10-20): no complete intake/deduplication runbook record | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Ordered Documents and Reading Session restoration | Not executed (2026-10-20): no complete restoration runbook record | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Search, outline, thumbnails, and links | Not executed (2026-10-20): no complete navigation runbook record | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Reading Position, Visual State, filters, presets, and shortcuts | Not executed (2026-10-20): no complete preferences/shortcuts runbook record; transform observations only in [M](#matrix-evidence-scope) | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| All enabled annotation tools and undo/redo | Not executed (2026-10-20): undo/redo runbook not recorded; native Highlight/Text creation/edit/delete observed in [M](#matrix-evidence-scope) | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Save/Save As, aliases, open destinations, and external conflicts | Not executed (2026-10-20): full alias/open-destination runbook not recorded; ordinary Save/Save As observed in [M](#matrix-evidence-scope), conflict recovery fails [#91](https://github.com/ssword/Monight/issues/91) | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Edits during save plus failed or uncertain writes | Not executed (2026-10-20): full delayed/uncertain-write runbook not recorded; external-conflict failure observed in [#91](https://github.com/ssword/Monight/issues/91) | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Close/Quit Save, Discard, Cancel, and cancellation recovery | Not executed (2026-10-20): no complete native close/Quit decision record | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Crash Recovery Draft offer, restore, discard, and stale-source handling | Not executed (2026-10-20): no complete crash/relaunch runbook record; conflict/Save As recovery failure in [#91](https://github.com/ssword/Monight/issues/91) | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Unsaved-annotation printing without viewing transforms | Not executed (2026-10-20): full CI-bundle runbook not executed; local candidate native panel/output and retained unsaved/source state verified in [M](#matrix-evidence-scope) | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Restricted, signed, and encrypted Documents | Not executed (2026-10-20): full protected/password-privacy runbook not recorded; unsupported Ink read-only block and permitted printing observed in [M](#matrix-evidence-scope) | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |
| Offline runtime, required fonts, and enabled tools without CDN requests | Not executed (2026-10-20): no OS-network-disabled desktop/fallback-glyph runbook record | Not executed (2026-10-20): no Windows desktop record supplied ([W](#matrix-evidence-scope)) | Not executed (2026-10-20): no Linux desktop record supplied ([L](#matrix-evidence-scope)) |

### Matrix evidence scope

- **M — macOS partial observations:** Codex with owner assistance, 2026-10-20,
  macOS 27.0.1 (26A434), Monight 0.6.0, Acrobat Reader 26.002.21901. The
  [#80 record](issue-80-acrobat-verification.md) identifies the local release-profile
  artifacts and their checksums, source revisions, CI, packaging, actual operations,
  and failures. Neither the downloaded universal CI bundle nor a complete twelve-row
  packaged run was tested. These observations support the named subset only.
- **W — Windows:** #77 is closed with checked boxes but no comments or linked
  execution evidence. No native OS/application version, tester, installed artifact,
  installer-format smoke result, or workflow outcomes were supplied. CI and packaging
  success do not fill those gaps.
- **L — Linux:** #78 is likewise closed without execution evidence. No native
  distribution/application version, tester, installed package, alternate-format smoke
  result, or workflow outcomes were supplied. Linux browser contracts and packaging
  success do not demonstrate WebKitGTK desktop behavior.

## Interoperability matrix

Enabled creation tools are highlight and text comment. Both directions must preserve native,
non-flattened annotations and unrelated unsupported content.
Use the same [release-candidate test runbook](release-candidate-test-runbook.md) for each complete
external-reader round trip.

| Round trip | Highlight | Text comment | Unsupported content | Saved/printed transforms |
| --- | --- | --- | --- | --- |
| Monight to Preview to Monight, including re-edit/delete/re-save | Agent-operated installed-build check passed repeated highlight edits/deletion; candidate provenance unverified ([record](issue-75-preview-verification.md)) | Failed, 2026-10-20: Preview note editor did not open; deletion worked; tracked by [#94](https://github.com/ssword/Monight/issues/94) ([record](issue-75-preview-verification.md)) | Preview Rectangle fixture blocked read-only with explicit explanation ([record](issue-75-preview-verification.md)) | Saved output upright/unfiltered; historical no-panel failure fixed by [#88](https://github.com/ssword/Monight/issues/88); Preview inspection of printed output not executed (2026-10-20): no rerun recorded ([record](issue-75-preview-verification.md)) |
| Preview to Monight to Preview, including re-edit/delete/re-save | Agent-operated installed-build check passed native comment edits and re-save; candidate provenance unverified ([record](issue-75-preview-verification.md)) | Failed, 2026-10-20: Preview note editor did not open after Monight save; Rect shrank 24 to 20 points; tracked by [#94](https://github.com/ssword/Monight/issues/94) ([record](issue-75-preview-verification.md)) | Preview Rectangle fixture blocked read-only with explicit explanation ([record](issue-75-preview-verification.md)). Automated by #79: safety inspection and native Save refuse it with `Unsupported embedded annotations; saving is blocked`; current policy blocks `/Square`; maintainer disposition of blocking versus preservation is not recorded | Saved output upright/unfiltered; historical no-panel failure fixed by [#88](https://github.com/ssword/Monight/issues/88); Preview inspection of printed output not executed (2026-10-20): no rerun recorded ([record](issue-75-preview-verification.md)) |
| Monight to Acrobat to Monight, including re-edit/delete/re-save | Fresh local candidate UI creation with Guest author; repeated Acrobat/Monight edits, saves, Acrobat deletion, and Monight reopen verified | Fresh Guest Text created through UI; repeated in-place edit/save/delete/reopen verified by stable ID; earlier reply attempt excluded | Acrobat Ink companion blocked read-only; canonical fixture and native safety contract registered | Fixed local Save As and final native printed PDF upright/unfiltered in Acrobat; print includes unsaved markup and retains dirty/source state |
| Acrobat to Monight to Acrobat, including re-edit/delete/re-save | Newly Acrobat-created object edited/saved in Monight; Acrobat re-edit/delete/save verified by stable ID, Monight reopened deletion; Monight deletion also verified in Acrobat after [#92](https://github.com/ssword/Monight/issues/92) Popup cleanup; shared native contracts pass | [#86](https://github.com/ssword/Monight/issues/86)/[#87](https://github.com/ssword/Monight/issues/87) fixed in merged PR #89; 24pt Rect retained through desktop Save and Acrobat re-edit; deletion and Monight reopen verified | Same supported source plus one native Ink stroke; explicit read-only block verified by shared contract | Fixed local Save As and final native print upright/unfiltered; [#88](https://github.com/ssword/Monight/issues/88) fixed in merged PR #89, including unsaved markup; [#91](https://github.com/ssword/Monight/issues/91) records unresolved conflict/recovery cleanup failure |

Acrobat observations: 2026-10-20, Codex with owner assistance, macOS 27.0.1 (26A434),
Acrobat Reader 26.002.21901. These are installed/local-build observations, not a
downloaded-CI-artifact pass. Exact local candidate binary identities, green final-code CI and candidate packaging links, fixtures,
steps, failures, and execution limits are in the [issue-80 record](issue-80-acrobat-verification.md).

Preview observations: 2026-10-20, Codex, macOS 27.0.1 (26A434), Preview 11.0,
installed Monight 0.6.0; executable SHA-256
`1b9e65f923bcce09738d05d523fe3c4018b8e12c37948c0e13e855d91c5f4ef2`.
Source/CI provenance was not established. Both directions retain the original
observations and limits in the [#75 record](issue-75-preview-verification.md).
The automated known-geometry-failure registration is not a passing native-note round trip.

## Failure disposition and tracker state

| Failure | Current disposition |
| --- | --- |
| Preview Text editor/geometry | [#94](https://github.com/ssword/Monight/issues/94) open; #75 closed at maintainer request after fixture preparation, with failures explicitly retained; no successful final-candidate Preview rerun |
| Acrobat Text geometry | [#86](https://github.com/ssword/Monight/issues/86) completed; `6455d8f`, actual 24pt geometry and edit/delete/reopen observed |
| Acrobat empty form scaffolding | [#87](https://github.com/ssword/Monight/issues/87) completed; `6455d8f`, conservative safety policy and real fixture verified |
| macOS native print panel | [#88](https://github.com/ssword/Monight/issues/88) completed; `8401014`, local native panel and output verified; no Windows/Linux desktop print inference |
| Conflict → Save As Recovery Draft rebase | [#91](https://github.com/ssword/Monight/issues/91) open; destination written but identity/recovery completion failed; not an accepted Save As result |
| Deleted Acrobat comments via orphan Popups | [#92](https://github.com/ssword/Monight/issues/92) completed; `c2d1c8d`, native Save/Save As regression and actual Acrobat deletion verification |

Issues #55 and #57–#66 remain closed and their bodies are unchanged. Their tracker
state records earlier implementation closure; it does not certify the unexecuted
packaged checks or resolve the open failures. Evidence comments on #55 and #66 link
this reconciliation, the observed candidates, CI, packaging, and all failure issues.
The checked boxes on closed platform tickets #76–#78 are not substituted for evidence.

## Existing focused records

- [`issue-60-save-verification.md`](issue-60-save-verification.md)
- [`issue-61-close-quit-verification.md`](issue-61-close-quit-verification.md)
- [`issue-64-protected-document-verification.md`](issue-64-protected-document-verification.md)
- [`issue-65-print-verification.md`](issue-65-print-verification.md)

These records identify earlier automated and native observations. The evidence inventory
for #81 now distinguishes observed, failed, and dated unexecuted work. Release acceptance
under #68 still requires the missing packaged observations and disposition of the open
Preview and conflict/recovery failures; closed #66 is not a declaration of those passes.

The [2026-09-11 migration completion review](embedpdf-migration-review-2026-09-11.md) preserves
the original #56–#66 findings; its dated status note points to the current disposition.

The [desktop adapter verification record](desktop-adapter-verification.md#intentional-platform-differences)
documents why the main window is intentionally shown and focused before Reading Session
restoration, and why an early Quit skips that show.
