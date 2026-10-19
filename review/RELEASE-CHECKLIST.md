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
- [x] review/history-scrub.md written (report only; no history rewrite — Albert decides). **Done** — t7's report
  committed `8d35757`, content Lead-verified (commit/identity/finding spot-checks passed; §8 brand-clean;
  post-snapshot scrubs annotated). Push to gh NOT yet confirmed from the Lead session (github.com unresolvable at
  handback time, branch ahead 1) — Lead will push and reconcile. History-fix options remain Albert's decision.
- [x] Root shared files scrubbed (Lead, verified): test/sends.test.js fixtures frankennas→nas.example,
  100.108.23.102→100.64.0.7, bertholomus@→alex@, ascent-01→host-01, /tank→/data, and (after the history report
  caught it) the real LAN IP 192.168.1.49→192.0.2.49 (TEST-NET-1, commit d7af38c). 550/550 root tests pass.
  Placeholder set for all plugin scrubs: nas.example, 100.64.0.7, 192.0.2.49, /Users/alex, alex@, host-01, /data.
- [x] review/history-scrub.md written by t7 — **Lead-verified** (spot-checked: named commits exist with claimed
  subjects; identity-metadata counts match §8; 192.168.1.49 findings confirmed and acted on). It found:
  192.168.1.49 survived in smoke.mjs ×2 (t5 steered to 192.0.2.49); commit metadata carries the real email and
  GitHub id on every commit; screenshots carry private names (light-Tank.png shows albertlee, light-Fleet.png
  shows FrankenNAS/Ascents). The report tripped test/coordinator.test.js:89 (branding scan) by quoting the
  third-party assistant identity — Lead edited §8 lines 170/174 to describe it without literals; t7 commits the
  fixed file once its git-dir approval lands.
- [ ] DECISION NEEDED (tied to the make-public gate): HANDOFF.md, briefs/*.md and the AGENTS.md account lines carry
  private details (hosts, emails, paths); README.md names the repo clone URL; **commit author/committer metadata
  carries the real email (`albert@dnaclothing.com`, 42+1 commits) and GitHub id on all 338+**; **review screenshots
  carry private names on-screen** (verified two: light-Tank.png, light-Fleet.png — the older round evidence very
  likely too). If the repo goes public: scrub docs, rewrite or squash history (options in the report §"Options"),
  and drop or re-shoot screenshots. Left untouched — builders'/Albert's files.

## Wallpaper (+ dsh-context skin)
- 0.2.1: **verified** (t2 handback, Lead-checked): word-of-class anchors (no hashes), the 0.2.1 Automation tasks
  page now glassed (@deepseek-ai/dsh-client-ui-schedule), data-phase open-chat fix, dockkit Start-page remap
  (53712d5) — commits 7745469 + 53712d5 + 9e91e51 + 303e099, all on the remote.
- Light contrast: **verified** — labels deepened via overrideTokens per DESIGN.md section 3 (Plugins/Models/Tank +
  sidebar tiles); thread reports dark unchanged.
- Generic scrub: **verified** — no personal strings in plugins/wallpaper (Lead grep: albertlee/frankennas//tank/
  bertholomus@ clean); the personal default headline is gone (no hits anywhere in the plugin).
- dsh-context skin: **verified** as an optional in-Wallpaper skin keyed on dsh-context's own elements; checked
  against installed 0.72.0 (read-only); upstream draft at review/upstream-dsh-context.md, NOT posted.
- Tests: root suite 550/550 (Lead-run; includes the naming scan). Wallpaper has no unit-test dir of its own —
  its checks are the naming scan + node --check + the visual matrix.
- Evidence: review/glass-v1/wallpaper/ — 26 files (light/dark × wp-on/off per page, wide+narrow open-chat,
  dock-open); notes review/wallpaper-release.md.
- Instance: fingerprint before/after identical (pid 18756 — see progress log; the later live-side sha change is
  recorded separately and not attributable to this run); destroyed after captures.
- Verdict: **ready**.

## Calendar
- 0.2.1: **verified** — tokens/parts checked on 0.2.1-rc.2 AND 0.2.0-rc.2 (thread); commits 5b0aa26 + 63b0daf on the
  remote (the DNS-outage "local" pushes flushed once the network returned).
- Glass skin: **verified** — all DESIGN.md "Where things stand" Calendar gaps closed: DSH Toast/MenuSurface,
  Modal+Menu un-restyled, DSH tokens deepened, chat cards opaque, --ds-font-family-code, --cal-chip-ring gone,
  reduced-transparency near-opaque (thread's handback; grounds/recipe match section 3).
- Scrub: **verified** — no private strings in plugins/calendar (Lead grep: frankennas/ascent/100.108/192.168.1.49/
  albertlee/bertholomus@/tank all clean); its fixtures were already synthetic.
- Tests: Lead-run — plugins/calendar/test 178/178, root suite 550/550. Thread reports 217/217 on its own run
  and e2e 60/60 (not re-run by the Lead).
- Evidence: review/glass-v1/calendar/ — 71 shots (counted).
- Instance: fingerprint before/after identical (pid 18756, patch 63e0c347ea6e); doctor 0 errors; logs clean
  except the known "Desktop update connection timed out" artifact; destroyed after handback.
- Verdict: **ready**.

## Categories
- 0.2.1: **verified** (t4: tokens/primitives checked against the 0.2.1 ASAR; --dsh-color-bg-hover replaced).
- Glass skin: **verified** — page is one glass card at tint+.2, drop line z-index 30, wp-still motion, rule-6
  text deepening, sidebar ground removed (commits 82e34ed + d9a37f9, pushed).
- Scrub: **verified** — smoke.mjs scrubbed + hermetic; no personal strings in plugins/categories (Lead grep).
- Tests: root suite 550/550 incl. categories (Lead-run); thread reports 33/33 plugin suite.
- Evidence: review/glass-v1/categories/ — six states (light/dark × wp-on/off × pic), pushed.
- Instance: fingerprint before/after identical (pid 18756, patch 63e0c347ea6e); destroyed after handback.
- Verdict: **ready**.

## Coordinator
- 0.2.1: in progress (thread t5). Glass skin: in progress (DESIGN.md gaps: wp-still, header :has(), try/catch,
  slot-id separators). Scrub: in progress (smoke.mjs: frankennas, 100.108.23.102, bertholomus@, ascent-01, /tank,
  plus 192.168.1.49 ×2 — Lead steer: use 192.0.2.49 for the LAN IP to match the root suite).
  Verdict: **not yet**.

## Notifications (must-fix)
- 404 fix: **landed** (cba8aa8) and **API-verified on the test instance** (thread + Lead probe): pending → 200,
  acknowledge → 200, unmarked method → 404 control; desktop:false confirms the renderer is the sender on 0.2.1
  (desktopRuntime absent). End-to-end production path ran once (handback → notify() → queue → renderer took it,
  visible window).
- Hidden-window delivery: **fails as implemented** (Lead phase-B run 7:44-7:48 PM, evidence in
  review/glass-v1/notifications/phase-b-hidden-run-findings.md): the host queue correctly HOLDS the item (no
  osascript fallback — that half works), but the hidden renderer's poller is throttled — item persisted ≥80 s
  past queueing, drained silently, no banner in 13 burst frames, no entry in Notification Center. Fix options
  with t1: backgroundThrottling:false / Web-Worker poller / host push over the typert channel.
- Verdict: **not yet** — must-fix: banner with window hidden + minimised still required before release.
- Side finding: the LIVE DSH still runs the old plugin and falls back to osascript (Script Editor-iconed
  '"Wallpaper release prep …" handed back' seen in Notification Center 7:32 PM); expected until Albert installs
  the fixed build.

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
