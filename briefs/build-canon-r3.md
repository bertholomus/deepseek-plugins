# Canon round 3: builder's notes

Updated: 2026-10-17 7:49 PM PDT (Canon round-3 builder)
Branch: `suite/v1` in `~/Projects/dsh-plugin-suite`
Status: under way. Finding 1 is in (rule 3405922, dev set and measure 7cc1c48, README 14893d8); Findings 2 and 3 in (next commit); 4, 5, 6 next.
Vault frozen at f7283b5: test/fixtures/canon/vault (not changed this round).

Live DSH fingerprint before any work (6:47 PM PDT): pid 18756, started Sat Oct 17 10:39:36 2026, patch sha256
63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7.

## Done (newest first)
- Finding 3: `walk()` keeps the folders inside the vault it may not list (not ENOENT/ENOTDIR); the vault's status counts
  them (`counts.closed`) and names the first 20 (`closed`); the header says "1 folder Canon may not read:
  Projects/osprey-mobile. Its notes are never added to turns: give DSH access to it, then read the vault again.";
  What happened notes it once (`closedEntry`), and "Every folder in the vault can be read again" after. Unit tests at
  the vault and the plugin level (a chmod 000 folder in the test's own copy).
- Finding 2: the host works out what a live setting in quotes would be without them when that is right
  (`config.js unquoted`: "3" → 3 for a number in range, "false" → false for a switch) and gives it with the problem;
  the waiting state offers **Save it as 3**, which saves through DSH's own settings call
  (`configForms.get('canon').set(key, value)`), and the page then says "Saved “Notes a turn, at most” as 3, without
  quotes. Canon works again." If DSH does not take it, it says so. Not offered for `enabled` (profile only).
- README (Finding 1): the fit rule in "What a turn gets"; "How well it picks notes" with round 3's dev set (its make-up,
  round 2's rules against now, the coding row, by kind), round 2's section and both hold-outs' paragraphs kept with
  every figure as it was, the second hold-out's line, "What it still misses" for round 3.
- The fit rule (Finding 1), chosen on dev only. Dev, 238 prompts: first note answers 59 of 67 (88.1%), an answering
  note in the block 64 of 67 (95.5%), 0.30 notes per block that do not answer (19 in 64), no block 170 of 171 (99.4%),
  everyday coding requests with no block 139 of 140 (99.3%). The brief's aims (coding 95%, first 85%, block 93%) are
  met on dev. `node scripts/canon-relevance.mjs --set dev --misses` shows the 20 misses.
- The dev set: round 2's 77 prompts, 48 everyday coding requests of my own (c01 to c48: 21 from the vault's projects'
  folders, 15 from unrelated folders, 12 with none), the judge's fixture set (53, ids `jf-`) and generic set (60, ids
  `jg-`), each with a `kind`: answers 67, coding 140, project 9, chat 8, vault 8, other 6. The helper and script: the
  coding row and its 90% floor (#33), the by-kind line, `--set holdout2`, a second hold-out test that skips while the
  file is absent.
- Baseline (6:45 PM PDT, round 2's rules, measured with the helper as it was). Dev (77): first note answers 43 of 47
  (91.5%), answering note in the block 45 of 47 (95.7%), 0.33 notes per block that do not answer (15 in 45), no block
  25 of 30 (83.3%). The judge's fixture set (54): 16 of 21, 18 of 21, 0.56 (10 in 18), no block 23 of 33 (69.7%). The
  judge's generic set (60, none answerable): no block 44 of 60 (73.3%).

## Next steps (in order, each runnable by someone new)
1. Findings 4 (README on instructions in notes), 5 (the e2e waits for the vault's `ok`), 6 (the nits).
2. `npm test`, then `node scripts/e2e.mjs canon` with the live fingerprint before and after each run.

## Picks and why
- The rule, in full (search.js `rank()`): everyday request words (text.js `EVERYDAY`: verbs such as write, add, fix,
  test, run; the parts of code such as function, file, script, regex; size words such as small, simple) are never
  words in common, but they still weigh in what the prompt asks. Each prompt word weighs its idf (a word no note has
  weighs most); a project's name weighs once (its rarest word). A note fits when the words it shares carry a share of
  that weight: a third when one of them is in its title, aliases, tags or headings (and then two of them, a project's
  name counting as one, must be distinctive: in those fields, in at most 6% of the notes, or twice in its body, which
  is the judge's rule), 55% when they are only in its body (and a single body word fits only beside a named project in
  a prompt of more than one word). "Another project's note" stays as in round 2.
- Why a share and not the judge's rule alone: the distinctive rule alone (with the everyday list) took dev's first note
  to 77.6%, the block to 80.6%, coding to 87.9%; answers often rest on several common words in a note's body. A
  coding request's main words are mostly not in the vault, so the words a note shares carry little of it.
- Everyday words weigh in the total: without their weight, coding was 95.7%; with it, 99.3%, and the gaps widened.
- The two figures sit in dev's gaps. Titled: coding requests reach 0.300 (c02) and 0.295 (jg-g29), the lowest answer is
  0.370 (a32): a third is the middle (0.3 was right at c02's edge; 0.25 lets c02 and jg-g29 in). Body: the highest
  prompt no note answers is 0.535 (jf-p05, a project question), the lowest answer that comes this way 0.586 (a40):
  0.55 leans to the answers, whose floors are tighter (0.5 lets jf-p05 in and adds 2 notes that do not answer; 0.6
  loses a40). c29 (On-call on "call", "10", "seconds", 0.41) stays a miss rather than tune for it.
- For its own notes, the session's project counts in the share as if the prompt said its name: no change on dev; keeps
  "Which ports does this service listen on?" in quartz-cache's folder (README, host test).
- A question's best note is kept when the whole prompt finds it short only on the share (it carries its own question):
  no change on dev; keeping every question's best note added 2 notes that do not answer (a13, a24), so only the share
  is waived. Keeps the README's two-question block and the On-call + NATS test.
- Kinds: round 2's p02, p03, p04, p06, p07 and u05 are everyday coding requests in a project's folder (coding); p01,
  p05, p08, u01, u02 ask about a project and no note says it (project); u03, u04, u06 other. The judge's jf-c22,
  jf-c24, jf-c27 are other; its jf-p prompts project; its other jf-c prompts and all jg prompts coding.
- jf-a09 is left out of dev: it repeats a33 word for word in the same folder.
- Tried and dropped on dev: bold words as marked (a27 then scores 2.95, under the floor of 3; not tuned for one
  prompt); a project's name credited only when in a note's fields (a16 fell out); other weights for unknown words and
  for names; one share for both paths.
- The first hold-out's test now prints its figures only (no misses, problems as a count): `npm test`'s output is not
  read for choosing, and nothing was chosen by it.

## For the v1.0.1 list (the kit, not changed before the suite tag)
- Finding 2 at the kit level (`shared/client-kit.js`, `SettingsBody`/`fieldSpec`): a number or switch field whose
  stored value is text (`typeof value === 'string'`) shows with its quotes and is marked invalid in the plugin's words
  ("Saved as text, in quotes: save it to store it as 3"), and Save is on for it and writes the parsed value (a
  `mutate([{ op: 'set', path: [field], value: 3 }])` when the draft's text equals the stored text). Then Canon's
  one-press fix can go.

## Gotchas
- `test/fixtures/canon/relevance/holdout.json` (the first hold-out) is there; `npm test` measures it and prints its
  four figures. Never open it and never choose between rules by its figures. `holdout2.json` is absent; check only
  with `test -e`.
- A long prompt (a pasted log with a question) spreads its weight over many words: a note may share too little of it.
- zsh does not split `set -- $pair`; loop scripts run under bash.
