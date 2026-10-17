SUITE1-1017 kickoff. New work: start ONE thread in this project named "Suite v1 builder". It works in ~/Projects/dsh-plugin-suite (git worktree of bertholomus/deepseek-plugins, branch suite/v1). First check: `cd ~/Projects/dsh-plugin-suite && git log --oneline -2 && ~/.local/bin/dsh-test status`. Then read briefs/SUITE-BRIEF.md in full and carry it out end to end.

Give the thread this as its /goal:

/goal Six DSH plugins (Autopilot, Decisions, Agent Terminals, Proof, Canon, Recall) built per briefs/SUITE-BRIEF.md, each scored >= 8.5/10 (no criterion below 8) by a fresh independent judge that exercised it in a DSH Test instance, each merged to main of the private repo bertholomus/deepseek-plugins and tagged <plugin>-v1.0.0, then suite-v1.0.0; review/SCOREBOARD.md lists every round; the live DSH fingerprint is unchanged from start to end. Albert's approval is not a gate. Test only in DSH Test, never the live DSH. Never stop on a question: log your pick in OPEN-QUESTIONS.md and continue. End with DONE: <scoreboard> <main commit> <tags>.

Delegate reading and mechanical work to local DSH helpers (dshlane run auto --shape ... --project dsh-plugin-suite); use subagents as judges. Update HANDOFF.md and push after every step.
