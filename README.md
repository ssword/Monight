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

### Web Preview (UI only)
```bash
npm run dev
```

## Settings
Settings are stored using the Tauri Store plugin and can be edited in the in-app Settings
window. Reading sessions, Recent Documents, highlights, and notes are saved locally. Options include
default dark mode presets, thumbnail visibility, session restoration, remembering the last
filter, and keybind customization.

## Iconography
The app icon is designed to follow Apple UI icon principles: minimal, bold silhouettes, and soft depth. The high-resolution source lives at `src-tauri/icons/icon-source.svg` and is used to generate the platform icon set.

To regenerate icons:
```bash
npx tauri icon src-tauri/icons/icon-source.svg
```

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
