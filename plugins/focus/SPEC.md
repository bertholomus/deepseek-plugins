# Focus — plugin spec (v3, 0.2.1)

A pomodoro / countdown timer for DeepSeek Harness Desktop. No network calls but its own route, no
keys, no new dependencies. State lives host-side with an **absolute `endAt`**, and the host ends a
timer itself, so the countdown and the count are right across reloads, restarts and with no window.

v2 (0.2.0) changed the v1 contract in five places, marked **(v2)** below: the host ends timers
itself and `complete` only asks it to check; `start` and `set` are refused while a timer runs;
minutes are whole; the answers carry `rev` and `problems`; the client is drawn with DSH's own parts
and tokens, as DESIGN.md asks, instead of v1's glass recipe.

v3 (0.2.1) adds, marked **(v3)**: the end leaves a mark until a panel shows it (`timer.doneSeen`,
op `seen`); `undo` after a Reset; a hidden window says the end when shown again; the footer seat in
DSH's narrow rail and a DSH keyboard shortcut; no paths in the words the window shows.

## Host contract — `lib/impl.js` (loaded by `lib/index.js` with a fresh URL on every enable)

```js
export const name = 'focus';
export const inject = [];
export async function apply(ctx, config) { ... }
```

- `config`: `{ dataDir }`, checked by `checkConfig(raw, env)` **(v2)**: default
  `<DSH_HOME>/focus` (`DSH_HOME = env.DSH_HOME || ~/.dsh`); a value that is not a full path (or `~/…`)
  keeps the default and is said in words (`problems`), never thrown. `lib/index.js` declares
  `Config = z.object({ dataDir: z.any() })`, so DSH takes any value and Focus checks it. **(v3)** The
  words name no path ("its default folder (focus in DSH's data folder)"); when there is a problem,
  `apply` logs `its folder: <dataDir>` to DSH's log, and focus.log's `started` line names the folder.
- Files: `state.json` (tmp + rename), `focus.log` (ISO stamp per line; past 1 MB renamed to
  `focus.log.1`) **(v2)**. A folder that cannot be made or written is a `problems` entry; the timer
  keeps working in memory. **(v3)** Its words give the reason (`whyInWords`: "a file is in the way",
  "no permission to write there", "the disk is read-only", "the disk is full") and no path; focus.log
  and DSH's log have the path and the code.
- Route: `connection.fetch.register({ path: '/api/focus/state', methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], requestBody: 'buffered', fetch })`
  inside `ctx.inject(['connection'], …)` and `c.effect(…)`, so it goes with the plugin.
- `GET` → `{ settings, timer, sessions, rev, problems }`, `cache-control: no-store`.
- `POST` body `{ settings?, op? }`. Everything is validated first; a refused request changes nothing.
  - `settings` patch: `focusMin`, `shortMin`, `longMin` (numbers; **(v2)** rounded to whole minutes,
    clamped 1–180), `chime` (boolean). Only changed keys count as a change.
  - `op`, after the patch:

| op | effect |
| --- | --- |
| `{ op:'start', kind, durationMs }` | new running timer, `endAt = now + durationMs` (clamped 10 000–10 800 000), `doneAt: null`, `doneSeen: false`. **(v2)** 409 while one runs. |
| `{ op:'pause' }` | `remainingMs = max(0, endAt − now)`, `endAt: null`, `running: false`; nothing when idle |
| `{ op:'resume' }` | `endAt = now + remainingMs`, `running: true`, `doneAt: null`; nothing when running. **(v3)** Logged with its end. |
| `{ op:'reset' }` | idle, `remainingMs = durationMs`, `doneAt: null`. **(v3)** A timer that had started (running, or paused with time gone) is kept in memory for `undo`. |
| `{ op:'set', kind, durationMs }` | idle timer of that kind and length. **(v2)** 409 while one runs. |
| `{ op:'complete' }` | **(v2)** ends the timer only if `endAt ≤ now + 1500 ms`, as of `endAt`; otherwise nothing |
| `{ op:'seen' }` | **(v3)** an idle timer with a `doneAt` and `doneSeen: false` gets `doneSeen: true` (logged once); otherwise nothing |
| `{ op:'undo' }` | **(v3)** the timer as it was before the last Reset of a started timer, if that Reset made the current `rev` and was at most `UNDO_MS` (60 s) ago; a running one keeps its `endAt` (and ends at once, as of it, if it has passed). Otherwise 409 "There is no Reset to undo: the timer changed since, or the Reset was more than a minute ago." Memory only: a restart forgets it. |

- **(v2) The host's own end.** While a timer runs the host holds a timer for `endAt` (+25 ms). At
  the end: `running: false`, `endAt: null`, `remainingMs = durationMs`, `doneAt = endAt`,
  **(v3)** `doneSeen: false`; a `focus` kind adds one to `sessions.focus` if `endAt`'s local day is
  today; the end is logged once (with how late, past 5 s). At start a timer whose end has passed
  ends the same way. Every read and write first ends a due timer, so `complete` from two windows, a
  reload or a restart can count only once.
- Canonical `timer`: `{ kind: 'focus'|'short'|'long'|'custom', durationMs, remainingMs, endAt: number|null, running: boolean, doneAt: number|null, doneSeen: boolean }`.
  Running → `endAt` is the truth; idle → `remainingMs` is (never more than `durationMs`). **(v3)** A
  saved state without `doneSeen` (0.2.0, 0.1.0) reads as seen when it has a `doneAt`, so an upgrade
  marks nothing old; the older versions drop the field.
- `sessions`: `{ date: 'YYYY-MM-DD' (server-local day), focus: n }`; a read on a new day resets it
  (a change, so `rev` moves).
- **(v2)** `rev`: +1 per change (saved with the state); `problems`: the setting's and the folder's
  problems, in words.
- Errors are answers: 400 (bad JSON, not an object, unknown op or kind, wrong types) and 409 with a
  sentence that says what to do; 405 with `Allow: GET, POST` for PUT, PATCH and DELETE (the route
  names them so DSH hands them over; DSH answers 404 for any other method); anything else 500 with
  the reason, and the log has it. No throw reaches DSH.
- `createFocus({ dataDir, problems, now, day, setTimer, clearTimer, say, logMaxBytes })` holds the
  working parts with its clock and timers handed in, so the tests run time forward by hand.

## Client contract — `lib/client.js` (v2: DESIGN.md)

Hand-written React, no build step: `window.__ModuleLoader__.load({ id: "dsh-plugin-focus", factory })`,
`require("react")` and `require("@deepseek-ai/dsh-client-ui-primitives")` (listed in
`package.json` `dsh.client.inject`). Returns `{ name: "dsh-plugin-focus", inject: ["slots", "locale"], apply, logic }`
(`logic`: `seatTaken`, `phaseOf`, `nextOf`, `unseenEnd` and the shortcut's id and keys, for tests).

- Slots: `sidebar.footer.action` id `dsh-plugin-focus:open` order 91 (the footer button);
  `shell.overlay` id `dsh-plugin-focus:overlay` order 41 (the panel and the toast).
- Parts: DSH's `Modal` (title "Focus timer", the main button marked `data-modal-autofocus`), `Button`,
  `Switch`, `Input`, `Toast` (with `holdMs` and `actions`) and `Tooltip`; a part is used when present
  (a part may be an object).
- Data: GET on apply and when the panel opens; then every 5 s while the window is visible and on
  `visibilitychange`; a new state is taken only when `rev` (or `problems`) moved. A 1 s local tick
  draws the countdown. At zero the window POSTs `complete` once per `endAt`, as a nudge.
- The end: a `timer.doneAt` not seen before in this window (never the one found at the first read)
  is said in DSH's toast, held 12 s **(v3)** — focus: "Focus session done. Time for a break.",
  breaks: "Break over. Ready to focus?", custom: "Timer done." — with the next step as the toast's
  action **(v3)**, and chimed (two sine notes, 659.25 Hz and 987.77 Hz; the AudioContext is made on
  the first click in the window and closed on cleanup) if `settings.chime`. A `doneAt` more than
  60 s old is said with its time ("Focus session done at 10:25 AM. Time for a break."), without the
  chime, and not at all if `doneSeen` is already true.
- **(v3) A hidden window** (`document.visibilityState === "hidden"`) chimes at the end and keeps the
  end pending; on `visibilitychange` to visible it reads the host and says the end with its time,
  unless the end was seen (`doneSeen`) or replaced (another `doneAt`, or a running timer) meanwhile.
- **(v3) The mark.** While `doneAt` is set, the timer idle and `doneSeen === false`, the footer button
  has a green dot (`fc-dot fc-dot-done`, `data-focus-mark="ended"`), the name "Focus timer: Focus
  session done at 10:25 AM" and that tooltip. A panel open in a visible window POSTs `seen` once per
  `doneAt`, so the mark goes in every window.
- States in words at the top of the panel: `<Kind> · ready, 25:00`, `· running, ends at 10:25 AM`,
  `· paused, 12:40 left`, `· done at 10:25 AM`. The footer button's name says the minutes left; its
  tooltip the exact time.
- The next step: in the done state the main button starts the pomodoro's next timer: after `focus` a
  `short` break (`long` when today's count is a multiple of 4), after a break `focus`, at the preset
  lengths; after `custom` the same timer again ("Start again"). **(v3)** The clock shows that next
  length under a caption naming it ("Short break next", "Custom again"); the end's toast has the same
  action.
- **(v3) Reset and Undo.** A Reset of a running or paused timer is said in a toast ("Focus session
  reset.", held 10 s) whose action POSTs `undo`; a refused undo is a "Not changed: …" toast.
- **(v3) The rail.** DSH hands the footer entry `{ wide }`. When `wide === false` (the folded rail, one
  footer row 36 px wide), Focus measures DSH's footer outlet (`[data-slot="sidebar.footer.action"]`):
  if an entry before its own has a box (itself or a child, three levels down), Focus draws no button
  and keeps only its box-less seat (`span.fc-seat`, `display: contents`, `data-focus-seat="given"`),
  watching the outlet (a MutationObserver on its children and subtree) to take the seat back when
  that entry goes. Wide, it always draws its button.
- **(v3) The shortcut.** Through `ctx.inject(["shortcuts"], …)` (only where DSH has the service), one
  command: id `dsh-plugin-focus.open`, label "Open the Focus timer", defaults `KeyF` with primary, alt
  and shift for `desktop:macos`, `desktop:windows`, `desktop:linux`, `web:macos`, `web:windows`;
  regions `page` and `editable`; it opens the panel when closed. If DSH refuses the defaults (a
  clash), it is registered without defaults, to be bound in DSH's Keyboard shortcuts. Its disposer
  runs with the plugin's scope.
- Errors: no state at all → "Focus can't reach its timer: <why>. Check that the Focus plugin is on in
  Plugins, then try again." with Try again; a later failed read keeps the state with a note; a refused
  op → a toast "Not changed: <the host's words>"; the host's `problems` at the bottom of the panel.
- Focus: opens on the main button; Escape (DSH's Modal) closes; the focus goes back to what had it
  when the panel opened (the footer button, when that opened it).
- The custom length field has its visible name ("Custom") in the same label as the field.
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
  setting, storage failures, the log bound, `seen` and `undo`, `apply`'s wiring; the client drawn
  with stand-in parts (the footer's marks, a hidden window, the toasts' actions, the rail seat on
  stand-in DOM nodes, the shortcut); the style sheet and source held to DESIGN.md; README held to the
  code; runs `lib/impl.test.mjs`.
- `lib/impl.test.mjs`: the host through a fake `ctx` with real `Request`s, in a temporary folder.
- `test/e2e/run.mjs` (`node scripts/e2e.mjs focus`): a real DSH and a real window, as the README says.
