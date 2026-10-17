# DSH 0.2.x session files on disk — layout, format, fast reading

Read-only research over `.e2e/dsh-0.2.0-rc.2/` and `.e2e/dsh-0.2.1-rc.1/`. Citations are
paths relative to `node_modules/@deepseek-ai`. Format version on disk is **v4** in both
runtimes (`dsh-session/lib/index.js:56` `SESSION_FORMAT_VERSION = 4`).

## 1. Folder layout under DSH_HOME

DSH home defaults to `~/.dsh`, overridable by `DSH_HOME` (`dsh-home-paths/lib/index.js:12,17`).
Sessions are stored by a JSONL backend plugin whose config is `{ root: string, compression:
"zstd" | "none" }` with default compression `zstd`
(`dsh-session-persistence-jsonl/lib/index.js:2374-2377,2285`). The root is observed as the
`DSH_HOME/sessions/` folder in test homes; the composition that binds `root` lives in the app
bundle, not in these node_modules.

Observed layout of `~/.dsh-test-dna/` (folder names only):

- `sessions/` — session store root. Siblings: `attachments`, `logs`, `profiles`, `session-bridge`,
  `storages`, `wallpaper`.
- `sessions/<projectKey>/` — one folder per working directory (project).
  Example: `sessions/--Users-albertlee-Projects-dna-photo-studio--/`.
- `sessions/<projectKey>/<session-id>/` — one folder per session.
  Example: `session-34cacfcf-a598-47d7-8dcb-bdf8853a9116/`.
- inside a session folder: `session.v4.jsonl.zstd` (the log) and `session.lock` (write lease).
- `storages/session_projcache/sessions/<sessionId>.json` — projection-cache checkpoint,
  one JSON document per session (`dsh-session-projection-cache/lib/index.js:15,141`;
  observed `~/.dsh-test-dna/storages/session_projcache/sessions/`).
- `storages/workspace.json` — workspace registry state; archived sessions are recorded here as
  id lists, not moved on disk (`dsh-workspace/lib/index.js:231-245` `archivedSessionIds`).

Name construction code (`dsh-session-persistence-jsonl/lib/index.js`):

- Project key from cwd: separators `/ \ :` collapse to `-`, unsafe units escape `~XXXX`, result
  wrapped `--<name>--`, truncated to 251 chars (lines 875-894, `projectKey`). A session with no
  cwd goes to `<root>/_no-cwd` (line 902-904).
- Session id encoded by `encodeSegment` — literal `[A-Za-z0-9._-]`, everything else `~XXXX`
  (lines 853-865) — becomes the session folder name (lines 914-915).
- Log file: `session.vN.jsonl` + `.zstd` suffix; `session.v4.jsonl.zstd` for the current format
  (lines 747-763 `generationLogFilename`; `dsh-session-format/lib/index.js:472-475`:
  `session.v${generation}.jsonl`). `session.jsonl` (no vN) is the retired v0 name.
- `session.lock` is the single-writer lease file (`flock` on POSIX, named mutex on Win32),
  lines 616-650 and 2923-2925.
- Older flat layout `sessions/<projectKey>/<id>.jsonl[.zstd]` is rejected at load
  (lines 3434-3441, 3453-3461).

## 2. File format

Physical file = concatenated zstd frames of JSONL text (compression `none` writes plain text;
`zstd` is the default, `index.js:2285-2297`).

**One frame per write, not one per file.** Materialization writes the header line and the first
batch as *separate* frames (`encodeMaterialization`, lines 3184-3193: `Buffer.concat([headerFrame,
eventFrame])`). Each durable append is exactly one frame containing one batch's lines
(`encodeEventBatch`, lines 3194-3198). The module doc says it plainly (lines 1282-1287): "The
backend owns a concatenated-frame container so it can append and recover batches without exposing
compression mechanics." Frames are written with checksum enabled and flushed + fsynced per append
(`compressZstdFrame` lines 1364-1371; `appendLines` lines 3215-3242 opens the path with `"a"`,
`writeFile`, `handle.sync()`; on failure it rolls the file back to the pre-append size, lines
3243-3251).

Line shapes (v2 framing retained by the v4 codec — `dsh-session-format-v3-to-v4/lib/index.js:
1044-1100`):

- Header line (first line, own frame): `{ type: "session", version, id, createdAt, isSeeded,
  delegationDepth, cwd?, parentSession?, origin?: "subagent", agentPreset? }`
  (`dsh-session-persistence-jsonl/lib/index.js:777-790`; guard at 839-841).
- Event lines: `{ type, seq, time, data }` plus optional `ignorable: true` and surface fields
  `sourceEventSeqs` / `surfaceOp` (`dsh-session-format-v1-to-v2/lib/index.js:41-57`). `seq` is
  dense — row index === seq (line 95); `time` is a safe integer (epoch ms; line 96). A frame must
  end on a record boundary; a torn final frame is recovered and truncated
  (`readZstdPrefix`, lines 2936-3002).

Where the content lives (`dsh-session/lib/types/known-event-types.js:21-81` has the full type
list; data shapes from `dsh-session/lib/types/index.js`):

- **User text**: `user/message` — `data` IS the message record: `{ id, role: "user", source:
  {kind: "user", ...}, content: [...] }` (lines 242, 255; role map 239-245). Text blocks are
  `{type: "text", text}`; block types include `reasoning`, `image`, `file`, `tool-call`,
  `tool-result` (`dsh-session-format-v3-to-v4/lib/index.js:1123-1130`).
- **Assistant text**: `assistant/message` — `data: { turn, step, stream, message: { id, role:
  "assistant", source: {kind: "model", provider, model, ...}, content } }` (turn/step check lines
  209-217; model source required 282-286). `assistant/attempt` carries `{turn, step, stream}`.
- **Model + provider**: `request/header` — `data: { header: { config: { provider, model,
  reasoningEffort?, maxTokens? }, adapterDefaults }, reason: "initial"|"resume"|"change"|"series",
  startsSeries? }` (lines 176-195, 300-306 `hasProviderModel`).
- **Tool calls**: `tool/call` — `data: { turn, step, callId }` (`dsh-session/lib/types/invariant.js:
  87-89`).
- **Tool results**: `tool/result` — `data: { turn, step, message: { role: "tool", toolCallId,
  content, isError? }, source: {kind: "tool", callId}, error? }` (invariant.js:91-104;
  `dsh-session/lib/types/index.js:288-297`).
- **Turn number**: `turn/start` / `turn/end` events, and every assistant/step event embeds its
  `turn` (invariant.js:88).
- **Session title**: `session/title` — `data: { title }`; the list projection folds the latest
  one (`dsh-session-title/lib/index.js:177,192`). Renames also update the projection cache
  (`dsh-api-session-controller/lib/client.js:2751-2757`).

## 3. How DSH reads/writes zstd

All of it is **Node's built-in `node:zlib`** — no third-party library in this package:

- `import { constants, createZstdCompress, createZstdDecompress, zstdCompress, zstdDecompress,
  zstdDecompressSync } from "node:zlib"` (`dsh-session-persistence-jsonl/lib/index.js:15`).
- Write path: `zstdCompressAsync = promisify(zstdCompress)` (line 1289), frames written with
  `{ params: { ZSTD_c_checksumFlag: 1 } }` (line 1291) — every frame self-verifies.
- Read path: fast decoder is a Node-*private* stream handle reuse (`createZstdDecompress` +
  `handle.writeSync`, lines 1133-1245); if the private shape is missing it falls back to public
  `zstdDecompressSync` per frame (lines 1247-1279, 1385-1387). Torn final frame is recovered with
  `{ finishFlush: ZSTD_e_flush }` (lines 1292, 1395-1397). A worker-thread verifier exists for
  migrations (lines 1400+, `worker.cjs`).

`node:zlib` zstd on the Node on PATH (run 2026-10-17): `v22.20.0 function function function` for
`zstdDecompressSync, zstdCompressSync, createZstdDecompress`. Node's own docs put zlib zstd at
Node 23.8+ (22.17+ for LTS), so any plugin reading these files can use `zlib.zstdDecompressSync`
directly. A plain multi-frame file is just N independent frames — `zstdDecompressSync` handles one
frame; concatenate decoded frames, or loop with frame scanning like DSH does (`scanZstdFrames`,
lines 1300-1363, magic `0xFD2FB528`).

## 4. Change detection for an index

- **Revision token = stat identity**: `fileRevision(identity)` = `dev:ino:size:mtimeNs:ctimeNs`
  joined by `:` (`index.js:2324-2332`). `list()`/`snapshot()` return it alongside each record
  (lines 2552-2556, 2582-2586); a memoized decode is only reused while the revision matches
  (lines 2638-2646, 2784-2792). This is the token a plugin should compare before re-reading.
- **Reads are append-only**: appends only ever add bytes (open `"a"` + fsync, lines 3215-3242);
  a read that observes the file *shrank* is an error (lines 104). So "size grew" ⇒ new frames at
  the end; an index can `stat` (size/mtime) and decode only frames past its last byte offset —
  frames are independent, so the new part decodes standalone.
- **Stable read discipline**: a file is read twice around a `readFile` with stat compare, retry
  once, then committed-prefix fallback (`readStableSnapshot`, lines 1647-1667) — an index should
  copy this if it must never see a mid-append view.
- **No in-header seq counter** usable for this; the header line is written once at materialize.
  The `session_projcache` record instead carries a per-projection `seq` watermark and the log's
  immutable identity (`formatVersion`, `createdAt`, `cwd`, `isSeeded`, `inheritedEventCount`) to
  reject stale checkpoints (`dsh-session-projection-cache/lib/index.js:31-53`).

## 5. `sessionController.list()` item fields

Host list item (`dsh-api-session-controller/lib/index.js:1870-1881, 1907-1918, 2040-2049`) is
projected to the client (`.../types/client/sessions/service.js:490-513`):

- `id` (sessionId), `displayTitle` — derived: durable `title`, else cwd basename, else id
  (`service.js:45-48`), `title?` — durable `session/title` projection value, `cwd?`,
  `parentSessionId?`, `origin?` (`"subagent"`), `running` (agent status), `blank`
  (true until first `turn/start` — `index.js:1808`), `updatedAt` = `max(header.createdAt,
  lastPromptAt)` (`index.js:2040-2042`), `retainedBy`, and `projectionValues` which includes
  `sessionListMetadata: { blank, lastPromptAt }` (`index.js:1789-1792`) and
  `modelSelection: { lastUsed: { provider, model, reasoningEffort? } | null, next | null }`
  (`index.js:2052-2059`). `lastPromptAt` updates on `user/message` with `source.kind === "user"`
  (`index.js:1809`).
- **Model is a projection value, not a header field.** Read `projectionValues.modelSelection.lastUsed`
  (durable `model/selection` events folded per session, `index.js:2075+`), not the log header.
- **Archived is not on the list item.** Archiving is workspace-registry state
  (`dsh-workspace/lib/index.js:245`); the client exposes `archivedSessionIds` via
  `dsh-api-workspace-controller` (`.../lib/index.js:52,69`). Gate for delivery:
  `dsh-api-session-controller/lib/index.js:2405-2451`.

## 6. 0.2.0-rc.2 vs 0.2.1-rc.1

Same storage: `SESSION_FORMAT_VERSION = 4` in both, `dsh-session-format/lib/index.js` byte-identical,
`projectKey`/`encodeSegment`/filename logic identical (only line offsets moved). Differences in
`dsh-session-persistence-jsonl/lib/index.js` (~355 diff lines, all lifecycle/perf):

- rc.1 wraps live event routing and open-handle closing in one ordered `ctx.effect` so listeners
  unregister and handles close in order at teardown (rc.2 registered them separately).
- rc.1 adds bounded listing I/O: `p-limit` import, `DEFAULT_LIST_CONCURRENCY = 3`, `settleLimited` /
  `settledValues` helpers — directory scans run 3-at-a-time, results still reported in input order.
- rc.1 rejects a migration verifier that exits non-zero *after* reporting a result (rc.2 resolved
  regardless of exit code).
- No layout, naming, compression, or event-format changes. Plugins written against rc.2's on-disk
  format read rc.1 files unchanged.

## Fast-reader recipe (Recall)

1. Resolve the log: `<DSH_HOME>/sessions/<projectKey(cwd)>/<encodeSegment(id)>/session.v4.jsonl.zstd`.
2. Keep `(size, mtimeNs)` from a stat as your revision token; skip everything if unchanged.
3. `readFile` the whole file (they are small — test-home logs are KBs) or read from your last
   byte offset; `scanZstdFrames`-style parse the magic, then `zlib.zstdDecompressSync` each frame
   range, concatenating plaintext across frames before splitting lines.
4. First frame of the whole file is the header line; event lines are `{type, seq, time, data}`;
   index `user/message`, `assistant/message`, `tool/call`, `tool/result`, `request/header`,
   `session/title` for titles, and `model/selection` for the model.
5. Treat the file as append-only: never decode past `size`; a shorter size means a torn-tail
   repair happened — re-read fully.
