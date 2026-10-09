# dsh-plugin-projects

Claude-Code-style projects for DSH Desktop. Each project has one **coordinator** session. You talk to the coordinator; it starts **threads** (separate sessions) for focused work, and threads **hand back** their results to it. Each project has default models and effort levels for the coordinator and for threads.

Every coordinator and thread is an ordinary DSH session in the project's workspace, made through the Host's own `sessionController`. They show live in the DSH sidebar, and you can open any thread and talk to it directly.

## How it flows

1. You ask the coordinator for work in the `◆ <project>` session.
2. The coordinator calls `project_thread_start` with a title and a self-contained brief. A new session, `<project> › <title>`, starts with that brief as its first message.
3. The thread works. When it finishes, gets blocked, or needs a decision, it calls `project_handback`. The handback lands in the coordinator as its next turn, starting with `[Handback from thread t1 · "title" · status: done]`.
4. The coordinator tells you the result, answers the thread if it can, or asks you. Follow-ups go to the same thread with `project_thread_send`.

If a thread ends a turn without a handback, the coordinator gets a short automatic note with the thread's last reply (`autoHandback: idle`, the default). So nothing a thread does goes unnoticed.

The coordinator's system prompt is rebuilt on every request with the live thread roster, the settings and an excerpt of project memory. A thread's prompt tells it who it is and how to hand back.

## Settings

The four settings match Claude Code's project page:

| Claude Code | Here | Where |
| --- | --- | --- |
| Coordinator model | `coordinatorModel` | plugin row, project row, or `project_settings` |
| Coordinator effort | `coordinatorEffort` | same |
| Thread model | `threadModel` | same |
| Thread effort | `threadEffort` | same |
| Pause project | `paused` | project row or `project_settings` |
| Goal | `goal` | project row |

Each setting comes from the first place that sets it: a change made through the coordinator (`project_settings`), then the project row, then the plugin row, then the DSH default model. Saying "default" to the coordinator clears a change, like "Use default".

Models are `provider:model` or a bare model id. Effort is whatever the model offers (for DeepSeek: `off`, `low`, `high`, `max`). Both are checked against the Host's model catalog, and a bad value comes back with the valid choices.

A thread keeps the model and effort it started with. The coordinator can give one thread its own model or effort at start, or change it later with `project_thread_update`.

Pausing blocks new threads and holds handbacks. Resuming delivers the held handbacks in order.

Project sessions always run on the project's model and effort: the plugin sets them on every model request. A choice made in the DSH model picker for a project session is overridden. Change it through the coordinator instead.

## Setup

1. Install the plugin as in the [root README](../../README.md#install-a-plugin) (package name `dsh-plugin-projects`).
2. Add the row to your profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: projects
      name: dsh-plugin-projects
      config:
        coordinatorEffort: max
        threadEffort: high
        projects:
          - name: DSH Plugins
            goal: Designing, maintaining and improving DSH plugins
            workspacePath: ~/code/deepseek-plugins
```

With `patchReload: live`, the `◆ DSH Plugins` session appears in a few seconds. Open it and ask for work.

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
| `autoHandback` | `idle` | `idle` tells the coordinator when a thread ends a turn without a handback. `off` sends only explicit handbacks. |
| `maxHandbacksPerHour` | `30` | Handbacks one thread may send per hour. Stops a coordinator and a thread from looping. |
| `storeFile` | `~/.dsh/projects/projects.json` | Project state: sessions, threads, setting changes, held handbacks. Mode 600. |
| `memoryDir` | `~/.dsh/projects/memory` | Project memory files, one per project. |
| `maxMemoryBytes` | `65536` | Largest memory file the tools will write. |
| `logFile` | `~/.dsh/projects/projects.log` | Action log, mode 600. Empty string turns it off. |

Project row:

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | required | Display name and coordinator title. |
| `workspacePath` | required | Workspace for the coordinator and every thread. |
| `id` | name, slugified | Stable id. Changing it starts the project over. |
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

- Not yet run against a live DSH Desktop. The tests use a fake Host built from the published `@deepseek-ai/*` type definitions.
- No "auto-continue when usage limits reset".
- Discord threads cannot be project threads yet. The discord plugin keeps its own sessions.

## Tests

```bash
npm install --no-save @deepseek-ai/schemastery @deepseek-ai/dsh-tools@next
node plugins/projects/test/smoke.mjs
```
