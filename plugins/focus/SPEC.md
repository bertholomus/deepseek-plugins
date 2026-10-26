# Focus — plugin spec (v2, 0.2.0)

A pomodoro / countdown timer for DeepSeek Harness Desktop. No network calls but its own route, no
keys, no new dependencies. State lives host-side with an **absolute `endAt`**, and the host ends a
timer itself, so the countdown and the count are right across reloads, restarts and with no window.

v2 changes the v1 contract in five places, each marked **(v2)** below: the host ends timers itself
and `complete` only asks it to check; `start` and `set` are refused while a timer runs; minutes are
whole; the answers carry `rev` and `problems`; the client is drawn with DSH's own parts and tokens,
as DESIGN.md asks, instead of v1's glass recipe.

## Host contract — `lib/impl.js` (loaded by `lib/index.js` with a fresh URL on every enable)

```js
export const name = 'focus';
export const inject = [];
export async function apply(ctx, config) { ... }
```

- `config`: `{ dataDir }`, checked by `checkConfig(raw, env)` **(v2)**: default
  `<DSH_HOME>/focus` (`DSH_HOME = env.DSH_HOME || ~/.dsh`); a value that is not a full path (or `~/…`)
  keeps the default and is said in words (`problems`), never thrown. `lib/index.js` declares
  `Config = z.object({ dataDir: z.any() })`, so DSH takes any value and Focus checks it.
- Files: `state.json` (tmp + rename), `focus.log` (ISO stamp per line; past 1 MB renamed to
  `focus.log.1`) **(v2)**. A folder that cannot be made or written is a `problems` entry; the timer
  keeps working in memory.
- Route: `connection.fetch.register({ path: '/api/focus/state', methods: ['GET', 'POST'], requestBody: 'buffered', fetch })`
  inside `ctx.inject(['connection'], …)` and `c.effect(…)`, so it goes with the plugin.
- `GET` → `{ settings, timer, sessions, rev, problems }`, `cache-control: no-store`.
- `POST` body `{ settings?, op? }`. Everything is validated first; a refused request changes nothing.
  - `settings` patch: `focusMin`, `shortMin`, `longMin` (numbers; **(v2)** rounded to whole minutes,
    clamped 1–180), `chime` (boolean). Only changed keys count as a change.
  - `op`, after the patch:

| op | effect |
| --- | --- |
| `{ op:'start', kind, durationMs }` | new running timer, `endAt = now + durationMs` (clamped 10 000–10 800 000). **(v2)** 409 while one runs. |
| `{ op:'pause' }` | `remainingMs = max(0, endAt − now)`, `endAt: null`, `running: false`; nothing when idle |
| `{ op:'resume' }` | `endAt = now + remainingMs`, `running: true`, `doneAt: null`; nothing when running |
| `{ op:'reset' }` | idle, `remainingMs = durationMs`, `doneAt: null` |
| `{ op:'set', kind, durationMs }` | idle timer of that kind and length. **(v2)** 409 while one runs. |
| `{ op:'complete' }` | **(v2)** ends the timer only if `endAt ≤ now + 1500 ms`, as of `endAt`; otherwise nothing |

- **(v2) The host's own end.** While a timer runs the host holds a timer for `endAt` (+25 ms). At
  the end: `running: false`, `endAt: null`, `remainingMs = durationMs`, `doneAt = endAt`; a `focus`
  kind adds one to `sessions.focus` if `endAt`'s local day is today; the end is logged once (with how
  late, past 5 s). At start a timer whose end has passed ends the same way. Every read and write first
  ends a due timer, so `complete` from two windows, a reload or a restart can count only once.
- Canonical `timer`: `{ kind: 'focus'|'short'|'long'|'custom', durationMs, remainingMs, endAt: number|null, running: boolean, doneAt: number|null }`.
  Running → `endAt` is the truth; idle → `remainingMs` is (never more than `durationMs`).
- `sessions`: `{ date: 'YYYY-MM-DD' (server-local day), focus: n }`; a read on a new day resets it
  (a change, so `rev` moves).
- **(v2)** `rev`: +1 per change (saved with the state); `problems`: the setting's and the folder's
  problems, in words.
- Errors are answers: 400 (bad JSON, not an object, unknown op or kind, wrong types) and 409 with a
  sentence that says what to do; 405 with `Allow: GET, POST` for PUT, PATCH and DELETE (the route
  names them so DSH hands them over; DSH answers 404 for any other method); anything else 500 with the reason, and
  the log has it. No throw reaches DSH.
- `createFocus({ dataDir, problems, now, day, setTimer, clearTimer, say, logMaxBytes })` holds the
  working parts with its clock and timers handed in, so the tests run time forward by hand.

## Client contract — `lib/client.js` (v2: DESIGN.md)

Hand-written React, no build step: `window.__ModuleLoader__.load({ id: "dsh-plugin-focus", factory })`,
`require("react")` and `require("@deepseek-ai/dsh-client-ui-primitives")` (listed in
`package.json` `dsh.client.inject`). Returns `{ name: "dsh-plugin-focus", inject: ["slots", "locale"], apply }`.

- Slots: `sidebar.footer.action` id `dsh-plugin-focus:open` order 91 (the footer button);
  `shell.overlay` id `dsh-plugin-focus:overlay` order 41 (the panel and the toast).
- Parts: DSH's `Modal` (title "Focus timer", the main button marked `data-modal-autofocus`), `Button`,
  `Switch`, `Input`, `Toast` and `Tooltip`; a part is used when present (a part may be an object).
- Data: GET on apply and when the panel opens; then every 5 s while the window is visible and on
  `visibilitychange`; a new state is taken only when `rev` (or `problems`) moved. A 1 s local tick
  draws the countdown. At zero the window POSTs `complete` once per `endAt`, as a nudge.
- The end: a `timer.doneAt` not seen before (never the one found at the first read) is said in DSH's
  toast — focus: "Focus session done. Time for a break.", breaks: "Break over. Ready to focus?",
  custom: "Timer done." — and chimed (two sine notes, 659.25 Hz and 987.77 Hz; the AudioContext is
  made on the first click in the window and closed on cleanup) if `settings.chime`. A `doneAt` more
  than 60 s old is said with its time, without the chime.
- States in words at the top of the panel: `<Kind> · ready, 25:00`, `· running, ends at 10:25 AM`,
  `· paused, 12:40 left`, `· done at 10:25 AM`. The footer button's name says the minutes left; its
  tooltip the exact time.
- The next step: in the done state the main button starts the pomodoro's next timer: after `focus` a
  `short` break (`long` when today's count is a multiple of 4), after a break `focus`, at the preset
  lengths; after `custom` the same timer again.
- Errors: no state at all → "Focus can't reach its timer: <why>. Check that the Focus plugin is on in
  Plugins, then try again." with Try again; a later failed read keeps the state with a note; a refused
  op → a toast "Not changed: <the host's words>"; the host's `problems` at the bottom of the panel.
- Focus: opens on the main button; Escape (DSH's Modal) closes; the focus goes back to the footer button.
- Style: one `<style data-plugin="dsh-plugin-focus" data-plugin-css="dsh-plugin-focus/client.css">`,
  put in inside a try and removed on cleanup; classes `fc-` only, on Focus's own elements; DSH's
  tokens (`--dsw-*`, `--ds-*`) for every colour, font, corner and duration, nothing on `:root`,
  `html` or `body`; DSH's focus ring; tabular figures for times; no layer, backdrop or z-index of its
  own. Of Wallpaper's contract only `body.wp-still` is read: under it, and under
  `prefers-reduced-motion: reduce`, every animation and transition of Focus's elements and their
  pseudo-elements stops.
- Only network access: `/api/focus/*` (`window.__FOCUS_API__` overrides the base for a test page).

## Tests

- `test/focus.test.js` (the repo's `npm test`): the host on a hand-moved clock, its refusals, its
  setting, storage failures, the log bound, `apply`'s wiring; the client drawn with stand-in parts;
  the style sheet and source held to DESIGN.md; README held to the code; runs `lib/impl.test.mjs`.
- `lib/impl.test.mjs`: the host through a fake `ctx` with real `Request`s, in a temporary folder.
- `test/e2e/run.mjs` (`node scripts/e2e.mjs focus`): a real DSH and a real window, as the README says.
