# DSH 0.2.x terminals, part 2 — five questions for a plugin that runs an agent in a session terminal

Conventions: paths are relative to `node_modules/@deepseek-ai` unless noted; two builds are compared and marked `0.2.0` (`.e2e/dsh-0.2.0-rc.2`) or `0.2.1` (`.e2e/dsh-0.2.1-rc.1`) when they differ. Everything below was read from those files; anything not confirmed says "not found".

## 1. Writing input without stealing the window's control

**The control model is the same in both builds: one `controller` slot per terminal, last attacher wins, hand-over is implicit.** There is no negotiation, refusal, or read-only attach option.

- 0.2.0: `follow(id, signal)` sets `this.controller = { id, follower }` and broadcasts a `state` frame carrying the new `info.controllerId` (`dsh-api-terminal-controller/lib/index.js:373-383`). The previous attachment is *not* removed — it stays in the `followers` set and keeps receiving `output` frames until its own stream ends (`:391,397-400`). Its writes then fail: `requireController` throws `terminal/control-unavailable` with `{ reason: "read-only" }` when `this.controller?.id !== id` (`:489-492`), and `BrowserTerminal.write` calls it (`:418-423`).
- 0.2.1: `attach(input, limits, signal, inputWindow)` sets `this.controller = follower` (`:392`); "older attachments keep receiving output" (doc, `:376`). Input arrives as sequence-numbered commands on the same stream; a non-controller's commands get `requireController`'s read-only refusal (`:429,520-523`), answered as `{ type: 'ack', sequence, refusal: 'read-only' }` (`:456-462`). Per-follower `writable` is pushed in every snapshot and state frame: `writable(follower)` is false unless `this.controller === follower` (`:395,471-479`).

**What the window's tab does when a host plugin takes control** (same in both builds):

- The tab stays attached and keeps rendering output; it only loses `writable`. 0.2.0 computes it as `writable: frame.info.state === 'running' && frame.info.controllerId === this.attachmentId` (`dsh-api-terminal-controller/lib/types/client/model.js:291`); 0.2.1 trusts the frame's `writable` (`:362`).
- A write attempted while not writable fails with `terminal/control-unavailable`; 0.2.0 patches `{ writable: false, error: undefined, issue: undefined }` — no visible error (`model.js:323-326`); 0.2.1 turns the ack refusal into `writable: false` (`:358-360`).
- The view then shows a status line: "This view is read-only." plus a **"Take control"** button that calls `model.connect()` — a re-attach that regains input control (`dsh-client-ui-sidebar-terminal/lib/client.terminal.js:13331-13344`, identical line in 0.2.0; locale strings `client.js:301-302` zh, `332-333` en; `connect()` doc "Reattach with a fresh screen and regain input control", `model.js:140`). The tab does *not* re-attach by itself.

**Is a read-only follower possible? No, in either build.** The complete Remote surface is `environment, shells, list, create, retain, follow|attach, write (0.2.0 only), resize (0.2.0 only), rename, close` (`dsh-api-terminal-controller/lib/typert.host.js:619-682` in 0.2.0, `:623-672` in 0.2.1). There is no observe/listen/output-only method; `follow`/`attach` unconditionally take control and take no options; `retain` is lifetime-only — no output, no control (0.2.0 `lib/index.js:860-862`). A pure reader would have to attach (displacing the window to read-only) and detach quickly, or never attach.

**Host-side paths that do NOT take control:**

1. **The `owners` map → PTY handle (internal, unversioned, but reachable).** A host plugin that gets the service holds the live instance: `ctx.terminalController` (`~/.dsh-plugins/minime-bridge/lib/index.js:159`). `owners` is a plain instance field (`lib/index.js:758` 0.2.0; `:764` 0.2.1); `owners.get(sessionId).terminals.get(id)` yields the `BrowserTerminal`, whose first field `handle` is the live `SubprocessTerminalHandle` (`:305,323` 0.2.0; `:316,337` 0.2.1). `handle.write(data)` writes the PTY directly (`dsh-subprocess/lib/types/types.d.ts:249`), never touches `controller`, and pushes no state frame — the window keeps control and simply sees the echoed output. `BrowserTerminal.write` itself always demands the controller, so the *supported* path always takes control; the handle path is reaching past it.
2. **`subprocess` APIs: no.** The provider surface is `spawn` + `spawnTerminal` only — it creates new processes and cannot look up an existing PTY (`dsh-subprocess/lib/index.js:80-110`). The existing handle is referenced only by the `BrowserTerminal` (and a private set inside the local provider). Not found: any subprocess method addressing an existing terminal.

**0.2.0 → 0.2.1 trap for minime-style plugins:** in 0.2.1 `write` is gone and `attach` requires a Remote invocation — `const invocation = this.ctx.invocation; if (invocation === void 0) throw new Error("Terminal attachment requires a Remote invocation")` (`0.2.1 lib/index.js:886-890`). A host plugin cannot call `attach` in-process the way it could call `follow`; input must ride a real Remote stream carrier (which takes control), or use the `handle` path above.

**Exactly what minime-bridge does** (read only; `~/.dsh-plugins/minime-bridge/lib/index.js`):

- `attach(t)` (`:169-190`): aborts its old follow, mints a fresh attachment id `minime-<uuid12>`, calls `tc().follow(t.agent, t.id, t.attachmentId, ac.signal)` and iterates it forever in a pump loop — buffering `output` chunks (4 MiB cap) and updating `t.info` from `state` frames. The comment on the first `next()` says it: `// snapshot; this also takes input control` (`:175`).
- `termWrite` (`:212-219`): `await tc().write(t.agent, t.id, t.attachmentId, data)`. If that throws `control-unavailable` it calls `attach(t)` again — "take control back (e.g. Albert typed in the tab)" — then retries the write. So minime *re-steals* control on every contested write.
- `holdTerminal` (`:192-197`): keeps an open `retain` stream so the 2 h unattended reaper never fires.

**What the window sees then:** the window's tab becomes read-only (state frame with `controllerId: minime-…` in 0.2.0, `writable: false` in 0.2.1), keeps showing output, shows "This view is read-only." with "Take control"; if the user clicks it, the window re-attaches, minime's next write fails, and minime silently re-attaches — last attacher wins each round.

## 2. The `snapshot` frame's `screen` field

**It is the serialized emulator buffer, escape codes and all — not plain lines.** Both builds build it the same way: `screen: this.serializer.serialize()` where the serializer is the bundled serialize addon loaded over an in-host headless emulator (0.2.0 `dsh-api-terminal-controller/lib/index.js:301-302,327-334,388`; 0.2.1 `:312-313,338-345,393`).

- The addon's `serialize()` emits one text blob: rows separated by `\r\n` (or wrap-handling sequences), SGR color/attribute runs, `[nX`/`[nC` gap spacing, cursor repositioning at the end, mode restores (`[?2004h`, `[?1h`, …), and — when the alt buffer is active — an `[?1049h[H` section with the alt buffer appended (`@xterm/addon-serialize/lib/addon-serialize.js:1`, in `node_modules`, sibling scope of `@deepseek-ai`).
- The window proves the round-trip: it feeds `screen` straight into its emulator — `xterm.write(render.frame.type === "snapshot" ? render.frame.screen : render.frame.data, …)` (0.2.0 `dsh-client-ui-sidebar-terminal/lib/client.terminal.js:13451`; 0.2.1 `:13465-13469`, resizing first on a snapshot `:13465-13467`).

**Getting visible text lines from it.** Exact recipe: write `screen` into a headless emulator instance (the same bundled `@xterm/headless` the host uses) and read the active buffer's viewport: `for y in [buffer.active.baseY .. baseY+rows-1] → buffer.active.getLine(y).translateToString(true)`. That is what the host itself holds (`BrowserTerminal.screen` is a headless `Terminal`, `0.2.0 lib/index.js:327-334`) — reachable exactly through the `owners`-map path of §1 if a plugin wants the *live* lines rather than the last snapshot. minime-bridge's shortcut is lossy regex stripping instead: `plain()` removes OSC and CSI sequences and turns lone `\r` into `\n` (`minime-bridge/lib/index.js:84-92`), served as `text`/`screenAtAttach` (`:248-249`) — wrong for wrapped rows and cursor-positioned writes.

**A follower that only reads:** see §1 — not possible in either build without taking input control; every attachment is a potential controller and displaces the previous one to read-only.

## 3. Slots on a session row (dsh-client-ui-workspace)

All four are declared `kind: "list", scope: "root"` (0.2.0 `dsh-client-ui-workspace/lib/client.js:4306-4330`; 0.2.1 `:5225-5238`). Names and props:

| slot | props passed | rendered where | conditions |
|---|---|---|---|
| `sidebar.session.row.leading` | `{ sessionId }` | the row's fixed 16px leading seat | only when `!row.archived && !row.blank && !showStatus` — displaced by the built-in status dots whenever a live status exists (0.2.0 `:1622-1623`; 0.2.1 `:2306`) |
| `sidebar.session.row.hover` | `{ sessionId }` | inside the row's hover card, before the status lines | always, including archived and blank rows (0.2.0 `:1472`; 0.2.1 `:2154`) |
| `sidebar.workspaces.session.menu.item` | `{ sessionId, displayTitle }` + injected hooks `menuOpenState`, `shortcuts` | entries of the row's ⋯ menu | non-blank rows only (menu lives in `rowActions`, hidden when `row.blank`) (0.2.0 `:1661-1664`) |
| `sidebar.workspaces.session.row.action` | `{ sessionId, displayTitle }` | inline action rendered next to the ⋯ button in `rowActions` | same (0.2.0 `:1665-1667`) |

- **No trailing-text slot.** The trailing span is built in: `primaryStatus.trailingLabel ?? timeLabel(row.updatedAt, now, t)` plus a pin indicator (0.2.0 `:1633-1637`). The status dots themselves come from `sessionStatuses(node, t)` computed from the session node (`:1386-1406`), not a slot; `showStatus = primaryStatus.state !== "idle"` (`:1577`).
- Registration shape (any client plugin): `ctx.slots.inject('<name>', () => ctx.slots.register({ name, id, order, inject }, Component))`.

**The coordinator plugin** (`plugins/coordinator/lib/client.js`) adds exactly three things to rows:

- `sidebar.session.row.leading` → `ThreadMark` (`:5201-5204`): a 16px `.dshp-t-mark` span — branch icon for thread rows, a `StateDot` news mark for a coordinating chat, a pause icon (`:4350-4367`). Its CSS hides its own mark when the seat holds more than one mark, so it yields to DSH's or another plugin's (`:446,452`).
- `sidebar.workspaces.session.row.action` → `RowPlace` (`:5205-5207`): marks and indents thread rows via data attributes read by CSS.
- `sidebar.session.row.hover` → a hover section (`:5214-5216`).

## 4. Blank sessions — leaving `blank` without a model request

**The projection** (identical logic in both builds):

```js
// 0.2.0 dsh-api-session-controller/lib/index.js:1807-1811 (0.2.1 :1872-1876)
function applySessionListMetadata(state, event) {
	const blank = state.blank && event.type !== "turn/start";
	const lastPromptAt = event.type === "user/message" && event.data.source.kind === "user" ? event.time : state.lastPromptAt;
	return blank === state.blank && lastPromptAt === state.lastPromptAt ? state : { blank, lastPromptAt };
}
```

Registered with `init: () => ({ blank: true, lastPromptAt: null })` (0.2.0 `:1841`; 0.2.1 `:1911`); live summaries default `blank: metadata?.blank ?? session.seq === 0` (0.2.0 `:1878`; 0.2.1 `:1949`), cold `?? false` (0.2.0 `:1915`; 0.2.1 `:1999`). The sidebar filter is `if (session.blank && session.id !== current) return false;` after the subagent check (0.2.0 `dsh-client-ui-workspace/lib/client.js:357-359`; 0.2.1 `:965-966`).

**Every place that commits `turn/start`: exactly one per build.** A repo-wide grep over all runtime packages finds a single `append("turn/start"` — the agent loop's `turn()` opener, `this.session.append("turn/start", { turn })` (0.2.0 `dsh-agent-loop/lib/index.js:943`; 0.2.1 `:945`). Nothing else — no command, goal, fork, or rename path commits it.

- **`command/run` explicitly does not unblank:** "Both are direct log-only appends — no turn wraps them" (`dsh-commands/lib/index.js:305-307`; `command/run` at `:341` via `appendLifecycle` `:404-407`).
- **`sessionController.prompt` has no skip-model flag:** `prompt` admits the message then calls `agent.steer(message)` or `agent.followup(message)` (`dsh-api-session-controller/lib/index.js:850-884`), which always drive the loop's turn. (A turn whose model request then *fails* has still committed `turn/start` — but that required a request.)
- **Goal, fork, rename** commit other event types (goal events, copied history, `session/title`); a fork is non-blank only because it copies the source's events — moot for a blank session. No list flag or session-controller method to set `blank` was found.

**Reachable-but-unsupported path.** `resolveAgent` returns the live agent, and the `"session"` typert lookup hands out `agent.session` itself (`dsh-api-session-controller/lib/index.js:191-195`); the command runner uses that same `agent.session.append`. A host plugin could therefore append a well-formed `turn/start` (`data.turn` number; data is schema-validated on append, `dsh-session/lib/index.js:1460`) and the projection would unblank the session. Caveats: the turn number must match the log's next turn (the format tracks it, `dsh-session-format-v3-to-v4/lib/index.js:1505-1507`), the agent loop will later append its own `turn/start {turn: phase.turn + 1}` regardless, and none of this is a declared contract.

## 5. Opening a terminal tab from a client plugin

- **Kind name: `"terminal"`.** Registered by the panel package: `ctx.sidebarRightTabs.register({ id, kind: "terminal", multiple: true, priority: "builtin", title: () => t("title"), guide: [...] })` (`dsh-client-ui-sidebar-terminal/lib/client.js:440-451`; the panel is byte-identical in both builds).
- **Params for kind `terminal`:** declaration-merged into `SidebarRightTabParamsMap`: `terminal: { terminalId: WebTerminalId } | { shellPath: string }` (`dsh-client-ui-sidebar-terminal/lib/types/client/face.d.ts:20-27`, both builds). "Values are JSON-shaped by convention; nothing validates them at run time" (`dsh-client-ui-sidebar-right/lib/types/client/contract/params.d.ts:5-12`). `openTab(kind, options)` takes `SidebarRightOpenTabOptions = { paneId?, preferNewPane?, replaceTab?, revealIfOpened?, params? }` (`dsh-client-ui-sidebar-right/lib/types/client/service.d.ts:118-133`).
- **When the session is not on screen:** the cross-plugin `ctx.sidebarRight.openTab(kind, …)` **throws** `sidebarRight: no session surface is mounted` (0.2.0 `dsh-client-ui-sidebar-right/lib/client.js:6744-6752`; 0.2.1 `:2482`); `openTabIn(sessionId, kind, …)` is a silent no-op for a session whose store was never adopted or was released (0.2.0 `:6410-6421`; 0.2.1 `:2152-2156`).
- **`multiple: true` means every `openTab('terminal', …)` makes a new tab** — the contentId is `sidebar://terminal/<new uuid>` per call (0.2.0 `:6452`), so nothing dedupes; check first.
- **Is a tab for that terminal id already open?** Tab records (`ctx.sidebarRight.tabsIn(sessionId)`, 0.2.0 `:6377-6379`) carry `{ id, kind, contentId, title }` — no params. Read each tab's navigation params instead: `ctx.sidebarRight.tabDomain.occurrence(sessionId, { id: tabId }).navigation.getSnapshot().params` and match `"terminalId" in params` — exactly what the panel's own `view()` does (`dsh-client-ui-sidebar-terminal/lib/client.js:374-383`). `occurrence()` throws for a tab with no committed occurrence (0.2.0 `:6090-6093`). The cross-session `ctx.sidebarRight.openTabs` inventory carries `{ sessionId, tabId, kind, contentId }` only (0.2.0 `:6285-6313,6336-6342`). For restore-after-restart the binding lives in localStorage `dsh.terminal.binding.v1.<sessionId,contentId>`, written by the view factory (`dsh-api-terminal-controller/lib/types/client/index.js:73-77`; `bindings.js:1`).
- **Getting `ctx.sidebarRight`:** the sidebar-right package publishes it into every client plugin context — `ctx.reflect.provide("sidebarRight", controller)` and `provide("sidebarRightTabs", tabs)` (0.2.0 `dsh-client-ui-sidebar-right/lib/client.js:9073-9074`; 0.2.1 `:4848-4849`). No inject declaration needed; every client-ui package (and the coordinator) reads `ctx.sidebarRight` directly.
- **Tab title:** the record gets the kind's static title (`title: () => t("title")`); the chip shows the *live host name* falling back to the record — `useTerminal(tab.id, (state) => state?.info?.title ?? state?.title) ?? tab.title` (`dsh-client-ui-sidebar-terminal/lib/client.js:226`, `TerminalTitle`). So the way to name a plugin-opened tab is the host's `rename`: `tc().rename(agent, tid, title)` publishes a state frame with `info.title` (0.2.0 `dsh-api-terminal-controller/lib/index.js:451-456`; 0.2.1 `:485-490`), and the chip follows. In-tab rename (double-click) calls `view(tab.id).rename(next)` → the same host method (`client.js:265-267`).

## Open issues / not found

- No supported host-plugin write path without taking control: only the unversioned `owners`-map `handle.write` (§1). If 0.2.x ever grows an output-only attach or a `writeThrough`, this answer changes.
- 0.2.1 breaks minime's in-process `follow`/`write` pattern (`attach` needs a Remote invocation, `:886-890`); a 0.2.1 minime must either move input onto a real attach stream or adopt the handle path.
- Hand-committing `turn/start` (§4) is untested against the full stack (turn outline, resume) — the projection side is verified, the downstream effects are reasoned, not run.
- The persisted sidebar layout carries no params, so a plugin-opened tab's `terminalId` survives restart only through the terminal binding store keyed by `contentId` — a plugin should keep its own mapping if it needs to re-open by id.
