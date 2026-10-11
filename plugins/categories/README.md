# Categories

Categories group your DSH workspaces in DSH's session list: a header for each category over its workspaces, then **Other workspaces** for the rest. The plugin works on its own; with the projects plugin on too, each decorates DSH's own rows, so a project's ◆ coordinator and threads stay in their workspace and the workspace sits in its category.

## In the window

<!-- client: the session list, menus, drags, New workspace…, the Categories page -->

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
