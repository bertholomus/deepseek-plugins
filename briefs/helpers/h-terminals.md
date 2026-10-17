TASK: How DSH 0.2.x terminals work, and why a plugin-made terminal does not show in the window's terminal panel.

Read dsh-terminal, dsh-terminal-bash, and the client UI package(s) that draw the session's Terminal panel/tabs (search the dsh-client-* packages for "terminal"). Also read the read-only reference ~/.dsh-plugins/minime-bridge/lib/index.js (it creates terminals through `ctx.terminalController`). Answer:
1. The terminalController service: every method (create, list, follow, write, retain, close, rename, others) with arguments and return shapes; frame types from follow (snapshot/output/state...); what "retain" does; the unattended reaper (timeout, what keeps a terminal alive); what happens to terminals on a DSH restart.
2. How the window lists and opens terminal tabs for a session: which remote method it calls, and the exact condition that makes a terminal created by a host plugin NOT appear as a tab (an owner/attachment field, a creator id, a client-side list, or something else). What a plugin must do so its terminal appears as a normal visible tab.
3. Whether a terminal can be created for a session that has no chat turn yet, and whether the window hides sessions with no chat turn from the sidebar (find that filter: package, file, line, the exact condition).
4. Differences between 0.2.0-rc.2 and 0.2.1-rc.1.

OUTPUT: write ~/Projects/dsh-plugin-suite/research/terminals.md (at most 250 lines).
Finish with a summary of 20 lines or fewer: result, files changed, open issues. End your reply with a line `DONE: <one-line result>` or `BLOCKED: <reason>`.
