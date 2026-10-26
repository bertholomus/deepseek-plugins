# GOAL95-1026 result

Goal (Albert, 2026-10-26): every DSH plugin we own scores **>= 9.5 with no criterion below 9** from a fresh
independent judge per `briefs/JUDGE.md` (bar raised in `~/Projects/goal95/briefs/JUDGE-GOAL95.md`). Hard stop
6:00 PM PDT. Scorecards: `review/<plugin>-round-<N>.md`; every row: `review/SCOREBOARD.md`.

**Interim, 2:27 PM PDT.** The account's usage limit stopped every builder and judge at about 11:00 AM; all resumed
at 1:40 PM. This file is rewritten as scorecards arrive; the 6:00 PM version is final.

| Plugin | Best GOAL95 score | Commit | Branch | Verdict | Top remaining finding |
| --- | --- | --- | --- | --- | --- |
| Agent Terminals | being judged (round 4; earlier best 8.5, round 3, 3290a42) | 44ce483 | goal95/agent-terminals | NOT YET | judge working |
| Autopilot | not judged yet (earlier best 8.5, round 3, ea10517) | db0453a | goal95/autopilot | NOT YET | builder working |
| Calendar | 8.0 (round 1) | 8b7983c | goal95/calendar | NOT YET | DSH's approval for a chat's change does not say what changes; reminders are stored but never fire |
| Canon | not judged yet (earlier best 8.0) | ccb2309 | goal95/canon | NOT YET | builder working |
| Categories | not judged yet | 49d6df3 | goal95/categories | NOT YET | builder working |
| Coordinator | not judged yet | 1f75b1e | goal95/coordinator | NOT YET | builder working |
| Decisions | 9.0 (GOAL95 round 1 = round 5) | ad79740 | goal95/decisions | NOT YET | a question with a dot before its "?" shows only the words after the last dot (`askIn` in `shared/host/words.js`) |
| Discord | being judged (round 1) | f2b4d73 | goal95/discord (dsh-plugin-discord) | NOT YET | judge working |
| DNA Studio | 8.0 (round 1) | cdac02e | goal95/dna-studio (local copy, no remote) | NOT YET | a chat never shows the pictures it made; saving the plugin's settings during a page job marks the job cut off, and Rerun then runs it twice |
| dsh-site | 8.0 (round 1) | 56fa8e9 | goal95/dsh-site (dsh-plugin-dsh-site) | NOT YET | round 2 at af7f673 being judged (last round) |
| Fleet | not judged yet (card flip 4e24735 ready in DSH Test) | 70be782 | goal95/fleet (redesign repo) | NOT YET | builder working |
| Focus | being judged (round 1) | 3859b8d | goal95/focus | NOT YET | judge working |
| Hermes Bridge | being judged (round 1) | 717b595 | goal95/hermes-bridge (dsh-plugin-hermes-bridge) | NOT YET | judge working |
| Notifications | 8.0 (round 1) | b7836d2 | goal95/notifications | NOT YET | news is dropped while DSH's window is in front with nobody at it; a window that cannot show notifications drops the queue; round 2 building |
| Proof | not judged yet (earlier best 7.5) | 4a9e6fc | goal95/proof | NOT YET | builder working |
| Reasoning Pill | 7.5 (round 1); round 2 being judged (the last) | d24800a | goal95/reasoning-pill (redesign repo) | NOT YET | round 2 at d24800a being judged |
| Recall | not judged yet (earlier best 8.8, round 2, 2e6de4d) | 8b70bff | goal95/recall | NOT YET | builder working |
| Session Bridge | 8.0 (round 1) | b5768b6 | goal95/session-bridge | NOT YET | a retried create runs the job twice; a prompt cut off by a restart cannot be resent with its id; round 2 building |
| Session Watch | not judged yet | c0c4d23 | goal95/session-watch | NOT YET | builder working |
| Wallpaper | being judged (round 1) | 29329f7 | goal95/wallpaper (redesign repo) | NOT YET | judge working |

Live DSH: pid 43210, started Mon Oct 26 07:14:47, unchanged at every check. Its patch sha moved at 9:00 AM (a scheduled context job) and at
9:06, 9:31 and 9:45 AM (MiniMe's direct edits of Fleet Shell's `runnerRev`), never from this work; f240a78d… since 9:45 AM.
