// The suite's shared code (shared/): words, the change hub, the event log, files and guards, the window kit,
// and the check that every plugin's copy is current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asksSomeone, count, cutOff, decisionIn, plainError, spanWords, stateWord, timeWords } from '../shared/host/words.js';
import { Hub } from '../shared/host/hub.js';
import { Journal } from '../shared/host/journal.js';
import { JsonStore, dshHome, ensurePrivateDir, pluginDir, readJson, writeAtomic } from '../shared/host/files.js';
import { clip, errorText, guard, later } from '../shared/host/safe.js';
import { SUITE, kitBlock, plannedCopies } from '../scripts/sync-shared.mjs';
import { suiteKit } from '../shared/client-kit.js';
import { OTHER_NAMES, standInReact, elementsOf, textIn } from './helpers/client.mjs';
import { settle } from './helpers/clock.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'suite-shared-'));

// ── Words ─────────────────────────────────────────────────────────────

test('words: a session\'s state in one set of words', () => {
    assert.equal(stateWord({ status: 'running', state: {} }), 'running');
    assert.equal(stateWord({ status: 'running', state: { approvals: [{ id: 'a' }] } }), 'waiting for approval');
    assert.equal(stateWord({ status: 'cold', state: { open: true } }), 'cut off');
    assert.equal(stateWord({ status: 'cold', state: { end: { kind: 'interrupted' } } }), 'cut off');
    assert.equal(stateWord({ status: 'idle', state: { end: { kind: 'aborted', cause: 'disposed' } } }), 'cut off');
    assert.equal(stateWord({ status: 'idle', state: { end: { kind: 'aborted', cause: 'user' } } }), 'stopped');
    assert.equal(stateWord({ status: 'idle', state: { end: { kind: 'error' } } }), 'failed');
    assert.equal(stateWord({ status: 'idle', state: { end: { kind: 'blocked' } } }), 'blocked');
    assert.equal(stateWord({ status: 'idle', state: { end: { kind: 'max-tokens' } } }), 'cut short');
    assert.equal(stateWord({ status: 'idle', state: { end: { kind: 'completed' } } }), 'idle');
    assert.equal(stateWord({ status: 'cold', blank: true, state: null }), 'new');
    assert.equal(stateWord({ external: { status: 'waiting on you' }, status: 'idle' }), 'waiting on you');
    assert.equal(stateWord(undefined), 'unknown');
    assert.equal(cutOff(undefined), false);
});

test('words: decision lines, in every way agents write them', () => {
    assert.deepEqual(decisionIn('Done.\nDECISION NEEDED: ship the parser? — recommend: yes, behind a flag'), { question: 'ship the parser?', recommendation: 'yes, behind a flag' });
    assert.deepEqual(decisionIn('**DECISION NEEDED: pick a port -- recommend: 8080**'), { question: 'pick a port', recommendation: '8080' });
    assert.deepEqual(decisionIn('> DECISION NEEDED: which branch? - recommendation: main'), { question: 'which branch?', recommendation: 'main' });
    assert.deepEqual(decisionIn('DECISION NEEDED: drop the cache?'), { question: 'drop the cache?' });
    assert.deepEqual(decisionIn('DECISION NEEDED: first? — recommend: a\nmore text\nDECISION NEEDED: second? — recommend: b'), { question: 'second?', recommendation: 'b' }, 'the last line wins');
    assert.equal(decisionIn('No decision here.'), undefined);
    assert.equal(decisionIn(42), undefined);
    assert.equal(decisionIn('DECISION NEEDED:   '), undefined);
});

test('words: whether a reply ends by asking a person, read from its last lines', () => {
    for (const ask of [
        'I can do either.\nWhich do you prefer?',
        'Ready.\nDECISION NEEDED: deploy? — recommend: yes',
        'BLOCKED: the token expired.',
        'Tests pass. Let me know if you want the docs too.',
        'Should I push the branch.',
        'Waiting for your go before the migration.',
        'Shall I continue with **the next step?**',
    ]) assert.equal(asksSomeone(ask), true, ask);
    for (const statement of [
        'Is it fast? Yes: 40 ms.\nAll tests pass; next I write the docs.',
        'Done. 12 tests pass.',
        '',
        undefined,
    ]) assert.equal(asksSomeone(statement), false, String(statement));
    assert.equal(asksSomeone(`Should I start?\n${'line\n'.repeat(10)}All done.`), false, 'only the end of the reply counts');
});

test('words: a provider\'s error in plain words, its JSON reduced to the message', () => {
    assert.equal(plainError('400: {"message":"The model refused this request.","type":"invalid_request_error"}'), '400: The model refused this request.');
    assert.equal(plainError('429 {"error":{"message":"Rate limit reached for requests","type":"requests"}}'), '429: Rate limit reached for requests');
    assert.equal(plainError('{"error":"overloaded"}'), 'overloaded');
    assert.equal(plainError('500 Internal Server Error'), '500 Internal Server Error', 'plain text stays as it is');
    assert.equal(plainError('503: {not json}'), '503: {not json}', 'broken JSON stays as it came');
    assert.equal(plainError('{"code":7}'), '{"code":7}', 'JSON without a message stays as it came');
    assert.equal(plainError(undefined), '');
});

test('words: times and spans in plain words', () => {
    const now = new Date(2026, 9, 16, 22, 15).getTime();
    assert.match(timeWords(new Date(2026, 9, 16, 21, 41).getTime(), now), /^9:41\s?PM$/);
    assert.match(timeWords(new Date(2026, 9, 15, 21, 41).getTime(), now), /^yesterday 9:41\s?PM$/);
    assert.match(timeWords(new Date(2026, 9, 3, 9, 5).getTime(), now), /^Oct 3, 9:05\s?AM$/);
    assert.equal(timeWords(0, now), 'an unknown time');
    assert.equal(spanWords(45000), '45 seconds');
    assert.equal(spanWords(1000), '1 second');
    assert.equal(spanWords(10 * 60000), '10 minutes');
    assert.equal(spanWords(3 * 3600000), '3 hours');
    assert.equal(spanWords(3 * 86400000), '3 days');
    assert.equal(count(1, 'open todo'), '1 open todo');
    assert.equal(count(2, 'try', 'tries'), '2 tries');
});

// ── The change hub ────────────────────────────────────────────────────

test('hub: a window waits until a channel moves, gets the change at once when behind, and a new start reads everything', async (t) => {
    // The hub's timers never keep DSH running, so the test keeps itself alive while it waits.
    const keep = setInterval(() => {}, 1000);
    t.after(() => clearInterval(keep));
    const hub = new Hub();
    const first = await hub.wait(undefined, 1000);
    assert.deepEqual(first, { epoch: hub.epoch, versions: {} }, 'a window with nothing yet gets the snapshot at once');
    let woke;
    const waiting = hub.wait(first, 10000).then((value) => { woke = value; });
    await settle(3);
    assert.equal(woke, undefined);
    hub.bump('autopilot');
    await waiting;
    assert.deepEqual(woke.versions, { autopilot: 1 });
    assert.equal(hub.behind(woke), false);
    assert.equal(hub.behind({ epoch: 'old', versions: woke.versions }), true);
    const timedOut = await hub.wait(woke, 5);
    assert.deepEqual(timedOut, woke);
    const controller = new AbortController();
    const aborted = hub.wait(woke, 10000, controller.signal);
    controller.abort();
    assert.deepEqual(await aborted, woke);
    const closing = hub.wait(woke, 10000);
    hub.close();
    assert.deepEqual(await closing, woke);
    assert.equal(hub.waiters.size, 0);
});

// ── The event log ─────────────────────────────────────────────────────

test('journal: entries and their later outcomes survive a restart, newest first, and the file is private', () => {
    const dir = temp();
    const file = join(dir, 'log', 'events.jsonl');
    let t = 1000;
    let changes = 0;
    const log = new Journal(file, { now: () => t++, onChange: () => { changes += 1; } });
    const a = log.add({ kind: 'nudge', sessionId: 's1', text: 'Told it to carry on', state: 'sending' });
    log.add({ kind: 'nudge', sessionId: 's2', text: 'Other' });
    log.set(a.id, { state: 'delivered', turn: 4 });
    assert.equal(changes, 3);
    assert.equal(log.set('missing', { state: 'x' }), undefined);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, 'log')).mode & 0o777, 0o700);
    appendFileSync(file, 'not json\n{"add":{"no":"id"}}\n');
    const again = new Journal(file);
    assert.deepEqual(again.list().map((entry) => entry.sessionId), ['s2', 's1']);
    assert.equal(again.get(a.id).state, 'delivered');
    assert.equal(again.get(a.id).turn, 4);
    assert.deepEqual(again.list({ sessionId: 's1' }).map((entry) => entry.id), [a.id]);
    assert.equal(again.list({ limit: 1 }).length, 1);
});

test('journal: keeps a bounded number of entries and rewrites itself when the file grows past its size', () => {
    const dir = temp();
    const file = join(dir, 'events.jsonl');
    const log = new Journal(file, { keep: 5, maxBytes: 2000 });
    for (let i = 0; i < 40; i += 1) log.add({ kind: 'x', text: `entry ${i} ${'.'.repeat(40)}` });
    assert.equal(log.list().length, 5);
    assert.ok(statSync(file).size <= 2000 + 200, 'rewritten from memory');
    assert.deepEqual(new Journal(file, { keep: 5 }).list().map((entry) => entry.text.split(' ')[1]), ['39', '38', '37', '36', '35']);
});

test('journal: a write that fails is logged, never thrown', () => {
    const dir = temp();
    writeFileSync(join(dir, 'blocker'), 'a file where a folder should be');
    const warnings = [];
    const log = new Journal(join(dir, 'blocker', 'events.jsonl'), { logger: { warn: (line) => warnings.push(line) } });
    assert.doesNotThrow(() => log.add({ kind: 'x' }));
    assert.equal(log.list().length, 1, 'kept in memory');
    assert.match(warnings[0], /could not write the event log/);
});

// ── Files ─────────────────────────────────────────────────────────────

test('files: private folders and atomic writes; the store gathers changes into one write', async () => {
    const dir = temp();
    const deep = join(dir, 'a', 'b', 'c');
    ensurePrivateDir(deep);
    for (const d of [join(dir, 'a'), join(dir, 'a', 'b'), deep]) assert.equal(statSync(d).mode & 0o777, 0o700);
    writeAtomic(join(deep, 'f.json'), '{"x":1}');
    assert.equal(statSync(join(deep, 'f.json')).mode & 0o777, 0o600);
    assert.deepEqual(readJson(join(deep, 'f.json')), { x: 1 });
    writeFileSync(join(deep, 'broken.json'), '{');
    assert.equal(readJson(join(deep, 'broken.json')), undefined);
    assert.equal(readJson(join(deep, 'missing.json')), undefined);
    const seen = [];
    const store = new JsonStore(join(deep, 'broken.json'), { parse: (value) => { seen.push(value); return { n: value?.n ?? 0 }; }, delayMs: 5 });
    assert.deepEqual(seen, [undefined], 'a broken file reads as nothing, never throws');
    store.data.n = 1;
    store.change();
    store.data.n = 2;
    store.change();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(readJson(join(deep, 'broken.json')), { n: 2 });
    writeFileSync(join(dir, 'file'), 'x');
    const warnings = [];
    const stuck = new JsonStore(join(dir, 'file', 'state.json'), { parse: () => ({}), logger: { warn: (line) => warnings.push(line) } });
    assert.equal(stuck.flush(), false);
    assert.match(warnings[0], /could not save/);
});

test('files: a DSH run with its own DSH_HOME keeps its plugins\' files there', () => {
    const saved = process.env.DSH_HOME;
    try {
        process.env.DSH_HOME = '/tmp/dsh-test-home';
        assert.equal(dshHome(), '/tmp/dsh-test-home');
        assert.equal(pluginDir('autopilot'), '/tmp/dsh-test-home/autopilot');
        process.env.DSH_HOME = '  ';
        assert.match(dshHome(), /\.dsh$/);
    } finally {
        if (saved === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = saved;
    }
});

// ── Guards ────────────────────────────────────────────────────────────

test('guards: nothing a handler throws reaches DSH; errors read as one short line', async () => {
    const warnings = [];
    const logger = { warn: (line) => warnings.push(line) };
    assert.doesNotThrow(() => guard(logger, 'sync', () => { throw new Error('bad\n  stack'); })());
    guard(logger, 'async', async () => { throw new Error('later'); })();
    await settle(3);
    assert.deepEqual(warnings, ['sync: bad stack', 'async: later']);
    assert.equal(errorText('x'.repeat(500)).length, 300);
    assert.equal(errorText({ code: 1 }), '{"code":1}');
    assert.equal(errorText(undefined), 'unknown error');
    assert.equal(clip('alpha beta gamma delta', 15), 'alpha beta…', 'at a word when one is near');
    assert.equal(clip('one two three four five', 12), 'one two thr…', 'mid-word when no word ends near the cut');
    assert.equal(clip('short', 12), 'short');
    assert.equal(clip(5, 3), '');
    let ran = false;
    const timer = later(logger, 'timer', 1, () => { ran = true; throw new Error('in a timer'); });
    assert.equal(typeof timer.hasRef === 'function' ? timer.hasRef() : false, false, 'never keeps DSH running');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(ran, true);
    assert.equal(warnings.at(-1), 'timer: in a timer');
});

// ── Copies ────────────────────────────────────────────────────────────

test('endpoints: every suite plugin marks each window endpoint, since DSH\'s gateway serves only marked methods', () => {
    let seen = 0;
    for (const plugin of SUITE) {
        let text;
        try {
            text = readFileSync(new URL(`../plugins/${plugin}/lib/remote.js`, import.meta.url), 'utf8');
        } catch {
            continue;
        }
        seen += 1;
        const methods = [...text.matchAll(/^ {4}async (\w+)\(/gm)].map((m) => m[1]).filter((name) => name !== 'run').sort();
        const marked = /markRemote\(\w+, \[([^\]]*)\]\)/.exec(text)?.[1];
        assert.ok(marked, `${plugin}: remote.js marks its methods with markRemote`);
        const names = [...marked.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
        assert.deepEqual(names, methods, `${plugin}: every endpoint is marked, and only endpoints`);
    }
    assert.ok(seen >= 2, 'session-watch and autopilot have endpoints');
});

test('copies: every suite plugin carries the current shared code', () => {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['scripts/sync-shared.mjs', '--check'], { stdio: 'pipe' }));
    const copies = plannedCopies();
    for (const plugin of ['session-watch', 'autopilot']) {
        assert.ok(copies.some((copy) => copy.target.includes(`/plugins/${plugin}/lib/shared/words.js`)), plugin);
        assert.ok(SUITE.includes(plugin));
    }
    const client = readFileSync('plugins/autopilot/lib/client.js', 'utf8');
    assert.equal(kitBlock(client), kitBlock(readFileSync('shared/client-kit.js', 'utf8')));
    assert.equal(kitBlock('no markers'), undefined);
});

// ── The window kit ────────────────────────────────────────────────────

function kitWith({ document, window = {} } = {}) {
    const saved = { window: globalThis.window, document: globalThis.document };
    globalThis.window = window;
    if (document) globalThis.document = document;
    try {
        const React = standInReact();
        const ui = new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? name : undefined) });
        return suiteKit({ prefix: 'dshx', bundle: 'dsh-plugin-x', React, ui, h: React.createElement });
    } finally {
        globalThis.window = saved.window;
        if (document) globalThis.document = saved.document;
    }
}

test('kit: endpoints answer in words, and a broken answer never reaches a view as a throw', async () => {
    const kit = kitWith();
    const api = kit.link('dsh-plugin-x');
    const calls = [];
    kit.setConnection({ rpc: { call: async (path, method, payload) => { calls.push([path, method, payload]); return method.endsWith('/broken') ? 'junk' : method.endsWith('/down') ? Promise.reject(new Error('socket closed')) : { ok: true, value: 7 }; } } });
    assert.deepEqual(await api.call('state', { a: 1 }), { ok: true, value: 7 });
    assert.deepEqual(calls[0], ['/api', 'dsh-plugin-x/state', { args: { a: 1 } }]);
    assert.equal(await api.read('state'), 7);
    assert.deepEqual(await api.call('broken'), { ok: false, error: { code: 'unreadable', message: 'The plugin sent an answer this window cannot read.' } });
    assert.equal((await api.call('down')).error.message, 'DSH did not answer (socket closed).');
    await assert.rejects(api.read('broken'), /cannot read/);
});

test('kit: one hub request per window serves every plugin, and moves only the views whose channel changed', async () => {
    const shared = {};
    const kitA = kitWith({ window: shared });
    const kitB = kitWith({ window: shared });
    let version = 0;
    const waits = [];
    const connection = { rpc: { call: async (_path, method, payload) => {
        waits.push([method, payload.args.since?.versions?.autopilot ?? null]);
        if (waits.length > 3) return new Promise(() => {});
        version += 1;
        return { ok: true, value: { epoch: 'e1', versions: { autopilot: version, recall: 1 } } };
    } } };
    kitA.setConnection(connection);
    kitA.hub.attach();
    kitB.hub.attach();
    const heard = { a: 0, b: 0 };
    kitA.hub.subscribe(['autopilot'], () => { heard.a += 1; });
    kitB.hub.subscribe(['recall'], () => { heard.b += 1; });
    await settle(10);
    assert.ok(shared['dsh-plugin-session-watch/hub/v1'], 'the hub lives on the window, shared');
    assert.equal(waits.filter(([method]) => method !== 'dsh-plugin-session-watch/wait').length, 0);
    assert.ok(waits.length >= 3, 'one long request after another, never in parallel');
    assert.equal(heard.b, 1, 'recall moved once (the first answer); autopilot\'s changes never wake it');
    assert.ok(heard.a >= 3);
});

test('kit: times, tones and the parts every page uses', () => {
    const kit = kitWith();
    assert.equal(kit.toneOf('delivered'), 'success');
    assert.equal(kit.toneOf('not delivered'), 'danger');
    assert.equal(kit.toneOf('asked you'), 'warning');
    assert.equal(kit.toneOf('waiting for a round'), 'info');
    assert.equal(kit.toneOf('idle'), 'quiet');
    const now = Date.now();
    assert.equal(kit.agoText(now - 10000, now), 'just now');
    assert.equal(kit.agoText(now - 5 * 60000, now), '5 min ago');
    assert.equal(kit.agoText(now - 3 * 3600000, now), '3 h ago');
    assert.equal(kit.timeText(0), '');
    assert.equal(kit.spanText(5), '5 seconds');
    assert.equal(kit.spanText(1), '1 second');
    assert.equal(kit.spanText(60), '1 minute');
    assert.equal(kit.spanText(600), '10 minutes');
    assert.equal(kit.spanText(7200), '2 hours');
    assert.equal(kit.spanText(5400), '1.5 hours');
    assert.equal(kit.spanText(-1), '');
    const card = kit.Card({ title: 'Title', sub: 'Sub', actions: 'Act', main: true, children: 'Body' });
    assert.equal(card.props.className, 'dshx-card dshx-main');
    assert.equal(textIn(card), 'TitleSubActBody');
    const empty = kit.Empty({ title: 'Nothing yet', text: 'Do this next.' });
    assert.equal(empty.props.role, 'status');
    const error = kit.ErrorLine({ text: 'socket closed', onRetry: () => {} });
    assert.equal(textIn(error), 'Couldn\'t refresh: socket closedRetry');
    assert.equal(elementsOf(error).find((e) => e.type === 'Button').props.variant, 'ghost');
    assert.equal(kit.StateTag({ word: 'failed' }).props.tone, 'danger');
    assert.equal(kit.TimeText({ at: 0 }), null);
    assert.ok(kit.css.some((rule) => rule.includes('prefers-reduced-motion')));
    assert.ok(kit.css.some((rule) => rule.includes('body.wp-still')));
    assert.ok(kit.css.some((rule) => rule.includes('prefers-reduced-transparency')));
    assert.ok(kit.css.every((rule) => !OTHER_NAMES.test(rule)));
});
