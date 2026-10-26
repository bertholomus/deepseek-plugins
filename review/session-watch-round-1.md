# Session Watch: judge round 1

Commit 2741f21 (branch `goal95/session-watch`), judged 2026-10-26, 2:36 to 3:30 PM PDT. DSH Test instance g95-session-watch-j1 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 through the owner gateway (which answered from DeepSeek-V4.1-Flash-1017: an environment fact, see "What I ran"), plus the e2e's scripted model on all three DSH builds.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | It does the whole job in real DSH (every state word, todos, goals, the last reply's closing line, approvals and the question box, delivery with proof, cut-off turns after a quit and a crash with what they left waiting, questions for Decisions, What it watches); but a message in flight when DSH stops loses its proof and throws off the carry-on after the restart, a question in the question box is never pushed, and a chosen state shows only its twelve newest sessions. |
| Reliability | 8.5 | Guarded listeners, validated settings and delivery proven against the session logs on three DSH builds, through a SIGKILL crash and three restarts; but deliveries are kept only in memory, so a quit or crash drops their proof and nobody can look one up after the start; one documented state change (*waiting for your answer*) never reaches listeners; and its delivery log lines go with the process. |
| UX / polish | 8.5 | A tidy section and form in DSH's own components, plain words that say what to do, good in light, dark, Wallpaper glass, 760 px and by keyboard (2 px ring); but it shows *running* for minutes while a session waits for your answer, gives no way to see sessions past the twelfth, and makes each state chip its own tab stop. |
| Test depth | 8.5 | 41 host tests and 80 real-DSH checks on each of three builds (quit and crash included, pictures light and dark); but the question-box check polls `row` every 250 ms, so it passes without the push the README promises, and no test stops DSH with a delivery in flight. |
| Docs | 9.0 | A complete, plain README (what it watches, the API for plugin authors, the setting, switching off, rollback, setup, tests) that is honest about its in-memory log lines; two claims over-reach ("follows the sessions as they change, without a reload", "twelve at a time") and it says nothing of a delivery in flight at a stop. |

Plugin score: min(U, R, mean) = min(8.5, 8.5, 8.6) = 8.5. Verdict: NOT YET (GOAL95's bar is 9.5 with no criterion below 9).

## What I ran

- **Build.** `git archive 2741f21 | tar -x` into my own folder (`~/Projects/goal95/judge/session-watch-r1/head`), `.e2e` linked. In the repository I wrote only this scorecard and its pictures.
- **Unit tests.** `npm test`: 847 tests, 843 pass, 0 fail, 2 skipped, 2 todo (90 s), as the builder said. Session Watch's own file has 41.
- **The window kit change.** `node scripts/sync-shared.mjs --check` exits 0: the seven copies (Agent Terminals, Autopilot, Canon, Decisions, Proof, Recall, Session Watch) match `shared/client-kit.js`. The quoted-number flag applies only to fields a plugin declares as numbers, so text settings are untouched. `node scripts/e2e.mjs autopilot`: 103 of 103, and `decisions`: 108 of 108, on the installed app's DSH with the new kit. In my window, with Session Watch off, Autopilot's and Decisions' windows asked DSH's plugin list (7 calls in 30 s, no failed request, no console error) and came back by themselves 828 ms after it was on again.
- **Real-DSH e2e.** `node scripts/e2e.mjs session-watch`: 80 of 80 on DSH 0.2.0-rc.2 (100 s), 0.2.1-rc.1 (90 s) and the app's 0.2.1-rc.3 (82 s); its fingerprint check: live DSH unchanged. I read its 80 checks against the README.
- **My instance.** `dsh-test --name g95-session-watch-j1 up`; Session Watch, then Autopilot and Decisions from my build, with the row `deliveryTimeoutSeconds: 120`; the e2e's probe plugin (`test/e2e/probe`, a test-only stand-in that listens and delivers as the suite's plugins do, and serves the service's calls to my window); later Wallpaper from the 5b4d1eb archive with a forest picture. The access preset was set to Workspace Write before any turn. One turn asked to write outside its workspace with full access; I rejected it in Decisions.
- **Real-model turns.** Nine prompts in nine sessions, each in a throwaway workspace of mine: a todo list ending in a DECISION NEEDED line; a write outside the workspace (an approval); "ask me which colour" (DSH's question box, twice); long numbered lists to keep turns running under stops. Autopilot added its carry-on turns.
- **Stops.** Restarts (quit) with turns running at 2:45, 3:00 and 3:02 PM, and a crash at 2:55 PM: SIGKILL of my instance's own process group with three turns running. After each start I compared `running.json`, the section, `sessions`, Autopilot's record and each session's log.
- **Deliveries.** Through the probe: into a running turn (queued and steered), past the 120 s timeout, just before a quit (note C), and just before the owner stopped the turn (note D). Each state checked against the session's own log (`agent/inbox/spliced`, `user/message`, `turn/end`). A probe question raised for Decisions and answered there.
- **Settings.** `"600"`, `-5`, `[1, 2]`, `true` and `99999999` in my instance's profile; in the form, 5, abc, 1.5, then 120 saved.
- **Window.** Playwright (the harness's `openWindow`, `setDark`, `shot`) on my instance only: Plugins light and dark, chosen states by mouse and keyboard, 15 blank sessions at 760 px, switch off and on in Plugins with Autopilot and Decisions open (failed requests and console errors recorded), Wallpaper glass light and dark.
- **Environment fact: the model.** My instance asked for GLM-5.3-Flash-EXL3, but the owner gateway answered every step it recorded from DeepSeek-V4.1-Flash-1017 (`responseModel` in the session logs: 38 steps in 7 sessions, from my first turn on). The coordinator flagged it at 3:18 PM; my last real-model turn had gone at 3:13 PM, I sent none after it, and I cancelled the one turn still open (waiting on its question) without answering it. This is not the plugin's fault and changes no score: Session Watch reads DSH's events whatever model answers, and the e2e's scripted model covers the same paths on all three builds.
- **Not checked:** Agent Terminals (not installed in my instance; the e2e covers outside agents), a screen reader, hundreds of sessions (I had 24), Decisions' delay for a question-box question, and a pending delivery while Session Watch is switched off (from the code only, under finding 1).

## What I saw (each picture, one line)

1. `01-page-in-plugins-light.png`: its page in Plugins, light: the one setting (120, *Changed*, *Use the default*) with what it means, DSH's own component and source rows, and **What it watches**: 3 sessions, 1 running, which plugins read through it.
2. `02-page-in-plugins-dark.png`: the same page, dark, with *running* chosen: three sessions, newest first, each with when it changed and **Open**.
3. `03-section-waiting-states-light.png`: *waiting for approval* 1 and *waiting for your answer* 1 in the warm chips, beside idle and new; the headline says "0 running" while those two turns are open.
4. `04-section-misses-a-question-light.png`: 2:44 PM: the section still says *running* 3 while the watcher's own `sessions` endpoint has one of them *waiting for your answer*; still so at 2:47 PM (finding 2).
5. `05-section-misses-a-question-measured-light.png`: a clean measurement: the turn asked at 3:11:20 PM, and 91 s later the section still had no *waiting for your answer*.
6. `06-section-cut-off-after-crash-light.png`: just after the SIGKILL and a new start: *cut off* 3, idle 3, new 2, each cut-off session read from its log.
7. `07-chosen-state-light.png`: *running* chosen: three sessions with "just now" and **Open**.
8. `08-chosen-state-dark.png`: the same, dark.
9. `09-chosen-15-at-760-light.png`: 760 px, *new* chosen with 15 sessions: twelve listed, then "and 3 more, older" with no control to see them; no sideways scroll (finding 3).
10. `10-chosen-15-at-760-dark.png`: the same, dark.
11. `11-setting-in-quotes-light.png`: `"600"` in the profile: the field in red with what to do ("It is saved as text, in quotes. Type a whole number from 10 to 86400, without the quotes, then save."), and the section says what that means meanwhile.
12. `12-autopilot-names-the-setting-light.png`: Autopilot names Session Watch's wrong setting in words and where to fix it; its record shows three carry-ons after the 2:45 PM restart, all delivered, one saying the question in the question box had no answer.
13. `13-switched-off-light.png`: switched off in Plugins: DSH shows it Off; its form and section are gone.
14. `14-autopilot-needs-watch-light.png`: Autopilot meanwhile: "Autopilot needs Session Watch, which is not running", with a button to it and *Check again*.
15. `15-decisions-needs-watch-light.png`: the same in Decisions.
16. `16-autopilot-back-light.png`: on again: Autopilot's page back by itself, with the carry-ons after the crash all delivered.
17. `17-decisions-in-use-light.png`: Decisions fed by the watcher: the question-box question, the full-access approval (which I rejected) and the DECISION NEEDED line.
18. `18-autopilot-carry-on-taken-back-light.png`: Wallpaper on: after the 3:02 PM restart, Autopilot's carry-on to the stars session is *not delivered* (taken back after 2 minutes) because note C, queued before the stop, was read first; the note says "nobody has written in the session since" (finding 1).
19. `19-decisions-raised-ask-light.png`: Wallpaper on: Decisions with four waiting; the fourth (below the fold) is the probe's raised question, which I answered *Yes* there; the probe's handler got it, by "you", and `asks()` was empty after.
20. `20-glass-light.png`: its page on Wallpaper's light glass, *cut off* chosen at 0: "No session reads cut off now."
21. `21-glass-dark.png`: the same on dark glass.
22. `22-glass-section-light-close.png`: the section close up on light glass: its grey text is about 3:1 there, as DSH's own text on the same page is.

## Findings (most severe first)

1. **Major: a message in flight when DSH stops loses its proof, and the carry-on after the stop does not know it is there.**
   - Where: `lib/watch.js`. Deliveries live only in the in-memory `this.deliveries` map (line 121), filled by `deliver` (line 487) and followed only through events this process sees (`trackDelivery`, lines 431 to 453); `close()` (line 710) drops them, and `running.json` keeps no record of them. `cutOffSessions` (lines 576 to 609) skips a session only when something was written after the cut (`inAt > end.at`, line 603), never when a message from before the cut is still queued.
   - What: at 3:02 PM the probe delivered "Judge note C" into session 2a1781c1's running turn (log seq 17, *queued*), then DSH quit. After the start the watcher listed the session as cut off and Autopilot queued its carry-on (seq 21); turn 2 read note C first (seq 23 to 25); the carry-on waited behind turn 2 and was taken back at the 2-minute timeout (seq 27). Autopilot's record (picture 18) says *not delivered* and "nobody has written in the session since", and the sender of note C never learns that turn 2 read it: its delivery died with the old process and the service has no lookup by id. With the default 600 s the carry-on would likely have been read after turn 2 instead, telling the session to carry on from a cut it had already moved past. The README promises the watcher follows each message "through the session's own log" and "never reports a message as sent on hope"; across a quit or a crash, which is when an unattended night needs it most, nobody is told anything. (While it keeps running it is right: note D, queued before an owner stop, was taken back at 120 s, seq 21, and never read.) From the code, not run: a watcher switched off in Plugins leaves its delivery timers running, so up to the timeout later it can still take a message back out of a queue and tell no one.
   - Fix: keep pending deliveries (id, session, mode, queued at, sender) in `running.json` or a small store of their own; at start, reconcile each against its session's log (read into a turn: *delivered*, naming it; removed or gone: *failed* with the reason; still queued: keep following it for the time left, or take it back) and emit `delivery` events for them; add `deliveryOf(id)` so a restarted plugin can ask; have `cutOffSessions` report messages still queued from before the stop (with their sender) so Autopilot can say so or hold its carry-on; clear a closed watcher's timers. Prove it in the real-DSH test: deliver behind a running turn, quit and crash, then check the outcome is reported after the start and the carry-on is neither taken back nor out of order.

2. **Major: a question in DSH's question box is never pushed: listeners and What it watches miss *waiting for your answer*.**
   - Where: `lib/watch.js` `onSessionEvent` (lines 385 to 409) emits `state` for `todo/write`, `goal/change`, `approval/asked`, `approval/decided`, `session/title` and `user/message` only. `tool/call` and `tool/result` of `ask_user_question`, which set and clear `asking` in `lib/fold.js`, fall to `default`, so no `on()` listener hears them and no window's `wait` is woken (the hub is bumped in `emit`, line 375).
   - What: session 21b476bc's turn asked in the question box at log seq 64 (about 3:03 PM); the probe, a listener as Autopilot and Decisions are, heard nothing for that session from 3:03:21 to 3:07:20 PM. The section showed *running* while the watcher's own `sessions` endpoint said *waiting for your answer*, from 2:44 to at least 2:47 PM (picture 4) and for all 91 s of a clean measurement at 3:11 PM (picture 5); it caught up only when the page was opened again. An approval, by contrast, emits `state` (`approval/asked`) and wakes the windows. Decisions did show the question (picture 17); I did not measure its delay. The README says the section "follows the sessions as they change, without a reload" and lists this state; the e2e's question-box check (`test/e2e/run.mjs` line 217) polls `row` every 250 ms, so it passes without the push.
   - Fix: emit `{ type: 'state', change: 'tool/call' }` (and `'tool/result'`) whenever the fold's `asking` changes, by comparing `asking` before and after or by matching `ASK_TOOL` calls and results. In the e2e, check that the probe hears it and that the open section shows *waiting for your answer* without a reload; better, check that every state word the section counts arrives by push.

3. **Minor: a chosen state lists only its twelve newest sessions, with no way to the rest.**
   - Where: `lib/client.js` (`SHOWN = 12`; the chosen list's "and N more, older" line has no control).
   - What: with 15 *new* sessions, twelve were listed and "and 3 more, older" had no button (pictures 9 and 10); there is no filter by title either. The README's "twelve at a time" reads as paging. On this stack (many sessions, long runs) *idle* and *stopped* pass twelve in a day.
   - Fix: a "Show 12 more" button that keeps the focus, and a title filter once a state holds more than twelve; or say "the twelve newest" in the README.

4. **Minor: its record of what it put into sessions lives only in memory.**
   - Where: `lib/watch.js` logs each delivery and its outcome through `ctx.logger` (lines 449, 462, 483 to 516, 536); the README says DSH keeps those lines in memory and writes only startup warnings to a file; `lib/shared/journal.js` ships but is not used.
   - What: after the 2:55 PM crash nothing outside the session logs said what the watcher had put in or taken back; my instance's `logs/` folder had none of those lines. The session logs do hold each message (source `cordis-host-runner`) and each take-back (`removedCount: 1`), so nothing is unprovable, but auditing an unattended night means reading every session's log.
   - Fix: append each delivery and its outcome to a private journal in the watcher's folder (700 and 600, rotated), and use it for finding 1's reconciliation.

5. **Nits.**
   - The headline says "5 sessions · 0 running" while two turns are open and waiting on you (picture 3); "2 waiting on you" in the headline would read truer.
   - Each state chip is its own tab stop (the builder named this); one tab stop with arrow keys would be quicker as states add up.
   - The package still says 1.0.1 (Plugins shows "Current version 1.0.1"), though this build is 7 files and about 1,300 lines on from the `session-watch-v1.0.1` tag, so the owner cannot tell the two apart in Plugins or know which tag the README's rollback should restore.
   - At the moment it is switched off, five window requests fail with 404 (its `wait`, then Autopilot's and Decisions' `badge` and `state`, whose endpoints go with it) and print to the console; the 30 s after had no failed request and no console error.
   - On Wallpaper's light glass the section's grey text is about 3:1 (picture 22), the same as DSH's own text on that page: DESIGN.md's open question, not decided here.

## What would make it a 9.5

- Finding 1 fixed and proven in real DSH: a delivery in flight through a quit and through a crash is reported after the start (and can be looked up by id), `cutOffSessions` names messages still queued from before the stop, and Autopilot's carry-on is neither taken back nor out of order.
- Finding 2 fixed and proven: the question box reaches listeners and the open section without a reload, with an e2e check that listens instead of polling.
- Finding 3 (a way to every session of a state) and finding 4 (a durable delivery journal).
- The README brought in line: "the twelve newest" or real paging, and what happens to a delivery at a stop.

With these, the watcher would be what the README says: one place every plugin and the owner can trust through restarts, quits and crashes.

## Live DSH fingerprint (before and after)

- Before (2:36 PM): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 `f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55`.
- After (3:24 PM): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 `cb6b0fd75d241842578cb1c2116a7a764a7ea5364e02a58c68f0821e5e7343c8`.
- The patch moved at 3:15:03 PM in one line only, Fleet Shell's `runnerRev` (35 to 36, the owner's coordinator's edit by its own comment), against my start copy. That is outside Session Watch, which I never loaded into the live DSH; pid and start time did not change, so it is not a stop.
- Each e2e run's own check (session-watch, autopilot, decisions): live DSH unchanged before and after (pid 43210, patch `f240a78d8bd63d3f`).
- My instance is destroyed (`dsh-test --name g95-session-watch-j1 destroy`), my slot is given back, and every process I started has stopped.
