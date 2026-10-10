# dsh-plugin-projects

Claude-Code-style projects for DSH Desktop. Each project has one **coordinator** session. You talk to the coordinator; it starts **threads** (separate sessions) for focused work, and threads **hand back** their results to it. Each project has default models and effort levels for the coordinator and for threads.

Every coordinator and thread is an ordinary DSH session in the project's workspace, made through the Host's own `sessionController`. They show live in the DSH sidebar, and you can open any thread and talk to it directly.

## How it flows

1. You ask the coordinator for work in the `◆ <project>` session.
2. The coordinator calls `project_thread_start` with a title and a self-contained brief. A new session titled with the thread's title starts with that brief as its first message. A title longer than DSH's 80-byte limit for session titles is cut once, after its last whole word, with "…", and that one title is used everywhere. DSH's session list shows the thread under the `◆ <project>` coordinator while the two are next to each other.
3. The thread works. When it finishes, gets blocked, or needs a decision, it calls `project_handback`. The handback lands in the coordinator as its next turn, starting with `[Handback from thread t1 · "title" · status: done]`.
4. The coordinator tells you the result, answers the thread if it can, or asks you. Follow-ups go to the same thread with `project_thread_send`.

If a thread ends a turn the coordinator started without a handback, the coordinator gets a short automatic note with the thread's last reply (`autoHandback: idle`, the default). The note says so when the turn failed (for example a model error), was stopped (unless the coordinator stopped it itself), or was cut off because DSH quit or crashed; that one arrives when DSH starts again. If such a thread waits on a permission prompt for a minute, the coordinator is told which thread and what it wants to do, so it can tell you. So nothing a thread does goes unnoticed. When you talk to a thread directly, the coordinator is not woken for it; its thread list just notes that you did.

Handbacks and notes reach the coordinator in order. If it cannot take one (for example while it is open in another DSH process), the plugin keeps it and tries again, waiting longer each time, up to 15 minutes.

The coordinator's system prompt is rebuilt on every request with the live thread roster, the settings and project memory (all of it when short, otherwise its start and its newest lines). A thread's prompt tells it who it is and how to hand back.

These messages go the way DSH sends one agent's message to another, so they are never shown as yours. A brief or a coordinator's message comes from the coordinator's session and a handback from the thread's; the automatic notes and the welcome come from the plugin. DSH shows each as a collapsed notice (**Task message received**, or **Plugin status updated** for the plugin's) that opens to the full text. The model reads the same text as before.

## In the DSH window

Threads show up the way Claude Code shows sub-sessions:

- **Thread cards.** Under each coordinator reply, a card for every thread that turn started, messaged, steered, stopped, resolved or heard back from, with the thread's live state (running, waiting on you, done, failed, stopped, resolved) and the model and effort it runs on. Click the thread's name or **Open** to make it the main chat, or the split icon to open it beside the coordinator in the right sidebar, where you can read and talk to it. In a narrow chat, for example with the Threads panel open on a small screen, a card's code changes move up to its first line and its state and buttons to a row of their own, so the thread's name keeps its room.
- **Threads menu.** At the top of every project session, **N threads** (with a red dot when a thread failed, an orange one when a thread waits on you, or a spinner while one runs) opens the project's threads grouped as *Waiting on you*, *Running*, *Done*, *Idle* and *Resolved*. Each row leads with the thread's name; under it are its last handback, its code changes and when it last ran. At the top, **Coordinator** and **New threads** say what the coordinator and new threads run on; click either to open Project settings with that model menu already open. A row names its model only when it differs from **New threads**; hover a row to see it either way, and the Threads panel always shows it. A pick in any thread's or coordinator's own model menu shows up here within a second, and because DSH makes every pick its default model, **New threads** follows a pick in any chat when the project starts threads on DSH's default. Hover or click it; the arrow keys move through it. **Open the Threads panel** keeps the list in the right sidebar, where a click opens a thread's chat as a tab.
- **Thread names are links.** The coordinator writes thread names as `[title](.dsh-thread/t3)`, so a name in its reply opens that thread: DSH opens it beside the chat, or in the main view on DSH Desktop. A card's Open beside always opens it beside. DSH draws them with a branch icon.
- **Code changes.** A thread that edited files shows **+18 -3 · 2 files** on its cards, on its rows in the Threads menu and panel, and in its hover card in the session list: lines added and deleted and how many files, as DSH's own **Edited 2 files** card in the thread counts them, added up over the thread's turns. Click it on a card to open the thread with DSH's **Review** tab on its newest turn that changed files. The coordinator's thread list says the same ("changed 2 files (+18 -3)"). The counts outlive a DSH restart; DSH keeps the diffs only while it runs, so after a restart they no longer open Review. Like DSH's card, they show only while **Show coding view** is on in DSH's settings.
- **Back to the coordinator.** In a thread, **◆ Coordinator** at the top goes back to its coordinator, and the thread's own handback shows as a card that opens the coordinator.
- **A thread that failed or stopped.** When a thread's turn fails (the provider refused the request, DSH couldn't reach it, a plugin blocked it), its newest card reads **Turn failed** with the provider's reason and a **Retry** button; its row in the Threads menu and panel reads *Failed* with the reason, in red under *Waiting on you*, with a Retry icon. A turn that stopped before it finished (stopped, cut off when DSH closed, out of output tokens) reads **Stopped** with **Resume** instead. Retry and Resume send the thread "The user asked you to try again" (or "to continue") from its coordinator, so its handback goes there as usual. The coordinator's thread list says the same, so it can tell you which threads need you. A turn that finishes or hands back clears it.
- **Projects page.** **Projects** in DSH's sidebar, next to Plugins and Automation tasks, opens a page with a card for every project, the most recently active first: its name (click it to open the coordinator), **Paused** when it is, its folder, how many threads are running, waiting on you or done, and what the coordinator and new threads run on (click either to change it in Project settings). Under that are its threads, as in the Threads panel; done, idle and resolved threads fold under their headings. The gear opens Project settings and **Open** opens the coordinator.
- **Session list.** Thread rows get a small branch mark, a red dot when the thread's last turn failed, or an orange one when it waits on your decision or is blocked. Threads right under their coordinator are indented under its ◆ with a corner mark instead; a thread anywhere else (say a plain session sits between them) keeps the branch mark. Hovering one shows its project, what it last did (its handback, or how its last turn ended) and what it runs on. The plugin doesn't change DSH's list: each row carries a hidden mark through DSH's row slot, and the coordinator's row brings the CSS that indents its threads.
- **A new project.** The coordinator introduces itself, and under its greeting three first asks wait (**Try asking**) until you write or a thread starts. Click one to put it in the message box, ready to send or change.
- **A paused project.** Above the message box of the coordinator and of each thread, a bar like DSH's goal bar says the project is paused, how many handbacks it holds, and has **Resume**. The Threads menu and panel say the same with **Resume**, **N threads** reads **Paused · N threads**, the coordinator's row in the session list gets a pause mark, and a thread whose handback is held reads "Done · held until you resume" instead of "No handback yet", while its own card in the thread says **Handback held**. Resume anywhere delivers what was held.
- **Keyboard.** Every control the plugin draws shows DSH's focus ring when you reach it with the keyboard (Tab, or the arrow keys in the Threads menu and panel), and its text reads at 4.5:1 or better against its background, in light and dark.

All of it reads the `projectSession` view the plugin adds to each session (`lib/projection.js`); DSH builds it on the Host from the session's own events and sends it to the window, so nothing extra is stored. It needs DSH's own window (DSH Desktop or `dsh --profile web`). Sessions from before this version show their project and threads too.

## Settings

The four settings match Claude Code's project page:

| Claude Code | Here | Where |
| --- | --- | --- |
| Coordinator model | `coordinatorModel` | Project settings, the coordinator's model picker, `project_settings`, project row, or the plugin's page for every project |
| Coordinator effort | `coordinatorEffort` | same |
| Thread model | `threadModel` | same, except the picker (a pick in a thread's picker changes only that thread) |
| Thread effort | `threadEffort` | same |
| Pause project | `paused` | Project settings, `project_settings`, or project row |
| Goal | `goal` | project row |

### Project settings

Each project has its own **Project settings**, like a Claude Code project's settings page. Open it from any of the project's sessions: the sliders icon next to **N threads** at the top, **Project settings** at the bottom of the Threads menu, the same icon in the Threads panel, or **Project settings** in the session's **⋯** menu in the session list.

- **Models.** The coordinator's model and effort, and what new threads start on. Each picker works like DSH's own model menu: **Model** lists DSH's models grouped by provider, with search when there are many, and **Effort** lists what the chosen model offers. **Default** follows the plugin's Default models, and the row says where the current value comes from. A value set for this project shows **● Set for this project** with **Use default** next to it.
- **Threads.** Every thread with its state (the same dots as the Threads menu) and the model and effort it runs on. Change one to switch that thread from its next request; a running thread finishes its current request first. Resolved threads are behind **Show resolved threads**.
- **Project.** Pause the project.

A change applies at once, without restarting DSH or interrupting a session: the coordinator switches from its next request, and new threads start on the new choice. The dialog reads the project again every few seconds, so a change made in a chat or by the coordinator shows up there too. It talks to the plugin over DSH's own window connection (`lib/remote.js`), so it works in DSH Desktop and in `dsh --profile web`.

### Default models page

In DSH, open **Plugins → Projects** (or **Default models for all projects** in Project settings). Under **Default models**, pick the model and effort for coordinators and for new threads in every project that doesn't set its own. The pickers are the same as in Project settings. **Default** follows your DSH default model, which is the model last picked in any DSH chat.

Under it, **Projects** lists every project with what its coordinator and its new threads run on and where each value comes from (set for the project, its row in your profile, the Default models, or DSH's default). It reads again every few seconds, and within about a second of a pick in a coordinator's model menu. **Settings** opens that project's Project settings.

**Save** applies at once, in every project that uses the defaults, without restarting DSH or interrupting a session: each coordinator switches from its next request, and new threads start with the new defaults. A thread that already exists keeps the model and effort it started with. The page writes the plugin row of your profile's `cordis.patch.yml`, so editing that row by hand does the same.

### The model picker in a chat

Picking a model or effort in a coordinator's own DSH model picker (the composer's model menu, or `/model`) makes it that project's coordinator setting, as in Claude Code, so Project settings shows it as **Set for this project**. In a thread, a pick changes that thread's model and effort. DSH also makes a pick your DSH default model, as it does for any session. The plugin's own model changes never count as picks, and it never changes your DSH default model itself.

### Which setting wins

The most specific setting wins:

1. The project's own setting: set in Project settings, picked in the coordinator's model picker, or asked of the coordinator (`project_settings`).
2. The project's row in your profile.
3. The plugin's Default models (the page, or the plugin row).
4. DSH's default model.

**Use default** in Project settings, or saying "default" to the coordinator, clears the project's own setting. Saving new Default models never replaces a project's own setting; it changes only the projects that use the defaults. Editing a model or effort in a project's row by hand is the exception: at the next DSH start that value replaces the project's own setting for it, and the plugin logs it (`row <project> … replaced …`).

Models are `provider:model` or a bare model id. Effort is whatever the model offers (for DeepSeek: `off`, `low`, `high`, `max`). Both are checked against the Host's model catalog, and a bad value comes back with the valid choices.

An effort the model doesn't offer never stops a session. It runs at the model's nearest level at or below it (Max on a model whose top level is High runs at High), and Project settings, the Default models page and the coordinator say so. A model with no effort levels runs without one. A thread start is refused only for an effort no model in DSH offers. Setting an effort outright with `project_settings` or `project_thread_update` for a model that lacks it is refused with that model's choices, so the coordinator hears them instead of a silent change.

A thread keeps the model and effort it started with, even one that started on the defaults: changing the Default models or your DSH default model later doesn't move it. The coordinator can give one thread its own model or effort at start, or change it later with `project_thread_update`; you can change it in Project settings or in the thread's own model picker.

Pausing blocks new threads and holds handbacks. Resuming delivers the held handbacks in order.

The plugin sets a project session's model and effort the same way the DSH model picker does, but only on that one session. The DSH window shows each session's model and effort.

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
- Only the coordinator starts threads; a thread cannot start threads of its own.
- **Waiting on you** knows about a pending permission prompt only for threads open in the window. The coordinator still gets told about the others after `approvalNoticeSeconds`.
- Discord threads cannot be project threads yet. The discord plugin keeps its own sessions.
- Threads share the project folder. In a git repository, DSH counts everything that changed in the folder during a turn, so threads that run at the same time can each show the other's edits, in DSH's own card and here alike. Each thread in its own worktree would fix that.

## Tests

```bash
npm install --no-save @deepseek-ai/schemastery @deepseek-ai/dsh-tools@next
node plugins/projects/test/smoke.mjs
```

The smoke tests run against a fake Host built from the published `@deepseek-ai/*` packages, including a Host with DSH's per-session model selection.

The end-to-end test boots a real DSH (the web profile, in a temporary `DSH_HOME`) with this plugin, session-bridge and a scripted model server. It drives the coordinator and threads through the bridge and checks what reaches the model: the model and effort of every request, which tools each session has, handbacks, the automatic notes (idle, failed, stopped, waiting on approval, cut off by a crash), queued turns, direct talk, settings, memory, pause, a stop by the coordinator, a restart after DSH is killed mid-turn, that DSH serves the page's browser code, the view the window draws (each thread with its handback and cards, and each thread's coordinator, as DSH folds and saves it), new defaults saved while DSH runs (a project's own choices stay), the Project settings endpoints as the window calls them (a read through a thread, **Use default**, a refusal, a new thread on the project's own thread model), a pick in DSH's own model picker becoming the coordinator setting, a thread model that lacks the project's effort running at its nearest level, the plugin page's list of projects (each setting with where it comes from, and what the coordinator runs right now), that a new coordinator introduces itself so DSH lists it (the window view marks that turn and the user's first ask), who DSH shows as the sender of each message (a brief or a coordinator's message from the coordinator, a handback from its thread, held or not, the notes and the welcome from the plugin, and the user's own words as the user's), and a thread's code changes in a git folder (the counts DSH's own card shows, added up over two turns, the turn Review opens, the thread's view marking each turn, the coordinator's thread list, and the counts kept after another restart while the diff is gone). It takes about three minutes.

```bash
npm install --prefix /tmp/dsh @deepseek-ai/dsh
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/projects/test/e2e/run.mjs
```

It passes on DSH 0.2.0-rc.2 and 0.2.1-alpha.2, as root and as a normal user.
