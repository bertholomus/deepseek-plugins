# Proof round 2 (window, check and tests): builder's notes

Updated: 2026-10-17 3:52 PM PDT (Proof round-2 window builder, a subagent of account B's suite run)
Branch: `suite/v1` (worktree `~/Projects/dsh-plugin-suite`)
Status: findings 4 to 14 and the 9.5 list's window, check and test items done, with unit tests and real-DSH steps;
README matches. The thread that started this one fixes findings 1 to 3 (claims.js, evidence.js, the corpora,
"How well it reads").

## What this round fixes (review/proof-round-1.md)
- 4 A verified claim: the flag is headed "Verified by an independent check" (green shield), Proof's reading gives way
  to the check's reason; counted apart as `verified` in the ledger counts, the session rows, the page header
  ("· N verified by an independent check") and the exports (Markdown summary line, JSON counts). "Not verified" heads
  the flag too, with the reason on its line. In the ledger's Flagged view a claim checked from there stays, with its
  answer, until the view is chosen again (then it is counted and listed apart).
- 5 A stopped check names the minutes it was given (`check.minutes`, set when it starts running and kept through a
  restart), not the setting's. No "Open the check" inside the check thread itself.
- 6 One state per line: a check line is its tag plus the reason only (the reasons in verifier.js no longer start with
  the state); the flag's head drops the line's tag when it says the same; "What the turn shows" only for evidence the
  why does not already give; the header no longer repeats how checks run (the checks card says it once); What happened
  names the session once; the ledger says nothing under the buttons when a check starts (its line says it).
- 7 Inline code in whys, reasons, claims and runs is drawn as code (DSH's compact inline-code look, its own tokens);
  the provider and model are named as DSH's model menu names them (`listProviders`, `resolveModelInfo`); an interrupted
  check says "DSH restarted while it ran, so it ended before it answered."; the model fields stay ids (see picks).
- 8 While a check waits or runs, a bar above its thread's message box (`conversation.input.dock`, order 17) says what it
  checks; the note after its first turn says how it ended. Tidying finished check threads: not done (see picks).
- 9 Sessions saved while Proof was off: on start (3 s after) and as the list shows them, their claims are read from their
  logs (newest first, one at a time, at most 200 a start), so they are listed again.
- 10 After Check it / Check again (flag) and Check (ledger) the focus goes to the check's line; a refusal or a failed
  export goes to its message (alert, takes the focus).
- 11 Copy is logged "Ledger copied as Markdown" (N claims, onto the clipboard), only once the clipboard has it.
- 12 Independent checks are newest first by the time each row shows (ended, else started, else asked); times sit in one
  fixed-width column (8.5em, tabular digits); no claim kind beside a ledger row's tag.
- 13 The checks card offers Open Proof's settings whenever the check is off; README: the restart paragraph, the rollback
  (no tag yet: restore from a commit), settings 15 / 1 to 60, Limits, the tests.
- 14 Checks ask for low effort (else minimal, else the model's default) through DSH's own `resolveCallConfig`; default
  limit 15 minutes, range 1 to 60; the form's help and the README say a busy shared gateway needs 30.

## Done
- d6ef765 `plugins/proof/lib/{config,verifier,ledger,page,remote,index,client}.js`, `test/proof-host.test.js`,
  `test/proof-client.test.js`, these notes.
- b9d25d0 Real-DSH steps in `plugins/proof/test/e2e/run.mjs` (+ `fake-model.mjs` records each request's effort;
  the check model `fake-check` offers low and high): the focus after Check it and Check; NOT VERIFIED and VERIFIED heading
  their cards; the verified claim counted apart on the ledger, the session row, the header, Markdown and JSON; the bar
  above a running check's message box; the limit raised while a check runs, the check still stopped at its own minute
  and saying so (and its thread's note with no way into itself); low effort on every check request and none on the
  sessions' own; the restart step asserting "DSH restarted while it ran, so it ended before it answered." within 20 s;
  checks newest first with their times in one column; Open Proof's settings while off; Copy logged as a copy; a session
  made and one used while `enabled: false` listed again after the restart. Client: a ledger keeps a claim checked from
  its Flagged view in place. Verifier: a check's minutes are set when it starts running (the e2e saw them missing
  for the first second). README by exact replacements (not "How well it reads").
- Tests: `test/proof-client.test.js` 11, `test/proof-host.test.js` 24; whole repo (HEAD + these files, isolated
  copy) 770 tests: 769 pass, 0 fail, 1 skipped.
- `node scripts/e2e.mjs proof` (isolated copy of HEAD + these files, `.e2e` linked): 112 of 112 on DSH 0.2.0-rc.2
  (133 s), 0.2.1-rc.1 (128 s) and the app's 0.2.1-rc.2 (120 s); live DSH pid 18756, patch 63e0c347… before and after
  (unchanged). A cut check settled within a second of Proof starting again; sessions saved while off were listed
  0.5 s after it answered.

## DESIGN.md "Before you push"
- [x] Surfaces: the flag and the check note are kit panes on DSH's layer 1 in the chat (no ground of their own beyond
  DSH's card), the running-check bar uses DSH's own menu glass above the message box, as DSH's goal bar does.
- [x] Tokens: every new one (`--dsh-composer-*`, `--dsw-specific-menu`, `--dsw-menu-backdrop-filter`,
  `--dsw-elevation-*`, `--dsw-alias-markdown-inline-code`, `--ds-font-family-code`, `--dsw-radius-xs/md`, the state
  colours) is defined in both 0.2.0-rc.2 and 0.2.1-rc.1.
- [x] No DSH-hash selector, nothing on `:root`/`html`/`body`, no `:has()`; no motion added.
- [x] `node --check` on the client; `npm test` passes (isolated copy, above).
- [x] Both DSH versions and the app's build, both themes (the e2e's pictures under `.e2e/shots/proof/<build>/`).
- [x] Off leaves nothing behind, on again repeats nothing (the e2e's switch-off step; the bar is a slot the host
  removes with the plugin).

## Next steps (in order)
1. Nothing left in this brief. A judge's round 2 can start from `review/proof-round-1.md`'s findings 4 to 14.
2. If claims.js or evidence.js reword a why the e2e quotes ("No test ran in this turn.", "No deploy … ran in this
   turn."), update the matching lines in `plugins/proof/test/e2e/run.mjs` and run `node scripts/e2e.mjs proof`.

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
- F4: verified is a claim's state only when its check answered VERIFIED; "not verified" keeps it flagged. A claim
  checked from the ledger's Flagged view stays there with its answer (it would otherwise vanish under the focus the
  moment its check verified it); choosing the view again lists only the claims still flagged, which is what the count
  "Flagged (N)" says.
- Window: the focus goes to the check's line itself (role status, tabIndex -1), not its button: the line stays in place
  while the check waits, runs and ends, while its Open the check button comes and goes.
- The e2e runs in an isolated copy (`git archive HEAD` + this thread's files, `.e2e` linked), so another thread's
  unfinished edits in the shared worktree cannot pass or fail it.

## Gotchas
- The canon tests' DSH stand-ins (`test/fixtures/canon/stubs/hooks.mjs`) load Proof's remote.js and index.js in
  `test/proof-host.test.js` (read only; nothing of Canon's changed).
- evidence.js (not this thread's) writes commands in backquotes in its whys; the window draws them as code. The e2e
  counts the code spans in the contradicted flag from the claim's own why, so a reworded why needs no e2e change.
- A ledger reads its session after it is drawn: an e2e step that reads its counts must wait for it to load
  (`openLedger` waits for its `[data-proof-said]` line).
- DSH's `reasoningEfforts` in a profile is `false` or a map of level to wire value (`low: low`); pi-ai then sends
  `reasoning_effort` on an OpenAI-compatible request.
