# Notifications

System notifications for DSH when its window is hidden or unfocused. A plugin
(the coordinator first) asks for one; this plugin sends it through the first
sender around — DSH's own desktop sender in the Desktop app where DSH
provides it, otherwise a DSH window's own notifications (the Desktop app's
carry its icon), or a command-line sender where one exists. Nothing shows
while the window is focused: if you're looking at DSH, you don't need a toast
over it.

## How it works

The Desktop app's own plugin and launcher send attention through
`desktopRuntime.notifyAttention` — it sends nothing while the window is
focused, flashes the taskbar on Windows, badges the dock, and brings the
window up when a notification is clicked. Where DSH provides that service
the plugin uses it and adds nothing to DSH's own flow.

Everywhere else the sender is a DSH window itself: the host queues the
notification and the window's browser half shows it through the Web
Notifications API, which macOS and Windows attribute to the app the window
belongs to — DeepSeek Harness. On the Desktop host the queue is used even
while the window is hidden or minimised (its renderer still exists; its
timers are throttled, so a hidden window may take up to about a minute to
poll, and the queue flushes the moment the window is focused again).
Elsewhere the queue is only used while a tab has polled recently:

| Where | Sender | Notes |
| --- | --- | --- |
| Desktop app, DSH provides `desktopRuntime` | DSH's own `desktopRuntime` | the app's own notifications; also skipped while the window is focused |
| Desktop app, no `desktopRuntime` (0.2.1-rc.2) | the Desktop window's Web Notifications | queued while hidden or minimised; flushed on focus; carries DSH's icon |
| `web` profile, tab open | the same browser half, in the tab | permission asked once, from a click; polled every 15 s |
| No window watching, Linux | a command: `notify-send` | fire and forget, with the whale as `--icon` |
| No window watching, Windows | a command: a PowerShell toast | fire and forget, with the whale as its logo |
| No window watching, macOS | nothing | see below |

**Why macOS has no command line.** macOS's only command-line sender,
`osascript`, cannot set a per-notification icon: its notifications show
Script Editor's icon, which is exactly what this plugin must never do. So on
macOS a notification with no window around is not sent at all rather than
sent with the wrong app's icon. The Desktop app's window is the sender, and
it exists hidden, minimised and in the background.

The browser half stands down by itself when the host answers that the Desktop
app sends natively, so nothing ever sends twice.

**The icon.** The plugin's icon is the DeepSeek whale (`icon.svg`, with a
256 px `icon.png` beside it). `notify-send` shows it on Linux (`--icon`) and
a Windows toast carries the PNG as its logo. In a DSH window the Web
Notifications API posts as the window's own app — DSH's icon in the Desktop
app, the browser's in the `web` profile.

**Proven and guessed.** Proven by reading DSH's source: the desktop path is
the app's own (`lib/notifications.js`, `host-process-entry.js` — a plugin
injects `desktopRuntime` the same way DSH's own notifications plugin does).
**Proven on this machine:** the `desktopRuntime` call shape, and — on
0.2.1-rc.2 — the Desktop window's Web Notification banner (see
`review/notifications-release.md`). **Untested (guess):** the Windows
PowerShell toast and its logo image, `notify-send` on Linux and its
`--icon`, and the browser profile end to end in a real browser. None of it
has run on Windows or Linux.

## For other plugins

```js
ctx.inject(['notifications'], (notifications) => {
    notifications.notify({
        title: '“Fix CI” handed back',
        body: '',
        kind: 'handback',     // optional: gates on that event's switch
        sessionId,            // optional; no platform can open a session yet
    });
});
```

The service is absent when the plugin is off or not installed, so wrap the
call the way DSH's own optional injections work (`ctx.inject` waits for it).
`notify` returns what happened: `'desktop'`, `'browser'`, `'cli'`, `'none'`
(no sender around), or `'off'` (the settings gate it). Senders take one line
each; whitespace collapses.

The coordinator calls it on its news: a handback, a thread that ended a turn
without a handback, one waiting for your approval, and one that failed or was
stopped again after the plugin's nudge. Its words for these are in its
`lib/index.js`; the kinds gate here, one switch each.

Fleet calls it with `kind: 'fleet'` when a finding on an Ascent starts, gets
worse or clears: running hot, low on memory, a GPU error or an out-of-memory
kill in the kernel log, a fabric link down, an Ascent that stops answering.
Fleet waits for a finding to hold before it opens and for a quiet spell before
it reports it cleared, so one finding is one notification when it starts and
one when it clears.

## Settings

On DSH's Plugins page, under Notifications: a master switch, and one switch
per event (handbacks; ended without a handback; waiting for approval; failed
after a nudge; stopped after a nudge; Fleet findings). A save lands in the profile's
`cordis.patch.yml` and the plugin restarts with it — a restart costs a
notifier nothing, so its config is ordinary config, not live.

The same page names where this browser stands: notifications are on, blocked
for the site in the browser's settings, or waiting for your OK once — the
**Allow** button asks. The browser profile only shows notifications the
browser has allowed.

## Limits

- **A click brings DSH's window up; it does not open the chat.** DSH's own
  desktop sender does that, and DSH offers plugins no way to open a session
  (no deep link a plugin may use).
- **A hidden or minimised window may delay a notification by up to about a
  minute.** A hidden window's timers are throttled to roughly once a minute,
  so the queue's poll lands late; the queue flushes the moment the window is
  focused again, and items older than five minutes are dropped rather than
  shown late.
- **The Desktop app with its window closed** (destroyed, not hidden) has no
  renderer to show one: the items wait in the queue for a window that comes
  back within five minutes, then age out. On macOS nothing replaces them.
- **A closed browser tab** stops the browser sender; when no tab has polled
  for 90 s the queue is no longer used, and on macOS no command sender
  follows — the news is not sent rather than sent with Script Editor's icon.
- **The command-line senders are best effort.** A machine without
  `notify-send` gets a logged failure and no notification.
- **Permission is asked once, from where an ask can work.** The Desktop
  app's window grants its own ask; a browser needs the Allow button on the
  plugin's page, and items wait in the queue until it is answered.
- The plugin sends no notifications itself while it is off, and it leaves
  nothing behind: no marks, no style tag, no queue.

## Tests

```sh
node plugins/notifications/test/notifications.test.js   # offline, no DSH needed
node --check plugins/notifications/lib/client.js         # the browser half parses
```
