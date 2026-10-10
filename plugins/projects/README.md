# dsh-plugin-projects

Claude-Code-style projects for DSH Desktop. Each project has one **coordinator** session. You talk to the coordinator; it starts **threads** (separate sessions) for focused work, and threads **hand back** their results to it. Each project has default models and effort levels for the coordinator and for threads.

Every coordinator and thread is an ordinary DSH session in the project's workspace, made through the Host's own `sessionController`. They show live in the DSH sidebar, and you can open any thread and talk to it directly.

## How it flows

1. You ask the coordinator for work in the `◆ <project>` session.
2. The coordinator calls `project_thread_start` with a title and a self-contained brief. A new session, `<project> › <title>`, starts with that brief as its first message.
3. The thread works. When it finishes, gets blocked, or needs a decision, it calls `project_handback`. The handback lands in the coordinator as its next turn, starting with `[Handback from thread t1 · "title" · status: done]`.
4. The coordinator tells you the result, answers the thread if it can, or asks you. Follow-ups go to the same thread with `project_thread_send`.

If a thread ends a turn the coordinator started without a handback, the coordinator gets a short automatic note with the thread's last reply (`autoHandback: idle`, the default). The note says so when the turn failed (for example a model error), was stopped (unless the coordinator stopped it itself), or was cut off because DSH quit or crashed; that one arrives when DSH starts again. If such a thread waits on a permission prompt for a minute, the coordinator is told which thread and what it wants to do, so it can tell you. So nothing a thread does goes unnoticed. When you talk to a thread directly, the coordinator is not woken for it; its thread list just notes that you did.

Handbacks and notes reach the coordinator in order. If it cannot take one (for example while it is open in another DSH process), the plugin keeps it and tries again, waiting longer each time, up to 15 minutes.

The coordinator's system prompt is rebuilt on every request with the live thread roster, the settings and project memory (all of it when short, otherwise its start and its newest lines). A thread's prompt tells it who it is and how to hand back.

## Settings

The four settings match Claude Code's project page:

| Claude Code | Here | Where |
| --- | --- | --- |
| Coordinator model | `coordinatorModel` | the plugin's page in DSH, plugin row, project row, or `project_settings` |
| Coordinator effort | `coordinatorEffort` | same |
| Thread model | `threadModel` | same |
| Thread effort | `threadEffort` | same |
| Pause project | `paused` | project row or `project_settings` |
| Goal | `goal` | project row |

### Default models page

In DSH, open **Plugins → dsh-plugin-projects**. Under **Default models**, pick the model and effort for coordinators and for new threads. The model list is DSH's own, grouped by provider, and the effort choices are the ones the chosen model offers. **DSH default** follows your DSH default model.

**Save** applies at once, in every project, without restarting DSH or interrupting a session: each coordinator switches from its next request, and new threads start with the new defaults. A thread that already exists keeps the model and effort it started with. The page writes the plugin row of your profile's `cordis.patch.yml`, so editing that row by hand does the same.

### Which setting wins

Each setting comes from the first place that sets it: a change made through the coordinator (`project_settings`), then the project row, then the plugin row (the page), then the DSH default model. Saying "default" to the coordinator clears a change, like "Use default".

The newest change wins. Asking a coordinator to change a setting changes it for that project. Saving a new value for that setting on the page later replaces the coordinator's change in every project, and the plugin logs it (`defaults <project> … replaced …`). A setting in a project row stays: that project keeps it until you edit the row.

Models are `provider:model` or a bare model id. Effort is whatever the model offers (for DeepSeek: `off`, `low`, `high`, `max`). Both are checked against the Host's model catalog, and a bad value comes back with the valid choices. A model with no effort levels runs without one, and the coordinator is told the effort was not used.

A thread keeps the model and effort it started with. The coordinator can give one thread its own model or effort at start, or change it later with `project_thread_update`.

Pausing blocks new threads and holds handbacks. Resuming delivers the held handbacks in order.

The plugin sets a project session's model and effort the same way the DSH model picker does, but only on that one session. It never changes your DSH default model. The DSH window shows each session's model and effort. You can still pick another model for one session in the DSH picker, and your pick holds until the coordinator changes that session's settings. A pick in the picker also becomes your DSH default model, as it does for any session.

## Setup

1. Install the plugin as in the [root README](../../README.md#install-a-plugin):

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/projects
   ```

2. Configure it in your profile's `cordis.patch.yml`. The plugin's bundle already adds its row (`id: projects`), so address that row by id:

   ```yaml
   - id: projects
     config:
       coordinatorEffort: max
       threadEffort: high
       projects:
         - name: DSH Plugins
           goal: Designing, maintaining and improving DSH plugins
           workspacePath: ~/code/deepseek-plugins
   ```

   Give `workspacePath` a working copy, not the folder DSH loads a plugin from. The coordinator and its threads work in that folder, so a pull, an edit or a branch switch there is what DSH loads at its next restart.

3. Restart DSH Desktop once so it loads the new bundle. After that, DSH picks up edits to `cordis.patch.yml` while it runs. Running sessions keep running.

The `◆ DSH Plugins` session appears in the sidebar with a short introduction from the coordinator. Open it and ask for work. (DSH lists a session only after its first turn, so the introduction is what puts a new coordinator there; see `welcome` below.)

An older setup that adds the row with `insert:` still runs (the configured row is the one that runs), but the row is then in the profile twice and DSH can't save the Default models page. The page says so and shows the values read-only. To fix it, change that row to the address row in step 2: `- id: projects` with the same `config:`, without `insert:` and `name:`.

## Config

Plugin row:

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Turn the plugin off without removing the row. |
| `projects` | `[]` | Project rows, below. |
| `coordinatorModel` | | Default coordinator model for every project. Empty uses the DSH default. |
| `coordinatorEffort` | | Default coordinator effort. Empty uses the model's default. |
| `threadModel` | | Default model for new threads. |
| `threadEffort` | | Default effort for new threads. |
| `autoHandback` | `idle` | `idle` tells the coordinator when a thread ends a turn the coordinator started without a handback. `off` sends only explicit handbacks. |
| `maxHandbacksPerHour` | `30` | Handbacks one thread may send per hour, automatic notes included. Stops a coordinator and a thread from looping. |
| `maxThreadsPerHour` | `20` | New threads one project may start per hour. Stops a coordinator that keeps starting threads, for example to retry a failing one; it gets an error to report to you instead. |
| `approvalNoticeSeconds` | `60` | How long a thread the coordinator started may wait on a permission prompt before the coordinator is told. `0` turns it off. |
| `welcome` | `true` | A new coordinator introduces itself in a first turn (one short model call). DSH hides sessions that never had a turn, so with `false` the coordinator stays out of the sidebar until someone messages it. A coordinator from an older version that never had a turn gets the introduction at the next start. |
| `storeFile` | `~/.dsh/projects/projects.json` | Project state: sessions, threads, setting changes, held handbacks. Mode 600. |
| `memoryDir` | `~/.dsh/projects/memory` | Project memory files, one per project. |
| `maxMemoryBytes` | `65536` | Largest memory file the tools will write. |
| `logFile` | `~/.dsh/projects/projects.log` | Action log, mode 600. Empty string turns it off. |

Project row:

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | required | Display name and coordinator title. |
| `workspacePath` | required | Workspace for the coordinator and every thread. |
| `id` | name, slugified | Stable id. Letters in any script are kept. Changing it starts the project over. |
| `goal` | `''` | The outcome the coordinator works toward. |
| `agentPreset` | | Agent preset for new project sessions. |
| `coordinatorModel`, `coordinatorEffort`, `threadModel`, `threadEffort` | | Override the plugin defaults for this project. |
| `paused` | `false` | Start paused. |
| `memoryFile` | `<memoryDir>/<id>.md` | Use a different memory file. |

## Tools

Only project sessions get these. Other DSH sessions never see them.

Coordinator:

| Tool | What it does |
| --- | --- |
| `project_thread_start` | Start a thread with a title and brief, optionally with its own model or effort. |
| `project_thread_send` | Message a thread. Queued by default; `steer` delivers into the running turn. Reopens a resolved thread. |
| `project_thread_list` | Threads with live status and last handback. |
| `project_thread_read` | The latest messages of a thread. |
| `project_thread_update` | Rename, change model or effort, resolve or reopen, or stop the current turn. |
| `project_settings` | Show or change the four settings and pause. |
| `project_memory` | Read, append to or replace project memory. |

Thread:

| Tool | What it does |
| --- | --- |
| `project_handback` | Report to the coordinator with a status (`done`, `blocked`, `needs_decision`, `progress`) and a summary. |
| `project_memory` | Same shared memory as the coordinator. |

## Restart, archive, remove

- **Start a fresh coordinator:** delete the coordinator session in DSH and reload the profile. The plugin makes a new one. Threads and memory carry over.
- **Archive a project:** remove its row. Its sessions stay in DSH as plain sessions without project tools. Put the row back with the same `id` to pick up where it left off.
- **Remove the plugin:** see the [root README](../../README.md#remove-a-plugin). Delete `~/.dsh/projects/` to drop all project state and memory.

## Security

- Threads run with the same tools and permissions as any DSH session in that workspace. A project adds no new access. It only lets one session start and message others in the same workspace.
- Project tools are registered per session, so a session outside a project cannot start threads or send handbacks.
- The store, memory files and log are mode 600 in a mode 700 folder. The log records actions, ids and sizes, never prompt or memory text.

## Not yet

- No "auto-continue when usage limits reset".
- Discord threads cannot be project threads yet. The discord plugin keeps its own sessions.

## Tests

```bash
npm install --no-save @deepseek-ai/schemastery @deepseek-ai/dsh-tools@next
node plugins/projects/test/smoke.mjs
```

The smoke tests run against a fake Host built from the published `@deepseek-ai/*` packages, including a Host with DSH's per-session model selection.

The end-to-end test boots a real DSH (the web profile, in a temporary `DSH_HOME`) with this plugin, session-bridge and a scripted model server. It drives the coordinator and threads through the bridge and checks what reaches the model: the model and effort of every request, which tools each session has, handbacks, the automatic notes (idle, failed, stopped, waiting on approval, cut off by a crash), queued turns, direct talk, settings, memory, pause, a stop by the coordinator, a restart after DSH is killed mid-turn, that DSH serves the page's browser code, new defaults saved while DSH runs, and that a new coordinator introduces itself so DSH lists it. It takes about two minutes.

```bash
npm install --prefix /tmp/dsh @deepseek-ai/dsh
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/projects/test/e2e/run.mjs
```

It passes on DSH 0.2.0-rc.2 and 0.2.1-alpha.2, as root and as a normal user.
