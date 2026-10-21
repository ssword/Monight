---
status: accepted
---

# Build Preview-style chrome over headless EmbedPDF plugins

Monight will replace EmbedPDF's ready-made viewer interface with its own reader chrome modelled on macOS Preview: a unified toolbar, a mode-switching sidebar, and a separate markup toolbar. EmbedPDF remains the rendering, annotation, and save engine; Monight's chrome drives its plugins headlessly.

This supersedes only ADR 0002's choice to adopt the ready-made interface and to replace Monight's toolbar, search, thumbnails, outline, and annotation sidebar with it. ADR 0002's native-annotation, interoperability, save, recovery, and file-safety decisions are unchanged.

## Decision

- The first version restyles and reorganises existing capability; new Preview features are admitted individually by later decisions.
- The Preview look applies on macOS, Windows, and Linux. Only macOS uses an overlay title bar with traffic lights inset over the sidebar.
- Monight keeps its own in-window document tab bar, styled like the macOS tab bar and hidden when one Document is open, because native window tabs would split the single ordered Reading Session.
- Reader chrome follows the OS light/dark appearance. Monight's visual filter presets move to an Appearance popover and View menu and continue to affect page content only.
- The sidebar offers Hide, Thumbnails, Table of Contents, and Highlights and Notes. Bookmarks and Contact Sheet are deferred.
- The markup toolbar shows only annotation tools that have passed ADR 0002's round-trip verification; unverified tools are absent rather than disabled.

## Page rotation

Rotate follows Preview: it changes the rotation of the selected pages, or of the current page when none is selected, in the PDF itself. This supersedes ADR 0002's treatment of rotation as view-only and its exclusion of document restructuring, for page rotation only.

- Page rotation is a Document edit with the same unsaved indicator, undo, Recovery Draft, automatic and explicit Save path, external-conflict detection, and protection rules as an Annotation edit. There is no second path for writing the PDF.
- Rotation leaves Visual State. Rotation values in existing Reading Sessions are discarded on migration rather than converted into edits of the reader's files.
- Printing reproduces the PDF's own page rotation.
- Rotate is not shown until rotated pages, including their existing Annotations, pass round-trip verification with Preview and Acrobat in both directions.

## Considered options

- Restyling the ready-made viewer through CSS and its UI schema was rejected because its layout and interaction model cannot approach Preview's.
- Replacing EmbedPDF as the engine was rejected because the native-annotation interoperability work already verified against it would be lost.
- Keeping rotation view-only, as ADR 0002 decided, was rejected because Preview's persistent page rotation is what readers expect from a Rotate command.
- Native macOS window tabs were rejected because they conflict with ADR 0001's single Reading Session authority and are unavailable on other platforms.

## Consequences

Annotation interactions that the ready-made viewer supplied (selection handles, note popups, tool state, undo/redo affordances) must be rebuilt or composed from EmbedPDF's headless components and re-verified against the round-trip requirements of ADR 0002.
