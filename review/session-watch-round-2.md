# Session Watch: judge round 2

Commit 13e7e51 (branch `goal95/session-watch`, version 1.1.0), judged Mon 2026-10-26 8:43 to 9:03 PM and 11:37 PM to Tue 12:05 AM PDT (a usage stop between). DSH Test instance g95-session-watch-j3 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 asked for through the owner gateway, which answered with DeepSeek-V4.1-Flash-1017 (an environment fact, see "What I ran"), then the e2e harness's scripted model on all three DSH builds. This is GOAL95 PASS 2's judge round for Session Watch.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.0 | It does every job its README lists, proven in real DSH with a real turn (cut-off found after a restart, the waiting note named, Autopilot's carry-on and that note read in one turn, carry-on first, both proven from the log), on three builds and at 335 sessions; but what became of a message on its way at a stop reaches no person: its own page never shows the journal it now keeps, and no consumer reads it. |
| Reliability | 9.5 | I tried hard to break it (a restart under a real turn with a note queued, a person's Stop with a note queued, two messages at once, a torn journal, a message to a deleted session, nine setting values, switched off and on with pages open, 335 sessions): each did the right thing, said so in words and matched the session's log; 103 of 103 on three builds. Only nits: a torn last journal line swallows the next record, and a reason can carry DSH's raw text with a session id. |
| UX / polish | 9.5 | DSH's own form and parts, plain words, light and dark, 760 and 420 px with no sideways scroll, one tab stop with arrows, Home and End, DSH's 2 px ring, status lines for screen readers, nothing left behind when off, and on Wallpaper's glass its text reads 6:1 or better; only nits: the Open link is about 4.3:1 on light glass, switching it off (then opening Autopilot's page) printed five 404s in the console, and a state of hundreds has only "Show 12 more". |
| Test depth | 9.5 | 35 host tests and 103 real-DSH checks on each of three builds, each proven from the session's own log: quit, crash and switch-off each with a message on its way, the order inside one turn, the question box heard by a listener and by the open section, Show more and the keyboard, the journal's modes, pictures light, dark and 760 px. Gaps are nits: no torn journal, two messages at once, a person's Stop, hundreds of sessions or Wallpaper. |
| Docs | 9.5 | A complete, plain README that matches the code everywhere I checked: the state table, delivery with proof, quit against crash, the queue rule, the API and endpoints, the setting and its range, files and modes, switching off, rollback to a tag that exists, setup and tests. One sentence is loose: of the five requests that failed at switch-off, only one was open "at the moment it goes", and "after that, none do" misses a suite page opened while it is off. |

Plugin score: min(U, R, mean) = min(9.0, 9.5, 9.4) = 9.0. Verdict: NOT YET (GOAL95's bar is 9.5 with no criterion below 9).

## What I ran

- **Build.** `git archive 13e7e51 | tar -x` into my own folder (`~/Projects/goal95/judge/session-watch-r2/head`), `.e2e` linked as the brief says. In the repository I wrote only this scorecard and its pictures.
- **Unit tests.** `npm test`: 853 tests, 849 pass, 0 fail, 2 skipped, 2 todo (91 s); the two "not ok # TODO" lines are two other plugins' hold-out floors, marked to-do. `test/session-watch.test.js`: 35 of 35. `node scripts/sync-shared.mjs --check` exits 0; `node --check` on the client passes.
- **Real-DSH e2e.** `node scripts/e2e.mjs session-watch`: 103 of 103 on DSH 0.2.0-rc.2 (177 s), 0.2.1-rc.1 (194 s) and the app's 0.2.1-rc.3 (133 s); live DSH unchanged. I read its checks against the README: they read each claim back from the session's own log (the turn a message sits in, the order of two messages in one turn, the queue splice that took one back), listen to the service instead of polling it, and time the open section (the question box must show within 6 s).
- **A consumer.** `node scripts/e2e.mjs autopilot --dsh app`: 98 of 99 (278 s). Every check that rests on Session Watch passed (a quit under four running turns, carry-ons after a quit and after a crash delivered, the record of running turns, a number in quotes, Autopilot waiting for Session Watch and saying what to do). The one failure is Autopilot's own rule control ("Press Enter to apply Off." not shown within 5 s), the known flake Autopilot's round 4 listed (R4-6), in Autopilot's code.
- **My instance.** g95-session-watch-j3 with Session Watch (row `deliveryTimeoutSeconds: 120`), the e2e's stand-in user (`plugins/session-watch/test/e2e/probe`, which calls the `sessionWatch` service as Autopilot does and serves it to my scripts), Autopilot and Decisions, all from my extracted head. The profile's access preset was set to Workspace Write before any turn; the turn had a throwaway workspace of mine.
- **The one real-model turn, and a restart under it.** 8:46:48 PM: a turn asking for a three-step todo list, `hello.txt`, and a closing DECISION NEEDED line. Its log says `responseModel` DeepSeek-V4.1-Flash-1017 for every step, so I sent no more turns. While it ran (8:50:56 PM) the probe put "Judge note Q" behind it (`from: "Judge"`): *queued*, written to `deliveries.jsonl` (600, in a 700 folder). Then I restarted the instance under the running turn (dsh-test's stop was forced, "killed 5 leftover processes", so the queue survived as in a crash). Right after the start (8:51:34 PM): `cutOffSessions` found the session (end *interrupted*, three open todos with the next one named) and named the waiting note in `queued` with its sender and first words; `deliveryOf` said *queued*, `restored: true`. Autopilot, on its default rule, sent its carry-on by itself at 8:51:55 PM: the watcher put it in as a steer (`waiting: 1`), turn 2 read the carry-on (log seq 39) and then the judge note (seq 40), and the journal says both were delivered into turn 2, with nothing taken back. Turn 2 was a real-model turn that Autopilot started, not me: I stopped it at 8:52:57 PM after one step (the same model again; it wrote `hello.txt` in its own workspace and ticked a todo), and the row read *stopped*.
- **Settings.** In the live profile row, one value at a time: `abc`, `9.5`, `86401`, `0` and `"600"` were each named in `status` with the value ("How long a message may wait to be read (deliveryTimeoutSeconds) must be a whole number of seconds from 10 to 86400 (it is 9.5)"); `10` and `120` cleared it; `null` means the default. `status` said `running: true` throughout (the code uses the default while a value is wrong).
- **The window.** Playwright (the harness's `openWindow`, `setDark`, `shot`) on my instance only: its page in Plugins light and dark with the real session, *stopped* chosen, 760 px, and a keyboard sweep (one tab stop, ArrowRight and End move it, DSH's ring solid 2 px, Tab goes on to the first Open). No window errors. Then switched off in Plugins with its page open, Autopilot's page opened while it was off, switched on again, Autopilot's page again (pictures 8 to 10; the section was back 0.8 s after the switch).
- **My own breaking runs** (scripted model, DSH 0.2.1-rc.1, throwaway homes, a 20 s wait): two messages at once into an idle session (A read in turn 2, B in turn 3, in order); a note queued behind a turn the person then stops (DSH keeps it queued; at 20 s the watcher took it back out, "no turn read it within 20 seconds, so Session Watch took it back out of the session's queue", and no turn ever read it); a half-written last line in the journal plus a queued record for a session that no longer exists, then a start (it started, failed that record with a reason, kept the journal 600, and the next message was delivered). And a direct check of the journal class after a torn line (finding 2).
- **Many sessions** (twice): 335 sessions (330 blank *new*, 5 *idle*). The `sessions` endpoint answered in 711 ms cold and 117 ms warm (104 KB; 1052 and 87 ms in the second run); the section showed the count 0.8 to 1.3 s after opening; choosing *new* drew its first twelve in 864 ms (in-page), "Show 12 more" drew the next in 3 ms, and 27 presses reached "All 330 shown." in 4.7 s; a new session was counted live in 1.8 to 3.6 s with every row listed; 420 px had no sideways scroll; no window errors.
- **Wallpaper.** Wallpaper 3a81132 (`goal95/wallpaper`, my own extraction), Session Watch and 14 blank sessions in a fresh instance, glass tint 20% over a light and a dark picture of mine, in light and dark mode: pictures, and every text style's contrast measured against the ground in the picture.
- **Not checked:** a real screen reader; Agent Terminals in a window (the builder reports its e2e at 129 of 129); Decisions' e2e (the builder reports 108 of 108 on all three builds); a night-long run.

## What I saw (each picture, one line)

All in `review/session-watch-round-2/`.

1. `real-page-light.png`: its page in Plugins with the real session: the setting (120, *Changed*, *Use the default*), version 1.1.0, and **What it watches**: 3 sessions, 0 running, *stopped* 1, *new* 2; Autopilot on, Decisions on, Agent Terminals not installed.
2. `real-page-dark.png`: the same, dark.
3. `real-chosen-stopped-light.png`: *stopped* chosen: the real session, "1 min ago", **Open**.
4. `real-chosen-stopped-dark.png`: the same, dark.
5. `real-760-light.png`: 760 px: the whole page fits, no sideways scroll.
6. `real-760-dark.png`: the same, dark.
7. `real-keyboard-light.png`: after the keyboard sweep: DSH's 2 px ring on **Open**, one state button chosen.
8. `offon-off-light.png`: switched off: DSH shows it Off; its form and section are gone.
9. `offon-autopilot-while-off-light.png`: Autopilot meanwhile: "Autopilot needs Session Watch, which is not running.", with "Open Session Watch in Plugins" and *Check again*.
10. `offon-autopilot-back-light.png`: on again: Autopilot back by itself, its record "Told it to carry on after DSH stopped · delivered", and "You stopped its last turn, so Autopilot leaves it to you."
11. `scale-420-light.png`: 335 sessions, all 330 *new* listed, at 420 px: no sideways scroll.
12. `scale-420-dark.png`: the same, dark.
13. `glass-light-on-light.png`: Wallpaper on, light mode, light picture, tint 20%: *new* chosen, "12 of 15 shown, newest first. Show 3 more".
14. `glass-dark-on-light.png`: dark mode over the light picture.
15. `glass-light-on-dark.png`: light mode over the dark picture.
16. `glass-dark-on-dark.png`: dark mode over the dark picture.

Measured on 13 to 16: grey text (count, times, status line, note) 6.1 to 6.7:1 in light mode and 8.6 to 13:1 in dark; titles and the heading 12 to 17:1; the Open link 4.3 to 4.4:1 in light mode and 6.3 to 9:1 in dark.

## Findings (most severe first)

1. **Minor: what became of a message on its way at a stop reaches no person.**
   - Where: `lib/watch.js` keeps every delivery in `deliveries.jsonl`, follows those on their way again at each start, and tells it through `delivery` events (`restored: true`), `deliveryOf(id)`, `deliveries()` and the window endpoint `deliveries` (`lib/remote.js`); `cutOffSessions` adds `queued`. But its page (`lib/client.js`) reads only `sessions` and `status`, never `deliveries`, and no consumer reads any of it: Autopilot (`plugins/autopilot/lib/pilot.js` line 575), Decisions (`plugins/decisions/lib/inbox.js` line 788; it drops `delivery` events at line 264) and Agent Terminals (`plugins/agent-terminals/lib/agents.js` line 692) follow only the delivery of a call they made in the same run, and none passes `from` (Autopilot's carry-on is in my journal without a sender).
   - What: in my restart, the note followed again and proven delivered into turn 2 is visible only in the journal file and that endpoint. Had DSH let it go unread (a quit with SIGTERM does), the reason "the session let the message go without reading it" would be just as invisible. By the code (I did not run this), a consumer's own record of a message on its way at a stop keeps its last word after the restart: Autopilot's "in the queue", Decisions' "Your answer to … waits in its queue. What happened says when the session reads it." That is the case an unattended night needs most.
   - Fix: in **What it watches**, list the messages it put in that were not delivered, and those followed again after a stop, newest first, each with its session (Open), sender, first words and the outcome in words, from the `deliveries` endpoint it already serves (or a *not delivered* count beside the states). Optionally let `cutOffSessions` carry the messages a stop let go, so Autopilot's carry-on can say so. The consumers keeping the delivery's `id` in their record, settling it from `deliveryOf(id)` or the restored `delivery` event after a start, and passing `from` is their builders' work.

2. **Nit (rare): a torn last line in the journal swallows the next record.**
   - Where: `lib/shared/journal.js` (from `shared/host/journal.js`), `write()`: it appends `JSON.stringify(row) + '\n'` without checking that the file ends in a newline; `load()` skips lines it cannot parse.
   - What: with a half-written last line (as a crash or a full disk in the middle of an append leaves it), the watcher starts and settles everything right, but the first row it writes is glued onto the half line, so at the next start that row is gone. I proved it on the journal class: a record set to *failed* after the torn line reads *queued* again at the next load. The watcher would then follow that message again and report it a second time, possibly with another reason (a message it took back at its timeout would read "it was taken out of the session's queue unread when DSH stopped"), and a lost first row of a message would leave `deliveryOf` with nothing. Until the file is next rewritten (past 1 MB), the damage stays.
   - Fix: on load, note whether the file ends in `\n` and, if not, write one before the next row (or rewrite the file from memory at the first write); add the case to `test/suite-shared.test.js`, then `node scripts/sync-shared.mjs`.

3. **Nit: switching it off printed five 404s, more than the README's sentence covers.**
   - Where: the README's "One request per window" paragraph; the window kit (`shared/client-kit.js`, `useLive`) and Autopilot's page (`plugins/autopilot/lib/client.js`, `useDecisions`).
   - What: with its page open, switching it off gave 404 one second later for `session-watch/wait` (the open request) and for `decisions/badge` and `autopilot/badge` (the sidebar badges reading once, as the kit's hub has every page read when the watcher stops); opening Autopilot's page while it was off gave two more at 7 s (`autopilot/state` and Decisions' `badge`, which that page reads once on opening). Each was a console error; none in the 25 s on that page after, and the pages said what to do and came back by themselves. The README says requests "open at the moment it goes fail once …; after that, none do".
   - Fix: have a suite page skip its own read while the window's hub already knows from DSH's plugin list that Session Watch is off (`useLive`, and Autopilot's one-off Decisions check), or say in the README that each open suite page reads once when it goes, and a suite page opened while it is off fails its first read.

4. **Nit: a reason can carry DSH's raw text with a session id.**
   - Where: `lib/watch.js` `settleRestored` ("after DSH stopped, its session's log could not be read (" + DSH's error + ")", line 795) and `deliver` ("the session could not be opened: " + DSH's error, line 679).
   - What: for a message to a session deleted before the start: "after DSH stopped, its session's log could not be read (session "session-gone-0000" not found)". Autopilot and Decisions keep such reasons in their records and show them on their pages ("Not delivered: …"). DESIGN.md section 9: no ids or raw server text where people read.
   - Fix: map DSH's not-found to "the session no longer exists" and keep the raw text for the log line.

5. **Nits: the Open link on light glass, and big states.**
   - The Open link (`--dshsw-link`: DSH's link colour 85%, the label colour 15%) measured 4.3 to 4.4:1 on Wallpaper's light glass at tint 20%, under the 4.5:1 DESIGN.md rule 6 asks of text on glass; mix it about 75% instead. Everything else on glass read 6:1 or better.
   - A state of hundreds has only "Show 12 more": 27 presses to reach the oldest of 330. A title filter once a state passes, say, 24 would serve the stack's many sessions.

## Round 1's findings

1. **A message in flight at a stop loses its proof** (major): **fixed** in Session Watch. A private journal (600), each message on its way settled against its session's log at the next start, `deliveryOf`, `deliveries`, `cutOffSessions` with `queued`, a carry-on that goes in as a steer when a stop left messages waiting (so neither waits behind the other), and a switched-off watcher's timers cleared. Proven in real DSH with a real turn (my 8:51 PM restart) and on three builds (quit, crash, switch-off). What is left, that the outcome reaches no person after a stop, is my finding 1.
2. **The question box is never pushed** (major): **fixed**. `tool/call` and `tool/result` of the question box emit `state` once per change; the e2e listens for it instead of polling, and the open section shows *waiting for your answer* within 6 s, on all three builds.
3. **Only the twelve newest of a state** (minor): **fixed**. "Show 12 more" keeps the focus on itself, and once none are left moves it to the first session it showed, with a status line ("12 of 15 shown, newest first." / "All 330 shown."), proven to 330 sessions. A filter was not added (my finding 5).
4. **The record of deliveries lives only in memory** (minor): **fixed**. `deliveries.jsonl` (600, folder 700), the newest 1000 read back, rewritten past 1 MB.
5. **Nits**: the headline now counts what waits on you (fixed); the state buttons are one tab stop with arrows, Home and End (fixed); the version reads 1.1.0 and the README names the rollback tag `session-watch-v1.0.1`, which exists (fixed); the 404s at switch-off are still there, now in the README (partly fixed: my finding 3); the grey text on Wallpaper's light glass, about 3:1 in round 1, read 6.1 to 6.7:1 with Wallpaper 3a81132 and my two pictures at tint 20% (not reproduced on them; the Open link is the one under 4.5:1, my finding 5).

## What would make it a 9.5

- Finding 1: **What it watches** shows what it put into sessions that was not delivered, and what it followed again after a stop, with the session, sender, first words and reason, so the owner can see what an unattended night lost without reading a file.
- Finding 2: a torn journal tail healed, with a unit test.
- Findings 3 to 5: the switch-off console quiet (or the README's sentence right), DSH's raw text kept out of reasons, the Open link at 4.5:1 on light glass, and a filter for big states.

With finding 1 alone, usefulness would be 9.5, and so would the plugin.

## Live DSH fingerprint (before and after)

- Before (8:44 PM): pid 64099, started Mon Oct 26 15:35:11 2026, patch sha256 `535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be`. The 7:28 PM move of the agent default model row was before I started.
- Each e2e run's own check (session-watch on three builds, autopilot on the app): unchanged.
- After the usage stop (11:38 PM), after each destroy (11:41 PM and 11:49 PM) and at the end (12:05 AM): pid 64099, started Mon Oct 26 15:35:11 2026, patch `535e6390…`. The patch never moved while I judged.
- My instance is destroyed (`dsh-test --name g95-session-watch-j3 destroy` at 11:41 PM; made again for the Wallpaper check and destroyed again at 11:49 PM), every slot I took is given back, and no process I started is running.
