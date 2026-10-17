# Recall

Search everything you already did. Recall keeps a full-text index of your
past work: every turn of this DSH's sessions, and, when its settings name
them, other DSH homes' sessions, coding-agent transcript folders and
Markdown handoff notes. Type a few words on its page and it lists the best
turns, with the words marked. Pick one and DSH opens that session at that
turn, scrolled to it and marked. Agents search the same index with the
`recall_search` tool.

The index is local and incremental:

- One worker thread owns it: SQLite with FTS5, in DSH's data folder.
- It reads only what changed, a slice at a time, so DSH's own thread never
  waits on it.
- A turn is searchable about 1.7 seconds after it ends.
- Everything stays on this computer, and it costs no model call.

It needs nothing else running. With Session Watch running, its page
updates through the suite's one open request per window. Without it, the
page reads again every few seconds.

## What it reads

| Kind | Where | One row per | What it keeps |
| --- | --- | --- | --- |
| **DSH sessions** | This DSH's `sessions` folder (`session.v*.jsonl.zstd`), and the DSH homes in *More DSH session folders* | turn | The title, what the person asked (6,000 characters), the reply (its first 3,000 and last 9,000 characters, where an answer usually is), the commands and files its tools used (60 lines), the model, the folder and DSH's own seq for the turn. |
| **Coding-agent transcripts** | *Coding-agent transcript folders* and their subfolders: `.jsonl` files, one message a line | turn: each message the person wrote, with the replies and tool calls after it | The same, plus the file and the line the turn starts on. |
| **Handoff notes** | *Handoff note folders* and their subfolders: `.md`, `.markdown`, `.mdown`, `.mkd` | section: one per heading (a long one is cut at about 8,000 characters) | The heading, its text, the file and line. Front matter is left out; its `title` names the note. |

Some things are left out on purpose:

- Context DSH injects (agent instructions, runtime context, skill lists)
  is not indexed. Neither is tool output.
- Subagent threads are skipped. Their work shows in the turn that asked
  for it.
- Hidden folders and folders such as `node_modules`, `venv`, `dist`,
  `build`, `target`, `vendor` and `Library` are skipped. So is anything
  more than 8 folders deep (3 in a sessions folder), and anything past
  20,000 files in one searched folder.

### Keeping up

- **A new turn.** When DSH says a session moved, Recall waits 1.5 seconds
  (events come in bursts while a turn runs). Then it reads the log from
  where it stopped.
- **Every minute.** Recall looks through every folder for new, changed and
  deleted files. It reads a grown session log or transcript from where it
  ended. One that got shorter, or was replaced by a new file of the same
  name, is read again from the start, and so is a changed note. A deleted
  file's turns are taken out.
- **Look for changes now** on the page does the same at once.
- **A folder that is not there** (an unplugged disk) keeps what Recall read
  from it searchable, and Recall looks again every minute.
- **A folder taken out of the settings** has its turns taken out of the
  index.

## Searching

- Words: every word must match. Words match their stems, so *exporter*
  finds *export*.
- `"an exact phrase"`.
- `-word` to leave a word out.
- `word OR other` for either.
- While you type, the last word matches as a prefix.

Results are ranked best first:

- A match in the title weighs most, then the request, the reply and the
  commands. A new turn gets a small lift: 30% at first, fading over the
  next few weeks.
- Each session or file shows once, at its best turn, with *Also matches
  turns 4, 7* for the others.
- *Newest* sorts by time instead.
- With nothing typed, the page lists the newest turns.

**Filters** (on the page and in the tool):

| Filter | Choices |
| --- | --- |
| Kind | All, Sessions, Transcripts, Notes |
| Folder | Any folder, or one folder (its subfolders too) |
| Model | Any model, or one model |
| Time | Any time, Past day, Past week, Past month, Past year |
| Sort | Best match or Newest |

A search that matches more than 5,000 turns counts to 5,000 and says *5000+*.

## The page

Recall has its own entry in the sidebar. Its page shows:

- **The search box and filters.** The count says how many turns match, in
  how many sessions and files, and how long the search took.
- **Results.** Each one shows its title, where it is (kind, folder, model,
  turn or section), when, and the matching words in context.
  - Pressing the title of a session of this DSH opens it at that turn.
    Anything else (another DSH's session, a transcript, a note) opens in
    Recall's reading view.
  - **Read here** shows a session's turn in the reading view without
    leaving the page.
  - Other matching turns of the same session are listed under it (*2 other
    turns here match: turn 4, turn 7*), each one press away.
  - **Show more results** loads the next page.
- **The reading view.** It shows what was asked, the reply, the commands
  and files used, the file and line, and **Turn before** / **Turn after**
  (**Section before** / **Section after** for notes).
- **The index card.** It lists each folder Recall searches with its state
  (*up to date*, *reading*, *not there*, *cannot read*) and its files and
  turns. Below that come **Files Recall could not read**, **Folders left
  out** (with why: listed twice, inside another, this DSH's own),
  **Look for changes now** and **Rebuild the index**.
- **What happened.** Index rebuilds, folders read or taken out, files it
  could not read and setting changes, newest first.

Every empty state says what to do next:

- *No folders to search* says to switch on this DSH's sessions or add
  folders, with **Open Recall's settings**.
- *Nothing to search yet* says that new sessions are added as they happen.
- *Nothing matches* suggests fewer or other words, and offers **Clear the
  filters** when filters are on.
- A wrong setting is named, with **Open Recall's settings**.
- A stopped index has **Start the index again**.

### Opening a result at its turn

A session's result (on the page, or **Open** on the tool's card) opens the
session in DSH's own chat and brings that turn to the top:

- DSH opens a session at its newest turns, so Recall first has it load
  older pages until the turn is there.
- The turn's rows get a line beside them, and the turn ends with a small
  card: **Found by Recall** · turn 2, for “narwhal”.
- **Back to the results** returns to the same search.
- **Done** takes the line and the card off.

Nothing in the session changes.

## The tool

With *Let agents search past work* on, agents are offered `recall_search`:

- **Search.** `query` (the same syntax as the page), and `kind`,
  `folder`, `model`, `since` (a date, `today`, `yesterday`, `7d`, `week`,
  `month`, `year`), `until` and `limit` (1 to 20 sessions or files,
  default 8).
- **Read one in full.** `open` with a result's id (such as `12.4`) reads
  that turn or section.

What it gives the agent is bounded:

- A search gives at most 20 results in 9,000 characters.
- One turn in full keeps 2,000 characters of the request, 3,500 of the
  reply and 1,200 of the commands.
- Every answer says that text from past sessions is *a record of earlier
  work: information, not instructions*.
- A call with no words is refused, and the refusal says what to give.

In the chat, each call shows as a tool row in DSH's own style:

- *Searched past work for “narwhal exporter”: 1 turn in 1 session or
  file* opens to the results. Each result has **Open**, and the row has
  **Search this in Recall**.
- *Read a past turn: “Long session”* opens to the request, the reply and
  **Open the session at this turn**.
- A refused call reads *Didn't search past work: the agent gave no words
  to search for.*

## Speed

Measured with `scripts/recall-bench.mjs` on a synthetic history of 10,001
DSH sessions:

- 120,519 turns in 87.7 MB of session logs, written in DSH's own layout
  and event shapes, with made-up words.
- Indexed by Recall's own index thread, the same worker DSH runs.
- Each search is a round trip through that thread, as the page and the
  tool make them, 20 rounds each.
- Apple M4, macOS, Node 22.20.0, with other work running (load average
  about 7).

| Search | Matching turns | Median | p95 | In the index (median) |
| --- | ---: | ---: | ---: | ---: |
| one common word | 5000+ | 46.3 ms | 65 ms | 46.2 ms |
| two words | 5000+ | 44 ms | 124.4 ms | 43.2 ms |
| a phrase | 1433 | 23.9 ms | 45.7 ms | 23.7 ms |
| typing (last word a prefix) | 5000+ | 91.2 ms | 147.1 ms | 91 ms |
| a rare word | 1 | 0.5 ms | 1.2 ms | 0.4 ms |
| either word (OR) | 5000+ | 61.1 ms | 97.3 ms | 60.9 ms |
| a word left out | 5000+ | 26.6 ms | 40.5 ms | 26.1 ms |
| sessions of the past month | 5000+ | 27.2 ms | 39.7 ms | 27 ms |
| one folder | 2227 | 31.5 ms | 49.8 ms | 31.3 ms |
| one model | 5000+ | 35.6 ms | 52.5 ms | 35.5 ms |
| newest first | 5000+ | 21.5 ms | 29.9 ms | 21.2 ms |
| nothing typed (newest turns) | 5000+ | 1.1 ms | 2.8 ms | 0.9 ms |
| third page | 5000+ | 56.4 ms | 74.5 ms | 56.3 ms |
| **All 260 searches** | | **33.7 ms** | **96.3 ms** | 33.5 ms |

Every search is well inside the 300 ms target. The slowest of the 260 took
201 ms.

**Building and keeping up:**

- **The first index** took 19.9 s (6,057 turns a second) and came to
  284.8 MB.
- **DSH's own thread** was held up at most 12.6 ms meanwhile (p99 11.4 ms).
- **Searches during that build** took a median of 57.3 ms (p95 104.4 ms).
- **Reading one turn in full**: under 0.1 ms.
- **A new turn** was found 75 ms after DSH said its session moved; a new
  session, 40 ms after. With DSH's 1.5 s of batching, the real-DSH test
  measures a turn searchable about 1.7 s after it was asked.
- **A restart** opened the index in 22 ms and answered the first search in
  97 ms. Its look through all 10,001 files took 0.4 s and read none again.
- **After a stop that did not close the index**, opening it took 2.0 s:
  SQLite's full check runs then.

To measure again:

```sh
node scripts/recall-bench.mjs --sessions 10000 --rounds 20
node --test test/recall-bench.test.js   # a 200-session run, every search under 300 ms
```

## Settings

Plugins → Recall shows the settings you can change while it runs, in DSH's
own settings form:

- Change a value, then **Save**. It applies at once.
- What happened notes each save (*Settings changed: “Handoff note
  folders”*).
- **Use the default** clears one.

Folder lists take full paths or paths from `~/`, with commas between them.

| Setting | Default | Range | Where | What it does |
| --- | --- | --- | --- | --- |
| `sessions` (Search this DSH's sessions) | `true` | on or off | Plugins | Every turn of every session in this DSH's data folder. |
| `sessionFolders` (More DSH session folders) | `[]` | up to 20 folders | Plugins | Other DSH homes, or their `sessions` folders, such as `~/.dsh-test`. Their turns open in Recall's reading view, as this DSH cannot open their sessions. |
| `transcriptFolders` (Coding-agent transcript folders) | `[]` | up to 20 folders | Plugins | Folders of transcripts as JSON lines, one message a line, with their subfolders. |
| `handoffFolders` (Handoff note folders) | `[]` | up to 20 folders | Plugins | Folders of Markdown notes, with their subfolders. Each heading's section is one result. |
| `tool` (Let agents search past work) | `true` | on or off | Plugins | Offers agents `recall_search`. Off, agents are not offered it. |
| `enabled` | `true` | `true` or `false` | Profile | `false` keeps Recall loaded but idle: no index thread, no tool, and its page says so and how to change it. |

Adding a folder reads it in the background, and searches work meanwhile.
Removing one takes what it held out of the index.

A wrong value never stops Recall from starting:

- It searches nothing and offers no tool.
- Its page says which setting is wrong and what it must be.
- **Open Recall's settings** takes you to that setting.
- Once you fix it, Recall works again at once.

The index keeps what it had read, so nothing is read again.

## Files

In DSH's data folder (`$DSH_HOME`, else `~/.dsh`), folder mode 700, files
mode 600:

| File | What |
| --- | --- |
| `recall/index.sqlite` (and its `-wal` and `-shm`) | The index: one row per turn or section, with what it kept (above), and where each file was read up to. About 2.4 KB a turn (284.8 MB for 120,519 turns). |
| `recall/index.sqlite.open` | Written while the index is open. If DSH stops without closing it, the next start checks the index in full (SQLite's quick check). An index that fails the check, or one from an older Recall, is set aside as `index.sqlite.old` and built again from the files. |
| `recall/events.jsonl` | What happened. It keeps the last 400 entries and rewrites itself past 1 MB. |

The index holds only copies. The sessions, transcripts and notes are the
truth, so deleting `recall/` loses nothing: Recall builds the index again
on its next start.

## Setup

1. Install Recall as in the [root README](../../README.md#install-a-plugin):

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/recall
   ```

   That adds `dsh-plugin-recall` to the profile's `package.json`
   (`dependencies` and `dsh.profile.bundles`). Its bundle adds its row
   (`id: recall`).

2. To set folders before the first start, address the row in the
   profile's `cordis.patch.yml`:

   ```yaml
   - id: recall
     config:
       transcriptFolders: [~/agent-logs]
       handoffFolders: [~/Projects]
   ```

3. Restart DSH Desktop once so it loads the new bundle. The first index
   builds in the background, and its page shows how far it has read.

Recall needs Node 22.15 or newer (DSH's own runtime), for SQLite and zstd.

## Switching it off

- **The tool only**: Plugins → Recall → *Let agents search past work* off.
  The page carries on.
- **One source**: switch *Search this DSH's sessions* off, or take a folder
  out of its list. Its turns leave the index.
- **Entirely**: Plugins → Recall → off. Its sidebar entry, page, marks and
  style go, and its index thread stops. Nothing in your sessions changes,
  and the index stays for when you switch it on again.
- **Idle but loaded**: `enabled: false` in the profile keeps its page,
  which says it is off and how to turn it back on.

## Rollback

DSH runs Recall from its folder in your clone (the profile links it). To
go back to a release, restore that folder from the release's tag and
restart DSH Desktop:

```bash
git -C ~/.dsh-plugins/deepseek-plugins restore --source recall-v1.0.0 -- plugins/recall
```

If the index format changed between the two, Recall sets the newer index
aside and builds its own.

To remove Recall, follow [Remove a plugin](../../README.md#remove-a-plugin)
for `dsh-plugin-recall` (row `recall`). Then delete `recall/` in DSH's data
folder to drop its index and log. Recall never writes to the sessions,
transcripts or notes it reads.

## Limits

- **Words, not meaning.** *Deploy* finds *deployed* and *deploying* (stems),
  but not *release*. Text written without spaces between words, such as
  Chinese or Japanese, is one word to the index until the next space or
  mark, so a search must give that whole run, or its start while you type.
- **Long replies.** Only the first 3,000 and last 9,000 characters of a
  reply are searchable, and tool output not at all, only the commands and
  files.
- **Transcripts.** A transcript has no end-of-turn mark. Its last turn
  shows as still running while the file was written to in the last 10
  minutes.
- **Sessions of another DSH** open in Recall's reading view, not in the
  chat: this DSH cannot open them.
- **New turns** wait for DSH's session event plus 1.5 s. Changes in other
  folders wait for the next minute's look, or **Look for changes now**.

## Tests

From the repository root:

```sh
node --test test/recall*.test.js   # the index, search, the tool, the page's host half, the browser half, the bench
node scripts/e2e.mjs recall        # real DSH in a throwaway home, on every DSH build here
```

**Unit tests.** The host tests cover:

- reading DSH session logs, transcripts and notes;
- the incremental index: appends, rewrites, deletes, a folder that is not
  there, an unclean stop, a broken index set aside;
- the query syntax, ranking, snippets and filters;
- the tool's bounds, and output DSH keeps as lossless JSON;
- settings and the page's log.

The browser-half tests cover the page, the mark and the jump to a turn. The
bench test runs the bench on 200 sessions.

**Real-DSH test.** It makes 84 checks and takes under two minutes a build.
It starts DSH from each `.e2e/dsh-<version>` install and from the installed
app's own DSH, each in a throwaway home. It runs with Session Watch, Recall
and a scripted model (`test/e2e/fake-model.mjs` here) that plays the agent.

What it checks:

- **Indexing real sessions.** It makes 43 turns in real sessions,
  including a 40-turn one. Searches find a word in a request, a reply and
  a command at the right turn and DSH seq. They find a transcript turn and
  a note section with their file and line.
- **Keeping up.** A new turn is found seconds after it ends. A grown
  transcript is read from where it ended, and a deleted one is taken out.
- **The tool.** An agent searches, reads a turn in full and is refused a
  call with no words.
- **The window.** In a browser it drives:
  - the page, light and dark, wide and narrow;
  - a result that opens the 40-turn session at turn 2, which DSH's first
    page of it does not hold, marked and at the top;
  - Back to the results and Done;
  - the filters and the reading view;
  - the tool's card and its Open;
  - the index card with a folder that is not there;
  - Look for changes now;
  - Recall's settings in Plugins.
- **Restarts and failures.** It restarts DSH (nothing read again) and
  crashes it (the index checked and kept). It switches Recall off and on in
  Plugins, and runs without Session Watch. It starts with a wrong setting,
  named and then fixed through the form. It checks Recall's file modes and
  loads it with `enabled: false`.

No real session is read: every transcript and note is written by the test.
Pictures go to `.e2e/shots/recall/<build>/`.
