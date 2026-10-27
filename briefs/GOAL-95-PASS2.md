From Albert, 6:35 PM PT (relayed by MiniMe): "Promote reasoning pill - Give all other plugins one more pass"

1. Reasoning Pill: MiniMe has done it. d24800a is merged into claude/split-plugins as 909ac14, which the live DSH runs, and pushed to tank. Do not touch Reasoning Pill.

2. The other 19 plugins get ONE more pass each. Same rules as GOAL95: briefs/GOAL-95-1026.md, judge per ~/Projects/goal95/briefs/JUDGE-GOAL95.md, bar >= 9.5 with no criterion below 9.
   - Start each plugin from its goal95/<plugin> branch at the commit in review/GOAL95-RESULT.md.
   - Fix the "Top remaining finding" in GOAL95-RESULT.md plus the rest of that plugin's latest scorecard.
   - Then run ONE fresh independent judge round. Save it as review/<plugin>-round-<N>.md. Do not start a second fix round.
   - Any order. Run as many in parallel as the slots allow.
   - New branches or commits on goal95/<plugin> only. Test in DSH Test only, never the live DSH. Push after each step. dna-studio stays a local copy.
   - Fleet: build on goal95/fleet and take in claude/split-plugins first (it has MiniMe's 306946a, 8f7eb16, 7fbe549, 55e494c and the Reasoning Pill merge 909ac14). Do not undo them.
   - If the usage limit stops you, wait and resume. Do not drop plugins.

3. When every plugin has its pass-2 scorecard, write review/GOAL95-PASS2.md in the same table form as GOAL95-RESULT.md: score before, score after, commit, branch, verdict, top remaining finding. Commit it, push it, then stop. Nothing deploys to the live DSH; MiniMe deploys after Albert's OK.
