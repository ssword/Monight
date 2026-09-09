---
status: accepted
---

# Adopt EmbedPDF's ready-made viewer and PDF-native annotations

Monight will replace its PDF.js-based viewer with EmbedPDF's ready-made viewer to provide its native annotation and comment experience. Saved annotations must be written into the PDF itself and be portable to Preview and Acrobat, rather than existing only in Monight's annotation store or an exported copy.

## Settled Direction

- Adopt the ready-made interface rather than rebuilding annotation interactions with headless components.
- Enable EmbedPDF's native annotation and comment tools with undo/redo, subject to interoperability verification. Redaction, form editing, and document restructuring are outside this migration.
- Persist annotation edits into the original PDF through explicit Save (Cmd/Ctrl+S), with an unsaved indicator and Save/Discard/Cancel when closing an edited Document. Save As remains available. An export-only workflow does not meet the requirement.
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

The current Tauri backend has no PDF-writing bridge. Native file persistence needs an explicit adapter with overwrite authorization and conflict checking. Save/Discard/Cancel on close or Quit must be separate from automatic Reading Session persistence; replacing the old annotation-store flush with a PDF write would violate explicit Save semantics.

## Verification Work

Implementation must verify a pinned production-supported EmbedPDF release rather than assume APIs from the development branch or unversioned documentation are available. Check native annotation round trips with Preview and Acrobat, preservation of existing PDF content, offline assets, view-only transforms, save failure and external-conflict behavior, recovery, and close/Quit cancellation. Preserve the existing macOS, Windows, and Linux CI and packaged-app verification gates in `docs/desktop-adapter-verification.md`. These checks are required work, not completed evidence.

The individual decisions and consolidated design were confirmed during the design interview on 2026-09-08. No interview decisions remain open.

Implementation status, reviewed 2026-09-09 at `aa9a095`: the first development-gated, read-only EmbedPDF surface is implemented, while PDF.js remains the default. Local Chromium offline rendering has been exercised; native annotations, file writing, recovery, interoperability, and the final desktop switch are not complete. Temporary engine coexistence is the migration strategy specified by issue #56, not a replacement for this decision. See the [engine migration review](../pdf-engine-review-2026-09-09.md) for current defects and verification limits.

## References

- [EmbedPDF repository](https://github.com/embedpdf/embed-pdf-viewer)
- [Ready-made viewer](https://www.embedpdf.com/docs/snippet/introduction)
- [Annotation tools](https://www.embedpdf.com/docs/snippet/plugins/plugin-annotation)
- [PDF export and save API](https://www.embedpdf.com/docs/snippet/plugins/plugin-export)
- [Offline asset configuration](https://www.embedpdf.com/docs/snippet/airgapped)
