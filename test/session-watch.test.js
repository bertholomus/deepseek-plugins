// The session watcher (plugins/session-watch): its fold, and the watcher over a stand-in DSH.
// index.js needs DSH's own packages, so its wiring is checked end to end in DSH Test (scripts/e2e.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INITIAL, KEY, STATE_VERSION, TEXT_MAX, applyEvent, endOf, foldAll, goalOf, parseState, sessionWatchProjection, todoSummary, viewOf } from '../plugins/session-watch/lib/fold.js';
import { SessionWatch } from '../plugins/session-watch/lib/watch.js';
import { Hub } from '../plugins/session-watch/lib/shared/hub.js';
import { fakeDsh } from './helpers/fake-dsh.mjs';
import { manualClock, settle } from './helpers/clock.mjs';

const ev = (type, data = {}, time = 1000) => ({ type, time, data });
const text = (t) => ({ role: 'assistant', content: [{ type: 'text', text: t }] });

// ── The fold ───────────────────────────────────────────────────────────

test('fold: turns, replies, tools, todos, goal, approvals and title, from events', () => {
    let s = foldAll([
        ev('session/title', { title: '  Build   the parser ' }, 900),
        ev('turn/start', { turn: 1 }, 1000),
        ev('user/message', { id: 'u1', source: { kind: 'user' } }, 1001),
        ev('tool/call', { name: 'bash' }, 1002),
        ev('todo/write', { todos: [{ content: 'Lexer', status: 'completed' }, { content: 'Parser', status: 'in_progress' }, { content: 'Tests', status: 'pending' }] }, 1003),
        ev('goal/change', { operation: 'create', goal: { id: 'g1', revision: 2, objective: 'Ship the parser', phase: 'active', maxGoalRounds: 10 }, roundsStarted: 1 }, 1004),
        ev('approval/asked', { id: 'a1', toolName: 'bash', callId: 'c1', reason: 'writes outside the folder' }, 1005),
        ev('assistant/message', { turn: 1, message: text('Halfway there.') }, 1006),
    ]);
    assert.equal(s.title, 'Build the parser');
    assert.equal(s.turn, 1);
    assert.equal(s.open, true);
    assert.equal(s.startedAt, 1000);
    assert.equal(s.userAt, 1001);
    assert.equal(s.inKind, 'user');
    assert.equal(s.tools, 1);
    assert.equal(s.steps, 1);
    assert.deepEqual(s.todos, { open: 2, active: 1, done: 1, total: 3, next: 'Parser' });
    assert.deepEqual(s.goal, { id: 'g1', rev: 2, phase: 'active', objective: 'Ship the parser', rounds: 1, max: 10 });
    assert.deepEqual(s.approvals, [{ id: 'a1', tool: 'bash', call: 'c1', reason: 'writes outside the folder', at: 1005 }]);
    assert.equal(s.text, 'Halfway there.');
    s = applyEvent(s, ev('approval/decided', { id: 'a1', outcome: 'approved' }, 1007));
    assert.equal(s.approvals, undefined);
    s = applyEvent(s, ev('user/message', { id: 'r2', source: { kind: 'goal', goalId: 'g1', round: 2 } }, 1008));
    assert.equal(s.goal.rounds, 2, 'a goal round message moves the round count');
    assert.equal(s.userAt, 1001, 'only a person\'s message is a person writing');
    s = applyEvent(s, ev('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'provider', message: '502 from the gateway' } } }, 1009));
    assert.equal(s.open, false);
    assert.deepEqual(s.end, { turn: 1, kind: 'error', at: 1009, code: 'provider', error: '502 from the gateway' });
    assert.equal(s.errors, 1);
    s = applyEvent(s, ev('turn/start', { turn: 2 }, 1010));
    s = applyEvent(s, ev('turn/end', { turn: 2, reason: { kind: 'completed' } }, 1011));
    assert.equal(s.errors, undefined, 'a completed turn clears the error count');
    s = applyEvent(s, ev('goal/change', { operation: 'clear' }, 1012));
    assert.equal(s.goal, undefined);
});

test('fold: never throws, and gives the same object back when nothing changed', () => {
    const s = foldAll([ev('turn/start', { turn: 1 })]);
    assert.equal(applyEvent(s, ev('assistant/message', { message: text('   ') })), s, 'an empty reply changes nothing');
    assert.equal(applyEvent(s, ev('something/else')), s);
    assert.equal(applyEvent(s, null), s);
    assert.equal(applyEvent(s, { type: 42 }), s);
    assert.equal(applyEvent(s, ev('approval/decided', { id: 'never-asked' })), s);
    assert.equal(applyEvent(s, ev('turn/start', { turn: 1 }, 1000)), s, 'the same turn start again is no change');
    assert.deepEqual(applyEvent(undefined, ev('turn/start', { turn: 3 })).turn, 3, 'a missing state starts from the beginning');
    assert.doesNotThrow(() => applyEvent(s, { type: 'todo/write', data: { todos: [null, 7, { status: 'completed' }] } }));
    assert.doesNotThrow(() => applyEvent(s, { type: 'goal/change', data: { goal: 'nope' } }));
});

test('fold: long replies keep their end, where agents ask; the window view leaves the text out', () => {
    const long = `${'x'.repeat(4000)}\nDECISION NEEDED: ship it? — recommend: yes`;
    const s = foldAll([ev('turn/start', { turn: 1 }), ev('assistant/message', { message: text(long) })]);
    assert.equal(s.text.length, TEXT_MAX);
    assert.ok(s.text.startsWith('…'));
    assert.ok(s.text.endsWith('recommend: yes'));
    const view = viewOf(s);
    assert.equal(view.text, undefined);
    assert.equal(view.turn, 1);
    assert.equal(viewOf(null), null);
});

test('fold: a saved state is made safe; the projection is registered under one key', () => {
    assert.deepEqual(parseState(undefined), INITIAL);
    assert.deepEqual(parseState({ turn: -3, open: 'yes', tools: 2.5, at: 'soon' }), { turn: 0, open: false, tools: 0, at: 0 });
    const kept = parseState({ turn: 4, open: true, tools: 9, at: 77, end: { kind: 'completed', turn: 4, at: 70 }, todos: { open: 1 }, goal: { id: 'g' }, approvals: [{ id: 'a' }, 'junk'], text: 'hi', title: 'T', inKind: 'user' });
    assert.equal(kept.turn, 4);
    assert.equal(kept.end.kind, 'completed');
    assert.deepEqual(kept.approvals, [{ id: 'a' }]);
    const projection = sessionWatchProjection();
    assert.equal(projection.key, KEY);
    assert.equal(KEY, 'sessionWatch');
    assert.equal(projection.stateVersion, STATE_VERSION);
    assert.equal(projection.init(), INITIAL);
    assert.equal(projection.apply, applyEvent);
    assert.equal(projection.wire.view({ text: 'x', turn: 1 }).text, undefined);
    assert.equal(projection.wire.viewSchema.parse('junk'), null);
});

test('fold: the ask at the end of a reply, with its turn; a later reply without one clears it; saved and shown without the text', () => {
    const reply = (turn, text) => ({ type: 'assistant/message', time: 10 * turn, data: { turn, message: { role: 'assistant', content: [{ type: 'text', text }] } } });
    let state = foldAll([{ type: 'turn/start', time: 1, data: { turn: 1 } }, reply(1, 'Both work.\nDECISION NEEDED: Postgres or SQLite? — recommend: SQLite'), { type: 'turn/end', time: 12, data: { turn: 1, reason: { kind: 'completed' } } }]);
    assert.deepEqual(state.ask, { kind: 'decision', question: 'Postgres or SQLite?', recommendation: 'SQLite', turn: 1 });
    assert.deepEqual(viewOf(state).ask, state.ask, 'cold sessions keep it in DSH\'s saved value');
    assert.equal(viewOf(state).text, undefined);
    assert.deepEqual(parseState(viewOf(state)).ask, state.ask);
    state = applyEvent(state, reply(2, 'Done: SQLite it is.'));
    assert.equal(state.ask, undefined);
    assert.equal(parseState({ ask: { kind: 'other', question: 'x', turn: 1 } }).ask, undefined, 'a saved ask is checked');
    assert.equal(parseState({ ask: { kind: 'blocked', question: 'x'.repeat(500), turn: 1 } }).ask.question.length, 400, 'kept short');
});

test('fold: turn ends, goals and todo lists in the watcher\'s words', () => {
    assert.deepEqual(endOf({ turn: 3, reason: { kind: 'aborted', reason: { kind: 'disposed' } } }, 5), { turn: 3, kind: 'aborted', at: 5, cause: 'disposed' });
    assert.deepEqual(endOf({}, 'x'), { turn: 0, kind: 'unknown', at: 0 });
    const g = goalOf({ goal: { id: 'g', revision: 1, objective: 'O', phase: 'active' }, roundsStarted: 5 });
    assert.equal(goalOf({ goal: { id: 'g', revision: 2, objective: 'O' }, roundsStarted: 3 }, g).rounds, 5, 'rounds never go back for the same goal');
    assert.equal(goalOf({ operation: 'clear' }, g), undefined);
    assert.equal(goalOf('junk', g), g);
    assert.equal(goalOf({ goal: { id: 'g', blockedReason: { message: 'needs a key' } } }).blocked, 'needs a key');
    assert.deepEqual(todoSummary([]), { open: 0, active: 0, done: 0, total: 0 });
    assert.deepEqual(todoSummary([{ content: 'A', status: 'pending' }, { content: 'B', status: 'pending' }]), { open: 2, active: 0, done: 0, total: 2, next: 'A' });
    assert.equal(todoSummary('junk'), undefined);
});

// ── The watcher over a stand-in DSH ───────────────────────────────────

function setup({ config = {}, dir = mkdtempSync(join(tmpdir(), 'session-watch-')), clock = manualClock(), dsh = fakeDsh({ now: clock.now }) } = {}) {
    const warnings = [];
    const logger = { info: () => {}, warn: (line) => warnings.push(line) };
    const hub = new Hub();
    let n = 0;
    const watch = new SessionWatch({
        ctx: dsh.ctx,
        config: { deliveryTimeoutSeconds: 600, ...config },
        logger,
        makeMessage: (body) => ({ id: `note-${++n}`, role: 'user', content: [{ type: 'text', text: body }], source: { kind: 'cordis-host-runner' } }),
        hub,
        dir,
        after: clock.after,
        now: clock.now,
    });
    dsh.attach(watch);
    const events = [];
    watch.on((event) => events.push(event));
    return { dir, clock, dsh, watch, hub, events, warnings };
}

test('watcher: lists every session with its state, live when loaded and saved when not', async () => {
    const { dsh, watch } = setup();
    dsh.add('cold', { title: 'Old work', cwd: '/work/old' });
    dsh.commit('cold', 'turn/start', { turn: 1 });
    dsh.commit('cold', 'turn/end', { turn: 1, reason: { kind: 'completed' } });
    dsh.add('child', { parentSessionId: 'cold' });
    dsh.add('new', { blank: true });
    dsh.write('live', 'Start the build');
    const rows = await watch.list();
    const byId = Object.fromEntries(rows.map((row) => [row.sessionId, row]));
    assert.equal(byId.cold.title, 'Old work');
    assert.equal(byId.cold.cwd, '/work/old');
    assert.equal(byId.cold.status, 'cold');
    assert.equal(byId.cold.word, 'idle');
    assert.equal(byId.cold.state.end.kind, 'completed');
    assert.equal(byId.child.parentSessionId, 'cold');
    assert.equal(byId.child.origin, 'subagent');
    assert.equal(byId.new.word, 'new');
    assert.equal(byId.live.status, 'running');
    assert.equal(byId.live.word, 'running');
    assert.equal(byId.live.state.open, true);
    assert.equal(byId.live.state.text, undefined, 'rows never carry reply text');
    assert.deepEqual((await watch.get('cold')).sessionId, 'cold');
});

test('watcher: DSH\'s list is read once for a burst of window reads, and a failed read keeps what it knew', async () => {
    const { dsh, watch, clock, warnings } = setup();
    dsh.add('a', { title: 'A' });
    let reads = 0;
    const list = dsh.ctx.sessionController.list;
    dsh.ctx.sessionController.list = async (...args) => { reads += 1; return list(...args); };
    await watch.list();
    await watch.list();
    assert.equal(reads, 1);
    await clock.advance(2000);
    await watch.list();
    assert.equal(reads, 2);
    dsh.ctx.sessionController.list = async () => { throw new Error('the store is busy'); };
    await clock.advance(2000);
    const rows = await watch.list();
    assert.deepEqual(rows.map((row) => row.sessionId), ['a']);
    assert.match(warnings.join('\n'), /could not be read: the store is busy/);
});

test('watcher: another projection\'s value, live while loaded and as DSH saved it otherwise; a new session is listed at once', async () => {
    const { dsh, watch } = setup();
    dsh.add('cold', { title: 'Old', values: { userQuestions: { active: [{ callId: 'c', questions: [], state: 'continued' }], settled: [] } } });
    await watch.list();
    assert.deepEqual(watch.projection('cold', 'userQuestions'), { live: false, value: { active: [{ callId: 'c', questions: [], state: 'continued' }], settled: [] } });
    assert.equal(watch.projection('cold', 'coordinatorSession'), undefined);
    dsh.extra.userQuestions = () => ({ timed: true, questions: { active: [], settled: [] } });
    dsh.write('cold', 'Go on.');
    assert.deepEqual(watch.projection('cold', 'userQuestions'), { live: true, value: { timed: true, questions: { active: [], settled: [] } } });
    assert.equal(watch.projection('none', 'userQuestions'), undefined);
    // A session the cached list does not have yet makes the next list read DSH's again.
    dsh.write('fresh', 'Hello');
    assert.ok((await watch.list()).some((row) => row.sessionId === 'fresh'));
});

test('watcher: a delivery is queued, then delivered when the session reads it into a turn', async () => {
    const { dsh, watch, events } = setup();
    dsh.add('s', { title: 'Parser' });
    dsh.commit('s', 'turn/start', { turn: 1 });
    dsh.commit('s', 'turn/end', { turn: 1, reason: { kind: 'completed' } });
    const delivery = await watch.deliver('s', 'Carry on.');
    assert.equal(delivery.state, 'queued', 'the session\'s inbox shows it before deliver returns');
    assert.deepEqual(dsh.flushed, ['s'], 'the inbox is saved at once, so a stop now keeps the message');
    const done = await delivery.done;
    assert.equal(done.state, 'delivered');
    assert.equal(done.turn, 2, 'the turn that read it');
    const msg = dsh.sessions.get('s').events.find((event) => event.type === 'user/message');
    assert.equal(msg.data.id, delivery.id);
    assert.equal(msg.data.source.kind, 'cordis-host-runner');
    assert.deepEqual(events.filter((event) => event.type === 'delivery').map((event) => event.delivery.state), ['queued', 'delivered']);
    assert.deepEqual(Object.keys(delivery.toJSON()).sort(), ['at', 'deliveredAt', 'id', 'queuedAt', 'sessionId', 'state', 'turn']);
});

test('watcher: a running session is steered when asked, and gets a follow-up otherwise', async () => {
    const { dsh, watch } = setup();
    dsh.write('s', 'Do the work');
    const steered = await watch.deliver('s', 'Also check the tests.', { mode: 'steer' });
    assert.equal(dsh.agents.get('s').steered, 1);
    assert.equal((await steered.done).state, 'delivered');
    assert.equal(steered.turn, 1, 'read into the running turn');
    const queued = await watch.deliver('s', 'Then write the docs.');
    assert.equal(queued.state, 'queued');
    assert.equal(dsh.agents.get('s').steered, 1);
});

test('watcher: a delivery that cannot happen says why, and one never read times out as not delivered', async () => {
    const { dsh, watch, clock } = setup({ config: { deliveryTimeoutSeconds: 30 } });
    const missing = await watch.deliver('nope', 'Hello');
    assert.equal(missing.state, 'failed');
    assert.match(missing.reason, /^the session could not be opened: Session nope not found/);
    dsh.add('s');
    dsh.refuse = 'the inbox is closed';
    const refused = await watch.deliver('s', 'Hello');
    assert.equal(refused.state, 'failed');
    assert.equal(refused.reason, 'DSH refused the message: the inbox is closed');
    dsh.refuse = undefined;
    // A running turn that never reaches its next step leaves a follow-up in the queue.
    dsh.write('s', 'Long job');
    const stuck = await watch.deliver('s', 'When you can.');
    assert.equal(stuck.state, 'queued');
    await clock.advance(31000);
    assert.equal(stuck.state, 'failed');
    assert.equal(stuck.reason, 'it waited in the session\'s queue and no turn read it');
    assert.equal(watch.deliveries.size, 0);
});

test('watcher: a queued message DSH lets go unread fails the delivery', async () => {
    const { dsh, watch } = setup();
    dsh.write('s', 'Long job');
    const delivery = await watch.deliver('s', 'Next.');
    watch.onDiscarded(dsh.agents.get('s'), { id: delivery.id });
    assert.equal(delivery.state, 'failed');
    assert.equal(delivery.reason, 'the session let the message go without reading it');
});

test('watcher: a graceful stop and a crash both leave sessions it finds as cut off, checked against their logs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-watch-'));
    const clock = manualClock();
    const dsh = fakeDsh({ now: clock.now });
    const first = setup({ dir, clock, dsh });
    dsh.write('graceful', 'Long build');
    dsh.write('crash', 'Long test run');
    dsh.write('child', 'Subagent work');
    dsh.sessions.get('child').parentSessionId = 'crash';
    dsh.write('answered', 'Some work');
    dsh.write('old', 'Old work');
    first.watch.running.flush();
    const running = JSON.parse(readFileSync(join(dir, 'running.json'), 'utf8'));
    assert.deepEqual(Object.keys(running.sessions).sort(), ['answered', 'child', 'crash', 'graceful', 'old']);
    assert.equal(statSync(join(dir, 'running.json')).mode & 0o777, 0o600);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    // The crash: DSH dies under every running turn; then a graceful quit ends 'graceful' (as DSH does at a later stop).
    dsh.stop({ crash: true });
    dsh.commit('graceful', 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'disposed' } } });
    // Someone answered in 'answered' after the cut; 'old' was cut off long ago.
    dsh.commit('answered', 'turn/end', { turn: 1, reason: { kind: 'interrupted' } });
    await clock.advance(1000);
    dsh.commit('answered', 'user/message', dsh.message('I will take it from here.'));
    dsh.commit('old', 'turn/end', { turn: 1, reason: { kind: 'interrupted' } });
    dsh.sessions.get('old').events.at(-1).time = clock.now() - 8 * 3600000;
    // A new process: a new watcher over the same folder and sessions.
    const second = setup({ dir, clock, dsh });
    assert.deepEqual(Object.keys(second.watch.leftRunning).sort(), ['answered', 'child', 'crash', 'graceful', 'old']);
    const found = await second.watch.cutOffSessions({ withinMs: 6 * 3600000 });
    const ids = found.map((item) => item.sessionId).sort();
    assert.deepEqual(ids, ['crash', 'graceful']);
    const crash = found.find((item) => item.sessionId === 'crash');
    assert.equal(crash.end.kind, 'interrupted', 'a cold read closes the open turn as interrupted');
    assert.equal(found.find((item) => item.sessionId === 'graceful').end.cause, 'disposed');
    assert.equal(crash.title, '');
    assert.equal(crash.cwd, '/work/crash');
    // Nothing loaded the agents to find them.
    assert.equal(dsh.agents.size, 0);
});

test('watcher: running.json follows turns, so a clean stop leaves nothing to resume', async () => {
    const { dsh, watch, dir } = setup();
    dsh.write('s', 'Work');
    assert.ok(watch.running.data.sessions.s);
    dsh.end('s');
    assert.equal(watch.running.data.sessions.s, undefined);
    watch.close();
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'running.json'), 'utf8')).sessions, {});
});

test('watcher: tells listeners of turns, states and status, and a listener that throws stops nothing', async () => {
    const { dsh, watch, events, warnings, hub } = setup();
    watch.on(() => { throw new Error('boom'); });
    watch.on(async () => { throw new Error('async boom'); });
    dsh.write('s', 'Work');
    dsh.end('s', { kind: 'completed' }, { todos: [{ content: 'A', status: 'pending' }] });
    await settle();
    const types = events.map((event) => event.type);
    assert.ok(types.includes('agent'));
    assert.ok(types.includes('turn-start'));
    assert.ok(types.includes('turn-end'));
    assert.ok(types.includes('status'));
    const end = events.find((event) => event.type === 'turn-end');
    assert.equal(end.end.kind, 'completed');
    assert.equal(end.state.todos.open, 1, 'the turn end carries the state after the turn');
    assert.ok(events.some((event) => event.type === 'state' && event.change === 'todo/write'));
    assert.match(warnings.join('\n'), /a listener failed on turn-start: boom/);
    assert.match(warnings.join('\n'), /async boom/);
    assert.ok(hub.snapshot().versions.sessions > 0, 'windows hear of it through the hub');
});

test('watcher: questions for a person are raised, answered once, and dropped', async () => {
    const { watch, hub, warnings } = setup();
    const answers = [];
    const ask = watch.raiseAsk({ id: 'q1', sessionId: 's', source: 'Test', question: 'Go?', recommendation: 'Yes', onAnswer: (answer, by) => { answers.push([answer, by]); return { sent: true }; } });
    assert.equal(ask.onAnswer, undefined, 'windows never see the handler');
    assert.equal(watch.asks().length, 1);
    assert.ok(hub.snapshot().versions.asks >= 1);
    assert.deepEqual(await watch.answerAsk('q1', 'yes', 'you'), { ok: true, sent: true });
    assert.deepEqual(answers, [['yes', 'you']]);
    assert.deepEqual(await watch.answerAsk('q1', 'yes'), { ok: false, error: 'This question is no longer waiting.' });
    watch.raiseAsk({ id: 'q2', question: 'Again?', onAnswer: () => { throw new Error('the session is gone'); } });
    assert.deepEqual(await watch.answerAsk('q2', 'go'), { ok: false, error: 'the session is gone' });
    assert.match(warnings.join('\n'), /the answer to q2 failed/);
    watch.raiseAsk({ id: 'q3', question: 'Third?' });
    assert.equal(watch.dropAsk('q3'), true);
    assert.equal(watch.dropAsk('q3'), false);
    assert.throws(() => watch.raiseAsk({ question: 'No id' }), /needs an id and a question/);
});

test('watcher: an outside agent\'s state shows with its session', async () => {
    const { dsh, watch } = setup();
    dsh.add('t', { title: 'Terminal' });
    watch.setExternal('t', { status: 'waiting on you', label: 'coding agent' });
    assert.equal((await watch.get('t')).word, 'waiting on you');
    watch.setExternal('t', null);
    assert.equal(watch.rowOf('t').external, undefined);
});
