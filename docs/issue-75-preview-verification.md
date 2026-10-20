# Issue #75: agent-operated Preview verification

Observation date: 2026-10-20 (Asia/Shanghai). The user explicitly requested computer
control to perform the previously human-only steps and prepare the files for #79.
Operator: Codex using native computer control. This record does not claim human sign-off.

## Build identity

| Required evidence | Actual value |
| --- | --- |
| OS | macOS 27.0.1, build 26A434 |
| Preview | 11.0 |
| Monight | Installed `/Applications/Monight.app`, 0.6.0 |
| Executable SHA-256 | `1b9e65f923bcce09738d05d523fe3c4018b8e12c37948c0e13e855d91c5f4ef2` |
| Candidate revision | Not established for the installed binary; checkout was `d07ae55264ba802d62131cfc7deb6f9b764c2935` |
| CI run, packaging run, artifact checksum | Not established; no verified CI artifact was installed or downloaded in this session |
| Result | Failures reproduced; not a release-candidate acceptance pass |

The historical candidate at `fd76e86` predates relevant save fixes. Its version,
artifact name, and checksum must not be attached to these observations.

## Observations

| Direction | Highlight | Text comment | Unsupported content | Saved/printed transforms |
| --- | --- | --- | --- | --- |
| Monight to Preview to Monight, repeated saves | Guest native Highlight selected, edited in Preview, re-edited/saved in Monight, reopened/edited/deleted/saved in Preview; native values retained | Guest native Text appeared in Preview's list and could be deleted, but opening its text editor failed; full editable round trip fails | Separate Preview Rectangle fixture was opened and blocked by Monight with explicit unsupported-content reason | Save As under Sepia, 150% zoom, and 90-degree viewing rotation opened upright/unfiltered in Preview. Print button and Cmd+P produced no print dialog; print output unverified |
| Preview to Monight to Preview | Preview native Highlight appeared with expected author/contents; Monight edited/saved it; Preview re-edited/saved it | Preview native Text was initially editable in Preview, editable in Monight, but its editor no longer opened in Preview after Monight save. Its Rect also shrank from 24 by 24 to 20 by 20 points. Preview deletion worked | With `/Square`, Monight showed `Unsupported embedded annotations; saving is blocked`, disabled Save/Save As, and did not overwrite the input | Same independently saved output inspected in Preview; no printed PDF could be produced |

Native PDF inspection with pypdf confirmed actual `/Highlight`, `/Text`, `/Link`,
`/Popup`, and `/Square` objects. The supported Monight export retained exact decoded
page-content checksums on all three pages, page text, outline, document metadata,
and both original Links. Visible deletion leaves some Popup entries; do not assert
that deleting visible markup removed every Annotation dictionary.

See the [fixture provenance](../src-tauri/tests/fixtures/external/README.md) for exact
operations. Seven intermediate PDFs and rendered QA images are retained outside Git in
the repository-relative archive `artifacts/issue-75/2026-10-20/`, alongside a complete
nine-file inventory. The [versioned input inventory](../src-tauri/tests/fixtures/external/manifest.json)
records checksums, native geometry, author, contents, unrelated content, and a reader
registration ready for #79. These are real external saves; none was synthesized using
pypdf. The automated #79 Rust and Chromium contracts are described in the
[fixture README](../src-tauri/tests/fixtures/external/README.md#automated-contracts-79).

## File-preparation checks

- Verified all nine PDF sizes and SHA-256 checksums against the inventory, unique
  externally authored annotation selectors, presence of `/Square` in the unsupported
  input, and absence of visible Highlight/Text markup in the final deletion output.
- Compared supported input and Monight export: all page-content checksums, page text,
  MediaBoxes, rotations, outline, metadata, and original Link targets/geometry matched.
- Reviewed all 27 pages rendered by bundled PDFium. Poppler also rendered both canonical
  Preview inputs; it timed out on the intermediate exports, so PDFium supplied their
  visual inspection. All PDFs retain readable, upright fixture content. The unsupported
  rectangle intentionally covers part of the lower text; it is preserved as authored.
- `npm test -- src/__tests__/tester-kit.test.ts`: 2 tests passed.
- Biome check of `manifest.json` and `git diff --check`: passed.
- During the commit review, corrected an inventory-script truthiness error that had
  hashed empty bytes instead of the decoded page streams. Recomputed all nine files'
  page-content hashes using `content is not None` and confirmed that actual streams
  match between the supported Preview input and Monight export on all three pages.
- No product code changed; the full frontend/Rust/offline suites and CI were not run
  for this fixture-preparation change. These checks are not #79 contract completion.

## Recorded failures and follow-up

Status reconciled 2026-10-20 for #81: #75 was closed at the maintainer's explicit
request after testing/fixture preparation ([closure comment](https://github.com/ssword/Monight/issues/75#issuecomment-6286913129)).
That disposition did not accept the failed note behavior. The editor and geometry
symptoms below remain tracked in [#94](https://github.com/ssword/Monight/issues/94);
no final-candidate Preview rerun or core-tool disablement is recorded. The historical
no-dialog print failure was fixed separately as [#88](https://github.com/ssword/Monight/issues/88)
through PR #89, with Acrobat/PDFium output inspection. It does not supply the missing
Preview round-trip or Preview inspection of printed output.

### Preview text comments cannot be re-edited after Monight save

Reproduce with `external/preview-supported.pdf`: in Monight open the note's comment
menu, choose Edit, change its text, save, and open the result in Preview. Double-click
the visible note. The text editor does not open, although the note appears in Highlights
and Notes and Remove Note works. Before Monight saves it, the Preview-created note
opens its text editor. The archive's `evidence/monight-resaved.pdf` reproduces the saved result.
Its `evidence/monight-created.pdf` also reproduces the problem with a fresh Guest note.

Expected: native notes remain selectable, editable, and deletable in Preview.
Actual: text editor did not open. Additionally the Preview note's 24-point Rect becomes
20 points wide/high after Monight re-save, exceeding serialization tolerance.
Do not presume these symptoms share a root cause. Do not disable the core comment
experience as a substitute for delivering the requirement. Fixes require a new candidate
and annotation/save/interoperability re-runs.

### Native print action produces no print dialog on macOS

In installed Monight 0.6.0 open the supported file; apply Sepia, 150% zoom, and a
90-degree clockwise viewing rotation. Save As to a separate path, then click the
top Print button and try Cmd+P. Neither opened a native print panel during this session;
no printed output could be inspected. Save As itself succeeded, and Preview showed
the saved document upright on white pages with native annotations.

Expected: a print panel that can Save as PDF, with current annotations and no viewing
transforms. Actual: no panel or output. Reproduce against a provenance-verified candidate
before treating the installed-build result as candidate evidence.
