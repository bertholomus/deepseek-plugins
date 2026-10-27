# Decisions: judge round 6

Commit 2ccbfb3 (`2ccbfb3b3651a8a64ced1c4c0771de6270cce69f`, branch `goal95/decisions`), judged Mon 2026-10-26 11:37 PM to Tue 2026-10-27 12:01 AM PDT (GOAL95 PASS 2, the plugin's last round tonight). DSH Test instance g95-decisions-j3 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 asked through the owner gateway for one turn; the gateway answered it with DeepSeek-V4.1-Flash-1017, so every later turn ran on the e2e harness's scripted model (an environment fact, not scored).

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.5 | Every job in its brief section works and is proven: a real model's DECISION NEEDED line became a card with its whole question (a file name in it), the lines before it and its pick, notified in the window, counted on the badge, its session one click away; approvals, the question box, Autopilot's Ask first and coordinator threads are answered in place on three DSH builds, each answer proven in the session's own log, and the mirror is off by default and tested only on loopback. |
| Reliability | 9.0 | Nothing I threw at the machinery broke it (two answers at once, a restart with cards waiting, a wrong value written into the profile while DSH ran, empty, oversized and malformed answers, a dead webhook and a hanging command in the e2e), but a reply that only mentions "DECISION NEEDED", or says "No decision needed" or "I do not need your input", becomes an "asked you" card with a notification and a mirror note, and a mirror command that ignores SIGTERM keeps running past its 15 s. |
| UX / polish | 9.5 | A calm DSH page in both themes and at 760 px with nothing spilling, DSH's own form for settings, every state saying what to do next with a button to the place, and a question-box question and an approval answered by keys alone; small things remain: a stray list number in a card's lines, a table's raw separator row, and buttons a screen reader cannot tell apart between cards. |
| Test depth | 9.0 | 860 repository tests with none failing (77 of Decisions', 38 of the shared reading rules) and 142 real-DSH checks on each of three builds with pictures light and dark, which held against everything I re-ran; but the claim that a marker inside a sentence "is not one" is tested only on `decisionIn`, while the whole reading (`askIn`) turns that very test sentence into a card, and notifications are proven only over a stand-in. |
| Docs | 9.5 | A complete README (what it lists, how a marker is read, the page, a settings table that matches `config.js`, three ways off, a rollback to a tag that exists, setup, tests whose commands run as written) that held wherever I checked it; it does not say that a mention of the marker's words in a reply's end makes an "asked you" card, and its marker rules are one long paragraph. |

Plugin score: min(U, R, mean) = min(9.5, 9.0, 9.3) = 9.0. Verdict: NOT YET (GOAL95's bar is 9.5 with no criterion below 9).

## What I ran

- **Build.** `git archive 2ccbfb3 | tar -x` into my own folder (`~/Projects/goal95/judge/decisions-r6/head`), `.e2e` linked to the suite's DSH installs. I wrote nothing in any worktree.
- **Unit tests.** `npm test`: 860 tests, 856 pass, 0 fail, 2 skipped, 2 todo (89 s). `node scripts/sync-shared.mjs --check` exits 0. The README's own commands: `node --test test/decisions.test.js test/decisions-client.test.js` 77 of 77, `node --test test/suite-shared.test.js` 38 of 38. `node --check` passes on the client.
- **Real-DSH e2e.** `node scripts/e2e.mjs decisions --dsh <build>` once per build, each with its own picture folder: 142 of 142 on DSH 0.2.0-rc.2 (139 s), 142 of 142 on 0.2.1-rc.1 (247 s), 142 of 142 on the installed app's 0.2.1-rc.3 (186 s); the live fingerprint unchanged before and after each. I read its 142 check lines against the README.
- **My instance.**
  - `dsh-test --name g95-decisions-j3 up`, then Session Watch, the coordinator, Notifications, Autopilot and Decisions loaded from my build in the builder's order; `doctor`: 0 import errors, isolation ok. No row for Decisions (its defaults).
  - Before any turn I set the instance's `defaultPreset` to `workspace-write` (the seed's was full access). The session's log says "DSH file policy: workspace-write" and the window shows *Workspace Write*.
  - One real-model turn (96 s): a release trade-off that had to end with a DECISION NEEDED line. Its `responseModel` in the session's log was DeepSeek-V4.1-Flash-1017, so I sent no more real-model turns, paused Autopilot in my instance (`enabled: false`) so nothing would nudge that session, and never answered its card (an answer starts a turn). The session ended with one turn.
  - On that card, with Playwright (the e2e's Chromium) on my instance's window only: the page light and dark at 1280 and 760 px, the Tab order, Dismiss and Bring back, one click on the session's name, and `mirror: slack` written into the profile while DSH ran (an action tried meanwhile), then the file put back.
- **My own real-DSH runs** (scripted model, throwaway homes, DSH 0.2.1-rc.1, the fingerprint read before and after each; scripts in my judge folder):
  - Six sessions whose replies I chose: "No decision needed — …", the marker rule quoted inline in code, a plain "Done.", a DECISION NEEDED line with `config.v2.yaml`, two numbered questions, and a Markdown table before a question. Then two answers to one card at once, *Go with the recommendation*, four bad answers, and a restart with cards waiting.
  - Keys only: a question-box question and an approval, answered from the page with Tab, Space and Enter.
- **Probes of the reading rules** (the head's own `askIn` and `replyCard`, about 45 reply shapes: round 5's nine dotted questions, identifiers in code spans, offers, negations, markers in and out of code, CRLF, a 900-character question), and of the mirror's command timeout with a program that ignores SIGTERM (I stopped it by its pid afterwards).
- **How often models write these shapes:** 254 DSH Test session logs on this Mac (read-only, counts only), 413 replies with text: 8 had a real marker, none mentioned the marker's words in its last six lines without one; "no DECISION NEEDED needed" showed up twice, both times in a model's reasoning.
- **Not checked:** approvals, the question box and threads with the real model (the gateway's routing; the e2e covers them on three builds, and round 5 saw them live), Wallpaper on and off, a real screen reader, the hourly limit and `windowHours` ageing and a late answer to a timed question (unit tests only).

## What I saw (each picture, one line)

Pictures are in `review/decisions-round-6/`. `real-*` are my DSH Test instance with the real model's card; `judge-*` are my scripted runs; `e2e-app-*` are from my own e2e run on the installed app's DSH.

- **real-page-light / real-page-dark:** the header ("1 waiting on you", "Each new card notifies you."), the card, and *What happened* with "Notified you in the DSH window · shown"; badge 1 on the sidebar entry.
- **real-card-light / real-card-dark:** "needs a decision", the session's name as a link, "waiting 2 minutes", the question with `tests/test_sync.py` whole, the reply's paragraph before it (cut at its start with "…"), *Recommended*, a one-line answer box, *Send* resting until there are words, *Go with the recommendation*.
- **real-narrow-light / real-narrow-dark:** 760 px: the page reflows, 0 px spill.
- **real-empty-after-dismiss-light:** dismissed: "Dismissed. It stays under Dismissed if you want it back.", the empty state naming what would show, *Dismissed (1)*.
- **real-dismissed-light:** *Dismissed (1)* unfolded, with *Bring back*.
- **real-open-session-light:** one click on the card's session name opened the session, its DECISION NEEDED line at the end, *Workspace Write* in the composer.
- **real-bad-setting-light / real-bad-setting-dark:** `mirror: slack` written into the profile: "Decisions is waiting for a setting to be fixed.", the setting, what it must be, the value, *Open Decisions' settings*; the log row "waiting on a setting"; no badge.
- **real-after-fix-light:** the file put back: the card back by itself, "Settings fixed: Decisions is working again".
- **judge-false-cards-light / judge-false-cards-dark:** "No decision needed — I kept the old API as planned." and the quoted rule listed as "asked you", the latter with *Recommended: <pick> when I need you*; the dotted decision whole; "2." left at the end of a numbered question's lines; a table's header and separator as the two lines shown.
- **judge-question-approval-light / judge-question-approval-dark:** a question-box question (a fieldset with its header, two radios, an own-answer field) above an approval (the file, the reason, *More about the call*, *Allow once*, *Reject*).
- **judge-after-keys-light:** both answered by keys alone: "Your answer reached “Notes writer”." with the focus on it, "Answered: staging · answered" and "Allowed once · answered".
- **e2e-app-decisions-light / e2e-app-decisions-dark:** the page from its top with many kinds waiting.
- **e2e-app-waiting-light / e2e-app-waiting-dark:** the whole list: blocked, asked you, a numbered list folded after two lines, a decision with its pick, a question with versions in it.
- **e2e-app-approval-light / e2e-app-approval-dark:** an approval arriving on the open page.
- **e2e-app-history-dark:** *What happened* with answers *delivered* and "What it sent" folded, `__init__.py` whole.
- **e2e-app-narrow-light:** the e2e's 760 px picture.
- **e2e-app-settings-light / e2e-app-settings-dark:** Decisions' settings in DSH's own form in Plugins.
- **e2e-app-setting-quoted-light:** `"72"` in quotes flagged with what to type; the webhook field's hint without "leave it empty" when no address is set.
- **e2e-app-mirror-failed-light:** the header's line for a webhook that answered 500: "The last new card was not sent: … answered 500 (just now)."
- **e2e-app-mirror-test-failed-light:** a failed *Send a test* said under its button inside the header.
- **e2e-app-watch-off-light / e2e-app-watch-off-dark:** "Decisions needs Session Watch, which is not running." with *Open Session Watch in Plugins* and *Check again*.
- **e2e-app-disabled-light:** `enabled: false`: the header says it is off and how to change it; the newest row "Switched off in DSH's profile (enabled: false) · paused".
- **e2e-app-after-off-on-light:** after a restart and Decisions off and on: three cards waiting, "New cards cannot go elsewhere: No webhook address is set yet …" with a button to the settings.

## Findings (most severe first)

**Minor (the top finding)**

1. **A reply that only mentions the marker's words, or says no one is needed, becomes an "asked you" card, with a notification and a mirror note.**
   - Where: the `ASKS` list in `shared/host/words.js` lines 357 to 362 (copied into `plugins/session-watch/lib/shared/words.js` and `plugins/decisions/lib/shared/words.js`). `/\bDECISION NEEDED\b/i` and `/\b(?:your call|your decision|need your|needs your|…)\b/i` match anywhere in the reply's last six lines, in any case, inside a code span and after "no" or "not". `asksForAnswer` then says the reply waits on the person, and `askIn`'s fallback (line 311) takes that line as the question. `decisionIn` reads a marker strictly, so "a marker inside a sentence is not one" holds for the decision kind, but the reply is still a card.
   - What, in real DSH (my scripted run, picture judge-false-cards-light):
     - "Merged the branch and tagged v1.4. / No decision needed — I kept the old API as planned." is a card headed "No decision needed — I kept the old API as planned."
     - "Per AGENTS.md I end with \`DECISION NEEDED: <question> — recommend: <pick>\` when I need you. / All done for now." is a card with that sentence and *Recommended: <pick> when I need you*; *Go with the recommendation* would send "go with your recommendation (<pick> when I need you)".
     - The same reading also lists "No DECISION NEEDED: everything is done.", "Done. Nothing needs your decision; I followed the plan.", "Everything is merged. I do not need your input on anything else today.", "… your call if you want it changed later, but it works now.", "The old one never printed DECISION NEEDED lines, so nothing reached you." and the shared test's own sentence "Write \`DECISION NEEDED: <question>\` at the end of a reply.". A template quoted on a line of its own in code ("\`DECISION NEEDED: <question> — recommend: <pick>\`") makes a decision card "<question>" with the pick "<pick>".
     - Each such card notifies and goes to the mirror. Autopilot reads the same ask, so it also takes such a session as waiting on a person.
   - How often: none in the 413 replies I counted, but the words are live in this stack (models' reasoning says "no DECISION NEEDED needed"), and sessions that work on the suite's own markers (Autopilot, Decisions, the owner's signal hook) name them in their replies.
   - Fix:
     - Count only a real marker in the fallback: give `DECISION NEEDED` the form the BLOCKED pattern already has (a line's start or a sentence's end, then a colon), or drop it from `ASKS` (a real marker never reaches the fallback).
     - Read the tail with code spans held, as `decisionIn` does.
     - Skip a request phrase that is negated ("no", "not", "nothing", "never", "don't", "do not" before it).
     - Take a question that is only a placeholder ("<question>") as none.
     - Test each shape above through `askIn` and through a card (`test/decisions.test.js`), next to the `decisionIn` assertion at `test/suite-shared.test.js` line 224, and say in the README that such a reply asks nothing.

**Minor**

2. **A mirror command that ignores SIGTERM keeps running after its 15 seconds.**
   - Where: `Mirror.run`, `plugins/decisions/lib/mirror.js` line 329: one `child.kill('SIGTERM')`, no SIGKILL after it, and only the direct child (a shell's own children get nothing).
   - What: `[/bin/sh, -c, "trap '' TERM; sleep 40"]` was logged "sh did not finish within 15 seconds", and the program was still running afterwards (I stopped my own by its pid). A program that hangs this way leaves one process behind for each new card. The README says "It has 15 seconds."
   - Fix: spawn it `detached` in its own process group, send SIGTERM to the group (`process.kill(-child.pid)`), then SIGKILL after about 2 seconds if it has not closed; test it with a program that traps SIGTERM.

**Nit**

3. **A numbered question leaves its list number behind.** "1. Should I keep the old API? / 2. Should I remove the flag?" gives the question "Should I remove the flag?" with the lines "1. Should I keep the old API?" and a lone "2." (judge-false-cards-light). Where: `contextOf`, `plugins/decisions/lib/cards.js` lines 139 to 140, which drops only a marker before the question. Fix: drop a lone list number or bullet there too.
4. **A table before a question shows raw, and the fold hides its rows.** The two lines shown are "| Option | Speed |" and "|---|---|"; the rows sit behind *Show 2 more lines of the reply*. Where: `plainLine` and `contextOf` (`lib/cards.js`), `ReplyBefore` (`lib/client.js` line 1494). Fix: drop a table's separator row and read each row as words ("A: fast"), or fold after the first row of data.
5. **A card's buttons are not named for their card.** Moving by buttons, a screen reader hears "Dismiss", "Send" and "Go with the recommendation" for every card, and the list items have no name (the accessibility tree in my run). Where: `lib/client.js` lines 1450, 1451 and 1549. Fix: name each list item by its question (`aria-labelledby`), or label the buttons ("Dismiss: Rename").
6. **The README's marker rules are one paragraph of about forty lines** ("How a marker is read"). Everything in it held, but a rule is hard to find. Fix: a short list, one rule per line, with the examples.

## What would make it a 9.5

- **A card only when the reply asks.** A mention of "DECISION NEEDED", "your decision" or "need your" that is negated, quoted or in code makes no card, no notification and no mirror note; a placeholder is not a question; tests go through `askIn` and a card, not only `decisionIn`.
- **A command mirror stopped for sure** at its time, with its own children.
- **Small words:** no stray list number in a card's lines, tables read as words, buttons a screen reader can tell apart, the marker rules as a list.

## Round 5's findings

1. **A question with a dot before its question mark showed only the words after the dot: fixed.** All nine of round 5's shapes read whole through the head's own `askIn` and `replyCard` ("Should I fix the bug in parser.py first?", "Which do you want to release: v1.2 or v1.3?", "2.0.0", "https://staging.example.com", "e.g.", "2.5 minutes", "config.yaml"); the real model's `tests/test_sync.py` stayed whole on the card and in the log; the e2e has the step on three builds.
2. **Bold and code marks dropped inside code spans: fixed.** `__init__.py`, `__pycache__`, `my__var` and `a**b` stay whole in the question, the pick and the lines; the e2e sends `__init__.py` whole through *Go with the recommendation* (e2e-app-history-dark).
3. **A switch-off in the profile logged as "started again": fixed.** "Switched off in DSH's profile (enabled: false)" with *paused* (e2e-app-disabled-light), and the e2e checks "Switched on again" too.
4. **A link's ")" left behind: fixed.** "@everyone see [the notes](javascript:alert(1))." reads "@everyone see the notes.".
5. **"Leave it empty to keep the one you have." with no address: fixed.** The kit's `setHint` shows it only while an address is set (e2e-app-setting-quoted-light).
6. **The empty state naming kinds that are off: fixed.** `nothingText` is built from `sources`.
7. **A test's success line outstaying its news: fixed.** It leaves after a minute (`SENT_SAID_MS`), and the e2e checks that the older test line is gone.
8. **Long waits in hours: fixed.** From two days on, in days.
9. **Two stacked doc comments: fixed.** One comment above `sourcesText`.

## DESIGN.md "Before you push", for what I checked

- [x] Surfaces: glass cards on its own page; its settings are DSH's own form in Plugins.
- [x] `node --check` passes on the client; `npm test` passes (860, none failing; it includes the naming scan).
- [x] Both DSH versions and the installed app (the e2e on three builds), both themes (real-page, real-card, judge-* and e2e-app-* pictures), a narrow window with 0 px spill.
- [x] Motion: the kit's sheet has `prefers-reduced-motion` and `wp-still` rules (read in the code, not watched).
- [x] Off leaves nothing behind and on again repeats nothing (the e2e's off-and-on step, the coordinator's sheet kept).
- [ ] Wallpaper on and off: not checked.
- Outside the list: keys alone answer a question-box question and an approval; the focus moves to the line that says what the answer did.

## Live DSH fingerprint (before and after)

- Before (11:37 PM PDT, `dsh-test fingerprint`): pid 64099, started Mon Oct 26 15:35:11 2026, `cordis.patch.yml` sha256 `535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be`. My private copy of the profile (in my judge folder only) has the same sha. The earlier move to this sha (7:28 PM, the agent default model row, someone else's) came before my run.
- The e2e checked it before and after each of its three builds (11:38 to 11:48 PM): unchanged. My two scripted runs (11:50 and 11:56 PM) did the same: unchanged.
- After (11:57 PM, with `dsh-test --name g95-decisions-j3 destroy` done and both of my slots given back) and again when this scorecard was written (12:01 AM): pid 64099, started Mon Oct 26 15:35:11 2026, sha256 `535e6390…655be`. Unchanged; the sha never moved during my run.
- No `~/.dsh-test-g95-decisions-j3*` folder, no throwaway home of mine and no process of mine is left. I did not touch the orphaned DSH (pid 97773) or any other instance, and nothing was loaded into, restarted in or edited in the live DSH.
