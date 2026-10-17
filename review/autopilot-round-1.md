# Autopilot: judge round 1

Commit bfe737cbba78d0fbd6fd372662dde318ba93c5ea, judged Fri Oct 16 2026, 10:45 to 11:25 PM PDT. DSH Test instance suite-autopilot-j1 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | It does every job in its brief section: with the real model I saw the resume after a restart, idle nudges, back-off, Ask first, Off and the kill switch work, each proven in the session's own log. Changing a setting still means a YAML edit and a restart. |
| Reliability | 8 | All 10 notes it sent reached a turn, checked in the session logs; a second restart and two off/on cycles repeated nothing. But a bad setting stops it with no readable message anywhere. |
| UX / polish | 7.5 | The page is clean in light, dark and at 760 px. But with Session Watch off or a bad setting it shows a raw "HTTP 404" with a Retry that cannot work, and its holds are silent. |
| Test depth | 8.5 | 408 unit tests, plus a 47-check real-DSH test on all three DSH builds that checks the session's log. Nothing tests bad config, Session Watch off or `enabled: false`, and one test needs git. |
| Docs | 7.5 | The README has every part the brief asks for, but its settings route (Plugins → Autopilot) does not exist, and its lines on `enabled: false` and on out-of-range values are wrong. |

Plugin score: min(8.5, 8, 8.0) = 8.0. Verdict: NOT YET (UX / polish and Docs are below 8, and the plugin score is below 8.5).

## What I ran

- **Build.** I made a `git archive` of the commit in my own scratch folder and linked `.e2e`. `npm test`: 407 of 408 pass. The one failure is test 301 ("no suite plugin builds DSH's data folder path itself"). It runs `git ls-files`, so it cannot run outside a clone (finding 7). I repeated its scan by hand with grep over the plugins' `lib/`: no hits.
- **Scripted e2e.** `node scripts/e2e.mjs autopilot`: 47 of 47 on DSH 0.2.0-rc.2, on 0.2.1-rc.1, and on the installed app's DSH 0.2.0-rc.2, about 85 s each. The live fingerprint did not move. I read its checks. They wait for each log entry to reach "delivered" or "started", then check the note in the session's saved log, the goal's next round, the badge and the page.
- **Instance setup.** I ran `up`, then `load` Session Watch, then `load` Autopilot with `idleSeconds: 60` and `startDelaySeconds: 5`, then `restart` and `doctor`: import check 0 errors, isolation ok. The first picture is the empty instance.
- **Real-model sessions.** Each ran in its own throwaway workspace:
  - A: three todos, done one at a time.
  - B: two todos, none done; it answers "Holding."
  - C: make one file.
  - D: rule Ask first, two todos.
  - E: rule Off, two todos.
  - F: two todos, and it ends by asking me a question.
- **Restart under running turns, 10:53 PM.** A, B and C were mid-turn, and DSH Test had to force the stop after 30 s. At 10:53:39 PM each got a carry-on note, and each note was delivered into turn 2. I checked every one in the session's own log on disk (`session.v*.jsonl.zstd`, decoded with a small reader): the note's id in `agent/inbox/spliced`, then `turn/start` 2, then a `user/message` with the same id. C then made its file and said so.
- **Second restart, 10:58 PM (clean).** Nothing was repeated. B had been idle 67 s with open todos, and it got its first idle nudge at the start scan.
- **Idle nudges.**
  - A got a nudge 60 s after each turn, and a todo was done after each one. There was no back-off, and the count reset.
  - B got two nudges and answered "Holding." to both. At 11:00:47 PM it was "Backed off", with a Why line.
  - Try again on the page sent a nudge at once, delivered into turn 6. After two more empty replies and a restart, B backed off again.
- **Ask first (D).** The question card came at 11:00:04 PM with sidebar badge 1. I pressed "Tell it to carry on" on the page. The nudge was delivered into turn 2, the entry turned "answered" and the badge went to 0. Then I set the rule to Off on the page.
- **Holds.**
  - E (rule Off) had two open todos and sat idle 82 s and more: no note and no question.
  - F (ends with a question) sat idle over 3 minutes under Auto. It got no note, which is right, but the page shows no reason (finding 4).
- **The page.**
  - Kill switch off and on from the page: both were logged with a Why line, and the icon dims while off.
  - The Open work and All tabs.
  - A keyboard sweep: Tab reaches the switch, the rule tabs, the rows and the buttons, each with a 2 px focus ring.
  - 760 px, light and dark.
  - Every DSH token the page uses exists in the theme of both DSH builds.
- **Bad config.**
  - I set `idleSeconds: 2` in the instance's `cordis.patch.yml` and restarted.
  - Then I set `enabled: false` and restarted.
  - Then I restored the file and restarted.
  - I also ran the config schema on a scratch copy of `lib/`, with the e2e runtime's packages.
- **Plugins page.** I switched Session Watch off, then on, and did the same for Autopilot.
- **Model speed.** The first replies after the first restart took over 5 minutes, with one empty-response retry. Later turns took seconds. All real-model checks finished. As the brief says, I judged the goal-after-error path from the scripted test and the code.
- **Permission mode.** I set none. DSH Test's profile starts every session with preset `danger-full-access` and approval `never`; the first lines of every session log show it, including the window's own empty drafts. The tasks only wrote todos and one file in throwaway workspaces. Because of this, I could not try the "waits for an approval" hold live.
- **Instance logs.** The logs kept for the last two starts hold no plugin error. The only stderr entry is a fetch to the instance's own window port, cut by a restart, with no plugin frame in it.

## What I saw (each picture, one line)

- `01-empty-fresh-light.png`: a fresh instance. "Watching 0 sessions", "No sessions yet: Start a chat in DSH…", and "Nothing yet" in the log. Each empty state says what comes next.
- `02-running-no-work-dark.png`: dark, two sessions running. "No session has open work", with a "Show all sessions" button.
- `10-kill-switch-off-light.png`: switch Off. "Off: no notes, no resumes, no goal starts. Nothing it scheduled will run." The three resume notes show "delivered". The rule line still says "Autopilot acts on its own."
- `11-sessions-open-work-light.png`: the Open work tab. A's row has its open todos, "next: check at 10:57 PM" and its last action.
- `12-sessions-all-light.png`: the All tab, with C "running" and A and B "idle".
- `13-question-asked-no-reason-light.png`: F has two open todos, rule Auto and has been idle over 3 minutes. No note and no reason, while the header promises a note after 1 minute.
- `20-ask-waiting-light.png`: Ask first. The question card is under "Waiting for you", with badge 1 on the sidebar icon.
- `21-ask-card-light.png`: the card: the question, its Why, and "Tell it to carry on", "Leave it", "Open"; below it, the backed-off B with "Try again".
- `30-backed-off-light.png`, `30-backed-off-dark.png`: B backed off, under "Waiting for you". D's answered note is "delivered".
- `31-backed-off-card-light.png`, `31-backed-off-card-dark.png`: the backed-off card alone.
- `32-full-page-dark.png`, `32-full-page-dark-log.png`: the full page in dark, and its log with Why lines and "delivered" tags.
- `33-full-page-light.png`, `33-full-page-light-log.png`: the same in light.
- `40-narrow-760-light.png`, `41-narrow-760-dark.png`: 760 px. The sidebar becomes a rail, rows wrap, and nothing overflows.
- `50-config-error-page-light.png`: `idleSeconds: 2`. The page shows "Couldn't read Autopilot: DSH did not answer (transport failure for /api/dsh-plugin-autopilot/state: HTTP 404)." and Retry.
- `51-config-error-plugins-light.png`: Plugins → Autopilot shows a red "Problem" and "1 failed", with no message.
- `52-config-error-problem-hover.png`, `53-config-error-problem-click.png`: hovering or clicking "Problem" shows nothing more.
- `54-enabled-false-light.png`: `enabled: false`. The page stays and points at "Plugins → Autopilot → enabled", which does not exist.
- `55-plugins-autopilot-settings.png`: Plugins → Autopilot has only the switch and Uninstall, with no settings.
- `60-open-session-from-log.png`: the log's session link opens B's chat.
- `61-note-in-chat-expanded.png`: the notes in the chat are DSH's "Plugin status updated" cards. One is opened to show the `[Autopilot]` note.
- `70-session-watch-off-light.png`: Session Watch off in Plugins. Autopilot's page shows the same raw HTTP 404 line.
- `71-session-watch-on-again-light.png`: Session Watch on again. The page is back and nothing was repeated (still 10 of 20 notes this hour).
- `72-autopilot-off-in-plugins.png`: Autopilot off in Plugins. Its sidebar entry is gone (its style tag too, checked in the page).
- `73-autopilot-on-again.png`: on again. The entry is back and nothing was repeated.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

No blockers.

### Major

1. **Two likely failure states show a raw transport error and a Retry that cannot work.**
   - Where: `plugins/autopilot/lib/client.js` line 591 (`ErrorLine` with the lead "Couldn't read Autopilot") and the kit's call wrapper (`shared/client-kit.js` line 124).
   - What: with Session Watch switched off in Plugins, or with a setting out of range, the page reads "Couldn't read Autopilot: DSH did not answer (transport failure for /api/dsh-plugin-autopilot/state: HTTP 404)." The Retry next to it cannot work (pictures 50, 70). The Bar asks that every error say what to do next; this one shows an API path and a status code instead.
   - Fix: read a 404 from the state call as "Autopilot is not running", and say why in words, with the next step. For example: "Autopilot is not running. It needs Session Watch: switch Session Watch on in Plugins." To tell the two cases apart, ask Session Watch's own endpoint. If it answers, the cause is Autopilot's settings, so show the message from finding 2. Keep the path and the code out of the sentence.

2. **The config's clear errors never reach the person.**
   - Where: `plugins/autopilot/lib/index.js` lines 32 to 75.
   - What:
     - The schema has its own `.min()` and `.max()`. With `idleSeconds: 2` it throws first, with "$.idleSeconds expected number >= 5 but got 2" (I ran the schema on a scratch copy), so `checkConfig`'s message ("idleSeconds must be a whole number from 5 to 86400 (got 2)") never runs.
     - Neither message reaches the person. Plugins → Autopilot shows a red "Problem" and "1 failed", and hovering or clicking it shows nothing more (pictures 51 to 53). No file in the instance holds either message.
     - The README (line 70) promises "a message that names the setting and the allowed range".
   - Fix:
     - Leave ranges to `checkConfig`, with types only in the schema.
     - When the check fails, still register the page's state endpoint and return `{ configError: message }`, with no work done. The page can then say: "Autopilot's setting idleSeconds must be a whole number from 5 to 86400 (it is 2). Change it in the autopilot row of your profile's cordis.patch.yml and restart DSH."
     - Add a unit test for `checkConfig`, and an e2e step that starts with a bad value.

3. **There is no settings form, but the README and the page send people to one.**
   - Where: README lines 52 to 54 ("Plugins → Autopilot."), line 97 ("or change it later in Plugins → Autopilot") and line 112; `client.js` line 408 ("switched off in its settings (Plugins → Autopilot → enabled)").
   - What: Plugins → Autopilot shows only the on/off switch and Uninstall (picture 55). Autopilot registers no `plugins.bundle.config` form, so nothing can be changed there. The `enabled: false` page sends the person to a control that does not exist (picture 54). Today, changing `idleSeconds` means editing YAML and restarting DSH.
   - Fix: register a settings form through `plugins.bundle.config`, as `plugins/notifications` and `plugins/coordinator` already do, with each setting's range and the words from the README table. If not, change every pointer to the real route.

### Minor

4. **Holds are invisible on the page.**
   - Where: `plugins/autopilot/lib/pilot.js` `plan()` (line 389, "its last reply asks you something"; line 365, a waiting approval) and the Sessions row (`lib/page.js`).
   - What: F had two open todos and rule Auto, and sat idle over 3 minutes, while the header says "a session with open work gets a note after 1 minute of quiet". It got no note, which is right. But its row shows only "idle", with no next check and no reason (picture 13), and the log says nothing. A person cannot tell a hold from a fault.
   - Fix: put the reason on the row, for example "waits for you: its last reply asks you something", the way a scheduled row shows "next: check at 10:57 PM" (picture 11). `plan()` already returns the words.

5. **The rule line contradicts the switch.**
   - Where: `client.js` line 396.
   - What: with the switch Off, the header says "Off: no notes, no resumes, no goal starts". The line under it still says "Sessions without their own rule: Auto. Autopilot acts on its own." (picture 10).
   - Fix: while off, say "Applies when Autopilot is on.", or dim the control.

6. **"Try again" and "Tell it to carry on" get past Off without saying so.**
   - Where: `pilot.js` `retry()` (line 658) and `answered()` (line 633) call `check()` with `force: true`. That skips the switch (line 418) and the Off rule (line 420).
   - What: from the code, a card pressed while the switch is off, or for a session whose rule is now Off, still sends a note. The Why line of these person-made notes repeats the idle reason ("It has been idle for 2 minutes after turn 5…", pictures 41 and 54) and does not say who asked.
   - Fix: while the switch is off or the rule is Off, refuse in words ("Autopilot is off; switch it on to send this"). Write "You pressed Try again." or "You said carry on." as the Why of those notes.

7. **Test 301 needs git.**
   - Where: `test/suite-shared.test.js`, test 301, `execFileSync('git', ['ls-files', …])`.
   - What: it fails in the judge's archive build, so `npm test` is red there (407 of 408).
   - Fix: when there is no `.git`, walk the folders with `fs`, skipping `node_modules` and `.e2e`.

8. **No tests for the failure states.**
   - What: nothing calls `checkConfig` or starts DSH with a bad value. Nothing loads the page with Session Watch off or with `enabled: false`. Nothing checks that a hold is explained.
   - Fix: add these tests along with the fixes for findings 1 to 4, so those fixes stay fixed.

9. **The README is wrong about `enabled: false`.**
   - Where: README line 112.
   - What: it says the sidebar entry and the page go away. With `enabled: false` both stay, and the page shows its switched-off text (picture 54). Only the Plugins switch removes them (picture 72).
   - Fix: correct the sentence.

10. **"here and in Decisions" names a plugin that is not there.**
    - Where: `client.js` line 397, and README line 28.
    - What: the Ask first hint promises questions in Decisions, which does not exist at this commit.
    - Fix: name Decisions only when its endpoint answers.

11. **Backed-off rows say "idle".**
    - Where: the Sessions row's word (`page.js` line 39 takes Session Watch's word).
    - What: B's row says "idle" while it is backed off. The state shows only in the "last:" text (pictures 13, 71).
    - Fix: use "backed off" or "gave up" as the row's word when Autopilot holds the session.

### Nits

12. Notes show in the chat as DSH's collapsed "Plugin status updated" card, so the note itself stays hidden until the card is opened (picture 61). If DSH lets a plugin message carry a title, use one such as "Autopilot: carry on with your todos".
13. C's resume Why says "cut off at 10:52 PM", but the restart began at 10:53 PM. The time is DSH's stamp on the interrupted turn, which is its last event. Say "its last step was at 10:52 PM", or use the stop time.
14. When Playwright is missing, the e2e skips every window check with one comment line and still passes. Make that a failure, or put the skipped count in the summary line.
15. I did not check Wallpaper on and off, because the instance has no Wallpaper plugin. The CSS uses only `--wp-blur`, `--wp-tint` and `body.wp-still`, as DESIGN.md allows.

### DESIGN.md "Before you push", ticked for Autopilot's page

- [x] Surfaces: glass cards on its own page, and no ground inside DSH's surfaces.
- [x] Only DSH tokens that exist in both versions. From Wallpaper, only `--wp-blur`, `--wp-tint` and `body.wp-still`.
- [x] No DSH hash selectors and no `:has()`. Nothing is styled on `:root`, `html` or `body`; `body` appears only as a qualifier for the theme and for `wp-still`.
- [x] Motion stops under `wp-still` and under reduced motion, pseudo-elements included. Glass thickens under reduced transparency.
- [ ] `node --check` on the client passes, but `npm test` fails outside a clone (finding 7).
- [ ] Both DSH versions and both themes: yes. Wallpaper on and off: not shown (nit 15).
- [x] Off leaves nothing behind (switching it off in Plugins removes the entry and its style tag), and on again repeated nothing.

## What would make it a 9.5

- Every state says what to do next: the page names the missing Session Watch, or the bad setting and its range, in words (findings 1, 2).
- Settings can be changed where the README says, with their ranges, without a YAML edit (finding 3).
- Every session row with open work says what Autopilot will do and when, or why it waits (finding 4). The rule line, the Why lines and the row words follow the switch and who acted (findings 5, 6, 11).
- Tests pin those states, and the suite is green outside a clone (findings 7, 8).
- The docs match the code line for line (findings 9, 10), and there are pictures with Wallpaper on and off.

## Live DSH fingerprint (before and after)

- Before (10:45 PM PDT): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020.
- After (11:23 PM PDT, right after I destroyed `suite-autopilot-j1`): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020. The pid, start time and patch sha256 are unchanged.
- I did not touch the builder's instance `suite-autopilot`, or the live DSH.
