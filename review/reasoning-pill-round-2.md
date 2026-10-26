# Reasoning Pill: judge round 2

Commit d24800a (branch `goal95/reasoning-pill`), judged Mon 2026-10-26, 2:27 to 3:20 PM PDT. DSH Test instance g95-reasoning-pill-j2 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3.

Brief: the plugin's README, Albert's ask (item 9 of `docs/NEXT-2026-10-08-bug-batch.md`: keep the Reasoning pill beside the model name, hide the Effort row inside DSH's model menu, picking a model must keep working), and the job: one control beside DSH's model button to see and change the session's reasoning effort, in place of DSH's hidden Effort row, for a person who switches effort all day on local models. This is the plugin's last round; the judge formed this view before reading round 1's scorecard.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.5 | All of item 9 and the README's job: the level in force is always in view, two clicks change it, each chat keeps its own, every pick reaches the model's request (real model: low, max), DSH's Effort row and caption are gone and model picking still works; the one catch, every pick also becoming the new-chat default, is DSH's rule for the row it replaces and is documented. |
| Reliability | 9.5 | The judge could not make it do a wrong thing: second clicks, outside clicks, picks then instant chat switches, picks during a running turn, Escape during a turn, a host restart under a turn, two DSH hosts on one session, the model removed under an open menu, off and on from the Plugins page; nothing repeated, nothing lost, no plugin error on three builds. |
| UX / polish | 9.5 | Looks and behaves like DSH's model button in light, dark, 760 px and icon-only; the menu opens above like DSH's, the keyboard and screen-reader path is complete, refusals are DSH's banner in plain words with a next step; only nits left (banner centred on the window, not the composer; the inert None and model-gone states differ from the live control only by the missing chevron). |
| Test depth | 9.5 | 27 unit and 70 real-DSH checks a build, passing twice on all three builds with no retry, prove the claims where they land (the model's request, the session's log, DSH's profile, geometry, focus, typing, contrast); the only gaps are the "session in use" and "model gone" refusals and the model-gone state, proved offline only (the judge proved them on real DSH). |
| Docs | 9.5 | The README is complete (job, keyboard, config, off/remove/roll back, DSH Test, tests and pictures, DSH's own look, limits, files) and every line the judge checked matches the code and the window; nits: the control's own words are English only and the Limits don't say so, and the branch's HANDOFF section is stale. |

Plugin score: min(U, R, mean) = min(9.5, 9.5, 9.5) = 9.5. Verdict: PASS.

## What I ran

- **Head.** `git archive d24800a` into `~/Projects/goal95/judge/reasoning-pill-r2/head` with the `.e2e` link. Read the README, `lib/client.js` (all 329 lines), `lib/index.js`, `locale/en.json`, `package.json`, `cordis.patch.yml`, the unit test, `test/e2e/run.mjs` and its scripted model, `DESIGN.md` (all), items 8 and 9 of the bug batch, `scripts/uninstall.sh`, `scripts/e2e.mjs`, and the five commits since round 1 (`9d7ffee`, `1f80498`, `83332a1`, `f4ae5f7`, `d24800a`; only this plugin's folder changed).
- **Offline.** `node plugins/reasoning-pill/test/unit.test.mjs`: 27 passed. `node --check` on both halves: OK. `node scripts/check-wording.mjs`: hits only in `docs/` history notes and Fleet's captured fixtures, none in this plugin (its unit test carries its own naming scan and passes).
- **Real DSH, the builder's bench.** `node scripts/e2e.mjs reasoning-pill`, twice: 70 passed, 0 failed on 0.2.0-rc.2, 0.2.1-rc.1 and the app's 0.2.1-rc.3 both times (88/86/135 s, then 64/67/121 s). Its menu re-open guard (`pickLevel`, which logs "the menu went before the pick") never fired. Its fingerprint check: unchanged both times.
- **DSH Test.** Memory slot taken, `up` (ready in 2.2 s), `load` of this plugin only with no config keys, `restart`, `doctor` (0 import errors, isolation ok). A headless window of my own on the instance (the sign-in link read by script, never printed or written). Every chat set to Workspace Write before its first turn. Two model rows added to my instance's own profile to make the edge states: a model without levels, and a second model later removed so a chat's model goes missing. With the real model:
  - New chat, Low picked, then "Reply with exactly the word pong-low": the session log's `model/selection` and the turn's `request/header` carry `reasoningEffort: "low"`; the turn completed. Medium picked while that turn ran: recorded as a selection after the request went out, so the running turn kept low and the control read Medium.
  - A second chat in a throwaway workspace at Max: the request header carries `"max"`.
  - The owner gateway answered both requests from `DeepSeek-V4.1-Flash-1017` (the logs' `responseModel`) though GLM-5.3-Flash-EXL3 was selected, so I sent no more real turns. The level DSH sent is in DSH's own request header either way.
  - Pointer and keyboard in an open chat: the menu opens above the control (light, dark, 760 px); a second click closes it with nothing picked; a click in the message box closes it and the typing lands; DSH's model button opens on the first click; Enter, Space, the arrows and Escape work and the focus ring shows.
  - Chats: a pick followed at once by a click on another chat stays with the chat it was made in (Xhigh in one, Low in the other, each read back on switching).
  - A new chat, the control clicked as soon as it shows after "New Session" (5 times): the menu stays open every time.
  - A model without levels: "Reasoning: None", `aria-disabled`, opens nothing, the tooltip and name say why.
  - The chat's model removed from the profile, once with the menu open: the menu closes, DSH's button reads "Select model", the control keeps the chat's level with no chevron, and its tooltip says to pick a model with the model button.
  - Off and on from DSH's Plugins page: off leaves no control, no style sheet and no mark, and DSH's caption and Effort row come back; on brings one control with the chat's level, one style sheet, and the Effort row hidden again.
  - A DSH Test restart left DSH's window blank (picture); a reload brought it back with the level in force.
- **The judge's own real-DSH runs** (throwaway homes through the bench's `DshRun`, scripted models; scripts in the judge's scratch folder, not in the repo):
  - `inuse.mjs`, on 0.2.0-rc.2 and the app's 0.2.1-rc.3: two DSH hosts on one home with the same chat open in both. A pick in the second: DSH's banner "Reasoning not changed: This session is already in use, possibly by another running DSH instance (such as dsh web or the desktop app). Quit other running DSH instances and try again.", the control keeps Default with its warning mark and the same words in its name. A pick in the first: Max, no banner. No plugin errors.
  - `escape.mjs`, app DSH: a slowly streaming turn. Escape on the control's menu (opened by pointer, then by keyboard) and on DSH's model menu: the turn keeps running each time and the focus is back on the control; a pick of High mid-turn leaves the running turn alone (its request carried no effort) and the turn completes.
  - `restart.mjs`, app DSH: High picked during a running turn, then DSH's host stopped and started. DSH closed the turn as interrupted; after a reload the control reads High, the log holds one selection (nothing repeated), and the next turn went out at `high`. The window went blank after reconnecting; the same run with the plugin off went blank 2 of 2 times.
  - `blank.mjs`, app DSH, three host restarts each way: 1 of 3 reconnected with the plugin off, 1 of 3 with it on, with the same DSH errors. The blank window is DSH's.
  - `quick.mjs`, 0.2.0-rc.2 (the builder's weak point): the control clicked right after "New session", six times. Five clicks at 0.8 to 0.9 s: the menu stays open. One click 29 ms after "New session", before DSH had switched chats: it landed on the chat being left, and the menu went with the chat change, which is the right outcome (a level picked there must not land in the new chat); no person clicks that fast. DSH's model menu, clicked the same way: open 6 of 6.
- **DESIGN.md "Before you push", for this plugin's UI.** [x] no ground of its own (checked by the bench; only DSH's hover and open fill); [x] only DSH tokens (`--dsw-*`, `--ds-*`, `--dsh-composer-*`) and only `body.wp-still` from Wallpaper; [x] no DSH hash (`[class*="_triggerEffort"]`, `[class*="_cellLabel"]`), nothing on `:root`, `html` or `body`, its one `:has()` is on the composer bar; [x] motion stops under `wp-still` and reduced motion; [x] `node --check` and the plugin's tests pass; [x] both DSH versions and both themes (Wallpaper on was checked in round 1 and the control's ground has not changed since; this round loaded only this plugin, as the brief says); [x] off leaves nothing, on repeats nothing.

### The builder's notes, checked

- 27 unit checks: 27 passed. 70/70 real-DSH on 0.2.0-rc.2, 0.2.1-rc.1 and the app's 0.2.1-rc.3: 70/70 on all three, twice.
- "A pick within about 1 s of opening a new chat on 0.2.0-rc.2 once lost the menu": not reproduced at a person's speed (5 of 5 at 0.8 to 0.9 s on 0.2.0-rc.2, 5 of 5 in DSH Test); only a 29 ms click, before the chat switched, opened nothing that stayed.
- "Session in use" and "model gone" wordings unit-tested only: true; both proved on real DSH by the judge (above).
- No real-model check: the judge's two real turns carried the picked levels (with the gateway caveat above).
- DSH's banner at the top, not over the composer: true; DESIGN.md asks for DSH's Toast without an anchor (finding 2).
- The app's DSH sometimes leaves its window blank after a host restart: true, and it does so with the plugin off too.

## What I saw (each picture, one line)

In `review/reasoning-pill-round-2/`:

- `dshtest-new-chat-light.png`: the new-chat composer: "Reasoning: High" (the new-chat default) just before "GLM-5.3-Flash-EXL3 (DSH Test)"; the seed's Full access shown here was switched to Workspace Write before any turn.
- `dshtest-new-chat-menu-open-light.png`: the menu opens above the control, Default to Max, DSH's check on High; nothing of the composer covered.
- `dshtest-pick-during-running-turn-light.png`: a real turn still running at low ("Deep diving for 1m 23s"), the control already reads Medium for the next turn.
- `dshtest-chat-after-low-turn-light.png`: the finished low turn ("pong-low"), the control reads Medium.
- `dshtest-chat-max-light.png`, `dshtest-chat-max-dark.png`: an open chat after its Max turn: "Reasoning: Max" beside the model button, matching it in both themes.
- `dshtest-chat-menu-open-light.png`, `dshtest-chat-menu-open-dark.png`: an open chat, the menu above the control (Default checked in light, Max in dark), clear of the control and the status line.
- `dshtest-no-levels-light.png`: "Reasoning: None", no chevron, beside "Plain test model (no levels)".
- `dshtest-model-gone-light.png`: the chat's model gone from the list: DSH's "Select model", the control keeps "Reasoning: High" with no chevron.
- `dshtest-model-removed-while-menu-open-light.png`: the same after the model went while the menu was open: the menu has closed.
- `dshtest-narrow-760-light.png`: 760 px: the control fits on the composer's line, no sideways scroll.
- `dshtest-narrow-760-menu-dark.png`: 760 px in dark: the menu above the control.
- `dshtest-narrow-760-focus-ring-light.png`: 760 px with keyboard focus on the control: DSH's blue focus ring.
- `dshtest-off-dsh-model-menu-light.png`: the plugin off from the Plugins page: DSH's menu shows Model and Effort (Default) and the "Default" caption is back on the model button.
- `dshtest-plugins-page-light.png`: DSH's Plugins page lists "Reasoning pill" with its icon and description, on.
- `dshtest-after-host-restart-light.png`: DSH Test's window blank after a restart (DSH's; see the control runs).
- `app-e2e-chat-menu-open-dark.png`: the bench on the app's DSH: an open chat in dark, the menu (Default, High, Max) above the control.
- `app-e2e-dsh-model-menu-effort-hidden-light.png`: DSH's model menu with only the Model row; the control reads "Reasoning: Low".
- `app-e2e-compact-500-light.png`: the icon-only composer at 500 px: the control's gauge beside DSH's model icon.
- `app-e2e-subagent-chat-light.png`: a subagent's chat: no model button from DSH and no control.
- `app-e2e-host-gone-refused-light.png`: DSH's host gone ("Reconnecting…"): DSH's banner "Reasoning not changed: DSH isn't reachable. Try again when it reconnects.", and the control keeps Max with its warning mark.
- `app-session-in-use-refused-light.png`, `v020-session-in-use-refused-light.png`: a chat held by another DSH, on the app's 0.2.1-rc.3 and on 0.2.0-rc.2: DSH's banner with DSH's own "already in use" sentence; the control keeps Default with its warning mark.
- `app-escape-running-turn-light.png`: a turn still streaming after Escape on both menus; the control reads High (picked mid-turn).
- `app-after-restart-under-turn-light.png`: after a host restart under a running turn: DSH's "Task stopped" note, and the control reads High, the level picked before the restart.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

No blocker, major or minor findings. Nits:

1. **Nit (test depth): three documented behaviours have no real-DSH check.**
   Where: `test/e2e/run.mjs`.
   What: the "session in use" refusal (DSH's own sentence), the "model gone" refusal, and the model-gone state (level kept, no chevron, tooltip says to pick a model) are checked only in the unit test, against error objects and snapshots the test makes up. If a DSH update renamed `session/writer-held` or changed `routable`, the bench would still pass. The judge proved all three on real DSH (two builds for the first).
   Fix: add two blocks to the bench: a second `DshRun` on the first one's home with the same chat open and a pick in each (the judge's `inuse.mjs`, about 40 lines on the same harness), and the chat's model removed from the profile (with the menu open once), checking the banner's words, the mark, the tooltip, and that nothing reached the session's log.

2. **Nit (UX): the refusal banner is centred on the window, DSH's own on the composer.**
   Where: `lib/client.js`, the `ui.Toast` call (no `anchor`).
   What: DSH's model button anchors its refusal banner to the composer card, so it sits top-centre above the chat column; this plugin's banner sits top-centre of the whole window, about 140 px to the left at 1280 px. DESIGN.md says "Toasts are DSH's ui.Toast without an anchor", so the plugin follows the house rule.
   Fix: none needed under DESIGN.md as written. If the owner wants refusals to line up with DSH's own, add one line to DESIGN.md allowing the composer card as anchor for composer controls, then pass it.

3. **Nit (UX): the inert states look like the live control minus the chevron.**
   Where: `lib/client.js`, the style sheet's `.rp-trigger` rules.
   What: "Reasoning: None" and the model-gone state use the same label colour as a control that opens; only the missing chevron (and the tooltip) says a click does nothing.
   Fix: give `.rp-trigger[aria-disabled="true"]:not([aria-busy])` DSH's secondary label colour (`--dsw-alias-label-secondary`), so "nothing to open" reads at a glance, and keep the tooltip.

4. **Nit (bench): the menu re-open guard could hide a regression.**
   Where: `test/e2e/run.mjs`, `pickLevel`.
   What: when the menu goes before a pick, the bench reopens it (up to three tries) and only logs it. It never fired in six build runs, but a regression that loses the menu once per pick would pass.
   Fix: count the re-opens and print the count in each build's summary line, or fail when there is more than one per build.

5. **Nit (docs): the control's own words are English only.**
   Where: README, Limits; `locale/en.json`.
   What: the Limits cover DSH's Effort label in two languages but not that "Reasoning:", the level names it adds ("Default", "None") and the refusal sentences are English in a Chinese DSH.
   Fix: one Limits line (or a `zh` locale later).

6. **Nit (repo): the branch's HANDOFF section is stale.**
   Where: `HANDOFF.md`, "GOAL95: Reasoning pill".
   What: "Updated 9:36 AM", "24 checks", "50 a build", "Next: a fresh judge scores it"; round 1's result, the five fix commits and the weak points the builder reported are not in it. The repo's own rule is that state lives there, not in a chat.
   Fix: update the section (27 unit, 70 a build, round 1's findings and their fixes, the known weak points, the next step).

For the owner, not counted against the plugin:

- Every pick is also saved as DSH's default for new chats. That is DSH's rule for its own Effort row too, the README says so and the bench checks it. For someone who switches effort all day, a one-off Max makes the next new chat Max as well, while item 8 of the bug batch wants the default kept at GLM-5.3-Flash-EXL3 at high. Keeping it as DSH does, or restoring the default after a pick (as the fix runner does after its own picks), is Albert's call.
- With the Effort row hidden, DSH's model menu holds a single "Model" row. That is DSH's menu, and DESIGN.md does not let a plugin rearrange it.

## Round 1's findings

1. Major, the menu covers its control and a second click picks a level: **fixed.** `ui.Menu` gets `side: "top"`; the bench checks the menu sits above the control and the status line in light and dark, and that a second click closes it with no new selection in the session's log; the judge saw the same in DSH Test (light, dark, 760 px) and on the app's DSH.
2. Major, closing by a click elsewhere sends the focus back to the control: **fixed.** Closing only closes; the bench checks that the focus stays in the message box, the typing lands, and DSH's model button opens on the first click; the judge saw the same in DSH Test, and Escape still returns the focus to the control.
3. Minor, refusals show raw text, cut short, for 8 s: **fixed.** Plain words with a next step, DSH's own sentence for a session in use, the raw reason only in the console, DSH's banner (role alert, held 5 to 12 s by length), and the warning mark with the same words in the control's name and tooltip until the next pick, another chat or DSH clearing the error. The real-DSH check covers the host-gone words; the other two wordings are unit-tested (finding 1) and the judge proved them on real DSH.
4. Minor, two README lines are wrong: **fixed.** The README now says DSH's banner at the top with plain words, and the removal line names `scripts/uninstall.sh reasoning-pill`, says it refuses while DSH runs and that with no name it removes all three plugins.
5. Minor, the bench misses the paths where the bugs were: **fixed.** It now opens the menu in an open chat, clicks outside it and types, clicks the control twice, opens DSH's model menu beside it, switches chats, visits a subagent's chat and picks with DSH's host gone, on all three builds, with pictures of the open-chat menu in light and dark.

## What would make it a 9.5

It is at 9.5. What would take it higher:

- The bench covering the "session in use" and "model gone" refusals and the model-gone state on real DSH (finding 1), with those pictures in dark as well as light.
- The inert states greyed in DSH's way (finding 3), and the re-open guard counted (finding 4).
- The English-only words in the Limits and the HANDOFF section brought up to date (findings 5 and 6).

## Live DSH fingerprint (before and after)

- Before (2:27 PM PDT): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 `f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55`. A private copy of the live profile was taken into the judge's scratch folder; its sha256 is the same.
- During: unchanged at 2:53 PM PDT, and in the bench's own before/after reads around both `scripts/e2e.mjs` runs (pid 43210, started 07:14:47, patch `f240a78d8bd63d3f`).
- After (3:12 PM PDT, window driver stopped, instance destroyed, both memory slots given back, no throwaway home left): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 `f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55`. Unchanged, so there was nothing to diff.
