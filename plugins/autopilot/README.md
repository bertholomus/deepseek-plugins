# Autopilot

Keeps your sessions moving when nobody is watching. After DSH stops under a
running turn it tells the session to carry on; when a session goes quiet
with open todos it gives one nudge, and backs off if nudges bring no
progress; when an error stops a goal it starts the goal again, after a
wait, a few times. Every action says what it did and why, and is proven by
the session's own log, never reported on hope.

It needs Session Watch (it reads every session through it). With the
notifications plugin running, it also tells you outside the window when it
backs off, gives up or asks you something.

## What it does

| When | It | Proven by |
| --- | --- | --- |
| DSH restarted, crashed or reloaded under a running turn | Puts a short carry-on note in: which turn was cut off and when, what is still open. An active goal starts again once that note is read. | The note read into a turn; the goal's next round |
| A session went quiet (`idleSeconds`) with open todos, and its last reply asked you nothing | One nudge naming the next todo. Two nudges in a row with no progress (no todo done, no goal round) and it backs off until you write there. | The note read into a turn |
| A session went quiet with an active goal that is not running (a restart or an error stops a goal) | Starts the goal again. | The goal's next round |
| A turn failed with open work | After `errorRetrySeconds` (2, 10 and 30 minutes by default) it starts the goal again or tells the session to carry on; after the last try it stops and tells you. | As above |

It leaves a session alone when its last reply asks you something (a
question, `DECISION NEEDED`, `BLOCKED:`), when it waits for an approval,
when you paused its goal or the agent marked it blocked, when anything was
written in it since, and for subagents' sessions. Every note starts with
`[Autopilot]` and asks the agent to end with a `DECISION NEEDED` line if it
is blocked, which Decisions picks up.

## The page

**Autopilot** in DSH's sidebar:

- **The switch.** Off stops everything at once: nothing it scheduled runs.
  On again, it looks at every session.
- **The rule for sessions without their own**: Auto (act), Ask first, or
  Off.
- **Waiting for you**: its questions (under Ask first), with the action, Leave
  it, and Open; and sessions it backed off from or stopped retrying, with
  Try again.
- **Sessions**: each with its state, its open work, when Autopilot looks
  next, its last action, and its own rule. *Open work* lists the ones it
  could act on; *All* lists every recent session.
- **What Autopilot did**: every action, every question and every time it
  held back for a reason you would want to know, each with a *Why* line, its
  outcome (*in the queue*, *delivered*, *started*, *not delivered* with the
  reason), and *What it sent*.

The sidebar icon shows a count while Autopilot waits on an answer, and dims
while it is off.

## Settings

Plugins → Autopilot.

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Off: Autopilot watches nothing, and its page says how to switch it on. |
| `defaultRule` | `auto` | The rule for sessions without their own: `auto`, `ask` or `off`. The page's choice overrides it. |
| `resumeAfterRestart` | `true` | After DSH starts, tell the sessions a stop cut off to carry on. |
| `resumeWindowHours` | `6` | Only sessions cut off within this many hours are resumed (1 to 168). |
| `idleSeconds` | `600` | How long a session stays quiet, with work open, before a nudge (5 to 86400). |
| `idleWindowHours` | `2` | At start, idle sessions whose last turn ended within this many hours are looked at (1 to 168). |
| `maxNudges` | `2` | Nudges in a row with no progress before it backs off (1 to 10). |
| `maxNotesPerHour` | `20` | The most notes and goal starts in an hour, over all sessions (1 to 500). Past it, it holds back and says so once. |
| `errorRetrySeconds` | `[120, 600, 1800]` | The wait before each try after a failed turn; one try per entry (1 to 10 entries). |
| `startDelaySeconds` | `20` | How long after DSH starts it first looks (0 to 600). |

A value out of range stops the plugin with a message that names the setting
and the allowed range.

## Files

In DSH's data folder (`$DSH_HOME`, else `~/.dsh`), folder mode 700, files
mode 600:

| File | What |
| --- | --- |
| `autopilot/state.json` | The switch, rules, what it already handled (so a restart never repeats an action), nudge and retry counts. |
| `autopilot/events.jsonl` | The event log; it keeps the last 400 entries and rewrites itself past 1 MB. |

## Setup

1. Install Session Watch and Autopilot as in the
   [root README](../../README.md#install-a-plugin):

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/session-watch
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/autopilot
   ```

   That adds `dsh-plugin-session-watch` and `dsh-plugin-autopilot` to the
   profile's `package.json` (`dependencies` and `dsh.profile.bundles`).
   Their bundles add their rows (`id: session-watch`, `id: autopilot`).

2. To change a default before the first start, address the row in the
   profile's `cordis.patch.yml` (or change it later in Plugins → Autopilot):

   ```yaml
   - id: autopilot
     config:
       idleSeconds: 900
       defaultRule: ask
   ```

3. Restart DSH Desktop once so it loads the new bundles.

## Switching it off

- **For a moment**: the switch on its page. Nothing it scheduled runs.
- **For one session**: that session's rule, Off.
- **Entirely**: Plugins → Autopilot → off, or set `enabled: false`. Its
  sidebar entry and page go, and it leaves no marks in other plugins' views.

## Rollback

DSH runs Autopilot from its folder in your clone (the profile links it). To
go back to a release, restore that folder from the release's tag and
restart DSH Desktop:

```bash
git -C ~/.dsh-plugins/deepseek-plugins restore --source autopilot-v1.0.0 -- plugins/autopilot
```

To remove it, follow [Remove a plugin](../../README.md#remove-a-plugin) for
`dsh-plugin-autopilot` (row `autopilot`), and delete `autopilot/` in DSH's
data folder to forget its rules and log. Nothing else needs undoing: it
changes nothing in your sessions beyond the notes it sent, which stay in
their logs, signed `[Autopilot]`.

## Tests

From the repository root:

```sh
node --test test/autopilot.test.js   # the engine over the watcher and a stand-in DSH; the page; the browser half
node scripts/e2e.mjs autopilot       # real DSH in a throwaway home, on every DSH build here
```

The real-DSH test (47 checks) starts DSH from each `.e2e/dsh-<version>`
install (`npm i --prefix .e2e/dsh-0.2.1-rc.1 @deepseek-ai/dsh@0.2.1-rc.1`)
and from the installed app's own DSH (run as Node by the app's binary, as a
separate process), each in a throwaway home, with a scripted model playing
the agent. It stops and
kills DSH under running turns, lets sessions go quiet with work open, fails
a goal round, and drives the page in a browser (`npm i --prefix .e2e/tools
playwright-core`, with Playwright's Chrome), light and dark, wide and
narrow. Every claim is checked in the session's own log. It reads the
running DSH's fingerprint before and after and fails if it moved; pictures
go to `.e2e/shots/autopilot/<version>/`.
