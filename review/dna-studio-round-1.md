# DNA Studio: judge round 1

Commit cdac02e, judged 2026-10-26, 10:24 AM to 1:53 PM PDT (paused 11:00 AM to 1:37 PM by the account's usage limit). DSH Test instance g95-dna-studio-j1 (installed app, DSH 0.2.1-rc.3: the same DeepSeek Harness app the live DSH runs), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8 | The page does the whole job well (colorways, fabric photo, prints, views, before/after, Download, Rerun), but a chat never shows the pictures it made, and the sentence reader misreads accessories and "X and Y". |
| Reliability | 8.5 | Studio down, failing, restart, off/on and wrong settings are handled in words; but saving its own settings row while a page job runs marks the job "cut off by a restart", lets Rerun run it twice and hides the finished result. |
| UX / polish | 8.5 | The page is calm, keyboard-ringed, light/dark and 420 px clean; the chat shows raw JSON and a file path instead of a picture, and the Plugins page shows a package name, a generic icon and a cut-off description. |
| Test depth | 8.5 | 33 unit tests and 100 real-window checks on three DSH builds, but the "result shown in the chat" and "off" checks pass without looking at what the owner sees, there is no live settings save, and four tool paths are never run. |
| Docs | 8 | A full, honest-looking README, but three of its claims are wrong in the window: settings apply at the next start, results come back into the chat as images, and DSH refuses an open chat's turn when the plugin is off. |

Plugin score: min(U, R, mean) = min(8, 8.5, 8.3) = 8. Verdict: NOT YET.

## What I ran

- Extracted commit cdac02e to my judge folder (`head`), and 0.3.0 (2834ff1) beside it for the rollback check. Read README, HANDOFF, every file in `lib/`, the tests and DESIGN.md.
- `npm test`: 33 of 33 pass, offline.
- With a slot: `node scripts/e2e.mjs`: 300 of 300 checks pass (100 each on DSH 0.2.0-rc.2, 0.2.1-rc.1 and the app's 0.2.1-rc.3); its live-DSH fingerprint line reads unchanged before and after.
- My DSH Test instance with only this plugin, its row pointed at the stand-in studio from `test/e2e/fake-studio.mjs` on 127.0.0.1:18879 (started by the judge, stopped by its own pid). Nothing was pointed at the real studio.
- The page in a real window, as the owner: empty; the sentence reader on hard sentences; colorways; a fabric photo; a print in 2 versions and Rerun; two views; a 4000 by 5333 photo (sent as 2250 by 3000); before/after and Escape; Download (file `DNA-Studio-blouse-color-navy-result-1.jpg`); every Tab stop; Hide and Show; 760 and 420 px; light and dark; the studio off, failing and back with Rerun.
- The DNA Studio agent with the real model in the window: a dropped photo and "make the blouse sage" (studio_edit, done); "keep that and also make the background warm white" (studio_background on the result id, made from the full-size gallery file: sage blouse and warm white background in one picture); a third turn typed while the plugin was switched off (below).
- Settings: wrong values (`timeoutMs: soon`, an unknown key) saved in my test profile's row, without a restart; then a valid value; then put back. Saves of other rows (a comment, the session-bridge row) as a control.
- A page job held by the stand-in studio while I saved the plugin's row, once through the page's API (with Rerun pressed during it) and once in the window.
- The Plugins page switch off and on in the window, with the DNA Studio chat open.
- Counted the pictures in the chat window, with every turn and tool call opened.
- Rollback: 0.3.0's page code on a copy of my jobs folder.

## What I saw (each picture, one line)

Pictures are in `review/dna-studio-round-1/`; the e2e ones come from the app build run.

- `01-page-empty-light/dark`: the empty page, a clear title, one sentence, and "Your results show up here".
- `02-page-colorways-light/dark`: one photo, items Blouse, Pants, Shoes, Background; "the blouse in sage, navy and camel" gives three labeled results beside the Before.
- `03-page-fabric-photo-light`: "make the pants like this fabric" with a swatch: the pants take the fabric, the rest as shot.
- `04-page-print-2-versions-light`: small white polka dots on navy in 2 versions, with Rerun.
- `05-page-two-views-light`: front and back views, the same camel pants on both.
- `06-before-after-light/dark` (e2e): the before/after dialog with the drag line, "Only the blouse changed", Edit this and Download.
- `07-page-hidden-shown-light`: a hidden job back on screen with "Show in gallery".
- `08-waiting-working-dark` (e2e): a running job, "Working… 3 s", the result tile waiting.
- `09-error-studio-down-light/dark`: "Not changed: The studio at 127.0.0.1:18879 is not reachable. The 4090 may be off or in Windows." with Rerun, and the items note with Retry.
- `10-error-studio-failing-light`: the studio's own reason in one line ("CUDA out of memory").
- `11-studio-back-rerun-light`: Rerun with the studio back: done.
- `12-cut-off-by-restart-light` (e2e): after a real restart, "Cut off by a restart" with the reason and Rerun.
- `13-settings-wrong-light/dark` (e2e): the page says which settings are wrong and what it uses instead.
- `14-narrow-760/420-light/dark`: one column, nothing scrolls sideways (page 364 of 364 px at 420).
- `15-bug-setting-saved-during-job-light`: a running job, seconds after a setting was saved: "Cut off by a restart … DSH stopped while this ran" while the studio is still working on it and DSH never stopped.
- `16-bug-finished-job-still-cut-off-light`: the same card after the studio finished the job (log: "done: 1 result(s)"): still "Not changed … Press Rerun".
- `17-chat-waiting-light`: the DNA Studio chat waiting on the model ("Deep diving for 20s").
- `18-chat-no-result-pictures-light/dark`: three studio results made in this chat, and not one picture in the conversation: only the replies' text.
- `19-chat-tool-card-json-and-path-light`: the opened tool call: the result as JSON (`attachmentId`, `mediaType`, `width`…) and an absolute file path, no picture.
- `20-switched-off-plugins-light`: switched off: the entry is gone from the sidebar.
- `21-switched-off-open-chat-takes-turn-light`: while off, the open DNA Studio chat accepted "make the blouse red" and started the model; the agent shows as `dna-studio`.
- `22-switched-on-page-light`: on again: one entry, one style sheet, the page with all its jobs.
- `23-plugins-page-name-icon-light/dark`: the Plugins page lists `dsh-plugin-dna-studio`, a generic icon and a description cut off at "prin…".

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Major: a chat never shows the pictures it made.** Where: `lib/client.js` registers only `main` and `sidebar.panellist`; `lib/tools.js` returns the results as image blocks plus "Files: <absolute path>"; README "Results come back into the chat as images" and "which is how the chat shows it". What: in the window (the owner's DSH build), three real studio calls in one chat put no result picture in the conversation; with every turn and tool call opened, the only picture is the owner's own photo, and the tool card shows the images as JSON and the file's absolute path (pictures 18, 19). To see what the agent made, the owner has to find `~/.dsh/dna-studio/<session>/` in Finder. The e2e check "the result is shown in the chat" only checks the attachment store and the session log. Fix: register keyed `tool.call.toolview` entries for the seven studio tools (DSH's own skill and tool packages use this slot; the owner's build has it) that draw each result picture with Before/After and Download, and keep ids and paths out of the shown text; make the e2e count the result pictures in the chat window.
2. **Major: saving the plugin's settings while a page job runs breaks that job's record.** Where: `lib/panel.js` `createPanel` marks every `running` job "cut off" at load (lines 291 to 301) and keeps jobs in a per-instance map (line 284); DSH re-runs `apply` on every save of the row, while the old instance's `runJob` keeps going. What: job `20261026203857-6f867d` held by the stand-in; I saved a valid `timeoutMs: 600000`; within seconds the page said "Cut off by a restart" and DSH's log "was cut off by a restart" (same DSH pid, no restart); Rerun was accepted and the studio ran two edits at once for one request (on the 4090 that is a second 20 GB job); both finished, `job.json` says done, but the page kept showing "Not changed … Press Rerun" until the next re-apply (pictures 15, 16; also the first test, `20261026174946-9f3d4e`). By the code, Hide on that stale card would write the stale "error" over the finished record. Saves of other rows did not re-apply the plugin. Fix: keep running jobs in a registry that outlives a re-apply (on `globalThis`) and let the new instance adopt them, or mark a job cut off only when it was started by another DSH process (store a boot id in `job.json`); re-read a job's `job.json` when the page asks for it; refuse Rerun and Hide while any instance still runs that job; add an e2e step "save a setting while a job runs".
3. **Minor: switched off, the open DNA Studio chat still takes a turn.** Where: README's failure table and "Switching off" section; `test/e2e/run.mjs` off step. What: README says DSH "refuses that chat's next turn"; in the window it accepted "make the blouse red" and the model ran (picture 21). The model was slow, answered after I switched the plugin on again, and its studio_edit then worked; the stand-in studio got no call while the plugin was off. The e2e tests only the bridge route (409 "resume failed") and its check passes either way ("refused, or no studio tool is offered"). Fix: test the open chat in the window with the scripted model; say in README what the owner really sees.
4. **Minor: the sentence reader misses common sentences.** Where: `lib/panel.js` `plan()` and its noun list. What: on a photo whose items are Blouse, Pants, Shoes, Background: "make the shoes black" reads "Will change top: color → black (no garment named: the top…)"; "make the shirt and pants black" is refused ("I could not tell what to do with the shirt"); "change the dress to red, keep the background" asks for a background color. Fix: match the sentence's nouns against the photo's own item names first, split "X and Y <change>" into two changes, and read "keep the background" as no background change.
5. **Minor: the Plugins page does not present DNA Studio as DSH presents its own.** Where: `package.json` (no `icon`), no `locale/en.json`. What: the name `dsh-plugin-dna-studio`, a generic icon, and a two-sentence description cut at "prin…" (picture 23; DESIGN.md §9 asks for a title, one plain sentence and a 36 by 36 icon). Fix: add `locale/en.json` meta (title "DNA Studio", one sentence) and `"icon": "./icon.svg"`.
6. **Minor: the studio-down note promises waiting that does not happen.** Where: `lib/client.js` line 455. What: "Changes wait until it answers; this page checks again every 30 s", but Generate fails at once with "Not changed" (picture 09). Fix: "Generate fails until the studio answers; a failed job keeps Rerun", or queue for real.
7. **Minor (docs): "a change applies at DSH's next start" is wrong.** Where: README "Settings" paragraph. What: saving the row applied at once (the `[dna-studio] setting:` lines and "page ready" within seconds, health listing the problems, same DSH pid); the page's own note says "DSH applies it when you save". Fix: say a save applies within seconds, and what it does to a running job (until finding 2 is fixed: wait for jobs to finish).
8. **Nit: wording after a re-apply.** "Cut off by a restart" and "DSH stopped while this ran" are shown when DSH did not stop. Fix: comes with finding 2.
9. **Nit: small page and design points.** The compare, Edit and Download buttons always cover the bottom of each result picture; in before/after the focus ring is drawn only around the After half; `.dna-select option { color: #111 }` is a fixed color; slot ids are not `<package>:<name>`; while a job runs the page fetches the whole jobs list every 2.5 s (DESIGN: poll a cheap version number); a tool takes any image id in DSH's attachment store, not only "from this chat" as README says.
10. **Test gaps.** `studio_material` is never called in any test; `studio_compare` is tested only for refusals; colorways by region, and studio_edit with a print, a fabric or a swatch are not in the tools tests; the page's fabric-photo job is not in the e2e; no test saves a setting while DSH runs.

What I could not check: the real studio (by rule); `studio_colorways`, `studio_material`, `studio_compare` and `studio_gallery` with the real model (they pass with the e2e's scripted model or in unit tests); `scripts/install-live.sh` against a real profile (only `test/install.test.mjs`). A DSH restart under a running job and a chat call I took from the e2e run (checks 78 to 85 on each build), not again by hand. Rollback passed: 0.3.0's page lists all 12 jobs this version wrote (10 done, 2 failed) and serves a two-view job's photos and results.

## What would make it a 9.5

- Pictures in the chat: a tool view per studio tool that shows each result (Before/After, Download), no JSON or paths where the owner reads, and an e2e check that counts them in the window.
- A settings save or off/on during a page job leaves the job running and its result on the page; Rerun and Hide wait for it; an e2e step proves it.
- README says what really happens: settings apply on save; an open chat while off; the chat's pictures.
- The sentence reader takes the photo's own item names (shoes, bag, belt), "the shirt and pants black", and "keep the background".
- Plugins page: "DNA Studio", one sentence, its own icon.
- The studio-down note says what Generate does while the studio is away.
- Tests for `studio_material`, `studio_compare` success, colorways by region, edit with print, fabric and swatch, and the page's fabric-photo job.

## Live DSH fingerprint (before and after)

- Before (10:24 AM PDT): pid 43210, started Mon Oct 26 07:14:47 2026, cordis.patch.yml sha256 f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55.
- At resume (1:37 PM PDT): the same pid, start time and sha.
- After (1:52 PM PDT, with the stand-in studio stopped, the instance destroyed and the slot given back): pid 43210, started Mon Oct 26 07:14:47 2026, sha256 f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55. Unchanged.
- Every picture was taken by the harness's `shot()` of my own DSH Test pages; nothing captured the owner's screen.
