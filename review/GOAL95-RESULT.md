# GOAL95-1026 result

Goal (Albert, 2026-10-26): every DSH plugin we own scores **>= 9.5 with no criterion below 9** from a fresh
independent judge per `briefs/JUDGE.md` (bar raised in `~/Projects/goal95/briefs/JUDGE-GOAL95.md`). Hard stop
6:00 PM PDT. Scorecards: `review/<plugin>-round-<N>.md`; every row: `review/SCOREBOARD.md`.

**Interim, 2:50 PM PDT.** The account's usage limit stopped every builder and judge at about 11:00 AM; all resumed
at 1:40 PM. This file is rewritten as scorecards arrive; the 6:00 PM version is final.

| Plugin | Best GOAL95 score | Commit | Branch | Verdict | Top remaining finding |
| --- | --- | --- | --- | --- | --- |
| Agent Terminals | being judged (round 4; earlier best 8.5, round 3, 3290a42) | 44ce483 | goal95/agent-terminals | NOT YET | judge working |
| Autopilot | not judged yet (earlier best 8.5, round 3, ea10517) | db0453a | goal95/autopilot | NOT YET | builder working |
| Calendar | 8.0 (round 1) | 8b7983c | goal95/calendar | NOT YET | DSH's approval for a chat's change does not say what changes; reminders are stored but never fire |
| Canon | being judged (round 4; earlier best 8.0) | b98506f | goal95/canon | NOT YET | judge working |
| Categories | being judged (round 1) | 70977a1 | goal95/categories | NOT YET | judge working |
| Coordinator | being judged (round 1) | bf391bf | goal95/coordinator | NOT YET | judge working |
| Decisions | 9.0 (GOAL95 round 1 = round 5) | ad79740 | goal95/decisions | NOT YET | a question with a dot before its "?" shows only the words after the last dot (`askIn` in `shared/host/words.js`) |
| Discord | being judged (round 1) | f2b4d73 | goal95/discord (dsh-plugin-discord) | NOT YET | judge working |
| DNA Studio | 8.0 (round 1) | cdac02e | goal95/dna-studio (local copy, no remote) | NOT YET | a chat never shows the pictures it made; saving the plugin's settings during a page job marks the job cut off, and Rerun then runs it twice |
| dsh-site | 9.0 (round 2, its last) | af7f673 | goal95/dsh-site (dsh-plugin-dsh-site) | NOT YET | all minor: an answer DSH drops mid-stream stays open on the device; the rest is in the local scorecard (not committed) |
| Fleet | being judged (round 1; card flip 4e24735 and MiniMe's b399db0, b44d7f8 merged) | 3142189 | goal95/fleet (redesign repo) | NOT YET | judge working |
| Focus | 8.5 (round 1) | 3859b8d | goal95/focus | NOT YET | the end of a timer leaves no mark once its 6-second toast is gone, and a hidden window announces the end while still hidden (the README says it tells it later) |
| Hermes Bridge | 8.9 (round 1) | 717b595 | goal95/hermes-bridge (dsh-plugin-hermes-bridge) | NOT YET | UX 8.5: the first read of a window terminal takes the person's control, the icon vanishes in dark, the window never says the bridge is down |
| Notifications | 8.0 (round 1) | b7836d2 | goal95/notifications | NOT YET | news is dropped while DSH's window is in front with nobody at it; a window that cannot show notifications drops the queue; round 2 building |
| Proof | not judged yet (earlier best 7.5) | 4a9e6fc | goal95/proof | NOT YET | builder working |
| Reasoning Pill | 7.5 (round 1); round 2 being judged (the last) | d24800a | goal95/reasoning-pill (redesign repo) | NOT YET | round 2 at d24800a being judged |
| Recall | being judged (round 3; earlier best 8.8, round 2, 2e6de4d) | 7e3cd3f | goal95/recall | NOT YET | judge working |
| Session Bridge | 8.0 (round 1) | b5768b6 | goal95/session-bridge | NOT YET | a retried create runs the job twice; a prompt cut off by a restart cannot be resent with its id; round 2 building |
| Session Watch | being judged (round 1) | 2741f21 | goal95/session-watch | NOT YET | judge working |
| Wallpaper | being judged (round 1) | 29329f7 | goal95/wallpaper (redesign repo) | NOT YET | judge working |

Live DSH: pid 43210, started Mon Oct 26 07:14:47, unchanged at every check. Its patch sha moved at 9:00 AM (a scheduled context job) and at
9:06, 9:31 and 9:45 AM (MiniMe's direct edits of Fleet Shell's `runnerRev`), never from this work; f240a78d… since 9:45 AM.
