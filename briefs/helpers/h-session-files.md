TASK: Where and how DSH 0.2.x stores sessions on disk, and how to read them fast from a plugin.

Read the session store packages (search node_modules/@deepseek-ai for "jsonl", "zstd", "session.v4", "sessions" folder naming). Also look at a real DSH Test home for layout only (list names, do not modify): ~/.dsh-test/sessions (it may be small or empty). Answer:
1. The folder layout under DSH_HOME/sessions (how the workspace folder name/slug is built from the cwd; session folder name; file names; any index or metadata file).
2. The file format: compression (zstd frames? one frame per append?), line shapes (header/meta line, event lines with seq/type/time/data), and which event types carry the user's text, the assistant's text, tool calls and tool results, and the model.
3. How DSH reads and writes zstd (which library or node API, file and line). Whether `node:zlib` has zstd in the Node that runs inside the app: find the Electron version in /Applications/DeepSeek Harness.app/Contents/Info.plist or Frameworks and say which Node version it bundles.
4. sessionController.list(): the fields of each item (title, cwd/workspace, model, timestamps, archived...).
5. Differences between 0.2.0-rc.2 and 0.2.1-rc.1.

OUTPUT: write ~/Projects/dsh-plugin-suite/research/session-files.md (at most 200 lines).
Finish with a summary of 20 lines or fewer: result, files changed, open issues. End your reply with a line `DONE: <one-line result>` or `BLOCKED: <reason>`.
