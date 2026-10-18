# Calendar release notes (thread t3, glass-v1)

Branch `release/glass-v1`, plugin `plugins/calendar`. Coordinator's brief: 0.2.1-rc.2 check,
glass skin per DESIGN.md ("Where things stand" → Calendar), privacy scrub, host tests,
DSH Test screenshots light/dark × wallpaper on/off.

## 1. 0.2.1-rc.2 check — done 2026-10-18

Host side (own DSH Test instance `glass-calendar`, 0.2.1-rc.2 app):

- `dsh-test --name glass-calendar up` / `load plugins/calendar` / `restart`: rows `calendar`,
  isolated defaults `~/.dsh-test-glass-calendar/calendar/{calendar.json,calendar.log}`, `rewritten 0`.
- `dsh-test --name glass-calendar doctor`: `Import check: 0 error(s)`, `Isolation check: ok`.
  (The standing warning about `lib/store.js` deriving `~/.dsh` is the documented `dshHome()`
  helper — it reads `DSH_HOME` first, which the harness sets; no live path is reachable.)
- `POST /api/dsh-plugin-calendar/state` answers (404 on GET is the RPC surface, 415 without a
  JSON body, envelope-validated 200 with one) — endpoint present and routed on 0.2.1-rc.2.
- Window exercised end to end by the plugin's own browser e2e against the 0.2.1-rc.2 runtime
  (extracted from the installed app's asar, read-only): **60 checks** (results below).

Client half, verified in the 0.2.1-rc.2 bundles (`/Applications/DeepSeek Harness.app/…/app.asar`,
read-only extraction to /tmp; never written there):

- Tokens used by the client all defined in **both** 0.2.1-rc.2 and 0.2.0-rc.2 theme sheets:
  `--dsw-alias-label-primary/-secondary/-tertiary`, `-label-primary-foreground`,
  `-border-l1…l4`, `-bg-layer-1`, `-markdown-code-block`, `-state-{business,link,error,warn,
  success}-*` (link/error/warn/success primary), `--dsw-radius-lg/-md`, `--ds-font-family-code`
  (falls to `--dsh-font-family-code` then a mono stack). `--dsh-frame-top-clearance` is set by
  the shell at runtime in both (calendar reads it with a `0px` fallback).
- Parts used all exported by both versions' `dsh-client-ui-primitives`: `Toast` (with
  `text/tone/icon/holdMs/onDone`), `MenuSurface` (`data-menu-material`), `Menu`, `Modal`,
  `Tooltip`, `Button`, and the icons the client names.
- Slots the calendar enters all present in both: `sidebar.panellist`, `sidebar.right.pane.tab`,
  `tool.call.toolview` (chat cards), plus the ten `client.inject` packages — all shipped in both.

## 2. Glass skin per DESIGN.md — commit 5b0aa26 (+ follow-ups)

Closed every "Where things stand" → Calendar gap:

- **Own colours → DSH's, deepened (§3/§4).** The token block now derives from DSH:
  text/strong → label-primary; soft/meta → secondary 80% toward label (§3's text-2); faint →
  tertiary 75% toward label (§3's glyph; now used only for placeholders and the needs-action
  ring — the small *text* that used faint moved to the secondary level for §6's 4.5:1);
  accent → link 85% toward label; on-accent → label-primary-foreground; line/line2 → border-l2/l3;
  danger/warn/ok → state colours per §4's deepenings (light mixes, plain in dark); now → error
  primary. `--cal-chip-ring` (read, never set) is gone — the chip hairline is border-l2.
  Grounds untouched: `--cal-glass`, `--cal-conv`, `--cal-pop`, `--cal-fill/-hover/-press`,
  `--cal-shadow`, `--cal-chip-ground`; accent-soft now derives from the accent.
- **Own toasts → DSH's `ui.Toast`.** The store's one-at-a-time toast now renders DSH's banner at
  the top (success tone or warning icon; `holdMs` 3s/6s, `onDone` clears; the store's timer stays
  as the backstop). The old bottom card + `z-index:1200` and the `body:has(.dshcal-dlg)` flip rule
  are gone; `.dshcal-toast` remains only as the fallback for a DSH without the part (z 1100).
- **Own popover → DSH's `MenuSurface`.** `.dshcal-pop` now renders through `ui.MenuSurface`
  (DSH's menu material + its macOS backing) at DSH's dialog level (1000) — the plugin keeps its
  own placement (side/below/middle, sheet under 560 px). The scroll is an inner `.dshcal-pop-scroll`
  so the material never scrolls away. Fallback `.dshcal-pop-own` (no MenuSurface) draws the old
  material itself.
- **Restyled DSH Menu/Modal restored to DSH.** `.dshcal-menu` keeps only the token scope (its
  `!important` glass fill and blur removed); `.dshcal-dlg` keeps only its width — DSH's Modal
  draws its own layer-2 material, radius-panel and shadow.
- **Chat cards opaque like DSH's own** (§2): `.dshcal-chat-card`/`.dshcal-chat-line` are
  `--dsw-alias-bg-layer-1` with a `.5px` border-l4 line and `--dsw-radius-lg`, no blur;
  `.dshcal-chat-out` uses DSH's markdown code-block ground and radius-md; inside the chat the
  plugin's tokens fall back to DSH's *plain* secondary/tertiary (not the glass-deepened forms).
- **`--ds-font-family-code`** replaces `--dsh-font-mono` (3 sites), falling through
  `--dsh-font-family-code` to the old mono stack.
- **Reduced transparency (§3/§6)**: glass goes to .9/.95 under `prefers-reduced-transparency`.
- Naming/isolation unchanged: `dshcal-` classes, `data-calendar-*` marks, one style tag keyed
  `dsh-plugin-calendar/client.css`, tokens on `:is(roots)` only, no DSH-hash selector, no
  `:has()` except the plugin's own `.dshcal-option:has(input:checked)`.
- Motion rules unchanged and cover `wp-still` + reduced motion, pseudo-elements included.

## 3. Privacy scrub — done 2026-10-18 (sweep-verified, no change needed)

The brief said three calendar files carry real calendar names/events. A full sweep of
`plugins/calendar` for the scrub classes (`frankennas`, `ascent-0N`, `100.x` tails,
`bertholomus@`, `albert(lee)?`, `/tank`, `/Users/…`, `dnaclothing`, Discord ids, real person
names, every email/domain token listed and eyeballed) found **none**: all addresses are
`example.com`/fixture personas (alice@fastmail.com, me@icloud.com, ann@example.com…), all hosts
are documentation or RFC1918/CGNAT test ranges for the SSRF guard's tests. This matches
`review/history-scrub.md` §9 ("None identifiable"), which reads the brief's "3 files" as
`lib/http.js` + `test/http.test.mjs` + `test/caldav.test.mjs` — the address-carrying files, whose
`192.168.x`/`100.64.x`/`100.128.x` vectors are generic test data of the same class the Lead kept
in the root suite (192.168.1.49/192.168.1.10 "generic RFC1918 examples, not ours"). `lib/http.js`
is the SSRF guard's CIDR table itself. **No code change made**; flagged for the Lead in case the
original finding named different files.

## 4. Tests

- `node --test plugins/calendar/test/*.mjs` — **217/217 pass** (after the changes).
- `node --test test/*.test.js` (root, includes the naming scan) — **550/550 pass**.
- `node --check plugins/calendar/lib/client.js` — ok. `node --check test/e2e/ui.mjs` — ok.
- Browser e2e `test/e2e/ui.mjs` against the 0.2.1-rc.2 runtime (its own temporary DSH_HOME,
  playwright-core from `.e2e/tools`, swiftshader flags per DESIGN §10): **60/60 checks pass**
  (one check updated: the chat-card glass contract now asserts opaque DSH layer-1 grounds, per
  the new rule, instead of the old 4 % faint fill).
- Screenshots (71, light/dark × wallpaper on/off, month/week/day/agenda, narrow 420 px, dialogs,
  toasts, chat cards, agenda pane): `review/glass-v1/calendar/`.

## 5. Open items

- The 0.2.0-rc.2 npm sweep is open for the whole suite (no 0.2.0-rc.2 frontend on npm at check
  time — actually fetched `dsh-web-frontend@0.2.0-rc.2` + the theme/primitives packages; every
  token and part above **is** verified there too; the *window* itself was only exercised on
  0.2.1-rc.2). Host e2e `test/e2e/run.mjs` (scripted model, no browser) not run in this thread —
  the ui e2e covers the same host through the window; run it if the Lead wants the second lane.
- DSH Test runs of the *live* window + `fingerprint` before/after were delegated to the Lead
  (thread sessions can't exec setuid /bin/ps); command list sent 2026-10-18.
- The `MISSING TOOL calendar_*` rows in the e2e shots are the harness's own tool-gating on the
  fake model's session, not the plugin.

## Before you push (DESIGN.md)

- [x] Surfaces sit right: no ground inside DSH's surfaces (chat cards opaque, pane faint fills on
      the dock's glass); glass cards on the page (unchanged); floating layers are DSH's.
- [x] Only DSH tokens that exist in both versions (each verified in both token sheets); only
      `--wp-blur`, `--wp-tint`, `body.wp-still` read from Wallpaper.
- [x] No selector with a DSH hash; nothing on `:root`, `html` or `body`; no `:has()` reaching
      DSH's list.
- [x] Motion stops under `wp-still` and reduced motion, pseudo-elements included; glass thickens
      under reduced transparency (new).
- [x] `node --check` on the client; `node --test` 217/217; root `npm test` 550/550 (naming scan
      included).
- [x] Checked on 0.2.1-rc.2, both themes, Wallpaper on and off (browser e2e + 71 screenshots).
      0.2.0-rc.2 window check still open (tokens/parts verified there).
- [x] Off leaves nothing behind; on again repeats nothing (style tag guarded by `data-plugin-css`;
      toasts/popovers/dialogs unmount with the views).

## 6. For the Lead — dsh-test command list (glass-calendar, sent 2026-10-18)

Instance `glass-calendar` exists and is up (port 19734; calendar loaded from this checkout at
63b0daf). One command per line, with the output needed:

1. `~/.local/bin/dsh-test --name glass-calendar fingerprint` — before-line (pid + patchSha256) for
   review/RELEASE-PROGRESS.md.
2. `~/.local/bin/dsh-test --name glass-calendar status` — isolation ok; live pid + patch hash
   unchanged vs the before-line.
3. `~/.local/bin/dsh-test --name glass-calendar doctor` — Import check: 0 error(s); Isolation
   check: ok; rows: calendar.
4. `~/.local/bin/dsh-test --name glass-calendar logs -n 200` — no calendar errors/exceptions (the
   store.js "live-home paths" warning is expected; see §1).
5. Window check (the state=200 MiniMe's check used): open the test window (or `dsh-test url`),
   sign in, confirm the Calendar page renders and `POST /api/dsh-plugin-calendar/state` returns
   200 through the signed-in shell. Raw GET is 404 by design (RPC envelope; 415 without a JSON
   body) — that is the endpoint existing, not a failure.
6. `~/.local/bin/dsh-test --name glass-calendar fingerprint` — after-line, same pid + patchSha256.
7. `~/.local/bin/dsh-test --name glass-calendar destroy` — cleanup, after 1–6.

Push note: commits 5b0aa26 + 63b0daf are local; `git push gh release/glass-v1` failed twice with
"Could not resolve host: github.com" (same DNS outage as this session's npm fetches). Push when
the network is back, or fold into the next push that already carries them.
