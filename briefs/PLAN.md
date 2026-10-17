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
