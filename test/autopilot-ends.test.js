// Autopilot's reading of a reply's end (plugins/autopilot/lib/ends.js): whether it waits on the person, so a
// nudge would talk over them. Measured on labelled endings (test/fixtures/autopilot/endings.json):
//
// - real: the last lines of 84 final replies from the suite's DSH Test sessions on 2026-10-26 (the stack's local
//   models, a few from the scripted model), labelled by hand;
// - judge-round-5: the nine endings round 5's judge probed;
// - written: 40 endings written for the rule, 20 that hand over and 20 that do not;
// - held-out-1: 44 endings written after the rule was frozen and measured once (0 false holds, 4 misses), then
//   used to widen the rule, so they count as development endings now;
// - held-out-2: 32 endings written after that and measured once (ends.js f22a4e0…): 0 false holds, 3 misses;
// - held-out-3: 30 endings written after one more change (advice such as "Run it if you want" is no offer) and
//   measured once with the rule as shipped (ends.js a5fa8b4…): 1 false hold, 2 misses. The README gives both.
//
// A false hold is an ending that does not wait on the person but holds the nudge (the session is left idle with
// its work open); a miss is one that waits on the person but gets the nudge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goesOn, handOverIn, handsOver, waitsOnPerson } from '../plugins/autopilot/lib/ends.js';
import { asksSomeone } from '../plugins/autopilot/lib/shared/words.js';

const sets = JSON.parse(readFileSync(new URL('./fixtures/autopilot/endings.json', import.meta.url), 'utf8'));

/** False holds and misses of a rule over a set of labelled endings. */
function measure(items, rule) {
    const out = { endings: items.length, waits: 0, falseHolds: [], misses: [] };
    for (const item of items) {
        if (item.hold) out.waits += 1;
        const held = rule(item.text);
        if (held && !item.hold) out.falseHolds.push(item.text);
        if (!held && item.hold) out.misses.push(item.text);
    }
    return out;
}

const rate = (n, of) => `${n} of ${of} (${of ? Math.round((100 * n) / of) : 0}%)`;

test('the corpus: real endings from DSH Test, the judge\'s nine, written ones and three held-out sets, each labelled', () => {
    assert.deepEqual(Object.keys(sets), ['real', 'judge', 'written', 'heldOut1', 'heldOut2', 'heldOut3']);
    assert.equal(sets.real.length, 84);
    assert.equal(sets.judge.length, 9);
    assert.equal(sets.heldOut2.length, 32);
    assert.equal(sets.heldOut3.length, 30);
    for (const [name, items] of Object.entries(sets)) {
        for (const item of items) {
            assert.equal(typeof item.text, 'string', name);
            assert.ok(item.text.trim().length > 0, name);
            assert.equal(typeof item.hold, 'boolean', name);
            assert.ok(item.text.split('\n').length <= 6, `${name}: the rule reads the last 6 lines, the corpus keeps no more`);
        }
    }
    // Both kinds in every set, so each rate means something.
    for (const items of Object.values(sets)) assert.ok(items.some((i) => i.hold) && items.some((i) => !i.hold));
});

test('the development endings: no false hold and no miss', (t) => {
    for (const name of ['real', 'judge', 'written', 'heldOut1']) {
        const m = measure(sets[name], waitsOnPerson);
        t.diagnostic(`${name}: false holds ${rate(m.falseHolds.length, m.endings - m.waits)}, misses ${rate(m.misses.length, m.waits)}`);
        assert.deepEqual(m.falseHolds, [], `${name}: false holds`);
        assert.deepEqual(m.misses, [], `${name}: misses`);
    }
});

test('the held-out endings, each set measured once: 1 false hold of 31 and 5 misses of 31, as the README says', (t) => {
    const two = measure(sets.heldOut2, waitsOnPerson);
    const three = measure(sets.heldOut3, waitsOnPerson);
    for (const [name, m] of [['held-out-2', two], ['held-out-3', three]]) t.diagnostic(`${name}: false holds ${rate(m.falseHolds.length, m.endings - m.waits)}, misses ${rate(m.misses.length, m.waits)}`);
    // A false hold leaves the session idle with its work open; a miss sends the nudge, which the agent can answer
    // with a DECISION NEEDED line.
    assert.deepEqual([...two.falseHolds, ...three.falseHolds], ['Let me know if you hit any snags.']);
    assert.deepEqual([...two.misses, ...three.misses], [
        'If you\'re OK with the rename, I\'ll update all the imports.',
        'I need the API token for the sandbox before I can go on.',
        'I can add retries as well, if that\'s useful.',
        'If it helps, I can draft the release notes too.',
        'I\'m holding off on the deploy until you confirm the maintenance window.',
    ]);
});

test('the suite\'s broad rule (asksSomeone: any offer in the last 6 lines) holds what this one does not, on the same endings', (t) => {
    let falseHolds = 0;
    let misses = 0;
    for (const [name, items] of Object.entries(sets)) {
        const m = measure(items, asksSomeone);
        falseHolds += m.falseHolds.length;
        misses += m.misses.length;
        t.diagnostic(`asksSomeone on ${name}: false holds ${rate(m.falseHolds.length, m.endings - m.waits)}, misses ${rate(m.misses.length, m.waits)}`);
    }
    // Round 5's four false holds among them.
    const judge = measure(sets.judge, asksSomeone);
    assert.deepEqual(judge.falseHolds, [
        'All tests pass. Happy to keep going with the next todo.',
        'I am happy to report the build is green. Moving on to the docs next.',
        'Feel free to review the diff; I will carry on with the remaining two todos.',
        'If you would like a different name, say so. Next up: the README.',
    ]);
    assert.equal(falseHolds, 31);
    assert.equal(misses, 31);
});

test('the judge\'s nine endings, one by one', () => {
    const want = {
        'Done with step 1 of 3. Next I will write the parser.': false,
        'Step 1 is done. Let me know if you want me to continue with steps 2 and 3.': true,
        'All tests pass. Happy to keep going with the next todo.': false,
        'I am happy to report the build is green. Moving on to the docs next.': false,
        'Wrote `a?b` regex in parse.js and the tests. Next: the CLI.': false,
        'Should I use Postgres or SQLite?': true,
        'DECISION NEEDED: which port? — recommend: 8080': true,
        'Feel free to review the diff; I will carry on with the remaining two todos.': false,
        'If you would like a different name, say so. Next up: the README.': false,
    };
    for (const [text, waits] of Object.entries(want)) assert.equal(waitsOnPerson(text), waits, text);
});

test('the parts: which sentence hands over, what says the agent goes on, and what is only a courtesy', () => {
    assert.equal(handOverIn('Step 1 is done. Let me know if you want me to continue with steps 2 and 3.'), 'Let me know if you want me to continue with steps 2 and 3.');
    assert.equal(handOverIn('Wrote the parser.\n\n**Say the word** and I\'ll run the tests.'), 'Say the word and I\'ll run the tests.');
    assert.equal(handOverIn('- Want me to apply it? No: plain words only.'), undefined, 'a question is asksForAnswer\'s, not a hand-over');
    assert.equal(handOverIn('Let me know if you want me to keep the flag.\nNext: the README.'), undefined, 'the last line goes on');
    assert.equal(handOverIn('Let me know if this looks good, and I\'ll move on to the tests.'), 'Let me know if this looks good, and I\'ll move on to the tests.', 'a last line that goes on only after the person');
    assert.equal(handsOver('Let me know if you have any questions.'), false);
    assert.equal(handsOver('Let me know if you want me to fix anything else.'), true, 'a courtesy that still asks about the next step');
    assert.equal(handsOver('If you want a stricter check, use ==.'), false, 'advice');
    assert.equal(handsOver('If you want, I can add the check.'), true);
    assert.equal(handsOver('Happy to try another colour next.'), true);
    assert.equal(handsOver('Happy to keep going with the next todo.'), false);
    assert.equal(goesOn('Next up: the README.'), true);
    assert.equal(goesOn('I will carry on with the remaining two todos.'), true);
    assert.equal(goesOn('Moving on to the docs next.'), true);
    assert.equal(goesOn('The build is green.'), false);
    assert.equal(handsOver('Run make bench if you want more numbers.'), false, 'advice to the person');
    assert.equal(handsOver('You can rerun it with --verbose if you like.'), false);
    assert.equal(handsOver('I can add retries if you want.'), true, 'an offer');
    for (const empty of [undefined, null, '', '   ', 42]) {
        assert.equal(waitsOnPerson(empty), false);
        assert.equal(handOverIn(empty), undefined);
    }
});
