# Handoff

Updated: 2026-10-08 23:35 PT by B (bertholomus)
Branch: claude/projects-plugin-boaurl

## Doing now
- Building `plugins/projects`: Claude-Code-style projects for DSH (a coordinator session per project, thread sessions it spawns, handbacks from threads to the coordinator, default model/effort for coordinator and threads).

## Done since last handoff
- Studied the DSH host APIs from the published `@deepseek-ai/*@next` packages (see Gotchas).

## Next steps (in order)
1. Write `plugins/projects` (lib/index.js, store, settings, tools, prompts).
2. Fake-host smoke test in `plugins/projects/test/smoke.mjs`; pure-logic tests in root `test/`.
3. README for the plugin, root README row, syntax test entries.
4. Open a draft PR to main.

## Open questions / blockers
- Not yet run inside a real DSH Desktop. Needs a live try on the Mac.

## Gotchas (things that broke, decisions made and why)
- Separate plugin, not part of discord or session-bridge: it only needs host services (`sessionController`, `agents`, `workspaceRegistry`), so it works in the DSH window with no bot.
- Do NOT use `sessionController.selectModel` for per-session models: it also saves the selection as the global DSH default model (see `dsh-api-session-controller` `selectModel`). session-bridge's `/sessions/:id/model` has this side effect today. projects uses a per-agent `agent/request` override instead (same trick as discord's /model).
- `sessionController.prompt` treats any mode other than `steer` as a follow-up, so session-bridge's `followup` mode works even though the typed modes are `queue | steer`.
- Tools and system-prompt sections are registered on `agent.ctx` (agent-scoped), so only project sessions see project tools. The plugin hooks `agent/created` to attach on create and on every resume.
