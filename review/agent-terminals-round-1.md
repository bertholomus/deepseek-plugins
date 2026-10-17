# Agent Terminals: judge round 1

Commit 84af4a77f3fadf70f544bac5f557730619d912af, judged 2026-10-17, 6:22 to 7:06 AM PDT. DSH Test instance suite-agent-terminals-j1 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | Every job in its brief section works on the straight path: a terminal tab beside a listed session (new or existing), resume after a DSH restart with the same conversation, paste, Enter and swallowed-Enter retry with proof from the transcript, and status on the page, the row and in Decisions with answers typed back and proven; but a restart in the middle of a job or an approval leaves the agent unusable from DSH, which is the long-unattended case this stack runs. |
| Reliability | 7 | Its claims are disciplined (every "delivered" I checked is in the agent's own transcript, a program with no transcript says "typed in", restarts repeat no message, settings are refused in words, files are 600 in a 700 folder), but after a restart under work an agent stays "working" or "waiting on you" for ever and holds every message and Decisions answer; with `typeWhileWorking` on it presses Enter into a live approval prompt; and a "not proven" is never corrected. |
| UX / polish | 8 | DSH-native glass pages in both themes, clean at 760 px, a focus ring on every stop, row marks with screen-reader words, and errors that name the fix; but several states read wrong (running agents shown "stopped" while a setting is wrong, "Started" for a program that exits at once, a header that counts waiting agents twice), long program paths take three lines of each card, and Forget acts with no confirmation. |
| Test depth | 8 | 43 unit tests and 101 real-DSH checks on three builds, all green, that prove claims against stand-in transcripts, with pictures light, dark and narrow; but no step restarts DSH while an agent works or waits for approval, none combines `typeWhileWorking` with an approval, and the stand-in ignores Enter at its approval prompt, so "nothing lands in an approval prompt" cannot fail. |
| Docs | 8.5 | A complete README (what it does, how each kind of program starts and resumes, page, row, a settings table with ranges, files, setup, switch-off, rollback, limits, tests) that held almost everywhere I checked it; but it promises that nothing lands in an approval prompt (false with `typeWhileWorking` on) and says nothing about a job cut off by a restart. |

Plugin score: min(U, R, mean) = min(8.5, 7, 8.0) = 7.0. Verdict: NOT YET.

## What I ran

- **Build.** `git archive 84af4a7 | tar -x` into my folder (`~/Projects/dsh-plugin-suite-judge/agent-terminals-r1/head`), with `.e2e` linked to the builder's DSH installs. In the builder's tree I wrote only this scorecard, its pictures and one scoreboard row.
- **Unit tests.** `npm test`: 552 of 552 pass (32 s). Agent Terminals' own files hold 43 of them (29 host, 14 page).
- **Real-DSH e2e.** `node scripts/e2e.mjs agent-terminals`: 101 of 101 on DSH 0.2.0-rc.2 (99 s), on 0.2.1-rc.1 (98 s) and on the installed app's 0.2.0-rc.2 (99 s); its own fingerprint check said the live DSH was unchanged. I read its step list (below, under Test depth).
- **My instance.** `dsh-test --name suite-agent-terminals-j1 up`, then `defaultPreset: workspace-write` in its profile (the seed's full-access preset was never used: every session I made reads workspace-write). Session Watch, Decisions and Agent Terminals loaded from my build (beside the seed's session bridge), then a restart and `doctor`: import check 0 errors (2 warnings on DSH's own rows), isolation ok. The window was driven with Playwright (the e2e's own Chromium) at 1280 and 760 px, light and dark.
- **Stand-in coding agents only.** Wrappers named like programs (`standin`, `standin-swallow`, `standin-events`, `standin-plain`) in my scratch folder, outside my home, each running the builder's `test/e2e/fake-agent.mjs` with its style and a `STAND_IN_DATA` folder in that scratch folder. I gave each wrapper's full path as the program and its data folder as "Its conversations folder". The start form listed real programs under "Found on this computer" (it reads conversation folders in my home); I started none of them.
- **The real login shell.** The terminal opened the owner's zsh, which drew its prompt; Agent Terminals waited for it to settle and typed `exec <program> <arguments> || exit $?`. Nothing in the shell's startup changed the launch: every stand-in got exactly the arguments shown on its card (checked in `ps`).
- **Real transcripts, read-only.** I fed the newest real transcripts of both kinds on this computer through `lib/transcripts.js` (`entriesOf`, `foldEntry`, `statusOf`), printing only counts: 0 throws over 30k lines; every call matched a result; users, replies and (events kind) the conversation id were found. No content was read into this card.
- **Every claim checked at its source**: the stand-in's own transcript files, the plugin's `state.json` and `events.jsonl` (What happened), `ps` for the program and its arguments, the terminal's rows in the window, and the DSH session's chat.

What I exercised (all with the real model behind the sessions):

- **Start from the page in a new session.** "standin · app" in a new folder: a session named after it, listed in the sidebar after one turn of GLM-5.3-Flash-EXL3 ("I see it."), its terminal tab beside the session, the program started with `--session-id <id>`, and the first message proven from the transcript file named by that id.
- **Messages.** One typed in and proven. "Work for a while" (25 s of work), then a second message held with "The agent is working; this is typed in when it is idle", one taken back (it never went in), and the held one typed in once the agent was idle and proven. A two-line message went in as one paste and one transcript entry.
- **Swallowed Enter.** `standin-swallow` drops the first Enter after a paste: Enter went again after `proofSeconds`, "delivered, Enter pressed 2 times", once in the transcript.
- **DECISION NEEDED to Decisions.** A reply ending in a decision line made the card waiting on you, one Decisions card with its recommendation, and an amber row mark. *Go with the recommendation* and an answer in my own words were each typed in and proven ("Go with your recommendation: Yes, the fast path"; "Take the careful path, and write a test first").
- **Tool call waiting for approval.** After 20 s the call counted as waiting on you: on the page ("It asks to run …", *Open its terminal*), on the row, in the sidebar badge and in Decisions ("Answer in its terminal"). A message sent meanwhile was held with where to answer. I answered in the terminal tab; the tool ran, and the held message went in right after and was proven.
- **Start a coding agent here.** From the row menu of an existing session (made by `dsh-test prompt`): the form chose that session and put the cursor on the program; the events-kind stand-in started in that session's folder, its conversation id read from the dated file it made.
- **Programs with no transcript, and none at all.** `standin-plain`: messages "typed in", never "delivered", with why. `standin-nope`: exit 127 with "the shell could not find standin-nope. Use its full path …".
- **Terminal tab.** Opening the session opened one tab named after the agent; after a reload there was still one. Closing the tab ended the agent ("was closed"); *Start again* resumed the same conversation in a new terminal and a new tab.
- **Stop, Start again, Start anew, Forget.** *Stop* closed the terminal and the program ended (`ps`); a message sent to the stopped agent waited ("It waits until the agent runs again"); *Start anew* started a new conversation (new id, new dated file) and the held message was its first entry, proven; *Forget* removed the card at once and logged it; the session stayed.
- **DSH restarts.** First, with three idle agents: each came back in a terminal with the same id, with `--resume <same id>` or `resume <same id>` in `ps`, and the window's tab found it; the plain one was not started again and said why. Second, at 6:58:07, under work (Finding 1).
- **Wrong setting.** `proofSeconds: 500` in the profile: the page named the setting, its range and the value, offered *Open Agent Terminals' settings*, and the form put focus on the field; saving 8 brought the agents back, resuming.
- **Switched off and on in Plugins.** Its page, marks and menu item went and came back; the agents kept running and were picked up; nothing was typed or started twice. **Session Watch off**: the page said Agent Terminals needs it, with *Open Session Watch in Plugins* and *Check again*, and came back by itself when Session Watch did.
- **Empty instance, narrow window, themes, keyboard.** Empty: "No coding agents yet" with what to do. At 760 px the page's scroll width stayed 760. Light and dark both read well. Tab order follows the cards, every stop shows a 2 px ring (`:focus-visible`), DSH's row menu (*Session actions*) closes on Escape with focus back on its button, each row mark carries "Coding agent: idle." (or working, waiting on you) for screen readers, and action results land in a `role=status` line.

## What I saw (each picture, one line)

- `page-light.png`, `page-dark.png`: the page with four agents, the first asking a question with its recommendation; badges on Decisions and Coding agents.
- `empty-state-light.png`: an empty instance, "No coding agents yet" and the start form (the judge hid the found programs' names).
- `card-asks-light.png`: an agent's decision line with *Go with the recommendation* and an answer box.
- `card-waiting-approval-light.png`, `card-waiting-approval-dark.png`: a tool call waiting 20 s counts as waiting on you, with *Open its terminal*.
- `session-terminal-tab-approval-light.png`, `session-terminal-tab-approval-dark.png`: the agent's terminal tab beside its session with the approval prompt in it; amber row mark.
- `decisions-light.png`, `decisions-dark.png`: Decisions with both kinds of Agent Terminals card: the question with its recommendation, and the approval with *Answer in the session*.
- `decisions-reached-before-proof-light.png`: Decisions says "Your answer reached “Swallower”." while Agent Terminals still waited for the proof (Finding 4).
- `row-hover-light.png`: the row's hover line, "Coding agent waiting on you" with the call, under DSH's own "Idle".
- `not-proven-after-approval-light.png`: "Typed in while it works", Enter pressed 3 times during an approval, then "not proven"; the screen peek shows the top of the screen (Findings 2 and 3).
- `wrong-setting-light.png`: `proofSeconds` 500: the page names the setting and the range and offers its settings; a running agent reads "stopped" (Finding 5).
- `missing-program-light.png`: a program the shell cannot find: exit 127 and how to fix it.
- `card-plain-stopped-light.png`: the plain program after the restart: not started again, and why.
- `session-watch-off-light.png`: Session Watch off: the page says so and how to fix it.
- `switched-off-plugins-light.png`: Agent Terminals switched off in Plugins.
- `narrow-760-light.png`, `narrow-760-dark.png`, `narrow-760-light-start-form.png`: 760 px; nothing runs off the side.
- `after-restart-working-forever.png`: after the restart, the probe's row spins "working" while its terminal shows an idle prompt (Finding 1).
- `card-stuck-working-after-restart.png`: the Swallower 4 minutes after the restart: "working", and the queued message still waiting (Finding 1). The `[200~` in its line comes from a stray Escape the judge typed into that terminal earlier, which the stand-in read; it is not the plugin's.
- `after-restart-stale-approval.png`: "standin · app" after the restart: amber "waiting on you" mark, while its terminal shows no prompt (Finding 1).

Local paths and the names of real programs on this computer are hidden by grey boxes in the pictures.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Major: a DSH restart in the middle of a job or an approval leaves the agent stuck, holding every message.**
   - Where: `lib/transcripts.js` `foldEntry` and `statusOf`, and `lib/agents.js` `run()` and `gate()`. On a relaunch the fold is rebuilt from the whole transcript, so an open call, an approval or a user turn with no reply from before the restart is still open afterwards; nothing ends it, because the resumed program writes nothing until it gets a new message.
   - What I saw: at 6:58:07 I restarted DSH with the Swallower 30 s into a 90 s job, the "Restart probe" 9 s into a 60 s job, "standin · app" at an approval prompt and the Events agent waiting on a decision line. All four came back within 2 s with `--resume` of the same conversation. At 7:00:47 and again at 7:02:16, the Swallower and the probe still read "working, On: …" on the page and on their rows, while their terminals showed an idle prompt. "Queued before the restart" stayed "waiting: The agent is working; this is typed in when it is idle". "standin · app" stayed "waiting on you: It asks to run …", with a Decisions card that says to answer in its terminal, but its terminal showed no prompt; a message to it is held with "Answer there". Stop and Start again reads the same transcript, so by the code it comes back the same. The ways out are typing into its terminal by hand, or *Start anew*, which loses the conversation. This is the round-2 Autopilot failure ("an approval cut off by a restart holds its session for ever") in this plugin.
   - Fix: keep the launch time. Anything in the transcript before it is over: drop open calls and approvals older than the launch, and treat a user turn with no reply before the launch as cut off ("Its last job was cut off by the restart"), so the agent reads idle. Drop the stale question from Decisions. Add an e2e step: restart during `#work` and during `#approve`, then expect idle, the held message typed once and proven, and no Decisions card.
2. **Major: with `typeWhileWorking` on, Enter is pressed into a live approval prompt.**
   - Where: `lib/agents.js` `deliverOne()`, the proof loop: only status `working` waits; `waiting on you` with an open call falls through to "Idle, and no proof … pressed Enter again".
   - What I saw: "Typed in while it works" was typed at 6:34:54 while the stand-in worked on a job that asked for approval at 6:34:57. Once that call counted as waiting on you, Agent Terminals pressed Enter twice more with the approval prompt on screen (`enters: 3`), then at 6:35:33 marked the message "not proven". The approval prompt of a vendor coding-agent program takes Enter as a choice (its highlighted answer, usually yes), so this can approve a command nobody approved. The README says "never while it runs a tool, so nothing lands in an approval prompt", and the setting's hint says "Never while it runs a tool".
   - Fix: press no key while any call is open or the agent waits on you with a call; stop the proof clock until the call ends, then carry on. Make the stand-in's approval take Enter as yes, as real programs do, and add the e2e step `typeWhileWorking` plus `#approve`.
3. **Minor: a "not proven" message is never corrected when its transcript shows it later.**
   - Where: `lib/agents.js` `lateProof()` re-checks only messages in state `typed`.
   - What I saw: the stand-in's transcript has "Typed in while it works" at 6:35:58, as soon as the approval was answered. At 7:05, half an hour later and after a restart, its card still said "not proven: Typed in, but its transcript never showed it … the message may still be in its input box", and What happened kept "No proof that standin · app read a message" (failed). Someone reading that sends it again, and the agent gets it twice.
   - Fix: keep looking for proof of a "not proven" message for as long as a typed one (30 minutes), and turn it into "delivered (seen late)" with a log entry.
4. **Minor: Decisions says an answer "reached" the agent before Agent Terminals has proof.**
   - Where: Decisions' `saidNow` reads the history state `answered`, which Session Watch sets on hand-off; Agent Terminals' `answer()` returns a true line ("Typed into …'s terminal when it is ready; its card on the Coding agents page shows when its transcript has it."), which nothing shows.
   - What I saw: 1.5 s after *Send*, Decisions said "Your answer reached “Swallower”." while Agent Terminals had it as "typed: waiting for its transcript to show it"; the proof came 8 s later (its Enter was swallowed), and Decisions' row stays "answered".
   - Fix: show the handler's returned text instead of "reached", and have Agent Terminals report the proof back through Session Watch, so the Decisions row turns *delivered*.
5. **Minor: while a setting is wrong, running agents are shown as stopped.**
   - Where: `statusFor()` returns `stopped` "Not running: Agent Terminals waits for a setting to be fixed …" whenever the engine is not working, though the README says agents keep running then.
   - What I saw: with `proofSeconds: 500`, every card read "stopped" with *Start again*, *Start anew* and *Forget*, while each program ran in its terminal.
   - Fix: say "running, not followed until the setting is fixed", and hide the buttons that are refused anyway.
6. **Minor: a start that fails at once is announced as started, and still costs a session and a model turn.**
   - What I saw: "Started “Missing program”. Open its terminal to watch it work." for a program the shell cannot find (exit 127 a moment later). DSH got a session "Missing program" with one turn of the real model, which stays after *Forget*. What happened logs "Gave its session a first turn" as done when the turn is only queued.
   - Fix: check that the program exists (the form already knows "not found where DSH looks for programs") before making the session, or say "Starting …" until the program has run for a couple of seconds. Log the first turn when it ends.
7. **Nits.**
   - The header says "3 running · 2 waiting on you · 1 stopped", where the 2 are among the 3: say "3 running, 2 of them waiting on you".
   - Words: a held message reads "The agent waits on you in its terminal (It asks to run “touch approved.txt”: answer in its terminal.). Answer there; this is typed in after." (answer twice, and ".)."). Backticks show in UI text ("`which standin-nope` in a terminal shows it").
   - The hover line shows "Coding agent waiting on you" over DSH's own "Idle", two states for one row with nothing saying which is whose.
   - *Its screen now* shows the top of the terminal (launch line, banner), so the approval prompt at the bottom is out of view: show the last rows.
   - The full program path takes two or three lines of every card: show the program's name, and the path on hover.
   - *Forget* acts at once, with no confirmation or undo, and drops the resume id.
   - A status line ("Queued for “standin · app” …") stays after its message was delivered.
   - "Found on this computer" lists a program's alternate config folders (`~/.<name>-<suffix>`) as programs.
   - A message of several lines is shown on one line in the message list.
   - Reaches into DSH's internals: the direct typing way uses the terminal controller's owners, handle and screen modes, and the page reads DSH's `dsh.terminal.binding.v1.` localStorage key. The e2e covers three builds today, but a DSH update can break both without notice.
   - Switching Agent Terminals off and on in Plugins writes no entry in What happened.
   - `lib/agents.js` imports `existsSync` twice.

DESIGN.md's "Before you push" list, for this plugin's UI: surfaces sit right (glass cards with `--wp-blur` on its own page, nested cards flat) ✓; only DSH tokens named in DESIGN.md, `--wp-blur`, `--wp-tint` and `body.wp-still` ✓; no DSH hash selectors, nothing set on `:root`, `html` or `body`, no `:has()` ✓; motion off under `wp-still` and reduced motion, pseudo-elements included, glass thicker under reduced transparency ✓; `node --check` on the client and `npm test` pass ✓; both DSH versions (e2e) and both themes ✓, Wallpaper on and off not checked by me; off leaves nothing behind and on again repeats nothing ✓.

## What would make it a 9.5

1. A relaunch ends everything open before it (calls, approvals, unanswered turns): after a restart mid-job the agent reads idle, its held messages and Decisions answers go in once and are proven, and the e2e restarts DSH under `#work` and `#approve` to prove it.
2. No key is ever pressed while a call is open; the stand-in's approval takes Enter as yes; the e2e combines `typeWhileWorking` with an approval.
3. Late proof for "not proven" messages, and a Decisions line that follows the proof instead of saying "reached" on hand-off.
4. States that stay true: running agents never shown as stopped, no "Started" until the program runs, no session or model turn for a program that is not there.
5. Polish: honest header counts, the last screen rows in the peek, short program names on cards, *Forget* with an undo, and the words in Finding 7.

## Live DSH fingerprint (before and after)

| When | pid | Started | Patch sha256 |
| --- | --- | --- | --- |
| Before (6:22:48 AM PDT) | 687 | Fri Oct 16 12:22:37 2026 | e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020 |
| After (7:06 AM PDT) | 687 | Fri Oct 16 12:22:37 2026 | e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020 |

Unchanged. The e2e's own check also reported it unchanged. At the end I stopped my window driver, destroyed `suite-agent-terminals-j1` (`dsh-test destroy`), and checked that no stand-in process was left.
