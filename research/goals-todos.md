# DSH 0.2.x: how a session's /goal and todo list are stored and signalled

Basis: `.e2e/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/` (cited paths are relative to
`node_modules/@deepseek-ai` and default to rc.2; rc.1 differences are in §7). Read-only
research; verified by reading the shipped `lib/*.js`.

## 1. What /goal does (dsh-command-goal)

- Registers a command `goal` ("Set or view the goal for a long-running task"), hint
  `[<objective>|clear|edit <objective>|pause|resume]`, attachments allowed
  (dsh-command-goal/lib/index.js:174-184).
- Grammar: empty = show; `clear`/`pause`/`resume`; `edit <objective>`; anything else is a
  create objective (dsh-command-goal/lib/index.js:19-35). Create is refused unless no goal
  exists or the current phase is `complete`; `edit` on a complete goal creates a new goal
  (dsh-command-goal/lib/index.js:126-145).
- Attachments are submitted as a separate `user` source message before the goal's next
  round (dsh-command-goal/lib/index.js:98-107).

## 2. Where goal state lives

State is event-sourced in the session's durable log; there is no separate store.

- Event type `goal/change` (in the known event vocabulary,
  dsh-session/lib/types/known-event-types.js:40). Snapshot form, exact fields
  `{kind:"goal/change", version:1, operation, goal, roundsStarted, createdAt, updatedAt}`
  (dsh-goal/lib/index.js:139-160). `operation` is one of `create|edit|pause|resume|complete|block`
  (dsh-goal/lib/index.js:33-40). `goal` is `{id, revision, objective, phase, maxGoalRounds}`
  plus `blockedReason:{code,message}` only when phase is `blocked`
  (dsh-goal/lib/index.js:86-102). Ids look like `goal-<uuid>` (dsh-goal/lib/index.js:642).
- Clear form: `{kind:"goal/change", version:1, operation:"clear", cleared:{id,revision}, clearedAt}`
  (dsh-goal/lib/index.js:122-136, 744-751).
- Goal *rounds* are counted from ordinary `user/message` events whose
  `source` is `{kind:"goal", goalId, revision, round}`; the fold requires
  `round === roundsStarted + 1` and `round <= maxGoalRounds`
  (dsh-goal/lib/index.js:162-167, 273-280).
- Derived projection registered under key `"goal"`, `stateVersion: 6`; host state is
  `{current: {goal, roundsStarted, createdAt, updatedAt} | null, seenGoalIds[], failure}`
  and the client wire view is `{goal, roundsStarted, createdAt, updatedAt} | null`
  (dsh-goal/lib/index.js:343-382, 439-453). A replay failure is parked in `failure`
  (dsh-goal/lib/index.js:422-437).

## 3. Phases, "armed"/"disarmed", and what changes them

- Durable phases: `active | paused | blocked | complete` (dsh-goal/lib/index.js:41-46).
- Activation is **process-local only** (per session, in a WeakMap), `armed`/`disarmed`,
  initially `disarmed` (dsh-goal/lib/index.js:590, 777-787). It is returned in goal views
  and tool output but is not a durable phase.
- Transitions (dsh-goal/lib/index.js:635-753; replay rules 176-212):
  - `create` → revision 1, phase `active`, `armed`; only allowed with no goal or a
    `complete` goal (635-649).
  - `edit` → next revision, phase unchanged, activation kept (657-669).
  - `pause` → `active`→`paused`, `disarmed` (676-678).
  - `resume` → `active|paused|blocked`→`active`, `armed`; refused when
    `roundsStarted >= maxGoalRounds` (686-699).
  - `complete` → `active|paused|blocked`→`complete`, `disarmed` (706-712).
  - `block` → `active`→`blocked` with `{code, message}` reason, `disarmed` (720-729).
  - `clear` → tombstone `{id, revision+1}`, goal removed from current state (736-753).
- Activation edges: every agent `agent/created` sets `disarmed` (dsh-goal/lib/index.js:594-596);
  each committed `goal/change` sets the activation recorded with the mutation
  (dsh-goal/lib/index.js:598-603, 858-867). So after a session restart/fork an active goal
  is `active` but `disarmed` — the system prompt says a human "continue/resume" request
  should rearm it via `update_goal` action `resume`
  (dsh-tool-goal/lib/index.js:195-197).

### Error turns (turn end with an error)

- The loop sets the turn's end reason `{kind:"error", error:{message,code}}` and calls
  `throwError`, which emits `agent/error` (dsh-agent-loop/lib/index.js:1008-1017, 876-886).
- The goal-round driver's handler is `ctx.on("agent/error", ({agent}) => disarm(...))`
  (dsh-goal-round-driver/lib/index.js:200-203). **An error turn therefore disarms the
  goal** — the durable phase stays `active`, only the continuation authority is dropped.
  No pause, no automatic re-arm.
- The driver's `turn/end` handler only special-cases `max-tokens` (→ disarm) and
  `aborted` (→ mark the round cancelled if it was claimed/admitted, else disarm)
  (dsh-goal-round-driver/lib/index.js:261-269); `turn/end` reason kinds also include
  `blocked` and `completed` (dsh-agent-loop/lib/index.js:950-966) and carry no goal logic.
- If a queued/claimed goal round is cancelled, the next idle tick **pauses** the goal
  (dsh-goal-round-driver/lib/index.js:213-230).
- Resuming: human asks; the model calls `update_goal` action `resume`, which requires a
  direct human turn and refuses to resume a `paused` goal ("the model cannot resume a
  paused goal; the user must resume it") (dsh-tool-goal/lib/index.js:348-353). A
  `paused`/`blocked` goal is resumed only through the human paths: `/goal resume`
  (dsh-command-goal/lib/index.js:149-151) or the UI's goals remote service.

## 4. How the goal continues the agent between turns

- Driver plugin `goal-round-driver`, `inject: ["agents","goals","sessions"]`
  (dsh-goal-round-driver/lib/index.js:25-30).
- When the agent goes idle (`agent/status` → `requestDrive`), and the goal is
  `active` + `armed`, and `roundsStarted < maxGoalRounds` (else it calls
  `goals.block(..., {code:"round-limit", ...})`), it sends the next round
  (dsh-goal-round-driver/lib/index.js:213-231, 103-131).
- It builds a user message whose text is a `<goal_round>` block:
  `Objective: <json>\nRound: N/M\n\nContinue working toward the objective in this same
  session. ... read the current goal, and mark it complete. If work remains, leave the
  goal active for the next round.` (dsh-goal-round-driver/lib/index.js:11-18) and calls
  `agent.followup(message)` with `source:{kind:"goal", goalId, revision, round}`
  (dsh-goal-round-driver/lib/index.js:132-154).
- Durable trail of a round: `agent/inbox/spliced` when the prompt is queued
  (dsh-agent-loop/lib/index.js:200-206), then `user/message` (the `<goal_round>` text with
  the goal source) when the turn admits it (dsh-agent-loop/lib/index.js:1061). Runtime
  signals: `agent/inbox/inserted|claimed|discarded`, `agent/pre-step` (the driver
  re-validates the reservation and rejects stale rounds,
  dsh-goal-round-driver/lib/index.js:237-252, 274-340), and a session flush checkpoint
  before each new round (79-121).
- After an autonomous round reports `complete`/`blocked`, the tool injects a deferred
  `<goal_complete>`/`<goal_blocked>` notice telling the model to write a closing message
  and call no more tools (dsh-tool-goal/lib/index.js:91-98, 365-372).

## 5. What a plugin can call

Services live on the cordis context; declare them in your plugin's `inject`
(cordis refuses un-injected property access, cordis-plugin-loader/lib/index.js:676).

- `ctx.goals` — the GoalService (registered as `"goals"`,
  dsh-goal/lib/index.js:592; catalogued in dsh-tool-cordis/lib/types/api-catalog.js:1073-1135):
  - `get(agent)` → goal view or `undefined`; throws `GOAL_AGENT_NOT_LIVE` unless the
    argument is the exact live agent (dsh-goal/lib/index.js:611-614, 767-769).
  - `create(agent, {objective, maxGoalRounds?})`; `edit(agent, ref, {objective?, maxGoalRounds?})`;
    `pause(agent, ref)`; `resume(agent, ref)`; `complete(agent, ref)`;
    `block(agent, ref, {code, message})`; `clear(agent, ref)`; `disarm(agent)`.
    `ref` is the compare-and-set pair `{id, revision}`; a stale ref throws
    `GOAL_STALE_REVISION` (dsh-goal/lib/index.js:760-765). The view adds
    `roundsStarted, createdAt, updatedAt, activation` (dsh-goal/lib/index.js:880-889).
  - To read state without a live agent:
    `ctx.sessionProjections.stateOf(session, "goal")` → the §2 host state
    (dsh-session-projection API catalogued at dsh-tool-cordis/lib/types/api-catalog.js:2110).
- Events: `goal/changed` on the agent-scoped emitter with
  `{agent, change:{operation, ref, goal?}}` after the durable event commits
  (dsh-goal/lib/index.js:871-877), and `goal/activation-changed` on the context with
  `{sessionId, goal?{id,revision,activation}}` (dsh-goal/lib/index.js:789-806).
- Note: the "direct human turn" authority checks live in the *tool* layer
  (dsh-tool-goal/lib/index.js:27-80), not in the domain; a plugin calling
  `ctx.goals.resume` directly is not subject to them, but it must hold the exact live
  agent and a fresh `ref`.

## 6. Todos

- Tool name `todo_write`, plugin `tool-todo`, `inject: ["tools","sessionProjections"]`
  (dsh-tool-todo/lib/index.js:11-12, 95-97).
- Input: `{ todos: [{content: string, status: "pending"|"in_progress"|"completed"}] }` —
  the COMPLETE replacement list; content must be non-empty, trimmed, unique, and at most
  one `in_progress` unless the deployment config `allowParallelInProgress` is true
  (dsh-tool-todo/lib/index.js:14-18, 45-62, 98-119). No other statuses exist.
- Each call appends a durable `todo/write` session event (vocabulary:
  dsh-session/lib/types/known-event-types.js:67) whose data is
  `{ todos: [{content, status}, ...] }` — **the full list every time**; replay is
  last-write-wins (dsh-tool-todo/lib/index.js:5-9, 170-173).
- Projection key `"todos"`, `stateVersion: 2`: after each `todo/write` it is the new
  list; **it resets to `null` at every `turn/start`**, so the projection reflects only
  the current turn (dsh-tool-todo/lib/index.js:80-94). The built-in UI panel renders
  from it (`useProjection("todos") ?? []`, dsh-client-ui-conversation/lib/client.js:17743).
- Reading a session's open todos from a plugin:
  `ctx.sessionProjections.stateOf(session, "todos")` for the current-turn list
  (may be `null` right after `turn/start`), or fold the session log —
  `session.snapshotEvents()` (dsh-session/lib/index.js:1376), take the last
  `todo/write` event's `data.todos`. The tool result is
  `{todos, counts:{pending, inProgress, completed}}` (dsh-tool-todo/lib/index.js:175-185).

## 7. Differences 0.2.0-rc.2 → 0.2.1-rc.1

- `dsh-goal`, `dsh-tool-goal`, `dsh-command-goal`, `dsh-tool-todo`: `lib/` is byte-identical
  (only README/locale files differ; `stateVersion` 6/2 and defaults `maxGoalRounds` 256,
  `blockedAfterConsecutiveRounds` 3 unchanged — dsh-goal/lib/index.js:452,588,
  dsh-tool-todo/lib/index.js:93, dsh-tool-goal/lib/index.js:115).
- `dsh-goal-round-driver` changed in rc.1:
  1. Before starting a new round it waits for the agent's subagent children:
     `const subagents = ctx.get("subagents"); if (subagents !== void 0) await
     Promise.race([subagents.waitForChildren(agent), unloading.promise])`
     (rc.1 dsh-goal-round-driver/lib/index.js:129-135; `waitForChildren` exists at
     dsh-subagent/lib/types/index.js:159-160).
  2. A `drivable(goal)` helper replaces the inline check (rc.1 :80-83).
  3. On idle with a cancelled round, a still-queued round prompt is removed from the
     inbox (`agent.inbox.remove(attempt.messageId)`, rc.1 :231-238; method at
     dsh-agent-loop/lib/index.js:145) in addition to pausing.
  4. Teardown resolves the `unloading` promise (rc.1 :355).
- No goal/todo-related change in `dsh-agent-loop` between the versions (its diff is
  runtime-context plumbing).

## 8. Not found / caveats

- No code in either build *creates* a round-0 goal source; `GOAL_CHANGE_VERSION` is
  documented as "the goal change embedded in a round-zero message source"
  (dsh-goal/lib/index.js:10-11) and round 0 is only filtered by the driver
  (dsh-goal-round-driver/lib/index.js:96). Treat it as reserved.
- I did not find where the four packages are composed into the host config (the `dsh/lib`
  bundles do not name them); they are dependencies of `dsh` (dsh/package.json:39,50,80,90)
  and load as ordinary domain plugins via `apply(ctx, config)`.
- The `todos` projection's turn-reset behavior is as coded; a durable "last written"
  list is only recoverable by folding `todo/write` events yourself.
