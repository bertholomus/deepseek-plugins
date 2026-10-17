TASK: The window-side (browser half) API a DSH plugin uses for pages, badges, row marks, turn cards and navigation.

Read how this repo's plugins do it first: ~/Projects/dsh-plugin-suite/plugins/calendar/lib/client.js (a page in main from a sidebar.panellist entry, a right-sidebar tab), plugins/coordinator/lib/client.js (conversation.chat.turnTail cards, sidebar.session.row.leading marks, conversation.session.header.actions, shell.overlay, how it opens a session), plugins/categories/lib/client.js. Then confirm in the DSH client packages (dsh-client-* in node_modules/@deepseek-ai) where these slots are rendered and what props each slot entry receives. Answer:
1. sidebar.panellist + page in main: the exact registration code pattern (slot names, keys, order, the page component and its props), and whether a panel-list entry can show a count badge (how DSH draws one, or what a plugin would draw itself).
2. conversation.chat.turnTail: props (session id, turn id, message ids, events?), and how a card finds the turn's assistant text and tool results.
3. sidebar.session.row.leading and any per-row trailing slot: props (session id, status...).
4. How a plugin opens a given session in the main view, and whether it can scroll to a given turn or event (router/navigation API, URL shape).
5. How the browser half calls its own host endpoints (typertGateway remote: bindTypertRemote, connection.rpc.call path shape) and how it learns about host-side changes (polling a version vs any push/subscribe channel).
6. DSH UI parts available from @deepseek-ai/dsh-client-ui-primitives that a page would use (Button, Switch, Menu, Modal, Toast, Tooltip, SettingsForm, StateDot, others) with their main props.

OUTPUT: write ~/Projects/dsh-plugin-suite/research/client-ui.md (at most 300 lines).
Finish with a summary of 20 lines or fewer: result, files changed, open issues. End your reply with a line `DONE: <one-line result>` or `BLOCKED: <reason>`.
