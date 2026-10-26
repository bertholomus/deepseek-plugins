# Session Bridge: judge round 2

Commit 8b7b6ab (branch `goal95/session-bridge`, plugin 0.3.0), judged Mon 2026-10-26, 2:54 to 3:40 PM PDT. DSH Test instance g95-session-bridge-j2a (installed app, DSH 0.2.1-rc.3), model asked for: GLM-5.3-Flash-EXL3 (the gateway answered with another model; see "Environment").

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.5 | Every verb works through DSH's own controller and shows live in the window; one create and one prompt per request id held for overlapping retries, restarts and cut-off turns, proven on disk with the real stack; `dsh-test prompt` rides on it. |
| Reliability | 9 | Everything I threw at it held, except two quiet gaps: a turn DSH tears down (`aborted`, reason `disposed`) reads `answered` with its cut-off text as the reply and is never sent again, and a log that cannot be written is not said anywhere. |
| UX / polish | 9 | Plain words that say what to do next, its own title, sentence and icon in Plugins, light, dark and 760 px; but a failed start reads only "Problem" (the reason is in the bridge's log), and `enabled: false` reads "Running". |
| Test depth | 9 | 42 unit tests and 76 real-DSH checks on all three builds, delivery checked on disk; but a unit test calls every `aborted` turn answered, and an e2e check calls a special case of DSH's failed-start behaviour the rule. |
| Docs | 9.5 | Complete, plain and held to the code by a test; one troubleshooting sentence is only true in a special case, and `wait` above 600 is taken as 600 without saying so. |

Plugin score: min(U, R, mean) = min(9.5, 9, 9.2) = 9. Verdict: NOT YET.

## What I ran

- Extracted 8b7b6ab with `git archive` into `~/Projects/goal95/judge/session-bridge-r2/head`, linked `.e2e`.
- `npm test` (2:55 to 2:56 PM, 89 s): 882 tests, 878 pass, 0 fail, 2 skipped, 2 todo. `test/session-bridge.test.js` alone: 42 of 42.
- `node scripts/e2e.mjs session-bridge` (2:57 to 2:59 PM, own slot): 76 passed, 0 failed on each of DSH 0.2.0-rc.2 (48 s), 0.2.1-rc.1 (56 s) and the app's 0.2.1-rc.3 (49 s); live fingerprint unchanged. I read every check: they test real things (modes, `lsof` listeners, the log's text, both restart paths with the session's log on disk, a crash, settings while DSH runs, off and on from Plugins, the window live).
- DSH Test, real stack. The seeded row answered first as 0.1.0 (no `version` in `/health`). Before any turn I set the instance's `defaultPreset` to `workspace-write`; every session's log on disk starts `permission/preset: workspace-write`, `sandbox/mode: workspace-write`. `load` of the judged folder and a restart: `/health` answered `version: 0.3.0`, `problems: []`; `doctor`: import check 0 errors (4 warnings on DSH's own rows), isolation ok. Throwaway workspaces of my own only. Every claim below was checked in the session's log on disk (zstd-decoded), not only through the bridge:
  - A (2:57 PM): the same `POST /sessions` with one `requestId`, sent twice at once: both answers name one session, one of them `alreadyCreated: true` with `prompt.alreadySent: true`; a third try the same. On disk: one session folder, one `user/message` with that rpcId, answered "PONG".
  - The same prompt and request id sent three times at once to an idle session: one sent, two `alreadySent` (state `waiting`); one message on disk.
  - B (2:58 PM): a long prompt, read by turn 1; a retry while it ran: `alreadySent`, `read`. `dsh-test restart` (forced; DSH killed): `unfinished`, `end.kind: interrupted`. Resent with the same id: `attempt: 2, resent: true`; at once again: `alreadySent`, attempt 2. A settings change at 3:02 PM answered my wait in flight at once with `stopped: true`. `POST cancel` then: `answered`, aborted by the user, attempt 2, and a retry was not sent. On disk: `judgeB-prompt-1` once (turn 1, interrupted), `judgeB-prompt-1~2` once (turn 2, aborted by the user).
  - C (3:07 PM): a create with a prompt, DSH restarted (forced), then the create retried three times (twice, then once after the answer): each `alreadyCreated: true` from `creates.jsonl` (the in-memory map was gone), prompt `alreadySent`; one session in the folder.
  - D (3:08 PM): a long prompt saved on disk, DSH restarted under its turn: `unfinished` (a `wait=30` ended at once); resent with the same id and a short text: attempt 2, answered `completed`, reply "BETA"; a third send: nothing sent. On disk: `judgeD-create-1` once (interrupted), `judgeD-create-1~2` once (completed).
  - E (3:12 PM): a steer into a running turn: `queued`, `next-step`, then read and answered by turn 1 ("STEERED"); a followup meanwhile: `queued`, `next-turn`, answered by turn 2 ("AFTER").
  - `dsh-test prompt` through 0.3.0: reply in 4 s.
  - A 600 s `events?wait` on an idle session (3:12 to 3:22 PM): empty page, `timedOut: true`, 600 s.
  - Refusals, each a 400/404/409 in words before DSH was asked: `~` in a request id, a 129-character id, a create's id for another folder (409 `request/conflict` with the session id), an unknown request id (404), `reasoningEffort` or `provider` alone, a folder that does not exist, `limit=0`, a 501-character title, bad URL encoding.
  - Settings while DSH runs: `maxBodyBytes: "lots"` and a misspelt `socketpath`: both named in `/health` `problems` and in the bridge's log, defaults kept. `socketPath: /tmp/sb-j2a.sock`: refused ("its folder /tmp belongs to another user"), the plugin `failed`, its page "Problem" and "1 failed". `/Users/AlbertLee/sb-j2a.sock` (the home folder in another letter case): refused as shared, the home folder's mode unchanged. A socket another program of mine answered on: refused, and that program still answered. A plain file at the socket path: refused, the file untouched. `enabled: false`: no socket, the log only "stopped", `dsh-test bridge` gets `ENOENT`, the page still "Running". `logFile` in a folder under `/var/log` that does not exist: the bridge answers (a rename went through, 200), logs nothing anywhere, `problems: []`. A socket in an existing folder of mine (755, with another file in it): the folder became 700, not logged, and stays 700 after the bridge leaves.
  - Off and on from the plugin's own page in the window: off, the socket goes and the page reads "Off"; on, it listens again.
  - Security: the socket's folder 700, socket 600, log 600, `creates.jsonl` 600; the process running the bridge listens on TCP only at the window's port (127.0.0.1:19549); neither the log nor the record holds any prompt text or title I sent.
- Scripted experiments in throwaway homes (DSH 0.2.1-rc.1, the suite's scripted model, own slot, 3:25 to 3:27 PM): a bridge prompt's held turn, then (1) a second model added to the model row while DSH runs: the turn went on, unharmed; (2) the agent loop's row changed while DSH runs: DSH ended the turn `aborted` with reason `disposed` (on disk); the bridge said `answered`, `reply: "Working"` (the cut-off partial text), and a retry with the same id came back `alreadySent` (finding 1).
- Not checked: the 20 s and 60 s deadlines on real DSH (no way to make DSH hold a call; the unit tests cover them with a stand-in); a queued prompt removed in the window (unit test only); keyboard and screen reader (the plugin draws no UI of its own).

## What I saw (each picture, one line)

All in `review/session-bridge-round-2/`.

- `plugins-installed-light.png`, `-dark.png`, `-760-dark.png`: Plugins, "Installed plugins": "Session Bridge", its own icon and plain sentence, drawn like DSH's own rows.
- `plugin-page-running-light.png`, `-dark.png`, `-760-dark.png`, `-760-light.png`: its page: title, v0.3.0, sentence, one component "Running"; fits at 760 px in both themes.
- `plugin-page-refused-tmp-light.png`, `-dark.png`: `socketPath` in `/tmp` refused: "1 total · 1 failed", "Problem" in red.
- `plugin-page-refused-hover-light.png`, `plugin-page-refused-click-light.png`: hovering or clicking "Problem" shows no reason.
- `plugin-page-enabled-false-light.png`: `enabled: false`, nothing listens, yet "1 running", "Running", both switches on.
- `plugin-page-switched-off-light.png`: switched off from this page: "Off", "1 off"; the socket is gone.
- `bridged-session-B-live-light.png`: session B live in the window: turn 1 "Task stopped" by the restart, attempt 2 of the same prompt thinking, the spinner in the list.
- `bridged-session-D-attempt2-light.png`, `-dark.png`, `-760-dark.png`, `-760-light.png`: session D: the cut-off turn, then attempt 2 answered "BETA".
- `bridged-session-E-steered-light.png`, `-dark.png`: session E: the long turn that read the steer, completed.

DESIGN.md's "Before you push" list: the bridge draws no UI of its own (no client code, no styles), so the surface, token, selector, motion and Wallpaper items do not apply; `npm test` passes with its naming scan; the e2e ran on both `.e2e` DSH versions and the app's, and the pictures are in both themes; off leaves no socket behind (its folder, log and record stay, finding 6), and on again repeats nothing (C above).

## Findings (most severe first)

1. **Minor, in the core promise: a turn DSH tears down reads `answered`, its cut-off text becomes the reply, and a retry is never sent.** Where: `lib/bridge.js` `UNFINISHED` (line 258) and `attemptState` (line 306) read every `aborted` end as answered; `test/session-bridge.test.js` line 743 asserts it ("stopped on purpose is not resent"); README line 88 defines `answered` as "stopped on purpose (`aborted`, by a cancel or in the window)". What: DSH also ends a running turn `aborted` with `reason: {kind: "disposed"}` when it tears a live agent down (`dsh-agent-loop` teardown, `machine.cancel({kind: "disposed"})`). Proven in a throwaway home: changing the agent loop's row under a running bridge prompt gave `aborted`/`disposed` on disk, `state: answered`, `reply: "Working"` (half a reply), and the retry with the same id `alreadySent`. A cron job that retries until `answered` takes the half reply as the result. The door is rare (a model-row edit did not do it). Fix: read `aborted` by its reason: `user` (and `parent`, `hook`) answered; `disposed` unfinished, sent again as the next attempt; never give a cut-off turn's text as an answered prompt's reply. Add the unit case and an e2e step (the agent loop's row changed under a held turn).
2. **Minor: a log that cannot be written is said nowhere.** Where: `lib/bridge.js` `log()` (lines 493 to 523) swallows every write error; `checkSettings` does not check the log's folder; unit test line 421 holds the silence. What: `logFile: /var/log/judge-sb-j2a/bridge.log` (3:10 PM; the folder does not exist): `/health` said `problems: []`, a rename went through (200), and no line was written anywhere. Every action from then on goes unrecorded, and nothing says so. Fix: on the first failed write, add a `/health` problem ("logFile … cannot be written (EACCES); actions are not logged") and warn once through DSH's logger; try the folder at start.
3. **Minor (docs and test): the way back from a failed start is described too narrowly.** Where: README line 140 ("DSH does not start a plugin that failed to start again when only its row is saved"), the start error in `lib/index.js` line 103, and the e2e check at `test/e2e/run.mjs` line 473. What: in DSH Test (3:05 PM), a fixed row equal to the last row that ran left the plugin failed, but a fixed row that differs from it started the bridge again at once. The e2e restores the identical row, so it proves only the special case and calls it the rule. Fix: say "saving a fixed row starts it again only when the row differs from the last one that ran; off and on in Plugins, or a DSH restart, always does", and check both cases.
4. **Minor (UX): a failed start shows no reason in the window.** Where: DSH's plugin page shows "Problem" and nothing on hover or click; the reason is only in the bridge's log (DSH carries no start error to the page, and its logger keeps it in memory). DESIGN.md §9 States: failed, with the reason. Fix: if DSH offers plugins a notice, raise one with the reason and the log's path; otherwise this stays DSH's limit, and the README already names the log.
5. **Minor (UX): `enabled: false` reads "Running".** Where: `lib/index.js` lines 64 to 68 (the key is the plugin's own; README line 34 says so). What: nothing listens, yet the page says "1 running", "Running", switch on (picture). DESIGN.md §9 asks for one set of state words on every surface, each state with its own word; here the word is wrong. Fix: drop the `enabled` key (DSH's own switch does the job and shows "Off"), or keep it only as a deprecated alias that is named in the README as such.
6. **Nit: an existing folder is closed to 700 without a line.** Where: `prepareSocket` (`lib/bridge.js` line 1162). What: a `socketPath` in an existing folder of mine (755, another file in it) made the folder 700; no log line, and it stays 700 after the bridge moves away. The README says it closes it, but the change is not recorded. Fix: log "closed <folder> (was 755) to 700", or refuse folders the bridge did not make.
7. **Nit: a retried prompt with another text.** Where: `prompt()` (`lib/bridge.js` line 653). What: a retry whose text differs is answered `alreadySent` with the new text's `chars`, and the new text is dropped; after an unfinished turn, the new text goes as attempt 2. Creates refuse a request id reused for another folder, prompts do not compare. Fix: compare with the message in the session's log and answer 409 `request/conflict` on a mismatch, or say in the README that the id alone decides.
8. **Nit: `wait` above 600.** `wait=601` is taken as 600 without a word; README lines 92 and 98 say "0 to 600" (for `limit` it says "more reads as 2000"). Fix: say "more reads as 600".
9. **Nit: cancel on an idle open session** answers DSH's `{"accepted": true}` (200) though no turn ran; a session DSH has not opened gets 409 `session/not-running` (README line 75). Fix: answer 409 `session/not-running` when the open session is idle too.

## Round 1's findings

1. A retried create sends the job twice: **fixed** (A and C above on real DSH, unit and e2e tests).
2. A prompt cut off after DSH saved it can never be resent: **fixed** (B and D above, both attempts once on disk; the e2e runs both paths). Finding 1 above is a rarer door into the same loss.
3. The 60 s prompt deadline not kept: **fixed** in the code (`withDeadline`) and unit test; not reproducible on real DSH.
4. Every read failure is "not found": **fixed** (500 `session/read-failed`; unit test).
5. Plugins page: id, jargon, no icon, a bridge that cannot listen reads "Running": **partly fixed**: title, sentence and icon are right, and a refused bridge reads "Problem", not "Running"; the reason is still not in the window or in a notice (finding 4). Not raised in round 1: `enabled: false` reads "Running" (finding 5).
6. `reasoningEffort` alone dropped: **fixed** (400 in words, seen live).
7. A queued prompt removed from the queue reads `read`: **fixed** in the code and unit test (`dropped`, `removed: true`); not reproduced in the window.
8. The home-folder guard by spelling: **fixed** (device and inode; `/Users/AlbertLee` refused live).
9. The lost wake-up: **fixed** (`void run()` after registering; unit test).
10. The README's wait wording: **fixed** (`stopped: true` seen live; "no such file" when off seen live; the hang-up when DSH quits is said).
11. The log (bytes, symlinks, secrets in ids): **fixed** (code, unit test, README).
12. Delivery proven only through the bridge: **fixed** (the e2e reads the session's log on disk for both restart paths).

## What would make it a 9.5

- Read `aborted` turns by their reason, so a turn DSH tears down is `unfinished` and sent again once, with no half reply passed off as the answer (finding 1), with a unit case and an e2e step.
- Say a log that cannot be written in `/health` and once in DSH's log (finding 2).
- Drop the `enabled` key, so the Plugins page never reads "Running" for a bridge that is off (finding 5); raise the failed start's reason in the window if DSH allows it (finding 4).
- Correct the failed-start sentence and test both row cases (finding 3); the nits 6 to 9.

## Environment

- The coordinator reported that since about 2:41 PM PDT the owner gateway answers requests for GLM-5.3-Flash-EXL3 from DeepSeek-V4.1-Flash-1017. My sessions asked for GLM-5.3-Flash-EXL3 (the instance's default); their logs show `responseModel: DeepSeek-V4.1-Flash-1017` on every real turn (2:57 to 3:18 PM). I sent no real-model turn after I learned it (3:18 PM). This is the gateway's routing, not the plugin's doing, and no score depends on which model answered: the bridge's delivery, states and retries read the same in the session's log either way.
- A throwaway DSH from another plugin's e2e (`dsh-fleet-e2e-…`, pid 97773, started 10:38 AM) was still running when I finished; it is not mine and I left it alone.

## Live DSH fingerprint (before and after)

- Before (2:55 PM PDT): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55. I kept a private copy of the live profile in my scratch folder.
- Around the e2e run (2:57 to 2:59 PM): pid 43210, patch f240a78d…, unchanged.
- 3:15:03 PM PDT: the patch sha256 moved to cb6b0fd75d241842578cb1c2116a7a764a7ea5364e02a58c68f0821e5e7343c8. The diff against my 2:55 PM copy is one line, Fleet Shell's `runnerRev: 35` → `36`: the known direct edit of that line made at the owner's request (RULES.md), in a plugin I never loaded; not mine. I never loaded anything into the live DSH; pid and start time did not change.
- 3:24 PM (instance destroyed) and 3:34:00 PM: pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 cb6b0fd75d241842578cb1c2116a7a764a7ea5364e02a58c68f0821e5e7343c8.
- **After (3:38 and 3:39 PM PDT): the live DSH is a new process.** pid 64099, started Mon Oct 26 15:35:11 2026 (the installed app, launched by launchd); pid 43210 is gone; patch sha256 still cb6b0fd75d241842578cb1c2116a7a764a7ea5364e02a58c68f0821e5e7343c8 (the profile was last written at 3:15:03 PM). Not my doing: my instance was destroyed at 3:24:39 PM; my last DSH (the scripted run in a throwaway home) ended at 3:27 PM and its slot went back at 3:27:11 PM; from then on I only read files and process lists (`ps`, `lsof`, `dsh-test fingerprint`, `slot list`) and wrote this scorecard. Every test above ran while pid 43210 and its start time were unchanged. I stopped there and report it.
