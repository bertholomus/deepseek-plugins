# Recall round 2: the builder's notes

Updated: 6:06 PM PDT (Claude Code, Recall round-2 builder)

## Status

Working through round 1's findings (`review/recall-round-1.md`: 8.0, NOT YET; reliability 8, UX 8).
Findings 1 and 2 done in code and unit tests (their real-DSH steps come with the e2e batch), and with
them Finding 5 (focus after Back), Finding 9's paging, and Finding 8's button names, plain-text
snippets and "1 other section … matches". Finding 3 and 4 next.

## Done (newest first)

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

1. (F2 done.) Run the bench once more after F3 and F6 if the search path changed, and update the
   README table again if it moved.
2. F3 and F4: one honest state per turn (running only while DSH says so; stopped, failed, cut off
   by a restart, cut short); the tool leaves out the asking turn.
3. F6 and F7: the index shrinks after a take-out and a rebuild; undated transcripts take the
   file's time.
4. F8 and F9 rest: the wording slips not yet done (still running of N, nothing-typed others,
   Clear the filters twice, the not-a-folder words, a never-read file, "Read 1 file in 0
   seconds", "Reading what changed" with no total, `~/` in Stopped searching and problem paths,
   middle-cut paths in the folder menu); the kind switcher at 420 px.
5. The e2e: wrong types with `restartWith`, a turn cut by a crash, a stopped turn, focus after
   Back, Wallpaper on and off pictures and contrast, 420 px.
6. README, `npm test`, `node scripts/e2e.mjs recall` on three builds with the fingerprint before
   and after, DESIGN.md "Before you push".

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

## Gotchas

- Other agents have uncommitted files in the worktree (autopilot, decisions, proof, session-watch,
  `test/suite-config.test.js`). Stage only Recall's paths by name.
