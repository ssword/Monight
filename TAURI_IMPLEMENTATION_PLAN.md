# NightPDF Tauri Reimplementation Plan

This document outlines a phased approach to reimplementing NightPDF using Tauri instead of Electron.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [Phase 1: Project Foundation](#phase-1-project-foundation)
4. [Phase 2: Core PDF Viewing](#phase-2-core-pdf-viewing)
5. [Phase 3: Dark Mode Core](#phase-3-dark-mode-core)
6. [Phase 4: Dark Mode Customization](#phase-4-dark-mode-customization)
7. [Phase 5: Tab System](#phase-5-tab-system)
8. [Phase 6: File Operations](#phase-6-file-operations)
9. [Phase 7: Settings System](#phase-7-settings-system)
10. [Phase 8: Keyboard Shortcuts](#phase-8-keyboard-shortcuts)
11. [Phase 9: Application Menu](#phase-9-application-menu)
12. [Phase 10: Window Management](#phase-10-window-management)
13. [Phase 11: Platform Integration](#phase-11-platform-integration)
14. [Phase 12: Polish & Optimization](#phase-12-polish--optimization)
15. [Migration Considerations](#migration-considerations)
16. [Risk Assessment](#risk-assessment)

---

## Architecture Overview

### Current Electron Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                          │
├─────────────────────────────────────────────────────────┤
│  Main Process (Node.js)                                  │
│  ├── app.ts (window management, IPC handlers)           │
│  ├── menutemplate.ts (application menu)                 │
│  └── settings.ts (settings window)                      │
├─────────────────────────────────────────────────────────┤
│  Preload Script (contextBridge)                          │
│  └── preload.ts (IPC bridge)                            │
├─────────────────────────────────────────────────────────┤
│  Renderer Process (Chromium)                             │
│  ├── index.ts (main UI)                                 │
│  ├── settings.ts (settings UI)                          │
│  └── PDF.js webview                                     │
└─────────────────────────────────────────────────────────┘
```

### Target Tauri Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Tauri App                            │
├─────────────────────────────────────────────────────────┤
│  Rust Backend (src-tauri/)                               │
│  ├── main.rs (app initialization)                       │
│  ├── commands.rs (IPC command handlers)                 │
│  ├── menu.rs (application menu)                         │
│  ├── settings.rs (settings management)                  │
│  └── window.rs (window management)                      │
├─────────────────────────────────────────────────────────┤
│  Frontend (src/ - TypeScript/HTML/CSS)                   │
│  ├── main.ts (main window logic)                        │
│  ├── settings.ts (settings window logic)                │
│  ├── components/ (UI components)                        │
│  └── PDF.js (embedded or iframe)                        │
├─────────────────────────────────────────────────────────┤
│  System WebView (WebKit/WebView2/WebKitGTK)              │
└─────────────────────────────────────────────────────────┘
```

---

## Technology Stack

### Backend (Rust)

| Component | Crate | Purpose |
|-----------|-------|---------|
| Core Framework | `tauri` | Application framework |
| Settings Storage | `tauri-plugin-store` | Persistent JSON storage |
| File Dialogs | `tauri-plugin-dialog` | Native file picker |
| Shell Operations | `tauri-plugin-shell` | Open external links |
| Global Shortcuts | `tauri-plugin-global-shortcut` | Keyboard shortcuts |
| Logging | `tauri-plugin-log` | Application logging |
| Auto-updater | `tauri-plugin-updater` | GitHub releases updates |
| CLI Parsing | `clap` | Command line arguments |
| Serialization | `serde`, `serde_json` | Settings serialization |

### Frontend (TypeScript)

| Component | Library | Purpose |
|-----------|---------|---------|
| PDF Rendering | PDF.js | PDF viewing and rendering |
| Sliders | noUiSlider | Filter control sliders |
| Build Tool | Vite | Frontend bundling |
| Styling | Sass | CSS preprocessing |

---

## Phase 1: Project Foundation

**Goal:** Set up the basic Tauri project structure with a working window.

**Priority:** Critical
**Complexity:** Low
**Dependencies:** None

### Tasks

#### 1.1 Initialize Tauri Project

```bash
# Create new Tauri project
npm create tauri-app@latest nightpdf-tauri -- --template vanilla-ts

# Or with existing frontend
cd nightpdf-tauri
npm init -y
npm install -D @tauri-apps/cli
npm run tauri init
```

#### 1.2 Project Structure

```
nightpdf-tauri/
├── src/                      # Frontend source
│   ├── assets/               # Images, icons
│   ├── css/                  # Stylesheets (Sass)
│   ├── lib/                  # PDF.js library
│   ├── scripts/              # TypeScript modules
│   │   ├── main.ts
│   │   ├── settings.ts
│   │   └── utils/
│   ├── index.html            # Main window
│   └── settings.html         # Settings window
├── src-tauri/                # Rust backend
│   ├── src/
│   │   ├── main.rs
│   │   ├── commands.rs
│   │   ├── menu.rs
│   │   ├── settings.rs
│   │   └── window.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── biome.json
```

#### 1.3 Configure tauri.conf.json

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "NightPDF",
  "identifier": "io.github.lunarequest.NightPDF",
  "version": "3.0.0",
  "build": {
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "NightPDF",
        "width": 550,
        "height": 420,
        "minWidth": 565,
        "minHeight": 200,
        "resizable": true,
        "visible": false
      }
    ],
    "security": {
      "csp": "default-src 'self'; script-src 'self'"
    }
  },
  "bundle": {
    "active": true,
    "icon": ["icons/icon.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

#### 1.4 Basic Rust Main

```rust
// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 1.5 Basic Frontend

```html
<!-- src/index.html -->
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <title>NightPDF</title>
    <link rel="stylesheet" href="/css/index.css" />
    <meta http-equiv="Content-Security-Policy" content="script-src 'self';" />
</head>
<body>
    <div id="app">
        <h1>NightPDF</h1>
        <p>Tauri version loading...</p>
    </div>
    <script type="module" src="/scripts/main.ts"></script>
</body>
</html>
```

### Deliverables

- [ ] Tauri project initialized
- [ ] Build system configured (Vite + Tauri)
- [ ] Basic window displays
- [ ] Development workflow working (`npm run tauri dev`)
- [ ] Biome linting configured

### Verification

```bash
npm run tauri dev
# Window should open with basic content
```

---

## Phase 2: Core PDF Viewing

**Goal:** Display a PDF file using PDF.js within the Tauri webview.

**Priority:** Critical
**Complexity:** Medium
**Dependencies:** Phase 1

### Tasks

#### 2.1 Integrate PDF.js

```bash
# Download PDF.js prebuilt
# Copy to src/lib/pdfjs/
```

#### 2.2 Create PDF Viewer Component

```typescript
// src/scripts/pdf-viewer.ts
export class PDFViewer {
    private container: HTMLElement;
    private pdfDoc: PDFDocumentProxy | null = null;

    constructor(containerId: string) {
        this.container = document.getElementById(containerId)!;
    }

    async loadPDF(filePath: string): Promise<void> {
        // Load PDF using PDF.js
    }

    async renderPage(pageNum: number): Promise<void> {
        // Render specific page
    }
}
```

#### 2.3 Implement File Reading Command

```rust
// src-tauri/src/commands.rs
use std::fs;
use tauri::command;

#[command]
pub async fn read_pdf_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| e.to_string())
}

#[command]
pub fn get_file_name(path: String) -> String {
    std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default()
}
```

#### 2.4 Register Commands

```rust
// src-tauri/src/main.rs
mod commands;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::read_pdf_file,
            commands::get_file_name,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 2.5 Frontend Integration

```typescript
// src/scripts/main.ts
import { invoke } from '@tauri-apps/api/core';

async function openPDF(filePath: string) {
    const pdfData: number[] = await invoke('read_pdf_file', { path: filePath });
    const uint8Array = new Uint8Array(pdfData);
    // Load into PDF.js
}
```

### Deliverables

- [ ] PDF.js integrated and loading
- [ ] Rust command to read PDF files
- [ ] PDF displays in webview
- [ ] Page navigation working
- [ ] Zoom controls working

### Verification

- Open app with hardcoded PDF path
- PDF renders correctly
- Can navigate between pages

---

## Phase 3: Dark Mode Core

**Goal:** Implement basic dark mode with CSS filters and preset buttons.

**Priority:** Critical
**Complexity:** Low
**Dependencies:** Phase 2

### Tasks

#### 3.1 Create Filter System

```typescript
// src/scripts/filters.ts
export interface FilterSettings {
    brightness: number;    // 0-100
    grayscale: number;     // 0-100
    invert: number;        // 0-100
    sepia: number;         // 0-100
    hue: number;           // 0-360
    extraBrightness: number; // -100 to 200
}

export const PRESETS: Record<string, FilterSettings> = {
    default: {
        brightness: 7,
        grayscale: 95,
        invert: 95,
        sepia: 55,
        hue: 180,
        extraBrightness: 0
    },
    original: {
        brightness: 0,
        grayscale: 0,
        invert: 0,
        sepia: 0,
        hue: 0,
        extraBrightness: 0
    },
    redeye: {
        brightness: 8,
        grayscale: 100,
        invert: 92,
        sepia: 100,
        hue: 295,
        extraBrightness: -6
    },
    sepia: {
        brightness: 0,
        grayscale: 0,
        invert: 25,
        sepia: 100,
        hue: 0,
        extraBrightness: -30
    }
};

export function buildFilterCSS(settings: FilterSettings): string {
    return `filter:
        brightness(${(100 - settings.brightness) / 100})
        grayscale(${settings.grayscale / 100})
        invert(${settings.invert / 100})
        sepia(${settings.sepia / 100})
        hue-rotate(${settings.hue}deg)
        brightness(${(settings.extraBrightness + 100) / 100});`;
}
```

#### 3.2 Apply Filters to PDF Viewer

```typescript
// src/scripts/pdf-viewer.ts
export class PDFViewer {
    applyFilter(css: string): void {
        const pages = this.container.querySelectorAll('.page');
        pages.forEach(page => {
            (page as HTMLElement).style.cssText = css;
        });
    }
}
```

#### 3.3 Preset Buttons UI

```html
<!-- src/index.html -->
<div id="menu">
    <button id="default-button" class="preset-btn active">Default</button>
    <button id="sepia-button" class="preset-btn">Sepia</button>
    <button id="redeye-button" class="preset-btn">Redeye</button>
    <button id="custom-button" class="preset-btn">Custom</button>
</div>
```

#### 3.4 Wire Up Preset Buttons

```typescript
// src/scripts/main.ts
import { PRESETS, buildFilterCSS } from './filters';

function setupPresetButtons() {
    const buttons = document.querySelectorAll('.preset-btn');

    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            const preset = btn.id.replace('-button', '');
            if (preset !== 'custom') {
                const settings = PRESETS[preset];
                const css = buildFilterCSS(settings);
                pdfViewer.applyFilter(css);
            }
            // Update active state
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });
}
```

### Deliverables

- [ ] Filter settings interface defined
- [ ] Four presets implemented (Default, Original, Redeye, Sepia)
- [ ] Preset buttons in UI
- [ ] Filters apply to PDF pages
- [ ] Active preset highlighted

### Verification

- Click each preset button
- PDF appearance changes accordingly
- Active button state updates

---

## Phase 4: Dark Mode Customization

**Goal:** Add slider controls for fine-tuning dark mode filters.

**Priority:** High
**Complexity:** Medium
**Dependencies:** Phase 3

### Tasks

#### 4.1 Install noUiSlider

```bash
npm install nouislider
npm install -D @types/nouislider
```

#### 4.2 Create Dark Configurator Panel

```html
<!-- src/index.html -->
<div id="darkConfigurator" class="hidden">
    <h3>Settings</h3>
    <div id="slides">
        <label>Darkness</label>
        <div id="brightnessSlider"></div>

        <label>Grayscale</label>
        <div id="grayscaleSlider"></div>

        <label>Inversion</label>
        <div id="invertSlider"></div>

        <label>Sepia</label>
        <div id="sepiaSlider"></div>

        <label>Hue</label>
        <div id="hueSlider"></div>

        <label>Brightness</label>
        <div id="extraBrightnessSlider"></div>
    </div>
</div>
```

#### 4.3 Initialize Sliders

```typescript
// src/scripts/sliders.ts
import noUiSlider, { API } from 'nouislider';
import { FilterSettings, buildFilterCSS } from './filters';

interface SliderConfig {
    element: HTMLElement;
    start: number;
    min: number;
    max: number;
    step: number;
}

export class SliderManager {
    private sliders: Map<string, API> = new Map();
    private onUpdate: (settings: FilterSettings) => void;

    constructor(onUpdate: (settings: FilterSettings) => void) {
        this.onUpdate = onUpdate;
    }

    initialize(): void {
        this.createSlider('brightness', 7, 0, 100);
        this.createSlider('grayscale', 95, 0, 100);
        this.createSlider('invert', 95, 0, 100);
        this.createSlider('sepia', 55, 0, 100);
        this.createSlider('hue', 180, 0, 360);
        this.createSlider('extraBrightness', 0, -100, 200);
    }

    private createSlider(name: string, start: number, min: number, max: number): void {
        const element = document.getElementById(`${name}Slider`);
        if (!element) return;

        const slider = noUiSlider.create(element, {
            start,
            step: 1,
            connect: 'lower',
            range: { min, max },
            tooltips: [{
                to: (value: number) => `${Math.round(value)}%`,
                from: (value: string) => Number(value.replace('%', ''))
            }]
        });

        slider.on('update', () => this.handleUpdate());
        this.sliders.set(name, slider);
    }

    private handleUpdate(): void {
        const settings = this.getCurrentSettings();
        this.onUpdate(settings);
    }

    getCurrentSettings(): FilterSettings {
        return {
            brightness: this.getValue('brightness'),
            grayscale: this.getValue('grayscale'),
            invert: this.getValue('invert'),
            sepia: this.getValue('sepia'),
            hue: this.getValue('hue'),
            extraBrightness: this.getValue('extraBrightness')
        };
    }

    private getValue(name: string): number {
        const slider = this.sliders.get(name);
        return slider ? Number(slider.get()) : 0;
    }

    setPreset(settings: FilterSettings): void {
        this.sliders.get('brightness')?.set(settings.brightness);
        this.sliders.get('grayscale')?.set(settings.grayscale);
        this.sliders.get('invert')?.set(settings.invert);
        this.sliders.get('sepia')?.set(settings.sepia);
        this.sliders.get('hue')?.set(settings.hue);
        this.sliders.get('extraBrightness')?.set(settings.extraBrightness);
    }
}
```

#### 4.4 Toggle Configurator Panel

```typescript
// src/scripts/main.ts
function toggleDarkConfigurator(): void {
    const panel = document.getElementById('darkConfigurator');
    if (panel) {
        panel.classList.toggle('hidden');
    }
}

// Custom button shows/hides panel
document.getElementById('custom-button')?.addEventListener('click', () => {
    toggleDarkConfigurator();
});
```

### Deliverables

- [ ] noUiSlider integrated
- [ ] Six sliders created with correct ranges
- [ ] Real-time filter updates on slider change
- [ ] Configurator panel toggle
- [ ] Presets update slider positions
- [ ] Tooltips showing current values

### Verification

- Click Custom button, panel appears
- Adjust sliders, PDF updates in real-time
- Select preset, sliders move to preset values

---

## Phase 5: Tab System

**Goal:** Implement multi-tab support for opening multiple PDFs.

**Priority:** High
**Complexity:** High
**Dependencies:** Phase 2

### Design Considerations

Electron's `electron-tabs` library won't work with Tauri. Options:

1. **Custom tab implementation** - Build tabs from scratch
2. **Third-party library** - Use a vanilla JS/TS tab library
3. **CSS-only tabs** - Simple tab UI with JavaScript state management

**Recommended:** Custom implementation for full control.

### Tasks

#### 5.1 Create Tab Data Structure

```typescript
// src/scripts/tabs.ts
export interface TabData {
    id: string;
    title: string;
    filePath: string;
    filterSettings: FilterSettings;
    scrollPosition: number;
    currentPage: number;
}

export class TabManager {
    private tabs: Map<string, TabData> = new Map();
    private activeTabId: string | null = null;
    private closedHistory: string[] = [];
    private onTabChange: (tab: TabData | null) => void;

    constructor(onTabChange: (tab: TabData | null) => void) {
        this.onTabChange = onTabChange;
    }

    createTab(filePath: string, title: string): TabData {
        const id = crypto.randomUUID();
        const tab: TabData = {
            id,
            title,
            filePath,
            filterSettings: PRESETS.default,
            scrollPosition: 0,
            currentPage: 1
        };
        this.tabs.set(id, tab);
        this.renderTabs();
        this.activateTab(id);
        return tab;
    }

    closeTab(id: string): void {
        const tab = this.tabs.get(id);
        if (tab) {
            this.closedHistory.push(tab.filePath);
            this.tabs.delete(id);

            // Activate adjacent tab
            if (this.activeTabId === id) {
                const remaining = Array.from(this.tabs.keys());
                this.activateTab(remaining[0] || null);
            }
            this.renderTabs();
        }
    }

    reopenLastClosed(): TabData | null {
        const filePath = this.closedHistory.pop();
        if (filePath) {
            // Trigger file open
            return null; // Will be handled by openFile
        }
        return null;
    }

    activateTab(id: string | null): void {
        this.activeTabId = id;
        const tab = id ? this.tabs.get(id) || null : null;
        this.onTabChange(tab);
        this.renderTabs();
    }

    getActiveTab(): TabData | null {
        return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
    }

    switchToNext(): void {
        const ids = Array.from(this.tabs.keys());
        const currentIndex = ids.indexOf(this.activeTabId || '');
        const nextIndex = (currentIndex + 1) % ids.length;
        this.activateTab(ids[nextIndex]);
    }

    switchToPrevious(): void {
        const ids = Array.from(this.tabs.keys());
        const currentIndex = ids.indexOf(this.activeTabId || '');
        const prevIndex = (currentIndex - 1 + ids.length) % ids.length;
        this.activateTab(ids[prevIndex]);
    }

    switchToPosition(position: number): void {
        const ids = Array.from(this.tabs.keys());
        if (position === 9) {
            // Last tab
            this.activateTab(ids[ids.length - 1]);
        } else if (position >= 1 && position <= ids.length) {
            this.activateTab(ids[position - 1]);
        }
    }

    moveTab(direction: 'prev' | 'next' | 'start' | 'end'): void {
        // Implement tab reordering
    }

    private renderTabs(): void {
        const container = document.getElementById('tab-container');
        if (!container) return;

        container.innerHTML = '';

        this.tabs.forEach((tab, id) => {
            const tabElement = document.createElement('div');
            tabElement.className = `tab ${id === this.activeTabId ? 'active' : ''}`;
            tabElement.innerHTML = `
                <span class="tab-title">${tab.title}</span>
                <button class="tab-close">×</button>
            `;

            tabElement.addEventListener('click', () => this.activateTab(id));
            tabElement.querySelector('.tab-close')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.closeTab(id);
            });

            container.appendChild(tabElement);
        });

        // Add new tab button
        const newTabBtn = document.createElement('button');
        newTabBtn.className = 'new-tab-btn';
        newTabBtn.textContent = '+';
        newTabBtn.addEventListener('click', () => {
            // Trigger file open dialog
        });
        container.appendChild(newTabBtn);
    }

    isFileOpen(filePath: string): boolean {
        for (const tab of this.tabs.values()) {
            if (tab.filePath === filePath) {
                this.activateTab(tab.id);
                return true;
            }
        }
        return false;
    }
}
```

#### 5.2 Tab Container HTML

```html
<!-- src/index.html -->
<div id="header">
    <div id="tab-container" class="tab-bar">
        <!-- Tabs rendered dynamically -->
    </div>
    <div id="menu">
        <!-- Preset buttons -->
    </div>
</div>
```

#### 5.3 Tab Styling

```scss
// src/css/_tabs.scss
.tab-bar {
    display: flex;
    background: #2d2d2d;
    overflow-x: auto;

    .tab {
        display: flex;
        align-items: center;
        padding: 8px 12px;
        background: #2d2d2d;
        color: #ccc;
        cursor: pointer;
        max-width: 200px;

        &.active {
            background: #1e1e1e;
        }

        &:hover {
            background: #3d3d3d;
        }

        .tab-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            direction: rtl;
            text-align: right;
        }

        .tab-close {
            margin-left: 8px;
            background: none;
            border: none;
            color: #777;
            cursor: pointer;

            &:hover {
                color: #fff;
            }
        }
    }

    .new-tab-btn {
        padding: 8px 16px;
        background: none;
        border: none;
        color: #777;
        cursor: pointer;

        &:hover {
            color: #fff;
        }
    }
}
```

#### 5.4 Sortable Tabs (Optional Enhancement)

```typescript
// Can use SortableJS for drag-drop reordering
import Sortable from 'sortablejs';

Sortable.create(document.getElementById('tab-container')!, {
    animation: 150,
    filter: '.new-tab-btn',
    onEnd: (evt) => {
        // Update tab order in TabManager
    }
});
```

### Deliverables

- [ ] TabManager class implemented
- [ ] Tab bar UI rendering
- [ ] Tab creation on file open
- [ ] Tab closing with history
- [ ] Tab switching (click, keyboard)
- [ ] Active tab highlighting
- [ ] Duplicate file detection
- [ ] Per-tab filter settings preserved

### Verification

- Open multiple PDFs
- Each opens in new tab
- Click tabs to switch
- Close tabs with X button
- Filter settings preserved per tab

---

## Phase 6: File Operations

**Goal:** Implement file opening, drag-and-drop, and CLI support.

**Priority:** High
**Complexity:** Medium
**Dependencies:** Phase 5

### Tasks

#### 6.1 Add Dialog Plugin

```bash
# In src-tauri/Cargo.toml
[dependencies]
tauri-plugin-dialog = "2"
```

```rust
// src-tauri/src/main.rs
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(...)
        .run(tauri::generate_context!())
        .expect("error");
}
```

#### 6.2 File Open Dialog

```typescript
// src/scripts/file-operations.ts
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

export async function openFileDialog(): Promise<string[] | null> {
    const files = await open({
        multiple: true,
        filters: [{
            name: 'PDF Files',
            extensions: ['pdf']
        }]
    });

    if (files) {
        return Array.isArray(files) ? files : [files];
    }
    return null;
}

export async function openFiles(paths: string[]): Promise<void> {
    for (const path of paths) {
        const fileName = await invoke<string>('get_file_name', { path });
        // Check if already open
        if (!tabManager.isFileOpen(path)) {
            tabManager.createTab(path, fileName);
            // Load PDF
        }
    }
}
```

#### 6.3 Drag and Drop

```typescript
// src/scripts/main.ts
import { listen } from '@tauri-apps/api/event';

// Listen for file drops
listen<string[]>('tauri://file-drop', async (event) => {
    const files = event.payload.filter(f => f.endsWith('.pdf'));
    if (files.length > 0) {
        await openFiles(files);
    }
});

// Enable drop on splash screen
const splash = document.getElementById('splash-container');
splash?.addEventListener('dragover', (e) => {
    e.preventDefault();
});
```

#### 6.4 CLI Arguments

```rust
// src-tauri/src/main.rs
use clap::Parser;

#[derive(Parser)]
#[command(name = "NightPDF")]
#[command(about = "Dark Mode PDF Reader")]
struct Cli {
    /// PDF file(s) to open
    #[arg(value_name = "PDF")]
    files: Vec<String>,

    /// Page to open
    #[arg(short, long)]
    page: Option<u32>,
}

fn main() {
    let cli = Cli::parse();

    tauri::Builder::default()
        .setup(|app| {
            if !cli.files.is_empty() {
                // Emit event to frontend with files
                let window = app.get_webview_window("main").unwrap();
                window.emit("open-files", (&cli.files, cli.page))?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error");
}
```

#### 6.5 Handle CLI Files in Frontend

```typescript
// src/scripts/main.ts
import { listen } from '@tauri-apps/api/event';

listen<[string[], number | null]>('open-files', async (event) => {
    const [files, page] = event.payload;
    await openFiles(files);
    if (page) {
        pdfViewer.goToPage(page);
    }
});
```

#### 6.6 Print Support

```typescript
// src/scripts/main.ts
function printCurrentPDF(): void {
    // PDF.js has built-in print support
    window.print();
}
```

### Deliverables

- [ ] File open dialog working
- [ ] Multi-file selection
- [ ] Drag and drop onto splash
- [ ] Drag and drop onto window
- [ ] CLI file opening
- [ ] CLI page selection (-p flag)
- [ ] Print functionality

### Verification

- Ctrl+O opens file dialog
- Select multiple files, all open in tabs
- Drag PDF onto window, opens
- `./nightpdf document.pdf` opens file
- `./nightpdf -p 5 document.pdf` opens at page 5

---

## Phase 7: Settings System

**Goal:** Implement persistent settings storage and settings UI.

**Priority:** High
**Complexity:** Medium
**Dependencies:** Phase 1

### Tasks

#### 7.1 Add Store Plugin

```bash
# In src-tauri/Cargo.toml
[dependencies]
tauri-plugin-store = "2"
```

#### 7.2 Settings Schema

```typescript
// src/scripts/settings.ts
export interface NightPDFSettings {
    version: string;
    general: {
        maximizeOnOpen: boolean;
        displayThumbs: boolean;
    };
    keybinds: Record<string, KeybindConfig>;
}

export const DEFAULT_SETTINGS: NightPDFSettings = {
    version: '3.0.0',
    general: {
        maximizeOnOpen: true,
        displayThumbs: true
    },
    keybinds: {
        // Default keybinds
    }
};
```

#### 7.3 Settings Manager

```typescript
// src/scripts/settings-manager.ts
import { Store } from '@tauri-apps/plugin-store';

export class SettingsManager {
    private store: Store;
    private settings: NightPDFSettings;

    constructor() {
        this.store = new Store('settings.json');
        this.settings = DEFAULT_SETTINGS;
    }

    async load(): Promise<NightPDFSettings> {
        const stored = await this.store.get<NightPDFSettings>('settings');
        if (stored) {
            this.settings = { ...DEFAULT_SETTINGS, ...stored };
        }
        return this.settings;
    }

    async save(): Promise<void> {
        await this.store.set('settings', this.settings);
        await this.store.save();
    }

    get<K extends keyof NightPDFSettings>(key: K): NightPDFSettings[K] {
        return this.settings[key];
    }

    async set<K extends keyof NightPDFSettings>(
        key: K,
        value: NightPDFSettings[K]
    ): Promise<void> {
        this.settings[key] = value;
        await this.save();
    }
}
```

#### 7.4 Settings Window

```rust
// src-tauri/src/window.rs
use tauri::{AppHandle, Manager, WebviewWindowBuilder, WebviewUrl};

pub fn open_settings_window(app: &AppHandle) -> Result<(), tauri::Error> {
    let main_window = app.get_webview_window("main").unwrap();

    WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("settings.html".into())
    )
    .title("Settings - NightPDF")
    .parent(&main_window)?
    .inner_size(600.0, 400.0)
    .resizable(false)
    .build()?;

    Ok(())
}
```

#### 7.5 Settings UI

```html
<!-- src/settings.html -->
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8" />
    <title>Settings - NightPDF</title>
    <link rel="stylesheet" href="/css/settings.css" />
</head>
<body>
    <div id="settings-page">
        <nav id="settings-menu">
            <div class="menu-item active" data-panel="general">General</div>
            <div class="menu-item" data-panel="keybinds">Keybinds</div>
            <div class="menu-item" data-panel="version">Version</div>
        </nav>

        <main id="settings-content">
            <section id="panel-general" class="panel">
                <div class="setting-item">
                    <label for="maximizeOnOpen">Maximize On Open</label>
                    <input type="checkbox" id="maximizeOnOpen" />
                </div>
                <div class="setting-item">
                    <label for="displayThumbs">Display Thumbnails</label>
                    <input type="checkbox" id="displayThumbs" />
                </div>
            </section>

            <section id="panel-keybinds" class="panel hidden">
                <!-- Keybind settings -->
            </section>

            <section id="panel-version" class="panel hidden">
                <div id="version-info"></div>
            </section>
        </main>
    </div>
    <script type="module" src="/scripts/settings-page.ts"></script>
</body>
</html>
```

### Deliverables

- [ ] Store plugin integrated
- [ ] Settings schema defined
- [ ] Settings load on app start
- [ ] Settings persist across restarts
- [ ] Settings window opens (Alt+S)
- [ ] General settings UI
- [ ] Settings changes save immediately
- [ ] Version info displayed

### Verification

- Change a setting
- Close and reopen app
- Setting persists

---

## Phase 8: Keyboard Shortcuts

**Goal:** Implement global shortcuts and customizable keybinds.

**Priority:** High
**Complexity:** High
**Dependencies:** Phase 7

### Tasks

#### 8.1 Add Global Shortcut Plugin

```bash
# In src-tauri/Cargo.toml
[dependencies]
tauri-plugin-global-shortcut = "2"
```

#### 8.2 Define Keybind Actions

```typescript
// src/scripts/keybinds.ts
export interface KeybindAction {
    id: string;
    displayName: string;
    defaultBinds: string[];
    action: string;
    data?: string;
}

export const KEYBIND_ACTIONS: KeybindAction[] = [
    {
        id: 'OpenWindow',
        displayName: 'Open New PDF',
        defaultBinds: ['CmdOrCtrl+T'],
        action: 'openNewPDF'
    },
    {
        id: 'CloseWindow',
        displayName: 'Close Tab',
        defaultBinds: ['CmdOrCtrl+W', 'CmdOrCtrl+F4'],
        action: 'closeTab'
    },
    {
        id: 'ReOpen',
        displayName: 'Reopen Tab',
        defaultBinds: ['CmdOrCtrl+Shift+T'],
        action: 'reopenTab'
    },
    {
        id: 'SwitchTab',
        displayName: 'Next Tab',
        defaultBinds: ['CmdOrCtrl+Tab', 'CmdOrCtrl+PageDown'],
        action: 'switchTab',
        data: 'next'
    },
    {
        id: 'PreviousTab',
        displayName: 'Previous Tab',
        defaultBinds: ['CmdOrCtrl+Shift+Tab', 'CmdOrCtrl+PageUp'],
        action: 'switchTab',
        data: 'prev'
    },
    // ... more actions
];
```

#### 8.3 Register Shortcuts in Rust

```rust
// src-tauri/src/shortcuts.rs
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

pub fn register_shortcuts(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app.get_webview_window("main").unwrap();

    // Register Ctrl+1 through Ctrl+9 for tab switching
    for i in 1..=9 {
        let shortcut = format!("CmdOrCtrl+{}", i);
        app.global_shortcut().on_shortcut(
            shortcut.parse::<Shortcut>()?,
            move |_app, _shortcut, _event| {
                window.emit("switch-tab", i).unwrap();
            }
        )?;
    }

    Ok(())
}
```

#### 8.4 Frontend Shortcut Handler

```typescript
// src/scripts/main.ts
import { listen } from '@tauri-apps/api/event';

// Listen for shortcut events from backend
listen<string>('switch-tab', (event) => {
    tabManager.switchToPosition(event.payload);
});

listen('close-tab', () => {
    const tab = tabManager.getActiveTab();
    if (tab) {
        tabManager.closeTab(tab.id);
    }
});

// ... etc
```

#### 8.5 Keybind Editor UI

```typescript
// src/scripts/keybind-editor.ts
export class KeybindEditor {
    private overlay: HTMLElement;
    private capturedKeys: string[] = [];

    show(actionId: string, bindIndex: number): void {
        this.overlay.classList.remove('hidden');

        const handleKeyDown = (e: KeyboardEvent) => {
            e.preventDefault();

            if (e.key === 'Escape') {
                this.hide();
                return;
            }

            // Capture modifiers + key
            const parts: string[] = [];
            if (e.ctrlKey || e.metaKey) parts.push('CmdOrCtrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');

            if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
                parts.push(e.key);
                this.capturedKeys = parts;
                this.updateDisplay();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
    }

    private updateDisplay(): void {
        const display = this.overlay.querySelector('#keybind-display');
        if (display) {
            display.textContent = this.capturedKeys.join(' + ');
        }
    }

    hide(): void {
        this.overlay.classList.add('hidden');
        this.capturedKeys = [];
    }

    save(): string {
        return this.capturedKeys.join('+');
    }
}
```

### Deliverables

- [ ] Global shortcut plugin integrated
- [ ] Default keybinds registered
- [ ] Tab switching shortcuts (Ctrl+1-9)
- [ ] Tab navigation shortcuts
- [ ] Custom keybind storage
- [ ] Keybind editor overlay
- [ ] Keybind validation
- [ ] Clear keybind button

### Verification

- Press Ctrl+T, file dialog opens
- Press Ctrl+W, tab closes
- Press Ctrl+1, first tab activates
- Edit keybind in settings, new bind works

---

## Phase 9: Application Menu

**Goal:** Implement native application menu.

**Priority:** Medium
**Complexity:** Medium
**Dependencies:** Phase 6, Phase 7

### Tasks

#### 9.1 Create Menu in Rust

```rust
// src-tauri/src/menu.rs
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Wry,
};

pub fn create_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "print", "Print", false, Some("CmdOrCtrl+P"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Settings", true, Some("Alt+S"))?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Undo"))?,
            &PredefinedMenuItem::redo(app, Some("Redo"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Cut"))?,
            &PredefinedMenuItem::copy(app, Some("Copy"))?,
            &PredefinedMenuItem::paste(app, Some("Paste"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "zoom_reset", "Reset Zoom", true, Some("CmdOrCtrl+0"))?,
            &MenuItem::with_id(app, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+="))?,
            &MenuItem::with_id(app, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("Toggle Fullscreen"))?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Minimize"))?,
        ],
    )?;

    let help_menu = Submenu::with_items(
        app,
        "Help",
        true,
        &[
            &MenuItem::with_id(app, "learn_more", "Learn More", true, None::<&str>)?,
            &MenuItem::with_id(app, "license", "License", true, None::<&str>)?,
            &MenuItem::with_id(app, "bugs", "Report Bug", true, None::<&str>)?,
            &MenuItem::with_id(app, "contact", "Contact", true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[&file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
    )
}
```

#### 9.2 Handle Menu Events

```rust
// src-tauri/src/main.rs
use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let menu = menu::create_menu(app.handle())?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "open" => {
                    app.emit("menu-open", ()).unwrap();
                }
                "print" => {
                    app.emit("menu-print", ()).unwrap();
                }
                "settings" => {
                    window::open_settings_window(app).unwrap();
                }
                "learn_more" => {
                    open::that("https://github.com/Lunarequest/NightPDF").unwrap();
                }
                "license" => {
                    open::that("https://github.com/Lunarequest/NightPDF/blob/mistress/LICENSE").unwrap();
                }
                "bugs" => {
                    open::that("https://github.com/Lunarequest/NightPDF/issues").unwrap();
                }
                "contact" => {
                    open::that("mailto:luna@nullrequest.com").unwrap();
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error");
}
```

#### 9.3 Dynamic Menu Updates

```rust
// Enable/disable print menu item
#[command]
pub fn set_print_enabled(app: AppHandle, enabled: bool) {
    if let Some(menu) = app.menu() {
        if let Some(item) = menu.get("print") {
            item.as_menuitem().unwrap().set_enabled(enabled).unwrap();
        }
    }
}
```

### Deliverables

- [ ] File menu (Open, Print, Settings)
- [ ] Edit menu (Undo, Redo, Cut, Copy, Paste)
- [ ] View menu (Zoom controls, Fullscreen)
- [ ] Window menu (Minimize)
- [ ] Help menu (Learn More, License, Bugs, Contact)
- [ ] Menu accelerators working
- [ ] Print menu enables when PDF loaded
- [ ] Help links open in browser

### Verification

- All menu items visible
- Accelerators trigger actions
- Help links open external browser

---

## Phase 10: Window Management

**Goal:** Implement window resizing, maximize behavior, and multi-window support.

**Priority:** Medium
**Complexity:** Low
**Dependencies:** Phase 7

### Tasks

#### 10.1 Window Resize on PDF Open

```rust
// src-tauri/src/commands.rs
#[command]
pub async fn resize_window_for_pdf(window: tauri::Window) -> Result<(), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;

    if size.width < 1000 || size.height < 650 {
        window.set_size(tauri::Size::Physical(
            tauri::PhysicalSize { width: 1000, height: 650 }
        )).map_err(|e| e.to_string())?;
        window.center().map_err(|e| e.to_string())?;
    }

    Ok(())
}
```

#### 10.2 Maximize on Open Setting

```typescript
// src/scripts/main.ts
async function onPDFLoaded(): Promise<void> {
    const settings = await settingsManager.load();

    if (settings.general.maximizeOnOpen) {
        await invoke('maximize_window');
    }

    await invoke('resize_window_for_pdf');
}
```

#### 10.3 Force Dark Theme

```rust
// src-tauri/src/main.rs
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();

            // Force dark theme
            #[cfg(target_os = "macos")]
            {
                use tauri::Theme;
                window.set_theme(Some(Theme::Dark)).ok();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error");
}
```

#### 10.4 Show Window After Load

```typescript
// src/scripts/main.ts
import { getCurrentWindow } from '@tauri-apps/api/window';

async function init(): Promise<void> {
    // Initialize app...

    // Show window after initialization
    const window = getCurrentWindow();
    await window.show();
}
```

### Deliverables

- [ ] Window starts hidden, shows after load
- [ ] Auto-resize to minimum when PDF opens
- [ ] Maximize on open (if setting enabled)
- [ ] Dark theme forced on all platforms
- [ ] Minimum window size enforced

### Verification

- Open PDF in small window
- Window resizes to 1000x650
- Window maximizes if setting enabled

---

## Phase 11: Platform Integration

**Goal:** Configure file associations, MIME types, and auto-updater.

**Priority:** Medium
**Complexity:** Medium
**Dependencies:** Phase 6

### Tasks

#### 11.1 File Associations

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "fileAssociations": [
      {
        "ext": ["pdf"],
        "name": "PDF Document",
        "role": "Viewer"
      },
      {
        "ext": ["xdp"],
        "name": "XFA Document",
        "role": "Viewer"
      },
      {
        "ext": ["fdf"],
        "name": "FDF Document",
        "role": "Viewer"
      },
      {
        "ext": ["xfdf"],
        "name": "XFDF Document",
        "role": "Viewer"
      }
    ],
    "linux": {
      "mimeTypes": [
        "application/pdf",
        "application/x-pdf",
        "application/vnd.adobe.xdp+xml",
        "application/vnd.adobe.xfdf",
        "application/vnd.fdf"
      ]
    }
  }
}
```

#### 11.2 Handle File Open Events

```rust
// src-tauri/src/main.rs
fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // Handle files opened via file association
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            app.listen("tauri://file-open", |event| {
                // Handle file open
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error");
}
```

#### 11.3 Auto-Updater

```bash
# In src-tauri/Cargo.toml
[dependencies]
tauri-plugin-updater = "2"
```

```rust
// src-tauri/src/main.rs
use tauri_plugin_updater::UpdaterExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                if let Ok(update) = handle.updater().check().await {
                    if let Some(update) = update {
                        // Notify user of update
                        update.download_and_install(|_, _| {}, || {}).await.ok();
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error");
}
```

#### 11.4 Platform-Specific Builds

```json
// src-tauri/tauri.conf.json
{
  "bundle": {
    "targets": ["deb", "rpm", "appimage", "dmg", "nsis", "msi"],
    "linux": {
      "appimage": {
        "bundleMediaFramework": true
      }
    },
    "macOS": {
      "dmg": {},
      "hardenedRuntime": true
    },
    "windows": {
      "nsis": {
        "oneClick": false,
        "allowElevation": true
      }
    }
  }
}
```

### Deliverables

- [ ] PDF file association on all platforms
- [ ] MIME type registration on Linux
- [ ] Auto-updater checking GitHub releases
- [ ] Update notification to user
- [ ] Platform-specific installers configured

### Verification

- Double-click PDF file, NightPDF opens
- App checks for updates on startup
- Build creates correct installer format per platform

---

## Phase 12: Polish & Optimization

**Goal:** Final polish, error handling, and performance optimization.

**Priority:** Medium
**Complexity:** Medium
**Dependencies:** All previous phases

### Tasks

#### 12.1 Error Handling

```typescript
// src/scripts/error-handler.ts
import { message } from '@tauri-apps/plugin-dialog';

export async function handleError(error: Error, context: string): Promise<void> {
    console.error(`[${context}]`, error);

    await message(
        `An error occurred: ${error.message}`,
        { title: 'Error', kind: 'error' }
    );
}

// Wrap async operations
export function withErrorHandling<T>(
    fn: () => Promise<T>,
    context: string
): Promise<T | null> {
    return fn().catch(async (error) => {
        await handleError(error, context);
        return null;
    });
}
```

#### 12.2 Logging

```bash
# In src-tauri/Cargo.toml
[dependencies]
tauri-plugin-log = "2"
```

```rust
// src-tauri/src/main.rs
use tauri_plugin_log::{Target, TargetKind};

fn main() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                ])
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error");
}
```

#### 12.3 Performance Optimization

```typescript
// Lazy load PDF.js
const loadPDFJS = () => import('pdfjs-dist');

// Debounce filter updates
import { debounce } from './utils';

const updateFilters = debounce((settings: FilterSettings) => {
    pdfViewer.applyFilter(buildFilterCSS(settings));
}, 16); // ~60fps
```

#### 12.4 Splash Screen Polish

```typescript
// Show splash when no tabs
function updateSplashVisibility(): void {
    const splash = document.getElementById('splash-container');
    const tabCount = tabManager.getTabCount();

    if (tabCount === 0) {
        splash?.classList.remove('hidden');
    } else {
        splash?.classList.add('hidden');
    }
}
```

#### 12.5 Security Hardening

```json
// src-tauri/tauri.conf.json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
      "dangerousDisableAssetCspModification": false
    }
  }
}
```

```rust
// Validate file paths
#[command]
pub fn validate_pdf_path(path: String) -> Result<String, String> {
    let path = std::path::Path::new(&path);

    // Check extension
    match path.extension().and_then(|e| e.to_str()) {
        Some("pdf") | Some("xdp") | Some("fdf") | Some("xfdf") => {}
        _ => return Err("Invalid file type".to_string()),
    }

    // Resolve to absolute path
    std::fs::canonicalize(path)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}
```

#### 12.6 Version Display

```rust
// src-tauri/src/commands.rs
#[command]
pub fn get_version() -> String {
    let version = env!("CARGO_PKG_VERSION");
    let pdfjs_version = include_str!("../../.pdfjs_version").trim();

    format!(
        "NightPDF: v{} PDF.js: {} Tauri: {}",
        version,
        pdfjs_version,
        tauri::VERSION
    )
}
```

### Deliverables

- [ ] Graceful error handling with user feedback
- [ ] File logging for debugging
- [ ] Performance optimizations (debouncing, lazy loading)
- [ ] Splash screen shows/hides correctly
- [ ] CSP configured properly
- [ ] File path validation
- [ ] Version info displays correctly
- [ ] All console warnings resolved

### Verification

- Attempt to open invalid file, error shown gracefully
- Check log files exist
- UI remains responsive during operations
- No console errors in production build

---

## Migration Considerations

### Differences from Electron

| Aspect | Electron | Tauri |
|--------|----------|-------|
| Backend Language | JavaScript (Node.js) | Rust |
| Bundle Size | ~150MB+ | ~10-20MB |
| Webview | Chromium (bundled) | System webview |
| IPC | preload + contextBridge | invoke + events |
| File Access | Node.js fs module | Tauri fs plugin |
| Settings | electron-store | tauri-plugin-store |
| Shortcuts | electron-localshortcut | tauri-plugin-global-shortcut |
| Tabs | electron-tabs | Custom implementation |

### Code Reuse

The following can be largely reused:

- Filter calculations (`app/helpers/sliders.ts`)
- Filter presets
- CSS styles (with minor adjustments)
- HTML structure
- TypeScript types

The following need rewriting:

- All Rust backend code
- IPC communication
- Tab management system
- File operations
- Settings storage
- Keyboard shortcuts

### Testing Strategy

1. **Unit tests** for Rust commands
2. **Integration tests** for IPC
3. **E2E tests** using WebDriver
4. **Manual testing** checklist per phase

---

## Risk Assessment

### High Risk

| Risk | Mitigation |
|------|------------|
| PDF.js compatibility with system webview | Test on all target platforms early |
| Tab system complexity | Start simple, iterate |
| System webview inconsistencies | Test on Linux (WebKitGTK), Windows (WebView2), macOS (WebKit) |

### Medium Risk

| Risk | Mitigation |
|------|------------|
| Global shortcuts conflicts | Provide customization, test with common apps |
| Auto-updater platform differences | Test update flow on each platform |
| File association registration | Test with clean OS installs |

### Low Risk

| Risk | Mitigation |
|------|------------|
| Settings migration | Version field allows migration logic |
| Menu differences | Use platform-standard patterns |

---

## Timeline Summary

| Phase | Description | Priority |
|-------|-------------|----------|
| 1 | Project Foundation | Critical |
| 2 | Core PDF Viewing | Critical |
| 3 | Dark Mode Core | Critical |
| 4 | Dark Mode Customization | High |
| 5 | Tab System | High |
| 6 | File Operations | High |
| 7 | Settings System | High |
| 8 | Keyboard Shortcuts | High |
| 9 | Application Menu | Medium |
| 10 | Window Management | Medium |
| 11 | Platform Integration | Medium |
| 12 | Polish & Optimization | Medium |

**Minimum Viable Product (MVP):** Phases 1-6
**Feature Complete:** Phases 1-10
**Production Ready:** Phases 1-12
