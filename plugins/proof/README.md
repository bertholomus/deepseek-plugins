# Proof

Claims need evidence. When a turn's reply says something is done, passing,
fixed or deployed, Proof reads what that turn ran (tool output, exit codes,
test counts, metric changes, file hashes) and judges each claim:

- **shown**: something in the turn shows it. Proof stays quiet.
- **no evidence**: nothing in the turn shows it ("all tests pass" when no
  test ran). A short card after the turn says so.
- **contradicted**: the turn's own output says otherwise ("pushed to main"
  when the push was rejected). The card quotes what the turn shows.

Every claim, quiet or flagged, goes into the session's **claims ledger**
(claim, evidence, verdict, check), which its page shows and exports as
Markdown, CSV or JSON. When you want a second opinion, the **independent
check** opens a short, fresh, read-only thread on a cheap local model that
re-runs or re-reads the evidence and answers VERIFIED or NOT VERIFIED, with
its reason.

Proof reads the claims inside DSH's own session log as each event is
committed, so it costs no model call, it never sends anything to the
session, and the card is there the moment the turn ends. It needs nothing
else running. With Session Watch running, its page updates through the
suite's one open request per window; without it, the page reads again every
few seconds.

## What counts as a claim

A claim is a plain statement of success in the turn's last reply, read
sentence by sentence and clause by clause ("Pushed to main, CI should pick
it up" claims the push, not the CI run). Questions, plans, conditions
("once the tests pass I'll merge"), failures ("3 tests still fail"),
negations, code blocks, `>` quotes and reports of what a document says
("the README says the build passes") are not claims, so they are never
flagged.

| Kind | Examples | Shown by | Contradicted by |
| --- | --- | --- | --- |
| **passed** | "all 42 tests pass", "the build is green", "lint is clean", "CI is green" | A run of that kind (tests, a build, lint, a CI read) whose last run passed, after the last change to code. A count in the claim must match the run's. | The last run of that kind failing, exiting non-zero or timing out; a count that does not match. |
| **deployed** | "deployed to staging", "pushed to main", "published 1.2.0", "the health endpoint returns 200" | A push, publish, release or deploy command that went through, to the place the claim names, or a request to that address that answered as claimed. | A rejected push, a failed publish, a rollout that timed out, a health check that answered otherwise afterwards. |
| **fixed** | "fixed the crash", "no longer panics", "p50 310 ms → 120 ms" | A change, then a run of the right kind that passed; for a figure, the turn printing it (or the two figures it follows from). | The run after the fix still failing; a benchmark that moved the wrong way. |
| **done** | "I added the endpoint", "renamed the files", "Done." after "add the flag" | A change to files (an edit, a write, a command that changes files) for a claim that says it changed something; for a finished run ("Backfill complete"), that run and its exit. | — |

What a claim names, the turn must show: a command in inline code
("`go test -race ./...` is clean"), a figure ("coverage is at 92%"), a
hash. A turn that ran nothing may lean on the turn before it, but only
when you asked for no new work in between: "all tests pass" after "thanks,
summarize" is shown by the test run one turn back; "renamed it" after
"now rename it" is not.

Proof reads DSH's own tool outputs: a shell command's stdout, `[stderr]`,
and the `[exit code: N]` / `[timed out after …ms]` markers DSH adds, and
other tools by their words ("exit=0", "12 passed"). It knows the summaries
of the common runners (node's test runner, jest, vitest, pytest, go test,
cargo test, mocha, rspec, phpunit, dotnet, gradle, xcodebuild, flutter,
mix, deno, bun, ctest and more), deploy tools (git push, npm publish,
docker push, kubectl, helm, fly, vercel, netlify, gcloud, aws, terraform,
ansible and more), database migrations and checksums.

## How well it reads

Measured on labelled corpora of coding-agent turns: real tool-output
formats and replies, each turn labelled by the person who wrote it as
honest (every claim shown), no claim, unbacked or contradicted. Each
hold-out was written by four writers who never saw Proof's rules or the
other corpora, and was measured once before any rule saw it.

| Corpus | Turns with evidence or no claim | Flagged anyway (false flags) | Turns with an unshown or wrong claim | Flagged (caught) | Wrong claims called contradicted |
|---|---|---|---|---|---|
| Dev (tuned on) | 95 | 0 (0.0%) | 74 | 74 (100.0%) | 32 of 32 |
| First hold-out, measured once before tuning | 60 | 12 (20.0%) | 50 | 43 (86.0%) | — |
| Second hold-out, measured once before tuning | 60 | 6 (10.0%) | 50 | 45 (90.0%) | 20 of 25 |
| Third hold-out, measured once before tuning | 60 | 7 (11.7%) | 50 | 41 (82.0%) | 19 of 25 |
| Fourth hold-out, measured once before tuning | 60 | 10 (16.7%) | 50 | 44 (88.0%) | 23 of 25 |
| Fifth hold-out, measured once before tuning | 60 | 6 (10.0%) | 50 | 41 (82.0%) | 19 of 25 |

Where the false flags fall, first recorded for the fifth hold-out:

| Corpus | Honest turns that claim something | Flagged | Called contradicted | Turns that claim nothing | Flagged |
|---|---|---|---|---|---|
| Fifth hold-out, measured once before tuning | 40 | 6 (15.0%) | 3 | 20 | 0 (0.0%) |

All five hold-outs were tuned on after that one measurement (the fixes
were general rules, never a case's own words) and are now part of the
tests, at 0% false flags and 100% caught, so none of them is a fair
figure any more. The fourth one's writers were asked for set kinds of
turns (claims shown earlier in the turn, summaries that lean on the turn
before, hashes, metrics and CI reads, subtle misses) and added hard ones
of their own (results only on stderr, a failed run fixed later in the
turn, success-looking output the reply never claims). The fifth met the
floors Proof promised then (at most 10% of quiet turns flagged, at least
80% of unshown or wrong claims caught), the first just, but every one of
its false flags fell on an honest turn that claims something: 6 of 40,
and 3 of them were called contradicted, which accuses an honest agent of
being wrong. An independent judge met the same shapes in live use (a fix
claim that names the fault, a question read as a request for new work, a
count of runs read as a test count). So the floors are now stricter and
split: at most 10% of quiet turns flagged, at most 10% of honest turns
that claim something flagged, at most one honest turn called
contradicted, and at least 80% caught. The sixth hold-out, written by
fresh writers who never saw the rules or the corpora, is measured once
against them with the rules frozen. To measure again:

```sh
node scripts/proof-corpus.mjs           # one row per corpus
node scripts/proof-corpus.mjs --misses  # and each case it got wrong
```

## On the turn

A turn with a flagged claim gets a card after its reply: **Proof ·
Nothing in this turn shows this**, **Proof · This turn's own output says
otherwise**, or, for several, **Proof · 3 claims this turn does not show
(1 contradicted)**. For each flagged claim it shows:

- the claim, quoted, and why it was flagged ("No test ran in this turn.",
  "The last push in this turn did not go through: … rejected …");
- for a contradiction, **What the turn shows**: the line of output that
  says otherwise;
- the independent check's state when there is one (*waiting to check*,
  *checking*, *verified*, *not verified*, *unclear*, *could not check*),
  with **Open the check**;
- **Check it** (or **Check again**) when the independent check is on;
- **Open in Proof**, which opens the page at that session.

A turn whose claims are all shown gets no card. A check thread's own first
turn gets a note instead: what it checks, from which turn of which session,
that nothing it runs can write a file, and **Open the checked session**.

## The page

Proof has its own entry in the sidebar. Its page shows:

- **The header**: how many sessions have claims and how many are flagged,
  whether flags are on, how the independent check runs, and **Settings**.
- **Sessions with claims**, newest first. Pick one to see its ledger.
  Opening the page from a flag picks that session.
- **Ledger**: the session's claims, **Flagged** or **All claims**. Each
  shows its turn, time and kind, the claim, why, what showed it or what
  says otherwise, **What the turn ran** (the commands and reads, folded),
  the check, and **Check** when the check is on. **Export**: Markdown, CSV
  or JSON downloads the whole ledger (quiet claims too); **Copy** puts the
  Markdown on the clipboard. CSV fields that a spreadsheet would read as a
  formula get a leading apostrophe.
- **Independent checks**: the latest checks over all sessions, each with
  the claim, its turn and session, whether you asked or it ran by itself,
  its state and reason, and **Open the check**. When the check is off, the
  card says so, with **Open Proof's settings**.
- **What happened**: checks asked for and their answers, exports and
  setting changes, newest first.

Every empty state says what to do next, and every refusal says why in
words ("The independent check is off. Turn it on in Proof's settings").

## The independent check

When the check is on, a flagged claim can be checked (**Check it** on the
card, **Check** in the ledger), or, with *By itself*, each new flagged
claim is checked as it is flagged (claims flagged before you chose *By
itself* are left for you). A check:

1. Opens an ordinary DSH session beside the checked one (in its workspace,
   or its folder), titled **Proof check · …**, so you can open it and read
   what it ran.
2. Makes it read-only before its first turn, with DSH's own controls:
   - the read-only file policy: nothing it runs can write a file, not even
     in `/tmp`;
   - approvals that never ask: an action that would need one is refused,
     so a check never waits on you;
   - its model is offered only tools that read or run (`read`, `grep`,
     `glob`, `bash`, `web_fetch` and the like), plus DSH's own `subagent`
     tool, which DSH adds to every thread and no plugin can take away;
   - a guard that refuses any other tool, `subagent` included, and any
     command that sends
     something elsewhere (a push, a publish, a deploy, a request that does
     more than read, a command on another machine) or changes the work (a
     commit, a reset, an install, a killed process, a container). The
     thread is told why, so it can check by reading instead.
3. Picks the model Proof's settings name for that thread only (by default
   GLM-5.3 Flash through the owner gateway). DSH's default model is never
   changed.
4. Asks it to re-run or re-read what would show the claim (the same
   command, the file, git, the hash, the address) and to end with a line
   that starts with VERIFIED or NOT VERIFIED and the reason.

The last such line is the verdict. A reply with neither is *unclear*; a
turn that ended in an error, or a check still running after its minutes
(it is stopped), is *could not check* or *unclear*, with the reason in
words. One check runs at a time, and at most `verifierPerHour` start in an
hour; the rest wait their turn ("Waits until 3:40 PM: 12 checks have
started in the last hour, the most Proof's settings allow"). Turning the
check off ends the ones still waiting as *could not check*.
After a restart, a check that was running is read from its thread: its
answer if it gave one, or it carries on until its minutes are up.

## Settings

Plugins → Proof shows the settings you can change while it runs, in DSH's
own settings form: change a value, then **Save**. They apply at once, and
What happened notes each save (*Settings changed: “Minutes a check may
take”*). **Use the default** clears one. The form will not save a value out
of range and says what fits instead.

| Setting | Default | Range | Where | What it does |
| --- | --- | --- | --- | --- |
| `flags` (Flag claims with no evidence on their turn) | `true` | on or off | Plugins | The card after a turn with a flagged claim. The ledger keeps every claim either way. |
| `verifier` (Independent check) | `ask` | `off`, `ask` (When I press Check) or `auto` (By itself) | Plugins | When a check runs. |
| `verifierProvider` (Check with the model from) | `owner-ascents` | a provider as DSH's model list names it | Plugins | Where the check model runs. |
| `verifierModel` (Check with the model) | `GLM-5.3-Flash-EXL3` | a model as DSH's model list names it | Plugins | The check model: a cheap local one. |
| `verifierMinutes` (Minutes a check may take) | `5` | 1 to 30 | Plugins | A check still running then is stopped, and its answer is unclear. |
| `verifierPerHour` (Checks an hour, at most) | `12` | 1 to 120 | Plugins | More wait their turn and start when the hour allows. |
| `enabled` | `true` | `true` or `false` | Profile | `false` keeps Proof loaded but idle: it reads no claims, and its page says so and how to change it. |

A wrong value never stops Proof from starting: it flags and checks
nothing, and its page says which setting is wrong, what it must be, and
**Open Proof's settings** puts the cursor in it. Once you fix it, Proof
works again at once.

## Files

In DSH's data folder (`$DSH_HOME`, else `~/.dsh`), folder mode 700, files
mode 600:

| File | What |
| --- | --- |
| `proof/checks.json` | The independent checks: which claim, which thread, state, verdict and reason (the last 400). |
| `proof/events.jsonl` | What happened: checks, exports, setting changes. It keeps the last 400 entries and rewrites itself past 1 MB. |

The claims themselves live in each session's own state in DSH (the
`proofClaims` projection, the last 60 claims a session made, the last 20
flagged on its list row), and the page folds a whole ledger from the
session's log when you open it, so nothing is lost when Proof is off.

## Setup

1. Install Proof as in the [root README](../../README.md#install-a-plugin):

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/proof
   ```

   That adds `dsh-plugin-proof` to the profile's `package.json`
   (`dependencies` and `dsh.profile.bundles`). Its bundle adds its row
   (`id: proof`).

2. To change a default before the first start, address the row in the
   profile's `cordis.patch.yml`:

   ```yaml
   - id: proof
     config:
       verifier: auto
       verifierPerHour: 6
   ```

3. Restart DSH Desktop once so it loads the new bundle.

The check model must be one DSH's model list offers. If it is not, a check
ends as *could not check*: "DSH has no model … to check with. Pick one DSH
lists in Proof's settings (“Check with the model”)".

## Switching it off

- **The cards only**: Plugins → Proof → *Flag claims with no evidence on
  their turn* off. The ledger and the page carry on.
- **The independent check**: *Independent check* → Off. Checks still
  waiting end as *could not check*; nothing else changes.
- **Entirely**: Plugins → Proof → off. Its sidebar entry, page and cards
  go, and it leaves no marks in other plugins' views. Nothing in your
  sessions changes. (`enabled: false` in the profile instead keeps its
  page, which says it is off and how to turn it back on.)

## Rollback

DSH runs Proof from its folder in your clone (the profile links it). To go
back to a release, restore that folder from the release's tag and restart
DSH Desktop:

```bash
git -C ~/.dsh-plugins/deepseek-plugins restore --source proof-v1.0.0 -- plugins/proof
```

To remove it, follow [Remove a plugin](../../README.md#remove-a-plugin) for
`dsh-plugin-proof` (row `proof`), and delete `proof/` in DSH's data folder
to forget its checks and log. Check threads it opened stay as ordinary
sessions; delete them in DSH if you like. It changes nothing else: it never
writes into a session it judges.

## Limits

- Proof reads one turn (and, for a turn that asked for no new work, the
  one before). A claim about work done earlier in the session, outside that
  window, is flagged as *no evidence*: the ledger shows where it was, and
  the independent check can confirm it.
- It reads what the tools printed, not the world: "deployed" is shown by a
  deploy that went through, not by the site being up a minute later. A
  health check in the turn covers that.
- Long outputs are kept by their head (4,000 characters) and tail (12,000),
  where runners print their summaries.

## Tests

From the repository root:

```sh
node --test test/proof*.test.js       # claims, evidence, the ledger, the check, the page, the browser half, the corpora
node scripts/e2e.mjs proof            # real DSH in a throwaway home, on every DSH build here
```

The real-DSH test (88 checks, about two minutes a build) starts DSH from
each `.e2e/dsh-<version>` install and from the installed app's own DSH,
each in a throwaway home, with Session Watch and Proof and a scripted model
(`test/e2e/fake-model.mjs`) that plays both the agent and the check model.
From real sessions it shows that a claim its turn's run shows stays quiet
(in a summary turn, the turn before shows it), that a claim with nothing
behind it is flagged, that one the run's own output denies is called
contradicted with the run's words, and that a reply that only asks makes
no claim. It asks for checks from the page and the endpoint: each runs in
a new "Proof check · …" thread on the check model alone, and DSH's own log
shows the read-only file policy and approvals that never ask before its
first message; its model is offered only tools that read or run (and DSH's
`subagent`), Proof's guard refuses the subagent and a commit, DSH's file
policy stops a write, the checked session gets nothing and DSH's default
model is unchanged. A slow check is stopped by DSH and settles as unclear,
a new flagged claim is checked by itself, a fifth check in the hour waits
and says until when, and switching checks off ends it. It restarts DSH in
the middle of a check (the check settles, with why), runs with Session
Watch off, starts with a wrong setting (named with its range, and fixed by
saving a good value), checks Proof's file modes and loads it with
`enabled: false`. It drives the page and Proof's settings in Plugins in a
browser, light and dark, wide and narrow: the header, the sessions, the
ledger and its filter, What the turn ran, the exports to Markdown, CSV,
JSON and the clipboard, and Proof switched off and on in Plugins, its
entry and flags gone and back. Pictures go to `.e2e/shots/proof/<build>/`.
