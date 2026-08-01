# Monight Code Review

- **Date:** 2026-07-30
- **Version reviewed:** 1.0.6
- **Branch:** `develop` @ `9542969`
- **Scope:** Full codebase (~7,900 LOC) — frontend viewer, app orchestration, Rust backend, config, packaging

## Summary

Monight is a Tauri 2 + TypeScript PDF reader. The architecture is genuinely good: pure logic
is extracted into testable `src/lib/` modules (scroll geometry, output-scale capping,
dimensions), `src/app/` cleanly separates orchestration concerns, the Rust side validates paths
and URL schemes properly, and 43 tests pass. Recent commits show real engineering discipline —
O(1) scroll geometry, lazy PDF engine loading, canvas area capping.

The gaps are: a few live bugs, and a feature set that is thin for a daily-driver PDF reader.

---

## 1. Confirmed bugs

Each item below was verified by reading the code and, where noted, by running it. Fix these first.

### 1.1 `Cmd+1` through `Cmd+8` do nothing — tab switching is broken

**Severity:** High — a shipped feature that silently does not work.

`src/scripts/keybind-manager.ts:100-108` keys the lookup map by `config.action` rather than by
the action ID:

```ts
const actionKey = config.action || actionId;   // 'switchToTab' for all nine entries
this.keybinds.set(actionKey, parsed);          // each iteration overwrites the previous
if (config.data) this.actionData.set(actionKey, config.data);
```

All nine `SwitchToTab*` entries in `src/scripts/settings.ts:151-204` share
`action: 'switchToTab'`, so each `.set()` overwrites the last. Only `SwitchToTab9` survives.

**Verified empirically** with a throwaway Vitest file run against the real `DEFAULT_SETTINGS`:

```
× Cmd+1 switches to tab 1     → AssertionError: expected null to be 'switchToTab'
× Cmd+3 switches to tab 3     → AssertionError: expected null to be 'switchToTab'
× surviving switchToTab binds → AssertionError: expected 1 to be 9
✓ Cmd+9 works
```

`actionData` collides identically and ends as `'9'`, so even a repaired lookup map would route
every tab shortcut to the last tab.

**Fix:** key `keybinds` by `actionId`; store `action` and `data` per entry rather than using
`action` as the map key.

### 1.2 Drag-and-drop is completely dead

**Severity:** High — an advertised feature that cannot fire.

`src/app/tauri-events.ts:84,119,123` listen for Tauri **v1** event names:

| Listened for (v1) | Actual Tauri 2 name |
| --- | --- |
| `tauri://file-drop` | `tauri://drag-drop` |
| `tauri://file-drop-hover` | `tauri://drag-enter` |
| `tauri://file-drop-cancelled` | `tauri://drag-leave` |

Confirmed against `node_modules/@tauri-apps/api/event.d.ts:60-63`. The payload shape also
changed — v2 sends `{ type, paths, position }`, not a bare `string[]`, so
`event.payload.filter(...)` at `tauri-events.ts:88` would throw even if the event name matched.

There is dead `body.drag-over` styling at `src/styles/main.css:139-148` that can never activate.

**Fix:** use `getCurrentWebview().onDragDropEvent()`, which normalizes all four event types.

### 1.3 Global keybinds hijack text inputs

**Severity:** Medium — visible UX defect.

`matchEvent` (`src/scripts/keybind-manager.ts:118`) has no check for whether focus is inside an
editable element, and `src/app/dom-events.ts:174` calls `preventDefault()` on any match.

Reproduction: click `#page-input`, press ArrowUp → jumps a page instead of incrementing the
number. `Home` / `End` jump to first/last page instead of moving the caret.

**Fix:** guard on `e.target` being `input` / `textarea` / `[contenteditable]`.

### 1.4 Placeholder URLs ship to users

**Severity:** Medium — user-visible, reputational.

`src-tauri/src/menu.rs:224-242`:

- Help → Learn More → `https://github.com/yourusername/yourrepo`
- Help → License → `https://github.com/yourusername/yourrepo/blob/master/LICENSE`
- Help → Report Bug → `https://github.com/yourusername/yourrepo/issues`
- Help → Contact → `mailto:your-email@example.com`

The actual remote is `https://github.com/ssword/Monight.git`. The License link also points at a
file that does not exist (see §4).

### 1.5 Cold open is O(n) in page count before first paint

**Severity:** Medium — scales badly with document size.

`src/scripts/pdf-viewer.ts:302-309` loops over **every page** calling `await getPage()` and
`getViewport()` before rendering page 1:

```ts
for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
  const page = await this.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1.0, rotation: 0 });
  this.baseDimensions.set(pageNum, { width: viewport.width, height: viewport.height });
}
await this.renderPage(1);
```

On a 1,500-page document this is 1,500 sequential worker round-trips before anything appears on
screen.

**Fix:** compute page 1 immediately and render, then populate the dimension cache lazily or in a
background pass. The cache already has a fallback path
(`pdf-viewer.ts:1221-1230`) for entries that are missing, so partial population is safe.

### 1.6 Rotation is silently lost; `scrollPosition` is a dead field

**Severity:** Medium — contradicts the project's stated core purpose.

- `TabData` (`src/scripts/tabs.ts:7-17`) has no `rotation` field, and `SavedTabSession`
  (`src/scripts/settings.ts:4-11`) does not persist it. Rotate a page, restart the app, rotation
  is gone. (`ViewState` at `pdf-viewer.ts:23-31` tracks it in memory, so it survives tab
  switching within a session but not a restart.)
- `TabData.scrollPosition` is declared at `tabs.ts:15` and initialized to `0` at `tabs.ts:63`,
  and is **never read or written anywhere else** in the codebase.

`CONTEXT.md` defines the project's central concept as preserving "each document's reading
position and visual state." Restoring only a page number under-delivers on that.

### 1.7 `Cmd+Shift+=` does not zoom in

**Severity:** Low.

`parseAccelerator` (`keybind-manager.ts:39-79`) turns `'CmdOrCtrl+Plus'`
(`settings.ts:91-94`) into `key: 'plus'`, but `KeyboardEvent.key` is never the literal string
`"plus"` — it is `'+'`. Verified: that bind matches `null`. The `'CmdOrCtrl+='` alias works, so
zoom-in is reachable, but the documented `+` shortcut is not.

### 1.8 `.fdf` / `.xdp` / `.xfdf` are registered file associations PDF.js cannot open

**Severity:** Low-Medium — bad first-run experience via Finder/Explorer double-click.

`src-tauri/tauri.conf.json` registers all four extensions as file associations.
`read_pdf_bytes` (`src-tauri/src/commands.rs:65-76`) accepts them. `loadPDF`
(`pdf-viewer.ts:291`) then hands the bytes to `getDocument()`, which cannot parse forms-data
formats and throws a raw `InvalidPDFException` at the user.

**Fix:** either drop the associations, or detect the format and show a meaningful message.

---

## 2. Functionality worth adding

Ranked by user value per unit of effort.

| Feature | Why | Effort |
| --- | --- | --- |
| **Text search (`Cmd+F`)** | The single biggest gap. Text layers already render, so the data is present. Non-negotiable for a PDF reader. | Medium |
| **Outline / TOC sidebar** | `pdfDoc.getOutline()` plus the existing `resolveDestinationPage()` (`pdf-viewer.ts:486`) — most of the work is already written. | Small |
| **Ctrl/Cmd+scroll & pinch zoom** | Zero wheel handlers exist anywhere in `src/`. Every PDF reader has this; its absence reads as broken. | Small |
| **Page thumbnails sidebar** | `displayThumbs` is a live toggle in Settings (`settings.html:402-412`) labeled "(future feature)" that does nothing. | Medium |
| **Precise scroll restore** | Finish what `scrollPosition` was meant to do — restore the exact offset, not the page top. Directly serves the stated project goal. | Small |
| **Recent files on splash** | The splash is currently a logo and one button. | Small |
| **Encrypted-PDF password prompt** | Password-protected PDFs currently fail with a raw error. | Small |
| **Two-page / spread view** | Standard for books and papers. | Medium |
| **Presentation mode** | Fullscreen, no chrome, arrow-key paging. | Small |
| **Annotations & highlights** | The big differentiator, and the natural bridge to the AI features in the README roadmap. | Large |

---

## 3. Code health

### 3.1 `pdf-viewer.ts` is 1,594 lines doing six jobs

Rendering, continuous scroll, text layers, link layers, context menus, and printing all live in
one class. `renderPage()` (`:734`) and `renderPageToContinuousCanvas()` (`:1370`) are roughly
90% duplicated — identical `approximateFraction` → `floorToDivide` → outputScale → render
sequence.

**Suggested split:** extract one `renderToSurface(page, viewport, surface)` helper, then separate
into `PdfRenderer` / `ContinuousScrollController` / `PageInteractionLayer`.

### 3.2 Tests cover the safe parts, not the risky ones

All 43 tests target pure `src/lib/` functions. There is zero coverage of `PDFViewer`,
`TabManager`, or session restore — which is exactly where bugs 1.1, 1.2, 1.5, and 1.6 live. A
single test asserting `Cmd+1 → switchToTab` would have caught 1.1.

### 3.3 Smaller items

- **12 `alert()` / `confirm()` calls** across `src/` block the UI thread and look non-native.
  Replace with in-app toasts.
- **48 `console.log` calls** ship to production. Gate behind `import.meta.env.DEV`.
- **Zero `aria-` attributes** in `index.html`. Toolbar buttons are glyph-only (`◀`, `⬌`, `⊟`)
  with no accessible names; there is no focus management.
- **`withGlobalTauri: true`** (`src-tauri/tauri.conf.json`) exposes the full IPC surface on
  `window`. Unnecessary — the app imports the API properly. Turn it off.
- **Settings migration** keys off a string `version` field (`settings.ts:326-353`) that is bumped
  every release, rewriting the store even when the schema did not change. A numeric
  `schemaVersion` decoupled from the app version is more robust.
- **`updateActivePresetButton`** (`src/app/ui.ts:42`) compares presets with `JSON.stringify` —
  key-order dependent and fragile.

---

## 4. Release readiness

- **No LICENSE file.** README says "TBD" and the Help menu links to a LICENSE that does not
  exist. This blocks anyone from legally using or contributing to the project.
- **No CI.** No `.github/` directory. Tests and lint exist but nothing runs them automatically.
- **No auto-updater.** `tauri-plugin-updater` is absent from `src-tauri/Cargo.toml`. The app
  ships DMG/MSI/deb/rpm/AppImage targets with no upgrade path.
- **No code signing / notarization config.** Unsigned macOS builds are Gatekeeper-blocked.
- **Window size and position are not persisted** across launches
  (`tauri-plugin-window-state`), which contradicts the app's own "preserve reading state" thesis.
- **No CHANGELOG.**
- **`docs/performance-benchmarks.md`** is still an all-`pending` scaffold.

---

## 5. Suggested order of work

1. **Bugs 1.1–1.4** — small diffs, all user-visible; two are shipped-broken features.
2. **LICENSE + a GitHub Actions workflow** running `npm test`, `biome check`, and `cargo test`.
3. **Bug 1.5** (O(n) cold open) and **bug 1.6** (persist rotation + scroll offset).
4. **Text search, then outline sidebar** — the two features that most change daily usability.
5. **Split `pdf-viewer.ts`** and add tests around `TabManager` and session restore.
6. **Auto-updater + code signing** before any wider distribution.

---

## Appendix: verification notes

- `npm test` → 8 files, 43 tests, all passing (136ms).
- Bug 1.1 confirmed by a temporary Vitest file asserting `matchEvent` results against the real
  `DEFAULT_SETTINGS`; the file was deleted after the run.
- Bug 1.2 event names cross-checked against `node_modules/@tauri-apps/api/event.d.ts` and the
  `DragDropEvent` type in `webview.d.ts:20-35`.
- Absence of search / outline / thumbnails / wheel-zoom confirmed by grep across `src/`,
  `index.html`, and `settings.html`.
- Absence of LICENSE, CHANGELOG, `.github/`, and `tauri-plugin-updater` confirmed by direct
  filesystem and manifest checks.
