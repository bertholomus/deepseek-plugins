#!/usr/bin/env node
/**
 * Which notes Canon gives a prompt, on its labelled sets, as the README
 * reports it (test/helpers/canon-relevance.mjs measures):
 *
 *     node scripts/canon-relevance.mjs                     # a table per set
 *     node scripts/canon-relevance.mjs --set dev           # one set only (dev, fresh, holdout or holdout2)
 *     node scripts/canon-relevance.mjs --set dev --misses  # and each prompt it got wrong
 *
 * The dev set is dev.json and dev-fresh.json; `fresh` is dev-fresh.json
 * alone. `--misses` lists a hold-out's misses only when that hold-out is
 * named with `--set`: its prompts are never tuned on, so they are not
 * shown by chance.
 */
import { existsSync } from 'node:fs';
import { DEV, DEV_FRESH, HOLDOUT, HOLDOUT2, belowFloors, groupText, groups, loadDev, loadSet, measure, missText, table } from '../test/helpers/canon-relevance.mjs';

const SETS = [
    ['dev', 'Dev set (tuned on: dev.json and dev-fresh.json)', DEV, loadDev],
    ['fresh', 'Fresh dev prompts (dev-fresh.json, part of the dev set)', DEV_FRESH, () => loadSet(DEV_FRESH)],
    ['holdout', 'First hold-out (never tuned on)', HOLDOUT, () => loadSet(HOLDOUT)],
    ['holdout2', 'Second hold-out (never tuned on)', HOLDOUT2, () => loadSet(HOLDOUT2)],
];
const DEV_KEYS = new Set(['dev', 'fresh']);
const args = process.argv.slice(2);
const only = args.includes('--set') ? args[args.indexOf('--set') + 1] : '';
if (only && !SETS.some(([key]) => key === only)) {
    console.error(`--set takes ${SETS.map(([key]) => key).join(', ')}`);
    process.exit(2);
}
const sets = SETS.filter(([key, , file]) => (!only || only === key) && existsSync(file));
if (sets.length === 0) {
    console.error(only ? `There is no ${only} set yet.` : 'There is no set yet.');
    process.exit(1);
}
for (const [key, name, , load] of sets) {
    const m = await measure(load());
    console.log(table(name, m));
    const by = [...groups(m)].map(([group, g]) => groupText(group, g));
    const kinds = m.rows.some((r) => r.kind);
    console.log(`\nBy ${kinds ? 'kind' : 'the letters of the ids'} (each group's own prompts; the table's notes per block that do not answer count only the blocks of prompts a note answers, so the notes given to prompts no note answers are counted apart here): ${by.join('; ')}.`);
    const below = belowFloors(m);
    console.log(below.length ? `Below the floors: ${below.join('; ')}.` : 'Every floor met.');
    if (m.problems.length) console.log(`\nProblems with the set:\n  ${m.problems.join('\n  ')}`);
    if (args.includes('--misses') && (DEV_KEYS.has(key) || only === key)) {
        console.log(m.misses.length ? `\nMisses (${m.misses.length}):` : '\nNo misses.');
        for (const r of m.misses) console.log(missText(r));
    }
    console.log('');
}
