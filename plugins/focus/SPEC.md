# Focus — plugin spec (v1)

A pomodoro / countdown timer for DeepSeek Harness Desktop. Glass-styled, zero network
calls, zero keys, zero new dependencies. State lives host-side with an **absolute
`endAt`**, so the countdown stays correct across page reloads and DSH restarts.

Reference implementation for every pattern in here: `~/.dsh-plugins/wallpaper/`
(`lib/impl.js` host, `lib/client.js` client). Read both before writing code.

## File ownership

| File | Owner |
| --- | --- |
| `lib/impl.js`, `lib/impl.test.mjs` | host thread |
| `lib/client.js` | client thread |
| `package.json`, `cordis.patch.yml`, `icon.svg`, `locale/en.json`, `lib/index.js`, `README.md` | coordinator |

Do not edit files you do not own.

## Host contract — `lib/impl.js`

```js
export const name = 'focus';
export const inject = [];
export async function apply(ctx, config) { ... }
```

- `config`: `{ dataDir }`, default `<DSH_HOME>/focus` where
  `DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')`. A test DSH keeps its
  own copy. Files: `state.json`, `focus.log`. Write state atomically (tmp + rename).
- Register routes exactly like wallpaper does:

```js
ctx.inject(['connection'], (c) => {
  const connection = c.get?.('connection') ?? c.connection;
  c.effect(() => connection.fetch.register({
    path: `/api/focus/state`, methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async (req) => { /* dispatch on req.method, wrap errors → { error } + status */ },
  }), 'focus: state');
});
```

- `GET /api/focus/state` → `Response.json({ settings, timer, sessions })`, `cache-control: no-store`.
- `POST /api/focus/state` body is `{ settings?, op? }`.
  - `settings` patch, only known keys: `{ focusMin: 25, shortMin: 5, longMin: 15, chime: true }`.
    Minutes clamped to 1–180.
  - `op` (applied after the settings patch, one op per request):

| op | effect |
| --- | --- |
| `{ op:'start', kind, durationMs }` | `timer = { kind, durationMs, endAt: now+durationMs, running: true }` (durationMs clamped 10 000–10 800 000) |
| `{ op:'pause' }` | `running:false`, `remainingMs = max(0, endAt-now)`, `endAt:null` |
| `{ op:'resume' }` | `endAt = now+remainingMs`, `running:true` |
| `{ op:'reset' }` | `running:false`, `remainingMs = durationMs`, `endAt:null`, `doneAt:null` |
| `{ op:'set', kind, durationMs }` | idle set: new kind/duration, `remainingMs = durationMs`, `running:false` |
| `{ op:'complete' }` | client fires at 0: `running:false`, `endAt:null`, `remainingMs = durationMs`, `doneAt: now`; if kind === 'focus', `sessions.focus += 1` |

- Canonical `timer`: `{ kind: 'focus'|'short'|'long'|'custom', durationMs, remainingMs, endAt: number|null, running: boolean, doneAt: number|null }`.
  Invariant: running → `endAt` authoritative (`remainingMs` is a stale cache); idle → `remainingMs` authoritative.
- `remainingOf(timer, now)` = `timer.running ? Math.max(0, timer.endAt - now) : timer.remainingMs`. **Export it** — the offline test uses it.
- `sessions`: `{ date: 'YYYY-MM-DD' (server-local day), focus: n }` — reset `focus` when the stored date is not today.
- Default state on first run: settings defaults + `timer = { kind:'focus', durationMs: 25*60_000, remainingMs: 25*60_000, endAt:null, running:false, doneAt:null }`, `sessions = { date: today, focus: 0 }`.
- Malformed body / unknown op / bad values → `{ error: '…' }` with status 400, never an unhandled throw.
- Log meaningful actions to `focus.log` (one line, ISO timestamp) like wallpaper does.

### Offline test — `lib/impl.test.mjs`

`node lib/impl.test.mjs` exits 0 with no DSH running. Use node:test. Approach:
fake the `ctx`: an object whose `inject(deps, fn)` calls `fn({ effect: () => {}, get: () => fakeConnection })`,
where `fakeConnection.fetch.register(def)` captures the route definition. Then call
`apply(ctx, { dataDir: <mkdtemp> })`, grab the captured handler, and drive it with real
`Request` objects (`new Request('http://x/api/focus/state', { method:'POST', body: JSON.stringify(...) })`).
Cover: first-run defaults; start→GET shows endAt in the future; pause→resume preserves remaining;
reset; set; complete increments sessions for focus only (not short/long); date rollover resets
focus count (test via `remainingOf`/session-roll helper — export it if needed, e.g. `rollSessions(state, dateStr)`);
bad op → 400. Clean up temp dirs.

## Client contract — `lib/client.js`

Hand-written React, no build step, loaded by DSH's module loader:

```js
window.__ModuleLoader__.load({
  id: "dsh-plugin-focus",
  factory: (require) => {
    const React = require("react");
    const ReactDOM = require("react-dom");
    const h = React.createElement;
    // …
    return { name: "dsh-plugin-focus", inject: ["slots", "locale"], apply };
  }
});
```

- `apply(ctx)`:

```js
ctx.effect(() => refresh.state(), "focus: settings");
const reg = (slot, opts, comp) => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, locale: NS, ...opts }, comp));
reg("sidebar.footer.action", { id: "fc-open", order: 91 }, FocusButton);
reg("shell.overlay", { id: "fc-overlays", order: 41, inject: () => ({ ctx }) }, (props) => h(Fragment, null, h(FocusPanel, props), h(Toast, null)));
```

  `ctx.effect(fn, label)`: if `fn` returns a function, DSH calls it as cleanup (wallpaper relies on this).
- `const API = (typeof window !== "undefined" && window.__FOCUS_API__) || "/api/focus/";`
- Behaviour:
  - Store timer state in a module-level store (`useSyncExternalStore`) shared by button and panel.
    Fetch `state` on mount and after every op; a 1000 ms interval recomputes the countdown from
    `remainingOf`-equivalent logic locally (do not re-fetch to tick).
  - When `running && endAt - Date.now() <= 0` and not yet fired: fire once — POST `{op:'complete'}`,
    refresh, show toast "Focus session complete — take a break", and if `settings.chime`, play a
    short synthesized WebAudio chime (two sine notes; AudioContext created lazily on the first user
    click; never on page load).
  - `FocusButton` (footer): timer SVG icon, same size/behaviour as wallpaper's `.wp-footbtn`
    (32×32 hit area, own class `fc-footbtn`); a small dot (own class `fc-dot`) shown while
    `timer.running`; static dot when `body.wp-still`, gentle pulse otherwise.
  - `FocusPanel`: modal exactly like wallpaper's panel pattern (`.fc-modal-wrap` backdrop click closes,
    Escape closes with a capture listener + `stopPropagation`, `role="dialog"`, `aria-modal`).
    Contents: label ("Focus" / "Short break" / "Long break" / "Custom"); big SVG progress ring
    (~180 px, stroke `fc-accent`, background track faint) with the remaining time centered in
    `'Geist Mono', ui-monospace` at ~40 px, updating every tick; preset pills Focus 25 · Short 5 ·
    Long 15 (active pill highlighted, op `set`); a custom minutes input (1–180) with Apply;
    Start / Pause / Resume, Reset; a muted "N focus sessions today" line.
  - Only network access is `/api/focus/*`. No Google Fonts link (wallpaper already loads Geist;
    when wallpaper is absent the font stack falls back to system-ui). No external assets.
- Glass aesthetic — mirror wallpaper's contract exactly (it publishes `--wp-blur`, `--wp-tint`
  and the `wp-still` class on `<body>`):
  - Panel/card backgrounds:
    dark (`body` default): `background: rgba(14,18,17,var(--wp-tint,.55)); backdrop-filter: blur(var(--wp-blur,22px)) saturate(140%);` (plus `-webkit-` prefix)
    light (`body:not([data-ds-dark-theme])`): `rgba(250,250,246,var(--wp-tint,.55))`
  - `border: 1px solid rgba(255,255,255,.09)` dark / `rgba(0,0,0,.1)` light; `border-radius: 22px`;
    `box-shadow: 0 30px 60px rgba(0,0,0,.45)` dark / `0 30px 60px rgba(0,0,0,.16)` light.
  - Text: `color: var(--wp-text, #ECEAE4)` dark, `var(--wp-text, #191E1B)` light; muted text
    `var(--wp-meta, #A9AEA8)` / `#55605A`; accent `var(--wp-accent, #7FA7F5)` / `#3F6FD8`.
  - Font stack: `Geist, system-ui, sans-serif`; mono: `'Geist Mono', ui-monospace, monospace`.
  - All classes prefixed `fc-`. Never style DSH's own elements. Put the CSS in a
    `<style data-plugin="dsh-plugin-focus">` appended to `<head>` inside an effect whose cleanup removes it.
  - Motion: no CSS animation when `body.wp-still` and honour `@media (prefers-reduced-motion: reduce)`.
