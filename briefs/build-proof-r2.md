# Proof round 2 (window, check and tests): builder's notes

Updated: 2026-10-17 3:24 PM PDT (Proof round-2 window builder, a subagent of account B's suite run)
Branch: `suite/v1` (worktree `~/Projects/dsh-plugin-suite`)
Status: host and window fixes for findings 4 to 14 done with unit tests; real-DSH steps and the README next.
The thread that started this one fixes findings 1 to 3 (claims.js, evidence.js, the corpora, "How well it reads").

## What this round fixes (review/proof-round-1.md)
- 4 A verified claim: the flag is headed "Verified by an independent check" (green shield), Proof's reading gives way
  to the check's reason; counted apart as `verified` in the ledger counts, the session rows, the page header
  ("· N verified by an independent check") and the exports (Markdown summary line, JSON counts). "Not verified" heads
  the flag too, with the reason on its line.
- 5 A stopped check names the minutes it was given (`check.minutes`, kept when it starts and through a restart), not
  the setting's. No "Open the check" inside the check thread itself.
- 6 One state per line: a check line is its tag plus the reason only (the reasons in verifier.js no longer start with
  the state); the flag's head drops the line's tag when it says the same; "What the turn shows" only for evidence the
  why does not already give; the header no longer repeats how checks run (the checks card says it once); What happened
  names the session once; the ledger says nothing under the buttons when a check starts (its line says it).
- 7 Inline code in whys, reasons, claims and runs is drawn as code (DSH's compact inline-code look, its own tokens);
  the provider and model are named as DSH's model menu names them (`listProviders`, `resolveModelInfo`); an interrupted
  check says "DSH restarted while it ran, so it ended before it answered."; the model fields stay free text (see picks).
- 8 While a check waits or runs, a note above its thread's message box (`conversation.input.dock`, order 17) says what it
  checks; the note after its first turn says how it ended. Tidying finished check threads: not done (see picks).
- 9 Sessions saved while Proof was off: on start (3 s after) and as the list shows them, their claims are read from their
  logs (newest first, one at a time, at most 200 a start), so they are listed again.
- 10 After Check it / Check again (flag and ledger) the focus goes to the check's line; a refusal or failed export goes to
  its message (alert, takes the focus).
- 11 Copy is logged "Ledger copied as Markdown" (N claims, onto the clipboard), only once the clipboard has it.
- 12 Independent checks are newest first by the time each row shows (ended, else started, else asked); times sit in one
  fixed-width column (8.5em, tabular digits); no claim kind beside a ledger row's tag.
- 13 The checks card offers Open Proof's settings whenever the check is off; README paragraphs to match (next step).
- 14 Checks ask for low effort (else minimal, else the model's default) through DSH's own `resolveCallConfig`; default
  limit 15 minutes, range 1 to 60; the form's hint says a busy shared gateway needs 30.

## Done
- (this commit) `plugins/proof/lib/{config,verifier,ledger,page,remote,index,client}.js`, `test/proof-host.test.js`
  (24 tests), `test/proof-client.test.js` (11 tests).

## Next steps (in order)
1. Real-DSH steps in `plugins/proof/test/e2e/run.mjs` (+ `fake-model.mjs` records the effort): a verified claim's card
   and counts; a check stopped after its limit was changed; a session opened while Proof is off; focus after Check it;
   the restart step asserting the reason's words; the dock note; low effort in the request.
2. `node scripts/e2e.mjs proof` on all three builds with `~/.local/bin/dsh-test fingerprint` before and after
   (live pid 18756, patch 63e0c347…).
3. README by exact string replacements (settings table 15 / 1 to 60, the restart paragraph, Open Proof's settings,
   rollback, Limits, test counts). Not "How well it reads" (the other thread's).

## Picks and why
- F9: Proof folds the logs itself (`sc.inspect` + the projection's own `foldAll`), in memory, instead of writing
  DSH's projection cache: a cold log may hold events DSH has not made durable, and DSH's own hydrate avoids writing
  there. At most 200 logs a start keeps a big history from holding DSH up; a failed read is not retried until the
  session changes.
- F8: DSH draws a turn's tail only after the turn ends, and its turn-trigger node is the coordinator's (it shadows it
  at priority -1), so the running note goes above the message box, where DSH docks a goal. Tidying: DSH's archive
  exists, but an archived thread cannot be opened in the window (its viewer is sent out of it), and DSH offers no
  grouping a plugin can ask for (the coordinator's nesting is its own CSS), so finished check threads stay in the list;
  README Limits says so.
- F7 model list: the suite's settings kit has no list field and is shared by every plugin (not Proof's to change);
  DSH's settings value field takes no suggestions and its model picker is not offered to plugins. So the fields stay
  ids (their hints say so), and every place that shows the model shows DSH's names.
- F14: effort `low` first (a check re-runs a command or reads a file), `minimal` only when there is no low; nothing when
  the model offers neither. Default 15 minutes: the judge saw a busy shared gateway answer first tokens after 4 to 8
  minutes and checks needing 20 to 24; one check runs at a time, so a very long default would hold the queue. 60 is the
  most it can be set to. The hint and the README advise 30 on a busy gateway.
- F11: the window asks for the Markdown with `copy: true` (nothing logged), writes the clipboard, then calls `copied`.
- F4: verified is a claim's state only when its check answered VERIFIED; "not verified" keeps it flagged.
- Window: the focus goes to the check's line itself (role status, tabIndex -1), not its button: the line stays in place
  while the check waits, runs and ends, while its Open the check button comes and goes.

## Gotchas
- The canon tests' DSH stand-ins (`test/fixtures/canon/stubs/hooks.mjs`) load Proof's remote.js and index.js in
  `test/proof-host.test.js` (read only; nothing of Canon's changed).
- evidence.js (not this thread's) still writes commands in backquotes in its whys; the window draws them as code. If
  the other thread rewords whys, nothing here needs to change.
