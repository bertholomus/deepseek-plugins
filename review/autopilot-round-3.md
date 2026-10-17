# Autopilot: judge round 3

Commit ea10517b4c50d7c63c4667a94cd724e878415cf8 (branch suite/v1), judged Sat Oct 17 2026, 2:03 to 2:46 AM PDT. DSH Test instance suite-autopilot-j3 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3. Session Watch was judged with it, as its dependency.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9 | With the real model it did every job in its brief section: 7 resumes over 3 restarts (a reply cut off mid-story, a goal mid-round, a write waiting for approval, a question in DSH's question box), 4 idle nudges and a back-off, Ask first, Off and the switch, and a goal started again after its carry-on note that then ran to its last round with no step repeated or skipped. |
| Reliability | 8.5 | All 12 "delivered" claims and the one goal start are proven in the sessions' own logs, no hold outlived its turn, and 4 restarts and 3 off/on cycles repeated nothing. But a question that is open when Autopilot stops is never settled in the log, and each start asks it again as a new entry: one open question ended as six "asked you" lines (finding 1). |
| UX / polish | 8 | Round 2's keyboard, form, question-box and Session Watch problems are fixed, and the empty, waiting, wrong-setting, off and `enabled: false` states say what to do, at 760 and 420 px, light and dark. But focus still falls out of the page after Try again or an answer, the refusal line is red text on the wall above the cards, the Waiting card's small text sits on the plain tint, and "idle" is drawn in DSH's glyph colour at 3.6:1. |
| Test depth | 8.5 | 485 unit tests pass in the archive build, and the 87-check real-DSH test passes on all three builds; it now quits under an approval and a question-box wait, drives the rule keys and switches Session Watch off in the window. Nothing tests a question that is open across a stop, the contrast check covers one tone with Wallpaper off, and no check follows the focus after Try again or an answer. |
| Docs | 9 | The README matches the window on the settings and their ranges, the troubles, switching off, `enabled: false`, the chat's "Plugin status updated" card and the 87 checks. Two lines promise more than the code does: a question "ends answered, or withdrawn", and goal starts count toward the hourly limit. |

Plugin score: min(9, 8.5, 8.6) = 8.5. Verdict: PASS (8.5, and no criterion is below 8).

## What I ran

- 2:03 AM: read the live fingerprint. Built ea10517 with `git archive` into my scratch folder, with the `.e2e` link. `npm test` there: 485 of 485 pass, the naming scan included.
- 2:04 to 2:11 AM: `node scripts/e2e.mjs autopilot` from the build: 87 of 87 on DSH 0.2.0-rc.2 (123 s), 0.2.1-rc.1 (132 s) and the app build of 0.2.0-rc.2 (125 s), the live fingerprint unchanged after each. No build needed a re-run. I read its checks in `plugins/autopilot/test/e2e/run.mjs`.
- 2:05 AM: `dsh-test --name suite-autopilot-j3 up`. In that instance's `profiles/desktop/cordis.patch.yml` only: `defaultPreset: workspace-write` (approval: ask). Loaded Session Watch, then Autopilot with `idleSeconds: 60` and `startDelaySeconds: 5`. Loaded Wallpaper (`~/.dsh-test-plugins/wallpaper`), put one light picture (a mountain lake) and one dark picture (a black car under a white ring of light) into my instance's `wallpaper/wallpapers/test/`, and set the glass tint to 20%.
- 2:07 to 2:12 AM: 8 real-model sessions in workspace `ws`: Haiku todos and Stuck todos (todo lists left open; Stuck todos was told to answer any carry-on note with one word and change nothing), Ask first todos (rule Ask first), Outside write (a write outside the workspace with escalated permissions, so DSH asks for approval), Deploy question (DSH's question box), Limerick goal and Moon facts goal (`create_goal`, 8 and 30 rounds), and Lighthouse story (one 3000-word reply).
- 2:08 to 2:11 AM: idle nudges after 60 s; Stuck todos backed off at 2:10:51; a keyboard sweep of the rule controls at 2:11.
- About 2:12 AM: quit DSH Test under four open turns (Lighthouse story mid-reply, Moon facts goal mid-round, Outside write waiting for approval, Deploy question waiting in the question box) with Ask first's question open, and started it again.
- 2:15 to 2:16 AM: the switch Off and On, Try again while off, rule Off on a session with an open question, then Ask first again and "Tell it to carry on".
- 2:17 to 2:20 AM: the page in light and dark with Wallpaper on over both pictures, then with Wallpaper switched off in Plugins. In each of the six views I measured every text element of the page against what is behind it (the picture as drawn, through the glass).
- 2:20 AM: Session Watch off in Plugins, then on.
- About 2:21 AM: `idleSeconds: 2` in my profile's Autopilot row and a restart under two waiting turns (Outside write and Deploy question had asked again after their notes). Read the page and the form its button opens; fixed the value in the form at 2:23.
- 2:24 AM: 760 px in light and dark, and a 420 px window.
- About 2:25 AM: `enabled: false` and a restart; the switch's endpoint and Try again while it was set; then `enabled` removed and a restart at about 2:27.
- 2:31 to 2:33 AM: the log with one open question; a note as it shows in a session's chat; Autopilot switched off and on in Plugins.
- 2:34 AM: reset my instance to an empty one (`dsh-test --name suite-autopilot-j3 reset`), set the preset to workspace-write again (the fresh seed had full access), loaded both plugins with the same row, and opened the page in light and dark.
- Throughout: checked every "delivered" and "started" entry against the session's own events (the bridge's `/sessions/<id>/events`): a `user/message` with the note's text inside the claimed turn (12 of 12), and for the goal start its next `<goal_round>` message (round 14). After that the goal wrote facts 1 to 30 into its file, none repeated or skipped. The write that waited for approval never ran: its target folder stayed empty.

## What I saw (each picture, one line)

Pictures are in `review/autopilot-round-3/`. Pictures of the whole log card (08, 10, 12) show grey below it where the shot runs past the window; that is the shot, not the page.

- 00-wallpaper-panel.png: Wallpaper's panel with my two test pictures.
- 01-page-light-first.png: the page at 2:08 on the lake: Ask first's question in "Waiting for you", rows with their state, next check and last action.
- 02-sessions-all-waiting-light.png: All: Deploy question "waiting for your answer" with "Waits for you: a question in DSH's question box.", Outside write "waiting for approval" with "Waits for you: a tool waits for you to allow or reject it." (round 2's findings 1 and 3).
- 03-rule-keys-arrow-light.png: after one ArrowRight on a row's rule: the ring on Ask first, "Press Enter to apply Ask first.", Auto still applied.
- 04-page-light-before-quit.png, 05-waiting-light.png, 06-log-light-before-quit.png: the page, the Waiting card and the log just before the quit: the question, the backed-off Stuck todos with Try again, the nudges delivered.
- 07-page-light-after-quit.png, 08-log-light-after-quit.png: after the quit: four carry-on notes delivered, the approval one ("A tool was waiting for approval when it stopped; the note says it did not run.") and the question-box one ("the note says to ask again"), and "Started its goal again after the carry-on note", "Round 14 began."
- 09-off-light.png, 10-log-off-light.png: the switch Off: "Off: no notes, no resumes, no goal starts. Nothing scheduled will run.", "Applies when Autopilot is on.", and the question withdrawn "you switched Autopilot off".
- 11-try-again-while-off-light.png: Try again while off: "Not changed: Autopilot is off: switch it on at the top of its page first." in red on the picture, between the header card and the Waiting card (finding 2).
- 12-withdrawn-rule-off-light.png: rule Off on a session with an open question: "withdrawn", "Withdrawn: you set its rule to Off." (round 2's finding 7).
- 13-page-light-wallpaper-lake-tint20.png, 14-page-dark-wallpaper-lake-tint20.png: the lake at tint 20, light and dark: the page reads; the Waiting card is thinner glass than the cards below it.
- 15-page-dark-wallpaper-car-tint20.png, 16-page-light-wallpaper-car-tint20.png: the car at tint 20. In dark, the Waiting card's grey text over the white ring measured down to 2.6:1. In light, the Waiting card's grey text over the black car is nearly unreadable, plainly weaker than the same text on the Sessions card below (finding 3); the rest of the page is greyed too (DESIGN's hard case).
- 17-page-light-wallpaper-off.png, 18-page-dark-wallpaper-off.png: Wallpaper switched off: frosted cards on DSH's plain ground, nothing left over.
- 19-plugins-watch-switched-off-light.png: Session Watch switched off in Plugins: no toast, Autopilot's switch still on (round 2's finding 5).
- 20-page-watch-off-light.png: "Autopilot needs Session Watch, which is not running." with "Open Session Watch in Plugins" and "Check again".
- 21-page-back-after-watch-on-light.png: Session Watch on again: the page came back by itself.
- 22-wrong-setting-light.png, 23-wrong-setting-dark.png: `idleSeconds: 2`: "Autopilot is waiting for a setting to be fixed.", the setting, its range and its value, "Open Autopilot's settings", and the log entry.
- 24-settings-flagged-light.png: the form that button opens: the cursor in Quiet time, a red border and "A whole number from 5 to 86400, or empty for the default (600)." (round 2's finding 4).
- 25-settings-saved-light.png: the rest of the form and Save; the cut-off sessions got their notes 5 s after the save.
- 26-narrow-760-light.png, 27-narrow-760-sessions-light.png, 28-narrow-760-dark.png: 760 px: header, rows and rule controls wrap, nothing spills.
- 29-window-420-light.png: 420 px: one column, buttons under their text; the Waiting card's grey text is faint over the white ring.
- 30-enabled-false-light.png: `enabled: false`: "switched off in DSH's profile … so it watches nothing", how to change it, the log kept.
- 31-enabled-false-refusal-light.png: the same page after my tries to act on it (it offers no switch, rows or Try again); its log still shows three questions "asked you" while Autopilot watches nothing (finding 1).
- 32-one-question-many-asked-you-light.png: one open question in "Waiting for you"; the log has an "asked you" entry for each restart and off/on (finding 1). The Waiting card's "Autopilot backed off: its notes brought no progress." is nearly invisible over the white ring (finding 3).
- 33-note-in-chat-light.png: Deploy question's chat: the notes are DSH's collapsed "Plugin status updated" cards; the agent's last reply ends with a DECISION NEEDED line, as the note asks.
- 34-autopilot-off-in-plugins-light.png: Autopilot switched off in Plugins: its sidebar entry and its style sheet are gone; switched on, both came back and no note was sent again.
- 35-empty-instance-light.png, 36-empty-instance-dark.png: an empty instance: "Watching 0 sessions · 0 notes this hour", "No sessions yet: Start a chat in DSH…", "Nothing yet: When Autopilot acts, asks or holds back, it says what and why here."

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

No blockers and no majors.

### Minor

1. **A question that is open when Autopilot stops is never settled in the log, and each start asks it again as a new entry.**
   - Where: `plugins/autopilot/lib/index.js` lines 127 to 132: when the scope ends, the cleanup calls `watch.dropAsk(ask.id)` for Autopilot's questions but never `settleAsk`, so their entries keep "asked you". On the next start the pilot raises the same question (same id) as a new entry, and `settleAsk` settles only the newest. `page.js` `lastWords()` also says "asked you" for an ask entry in any state.
   - What:
     - Ask first todos had one open question at a time. Its log ended with six "asked you" lines: 2:08:49 (turn 1, dropped by the quit at about 2:12 and never settled), the real turn-2 question at 2:17:17, and four copies of it at 2:20:39, 2:23:14, 2:26:59 and 2:33:31, one after each of Session Watch off and on, the wrong-setting restart, the `enabled` restart, and Autopilot off and on in Plugins (pictures 22, 31, 32).
     - With `enabled: false` the page said Autopilot watches nothing while its log showed three questions "asked you" (31).
     - "Asked 4 min ago" on the Waiting card restarts at each copy.
     - README lines 65 to 67: "A question ends *answered*, or *withdrawn* with the reason". The switch and rule Off do this (picture 12); a stop does not.
   - Fix: when the scope ends, settle each open question as withdrawn with its reason ("DSH stopped", "Session Watch was switched off", "Autopilot was switched off"). Or keep the entry open across a stop and reuse it when the same id is asked again, instead of adding one. Make `lastWords()` follow the entry's state. Add a unit test (ask, end the scope, start again: one entry, one state) and an e2e check that restarts under an open question.

2. **Focus falls out of the page after Try again or an answer, and a refusal is red text on the wall, away from the button.**
   - Where: `plugins/autopilot/lib/client.js` lines 1234 and 1235: the "Couldn't refresh" and "Not changed" lines (`kit.ErrorLine`) are drawn between the header card and the Waiting card, outside any card. Try again and the answer buttons are in `WaitingCard` (line 1107).
   - What:
     - After Try again and after "Tell it to carry on", `document.activeElement` was `body`, so the next Tab starts again at the top of the window. (After Save in Plugins → Autopilot too, but that form is DSH's own `SettingsForm`.)
     - Try again while Autopilot was off showed "Not changed: Autopilot is off: switch it on at the top of its page first." in red straight on the picture, above the card whose button I pressed (picture 11).
     - DESIGN: "When something closes, focus goes back where it was.", "Errors show where the person is looking and take the focus.", "Never put text straight on the wall."
   - Fix: draw the refusal inside the card, under the button that was pressed, as its `role="alert"` line, and keep focus on that button. When an answered question leaves, move focus to the next question's first button, or to the Waiting card's heading when none is left.

3. **The Waiting card's small text sits on the plain tint.**
   - Where: `client.js` line 1110: `WaitingCard` is a `kit.Card` without `main: true`; the header, Sessions and log cards have it.
   - What: dark theme over the lake at tint 20, the Waiting card's grey text measured 3.6 to 3.9:1 and its session link 2.5:1, while the same grey text on the Sessions and log cards measured 4.9 to 9.7:1. Over the car's white ring it fell to 1.8 to 3.5:1 (pictures 15, 29, 32), and in light over the black car it is nearly unreadable next to the Sessions card's (16). It is the card a person must read and act on. DESIGN: "Keep small secondary text off the plain tint."
   - Fix: `main: true` on the Waiting card, and measure it over both pictures at a low tint.

4. **"idle" is drawn in DSH's glyph colour.**
   - Where: `client.js` `toneOf()` line 414 gives "idle" (and any word not listed) the `quiet` tone, which DSH draws in `--dsw-alias-label-tertiary` (#81858c light, #adb2b8 dark). Lines 100 to 103 deepen warning, danger, success and info, but not quiet.
   - What: the 11 px "idle" on most rows measured 3.57:1 in light with Wallpaper off, on DSH's own ground, and 2.4 to 3.7:1 over the pictures at tint 20. DESIGN's colour table: tertiary is for "Glyphs, never small text". Round 2's finding 6 asked for the state words at 4.5:1.
   - Fix: deepen the quiet tone like the others (`color-mix` toward the label colour, as `--x-text-2` does), and extend the e2e's contrast check to every tone.

5. **The tests miss the two things above.**
   - Where: `plugins/autopilot/test/e2e/run.mjs` line 347 and its `contrastOf` (line 165); `test/autopilot.test.js`.
   - What: the contrast check measures one warning word, with Wallpaper off, composited on DSH's ground, so it passes while "idle" is 3.57:1 and the Waiting card fails over a picture. No unit or e2e test keeps a question open across a stop (finding 1), and the keyboard checks follow the focus on the rule controls only, not after Try again or an answer (finding 2).
   - Fix: a check per tone, one with Wallpaper's tint set low over a light and a dark ground, a restart under an open question, and focus checks after Try again and an answer.

At a tint of 20% most small text on every card falls under 4.5:1 over the car in light (1.4 to 2.6:1). DESIGN names light glass over a dark picture as the hard case, where at the default tint only primary text passes, and leaves the tint to the person, so I do not score that part against the plugin; findings 3 and 4 are the parts the plugin can fix.

### Nits

6. The hourly limit does not count the goal start that follows a carry-on note: `pilot.js` line 566 calls `rearm()` straight from `note()`, past `takeNote()`. At 2:31 the header said 12 notes this hour after 12 notes and 1 goal start (picture 32). The setting's hint and the README say goal starts are included. Fix: take a note for that start too, or say in both places that it rides on its note.
7. "Not changed: Autopilot is off: switch it on at the top of its page first." has two colons in a row (picture 11). Fix: "Not changed. Autopilot is off: switch it on at the top of its page first."
8. With `enabled: false` the header card still carries `data-autopilot-header="on"`. Nothing a person sees, but a test reading it would be misled. Fix: "disabled".

Not scored:
- DSH Test's quit took its forced path after 30 s while real-model turns ran, as in round 2. With the scripted model the e2e quits cleanly. I found no cause in Autopilot.
- With Wallpaper on, DSH's own Plugins pages sit on the bare picture (pictures 19, 24, 25, 34), so the form's hints are hard to read there. That is Wallpaper's to fix.

### DESIGN.md "Before you push", ticked for Autopilot's page

- [x] Surfaces: glass cards on its own page; its settings form paints no ground on DSH's Plugins page. (The refusal line outside the cards is finding 2.)
- [x] Only DSH tokens (`--dsw-alias-*`, `--dsw-font-*`, `--dsw-radius-*`, `--dsw-focus-ring-color`), drawn alike on both DSH versions in the e2e pictures, and from Wallpaper only `--wp-blur`, `--wp-tint` and `body.wp-still`.
- [x] No DSH hash selectors, nothing styled on `:root`, `html` or `body` (`body:not([data-ds-dark-theme])` only scopes its own classes), no `:has()`.
- [x] Motion stops under `wp-still` and reduced motion; glass thickens under reduced transparency.
- [x] `node --check` on the client passes, and `npm test` passes in the archive build (485 of 485).
- [x] Both DSH versions (the e2e), both themes, Wallpaper on and off over a light and a dark picture (pictures 13 to 18).
- [x] Off leaves nothing behind (Plugins off removed the entry and its style sheet, picture 34), and on again repeated nothing.
- Outside the list: rule 6 (text at 4.5:1) fails for "idle" and for the Waiting card over a picture (findings 3, 4); §9 for focus after Try again and an answer, and §3 for the refusal on the wall (finding 2).

## Round 2 findings

1. An approval cut off by a restart held the session for ever: fixed. Outside write's write waited for approval when I quit; after the restart its row did not hold it, and its note said the call did not run (2:13:08, delivered), the same after two more restarts (2:23:14, 2:26:59). The agent asked for approval again after the first two notes, and after the third reported that the file was not created; nothing was written. Session Watch now clears approvals at turn start and turn end, with a unit test and an e2e step.
2. One arrow key changed a rule, and focus left the page: fixed for the rule controls. An arrow only shows the choice with "Press Enter to apply Ask first." (picture 03), Enter applies it with the focus kept, Escape takes it back and sends nothing. Focus still leaves the page after Try again and an answer (finding 2).
3. A session in DSH's question box read as "running": fixed. Its row says "waiting for your answer" (picture 02), and after the quit its note said its question had no answer and to ask again (2:13:08, delivered). The agent asked again, and after the next cut-off ended with a DECISION NEEDED line (picture 33).
4. The form did not flag the wrong value: fixed. It opens with the cursor in the wrong setting, flagged in red with what fits (picture 24); Save fixed it at 2:23:09 and the waiting sessions got their notes 5 s later.
5. "Could not disable" for Session Watch: fixed. No toast (picture 19); Autopilot's page said what it needs (20) and came back by itself (21).
6. Amber state words at 2:1: partly fixed. Warning words are deepened: 6.3:1 in light and 10.6 to 11:1 in dark with Wallpaper off. Over the lake at tint 20 they measured 3.4 to 4.9:1 in light and 3.2 to 6.3:1 in dark (the low ones on the Waiting card, finding 3), and 2.3 to 3.3:1 in light over the car, DESIGN's hard case. "idle" was not deepened (finding 4).
7. Withdrawn questions kept a wrong state: partly fixed. The switch (2:15:06) and rule Off (2:15:58) mark the question "withdrawn" with the reason (pictures 10, 12), and an answer marks only its own question (2:16:12). A question open at a stop stays "asked you" for ever (finding 1).
8. Relative times stopped: fixed. With the page open and nothing changing, "just now" moved to "1 min ago" and on; the page redraws them every 30 s.
9. "1 notes": fixed. "1 note this hour", "12 notes this hour; the limit is 20", "0 notes this hour" (pictures 01, 32, 35), "2 notes in a row" in the back-off line. I did not push past the limit live this round; the header's words for it are "N notes this hour; the limit is M".
10. `setPaused` answered while `enabled: false`: fixed. It answers "Not changed: Autopilot is switched off in DSH's profile (enabled: false), so it watches nothing."
11. The README's check count: fixed. It says 87, and the e2e ran 87 on each build.
12. Notes show as DSH's "Plugin status updated" card: unchanged, as it is DSH's way of showing a plugin's message (picture 33), but the README now says so and how to open the card (lines 34 to 36). I count it as handled.

## What would make it a 9.5

- The log stays true across stops: one entry per question, settled with its reason when Autopilot stops, and the row's last action following it (finding 1).
- Refusals inside the card at the button pressed, and focus kept after every action on the page (finding 2).
- The Waiting card at tint + .2 and every state word deepened, with an e2e check per tone over a light and a dark ground at a low tint (findings 3 to 5).
- Every goal start counted toward the hourly limit (nit 6).

## Live DSH fingerprint (before and after)

- Before (2:03 AM PDT): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020.
- After (2:45 AM PDT): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020. Unchanged.
- Then I destroyed my instance, suite-autopilot-j3. I touched no other instance.
