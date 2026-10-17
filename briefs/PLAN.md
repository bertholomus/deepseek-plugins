# Suite v1 plan (builder's design, 2026-10-16)

The brief is `SUITE-BRIEF.md`. This file says how the suite is built: the shared core, each plugin's design, the
tests, and the gate. Facts about DSH's host API come from the runtimes in `.e2e/` (0.2.0-rc.2 and 0.2.1-rc.1) and are
cited in `research/`.

## What DSH gives us (checked in the runtime sources)

- Every committed session event reaches a host plugin through `ctx.on('session/event', (session, event))`. Event types:
  `turn/start`, `turn/end` (`reason.kind`: completed, aborted, blocked, error, max-tokens, interrupted, forked),
  `user/message` (with `source.kind`: user-rpc, cordis-host-runner, agent-message, goal, schedule, ...),
  `assistant/message`, `tool/call`, `tool/result`, `todo/write` (the whole list), `goal/change` (the whole goal),
  `approval/asked`, `approval/decided`, `agent/inbox/spliced`, `command/run`, `command/done`, `session/title`.
- Live state: `agent/status` (`idle` or `running` only), `agent/created`, `agent/disposed`, `agent/inbox/claimed`,
  `agent/turn-stopping`; host-wide `api-session/added|removed|status|activity|error`.
- `ctx.sessionProjections`: pure folds over every session's events, cached per session, persisted, readable for cold
  sessions (`sessionController.projections`), and streamed live to the window (`sessionController.control`). The
  window never polls for them. The coordinator plugin draws its window from one.
- `sessionController`: `list` (cold-safe summaries with `running`, `blank`, `cwd`, projection hints), `inspect`,
  `resolveAgent` (resumes a cold session), `create`, `prompt`, `cancel`, `page`, `projections`, `search`.
- Sending as a plugin: `createUserMessage({content, source: {kind: 'cordis-host-runner'}})` then `agent.followup` or
  `agent.steer`. The message has a stable id, so delivery is proven by the `user/message` or `agent/inbox/spliced`
  event that carries that id.
- `ctx.goals` (`get`, `resume`, `pause`, ...): a goal's phase is durable; its activation (armed or disarmed) is
  process-local and starts disarmed.
- The app's Node is 24 (Electron 44): `zlib.zstdDecompressSync` and `node:sqlite` with FTS5 are there; the npm
  runtimes run on Node 22.20, which has both too.

## The shared core: `plugins/session-watch` (package `dsh-plugin-session-watch`)

Autopilot, Decisions and Agent Terminals share it; nothing else polls sessions.

- One projection unit, `sessionWatch`, folds each session's events into a small value: turn number and whether a turn
  is open, the last turn end (kind, time, readable error), the last user message time, todo counts and the first open
  items, the goal (phase, rounds, objective), pending approvals and questions, and the title. The fold is pure, never
  throws, and returns the same object when nothing changed. The window gets it live through DSH's own control stream.
- One `session/event` listener and the agent events keep a host map of every attached session; cold sessions come
  from `list()` and their projection hints, or `projections()` when a hint is missing.
- Service `sessionWatch`: `list()`, `get(id)`, `on(listener)` (added, removed, status, turn-start, turn-end, state),
  `ready`, `lastText(id)` (the final assistant text of the last turn), `deliver(id, text, {mode})` (confirmed delivery:
  resolves only when the message's own id shows up in the session log, or reports why not), and
  `setExternal(id, status)` for external agents (Agent Terminals) so Decisions sees them too.
- Host code shared by every plugin (store with atomic writes and mode 600, a JSONL action log, paths under DSH_HOME,
  config checks) lives in `shared/host/` and is copied into each plugin's `lib/shared/` by `scripts/sync-shared.mjs`;
  the window kit (glass tokens, page scaffold, empty and error states, focus ring, motion rules) lives in
  `shared/client-kit.js` and is copied between markers into each `client.js`. `npm test` fails when a copy drifts.

## The six plugins (build order)

1. **Autopilot**: rules per session (auto, ask, off; default from config). Triggers: an interrupted turn after a DSH
   restart (resume with a short carry-on note), an idle session with open todos or an active goal (one note after a
   quiet time; rate-limited; backs off after two notes with no progress), and an error turn that left an active goal
   disarmed (re-arm through `ctx.goals.resume`). Every action waits for confirmed delivery, and every action and
   skipped action has a "why" line in the event log. "Ask" raises a card in Decisions instead of acting. A page in the
   panel list holds the kill switch, the rules and the log.
2. **Decisions**: one inbox for `DECISION NEEDED: … — recommend: …` lines at turn ends, coordinator thread asks,
   pending approvals (send/delete Allow once prompts included) and question-box calls, plus Autopilot's asks and
   external agents waiting on the user. Each card: question, recommendation, source session (opens it), waiting time.
   Answers go back into the session (steer when running). Badge count, notifications through the notifications
   plugin, and an optional outbound mirror (webhook or command), off by default.
3. **Agent Terminals**: a coding agent CLI in a visible terminal tab per session, presets by how a CLI resumes and
   where it keeps transcripts (templates over the command name, no vendor names), resume after a DSH restart,
   delivery with paste-then-Enter and a swallowed-Enter retry proven from the agent's own transcript, and its status in
   the session list and in Decisions.
4. **Proof**: claims of done, passed, fixed or deployed at a turn's end are checked against the turn's own evidence
   (tool output, exit codes, test counts, metric deltas, file hashes); a claim without evidence is flagged on the
   turn. An optional verifier thread on a cheap local model re-checks and writes VERIFIED or NOT VERIFIED with a
   reason. A per-session claims ledger with export. Quiet when evidence is there: the false-flag rate is measured on a
   fixture corpus in the tests.
5. **Canon**: read-only recall from an Obsidian vault (lexical search over active notes, scored on the session's
   folder and prompt), injected as one bounded block with cited note paths before a turn, off per session. Capture
   writes draft notes only; Promote is a human-only button that does nothing unless the config allows it.
6. **Recall**: an incremental local full-text index (SQLite FTS5) over DSH session files, optional coding-agent
   transcript folders and Markdown handoff folders; results open the exact turn; filters (folder, model, date, kind);
   a `recall_search` tool; query time measured on a 10k-session synthetic corpus (target < 300 ms).

## Agent Terminals: design (2026-10-17 2:55 AM, from `research/terminals.md` and `research/terminals-2.md`)

What DSH allows, and what follows from it:

- **A terminal is a session's.** `terminalController.create(agent, { id, cols, rows, shellPath })` starts a shell from
  DSH's verified list (zsh, bash, …) in the session's folder; no other program can be started directly, so the coding
  agent is launched by typing `exec <program> <args>` into that shell (when the agent exits, the terminal exits, and its
  state says so). Terminals live in host memory: a DSH restart ends them, and the same id can be created again.
- **Typing takes the input control.** Last attacher wins; the window's tab then reads "This view is read-only." with
  Take control. On 0.2.0 a host plugin can `follow` and `write` (what the live app runs); on 0.2.1 `attach` needs a
  Remote invocation, so only a window can type. So: a host typist on builds that have `follow`/`write`, and a window
  typist otherwise (the browser half leases each typing job from the host and types through the terminal's own Remote
  stream). Either way, when a job ends, the browser half hands the visible tab its control back (`view.connect()` on
  the tab's own model: `webTerminals.view(sessionId, tabId, contentId, terminalId)` returns the panel's model).
- **A tab is the browser's.** Only browser code can show a terminal: `ctx.sidebarRight.openTab('terminal', { params:
  { terminalId } })` for the session on screen (it opens a new tab each call: look for an open one first, through
  `tabsIn` and each tab's navigation params). The browser half opens the agent's tab when its session is on screen,
  once per window, and never again after the person closes it there.
- **A session is listed once a turn ran in it.** Only the agent loop commits `turn/start`. A new agent's session
  therefore starts with one short turn by the session's model: a note that a coding agent has the task, which the
  model acknowledges in a line (`listNewSessions`, on by default; off leaves the session listed only while open). An
  agent can also start in a session that already has turns.
- **Status from the agent's own transcript.** Presets are named by behaviour, never by vendor, and take the program
  name the person types: *flags* (starts with `--session-id <id>`, resumes with `--resume <id>`, one JSON line per
  message in `~/.<program>/projects/<folder>/<id>.jsonl`), *subcommand* (resumes with `resume <id>`, one JSON line per
  event in `~/.<program>/sessions/<y>/<m>/<d>/*-<id>.jsonl`, the id found from the new file after launch),
  *continue* (resumes the folder's latest conversation with `--continue`; no transcript), *plain* (no resume, no
  transcript). The transcript folder can be set per agent. From the transcript: *working* (a message or tool call
  without its final reply), *idle* (a final reply), *waiting on you* (the final reply asks: a DECISION NEEDED line, a
  BLOCKED line, a question; or a tool call left without its result for `askAfterSeconds`, which is how a TUI's approval
  prompt shows), *stopped* (the terminal exited). Status goes to Session Watch's `setExternal` (Decisions, Autopilot's
  rows) and to the session's row in the sidebar (`sidebar.session.row.leading`, shown when DSH draws no status of its
  own, and the row's hover card). A reply that asks raises a Decisions card (`raiseAsk`) whose answer is typed in.
- **Delivery with proof.** A message is pasted (bracketed paste when the agent turned it on, which the typist reads
  from the terminal's own output), then Enter after a short pause. Proof is the agent's transcript gaining a user
  entry with the text. No proof within `proofSeconds` while the agent is not working: Enter again (a swallowed Enter),
  up to `enterRetries`. While the agent is working, a TUI may hold the message until its step ends: the delivery says
  *typed in, waiting for the agent to read it* and the proof may come later. Without a transcript: *typed in*, and the
  page says the agent keeps no transcript to prove it.
- **Restart.** The plugin's state (`agent-terminals/state.json`: agent, session, terminal id, preset, program, args,
  resume id, folder, whether the person stopped it) survives; on start, each agent the person did not stop gets its
  terminal again with the same id (the window's restored tab adopts it) and is launched with its resume arguments. A
  delivery that was in flight is typed again only if its proof never came.
- **One watcher core.** Agent Terminals reads sessions and raises asks through Session Watch; transcripts are read by
  one `fs.watch` per transcript folder with a slow poll as the fallback, not per agent.

## Tests for each plugin

- Unit tests in `test/<plugin>.test.js` (run by `npm test`): folds, rules, parsers, stores, config errors, and the
  browser half's helpers.
- Real-DSH e2e in `plugins/<plugin>/test/e2e/run.mjs` on the shared harness `test/e2e/harness.mjs` (temporary
  DSH_HOME, the web profile, a scripted model, the session bridge), run on both runtimes by
  `node scripts/e2e.mjs <plugin>`.
- DSH Test: a named instance `suite-<plugin>` with the real GLM-5.3 Flash lane, the plugin exercised there, and
  screenshots light and dark from `test/shoot/shoot.mjs`.
- The live fingerprint is checked before and after each run and logged in `PROGRESS.md`.

## The gate

A fresh judge (a subagent that did not write the code) builds the head in a DSH Test instance, exercises the plugin,
shoots light and dark, and writes `review/<plugin>-round-N.md`. Score = min(usefulness, reliability, mean of five).
Pass at >= 8.5 with no criterion below 8. Then merge `suite/v1` into `main` (no force), tag `<plugin>-v1.0.0`, push.
