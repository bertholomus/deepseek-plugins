# Agent Terminals: judge round 3

Commit 3290a42 (branch suite/v1), judged 2026-10-17, 9:40 to 10:40 AM PDT. DSH Test instance suite-agent-terminals-j3 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9 | Every job in its brief section works with stand-in agents, on the straight path and through clean and killed DSH restarts, pick-ups after a cut, swallowed Enters, Decisions answers and approval prompts; the one gap is narrow: a `flags` agent that never got a message does not come back after a restart or a stop. |
| Reliability | 8.5 | Both round-2 majors are fixed and held through four restarts (two of them ended by a kill), three kinds of pick-up and an answer lost to two restarts in a row, and every "delivered" I checked is in the agent's own transcript; but a message-less `flags` agent is relaunched with a resume its program refuses while *What happened* first says it started again, a cut job is logged again at each restart, and first-turn entries cut by a restart stay "sending". |
| UX / polish | 8.5 | The round-2 misses are fixed (Escape on Forget, a message box named per agent, the form kept after a failed start, waits in steps), with glass light and dark, 760 px, a 2 px ring on every stop and plain words; but a failed resume tells you to press the button that fails again and points at a terminal that is gone, *What happened* keeps stale "sending" and "queued" entries, and two *Use the default* styles and look-alike "Used here before" chips remain. |
| Test depth | 8.5 | 56 unit tests of its own (614 in the repo) and 129 real-DSH checks on three builds, all green, with a step for each round-2 finding and every claim proven from the stand-ins' transcripts; but nothing starts an agent without a message and then restarts or stops it, restarts twice in a row, or restarts inside a first turn, the `continue` way never runs, and no stop checks that DSH quit cleanly. |
| Docs | 8.5 | A complete README (the four ways, page, row, settings table with ranges, files, setup, switching off, rollback, limits, tests) that matches the code almost everywhere; but it says every running agent resumes after a restart, that a cut job is logged once and that the first turn is noted when it ends, and its rollback names a tag that does not exist yet. |

Plugin score: min(U, R, mean) = min(9, 8.5, 8.6) = 8.5. Verdict: PASS.

## What I ran

- **Build.** `git archive 3290a42 | tar -x` into my folder (`~/Projects/dsh-plugin-suite-judge/agent-terminals-r3/head`), `.e2e` linked to the builder's DSH installs; `plugins/proof/` and `test/fixtures/proof/` ignored. In the builder's tree I wrote only this scorecard, its pictures and one scoreboard row.
- **Unit tests.** `npm test`: 614 of 614 pass (88 s). Agent Terminals' own: 39 host tests and 17 page tests.
- **Real-DSH e2e.** `node scripts/e2e.mjs agent-terminals`: 129 of 129 on DSH 0.2.0-rc.2 (186 s), 0.2.1-rc.1 (188 s) and the installed app's 0.2.0-rc.2 (180 s); its own check said the live DSH was unchanged after each. I read its steps (`plugins/agent-terminals/test/e2e/run.mjs`).
- **My instance.** `dsh-test --name suite-agent-terminals-j3 up`, then `defaultPreset: workspace-write` in its profile (the seed's full-access preset was never used); Session Watch, Decisions and Agent Terminals loaded from my build, a restart, `doctor` clean (isolation ok). The window was driven with Playwright (the e2e's Chromium) through a small driver in my scratch folder, at 1280 and 760 px, light and dark.
- **Stand-in coding agents only.** Wrappers in my scratch folder around the builder's `test/e2e/fake-agent.mjs`: `standin` (the `flags` way), `standin-events` (the `subcommand` way), `standin-plain`, and `standin --swallow-enter`, each keeping its conversations in my scratch folder. The start form listed three real programs under "Found on this computer"; I started none, and their names are under grey boxes in the pictures. I read no real transcripts.
- **Every claim checked at its source**: the stand-ins' transcript files (each message once as a user entry), `ps` for each program's arguments (`--session-id <id>`, `--resume <id>`, `resume <id>`), the terminal screens, *What happened*, Decisions' state and log, and dsh-test's events log for each restart.

What I exercised, with the real model behind the sessions:

- **Start, type, prove.** Five agents from the page, each in a new session named after it with its terminal tab beside it (App agent, Swallower with `--swallow-enter`, Approver, Events agent in the `subcommand` way, Plain one); each first message proven from the agent's own transcript (Swallower's after "Enter pressed 2 times"), and Plain one's, which keeps none, *typed in* with that said. Cmd+Enter sends; a two-line message went in as one paste (one transcript entry, two lines).
- **Questions and approvals.** A `DECISION NEEDED` reply made Swallower *waiting on you* with one Decisions card; answers sent from Decisions were typed in and proven, and Decisions turned them *delivered* "after Enter 2 times". A tool call waiting 20 s made Approver *waiting on you* with a Decisions card (*Answer in the session*) and held the next message ("Held while a tool call waits in its terminal …"); one held message I took back (never typed), I answered `1` in the agent's tab, and the other held message went in after and was proven; the Decisions card left.
- **Restarts** (times from dsh-test's events log). 9:50:39 with jobs running, `typeWhileWorking` on and messages typed during the jobs, an approval prompt open with a message held behind it, and a Decisions answer whose Enter was swallowed; DSH did not quit within dsh-test's grace and was killed at 9:51:10. 10:02:43 (killed again) and 10:03:00 (clean), two in a row while an answer waited for its proof. 10:22:12 (clean, 5 s) with an agent 8 s into a ten-minute job.
- **Pick-ups after a cut.** Agent Terminals off and on in Plugins, Session Watch off and on, and a wrong `proofSeconds: 500` saved in the profile, then fixed in the form (10:05 to 10:08).
- **The page's actions.** Stop; Start again (`--resume <same id>`; the next message went into the same file); Start anew (`--session-id <new id>`, a new file); closing a terminal tab; Forget (asks first; Escape and *Keep it*); a program the shell cannot find; a `~/…` program; **Start a coding agent here** from a session's ⋯ menu (it started in that session and its first message was proven); the row's mark, hover card and menu; *Its screen now*.
- **Agents with no first message.** Probe and Probe two (`flags` way) through the 10:02 and 10:03 restarts, Start again, Start anew and a closed tab: Finding 1.
- **Window timing.** A message's transcript entry showed on its card 0.65 s after the stand-in wrote it, and its reply 0.8 s after.
- **The rest.** The empty page, Session Watch off, Agent Terminals off, its settings form (only changed values written), a 760 px window (nothing wider than the page), the page, a card and *What happened* in dark, and the keyboard: Tab reached every control on the page in order, each with a 2 px focus ring, and each message box is named after its agent.

## What I saw (each picture, one line)

- `empty-light.png`, `empty-dark.png`: no agents yet: what to do, and the start form (the three real programs found on this computer under grey boxes).
- `start-form-filled-light.png`: the start form filled for the first stand-in: program, the `flags` way, its conversations folder, folder, name and first message.
- `session-with-terminal-light.png`: App agent's session with its terminal tab beside it after a restart (`--resume <id>`, "Resumed conversation", the message typed during the job answered); its first turn, cut by my 9:50 restart, shows no reply.
- `before-restart-light.png`: before a restart: Approver *waiting on you* at `touch approved.txt`, a message held behind it with *Take back*; "5 running, 2 of them waiting on you".
- `decisions-before-restart-light.png`, `decisions-before-restart-dark.png`: Decisions with the approval card and Swallower's question with its recommendation.
- `decisions-answered-light.png`: just after an answer in Decisions: "Answered. It goes into “Swallower”'s terminal when the agent is ready, and counts as delivered once its transcript shows it."
- `decisions-answer-lost-light.png`: an answer lost to two restarts in a row: the question back in Decisions, the answer *not delivered* with why and "Send it again".
- `plugin-off-light.png`: Agent Terminals off in Plugins: its sidebar entry and row marks gone, the agents still running.
- `session-watch-off-light.png`: Session Watch off: "Agent Terminals needs Session Watch, which is not running", with *Open Session Watch in Plugins* and *Check again*.
- `wrong-setting-running-light.png`: `proofSeconds` 500: the banner names the setting, its range and value; running agents read "Running in its terminal, not followed", with only *Open its terminal*.
- `wrong-setting-form-light.png`: the same field in red with what fits; the two *Use the default* controls in different styles.
- `settings-form-light.png`: Agent Terminals' settings in Plugins, in DSH's own form.
- `probe-after-restart-light.png`: Probe (no first message) after the 10:02 restart: *stopped*, "It exited with code 1. Its terminal shows why. Start again resumes its conversation." (Finding 1).
- `probe-start-again-light.png`: *Start again* on it: "Not done: It could not start: It exited with code 1 …" (Finding 1).
- `probe-screen-light.png`: *Its screen now*: `exec …/standin --resume <id> || exit $?`, then "No conversation found with session ID: <id>" (Finding 1).
- `failed-start-form-light.png`: a name the shell cannot find: the form keeps Program, Name and First message and says why and what to do; "Used here before" lists only programs that ran.
- `forget-question-light.png`: *Forget* asks first ("Its session and its conversation files stay"), focus on *Keep it*.
- `stopped-card-light.png`: an agent I stopped: "You stopped it. Start again resumes its conversation.", with *Start again*, *Start anew* and *Forget*.
- `approval-held-light.png`: Approver waits on a tool call; a message sent meanwhile is held, with why and *Take back*.
- `approval-answered-terminal-light.png`: the prompt answered with `1` in the agent's tab; the job ended and the held message went in after.
- `row-menu-start-here-light.png`: a session's ⋯ menu with **Start a coding agent here** first and DSH's own items kept.
- `row-hover-light.png`: the row's hover card: "Coding agent in its terminal: idle", its last reply, and DSH's own "Idle" under it.
- `agents-page-dark.png`: the page in dark: "6 running, 1 of them waiting on you · 3 stopped", Swallower's question back, the lost answer *failed* with why.
- `approver-card-dark.png`: Approver's card in dark: last reply, *delivered* and *taken back* messages, its box.
- `what-happened-dark.png`: *What happened* in dark: a failed start with why, messages delivered and taken back, and a forgotten agent's first message still *queued*.
- `narrow-760-light.png`, `narrow-760-card-light.png`: 760 px: the header and a card; nothing runs off the side.
- `focus-ring-button-light.png`: keyboard focus on an agent's name: the 2 px ring.

## Round-2 findings, checked at 3290a42

1. **A restart loses a typed but unproven message or Decisions answer: fixed.** At 9:50:39 I restarted DSH with "Typed during the job" typed into App agent and "Typed during the events job" into Events agent while each worked (`typeWhileWorking` on, so the programs held them unread), and the Decisions answer "Restart answer: take the slow path" pasted into Swallower 21 s earlier (its first Enter swallowed). After the relaunch each was typed in again once and proven (9:51:14 to 9:51:15; each is once a user entry in its transcript), and Decisions turned the answer *delivered*, "after Enter 2 times". Lost to two restarts in a row (10:02:43, 10:03:00) before Swallower read it, the next answer turned *failed* ("DSH restarted twice before the agent read it, and each time its program ended with the message unread in its input line. Send it again."), *What happened* logged "A message for Swallower was lost", and Decisions marked it *not delivered* and brought the question back (the why is in Decisions' log, not on the card).
2. **A pick-up after a cut brings the stuck state back: fixed.** With App agent's ten-minute job and Approver's approval prompt cut by a restart, I switched Agent Terminals off and on in Plugins (10:05:20 to 10:05:33), switched Session Watch off and on, and saved `proofSeconds: 500` in the profile (10:05:49), then fixed it in the form (10:08:15). Each time both stayed idle with the cut job as their detail, held nothing, left nothing in Decisions, and the next message went straight in and was proven; `approved.txt` did not appear until I answered a later prompt myself.
3. **A `~/` program fails at launch: fixed.** `~/Projects/…/scratch/bin/standin` started, was kept as its full path, and its first message was proven.
4. **A failed start clears the form and keeps the failed program: fixed.** For `nosuchagent-j3` the form kept Program, Name and First message, said "It was added, but could not start: It exited with code 127 … The form keeps what you wrote …", moved focus to that line, and "Used here before" did not offer it.
5. **Switching off is not logged: fixed.** "Agent Terminals stopped following its agents" is logged when it is switched off in Plugins, when a setting goes wrong, and when DSH quits cleanly (10:22:08); not when DSH is killed, which is fair.
6. **The window lagged the host: not seen.** Card updates came 0.65 to 0.8 s after the transcript, and I saw no lag in the marks, badges or Decisions.
7. **Nits.** Fixed: Escape takes Forget's question back (focus returns to *Forget*); each box is named "Message to <agent>" or "Your answer to <agent>"; the settings form writes only what changed; a waiting call's detail moves in steps ("20 s or more", then minutes). Not fixed: the two *Use the default* controls still look different. Kept and now documented as intended: the hover card shows DSH's own "Idle" under the agent's state. Unchanged and documented in Limits: the reach into DSH's terminal controller and window storage, covered by the e2e on three builds.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Minor, the most serious this round: a `flags` agent that never got a message does not come back after a restart, a Stop or a closed tab.**
   - Where: `lib/agents.js`. `canResume()` (line 520) returns `Boolean(record.conversationId)` for the `flags` way, and that id is made at the start, before the program has written anything. `recover()` (lines 302 to 325) then runs `run(record, { resume: true })` and logs "Started <name> again after DSH restarted" as *done* without the `confirmStart()` that `startAgain()` uses (line 505). `exitWords()` (line 1383) and `againWords()` then say "Its terminal shows why. Start again resumes its conversation." The builder's own stand-in refuses such a resume (`test/e2e/fake-agent.mjs` line 98).
   - What I saw: Probe and Probe two, `flags` stand-ins started at 9:55 and 9:56 with no first message (their transcript folders stayed empty). At the 10:02:43 restart *What happened* said "Started Probe again after DSH restarted" (done) and, in the same second, "Probe stopped: It exited with code 1. Its terminal shows why. Start again resumes its conversation."; *Its screen now*: `exec …/standin --resume <id> || exit $?`, then "No conversation found with session ID: <id>". *Start again* failed the same way every time ("Not done: It could not start: It exited with code 1 …"); *Start anew* (`--session-id <new id>`) worked. Not only restarts: I started Probe anew, still without a message, closed its tab, and *Start again* failed the same way. The session then has no terminal at all, so "Its terminal shows why" points nowhere; only *Its screen now* on the card shows it. Nothing is lost (there was no conversation yet), but the card sends you to the button that fails.
   - Fix: in the `flags` way resume only when the transcript exists (`transcriptPath()`, or `findFlagsTranscript()`), else start again with `--session-id <same id>`, and let `againWords()` use the same test; confirm a relaunch after a restart with `confirmStart()` and log "could not start again" with its screen's last line instead of "Started … again"; say "Its screen below shows why". e2e: start an agent without a first message, restart DSH, then Stop and Start again, and close its tab and Start again; each must end running and idle.
2. **Minor: a cut job is logged again at every restart until a message is sent.**
   - Where: `prime()` (lines 792 to 817) logs "<name>'s job was cut off" whenever the transcript before `primedAt` ends in an open job, which it still does after a second restart.
   - What I saw: restarts at 10:02:43 and 10:03:00 with no message between: "App agent's job was cut off" at 10:02:45 and 10:03:02, "Approver's job was cut off" at 10:02:46 and 10:03:03. The README says *What happened* says which job was cut off "(once)"; the e2e restarts once per cut.
   - Fix: keep the cut entry's id or time in `state.json` beside `primedAt` and log only a new one; add a second restart to the e2e's cut step.
3. **Minor: a restart during a session's first turn leaves its entry "sending" for good.**
   - Where: `firstTurn()` (lines 674 to 704) waits for Session Watch's turn end or its 5-minute timer (`FIRST_TURN_MS`, line 47), both only in memory.
   - What I saw: the five agents I started at 9:47:57 to 9:48:29 had their first turns still running (the real model's first replies are slow) when I restarted DSH at 9:50:39; those turns ended with no reply, and all five entries still read "Giving its session a first turn · sending" at 10:20. Later first turns (9:55, 9:56, 10:08) ended in about 2 s (Probe's session: "I see the coding agent running in this session's terminal.") and were marked done. The README says the first turn "is noted in *What happened* when it ends"; the e2e checks only that the turns started equal those ended.
   - Fix: at start, settle any first-turn entry still "sending" from an earlier run (from the session's last turn, or "DSH restarted before its turn ended"); add a restart inside a first turn to the e2e.
4. **Nits.**
   - *What happened* keeps a forgotten agent's first message *queued* for good ("Message for Missing two · queued", `what-happened-dark.png`); close it when the agent is forgotten.
   - "Used here before" shows two chips that read the same (`…/scratch/bin/standin`, "Starts with --session-id, resumes with --resume"); they differ only in the conversations folder (`~/…` and its full path). Show the folder, or merge them after expanding `~`.
   - A *failed* or *not proven* message says "Send it again" but offers no *Send again*.
   - *Start anew*'s status line says "Started “Probe” again." (*What happened* rightly says "with a new conversation").
   - `messageKeys()` (`lib/typist.js` line 54) removes only Escape: for a program that does not ask for bracketed paste, a Ctrl-C or Ctrl-D pasted into a message would be typed as that key (read in the code; the stand-in always asks for paste). Remove control characters other than tab and line breaks.
   - The rollback command names the tag `agent-terminals-v1.0.0`, which does not exist yet (Autopilot, Decisions and Session Watch have theirs); say it is made when the plugin ships.
   - The `continue` way never runs end to end: only its arguments are unit-tested, and no stand-in speaks it.
   - Two of my four restarts with agents did not quit within dsh-test's grace and were killed (9:51:10, 10:02:43); two quit cleanly within seconds (10:03:00, and 10:22:12 with a job running). I could not tie this to Agent Terminals; recovery after both kills was right. The e2e's `stop()` kills after 20 s without failing a check, so it would not notice either way.

DESIGN.md's "Before you push" list, for this plugin's UI: surfaces sit right (glass cards on its own page, nested cards flat) ✓; only `--dsw-*` tokens, `--wp-blur`, `--wp-tint` and `body.wp-still` ✓; no DSH hash selectors, nothing set on `:root`, `html` or `body`, no `:has()` ✓; motion stops under `wp-still` and reduced motion, pseudo-elements included, and the glass thickens under reduced transparency ✓; `node --check` and `npm test` (with the naming scan) pass ✓; both DSH versions (e2e) and both themes ✓, Wallpaper on and off not checked by me; off leaves nothing behind and on again repeats nothing ✓ (a restart repeats a cut entry: Finding 2).

## What would make it a 9.5

1. Resume only what the program can resume: a `flags` agent with no transcript starts again under its id; a relaunch after a restart is confirmed like a start and says why it failed; e2e steps for a message-less agent through a restart, a Stop and a closed tab.
2. *What happened* says each thing once and closes what it opened: one cut entry per job across restarts, first-turn entries settled after a restart, a forgotten agent's queued message closed; e2e: two restarts in a row, and one inside a first turn.
3. A stand-in for the `continue` way, run end to end, and a harness stop that fails when DSH does not quit within its grace.
4. Polish: one *Use the default* style, distinct "Used here before" chips, *Send again* on a failed message, "Its screen below shows why", and the rollback tag.

## Live DSH fingerprint (before and after)

| When | pid | Started | Patch sha256 |
| --- | --- | --- | --- |
| Before (9:40 AM PDT) | 687 | Fri Oct 16 12:22:37 2026 | e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020 |
| After (10:23 AM PDT) | 687 | Fri Oct 16 12:22:37 2026 | e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020 |
| Read again while writing this (10:34 AM PDT) | 85738 | Sat Oct 17 10:31:48 2026 | bcebc8488711bbd5787b7f9d0bf101c8d3455854391e768a99b524a156c08021 |

Unchanged through all my testing: the read after it (10:23, once my instance was destroyed) matched the one before, and the e2e's own check reported it unchanged on each build. At the end I forgot every agent (no stand-in process left, nothing waiting in Decisions), stopped my window driver and its browser, and destroyed `suite-agent-terminals-j3` (`dsh-test destroy`).

**The live DSH changed afterwards, not by me.** Reading the fingerprint again at 10:34 showed a new pid, start time and patch: the installed app in `/Applications` was replaced by version 0.2.1-rc.2 at 10:31:41 to 10:31:47 (the bundle's file times) and relaunched by launchd at 10:31:48, eight minutes after my instance was gone. Nothing of mine was running then (no process from my instance or scratch folder), and I did not touch the live app before or after. The e2e above ran against the app's earlier 0.2.0-rc.2.
