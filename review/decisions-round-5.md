# Decisions: judge round 5

Commit ad79740968fad1d5085f68c0c49bc98dcd79f0eb (branch `goal95/decisions`), judged 2026-10-26, 10:30 to 11:00 AM and 1:37 to 1:57 PM PDT (an account usage limit paused every judge in between). DSH Test instance g95-decisions-j1 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 through the owner gateway, plus a scripted model on loopback for the flows that must be exact.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.0 | Every kind of card the brief names worked end to end, the real model's approval, question-box question and DECISION NEEDED line among them, each answer proven in the session's own log, and all four of round 4's majors are fixed; but a plain question with a dot in it (a file name, a version, a URL, "e.g.") shows only the words after its last dot, on the card, in its notes and in the answer sent back, and on a coding stack that is the common question. |
| Reliability | 9.0 | Two forced restarts, Decisions and Session Watch off and on with the page open, `enabled: false`, a kind switched off under a held approval, three answers to one card at once, a dead webhook and wrong setting types all held: nothing lost, nothing sent twice, every send logged; but the dotted question is quoted wrongly into the session, identifiers in code spans lose `__` and `**`, and switching Decisions off in the profile is logged as "started again". |
| UX / polish | 9.0 | A calm DSH page in both themes and at 760 px, a 2 px ring on every stop, a number in quotes flagged and fixed with one *Save*, a failed test said under its button, Session Watch's wrong setting with its own button; but a card's headline can read "py\` first?" or "3\`?", and a few lines disagree with the screen (off logged as "Decisions on", a hint about an address that does not exist, an empty state naming a kind that is off). |
| Test depth | 9.0 | 851 unit tests with none failing and 130 real-DSH checks on each of three builds, with every round 4 gap now a step (a chat that takes its thread's handback late, a card's lines and pick through a restart, a number in quotes fixed in the form); but no test feeds a plain question with a dot before its question mark or a code span holding `__`, and the last e2e step checks that switching off is logged as "Decisions on". |
| Docs | 9.5 | A thorough README (config table, off and rollback, setup, tests) that held wherever I checked it, with round 4's three wrong claims put right; "shows its last question" fails for the dotted questions, and the profile line it quotes reads "started again" when the change was a switch-off. |

Plugin score: min(U, R, mean) = min(9.0, 9.0, 9.1) = 9.0. Verdict: NOT YET (GOAL95's bar is 9.5 with no criterion below 9).

## What I ran

- **Build.** `git archive ad79740 | tar -x` into my own folder (`~/Projects/goal95/judge/decisions-r5/head`), with `.e2e` linked to the builder's DSH installs. In the builder's tree I wrote only this scorecard and its pictures.
- **Unit tests.** `npm test`: 851 tests, 847 pass, 0 fail, 2 skipped, 2 todo (89 s). Decisions', Session Watch's and the shared-code test files alone: 131 of 131. The shared-code sync check exits 0, and `node --check` passes on the client.
- **Real-DSH e2e.** `node scripts/e2e.mjs decisions`: 130 of 130 on DSH 0.2.0-rc.2 (135 s), 130 of 130 on 0.2.1-rc.1 (170 s) and 130 of 130 on the installed app's 0.2.1-rc.3 (154 s). Its own fingerprint check: live DSH unchanged. I read its step list against the README and round 4's findings.
- **My instance.**
  - `dsh-test --name g95-decisions-j1 up`, with Session Watch, the coordinator, Notifications, Autopilot and Decisions from my build and the session bridge from the DSH Test plugins folder; `defaultPreset: workspace-write` in its profile (no full-access mode was set anywhere).
  - The profile started with `windowHours: "72"` for Decisions and `deliveryTimeoutSeconds: "600"` for Session Watch (the #32 case).
  - The window driven with Playwright (the e2e's own Chromium) at 1280 and 760 px, light and dark. Every picture is of that window only.
- **Real model.** Three sessions on GLM-5.3-Flash-EXL3: a cache design question that ended with a DECISION NEEDED line, a shell command writing outside the workspace (an approval), and a question for DSH's question box. The gateway was slow: the harness's 600 s wait for the first prompt timed out and the turns finished later, and my two restarts cut turns that Autopilot then resumed. Their cards waited 2.5 hours while every judge was paused; I answered all three from the page at 1:38 PM.
- **Scripted model.** For exact flows, a scripted model on 127.0.0.1 in my instance's profile only (the suite's fake model with a control port), driving nine sessions: Cache pick (a decision line), Write outside and Write outside 2 (approvals), Branch name (a plain question with a pick), Deploy target (two question-box questions, one multi-select), Inject test (markup and `@everyone`), Parser fix and Version pick (questions with a dot), Port pick (a BLOCKED line).
- **Stand-ins.** A loopback webhook (`node -e` on 127.0.0.1:47812, stopped by its own pid) and a command mirror (`cmdsink.sh` in my folder, writing its JSON input to a log).
- **Drills.** A forced restart with an approval held; approvals switched off with an approval held; `enabled: false` and back in the profile with DSH running; Session Watch off and on with the page open, counting failed requests; Decisions off and on from Plugins with the page open; the webhook pointed at a dead port, then the command mirror, then the webhook again; three answers sent to one card at once; dismiss and bring back; a Tab sweep of the page.
- **Proof.** Each claim below was checked in the session's own log (`/sessions/:id/events`), Decisions' `state`, *What happened*, my stand-ins' logs, or the file a tool wrote. My webhook got 12 notes: one test and one for each of the 11 cards, none twice through both restarts and both off-and-on drills.
- **Not checked live** (the pause cost the time): a coordinator's threads with the real model (the e2e drives them on all three builds, a chat busy while its thread hands back included), Autopilot's *Ask first* (e2e), a timed question answered late, the hourly limit and `windowHours` ageing (unit tests), Wallpaper on and off, a screen reader.

## What I saw (each picture, one line)

Pictures are in `review/decisions-round-5/`.

- **p01-first-open:** with `windowHours: "72"` the page says Decisions waits for a setting, names it "(it is "72")", and offers *Open Decisions' settings*.
- **p02-settings-quoted:** the form shows `"72"` flagged: "It is saved as text, in quotes. Type a whole number from 1 to 720, without the quotes, then save."
- **p03-settings-typed:** 72 typed without quotes; the flag clears and *Save* wakes.
- **p04-settings-saved:** after one *Save*: Decisions running, *Save* at rest.
- **p05-page-after-fix:** "Settings fixed: Decisions is working again"; Session Watch's `"600"` named in the header with *Open Session Watch's settings*.
- **p06-webhook-typed:** *Webhook* chosen and an address typed (masked); the hint "Leave it empty to keep the one you have." sits beside "No address yet".
- **p07-webhook-saved:** "An address is set", the field empty, *Remove the address*.
- **p08-test-sent:** "Test message sent to 127.0.0.1:47812." under the button; log rows for the address (by its key only) and the test.
- **p09-watch-off:** Session Watch off: "Decisions needs Session Watch, which is not running." with two buttons and nothing else.
- **p10-watch-on-again:** the page back by itself; the success line of a test 6 minutes old is still there.
- **p11-decision-card-light:** Cache pick: its question, the reply's lines folded after two, *Recommended*, *Go with the recommendation*, the badge at 1, *sent* and *shown* rows.
- **p12-after-answer:** my answer "Use the LRU. #note=reply" logged *delivered*; the card gone.
- **p13-approval-light:** Write outside: "Allow this change with Full access?", the file, the reason, *Allow once* and *Reject*, "1 holding a running turn".
- **p14-approval-dark:** the same in dark.
- **p15-approval-narrow-dark:** 760 px, dark: nothing spills sideways.
- **p16-approval-narrow-light:** 760 px, light.
- **p17-after-restart-held-approval:** after a forced restart: "The turn stopped before anyone answered"; nothing announced again.
- **p18-approvals-off-handed-back:** approvals switched off under a held approval: "Handed back to the session's own card"; the header says approvals are not listed, while the empty state below still names "a tool that needs approval".
- **p19-session-own-card:** DSH's own approval card in that session.
- **p20-went-with-rec:** Branch name: "Went with the recommendation: release/v2.0", *delivered*.
- **p21-enabled-false:** `enabled: false`: the header says Decisions is switched off and how to change it; the newest log row says "“Decisions on”, Why: Decisions started again with them."
- **p22-enabled-back:** switched on again: a second, identical row.
- **p23-question-box-light:** Deploy target: two questions with their choices and descriptions, own-answer fields, *Send answers*.
- **p24-question-own-card:** DSH's own question box in that session, question 1 of 2.
- **p25-question-own-card-q2:** the same box 25 s later, still waiting.
- **p26-question-answered:** "Answered: staging; unit, then lint", *answered* (proven by the tool's result).
- **p27-inject:** `<img … onerror>` shown as text and `@everyone` as text; a stray ")" after the link's words.
- **p28-dot-in-code-span:** Parser fix: the headline "py\` first?", its last context line "Should I fix the bug in parser."
- **p29-version-in-code-span:** Version pick: the headline "3\`?" and nothing else to read.
- **p30-real-model-cards-light:** the real model's three cards, waiting 2.5 hours, with the scripted ones: badge 6.
- **p31-real-model-cards-light-tall:** the whole list: the question box (Tabs or Spaces), the approval with the command and the model's reason, the decision line with its context and whole pick.
- **p32-real-model-cards-dark-tall:** the same in dark.
- **p33-answer-box-open:** the answer box grows when it has the focus.
- **p34-after-real-answers:** my three answers to the real model: *Allowed once* (*answered*), *Spaces* (*answered*), my own words (*delivered*).
- **p35-failed-test-under-button:** the webhook at a dead port: "Not sent: 127.0.0.1:47813: it could not be reached." under the button, inside the header.
- **p36-test-button-focus-zoom:** the button after a focus set by script: DSH draws no ring in pointer mode (its own rule).
- **p37-keyboard-ring:** the Tab sweep: the 2 px ring on an answer box (all nine stops had it).
- **p38-decisions-off:** Decisions off from Plugins: no sidebar entry, no page, nothing of its own left.
- **p39-decisions-on-again:** on again: one sheet, the same four cards, nothing announced again.
- **p40-dismissed:** *Dismissed (1)* folded with *Show them*; the row "Version pick · Dismissed · 3\`?"; the command mirror's rows.
- **p41-garbled-question-sent:** my answer to Parser fix as sent: "[Decisions] The person answered your question (“py\` first?”): Yes, fix it first.", *delivered*.

## Findings

**Major**

1. **A plain question with a dot before its question mark shows only the words after that dot: on the card, in its notification and webhook note, and in the answer sent into the session.**
   - Where: `askIn` in `shared/host/words.js` (synced into `plugins/decisions/lib/shared/words.js`, lines 202 to 206). `asking.match(/[^.!?]*\?/g)` splits the line at every ".", "!" or "?", so a file name, a version, a URL, a decimal or "e.g." ends a "sentence". Session Watch's `fold.js` uses the same `askIn`.
   - What:
     - "I found two failing tests in the parser suite. Should I fix the bug in \`parser.py\` first?" made a card headed "py\` first?", with "Should I fix the bug in parser." as its last context line (picture 28). The webhook note said the same. My answer from the page went in as "[Decisions] The person answered your question (“py\` first?”): Yes, fix it first." (picture 41, and the session's log).
     - "Both builds pass. Which do you want to release: \`v1.2\` or \`v1.3\`?" made a card headed "3\`?" with no context at all, since the question was the reply's only line (picture 29). It cannot be answered without opening the session, and its log rows read "3\`?" too (picture 40).
     - The shared code gives the same for "Should I bump the version to 2.0.0 and tag it?" ("0 and tag it?"), "Should I deploy to https://staging.example.com now?" ("com now?"), "Do you want a PR against main, e.g. with only the fix?" ("with only the fix?"), "Want me to run the migration now (it takes about 2.5 minutes)?" ("5 minutes)?") and "The cache is ready. Should I enable it in config.yaml for production?" ("yaml for production?").
     - README line 74 says such a reply "shows its last question". On this stack a question that names a file or a version is the common case.
   - Fix:
     - End a sentence only at a ".", "!" or "?" followed by a space and then a capital letter, a quote, a mark or a code span, and never inside a code span: mask the spans, split with something like `/(?<=[.!?]["')\]]*)\s+(?=[A-Z"'(\[*_])/` (plus the mask's placeholder), take the last part with a "?", and put the spans back. I ran that on the nine shapes above; each came out whole, and "Which one do you prefer? I can also do both." still gives "Which one do you prefer?".
     - Add those shapes to `test/suite-shared.test.js`, and one dotted question to the e2e's plain-question step.

**Minor**

2. **Bold and code marks are dropped inside code spans, so identifiers change on the card and in what it sends.**
   - Where: `plainLine` in `shared/host/words.js` (`plugins/decisions/lib/shared/words.js` lines 58 to 63: `` .replace(/\*\*|__|`+/g, '') ``), and `plainLine` in `plugins/decisions/lib/cards.js` line 49 for the context lines.
   - What: "DECISION NEEDED: Should I rename \`\_\_init\_\_.py\` to main.py? — recommend: keep \`\_\_init\_\_.py\`" reads "Should I rename init.py to main.py?" with *Recommended: keep init.py*, and *Go with the recommendation* would send "keep init.py". "delete \`\_\_pycache\_\_\` and \`\_\_init\_\_.py\`" reads "delete pycache and init.py", "Rename \`my\_\_var\`" reads "Rename myvar", and "Is \`a\*\*b\` the right power operator here?" reads "Is ab the right power operator here?".
   - Fix: take code spans out before stripping marks (keep their text, drop only the backticks), and strip `**` or `__` only as a pair around words, never inside one. Add the four shapes to `test/suite-shared.test.js`.
3. **Switching Decisions off in the profile is logged as if it had started again.**
   - Where: `startEntry` in `plugins/decisions/lib/config.js` (lines 93 to 100) always says "Decisions started again with them." when the check passes; `enabled` gets the title "Decisions on" whichever way it changed.
   - What: with `enabled: false` saved, the header says "Decisions is switched off in DSH's profile …" while the newest log row reads "Settings changed in DSH's profile: “Decisions on”, Why: Decisions started again with them." (picture 21). Switching it on again adds an identical row (picture 22), so *What happened* cannot tell when Decisions was off. The e2e's last step checks only that the row names “Decisions on”.
   - Fix: when `enabled` changed, say which way ("Switched off in DSH's profile (enabled: false): Decisions lists and holds nothing until it is true again", "Switched on again in DSH's profile"); check both rows in the e2e.

**Nit**

4. **A link whose address holds parentheses leaves a ")" behind.** "@everyone see [the notes](javascript:alert(1))." shows "@everyone see the notes)." on the card and in the webhook note (picture 27), and a Wikipedia link (`…/Cache_(computing))`) does the same. Where: `plainLinks`, `lib/cards.js` line 46, whose `\([^)\s]{0,1000}\)` stops at the first ")". Fix: allow one level of balanced parentheses in the address.
5. **"Leave it empty to keep the one you have." shows when there is none** ("No address yet", pictures 02 and 06). Where: the webhook field's hint, `lib/client.js` line 1194. Fix: add that sentence only while an address is set.
6. **The empty state names kinds that are switched off.** With approvals off the header says they are not listed, and "Nothing waits on you" below still lists "a tool that needs approval" (picture 18). Where: `nothingText`, `lib/client.js` line 1139. Fix: build its list from `sources`.
7. **A test's success line outstays its news:** "Test message sent to 127.0.0.1:47812." was still under the button 6 minutes later, after Session Watch went off and on (picture 10). A failure's line is replaced by the next card's news; let a success go after a minute, or when the page comes back.
8. **Long waits read in hours.** `spanText` (`lib/client.js` lines 458 to 467) gives "50.2 hours" for two days, and `windowHours` allows 720. Say days past 48 hours.
9. **Two doc comments stack above `sourcesText`** (`lib/client.js` lines 1250 and 1251); the first is left over.

**Not counted**

- **The gateway.** Real-model turns took many minutes and one harness wait timed out at 600 s; the turns finished later and were answered.
- **No focus ring after a focus set by script** (picture 36). DSH hides rings in pointer mode; a real Tab sweep showed a 2 px ring on all nine stops (picture 37).
- **The real model's own wording** in its cards (its reason for full access, its long question) is the model's; Decisions showed it whole.

## Round 4's findings

1. **A thread's decision announced and mirrored twice while its chat was busy: fixed (by the e2e, not live).** On all three builds the e2e holds a chat in a turn while its thread hands back: "the thread's question is the thread's card from its first sight, named for its chat, while the chat is busy", "the handback the chat took late is the same card … one card, the same id, the same wait", "it was announced once". README lines 36 to 47 say the same. I did not run real threads this round.
2. **A waiting reply card lost its lines and pick after a restart: fixed.** Branch name kept the reply's four lines and *Recommended: release/v2.0* through a forced restart without its session being opened (read from `state` after the restart), and the e2e has the step.
3. **A pick cut mid-word: fixed.** "I would recommend **release/v2.0** because the prefix is the convention." gives *Recommended: release/v2.0* (picture 20); the real model's long pick shows whole (picture 31); a long pick without a bold span ends at a clause break ("keeping the current in-process cache for now", in a run of the code).
4. **A number in quotes could not be fixed in the form: fixed.** Flagged in Decisions' form with what to type, fixed with one *Save*, logged "Settings fixed" (pictures 01 to 05); Session Watch's `"600"` the same, now with a button on Decisions' page. The e2e starts with both.
5. **"— recommend X" without the colon: fixed.** `dashedPick` (`lib/cards.js` line 194) reads round 4's exact line ("… It was declined at the prompt — recommend approving the exact one-shot command.") into the question and the pick; the README documents both forms.
6. **The README and #32 named an e2e start that was not there: fixed.** The e2e starts with `"72"` and `"600"`.
7. **"Not installed" or "not running": fixed.** One wording, "the Notifications plugin is not running: it is not installed. Add it in Plugins …" (`lib/client.js` line 1261).
8. **Profile edits that restart Decisions left no line: partly fixed.** They are logged now ("Settings changed in DSH's profile: “Also send new cards to”, “The command”", picture 40), and a profile-only setting's line says DSH applies the file when saved; but a switch-off reads "started again" (finding 3).
9. **A missing mirror program did not say where to change it: fixed.** The line now ends "change mirrorCommand in Decisions' entry in DSH's profile (cordis.patch.yml)" (`lib/mirror.js` line 51).
10. **Console 404s while Session Watch is off: fixed.** One round of four at the moment of the switch, none after while it stayed off; the e2e watches 12 s of it.
11. **A failed *Send a test* said why outside the header: fixed.** Under the button, inside the header (picture 35), with the focus kept on the button (e2e).
- Outside the list, **Session Watch's wrong value had no button: fixed** (*Open Session Watch's settings*, picture 05).

## DESIGN.md "Before you push", for what I checked this round

- [x] Surfaces: glass cards on its own page (pictures 05, 11, 30); its settings are DSH's own form in Plugins (02, 06, 07).
- [x] Both themes (13 and 14, 31 and 32) and a narrow window (15 and 16) with nothing spilling sideways.
- [x] Keyboard: every stop of a Tab sweep shows the 2 px ring (37).
- [x] Off leaves nothing behind (38), and on again repeats nothing (39).
- [x] `node --check` passes on the client, and `npm test` passes (851, none failing).
- [x] Both DSH versions and the installed app (the e2e on three builds).
- Not checked this round: the token list against both builds, motion under `wp-still` and reduced motion, Wallpaper on and off.
- Outside the list: §9's "states say what to do next" misses where an empty state names a kind that is off (nit 6).

## What would make it a 9.5

- **The question a person reads is the one the session asked.** A plain question keeps its words when a file name, a version, a URL, a decimal or "e.g." sits in it: on the card, in its notes, and in the quote sent back with the answer.
- **Identifiers kept whole.** Code spans keep `__init__.py`, `my__var` and `a**b`, in the question, the lines before it and the pick.
- **Off said as off.** A switch-off in the profile logged as one, and a switch-on as one.
- **Tests in a coding model's shapes.** Questions that name files, versions and URLs, code spans with dunders, an e2e step with one of them, and the off line checked for its words.
- **Small words:** a link's ")" gone, the webhook hint only with an address, an empty state that lists only what is on, a test's success line that leaves, waits in days.

## Live DSH fingerprint (before and after)

- Before (10:30 AM PDT, `dsh-test fingerprint`): pid 43210, started Mon Oct 26 07:14:47 2026, `cordis.patch.yml` sha256 `f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55`.
- At the resume (1:44 PM PDT): the same.
- After (1:56 PM PDT, with my driver, scripted model and stand-in webhook stopped by their own pids, after `dsh-test --name g95-decisions-j1 destroy` and the slot given back): pid 43210, started Mon Oct 26 07:14:47 2026, `cordis.patch.yml` sha256 `f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55`. Unchanged.
- No `~/.dsh-test-g95-decisions-j1*` folder and no process of mine is left; port 47812 is free; no other instance was touched.
- The e2e runs checked it before and after too: unchanged.
- Nothing was loaded into, restarted in or edited in the live DSH; my only copy of its profile stayed in my own scratch folder.
