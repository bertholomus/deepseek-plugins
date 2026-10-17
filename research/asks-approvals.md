# DSH 0.2.x: how it asks the human — question box and permission prompts

Read-only study of the runtime packages in `.e2e/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/`.
All paths below are relative to `node_modules/@deepseek-ai/`. Line numbers are from the
0.2.0-rc.2 copies unless a note says 0.2.1-rc.1. Verified by reading the shipped `lib/*.js`.

## 1. The question box (`ask_user_question`)

### Tool and input shape

- Tool name: `ask_user_question`. Two definitions, selected by config: `mode: "timed"` (default wait 120 s) and blocking `mode: "legacy"` — `dsh-tool-ask-user/lib/index.js:211-224` (`Config = z.object({ mode: z.union(["legacy","timed"]).default("legacy"), timeout: ...default(120) })`), registration at `:64-67` (timed) and `:223-224` (legacy, same name).
- Input: `{ questions: [...] }`; each item `{ id (required), question (required), header?, options?[{label, description?}], multi_select? }` — `dsh-tool-ask-user/lib/index.js:70-117`.
- Timed mode adds a hidden `timeout` parameter — the constant `TIMED_WAIT_PARAMETER = "timeout"` is only declared by the timed schema, and the projection fold uses its presence in the logged request header to decide the calls are answerable after a timeout — `dsh-user-questions/lib/index.js:7-13`, `:92-96`, `:188-198`.
- Result: `{ answers: [{ id, selected: string[], custom? }] }` (`:274-298`); in timed mode, on timeout it returns `{ pending: true, callId, message }` with the pendingNotice text instead (`:123-145`, `:27`).

### What the session records while it waits

- The `tool/call` session event with `callId`, `name: "ask_user_question"`, and JSON arguments — `dsh-session/lib/types/known-event-types.js:72`, folded in `dsh-user-questions/lib/index.js:199-215`. While the tool awaits, nothing else is appended; the answer lands later as a normal `tool/result`.
- Agent status stays the plain two-value enum: `AgentStatus = 'idle' | 'running'` — `dsh-user-questions/lib/typert.host.js:186-189`. There is no dedicated "waiting for question" status; the controller only emits `api-session/status` with a boolean (`agent/status` → `api-session/status (agentId, running)` — `dsh-api-session-controller/lib/types/index.js:262-266`).
- Answerable-after-timeout state is a durable *projection*, key `"userQuestions"` — `dsh-user-questions/lib/index.js:267-292` (`stateSchema` has `timed` + `questions.active[] { callId, questions, state: "open"|"continued" }` and `settled[]`). A question becomes `continued` when the tool returned the pending payload or a resume repair wrote `TOOL_OUTCOME_UNKNOWN` (`:216-237`); a late reply (`user/message` with `source.kind === "user-question-reply"`) settles it (`:255-263`).
- The late reply is a real user message with source `{ kind: "user-question-reply", callId, outcome: "answered" }` and text `JSON.stringify({ kind: "answer_to_pending_question", tool: "ask_user_question", callId, questions, answers })` — `:561-577`; the source type is in `dsh-user-questions/lib/typert.host.js:487-488` (`MessageSourceMap`).

### How the window shows it and how the answer returns

1. Host forwards the waterfall event to every connected client: `user-questions/request` is in the forwarded allowlist with `mode: 'waterfall'` — `dsh-api-remotes/lib/types/remote-events.js:39`. The forwarder only passes requests scoped to a live agent and queues a pending dispatch (`dsh-api-remotes/lib/index.js:147-157, 215-232`).
2. The gateway sends a frame `{ type: "waterfall", event, eventId, agentId, request }` (agent and signal stripped) over the `$events` stream — `dsh-api-gateway/lib/index.js:864-899`; frame shape parsed at `dsh-api-gateway/lib/types/client/remote-events.js:209-227`.
3. The client plugin registers `ctx.remote.$on("user-questions/request", answerQuestion)` — `dsh-client-ui-user-questions/lib/client.js:1927-1929`. `answerQuestion` resolves the session, keys a card by `callId`, and (for timed calls) claims the countdown via the stream `ctx.remote.userQuestions.attachWait(sessionId, callId, claimSignal)` — `:1757-1786`.
4. The window shows the question as a composer *takeover*: `ctx.slots.inject("conversation.composer", ...)` selecting any `PendingQuestion` (precedence 1; plan-review 2) — `:1900, 1911-1916`. Drafts persist per session in store `dsh.user-questions.drafts.v1` (`:495-514`). Buttons submit the whole batch (`:925-947`); Skip yields `{ id, selected: [] }` (`:993-1000`).
5. The answer returns on the *same waterfall*: `pending.answer(answer)` resolves the client-side waterfall channel, whose value is sent to the host as `{ clientId, eventId, outcome: { kind: "result", value } }` via RPC to endpoint `$events/result` — `dsh-api-gateway/lib/types/client/remote-events.js:110-151` and `:157-171`; endpoints `$events` / `$events/result` in `dsh-api-gateway/lib/types/stream-protocol.js:6-8`. The host gateway's `receiveRemoteEventResult` → `settleRemoteEvent` resolves the original Cordis waterfall — `dsh-api-gateway/lib/index.js:907-935`. When no client claims the wait by the deadline the host maps it to the pending result (`dsh-user-questions/lib/index.js:639-650`).
6. For a question that survived its timeout (`continued`), the client mirrors the projection and answers by *remote method* instead: `ctx.remote.userQuestions.answer(sessionId, callId, answer)` — `dsh-client-ui-user-questions/lib/client.js:1779-1825` (`rpcFor`) and `:402-406` (`PendingQuestion.answer` waterfall-vs-rpc branch).

### Host-plugin listing and answering of questions

- List: `ctx.get('sessionProjections').stateOf(agent.session, 'userQuestions')?.questions.active` — exactly how the service's own `continued(agent)` reads it (`dsh-user-questions/lib/index.js:536-538`). Rows carry `callId`, `questions`, and `state` ("open" = foreground wait, "continued" = answerable late).
- Answer a `continued` question: `ctx.userQuestions.answer(agent, callId, { answers: [...] })` (`:552-588`). It validates the batch names each question exactly once (`BAD_ANSWER`), refuses a second queued reply (`REPLY_QUEUED`), and steers the reply into the agent; returns `false` if the call is no longer continued.
- Answer a live foreground question: register a waterfall listener on the agent scope — `ctx.on('user-questions/request', ...)` returning an `AskUserQuestionAnswer` claims it (`:680-684`); `next()` delegates to the next listener. Only the exact live root agent may answer (`assertLiveRoot`, `:531-535`).
- A host plugin can also *hold a timed wait* like a UI would: `ctx.userQuestions.attachWait(agent, callId, signal)` (stream, `:596-600`).

## 2. Permission prompts (approval)

### When `tools/pre-execute` returns `{ kind: 'ask' }`

- The registry runs the waterfall: `const gate = await this.ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }));` — `dsh-tools/lib/index.js:3225`. `gate.kind === 'ask'` is resolved through `serviceAsk` (`:3226-3228`, `:3439-3482`).
- The decision type: `{ kind: 'allow' } | { kind: 'deny', reason, info? } | { kind: 'cancel' } | { kind: 'ask', reason?, display?: {en, ...locales} }` — `dsh-tool-cordis/lib/types/api-catalog.js:5955-5956`.
- `serviceAsk` gets `ctx.get("approval")`; no ApprovalService, or an agent-less call, denies outright (`dsh-tools/lib/index.js:3440-3455`). Otherwise it calls `approval.request({ agent, toolName: exec.name, callId, reason?, displayReason?, signal })` and maps outcomes: `allowed-once` → allow; `rejected` → deny "the user rejected tool …"; `cancelled` → deny + `approvalCancelled` (the call is replaced by the pre-dispatch abort result, `dsh-tools/lib/index.js:3231-3235`); `unavailable` → deny "no approval channel is available" (`:3456-3481`).

### What object is created and where it is stored

- `ApprovalService.request` (`dsh-user-approval/lib/index.js:128-144`) creates an `ApprovalRequestId` (a `randomUUID` string, `:19-21`) and appends the durable audit pair **to the session log**: `approval/asked { id, toolName, callId?, reason? }` then `approval/decided { id, outcome }` (`:132-143`; event names in `dsh-session/lib/types/known-event-types.js:24-25`). The pair must be inside an open turn or `request` throws (`:49-56`, `:130`).
- The *live* pending request itself is not stored anywhere — it lives only inside the `approval/request` waterfall dispatch; if nobody answers, the outcome is `'unavailable'` (fail closed, `:172-189`). There is no approval projection: `SessionProjectionMap` lists `inbox, agentPreset, title, todos, sessionListMetadata, imageLimits, modelSelection, permissions, subagentCatalog, subagentTiming, subagent, goal, userQuestions` — no approvals (`dsh-api-session-controller/lib/typert.host.js:2213`).
- Policy: `ask` or `never` per session, folded from `approval/policy` events; `never` rejects without asking and is stated in the model's runtime context (`NEVER_SENTENCE` / `ASK_SENTENCE` — `dsh-user-approval/lib/index.js:37-41, 74-89, 152-165`).

### Events and status the session shows

- Durable: the `approval/asked` → `approval/decided` pair above (turn-enclosed, so they survive replay).
- Agent status is still just `running` (`dsh-user-questions/lib/typert.host.js:186-189`); the controller's `api-session/status` boolean does not change. The client's session-list row shows a separate `pendingInteraction` flag instead (`dsh-client-ui-session/lib/client.js:344-356, 482`).

### How the window's Allow/Deny reaches the host

- Same forwarded-waterfall path as questions: `approval/request` is allowlisted with `mode: 'waterfall'` — `dsh-api-remotes/lib/types/remote-events.js:14`.
- Client: `ctx.remote.$on("approval/request", answerApproval)` (`dsh-client-ui-approval/lib/client.js:355-357`). `answerApproval` wraps the request in a `PendingApproval { sessionId, kind: "approval", key: "approval:N", toolName, callId, reason, displayReason }` and registers it as a pending interaction (`:150-252, 284-310`).
- The window shows a composer takeover card (`conversation.composer` slot, `:344-354`) with a "Waiting for approval" strip, the reason or "Tool {toolName} requests privileged execution", an optional tool-detail slot `conversation.approval.detail` (`:40, :350-353`), and buttons **Reject** / **Allow once**; Enter allows, Escape rejects (`:70-80, 117-135, 265-271`).
- Clicking resolves `pending.answer("allowed-once" | "rejected")` → the client waterfall returns the outcome → `$events/result` frame → host gateway settles the Cordis waterfall (see §1 step 5) → `ApprovalService.decide` receives it, normalizes unknown values to `'unavailable'`, and `request()` appends `approval/decided` (`dsh-user-approval/lib/index.js:138-143, 172-189`).

### Host-plugin listing and answering of prompts

- List: **not found** — there is no remote method or service that lists pending approvals. A host plugin can reconstruct "asked but not yet decided" by folding the session log (`session.snapshotEvents()` / session-controller `inspect()`, `dsh-api-session-controller/lib/types/index.js:297-306`) for `approval/asked` without a matching `approval/decided`.
- Answer: register an agent-scoped waterfall listener `ctx.on('approval/request', ...)` returning an `ApprovalOutcome` (`'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`) to claim it, or `next()` to delegate; the registry's own fallback is `'unavailable'` (`dsh-user-approval/lib/index.js:176-189`). Outcomes vocabulary: `:30-35`. This works for *one agent at a time* per listener (scope-filtered: "agent-scoped listeners receive only that agent" — `dsh-tool-cordis/lib/types/api-catalog.js:4240`); to cover many sessions a plugin can register a listener per agent scope. There is no cross-session pending-prompt API.

## 3. Learning about asks by event (host side, `ctx.on(...)`)

- `user-questions/request` — waterfall on the agent scope; fires when a question is asked. Return an answer to claim it (`dsh-user-questions/lib/index.js:680-684`).
- `approval/request` — waterfall on the agent scope; fires when an approval is asked (`dsh-user-approval/lib/index.js:176`).
- `session/event` — inspect `event.type`: `tool/call` + later `tool/result` (the ask call itself), `approval/asked` and `approval/decided` (the prompt pair), `user/message` with `source.kind === 'user-question-reply'` (a late answer was admitted) — pattern used by the service itself at `dsh-user-questions/lib/index.js:515-524`.
- `agent/inbox/claimed` / `agent/inbox/discarded` (global listeners) — the service uses these to track a queued late reply that has not been admitted yet (`:498-514`).
- Client side: `ctx.remote.$on('user-questions/request'|'approval/request', ...)` for live requests, plus `binding.session.projections.faceOf("userQuestions").subscribe(...)` (and `"inbox"`) for mirrored continued questions (`dsh-client-ui-user-questions/lib/client.js:1796-1800`).

## 4. Differences 0.2.0-rc.2 → 0.2.1-rc.1

- Service logic is unchanged: `dsh-tool-ask-user/lib/index.js`, `dsh-user-questions/lib/index.js`, `dsh-user-approval/lib/index.js`, and `dsh-client-ui-approval/lib/client.js` are byte-identical between the two copies (diff empty).
- 0.2.1-rc.1 tightens the typert wire schemas for `userQuestions.answer/attachWait`: plain `z.string()` for agent/callId ids, `z.strictObject` with per-field descriptions for the answer batch, plus a new `createTypertRemoteInfo` import — `dsh-user-questions/lib/typert.host.js:4-43` (rc.1) vs `:4-25` (rc.2).
- Forwarded-event allowlist gains `plugin-market/changed` and per-event `resources` metadata for `api-session/*` emits (new remote-access resource scoping; the two waterfall entries are unchanged) — `dsh-api-remotes/lib/types/remote-events.js:15-23` (rc.1) vs `:15-19` (rc.2).
- Locale dictionaries move out of code into `locale/en.json` / `locale/zh.json` files (new `locale/` dir in `dsh-tool-ask-user`, `dsh-client-ui-approval`, etc.; `package.json` exports `"./locale/*.json"` — `dsh-user-questions/package.json:34-38` rc.1).
- Question UI only: a custom-text row is visually "yielded" when an option is already selected on single-select, and the question-reply chat node claims its message (`exclusive: true` role start) so the generic message renderer never shows it — `dsh-client-ui-user-questions/lib/client.js:1139-1141, 1356-1369` (rc.1).
- `dsh-session` adds `job/registered`, `job/settled`, `working-directory/change` event types; the `approval/*` and `tool/*` events are unchanged — `dsh-session/lib/types/known-event-types.js:43-45, 79-82` (rc.1).
- `dsh-tools` changes are PTC/sandbox related (PTC call tracking on `sandbox/mode`, `mode: 'ptc'` drops `'both'`), not approval — `dsh-tools/lib/index.js:889-945` (rc.1).

## Open issues / not found

- No "list pending approvals" API exists in either version; listing must be derived from the session log (§2).
- `approval.request()` cannot run between turns — the audit-pair rule rejects idle-session asks with an explanatory error (`dsh-user-approval/lib/index.js:130`), so a host plugin cannot prompt outside an open turn via this seam.
- The gateway strips `agent` and `signal` from forwarded requests and re-attaches them on the client (`dsh-api-gateway/lib/index.js:52-72`, `dsh-api-gateway/lib/types/client/remote-events.js:157-160`); a client listener sees `request.agent` as the resolved agent object and `request.signal` as the delivery-abort signal — not the host's original cancellation.
