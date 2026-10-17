# Canon round 2: builder's notes

Updated: 2026-10-17 4:25 PM PDT (Canon round-2 builder)
Branch: `suite/v1` in `~/Projects/dsh-plugin-suite`
Status: vault grown and frozen, dev set written and measured before any tuning; tuning next (code only).
Vault frozen at f7283b5: test/fixtures/canon/vault

For the hold-out writers (their brief is the coordinator's; these are facts about the measuring, not rules):
the file is `test/fixtures/canon/relevance/holdout.json`, a JSON list of
`{ "id", "folder", "prompt", "answers" }`. `folder` is a full path, one starting with `~/` (measured as
`/Users/someone/...`), or "" for a session with no folder. `answers` lists vault paths of ACTIVE notes only (no status
or `status: active`, outside `Drafts/`; never `.obsidian/`, `.trash/`, `Attachments/`, a draft, or a note whose status is
superseded, archived, proposed or draft); empty when no active note answers. `node scripts/canon-relevance.mjs --set
holdout --misses` measures it; `npm test` holds it to the floors of OPEN-QUESTIONS #29 once the file is there.

Live DSH fingerprint before any work (3:40 PM PDT): pid 18756, started Sat Oct 17 10:39:36 2026, patch sha256
63e0c347ea6e115055480f4a0dc2cdcbb42287034525e2d9b0d59a072505eef7.

## Done (newest first)
- Dev set `test/fixtures/canon/relevance/dev.json` (77 prompts: 47 a note answers; 8 that only name a project, 8 of
  chat filler, 8 of words about the vault, 6 others no note answers), the measuring helper
  `test/helpers/canon-relevance.mjs`, `scripts/canon-relevance.mjs [--misses] [--set dev|holdout]`,
  `test/canon-relevance.test.js` (dev held to the figures reached; hold-out skips while absent), host tests' counts for
  the grown vault. Before tuning: first note answers 40 of 47 (85.1%), answering note in the block 45 of 47 (95.7%),
  1.04 notes per block that do not answer (48 in 46), no block for 8 of 30 (26.7%).
- f7283b5: the fixture vault grown and frozen: 42 notes (35 active, 2 drafts, 5 with another status). Projects
  lantern-api, lantern-web, quartz-cache next to harbor-gateway and tide-ledger; People (On-call, Owners, Onboarding,
  Glossary); Decisions (4 active, 2 superseded); Runbooks (5 active, 1 archived); Ideas (1 active, 1 proposed, 1 draft);
  Misc (a mascot note with an instruction-like line, the office); Home.md full of words about the vault.
- Read the scorecard, DESIGN.md, the round-1 notes, OPEN-QUESTIONS #29, all of `plugins/canon/`, its tests, its
  real-DSH test and `scripts/e2e.mjs`.

## Next steps (in order, each runnable by someone new)
1. Tune `plugins/canon/lib/search.js` (and `text.js`) on the dev set with general rules only: a project's name counts
   as one term for the two-word rule and the floors, a note needs a prompt word beyond the project's name, words about
   the vault (note, vault, canon, shared, team) are left out of prompts. Measure with
   `node scripts/canon-relevance.mjs --set dev --misses`; raise `DEV_REACHED` in `test/canon-relevance.test.js`;
   update the host tests' recall expectations. Never touch the vault.
2. Finding 1: the vault folder's own listing error sets the error state (`lib/vault.js` `read()`), with unit tests
   and a real-DSH step on a `chmod 000` copy.
3. Findings 3, 4, 5, 6: `~/` in the try-out, the block says where its paths live, wrong types said in words, the
   form refuses a promote folder inside the drafts folder.
4. README "How well it picks notes" with the dev figures.
5. Findings 7, 8, 9: focus, README on Read only's reach, the nits.
6. e2e counts for the grown vault (35 active, 2 drafts, 5 other); `npm test`, then `node scripts/e2e.mjs canon` on
   all three builds with the live fingerprint before and after.

## Picks and why
- The vault was committed alone (f7283b5), then the dev set, the helper and the tests' new counts right after it, so
  HEAD was red only between those two pushes.
- Answers name only notes Canon may add (active ones): a prompt only a draft, a superseded decision or an idea with
  another status answers has no answers, since no turn can ever get those notes.
- The dev set's ids say their kind by their letter (a answerable, p project only, f filler, v words about the vault,
  u other prompts nothing answers); the helper groups by it only for the table.
- Measuring goes through Recall's `agent/pre-step` handler with a stand-in step, so the block is exactly a turn's
  (default settings: 3 notes, 2,000 characters; home `/Users/someone`).

## Gotchas
- Never create or read `test/fixtures/canon/relevance/holdout.json`: fresh writers write it. Before each `npm test`,
  check only whether it exists (`test -e`); if it does, run the tests on a clean copy without it.
- Never change a note in `test/fixtures/canon/vault` after f7283b5: the hold-out's answers are its paths.
- `node scripts/sync-shared.mjs` (without `--check`) writes every plugin's copies; the kit and `lib/shared/` are not
  Canon's to change.
