# Issue 60: safe PDF saving

Implementation and local verification on 2026-09-09, based on commit
`5b5dbe8f7bdb535daf80587c0ce9bf1c219c39ba` on `develop`.

Save and Save As run through Document-scoped Reader Actions from the tab controls,
native File menu, and Cmd/Ctrl+S (Shift selects Save As). The native adapter retains
the loaded source bytes, file identity, and modification time under a live source
token. Both save paths apply native protection and unrelated-content checks against
that retained source, rather than accepting a renderer-supplied preservation baseline.

Existing destinations are staged and synced before replacement. macOS and Linux
use atomic exchange; Windows uses ReplaceFileW with a backup. The actual displaced
file is checked against the expected version. A competing replacement triggers
rollback and an actionable conflict; uncertain completion retains unsaved edits
and any necessary file versions. Filesystems that cannot perform safe replacement
fail rather than falling back to truncation. Save As can still create a new file.

Conflicts offer Save As, explicit **Discard edits and reload**, or **Keep editing**.
Reload prepares fresh disk content before retiring the old viewer, waits for prior
Document navigation, and invalidates old callbacks. Save As rejects destinations
open in another Document, including native canonical and hard-link aliases. Selecting
the current Document itself through Save As is also refused with guidance to use Save.
Successful Save As carries Reading Position and Visual State into the new identity.

## Local verification

Tester: Codex. Environment: macOS 26.6.2 (25G83), Node 24.19.0, Rust 1.98.0,
EmbedPDF snippet 2.15.0. Artifact: local Vite production build and Rust test binaries;
no packaged desktop acceptance or CI run is claimed.

- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript; existing large-bundle warning remains.
- `npm test`: 411 tests in 51 files passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 48 tests passed.
- `npm run test:embedpdf-offline`: passed in local Chromium, including reading,
  navigation, and native highlight/comment creation, undo/redo, export, reopen,
  selection, editing, deletion, and re-save with external requests blocked.
- Native filesystem contracts cover original Save and repeated native annotation
  round trips, authorized replacement, cancellation/released capabilities, external
  modification, identical-byte replacement, disappearance, read-only failure,
  canonical/hard-link aliases, competing live source generations, and preservation
  guards. Test-only filesystem phase hooks also exercise the check/exchange race,
  failed rollback, staged failure, and uncertain durability with retained versions.
- Workspace/Reader Actions tests cover revision-correct completion, repeated saves,
  tab switching, dirty close protection, cancelled/failed writes, fresh reload,
  stale callbacks, and reload following delayed navigation.

## Standards review

One sequencing finding was fixed: reload now drains preceding Document actions
before projecting Reading Session state. Its regression test failed before the fix
and passes afterward. Final review: no remaining findings or baseline smells.

## Spec review

No remaining implementation findings. The review's initial request for deterministic
native race and uncertain-completion coverage was addressed and re-reviewed.

Final findings: Standards 0; Spec 0.

## Remaining acceptance gates

The default reader remains PDF.js. Writable EmbedPDF still requires
`VITE_PDF_SURFACE=embedpdf` and `VITE_NATIVE_PDF_EDITING=1`.

The Windows and Linux implementations require their existing CI and packaged-app
verification gates. Preview/Acrobat interoperability from prerequisite issue 59
remains outstanding; Chromium and native PDF inspection do not establish that
acceptance. Full Save/Discard/Cancel on close/Quit and recovery drafts remain later
slices. Current development Documents with unsaved work still block normal teardown.
Issue 60 has not been closed and no changes have been pushed.
