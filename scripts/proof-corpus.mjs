#!/usr/bin/env node
/**
 * Proof's measured rates on its labelled corpora, as the README reports them:
 *
 *     node scripts/proof-corpus.mjs          # one row per corpus
 *     node scripts/proof-corpus.mjs --misses # and each case it got wrong
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEV, HOLDOUT, LABELS, SEEN, SEEN2, loadCorpus, measure, table } from '../test/helpers/proof-corpus.mjs';

const rows = [];
const all = [];
for (const [name, dir] of [['Dev (tuned on)', DEV], ['First hold-out (measured once, then tuned on)', SEEN], ['Second hold-out (measured once, then tuned on)', SEEN2], ['Hold-out (never tuned on)', HOLDOUT]]) {
    if (!LABELS.every((label) => existsSync(join(dir, `${label}.json`)))) continue;
    const m = measure(loadCorpus(dir));
    rows.push(table(name, m));
    all.push([name, m]);
}
console.log('| Corpus | Turns with evidence or no claim | Flagged anyway (false flags) | Turns with an unshown or wrong claim | Flagged (caught) | Wrong claims called contradicted |');
console.log('|---|---|---|---|---|---|');
for (const row of rows) console.log(row);
if (process.argv.includes('--misses')) {
    for (const [name, m] of all) {
        for (const miss of m.misses) console.log(`\n[${name}] ${miss.label} ${miss.id}\n  ${miss.claims.join('\n  ') || '(no claim found)'}`);
    }
}
