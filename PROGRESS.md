# Progress (Suite v1)

One line per step, Pacific time. `live` is the live DSH fingerprint (`dsh-test fingerprint`: pid, start, cordis.patch.yml
sha256), checked before and after every test run; it must never change.

- 2026-10-16 8:58 PM PDT: start. suite/v1 at e0bdda6 (main a18b87b). DSH Test stopped. live pid 687 since Fri Oct 16 12:22:37, patch e04a0449ecfe8534.
- 2026-10-16 9:05 PM PDT: DSH runtimes 0.2.0-rc.2 and 0.2.1-rc.1 installed under `.e2e/` (gitignored) for the real-DSH e2e tests. live unchanged (pid 687, e04a0449ecfe8534).
- 2026-10-16 9:58 PM PDT: Session Watch and Autopilot written (host, page, READMEs), shared code synced; unit tests 53 new, `npm test` 389/389 pass. No DSH run yet. live unchanged (pid 687, e04a0449ecfe8534).
