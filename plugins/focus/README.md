# Focus

A pomodoro and countdown timer for DeepSeek Harness Desktop. One button in the sidebar footer opens
DSH's own dialog with the timer; that is all it adds. It never hides or moves DSH's controls and never
touches another plugin's UI or files.

Its job in this stack: a timer you can trust while agents work. The host keeps the time, so the
countdown is right after a reload, a restart, or with no window open at all, and a focus session is
counted once, on the day it ended. The end is hard to miss: a toast with the next step, a chime, and
a mark on the footer button until you have seen it.

## What it does

- **Timer.** Focus 25 · Short break 5 · Long break 15 (each length your own, 1 to 180 whole minutes),
  or a custom length. Start, Pause, Resume, Reset (and Undo for a minute after a Reset).
- **Kept by the host.** The end of a running timer is stored as an absolute time in Focus's own
  folder. The host ends the timer itself when that time comes, whether or not a window is open. If DSH
  was closed at the end, the timer ends as of its end time at the next start. A window that reaches
  zero only asks the host to check, so two windows or a reload never count a session twice.
- **Sessions.** Focus sessions are counted per day (the host's local day), on the day they ended.
  Breaks and custom timers are not counted. The count starts again at midnight.
- **Said when it ends.** Every open window shows DSH's toast for 12 seconds ("Focus session done. Time
  for a break." or "Break over. Ready to focus?") with the next step as its button (for example
  Start short break), and, if the chime is on, plays a short two-note chime. The sound is made only
  after your first click in the window; nothing plays on page load.
- **A mark until you have seen it.** After the toast, the footer button keeps a green dot, and its
  name and tooltip say what ended ("Focus timer: Focus session done at 10:25 AM"), until the panel
  shows the end in any window, or the next timer starts. The host keeps the mark, so a reload or a
  restart keeps it too.
- **A hidden window.** A window that is hidden at the end (minimized, or covered by another window)
  chimes at the end and says it when it is shown again, with the time it ended ("Focus session done
  at 10:25 AM. Time for a break."), unless the end was seen in another window meanwhile. An end a
  window learns of more than a minute late (it was closed, or did not know the timer ran) is said
  the same way, with its time and without the chime.
- **Live.** While a window is visible it reads the host's state every 5 seconds (one small GET; it
  redraws only when the state's revision moved), so a timer started or ended elsewhere shows within
  seconds. The countdown itself ticks in the window every second.

## Using it

Open the panel with the timer button in the sidebar footer (next to More; Settings on DSH 0.2.0), or
with DSH's keyboard shortcut ⇧⌥⌘F (Ctrl+Shift+Alt+F on Windows and Linux). The shortcut is "Open the
Focus timer" in DSH's Keyboard shortcuts settings, where it can be changed; if another command has
those keys already, Focus's is listed there without keys, to bind as you like.

The footer button says what the timer is doing:

| The timer | The button | Its name, for a screen reader |
| --- | --- | --- |
| ready | the timer icon | `Focus timer` |
| running | a pulsing blue dot; the tooltip shows the exact time left | `Focus timer: Focus, 18 minutes left` |
| paused | a grey dot | `Focus timer: paused, 12 minutes left` |
| ended, not seen yet | a green dot; the tooltip says what ended | `Focus timer: Focus session done at 10:25 AM` |

The panel says the state in words at the top:

| State | What the panel says | The main button |
| --- | --- | --- |
| ready | `Focus · ready, 25:00` | Start |
| running | `Focus · running, ends at 10:25 AM` | Pause |
| paused | `Focus · paused, 12:40 left` | Resume |
| done | `Focus · done at 10:25 AM` | Start short break (after focus; Start long break after every fourth today), Start focus (after a break), Start again (a custom timer) |

- **The next step.** When a timer ends, the clock shows the next step's length with its name under it
  ("Short break next"), and the main button and the end's toast start it: a short break after a focus
  session (a long break after every fourth one today), focus after a break, a custom timer again. The
  presets choose anything else.
- **Lengths.** The three preset buttons set the timer to that length; the pressed one is the current
  length. Type a custom length (1 to 180 minutes) in the field named Custom and press Set or Enter.
  While a timer runs, the lengths are locked and the panel says "Pause or reset to choose another
  length." — a click never throws a running session away.
- **Reset and Undo.** Reset puts the timer back to its full length. After a Reset of a timer that had
  started (running or paused), the toast "Focus session reset." has an Undo button for 10 seconds:
  it brings the timer back as it was, still running to the same end if it ran. The host keeps the
  old timer for a minute, and only while nothing else changed.
- **Settings.** "Chime when a timer ends" switches the chime. The three preset lengths can be typed
  (whole minutes, 1 to 180; Enter or leaving the field keeps it; a value out of range is marked and
  not kept). A preset length changed while that preset's timer is set and not started also changes
  the timer.
- **Keyboard.** ⇧⌥⌘F (Ctrl+Shift+Alt+F) opens the panel; the main button has the focus when it opens;
  Tab moves through the controls; Escape closes the panel and the focus goes back to where it was
  (the footer button, when that opened it).
- **When something is wrong.** If the window cannot read the timer at all, the panel says "Focus can't
  reach its timer: <why>. Check that the Focus plugin is on in Plugins, then try again." with a Try
  again button. If a later read fails, the panel keeps the last state and says it may be out of date.
  A change the host refuses (for example Start while a timer runs, from another window) comes back as
  a toast: "Not changed: <the host's words>". A problem with the setting or the folder is shown at the
  bottom of the panel, in words without paths; the logs name the folder.

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
timer in its default folder (focus in DSH's data folder).` DSH's log then names the folder in use
(`its folder: …`), and `focus.log`'s `started` line does too. A key Focus does not have is named and
ignored. A changed `dataDir` takes effect at once; the timer then lives in that folder (a first start
there if it is new) and the old folder is left as it was.

If the folder cannot be made or written, the timer still works in memory, and the panel and GET
`problems` say that a restart would lose it, with the reason in words ("Focus could not save its timer
(no permission to write there); it keeps counting, but a restart would lose the change. DSH's log
names the file."). DSH's log has the path and the error code. Once a save works again the problem
goes; a folder that could not be made is tried again the next time Focus starts.

## Switch it off, roll it back

- **Off:** switch it off in Settings → Plugins. The footer button, the panel, the keyboard shortcut and
  the style sheet go at once, and the route stops answering; `state.json` stays, so switching it on
  again brings the same timer and count back. A timer that ended while it was off ends at the next
  start, as above.
- **Roll back:** 0.2.1 reads the `state.json` of 0.2.0 and 0.1.0 as it is (fractional minutes become
  whole ones; an end saved by an older version counts as seen, so nothing old is marked), and both
  read 0.2.1's (they drop the `rev` and `doneSeen` fields they do not know). The older versions are in
  this repo: take one out with `git archive 3859b8d plugins/focus | tar -x -C <folder>` (0.2.0) or
  `git archive 5c0d8da plugins/focus | tar -x -C <folder>` (0.1.0), and load `<folder>/plugins/focus`
  in place of this one.

## With Wallpaper

Focus draws only with DSH's own parts (the dialog, buttons, switch, fields, toast, tooltip) and DSH's
tokens and font, so with Wallpaper on it looks as DSH's other dialogs do under Wallpaper. Of
Wallpaper's contract it reads only `body.wp-still`: while Wallpaper's Motion switch is off, the
footer dot and the ring stop moving. The system's Reduce Motion stops them too. Focus never writes
anything on `<body>`.

With the sidebar folded to its narrow rail (a window under 1024 px wide), DSH lays the footer buttons
in one row 36 px wide, where two buttons do not fit and both would be cut. There Focus gives its seat
to a plugin's footer button drawn before it (Wallpaper's, for one), so that button stays whole; the
panel then opens with ⇧⌥⌘F (Ctrl+Shift+Alt+F), or from Focus's button once the sidebar is unfolded.
With no such button before it, or when that one goes (Wallpaper switched off), Focus's button is in
the rail as usual. The timer, the toast and the chime work the same either way. A rail footer that
holds more than one plugin button is an open question for DSH itself.

## API

One route, served by DSH's own window server (signed in, the window's origin), `cache-control: no-store`.

| Request | Answer |
| --- | --- |
| `GET /api/focus/state` | `{ settings, timer, sessions, rev, problems }` |
| `POST /api/focus/state` with `{ "settings"?: {…}, "op"?: {…} }` | `{ ok: true, changed, settings, timer, sessions, rev, problems }` |

- `settings`: `focusMin`, `shortMin`, `longMin` (minutes, rounded to whole ones, kept within 1 to
  180) and `chime` (true or false). Only the keys given change.
- `timer`: `{ kind, durationMs, remainingMs, endAt, running, doneAt, doneSeen }`. While running,
  `endAt` (ms since 1970) is the truth and the time left is `endAt − now`; while idle, `remainingMs`
  is. `doneAt` is the end time of the last timer that ended (null after Start, Set or Reset).
  `doneSeen` is false from that end until a window shows it in its panel (op `seen`).
- `sessions`: `{ date: "YYYY-MM-DD", focus: <count> }`, the host's local day.
- `rev`: goes up by one with every change, so a reader can tell whether anything moved.
- `problems`: what is wrong with the setting or the folder, in words without paths; `[]` when nothing is.
- `changed`: whether this request changed anything (a Pause on an idle timer changes nothing).

The ops (`op.op`):

| Op | Fields | What it does |
| --- | --- | --- |
| `start` | `kind`, `durationMs` | Starts a new timer of that kind and length. Refused (409) while one runs. |
| `pause` | | Keeps the time left. Nothing to do when idle. |
| `resume` | | Runs on from the time left. Nothing to do when running. |
| `reset` | | Idle at the full length; clears `doneAt`. A timer that had started can be brought back with `undo`. |
| `set` | `kind`, `durationMs` | An idle timer of that kind and length. Refused (409) while one runs. |
| `complete` | | Asks the host to end the timer now if its end has come (within 1.5 s); otherwise nothing. |
| `seen` | | A window showed the end in its panel: `doneSeen` becomes true, and every window drops the footer mark. Nothing to do if there is no unseen end. |
| `undo` | | Brings back the timer as it was before the last Reset of a started timer (a running one to the same `endAt`). Only within 60 s of that Reset and while nothing changed since; refused (409) otherwise. Kept in memory, so a restart forgets it. |

`kind` is one of `focus`, `short`, `long`, `custom`; `durationMs` is a number of milliseconds, kept
within 10 s to 3 h. Everything in a request is checked before anything changes, so a refused request
changes nothing, its settings included.

| Status | When |
| --- | --- |
| 200 | Done, or nothing to do (`changed: false`). |
| 400 | The body is not JSON or not an object, an unknown op or kind, a length that is not a number, `chime` not true or false. The error says which and what to send. |
| 405 | PUT, PATCH or DELETE (`Allow: GET, POST`). DSH answers 404 for any other method. |
| 409 | `start` or `set` while a timer runs: "A timer is already running. Pause or reset it first."; `undo` with nothing to undo: "There is no Reset to undo: the timer changed since, or the Reset was more than a minute ago." |
| 500 | Something unexpected; the error says what, and `focus.log` has it. |

## Files on disk

- `state.json`: the state above, written whole (to a temporary file, then renamed) after each change.
- `focus.log`: one line per start, pause, resume, reset, undo, set, end, seen end, setting change and
  problem, with its time, for example `complete focus 1500s (focus sessions today: 3)` or
  `resume focus at 1493s left, ends 2026-10-26T21:45:12.000Z`. Past 1 MB the log starts a new part
  and keeps the old one once, as `focus.log.1`.

## Tests

- `npm test` (from the repo) runs `test/focus.test.js`: the host's own end of a timer on a clock moved
  by hand (no window, a restart under a running timer, an end while DSH was closed, one counted once,
  the day it ended), the seen mark and Undo, the refusals in words, the setting's check, a folder it
  cannot write, the log's bound, the plugin's wiring to DSH, the window's bundle drawn with stand-ins
  for DSH's parts (each state, the footer's marks, the error states, the toast once, a hidden window,
  the seat in the rail, the shortcut), its style sheet held to DESIGN.md, and this README held to the
  code. It also runs `lib/impl.test.mjs`.
- `node scripts/e2e.mjs focus` runs `test/e2e/run.mjs` in a real DSH (each DSH under `.e2e/` and the
  installed app's), in a throwaway home: the route, the end with no window, a restart under a running
  timer, an end while DSH was down, settings changed while DSH runs, then a real window: every control,
  no AudioContext before a click, the toast and the chime in two windows with one session counted, the
  footer mark until the panel shows the end, a hidden window, the toast's next step, Reset and Undo, a
  failing read, motion stopped under `wp-still` and Reduce Motion, the 760 px rail with Wallpaper on,
  off and on (the neighbour's button measured whole, the shortcut, a click on Focus's button), and
  switched off and on in Plugins. It takes pictures light and dark, wide and 760 px, with Wallpaper on
  and off, into `.e2e/shots/focus/<version>/`. Wallpaper is loaded from `WALLPAPER_DIR` (a copy of the
  Wallpaper plugin; never one the live DSH loads).

## What changed in 0.2.1

- An end leaves a mark: the footer button keeps a green dot and says what ended until the panel shows
  it (the host's `doneSeen`, op `seen`); the end's toast stays 12 seconds and starts the next step.
- A hidden window chimes at the end and says it when shown again, with its time (0.2.0 said it while
  the window was hidden).
- In DSH's narrow rail Focus gives its seat to an earlier footer button, and DSH's keyboard shortcut
  ⇧⌥⌘F (Ctrl+Shift+Alt+F) opens the panel anywhere.
- The done clock shows the next step; the custom field has its name beside it; Undo after a Reset;
  the window's problem words name no path; `resume` logs its end.

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
