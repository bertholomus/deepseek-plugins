# Recall round 2: the builder's notes

Updated: 5:36 PM PDT (Claude Code, Recall round-2 builder)

## Status

Working through round 1's findings (`review/recall-round-1.md`: 8.0, NOT YET; reliability 8, UX 8).
Finding 1 done in code and unit tests (its real-DSH step comes with the e2e batch); Finding 2 next.

## Done (newest first)

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

1. F2: a title-only match counts once per session and never above a turn that says the words;
   "other turns" and counts only from turns with their own hit; bench before and after.
2. F3 and F4: one honest state per turn (running only while DSH says so; stopped, failed, cut off
   by a restart, cut short); the tool leaves out the asking turn.
3. F6 and F7: the index shrinks after a take-out and a rebuild; undated transcripts take the
   file's time.
4. F5, F8 and F9: focus after Back, the wording slips, middle-cut paths, button names, the kind
   switcher at 420 px, paging past the candidate cap.
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

## Gotchas

- Other agents have uncommitted files in the worktree (autopilot, decisions, proof, session-watch,
  `test/suite-config.test.js`). Stage only Recall's paths by name.
