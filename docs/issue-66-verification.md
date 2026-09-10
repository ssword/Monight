# Issue 66 EmbedPDF completion verification

Date: 2026-09-10

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

Run from the repository root at the final issue #66 commit:

| Check | Result |
| --- | --- |
| `npm run build` | Pass locally on macOS; 69 modules transformed |
| Focused migration contract tests | Pass locally on macOS; 77 tests |
| `npm run lint` | Application files pass; repository check is blocked by pre-existing formatting in `design/app-icon-2026/Monight.icon/icon.json` |
| `npm test -- --run` | Pass locally on macOS; 345 tests in 40 files |
| `npm run test:embedpdf-offline` | Pass locally on macOS; rendering, Reading Session, native annotated printing, and navigation contracts |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml` | Pass locally on macOS; 63 tests |

The repository CI runs TypeScript and Rust checks on macOS, Windows, and Linux, plus the real
EmbedPDF Chromium runtime check on Linux. A local pass is not evidence that those remote jobs or
packaged applications passed.

## Native workflow matrix

No cell below is complete without tester, date, OS/application versions, CI run, artifact, and
observed outcome. Existing slice-specific records are useful context but do not replace a final
release-candidate pass.

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
