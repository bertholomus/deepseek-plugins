/**
 * Which notes Canon gives a prompt, measured on labelled sets over the
 * fixture vault (frozen: the sets' answers are its paths), with Canon's own
 * recall exactly as a turn runs it (test/helpers/canon-relevance.mjs).
 *
 * The dev set is tuned on and held to the figures it reached. The two
 * hold-outs are written by fresh writers who never saw Canon's code or the
 * dev set, measured and never tuned on: the first (no kinds) is held to the
 * four floors of OPEN-QUESTIONS #29, the second (with kinds) to those and
 * the everyday-coding floor of #33. A hold-out's test prints its figures
 * only, never its prompts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DEV, FLOORS, HOLDOUT, HOLDOUT2, belowFloors, loadSet, measure, missText } from './helpers/canon-relevance.mjs';
import { isCodingRequest } from '../plugins/canon/lib/text.js';

/**
 * The dev set's figures as reached (README, "How well it picks notes"):
 * held so a change that makes them worse fails here.
 */
const DEV_REACHED = Object.freeze({ first: 480, inBlock: 493, extra: 182, noBlock: 312, coding: 232 });

/** The fixture vault's projects: a folder named for one is that project's. */
const PROJECTS = new Set(['harbor-gateway', 'lantern-api', 'lantern-web', 'quartz-cache', 'tide-ledger']);
const said = (text) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** A hold-out's figures in one line, for the test's output. */
function figures(name, m) {
    const a = m.summary.answerable;
    const u = m.summary.unanswerable;
    const c = m.summary.coding;
    const coding = c.n ? `; no block for ${c.noBlock} of ${c.n} everyday coding requests` : '';
    return `${name}: first note answers ${a.first} of ${a.n}; an answering note in the block ${a.inBlock} of ${a.n}; ${a.extra} notes that do not answer in ${a.blocks} blocks; no block for ${u.noBlock} of ${u.n}${coding}`;
}

test('dev set: every prompt has a kind; the round-2 judge\'s two sets, and questions and everyday coding requests of the builder\'s own; every answer an active note', async () => {
    const set = loadSet(DEV, { kinds: true });
    const of = (kind) => set.filter((e) => e.kind === kind);
    assert.ok(of('answers').length >= 200, 'at least 200 prompts a note answers');
    assert.ok(of('project').length >= 30, 'at least 30 questions about a project that no note answers');
    for (const kind of ['chat', 'vault']) assert.ok(of(kind).length >= 8, `at least 8 ${kind} prompts`);
    // The judge's sets, whole: judge-fixture (jf-, less one prompt that repeats a dev prompt word for word in its folder) and judge-generic (jg-).
    assert.ok(set.filter((e) => e.id.startsWith('jf-')).length >= 53, 'the judge\'s fixture set');
    assert.equal(set.filter((e) => e.id.startsWith('jg-')).length, 60, 'the judge\'s generic set');
    // The builder's own everyday coding requests (c01, q01, w01, …; w05 turned out to be one a note answers): from a
    // project's folder, an unrelated folder, and none; many asked as a question or told as a problem, not as an order.
    const mine = set.filter((e) => /^[cqw]\d+$/.test(e.id) && e.kind === 'coding');
    assert.ok(mine.length >= 110, `${mine.length} everyday coding requests of the builder's own`);
    const last = (folder) => folder.split('/').filter(Boolean).at(-1) ?? '';
    assert.ok(mine.filter((e) => PROJECTS.has(last(e.folder))).length >= 10, 'from a project\'s folder');
    assert.ok(mine.filter((e) => e.folder && !PROJECTS.has(last(e.folder))).length >= 10, 'from an unrelated folder');
    assert.ok(mine.filter((e) => e.folder === '').length >= 10, 'from a session with no folder');
    assert.ok(mine.filter((e) => !isCodingRequest(e.prompt)).length >= 40, 'asked as questions, not only as orders');
    assert.ok(of('coding').length >= 200, 'everyday coding requests in all');
    // The builder's own questions a note answers, asked the way a person asks (n01, m01, k01, …): mostly in other
    // words than the note's title, short, in a project's folder and in none or another.
    const asked = set.filter((e) => /^[nmk]\d+$/.test(e.id));
    assert.ok(asked.length >= 140 && asked.every((e) => e.kind === 'answers'), `${asked.length} questions of the builder's own`);
    assert.ok(asked.filter((e) => PROJECTS.has(last(e.folder))).length >= 40, 'in a project\'s folder');
    assert.ok(asked.filter((e) => !PROJECTS.has(last(e.folder))).length >= 40, 'in no folder or another');
    // And in other forms (s01, t01, i01, …): from a folder inside a project's folder, coding tasks a note answers,
    // requests to be told ("Run me through…"), "this repo", typos and lower case, long prompts, pasted errors,
    // other names for a project, short forms ("certs", "DB"); and prompts no note answers in the same forms (o01, x01, …).
    const inside = (folder) => folder.split('/').filter(Boolean).slice(0, -1).some((part) => PROJECTS.has(part));
    assert.ok(set.filter((e) => inside(e.folder)).length >= 20, 'from a folder inside a project\'s folder');
    assert.ok(set.filter((e) => /^[stideylhbg]\d+$/.test(e.id) && e.kind === 'answers').length >= 120, 'questions and tasks in other forms');
    assert.ok(set.filter((e) => /^[ox]\d+$/.test(e.id) && e.kind !== 'answers').length >= 30, 'and prompts no note answers in those forms');
    // Written after the rework, before they were measured (z01, zb01, zc01, …): one everyday word and a project's
    // name ("How do I run lantern-web?"), one word to define ("What's a standby?"), orders with no work verb
    // ("Page the platform on-call."), "remind me" and "any idea", numbers, people, tasks that name their project
    // from no folder; and prompts no note answers in those forms (zx01, zy01, zd01, …), "How do I run Kafka locally?".
    assert.ok(set.filter((e) => /^z[bc]?\d+$/.test(e.id) && e.kind === 'answers').length >= 100, 'the later forms');
    assert.ok(set.filter((e) => /^z[xyd]\d+$/.test(e.id) && e.kind !== 'answers').length >= 30, 'and prompts no note answers in them');
    // And one or two short questions for every active note, in other words than its title, on a word of its body or
    // headings, many in its project's folder (zp01, …), with questions no note answers asked the same way (zq01, …).
    const each = set.filter((e) => /^zp\d+$/.test(e.id) && e.kind === 'answers');
    assert.ok(each.length >= 60 && new Set(each.flatMap((e) => e.answers)).size >= 34, `${each.length} short questions, one or more for each note`);
    assert.ok(set.filter((e) => /^zq\d+$/.test(e.id) && e.kind !== 'answers').length >= 8, 'and questions no note answers asked the same way');
    // No prompt twice in one folder.
    const keys = set.map((e) => `${e.folder}\n${said(e.prompt)}`);
    assert.equal(new Set(keys).size, keys.length, 'a prompt repeats in its folder');
    // Every answer an active note, and a kind that fits its answers (measure() says when not).
    const { problems } = await measure(set);
    assert.deepEqual(problems, []);
});

test('dev set: the figures reached are held (first note, an answering note in the block, notes that do not answer, no block, everyday coding requests)', async () => {
    const m = await measure(loadSet(DEV, { kinds: true }));
    const a = m.summary.answerable;
    const u = m.summary.unanswerable;
    const c = m.summary.coding;
    const misses = m.misses.map(missText).join('\n');
    assert.ok(a.first >= DEV_REACHED.first, `first note answers ${a.first} of ${a.n}\n${misses}`);
    assert.ok(a.inBlock >= DEV_REACHED.inBlock, `an answering note in the block ${a.inBlock} of ${a.n}\n${misses}`);
    assert.ok(a.extra <= DEV_REACHED.extra, `${a.extra} notes that do not answer in ${a.blocks} blocks\n${misses}`);
    assert.ok(u.noBlock >= DEV_REACHED.noBlock, `no block for ${u.noBlock} of ${u.n}\n${misses}`);
    assert.ok(c.noBlock >= DEV_REACHED.coding, `no block for ${c.noBlock} of ${c.n} everyday coding requests\n${misses}`);
    assert.deepEqual(belowFloors(m), []);
});

test('the measure gives Canon only the prompt and the session\'s folder: the same blocks with every label taken away', async () => {
    const set = loadSet(DEV, { kinds: true });
    const bare = set.map((e, i) => ({ id: `x${i}`, folder: e.folder, prompt: e.prompt, answers: [] }));
    const [labelled, unlabelled] = [await measure(set), await measure(bare)];
    assert.deepEqual(unlabelled.rows.map((r) => r.got), labelled.rows.map((r) => r.got));
});

test('first hold-out: well formed and apart from the dev set (no prompt of it repeats one of dev\'s)', (t) => {
    if (!existsSync(HOLDOUT)) {
        t.skip('the first hold-out set is not there yet');
        return;
    }
    const dev = new Set(loadSet(DEV).map((e) => said(e.prompt)));
    const repeats = loadSet(HOLDOUT).filter((e) => dev.has(said(e.prompt))).length;
    assert.equal(repeats, 0, `${repeats} of its prompts repeat a dev prompt`);
});

test('first hold-out: within the four floors of OPEN-QUESTIONS #29 (its figures only)', async (t) => {
    if (!existsSync(HOLDOUT)) {
        t.skip('the first hold-out set is not there yet');
        return;
    }
    const m = await measure(loadSet(HOLDOUT));
    assert.equal(m.problems.length, 0, `${m.problems.length} problems with the set`);
    t.diagnostic(figures('first hold-out', m));
    assert.ok(m.summary.answerable.n > 0 && m.summary.unanswerable.n > 0, 'it has prompts a note answers and prompts none does');
    assert.deepEqual(belowFloors(m), [], `floors ${JSON.stringify(FLOORS)}`);
});

test('second hold-out: well formed with kinds and apart from the dev set and the first hold-out', (t) => {
    if (!existsSync(HOLDOUT2)) {
        t.skip('the second hold-out set is not there yet');
        return;
    }
    const earlier = new Set([...loadSet(DEV), ...(existsSync(HOLDOUT) ? loadSet(HOLDOUT) : [])].map((e) => said(e.prompt)));
    const repeats = loadSet(HOLDOUT2, { kinds: true }).filter((e) => earlier.has(said(e.prompt))).length;
    assert.equal(repeats, 0, `${repeats} of its prompts repeat a dev or first hold-out prompt`);
});

test('second hold-out: within all five floors (its figures only)', async (t) => {
    if (!existsSync(HOLDOUT2)) {
        t.skip('the second hold-out set is not there yet');
        return;
    }
    const m = await measure(loadSet(HOLDOUT2, { kinds: true }));
    assert.equal(m.problems.length, 0, `${m.problems.length} problems with the set`);
    t.diagnostic(figures('second hold-out', m));
    const s = m.summary;
    assert.ok(s.answerable.n > 0 && s.unanswerable.n > 0 && s.coding.n > 0, 'it has prompts a note answers, prompts none does, and everyday coding requests');
    assert.deepEqual(belowFloors(m), [], `floors ${JSON.stringify(FLOORS)}`);
});
