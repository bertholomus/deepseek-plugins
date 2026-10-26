# Focus

A pomodoro and countdown timer for DeepSeek Harness Desktop. One button in the sidebar footer opens
DSH's own dialog with the timer; that is all it adds. It never hides or moves DSH's controls and never
touches another plugin's UI or files.

Its job in this stack: a timer you can trust while agents work. The host keeps the time, so the
countdown is right after a reload, a restart, or with no window open at all, and a focus session is
counted once, on the day it ended.

## What it does

- **Timer.** Focus 25 · Short break 5 · Long break 15 (each length your own, 1 to 180 whole minutes),
  or a custom length. Start, Pause, Resume, Reset.
- **Kept by the host.** The end of a running timer is stored as an absolute time in Focus's own
  folder. The host ends the timer itself when that time comes, whether or not a window is open. If DSH
  was closed at the end, the timer ends as of its end time at the next start. A window that reaches
  zero only asks the host to check, so two windows or a reload never count a session twice.
- **Sessions.** Focus sessions are counted per day (the host's local day), on the day they ended.
  Breaks and custom timers are not counted. The count starts again at midnight.
- **Said when it ends.** Every open window shows DSH's toast ("Focus session done. Time for a break."
  or "Break over. Ready to focus?") and, if the chime is on, plays a short two-note chime. The sound
  is made only after your first click in the window; nothing plays on page load. A window that was
  hidden at the end says it later, with the time it ended ("Focus timer ended at 10:25 AM."), without
  the chime.
- **Live.** While a window is visible it reads the host's state every 5 seconds (one small GET; it
  redraws only when the state's revision moved), so a timer started or ended elsewhere shows within
  seconds. The countdown itself ticks in the window every second.

## Using it

Open the panel with the timer button in the sidebar footer, next to Settings. While a timer runs the
button carries a dot (it pulses; paused, it is grey) and its name says the time left in minutes, for
example "Focus timer: Focus, 18 minutes left". Its tooltip shows the exact time.

The panel says the state in words at the top:

| State | What the panel says | The main button |
| --- | --- | --- |
| ready | `Focus · ready, 25:00` | Start |
| running | `Focus · running, ends at 10:25 AM` | Pause |
| paused | `Focus · paused, 12:40 left` | Resume |
| done | `Focus · done at 10:25 AM` | Start (the same length again) |

- **Lengths.** The three preset buttons set the timer to that length; the pressed one is the current
  length. Type a custom length (1 to 180 minutes) and press Set or Enter. While a timer runs, the
  lengths are locked and the panel says "Pause or reset to choose another length." — a click never
  throws a running session away.
- **Settings.** "Chime when a timer ends" switches the chime. The three preset lengths can be typed
  (whole minutes, 1 to 180; Enter or leaving the field keeps it; a value out of range is marked and
  not kept). A preset length changed while that preset's timer is set and not started also changes
  the timer.
- **Keyboard.** The main button has the focus when the panel opens; Tab moves through the controls;
  Escape closes the panel and the focus goes back to the footer button.
- **When something is wrong.** If the window cannot read the timer at all, the panel says "Focus can't
  reach its timer: <why>. Check that the Focus plugin is on in Plugins, then try again." with a Try
  again button. If a later read fails, the panel keeps the last state and says it may be out of date.
  A change the host refuses (for example Start while a timer runs, from another window) comes back as
  a toast: "Not changed: <the host's words>". A problem with the setting or the folder is shown at the
  bottom of the panel.

## Install and set up

Focus needs no other plugin and no setting. Load it in Settings → Plugins (or list
`dsh-plugin-focus` in the profile), and the footer button appears.

The one setting is in row `focus` of the profile's `cordis.patch.yml`:

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `dataDir` | a full path (starting with `/` or `~/`) | `focus` in DSH's data folder (`$DSH_HOME/focus`, else `~/.dsh/focus`) | The folder for `state.json` (the timer, settings and count) and `focus.log`. |

```yaml
- id: focus
  config:
    dataDir: ~/Timers/focus
```

A wrong value never stops Focus: it keeps its timer in the default folder and says why, in words, in
`focus.log` (`setting: …`), in DSH's log, at the bottom of the panel, and in GET `problems`. For
example `dataDir must be a full path (starting with / or ~/), not "relative/focus"; Focus keeps its
timer in /Users/you/.dsh/focus.` A key Focus does not have is named and ignored. A changed `dataDir`
takes effect at once; the timer then lives in that folder (a first start there if it is new) and the
old folder is left as it was.

If the folder cannot be made or written, the timer still works in memory, and the panel and GET
`problems` say that a restart would lose it ("Focus could not save its timer to …; it keeps counting,
but a restart would lose the change."). Once a save works again the problem goes; a folder that could
not be made is tried again the next time Focus starts.

## Switch it off, roll it back

- **Off:** switch it off in Settings → Plugins. The footer button, the panel and the style sheet go at
  once, and the route stops answering; `state.json` stays, so switching it on again brings the same
  timer and count back. A timer that ended while it was off ends at the next start, as above.
- **Roll back:** 0.2.0 reads 0.1.0's `state.json` as it is (fractional minutes become whole ones), and
  0.1.0 reads 0.2.0's (it ignores the new `rev` field). To go back, load the 0.1.0 folder in place of
  this one.

## With Wallpaper

Focus draws only with DSH's own parts (the dialog, buttons, switch, fields, toast, tooltip) and DSH's
tokens and font, so with Wallpaper on it looks as DSH's other dialogs do under Wallpaper. Of
Wallpaper's contract it reads only `body.wp-still`: while Wallpaper's Motion switch is off, the
footer dot and the ring stop moving. The system's Reduce Motion stops them too. Focus never writes
anything on `<body>`.

## API

One route, served by DSH's own window server (signed in, the window's origin), `cache-control: no-store`.

| Request | Answer |
| --- | --- |
| `GET /api/focus/state` | `{ settings, timer, sessions, rev, problems }` |
| `POST /api/focus/state` with `{ "settings"?: {…}, "op"?: {…} }` | `{ ok: true, changed, settings, timer, sessions, rev, problems }` |

- `settings`: `focusMin`, `shortMin`, `longMin` (minutes, rounded to whole ones, kept within 1 to
  180) and `chime` (true or false). Only the keys given change.
- `timer`: `{ kind, durationMs, remainingMs, endAt, running, doneAt }`. While running, `endAt` (ms
  since 1970) is the truth and the time left is `endAt − now`; while idle, `remainingMs` is.
  `doneAt` is the end time of the last timer that ended (null after Start, Set or Reset).
- `sessions`: `{ date: "YYYY-MM-DD", focus: <count> }`, the host's local day.
- `rev`: goes up by one with every change, so a reader can tell whether anything moved.
- `problems`: what is wrong with the setting or the folder, in words; `[]` when nothing is.
- `changed`: whether this request changed anything (a Pause on an idle timer changes nothing).

The ops (`op.op`):

| Op | Fields | What it does |
| --- | --- | --- |
| `start` | `kind`, `durationMs` | Starts a new timer of that kind and length. Refused (409) while one runs. |
| `pause` | | Keeps the time left. Nothing to do when idle. |
| `resume` | | Runs on from the time left. Nothing to do when running. |
| `reset` | | Idle at the full length; clears `doneAt`. |
| `set` | `kind`, `durationMs` | An idle timer of that kind and length. Refused (409) while one runs. |
| `complete` | | Asks the host to end the timer now if its end has come (within 1.5 s); otherwise nothing. |

`kind` is one of `focus`, `short`, `long`, `custom`; `durationMs` is a number of milliseconds, kept
within 10 s to 3 h. Everything in a request is checked before anything changes, so a refused request
changes nothing, its settings included.

| Status | When |
| --- | --- |
| 200 | Done, or nothing to do (`changed: false`). |
| 400 | The body is not JSON or not an object, an unknown op or kind, a length that is not a number, `chime` not true or false. The error says which and what to send. |
| 405 | Another method than GET or POST (`Allow: GET, POST`). |
| 409 | `start` or `set` while a timer runs: "A timer is already running. Pause or reset it first." |
| 500 | Something unexpected; the error says what, and `focus.log` has it. |

## Files on disk

- `state.json`: the state above, written whole (to a temporary file, then renamed) after each change.
- `focus.log`: one line per start, pause, resume, reset, set, end, setting change and problem, with
  its time, for example `complete focus 1500s (focus sessions today: 3)`. Past 1 MB the log starts a
  new part and keeps the old one once, as `focus.log.1`.

## Tests

- `npm test` (from the repo) runs `test/focus.test.js`: the host's own end of a timer on a clock moved
  by hand (no window, a restart under a running timer, an end while DSH was closed, one counted once,
  the day it ended), the refusals in words, the setting's check, a folder it cannot write, the log's
  bound, the plugin's wiring to DSH, the window's bundle drawn with stand-ins for DSH's parts (each
  state, the error states, the toast once), its style sheet held to DESIGN.md, and this README held
  to the code. It also runs `lib/impl.test.mjs`.
- `node scripts/e2e.mjs focus` runs `test/e2e/run.mjs` in a real DSH (each DSH under `.e2e/` and the
  installed app's), in a throwaway home: the route, the end with no window, a restart under a running
  timer, an end while DSH was down, settings changed while DSH runs, then a real window: every control,
  the toast and the chime in two windows with one session counted, a failing read, motion stopped
  under `wp-still` and Reduce Motion, 760 px, and switched off and on in Plugins. It takes pictures
  light and dark, wide and 760 px, with Wallpaper on and off, into `.e2e/shots/focus/<version>/`.
  Wallpaper is loaded from `WALLPAPER_DIR` (a copy of the Wallpaper plugin; never one the live DSH
  loads).

## What changed in 0.2.0

- The host ends a timer itself at its end, and after a restart; a session is counted once, on the
  day it ended, with or without a window. `complete` only asks the host to check (0.1.0 counted every
  `complete`, so two windows counted twice and no window counted nothing).
- `start` and `set` are refused while a timer runs (0.1.0 threw the running timer away).
- Minutes are whole numbers; the setting is checked in words and never stops Focus; a folder that
  cannot be written is said, not thrown; `focus.log` is bounded; GET carries `rev` and `problems`.
- The panel is DSH's own dialog, with DSH's buttons, switch, fields, toast, tooltip, tokens, font and
  focus ring (0.1.0 drew its own glass card with Wallpaper's private colours and another font); it
  says its state in words, has the chime switch and the preset lengths, an error state with Try again,
  keeps the focus right on open and close, and follows the host live.
