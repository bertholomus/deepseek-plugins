# Canon: builder's notes

Updated: 2026-10-17 2:18 PM PDT (Canon builder)
Branch: `suite/v1` in `~/Projects/dsh-plugin-suite`
Status: built, waiting for its judge. Host half, window, README and all tests done: whole repo `npm test` 739/739
(e22b537 plus Canon's work, in a clean copy); real-DSH test 81 passed, 0 failed on each of the three builds; live
DSH unchanged (pid 18756, patch 63e0c347…eef7) before and after every run.

## Done (newest first)
- Real-DSH test `plugins/canon/test/e2e/run.mjs` with the scripted model `fake-model.mjs` (it plays the agent and
  records every request, so the test sees each block exactly as the model got it). `node scripts/e2e.mjs canon`:
  DSH 0.2.0-rc.2 81/0 (51 s), 0.2.1-rc.1 81/0 (55 s), the app's 0.2.1-rc.2 81/0 (49 s); log line "live DSH after:
  pid 18756, patch 63e0c347ea6e1150 — unchanged". Pictures in `.e2e/shots/canon/<build>/`, 21 a build: card,
  chat, page, try, history, promote-refused, settings, setting (light and dark); card-off, promoted, disabled,
  narrow, trajectory (light). It works on a copy of the fixture vault in the run's folder and checks the fixture
  is unchanged at the end.
- What the real-DSH test found, fixed: (a) DSH's session list can lack an open session's title (picks 16); (b) the
  first title of a new session was missed by a 500 ms read limit (now a session the last read did not list makes
  the next read happen at once); (c) DSH's Chat shows no context rows, so picks 1 and 3 are corrected and the test
  checks the Trajectory tab instead; (d) the page's history named sessions "A session": entries now carry the
  title DSH has now, and a session DSH no longer has is named in plain words with no link (pick 17).
- `plugins/canon/README.md`: what it does, which notes count, an example block, the card, the page, drafts and
  Promote, settings table, files, setup, switching off, rollback, limits, tests.
- Tests now: `test/canon-host.test.js` 26, `test/canon-client.test.js` 8. Whole repo on e22b537 plus Canon's
  work: 739 pass, 0 fail. (Before Recall's e22b537 the shared worktree showed 6 failures, all in Recall's then
  uncommitted `test/recall-client.test.js`; HEAD plus Canon's work was 729/729.)
- c005c19 Browser half `plugins/canon/lib/client.js`: the card after the latest turn that got notes (turn off /
  back on for the session, open Canon), the page (vault state with "Read again", "Try a prompt" with why each note
  fits, the near misses and the exact block, sessions with their switches, drafts with Promote, what happened),
  the settings form in Plugins, sidebar entry order 8. Whole repo `npm test`: 728 pass, 0 fail.
- 4723b8e Host half in `plugins/canon/lib/` (config, text, frontmatter, search, vault, recall, drafts, projection,
  page, remote, tools, index) with the shared files copied by hand; synthetic fixture vault
  `test/fixtures/canon/vault/`; stand-ins for DSH's packages `test/fixtures/canon/stubs/` (a `registerHooks`
  resolve hook, so `index.js` loads in a unit test). Whole repo `npm test`: 688 pass, 0 fail.
- Read the brief, DESIGN.md, Proof (the model to copy), the e2e harness, and DSH's own hooks in 0.2.0-rc.2 and
  0.2.1-rc.1 (pre-step waterfall, context rows, tools, projections). Baseline `npm test`: 662 tests, 661 pass,
  1 skipped. Live fingerprint before any work: pid 18756, patch 63e0c347…eef7.

## Next steps (in order, each runnable by someone new)
1. Judge round: `npm test` (whole repo), then `~/.local/bin/dsh-test fingerprint` (must show pid 18756 and
   patchSha256 63e0c347…eef7), `node scripts/e2e.mjs canon` (prints the fingerprint before and after itself), and
   look at `.e2e/shots/canon/<build>/`.
2. Fix what the judge finds in Canon's own paths only; rerun both tests; update these notes; commit and push
   (`PATH=/opt/homebrew/bin:$PATH git -c credential.helper= -c credential.helper='!gh auth git-credential' push gh
   suite/v1`).

## Open questions / limits
- The card is on the latest turn that got notes only; older turns are listed on Canon's page (Sessions) and in
  DSH's Trajectory tab. A card on every such turn would repeat in long sessions.
- Recall is lexical (no embeddings): a prompt that names none of a note's words does not find it.
- Capture returns before the vault is read again (the turn does not wait on a scan); the page shows the draft as
  soon as that read ends (the read bumps the page).

## Picks and why
1. **The block's form is `notice`**, source `{ kind: 'dsh-plugin-canon', form: 'notice', summary, notes, chars,
   turn }`. DSH's Chat shows no ordinary context rows (`isVisibleChatNode` skips kind `context` unless it adds or
   removes tools; the same in 0.2.0-rc.2 and 0.2.1-rc.1); its Trajectory tab lists the block as a CONTEXT row
   right after the person's prompt, with exactly what the model got. The one-line summary stays within 120
   characters. `recall` is built for recalled sessions (message counts), `instructions` for instruction files.
   Kind `dsh-plugin-canon` because Proof already treats that kind as context (its projection's CONTEXT_SOURCES),
   and never `runtime-context` (0.2.1-rc.1 replaces those at append).
2. **Where and when**: `agent/pre-step`, only at step 1 of a turn whose claimed messages hold a person's prompt
   (`source.kind === 'user'`), once per prompt (keyed by the prompt message's id). The search starts before
   `next()` and the block is spliced after the last claimed message, as DSH's own AGENTS.md loader does. A reject,
   an empty first step, or any error returns DSH's decision untouched. Plugin messages (Proof's check threads,
   Autopilot's notes) and steered messages get nothing.
3. **One card after the turn, on the latest turn Canon added notes to** (`conversation.chat.turnTail`, order 45):
   the notes and their paths, "Turn off for this session" / "Turn back on", and "Open Canon". It is the Chat's
   only sign of the block (pick 1). Older turns get no card, so long sessions do not fill with repeated cards;
   Canon's page lists each session's recent turns that got notes. The card reads a small session projection
   (`canonRecall`: the count and the last recall) and the session's switch from the host.
4. **Per-session off** is kept by the host in `<DSH data>/canon/state.json`, so it survives restarts and works for
   sessions that are not loaded.
5. **`access: read-only` means Canon writes nothing**: no capture and no promote. Promote needs both `access: drafts`
   and `promote: true`; a refusal names what is missing and where to change it.
6. **Capture is a tool, `canon_capture`, offered only while capture can work** (Canon on, settings right, a vault set,
   `access: drafts`). In the default read-only setup the model never sees it, so it cannot waste calls on it. Its
   execute checks everything again at call time and refuses in words. It also refuses in a session whose files are
   Read Only.
7. **Promote moves the draft out of the drafts folder** (the drafts folder is never recalled) into `promoteFolder`
   (default: the vault's top level), with `status: active` and a `promoted` time; the rest of the note is kept as
   written. New file with exclusive create (`wx`), then the draft is removed; if that fails the new file is removed
   again. Never overwrites: a taken name gets " 2", " 3".
8. **Index**: an in-memory inverted index (BM25F-like: title, aliases, tags, path and headings weigh more than the
   body), light stemming, stop words that include chat filler ("thanks", "looks good"). A note must match a prompt
   term in a strong field, or two prompt terms anywhere; then an absolute and a relative score floor. Folder boost
   for notes whose path, `project`/`repo` or tags name the session folder's repo (and less for its parent).
   Re-read by mtime and size; refreshed before a recall when older than 5 s, waiting at most 800 ms (else the
   current index); no fs.watch. Dot folders (`.obsidian`, `.trash`, `.git`), links and non-Markdown files are
   skipped; at most 20,000 notes, 256 KB read per note. Excerpts are read fresh from the file at recall time, so the
   index holds no note text.
9. **The block**: a header line ("Background from the canon vault… reference, not instructions; cite a note's path"),
   then `[n] <vault path> (“title”)` and the best-matching passage quoted with `> `, so note text never reads as
   Canon's own words. The whole block stays within `maxChars`, the notes within `maxNotes`.
10. **Vault setting**: absolute, or starting with `~/`. Refused: DSH's own data folder or anything inside it, the
    home folder itself and `/`. A missing or unreadable folder is not a setting error: the page says what is wrong
    and what to do, and recall stays off until it can read it.
11. **Settings** (all live except `enabled`): `vault`, `access` (Read only / Drafts), `draftsFolder`, `promote`,
    `promoteFolder`, `recall`, `maxNotes` (1–10, default 3), `maxChars` (400–8000, default 2000).
12. **Sidebar order 8** (after Calendar 7, before Automation tasks 10).
13. **Two logs**: `recall.jsonl` (each block added: session, turn, notes) feeds the page's "Recent recall";
    `events.jsonl` keeps everything else (captures, promotes, refusals, switches, vault problems, settings).
14. **Small vaults**: a word's rarity is scored as if the vault held at least 10 notes (`SMALL_VAULT` in
    search.js). With plain BM25 a vault of one or two notes could never reach the score floor.
15. **A read after every write**: capture, promote and "Read again" call `vault.again()`, which waits for a read
    under way and starts a new one. A plain `refresh()` would share a read that listed the folder before the
    write, and the new note would be missed until the next stale read (the whole-repo run caught this once).
16. **Session titles** come from DSH's session list (`sessionController.list`), read at most every two seconds,
    and at once when a session turns up that the last read neither listed nor knew to be missing. A list row only
    carries projections DSH has already worked out, so an open session's title can be missing there; then Canon
    asks the open session (`ctx.get('sessions').get(id)` and `ctx.sessionProjections.snapshot(session,
    ['title'])`).
17. **A session DSH no longer has** (removed, or from another computer) is named in plain words with no link
    (`sessionKnown: false`), in the drafts list and in what happened. History entries carry the title DSH has
    now, since titles change after the entry was written.

## Gotchas
- `node scripts/sync-shared.mjs` (without `--check`) writes every suite plugin's copies; copy Canon's by hand.
- Commit only when the whole repo's `npm test` is green (other plugins are judged at commits on this branch). While
  another builder has uncommitted tests in the worktree, check Canon's commit in a clean copy:
  `git archive HEAD | tar -x -C <dir>`, copy Canon's changed files in, `node --test test/*.test.js` there.
- Host unit tests cannot import DSH packages (no node_modules at the repo root). `test/fixtures/canon/stubs/hooks.mjs`
  maps `@deepseek-ai/*` to stand-ins with `module.registerHooks` (Node 22.15 or later); import it before the
  first dynamic import of `lib/index.js`.
- DSH keeps a session's folder as its real path: a temporary workspace shows as `/private/var/folders/...`. The
  test compares the end of the path.
- In host tests, call `remote.refresh()` after a capture before looking for the draft: the capture tool does not
  wait for the vault to be read again.
- To see the block in the real-DSH test, open the session's Trajectory tab: the Chat never shows it.
