# Session Watch

The shared watcher behind Autopilot, Decisions and Agent Terminals. It
reads every session's state once, from DSH's own events, and serves it to
the other suite plugins, so they never read session logs or poll on their
own. It has no page of its own: you see it through the plugins that use it.

## What it knows about every session

| | From |
| --- | --- |
| Whether a turn runs, how the last one ended (finished, failed, stopped, cut off by a stop, cut short) and when | `turn/start` and `turn/end` |
| The last reply's closing text (for `DECISION NEEDED` lines and questions) | `assistant/message` |
| Its todos: open, in progress, done, and the next one | `todo/write` |
| Its goal: objective, phase, rounds | `goal/change` and goal-round messages |
| Approvals it waits on | `approval/asked` and `approval/decided` |
| When a person last wrote, and when anything last went in | `user/message` |

DSH folds every committed event into this state (a registered session
projection, key `sessionWatch`), keeps it with the session, and hands it
back for sessions that are not loaded. A session's state is read live while
it is loaded, from the saved value when it is not, and from its whole log
when a plugin needs the reply text of a session that is not loaded.

## What it does for other plugins

- **Delivery with proof.** `deliver(sessionId, text)` puts a message into a
  session (loading it first when needed) and follows it through the
  session's own log: *queued* once the session's inbox shows it, *delivered*
  once a turn reads it, *not delivered* with the reason when DSH refuses it,
  lets it go unread, or no turn reads it within the delivery timeout. It
  never reports a message as sent on hope.
- **Cut off by a stop.** It keeps a small record of turns running now
  (`running.json`). After DSH restarts, crashes or reloads, it finds the
  sessions whose turn the stop cut off, from that record and from DSH's
  saved values, and checks each against its log. Subagents' sessions are
  left to their parents.
- **Questions for a person.** Any suite plugin can raise a question
  (Autopilot's Ask first rule, an agent in a terminal); Decisions shows them
  all, and an answer goes back to the plugin that asked.
- **One request per window.** Suite pages keep a single request open to the
  watcher (`/api/dsh-plugin-session-watch/wait`) that answers when anything
  they show moved, and read their own state only then. Nothing polls, and a
  hidden window stops asking.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `deliveryTimeoutSeconds` | `600` | How long a message may wait to be read into a turn before its delivery is reported as not delivered (10 to 86400). |

A value out of range stops the plugin with a message that names the setting
and the allowed range.

## Files

In DSH's data folder (`$DSH_HOME`, else `~/.dsh`), folder mode 700, file
mode 600:

| File | What |
| --- | --- |
| `session-watch/running.json` | Sessions with a turn running now, so the next start knows what a stop cut off. |

## Switching it off

Plugins → Session Watch → off. Autopilot, Decisions and Agent Terminals stop
with it (they need its service). It leaves nothing behind: its projection's
saved values go when DSH drops them, and `running.json` can be deleted.

## Rollback

Uninstall the package, or pin the previous version in your profile's
`cordis.patch.yml`. The saved state carries a version number, so an older
or newer copy folds again from the log instead of misreading it.

## Tests

```sh
node --test test/session-watch.test.js   # the fold and the watcher over a stand-in DSH
node scripts/e2e.mjs autopilot           # with Autopilot, in a real DSH Test window
```
