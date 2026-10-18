# Coordinator release prep — notes (thread t5)

Branch `release/glass-v1`, worktree `/Users/albertlee/Projects/worktrees/dsh-release-glass`.
Scope: `plugins/coordinator/**`, this file, `review/glass-v1/coordinator/`.

## Job 1 — 0.2.1-rc.2 re-check

App: `/Applications/DeepSeek Harness.app` `CFBundleShortVersionString` = **0.2.1-rc.2** (verified via PlistBuddy).
Read-only ASAR header parse (`/tmp/asar-scan.mjs`, scratch, nothing written into the app):

- **Client packages** — every entry in the coordinator's `dsh.client.inject` resolves on 0.2.1:
  `dsh-client-ui-settings`, `-plugin-manager`, `-conversation`, `-chat`, `-sidebar-right`, `-workspace`,
  `dsh-api-remotes`, `dsh-api-session-controller`, `dsh-client-resources`, `dsh-client-connection` all exist
  as packages in the ASAR. `dsh-client-ui-primitives` is not a standalone dir; DSH's own plugin docs inside the
  ASAR (`dsh-agent-preset/.../practices.md`) document it as served through `dsh.client.inject`, and DSH's own
  plugins (`dsh-client-locale`, `dsh-client-shortcuts`) `require` it the same way in their `lib/client.js`.
- **Tokens** — all 48 `--dsw-*` / `--dsh-*` / `--ds-*` tokens `lib/client.js` uses are present in the extracted
  0.2.1 client bundles (69 files, 11 MB, `/tmp/dsh021`): zero missing, including the fallback-prone ones
  (`--dsw-alias-turn-trigger-bg(-hover)`, `--dsw-alias-settings-card-(stroke|fill)`, `--dsw-alias-menu-icon`,
  `--dsw-alias-bg-module-platform`, `--dsh-composer-dock-inset`, `--dsh-workspace-indent`,
  `--dsw-focus-ring-width`, `--dsw-alias-label-primary-dimmed`, `--dsw-alias-label-dimmed`).
- **Slots** — every slot key the coordinator registers exists in 0.2.1 bundles:
  `conversation.session.header.actions` (dsh-client-ui-conversation), `conversation.input.left`,
  `conversation.chat.turnTail`, `conversation.chat.node` + DSH's own `turn-trigger` key (dsh-client-ui-chat),
  `sidebar.session.row.leading`, `sidebar.session.row.hover`, `sidebar.workspaces.session.row.action`,
  `sidebar.workspaces.session.menu.item`, `conversation.input.dock`, `shell.overlay`, `plugins.bundle.config`,
  `sidebar.right.pane.tab(.title)`.
- **DOM anchors** — `data-row-key` rows render `session:${id}` (dsh-client-ui-workspace) so
  `[data-row-key^="session:"]` still matches; `nav` with `aria-label` present in the conversation/chat bundles
  for the title crumb; `data-ds-dark-theme` on body (11 bundles), `__ModuleLoader__` (55), `__DSH_BOOT__` ✓.
- **Live activation** — MiniMe's live check (review/live-021/FINDINGS.md item 4): host side clean on 0.2.1 for
  Coordinator, logs show no errors. Re-verified below on the DSH Test instance `glass-coordinator`
  (same 0.2.1-rc.2 app): doctor, load, clean logs — see "DSH Test runs".

No client-side break found on 0.2.1-rc.2. The only 0.2.1 client package the reviews flagged for *Wallpaper*
(`dsh-client-ui-schedule` / Automation tasks) is not in the coordinator's path.

## Job 2 — glass fixes (DESIGN.md "Where things stand" → Coordinator)

Four gaps, all in `plugins/coordinator/lib/client.js`:

1. **No motion rule for `body.wp-still`** (its chevrons `.dshp-mp-chev/.dshp-t-chev/.dshp-ch-chev/`,
   `button.dshp-t-group svg`, `.dshp-ps-more svg`, the meter `.dshp-t-card-meter>span` and the notice
   `.dshp-nt` kept moving; reduced motion covered only `.dshp-ch-busy` and `.dshp-nt`).
   Fix: DESIGN §6 sweep — `body.wp-still :is(<roots>)…` and the same under
   `@media (prefers-reduced-motion:reduce)`, pseudo-elements named. Roots are the plugin's own containers,
   including its two portals to `document.body` (`.dshp-t-menu`, `.dshp-mp-menu`) and DSH's dialog it fills
   (`.dshp-ps`), so nothing it draws is left out.
2. **One `:has()` on DSH's header** (`nav[aria-label]:has(+div [data-projects-threads])>span:last-child>span`).
   Fix: mark DSH's title nav with `data-projects-title` while the Threads header is mounted (categories'
   `useChipHost` pattern — mark, CSS names the mark, mark removed on unmount), selector becomes
   `nav[aria-label][data-projects-title]>span:last-child>span`. The mark goes with the plugin's header, so
   switched-off leaves nothing behind (rule 11).
3. **Style injection had no `try`/`catch`** — one throw at load would stop every plugin's browser half
   (DESIGN §8). Now wrapped, logs `[coordinator] …` and continues.
4. **Slot entry ids used `/`** (`dsh-plugin-coordinator/threads-menu` …) where the pattern is
   `<package>:<name>` (DESIGN §8). All 18 `IDS` entries switched to `:`; `test/client.mjs` expectations
   updated to match. The style-sheet id `dsh-plugin-coordinator/client.css` stays `/` per DESIGN §8's
   style-sheet row; window storage (`dsh-plugin-coordinator/…`) unchanged.

"Before you push" ticks: see checklist section below.

## Job 3 — privacy scrub

`test/smoke.mjs` carried the private fixture names the shared root suite (`test/sends.test.js`, commit 504ff19)
already replaced. Same placeholders, per the Lead:

- `frankennas` → `nas.example` (case-insensitivity check keeps a variant: `ssh NAS.EXAMPLE …`, `hostOf` lowercases)
- `100.108.23.102` → `100.64.0.7`
- `bertholomus@` → `alex@`
- `ascent-01` → `host-01`
- `/tank` → `/data`
- `192.168.1.49` stays (the root suite keeps it as the untrusted example)
- `sends.js` line ~720 doc comment: `bertholomus@nas` → `alex@nas.example`
- README `trustedHosts` row: `frankennas` → `nas.example`

Sweep after edit: `grep -rniE 'frankennas|100\.108\.23|bertholomus|ascent|/tank'` over `plugins/coordinator`
= no hits (also checked `albert`, `minime`, `dsh-test`, third-party assistant names).

## DSH Test runs

(see "DSH Test runs" appended below after each run)

## Checklist (DESIGN.md "Before you push")

(filled before push)
