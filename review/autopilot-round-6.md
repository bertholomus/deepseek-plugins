# Autopilot: judge round 6

Commit 0d9b123 (branch goal95/autopilot), judged Mon Oct 26 2026, 8:59 PM to Tue Oct 27, 12:06 AM PDT. The account's usage limit stopped me from 9:01 to 11:37 PM; nothing of mine was running then. DSH Test instance g95-autopilot-j3 (installed app, DSH 0.2.1-rc.3). GLM-5.3-Flash-EXL3 was requested, but the gateway answered with another model (see the environment notes), so after one turn I used the suite's scripted model. Session Watch 1.0.1 was loaded first, as Autopilot needs it. GOAL95 PASS 2 bar: PASS at 9.5 or more, with no criterion below 9. I formed my view before I read round 5's scorecard, and checked its findings at the end.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9 | Live, it did every job in its brief section, including the power-blip case round 5 found (a cut-off session with no todos whose carry-on fails is retried, then *gave up*). But the hold (the rule that holds the nudge while a reply waits on you) missed 9 of 20 fresh replies that do wait on you ("Ready to ship once you sign off.", "Over to you for the review.", "Should the retry limit be 3 or 5? I've left it at 3 for now."). So a "carry on" note can talk over a pending question or sign-off. |
| Reliability | 9.5 | Each of the 18 notes it had marked *delivered* when I checked is in its session's own log, in the turn it named (matched by message id). No trigger was acted on twice (19 keys) across two forced restarts, the switch, a settings fix and a limit change. An error never spent a goal round. A question open across a forced quit came back under its own entry. A wrong setting stopped all work with clear words, and saving the fix started it again. |
| UX / polish | 9.5 | Glass cards and DSH's tokens and form, light and dark, nothing spilling at 760 px. Every state says why and what next: *gave up* with Try again; *Waits for you* quoting the offer; a failed row with nothing open says it is yours; a refusal shows in the row you pressed; the cursor lands in the setting to fix and moves on after an answer. Only nits: the *Held back* Why gives the limit as the count, and an arrow key may be lost while the list redraws (Test depth). |
| Test depth | 9 | 860 suite tests (856 pass, 0 fail, 2 skipped, 2 todo) and Autopilot's own 52. A 299-ending corpus with four held-out sets. The real-DSH test's 128 checks prove claims in the sessions' own logs on three builds. But its keyboard step failed once at load 5 (0.2.1-rc.1, 123 passed and 1 failed; 128 of 128 on rerun). That step also failed in round 4 and in the builder's runs tonight. The corpus has none of the hand-over phrasings the hold misses. |
| Docs | 9.5 | Accurate against the code: every setting and range, the hold with measured rates, retries and give-up, the files and their modes, switching off, rollback (tag `autopilot-v1.0.1` exists), and the 128 checks. Nit: the hold's measured rates (3 misses in 15) read as general, and the README does not name the phrasings it misses. |

Plugin score: min(9, 9.5, mean 9.3) = 9.0. Verdict: NOT YET (no criterion is below 9, but the score is under 9.5).

## Environment notes (not scored)

- **The model.** At 11:39 PM I sent one real-model turn ("Reply with the single word PONG", Workspace Write, a throwaway folder). The bridge said `used: GLM-5.3-Flash-EXL3`, and it completed in 14 s. The session's own log names `responseModel` DeepSeek-V4.1-Flash-1017 twice. As the rules say, I sent no more real-model turns. From 11:41 PM my instance ran on the suite's scripted model (`test/e2e/fake-model.mjs`, started from my build on a loopback port, its key a harmless environment variable). I made it the instance's default, so Autopilot's own notes could not reach the gateway either. No request left the Mac after the first turn.
- **The usage limit** stopped me at 9:01 PM, after `npm test` had started and before any instance was up. The slot reaper freed my two slots while I was stopped; I took two again at 11:38 PM.
- **DSH Test's restart** took the forced path both times (SIGTERM, then a kill of 5 leftover processes about 30 s later). In the second one the old DSH fired a retry that was due (F, 11:55:08 PM) before it died, and that turn ended in its error at once. The new process did not repeat it. This is correct: DSH was still running.

## What I ran

- 8:59 PM: copied the live `cordis.patch.yml` into my scratch folder (sha256 535e6390…) and read the fingerprint. Built 0d9b123 with `git archive` into `~/Projects/goal95/judge/autopilot-r6/head`, with the `.e2e` link.
- 9:00 PM (finished during the pause): `npm test` in the build: 860 tests, 856 pass, 0 fail, 2 skipped, 2 todo (90 s). Later: `node --test test/autopilot.test.js test/autopilot-ends.test.js` (52 of 52), `node scripts/sync-shared.mjs --check` (exit 0) and `node --check lib/client.js`.
- 11:38 PM to 11:51 PM: `node scripts/e2e.mjs autopilot`: 128 of 128 on 0.2.0-rc.2 (212 s), 123 passed and 1 failed on 0.2.1-rc.1 (288 s; finding 2), 128 of 128 on the app's 0.2.1-rc.3 (209 s). It found the live fingerprint unchanged. 11:51 PM: `--dsh 0.2.1-rc.1` alone: 128 of 128 (229 s), fingerprint unchanged. Load average about 5.
- 11:38 PM: `dsh-test --name g95-autopilot-j3 up`. I loaded Session Watch, then Autopilot, from my build, with the builder's row (`idleSeconds: 90`, `errorRetrySeconds: [30, 90, 180]`, `startDelaySeconds: 10`, the rest at their defaults), restarted, and ran `doctor`: 0 import errors, isolation ok. In my instance's profile only, `defaultPreset` went from `danger-full-access` to `workspace-write` before any turn.
- 11:41 PM: the scripted model added to my instance's profile as the default, then a restart.
- 11:42 PM: five sessions through the bridge, each in its own folder:
  - A: three todos, notes get a plain reply.
  - B: three todos, each note finishes one.
  - C: todos, then a reply that ends "Let me know if you want me to continue with steps 2 and 3."
  - F: todos, then a failing turn, and every note fails too.
  - G: a goal whose first round fails.
- 11:45 to 11:49 PM:
  - A: nudged at 90 s twice, then backed off.
  - B: nudged three times, finishing a todo each time.
  - C: held, the row quoting the offer.
  - F: notes at 30, 90 and 180 s, each delivered and each turn failing, then *gave up* at once after the last.
  - G: a note first, then round 2 of 6 started, proven by the round of its own revision. The scripted round then completed the goal, and G left Open work.
- 11:46 PM: E with two todos (nudged at 11:47:28). At 11:48, a turn held open in E. 11:49:18: `dsh-test restart` under it (forced). DSH was back at 11:49:51, and Autopilot's carry-on note went at 11:50:01. It was read in turn 4 (session log), naming the cut-off turn 3, its last step, and the two todos still open.
- 11:50 PM: E set to Ask first on the page. 11:51:31: the question in *Waiting for you*, with the badge on the sidebar icon. 11:52:09: *Tell it to carry on* was delivered in turn 5, by *you*, and the cursor moved to the next row's Try again.
- 11:52 PM: `maxNudges: 0` written live in my instance's profile. The page said *waiting for a setting to be fixed*, with the range, the value and *Open Autopilot's settings*, and the log gave the new and old value. That button put the cursor in the flagged field; I typed 2 and saved: *Settings fixed: Autopilot is working again*.
- 11:53 PM, at 760 px: the switch off. Try again was refused in its own row ("Not changed. Autopilot is off: switch it on at the top of its page first."). On again, then Try again on F: a new note-first cycle, then *gave up* again at 11:58:08.
- 11:54 PM:
  - H: a long turn, no todos, no goal, every note failing (the power-blip case).
  - I: one failing turn with nothing open.
  - 11:54:38: a second forced restart under H, with E's question open. E's question was withdrawn ("DSH stopped before it was answered (a crash or a forced quit)") and asked again under its own entry at 11:55:20. H's carry-on note at 11:55:20 failed, and so did the notes at 11:55:50, 11:57:20 and 12:00:20. Then *gave up*, with Try again in *Waiting for you*.
  - I's row: "Its last turn failed with nothing left open (no todos, no goal), so Autopilot leaves it to you."
- 12:00 AM: `maxNotesPerHour: 3` written live (Autopilot's state counted 18 notes and goal starts that hour). Two new idle sessions with todos. At 12:02:03: one *Held back* entry for both, and both rows said "next: check at 12:12 AM".
- At 11:59 PM, a script of mine checked every *delivered* entry so far against its session's own log (message id and turn): 18 of 18. It also checked that no trigger key had been acted on twice (19 keys). The state folder is mode 700 and its files 600.
- The hold rule, outside DSH: I wrote 40 reply endings tonight, 20 that wait on the person and 20 that do not, and ran them through `waitsOnPerson()`: 9 misses and 1 false hold (finding 1). Round 5's nine endings all read right now.
- 12:02 AM: copied the instance's event log, stopped the scripted model, destroyed g95-autopilot-j3, gave back both slots, and read the fingerprint. No process of mine was left.

## What I saw (each picture, one line)

Pictures are in `review/autopilot-round-6/`. Each `*-window.png` is the whole window; the file of the same name without it is Autopilot's page alone.

- first-light: a minute after the sessions started. G's note *delivered*, then "Started its goal again after an error … this start begins round 2 of 6" (*started*, "Round 2 of 6 began."). F's first retry *delivered*, with the row "next: retry at 11:44 PM".
- t2: A and B nudged ("idle for 90 seconds after turn 1 with 3 open todos, and its last reply asked you nothing"), each *delivered*.
- page-light, page-dark: *Waiting for you* holds F (*gave up*) and A (*backed off*), each with Try again. C reads "Waits for you: its last reply leaves the next step to you (“Let me know if you want me to continue with steps 2 and 3.”)". E is *running*.
- e-ask-set: E's rule set to Ask first ("Rule set to Ask first. · You", "Use the default" under the control).
- ask-light: the question ("“E long turn cut by restart” stopped with 2 open todos (next: “Index the archive”). Tell it to carry on?"), with *Tell it to carry on*, *Leave it* and *Open*, a count of 1 on the sidebar icon, and the row's "Waits for your answer".
- answered: the question *answered*, the note by *You* ("You chose “Tell it to carry on”"), *delivered*.
- badcfg-light: "Autopilot is waiting for a setting to be fixed. Notes in a row without progress (maxNudges) must be a whole number from 1 to 10 (it is 0)", with the button and the log line "now 0 (was 2)".
- settings-flagged-light: DSH's own form in Plugins, the cursor in the red field ("A whole number from 1 to 10, or empty for the default (2)."). *Changed* only on values that differ from the default.
- settings-saved-light, fixed: after Save, and the page working again.
- narrow-light-top, narrow-light: 760 px. DSH's sidebar folds to icons, and the rows and controls wrap with nothing spilling (the page's scroll width equals its width).
- off-refusal-narrow-light: off: "Off: no notes, no resumes, no goal starts. Nothing it scheduled will run.", "Applies when Autopilot is on.", and the refusal in red under F's row.
- narrow-dark: 760 px dark, with E's next question (after turn 5) and F *failed* with "next: retry at 11:55 PM".
- blip-light: H, "Turn 2 failed (…) while it carried on after DSH stopped under turn 1, so the work that stop cut off is still open" (*delivered*), "next: retry at 11:57 PM". I, failed with nothing left open, says so.
- final-log-light-window, final-log-dark-window: the log. *Held back* ("Autopilot already sent 3 notes in the last hour …", nit 3), the limit change, H's give-up and the three tries before it, F's give-up.
- final-sessions-light-window, final-sessions-dark-window, final-light, final-dark: every row at the end (J *held back*, "next: check at 12:12 AM").

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

No blockers and no majors.

### Minor

1. **The hold misses many replies that wait on you, so a nudge can talk over a question or a sign-off.**
   - Where: `plugins/autopilot/lib/ends.js` (`HANDS_OVER`, `handOverIn`), and the suite's `asksForAnswer` (`lib/shared/words.js` line 238). That rule counts a question only when the last line ends with "?", or when the tail says "should I", "do you want" and the like.
   - What: I wrote 20 replies that wait on the person and 20 that do not, and ran them through `waitsOnPerson()`.
     - 9 of the 20 that wait were missed:
       - "Ready to ship once you sign off."
       - "All set on my side. Over to you for the review."
       - "Should the retry limit be 3 or 5? I've left it at 3 for now."
       - "Do you have the credentials for the analytics account? I couldn't find them in the vault."
       - "The tests need a real Stripe test key; please add STRIPE_TEST_KEY to .env and I'll rerun them."
       - "This needs a decision from you on the naming before I can continue."
       - "Go ahead and merge when you're happy with it; I won't touch the branch until then."
       - "The deploy key is missing from the CI secrets, so I can't push the release until it's added."
       - "I stopped before touching the billing module since it's outside the scope you gave me."
     - 1 of the 20 that do not wait was held: "I updated the README; let me know if anything reads oddly." ("reads oddly" is not in `COURTESY`).
     - The README's measured rate (3 misses in 15) holds for the corpus. The corpus has none of these phrasings ("over to you", "sign off", "please add", a "Should …?" or "Do you have …?" question followed by a sentence).
     - A missed session gets "[Autopilot] … Carry on with the next one, or mark the ones that are done. If something blocks you, end your reply with one line: DECISION NEEDED …" after the quiet time. Often that turns the question into a Decisions card. But on a sign-off hand-over it tells an agent that is waiting for approval to carry on, and the owner sees a note answering a question they had not answered yet.
   - Fix:
     - Count a question sentence in the last line as an ask even when a short sentence follows it ("Should …? I've left it at 3 for now."), unless it is inside code or quotes.
     - Add the hand-over forms above: "over to you", "once/when you sign off", "please add/provide/set … and I'll …", "needs a decision/input from you", "until it's added", "ready … when you are".
     - Measure again on a held-out set written by someone other than the builder.
     - As a safety net for any miss, add one line to the nudge: "If your last reply was waiting on the user (an answer, a review, a sign-off), do not go ahead: end with DECISION NEEDED."

2. **The real-DSH test's keyboard step is still flaky.**
   - Where: `plugins/autopilot/test/e2e/run.mjs` lines 563 to 567, in the step "the page's buttons", and the rule control in `lib/client.js`.
   - What:
     - On 0.2.1-rc.1, at load about 5, "Enter applies it, and focus stays on the rule" passed. The next ArrowRight never showed "Press Enter to apply Off." within 5 s, so the step failed (123 passed, 1 failed, 4 not reached).
     - The failure picture (`.e2e/shots/autopilot/0.2.1-rc.1/failed-buttons.png`) shows Ask first applied on that row, and the row reads "told it to carry on with its todos (just now)". A note had just gone to that session, so the list was redrawing as the key was pressed.
     - It passed 128 of 128 on rerun. The builder's first run of 0.2.0-rc.2 tonight also failed in this step (its 45 s wait for the list to move ran out), and round 4 recorded a flake here too.
     - Either the test presses a key during a redraw, or a keyboard user's key press can be lost when a row moves.
   - Fix:
     - In the client, keep the focused rule tab stable across a redraw: restore focus in the same frame, keyed by session and rule, or take arrow keys on the tablist container.
     - In the test, keep that session from getting a note during the step (its own high quiet time, or give it its rule before its note), and wait until focus is on the tab before pressing the key.

### Nits

3. The *Held back* Why gives the limit as the count. After I lowered `maxNotesPerHour` to 3 with 18 notes already sent that hour, it read "Autopilot already sent 3 notes in the last hour". Where: `lib/notes.js` `whyHeld(limit)`. Fix: pass the real count ("sent 18 notes in the last hour; the limit is 3").
4. The README's hold section gives the held-out rates without the phrasings the rule misses. Fix: name them (a question followed by a sentence, "over to you", "once you sign off"), or update the numbers once finding 1 is fixed.

Not checked live: Decisions and Notifications were not loaded, so the questions' second home and the notifications come from the README, the code and the unit tests only. Nothing reached a real model after the first turn (environment notes).

### DESIGN.md "Before you push", ticked for Autopilot's page and its settings form

- [x] Surfaces: glass cards on its own page; its settings are DSH's own form in Plugins (settings-flagged-light).
- [x] Tokens: only DSH `--dsw-*` tokens and, from Wallpaper, only `--wp-blur`, `--wp-tint` and `body.wp-still`. I did not look up each token in both builds. The e2e's contrast checks read the real colours on all three builds and pass: state words 5.78:1 or more in light and 8.68:1 or more in dark; at tint .2 the tags read 6.25:1 light and 10.75:1 dark, now asserted.
- [x] No DSH hash selector, nothing styled on `:root` or `html`, and no `:has()`. `body:not([data-ds-dark-theme])` and `body.wp-still` only scope its own classes.
- [x] Motion stops under `wp-still` and reduced motion; the glass thickens under reduced transparency.
- [x] `node --check` passes on the client, and `npm test` passes, naming scan included.
- [x] Both DSH versions (the e2e on three builds) and both themes (my pictures). Wallpaper was off in my instance and on only through the e2e's stand-in.
- [x] Off leaves nothing behind and on again repeats nothing. The switch: no trigger repeated (19 keys). Session Watch off and on in Plugins: the e2e, on all three builds, with no error from DSH.

## Round 5 findings (read after I formed my view)

1. A failed carry-on turn without todos or a goal was never tried again, and its row said only *failed*: **fixed**. Live, H (no todos, no goal) cut off by a forced restart got its carry-on note and three note-first tries on `errorRetrySeconds`, each Why saying the cut-off work is still open, then *gave up* with Try again. I (a failed turn with nothing open) says on its row that it is yours. A unit test and an e2e step cover it.
2. An offer in the last six lines held the nudge: **fixed** for what round 5 reported. The four false holds now get the nudge; an offer that hands over is held with its words on the row (live, C); the README describes the rule; and a 299-ending corpus measures it. The rule's misses are a new finding (finding 1).
3. "Connection error..": **fixed**. `errorWords()` trims the closing period; the notes read "failed: 400: E2E: the scripted model refused this request. Carry on …".
4. "open … still open": **fixed** ("with 2 todos still open (next: “Migrate the config”)").
5. A re-asked card's Why differing from its log entry: **fixed** in the code (the card keeps `askWhy`), and the e2e asks a question again across a quit. Live, E's question came back under its first entry after the forced quit.
6. *Changed* on default values, and two reset styles: **fixed** as far as I saw. *Changed* shows only on 90, 0 and "30, 90, 180", and there is one plain "Use the default" beside the chip.
7. The tags under 4.5:1 at tint .2: **fixed** (6.25:1 light and 10.75:1 dark, asserted).
8. A note a kill left in the queue stays *not proven*: **fixed** in the code (`follow`, `readQueued`) and a unit test. Not caught live.
9. "10 seconds after DSH starts" after a settings fix: **fixed** in the code ("after the setting was fixed"). Not seen live, because no row was waiting at that moment.

## What would make it a 9.5

- A hold that also catches the hand-overs above, measured on a held-out set written by someone else, with a nudge line that tells an agent waiting for approval not to go ahead (finding 1).
- A keyboard step that cannot race a redraw, in the client or the test (finding 2), then several clean e2e runs on every build.
- The *Held back* count (nit 3) and the README's list of what the hold misses (nit 4).

## Live DSH fingerprint (before and after)

- Before (8:59 PM PDT): pid 64099, started Mon Oct 26 15:35:11 2026, `cordis.patch.yml` sha256 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be. I kept a private copy of the file in my scratch folder.
- At resume (11:38 PM): the same pid, start time and sha256. The e2e found it unchanged before and after both its runs (11:38 to 11:51 PM, and 11:51 to 11:55 PM).
- After (12:02:59 AM PDT, Tue Oct 27, and again at 12:06 AM): pid 64099, started Mon Oct 26 15:35:11 2026, sha256 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be: unchanged. The 7:28 PM move of the live default-model row came before my start, so my copy already had it, and nothing moved during my work.
- I touched only my own instance (destroyed at 12:02 AM), my e2e runs' throwaway homes and my scratch folder, and left the orphaned DSH (pid 97773) and the other agents' processes alone.
