# Fleet: judge round 2

Commit e69263d (branch `goal95/fleet`; its code equals 6230506, only `HANDOFF.md` differs), judged Mon Oct 26 to Tue Oct 27 2026, 11:42 PM to 12:15 AM PDT. DSH Test instance g95-fleet-j3 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 requested; the owner gateway answered with DeepSeek-V4.1-Flash-1017, so after one real turn the judge used the e2e harness's scripted model (start F) instead (an environment fact, not scored). Fleet ran with the stable Wallpaper (29329f7) in replay on the builder's capture `models-live-20261025` with the People ledger summary added; `avatars`, `alerts` and `plugs` off, `whoSeconds` 0, its own `dataDir`.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.0 | Every job in the README works on the captures, and the round-1 honesty fixes hold, but the lane card claims "its copy on tank" from a catalog note that Fleet's own tank scan contradicts, and the Tank rules miss that served model. |
| Reliability | 9.5 | Hands-off is enforced on the host, replay reaches no machine, eight wrong config values were named and survived a live reload, a power cycle survives a restart, and a restart under a benchmark stopped it cleanly. |
| UX / polish | 9.5 | Glass, DSH's Modal, Toast, Menu and RiskConfirmation, light and dark, 760 px and keyboard rings all hold. Measured on real pixels (dark over the light picture, light at a low tint), no text is under 4.5:1. Nits: replay wording, dots with no words, heading levels. |
| Test depth | 9.0 | 22 unit files and 138 real-DSH checks on three builds prove most claims, restarts included. No check compares the lane card's tank claim with the scan, though the fixture holds that case. The contrast check assumes a white or black ground. |
| Docs | 9.5 | The README matches the code: config table, test-DSH row keyed by id, replay format, switch off, rollback and the six starts. Nit: HANDOFF's "How to run them" lists the row's keys without the `fleet:` key the README shows. |

Plugin score: min(9.0, 9.5, 9.3) = 9.0. Verdict: NOT YET (the bar is 9.5 with no criterion below 9).

## What I ran

### Reading
- RULES.md (PASS 2 first), JUDGE-GOAL95.md, JUDGE.md and my ASSIGNMENT, all of each.
- The builder's pass-2 hand-over block in `status/fleet.md`. I checked its claims and did not weigh its score estimates.
- DESIGN.md (the rules on one page, text on glass, motion, words and keyboard, checking the look, "Before you push").
- The Fleet README in full (386 lines) and HANDOFF.md's run section.
- Code: `lib/power.js` in full; in `lib/impl.js` the ssh wrapper, replay and hands-off gates, routes, benchmark start, Run check, the usage, recent and harmony reads, and `tankView`; `lib/config.js`; and the parts of `lib/client.js` behind each finding.
- `test/e2e/run.mjs` (starts A to F: the checks, the contrast and "on the wall" helpers, the scripted model of F).
- The round-1 scorecard, after I had formed my own view (status of each finding below).

### The head
- `git archive e69263d | tar -x` into `~/Projects/goal95/judge/fleet-r2/head`, with `.e2e` linked. I never judged a worktree.
- The stable Wallpaper came from `git archive 29329f7 plugins/wallpaper` into my folder, as the hand-over says.

### Unit tests
- `npm test` in `plugins/fleet` at 11:43 PM: 22 passed, 0 failed (31 s), including `power.test.mjs`, `plug_meters.test.mjs` (5.9 s), the syntax checks and the naming scan.

### Real-DSH tests
- `FLEET_E2E_WALLPAPER=<29329f7 copy> E2E_SHOTS=<my folder> npm run e2e`, 11:44 to 11:55 PM PDT, on my own slot, with about 13 other heavy runs on the Mac:
  - 0.2.0-rc.2: 138 of 138 (254 s);
  - 0.2.1-rc.1: 138 of 138 (199 s);
  - app-0.2.1-rc.3: 138 of 138 (209 s).
- Every build passed "no ssh command ran on any machine in A to D and F". The live DSH was unchanged across the run.
- I read what the checks prove:
  - D: an empty Fleet claims nothing it did not read.
  - E: Power cycle through DSH's RiskConfirmation, then a restart mid-watch that ends "done" without running the script again.
  - F: the lane chip, the running chat on its lane card, and the right panel's Fleet tab, with a scripted model.
  - A, C and D: contrast with data over the wall, "no text on the wall", and config problems named and dropped live.

### My instance (g95-fleet-j3)
- Setup: `up`, then load Wallpaper and Fleet with my rows, `restart` and `doctor` (isolation ok). The access preset was set to Workspace Write before any turn.
- **A setup error of mine, and what it caused.** My first `--config` file was a flat map. For a plugin with two rows (`fleet`, `preset-fleet-fix`), dsh-test applies only a map keyed by row id, and it ignored mine without a word. Fleet's README shows the keyed form; I missed it.
  - From 11:46:31 to 11:47:33 PM (about 60 s) Fleet ran with its live defaults in my test DSH. It made read-only reads of the real fleet:
    - the gateway ledger summary on FrankenNAS (16 keys);
    - node probes and a disk scan of the Ascents;
    - one plug-meter read, which failed ("FrankenNAS did not answer over SSH").
  - It started no action: no power cycle, fix, check or benchmark.
  - It opened no finding and sent no alert. The DSH Test credentials hold no Discord token, and `alerts` in `findings.json` was empty.
  - I stopped the instance as soon as I saw `config: {}` in the row. I reloaded with the row keyed `fleet:` and checked the profile before starting again.
  - Everything after that ran in replay, with "started in replay mode" in fleet.log. The instance and its home are destroyed.
- One real-model turn ("three short numbered lines", no tools), in my own workspace:
  - It completed in 18 s, in sandbox workspace-write.
  - The session's own log has `responseModel` DeepSeek-V4.1-Flash-1017 twice. I sent no more real-model turns.
- Pictures and page text of all five pages, through `test/e2e/harness.mjs` `openWindow` and `shot`:
  - 1440 px, light and dark, over the busy pictures;
  - the right panel's Fleet tab and the composer's lane chip;
  - 760 px for Fleet and Models (light and dark) and a card turned over at 760 px.
- Probes on the Fleet page:
  - Power cycle in replay: disabled, with the reason in its title.
  - Check now in replay.
  - Run check: disabled.
  - The Benchmark sheet.
  - A 22-stop keyboard sweep: a ring on every stop, all inside Fleet.
  - Unnamed controls and heading levels.
  - Screen-reader words for the state dots.
- Wrong config, live: eight wrong values put into the running row, with `replay` kept valid (`pollSeconds: "often"`, `whoMinutes: -5`, `tankHost: "-oProxyCommand=x"`, `harmonyUrl: 5`, `fixMode: "yolo"`, `execute: "yes"`, `telemetryDays: 2.5`, `bogusKey: 1`).
  - Fleet reloaded within 2 s.
  - fleet.log named each value and the default it used, and called `bogusKey` "a typo?".
  - The Fleet page showed "8 values in Fleet's config are wrong" with every line and how to fix them.
  - I then put the row back.
- A restart under a running benchmark:
  - I started a stand-in benchmark on A1–A4 through the route: 200, `standIn: true`.
  - I ran `dsh-test restart` 11 s in.
  - fleet.log: "stopped (Fleet stopped) after 11 s: Decode 90 tok/s at 1 stream, 170 at 2".
  - `bench.json` kept the two waves, marked as stopped and from the stand-in. Nothing resumed or ran again.
- Contrast measured on real pixels, against what is drawn under the text: from a screenshot I took the ground in each text box and compared it with the text's colour, on Fleet, Models and Tank.
  - Dark theme over the light picture at tint 55: 67 texts in view, none under 4.5:1.
  - Light theme at tint 25 (a low tint): 67 texts in view, none under 4.5:1. I asked for the dark picture, but the window showed the light one, so the light-over-dark case is not measured.

### Never pressed
- Power cycle OK, Swap, Load, Copy, tank fixes, Repair, Hide cloud models and Run check against anything real.
- The benchmark ran only against the replay's stand-in on this machine.

### Not checked
- Reduced transparency in a picture. I read the CSS: one rule for every Fleet root, light and dark.
- A second real-model turn (the gateway's model).
- The Load sheet's plan.
- A SIGKILL crash under a power cycle. E covers a restart; `power.js` covers the window by code.

### Cleanup
- At 12:08 AM PDT: the instance destroyed, both slots given back, and no process of mine left.

## What I saw (each picture, one line)

Pictures are in `review/fleet-round-2/`.

### Fleet page
- `fleet-light-replay-wallpaper`: the head, the replay note and the four figures ("No lane readings in the last 24 h", "Harmony was not captured in this replay"), on glass over the busy light picture.
  - The Lanes now strip A1–A4 / A5–A8 is in dark text.
  - The A5–A8 lane card says "its copy on tank" (finding 1).
- `fleet-dark-replay-wallpaper`: the same in dark, readable.
- `fleet-dark-over-light-picture-measured`: dark glass over the light picture, measured. No text is under 4.5:1.
- `fleet-760-light`, `fleet-760-dark-ascents`: at 760 px, DSH's rail and Fleet's two columns of Ascent cards, with no sideways scroll and no cut text. Power cycle is greyed, with its reason in the title.
- `fleet-eight-wrong-config-values-light`: the config note naming all eight values, above the replay note.
- `benchmark-sheet-replay-light`: DSH's Modal over the page.
  - It says runs go to a stand-in.
  - It also says "31 requests to A5–A8 through Bertnet Gateway" (finding 3).
  - It refuses with "1 request in flight on A5–A8" and names the rule.

### Models page
- `models-light`, `models-dark`, `models-light-tint25-measured`: the Library, the Cleanup column and the badges, at tint 55 and 25 (the tint-25 shot is over the light picture).
  - The GLM-5.3-Flash card says "164 GB · not found on tank · rev 078455f".
- `models-760-light`: one column at 760 px, with nothing cut.
- `models-760-card-back-light`: the GLM card turned at 760 px. The back scrolls inside the card above the turn button.

### Tank, People and Activity
- `tank-light`, `tank-dark`: the ten rules and the issues. "Serving with no copy on tank" counts 1 (DeepSeek only), not GLM-5.3-Flash (finding 1).
- `people-light`, `people-dark`: "As of Oct 24, 9:00 PM PDT" on glass. The not-counted rows are explained, and Albert's models are listed by lane.
- `activity-light`, `activity-dark`: one event, "Fleet started keeping the Activity log", and "Alerts: Off in Fleet's config".

### Chat, composer and right panel
- `right-panel-fleet-tab-and-lane-chip-light`: the right panel's Fleet tab and the composer's chip "A5–A8" for a GLM-5.3-Flash-EXL3 session.
  - The tab shows both lanes with "Answering · not tested", Run check off, Benchmark…, Swap model and the power card.
  - The chip's title: "A5–A8 · GLM-5.3-Flash-EXL3 · … · Answering · not tested" (finding 2).

### From my e2e run (app build)
- `e2e-D-fleet-empty-light`: an empty Fleet. Grey rings, "not read yet", no claims, and a note that says how to read the fleet or replay it.
- `e2e-E-power-cycle-confirm-light`: DSH's RiskConfirmation with the tick box, Cancel and a greyed OK, the boot ID and the exact command.
- `e2e-E-power-cycle-running-light`, `e2e-E-power-cycle-done-after-restart-light`: running, then "restarted" after a restart of DSH mid-watch.
- `e2e-F-lane-chip-light`: the chip on a scripted chat.
- `e2e-A-card-back-dark-760`: a long back at 760 px ends above the turn button.
- `e2e-D-gateway-bar-dark`: the gateway repair bar in DSH's composer dock.
- `e2e-C-config-note-dark`: two wrong values named, without Wallpaper.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

### Major

**1. The lane card claims a tank copy that Fleet's own scan did not find, and the Tank rules miss that served model.**
- **Where:**
  - `lib/impl.js` line 702: a lane's `served.tank` is `catalog?.tank`.
  - `lib/client.js` line 115: `servedFacts` prints "its copy on tank" whenever `s.tank` is set.
  - `lib/impl.js` lines 965–967: `tankView` builds `servedNoTank` from `!e.tank`.
  - `lib/library.js` line 335: `tank` falls back to the catalog note's path, while `tankFound` is false.
- **What:** On the captures, the A5–A8 lane card (the GLM-5.3-Flash-EXL3 lane, the owner's main model) reads "its copy on tank", with the hover "On tank: llm/banked/Mia-AiLab--GLM-5.3-Flash--EXL3-4bpw-TensorFold--078455f".
  - The saved tank scan does not hold that folder.
  - The same model's Library card says "not found on tank", and its back says "On tank: Not found on tank".
  - The Tank page's "Serving with no copy on tank" lists only DeepSeek-V4.1-Flash-1017 (count 1). So rule 8, "Anything a lane serves is banked on tank first", misses the GLM lane.
  - Fleet states a fact that its own read contradicts, on the lane the owner uses most. That is the class of GOAL95's top finding ("Fleet states facts it never read"), still open in this one place.
  - Cleanup is not at risk: it requires a verified tank copy.
- **Fix:**
  - Base "its copy on tank" and `servedNoTank` on the scan (`tankFound`).
  - Before the first tank scan, say "tank not scanned yet".
  - When a catalog note names a folder that the scan did not find, list it under the issue as "Serving, its tank folder is missing: <model> (<path>)".
  - Add a unit check and an e2e A check on `models-live-20261025`, which already holds this case: the lane card and the Tank issue must agree with the Library card.

### Minor

**2. The lane chip and DSH usage follow the model a chat asked for, never the model that answered.**
- **Where:**
  - `lib/client.js`: the chip at line 1159 and `fs-lanechip-anchor`.
  - The DSH usage table on the Fleet page.
  - There are no `responseModel` reads anywhere in `lib/`.
- **What:** Tonight the gateway answered GLM-5.3-Flash-EXL3 requests with DeepSeek-V4.1-Flash-1017 (my turn's `responseModel`).
  - Fleet put the chat on A5–A8: the chip "A5–A8 · GLM-5.3-Flash-EXL3 · … Answering".
  - It put the turn's tokens under GLM-5.3-Flash-EXL3, "Lane now A5–A8".
  - This is what the README promises ("found by the model id"). But a fleet console with a gateway guard is where the owner would expect to see that a lane is not the one answering, and this went on for hours tonight.
- **Fix:**
  - Read the last turn's `responseModel` (DSH keeps it in the session log). When it differs from the chosen model, draw the chip amber, for example "Answered by DeepSeek-V4.1-Flash-1017 (A1–A4), not GLM-5.3-Flash-EXL3".
  - Count DSH usage by the model that answered.
  - Consider a gateway-guard finding when the gateway substitutes a model.

**3. In replay, two lines claim a machine took part.**
- **Where:**
  - `lib/client.js` line 711: the Check now toast.
  - The Benchmark sheet's estimate line.
- **What:**
  - In replay, Check now re-reads a capture, yet its toast says "A1 answered: up 7 days, boot ID 9c96be85". This is under a page note that says Fleet "reaches no machine".
  - The Benchmark sheet says the run "go[es] to a stand-in on this machine", then "About 2 min, 31 requests to A5–A8 through Bertnet Gateway".
- **Fix:** In replay, say "A1's captured read: up 7 days, boot ID 9c96be85" and "31 requests to the stand-in on this machine".

**4. Loaded with no row config in a test DSH, Fleet reads the real fleet at once.**
- **Where:** `lib/impl.js` DEFAULTS (`poll` true, `alerts` true to the real cron channel, `dataDir` `<DSH home>/fleet-shell`). dsh-test starts every instance with `DSH_TEST_INSTANCE=1`.
- **What:** My mis-keyed `--config` (my own error; see What I ran) gave Fleet `config: {}` in DSH Test.
  - Within 3 s it was reading the gateway ledgers, the Ascents and the disks. That ran for about 60 s.
  - Only reads ran, and DSH Test has no Discord token, so nothing was sent.
  - The README documents the hands-off row, so this is hardening, not a broken promise. But "fail safe" here rests on every tester keying the row right.
- **Fix:**
  - When `DSH_TEST_INSTANCE=1` and the row sets neither `replay` nor `poll`, start hands-off (as `poll: false`) and say so on every page.
  - In HANDOFF's "How to run them", show the row keyed `fleet:` as the README does.

### Nits

**5. Words and structure for screen readers.**
- The state dots are `aria-hidden`, with no words beside them in the Lanes now tiles. A screen reader hears "A1 tp4-lane" and not "answering, not tested" (DESIGN §9: "say the state in words where you draw it").
- The heading levels go H1 "Fleet", H3 "Lanes now", H3 lane cards, then H2 "Ascents".
- **Fix:** Add an `fs-sr` word to each dot. Make the section heads H2 and the cards H3.

**6. The e2e contrast check assumes the ground under the glass.**
- **Where:** `lowContrast` in `test/e2e/run.mjs`.
- **What:** It composites translucent layers over white (light) or black (dark), not over the picture. DESIGN's hard cases are therefore not what it measures: light glass over a dark picture, dark glass over a light one, and a low tint.
- My real-pixel measurement found nothing under 4.5:1 for dark glass over the light picture or for light at tint 25, so nothing is hidden there today. Light glass over a dark picture stays unmeasured.
- **Fix:** Measure the ground from a screenshot, as DESIGN §10 asks ("layering grounds down to an opaque one"). Or add one run at tint 20 over the opposite picture.

**7. A worded line on the Models page's Cleanup column.**
- It reads "A1 is 96% full and A2 is 95% full and A3 is 95% full."
- **Fix:** Write "A1 is 96% full, A2 and A3 95%."

**8. In E, the A3 card and the dialog disagree.**
- **What:** The A3 card still reads "Not answering over SSH … what runs on it is not known". The Power cycle dialog over it has just read "Everything running on A3 stops: tp4-lane. Boot ID now: …". The plan's read is not fed back to the card.
- **Fix:** Keep the plan's read as the node's latest reading.

### Round 1's findings
1. A power cycle left "running" by a restart: **fixed**.
   - `lib/power.js` saves it as running before the script, watches it again inside its window or marks it interrupted, bounds "running" to its window, and keeps an old process silent.
   - Tested by `power.test.mjs`, impl.test 18b and e2e E (a restart mid-watch ends "done" and the script runs once).
2. Facts not read: **partly fixed**.
   - Fixed: grey "not read yet", no "No updates", "nothing running" or containers without a read, "–" energy with the plugs off, and Harmony in words.
   - Still open: the lane card's tank claim (finding 1) and the replay toast (finding 3).
3. Light lane labels and text on the wall: **fixed**. The labels are in text tokens; heads, strips and notes are on glass at tint + .2; e2e A checks "no text on the wall"; my pixel measurement agrees.
4. Light tone colours under 4.5:1: **fixed**. e2e A runs light contrast with Wallpaper and data on all five pages.
5. Power cycle's own confirm: **fixed**. It is DSH's RiskConfirmation: it opens on Cancel, has a tick box, Esc means no and focus goes back (e2e E).
6. Config problems not reaching an open window: **fixed**. e2e C passes, and my live edit showed all eight.
7. Motion and transparency: **fixed**, from the code (one rule for every Fleet root, pseudo-elements included; transparency in light and dark). I did not picture it.
8. The same note many times: **fixed**. Each of the five pages has one note, and disabled buttons carry their reason in the title.
9. Raw paths, keys and service names: **fixed**. None of round 1's strings appear on any page I read. The Power cycle dialog keeps the command on purpose, as round 1 asked.
10. Run check enabled in replay: **fixed**. It is disabled with its reason, and the note names it.
11. Timing-flaky checks: **fixed** as far as I saw. Unit tests passed 22 of 22 and e2e 138 of 138 on all three builds, first try, on a loaded Mac.
12. No real-DSH test for the chip, the right panel and sessions on a lane: **fixed**. e2e F has 15 checks with a scripted model.
13. No test of Power cycle's success path: **fixed**. Tests cover every ending, a wrong or expired token, and a restart.
14. Light contrast checked only without data or the wall: **partly fixed**. It now runs with data and Wallpaper, but over an assumed ground (finding 6).
15. Two README lines: **fixed**. The README says "Five starts, and a sixth", and the refusals are split by mode.
16. A card back's last line under the turn button at 760 px: **fixed** (e2e A check and picture, and my own turn at 760 px).

## What would make it a 9.5
1. **One source of truth for "on tank".** The lane card, the Tank rules and the Library must agree with the scan, with a check on the fixture that already holds the case (finding 1).
2. **Say who really answered.** Compare `responseModel` with the chosen model in the chip and in DSH usage (finding 2).
3. **Honest words in replay** for Check now and the benchmark estimate (finding 3).
4. **Fail safe in a test DSH**, and put the keyed row in HANDOFF (finding 4).
5. **Nits 5 to 8:** words on the dots and heading levels, a contrast check on real pixels or a low tint, the Cleanup sentence, and the card fed from the plan's read.

## Live DSH fingerprint (before and after)
- 11:42 PM PDT, before any work: pid 64099, started Mon Oct 26 15:35:11 2026, patch sha256 535e6390a2162bbc…. I kept a private copy of the live patch in my judge folder.
- 11:44 PM PDT, before the e2e: the same.
- 11:55 PM PDT, after the e2e: the harness reported "pid 64099, started Mon Oct 26 15:35:11 2026, patch 535e6390a2162bbc — unchanged".
- 12:05 AM PDT: the same, and the live patch file is identical to my 11:42 PM copy.
- 12:08 AM PDT, after `destroy` and the slots: pid 64099, started Mon Oct 26 15:35:11 2026, patch 535e6390a2162bbc…, unchanged. The patch did not move during this round.
- My instance's mis-keyed minute (finding 4) ran in DSH Test's own home and process, never in the live DSH.
