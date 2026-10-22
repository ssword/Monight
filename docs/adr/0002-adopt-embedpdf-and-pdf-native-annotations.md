---
status: accepted
---

The choice of EmbedPDF's ready-made interface below is superseded by [ADR 0003](0003-preview-style-chrome-over-headless-embedpdf.md), as are view-only rotation and the exclusion of document restructuring for page rotation only. EmbedPDF as engine and every other native-annotation, save, and file-safety decision remain in effect.

# Adopt EmbedPDF's ready-made viewer and PDF-native annotations

Monight will replace its PDF.js-based viewer with EmbedPDF's ready-made viewer to provide its native annotation and comment experience. Saved annotations must be written into the PDF itself and be portable to Preview and Acrobat, rather than existing only in Monight's annotation store or an exported copy.

## Settled Direction

- Adopt the ready-made interface rather than rebuilding annotation interactions with headless components.
- Enable EmbedPDF's native annotation and comment tools with undo/redo, subject to interoperability verification. Redaction, form editing, and document restructuring are outside this migration.
- Persist annotation edits into the original PDF automatically, as Preview does: save shortly after editing pauses and again on close or Quit. Ask Save/Save As/Discard/Cancel only when that automatic save fails, so an unsavable Document never loses edits silently. Explicit Save (Cmd/Ctrl+S) and Save As remain available, with an unsaved indicator between edits and their save. An export-only workflow does not meet the requirement. (Amended 2026-10-20; originally explicit Save only, with a prompt on every close.)
- Save native annotations without flattening them into page graphics. Persistence does not mean irreversibility: supported annotations must remain selectable, editable, and deletable across Monight, Preview, and Acrobat, including annotations created by the other readers.
- Treat interoperability with Preview and Acrobat as an acceptance requirement to verify, not a guarantee inferred from the library's feature list.
- Ship only annotation tools that pass the required round-trip checks. Disable failing tools rather than flattening their output or weakening the compatibility requirement. Existing unsupported annotations must still survive saves unchanged, or saving is blocked.
- Legacy compatibility is out of scope: do not build import or migration support for Monight-only annotations. This does not authorize deleting existing user files and does not exclude interoperability with annotations already embedded in PDFs.
- Retain Monight's document tabs, Reading Session restoration, visual filters, and presets. Replace the PDF toolbar, search, thumbnails, outline, and annotation sidebar with EmbedPDF's ready-made interface. Route retained configurable shortcuts into the new viewer without duplicate controls.
- Bundle the runtime, required fonts, and enabled stamp assets locally so reading and annotation work offline rather than depending on EmbedPDF's default CDN requests.

## File Safety and Recovery

- Detect external changes before overwriting a PDF. A conflict blocks overwrite and offers Save As or explicit discard-and-reload; do not automatically merge competing edits.
- A failed write retains unsaved edits and never marks the Document saved.
- Read-only files offer Save As. Respect PDF editing restrictions. Initially treat digitally signed PDFs as read-only.
- Preserve unsupported embedded annotations unchanged. If safe preservation cannot be established, block saving rather than silently removing them.
- Keep a local Recovery Draft separate from the original PDF. After a crash, offer recovery without silently writing it into the original. Explicit Discard removes the draft. Recovery storage is not the authority for saved annotations.
- Never persist document passwords or unencrypted recovery copies of encrypted PDFs. Allow annotation editing of encrypted PDFs only when saving preserves their protection and Recovery Draft storage is secure; otherwise keep them read-only with a clear explanation.
- Successful Save As switches the current tab to the new Document path while carrying its Reading Position and Visual State. Leave the original unchanged. Block replacement of a destination already open in another tab to avoid competing live copies.

## Reading Preferences and Attribution

- Filters, presets, zoom, and viewing rotation are view-only; saving must not bake them into PDF content.
- Print the current document including unsaved annotations, without Monight's visual filters or viewing rotation. Printing neither overwrites the original nor marks it saved.
- Offer an optional annotation display name in Settings, defaulting to Guest. Do not infer it from the OS username or require an account.

## Relationship to ADR 0001

This decision replaces ADR 0001's choice of PDF.js and its separate durable annotation store as the authority for saved annotations. Reading Session remains authoritative over open Documents, settled Reading Position, and Visual State. EmbedPDF supplies the live viewer and annotation interactions; its transient state must integrate with, rather than replace, Reading Session restoration.

The current Tauri backend has no PDF-writing bridge. Native file persistence needs an explicit adapter with overwrite authorization and conflict checking. Automatic PDF saves must stay separate from automatic Reading Session persistence: they run through the same verified Save path as an explicit Save, including preservation checks and external-conflict detection, and never through the Reading Session flush.

## Verification Work

Implementation must verify a pinned production-supported EmbedPDF release rather than assume APIs from the development branch or unversioned documentation are available. Check native annotation round trips with Preview and Acrobat, preservation of existing PDF content, offline assets, view-only transforms, save failure and external-conflict behavior, recovery, and close/Quit cancellation. Preserve the existing macOS, Windows, and Linux CI and packaged-app verification gates in `docs/desktop-adapter-verification.md`. These checks are required work, not completed evidence.

The individual decisions and consolidated design were confirmed during the design interview on 2026-09-08. No interview decisions remain open.

Implementation status, reconciled 2026-10-20 for issue #81: EmbedPDF 2.15.0 is the
only production viewer; PDF.js and the permanent annotation store have been removed.
Native Save, Save As, Recovery Drafts, automatic annotation saving, and annotated
printing are composed by default. The [issue #66 record](../issue-66-verification.md)
separates green cross-platform CI/packaging from actual desktop evidence. Identified
local macOS candidates demonstrate both Acrobat Highlight/Text directions, ordinary
Save/Save As, native PDFKit print output including unsaved markup without viewing
transforms, and the conservative read-only block for unsupported Ink. Acrobat
geometry, empty-form, print-panel, and orphan-Popup failures were fixed through PR #89;
exact revisions, checksums, and observations are in the [#80 record](../issue-80-acrobat-verification.md).
No creation tool was disabled or newly enabled; highlight and text comment remain enabled.
Preview note editing/geometry subsequently passed repeated native round trips on the
identified local candidate `934b7cb` in PR #97 ([#94 verification](../issue-94-preview-text-annotations.md));
conflict/Save As Recovery Draft rebasing remains unresolved
([#91](https://github.com/ssword/Monight/issues/91)). The full packaged matrices,
including Windows/Linux native execution, close/Quit, crash recovery, protected-document
privacy inspection, and OS-level offline checks, are recorded as dated non-execution
where evidence is absent. This status does not establish migration release acceptance
or change the decisions above.

## References

- [EmbedPDF repository](https://github.com/embedpdf/embed-pdf-viewer)
- [Ready-made viewer](https://www.embedpdf.com/docs/snippet/introduction)
- [Annotation tools](https://www.embedpdf.com/docs/snippet/plugins/plugin-annotation)
- [PDF export and save API](https://www.embedpdf.com/docs/snippet/plugins/plugin-export)
- [Offline asset configuration](https://www.embedpdf.com/docs/snippet/airgapped)
