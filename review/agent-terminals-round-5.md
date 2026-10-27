# Agent Terminals: judge round 5

Commit 8a21b90 (branch goal95/agent-terminals), judged 2026-10-27, 12:02 to 12:36 AM PDT (GOAL95 PASS 2, the plugin's last round tonight). DSH Test instance g95-agent-terminals-j3 (installed app, DSH 0.2.1-rc.3). Model requested: GLM-5.3-Flash-EXL3. Environment fact, not scored: the owner gateway answered my first real-model turn with DeepSeek-V4.1-Flash-1017 (the session log's `responseModel`), so I sent no more real-model turns; the rest of the model turns ran on the e2e harness's scripted model.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.5 | Every job in its brief section works in a real DSH: a session per agent, listed and named, with its terminal tab beside it; resume after restarts in all four ways; paste, Enter again when swallowed, and proof from the agent's own transcript; its state on the row, in the panel badge and in Decisions, with answers typed back in and proven. It replaces the term-new and raw-Enter workarounds outright. |
| Reliability | 9 | It held through everything I threw at it (about 30 cases, below), and round 4's major is fixed in both its forms. But the first message and up to two more Enters go into whatever a program shows before its transcript exists, so a startup question (a folder-trust choice, say) is answered with its default and the message is lost (Finding 1). A damaged `state.json` also drops every agent without a word (Finding 2). |
| UX / polish | 9.5 | DSH's own parts and settings form, glass cards light and dark, Wallpaper on and off, 760 px with nothing off the side, a 2 px ring on all 40 keyboard stops in reading order, plain words, and every refusal and wrong state says what to do next. Left: state-coloured small text on glass at a low tint (DESIGN's open question), and two wording nits. |
| Test depth | 9 | 75 tests of its own (each fix with a test that fails on the old code) and 173 real-DSH checks on each of three builds, all green, proven from transcripts, process arguments, Decisions' log and the window. But no stand-in ever shows a screen before its transcript, so "it never answers a prompt for you" is tested only for prompts the transcript shows (Finding 1 slips through). The window-error check cannot see a plain exception from its own browser half. |
| Docs | 9.5 | A complete README that matched the code in every claim I checked (about 25: the ways, the page, the row, settings with ranges and where they live, files and modes, setup, switching off, rollback with a tag that exists, limits, and the tests: 173 checks, 75 unit tests, about 4 minutes a build here). One sentence overclaims: "never answers a prompt for you" does not hold for a prompt shown before the transcript exists. |

Plugin score: min(U, R, mean) = min(9.5, 9, 9.3) = 9. Verdict: NOT YET (the GOAL95 bar is 9.5 with no criterion below 9).

## What I ran

- **Build.** `git archive 8a21b90 | tar -x` into `~/Projects/goal95/judge/agent-terminals-r5/head`, `.e2e` linked. `node scripts/sync-shared.mjs --check`: exit 0. Since round 4's 44ce483, nothing outside `plugins/agent-terminals` and its two test files changed. The rollback tag `agent-terminals-v1.0.0` exists.
- **Unit tests.** `npm test`: 862 tests, 858 pass, 0 fail, 2 skipped, 2 todo (both todos belong to other plugins). Its own (`node --test test/agent-terminals.test.js test/agent-terminals-client.test.js`): 75 of 75.
- **Real-DSH e2e.** `node scripts/e2e.mjs agent-terminals`, 12:03 to 12:16 AM: 173 of 173 on DSH 0.2.0-rc.2 (255 s), 0.2.1-rc.1 (253 s) and the installed app's 0.2.1-rc.3 (230 s). Every quit of DSH ended within its grace (0.0 to 0.9 s). Its fingerprint check said the live DSH was unchanged. I read the check list: each check tests what it names (one exception, Finding 3).
- **My instance.** `dsh-test --name g95-agent-terminals-j3 up`. The seed's `defaultPreset` was set to `workspace-write` before any turn; the session's log reads preset `workspace-write`. I loaded Session Watch, Decisions and Agent Terminals from my head in that order (row `proofSeconds: 8`), then restart and `doctor` (0 import errors, isolation ok). I drove it through its window endpoints, as the e2e does, from small scripts in my scratch folder. Pictures came from the harness's `openWindow` and `shot` (Playwright), at 1280 and 760 px, light and dark.
- **Stand-in agents only.** `#!/bin/sh` wrappers around the plugin's `test/e2e/fake-agent.mjs`, given by full path, each keeping its conversations in my scratch folder: flags, subcommand, plain, and flags with `--swallow-enter`. For Finding 1, one more wrapper shows a startup choice and logs the keys it gets, then runs the same stand-in. The start form listed the owner's real coding-agent programs under "Found on this computer". I started none of them, and no review picture shows them.
- **The real model.** One listing turn, at 12:06 AM, from the first agent's start. The reply was exactly "The coding agent runs in its terminal tab.", and Decisions stayed empty. `responseModel` was DeepSeek-V4.1-Flash-1017, so I then set `listNewSessions: false` in my row and sent no more real-model turns.

What I exercised, each claim checked at its source: the stand-ins' transcript files, `pgrep` for each program's arguments and pid, Agent Terminals' state and log, Decisions' state and log, and Session Watch's rows.

- **Start, type, prove.** A flags agent started in a new session named after it, its first message proven in about 2 s. A subcommand agent was proven too. A plain agent was *typed in*, not proven, and says why. A name the shell cannot find: exit 127, what to do, no listing turn.
- **Messages.** A long job, then two identical messages and one taken back. The take-back worked. Taking back a message already typed is refused in words. Each identical message was proven by its own transcript line. A message sent while the agent was stopped went in after Start again and was proven. A program that swallows the first Enter got Enter again: "after Enter 2 times (the first was swallowed)".
- **Round 4's major, exactly as reported.** With `typeWhileWorking` on, "dup two #work=6000" was sent twice back to back. The second was typed at 07:19:25.415Z and proven only by its own line (another uuid, 07:19:31.167Z), not by the first's line at 07:19:25.164Z, which falls inside the 2 s slack. Then "dup three #work=60000" twice, with DSH restarted before the agent read the second: the first job was logged as cut once, the second message was typed in again once after the restart, and its own new line proved it (the transcript then held two lines).
- **Questions.** `#ask` made the agent *waiting on you*, with one Decisions card (name, question, recommendation, own words). Answered there with the recommendation, it was typed in and proven, and Decisions' log turned it *delivered*. `#approve` made the other agent wait on a tool call after 20 s, with a card saying to answer in its terminal.
- **Restart at 12:10 AM** under a 60 s job and an open approval prompt. Both agents came back with the same id (`--resume <id>` and `resume <id>`), *idle*. Each cut job was logged once, and no card was left in Decisions. The plain agent was not started again, and its card says why. The log reads "DSH is quitting" (cause quit), then "It started with DSH" (cause dsh).
- **Settings while DSH ran,** each with the agent's pid unchanged (43512):
  - `proofSeconds: "eight"` in the profile: the page names the setting, its range and the value. The agents read "Running in its terminal, not followed", and the open question left Decisions.
  - Fixed: picked up in place, logged "Settings fixed", and the question came back to Decisions.
  - `enabled: false`: the cards still list the running agents, not followed, with only *Open its terminal*; `send` is refused in words, the row marks are off, and the card left Decisions. Back to true: picked up (cause profile), and the card came back.
  - Session Watch switched off (`disabled: true` on its row): the page says it needs Session Watch, with a button to it (cause watch). Back on: picked up (cause watch).
  - Agent Terminals itself switched off, as Plugins writes it: cause off, the card left Decisions. Back on: cause on, and the card came back.
  - A live setting edited in the profile: logged once, "They apply now".
- **The page's actions.** Stop: "You stopped it; its terminal closed". Start again resumed the same id (a new pid). Start anew is refused while the agent runs and works after Stop ("Ready for its first message"). Forget works. An agent's program killed from outside (SIGTERM) reads "It was interrupted (code 143)", and its question left Decisions.
- **Bad input, 15 cases.** An unknown agent, no arguments, empty text, a folder given as the program, a missing folder, an unknown way, a relative conversations folder, "rm -rf" as a program, a second agent in one session, a session that is gone, a 40 KB message, `screen` and `cancel` of unknown ids, and Send again on a delivered message: each refused in words. The exception: a non-string text was typed in as "[object Object]" (nit).
- **A damaged state file.** With my instance stopped, I cut `state.json` short and started it again (Finding 2).
- **Keyboard.** A Tab sweep of 40 stops through the page, in reading order (header, each card's name, Open its terminal, Stop, its message box, Its screen now, then the start form), each with a solid 2 px ring.
- **Startup prompt.** At 12:28 AM, an agent whose program asks a choice before it starts (Finding 1).
- At the end I stopped my agents, destroyed the instance twice (once at 12:24 and again after the startup-prompt check at 12:30 AM), and gave my slots back. No stand-in of mine is left running.

## What I saw (each picture, one line)

In `review/agent-terminals-round-5/`:

- `01-page-waiting-light.png`, `02-page-waiting-dark.png`: the page with real data. The header reads "2 running, 1 of them waiting on you · 2 stopped". The waiting agent shows its question, the recommendation, *Go with the recommendation* and "Your answer". Badges show 1 on Coding agents and Decisions.
- `03-narrow-760-light.png`, `04-narrow-760-dark.png`: 760 px with DSH's rail. The header and cards fit, and the page is no wider than the window (0 px over).
- `05-wrong-setting-light.png`, `06-wrong-setting-dark.png`: `proofSeconds: "eight"`. The banner names the setting, its range and the value, with *Open Agent Terminals' settings*. Cards read *running*, not followed, with only *Open its terminal*.
- `07-enabled-false-light.png`, `08-enabled-false-dark.png`: `enabled: false` while agents run. The off note says how to turn it back on, and each card is *running*, not followed.
- `09-session-watch-off-light.png`, `10-session-watch-off-dark.png`: "Agent Terminals needs Session Watch, which is not running", with *Open Session Watch in Plugins* and *Check again*.
- `11-empty-top-light.png`, `12-empty-top-dark.png`: no agents. "No coding agents yet" says what to do, with *Start a coding agent* (cropped above the found programs).
- `13-keyboard-ring-and-object-message-light.png`: the sweep's last stop, a ring on a What happened link. The same picture shows the "[object Object]" message (nit).
- `14-e2e-app-row-hover-light.png`: the row's hover card ("Coding agent in its terminal: idle", its last reply) beside DSH's own state; the terminal tab beside the session.
- `15-e2e-app-row-menu-light.png`: the ⋯ menu with Agent Terminals' item after the neighbour's; DSH's own items kept.
- `16-e2e-app-terminal-tab-light.png`, `17-e2e-app-terminal-tab-dark.png`: the agent's session with its terminal tab showing the stand-in's screen.
- `18-e2e-app-waiting-call-light.png`: a tool call waits ("It asks to run “touch approved.txt”", *Open its terminal*). The next message is held, with why and *Take back*.
- `19-e2e-app-start-form-light.png`: the start form: Used here before (distinct chips, ~/ paths), the four ways, the conversations folder, where it works.
- `20-e2e-app-start-here-light.png`: *Start a coding agent here* from a session's menu, that session chosen.
- `21-e2e-app-settings-dark.png`: Plugins → Agent Terminals in DSH's own form, with "Changed" and *Use the default*.
- `22-e2e-app-disabled-light.png`: DSH started with `enabled: false`: each agent "Not running … Set enabled to true there".
- `23-e2e-app-after-restart-light.png`: after a restart, the agents back and idle, the cut job said once.
- `24` to `27-e2e-app-wallpaper-*-picture.png`: the Wallpaper stand-in at tint .2, light and dark over a light and a dark picture. Every card is on the reading glass. State tags ("typed in", "delivered", "running") are faint over the far end of a picture (Finding 4).
- `28-e2e-app-wallpaper-off-light.png`, `29-e2e-app-wallpaper-off-dark.png`: Wallpaper off.
- `30-startup-prompt-answered-light.png`: Finding 1. The card reads *idle*, "Ready for its first message", with the first message *not proven* after "Enter pressed 3 times". Its screen shows the startup choice answered "1. Yes, proceed" by those keys.

## Round-4 findings, checked at 8a21b90

1. **Major: a repeated message proven by the earlier message's line, and lost across a restart while it read *delivered*.** Fixed.
   - Each place in a user line proves one message, oldest first, keyed by the line's uuid (or its time), and the place is kept on the delivery (`proofs()` in `lib/transcripts.js`).
   - I reproduced round 4's exact case (`typeWhileWorking` on, back to back) and its restart variant. Each message was proven only by its own line, and the one lost in the restart was typed again once and proven.
   - The unit tests and the e2e cover both.
2. **Minor: the listing turn can put a junk card in Decisions.** Partly fixed.
   - The note now gives the one line to reply with and says no answer is needed. A unit test runs Session Watch's own `askIn` on it.
   - My one real-model turn replied exactly that line, with no card. That model was DeepSeek-V4.1-Flash-1017, not GLM-5.3-Flash, which wrote the junk line in round 4; the gateway allowed no GLM check tonight.
   - A model that asks anyway still makes a card. It is said in What happened, and nothing suppresses or dismisses the card (Finding 5).
3. **Minor: two whys name the wrong cause.** Fixed. Quit, dsh, setting, profile, watch, off and on were each named right, both ways, from DSH's own state.
4. **Minor: `enabled: false` hides agents that still run.** Fixed. The cards stay, *running*, not followed, with only *Open its terminal* (pictures 07, 08, 22).
5. **Nits.** Fixed:
   - Paths read `~/…` in What happened, in refusals and in the chips.
   - Stop says "You stopped it; its terminal closed".
   - A running agent without a transcript gets no spinner: `dotOf()` gives no dot for *running*. I read this in the code and the page test; I did not see such a row.
6. **9.5 item 4 (the e2e switches Agent Terminals itself off and on beside the neighbour; pictures with Wallpaper on and off).** Done. Both are checked on every build (pictures 24 to 29), and the mark comes back in the open window.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Major: before a conversation's transcript exists, the first message and up to two more Enters go into whatever the program shows, so a startup question is answered with its default.**
   - Where:
     - `lib/agents.js` `whenReady()`: ready once the screen is quiet for 1.2 s.
     - `statusFor()`: *starting* plus ready reads *idle*, "Ready for its first message".
     - `gate()`: reads only the transcript.
     - `deliverOne()`: presses Enter again while the agent is idle, up to `enterRetries`, with no transcript yet.
     - None of them looks at the screen for a question.
   - What I saw:
     - The program was a `#!/bin/sh` wrapper that prints "Do you trust the files in this folder? > 1. Yes, proceed / 2. No, exit / Enter to confirm", logs every key until Enter, then runs the plugin's own flags stand-in. It was started from the page's endpoint with a first message, at 12:28 AM.
     - The wrapper logged the message's 36 bytes ("First message after a startup prompt") followed by Enter. That Enter chose "1. Yes, proceed".
     - Two more Enters went into the agent's empty input. The message ended *not proven* ("Look at its terminal: the message may still be in its input box", which is wrong here), and the card read *idle*, "Ready for its first message".
     - Nothing anywhere says a prompt was answered (picture 30).
   - Why it matters: real coding-agent programs show such screens before their first message: a folder-trust choice in a new folder, first-run setup, an approval-mode choice. Starting an agent in a new folder with a first message is the main path. The README's promise, that it "presses no key at all while … an approval prompt is open in it, so it never answers a prompt for you", does not hold there. The stand-ins never show such a screen, so no test sees it.
   - Fix:
     - (a) Before typing into an agent whose conversation has no transcript yet, read its screen (`screenLines`). While the last lines show a question or a choice (a selection marker before numbered options, "(y/n)", "Enter to confirm", "Press Enter", a line ending in "?"), hold the message. Say why: "Its terminal asks something before the agent starts: answer it there; your message goes in after". Count the agent as *waiting on you* (a Decisions card that says to answer in its terminal, like a waiting tool call).
     - (b) Press Enter again only while the screen still shows the message's words in the program's input line. This keeps the swallowed-Enter retry and never sends a bare Enter into something else.
     - (c) Add a stand-in startup prompt to the unit tests and the e2e that fails on any key from Agent Terminals, and passes once the person answers in the tab.
     - (d) Until then, say it under Limits.
2. **Minor: a damaged `state.json` silently drops every agent, and is then overwritten.**
   - Where: `lib/shared/files.js`. `readJson()` returns undefined on a parse error, so `JsonStore` starts from empty data without a word; `writeAtomic()` writes a temp file and renames it with no fsync.
   - What I saw: I stopped my instance, cut `state.json` short, and started it at 12:22 AM. The page listed no agents, and none of the four was started again. What happened and DSH's log said nothing. The next save replaced the damaged file with an empty one (`"agents": {}`, `"recent": []`).
   - Why it matters: writes are atomic, so only outside damage or a crash inside the save (no fsync) causes this. When it happens, the agents simply vanish after a restart, with no reason given.
   - Fix: on a parse failure of an existing file, keep it as `state.json.damaged-<time>`. Log "Could not read its saved agents (state.json was damaged; kept as …)", and say it at the top of the page with what to do. Fsync the temp file before the rename. Add a unit test.
3. **Minor (test depth): the e2e's window-error check cannot see a plain exception from its own browser half.**
   - Where: `test/e2e/run.mjs`. `isSuiteError` (line 499) counts an error only when its words, with addresses removed, name the suite. Page errors are kept as `error.message` only (line 467, no stack).
   - What I saw: the check passes on every build. It printed 274 (app), 54 and 53 other window errors, all shown as "Failed to load resource: 404", and nobody has traced them. My own windows had no other error.
   - Fix: keep `error.stack` for page errors and count those whose frames come from its own client. Log each 404's address (`page.on('response')`) and fail on any under its own endpoints while it is on.
4. **Minor (UX, DESIGN's open question): state-coloured small text on glass at a low tint.** At tint .2 over a mid picture, the e2e measures:
   - Error red: 2.5:1 dark.
   - The "failed" tag: 2.68 dark.
   - The "running" tag: 3.34 dark.
   - The lowest light: 3.73.

   Secondary text passes (4.53 light, 4.60 dark), and with Wallpaper off everything passes (5.43 and 6.84 at the lowest). It is logged, not gated. The tint floor is Albert's open question. Without deciding it, the tags and error lines could get a ground of their own on glass (their fill at a higher opacity), so state words reach 4.5:1 there.
5. **Minor: the listing turn's card is not suppressed.** Agent Terminals already detects a listing reply that asks (`askedInFirstTurn()`), but leaves the card in Decisions. Dismiss that one card through Decisions' own `dismiss` endpoint, and say so in What happened. Re-check once with GLM-5.3-Flash when the gateway serves it.
6. **Nits.**
   - `send` types a non-string text in as "[object Object]" (`lib/agents.js` `send()`: `plainMessage()` stringifies it). The page always sends a string, but the endpoint should refuse anything else: "Write the message first."
   - "Could not start X" in What happened gives as its why "You started X in Y, in a new session". The reason (exit 127, what to do) is only in the next entry. Put the exit words in that entry's why.
   - A card for a program that never ran (could not start) still offers a message box ("It waits until the agent runs again").
   - The ways in the start form show raw flags and placeholder paths (`<data folder>/projects/<folder>/<id>.jsonl`). This is useful for choosing a way, but DESIGN section 9 asks for no raw paths where people read: put the paths under a disclosure.

DESIGN.md's "Before you push" list for its UI:

- Surfaces sit right (an unpainted page with glass cards at tint + .2, flat nested cards, row marks without a ground) ✓.
- Only DSH tokens plus `--wp-blur`, `--wp-tint` and `body.wp-still` ✓.
- No DSH hash selector, nothing on `:root`, `html` or `body`, no `:has()` ✓.
- Motion stops under `wp-still` and reduced motion, pseudo-elements included, and glass thickens under reduced transparency ✓ (read in its CSS).
- `node --check` on the client and `npm test` with the naming scan ✓.
- Both DSH versions and the app, both themes, Wallpaper on and off ✓.
- Off leaves nothing behind and on again repeats nothing (marks leave and come back, the same processes are picked up, nothing is typed twice) ✓.

## What would make it a 9.5

1. Finding 1: no key into a screen that asks before the transcript exists, the agent shown as waiting on you there, and an Enter retry only while the message sits in the input line. Prove it with a stand-in startup prompt in the unit tests and the e2e.
2. Finding 2: a damaged state file kept, said, and never overwritten; fsync before the rename.
3. Finding 3: a window-error check that sees its own exceptions, and the 404 lines traced.
4. Findings 4 to 6 as listed. The listing card should be dismissed when a model asks anyway, and checked once with GLM-5.3-Flash.

## Live DSH fingerprint (before and after)

| When | pid | Started | Patch sha256 |
| --- | --- | --- | --- |
| Before (12:03 AM PDT) | 64099 | Mon Oct 26 15:35:11 2026 | 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be |
| During (12:14 AM, 12:16 AM e2e end) | 64099 | Mon Oct 26 15:35:11 2026 | 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be |
| After (12:30 and 12:34 AM PDT, my instance destroyed) | 64099 | Mon Oct 26 15:35:11 2026 | 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be |

Unchanged. My private copy of the live profile from 12:03 AM matches the live file at the end byte for byte. The e2e's own check said unchanged across all three builds. The 7:28 PM move of the agent-default-model row (before this round) is outside this plugin and was already in the before-value. At the end, `g95-agent-terminals-j3` was destroyed, my slots were given back, and no process I started was running.
