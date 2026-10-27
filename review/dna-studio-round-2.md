# DNA Studio: judge round 2

Commit 7975838 (branch `goal95/dna-studio`; its code is db175cd, 7975838 adds only HANDOFF.md's numbers), judged Mon
2026-10-26, 8:38 to 9:03 PM and 11:37 to 11:49 PM PDT (the account's usage limit stopped the judge from 9:03 to 11:37 PM).
DSH Test instance g95-dna-studio-j3 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 requested; the owner gateway
answered with DeepSeek-V4.1-Flash-1017 (an environment fact, not scored), so after one real-model turn the chat paths
come from the e2e harness's scripted model. GOAL95 PASS 2 bar: 9.5 with no criterion below 9.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | Both faces do the whole job (page: items, the sentence read back, colorways, prints, fabric photo, views, Before and after, Edit, Download, Rerun; chat: seven tools, each call a card with its pictures), but once a photo is in, the page's Generate stays below the window until the end of the gallery, which grows with every job. |
| Reliability | 9 | A row save, a restart, off and on, a dead studio and wrong settings all end in the right state, in words, logged, nothing run twice (by hand and on three builds); one silent defect: two results of one kind finished in the same second share a file, and the first is lost. |
| UX / polish | 8 | Calm, plain words, keyboard and screen-reader names, light and dark, DSH's own dialog; but the form is sticky at every width, so at 760 px job cards cover the sentence box and Generate, and at 1280 x 900 Generate cannot be reached until the end of the gallery. |
| Test depth | 8.5 | 42 unit tests and 121 real-window checks on each of three DSH builds prove most claims, but the run is fragile on a busy Mac (5 failures from two harness causes in my first run; 121 of 121 on a rerun), and the 760 px check uses an empty form, so it missed the overlap. |
| Docs | 9 | README and HANDOFF are accurate on everything I checked (settings apply within seconds, restart, switched off on both DSH paths, the chat's fold, the tests); small slips: not every tool result ends with the build-on sentence, and nothing says a wrong backendUrl falls back to the production studio. |

Plugin score: min(U, R, mean) = min(8.5, 9, 8.6) = 8.5. Verdict: **NOT YET** (UX / polish 8 is below 9).

## What I ran

- Extracted 7975838 into my judge folder (`git archive`); read README, HANDOFF, the builder's PASS 2 handover block,
  DESIGN.md's "Before you push" list, every file in `lib/`, the unit tests, `test/e2e/run.mjs`, its harness and the
  stand-in studio. `node --check lib/client.js` passes.
- `npm test`: 42 of 42 pass (8.4 s), offline.
- `node scripts/e2e.mjs` with a memory slot (8:39 to 8:56 PM): DSH 0.2.0-rc.2 120 of 121 (284 s), 0.2.1-rc.1 109 of 113
  (402 s, four steps failed), the app's 0.2.1-rc.3 121 of 121 (328 s); its own fingerprint line: unchanged. All five
  failures are the harness's (finding 4): a check read the window's health poll as "the last studio call", and on
  0.2.1-rc.1 DSH's own Preview Notice opened late after the restart step and took the next clicks. A rerun of
  0.2.1-rc.1 alone (8:57 to 9:03 PM): 121 of 121 (330 s), fingerprint unchanged. I read the checks; they look at
  files, `job.json`, the stand-in's request bodies, DSH's log and the window.
- My DSH Test instance: only this plugin, its row pointed at the builder's stand-in studio, which I started from my head
  on 127.0.0.1:18617; the instance's default access preset set to Workspace Write before any turn (the session's
  `permissions` read `workspace-write`); `doctor`: 0 import errors, isolation ok.
- One real-model turn (8:41 PM), a DNA Studio chat: "Make the blouse in <ws>/model.jpg sage." One `studio_edit` by path
  (0.4 s), the reply "The blouse is now sage (#9CAF88); everything else is untouched…". The session log's
  `responseModel` was DeepSeek-V4.1-Flash-1017, so I sent no more real-model turns.
- My own Playwright window (the harness's `openWindow` and `shot`), 1280 and 760 px, light and dark: the page empty, a
  photo broken into items, a pick, the plan line, Generate, the result, Before and after (Escape), the chat card,
  the studio down, a cut-off job, wrong settings, the Plugins page.
- The page's API from inside the window: a non-photo, no photo, a sentence it cannot read, an empty sentence, a 32 KB
  sentence, `..` in `image` and `chat-image`, a missing job for Rerun and Hide, a body that is not JSON, a wrong
  method: each refused in words (400/404) or read correctly, nothing sent to the studio.
- A row save (`timeoutMs: 600000`) under a page job the stand-in held; a DSH restart under another held job; wrong
  settings saved live, then put back; switched off and on with the Plugins page's own switch, once idle and once with
  a held page job (the studio answered while DNA Studio was off: the job ended done, one studio edit, shown done when
  switched on again).
- By keyboard at 760 px: three Tabs from the sentence box to Generate, Enter: the job started and finished.
- The sentence reader on hard sentences, typed in the window on a photo with its items.
- Two probes in my scratch folder with the plugin's own code: two `studio_edit` calls in one chat that end in the same
  second (stand-in studio, throwaway home); Generate's reachability at 760 and 1280 px (`elementFromPoint` while
  scrolling the page in 150 px steps).

## What I saw (each picture, one line)

Pictures are in `review/dna-studio-round-2/`; the `e2e-*` ones come from my e2e run.

- `01-page-1280-light`, `02-page-1280-dark`: the empty page: title, one sentence, the form, "Your results show up
  here". In dark the drop slots' dashed borders are faint.
- `03-items-light`: the photo broken into Blouse, Pants, Shoes and Background.
- `04-plan-light`: Blouse picked, "dusty rose", "Will change blouse: color → dusty rose".
- `05-done-light`, `06-done-dark`: the job card: "blouse · dusty rose", "Done in 0.6 s · just now", Before and the
  result with Before and after, Edit and Download under the picture (in the light one the result was still loading).
- `07-before-after-dark`: DSH's dialog: the slider, Before and After labels, "Only the blouse changed.", Edit this,
  Download; the focus ring round the whole photo.
- `08-page-760-light`, `09-page-760-dark`: one column, but a job card is drawn over the form, under "What should change
  on the blouse?": the sentence box and Generate are beneath it.
- `10-chat-folded-light`: the real-model chat, Workspace Write, the DNA Studio badge, "Completed in 11s" folded: no
  picture until clicked.
- `10-chat-open-light`, `11-chat-open-dark`: opened: "Blouse: color → sage", "Only the blouse changed. Took 0.4 s.",
  the picture, Before and after, Download; no id, file name or path.
- `12-running-after-save-light`: seconds after a save of the row: the same job, "Working… 74 s".
- `13-cut-off-dark`: after a restart: "Cut off by a restart", "Not changed: DSH stopped while this ran, so it did not
  finish. Press Rerun to run it again.", Rerun.
- `14-bad-settings-light`: "A setting needs fixing." with five problems in one paragraph.
- `15-plugins-page-light`, `16-plugins-off-light`: "DNA Studio", its sentence and its icon; the switch off.
- `17-page-1280-generate-scrolled-light`: 1280 x 900 with a photo, scrolled down the gallery: the form pinned, the
  sentence box at the bottom edge, Generate below the window.
- `18-page-1280-scrolled-to-end-light`: only at the end of the gallery does Generate come into view.
- `17-page-760-generate-scrolled-light`, `18-page-760-scrolled-to-end-light`: 760 px: the job cards over the form;
  at the end of the scroll Generate is under a job card.
- `19-studio-down-light`, `20-studio-down-dark`: "The studio at 127.0.0.1:18617 is not reachable. The 4090 may be off
  or in Windows. Generate fails until it answers, and a failed job keeps its Rerun. This page checks again every 30 s."
- `e2e-app-chat-pictures-light`, `e2e-app-chat-pictures-dark`, `e2e-app-chat-before-after-light`: the chat card on the
  app build, and Before and after in DSH's dialog.
- `e2e-app-off-open-chat-light`: switched off, DSH still ran the open chat's turn; each studio call's row reads "Error:
  DNA Studio is switched off in DSH's Plugins page, so nothing was sent to the studio. Switch it on, t…" (DSH cuts it).
- `e2e-app-working-dark`, `e2e-app-compare-light`: a running job; a compare sheet.
- `e2e-app-narrow-760-light`: the e2e's 760 px picture: an empty form, so the overlap does not show.
- `e2e-0.2.1-rc.1-failed-preview-notice`: DSH's Preview Notice over the window in the failed 0.2.1-rc.1 run.

## Findings (most severe first)

1. **Major: the form is sticky at every width, so Generate hides once a photo is in.**
   Where: `lib/client.js` lines 832 and 833. `@container dnapage (max-width:820px){… .dna-form{position:static}}`
   comes before `.dna-form{position:sticky;top:0}`; both are one class, so the later sticky rule wins at every width
   (computed `position: sticky` at 760 px).
   What: with one photo the form is 1180 px tall. At 1280 x 900 with five jobs, scrolling pins the form at the top
   with Generate at 1097 px, below the window, at every scroll position but the last 15 px of the gallery; Playwright's
   `scrollIntoViewIfNeeded` could not reveal it (pictures 17 and 18, 1280). The same at 1280 x 1100 (usable only at
   scroll 1000 to 1015 of 1015); only a window about 1300 px tall or more (1280 x 1400: usable everywhere) avoids it.
   At 760 px the job cards scroll over the form; at the only positions where Generate is inside the window,
   `elementFromPoint` is a job card: a mouse can never press it (pictures 08, 09, 18). The gallery keeps every job, so
   this gets worse with use. By keyboard, three Tabs from the sentence box reach Generate and Enter starts the job, but
   the focused button stays out of sight (its top at 1034 px in a 900 px window). The rule order is the same in the
   live 0.3.0 copy (2834ff1), so this is old, not new in this pass; round 1 did not report it.
   Fix: put the one-column rule after the sticky rule (or `.dna-two .dna-form` inside the container query), and keep
   the form sticky only while it fits (or give it `max-height` and its own scroll). Add an e2e check at 1280 x 900 and
   760 px with a photo and several jobs: Generate, scrolled to, is inside the window and on top.

2. **Major (rare, silent): two results of one kind that end in the same second share one file.**
   Where: `lib/tools.js` `keep()`: the file is `<stamp to the second>-<label>.jpg`, and labels repeat
   (`blouse-color-1`, `background-<color>`, `studio_colorways-photo1`).
   What: my probe (`probe-collide.mjs`: the plugin's own tools and stand-in studio, a throwaway home): two
   `studio_edit` color calls on the blouse, sage then navy, ending in the same second. Both history lines name
   `20261027T035048-blouse-color-1.jpg`: the sage result's full-size file is overwritten by navy; building on the sage
   result's id reads the navy picture (top #1F2945), and the sage call's card shows and downloads navy under its
   "Blouse: color → sage" title. With the real studio (seconds a call) it needs two fast calls or two parallel calls
   in one turn, so it is rare; when it fires, a result is lost without a word.
   Fix: unique names (milliseconds and a few random characters, or the result's hash), written with `flag: 'wx'`;
   a unit test with two calls in one second.

3. **Minor: a wrong `backendUrl` falls back to the production studio.**
   Where: `lib/config.js` `checkConfig` (the default is the production studio's address on the owner's private network; address left out of this copy); README "Settings".
   What: saving `backendUrl: ftp://nope` with four other wrong keys gave five clear lines in DSH's log, on the page and
   in `health`, and pointed the page at the real 4090 studio: for about 35 s (8:54:40 to 8:55:15 PM) my test window's
   health check went to that address (no job, photo or edit was sent; I put the row back at once). After a typo in a
   test profile, or in the live one, the next Generate goes to a studio the row did not name.
   Fix: on a wrong `backendUrl`, keep the last good address (or none) and refuse studio calls with the note
   "backendUrl is wrong: …" instead of using the default; say so in README.

4. **Minor (tests): the e2e is fragile on a busy Mac, and the 760 px check is shallow.**
   Where: `test/e2e/run.mjs` line 380 (`studio.bodies.at(-1)`), the window steps after the restart (line 698 on), and
   the 760 px step (lines 714 to 725).
   What: in my first run "exactly one edit on the studio, for the blouse in navy" failed on 0.2.0-rc.2 because the last
   body was the window's `/v1/health` poll; on 0.2.1-rc.1 DSH's Preview Notice opened after the harness's quiet period
   (picture `e2e-0.2.1-rc.1-failed-preview-notice`), its mask took the click on "DNA Studio", and three more window
   steps failed after it. The rerun passed 121 of 121. The 760 px step checks one column and no sideways scroll with an
   empty form, so finding 1 passes it.
   Fix: take the last `/v1/edit` body, not the last body; dismiss DSH's notices before each window step (as
   `openWindow` does once); check the layout with a photo and several jobs (finding 1).

5. **Minor: words the reader does not know become "the top".**
   Where: `lib/panel.js` `plan()` and `findGarments`; `lib/tools.js` `garmentOf` (its unit test expects
   `garmentOf('hat')` to be the top).
   What: on a photo with Blouse, Pants, Shoes and Background, "make the hat red" and "make everything black" read
   "Will change top: color → red (no garment named: the top. Pick one on the photo)" with Generate on; a hat was named,
   it is just not in the photo. (The page knows the colors of the studio's own palette: with the stand-in, "the belt
   gold" and "the blouse teal" read "I could not tell the change…"; with the real studio that depends on its list.) The
   line shows before anything runs, so a careful person catches it; in a chat, the model's `garment: "hat"` silently
   becomes the top. (The round-1 sentences now read right: "make the shoes black" changes the shoes, "make the shirt and
   pants black" the blouse and the pants, "…, keep the background" no background.)
   Fix: when the sentence names something that is not among the photo's items, say so ("There is no hat in this photo:
   pick Blouse, Pants, Shoes or Background"); refuse an unknown garment word in the tools instead of mapping it to the
   top; when a color word is not in the palette, say that the color is unknown (and that a hex code works), not that
   the change could not be read.

6. **Minor (DSH's, felt by this plugin's users): a chat's pictures are folded.** In DSH's standard view a finished turn
   folds under "Completed in 11s"; the card with the picture shows after a click (picture 10). DSH folds every tool, and
   the builder lists it as an open question. Nothing to fix in the plugin now.

7. **Nits.** The wrong-settings note is one long paragraph (picture 14): one line per key would read faster. In dark,
   the drop slots' dashed border (`--dsw-alias-border-l2` on dark glass) is barely visible (pictures 02, 20). Switched
   off, DSH's error row cuts the sentence at "Switch it on, t…": a shorter sentence would fit. README says every tool
   result ends with "To build on a result, pass its id as photo."; `studio_compare`, `studio_palette` and an empty
   `studio_gallery` do not. `install()` reads DSH's error text to learn the global tool names; if that text changes, the
   shell is offered again (still blocked by the guard, and the e2e's "shell not offered" check would catch it).

## Round 1's findings

1. A chat never shows the pictures it made: **fixed.** Each studio call is a card with its pictures, Before and after
   and Download, no id or path (my real-model turn on the app build; the e2e counts them in the window on every build).
   They sit under DSH's fold (finding 6).
2. A settings save during a page job broke its record: **fixed.** By hand: DSH's log "is still running (the page was
   set up again); it is followed, not cut off", Rerun and Hide answered 409 in words, one studio edit, then done in
   76.2 s. The e2e has the same step.
3. Switched off, the open chat still took a turn: **fixed.** Each studio call now refuses in words and nothing reaches
   the studio; README describes both of DSH's paths; the e2e checks both (picture `e2e-app-off-open-chat-light`). By
   hand: off removed the entry, the endpoints (404) and the sheet, and a new DNA Studio chat was refused ("Unknown agent
   preset: dna-studio"); on brought back one entry, one sheet and all jobs.
4. The sentence reader missed common sentences: **fixed** for the three named (finding 5 has what is left).
5. The Plugins page showed a package name and a generic icon: **fixed** (picture 15).
6. The studio-down note promised waiting: **fixed** (pictures 19, 20).
7. Docs said settings apply at the next start: **fixed.**
8. "Cut off by a restart" after a save: **fixed** (the job is followed; a runner that vanished in the same DSH reads
   "stopped before it finished").
9. Nits: **fixed**: buttons under each picture, the ring round the whole photo, the select's options in DSH's colors,
   the page id `dsh-plugin-dna-studio:page`, a cheap version poll, and ids only from this chat.
10. Test gaps: **fixed**: `studio_material`, `studio_compare`, regions, print, fabric and swatch edits in unit tests;
    the page's fabric photo and a save during a job in the e2e.

## What would make it a 9.5

- Generate always reachable: the one-column rule after the sticky rule, the form sticky only when it fits, and an e2e
  check with a photo and a long gallery at 1280 x 900 and 760 px.
- Result files that never share a name, with a unit test for two calls in one second.
- A wrong `backendUrl` that stops studio calls with a note instead of pointing them at the production studio.
- An e2e that passes the first time on a busy Mac (dismiss DSH's notices before each window step; match the right
  request body).
- The reader saying "there is no hat in this photo" instead of changing the top.

What I could not check: more real-model turns (the gateway answered with DeepSeek-V4.1-Flash-1017), so the other tools,
a restart under a chat turn and the open chat while off are proven by the e2e's scripted model on three builds, not by
hand; the real studio (by rule); `scripts/install-live.sh` on a real profile (its unit test only); the rollback to 0.3.0
(not repeated). The stand-in studio's process ended while the judge was stopped (9:03 to 11:37 PM); the instance was
left pointed at that dead loopback port, and nothing else was called.

## Live DSH fingerprint (before and after)

- Before (8:38 PM PDT): pid 64099, started Mon Oct 26 15:35:11 2026, `cordis.patch.yml` sha256
  535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be (private copy in my judge folder).
- The e2e's own lines (8:39 to 8:56 PM, 8:57 to 9:03 PM): unchanged. 8:53 PM, after my instance's restart: the same.
- 11:38 PM PDT, after the pause: the same pid, start time and sha.
- After (11:48 PM PDT, with my stand-in studio stopped, my instance destroyed and the slot given back): pid 64099,
  started Mon Oct 26 15:35:11 2026, sha256 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be.
  Unchanged; the sha never moved while I judged.
- Every picture was taken by the harness's `shot()` of my own Playwright pages on my DSH Test instance; nothing
  captured the owner's screen.
