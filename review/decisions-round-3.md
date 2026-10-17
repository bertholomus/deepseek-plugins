# Decisions: judge round 3

Commit 15d8bf00c4e72e1423fc99ebbb78aab58c01f525, judged 2026-10-17, 5:41 to 6:35 AM PDT. DSH Test instance suite-decisions-j3 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9 | Every source the brief names made one card with the real model, the coordinator's delete prompt included, and every answer from the page was proven in the session's log; but a plain question's card carries none of its context, and a thread that leads with "Recommend 9090 …" gets no *Go with the recommendation*. |
| Reliability | 9 | Five restarts, Decisions off and on three times beside the coordinator, Session Watch off and on twice, wrong settings and a failing webhook all held: no card was announced, notified or mirrored twice, and every held request ended with a true line; but a bad `mirrorCommand` stops the whole inbox even when the mirror is set to Nowhere. |
| UX / polish | 8.5 | A calm, DSH-native page in both themes and at 760 px, 55 tab stops with the ring, header lines that stay true and one-line answer boxes; but the command mirror is called "sh", a blocked card reads as a cut sentence, a thread card shows its whole summary as the question, and the console fills with 404s while Session Watch is off. |
| Test depth | 8.5 | 550 unit tests and 103 real-DSH checks on three builds, all green, with both round-2 majors now e2e steps; but the e2e's scripted model writes the phrasings the parser expects, so the real model's handback lost its button, and the coordinator's *Allow once* prompt answered from Decisions is not an e2e step. |
| Docs | 9 | A thorough README that held almost everywhere I checked it (every card and its proof, each setting with its range, the mirror, files, switch-off, rollback); two small slips: profile settings "apply after a restart" (DSH applied them at once), and a thread's recommendation "in any of them" is not read when it leads the summary. |

Plugin score: min(U, R, mean) = min(9, 9, 8.8) = 8.8. Verdict: PASS.

## What I ran

- **Build.** `git archive 15d8bf0 | tar -x` into my folder (`~/Projects/dsh-plugin-suite-judge/decisions-r3/head`), with `.e2e` linked to the builder's DSH installs. In the builder's tree I wrote only this scorecard, its pictures and one scoreboard row.
- **Unit tests.** `npm test`: 550 of 550 pass (27 s). Decisions' own files hold 55 of them (46 host, 9 page).
- **Real-DSH e2e.** `node scripts/e2e.mjs decisions`:
  - 103 of 103 on DSH 0.2.0-rc.2 (75 s), 103 of 103 on 0.2.1-rc.1 (86 s), and 103 of 103 on the installed app's 0.2.0-rc.2 (73 s).
  - Its own fingerprint check: live DSH unchanged each time.
  - I read its step list. Both round-2 majors are steps now.
- **My instance.**
  - `dsh-test --name suite-decisions-j3 up`, then `defaultPreset: workspace-write` in its profile.
  - Session Watch, Decisions, Notifications and Coordinator loaded from my build, and the session bridge from the DSH Test plugins folder. Then a restart and `doctor`: import check 0 errors (2 warnings on DSH's own rows), isolation ok.
  - 20 real sessions on GLM-5.3-Flash-EXL3, started through the session bridge.
  - Approvals without full access: before a session's first prompt I set that one session to Read Only with DSH's own `/permission read-only` command, through the window's command API. The model then asked for Workspace Write on its write, and both DSH's own card and Decisions' card showed it. The instance's preset stayed `workspace-write`. No full-access mode was used, and no prompt asked for one.
  - The window was driven with Playwright (the e2e's own Chromium) at 1440 and 760 px, in light and dark.
  - Every claim below was checked against the session's own log (`/sessions/:id/events`), Decisions' `state.json` and `events.jsonl`, the file a tool wrote or deleted, or my stand-ins' logs.
- **Cards from the real model.**
  - **Decision line.** A reply ending `DECISION NEEDED: … — recommend: 9090` ("Status page port") made a decision card with *Recommended: 9090*. *Go with the recommendation* reached the session as turn 2: `[Decisions] The person answered your DECISION NEEDED line (“…”): go with your recommendation (9090).`
  - **Inline blocked marker.** "…so I cannot go on. BLOCKED: valid staging credentials …" ("Staging deploy") made a blocked card. My later answer in my own words was delivered as turn 2.
  - **Plain question.** The model proposed three names and ended "Which one do you prefer?" ("Log tool name"). The reply card had that line only (Finding 1). My typed answer, sent with Cmd+Enter, was delivered as turn 2.
  - **Offer.** "17 times 3 is 51. Want me to show the working?" made no card, as the README says.
  - **Question box, one question** ("Nightly report target"). I answered with the keyboard (Space, Enter). The session's `tool/result` is `{"answers":[{"id":"env","selected":["staging"]}]}`, and the log row says *answered* with its proof time.
  - **Question box, two questions,** one multi-select ("Release checklist"). I chose *chat*, then *unit tests* and *lint*. The `tool/result` has both answers, and the model summed them up correctly.
  - **Two approvals** ("Notes file (allow)" and "(reject)"). *Allow once* wrote `notes.txt` with the line asked for (`approval/decided` in the log). *Reject* left no file, and the tool got a rejection.
- **Coordinator: one chat with two threads.** I ran `/coordinate` in "Status page work".
  - **Thread t1, "Pick status page port",** handed back `needs_decision`. It made one card, the thread's ("a thread of “Status page work”").
    - The chat's relay asked "which port … 8080 or 9090?". It stayed folded into the thread's card.
    - I answered in my own words. The answer reached the thread as turn 2, and the thread handed back *done*.
    - No card came back for the chat, then or after the five restarts.
  - **Thread t2, "Delete old-notes.txt".** The coordinator's delete prompt became an approval card: "This command deletes … A thread asks you before each command that deletes files it didn't create.", with the full `rm` command.
    - *Allow once* from the page: `approval/decided` is in the thread's log, the file is gone, and the thread handed back *done*.
    - Decisions did not notify for it, because the coordinator told the chat. Its README says this.
- **Held requests.**
  - **Through a forced restart.** The held approval was logged "The turn stopped before anyone answered", with the why, and `held` emptied.
  - **Through Decisions off and on in Plugins.** Decisions handed it back, and the card says so, with *Answer in the session*. DSH's own *Allow once* then wrote the file, and the row says *answered in the session*.
  - **Through Session Watch off and on in Plugins.** The same outcome.
    - Meanwhile the page said "Decisions needs Session Watch, which is not running.", with *Open Session Watch in Plugins* and *Check again*.
    - It came back by itself within a second of Session Watch starting.
- **Restarts.** Five in all.
  - Three were forced by DSH Test with an approval waiting. One of these had Decisions switched off, to see whose the forced stop is: it is DSH's, as round 2 found.
  - Two were clean, with nothing held.
  - Each card kept its first wait. A card first seen at 5:47 read "waiting 22 minutes" at 6:10.
  - Over the whole run, 17 cards were each announced once, 15 notified once and 10 mirrored once.
- **Decisions off and on from its switch in Plugins, with the coordinator loaded.** Three times. Each time:
  - its rail entry, page, style sheet and API went away and came back;
  - the coordinator's nesting sheet stayed;
  - the page came back styled (the screen-reader text hidden, the header's glass on) and the badge red.
- **Dismiss and Bring back.** The badge went from 5 to 4 to 5, and both are logged.
- **Notifications.** Each new card from a session was "Notified you by the system". With Notifications switched off in Plugins, the header says so, with *Open Notifications in Plugins*.
- **Mirror.**
  - **Webhook stand-in.** I ran a stand-in webhook on 127.0.0.1:18977. Its address is the only one ever set.
    - An `ftp://` address was refused in words.
    - After *Save*, the address was only in DSH's key store under `DECISIONS_WEBHOOK_URL`. It was not in the profile, `state.json`, `events.jsonl` or DSH's logs.
    - *Send a test* and two new cards reached the stand-in as `{content, allowed_mentions:{parse:[]}}`.
    - With the stand-in answering 500, the log reads "Not sent to 127.0.0.1:18977 … answered 500", and the header gets a warning line. The count stayed at "2 of 30" (the test is not counted).
  - **Command.** I set `mirror: command` with `mirrorCommand: [/bin/sh, <my sink script>]` in the profile. The test and each new card arrived on its input as one JSON line (text, kind, title, question, recommendation, sessionId).
- **Wrong settings.**
  - **`windowHours: 0` in the profile.**
    - The page says which setting is wrong and what it must be, the badge goes, and answers are refused in words.
    - *Open Decisions' settings* put the cursor in the field, which the form flags.
    - I typed 48 and pressed *Save*: "Settings fixed: Decisions is working again", and every card was back.
  - **A relative `mirrorCommand`,** first with the mirror on Command, then with it on Nowhere (Finding 3).
- **Look.**
  - 1440 and 760 px, in light and dark, and the keyboard through the whole page.
  - Wallpaper (from the DSH Test plugins folder) at glass tint 20 % over a dark colour, in light and dark, with contrast sampled from the pictures' pixels.
- **Not exercised live.** These are covered by the e2e or the unit tests only:
  - a timed question's late answer;
  - Autopilot's *Ask first*;
  - `enabled: false`;
  - the mirror's hourly limit.

## What I saw (each picture, one line)

- `01-waiting-light.png`: "7 waiting on you · 3 holding a running turn". An approval (the file, the model's reason, *More about the call*, *Allow once*, *Reject*), the question box with its choices and their descriptions, and a second approval. Badge 7.
- `02-waiting-dark.png`: the same in dark.
- `03-badge-light.png`, `04-badge-dark.png`: the red badge "7" on the rail's icon.
- `05-after-allow-once-light.png`: "Your answer reached “Notes file (allow)”." in green. The card is gone, and 6 wait.
- `06-text-cards-light.png`: three text cards:
  - the blocked card, whose text is a fragment (Finding 6);
  - the reply card, "Which one do you prefer?" alone (Finding 1);
  - the thread card, whose question is the whole handback summary, with no *Recommended* line (Finding 2).
- `07-answer-box-open-light.png`: the reply card's answer box. It is one line until focused, then three rows with the focus ring.
- `08-after-typed-answer-light.png`: "Your answer reached “Log tool name”." *What happened* has "Answered: logprune, please." and "Went with the recommendation: 9090", both *delivered*.
- `09-settings-light.png`, `10-settings-dark.png`: Plugins → Decisions: the four kinds, the hours field, the notification switch and *Also send new cards to*.
- `11-webhook-refused-light.png`: a bad address (masked). "The address must start with https:// (http:// only to this machine)." shows in red.
- `12-webhook-set-light.png`: after *Save*: "An address is set", the field empty, and *Remove the address*.
- `13-mirror-test-light.png`: "New cards also go to the webhook at 127.0.0.1:18977: 0 of 30 this hour." and "Test message sent to 127.0.0.1:18977."
- `14-mirror-failed-light.png`, `15-mirror-failed-dark.png`: "The last new card was not sent: 127.0.0.1:18977 answered 500 (just now)." in the warning tone. The test line is gone.
- `16-history-light.png`, `17-history-dark.png`: *What happened*: notified, needs a decision, the test send, "Webhook address set" (why: the key store), the settings change, and each answer with *delivered* or *answered*.
- `18-setting-problem-light.png`, `19-setting-problem-dark.png`: with `windowHours: 0`, the page says "Decisions is waiting for a setting to be fixed.", which setting and what it must be, with *Open Decisions' settings*. The log row says *waiting on a setting*.
- `20-setting-form-flag-light.png`: the form flags the field: "A whole number from 1 to 720, or empty for the default (72)."
- `21-command-problem-light.png`: a relative `mirrorCommand`. The page says what it must be, then "Change it in … cordis.patch.yml, then restart DSH" (Finding 5).
- `22-decisions-off-light.png`: Plugins → Decisions switched off. The rail entry is gone.
- `23-after-off-on-light.png`: on again. The page is styled, 5 wait, and the handed-back approval is first, with *Answer in the session*.
- `24-handed-back-card-light.png`: "Decisions handed this back to the session's own card when it stopped: answer it in the session."
- `25-session-own-card-light.png`: *Answer in the session* opened the session at DSH's own approval card.
- `26-narrow-rail-light.png`: at 760 px, DSH's icon rail with badge 6.
- `27-narrow-light.png`, `28-narrow-two-questions-light.png`, `29-narrow-dark.png`: at 760 px, the two-question card (radio buttons, checkboxes, "A question you leave blank is skipped.") and an approval fit, with no sideways scroll.
- `30-keyboard-ring-light.png`: the 2 px ring on *Allow once*.
- `31-dismissed-light.png`: "Dismissed (1)", with the card and *Bring back*.
- `32-thread-delete-approval-light.png`: the coordinator's delete prompt as an approval card, with the full `rm` command. The reason text is the coordinator's, cut mid-path.
- `33-session-watch-off-light.png`: "Decisions needs Session Watch, which is not running.", with *Open Session Watch in Plugins* and *Check again*.
- `34-session-watch-back-light.png`: back by itself. 5 wait, the held approval was handed back, and the waits are kept ("waiting 22 minutes").
- `35-empty-light.png`, `36-empty-dark.png`: everything answered. "Nothing waits on you", with what would show there. *What happened* lists each answer.
- `37-after-two-off-on-light.png`: after Decisions off and on twice beside the coordinator. The page is styled, badge 1, and a decision card shows *Recommended: teal*.
- `38-glass-dark-ground-tint20-light.png`: Wallpaper on, light theme, a dark ground, tint 20 %. The cards are grey; secondary text measures 1.8 to 2.8:1, links 1.3 to 2.0:1 and primary text 4.5 to 7.1:1. Not counted: OPEN-QUESTIONS #15.
- `39-glass-dark-ground-tint20-dark.png`: the same in dark. The text reads.
- `40-notifications-off-light.png`: Notifications switched off: "Each new card would notify you, but the Notifications plugin is not running: switch it on in Plugins to get them.", with *Open Notifications in Plugins* (Wallpaper still on).

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

**Blocker:** none.

**Major:** none.

**Minor**

1. **A reply that ends with a plain question shows only that question.**
   - Where:
     - `replyCard` in `plugins/decisions/lib/cards.js`, which takes `ask.question` only;
     - `DecisionCard` in `lib/client.js`.
   - What:
     - The model proposed three names and ended "Which one do you prefer?". The card said only "Which one do you prefer?" (picture 06).
     - So the person must open the session to learn the choices, and cannot use the answer box in place.
     - The log's "To:" line and the mirror's note carry the same bare line.
   - Fix:
     - Carry the reply's last lines before the question (up to about 4 lines or 400 characters, with links made plain).
     - Show them under the question, folded after two lines, and send them to the mirror too.
     - Add a unit test (a list, then a question) and a page check.

2. **A thread's handback that leads with its recommendation gets no *Recommended* line and no *Go with the recommendation*.**
   - Where:
     - `recommendationIn` in `plugins/decisions/lib/shared/words.js` (and `shared/host/words.js`). It reads only the last line, and it needs a question before the pick.
     - `threadCards` in `lib/cards.js`.
   - What:
     - Thread t1 handed back "Recommend 9090 for the status page. The dev server is at …, so 8080 …; 9090 is fully free … Pick 8080 only if the page must share the dev origin."
     - The card showed that whole paragraph as its question, with no question mark, no *Recommended* line and no button (picture 06).
     - The chat's relay had "**9090 (thread's recommendation)**", which was not read either.
     - README line 39 says a recommendation in any of them "shows under *Recommended*, with **Go with the recommendation**".
     - The e2e's scripted handback puts the pick where the parser looks, so the e2e passes.
   - Fix:
     - Also read "Recommend X for …", "Recommend: X" and "X (recommended)" as a sentence anywhere in a handback's summary or in its relay.
     - When the summary has no question, head the card "The thread needs your decision:" and show the summary under it.
     - Add the real model's phrasing to `test/suite-shared.test.js`.

3. **A wrong `mirrorCommand` stops the whole inbox, even when the mirror is not set to Command.**
   - Where: `checkConfig` in `plugins/decisions/lib/config.js` checks `commandLine(settings, 'mirrorCommand', { optional: true })` whatever `mirror` is.
   - What:
     - With `mirror: 'off'` and `mirrorCommand: [cmdsink.sh]` in the profile, the page said "Decisions is waiting for a setting to be fixed".
     - The one waiting card left the list. No approval or question would be listed or held until I fixed a setting that was not in use.
     - Choosing *Nowhere* in the form cannot help, because the form does not edit `mirrorCommand`.
   - Fix:
     - Check `mirrorCommand` only when `mirror` is `command`.
     - Even then, consider stopping only the mirror ("New cards cannot go to your command: …") rather than the inbox.

4. **The command mirror is named "sh".**
   - Where: the mirror's `place` in `plugins/decisions/lib/mirror.js` (`basename(command[0])`, lines 143, 170 and 285).
   - What:
     - With `[/bin/sh, …/cmdsink.sh]`, the header read "New cards also go to sh: 9 of 30 this hour", and every row said "Sent to sh" (pictures 35 to 37).
     - A shell, `node` or `python3` wrapper is the common way to run a script.
   - Fix: when the program is a shell or an interpreter, name the script (the first argument that is a path), here "cmdsink.sh".

**Nit**

5. **Profile settings apply at once, but the page and the README say a restart.**
   - What:
     - The page's message for a wrong `mirrorCommand` ends "then restart DSH" (`lib/client.js` line 678, picture 21).
     - README line 155 says profile settings "apply after a restart".
     - Here, DSH re-applied Decisions within a second of each save of the profile, three times, with no restart.
     - These changes leave no line in *What happened*. A non-live setting (`mirrorCommand`) restarts Decisions, and starting with a wrong value is not logged. The live `windowHours` change was logged.
   - Fix: say "DSH applies it when you save the file", and log a line when Decisions starts with a wrong setting or with a changed profile.
6. **A blocked card's text is the bare words after `BLOCKED:`.** "valid staging credentials (e.g., deploy token/SSH key) and the target staging environment details." reads like a cut sentence (picture 06). Lead it with "It needs:".
7. **The console fills with 404s while Session Watch is off.** The page asks for `decisions/state`, `decisions/badge` and `session-watch/wait` about every 4 s. Each 404 prints a red "Failed to load resource" line in the window's console (11 in 13 s). Until Session Watch runs, ask only for its status, and less often.
8. **An approval or question card from a coordinator's thread does not name its chat,** though the thread's own card does ("a thread of “Status page work”"). Add it.

**Not counted**

- **Light glass over a dark ground at tint 20 %** (picture 38).
  - Secondary text measures 1.8 to 2.8:1, links 1.3 to 2.0:1 and primary text 4.5 to 7.1:1. The cards' glass is at tint + .2 (`rgba(250, 250, 246, .4)`).
  - This is DESIGN.md's open question "A floor for the tint slider" (OPEN-QUESTIONS #15), which waits on the owner.
  - The dark theme over the same ground reads (picture 39).
- **DSH's forced stop with an approval waiting.** It happened with Decisions switched off too, and both quits with nothing held were clean.
- **The chat after a thread's answer.**
  - After I answered thread t1 from Decisions, the coordinating chat told the person the earlier handback "was still awaiting your pick".
  - Yet the thread had the answer as its turn 2, and it handed back *done* with 9090.
  - That wording is the coordinator's relay. The coordinator could tell the chat when a thread's question is answered elsewhere.
- **The delete prompt's text** is the coordinator's, and it is cut mid-path. The card shows the full command under it.

## What would make it a 9.5

- **Every card answerable where it is.**
  - A plain question comes with the lines that lead to it.
  - Every thread card has *Go with the recommendation* when the thread recommends anything, in the words the real model uses.
  - An approval from a thread names its chat.
- **A wrong setting stops only what it touches.** A bad `mirrorCommand` stops the mirror and says so. It never stops the inbox, and it is not checked at all while the mirror is not set to Command.
- **The command mirror is named by its script**, not "sh".
- **Tests in the real model's words.**
  - Add GLM's handback and plain-question shapes to the shared tests.
  - Add an e2e step where a thread's *Allow once* delete prompt is answered from Decisions.
- **Profile wording that matches what happens:** a change applies on save, with a line in the log.
- **A quiet console while Session Watch is off.**
- **A light-glass floor at low tints** (the owner's call).

## Live DSH fingerprint (before and after)

- Before (5:42 AM PDT, `dsh-test fingerprint`): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 `e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020`.
- After (6:29 AM PDT, with my stand-in webhook stopped and after `dsh-test --name suite-decisions-j3 destroy`): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 `e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020`. Unchanged.
- The three e2e runs checked it before and after too: unchanged.
- Nothing was loaded into, restarted in or edited in the live DSH. The installed app is still DSH 0.2.0-rc.2.
- My instance is destroyed (no `~/.dsh-test-suite-decisions-j3*` is left), my stand-in webhook (the only process of mine still running) is stopped, and no other instance was touched.

## Round 2 findings

1. **Answering a thread's card brought the chat's relay back as a card: fixed.**
   - Live, the chat's relay asked a question ("which port … 8080 or 9090?"). It stayed folded into the thread's card.
   - After my answer, no card came for the chat: not at once, not after the thread's *done* handback, and not after five restarts.
   - `state.json` keeps the handbacks it has seen.
   - The e2e has the step "answered, the chat's relay of it does not come back".
2. **Off and on in Plugins left the page unstyled and removed the coordinator's sheet: fixed.**
   - I switched Decisions off and on three times from Plugins, with the coordinator loaded.
   - Decisions' sheet went 1 → 0 → 1 each time, and the coordinator's `style[data-projects-nest]` stayed at 1.
   - `.dshdc-sr` computes `position: absolute`, the header's glass computes, and the badge is red (picture 37).
   - The e2e has the step "each keeps its own style sheet".
3. **Question-box answers not proven on DSH 0.2.0-rc.2: fixed.**
   - The cards' ids still end in `:q1`, because DSH passes no call id.
   - But each card now takes the call Session Watch says the session waits on (`inbox.js` line 356).
   - Both answer rows got their proof time within 0.3 s. I matched each to the session's `tool/result`.
4. **A handed-back request described wrongly: fixed.**
   - The card says "Decisions handed this back to the session's own card when it stopped", with *Answer in the session*.
   - It kept its first place and its "holding a running turn" count.
   - The log has "Handed back to the session's own card", with the why (pictures 23 and 24).
5. **The header never said a mirror send failed: fixed.** "The last new card was not sent: 127.0.0.1:18977 answered 500 (just now)." shows in the warning tone, and the test line is gone (pictures 14 and 15).
6. **The answer line went stale: fixed.** "Your answer reached “…”." follows its row to *delivered* or *answered*, and goes after two minutes (`saidNow` in `lib/client.js`).
7. **Light glass over a dark picture fails contrast: not fixed, and not counted.** This is the owner's open question. I measured it again (see "Not counted").
8. **An open three-row answer box on every text card: fixed.** The box is one line, and it grows on focus (pictures 06 and 07).
9. **The page's choice error used the stored words: fixed in code.** It now reads `must be Nowhere ("off"), Webhook ("webhook") or Command ("command") (it is …)` (`shared/host/settings.js`). I did not set a wrong `mirror` live.
10. **"Held back sent messages", and once-an-hour notes after a restart: fixed in code.** The line is now "Held back new cards: N went to … in the last hour", and the time each note was last said is kept in `state.json`. Unit-tested. I never reached the limit live.
11. **The first arrow key on a choice with no valid value: fixed in code.** It walks from the focused choice (`walkUnset`). Not tried live.
12. ***Open Decisions' settings* focused *Use the default*: fixed.** It put the cursor in the `windowHours` field live (picture 20). For a choice, the first choice takes the focus (code).
13. **Webhook address changes not logged: fixed.** The log has "Webhook address set", with the key store as the why (picture 16).
14. **No button to open Notifications: fixed.** The header has *Open Notifications in Plugins* (picture 40).
15. **Raw markdown in a reply card: fixed in code** (`plainLinks` in `lib/cards.js`). No reply card with a link appeared live, because the chat's relay with one stayed folded.
16. **DSH's own issues, not judged: unchanged.** The forced stop with an approval waiting is still DSH's: it happened with Decisions off too.
