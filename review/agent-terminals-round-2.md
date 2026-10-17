# Agent Terminals: judge round 2

Commit 98f8fd7 (branch suite/v1), judged 2026-10-17, 8:05 to 9:01 AM PDT. DSH Test instance suite-agent-terminals-j2 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | Every job in its brief section now works on the straight path and through a plain DSH restart, including mid-job and at an approval prompt; but a message or Decisions answer that was typed in and not yet proven when DSH restarts is lost while the card keeps saying it is on its way, and after any pick-up without a relaunch (a fixed setting, off and on in Plugins, Session Watch off and on) an agent whose job a restart cut off is stuck "working" or "waiting on you" again, holding every message. |
| Reliability | 7.5 | The round-1 failures I re-ran are fixed and every "delivered" I checked is in the agent's own transcript, but the restart fix lives only in memory (Finding 2), a typed-but-unproven message is never typed again after a restart and reads "waiting for its transcript" for 30 minutes (Finding 1), Decisions then says nothing waits while the agent waits on you, and a `~/` program passes the check and fails at launch. |
| UX / polish | 8.5 | Glass pages that read well light, dark and at 760 px, a 2 px focus ring on every stop, Cmd+Enter, live status lines, short program names, an honest header, the last screen rows in the peek, and a Forget that asks first with focus on Keep it; small misses: Escape does not cancel Forget's question, a failed start clears the form and keeps the failed program as a choice, every message box is named "Message", and the row's hover still shows the agent's state over DSH's own "Idle". |
| Test depth | 8.5 | 51 unit tests of its own (564 in the repo) and 117 real-DSH checks on three builds, all green, now restarting DSH mid-job and at an approval, combining `typeWhileWorking` with an approval, and proving each claim from stand-in transcripts with pictures light, dark and narrow; but no step picks agents up after a restart cut a job, none restarts DSH while a typed message waits for its proof, and no test starts a `~/` program. |
| Docs | 8.5 | A complete, mostly accurate README (what it does, each style, page, row, settings table with ranges, files, setup, switch-off, rollback, limits, tests); but it promises that a restart leaves agents idle with nothing left in Decisions and that a fixed setting picks agents up where they are, which a pick-up after a cut breaks, that a path that is not an executable file is refused before any session is made (a `~/` path is not), and that What happened notes when Agent Terminals stopped following (not when switched off in Plugins). |

Plugin score: min(U, R, mean) = min(8.5, 7.5, 8.3) = 7.5. Verdict: NOT YET.

## What I ran

- **Build.** `git archive 98f8fd7 | tar -x` into my folder (`~/Projects/dsh-plugin-suite-judge/agent-terminals-r2/head`), `.e2e` linked to the builder's DSH installs; `plugins/proof/` and `test/fixtures/proof/` ignored as unfinished. In the builder's tree I wrote only this scorecard, its pictures and one scoreboard row.
- **Unit tests.** `npm test`: 564 of 564 pass (60 s). Agent Terminals' own: 34 host tests and 17 page tests.
- **Real-DSH e2e.** `node scripts/e2e.mjs agent-terminals`: 117 of 117 on DSH 0.2.0-rc.2 (146 s), 0.2.1-rc.1 (153 s) and the installed app's 0.2.0-rc.2 (143 s); its own check said the live DSH was unchanged. I read its steps.
- **My instance.** `dsh-test --name suite-agent-terminals-j2 up`, then `defaultPreset: workspace-write` in its profile (the seed's full-access preset was never used; every session reads Workspace Write). Session Watch, Decisions and Agent Terminals loaded from my build, a restart, `doctor` clean. The window was driven with Playwright (the e2e's Chromium) at 1280 and 760 px, light and dark.
- **Stand-in coding agents only.** Wrappers in my scratch folder (`standin` for the flags style, `standin-events` for the subcommand style, `standin-plain`), each running the builder's `test/e2e/fake-agent.mjs` with a `STAND_IN_DATA` folder in that scratch folder. The start form listed three real programs under "Found on this computer"; I started none of them, and their names are hidden by grey boxes in the pictures.
- **Real transcripts, read-only.** The 25 newest real transcripts of each kind on this computer went through `lib/transcripts.js` (`Tail`, `entriesOf`, `foldEntry`, `closeOver`, `statusOf`) and `eventsMeta`, printing counts only: 0 unparsed lines of 26,107; calls and results paired up (4,372 calls and 4,373 results, with 19 of the 25 files read from their last 4 MB; 390 and 390); the events kind's conversation id was read from 25 of 25 files and matched each file's name. No content was read into this card.
- **Every claim checked at its source**: the stand-ins' transcript files (grep counts), Agent Terminals' `state.json` and `events.jsonl`, `ps` for each program's arguments, the terminal rows in the window and through the page's screen endpoint, and the DSH session folders.

What I exercised, with the real model behind the sessions:

- **Start from the page in a new session.** "App agent" (flags) in a new folder: a session named after it, listed after one GLM turn (16 s), its terminal tab beside it, `--session-id <id>` in `ps`, the first message proven from `<id>.jsonl`.
- **Messages.** Typed and proven; the next held while it worked ("The agent is working; this is typed in when it is idle"); one taken back (never typed); a two-line message pasted as one entry and shown on two lines; Cmd+Enter sends and keeps focus in the box.
- **Swallowed Enter.** "Swallower" (`--swallow-enter`): "Enter pressed 2 times", one transcript entry each time.
- **DECISION NEEDED to Decisions.** A decision line made the card waiting on you, one Decisions card with the recommendation, an amber row mark and badges. *Go with the recommendation* and two answers in my own words were typed in and proven; Decisions said "Answered. It goes into … counts as delivered once its transcript shows it", then turned the row *delivered* with the transcript's reason.
- **Tool call waiting for approval.** After 20 s: waiting on you on the page, the row, its hover line, the badges and a Decisions card (*Answer in the session*). A message sent meanwhile was held; I answered `1` in the terminal tab and the held message went in after and was proven.
- **`typeWhileWorking` on, approval after the message.** The message went in while it worked; no key reached the approval prompt in about 55 s (`approved.txt` absent until I answered); then the message was proven.
- **Start a coding agent here.** From the ⋯ menu of a session made by `dsh-test prompt` in another folder: the form chose "In the session “dsh-test · Reply with one short line: hello.”"; the events-style stand-in started in that session (`state.json` names that session id), and its conversation id came from the dated file it made (same id in the file name, on its screen and in `state.json`).
- **Terminal tab.** One tab per agent, named after it; still one after a reload; a running agent's row menu offers "Open the coding agent's terminal".
- **Closing the tab, Stop, Start again, Start anew, Forget.** Closing the tab ended the program ("Its terminal was closed (closing an agent's terminal tab ends the agent). Start again resumes its conversation."). A message sent while it was stopped waited and went in after *Start again*, which ran `--resume <same id>` in a new tab ("Resumed conversation …" on screen, same file). *Stop* ended it at once. *Start anew* ran `--session-id <new id>`. *Forget* asks first in the card ("Its session and its conversation files stay"), focus on *Keep it*; *Keep it* changed nothing; *Forget it* removed the card and logged it.
- **DSH restart under work (8:30:10 AM).** App agent 50 s into a 10-minute job with a message typed in during it (`typeWhileWorking` on); "Here agent" at an approval prompt with a message held behind it; Swallower with a Decisions answer sent a second earlier (its Enter swallowed); "Plain one" running. Within 2 s each resumable agent ran `--resume`/`resume` with its own id, read idle with "Its job … was cut off … Send it a message to carry on" (logged once each), the held message went in once (its words appear once as a user message in the transcript) and was proven, the plain one said why it was not started again, and the approval card left Decisions. The two typed messages were lost: Finding 1.
- **A second restart at an approval prompt (8:39:22 AM)**, then Agent Terminals off and on in Plugins: Finding 2.
- **Programs that are not there.** A path: "Not started: There is no program at …", no session. A bare name: "It was added, but could not start: It exited with code 127: the shell could not find nosuchagent-j2. Use its full path …", no model turn (the session stays, as the README says). A `~/` path: Finding 3.
- **A wrong setting while agents run.** `proofSeconds: 500` in the profile: the page named the setting, its range and value, every running card read "running, not followed" with only *Open its terminal*, and the form showed 500 in red; saving 8 picked them up in the same terminals and processes; both changes logged.
- **Off and on.** Agent Terminals off in Plugins: page, marks and menu items went, agents kept running; on again: picked up, "follows its agents" logged. Session Watch off: "Agent Terminals needs Session Watch, which is not running", with *Open Session Watch in Plugins* and *Check again*; back 0.5 s after it ran again.
- **Late proof.** With `enterRetries` 0, a swallowed Enter made "not proven … It turns delivered if its transcript shows it later"; I pressed Enter in its tab and it turned *delivered*, with "Swallower has the message after all" in What happened.
- **The rest.** Header "3 running, 1 of them waiting on you · 2 stopped". Its folder 700 and files 600. At 760 px the page's scroll width stayed 760. Dark mode on the page, a card, Decisions, the row hover, the settings form and a terminal tab. Tab order follows the cards with a 2 px ring on every stop; row marks read "Coding agent: idle." (or working, waiting on you); results land in `role=status` lines.

## What I saw (each picture, one line)

- `empty-light.png`, `empty-dark.png`: after every agent was forgotten: "No coding agents yet" with what to do, and the start form (names of real programs hidden); the failed `~/` path and missing name are still offered under "Used here before" (Finding 4).
- `working-held-light.png`: App agent working; a message held, one waiting to be taken back, a two-line message on two lines.
- `asks-light.png`, `asks-card-dark.png`: an agent's decision line with its recommendation and an answer box, light and dark.
- `decisions-card-light.png`, `decisions-dark.png`: the Decisions card for a decision line (and in dark also the approval card).
- `decisions-answered-light.png`: just after an answer: "Answered. It goes into … once its transcript shows it"; the row and badges still showed one waiting for a moment.
- `decisions-said-now-light.png`, `decisions-proven-light.png`: an answer in my own words: *answered* with what happens next, then *delivered* with "Its transcript shows it, after Enter 2 times".
- `approval-waiting-light.png`, `decisions-approval-light.png`, `row-hover-waiting-light.png`: a tool call waiting 20 s: card, Decisions card, and the row's hover line.
- `terminal-approval-light.png`, `terminal-answered-light.png`: the approval prompt in the agent's tab beside its session, then answered.
- `settings-form-light.png`, `settings-form-dark.png`: Agent Terminals' settings in Plugins.
- `row-menu-start-here-light.png`, `start-here-form-light.png`, `start-here-filled-light.png`, `start-here-after-light.png`, `here-agent-card-light.png`, `here-session-open-light.png`: *Start a coding agent here* from a session's menu, the form set to that session, the started agent, and its tab beside that session.
- `swallower-session-light.png`, `row-menu-running-light.png`: a session's agent tab after opening it; a running agent's row menu.
- `tab-closed-light.png`, `closed-card-light.png`: the tab closed, and the card saying the agent ended and how to bring it back.
- `start-again-resumed-light.png`: *Start again*: the same conversation resumed in a new tab, the waiting message typed in.
- `stopped-card-light.png`, `start-anew-ask-light.png`: *Stop*, then *Start anew* starting.
- `forget-ask-light.png`: *Forget* asks first.
- `before-restart-light.png`, `decisions-before-restart-light.png`: before the 8:30 restart: two agents waiting on me, one working.
- `swallower-after-restart-light.png`, `swallower-terminal-after-restart-light.png`, `decisions-after-restart-light.png`: after the restart: the lost answer still "typed in", the agent waiting on me again, an empty input line in its terminal, and Decisions saying nothing waits (Finding 1).
- `wrong-setting-running-light.png`, `wrong-setting-banner-light.png`, `wrong-setting-form-light.png`: `proofSeconds` 500: running agents "not followed", the banner, the field in red.
- `cut-job-working-again-light.png`: after the fix, App agent "working" on the job the restart cut, my message held (Finding 2).
- `plugin-off-light.png`: Agent Terminals switched off in Plugins.
- `session-watch-off-light.png`: Session Watch off.
- `stale-approval-decisions-light.png`, `stale-approval-terminal-light.png`, `stale-approval-held-light.png`: after the second restart and off and on: a Decisions card and "waiting on you" for an approval whose program has ended, an idle prompt in its tab, and a message held behind it (Finding 2).
- `missing-path-light.png`, `missing-bare-light.png`: a path that is not there (refused) and a name the shell cannot find (could not start, how to fix).
- `tilde-start-light.png`: a `~/` program refused by the shell after the check passed (Finding 3).
- `not-proven-light.png`, `late-proof-light.png`: "not proven", then *delivered* once its transcript showed it.
- `keyboard-focus-light.png`: the focus ring on a card's button.
- `screen-peek-light.png`: *Its screen now* shows the last rows.
- `page-dark.png`, `row-hover-dark.png`, `terminal-dark.png`: the page, the row's hover line and the agent's tab in dark.
- `narrow-760-light.png`, `narrow-760-start-form-light.png`: 760 px; nothing runs off the side.

## Round-1 findings, checked at 98f8fd7

1. **A restart mid-job or at an approval leaves the agent stuck: partly fixed.** A DSH restart now leaves both idle, logs each cut job once, types held messages once and clears Decisions. But the close-over is kept only in memory, so a pick-up without a relaunch brings the stuck state back (Finding 2), and a message typed but not yet proven at the restart is lost (Finding 1).
2. **Enter pressed into a live approval prompt with `typeWhileWorking` on: fixed.** No key in the prompt in about 55 s; the stand-in's prompt now takes Enter as yes, so the e2e step can fail.
3. **"Not proven" never corrected: fixed.** It turns *delivered* when the transcript shows it later, with "has the message after all".
4. **Decisions says "reached" before the proof: fixed.** "Answered. It goes into …", then *delivered* from the proof.
5. **Running agents shown "stopped" while a setting is wrong: fixed.** "Running in its terminal, not followed", only *Open its terminal*.
6. **A failing start announced as started, costing a session and a model turn: mostly fixed.** A missing path is refused before any session; a missing name says "could not start" and gets no model turn (its session stays, as documented). A `~/` path is a new hole (Finding 3).
7. **Nits.** Fixed: the header counts, the held message's words, backticks in UI text, the screen peek (last rows), program names on cards, *Forget* asks first, alternate config folders no longer listed as programs, several lines shown as lines, the duplicate import. Partly: the hover line now says "Coding agent in its terminal: …" but still sits over DSH's own "Idle"; switching on is logged, switching off in Plugins is not. Unchanged: reaching into DSH internals (the terminal controller's handle, the `dsh.terminal.binding.v1.` localStorage key), covered by the e2e on three builds.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Major: a DSH restart loses a message or Decisions answer that was typed in but not yet proven, and the card keeps saying it is on its way.**
   - Where: `lib/agents.js`. The saved-state reader re-queues only messages in `typing` ("typed again only if no proof came"); a message in `typed` keeps that state. Its proof loop in `deliverOne()` ends with the old run, and `lateProof()` only looks for proof, so nothing types it again; after 30 minutes it becomes "not proven … Look at its terminal", but that terminal ended with DSH.
   - What I saw: at 8:30:10 I restarted DSH with "Typed during long job" typed into App agent while it worked (`typeWhileWorking` on, so the program held it unread) and the Decisions answer "Restart answer: take the slow path" pasted into Swallower a second earlier (its first Enter swallowed). Both agents resumed with an empty input line; neither transcript has those words (grep: 0). Both cards kept "typed in: Pasted in, then Enter; waiting for its transcript to show it" with no Enter pressed again. Only at 9:00, 30 minutes after typing, did both turn "not proven: Typed in 30 minutes ago, and its transcript still does not show it. Look at its terminal." (Decisions: "not confirmed"), pointing at a terminal that no longer held them. Meanwhile the Swallower read "waiting on you" on its card, its row and the sidebar badge, while Decisions showed "Nothing waits on you" and the answer as *answered*, so the question could be answered again only on the agent's card. With the defaults the window is the time between typing and proof (seconds, or up to 24 s for a program that swallows Enter); with `typeWhileWorking` on it is the whole job.
   - Fix: when an agent is relaunched, a `typed` message its transcript does not show was lost with the old program: type it again once (as for `typing`), or mark it "not proven: DSH restarted before the agent read it" with a *Send again*; tell Decisions the answer did not land so its question shows again. Add the e2e step: restart inside the swallowed-Enter window, and during a job with `typeWhileWorking` on, then expect each message typed once and proven.
2. **Major: after a restart cut a job, any pick-up without a relaunch brings back the stuck state of round 1.**
   - Where: `lib/agents.js` `prime()` closes over the old transcript into `live.fold` and `live.primedAt`, which exist only in memory, and `read()` closes over only when `live.primedAt` is set. A pick-up (a wrong setting fixed, Agent Terminals off and on, Session Watch off and on, a plugin reload) starts with a new `live` and folds the whole transcript again.
   - What I saw: (a) App agent read idle after the 8:30 restart ("Its job … was cut off"). After I fixed a wrong setting at 8:35:35 it read "working: On: Long job before restart" on its card and row; with `typeWhileWorking` off (the default) my next message was held, "The agent is working; this is typed in when it is idle", while its tab showed an idle prompt. (b) Here agent, cut at an approval prompt by the 8:39:22 restart, read idle; after Agent Terminals off and on in Plugins it read "waiting on you: shell “touch approved.txt” has waited 97 s", Decisions showed "It asks to run “touch approved.txt”" with badges and an amber row mark, its tab showed an idle prompt, and a message was held "while a tool call waits in its terminal". Neither would ever clear by itself; *Stop* and *Start again* cleared both.
   - Fix: keep the cut across pick-ups: `launchedAt` is already saved in `state.json`, so close over the transcript at `launchedAt` whenever an agent is picked up without a launch (logging nothing new). Add the e2e step: restart under `#work` and `#approve`, then fix a wrong setting or switch it off and on, and expect idle, nothing held, no Decisions card.
3. **Minor: a program given as `~/…` passes the start check, then fails as one the shell "could not find".**
   - Where: `lib/agents.js` checks `findProgram(expandHome(spec.program))` but stores `spec.program`; `lib/launch.js` `shellWord()` quotes any word starting with `~`, so the shell runs `exec '~/…'`.
   - What I saw: program `~/Projects/…/scratch/bin/standin`: "It was added, but could not start: It exited with code 127: the shell could not find ~/Projects/…/standin. Use its full path …"; its screen: "zsh: no such file or directory: ~/Projects/…". A session was made for it. `~/` in the folder and conversations-folder fields works.
   - Fix: store the expanded path (as the check uses), or refuse `~` in the check with words; add a unit test.
4. **Minor: a failed start clears the form and keeps the failed program as a choice.** After "could not start" the Program field is empty again (the card cannot be edited), and "Used here before" offers `nosuchagent-j2` and the `~/` path. Fix: keep the form's values after a failed start, and remember only programs that ran.
5. **Minor: switching Agent Terminals off in Plugins writes no "stopped following" entry**, though the README says What happened notes when it stopped following and when it picked the agents up again (the wrong-setting case logs both). Fix: log it on dispose, or on the next start ("was off from … to …").
6. **Minor, seen once: the window lagged the host.** Early on, Decisions, the row mark and the badges still showed an answered question as waiting after 28 s, and an approval showed on the page about 14 s after the host had it. Later timings were about 2 s, and I could not repeat it.
7. **Nits.**
   - Escape does not cancel *Forget*'s question (focus is on *Keep it*, so Enter is safe).
   - Every message box is named "Message" for a screen reader; the agent's name is only in the placeholder. Name each "Message to <agent>".
   - The row's hover line shows "Coding agent in its terminal: waiting on you" above DSH's own "Idle".
   - Saving the settings form writes values equal to their defaults, which then show "Changed" and *Use the default*; the two *Use the default* controls are styled differently.
   - A waiting call's detail counts seconds ("has waited 97 s"), so the sessions channel is bumped every few seconds while a call waits.

DESIGN.md's "Before you push" list, for this plugin's UI: surfaces sit right (glass cards on its own page, nested cards flat) ✓; only DSH tokens that exist in both versions (I checked the `--dsw-static-*` and `--dsw-alias-border-l3` it uses in both builds' theme), `--wp-blur`, `--wp-tint` and `body.wp-still` ✓; no DSH hash selectors, nothing set on `:root`, `html` or `body`, no `:has()` ✓; motion stops under `wp-still` and reduced motion, pseudo-elements included, glass thicker under reduced transparency ✓; `node --check` and `npm test` (with the naming scan) pass ✓; both DSH versions (e2e) and both themes ✓, Wallpaper on and off not checked by me; off leaves nothing behind ✓, on again repeats nothing, except the stale states of Finding 2.

## What would make it a 9.5

1. A relaunch's close-over survives every pick-up, and the e2e restarts under work and approval, then fixes a setting and switches it off and on.
2. A message typed but unproven when DSH quits is typed again once after the relaunch (or offered *Send again*), and Decisions learns when an answer did not land; the e2e restarts inside the proof window.
3. `~/` programs start (or are refused before any session).
4. Polish: Escape cancels *Forget*, a failed start keeps the form, switching off is logged, message boxes named per agent, one status on the hover line.

## Live DSH fingerprint (before and after)

| When | pid | Started | Patch sha256 |
| --- | --- | --- | --- |
| Before (8:05 AM PDT) | 687 | Fri Oct 16 12:22:37 2026 | e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020 |
| After (9:01 AM PDT) | 687 | Fri Oct 16 12:22:37 2026 | e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020 |

Unchanged; the e2e's own check also reported it unchanged. At the end I stopped and forgot every agent (no stand-in process left), stopped my window driver and its browser, and destroyed `suite-agent-terminals-j2` (`dsh-test destroy`).
