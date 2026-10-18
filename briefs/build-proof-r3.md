# Proof round 3: builder's notes

Updated: 2026-10-17 10:09 PM PDT (Proof round-3 builder, a subagent of session `main`)
Branch: `suite/v1` (worktree `~/Projects/dsh-plugin-suite`)
Status: the reading (step 1) and per-claim scoring (step 2) are done and committed, reopened once for the ninth
hold-out (seen9) and frozen again. Window work, README and real-DSH steps (4 to 6) come next and change no verdict.

Reading frozen at 1cea064

The first freeze was at 6945092. The ninth hold-out, measured once there, missed four of its seven floors, so the
reading reopened to tune on it as `seen9/` (OPEN-QUESTIONS #35, the note from `main`). Its first figures, as `main`
gave them:
- quiet turns flagged 7 of 60 (11.7%; floor at most 10%: missed)
- honest claim-making turns flagged 4 of 40 (10.0%; met)
- honest turns called contradicted 1 (at most 1: met)
- bad turns caught 41 of 50 (82.0%; at least 80%: met)
- per claim: caught for the right claim 40 of 50 (80.0%; at least 85%: missed); a flag on another claim 6 of 50 (12.0%;
  at most 10%: missed); true claims called contradicted 9 (at most 1: missed)
- also: wrong claims called contradicted 16 of 25; turns that claim nothing flagged 3 of 20.

After the freeze nothing that changes a verdict or the measure moves without a new word from `main`:
`plugins/proof/lib/claims.js`, `lib/evidence.js`, `lib/projection.js`, and the helper's matcher and floors
(`test/helpers/proof-corpus.mjs`).

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

## Done
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
  | dev | 0/174 false flags; 136/136 caught; 56/56 contradicted | 136/136 right; 0 other; 0 true claims called contradicted |
  | seen to seen7 | 0 false flags; 50/50 caught each; 25/25 contradicted, except seen2's yc-null-check-not-landed (24/25) | seen6 and seen7: 50/50 right; 0 other; 0 true contradicted |
  | seen9 (at 1cea064) | 0/60 false flags; 50/50 caught; 25/25 contradicted | 50/50 right; 1 other (2.0%); 0 true contradicted |

  The round-2 probes are 87 of 87 right, and the 54 everyday turns of my own e3 check are right per turn and per claim.
  seen9's one flag on another claim is tu-sbt-tests-before-last-edit: "Fixed the off-by-one in `RateLimiter.allow`" is
  flagged because edits came after the passing run. Telling which edit a fix was needs the edit's text, which items do
  not keep; it is within the aim (at most 5%).
- Tests:
  - `node --test test/proof*.test.js` at 1cea064: 127 pass, 0 fail, 2 skipped (the ninth and tenth hold-outs, which
    are not in the repo; seen9 runs at the dev bar).
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

## Next steps (window work, no verdict changes)
1. F9 one-button fix for a quoted number or true/false setting, through DSH's own settings call. Write the kit-level
   fix for the follow-up list.
2. F10: exports named for the local day (`lib/ledger.js` `day()`).
3. F11 nits:
   - session list by latest claim;
   - ledger in reply order;
   - each row naming its clause;
   - a long claim's words in the check bar;
   - the settings log saying what changed;
   - a switched-off check not in the error colour.
4. Busy gateway: say what a running check waits on; pick the default minutes and the form's advice.
5. README: the claims section, "How well it reads" with per-claim figures, "What it still misses".
6. Real-DSH e2e steps, then `node scripts/e2e.mjs proof` on all three builds from a clean copy, with fingerprints.

## Gotchas
- `prose()` in `claims.js` turns inline code into the word "code", except a version (`1.14.2`, `v2`), which stays.
- Inside `claims.js`, inline code is marked ⟨…⟩, not with backticks. Patterns that look at code spans must use
  `OPEN`/`CLOSE`.
- `testCountsIn` returns the last summary in the output. `parts` now holds every printed summary's count.
- Never run `scripts/proof-corpus.mjs --misses` (it prints hold-out cases). When running the script, drop the eighth's
  row (`grep -v "Eighth hold-out"`).
- Live DSH before the e2e: pid 18756, patch sha256 63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7
  (9:30 PM PDT).
