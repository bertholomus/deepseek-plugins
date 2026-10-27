# Canon round 4: builder's notes

Updated: 9:08 PM PDT Mon Oct 19 (round-4 builder)
Status: reading done; baseline next. Aim: freeze by 11:45 PM PDT (moved from 2:45 AM by the coordinator after the
usage-limit stop).

## Live DSH fingerprint (dsh-test fingerprint)
- At the start (12:35 AM PDT Oct 18, before the stop): pid 18756, started Sat Oct 17 10:39:36 2026, patch sha256
  63e0c347…05eef7. Nothing of this work ran while it changed.
- After the stop (9:06 PM PDT Oct 19): pid 87589, started Sun Oct 18 21:58:42 2026, patch sha256
  574154d308d0db44080ad14137858f873c2966585348481b5264368fb8fa78ee. The coordinator says the live DSH was restarted
  from outside this work; this is the before and after value for every e2e run.

## Done (newest first)
- Read the brief, the round-3 scorecard, OPEN-QUESTIONS #29 #33 #38 #40 #41, build-canon-r2/r3, DESIGN.md, every
  Canon file, its tests, the relevance helper and script, the e2e script and runner.

## Next steps
1. Baseline: `node scripts/canon-relevance.mjs --set dev` and `--set holdout2 --misses`.
2. Dev additions: the judge's two sets (paths checked, kinds), 40+ casual coding requests, 12+ decision statements.
3. Fit rules (Finding 1), chosen on dev and the second hold-out only.
4. The third hold-out's hooks (helper, script, two skipping tests). Never create the file.
5. Findings 2 to 6, unit tests; README and RELEVANCE.md.
6. `npm test` in full; the e2e three times with fingerprints; freeze.

## Picks and why
- The handoff file for this work is this file: the brief limits the files I may change, so HANDOFF.md is not mine.

## Gotchas
- Never edit plugin files while the e2e runs.
