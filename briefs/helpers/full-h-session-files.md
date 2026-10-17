You are a reading helper for the DSH Plugin Suite builder. Workspace: ~/Projects/dsh-plugin-suite (a git worktree; do NOT commit, push, or switch branches).

Rules:
- Read only. The only file you write is the one output file named below. Do not edit any other file.
- Never start, stop or restart DSH, never touch ~/.dsh or ~/.dsh-plugins, never load anything into DSH.
- The DSH runtime packages to read are under ~/Projects/dsh-plugin-suite/.e2e/dsh-0.2.0-rc.2/node_modules/@deepseek-ai/ (and the newer copy in .e2e/dsh-0.2.1-rc.1/ to note differences). Use grep/rg and read files; files can be large, so read slices.
- Cite every fact with a path relative to node_modules/@deepseek-ai and a line number (e.g. `dsh-terminal/lib/index.js:120`). Quote short code where it settles a question. If you could not confirm something, say "not found" rather than guessing.
- Plain words. Do not write any third-party AI assistant or vendor names in the output file (a repository test rejects them).
TASK: Where and how DSH 0.2.x stores sessions on disk, and how to read them fast from a plugin.

Read the session store packages (search node_modules/@deepseek-ai for "jsonl", "zstd", "session.v4", "sessions" folder naming). Also look at a real DSH Test home for layout only (list names, do not modify): ~/.dsh-test/sessions (it may be small or empty). Answer:
1. The folder layout under DSH_HOME/sessions (how the workspace folder name/slug is built from the cwd; session folder name; file names; any index or metadata file).
2. The file format: compression (zstd frames? one frame per append?), line shapes (header/meta line, event lines with seq/type/time/data), and which event types carry the user's text, the assistant's text, tool calls and tool results, and the model.
3. How DSH reads and writes zstd (which library or node API, file and line). Whether `node:zlib` has zstd in the Node that runs inside the app: find the Electron version in /Applications/DeepSeek Harness.app/Contents/Info.plist or Frameworks and say which Node version it bundles.
4. sessionController.list(): the fields of each item (title, cwd/workspace, model, timestamps, archived...).
5. Differences between 0.2.0-rc.2 and 0.2.1-rc.1.

OUTPUT: write ~/Projects/dsh-plugin-suite/research/session-files.md (at most 200 lines).
Finish with a summary of 20 lines or fewer: result, files changed, open issues. End your reply with a line `DONE: <one-line result>` or `BLOCKED: <reason>`.
