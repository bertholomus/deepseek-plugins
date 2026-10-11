# dsh-plugin-projects

Projects for DSH Desktop. A project works in one DSH workspace: you talk to its **coordinator** session, it starts **threads** (separate sessions) for focused work, and threads **hand back** their results to it. Each project has default models and effort levels for the coordinator and for threads, and says which of your own tools its sessions get and where they can write. **Projects** in DSH's sidebar opens a page with every project and its threads.

Every coordinator and thread is an ordinary DSH session in the project's workspace, made through the Host's own `sessionController`. They show live in the DSH sidebar, and you can open any thread and talk to it directly.

## How it flows

1. You ask the coordinator for work in the `◆ <project>` session.
2. The coordinator calls `project_thread_start` with a title, your words (`ask`, copied word for word) and a brief with what the thread needs beyond them. Once you have written to the coordinator, the plugin holds `ask` to that: each sentence of it must be in what you wrote (your messages, your answers in DSH's question box, or the project's goal; case, quotes and spacing aside), so a task the coordinator picked itself goes in the brief and never reads as yours; the same goes for `ask` on a message to a thread. A new session titled with the thread's title starts with them as its first message: `The user asked: "…"`, then the brief. A title longer than DSH's 80-byte limit for session titles is cut once, after its last whole word, with "…", and that one title is used everywhere. DSH's session list shows the thread under the `◆ <project>` coordinator. The thread works in the coordinator's workspace, so DSH lists it with its project.
3. The thread works. When it finishes, gets blocked, or needs a decision, it calls `project_handback`. The handback lands in the coordinator as its next turn, starting with `[Handback from thread t1 · "title" · status: done]`.
4. The coordinator tells you the result: the handback ends with a note that asks it to reply now, its first line the thread's link and the result in one sentence (or what the thread needs from you), and to say "the thread reports" for anything it did not check itself. When no other thread is at work, it ends with a line that answers what you asked for. It answers the thread if it can, or asks you. Follow-ups go to the same thread with `project_thread_send`. A thread stays in **Done** until you ask the coordinator to resolve it.

If a thread ends a turn the coordinator started without a handback, the coordinator gets a short automatic note with the thread's last reply (`autoHandback: idle`, the default). The note says so when the turn failed (for example a model error), was stopped some other way than by you or the coordinator, or was cut off because DSH quit or crashed; that one arrives when DSH starts again. A turn you stop yourself (DSH's stop button, or the session bridge) sends no note: the thread stays stopped until you press **Resume** or ask the coordinator to send it on, and the coordinator's thread list says you stopped it. If such a thread waits on a permission prompt for a minute, the coordinator is told which thread and what it wants to do, so it can tell you. So nothing a thread does goes unnoticed. When you talk to a thread directly, the coordinator is not woken for it; its thread list just notes that you did.

**The coordinator guides its threads while they work.** It runs on Read Only by default: it reads files and uses the project tools, a change it tries fails without asking you (DSH's file tools are refused with a note to start a thread, a command or file call that asks for a wider sandbox is refused before DSH would ask you, with a note that the step belongs in a thread, and anything else that would need your approval is refused), and threads do all the changing. A thread that is unsure and has no sensible default asks it with `project_ask_coordinator`; the question reaches the coordinator as `[Question from thread t1 · "title"]`, and it answers with `project_thread_send` (steered into the running turn), or asks you in one line when only you can decide and sends your answer on. The question stays on the coordinator's thread list until something is sent to the thread, and a thread that ends its turn to wait for the answer sends no idle note. The coordinator sees a thread's progress in that list (status, last handback, code changes, an open question, how its last turn ended) and with `project_thread_read`, which shows the files it changed so far and its latest steps before its latest messages. It checks each handback against your ask before telling you, sends a thread what to fix and why when it falls short, and redirects a running thread when your priorities change; what it sends a thread goes to the thread, not into its reply to you. A thread follows its coordinator's directions, but the coordinator's words are never yours: only your words give a thread your tools.

**The coordinator doesn't set DSH goals.** DSH's `create_goal` is kept from coordinators (refused if called anyway), since a goal's rounds had a coordinator read and steer its threads over and over while their handbacks come on their own; threads keep it. A goal you set yourself with `/goal` in a coordinator still runs, and its rounds don't send the coordinator to its threads.

**A thread that ends its turn without a handback gets one nudge.** When a turn fails or stops, the plugin sends the thread "Carry on from where you left off and finish the task." itself, from its coordinator, so the coordinator takes no turn just to say so (while the project is paused, the coordinator gets the note on resume and sends it). When a turn just ends, the idle note asks the coordinator to pass on its result, answer its question, or send it one message. When it ends that way again, or only you can fix it (you signed out, or a hook blocked the turn), the note asks the coordinator to tell you in one line, with the card's **Retry** or **Resume** for a failed or stopped turn, and to send it nothing more unless you ask. A handback, your words or your Retry start the count again. A turn cut off because DSH quit or crashed gets no nudge: the note at the next start asks the coordinator to tell you, and the thread waits for your **Resume**, so nothing starts again on its own after you quit (nor asks again for a permission it was waiting on).

Handbacks and notes reach the coordinator in order. If it cannot take one (for example while it is open in another DSH process), the plugin keeps it and tries again, waiting longer each time, up to 15 minutes.

The coordinator's system prompt is rebuilt on every request with the live thread roster and project memory (all of it when short, otherwise its start and its newest lines). A thread's prompt tells it who it is and how to hand back. See [How the coordinator and threads behave](#how-the-coordinator-and-threads-behave).

These messages go the way DSH sends one agent's message to another, so they are never shown as yours. A brief or a coordinator's message comes from the coordinator's session and a handback from the thread's; the automatic notes and the welcome come from the plugin. Each shows as a collapsed notice in DSH's own style that says what came in: **Handback from** *thread* with the state it reported (**Done**, **Blocked**, **Needs a decision**, **Progress**), *thread* **ended without a handback** (**Failed** or **Stopped** when it did), *thread* **is waiting for approval** (**Needs you**), **Project created**, **Brief from** *◆ project* and **Message from the coordinator**. Open one for the full text, without the note that tells the coordinator how to answer. Other messages keep DSH's own notice (**Task message received**, **Plugin status updated**).

## How the coordinator and threads behave

The prompts are short and numbered, so smaller local models can follow them too: eleven rules for the coordinator and five for a thread, and each automatic message (a handback, an idle or failure note, a permission prompt, the welcome) carries its own instruction for the moment the coordinator reads it.

- **Your ask, and only your ask.** The coordinator does what you ask. When you leave the choice to it ("find a test task"), it picks work that only reads and writes files in the workspace and says what it picked. With no goal set, the project is only what you ask in the chat, and the welcome asks what the project is for; set one in Project settings.
- **Your personal and infrastructure tools stay yours.** Neither the coordinator nor a thread uses password managers and vaults, note apps, email and messaging, home or household services, control of your screen, or model lanes and gateways unless your own words (a message, or the goal) call for one. A thread that needs one hands back **Blocked** and says why. Name your own MCP servers in `guardedTools` and the plugin holds it in code too: under **Your tools: Only when asked**, the default, the coordinator doesn't have them at all and a thread has only the ones your words for it name (see [Guarded tools](#guarded-tools) and [Your tools and permissions](#your-tools-and-permissions)).
- **Ask before what can't be undone.** Before deleting files, pushing, publishing, sending or posting anything, spending money, or changing settings outside the workspace, the coordinator asks you, and a thread hands back **Needs a decision**, unless your words asked for exactly that; a thread does the same before it writes outside the workspace. A request to a service outside the workspace that does more than read counts as sending, and so does one with a made-up or placeholder credential, whatever a brief says. Doing it again, as a retry or a check, needs its own ask. Editing files in the workspace for the task is fine, and a thread keeps its scratch files there or deletes them before it hands back.
- **A command that sends waits for you, every time.** The plugin holds the rule above in code too. Before a thread's shell command (or its `run_code`) that sends anything outside the workspace runs, DSH's approval prompt asks you and says what it sends (*This command sends a POST to api.example.com/deploy (curl).*); **Allow once** runs that one command, and the next one asks again, so a retry or a check is a new ask. If you reject it, the thread hands back rather than send another way. It counts a request that does more than read (curl, wget, HTTPie, PowerShell's web commands, code that posts), a push, a publish (npm, PyPI, crates, gems, images), a deploy or another change made through a service's own tool (Vercel, Netlify, Firebase, Cloudflare, Fly, Heroku, AWS, Google Cloud, Azure, kubectl, Helm, Terraform, Pulumi, `gh pr create`, …), a command run or a file copied on another machine (ssh, scp, rsync), and an email; and a script, a package script or a make target that does one of these, by what it runs (read from the workspace) or by a name that says it deploys or publishes. Reads run as before: a GET, a clone, an install, a build, the tests, a syntax check, a dry run. A coordinator's command that sends is refused without asking you, since its threads do the work, and so is a subagent's; a thread whose permission never asks (Full access) is refused too and hands back, and you can put it on Workspace Write so it can ask. When the coordinator started the thread's turn, it hears what the thread waits on, as with any permission prompt. The projects log notes each one (`send-ask <project>/<thread> request curl`, `send-refused …`), never the command.
- **A home-folder workspace.** When a project's workspace is your home folder, the coordinator and its threads are told to put new files in a new subfolder and never move or delete anything they did not create.
- **Findings, not facts.** A thread's handback says only what its tools showed and marks a guess "(guess)"; its card shows 300 characters, so it leads with the result, and a longer summary goes back to the thread once to be shortened (the next one is taken as it is). It names every request it sent to a service outside the workspace and every file it wrote outside it. The coordinator relays what it didn't check as the thread's report.
- **Settings are only settings.** Neither prompt names a model or an effort. The coordinator sees them only through `project_settings`, when you ask which model runs or ask to change one, and the tools say to pass a model or effort only when you ask for one.
- **Your calls.** A thread you stopped stays stopped, the coordinator resolves threads and changes settings only when you ask, and it writes to project memory only decisions and preferences you stated.

### Guarded tools

`guardedTools` names the MCP servers (or tools) that are yours alone, such as a password manager, a vault, a home-automation server, a model-lane catalog or computer control. Both prompts list them under the rule above, and a `project_thread_start` or `project_thread_send` whose text names one is refused unless your words name it: the start's `ask` (or a message's `ask`, or the thread's original ask) or the project's goal. A name counts in any case, with `-`, `_` or a space, also inside a tool id such as `mcp__lane-catalog__lanes_status`; the words you'd use for a tool count when you list them:

```yaml
- id: projects
  config:
    guardedTools:
      lane-catalog: [lanes, model lanes]
      family_1password: [1password, password]
      dsh_vault: [vault]
      household_web: [household, home assistant]
      cua: [computer use, screen]
      obsidian: [notes app]
```

A plain list (`guardedTools: [lane-catalog, cua]`) works too. The refusal tells the coordinator to keep the work in the workspace or ask you first, and the projects log notes it (`guard <project> start lane-catalog`). An `ask` that names one of your tools when your own messages to the coordinator never did is refused as well (`guard <project> ask-unsaid lane-catalog`), so the coordinator can't quote you into one.

Under **Your tools: Only when asked** the guarded servers are also out of each project session's tool list (DSH's per-session tool restriction), so the model isn't offered them, and a call made anyway is refused before it reaches the server. That holds for a server that connects later too. The list is live: editing it applies at once, without restarting the plugin. With nothing listed, nothing is held back, and Project settings says so.

## In the DSH window

Threads show up in the DSH window like this:

- **Thread cards.** Under each coordinator reply, a card for every thread that turn started, messaged, steered, stopped, resolved or heard back from, with the thread's live state (running, waiting on you, done, failed, stopped, resolved) and the model and effort it runs on. A handback longer than a card's 300 characters is cut at a sentence end, or else at a word end, never inside a word or a name. The line above the name says what happened (*Started a thread*, *Handback*, *Ended without a handback*), and the state is said once, on the right. Click the thread's name or **Open** to open it beside the coordinator, in the right sidebar, where you can read and talk to it; **Full view** makes it the main chat instead (see [Side by side](#side-by-side)). In a narrow chat, for example with the Threads panel open on a small screen, a card's code changes move up to its first line and its state and buttons to a row of their own, so the thread's name keeps its room; narrower still (a coordinator beside its thread at 1280 px), the buttons move under the state rather than cut it.
- **Threads menu.** At the top of every project session, **N threads** (with a red dot when a thread failed, an orange one when a thread waits on you, or a spinner while one runs) opens the project's threads grouped as *Waiting on you*, *Running*, *Done*, *Idle* and *Resolved*. Each row leads with the thread's name; under it are its last handback, its code changes and when it last ran. At the top, **Coordinator** and **New threads** say what the coordinator and new threads run on; click either to open Project settings with that model menu already open. Under them, **Thread access** says the permission new threads start on (**Workspace Write**, with DSH's icon for it) and **Your tools** whether they get your tools (**Only when asked** or **Always**, shown when `guardedTools` lists any); click either to open Project settings at Access. A row names the tools of yours its thread has (a shield and their names), and its permission when that isn't **Thread access**. A row names its model only when it differs from **New threads**; hover a row to see it either way, and the Threads panel always shows it. A pick in any thread's or coordinator's own model menu shows up here within a second, and because DSH makes every pick its default model, **New threads** follows a pick in any chat when the project starts threads on DSH's default. Hover or click it; the arrow keys move through it. **Open the Threads panel** keeps the list in the right sidebar, where a click opens a thread's chat in the thread tab beside it (a new tab when there is none yet).
- **Thread names are links.** The coordinator writes thread names as `[title](.dsh-thread/t3)`, so a name in its reply opens that thread: DSH opens it beside the chat, or in the main view on DSH Desktop. A card's **Open** always opens it beside. DSH draws them with a branch icon.
- **Code changes.** A thread that edited files shows **+18 -3 · 2 files** on its cards, on its rows in the Threads menu and panel, and in its hover card in the session list: lines added and deleted and how many files, added up over the thread's turns. They count the thread's own edits, through DSH's file tools (write, edit, str_replace_editor) and its subagents' too, so threads and chats that share a folder never count each other's work; DSH's own **Edited N files** card diffs the whole folder over the turn, so it also lists what others changed meanwhile. A shell command's edits aren't counted yet. Click the counts on a card to open the thread with DSH's **Review** tab on its newest turn that changed files (DSH's diff of that turn). The coordinator's thread list says the same ("changed 2 files (+18 -3)"). The counts outlive a DSH restart; DSH keeps its diffs only while it runs, so after a restart they no longer open Review. A thread from an earlier version of the plugin is counted again from its log once, at the next start. Like DSH's card, they show only while **Show coding view** is on in DSH's settings.
- **Back to the coordinator.** In a thread, **◆ Coordinator** at the top goes back to its coordinator, and the thread's own handback shows as a card that opens the coordinator.
- **A thread that failed or stopped.** When a thread's turn fails (the provider refused the request, DSH couldn't reach it, a plugin blocked it), its newest card reads **Failed**, with when it happened and the provider's reason, and a **Retry** button; a retry that fails again reads **Failed twice** (then **3 times**) with the new time; its row in the Threads menu and panel reads *Failed* with the reason, in red under *Waiting on you*, with a Retry icon. A turn that stopped before it finished (stopped, cut off when DSH closed, out of output tokens) reads **Stopped** with **Resume** instead; one you stopped yourself says so (*You stopped it*, *Stopped by you*) and waits for you, and the coordinator doesn't send it on unless you ask. Retry and Resume send the thread "The user asked you to try again" (or "to continue") from its coordinator, so its handback goes there as usual. The coordinator's thread list says the same, so it can tell you which threads need you. Inside the thread, a bar above the message box says **Failed** (or **Failed twice**) with the reason, or **Stopped**, with **Retry** or **Resume** and when it happened. A turn that finishes or hands back clears it.
- **Projects page.** **Projects** in DSH's sidebar, next to Plugins and Automation tasks, opens a page with every ◆ project and its threads, headed with how many. The projects come in DSH's order of the workspaces they work in (then your profile's order), each with its threads under it wherever they work: open ones first, then the resolved ones, each in DSH's order. Every thread DSH lists is there, except archived ones; an archived project isn't (see [Restart, archive, remove](#restart-archive-remove)), nor one whose coordinator hasn't started yet, as there is nothing to open. A project's row says the workspace it works in and its threads after its ◆, *storefront · 2 open threads · 1 resolved* (open threads as its Threads menu counts them; *Paused · …* and a pause sign when it is paused). Each thread shows its state with its dot, in the Threads menu's words (*Running*, *Needs you*, *Failed*, *Stopped*, *Blocked*, *Needs a decision*, *Done*, *Idle* or *Resolved*); a project with news you haven't seen reads bold with a dot, as its row in the session list does, and otherwise shows DSH's own dot for its coordinator, each named for screen readers. **Find by name**, above the tree, keeps every project or thread whose name holds what you type (in any case), a project with all its threads and a thread under its project, the words in bold; ↓ goes into the tree, Escape or its × clears it, and what you close while finding is forgotten when the find changes. The tree is one tab stop: ↑ and ↓ go through it as drawn, → opens a project or goes into it, ← closes it or goes to its project, Home and End go to the ends, and Enter or a click opens a project's coordinator or a thread; a project's chevron opens and closes it. Nothing on the page moves, so Alt and an arrow say why and leave the focus where it is: a project keeps the order of the workspace it works in; a thread stays with the project it started in (Alt+← on it, Alt+↑ on a project's first thread and Alt+↓ on its last), keeps the session list's order among its project's threads, and can't go inside another thread. A row's **⋯**, shown while you point at it or it has the focus, has what the plugin adds to its menu in the session list: **Project settings** and **Archive project…** on a project, and on a thread the other way to open it (**Open in full view**, or **Open beside its coordinator** while that's turned off) and its project's settings. Shift+F10 or the context-menu key opens it too, ↓ then going into it, and so does a right-click on the row. The page remembers what you closed. With no project yet, it says how to add one.
- **Session list.** Thread rows get a small branch mark, a red dot when the thread's last turn failed, or an orange one when it waits on your decision or is blocked. The plugin's mark gives way to any other in a row's leading seat, DSH's own (an Automation task's) or another plugin's, so the seat keeps DSH's width and their marks stay where they are. In the coordinator's workspace, its threads are drawn right under its ◆, indented with a corner mark, whatever order DSH lists them in: the coordinator and its threads sit together where DSH lists the coordinator, and the workspace's other sessions keep DSH's order around them. A thread drawn there doesn't show how long ago it was active (a screen reader still reads it), so its title keeps the room DSH's own rows have; DSH's *Approval* still shows. A thread in another workspace keeps the branch mark. Hovering a thread shows its project, what it last did (its handback, or how its last turn ended), what it runs on, and where it can write and which of your tools it has (*Workspace Write · Your tools: lane-catalog*); hovering a coordinator shows the same for it. DSH's own drags of sessions keep to what a project allows: a thread moves only among its project's threads, under its coordinator; a chat or another ◆ project can't go in among a project's threads; and no session leaves its workspace. A refused drop leaves the row where it was, and DSH's banner at the top of the window says why (*A thread stays with the project it started in.*). In **In one list** and in search results, which show no workspaces, DSH's drags are its own. A screen reader names each row by its title, as DSH does, and hears the plugin's words after it, as the row's description: *Project thread* (or *Project thread: Failed*, *Blocked*, *Needs a decision*), *Project*, *Project paused*, and a ◆ project's news (*Project, 3 new, latest: “Fix the tests” handed back*); the marks themselves are drawn only. It meets each project's threads right after its ◆, in the order they are drawn. A description DSH gives a row (an archived one's) stays DSH's. The plugin doesn't change DSH's list or its order: each row carries a hidden mark through DSH's row slot, and the plugin's CSS, kept in step with those marks, lays out each workspace's rows (`nestingRules` in `lib/client.js`); the same pass gives a workspace whose rows it reorders that order for screen readers (`aria-owns`, `readInOrder`) and each project row its description (`describeRows`), and takes both away when the plugin is switched off. DSH's rows, its view options and its search stay its own. Categories, which group workspaces in this list, are a plugin of their own (see [Projects and workspaces](#projects-and-workspaces)).
- **A new project.** The coordinator introduces itself, and under its greeting three first asks wait (**Try asking**) until you write or a thread starts. Click one to put it in the message box, ready to send or change. A project whose workspace is your home folder gets two that stay out of the rest of it (plan the work, or a small test script in a new folder), since looking around "this folder" or reviewing "the code" there would mean all of your files.
- **A paused project.** Above the message box of the coordinator and of each thread, a bar like DSH's goal bar says the project is paused, how many handbacks it holds, and has **Resume**. The Threads menu and panel say the same with **Resume**, **N threads** reads **Paused · N threads**, the coordinator's row in the session list gets a pause mark, and a thread whose handback is held reads "Done · held until you resume" instead of "No handback yet", while its own card in the thread says **Handback held**. Resume anywhere delivers what was held.
- **News from threads, wherever you are.** When a thread hands back, finishes its turn without a handback, waits for your approval, fails or stops again after its nudge, or was cut off when DSH closed, and its coordinator isn't the chat you're looking at, DSH's banner at the top of the window says so (*◆ DSH Plugins: "Fix the tests" handed back.*) with **Open**, which opens the coordinator. Its ◆ row in the session list turns bold, with a dot (orange when a thread waits on you, red when one failed) whose label says how many and the newest, until you open the coordinator; the plugin keeps what you haven't seen, so the marks are back after a restart. DSH has no system notification a plugin can send, so the banner shows only in an open DSH window.
- **A chat in a project's folder offers its coordinator.** A chat in a workspace where a ◆ project works shows a bar above the message box, *This folder has a project.*, with **Talk to ◆ <name>**: one click opens the coordinator, and what you had typed moves into its message box. A new chat shows it before you send anything, whether you started it from the workspace's **+** or picked the folder under **New Session**. DSH's **New Session** button is DSH's own and a plugin can't point it at the coordinator, so the offer comes in the new chat itself. **×** stops offering it in that folder (this window remembers). The coordinator, its threads and the subagents DSH starts never show it.
- **Keyboard.** Every control the plugin draws shows DSH's focus ring when you reach it with the keyboard (Tab, or the arrow keys in the Threads menu and panel), and its text reads at 4.5:1 or better against its background, in light and dark. A thread's row is one button (its name and line), and its **Retry**, **Resume** or **Open beside** are buttons of their own next to it, so a screen reader meets each control on its own.

### Side by side

A thread you open lands beside its coordinator, wherever you open it: its row in the session list, DSH's search, a card, the Threads menu or the Projects page. The coordinator becomes the main chat and the thread opens in its right sidebar, so you can read the thread and talk to the coordinator at once. A link in a coordinator's reply opens the thread in the same place. A thread opened there, from the Threads panel too, takes the place of the thread tab already shown (the one in front, else the newest), so opening one thread after another doesn't pile up tabs; the Threads panel and DSH's own tabs stay.

- **When the window is too narrow.** DSH gives the main chat at least 400 px and its right sidebar at least 300 px, and below 768 px its right sidebar covers the window. Where both don't fit, a thread opens as the main chat instead: below 980 px wide with DSH's sidebar at its 280 px default, 1118 px with it at 418 px, or 768 px with the sidebar folded.
- **Full view.** **Full view** on a card, the arrow button on a row in the Threads menu, **Full view** at the top of the thread's tab in the right sidebar, and **Open in full view** in the thread's **⋯** menu in the session list or on the Projects page make the thread the main chat. It stays there until you open another chat.
- **Turning it off.** **Open threads beside their coordinator**, under **Threads** on the plugin's page (Plugins → Projects), is on by default. Off, a thread opens on its own, as DSH opens any chat, and **Open beside its coordinator** (in the thread's **⋯** menu in the session list or on the Projects page, and on its row in the Threads menu) or a card's **Open** pairs them. The switch applies at once and stays as you left it.

All of it reads the `projectSession` view the plugin adds to each session (`lib/projection.js`); DSH builds it on the Host from the session's own events and sends it to the window, so nothing extra is stored. It needs DSH's own window (DSH Desktop or `dsh --profile web`). Sessions from before this version show their project and threads too. DSH keeps the view it last built for a session and drops one built by another version of the plugin until that session is next opened, so after an update the plugin reads each project session DSH lists without a view again from its log when DSH starts, and until then the session list places it by what the plugin's store says, never by its title. A project whose name the store doesn't hold (a profile row since removed) takes its coordinator's title.

## Projects and workspaces

A project lives in one DSH workspace:

- A **project** is a `◆ <name>` coordinator in one workspace, with its threads. Its threads work in that workspace too, so DSH lists them with it, and a thread always stays with the project it started in. A workspace can hold several projects and plain chats.
- A new project takes a name and a workspace, and its coordinator starts there at once, with its introduction. For now a project comes from its row in your profile (see [Setup](#setup)), where its name and folder are set; the window has no **New project** button yet.

The window and the coordinator use the same endpoints (`lib/remote.js`: `create`, `rename`, `remove`, `addCoordinator`). The store still holds what an older version wrote there about categories and its groups (`categories`, `categoryOf`, `workspaceOf`, `imports`); this plugin never uses or changes it, and writes it back exactly as the file has it.

Categories, which group your workspaces in DSH's session list, are a plugin of their own: [plugins/categories](../categories/README.md). Each works without the other.

### Messages to other chats

A thread stays with the project it started in, and no chat becomes one later. A coordinator can still reach other chats: when you ask it to, `project_message` sends a chat in no project, or another project's coordinator, a message. It arrives as **Message from ◆ *project***, with your words and the coordinator's text, and the chat stays outside the project: it gets no thread, card, project tools or place in the project. Its answer to that message comes back to the coordinator once, as **Reply from *chat***; its later turns don't.

- The coordinator names the chat by its title as DSH lists it (or its session id), or another project by its name. A title several chats share, a thread (its own or another project's), or a name nothing has is refused with what to send instead.
- It goes only in a turn you started, with your own words in `ask` as you wrote them. A reply, a handback or another project's message can't send one on, so two coordinators can't keep answering each other.
- A chat outside a project has all of your tools, so a message that names one of your guarded tools needs your words for it, as a thread's start does.
- An answer that comes while DSH is off is delivered at the next start; one owed for over a day is let go. The store keeps the ones owed (`awaiting`), and the log says what went where (`message <project> to=chat|project <session>`, `message-reply …`).

## Settings

Each project has these settings:

| Setting | Key | Where |
| --- | --- | --- |
| Coordinator model | `coordinatorModel` | Project settings, the coordinator's model picker, `project_settings`, project row, or the plugin's page for every project |
| Coordinator effort | `coordinatorEffort` | same |
| Thread model | `threadModel` | same, except the picker (a pick in a thread's picker changes only that thread) |
| Thread effort | `threadEffort` | same |
| Your tools | `yourTools` | Project settings, project row, or the plugin's page for every project |
| Coordinator permission | `coordinatorPermission` | same, and the permission menu in the coordinator's chat |
| New threads' permission | `threadPermission` | Project settings, project row, or the plugin's page for every project |
| Pause project | `paused` | Project settings, `project_settings`, or project row |
| Goal | `goal` | Project settings or project row; never `project_settings` |

### Project settings

Each project has its own **Project settings** page. Open it from any of the project's sessions: the sliders icon next to **N threads** at the top, **Project settings** at the bottom of the Threads menu, the same icon in the Threads panel, **Project settings** in the session's **⋯** menu in the session list, or the same in a row's **⋯** on the Projects page.

- **Project.** The goal: what the project is for, in your words. The coordinator and every thread read it with each request, and it counts as your own words for your tools, so a tool of yours it names is open to every thread in the project (the row says which). Type it and click **Save**, or press Ctrl+Enter; Escape puts the saved text back. A goal from your project row shows **From your profile**; one set here shows **● Set for this project** with **Use your profile's**. Only you set it: the coordinator's `project_settings` can't. Under it, pause the project.
- **Models.** The coordinator's model and effort, and what new threads start on. Each picker works like DSH's own model menu: **Model** lists DSH's models grouped by provider, with search when there are many, and **Effort** lists what the chosen model offers. **Default** follows the plugin's Default models, and the row says where the current value comes from. A value set for this project shows **● Set for this project** with **Use default** next to it.
- **Access.** Your tools, the coordinator's permission and new threads' permission (see [Your tools and permissions](#your-tools-and-permissions)), each with where its value comes from, and **Use default** when it is set for this project. **Thread access** or **Your tools** in the Threads menu opens the dialog here.
- **Threads.** Every thread with its state (the same dots as the Threads menu), the model and effort it runs on, its permission and the tools of yours it has. Change its model and effort to switch that thread from its next request; a running thread finishes its current request first. The permission picker beside them changes its permission at once. Resolved threads are behind **Show resolved threads**.

A change applies at once, without restarting DSH or interrupting a session: the coordinator switches from its next request, and new threads start on the new choice. The dialog reads the project again every few seconds, so a change made in a chat or by the coordinator shows up there too. It talks to the plugin over DSH's own window connection (`lib/remote.js`), so it works in DSH Desktop and in `dsh --profile web`.

### Default models page

In DSH, open **Plugins → Projects** (or **Defaults for all projects** in Project settings). Under **Default models**, pick the model and effort for coordinators and for new threads in every project that doesn't set its own. The pickers are the same as in Project settings. **Default** follows your DSH default model, which is the model last picked in any DSH chat. Under **Default access**, pick Your tools and the coordinators' and new threads' permission for every project that doesn't set its own; **DSH default** is the permission DSH gives a new chat.

Under it, **Projects** lists every project with what its coordinator and its new threads run on, each one's permission, and whether its sessions get your tools. A value the project sets itself says where (*Set for this project* or *From your profile*); one with no note follows the defaults above. A project whose coordinator hasn't started has a hollow ◇ and no coordinator model, and an archived one says **Archived**. It reads again every few seconds, and within about a second of a pick in a coordinator's model menu. **Settings** opens that project's Project settings.

**Save** applies at once, in every project that uses the defaults, without restarting DSH or interrupting a session: each coordinator switches from its next request, and new threads start with the new defaults. A thread that already exists keeps the model, effort and permission it started with. The page writes the plugin row of your profile's `cordis.patch.yml`, so editing that row by hand does the same.

### Your tools and permissions

Three settings say what a project's sessions can reach and where they can write. Like the models, each is set for one project in its Project settings (or its row in your profile), and for every project under **Default access** on the plugin's page; the most specific one wins, then the built-in default.

| Setting | Key | Built-in default | Values |
| --- | --- | --- | --- |
| Your tools | `yourTools` | `asked`: **Only when asked** | `asked`, `always` |
| Coordinator permission | `coordinatorPermission` | `read-only`: it reads and directs, its threads change files | `read-only`, `workspace-write`, `danger-full-access`, another preset your profile defines, or `default` |
| New threads' permission | `threadPermission` | `workspace-write` | same |

- **Your tools: Only when asked.** No coordinator has your guarded tools. A thread has the ones your words for it name: the `ask` it started with, a later message's `ask` (each checked against what you wrote to the coordinator), the project's goal, or what you type in the thread yourself, which counts from the turn that answers it. The rest stay out of its tool list.
- **Your tools: Always.** Every coordinator and thread in the project has them; only the prompts' rule and the start and message checks stand in the way. Choosing it asks you to confirm first, naming the tools.
- **Coordinator permission.** Where the ◆ session can write and what it asks you first, as the permission menu in its chat sets it. A pick in that menu becomes this setting.
- **New threads' permission.** Each new thread is on it before it reads its brief; if DSH refuses the preset, the thread doesn't start and the coordinator hears why. A running thread keeps its own: change one under **Threads** in Project settings, or in its chat's permission menu.
- **What Workspace Write does.** It is DSH's own preset: the thread writes in its workspace (and DSH's temp folders) without asking, and its approvals are set to ask, even when your other chats ask nothing (Full access with approvals "never"). A write outside its folder is refused at first, with DSH's note that it may retry once with wider access; that retry shows DSH's approval prompt, and nothing is written unless you allow it. The same holds for its shell commands, which DSH confines with the system's sandbox (sandbox-exec on macOS, bubblewrap or Landlock on Linux); where DSH finds none, it refuses to run them rather than run them unconfined. When the coordinator started the turn, it hears that the thread waits on you after `approvalNoticeSeconds`.
- **Full access asks first.** Choosing Full access anywhere, for one thread or as a default, shows DSH's own confirmation.

Where you see them: **Thread access** and **Your tools** at the top of the Threads menu and panel; on each thread's row (its tools, and its permission when it differs); in the hover card of a thread or coordinator in the session list; under **Access** and **Threads** in Project settings; and under **Default access** and in the **Projects** table on the plugin's page. They are live settings: a change applies at once, without restarting the plugin. The coordinator's `project_settings` shows them, and only you change them.

### The model picker in a chat

Picking a model or effort in a coordinator's own DSH model picker (the composer's model menu, or `/model`) makes it that project's coordinator setting, so Project settings shows it as **Set for this project**. In a thread, a pick changes that thread's model and effort. DSH also makes a pick your DSH default model, as it does for any session. The plugin's own model changes never count as picks, and it never changes your DSH default model itself.

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
| `guardedTools` | `[]` | Your personal and infrastructure MCP servers or tools: a list of names, or a map from each name to the words you'd call it by. Project sessions use them only when your words ask; see [Guarded tools](#guarded-tools). |
| `yourTools` | `asked` | Who in a project gets your guarded tools: `asked` (no coordinator, and a thread only the ones your words for it name) or `always`. See [Your tools and permissions](#your-tools-and-permissions). |
| `coordinatorPermission` | `read-only` | The DSH permission preset coordinators run on, or `default` for DSH's default for a new chat. On `read-only` the coordinator's file changes and approval requests are refused without asking you; on a DSH without that preset it stays on DSH's default with the same refusals. |
| `threadPermission` | `workspace-write` | The DSH permission preset new threads start on, or `default`. |
| `logFile` | `~/.dsh/projects/projects.log` | Action log, mode 600. Empty string turns it off. |

A path under `~/.dsh` follows DSH's own data folder: with `DSH_HOME` set (a second DSH for testing, say), the store, memory and log live under it instead, so that DSH keeps projects of its own.

Project row:

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | required | Display name and coordinator title. |
| `workspacePath` | required | Workspace for the coordinator and its threads. |
| `id` | name, slugified | Stable id. Letters in any script are kept. Changing it starts the project over. |
| `goal` | `''` | The outcome the coordinator works toward. |
| `agentPreset` | | Agent preset for new project sessions. |
| `coordinatorModel`, `coordinatorEffort`, `threadModel`, `threadEffort` | | Override the plugin defaults for this project. |
| `yourTools`, `coordinatorPermission`, `threadPermission` | | Override the plugin's access defaults for this project. |
| `paused` | `false` | Start paused. |
| `memoryFile` | `<memoryDir>/<id>.md` | Use a different memory file. |

## Tools

Only project sessions get these. Other DSH sessions never see them.

Coordinator:

| Tool | What it does |
| --- | --- |
| `project_thread_start` | Start a thread with a title, the user's words (`ask`, required) and a brief, optionally with its own model or effort (only when the user asks for one). It works in the project's workspace. |
| `project_thread_send` | Message a thread, with the user's words (`ask`) when it passes on their request. Queued by default; `steer` delivers into the running turn. Reopens a resolved thread. |
| `project_message` | Message a chat in no project, or another project's coordinator, when the user asks (see [Messages to other chats](#messages-to-other-chats)). |
| `project_thread_list` | Threads with live status and last handback. |
| `project_thread_read` | How a thread is doing: the files it changed so far, its latest steps, and its latest messages. |
| `project_thread_update` | Rename, change model or effort, resolve or reopen, or stop the current turn. |
| `project_settings` | Show or change the four model settings and pause. It also shows your tools and the permission settings, which only you change. |
| `project_memory` | Read, append to or replace project memory. |

Thread:

| Tool | What it does |
| --- | --- |
| `project_ask_coordinator` | A thread's question to its coordinator while it works; the answer arrives as a message from the coordinator. |
| `project_handback` | Report to the user, through the coordinator, with a status (`done`, `blocked`, `needs_decision`, `progress`) and a summary that leads with the result. |
| `project_memory` | Same shared memory as the coordinator. |

## Restart, archive, remove

- **Start a fresh coordinator:** DSH's window can't delete a session, so quit DSH, delete the coordinator's folder under `~/.dsh/sessions/` (named after its session id, the project's `coordinatorSessionId` in the store), and start DSH. The plugin makes a new ◆ session for the project, with its threads, their handbacks and its memory, and a thread shows under the new ◆ once the new coordinator writes to it.
- **Archive a project:** **Archive project…** in its ◆ row's **⋯** menu in the session list or on the Projects page. It asks first, saying how many threads go with it and which of them run now. Then whatever runs in the coordinator and its threads stops, and DSH archives each of them, so the project leaves the session list and the Projects page with its coordinator and threads; nothing is deleted. DSH's own **Archive session** on a ◆ row does the same for that project, and asks first while one of its threads runs, naming it; so does one done while the plugin was off, at the next start. A ◆ row DSH already had archived before the plugin looked (under an earlier version of it, say) takes nothing with it: the project stays as it is until you choose **Archive project…**. While a project is archived it starts no threads, what a thread sends its coordinator waits for it, other projects' coordinators can't message it, and a new chat in its folder doesn't offer its coordinator. To bring it back, use **Undo** on the notice, or show archived chats in the session list and choose **Restore project** (or DSH's **Unarchive session**) in its ◆ row's menu: the coordinator and every thread come back together, and the coordinator gets what waited. Work the archive stopped stays stopped. A thread archived or unarchived on its own stays as you leave it. A profile project stays archived until you restore it; to drop it for good, remove its row.
- **Remove the plugin:** see the [root README](../../README.md#remove-a-plugin). Delete `~/.dsh/projects/` to drop all project state and memory.

## Security

- A project adds no new access. Its sessions have DSH's tools and your MCP servers like any session in that workspace, minus your guarded tools under **Only when asked**, and new threads start on Workspace Write unless you choose another permission. A project only lets one session start and message others in the project's workspace.
- Project tools are registered per session, so a session outside a project cannot start threads or send handbacks. A coordinator's message to another chat (`project_message`) gives that chat no project tools, and goes only when you ask for it.
- With `guardedTools` set, a thread start or message that names one of your guarded tools is refused unless your words or the goal name it, and under **Only when asked** the sessions that may not use one don't have it (see [Guarded tools](#guarded-tools)).
- A project session's shell command or code that sends outside the workspace runs only after your **Allow once**, each time (a thread), or not at all (a coordinator, a subagent, a thread whose permission never asks). The check reads the command and the scripts it names inside the workspace (at most 256 KB each), nothing outside it. It guards against a mistake, not against a session set on getting around it.
- The store, memory files and log are mode 600 in a mode 700 folder. The log records actions, ids and sizes, never prompt or memory text.

## Not yet

- No "auto-continue when usage limits reset".
- Only the coordinator starts threads; a thread cannot start threads of its own.
- **Waiting on you** knows about a pending permission prompt only for threads open in the window. The coordinator still gets told about the others after `approvalNoticeSeconds`.
- Discord threads cannot be project threads yet. The discord plugin keeps its own sessions.
- Threads share the project folder. A thread's code changes count only its own edits through DSH's file tools, so what its shell commands change isn't counted yet; DSH's own **Edited N files** card diffs the whole folder over a turn, so there, threads that run at the same time can show each other's edits. Each thread in its own worktree would fix both.
- A thread can't open in a window of its own: DSH shows one session per window. Side by side uses DSH's right sidebar instead.
- The window doesn't make, rename or remove a project yet: a project comes from its row in your profile. It can archive one with its threads (see [Restart, archive, remove](#restart-archive-remove)).
- The check before a command that sends reads the command line, not what a program does inside: a send through an MCP tool, a library the command loads, or a program it doesn't know runs without asking. A thread that tests its own server on localhost with a POST asks too, and there is no setting to turn the check off.

## Tests

```bash
npm install --no-save @deepseek-ai/schemastery @deepseek-ai/dsh-tools@next
node plugins/projects/test/smoke.mjs
```

The smoke tests run against a fake Host built from the published `@deepseek-ai/*` packages, including a Host with DSH's per-session model selection.

The end-to-end test boots a real DSH (the web profile, in a temporary `DSH_HOME`) with this plugin, session-bridge and a scripted model server. It drives the coordinator and threads through the bridge and checks what reaches the model: the model and effort of every request, which tools each session has (a coordinator without DSH's `create_goal`, a thread with it), the user's words at the top of a brief, handbacks and the note that says how to answer them, a start refused for a guarded tool and one without the user's words, the automatic notes and nudges (idle, a failed turn nudged once and then reported, stopped, waiting on approval, a turn cut off by a crash told at the next start and not sent on), queued turns, direct talk, settings, memory, pause, a stop by the coordinator, a restart after DSH is killed mid-turn, that DSH serves the page's browser code, the view the window draws (each thread with its handback and cards, and each thread's coordinator, as DSH folds and saves it), new defaults saved while DSH runs (a project's own choices stay), the Project settings endpoints as the window calls them (a read through a thread, **Use default**, a refusal, a goal set over the row's that the coordinator and a new thread read and **Use your profile's** gives back, a new thread on the project's own thread model), a pick in DSH's own model picker becoming the coordinator setting, a thread model that lacks the project's effort running at its nearest level, the plugin page's list of projects (each setting with where it comes from, and what the coordinator runs right now), that a new coordinator introduces itself so DSH lists it (the window view marks that turn and the user's first ask), who DSH shows as the sender of each message (a brief or a coordinator's message from the coordinator, a handback from its thread, held or not, the notes and the welcome from the plugin, and the user's own words as the user's), and a thread's code changes in a git folder (the counts DSH's own card shows, added up over two turns, the turn Review opens, the thread's view marking each turn, the coordinator's thread list, the counts kept after another restart while the diff is gone), a quit while a thread waits on a permission prompt (told once at the next start, the thread not sent on and its prompt not told again), projects made through the window's endpoints, which no button calls yet (`create` starting a welcomed coordinator in a workspace, the Projects page's list in DSH's own workspace order with no categories, a profile project's `rename` and a project with a coordinator's `remove` refused, no category endpoints, and a thread that works in its project's workspace whatever folder is named), a coordinator's message out of its project (to a chat in no project, which gets no project tools or prompt and no role in the window, its answer coming back once and a later turn sending nothing; to another project's coordinator, which can't send one on from that turn), and your tools and permissions (a stand-in MCP server that a plain session gets and a coordinator is never offered nor reaches, an ask that names it before you did refused, a thread that gets it from your words, your words typed in a thread giving it for that same turn, threads on Workspace Write before they read their brief and the coordinator on Read Only, Project settings moving both, a thread on Read Only that can't write, and a coordinator on Read Only whose write needing approval is refused without asking, and whose command asking for a wider sandbox is refused before anyone is asked), and a command that sends (a thread's POST to a stand-in server waiting on DSH's prompt, which says what it sends, while nothing arrives, its coordinator told, the prompt answered as the window does: Allow once sending it once, and the same command again asking again, where Reject sends nothing; a GET running without asking, the coordinator's own POST refused without asking anyone, and a thread on Full access refused with what you can do). It takes about four minutes.

```bash
npm install --prefix /tmp/dsh @deepseek-ai/dsh
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/projects/test/e2e/run.mjs
```

It passes on DSH 0.2.0-rc.2 and 0.2.1-alpha.2, as root and as a normal user.

A second real-host test checks where a thread on Workspace Write can write, in a DSH whose default is Full access with approvals "never", as yours may be: the thread runs with approvals set to ask and its coordinator on Read Only, a write inside its folder goes through, a plain write just outside is refused with DSH's note that it may retry, the retry raises DSH's approval prompt and writes nothing while it waits or after a stop, the coordinator is told, the same for the thread's shell (which also shows whether DSH has a sandbox to run it in on that machine), and a plain chat on DSH's default writes outside without asking, with either. It makes its folder in your home folder, since DSH lets Workspace Write chats write its temp folders, and runs on Linux and macOS in under a minute:

```bash
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/projects/test/e2e/sandbox.mjs
```
