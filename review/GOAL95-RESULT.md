# GOAL95-1026 result

Goal (Albert, 2026-10-26): every DSH plugin we own scores **>= 9.5 with no criterion below 9** from a fresh
independent judge per `briefs/JUDGE.md` (bar raised in `~/Projects/goal95/briefs/JUDGE-GOAL95.md`). Hard stop
6:00 PM PDT. Scorecards: `review/<plugin>-round-<N>.md`; every row: `review/SCOREBOARD.md`.

**Final, 4:37 PM PDT.** One plugin passes: Reasoning Pill, 9.5. The other 19 are NOT YET. No plugin had more than two judged GOAL95 rounds: Albert held new fix rounds at 1:49 PM ("let the current rounds finish"), allowed one more Discord round for its two safety findings at 3:32 PM, and at 3:53 PM closed the run once Autopilot's judge and that Discord round were done ("Yes, let these two finish"). The account's usage limit stopped every builder and judge from about 11:00 AM to 1:40 PM.

| Plugin | Best GOAL95 score | Commit | Branch | Verdict | Top remaining finding |
| --- | --- | --- | --- | --- | --- |
| Agent Terminals | 9.0 (round 4) | 44ce483 | goal95/agent-terminals | NOT YET | a message sent twice back to back is proven by the first one's transcript line, so after a restart the second is never typed yet reads delivered (`provenIn()` in `lib/transcripts.js`) |
| Autopilot | 9.0 (round 5; round 3 was 8.5) | f9f84e7 | goal95/autopilot | NOT YET | a failed carry-on turn in a session with no todos or goal is never retried and its row says only "failed" (`onTurnEnd` in `lib/pilot.js`); "happy to" or "let me know" in a reply's last lines blocks the nudge, and the README does not say so |
| Calendar | 8.0 (round 1) | 8b7983c | goal95/calendar | NOT YET | DSH's approval for a chat's change does not say what changes; reminders are stored but never fire |
| Canon | 8.5 (round 4) | b98506f | goal95/canon | NOT YET | usefulness 8.5: the quote is too thin (`bestPassage` in `lib/vault.js`), and after Promote nothing says which of two notes is current |
| Categories | 8.8 (round 1) | 70977a1 | goal95/categories | NOT YET | UX 8: "Add a workspace" shows two blank menu items; a failed save is announced as done and lost at the next restart |
| Coordinator | 9.0 (round 1) | bf391bf | goal95/coordinator | NOT YET | a held handback reads "Idle · No handback yet"; a handback whose answering turn a quit cut off is never raised again; an unreadable coordinator.json is overwritten with no copy |
| Decisions | 9.0 (GOAL95 round 1 = round 5) | ad79740 | goal95/decisions | NOT YET | a question with a dot before its "?" shows only the words after the last dot (`askIn` in `shared/host/words.js`) |
| Discord | 8.0 (round 2, its last; round 1 was 8.0) | d9df9aa | goal95/discord (dsh-plugin-discord) | NOT YET | the safety fix is confirmed (the bot's tools only in its own sessions, every id and upload checked); catch-up still loses a person's message without a word in three cases (`catchUp` in `lib/router.js`), and `/model` reports success but changes nothing in a session DSH opened first |
| DNA Studio | 8.0 (round 1) | cdac02e | goal95/dna-studio (local copy, no remote) | NOT YET | a chat never shows the pictures it made; saving the plugin's settings during a page job marks the job cut off, and Rerun then runs it twice |
| dsh-site | 9.0 (round 2, its last) | af7f673 | goal95/dsh-site (dsh-plugin-dsh-site) | NOT YET | all minor: an answer DSH drops mid-stream stays open on the device; the rest is in the local scorecard (not committed) |
| Fleet | 8.5 (round 1; card flip 4e24735 and MiniMe's b399db0, b44d7f8 merged) | 3142189 | goal95/fleet (redesign repo) | NOT YET | a power cycle cut off by a restart stays "running" for good and hides that Ascent's alarm; Fleet states facts it never read ("nothing running", "No updates") |
| Focus | 8.5 (round 1) | 3859b8d | goal95/focus | NOT YET | the end of a timer leaves no mark once its 6-second toast is gone, and a hidden window announces the end while still hidden (the README says it tells it later) |
| Hermes Bridge | 8.9 (round 1) | 717b595 | goal95/hermes-bridge (dsh-plugin-hermes-bridge) | NOT YET | UX 8.5: the first read of a window terminal takes the person's control, the icon vanishes in dark, the window never says the bridge is down |
| Notifications | 8.0 (round 1) | b7836d2 | goal95/notifications | NOT YET | news is dropped while DSH's window is in front with nobody at it; a window that cannot show notifications drops the queue (round 2 was stopped at 1:52 PM before it changed anything, per Albert's "let the current rounds finish") |
| Proof | 8.5 (round 4) | 7cc66ef | goal95/proof | NOT YET | look-only replies (explanations) get flags; quoted claims print "undefined" for " - " inside code or quotes (`unhold()` in `lib/claims.js`) |
| Reasoning Pill | **9.5 (round 2)** | d24800a | goal95/reasoning-pill (redesign repo) | **PASS** | nits only; not merged: the redesign repo's main is 101 commits behind claude/split-plugins, which the live DSH runs, so MiniMe takes it from the branch after Albert's OK |
| Recall | 9.0 (round 3; best so far, round 2 was 8.8) | 7e3cd3f | goal95/recall | NOT YET | a note over 400 sections loses the rest without a word while its folder reads "up to date"; replies show as raw Markdown |
| Session Bridge | 9.0 (round 2, its last) | 8b7b6ab | goal95/session-bridge | NOT YET | a turn DSH tears down reads answered with half its text and is never resent (`lib/bridge.js`); a log that cannot be written is silent |
| Session Watch | 8.5 (round 1) | 2741f21 | goal95/session-watch | NOT YET | deliveries live only in memory, so a note queued before a quit is taken back as not delivered after the restart; *waiting for your answer* reaches listeners late |
| Wallpaper | 8.4 (round 1) | 29329f7 | goal95/wallpaper (redesign repo) | NOT YET | at the default tint DSH's own text is unreadable over a picture of the other tone, and an opaque band shows behind the glass composer in every open chat |

## Waiting on Albert (MiniMe deploys after his OK; nothing here touched the live DSH)

- **Reasoning Pill** (PASS, d24800a, `goal95/reasoning-pill` in the redesign repo): not merged to that repo's main, which is 101 commits behind `claude/split-plugins`, the branch the live DSH runs.
- **Discord** (d9df9aa, `goal95/discord` in dsh-plugin-discord): the safety fix, judged fixed in round 2. The live bot (`~/.dsh-plugins/discord`) has both gaps until it is deployed.
- **dsh-site** (af7f673, `goal95/dsh-site`, judged 9.0): the fix for problems its builder found in the live version (details only in the local `~/Projects/goal95/status/dsh-site.md`); it needs a new `allowHosts` value in the live row.
- **Fleet card flip** (4e24735, `goal95/fleet-card-flip`): running in DSH Test `g95-fleet-flip` (http://127.0.0.1:19533) for Albert to look at. Take MiniMe's 306946a and 8f7eb16 in before any Fleet deploy.

Live DSH: pid 43210, started Mon Oct 26 07:14:47, unchanged at every check until 3:35:11 PM, when Albert restarted it himself ("that was me", 3:42 PM); every DeepSeek Harness process on the Mac, DSH Test instances included, ended with it, and the live app came back as pid 64099 with its profile unchanged. Its patch sha moved at 9:00 AM (a scheduled context job) and at
9:06, 9:31 and 9:45 AM (MiniMe's direct edits of Fleet Shell's `runnerRev`), never from this work; f240a78d… from 9:45 AM; cb6b0fd7… from 3:15 PM, a2c42a4d… from 3:49 PM and 54acaf91… since 4:11 PM (MiniMe's runnerRev 35 to 36, 37 and 38 for Fleet Shell; diffed against a 2:53 PM copy, nothing else changed). Last check 4:38 PM PDT: pid 64099, started 15:35:11.
