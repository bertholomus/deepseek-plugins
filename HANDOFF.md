# Handoff

Updated: 2026-10-09 01:45 PT by B (bertholomus)
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
- Tests: `npm test` 27/27, `node plugins/projects/test/smoke.mjs` 22/22, also as a non-root user.

## Next steps (in order)
1. Mac live test after the restart: coordinator appears, thread start, handback, idle note, settings, and the DSH model picker shows the project effort. `~/.dsh/projects/projects.log` should have `select ...` lines.
2. Fix what it shows, then mark PR #1 ready for review.
3. Later: a Discord thread as a project thread or coordinator (the user's existing flow), and auto-continue after usage limits.

## Open questions / blockers
- The Mac has no GitHub push credentials for bertholomus. gh auth is broken, HTTPS asks for a username and the SSH key is refused. Fixes made on the Mac go through the cloud session.
- The Mac DSH restart waits for its running sessions to finish.

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
