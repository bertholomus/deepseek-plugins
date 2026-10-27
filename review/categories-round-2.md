# Categories: judge round 2

Commit a8be48e (branch `goal95/categories`, GOAL95 PASS 2), judged Mon 2026-10-26, 8:39 to 9:01 PM and 11:38 to 11:48 PM PDT (the account's usage limit stopped the judge in between). DSH Test instance g95-categories-j3 (installed app, DSH 0.2.1-rc.3), GLM-5.3-Flash-EXL3 asked for; the owner gateway answered with DeepSeek-V4.1-Flash-1017 (see What I ran). GOAL95 bar: 9.5 with no criterion below 9.

| Criterion | Score | Why, in one line |
| --- | --- | --- |
| Usefulness | 9.0 | Everything the README promises works for a handful of workspaces, but at this stack's scale (67 workspaces) "Add a workspace" lists the free ones above the top of the window, out of reach. |
| Reliability | 9.0 | Changes undone and refused when they can't be saved, wrong settings counted and named, restarts repeat nothing, 66 and 69 real-DSH checks on three builds; but a store that can't be read is written over by the first change while the page says it will be kept. |
| UX / polish | 8.5 | DSH's own parts, glass, light, dark, 760 px and dialogs that give the keyboard back are good, but the long submenu overflows, a cut header's tooltip sticks on screen after a menu move, and a menu move drops the keyboard to the page. |
| Test depth | 9.0 | 18 host, 29 window and 66/69 real-DSH checks that prove what they claim (a chat held running, a failed save in the window, Wallpaper beside it); nothing covers an unreadable store, many workspaces, or a move from a header's menu. |
| Docs | 9.0 | Clear parts per place in the window, config table, off, rollback, setup and test counts that matched; but it says an unreadable store is kept, which the code does not do. |

Plugin score: min(U, R, mean) = min(9.0, 9.0, 8.9) = 8.9. Verdict: NOT YET.

## What I ran

- Head: `git archive a8be48e` into `~/Projects/goal95/judge/categories-r2/head`, `.e2e` linked. `npm test`: 865 tests, 861 pass, 0 fail, 2 skipped, 2 todo (88 s). The plugin's own files alone: `test/categories-host.test.js` 18/18, `test/categories.test.js` 29/29, as the README says.
- `node scripts/e2e.mjs categories` (8:40 to 8:52 PM, my slot): 66 passed, 0 failed on DSH 0.2.0-rc.2 (169 s), 0.2.1-rc.1 (271 s) and the app's 0.2.1-rc.3 (202 s); live DSH unchanged. Every "beside Wallpaper" check ran (live's 5b4d1eb copied read only).
- `COORDINATOR=1 node scripts/e2e.mjs categories` (from 8:52 PM): 69 passed, 0 failed on each build (225, 250, 148 s); live DSH unchanged. No late DSH dialog came in either run, so the e2e's new click-past path was not seen firing.
- DSH Test g95-categories-j3: `up`, `load head/plugins/categories` alone (as the handover says), `restart`, `doctor`: 0 errors, isolation ok. Before any turn I set my test profile's access preset to Workspace Write; the turn's events show `permission/preset workspace-write`. Six workspaces made through the session bridge without turns, later 60 more (67 in all).
- One real-model turn (storefront chat, 8:45:23 to 8:49:30 PM, completed). Its `responseModel` was DeepSeek-V4.1-Flash-1017, so I sent no more real-model turns and used the e2e's scripted model (which holds a chat running) for the running dots. An environment fact, not scored; it also means I did not repeat round 1's restart under a running turn.
- In my own Playwright window on the instance (scripts in my judge folder), light and dark, 1280 and 760 px, by mouse and by keyboard: the empty list, New category… from Other workspaces' ⋯ and by Shift+F10, Add a workspace, a name already in use ("  shop "), a long name, folding by click, Enter, Space, ← and →, ↑ and ↓ between headers, Alt+↑ and Alt+↓ in the list and on the page, Move up and Move down from a header's menu, drags (a row onto a header, a header onto a header, and back), Rename… and Delete… by keyboard, the page (tree keys, find, a workspace's menu, Move to, New category with it… by keyboard and by mouse, deletes), the chip (a rename follows it, a click opens the page), a failed save (`categories.json.tmp` made a folder), `enabled: "no"` and `projectsStoreFile: 42` applied live, a store made unreadable (mode 000) and a first change after it, and 67 workspaces (fold times, every workspace listed, the submenu measured).
- `scripts/import-preview.mjs` against my test home (read only).
- Instance destroyed and slot given back at 11:44 PM; no process of mine left running.

## What I saw (each picture, one line)

Pictures in `review/categories-round-2/`: `j-*` from my instance, `e2e-app-*` from my e2e run on the app's DSH.

- `j-01`, `j-02`: no categories yet: Other workspaces heads DSH's list with its count (light, dark).
- `j-03`: New category… asks for a name and says what happens next.
- `j-04`: Add a workspace: every row named, a folder icon each.
- `j-05`: "  shop " refused under the field: "There is a category named Shop already.", the keyboard still in it.
- `j-06`, `j-07`: three categories and Other workspaces, Shop focused with the ring; a cut header's tooltip left on screen after Add a workspace (finding 3).
- `j-08` to `j-10`: folded workspace and folded category after the real turn had ended: no dot, rightly (the running dot is in `e2e-app-sidebar-running-*`).
- `j-11`: after ⋯ > Move up by mouse, the tooltip "Experiments with quantized kernels and other long things" stays at the header's old place, beside another header, after the mouse moved away and clicked the main pane (finding 3).
- `j-12`, `j-13`: the Categories page on its glass card, light and dark, each row saying what it is, Default workspace by DSH's name.
- `j-14`: Shift+F10 on a session row on the page: no menu, as the README says (sessions have none).
- `j-15`, `j-16`: find keeps Local Model Recipe and its workspaces; no match says so.
- `j-17`, `j-18`: the chip "Shop / storefront" among DSH's header buttons, light and dark.
- `j-19` to `j-21`: 760 px: DSH's rail, the page without a sideways scroll (scrollWidth 704 = clientWidth); the long row note cut at a letter (finding 7).
- `j-22`: a rename that can't be saved, refused in the dialog in words, the keyboard in the field.
- `j-23`: Move down from a header's menu that can't be saved: DSH's banner says "Not saved: … so nothing changed".
- `j-24`, `j-25`: the page's "Not saved" note, light and dark; the next change saved and the note went.
- `j-26-off-no-*`, `j-27-off-no-page`: `enabled: "no"` live: no headers; the page names the setting and says the categories are off and how to switch them on.
- `j-26-wrongtype-sidebar`, `j-27-wrongtype*`: `projectsStoreFile: 42`: the page names it and keeps the categories; the first window, opened within seconds of the live reload, drew DSH's plain list until the plugin had reloaded (`j-26-wrongtype2` a moment later has the headers).
- `j-28`: a store made unreadable: the page says the categories started empty and "the first change keeps it beside the new store", with the first-category hint.
- `j-29`: after that first change: one category, the note gone, and on disk no kept file (finding 1).
- `j-30`: after drags of a row and a header, each said.
- `j-31`: a workspace's menu on the page (Move to, New category with it…, Move up, Move down).
- `j-32`: Delete… opens on Cancel and says the workspace goes to Other workspaces.
- `j-33`, `j-34`: 67 workspaces: the list by category; find on the page.
- `j-35`, `j-36`: Add a workspace with 67 workspaces: the submenu runs off the top of the window; by keyboard the focused row is off screen (finding 2).
- `e2e-app-sidebar-running-workspace-light`, `e2e-app-sidebar-running-folded-*`: a chat held running by the scripted model: DSH's spinner on the folded workspace's row and on the folded category's header.
- `e2e-app-wallpaper-page-*`: beside Wallpaper: one glass card, one blur (round 1's finding 3 fixed).
- `e2e-app-page-not-saved-*`, `e2e-app-page-store-unusable-light`, `e2e-app-page-store-kept-light`: the store notes on the app's DSH.
- `e2e-app-off-light`: switched off from Plugins: DSH's list as DSH draws it, no Categories entry, no chip.

## Findings (most severe first)

1. **Major (reliability): a store that can't be read is written over by the first change, though the page says it will be kept.** Where: `lib/store.js`: `load()` leaves `text` undefined when `readFileSync` throws, and `save()` keeps a copy only when `this.unusable.text !== undefined`, then `writePrivate` renames the new store over the old file; `lib/categories.js` `storeNote()` tells every unusable store "The file is left as it is: the first change keeps it beside the new store"; the README ("How it works") says the same for "unreadable". Repro in my instance: a store with three categories (1162 bytes) set to mode 000, DSH restarted: the page promised to keep it (`j-28`); New category "Fresh start" on the page: the folder then held only the new 289-byte store and the log, no `categories.json.unreadable-*`, and the note was gone (`j-29`). Only the log said "a change writes a new store over it". A store left unreadable (for example owned by root after a sudo run) loses the owner's categories with the window saying the opposite. Fix: move such a file aside with `renameSync(file, file + '.unreadable-<time>')` (a rename needs no read permission) before writing, or refuse changes until it can be read; make the note say what really happens; add a host test with a mode-000 store.
2. **Major (UX, at this stack's scale): "Add a workspace" lists every workspace in one submenu that neither fits nor scrolls.** Where: `lib/client.js`, `CategoryMenu`'s `add` submenu, drawn by DSH's Menu (also on the page's category rows). With 67 workspaces at 1280 x 860 the submenu is 2252 px tall, drawn from y = -1621 to 631 (`overflow: visible`, no max-height, nothing in it scrolls). The workspaces in no category, which it lists first (newest first, as DSH lists them) because they are the ones to add, are above the window: bulk-60 to bulk-14 can't be reached by mouse, and by keyboard the focused row leaves the screen (after 40 presses of ↓, bulk-21 sits at y = -291) (`j-35`, `j-36`). It starts at about 25 workspaces in an 860 px window. A drag or the page's Move to still files a workspace, but the menu the README leads with does not. Fix: list at most 10 to 15 free workspaces and end with "More…", which opens a dialog with a find field and the whole list (or the Categories page at that category); or give this plugin's submenu a max-height (such as `min(60vh, 420px)`) with `overflow-y: auto`. Add an e2e check with about 60 workspaces that every row can be reached and is in view when focused.
3. **Minor (UX): a cut header's tooltip sticks on screen after its menu moves it.** Where: `lib/client.js`, `CategoryHeader` (`h(ui.Tooltip, { label: group.name, side: 'right', portal: true, disabled: cut === null }, …)`). By mouse, ⋯ > Move up or Move down on a header whose name is cut: DSH's tooltip with the whole name stays where the header was, now beside another header, through Escape, a scroll, pointing at other headers, a click in the main pane and opening a chat; only pointing at that header again clears it (`j-11`; also seen after Add a workspace in `j-06`, `j-07`). Likely cause: the header is placed anew while its tooltip is open and the focus falls to the page, so the tooltip never gets its close. Fix: hold the tooltip's open state in the header and close it when the header's menu opens or the header moves (or key the tooltip on the header's order); add a window check.
4. **Minor (keyboard): Move up and Move down from a header's menu drop the keyboard to the page.** Shift+F10, ↓ to Move down, Enter: the category moves and `document.activeElement` is `<body>`; the keyboard user starts again from the top of the window. Alt+↑ and Alt+↓ on the same header keep it, and every dialog now gives it back. DESIGN.md §9: "When something closes, focus goes back where it was." Where: `SidebarTree`'s `actions.move` with `CategoryMenu`. Fix: once the move is answered, focus the moved header (the `refocus` path the dialogs use) and check it in the window tests.
5. **Minor (words, screen readers): in the session list a move that can't go further says nothing.** Alt+↑ on the first category or Alt+↓ on the last changes nothing and announces nothing (the status region keeps the last message), where the page says "Shop is first already.". The README: "When a change can't be made, the plugin says why." Where: `actions.move` returns silently when `at + by` is out of range. Fix: announce the page's `firstAlready` and `lastAlready` words there too.
6. **Nit:** the ⋯ buttons are named "Category actions: Shop" and "Workspace actions: checkout-api", but "Actions for Other workspaces". One pattern reads better in a screen reader's list of buttons.
7. **Nit:** at 760 px a category row's note is cut at a letter ("Category · 1 worksp…", `j-20`); cut it at a word or let it wrap.
8. **Nit:** a refused move's note on the page ("Shop is first already.") stays at the top through later finds and moves until another message replaces it; clear it at the next key or after a few seconds.
9. **Nit:** `writePrivate` renames its temp file without an `fsync`: safe if DSH crashes, not if the Mac loses power mid-write. `fsyncSync` on the temp file before the rename closes that.
10. **Nit:** with no projects store at all, the import preview says "The categories already came over from the projects plugin (…): 0 categories, 0 workspaces"; "There was no projects store; nothing came over" is what happened.

### Round 1's findings at a8be48e

1. Blank rows in Add a workspace: **fixed** (every row named, taken ones say where they are now; e2e checks it on three builds; `j-04`). At scale the same submenu overflows (finding 2).
2. A failed save announced as done: **fixed** (undone and refused in words, DSH's banner for a menu change, the page's note until a change saves; `j-22` to `j-25`, e2e).
3. Card in a card under Wallpaper: **fixed** by the e2e's Wallpaper section on all three builds (live's 5b4d1eb; one card, one blur, light and dark). I did not load Wallpaper in my instance.
4. Focus dropped after every dialog: **fixed** for dialogs (Escape, Enter, a refusal, a delete, New category with it…); the same gap remains for a header menu's Move up and Move down (finding 4).
5. Two categories with one name: **fixed** (case, spaces; "  shop " refused).
6. A cut header with no tooltip, cut mid-word: **fixed** (cut at a word, whole name in DSH's tooltip on hover and focus), with the new stuck tooltip (finding 3).
7. Coordinator e2e flaky: **fixed** as far as I saw: 69/0 on all three builds, no late dialog in my runs.
8. No next step on an empty page: **fixed** (the hint in `j-28`).
9. Import note for categories the projects plugin made: **fixed** by its host test; not seen in a window (no such store in my instance).
10. `enabled: "no"` counted as on: **fixed** (off, named, warned once; `j-27-off-no-page`).
11. Raw workspace id in the preview: **fixed** by its host test; my preview had nothing to name.
12. Raw "default-workspace" on the page: **fixed** ("Default workspace").
13. README dense, restart vs live: **fixed** (short parts per place; both reload paths said).

What I could not check: a restart under a running real-model turn (no real-model turns after the first; the e2e restarts without one), a chat waiting on an approval, New workspace… to the end (the Desktop's native folder picker), touch, a subagent's or teammate's chip.

## What would make it a 9.5

- Finding 1: never write over a store that can't be read (move it aside or refuse), make the page's note true, and test it.
- Finding 2: an Add a workspace that works with 60 or more workspaces, with an e2e check at that size.
- Findings 3 to 5: the tooltip closes when its header moves, the keyboard stays on a header moved from its menu, and the list says "first already" or "last already"; window checks for each.

## Live DSH fingerprint (before and after)

- Before (8:39 PM PDT): pid 64099, started Mon Oct 26 15:35:11 2026, patch sha256 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be. A private copy of the live `cordis.patch.yml` was kept in my judge folder (not here).
- On resuming (11:38 PM PDT): the same pid, start time and sha256.
- After (11:44 PM PDT): pid 64099, started Mon Oct 26 15:35:11 2026, patch sha256 535e6390a2162bbce1026d91fd4e7df94088f5f72125e4d451e18c1c42b655be. Unchanged; both e2e runs also reported it unchanged. The sha did not move during my run, so there was nothing to diff (the 7:28 PM agent-default-model edit was before it).
- DSH Test g95-categories-j3 destroyed at 11:44 PM PDT; my slot given back; no process of mine left running.
