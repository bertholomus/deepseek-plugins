# DSH 0.2.x terminals — how they work, and why a plugin-made terminal has no tab

All paths are relative to the runtime packages under `.e2e/dsh-0.2.0-rc.2/node_modules/*/` (package scope omitted from every citation) unless marked 0.2.1. All facts below were read from those files (inspected, not inferred); anything not confirmed is marked "not found".

## 0. Two separate terminal systems

- `dsh-terminal` (+ `dsh-terminal-bash`): an owner-scoped PTY registry for agent *tools*. `TerminalSessionService` mints ids `pty-<n>` (`dsh-terminal/lib/index.js:91,101`); the bash/pwsh backend injects `terminals, sandboxPolicy, sessionProjections, subprocess` and runs a controlled prompt with `DSH_PTY_SESSION_ID` env (`dsh-terminal-bash/lib/index.js:904-917,936-944`). Consumed by tools (in 0.2.1: `dsh-tool-terminal` calls `ctx.terminals.spawn`, `dsh-tool-terminal/lib/index.js:304`). Not what the window shows.
- `dsh-api-terminal-controller`: the Remote service `terminalController` (namespace `terminal`) behind the window's Terminal panel (`dsh-api-terminal-controller/lib/index.js:765`, inject `["subprocess","sandboxPolicy","typert"]` at `:728-732`). Each terminal is one `BrowserTerminal` — a PTY plus an in-host terminal-emulator screen with detachable browser followers (`dsh-api-terminal-controller/lib/types/terminal.js:9,28-38`). Plugins get this service by name (`inject: [..., 'terminalController']`, as minime-bridge does).

## 1. The terminalController service

Signatures (from `dsh-api-terminal-controller/lib/typert.host.js`, 0.2.0):

| method | signature | notes |
|---|---|---|
| environment | `environment(agent, signal): TerminalEnvironment` | cwd = session header cwd or workspace root; limits (`lib/index.js:779-789`) |
| shells | `shells(agent, signal): Promise<TerminalShell[]>` | verified shells, default first (`lib/index.js:796-799,50-67`) |
| list | `list(sessionId): WebTerminalInfo[]` | no agent lookup — reads the in-memory owners map (`lib/index.js:805-809`); includes exited and failed allocations |
| create | `create(agent, request, signal): Promise<WebTerminalInfo>` | request `{id, cols, rows, shellPath?}`; id must match `/^[\w-]{1,128}$/` (`:819`); idempotent for open ids; a closed id cannot be recreated (`requireOpen`, `:981-983`); limit `maxTerminals` default 8 **including exited** (`:832-836,747`); spawns via `subprocess.spawnTerminal` with `env: { DSH_SESSION_ID: agent.id }` (`:1001-1011`) |
| retain | `retain(sessionId, id, signal): AsyncIterable<TerminalRetentionFrame>` | stream; yields `{type:'retained'}` then stays open until cancel/close (`lib/types/retention.js:36-62`); takes sessionId only — works for an inactive saved layout without activating the agent (`lib/index.js:861-872`) |
| follow | `follow(agent, id, attachmentId, signal): AsyncIterable<TerminalFrame>` | attachment = exclusive input control; an older attachment becomes read-only (`lib/index.js:881-884,489-492`) |
| write | `write(agent, id, attachmentId, data): Promise<void>` | raw UTF-8 input, max `maxInputBytes` 64 KiB (`:893-896`) |
| resize | `resize(agent, id, attachmentId, cols, rows)` | `:906-909` |
| rename | `rename(agent, id, title)` | title 1–120 chars (`:916-919`) |
| close | `close(agent, id)` | idempotent; records the id as closed (`:926-940`) |

Frame types from `follow` (`dsh-api-terminal-controller/lib/types/types.d.ts:61-77`):
- `{type:'snapshot', sequence, screen, info}` — first frame; `screen` is the serialized emulator screen (recovery baseline) (`lib/types/terminal.js:77`).
- `{type:'output', sequence, data}` — ordered raw output (`:195`).
- `{type:'state', info}` — on attach, resize, rename, exit (`state:'exited'` + `exitCode`), or failure (`:76,119,128,183-188`). `info.controllerId` names the current writable attachment.
Slow followers are dropped after a 2 MiB queue cap; a later attachment recovers from the snapshot (`lib/index.js:70-146,751`).

**What `retain` does.** It is a "window hold": one holder per physical stream (`lib/types/retention.js:40-54`). The client opens one per open tab (`TerminalWindowHold`, `lib/types/client/retention.js:9-30`) and gates output attachment on its acknowledgement. Holders are the primary thing that stops the reaper.

**Unattended reaper** (`TerminalRetention`, `lib/types/retention.js`): armed at construction (`:29`). With no holders and `unattendedTimeoutMs > 0`, it polls `handle.inspectActivity()` every `activityPollIntervalMs` (default 30 s, `lib/index.js:755`) and closes the terminal after it has been observed **idle continuously for `unattendedTimeoutMs` (default 72e5 ms = 2 hours, `lib/index.js:754`)** (`retention.js:139-145`). A failed close retries after `cleanupRetryMs` (60 s, `:76-80`).

What keeps a terminal alive:
- at least one open `retain` stream (holders > 0 short-circuits the timer, `retention.js:102`);
- any `write`/`resize` — they call `retention.invalidate()`, resetting the idle window (`lib/types/terminal.js:103,113-121`; `retention.js:64`);
- non-idle shell/process activity: `inspectActivity()` reports `busy` while the PTY has descendant processes, and reads the foreground shell's state; `quiescent` after terminate → `idle` (`dsh-subprocess-local/lib/index.js:842-884`);
- `unattendedTimeoutMs: 0` disables reaping entirely (`retention.js:102`).

**Restart.** The owners map is memory only (`lib/index.js:758`); nothing persists terminal ids, titles, or processes. On controller dispose every owner's terminals are disposed (`:766-771,959-974`), and the PTYs are children of the DSH host process anyway. After a restart `list` returns `[]`; an old id raises `terminal/unavailable`, which the client renders as "This terminal no longer exists" (`lib/types/client/model.js:327`; locale `dsh-client-ui-sidebar-terminal/lib/client.js:341`).

## 2. How the window lists and opens terminal tabs

The panel package is `dsh-client-ui-sidebar-terminal`. It registers tab kind `terminal` (`multiple: true`) in the right sidebar and injects the body/title/guide slots (`client.js:438-489`); Ctrl+Backquote opens a new one (`:388-433`).

- Tab records are **client-side layout state**: per-session persisted sidebar layout (`dsh-client-ui-sidebar-right/lib/types/client/persistence.d.ts:4-5`, namespace `dsh.sidebar-right.v1`) plus the in-window open-tab list (`client.js:364-374`).
- A tab binds to a host terminal through either the tab's saved params `terminalId` ("An existing Host terminal selected from the Session terminal list", `dsh-client-ui-sidebar-terminal/lib/types/client/face.d.ts:20-26`) or a per-window binding `dsh.terminal.binding.v1.<sessionId,contentId>` written when the window itself allocated the terminal (`dsh-api-terminal-controller/lib/types/client/bindings.js:3,58`; `client/index.js:53-70`). A new tab gets a fresh random id and calls `create` with it (`model.js:89-101,111-114`).
- The window's only use of the host list is inside `TerminalView.refresh()`: it calls `remote.list(sessionId)` and **adopts the terminal whose id equals the tab's own id**, else creates one (`model.js:79-103,121-133`). There is a second consumer, `ClientTerminals.recover()` — "terminals available for opening as recovered tabs" (`client/index.js:176-183`) — but **no component in the shipped runtime calls it** (grep over all `.js` in both builds finds no caller). The panel's guide entry offers only "New terminal" (`client.js:444-451`).

**Why a plugin-made terminal does not appear.** Not an owner/creator field — `WebTerminalInfo` has no such field (`types.d.ts:37-51`) and `list()` filters nothing (`lib/index.js:805-809`). The exact condition is: *no sidebar tab record of that session binds to the terminal's host id*. The tab list exists only where the window created it; nothing turns the host list into tabs. A terminal created as `minime-…` is real on the host (minime-bridge even sees it via `tc().list(sid)`, `~/.dsh-plugins/minime-bridge/lib/index.js:203,224`) but is invisible to the panel.

**What a plugin must do** so its terminal shows as a normal tab: a *client-side* (UI) plugin must open a sidebar-right tab of kind `terminal` with `params: { terminalId: <id> }` — the view then adopts it from `remote.list` (`createWhenMissing=false`; unknown id → 'missingTerminal', `model.js:85,103`). A host-only plugin cannot create a tab: there is no remote method for it, and the builds studied have no recovered-terminals UI. minime-bridge instead keeps its terminals alive (`holdTerminal` → open `retain` stream, `minime-bridge/lib/index.js:192-197`) and serves them over its own HTTP API.

## 3. Sessions with no chat turn

**Terminal creation needs no turn.** The gateway resolves the `agent` argument via the typert lookup "agent" → `sessionController.resolveAgent(sessionId)`, which resumes a persisted session (or fails `session/not-found`) — it never reads turns (`dsh-api-session-controller/lib/index.js:188-191,208-234,377-410`); the agent's id *is* the sessionId (`:412-460`, `agents.create({sessionId, …})`). A blank session (seq 0) resumes fine, and `create` commits no session event, so a plugin (or the window) can create a terminal for a session that has no chat turn yet. minime-bridge does exactly this: `agentOf` → `resolveAgent`, then `tc().create(agent, …)` (`minime-bridge/lib/index.js:163-167,229`).

**Sidebar hides blank sessions.** Host projection: a session is `blank` until its first committed `turn/start` event — `applySessionListMetadata`: `const blank = state.blank && event.type !== "turn/start";` (`dsh-api-session-controller/lib/index.js:1808`, init `{blank:true}` at `:1841`; live summary `blank: metadata?.blank ?? session.seq === 0` at `:1878`, cold `:1915`). The client store keeps `effectiveBlank = summary.blank && !engagedSessions.has(id)` (`dsh-api-session-controller/lib/client.js:2501-2503`). The sidebar (workspace region) applies the filter in `sessionVisible`:

```
if (session.origin === "subagent") return false;
if (session.blank && session.id !== current) return false;   // dsh-client-ui-workspace/lib/client.js:357-359
```

used by the list builder and search (`:578,593`). So a session whose only activity is a plugin-made terminal stays `blank` → hidden from the sidebar unless it is the currently selected one. Terminal activity never unblanks it (no session event is committed).

## 4. 0.2.0-rc.2 → 0.2.1-rc.1

- Protocol change: `follow`, `write`, `resize` are gone; a single bidirectional `attach(agent, id, signal): RemoteStream<TerminalFrame, TerminalInput>` replaces them (signatures in `dsh-api-terminal-controller/lib/typert.host.js`). Input commands `{type:'write'|'resize', sequence, …}` flow up the same stream; the host answers `{type:'ack', sequence, refusal?}` and pushes `writable` in state frames instead of `info.controllerId`; the `TerminalAttachmentId` type and per-call attachmentId parameter are removed (`dsh-api-terminal-controller/lib/types/types.d.ts:62-95` in 0.2.1). Input is sequence-validated and budgeted against a new `TerminalEnvironment.maxBufferedBytes` uplink window; snapshots carry an optional `inputWindow`.
- Host internals: followers have an explicit `fail()`/`active` lifecycle, `exited` precedes drainage, and `rename` is unchanged; config block is byte-identical (same defaults incl. the 2 h reaper).
- Client: views share a per-session `TerminalInventory` cache of `remote.list`, refreshed on connection reset (`dsh-api-terminal-controller/lib/types/client/inventory.d.ts`; `types/client/index.js:34-48` in 0.2.1); `recover(sessionId, refresh)` now reads that cache. Keystrokes/resizes are queued uplink commands ordered with output, no longer separate RPCs (`types/client/model.js` `send`/`flushInput`).
- The panel package `dsh-client-ui-sidebar-terminal/lib/client.js` is byte-identical between the two builds — still no terminal-list UI; `recover()` still has no caller.
- `dsh-terminal` is unchanged. `dsh-terminal-bash` now injects `workingDirectory` and defaults a session's cwd to `workingDirectory.ensure(owner)` instead of `policy.workspaceRoot` (`dsh-terminal-bash/lib/index.js:906-911,1055-1056`).
- New in 0.2.1: `dsh-tool-terminal` (agent `terminal_*` tools over `ctx.terminals`) and `dsh-experimental-terminal-bundle` (`lib/index.js` is an empty `export {}`).

## Open issues / not found

- No UI in either build turns `terminal/list` into tabs; the `recover()` path is wired in the model but unreachable from the shipped panel. If a future build adds a recovered-list guide entry, a host-created terminal could then be opened by its id.
- Deployment values for `unattendedTimeoutMs` etc. may be overridden in profiles; only package defaults were verified.
- The client `view()`/bindings design means a window can only "attach" to a plugin terminal if some client code opens the tab with that id — no such helper exists for host-side plugins ("not found").
