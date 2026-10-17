# Autopilot: judge round 2

Commit 268f67c0d7253268e3debe0f4fbf4d5543a5bc00 (branch suite/v1), judged Sat Oct 17 2026, 12:14 to 1:01 AM PDT. DSH Test instance suite-autopilot-j2 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3. Session Watch was judged with it, as its dependency.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | With the real model it did every job in its brief section: 5 resumes over 3 restarts, 7 idle nudges, a back-off, Ask first, Off, the switch, a goal started again after a restart (proven by its next round), and settings changed in Plugins with no restart. But a session whose approval was cut off by a restart is never helped again (finding 1). |
| Reliability | 8 | All 13 "delivered" claims and the one goal start are proven in the sessions' own logs, and 3 restarts and 4 off/on cycles repeated nothing. But Session Watch keeps an approval from a cut-off turn for ever, so Autopilot holds that session with a false reason, and some log states go wrong. |
| UX / polish | 8 | Every state now says what happened and what to do, in light, dark, at 760 px, and with Wallpaper on and off. But one arrow key changes a rule at once and focus falls out of the page after each rule change, the form does not flag the wrong value it was opened for, switching Session Watch off says "Could not disable", and the amber state words are about 2:1. |
| Test depth | 8.5 | 457 unit tests pass outside a clone, and the 65-check real-DSH test passes on all three builds with log proof; it now covers wrong settings, the form, Session Watch off, `enabled: false` and held rows. Nothing tests an approval across a restart (finding 1), DSH's question box, the keyboard, or switching Session Watch off in the window. |
| Docs | 8.5 | The README now matches the window on the settings, their ranges, the troubles, `enabled: false` and switching off. It still says 47 checks (there are 65), and neither README says what DSH shows when Session Watch is switched off. |

Plugin score: min(8.5, 8, 8.3) = 8.0. Verdict: NOT YET (the plugin score is below 8.5; no criterion is below 8).

## What I ran

- 12:14 AM: read the live fingerprint. Built 268f67c with `git archive` into my scratch folder. `npm test` there: 457 of 457 pass, the naming scan included.
- 12:15 to 12:22 AM: `node scripts/e2e.mjs autopilot` from the build: 65 of 65 on DSH 0.2.0-rc.2 (119 s), 0.2.1-rc.1 (130 s) and the app build of 0.2.0-rc.2 (118 s). I read its checks in `plugins/autopilot/test/e2e/run.mjs`.
- 12:14 AM: `dsh-test --name suite-autopilot-j2 up`. In that instance's `profiles/desktop/cordis.patch.yml` only: the permission row's `defaultPreset: workspace-write` (approval: ask), and Autopilot's row `idleSeconds: 60`, `startDelaySeconds: 5`. Loaded Wallpaper (`load ~/.dsh-test-plugins/wallpaper`), put one dark and one light picture into my instance's `wallpaper/wallpapers/test/`, kept the light one and set the glass tint low (pictures 01, 02).
- 16 real-model sessions in workspace `ws`, each with a todo list: Standing by (told to do one step and wait), Haiku todos, Lighthouse stories, Ocean stories (I stopped its turn), Escalated echo (a shell call with escalated permissions, so DSH asks for approval), Color question (DSH's question box), Write outside and Shell approval (early tries for an approval; neither needed one), Ask first riddles (rule Ask first), Rule off limericks (rule Off), Restart essay, Wrong setting essay, Proverbs, Goal essay (`/goal`, six rounds), Error path, Capped colors.
- 12:18 to 12:20 AM: idle nudges after 60 s: Standing by twice and then "backed off" at 12:20, Haiku todos, Lighthouse stories.
- 12:20 to 12:23 AM: rules Off and Ask first; the Ask first card and the sidebar badge; the switch Off (the rule line, Try again refused in words, its question withdrawn) and On (asked again); "Tell it to carry on".
- 12:24 AM: quit DSH Test under two running turns (Restart essay, and Color question waiting in DSH's question box) with Escalated echo waiting for approval, then started it again.
- 12:27 to 12:29 AM: Plugins → Autopilot: an out-of-range value, Use the default, Save (quiet time 45 s and new error waits); Proverbs was nudged 45 s after its turn, with no restart. Plugins → Session Watch: its one setting.
- 12:30 AM: `idleSeconds: 2` in Autopilot's row, and a restart under a running turn (Wrong setting essay). Read the page and the form its button opens; fixed the value in the form at 12:31.
- 12:32 to 12:34 AM: changed the error waits again; Goal essay and Error path; quit at 12:33 under both running turns and started again.
- 12:34 AM: the page in light and dark with Wallpaper on, then with Wallpaper switched off in Plugins.
- 12:35 AM: Session Watch off in Plugins, then on.
- 12:36 AM: `enabled: false` in Autopilot's row and a restart; Try again and the switch's endpoint while it was off; then `enabled` back.
- 12:37 to 12:40 AM: `maxNotesPerHour` 1 in the form (Capped colors held back); a keyboard sweep of the rule controls; the Ask first card on Capped colors and Leave it; 760 px in dark.
- 12:41 AM: Autopilot off and on in Plugins; `deliveryTimeoutSeconds: 5` in Session Watch's row, then back.
- 12:42 AM: wrote in Escalated echo; its next turn ended at 12:42:15 with 2 open todos and a reply that asked nothing. I watched its row to 12:43:37.
- 12:39 and 12:49 AM: checked every "delivered" and "started" entry against the session's own events (the bridge's `/sessions/<id>/events`): a `user/message` with the note's text inside the claimed turn (13 of 13), and the goal's next round (Goal essay: "Round 3 began" in the log, and turns 5 and 6 ran as its next rounds).

## What I saw (each picture, one line)

Pictures are in `review/autopilot-round-2/`.

- 00-first-look.png: the page at 12:19 on the light picture: rows with their reasons, Standing by nudged and delivered; Color question reads "running" while DSH's sidebar says "Answer" (finding 3).
- 01-wallpaper-panel.png, 02-wallpaper-panel-lower.png: Wallpaper's panel with my two test pictures, the light one kept.
- 03-page-light-wallpaper.png: light, Wallpaper on: the Ask first card, backed-off Standing by with Try again, a rule on each row with "Use the default".
- 04-page-dark-wallpaper.png: the same in dark.
- 05-off-light.png: switch Off: "Off: no notes, no resumes, no goal starts. Nothing scheduled will run.", the rule line says "Applies when Autopilot is on.", the card says "Autopilot is off: switch it on to act on these."
- 06-off-try-again-light.png: Try again while off: "Not changed: Autopilot is off: switch it on at the top of its page first."
- 07-after-restart.png: after the restart: Restart essay "told it to carry on after DSH stopped (just now)"; Escalated echo "cut off" and "Waits for you: a tool waits for approval." (finding 1).
- 08-escalated-echo-session.png: that session in DSH: the turn ended, 2 todos pending, no approval waiting.
- 09-plugins-autopilot-settings.png: Plugins → Autopilot: the settings form, "Changed" and "Use the default" on my profile's value.
- 10-settings-out-of-range.png: 3 typed: red border and "A whole number from 5 to 86400, or empty for the default (600)."
- 11-settings-use-default.png: after Use the default.
- 12-settings-saved.png: the rest of the form (after a restart, after an error) and Save.
- 13-plugins-session-watch.png: Plugins → Session Watch: its one setting, with its words.
- 14-narrow-760-light.png, 15-narrow-760-sessions.png: 760 px, light: header and rows wrap cleanly.
- 16-wrong-setting-light.png: `idleSeconds: 2`: "Autopilot is waiting for a setting to be fixed.", the setting, its range and its value, "Open Autopilot's settings", and the log entry that names it.
- 17-wrong-setting-form.png: the form that button opens: 2 with "Changed", but no error and no focus (finding 4).
- 20-wallpaper-on-{light,dark}-{top,sessions,log}.png: Wallpaper on, both themes, the three parts of the page.
- 21-plugins-list.png: DSH's Plugins list with Wallpaper on (DSH's page on the bare picture; Wallpaper's, not scored here).
- 22-wallpaper-off-{light,dark}-{top,sessions,log}.png: Wallpaper switched off: the page on DSH's plain ground, nothing left over.
- 23-plugins-watch-off.png: Session Watch switched off in Plugins: DSH's toast "Could not disable: … did not activate autopilot … waiting for service: sessionWatch", while its switch is off (finding 5).
- 24-watch-off-light.png, 25-watch-off-dark.png: Autopilot's page: "Autopilot needs Session Watch, which is not running.", with "Open Session Watch in Plugins" and "Check again".
- 26-open-session-watch-in-plugins.png: that button opens Session Watch's page in Plugins.
- 27-session-watch-back-on.png: Session Watch on again; Autopilot's page came back by itself.
- 28-enabled-false-light.png, 29-enabled-false-dark.png: `enabled: false`: "switched off in DSH's profile … so it watches nothing", what to do, and the log kept.
- 30-note-in-chat.png: notes in a chat are DSH's collapsed "Plugin status updated" cards (nit 12).
- 31-keyboard-focus.png: after one ArrowRight on the default rule, every session without its own rule is on Ask first (finding 2); "13 of 1 notes used this hour" (nit 10); Capped colors "last: held back".
- 32-ask-card-light.png, 33-ask-card-dark.png: the Ask first card for Capped colors, and the badge on the sidebar entry.
- 34-narrow-760-dark.png: 760 px, dark.
- 35-autopilot-off-in-plugins.png: Autopilot switched off in Plugins: its sidebar entry is gone.
- 36-session-watch-wrong-setting.png: `deliveryTimeoutSeconds: 5`: Autopilot's header says Session Watch uses its default and where to change it; Capped colors "Autopilot already handled its last turn; it looks again after the next one."
- 37-stale-approval-hold.png: Escalated echo at 12:43, after my message and a finished turn with 2 open todos: still "Waits for you: a tool waits for approval." (finding 1).
- 38-withdrawn-question-log.png: at 12:49 the log says "4 min ago" for entries from 12:39 (nit 9), and a question dropped a second after it was raised still says "asked you" (nit 8).
- zoom-cutoff.png, zoom-backedoff.png: the amber "cut off" and "backed off" on the light picture (finding 6).

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

No blockers.

### Major

1. **An approval cut off by a restart holds the session for ever, with a false reason.**
   - Where: `plugins/session-watch/lib/fold.js` lines 157 to 160 (`turn/end` keeps `approvals`). Autopilot reads them in `plugins/autopilot/lib/pilot.js` line 403 (`plan()`, "it waits for an approval") and line 735 (the row's "waits for you: a tool waits for approval").
   - What:
     - Escalated echo asked for approval of a shell call at 12:19, and its turn stayed open. I quit DSH Test at 12:24 with the approval open.
     - At the restart DSH closed the cut-off turn (`turn/end`, interrupted, stamped with its last step's time) and sent no `approval/decided`. DSH shows no approval any more (picture 08), but Session Watch still lists it.
     - Autopilot did not resume the session. Its row says "cut off" and "Waits for you: a tool waits for approval." (picture 07).
     - At 12:42 I wrote in the session. Turn 2 ran and ended at 12:42:15 with 2 open todos and a reply that asked nothing. At 12:43:37, well past the 60 s quiet time, the row still said it waits for approval, and the log had no entry for it (picture 37).
     - Nothing clears the approval: not the restart, not my message, not the next turn. That session gets no resume, no nudge and no goal start again, and its row blames an approval that does not exist.
   - Fix: an approval belongs to its turn. Clear `approvals` on `turn/end` and on `turn/start`, and bump `STATE_VERSION` so saved states fold again. Add a unit test (asked, then an interrupted `turn/end`, then no approvals), and an e2e step that quits under an open approval and checks the resume note.

### Minor

2. **One arrow key changes a rule at once, and focus falls out of the page after each rule change.**
   - Where: `plugins/autopilot/lib/client.js` line 767 (the default rule) and line 813 (each session's rule): DSH's `SegmentedControl` whose `onChange` calls the endpoint, with `disabled: busy`.
   - What:
     - In a keyboard sweep, one ArrowRight on "Sessions without their own rule" put every such session on Ask first (log 12:38:53, picture 31).
     - One ArrowLeft on Rule off limericks set it to Ask first, which raised a question at once (12:39:15), before I could move on.
     - After every change, by arrow, Enter or Space, the focus was on `body`, so the next Tab starts again from the top of the window.
     - DESIGN §9 asks for one tab stop with arrows inside, and for focus to stay where the person is. The likely cause of the lost focus is `disabled: busy`, which disables the focused button while the call runs.
   - Fix: let arrows move the focus and commit on Enter or Space (or commit only after a short pause). Do not disable the focused control while saving: use `aria-busy` and ignore a second press. Add a keyboard check to the e2e: the focus stays on the chosen tab, and one arrow press sends nothing.

3. **A session waiting in DSH's question box reads as "running".**
   - Where: Autopilot's rows take Session Watch's word (`pilot.js` `holdOf()`); Session Watch already shares `userQuestions`.
   - What: Color question asked me a question in DSH's question box at 12:17 and waited. DSH's sidebar said "Answer"; Autopilot's row said "running" (picture 00), and it was not in "Waiting for you". After the restart Autopilot treated it as cut-off work and told it to carry on (12:25:38, delivered). The model asked again on its own, so no harm this time. The README's list of holds does not name the question box.
   - Fix: read `userQuestions` and show "waiting for your answer" while one is open. After a restart, say in the note that its question was not answered and that it should ask again. Add the case to the e2e and the README.

4. **The form opened from "Open Autopilot's settings" does not flag the wrong value.**
   - Where: `client.js` `SettingRow` and `applySettings` (lines 548 to 620): a saved value is only formatted, never checked against the field's range.
   - What: with `idleSeconds: 2` the page says what is wrong and offers "Open Autopilot's settings" (picture 16). The form it opens shows 2 with "Changed", no error and no focus (picture 17). A typed value is flagged at once (picture 10). DESIGN §9: errors show where the person is looking and take the focus.
   - Fix: run each saved value through the field's own check when the form opens. Show the field's words in red under a wrong one, and focus it when the form was opened from that button.

5. **Switching Session Watch off in Plugins says "Could not disable".**
   - Where: Autopilot's server entry injects `sessionWatch` (`plugins/autopilot/lib/index.js`), so DSH reports it as pending. Neither README mentions this. The e2e switches Session Watch off in the profile (`disabled: true`), not in the window.
   - What: DSH's toast says "Could not disable: dsh: warning: 1 entry did not activate autopilot (dsh-plugin-autopilot): pending (waiting for service: sessionWatch)" (pictures 23, 26). Session Watch is off all the same, and Autopilot's page says so in good words (24, 25). A person reads the toast as a failure.
   - Fix: if DSH allows an optional inject, use it and let Autopilot stay idle without Session Watch (the page already handles that). If not, say in both READMEs what DSH shows and that the switch worked. Switch Session Watch off in the window in the e2e.

6. **The amber state words are hard to read.**
   - Where: `client.js` `StateTag` (DSH's `Tag` with `toneOf(word)`).
   - What: "cut off", "backed off", "waiting for approval", "asked you" and "waiting on a setting" are 11 px amber text on a pale amber fill. That is about 2:1 on white (#F59E0B on 12% amber), and worse over a light picture at a low tint (pictures 03, 16, zoom-cutoff, zoom-backedoff). DESIGN rule 6 asks text to reach 4.5:1.
   - Fix: deepen the warning text toward DSH's label colour with `color-mix`, as DESIGN §4 does for error, link and green, on the plugin's own class. Measure it on glass in both themes.

### Nits

7. Withdrawn questions keep a wrong state in the log. Ask first riddles' first question, withdrawn by the switch at 12:22, reads "answered": answering the next one at 12:23 marks every entry with the same ask id (`pilot.js` line 666). Rule off limericks' question, dropped a second after it was raised when its rule went back to Off, still reads "asked you" (picture 38): `dropAsks` (line 176) leaves the log alone. Fix: mark a dropped question "withdrawn", with the reason, and mark "answered" only on the question that was answered.
8. Relative times stop while nothing changes. At 12:49 the log said "4 min ago" for entries from 12:39 (picture 38). `TimeText` (`client.js` line 419) reads the clock only when the page draws. Fix: one timer per page that redraws the times each minute while the page is visible.
9. "1 notes". The Held back Why says "Autopilot already sent 1 notes in the last hour" (`notes.js` line 95), and after I lowered the limit the header said "13 of 1 notes used this hour" (picture 31, `client.js` line 752). Fix: plural by count, and "13 notes this hour; the limit is 1" when over the limit.
10. With `enabled: false` the page draws no switch, but the `setPaused` endpoint still answers and logs "Autopilot is on. … It looks at every session again now." `ready()` (`remote.js` line 36) refuses only for a settings problem. Fix: refuse there too, with the words Try again already uses.
11. The README says "The real-DSH test (47 checks)" (line 164). It has 65.
12. Notes still show in the chat as DSH's collapsed "Plugin status updated" card (picture 30), as in round 1.

Not scored:
- DSH Test's quit took its forced path after 30 s each time a real-model turn was running (12:24, 12:30, 12:33). With the scripted model the e2e quits cleanly. I found no cause in Autopilot.
- With Wallpaper on, DSH's Plugins pages sit on the bare picture (pictures 09, 10, 21), so the settings form's hints are hard to read there. That is Wallpaper's to fix.

### DESIGN.md "Before you push", ticked for Autopilot's page

- [x] Surfaces: glass cards on its own page. Its settings form paints no ground on DSH's Plugins page.
- [x] Only DSH tokens; from Wallpaper only `--wp-blur`, `--wp-tint` and `body.wp-still`.
- [x] No DSH hash selectors, nothing styled on `:root`, `html` or `body`, no `:has()`.
- [x] Motion stops under `wp-still` and reduced motion, pseudo-elements included. Glass thickens under reduced transparency.
- [x] `node --check` on the client passes, and `npm test` passes in the archive build (457 of 457).
- [x] Both DSH versions (the e2e), both themes, Wallpaper on and off over a light and a dark picture (pictures 03, 04, 20, 22).
- [x] Off leaves nothing behind (Plugins off removes the entry and its style), and on again repeated nothing.
- Outside the list: rule 6 (text at 4.5:1) fails for the amber state words (finding 6), and §9 for the rule controls' keys and focus (finding 2).

## Round 1 findings

1. Raw transport error and a Retry that cannot work: fixed. With Session Watch off the page says "Autopilot needs Session Watch, which is not running.", with "Open Session Watch in Plugins" and "Check again" (24, 25). A bad setting is named in words (16).
2. The config's errors never reach the person: fixed. The page names the setting, its range and its value (16), and a bad Session Watch value too (36). `checkConfig` and `SettingsCheck` have unit tests.
3. No settings form: fixed. Plugins → Autopilot has a form with ranges, Use the default and a Save that applies with no restart (09 to 12), and Session Watch has its own (13). New gap: the form does not flag the wrong value it was opened for (finding 4).
4. Holds invisible on the page: fixed. Rows say "Waits for you: its last reply asks you something", "You stopped its last turn, so Autopilot leaves it to you.", "Autopilot already handled its last turn…" and "backed off" (03, 36). New gaps: a false approval hold (finding 1) and DSH's question box (finding 3).
5. The rule line contradicts the switch: fixed. It says "Applies when Autopilot is on." (05).
6. Try again and Tell it to carry on get past Off: fixed. Both are refused in words while off (06), and an answered note's Why says "You chose 'Tell it to carry on'." (16).
7. Test 301 needs git: fixed. 457 of 457 pass in the archive build.
8. No tests for the failure states: fixed. The e2e now starts with a wrong setting, fixes it in the form, runs with Session Watch off and with `enabled: false`, and checks a held row. Unit tests cover `checkConfig`, `SettingsCheck` and the refusals.
9. The README is wrong about `enabled: false`: fixed. It says the page stays and says how to turn it back on, which is what I saw (28).
10. "here and in Decisions": fixed. Without Decisions the hint says "Autopilot asks you first, on this page." (31).
11. Backed-off rows say "idle": fixed. The row's word is "backed off" (20-wallpaper-on-dark-sessions, zoom-backedoff).
12. Notes as "Plugin status updated" cards: not fixed (30).
13. The resume time before the restart: fixed. The Why says "Its last step was at 12:33 AM", which is what DSH's stamp is (22-wallpaper-off-dark-top).
14. A missing Playwright passes in silence: fixed, from the code: the e2e fails without Playwright unless `NO_WINDOW=1`, and its summary line names the skipped checks. I did not run it without Playwright.
15. Wallpaper on and off not checked: checked this round. The page reads well on both pictures in both themes and leaves nothing when Wallpaper goes. The amber state words are the weak spot (finding 6).

## What would make it a 9.5

- A session's holds come only from what is true now: an approval ends with its turn, and DSH's question box is a state of its own, before and after a restart (findings 1, 3), with tests that quit under both.
- The rule controls move by arrow, commit on Enter or Space, and keep the focus (finding 2).
- A wrong value is flagged where the person lands, and switching Session Watch off reads as off (findings 4, 5).
- State words reach 4.5:1 on glass in both themes (finding 6).
- The log stays true over time: withdrawn questions, ticking times, counts (nits 7 to 10).

## Live DSH fingerprint (before and after)

- Before (12:14 AM PDT): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020.
- After (12:59 AM PDT): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020. Unchanged.
- Then I destroyed my instance, suite-autopilot-j2. I touched no other instance.
