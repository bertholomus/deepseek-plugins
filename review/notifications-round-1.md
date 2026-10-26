# Notifications: judge round 1

Commit b7836d2 (branch `goal95/notifications`), judged Mon 2026-10-26, 10:41 AM to 1:50 PM PDT (stopped from 11:00 AM to 1:37 PM by the account's usage limit). DSH Test instance `g95-notifications-j1` (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 8.5 | The stack's one notification channel (the coordinator, Decisions, Agent Terminals, Autopilot and Fleet all call it); in the app a banner came in 2 s and Open chat opened the real chat; but news is dropped as "you were looking" whenever DSH's window is in front (owner away, or DSH just relaunched), and a click on a real banner is unproven. |
| Reliability | 8.0 | Never throws, every outcome logged in words, state 700/600 and written whole, live settings, wrong values named; but a second window that cannot show notifications takes the whole queue and drops it (proven beside the app's window), and an unknown key passes without a word. |
| UX / polish | 9.0 | DSH's own form, switches and buttons, every state in words, light and dark, 760 px, text contrast 4.5:1 or more; small slips: the log's change line reads as the opposite, "This DSH window" in a second window, kind switches look live while all is off. |
| Test depth | 8.5 | 42 unit tests and 52 real-DSH checks on three builds, all rerun green, contrast measured, contract tests against the coordinator's real code; but no real app window, banner or click, no two-window case, and the restart step uses an unfocused window, so it misses the relaunch case in finding 1. |
| Docs | 9.0 | A complete, honest README (config table, off, rollback, setup, tests, limits, "proven and untested"); three statements do not hold in the app: "shows after the restart", the two-window limit, and the change-line example. |

Plugin score: min(U, R, mean) = min(8.5, 8.0, 8.6) = 8.0. Verdict: **NOT YET** (the bar is 9.5 with no criterion below 9).

## What I ran

- **Head.** `git archive b7836d2` into `~/Projects/goal95/judge/notifications-r1/head`, `.e2e` linked.
- **Unit tests.** `npm test`: 882 tests, 878 pass, 0 fail (2 skipped, 2 todo, both other plugins' hold-outs). `node --test plugins/notifications/test/notifications.test.js`: 42 of 42.
- **Real-DSH tests.** `node scripts/e2e.mjs notifications`: 52 of 52 on 0.2.0-rc.2 (86 s), 0.2.1-rc.1 (74 s) and the app's 0.2.1-rc.3 (60 s); live DSH unchanged. I read every check. They prove what they name, with two limits: the window is Chromium on the web profile on every build (the app's build runs the host under the app's binary, so the host takes the Desktop path, but no app window is driven), and the system's notifications are a recorder whose `onclick` the test calls itself.
- **DSH Test, the installed app.** `up`, `load` of `plugins/notifications` and `test/e2e/caller`, `restart`, `doctor` (0 import errors, isolation ok). The instance's `defaultPreset` set to `workspace-write` before any turn. The plugin's log: `started (on; the Desktop app; sender now: window)`. Each notification was titled plainly "Judge test N"; only #1 and #5 reached the screen.
  1. With another app in front, #1 from the stand-in caller (`send.mjs`, kind `handback`) was taken and reported shown 2 s after it was sent (the system's show event).
  2. A live edit of the profile row, `notifyFleet: false`: applied with no restart (log `settings changed: “Fleet findings” (on; sender now: window)`); `--kind fleet` answered `off`, listed as “Fleet findings” is switched off.
  3. `notifyHandback: "no"`: the log warned in plain words, the page named the setting and the fix, and handbacks still went.
  4. A misspelled key, `notifyFleeet: true`: DSH reloaded the plugin (`started` again); nothing in the log or on the page named the key.
  5. A second window beside the app's: a Playwright Chromium on the instance's own link (its notification permission is `denied`). #3 (kind `finished`) was taken by that tab within 20 ms and dropped as "Notifications are blocked for DSH in this window's settings". The app's window, which can show it, never got it.
  6. The real model: `dsh-test prompt --workspace <throwaway folder>`; GLM-5.3-Flash-EXL3 answered in 566 s under Workspace Write ("The sky at dusk is orange."). #5 named that session; the app's window, in the background for hours, took it 50 s later and reported shown (the documented "up to about a minute"). Open chat on the page opened that chat.
  7. A restart with news waiting: #6 was queued, then `dsh-test restart`. The log kept it (`1 notification(s) still waiting for DSH's window from before the restart`). The relaunched window came to the front, and 1 s later #6 was "not shown: You were looking at DSH, so no notification was needed."
  8. `enabled: false` by a live edit: `off`, listed, and the page said how to switch it back on.
- **Read.** The README, DESIGN.md (whole), all of `lib/`, both test files, `send.mjs` and the caller. I also read the callers' wiring: the coordinator, Decisions, Agent Terminals and Autopilot here, and Fleet in the split-plugins checkout (read only). Read only too: the app's main-process code for its close button (it hides the window) and its `activate` handler.
- **DESIGN.md "Before you push"**, for its one surface (its page in Plugins): no ground of its own; every token it uses exists in 0.2.0-rc.2 and 0.2.1-rc.1; no DSH hash, nothing on `:root`/`html`/`body`, no `:has()`; motion rules for `wp-still` and reduced motion (it has no motion); `npm test` with the naming scan passes; both versions and both themes (in the e2e and here). Wallpaper was not checked: the page lives on DSH's own Plugins page, which Wallpaper leaves on the wall (DSH's own open question). Switched off, it leaves nothing (e2e).
- **Not checked.** A click on a real banner (I drove no desktop UI; finding 3), Focus or Do Not Disturb (the "not confirmed" path), the Linux and Windows command senders, DSH's `desktopRuntime` (no DSH here has it), and a real coordinator thread's handback with the real model. The coordinator's news contract is unit-tested against its real code (`noteNews`, `coordinatorNewsLine`).

## What I saw (each picture, one line)

In `review/notifications-round-1/`, from DSH Test with real data:

- `settings-top-light.png`, `settings-top-dark.png`: the page in Plugins, in DSH's own form. The master switch and six kinds, Fleet findings off (saved by a profile edit), the note on what a click does, and Save.
- `settings-recent-light.png`, `settings-recent-dark.png`: "A setting is wrong" for `notifyHandback: "no"` with the fix, Where they go now, This window (blocked, in the Playwright tab), the test row, and the recent list. Each entry has its time and a state word ("Shown", "Not shown") with the reason.
- `settings-test-blocked-light.png`: the test button in a blocked tab: "Not shown: Notifications are blocked for this site … Allow them there, then reload this page.", and the test is listed. The focused button shows no visible ring.
- `settings-switched-off-dark.png`: `enabled: false`: "Notifications are switched off. Switch on “Send system notifications” above and save to get them." The six kind switches still look on.
- `760-settings-top-light.png`, `760-settings-top-dark.png`, `760-settings-recent-light.png`, `760-settings-recent-dark.png`: the page at 760 px with no sideways scroll; the log path wraps.
- `open-chat-real-session-light.png`: Open chat from the list opened the real-model chat (Workspace Write, GLM-5.3-Flash-EXL3).

## Findings (most severe first)

1. **Major (usefulness, docs): "you were looking" means only "DSH's window is focused and visible".**
   - Where: `lib/client.js`, `applyPoller` (`watching = doc.hasFocus() && doc.visibilityState !== 'hidden'`).
   - What: the job is long unattended runs: "you leave DSH working, and the news finds you". An owner who leaves DSH's window in front and walks away gets no banner until macOS reports the window hidden. I could not check when that happens (a locked screen, or the display sleeping). Each notification is listed as "You were looking at DSH", which is not true.
   - The same happens after a relaunch, proven in the app (step 7): the relaunched window takes the front, and news that waited through the restart is dropped 1 s after the window loads. The README says it "shows after the restart, once".
   - Fix: count the window as watched only while it is focused, visible and has had input from the person in the last minute or two (pointer, key or wheel events in the window). Show news that was queued before this window loaded (a restart, a reload) unless the person has touched the window since. Add e2e steps for a focused window with no input, and for a focused window after a restart.
2. **Major (reliability): a window that cannot show notifications takes the queue and drops it.**
   - Where: `lib/client.js`, `readOnce` (a `denied` window takes every item and reports `denied`); `lib/notifier.js`, `acknowledge`.
   - What: proven in the app (step 5). A browser window on the same DSH with notifications blocked takes every notification the app's window would have shown, for as long as it is open. It polls every 15 s and at once on every focus change. That could be a browser set to block all sites, a tab where Block was pressed, or any automation browser. The list then blames "this window's settings".
   - The README's limit says the other window "does not" show it, not that the news is lost. The e2e works around the race: its second-window step keeps the first window "looking".
   - Fix: have `pending` carry what the window can do (its permission, and whether it is the app's window). Hand items only to a window that can show them. Mark an item blocked only when no capable window has checked in within the TTL, and the same for a window without the API. Add a two-window e2e step: a blocked tab beside a granted window takes nothing.
3. **Major, unproven (usefulness, test depth): the click in the real app.**
   - Where: `lib/client.js`, `showNotification` `onclick` (`win.focus()`, then `openSession`).
   - What: proven only by the e2e calling `onclick` on a recorder in Chromium. The app hides its window on the close button (main process: `close` is prevented, then `hideMainWindow`). It shows a hidden window again from its `activate` handler, on a Dock click or a relaunch. A renderer's `window.focus()` in this host is not shown to raise a hidden or minimised window. So a click may open the chat inside a window that stays down. I did not click a real banner.
   - Fix: prove it in the app: hidden by the close button, minimised, and behind other windows. Keep a picture or a short recording. If the window stays down, find what DSH offers to raise it; if nothing, say so under Limits.
4. **Minor (reliability): unknown keys pass without a word.**
   - Where: `lib/config.js` `checkSettings`, `lib/index.js` `Config`.
   - What: `notifyFleeet: true` made DSH reload the plugin, and neither the log nor the page named it. The owner believes Fleet is set.
   - Fix: warn for each key that is not a setting, in the log and under "A setting is wrong" (with the nearest real key).
5. **Minor (UX, docs): the change line reads as the opposite.**
   - Where: `lib/index.js` (`loader/volatile-update`), and the README's example.
   - What: after Fleet findings was switched off, the log said `settings changed: “Fleet findings” (on; sender now: window)`. The "on" is the master switch.
   - Fix: give each changed setting its new value: `“Fleet findings” off (notifications on; sender: window)`.
6. **Minor (UX): Where they go now, in a second window.**
   - Where: `lib/client.js` `whereWords`.
   - What: in a browser tab beside the app, the row says "This DSH window shows them, with DSH's icon…". This tab has them blocked, and it takes them (finding 2).
   - Fix: when the host is the app and this window is not, say "DSH's app window shows them…" and what this window does.
7. **Minor (usefulness): Fleet news opens nothing.**
   - Where: the `notify` contract (`lib/index.js`) and `onclick`.
   - What: Fleet sends no session, and the service takes no other target, so a click on "Fleet · A5 logged a GPU error" opens no particular place.
   - Fix: an optional target such as `{ open: { bundle: 'dsh-plugin-fleet' } }`, opened with `pluginNavigation.openBundle` as the summary already does. Document it.
8. **Nit (UX).** With "Send system notifications" off, the six kind switches still look live (picture above). Show them as inactive while the master is off.
9. **Nit (docs).** "A click on the summary opens the recent list": it opens the plugin's page at its top, and the list is below the switches. Scroll to the list, or say "opens its page".
10. **Nit (UX).** The page shows a path and a key where people read ("…/notifications/notifications.log", "(notifyHandback)"), which DESIGN.md §9 asks to avoid. Both are deliberate and help fix things; keep the key in the fix sentence only.
11. **Nit (test depth).**
    - The e2e's `permission-ask-light.png` shows the top of the page, not the ask row it is named for.
    - Its ring check accepts `outline-style: auto`, and in my picture of the focused test button no ring shows. Check DESIGN.md's 2px solid ring, or set it under `.dshn-page`.
12. **Nit (reliability).** Two windows that can both show may both show one item: `pending` does not claim items, and only `acknowledge` removes them. A short claim per window fixes it.

## What would make it a 9.5

- Findings 1 and 2 fixed, each proven by a new real-DSH step on every build:
  - a focused window with no input still shows;
  - a relaunched focused window shows the news that waited;
  - a blocked window beside a granted one takes nothing.
- Finding 3 proven in the installed app, with a picture or recording of a real banner click raising a hidden and a minimised window on the right chat. If it does not raise them, a fix, or the limit written down.
- Findings 4 to 7 fixed, and the README brought in line (restart, two windows, the change line).

## Live DSH fingerprint (before and after)

- Before, 10:41 AM: pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 f240a78d8bd63d3f….
- At the resume, 1:37 PM: the same.
- After, 1:46 PM (instance destroyed, slot given back): the same.
- The e2e runner's own before and after: unchanged.
- The live patch did not move while I judged.
