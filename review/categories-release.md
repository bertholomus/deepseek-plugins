# Categories — release prep notes (thread t4)

Branch `release/glass-v1`. Scope: `plugins/categories/**`, this file, `review/glass-v1/categories/`.

## 1. 0.2.1-rc.2 re-check — done 2026-10-17

Checked against the Desktop app bundle `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`
(read only): `@deepseek-ai/dsh-desktop 0.2.1-rc.2`. Token sheet: `dsh-client-ui-theme/lib/client.js`;
primitives and slots: `dsh-web-frontend/dist/assets`, `dsh-client-ui-workspace`, `dsh-client-ui-plugin-manager`,
`dsh-client-ui-conversation`, `dsh-client-ui-renderer`, `dsh-client-ui-layout`.

Every token the categories client uses, verified present in 0.2.1-rc.2:

| Token | Where 0.2.1-rc.2 defines it |
| --- | --- |
| `--ds-ease-in-out` | theme (`cubic-bezier(.4,0,.2,1)`) |
| `--dsw-alias-bg-base` | theme (was the page's ground; now unused — see below) |
| `--dsw-alias-border-l2` / `-l4` | theme (light/dark pairs) |
| `--dsw-alias-interactive-bg-hover` | theme (`#2631480f` light) |
| `--dsw-alias-label-primary/secondary/tertiary/caption/dimmed` | theme |
| `--dsw-alias-state-business-primary`, `-error-primary` | theme |
| `--dsw-focus-ring-color`, `--dsw-focus-ring-width` | theme (2px) |
| `--dsw-radius-sm/md/lg` | theme (8/12/16) |
| `--dsh-frame-top-clearance` | `dsh-client-ui-layout/lib/client.js` (defined) |
| `--dsh-scrollbar-width`, `--dsh-scrollbar-thumb-border` | theme |
| `--dsh-workspace-indent` | read by `dsh-client-ui-workspace` rows (`--dsh-workspace-indent,0px`) |

- `--dsh-color-bg-hover`: **nowhere in the whole 0.2.1-rc.2 asar** — an asar-wide search finds no definition.
  It was the tree-row hover token; replaced with `--dsw-alias-interactive-bg-hover` (what DSH's own workspace
  rows use for hover), so the fallback `rgba(127,127,127,.08)` is gone too.
- `--dsw-specific-sidebar-fill`: defined by the theme, but Wallpaper overrides the sidebar element's own
  background (`body.wp-on [data-slot="sidebar"]>div{background:var(--wp-glass)!important}`), not the token —
  so painting that token under Wallpaper on would draw DSH's plain fill over the glass. Removed from the
  plugin (was the pinned empty Others header's ground).
- Primitives used by the client: all 22 present in the 0.2.1-rc.2 frontend (icons `IconFolderCloseRegular`
  … `IconTrashOutlineRegular`, and `Button, Input, Menu, Modal, StateDot, Toast, Tooltip`).
- Slots and structure: `sidebar.workspaces`, `sidebar.panellist`, `shell.overlay`,
  `conversation.session.header.actions`, `data-row-key`, `data-slot` outlets, `slots.entriesOfSlot`,
  `layout.selectPanel`, `uiWorkspace.openSession` — all present in their 0.2.1-rc.2 packages.

Verdict: the client's selectors and tokens are sound on 0.2.1-rc.2 after the glass change below. The
0.2.0-rc.2 npm build was not re-swept this pass (no build locally; the tokens touched are the long-lived
ones DESIGN.md lists for both versions) — flagged as the one open check for the Lead's both-version sweep.

## 2. Glass skin per DESIGN.md — done 2026-10-17

Closed every "Where things stand → Categories" gap plus the rules 1–3/6/9–10 items in the brief:

- **Page ground (rule 3).** `.dshc-pg` no longer paints `--dsw-alias-bg-base`. The page root is unpainted;
  `.dshc-pg-content` is now the plugin's one glass card: `--dshc-glass` at tint + .2 (dense text),
  `blur(var(--wp-blur,22px)) saturate(140%)`, `1px solid var(--dsw-alias-border-l2)`, `--dsw-radius-lg`.
  Tokens defined once on `.dshc-pg` with fallbacks; light variant under `body:not([data-ds-dark-theme])`;
  near-opaque (.95) under `prefers-reduced-transparency: reduce`. With Wallpaper off the same rules read as
  a frosted card on DSH's own background. The macOS title-bar clearance moved to the scroll container
  (`[data-platform=darwin] .dshc-pg-scroll`), so the card scrolls under it like DSH's own pages.
- **Tree rows.** Hover is now `--dsw-alias-interactive-bg-hover`; the row ring uses DSH's ring
  (`--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)`) instead of the `Highlight` fallback.
- **Drop line.** `z-index: 2147483000` → `30`: content under 100, above DSH's in-page layers (11/15/20),
  below its floating parts.
- **Chevron motion.** A motion-stop rule in DESIGN.md §6's shape now covers `wp-still` and reduced motion,
  pseudo-elements included, over `.dshc-pg` and the sidebar headers (the old rule only stopped the sidebar
  chevron under reduced motion).
- **Rules 1–3, sidebar.** The pinned empty "Other workspaces" no longer paints DSH's sidebar fill; it draws
  like DSH's own rows in the list (the hover fill), and the drop mark lights it like any header's. Its hover
  and drop states come from the shared rules, so the composite-gradient rule is gone.
- **Rule 6, text on glass.** On the page card, secondary text and glyphs take the deepened forms
  (`--dshc-text-2`, `--dshc-glyph` — color-mix toward the label colour, per DESIGN.md §3): counts, note,
  states, empty state, find-clear, tree ⋯, tree meta (was opacity .65), chevron and glyphs (were opacity
  .7/.75). Inside DSH's surfaces (sidebar headers, chip) plain DSH tokens stay.
- **Rules 9–10.** Naming unchanged (`dshc-`, `data-categories-*`); motion now stops under `wp-still`.

## 3. Privacy scrub — done 2026-10-17

- `test/smoke.mjs`: all `ws:/work/albertlee` fixtures → `ws:/work/alex` (paths and the two assertion lists).
- Whole-plugin sweep for `albertlee`, `frankennas`, `ascent-0N`, `100.x`, `192.168.x`, `/tank`,
  `bertholomus@`, Discord ids, real names: clean. Remaining path-like strings are neutral fixtures
  (`/work/…`, `/home/u/…`, `/Users/u/…`).
- The smoke tests now set `DSH_HOME` to a throwaway folder before the plugin runs, so the one-time import
  reads never touch the machine's real `~/.dsh` (they did on this Mac before — the tests were reading
  Albert's live data and failing on it).

## Before you push (DESIGN.md)

- [x] Surfaces sit right: no ground inside DSH's surfaces; the page's content on one glass card at tint + .2.
- [x] Only DSH tokens that exist in 0.2.1-rc.2 (each verified in the asar); only `--wp-blur`, `--wp-tint`,
      `body.wp-still` read from Wallpaper. 0.2.0-rc.2 npm sweep still open (see §1).
- [x] No DSH-hash selector; nothing on `:root`/`html`/`body`; no `:has()` reaching DSH's list (unchanged).
- [x] Motion stops under `wp-still` and reduced motion, pseudo-elements included; glass thickens to .95
      under reduced transparency.
- [x] `node --check` on `lib/client.js`; `node --test plugins/categories/test/client.mjs
      plugins/categories/test/smoke.mjs` — 33/33 pass (20 client + 12 smoke suites incl. the scrub).
- [ ] Checked on both DSH versions, both themes, Wallpaper on and off — DSH Test screenshots in
      `review/glass-v1/categories/` (0.2.1-rc.2 Test instance).
- [x] Off leaves nothing behind; on again repeats nothing (style tag guarded by `data-plugin-css`, no
      one-time work added).

## Test runs

Appended to `review/RELEASE-PROGRESS.md` (one line per run), fingerprints recorded there.

## Screenshots — DSH Test `glass-categories` (0.2.1-rc.2), 2026-10-17

Driven over CDP at the instance's web URL (Chrome `--headless=new --no-sandbox --use-angle=swiftshader`),
1440×900, wallpaper's own glass rules active, tint .20 (`glassTint: 20`), seeded pictures in the test
home's wallpaper library (`review` collection: `light.png`, `dark.png`). Six states in
`review/glass-v1/categories/`:

| File | Theme | Wallpaper | Picture |
| --- | --- | --- | --- |
| `dark-wp-on-light-pic.png` | dark | on | light |
| `light-wp-on-light-pic.png` | light | on | light |
| `light-wp-on-dark-pic.png` | light | on | dark (the hard case) |
| `dark-wp-on-dark-pic.png` | dark | on | dark |
| `dark-wp-off.png` | dark | off | — |
| `light-wp-off.png` | light | off | — |

What they show: with Wallpaper on, the page's content is one glass card over the wall (no plain
`--dsw-alias-bg-base` sheet anywhere), the wall visible around it, the sidebar's category headers on
Wallpaper's glass; with Wallpaper off the same card reads as a subtle frosted panel on DSH's own
background (the fallbacks). The page tree's meta (workspace path) reads in the deepened secondary in all
four on-states, including light-over-dark. Wallpaper was toggled from DSH's own Plugins page in the test
instance and re-enabled after the run (`wp-on` confirmed restored); the instance is untouched otherwise.

Test-instance notes for the Lead: `dsh-plugin-categories` and `dsh-plugin-wallpaper` are loaded from this
worktree (linked), isolation check ok. Chrome's renderer helper is a setuid exec this sandbox refuses, so
screenshots ran with `--no-sandbox` (the `--single-process` fallback crashes on the real app).
