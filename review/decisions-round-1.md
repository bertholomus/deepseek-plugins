# Decisions: judge round 1

Commit 592e854, judged 2026-10-17, 2:41 to 3:26 AM PDT. DSH Test instance suite-decisions-j1 (installed app, DSH 0.2.0-rc.2), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8 | Every kind of card worked end to end with the real model, coordinator threads included, but a real reply's inline `BLOCKED:` made no card, and an inline decision line loses its recommendation. |
| Reliability | 8.5 | No error through five restarts, Decisions and Session Watch off and on, a wrong setting and a failing sink, and switching it off handed a held approval back to DSH's card; but wait times reset and notifications leave no trace. |
| UX / polish | 8 | A calm, DSH-native page in both themes and at 760 px with a real focus ring; small flaws add up: a broken pill on the setting the page sends you to fix, "Sent to" on a failed send, two cards for one thread decision, a 3.3:1 badge in dark. |
| Test depth | 8.5 | 486 unit tests and 85 real-DSH checks on three builds, all green; no fixture for an inline marker (the miss shipped), no coordinator thread in the e2e, and the unit tests leave temp folders behind. |
| Docs | 8.5 | A thorough and mostly exact README (cards, settings with ranges, mirror, files, switch-off, rollback); it says decision and BLOCKED lines are listed "either way" and that the e2e makes every kind of card, and neither is true. |

Plugin score: min(U, R, mean) = min(8, 8.5, 8.3) = 8. Verdict: NOT YET.

## What I ran

- **Build.** `git archive 592e854 | tar -x` into `/private/tmp/judge-decisions-r1/head`, `.e2e` linked to the builder's DSH installs.
- **Unit tests.** `npm test`: 486 of 486 pass (2.9 s). Decisions has 40 of them (33 host, 7 page).
- **Real-DSH e2e.** `node scripts/e2e.mjs decisions`, once per build, pictures into my folder: 85 of 85 on DSH 0.2.0-rc.2 (62 s), 85 of 85 on 0.2.1-rc.1 (69 s), 85 of 85 on the installed app's DSH 0.2.0-rc.2 (60 s). Each run's own fingerprint check: unchanged.
- **My instance.** `dsh-test --name suite-decisions-j1 up`, `defaultPreset: workspace-write`, then Session Watch, Notifications, Decisions and Autopilot (default rule `ask`) loaded from the head, restart. 18 real sessions on GLM-5.3-Flash-EXL3 (effort high) started through the session bridge. The page and Plugins were driven with the e2e harness's own browser helper (`openWindow`, `setDark`, `shot`) at 1280 and 760 px, light and dark. Every claim below was checked against the session's own log (`/sessions/:id/events`), the file the tool wrote, or my stand-in's log.
- **Stand-ins I ran myself, the only mirror targets ever set.** A webhook on 127.0.0.1 (a small node server writing to my folder, its answer switchable between 204 and 500) and a command (`cmd-sink.sh`, appending its input to a file in my folder). Both stopped at the end.
- **Answers, each proven in the session's log.**
  - A decision line: *Go with the recommendation* went in as `[Decisions] The person answered …`, and the next turn read it.
  - A plain question: my words went in, and the next turn answered them.
  - A question-box question: my choice came back as the tool's result.
  - A held approval: *Allow once* from the page closed DSH's own card, and the file was written. *Reject* from the page: no file.
  - An approval answered in DSH's own card instead: the Decisions card left, and *What happened* said "Answered in the session: allowed once".
  - Autopilot's Ask first after a cut-off: *Tell it to carry on* was carried out by Autopilot.
- **Markers under a project rule.** A natural `DECISION NEEDED` line and a natural `BLOCKED` line on their own lines each made a card. Two control replies made none. One real reply put `BLOCKED:` at the end of its last sentence and made no card (see Findings 1).
- **Coordinator, loaded into a second, fresh instance of the same name.**
  - Two threads. A thread's command sending a POST to my 127.0.0.1 stand-in showed as an approval card in the coordinator's words. *Allow once* from the page: the thread's log shows `approval/asked`, then `approval/decided`, then the command ran, and my stand-in logged the POST.
  - The other thread handed back `needs_decision`, which made a thread card. My words "Use 8080." went into the thread, whose log shows `[Decisions] The person answered your handback (…)` and the reply "The user confirmed: use port 8080."
- **Mirror.**
  - Webhook: the test message and each new card reached the stand-in as `{content, allowed_mentions:{parse:[]}}`. With the stand-in answering 500, the failure was logged.
  - The address was only in DSH's key store (`.credentials.yaml`, mode 600). It was never in the profile, a log or a picture.
  - Command (`mirror: command`, `mirrorCommand` set to my script, restart): the test message, then a new decision card arrived as one JSON line with `text`, `kind`, `title`, `question`, `recommendation` and `sessionId`.
- **Edges.**
  - Five restarts of the first instance, three with a turn waiting on an approval: nothing was announced twice, and Autopilot's ask ids stayed stable. Each restart with a pending approval needed DSH Test's forced stop after 30 s. That happened with `approvals: false` too, so the forced stop is DSH's, not Decisions'.
  - Decisions off and on in Plugins with a held approval.
  - Session Watch off and on in Plugins.
  - An unknown `mirror` value written into the profile while DSH ran, then fixed in the form.
  - 1000 hours typed into the form.
  - Dismiss, then *Bring back*.
  - An empty instance (destroyed and created again under the same name).
  - Keyboard: a full sweep at 760 px.
  - Files: `decisions/` is 700 and its files are 600.
  - Every CSS custom property the page reads, checked against both DSH builds.
- **Not exercised live.** A timed question's late answer (unit tests only). Wallpaper's glass (not loaded). A system notification on screen: Decisions calls the notifications service, but nothing shows whether it went. `enabled: false`: only the e2e picture.
- **Window console.** No errors from Decisions. The Notifications plugin's own browser half logs a 404 for its `pending` endpoint; that is not judged here.

## What I saw (each picture, one line)

- `empty-instance-light.png`: a fresh instance. The header says "Nothing waits on you.", the empty list says what would show there, *What happened* says "Nothing yet", and there is no badge.
- `empty-instance-dark.png`: the same in dark, readable on DSH's dark ground.
- `real-page-light.png`: four real cards at once (an approval with its path, a question-box question with two choices, a plain question, a decision), "4 waiting on you · 2 holding a running turn", badge 4.
- `real-page-dark.png`: the same in dark.
- `real-approval-light.png`: the approval card: "Allow this change with Full access?", the path in code type, the agent's reason, *More about the call*, *Allow once* and *Reject*.
- `real-approval-dark.png`: the same in dark.
- `real-question-light.png`: the question-box card: its header and question, two choices with descriptions, *Or write your own answer*. The "The session waits on this" line sits above the question.
- `real-question-dark.png`: the same in dark.
- `real-history-light.png`: the decision card with "Recommended: 7 days" and *Go with the recommendation*. *What happened* lists four new cards and none for "Staging access", whose reply ended with an inline `BLOCKED:`.
- `real-history-dark.png`: the same in dark.
- `real-session-approval-light.png`: the same request in its session: DSH's own approval card, untouched, beside the Decisions card.
- `after-allow-light.png`: after *Allow once* on the page: "Sent your answer to “Report outside” …", the card gone, badge 3.
- `after-allow-session-light.png`: that session finished: "Yes — the file … was written". DSH's own card is gone.
- `after-answers-light.png`: everything answered. *What happened* shows *delivered* for words and the recommendation and *answered* for the question box and the approval, with *What it sent*.
- `window-approval-before-light.png`: E3's approval in DSH's own card, about to be answered there instead.
- `after-reject-window-light.png`: "Outside write E3 · Answered in the session: allowed once" and "Outside write E2 · Rejected · You", both *answered*. Only G's approval is left.
- `ask-card-light.png`: Autopilot's Ask first as a card: "from Autopilot", the question, the recommendation, why, *Tell it to carry on* and *Leave it*, a words box, "waiting since just now".
- `ask-card-dark.png`: the same in dark.
- `settings-light.png`: Plugins → Decisions: the four kinds, the window in hours and the notification switch, each with one plain line.
- `settings-dark.png`: the same in dark.
- `settings-out-of-range-light.png`: 1000 hours refused: "A whole number from 1 to 720, or empty for the default (72)."
- `settings-webhook-set-light.png`: Webhook chosen. The address field is empty, with "An address is set", "Kept in DSH's key store …" and *Remove the address*.
- `mirror-header-light.png`: the header: "New cards also go to the webhook at 127.0.0.1:56105: 0 of 30 this hour", *Send a test*, "Test message sent to 127.0.0.1:56105."
- `history-failures-light.png`: with the stand-in answering 500, the rows are headed "Sent to 127.0.0.1:56105" with a red "Not sent: 127.0.0.1:56105 answered 500." and a *not sent* pill.
- `history-failures-dark.png`: the same in dark.
- `wrong-setting-light.png`: an unknown mirror value: "Decisions is waiting for a setting to be fixed.", which setting and what it must be, and *Open Decisions' settings*.
- `wrong-setting-dark.png`: the same in dark.
- `wrong-setting-form-light.png`: the form flags the saved value in red: "The saved value is not one of the choices …".
- `wrong-setting-mirror-row-light.png`: a close-up: a blank white pill covers *Use the default*, so only its "U" shows.
- `command-mirror-light.png`: the command sink: "New cards also go to cmd-sink.sh: 0 of 30 this hour", "Test message sent to cmd-sink.sh."
- `dismissed-light.png`: *Dismissed (1)* with the blocked card and *Bring back*.
- `dismissed-dark.png`: the same in dark.
- `narrow-760-light.png`: a 760 px window with DSH's rail. The cards fit, and there is no sideways scroll.
- `narrow-760-dark.png`: the same in dark.
- `keyboard-focus-light.png`: one keyboard stop: the 2 px ring on the session link.
- `decisions-off-plugins-light.png`: Decisions switched off in Plugins. Its sidebar entry is gone, and the held request is back in its session ("Approval" on the row).
- `decisions-on-again-light.png`: on again: 5 waiting, nothing announced twice, the webhook line back in the header.
- `approval-not-held-light.png`: that approval now reads "Answer in the session — Decisions was not holding this request when DSH asked …".
- `approval-not-held-session-light.png`: the same request in its session: DSH's own card, which I answered there; the file was written.
- `watch-off-light.png`: Session Watch off: "Decisions needs Session Watch, which is not running." with *Open Session Watch in Plugins* and *Check again*, and no badge.
- `watch-off-dark.png`: the same in dark.
- `e2e-app-disabled-light.png`: from my run of the builder's e2e on the installed app: with `enabled: false`, the page says it is off in the profile and how to turn it on or remove it.
- `coord-on-light.png`: the coordinating chat, with DSH's "Coordinating …" banner. Its reply ends "What's the task?", which makes an *asked you* card (badge 1).
- `coord-cards-light.png`: a thread's send prompt in the coordinator's words with the curl command, the thread's *needs a decision* card ("a thread of “Coordinator test”"), and the chat's relay of the same decision as a second card.
- `coord-cards-dark.png`: the same in dark.
- `coord-after-answers-light.png`: after *Allow once* and "Use 8080.": nothing waits. "Answered: Use 8080." is *delivered*, and "Allowed once" is *answered*.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

**Blocker:** none.

**Major**

1. **Inline decision and BLOCKED markers are missed.**
   - Where: `DECISION_LINE` and `BLOCKED_LINE` in `plugins/session-watch/lib/shared/words.js` (and the suite's other copies of `words.js`). Both are anchored to the start of a line. Their result reaches Decisions through `replyCard` in `plugins/decisions/lib/cards.js`.
   - What: the stack's own model ended a reply with "…so I cannot proceed without valid credentials. BLOCKED: working staging credentials (or an approved SSH/database login) for the staging server." Session Watch read no ask, so there was no card at all.
   - An inline `DECISION NEEDED: … — recommend: …` reads as a plain question. It is listed only with `replies` on, as *asked you*, with "DECISION NEEDED:" left in the question and no recommendation.
   - The README and the settings line both say these lines are "listed either way". In this run, 1 of 5 real marker replies was missed.
   - Fix: accept the marker after a sentence end in the reply's last paragraph (for example `(?:^|[.!?]\s+)(?:\*\*)?BLOCKED\s*[:：]`), and keep the recommendation split. Add fixtures taken from real replies (inline, bold, a list item, a trailing period) and one e2e card made from an inline marker.

**Minor**

2. **Two cards for one coordinator decision.**
   - Where: the inbox listing (`lib/inbox.js`, `replyCard` for the coordinating chat).
   - What: after a thread handed back `needs_decision`, the chat's relay ("Reply here with your choice and I'll pass it on.") became an *asked you* card beside the thread's card. Its question has no context.
   - Fix: when the chat's last turn was started by a handback whose thread card is still open, fold the chat's reply into that card or leave it out. Show the reply's question sentence, not its last line.
3. **Wait times restart.**
   - Where: a card's `at` comes from the ask's latest raise.
   - What: after Session Watch off and on, Autopilot's two asks went from "waiting 5 minutes" to "waiting 2 minutes". After a DSH restart, a re-raised ask reads "waiting since just now" for a session cut off minutes earlier. The brief asks for how long it has waited.
   - Fix: keep a first-seen time per card id in `decisions/state.json` (it already keeps what was announced) and show that.
4. **A failed mirror send is headed as sent.**
   - Where: the *What happened* row for a mirror failure.
   - What: "Sent to 127.0.0.1:56105" sits above the red "Not sent: … answered 500." and a *not sent* pill.
   - Fix: head failures "Not sent to 127.0.0.1:56105".
5. **The setting the page sends you to fix is drawn broken.**
   - Where: Plugins → Decisions, *Also send new cards to*, when the saved value is not one of the choices.
   - What: the segmented control draws an empty white pill over *Use the default* (`wrong-setting-mirror-row-light.png`).
   - Fix: give the control no selection, or a valid value, when the saved one is not an option, and keep the reset link outside its box.
6. **Notifications leave no trace.**
   - Where: `announce()` and `say()` in `lib/inbox.js`. The `notify` wrapper in `lib/index.js` drops the service's result (`desktop`, `browser`, `cli`, `none` or `off`).
   - What: the Bar asks that every side effect is logged. *What happened* lists every webhook send but never a notification, sent or not.
   - Fix: journal one line per notification, or per batch, with its result in plain words.
7. **The badge fails contrast in dark.**
   - Where: `.dshdc-badge` in `lib/client.js`, line 82.
   - What: white 10 px text on `--dsw-alias-state-error-primary`, which is #f25a5a in dark, gives 3.3:1. DESIGN.md asks for 4.5:1 for text in both themes.
   - Fix: use the 600 red (#ec1313 gives 4.5:1) or dark text in dark.
8. **The code font token is not DSH's.**
   - Where: `.dshdc-code` uses `--dsw-font-family-mono`.
   - What: neither DSH build defines that token, so the code type silently falls back to the system mono. DESIGN.md (lines 176 and 200) says to use only tokens DSH defines, and code uses `--ds-font-family-code`. Every other token the page reads exists in both builds.
   - Fix: `var(--ds-font-family-code, ui-monospace, …)`.
9. **A held approval cut off by a restart leaves no outcome.**
   - Where: *What happened*.
   - What: G's approval card ("Waiting for your approval", 2:49) vanished at the 2:50 restart with no line saying what became of it.
   - Fix: on start, journal "the turn stopped before an answer" for held cards that no longer wait.
10. **The unit tests leave temp folders.**
    - Where: `test/decisions.test.js` (`mkdtempSync(... 'decisions-')` and nothing removes them).
    - What: about 19 `decisions-*` folders are left in the temp folder per run; 562 were there today. My run's folders are moved out.
    - Fix: `t.after(() => rmSync(dir, { recursive: true, force: true }))`.

**Nit**

11. "Nothing waits on you." in the header and "Nothing waits on you" as the empty title say the same thing twice. DESIGN.md asks to say each thing once.
12. The question-box card puts "The session waits on this …" above the question. Put the question first.
13. "waiting since just now" sits beside "waiting 1 minute". Use one form, such as "waiting less than a minute".
14. *What happened* says "You saved them in Plugins" for an `approvals: false` written into the profile file. A fix in the form reads "You saved Also send new cards to in Plugins". Name the source correctly, and quote the label or rephrase it.
15. A thread card's hint says "It goes into the session as your next message". It goes to the thread, so say so.
16. A thread handback's "Recommendation: 8080 — …" stays inside the question. Split it into the *Recommended* line with *Go with the recommendation*.
17. The hourly mirror count lives in memory: it starts over at each restart and counts failed sends too.

## What would make it a 9.5

- **Markers read the way models write them.** Catch inline, bold and list-item `DECISION NEEDED` and `BLOCKED` in the last paragraph and keep the recommendation. Prove it with fixtures taken from real replies, and state the exact rule in the README and the settings line.
- **One decision, one card.** Fold a coordinating chat's relay into its thread's card, and lift a handback's recommendation into *Recommended* with *Go with the recommendation*.
- **True ages and outcomes.** Keep a first-seen time per card across restarts and Session Watch off and on, and journal what became of a held request a restart cut off.
- **Every side effect in *What happened*.** One line per notification with its result, an hourly mirror count that survives restarts and counts only sends, and failures headed "Not sent".
- **The small polish.** A segmented control that survives an invalid saved value, a 4.5:1 badge in dark, `--ds-font-family-code`, "Nothing waits on you" said once, the question first on question-box cards, and "into the thread" on thread cards.
- **The e2e covers what only a live run proves now.**
  - A coordinator thread: a handback answered into the thread, and a thread's send prompt allowed from the page.
  - Decisions off and on in Plugins with a held approval.
  - A restart with a held approval.
  - A stand-in notifications service, plus unit tests that clean their temp folders.

## Live DSH fingerprint (before and after)

- Before (2:41 AM PDT, `dsh-test fingerprint`): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 `e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020`.
- After (3:23 AM PDT, my instance destroyed and my stand-ins stopped): pid 687, started Fri Oct 16 12:22:37 2026, `cordis.patch.yml` sha256 `e04a0449ecfe8534c414f486c95d4f2cf2d489d1565e2344e68bd7617639a020`. Unchanged.
- Each of the three e2e runs also checked it before and after: unchanged. Nothing was loaded into, restarted in, or edited in the live DSH. My instance `suite-decisions-j1` is destroyed, and no other instance was touched.
