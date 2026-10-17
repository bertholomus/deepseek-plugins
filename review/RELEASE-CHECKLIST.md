# RELEASE-CHECKLIST — Wallpaper/Glass + skins, Calendar, Categories (release/glass-v1)

One block per plugin. Verdicts: **ready** / **not yet** + why. Threads own their plugin dirs;
the Lead merges each block from the thread's handback and marks verified only on evidence
(files on disk, test output, screenshots).

- [x] 0.2.1-rc.2 live check (MiniMe 2026-10-17, review/live-021/): host side clean for Calendar, Categories,
  Coordinator, Fleet, Focus, Wallpaper, DNA Studio, minime-bridge, Discord (all activated, no log errors);
  Calendar /api/state = 200; every page rendered. Known gaps recorded below.
- [x] Recorded, no action (fixed live by MiniMe): dsh-site 401 on 0.2.1 (random shell port; cookie jar keeps one
  `dsh-auth-<sha256(authority)>` cookie per authority) — see dsh-site block; and two 0.2.1 config breaks
  ({{cwd}} persona variable; llm-deepseek-account models key) — not plugin code.
- [ ] dsh-test fingerprint before/after each run logged in review/RELEASE-PROGRESS.md (live pid + patch sha unchanged).
- [ ] review/history-scrub.md written (report only; no history rewrite — Albert decides).

## Wallpaper (+ dsh-context skin)
- 0.2.1: in progress (thread t2) — Automation tasks page (@deepseek-ai/dsh-client-ui-schedule, `.abd_5a_calendar`)
  paints an opaque ground; light-mode contrast low on Plugins/Models/Tank + sidebar tiles.
- Glass skin: in progress. Scrub: in progress (generic for public; no personal default headline).
- dsh-context skin: in progress (dsh-context 0.72.0 on 0.2.1-rc.2; upstream notes → review/upstream-dsh-context.md).
- Tests/screenshots: pending. Verdict: **not yet**.

## Calendar
- 0.2.1: host verified clean live; client re-check in progress (thread t3). Glass skin: in progress (DESIGN.md gaps).
- Scrub: in progress (3 files with real calendar names/events). Tests/screenshots: pending. Verdict: **not yet**.

## Categories
- 0.2.1: in progress (thread t4). Glass skin: in progress (DESIGN.md gaps: .dshc-pg ground, --dsh-color-bg-hover,
  drop-line z-index, chevron wp-still). Scrub: in progress (albertlee paths in smoke.mjs). Verdict: **not yet**.

## Coordinator
- 0.2.1: in progress (thread t5). Glass skin: in progress (DESIGN.md gaps: wp-still, header :has(), try/catch,
  slot-id separators). Scrub: in progress (smoke.mjs: frankennas, 100.108.23.102, bertholomus@, ascent-01, /tank).
  Verdict: **not yet**.

## Notifications (must-fix)
- Icon root cause confirmed (Lead, repo): lib/remote.js binds with bindTypertRemote but never marks
  pending/acknowledge as Remote methods → POST /api/dsh-plugin-notifications/pending = 404 → browserAlive()
  always false → every notification falls to osascript → Script Editor icon. Calendar's markRemote
  (lib/remote.js:300) is the pattern.
- Fix in progress (thread t1): markRemote + host/client 404 tests, then renderer queue/throttle (desktop host =
  Electron, DSH_CLIENT_VERSION; flush on focus/visibility; permission asked once; osascript last resort/dropped).
- Proof required: DSH Test 0.2.1-rc.2, hidden + minimised, handback notification, banner + Notification Center
  shots with DSH icon. Verdict: **not yet** (must-fix before release).

## Suite plugins (Autopilot, Decisions, Agent Terminals, Session watch)
- In progress (thread t6): per-plugin glass skin per DESIGN.md + 0.2.1-rc.2 re-check, one commit each.
- Decisions: relay-card fix already landed (15d8bf0, judge 8.0) — glass/0.2.1 pass only. Verdict: **not yet**.

## dsh-site
- 0.2.1: MiniMe fixed live (401: random shell port; per-authority cookie). Lead ported the fix to this branch —
  **verified**: the three hunks match the live known-working code, `node --check` passes,
  `node --test test/cidr.test.js test/syntax.test.js` 82/82. dsh-site is refused in DSH Test (serves beyond
  loopback), so runtime proof is the live app itself; no unit test exists for the cookie-name derivation (it sits
  in the plugin closure) — noted honestly rather than faked.
- Scrub: repo copy is already the generic variant (live copy carries the private README/IPs and stays out of the
  repo). Glass skin: n/a (no UI of its own). Verdict: **ready** (code ported; no DSH-Test runtime check possible).
