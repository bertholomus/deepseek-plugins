# Fleet: judge round 1

Commit 3142189 (branch `goal95/fleet`; its code equals b8c92dd, only `HANDOFF.md` differs), judged Mon Oct 26 2026, 2:30 to 3:20 PM PDT. DSH Test instance g95-fleet-j1b (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3. Fleet was drawn with Wallpaper and ran in replay on the builder's capture `models-live-20261025`, with the People ledger summary added. `avatars`, `alerts` and `plugs` were off and `whoSeconds` was 0; I never changed those keys.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.0 | Every job in the README and in this stack's brief is there and works on the captures. The card flip is excellent. Several tiles state facts Fleet never read, such as "No updates", "nothing running" and a green ring. |
| Reliability | 8.5 | Hands-off is enforced on the host, and the config is checked with each problem named. A power cycle saved as "running" survives a restart forever: it then mutes that Ascent's "Not answering" alarm and blocks its next power cycle. |
| UX / polish | 8.0 | Keyboard, rings, the flip, 760 px, the dark theme, DSH's dialog, toast and menu, and the gateway bar are right. In light, the lane labels are at 1.8–2.1:1. Every page puts text on the bare wall. Power cycle uses Fleet's own confirm, and Reduce Motion and the hands-off notes are uneven. |
| Test depth | 8.5 | About 1,500 unit assertions and 93 real-DSH checks on three builds, with an ssh recorder. Power cycle's success path has no test, the light contrast check only sees the empty state, and two checks are timing-flaky. |
| Docs | 9.0 | A thorough README: config table, replay format, switching off, rollback, setup and a test map, accurate where I checked. Nits: "Three starts" lists four, and one line says Check now and benchmarks are refused in replay (they are not). |

Plugin score: min(9.0, 8.5, 8.6) = 8.5. Verdict: NOT YET.

## What I ran

### Reading
- RULES, JUDGE-GOAL95 and JUDGE, all of each.
- `DESIGN.md`, all of it, ticking "Before you push" for Fleet's UI.
- The README, all 353 lines.
- `lib/impl.js`, `lib/client.js`, `findings.js`, `facts.js`, `gatewayguard.js` and `avatars.js`.
- Every unit test and `test/e2e/run.mjs`.
- No previous round exists.

### The head
- `git archive 3142189 | tar -x` into `~/Projects/goal95/judge/fleet-r1/head`, with `.e2e` linked.
- I never judged a worktree.

### Unit tests
- `npm test` in `plugins/fleet` at 2:33 PM: 20 of 21 passed.
- The failure was `lib/plug_meters.test.mjs:124` ("readings every 0.1 s"), at a load average near 34.
- I reran that file 6 times at 3:00 PM (load 18): 6 of 6 passed.

### Real-DSH tests
- `npm run e2e` in `plugins/fleet`, 2:33 to 2:42 PM, on its own slot:
  - 93/93 on 0.2.0-rc.2;
  - 93/93 on 0.2.1-rc.1;
  - 90 passed, 1 failed on the app's 0.2.1-rc.3. A's dark screenshot gave "page.screenshot: Timeout 15000ms exceeded".
- I reran the app build from 2:43 to 2:46 PM: 93/93.
- Every run passed "no ssh command ran on any machine in A, B or C", and the live fingerprint was unchanged.

### Setup and the connection watch
- Before opening any page, I read how Fleet stays hands-off on the host:
  - in replay, `ssh()` answers only from captured files;
  - `handsOff()` refuses Power cycle and tank fixes with a 409;
  - `runCheck` refuses in replay;
  - the plug meters are replayed;
  - Discord is held.
- I loaded `plugins/wallpaper`, then `plugins/fleet --config row.yml`, both from my head.
- I ran a watcher (`lsof -a -i` on every DSH Test process, about every 15 s; log at `~/Projects/goal95/judge/fleet-r1/conn.log`).
- On the first start, two outside connections showed: 43.169.32.32:443 from DSH's network helper and 3.173.21.63:443 from its main process.
  - I stopped the instance at once.
  - I found the same two on other DSH Test instances without Fleet, and on the live DSH, so they are DSH's own.
  - I restarted with the watch on.
- Across both starts, the only remote ends were those two, plus:
  - the tailnet address of DSH Test's model gateway (port 18780), during my turn;
  - 142.251.x:443, Wallpaper's web-font stylesheet.
- No ssh, python or other child process of Fleet ever ran.

### Pictures
- Taken with Playwright through the harness, as listed below.

### Keyboard
- All five pages: 87 tab stops (Fleet 30, Models 45, Tank 2, People 3, Activity 7). Every one showed the 2px ring.
- Enter turned a card to its facts. Focus stayed on the card, the ring was rgb(65,118,230) on `:focus-visible`, and the live region said "Showing the facts of GLM-5.3-Flash EXL3 4bpw TensorFold".
- Esc turned it back, with focus kept.

### Contrast
- I measured every Fleet text against its layered glass.
- Dark: nothing under 4.5:1 on any page.
- Light: see the findings.

### Gateway guard with Wallpaper (the builder's untested case)
- I removed GLM-5.3-Flash-EXL3's reasoning levels from the DSH Test profile.
- The guard flagged it (pending at 2:49:58 PM). The bar showed above the composer in DSH's menu material: 6.4–16.8:1 in light, 9.9–14.5:1 in dark.
- I restored the profile and the pending cleared.
- Repair was never pressed (`lastRepair` null).

### Wrong config
- I put `pollSeconds: often` and `pricePerKwh: -1` in the row.
- The state route and `fleet.log` named both, with the values Fleet uses instead.
- The open Fleet page showed no note.
- I restored the row afterwards.

### A real turn
- I opened a new session and switched access to Workspace Write first (checked: "Access mode, current: Workspace Write").
- I sent "Count from 1 to 300, one number per line, and write nothing else." on GLM-5.3-Flash-EXL3.
- The A5–A8 lane card then read "1 DSH session · 1 in flight", listing "Counting from 1 to 300", Running.

### Never pressed
- Power cycle, any plug, a tank fix or plan, Swap model, Make room, Load, Benchmark…, Run check, Check now, Rescan, the gateway Repair, or anything that touches Discord.
- I judged those paths from the code, `impl.test.mjs` and the e2e's recorder.

### Not checked
- Live machine data. Everything was replay.
- A DSH restart in the middle of a turn. In replay, with alerts and plugs off, Fleet keeps no state that a restart would test; I judged restarts from the code instead.
- Switching Fleet off and on by hand. The e2e's B and C prove it on all three builds.

### Cleanup
- At 2:56 PM I destroyed the instance, gave back both slots and stopped the watcher and every script I started.

## What I saw (each picture, one line)

All in `review/fleet-round-1/`. The wallpaper is a busy picture, as in the e2e. The e2e-* files come from my own e2e run.

### Fleet page
- `fleet-light-1440.png`: Fleet in light. The lane strip's pastel labels ("A1–A4 · Serving", the model names) are barely readable, and the subtitle sits on the bare wall.
- `fleet-dark-1440.png`: Fleet in dark over a busy dark picture: KPIs, the lane strip and the lane cards. All legible.
- `fleet-light-760.png`: 760 px. The tiles reflow 4 by 2 with no sideways scroll; the lane labels are still faint.
- `fleet-lane-with-dsh-session-light.png`: the A5–A8 card during my real turn: "1 DSH session · 1 in flight", "Counting from 1 to 300", Running, and the server's counts. A tank path and "(whoSeconds is 0)" are in plain view.
- `fleet-keyboard-focus-light.png`: the lower Fleet page.
  - The Harmony card says "replay: Harmony was not captured", while its tiles say "Waiting for Harmony" and "every port is on the Fabric card" (there is no Fabric card).
  - Tokens and energy shows "0.00 kWh / From the eight plugs" with the plugs off.
- `fleet-config-problems-light.png`: after two wrong values went into the row. The host named both; the open page shows no config note.

### Models page
- `models-light-1440.png`: Models in light. The subtitle and the "Vision · later" / "ComfyUI · later" tabs sit on the bare wall, and the green badges are at 4.25:1.
- `models-dark-1440.png`: Models in dark: the Library (38) and Cleanup, legible. The plan buttons are disabled, with the reason given.
- `models-light-760.png`: 760 px. Two card columns, no sideways scroll; "ComfyUI · later" is cut at the right edge.
- `models-card-front-light.png`: a card's front: author, quant, size and tank state, drafter, and readiness per lane ("A1 needs space · Make room", "Serving · 4 of 4").
- `models-card-back-light.png`: its back: description, links (Hugging Face, Made from, GitHub, License), then the facts (321B total; 288 experts, 8 per token + 1 shared; …).
- `models-card-back-dark.png`: the same back in dark. It is pixel-identical to the e2e's picture on all three builds.
- `models-card-back-keyboard-light.png`: the back turned with Enter; focus stayed on the card (the ring falls outside the cropped card).
- `models-card-back-dark-760.png`: Muse-Spark's back at 760 px in dark. Its last line runs under the turn button and names a raw tank path.

### Tank, People and Activity
- `tank-light-1440.png`: Tank in light: 10 rules with Broken / Passing / Enforced. The hands-off sentence repeats under every issue, and "8 issues to fix" sits on the bare wall at 4.46:1.
- `tank-dark-1440.png`: Tank in dark, legible.
- `people-light-1440.png`: People in light. "As of Oct 24, 9:00 PM PDT" and "Details for" sit on the bare wall; the person cards and "Not counted for anyone" are clear.
- `people-dark-1440.png`: People in dark, legible.
- `people-light-760.png`: People at 760 px: one column, no sideways scroll.
- `activity-light-1440.png`: Activity in light. Two notes say it is replaying; Alerts reads "Off in Fleet's config … send nothing".
- `activity-dark-1440.png`: Activity in dark, legible.

### Chat, composer and right panel
- `composer-lane-chip-light.png`: a new chat. Fleet's "A5–A8" chip beside DSH's access chip names the lane serving the chosen model, drawn like DSH's own chips.
- `session-running-composer-light.png`: my real turn running in Workspace Write, with the chip still on A5–A8.
- `right-panel-start-light.png`: DSH's right-panel start view, with Fleet's tile ("Live lanes, tok/s, disks and power") drawn like DSH's own.
- `right-panel-fleet-light.png`: the right-panel Fleet tab: lane cards with tok/s and "Answering · not tested". Swap model on A1–A4 is only hovered, by the pointer left over from opening the tab; nothing was pressed.
- `right-panel-fleet-dark.png`: the same tab in dark.
- `guard-bar-wallpaper-light.png`: the gateway bar with Wallpaper in light: "Bertnet Gateway list needs a repair · It lost the reasoning levels on GLM-5.3-Flash-EXL3 · Repair", in DSH's menu material.
- `guard-bar-wallpaper-dark.png`: the same bar in dark.

### From my e2e run
- `e2e-A-history-dialog-light.png`: Ascent 01's History in DSH's own dialog. Behind it, every Ascent card repeats the hands-off sentence and says "No updates" though Harmony was never read.
- `e2e-C-fleet-dark-config-note.png`: a start with a wrong row: "2 values in Fleet's config are wrong", each named, with the value used and where to fix it.
- `e2e-D-fleet-empty-light.png`: `poll: false`. DSH's toast and a clear note appear. But every lane tile says "nothing running" with a green ring, and each Ascent says "No containers running", though nothing was read.
- `e2e-D-models-empty-light.png`: `poll: false` Models: the Library from Fleet's own notes, with "Disks not scanned yet" and "tank not scanned yet".

## Findings

Most severe first.

### Major

**1. A power cycle left "running" by a restart blocks and mutes that Ascent for good.**
- **Where:** `lib/impl.js`:
  - `powerOk`: the op is saved as `status: 'running'`, and only the detached loop in the same process ever finishes it;
  - `resting()`, line 1412;
  - the `powerCycling` reading, line 1426.

  Also `lib/findings.js` line 51 and `lib/client.js` `PowerCycle`.
- **What:** No code at start marks or resumes a saved "running" op. A power cycle runs up to about 19 minutes: up to 4 for the script, then a 15-minute boot-ID watch. If DSH restarts or Fleet reloads in that window (a config edit or an update is enough), `state.json` keeps "running" forever. From then on:
  - Fleet refuses that Ascent's next power cycle ("A power cycle of A6 is already running");
  - its button stays "Power cycle running…" and disabled;
  - the critical "Not answering" finding and that node's fabric readings are skipped, so a later outage of that Ascent raises no finding and no alert.

  I judged this from the code and did not press Power cycle.
- **Fix:**
  - On start, turn any saved "running" op into "interrupted", or resume its boot-ID watch for what is left of its window.
  - Log it to `fleet.log` and Activity.
  - Bound `resting()` by time, for example `startedAt` + 20 minutes.
  - Add a test with the ssh recorder (see finding 13).

**2. Fleet states facts it has not read.**
- **Where:** `lib/client.js`:
  - `TileLine` says "nothing running" for a node with no containers, including one never read;
  - the Ascent card (around line 708) says "No containers running", "No updates" whenever `n.updates` is empty, and "boot ?";
  - the node dots (lines 564 and 698) draw the hollow green "part" ring for a node that was never read (`reachable == null`);
  - the Harmony tiles say "Waiting for Harmony" in replay, where Harmony is never read, and "every port is on the Fabric card" when `FabricCard` drew nothing (line 720);
  - Tokens and energy shows "0.00 kWh / From the eight plugs" while the plug meters are off.
- **What:** With `poll: false` (e2e-D), every tile reads "nothing running" under a green ring. In replay, every Ascent reads "No updates" though Harmony was not captured. Live, an Ascent whose Harmony read fails will say "No updates" just the same. In an owner's console, this is the one place Fleet is not honest.
- **Fix:**
  - For an unread node, show a grey dot and the words "not read yet".
  - Without a fresh Harmony read, say "Updates unknown", or say nothing.
  - Show "–" for energy when the plugs are off.
  - Drop the Fabric-card pointer when there is no card.
  - In replay, say "Harmony not captured".

**3. In light, the lane labels are at 1.8–2.1:1, and every page puts text on the bare wall.**
- **Where:**
  - `lib/client.js` line 184: `LANE_COLORS` is used as the text colour by `.fs-bracket span{color:var(--c)}` in the "Lanes now" strip.
  - Each page's header line (`Page`, lines 386–388: the subtitle and the controls on the right).
  - The Models tabs "Vision · later" and "ComfyUI · later".
  - People's "As of …" and "Details for".
  - The Fleet page's "Ascents" heading line.
  - Tank's "8 issues to fix".
- **What:** In light, "A1–A4 · Serving" and its model measure 2.13:1 against their glass, and "A5–A8 · Serving" and its model 1.84:1. The header text sits straight on the picture, against DESIGN rule 6 and §3 ("Never put text straight on the wall"); over the busy pictures it is hard to read. The e2e passes all of it, because its light check (D) runs on an empty Fleet without Wallpaper.
- **Fix:**
  - Keep the pastels for the bars, and draw the words in `--fs-text` or a tone deepened toward DSH's label colour.
  - Put each page header and section heading on glass at tint + .2, or inside the first card.
  - See finding 14 for the test.

### Minor

**4. Light-theme tone colours are just under 4.5:1.**
- **Where:** `.fs-badge.fs-tone-ok` and `.fs-authbadge-official` at 4.25:1, `.fs-link` at 4.38:1, `.fs-badge.fs-tone-warn` at 4.46:1. About 120 text items on the Models page alone ("Serving · 4 of 4", "Ready", "Official", "Make room", "Load on any set of Ascents…").
- **Fix:** Deepen the light ok, accent and warn tones one step.

**5. Power cycle's confirmation is Fleet's own.**
- **Where:** `lib/client.js` `PowerCycle` (lines 619–635): an inline `role="alertdialog"` with Cancel and "OK, power-cycle A3".
- **What:**
  - Fleet's riskiest action does not go through DSH's RiskConfirmation with its tick box (DESIGN §9).
  - Focus does not move to the safe choice.
  - Esc does not cancel.

  I judged this from the code and did not press it.
- **Fix:** Use DSH's RiskConfirmation, through the same DSH dialog path History uses. Open it on Cancel, make Esc mean no, and keep the boot ID and the exact command inside it.

**6. Config problems do not reach an open window.**
- **Where:** `lib/client.js`: `ConfigNote` reads `stateS`, which is fetched only at apply (line 2584) and after a few actions (line 296). The 5-second poll refreshes only the fleet view.
- **What:** With two wrong values in the row, the host named both, but the open page showed no note until a reload (`fleet-config-problems-light`). The hands-off note behaves the same way.
- **Fix:** Carry `configProblems` and `handsOff` in the 5-second fleet answer, or refresh state with it.

**7. Reduce Motion, Motion off and reduced transparency are only partly respected.**
- **Where:** `lib/client.js` styles.
  - People (`.fs-pp`) and Activity (`.fs-act`) stop every animation and transition, pseudo-elements included.
  - Fleet, Models and Tank stop only the `.fs-rise`, `.fs-pop`, `.fs-bar i` and `.fs-okprompt` animations (lines 2572–2573). Their transitions keep running, such as `.fs-bracket{transition:all .32s}` and the hover fades.
  - Under `prefers-reduced-transparency`, only People, Activity, the ledger card and two sheets turn near-opaque. Fleet, Models and Tank cards keep `--wp-tint` glass.
- **Fix:**
  - One motion rule for every Fleet root (the five pages, the right-panel tab and the sheets), with `::before`/`::after`, as DESIGN §6 shows.
  - The same roots under reduced transparency.

**8. The same note appears many times.**
- **Where:**
  - The hands-off sentence is drawn on each of the eight Ascent cards, under each Tank issue and under each Cleanup item.
  - Activity shows two notes, each saying it is replaying.
- **What:** DESIGN §9 asks for one explanatory note per page; Tank shows the sentence four times on one screen.
- **Fix:** Keep only the page note, and put the reason for each disabled button in its title.

**9. Raw paths, keys and service names appear where people read.**
- **Where:**
  - The lane card: "tank staging/ascent-sweep-20261007/a05/ai/cache/glm53-exl3-huggingface".
  - The card back's replay note: "llm/banked/Muse-Spark-Open-816B-A42B--0fb02478 is not among them".
  - "(whoSeconds is 0)".
  - "(providers.owner-ascents)".
  - "replay: locks.txt was not captured".
  - A toast: "session/modelCatalog lists Bertnet Gateway only" (`lib/client.js` line 2088).
- **Fix:** Use plain words:
  - "its folder on tank", with the path behind a copy button or in a title;
  - "who is on each lane is off in Fleet's config";
  - "DSH's model list".

**10. Run check is enabled in replay.**
- **Where:** `lib/client.js` lines 343 and 612: the button is disabled only while checking, or for a lane that is not answering or not on the gateway. `runCheck` refuses in replay.
- **What:** The button invites a click that the host then refuses, and the page note says only "Power cycle and tank fixes are off here".
- **Fix:** Disable it with the reason when hands-off, as Power cycle is, and name it in the note.

**11. Two checks fail by timing.**
- **Where:**
  - `lib/plug_meters.test.mjs` line 124: `--every 0.1 --minutes 0.004` must give two readings within 0.24 s. It failed once in 7 runs, under load.
  - The e2e step A "dark theme over the busy dark picture": `page.screenshot` timed out after 15 s on the app build, then passed on the rerun.
- **Fix:**
  - Stop the meter run after a count of readings, or give it 2 s.
  - Give the harness's screenshots a longer timeout or one retry.

**12. The composer chip, the right-panel tab and the "DSH sessions on a lane" line have no real-DSH test.**
- **Where:** `test/e2e/run.mjs` never opens a chat's composer or the right panel. The gateway ledger side of "who is on each lane" is unit-tested in `people.test.mjs`.
- **What:** I proved all three by hand (pictures above). Nothing guards them on the next DSH build.
- **Fix:** Add A checks:
  - the chip's lane for the session's model;
  - the tab's lane cards;
  - a running session listed on its lane.

**13. Power cycle's success path has no test.**
- **Where:** `lib/impl.test.mjs` lines 828–876 test only refusals.
- **What:** Nothing runs plan → OK → watch with a fake boot ID. Nothing tests the 5-minute expiry, a wrong token, or the "unchanged" and "no-answer" endings.
- **Fix:** Drive it with the `FLEET_TEST_SSH_BIN` recorder answering boot IDs, including a reload during the watch (finding 1).

**14. The light contrast check never sees data or the wall.**
- **Where:** `test/e2e/run.mjs` line 434 (D: light, no Wallpaper, empty Fleet) and line 372 (C: dark).
- **What:** Findings 3 and 4 pass the e2e.
- **Fix:**
  - Run the check in A: light, Wallpaper on, the captured data.
  - Fail on any Fleet text whose nearest opaque ground is the wall.

### Nits

**15. Two README lines are wrong.**
- **Where:** README line 324 and line 320.
- **What:**
  - Line 324 says "Three starts:", then lists A, B, C and D.
  - Line 320 says Check now and benchmarks are refused in replay. In replay, Check now re-reads the captures and a benchmark runs against the stand-in; only `poll: false` refuses them.
- **Fix:** Say "Four starts", and split line 320's refusals by mode.

**16. At 760 px, a card back's last line sits under the turn button** (`models-card-back-dark-760`).
- **Fix:** Reserve the button's height at the end of the back.

## What would make it a 9.5

1. **Restarts.** Recover a power cycle left "running" and bound `resting()`. Unit-test the whole plan → OK → watch path with the recorder, a reload included (findings 1 and 13).
2. **Honest states.** Say "not read yet" (grey dot), "Updates unknown", "–" for energy with the plugs off, "Harmony not captured" in replay, and no Fabric-card pointer without a card (finding 2).
3. **Light theme at 4.5:1.**
   - Draw the lane labels in text tokens, and deepen the ok, accent and warn tones.
   - Put every page header, section heading and status line on glass.
   - Extend the e2e's light contrast check to a populated Wallpaper page, and fail on text over the wall (findings 3, 4 and 14).
4. **Power cycle confirmation.** Use DSH's RiskConfirmation, opening on Cancel with Esc meaning no (finding 5).
5. **Motion and transparency.** Apply one motion rule and one transparency rule to every Fleet root (finding 7).
6. **Notes and live state.**
   - One hands-off note per page.
   - Run check disabled with its reason in replay.
   - Config problems and the hands-off state carried in the 5-second poll.
   - Plain words for paths, keys and service names (findings 6, 8, 9 and 10).
7. **Tests and docs.**
   - Real-DSH checks for the composer chip, the right-panel tab and sessions on a lane.
   - A plug meter test that does not race.
   - A screenshot retry.
   - The two README fixes (findings 11, 12 and 15).

## Live DSH fingerprint (before and after)

- **Before, 2:32 PM PDT:**
  - pid 43210, started Mon Oct 26 07:14:47 2026;
  - patch sha256 f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55;
  - a private copy of the live patch kept in `~/Projects/goal95/judge/fleet-r1`.
- **The e2e's own reads (2:33 / 2:42 PM; rerun 2:43 / 2:46 PM):** unchanged.
- **After, 2:56 PM PDT** (instance destroyed): same pid, start time and sha256.
- **Again at 3:09 PM PDT:** same. The sha256 never moved, so there was nothing to diff.
- I never touched the live DSH, `~/.dsh`, `~/.dsh-plugins` or `~/Projects/worktrees/dsh-split-plugins`.
- I captured no screen. Every picture is of my own Playwright pages through the harness.
