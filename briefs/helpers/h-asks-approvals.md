TASK: How DSH 0.2.x asks the human: the question-box tool and permission prompts.

Read dsh-tool-ask-user, and find how permission prompts work (search for "pre-execute", "approval", "permission", "ask", "allow once", "RiskConfirmation", "pending" across dsh-* packages, including the session controller and the web/client UI packages). Answer:
1. Question box: the tool name and input shape; what the session records while it waits (events, agent status); how the window shows it and how the window's answer gets back to the agent (remote method / service / event, exact names and arguments); can a host plugin list pending questions and answer one? How?
2. Permission prompts: when a `tools/pre-execute` listener returns `{kind: 'ask', ...}`, what object is created, where it is stored, what events/status the session shows (e.g. an agent status like waiting for approval), and how the window's Allow/Deny answer reaches the host (exact remote method names and arguments). Can a host plugin list pending prompts across sessions, and answer one? How?
3. How a plugin can learn, by event, that a question or a prompt appeared or was answered (event names on the cordis context such as ctx.on('...')).
4. Differences between 0.2.0-rc.2 and 0.2.1-rc.1.

OUTPUT: write ~/Projects/dsh-plugin-suite/research/asks-approvals.md (at most 250 lines).
Finish with a summary of 20 lines or fewer: result, files changed, open issues. End your reply with a line `DONE: <one-line result>` or `BLOCKED: <reason>`.
