# MEMORY.md — Monight project conventions

Durable notes for `ssword/Monight`. Session-by-session detail lives in the dated logs
next to this file; only things worth knowing *before* starting work belong here.

## Git

- **Active branch is `develop`**, not `main`/`master`. `origin` is
  `git@github.com:ssword/Monight.git` over SSH. `master` exists on the remote too and
  moves independently — don't assume `develop` is the only line.
- **Conventional Commits, lowercase, no scopes.** Observed types in use:
  `feat:`, `fix:`, `docs:`, `chore:`, `design:`, `style:`. Subjects are imperative and
  kept short; many carry a body that explains *why*. `design:` is the established type
  for brand/visual work here.
- **`design/` and `monight-brand_assets/` are versioned**, including generated images
  (the brand canvas `monight-brand.miora` references the assets by filename, so they
  have to travel together). Roughly 6 MB of assets is already committed — fine, don't
  reach for Git LFS.
- **`.workbuddy/memory/` IS tracked.** Agent memory logs get committed like any other
  artifact; `2026-09-11.md` landed inside a `design:` commit. So bundling the day's log
  with that day's work commit is the house convention, not an accident.
- **`.gitignore` has no pattern for `.workbuddy/`.** Read the ignore list before
  assuming something is intentionally untracked. Note `agents.md` is ignored — and on
  macOS's case-insensitive filesystem that pattern also catches `AGENTS.md`, which is
  why the agent workflow doc is present locally but absent from the repo.
- **No git hooks** (no `.husky`, no custom `.git/hooks`), so commits won't be
  reformatted or linted on the way in. Run formatters yourself if it matters.
- Committer identity: `Andrew Chen <ssword@gmail.com>`.

## Frontend styling

- **There are two palettes, not one.** `src/styles/main.css` defines the CSS variables;
  `settings.html` carries its own fully hard-coded inline palette and does **not**
  inherit them. Both now hold an identical brand token block — a change to one must be
  mirrored in the other or the settings window drifts away from the reader.
- Palette source of truth is `design/brand-2026/BRAND.md` §3 (colour) and §7 (UI token
  mapping, incl. the two-surface sync rule and computed contrast ratios).
- `--bg-elevated` is a third surface tier beyond `--bg-primary` / `--bg-secondary`:
  only genuinely floating layers (dialogs, toasts, popovers) may use it.

## Brand deliverables — what is safe to reuse

- The current mark is the **brush-stroke M with a warm-cream crescent in its right
  counter**. The v1 hard-edged flat lockup is **retired**; anything derived from it is
  void. `design/brand-2026/BRAND.md` is the authority.
- **The canvas lies about status.** `monight-brand.miora` was last written 10 minutes
  *before* BRAND.md settled, so its four items still titled `★ 定稿 · …` (平面符号主版 /
  平面拉丁锁定 / 单色版 / 反白版) are exactly the retired pieces. Trust §6 of the doc,
  not the canvas label.
- Usable as-is (filenames are stable — the canvas references them):
  `776a848b-…-fcc61c8a8133.jpg` 笔触垂直锁定 · `dde71623-…-5207a085eea8.jpg` 平面简化版
  (symbol only) · `e4725001-…` 暗底 A · `27dcb498-…` 暗底 B · `6125999b-…` 暗底 C.
  The remaining ~8 materials are 需重锚 — layouts usable, artwork not.
- **Text baked into generated brand art is not trustworthy.** §5.1 of the doc already
  warned about it; the 2026-09-15 re-anchor batch proved it again — the rendered VI
  handbook carried wrong hex (`#0C1868`, `#FFFTFF`, `#6E67A6`) and mangled the brand name
  on a business card. Quote colour only from §3, and treat any handbook render as layout
  reference. Swatch rows are better generated without hex captions at all.
- **The doc describes a filter preset the app doesn't have.** §4 calls「印象 / Impression」
  a built-in preset; the real set lives in `src/scripts/filters.ts` (`PRESETS`) and is
  `default / original / redeye / sepia` plus a `custom` button that only opens the
  configurator, labelled in `index.html`. Either the doc or the roadmap has to move.
- **App icon: divergence resolved in principle, draft exists, repo not yet touched.**
  ssword chose to **redraw the icon on the brush M** (not keep it as a separate product
  icon). Draft lives in `design/app-icon-m-2026/` — vector source `monight-icon-m.svg`,
  rendered `-1024/512/256/128/64/32/16.png`, plus `-proof.png` / `-small-sizes.png`.
  geometry is *measured* from the approved material `dde71623-…jpg`, not redrawn;
  colours are §3 tokens (the material's own navy/cream have generation drift —
  sampled `#011127` / `#FBE0A6`, don't reuse those). The squircle container is
  inherited by copying the alpha channel of `design/app-icon-2026/monight-native-default-1024.png`,
  so it can't drift. **Still open:** pick colourway A/B/C (B=paper base, C=low-contrast
  `#8FAECF` silhouette), and then wire into `src-tauri/icons/` via
  `npm run icons:generate`. Until that runs, the shipped icon is still the v1 one.
