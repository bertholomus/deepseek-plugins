# Notifications — release prep notes (glass-v1)

Thread: t1 "Notifications icon fix (must-fix before release)" · 2026-10-18 (PDT)

## The bug

Albert: the macOS notification shows "the script icon" — Script Editor's —
instead of DSH's. Verified causes (all re-checked here, not taken on faith):

1. **The browser half could never poll — HTTP 404.**
   `lib/remote.js` bound the service with `bindTypertRemote` but never marked
   `pending`/`acknowledge` as Remote methods. The gateway serves
   `/api/<namespace>/<method>` only for prototype-carrying markers
   (`REMOTE_METHOD_DESCRIPTOR`, version 1 — read via `remoteMethods()` in
   `@deepseek-ai/dsh-typert-protocol/lib/index.js`), so both calls answered
   "not found". With no successful poll, `browserAlive()` was always false
   and `notify()` fell through to the CLI sender — on macOS, `osascript`,
   whose notifications macOS attributes to Script Editor.
   The calendar plugin does the marking (`plugins/calendar/lib/remote.js`,
   `markRemote` at its end); notifications was missing it.
2. **The macOS CLI sender cannot carry an icon.** `cliCommand('darwin')`
   built `osascript display notification …`, and `osascript` has no
   per-notification icon — the posting app is always Script Editor.
3. **`desktopRuntime` is not served on this build.** Correction to the brief:
   the Desktop app is unpacked at
   `/Applications/DSH Desktop.app/Contents/Resources/app/` (no `app.asar`
   exists), and `dsh-plugin-desktop` 2.0.15 **is** there, `notifyAttention`
   included (`lib/profile-channel-admission-*.js`). Whether its
   `desktop-shell`/`desktop-notifications` rows actually load on 0.2.1-rc.2
   is checked on the test instance (see below); the observed bug proves the
   service does not reach the plugin either way, and the fix does not depend
   on it — the renderer is now the sender whenever the host has none.
   `DSH_CLIENT_VERSION` is **not** an env var of the host process (it is a
   build-inlined constant in the client bundle; the Desktop shell never
   exports it). The host-side desktop detection uses
   `process.versions.electron` (the app's own pattern,
   `windows-pwsh-sandbox.js`), with `DSH_CLIENT_VERSION` as a secondary
   signal.

## The fix (commit cba8aa8 + follow-ups on release/glass-v1)

- `lib/remote.js`: `markRemote(NotificationsRemote, ['pending', 'acknowledge'])`,
  the calendar's exact pattern. The gateway can now name both methods.
- `lib/notifier.js`: new `desktopHost` option — on a Desktop host the queue
  is used even with no recent poll (the window's renderer exists hidden,
  minimised, backgrounded; its timers are throttled, so polls can lag about
  a minute). `pending()` sheds items past `QUEUE_STALE_MS`.
- `lib/backends.js`: macOS has no CLI sender — `cliCommand('darwin')` →
  null. Linux (`notify-send` + whale) and Windows (PowerShell toast + whale
  PNG) unchanged.
- `lib/index.js`: `desktopHost` detected from `process.versions.electron` /
  `DSH_CLIENT_VERSION`; one startup log line for the test instance.
- `lib/client.js`: a failing poll (the old 404) is a warned retry, not a
  stop; items are only taken when they can be shown or are worthless —
  with permission still `default` they wait in the queue, so they show once
  the ask is answered; `denied` items are taken (dropped); the Desktop
  renderer asks once without a gesture (Electron allows it), a browser asks
  via the settings page's Allow button; flush on focus/visibility already
  existed and is kept. Words updated to match the new macOS behavior.
- README rewritten to the same story.

## Glass / DESIGN.md pass (audit; no visual change was needed)

The plugin draws only inside DSH's Plugins page (`plugins.bundle.config`),
so per DESIGN.md §3 it owns no ground and uses DSH's tokens — it already
did. Checked against this build's token sheet
(`dsh-client-ui-theme/lib/client.js`): `--dsw-alias-label-primary/-secondary`,
`--dsw-alias-link`, `--dsw-alias-state-business-primary`,
`--dsw-focus-ring-color`, `--dsw-font-s-14/-xs-13` all exist. Link colour is
deepened per §4 (`color-mix … 85%, label-primary`); the focus ring is §9's
exact recipe; `body.wp-still` + `prefers-reduced-motion` cover pseudo-
elements; no `:root`/`html`/`body`, no `:has()`, no DSH hashes, no
generated-class selectors. Slot key `dsh-plugin-notifications` matches
agent-terminals/autopilot. Icon is 36×36 whale SVG; `locale/en.json` meta
carries title + one sentence.

## Tests

`node --test plugins/notifications/test/notifications.test.js` → 26/26,
including: the gateway can name its methods (404 regression), a desktop
host queues past the poll TTL, staleness shedding, the 404 retry path, the
permission wait, and the once-only ask. `node --check` on all lib files.

Note for the Lead: the repo-wide suite's only failure is the branding scan
tripping on `review/history-scrub.md` — an untracked scratch file from
another thread, not from this one.

## DSH Test run

Named instance `glass-notifications` (0.2.1-rc.2-era app, pid changes per boot; the Lead
holds the fingerprints). Evidence so far, all from the gateway API with the instance's own
sign-in cookie:

- `POST /api/dsh-plugin-notifications/pending` → **HTTP 200**
  `{ok:true,value:{desktop:false,items:[]}}` — before the fix this endpoint answered
  **404 "not found"** (that is the regression). `acknowledge` → 200; an unmarked method
  (`nonexistent`) → 404 "not found" (the control, the exact old behavior).
- `desktop:false` in every answer — **confirms `desktopRuntime` is not served on this
  build**, so the renderer is the sender in the Desktop app (brief root cause 2).
- `dsh-test doctor`: `Import check: 0 error(s)`, `Isolation check: ok`; rows
  `notifications` + `coordinator` addressed to the instance home.
- Real coordinator handback end to end: a "Icon proof" thread spawned through the
  coordinator's Remote, ran on GLM-5.3-Flash-EXL3, handed back (`coordinator.log`:
  `news …/t1 handback done seq=1`, `handback …/t1 status=done chars=5 delivered`) →
  `notifications.notify()` → host queue → **the DSH Test window's renderer took it**
  (`pending()` empty again on the next read). The queue→renderer path is proven live;
  phase B (banner + Notification Center shots with the window hidden, then minimised)
  is the Lead's desktop capture, landing in this folder.

Runbooks used (kept for re-runs): `lead-runbook.sh` (phase A) and `phase-b.sh`
(hidden + minimised shots; spawns one more "Icon proof" thread per run).

## The hidden-window finding (run1 + run2, 2026-10-18 evening)

- Run1 (visible-but-occluded window): handback queued 9:57:07 PM; 75 full-screen
  frames 9:56:37–9:59:31 PM; **no banner in any frame**; item gone by 10:18 PM.
- Run2 (fresh instance, detached 10 s probes): "Icon proof run2" handback
  queued 12:00:53 AM; `pending()` showed it at +101 s and +111 s, **gone by
  +151 s** — long before the 5-min stale prune ⇒ **the renderer's poller ran
  and acknowledged it while the window was occluded**, and 120 frames over the
  drain window show **no banner** (top-right corners pixel-identical).
- So polls and takes work; the *display* silently fails. macOS's own
  Notification Center db (`group.com.apple.usernoted/db2/db`, read-only copy):
  - `com.deepseek.dsh` (the app both DSH instances run): **0 records, ever**.
  - `com.apple.scripteditor2`: **100 records** — the old plugin's osascript
    fallbacks (the exact bug being fixed).
  - `ai.deepseek.dsh.desktop`: 8 records tonight — the app updater's, so
    macOS *does* accept that bundle's posts; and the per-app settings
    (`group.com.apple.usernoted.plist`): `com.deepseek.dsh` auth=7 — alerts
    allowed. **It is not a "notifications off in System Settings" case.**
- Conclusion: the renderer's `Notification` either reports `denied` (my code
  then takes-and-drops by design) or constructs and Electron's post to
  macOS fails silently. Commit 5f29ff7 makes the plugin *say which* on its
  settings page: a denied take is recorded, and a constructed notification
  that gets no `show` event within 5 s is recorded too; a successful display
  clears the line. Next run's settings page names the cause verbatim.

## Run3 addendum (2026-10-19 ~01:00): a second DSH client was acking

Run3 (hidden, diagnostics client live): item acked ~15 s after queueing, no
banner in 96 frames, no NC entry, and **neither diagnostic in the instance's
localStorage** — because the acking renderer was not the app. Any open
browser tab or the Lead's headless rig is also a DSH client polling the same
queue: headless Chrome reports `denied`, so my code takes-and-drops, no
banner, no NC record — and its diagnostics land in the *rig's* localStorage,
not the instance's partition the Lead scanned. NC db re-read after all runs:
still zero records for `com.deepseek.dsh` — no notification was ever posted
to macOS by the harness app.

Experiment v2 removes the confound: rig closed, window hidden, one fire, 5 s
probes, then the app window's own Plugins → Notifications page (its
partition's diagnostic) and an NC db re-read. The ack timing also dates the
throttle (~15 s grid = full speed; ~60 s+ = Chromium throttling).

## Run v2 (2026-10-19 07:11-07:21 PDT) — confound removed, one mystery left

With the rig closed and the window hidden 5+ hours (Hidden=true verified via
lsappinfo): "Icon proof v2" handback queued 07:18:58; the hidden window's
renderer **acked it between +40 s and +70 s** — hidden-window timers are
alive (about-one-minute worst case, as documented). The region burst missed
the drain (the owner gateway stalled the coordinating turn 7 min, past the
burst end). Two decisive reads after the ack:
- NC db: still **zero** records for `com.deepseek.dsh` — nothing reached macOS.
- Instance localStorage leveldb: **no** "denied in this window" and **no**
  "no show event" string — the show path neither threw nor timed out… or the
  show path never ran because the hidden window *claims* to be watched.

Commit 44eb6f8 settles it in one click: the plugin's page now has **Send a
test notification** (same show path, gesture-legal permission ask) and shows
what the window believed at its last queue poll (focus / visibility /
permission). Open the page in the test window after a hidden-window run and
the page says which world we are in. The banner question is now a user
action, not a race.

## Final verdict (v3, 2026-10-19 9:14-9:27 AM PDT) — the plugin is correct; Electron's post is swallowed

v3 (window visible-but-unfocused then hidden, no other clients, region burst
auto-armed on the item appearing):
- "Icon proof v3 ended without a handback" queued 09:20:48, **acked at the
  renderer's 09:20:54 poll** (poll-state timeline proves the acking renderer
  is the app: 15 s grid, then exactly 60 s — Chromium intensive throttling —
  continuously, permission `granted`, focus false, visibility honest).
- The show path ran (not-watching), the constructor did not throw, and **no
  error string was recorded** — so Electron's `onshow` fired: the shim claims
  the notification was displayed.
- The 50 region frames covering the ack show **no banner** (the only region
  change, 09:21:49, is an incoming phone call, not ours). The macOS
  Notification Center db after every run: **zero records ever for
  `com.deepseek.dsh`** (the app both DSH instances run in), while
  `ai.deepseek.dsh.desktop` (the DSH Desktop shell) has 8 records tonight —
  its own updater's. Script Editor has 100 (the old plugin's osascript
  fallbacks).

**Conclusion for the release checklist:** the notifications plugin now does
everything a DSH window can do — serve the queue, hold while no window can
show, take-and-display with the DSH app's own icon — and the display layer
below it is broken in this app build: Electron's HTML5 Notification in the
DeepSeek Harness app reports `granted`, constructs, fires `show`, and macOS
never receives the post. The same machine delivers notifications fine from
the DSH Desktop shell bundle. **Must-fix-follow-up (DSH/Electron side, not
the plugin): make DSH's own desktopRuntime rows actually serve (they do not
on 0.2.1-rc.2 — `desktop:false`) so the shell's working notification path
carries DSH's icon, or fix the harness app's Electron notification delivery.
Albert's call.**

Proof artifacts: the ack-window region frame (`v3-ack-window-no-banner.jpg`,
no banner, 09:20:54-09:21:03), the leveldb poll-state timeline
(`focus false / visibility honest / permission granted`), and the NC db reads
in this file. The banner+Notification-Center shots the brief asked for are
impossible on this build for ANY DSH window until the follow-up lands.

## Why nothing banners (2026-10-19, ~10:30 AM PDT) — three measured facts

1. **The macOS notification STYLE for both DeepSeek bundles is effectively
   off.** ncprefs (`group.com.apple.usernoted.plist`): `com.deepseek.dsh` and
   `ai.deepseek.dsh.desktop` both auth=7 (alerts allowed) but flags
   0x1080200e — missing the banner bits that FaceTime/MobileSMS carry. Empirical
   anchor: the shell bundle's 8 delivered records are ALL presented=0 (never
   displayed), while Script Editor's are 95/100 presented=1 (displayed; Script
   Editor has no ncprefs entry = defaults = banners). **Fix: Albert flips
   System Settings → Notifications → DeepSeek Harness (and DSH Desktop) →
   Banners. Until then no code path can show a banner for either bundle — the
   shell's own updater notifications don't display either.**
2. **The bare harness app cannot load the desktop plugin at all.**
   `ELECTRON_RUN_AS_NODE` resolve test: `dsh-plugin-desktop` is
   MODULE_NOT_FOUND from DeepSeek Harness.app's resources, and its asar
   contains no such package (only a 4 MB `dsh/desktop-runtime.json` release
   manifest). The DSH Desktop wrapper resolves it (lib/index.js, v2.0.15).
   So on the current live DSH — which is the bare harness (pid 87589, its
   helper serves the 63532 web GUI) — the `desktop-shell` row fails, no
   `desktopRuntime` is provided, `desktop:false` is CORRECT, and the renderer
   path is the only sender… whose posts the harness bundle silently swallows
   (v3). **Fix: run the live DSH via DSH Desktop.app (the wrapper), which is
   the supported desktop surface.**
3. **When the wrapper's DSH runs, DSH's own sender already works.** The 8
   records under ai.deepseek.dsh.desktop are DSH's own notifications
   (updater + "Background Job Completed") — delivered through the wrapper
   bundle on 2026-10-18 21:26-21:32. My plugin's `desktopSend` calls exactly
   that runtime (`notifyAttention({title, body})`), and my plugin covers
   handbacks — the event class the old desktop-notifications row lacks (its
   config: turn completion/failure, job completion/failure only), which is
   why handbacks fell to osascript and showed Script Editor.

**Net for Albert:** flip the two style toggles, run the live DSH from DSH
Desktop.app — handback notifications then deliver through the wrapper bundle
and display with the DSH icon, no further plugin change. The bare-harness
mode needs a DSH-core fix (bundle the desktop plugin or repair its Electron
UN delivery) and is documented above; my renderer path is its only sender
there and is equally dead until then. The glass-notifications test instance
(a bare harness) can therefore never show banners; it proves queue and
renderer logic only.

## CORRECTION (2026-10-19 ~11:15 AM PDT): the harness post DID deliver — style is the only break

The staged close-out check found **record 10371 for `com.deepseek.dsh`,
delivered 2026-10-19 09:20:54, title "'Icon proof v3' ended without a
handback"** — the v3 notification. My earlier "Electron swallows the post"
conclusion was wrong: I read the NC db twice before usernoted flushed the
row (its writes lag by up to ~2 h), and inferred "no record ⇒ no delivery".
The record's presented=0 matches the 50 banner-free frames exactly — the
delivery happened, the display did not, because the **style is off**.

**Final single root cause: macOS notification style for both DeepSeek
bundles (com.deepseek.dsh, ai.deepseek.dsh.desktop) never displays
(presented=0 on every record, 22 shell + 1 harness), while Script Editor
displays 95/100.** One fix: System Settings → Notifications → DeepSeek
Harness (and DSH Desktop) → Banners. After that toggle:
- the plugin's renderer path (any DSH window, hidden or not) banners with the
  DSH icon — proven delivered tonight;
- DSH's own desktop path (the wrapper) banners the same way — its records
  already arrive;
- the old plugin's osascript fallback (Script Editor icon) is gone — my
  plugin covers handbacks and never shells out.

`review/glass-v1/notifications/close-out-check.sh` re-runs the whole check
(style bits + presented counts); when it reports a presented=1 for a
DeepSeek bundle, the release's last item is closed and the banner +
Notification-Center shots follow from any handback.
