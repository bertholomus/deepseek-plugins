# Suite plugins — glass skins and 0.2.1 pass (thread t6)

Scope: `plugins/{autopilot,decisions,agent-terminals,session-watch}`, branch `release/glass-v1`.
Reference: `DESIGN.md` at the repo root; the 0.2.1-rc.2 client in `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` (read-only).

## How the 0.2.1-rc.2 re-check was done

- Token sheet: scanned every `@deepseek-ai/dsh-*` client package inside the app's asar (via
  `ELECTRON_RUN_AS_NODE=1 …/MacOS/DeepSeek Harness -e …`, read-only) for token definitions — 458
  `--dsw/--dsh/--ds` tokens defined in 0.2.1-rc.2.
- Slot keys: the same scan; every slot the suite injects was matched against 0.2.1 code
  (`main`, `sidebar.panellist`, `plugins.bundle.config`, `sidebar.session.row.leading`,
  `sidebar.session.row.hover`, `sidebar.workspaces.session.menu.item`).
- Selectors: each client grepped for `:has(`, DSH hash fragments (`[class*="<hash>`), and
  selectors styling `:root`/`html`/`body`.

## Shared verdict (all four plugins)

The four clients share one window kit (copied from `shared/client-kit.js`; `npm test` checks the
copies). It already implements the DESIGN section 3 recipe, so this pass verified rather than
restyled:

- Unpainted `-page` root (`box-sizing`, `padding:12px`, `[data-platform=darwin]` adds
  `--dsh-frame-top-clearance`); content on `-card` glass (`--x-glass`, blur `--wp-blur` + 
  `saturate(140%)`, `1px` `--dsw-alias-border-l2`, `--dsw-radius-lg`); `-main` cards at
  `--x-conv` (tint + .2); nested cards at `--x-fill`, no second blur.
- Deepened text: `--x-text-2` (secondary → 80% label) and `--x-glyph` (tertiary → 75% label);
  state words deepened per DESIGN section 4 (error 85%, link 85%, ok 60%, warn 55/45%).
- `prefers-reduced-transparency: reduce` raises glass to ≥ .9; `body.wp-still` and
  `prefers-reduced-motion` stop animation/transition on roots, children and pseudo-elements.
- Style injection wrapped in try/catch, marked `data-plugin`/`data-plugin-css`, removed on off
  (`ctx.effect(() => () => kit.removeStyle())`).
- All 28 DSH tokens used are defined in 0.2.1-rc.2 (none fall back silently).
- No `:has()` anywhere; no DSH hash selectors (agent-terminals reaches DSH's session rows only
  via `data-row-key^="session:"` ending in its own mark — a row key, per rule 8); nothing styled
  on `:root`/`html`/`body` (only the rule book's own `body:not([data-ds-dark-theme])` and
  `body.wp-still` scoping forms).
- Two-surface table applied: pages in `main` are own surfaces (unpainted root + glass cards);
  panel-list entries, the Plugins-page settings forms, session-row marks/hover/menu items draw
  inside DSH's surfaces with DSH's tokens and no ground of their own.
- `node --check` passes on all four clients; `npm test` 550/550 (includes the kit-copy check and
  the naming scan).

## Per-plugin

### Autopilot — PASS (verified, no changes needed)

- 0.2.1-rc.2: tokens ✓, slots (`main`, `sidebar.panellist`, `plugins.bundle.config`) ✓.
- Surfaces: page in `main` (own, glass cards; header/sessions/log cards, `-main` on the read
  cards); panel entry with count badge (DSH tokens); settings form on DSH's Plugins page.
- Host tests: `npm test` 550 pass. `node --check` OK.
- Shots (`review/glass-v1/autopilot/`, DSH Test `glass-suite`, 1280×820, Wallpaper at tint 20):
  01–02 lake light/dark, 03 Plugins page (settings inside DSH's surface), 04–05 dark car
  picture light/dark, 06–07 Wallpaper off light/dark. Off leaves nothing behind; on again
  redraws. No page errors in the window during any shot run.

### Decisions — see its commit (below)

### Agent Terminals — see its commit (below)

### Session Watch — see its commit (below)

## Rig (scratch, not committed)

`review/glass-v1/rig/shots.mjs` — Playwright against the glass-suite instance's web link
(swiftshader args per DESIGN section 10), deleted when release prep ends. Wallpaper pictures and
`state.json` seeded in `~/.dsh-test-glass-suite/wallpaper/` (lake = light picture, black car =
dark picture, tint 20, rotate off).
