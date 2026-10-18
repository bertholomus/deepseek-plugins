# Recall round 2: the builder's notes

Updated: 7:09 PM PDT (Recall round-2 builder)

## Status

Every finding of round 1 (`review/recall-round-1.md`: 8.0, NOT YET; reliability 8, UX 8) is fixed
in code, unit tests and the real-DSH test, except Finding 9's 404 polling (the kit's, see Picks).
At 9a48a2e the real-DSH test passed 103 of 103 on DSH 0.2.0-rc.2 and 0.2.1-rc.1 (the app's build
running). Now: a real-DSH step for the shrink (another DSH's 450 sessions added and taken out in
the form), then the three builds again, `npm test`, DESIGN.md "Before you push".

## Done (newest first)

- 7:09 PM PDT. 9a48a2e: notes counted in sections in the page's count and the tool ("3 matching
  sections in 1 note"), a chosen kind's places named ("1 turn in 1 session" when the agent asked
  for sessions); the page's tags and notes a little deeper on glass (Recall's own rules under
  `.dshrc-page`, the kit's colours untouched); the Index and What happened cards are `main` (what
  people read sits at tint+.2). The real-DSH test grew from 84 to 103 checks: a turn stopped from
  the chat by DSH's own cancel (`E2E:hang` in the scripted model, the bridge's `/cancel`), an agent
  asking about it (told "stopped before it finished (stopped from the chat)", its own turn left
  out), a turn cut by the crash ("cut off by a restart" in rows and the reading view), focus after
  Turn before and Back, Wallpaper on over a light and a dark picture and off (small text measured),
  420 px (the kind switcher fits its row), wrong types in the profile at a restart. Pictures:
  `.e2e/shots/recall/<build>/wallpaper-*`, `narrow-420-*`, `ended-early-*`, `wrong-type-light`.

- 6:43 PM PDT. F6 and the rest of F8, F9's switcher. F6: a new index is made with SQLite's
  incremental vacuum (set before the write-ahead log is switched on: SQLite takes it only before
  the first write, which the first try missed and the test caught). When the index thread is idle
  and rows taken out were a fifth of the index (at least 4,000 rows) or left a fifth of the file
  free (at least 10 MB), and always after a rebuild, it merges the search index's parts and moves
  free pages off the end of the file, a few milliseconds a slice inside its 40 ms budget, then
  empties the write-ahead log; searches are answered between slices; the page gets the new size
  at once (`changed`) and What happened says "Made the index smaller" with before and after (5 MB
  or more). Measured on 620 sessions: rebuild 44.8 MB → 18.1 MB; a 600-session folder taken out
  22.4 MB → 0.7 MB in 62 ms. F8: folder problems in whole sentences with the right advice per
  cause (permission, a file, a path through a file, a loop, the disk), shown once; "under a
  second"; "nothing in it was new"; a file never read does not "stay as last read"; a damaged
  write says "Could not read part of …"; `~/` in "Stopped searching" and problem paths; "what
  Recall read from it (1 note, 3 sections) was taken out"; "Reading new and changed files: 1,200
  of 10,002 read…" or "still looking through ~/x"; one "Clear the filters" (the empty state's
  button is "Search again without the filters"); nothing typed lists no "other turns"; folder menu
  paths cut in the middle at whole folders, whole path for screen readers and the tooltip. F9:
  under 480 px of card the kind switcher's choices are as wide as their words, the chosen one
  wearing DSH's pill (a container query outside the kit). Tests: host (the shrink through the
  engine and through the thread, the log's words, nothing typed), client (index line, folder
  words, empty state, cut paths and the menu's names). 175 tests pass (recall, suite-shared,
  syntax). README: Keeping up, the page, Files, Tests.

- 6:20 PM PDT. F3, F4, F7. Each turn keeps how it ended (DSH's `turn/end` reason and why: who
  stopped it, or the error's message; new `docs.ended` and `docs.why`, SCHEMA_VERSION 4, so an
  older index is built again once). One state per turn, one word for it everywhere (rows, the
  tool's card, the reading view after "of N", the tool's text): still running (this DSH's turn
  only while DSH's agents say its session runs: `ctx.inject(['agents'])` plus `agent/status`,
  `agent/created`, `agent/disposed`, sent to the index thread as a standing `running` call; 30 s
  after DSH says it stopped with no end read, cut off), stopped (from the chat, by its parent
  session, DSH closing it, a plugin), failed (with DSH's message), cut short (max-tokens),
  blocked, cut off by a restart (DSH's `interrupted` closer after a crash, a turn opened while
  one was open, or no end in a session that no longer runs). Another DSH's sessions and
  transcripts keep the file-moved-lately rule. F4: the tool passes the calling agent's session
  (`exec.agent.session.id`) and the search leaves out that session's open turn (counts too).
  F7: an undated transcript turn takes the latest time before it, else the file's modified time.
  Tests: `test/recall-host.test.js` (every end reason, DSH's word on running, the grace, the
  tool's words; the asking turn; undated transcripts), `test/recall-plugin.test.js` (the agents
  wiring through apply), `test/recall-client.test.js` (state words, "turn 9 of 9 · still
  running", the reading view's sentence). README: "How each turn ended", the tool, Limits.

- 6:06 PM PDT. F2: a turn's own words decide. bm25 with the title's weight at 0 (`own`) says
  whether a turn says the words; the index answers that alone for counts with the column filter
  `{prompt reply tools} : (...)` (`parseQuery().own`). Turns that say the words always come first
  (best: by own score, lifted 1.2 when the title says them too, and by recency; newest: by time);
  a session or file whose title alone has them is one result, last, marked "Only its title
  matches", opening at its first turn; "other turns" and the counts are only own hits, title-only
  ones counted apart ("…, and 1 more by title only"; the tool and its card say the same). The
  judge's shapes are in `test/recall-host.test.js` (heron, gyrfalcon 8 turns, a title-only
  session, a note's front-matter title, the reading view's one-file list). Bench (load 6.6):
  median 27.4 ms, p95 80.8 ms, slowest 107.4 ms (before: 26.8 / 79.5 / 139.7); side by side on
  one 10k index, old 26.2 vs new 27.7 ms median. README speed table, ranking and counts updated.
  Also in this step: F9 paging (a short page looks through 4,000 turns before it ends; a list cut
  at the files of 4,000 turns or at its 1,000th result says so on the page and in the tool; never
  a page past 1,000, so no page twice), F5 (Back focuses the button that opened the reading view,
  through Turn before/after; else its row, else the search box), F8 (buttons named with their
  result, such as "Open “Fix the gateway” at turn 4" and "Read “Run log”, turn 2 here"; snippets
  and "Asked" lines as plain text by `lib/plain.js`; "1 other section of this note matches").

- 5:36 PM PDT. F1: every Config key is `z.any()` with its default (`live()` on the live ones), so DSH never
  stops Recall over a type; `checkConfig` names each wrong type in words (one folder without the
  brackets, text for a list, `"yes"`/`"true"`/`"1"` for a switch, a number, a group, an empty value;
  long values cut in the middle); only `enabled: true` starts the index; a wrong value at the start
  is logged once in What happened (and its fix at the next right start); the form flags a saved
  folder value that is not a list (shown in quotes) and a switch saved as "yes"; the not-running
  state is Recall's own (reads `pluginManager/listPlugins`, read only: starting, stopping, off,
  failed, runs-but-unreachable, unknown) and never says "switch it off and on"; "To remove it
  instead" reworded; "Inside ~/…" in folders left out. Tests: `test/recall-plugin.test.js` (apply()
  with stand-ins in `test/fixtures/recall/stubs/`), wrong-type words in `test/recall-host.test.js`,
  the not-running states and the flagged form in `test/recall-client.test.js`.

- 5:05 PM PDT. Baseline bench before any change (suite/v1 at 79b2ff7, Node 22.20.0, M4, other agents
  working): `node scripts/recall-bench.mjs --sessions 10000 --rounds 20`: 10,001 sessions, 120,519
  turns; 260 searches median 26.8 ms, p95 79.5 ms, slowest 139.7 ms; first index 22.4 s, 284.7 MB;
  DSH's thread held up at most 17.2 ms.
- 5:08 PM PDT. Live DSH fingerprint (read only): pid 18756, started Sat Oct 17 10:39:36 2026,
  `cordis.patch.yml` sha256 63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7.

## Next steps

1. Run the real-DSH test with the new shrink step on all three builds (`node scripts/e2e.mjs
   recall`), the live fingerprint before and after (pid 18756, sha256 63e0c347…05eef7); record it.
2. README's Tests section (done in the working tree: 106 checks, the new list); commit by name.
3. `npm test` in full (a clean copy if other agents' uncommitted files break unrelated tests).
4. DESIGN.md "Before you push", ticked below.

## Picks and why

- No trailer lines in commit messages: the brief says so, and it outranks the session's default.
- Wrong values are shown with straight quotes, as Recall's words already did (`("notes" is not
  one)`), not Canon's curly ones; `test/suite-config.test.js` (another agent's, uncommitted) checks
  the other plugins for `(it is "…")` in the same form.

- The not-running state offers "Open Recall in Plugins" (its switch and its state), not its
  settings: DSH serves Recall's settings form only while Recall runs, and with every type taken, a
  setting no longer stops it. It reads DSH's plugin list (`pluginManager/listPlugins`, as Decisions
  reads `listBundles`) and never calls anything that changes it.
- A saved folder value that is not a list shows in the form as the profile has it (`"~/x"`, in
  quotes) so the kit's form flags it; DSH's form model flags only typed text, and showing it bare
  would look right and leave Save off.
- `enabled` is fixed at the start (not live); a wrong one keeps Recall idle. DSH applies a profile
  edit of it by starting Recall again (its loader's ordinary update), so the off text says "DSH
  applies it when you save the file", not "restart DSH".

- Title-only sessions come last in both sorts and open at their first turn (not their newest):
  no turn of theirs says the words, and the first request is what DSH named them from.
- Counts are of turns that say the words; title-only sessions are counted apart, never as turns.
  When the candidates are complete (or the last candidate is title-only in best order) the count
  is taken from them; else the index counts `own` up to 5,000.
- Long lists: rather than page past 4,000 candidate turns (a full scan of every match for each
  page), a short page looks through 4,000 before it ends, and a cut list says so with a way on
  (more words or a filter). The README's Limits say the same.
- Snippets are made plain on the host (`lib/plain.js`), so the page and the tool get the same
  words; single `*` and `_` stay (sums, names), and the reading view keeps the turn as written.

- DSH's word on running sessions comes from its agents service, injected optionally (Recall
  still needs nothing else); without it, this DSH's sessions use the file-moved-lately rule.
- After DSH says a session stopped, its open turn says nothing for 30 s (its end is read about
  1.5 s later) rather than "running" or "cut off".
- Stopped turns' sentences name who stopped them only from DSH's own cause kinds (user, parent,
  disposed, hook); any other reason reads "stopped", never a guess.
- The asking turn is the calling session's open turn (DSH gives a tool the agent, not the turn
  number); the session's earlier turns stay in the results.

- The index gives space back when idle, not in the middle of a take-out: a folder's rows go at once
  (as before), and the space a slice at a time afterwards, so no search waits more than a slice.
  An index made before this change cannot use incremental vacuum; every index of this version is
  new (SCHEMA_VERSION 4 rebuilds older ones), so no full VACUUM (seconds of holding searches).
- A damaged write in a session log is "Could not read part of …: … Recall read on from the next
  whole write." (what happened), not "Could not read …".
- The 404 polling for Session Watch's `wait` while Session Watch is off is left as it is. It is the
  kit's browser hub (inside `// <suite-kit>` in `lib/client.js`, whose name for the endpoint is
  fixed to Session Watch's), and those failed waits are also how the page reads itself again
  without Session Watch (every 4 to 10 s). A fix belongs in the kit for every plugin (ask DSH's
  plugin list whether Session Watch runs before waiting on it), not in Recall alone.
- The narrow kind switcher drops DSH's sliding pill for a pill on the chosen choice itself (equal
  columns as wide as "Transcripts" are what made it too wide); the labels stay whole.

- Tags and notes on Recall's page are a little deeper than the kit's (success 30%, warning 30%,
  info 45%, danger 55% of the state colour into the label colour; the green note 35%), by
  Recall-only rules after the kit's: measured over Wallpaper's lowest tint (.2) on a mid grey they
  read at 4.67:1 or more (they were 3.35 to 4.08). The kit's own colours are not Recall's to change.
- Wallpaper in the real-DSH test is a stand-in for its public values (`body.wp-on`, `--wp-tint`,
  `--wp-blur`, a picture behind DSH's frame made clear), as the calendar test does: the Wallpaper
  plugin is not in this repo, and the live one is not to be touched.
- Light glass over a dark picture (1.56:1 at the far end) and dark glass over a light one (2.22:1)
  are logged, not gated: DESIGN.md lists light glass over a dark picture as an open question for
  Albert, and Recall uses the kit's glass as every suite page does.
- The Index and What happened cards are `main` cards (tint+.2): people read every card on Recall's
  page, and DESIGN.md puts what people read there.
- A note's results are counted in sections, in the page's count and the tool, when only notes are
  searched; with kinds mixed, "turns" stays the one word (a section is one result like a turn).
- The shrink's real-DSH step uses another DSH's sessions written by the corpus the bench uses
  (450 sessions, some 5,000 turns, 15 MB or so of index): enough rows to pass the shrink's 4,000-row
  floor and its 5 MB note, written in a quarter of a second.

- When more than one setting is wrong, the first says what fits and the others are named after it
  ("…; Let agents search past work (tool) is wrong too"), so one look shows all there is to fix;
  each says what fits in turn. The kit shows one problem; Recall's words carry the rest, counted
  instead of named when DSH's 400-character cut would reach them.
- An index from another version of Recall is deleted, not kept as `index.sqlite.old`: it holds only
  copies of what the files say, and after the round-1 index (290 MB for the judge) a kept copy
  would hold the space F6 is about. A damaged index is still set aside (one copy) for a look.
- The suite's log (`lib/shared/journal.js`, the kit's) names an entry `<ms>-<count>` with the count
  starting again at each start, and keeps one entry per name: a start's first entry in the same
  millisecond as the start before's lost one of them (the plugin test failed about one run in five
  under load; a loop of starts lost one in two). Recall times each entry after the newest one in
  its log (`now` option, its own code); the kit's journal is unchanged and the other plugins keep
  the flaw. A fix belongs in the kit.

## Gotchas

- DSH's hot reload (`dsh-hmr`, chokidar) watches the plugin folders a throwaway DSH loads: an edit
  under `plugins/recall` while the real-DSH test runs reloads Recall in the middle of the run (run 2
  on 0.2.1-rc.1 failed its off-and-on check that way, 7:14 PM PDT). Edit only between runs.
- SQLite's `auto_vacuum` must be set before `journal_mode = WAL` on a new file: WAL mode writes the
  header, after which the setting is ignored without an error.

- Other agents have uncommitted files in the worktree (autopilot, decisions, proof, session-watch,
  `test/suite-config.test.js`). Stage only Recall's paths by name.
