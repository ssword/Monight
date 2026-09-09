# Monight

Monight is a cross-platform PDF reader built with Tauri and TypeScript. It combines a lightweight native shell with a web-based UI for fast, native-feeling PDF viewing.

## Features

- Multi-tab PDF viewing
- Single-page, continuous-scroll, and two-page spread layouts
- Adjustable zoom, fit-to-page/width, rotation, and cursor-anchored pinch/wheel zoom
- Full-document text search (`Cmd/Ctrl+F`)
- Table of contents and lazy-rendered page thumbnails
- Persistent highlights and notes
- Exact page and scroll-position restoration
- Recent Documents on the launch screen
- Password prompts for encrypted PDFs
- Fullscreen presentation mode (`Shift+F11`)
- Dark mode presets and a custom filter configurator
- Customizable keyboard shortcuts
- Native file dialogs and system menu integration

## Tech Stack
- Tauri 2 (Rust backend + WebView)
- TypeScript + Vite
- PDF.js for rendering
- NoUISlider for the filter configurator

### PDF engine migration

PDF.js remains the default reader. An opt-in, read-only EmbedPDF viewer is implemented behind
`VITE_PDF_SURFACE=embedpdf`; the switch to EmbedPDF as the default is still pending.
The feature list and local annotation storage described here apply to the default reader.
Native PDF annotation editing, explicit Save/Save As, and recovery are planned work, not
available features of the gated viewer. See [ADR 0002](docs/adr/0002-adopt-embedpdf-and-pdf-native-annotations.md)
and the [engine migration review](docs/pdf-engine-review-2026-09-09.md).

To exercise the gated desktop reader:

```bash
VITE_PDF_SURFACE=embedpdf npm run tauri:dev
```

In PowerShell, set `$env:VITE_PDF_SURFACE = 'embedpdf'` before running `npm run tauri:dev`.
The variable is selected at build time; set it before `npm run tauri:build` for a gated package.

`npm test` covers the default reader and substitute EmbedPDF adapters. Run
`npm run test:embedpdf-offline` separately for the actual EmbedPDF runtime in Chromium
(install its browser with `npx playwright install chromium` if needed). This browser check
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
window. Reading sessions, Recent Documents, highlights, and notes are saved locally. Options include
default dark mode presets, thumbnail visibility, session restoration, remembering the last
filter, and keybind customization.

Reading Position and Visual State changes are saved after a short debounce, while opening,
closing, reordering, or activating a Document requests an immediate save. Normal window close and
whole-app Quit wait for pending persistence writes; if the final write fails, Monight offers retry
or an explicit quit-without-saving choice. Forced process termination, operating-system failure,
or power loss cannot be guaranteed, so ordinary debounced persistence remains the primary loss
protection.

## Iconography
The app uses the “A Page of Moonlight” icon, created in Icon Composer. The editable native
source is `design/app-icon-2026/Monight.icon`; its exported default appearance is
`design/app-icon-2026/monight-native-default-1024.png`.

After editing the native document, export its Default appearance at 1024px to that PNG,
then regenerate the platform icon set:
```bash
npm run icons:generate
```

PNG and ICO assets use the exported artwork. The macOS ICNS fallback includes a transparent
inset so it matches other Dock icons. `src-tauri/tauri.macos.conf.json` also includes the
native `.icon` source: Tauri compiles it for Liquid Glass when Xcode 26+ provides `actool`.
With Command Line Tools alone, Tauri skips the native asset catalog and uses the new ICNS
icon. See [the icon design notes](design/app-icon-2026/README.md).

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
