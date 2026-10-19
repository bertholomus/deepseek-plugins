# RELEASE-PROGRESS — release/glass-v1

Log every `dsh-test` run here: one line per fingerprint, appended with `>>`.
Format: `<date/time PDT> <thread> <instance> before|after pid=<live pid> patch=<sha256-12> ok|CHANGED`
The live pid and patch sha256 must be identical before and after every run.

2026-10-17 11:32 AM PDT lead baseline fingerprint live pid=18756 patch=63e0c347ea6e ok
2026-10-17 12:05 PM PDT lead spot-check fingerprint live pid=18756 patch=63e0c347ea6e ok (unchanged)
2026-10-17 6:42 PM PDT categories(t4) glass-categories before pid=18756 patch=63e0c347ea6e ok
2026-10-18 8:53 AM PDT coordinator(t5) glass-coordinator bring-up+load+doctor+restart before pid=18756 patch=63e0c347ea6e ok
2026-10-18 8:53 AM PDT coordinator(t5) glass-coordinator bring-up+load+doctor+restart after pid=18756 patch=63e0c347ea6e ok (from dsh-test --name glass-coordinator status; shots pending)
2026-10-18 8:22 AM PDT lead(glass-wp for t2) before fingerprint live pid=18756 patch=63e0c347ea6e ok
2026-10-18 13:53 PDT
2026-10-18 13:58 PDT [t6 glass-suite] named instance up + load session-watch,autopilot,wallpaper,decisions,agent-terminals + restart; live DSH pid 18756 (started Oct 17 10:39), patch 63e0c347... unchanged
2026-10-18 13:58 PDT [t6 glass-suite] wallpaper pinned black-car.jpg via /api/wallpaper/state; live pid 18756, patch 63e0c347... unchanged
2026-10-18 13:58 PDT [t6 glass-suite] unload dsh-plugin-wallpaper + restart (off shots); live pid 18756, patch 63e0c347... unchanged; instance pid 81668
2026-10-18 9:05 AM PDT categories(t4) glass-categories after pid=18756 patch=63e0c347ea6e ok
2026-10-18 9:20 AM PDT categories(t4) glass-categories destroyed after handback; live pid=18756 patch=63e0c347ea6e unchanged
2026-10-18 18:25 PDT [t6 glass-suite] on-set shots: agent-terminals lake, car sets x3 plugins (pin via /api/wallpaper/state prefs patch + reload); live pid 18756, patch 63e0c347... unchanged
2026-10-18 18:25 PDT [t6 glass-suite] unload wallpaper + restart; off-set shots x3 plugins + session-watch settings; live pid 18756, patch 63e0c347... unchanged
2026-10-18 18:25 PDT [t6 glass-suite] load wallpaper + restart; session-watch on-set shots; live pid 18756, patch 63e0c347... unchanged; instance destroyed
2026-10-18 10:10 AM PDT calendar(t3) glass-calendar before pid=18756 patch=63e0c347ea6e ok (Lead run per t3 §6)
2026-10-18 10:10 AM PDT calendar(t3) glass-calendar after pid=18756 patch=63e0c347ea6e ok (doctor 0 errors; only log hit = "Desktop update connection timed out", the known outage artifact)
2026-10-18 10:10 AM PDT calendar(t3) glass-calendar destroyed after handback; homes removed
