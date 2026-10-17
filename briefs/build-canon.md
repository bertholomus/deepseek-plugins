# Canon: builder's notes

Updated: 2026-10-17 1:33 PM PDT (Canon builder)
Branch: `suite/v1` in `~/Projects/dsh-plugin-suite`
Status: building. Host half and its tests done (`npm test` 688/688); the window, e2e and README next.

## Done (newest first)
- Host half in `plugins/canon/lib/` (config, text, frontmatter, search, vault, recall, drafts, projection, page,
  remote, tools, index) with the shared files copied by hand; synthetic fixture vault `test/fixtures/canon/vault/`;
  stand-ins for DSH's packages `test/fixtures/canon/stubs/` (a `registerHooks` resolve hook, so `index.js` loads in
  a unit test); `test/canon-host.test.js`, 26 tests, including the whole plugin with DSH stood in for. Whole repo
  `npm test`: 688 pass, 0 fail.
- Read the brief, DESIGN.md, Proof (the model to copy), the e2e harness, and DSH's own hooks in 0.2.0-rc.2 and
  0.2.1-rc.1 (pre-step waterfall, context rows, tools, projections). Baseline `npm test`: 662 tests, 661 pass,
  1 skipped. Live fingerprint before any work: pid 18756, patch 63e0c347…eef7.

## Next steps (in order, each runnable by someone new)
1. Browser half `plugins/canon/lib/client.js` (kit block between the markers, copied from `shared/client-kit.js`),
   client tests; commit.
2. Real-DSH test `plugins/canon/test/e2e/run.mjs` + `fake-model.mjs`; `node scripts/e2e.mjs canon` with the live
   fingerprint read before and after (`~/.local/bin/dsh-test fingerprint`); screenshots land in
   `.e2e/shots/canon/<build>/`.
3. README; commit and push (`PATH=/opt/homebrew/bin:$PATH git -c credential.helper= -c
   credential.helper='!gh auth git-credential' push gh suite/v1`).

## Picks and why
1. **The block's form is `notice`**, source `{ kind: 'dsh-plugin-canon', form: 'notice', summary, notes, chars }`.
   DSH draws a notice as a collapsed "Context injection" row with our one-line summary (at most 120 characters,
   DSH's own cap) and, opened, exactly what the model got. `recall` is built for recalled sessions (message counts),
   `instructions` for instruction files. Kind `dsh-plugin-canon` because Proof already treats that kind as context
   (its projection's CONTEXT_SOURCES), and never `runtime-context` (0.2.1-rc.1 replaces those at append).
2. **Where and when**: `agent/pre-step`, only at step 1 of a turn whose claimed messages hold a person's prompt
   (`source.kind === 'user'`), once per prompt (keyed by the prompt message's id). The search starts before
   `next()` and the block is spliced after the last claimed message, as DSH's own AGENTS.md loader does. A reject,
   an empty first step, or any error returns DSH's decision untouched. Plugin messages (Proof's check threads,
   Autopilot's notes) and steered messages get nothing.
3. **One card after the turn, on the latest turn Canon added notes to** (`conversation.chat.turnTail`, order 45):
   the notes and their paths, "Turn off for this session" / "Turn back on", and "Open Canon". DSH's own context row
   already marks every turn that got notes, so older turns get no card (no repeated cards in long sessions). The
   card reads a small session projection (`canonRecall`: the count and the last recall) and the session's switch
   from the host.
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

## Gotchas
- `node scripts/sync-shared.mjs` (without `--check`) writes every suite plugin's copies; copy Canon's by hand.
- Commit only when the whole repo's `npm test` is green (other plugins are judged at commits on this branch).
- Host unit tests cannot import DSH packages (no node_modules at the repo root). `test/fixtures/canon/stubs/hooks.mjs`
  maps `@deepseek-ai/*` to stand-ins with `module.registerHooks` (Node 22.15 or later); import it before the
  first dynamic import of `lib/index.js`.
