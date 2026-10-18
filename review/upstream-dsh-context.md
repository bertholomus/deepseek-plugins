# dsh-context upstream note (Wallpaper thread, release/glass-v1)

Re-check of Wallpaper's optional dsh-context skin against dsh-context **0.72.0** on DSH
0.2.1-rc.2 (Desktop app.asar read-only; the plugin read at
`~/.dsh/profiles/desktop/node_modules/dsh-context`, version confirmed `0.72.0` by its
package.json). Nothing was posted anywhere — this file is the proposed text, per the brief.

## Result of the re-check: no upstream hook is required

Wallpaper's skin (plugins/wallpaper/lib/client.js, "skins" section) only repaints grounds of
surfaces dsh-context itself draws, keyed on dsh-context's own hand-written classes:

| Wallpaper rule | dsh-context 0.72.0 fact it keys on | Status |
| --- | --- | --- |
| `body.wp-on .lc-ov-page` → conversation-card glass | `.lc-ov-page` is the overview page root (`<section class="lc-ov-page">`) and paints `background: var(--dsw-alias-bg-base)` | matches |
| `body.wp-on :is(.lc-ov-page,.lc-root)` → remap `--dsw-alias-bg-layer-1/2/3` to faint fills | `.lc-root` is the right-sidebar pane root (and the error boundary root); cards read `var(--dsw-alias-bg-layer-1)` (24 uses), `-2` (41), `-3` (1) | matches |
| `body.wp-on .lc-modal-card` → Wallpaper's floating material | `.lc-modal-card` is the version-gate modal card, paints `--dsw-alias-bg-layer-1` | matches |

All three class names are hand-written (not CSS-module hashes), so they are stable across builds,
and the skin applies only when dsh-context is loaded. No dsh-context code was copied or vendored.

## If an upstream ask were useful later (draft only — do not send)

Two small asks would make third-party skins like Wallpaper's cheaper and less fragile. Both are
enhancements, not bugs, and nothing in 0.72.0 blocks them:

> **Subject: A stable mark for surface roots (for wallpaper/skin mods)**
>
> Hi — Wallpaper (the glass mod) skins dsh-context's overview page, right-sidebar pane and
> version-gate modal by keying on `.lc-ov-page`, `.lc-root` and `.lc-modal-card`. That works on
> 0.72.0, but it couples the mod to three internal class names. Two things would make this robust:
>
> 1. A stable attribute on surface roots — e.g. `data-lc-surface="overview-page" | "pane" |
>    "modal"` — so skins can key on one contract instead of three class names.
> 2. Keep grounds on the semantic tokens (`--dsw-alias-bg-base`, `--dsw-alias-bg-layer-*`) rather
>    than literals. 0.72.0 already does this — thank you; it is what lets a skin remap the layers
>    to faint glass fills without touching dsh-context's styles.
>
> Happy to send a PR for (1) if you agree on the attribute name.

## Coordinates (for whoever posts it)

- Repo: github.com/bowenliang123/dsh-context, npm `dsh-context` 0.72.0.
- Where the classes live: `lib/client.js` (single style tag injected with
  `data-plugin="dsh-context"`; `.lc-ov-page{…background:var(--dsw-alias-bg-base)…}`,
  `.lc-modal-card{…background:var(--dsw-alias-bg-layer-1)…}`).
- Wallpaper side: plugins/wallpaper/lib/client.js, "skins" section, rules commented "dsh-context
  0.72.0".
