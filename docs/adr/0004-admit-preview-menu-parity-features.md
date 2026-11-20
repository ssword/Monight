---
status: accepted
---

# Admit Preview menu parity features

ADR 0003 restyled existing capability and left new Preview features to individual later decisions. This decision admits the Preview menu features that apply to PDFs and sets the rule for shortcuts: on macOS, Monight's default shortcuts match Preview's; on Windows and Linux, ⌘ becomes Ctrl, except where the platform has its own convention (F11 for full screen, F3 for Find Next).

It lifts ADR 0003's deferral of Bookmarks. Contact Sheet remains deferred.

## Admitted

- **Find Next / Find Previous / Use Selection for Find** in an Edit ▸ Find submenu, alongside Find…: ⌘G / ⇧⌘G / ⌘E on macOS, and F3 or Ctrl+G / Shift+F3 or Ctrl+Shift+G / Ctrl+E elsewhere. Find Next with no active search opens the find bar.
- **Hide Toolbar** (⌥⌘T), a persisted chrome preference. When the sidebar is hidden, the macOS traffic lights move to the top-left of the toolbar.
- **Previous Item / Next Item** (⌥↑ / ⌥↓) step through the items in the current sidebar mode: pages, outline entries, Annotations, or Bookmarks. Stepping navigates to the item and adds the jump to Navigation History, just as clicking the item does. Disabled while the sidebar is hidden.
- **Bookmarks** sidebar mode (⌥⌘5) and **Add Bookmark** (⌘D, a toggle on the current page). A Bookmark belongs to the reader and is never written to the PDF. Because no PDF is changed, Bookmarks need no round-trip verification gate.
- **Show Magnifier** (the ` key): a loupe that follows the pointer. Its visibility is transient. Like Delete, the key is left to text fields and note editors, and the menu shows no accelerator for it.

## Shortcut and placement alignment for existing capability

- Go ▸ Previous Page / Next Page keep their names but list ↑ / ↓ first, so the menu shows Preview's keys. ← / → still work (keybind defaults revision 7).
- The Window menu gains Show Previous Tab / Show Next Tab (⌃⇧⇥ / ⌃⇥) for Monight's in-window tabs, and a list of open Documents shown as `name.pdf (Page X of Y)`, with a checkmark on the active one; choosing one switches to it. On macOS the Window menu is registered as the app's windows menu, so the OS adds Fill, Center, Move & Resize, Full Screen Tile and Bring All to Front.
- Enter Full Screen keeps ⌃⌘F on macOS, because a custom menu item cannot show 🌐F. Zoom to Width keeps ⇧⌘W, which Preview does not have.

## Not admitted

- **Image-only items**: Soft Proof, Show Image Background, 3D Rendering and Manipulator, Add to Scene, Adjust Color and Size, Remove Background, Flip, Assign Profile, Show Location Info.
- **Native window tabs**: Show All Tabs, Move Tab to New Window, and Merge All Windows conflict with the single Reading Session (ADR 0001, ADR 0003).
- **Edits that restructure or destroy content**: Insert pages, Move to Trash, and Invert Selection stay excluded under ADR 0002. Redact is destructive and would need its own verification.
- **Deferred**: Crop (a Document edit that would need a gate like Page Rotation's), Rectangular and Automatic Selection, Zoom to Selection (needs Rectangular Selection), Show Inspector, Contact Sheet, Customize Toolbar.
