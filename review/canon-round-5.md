# Canon: judge round 5

Commit f31de80 (branch `goal95/canon`), judged Mon 2026-10-26, 8:44 PM to 11:55 PM PDT (the account's usage limit stopped me from 9:01 PM to 11:37 PM). DSH Test instance g95-canon-j3 (installed app, DSH 0.2.1-rc.3), with Session Watch and Canon loaded from my own extracted head. The session asked for GLM-5.3-Flash-EXL3 (high effort).

**Environment fact (not scored):** the owner gateway answered my one completed real-model turn with DeepSeek-V4.1-Flash-1017 (`responseModel` on all 4 of its responses), not GLM-5.3-Flash-EXL3. So I sent no more real-model turns. Everything after that ran through the e2e harness's scripted model, the try-out, and Canon's own recall code. Canon picks its block before any model answers, so the blocks quoted below are Canon's output whichever model answered.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9 | Every job in the brief works end to end, and round 4's quote, decision and drafts gaps are closed. My fresh 83-prompt set meets all five floors. But questions worded unlike the notes still miss one in four or five: the builder's probes 76.0% and 81.3%, the guard 75.0% and 79.2%, my 20-prompt stress set 75.0% and 80.0%, all under the 80% and 90% floors. |
| Reliability | 9 | No throw reaches a host call. Every side effect was logged once. Config is checked live with clear words (the home folder and DSH's data folder are refused). The vault copy changed by exactly the promoted note. 336 of 336 real-DSH checks passed. But the new "older than [1]" can mark an unrelated note that is still in force, and the filter for lines addressed to agents let a line through that tells the model to run `curl … \| sh`. |
| UX / polish | 9 | DSH's own glass cards and form, light and dark, now also with Wallpaper on. Nothing spills at 760 px, the tab order is clean, the focus moves to the line that says what Promote did, and every state says what to do next. But the citation shows the UTC day ("promoted 2026-10-27" for a promote at 11:42 PM PDT on Oct 26), and the whole draft shows raw Markdown. |
| Test depth | 9 | 47 host, 11 client and 11 relevance tests. 112 real-DSH checks on each of three builds, with pictures. Every relevance figure in the README reproduced exactly. But no test has a negative "older than" case (two unrelated decisions of one project), and the agent-line test covers only the listed phrasings. No fresh hold-out was measured this pass. |
| Docs | 9 | Accurate wherever I checked: the settings table against the code, the block's header word for word, every figure, files and modes, Promote, Discard, the ops words, and decisions with saving instructions. But it says a line addressed to agents "is never quoted into a turn", which the pattern list does not deliver. The README is still 717 lines. |

Plugin score: min(U, R, mean) = min(9, 9, 9.0) = 9.0. Verdict: NOT YET (the bar is 9.5 with no criterion below 9).

## What I ran

- **Build.** `git archive f31de80 | tar -x` into `~/Projects/goal95/judge/canon-r5/head`, with `.e2e` linked to the suite's DSH installs. I kept a copy of the live profile in my folder at the start.
- **Unit tests.** `npm test`: 858 tests, 851 pass, 0 fail, 4 skipped, 3 todo (91 s), as claimed. The todos are Canon's two hold-out floor tests (a known miss) and one of Proof's. Canon's own files: `canon-host` 47 of 47, `canon-client` 11 of 11, `canon-relevance` 7 pass, 2 todo, 2 skipped.
- **Real-DSH e2e** (my slot, 8:45 to 9:00 PM): `node scripts/e2e.mjs canon` passed 112 of 112 on DSH 0.2.0-rc.2 (351 s), 0.2.1-rc.1 (294 s) and the app's 0.2.1-rc.3 (276 s). Its check said the live DSH was unchanged before and after. I read every check. Each proves what it names, among them:
  - the block appears exactly once, quoting the whole note with its dated citation;
  - DSH's session log and Trajectory tab keep the block;
  - the try-out shows exactly the block the model got;
  - the switch on the card and on the page, with the focus;
  - capture fields, the whole draft, the related note, and Promote refused and done;
  - Discard moves the draft to the copy's `.trash` byte for byte;
  - Plugins off and on (nothing left behind, nothing repeated), a restart, Read Only, numbers in quotes, an unreadable vault and subfolder, `enabled: false`, file modes, and the fixture left untouched.
- **The README's figures**, `node scripts/canon-relevance.mjs`. Each matches the README exactly:
  - dev: 605 and 620 of 655, 0.25, 537 of 570, 432 of 445;
  - probes: 73 and 78 of 96, 0.39, 113 of 124, 101 of 110;
  - first hold-out (guard): 18 and 19 of 24, 0.37, 21 of 24;
  - second hold-out: 20 and 20 of 24, 0.15, 48 of 48, 40 of 40.
- **My own fresh probe set** (written from the vault's notes alone, labelled before measuring, measured once through Canon's own recall at the default settings; `probes-j5.json` in my judge folder): 83 prompts. 53 have an answering note: 40 questions, 6 coding requests that need a note, and 7 decisions to record. 20 are everyday coding requests, 6 are questions about the projects or the office that no note answers, 3 are chat and 1 is a decision with no note. Results: first note 45 of 53 (84.9%), answering note in the block 48 of 53 (90.6%), 0.21 notes per block that do not answer, no block for 26 of 30 (86.7%), no block for 18 of 20 coding requests (90.0%). Every floor met. Misses I would notice:
  - "bump the connection pool size in quartz-go, we're starving under load" got nothing, though Client settings says `quartz-go` and "a pool of 32 connections";
  - "lesson learned: no releases on Thursday afternoons either. write it up" got nothing (Release checklist);
  - "add a background job that sends the password reset email" got nothing (the JetStream decision: "every job handler must be safe to run twice");
  - "where is the mapping from url paths to backend services configured?" got nothing (Routing rules);
  - one false block: "log the request id on every error response" got Rate limits.
- **My stress set** (`stress-j5.json`): 20 questions deliberately worded unlike the notes. First note 15 of 20 (75.0%), answering note in the block 16 of 20 (80.0%): both under the floors.
  - "how often do certificates need replacing?" got nothing, though "certificates" is in the runbook's title.
  - "how do I empty one part of the cache?" in quartz-cache got the disk-full runbook ("empty the build cache").
  - "what does the LB hit to see if the gateway is alive?" got nothing.
  - "who has to sign off on a new path in the gateway?" got nothing.
- **Hand-made blocks** (Canon's own `Recall.preview` on copies of the fixture vault):
  - Two-part questions get both halves (Gateway ports whole, "Changing a port" included).
  - Routing rules keeps its "Today:" list.
  - Ops words work: "how do I get a new version of this live?" gets Deploying the gateway; "nuke the sessions namespace" gets Flushing the quartz cache.
  - "Who is the maintainer of quartz-cache?" gets Owners, but "who maintains quartz-cache?" and "who maintains this repo?" get nothing. "Who is responsible for this frontend?" still gets the local-run note.
  - Four decisions of my own wording that say how to save them each got the note they change first.
  - In a 2,400-character runbook (too long to quote whole), a two-part question quoted an unasked "Paging" section first: "page" in "status page" matched the heading.
  - A note with three lines addressed to agents: two were left out, but one that opened by naming the agent and told it to run a downloaded shell script before answering was quoted (exact line kept out of this copy).
- **Robustness**:
  - A 5,000-note synthetic vault reads in 3.3 s and recalls in 9 to 148 ms per prompt. A turn waits at most 0.8 s for a read (`WAIT_MS` in `lib/vault.js`), so a turn in the first seconds after start goes without notes rather than waiting.
  - A 355 KB pasted log is recalled in 19 ms.
  - Empty, emoji and non-Latin prompts get no block and no throw.
  - Another plugin's message gets no block.
  - An error in DSH's own step passes through untouched.
- **My instance**, in order:
  - Slot taken. `up`, then `defaultPreset: workspace-write` in its profile, then Session Watch and Canon loaded and a restart; `doctor` showed 0 errors and isolation ok.
  - Canon's row: `vault` was my copy of the fixture vault inside my judge folder, `access: drafts`, `promote: true`, every other key restated.
  - The workspaces were non-empty project folders (`ws/Projects/<project>`), apart from the vault copy.
- **Real-model turn** (11:39 PM, a new session in `ws/Projects/quartz-cache`, Workspace Write per its own `permission/preset` and `sandbox/mode` events). The prompt: "We just agreed in standup: quartz-cache clients now retry a read at most once, not twice. Save that as a draft decision note with the canon_capture tool …".
  - Canon's block cited and quoted Client settings.
  - The model (served by DeepSeek-V4.1-Flash-1017) called `canon_capture` once. The draft has `status: draft`, `kind: decision`, `project: quartz-cache`, and source session, turn, folder and `by: canon_capture`, and it names the note it changes.
  - No file was edited, and the reply cites the note.
  - An earlier attempt at 9:01 PM I cancelled after 45 s, before any tool ran. I had mistaken the blank default session's full-access event, logged before the restart, for this session's; that session was Workspace Write too.
- **In the window** (Playwright on my instance's own window):
  - The page light, dark and at 760 px; a tab walk.
  - Promote pressed by keyboard on the real-model draft. The focus moved to "Promoted … it is now an active note". The note landed at the vault's top level with `status: active`.
  - The try-out afterwards: "what read timeout should the client use?" gets the new decision first and Client settings "(older than [1])".
  - The two-part question also marks the unrelated eviction policy "older than".
  - Wallpaper (my extract of `goal95/wallpaper`) loaded and restarted, then the page light, dark and narrow with it on.
  - `vault: "~"`, then `vault: <the instance's DSH data folder>`, live. Both were refused in words and noted in What happened. The row was restored, and Canon worked again at once.
  - The real turn's chat with Canon's card.
- **End state.**
  - The vault copy differs from the fixture by one file, the promoted note; the head's fixture vault matches `git archive f31de80`.
  - Canon's folder is mode 700 and its files 600.
  - Five What happened entries, each once: draft saved, promoted, two refused vault folders, fixed.
  - Instance destroyed at 11:47 PM, slot given back, nothing of mine running.
- **Not checked by me:** a restart under a running turn. No real-model turns were allowed after the `responseModel` check. `preStep` and `prepare` are unchanged since b98506f, where round 4 forced one and found it clean; the e2e restarts DSH between turns.

## What I saw (each picture, one line)

In `review/canon-round-5/`. `dshtest-*` are from my DSH Test window; `e2e-<build>-*` are copied from my own e2e run (8:45 to 9:00 PM).

- `dshtest-page-light.png`: header (vault, 35 active notes and 3 drafts, read 1 min ago, Read again), the mascot note named as left out, and the try-out with two quartz-cache notes, each with "this project", why it fits and its quote.
- `dshtest-page-dark.png`, `-lower-*`, `-bottom-*`: the same in dark. Sessions that got notes. The Drafts card with the real-model draft, "Active note on the same subject: “Client settings” … Read it before you promote this draft.", Read the whole draft, Promote and Discard.
- `dshtest-narrow-light.png` / `-dark.png`: 760 px, nothing spills (page 704 px, scroll width 704 px).
- `dshtest-promoted-light.png` / `-dark.png`: after Promote by keyboard, the focus ring is on the green line that says where the note went.
- `dshtest-try-promoted-light.png`: "what read timeout should the client use?" gets [1] the promoted decision ("decision, promoted 2026-10-27") and [2] Client settings "older than [1]". Right, apart from the UTC day.
- `dshtest-try-older-light.png`: the two-part question. "Quartz eviction policy … Decision, dated 2026-06-04, older than 2026-10-26 quartz-cache clients retry reads at most once.md, which comes first." Wrong: they share only "clients".
- `dshtest-wp-page-light.png` / `-dark.png` / `dshtest-wp-narrow-*`: with Wallpaper on (its default Graphite wall), Canon's glass cards are readable in both themes, nothing of Wallpaper's is hidden, and there is no spill.
- `dshtest-vault-home-light.png`: `vault: "~"`. "Canon is waiting for a setting to be fixed. Vault folder (vault) must be the vault's own folder, not your home folder (it is “~”)."
- `dshtest-chat-card-light.png` / `-dark.png`: the real turn's reply (the draft path, the note it changes) and Canon's card ("1 note … Client settings · in Projects/quartz-cache", Turn off for this session, Open Canon), on Workspace Write.
- `e2e-0.2.0-rc.2-page-dark.png`, `e2e-*-try-light.png`: the try-out quoting all of Gateway ports, with the exact 673-character block.
- `e2e-0.2.0-rc.2-draft-whole-light.png`, `e2e-app-0.2.1-rc.3-draft-whole-dark.png`: Read the whole draft opens the body as written (raw `## How we found it`).
- `e2e-0.2.0-rc.2-discarded-dark.png`, `e2e-0.2.1-rc.1-discarded-light.png`: "Discarded “Port notes”: it is in the vault's trash now, .trash/Port notes.md. Move it back to Drafts to keep it."
- `e2e-0.2.0-rc.2-setting-dark.png`: two quoted numbers. Save it as 3 sits right under its setting, before "Also wrong".
- `e2e-*-vault-locked-dark.png`: an unreadable vault. A red line with what to do, then Read again and Open Canon's settings as buttons, logged as failed. On the app build, What happened also gives "“Notes a turn, at most” to 3; Canon waits until a wrong one is fixed".
- `e2e-0.2.0-rc.2-chat-light.png`, `e2e-app-0.2.1-rc.3-card-dark.png`: one card on the turn that got notes, none on the thank-you.
- `e2e-0.2.0-rc.2-promote-refused-light.png`, `-narrow-light.png`, `-disabled-light.png`, `e2e-0.2.1-rc.1-page-light.png`: Promote refused with the reason and focus, the narrow page, `enabled: false`, and the page on 0.2.1-rc.1.

No picture shows the empty state with no vault set; neither the e2e nor I took one.

## Findings (most severe first: blocker, major, minor, nit; each with where, what, and the fix)

1. **Major: "older than [1]" can mark a note that is still in force.**
   - Where: `newerFirst` in `lib/recall.js` (line 113). A decision counts as newer than any note of its project that shares one prompt word beyond the projects' names.
   - What: after the real-model decision on read retries was promoted, "how long do keys stay in the cache, and what read timeout should clients use?" in quartz-cache got the Quartz eviction policy marked "older than [1]". The page says so too: "older than … which comes first". The two decisions share only "clients", and the eviction policy is the note in force for key expiry. A model that reads "older than" as stale may discount it.
   - Fix: mark a note older only when the decision is on its subject. Use the test the drafts card already uses (`vault.related`: two of the older note's own words and a third of what the decision says), or require the decision to share a title, alias or heading word of the older note. Add a negative unit test with two unrelated decisions of one project and a two-part question.
2. **Major (known and documented): questions worded unlike the notes still miss.**
   - Where: the fit rules in `lib/search.js` and `lib/text.js`, and the ops-word list.
   - What: three fresh sets miss the first-note and in-block floors (probes 76.0% and 81.3%, guard 75.0% and 79.2%, my stress set 75.0% and 80.0%). Examples:
     - "how often do certificates need replacing?" gets nothing, though the title says certificates;
     - "who maintains quartz-cache?" gets nothing (the noun "maintainer" works);
     - "who is responsible for this frontend?" gets the local-run note;
     - "what does the LB hit to see if the gateway is alive?" gets nothing;
     - "how do I empty one part of the cache?" in quartz-cache gets the disk-full runbook first;
     - "bump the connection pool size in quartz-go" gets nothing, though `quartz-go` appears in one note only.
   - Fix:
     - verb forms of the owner words (maintains, looks after, is responsible for);
     - "LB" as load balancer;
     - one title word enough when the prompt's other words are only question words ("how often", "need", "replacing");
     - a library's name (`quartz-go`) counted as a note's value, as commands are.
     - Then measure once on a fresh hold-out written by someone who never saw the code.
3. **Minor: a line addressed to agents can still reach the model.**
   - Where: `ADDRESSED` in `lib/vault.js` (line 680) and README "The block".
   - What: a line that opened by naming the agent and told it to run a downloaded shell script before answering was quoted into the block (exact line kept out of this copy). Two other lines in the same note were left out ("Note to any LLM reading this vault: …", "If you are a language model, disregard …"). The README says such a line "is never quoted into a turn".
   - Fix: also match a line that opens by naming the agent ("Assistant:", "AI:", "Agent,", "Model:", "LLM:") and an instruction to run a command "before answering". Say in the README that lines like the listed ones are left out, and that the header marks the notes as reference, not instructions.
4. **Minor: dates in citations are UTC days.**
   - Where: `aboutOf` and `dayIn` in `lib/recall.js`, and the try-out's "Decision, promoted …".
   - What: a promote at 11:42 PM PDT on Oct 26 reads "promoted 2026-10-27". The file name the same draft got says 2026-10-26 (`dayOf`, local day), as does its body.
   - Fix: give a timestamp's day in the local time zone, as the file name does, and test a late-evening promote.
5. **Minor: a long note's quote can open with a section the prompt did not ask about.**
   - Where: `bestPassage` in `lib/vault.js`.
   - What: in a 2,400-character runbook too long to quote whole, "how do we fail over the ledger database and what do we post on the status page meanwhile?" quoted "Paging: …" first. The heading shares only the stem of "page".
   - Fix: let a paragraph join for the words it adds only when they are whole words of the prompt, or when they come from its own text and not just its heading's stem.
6. **Nits.**
   - Read the whole draft shows raw Markdown (`## How we found it`, `**at most once**`), and the first-words preview runs the heading into the text ("How we found it Clients behind…"). Render headings and bold, or end the heading with a full stop in the preview.
   - Discard re-encodes the draft as UTF-8, so "byte for byte" holds only for UTF-8 files.
   - Two sessions with the same title show twice in Sessions that got notes. That title is DSH's; adding the time would tell them apart.
   - The README is 717 lines (the handover says 711).

## Round-4 findings, checked at f31de80

1. **Major: the quote is too thin: fixed.**
   - Every fixture note that fits is quoted whole (Gateway ports with "Changing a port"; Routing rules with its "Today:" list).
   - A long note gives a paragraph for each part of a two-part question.
   - What remains is a minor ordering issue (Finding 5).
2. **Major: which of two notes is current: partly fixed.**
   - Each citation gives the note's kind and date. A newer decision comes first, and the note it changes says "older than [1]" (seen in my window after a real promote).
   - The drafts card names the active note on the draft's subject (seen with the real-model draft).
   - Open: the older note is not marked superseded (documented in Limits).
   - New: "older than" also marks unrelated notes (Finding 1).
3. **Major: words unlike the notes': partly fixed.** The ops words and phrases work. "how do I get a new version of this live?" now gets Deploying the gateway. Fresh sets still miss the floors, and "who's responsible for this frontend?" still gets the local-run note (Finding 2).
4. **Minor: a decision that says how to save it: fixed.** Four new wordings of mine each got the note they change first, and so did the real-model turn.
5. **Minor: drafts cannot be read in full or discarded: fixed.**
   - Read the whole draft, the active note on its subject, and Discard to `.trash` under a free name, logged, with the focus on the line that says where it went.
   - These are checked on three builds; I also saw the whole draft and the related note with a real draft.
   - Not done: a link that opens the draft in Obsidian.
6. **Nits: fixed.**
   - `by: canon_capture` unquoted.
   - The measurement history moved to `MEASURES.md`.
   - What happened gives the saved value while another setting is wrong.
   - Save it as N sits under its setting.
   - The page with Wallpaper on is now checked by me (it passes), though not by the e2e.

## What would make it a 9.5

- "Older than" only for a note on the decision's subject (Finding 1), with a negative test.
- Recall on paraphrases at the floors on a fresh hold-out: at least 80% first note and 90% in the block. Owner verbs, "LB", one title word plus question words, and library names as values (Finding 2).
- No line addressed to agents in any quote, with "Assistant:"-style openers and "run … before answering" caught, and the README worded to match (Finding 3).
- Local-day dates in citations (Finding 4), rendered headings in the whole draft, and an Obsidian link on drafts.
- Tests: the negative "older than" case, a direct-address line, a late-evening promote, and a Wallpaper-on picture in the e2e.

## Live DSH fingerprint (before and after)

- 8:44 PM PDT (start): pid 64099, started Mon Oct 26 15:35:11 2026, patch sha256 535e6390a2162bbc…655be. I kept a private copy of the live `cordis.patch.yml` in my judge folder. The 7:28 PM move (the live agent default model row, someone else's change) came before I started.
- 9:00 PM (after e2e, its own check): pid 64099, patch 535e6390…: unchanged.
- 11:38 PM (after the usage stop): pid 64099, started 15:35:11, patch 535e6390…: unchanged.
- 11:44 PM (after loading Wallpaper and restarting my instance) and 11:47 PM (end): pid 64099, started Mon Oct 26 15:35:11 2026, patch sha256 535e6390…655be: unchanged.
- Nothing of the suite was loaded into the live DSH, and no config pointed at `~/.dsh`.
