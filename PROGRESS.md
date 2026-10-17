# Progress (Suite v1)

One line per step, Pacific time. `live` is the live DSH fingerprint (`dsh-test fingerprint`: pid, start, cordis.patch.yml
sha256), checked before and after every test run; it must never change.

- 2026-10-16 8:58 PM PDT: start. suite/v1 at e0bdda6 (main a18b87b). DSH Test stopped. live pid 687 since Fri Oct 16 12:22:37, patch e04a0449ecfe8534.
- 2026-10-16 9:05 PM PDT: DSH runtimes 0.2.0-rc.2 and 0.2.1-rc.1 installed under `.e2e/` (gitignored) for the real-DSH e2e tests. live unchanged (pid 687, e04a0449ecfe8534).
- 2026-10-16 9:58 PM PDT: Session Watch and Autopilot written (host, page, READMEs), shared code synced; unit tests 53 new, `npm test` 389/389 pass. No DSH run yet. live unchanged (pid 687, e04a0449ecfe8534).
- 2026-10-16 10:30 PM PDT: real-DSH bench and Autopilot e2e (47 checks): 47/47 on DSH 0.2.0-rc.2 and 47/47 on 0.2.1-rc.1, throwaway homes. Fixed what it found (endpoints not served, raw error JSON, wording, counts). `npm test` 404/404. live before and after: unchanged (pid 687, e04a0449ecfe8534).
- 2026-10-16 10:37 PM PDT: DSH Test `suite-autopilot` (installed app, GLM-5.3-Flash-EXL3): doctor 0 errors; idle nudge delivered after 60 s; restart under two running turns, both resume notes delivered; the model finished both tasks after the notes. live before and after unchanged (pid 687, e04a0449ecfe8534).
- 2026-10-16 10:40 PM PDT: READMEs (Setup, Rollback, Tests) for Autopilot and Session Watch, root README lists both; DSH's data folder from `dshHomePath`. `npm test` 408/408. live unchanged (pid 687, e04a0449ecfe8534).
- 2026-10-16 10:44 PM PDT: the real-DSH test also runs on the installed app's own DSH (run as Node by the app's binary, throwaway home): Autopilot 47/47 on 0.2.0-rc.2, 47/47 on 0.2.1-rc.1, 47/47 on app-0.2.0-rc.2. Judge protocol in `briefs/JUDGE.md`; builder pictures from DSH Test in `review/autopilot-builder/`. `npm test` 408/408. live before and after unchanged (pid 687, e04a0449ecfe8534).
- 2026-10-16 11:17 PM PDT: Decisions host half (cards, holds in DSH's approval and question requests, inbox, mirror, config, page state, endpoints) and 31 unit tests; the watcher folds replies' asks and reads other projections. `npm test` 442/442. No DSH run. live unchanged (pid 687, e04a0449ecfe8534).
