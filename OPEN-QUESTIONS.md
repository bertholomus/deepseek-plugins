# Open questions (Suite v1)

Each open choice gets one line: the question, the pick, and why. The builder keeps going on the pick; Albert reviews these after the suite ships.

| # | When (PT) | Question | Pick | Why |
| --- | --- | --- | --- | --- |
| 1 | 2026-10-16 21:05 | `dshlane` has no `dsh-plugin-suite` project, so `--project dsh-plugin-suite` is refused. Edit the shared `~/.local/bin/dshlane`? | No. Helpers start with `dshb new --ws ~/Projects/dsh-plugin-suite` on the Flash lane at effort max, which is what `dshlane run auto` picks for every shape today. | A shared tool on the Mac is outside this brief; the result is the same lane, model and effort. |
| 2 | 2026-10-16 21:05 | Which two DSH versions are "both installed versions"? The Mac has DeepSeek Harness 0.2.0-rc.2 (the live app, also what DSH Test runs) and the older DSH Desktop 2.0.15 (runtime 0.1.x, a different plugin API). | The real-DSH e2e tests run on 0.2.0-rc.2 and on npm 0.2.1-rc.1 (the `next` tag), both installed under the gitignored `.e2e/`. DSH Test runs the installed 0.2.0-rc.2. | DESIGN.md targets 0.2.0 and 0.2.1; the 0.1.x app has no slots for these plugins. |
| 3 | 2026-10-16 21:05 | The repo's naming scan (`test/coordinator.test.js`) fails on `briefs/SUITE-BRIEF.md`, which quotes the brand rule itself. | Skip `briefs/` in the scan, as it already skips `HANDOFF.md`. | The brief is Albert's and MiniMe's planning text, not plugin code, UI text or a README. |
| 4 | 2026-10-16 21:05 | Agent Terminals must offer presets for well-known coding-agent CLIs, but plugin files may not name one vendor's CLI. | Presets describe how a CLI resumes and where it keeps transcripts, as templates over the command name (for example `~/.{command}/projects/{folder}`), and the user names the command in the settings. | Every CLI gets one-click setup, and no vendor name appears in code, UI text or docs. |
