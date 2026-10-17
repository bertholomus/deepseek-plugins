# Five DSH 0.2.x hooks for Proof, Canon and Recall

Read from `.e2e/dsh-0.2.0-rc.2` with `.e2e/dsh-0.2.1-rc.1` cross-checked. Package paths are relative to
`node_modules/@deepseek-ai/`. rc.2 = dsh-0.2.0-rc.2, rc.1 = dsh-0.2.1-rc.1. A line cited once is rc.2; the same code
sits within ~25 lines in rc.1 unless both are given. Every API below exists in both builds except where marked.

## 1. Adding context to a model turn (Canon)

The loop's per-step order: `turn/start` → claim inbox → assemble system prompt (sections + runtime contexts + tools)
→ `agent/pre-step` waterfall → append `system/message` + `user/message` → model request
(dsh-agent-loop/lib/index.js:905-921, 1036-1061). Five ways a host plugin adds model-visible text:

**A. `ctx.systemPrompt.section()` — static text in the system prompt.**
`ctx.inject(['systemPrompt'], (scope) => scope.systemPrompt.section({ name, order, text, interpolate?, complete? }))`
(dsh-system-prompt/lib/index.js:240-249; rc.1 :253-262). `text` may be `(context) => string`; `order` from
`getSectionOrder("...")`. Per-agent scoping via `ctx.inject(['systemPrompt'], ...)` on an agent-scoped context.
Runs per model request; the rendered prompt is written to the log as `system/message` events `{ turn, step, message }`
only when the rendered text changed (dsh-agent-loop/lib/index.js:1052-1056; rc.1 :1064-1068). Not a chat row; the
prompt is visible through request inspection only ("message.systemPrompt", dsh-client-ui-chat/lib/client.js:5657).

**B. `ctx.systemPrompt.context()` — dynamic runtime context (how DSH adds its own policy "reminders").**
`ctx.systemPrompt.context({ name, order, text | text(context), required? (rc.1) })`
(dsh-system-prompt/lib/index.js:266-276; rc.1 :279, `refreshContext` rc.1 :324-346). Each step, entries render and are
joined into ONE snapshot `user/message` with `source: { kind: "runtime-context", form: "snapshot", sections }`,
appended to the log only when the text changed (dsh-agent-loop/lib/index.js:218-221, 330-350, 907-910).
Example: dsh-sandbox-policy/lib/index.js:120-130 — its `text(context)` reads `context.agent?.session` (id + cwd).
Written to the log (yes) and drawn in the window: a collapsed "context" row — `contextMessage()` builds
`{ kind: "context", producer: contextProducer(source), form }` (dsh-client-ui-chat/lib/client.js:9251-9257; producer
labels :7271-7296; KNOWN_FORMS `instructions/catalog/snapshot/notice/relay/recall` :7248-7255).

**C. `agent/pre-step` waterfall — the fit for "one block per turn".**
`ctx.on("agent/pre-step", async ({ agent, messages, turn, step, signal }, next) => …)`; `messages` are the claimed
inbox messages — the user's prompt is the entry with `source.kind === "user"`. Return `{ kind: "enter", messages }`
(default: claimed + runtime-context) or `{ kind: "reject" }` (blocks the step, turn ends `blocked`)
(dsh-agent-loop/lib/index.js:909-921; rc.1 :909-924). The step's messages are appended as `user/message` surface
events on the first attempt of the step (dsh-agent-loop/lib/index.js:1061; rc.1 :1067-1071). DSH's own AGENTS.md
loader rides exactly this: dsh-agent-instructions/lib/index.js:1271-1289 splices its text into `decision.messages`
with `source: { kind: "agent-instructions", form: "instructions", baseline: true }` (:1173-1175), deduped per
baseline identity (:1073-1082). It fires per model request; key your block on the claimed prompt to get one per turn.
**rc.1 difference:** on the first attempt rc.1 *replaces* any message whose `source.kind === "runtime-context"` with
its freshly refreshed context (rc.1 dsh-agent-loop/lib/index.js:1067-1071) — inject Canon's block under its own
source kind (e.g. `dsh-plugin-canon`, with `form: "notice"` or `"instructions"`), never `"runtime-context"`.

**D. `system-prompt/assemble` waterfall** — rewrite the whole assembly (sections, contexts, tools, variables) before
render: `ctx.waterfall(carrier, "system-prompt/assemble", assembly, context, …)`
(dsh-system-prompt/lib/index.js:355). Per model request; results land as A/B. `system-prompt/change` is emitted on
registration changes (dsh-system-prompt/lib/index.js:183-186).

**E. Queued messages** — `agent.followup(msg)`, `agent.steer(msg)`, `agent.inject(msg)` splice the durable inbox
(dsh-agent-loop/lib/index.js:780, 806-814; splices logged as `agent/inbox/spliced`). These are ordinary user
messages: model sees them, window shows them (steering/turn-trigger rows). `agent/request`
(dsh-agent-loop/lib/index.js:1179-1185; rc.1 :1191) carries config, not text.

**Learning ids/paths/prompt.** Every hook's fused payload carries `agent`: session id `agent.session.id` (== `agent.id`,
dsh-agent/lib/index.js:512), folder `agent.session.header.cwd` (absolute-validated, dsh-session/lib/index.js:1044-1046),
prompt via `messages` in C or `agent.inbox.nextTurn/nextStep` (dsh-agent/lib/types/runtime-types.d.ts:33-41). Note the
claim precedes assemble (dsh-agent-loop/lib/index.js:906-910), so a prompt-keyed block cannot be built inside B on
step 1 — use C.

## 2. Showing something on a turn (Proof)

**Chat slots** (declared in dsh-client-ui-chat/lib/types/client/contract/slots.d.ts:229-290; register with
`ctx.slots.inject(name, () => ctx.slots.register({...}, Component))`):

- `conversation.chat.turnTail` — `list`; owner `{ turn, seq, openFile }` (:33-37, :267-275); rendered before the
  turn's action row (dsh-client-ui-chat/lib/client.js:6580-6584; rc.1 :6977-6980). Coordinator's card chain:
  plugins/coordinator/lib/client.js:5191-5193. A fresh `id` adds an entry; set `order` to sort.
- `conversation.chat.assistant-actions` — `list`; owner `{ messageId }` (:39-41, :277-285); actions on a finalized
  assistant message; reusing an id replaces.
- `conversation.chat.node` — `keyed` by ChatNodeKind (`ChatNodeDataMap` is merge-extensible, :12-16); owner
  `ChatNodeOwnerProps` incl. `cwd`, `forkAt`, `openFile` (:125-141, :229-246). Registering an existing key replaces
  that renderer; coordinator shadows `turn-trigger` at `priority: -1` (plugins/coordinator/lib/client.js:5196-5200).
- Also `conversation.chat.commandview`, `conversation.message.images`, `shell.quota-notice` (root scope).

Session-scope entries get: prop `sessionId`, hooks `useSession` and `useProjection(key, selector)` —
`props: ["sessionId"], hooks: ["session"], keyedHooks: ["projection"]`
(dsh-client-ui-session/lib/client.js:120-129; rc.1 :757-758). `useProjection(KEY, v => …)` is the live per-session
projection face (`binding.session.projections.faceOf(key)`, dsh-client-ui-session/lib/client.js:126-128).

**Plugin messages.** A `user/message` whose `source.kind === "cordis-host-runner"` draws as the expandable
"Plugin status updated" trigger row (dsh-client-ui-chat/lib/client.js:5609, 6663-6665); coordinator sends its notes
this way (`PLUGIN_SOURCE = { kind: 'cordis-host-runner' }`, plugins/coordinator/lib/projects.js:446). The model sees
it too — it is a user message.

**Model-invisible additions.**
1. *Session projections (the supported path).* Host half registers
   `ctx.sessionProjections.register({ key, stateVersion, stateSchema, init, apply })`
   (dsh-session-projection/lib/index.js:68; example dsh-sandbox-policy/lib/index.js:104-110; coordinator's
   `coordinatorSession` — plugins/coordinator/lib/projection.js:2-60, value shape :42-55). `apply` folds committed
   events; the model never sees projection values. Read host-side: `stateOf(session, key)`, `snapshot(session)`
   (dsh-session-projection/lib/index.js:127-154), `onChanged` (:110). Client half draws it in a slot via
   `useProjection(key, …)`.
2. *Live value for the session on screen.* Host stream `sessionController.control(signal)` yields one
   `{ type: "baseline", value: { projections: Record<SessionId, SessionProjectionBaseline> } }` then
   `{ type: "projection", sessionId, key, value, seq }` frames (dsh-api-session-controller/lib/index.js:1156-1172;
   frame types dsh-api-session-controller/lib/types/types.d.ts:529-548; rc.1 control :1221, :3338).
   `session/projections` is the one-shot read (`{ sessionId }` → baseline or null, types.d.ts:397-404).
3. *Log-only events.* `agent.session.append("<plugin>/notice", data)` without `surfaceOp` persists an event the
   model never receives — surface types are only the five message types (dsh-session/lib/index.js:154-160);
   `append` accepts any type, validating only message shapes (:1441-1461, KNOWN types :79-136). DSH itself records
   per-request context as log-only `request/context` (dsh-agent-loop/lib/index.js:1259). But the stock chat renders
   no unknown event types — a notice the *window* shows needs a projection or a plugin slot, not a bare event.

## 3. A fresh thread on a chosen model (Proof's verifier)

Host injects `['sessionController', 'workspaceRegistry', 'agents']`.

- **Create:** `await sc.create({ workspaceId } or { cwd })` — exclusive; optional `sessionId` (adopt a blank) and
  `agentPreset` (dsh-api-session-controller/lib/index.js:686-711). rc.1 rewrite uses `agents.createSession` with a
  `reusable` predicate excluding archived/non-member blanks (rc.1 :755-780). Returns `{ sessionId, agentPreset? }`.
  No `title`/`parent`/`hidden` options exist on create; `sc.rename({ sessionId, title })` sets the title, and
  `sc.fork({ sessionId, atSeq? })` is the only lineage operation (types.d.ts:309-314). Full remote list:
  attachment, cancel, control, create, fork, list, modelCatalog, page, projections, prompt, rename, search,
  selectModel, updateQueue (dsh-api-remotes/lib/client.js, sessionController service).
- **Model:** `await sc.selectModel({ sessionId, provider, model, reasoningEffort? })`
  (dsh-api-session-controller/lib/index.js:720-742) — validates against `llm.listModels(provider)` and resolves
  effort. A model is named `{ provider: "owner-ascents", model: "GLM-5.3-Flash-EXL3" }`; the provider id is the
  registered route id (AgentOptions, dsh-agent/lib/types/runtime-types.d.ts:21-31) and the model id is
  adapter-interpreted. List what is available: `await sc.modelCatalog()` →
  `{ default, routableProviders, groups, failures }` (dsh-api-session-controller/lib/index.js:545-549), or host-side
  `ctx.llm.listModels(provider)` → `[{ provider, id, name, description?, inputModalities? }]`
  (dsh-llm/lib/index.js:2073-2092; catalog membership is advisory for routing).
- **Prompt:** `await sc.prompt({ sessionId, content: [{ type: "text", text }], mode: "queue" | "steer", requestId })`
  (types.d.ts:319-326; bridge usage plugins/session-bridge/lib/index.js:121-127). Host-plugin shortcut with proof:
  `const found = await sc.resolveAgent(sessionId); found.agent.followup(createUserMessage({ content, source }))`
  (plugins/coordinator/lib/projects.js:1701-1711).
- **Wait for the turn to end:** poll `await sc.inspect(sessionId, signal)` → `{ meta, events }`; the turn is over
  when the `turn/start` you prompted in has a following `turn/end` (bridge: count starts vs ends,
  plugins/session-bridge/lib/index.js:169-172; coordinator's exact pattern — find the turn's `turn/end`, then collect
  `assistant/message` text before it, plugins/coordinator/lib/projects.js:3400-3417). `ctx.agents.get(sessionId)?.status`
  is `"idle" | "running"` (dsh-agent-loop/lib/index.js:790-792).
- **Final text:** the last `assistant/message` before that `turn/end` (coordinator :3411-3413); block text lives in
  `data.message.content` (`{ type: "text", text }` parts).
- **Read-only thread:** `create({ agentPreset })` runs a named preset — a preset is a composition of child cordis
  plugins mounted into the agent scope (PresetDefinition `{ id, name, description, order, plugins }`,
  dsh-agent-preset-registry/lib/types/definition.d.ts:4-12; AgentPreset service dsh-agent-preset/lib/index.js:9-40).
  A preset plugin enforces read-only inside the agent scope:
  `ctx.tools.restrict({ allow: ["read", "grep", "glob"] })` or `{ deny: ["write", "edit", "bash", …] }`
  (dsh-tools/lib/index.js:2895-2910; scoped-only — throws without `agent.ctx`), plus `ctx.tools.guard(fn)` to veto
  (dsh-tools/lib/types/index.js:513). The same trick drives subagent `toolFilter`
  (dsh-subagent-fork-in-process/lib/index.js:41-52). Sandbox mode is separate: `sandbox/mode` events + a preset-side
  `sandboxPolicy` scope (dsh-sandbox-policy/lib/index.js:100-130). No preset ships inside these runtime packages —
  presets come from the deployment composition; **not found** in the build.

## 4. A tool for agents from a host plugin (Recall's `recall_search`)

Pattern (dsh-tool-ask-user/lib/index.js:215-216, 232-236; same in dsh-tool-jobs/lib/index.js:297):

```js
export const inject = ['tools'];
export function apply(ctx, config) {
  ctx.tools.register(defineTool({ name, description, parameters, output, execute }));
}
```

- **Definition** (`defineTool`, dsh-tools/lib/index.js:838-896): `{ name, description, parameters, output: { schema,
  render(args, value) → content parts, presentationMeta?(args, value) → UI meta }, execute(args, exec) → plain value,
  timeoutMs? }`. `parameters` is the ParameterSchemaSpec DSL (`{ type: "object", properties, required }`, values with
  `type/required/description`) compiled to JSON Schema (:856-858); sandboxed host halves get `harness.defineTool` /
  `harness.registerTool` instead (dsh-cordis-host-runner/lib/types/guard.d.ts:19-58).
- **Result/error path:** `execute` returns a plain value, validated against `output.schema` (ToolOutputError),
  then `output.render(args, value)` produces the content the model sees (:3543-3566). Thrown errors become an
  `isError: true` result; invalid args fail with ToolArgsError before execution (:865-867).
- **How the model sees it:** every step's `systemPrompt.assemble()` collects registered tools via
  `systemPrompt.tools(provider)` layers into `assembly.tools` (dsh-system-prompt/lib/index.js:300-317) and sends
  them in the request; the call round-trips as `tool/call` `{ turn, step, callId, name, arguments }`
  (dsh-agent-loop/lib/index.js:682-688) and `tool/result` `{ turn, step, message: { callId, content, isError },
  error?, meta? }` linked by `sourceEventSeqs: [callSeq]` (:690-704). `meta` (from `presentationMeta`) is UI-only —
  coordinator's thread cards read it (plugins/coordinator/lib/projection.js:24-26).
- **Runtime add/remove:** `ctx.tools.register()` returns "the exact disposer that unregisters the tool"
  (dsh-tools/lib/index.js:2874-2887) — switching the plugin off (cordis disposes its effects) removes it mid-run;
  the next step's assemble simply omits it. Duplicate names fail; `run_code` is reserved (:2880-2884).
- **Approval:** no per-tool flag and no default ask — the pre-execute gate defaults to `{ kind: "allow" }`
  (`ctx.waterfall(carrier, "tools/pre-execute", exec, () => Promise.resolve({ kind: "allow" }))`,
  dsh-tools/lib/index.js:3235-3238). Any plugin may return `{ kind: "deny" | "ask" | "cancel" }`; `ask` resolves
  through `ctx.approval` (:3429-3453) under the session's policy `ask | never`
  (dsh-user-approval/lib/index.js:37-64; presets dsh-permission-presets/lib/index.js:60-76). A read-only tool says
  nothing special: plain `defineTool` + register never asks; only tools with their own gates (shell, writes,
  escalations) or a `tools/pre-execute` listener name it.

## 5. Opening a session at an exact turn (Recall)

- **Open:** `ctx.uiWorkspace.openSession(target)` — `target: SessionId | SubagentAddress`
  (dsh-api-session-controller/lib/types/client/contract/sessions.d.ts:20; capability
  dsh-client-ui-workspace/lib/types/client/navigation.d.ts:19-23; implementation
  dsh-client-ui-workspace/lib/client.js:821-823 rc.2, :1470 rc.1). No turn parameter.
- **Turn identification:** a turn is its `turn/start` number (`data.turn`); a message is its log seq (`SessionSeq`,
  the log index) and `MessageId`. Turn navigation inside the open chat is DSH-internal
  (`scrollToTurn(turn)`, dsh-client-ui-chat/lib/client.js:3763-3767, "chat.turnNavigation.jump" :5650) — **no
  plugin-facing scroll/locate API** (grep over client packages finds none; research/client-ui.md §4 agrees).
- **Exact-turn reads a plugin can do:** `session/page { address, throughSeq, beforeSeq?, maxMessages?, turnWindow? }`
  pages the log backwards (types.d.ts:444-452); `session/follow { address, assistantStream? }` opens the log with a
  cursor (types.d.ts:459-463). `session/fork { sessionId, atSeq? }` — "Exact inclusive source event seq; omission
  selects the latest completed-turn prefix" (types.d.ts:309-314) — is the one exact-turn *open*, but it creates a
  new session, it does not scroll the old one. Practical Recall shape: link stores `{ sessionId, turn, seq }`, the
  click calls `openSession(sessionId)`, and the plugin renders the stored text itself (or its own right-sidebar tab
  via `sidebarRight.openResource`).
- **Cold and archived:** a client plugin retains a possibly cold session with
  `ctx.sessions.retain(target, { source })` — returns immediately, `reference.ready` settles the initial open
  (sessions.d.ts:33-45); cold sessions keep saved list/projection values (plugins/session-watch/lib/watch.js:7-10).
  An archived session still opens and reads; it just cannot run a step: the host's `agent/pre-step` gate rejects
  every step for an archived session and its subagent lineage until unarchive, ending the turn `blocked` with no
  request (dsh-api-session-controller/lib/index.js:2407-2426); the client clears an archived selection on archive
  (navigation.d.ts:71-76).

## Not found / open issues

- No create option for `title`, `parent`, or `hidden`; no client-plugin API to scroll an open chat to a turn/seq.
- No preset definitions ship in the runtime builds (read-only preset must be written by the suite).
- rc.1 replaces `runtime-context` messages injected via `agent/pre-step` (rc.1 dsh-agent-loop/lib/index.js:1067) —
  Canon must use its own source kind.
- Whether DSH's own presets restrict tools per preset is undetermined from these packages (composition lives in the
  deployment profile, which this task does not read).

## Summary

- Result: five hook areas documented from both builds with citations; every question answered except the gaps
  listed under "Not found / open issues".
- Files changed: `research/turn-hooks.md` (this file, only file written).
- Biggest build deltas: rc.1 late-refreshes runtime contexts and rewrites `session.create` internals; chat bundle
  rebuilt wholesale (line numbers shift, contracts unchanged).
- Open issues: exact-turn scroll for Recall links; read-only preset authoring for Proof's verifier.
