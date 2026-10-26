# Session Watch

The shared watcher behind Autopilot, Decisions and Agent Terminals. It
reads every session's state once, from DSH's own events, and serves it to
the other suite plugins, so they never read session logs or poll on their
own. It has no page of its own: you see it through the plugins that use
it. Its page in Plugins has its one setting and, under it, **What it
watches**: how many sessions are in each state (*running*, *waiting for
approval*, *cut off*, *idle* and so on), which of Autopilot, Decisions and
Agent Terminals are on, and what a wrong setting means meanwhile. It
follows the sessions as they change, without a reload.

## What it knows about every session

| | From |
| --- | --- |
| Whether a turn runs, how the last one ended (finished, failed, stopped, cut off by a stop, cut short) and when | `turn/start` and `turn/end` |
| The last reply's closing text (for `DECISION NEEDED` lines and questions) | `assistant/message` |
| Its todos: open, in progress, done, and the next one | `todo/write` |
| Its goal: objective, phase, rounds | `goal/change` and goal-round messages |
| What a running turn waits on you for: a tool waiting for approval, a question in DSH's question box (the state reads *waiting for approval* or *waiting for your answer*). Both end with their turn; a turn a stop cut off keeps what was left waiting, so Autopilot's carry-on note can say it did not run. | `approval/asked`, `approval/decided`, and the question box's `tool/call` and `tool/result` |
| When a person last wrote, and when anything last went in | `user/message` |

DSH folds every committed event into this state (a registered session
projection, key `sessionWatch`), keeps it with the session, and hands it
back for sessions that are not loaded. A session's state is read live while
it is loaded, from the saved value when it is not, and from its whole log
when a plugin needs the reply text of a session that is not loaded.

DSH's saved value for a session whose turn a stop cut off can be from
before that turn (after a quit or a crash, DSH's list may even call the
session blank). After a restart the watcher reads those sessions' logs
once, so they read *cut off*, not *new* or *idle*; it keeps doing so at each
start until a turn ends there again.

## What it does for other plugins

- **Delivery with proof.** `deliver(sessionId, text)` puts a message into a
  session (loading it first when needed) and follows it through the
  session's own log: *queued* once the session's inbox shows it, *delivered*
  once a turn reads it, naming that turn, *not delivered* with the reason
  when DSH refuses it, lets it go unread, or no turn reads it within the
  delivery timeout. It never reports a message as sent on hope, and it
  logs each message it puts in, and what became of it, through DSH's
  plugin logger (DSH keeps those lines in memory; it writes only startup
  warnings to a file).
- **Not delivered means never read.** Past the delivery timeout, the
  watcher takes the message back out of the session's queue (DSH's
  `inbox.remove`; the session's log records it), so no later turn reads a
  message it reported as not delivered. A message a turn took from the
  queue at that very moment is left for that turn to prove, for one more
  minute. Where DSH cannot take it back (the session is not loaded), the
  reason says the message still waits in the queue and is read when the
  session runs again.
- **Cut off by a stop.** It keeps a small record of turns running now
  (`running.json`). After DSH restarts, crashes or reloads, it finds the
  sessions whose turn the stop cut off, from that record and from DSH's
  saved values, and checks each against its log. Subagents' sessions are
  left to their parents.
- **Questions for a person.** Any suite plugin can raise a question
  (Autopilot's Ask first rule, an agent in a terminal); Decisions shows them
  all, and an answer goes back to the plugin that asked. When the answer's
  fate is known only later (typed into a terminal, then seen in the agent's
  transcript or not), the asking plugin says so, and Decisions shows it.
- **One request per window.** Suite pages keep a single request open to the
  watcher (`/api/dsh-plugin-session-watch/wait`) that answers when anything
  they show moved, and read their own state only then. Nothing polls, and a
  hidden window stops asking. While Session Watch is off, a window asks
  DSH's own plugin list every four seconds instead of the watcher's
  endpoint, so its console shows no failed requests, and the pages come
  back by themselves once it runs.

## For plugin authors

Other plugins use the `sessionWatch` service, doing their work under its
scope (`ctx.inject(['sessionWatch'], (scope) => ...)`, as Autopilot does), so
they stop with it. `list`, `get`, `readLog`, `deliver` and `cutOffSessions`
never throw for a session they cannot read: `readLog` gives nothing, and
`deliver` a failed delivery with the reason in words. `resolveAgent` throws
with DSH's reason.

| Call | What it gives |
| --- | --- |
| `list()` | Every session DSH lists, newest first: `sessionId`, `title`, `cwd`, `status` (`running`, `idle`, or `cold`: not loaded), `word` (its state in the suite's words), `state` (the table above, without the reply text), `external` when an outside agent set one. |
| `get(sessionId)` | One row, as `list()` gives them. |
| `stateOf(sessionId)`, `fullState(sessionId)` | Its state; `fullState` with the last reply's text, folded from the log when the session is not loaded. |
| `readLog(sessionId)` | Its log through DSH, without loading it: `{ state, events }`. |
| `projection(sessionId, key)` | Another projection's value (DSH's question box, a coordinator's threads): `{ live, value }`. |
| `on(listener)` | Events: `turn-start`, `turn-end` (with `end`), `state` (with the event type as `change`), `status`, `agent`, `delivery`, `ask`, `external`. Returns a function that stops listening. |
| `deliver(sessionId, text, { mode })` | A delivery: `id`, `state` (`pending`, `queued`, `delivered` or `failed`), `turn` once delivered, `reason` once failed, and `done`, a promise that settles then. `mode: 'steer'` puts it into the running turn's next step (a session that is not running gets it as its next turn). |
| `cutOffSessions({ withinMs })` | Sessions whose last turn a stop cut off and that nothing went into since, checked against their logs (only cuts within `withinMs`; `0` for any): `sessionId`, `title`, `cwd`, `end`, `state`. Subagents' sessions are left to their parents. |
| `raiseAsk(ask)`, `answerAsk(id, answer, by)`, `dropAsk(id)`, `askOutcome(id, outcome)`, `asks()` | Questions for a person: raised with an `onAnswer` handler, answered once (a second answer is refused in words), and what became of an answer. |
| `setExternal(sessionId, external)` | An outside agent's state on its session's row (`null` clears it). |
| `resolveAgent(sessionId)` | The live agent, loading the session when it is cold. |

Window endpoints, at `/api/dsh-plugin-session-watch/<name>`: `wait` (`since`,
`timeoutMs`: answers when a channel moved, or after at most 25 seconds),
`sessions` (the rows, without the reply text) and `status` (`running`, and
`problem` naming a wrong setting and its value).

## Settings

Plugins → Session Watch, in DSH's own settings form: type a value, then
**Save**; it applies at once. The form will not save a value out of range.

| Setting | Default | Range | What it does |
| --- | --- | --- | --- |
| `deliveryTimeoutSeconds` (How long a message may wait to be read) | `600` | 10 to 86400 seconds | How long a message from Autopilot, Decisions or Agent Terminals may wait to be read into a turn before it is reported as not delivered. |

A wrong value set in the profile never stops the watcher, which every suite
plugin needs: it uses the default, its `status` names the setting and the
value, and Autopilot's page says which setting to fix. A number typed in
the profile in quotes (`deliveryTimeoutSeconds: "600"`) is text, not a
number: the form shows it in its quotes, flagged at once with what to
type, and saving the number without them fixes it.

## Files

In DSH's data folder (`$DSH_HOME`, else `~/.dsh`), folder mode 700, file
mode 600:

| File | What |
| --- | --- |
| `session-watch/running.json` | Sessions with a turn running now, so the next start knows what a stop cut off; and the sessions a stop cut off that have not ended a turn since (the newest 50), whose rows it reads from their logs at each start. |

## Setup

Install it as in the [root README](../../README.md#install-a-plugin), before
the plugins that use it, and restart DSH Desktop once:

```bash
dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/session-watch
```

That adds `dsh-plugin-session-watch` to the profile's `package.json`
(`dependencies` and `dsh.profile.bundles`); its bundle adds its row
(`id: session-watch`).

## Switching it off

Plugins → Session Watch → off. The plugins that use it stop their work with
it, with no error from DSH: Autopilot and Decisions stay on in Plugins, do
nothing, and their pages say they need Session Watch; they start again by
themselves when it does (an open page comes back within about ten seconds).
Its section and its style sheet leave the window with it. It leaves nothing
else behind: its projection's saved values go when DSH drops them, and
`running.json` can be deleted.

## Rollback

DSH runs it from its folder in your clone. To go back to a release, restore
that folder from the release's tag and restart DSH Desktop:

```bash
git -C ~/.dsh-plugins/deepseek-plugins restore --source session-watch-v1.0.0 -- plugins/session-watch
```

The saved state carries a version number, so an older or newer copy folds
again from the log instead of misreading it. To remove it, remove the
plugins that use it first, then follow
[Remove a plugin](../../README.md#remove-a-plugin) for
`dsh-plugin-session-watch` (row `session-watch`).

## Tests

From the repository root:

```sh
node --test test/session-watch.test.js   # the fold, the watcher over a stand-in DSH, its page in Plugins
node --test test/suite-shared.test.js    # the window kit: the settings form, one request per window
node scripts/e2e.mjs session-watch       # in real DSH, on every DSH build
```

`scripts/e2e.mjs session-watch` runs `test/e2e/run.mjs` on each DSH under
`.e2e/` and on the installed app's DSH, each in a throwaway home with a
scripted model, and checks that the DSH you use was not touched. A stand-in
user of the service (`test/e2e/probe`, a test-only plugin) calls
`sessionWatch` as Autopilot does and serves what it gets to the test. It
proves, from each session's own log:

- the fold: a todo list, a `DECISION NEEDED` line, a goal, a tool waiting
  for approval and a question in DSH's question box, each cleared when
  answered; listeners hear turns in order;
- delivery with proof: queued, then read inside the very turn the delivery
  names; a steer read into the running turn; a session that does not exist
  refused in words; a message past the wait taken back out of the queue and
  never read;
- a quit (SIGTERM) and a crash (SIGKILL) under running turns: the cut-off
  sessions are found and the finished ones are not, their rows read *cut
  off*, and a carry-on message to one that is not loaded is delivered into
  a new turn; no session that ran a turn reads *new* after later restarts;
- questions for a person, outside agents, and the folder (700) and file
  (600) modes;
- a number in quotes in the profile: `status` names it, delivery still
  works, and its page in Plugins flags it, refuses a value out of range,
  and fixes it on Save; **What it watches** counts every session by state,
  follows a new session without a reload, and drops its setting line once
  fixed; pictures light, dark and at 760 px;
- switched off in Plugins: no failure from DSH, its endpoints, service,
  section and style sheet go; on again, it serves and delivers at once.

Autopilot's, Decisions' and Agent Terminals' own real-DSH tests run with it
too (`node scripts/e2e.mjs autopilot`, and so on).
