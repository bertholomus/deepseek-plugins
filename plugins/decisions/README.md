# Decisions

One inbox for everything waiting on you. When a session needs you (a
decision line at the end of a reply, a tool waiting for approval, a
question in DSH's question box, a thread that handed back needing a
decision, a plugin's question), it shows here as a card: what is asked,
what the agent recommends, which session (one click opens it) and how long
it has waited. Answer on the card and the answer goes into the session: it
steers a running turn, starts the next turn of an idle one, or settles the
approval or question DSH is holding. The session's own log proves it
arrived, and the card says so, or says why not.

It needs Session Watch (it reads every session through it). While Session
Watch is off, Decisions stays on but lists and holds nothing (DSH's own
cards work as always), and its page says so; switching Session Watch off in
Plugins reports no error, and Decisions comes back by itself once Session
Watch runs again. With the notifications plugin running, each new card
also notifies you outside the window.

## What it lists

| Card | Where it comes from | Answer it with | Proven by |
| --- | --- | --- | --- |
| **Needs a decision** | A reply with a `DECISION NEEDED: <question> — recommend: <your pick>` marker (see below) | Your own words, or **Go with the recommendation** | The answer read into a turn of that session |
| **Blocked** | A reply with a `BLOCKED: <what is needed>` marker | Your own words | As above |
| **Asked you** | A reply that ends by asking you something (`replies`) | Your own words | As above |
| **Waiting for approval** | A tool that asks to run with more access (`approvals`) | **Allow once** or **Reject** | The tool's call in the session's log: it ran, or it was rejected |
| **Asks you** (question box) | A question the agent asks in DSH's question box (`questions`) | Its choices, and your own words where it allows them | The tool's result in the session's log |
| **Needs a decision** (thread) | A coordinator's thread that handed back needing a decision, or blocked (`threads`) | Your own words, sent to the thread | As for replies |
| **Asks you** (a plugin) | A suite plugin's question, such as Autopilot's Ask first | The plugin's own choices | The plugin carries it out and logs it on its own page |

A running turn's cards come first (a tool or a question holds it), then the
oldest. A card's wait counts from when Decisions first saw it: a restart,
or a plugin raising the same question again, does not start it over.

One decision makes one card. A thread's handback, the thread's own last
reply, and the coordinating chat's reply to that handback (the chat relays
it to you) are one card, the thread's; a recommendation in any of them
shows under *Recommended*, with **Go with the recommendation**. A reply
that only offers more ("Let me know if you'd like me to update the docs")
asks nothing, so it is not listed. A subagent's replies are left out: the
session that started it reads them. A reply's question leaves the list
after `windowHours`; the session still has it.

**How a marker is read.** A `DECISION NEEDED:` or `BLOCKED:` marker counts
at the start of any line of a reply, after a quote mark, a bullet, a list
number or a heading mark (bold and code marks are dropped first). In the
reply's last six lines it also counts right after the end of a sentence:
"…so I cannot go on without valid credentials. BLOCKED: working staging
credentials." A marker inside a sentence ("the request was BLOCKED: by
policy") is not one. `DECISION NEEDED` is read in any case, `BLOCKED` only
in capitals; with both, the decision wins. The recommendation follows the
question after a dash (`— recommend: …`), in a sentence of its own
(`Recommend: …`, `I'd recommend …`, `My recommendation: …`), or on the
next line (`Recommend: …`). A reply without a marker that ends by asking
you something shows its last question, or else its last line that asks for
your word.

**How answers reach the session.** Words go in as the session's next
message, starting `[Decisions] The person answered …` and quoting the
question; a running turn reads them at its next step. Allow once and Reject
go to DSH as its own approval card's answer would, and so does an answer to
a question in the question box. A question whose wait ran out (a profile
that runs the question box in its timed mode) still takes a late answer,
through DSH's question service. A plugin's question goes back to the
plugin.

**Holding DSH's own requests.** For approvals and the question box,
Decisions sits first in DSH's chain for that request: it makes the card and
passes the request on at once, so DSH's own card shows in the session as
always. Answer in either place; the first answer wins, and the other card
goes. Decisions never answers on anyone's behalf: when no window answers
and the turn stops, DSH's own outcome stands. A kind switched off, a wrong
setting or any failure passes the request on untouched. A tool that asked
before Decisions started can only be answered in the session; its card
says so and opens it.

## The page

**Decisions** in DSH's sidebar, with a count of what waits on you:

- **The header**: what waits and what Decisions lists, whether it notifies
  you, and where else new cards go (with **Send a test**, or what is
  missing and a button to its settings).
- **Waiting on you**: each card with its state word (*needs a decision*,
  *blocked*, *waiting for approval*, *asks you*, *asked you*), the session
  (one click opens it), how long it has waited, the question, the
  recommendation, and the controls its kind takes. **Dismiss** hides a card
  without answering it: a session that still waits still waits in the
  session. A failed answer stays on its card with the reason, and the card
  takes the focus.
- **Dismissed**, with **Bring back**.
- **What happened**, newest first: new cards; your answers and whether the
  session got them (*in the queue*, *delivered*, *answered*, *not
  delivered* with the reason); each notification (*shown*, and where, or
  *not shown* and why, said once an hour while the reason stays the same);
  each note sent elsewhere (*Sent to* the host or program, or *Not sent to*
  it, with its answer); what became of a request Decisions was holding
  when it was answered in the session, or when a restart or a stop ended
  its turn first (*The turn stopped before anyone answered*); and each
  change of its settings.

When nothing waits, the page says what would show there. When Decisions
cannot work, the page says why and what to do, with a button to the place
to do it: *Decisions needs Session Watch, which is not running*, *Decisions
is not running*, or *Decisions is waiting for a setting to be fixed* (which
setting, what it must be, and where to change it). It comes back by itself
once the cause is gone.

## Settings

Plugins → Decisions shows the settings you can change while it runs, in
DSH's own settings form: change them, then **Save**. They apply at once,
and *What happened* notes each save. A kind switched off leaves the list,
and the requests Decisions was holding for it go back to DSH's own card
alone. The form will not save a value out of range and says what fits; a
value saved in the profile that does not fit is flagged as soon as the form
opens, and **Open Decisions' settings** on its page puts the cursor in it.

| Setting | Default | Range | Where | What it does |
| --- | --- | --- | --- | --- |
| `approvals` (Tools waiting for approval) | on | on or off | Plugins | List tools that ask to run with more access, with Allow once and Reject. |
| `questions` (Questions in the question box) | on | on or off | Plugins | List the agent's questions in DSH's question box, with their choices. |
| `replies` (Replies that end with a question) | on | on or off | Plugins | List a reply that ends by asking you something. Replies with a `DECISION NEEDED` or `BLOCKED` marker are listed whatever this says. |
| `threads` (Threads that need a decision) | on | on or off | Plugins | List a coordinator's thread that handed back needing a decision, or blocked. |
| `windowHours` (Keep a reply's question for) | `72` | 1 to 720 hours | Plugins | An older reply's question leaves the list. |
| `notify` (A notification for each new card) | on | on or off | Plugins | Through DSH's notifications, while that plugin runs. A plugin's own questions notify through that plugin. |
| `mirror` (Also send new cards to) | `off` | `off`, `webhook` or `command` | Plugins | A short note for each new card, sent elsewhere (see below). |
| Webhook address | none | `https://…`, or `http://` to this machine | Plugins | Kept in DSH's key store, never in the settings file. |
| `mirrorPerHour` (Messages sent an hour, at most) | `30` | 1 to 500 | Plugins | Counts the notes that went (not failures), across restarts. Past it, Decisions holds back and says so once; it still lists everything. |
| `mirrorUrlEnv` | `DECISIONS_WEBHOOK_URL` | a key name | Profile | The key in DSH's key store (or the environment DSH starts in) that holds the webhook address. |
| `mirrorCommand` | none | the program's full path, then its arguments | Profile | The command `command` runs. |
| `enabled` | `true` | `true` or `false` | Profile | `false` keeps Decisions loaded but idle: it lists and holds nothing, and its page says so and how to change it. |

*Profile* settings go in the `decisions` row of the profile's
`cordis.patch.yml` (see Setup) and apply after a restart. A wrong value
there never stops Decisions from starting: it lists and holds nothing, and
its page says which setting is wrong, what it must be, and where to change
it.

### Sending new cards elsewhere

Off by default. Each new card can also go, as a short note (what waits and
where, the question, the recommendation, and "Answer it in DSH:
Decisions."), to:

- **A webhook**: a POST of `{"content": "…"}`, the shape a Discord channel
  webhook takes, with mentions switched off so an agent's text can never
  ping anyone. The address must be `https://` (or `http://` to this
  machine, for a local sink). Enter it in the **Webhook address** field in
  Plugins → Decisions: it goes to DSH's key store under `mirrorUrlEnv`, is
  read again for each message, and is never written to the settings file
  or a log. A webhook address set in the environment DSH starts in works
  too, and the field says so.
- **A command**: `mirrorCommand` in the profile, the program's full path
  then its arguments, run without a shell, with the card as one line of
  JSON on its input (`text`, `kind`, `title`, `question`, `recommendation`,
  `sessionId`). It has 15 seconds.

```yaml
- id: decisions
  config:
    mirror: command
    mirrorCommand: [/usr/local/bin/notify-me, --from, dsh]
```

Every send and every failure goes in *What happened*, naming the host or
the program, never the address. **Send a test** on the page sends one now.
When nothing can be sent (no address yet, a program that is not there),
that is said once an hour, or when the reason changes, not for every card.

## Files

In DSH's data folder (`$DSH_HOME`, else `~/.dsh`), folder mode 700, files
mode 600:

| File | What |
| --- | --- |
| `decisions/state.json` | The cards already announced and when each was first seen (so a restart notifies nothing twice and keeps each wait), what you dismissed and answered, the requests it is holding (so after a restart it can say what became of them), and when the last hour's notes went elsewhere. |
| `decisions/events.jsonl` | *What happened*; it keeps the last 400 entries and rewrites itself past 1 MB. |

On the first start, what already waits is listed but not announced.

## Setup

1. Install Session Watch and Decisions as in the
   [root README](../../README.md#install-a-plugin):

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/session-watch
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/decisions
   ```

   That adds `dsh-plugin-session-watch` and `dsh-plugin-decisions` to the
   profile's `package.json` (`dependencies` and `dsh.profile.bundles`).
   Their bundles add their rows (`id: session-watch`, `id: decisions`).

2. To change a default before the first start, address the row in the
   profile's `cordis.patch.yml` (the ones marked Plugins above can also be
   changed later in Plugins → Decisions):

   ```yaml
   - id: decisions
     config:
       replies: false
       windowHours: 24
   ```

3. Restart DSH Desktop once so it loads the new bundles.

Agents write decision lines on their own when their instructions ask for
it, for example: "If you stop for anything a person must decide, end with
one line: `DECISION NEEDED: <question> — recommend: <your pick>`."
Autopilot's notes ask for the same line.

## Switching it off

- **One kind of card**: its switch in Plugins → Decisions. Its held
  requests go back to DSH's own card alone.
- **Entirely**: Plugins → Decisions → off. Its sidebar entry and page go,
  every held request goes back to DSH's own card, and it leaves no marks in
  other plugins' views. (`enabled: false` in the profile instead keeps its
  page, which says it is off and how to turn it back on, and refuses its
  actions in words.)
- **With Session Watch**: Plugins → Session Watch → off also stops
  Decisions, with no error from DSH: Decisions stays on in Plugins, its
  page says it needs Session Watch, and it starts again by itself when
  Session Watch does.

## Rollback

DSH runs Decisions from its folder in your clone (the profile links it). To
go back to a release, restore that folder from the release's tag and
restart DSH Desktop:

```bash
git -C ~/.dsh-plugins/deepseek-plugins restore --source decisions-v1.0.0 -- plugins/decisions
```

To remove it, follow [Remove a plugin](../../README.md#remove-a-plugin) for
`dsh-plugin-decisions` (row `decisions`), and delete `decisions/` in DSH's
data folder to forget what it announced and its log. To forget the webhook
address too, press **Remove the address** in Plugins → Decisions first, or
remove the key `DECISIONS_WEBHOOK_URL` in DSH's key store. Nothing else
needs undoing: the answers it sent stay in their sessions' logs.

## Tests

From the repository root:

```sh
node --test test/decisions.test.js test/decisions-client.test.js   # the card rules, holds, inbox and mirror over a stand-in DSH; the page
node scripts/e2e.mjs decisions                                     # real DSH in a throwaway home, on every DSH build here
```

The real-DSH test starts DSH from each `.e2e/dsh-<version>` install and
from the installed app's own DSH, each in a throwaway home, with Session
Watch, Autopilot and Decisions, a scripted model playing the agent, and a
stand-in window that gets DSH's own prompts. From real sessions it makes
decision, BLOCKED and question cards (markers at a line's start and inline
after a sentence), approvals, a question-box question and Autopilot's Ask
first, and answers each from Decisions: words and the recommendation read
into a turn, Allow once (the file is written) and Reject (it is not), an
approval answered in the window instead, a question-box answer as the
tool's result, and Autopilot's Ask first carried out by Autopilot. Thread
cards (a coordinator's handback, folded with the chat's relay) and
notifications are covered by the unit tests over a stand-in DSH. It drives the page and its settings in Plugins in a
browser, light and dark, wide and narrow: a kind switched off, the webhook
address kept in DSH's key store and never in a log, a test message and new
cards sent to a stand-in webhook on this machine, a failing webhook said as
a failure, and a command instead. It restarts DSH with an approval waiting
(nothing repeats, and the log says the turn stopped before anyone
answered), sets a wrong value and fixes it in the form, switches Session Watch off and on in
Plugins and in the profile, and checks `enabled: false` and the file
modes. It reads the running DSH's fingerprint before and after and fails if
it moved; pictures go to `.e2e/shots/decisions/<version>/`.
