# Issue 66 EmbedPDF completion verification

Date: 2026-09-15

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

## Automated evidence

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

## Release-candidate packaging evidence

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

## Evidence invalidation

Any later code change that touches the behavior covered by an evidence row invalidates that row.
Re-run affected rows against a new release candidate; unaffected rows keep their existing evidence
with the original revision noted. If an Annotation tool is disabled after a failed round trip,
re-run only the annotation, save, and interoperability rows.

## Native workflow matrix

No cell below is complete without tester, date, OS/application versions, CI run, artifact, and
observed outcome. Existing slice-specific records are useful context but do not replace a final
release-candidate pass.
Use the [release-candidate test runbook](release-candidate-test-runbook.md) for the fixture and
step mapping for every row.

| Workflow | macOS | Windows | Linux |
| --- | --- | --- | --- |
| Native intake methods and canonical deduplication | Pending | Pending | Pending |
| Ordered Documents and Reading Session restoration | Pending | Pending | Pending |
| Search, outline, thumbnails, and links | Pending | Pending | Pending |
| Reading Position, Visual State, filters, presets, and shortcuts | Pending | Pending | Pending |
| All enabled annotation tools and undo/redo | Pending | Pending | Pending |
| Save/Save As, aliases, open destinations, and external conflicts | Pending | Pending | Pending |
| Edits during save plus failed or uncertain writes | Pending | Pending | Pending |
| Close/Quit Save, Discard, Cancel, and cancellation recovery | Pending | Pending | Pending |
| Crash Recovery Draft offer, restore, discard, and stale-source handling | Pending | Pending | Pending |
| Unsaved-annotation printing without viewing transforms | Pending | Pending | Pending |
| Restricted, signed, and encrypted Documents | Pending | Pending | Pending |
| Offline runtime, required fonts, and enabled tools without CDN requests | Pending | Pending | Pending |

## Interoperability matrix

Enabled creation tools are highlight and text comment. Both directions must preserve native,
non-flattened annotations and unrelated unsupported content.
Use the same [release-candidate test runbook](release-candidate-test-runbook.md) for each complete
external-reader round trip.

| Round trip | Highlight | Text comment | Unsupported content | Saved/printed transforms |
| --- | --- | --- | --- | --- |
| Monight to Preview to Monight, including re-edit/delete/re-save | Pending | Pending | Pending | Pending |
| Preview to Monight to Preview, including re-edit/delete/re-save | Pending | Pending | Pending | Pending |
| Monight to Acrobat to Monight, including re-edit/delete/re-save | Pending | Pending | Pending | Pending |
| Acrobat to Monight to Acrobat, including re-edit/delete/re-save | Pending | Pending | Pending | Pending |

## Existing focused records

- [`issue-60-save-verification.md`](issue-60-save-verification.md)
- [`issue-61-close-quit-verification.md`](issue-61-close-quit-verification.md)
- [`issue-64-protected-document-verification.md`](issue-64-protected-document-verification.md)
- [`issue-65-print-verification.md`](issue-65-print-verification.md)

These records identify earlier automated and native observations. Issue #66 remains incomplete until
the final packaged matrix and Preview/Acrobat matrix above contain actual evidence.

The [2026-09-11 migration completion review](embedpdf-migration-review-2026-09-11.md) checks the
#56–#66 diff against #55 and lists what remains before #66 can be accepted.

The [desktop adapter verification record](desktop-adapter-verification.md#intentional-platform-differences)
documents why the main window is intentionally shown and focused before Reading Session
restoration, and why an early Quit skips that show.
