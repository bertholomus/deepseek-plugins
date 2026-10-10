# All-in-one mod ("Fleet Shell") — inventory of its old Projects feature

Source: `/Users/albertlee/Projects/Deepseek Harness Redesign Plugin`, live branch `minime/finish-plugin` at **55c3bc6**
(read with `git show HEAD:…`; the working copy was not touched). Package: `dsh-plugin-fleet-shell` 0.1.0, loaded by
the live DSH through `~/.dsh-plugins/fleet-shell -> …/plugin`.

## 1. What it is, in one line

In this mod, "projects" are **just a grouping layer over DSH workspaces, shown in the left sidebar**. A project is a
name plus a list of workspaces, and it holds unused per-project instructions/files/defaults. It has no sessions,
agents, threads, models or tools of its own. Nothing runs on the host for projects except saving JSON.

## 2. Surfaces (everything it shows)

| # | Surface | Where it hooks in | What it does |
|---|---|---|---|
| S1 | **Projects tree** (replaces DSH's workspace list) | `shell.overlay` slot renders `ProjectsPortal`, which **portals into** `[data-slot="sidebar"] [class*="_regionArea"]` (DOM-polled every 1 s) and hides DSH's own list with `body.fs-shell.fs-projects [data-slot="sidebar.workspaces"]{display:none!important}` | Projects → Workspaces → Sessions tree. Header "Projects" (or "Workspaces" / "All sessions" by Group by), counts per project, "Ungrouped" pseudo-project (`_none`) for unassigned workspaces and a "No workspace" bucket for loose sessions |
| S2 | **Search box** above the tree ("Search sessions, workspaces and projects") | inside S1 | Filters sessions by title, workspace title and project name; results keep their project groups |
| S3 | **"+" menu** next to the header ("New project or workspace") | inside S1 | New project (inline name field) or Add workspace… (DSH folder picker via `uiWorkspace.pickDirectory` + `workspaces.create`) |
| S4 | **View options** menu | inside S1 | Group by: Projects (default) / Workspaces / In one list (`prefs.treeGroup`); Order by: Last updated / Manual / Name (`prefs.treeOrder`); Hide archived / Show archived / Archived only (`prefs.treeArchived`); "Use DSH's own list for now" (session-only flag `dshListS`) |
| S5 | **Row "…" menus** (also right-click, Shift+F10) | inside S1, themed `OrgMenu` | Project: Rename, Move up/down, Delete project (confirm dialog; workspaces go to Ungrouped). Workspace: New session, Rename, Move up/down, **Move to project…** (submenu), Delete workspace. Session: Pin/Unpin, Rename, Fork, Archive/Unarchive (+Undo toast; "Stop and archive this session?" dialog lists running work) |
| S6 | **Drag to arrange** | inside S1 | Projects among projects; workspaces among workspaces or onto a project row (moves it); sessions within their workspace (switches order to Manual). Auto-scroll near edges |
| S7 | **"Back to Projects"** button | portal into the same sidebar area while DSH's list is shown | Returns from DSH's list; the Projects view also returns on the next start |
| S8 | **Project chip** in the session header | `conversation.session.header.actions`, id `fs-project-chip`, order -10 → `ProjectChip` | Pill "‹project› / ‹workspace›". Opens the **project panel**: name + workspace count, **Instructions** textarea, **"New sessions start with"** selects (Lane, Effort Default/Low/Medium/High, Mode Standard/PTC/Minimal, Permission Read Only/Workspace Write/Full access/Auto review), **Files** (one path per line), and **Insert into message** |
| S9 | **Insert into message** | `insertIntoComposer` writes into `[data-slot="conversation.composer.bar"] [contenteditable]` with `document.execCommand("insertText")` | Pastes "Project instructions (name): …" and `@file` lines into the composer. The defaults (S8) are **stored but never applied** to new sessions — no code reads `defaults` except the panel itself |
| S10 | First-run **starter projects** | `useEffect` in `ProjectsTree` | If `state.projects` is empty, groups every workspace by regex `RULES` into Lane research / Recipe formulation / DSH plugins / Security / Fleet services / Other |

There is **no settings page** for projects. The only switches are `prefs.projectsSidebar` (default true; no visible
toggle — a one-time migration `projectsBack20261008` forces it back on) and the View options above.

## 3. Files that implement it

- `plugin/lib/client.js` (1,948 lines; all UI)
  - L27 `DEFAULT_PREFS` (includes `projectsSidebar`), L48 `stateS` store `{ …, projects: [], projectOf: {} }`, L65 `saveState(patch)` → `POST state`
  - L874–1340 "projects sidebar": `useExternal`, `RULES` (L880), `orgOf` (DSH organization actions), `OrgMenu`, `OrgDialog`, `ProjectsTree` (L983), `BackToProjects` (L1312), `ProjectsPortal` (L1322)
  - L1342–1388 `ProjectChip`, `projectPreamble`, `insertIntoComposer`
  - L1553 cleanup removes `fs-projects` body class; L1634/L1643 CSS for the takeover; many `.fs-tr*`, `.fs-kids*`, `.fs-orgmenu`, `.fs-defaults` rules
  - L1933 `shell.overlay` registers `ProjectsPortal` (together with LoadSheet, ShellPanel, GuardNotice, Toast, OrgDialog); L1937 registers `ProjectChip`
- `plugin/lib/impl.js` (host)
  - L42 `dataDir: '~/.dsh/fleet-shell'`; L78 `statePath = <dataDir>/state.json`; L81–90 `defaultState()`; L98 `saveState()`
  - L101–106 migration `projectsBack20261008`
  - L886–892 `GET /state`, `POST /state` (accepts `favorites, pins, layout, projects, projectOf` + `prefs`)
- `plugin/lib/fixrunner.js` L468–476 (**dependency**, see §5)
- `plugin/lib/fixrunner.test.mjs` L82 (fixture with `projects`/`projectOf`)
- `README.md` L19–35 (Sidebar and Session header sections), L145 (`--purge` deletes projects)
- `scripts/uninstall.sh` (purge path)

## 4. Data, settings and storage it owns

**One file:** `~/.dsh/fleet-shell/state.json` (shared with wallpaper prefs, favorites, pins, layout, lane checks,
migrations). Projects use two top-level keys plus four prefs. No localStorage, no profile rows, no other files.

Shapes (from `impl.js` / `client.js`):

```js
// impl.js L81-90
const defaultState = () => ({
  prefs: { /* wallpaper… */ projectsSidebar: true, hideNativeSettings: true },
  favorites: [], pins: {}, layout: '4+2+2', laneChecks: {},
  projects: [], projectOf: {},
});
// client.js L1056 (new project)
{ id: "p" + Date.now(), name: name.trim(), instructions: "", files: [], defaults: {} }
// defaults (only ever set through the panel, never read elsewhere)
defaults: { lane?: "<fleet lane name>", effort?: "Low|Medium|High|Default",
            mode?: "Standard mode|PTC mode|Minimal mode",
            permission?: "Read Only|Workspace Write|Full access|Auto review" }
// projectOf: { [DSH workspaceId]: projectId }   (missing / "_none" = Ungrouped)
// prefs: treeGroup "projects"|"workspaces"|"list", treeOrder "updated"|"manual"|"name",
//        treeArchived "hide"|"show"|"only", projectsSidebar boolean
```

**Live sample** (this Mac, `~/.dsh/fleet-shell/state.json`, read-only, 2026-10-09):

```json
"projects": [
  { "id": "p4", "name": "Local Model Recipe", "instructions": "", "files": [], "defaults": {} },
  { "id": "p3", "name": "Fleet Services", "instructions": "", "files": [], "defaults": {} },
  { "id": "p1791410106463", "name": "Experimentation", "instructions": "", "files": [], "defaults": {} },
  { "id": "p1791590375962", "name": "Project Testing", "instructions": "", "files": [], "defaults": {} },
  { "id": "p1", "name": "Security", "instructions": "", "files": [], "defaults": {} }
],
"projectOf": { "54903e4c-…": "p4", "3ab506d6-…": "p3", "2e234e16-…": "p1791410106463", "a5245c09-…": "p1791590375962", "1af44a5a-…": "p1", … 13 workspaces in all },
"prefs": { "projectsSidebar": true, "treeOrder": "updated", "treeArchived": "hide", … }
```

Migration notes:
- All five live projects have **empty** `instructions`, `files` and `defaults`, so nothing beyond names, order and
  workspace membership needs carrying over today.
- Order is the array order of `projects`. Membership is `projectOf` keyed by DSH workspace id (13 entries).
- Workspace order and per-workspace session order are **DSH's own** (`insertBefore` / `insertSessionBefore`), not in
  this file — nothing to migrate for those.
- Pins and archive state are DSH's own too.

## 5. What else in the mod depends on it

1. **Fix runner** (`fixrunner.js` L468–476): when it creates the `~/.dsh/fleet-shell/fleet-ops` workspace for a
   Fleet fix session, it files that workspace under the project named `/^fleet services$/i` by writing
   `state.projectOf` and saving. If projects leave the mod, this must call the new plugin (or drop the filing).
   `fixrunner.test.mjs` L82 has a fixture for it.
2. **Search** (S2) uses project names in its match string; with projects gone it only matches session/workspace.
3. **The sidebar takeover itself**: DSH's workspace list is hidden while the Projects tree is on. The tree also carries
   the mod's whole organization layer (S5/S6: themed menus, drag, View options, archive dialog). Those features
   are not project-specific; removing the tree means either keeping a project-less tree in the mod or giving that
   job back to DSH's own list (which already has pin/rename/archive/reorder).
4. **Header chip** (S8) sits at order -10 in `conversation.session.header.actions`, next to the new plugin's Threads
   menu (order -25). Two project UIs would show side by side in the same header until one goes.
5. **Uninstall/purge** and **README** text mention projects.
6. Nothing in Fleet/Models/Tank pages, telemetry, wallpaper or the gateway guard reads projects.

## 6. Ideas worth keeping (for the fold)

Worth carrying into the projects plugin (its design wins):
- **Workspace grouping in the sidebar**: a project holding several workspaces, an "Ungrouped" bucket, counts, drag a
  workspace onto a project, and "Move to project…" in the workspace menu. The new plugin today is one workspace per
  project; letting a project own several workspaces (with the coordinator in one of them) maps the old data 1:1.
- **Project instructions + files**, but applied properly: feed them to the coordinator's and threads' system prompt
  (the new plugin already rebuilds prompts per request) instead of pasting into the composer.
- **New-session defaults** (model/effort, plus permission and mode) — the new plugin's Default models page already
  covers model/effort; permission preset and mode are the two missing ones.
- **Header chip** showing "project / workspace" on every session in a project's workspaces, not only the coordinator
  and threads — cheap and useful context.
- **Search that matches the project name**.
- **First-run grouping by rules** (optional): a one-time import that turns the old `projects`/`projectOf` into the new
  plugin's projects.

Not worth keeping:
- The **DOM takeover** (portal into a hashed `_regionArea` class, a 1 s polling loop, and hiding DSH's own list with
  `!important`). It broke once already (bug 27). The new plugin uses DSH's own slots (`sidebar.session.row.*`,
  header actions, right-sidebar tabs) — keep it that way.
- **Defaults that are stored but never applied**.
- **Insert into message** via `document.execCommand`.

## 7. Screenshots

New screenshots were **skipped**: loading Fleet Shell into DSH Test would start its SSH polling of the eight Ascents
and FrankenNAS (`pollSeconds`, `nodeSeconds`, `lockSeconds`, inventory and tank scans; `impl.js` L144–300) and the
Harmony fetch, and the plugin has no switch that turns polling off. The live DSH was not touched for this.
Included instead: `live-sidebar-2026-10-09.png`, a read-only capture of the live window's sidebar taken 2026-10-09
5:31 PM PDT during the earlier projects test (Projects tree with Local Model Recipe, Fleet Services, Experimentation,
Project Testing, Security, Ungrouped).
