# Canon round 3: builder's notes

Updated: 2026-10-17 10:17 PM PDT (Canon round-3 builder)
Branch: `suite/v1` in `~/Projects/dsh-plugin-suite`
Status: built. Findings 1 to 6 and the 9.5 list are in (Finding 1: 3b6811a, 106086d, 483b42e, f3bfec8; Findings 2 and
3: 79056f1; README and Finding 4: 171c6b5; Finding 5: e68eb4f; Finding 6's nits: 4bcb908). `node scripts/e2e.mjs
canon` passes on all three builds, three runs, live DSH unchanged. Open: **the first hold-out's floors test is still
not ok**, so `npm test` does not pass in full (see Gotchas); two Proof tests also fail on a clean copy (not Canon's).
Vault frozen at f7283b5: test/fixtures/canon/vault (not changed this round).

Live DSH fingerprint before any work (6:47 PM PDT): pid 18756, started Sat Oct 17 10:39:36 2026, patch sha256
63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7.

## Done (newest first)
- `node scripts/e2e.mjs canon`, three runs (10:06 to 10:16 PM PDT), each 95 passed, 0 failed on DSH 0.2.0-rc.2,
  0.2.1-rc.1 and app-0.2.1-rc.2. Live DSH fingerprint before and after each run (10:06, 10:09, 10:10, 10:13, 10:13,
  10:16 PM): pid 18756, started Sat Oct 17 10:39:36 2026, patch sha256
  63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7, unchanged. No plugin file was edited while they
  ran, and no DSH Test window was needed beyond them (suite-canon-b3 never made).
- `npm test` at 4bcb908: in the checkout, 833 tests, 824 pass, 5 fail: the first hold-out's floors test, and four
  Proof tests with the Proof builder's uncommitted `plugins/proof/lib/claims.js` and `evidence.js` in the tree. On a
  clean copy of HEAD at 4bcb908 (`git archive HEAD | tar -x`, `.e2e` linked; the repo has no node_modules), 826 pass,
  3 fail: the first hold-out's floors test and two of Proof's (per claim on the tuned sets; the ninth hold-out once
  tuned on), Proof's work in progress. Every other Canon test passes, and so does the naming scan. The copy was
  removed after; nothing in it was opened.
- Finding 6's nits (4bcb908): the form refuses the whole disk and the home folder as the vault ("/", "//", "/srv/..",
  "~", "~/", "~/./") in the profile's words: "The vault's own folder, not the whole disk: a full path, such as
  /Users/you/Canon, or one starting with ~/, such as ~/Obsidian/Canon." (client test, against `checkConfig`). A
  draft's file name is cut after the last whole word within 80 characters, and a single longer word at 80
  (drafts.js `slugOf`, host test). The try-out's near-miss words name a project's name only when one is named
  (client test), and the `enabled: false` page's last line was fixed before. DSH's own Trajectory label
  ("Dsh-plugin-canon") stays as it is: it is DSH's, not Canon's. README: the file name, the form's refusals.
- Finding 5 (e68eb4f): the e2e's first state check waits until the vault's state is `ok`, not only for the
  endpoint to answer.
- README and Finding 4 (171c6b5): "What a turn gets" for the rules now (the split, the question rule with its one-word
  cases and names no note has, the coding rule's third and 45% and the work object, folders inside a project, "this
  repo", short forms, other words, defined terms); "How well it picks notes": the 922-prompt dev's make-up, a table of
  round 2's rules, 14893d8's and now on it, by kind, the later groups' figures as first measured, what it still
  misses; the hold-outs: 14893d8 fell short of two of the first hold-out's floors, and the rules now still fall short
  of at least one (no hold-out figure written). Finding 4: quoting does not stop a model from acting on a note's
  words (round 2's mascot sign-off); keep instructions to agents out of notes.
- A fourth group of my own, written before it was measured, in forms the dev set lacked (zr01 to zr43 a note
  answers, zs01 to zs11 none does; two I had written before word for word left out): tasks a note answers told as
  orders with a work verb ("Set up the VPN for a new hire.", "Check who owns quartz-cache."), situations told as
  statements ("I'm getting 429s from lantern-api.", "The cert on the gateway expires next week."), questions that
  name a tool no note has ("Do we page people through PagerDuty or our own tool?", "Is the ledger on MySQL or
  Postgres?"), words alone ("ledger restore steps") and "may I" questions. As first measured, against round 2's
  rules (9a8a4c9) and 14893d8: first note answers 37 of 44 now, 35 with round 2's rules, 31 at 14893d8; in the block
  38, 36, 33; no block for 10 of 12, 9, 12. Round 2's rules found two that these miss: "Set up the VPN for a new
  hire." (a work verb makes it a coding request, and "VPN" alone in a note's body is too little of it) and the
  PagerDuty question (a name no note has needs three words in common or a named project). One change: a number's
  plural reads as the number (text.js `stem`: "429s" is "429"), which finds Rate limits for the 429s statement and
  changes nothing else on dev. Dev, 922 prompts: first note answers 517 of 562 (92.0%), in the block 531 (94.5%),
  0.37 notes that do not answer per block (198 in 537), no block 321 of 360 (89.2%), everyday coding requests 235 of
  255 (92.2%); held in the test. The first hold-out's floors test read once after (9:53 PM): still not ok. (f3bfec8)
- The fit rule, third pass (483b42e), chosen on dev only, from four more groups of my own written before they were
  measured: z (45 prompts and 15 no note answers: one everyday word and a project's name, "What's a standby?",
  orders with no work verb, "we/our", short ones), zb (35 and 10: "remind me", "any idea", numbers, people, lower
  case), zc (25 tasks a note answers and 10 coding requests none does), zp (69 and 10: one or two short questions
  for every active note, in other words than its title, on a word of its body or headings, half in its project's
  folder, the way the coordinator described). As first measured: z first note answers 38 of 45, zb 31 of 35, zc 22
  of 25, zp 58 of 69 (in the block 60 of 69, under 90%). What changed:
  - An everyday request word alone fits when it is all the prompt asks ("How do I run lantern-web?", "how do i run
    it" in lantern-web's folder); "Why is this useEffect running twice?" still gets nothing.
  - One word beyond everyday words, when it is all the prompt asks, fits a note's body when few notes have it or
    the body has it twice ("What runs on 6412?": Quartz ports; "What's a standby?").
  - A term a list defines in bold ("- **Standby**: …", frontmatter.js `defined`) counts as an alias: "What does
    bastion mean?" gets the glossary.
  - A question that names something no note has (a word with a capital inside a sentence or in capitals, not a
    day, a month or "I'm": "How do I run Kafka locally?", "CORS") fits only a note of a project it or the folder
    names, or one sharing three words; the page names the word.
  - The work-object rule counts for a project the prompt names, not only the folder's ("Write a migration for the
    ledger that…").
  - The stemmer gives three-letter roots their "e" ("moving"/"move", "hired"/"hire"; "fixed"/"fix") and cuts
    "-ation" ("authenticate"/"Authentication", "migrate"/"migration").
  - "Team" is a word about the vault only before one ("the team's notes"): "When is team lunch?".
  - A few other words read as the notes' words (text.js `OTHER_WORDS`: revert and undo as roll back, reboot,
    RAM, TTL, handoff, dump, runner, storage, entrance).
  - Each hold-out test is split in two: its apart check (no prompt repeats a dev prompt) and its floors, so a
    repeat never reads as a missed floor. The apart check is ok with the larger dev set.
  - After: z 43 of 45, zb 33 of 35, zc 23 of 25, zp 62 of 69 (64 in the block). Dev, 868 prompts with the four
    groups: first note answers 480 of 519 (92.5%), in the block 493 (95.0%), 0.36 notes that do not answer per
    block (182 in 499), no block 312 of 349 (89.4%), everyday coding requests 232 of 252 (92.1%).
- A coding request's words in common need 45% of its weight when they are only in a note's body (was 55%):
  set again on dev's coding requests alone, now that only they are held to a share. The body-only notes of coding
  requests no note answers reach at most 0.42 (w12), and the answering note of t12 ("Add the API key header to
  the Python client.": Authentication) is at 0.50. Dev: first note answers 313 of 349, in the block 323, 121
  notes that do not answer, no block 272 of 307, coding 210 of 231 (t12 gained, nothing lost). (106086d)
- The fit rule reworked (Finding 1, second pass), chosen on dev only, after the coordinator reported that `npm test`
  on a clean copy of 0aa5be1 (my commits up to 14893d8) failed the first hold-out's guard: "first note answers 25.0%
  (floor 80.0%)" and "an answering note in the block 25.0% (floor 90.0%)". **The guard was failing at 14893d8.**
  Why, found with prompts of my own (never with the hold-out's): round 3's share rule ("the words in common carry a
  third / 55% of what the prompt asks", a word no note has weighing most) was built for coding requests and ran on
  every prompt. A person asks in other words than a note's title ("Which bucket does the built site end up in?"),
  so most of a question's weight sits in words no note has and the share falls short: on 70 natural questions of
  mine (n01 to n70) round 3's rule found the answering note first for 38 (54%), round 2's for 50. What changed:
  - Questions and coding requests are told apart (text.js `isCodingRequest`: a sentence starts with a work verb,
    or "this/my" names code), and each has its rule. A question: round 2's rule (two shared words, a project's
    name counting as one) with everyday words kept as words in common, one strong word when it is all the prompt
    asks, one distinctive body word beside a named project, one rare title word that is the prompt's rarest known
    word; an everyday word is never enough alone, not even beside a project's name. A coding request: round 3's
    share rule as it was.
  - A session in a folder inside a known project's folder is in that project (`folderKeys(folder, home,
    isProject)`): ~/Projects/lantern-api/internal/auth is lantern-api's.
  - "this repo", "this service", "this app" in a known project's folder say that project's name ("Who owns this
    repo?"); "this database" and "this cluster" also keep their word.
  - "Run me through…", "Update me on…", "Read me the…" ask to be told: questions, not coding requests; "Write me a
    function" stays one. "This repo" and "this app" no longer make a prompt a coding request.
  - One rare title word needs a prompt with no word the vault lacks ("Look up the parental leave policy" no
    longer gets the eviction decision).
  - A coding request that works on what one of the session project's notes is titled for fits it, whatever its
    share ("Write a migration that adds a currency column to accounts." in tide-ledger: Schema migrations).
  - Short forms are read as the whole word in notes and prompts (text.js `SHORT_FORMS`: certs, DB, auth, config,
    env, prod, repo, k8s, …), so "How do I rotate the certs?" meets "Rotating TLS certificates".
  - The passage is chosen on the prompt's words beyond everyday words (falls back to all), which keeps README's
    sample block as it was.
  - Dev now 656 prompts (each new group written before it was measured): round 3's 238, my natural questions
    (n01–n70, m01–m45, k01–k30: other words than the title, words from the body or headings, questions not orders,
    short ones, in a project's folder and not), question-form and told-as-a-problem coding requests (q01–q40,
    w01–w30), project questions no note answers (r01–r15, j01–j10), and other forms (s: folders inside a
    project's folder; t: coding tasks a note answers; i: requests to be told; d: "this repo"; y: typos and lower
    case; l: long prompts; e: pasted errors; h: other names for a project; b: "can you check…", times, people;
    g: short forms; o, x: prompts no note answers in those forms). w05 relabelled `answers` (Schema migrations):
    it is the same task as the judge's jf-a21 and my t01. Five prompts I wrote again word for word were left out.
  - Dev figures then: first note answers 312 of 349 (89.4%), an answering note in the block 322 of 349 (92.3%), 0.37
    notes per block that do not answer (121 in 328), no block 272 of 307 (88.6%), everyday coding requests 210 of
    231 (90.9%). Every floor met; held in test/canon-relevance.test.js.
  - The rule reads only the prompt, the session's folder and the vault: the helper hands `recall.preStep` the
    prompt's text and the cwd only; a new test measures dev with every id, kind and answer taken away and gets the
    same blocks.
  - Tests: host (classifier cases, folders inside a project, "this repo", short forms, the lone-word guard, the
    everyday-word guard, the work-object rule), client (the page's words for each rule), relevance (dev's make-up
    and figures, the no-labels test).
- Finding 6 (part): the switched-off page's last line says "Switching it off in Plugins instead also takes this
  page away; it stays installed either way." (in this commit).
- Finding 3: `walk()` keeps the folders inside the vault it may not list (not ENOENT/ENOTDIR); the vault's status counts
  them (`counts.closed`) and names the first 20 (`closed`); the header says "1 folder Canon may not read:
  Projects/osprey-mobile. Its notes are never added to turns: give DSH access to it, then read the vault again.";
  What happened notes it once (`closedEntry`), and "Every folder in the vault can be read again" after. (79056f1)
- Finding 2: the host works out what a live setting in quotes would be without them when that is right
  (`config.js unquoted`: "3" → 3 for a number in range, "false" → false for a switch) and gives it with the problem;
  the waiting state offers **Save it as 3**, which saves through DSH's own settings call
  (`configForms.get('canon').set(key, value)`). Not offered for `enabled` (profile only). (79056f1)
- README (Finding 1, first pass), the first fit rule (3405922), the dev set's kinds and the measure's coding floor
  (7cc1c48), README (14893d8): superseded in part by the rework above.
- Baseline (6:45 PM PDT, round 2's rules): dev (77) first 43/47, block 45/47, 0.33 extra, no block 25/30; the
  judge's fixture set (54) 16/21, 18/21, 0.56, 23/33; the judge's generic set (60) no block 44/60.

## Next steps (in order, each runnable by someone new)
1. The first hold-out's floors test (`test/canon-relevance.test.js`, "first hold-out: within the four floors") is not
   ok, so `npm test` fails on it. Its figures were never used to choose a rule; the coordinator decides what comes
   next (a judge round on the second hold-out, or another rework). To see only pass or fail:
   `node --test test/canon-relevance.test.js 2>&1 | grep -E '^(not )?ok '`.
2. When `test/fixtures/canon/relevance/holdout2.json` exists: measure it once with `node scripts/canon-relevance.mjs
   --set holdout2` and add its figures to the README's "The hold-outs" as a first measurement.
3. v1.0.1: the kit-level fix for Finding 2 (below), then Canon's one-press fix can go.

## Picks and why
- Finding 4's optional page flag for note lines that address agents: not done. A word list would also flag notes
  that only say what agents may do ("Agents may save drafts" in Home.md); the README says what to do instead.
- The vault field refuses what the form can know (the whole disk, `~`); a home folder written as a full path and
  DSH's data folder are refused by Canon on save, in the profile's words, as before.
- The e2e was run three times, not once, because Finding 5 was a race that failed once in four runs.
- Fourth group, tried on dev and dropped: a name no note has forgiven when the note shares a rare word of its title,
  aliases, tags or headings (the PagerDuty question found On-call, and one everyday coding request no note answers
  got Rate limits on "request"); one common word in a note's body enough beside a named project, as round 2's rule
  had it (9 more answering notes in the block and 4 more first, for 54 more notes that do not answer and 12 more
  prompts no note answers with a block: a note that does not answer costs as much as a missing one).
- Third pass, tried on dev and dropped: "wait" and "back" as words, not stop words (11 more notes that do not
  answer, one first note lost); the lone title word rule without its guard on words the vault lacks (5 more
  prompts no note answers got a block); "-ction" and "-ment" cut in the stemmer (no change on dev or the groups,
  and "production" would meet "product"); one common body word enough beside a named project (up to 42 more
  notes that do not answer); the titled share at 0.31 (one probe prompt, a margin of 0.006 over a note that does
  not answer); the everyday-word guard only without a named project (one more note that does not answer).
- The other words are a short list of words people use in operations for what these notes say otherwise; each
  is read as the note's word in notes and prompts alike, as short forms are. On dev they gained 5 first notes and
  added no note that does not answer.
- Split, not one rule: on dev, round 2's rule for questions and round 3's for coding requests beat either alone
  (round 3's alone: natural questions 54%; round 2's alone: coding requests with no block 80 of 140 on the old dev).
- Questions keep everyday words as words in common ("How do I run the unit tests?" is all everyday words and
  Local development answers it); a lone everyday word never fits, even beside a project's name (it fit before:
  "Why is this useEffect running twice?" in lantern-web got its local-run note on "running").
- Tried and dropped, on dev: a share floor for questions (0.25 lost 3 answers; 0.2 and 0.15 changed little); the
  question rule for coding requests too (coding with no block 136 of 210); a distinctive-words rule for coding
  requests (167 of 210); a tag naming the session's project counting as "named" (only added notes); keeping
  another project's note when it names the prompt's project (13 more notes that do not answer); "dev" as a short
  form of "development" ("npm run dev" is a name).
- The object of a coding request is the words after its first work verb up to the next clause or preposition; it
  counts only for a title of the session project's own notes (on dev it added no note to a coding request).
- `isCodingRequest` reads the prompt only. Question-form coding requests ("How do I read a CSV file with pandas?")
  stay questions: 33 of 56 of mine get no block, the weakest group; picking them out needs a list of code words,
  not done.

## DESIGN.md "Before you push" (this round's pushes)
- [x] Surfaces sit right: no surface, ground or card changed this round (words, checks and rules only).
- [x] Only DSH tokens in both versions, `--wp-blur`, `--wp-tint`, `body.wp-still`: no token added.
- [x] No selector with a DSH hash, nothing on `:root`, `html` or `body`, no `:has()` into DSH's list: no CSS changed.
- [x] Motion stops under `wp-still` and reduced motion: no motion added.
- [x] `node --check plugins/canon/lib/client.js`: parses.
- [ ] `npm test` passes: not in full. The first hold-out's floors test is not ok (Next steps 1); every other Canon test
  and the naming scan pass (two Proof tests also fail on a clean copy: Proof's work in progress).
- [x] Both DSH versions and both themes: the e2e's browser half, light and dark, wide and narrow, on all three builds.
- [ ] Wallpaper on and off: not looked at again; nothing visual changed this round.
- [x] Off leaves nothing behind, on again repeats nothing: the e2e switches Canon off and on in Plugins (95 passed).

## For the v1.0.1 list (the kit, not changed before the suite tag)
- Finding 2 at the kit level (`shared/client-kit.js`, `SettingsBody`/`fieldSpec`): a number or switch field whose
  stored value is text (`typeof value === 'string'`) shows with its quotes and is marked invalid in the plugin's words
  ("Saved as text, in quotes: save it to store it as 3"), and Save is on for it and writes the parsed value (a
  `mutate([{ op: 'set', path: [field], value: 3 }])` when the draft's text equals the stored text). Then Canon's
  one-press fix can go.

## Gotchas
- `test/fixtures/canon/relevance/holdout.json` (the first hold-out) is there; `npm test` measures it. Never open it
  and never choose between rules by its figures. `holdout2.json` is absent; check only with `test -e`.
- **The first hold-out still misses a floor** after the rework. Once (about 8:45 PM PDT) my filter let the failing
  assertion's diff through and I saw its two lines: "first note answers 75.0% (floor 80.0%)" and "an answering note
  in the block 83.3% (floor 90.0%)" (the rule then had everything above but the short forms). Nothing was chosen by
  them; the short forms came from my own probe (g01–g20: 12 of 20 before, 16 after). Since then I read only the
  test's ok / not ok line, once after each pass (9:02 PM, 9:31 PM, 9:53 PM): still not ok, also after the third
  pass and the fourth group. To see
  only that: `node --test test/canon-relevance.test.js 2>&1 | grep -E '^(not )?ok '`; never grep `^\s+[+-] ` or
  `actual` on a run that includes the hold-out.
- The coding floor's margin on dev is two prompts (210 of 231; 208 is 90.0%).
- A long prompt (a pasted log with a question) spreads its weight over many words: a coding request may share too
  little of it.
- zsh does not split `$B` into words: pass env flags one by one or under bash.
