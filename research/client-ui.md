# DSH window-side (browser) plugin API

Read from `.e2e/dsh-0.2.0-rc.2` (line numbers) with `.e2e/dsh-0.2.1-rc.1` cross-checked (§7).
DSH package paths are relative to `node_modules/@deepseek-ai/`. Plugin files are repo-relative
(`plugins/...`). rc.2 = dsh-0.2.0-rc.2, rc.1 = dsh-0.2.1-rc.1.

## 0. How a browser half loads

A plugin ships one client script served to the window; it self-registers:

- `plugins/calendar/lib/client.js:46-48` — `window.__ModuleLoader__.load({ id: 'dsh-plugin-calendar', factory: (require) => {...} })`.
  Inside: `require('react')` and `require('react-dom')` (the window's shared view library), then
  `require('@deepseek-ai/dsh-client-ui-primitives')` (`:51-53`).
- The module returns `{ inject, apply }` (`:6153-6154`). `inject = ['slots']` declares the required services (`:6099-6100`);
  `apply(ctx)` registers everything. Never throw at top level — all halves load in one script (`:45`).

## 1. sidebar.panellist + a page in main

**The slot pair.** A page = a `main` entry (keyed) + a `sidebar.panellist` entry (list) with the *same id as the
main key*. Calendar, `plugins/calendar/lib/client.js:6127-6133`:

```js
ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: IDS.page, inject: withApi }, CalendarPage));
ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: IDS.page, order: 7, label: TEXT.entry,
}, CalendarIcon));
```

- `IDS.page = 'dsh-plugin-calendar:page'` (`:59-62`); `CalendarIcon({ size = 16 })` is the row glyph (`:1597`).
- Categories: same pair, `order: 6` (`plugins/categories/lib/client.js:2096-2103`); coordinator's threads have no
  main page. Calendar picked 7 "after the projects (5) and categories (6) plugins' pages" (`:6126`).

**Slot kinds (registry).** `dsh-client-ui-slots/lib/index.js:163-243` `register(options, component)`: a `list` slot
entry requires `options.id` (`:182`), a `keyed` slot requires `options.key` (`:176`); `priority` defaults 0, and a
same-priority duplicate id/key throws (`:171-185`). Entries sort by priority, then (list only) `order` (`:220-222`).
`label` may be a string or a thunk resolved at read time (`:27-29`). `entriesOfSlot(key)` keeps the *first live
entry per cell* (id/key) — later same-id entries are shadowed, lowest priority wins (`:278-293`).

**Declaration.** `dsh-client-ui-layout/lib/client.js:609-617`: `main` is `{ kind: 'keyed', scope: 'root' }`,
`shell.overlay` a `list`, `sidebar`/`rightbar`/`shell.leading` singles. `dsh-client-ui-sidebar/lib/client.js:499-506`:
`sidebar.panellist` is a `list` (plus `sidebar.brand.mark`, `sidebar.toggle.badge`, `sidebar.workspaces`,
`sidebar.settings`, `sidebar.footer.action`).

**How the row is drawn.** `dsh-client-ui-sidebar/lib/client.js:176-196` `PanelRow`: one `Tooltip(label, delayMs 500)`
wrapping a button with `aria-label`/`aria-current`; the glyph is
`renderSlot("sidebar.panellist", { size: wide ? 16 : 18, active }, { only: id })` (`:190-193`) — the entry component
gets **props `{ size, active }`**. Wide sidebar adds a `<span>` with the resolved label (`:193-196`). DSH's own
entries ride the same slot; selection is `selectPanel(id)` → `ctx.layout.selectPanel(id)` (`:484-487`).

**How the page is mounted.** `dsh-client-ui-layout/lib/client.js:118-120` `MainPanel`:
`renderSlot("main", {}, { entryKey: usePanelInfo((info) => info.activePanelId) ?? "conversation" })` — the `main`
slot is keyed, the active panel id selects the entry; DSH's conversation is the `"conversation"` key. Layout
retains every registered main key (`:593-595`). A page component receives the root-scope standard kit (below §2
"what props slots get") plus its `inject` — `CalendarPage({ cal })` takes only `cal` from
`withApi = () => ({ cal })` (`plugins/calendar/lib/client.js:6125`, `5113`).

**Badges on a panellist entry: none built in.** The row renders only glyph + label (above). The one badge seat in
the sidebar is `sidebar.toggle.badge` — a **single** slot on the collapse toggle, rendered only `!wide`
(`dsh-client-ui-sidebar/lib/client.js:285`, `:499-501`), used by the desktop-update badge
(`dsh-client-ui-settings-general/lib/client.js:983-990`). So a plugin wanting a count on *its* row draws it itself:
render it inside its own icon component (calendar's own badge CSS is a hand-drawn span,
`plugins/calendar/lib/client.js:473` `.dshcal-pane-badge`), or piggyback `sidebar.toggle.badge` (one entry only —
it's a single slot).

## 2. conversation.chat.turnTail

**Registration.** `plugins/coordinator/lib/client.js:5191-5193`:
`ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: IDS.cards, order: 30, inject: withApi }, ThreadCards))`.

**Where it renders.** `dsh-client-ui-chat/lib/client.js:6580-6584` (`TurnTailNodeView`):

```js
const tail = renderSlot("conversation.chat.turnTail", { turn, seq: closing?.finalNode.seq ?? data.seq, openFile });
```

The slot is a **list, session scope**, declared as a child of the `turn-tail` chat node (`key: 'turn-tail'`),
`dsh-client-ui-chat/lib/client.js:6853-6861`; DSH renders DSH's own actions (`MessageIconActions`) right after the
tail (`:6605-6640`). The data behind the node (`tailData`, `:10419-10447`): `{ turn, seq, time, closing, branchUnavailable,
tokenUsage }` where `closing` is the last assistant step that has text (`:10427-10429`).

**Props a tail entry receives** (owner props last — `dsh-client-ui-renderer/lib/client.js:748-770`):

- `turn` — the turn object from the node's location: `location.turn` has `.turn` (number), `.status`, `.start`, `.end`,
  `.steps` (each step `.data.get("assistant-step")`); see `dsh-client-ui-chat/lib/client.js:1661,1554,5142,10425-10427`.
  Coordinator reads the number as `turn?.turn` (`plugins/coordinator/lib/client.js:4176`).
- `seq` — closing node seq (number); `openFile` — callback for opening an attachment/file path.
- Session scope standard kit: **`sessionId`** (string prop), **`useSession`**, **`useProjection(key, selector)`** (keyed
  hook), plus root hooks **`useSessions`**, **`useSessionStatus`** — from
  `dsh-client-ui-session/lib/client.js:120-129` (`props: ["sessionId"]`, `hooks: ["session"]`,
  `keyedHooks: ["projection"]`) and `:469-475` (`provideRoot` hooks `sessions`/`sessionStatus`). Plus `t` if the
  entry declares `locale`, and the entry's own `inject` (coordinator: `projects`).
- **No events are passed.** A card learns the turn's content from the `turn` object: assistant text =
  `turn.steps` → each step's `assistant-step` data → its `blocks` text blocks
  (`dsh-client-ui-chat/lib/client.js:6520-6525` `assistantText`, `6532-6541` `hasAssistantReplyContent`); tool
  calls/results and retries surface as turn steps/events the turn object tracks (`:10432-10436`).

`ThreadCards` filters the plugin's stored projections to cards of this turn:
`useProjection(KEY, (v) => cardsOf(v, turn?.turn))` where `cardsOf` requires `Number.isSafeInteger(turn)` and
`card.turn === turn` (`plugins/coordinator/lib/client.js:4176`, `3827-3841`) — i.e. projections are per-session
key/value faces the host half feeds (see §5).

Related keyed slot: `conversation.chat.node` — DSH's dispatch key per node kind; coordinator shadows the
`turn-trigger` key at `priority: -1` (one lower renders: `plugins/coordinator/lib/client.js:5196-5200`;
`dsh-client-ui-chat/lib/client.js:6790-6796` registers the DSH originals).

## 3. sidebar.session.row.leading / .hover / row.action

Declared in the workspace browser, all **list, root scope** (`dsh-client-ui-workspace/lib/client.js:4315-4323`).
Row: `:1623`

```js
!row.archived && !row.blank && (showStatus
  ? jsx(SessionStatusDots, { statuses })
  : renderSlot("sidebar.session.row.leading", { sessionId: node.id }))
```

- Props: **`{ sessionId }`** only (`:1623`). **The seat is shared with DSH's own status dots**: while the session
  runs or waits, DSH's dots replace plugin marks (`showStatus` branch). Coordinator's `ThreadMark({ sessionId,
  useSessions, projects })` accepts giving way, and CSS yields to any other mark
  (`plugins/coordinator/lib/client.js:4322-4333`, `4334-4367`).
- `sidebar.session.row.hover` — `{ sessionId: node.id }` too (`dsh-client-ui-workspace/lib/client.js:1472`); renders
  inside the row's hover card above the status lines (`:1453-1480`). Coordinator `ThreadHover` (`:5214-5216`, `:4753`).
- `sidebar.workspaces.session.row.action` — list, root scope (`:4315-4318`); per-row hover action, coordinator
  `RowPlace` at `order: 900` (`plugins/coordinator/lib/client.js:5205-5207`, `4714`).
- `sidebar.workspaces.session.menu.item` — row ⋯-menu items, `order: 50` (`:5217-5219`; DSH's own `pin` at 100,
  `dsh-client-ui-workspace/lib/client.js:4327-4336`).
- `conversation.session.header.actions` — the session header's action row: list, entries `{ id, order, inject }`,
  e.g. coordinator menus at `order: -25/-24` and the categories chip at `-27` with `inject: () => ({...})`
  (`plugins/coordinator/lib/client.js:5178-5184`, `plugins/categories/lib/client.js:2104-2107`); rendered
  `dsh-client-ui-conversation/lib/client.js:16502` (decl `:18268`).
- `shell.overlay` — list, root; free-floating overlays (coordinator's news toast + session list, categories' tree:
  `plugins/coordinator/lib/client.js:5225-5231`; `plugins/categories/lib/client.js:2089-2093`); rendered in the
  frame's `data-shell-overlay` layer, `dsh-client-ui-layout/lib/client.js:312,339-346`.

## 4. Opening a session; scroll-to-turn

- **`ctx.uiWorkspace.openSession(sessionId)`** is the way a plugin opens a session in main. Coordinator:
  `const openSession = (sessionId) => { ... ctx.uiWorkspace.openSession(sessionId); }`
  (`plugins/coordinator/lib/client.js:4800-4803`). In DSH it is
  `openSession(target) { this.replaceMain(target, this.lifetime.signal, "reveal"); }`
  (`dsh-client-ui-workspace/lib/client.js:821-823`); `"reveal"` ends with `ctx.layout.selectPanel(null)`
  (`:993-994`) — i.e. back to the conversation over any page. `target` may also be a subagent reference object
  (`:980-982`).
- **Opening a plugin page**: `ctx.get('layout').selectPanel(IDS.page)` — calendar's `openPage()`
  (`plugins/calendar/lib/client.js:6078-6087`).
- **Right sidebar**: `ctx.sidebarRight.openResource(address, options)` and `openTab(kind, options)`; DSH's service
  face: `dsh-client-ui-sidebar-right/lib/client.js:6162-6169`, provided as `"sidebarRight"` (`:9074`).
  `openResourceIn(sessionId, address, { params })` targets one session's sidebar; coordinator's `openReview` opens
  `dsh-resource://changes-review/session/<sessionId>/<seq>/<turn>` with `{ params: { index: 0 } }` and retries
  `sidebar.actionsFor(sessionId)` up to 50×100 ms until DSH set the sidebar up
  (`plugins/coordinator/lib/client.js:5118-5139`, `1221-1227`, `1455`). Tab kinds register via
  `ctx.sidebarRightTabs.register({ id, kind, patterns?, canOpen?, title, guide? })`
  (`plugins/calendar/lib/client.js:6140-6146`; `plugins/coordinator/lib/client.js:5235-5266`).
- **Scroll to a turn or event: no public plugin API.** The chat viewport has `scrollToTurn(turn)` /
  `activateTurn(turn)` but only as an internal imperative handle used by DSH's own jump navigation
  (`dsh-client-ui-chat/lib/client.js:3763-3767`, callers `4108,4175,4189`); no service exposes it, and no URL
  scheme targets a chat position — navigation is service calls, not URLs (grep for `scrollToTurn|revealNode` over
  the client packages finds no plugin-facing export). A plugin that must land on a turn either ships its own tab
  (right sidebar, address-addressed, as above) or stores `seq`/turn ids in its own data and lets the user open the
  session. **Not found:** any `ctx.*` scroll/focus-turn call.
- **What props slots get, in general** — spread order kit → entry `inject` → slot-injected props → owner props
  (`dsh-client-ui-renderer/lib/client.js:752-768`); kit = standard binding (hooks become `use<Name>`,
  `dsh-client-ui-slots/lib/index.js:7-9`), `t` for `locale`, `useStore`/`actions` for `store`, `renderSlot` for
  `children` (`dsh-client-ui-renderer/lib/client.js:705-742`).

## 5. Host endpoints: bindTypertRemote, connection.rpc.call, and change discovery

**Browser → host.** Every plugin half calls over the window's own connection:

```js
const result = await connection.rpc.call('/api', `${BUNDLE}/${method}`, { args });   // plugins/calendar/lib/client.js:620
```

`BUNDLE` is the package name; result is `{ ok: true, value }` or `{ ok: false, error: { code, message } }`, never
throws (`:613-628`); `connection` arrives via `ctx.inject(['connection'], ...)` (`:6117-6122`), and a call made
before it waits up to 8 s (`:6106-6115`).

**Host side.** The host half binds its service object to the gateway:
`this.typertRemote = bindTypertRemote(this, SERVICE, { namespace: NAMESPACE })`
(`plugins/calendar/lib/remote.js:74`) with `NAMESPACE = 'dsh-plugin-calendar'`,
`SERVICE = 'dshPluginCalendarRemote'` (`:18-21`) — the path `/api/<namespace>/<method>` is the wire contract
(`:1-9`), methods marked as remote (`:300-313`). Registered as a cordis service:
`ctx.inject(['typertGateway'], (scope) => { scope.provide(SERVICE, new CalendarRemote(...)); })`
(`plugins/calendar/lib/index.js:167-170`). Same shape in coordinator (`lib/remote.js:23,47`, `lib/index.js:201`)
and categories (`lib/remote.js:16,38`, `lib/index.js:48`).

**Change discovery: polling a version, no push channel.** The host keeps a `version` that moves whenever anything
the window shows changed (`plugins/calendar/lib/remote.js:87-99`), and a cheap `version()` →
`{ version, syncing }` (`:108-114`). The window polls: `version()` every **4 s** while the page watches, **12 s**
when only the Agenda pane shows; it re-reads `state()` when the version moves, every 60 s regardless, and on tab
visibility regain (`plugins/calendar/lib/client.js:1300-1312,1345-1372`). There is no subscribe/websocket surface
for plugin halves in these packages — **not found** (grep `subscribe|websocket` in plugins/calendar,
dsh-client-connection plugin-facing faces). Categories/coordinator poll their own endpoints the same way
(`plugins/categories/lib/client.js:243`; `plugins/coordinator/lib/client.js:5671`).

## 6. UI parts from @deepseek-ai/dsh-client-ui-primitives

`d.ts` files under `dsh-client-ui-primitives/lib/types/` (rc.2). All are importable names on the `ui` object the
plugin requires.

- **Button** (`Button.d.ts:3,12-16`): `variant: 'primary'|'ghost'|'outline'|'toolbar'` (default ghost), `size:
  'md'|'sm'` (36 px / 28 px), `icon?: ReactNode` (leading), rest passes through button attributes; forwards ref.
- **Switch** (`Switch.d.ts:3-9`): fully controlled — `checked`, `onChange(next)`, `label` (accessible name),
  `disabled`, `title`.
- **Menu** (`Menu.d.ts`): data-driven `MenuEntry = MenuItem | {type:'separator',id} | {type:'label',id,text}`
  (`:31`); `MenuItem { id, label, disabled?, shortcut?, icon?, danger?, submenu? }` (`:3-18`); component rows
  (`MenuItemButtonProps`, `:33-56`) support `separatorBefore` (`:50`). Menus render portalled on glass
  (`plugins/calendar/lib/client.js:443`).
- **Modal** (`Modal.d.ts:24-33`): `open`, `onClose`, `title`, `description?`, `children`, `footer?`,
  `contentClassName?`, `backdropBlur?` (default true), plus `{headless:true}` or `{closeLabel}`; initial focus via
  `data-modal-autofocus`. Calendar styles its dialogs through this (`.dshcal-dlg`,
  `plugins/calendar/lib/client.js:373`).
- **Toast** (`Toast.d.ts:18-33`): `text`, `icon?`, `tone?: 'success'`, `holdMs?` (default 3000), `actions?:
  [{label, prefix?, onClick}]`, `onDone` (unmount there). Body-portaled; coordinator's news notice uses it
  (`plugins/coordinator/lib/client.js:4311-4319`).
- **Tooltip** (`Tooltip.d.ts`): wraps its child anchor; `label` (string or thunk), `shortcutKeys?`, `side?:
  'right'|'bottom'|'top'` (default right), `align: 'end'` used in plugins.
- **StateDot** (`StateDot.d.ts:5,14-19`): `state: 'done'|'warning'|'ongoing'|'error'|'idle'`, `size?`,
  `appearance?: 'dot'|'step'`; aria-hidden — pair with text.
- **SettingsForm** (`settings-form/SettingsForm.d.ts:28-37`): a plugin settings page frame — `labels`
  (`{unavailable, readOnly, saveFailed, save, saving}`, `:15-26`), `state: SettingsFormShell`, `onSave`, `onDiscard`,
  `children`; staged-edit model in `settings-form/form-model.d.ts` (`SettingsFormScopeSnapshot` `:17-29`). The
  Plugins page draws title/description itself; coordinator drives it via `ctx.configForms.whileServed([ENTRY], ...)`
  (`plugins/coordinator/lib/client.js:1209`).
- **ConfigField** (`ConfigField.d.ts`) — labeled field wrapper used by settings forms; **Input**, **Checkbox**,
  **SegmentedControl**/`SegmentedTabs`, **Pill**, **Tag**, **HoverCard**, **DiffBlock**, **JsonTree**,
  **DisclosureRow**, **ShortcutKeys**, **ConnectionIndicator**, **TerminalBlock**, **ImageLightbox** — all present
  as `lib/types/*.d.ts` in this package.
- **Icons**: `ui.Icon<Name>OutlineRegular` / `Icon<Name>FillRegular` (e.g. `IconPlayOutlineRegular`,
  `IconPauseOutlineRegular`, `IconBranchOutlineRegular`) — plain components with `size` prop; guard with
  `ui[name] ? h(ui[name], {size}) : null` (`plugins/calendar/lib/client.js:581`).

DSH's CSS custom properties are fair game from plugin CSS: `--dsw-alias-*`, `--dsw-focus-ring-color`,
`--dsh-frame-top-clearance`, `--dsh-font-mono` (plugins/calendar/lib/client.js:434,108;
plugins/categories/lib/client.js:36-39).

## 7. 0.2.1-rc.1 differences (spot-checked)

- Slot contracts unchanged: `renderSlot("conversation.chat.turnTail", { turn, seq, openFile })` at
  `dsh-client-ui-chat/lib/client.js:6977-6980` (rc.1) vs `:6580-6583` (rc.2); declaration same (`:7271`).
- `renderSlot("sidebar.session.row.leading", { sessionId: node.id })` and the panellist call
  (`{ size: wide ? 16 : 18, active }`, `{ only: id }`) are byte-identical between rc.1 and rc.2
  (`dsh-client-ui-workspace/lib/client.js`, `dsh-client-ui-sidebar/lib/client.js` — diffed).
- `dsh-client-ui-chat/lib/client.js` differs wholesale between the two builds (~11.4k changed lines — rebuilt
  bundle), so quote rc.1 line numbers separately if citing it; the contracts above hold in both.
