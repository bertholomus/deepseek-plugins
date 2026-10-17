# Decisions: judge round 2

Commit 06a5e0ebfd1a9bf3d667b39d2de30346d719f0ee, judged 2026-10-17, 4:13 to 5:03 AM PDT. DSH Test instance suite-decisions-j2 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | Every kind of card worked end to end with the real model, inline markers and coordinator threads included, with answers proven in the session's log; but question-box answers on this DSH are not proven, and answering a thread can raise a card for a decision already made. |
| Reliability | 8 | Restarts, an approval cut off by a restart, the mirror's hourly limit across a restart, a wrong setting and Session Watch off and on all held up; but answering a thread card brought the chat's relay back as a new card, and switching Decisions off removes the coordinator's sidebar style. |
| UX / polish | 7.5 | A calm, DSH-native page in both themes and at 760 px, with a real focus ring and a 5.3:1 badge; but switching Decisions off and on in Plugins leaves its page and badge unstyled until the window reloads, light glass over a dark picture fails contrast, and the header keeps stale lines. |
| Test depth | 8 | 525 unit tests and 90 real-DSH checks on three builds, all green, now with inline markers and a restart; but the e2e has no coordinator thread and does not switch Decisions off and on in the window, which is where both majors are. |
| Docs | 8.5 | A thorough README (cards, settings with ranges, mirror, files, switch-off, rollback); it says question-box answers are proven by the tool's result and that *Open Decisions' settings* puts the cursor in the setting, and neither held here. |

Plugin score: min(U, R, mean) = min(8.5, 8, 8.1) = 8. Verdict: NOT YET.

## What I ran

- **Build.** `git archive 06a5e0e | tar -x` into my folder, with `.e2e` linked to the builder's DSH installs.
- **Unit tests.** `npm test`: 525 of 525 pass (27 s). Decisions' own files hold 47 of them (40 host, 7 page); the marker rule is tested in `test/suite-shared.test.js`.
- **Real-DSH e2e.** `node scripts/e2e.mjs decisions`: 90 of 90 on DSH 0.2.0-rc.2 (64 s), 90 of 90 on 0.2.1-rc.1 (70 s), 90 of 90 on the installed app's DSH 0.2.0-rc.2 (61 s). Its own fingerprint check: live DSH unchanged. I read every check in `plugins/decisions/test/e2e/run.mjs`.
- **My instance.** `dsh-test --name suite-decisions-j2 up`, `defaultPreset: workspace-write`, then Session Watch, Decisions, Notifications and Coordinator loaded from the head, and Wallpaper from the DSH Test plugins folder, and a restart.
  - About 20 real sessions on GLM-5.3-Flash-EXL3, started through the session bridge.
  - To get approvals without full access, I set the preset to `read-only` for a few seconds while I made those sessions, then set it back to `workspace-write`. The model asked for `workspace-write` on a `write` call.
  - The window was driven with Playwright (the e2e's own Chromium) at 1440 and 760 px, light and dark.
  - Every claim below was checked against the session's own log (`/sessions/:id/events`), Decisions' `state.json` and `events.jsonl`, the file a tool wrote, or my stand-in's log.
- **Stand-in webhook, the only mirror target ever set.** A small node server on 127.0.0.1:18977, run from my folder, logging each request and answering 200 or 500 as I set it. The address went into the form; nothing else was ever set.
- **Inline markers.** A reply ending "…so the choice is yours. DECISION NEEDED: Should the dev server listen on port 8080 or 3000? — recommend: 8080, it matches the docs", and one with an inline `BLOCKED:`.
  - I answered the first with *Go with the recommendation* and the second in my own words.
  - Both reached the session as its next turn, `[Decisions] The person answered your DECISION NEEDED line (…): go with your recommendation (8080, it matches the docs).`, and both log rows say *delivered*.
- **Coordinator, two real runs.** In each, a chat started one thread whose brief said to hand back `needs_decision` with a recommendation.
  - Run 1 ("Port planning", thread "Port pick"): one card while it waited. I answered it in my own words, and the answer reached the thread.
  - 0.4 s later, Decisions announced the chat's earlier relay as a new card (Finding 1). It stayed until the chat's next turn, 8 s later.
  - Run 2 ("Release planning", thread "Tag pick"): one card. *Go with the recommendation* reached the thread, `[Decisions] The person answered your handback (“Should the release be tagged v1.0 or v0.9?”): go with your recommendation (v1.0, the API is stable).`
  - No second card appeared in run 2, because that chat's relay was never read as a question; `state.json` `seen` has no reply card for it.
- **Approvals.**
  - A held approval was allowed once from the page. The tool wrote `notes.txt`, and the log row says *answered*.
  - A held approval was then left waiting through Decisions off and on in Plugins.
  - Two approvals were left waiting through a restart.
  - A further restart with an approval waiting was run with Decisions holding it, and again with `approvals: false`. DSH Test needed its forced stop both times (`graceful=false` in its events log), so the forced stop is DSH's, not Decisions'.
- **Question box.** The model asked "Which environment should I deploy to?" with two choices. I chose *staging* on the page, and the session's log has the tool result `{"answers":[{"id":"deploy_env","selected":["staging"]}]}`.
- **Decisions off and on in Plugins.** I did this three times with the window open, and counted its style sheet each time (Finding 2).
- **Wait times.** Each card's wait was read before and after Decisions off and on, and two restarts.
- **Notifications.** New cards with the Notifications plugin on, then off in Plugins.
- **Mirror.**
  - Address checks: an `ftp://` address and an `http://` one to another host.
  - *Send a test*, a new card sent, and a new card with my stand-in answering 500.
  - `mirrorPerHour` 0, then 2. Cards past the limit, then a restart and one more card.
  - Every file under the instance, its Electron data and `~/Library/Logs` searched for the address's secret part.
- **A wrong choice value.** `mirror: sms` written into the profile, then a restart.
  - I read the page and the form, checked where the hidden pill sits, and swept the row with the keyboard.
  - I fixed the value in the form.
- **Look.**
  - The badge's contrast, sampled from pixels, light and dark.
  - Wallpaper on at glass tint 20 % over a light picture and a dark one, each in light and dark, then Wallpaper off. Text contrast was sampled from screenshot pixels for every kind of text on the page.
  - A keyboard sweep of a card.
  - The 760 px window.
  - All 26 DSH custom properties the page reads, checked in both DSH builds: all defined.
- **Session Watch off and on in Plugins** with the Decisions page open.
- **An empty instance.** I destroyed the instance, created it again under the same name (preset `workspace-write`), loaded Session Watch, Decisions and Notifications, restarted, and opened the page in light and dark. No badge, and no errors in the window.
- **DESIGN.md's "Before you push", for Decisions' UI.**
  - [x] Surfaces sit right: glass cards on its own page, and no ground inside DSH's rail or form.
  - [x] Only DSH tokens that exist in both builds (26 checked), plus `--wp-tint` and `body.wp-still`.
  - [x] No hashed selector, nothing on `:root`, `html` or `body`, and no `:has()`.
  - [x] Motion stops under `wp-still` and reduced motion, and glass thickens under reduced transparency (rules present).
  - [x] `node --check lib/client.js` passes, and `npm test` passes.
  - [x] Checked on both DSH builds (the e2e), both themes, and Wallpaper on and off.
  - [ ] Off leaves nothing behind (true), but on again loses its own style sheet and the next off removes the coordinator's (Finding 2).
- **Not exercised live.** These are covered by the e2e only:
  - the command mirror;
  - `enabled: false`;
  - Autopilot's Ask first;
  - a timed question's late answer.

## What I saw (each picture, one line)

- `01-page-light-two-cards.png`: Wallpaper on, light: "2 waiting on you". A decision card from the inline marker, with "Recommended: 8080, it matches the docs", and a blocked card from the inline `BLOCKED:`. Badge 2.
- `02-after-go-with-recommendation.png`: the decision card is gone, and the log has "Went with the recommendation: 8080, it matches the docs · You", *delivered*.
- `03-blocked-card-typed.png`: my own words typed in the blocked card's answer box.
- `04-after-own-words.png`: both answered and *delivered*. The empty list says "Nothing waits on you" once, with what would show there. The green "waits in its queue" line is still shown.
- `05-approval-and-thread-light.png`: a held approval ("Allow this change with Workspace Write?", `notes.txt`, the reason, *More about the call*, *Allow once*, *Reject*) above the coordinator thread's card ("a thread of “Port planning”", the question, *Recommended*, "It goes into the thread"). The header reads "2 waiting on you · 1 holding a running turn". The stale "waits in its queue" line is still there.
- `06-approval-and-thread-dark.png`: the same in dark.
- `07-narrow-760-dark.png`: at 760 px in dark, DSH's rail shows badge 2; the cards fit, with no sideways scroll (scrollWidth 704 = clientWidth).
- `08-narrow-760-light.png`: the same in light.
- `09-badge-light.png`: the badge close up: white on #d61313, 5.3:1.
- `09-badge-dark.png`: the same in dark: 5.3:1.
- `10-plugins-page.png`: DSH's Plugins page with Decisions switched on (Wallpaper on).
- `11-decisions-switched-off.png`: Decisions switched off. Its rail entry, its style sheet and every `dshdc-` mark are gone.
- `12-after-reload-on.png`: switched on again. The page and the rail entry are unstyled: default bullets and headings, and the screen-reader text "2 waiting on you" printed beside the icon (Finding 2). The approval Decisions had held now reads "Decisions was not holding this request when DSH asked".
- `13-two-held-approvals-light.png`: still unstyled, with two new held approvals and "4 waiting on you · 2 holding a running turn".
- `14-after-restart-notifications-off.png`: after a restart with two approvals waiting. Both are logged "The turn stopped before anyone answered" (*stopped*, with the why). The thread card still reads "waiting 6 minutes". The header says the Notifications plugin is not running.
- `15-settings-form-light.png`: Plugins → Decisions: the four kinds, the hours field, the notification switch and *Also send new cards to*, with Wallpaper on. The hints are DSH's form on the bare wall.
- `16-webhook-bad-address.png`: Webhook chosen and a bad address typed (masked). The field says "The address must start with https:// (http:// only to this machine)." in red.
- `17-webhook-before-save.png`: my 127.0.0.1 stand-in's address typed (masked), before *Save*.
- `18-webhook-after-save.png`: after *Save*: "An address is set", the field empty, *Remove the address*.
- `19-test-message-sent.png`: the header after *Send a test*: "New cards also go to the webhook at 127.0.0.1:18977" and "Test message sent to 127.0.0.1:18977."
- `20-mirror-500-failure.png`: after a card failed with 500, the header still reads "1 of 30 this hour" and "Test message sent…", with no word of the failure (Finding 5).
- `21-perhour-zero-refused.png`: *Messages sent an hour, at most* set to 0: "A whole number from 1 to 500, or empty for the default (30).", and *Save* disabled.
- `22-wrong-setting-page-light.png`: after `mirror: sms` and a restart: "Decisions is waiting for a setting to be fixed.", which setting, what it must be, and *Open Decisions' settings*. The log shows "Not sent to 127.0.0.1:18977 / Not sent: … answered 500." and "Held back sent messages: 2 went out in the last hour" twice, once before and once after the restart.
- `23-wrong-setting-form-light.png`: the form's row flags "The saved value is not one of the choices. Choose Nowhere, Webhook or Command, then save." No pill shows.
- `24-wrong-setting-tab-reaches-choice.png`: Tab reaches *Nowhere*, with the 2 px ring.
- `25-wrong-setting-choice-made.png`: after ArrowRight, then ArrowLeft: *Command* is chosen. The first arrow picked *Nowhere*, and the next one wrapped.
- `26-wrong-setting-before-save.png`: *Nowhere* chosen, before *Save*.
- `27-wrong-setting-fixed.png`: saved: "8 waiting on you", every card back. The log says "Settings fixed: Decisions is working again — Why: The change to “Also send new cards to” fixed it."
- `28-question-box-card-light.png`: the question-box card: the question first, both choices with their descriptions, "Or write your own answer", and *Send answer* disabled until a choice is made. The line about the session waiting comes last.
- `30-wallpaper-light-picture-tint20-light.png`: light theme over the light picture at tint 20 %. The text reads.
- `31-wallpaper-light-picture-tint20-dark.png`: dark theme over the light picture at tint 20 %. All text is 6.5 to 13.8:1.
- `32-wallpaper-dark-picture-tint20-light.png`: light theme over the dark picture at tint 20 %. The page is grey. Secondary text is 2.1 to 2.9:1, links 1.66:1, primary text 5.2:1 (Finding 7).
- `33-wallpaper-dark-picture-tint20-dark.png`: dark theme over the dark picture at tint 20 %. The text reads.
- `34-wallpaper-off-light.png`: Wallpaper off, light: DSH's plain ground. The text passes.
- `35-wallpaper-off-dark.png`: Wallpaper off, dark: the text passes.
- `36-session-watch-off.png`: Session Watch off: "Decisions needs Session Watch, which is not running.", with *Open Session Watch in Plugins* and *Check again*.
- `37-history-relay-card-after-answer.png`: *What happened* for Finding 1:
  - "Port pick · Answered: Use port 3000 … *delivered*".
  - Newer, a new card: "Port planning · Asked you something — [Port pick](.dsh-thread/t1): the thread needs your decision on which port the dev server should use."
  - At the top, "Restart hold A · The turn stopped before anyone answered".
- `38-thread-card-before-answer.png`: run 2's single card: "needs a decision", "Tag pick", "a thread of “Release planning”", the question, "Recommended: v1.0, the API is stable", *Go with the recommendation*, and "It goes into the thread as your next message."
- `41-after-off-and-on-unstyled.png`: Finding 2 again on the third off-and-on. The page is raw HTML, and the rail shows "77 waiting on you Decisions". Decisions' `<style data-plugin="dsh-plugin-decisions">` holds the coordinator's sidebar rules (`[role="tree"] div[data-projects-nests]…`, 4106 characters) instead of its own (11751).
- `42-empty-instance-light.png`: a fresh instance in light. The header says "Each new card notifies you.", the list says "Nothing waits on you" once with what would show there, *What happened* says "Nothing yet", and there is no badge.
- `43-empty-instance-dark.png`: the same in dark, readable on DSH's dark ground.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

**Blocker:** none.

**Major**

1. **Answering a coordinator thread's card brings the chat's relay back as a new card.**
   - Where: `list()` in `plugins/decisions/lib/inbox.js`. Decision, blocked and reply cards are folded only into thread cards that are still in the list (`threads = [...found.values()].filter((card) => card.kind === 'thread')`).
   - What happened in run 1:
     - The chat's relay of the handback ("[Port pick](.dsh-thread/t1): the thread needs your decision on which port the dev server should use…") was a reply card. It was first seen at 4:21:01 and folded into the thread's card.
     - At 4:31:33.9 my answer reached the thread. Its card left the list, so nothing folded the relay any more.
     - At 4:31:34.3 Decisions announced `reply:<chat>:2` as a new card, "Port planning · Asked you something" (picture 37). It showed the raw markdown link, and it would notify and mirror like any new card.
     - It left only when the chat's next turn began (4:31:42), and only because the thread handed back again.
     - A thread that works for an hour after the answer leaves this card in place for that hour.
     - Run 2 did not show it, because that chat's relay ("…tell me your choice and I'll pass it along.") was never read as a question.
   - This breaks "one decision, one card" in the worst way: a card for a decision the person has just made.
   - Fix:
     - Fold a chat's relay into its thread whether the thread card is open, answered or dismissed: look the thread up among every thread card Session Watch reports, or keep the thread ids from `data.answered` and `data.dismissed`.
     - Drop a relay reply whose turn was started by a handback that has since been answered.
     - Add a unit test (answer the thread card, then list again: no reply card for the chat) and an e2e coordinator thread with its relay.

2. **Switching Decisions off and on in Plugins leaves its page and badge unstyled, and the next off removes the coordinator's sidebar style.**
   - Where: `injectStyle` and `removeStyle` in `plugins/decisions/lib/client.js` (lines 115 to 127, the suite kit). Both find "the plugin's sheet" by `style[data-plugin="dsh-plugin-decisions"]`.
   - What:
     - DSH also writes `data-plugin=<bundle>` on a style element appended while that bundle applies. The coordinator's `useNesting` (`plugins/coordinator/lib/client.js`, about line 5379) appends a fresh `<style data-projects-nest>` whenever the sidebar tree re-renders, which happens while Decisions applies.
     - After a re-enable, Decisions' `injectStyle` finds that mis-tagged sheet and skips its own. The page renders as raw HTML, and the rail prints its screen-reader text, "77 waiting on you" (pictures 12, 13, 41).
     - The page stays like that until the window reloads.
     - On the next off, the coordinator's nesting sheet is removed (I counted 1 before, 0 after, and 0 after Decisions came back), so the coordinator's thread rows lose their nesting style until a reload.
     - I saw this 3 times in 3 with the coordinator loaded. Round 1 ran its off-and-on without the coordinator.
   - Fix:
     - Find and remove only by the mark the kit alone writes, `style[data-plugin-css="dsh-plugin-decisions/client.css"]`, as the coordinator's own sheet already does. The kit's other copies have the same line (`session-watch/lib/client.js:104`, `autopilot/lib/client.js:114`).
     - In the coordinator, mark its nesting sheet and re-add it if it is removed.
     - Add an e2e step: with the coordinator loaded, switch Decisions off and on from the Plugins page. Then check that the page is styled (`.dshdc-sr` computes `position: absolute`, the header has the glass background) and that `style[data-projects-nest]` is still there.

**Minor**

3. **Question-box answers are not proven on DSH 0.2.0-rc.2.**
   - Where:
     - `hold()` in `lib/holds.js`: a question's id falls back to `q${count}` when the request carries no `wait.callId`.
     - `answerQuestions` in `lib/inbox.js`: without a `callId` it sets `state: 'answered'` without reading the log.
   - What: the real request carried no call id (card `question:<session>:q1`). The log row says *answered*, and nothing compared it with the session's log, though the tool result was there. The README's card table says these answers are "Proven by … The tool's result in the session's log".
   - Fix: take the call id from the session's log (the latest question-box tool call that has no result yet), or mark the row "answered (not checked in the session's log)" and say so in the README.

4. **After Decisions is switched off and on, a request it was holding is described wrongly.**
   - Where:
     - The *open* hint in `DecisionCard` (`lib/client.js`).
     - `byUrgency` in `lib/cards.js`.
     - The release in `onSaved` and `stop`.
   - What:
     - The approval it held when switched off came back reading "Decisions was not holding this request when DSH asked, so answer it in the session." Decisions was holding it; it handed it back.
     - The card lost its "holding a running turn" rank and count, and sorted below older cards.
     - *What happened* has no line saying the request went back to DSH's own card.
   - Fix:
     - Keep the release reason, and say "Decisions handed this back to DSH's own card when it was switched off: answer it in the session."
     - Journal one line per released request.
     - Keep a live turn's rank.

5. **The header never says a mirror send failed.**
   - Where: `mirrorText` in `lib/client.js` ignores `m.last`.
   - What: after the 500, the header still read "New cards also go to the webhook at 127.0.0.1:18977: 1 of 30 this hour." beside "Test message sent to 127.0.0.1:18977." (picture 20). The failure is only in *What happened*.
   - Fix: when the last send failed, add "The last one was not sent: 127.0.0.1:18977 answered 500 (4:28)", in the warning tone, and drop the test line once a newer send exists.

6. **The answer line goes stale.**
   - Where: the `said` text kept by `HeaderCard` and `WaitingCard`.
   - What: "Your answer to “…” waits in its queue. What happened says when the session reads it." stayed on the page for many minutes after the log said *delivered* (pictures 04, 05).
   - Fix: follow the row's state (say "reached" once it is delivered) or clear the line after a minute or on the next answer.

7. **Light glass over a dark picture at a low tint fails contrast.**
   - Where: the glass recipe (`--dshdc-glass`, `--dshdc-conv`) under Wallpaper.
   - What: light theme, dark picture, tint 20 %: secondary text 2.1 to 2.9:1 and links 1.66:1, against DESIGN.md's 4.5:1 (picture 32). The other three combinations pass. DESIGN.md lists this as an open question.
   - Fix: give the main cards a floor for light glass (DESIGN's proposed `max(.75, tint + .2)`), or raise `--dshdc-text-2` and the link colour when the measured ground is dark.

8. **Every text card shows an open three-row answer box.**
   - Where: `TextAnswer` in `lib/client.js`.
   - What: with seven cards, the list runs about three screens, most of it empty boxes.
   - Fix: a one-line field that grows on focus, or a one-row box that opens on focus.

**Nit**

9. The page's error says `must be "off", "webhook" or "command"`, while the form offers Nowhere, Webhook and Command. Name the form's words, with the stored value in brackets.
10. "Held back sent messages: 2 went out in the last hour" reads oddly. Say "Held back new cards: 2 went to the webhook in the last hour."
    - It, and "Did not notify you — the Notifications plugin is not running", come back after each restart and each Session Watch off and on, because the once-an-hour memory is not kept. I saw the notification line 4 times in 14 minutes.
    - Keep the last-said time in `state.json`, or say "once an hour while Decisions runs".
11. On a choice with no valid value, the first arrow key selects the first option rather than moving to the next one, and ArrowLeft then wraps to the last.
12. *Open Decisions' settings* puts the focus on *Use the default*, not on the choice. README line 118 says it "puts the cursor in it". Focus the first choice (tabIndex 0) instead.
13. Setting or removing the webhook address leaves no line in *What happened*, though every other save does. Log "Webhook address set" or "Webhook address removed", with no part of the address.
14. The header line "Each new card would notify you, but the Notifications plugin is not running" has no button to open Notifications in Plugins, though the page's Session Watch message has *Open Session Watch in Plugins*.
15. A reply card's question keeps raw markdown, as in "[Port pick](.dsh-thread/t1)". Strip links to their text.
16. Not judged here, because they are DSH's own: Plugins → Decisions' hints sit on the bare wall with Wallpaper on and are hard to read (pictures 15 to 21). The restart forced stop with an approval waiting also happens with `approvals: false`.

## What would make it a 9.5

- **One decision, one card, always.**
  - Fold a coordinating chat's relay into its thread's card whether that card is open, answered or dismissed, so answering a thread never raises a new card.
  - Prove it with a unit test and an e2e coordinator thread: a handback, its relay, the answer, then no card and no notification.
- **Off and on is clean.**
  - Find and remove the kit's sheet only by `data-plugin-css`.
  - Have the e2e switch Decisions off and on from the Plugins page with the coordinator loaded, and check the page's computed style and the coordinator's nesting sheet.
  - Word a handed-back approval truthfully, keep its rank, and log the hand-back.
- **Every answer is proven.** Find the question box's call id in the session's log when DSH does not pass it, so *answered* always means "the session has it".
- **The header tells the truth now.** The last mirror failure, an answer line that follows its row to *delivered*, and once-an-hour notes that survive a restart.
- **Glass that reads on any picture.** A light-glass floor at low tints, and checked contrast over a dark picture in the e2e pictures.
- **A shorter page.** Answer boxes that open on focus, so seven cards fit on about one screen.

## Live DSH fingerprint (before and after)

- Before (4:14 AM PDT, `dsh-test fingerprint`): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 `e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020`.
- After (4:58 AM PDT, my driver and stand-in stopped, before `dsh-test --name suite-decisions-j2 destroy`): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 `e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020`. Unchanged, and the same again at 4:59 after the destroy.
- The three e2e runs checked it before and after too: unchanged.
- Nothing was loaded into, restarted in, or edited in the live DSH.
- My instance `suite-decisions-j2` is destroyed (no `~/.dsh-test-suite-decisions-j2*` left), my stand-in webhook and window driver are stopped, and no other instance was touched.

## Round 1 findings

1. **Inline markers missed: fixed.**
   - A real reply's inline `DECISION NEEDED … — recommend: …` after a sentence made a decision card with its recommendation split out. An inline `BLOCKED:` made a blocked card.
   - The e2e now has both, and the shared tests cover bold and quoted forms.
2. **Two cards for one coordinator decision: partly fixed.**
   - While the thread's card waits, the chat's relay is folded: one card in both runs.
   - Answering it brought the relay back as a new card in run 1 (Finding 1).
3. **Wait times restart: fixed.**
   - First-seen times are kept in `state.json` (`seen`).
   - The thread card kept "since 4:20:57" through Decisions off and on and two restarts ("waiting 10 minutes" at 4:31, picture 27).
4. **A failed mirror send headed as sent: fixed.** The row now reads "Not sent to 127.0.0.1:18977", with "Not sent: … answered 500." and a *not sent* pill (picture 22).
5. **A broken pill on the setting to fix: fixed.**
   - No pill shows, the row says what to choose, Tab reaches *Nowhere*, and saving *Nowhere* fixed it.
   - The hidden pill is still placed outside the box (x 949 against the control's 1042), and two keyboard leftovers remain (Nits 11 and 12).
6. **Notifications leave no trace: fixed.**
   - Each new card logged "Notified you by the system" (*shown*) with the Notifications plugin on.
   - With it off, the log says "Did not notify you — the Notifications plugin is not running" (*not shown*), and the header says how to get them.
7. **The badge fails contrast in dark: fixed.** It is white on #d61313, 5.3:1 in both themes.
8. **The code font token is not DSH's: fixed.** `.dshdc-code` uses `var(--ds-font-family-code, ui-monospace, …)`.
9. **A held approval cut off by a restart leaves no outcome: fixed.** "The turn stopped before anyone answered", with the why and *stopped*, for each one (pictures 14 and 37). Nothing waited afterwards, and `held` was empty.
10. **Unit tests leave temp folders: fixed.** `test/helpers/temp.mjs` removes them when the file ends. My run left no `decisions-*` folder.
11. **"Nothing waits on you" said twice: fixed.** With nothing waiting, the header has no status line, and the list's empty state says it once (picture 04).
12. **The question-box card puts the waiting line above the question: fixed.** The question comes first and that line last (picture 28).
13. **"waiting since just now" beside "waiting 1 minute": fixed.** Every new card read "waiting less than a minute".
14. **Saves were named with the wrong source and an unquoted label: fixed.** The log now reads "Settings changed: “Messages sent an hour, at most” — They apply now." and "The change to “Also send new cards to” fixed it."
15. **The thread card's hint said "into the session": fixed.** It reads "It goes into the thread as your next message." (picture 38).
16. **A handback's recommendation stayed inside the question: fixed.** "Recommended: v1.0, the API is stable" sits on its own line, with *Go with the recommendation*, which delivered it (picture 38).
17. **The hourly mirror count lived in memory and counted failures: fixed.**
    - The count is kept in `state.json` (`sent`), and only successes are recorded: "1 of 30" stayed after the 500.
    - With a limit of 2, the count read "2 of 2" after a restart, and the next card was held back.
