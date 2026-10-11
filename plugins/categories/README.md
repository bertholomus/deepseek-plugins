# Categories

Categories group your DSH workspaces in DSH's session list: a header for each category over its workspaces, then **Other workspaces** for the rest. The plugin works on its own; with the projects plugin on too, each decorates DSH's own rows, so a project's ◆ coordinator and threads stay in their workspace and the workspace sits in its category.

## In the window

- **Session list.** DSH's list is grouped by category: a header for each category (its name and how many workspaces it holds) over its workspaces, then **Other workspaces** for the rest. With no categories yet, Other workspaces heads the whole list, so its **⋯** can make the first. Click a header, or press Enter or Space on it, to fold it; → opens it, ← folds it, and ↑ and ↓ go to the next header. A folded category shows a dot when one of its chats waits on you or runs. A header's **⋯** (or a right-click, Shift+F10 or the context-menu key on the header) opens its menu. A category's menu adds a workspace to it (those in no category first, then those in other categories, with where each is now), makes a new workspace in it, moves it up or down, renames or deletes it, or makes a new category; Alt+↑ and Alt+↓ move it too. Other workspaces' menu makes a new workspace or a new category. **New workspace…** runs DSH's own Add workspace (the folder dialog of its button over the list) and files the workspace DSH makes in that category, or in none from Other workspaces; a folder DSH already has adds no workspace, so nothing is filed. Drag a header to move its category, or a workspace's row onto a header or another workspace's row to file it there; DSH's own drop line shows where it goes. Delete asks first, and the category's workspaces go to Other workspaces. A change the plugin refuses says why: in DSH's toast over the list, or under the field of the dialog that asked for it. A screen reader hears each workspace's category (*in Shop*) and what each change did.

  DSH has no seat for a header in its list, so the headers are the plugin's own elements, and CSS sets each workspace's section under its category, one step in by DSH's own workspace indent (`sidebarRules` in `lib/client.js`). DSH's rows, their order within a workspace, its view options and its search stay its own; **In one list** and search results show no headers, and a folder's nested workspaces in Workspace Tree keep DSH's own drag.
- **Categories page.** **Categories** in DSH's sidebar, next to Plugins and Automation tasks, opens a page with the whole tree: each category with its workspaces in DSH's order, each workspace with its sessions in DSH's order, and last **Other workspaces**, the ones in no category. Every session DSH lists is there, except archived ones and an empty **New Session**, each by its DSH title and with DSH's own dot when it runs or waits on you (named for screen readers). Each row says what it is: a category reads *Category · 3 workspaces*, and a workspace shows its folder, so a category and a workspace can share a name and still look apart. **Find by name**, above the tree, keeps every category, workspace or session whose name holds what you type (in any case), each where it lives and with what's in it, the words in bold; ↓ goes into the tree, Escape or its **×** clears it, and what you close while finding is forgotten when the find changes. The heading counts the categories, and **New category** makes one, last in the list; you file workspaces into it in the session list. A note names the categories the one-time import made from the old sidebar, and says their old instructions, files and defaults for new sessions weren't carried over, until you dismiss it. The tree is one tab stop: ↑ and ↓ go through it as drawn, → opens a row or goes into it, ← closes it or goes to its parent, Home and End go to the ends, and Enter or a click opens a session, or opens and closes a category or a workspace; a row's chevron opens and closes it.
- **What the window keeps.** The folded categories, the rows closed on the page and a dismissed note are kept in the window's own storage, under `dsh-plugin-categories/`, so they hold across restarts. They start fresh: what the projects plugin kept for its own categories isn't read.

Every control the plugin draws shows DSH's focus ring when you reach it with the keyboard. The browser half reads only DSH's own lists (workspaces, sessions and their status) and this plugin's endpoints; it reads no other plugin's data or marks.

## How it works

The plugin keeps its own store, `~/.dsh/categories/categories.json` (in `$DSH_HOME` when DSH runs with one): each category's name and place in the list, and which category each workspace is in. A workspace is in one category at most. The store and the log beside it are mode 600, in a folder of mode 700. The log holds ids and counts.

DSH keeps one workspace order for every window, and its session list draws it. The plugin keeps that order in step with the categories, through the same call DSH's own workspace drag makes: each category's workspaces together, the categories in their order, then the workspaces in none. It moves as few workspaces as it can. A workspace DSH adds later (DSH puts a new one first) goes back among the ones in none the next time the window lists the categories.

Deleting a category deletes nothing in DSH: its workspaces and their chats go to Other workspaces.

### Once, at the first start

Two moves run once, when the plugin starts in a DSH for the first time (before its store exists):

1. **Categories from the projects plugin.** Before this plugin, the projects plugin kept the categories, in its store (`~/.dsh/projects/projects.json`). Whatever categories that store holds come over unchanged: the same ids, names, order and workspaces. None is renamed or left out. The projects store is only read; it is copied first to `~/.dsh/categories/from-projects.json` (a later move never overwrites that copy). A projects store from before categories, where projects were also groups of workspaces, gives its groups as categories instead, except a project that has a coordinator and holds only its own workspace: that one stays a project, not a category.
2. **Your old sidebar.** The all-in-one mod's old sidebar kept projects of workspaces in `~/.dsh/fleet-shell/state.json`. Each one becomes a category here, in the same order, holding the same workspaces. Only names and which workspaces each held come over: the old instructions, files and defaults stay behind. A name that is already a category here joins it; a workspace already in a category, or one DSH no longer has, stays where it is. The old file is only read. When the projects plugin had already imported it, that import is remembered and this one doesn't run.

A store that can't be read (other than missing) is logged, and its move is tried again at the next start.

To see what both will do before the first start, without changing anything:

```bash
node plugins/categories/scripts/import-preview.mjs
```

It reads `$DSH_HOME` (else `~/.dsh`); once the moves have run, it says when.

The projects plugin keeps its old categories in its own store as they were, so an older version of it still finds them. Neither plugin reads or writes the other's data after this one move.

## Setup

1. Install the plugin as in the [root README](../../README.md#install-a-plugin):

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/categories
   ```

   That adds `dsh-plugin-categories` to the profile's `package.json` (`dependencies` and `dsh.profile.bundles`). The plugin's bundle adds its row (`id: categories`); it needs no config.

2. Restart DSH Desktop once so it loads the new bundle. The categories you had come over at that start (see above), and the session list shows them.

### Config

Optional, in the profile's `cordis.patch.yml`, addressing the plugin's row by id:

```yaml
- id: categories
  config:
    storeFile: ~/.dsh/categories/categories.json
    logFile: ~/.dsh/categories/categories.log
    projectsStoreFile: ~/.dsh/projects/projects.json
```

| Key | Default | What it is |
| --- | --- | --- |
| `enabled` | `true` | Off: no headers, no endpoints; DSH's list as it is. |
| `storeFile` | `~/.dsh/categories/categories.json` | The categories and their workspaces. |
| `logFile` | `~/.dsh/categories/categories.log` | Action log (ids and counts). Empty turns it off. |
| `projectsStoreFile` | `~/.dsh/projects/projects.json` | The projects plugin's store, read once at the first start. Empty skips that move. |

A path under `~/.dsh` follows `$DSH_HOME`.

## Tests

```bash
node plugins/categories/test/smoke.mjs
```

The smoke tests run the host half against a fake Host: categories and their workspaces in DSH's order, the refusals, the one-time move from the projects store (categories as they are, groups from before them without a project that has a coordinator in its own workspace, nothing to move, a store that can't be read yet), the old sidebar's import and the preview script, and the browser half's parts.

The end-to-end test boots a real DSH (the web profile, in a temporary `DSH_HOME`) with this plugin and session-bridge. A first start makes DSH's workspaces; then a projects store with categories and an old sidebar file are put where the user's are, and the next start moves the categories over once and imports the old sidebar once (the projects store and the old file untouched, a copy kept, the files private). It checks DSH's own workspace order, that DSH serves the browser half and it parses, the endpoints as the window calls them (make, file before another, move, rename, delete, the refusals) and a restart that changes nothing. With `PROJECTS=1` the projects plugin runs beside it: each answers only for its own, and the projects store keeps its categories as they were.

```bash
npm install --prefix /tmp/dsh @deepseek-ai/dsh
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/categories/test/e2e/run.mjs
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js PROJECTS=1 node plugins/categories/test/e2e/run.mjs
```
