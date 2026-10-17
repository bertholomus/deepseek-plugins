# Recall: builder's notes

Updated: 2026-10-17 1:35 PM PDT (Recall builder, a subagent of account B's suite run)
Branch: `suite/v1` (worktree `~/Projects/dsh-plugin-suite`)
Status: host half done and tested (33 tests); browser half next.

## What Recall is (brief, section 6)
Search everything we already did. A full-text index over DSH session files (`.jsonl.zstd`), optional coding-agent
transcript folders and Markdown handoff folders (all paths configurable). Incremental, local, fast (target under 300 ms
a query on 10k sessions, measured). Results link back to the exact turn. Filters (folder, model, date, kind) and a
`recall_search` tool for agents.

## Done
- Host half (commit "recall: host half …"): `plugins/recall/lib/` zstd, turns, sessionlog, transcripts, handoffs, query,
  store, indexer, engine, worker, thread, config, tool, page, remote, index; package.json, cordis.patch.yml,
  locale/en.json, icon.svg; synthetic logs in `test/fixtures/recall/corpus.mjs`; `test/recall-host.test.js` (33 tests:
  frames incl. torn and broken writes, sessions incl. forks, subagents and context, transcripts, notes, FTS5 query
  syntax run in SQLite, incremental updates, filters, ranking, snippets, the tool's bounds, settings, the worker and
  its restart policy). Whole-repo `npm test`: 721 pass, 0 fail.
- Research (no repo changes): real event shapes from a throwaway DSH (scripted model), DSH's turn-jump loader, the chat's
  `data-chat-turn` rows, node:sqlite + FTS5 + zstd + worker threads in both runtimes (Node 22.20, the app's Node 24.21),
  an FTS5 prototype on 10k synthetic sessions (124,716 rows: build 5.3 s, 307 MB, ranked queries 2 to 58 ms).

## Next steps (in order)
1. (done) Host modules with unit tests.
2. Browser half `lib/client.js` (page, filters, results, reading view, the "Found by Recall" mark, the tool's card,
   settings) with `test/recall-client.test.js`.
3. `scripts/recall-bench.mjs` (10k synthetic sessions, median and p95), numbers into the README; a small bench test.
4. Real-DSH test `plugins/recall/test/e2e/run.mjs` + `fake-model.mjs`; `node scripts/e2e.mjs recall` on all three
   builds with the live fingerprint checked; pictures in `.e2e/shots/recall/<build>/`.
5. README; commit and push after each green step.

## Picks and why
- **One worker thread owns the index.** SQLite (node:sqlite, built into Node 22.13+ and the app's Node 24) with FTS5,
  in `<DSH home>/recall/index.sqlite`, opened only by a worker thread (`lib/worker.js`). The DSH process only posts
  messages, so indexing never blocks a turn or the window. The worker indexes in slices of about 40 ms and answers
  searches between slices. Why not in DSH's own thread: a first index of 10k sessions takes seconds of CPU.
- **One row per turn.** The person's words (and plugins' messages to the agent), the replies (head 3,000 + tail 9,000
  characters, where answers end), and one line per tool call with its key argument (command, path, pattern, URL,
  query), bounded. Tool output is not indexed: it is huge, noisy, and mostly repeated by the reply. Columns get bm25
  weights title 4, prompt 2, reply 1, tools 0.7, with a mild recency lift (up to 30% for this week).
- **Context messages are left out.** User messages whose source is DSH's injected context (instructions, runtime and
  time context, job notices, any `form` of instructions/catalog/snapshot/notice) would make every session match
  words like "AGENTS". The person's own messages, scheduled prompts, other agents' relays and plugins' notes stay.
- **Incremental by byte offset.** DSH appends one zstd frame per write; Recall keeps, per file, the offset after the
  last whole frame, the parser's state (the open turn, bounded) and the file's size, mtime and inode. A grown file is
  read from its offset; a shrunk or replaced file is read again whole. A frame cut short by a write in progress waits
  for the next pass. Coding-agent transcripts work the same way by lines. Markdown files are read whole when they change.
- **Forked sessions:** a seeded log starts with its parent's events up to `session/end-seed` (`inherited: true`);
  Recall skips those turns so a fork does not repeat its parent's hits.
- **Subagent sessions (delegation depth > 0) are not indexed in v1:** DSH opens them through their parent, which the
  log header does not name, so a result could not open. The parent's turn has the subagent call's prompt.
- **Change detection:** DSH's `session/event` tells the worker which session moved (re-read 1.5 s later, batched);
  every folder is walked again every 60 s for new, changed and deleted files. A file gone from a folder that still
  exists loses its rows; a whole folder gone (an unplugged disk) keeps its rows and says so.
- **Exact turn:** a result keeps the turn number and its `turn/start` seq. Opening one opens the session
  (`uiWorkspace.openSession`), pages DSH's history back with the session's own `loadThrough(seq)` (the loader DSH's
  turn jump uses), scrolls to the turn's first row, and marks the turn with a "Found by Recall" card in
  `conversation.chat.turnTail`. Transcript turns and note sections open in Recall's own reading view, with the file
  and line.
- **Filters:** kind (DSH sessions, transcripts, notes), folder (the session's folder or a note's folder, subfolders
  included), model, date (today, past week, month, year), sort (best match, newest).
- **Tool:** `recall_search` (query, kind, folder, model, since, until, limit up to 20, or `open` with a result id to
  read that turn in full, bounded to 6,000 characters). Text from past sessions is marked as information, not
  instructions. A live setting can take the tool away from agents.
- **Settings:** `enabled` (profile only), `sessions` (this DSH's sessions, on), `sessionFolders` (other DSH homes'
  `sessions` folders), `transcriptFolders`, `handoffFolders` (all live, commas between folders in the form),
  `tool` (on). Folder lists are checked (absolute or `~/` paths, at most 20 each); a missing folder is a status, not
  a setting error.

## Gotchas
- FTS5 joins two phrases with a space, but a bracketed OR group only with an explicit `AND`: `"a" ("b" OR "c")` is a
  syntax error. lib/query.js joins every group with ` AND ` (tested by running each query in SQLite).
- Porter stems "deploy" to "deploi" but "deployment" to "deploy": they do not match each other. Accepted (FTS5's own
  stemmer); prefix search while typing ("deplo*") finds both.
- DSH logs `turn/start` before the turn's `user/message` (dsh-agent-loop: the turn opens, then each step appends its
  request's messages). A message read in a later step of the same turn (a follow-up) belongs to that turn.
- Thread timers are unref'd (they never keep DSH running); a test that waits on one keeps its own interval.
- `zlib.zstdDecompressSync` decodes one frame only: split the file into frames first (lib/zstd.js).
- node:sqlite prints an ExperimentalWarning once in Node 22; it loads only inside the worker.
- DSH's `system/message` and `request/header` lines are large: the parser reads each line's type from its first
  bytes and parses only the types it uses.
