# Notifications: judge round 2

Commit a09f584ef9a93fb6e11e3a6f8bfcf40b3a4569e2 (branch `goal95/notifications`), judged Mon 2026-10-26, 8:45 to 9:01 PM and 11:37 PM to 12:07 AM PDT (a usage limit stopped the judge in between). DSH Test instance g95-notifications-j3 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 requested; the gateway answered as DeepSeek-V4.1-Flash-1017, so one real-model turn only (see "The real model" below). GOAL95 PASS 2: the last round for this plugin. The bar: 9.5 with no criterion below 9.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.5 | The stack's one notification channel (the coordinator, Decisions, Agent Terminals, Autopilot and Fleet call it), and in the installed app it now does the whole job: real banners from a background window (23 s, inside the documented minute) and through a restart (2 s after it, once), a click that brought a hidden, a minimised and a covered window up on the right chat (0.7 to 1.1 s), news for a window left in front with nobody at it, none while you use it, one switch per kind; a person's click on a real banner is still unproven. |
| Reliability | 9.5 | Never threw (odd input included), every outcome in the log in words, state 700/600 written whole, a restart kept the waiting news and showed it once, off and on kept the list, a wrong value and a misspelt key named with the fix, claims and window capabilities proven; two edge gaps: a later report can turn a "shown" into "not shown" (I did it by hand), and a failed raise plan is kept until the plugin restarts. |
| UX / polish | 9 | DSH's own form, switches and buttons, every state in words, the where-words right in a blocked tab, DSH's 2 px solid ring on all 13 Tab stops, light and dark, 760 px with no sideways scroll; but a wrong value that counts as on cannot be saved as on in one step (Save stays off), and Open on a Fleet finding does nothing and says nothing when Fleet's page is not there. |
| Test depth | 9.5 | 55 unit tests and 68 real-DSH checks, green on all three builds, that read the host's answers, files, log and DOM (two windows, a blocked tab, in use and left in front, a restart, bursts, the summary, pictures light and dark), plus the app check that hides, minimises and covers a real DSH Test window and proves the raise (3 of 3); untested: a real banner click (documented), Fleet's page opening, and findings 1 to 3. |
| Docs | 9.5 | A complete, honest README (settings, off, rollback, setup, tests, limits, a "proven and untested" list) that matched the code and the app everywhere I checked but one sentence: "an edit of the profile changes them in place, with no restart" does not hold for an edit that adds or removes a key that is not a setting (DSH restarts the plugin). |

Plugin score: min(U, R, mean) = min(9.5, 9.5, 9.4) = 9.4. Verdict: NOT YET.

## What I ran

- **Head.** `git archive a09f584` into `~/Projects/goal95/judge/notifications-r2/head`. Read in full: the README, all of `lib/`, both test files, `test/e2e/run.mjs`, `send.mjs`, the caller plugin, `test/app/raise-check.mjs` and its two window scripts, and DESIGN.md's rules (§9, §10, "Before you push"). Read only: the callers' wiring (the coordinator's `lib/index.js:114`, Decisions, Agent Terminals, Autopilot; Fleet's `notify` call at `plugins/fleet/lib/impl.js:1380` in the split-plugins checkout, and its page id `fs-fleet`), and the installed app's main-process script (copied out of the app for reading) for its single-instance lock, `second-instance`, `open-url` and `focusPrimaryWindow`. I formed my view before reading round 1's scorecard.
- **Unit tests.** `npm test` from the head: 895 tests, 890 pass, 1 fail, 2 skipped, 2 todo. The one failure is Agent Terminals' stand-in agent test at a load average of about 130; it passed alone (1 of 1). Not this plugin. The naming scan passed. Notifications alone: `node --test plugins/notifications/test/notifications.test.js`, 55 of 55.
- **Real-DSH e2e.** `node scripts/e2e.mjs notifications` with its pictures in my own folder, one slot held: 68 of 68 on DSH 0.2.0-rc.2 (181 s), 0.2.1-rc.1 (108 s) and the app's 0.2.1-rc.3 (70 s); "live DSH after: pid 64099, patch 535e6390a2162bbc — unchanged". I read the check list: the checks read the host's answers, `state.json`, the log and the window's DOM, with a recorder in place of the system's banners.
- **My instance.** `dsh-test --name g95-notifications-j3 up`, `load` of the plugin and of `test/e2e/caller` from the head, `restart`, `doctor`. Its default preset set to `workspace-write` at 8:59 PM, before the real turn (the template's preset was full access; no turn ran under it). The plugin's log: `started (on; the Desktop app; sender now: window)`.
- **The app check (the raise).** `node plugins/notifications/test/app/raise-check.mjs --instance g95-notifications-j3 --port 29648 --shots <my folder>` at 8:57 PM. Hidden by its close button: up in 673 ms. Minimised: 1068 ms. Behind another window: 897 ms. Each time the right chat was open and the log said "brought DSH's window up (the app was asked to open again, as a click on its Dock icon does)". 3 of 3 PASS. A recorder stood in for the banner (the click is its `onclick`), so no system banner showed; the script's chats are empty (it runs no turn). Pictures only of the DSH Test window, through the script's own page capture.
- **The relaunch, watched.** With my instance up, I asked its plugin twice within 2 s to bring the window up (`clicked` with `raise: true`, through its signed-in API) while sampling the process table every 0.1 s, filtered to my instance's folder. The newcomer: pid 86979, parent 43666 (my instance's host, a child of its main 43536), the app's binary with `--user-data-dir=/Users/albertlee/.dsh-test-g95-notifications-j3-electron` and nothing else; seen in one sample, gone by the next. The second ask was refused and logged: "could not bring DSH's window up (it was asked to come up a moment ago)". I also ran the plugin's `relaunchPlan` on real `ps` output: my instance's main gives `[--user-data-dir=<my folder>]`; the live main (pid 64099) has no switches, so a live host's plan is the binary with no arguments. Nothing was started for the live app.
- **The real model.** One turn in a throwaway workspace, in workspace-write: "Reply with exactly this sentence and nothing else: notifications judge check." It completed in 6.3 s with that sentence. Its `responseModel` in the session's log was DeepSeek-V4.1-Flash-1017, not GLM-5.3-Flash-EXL3 (the gateway's known substitution tonight), so I sent no more real-model turns and relied on the e2e's scripted model. An environment fact, not scored.
- **Settings, live.** Edits of my instance's profile row. `notifyFleet` on and then off applied in place, with no restart: "settings changed: “Fleet findings” on (notifications on; sender: window)", then "… off …". An edit that set `notifyHandback: "no"` and added a misspelt `notifyFleeet: true` restarted the plugin (the log's `started` at 9:01:35 PM). Both problems were named in the log and under "A setting is wrong", with the nearest name. At 12:05 AM I checked which part restarted it:
  - removing only the misspelt key restarted the plugin again (`started` at 12:05:23 AM);
  - changing only the wrong value (`"no"` to `"yes"`) applied in place: "settings changed: “Handbacks” (not true or false, so on) (notifications on; sender: window)". A Fleet finding sent through the caller with Fleet findings off: the answer `off`, listed as "Not shown. “Fleet findings” is switched off in its settings."
- **Real banners from my instance.** I kept them few; they showed on the owner's screen:
  - #5 at 11:39 PM, with my instance's window in the background: sent 23 s after it was queued, and shown by the system.
  - #7, queued and then `dsh-test restart`: "1 notification(s) still waiting for DSH's window from before the restart", shown 2 s after the restart, once.
  - By my mistake, two more at 11:51 PM: #9 (a 5000-character title, clipped in the banner and the log) and #10 (`notification: null`, shown as a bare "DSH"). My script meant to report them before a window took them, but the report came 3 s after both were shown, and it rewrote both records from "shown" to "not shown" (finding 3).
- **Off and on.** With the plugin switched off its endpoints answered 404 and the caller got `absent`. Switched on again, the list was as before and nothing had been added while it was off. No log line says it stopped (nit 7).
- **The page.** A headless Playwright tab signed in to my instance, with notifications blocked in that browser:
  - The where-words: "… This browser tab has notifications blocked, so it never takes them." This window: "Notifications are blocked for this site in this browser's settings. Allow them there, then reload this page."
  - 13 Tab stops (7 switches, the test button, 5 Open buttons), each with a 2 px solid ring.
  - 760 px: the page 643 px wide, no sideways scroll.
  - The test button: "Not shown: Notifications are blocked for this site …", and the list "Not shown. Notifications are blocked for DSH in the window that took it."
  - Open chat on #5 opened the real turn's chat.
  - Open on a Fleet finding with no Fleet page here: nothing on the page, only a console warning (`layout.selectPanel: main panel "fs-fleet" is not registered`). Open on an entry that names a plugin that is not installed: DSH's Plugins list.
  - Handbacks with the wrong value `"no"`: shown on, Save off. Switched off: Save on. Switched on again: Save off.
  - No page error from the plugin.
- **After a plugin restart** the host counted the app window as absent (`appWindow: false` in its status) for about 38 s, until the window looked at the queue again.
- **DESIGN.md "Before you push"**, for its one surface (its page in Plugins):
  - Surfaces: yes. No ground of its own; DSH's own `SettingsForm`, switches and buttons.
  - Tokens and selectors: yes. Only DSH tokens (`--dsw-*`); every rule under `.dshn-page` or `.dshn-*`, plus only `body.wp-still` from Wallpaper; no hash selector, nothing on `:root`, `html` or `body`, no `:has()`.
  - Motion: yes. Rules for `wp-still` and reduced motion, though the page has no motion.
  - Checks: `node --check` is clean on `lib/*.js`; `npm test` as above.
- The orphaned DSH (pid 97773, port 62643) is not mine; I left it alone.
- At 12:06 AM PDT: instance destroyed, slots given back, and every process I started stopped.

## What I saw (each picture, one line)

In `review/notifications-round-2/`. `app-raise-*` are the DSH Test window during the app check. The rest without `e2e-` are my instance's page in a headless tab. `e2e-<build>-*` are from my own e2e runs (each build's throwaway DSH, the scripted model).

- `app-raise-1-hidden.png`: after the click on "Raise check 1", the window is up in front with its chat's folder `raise-hidden-iZB8iJ` open (an empty chat; the composer shows the instance's template preset from before I set workspace-write).
- `app-raise-2-minimised.png`: the same for the minimised window; folder `raise-minimised-vtzXbQ` open.
- `app-raise-3-behind.png`: the same for the window behind another; folder `raise-behind-TO07wU` open.
- `settings-top-light.png` and `settings-top-dark.png`: the master and six kind switches (Fleet findings off), the click sentence, Save off, "A setting is wrong" below.
- `settings-problems-light.png` and `settings-problems-dark.png`: the two problems in words ("“Handbacks” must be true or false, but it is "no"; it counts as on …"; "“notifyFleeet” is not a setting … did you mean “Fleet findings”?"), then Where they go now for a blocked tab, This window and the test row.
- `settings-recent-light.png` and `settings-recent-dark.png`: Recent notifications. #5 is Shown with Open chat, the Fleet finding is Not shown (switched off) with Open, and the three raise checks are Shown. Components and Source are below.
- `settings-760-light.png`: 760 px; the switches, hints and problems wrap, with no sideways scroll.
- `settings-760-recent-dark.png`: 760 px dark; the recent list and the hint's log path wrap.
- `settings-test-in-tab-light.png`: after the test button in the blocked tab: "Not shown: Notifications are blocked …", and a new "Notifications test · Not shown" at the top of the list.
- `open-chat-from-list-light.png`: Open chat on #5 opened the real turn's chat ("notifications judge check.", Workspace Write).
- `wrong-value-switch-back-on-light.png`: after Handbacks off and on again, byte for byte the same as `settings-top-light.png`, Save still off (finding 1).
- `open-missing-plugin-page-light.png`: Open on an entry that names a plugin that is not installed lands on DSH's Plugins list.
- `e2e-app-0.2.1-rc.3-permission-ask-light.png`: a window never asked: the ask row "This browser asks you once …" with Allow notifications, now in view; Where: "DSH's app window is closed, and this browser tab shows none until it is allowed to (below)."
- `e2e-app-0.2.1-rc.3-blocked-tab-light.png`: a blocked tab with the app window closed: "news waits up to 5 minutes for the app's window, then is listed as not shown."
- `e2e-app-0.2.1-rc.3-settings-master-off-light.png`: master off: the six kind switches gray under "These apply while “Send system notifications” is on.", Save on.
- `e2e-app-0.2.1-rc.3-settings-wrong-setting-light.png`: the e2e's wrong value and misspelt key, in words.
- `e2e-app-0.2.1-rc.3-settings-tested-light.png`: "Shown: the system reported showing it." with DSH's ring on the test button; the list shows Still on (Waiting), A3 is running hot (Not shown, Open) and the bursts.
- `e2e-app-0.2.1-rc.3-summary-opens-recent-light.png`: the summary's click opened the page at Recent notifications. Bursts 1 to 3 were "Shown on screen in one notification with others that came at once", While you use it was Not shown, Left in front was Shown, and the handback has Open chat.
- `e2e-app-0.2.1-rc.3-chat-opened-light.png`: a click on the handback's notification opened "Fix the flaky upload test" with its reply.
- `e2e-0.2.0-rc.2-settings-760-dark.png`: 0.2.0-rc.2 at 760 px dark: "A DSH window in your browser shows them … (one last checked in at 8:58 PM). Keep a DSH tab open to get them."
- `e2e-0.2.1-rc.1-settings-recent-dark.png`: 0.2.1-rc.1 dark, the recent list, ending "No window yet · Not shown. No DSH window was open to show it, and macOS has no other sender that shows DSH's icon."

## Findings (most severe first)

No blocker, no major.

1. **Minor (UX): a wrong value that counts as on cannot be saved as on in one step.**
   - Where: `lib/client.js:232-234`. `boolSpec`'s `format` turns any value that is not a boolean into `on`, and DSH's `SettingsFormModel` (`lib/client.js:473`) compares against that.
   - What: with `notifyHandback: "no"` the page says the setting "counts as on until you change it. Set it with its switch above and save". The switch shows on and Save is off. Switched off, Save turns on; switched on again, Save is off, and the page is the same picture as at rest. To store `true` the owner must save off, then save on, or edit the profile. Fixing it to off works in one save.
   - Fix: give a value that is not a boolean a form value that is neither `on` nor `off` (or mark the field changed), so Save stays on until a boolean is stored. Add an e2e step: a wrong value, one save of on, and the profile holds `true`.
2. **Minor (UX): Open does nothing, and says nothing, when its page is not there.**
   - Where: `lib/client.js:374` (`openPlaceOf`) and its catch at `:807-811`, which only writes a console warning; the Open button in the recent list.
   - What: a Fleet finding stays in the list after Fleet's page is gone from this window (Fleet switched off, or not loaded here). Its Open leaves the page as it is and gives no word. An entry naming a plugin that is not installed goes to DSH's Plugins list instead, which is fine.
   - Fix: when the page is not there, say so beside the entry ("Fleet's page is not open in this DSH. Switch Fleet on in Plugins."), or offer Open only for a page that is registered. Add an e2e step with the page missing.
3. **Minor (reliability): a later report can overwrite a final state.**
   - Where: `lib/notifier.js:307-335`. `acknowledge` calls `settle` (`:242`), which sets any state on any listed id.
   - What: #9 and #10 were shown (log: "shown: Shown on screen by DSH's window (the system reported it)"). A report 3 s later turned both into "not shown: You were using DSH …". The list and the log now contradict the banners the owner saw. In normal use this needs a report that comes after the 30 s claim has run out, or one from a window that did not take the item; I sent it by hand.
   - Fix: accept a result only for an item that the reporting window took or holds the claim for. Never move a settled entry (shown, failed, not shown) to another state. Add a unit test for both.
4. **Minor (reliability): a failed raise plan is kept for the plugin's life.**
   - Where: `lib/raise.js:75` (`known ??= plan?.() ?? …`); `parentCommandLine()` runs `ps` with a 2 s timeout.
   - What: if `ps` fails or times out at the first click, the cached plan is "the Desktop app that started this DSH could not be found". This machine ran at a load average of about 130 tonight. Every later click on a hidden window then opens the chat without bringing the window up, until the plugin restarts. From reading the code; not run.
   - Fix: keep only a plan that works, and try a failed one again at the next click (the 2 s gap already limits how often).
5. **Nit (UX): an empty notification shows a bare "DSH".** At `lib/notifier.js:378` (`… || 'DSH'`), `notification: null` (or no title and no body) was queued and showed a banner titled "DSH" with nothing else (#10). Refuse it instead: answer `invalid` and log it.
6. **Nit (log words).** A second click within 2 s is logged as `warn … could not bring DSH's window up (it was asked to come up a moment ago)`, though the first click brought the window up. Log it as info, for example "a second click within 2 s; the window is already coming up".
7. **Nit (reliability).** No log line when the plugin stops (switched off or unloaded); the log just goes quiet. Add `info stopped (…)` on dispose.
8. **Nit (reliability).** After a plugin restart the host counts the app window as absent until that window looks at the queue again (about 38 s here). Meanwhile "Where they go now" is wrong, and a browser tab that can show notifications could take news meant for the app window. Keep the app window's last look across the restart (in the state file), or have the windows look at once when the plugin starts.
9. **Nit (docs).** The README's Settings section says "an edit of the profile changes them in place, with no restart". An edit that adds or removes a key that is not a setting restarts the plugin: it happened at 9:01:35 PM, and again at 12:05 AM when I removed only the misspelt key. A change of a setting's value, even a wrong one, applied in place. Say "an edit of a setting", and add that a key that is not a setting restarts it (losing nothing).
10. **Nit (docs, the raise's residual risks).** Two lines for Limits; from the code, neither was run.
    - (a) The app's single-instance lock is Chromium's. That code treats a running app that does not answer a newcomer within its timeout as hung, and may end it. So a click while the app's main process is blocked for that long could end the app. That is unlikely, but the owner should know.
    - (b) The parent's command line comes from `ps` and is split before each " -". A `--user-data-dir` path containing " -" would be cut. The newcomer would then miss the running app's lock and start a second app on the wrong folder. No DSH Test name has a space today. Read the folder from an exact source, or refuse a path with a space.

## The window raise and the owner's live app

- **What it does** (`lib/raise.js`, the app's main script). On a click for a hidden, minimised or covered app window, the host starts the app's executable once more, with the parent's `--user-data-dir` if it has one. The newcomer reaches the app's single-instance lock at the top of the main script, before any window or host, and quits. The running app's `second-instance` handler then shows and focuses its window (`focusPrimaryWindow`, the same as `dsh://open`).
- **Guards** (code). The raise runs only:
  - in the Desktop app's own host (Electron, entry under `dsh-desktop-host/`);
  - on macOS and Linux;
  - when the parent's command line is that same executable followed only by switches;
  - at most once per 2 s.

  The newcomer runs detached with its output ignored, and gets the host's environment minus `ELECTRON_RUN_AS_NODE` and `NODE_OPTIONS`.
- **In DSH Test** (run). The newcomer carried only my instance's folder and quit at once. My instance's window came up, and the live fingerprint was the same before and after.
- **For the live app** (code plus `ps` facts). The live main (64099) runs with no switches, so a click in the live app starts the binary with no arguments. Its lock is the live app's own default folder, so it hands over to the live app itself: the app's own "open again" path. A DSH Test instance's newcomer cannot reach the live app. It always carries the instance's folder (dsh-test starts every instance with one), so the lock it meets is that instance's.
- **Residual risks** (code, not run):
  - the hung-app case and the `ps` split (nit 10);
  - the inherited environment, which matters only if no app holds the lock at that moment (the app quitting). The newcomer then starts a full app with the host's environment, which for the live app is its own.
- **Verdict:** safe for the owner's live app in normal use. The two residual risks belong under Limits.

## Round 1's findings

At a09f584:

1. **"You were looking" meant only focused and visible: fixed.** "In use" is now focused, visible and a click, key, scroll or pointer move in the last 2 minutes. The e2e proves that a window left in front shows the news and one in use does not. In my app instance, news that waited through a restart showed 2 s after it (#7).
2. **A blocked window took the queue: fixed.** Windows report what they can do, only capable windows take news, and a browser tab defers to the app window. The e2e proves a blocked tab beside a granted window takes nothing, and my blocked tab's page says it never takes them.
3. **The click in the real app: fixed for the window.** The app check raised a hidden, a minimised and a covered window on the right chat (3 of 3, pictures). A person's click on a real banner is still untested, and the README says so.
4. **Unknown keys: fixed.** They are named in the log and on the page, with the nearest name.
5. **The change line: fixed.** It now reads "settings changed: “Fleet findings” off (notifications on; sender: window)".
6. **Where they go now, in a second window: fixed.** It reads "DSH's app window shows them … This browser tab has notifications blocked, so it never takes them."
7. **Fleet news opened nothing: fixed in code.** Fleet's findings carry `open: { panel: 'fs-fleet' }`, which is Fleet's real page id, unit-tested with a stand-in. Not run with Fleet. With the page missing, Open is silent (finding 2).
8. **Kind switches looked live while all was off: fixed.** They are gray under "These apply while …".
9. **The summary opened the top of the page: fixed.** It opens at Recent notifications (e2e picture).
10. **A path and a key where people read: partly fixed.** The key now appears only in the fix sentence. The log path stays in the list's hint, by choice.
11. **The e2e's ask picture and ring check: fixed.** The ask row is in its picture, and every Tab stop has a 2 px solid ring (my sweep).
12. **Two windows could both show one item: fixed.** Each item now has a 30 s claim (unit test, and the e2e's "two windows show one item once").

## What would make it a 9.5

- Findings 1 and 2 fixed, each with an e2e step:
  - a wrong value saved as on in one step;
  - Open on a missing page says why.

  With nits 5 and 6, that lifts UX / polish to 9.5.
- Findings 3 and 4 fixed, with unit tests: no settled entry changes state, and a failed raise plan is tried again.
- The README: the Settings sentence (nit 9), and the two residual risks of the raise under Limits (nit 10).

## Live DSH fingerprint (before and after)

- Before, 8:46 PM: pid 64099, started Mon Oct 26 15:35:11 2026, patch sha256 535e6390a2162bbc….
- 8:55 PM, 8:57 PM (before and after the app check), 11:38 PM (the resume), 11:49 PM and 11:55 PM: the same.
- After, 12:06 AM (instance destroyed, slots given back): the same, pid 64099, started 15:35:11, patch 535e6390a2162bbc….
- The e2e runner's own before and after: unchanged.
- The live patch did not move while I judged. It had moved at about 7:28 PM, before I started, when the live default model row was switched.
