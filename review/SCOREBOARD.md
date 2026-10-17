# Scoreboard (Suite v1)

Each plugin is judged by a fresh, independent judge that did not write it. The judge builds the head in a DSH Test
instance, exercises the plugin, shoots light and dark, and scores 0 to 10 on five criteria. Score = min(usefulness,
reliability, mean of all five). A plugin passes at >= 8.5 with no criterion below 8. Scorecards are in
`review/<plugin>-round-N.md`, screenshots in `review/<plugin>-round-N/`.

| Plugin | Round | Useful | Reliable | UX | Tests | Docs | Mean | Score | Commit | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Autopilot | 1 | 8.5 | 8 | 7.5 | 8.5 | 7.5 | 8.0 | 8.0 | bfe737c | NOT YET: a stopped host half shows a raw HTTP 404; config errors never reach the person; no settings form; holds unexplained ([scorecard](autopilot-round-1.md)) |
| Autopilot | 2 | 8.5 | 8 | 8 | 8.5 | 8.5 | 8.3 | 8.0 | 268f67c | NOT YET: an approval cut off by a restart holds its session for ever; one arrow key changes a rule and focus drops; DSH's question box reads as running; the form does not flag the wrong value; "Could not disable" toast; amber words at 2:1 ([scorecard](autopilot-round-2.md)) |
| Autopilot | 3 | 9 | 8.5 | 8 | 8.5 | 9 | 8.6 | 8.5 | ea10517 | PASS: every "delivered" claim and goal start proven in the real model's logs over 4 restarts; minor: a question open across a stop is asked again each start, focus after Try again, two small contrast misses ([scorecard](autopilot-round-3.md)) |
