# Reasoning Pill: judge round 1

Commit c868e41 (branch `goal95/reasoning-pill`), judged Mon 2026-10-26, 9:53 to 10:40 AM PDT. DSH Test instance g95-reasoning-pill-j1a (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3.

Brief: the plugin's README, Albert's ask (item 9 of `docs/NEXT-2026-10-08-bug-batch.md`: keep the Reasoning pill beside the model name, hide the Effort row inside DSH's model menu, picking a model must keep working), and the job: one control beside DSH's model button to see and change the session's reasoning effort, for a person who switches effort all day on local models.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | Does all of item 9 and the README's job (level shown and changed per session, reaches the model, follows chat switches, Effort row hidden, Model row works), but in an open chat, where the day is spent, its menu covers the control and a second click changes the level by accident. |
| Reliability | 7.5 | Host loss, a restart under a running turn and off/on all fail safe, but two everyday pointer gestures go wrong: a second click on the control picked Xhigh unasked (session log seq 38; DSH kept it as the new-chat default), and a click in the message box with the menu open sends focus back to the control and drops what is typed. |
| UX / polish | 7.5 | Looks like DSH's own button in light, dark, 760 px, icon-only and over Wallpaper, with a good keyboard and screen-reader path, but in open chats its menu opens down over its own control and the status line (DSH's model menu beside it opens up), it takes focus back from where the person clicked, and refusals show raw text cut at 260 px. |
| Test depth | 8 | 24 unit and 50 real-DSH checks on three builds prove their claims at the model, the session log and the profile, but every menu check runs in the new-chat composer: none opens the menu in an open chat, clicks outside it, clicks the control twice or switches chats, which is where the judge's checks failed. |
| Docs | 8.5 | Clear and complete (job, keyboard, config, off/remove/roll back, DSH Test, tests, limits), but two claims are wrong: refusals are not "in DSH's words" (raw transport text), and the uninstall line says the script removes all three plugins when `scripts/uninstall.sh reasoning-pill` removes only this one. |

Plugin score: min(U, R, mean) = min(8.5, 7.5, 8.0) = 7.5. Verdict: NOT YET.

## What I ran

- **Head.** `git archive c868e41` into `~/Projects/goal95/judge/reasoning-pill-r1/head` with the `.e2e` link. Read the README, `lib/client.js`, `lib/index.js`, both tests, `DESIGN.md`, the bug batch (items 8 and 9) and `scripts/uninstall.sh`, and DSH's own model-selection client (how DSH words a refused pick).
- **Offline.** `node plugins/reasoning-pill/test/unit.test.mjs`: 24 passed. `node --check lib/client.js`: OK. `node scripts/check-wording.mjs`: hits only in `docs/` history notes and `plugins/fleet` files, none in `plugins/reasoning-pill`. The branch's commit messages carry no assistant names.
- **Real DSH, the builder's bench.** `node scripts/e2e.mjs reasoning-pill`: 50/50 on 0.2.0-rc.2 (43 s), 0.2.1-rc.1 (47 s) and the app's 0.2.1-rc.3 (43 s); its fingerprint check: unchanged.
- **DSH Test** (only this plugin loaded, no config): `up`, `load`, `restart`, `doctor` (0 import errors, isolation ok). A Playwright window on the instance's own window (the sign-in link read by script and never printed). Session "Judge pill one" in a throwaway workspace, set to Workspace Write (log seq 5, 10:05:51 AM) before any turn. With the real GLM-5.3-Flash-EXL3:
  - Low picked: turn 1's request went out with `reasoningEffort: "low"` (seq 23) and completed.
  - Medium picked: turn 2 went out with `"medium"` (seq 34); DSH Test restarted under it: DSH closed the turn as interrupted, the control read Medium after the reload, no selection was repeated.
  - With the menu open in that chat, a second click on the control to close it: the session log recorded a selection of `xhigh` (seq 38, 10:11:36 AM) and the control read Xhigh; nothing had been chosen.
  - A model without levels added to my instance's profile: "Reasoning: None", `aria-disabled`, opens nothing, says why in its tooltip and name. Then removed from the profile: DSH's button reads "Select model" and the control keeps the session's level and says to pick a model first.
  - High (seq 41), then Default (seq 43): turn 3's request went out with no `reasoningEffort` (seq 50) and completed at 10:29 AM (a slow shared lane, not the plugin).
  - Switched off and on from DSH's Plugins page: off, DSH's Effort row and caption come back; on, they are hidden again, one style sheet.
  - 760 px and 640 px (icon-only composer), light and dark; Tab goes Access, control, model; dark text contrast 9.25:1.
  - A click in the message box with the menu open: focus went back to the control (as below).
  - A blank window after a DSH Test restart without a reload also happens with the plugin off: DSH's, not the plugin's.
- **The judge's own real-DSH checks** (throwaway homes, the installed app's DSH 0.2.1-rc.3, a scripted model; scripts in the judge's scratch folder, not in the repo):
  - `judge-e2e.mjs`: click in the message box with the menu open (fails: focus on `.rp-trigger`; "abc def" typed, box empty, the menu reopened); click DSH's model button with the menu open (fails: DSH's menu does not open on the first click); the menu in an open chat (fails: menu 636 to 848 px covers the control at 793 to 821 px); the host stopped, then a pick (passes on the rerun in `judge-e2e2.mjs`: red line, the level stays; the first script had navigated away from the chat).
  - A subagent started by DSH's own `subagent` tool (the scripted model calls it): the child's chat has no model button and no control (picture; the script's DOM probe missed that composer, the picture settles it).
  - `judge-wallpaper.mjs`: Wallpaper and this plugin loaded together, as the live DSH runs them: the control's colour equals DSH's model button in light and dark, no errors.
  - `judge-switch.mjs`: 7/7. Chat A at Low and chat B at High; A, B, A shows each chat's own level; a turn after switching goes out at that chat's level (low, then high); a pick in A leaves B alone; a new chat starts at the last pick (DSH's rule, as the README says).
- **DESIGN.md "Before you push", for this plugin's UI:** [x] no ground of its own (only DSH's hover and open fill); [x] DSH tokens only, and only `body.wp-still` from Wallpaper; [x] no DSH hash (`[class*="_triggerEffort"]`, `[class*="_cellLabel"]`), nothing on `:root`, `html` or `body`, its one `:has()` is on the composer bar, not the session list; [x] motion stops under `wp-still` and reduced motion; [x] `node --check` and the plugin's tests pass; [x] both DSH versions, both themes, Wallpaper on and off; [x] off leaves nothing, on repeats nothing. Elsewhere in DESIGN.md, section 9 is missed twice: "When something closes, focus goes back where it was" (finding 2) and the Words rules for a refusal (finding 3).

## What I saw (each picture, one line)

In `review/reasoning-pill-round-1/`:

- `dshtest-newchat-menu-open-light.png`: the new chat; the menu opens below the control with Default to Max and DSH's check on High; nothing covered.
- `dshtest-dsh-model-menu-effort-row-hidden-light.png`: DSH's model menu (it opens above its button) shows only the Model row; the control reads "Reasoning: Low".
- `dshtest-off-dsh-effort-row-back-light.png`: the plugin off: DSH's menu shows Model and Effort (Low), and the "Low" caption is back on the model button.
- `dshtest-plugins-page-light.png`: DSH's Plugins page lists "Reasoning pill" with its icon and one-line description, on.
- `dshtest-chat-menu-covers-control-light.png`: an open chat on GLM: the menu opens down over its own control, the right of the message box and the status line; the Xhigh row sits where the control was.
- `dshtest-chat-menu-open-dark.png`: the same in dark, Medium checked, Xhigh over the control.
- `dshtest-after-restart-under-turn-light.png`: after the restart under turn 2: DSH's "Task stopped" note, and the control still reads Medium.
- `dshtest-chat-dark.png`: the same chat in dark; the control matches DSH's model button.
- `dshtest-no-levels-none-light.png`: "Reasoning: None" beside a model without levels.
- `dshtest-model-gone-light.png`: the session's model gone from the list: DSH shows "Select model", the control shows the session's level with no chevron.
- `dshtest-narrow-760-light.png`, `dshtest-narrow-760-dark.png`: 760 px; the control fits on the composer's line, no sideways scroll.
- `dshtest-narrow-760-menu-dark.png`: 760 px in dark: the menu again covers its control and the status line.
- `dshtest-compact-640-light.png`: the icon-only composer: the control shows its gauge beside DSH's model icon.
- `app-chat-menu-covers-control-light.png`: the app's DSH, an open chat: the menu (636 to 848 px) over the control (793 to 821 px).
- `app-host-gone-pick-refused-light.png`: the host stopped ("Reconnecting…"): the red line "Reasoning not changed: client api: session/…", cut, between the control and the model button; the control still reads Default.
- `app-parent-with-subagent-light.png`: a parent chat with one subagent; the control in the parent's composer.
- `app-subagent-chat-no-control-light.png`: the subagent's chat: no model button from DSH and no control.
- `app-with-wallpaper-chat-light.png`, `app-with-wallpaper-chat-dark.png`: with Wallpaper on: the control matches DSH's model button (in dark the pointer still rests on it, so it shows DSH's hover fill).
- `app-with-wallpaper-menu-covers-control-light.png`: with Wallpaper on, the menu again covers the control in an open chat.
- `app-chat-b-high-light.png`: chat B at High.
- `app-switch-back-to-chat-a-low-light.png`: back in chat A, the control reads Low.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Major: in an open chat the menu covers its own control, and a second click on the control picks a level.**
   Where: `lib/client.js`, `h(ui.Menu, { open, items, …, align: "end", portal: true, anchor: button, listClassName: "rp-menu" })`, with no `side`.
   What: DSH's Menu opens below its anchor by default and is clamped into the window. In an open chat the composer sits at the bottom, so the menu lands on top of the control, the right of the message box and the status line (app DSH: menu 636 to 848 px, control 793 to 821 px; the same in DSH Test in light, dark and at 760 px). Clicking the control again to close the menu, the usual gesture, clicks the row now under the pointer: in DSH Test the session log recorded `xhigh` (seq 38) while Medium was in force and nothing was chosen, the next turn would have gone out at Xhigh (slow on a local model), and DSH also kept it as the new-chat default. DSH's own model menu, next to it, opens above its button.
   Fix: pass `side: "top"` to `ui.Menu` (0.2.0-rc.2's Menu takes it and places a portal menu above its anchor; 0.2.1's composer pop-ups place themselves with the same `side: "top"`), so the menu opens upward like DSH's model menu and never covers its trigger. Add real-DSH checks in an open chat: the menu does not overlap the control or the status line, and a second click on the control closes the menu with no `model/selection` event in the session log.

2. **Major: closing the menu by clicking elsewhere sends the focus back to the control.**
   Where: `lib/client.js`, `const close = () => { setOpen(false); focusBack(); };`, passed to `ui.Menu` as `onClose`, which DSH calls on a pointer press outside the menu as well as on Escape.
   What: with the menu open, a click in the message box closes the menu and the focus then jumps back to the control, so what the person types does not land (app DSH: "abc def" typed, the box stayed empty, and the space reopened the menu). A click on DSH's model button with the menu open does not open DSH's menu; it takes a second click. DESIGN.md section 9: when something closes, focus goes back where it was, and here that is where the person clicked.
   Fix: let `onClose` only close. DSH's Menu already returns the focus itself on Escape (`refocusAnchor`) and after a pick when the focus would be lost (`refocusAfterSelection`), and on an outside press it rightly does not (read in 0.2.0-rc.2's Menu; the bench's existing focus checks will confirm the other builds); keep `focusBack` for the fallback menu only, or call it only when the focus is inside the menu or on `<body>` at close time. Add checks: with the menu open, click the message box and type, and the text lands; one click on DSH's model button opens its menu.

3. **Minor: a refusal shows raw transport text, cut short, for 8 seconds.**
   Where: `lib/client.js`, `failureText` (it shows `result.error.message`), `.rp-err { max-width: 260px; text-overflow: ellipsis }` and the 8-second timer.
   What: with DSH's host gone the line read "Reasoning not changed: client api: session/selectModel failed: Failed to fetch.", shown as "…client api: session/…" and gone after 8 s. For a session held by another DSH it would show DSH's raw message, where DSH's own model menu maps `session/writer-held` to its sentence "This session is already in use, possibly by another running DSH instance … Quit other running DSH instances and try again." DESIGN.md section 9: no tool names or raw server text, and a refusal says why and what to do next. The line also sits between the control and the model button and pushes the model button aside.
   Fix: map `session/writer-held` to DSH's sentence, a lost connection to "DSH isn't reachable. Try again when it reconnects.", and anything else to "DSH didn't take the change. Try again."; keep the raw text in the tooltip or the console. Let the line wrap (or carry the words in the control's tooltip and the alert) so it can be read, keep it until the next pick or the reconnect, and add a real-DSH check of the words.

4. **Minor: two README lines are wrong.**
   Where: README, "Says when it can't" ("says so in DSH's words") and "Switch it off, remove it, roll back" ("`scripts/uninstall.sh` removes all three plugins of this repo").
   What: refusals show DSH's transport text, not DSH's words (finding 3). `scripts/uninstall.sh reasoning-pill` removes only this plugin, and the script refuses while DSH runs; read literally, the line has someone remove Fleet and Wallpaper too. The Tests section also says each claim is checked where it lands, while the open-chat menu is not checked.
   Fix: correct both lines (`scripts/uninstall.sh reasoning-pill`, with DSH quit), and list the open-chat checks once they exist.

5. **Minor: the real-DSH bench misses the paths where the bugs are.**
   Where: `test/e2e/run.mjs`.
   What: every menu check runs in the new-chat composer, where the menu has room below. Nothing opens it in an open chat, clicks outside it, clicks the control twice, switches between chats, opens a subagent's chat or picks with the host gone (the last two are checked only in the unit test, against stand-ins). Findings 1 and 2 passed 150 checks unseen.
   Fix: add those checks. Each is a few lines on the existing bench: the judge's `judge-e2e.mjs` and `judge-switch.mjs`, and a scripted model that answers "E2E:spawn" with a call to DSH's `subagent` tool, show how.

## What would make it a 9.5

- Findings 1 and 2 fixed: the menu opens above the control as DSH's model menu does, a second click on the control closes it without a pick, and a click elsewhere leaves the focus where the person put it (DSH's model button opens in one click).
- Refusals in plain words with a next step, readable in full, and DSH's own sentence for a session in use.
- The README's refusal and uninstall lines corrected.
- The bench covering an open chat (menu placement, the second click, an outside click with typing), switching chats, a subagent's chat and a pick with the host gone, on all three builds, with pictures of the open-chat menu in light and dark.
- Then a judge who tries again to break it with the pointer and keyboard in an open chat should find only nits: everything else held up (per-session levels, the real model receiving each pick, a restart under a running turn, None and a model gone, off and on, narrow windows, Wallpaper, contrast).

## Live DSH fingerprint (before and after)

- Before (9:53 AM PDT): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 `f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55`.
- Before `up` (10:04 AM PDT): the same.
- The bench's own reads around `scripts/e2e.mjs`: pid 43210, started 07:14:47, patch `f240a78d8bd63d3f`, unchanged.
- After (10:29 AM PDT, instance destroyed, memory slots given back): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 `f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55`. Unchanged; the private copy of the live profile taken at the start has the same sha256, so there was nothing to diff.
