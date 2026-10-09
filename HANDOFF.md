# Handoff

Updated: 2026-10-09 00:05 PT by B (bertholomus)
Branch: claude/projects-plugin-boaurl

## Doing now
- Draft PR for `plugins/projects` is open against main. Waiting on a live try in DSH Desktop.

## Done since last handoff
- Studied the DSH host APIs from the published `@deepseek-ai/*@next` packages (see Gotchas).
- Wrote `plugins/projects`: coordinator session per configured project, `project_thread_*` tools, `project_handback`, `project_settings` (coordinator/thread model + effort, pause), `project_memory`, automatic idle note when a thread ends a turn without a handback, handback rate cap, held handbacks while paused.
- Tests: `plugins/projects/test/smoke.mjs` (15 tests, fake Host) and `test/projects.test.js` (pure logic, runs in `npm test`). All green; discord smoke still 24/24.

## Next steps (in order)
1. Load the plugin in the real DSH Desktop profile (row in plugins/projects/README.md) and check: coordinator appears, a thread starts with its brief, a handback lands in the coordinator, the effort override shows up in requests.
2. Fix whatever the live run shows; the fake Host may differ from the real one (agent/created timing for sessionController.create, systemPrompt section order).
3. Later: let a Discord thread act as a project thread or coordinator (user's existing Discord flow); auto-continue after usage limits.

## Open questions / blockers
- Not yet run inside a real DSH Desktop. Needs a live try on the Mac.

## Gotchas (things that broke, decisions made and why)
- Separate plugin, not part of discord or session-bridge: it only needs host services (`sessionController`, `agents`, `workspaceRegistry`), so it works in the DSH window with no bot.
- Do NOT use `sessionController.selectModel` for per-session models: it also saves the selection as the global DSH default model (see `dsh-api-session-controller` `selectModel`). session-bridge's `/sessions/:id/model` has this side effect today. projects uses a per-agent `agent/request` override instead (same trick as discord's /model).
- `sessionController.prompt` treats any mode other than `steer` as a follow-up, so session-bridge's `followup` mode works even though the typed modes are `queue | steer`.
- Tools and system-prompt sections are registered on `agent.ctx` (agent-scoped), so only project sessions see project tools. The plugin hooks `agent/created` to attach on create and on every resume.
- Project sessions' model/effort are forced on every request; the DSH model picker is overridden for them (documented in the plugin README).
- `defineTool` validates enum params before `execute`, so a bad `status` never reaches the plugin; it comes back as INVALID_ARGS.
- Repo-local `node_modules` may be a symlink in cloud sessions; .gitignore's `node_modules/` does not match a symlink, so never `git add -A`.
