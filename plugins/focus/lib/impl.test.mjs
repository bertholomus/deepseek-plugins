// Offline test for the focus host (lib/impl.js) — plain node, no DSH running:
//   node lib/impl.test.mjs
// Per SPEC: the fake ctx's inject(deps, fn) calls fn({ effect, get }) on a fake connection whose
// fetch.register captures the route definition; the fake effect runs its function immediately.
// The captured handler is then driven with real Request objects.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { apply, inject, name, remainingOf, rollSessions } from './impl.js';

const STATE_URL = 'http://x/api/focus/state';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function fakeCtx() {
  let route = null;
  const connection = { fetch: { register: (def) => { route = def; } } };
  const ctx = { inject: (deps, fn) => fn({ effect: (fn2) => fn2(), get: () => connection }) };
  return { ctx, route: () => route };
}

const tmpRoot = mkdtempSync(join(tmpdir(), 'focus-impl-test-'));
let caseN = 0;

// apply() on an existing dataDir (also used to simulate a restart) → the new fetch handler.
async function start(dataDir) {
  const { ctx, route } = fakeCtx();
  await apply(ctx, { dataDir });
  const def = route();
  assert.equal(def.path, '/api/focus/state');
  assert.deepEqual(def.methods, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']); // the last three get the 405
  assert.equal(def.requestBody, 'buffered');
  return def.fetch;
}

// One apply() against its own temp dataDir, optionally seeded with a state.json.
async function setup(seed) {
  const dataDir = join(tmpRoot, `case-${++caseN}`);
  mkdirSync(dataDir);
  if (seed) writeFileSync(join(dataDir, 'state.json'), JSON.stringify(seed));
  return { dataDir, fetch: await start(dataDir) };
}

const GET = () => new Request(STATE_URL);
const POST = (payload) => new Request(STATE_URL, { method: 'POST', body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
async function call(handler, req) {
  const res = await handler(req);
  return { status: res.status, cacheControl: res.headers.get('cache-control'), body: await res.json() };
}

test('exports: name, inject, apply, remainingOf, rollSessions', () => {
  assert.equal(name, 'focus');
  assert.deepEqual(inject, []);
  assert.equal(typeof apply, 'function');
  const nowMs = Date.now();
  assert.equal(remainingOf({ running: true, endAt: nowMs + 5_000, remainingMs: 1 }, nowMs), 5_000);
  assert.equal(remainingOf({ running: true, endAt: nowMs - 5_000, remainingMs: 1 }, nowMs), 0, 'clamped at zero');
  assert.equal(remainingOf({ running: false, endAt: nowMs + 5_000, remainingMs: 123 }, nowMs), 123, 'idle → remainingMs is authoritative');
});

test('first run: defaults served, state.json + focus.log written', async () => {
  const { fetch, dataDir } = await setup();
  const { status, cacheControl, body } = await call(fetch, GET());
  assert.equal(status, 200);
  assert.equal(cacheControl, 'no-store');
  assert.deepEqual(body, {
    settings: { focusMin: 25, shortMin: 5, longMin: 15, chime: true },
    timer: { kind: 'focus', durationMs: 1_500_000, remainingMs: 1_500_000, endAt: null, running: false, doneAt: null, doneSeen: false },
    sessions: { date: today(), focus: 0 },
    rev: 0,
    problems: [],
  });
  const saved = JSON.parse(readFileSync(join(dataDir, 'state.json'), 'utf8'));
  const { problems, ...kept } = body;
  assert.deepEqual(saved, kept, 'state.json on disk matches what GET serves');
  assert.ok(existsSync(join(dataDir, 'focus.log')));
});

test('start: endAt lands in the future, remainingOf agrees', async () => {
  const { fetch } = await setup();
  const started = await call(fetch, POST({ op: { op: 'start', kind: 'focus', durationMs: 25 * 60_000 } }));
  assert.equal(started.status, 200);
  assert.equal(started.body.ok, true);
  assert.deepEqual(started.body.settings, { focusMin: 25, shortMin: 5, longMin: 15, chime: true }, 'POST echoes the full state');
  const t = started.body.timer;
  assert.equal(t.kind, 'focus');
  assert.equal(t.running, true);
  assert.equal(t.doneAt, null);
  assert.equal(t.remainingMs, 25 * 60_000);
  assert.ok(t.endAt > Date.now(), 'endAt is in the future');
  assert.ok(t.endAt - Date.now() <= 25 * 60_000);
  const got = await call(fetch, GET());
  assert.equal(got.body.timer.running, true);
  assert.ok(remainingOf(got.body.timer, Date.now()) > 0);
});

test('pause → resume preserves the remaining time; same-state ops are no-ops', async () => {
  const { fetch } = await setup();
  await call(fetch, POST({ op: { op: 'start', kind: 'custom', durationMs: 60_000 } }));
  const paused = await call(fetch, POST({ op: { op: 'pause' } }));
  assert.equal(paused.body.timer.running, false);
  assert.equal(paused.body.timer.endAt, null);
  const remaining = paused.body.timer.remainingMs;
  assert.ok(remaining > 59_000 && remaining <= 60_000, `just under the full minute, got ${remaining}`);
  const resumed = await call(fetch, POST({ op: { op: 'resume' } }));
  assert.equal(resumed.body.timer.running, true);
  assert.ok(Math.abs(resumed.body.timer.endAt - Date.now() - remaining) < 1_500, 'endAt ≈ now + remaining');
  const again = await call(fetch, POST({ op: { op: 'resume' } }));
  assert.equal(again.body.timer.endAt, resumed.body.timer.endAt, 'resume while running leaves endAt alone');
  // pause while idle: no null endAt math, state unchanged
  const idle = await setup();
  const p2 = await call(idle.fetch, POST({ op: { op: 'pause' } }));
  assert.equal(p2.status, 200);
  assert.deepEqual(p2.body.timer, { kind: 'focus', durationMs: 1_500_000, remainingMs: 1_500_000, endAt: null, running: false, doneAt: null, doneSeen: false });
});

test('reset: full duration back, doneAt cleared', async () => {
  const { fetch } = await setup();
  await call(fetch, POST({ op: { op: 'start', kind: 'short', durationMs: 30_000 } }));
  await call(fetch, POST({ op: { op: 'pause' } }));
  const reset = await call(fetch, POST({ op: { op: 'reset' } }));
  assert.deepEqual(reset.body.timer, { kind: 'short', durationMs: 30_000, remainingMs: 30_000, endAt: null, running: false, doneAt: null, doneSeen: false });
});

test('set: new kind/duration while idle', async () => {
  const { fetch } = await setup();
  const set = await call(fetch, POST({ op: { op: 'set', kind: 'long', durationMs: 15 * 60_000 } }));
  assert.deepEqual(set.body.timer, { kind: 'long', durationMs: 900_000, remainingMs: 900_000, endAt: null, running: false, doneAt: null, doneSeen: false });
});

test('complete: before the end it changes nothing; a timer that ended while DSH was closed ends at the next start, counted once, focus only', async () => {
  const { fetch } = await setup();
  await call(fetch, POST({ op: { op: 'start', kind: 'focus', durationMs: 60_000 } }));
  const early = await call(fetch, POST({ op: { op: 'complete' } }));
  assert.equal(early.status, 200);
  assert.equal(early.body.changed, false, 'a complete before the end is not one');
  assert.equal(early.body.timer.running, true);
  assert.equal(early.body.sessions.focus, 0);
  const ended = Date.now() - 5_000;
  for (const [kind, counted] of [['focus', 1], ['short', 0], ['long', 0], ['custom', 0]]) {
    const { fetch: f2, dataDir } = await setup({ timer: { kind, durationMs: 60_000, remainingMs: 60_000, endAt: ended, running: true, doneAt: null }, sessions: { date: today(), focus: 0 } });
    const got = await call(f2, GET());
    assert.equal(got.body.timer.running, false, `${kind}: ended`);
    assert.equal(got.body.timer.doneAt, ended, `${kind}: done as of its end, not of the start`);
    assert.equal(got.body.timer.remainingMs, 60_000);
    assert.equal(got.body.sessions.focus, counted, `${kind}: ${counted ? 'counted' : 'not a focus session'}`);
    const again = await call(await start(dataDir), GET());
    assert.equal(again.body.sessions.focus, counted, `${kind}: a second start counts nothing more`);
    const late = await call(f2, POST({ op: { op: 'complete' } }));
    assert.equal(late.body.changed, false, `${kind}: a window's complete after the end counts nothing more`);
    assert.equal(late.body.sessions.focus, counted);
  }
});

test('durations clamp to 10 s – 3 h; minutes round and clamp to 1–180; unknown settings keys dropped', async () => {
  const { fetch } = await setup();
  let r = await call(fetch, POST({ op: { op: 'start', kind: 'custom', durationMs: 500 } }));
  assert.equal(r.body.timer.durationMs, 10_000);
  r = await call(fetch, POST({ op: { op: 'set', kind: 'custom', durationMs: 99_999_999 } }));
  assert.equal(r.status, 409, 'a running timer is never thrown away by choosing another length');
  assert.match(r.body.error, /Pause or reset it first/);
  await call(fetch, POST({ op: { op: 'reset' } }));
  r = await call(fetch, POST({ op: { op: 'set', kind: 'custom', durationMs: 99_999_999 } }));
  assert.equal(r.body.timer.durationMs, 10_800_000);
  r = await call(fetch, POST({ settings: { focusMin: 0, shortMin: 999, longMin: 15.5, chime: false, bogus: 'dropped' } }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.settings, { focusMin: 1, shortMin: 180, longMin: 16, chime: false }, 'whole minutes');
});

test('one request can patch settings and run an op (patch applies first)', async () => {
  const { fetch } = await setup();
  const r = await call(fetch, POST({ settings: { focusMin: 40 }, op: { op: 'set', kind: 'focus', durationMs: 40 * 60_000 } }));
  assert.equal(r.body.settings.focusMin, 40);
  assert.equal(r.body.timer.durationMs, 2_400_000);
});

test('bad input → 400 { error } and nothing applied', async () => {
  const { fetch } = await setup();
  const bad = [
    ['malformed JSON', 'not json'],
    ['body is an array', [1, 2]],
    ['op is a string', { op: 'start' }],
    ['unknown op', { op: { op: 'frobnicate' } }],
    ['start without durationMs', { op: { op: 'start', kind: 'focus' } }],
    ['bad kind', { op: { op: 'start', kind: 'banana', durationMs: 60_000 } }],
    ['non-number durationMs', { op: { op: 'set', kind: 'focus', durationMs: '25m' } }],
    ['settings not an object', { settings: 25 }],
    ['settings.focusMin not a number', { settings: { focusMin: 'x' } }],
    ['settings.chime not a boolean', { settings: { chime: 'yes' } }],
  ];
  for (const [label, payload] of bad) {
    const r = await call(fetch, POST(payload));
    assert.equal(r.status, 400, `${label}: expected 400`);
    assert.equal(typeof r.body.error, 'string', `${label}: expected an error string`);
    assert.ok(r.body.error.length > 0, `${label}: error should not be empty`);
  }
  const got = await call(fetch, GET());
  assert.deepEqual(got.body.settings, { focusMin: 25, shortMin: 5, longMin: 15, chime: true }, 'settings untouched by the rejected requests');
  assert.equal(got.body.timer.running, false, 'timer untouched by the rejected requests');
  assert.equal(got.body.sessions.focus, 0, 'sessions untouched by the rejected requests');
  const res405 = await fetch(new Request(STATE_URL, { method: 'DELETE' }));
  assert.equal(res405.status, 405);
});

test('date rollover: rollSessions resets the count; a seeded old date resets on load', async () => {
  const s1 = { sessions: { date: '2020-01-01', focus: 5 } };
  assert.deepEqual(rollSessions(s1, '2026-10-11'), { date: '2026-10-11', focus: 0 });
  const s2 = { sessions: { date: '2026-10-11', focus: 7 } };
  assert.deepEqual(rollSessions(s2, '2026-10-11'), { date: '2026-10-11', focus: 7 }, 'same day keeps the count');
  assert.deepEqual(rollSessions(s2, '2026-10-12'), { date: '2026-10-12', focus: 0 });
  const { fetch } = await setup({
    settings: { focusMin: 30 },
    timer: { kind: 'focus', durationMs: 1_000, remainingMs: 1_000, endAt: null, running: false, doneAt: null },
    sessions: { date: '2020-01-01', focus: 3 },
  });
  const got = await call(fetch, GET());
  assert.deepEqual(got.body.sessions, { date: today(), focus: 0 });
  assert.equal(got.body.settings.focusMin, 30, 'unrelated saved settings survive the rollover');
});

test('state survives a restart: a second apply() serves the same running timer', async () => {
  const { dataDir, fetch } = await setup();
  const started = await call(fetch, POST({ op: { op: 'start', kind: 'long', durationMs: 600_000 } }));
  const fetch2 = await start(dataDir);
  const got = await call(fetch2, GET());
  assert.equal(got.body.timer.running, true);
  assert.equal(got.body.timer.endAt, started.body.timer.endAt, 'absolute endAt carried over');
  assert.ok(remainingOf(got.body.timer, Date.now()) > 0);
});

test('focus.log gets ISO-stamped lines for meaningful actions', async () => {
  const { fetch, dataDir } = await setup();
  await call(fetch, POST({ op: { op: 'start', kind: 'focus', durationMs: 60_000 } }));
  const lines = readFileSync(join(dataDir, 'focus.log'), 'utf8').trim().split('\n');
  assert.ok(lines.length >= 2, `expected a started line plus the start op, got ${lines.length}`);
  for (const line of lines) assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.ok(lines.some((l) => l.includes('start focus')));
});

after(() => { rmSync(tmpRoot, { recursive: true, force: true }); });
