# Autopilot: judge round 4

Commit f341843634d692e10558bd8736c4d022a3141042 (branch suite/v1), judged Sat Oct 17 2026, 5:39 to 6:45 PM PDT. DSH Test instance suite-autopilot-j4 (installed app, DSH 0.2.1-rc.2), GLM-5.3-Flash-EXL3. Session Watch was judged with it, as its dependency. I scored it on its own, as a first round, and read round 3's scorecard only after I had formed my view, to check its findings (at the end).

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | With the real model it did the jobs in its brief section: 6 carry-on notes of its own after a forced restart and a kill (one quoting a question left in DSH's question box), 2 more on my answers, an idle nudge, an errored goal retried with growing waits and then given up, Ask first, Leave it, Open, Off and the switch. But its error retries spent three of a goal's four rounds and left the goal unable to start, the hourly limit held my own "Tell it to carry on" and then asked again, and a cold cut-off session moved from Off to Ask first was not offered until Autopilot restarted. |
| Reliability | 8.5 | Every note it marked delivered is in the session's own log inside the claimed turn, the three goal starts after errors are the goal's own rounds 2, 3 and 4, and no note or goal start was repeated over three forced restarts, a kill, a clean restart and four off/on cycles. But a forced quit or a crash leaves its questions "asked you" for ever and asks them again as new entries (five open entries for three questions at the end), a goal start waits for its round for ever after a kill, and one start is credited with a round another start began. |
| UX / polish | 8.5 | Round 3's focus, refusal, Waiting card and contrast points are fixed: state words 5.8 to 7:1 in light and 8.7 to 11:1 in dark, the refusal in its row with the focus, the focus on the next question after an answer; every state (empty, waiting, wrong setting, Session Watch off, off, `enabled: false`) says what to do, at 760 px, light and dark. But the form shows a number in quotes as a value that fits and will not save it as shown, and several lines read wrong (90 seconds as "2 minutes", a give-up tagged "backed off", "last: started" for a refused start). |
| Test depth | 8.5 | The suite's 806 unit tests pass in the archive build, and the 103-check real-DSH test passed on all three builds, now with a quit under an open question, contrast per tone at a low tint, and the focus after Try again and an answer. But nothing kills DSH under an open question or a goal start waiting for its round, nothing opens the form with a value in quotes, the rounds error retries spend and an answer held by the limit are not tested, and the rule-keys step failed once in my five runs. |
| Docs | 8.5 | The README matches the window on the settings and their ranges, the states, what the page says when it cannot work, switching off, `enabled: false` and the 103 checks. But it says a value in the profile that does not fit is flagged as the form opens (not a number in quotes) and that a question open when DSH quits comes back under its first entry (not after a crash or a forced quit, though its own table names a crash), and it does not say that error retries spend goal rounds or that the hourly limit can hold your own answer. |

Plugin score: min(8.5, 8.5, 8.5) = 8.5. Verdict: PASS (8.5, and no criterion is below 8).

## What I ran

- 5:39 PM: read the live fingerprint. Built f341843 with `git archive` into `~/Projects/dsh-plugin-suite-judge/autopilot-r4/head`, with the `.e2e` link. `npm test` there: 806 of 806 pass, the naming scan included. `node --check` passes on both clients.
- 5:40 PM: `dsh-test --name suite-autopilot-j4 up`. In that instance's `profiles/desktop/cordis.patch.yml` only: `defaultPreset: workspace-write` (the seed had full access). Loaded Session Watch, then Autopilot with `idleSeconds: 90`, `startDelaySeconds: 10` and `errorRetrySeconds: [30, 90, 180]`. For some sessions I added a provider of my own: a small proxy in my scratch folder in front of the owner gateway (the same model) that answers one workspace's requests with a 503 while a switch file exists.
- 5:46 to 6:00 PM: `node scripts/e2e.mjs autopilot` from the build. DSH 0.2.0-rc.2 failed once (97 passed, 1 failed: finding 6), then passed twice (103 of 103, 133 s and 132 s); 0.2.1-rc.1 103 of 103 (149 s); the app's 0.2.1-rc.2 103 of 103 (134 s). The live fingerprint was unchanged after each run. I read its checks in `plugins/autopilot/test/e2e/run.mjs`.
- 5:46 to 5:48 PM: 8 real-model sessions, each in its own workspace: Haiku list (a todo list left open), Octopus goal (`create_goal`, 4 rounds, one fact per round), Limericks (rule Ask first), Numbers (rule Off), Rivers (a reply that asks me something), Lighthouse essay (a long reply), Logo color (DSH's question box) and Draft outside (a write outside its workspace that needs approval). The gateway was slow (some requests hit 300 s), so at 5:57 I stopped Numbers, Rivers and Lighthouse essay to spare it.
- 6:02 PM: Draft outside's rule to Off; `idleSeconds: "90"` (in quotes) in the profile row, and a restart under five running turns (one waiting in DSH's question box). The page, and the form its button opens; fixed with Use the default and Save at 6:05:48, then Quiet time back to 90 in the form at 6:08.
- 6:09 to 6:10 PM: Session Watch off and on in Plugins; the switch off and on.
- 6:11:29 PM: killed my instance's DSH (SIGKILL to its host process and its parent, both started by `dsh-test`) under three running turns with a question open; up again at 6:11:36. Answered the question at 6:12:55. Then 760 px, light and dark.
- 6:13 to 6:25 PM: the fault switch on for Octopus goal at 6:13:14: its failed turn, three retries (the switch off and on at 6:18 in between), the give-up at 6:24:31; the fault off and Try again at 6:24:48. Meanwhile Draft outside's rule from Off to Ask first (6:17:08), a nudge (6:18:22) and the default rule to Ask first (6:25:12).
- About 6:26 PM: Autopilot off and on in Plugins.
- 6:26:19 PM: `enabled: false` and a restart; 6:27:37 `enabled` removed and a clean restart; four questions; Leave it, Tell it to carry on and Open at about 6:28.
- 6:29:06 PM: Session Watch's `deliveryTimeoutSeconds: "600"` (in quotes) and a restart; its form in Plugins.
- 6:31 PM: Notes an hour, at most, to 15 in the form, then Tell it to carry on for Haiku list; watched until 6:41.
- 6:41:34 PM: reset my instance to an empty one, workspace-write again, both plugins with the same row, the page in light and dark.
- Throughout: checked each "delivered" and "started" against the session's own log in my instance's data (a script in my scratch folder) and against Autopilot's `events.jsonl` and `state.json`; measured the contrast of every text element on the page, light and dark; read where the focus went after each button. DSH Test's quit took its forced path (SIGTERM, then a kill after 30 s) at all three restarts with turns running; it quit cleanly when no turn ran.
- 6:44:59 PM: destroyed my instance. 6:45 PM: read the live fingerprint again.

## What I saw (each picture, one line)

Pictures are in `review/autopilot-round-4/`. Long pictures of the page run past the window; the grey or blank part below is the shot, not the page.

- 01-page-light-real.png, 02-page-dark-real.png: the page at 6:08 with 8 real sessions: Limericks' question in "Waiting for you", every row with its state, open work and last action, three carry-on notes "delivered" and the goal start "waiting for a round".
- 03-setting-in-quotes-light.png: `idleSeconds: "90"`: "Autopilot is waiting for a setting to be fixed.", the setting, its range, the value in quotes, and "Open Autopilot's settings".
- 04-form-quoted-90-unflagged-light.png: the form that button opens: the cursor in Quiet time, which shows 90 with no red border and no hint; Save stayed off when I typed 90 (finding 1).
- 05-after-fix-resumes-light.png: 10 s after the fix: the cut-off sessions told to carry on, Limericks asked, the goal's start after its note.
- 06-session-watch-off-light.png: Session Watch off in Plugins: "Autopilot needs Session Watch, which is not running." with "Open Session Watch in Plugins" and "Check again"; on again, the page came back and the question kept its entry and time.
- 07-switch-off-light.png: the switch off: "Off: no notes, no resumes, no goal starts. Nothing scheduled will run.", "Applies when Autopilot is on.", the question withdrawn; the row's "its question was withdrawn (4 min ago)" carries the time it was asked (nit 11).
- 08-after-kill-two-asked-you-light.png: after the kill: three carry-on notes delivered, Limericks' one question twice in the log as "asked you", and the 6:05 goal start still "waiting for a round" (finding 2).
- 09-narrow-760-light.png, 10-narrow-760-dark.png: 760 px: DSH's sidebar folds to icons, the header, rows and rule controls wrap and nothing spills; the stale "asked you" still sits under the answered one.
- 11-goal-failed-row-light.png: Octopus goal after its failed turn: "failed", "next: retry at 6:16 PM".
- 12-gave-up-tagged-backed-off-light.png, 13-gave-up-tagged-backed-off-dark.png: after the third failed try: "Autopilot stopped retrying: it kept failing." with Try again, tagged "backed off" (nit 9).
- 14-enabled-false-light.png: `enabled: false`: "switched off in DSH's profile … so it watches nothing" and how to change it; its log shows Try again refused ("exhausted 4 goal rounds", finding 3) and a question still "asked you" from the forced restart just before (finding 2).
- 15-four-questions-light.png, 16-four-questions-dark.png: after the clean restart, with Ask first the default: four questions, Draft outside's with its first time ("Asked 2 min ago"); Octopus goal's row says "last: started its goal again after an error" for the refused start (nit 10).
- 17-session-watch-in-quotes-light.png: Session Watch's `deliveryTimeoutSeconds: "600"`: Autopilot's header names it with the value; after that forced restart, Draft outside's question reads "Asked just now" again (finding 2).
- 18-session-watch-form-600-unflagged-light.png: Session Watch's form: 600 with no flag, Save off (finding 1).
- 19-plugins-autopilot-off-light.png: Autopilot switched off in Plugins: its sidebar entry and its style sheet gone; on again, both back and no note sent again.
- 20-log-what-it-sent-light.png: the log with "What it sent" open on a carry-on note, and the stale "asked you" below the answered question (finding 2).
- 21-open-goes-to-session-light.png: Open on a question goes to the session: Draft outside's chat, its turn closed by DSH's restart.
- 22-held-answer-asked-again-light.png: my "Tell it to carry on" held by the hourly limit ("Held back · You"), and the same question asked again 10 minutes later with the hour still full (finding 4).
- 23-empty-instance-light.png, 24-empty-instance-dark.png: an empty instance: "Watching 0 sessions · 0 notes this hour; the limit is 20", "No sessions yet: Start a chat in DSH…", "Nothing yet: When Autopilot acts, asks or holds back, it says what and why here."
- e2e-app-autopilot-light.png, e2e-app-autopilot-dark.png: the e2e on the app's DSH (scripted model): a question and a back-off in "Waiting for you", a row with "Waits for you: its last reply asks you something."
- e2e-app-try-again-refused-light.png: Try again while off: "Not changed. Autopilot is off: switch it on at the top of its page first." inside the card, under its row.
- e2e-app-settings-flagged-light.png: a value out of range (2) flagged in the form at once, with what fits.
- e2e-rc1-log-dark.png: the log on DSH 0.2.1-rc.1 in dark: nudges delivered, the back-off, a question withdrawn by the switch.
- e2e-rc2-run1-rule-keys-before-failure-light.png, e2e-rc2-run1-failed-buttons.png: the run that failed: the focus ring on Changelog's Auto with no "Press Enter to apply" line, on a row nudged a moment before (finding 6).

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

No blockers and no majors.

### Minor

1. **A number in quotes in the profile shows in the form as a value that fits, and the form will not save it as shown.**
   - Where: `shared/client-kit.js` `fieldSpec()` (line 695), copied into `plugins/autopilot/lib/client.js` (line 690) and `plugins/session-watch/lib/client.js` (line 680). For a number setting, `format` passes a stored string through `raw()`, which returns it as it is, so "90" shows as 90; that text parses as a fitting value, so the check at line 928 flags nothing.
   - What:
     - With `idleSeconds: "90"`, Autopilot's page named the setting and the value in quotes, and its button opened the form with the cursor in Quiet time showing 90, unflagged (pictures 03, 04). Typing 90 again, or Use the default and then 90, left Save off: to the form the text had not changed. Only saving another value fixed it (Use the default and Save, 6:05:48). Autopilot does no work until then.
     - The same for Session Watch's `deliveryTimeoutSeconds: "600"` (pictures 17, 18). By the same code a list written as text (`errorRetrySeconds: "30, 90"`) would show as a fitting list; I did not try that live.
     - README lines 92 and 93: "a value saved in the profile that does not fit is flagged the same way as soon as the form opens".
     - The e2e starts DSH with numbers in quotes and checks that the page names them, but it never opens the form while a value is in quotes. Its form check of Session Watch's 60 runs after a restart that writes a plain number.
   - Fix: show a stored value of the wrong type so that it fails to parse (for example with its quotes, `"90"`), so that the form flags it as it opens and typing 90 counts as a change. Add an e2e step that starts with a number in quotes, opens the form, sees the flag, types the number, saves, and sees "Settings fixed". The code is in `shared/`, so the fix reaches every suite plugin's form (Canon's round-2 judge found the same there).

2. **A forced quit or a crash leaves Autopilot's open questions "asked you" for ever, and asks them again as new entries.**
   - Where: `plugins/autopilot/lib/pilot.js` `setAsksAside()` (line 248) runs only from `stop()` (line 233), when the plugin's scope ends (`index.js` lines 129 to 134). `ask()` (line 668) reuses an entry only when it is withdrawn with `stopped: true` (line 677). Nothing at start settles what a killed process left. A goal start's proof (`awaitRound`, line 648) lives only in memory too.
   - What:
     - With real-model turns running, DSH Test's quit took its forced path at all three restarts (6:02:42, 6:26:19, 6:29:06), and I killed DSH at 6:11:29. Clean stops worked as the README says (finding 1 of round 3, below).
     - After the kill, Limericks' question from 6:10:27 stayed "asked you", and the same question (turn 1, cut off at 6:01) was added again at 6:11:47 (pictures 08, 09, 10, 20). By the code that is also a second notification (line 704); Notifications was not loaded in my instance.
     - I answered the new entry at 6:12:55. The old one stayed "asked you" until Autopilot was switched off in Plugins at about 6:26, which marked it "withdrawn: Autopilot stopped (DSH quit, or Autopilot or Session Watch was switched off); it asks again when it runs, if this still applies". That question had been answered.
     - After the forced restart at 6:29:06, Draft outside's and Logo color's questions (open since 6:26:03 and 6:27:51) were added again at 6:29:48, and Draft outside's "Asked 2 min ago" became "Asked just now" (pictures 15, 17). At the end of my run the log held five "asked you" entries for three questions.
     - With `enabled: false` (6:27) the page said Autopilot watches nothing while its log showed a question "asked you", left by the forced restart (picture 14).
     - Octopus goal's start at 6:05:58 still says "waiting for a round": the kill cut its carry-on turn, and nothing settled it (pictures 08, 20).
     - README lines 68 to 74: "A question still open when DSH quits … is marked *withdrawn* … asked again under the same entry, with the time it was first asked." Its table of jobs names a crash as a case it handles.
   - Fix: when the pilot starts, settle what the last process left before the first scan. Every "asked you" entry becomes withdrawn with `stopped: true` and the reason "DSH stopped (a crash or a forced quit)", so `ask()` reuses it. A goal start still "waiting for a round" and a note still "in the queue" are checked against the session's log (round begun, note read) or marked "not proven: DSH stopped first". Add an e2e step that kills DSH (as its crash step does) under an open question and a goal start waiting for its round.

3. **Error retries spend the goal's rounds, and can leave it unable to start.**
   - Where: `pilot.js`, the error retry goes through `rearm()` (line 602), which calls DSH's goal resume; each resume begins a new goal round.
   - What:
     - From 6:13:14 my fault switch failed every request of Octopus goal (a 4-round goal at round 1). The three retries each began a round: 2 of 4 at 6:16:54, 3 of 4 at 6:18:01, 4 of 4 at 6:21:16. Each failed within seconds.
     - After the give-up (6:24:31) I turned the fault off and pressed Try again (6:24:48): "DSH refused to start it: goal … exhausted 4 goal rounds; increase maxGoalRounds before resuming" (picture 14). The goal had done one round of work; three went to retries into a dead gateway, and it cannot go on until the person raises its limit.
     - With the default `errorRetrySeconds` (three tries, 2, 10 and 30 minutes apart), any goal with three or fewer rounds left ends this way after an outage of about 45 minutes. The README's error row and the Why line ("which stops a goal; the goal … was still active") do not say that a start uses a round.
   - Fix: after an error, send a carry-on note first (a note costs no round), and start the goal again only once a turn has finished without an error. Never spend a goal's last round on a blind retry: ask instead. Say in the README, and in the Why line, which round a start uses ("round 3 of 4").

4. **The hourly limit holds the person's own answer, then asks the question again.**
   - Where: `pilot.js` `answered()` sends the action through `takeNote()` (line 516), which holds it and plans again in 10 minutes (line 556); under Ask first, that plan is a new question.
   - What: at 6:31:06 I set Notes an hour, at most, to 15 (15 were sent). At 6:31:10 I pressed Tell it to carry on for Haiku list. The question was marked answered, and the log said "Held back · You. Why: Autopilot already sent 15 notes in the last hour, the most it sends; it tries again when the hour has room." At 6:41:10 it asked the same question again as a new entry (picture 22), with the hour still full, so a second yes would be held the same way. My answer was lost. The README says of the limit only "Past it, it holds back and says so once."
   - Fix: do not count a person's answer against Autopilot's own limit (the limit stops Autopilot, not the person). Or, if it must count, refuse it in the row with the reason, as Try again while off is refused, and leave the question open.

5. **A cut-off session that Autopilot has not seen since its start is not offered when its rule leaves Off.**
   - Where: `pilot.js` `recheck()` reads the in-memory state of sessions seen since the start, and `scan('switch')` reads only the rows' state; only `scan('start')` finds cut-off sessions in the logs (`watch.cutOffSessions()`).
   - What: Draft outside (cut off by the 6:02:42 restart, rule Off) was set to Ask first at 6:17:08. No question came then, nor after the switch off and on at 6:18, nor after the default rule changed to Ask first at 6:25:12. Its row said "cut off" and "last: rule set to Ask first (1 min ago)", with no line saying why Autopilot waited. The question came at 6:26:03, after Autopilot was switched off and on in Plugins (a new start).
   - Fix: on a rule change or the switch, look at cut-off sessions in the logs as the start does. Give every cut-off row a why line when nothing is planned.

6. **The e2e's rule-keys step failed once in my five runs.**
   - Where: `plugins/autopilot/test/e2e/run.mjs` line 499 (in the step "the page's buttons"); the rule control's choice made with an arrow key in `client.js`, which is dropped on a blur or when its value changes.
   - What: my first run on DSH 0.2.0-rc.2 failed with "timed out waiting for Enter to apply Ask first" (97 passed, 1 failed; the rest of that step did not run). Its picture shows the focus ring on Changelog's Auto and no "Press Enter to apply Ask first." line, on a row nudged a moment before. The next four runs passed. I did not find the cause; the picture fits a redraw of the row dropping the choice, and then a person's Enter would do nothing.
   - Fix: keep a pending choice across redraws of its row (keyed by the session) until Enter, Escape or a blur that leaves the control; test it while the list changes; run the e2e more than once before a tag.

### Nits

7. 90 seconds reads "2 minutes": the header said "gets a note after 2 minutes of quiet" and a Why line "idle for 2 minutes" with `idleSeconds: 90` (pictures 01, 14). `spanWords()` in `shared/host/words.js` (line 273, copied into both plugins) rounds 90 s up. Fix: seconds up to 2 minutes, or "1½ minutes".
8. A goal start credited with another start's round: the start after the carry-on note at 6:11:47 (DSH's goal revision 3) never got a round, as its turn failed at 6:16:24; it still says "started · round 2 began", the round the 6:16:54 retry began, so two entries claim round 2. `awaitRound()` takes any round of the goal for up to 3 hours. Fix: take only a round of the revision this start made, and mark the other "not started: its turn failed before a round".
9. A give-up is tagged "backed off" in the Waiting card and the log (pictures 12, 13), the word for the nudges' back-off. Fix: "gave up" (the tone table has it).
10. The row's "last:" follows the entry's text, not its state: after Try again was refused, Octopus goal's row said "last: started its goal again after an error (4 min ago)" (picture 15). `page.js` `lastWords()`. Fix: "last: DSH refused to start its goal".
11. "last: its question was withdrawn (4 min ago)" carries the time it was asked, not withdrawn (picture 07).
12. After the third failed try the row said "next: retry at 6:24 PM"; at 6:24 it gave up. Fix: "next: gives up at 6:24 PM".
13. Switching Autopilot on started the errored goal at once (6:18:01), 38 s before its wait ended.
14. "Settings changed: 'Quiet time before a note'" does not say the new value (pictures 01, 22). Fix: "… now 90 seconds (was 600)".
15. Without Decisions, the page's badge call to Decisions (`client.js` line 1152) leaves a 404 in the window's console.
16. Both `package.json` files say 1.0.0, and Plugins shows v1.0.0 (picture 04): tagged as v1.0.1, they would report 1.0.0.

Not scored:
- DSH Test's quit took its forced path after 30 s at all three restarts with real-model turns running, as in rounds 2 and 3; finding 2 is about what Autopilot does after it.
- The gateway was slow, so Draft outside never reached its approval prompt live; the approval note is covered by the e2e on three builds.

### DESIGN.md "Before you push", ticked for Autopilot's page and both settings forms

- [x] Surfaces: glass cards on its own page (pictures 01, 02, 23, 24); its settings and Session Watch's are DSH's own form in Plugins, with no ground of theirs (04, 18).
- [x] Only DSH tokens that exist in both versions: the client's 25 `--dsw-*` and `--dsh-*` tokens are each in both DSH builds in `.e2e` (I searched every one), and from Wallpaper only `--wp-blur`, `--wp-tint` and `body.wp-still`.
- [x] No DSH hash selectors, nothing styled on `:root`, `html` or `body` (`body:not([data-ds-dark-theme])` and `body.wp-still` only scope its own classes), no `:has()`.
- [x] Motion stops under `wp-still` and reduced motion, `::before` and `::after` included; the glass thickens under reduced transparency.
- [x] `node --check` passes on both clients, and `npm test` passes in the archive build (806 of 806, with the naming scan).
- [x] Both DSH versions (the e2e on three builds) and both themes. Wallpaper: off in my instance; on only through the e2e's stand-in (`--wp-tint` at .2 over a mid grey, light and dark). I did not load Wallpaper itself this round.
- [x] Off leaves nothing behind (Plugins off took its sidebar entry and style sheet, picture 19), and on again repeated nothing.
- Outside the list: §9's "states say what to do next" misses the cut-off row with no reason (finding 5), and the words in nits 7, 9, 10 and 12 say the wrong thing.

## Round 3 findings

1. A question open when Autopilot stops, asked again each start as a new entry: partly fixed. Clean stops now settle it and bring it back under the same entry and time: Session Watch off and on at 6:09 to 6:10 kept Limericks' entry and its time, and after the clean restart at 6:27:37 Draft outside's question kept "Asked 2 min ago" (picture 15). The switch and rule Off still withdraw with their reason (picture 07), and the e2e checks a quit under an open question. A forced quit or a crash does not (finding 2). The row's last action now follows a question's state, with the wrong time (nit 11).
2. Focus lost after Try again or an answer, refusal on the wall: fixed. The refusal is inside the card under its row, as an alert with the focus (e2e picture). Live, after Leave it and after Tell it to carry on the focus went to the next question's first button, and after Try again emptied the card it went to the Sessions heading.
3. The Waiting card on the plain tint: fixed. It is main glass now, and the e2e measures its small text at Wallpaper's tint .2 over a mid picture, light and dark.
4. "idle" in DSH's glyph colour: fixed. The neutral tone is deepened: "stopped" and "withdrawn" measured 6.95:1 in light and 8.68:1 in dark on DSH's ground; every state word measured 5.83 to 6.95:1 in light and 8.68 to 11.04:1 in dark, and every small text at least 5.04:1 in light and 8.68:1 in dark.
5. Tests missing the above: partly fixed. Added: a quit under an open question, a contrast check per tone at a low tint, focus after Try again and an answer. Not added: a crash under an open question (finding 2).
6. The goal start after a carry-on note not counted toward the hour: fixed (`note()` counts it).
7. "Not changed: Autopilot is off: …": fixed ("Not changed. Autopilot is off: …").
8. `data-autopilot-header="on"` with `enabled: false`: fixed.

## What would make it a 9.5

- The log stays true across a crash or a forced quit: at start, settle what the last process left (questions reused under their entry, goal starts and queued notes checked against the logs), with an e2e kill under an open question and a waiting goal start (finding 2); a goal start proven only by its own revision's round (nit 8).
- Error retries that do not spend a goal's rounds into a dead gateway, and a README and Why line that say which round a start uses (finding 3).
- A person's answer never held by the hourly limit (finding 4), and rule or switch changes that look at cut-off sessions in the logs, with a why on every cut-off row (finding 5).
- The settings form flags a value of the wrong type and saves the number typed back in, fixed in `shared/`, with an e2e step that fixes a number in quotes through the form (finding 1).
- A keyboard choice that survives a redraw, and the e2e run several times before a tag (finding 6).
- The wording nits (7, 9 to 14), no console error without Decisions, and 1.0.1 in both `package.json` files.

## Live DSH fingerprint (before and after)

- Before (5:39 PM PDT): pid 18756, started Sat Oct 17 10:39:36 2026, `cordis.patch.yml` sha256 63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7.
- After (6:45 PM PDT): pid 18756, started Sat Oct 17 10:39:36 2026, `cordis.patch.yml` sha256 63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7. Unchanged. Each e2e run also found it unchanged.
- I destroyed my instance, suite-autopilot-j4, at 6:44:59 PM. I touched no other instance.
