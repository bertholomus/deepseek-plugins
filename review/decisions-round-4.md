# Decisions: judge round 4

Commit f341843634d692e10558bd8736c4d022a3141042, judged 2026-10-17, 5:44 to 7:51 PM PDT. DSH Test instance suite-decisions-j4 (installed app, DSH 0.2.1-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | Every kind of card the brief names came from the real model, and every answer from the page was proven in the session's own log, a coordinator's two threads with their send and delete prompts included; but after a restart a plain question's card drops its lines and its pick, a long pick is cut mid-word and sent that way, and a thread's decision reaches the webhook twice when its chat is busy. |
| Reliability | 8.5 | A forced restart under four running turns, Decisions and Session Watch off and on, `enabled: false`, a failing webhook, the hourly limit, a missing program and wrong types for a switch, a choice and a number all held, and no answer was lost or sent twice; but a thread's decision was announced and mirrored twice both times its chat took the handback late, a restart drops what a waiting reply card showed, and a number in quotes cannot be fixed by saving it as shown. |
| UX / polish | 8.5 | A calm DSH page in both themes and at 760 px, every stop with the 2 px ring, one-line answer boxes, every approval from a thread named by its chat, and round 3's wording points met; but the form shows a quoted number as fine, a pick ends in "whe", a thread's card restarts its wait, and a few lines disagree or sit outside their card. |
| Test depth | 8.5 | 806 unit tests and 108 real-DSH checks on three builds, all green, with round 3's points now tested; but each bug I found lives where no test looks (a number in quotes in the form, a reply card's lines after a restart, a long pick, a thread's own decision line before its chat takes the handback), and the README and #32 name an e2e start with a number in quotes that is `"yes"` for a switch. |
| Docs | 8.5 | A thorough README that held almost everywhere I checked it; but "One decision makes one card" fails while the chat is busy, a number in quotes is not "flagged as soon as the form opens", and its test section names an e2e step that is not there. |

Plugin score: min(U, R, mean) = min(8.5, 8.5, 8.5) = 8.5. Verdict: PASS.

## What I ran

- **Build.** `git archive f341843 | tar -x` into my own folder (`~/Projects/dsh-plugin-suite-judge/decisions-r4/head`), with `.e2e` linked to the builder's DSH installs. In the builder's tree I wrote only this scorecard, its pictures and one scoreboard row.
- **Unit tests.** `npm test`: 806 of 806 pass (89 s). Decisions' own files hold 63 test blocks (53 host, 10 page); `test/suite-config.test.js` holds the #32 checks for every suite plugin's schema.
- **Real-DSH e2e.** `node scripts/e2e.mjs decisions`: 108 of 108 on DSH 0.2.0-rc.2 (102 s), 108 of 108 on 0.2.1-rc.1 (102 s) and 108 of 108 on the installed app's 0.2.1-rc.2 (80 s). Its own fingerprint check: live DSH unchanged. I read its step list against the README.
- **My instance.**
  - `dsh-test --name suite-decisions-j4 up` at 5:45 PM, then `defaultPreset: workspace-write` in its profile, and a restart.
  - Session Watch, Decisions and the coordinator loaded from my build, and the session bridge from the DSH Test plugins folder. `doctor`: import check 0 errors, isolation ok. Notifications (from my build) was added at 6:07 PM and ran a minute later. At 7:47 PM I added Wallpaper (from the DSH Test plugins folder) for the last restart.
  - The window driven with Playwright (the e2e's own Chromium) at 1280 and 760 px, light and dark.
  - Ten real sessions on GLM-5.3-Flash-EXL3 through the owner gateway, started through the session bridge: seven plain ones, a coordinating chat and its two threads. The gateway was slow this evening: many attempts timed out at 300 s and were retried, and one session's only turn ended with a transport error.
  - No full-access mode was used. For an approval I set one session to Read Only with DSH's own `/permission read-only` before its first prompt, as round 3 did. One session ("Judge note outside") asked the model to request a wider mode for one write outside the workspace; its only turn ended with the transport error before any tool call, and I did not try that again.
  - Every claim below was checked in the session's own log (`/sessions/:id/events`), Decisions' `state.json` and `events.jsonl`, the coordinator's log, the file a tool wrote or deleted, or my stand-ins' logs.
- **Cards from the real model.**
  - **Decision line** ("Status page port"): "DECISION NEEDED: Which port should the status page use, 8080 or 9090? — recommend: 9090, since the dev server already holds 8080". The card showed the paragraph before it and *Recommended: 9090, since …*. *Go with the recommendation* reached the session as turn 2: `[Decisions] The person answered your DECISION NEEDED line (“…”): go with your recommendation (9090, since the dev server already holds 8080).`
  - **Inline blocked marker** ("Staging deploy"): "…no fallback path exists for me to continue the deployment. BLOCKED: working staging credentials for the deploy account." made a card headed *Blocked on:*. My own words, sent while it was idle, were its turn 2, and it answered "The deploy waits for credentials."
  - **Plain question** ("Release branch name"): two names, "I would recommend **release/v2** because …", then "Which one do you prefer?". The card carried the list (folded after two lines) and a recommendation cut mid-word (finding 3). At 7:06 PM *Go with the recommendation* sent the cut words as turn 2; the model went with release/v2 and offered more, which made no card.
  - **Question box, by choice** ("Badge colour"): I picked Blue. The `tool/result` is `{"answers":[{"id":"badge_colour","selected":["Blue"]}]}`, and the log row says *answered*.
  - **Question box, own words, while running** ("Card colour"): "Neither: make it dark green, please." The `tool/result` carries it as `custom`, and the model answered "You chose dark green for the card border."
  - **Approval** ("Notes file", Read Only): the sandbox refused the write, the model asked for Workspace Write, and *Allow once* from Decisions' card wrote `notes.txt` with the line asked for (`approval/decided` in the log).
- **Coordinator: one chat ("Release chat") with two threads,** started with `/coordinate`.
  - **"Ping sink"** (one POST to my stand-in at `127.0.0.1:47811/ping`):
    - The coordinator's send prompt became an approval card "in a thread of “Release chat”". *Reject* at 6:42 PM: the tool got the rejection, and nothing reached my stand-in.
    - The thread handed back needing a decision. Its own last reply's `DECISION NEEDED:` line made a decision card at 6:58:04 PM (notified, mirrored). The chat was busy relaying the earlier approval and took the handback at 6:59:32 PM; the thread's card then replaced the first one and was announced and mirrored again (finding 1).
    - I answered the thread's card in my own words at 7:05 PM. It was the thread's turn 2: `[Decisions] The person answered your handback (“Declined at the prompt: …”): Yes, I approve: send that one POST now and tell me what the sink answered.`
    - The thread ran `curl` again, so the send prompt came back as a new card. *Allow once* at 7:14 PM: my stand-in logged `POST /ping` with body `hello` at 7:14:14 PM, the thread's `tool/result` is `HTTP/1.1 200 OK … ok`, and the thread handed back *done*.
  - **"Old notes"** (look at `old-notes.txt` and propose what to do):
    - Its own reply ended "DECISION NEEDED: Delete old-notes.txt? — recommend: yes, delete; …", which made a decision card at 7:00:03 PM (notified, mirrored). The chat took the handback at 7:13:07 PM, and the thread's card, *Recommended: deleting it*, replaced it: announced and mirrored again, its wait started over (finding 1).
    - *Go with the recommendation* at 7:14 PM was the thread's turn 2: `go with your recommendation (deleting it).`
    - The thread ran `rm`, and the coordinator's delete prompt became an approval card "in a thread of “Release chat”", with the full command. *Allow once* at 7:29 PM: `approval/decided` in the thread's log, the tool's result "No such file or directory / confirmed deleted", the file gone, and the thread handed back *done*.
  - The chat relayed each handback after I had answered it (7:13 and 7:25 PM), and relayed both approvals as still waiting after I had allowed them (7:40 and 7:47 PM). None of these came back as a card, and nothing was announced for the chat.
- **Restarts.** One clean (5:46 PM, nothing waiting); one forced by DSH Test at 6:22 PM ("forced, killed 5 leftover process(es)") with the reply card waiting and four turns running; and one forced at 7:47 PM under the chat's running turn (it reads *interrupted* since), with nothing waiting.
  - The waiting card kept its first wait (first seen 6:03 PM), and nothing was announced, notified or mirrored again by a restart: over the whole run `events.jsonl` has one *new* line per card id, and the last restart added no line at all.
  - But the reply card came back without its lines and its pick (finding 2).
- **Session Watch off and on in Plugins** (6:08 to 6:10 PM): "Decisions needs Session Watch, which is not running.", with *Open Session Watch in Plugins* and *Check again*. Back on, the card returned with its wait, and nothing was announced again.
- **Decisions off and on in Plugins**: its rail entry, page and style sheet went, and came back styled with the badge.
- **`enabled: false` in the profile**: the page says Decisions is switched off there, lists and holds nothing, and says how to switch it on.
- **Dismiss and Bring back**: the badge went down and up, and both are logged.
- **Notifications.** Before the plugin ran: "Did not notify you: the Notifications plugin is not running", said once. With it running: "Notified you by the system" for each new card from a plain session or a thread's own reply (4 in all), and none for a thread's approvals or handbacks, which the coordinator announces (its log has its own news for each).
- **Mirror.**
  - **Webhook stand-in:** a small web server of mine on 127.0.0.1:47811. Its address, typed into the form, was masked there, and afterwards it was only in my instance's key store: not in the profile, `state.json`, `events.jsonl` or DSH's logs.
  - *Send a test* and every new card reached it as `{content, allowed_mentions:{parse:[]}}`. With the stand-in answering 500, the test said "Not sent: 127.0.0.1:47811 answered 500." and logged *not sent*.
  - **Hourly limit:** with `mirrorPerHour: 2`, the third card was held, and "Held back new cards: 2 went to the webhook at 127.0.0.1:47811 in the last hour" was said once. The header's count matched my stand-in's log, and tests are not counted.
  - **Command:** `mirror: command` with `[/bin/sh, cmdsink.sh]` in the profile. It is named "cmdsink.sh", and *Send a test* arrived on its input as one JSON line (text, kind, title, question). No new card came while it was set; the e2e checks a card's note through a command. With `/no/such/program`, the page said so and kept listing cards.
- **Wrong settings.**
  - **`windowHours: "72"`** (the #32 case): finding 4. Session Watch's `deliveryTimeoutSeconds: "600"` is the same.
  - **`notify: "yes"`** and **`mirror: sometimes`**: each named on the page with its value, and flagged in the form with the focus on it; fixed from the form, then "Settings fixed".
- **Look.** 1280 and 760 px, light and dark, and the keyboard through the page.
- **Not exercised live:** a timed question's late answer, Autopilot's *Ask first*, and a held approval cut off by a restart (the e2e has all three).

## What I saw (each picture, one line)

- `01-empty-light.png`, `02-empty-dark.png`: the empty page, "Nothing waits on you", with what would show there.
- `03-settings-light.png`, `03b-settings-form-light.png`, `04-settings-form-dark.png`: Plugins → Decisions: the four kinds, the hours field, the notification switch and *Also send new cards to*, light and dark.
- `05-quoted-number-light.png`, `06-quoted-number-dark.png`: with `windowHours: "72"`, the page says "Decisions is waiting for a setting to be fixed." and names it with its value, with *Open Decisions' settings*; the log row says *waiting on a setting*.
- `07-quoted-number-form-light.png`: the button put the cursor in the field, which shows `72` with only a *Changed* tag, no error (finding 4).
- `08-quoted-number-retyped.png`: `72` typed again: *Save* stays disabled.
- `09-quoted-number-fixed.png`: after *Use the default* and *Save*: "Settings fixed: Decisions is working again".
- `10-cards-light.png`, `11-cards-dark.png`: the question box card (Red or Blue, with their descriptions and an own-words box) over the decision card with its paragraph and *Recommended: 9090, …*; "2 waiting on you · 1 holding a running turn".
- `12-badge-light.png`, `13-badge-dark.png`: the red badge "2" on the rail's icon.
- `14-question-picked.png`, `15-question-sent.png`: Blue picked, then "Your answer reached “Badge colour”." with the row *answered*.
- `16-decision-answered.png`: "Went with the recommendation: 9090, …" *delivered*, "Answered: Blue" *answered*, and "Did not notify you: the Notifications plugin is not running" (while the header says "not installed", nit 7).
- `17-mirror-webhook-form.png`, `18-mirror-saved.png`: *Webhook* chosen and the address typed (masked), then "An address is set" with the field empty.
- `19-mirror-test-sent.png`: "Test message sent to 127.0.0.1:47811.", "Webhook address set" (why: the key store) and "Settings changed: “Also send new cards to”".
- `20-blocked-card.png`: "Blocked on: working staging credentials for the deploy account." with the paragraph before it; the reply card with its list and a pick ending "whe" (finding 3).
- `21-blocked-own-words.png`: my own words typed into the blocked card.
- `22-mirror-test-failed.png`: the stand-in failing: "Not sent: 127.0.0.1:47811 answered 500." in red between the header card and the list (nit 11), and the row *not sent*.
- `23-narrow-light.png`, `24-narrow-dark.png`: 760 px, light and dark: the cards fit, no sideways scroll.
- `25-enabled-false.png`: `enabled: false`: switched off in the profile, lists and holds nothing, how to switch it on.
- `26-watch-wrong-type.png`: Session Watch's `deliveryTimeoutSeconds: "600"` named on Decisions' page, with no button to its settings.
- `27-watch-form.png`: Session Watch's form: `600`, *Changed*, no error, *Save* disabled (finding 4).
- `28-watch-off.png`, `29-watch-off-plugin-page.png`: Session Watch off: "Decisions needs Session Watch, which is not running.", *Open Session Watch in Plugins*, *Check again*, and the Plugins page it opens.
- `30-watch-on-again.png`: back by itself: the reply card with its list, *Recommended* and *Go with the recommendation*, its wait kept.
- `31-decisions-off.png`: Decisions off in Plugins: its rail entry and page gone.
- `32-mirror-command.png`: `mirror: command`: "New cards also go to cmdsink.sh" and "Sent a test message to cmdsink.sh".
- `33-mirror-command-wrong.png`: "New cards cannot go elsewhere: The command's program /no/such/program does not exist." in the warning tone, the card still listed (nit 9).
- `34-choice-wrong.png`, `35-choice-wrong-form.png`: `mirror: sometimes` named with its value; in the form the choice is flagged and holds the focus.
- `36-keyboard-ring.png`: the 2 px ring on a card's button.
- `37-dismissed.png`, `38-dismissed-open.png`: "Dismissed (1)", then opened with *Bring back*.
- `39-switch-yes-form.png`: `notify: "yes"`: the switch flagged in the form with the focus on it.
- `40-after-restart.png`: after the forced restart: the reply card with "Which one do you prefer?" alone and *Send* only (finding 2).
- `41-question-live-light.png`, `41b-question-live-dark.png`: the "Card colour" question box card (badge 2), the bare reply card, "Held back new cards: …" *held*, and "Notified you by the system" *shown*.
- `42-question-own-words.png`: "Neither: make it dark green, please." typed into the question's own-words box.
- `43-reply-session-opened.png`, `44-reply-card-after-open.png`: the session opened from the card's link; back on the page the card has its list, pick and button again.
- `45-approvals-light.png`, `46-approvals-dark.png`: the thread's send prompt "in a thread of “Release chat”" with the `curl` command, and the Read Only session's "Allow this change with Workspace Write?".
- `47-allowed.png`, `48-rejected.png`: "Allowed once" and "Rejected", each *answered* with its proof.
- `49-thread-decision-line.png`: the Ping sink thread's own decision card: "— recommend approving the exact one-shot command …" left in the question, no *Recommended*, no button (nit 5).
- `50-thread-card-light.png`, `51-thread-card-dark.png`: the thread's card "The thread needs your decision: Declined at the prompt: …" *waiting less than a minute*, and the Old notes thread's own decision card (*Recommended: yes, delete; …*).
- `52-thread-own-words.png`, `53-thread-own-words-sent.png`: my words for the thread, then "Your answer reached “Ping sink”." and the row *delivered*.
- `54-reply-recommendation.png`, `55-reply-recommendation-sent.png`: *Go with the recommendation* on the reply card; the row "Went with the recommendation: release/v2 because … tooling, whe" *delivered*.
- `56-thread-card-and-send-prompt-light.png`, `57-thread-card-and-send-prompt-dark.png`: the second send prompt and the Old notes thread's card, *Recommended: deleting it*, now "waiting less than a minute" (its decision card read "waiting 6 minutes" in picture 55).
- `58-send-prompt-allowed.png`: "Allowed once" for the send prompt.
- `59-thread-recommendation-sent.png`: "Went with the recommendation: deleting it" *delivered*.
- `60-delete-prompt.png`: the coordinator's delete prompt "in a thread of “Release chat”", with the full `rm` command.
- `61-delete-prompt-allowed.png`: "Allowed once", *answered*.
- `62-wallpaper-on-light.png`, `63-wallpaper-on-dark.png`: Wallpaper on, with its default ground: the page's glass cards sit beside Wallpaper's glass sidebar, where Decisions is one of its tabs; after the last restart nothing waits and *What happened* is intact.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

**Blocker:** none.

**Major:** none.

**Minor**

1. **A thread's decision is announced twice when its chat takes the handback late.**
   - Where:
     - `list()` in `plugins/decisions/lib/inbox.js` (lines 416 to 427) folds a thread's own decision line into the thread's card only once that card exists, and the thread's card exists only once the chat's coordinator state holds the handback (`threadCards` in `lib/cards.js`), which is when the chat takes it into a turn.
     - `announce()` (line 557) then treats the thread's card as new: another id, so another *new* line and another mirror note. Decisions notified the first card, though the coordinator announces a thread's handbacks itself.
   - What:
     - Both threads did it, live. "Ping sink": decision card at 6:58:04 PM (notified, mirrored), thread card at 6:59:32 PM (mirrored again). "Old notes": decision card at 7:00:03 PM (notified, mirrored), thread card at 7:13:07 PM (mirrored again). Each time the chat was in a turn on something else.
     - My stand-in got two notes for each decision ("“Ping sink” needs a decision" and "Thread “Ping sink” needs a decision"), *What happened* has two *new* rows, and the coordinator's log has its own news for each handback about a minute before Decisions' notification.
     - The card's wait starts over (picture 55: "waiting 6 minutes"; picture 56: "waiting less than a minute"), and its pick can change ("yes, delete; it contains only …", then "deleting it").
     - README line 36: "One decision makes one card. A thread's handback, the thread's own last reply, and the coordinating chat's reply to that handback … are one card, the thread's".
     - The unit test for this (`test/decisions.test.js` line 551) starts with the handback already in the chat's state, and the e2e's scripted thread ends with a plain reply after its handback, so no decision card comes first.
   - Fix:
     - A session whose coordinator role is `thread` makes its card under one id from its first sight (for example `thread:<session>:<turn>`), so the handback, when it lands, updates that card: one *new*, one wait, one mirror note.
     - Leave notifying it to the coordinator, as for its handback.
     - Add a unit test with the thread's reply first and the handback a scan later, and an e2e step where the chat is held in a turn while the thread hands back.
2. **After a DSH restart, a waiting reply card loses the reply's lines, its recommendation and *Go with the recommendation*, until its session is opened.**
   - Where: `plugins/decisions/lib/inbox.js` line 402 reads `this.watch.stateOf(...)`, which for a session not loaded is Session Watch's saved state, and that leaves the reply's text out. Session Watch has `fullState()` for this, which folds the log.
   - What:
     - Before the restart, "Release branch name" showed "Which one do you prefer?" with "1. release/v2 / 2. rel-2", *Show 1 more line of the reply*, *Recommended: release/v2 …* and *Go with the recommendation* (picture 30).
     - After the restart it showed the question alone, with *Send* only (pictures 40 and 41).
     - When I opened the session from the card's link and came back, the lines, the recommendation and the button were back (picture 44).
     - So round 3's finding 1 comes back after every restart, for every reply card whose session nobody has opened since: on this stack, the overnight case.
   - Fix: for a cold session with an `ask`, read `watch.fullState()` once and keep the result, or keep a card's context and pick in `state.json` when it is first announced. Add a restart step to the e2e that checks a reply card's context and recommendation, not only how many cards wait.
3. **A recommendation read from a plain reply is cut mid-word at 160 characters, with no "…", and sent that way.**
   - Where: `PICK_SAID` in `plugins/decisions/lib/cards.js` (line 105), whose capture is `[^.;!?\n]{1,160}`.
   - What:
     - The model wrote "I would recommend **release/v2** because the `release/` prefix is a widely recognized … in most Git tooling, whereas `rel-2` is …".
     - The card reads "Recommended: release/v2 because the release/ prefix is … in most Git tooling, whe" (pictures 20 and 30). The webhook note had the same cut line.
     - *Go with the recommendation* sent exactly that, as turn 2: "go with your recommendation (release/v2 because … in most Git tooling, whe)." (picture 55).
   - Fix: end the pick at a clause break (" because ", ", which", ", whereas"), or take the bold or code span when the sentence has one (`release/v2`), and otherwise cut at a word with "…" (`clip()`). Add this reply to the unit tests.
4. **A number in quotes, the #32 case, cannot be fixed the natural way in the form.**
   - Where:
     - `SettingsBody` in `plugins/decisions/lib/client.js` (line 930): a saved value is flagged only when its displayed text does not parse, and `"72"` parses;
     - the same kit in Session Watch's page, where Decisions' page sends the person for Session Watch's settings.
   - What:
     - With `windowHours: "72"` in the profile, the page says it exactly: "Keep a reply's question for (windowHours) must be a whole number of hours from 1 to 720 (it is "72")." (picture 05). Decisions lists and holds nothing meanwhile.
     - *Open Decisions' settings* puts the cursor in the field, which shows `72` with only a *Changed* tag and no error (picture 07).
     - Retyping `72` leaves *Save* disabled, because the text equals the saved value (picture 08). Only *Use the default* then *Save* (or another number) fixed it (picture 09).
     - Session Watch's `deliveryTimeoutSeconds: "600"` is the same: Decisions' page names it, without a button (picture 26), and Session Watch's form shows `600`, *Changed*, no error, *Save* disabled (picture 27).
     - A switch set to `"yes"` and a choice set to `"sometimes"` are flagged in the form, with the focus on them (pictures 39 and 35), so only numbers miss.
     - README line 141 says a value saved in the profile that does not fit "is flagged as soon as the form opens".
   - Fix:
     - Flag a saved value whose type is wrong (a number field holding a string), with words such as "Saved as text ("72"); save it to store the number.", and let *Save* write the parsed number even when the text is unchanged.
     - Or take the host's `problem` and flag its field.
     - Add an e2e step: start with `windowHours: "72"`, follow *Open Decisions' settings*, see the flag, *Save*, see "Settings fixed".

**Nit**

5. **"— recommend X" without its colon is not read in a decision line.** The Ping sink thread wrote "DECISION NEEDED: Should I send …? It was declined at the prompt — recommend approving the exact one-shot command …". The card kept the pick inside the question, with no *Recommended* line and no button (picture 49). The README documents `— recommend: <pick>`, but the parser already reads "I'd recommend X" and "Recommend: X" after the question (`test/suite-shared.test.js`), and handbacks and replies read "recommend X" anywhere; read it here too.
6. **The README and #32 say the e2e starts with a number in quotes; it starts with `notify: 'yes'`.** README line 314 ("starts with a number in quotes in the profile (named on the page with the value)") and OPEN-QUESTIONS #32 ("each of their real-DSH tests starts DSH with a number in quotes"); `plugins/decisions/test/e2e/run.mjs` line 724 uses `notify: 'yes'`. No test drives the form with a type-wrong saved number (finding 4).
7. **Not installed, or not running?** With no Notifications plugin, the header says "the Notifications plugin is not installed: add it in Plugins to get them", and the log row for the same card says "the Notifications plugin is not running" (pictures 10 and 16).
8. **Profile edits of settings that restart Decisions leave no line.** `enabled: false`, `mirror: command`, a new `mirrorCommand` and `mirror: sometimes` left nothing in *What happened*; fixing `sometimes` from the form then logged "Settings fixed: Decisions is working again" with no line before it saying what was wrong. The live settings (`windowHours`, `notify`) log both lines. The page's line for a wrong profile-only setting still ends "then restart DSH" (`lib/client.js` line 680), while the README (line 164) and the `enabled: false` page say DSH applies the file when you save it.
9. **A missing mirror program says what is wrong but not where to change it.** "New cards cannot go elsewhere: The command's program /no/such/program does not exist." (picture 33). The one-string case names `mirrorCommand` in Decisions' entry in `cordis.patch.yml`; this one could too.
10. **The console still logs 404s while Session Watch is off:** 6 in 15 s (`decisions/state`, `decisions/badge`, `session-watch/wait`, two each), down from 11 in 13 s.
11. **A failed *Send a test* says why in a red line between the header card and the list** (picture 22), outside any card and away from the button; a success says so under the button, inside the header.

**Not counted**

- **The coordinator's own words.** The chat told me at 6:57 PM that Ping sink "is waiting for your approval", 15 minutes after I had rejected it, after I approved the retry it still listed "approve … or skip" as my options, and at 7:40 and 7:47 PM it said both prompts still waited, after I had allowed them. Those relays are the coordinator's and the model's; Decisions kept them out of the list, as its README says.
- **The delete prompt's reason is cut mid-path** ("deletes /Users/…/decisions-… (rm)"). That text is the coordinator's; the card shows the full command under it.
- **The gateway.** Turns took 5 to 20 minutes, with many retries; one session's turn ended with a transport error.
- **Light glass at a low tint** is the owner's open question (OPEN-QUESTIONS #15). I loaded Wallpaper with its default ground only and did not measure low tints.

### DESIGN.md "Before you push", ticked for Decisions' page and its settings form

- [x] Surfaces: glass cards on its own page (pictures 01, 02, 10, 11); its settings are DSH's own form in Plugins, with no ground of its own (03, 04).
- [x] Only DSH tokens that exist in both versions: the client's 26 `--dsw-*`, `--dsh-*` and `--ds-*` tokens are each defined in both DSH builds in `.e2e` (I searched every one), and from Wallpaper only `--wp-blur`, `--wp-tint` and `body.wp-still`.
- [x] No DSH hash selectors, nothing styled on `:root`, `html` or `body` (`body:not([data-ds-dark-theme])`, `[data-platform=darwin]` and `body.wp-still` only scope its own classes), no `:has()`.
- [x] Motion stops under `wp-still` and reduced motion, `::before` and `::after` included; the glass thickens under reduced transparency.
- [x] `node --check` passes on the client, and `npm test` passes in the archive build (806 of 806, with the naming scan).
- [x] Both DSH versions (the e2e on three builds), both themes, and Wallpaper off and on (pictures 62 and 63, its default ground, in my instance only).
- [x] Off leaves nothing behind (picture 31), and on again repeated nothing.
- Outside the list: §9's "states say what to do next" misses the missing program's place (nit 9), and Session Watch's wrong value on Decisions' page has no button (picture 26).

## What would make it a 9.5

- **One decision, one announcement.** A thread's own decision line and its handback are one card from the first sight, with one wait, one mirror note and the coordinator's one notification.
- **Cards that survive a restart whole.** A reply card keeps its lines and its pick through a restart, without opening its session.
- **Picks in the real model's words.** End a pick at a clause break or take its bold span, never cut one mid-word, and read "— recommend X" without the colon.
- **The #32 form path.** A number in quotes is flagged in the form and saved as the number with one *Save*, in Decisions' form and Session Watch's.
- **Tests in the real model's shapes and timing.** Both threads' real replies, the long pick, a chat that takes its handback late, and a restart step that checks what a card shows, not only how many wait; and the README's e2e line made true.
- **Small words:** one wording for "not running", the place to fix a missing program, a failed test's reason inside the header, a quiet console while Session Watch is off.

## Live DSH fingerprint (before and after)

- Before (5:44 PM PDT, `dsh-test fingerprint`): pid 18756, started Sat Oct 17 10:39:36 2026, `cordis.patch.yml` sha256 `63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7`.
- After (7:50 PM PDT, with my stand-in webhook stopped and after `dsh-test --name suite-decisions-j4 destroy`): pid 18756, started Sat Oct 17 10:39:36 2026, `cordis.patch.yml` sha256 `63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7`. Unchanged.
- The three e2e runs checked it before and after too: unchanged.
- Nothing was loaded into, restarted in or edited in the live DSH.
- My instance is destroyed (no `~/.dsh-test-suite-decisions-j4*` is left), my stand-in webhook is stopped, and no other instance was touched.

## Round 3 findings

1. **A plain question's card showed only that question: partly fixed.** The card now carries the reply's last lines before the question, folded after two lines, and the pick said in the reply, live (pictures 20 and 30) and in the e2e; the mirror's note carries the lines too. But a restart drops them until the session is opened (finding 2), and a long pick is cut mid-word (finding 3).
2. **A handback that leads with its recommendation got no button: fixed.** Old notes' handback "… Recommend deleting it. Awaiting …" got *Recommended: deleting it* and *Go with the recommendation*, which sent "go with your recommendation (deleting it)." (pictures 56 and 59). A handback that asks nothing is headed "The thread needs your decision:" (pictures 50 and 56). Round 3's phrasing is unit-tested. A decision line's "— recommend X" without the colon is still not read (nit 5).
3. **A wrong `mirrorCommand` stopped the whole inbox: fixed.** A missing program stops only the mirror and says so, while the card stays listed (picture 33); the README says it is checked only while `mirror` is `command`.
4. **The command mirror was named "sh": fixed.** It is "cmdsink.sh" in the header and every row (picture 32).
5. **Profile settings said "restart" though they apply at once: partly fixed.** The README and the `enabled: false` page say DSH applies the file when you save it; the page's line for a wrong profile-only setting still says "then restart DSH", and those edits are still not logged (nit 8).
6. **A blocked card read as a cut sentence: fixed.** "Blocked on: working staging credentials for the deploy account." (picture 20).
7. **Console 404s while Session Watch is off: partly fixed.** 6 in 15 s, down from 11 in 13 s (nit 10).
8. **An approval from a thread did not name its chat: fixed.** Both send prompts and the delete prompt read "in a thread of “Release chat”" (pictures 45, 56 and 60), and the mirror's note says it too. No thread asked in the question box live; the same code in `list()` (`lib/inbox.js`) names the chat for any card from inside a thread, and a unit test covers the approval.
