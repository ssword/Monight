# Improvement and feature backlog — 2026-09-11

Candidate work identified after the [2026-09-11 migration completion
review](embedpdf-migration-review-2026-09-11.md). Nothing here is scheduled or specified. Items
that become real work should be turned into GitHub issues following `docs/agents/issue-tracker.md`,
and any new domain term must first be defined in `CONTEXT.md`.

## Priority: finish #66 before new features

The EmbedPDF code is in place, but the release is blocked on evidence and CI, not on
implementation. Everything below builds on a verified reading and annotation base.

1. Fix the lint failure in `design/app-icon-2026/Monight.icon/icon.json` and upgrade `lopdf` to
   0.42.0 or later (RUSTSEC-2026-0187). Push and obtain a green CI run on macOS, Windows, and
   Linux. Both fixes are small and currently block acceptance.
2. Execute and record the Preview and Acrobat round trips for the two enabled tools in both
   directions. If Acrobat is unavailable, record Preview completely and state the limitation.
3. Run the packaged-app matrix in `issue-66-verification.md`, at minimum the macOS column.
   Windows and Linux currently have unit-test CI only, no packaged verification.
4. Close #57–#65 once their acceptance is recorded so the tracker reflects real state.

## Code health

- **Merge the duplicated interrupt paths** in `src/reader/document-intake.ts`. `interrupt()` and
  `interruptRestoration()` do the same work; the latter has no production caller after the
  worktree change.
- **Split `src/app/embedpdf-document-surface.ts`** (1410 lines). Viewer configuration and font
  preloading can live apart from surface lifecycle, rendering, annotation editing, and print
  preparation.
- **Formalize the show-window-before-restoration change** in `src/application.ts`. It is an
  uncommitted lifecycle change with no test or verification record. Add both, then commit.
- **Archive `docs/code-review.md`.** It reviews version 1.0.6 from 2026-07-30 and its title
  reads as current. Move it under `docs/archive/` or delete it.
- **Update the README project structure.** It still describes "PDF viewer logic" and omits
  `src/reader/` (domain layer), `CONTEXT.md`, and `docs/adr/`, which are the architecture entry
  points a new contributor needs.

## Annotation tool expansion

Only `highlight` and `textComment` are enabled (`src/app/embedpdf-document-surface.ts:60`).
Underline, strikeout, squiggly, free text, ink, shapes, and stamps are disabled because their
interoperability evidence has not been recorded, not because they failed. Each tool that passes
the Preview/Acrobat matrix in `issue-63-annotation-tools-and-attribution.md` can be enabled
individually. This is the most direct path to user value after #66.

## Feature candidates

Ordered by fit with the current architecture. Earlier items need less design work.

1. **Annotation navigation panel.** #55 story 7 asks for the comment panel; EmbedPDF's sidebar
   exists. Filtering by author, page, and type with jump-to-annotation can be a read-only
   Document Query that never touches Reading Session.
2. **Annotation export.** Export the current Document's annotations as Markdown or plain text for
   reading notes. A Document Query plus a desktop adapter that writes a new file; it does not
   involve PDF-write safety.
3. **Bookmarks.** Named positions beyond the single Reading Position. Either PDF-native named
   destinations that travel with the file like Annotations, or Reading Session entries. Requires a
   glossary term and an ownership decision before implementation.
4. **Recent Documents improvements.** Search, pinning, and status markers for unsaved edits or a
   pending Recovery Draft on the launch screen.
5. **Reading progress and statistics.** Per-Document percentage read and last-opened time on tabs
   and the launch screen. The data already exists in Reading Session.
6. **Multiple windows.** Drag a Document from the Reading Session into its own window. ADR 0001's
   single Reading Session authority is the right foundation, but cross-window activation semantics
   need design first.
7. **Auto-update.** Tauri's updater plugin on top of the existing macOS release pipeline. A
   necessary operational capability once 2.x ships.
8. **AI directions from the README** (classification, tag extraction, RAG search, side-by-side
   translation). These require network access or local models and are in tension with the
   offline-first, never-modify-the-original positioning. Start with a local summary or translation
   panel whose output lives in separate storage and is never written back to the PDF.

## Decision guidance

If only one item can be scheduled, complete the #66 evidence. It decides whether 2.x can ship,
and every feature above depends on that verified base.
