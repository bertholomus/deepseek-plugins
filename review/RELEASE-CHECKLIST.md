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
- 404 fix: **landed** (cba8aa8 + 7 follow-up commits through 4dcbbf6) and **API-verified on the test instance**
  (thread + Lead probe): pending → 200, acknowledge → 200, unmarked method → 404 control; desktop:false confirms
  the renderer is the sender on 0.2.1. End-to-end production path ran (handback → notify() → queue → renderer
  took it, visible window). Tests 26/26 (Lead-run).
- Hidden-window delivery: **plugin behavior proven; the display failure is below the plugin**. Lead's three
  instrumented runs (evidence in review/glass-v1/notifications/): the host queue holds the item (no osascript
  fallback — the old bug is gone), the hidden renderer acks within ~15 s to ~1 min, but no banner appears in
  ~220 burst frames, no Notification Center entry is ever created, and the show path records neither "denied"
  nor "no show event" — i.e. the show path is likely never reached (ack-and-drop) or macOS swallows the post.
  A second-DSH-client confound (the Lead's headless rig acking the same queue) was identified and removed in
  run 3 (9b2ba0d). t1's verdict: the plugin is correct end to end; the remaining cause is Electron-side and
  goes to the release write-up as a must-fix-follow-up for Albert's decision.
- Final verdict (t1, v3 instrumented run, 289c00c): **the plugin is correct end to end; the blocker is the
  harness app's Electron notification post, which never reaches macOS**. The app renderer acks in ~15 s
  (poll-state timeline: 15 s grid = Chromium's 60 s throttling; focus false, visibility honest, permission
  granted), the show path runs, the constructor doesn't throw, onshow fires — Electron claims displayed —
  while ~70 auto-armed region frames over the ack show no banner and macOS's NC database has ZERO records
  ever for com.deepseek.dsh (the DSH Desktop shell's own bundle ai.deepseek.dsh.desktop has 8 working
  records; Script Editor's 100 are the old osascript fallbacks). A second-DSH-client confound (the Lead's
  headless rig acking the same queue) was identified and removed in run 3 (9b2ba0d). The banner/NC shots the
  brief wanted cannot exist on 0.2.1-rc.2 for any DSH window.
- Consequence Albert must weigh: on this build the fix changes wrong-icon-but-visible (old osascript) into
  queued-then-silently-dropped (new path). Options: (a) hold until `desktopRuntime` actually serves on
  0.2.1-rc.2 so the shell's working path carries DSH's icon; (b) plugin-side last-resort osascript when the
  show path records "not displayed" (visible again, wrong icon, strictly better than silence); (c) ship as-is
  with the documented behavior. NOT the plugin's defect in any case.
- ROOT CAUSE (t1, c2c67a9 — all measured): three independent breaks, and NO further plugin change is needed.
  [1] STYLE: both DeepSeek bundles have the macOS notification style effectively OFF (ncprefs flags
  0x1080200e, missing the banner bits FaceTime/MobileSMS carry) — proof: the shell bundle's 8 delivered
  records are ALL presented=0 (never displayed) while Script Editor's are 95/100 presented=1. Until the
  toggles flip, NO code path can banner for either bundle — even the shell's own updater notifications
  don't display. [2] The current live DSH is the BARE HARNESS (pid 87589, GUI 63532): dsh-plugin-desktop is
  MODULE_NOT_FOUND from DeepSeek Harness.app (4 MB release manifest asar), so the desktop-shell row cannot
  load, no desktopRuntime — desktop:false is CORRECT there and the swallowed renderer post is expected.
  The live DSH must run via DSH Desktop.app (the wrapper resolves dsh-plugin-desktop 2.0.15 from its lib).
  [3] The wrapper path already delivers: the 8 records under ai.deepseek.dsh.desktop are DSH's own
  (updater + Background Job Completed) — the plugin's desktopSend calls exactly that runtime, and the
  plugin covers handbacks (the event class the old desktop-notifications row lacked).
- NET: Albert flips the two notification-style toggles (System Settings → Notifications → DeepSeek Harness
  + DSH Desktop → Banners) and runs the live DSH from DSH Desktop.app → handbacks deliver through the
  wrapper bundle and banner with the DSH icon, zero further plugin change. t1 verifies via the NC db
  presented flag (read-only) the moment that's done. The glass-notifications test instance is a bare
  harness and can never banner — it proves queue/renderer logic only; 26/26 tests + the v3 instrumentation
  stay as the regression net.
- Verdict: **ready (plugin correct and complete)** — the remaining two steps are Albert's system actions;
  after them t1 confirms presented=1 and this block closes.
- Side finding: the live config was edited/restarted several times tonight (sha 63e0c347→6c668ddc→a3e1575c→
  ed7059d9→09f9b998, pid 18756→87589) — all live-side, none from the release threads.

## Suite plugins (Autopilot, Decisions, Agent Terminals, Session watch)
- Glass skins: **verified** — the four clients share one window kit that already implements the DESIGN
  section 3 recipe; t6 verified rather than restyled. Only commit needed: `8ec576c` (Autopilot verification;
  the other three needed no code change). Decisions' round-2 relay-card fix (15d8bf0) untouched.
- 0.2.1: **verified** — token sheets + slot keys matched against the 0.2.1-rc.2 asar (read-only scan);
  all slots the suite injects exist; per-plugin details in review/suite-release.md §Per-plugin (all PASS).
- Scrub: **verified** — no personal strings in any of the four plugins (Lead grep).
- Tests: root suite 550/550 at HEAD (Lead-run; includes the shared-kit copy check and the branding scan).
- Evidence: review/glass-v1/{autopilot 7, decisions 8, agent-terminals 8, session-watch 6} files; DSH Test
  glass-suite, 1280×820, Wallpaper on/off per page; no page errors during shot runs.
- Instance: destroyed after the rig runs (progress log); fingerprint unchanged through t6's runs.
- Note: t6's final handback has not arrived (its session went idle after the live-DSH close), but every
  claim above is Lead-verified from commits, evidence files and tests.
- Verdict: **ready**.

## dsh-site
- 0.2.1: MiniMe fixed live (401: random shell port; per-authority cookie). Lead ported the fix to this branch —
  **verified**: the three hunks match the live known-working code, `node --check` passes,
  `node --test test/cidr.test.js test/syntax.test.js` 82/82. dsh-site is refused in DSH Test (serves beyond
  loopback), so runtime proof is the live app itself; no unit test exists for the cookie-name derivation (it sits
  in the plugin closure) — noted honestly rather than faked.
- Scrub: repo copy is already the generic variant (live copy carries the private README/IPs and stays out of the
  repo). Glass skin: n/a (no UI of its own). Verdict: **ready** (code ported; no DSH-Test runtime check possible).
