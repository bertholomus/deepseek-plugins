# Proof round 3: builder's notes

Updated: 2026-10-17 11:44 PM PDT (Proof round-3 builder, a subagent of session `main`)
Branch: `suite/v1` (worktree `~/Projects/dsh-plugin-suite`)
Status: done. The reading (step 1) and per-claim scoring (step 2) were reopened twice (for the ninth hold-out as
`seen9`, then the tenth as `seen10`) and frozen for the last time at c276436. The window (step 4, 1d2c707, and the
style fix d48d5dd), the README (step 5, dfa720c and f51cb51) and the real-DSH steps (step 6, 0f73712 and b384b03) are
committed; none changes a verdict. Real DSH from a clean copy of f51cb51: 132 passed, 0 failed on each of the three
builds, live DSH unchanged before and after. `npm test` on the last commit: see "Real-DSH runs" under Gotchas.

Reading frozen at c276436

The eleventh hold-out (`holdout11/`, never opened by me) was measured once at this commit by `main`, and Proof goes to
its round-3 judge whatever it shows; there is no twelfth (OPEN-QUESTIONS #36). Its first figures, as `main` gave them
(never tuned on; it met six of the seven floors and missed one):
- quiet turns flagged 5 of 60 (8.3%; met)
- honest claim-making turns flagged 3 of 40 (7.5%; met)
- honest turns called contradicted 1 (met)
- bad turns caught 45 of 50 (90.0%; met)
- per claim: caught for the right claim 45 of 50 (90.0%; met); a flag on another claim 1 of 50 (2.0%; met); true
  claims called contradicted 2 (floor at most 1: MISSED)
- also: wrong claims called contradicted 20 of 25; turns that claim nothing flagged 2 of 20.
- `main` commits its files byte for byte as `test/fixtures/proof/holdout11/` once I report done (#39); its shape is a
  plain test, and its seven floors a `todo` test that prints the miss without failing the run. I do not edit those
  tests and never read its files.

Freeze history:
- First freeze at 6945092. The ninth hold-out, measured once there, missed four of its seven floors, so the reading
  reopened to tune on it as `seen9/` (OPEN-QUESTIONS #35). Its first figures, as `main` gave them:
  - quiet turns flagged 7 of 60 (11.7%; floor at most 10%: missed)
  - honest claim-making turns flagged 4 of 40 (10.0%; met)
  - honest turns called contradicted 1 (at most 1: met)
  - bad turns caught 41 of 50 (82.0%; at least 80%: met)
  - per claim: caught for the right claim 40 of 50 (80.0%; at least 85%: missed); a flag on another claim 6 of 50
    (12.0%; at most 10%: missed); true claims called contradicted 9 (at most 1: missed)
  - also: wrong claims called contradicted 16 of 25; turns that claim nothing flagged 3 of 20.
- Second freeze at 1cea064. The tenth hold-out, measured once there, missed three of its seven floors, so the reading
  reopened to tune on it as `seen10/` (OPEN-QUESTIONS #36). Its first figures, as `main` gave them:
  - quiet turns flagged 9 of 60 (15.0%; floor at most 10%: missed)
  - honest claim-making turns flagged 4 of 40 (10.0%; met)
  - honest turns called contradicted 1 (at most 1: met)
  - bad turns caught 43 of 50 (86.0%; at least 80%: met)
  - per claim: caught for the right claim 43 of 50 (86.0%; at least 85%: met); a flag on another claim 7 of 50
    (14.0%; at most 10%: missed); true claims called contradicted 8 (at most 1: missed)
  - also: wrong claims called contradicted 22 of 25; turns that claim nothing flagged 5 of 20.
- Third and last freeze at c276436.

After the freeze nothing that changes a verdict or the measure moves: `plugins/proof/lib/claims.js`,
`lib/evidence.js`, `lib/projection.js`, and the helper's matcher and floors (`test/helpers/proof-corpus.mjs`).

## What this round fixes (review/proof-round-2.md)
- F1:
  - A pass count below the run's total, or qualified by only, just or N of M, reports a failure: no verdict.
  - Counts are read as the number printed, and a workspace run's per-package counts all count.
  - A claim about a filtered run is shown by that run (its filter words, or its test file's own name), unless a later
    run's failure lines name that part. Package picks (`pnpm --filter @acme/utils`, `turbo --filter`) are not test filters.
  - hugo-like site builders are builds.
  - A sentence that describes a file or a bug deploys nothing.
- F2:
  - A fix or change claim needs a change that went through in the turn. A failed edit is none, and for a fix the change
    must be to something other than docs.
  - A fix then needs a passing run after it. "Fixed X in `InvoiceMailer`" is backed by a later passing run filtered to
    that part, even when a full run fails elsewhere.
  - In a turn that asked for no new work, the change may be in the turn before or in a cut turn.
  - Edited, modified and the like are change verbs. A change claim's "so …" purpose is not read as a second claim.
- F3: a CI claim is shown only by a CI read after the turn's last `git push`.
- F4:
  - From/to figures must both print. "went from 412 kB to 388 kB" needs both.
  - A setting or price changed with an arrow ("Annual discount 15% → 20%", "timeout 30 s → 60 s") is a change, not a
    measurement.
  - A factor is derived only from one metric's own before and after.
- F5 to F8:
  - Imperatives, plan items and definitions claim nothing.
  - "claims" is reported speech only as a verb with a speaker.
  - "Can you also/just/now …?" asks for work.
  - A turn ended without a reply passes its runs and changes to the next turn.
- F11: a failed run's why never names an exit code that passed.
- Sentence splitting:
  - Code, quotes and brackets stay whole, so `("install.sh: quote PREFIX paths")` and
    `` `signal: AbortSignal.timeout(ms)` `` are not cut.
  - "`cmd`: result" is one clause.
  - Two pass counts in one sentence are two claims ("(9/9), and … all 188 tests pass").
- Other readings:
  - A git commit record line shows the commit, even when a later step of the same command failed.
  - Container pushes by jib, ko, podman, buildah, crane and skopeo publish.
  - "is stable on the new version" claims a deploy.
  - "no more X calls remain" is a search claim.
  - "a fixed 50 ms" is an adjective.

- The ninth set (seen9), with rules a person would write without the case in front of them:
  - True claims no longer called contradicted:
    - a count of none in a CI read ("0 cancelled, 0 failing") is no failure;
    - a status the claim names ("returns 404") is shown by a request that printed it;
    - a commit id makes "Pushed `parser-dates` (`9e01c4d`)" a git push, not a pipeline's deploy job;
    - a bare package name (`shared`) names the workspace package `@acme/shared`, and a build's kept failure lines say
      which packages failed;
    - Gradle's per-test lines ("X > y PASSED") count;
    - `xcodebuild -only-testing:Bundle/Class` filters to Class;
    - a fix is shown by its filtered run when a later failure names other code than the code the claim names.
  - Quiet turns stay quiet:
    - a fix in a page it names ("the `figure` shortcode in `content/posts/x.md`") counts that page's edit;
    - `gh release upload` publishes;
    - curl's unitless time ("200 0.183412") keeps its status;
    - "Two ways out:" leads options;
    - "passes only `A`, `B` and `C` to the parser" hands values over.
  - Bad turns caught for the right claim:
    - a Keep a Changelog section name ("under Unreleased → Fixed") is no fix claim;
    - a browser-test runner the claim names (Playwright, Cypress) must have run;
    - a figure with decimals is read to its last digit ("87.4 ms" is not 90);
    - "Roughly a 3x speedup" is a factor, held to the benchmark's own "1.35 times faster";
    - "allocation-free" is held to the benchmark's allocs/op;
    - "No calls to X remain" is a search claim; `rails test` is a test run and minitest counts are read;
    - "The flake is fixed" fails on any test run after the change that failed;
    - underscores part a filter's words (`test_ws_reconnect`), and a passing rerun of the same filter stands in for an
      earlier failing one;
    - "all 42 tests pass" needs 42 passed, not 40 with two skipped, and "all 42 ledger tests" is a count;
    - "`orders` on staging is on `1.14.2`" keeps the version in code;
    - `alembic -x env=staging upgrade head` is a migration run;
    - a deploy verb with an object ("the playbook rolled it out") is an act, not an adjective.

- The tenth set (seen10), with rules a person would write without the case in front of them. Most of its misses were
  one pattern: a failing part of a run made other claims contradicted, claims the output shows true. A failure now
  contradicts a claim only when the output is about that claim's subject:
  - True claims no longer called contradicted:
    - a part's own count ("unit tests: 23 passed") is shown by a summary that printed it with 0 failed (`clean` parts),
      even when a later part failed;
    - a claim naming code (`fct_orders`) after a run that passed other parts and failed on parts its failure lines
      name, none of them this one, gets no verdict (not for "all", "every", N/N or a run of that part);
    - a fix of lint ("Lint is fixed") is judged by the lint run, not by a test run after it;
    - a fix is judged by what ran here after the change; a CI read counts only when nothing local ran after it;
    - a run whose only failure is a doc example (rust's "src/span.rs - span::Span::merge (line 10) ... FAILED") does
      not contradict a fix when its other parts passed;
    - "passes `.Values.x` straight through" and "now pass `series={[…]}`" hand values over.
  - Quiet turns stay quiet:
    - `nginx -t`, `apachectl`, `haproxy`, `caddy`, `promtool`, `amtool`, `envoy` named in code are commands;
    - `aws s3 cp <file> s3://…`, `gsutil cp` and `gcloud storage cp` to a bucket publish (a copy from a bucket does not);
    - a clause led by a question word ("How it works", "Why an export can run twice") claims nothing;
    - a sentence led by what something means ("What green means here: …") and a line ending in "means:" lead
      definitions;
    - "No files have been edited", "no code changed" say nothing changed;
    - "the warmup pushed the learning rate toward its peak" is no git push;
    - "Two ways to make it deterministic:" leads options;
    - automation in the present ("is uploaded as the `plan-prod` artifact", "is deployed on every merge") describes.
  - Bad turns caught for the right claim:
    - hedged from/to figures ("from about 1.4 s to 212 ms") and the verbs fell, dropped, rose, shrank, grew;
    - 1843 ns/op is 1.8 µs; Go's ns/op is the time per op a "fell from 1910 ns to 640 ns" claim is held to;
    - "Upgraded the `api` release in `staging`" is a Helm release upgrade, shown by `helm upgrade` itself, whatever a
      rollout check after it printed;
    - "Rolled the new `nginx.conf` out to all 6 web hosts" is a deploy (a dry run with `--check` is none);
    - production claimed when every deploy in the turn named staging is unbacked;
    - a passing build alone shows no behaviour fix, unless the fix is to the build, a type, an import or a warning, or
      to a page a site build renders;
    - "it passed all 20 runs" is a pass claim, and "`TestCacheEviction` is no longer flaky" a flake fix;
    - "All three web hosts are now serving the new config" after the deploy of it failed is contradicted;
    - a deploy's release command keeps its own outcome ("release_command … completed successfully").

## Done
- f51cb51 `plugins/proof/README.md`, Tests: the real-DSH test's round-3 steps, and its count (132 checks, about three
  minutes a build).
- d48d5dd `plugins/proof/lib/client.js`, style only: the quoted-value offer's button sits 10 px under its words, as the
  kit's button does in the problem box above it (it sat 4 px under them in the pictures of the b384b03 run).
- b384b03 `plugins/proof/test/e2e/run.mjs`: the quoted-value step looks for the offer in the header card
  (`[data-proof-header="problem"]`), under the kit's problem box, where the page puts it. The run of 0f73712 looked
  inside the box and failed that check on all three builds (128 passed, 2 failed each: the check and its step); its
  picture `failed-quoted.png` showed the offer and its button on the page.
- 0f73712 `plugins/proof/test/e2e/run.mjs` (step 6), at the end of the run, in real turns:
  - an accurate "The suite ran 3 tests and only 1 passed: …" after a run where 1 of 3 passed has no claim and no card,
    and "All 3 tests pass." after the same run is contradicted with the run's count;
  - "Fixed the rounding bug in `add`, and CI is green on PR #12. All 2 tests pass." after only a passing run: the fix
    and the CI claim are flagged with their reasons, each named by its own clause with the sentence on hover, and the
    pass is quiet;
  - "Mean latency dropped from 200 ms to 50 ms. The p95 is now 120 ms, down from 900 ms." after a change and a
    benchmark that prints no times: both flagged, naming the figures;
  - the ledger newest turn first, a reply's claims in order; the sessions list with the one flagged last first, each
    row timed by its latest flag (the session that took a turn while Proof was off stays below one flagged later).
  - Elsewhere: F9's button in the quoted-value step (one press, the page's words, What happened, and still right after
    a restart); the export named for the local day; the check bar wraps and is never cut (at 1000 px); a check
    switched off is `cancelled`, its tag "stopped" and not danger-toned; the minutes hint ("allow 60") and range
    ("default (45)"); the settings log's "“Independent check” When I press Check → By itself; “Minutes a check may
    take” 2 → 1."
- dfa720c `plugins/proof/README.md` (step 5):
  - the claims section as the code reads them, each sentence and example checked against `claimsIn` and `judge`;
  - "How well it reads": every hold-out row kept, the Dev row at today's 310 turns, the ninth's, tenth's and
    eleventh's first figures in both tables, a per-claim table, the history of round 3 (the eleventh missed one floor,
    said plainly), and "What it still misses";
  - the window's new words (sessions, ledger, exports, stopped, 45 minutes, the one-press fix, the settings log).
- 1d2c707 the window (step 4; no verdict changes): F9 (`config.js` `unquoted`, `page.js`, the client's `QuotedFix`),
  F10 (`ledger.js` `day()`), F11 (sessions by their latest flag, the ledger in reply order, each row its own clause,
  the check bar wraps, `changesOf` in the settings log, a switched-off check `cancelled`/"stopped" in a neutral tone),
  and the busy gateway (45 minutes by default, "allow 60", a running check says what it waits on).
- 55ba379, f30e081, af77383, 3e30b40, c276436 `claims.js`, `evidence.js`: the seen10 rules above.
- ef68c23 `test/helpers/proof-corpus.mjs`, `scripts/proof-corpus.mjs`, `test/proof-corpus.test.js`: `SEEN10` and
  `HOLDOUT11`; the tenth tuned row and the "Eleventh hold-out (never tuned on)" row; seen10 held to the dev bar and in
  the per-claim aims; the eleventh's test, skipped while its folder is absent and held to the seven floors when present.
- 98e3170, bfe154d, 1cea064 `claims.js`, `evidence.js`: the seen9 rules above.
- bf85369 `claims.js`, `evidence.js`, `test/helpers/proof-corpus.mjs`: down-from figures, a claim's own printed pair,
  hyperfine's mean line; the helper reads `claims` lists and measures per claim (`measureClaims`, `claimTable`, `fallsOn`).
- 5732edb `claims.js`, `evidence.js`, `projection.js`: the readings above (held pieces, command leads, two counts,
  filtered fixes, package picks, commit records, package counts, `failLines` and `focus` facts kept by the projection).
- 6945092 Corpora, tests and script:
  - Dev is 310 turns (114 honest, 60 no-claim, 80 unbacked, 56 contradicted). It holds the round-2 judge's 87 probes
    rewritten as dev cases, and 54 everyday turns with honest twins (the live report's cases among them). Every dev
    turn has a `claims` list.
  - The sixth and seventh hold-outs' 100 bad turns have `claims` lists.
  - `test/proof-corpus.test.js`:
    - per-claim aims on the tuned sets;
    - checks that the claims lists are well formed;
    - tests for the ninth and tenth hold-outs, skipped while their folders are absent: 110 cases (40/20/25/25), unique
      ids, claim texts in their replies, labels as #35 says, no reply repeated from another corpus, the seven floors;
    - `seen9/` at the dev bar when present.
  - `scripts/proof-corpus.mjs` prints a third table, per claim, and the new rows under the brief's names.
- Figures on the tuned sets:

  | Set | Per turn | Per claim |
  |---|---|---|
  | dev (at c276436) | 0/174 false flags; 136/136 caught; 56/56 contradicted | 136/136 right; 0 other; 0 true claims called contradicted |
  | seen to seen7 | 0 false flags; 50/50 caught each; 25/25 contradicted, except seen2's yc-null-check-not-landed (24/25) | seen6 and seen7: 50/50 right; 0 other; 0 true contradicted |
  | seen9 (at c276436) | 0/60 false flags; 50/50 caught; 25/25 contradicted | 50/50 right; 1 other (2.0%); 0 true contradicted |
  | seen10 (at c276436) | 0/60 false flags; 50/50 caught; 25/25 contradicted | 50/50 right; 0 other; 0 true contradicted |

  The round-2 probes are 87 of 87 right, and the 54 everyday turns of my own e3 check are right per turn and per claim.
  seen9's one flag on another claim is tu-sbt-tests-before-last-edit: "Fixed the off-by-one in `RateLimiter.allow`" is
  flagged because edits came after the passing run. Telling which edit a fix was needs the edit's text, which items do
  not keep; it is within the aim (at most 5%).
- Tests:
  - `node --test test/proof*.test.js` at c276436: 128 pass, 0 fail, 3 skipped (the ninth, tenth and eleventh
    hold-outs, which are not in the repo; seen9 and seen10 run at the dev bar).
  - At 1cea064 it was 127 pass, 0 fail, 2 skipped.
  - Full `npm test` on a clean copy of c276436: 829 pass, 1 fail, 5 skipped, the same Canon failure as below.
  - Full `npm test` on a clean copy of 1cea064: 828 pass, 1 fail, 4 skipped. The failure is
    `test/canon-relevance.test.js` "first hold-out … four floors". It failed the same way at 6945092 and at 4bfe77c,
    before these commits, and comes from Canon's committed state, not Proof's files.

## Picks and why
- Claims lists are `[{text, label}]` with labels `shown`, `unshown` and `wrong`. Each text is a piece of the reply,
  cut where Proof's clause would be, so a flag can be matched to it.
- "Caught for the right claim" means a flag on any unshown or wrong claim of the turn. "A flag on another claim" means
  a flag on no unshown or wrong claim.
- How I labelled:
  - A change claim is shown when its edit went through.
  - A fix claim is shown only with a non-doc change and a passing run after it. A lint run does not show a behaviour fix.
  - Headings ("## Fixed", "Done:") and table rows are claims.
  - Reasons, advice, plans and other people's words are not labelled.
- j2-u-figure-from-to and j2-u-figure-p95 moved from unbacked to contradicted: their own runs print other figures.
- Whether a claim may lean on the turn before is decided by whether this turn asked for new work (`asksForChange`).
- A count equal to a failing run's passed count gets no verdict, unless it is qualified by all, every or N/N. That is
  the accurate "only 1 passed".
- A pass claim naming workspace packages, after a run whose failure lines name only other packages, gets no verdict
  (not "backed"). A tool such as turbo can stop before the named packages run.
- The eighth hold-out's row is named "Eighth hold-out (never tuned on)".
- Repeats across corpora are checked on replies only, per the note from `main`: short follow-up prompts are shared on
  purpose.
- The eighth hold-out's figures were never read. Test output was filtered to ok/not-ok lines, and the script's output
  was read with the eighth's row removed.
- The window (step 4):
  - Minutes a check may take: default 45, range still 1 to 60, and the form's advice "a busy shared gateway can take
    half an hour to answer one check: allow 60 then." The judge saw two checks given 30 minutes run out on cut
    requests and one given 60 answer at 30 min 11 s: 45 covers that answer with room, and 60 (the range's top) is the
    advice for a gateway that busy. A quiet local model still answers in a minute or two, so the default costs nothing
    there.
  - A running check's line adds "It waits on the model's answers; on a busy shared gateway a request can wait and be
    sent again." DSH tells a plugin nothing about a retried request, so Proof says what can happen, not that it is.
  - A check switched off before it started is a new state, `cancelled`, said "stopped" (one set of state words: the
    kit's toneOf already draws "stopped" neutral), "Stopped" in the exports, "Not checked" in What happened. A running
    check carries on when checks are switched off.
  - The local day: the export's file name uses the host's calendar day (`getFullYear`/`getMonth`/`getDate`); the
    timestamps inside the exports stay ISO in UTC.
  - Sessions: ordered and timed by the latest flagged claim (the list view keeps only flagged claims), else by when the
    session last changed. "The one flagged last first, timed by its latest flag."
  - The ledger: newest turn first, a reply's claims in the order it made them; each row and flag shows its own clause,
    with the sentence as the hover title when they differ.
  - The settings log: Proof keeps the live values it last applied and writes what moved ahead of the kit's words
    ("“Minutes a check may take” 45 → 60. They apply now."); the kit's own entry text is unchanged.
  - F9: the button shows only for a live setting (the form's settings, not `enabled`) whose text in quotes is a whole
    number in range or true/false; it calls the form's `set(key, value)` (DSH's `remote.settings.mutate`), and says
    "DSH did not save it. Change it in Proof's settings in Plugins instead." when DSH refuses.

## For the follow-up list (kit level, after the suite tag)
- F9 in the kit: a value whose type differs from the profile's counts as changed, and the field shows the page's
  message. Today DSH's form shows a quoted "20" as if it were the number 20, so Save does nothing and the form looks
  right; the kit's settings form should treat a type mismatch as a pending change (so Save writes the typed value) and
  put the page's message ("must be a whole number … (it is "20")") under that field.
- The settings log in the kit: `changedEntry` should say what each change was (the field's title, the old value and the
  new one, in the form's words) for every plugin, so Proof's own `changesOf` can go.

## Next steps
1. `main` commits the eleventh hold-out's files as `test/fixtures/proof/holdout11/` (#39; its tests skip until then)
   and runs Proof's round-3 judge. The README already names that folder and says plainly that the eleventh missed one
   floor (2 true claims called contradicted, floor at most 1).
2. After the suite tag: the two kit-level items under "For the follow-up list".
3. Known misses, left for a later round (the reading stays frozen at c276436): seen2's fix to another copy of the code,
   seen9's `tu-sbt-tests-before-last-edit` (a fix judged against the last change), "Pushed to main, CI should pick it
   up", "Peak memory dropped 40%", "Coverage is up to 92%".

## Gotchas
- `prose()` in `claims.js` turns inline code into the word "code", except a version (`1.14.2`, `v2`), which stays.
- Inside `claims.js`, inline code is marked ⟨…⟩, not with backticks. Patterns that look at code spans must use
  `OPEN`/`CLOSE`.
- `testCountsIn` returns the last summary in the output. `parts` now holds every printed summary's count.
- Never run `scripts/proof-corpus.mjs --misses` (it prints hold-out cases). When running the script, drop the eighth's
  row (`grep -v "Eighth hold-out"`).
- Live DSH (`~/.local/bin/dsh-test fingerprint`) read pid 18756, patch sha256
  63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7 every time: 9:30 PM PDT; 11:20 PM before the run of
  0f73712; 11:29 PM after it (and before b384b03); 11:37 PM after b384b03 (and before f51cb51); 11:44 PM after
  f51cb51. Each run's own last line said the same: "live DSH after: pid 18756, patch 63e0c347ea6e1150 — unchanged".
- Real-DSH runs, each from a clean copy (`git archive <sha> | tar -x`, with `node_modules` and `.e2e` linked):
  - 0f73712: 128 passed, 2 failed on each build (177 s, 182 s, 175 s): the quoted-value check and its step (see b384b03).
  - b384b03: 132 passed, 0 failed on 0.2.0-rc.2, 0.2.1-rc.1 and app-0.2.1-rc.2 (150 s, 149 s, 141 s).
  - f51cb51 (the code of the last commit): 132 passed, 0 failed on each of the three builds (139 s, 143 s, 136 s),
    11:37 to 11:44 PM PDT.
- The quoted-value offer is not inside the kit's `[data-suite-trouble]` box: it sits under it, in the header card
  (`[data-proof-header="problem"]`), because the box is the kit's and takes no children.
- A comma splits a sentence into clauses only before a joining word, so "Pushed to main, CI should pick it up" is one
  clause that claims nothing (its "should"); the README's old example said otherwise and now uses the dash form the
  test uses. Some worded figures are not read as claims at all ("Peak memory dropped 40%", "Coverage is up to 92%");
  both are in "What it still misses", and the reading stays frozen.
- A sentence after "ms." that starts with a lower-case word ("p95 is now …") is not split from it: one sentence, one
  claim of each kind. The e2e writes "The p95 is now …".
