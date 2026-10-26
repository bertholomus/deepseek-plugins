# dsh-plugin-session-bridge

A small JSON API for the running DSH. Scripts, cron jobs and other agents use it to create, prompt, steer, cancel and read DSH sessions, and to wait for a reply without polling.

It drives DSH's own `sessionController`, the same code path the window uses. A session you create or prompt through the bridge shows up live in the DSH window, where you can watch it and take over.

What it does for this stack: it lets work on local models run unattended, driven from outside the window. A cron job or a coordinator sends a prompt, waits for its turn to end in one call, and reads the reply. After a timeout or a DSH restart it can ask what became of the prompt, and send it again safely: a retry with the same request id is never sent twice. DSH Test (`dsh-test prompt`, `dsh-test bridge`), scripts that speak this API (such as `dshb --sock <socket>`) and this repository's real-DSH tests all drive DSH through it.

## Security

- The API listens on a **Unix socket only**. It opens no TCP port.
- The socket's folder is mode `700` and the socket mode `600`, so only your user can connect. The bridge will not put its socket in a shared folder (your home folder, a sticky one such as `/tmp`, or another user's): it would have to close that folder to everyone else, so it says so and does not listen.
- Anyone who can connect has full control of DSH sessions, including their tools. Do not forward the socket to a network.
- The log records actions and sizes (for example `prompt <id> mode=followup chars=812 request=<id>`), never a prompt's text or a title (a rename is logged as `chars=<n>`). It is mode `600`, even if it was there before with wider rights. An error line holds the error's own message, cut at 300 characters.
- The bridge never takes over a socket another program answers on (another DSH, or a second row of this plugin), and never deletes a file at the socket path that is not a socket. A socket left by a crash, which nobody answers on, is replaced.

The tests prove each of these: `test/session-bridge.test.js` the modes, the refusals and the log, and the real-DSH test the same in a running DSH, plus the TCP ports (DSH listens on the same ones with the bridge on as off: only its window's).

## Install and set up

Install the plugin as in the [root README](../../README.md#install-a-plugin). It needs no settings: the socket and the log go in DSH's data folder (`DSH_HOME` when it is set, else `~/.dsh`), under `session-bridge/`. To change them, address its row in `cordis.patch.yml`:

```yaml
- id: session-bridge
  config:
    socketPath: "~/.dsh/session-bridge/bridge.sock"
    logFile: "~/.dsh/session-bridge/bridge.log"
    maxBodyBytes: 1048576
```

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `enabled` | `true` or `false` | `true` | `false`: nothing listens, and the bridge writes nothing. |
| `socketPath` | a full path (`/…` or `~/…`), at most 103 bytes | `<DSH data folder>/session-bridge/bridge.sock` | The Unix socket. Its folder is made, or closed, to mode 700: give the socket a folder of its own. |
| `logFile` | a full path, or `""` | `<DSH data folder>/session-bridge/bridge.log` | The action log, mode 600; `""` for none. Past 5 MB it starts again and keeps the last part as `<logFile>.1`. |
| `maxBodyBytes` | a whole number, 1024 to 67108864 | `1048576` | The largest request body taken; a larger one gets a 413. |

A wrong value never stops the bridge. That setting keeps its default, and the problem is said in words in `GET /health` (`problems`) and in the bridge's log (`setting: …`); the bridge also hands it to DSH's logger. A key the bridge does not have (a typo such as `socketpath`) is named the same way.

DSH applies a saved change to the row at once: the bridge stops, and starts again with the new settings.

In DSH Test, `dsh-test load <this folder>` keeps the test home's own socket and log (DSH Test sets `DSH_HOME` to its home), so `dsh-test prompt` and `dsh-test bridge` reach it there.

## Switch it off, roll it back

- To switch it off, turn **dsh-plugin-session-bridge** off on DSH's Plugins page, or set `enabled: false` in its row. Its socket file goes away, and scripts that use it (`dsh-test prompt`, for one) get "connection refused" until it is on again. To remove it, see [Remove a plugin](../../README.md#remove-a-plugin).
- To roll back, check out the earlier version of `plugins/session-bridge` in your clone (`git log -- plugins/session-bridge` lists them) and restart DSH. For the same request, 0.2.0 answers with the same fields as 0.1.0 (some replies have more), except for input 0.1.0 let through or guessed at, which 0.2.0 refuses in words: see [What changed in 0.2.0](#what-changed-in-020).

## API

All requests and replies are JSON. An error comes back as `{"error": {"code", "message"}}`, and its message says what to do.

| Method and path | Body or query | Returns |
| --- | --- | --- |
| `GET /health` | | `{ok, plugin, version, pid, socket, problems}` |
| `GET /workspaces` | | `[{id, path, title, sessions}]` |
| `GET /models` | | DSH's model catalog |
| `GET /sessions` | | DSH's session list |
| `POST /sessions` | `{workspacePath` or `workspaceId, title?, provider?, model?, reasoningEffort?, agentPreset?, text?, requestId?}` | `{sessionId, workspace, model?, title?, prompt?}` |
| `GET /sessions/:id` | | `{sessionId, cwd, title, attached, status, turns, lastSeq, lastAssistant}` |
| `GET /sessions/:id/events` | `after`, `limit`, `full=1`, `types=a,b`, `wait` | `{lastSeq, more, events, timedOut?}` |
| `GET /sessions/:id/requests/:requestId` | `wait` | What became of one prompt (below) |
| `POST /sessions/:id/prompt` | `{text, mode?: "followup" or "steer", requestId?}` | `{accepted, mode, requestId, chars}` |
| `POST /sessions/:id/model` | `{provider, model, reasoningEffort?}` | DSH's reply |
| `POST /sessions/:id/cancel` | | DSH's reply |
| `POST /sessions/:id/rename` | `{title}`, at most 500 characters | DSH's reply |

- `workspacePath` is a full path (`/…` or `~/…`) to a folder that exists. DSH reuses the workspace it has for that folder.
- `provider` and `model` go together. With neither, the session gets DSH's default model.
- `POST /sessions` makes the session, then sets its model, then its title, then sends `text` (`prompt` holds that prompt's reply, with its `requestId`). If a step after the first fails, the error also carries `sessionId`, `workspace` and `failedStep` (`model`, `title` or `prompt`), so you can carry on with that session.
- `status` is `running` or `idle` for a session open in DSH, and `cold` for one DSH has not opened since it started.
- `followup` (the default) queues the text for after the running turn; `steer` sends it into the running turn at its next step. With no turn running, either one starts a turn.
- `cancel` stops the running turn. On a session DSH has not opened since it started, there is no turn to stop: a 409, `session/not-running`.
- Events: `after` is the last `seq` you have (default -1, the start); `limit` is 1 to 2000 (default 200; more reads as 2000), and `more` says there are more; each text is cut at 4000 characters unless `full=1`; `types` keeps only those event types.
- Each `user/message` event carries its `source`: `{kind: "user", …}` for the user or this bridge (a bridge prompt carries its request id as `rpcId`), `{kind: "agent-message", senderSessionId}` for a message from another session, and a plugin's own kind for a plugin's note.

### What became of a prompt

Every prompt has a request id: yours (`requestId`: 1 to 128 letters, digits or `. _ : -`, starting with a letter or digit), or one the bridge makes (`bridge-<uuid>`). `GET /sessions/:id/requests/:requestId` reads the session's own log and answers `{sessionId, requestId, state, seq?, turn?, target?, end?, reply?}`:

| `state` | Meaning |
| --- | --- |
| `waiting` | Not in the session's log yet: on its way into DSH. |
| `queued` | In DSH's queue; `target` is `next-turn` (a followup) or `next-step` (a steer). |
| `read` | A turn took it and is still running. |
| `answered` | The turn that read it ended. `end` says how (DSH's `kind`, such as `completed`, `aborted`, `error` or `interrupted`), and `reply` is the turn's last reply after it (`{seq, text}`, or `null`). |
| `dropped` | It left DSH's queue but never reached the log: DSH stopped mid-step before it saved the message (`end.kind` is then `interrupted`), or the queue was cleared. Send it again with the same request id. |

With `wait=<seconds>` (0 to 600), the answer comes when the state is `answered` or `dropped`, or when the wait runs out (`timedOut: true`). A request id that is not in the session's log, and that the bridge has not sent to that session since DSH started, is a 404 (`request/not-found`).

A retry with your own `requestId` is safe. If DSH already has that message (`queued`, `read` or `answered`), or the bridge is still handing it over, it is not sent again, and the reply says `alreadySent: true` with its `state`. A `dropped` one is sent again.

### Waiting without polling

`wait=<seconds>` (0 to 600) on `events` answers as soon as the session has an event after `after` (of `types`, when given), or with an empty page and `timedOut: true` when the wait runs out. DSH's own session events wake a waiting request; the bridge does not poll. A caller that hangs up ends its wait, and stopping the bridge answers every wait at once.

### Status codes

| Status | When |
| --- | --- |
| 400 | Bad input (`bad-request`, `bad-json`), refused before DSH is asked. |
| 404 | An unknown session, workspace, request id or path. |
| 405 | A wrong method; the `Allow` header names the right ones. |
| 409 | DSH refused, in its own words (for example `session/model-unavailable`), or `session/not-running`. |
| 413 | A body over `maxBodyBytes`. |
| 500 | Anything else. |
| 503 | The bridge is stopping. |
| 504 | DSH did not answer in time: 20 s to read a session or the list, 60 s to take a prompt. |

## Examples

```bash
S=~/.dsh/session-bridge/bridge.sock

curl -s --unix-socket $S http://bridge/health

# A new session in a folder, with a first prompt under your own request id
curl -s --unix-socket $S -X POST http://bridge/sessions \
  -H 'content-type: application/json' \
  -d '{"workspacePath":"~/projects/demo","title":"lint pass","text":"Run the linter and fix what it finds.","requestId":"lint-2026-10-26"}'

# Wait up to 10 minutes for that prompt's turn to end; the reply is in .reply.text
curl -s --unix-socket $S "http://bridge/sessions/<id>/requests/lint-2026-10-26?wait=600"

# Change direction mid-turn
curl -s --unix-socket $S -X POST http://bridge/sessions/<id>/prompt \
  -H 'content-type: application/json' -d '{"text":"Skip the tests folder.","mode":"steer"}'

# Read new events as they come: after the last seq you have, waiting up to a minute
curl -s --unix-socket $S "http://bridge/sessions/<id>/events?after=41&wait=60"
```

From another machine, run the same `curl` over SSH on the DSH machine. The socket stays local.

## When the bridge does not listen

It says why in its log, `not listening on <socket>: <why>`, and hands the same words to DSH's logger.

- `another program answers on <socket>`: another DSH, or a second row of this plugin, has it. Give each DSH its own `socketPath`.
- `<socket> is a file that is not a socket`: the bridge never deletes it. Move it, or choose another `socketPath`.
- `its folder … is shared` or `… belongs to another user`: give the socket a folder of its own.
- `the socket path is N bytes`: DSH's data folder is too deep for a socket path; set a shorter `socketPath`.

## Tests

```bash
npm test                               # from the repository root; test/session-bridge.test.js is among them
node scripts/e2e.mjs session-bridge    # the real-DSH test, on every DSH under .e2e/ and the installed app's
```

- `test/session-bridge.test.js` needs no DSH. It covers the settings in words; the session's log read as prompt states, from DSH's queue to the reply; the socket (700 and 600; a stale one replaced; a live one, a plain file, a shared folder, the home folder, a long path refused); the log (no prompt text or titles, 600, a new part past its size, a broken log path); and every route over a stand-in DSH, with its refusals, retries, waits and errors.
- `plugins/session-bridge/test/e2e/run.mjs` runs a real DSH in a throwaway home, with a scripted model. It checks the security claims (modes, no TCP port of its own, no text in the log); a session made with a model, a title and a prompt, answered and found in its log; a steer into a running turn, a followup after it and a steer with nothing running; cancel, rename, a model and DSH's refusals; refusals in words; waits; a restart under a running turn (the prompt reads `dropped`, is sent again with its id, and is in the log once) and a crash (the stale socket replaced); settings changed while DSH runs, wrong ones too, `enabled: false` and back, and a socket another program holds; switching it off and on in Plugins; and in a real window, the bridged session in the list and a prompt through the bridge showing live in the open chat, with pictures light and dark, wide and at 760 px, under `.e2e/shots/session-bridge/<DSH version>/`. `NO_WINDOW=1` skips the window, `KEEP=1` keeps the throwaway home, and `--dsh <version>` runs one DSH only.

## What changed in 0.2.0

- New: `GET /sessions/:id/requests/:requestId`; `wait` on events and requests; your own `requestId`, for safe retries; `version` and `problems` in `GET /health`; `sessionId`, `workspace` and `failedStep` when `POST /sessions` fails after it made the session.
- The defaults follow DSH's data folder (`DSH_HOME`), so a second DSH gets its own socket and log without settings.
- The socket: a shared folder is refused (0.1.0 closed even the home folder to mode 700, and did not load at all for one in `/tmp`); a live socket or a file that is not a socket is left alone (0.1.0 deleted either).
- Settings: a wrong type or value no longer stops the plugin from loading; it is named, and its default used.
- The log: mode 600 even for a log that was there before, its folder made, a new part past 5 MB, renames logged by length.
- Stricter input, refused with a 400 before DSH is asked: a `mode` other than `followup` or `steer` (0.1.0 read it as `followup`); an `after` or `limit` that is not a whole number (0.1.0 answered an empty page); a title over 500 characters; a `provider` without a `model` (0.1.0 skipped the model); a relative or missing `workspacePath`; a body that is not a JSON object.
- Errors: DSH's "not found" is a 404 (0.1.0 answered a prompt to an unknown session with a 409); a wrong method on any path is a 405 with `Allow`; cancel on a session DSH has not opened is a 409, `session/not-running`.
