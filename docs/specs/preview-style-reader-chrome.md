# Preview-style reader chrome

Decisions: [ADR 0003](../adr/0003-preview-style-chrome-over-headless-embedpdf.md). Vocabulary: [CONTEXT.md](../../CONTEXT.md).

## Problem Statement

Monight's reading interface is a mix of Monight's own toolbar (a strip of filter preset buttons, emoji icons for print and open) and EmbedPDF's ready-made viewer UI. It does not feel like a native macOS document reader. Controls are spread between two toolbars with inconsistent styling, the sidebar does not behave like the one readers know from Preview, the native menus expose only a handful of commands, and the default shortcuts disagree with the conventions macOS readers already have in their fingers. Rotating a page only rotates the view, so the rotation is lost when the PDF is opened in Preview or Acrobat.

## Solution

Monight gets a reader chrome modelled on macOS Preview, built by Monight over EmbedPDF's headless plugins, while EmbedPDF remains the rendering, annotation, and save engine:

- A unified toolbar with grouped capsule buttons: sidebar toggle and mode menu, file name with "Page N of M", zoom group, Highlight split button, Rotate, Markup toolbar toggle, Appearance, Print, and a Search field.
- A sidebar with Thumbnails, Table of Contents, and Highlights and Notes modes; search results take it over while a search is active.
- A separate markup toolbar showing only annotation tools that have passed round-trip verification.
- Native View, Go, and Tools menus structured like Preview's, with Preview's shortcuts as defaults.
- Rotate changes the Page Rotation stored in the PDF, like Preview.
- Back and Forward retrace a Document's Navigation History.
- Monight's night-reading filter presets move into an Appearance popover; the chrome follows the OS light/dark appearance and uses Monight's brand palette.

It applies on macOS, Windows, and Linux; only macOS gets the overlay title bar with inset traffic lights.

## User Stories

### Window and toolbar

1. As a macOS reader, I want the traffic lights inset over the sidebar in a unified title bar, so that Monight looks like a native document app.
2. As a Windows or Linux reader, I want the same toolbar under a conventional title bar, so that I get the same reader on every platform.
3. As a reader, I want the active Document's file name with "Page N of M" beneath it in the toolbar, so that I always know where I am.
4. As a reader, I want Zoom Out, Zoom to Fit, and Zoom In grouped together in the toolbar, so that I can adjust scale with one hand on the mouse.
5. As a reader, I want a Print button in the toolbar, so that printing is one click away.
6. As a reader, I want a Search field at the trailing edge of the toolbar, so that I can find text the way I do in Preview.
7. As a reader, I want toolbar buttons grouped into capsules with consistent outline icons, so that the chrome feels calm and coherent.
8. As a reader, I want the chrome to follow my OS light or dark appearance, so that Monight matches the rest of my desktop.
9. As a night reader, I want the dark chrome to use Monight's ink-night palette with a moonlight-warm accent, so that the window is low-glare and recognisably Monight.
10. As a reader working offline, I want every icon bundled with the app, so that the chrome never depends on the network.

### Document tabs

11. As a reader with several Documents open, I want a tab bar styled like macOS tabs, so that switching Documents feels native.
12. As a reader with one Document open, I want the tab bar hidden, so that the page gets the space.
13. As a reader, I want ⌃Tab and ⌃⇧Tab to switch tabs on every platform, so that tab switching works even on macOS where ⌘Tab belongs to the system.
14. As a macOS reader, I want ⌘⇧] and ⌘⇧[ to switch tabs, so that Monight follows macOS tab conventions.
15. As a reader, I want "Switch to Tab N" still available as a bindable action, so that I can restore digit tab switching if I prefer it.

### Sidebar

16. As a reader, I want a sidebar toggle with a dropdown of modes (Hide Sidebar, Thumbnails, Table of Contents, Highlights and Notes), so that I can choose what the sidebar shows.
17. As a reader, I want ⌥⌘1–4 to switch sidebar modes, so that I can change modes from the keyboard as in Preview.
18. As a reader, I want the sidebar's visibility, mode, and width remembered across launches and shared by all Documents, so that I set it up once.
19. As a reader, I want page thumbnails with page numbers and the current page highlighted, so that I can see where I am in the Document.
20. As a night reader, I want thumbnails rendered with the active Document's filter, so that a dark-filtered Document is not flanked by a column of bright white pages.
21. As a reader, I want to click a thumbnail to go to that page, so that I can navigate visually.
22. As a reader, I want to select several thumbnails with ⇧-click and ⌘-click, so that I can act on several pages at once.
23. As a reader, I want the thumbnail selection to clear when I switch Documents and never be restored on launch, so that a stale selection never surprises me.
24. As a reader, I want a Table of Contents mode listing the Document's outline, so that I can jump to a section.
25. As a reader, I want a Highlights and Notes mode listing text-markup and note Annotations grouped by page, so that I can review my markup.
26. As a reader, I want Highlights and Notes to include markup made in Preview or Acrobat, so that I see every reader's markup, not just Monight's.
27. As a reader, I want clicking an entry in Highlights and Notes to go to that Annotation, so that I can return to marked passages.

### Search

28. As a reader, I want typing in the toolbar Search field to replace the sidebar with results grouped by page, so that I can scan every hit in context.
29. As a reader, I want clicking a search result to go to that hit, so that I can read around it.
30. As a reader, I want clearing the Search field to restore the sidebar mode I had before, so that searching does not disturb my layout.
31. As a reader, I want ⌘F to focus the Search field, so that search stays one shortcut away.

### Markup toolbar and Highlight

32. As a reader, I want a Markup toolbar toggle in the toolbar and View ▸ Hide/Show Markup Toolbar (⇧⌘A), so that annotation tools appear only when I want them.
33. As a reader, I want the markup toolbar's visibility remembered across launches, so that it stays the way I left it.
34. As a reader, I want the markup toolbar to show only tools that work reliably with Preview and Acrobat, so that I never create markup other readers cannot edit.
35. As a reader, I want unverified tools absent rather than disabled, so that the toolbar does not advertise features I cannot use.
36. As a reader, I want the Text note tool in the markup toolbar, so that I can add notes.
37. As a reader, I want clicking Highlight with text selected to highlight it immediately in the current color, so that highlighting is one click.
38. As a reader, I want clicking Highlight with nothing selected to enter highlight mode, where every text selection becomes a highlight until I click Highlight again or press Esc, so that I can mark many passages quickly.
39. As a reader, I want a Highlight dropdown offering Yellow, Green, Blue, Pink, and Purple, so that I can colour-code markup.
40. As a reader, I want my last highlight colour remembered across launches, so that I do not reselect it every time.
41. As a reader, I want Underline and Strikethrough to appear in the Highlight dropdown once they pass round-trip verification, so that the menu grows as tools are proven.
42. As a reader of a read-only, signed, or protected Document, I want editing tools unavailable with the existing explanation, so that I understand why I cannot annotate.

### Appearance

43. As a night reader, I want an Appearance button in the toolbar opening a popover of filter presets (Default, Original, Redeye, Sepia, Custom), so that night reading is one click away.
44. As a night reader, I want choosing Custom to expand the filter sliders inline in the popover, so that I can tune the filter while looking at the page.
45. As a reader, I want the preset I choose to apply to the active Document only, so that each Document keeps its own Visual State.
46. As a reader, I want newly opened Documents to keep today's preset inheritance behaviour, so that the redesign does not change how presets work.
47. As a reader, I want the presets also available under View, so that I can reach them from the menu bar.
48. As a reader, I want filters applied only to page content and never to the chrome, so that the controls stay legible.
49. As a reader, I want the Settings window to keep shortcuts, the annotation display name, and other app-wide settings, so that the popover stays focused on reading.

### Page Rotation

50. As a reader, I want Rotate to rotate the pages selected in the thumbnail sidebar, or the current page when none are selected, so that it behaves like Preview.
51. As a reader, I want Rotate Left (⌘L) and Rotate Right (⌘R) under Tools, so that I can rotate from the keyboard.
52. As a reader, I want a Page Rotation saved into the PDF, so that the page is still rotated when I open the file in Preview or Acrobat.
53. As a reader, I want a Page Rotation to mark the Document unsaved and be saved automatically like an Annotation edit, so that rotation follows the same save rules as everything else.
54. As a reader, I want ⌘Z to undo a Page Rotation, so that a mistaken rotation is easy to reverse.
55. As a reader, I want an unsaved Page Rotation captured in the Recovery Draft, so that a crash does not lose it.
56. As a reader, I want a Page Rotation to go through external-change conflict detection, so that rotating never overwrites someone else's changes.
57. As a reader of a read-only, signed, or protected Document, I want Rotate unavailable with the existing explanation, so that Monight never weakens a Document's protection.
58. As a reader, I want existing highlights and notes on a rotated page to stay attached to the right text in Monight, Preview, and Acrobat, so that rotating never misplaces my markup.
59. As a reader upgrading Monight, I want any old view-only rotation in my Reading Session reset to 0° rather than written into my files, so that an upgrade never edits my PDFs.
60. As a reader, I want printing to reproduce the PDF's own Page Rotation, so that what I print matches the file.

### View menu

61. As a reader, I want View ▸ Show/Hide Tab Bar, so that I can control the tab bar from the menu.
62. As a reader, I want View ▸ Hide Sidebar, Thumbnails, Table of Contents, and Highlights and Notes with ⌥⌘1–4, so that sidebar modes are in the menu bar.
63. As a reader, I want View ▸ Continuous Scroll (⌘1), Single Page (⌘2), and Two Pages (⌘3), so that layout switching matches Preview.
64. As a reader, I want View ▸ Actual Size (⌘0), Zoom to Fit (⌘9), Zoom In, and Zoom Out, so that zoom matches Preview.
65. As a reader, I want View ▸ Zoom to Width (⌘⇧W), so that I keep fit-width as a Zoom Intent even though Preview lacks it.
66. As a reader, I want View ▸ Slideshow (⇧⌘F) to start what was Presentation Mode, so that the command has Preview's name and shortcut.
67. As a reader, I want View ▸ Enter Full Screen (⌃⌘F on macOS, F11 elsewhere) separate from Slideshow, so that I can fill the screen without presenting.

### Go menu and Navigation History

68. As a reader, I want Go ▸ Previous Page and Next Page, so that I can page from the menu.
69. As a reader, I want Go ▸ Go to Page… (⌥⌘G), so that I can jump to a page number.
70. As a reader, I want Go ▸ Back (⌘[) to return to where I was before following a link, Table of Contents entry, search result, or Go to Page, so that I never lose my place after a jump.
71. As a reader, I want Go ▸ Forward (⌘]) to redo a jump I backed out of, so that I can move between two places.
72. As a reader, I want ordinary scrolling not to add to Navigation History, so that Back goes to meaningful places.
73. As a reader, I want each Document to have its own Navigation History, so that Back never jumps to another Document.
74. As a reader, I want Navigation History to last only for the app run, so that a relaunch starts clean.
75. As a reader, I want Back and Forward disabled when there is nowhere to go, so that the menu tells me the truth.

### Tools menu

76. As a reader, I want Tools ▸ Text Selection, so that I can return to normal selection from any tool.
77. As a reader, I want Tools ▸ Annotate ▸ listing the verified annotation tools, so that I can annotate from the menu bar.

### Shortcuts

78. As a reader who never customised shortcuts, I want Preview's shortcuts as the new defaults, so that my macOS habits work immediately.
79. As a reader who customised shortcuts, I want my bindings kept, so that the upgrade never overrides my choices.
80. As a reader whose custom binding collides with a new default, I want my binding to win and the new default dropped, so that no shortcut triggers two actions.
81. As a reader, I want every menu item, toolbar button, and shortcut for the same command to behave identically, so that the input method never changes the result.

### Launch screen and delivery

82. As a reader launching Monight with no Documents, I want the splash screen with Recent Documents restyled to match the new chrome, so that the first screen feels part of the same app.
83. As a reader, I want Monight to stay fully usable after each part of the redesign ships, so that I am never left without a working reader.

## Implementation Decisions

- **Engine vs chrome.** EmbedPDF stays as the rendering, annotation, and save engine. Monight's chrome replaces the ready-made viewer UI and drives EmbedPDF plugins headlessly (zoom, scroll, spread, thumbnail, search, selection, annotation, history). ADR 0002's native-annotation, save, recovery, and file-safety rules are unchanged.
- **Every command is a Reader Action.** Toolbar buttons, menu items, popovers, sidebar clicks, and shortcuts are input adapters that dispatch typed Reader Actions; none mutates the Reading Session or EmbedPDF state directly.
- **New Reader Actions.**
  - Page Rotation: rotate a set of pages of a Document clockwise or counter-clockwise. The existing whole-Document rotate actions are replaced. The pages come from the input adapter (thumbnail selection, or the current page).
  - Navigation History: go back and go forward within a Document.
  - Slideshow replaces presentation-mode toggling under its new name; Enter Full Screen is a separate action.
- **Page Rotation is a Document edit.** It joins the same unsaved-work accounting as Annotation edits: unsaved indicator, undo/redo, Recovery Draft capture, automatic and explicit Save through the verified Save path, and external-conflict detection. It is unavailable whenever editing is unavailable. Writing the page rotation needs a mechanism, because EmbedPDF 2.15 exposes no engine API for it even though its PDFium build contains the page-rotation setter. Possible routes are a narrow adapter over PDFium or the native side's existing PDF library; either way there is a single write path shared with Save.
- **Visual State loses rotation.** The Reading Session schema version increments; migration drops stored rotation values (resetting to 0°) and never converts them into edits. The projection's rotation-application operation goes away. Printing no longer strips a viewing rotation and reproduces the PDF's own Page Rotation.
- **Navigation History.** A per-Document stack held by Reader Actions for the app run. Entries are recorded on link activation, outline activation, search-result activation, and Go to Page, never on settled scrolling. It is not part of the Reading Session or persisted, and it is discarded when a Document closes.
- **Reader chrome preferences.** A small app-wide preference store, outside the Reading Session and Visual State, holds: sidebar visible, sidebar mode, sidebar width, markup toolbar visible, and last highlight colour. It is persisted across launches.
- **Transient chrome state.** Thumbnail selection, active search query, the sidebar mode suspended by search, and highlight mode are transient and never persisted.
- **Sidebar modes.** Thumbnails, Table of Contents (from Document Queries' outline), Highlights and Notes (text-markup and note Annotations from any author, grouped by page), plus a search-results mode that temporarily replaces the chosen mode.
- **Thumbnails honour filters.** Thumbnails render with the active Document's filter settings.
- **Markup tool gating.** A single list of verified annotation tools drives the markup toolbar, the Highlight dropdown, and Tools ▸ Annotate. Initially: Highlight (five colours) and Text note. Underline, Strikethrough, and Rotate are added only after passing round-trip verification.
- **Appearance.** The preset strip leaves the toolbar. An Appearance popover and a View submenu dispatch the existing filter-setting action against the active Document; Custom expands the existing slider configurator inline. Preset inheritance for new Documents is unchanged.
- **Native menus.** The native menu builder grows View, Go, and Tools menus following Preview's structure for the features in scope. Each item emits a menu event that maps to a Reader Action or chrome-preference change. Items reflect enabled state (for example Back/Forward, and editing commands on protected Documents).
- **Shortcut defaults.** New defaults: ⌘1/⌘2/⌘3 view modes, ⌘0 Actual Size, ⌘9 Zoom to Fit, ⌘⇧W Zoom to Width, ⌥⌘1–4 sidebar modes, ⇧⌘A markup toolbar, ⌘L/⌘R rotate, ⌥⌘G Go to Page, ⌘[/⌘] Back/Forward, ⇧⌘F Slideshow, ⌃⌘F (macOS) / F11 (others) Full Screen, ⌃Tab/⌃⇧Tab tab switching (plus ⌘⇧[/⌘⇧] on macOS). "Switch to Tab N" stays as an action with no default. A settings migration applies new defaults only to actions the reader has not rebound, and drops a new default that collides with a reader's binding.
- **Platform chrome.** macOS uses an overlay title bar with traffic lights inset over the sidebar; Windows and Linux keep a conventional title bar with the same toolbar below.
- **Tabs.** Monight's in-window tab bar stays, restyled like macOS tabs and hidden with one Document.
- **Visual identity.** Preview's structure and proportions (toolbar height, capsule groups, sidebar width, page gutters and shadows); colour tokens from Monight's brand UI tokens; the active tool and selection use the moonlight-warm accent rather than system blue. One open-licensed outline icon set (Lucide or similar, close to SF Symbols' weight) is bundled locally. SF Symbols are not used.
- **Delivery slices,** each leaving Monight usable, with the ready-made UI kept until each slice replaces its counterpart:
  1. Toolbar and window chrome (title block, zoom group, Print, Appearance popover, light/dark tokens, icons, macOS overlay title bar, tab bar restyle, splash restyle).
  2. Sidebar (modes, chrome preferences, filtered thumbnails with multi-selection, Table of Contents, Highlights and Notes).
  3. Search in the sidebar.
  4. Markup toolbar and Highlight split button (verified tools only, colours, highlight mode).
  5. Native menus, shortcut defaults and migration, Slideshow/Full Screen split, Navigation History with Back/Forward.
  6. Page Rotation (write path, Visual State migration, verification), shipped hidden until verification passes.

## Testing Decisions

- **Test external behaviour only.** Tests drive public interfaces (Reader Action dispatch, input adapters, storage adapters, native save adapter contract) and assert on Reading Session snapshots, dispatched actions, outcomes, and saved bytes, never on private module state or EmbedPDF internals.
- **Seam 1: Reader Actions (primary).** Via the Reader Actions dispatcher with a substitute projection, as the existing Reader Actions and Reading Session tests do:
  - Page Rotation marks unsaved work, is undoable, is captured in the Recovery Draft, saves through the Save path, and is refused for protected Documents.
  - Navigation History records link, outline, search, and Go to Page jumps but not scrolling. Back/Forward are per-Document and are discarded on close.
  - The Reading Session schema migration drops rotation (Reading Session store tests are the prior art).
- **Seam 2: input adapters.** Like the existing reader input-action tests, each toolbar control, sidebar entry, popover, and menu event dispatches the expected typed Reader Action. The same seam also covers:
  - DOM tests for chrome preferences: persistence of sidebar visibility, mode, and width, markup toolbar visibility, and highlight colour; search temporarily replacing and then restoring the sidebar mode.
  - Shortcut-default migration tests modelled on the keybind manager and settings storage tests: untouched actions get new defaults, rebound actions are kept, and collisions favour the reader.
- **Seam 3: native save adapter and EmbedPDF browser checks.**
  - Page Rotation bytes are written and preserved by the native save adapter contract (prior art: native PDF save adapter tests and the Rust save tests).
  - The headless EmbedPDF composition is covered by extending the existing EmbedPDF Playwright verification scripts (reading, navigation, annotations, offline) to drive the new chrome.
- **Manual interoperability records.** Round trips with Preview and Acrobat for Highlight colours, Underline and Strikethrough are recorded in the style of the issue #80 and #94 verification documents. Page Rotation requires Preview round trips in both directions, including existing Annotations on rotated pages. The owner waived Acrobat Page Rotation checks on 2026-10-22 because they require a paid subscription (ADR 0003 amendment). A tool or Rotate becomes visible only when its required record passes.

## Out of Scope

- Bookmarks and Contact Sheet sidebar modes.
- Inspector, Magnifier, rectangular selection, Adjust Color/Size, Crop, Redact, 3D, Soft Proof, Remove Background, and Share.
- Annotation tools beyond Highlight and Text note until each passes verification (shapes, ink, signatures, text boxes, stamps).
- Page reordering, insertion, deletion, or any restructuring other than Page Rotation.
- Native macOS window tabs.
- Changing preset inheritance or making filters app-wide.
- Persisting Navigation History or thumbnail selection.
- Using SF Symbols.

## Further Notes

- Prerequisite ADR: 0003 supersedes ADR 0002 for the ready-made interface and, for Page Rotation only, view-only rotation and the restructuring exclusion.
- Preview reference snapshots live under the `design/apple-preview-UI` directory; brand colour tokens live under `design/brand-2026`.
- Open ADR 0002 work (Recovery Draft rebasing on conflict/Save As, issue #91) also applies to Page Rotation once rotation shares the Recovery Draft path.
