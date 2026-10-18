# History scrub report — private strings in release/glass-v1 history

Generated 2026-10-17 (Pacific) by DSH thread t7 ("History scrub report"), per the release-prep brief.
**Snapshot: commit `7d37571` (HEAD of release/glass-v1), 338 commits, full ancestry.** Release-prep threads are
committing to this branch concurrently; anything landed after this snapshot is not covered — re-run the commands
in Appendix A for a fresh sweep. (Commits landed while this report was written, through `6a5e4d2`, were
re-checked against all classes below: clean.)

Method: full `git log -p` dump of the branch ancestry, parsed per string class (diffs **and** commit messages);
cross-checked with `git log -G`/`-S` and `git log --grep`; line numbers read from the file content at each
introducing commit (`git show <sha>:<path> | grep -n`). Merge commits re-scanned with
`--diff-merges=first-parent`: no string was introduced only inside a merge resolution (merge `62ee21f` re-shows
calendar content already attributed to `e19d35d`/`b33e44e`). "Introduced" = commits whose diff added or removed
the string lines; commits that only touched a file nearby are not listed.

Scope note: `HANDOFF.md` was **not** modified (per brief) but it is a tracked file and appears in the HEAD-status
counts below. `review/RELEASE-CHECKLIST.md` and this report quote the class values as scrub documentation, so
both match future greps for these classes — accept or exclude `review/` when re-checking.

---

## Summary

| # | String class | Introduced in | Removed by | Still at HEAD (snapshot) |
|---|---|---|---|---|
| 1 | `frankennas` / `FrankenNAS` | a030400, 4b2a894, 1717697 (+ docs 55e5d6c, c787703) | 504ff19 (test/sends.test.js only) | **Yes** — coordinator smoke.mjs ×13, README ×1, brief ×2, checklist |
| 2 | `ascent-01..08` / `ascent-` / `owner-ascents` | 4b2a894, a030400, 55e5d6c, 0034759, 47e4b1a, e0bdda6 (+ checklist) | 504ff19 (sends.test.js only) | **Yes** — smoke.mjs ×8 (ascent-01), owner-ascents ×5, brief/checklist |
| 3 | Tailnet `100.x.x.x` | 4b2a894, a030400, 1717697, 55e5d6c (+ checklist) | 504ff19 (sends.test.js: 100.108.23.102 → 100.64.0.7) | **Yes** — 100.108.23.102 ×5 (+2 in checklist); `100.64.0.x` doc/placeholder values are not private |
| 4 | `192.168.x.x` | a030400, 4b2a894, e19d35d, 2600feb (+ checklist) | **nothing** — the real LAN IP survived the scrub | **Yes** — 192.168.1.49 ×7 (+1 checklist); other 192.168 values are generic test fixtures |
| 5 | `/tank` | a030400, 4b2a894, 3625092, 55e5d6c (+ checklist) | 504ff19 (sends.test.js only → `/data`) | **Yes** — smoke.mjs ×8, brief ×3, HANDOFF ×1, checklist quotes |
| 6 | `albertlee` / `/Users/albertlee` | d8baf0d, e2c7501, 55e5d6c (+ checklist) | — | **Yes** — categories smoke.mjs ×7, brief ×3, HANDOFF ×1 |
| 7 | `bertholomus@` + emails around it | a030400, 4b2a894, 55e5d6c, fadf5f9 (+ checklist) | 504ff19 (sends.test.js: bertholomus@ → alex@) | **Yes** — sends.js doc ×1, smoke ×2, brief ×2, HANDOFF ×1; plus **every commit's author/committer metadata** (§8) |
| 8 | Discord ids (17–20 digit snowflakes) | — | — | **None found** — the 5 snowflake-shaped matches are synthetic test values (§7) |
| 9 | Real calendar names / events | — | — | **None found** — all calendar fixtures are synthetic (§9) |
| 10 | PNG screenshots (binary, not text-searchable) | 7d37571 and earlier review rounds | — | **Yes** — 227 PNGs; 2 visually confirmed carrying private names (§10) |

---

## 1. `frankennas` (and `FrankenNAS`)

Pattern: `franken[Nn][Aa][Ss]` · commits: `a030400`, `4b2a894`, `1717697` (code), `55e5d6c`, `c787703`, `504ff19` (docs/scrub).

| Commit | Date | Subject | File | Lines (at that commit) |
|---|---|---|---|---|
| a030400 | 2026-10-14 | coordinator: the send check leaves out a send that reaches only trusted hosts | test/sends.test.js | ×63 — 26, 27, 385, 390, 392, 393, 403, 406, 409–472 (ssh/scp/rsync/curl/wget/pwsh/python fixtures) |
| 4b2a894 | 2026-10-14 | coordinator: a thread's sends to trustedHosts run without a prompt, logged | plugins/coordinator/test/smoke.mjs | ×13 — 4377, 4379, 4396, 4397, 4400, 4408, 4410, 4411, 4413, 4418, 4423, 4428, 4436 |
| 1717697 | 2026-10-14 | coordinator: the README names trustedHosts in the config table and send check | plugins/coordinator/README.md | 220 |
| 55e5d6c | 2026-10-17 | Release prep brief: Wallpaper/glass, skins, Calendar, Categories | briefs/BRIEF-RELEASE-GLASS.md | 18, 19 |
| c787703 / 504ff19 | 2026-10-17 | checklist skeleton / scrub | review/RELEASE-CHECKLIST.md | quotes the value as a scrub note (lines 15, 40 at snapshot) |

- **Removed by `504ff19`** (2026-10-17, "Scrub private host fixtures from the shared sends tests"): all 63
  occurrences in test/sends.test.js → `nas.example`.
- **Still at HEAD:** smoke.mjs ×13, coordinator README ×1, brief ×2, checklist quotes. No commit **message**
  contains the string.

## 2. `ascent-01..08` and bare `ascent-` variants

Pattern: `ascent` (-i) · commits: `4b2a894`, `a030400`, `55e5d6c`, `0034759`, `47e4b1a`, `e0bdda6`.

| Commit | Date | Subject | File | Lines | Value used |
|---|---|---|---|---|---|
| 4b2a894 | 2026-10-14 | coordinator: a thread's sends to trustedHosts run without a prompt, logged | plugins/coordinator/test/smoke.mjs | 4403, 4405, 4406, 4419, 4424, 4429, 4430, 4436 | `ascent-01` |
| a030400 | 2026-10-14 | coordinator: the send check leaves out a send that reaches only trusted hosts | test/sends.test.js | 401, 481, 482, 490 | `ascent-01` |
| 55e5d6c | 2026-10-17 | Release prep brief | briefs/BRIEF-RELEASE-GLASS.md | 12 ("no Fleet/Ascent/tank strings"), 18 (`ascent-0N`), 19 (`ascent-01`), 27 (`owner-ascents`) | all three forms |
| 0034759 | 2026-10-09 | HANDOFF: Mac row converted… | HANDOFF.md | (now line 80) | `owner-ascents:GLM-5.3-Flash-EXL3` lane spec |
| 47e4b1a | 2026-10-16 | suite: start the records | HANDOFF.md | 36, 392 (now 80, 441) | `owner-ascents` |
| e0bdda6 | 2026-10-16 | suite: brief and owner for the DSH plugin suite v1 | briefs/SUITE-BRIEF.md | 111 | `owner-ascents` |

- Only `ascent-01` of the eight hosts appears anywhere in history; no `ascent-02..08`.
- `owner-ascents` is the model-lane/provider name (internal infra naming) — also worth scrubbing or renaming.
- **Removed by `504ff19`:** the 4 `ascent-01` occurrences in test/sends.test.js.
- **Still at HEAD:** smoke.mjs ×8 (`ascent-01`); `owner-ascents` in HANDOFF.md 80+441, briefs/SUITE-BRIEF.md 111,
  brief 27; `Ascent`/`ascents` prose in brief 12 and checklist.

## 3. Tailnet `100.x.x.x` IPs

Pattern: `100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}` · commits: `4b2a894`, `a030400`, `1717697`, `55e5d6c`.

**Our real tailnet address, `100.108.23.102`:**

| Commit | Date | Subject | File | Lines |
|---|---|---|---|---|
| 4b2a894 | 2026-10-14 | coordinator: a thread's sends to trustedHosts… | plugins/coordinator/test/smoke.mjs | 4378, 4379, 4396, 4397 |
| a030400 | 2026-10-14 | coordinator: the send check leaves out… | test/sends.test.js | 391, 394, 409, 410, 415, 464 |
| 1717697 | 2026-10-14 | coordinator: the README names trustedHosts… | plugins/coordinator/README.md | 220 |
| 55e5d6c | 2026-10-17 | Release prep brief | briefs/BRIEF-RELEASE-GLASS.md | 19 |

- **Removed by `504ff19`** from test/sends.test.js (→ placeholder `100.64.0.7`).
- **Still at HEAD:** 5 lines (smoke.mjs 4378, 4379, 4396, 4397; brief 19) + 2 quoted in
  review/RELEASE-CHECKLIST.md (16, 40).

**`100.64.0.0/10` and friends — CGNAT documentation/test values, not private** (listed so the fix regexes don't
miss them, and so they are deliberately left alone): `100.64.0.0/10` doc default in dsh-site
(`2a377af`/`2600feb` README 49, 61, 70; lib/index.js 39), calendar SSRF guard doc list (`e19d35d` http.js 54),
`100.64.0.7` as doc example (coordinator lib/index.js 88, sends.js 2077, now the scrub placeholder), CIDR test
values 100.64.0.1 / 100.127.255.254 / 100.128.0.1 (`2600feb` test/cidr.test.js 13–16, 23; `e19d35d`
http.test.mjs 67, 76).

## 4. `192.168.x.x`

Pattern: `192\.168\.[0-9]{1,3}\.[0-9]{1,3}` · commits: `a030400`, `4b2a894`, `e19d35d`, `2600feb`.

**Our real LAN address, `192.168.1.49`** (in the trustedHosts fixtures next to frankennas/100.108.23.102):

| Commit | Date | Subject | File | Lines |
|---|---|---|---|---|
| a030400 | 2026-10-14 | coordinator: the send check leaves out… | test/sends.test.js | 385, 411, 413, 415, 419 |
| 4b2a894 | 2026-10-14 | coordinator: a thread's sends to trustedHosts… | plugins/coordinator/test/smoke.mjs | 4379, 4401 |

- ⚠ **`504ff19` did NOT scrub this one** — `trustedHosts: ['nas.example', '100.64.0.7', '192.168.1.49']` kept
  the real LAN IP. **Still at HEAD:** test/sends.test.js ×5, smoke.mjs ×2 (+1 quoted in the checklist, line 16).

**Generic RFC1918 test values (not identifiable as ours — decision needed whether to genericise):**
calendar tests `e19d35d` (2026-10-11): caldav.test.mjs 383, 391 (`192.168.1.20`), http.test.mjs 66, 102, 125,
150, 151, 153, 157, 158, 160, 161 (`192.168.1.1`, `192.168.0.10`, `192.168.1.20`, `192.168.1.6`), http.js 54
(private-range doc list); `2600feb` (2026-10-05) test/cidr.test.js 16 (`192.168.1.10`). All still at HEAD.

## 5. `/tank`

Pattern: `/tank` · commits: `a030400`, `4b2a894`, `3625092`, `55e5d6c`.

| Commit | Date | Subject | File | Lines |
|---|---|---|---|---|
| a030400 | 2026-10-14 | coordinator: the send check… | test/sends.test.js | ×16 — 26, 27, 390, 392, 393, 406, 412, 413, 442–448, 487 |
| 4b2a894 | 2026-10-14 | coordinator: a thread's sends… | plugins/coordinator/test/smoke.mjs | 4377, 4378, 4396, 4400, 4413, 4418, 4423, 4428 |
| 3625092 | 2026-10-10 | projects: threads open beside their coordinator… | HANDOFF.md | 11 (quoted user words "…models/fleet/tank…") |
| 55e5d6c | 2026-10-17 | Release prep brief | briefs/BRIEF-RELEASE-GLASS.md | 12, 18, 19 |

- **Removed by `504ff19`** from test/sends.test.js (→ `/data`).
- **Still at HEAD:** smoke.mjs ×8, brief ×3, HANDOFF.md 125, checklist quotes (16, 40).

## 6. `albertlee` / `/Users/albertlee`

Pattern: `albertlee` (-i; "Albert Lee" with a space: 0 hits) · commits: `d8baf0d`, `e2c7501`, `55e5d6c`.

| Commit | Date | Subject | File | Lines |
|---|---|---|---|---|
| d8baf0d | 2026-10-11 | categories: the projects store's categories exactly as they are… | plugins/categories/test/smoke.mjs | ×7 — 244, 246, 256, 271, 287, 295, 314 (`ws:/work/albertlee` test fixture) |
| e2c7501 | 2026-10-11 | handoff: categories and projects are two plugins… | HANDOFF.md | 14 (now 107): `link:/Users/albertlee/.dsh-plugins/…` |
| 55e5d6c | 2026-10-17 | Release prep brief | briefs/BRIEF-RELEASE-GLASS.md | 12, 18, 19 |

- **Still at HEAD:** categories smoke.mjs ×7, brief ×3, HANDOFF ×1 (the categories smoke fixture is being
  scrubbed by another thread right now — uncommitted at snapshot time).

## 7. Discord ids (snowflake-like 17–20 digit numbers)

Pattern: `[0-9]{17,20}` over all diffs and all commit messages. **No real Discord ids found anywhere in history.**
All 5 matches are synthetic test values:

- plugins/calendar/test/ical.test.mjs 28, 441 (`b33e44e`) — hex Exchange UID blobs.
- plugins/calendar/test/caldav.test.mjs 930 (`e97aeec`; now 1290) — fake sync token.
- plugins/calendar/test/standins/google.mjs 304 (`e97aeec`) — fake Google `sub`.
- plugins/calendar/test/standins/microsoft.mjs 82 (`e97aeec`; now 83) — fake filetime hex.

The `plugins/discord` plugin carries no hardcoded ids; its test webhook is a synthetic
`discord.com/api/webhooks/1/abc`. No 17–20 digit number appears in any commit message.

## 8. `bertholomus@` and the emails around it

Two distinct surfaces:

**(a) Commit identity metadata — present on every commit, invisible to `git log -p` diffs.** Author and
committer are identical on all 338 commits:

| Identity | Commits |
|---|---|
| `bertholomus <311723197+bertholomus@users.noreply.github.com>` | 225 |
| `Bertholomus AI <albert@dnaclothing.com>` | 41 |
| `bertholomus <albert@dnaclothing.com>` | 1 |
| a third-party assistant's noreply identity (see Appendix A) | 69 |
| `MiniMe <minime@localhost>` | 2 |

`albert@dnaclothing.com` appears **only** in metadata, never in tree content. The noreply address embeds the
GitHub user id `311723197`. The 69 third-party-assistant-identity commits are a branding matter (the repo's
own naming scan, test/coordinator.test.js:89, polices vendor names in files but cannot see commit metadata).

**(b) Tree content** · pattern `bertholomus@` · commits: `a030400`, `4b2a894`, `55e5d6c`, `fadf5f9`.

| Commit | Date | Subject | File | Lines |
|---|---|---|---|---|
| a030400 | 2026-10-14 | coordinator: the send check… | test/sends.test.js | 391, 409, 411, 413 (`bertholomus@100.108.23.102`, `bertholomus@FrankenNAS`) |
| a030400 | 2026-10-14 | (same) | plugins/coordinator/lib/sends.js | 720 (now): doc example `bertholomus@nas` |
| 4b2a894 | 2026-10-14 | coordinator: a thread's sends… | plugins/coordinator/test/smoke.mjs | 4378, 4396 |
| 55e5d6c | 2026-10-17 | Release prep brief | briefs/BRIEF-RELEASE-GLASS.md | 18, 19 |
| fadf5f9 | 2026-10-10 | projects: the user's tools and session permissions as settings | HANDOFF.md | 203 (now 542): documents the author identity |

- **Removed by `504ff19`** from test/sends.test.js (→ `alex@100.64.0.7`).
- **Still at HEAD:** sends.js 720, smoke.mjs 4378/4396, brief 18/19, HANDOFF 542, checklist quotes.
- Synthetic, **not** private (do not chase): calendar test emails `me@gmail.com`, `ann@gmail.com`,
  `boss@example.com`, `alice@fastmail.com` etc. introduced across the calendar test commits
  (`569349a`, `60ddb62`, `2d51966`, `8dc99a3`, `91ec603`, `a28ca16`, `a7ccbd2`, `e41f44b`, `e97aeec`).

## 9. Real calendar names or events

**None identifiable.** All calendar fixtures and standins are synthetic personas: `alice@fastmail.com`,
`alice@icloud.com`, `alice@me.com`, `alice@example.com` (fastmail/icloud/nextcloud CalDAV fixtures), attendees
`me@gmail.com`, `ann@example.com`, `boss@example.com`, event summaries "Team sync", "Standup <daily> & notes",
"Lunch with Sam & Kim". The calendar plugin's only hits in the scrub classes are the generic `192.168.x.x` /
`100.64.0.x` test addresses listed in §3–§4 (files: lib/http.js, test/http.test.mjs, test/caldav.test.mjs —
the brief's "calendar (3 files)").

## 10. Screenshots and other binary content (not text-searchable)

`git log -p` cannot see inside binaries. 227 PNGs are tracked at HEAD:
review/autopilot-round-1 ×30, round-2 ×49, round-3 ×37, autopilot-builder ×3, decisions-round-1 ×46,
decisions-round-2 ×41, live-021 ×20, plugins/notifications ×1.

Visually checked two of the live-021 set (DSH 0.2.1-rc.2 evidence shots):

- `review/live-021/light-Tank.png` — shows the real project/session list: `albertlee`, `DSH Plugin Dev`,
  `dsh-plugin-suite`, `deepseek-plugins`, `deepseek-plugins-work`, plus model-shelf names.
- `review/live-021/light-Fleet.png` — visible text includes **`FrankenNAS`** and **`Ascents`**, lane names and
  model names.

So screenshots are a real carrier of the same private strings. The older autopilot/decisions evidence rounds
show the same UI and very likely carry the same names. A visual pass (or dropping review screenshots from the
release) is a decision for Albert; it is not covered by text regexes.

`HANDOFF.md` (281 KB, tracked) also carries several classes (owner-ascents 80/441, /tank 125, albertlee 107,
bertholomus@ 542 + more); it was not modified for this report per the brief.

---

## Options for the history fix — Albert's decision, nothing executed here

Per the brief, no history was rewritten, nothing was rebased, and nothing was force-pushed. Whichever option is
chosen should run **after** the in-flight scrub commits land (the branch is a moving target; this report is a
snapshot), and must decide what happens to `briefs/`, `review/` and `HANDOFF.md` — they carry the strings too.

1. **`git filter-repo` (rewrite in place).** `--replace-text` for the value classes (frankennas, ascent-0N,
   100.108.23.102, 192.168.1.49, /tank, albertlee, bertholomus@) plus `--mailmap` to rewrite author/committer
   identities (a plain replace-text cannot touch metadata). Pros: keeps history and the four `*-v1.0.0` tags
   (rewritten). Cons: every SHA changes → force-push to `gh`, fresh clones for everyone, open PRs rebase, the
   local `origin` worktree and every other checkout must be re-seeded; any ref not rewritten (other branches,
   PR refs, GitHub cache/forks) keeps the old objects reachable. Highest effort, most complete.
2. **Fresh squash for the release.** Cut an orphan branch from the scrubbed tree as a single `v1` commit (or one
   commit per plugin), push that as the release; keep the full history in the private repo or an archive branch.
   Pros: no leak in what ships, no force-push of existing branches, simplest to verify. Cons: loses the commit
   history in the release line; the private repo itself still carries the old history, so option 1 or 3 still
   applies to it if it ever goes public; tags must be re-pointed.
3. **Leave history as is.** Pros: zero risk of breaking 338 commits, four tags and everyone's checkouts; the
   values are already gone from HEAD code (post-scrub). Cons: any future public/publish step exposes hosts,
   LAN/tailnet IPs, usernames and the real email in every commit's metadata; `filter-repo` remains available
   later — but every additional clone/PR makes it harder.

If the repo stays private forever, option 3 plus the HEAD scrub is defensible; if it is ever published or the
plugins are distributed from it, option 1 (or 2 for the artifact + 1 for the repo) is the real fix.

## Appendix A — reproduction commands (run at the current HEAD)

```sh
# per class over full ancestry (diffs + messages)
git log -i -E -G'frankennas'                                   # frankennas / FrankenNAS
git log -i -E -G'ascent'                                       # ascent-0N, ascent-, owner-ascents
git log -E -G'100\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}'         # tailnet 100.x
git log -E -G'192\.168\.[0-9]{1,3}\.[0-9]{1,3}'                # LAN 192.168.x.x
git log -G'/tank'                                              # /tank paths
git log -i -E -G'albertlee|Albert Lee'                         # username / home dir
git log -i -E -G'bertholomus@|dnaclothing|users\.noreply\.github\.com|@gmail\.com'
git log -E -G'[0-9]{17,20}'                                    # snowflake-shaped ids
git log -i -E --grep='<same patterns>'                         # commit messages only
# current tree
git grep -inE 'frankennas|ascent|100\.[0-9]+\.[0-9]+\.[0-9]+|192\.168\.|/tank|albertlee|bertholomus@'
git log --format='%an <%ae>%n%cn <%ce>' | sort | uniq -c       # identity metadata
```
