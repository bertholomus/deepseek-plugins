# Recall: builder's notes

Updated: 2026-10-17 2:24 PM PDT (Recall builder, a subagent of account B's suite run)
Branch: `suite/v1` (worktree `~/Projects/dsh-plugin-suite`)
Status: host (34 tests), browser half (10 tests) and bench (2 tests) done; real-DSH test and README next.

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

- Browser half (commit "recall: the window …"): `plugins/recall/lib/client.js` (Recall's page with search, filters,
  results, reading view, index and what happened; the "Found by Recall" mark after a found turn; the tool's card in a
  chat; settings in Plugins) and `test/recall-client.test.js` (10 tests). Host: the tool switch's title no longer
  names the tool ("Let agents search past work"), and the page state carries the home folder so paths read `~/…`.
  Whole-repo `npm test` on HEAD plus these files only: 738 pass, 0 fail.

- Bench (commit "recall: bench …"): `scripts/recall-bench.mjs` (10k synthetic sessions through Recall's own index
  thread) and `test/recall-bench.test.js` (200 sessions, end to end, plus percentiles). It found two slow paths, both
  fixed in `lib/store.js`: a search with kind and date filters took 7.4 s (SQLite led the join with the filter's
  index and ran the full-text match again for every row: now `CROSS JOIN`, 27 ms), and opening a 285 MB index took
  2.3 s (`PRAGMA quick_check` on every open: now only after an unclean close, which a marker file beside the index
  says; 22 ms). 10k sessions (120,519 turns, Apple M4 under load average ~6.8, Node 22.20): 260 searches median
  33.7 ms, p95 96.3 ms, slowest 201 ms; first index 19.9 s, 285 MB, DSH's thread held up at most 12.6 ms.

## Next steps (in order)
1. (done) Host modules with unit tests.
2. (done) Browser half with `test/recall-client.test.js`.
3. (done) `scripts/recall-bench.mjs` (10k synthetic sessions, median and p95), numbers into the README; a small bench test.
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

- **The window keeps one search** (a module-level store, not the page's state): leaving the page for a session and
  coming back shows the same words, filters, results and scroll place, so "Back to the results" means it.
- **Search while typing**, 200 ms after the last key; the last word searches as a prefix (`prefix: true`), so
  "deplo" finds "deploy" and "deployment". Enter searches at once; Escape clears. With nothing typed the page shows
  the newest turns, and reads them again when the index grows.
- **Filters as DSH menus** (When, Folder, Model; their choices from `facets`, read when a menu opens, at most every
  30 s), the kind as a segmented choice only when more than one kind is searched, and the order (best match or
  newest) only when words are typed (with no words, newest is the only order that means anything).
- **Opening at the turn.** A session of this DSH opens in DSH (`uiWorkspace.openSession`), then DSH's own
  `loadThrough(seq)` pages its history back to the turn (raced against 15 s), then the mark lands it: the mark is in
  `conversation.chat.turnTail` (order 50, after DSH's own tails), so it is drawn only when DSH draws that turn; its
  effect finds the chat's scroller, brings the turn's first row to 24 px under the top, and puts
  `data-recall-found` on the turn's rows (a 2 px line in DSH's primary colour). DSH lands a chat it opens at its end
  a moment later, so it tries at 0, 120, 350, 800 and 1,500 ms, and stops at the person's first wheel, touch, click
  or key. A turn still open has no tail: 2.5 s after opening, Recall lands in the one chat that holds the turn.
  "Done" takes the mark and the line off; switching Recall off does too.
- **Reading view in the page** for transcripts, notes and sessions of another DSH (they cannot open in this window),
  with the turn before and after, and "Open the session at this turn" for this DSH's sessions. "Read here" on a
  session result shows a turn without leaving the page.
- **Settings in Plugins:** DSH's settings form, with Recall's own spec for folder lists (commas or lines between
  folders, each a full path or `~/…`, at most 20; a typed list that does not fit is never saved, and a saved value of
  the wrong kind is flagged).
- **Sidebar entry order 9** (after the suite's earlier pages); the tool's card in `tool.call.toolview` keyed by the
  tool's name, drawn like DSH's tool rows (a disclosure row; results as rows with Open or Read, and "Search this in
  Recall"). No tool name, ids or raw paths where people read: paths show from `~`.

- **Index check only after an unclean close.** `PRAGMA quick_check` reads the whole file (2.3 s at 285 MB). The store
  writes `index.sqlite.open` when it opens and removes it on a clean close; a mark left behind (DSH killed) means the
  next open checks in full first (2 s, in the index thread; searches wait). WAL with synchronous NORMAL does not
  corrupt on a crash, so the check guards against disk damage, which is rare.

## Gotchas
- FTS5 joined to another table: when a filter has an index, SQLite may lead with it and evaluate `MATCH` once per row
  (seconds). `CROSS JOIN` with `fts` first keeps the match as the outer loop. The bench's "sessions of the past month"
  query is the canary.
- FTS5 joins two phrases with a space, but a bracketed OR group only with an explicit `AND`: `"a" ("b" OR "c")` is a
  syntax error. lib/query.js joins every group with ` AND ` (tested by running each query in SQLite).
- Porter stems "deploy" to "deploi" but "deployment" to "deploy": they do not match each other. Accepted (FTS5's own
  stemmer); prefix search while typing ("deplo*") finds both.
- DSH logs `turn/start` before the turn's `user/message` (dsh-agent-loop: the turn opens, then each step appends its
  request's messages). A message read in a later step of the same turn (a follow-up) belongs to that turn.
- Thread timers are unref'd (they never keep DSH running); a test that waits on one keeps its own interval.
- `zlib.zstdDecompressSync` decodes one frame only: split the file into frames first (lib/zstd.js).
- node:sqlite prints an ExperimentalWarning once in Node 22; it loads only inside the worker.
- Client tests: values made in the client's vm realm need `plain()` before `deepEqual`; parts with hooks must be
  mounted (not called) under the stateful stand-in React, or their effects run in the next mount; a test that
  searches or opens a session needs a fake connection and `views.sessions`, else a 10 s or 5 s wait keeps the run alive.
- DSH's `system/message` and `request/header` lines are large: the parser reads each line's type from its first
  bytes and parses only the types it uses.
