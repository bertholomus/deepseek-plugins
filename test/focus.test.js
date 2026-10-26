/**
 * Focus: the host's timer on a clock moved by hand (its own end of a timer, a restart under one, an end
 * while DSH was closed, the day it counts on), its refusals in words, its setting's check, a folder it
 * cannot write, its log's bound and its wiring to DSH; the window's bundle drawn with stand-ins for DSH's
 * parts (its words for each state, its error states, the end said once) and its style sheet held to
 * DESIGN.md; and the README held to the code. The real-DSH test is plugins/focus/test/e2e/run.mjs
 * (`node scripts/e2e.mjs focus`).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/temp.mjs';
import { elementsOf, loadClient, OTHER_NAMES, statefulReact, textIn } from './helpers/client.mjs';
import {
    apply, checkConfig, createFocus, DUE_SLACK_MS, DURATION_MAX_MS, DURATION_MIN_MS, KINDS, LOG_MAX_BYTES,
    MINUTES_MAX, MINUTES_MIN, normalizeState, OPS,
} from '../plugins/focus/lib/impl.js';

const pluginRoot = fileURLToPath(new URL('../plugins/focus/', import.meta.url));
const at = (rel) => join(pluginRoot, rel);
const text = (rel) => readFileSync(at(rel), 'utf8');
const clientUrl = new URL('../plugins/focus/lib/client.js', import.meta.url);
const T0 = Date.UTC(2026, 9, 26, 17, 0, 0); // 10:00 AM PDT
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** A clock and timers moved by hand; setTimer has setTimeout's order (fn, ms). */
function fakeTime(start = T0) {
    let now = start;
    const timers = new Set();
    return {
        now: () => now,
        setTimer: (fn, ms) => { const t = { at: now + Math.max(0, ms), fn, unref() {} }; timers.add(t); return t; },
        clearTimer: (t) => { timers.delete(t); },
        pending: () => timers.size,
        advance(ms) {
            const until = now + ms;
            for (;;) {
                const next = [...timers].filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
                if (!next) break;
                timers.delete(next);
                now = Math.max(now, next.at);
                next.fn();
            }
            now = until;
        },
        set(ms) { now = ms; },
    };
}

function host(dir, time, extra = {}) {
    return createFocus({ dataDir: dir, now: time.now, day: utcDay, setTimer: time.setTimer, clearTimer: time.clearTimer, ...extra });
}
const req = (method, body, raw) => new Request('http://dsh.test/api/focus/state', { method, ...(raw !== undefined || body !== undefined ? { body: raw ?? JSON.stringify(body) } : {}) });
async function call(focus, method = 'GET', body, raw) {
    const res = await focus.handle(req(method, body, raw));
    return { status: res.status, headers: res.headers, body: await res.json() };
}
const post = (focus, body) => call(focus, 'POST', body);
const op = (focus, o) => post(focus, { op: o });
const logOf = (dir) => { try { return readFileSync(join(dir, 'focus.log'), 'utf8'); } catch { return ''; } };
const count = (s, re) => (s.match(re) ?? []).length;

// ── the setting ─────────────────────────────────────────────────────────────

test('checkConfig: the default folder follows DSH_HOME; a full path is taken; a wrong value is said in words and the default kept', () => {
    const env = { DSH_HOME: '/srv/dsh-test' };
    for (const raw of [undefined, null, {}, { dataDir: '' }, { dataDir: null }]) {
        assert.deepEqual(checkConfig(raw, env), { dataDir: '/srv/dsh-test/focus', problems: [] }, JSON.stringify(raw));
    }
    assert.equal(checkConfig({}, {}).dataDir, join(homedir(), '.dsh', 'focus'));
    assert.deepEqual(checkConfig({ dataDir: '/var/tmp/focus/' }, env), { dataDir: '/var/tmp/focus', problems: [] });
    assert.deepEqual(checkConfig({ dataDir: '~/Timers/focus' }, env), { dataDir: join(homedir(), 'Timers', 'focus'), problems: [] });
    const said = (raw) => checkConfig(raw, env);
    assert.deepEqual(said({ dataDir: 42 }), { dataDir: '/srv/dsh-test/focus', problems: ['dataDir must be a folder path, not 42; Focus keeps its timer in /srv/dsh-test/focus.'] });
    assert.deepEqual(said({ dataDir: '   ' }).problems, ['dataDir must be a folder path, not "   "; Focus keeps its timer in /srv/dsh-test/focus.']);
    assert.deepEqual(said({ dataDir: 'relative/focus' }).problems, ['dataDir must be a full path (starting with / or ~/), not "relative/focus"; Focus keeps its timer in /srv/dsh-test/focus.']);
    assert.deepEqual(said('focus').problems, ['Focus\'s settings must be a map of keys, not "focus"; it uses its defaults.']);
    assert.deepEqual(said({ chime: false }).problems, ['chime is not a setting of Focus and is ignored (its one setting is dataDir).']);
    assert.equal(said({ dataDir: 'x'.repeat(200) }).problems[0].length < 260, true, 'a long value is cut in the words');
});

test('normalizeState: a saved state back in shape (whole minutes, 1 to 180, typed timer, no more left than the length)', () => {
    const day = '2026-10-26';
    const back = normalizeState({
        settings: { focusMin: 15.5, shortMin: 0, longMin: 999, chime: 'yes', extra: 1 },
        timer: { kind: 'nap', durationMs: 5, remainingMs: 1e12, running: true, endAt: null, doneAt: 'x' },
        sessions: { date: day, focus: 3 }, rev: 2.5, other: true,
    }, day);
    assert.deepEqual(back, {
        settings: { focusMin: 16, shortMin: 1, longMin: 180, chime: true },
        timer: { kind: 'focus', durationMs: DURATION_MIN_MS, remainingMs: DURATION_MIN_MS, endAt: null, running: false, doneAt: null },
        sessions: { date: day, focus: 3 }, rev: 0,
    });
    assert.deepEqual(normalizeState({ sessions: { date: '2026-10-25', focus: 4 } }, day).sessions, { date: day, focus: 0 }, 'another day starts at 0');
    assert.deepEqual(normalizeState('junk', day).timer.durationMs, 1500000);
});

// ── the host's own end of a timer ───────────────────────────────────────────

test('the host ends a running timer at its end by its own timer, with no window, and counts a focus session once', async () => {
    const dir = tempDir('focus-end');
    const time = fakeTime();
    const focus = host(dir, time);
    const started = await op(focus, { op: 'start', kind: 'focus', durationMs: 60000 });
    assert.equal(started.status, 200);
    assert.equal(started.body.timer.endAt, T0 + 60000);
    assert.equal(focus.armed, true, 'the host set a timer of its own');
    time.advance(59000);
    assert.equal(focus.state.timer.running, true, 'not before its end');
    time.advance(1100);
    assert.equal(focus.state.timer.running, false, 'ended by the host');
    assert.equal(focus.state.timer.doneAt, T0 + 60000, 'as of its end');
    assert.equal(focus.state.timer.remainingMs, 60000, 'idle at its full length');
    assert.equal(focus.state.sessions.focus, 1);
    const late = await op(focus, { op: 'complete' });
    assert.equal(late.body.changed, false, 'a window\'s complete after the end counts nothing more');
    assert.equal(late.body.sessions.focus, 1);
    assert.equal(count(logOf(dir), / complete focus 60s \(focus sessions today: 1\)/g), 1);
    assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).sessions.focus, 1, 'saved');
    focus.stop();
});

test('complete only asks the host to check: early it changes nothing, within 1.5 s of the end it ends the timer as of its end, once for two windows', async () => {
    const dir = tempDir('focus-complete');
    const time = fakeTime();
    const focus = host(dir, time);
    await op(focus, { op: 'start', kind: 'focus', durationMs: 60000 });
    time.advance(30000);
    const early = await op(focus, { op: 'complete' });
    assert.equal(early.body.changed, false);
    assert.equal(early.body.timer.running, true);
    time.advance(30000 - DUE_SLACK_MS + 100); // a window's clock a little ahead of the host's
    const first = await op(focus, { op: 'complete' });
    const second = await op(focus, { op: 'complete' });
    assert.equal(first.body.changed, true);
    assert.equal(first.body.timer.doneAt, T0 + 60000, 'as of its end, not of the window\'s call');
    assert.equal(second.body.changed, false, 'the second window counts nothing');
    time.advance(5000);
    assert.equal(focus.state.sessions.focus, 1, 'and the host\'s own timer does not count it again');
    focus.stop();
});

test('breaks and custom timers end the same way and are not counted', async () => {
    const dir = tempDir('focus-breaks');
    const time = fakeTime();
    const focus = host(dir, time);
    for (const kind of ['short', 'long', 'custom']) {
        await op(focus, { op: 'start', kind, durationMs: 10000 });
        time.advance(10100);
        assert.equal(focus.state.timer.running, false, kind);
        assert.equal(focus.state.timer.doneAt !== null, true, kind);
    }
    assert.equal(focus.state.sessions.focus, 0);
    assert.match(logOf(dir), / complete short 10s\n[\s\S]* complete long 10s\n[\s\S]* complete custom 10s\n/);
    focus.stop();
});

test('a restart under a running timer keeps its end and ends it once; stop() leaves it to the next start', async () => {
    const dir = tempDir('focus-restart');
    const time = fakeTime();
    const first = host(dir, time);
    await op(first, { op: 'start', kind: 'focus', durationMs: 600000 });
    first.stop();
    assert.equal(first.armed, false);
    time.advance(300000);
    assert.equal(first.state.timer.running, true, 'a stopped host ends nothing');
    const second = host(dir, time);
    assert.equal(second.state.timer.running, true);
    assert.equal(second.state.timer.endAt, T0 + 600000, 'the same end');
    assert.equal(second.armed, true);
    time.advance(300100);
    assert.equal(second.state.sessions.focus, 1);
    assert.equal(count(logOf(dir), / complete focus /g), 1);
    second.stop();
});

test('a timer that ended while DSH was closed ends at the next start, as of its end, counted once, and the log says how late', async () => {
    const dir = tempDir('focus-closed');
    const time = fakeTime();
    const first = host(dir, time);
    await op(first, { op: 'start', kind: 'focus', durationMs: 60000 });
    first.stop();
    time.set(T0 + 3600000);
    const second = host(dir, time);
    assert.equal(second.state.timer.running, false);
    assert.equal(second.state.timer.doneAt, T0 + 60000);
    assert.equal(second.state.sessions.focus, 1);
    assert.match(logOf(dir), /complete focus 60s \(focus sessions today: 1\), noted 3540s after its end/);
    second.stop();
    const third = host(dir, time);
    assert.equal(third.state.sessions.focus, 1, 'a later start counts nothing more');
    third.stop();
});

test('a focus session counts on the day it ended: one that ended yesterday is not counted today; the count starts again at midnight', async () => {
    const dir = tempDir('focus-days');
    const late = Date.UTC(2026, 9, 25, 23, 50, 0);
    const time = fakeTime(late);
    const first = host(dir, time);
    await op(first, { op: 'start', kind: 'focus', durationMs: 300000 }); // ends 23:55 on the 25th
    first.stop();
    time.set(Date.UTC(2026, 9, 26, 8, 0, 0));
    const second = host(dir, time);
    assert.deepEqual(second.state.sessions, { date: '2026-10-26', focus: 0 });
    assert.equal(second.state.timer.doneAt, late + 300000);
    assert.match(logOf(dir), /complete focus 300s, ended on 2026-10-25: not counted for today/);
    await op(second, { op: 'start', kind: 'focus', durationMs: 60000 });
    time.advance(60100);
    assert.equal(second.state.sessions.focus, 1);
    const rev = second.state.rev;
    time.set(Date.UTC(2026, 9, 27, 0, 0, 5));
    const read = await call(second);
    assert.deepEqual(read.body.sessions, { date: '2026-10-27', focus: 0 }, 'a read after midnight starts the count again');
    assert.equal(read.body.rev, rev + 1, 'and that is a change');
    assert.match(logOf(dir), /day rolled over to 2026-10-27; focus count reset/);
    second.stop();
});

// ── ops and refusals ────────────────────────────────────────────────────────

test('pause keeps the time left, resume runs on from it, reset and set make it idle; start and set are refused while a timer runs', async () => {
    const dir = tempDir('focus-ops');
    const time = fakeTime();
    const focus = host(dir, time);
    await op(focus, { op: 'start', kind: 'focus', durationMs: 1500000 });
    time.advance(600000);
    const paused = await op(focus, { op: 'pause' });
    assert.deepEqual([paused.body.timer.running, paused.body.timer.remainingMs, paused.body.timer.endAt], [false, 900000, null]);
    assert.equal(focus.armed, false, 'paused: nothing to end');
    time.advance(60000);
    const resumed = await op(focus, { op: 'resume' });
    assert.equal(resumed.body.timer.endAt, time.now() + 900000);
    for (const o of [{ op: 'start', kind: 'short', durationMs: 300000 }, { op: 'set', kind: 'short', durationMs: 300000 }]) {
        const refused = await post(focus, { op: o, settings: { chime: false } });
        assert.equal(refused.status, 409, o.op);
        assert.match(refused.body.error, /Pause or reset it first/);
    }
    assert.equal(focus.state.settings.chime, true, 'a refused request changes nothing, its settings included');
    assert.equal(focus.state.timer.kind, 'focus');
    const reset = await op(focus, { op: 'reset' });
    assert.deepEqual([reset.body.timer.running, reset.body.timer.remainingMs, reset.body.timer.doneAt], [false, 1500000, null]);
    const set = await op(focus, { op: 'set', kind: 'custom', durationMs: 5 });
    assert.equal(set.body.timer.durationMs, DURATION_MIN_MS, 'kept within 10 s');
    assert.equal((await op(focus, { op: 'set', kind: 'custom', durationMs: 1e12 })).body.timer.durationMs, DURATION_MAX_MS, 'and 3 h');
    assert.equal((await op(focus, { op: 'set', kind: 'custom', durationMs: 90000.6 })).body.timer.durationMs, 90001, 'whole milliseconds');
    focus.stop();
});

test('revision: up by one on each change, the same when nothing changed', async () => {
    const dir = tempDir('focus-rev');
    const time = fakeTime();
    const focus = host(dir, time);
    const r0 = (await call(focus)).body.rev;
    assert.equal((await call(focus)).body.rev, r0, 'a read changes nothing');
    const idlePause = await op(focus, { op: 'pause' });
    assert.deepEqual([idlePause.body.changed, idlePause.body.rev], [false, r0]);
    const same = await post(focus, { settings: { focusMin: 25, chime: true } });
    assert.deepEqual([same.body.changed, same.body.rev], [false, r0], 'the same settings change nothing');
    const moved = await post(focus, { settings: { focusMin: 30.4 } });
    assert.deepEqual([moved.body.changed, moved.body.rev, moved.body.settings.focusMin], [true, r0 + 1, 30]);
    assert.match(logOf(dir), /settings: focusMin=30/);
    focus.stop();
});

test('refusals: a 400 in words for each bad input, 405 with Allow, every answer no-store', async () => {
    const dir = tempDir('focus-refuse');
    const focus = host(dir, fakeTime());
    const cases = [
        [req('POST', undefined, '{nope'), 400, /^The request body must be valid JSON\.$/],
        [req('POST', [1]), 400, /must be a JSON object/],
        [req('POST', { op: 'start' }), 400, /^op must be an object/],
        [req('POST', { op: { op: 'fly' } }), 400, new RegExp(`op must be one of ${OPS.join(', ')}, not "fly"`)],
        [req('POST', { op: { op: 'start', kind: 'nap', durationMs: 1000 } }), 400, new RegExp(`kind must be one of ${KINDS.join(', ')}`)],
        [req('POST', { op: { op: 'set', kind: 'focus' } }), 400, /durationMs must be a number of milliseconds/],
        [req('POST', { settings: [] }), 400, /settings must be a JSON object/],
        [req('POST', { settings: { shortMin: '5' } }), 400, new RegExp(`settings.shortMin must be a number of minutes, from ${MINUTES_MIN} to ${MINUTES_MAX}`)],
        [req('POST', { settings: { chime: 1 } }), 400, /settings.chime must be true or false/],
        [req('PUT', {}), 405, /^Use GET or POST here\.$/],
    ];
    for (const [request, status, words] of cases) {
        const res = await focus.handle(request);
        const body = await res.json();
        assert.equal(res.status, status, body.error);
        assert.match(body.error, words);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        if (status === 405) assert.equal(res.headers.get('allow'), 'GET, POST');
    }
    assert.equal(focus.state.rev, 0, 'nothing changed');
    focus.stop();
});

// ── storage ─────────────────────────────────────────────────────────────────

test('a folder that cannot be made: the timer works in memory, and the problem is said', async () => {
    const base = tempDir('focus-nofolder');
    writeFileSync(join(base, 'file'), 'a file, not a folder');
    const said = [];
    const time = fakeTime();
    const focus = host(join(base, 'file', 'focus'), time, { say: (level, words) => said.push([level, words]) });
    const read = await call(focus);
    assert.equal(read.status, 200);
    assert.match(read.body.problems[0], /^Focus could not make its folder .*file\/focus \(ENOTDIR\): the timer works, but is not kept across a restart\.$/);
    assert.equal(said[0][0], 'warn');
    const started = await op(focus, { op: 'start', kind: 'focus', durationMs: 10000 });
    assert.equal(started.body.timer.running, true);
    time.advance(10100);
    assert.equal(focus.state.sessions.focus, 1, 'and ends on time');
    focus.stop();
});

test('a save that fails is said (once) and the timer keeps counting; when a save works again the problem goes', { skip: process.getuid?.() === 0 }, async () => {
    const dir = tempDir('focus-readonly');
    const time = fakeTime();
    const said = [];
    const focus = host(dir, time, { say: (level, words) => said.push(words) });
    chmodSync(dir, 0o500);
    try {
        await op(focus, { op: 'start', kind: 'focus', durationMs: 60000 });
        const read = await call(focus);
        assert.equal(read.body.timer.running, true);
        assert.match(read.body.problems.at(-1), /^Focus could not save its timer to .*state\.json \(EACCES\); it keeps counting, but a restart would lose the change\.$/);
        await op(focus, { op: 'pause' });
        assert.equal(said.filter((w) => /could not save/.test(w)).length, 1, 'said once, not on every change');
    } finally {
        chmodSync(dir, 0o700);
    }
    await op(focus, { op: 'resume' });
    assert.deepEqual((await call(focus)).body.problems, []);
    assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).timer.running, true);
    assert.match(logOf(dir), /state\.json written again/);
    focus.stop();
});

test('a state.json that cannot be read: the defaults, said in the log and to DSH', () => {
    const dir = tempDir('focus-corrupt');
    writeFileSync(join(dir, 'state.json'), '{ not json');
    const said = [];
    const focus = host(dir, fakeTime(), { say: (level, words) => said.push([level, words]) });
    assert.equal(focus.state.timer.durationMs, 1500000);
    assert.match(logOf(dir), /state\.json could not be read \(.+\); starting from the defaults/);
    assert.equal(said.some(([level, words]) => level === 'warn' && /could not be read/.test(words)), true);
    focus.stop();
});

test('focus.log is bounded: past its size it starts a new part and keeps one old part; it never throws', async () => {
    const dir = tempDir('focus-log');
    const focus = host(dir, fakeTime(), { logMaxBytes: 400 });
    for (let i = 0; i < 30; i += 1) await op(focus, { op: 'set', kind: 'custom', durationMs: 60000 + i * 1000 });
    assert.equal(existsSync(join(dir, 'focus.log.1')), true);
    assert.equal(statSync(join(dir, 'focus.log')).size <= 400, true);
    assert.equal(readdirSync(dir).filter((f) => f.startsWith('focus.log')).length, 2);
    assert.equal(LOG_MAX_BYTES, 1024 * 1024);
    focus.stop();
});

// ── the plugin's wiring to DSH ──────────────────────────────────────────────

function fakeCtx({ register = true } = {}) {
    const disposers = [];
    const routes = [];
    const warns = [];
    const connection = register ? {
        fetch: {
            register(route) {
                routes.push(route);
                return () => { route.gone = true; };
            },
        },
    } : {};
    const ctx = {
        logger: { warn: (...a) => warns.push(a), info: () => {} },
        effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); },
        inject(names, cb) {
            assert.deepEqual(names, ['connection']);
            cb({ get: (n) => (n === 'connection' ? connection : undefined), effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); } });
        },
    };
    return { ctx, routes, warns, dispose: () => disposers.splice(0).reverse().forEach((d) => d()) };
}

test('apply: serves GET and POST /api/focus/state (buffered), says a wrong setting to DSH\'s logger, and leaves nothing running when disposed', async () => {
    const dir = tempDir('focus-apply');
    const { ctx, routes, warns, dispose } = fakeCtx();
    await apply(ctx, { dataDir: dir, colour: 'red' });
    assert.equal(routes.length, 1);
    assert.deepEqual([routes[0].path, routes[0].methods, routes[0].requestBody], ['/api/focus/state', ['GET', 'POST'], 'buffered']);
    assert.deepEqual(warns, [['focus: %s', 'colour is not a setting of Focus and is ignored (its one setting is dataDir).']]);
    const res = await routes[0].fetch(req('POST', { op: { op: 'start', kind: 'focus', durationMs: 600000 } }));
    const body = await res.json();
    assert.equal(body.timer.running, true);
    assert.deepEqual(body.problems, ['colour is not a setting of Focus and is ignored (its one setting is dataDir).']);
    assert.match(logOf(dir), /setting: colour is not a setting of Focus[\s\S]*started; serving \/api\/focus\/state \(GET, POST\)/);
    dispose();
    assert.equal(routes[0].gone, true, 'the route goes with the plugin');
});

test('apply: without DSH\'s connection.fetch it says so and does not throw', async () => {
    const dir = tempDir('focus-apply-none');
    const { ctx, routes, warns, dispose } = fakeCtx({ register: false });
    await apply(ctx, { dataDir: dir });
    assert.equal(routes.length, 0);
    assert.match(warns.at(-1)[1], /no connection\.fetch\.register; the timer is not served/);
    dispose();
});

test('lib/impl.test.mjs passes', () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT; // its own run, with its own report
    const out = execFileSync(process.execPath, ['--test', '--test-reporter=tap', at('lib/impl.test.mjs')], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(out, /# pass [1-9]\d*\n/);
    assert.match(out, /# fail 0\n/);
});

// ── the window's bundle ─────────────────────────────────────────────────────

const STATE = (over = {}) => ({
    settings: { focusMin: 25, shortMin: 5, longMin: 15, chime: true },
    timer: { kind: 'focus', durationMs: 1500000, remainingMs: 1500000, endAt: null, running: false, doneAt: null },
    sessions: { date: '2026-10-26', focus: 0 },
    rev: 1, problems: [], ...over,
});

const opened = [];
after(() => { for (const w of opened.splice(0)) w.close(); });

/** The bundle with stand-ins: a document, fetch answering from `answers` (a function of the request), and DSH's slots. */
async function window(answer, { stateful = false } = {}) {
    const appended = [];
    const listeners = new Map();
    const document = {
        visibilityState: 'visible', activeElement: null,
        head: { appendChild: (el) => { appended.push(el); el.connected = true; } },
        createElement: (tag) => ({ tag, attrs: {}, textContent: '', connected: false, setAttribute(k, v) { this.attrs[k] = String(v); }, remove() { this.connected = false; } }),
        addEventListener: (type, fn) => listeners.set(`${type}`, fn),
        removeEventListener: (type) => listeners.delete(`${type}`),
    };
    const calls = [];
    const fetch = async (url, init = {}) => {
        calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined });
        const [status, body] = await answer(calls.at(-1));
        return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
    };
    const held = stateful ? statefulReact() : null;
    const { client, id } = loadClient(clientUrl, { document, globals: { fetch }, ...(held ? { react: held.react } : {}) });
    const regs = [];
    const disposers = [];
    client.apply({
        effect: (fn) => { const d = fn(); if (typeof d === 'function') disposers.push(d); },
        slots: { inject: (slot, fn) => fn(), register: (opts, comp) => { regs.push({ opts, comp }); return () => {}; } },
    });
    const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); };
    await settle();
    const slot = (name) => regs.find((r) => r.opts.name === name);
    const w = {
        id, client, calls, appended, regs, settle, listeners, mount: held?.mount,
        button: () => slot('sidebar.footer.action').comp({}),
        overlay: () => slot('shell.overlay').comp({}),
        close: () => disposers.splice(0).reverse().forEach((d) => d()),
    };
    opened.push(w);
    return w;
}
const find = (tree, pred) => elementsOf(tree).find(pred);
const all = (tree, pred) => elementsOf(tree).filter(pred);
const footerButton = (tree) => find(tree, (e) => e.type === 'button' && 'data-focus-open' in e.props);
const partNamed = (tree, part, label) => find(tree, (e) => e.type === part && textIn(e.children) === label);

test('the bundle: DSH\'s module id, its two slot entries named <package>:<name>, one style sheet named for DESIGN.md, nothing left when off', async () => {
    const w = await window(() => [200, STATE()]);
    assert.equal(w.id, 'dsh-plugin-focus');
    assert.equal(w.client.name, 'dsh-plugin-focus');
    assert.deepEqual(w.regs.map((r) => [r.opts.name, r.opts.id, r.opts.order]), [['sidebar.footer.action', 'dsh-plugin-focus:open', 91], ['shell.overlay', 'dsh-plugin-focus:overlay', 41]]);
    assert.equal(w.appended.length, 1);
    assert.deepEqual(w.appended[0].attrs, { 'data-plugin': 'dsh-plugin-focus', 'data-plugin-css': 'dsh-plugin-focus/client.css' });
    assert.deepEqual(w.calls.map((c) => [c.url, c.method]), [['/api/focus/state', 'GET']], 'its only call: its own route');
    w.close();
    assert.equal(w.appended[0].connected, false, 'off: the style sheet is gone');
    assert.equal(w.listeners.size, 0, 'off: no listeners left');
});

test('the footer button: named in words for each state; it opens DSH\'s dialog, which says the state and offers each control', async () => {
    let state = STATE();
    const w = await window(() => [200, state]);
    let tree = w.button();
    assert.equal(find(tree, (e) => e.type === 'Tooltip')?.props.label, 'Focus timer');
    const button = footerButton(tree);
    assert.deepEqual([button.props['aria-label'], button.props['aria-haspopup']], ['Focus timer', 'dialog']);
    assert.equal(w.overlay().children.flat().filter(Boolean).length, 0, 'closed: no dialog');
    button.props.onClick({ currentTarget: { focus() {}, isConnected: true } });
    await w.settle();
    let panel = w.overlay();
    const modal = find(panel, (e) => e.type === 'Modal');
    assert.deepEqual([modal.props.title, modal.props.closeLabel, typeof modal.props.onClose], ['Focus timer', 'Close', 'function']);
    assert.equal(textIn(find(panel, (e) => 'data-focus-state' in e.props)), 'Focus · ready, 25:00');
    assert.equal(textIn(find(panel, (e) => 'data-focus-time' in e.props)), '25:00');
    assert.equal(textIn(find(panel, (e) => 'data-focus-sessions' in e.props)), 'No focus sessions yet today');
    assert.deepEqual(all(panel, (e) => e.type === 'Button' && 'data-focus-preset' in e.props).map((b) => [textIn(b.children), b.props['aria-pressed'], b.props.disabled]),
        [['Focus 25 min', true, false], ['Short break 5 min', false, false], ['Long break 15 min', false, false]]);
    const start = find(modal.props.footer, (e) => e.type === 'Button' && 'data-focus-primary' in e.props);
    assert.deepEqual([textIn(start.children), start.props['data-modal-autofocus']], ['Start', true]);
    assert.equal(find(modal.props.footer, (e) => e.type === 'Button' && 'data-focus-reset' in e.props).props.disabled, true, 'nothing to reset');
    assert.equal(find(panel, (e) => e.type === 'Switch')?.props.label, 'Chime when a timer ends');
    assert.deepEqual(all(panel, (e) => 'data-focus-field' in e.props).map((f) => f.props['data-focus-field']), ['focusMin', 'shortMin', 'longMin']);

    // Running: the lengths locked, the words, Pause.
    const now = Date.now();
    state = STATE({ rev: 2, timer: { kind: 'focus', durationMs: 1500000, remainingMs: 1500000, endAt: now + 1050000, running: true, doneAt: null }, sessions: { date: '2026-10-26', focus: 2 } });
    start.props.onClick();
    await w.settle();
    assert.deepEqual(w.calls.at(-1), { url: '/api/focus/state', method: 'POST', body: { op: { op: 'start', kind: 'focus', durationMs: 1500000 } } });
    panel = w.overlay();
    assert.match(textIn(find(panel, (e) => 'data-focus-state' in e.props)), /^Focus · running, ends at \d{1,2}:\d{2}\s?[AP]M$/);
    assert.equal(all(panel, (e) => e.type === 'Button' && 'data-focus-preset' in e.props).every((b) => b.props.disabled === true), true);
    assert.equal(textIn(panel).includes('Pause or reset to choose another length.'), true);
    assert.equal(textIn(find(panel, (e) => 'data-focus-sessions' in e.props)), '2 focus sessions today');
    assert.equal(textIn(find(find(panel, (e) => e.type === 'Modal').props.footer, (e) => 'data-focus-primary' in e.props).children), 'Pause');
    tree = w.button();
    assert.equal(footerButton(tree).props['aria-label'], 'Focus timer: Focus, 18 minutes left');
    assert.match(find(tree, (e) => e.type === 'Tooltip').props.label, /^Focus · 1[78]:\d\d left$/);
    assert.equal(all(tree, (e) => e.type === 'span' && /fc-dot/.test(e.props.className)).length, 1, 'the running dot');

    // Paused.
    state = STATE({ rev: 3, timer: { kind: 'short', durationMs: 300000, remainingMs: 160000, endAt: null, running: false, doneAt: null } });
    find(find(w.overlay(), (e) => e.type === 'Modal').props.footer, (e) => 'data-focus-primary' in e.props).props.onClick();
    await w.settle();
    panel = w.overlay();
    assert.equal(textIn(find(panel, (e) => 'data-focus-state' in e.props)), 'Short break · paused, 2:40 left');
    assert.equal(textIn(find(find(panel, (e) => e.type === 'Modal').props.footer, (e) => 'data-focus-primary' in e.props).children), 'Resume');
    assert.equal(footerButton(w.button()).props['aria-label'], 'Focus timer: paused, 3 minutes left');
    w.close();
});

test('lengths from the panel: a preset sets the timer, a custom length is checked (1 to 180), a preset length typed is kept and also sets its idle timer', async () => {
    const state = STATE();
    const w = await window(() => [200, state], { stateful: true });
    footerButton(w.mount(() => w.button(), {}).tree).props.onClick({ currentTarget: null });
    await w.settle();
    const view = w.mount(() => w.overlay(), {});
    find(view.tree, (e) => e.props['data-focus-preset'] === 'short').props.onClick();
    await w.settle();
    assert.deepEqual(w.calls.at(-1).body, { op: { op: 'set', kind: 'short', durationMs: 300000 } });
    const field = () => find(view.tree, (e) => e.props['data-focus-field'] === 'focusMin');
    field().props.onChange({ target: { value: '500' } });
    field().props.onBlur();
    assert.equal(field().props['aria-invalid'], true, 'out of range: marked');
    assert.equal(w.calls.at(-1).body.op.kind, 'short', 'and not sent');
    field().props.onChange({ target: { value: '50' } });
    assert.equal(field().props['aria-invalid'], undefined);
    field().props.onKeyDown({ key: 'Enter', preventDefault() {} });
    await w.settle();
    assert.deepEqual(w.calls.at(-1).body, { settings: { focusMin: 50 }, op: { op: 'set', kind: 'focus', durationMs: 3000000 } }, 'the idle, unstarted focus timer follows its new length');
    const longField = () => find(view.tree, (e) => e.props['data-focus-field'] === 'longMin');
    longField().props.onChange({ target: { value: '20' } });
    longField().props.onBlur();
    await w.settle();
    assert.deepEqual(w.calls.at(-1).body, { settings: { longMin: 20 } }, 'another preset\'s length: the setting only');
    const custom = () => find(view.tree, (e) => 'data-focus-custom' in e.props);
    const setButton = () => find(view.tree, (e) => 'data-focus-custom-set' in e.props);
    assert.deepEqual([custom().props['aria-label'], custom().props.min, custom().props.max, custom().props.type], ['Custom length in minutes', 1, 180, 'number']);
    assert.equal(setButton().props.disabled, true, 'nothing typed: Set is off');
    custom().props.onChange({ target: { value: '181' } });
    assert.equal(setButton().props.disabled, true);
    assert.equal(textIn(view.tree).includes('From 1 to 180 minutes.'), true);
    custom().props.onChange({ target: { value: '45' } });
    assert.equal(setButton().props.disabled, false);
    setButton().props.onClick();
    await w.settle();
    assert.deepEqual(w.calls.at(-1).body, { op: { op: 'set', kind: 'custom', durationMs: 2700000 } });
    w.close();
});

test('the end, said once: a toast in DSH\'s words when a new doneAt comes, never for the state found at first read, and said with its time when seen late', async () => {
    let state = STATE({ timer: { kind: 'focus', durationMs: 1500000, remainingMs: 1500000, endAt: null, running: false, doneAt: Date.now() - 3600000 } });
    const w = await window(() => [200, state]);
    const toast = () => find(w.overlay(), (e) => e.type === 'Toast');
    assert.equal(toast(), undefined, 'a timer that had ended before the window opened is not announced');
    state = STATE({ rev: 5, timer: { kind: 'focus', durationMs: 1500000, remainingMs: 1500000, endAt: null, running: false, doneAt: Date.now() - 400 }, sessions: { date: '2026-10-26', focus: 1 } });
    footerButton(w.button()).props.onClick({ currentTarget: null }); // opening reads the state
    await w.settle();
    assert.deepEqual([toast()?.props.text, toast()?.props.tone], ['Focus session done. Time for a break.', 'success']);
    toast().props.onDone();
    assert.equal(toast(), undefined);
    footerButton(w.button()).props.onClick({ currentTarget: null });
    await w.settle();
    assert.equal(toast(), undefined, 'the same end is said once');
    state = STATE({ rev: 7, timer: { kind: 'short', durationMs: 300000, remainingMs: 300000, endAt: null, running: false, doneAt: Date.now() - 5 * 60000 } });
    footerButton(w.button()).props.onClick({ currentTarget: null });
    await w.settle();
    assert.match(toast()?.props.text, /^Short break timer ended at \d{1,2}:\d{2}\s?[AP]M\.$/, 'seen late: said with its time');
    assert.equal(textIn(find(w.overlay(), (e) => 'data-focus-state' in e.props)).startsWith('Short break · done at '), true);
    w.close();
});

test('error states: no state at all says what to check, with Try again; a later failed read keeps the state and says it may be out of date; a refusal is a toast in the host\'s words', async () => {
    let mode = 'down';
    const w = await window(({ method }) => {
        if (mode === 'down') throw new Error('offline');
        if (mode === 'fail') return [500, { error: 'Focus could not do that: disk full' }];
        if (method === 'POST') return [409, { error: 'A timer is already running. Pause or reset it first.' }];
        return [200, STATE()];
    });
    footerButton(w.button()).props.onClick({ currentTarget: null });
    await w.settle();
    let panel = w.overlay();
    assert.equal(textIn(find(panel, (e) => 'data-focus-error' in e.props)), 'Focus can\'t reach its timer: the window has no connection to DSH. Check that the Focus plugin is on in Plugins, then try again.');
    const retry = find(find(panel, (e) => e.type === 'Modal').props.footer ?? [], (e) => e.type === 'Button');
    assert.equal(textIn(retry.children), 'Try again');
    mode = 'up';
    retry.props.onClick();
    await w.settle();
    panel = w.overlay();
    assert.equal(textIn(find(panel, (e) => 'data-focus-state' in e.props)), 'Focus · ready, 25:00');
    mode = 'fail';
    footerButton(w.button()).props.onClick({ currentTarget: null });
    await w.settle();
    panel = w.overlay();
    assert.equal(textIn(find(panel, (e) => 'data-focus-stale' in e.props)), 'Focus can\'t reach its timer right now (Focus could not do that: disk full); this may be out of date. It tries again every few seconds.');
    assert.equal(textIn(find(panel, (e) => 'data-focus-state' in e.props)), 'Focus · ready, 25:00', 'the last state stays');
    mode = 'up';
    find(find(panel, (e) => e.type === 'Modal').props.footer, (e) => 'data-focus-primary' in e.props).props.onClick();
    await w.settle();
    const toast = find(w.overlay(), (e) => e.type === 'Toast');
    assert.equal(toast.props.text, 'Not changed: A timer is already running. Pause or reset it first.');
    assert.equal(toast.props.icon?.type, 'IconWarningOutlineRegular');
    w.close();
});

test('the host\'s problems show at the bottom of the panel', async () => {
    const w = await window(() => [200, STATE({ problems: ['dataDir must be a full path (starting with / or ~/), not "x"; Focus keeps its timer in /h/.dsh/focus.'] })]);
    footerButton(w.button()).props.onClick({ currentTarget: null });
    await w.settle();
    assert.match(textIn(find(w.overlay(), (e) => 'data-focus-problems' in e.props)), /^dataDir must be a full path/);
    w.close();
});

// ── the style sheet and the source, held to DESIGN.md ───────────────────────

test('the client\'s style sheet and source follow DESIGN.md', async () => {
    const src = text('lib/client.js');
    const w = await window(() => [200, STATE()]);
    const css = w.appended[0].textContent;
    w.close();
    assert.ok(css.length > 1000, 'the style sheet is found');
    assert.doesNotMatch(src, /Geist|@font-face|fonts\.googleapis|font-family:\s*["']?[A-Z]/, 'DSH\'s font only');
    assert.doesNotMatch(src, /https?:\/\//, 'no address of another server');
    assert.deepEqual([...new Set(src.match(/--wp-[a-z-]+/g) ?? [])].filter((t) => !['--wp-blur', '--wp-tint'].includes(t)), [], 'of Wallpaper\'s tokens, only --wp-blur and --wp-tint');
    assert.deepEqual([...new Set(src.match(/(?<![-\w])wp-[a-z-]+/g) ?? [])], ['wp-still'], 'of Wallpaper\'s classes, only wp-still');
    // Each rule's selector, with @keyframes left out and @media opened up.
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '').replace(/@media[^{]*\{/g, '');
    const selectors = flat.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean);
    assert.ok(selectors.length > 30, `${selectors.length} rules`);
    for (const selector of selectors) {
        assert.doesNotMatch(selector, /(^|,)\s*(:root|html|body)\s*($|,)/, `no tokens on :root, html or body: ${selector}`);
        if (/(^|,)\s*body/.test(selector)) assert.match(selector, /^body\.wp-still /, `body only as body.wp-still: ${selector}`);
        for (const name of selector.match(/(?<![-\w])\.[a-z][\w-]*/g) ?? []) assert.match(name, /^\.(fc-|wp-still$)/, `one prefix: ${name} in ${selector}`);
    }
    assert.ok(css.includes('outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))'), 'DSH\'s focus ring');
    const roots = ':is(.fc-footbtn,.fc-body)';
    for (const sel of [`body.wp-still ${roots}`, `body.wp-still ${roots}::before`, `body.wp-still ${roots}::after`, `body.wp-still ${roots} *`, `body.wp-still ${roots} *::before`, `body.wp-still ${roots} *::after`]) assert.ok(css.includes(`${sel},`) || css.includes(`${sel}{`), sel);
    assert.ok(css.includes(`@media (prefers-reduced-motion:reduce){${roots},${roots}::before,${roots}::after,${roots} *,${roots} *::before,${roots} *::after{animation:none!important;transition:none!important}}`), 'reduced motion: everything still');
    assert.ok(css.includes('{animation:none!important;transition:none!important}'));
    assert.match(css, /\.fc-time\{[^}]*font-variant-numeric:tabular-nums/, 'the time in tabular figures');
    for (const token of [...new Set(css.match(/var\(--[\w-]+/g))]) assert.match(token, /^var\(--(dsw|ds)-/, `DSH's tokens only: ${token}`);
    assert.doesNotMatch(css, /backdrop-filter|z-index|position:fixed/, 'no floating layer of its own');
    assert.match(src, /fetch\(API \+ path/);
    assert.equal(count(src, /fetch\(/g), 1, 'one fetch, to its own route');
    assert.match(src, /const API = \(typeof window !== "undefined" && window\.__FOCUS_API__\) \|\| "\/api\/focus\/"/);
    assert.match(src, /h\(ui\.Modal, /);
    assert.match(src, /h\(ui\.Toast, /);
    assert.match(src, /try \{\n\t+const style = document\.createElement\("style"\);/, 'the style sheet put in inside a try');
});

// ── files and words ─────────────────────────────────────────────────────────

test('the plugin\'s files: package, patch, locale, icon; no other assistant\'s or maker\'s name anywhere', () => {
    const pkg = JSON.parse(text('package.json'));
    assert.equal(pkg.name, 'dsh-plugin-focus');
    assert.equal(pkg.version, '0.2.0');
    assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-primitives'));
    for (const f of pkg.files) assert.ok(existsSync(at(f)), f);
    assert.match(text('cordis.patch.yml'), /- insert:\n\s+- id: focus\n\s+name: dsh-plugin-focus/);
    assert.equal(JSON.parse(text('locale/en.json')).meta.title, 'Focus');
    assert.match(text('icon.svg'), /^<svg[\s\S]*<\/svg>\s*$/);
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
    for (const f of walk(pluginRoot)) assert.doesNotMatch(readFileSync(f, 'utf8'), OTHER_NAMES, f);
    for (const f of ['lib/index.js', 'lib/impl.js', 'lib/client.js', 'test/e2e/run.mjs']) execFileSync(process.execPath, ['--check', at(f)]);
    assert.match(text('lib/index.js'), /export const Config = z\.object\(\{\n\s+dataDir: z\.any\(\)/, 'any value is taken, and checked in words');
});

test('the README is the code\'s: its setting, ops, kinds, limits, status codes, states and words', () => {
    const readme = text('README.md');
    const words = readme.replace(/\s+/g, ' ');
    assert.match(readme, /\| `dataDir` \| a full path \(starting with `\/` or `~\/`\) \| `focus` in DSH's data folder/);
    for (const o of OPS) assert.match(readme, new RegExp(`\\| \`${o}\` \\|`), o);
    assert.ok(readme.includes(KINDS.map((k) => `\`${k}\``).join(', ')));
    assert.ok(readme.includes(`${MINUTES_MIN} to ${MINUTES_MAX} whole minutes`));
    assert.equal(DURATION_MIN_MS, 10000);
    assert.equal(DURATION_MAX_MS, 3 * 3600000);
    assert.ok(readme.includes('within 10 s to 3 h'));
    assert.ok(readme.includes(`(within ${DUE_SLACK_MS / 1000} s)`));
    assert.deepEqual([...readme.matchAll(/^\| (\d{3}) \|/gm)].map((m) => Number(m[1])), [200, 400, 405, 409, 500]);
    assert.deepEqual([...readme.matchAll(/^\| (ready|running|paused|done) \| `([^`]+)` \| (\w+)/gm)].map((m) => [m[1], m[3]]), [['ready', 'Start'], ['running', 'Pause'], ['paused', 'Resume'], ['done', 'Start']]);
    const src = text('lib/client.js');
    for (const said of ['Focus session done. Time for a break.', 'Break over. Ready to focus?', 'Pause or reset to choose another length.', 'Chime when a timer ends', 'Try again']) {
        assert.ok(words.includes(said), `README: ${said}`);
        assert.ok(src.includes(said), `client: ${said}`);
    }
    assert.ok(words.includes('Focus can\'t reach its timer: <why>. Check that the Focus plugin is on in Plugins, then try again.'));
    assert.ok(src.includes('`Focus can\'t reach its timer: ${why}. Check that the Focus plugin is on in Plugins, then try again.`'));
    assert.ok(words.includes('A timer is already running. Pause or reset it first.'));
    assert.ok(text('lib/impl.js').includes('A timer is already running. Pause or reset it first.'));
    assert.ok(src.includes('const POLL_MS = 5000;') && words.includes('every 5 seconds'), 'the poll the README names');
    assert.ok(src.includes('const LATE_MS = 60000;') && words.includes('A window that was hidden at the end says it later, with the time it ended ("Focus timer ended at 10:25 AM."), without the chime.'));
});
