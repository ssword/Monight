# Issue 63: annotation attribution and tool expansion

Implementation started 2026-09-10 on macOS arm64 with EmbedPDF snippet 2.15.0.
This slice implements annotation attribution. Additional creation tools remain disabled until the
required Preview and Acrobat round trips are complete.

## Annotation display name

Settings now exposes an optional Annotation Display Name. The persisted default is `Guest`; blank
or whitespace-only stored values normalize to `Guest`, and Monight never reads an operating-system
username. Each new EmbedPDF Document receives the current preference.

Changing the preference updates the public defaults for enabled authoring tools in every live
Document. Existing Annotations are not traversed or rewritten. EmbedPDF 2.15.0 normally injects its
initial configured author into an update that omits author metadata, so the integration restores the
pre-edit author through the public non-dirty synchronization API. This also preserves authors from
input PDFs when their contents or geometry are edited.

The offline runtime check creates native highlight and comment Annotations as `Guest`, changes the
display name to `Ada Lovelace`, creates another comment through the enabled tool defaults, exports,
reopens, edits, deletes, and re-saves. It verifies that the original authors remain `Guest`, the new
Annotation is authored by `Ada Lovelace`, and editing it does not rewrite its author.

## Tool policy

| Tool | Creation status | Evidence required before enablement |
| --- | --- | --- |
| Highlight | Enabled (existing core tool) | Existing local native structure and offline export/reopen coverage; full cross-reader acceptance remains a release gate |
| Text comment | Enabled (existing core tool) | Existing local native structure and offline export/reopen coverage; full cross-reader acceptance remains a release gate |
| Underline, strikeout, squiggly | Disabled | Monight, Preview, and Acrobat create/edit/delete/re-save in both directions, including text geometry and author metadata |
| Free text | Disabled | The same bidirectional workflow, including font, appearance, contents, rectangle, and author metadata |
| Ink | Disabled | The same bidirectional workflow, including ink paths, stroke appearance, geometry, and author metadata |
| Circle, square, line, polyline, polygon | Disabled | The same bidirectional workflow, including vertices/endings, border/fill appearance, geometry, and author metadata |
| Stamp | Disabled | The same bidirectional workflow plus a reviewed local stamp library and a network-blocked packaged workflow |

Redaction, forms, document restructuring, link authoring, and cryptographic-signature creation remain
disabled and out of scope. There is no flattening fallback. The native save inspector continues to
block unsupported embedded Annotation types, so a disabled creation tool cannot cause an existing
unsupported Annotation to be stripped.

## Local verification

- `npm test -- src/__tests__/settings-storage.test.ts src/__tests__/document-surface-gate.test.ts src/__tests__/embedpdf-document-surface.test.ts src/__tests__/document-workspace.test.ts`: 43 tests passed.
- `npm test`: 447 tests in 53 files passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 53 tests passed.
- `tsc --noEmit`: passed.
- `npm run build`: passed; the existing large-chunk warning remains.
- `npm run test:embedpdf-offline`: passed with external requests blocked, including the attribution workflow described above.
- Preview is installed on this host, but a complete tool-by-tool round trip has not been recorded.
- Acrobat is not installed on this host. No additional tool is enabled without that required evidence.

The repository-wide Biome check still reports diagnostics in pre-existing files outside this issue's
diff. Issue-63 files are checked separately before commit.
