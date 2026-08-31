# Monight

Monight is a PDF reader focused on keeping a reader's documents and visual reading preferences available across app launches.

## Language

**Document**:
An opened PDF identified by its canonical absolute file path; opening that path again refers to the same Document.
_Avoid_: Tab, viewer

**Document Content**:
The PDF-authored pages, text, outline, metadata, and link targets of a Document. It excludes reader-authored Annotations and transient rendering details.
_Avoid_: PDF.js document, document feature

**Document Query**:
A read-only request for information derived from a Document, such as search results, outline entries, thumbnails, metadata, or Annotation snapshots. It never changes settled state.
_Avoid_: Viewer lookup, document action

**Reading Session**:
The ordered set of Documents a reader has open, including which Document is active and each Document's settled Reading Position and Visual State. It is authoritative for settled state across app launches.
_Avoid_: Last file, startup files, window state

**Reading Position**:
A page and normalized location within that page where the reader has settled. It is independent of viewport pixels.
_Avoid_: Scroll position, current page

**Visual State**:
A Document's settled view mode, rotation, Zoom Intent, and visual filters. It excludes transient presentation, search, sidebar, selection, and hover state.
_Avoid_: Viewer state, UI state

**Zoom Intent**:
The reader's choice of a manual scale, fit width, or fit page. Fit choices are recalculated for the current viewport.
_Avoid_: Zoom level, scale

**Reader Action**:
A reader's intent to change the active Document or its settled state, independent of whether it came from the toolbar, a keybind, a menu, search, or another input.
_Avoid_: UI event, shortcut handler, menu command

**Document Intake**:
The process by which one or more PDF paths become active Documents in the Reading Session. Each path has its own outcome, and an already-open path refers to the existing Document.
_Avoid_: File-open flow, PDF intake, open handler

**Annotation**:
A reader-authored highlight or note that belongs to a Document independently of whether that Document is in the Reading Session.
_Avoid_: Session note, viewer annotation

**Recent Document**:
A Document explicitly opened or reactivated by the reader. Automatic Reading Session restoration does not make a Document recent.
_Avoid_: Recent file, restored document

**Recently Closed Document**:
A Document path retained temporarily so the reader can reopen it during the current app run. It is not part of the durable Reading Session.
_Avoid_: Closed tab, recent document
