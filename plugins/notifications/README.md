# Notifications

System notifications for DSH while you are not looking at its window. Other
plugins send their news through it — the coordinator when a thread hands
back, ends a turn without a handback, waits for approval, or fails or is
stopped after a nudge; Decisions for each new card; Agent Terminals when an
agent waits on you; Autopilot when it backs off; Fleet when a finding on an
Ascent starts or clears. It is built for long unattended runs: you leave DSH
working, and the news finds you.

- **It shows with DSH's icon**, from DSH's own window, and only while you are
  not looking at DSH (hidden, minimised, behind other windows, or in the
  background). If you are looking, no notification is needed.
- **A click brings DSH's window up and opens the chat** the news is about.
- **Many at once** (more than three in one look) show as the newest two and
  one summary of the rest; a click on the summary opens the recent list.
- **Nothing is lost**: the settings page lists the last notifications with
  what became of each — shown, not shown and why, failed and why — with
  Open chat for the ones from a chat. Its log file has a line for every
  one.
- **A restart loses nothing and repeats nothing**: news still waiting for a
  window is kept on disk and shows after the restart, once.

## How it sends

Each notification goes through the first sender that is around:

| Where | Sender | Notes |
| --- | --- | --- |
| A DSH that provides `desktopRuntime` | DSH's own desktop notifications | used as they are; they skip while the window is focused |
| The Desktop app (no `desktopRuntime`, as in DeepSeek Harness 0.2.1-rc.3 here) | the app's window, through the Web Notifications API | queued even while the window is hidden or minimised; macOS shows them as DeepSeek Harness's, with its icon |
| DSH's `web` profile in a browser tab | the same browser half, in the tab | the browser asks once (the **Allow notifications** button); used while a tab checked in within 90 s |
| No window around, Linux | `notify-send` | with the whale as `--icon` |
| No window around, Windows | a PowerShell toast | with the whale as its logo |
| No window around, macOS | nothing | see below |

**Why macOS has no command-line sender.** `osascript`, macOS's only one,
cannot set a notification's icon: its notifications show Script Editor's
icon, as if another app sent them. So with no DSH window around, macOS gets
none, the recent list says so, and the news is still there when you look.

**How a "shown" is proven.** A window that takes news off the queue tells
the plugin what it did with each: shown (the system's own show event came),
not needed (you were looking), dropped (it waited more than 5 minutes, or
notifications are blocked), failed (with the reason), or handed over with no
confirmation (macOS's Focus or Do Not Disturb can hold one back). Each is a
line in its log file and an entry in the recent list. The caller's answer
(`'browser'`, below) means queued; the log and the list say what came of it.

**Proven and untested.** Proven by the real-DSH test (below), in a real DSH
window whose system notifications are replaced by a recorder: the queue, the
show, the click that opens the chat, bursts, the settings page and a restart,
on DSH 0.2.0-rc.2, 0.2.1-rc.1 and the installed app's 0.2.1-rc.3. The last
runs DSH under the app's own binary, as the app does, so the plugin takes
the Desktop app's path (the window's queue, even while it is hidden).
Proven by reading the app's code: its window may show notifications without
an ask. Proven by reading DSH's source: the `desktopRuntime` call shape.
Untested: a banner on the screen itself (no test puts one there), the
Windows PowerShell toast and `notify-send` on Linux (their commands are
unit-tested, not run), and DSH's own `desktopRuntime` (no DSH here provides
it).

## The settings page

DSH → Plugins → Notifications:

- **Send system notifications**, and one switch per kind of news (below).
  Saved with DSH's own form, in the profile's `cordis.patch.yml`.
- **Where they go now**, in a sentence: DSH's window, a browser tab, a
  command, or nowhere (and what to do about it).
- **This window**: whether it may show notifications, and the **Allow
  notifications** button where the browser has not been asked yet. In the
  Desktop app, macOS decides how they show: System Settings → Notifications
  → DeepSeek Harness.
- **Send a test notification**: shows one now, even while you look, and
  says whether the system showed it.
- **Recent notifications**: the newest ten (the plugin keeps thirty), each
  with its time and what became of it, **Open chat** for the ones from a
  chat, and where the log file with every one is.
- **A setting is wrong**, when one is (below): which, what it must be, and
  how to fix it.

## Settings

The row's id is `notifications`. Every setting is a switch. A save on the
settings page restarts the plugin, which costs nothing (its queue and list
are on disk).

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `enabled` | true or false | `true` | Off: no notification at all; callers are told `'off'` and the list says so. |
| `notifyHandback` | true or false | `true` | The coordinator: a thread handed back to its chat (`kind: 'handback'`). |
| `notifyFinished` | true or false | `true` | The coordinator: a thread ended a turn without a handback (`'finished'`). |
| `notifyApproval` | true or false | `true` | The coordinator: a thread waits on a permission prompt (`'approval'`). |
| `notifyFailed` | true or false | `true` | The coordinator: a thread failed again after its nudge (`'failed'`). |
| `notifyStopped` | true or false | `true` | The coordinator: a thread was stopped again after its nudge (`'stopped'`). |
| `notifyFleet` | true or false | `true` | Fleet: a finding on an Ascent starts, gets worse or clears (`'fleet'`). |

News of any other kind follows `enabled` alone: Decisions' cards, Agent
Terminals' agents that wait on you and Autopilot's questions
(`kind: 'decision'`), and Autopilot backing off (`'autopilot'`). Decisions
and Agent Terminals also have a switch for theirs in their own settings.

A value that is not true or false (`"yes"`, `0`) never stops the plugin: it
counts as the default, its log file warns once at start, and the settings
page names the setting until it is fixed.

```yaml
# In the profile's cordis.patch.yml (a patch row replaces the whole config: list every key you set)
- id: notifications
  config:
    enabled: true
    notifyFleet: false
```

## For other plugins

```js
ctx.inject(['notifications'], (scope) => {
    const notifications = scope.notifications;
    notifications.notify({
        title: '“Fix CI” handed back',   // one line; cut at 200 characters
        body: '',                         // optional; cut at 400
        kind: 'handback',                 // optional: gates on that kind's switch
        sessionId,                        // optional: a click opens this chat
    });
});
```

The service is there while the plugin runs (also while `enabled` is false,
so callers hear `'off'`), and absent while the plugin is switched off in
Plugins or not installed: take it with `ctx.inject` as above. `notify`
never throws and answers at once:

| Answer | Meaning |
| --- | --- |
| `'desktop'` | handed to DSH's own desktop notifications |
| `'browser'` | queued for a DSH window, which shows it while nobody looks (the log and the list say what came of it) |
| `'cli'` | handed to `notify-send` or a PowerShell toast |
| `'none'` | nothing could show it (no window on macOS, or a sender failed); listed with the reason |
| `'off'` | switched off in its settings (all, or that kind) |

## Where it keeps things

- `DSH_HOME/notifications/state.json` (`~/.dsh` when `DSH_HOME` is unset):
  news waiting for a window, the last thirty notifications with what became
  of each, and the next id. The folder is 700 and the file 600 (titles name
  your chats). Written whole and renamed, so a crash leaves the old file or
  the new one. Deleting it starts the list over; nothing else depends on it.
- `DSH_HOME/notifications/notifications.log`: its log, one line per
  notification (`2026-10-26T10:02:13-07:00 info #12 (handback) “Thread
  handed back” waiting: …`), one per outcome (`… info #12 shown: …`), and a
  warning for a setting that is wrong or a file it could not write. Past
  1 MB it moves to `notifications.log.1` (one older file kept). File 600,
  like the state. The plugin writes its own because DSH 0.2 keeps a
  plugin's log lines in memory only; they go to DSH's logger too.
- In each window's local storage, `dsh-plugin-notifications/shown`: the last
  hundred items that window showed, so a reload never shows one twice.

## Switching it off

- Just the notifications: switch off **Send system notifications** on its
  settings page and save (or set `enabled: false`). The plugin keeps
  running, so callers hear `'off'` and the list still shows what came.
- One kind: its switch on the settings page.
- The whole plugin: its switch on DSH's Plugins page. Its service, its
  endpoints, its page and its style sheet go; callers find no service and
  carry on without it. Switched on again, it starts from what it kept.

## Setup and rollback

- It is a DSH bundle with no dependencies beyond DSH's own packages: add
  `dsh-plugin-notifications` to the profile's bundles (DSH's Plugins page or
  `package.json` `dsh.profile.bundles`), linked from this folder.
- In a browser profile, open the settings page once and press **Allow
  notifications**. The Desktop app allows them by itself; macOS asks once,
  as for any app.
- Rollback: point the profile back at the earlier checkout of this folder
  (or `git checkout <earlier commit> -- plugins/notifications`) and restart
  DSH. An earlier version ignores `state.json`; delete
  `DSH_HOME/notifications/` if you want nothing left behind. The profile's
  `notifications` row keeps working (the keys did not change).

## Limits

- **A hidden or minimised window may delay a notification by up to about a
  minute**: its timers are throttled, so its look at the queue lands late.
  It looks again the moment the window is focused or loses focus.
- **The Desktop app with its window closed** (not hidden) has no window to
  show one: news waits up to five minutes for a window, then is listed as
  not shown. On macOS nothing replaces it.
- **A browser tab closed for more than 90 s** stops the browser sender; on
  macOS nothing replaces it.
- **Two DSH windows at once** (the Desktop app and a browser tab on the same
  DSH): the first to look at the queue shows the news, the other does not.
- **The command-line senders are best effort**: a missing `notify-send` or
  a failing toast is listed as failed, with the reason.
- **"Shown" is the system's own word**: the notification's show event. With
  DeepSeek Harness's notifications turned off in System Settings, macOS may
  take one without putting it on screen, and no app can tell; the settings
  page's **This window** row says where to look.

## Tests

```sh
npm test                                                   # the whole repository, these tests included
node --test plugins/notifications/test/notifications.test.js
node scripts/e2e.mjs notifications                          # real DSH, every build under .e2e/ and the app's
```

- The unit tests (41) cover the senders and their quoting, the settings
  check, the state file (modes, a broken file, ids across restarts), the
  log file (its lines, modes, the move to `.1`, a folder it cannot write), every
  outcome the notifier records and logs, the endpoints (the Remote markers
  the gateway needs, failures in words), the host wiring, the coordinator's
  news contract, and the browser half's sender: shown, watched, stale,
  blocked, failed, unconfirmed, bursts, a click that opens the chat, a
  reload that does not show twice. DSH's packages come from the newest
  runtime under `.e2e/` (`test/peers.mjs`); link `.e2e` into a fresh copy.
- The real-DSH test (`test/e2e/run.mjs`) runs DSH in a throwaway home with a
  stand-in caller plugin (`test/e2e/caller`) and a real window whose Web
  Notifications are replaced by a recorder, so nothing reaches the screen:
  everything listed at the top of that file, with pictures light and dark
  and at 760 px in `.e2e/shots/notifications/<DSH version>/`.
- By hand, in a DSH Test instance with the plugin and `test/e2e/caller`
  loaded: `node plugins/notifications/test/e2e/send.mjs "$(dsh-test url)"`
  sends one the way another plugin does and prints the answer and what came
  of it. That one is real: with the window hidden it shows on your screen.
