## Problem Statement

Monight's current PDF.js-based reader offers limited highlights and notes stored separately from the PDF. Its on-page interactions do not provide the native comment and annotation experience the reader wants. Those Monight-only annotations do not travel with the original PDF into Preview or Acrobat.

The reader wants to annotate directly in the document using EmbedPDF's ready-made interface, explicitly save those annotations into the original PDF, and continue working with supported annotations in Preview and Acrobat. This must not sacrifice Monight's document tabs, Reading Session restoration, visual filters, presets, or configurable shortcuts, and must not expose original documents to silent overwrite, corruption, or unintended changes from reading preferences.

## Solution

Replace the PDF.js-based viewer with EmbedPDF's ready-made viewer and its native annotation/comment tools. Retain Monight as the desktop shell and authority for the Reading Session. Saved Annotations belong to the PDF, not a separate Monight annotation database.

Provide explicit Save and Save As, visible unsaved state, and Save/Discard/Cancel when closing an edited Document or quitting. Save native, non-flattened annotations so that supported types remain selectable, editable, and deletable across Monight, Preview, and Acrobat. Only expose annotation tools that pass the required interoperability checks.

Protect writes against external changes and failures, retain local Recovery Drafts for unsaved work, respect document protection, and bundle required viewer assets for offline operation. Reading preferences remain view-only, and printing includes current annotations without implicitly saving the PDF.

## User Stories

1. As a reader, I want EmbedPDF's ready-made viewer inside Monight, so that I can use its native annotation and comment interactions without a separate application.
2. As a reader, I want to highlight and otherwise mark selected text directly on a page, so that important passages remain attached to the document.
3. As a reader, I want to place and edit notes and comments through the viewer, so that I can record feedback where it belongs.
4. As a reader, I want supported free-text, ink, shape, and stamp tools, so that I can express annotations beyond highlights and notes.
5. As a reader, I want to select, edit, and delete supported annotations on the page, so that I can revise my work in place.
6. As a reader, I want undo and redo for annotation edits, so that I can correct mistakes without starting over.
7. As a reader, I want the viewer's comment panel, so that I can review and navigate annotations from one interface.
8. As a reader, I want to save annotations into the original PDF explicitly, so that they travel with the file without requiring a separate export workflow.
9. As a reader, I want Save available through the desktop controls and Cmd/Ctrl+S, so that saving follows familiar desktop conventions.
10. As a reader, I want a visible unsaved indicator for each edited Document, so that I know which work has not reached the file.
11. As a reader, I want a Document marked saved only after its write succeeds, so that the interface does not claim my work is durable prematurely.
12. As a reader, I want Save As to create an annotated PDF at a chosen destination, so that I can preserve the original or work around filesystem write restrictions.
13. As a reader, I want successful Save As to switch my current tab to the new Document while retaining my Reading Position and Visual State, so that I can continue without reopening it manually.
14. As a reader, I want replacement blocked when a Save As destination is already open in another tab, so that two live copies cannot overwrite each other's work.
15. As a reader, I want cancelling or failing Save As to leave my current Document and unsaved edits intact, so that an unfinished file operation does not lose my work.
16. As a reader, I want Save/Discard/Cancel when closing an edited Document, so that I control whether to persist, abandon, or continue editing it.
17. As a reader, I want the same protection on application Quit, so that closing the app does not silently save or discard annotations.
18. As a reader, I want cancelling close or Quit to leave the application usable, so that I can continue editing rather than being left in a partially shut-down state.
19. As a reader, I want printing to include current annotations, including unsaved ones, so that the printed document reflects my current work.
20. As a reader, I want printing to leave the original file and unsaved indicator unchanged, so that printing is not an implicit Save.
21. As a reader, I want annotations created in Monight to remain editable in Preview and Acrobat, so that my workflow is not tied to Monight.
22. As a reader, I want supported annotations created in Preview or Acrobat to remain editable in Monight, so that I can continue work started in another reader.
23. As a reader, I want unsupported embedded annotations preserved unchanged, so that saving supported edits does not destroy someone else's work.
24. As a reader, I want saving blocked when safe preservation cannot be established, so that uncertain compatibility cannot silently damage my PDF.
25. As a reader, I want incompatible annotation tools disabled rather than silently flattened, so that the available tools honor the promised portability.
26. As a reader, I want an external-change conflict reported before overwrite, so that Monight does not erase changes made in Preview, Acrobat, or another process.
27. As a reader, I want Save As or explicit discard-and-reload after an external conflict, so that I can choose which work to preserve without an automatic merge.
28. As a reader, I want failed saves to retain my unsaved edits, so that I can retry or save elsewhere.
29. As a reader, I want read-only files to offer Save As when document permissions allow it, so that filesystem restrictions do not unnecessarily prevent a separate annotated copy.
30. As a reader, I want PDF editing restrictions respected, so that Monight does not bypass the document's protection policy.
31. As a reader, I want digitally signed PDFs treated as read-only initially, so that this annotation migration does not silently invalidate signed documents.
32. As a reader, I want local Recovery Drafts for unsaved annotation work, so that an unexpected termination does not necessarily lose my edits.
33. As a reader, I want recovery offered after a crash rather than silently applied to the original file, so that I remain in control of what is saved.
34. As a reader, I want explicit Discard to remove the associated Recovery Draft, so that intentionally abandoned work is not offered again.
35. As a reader, I want recovery to respect changes made to the original PDF since the draft was captured, so that restoring work cannot silently overwrite a newer file.
36. As a reader, I want document passwords excluded from persistent storage, so that reopening or recovery does not leak my credentials.
37. As a reader, I want encrypted PDFs edited only when both saved output and Recovery Drafts can remain protected, so that annotation support does not create an unprotected copy.
38. As a reader, I want a clear read-only explanation when safe encrypted editing is unavailable, so that I understand why editing is restricted.
39. As a reader, I want my open Documents, active Document, and tab order restored, so that the viewer replacement preserves my Reading Session.
40. As a reader, I want my Reading Position and Visual State restored per Document, so that I resume with the same reading preferences.
41. As a reader, I want Monight's filters and presets retained, so that I keep its visual reading controls while gaining annotation tools.
42. As a reader, I want zoom, filters, presets, and viewing rotation excluded from saved PDF content, so that comfortable reading preferences do not alter the document itself.
43. As a reader, I want printing without Monight's filters or viewing rotation, so that the PDF's own appearance and page orientation are preserved.
44. As a reader, I want existing configurable shortcuts routed to the new viewer, so that familiar commands work without duplicate or conflicting controls.
45. As a reader, I want EmbedPDF's toolbar, search, thumbnails, outline, and annotation panel to replace the corresponding old controls, so that I have one coherent PDF interface.
46. As a reader, I want existing document-opening methods and canonical-path deduplication preserved, so that opening PDFs still behaves consistently from the desktop and within Monight.
47. As a reader, I want reading and annotation tools to work offline, so that the app does not depend on CDN availability.
48. As a reader, I want locally available required fonts and enabled stamp assets, so that offline use does not leave missing glyphs or broken tools.
49. As a reader, I want an optional annotation display name that defaults to Guest, so that I can choose attribution without an account or automatic disclosure of my OS username.
50. As a reader, I want the same agreed save and recovery behavior on macOS, Windows, and Linux, so that file safety does not depend on which supported desktop I use.

## Implementation Decisions

### Viewer Integration and Ownership

- Adopt EmbedPDF's ready-made viewer, not a headless rebuild of its interface. Replace the existing PDF.js loading, rendering, text-selection, search presentation, and annotation implementation rather than retaining a parallel PDF.js runtime for old behavior.
- Use a pinned production-supported EmbedPDF release and matching assets. Validate required APIs against that release; development-branch features or unversioned documentation are not proof that an API is available in the selected package.
- Keep Reading Session authoritative for ordered Documents, the active Document, settled Reading Position, and Visual State. EmbedPDF owns live viewer interactions but must not introduce an independent durable authority for these same values.
- Retain Reader Actions for semantic Document-scoped commands, action sequencing, generation safety, and settled-state commits. Integrate Save, Save As, close decisions, printing, and recovery through that existing application boundary rather than adding caller-specific toolbar or menu persistence logic.
- Retain Document Intake for canonical-path identity, byte loading, password flow, duplicate activation, independent outcomes, and transactional initial presentation. New or replaced live Documents must not become authoritative before preparation succeeds.
- Adapt Document Content, Document Queries, and Document Rendering to the new engine without exposing library-specific handles to callers. Queries remain read-only and generation-bound. Search, selection, panels, and presentation remain transient rather than entering Reading Session persistence.
- Retain Monight's tabs, restoration, filters, presets, and configurable shortcuts. EmbedPDF replaces the PDF toolbar, search UI, thumbnails, outline, and annotation sidebar. Avoid two sets of equivalent controls or competing open/close/save paths.
- Bundle the viewer runtime, required font assets, and enabled stamp assets locally. Configure or disable external asset defaults rather than assuming an installed package is automatically offline-capable.

### Annotation Content and Compatibility

- An Annotation is a comment or markup attached to a Document, including text markups, notes, free text, drawings, shapes, and stamps. Saved Annotations belong to the PDF and travel independently of the Reading Session.
- Enable native annotation/comment interactions and undo/redo. The shipped tool set is constrained by verified Preview/Acrobat interoperability, not by Monight's old two-kind/four-color annotation schema.
- Saved annotations remain native and non-flattened. Supported types must remain selectable, editable, and deletable through cross-reader round trips in both directions.
- Disable individual creation/editing tools that fail those checks. This must not become a nominal migration that ships without the requested working annotation/comment experience.
- Existing annotations created in other readers are part of the PDF. Preserve unsupported annotations unchanged; if safe preservation cannot be established, block saving instead of silently dropping or flattening them.
- The saved PDF is the durable authority for Annotations. Local Recovery Drafts are for unsaved work only and must not become a replacement permanent annotation database.
- No import, conversion, or backward-compatibility implementation is required for old Monight-only annotations. Do not delete existing user files as a side effect of removing the old runtime path.

### Explicit Saving and File Safety

- Edits make their Document unsaved. Explicit Save writes the current native PDF state to that Document's original path. Cmd/Ctrl+S and relevant desktop/viewer controls must invoke the same semantic operation.
- Provide Save As through a native destination-selection flow. On success, switch the current tab's Document identity to the new canonical path, preserving Reading Position and Visual State and leaving the original unchanged. On cancellation or failure, keep the original identity and unsaved work.
- Reject replacement of a Save As destination already open as another Document. Respect canonical identity so aliases cannot bypass this guard.
- Add a native PDF-writing adapter. The existing backend supports reading PDFs but does not provide a PDF save operation; existing read authorization alone is not sufficient overwrite authorization.
- Associate save operations with the originating Document, its live generation, and the content revision being written. Changing active tabs or receiving a late completion must not save or mark clean a different Document. A newer edit must not be cleared by completion of an older save.
- Detect changes to the source PDF before overwrite. A conflict blocks the operation and offers Save As or explicit discard-and-reload; automatic merging and silent overwrite are prohibited.
- A failed or uncertain write must not be presented as success. Preserve unsaved edits and provide an actionable failure. The writer must protect existing file content from partial replacement, and its failure behavior requires native contract verification.
- Filesystem read-only status offers Save As when the PDF's own permissions allow editing. Respect PDF editing restrictions rather than treating Save As as permission bypass. Initially keep digitally signed PDFs read-only.
- Permit encrypted-document editing only when saving preserves the document's protection and Recovery Draft storage is secure. Otherwise preserve reading support and explain why editing is unavailable. Never persist document passwords or unencrypted recovery copies of encrypted PDFs.

### Close, Quit, and Recovery

- Show unsaved status and offer Save/Discard/Cancel when closing an edited Document. Apply the same protection to whole-app Quit and other teardown paths that would destroy an edited live Document.
- Save completes successfully before teardown proceeds. A failed or cancelled save does not authorize closing. Discard abandons the unsaved work explicitly; Cancel keeps the Document and application usable.
- Keep these choices separate from automatic persistence of the Reading Session and Recent Documents. The existing final-flush coordinator must not implicitly save PDF annotations as part of session shutdown.
- A Recovery Draft is a local recoverable copy of a Document's unsaved annotation edits, separate from its original PDF. Capture drafts during editing so they are useful after unexpected termination, not only during graceful shutdown.
- Offer recovery on a subsequent launch without silently writing the draft into the original PDF. A recovered Document still needs explicit Save, and recovery does not bypass external-change checks.
- Explicit Discard removes the associated draft. Successful saves must reconcile the draft with the revision actually persisted so already-saved work is not resurrected and newer unsaved work is not prematurely discarded.
- Keep draft storage behind a persistence adapter, with sufficient Document identity and source-version association to prevent stale or mismatched recovery. Exact serialization and scheduling are implementation details; externally observable recovery and privacy guarantees are mandatory.

### Reading Preferences, Printing, and Attribution

- Filters, presets, zoom, and viewing rotation remain view-only. They must not be baked into saved pages, native annotation coordinates, or PDF page rotation. The PDF's own existing orientation remains part of the document.
- Print the current Document with its current annotations, including unsaved edits, but without Monight's visual filters or viewing rotation. Printing neither writes the original nor marks edits saved.
- Preserve the originating Document when asynchronous printing overlaps tab activation changes, following the existing Reader Action behavior.
- Provide an optional annotation display name in Settings, defaulting to Guest. Do not infer it from the OS username, require an account, or retroactively rewrite authors of existing annotations merely because the setting changes.

### Architectural Record

- The accepted EmbedPDF/PDF-native-annotation decision supersedes the earlier choice of PDF.js and a separate permanent Annotation store. It does not supersede Reading Session authority or the existing adapter-based architecture.
- Keep platform-dependent behavior in desktop adapters. Do not spread filesystem, native-dialog, or operating-system branches through reader domain modules.

## Testing Decisions

The user confirmed the following boundaries: primary workflow tests through the existing Document workspace and Reader Actions interfaces; focused contracts for native file writing, recovery storage, and EmbedPDF integration; and real-application checks for offline operation, cross-reader round trips, and supported desktop packages.

- **Test quality:** Assert externally observable behavior, returned outcomes, Reading Session snapshots, recoverable state, and saved/reopened PDF content. Do not couple tests to private fields, EmbedPDF internals, internal helper call order, or an assumed plugin implementation. A mocked successful write or export is not evidence of PDF interoperability.
- **Primary workflow boundary:** Prefer composed tests at the existing Document workspace and Reader Actions boundary, including Document Intake where opening or canonical identity matters. Exercise open, annotate, Save, Save As, close/cancel, recovery, print, and restored reading behavior as workflows rather than separate tests for every helper.
- **Prior art:** Existing Reader Actions tests cover captured Document targets, per-Document sequencing, stale generations, close/reopen behavior, and settled commits. Document workspace and Document Intake tests cover snapshot-driven tabs, duplicate identity, provisional preparation, failure cleanup, and restoration. Extend these patterns instead of introducing a second application-wide testing interface.
- **Viewer contract:** Exercise the replacement Document Content, Queries, and Rendering behavior using the same public contracts as substitute adapters. Verify text selection, annotations aligned under zoom and viewing rotation, navigation, supported view modes, search, outline, thumbnails, filters, and restoration. Use browser tests with the actual EmbedPDF runtime where DOM or WASM behavior cannot be represented honestly by a substitute.
- **Native write contract:** Verify successful save and reopen, authorized destinations, external-change conflicts, write failures, preservation of existing file content, canonical-alias guards, and Save As identity changes. Include native filesystem tests; an in-memory substitute alone cannot establish replacement safety.
- **Save concurrency:** An edit arriving during save remains unsaved unless included in the persisted revision. Switching tabs does not retarget a save. Late completions cannot mark a reopened generation saved. Repeated save and teardown requests cannot produce conflicting writes or silently discard newer work.
- **Lifecycle:** Test Save/Discard/Cancel on individual close and whole-app Quit, failed saves, cancelled destination dialogs, multiple edited Documents, and repeated shutdown requests. Cancelling teardown leaves the app usable. Closing an auxiliary settings window must not discard PDF edits. Reuse the existing window-lifecycle and persistence-coordinator test patterns.
- **Recovery contract:** Simulate unexpected termination after draft capture, then reopen and accept or reject recovery. Confirm no implicit original-file write, removal after explicit Discard, revision-correct reconciliation after successful Save, retention after failed Save, source-mismatch protection, and isolation between Documents. Reuse durable-persistence contract patterns for failures and overlapping revisions, without copying legacy annotation-migration requirements.
- **Interoperability:** For every enabled annotation tool, test creation, Save, reopen, selection, editing, deletion, and re-save across Monight, Preview, and Acrobat in both directions. Include comment contents, relevant author metadata, annotation geometry, and appearance. Inspect native annotations as well as screenshots so visually correct flattening cannot pass.
- **Preservation:** Use PDFs containing annotations produced externally, including unsupported types. Confirm they survive unchanged or saving is blocked. Also verify unrelated pages, text, links, outline, forms, and document metadata are not unintentionally damaged even though editing those features is outside scope.
- **Protected files:** Cover filesystem read-only PDFs, restricted PDFs, digitally signed PDFs, and encrypted PDFs. Verify appropriate Save As versus read-only behavior, preservation of protection where editing is enabled, and absence of persisted passwords or plaintext encrypted-document recovery copies. Blocking unsafe editing is the specified acceptable outcome, not a test failure to work around.
- **Printing:** Verify that current unsaved annotations reach the print adapter, filters and viewing rotation do not, and original bytes and unsaved state are unchanged. Reuse the existing print-adapter contract and captured-target Reader Action tests, then verify the native print flow in packaged apps.
- **Reading regressions:** Preserve multi-Document intake, canonical deduplication, tabs, active Document, session restoration, Reading Position, Zoom Intent, filters, presets, configurable commands, and existing supported reading workflows. In particular, save/reopen must not double-apply viewing rotation or change the coordinate meaning of annotations.
- **Offline and privacy:** Run the packaged viewer with external network access unavailable. Verify initialization, representative required-font documents, enabled stamps, annotation editing, saving, and recovery without missing assets or CDN requests. Verify Guest attribution and explicit display-name changes without OS-username leakage.
- **Desktop gates:** Preserve complete TypeScript and Rust CI on macOS, Windows, and Linux, plus native packaged-app smoke verification on each platform. Include file intake, Save/Save As, close/Quit cancellation, recovery, encrypted read-only behavior, external links, and printing. Record tester, date, OS and application versions, build artifact, CI run, and outcomes. A pass on one platform does not establish another platform's behavior.

## Out of Scope

- Importing, migrating, or maintaining compatibility with old Monight-only annotation data.
- Rebuilding EmbedPDF's interface with headless components or retaining duplicate old PDF controls.
- Redaction, form editing, document restructuring, PDF page editing, and digital-signature creation or modification.
- Treating typed or drawn signature appearances as a new cryptographic signing feature.
- Flattening annotations as an interoperability fallback.
- Automatically saving annotations into the original PDF during editing, recovery, printing, or Reading Session shutdown.
- Automatically merging externally modified PDFs or silently overwriting competing edits.
- Bypassing PDF permissions, stripping encryption, persisting document passwords, or creating plaintext recovery copies of encrypted PDFs.
- Cloud storage, collaboration services, accounts, or a new permanent external annotation database.
- Baking Monight's reading preferences into saved or printed document content.
- Unrelated reader architecture rewrites or removal of retained Monight reading features.

## Further Notes

- This specification synthesizes the design confirmed on 2026-09-08. Product decisions and test boundaries are confirmed; implementation and compatibility verification have not been performed.
- The tracker label is `ready-for-agent`. Readiness means the work is specified, not that every upstream capability has already been demonstrated.
- First validate the selected production-supported EmbedPDF release against real native annotation round trips, offline packaging, document preservation, and the Tauri save boundary. The feature must not be declared complete solely because a ready-made viewer renders a PDF or returns export bytes.
- Native annotation support, editable cross-reader behavior, and original-file persistence are separate acceptance requirements. Disabling failing optional tools is permitted; removing the core annotation/comment experience is not a substitute for delivering the feature.
- The test suite must distinguish an annotation commit to the viewer's in-memory engine from a successful durable write to the PDF file. Recovery and Reading Session persistence are separate again.
- The accepted architectural decision and glossary remain the vocabulary and ownership references for implementation. Exact package versions, internal draft serialization, and adapter mechanics should be selected and verified during implementation without reopening the agreed user-facing behavior.
- Primary references: [EmbedPDF repository](https://github.com/embedpdf/embed-pdf-viewer), [ready-made viewer](https://www.embedpdf.com/docs/snippet/introduction), [annotation tools](https://www.embedpdf.com/docs/snippet/plugins/plugin-annotation), [export and save API](https://www.embedpdf.com/docs/snippet/plugins/plugin-export), and [offline asset configuration](https://www.embedpdf.com/docs/snippet/airgapped). Check documentation against the selected release before relying on individual APIs.
