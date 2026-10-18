# Wallpaper release prep — thread notes (release/glass-v1)

Owner: thread t2 (Wallpaper + dsh-context skin). Commit 7745469 on release/glass-v1.
Verified locally: `node --check` on client/impl/index, `node plugins/wallpaper/lib/impl.test.mjs` (all
checks pass), scrub-string grep clean. DSH-Test verification: **blocked** — see the last section.

## 1. 0.2.1-rc.2 re-check (Desktop app.asar, read-only) + npm 0.2.0-rc.2 / 0.2.1-rc.1 cross-check

Facts read out of the bundles (extraction one-off, not committed):

- The Desktop 0.2.1-rc.2 build kept the module hashes the old rules hardcoded (`6Qf49G_frame`,
  `irMxjq_panel`, `yhfFVG_card`), but the npm builds of both versions hash the same classes
  differently (`x6G_frame`, `P3OORG_panel`, `uV2eYG_card`, schedule page `XoWW_page` in rc.1). Every
  hash anchor was replaced with word-of-class/structure anchors that match all three builds:
  - Frame + columns: `[data-slot="root"] > [class*="_frame"] > :is(…Col)` (DESIGN.md section 8 table).
    The bare `[class*="_frame"]` clear is gone — it also stripped image-attachment frames, the
    subagent card and document previews (all confirmed still carrying `_frame` classes in 0.2.1).
  - Resize handle: `[data-slot="root"] [class*="_handle"]` (the only `_handle` class in any 0.2.1
    client package).
  - Right dock: `[data-slot="rightbar.session"] > [class*="_panel"]` — the panel is the entry's root
    element (`RightbarSeat` → `SidebarPanel`), verified in both versions; collapsed still keys on the
    frame's `[data-rightbar-collapsed="true"]`. `_tabHost`/`_tabLayout` rules deleted: those classes
    only existed in the old 0.2.0 Desktop build; 0.2.0-rc.2 npm and 0.2.1 both use dockkit.
  - Composer: `[data-slot="conversation.composer.bar"] [data-composer-card]:not([class*="WorkspaceTrigger"])`.
    DSH stamps the composer card with `data-composer-card` in both versions; the hero workspace chip is
    the same element with the trigger class, so the `:not` keeps DSH's own chip look.
  - Session-list fade: broadened from `[data-slot="sidebar.workspaces"]` to `[data-slot="sidebar"]`.
- Open chat `:has()` → DSH's own `data-phase` attribute. `ConversationMainPanel` stamps
  `data-phase="hero" | "settling" | "active"` on the exact `>div` the rule paints, in 0.2.0-rc.2 and
  0.2.1 alike. No descendant scanning at all.
- Dead rule removed with a real finding: `[data-slot="main.conversation"] [class*="_body"]` stripped
  the ground of the 0.2.1 markdown code blocks (`YS3v9W_body`, `Bpi2Dq_body` paint
  `--dsw-alias-markdown-code-block`). No `_body` element in the conversation skeleton paints a ground
  in either version, so the rule is gone instead of patched.
- Automation tasks page: `.CxUija_page` (TaskManagerPage.module.css in
  `@deepseek-ai/dsh-client-ui-schedule`) paints `--dsw-alias-bg-base` — the opaque black/white ground
  MiniMe saw. Skinned below, together with the Plugins page, under one word-of-class anchor.
- Tokens: 0.2.1's sheet still defines everything Wallpaper reads (`--dsw-alias-bg-layer-1..3` for the
  skin remap) with the same statics (`--dsw-static-neutral-bluish-300/400/600/700/1000` identical in
  0.2.0-rc.2). No renames broke anything.

## 2. Light-mode contrast (the MiniMe finding)

- New effect "wallpaper: glass labels": while Wallpaper is on it calls
  `ctx.theme.overrideTokens("dsh-plugin-wallpaper", …)` and deepens DSH's
  `--dsw-alias-label-secondary` (80% `bluish-700` + 20% `bluish-1000` → #51555a) and
  `--dsw-alias-label-tertiary` (75% `bluish-600` + 25% `bluish-1000` → #64686e) in light mode; dark
  passes DSH's own statics through unchanged, because the live check says dark is fine. The disposer
  removes the layer when Wallpaper turns off. This is DESIGN.md's open question "DSH's own text under
  Wallpaper", scoped to the failing palette; values are `var()`-based so they track DSH's statics.
- Wallpaper's own light palette deepened to the same recipe: `--wp-meta` #55605A → #51555A (the
  sidebar tiles and `.wp-meta`), `--wp-faint` deleted (defined, never read). `--wp-soft` stays
  #38403B — already deeper than the recipe.
- Not done, on purpose: no scrim change and no glass card for Models/Tank. Models and Tank are
  Albert's plugins — not mine to edit — and their secondary text is covered by the token deepening;
  their primary text on a busy wall is DESIGN.md's still-open "DSH's own pages under Wallpaper"
  question. The scrim is the user's picture; the finding named deepening as the fix.

## 3. Generic release scrub

- Default headline `""` (was the profane one) in client + host; the panel placeholder explains that
  empty shows DSH's own headline. No trace of the old text anywhere in the plugin.
- Fleet Shell import deleted (impl.js `importFrom`, the import block, README section, test); the host
  now reads and writes only its own folder, asserted by the test.
- Google Fonts Geist link deleted; the modal, toast and headline use `var(--dsw-font-family)` /
  `var(--ds-font-family-code)` per DESIGN.md section 5.
- Default collection `null` (was "cars"). No wallpapers ship with the plugin (no image assets in the
  package, `files` unchanged).

## 4. dsh-context 0.72.0 skin (optional third-party skin, unchanged rules)

- Verified against the installed 0.72.0 (`~/.dsh/profiles/desktop/node_modules/dsh-context`, read
  only): `section.lc-ov-page` still paints `--dsw-alias-bg-base` (the overview page in main);
  `.lc-root` is the right-sidebar pane root and error-boundary root; `.lc-modal-card` is the
  version-gate modal and paints `--dsw-alias-bg-layer-1`; its cards read `bg-layer-1/2/3` (24/41/1
  usages), which is exactly what the skin's token remap turns into faint fills. No code copied or
  vendored — the skin keys on dsh-context's own hand-written classes only, and it applies only when
  dsh-context is loaded. See review/upstream-dsh-context.md for the upstream question.

## 5. `:has()` cost, measured

Synthetic replica of the conversation subtree (330 message rows, DSH-shaped slots) in Brave/Chromium
155 headless, Wallpaper's old `:has()` rule vs the new `data-phase` rule, forced style+layout per
mutation (script in /tmp/wp-bench, not committed):

| Mutation | `:has()` rule | `data-phase` rule |
| --- | --- | --- |
| streamed text token | 0.102 ms | 0.107 ms |
| insert/remove a streamed block | 0.159 ms | 0.152 ms |

So on modern Blink the old rule was not pathological (Blink only re-checks the `:has()` on subtree
structure changes and the match state never flips), and the attribute version is equal or slightly
cheaper while removing the invalidation class entirely. Caveat: synthetic DOM, not the real window;
re-measure in DSH Test when the instance blocker clears.

## 5b. Selector verification on a DOM replica

Every DSH-facing rule was checked against a static replica of the 0.2.1 Desktop tree (slots,
columns, composer, dock, sidebar, schedule/Plugins pages) **and** the same tree with the npm 0.2.1
hashes (`x6G_*`, `P3OORG_panel`, `XoWW_page`, `Xa_*`, `bhn1Oq_fade`, `uV2eYG_card`). Each rule
matched exactly its intended element on both trees: frame 1, columns 3, handle 1, sidebar card 1,
fade 1, footArea 1, panelList/panelRow 1, open chat 1, chat header 1, dock panel 1, composer card 1
(the hero workspace chip, which carries the same `data-composer-card` plus its trigger class, is
excluded as intended), the mounted `_page` in main 1, collapsed-state 0. Script kept in
/tmp/wp-verify (not committed); re-run against the live window when the instance blocker clears.

## 6. Blocked: DSH-Test verification

Every `dsh-test` command dies with `spawnSync /bin/ps EPERM` (the harness needs the process table).
Any setuid binary fails from this session's bash even under approved danger-full-access
(`/bin/ps`, `/usr/bin/sudo` → "Operation not permitted"; non-setuid binaries and escalated file
writes work). Coordinator informed with exact command + error; options with Albert. Until it clears:
no glass-wp instance, no light/dark × on/off screenshots into review/glass-v1/wallpaper/, no real
window measurement, no fingerprint lines in RELEASE-PROGRESS.md (the file must only carry real runs).

## Open issues for the checklist

1. DSH-Test verification pending (blocker above) — DESIGN.md's "Before you push" last two boxes are
   NOT ticked yet.
2. `[data-slot="main"] [class$="_page"]` also glasses the Plugins page — that decides DESIGN.md's
   open question "DSH's own pages under Wallpaper" for that page. If Albert wants it on the wall,
   narrow the anchor to `[data-testid="task-manager-page"]`.
3. Dockkit's `emptyTabHost` paints `--dsw-alias-bg-base` (a pane open with zero tabs); not skinned —
   did not occur in the live screenshots, and it is the same class of fix if it ever shows.
4. `overrideTokens` needs the theme service: if `ctx.get("theme")` is missing it warns and leaves
   DSH's labels alone (no hard failure).
