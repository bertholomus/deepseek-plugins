# GOAL95-1026 result

Goal (Albert, 2026-10-26): every DSH plugin we own scores **>= 9.5 with no criterion below 9** from a fresh
independent judge per `briefs/JUDGE.md` (bar raised in `~/Projects/goal95/briefs/JUDGE-GOAL95.md`). Hard stop
6:00 PM PDT. Scorecards: `review/<plugin>-round-<N>.md`; every row: `review/SCOREBOARD.md`.

**Interim, 3:29 PM PDT.** The account's usage limit stopped every builder and judge at about 11:00 AM; all resumed
at 1:40 PM. This file is rewritten as scorecards arrive; the 6:00 PM version is final.

| Plugin | Best GOAL95 score | Commit | Branch | Verdict | Top remaining finding |
| --- | --- | --- | --- | --- | --- |
| Agent Terminals | 9.0 (round 4) | 44ce483 | goal95/agent-terminals | NOT YET | a message sent twice back to back is proven by the first one's transcript line, so after a restart the second is never typed yet reads delivered (`provenIn()` in `lib/transcripts.js`) |
| Autopilot | being judged (round 5; earlier best 8.5, round 3, ea10517) | f9f84e7 | goal95/autopilot | NOT YET | judge working |
| Calendar | 8.0 (round 1) | 8b7983c | goal95/calendar | NOT YET | DSH's approval for a chat's change does not say what changes; reminders are stored but never fire |
| Canon | 8.5 (round 4) | b98506f | goal95/canon | NOT YET | usefulness 8.5: the quote is too thin (`bestPassage` in `lib/vault.js`), and after Promote nothing says which of two notes is current |
| Categories | 8.8 (round 1) | 70977a1 | goal95/categories | NOT YET | UX 8: "Add a workspace" shows two blank menu items; a failed save is announced as done and lost at the next restart |
| Coordinator | being judged (round 1) | bf391bf | goal95/coordinator | NOT YET | judge working |
| Decisions | 9.0 (GOAL95 round 1 = round 5) | ad79740 | goal95/decisions | NOT YET | a question with a dot before its "?" shows only the words after the last dot (`askIn` in `shared/host/words.js`) |
| Discord | 8.0 (round 1) | f2b4d73 | goal95/discord (dsh-plugin-discord) | NOT YET | two safety findings (which sessions get the bot's tools, and its channel limit) in the local scorecard (not committed); after a restart, catch-up can miss a person's message without a word |
| DNA Studio | 8.0 (round 1) | cdac02e | goal95/dna-studio (local copy, no remote) | NOT YET | a chat never shows the pictures it made; saving the plugin's settings during a page job marks the job cut off, and Rerun then runs it twice |
| dsh-site | 9.0 (round 2, its last) | af7f673 | goal95/dsh-site (dsh-plugin-dsh-site) | NOT YET | all minor: an answer DSH drops mid-stream stays open on the device; the rest is in the local scorecard (not committed) |
| Fleet | 8.5 (round 1; card flip 4e24735 and MiniMe's b399db0, b44d7f8 merged) | 3142189 | goal95/fleet (redesign repo) | NOT YET | a power cycle cut off by a restart stays "running" for good and hides that Ascent's alarm; Fleet states facts it never read ("nothing running", "No updates") |
| Focus | 8.5 (round 1) | 3859b8d | goal95/focus | NOT YET | the end of a timer leaves no mark once its 6-second toast is gone, and a hidden window announces the end while still hidden (the README says it tells it later) |
| Hermes Bridge | 8.9 (round 1) | 717b595 | goal95/hermes-bridge (dsh-plugin-hermes-bridge) | NOT YET | UX 8.5: the first read of a window terminal takes the person's control, the icon vanishes in dark, the window never says the bridge is down |
| Notifications | 8.0 (round 1) | b7836d2 | goal95/notifications | NOT YET | news is dropped while DSH's window is in front with nobody at it; a window that cannot show notifications drops the queue; round 2 building |
| Proof | being judged (round 4; earlier best 7.5) | 7cc66ef | goal95/proof | NOT YET | judge working |
| Reasoning Pill | **9.5 (round 2)** | d24800a | goal95/reasoning-pill (redesign repo) | **PASS** | nits only; not merged: the redesign repo's main is 101 commits behind claude/split-plugins, which the live DSH runs, so MiniMe takes it from the branch after Albert's OK |
| Recall | being judged (round 3; earlier best 8.8, round 2, 2e6de4d) | 7e3cd3f | goal95/recall | NOT YET | judge working |
| Session Bridge | 8.0 (round 1); round 2 being judged (the last) | 8b7b6ab | goal95/session-bridge | NOT YET | round 2 at 8b7b6ab being judged |
| Session Watch | 8.5 (round 1) | 2741f21 | goal95/session-watch | NOT YET | deliveries live only in memory, so a note queued before a quit is taken back as not delivered after the restart; *waiting for your answer* reaches listeners late |
| Wallpaper | 8.4 (round 1) | 29329f7 | goal95/wallpaper (redesign repo) | NOT YET | at the default tint DSH's own text is unreadable over a picture of the other tone, and an opaque band shows behind the glass composer in every open chat |

Live DSH: pid 43210, started Mon Oct 26 07:14:47, unchanged at every check. Its patch sha moved at 9:00 AM (a scheduled context job) and at
9:06, 9:31 and 9:45 AM (MiniMe's direct edits of Fleet Shell's `runnerRev`), never from this work; f240a78d… from 9:45 AM; cb6b0fd7… since 3:15 PM (MiniMe's runnerRev 35 to 36 for Fleet Shell, diffed against its own backup).
