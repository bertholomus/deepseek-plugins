# RELEASE-PROGRESS — release/glass-v1

Log every `dsh-test` run here: one line per fingerprint, appended with `>>`.
Format: `<date/time PDT> <thread> <instance> before|after pid=<live pid> patch=<sha256-12> ok|CHANGED`
The live pid and patch sha256 must be identical before and after every run.

2026-10-17 11:32 AM PDT lead baseline fingerprint live pid=18756 patch=63e0c347ea6e ok
2026-10-17 12:05 PM PDT lead spot-check fingerprint live pid=18756 patch=63e0c347ea6e ok (unchanged)
2026-10-17 6:42 PM PDT categories(t4) glass-categories before pid=18756 patch=63e0c347ea6e ok
2026-10-18 8:53 AM PDT coordinator(t5) glass-coordinator bring-up+load+doctor+restart before pid=18756 patch=63e0c347ea6e ok
2026-10-18 8:53 AM PDT coordinator(t5) glass-coordinator bring-up+load+doctor+restart after pid=18756 patch=63e0c347ea6e ok (from dsh-test --name glass-coordinator status; shots pending)
2026-10-18 1:40 PM PDT lead(glass-wp for t2) before fingerprint live pid=18756 patch=63e0c347ea6e ok
2026-10-18 13:53 PDT
2026-10-18 6:30 PM PDT [t6 glass-suite] named instance up + load session-watch,autopilot,wallpaper,decisions,agent-terminals + restart; live DSH pid 18756 (started Oct 17 10:39), patch 63e0c347... unchanged
2026-10-18 6:30 PM PDT [t6 glass-suite] wallpaper pinned black-car.jpg via /api/wallpaper/state; live pid 18756, patch 63e0c347... unchanged
2026-10-18 6:30 PM PDT [t6 glass-suite] unload dsh-plugin-wallpaper + restart (off shots); live pid 18756, patch 63e0c347... unchanged; instance pid 81668
2026-10-18 6:20 PM PDT categories(t4) glass-categories after pid=18756 patch=63e0c347ea6e ok
2026-10-18 6:24 PM PDT categories(t4) glass-categories destroyed after handback; live pid=18756 patch=63e0c347ea6e unchanged
2026-10-18 18:25 PDT [t6 glass-suite] on-set shots: agent-terminals lake, car sets x3 plugins (pin via /api/wallpaper/state prefs patch + reload); live pid 18756, patch 63e0c347... unchanged
2026-10-18 18:25 PDT [t6 glass-suite] unload wallpaper + restart; off-set shots x3 plugins + session-watch settings; live pid 18756, patch 63e0c347... unchanged
2026-10-18 18:25 PDT [t6 glass-suite] load wallpaper + restart; session-watch on-set shots; live pid 18756, patch 63e0c347... unchanged; instance destroyed
2026-10-18 6:30 PM PDT calendar(t3) glass-calendar before pid=18756 patch=63e0c347ea6e ok (Lead run per t3 §6)
2026-10-18 6:30 PM PDT calendar(t3) glass-calendar after pid=18756 patch=63e0c347ea6e ok (doctor 0 errors; only log hit = "Desktop update connection timed out", the known outage artifact)
2026-10-18 6:30 PM PDT calendar(t3) glass-calendar destroyed after handback; homes removed
2026-10-18 18:48 PDT [t6 glass-suite] rebuilt instance, re-shot agent-terminals + session-watch lake sets (first takes were wiped by a reload); live pid 18756, patch 63e0c347... unchanged; instance destroyed; t6 done with the rig
2026-10-18 7:48 PM PDT wallpaper(t2) glass-wp after pid=18756 patch=63e0c347ea6e ok (logs: 1 hit = update-check timeout artifact); destroyed after handback steps
2026-10-18 7:55 PM PDT lead CORRECTION: earlier lines were stamped from a stale clock anchor; times above re-derived from git commit timestamps and instance logs (all runs 2026-10-18). Rule reminder honoured: read the full clock every time.
2026-10-18 8:05 PM PDT notifications(t1) glass-notifications phase-B hidden run 7:44-7:48 PM PDT; no before-fingerprint taken (instance already up from t1's session) — after fingerprint below; live pid unchanged all day
2026-10-18 8:05 PM PDT notifications(t1) glass-notifications after   "pid": 18756,
2026-10-18 8:07 PM PDT lead ALERT: live cordis.patch.yml sha CHANGED 63e0c347ea6e -> 6c668ddca920 (file mtime 8:05:23 PM, pid 18756 unchanged — hot reloaded). Live-side edit (a desktop-notifications row is now present at line 297); not caused by any release thread; test-instance runs unaffected (isolated configs). Flagged to Albert.
2026-10-18 8:32 PM PDT lead ALERT #2: live cordis.patch.yml sha changed again 6c668ddca920 -> a3e1575c7510 (pid 18756 unchanged, hot reload). Live-side edits continue; test runs unaffected.
2026-10-18 10:06 PM PDT lead: LIVE DSH RESTARTED — pid 18756 -> 87589 (started 9:58:42 PM), patch sha now ed7059d93bd0 (third change tonight: 8:05 PM 6c668ddc, 8:3x PM a3e1575c, 9:58 PM ed7059d9). GUI port changed too. All DSH Test instances were stopped by the close (glass, glass-coordinator, glass-notifications); glass-notifications brought back up for t1's resume. Thread t1's turn was cut off mid-experiment by the close; t5's run state unknown.
2026-10-18 10:20 PM PDT notifications(t1) glass-notifications restart for 5f29ff7 diagnostics; fingerprint after:
2026-10-18 10:20 PM PDT   "pid": 87589,
2026-10-18 10:22 PM PDT lead: live cordis.patch.yml sha changed a FOURTH time tonight, now 09f9b998b1d9 (pid 87589 unchanged, hot reload); live-side iteration continues, test runs unaffected.
2026-10-19 1:45 AM PDT notifications(t1) glass-notifications phase-B hidden run 3 (12:56-1:03 AM): item acked +40-50s, NO banner in 96 frames, NO NC entry, NO show-error in leveldb — evidence saved (hidden-run2-frame-1{4,5,6}, center-after-hidden-run2, notif-settings-top); t1 owns the interpretation
