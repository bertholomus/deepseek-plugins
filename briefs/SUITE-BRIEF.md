# DSH Plugin Suite v1 — brief (tag SUITE1-1017)

Owner: account A (gmail), the "DSH Plugin Suite (gmail)" project. Written by MiniMe 2026-10-17 from Albert's words.
Folder: `~/Projects/dsh-plugin-suite` (a git worktree of `bertholomus/deepseek-plugins`, branch `suite/v1`, from a18b87b).

## Albert's words (Discord, 2026-10-17)
> "make them amazing and set it as a /goal to have them be 8.5 out of 10 before publishing to private git. you have no
> blockers. they should have no blockers - do not test on live deepseek - only test on test deepseek harnesses. do not
> let my approval be a stop to publish - make these canonical plugins for our stack and we will scrutinize them when we
> are done - i want to come back astonished and impressed"

## Goal
Build six DSH Desktop plugins that change how the stack feels to use. Each one must score **>= 8.5/10 from an independent
judge** (see Scoring) before it is published. Publish = merged to `main` of the private repo `bertholomus/deepseek-plugins`
and tagged. Albert reviews after that. His approval is NOT a gate.

## The six plugins (order = build order)
Each one replaces a manual workaround we live with today. Read the named skill sections and scripts so you see the real
failure each plugin removes. Do not copy their hacks. Build the proper version inside DSH.

1. **Autopilot** (`plugins/autopilot`). Keeps work moving when nobody watches.
   - Sees every session's state through the host's own `sessionController` / domain events.
   - After a DSH restart, finds interrupted sessions (`status cold`, `lastEnd interrupted`) and resumes them with a short
     carry-on note.
   - Detects a driver that is idle but still has open todo items or an open `/goal`, and sends one continue note. Rate-limit
     it, and back off after two nudges with no progress.
   - Detects an error turn that silently disarmed a `/goal` and resumes it.
   - Confirms delivery (an `agent/inbox/spliced` event or a new `turn/start`), never "sent".
   - Per-session rules (auto / ask / off) live in a panel. There is a full event log, a "why did it do that" line for every
     action, and a kill switch.
   - Today's workarounds: `dshb send` carry-on notes, relay crons, `cc_signal_monitor.py`, power-blip resume. Copies are in `~/Projects/dsh-plugin-suite-ref/`.
2. **Decisions** (`plugins/decisions`). One inbox for everything that waits on a human.
   - Collects `DECISION NEEDED: <q> — recommend: <x>` lines from any session's turn end, coordinator thread asks, the
     coordinator's "Allow once" send/delete prompts, and question-box tool calls.
   - Each card shows the question, the recommendation, the source session (one click opens it) and how long it has waited.
   - Answering (Accept recommendation / own text) sends the answer back into that session (steer if running).
   - Badge count in the sidebar plus notifications via the existing `notifications` plugin.
   - An optional outbound mirror (Discord webhook or command sink), OFF by default and never pointed at a real channel in
     tests.
3. **Agent Terminals** (`plugins/agent-terminals`). External coding agents as first-class DSH citizens. Brand-neutral:
   "coding agent", with presets for any CLI (claude, codex, opencode, or a custom command). No vendor names in UI text.
   - A visible terminal tab per project session. Today a bridge-made tab is hidden and a blank session is hidden from the
     sidebar; fix both properly.
   - Survives DSH restart: it records the agent's resume id and re-launches with resume.
   - Reliable message delivery into the agent's TUI: paste-then-Enter handling, swallowed-Enter retry, and proof from the
     agent's own transcript.
   - The agent's status (working / idle / waiting on you) is shown in the session list and fed into Decisions.
   - Today's workarounds are in `deepseek-harness-desktop-operations` → "Session terminals over the bridge" (`term-new`,
     `--raw "\r"` retries).
4. **Proof** (`plugins/proof`). Holds "done" to evidence.
   - When a turn claims done/passed/fixed/deployed, it checks the turn for evidence: tool output, an exit code, a test count,
     a metric delta, or a file hash. If the evidence is missing, the claim is flagged on the turn.
   - Optional verifier: a short independent check in a fresh thread on a cheap local model (GLM-5.3 Flash via the owner
     gateway). It re-runs or re-reads the evidence and writes VERIFIED / NOT VERIFIED with its reason.
   - A per-session claims ledger (claim, evidence, verdict) with export.
   - It must be quiet when evidence is present, with false-flag rate measured on a fixture corpus.
5. **Canon** (`plugins/canon`). Shared long-term memory with the rest of the stack.
   - Reads an Obsidian canon vault (configurable path, read-only by default). Recall: lexical search of active notes,
     relevant to the session's folder and prompt, injected as a bounded block before a turn. Cap the size, cite the note
     paths, and allow turning it off per session.
   - Capture writes a DRAFT note only (frontmatter `status: draft`, kind, source refs), into a configurable drafts folder.
     Promotion to active is never automatic: show a "Promote" action that only a human can press, and that does nothing
     unless the plugin config allows it.
   - In tests use a fixture vault copy. Never write into a real vault.
6. **Recall** (`plugins/recall`). Search everything we already did.
   - Full-text index over DSH session files (`.jsonl.zstd`), optional coding-agent transcript folders, and Markdown
     handoff folders (all paths configurable).
   - Incremental, local, fast (target < 300 ms per query on 10k sessions; measure it). Results link back to the exact turn.
   - Filters (folder, model, date, kind) and a `recall_search` tool so agents can use it too.

**Suite rule:** Autopilot, Decisions and Agent Terminals share one watcher core (session state + events). Put it in one
shared internal package, or one plugin with a clean API the others use. Do not run three pollers.

## Bar (what 9/10 looks like here)
- Look: it follows `DESIGN.md` (glass, DSH's own components, light and dark). It never hides or rearranges another plugin's UI.
- Words: plain words, no jargon, every empty state and error says what to do next.
- Reliability: no unhandled throw ever fails a host call (see the a18b87b news-sink lesson). Every side effect is logged. The
  config is validated with clear errors.
- Proof: real-DSH e2e tests per plugin in a DSH Test instance on both installed DSH versions if two are available (the
  coordinator e2e pattern), host unit tests, and screenshots light and dark.
- Docs: a README per plugin (what it does, config table, how to switch it off, rollback) and one suite README.
- No Claude/Anthropic branding anywhere in code, UI text, READMEs or commit messages (global AGENTS.md rule).

## Scoring (the gate)
- An **independent judge** scores each plugin. The judge is a fresh thread or subagent that did not write the code. It
  builds the head in a DSH Test instance, exercises the plugin, takes screenshots light and dark, and scores from 0 to 10 on:
  usefulness to this stack, reliability/robustness, UX/visual polish, test depth, and docs. The plugin score = the minimum of
  the usefulness and reliability scores and the mean of all five. A plugin passes only at >= 8.5 with no criterion below 8.
- The scorecards go in `review/<plugin>-round-N.md` with screenshots in `review/<plugin>-round-N/`. Fix, then re-judge with a
  new judge each round.
- Keep `review/SCOREBOARD.md`: plugin, round, scores, commit, verdict.

## Testing rules (hard)
- Test ONLY in DSH Test instances: `~/.local/bin/dsh-test` (README `~/Projects/dsh-test-harness/README.md`). Use named
  instances (`dsh-test --name suite-<plugin> ...`) so plugins can run in parallel. Restart, reset or destroy them freely.
- NEVER load suite code into the live DSH (`~/.dsh`, `~/.dsh-plugins`, the running DeepSeek Harness.app, pid in
  `dsh-test fingerprint`). Never restart, quit or edit the live DSH. Never point a plugin config at `~/.dsh`. Before and
  after each test run, `dsh-test fingerprint` must show the same live pid and `cordis.patch.yml` sha256. Log it in
  PROGRESS.md.
- Discord and dsh-site stay off in DSH Test. Decisions' outbound mirror is tested against a local fake sink only.
- Models in DSH Test: `GLM-5.3-Flash-EXL3` through the owner gateway (already wired by dsh-test). Do not use DeepSeek models.

## Standing approvals (Albert, quoted above; no stop for any of these)
- Create plugins, branches, commits and pushes on `suite/v1` in `bertholomus/deepseek-plugins` (private). Push after every
  meaningful step.
- When a plugin passes the gate: merge `suite/v1` into `main` of that private repo (fast-forward or merge commit, never
  force-push) and tag `<plugin>-v1.0.0`. When all six pass: tag `suite-v1.0.0`.
- Create, restart, reset and destroy DSH Test instances. Install npm dev dependencies inside the worktree.
- Push from the Mac over ssh with: `PATH=/opt/homebrew/bin:$PATH git -c credential.helper= -c credential.helper='!gh auth git-credential' push gh suite/v1` (the keychain helper fails over ssh).
- Not approved (out of scope, do not do): loading into live DSH, public repos/npm publish, posting to Discord, retiring any
  Hermes cron, touching Ascents/gateways/lanes.

## No blockers
- Never end a turn on a question. For any open choice, pick the option that best fits this brief and write it as one line in
  `OPEN-QUESTIONS.md` (question, your pick, why), then keep going.
- If something outside the repo is truly broken (for example a DSH Test bug), write it in `OPEN-QUESTIONS.md`, work around it
  inside the repo, and continue with the next plugin.
- Only these end the goal early: all six published, or a hard wall written as `BLOCKED: <what>` after every other plugin
  is done.

## Delegation (save Opus usage)
- Do judgment, design and review yourself. Send reading, fixture building, first-draft tests and mechanical edits to local
  helpers: `dshlane run auto --shape <shape> --project dsh-plugin-suite` (skill `~/.claude/skills/dsh-lanes`). Run several
  at once. Helpers are work sessions, not tests: they never load suite code into the live DSH.
- Use subagents for the independent judge.

## Record keeping (two-account rules in AGENTS.md apply)
- `HANDOFF.md` on this branch: update and push after every step (usage can cut at any time).
- `PROGRESS.md`: one line per step with Pacific time (`TZ=America/Los_Angeles date`), what changed, test counts, and the
  live fingerprint check.
- End when done with `DONE: <scoreboard path> <main commit> <tags>`.

## Reference (read first, real code and real failures)
- Repo `DESIGN.md`, `AGENTS.md`, `README.md`; plugin patterns in `plugins/coordinator` (e2e, sandbox, store, window),
  `plugins/notifications` (sink), `plugins/session-bridge` (host sessionController API).
- MiniMe's bridge plugin `~/.dsh-plugins/minime-bridge` (read only: sessionController calls, terminals, retain).
- Mac scripts: `~/.local/bin/dshb`, `~/.local/bin/dshlane`, `~/.local/share/dsh-tools/cc_signal_hook.py`, `~/.dsh/AGENTS.md`.
- Skills on the Mac at `~/.claude/skills/dsh-lanes/SKILL.md`. MiniMe's DSH notes and scripts (outside the repo, not to be committed:
  `~/Projects/dsh-plugin-suite-ref/`) explain the session API, events, terminals, schedule store, model catalog, and every
  pitfall.
- Catalog of community plugins (for comparison, so we beat them): `https://awesome-dsh-plugin.com/plugins.json`.
