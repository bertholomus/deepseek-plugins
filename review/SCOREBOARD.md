# Scoreboard (Suite v1)

Each plugin is judged by a fresh, independent judge that did not write it. The judge builds the head in a DSH Test
instance, exercises the plugin, shoots light and dark, and scores 0 to 10 on five criteria. Score = min(usefulness,
reliability, mean of all five). A plugin passes at >= 8.5 with no criterion below 8. Scorecards are in
`review/<plugin>-round-N.md`, screenshots in `review/<plugin>-round-N/`.

| Plugin | Round | Useful | Reliable | UX | Tests | Docs | Mean | Score | Commit | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Autopilot | 1 | 8.5 | 8 | 7.5 | 8.5 | 7.5 | 8.0 | 8.0 | bfe737c | NOT YET: a stopped host half shows a raw HTTP 404; config errors never reach the person; no settings form; holds unexplained ([scorecard](autopilot-round-1.md)) |
