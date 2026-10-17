// Autopilot (plugins/autopilot): its engine over the real session watcher and a stand-in DSH, its notes, its
// page's view and its browser half. index.js and remote.js need DSH's own packages; they run end to end in
// DSH Test (scripts/e2e.mjs autopilot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pilot, RULES, hasOpenWork, markOf, parseData, progressed } from '../plugins/autopilot/lib/pilot.js';
import { actionLabel, answerNote, carryOnNote, errorNote, nudgeNote, openWork, question, whyBackOff, whyResume } from '../plugins/autopilot/lib/notes.js';
import { lastWords, pageState } from '../plugins/autopilot/lib/page.js';
import { JsonStore } from '../plugins/autopilot/lib/shared/files.js';
import { Journal } from '../plugins/autopilot/lib/shared/journal.js';
import { Hub } from '../plugins/autopilot/lib/shared/hub.js';
import { SessionWatch } from '../plugins/session-watch/lib/watch.js';
import { fakeDsh } from './helpers/fake-dsh.mjs';
import { manualClock, settle } from './helpers/clock.mjs';
import { OTHER_NAMES, loadClient, elementsOf, textIn } from './helpers/client.mjs';

/** Autopilot's defaults (lib/index.js Config). */
const DEFAULTS = Object.freeze({
    enabled: true, defaultRule: 'auto', resumeAfterRestart: true, resumeWindowHours: 6, idleSeconds: 600, idleWindowHours: 2,
    maxNudges: 2, maxNotesPerHour: 20, errorRetrySeconds: [120, 600, 1800], startDelaySeconds: 20,
});

const TODOS = [
    { content: 'Write the lexer', status: 'completed' },
    { content: 'Write the parser', status: 'in_progress' },
    { content: 'Add tests', status: 'pending' },
];
const MIN = 60000;

/** Autopilot and the watcher over a stand-in DSH, all on one hand-moved clock. */
function setup({ config = {}, dir = mkdtempSync(join(tmpdir(), 'autopilot-')), clock = manualClock(), dsh = fakeDsh({ now: clock.now }), start = true } = {}) {
    const warnings = [];
    const logger = { info: () => {}, warn: (line) => warnings.push(line) };
    const hub = new Hub();
    let n = 0;
    const watch = new SessionWatch({
        ctx: dsh.ctx, config: { deliveryTimeoutSeconds: 600 }, logger, hub, dir: join(dir, 'session-watch'), after: clock.after, now: clock.now,
        makeMessage: (body) => ({ id: `note-${dir.length}-${++n}`, role: 'user', content: [{ type: 'text', text: body }], source: { kind: 'cordis-host-runner' } }),
    });
    dsh.attach(watch);
    const store = new JsonStore(join(dir, 'autopilot', 'state.json'), { parse: parseData, logger, delayMs: 5 });
    const journal = new Journal(join(dir, 'autopilot', 'events.jsonl'), { logger, now: clock.now, onChange: () => hub.bump('autopilot') });
    const notified = [];
    const merged = { ...DEFAULTS, ...config };
    const pilot = new Pilot({ watch, config: merged, store, journal, logger, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, notify: (item) => notified.push(item) });
    if (start) pilot.start();
    return { dir, clock, dsh, watch, pilot, store, journal, notified, warnings, hub, config: merged };
}

/** The notes Autopilot put into a session, as the session's own log shows them. */
const notesIn = (dsh, id) => dsh.sessions.get(id).events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'cordis-host-runner').map((event) => event.data.content[0].text);
const entries = (journal, kind) => journal.list({ limit: 400 }).filter((entry) => !kind || entry.kind === kind);

/** A session the person started, whose turn ended with open todos. */
function idleWithTodos(dsh, id = 's', { reply = 'Lexer done; the parser is next.', title = 'Build the parser' } = {}) {
    dsh.add(id, { title });
    dsh.write(id, 'Build the parser, with tests.');
    dsh.end(id, { kind: 'completed' }, { reply, todos: TODOS });
}

// ── Idle with open work ──────────────────────────────────────────────

test('idle with open todos: one note after the quiet time, proven delivered by the session\'s own log', async () => {
    const { dsh, clock, journal } = setup();
    idleWithTodos(dsh);
    await clock.advance(9 * MIN);
    assert.deepEqual(notesIn(dsh, 's'), [], 'nothing before the quiet time');
    await clock.advance(1 * MIN);
    const notes = notesIn(dsh, 's');
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^\[Autopilot\] You stopped with 2 open todos \(next: “Write the parser”\)\. Carry on with the next one/);
    assert.match(notes[0], /DECISION NEEDED: <question> — recommend: <your pick>/);
    const [entry] = entries(journal, 'nudge');
    assert.equal(entry.state, 'delivered', 'the log shows it read into a turn, not just sent');
    assert.equal(entry.turn, 2);
    assert.equal(entry.note, notes[0]);
    assert.match(entry.why, /^It has been idle for 10 minutes after turn 1 with 2 open todos, and its last reply asked you nothing\.$/);
    assert.equal(dsh.agents.get('s').status, 'running', 'the note started a turn');
});

test('idle: two notes with no progress, then Autopilot backs off and says so; progress or the person resets it', async () => {
    const { dsh, clock, journal, notified, pilot } = setup();
    idleWithTodos(dsh);
    await clock.advance(10 * MIN);
    dsh.end('s', { kind: 'completed' }, { reply: 'Looked at it.' });
    await clock.advance(10 * MIN);
    assert.equal(notesIn(dsh, 's').length, 2);
    dsh.end('s', { kind: 'completed' }, { reply: 'Still looking.' });
    await clock.advance(30 * MIN);
    assert.equal(notesIn(dsh, 's').length, 2, 'no third note');
    const [backoff] = entries(journal, 'backoff');
    assert.equal(backoff.state, 'backed off');
    assert.equal(backoff.why, whyBackOff(2));
    assert.equal(notified.at(-1).title, 'Autopilot backed off: Build the parser');
    assert.ok(pilot.data.sessions.s.backedOff);
    // The person writes: Autopilot starts fresh there.
    dsh.write('s', 'Try the other grammar.');
    assert.equal(pilot.data.sessions.s.backedOff, undefined);
    assert.equal(pilot.data.sessions.s.nudges, 0);
    dsh.end('s', { kind: 'completed' }, { reply: 'Switched grammars.' });
    await clock.advance(10 * MIN);
    assert.equal(notesIn(dsh, 's').length, 3);
});

test('idle: a todo done after a note counts as progress, so the count starts again', async () => {
    const { dsh, clock, pilot } = setup();
    idleWithTodos(dsh);
    await clock.advance(10 * MIN);
    assert.equal(pilot.data.sessions.s.nudges, 1);
    dsh.end('s', { kind: 'completed' }, { reply: 'Parser done.', todos: [TODOS[0], { ...TODOS[1], status: 'completed' }, TODOS[2]] });
    assert.equal(pilot.data.sessions.s.nudges, 0);
    await clock.advance(10 * MIN);
    assert.equal(pilot.data.sessions.s.nudges, 1);
    assert.match(notesIn(dsh, 's')[1], /1 open todo \(next: “Add tests”\)/);
});

test('idle: no note when the last reply asks the person, an approval waits, nothing is open, or a goal is paused or blocked', async () => {
    const { dsh, clock, pilot } = setup();
    idleWithTodos(dsh, 'asks', { reply: 'I can drop the old tables or migrate them.\nShould I drop them?' });
    idleWithTodos(dsh, 'decision', { reply: 'Blocked on the schema.\nDECISION NEEDED: drop the old tables? — recommend: migrate' });
    dsh.add('approval');
    dsh.write('approval', 'Deploy it');
    dsh.commit('approval', 'approval/asked', { id: 'ap1', toolName: 'bash', reason: 'pushes to production' });
    dsh.end('approval', { kind: 'completed' }, { todos: TODOS });
    dsh.add('done');
    dsh.write('done', 'One thing');
    dsh.end('done', { kind: 'completed' }, { reply: 'Done.', todos: TODOS.map((t) => ({ ...t, status: 'completed' })) });
    dsh.add('paused');
    dsh.setGoal('paused', 'Ship it', { phase: 'paused' });
    dsh.write('paused', 'Work');
    dsh.end('paused', { kind: 'completed' }, { todos: TODOS });
    await clock.advance(60 * MIN);
    for (const id of ['asks', 'decision', 'approval', 'done', 'paused']) assert.deepEqual(notesIn(dsh, id), [], id);
    assert.equal(pilot.plan('asks', 'idle', { force: true }).why, 'its last reply asks you something');
    assert.equal(pilot.plan('approval', 'idle', { force: true }).why, 'it waits for an approval');
    assert.equal(pilot.plan('done', 'idle', { force: true }).why, 'nothing is open');
    assert.equal(pilot.plan('paused', 'idle', { force: true }).why, 'its goal is paused');
});

test('idle with an active goal that stopped: the goal starts again, proven by the round it begins', async () => {
    const { dsh, clock, journal, watch } = setup();
    dsh.add('g', { title: 'Goal session' });
    dsh.write('g', 'Go');
    dsh.setGoal('g', 'Ship the parser');
    dsh.end('g', { kind: 'completed' }, { reply: 'Round done.' });
    await settle();
    // The goal driver ran a round on its own: an armed goal needs nothing from Autopilot.
    const goalTurns = () => dsh.sessions.get('g').events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'goal').length;
    assert.equal(goalTurns(), 1);
    dsh.end('g', { kind: 'completed' }, { reply: 'Round two done.' });
    await settle();
    assert.equal(goalTurns(), 2);
    // A restart of the agent disarms the goal (as a DSH restart does); the session stays idle.
    dsh.sessions.get('g').goal.activation = 'disarmed';
    dsh.end('g', { kind: 'completed' }, { reply: 'Waiting.' });
    await settle();
    assert.equal(goalTurns(), 2);
    await clock.advance(10 * MIN);
    assert.equal(goalTurns(), 3, 'Autopilot started it again');
    const [rearm] = entries(journal, 'rearm');
    assert.equal(rearm.state, 'started');
    assert.equal(rearm.reason, 'round 3 began');
    assert.match(rearm.why, /^Its goal “Ship the parser” is active but stopped/);
    assert.equal(notesIn(dsh, 'g').length, 0, 'a goal start, not a note');
    assert.equal(watch.goals, dsh.goals);
});

// ── Cut off by a stop ─────────────────────────────────────────────────

test('after a restart: a cut-off session gets a carry-on note, and its goal starts again once the note is read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autopilot-'));
    const clock = manualClock();
    const dsh = fakeDsh({ now: clock.now });
    const before = setup({ dir, clock, dsh });
    dsh.add('r', { title: 'Release build' });
    dsh.setGoal('r', 'Cut the release');
    dsh.write('r', 'Build and test the release.');
    dsh.commit('r', 'todo/write', { todos: TODOS });
    before.watch.running.flush();
    before.pilot.stop();
    before.store.close();
    dsh.stop({ crash: true });
    await clock.advance(2 * MIN);
    // DSH starts again: a new watcher and a new Autopilot over the same folder.
    const after = setup({ dir, clock, dsh });
    await clock.advance(19000);
    assert.deepEqual(notesIn(dsh, 'r'), [], 'nothing before the start delay');
    await clock.advance(1000);
    const notes = notesIn(dsh, 'r');
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^\[Autopilot\] DSH stopped while you were working: turn 1 was cut off at /);
    assert.match(notes[0], /Still open: 2 open todos \(next: “Write the parser”\) and the goal “Cut the release” \(round 0 of 20\)\./);
    const [resume] = entries(after.journal, 'resume');
    assert.equal(resume.state, 'delivered');
    assert.match(resume.why, /DSH stopped before it finished \(a quit, a restart or a crash\)\. Nobody has written in the session since\.$/);
    // The goal waits for the carry-on turn to end, then goes on by itself.
    const [rearm] = entries(after.journal, 'rearm');
    assert.equal(rearm.state, 'waiting for a round');
    dsh.end('r', { kind: 'completed' }, { reply: 'Checked; the build had finished. Tests next.' });
    await settle();
    assert.equal(after.journal.get(rearm.id).state, 'started');
    assert.equal(after.journal.get(rearm.id).reason, 'round 1 began');
    // The same cut is never handled twice, even by another restart.
    after.pilot.stop();
    dsh.end('r', { kind: 'completed' }, { reply: 'Tests pass.' });
    const again = setup({ dir, clock, dsh });
    await clock.advance(MIN);
    assert.equal(notesIn(dsh, 'r').length, 1);
    again.pilot.stop();
});

test('after a restart: sessions cut off too long ago, ones someone wrote in since, and Off sessions are left alone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'autopilot-'));
    const clock = manualClock();
    const dsh = fakeDsh({ now: clock.now });
    const before = setup({ dir, clock, dsh });
    for (const id of ['old', 'off', 'mine']) dsh.write(id, 'Work');
    before.pilot.setRule('off', 'off');
    before.watch.running.flush();
    before.pilot.stop();
    before.store.close();
    dsh.stop({ crash: false });
    dsh.sessions.get('old').events.at(-1).time = clock.now() - 7 * 3600000;
    dsh.save('old');
    await clock.advance(1000);
    dsh.commit('mine', 'user/message', dsh.message('I will finish this myself.'));
    const after = setup({ dir, clock, dsh });
    await clock.advance(MIN);
    for (const id of ['old', 'off', 'mine']) assert.deepEqual(notesIn(dsh, id), [], id);
    assert.equal(after.pilot.ruleOf('off'), 'off', 'rules survive the restart');
    after.pilot.stop();
});

test('a reload under a running turn (DSH still up): the cut-off session gets its note after a short wait', async () => {
    const { dsh, clock, journal } = setup();
    dsh.write('s', 'Work');
    dsh.end('s', { kind: 'aborted', reason: { kind: 'disposed' } });
    await clock.advance(14000);
    assert.equal(notesIn(dsh, 's').length, 0);
    await clock.advance(2000);
    assert.equal(notesIn(dsh, 's').length, 1);
    assert.match(entries(journal, 'resume')[0].why, /DSH shut down under it/);
});

// ── A failed turn ─────────────────────────────────────────────────────

test('a failed turn that stopped a goal: Autopilot starts it again after growing waits, then gives up and says so', async () => {
    const { dsh, clock, journal, notified, pilot } = setup();
    dsh.add('e', { title: 'Flaky provider' });
    dsh.setGoal('e', 'Finish the migration');
    dsh.write('e', 'Go');
    const fail = () => dsh.end('e', { kind: 'error', error: { code: 'provider', message: '502 from the gateway' } });
    fail();
    await clock.advance(119000);
    assert.equal(entries(journal, 'rearm').length, 0);
    await clock.advance(1000);
    assert.equal(entries(journal, 'rearm').length, 1, 'first try after 2 minutes');
    assert.match(entries(journal, 'rearm')[0].why, /^Turn 1 failed \(502 from the gateway\), which stops a goal/);
    await settle();
    fail();
    await clock.advance(10 * MIN);
    assert.equal(entries(journal, 'rearm').length, 2, 'second after 10 more');
    fail();
    await clock.advance(30 * MIN);
    assert.equal(entries(journal, 'rearm').length, 3, 'third after 30 more');
    fail();
    await clock.advance(60 * MIN);
    assert.equal(entries(journal, 'rearm').length, 3);
    const [giveup] = entries(journal, 'giveup');
    assert.equal(giveup.text, 'Stopped retrying after errors');
    assert.equal(notified.at(-1).title, 'Autopilot stopped retrying: Flaky provider');
    assert.ok(pilot.data.sessions.e.gaveUp);
    // Try again from the page starts over.
    const result = await pilot.retry('e');
    assert.equal(result.action, 'rearm');
    assert.equal(pilot.data.sessions.e.gaveUp, undefined);
});

test('a failed turn with open todos and no goal gets a carry-on note naming the error', async () => {
    const { dsh, clock } = setup();
    dsh.add('e');
    dsh.write('e', 'Go');
    dsh.end('e', { kind: 'error', error: { message: 'context window exceeded' } }, { todos: TODOS });
    await clock.advance(2 * MIN);
    const [note] = notesIn(dsh, 'e');
    assert.match(note, /^\[Autopilot\] Your last turn \(turn 1\) failed: context window exceeded\. Carry on from where you stopped\./);
    assert.match(note, /If the same error comes back, stop/);
});

// ── Rules, the switch, the limit ──────────────────────────────────────

test('Ask first: Autopilot asks in Decisions and on its page, and acts only on the answer', async () => {
    const { dsh, clock, journal, notified, watch, pilot } = setup({ config: { defaultRule: 'ask' } });
    idleWithTodos(dsh, 'a');
    await clock.advance(10 * MIN);
    assert.deepEqual(notesIn(dsh, 'a'), [], 'nothing sent before the answer');
    const [ask] = watch.asks();
    assert.equal(ask.source, 'Autopilot');
    assert.equal(ask.sessionId, 'a');
    assert.equal(ask.question, '“Build the parser” stopped with 2 open todos (next: “Write the parser”). Tell it to carry on?');
    assert.equal(ask.recommendation, 'Tell it to carry on');
    assert.deepEqual(ask.options.map((option) => option.id), ['go', 'skip']);
    assert.equal(ask.freeText, true);
    assert.equal(entries(journal, 'ask')[0].state, 'asked you');
    assert.equal(entries(journal, 'ask')[0].text, 'Asked you whether to tell it to carry on', 'the log says what was asked; its row names the session');
    assert.equal(notified.at(-1).kind, 'decision');
    // Looking again while the question waits asks nothing new.
    assert.equal((await pilot.check('a', 'idle')).again, true);
    assert.equal(watch.asks().length, 1);
    const answer = await watch.answerAsk(ask.id, 'go', 'you');
    assert.equal(answer.ok, true);
    assert.equal(answer.action, 'note');
    await settle();
    assert.equal(notesIn(dsh, 'a').length, 1);
    assert.equal(entries(journal, 'ask')[0].state, 'answered');
    assert.equal(entries(journal, 'nudge')[0].by, 'you');
});

test('Ask first: Leave it does nothing, and the person\'s own words go into the session', async () => {
    const { dsh, clock, journal, watch } = setup({ config: { defaultRule: 'ask' } });
    idleWithTodos(dsh, 'skip');
    idleWithTodos(dsh, 'words');
    await clock.advance(10 * MIN);
    const asks = Object.fromEntries(watch.asks().map((ask) => [ask.sessionId, ask]));
    await watch.answerAsk(asks.skip.id, 'skip', 'you');
    await watch.answerAsk(asks.words.id, 'Use the Pratt parser and skip the old tests.', 'you');
    await settle();
    assert.deepEqual(notesIn(dsh, 'skip'), []);
    assert.equal(entries(journal, 'answer')[0].text, 'Left it alone');
    assert.deepEqual(notesIn(dsh, 'words'), [answerNote('Use the Pratt parser and skip the old tests.')]);
});

test('rules: Off leaves a session alone, a session\'s own rule beats the default, and Use the default goes back', async () => {
    const { dsh, clock, pilot, journal } = setup();
    idleWithTodos(dsh, 'off');
    pilot.setRule('off', 'off');
    await clock.advance(30 * MIN);
    assert.deepEqual(notesIn(dsh, 'off'), []);
    assert.equal(pilot.ruleOf('off'), 'off');
    assert.equal(entries(journal, 'rule')[0].text, 'Rule set to Off.');
    pilot.setRule('off', undefined);
    assert.equal(pilot.ruleOf('off'), 'auto');
    assert.equal(entries(journal, 'rule')[0].text, 'Rule set to Auto (the default).');
    await clock.advance(MIN);
    assert.equal(notesIn(dsh, 'off').length, 1, 'going back to a rule that acts looks again at once');
    pilot.setDefaultRule('off');
    assert.equal(pilot.ruleOf('anything'), 'off');
    assert.throws(() => pilot.setRule('x', 'sometimes'), /The rule must be one of auto, ask, off/);
    assert.deepEqual(RULES, ['auto', 'ask', 'off']);
});

test('the kill switch stops every pending action at once, and switching back on looks again', async () => {
    const { dsh, clock, pilot, journal } = setup();
    idleWithTodos(dsh);
    assert.ok(pilot.pending().s);
    pilot.setPaused(true);
    assert.deepEqual(pilot.pending(), {});
    await clock.advance(30 * MIN);
    assert.deepEqual(notesIn(dsh, 's'), []);
    assert.equal((await pilot.check('s', 'idle')).why, 'Autopilot is off');
    assert.equal(entries(journal, 'switch')[0].text, 'Autopilot is off: no notes, no resumes, no goal starts.');
    pilot.setPaused(false);
    await clock.advance(1000);
    assert.equal(notesIn(dsh, 's').length, 1);
    assert.equal(pilot.store.data.paused, false);
});

test('the hourly limit holds notes back, says so once, and tries again later', async () => {
    const { dsh, clock, journal } = setup({ config: { maxNotesPerHour: 1 } });
    idleWithTodos(dsh, 'a');
    idleWithTodos(dsh, 'b');
    await clock.advance(10 * MIN);
    assert.equal(notesIn(dsh, 'a').length + notesIn(dsh, 'b').length, 1);
    const held = entries(journal, 'held');
    assert.equal(held.length, 1);
    assert.match(held[0].why, /already sent 1 notes in the last hour/);
    await clock.advance(60 * MIN);
    assert.equal(notesIn(dsh, 'a').length + notesIn(dsh, 'b').length, 2, 'the held one goes once the hour has room');
});

test('subagent sessions are left to their parent', async () => {
    const { dsh, pilot } = setup();
    dsh.add('child', { parentSessionId: 'p' });
    dsh.write('child', 'Sub work');
    dsh.end('child', { kind: 'completed' }, { todos: TODOS });
    await pilot.watch.list(undefined, { maxAgeMs: 0 });
    assert.equal(pilot.plan('child', 'idle', { force: true }).why, 'a subagent\'s session; its parent carries it');
});

test('Autopilot\'s state file is private and survives a broken write', async () => {
    const { pilot, dir, store } = setup();
    pilot.setRule('x', 'ask');
    store.flush();
    const file = join(dir, 'autopilot', 'state.json');
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).rules.x, 'ask');
    assert.deepEqual(parseData('junk'), parseData(undefined));
    assert.deepEqual(parseData({ rules: { a: 'auto', b: 'never' }, notes: [1, 'x', 2], paused: 'yes' }).rules, { a: 'auto' });
    assert.equal(parseData({ paused: 'yes' }).paused, false);
});

test('progress and open work, in the engine\'s terms', () => {
    const mark = markOf({ todos: { done: 1, open: 2 }, goal: { rounds: 3 } });
    assert.deepEqual(mark, { done: 1, open: 2, rounds: 3, tools: 0 });
    assert.equal(progressed(mark, { todos: { done: 1, open: 2 }, goal: { rounds: 3 } }), false);
    assert.equal(progressed(mark, { todos: { done: 2, open: 2 } }), true);
    assert.equal(progressed(mark, { todos: { done: 1, open: 1 } }), true);
    assert.equal(progressed(mark, { todos: { done: 1, open: 2 }, goal: { rounds: 4 } }), true);
    assert.equal(progressed(undefined, {}), false);
    assert.equal(hasOpenWork({ todos: { open: 1 } }), true);
    assert.equal(hasOpenWork({ goal: { phase: 'active' } }), true);
    assert.equal(hasOpenWork({ goal: { phase: 'completed' }, todos: { open: 0 } }), false);
});

// ── Words ─────────────────────────────────────────────────────────────

test('notes and questions in plain words, each signed [Autopilot]', () => {
    const now = Date.UTC(2026, 9, 17, 4, 30);
    const state = { todos: { open: 1, next: 'Add tests' }, goal: { phase: 'active', objective: 'Ship', rounds: 2, max: 5 } };
    assert.equal(openWork(state), '1 open todo (next: “Add tests”) and the goal “Ship” (round 2 of 5)');
    assert.equal(openWork({}), '');
    for (const note of [carryOnNote({ turn: 3, at: now - 60000 }, state, now), nudgeNote(state), errorNote({ turn: 3, error: 'boom' }, state), answerNote('yes')]) {
        assert.match(note, /^\[Autopilot\] /);
    }
    assert.match(whyResume({ kind: 'aborted', turn: 2, at: now }, now), /DSH shut down under it/);
    assert.equal(question({ kind: 'rearm' }, ''), 'This session has an active goal that stopped. Start the goal again?');
    assert.equal(question({ kind: 'resume' }, 'A very long title that keeps going and going and going past sixty characters'), '“A very long title that keeps going and going and going…” was cut off when DSH stopped. Tell it to carry on?');
    assert.equal(actionLabel({ action: 'rearm' }), 'Start the goal again');
    assert.equal(actionLabel({ action: 'note' }), 'Tell it to carry on');
});

// ── The page's view ───────────────────────────────────────────────────

test('page view: sessions with their rule, work, next check and last action; questions; settings; the log', async () => {
    const { dsh, clock, pilot, watch, journal, config } = setup({ config: { defaultRule: 'ask' } });
    idleWithTodos(dsh, 'a', { title: 'Parser' });
    dsh.add('blank', { blank: true });
    dsh.add('child', { parentSessionId: 'a' });
    pilot.setRule('a', 'ask');
    await clock.advance(10 * MIN);
    const view = await pageState({ pilot, watch, journal, config });
    assert.equal(view.enabled, true);
    assert.equal(view.paused, false);
    assert.equal(view.defaultRule, 'ask');
    assert.deepEqual(view.sessions.map((s) => s.sessionId), ['a'], 'no blank or subagent sessions');
    const [row] = view.sessions;
    assert.equal(row.title, 'Parser');
    assert.equal(row.folder, 'a');
    assert.equal(row.word, 'idle');
    assert.equal(row.work, '2 open todos (next: “Write the parser”)');
    assert.equal(row.rule, 'ask');
    assert.equal(row.own, true);
    assert.equal(row.last.text, 'asked you', 'a question reads as two words in its row');
    assert.equal(row.last.state, 'asked you');
    assert.equal(view.asks.length, 1);
    assert.equal(view.asks[0].onAnswer, undefined);
    assert.equal(view.watching, 1, 'the count matches the sessions listed');
    assert.deepEqual(Object.keys(view.settings).sort(), ['idleSeconds', 'maxNotesPerHour', 'maxNudges', 'resumeAfterRestart', 'resumeWindowHours']);
    assert.ok(view.log.length >= 2);
    JSON.stringify(view);
});

// ── The browser half ──────────────────────────────────────────────────

test('browser half: loads as DSH loads it, adds its entry (order 3) and page, and one style sheet', () => {
    const heads = [];
    const document = {
        querySelector: () => null,
        createElement: (type) => ({ type, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }),
        head: { appendChild: (tag) => { heads.push(tag); } },
    };
    const { id, client } = loadClient(new URL('../plugins/autopilot/lib/client.js', import.meta.url), { document });
    assert.equal(id, 'dsh-plugin-autopilot');
    assert.equal(heads.length, 0, 'styles wait for apply');
    const registered = [];
    const effects = [];
    const injected = [];
    const scope = {
        slots: { inject: (name, fn) => { fn(); }, register: (spec, component) => { registered.push({ spec, component }); return () => {}; } },
        uiWorkspace: { openSession: (sessionId) => { injected.push(sessionId); } },
        effect: (fn) => { effects.push(fn); },
    };
    const ctx = { ...scope, inject: (names, fn) => { if (names[0] === 'uiWorkspace') fn(scope); }, effect: (fn) => effects.push(fn) };
    client.apply(ctx);
    assert.equal(heads.length, 1);
    assert.equal(heads[0].attributes['data-plugin'], 'dsh-plugin-autopilot');
    assert.equal(heads[0].attributes['data-plugin-css'], 'dsh-plugin-autopilot/client.css');
    assert.match(heads[0].textContent, /\.dshap-card\{/);
    assert.match(heads[0].textContent, /body\.wp-still/);
    assert.match(heads[0].textContent, /prefers-reduced-motion/);
    assert.match(heads[0].textContent, /prefers-reduced-transparency/);
    const entry = registered.find((r) => r.spec.name === 'sidebar.panellist');
    assert.deepEqual({ ...entry.spec }, { name: 'sidebar.panellist', id: 'dsh-plugin-autopilot:page', order: 3, label: 'Autopilot' });
    const page = registered.find((r) => r.spec.name === 'main');
    assert.equal(page.spec.key, 'dsh-plugin-autopilot:page');
    page.spec.inject().autopilot.openSession('s1');
    assert.deepEqual(injected, ['s1']);
});

test('browser half: the page\'s cards say what to do next, in plain words', () => {
    const { client } = loadClient(new URL('../plugins/autopilot/lib/client.js', import.meta.url));
    const { HeaderCard, SessionsCard, LogCard, WaitingCard, AutopilotPage, TEXT, CSS } = client.internals;
    const base = { enabled: true, paused: false, defaultRule: 'auto', settings: { idleSeconds: 600, maxNotesPerHour: 20 }, notesLastHour: 3, watching: 4, sessions: [], asks: [], log: [] };
    const acts = [];
    const act = (method, args) => acts.push(JSON.parse(JSON.stringify([method, args])));
    // Loading, before the first read.
    assert.match(textIn(AutopilotPage({ autopilot: {} })), /Reading the sessions/);
    const head = HeaderCard({ data: base, busy: false, act });
    assert.match(textIn(head), /Watching 4 sessions · 3 of 20 notes used this hour · a session with open work gets a note after 10 minutes of quiet/);
    const toggle = elementsOf(head).find((e) => e.type === 'Switch');
    assert.equal(toggle.props.checked, true);
    toggle.props.onChange(false);
    assert.deepEqual(acts.at(-1), ['setPaused', { paused: true }]);
    const rules = elementsOf(head).find((e) => e.type === 'SegmentedControl');
    rules.props.onChange('ask');
    assert.deepEqual(acts.at(-1), ['setDefaultRule', { rule: 'ask' }]);
    assert.match(textIn(HeaderCard({ data: { ...base, paused: true }, busy: false, act })), /Off: no notes, no resumes, no goal starts/);
    assert.match(textIn(HeaderCard({ data: { ...base, enabled: false }, busy: false, act })), /switched off in its settings/);
    // Empty states that say what to do.
    assert.match(textIn(SessionsCard({ data: base, busy: false, act, onOpen: () => {} })), /Start a chat in DSH/);
    assert.match(textIn(LogCard({ data: base, onOpen: () => {} })), /When Autopilot acts, asks or holds back, it says what and why here/);
    assert.equal(WaitingCard({ data: base, busy: false, act, onOpen: () => {} }), null);
    // A session row and a log line.
    const opened = [];
    const data = {
        ...base,
        sessions: [{ sessionId: 's', title: 'Parser', folder: 'work', word: 'idle', work: '2 open todos', rule: 'auto', own: false, updatedAt: 1, backedOff: 5 }],
        asks: [{ id: 'q', sessionId: 's', question: 'Tell it to carry on?', recommendation: 'Tell it to carry on', why: 'It has been idle.', at: Date.now() }],
        log: [{ id: 'e', kind: 'nudge', sessionId: 's', title: 'Parser', text: 'Told it to carry on with its todos', why: 'It has been idle.', note: '[Autopilot] Carry on.', state: 'delivered', at: Date.now() }],
    };
    const sessions = SessionsCard({ data, busy: false, act, onOpen: (id) => opened.push(id) });
    assert.match(textIn(sessions), /Parser/);
    assert.match(textIn(sessions), /work · 2 open todos/);
    elementsOf(sessions).find((e) => e.type === 'button' && textIn(e) === 'Parser').props.onClick();
    assert.deepEqual(opened, ['s']);
    const waiting = WaitingCard({ data, busy: false, act, onOpen: () => {} });
    assert.match(textIn(waiting), /Tell it to carry on\?/);
    assert.match(textIn(waiting), /Autopilot backed off: its notes brought no progress\./);
    elementsOf(waiting).find((e) => e.type === 'Button' && textIn(e) === 'Try again').props.onClick();
    assert.deepEqual(acts.at(-1), ['retry', { sessionId: 's' }]);
    elementsOf(waiting).find((e) => e.type === 'Button' && textIn(e) === 'Leave it').props.onClick();
    assert.deepEqual(acts.at(-1), ['answer', { id: 'q', answer: 'skip' }]);
    const log = LogCard({ data, onOpen: () => {} });
    assert.match(textIn(log), /Why: It has been idle\./);
    assert.match(textIn(log), /What it sent\[Autopilot\] Carry on\./);
    // No other product's name anywhere in what it shows.
    const words = JSON.stringify(TEXT) + CSS.join('');
    assert.doesNotMatch(words, OTHER_NAMES);
});

test('page: a session\'s last action in a few words, names kept as written', () => {
    assert.equal(lastWords({ kind: 'rule', text: 'Rule set to Off.' }), 'rule set to Off');
    assert.equal(lastWords({ kind: 'nudge', text: 'Told it to carry on with its todos' }), 'told it to carry on with its todos');
    assert.equal(lastWords({ kind: 'ask', text: '“Config cleanup” stopped with 1 open todo. Tell it to carry on?' }), 'asked you');
    assert.equal(lastWords({ kind: 'skip', text: '' }), '');
});
