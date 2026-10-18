# Proof round 3: builder's notes

Updated: 2026-10-17 9:31 PM PDT (Proof round-3 builder, a subagent of session `main`)
Branch: `suite/v1` (worktree `~/Projects/dsh-plugin-suite`)
Status: the reading (step 1) and per-claim scoring (step 2) are done and committed. Window work, README and real-DSH
steps (4 to 6) come next and change no verdict.

Reading frozen at 6945092

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

## Done
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

  The round-2 probes are 87 of 87 right.
- Tests:
  - `node --test test/proof*.test.js`: 126 pass, 0 fail, 3 skipped (ninth, tenth and seen9 absent).
  - Full `npm test` on a clean copy of 6945092: 826 pass, 1 fail, 4 skipped. The failure is
    `test/canon-relevance.test.js` "first hold-out … four floors". It fails the same way at 4bfe77c, before these
    commits, and comes from Canon's committed state, not Proof's files.

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
- Inside `claims.js`, inline code is marked ⟨…⟩, not with backticks. Patterns that look at code spans must use
  `OPEN`/`CLOSE`.
- `testCountsIn` returns the last summary in the output. `parts` now holds every printed summary's count.
- Never run `scripts/proof-corpus.mjs --misses` (it prints hold-out cases). When running the script, drop the eighth's
  row (`grep -v "Eighth hold-out"`).
- Live DSH before the e2e: pid 18756, patch sha256 63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7
  (9:30 PM PDT).
