# Release prep: Wallpaper/Glass + skins, Calendar, Categories (MiniMe, 2026-10-17)

Albert (Discord, 2026-10-17 ~10:40 AM PT): "let's prep up to release our Wallpaper/Glass, and skin for the context plugin - Calendar, Categories, and all native wallpaper/glass skin and skins for our plugins".

## Where you work
- Worktree: `~/Projects/worktrees/dsh-release-glass`, branch `release/glass-v1`, cut from `gh/main` (15d8bf0) of `bertholomus/deepseek-plugins` (private).
- Commit ac80bab brought `plugins/wallpaper` in from `~/Projects/worktrees/dsh-split-plugins` (its commit c14deb5). That worktree runs the live DSH; never edit it.
- Read `DESIGN.md` in this repo first. It is the glass rule book (rules 1-3: Wallpaper is the only mod; it changes grounds, not content; know which surface you are on).
- DSH is now **0.2.1-rc.2** (the live app updated today). Target 0.2.1-rc.2 first, then check 0.2.0-rc.2 behaviour from the old notes where it matters.

## Scope (release candidates)
1. **Wallpaper** (`plugins/wallpaper`): wallpaper + frosted glass + headline. Make it work on 0.2.1-rc.2 (DSH changed client UI packages; re-check every selector and token it uses against the 0.2.1 client bundles), and make it generic for the public: no Fleet/Ascent/tank strings, no "Quit fucking around" default headline (keep it as an opt-in example only if you must; the default must be neutral or empty), no paths under `/Users/albertlee`, no wallpaper collections that we do not have rights to ship (ship none or ship original/CC0 ones with a source note).
2. **Skins** (the "native glass skin" for each plugin): each of our plugins must sit on Wallpaper's glass per DESIGN.md: Calendar, Categories, Coordinator, Notifications, Discord (no UI), Session bridge (no UI), and the suite plugins on main (Autopilot, Decisions, Agent Terminals, Session watch). Fix each plugin in its own commit. Where DESIGN.md's "Where things stand" lists a gap, close it.
3. **Context plugin skin**: `dsh-context` is a third-party plugin (npm `dsh-context` 0.72.0, github.com/bowenliang123/dsh-context, not ours). Wallpaper already has a section for it (`plugins/wallpaper/lib/client.js` ~line 449: overview page in main, right-sidebar pane `.lc-root`). Keep that skin inside Wallpaper as an optional third-party skin, keyed only on dsh-context's own elements, and re-check it against dsh-context 0.72.0 on 0.2.1-rc.2. Do not copy or vendor dsh-context code. If the skin needs an upstream hook, write the proposed issue/PR text to `review/upstream-dsh-context.md` (do not post it).
4. **Calendar** and **Categories**: 0.2.1-rc.2 check, glass skin, and the privacy scrub below.

## Privacy scrub (required before any release)
- Replace our own details in code, tests, fixtures, READMEs and screenshots: `frankennas`, `ascent-0N`, `100.x.x.x` tailnet IPs, `192.168.x.x`, `/tank`, `albertlee`, `bertholomus@`, Discord ids, real calendar names or events. Use `nas.example`, `100.64.0.7`, `/Users/alex`, and similar.
- Known hits: `coordinator/test/smoke.mjs` (frankennas, 100.108.23.102, bertholomus@, ascent-01, /tank paths), `categories/test/smoke.mjs` (albertlee paths), calendar (3 files), dsh-site (2 files).
- Run `git log -p` over the history for the same strings and write the result to `review/history-scrub.md` (which commits, which strings). Do NOT rewrite history or force-push; the history fix is Albert's decision.

## Testing (hard rules)
- Test ONLY in DSH Test instances: `~/.local/bin/dsh-test` (README `~/Projects/dsh-test-harness/README.md`). Use named instances (`dsh-test --name glass-<plugin> ...`).
- NEVER load this code into the live DSH (`~/.dsh`, `~/.dsh-plugins`, the running app). Never restart, quit or edit the live DSH. `dsh-test fingerprint` before and after each run must show the same live pid and `cordis.patch.yml` sha256; log it in `review/RELEASE-PROGRESS.md`.
- Screenshots light and dark, with Wallpaper on and off, per plugin, into `review/glass-v1/`.
- Host unit tests must pass for each plugin you touch (`node --test`).
- Models: `owner-ascents` / `GLM-5.3-Flash-EXL3` only. No DeepSeek models.

## Gates (stop and write `DECISION NEEDED:`)
- Making the repo public, npm publish, posting anywhere (Discord, GitHub issues/PRs on other repos), history rewrite, force-push.
- Allowed without asking: commits and pushes to `release/glass-v1` on the private remote
  (`PATH=/opt/homebrew/bin:$PATH git -c credential.helper= -c credential.helper='!gh auth git-credential' push gh release/glass-v1`), DSH Test instances, dev deps inside the worktree.

## Output
- `review/RELEASE-CHECKLIST.md`: one block per plugin: 0.2.1 status, glass skin status, scrub status, tests, screenshots, verdict (ready / not yet + why).
- End each turn with one status line. Use threads in parallel: one per plugin (Wallpaper+context skin, Calendar, Categories, Coordinator+Notifications, suite plugins), plus one for the history scrub report.
