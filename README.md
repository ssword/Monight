# Monight

Monight is a cross-platform PDF reader built with Tauri and TypeScript. It combines a lightweight native shell with a web-based UI for fast, native-feeling PDF viewing.

## Features

Monight's reader chrome is modelled on macOS Preview and drawn entirely by Monight; EmbedPDF
renders the pages and annotations underneath (see [ADR 0003](docs/adr/0003-preview-style-chrome-over-headless-embedpdf.md)).

- Unified toolbar: sidebar toggle and mode menu, file name with "Page N of M", Zoom Out / Zoom to
  Fit / Zoom In, Appearance, Highlight split button, Rotate, Markup toolbar, Slideshow, Print, Open,
  and a Search field
- Sidebar with Thumbnails (multi-select, filtered like the page), Table of Contents, and Highlights
  and Notes; search results take it over while a search is active
- Full-document text search from the toolbar Search field (`Cmd/Ctrl+F`)
- Continuous Scroll, Single Page, and Two Pages layouts; Actual Size, Zoom to Fit, Zoom to Width,
  and cursor-anchored pinch/wheel zoom
- Back and Forward through each Document's jumps (links, Table of Contents, search results, Go to
  Page)
- PDF-native highlights in five colours, underline, strikethrough, and text notes, offering only the
  tools verified with Preview and Acrobat
- Annotation menu beside the selected annotation: edit its note, recolour it, or delete it
  (`Delete`)
- Page rotation saved into the PDF, like Preview's Rotate
- Undo and Redo, automatic saving, explicit Save and Save As, and Recovery Drafts for unsaved edits
- Native View, Go, and Tools menus with Preview's shortcuts as defaults; every shortcut is
  customizable
- Night-reading Appearance presets (Default, Original, Redeye, Sepia, Custom sliders) that filter the
  page only; the chrome follows the system light or dark appearance
- In-window tabs for several Documents, hidden while only one is open
- Slideshow (`Shift+Cmd+F`) and Full Screen
- Exact page and scroll-position restoration, and Recent Documents on the launch screen
- Password prompts for encrypted PDFs; protected and signed PDFs stay read-only with an explanation

## Tech Stack
- Tauri 2 (Rust backend + WebView)
- TypeScript + Vite
- EmbedPDF 2.15.0 for rendering and native annotations
- NoUISlider for the filter configurator

### PDF runtime verification

EmbedPDF is the only production viewer. Native PDF editing is enabled only after the desktop
safety adapter confirms that the Document can be saved without violating its protection state.
Read-only, signed, encrypted, or otherwise unsafe Documents remain readable and explain why
editing is unavailable. See [ADR 0002](docs/adr/0002-adopt-embedpdf-and-pdf-native-annotations.md)
and the [issue 66 verification record](docs/issue-66-verification.md).

`npm test` covers the reader and substitute EmbedPDF adapters. Run
`npm run test:embedpdf-offline` separately for the actual EmbedPDF runtime in Chromium
(install its browser with `npx playwright install chromium` if needed). Besides the EmbedPDF
contracts, it runs the real reader (`index.html`) against an in-memory stand-in for the native
side and drives its chrome end to end: toolbar, sidebar modes, search, markup toolbar, Highlight
split button, annotation menu, and the View, Go, Tools and Edit menu commands. This browser check
does not establish packaged Tauri behavior or native annotation interoperability.

## Project Structure
- `src/` - UI code, PDF viewer logic, and settings UI
- `src/app/` - App orchestration modules (events, UI, file actions)
- `src-tauri/` - Tauri backend, commands, and menu setup

## Getting Started

### Prerequisites
- Node.js (LTS recommended)
- Rust toolchain (stable)
- Tauri prerequisites for your OS: https://tauri.app/start/prerequisites/

### Install
```bash
npm install
```

### Development
```bash
npm run tauri:dev
```

### Build
```bash
npm run tauri:build
```

### Release for macOS

After the release commit is on `master`, push a semantic version tag that matches the version in
`package.json` to build a universal DMG for Apple Silicon and Intel Macs and publish it on GitHub
Releases:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

The workflow uses ad hoc code signing and does not require Apple credentials. Users may need to
approve the app in macOS Privacy & Security. Configure Apple Developer ID signing and notarization
before distributing the app to a broad audience.

### Web Preview (UI only)
```bash
npm run dev
```

## Settings
Settings are stored using the Tauri Store plugin and can be edited in the in-app Settings
window. Reading Sessions and Recent Documents are saved locally; saved Annotations belong to the
PDF, while unsaved edits use separate Recovery Drafts. Options include default dark mode presets,
session restoration, annotation attribution, remembering the last filter, and keybind customization.

Reading Position and Visual State changes are saved after a short debounce, while opening,
closing, reordering, or activating a Document requests an immediate save. Normal window close and
whole-app Quit wait for pending persistence writes; if the final write fails, Monight offers retry
or an explicit quit-without-saving choice. Forced process termination, operating-system failure,
or power loss cannot be guaranteed, so ordinary debounced persistence remains the primary loss
protection.

## Iconography
The app uses a painted M and crescent moon adapted from the Monight brand artwork.
The source is `design/app-icon-painted-2026/monight-painted-1024.png`.

After updating the source PNG, regenerate the platform icon set:
```bash
npm run icons:generate
```

PNG and ICO assets use the square artwork. macOS bundles the native layered
`design/app-icon-painted-2026/Monight.icon`, with system-rendered default, dark,
clear, and tinted appearances. Its ICNS fallback uses the native default rendering
with a transparent Dock inset. After editing the native document, run
`npm run icons:macos` on a Mac with Xcode and Icon Composer supporting design generation 27.
See [the icon design notes](design/app-icon-painted-2026/README.md).

## Future Work (AI)
- Smart classification of PDFs
- Automatic tag extraction
- RAG-assisted search and summarization
- Dualing page-by-page compare reading with real-time translation

## Configuration
- App settings and bundling are configured in `src-tauri/tauri.conf.json`.
- Menu items and shortcuts are defined in `src-tauri/src/menu.rs`.

## License
MIT — see [LICENSE](LICENSE).
