---
status: accepted
---

# Center reader architecture on the Reading Session

Monight will treat the Reading Session as the sole authority for the ordered Documents, active Document, Reading Position, and Visual State. This replaces the duplicated mutable state and caller choreography spread across `TabData`, `PDFViewer`, session persistence, input adapters, and `main.ts`; the aim is greater depth, locality, and one interface-level test surface for reader behavior.

## Decision

- The Reading Session owns immutable revisioned snapshots, schema migration, debounced persistence, retry, and final flush behind local-substitutable store adapters.
- Reader Actions owns live Document instances, semantic action dispatch, per-Document lanes, global document-set ordering, relative-action sequencing, absolute-action coalescing, Recently Closed Documents, and settled-state commits.
- Document Intake owns canonical-path identity, metadata and raw-byte adapters, password flow, transactional first render, duplicate activation, independent per-Document outcomes, and startup restoration.
- Document Content is an internal deep module around PDF.js loading, text/search, outline, metadata, and pure target resolution. Generation-bound Document Queries expose read-only results without exposing `PDFViewer`.
- Annotations and Recent Documents each retain independent authority and versioned persistence.
- Input, rendering, Tauri lifecycle, external-link, printing, and persistence code remain adapters at these seams. `main.ts` becomes a composition root.
- The external mutation interface is a minimal semantic dispatcher. Pure typed action creators improve caller readability without creating a second interface; Reading Session mutation remains private to Reader Actions and Document Intake.

## Considered options

- One reader module containing state, intake, actions, and PDF behavior was rejected because its interface would combine unrelated change patterns and reduce locality.
- Extensible capability handles were rejected as the primary interface because Monight does not yet have enough varying adapters to justify the wider seam.
- A caller-shaped method for every Reader Action was rejected as the primary interface because it duplicates active-Document and explicit-Document surfaces. Its readability is retained through pure helpers.
- Keeping `TabManager` and synchronizing mutable `TabData` was rejected because it preserves multiple authorities and makes call ordering part of the interface.

## Consequences

The change will be delivered as deployable vertical slices: Reading Session and its store, Reader Actions and snapshot observers, Document Intake and the runtime registry, Document Content and Document Queries, then Annotation and Recent Document persistence. Tests that target shallow modules or private implementation state will be replaced by interface behavior and adapter contract tests. Legacy settings data will be migrated and verified before removal, and completion requires Tauri lifecycle and file-intake smoke verification on macOS, Windows, and Linux.
