# Focus

A pomodoro and countdown timer for DeepSeek Harness Desktop, drawn in the same frosted glass as the
Wallpaper plugin. It adds one button and one panel, and nothing else. It never hides or rearranges
DSH's controls and never touches another plugin's UI or files.

## What it does

- **Timer.** Focus 25 · Short 5 · Long 15, or any custom length from 1 to 180 minutes. Start, pause,
  resume, reset. The remaining time is computed from an absolute end time kept by the host, so the
  countdown stays correct across page reloads and DSH restarts — it keeps counting while the window
  is closed.
- **Sessions.** Completed focus sessions are counted per day; the count resets at midnight.
- **Chime.** A short synthesized chime when a session completes (toggle in the panel's settings patch;
  on by default). The audio context is created only on your first click — nothing plays on page load.
- **Glass.** The panel is a frosted card that follows Wallpaper's sliders (`--wp-blur`, `--wp-tint`)
  when Wallpaper is on, and uses its own matching defaults when it is off. Motion is suppressed while
  Wallpaper's Motion switch is off (`wp-still`) and when macOS Reduce Motion is on.

Open the panel with the timer button in the sidebar footer, next to Settings.

## For other plugins

Nothing is published on `<body>`. Focus only reads Wallpaper's contract (`--wp-blur`, `--wp-tint`,
`wp-still`) and never writes it.

## Config

Row `focus` in the profile's `cordis.patch.yml`. Every key is optional.

| Key | Default | |
| --- | --- | --- |
| `dataDir` | `<DSH home>/focus` | `state.json` (timer, settings, sessions) and `focus.log` |

`<DSH home>` is `$DSH_HOME`, or `~/.dsh` when it is not set, so a test DSH keeps its own copy.

## API

| Route | | |
| --- | --- | --- |
| `GET /api/focus/state` | full state: `{ settings, timer, sessions }` |
| `POST /api/focus/state` | `{ settings?, op? }` — settings patch (minutes 1–180, `chime`) plus one op: `start {kind,durationMs}`, `pause`, `resume`, `reset`, `set {kind,durationMs}`, `complete` |

## Files

- `lib/index.js`: tiny host entry that loads `impl.js` with a fresh URL on every enable.
- `lib/impl.js`: host side. State, sessions, timer ops; routes on `/api/focus/*`.
- `lib/client.js`: the button and the panel, hand-written React (no build step). DSH hot-reloads it
  when it changes.
- `lib/impl.test.mjs`: offline test of the host in a temporary home: `node lib/impl.test.mjs`.
