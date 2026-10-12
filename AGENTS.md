# Design rules

Anyone who builds or changes a DSH plugin, or a mod that changes how DSH looks, follows [DESIGN.md](DESIGN.md). That includes a chat running inside DSH. It says how a plugin's window fits DSH and keeps the Wallpaper plugin's glass whole.

# Who these rules are for

The handoff rules below are only for the two accounts that build these plugins (A and B in `HANDOFF.md`), each working in its own checkout of this repository.

**If you run inside DSH** (your instructions say you are powered by DeepSeek Harness), as a chat that coordinates threads, one of its threads, or any other DSH chat whose folder is this repository, **skip the rest of this file**. Don't pull, don't read or act on `HANDOFF.md`, and don't commit or push unless the user asks you to. Its "Doing now" and "Next steps" are the builders' to-do list, not your task: do what the user, the chat that started you or your brief asks.

# Two-account handoff rules

Two accounts work on this repo. Either one can run out of usage at any time.
The repo is the only shared memory. Chat history is NOT shared.

## At the start of every session
1. Pull the latest from GitHub.
2. Read `HANDOFF.md` in full before you do anything else.
3. Continue from "Next steps". Do not redo work listed under "Done".

## During work
1. Work on the branch named in `HANDOFF.md`. Never push to the same branch from both accounts at once.
2. After each meaningful step, update `HANDOFF.md`, then commit and push.
3. Keep commits small. Write clear commit messages.
4. Never leave important state only in the chat. If it matters, it goes in `HANDOFF.md`.

## HANDOFF.md must always hold
- Updated: date/time (Pacific) and which account (A = personal, B = bertholomus)
- Branch
- Doing now
- Done since last handoff
- Next steps, in order
- Open questions / blockers
- Gotchas: things that broke, decisions made and why
