# Categories: judge round 1

Commit 70977a1 (branch `goal95/categories`), judged Mon 2026-10-26, 2:36 to 3:10 PM PDT. DSH Test instance g95-categories-j1 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3, every turn in Workspace Write. GOAL95 bar: 9.5 with no criterion below 9.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.5 | Everything the README promises worked for a many-workspace owner: headers, folding, dots, menus, drags, keyboard moves, the page with find, the chip beside the coordinator, and an exact one-time import. |
| Reliability | 9.0 | Import exact, nothing repeated over four restarts (one under a running turn), wrong rows warned once, `enabled: false` wrote nothing; but a save that fails is announced as done and lost at the next restart. |
| UX / polish | 8.0 | DSH's own parts, light, dark, 760 px and keyboard are good, but "Add a workspace" shows two blank menu items, the page is a card in a card under live Wallpaper, and focus drops to the page after every dialog. |
| Test depth | 8.5 | 16 host and 24 window tests and a 47-check real-DSH run on three builds; but a stand-in Menu hid the blank-item bug, there is no Wallpaper-on run or failed-save window check, and the coordinator run is flaky under load. |
| Docs | 9.0 | Complete and accurate (config table, off, rollback, setup, tests, counts that matched), but very dense, and it says a row edit needs a restart where DSH Test applied it at once. |

Plugin score: min(U, R, mean) = min(9.5, 9.0, 8.8) = 8.8. Verdict: NOT YET.

## What I ran

- Head: `git archive 70977a1` into `~/Projects/goal95/judge/categories-r1/head`, `.e2e` linked. `npm test`: 858 tests, 854 pass, 0 fail, 2 skipped, 2 todo (as the builder said).
- `node scripts/e2e.mjs categories` (slot `g95-categories-j1-e2e`): 47 passed, 0 failed on DSH 0.2.0-rc.2 (58 s), 0.2.1-rc.1 (83 s) and the app's 0.2.1-rc.3 (67 s); live fingerprint unchanged.
- `COORDINATOR=1 node scripts/e2e.mjs categories --dsh app`, twice. First run: 33 passed, 6 failed: DSH's own Preview Notice opened late, after the harness's quiet period, and its mask took the clicks of six window sections (pictures in `.e2e/shots/categories/app-0.2.1-rc.3/failed-*.png`). Second run: 50 passed, 0 failed.
- DSH Test g95-categories-j1: seeded, default access preset set to Workspace Write in my test profile before any turn, nine workspaces made through the session bridge, a projects store with four categories (one name with emoji and CJK, one placement of a workspace that does not exist) and an old-sidebar file naming a deleted category put in the test home, then Categories loaded alone and DSH restarted. Later: the coordinator from the same head and Wallpaper as live runs it (5b4d1eb) beside it, 60 more workspaces (71 in the list), and four restarts in all.
- Real model, three turns: a 300-word answer in ml-lab (298 s, completed) with its category folded while it ran; a shell `touch` in docs-site (completed, no approval asked under Workspace Write); a third turn interrupted by a restart on purpose.
- In my own Playwright window on the instance (driven by a script in my folder): every feature of the README's "In the window" section, by mouse and by keyboard, light and dark, 1280, 1024 and 760 px; DSH's search, In one list and Workspace Tree; switched off and on from the Plugins page; rows `enabled: "no"` and `enabled: false` (with a restart under it); a failed save (made `categories.json.tmp` a folder); no categories at all; duplicate names; a long name in the header and the chip.
- `scripts/import-preview.mjs` on my test home (after the move) and on a throwaway home (before it).

## What I saw (each picture, one line)

Pictures in `review/categories-round-1/`.

- `01-sidebar-light`: the imported categories over their workspaces, counts at the right, Other workspaces last.
- `02-research-folded-running-light`: Research & ML folded while the real model answered: DSH's spinner on the header, said as "running".
- `03-page-light`: the Categories page on its glass card, each row saying what it is; the import note at the top.
- `04-page-find-pay-light`, `05-page-find-none-light`: find keeps payments-api under Shop; no match says so, with the clear button.
- `06-page-alt-down-moved-light`: Alt+↓ moved payments-api, focus stayed on it, "payments-api moved down." in the status region.
- `07-sidebar-header-menu-light`: a header's menu opened by Shift+F10, the keyboard on its ⋯ with DSH's ring.
- `08-sidebar-add-workspace-submenu-light`: "Add a workspace": a blank row at the top and another between the two groups (finding 1).
- `09-sidebar-after-add-light`: scratch-play filed into Shop from that submenu.
- `10-rename-empty-refused-light`: a blank name keeps Rename greyed.
- `11-renamed-long-light`: a 110-character name clipped to 80 bytes at a word with "…".
- `12-delete-confirm-light`: Delete asks first, says the workspace goes to Other workspaces and nothing is deleted; Cancel has the focus.
- `13-drag-over-header-light`, `14-drag-over-row-light`, `15-drag-header-light`: drags of a row onto a header, a row onto another row (DSH's drop line above checkout-web) and a header above another, each said and kept in DSH's order.
- `16-chip-session-light`: "Research & ML / ml-lab" among the session's header buttons.
- `18-chip-session-dark-760`: the chip in dark at 760 px, the sidebar folded to DSH's rail.
- `19-page-dark-760`: the page at 760 px in dark, no sideways scroll (scrollWidth 704 = clientWidth).
- `20-page-sidebar-dark`, `21-sidebar-folded-focus-dark`: dark page and list; Shop folded by Enter with its inset ring.
- `22-plugin-off-light`: switched off in Plugins: no header, mark, class, style sheet or Categories entry left; on again drew one of each.
- `23-page-wrong-setting-note-light`: `enabled: "no"`: categories still shown, the page names the wrong setting and the fix; one warn line in the log.
- `24-page-enabled-false-light`: `enabled: false`: no headers or chip, the page says it is off and how to switch it on; store and log byte-identical before and after a restart.
- `25-sidebar-coordinator-wallpaper-light`: with the coordinator and Wallpaper on: the chip sits just before the coordinator's Coordinate; the list reads right on glass.
- `26-page-wallpaper-light`, `27-page-wallpaper-dark`: the page under live Wallpaper: two nested frames (finding 3).
- `28-new-workspace-dialog-light`: New workspace… started DSH's Add workspace, which in this window (as with DSH's own + button) opens no in-page dialog: the Desktop host's folder picker.
- `29-new-workspace-lands-in-other-light`: a workspace DSH added later lands in Other workspaces; DSH's order was put back in step within seconds.
- `30-save-failed-rename-light`: the store could not be written, yet the list and page show the new name and the window said "Renamed to Research NOT SAVED." (finding 2).
- `31-page-workspace-menu-light`, `32-page-move-to-submenu-light`, `33-new-category-with-it-dialog-light`: the page's workspace menu, Move to, and New category with it.
- `34-sidebar-70-workspaces-light`: 71 workspaces; folding Other workspaces took about 40 ms.
- `35-no-categories-light`: no categories: Other workspaces heads the list; the page has no word on what to do next (finding 8).
- `36-duplicate-name-light`: "Alpha" and "alpha" both made (finding 5).
- `37-chip-long-name-1280-light`, `38-chip-long-name-1024-light`, `39-chip-hover-1024-light`: a long chip gives way before the title and shows the whole path in DSH's tooltip; the header's cut name has none (finding 6).
- `40-dsh-search-no-headers-light`, `41-in-one-list-light`, `42-workspace-tree-light`: no headers in DSH's search and In one list; headers in Workspace Tree.
- `43-folded-running-before-restart-light`, `44-after-restart-interrupted-light`: a restart under a running turn: after it the turn reads interrupted, the folded header shows no stale dot, the fold is kept, nothing imported again.

## Findings (most severe first)

1. **Major (UX): "Add a workspace" draws two blank, nameless menu items.** Where: `lib/client.js`, `CategoryMenu`, the `add` submenu (`{ type: 'label', id: 'free', … }` and `{ type: 'label', id: 'taken', … }`). DSH's Menu draws label entries only at its top level; in a submenu it maps every entry to a `<button role="menuitem">` with `sub.label` (DSH 0.2.0-rc.2 `dsh-client-ui-primitives/lib/index.js`, the `entry.submenu.map` near line 4204; the same in the app's 0.2.1-rc.3, read in the live DOM). So "In no category" and "In other categories" show as empty rows, a screen reader hears two unnamed items, and clicking one closes the menu doing nothing. The same menu sits on the page's category rows. The window test (`test/client.mjs`, near line 1437) passes only because its stand-in Menu draws labels. Fix: put no label entries in a submenu (drop them, or use disabled items carrying the heading text), and add a real-window e2e check that opens the submenu and finds every menu item named.
2. **Major (reliability): a save that fails is announced as done, and lost at the next restart.** Where: `lib/store.js` `save()` returns false and only warns to the log; `categories.js` and `remote.js` ignore it, so the endpoint answers success and the window says "Renamed to …". Repro: `categories.json.tmp` made a folder (EISDIR), then a rename: list and page show the new name; the log says "could not save … the change holds until DSH restarts" (`30-save-failed-rename-light`). An unusable store is just as quiet in the window: the categories vanish with no word why (only the log says it). Fix: when `save()` fails, answer the change as `categories/failed` ("Not saved: … it holds until DSH restarts; the next change tries again"), and add the store's state to `list().problems` so the page names it, as it names a wrong setting. Test both in the window.
3. **Major (UX): under Wallpaper as live runs it, the page is a card inside a card.** Live Wallpaper (5b4d1eb) still has `body.wp-on .dshc-pg{background:var(--wp-conv)!important;backdrop-filter:blur(…);border:…;border-radius:18px;margin:…}`, written for the old page, so it paints this plugin's root, and the plugin's own `.dshc-pg-scroll` glass card sits inside it: two frames, tint .75 over .75 (about .94, so the wall barely shows) and a second blur (DESIGN.md rule 5, "Blur once"); see `26` and `27`. The builder skipped the Wallpaper check that DESIGN.md rule 12 asks for. Fix: rename the page root class (for example `.dshc-page`) so Wallpaper's old rule no longer matches it, or have Wallpaper drop that rule. Then check with Wallpaper on, light and dark, and keep that check in the e2e.
4. **Minor (UX, keyboard): focus drops to the page after every dialog.** After Rename…, Delete… or New category… is opened by keyboard (Shift+F10, ↓, Enter) and closed by Escape, Cancel or confirming, `document.activeElement` is `<body>`. The keyboard user has to start again from the top of the window. DESIGN.md §9: "When something closes, focus goes back where it was." Fix: focus the header or row (or its ⋯) before opening the dialog, so DSH's Modal captures it and gives it back; or focus it on close. Add a keyboard check.
5. **Minor: two categories can share a name.** "Alpha" and "alpha" were both made (`36`), though the old-sidebar import treats names that differ only in case as one category. Fix: refuse a name already used, ignoring case, under the field ("There is a category named Alpha already").
6. **Minor (UX): a cut header name has no tooltip and is cut mid-word** ("Platform engineering an…"). DESIGN.md §7 asks for a cut at a word with the whole text in a tooltip. The chip does this right. Fix: DSH's Tooltip on the header name when it overflows.
7. **Minor (tests): the coordinator e2e is flaky on a loaded machine.** DSH's Preview Notice can open after `openWindow`'s quiet period; its mask then fails six sections (my first run 33/6, rerun 50/0). Fix: dismiss DSH's notices, or wait for the mask to go, at the start of each window section.
8. **Minor (UX): with no categories, the page gives no next step** beyond its New category button (`35`). DESIGN.md §9 States: an empty state explains itself and offers a next step. Fix: one line under the heading, such as "Group workspaces into categories: New category makes one, then drag workspaces onto it in the session list."
9. **Nit:** the page's import note ("Imported from your old sidebar: Ops …") shows for a category that the projects plugin imported weeks earlier (`source: 'import'` came over with it). It is accurate but tells the owner nothing new. Show it only for categories this plugin's own import made.
10. **Nit:** `enabled: "no"` counts as on (documented, warned and named on the page). A string that plainly means off ("no", "off", "false", which unquoted YAML 1.2 `no` becomes) would be safer read as off.
11. **Nit:** the import preview prints a gone workspace as its raw id (`gone-workspace-id-123`). Say "a workspace DSH no longer has".
12. **Nit:** the page shows DSH's raw folder title "default-workspace" where DSH's list says "Default workspace".
13. **Nit (docs):** the README's Session list bullet is one 300-word paragraph: split it. It also says a row edit needs DSH's next start, but in DSH Test (profile `patchReload: live`) the `enabled` edit applied within seconds. Say both.

What I could not check: New workspace… to the end (choosing a folder needs the Desktop host's native picker, as DSH's own + does here; only the stand-in tests cover it); a session waiting on an approval (the shell turn ran without one under Workspace Write); a subagent's or teammate's chip; Wallpaper over a picture at a low tint.

## What would make it a 9.5

- Fix findings 1 to 4: no label entries in a submenu; a failed save or an unusable store said in the window; the page's root out of Wallpaper's old rule (one card, one blur); focus back on the header or row after every dialog.
- Fix 5, 6 and 8, then run real-window checks for each: the submenu's item names, Wallpaper on (light and dark, one frame), a failed save in the window, focus after Escape and after confirming. Make the coordinator e2e dismiss DSH's late notice.

## Live DSH fingerprint (before and after)

- Before (2:36 PM PDT): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55. A private copy of the live `cordis.patch.yml` was kept in my judge folder.
- After (3:03 PM PDT): pid 43210, started Mon Oct 26 07:14:47 2026, patch sha256 f240a78d8bd63d3f5748a6f2916af8958eb9df8dc49d2a84c8355af6533c0c55. Unchanged; each e2e run also reported it unchanged.
- DSH Test g95-categories-j1 destroyed at 3:03 PM PDT; both memory slots given back; no process of mine left running.
