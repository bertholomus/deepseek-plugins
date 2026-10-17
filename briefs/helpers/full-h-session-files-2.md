You are a reading helper for the DSH Plugin Suite builder. Workspace: ~/Projects/dsh-plugin-suite (a git worktree; do NOT commit, push, or switch branches).

Rules:
- Read only. The only file you write is the one output file named below. Do not edit any other file.
- Never start, stop or restart DSH, never touch ~/.dsh or ~/.dsh-plugins, never load anything into DSH.
- The DSH runtime packages to read are under ~/Projects/dsh-plugin-suite/.e2e/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/ (and the newer copy in .e2e/dsh-0.2.1-rc.1/ to note differences). Use grep/rg and read files; files can be large, so read slices.
- Cite every fact with a path relative to node_modules/@deepseek-ai and a line number (e.g. `dsh-terminal/lib/index.js:120`). Quote short code where it settles a question. If you could not confirm something, say "not found" rather than guessing.
- Plain words. Do not write any third-party AI assistant or vendor names in the output file (a repository test rejects them).
TASK: Where and how DSH 0.2.x stores sessions on disk, and how a plugin reads them fast (Recall builds a full-text index over them).

Read the session store packages (search node_modules/@deepseek-ai for "jsonl", "zstd", "zst", "session.v", "sessions" folder naming, "archive"). For layout only, list file and folder names (do not read contents, do not modify anything) under one DSH Test home: `ls ~/.dsh-test-*/` then the sessions folder of one of them. Answer, with citations:
1. The folder layout under DSH_HOME (sessions folder, how the workspace folder name is built from the cwd, the session folder or file name, any index, metadata or projection cache files, where archived sessions go).
2. The file format: compression (one zstd frame per append, or a whole-file frame; how DSH appends), line shapes (a header line, then event lines: field names for seq, type, time, data), which event types carry the user's text, the assistant's text, tool calls and tool results, the model and provider, the turn number, and the session title.
3. How DSH reads and writes zstd (library or node API, file and line). Whether `node:zlib` zstd works in the Node of both runtimes (`node -e "console.log(process.version, typeof require('zlib').zstdDecompressSync)"` run with the Node on PATH is fine).
4. What tells a reader that a session file changed since it was last read (mtime, size, a seq in a header, an append-only guarantee), so an index can read only the new part.
5. `sessionController.list()` items: every field (title, cwd or workspace, model, timestamps, archived, blank, running).
6. Differences between 0.2.0-rc.2 and 0.2.1-rc.1.

OUTPUT: write ~/Projects/dsh-plugin-suite/research/session-files.md (at most 200 lines).
Finish with a summary of 20 lines or fewer: result, files changed, open issues. End your reply with a line `DONE: <one-line result>` or `BLOCKED: <reason>`.
