# Agent Terminals: judge round 4

Commit 44ce483 (branch goal95/agent-terminals), judged 2026-10-26, 2:10 to 2:50 PM PDT. DSH Test instance g95-agent-terminals-j1 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.5 | Every job in its brief section works in a real DSH with stand-ins of all four kinds: a session listed and a terminal tab beside it, resume after restarts with the right id and way, paste then Enter, Enter again when swallowed, proof from the agent's own transcript, its state on the row, in the hover card, in the panel badge and in Decisions, with answers proven; it replaces the term-new and raw-Enter workarounds outright. |
| Reliability | 9 | Held through five restarts (two in a row, one inside a first turn, one ended by dsh-test's kill), a quoted number, Session Watch and `enabled` switched while DSH ran, Stop, Start again, Start anew, Forget and a closed tab; but a repeated message is "delivered" on the earlier message's transcript line, and I lost one across a restart while its card said delivered. |
| UX / polish | 9 | DSH's own parts and settings form, glass cards light and dark, 760 px with nothing off the side, a 2 px ring on every stop, plain words, and every failure says what to do next; but its listing turn can put a junk card in Decisions, two whys name the wrong cause, `enabled: false` hides agents that still run, full paths show where people read, and a transcript-less agent spins on its row for ever. |
| Test depth | 9 | 66 unit tests of its own and 148 real-DSH checks on each of three builds, all green, each claim proven from the stand-ins' transcripts, two restarts in a row, a restart inside a first turn and every quit within its grace; but every proof uses a unique message (Finding 1 slips through), the listing turn is never run against a real model, the plugin itself is never switched off and on in Plugins, and Wallpaper on and off is not pictured. |
| Docs | 9.5 | A complete README that matched the code in nearly every claim I checked (the four ways, the page, the row, settings with ranges and where they live, files, setup, switching off, rollback with a tag that now exists, limits, and the tests with their real size: 148 checks; a build took 4.8 to 6.5 minutes here on a busy Mac against its "four to five"); one paragraph promises cards under "switched off" that `enabled: false` does not show. |

Plugin score: min(U, R, mean) = min(9.5, 9, 9.2) = 9. Verdict: NOT YET (the GOAL95 bar is 9.5 with no criterion below 9).

## What I ran

- **Build.** `git archive 44ce483 | tar -x` into `~/Projects/goal95/judge/agent-terminals-r4/head`, `.e2e` linked. `node scripts/sync-shared.mjs --check` exits 0.
- **Unit tests.** `npm test`: 853 tests, 849 pass, 0 fail, 2 skipped, 2 todo (114 s). Agent Terminals' own (`test/agent-terminals.test.js`, `test/agent-terminals-client.test.js`): 66 of 66.
- **Real-DSH e2e.** `node scripts/e2e.mjs agent-terminals`: 148 of 148 on DSH 0.2.0-rc.2 (290 s), 0.2.1-rc.1 (377 s) and the installed app's 0.2.1-rc.3 (391 s); every quit of DSH ended within its grace (0.1 to 2.4 s); its own fingerprint check said the live DSH was unchanged. I read its checks: they test what they name, from transcripts, `ps`-level arguments, Decisions' log and the window.
- **My instance.** `dsh-test --name g95-agent-terminals-j1 up`, Session Watch, Decisions and Agent Terminals loaded from my head in that order (row `proofSeconds: 8`), a restart, `doctor`: 0 import errors, isolation ok. Before any turn I set the instance's `defaultPreset` to `workspace-write`; every session read Workspace Write and no full-access turn ran. The window was driven by small Playwright scripts in my scratch folder (the harness's `openWindow` and `shot`), at 1280 and 760 px, light and dark.
- **Stand-in agents only.** Wrappers in my scratch folder around `test/e2e/fake-agent.mjs`: `standin` (flags), `standin-swallow` (flags with `--swallow-enter`), `standin-events` (subcommand), `standin-plain`, and `standin-continue` (started the continue way), each keeping its data in my scratch folder. The instance's terminals take the login shell's PATH, which I may not change, so I gave each program as its full path (which also exercises the path check). The start form listed three real coding-agent programs under "Found on this computer"; I started none and they are masked in the pictures.
- **The real model** answered the listing turns of six new sessions (one cut by a restart) and one `dsh-test prompt` in a plain session ("ready", 35 s).
- **Each claim checked at its source**: `ps` for each program's arguments, the stand-ins' transcript files, Agent Terminals' `state.json` and log, the session bridge's session list, and dsh-test's event log for each restart.

What I exercised:

- **Start, type, prove.** Five agents from the page, one per kind, each in a new session named after it: first messages proven from the transcripts (Swallow's two lines as one paste, "Enter pressed 2 times"), Plain and Cont *typed in* with why. Each session was listed after its listing turn; opening Alpha's session opened its terminal tab ("Alpha", beside Chat and Trajectory) showing the agent's screen.
- **Questions and approvals.** An `#ask` reply made Alpha *waiting on you*; the panel badge said 1; Decisions had one card (name, question, recommendation, Go with the recommendation, own words). Answered there, it was typed into Alpha's terminal, proven, and Decisions' log turned it *delivered*. An `#approve` tool call made Events *waiting on you* after 20 s ("It asks to run “touch approved.txt”", answer in its terminal), and a follow-up was held with why and *Take back*.
- **Restart 2:21:49 PM (clean)** with Alpha ten minutes into a job and Events' approval open with a message held: Alpha came back with `--resume <same id>`, Swallow `--swallow-enter --resume <same id>`, Events `resume <same id>`, Cont `--continue`; Plain was not started again and said why. Each cut job was logged once, both agents read *idle*, the held message went in once and was proven, and nothing of Events stayed in Decisions.
- **Settings while DSH ran.** `proofSeconds: "8"` written into the profile: the page named the setting, its range and its value, every agent read "Running in its terminal, not followed" with only *Open its terminal*; the form flagged it ("It is saved as text, in quotes …"); typed as 8 and saved once, the profile held the number and the agents were picked up in place (same processes). Session Watch switched off and on in the profile, and `enabled: false` and back: each time the page said why and what to do, the programs kept running (same pids), and they were picked up in place.
- **The page's actions.** Stop, then Start again (`--resume <same id>`), Start anew offered; Forget asks first with focus on *Keep it* (Keep it changes nothing, Forget it removes the card); closing Events' tab ended it, said so, and Start again resumed it (`resume <same id>`). **Start a coding agent here** from the ⋯ menu of a plain session (the one `dsh-test prompt` made): focus on Program, that session chosen; it started there and its first message was proven. A path that is not there was refused before any session was made; a name the shell cannot find was *Could not start* (exit 127, what to do) with no listing turn.
- **Round 3's cases.** Probe, a flags agent with no message, through two restarts in a row (2:39:13 and 2:40:05 PM), the first while its listing turn ran: back each time with `--session-id <same id>` and *idle*; its listing turn settled ("did not finish … The turn was stopped, as DSH quit"), nothing left *sending*; Alpha's job cut by the first restart was logged once across both.
- **Repeated messages.** Two identical messages back to back to Alpha, with `typeWhileWorking` off (correct) and on (Finding 1), then a restart before the agent read the second. A double-click on Send queued one message.
- **The rest.** Every agent's row had its mark with the state in words (running, stopped, idle), the hover card and the ⋯ item; the empty page; the 760 px window (the page's `scrollWidth` equals its width, nothing wider than its box); a Tab sweep from the header (eight stops, each with a 2 px solid ring); light and dark. At the end I stopped and forgot every agent (no stand-in process left) and destroyed the instance.

## What I saw (each picture, one line)

- `01-empty-light.png`, `02-empty-dark.png`: no agents: what to do, *Start a coding agent*, and the form (the real programs found are masked).
- `03-alpha-started-light.png`: after the first start: the form reset, and *What happened* with the start, the message, its proof and the listing turn *sending*.
- `04-alpha-asks-light.png`, `05-alpha-card-asks.png`: Alpha *waiting on you*: the question, the recommendation, *Go with the recommendation*, a box named "Your answer".
- `06-decisions-with-agent-ask-light.png`, `07-decisions-with-agent-ask-dark.png`: Decisions with Alpha's card "from Agent Terminals"; the panel badges.
- `08-decisions-answer-delivered-light.png`: Decisions' log: the answer *delivered*, "Its transcript shows it".
- `09-events-tool-call-waits.png`: Events waits on a tool call ("touch approved.txt"); the follow-up held with why and *Take back*.
- `10-page-before-restart-light.png`, `11-page-before-restart-dark.png`: the page before the restart, Alpha *working* on its long job.
- `12-page-after-restart-light.png`: after the restart: Alpha *idle* with the cut job said once, Cont *running* resumed.
- `13-sidebar-marks-light.png`: every agent's row with its mark.
- `14-row-hover-light.png`: Alpha's hover card: "Coding agent in its terminal: idle" and its cut job; Cont's row spins (Finding 5).
- `15-row-menu-light.png`: Alpha's ⋯ menu: *Open the coding agent's terminal* first, DSH's items kept.
- `16-session-with-terminal-tab-light.png`, `17-session-with-terminal-tab-dark.png`: Alpha's session with its terminal tab beside it, the resumed stand-in on screen.
- `18-wrong-setting-light.png`, `19-wrong-setting-dark.png`: `proofSeconds: "8"`: the banner with the setting, its range and value; agents "not followed" with only *Open its terminal*.
- `20-settings-form-flags-quoted-light.png`: the settings form flags the quoted number in red and says what to type; one *Use the default* style.
- `21-session-watch-off-light.png`: Session Watch off: "Agent Terminals needs Session Watch, which is not running", with *Open Session Watch in Plugins* and *Check again*.
- `22-narrow-760-light.png`, `23-narrow-760-dark.png`, `24-narrow-alpha-card-dark.png`: 760 px with DSH's rail: header and cards fit.
- `25-narrow-focus-ring-light.png`: the keyboard sweep's last stop with its ring.
- `26-stopped-card-light.png`: Swallow stopped: "You stopped it. Start again resumes its conversation.", with *Start again*, *Start anew*, *Forget*.
- `27-forget-asks-light.png`: Forget asks first ("Its session and its conversation files stay"), *Forget it* and *Keep it*.
- `29-duplicate-message-proof.png`: two identical messages with typing while working off: the second waited, then was proven (correct).
- `30-duplicate-message-proof-typewhileworking.png`, `31-duplicate-before-restart.png`: with it on: both *delivered* at once (Finding 1).
- `32-duplicate-lost-after-restart.png`: after the restart both still read *delivered*; the transcript holds the message once (Finding 1).
- `33-enabled-false-light.png`: `enabled: false`: the off note and *What happened*, no agent cards while four programs ran (Finding 4).
- `34-enabled-back-on-light.png`: back on: the same agents picked up in place.
- `35-bad-path-refused-light.png`: "Not started: There is no program at …: check the path, and that the file is executable." (focus on the line).
- `36-could-not-start-card-light.png`: a name the shell cannot find: exit 127, "Use its full path …", *Start again* and *Forget*.
- `37-menu-start-here-light.png`: a plain session's ⋯ menu with *Start a coding agent here*.
- `39-after-two-restarts-light.png`, `40-after-two-restarts-dark.png`: after two restarts in a row: Probe *idle* under its id, Alpha's cut job said once.

## Round-3 findings, checked at 44ce483

1. **A `flags` agent that never got a message does not come back: fixed.** Probe came back after two restarts in a row with `--session-id <same id>`, *idle*, and *What happened* said why ("It had no conversation to resume yet …, so it starts again under the same id"). The e2e adds Stop, Start again and a closed tab for it.
2. **A cut job logged again at each restart: fixed.** Two restarts in a row, one entry for Alpha's cut job; the e2e checks the same.
3. **A listing turn cut by a restart stays "sending": fixed.** Probe's turn, cut by the 2:39 restart, reads "Its session's first turn did not finish … The turn was stopped, as DSH quit. The session is listed in the sidebar all the same."; none was left *sending*.
4. **Nits.** Fixed: "Used here before" chips now differ (each shows its way and its conversations folder); *Send again* exists for a failed or not proven message (read in `lib/client.js`, not triggered); Start anew's status line says "anew, with a new conversation" (read in the code); control characters other than tab and line breaks are removed (`plainMessage`, `lib/typist.js` line 49); the rollback tag `agent-terminals-v1.0.0` exists; the continue way runs end to end (e2e and my instance); the e2e fails a quit that needs a kill (none did); one *Use the default* style (picture 20). Not checked by me: a forgotten agent's queued message closed (the unit tests name it; my forgotten agents had none). Still seen once and not tied to Agent Terminals: one of my five restarts (2:39:44 PM, with a real-model listing turn and a stand-in job running) did not quit within dsh-test's grace and was killed; recovery after it was right.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Major, in a rare path: a repeated message is proven by the earlier message's transcript line, and can be lost across a restart while it reads *delivered*.**
   - Where: `lib/transcripts.js` `provenIn()` (line 329): any user entry with `at >= since - 2000` whose squeezed text contains the message's first 160 characters proves it, and nothing credits an entry to one message only. `deliverOne()`, `lateProof()` and `lostWithRestart()` in `lib/agents.js` all use it.
   - What I saw: with `typeWhileWorking` on, "dup two #work=6000" sent twice back to back to Alpha. The second was typed at 21:30:37.232Z and marked *delivered* at once with `provenAt` 21:30:36.948Z, the first message's transcript line; the stand-in read it at 21:30:42.953Z. Again with "dup three #work=90000" and a DSH restart at 2:31:30 PM before the stand-in read the second: after the restart its transcript has that message once, the second was never typed again (`lostWithRestart` retypes only *typed* messages), and the card still says both *delivered* "Its transcript shows it" (pictures 30 to 32). The same window opens with `typeWhileWorking` off for an agent that answers within 2 s, and for a message whose text is inside the one before ("run the tests" after "fix the build, then run the tests"). It takes two sends: a double-click on Send queues one message.
   - Fix: credit each transcript user entry to at most one message, oldest message first (keep the matched entry's uuid or line on the delivery and skip entries already credited), and let the 2 s slack apply only to an entry no earlier message claims. Tests: two identical messages with `typeWhileWorking` on (the second proven only by the second entry), a contained message, and a restart before the second is read (typed again once, proven).
2. **Minor: the listing turn can put a junk card in Decisions with a real model.**
   - Where: `lib/agents.js` `firstTurn()` (line 792): "… Reply with one short line to say you see it; there is nothing else to do."
   - What I saw: of the five listing turns GLM-5.3-Flash-EXL3 finished, Cont's reply was "I see the coding agent running in this terminal. DECISION NEEDED: none — nothing else to do.", and Decisions showed "needs a decision · Cont · none — nothing else to do" with a box that would send an answer to the session's model, until the end of my run. Models on this stack are told to end with such a line when they stop for a human, so the owner's DSH will see this too; the e2e's scripted model cannot.
   - Fix: say in the note that nothing waits on anyone and not to write a DECISION NEEDED line, and keep the listing turn out of Decisions (for example a mark on that turn that Session Watch or Decisions skips, or Agent Terminals dismissing a card from it). Check it once with the real model.
3. **Minor: two whys in *What happened* name the wrong cause.**
   - Where: `lib/index.js`, `OFF_WHY`, used whenever the Session Watch scope or DSH's terminals go away.
   - What I saw: Session Watch switched off in the profile (about 2:26 PM) and `enabled: false` (about 2:33 PM) were each logged as "Agent Terminals stopped following its agents. Why: Switched off in Plugins, or DSH is quitting." Neither happened (for `enabled: false` the next entry says it right).
   - Fix: pass the cause to `stopFollowing` (Session Watch stopped; DSH's terminals stopped; its settings changed in the profile; switched off or DSH quitting) and say that one.
4. **Minor: `enabled: false` hides agents that still run.**
   - Where: `AgentsPage` in `lib/client.js` draws no agent cards while it is off; the README says "While Agent Terminals is switched off or waits for a setting … Each card says *running*, not followed, and why, and offers only **Open its terminal**".
   - What I saw: four stand-ins kept running (the same pids before and after) while the page showed only the off note and *What happened* (picture 33); their rows lost their marks too.
   - Fix: show the cards as for a wrong setting (running, not followed, *Open its terminal*), or say in the README what the page shows.
5. **Nits.**
   - Full paths where people read: *What happened* says "You started /Users/…/bin/standin in /Users/…/ws/a, in a new session.", and "Used here before" shows the program and conversations folder in full, while the card says "standin · in a" (DESIGN.md section 9). Show `~/…`, or the short name with the full path on hover.
   - An agent without a transcript (continue, plain) shows DSH's working spinner on its row for as long as it runs (`dotOf()` maps *running* to `ongoing`), though Agent Terminals cannot know whether it works (picture 14, Cont). Use the terminal glyph for *running*.
   - Stop is logged as "Stopped Swallow · You. Why: Its terminal was closed, which ends the program in it.", which reads as if the tab was closed: say "You stopped it; its terminal closed".

DESIGN.md's "Before you push" list for this plugin's UI: surfaces sit right (its page an unpainted root with glass cards, nested cards flat, row marks and menu items without a ground) ✓; only DSH tokens and `--wp-blur`, `--wp-tint`, `body.wp-still` ✓; no DSH hash selector, nothing on `:root`, `html` or `body`, no `:has()` ✓; motion stops under `wp-still` and reduced motion, and glass thickens under reduced transparency (in its CSS) ✓; `node --check` on the client and `npm test` with the naming scan pass ✓; both DSH versions (e2e on three builds) and both themes ✓, Wallpaper on and off not checked (no picture here or in the e2e); off leaves nothing behind and on again repeats nothing (its row marks left with Session Watch off and with `enabled: false`, and came back; the same processes were picked up, none started twice) ✓; Agent Terminals itself switched off and on in Plugins not tried by me, and not by the e2e either (it takes a wrong setting as the stand-in for that pick-up; DESIGN.md section 10 asks for the plugin on, off and on again beside the neighbour); round 3 did it at 3290a42.

## What would make it a 9.5

1. One message, one transcript line: the fix and tests in Finding 1.
2. The listing turn never reaches Decisions, checked once with the real model (Finding 2).
3. The right cause in every why, agent cards (not followed) under `enabled: false`, short paths, and a steady glyph for a running agent without a transcript (Findings 3 to 5).
4. In the e2e: Agent Terminals itself off and on in Plugins beside the neighbour, with agents running; and pictures with Wallpaper on and off over a light and a dark picture at a low tint.

## Live DSH fingerprint (before and after)

| When | pid | Started | Patch sha256 |
| --- | --- | --- | --- |
| Before (2:10 PM PDT) | 43210 | Mon Oct 26 07:14:47 2026 | f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55 |
| After (2:46 PM PDT, my instance destroyed) | 43210 | Mon Oct 26 07:14:47 2026 | f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55 |

Unchanged. My private copy of the live profile from the start matches the one at the end line for line, and the e2e's own check said unchanged on each build. At the end no stand-in or window of mine was running, `g95-agent-terminals-j1` was destroyed (2:46 PM) and my slots were given back.
