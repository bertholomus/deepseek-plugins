# Handoff

Updated: 2026-10-09 02:45 PT by B (bertholomus)
Branch: claude/projects-plugin-boaurl (draft PR #1)

## Doing now
- Waiting for the user's Mac to be idle. DSH Desktop there is busy with TP6 sessions, and the user asked us not to interrupt them. When it has had zero running sessions for 2+ minutes, the Remote Control session on the Mac pulls this branch, runs the Fleet ff-only merge, restarts DSH Desktop and runs the live test.
- The cloud thread pushes fixes. The Mac can't push to GitHub (see blockers), so it sends fixes back to the cloud thread instead.

## Done since last handoff
- Real-host test in the cloud: DSH 0.2.0-rc.2 web profile, a scripted OpenAI-compatible model server and session-bridge. Coordinator → thread → handback → coordinator works. The idle note, settings, bad effort, memory, list/read and thread update all work, and so does a host restart (same coordinator, tools reattach, routes kept). Tools are scoped: coordinator 33, thread 28.
- Fixed: effort never reached the model on a real host (see Gotchas). Project sessions now get a per-session DSH model selection. On the wire: coordinator `reasoning_effort: max`, threads `high`, a model without efforts gets none, and settings changes apply from the next request.
- Fixed: folder modes. The state, memory and log folders are created 700 one level at a time and repaired if unusable. The Mac found the macOS EACCES case (e0cab5d).
- session-bridge: the umask is restored right after `listen()` (d60452d).
- A turn the user drives in a thread no longer wakes the coordinator. It shows in the roster instead (523a3a4).
- Docs: install through `dsh.profile.bundles` (`dsh plugin --profile desktop add`), with an address row for config (2a377af).
- Mac: `dsh-plugin-projects` is in `~/.dsh/profiles/desktop` bundles, plus an insert row with config (done by the RC session after the user typed OK). It is not loaded yet; that needs the DSH restart.
- The coordinator now hears when a thread it started fails, is stopped, or waits on a permission prompt for `approvalNoticeSeconds` (default 60) (3a0cc97).
- Real-host end-to-end test in the repo: `plugins/projects/test/e2e/run.mjs` (`npm run test:e2e`, needs `DSH_BIN` or `dsh` on PATH). It boots DSH with projects + session-bridge + a scripted model and checks 42 things (44 now). 42/42 on DSH 0.2.0-rc.2, as root and as a normal user, without the repo-root `node_modules` link (5fdf31d).
- Fixed: `project_settings` accepted an effort no model offers (e.g. "ultra") when the thread model has no efforts (e48952b).
- Fixed: session-bridge `GET /sessions/:id` showed no title for renamed sessions (718da57).
- A stop the coordinator asks for (`project_thread_update stop: true`) no longer comes back to it as a "stopped" note. Stops from anywhere else still do (50a67b7).
- New `maxThreadsPerHour` (default 20) per project. A scripted model that answered every idle note with a new thread made a real host start 87 threads in 40 s; now the same loop stops at 20 with an error the coordinator reports (0f10d0a).
- Checked the DSH web UI with Playwright (scripted model, cloud DSH): the coordinator session shows effort Max, a thread High, and a new plain session still shows the DSH default (Low). Threads are titled `<project> › <title>` in the sidebar.
- Fixed the 10 findings of a second-opinion review (each has a test that fails on the old code):
  - DSH runs queued messages as back-to-back turns and goes idle once. The idle review now reads the last turn from the session log (its handback calls, end reason, prompt) instead of a flag kept over the whole busy period. A failed follow-up after a handback now gets its note.
  - A turn cut off by a DSH crash or quit is reported when DSH starts again (threads are marked `busy` in the store while a turn runs; DSH's cold read closes the open turn as `interrupted`). A config reload no longer loses a running turn or a waiting permission prompt.
  - A held handback is retried with backoff (1 min doubling to 15 min) and delivered in order. The thread is told it will be retried, not "when the project resumes".
  - `project_memory replace` with empty text is refused (it erased memory).
  - Reload safety: one store object per file in the process, a lock so two plugin instances never make two coordinators, and a disposed instance hands late attaches to the new one.
  - Only "session not found" counts as a deleted coordinator; other read errors no longer create a second one.
  - Empty optional tool arguments count as not given; `"default"` works in `project_thread_start`; thread ids are trimmed; `stop` on an idle thread says no turn was running.
  - Project ids keep letters in any script (前端 and 后端 no longer collide).
  - The memory excerpt in prompts keeps the start and the newest lines.
- Tests: `npm test` 28/28, `node plugins/projects/test/smoke.mjs` 36/36, e2e 49/49 as root and as a normal user (adds queued turns and a SIGKILL mid-turn).

## Next steps (in order)
1. Mac live test after the restart: coordinator appears, thread start, handback, idle note, settings, and the DSH model picker shows the project effort. `~/.dsh/projects/projects.log` should have `select ...` lines.
2. Fix what it shows, then mark PR #1 ready for review.
3. Later: a Discord thread as a project thread or coordinator (the user's existing flow), and auto-continue after usage limits.
4. Idea, not tried: DSH session headers have `parentSession` (forks set it) and the web client nests child sessions under their parent (dsh-api-session-controller `lineage.js`). Threads could nest under their coordinator in the sidebar. Check first: `hasApiSessionSubagentOwner` and the archived-session gate treat `parentSession` specially, so it may change prompt routing or archiving.

## Open questions / blockers
- The Mac has no GitHub push credentials for bertholomus. gh auth is broken, HTTPS asks for a username and the SSH key is refused. Fixes made on the Mac go through the cloud session.
- The Mac DSH restart waits for its running sessions to finish.
- Found, not fixed (ask the user first, it changes the live Discord bot): the discord plugin's `/model` and `/effort` set the route with a plain `agent/request` override (plugins/discord/lib/router.js `installRouteOverride`). On DSH 0.2 the Host's installModelSelection rewrites every request to the session's selection (its `selection.current` always has a value), so those commands likely do nothing. Same cause as the projects fix; the fix is `selectForNextRequest` the same way.
- session-bridge `POST /sessions/:id/model` still saves the global DSH default (it calls `selectModel`). Offered to fix; no answer yet.

## Gotchas (things that broke, decisions made and why)
- DSH loads a plugin package only if the profile lists it in `dsh.profile.bundles`. A patch row alone does nothing. `dsh plugin --profile desktop add <path>` adds the link dependency, the `node_modules` symlink and the bundles entry. Use the `dsh` that DSH Desktop installs, because the npm `dsh` refuses the desktop profile. A running DSH doesn't load new bundles, so restart it.
- With the bundle listed, the bundle's own patch inserts the row. Configure it with an address row (`- id: projects` plus `config:`). An extra insert row duplicates the id. DSH still boots and the later (configured) row runs, because cordis-plugin-include indexes rows by id. That was checked on a real host.
- DSH's `installModelSelection` (dsh-agent) puts an `agent/request` listener on every API session at agent setup. It runs outside any plugin listener and replaces provider/model/effort with the session's selection, so a plugin's `agent/request` override is lost. Use `sessionController.agents.selectForNextRequest(agent, selection)` instead. It is internal: it is what `selectModel` does, minus saving the global default. The plugin falls back to a `{ prepend: true }` override when the method is missing (tested on the real host too).
- Do NOT use `sessionController.selectModel` for per-session models, because it also saves the selection as the global DSH default. session-bridge's `/sessions/:id/model` still has this side effect.
- cordis 4 has no optional inject. Use `ctx.get('llm')` or `ctx.get('agentDefaultModel')`, which return undefined when absent. `ctx.llm` without inject throws.
- `process.umask` is process-wide. A recursive `mkdir` under umask 0177 fails with EACCES for a normal user, but root skips the check, so cloud tests as root pass. Run folder tests as `nobody` too.
- Session events: prompts are `user/message` with `source.kind: 'user'` and the request id (`projects-…` for this plugin's own prompts). The Host also logs user-role messages with other kinds, such as `runtime-context` and `model-selection` notices. Don't treat those as prompts.
- `sessionController.prompt` treats any mode other than `steer` as a follow-up, so session-bridge's `followup` mode works even though the typed modes are `queue | steer`.
- Tools and system-prompt sections are registered on `agent.ctx` (agent-scoped), so only project sessions see them. The plugin hooks `agent/created` to attach on create and on every resume.
- `defineTool` validates enum params before `execute`, so a bad `status` comes back as INVALID_ARGS.
- Repo-local `node_modules` may be a symlink in cloud sessions. .gitignore's `node_modules/` does not match a symlink, so never `git add -A`.
- In the cloud Bash tool, `pkill -f <pattern>` also kills the tool's own shell when the pattern appears in the command. Find the PID with `ps -eo pid,args | awk ...`.
- Remote Control on the Mac refuses profile changes unless the user typed the approval in the thread. A relayed card tap does not count.
- DSH routes a linked plugin's `peerDependencies` (`@deepseek-ai/schemastery`, `@deepseek-ai/dsh-tools`) to its own install, so a plugin folder needs no `node_modules`. The e2e test proves it. The smoke tests still need the peers installed.
- After a DSH restart, an existing coordinator session stays cold until someone prompts it. The log says `coordinator <project> <session> resumed` when the plugin has checked it.
- DSH words the approval reason itself: `escalate sandbox to danger-full-access: <justification>`.
- Session titles: the session header keeps the creation-time title. Renames are `session/title` events.
- Per-thread caps don't bound a coordinator that starts new threads in a loop; `maxThreadsPerHour` does. Keep a project-level cap on anything a model can repeat.
- DSH's agent loop runs every queued message as its own turn (`turn/start` … `turn/end`) and only reports `idle` after the last one. Anything per turn must be read from the session log, not from status transitions.
- `sessionController.inspect` on a cold session uses the cold read, which appends synthetic `interrupted` turn closers for a turn a crash left open. Resuming the agent persists them. A crashed turn never produces a running → idle transition.
- A config save restarts the plugin (cordis `update` → `restart`): the old scope is disposed first, then `apply` runs again, while the old instance's async work keeps going. Hence the shared store and the coordinator lock.
- `ApiSessionNotFound` (session-controller) is the only error that means a session is gone; `inspect` can also time out or fail on I/O.
- Tool calls and results are in the session log: `tool/call {callId, name, arguments}` and `tool/result {message: {toolCallId, content}}`. The idle review finds a handback by its result text, which starts with "Handback ".
