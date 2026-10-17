// Decisions (plugins/decisions): its card rules, its holds in DSH's approval and question requests, its inbox over
// the real session watcher and a stand-in DSH, its mirror, its config check, its page's view and its browser half.
// index.js and remote.js need DSH's own packages; they run end to end in real DSH (scripts/e2e.mjs decisions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    KINDS, answerMessage, answerWords, askCard, byUrgency, checkAnswers, coordinatorView, headline, mirrorText, questionCards, questionOf, readable, replyCard, threadCards,
} from '../plugins/decisions/lib/cards.js';
import { Holds, approvalProof, approvalWords, callArguments, describeCall, lateAnswerProof, questionProof, reasonText } from '../plugins/decisions/lib/holds.js';
import { Inbox, parseData } from '../plugins/decisions/lib/inbox.js';
import { Mirror, NO_ADDRESS, checkCommand, checkWebhook } from '../plugins/decisions/lib/mirror.js';
import { DEFAULTS, LIVE_SETTINGS, SETTING_TITLES, changedWords, checkConfig, savedEntry } from '../plugins/decisions/lib/config.js';
import { SettingsCheck } from '../plugins/decisions/lib/shared/settings.js';
import { pageState } from '../plugins/decisions/lib/page.js';
import { JsonStore } from '../plugins/decisions/lib/shared/files.js';
import { Journal } from '../plugins/decisions/lib/shared/journal.js';
import { Hub } from '../plugins/decisions/lib/shared/hub.js';
import { SessionWatch } from '../plugins/session-watch/lib/watch.js';
import { fakeDsh } from './helpers/fake-dsh.mjs';
import { manualClock, settle } from './helpers/clock.mjs';

const MIN = 60000;
const HOUR = 60 * MIN;

/** Decisions and the watcher over a stand-in DSH, on one hand-moved clock. */
function setup({ config = {}, dir = mkdtempSync(join(tmpdir(), 'decisions-')), clock = manualClock(), dsh = fakeDsh({ now: clock.now }), start = true, questions, mirror } = {}) {
    const warnings = [];
    const logger = { info: () => {}, warn: (line) => warnings.push(line) };
    const hub = new Hub();
    let n = 0;
    const watch = new SessionWatch({
        ctx: dsh.ctx, config: { deliveryTimeoutSeconds: 600 }, logger, hub, dir: join(dir, 'session-watch'), after: clock.after, now: clock.now,
        makeMessage: (body) => ({ id: `note-${dir.length}-${++n}`, role: 'user', content: [{ type: 'text', text: body }], source: { kind: 'cordis-host-runner' } }),
    });
    dsh.attach(watch);
    const store = new JsonStore(join(dir, 'decisions', 'state.json'), { parse: parseData, logger, delayMs: 5 });
    const journal = new Journal(join(dir, 'decisions', 'events.jsonl'), { logger, now: clock.now, onChange: () => hub.bump('decisions') });
    const notified = [];
    const mirrored = [];
    const fakeMirror = mirror ?? { on: true, place: 'sink', send: async (card) => { mirrored.push(card); return { ok: true }; }, status: () => ({ mode: 'webhook', place: 'sink' }) };
    const merged = { ...DEFAULTS, ...config };
    const inbox = new Inbox({
        watch, config: merged, store, journal, logger, mirror: fakeMirror, questions: () => questions,
        notify: (item) => notified.push(item), changed: () => hub.bump('decisions'), now: clock.now, after: clock.after,
    });
    if (start) inbox.start();
    return { dir, clock, dsh, watch, inbox, store, journal, hub, notified, mirrored, warnings, config: merged };
}

/** The messages Decisions put into a session, as its own log shows them. */
const notesIn = (dsh, id) => dsh.sessions.get(id).events.filter((event) => event.type === 'user/message' && event.data.source?.kind === 'cordis-host-runner').map((event) => event.data.content[0].text);
const entries = (journal, kind) => journal.list({ limit: 400 }).filter((entry) => !kind || entry.kind === kind);

/** A session whose last reply ends with `reply`, idle. */
function replied(dsh, id, reply, { title = 'Pick a database', ask = 'Choose a database for the cache.' } = {}) {
    dsh.add(id, { title });
    dsh.write(id, ask);
    dsh.end(id, { kind: 'completed' }, { reply });
}

const DECISION = 'I compared both: SQLite needs no server.\n\nDECISION NEEDED: Postgres or SQLite for the cache? — recommend: SQLite';

/**
 * The gateway's part, as DSH's: `forward(request)` reads the request's
 * signal when it starts and settles when a window answers, or rejects
 * (taking its card down) when that signal aborts.
 */
function windowStandIn() {
    const state = { cancelled: 0, forwarded: 0, pending: undefined };
    return {
        state,
        forward(request) {
            state.forwarded += 1;
            return new Promise((resolve, reject) => {
                const signal = request.signal;
                const abort = () => {
                    state.cancelled += 1;
                    reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'));
                };
                if (signal?.aborted) return abort();
                signal?.addEventListener('abort', abort, { once: true });
                state.pending = (value) => { signal?.removeEventListener('abort', abort); resolve(value); };
            });
        },
        answer(value) { state.pending?.(value); },
    };
}

/** A running session with an open turn and a tool call waiting for approval, as DSH logs one. */
function waitingApproval(dsh, id = 's', { callId = 'call-9', command = 'rm -rf build' } = {}) {
    dsh.add(id, { title: 'Clean the build' });
    dsh.write(id, 'Clean the build folder.');
    dsh.commit(id, 'tool/call', { name: 'bash', callId, arguments: JSON.stringify({ command, sandbox_permissions: 'danger-full-access', justification: 'the build folder is outside the workspace' }) });
    dsh.commit(id, 'approval/asked', { id: `ap-${callId}`, toolName: 'bash', callId, reason: 'escalate sandbox to danger-full-access: the build folder is outside the workspace' });
    const agent = dsh.agents.get(id);
    const turn = new AbortController();
    return {
        agent,
        turn,
        request: {
            agent, toolName: 'bash', callId,
            reason: 'escalate sandbox to danger-full-access: the build folder is outside the workspace',
            displayReason: { en: 'Allow this operation with danger-full-access permissions: the build folder is outside the workspace' },
            signal: turn.signal,
        },
    };
}

// ── Card rules ───────────────────────────────────────────────────────

test('cards: a reply\'s decision line, BLOCKED line or plain question is a card only while nothing moved after it', () => {
    const now = Date.UTC(2026, 9, 17, 6);
    const row = (state, fields = {}) => ({ sessionId: 's', title: 'Cache', status: 'idle', state, ...fields });
    const end = { kind: 'completed', turn: 3, at: now - MIN };
    const decision = { kind: 'decision', question: 'Postgres or SQLite?', recommendation: 'SQLite', turn: 3 };
    const card = replyCard(row({ ask: decision, end, inAt: now - 5 * MIN }), { now, windowMs: 72 * HOUR });
    assert.deepEqual({ id: card.id, kind: card.kind, question: card.question, recommendation: card.recommendation, answer: card.answer, at: card.at }, { id: 'decision:s:3', kind: 'decision', question: 'Postgres or SQLite?', recommendation: 'SQLite', answer: 'text', at: now - MIN });
    assert.equal(replyCard(row({ ask: decision, end }), { now }).title, 'Cache');
    assert.equal(replyCard(row({ ask: decision, end }, { status: 'running' }), { now }), undefined, 'running: the agent is still at it');
    assert.equal(replyCard(row({ ask: decision, end, open: true }), { now }), undefined, 'a turn is open');
    assert.equal(replyCard(row({ ask: decision, end, inAt: now - 30000 }), { now }), undefined, 'something was written in after the end');
    assert.equal(replyCard(row({ ask: decision, end, userAt: now - 30000 }), { now }), undefined, 'the person wrote after the end');
    assert.equal(replyCard(row({ ask: { ...decision, turn: 2 }, end }), { now }), undefined, 'the ask belongs to an earlier turn');
    assert.equal(replyCard(row({ ask: decision, end: { ...end, kind: 'interrupted' } }), { now }), undefined, 'cut off by a stop: Autopilot resumes it');
    assert.equal(replyCard(row({ ask: decision, end: { ...end, kind: 'error' } }), { now }), undefined, 'failed: no ask stands');
    assert.equal(replyCard(row({ ask: decision, end: { ...end, at: now - 73 * HOUR } }), { now, windowMs: 72 * HOUR }), undefined, 'older than the window');
    assert.equal(replyCard(row({ ask: decision, end }, { parentSessionId: 'p' }), { now }), undefined, 'a subagent asks its parent');
    const blocked = replyCard(row({ ask: { kind: 'blocked', question: 'no key for the staging bucket', turn: 3 }, end: { ...end, kind: 'blocked' } }), { now });
    assert.equal(blocked.kind, 'blocked');
    assert.equal(blocked.id, 'blocked:s:3');
    const plain = row({ ask: { kind: 'question', question: 'Should I also drop the old table?', turn: 3 }, end });
    assert.equal(replyCard(plain, { now }).kind, 'reply');
    assert.equal(replyCard(plain, { now, replies: false }), undefined, 'plain questions can be switched off');
    const offer = row({ ask: { kind: 'question', question: 'Let me know when you\'re ready to prep any of those.', soft: true, turn: 3 }, end });
    assert.equal(replyCard(offer, { now }), undefined, 'an offer waits on nobody');
    assert.equal(replyCard(row({ ask: { ...decision, soft: true }, end }), { now }).kind, 'decision', 'a decision line is a card whatever the words around it');
    assert.equal(readable({ sessionId: 's', origin: 'subagent' }), false);
});

test('cards: question-box calls DSH keeps, live or saved; only a call whose wait ran out is answered here', () => {
    const questions = [{ id: 'env', question: 'Which environment?', header: 'Deploy', options: [{ label: 'staging', description: 'safe' }, { label: 'production' }], multi_select: false }];
    const live = { timed: true, questions: { active: [{ callId: 'c1', questions, state: 'continued' }, { callId: 'c2', questions, state: 'open' }], settled: [] } };
    const row = { sessionId: 's', title: 'Deploy', status: 'idle', state: {} };
    const cards = questionCards(row, { live: true, value: live });
    assert.deepEqual(cards.map((c) => [c.id, c.answer, c.late === true]), [['question:s:c1', 'questions', true], ['question:s:c2', 'open', false]]);
    assert.deepEqual(cards[0].questions[0], { id: 'env', question: 'Which environment?', header: 'Deploy', options: [{ label: 'staging', description: 'safe' }, { label: 'production' }], multiSelect: false });
    // DSH's saved value is the view, without the outer state.
    assert.equal(questionCards(row, { live: false, value: live.questions }).length, 2);
    assert.deepEqual(questionCards(row, undefined), []);
    assert.equal(questionOf({ id: 'x' }), undefined, 'a question needs its text');
});

test('cards: a coordinator thread that handed back needing a decision, until the chat or the person moved', () => {
    const at = '2026-10-17T05:00:00.000Z';
    const view = {
        role: 'coordinator',
        threads: [
            { id: 't1', session: 'th1', title: 'Fix CI', resolved: false, handback: { status: 'needs_decision', summary: 'Pin node 20 or move to 22?', at } },
            { id: 't2', session: 'th2', title: 'Docs', resolved: false, handback: { status: 'done', summary: 'Done.', at } },
            { id: 't3', session: 'th3', title: 'Old', resolved: true, handback: { status: 'blocked', summary: 'No key.', at } },
            { id: 't4', session: 'th4', title: 'Answered', resolved: false, handback: { status: 'blocked', summary: 'No key.', at } },
        ],
        cards: [{ kind: 'handback', thread: 't1' }, { kind: 'handback', thread: 't4' }, { kind: 'send', thread: 't4' }],
    };
    const chat = { sessionId: 'c', title: 'Release', status: 'idle', state: {} };
    const rows = new Map([['th1', { sessionId: 'th1', status: 'idle', state: { inAt: Date.parse(at) - MIN } }]]);
    const cards = threadCards(chat, { live: true, value: { turn: 4, v: view } }, rows);
    assert.equal(cards.length, 1);
    assert.deepEqual({ id: cards[0].id, sessionId: cards[0].sessionId, title: cards[0].title, question: cards[0].question, via: cards[0].via.title, status: cards[0].status }, {
        id: `thread:th1:${Date.parse(at)}`, sessionId: 'th1', title: 'Fix CI', question: 'Pin node 20 or move to 22?', via: 'Release', status: 'needs_decision',
    });
    rows.set('th1', { sessionId: 'th1', status: 'running', state: {} });
    assert.deepEqual(threadCards(chat, { live: true, value: { v: view } }, rows), [], 'the thread is at work again');
    rows.set('th1', { sessionId: 'th1', status: 'idle', state: { inAt: Date.parse(at) + MIN } });
    assert.deepEqual(threadCards(chat, { live: true, value: { v: view } }, rows), [], 'someone wrote to the thread since');
    assert.deepEqual(threadCards(chat, { live: false, value: { ...view, off: true } }, new Map()), [], 'the chat stopped coordinating');
    assert.equal(coordinatorView({ role: 'thread' }).role, 'thread');
    assert.equal(coordinatorView(null), undefined);
});

test('cards: order, answers in words, headlines and the mirror\'s text', () => {
    const cards = [
        { id: 'decision:a:1', kind: 'decision', at: 100, answer: 'text' },
        { id: 'approval:b:c', kind: 'approval', at: 300, answer: 'approval' },
        { id: 'reply:c:1', kind: 'reply', at: 50, answer: 'text' },
        { id: 'question:d:c', kind: 'question', at: 200, answer: 'questions', live: true },
    ];
    assert.deepEqual([...cards].sort(byUrgency).map((c) => c.id), ['question:d:c', 'approval:b:c', 'reply:c:1', 'decision:a:1'], 'what holds a running turn first, then the oldest');
    assert.deepEqual(KINDS, ['approval', 'question', 'ask', 'decision', 'blocked', 'thread', 'reply']);
    const decision = { kind: 'decision', title: 'Cache', question: 'Postgres or SQLite?', recommendation: 'SQLite' };
    assert.equal(answerMessage(decision, { recommended: true }), '[Decisions] The person answered your DECISION NEEDED line (“Postgres or SQLite?”): go with your recommendation (SQLite).');
    assert.equal(answerMessage({ kind: 'blocked', question: 'no key' }, { text: '  The key is in 1Password, item "staging".  ' }), '[Decisions] The person answered your BLOCKED line (“no key”):\n\nThe key is in 1Password, item "staging".');
    assert.match(answerMessage({ kind: 'thread', question: 'Pin node 20?' }, { text: 'Move to 22.' }), /^\[Decisions\] The person answered your handback \(“Pin node 20\?”\):\n\nMove to 22\.$/);
    assert.equal(headline(decision), '“Cache” needs a decision');
    assert.equal(headline({ kind: 'approval', title: 'Deploy' }), '“Deploy” waits for your approval');
    assert.equal(headline({ kind: 'ask', title: 'Deploy', source: 'Autopilot' }), 'Autopilot asks about “Deploy”');
    assert.equal(mirrorText(decision), '“Cache” needs a decision\nPostgres or SQLite?\nRecommended: SQLite\nAnswer it in DSH: Decisions.');
    assert.equal(answerWords([{ id: 'a', selected: ['staging'] }, { id: 'b', selected: [], custom: 'later' }, { id: 'c', selected: [] }]), 'staging; later; skipped');
});

test('cards: a question-box answer is checked against its questions, in words', () => {
    const questions = [
        { id: 'env', question: 'Which environment?', options: [{ label: 'staging' }, { label: 'production' }], multiSelect: false },
        { id: 'checks', question: 'Which checks?', options: [{ label: 'lint' }, { label: 'tests' }], multiSelect: true },
    ];
    assert.deepEqual(checkAnswers(questions, [{ id: 'env', selected: ['staging'] }, { id: 'checks', selected: ['lint', 'tests'], custom: ' and the docs ' }]), {
        answers: [{ id: 'env', selected: ['staging'] }, { id: 'checks', selected: ['lint', 'tests'], custom: 'and the docs' }],
    });
    assert.deepEqual(checkAnswers(questions, [{ id: 'env', selected: [] }, { id: 'checks', selected: [] }]).answers[0], { id: 'env', selected: [] }, 'a skipped question');
    assert.throws(() => checkAnswers(questions, [{ id: 'env', selected: ['staging'] }]), /Answer “Which checks\?”, or skip it\./);
    assert.throws(() => checkAnswers(questions, [{ id: 'env', selected: ['qa'] }, { id: 'checks', selected: [] }]), /“qa” is not one of the choices\./);
    assert.throws(() => checkAnswers(questions, [{ id: 'env', selected: ['staging', 'production'] }, { id: 'checks', selected: [] }]), /Pick one choice for “Which environment\?”\./);
    assert.throws(() => checkAnswers(questions, [{ id: 'env', selected: [] }, { id: 'checks', selected: [] }, { id: 'x', selected: [] }]), /names a question that was not asked/);
    assert.throws(() => checkAnswers(questions, 'yes'), /one answer for each question/);
});

// ── Holds in DSH's requests ──────────────────────────────────────────

test('holds: approvals read as plain questions; the call\'s own arguments say what it does', () => {
    assert.deepEqual(approvalWords({ toolName: 'bash', reason: 'escalate sandbox to danger-full-access: the build folder is outside the workspace' }), { question: 'Allow this command with Full access?', why: 'the build folder is outside the workspace' });
    assert.deepEqual(approvalWords({ toolName: 'write', reason: 'escalate sandbox to workspace-write: save the report' }), { question: 'Allow this change with Workspace Write?', why: 'save the report' });
    assert.deepEqual(approvalWords({ toolName: 'deploy', displayReason: { en: 'Deploy to staging?' } }), { question: 'Deploy to staging?' });
    assert.deepEqual(approvalWords({ toolName: 'deploy' }), { question: 'deploy asks to run with more access than the session allows.' });
    assert.equal(reasonText({ displayReason: 'Shown words', reason: 'raw' }), 'Shown words');
    assert.deepEqual(describeCall({ command: 'rm -rf build', timeout: 30, sandbox_permissions: 'danger-full-access', justification: 'It cleans the build.' }), { what: 'rm -rf build', lines: ['timeout: 30'] }, 'the access asked for and why are on the card already');
    assert.deepEqual(describeCall({ path: '/tmp/a', content: 'x' }), { what: '/tmp/a', lines: ['content: x'] });
    assert.deepEqual(describeCall(undefined), { lines: [] });
    const dsh = fakeDsh();
    dsh.add('s');
    dsh.commit('s', 'tool/call', { name: 'bash', callId: 'k', arguments: '{"command":"ls"}' });
    dsh.commit('s', 'tool/call', { name: 'bash', callId: 'j', arguments: 'not json' });
    assert.deepEqual(callArguments(dsh.sessions.get('s').handle, 'k'), { command: 'ls' });
    assert.equal(callArguments(dsh.sessions.get('s').handle, 'j'), undefined);
    assert.equal(callArguments(dsh.sessions.get('s').handle, 'none'), undefined);
});

test('holds: answered in Decisions, DSH gets the answer and the window\'s card is taken down', async () => {
    const dsh = fakeDsh();
    const changes = [];
    const holds = new Holds({ onChange: (change) => changes.push(change), titleOf: () => 'Clean the build' });
    const { request, turn } = waitingApproval(dsh);
    const win = windowStandIn();
    const outcome = holds.approval(request, () => win.forward(request));
    await settle();
    assert.equal(win.state.forwarded, 1, 'DSH\'s own card still shows in the session');
    const [card] = holds.cards();
    assert.deepEqual({ id: card.id, kind: card.kind, question: card.question, detail: card.detail, what: card.what, tool: card.tool, live: card.live, title: card.title }, {
        id: 'approval:s:call-9', kind: 'approval', question: 'Allow this command with Full access?', detail: 'the build folder is outside the workspace', what: 'rm -rf build', tool: 'bash', live: true, title: 'Clean the build',
    });
    assert.notEqual(request.signal, turn.signal, 'the forwarded request carries Decisions\' signal joined to DSH\'s');
    assert.equal(holds.answer(card.id, 'allowed-once'), true);
    assert.equal(await outcome, 'allowed-once');
    await settle();
    assert.equal(win.state.cancelled, 1, 'the window\'s card was cancelled');
    assert.equal(turn.signal.aborted, false, 'DSH\'s own signal is never aborted for it');
    assert.deepEqual(holds.cards(), []);
    assert.deepEqual(changes.map((c) => [c.type, c.by]), [['held', undefined], ['settled', 'decisions']]);
    assert.equal(holds.answer(card.id, 'rejected'), false, 'one answer only');
});

test('holds: answered in the session first, the window\'s answer stands; a stopped turn stays stopped', async () => {
    const dsh = fakeDsh();
    const changes = [];
    const holds = new Holds({ onChange: (change) => changes.push(change) });
    const first = waitingApproval(dsh, 's', { callId: 'c1' });
    const win = windowStandIn();
    const outcome = holds.approval(first.request, () => win.forward(first.request));
    await settle();
    win.answer('rejected');
    assert.equal(await outcome, 'rejected');
    assert.deepEqual(holds.cards(), []);
    assert.deepEqual(changes.at(-1), { type: 'settled', card: changes[0].card, by: 'window', value: 'rejected' });

    const second = waitingApproval(dsh, 't', { callId: 'c2' });
    const win2 = windowStandIn();
    const stopped = holds.approval(second.request, () => win2.forward(second.request));
    await settle();
    second.turn.abort(new Error('the turn was stopped'));
    await assert.rejects(stopped, /the turn was stopped/);
    assert.equal(changes.at(-1).by, 'window');
    assert.match(changes.at(-1).error, /the turn was stopped/);
});

test('holds: Decisions stopping lets the window decide; a request it cannot read passes on untouched', async () => {
    const dsh = fakeDsh();
    const holds = new Holds({});
    const { request } = waitingApproval(dsh);
    const win = windowStandIn();
    const outcome = holds.approval(request, () => win.forward(request));
    await settle();
    holds.stop();
    assert.deepEqual(holds.cards(), []);
    win.answer('allowed-once');
    assert.equal(await outcome, 'allowed-once');
    // Stopped: nothing is held any more.
    let called = 0;
    assert.equal(await holds.approval(request, async () => { called += 1; return 'unavailable'; }), 'unavailable');
    assert.equal(called, 1);
    const fresh = new Holds({});
    assert.equal(await fresh.approval({ toolName: 'x' }, async () => 'unavailable'), 'unavailable', 'no agent: passed on');
    assert.equal(await fresh.question({ agent: { id: 's' }, questions: [{ id: 'a' }] }, async () => 'next'), 'next', 'a question without text: passed on');
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(await fresh.approval({ agent: { id: 's' }, toolName: 'x', signal: aborted.signal }, async () => 'cancelled'), 'cancelled', 'already stopped: passed on');
    assert.deepEqual(fresh.cards(), []);
});

test('holds: a question-box call is held with its choices and answered in DSH\'s shape', async () => {
    const holds = new Holds({ titleOf: () => 'Deploy' });
    const signal = new AbortController().signal;
    const request = {
        agent: { id: 's', session: undefined },
        questions: [{ id: 'env', question: 'Which environment?', options: [{ label: 'staging' }, { label: 'production' }], multi_select: false }],
        signal,
        wait: { callId: 'call-q', timed: true },
    };
    const win = windowStandIn();
    const answer = holds.question(request, () => win.forward(request));
    await settle();
    const [card] = holds.cards();
    assert.equal(card.id, 'question:s:call-q');
    assert.equal(card.answer, 'questions');
    assert.equal(card.timed, true);
    assert.deepEqual(card.questions[0].options.map((o) => o.label), ['staging', 'production']);
    holds.answer(card.id, { answers: [{ id: 'env', selected: ['staging'] }] });
    assert.deepEqual(await answer, { answers: [{ id: 'env', selected: ['staging'] }] });
});

test('holds: proof reads the session\'s own log', () => {
    const dsh = fakeDsh();
    dsh.add('s');
    const session = dsh.sessions.get('s').handle;
    dsh.commit('s', 'approval/asked', { id: 'a1', toolName: 'bash', callId: 'c1' });
    assert.equal(approvalProof(session, 'c1', 'allowed-once'), undefined, 'not decided yet');
    dsh.commit('s', 'approval/decided', { id: 'a1', outcome: 'allowed-once' });
    assert.equal(approvalProof(session, 'c1', 'allowed-once'), true);
    assert.equal(approvalProof(session, 'c1', 'rejected'), 'the session\'s log records “allowed-once”');
    dsh.commit('s', 'tool/call', { name: 'ask_user_question', callId: 'q1' });
    assert.equal(questionProof(session, 'q1'), undefined);
    dsh.commit('s', 'tool/result', { message: { toolCallId: 'q1', content: '{}' } });
    assert.equal(questionProof(session, 'q1'), true);
    assert.equal(lateAnswerProof(session, 'q2'), undefined);
    dsh.commit('s', 'user/message', { id: 'm', source: { kind: 'user-question-reply', callId: 'q2' } });
    assert.equal(lateAnswerProof(session, 'q2'), true);
});

// ── The inbox ────────────────────────────────────────────────────────

test('inbox: a decision line shows with its recommendation; going with it puts the answer into the session, proven by its log', async () => {
    const { dsh, clock, inbox, journal } = setup();
    await clock.advance(1000);
    replied(dsh, 's', DECISION);
    await clock.advance(1000);
    const { waiting } = await inbox.list();
    assert.equal(waiting.length, 1);
    const card = waiting[0];
    assert.deepEqual({ id: card.id, kind: card.kind, title: card.title, question: card.question, recommendation: card.recommendation, answer: card.answer }, {
        id: 'decision:s:1', kind: 'decision', title: 'Pick a database', question: 'Postgres or SQLite for the cache?', recommendation: 'SQLite', answer: 'text',
    });
    assert.equal(card.at, clock.now() - 1000, 'waiting since the turn ended');
    const result = await inbox.answer(card.id, { recommended: true });
    assert.ok(['in the queue', 'delivered'].includes(result.state));
    await clock.advance(1000);
    assert.deepEqual(notesIn(dsh, 's'), ['[Decisions] The person answered your DECISION NEEDED line (“Postgres or SQLite for the cache?”): go with your recommendation (SQLite).']);
    const [entry] = entries(journal, 'answer');
    assert.equal(entry.state, 'delivered', 'the session read it into a turn');
    assert.equal(entry.turn, 2);
    assert.equal(entry.text, 'Went with the recommendation: SQLite');
    assert.equal(dsh.agents.get('s').status, 'running', 'the answer started the next turn');
    assert.deepEqual((await inbox.list()).waiting, [], 'answered: gone');
    await assert.rejects(inbox.answer(card.id, { recommended: true }), /no longer waiting/);
});

test('inbox: a BLOCKED line is answered in the person\'s words; an empty answer or a missing recommendation is refused in words', async () => {
    const { dsh, clock, inbox, journal } = setup();
    replied(dsh, 'b', 'Tried both regions.\n\nBLOCKED: no write key for the staging bucket', { title: 'Upload assets' });
    await clock.advance(1000);
    const [card] = (await inbox.list()).waiting;
    assert.equal(card.kind, 'blocked');
    assert.equal(card.question, 'no write key for the staging bucket');
    await assert.rejects(inbox.answer(card.id, { text: '   ' }), /Write your answer first/);
    await assert.rejects(inbox.answer(card.id, { recommended: true }), /no recommendation to go with/);
    await assert.rejects(inbox.answer(card.id, { text: 'x'.repeat(8001) }), /under 8000 characters/);
    await inbox.answer(card.id, { text: 'Use the key in the team vault, item "staging-assets".' });
    await clock.advance(1000);
    assert.deepEqual(notesIn(dsh, 'b'), ['[Decisions] The person answered your BLOCKED line (“no write key for the staging bucket”):\n\nUse the key in the team vault, item "staging-assets".']);
    assert.equal(entries(journal, 'answer')[0].state, 'delivered');
});

test('inbox: a card whose session moved on is not answered; a refused delivery keeps the card, with the reason', async () => {
    const { dsh, clock, inbox, journal } = setup();
    replied(dsh, 's', DECISION);
    await clock.advance(1000);
    const [card] = (await inbox.list()).waiting;
    dsh.write('s', 'Actually, use Postgres.');
    await clock.advance(1000);
    await assert.rejects(inbox.answer(card.id, { recommended: true }), /no longer waiting: it was answered, or the session moved on/);

    replied(dsh, 't', DECISION, { title: 'Second' });
    await clock.advance(1000);
    const second = (await inbox.list()).waiting.find((c) => c.sessionId === 't');
    dsh.refuse = 'the agent is closing';
    await assert.rejects(inbox.answer(second.id, { recommended: true }), /Not delivered: DSH refused the message: the agent is closing\./);
    dsh.refuse = undefined;
    assert.equal(entries(journal, 'answer')[0].state, 'not delivered');
    assert.ok((await inbox.list()).waiting.some((c) => c.id === second.id), 'still waiting');
});

test('inbox: new cards notify once, also across a restart; what waited before Decisions came is listed, not announced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-'));
    const clock = manualClock();
    const dsh = fakeDsh({ now: clock.now });
    replied(dsh, 'old', DECISION, { title: 'Older' });
    const first = setup({ dir, clock, dsh });
    await clock.advance(1000);
    assert.equal((await first.inbox.list()).waiting.length, 1);
    assert.deepEqual(first.notified, [], 'the first look lists, it does not announce');
    assert.deepEqual(first.mirrored, []);
    replied(dsh, 'new', 'Done with the draft.\n\nDECISION NEEDED: Ship today or Monday? — recommend: Monday', { title: 'Release notes' });
    await clock.advance(1000);
    assert.deepEqual(first.notified, [{ title: '“Release notes” needs a decision', body: 'Ship today or Monday?', kind: 'decision', sessionId: 'new' }]);
    assert.deepEqual(first.mirrored.map((c) => c.id), ['decision:new:1']);
    const [arrived] = entries(first.journal, 'new');
    // The history row links the session, so the entry does not repeat its title.
    assert.equal(arrived.text, 'Needs a decision');
    assert.equal(arrived.title, 'Release notes');
    assert.equal(arrived.recommendation, 'Monday');
    first.inbox.stop();
    first.store.flush();
    // A new start over the same store: nothing is announced again.
    const second = setup({ dir, clock, dsh });
    await clock.advance(1000);
    assert.equal((await second.inbox.list()).waiting.length, 2);
    assert.deepEqual(second.notified, []);
    assert.deepEqual(second.mirrored, []);
});

test('inbox: many new cards at once make one notification; plugins\' own questions are not announced twice', async () => {
    const { dsh, clock, inbox, notified, mirrored, watch } = setup();
    await clock.advance(1000);
    for (const id of ['a', 'b', 'c', 'd']) replied(dsh, id, DECISION, { title: `Task ${id}` });
    await clock.advance(1000);
    assert.deepEqual(notified, [{ title: 'Decisions', body: '4 things wait on you. Open Decisions to answer them.', kind: 'decision' }]);
    assert.equal(mirrored.length, 4, 'the mirror says each one');
    watch.raiseAsk({ id: 'ap-1', sessionId: 'a', source: 'Autopilot', question: 'Nudge “Task a”?', options: [{ id: 'go', label: 'Send the nudge' }], onAnswer: () => {} });
    await clock.advance(1000);
    assert.equal(notified.length, 1, 'Autopilot tells the person itself');
    assert.equal((await inbox.list()).waiting.filter((c) => c.kind === 'ask').length, 1);
});

test('inbox: a held approval is answered here, proven by DSH\'s decision in the log; answered in the session, it says so', async () => {
    const { dsh, clock, inbox, journal, notified } = setup();
    await clock.advance(1000);
    const { request } = waitingApproval(dsh, 's', { callId: 'c1' });
    const win = windowStandIn();
    const outcome = inbox.holds.approval(request, () => win.forward(request));
    await clock.advance(1000);
    const [card] = (await inbox.list()).waiting;
    assert.equal(card.id, 'approval:s:c1');
    assert.equal(card.answer, 'approval', 'the held one, not the session\'s open one');
    assert.equal(card.what, 'rm -rf build');
    assert.equal(notified.at(-1).title, '“Clean the build” waits for your approval');
    await assert.rejects(inbox.answer(card.id, { decision: 'maybe' }), /Choose Allow once or Reject\./);
    await inbox.answer(card.id, { decision: 'allow' });
    assert.equal(await outcome, 'allowed-once');
    assert.equal(win.state.cancelled, 1);
    assert.equal(entries(journal, 'answer')[0].state, 'sending');
    dsh.commit('s', 'approval/decided', { id: 'ap-c1', outcome: 'allowed-once' });
    await clock.advance(1000);
    const [entry] = entries(journal, 'answer');
    assert.equal(entry.state, 'answered', 'DSH logged the decision');
    assert.equal(entry.text, 'Allowed once');

    const second = waitingApproval(dsh, 't', { callId: 'c2' });
    const win2 = windowStandIn();
    const outcome2 = inbox.holds.approval(second.request, () => win2.forward(second.request));
    await clock.advance(1000);
    win2.answer('rejected');
    assert.equal(await outcome2, 'rejected');
    await clock.advance(1000);
    assert.equal(entries(journal, 'elsewhere')[0].text, 'Answered in the session: rejected');
    assert.equal((await inbox.list()).waiting.some((c) => c.id === 'approval:t:c2'), true, 'until DSH logs the decision, the session\'s own approval still shows (open it to see)');
    dsh.commit('t', 'approval/decided', { id: 'ap-c2', outcome: 'rejected' });
    await clock.advance(1000);
    assert.deepEqual((await inbox.list()).waiting.filter((c) => c.kind === 'approval'), []);
});

test('inbox: an approval Decisions does not hold shows while its session runs, to be answered there', async () => {
    const { dsh, clock, inbox } = setup();
    waitingApproval(dsh, 's', { callId: 'c1' });
    await clock.advance(1000);
    const [card] = (await inbox.list()).waiting;
    assert.equal(card.answer, 'open');
    assert.equal(card.question, 'Allow this command with Full access?');
    await assert.rejects(inbox.answer(card.id, { decision: 'allow' }), /Only the session can answer this/);
    dsh.end('s', { kind: 'aborted', reason: { kind: 'user' } });
    await clock.advance(2000);
    assert.deepEqual((await inbox.list()).waiting, [], 'a stopped turn waits for nothing');
});

test('inbox: a question whose wait ran out is answered through DSH\'s question service, proven when the session reads it', async () => {
    const asked = [];
    const questions = {
        answer(agent, callId, batch) {
            asked.push({ id: agent.id, callId, batch });
            setImmediate(() => dsh.commit(agent.id, 'user/message', { id: 'late-1', source: { kind: 'user-question-reply', callId, outcome: 'answered' }, content: [{ type: 'text', text: '{}' }] }));
            return true;
        },
    };
    const clock = manualClock();
    const dsh = fakeDsh({ now: clock.now });
    const { inbox, journal } = setup({ clock, dsh, questions });
    const pending = { callId: 'call-1', questions: [{ id: 'env', question: 'Which environment?', options: [{ label: 'staging' }, { label: 'production' }] }], state: 'continued' };
    dsh.extra.userQuestions = (s) => (s.id === 'q' ? { timed: true, questions: { active: [pending], settled: [] } } : undefined);
    replied(dsh, 'q', 'I deployed nothing yet; asked which environment.', { title: 'Deploy' });
    await clock.advance(1000);
    const card = (await inbox.list()).waiting.find((c) => c.kind === 'question');
    assert.equal(card.answer, 'questions');
    assert.equal(card.late, true);
    await assert.rejects(inbox.answer(card.id, { answers: [{ id: 'env', selected: ['qa'] }] }), /“qa” is not one of the choices/);
    const result = await inbox.answer(card.id, { answers: [{ id: 'env', selected: ['staging'] }] });
    assert.equal(result.state, 'in the queue');
    assert.deepEqual(asked, [{ id: 'q', callId: 'call-1', batch: { answers: [{ id: 'env', selected: ['staging'] }] } }]);
    await clock.advance(1000);
    const [entry] = entries(journal, 'answer');
    assert.equal(entry.state, 'delivered');
    assert.equal(entry.text, 'Answered: staging');
});

test('inbox: DSH\'s refusals of a late answer come back in words', async () => {
    const clock = manualClock();
    const dsh = fakeDsh({ now: clock.now });
    const refusal = Object.assign(new Error('a reply is already queued for this question'), { code: 'REPLY_QUEUED' });
    const { inbox, journal } = setup({ clock, dsh, questions: { answer: () => { throw refusal; } } });
    dsh.extra.userQuestions = () => ({ timed: true, questions: { active: [{ callId: 'c', questions: [{ id: 'a', question: 'Go?' }], state: 'continued' }], settled: [] } });
    replied(dsh, 'q', 'Asked.', { title: 'Q' });
    await clock.advance(1000);
    const card = (await inbox.list()).waiting.find((c) => c.kind === 'question');
    await assert.rejects(inbox.answer(card.id, { answers: [{ id: 'a', selected: [], custom: 'yes' }] }), /Not sent: an answer to this question is already waiting to be read\./);
    assert.equal(entries(journal, 'answer')[0].state, 'not delivered');
    const off = setup({ clock, dsh });
    await clock.advance(1000);
    const again = (await off.inbox.list()).waiting.find((c) => c.kind === 'question');
    await assert.rejects(off.inbox.answer(again.id, { answers: [{ id: 'a', selected: [] }] }), /question box is not running here/);
});

test('inbox: a thread that needs a decision is answered straight into the thread, and its own reply is not listed twice', async () => {
    const { dsh, clock, inbox } = setup();
    const at = new Date(clock.now()).toISOString();
    replied(dsh, 'th', 'Both work.\n\nDECISION NEEDED: Pin node 20 or move to 22? — recommend: move to 22', { title: 'Fix CI' });
    dsh.add('c', { title: 'Release' });
    dsh.write('c', '/coordinate');
    dsh.end('c', { kind: 'completed' }, { reply: 'Started a thread for CI.' });
    dsh.extra.coordinatorSession = (s) => (s.id === 'c' ? {
        turn: 1,
        v: {
            role: 'coordinator',
            threads: [{ id: 't1', session: 'th', title: 'Fix CI', resolved: false, handback: { status: 'needs_decision', summary: 'Pin node 20 or move to 22?', at } }],
            cards: [{ turn: 1, seq: 3, kind: 'start', thread: 't1' }, { turn: 1, seq: 9, kind: 'handback', thread: 't1', status: 'needs_decision' }],
        },
    } : s.id === 'th' ? { turn: 1, v: { role: 'thread' } } : undefined);
    await clock.advance(1000);
    const { waiting } = await inbox.list();
    assert.deepEqual(waiting.map((c) => c.kind), ['thread'], 'the thread\'s own reply says the same: one card');
    const [card] = waiting;
    assert.equal(card.sessionId, 'th');
    assert.equal(card.recommendation, 'move to 22');
    assert.equal(card.via.title, 'Release');
    await inbox.answer(card.id, { text: 'Move to 22, and drop the 18 job.' });
    await clock.advance(1000);
    assert.deepEqual(notesIn(dsh, 'th'), ['[Decisions] The person answered your handback (“Pin node 20 or move to 22?”):\n\nMove to 22, and drop the 18 job.']);
    assert.deepEqual(notesIn(dsh, 'c'), [], 'the chat is not written to');
});

test('inbox: a plugin\'s question is answered through the watcher, and the plugin carries it out', async () => {
    const { dsh, clock, inbox, watch, journal } = setup();
    replied(dsh, 's', 'Parser done.', { title: 'Parser' });
    const answers = [];
    watch.raiseAsk({ id: 'ap-1', sessionId: 's', source: 'Autopilot', question: 'Nudge “Parser”?', recommendation: 'Send the nudge', why: 'Idle 10 minutes with open todos.', options: [{ id: 'go', label: 'Send the nudge' }, { id: 'skip', label: 'Leave it' }], freeText: true, onAnswer: (answer, by) => answers.push([answer, by]) });
    await clock.advance(1000);
    const card = (await inbox.list()).waiting.find((c) => c.kind === 'ask');
    assert.deepEqual({ source: card.source, detail: card.detail, title: card.title, options: card.options.map((o) => o.id) }, { source: 'Autopilot', detail: 'Idle 10 minutes with open todos.', title: 'Parser', options: ['go', 'skip'] });
    await assert.rejects(inbox.answer(card.id, { option: 'later' }), /not one of the choices/);
    await inbox.answer(card.id, { option: 'go' });
    assert.deepEqual(answers, [['go', 'you']]);
    const [entry] = entries(journal, 'answer');
    assert.equal(entry.text, 'Answered Autopilot: Send the nudge');
    assert.equal(entry.state, 'answered');
    assert.deepEqual((await inbox.list()).waiting.filter((c) => c.kind === 'ask'), []);
});

test('inbox: dismissed stays dismissed across a restart, and comes back on request', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-'));
    const clock = manualClock();
    const dsh = fakeDsh({ now: clock.now });
    const first = setup({ dir, clock, dsh });
    replied(dsh, 's', 'Shall I also update the changelog?', { title: 'Docs' });
    await clock.advance(1000);
    const [card] = (await first.inbox.list()).waiting;
    assert.equal(card.kind, 'reply');
    assert.equal(card.question, 'Shall I also update the changelog?');
    await first.inbox.dismiss(card.id);
    assert.deepEqual((await first.inbox.list()).waiting, []);
    assert.equal(entries(first.journal, 'dismiss')[0].text, 'Dismissed');
    assert.equal(entries(first.journal, 'dismiss')[0].title, 'Docs');
    first.inbox.stop();
    first.store.flush();
    const second = setup({ dir, clock, dsh });
    await clock.advance(1000);
    const listed = await second.inbox.list();
    assert.deepEqual(listed.waiting, []);
    assert.deepEqual(listed.dismissed.map((c) => c.id), [card.id]);
    await second.inbox.undismiss(card.id);
    assert.deepEqual((await second.inbox.list()).waiting.map((c) => c.id), [card.id]);
    // The history names what came back: its session, beside the words, and its question.
    const back = entries(second.journal, 'undismiss')[0];
    assert.deepEqual([back.text, back.title, back.sessionId, back.question], ['Brought back', 'Docs', 's', 'Shall I also update the changelog?']);
    await assert.rejects(second.inbox.undismiss(card.id), /not dismissed/);
    await assert.rejects(second.inbox.dismiss('nope'), /no longer waiting/);
});

test('inbox: sources switched off are not listed; a subagent\'s asks go to its parent; old replies age out', async () => {
    const { dsh, clock, inbox } = setup({ config: { replies: false, windowHours: 1 } });
    replied(dsh, 'plain', 'Should I keep going?', { title: 'Plain' });
    dsh.add('sub', { parentSessionId: 'p', title: 'Sub' });
    dsh.write('sub', 'Look.');
    dsh.end('sub', { kind: 'completed' }, { reply: DECISION });
    replied(dsh, 'old', DECISION, { title: 'Old' });
    await clock.advance(1000);
    assert.deepEqual((await inbox.list()).waiting.map((c) => c.sessionId), ['old']);
    await clock.advance(2 * HOUR);
    assert.deepEqual((await inbox.list()).waiting, [], 'older than windowHours');
});

test('inbox: the badge counts what waits and what holds a running turn; the page reads it all', async () => {
    const { dsh, clock, inbox, journal, config } = setup();
    replied(dsh, 's', DECISION);
    const { request } = waitingApproval(dsh, 'a', { callId: 'c1' });
    const win = windowStandIn();
    inbox.holds.approval(request, () => win.forward(request)).catch(() => {});
    await clock.advance(1000);
    assert.deepEqual(await inbox.badge(), { waiting: 2, urgent: 1 });
    const mirror = new Mirror({ config, journal });
    const page = await pageState({ inbox, journal, config, mirror, notifications: () => true });
    assert.deepEqual(page.waiting.map((c) => c.kind), ['approval', 'decision']);
    assert.deepEqual(page.sources, { approvals: true, questions: true, replies: true, threads: true });
    assert.equal(page.notifications, true);
    assert.equal(page.mirror.mode, 'off');
    assert.equal(page.problem, undefined);
    assert.ok(Array.isArray(page.history));
    const off = await pageState({ inbox, journal, config: { ...config, enabled: false }, mirror, notifications: () => false });
    assert.equal(off.enabled, false);
    assert.deepEqual(off.waiting, []);
    // A wrong setting: nothing listed, and the page says which.
    const check = new SettingsCheck({ settings: { ...config, windowHours: 0 }, check: checkConfig, liveKeys: LIVE_SETTINGS, label: 'decisions' });
    check.run();
    const wrong = await pageState({ inbox, journal, config, check, mirror, watch: { settings: { problem: { text: 'x', live: true } } } });
    assert.deepEqual(wrong.waiting, []);
    assert.equal(wrong.problem.key, 'windowHours');
    assert.equal(wrong.problem.live, true);
    assert.match(wrong.problem.text, /^Keep a reply's question for \(windowHours\) must be a whole number of hours from 1 to 720 \(it is 0\)$/);
    assert.deepEqual(wrong.watchProblem, { text: 'x', live: true });
    inbox.stop();
});

test('inbox: stored state is made safe when read', () => {
    assert.deepEqual(parseData(undefined), { version: 1, seeded: false, seen: {}, dismissed: {}, answered: {} });
    assert.deepEqual(parseData({ seeded: true, seen: { a: 1, b: 'x' }, dismissed: [], answered: { c: 2 } }), { version: 1, seeded: true, seen: { a: 1 }, dismissed: {}, answered: { c: 2 } });
});

test('holds: a kind switched off lets its held requests go back to DSH\'s own card; a stop holds nothing until resumed', async () => {
    const dsh = fakeDsh();
    const holds = new Holds({});
    const approval = waitingApproval(dsh, 'a', { callId: 'c1' });
    const question = { agent: { id: 'q', session: undefined }, questions: [{ id: 'q1', question: 'Which?', options: [{ label: 'A' }] }], wait: { callId: 'w1' } };
    const winA = windowStandIn();
    const winQ = windowStandIn();
    const fromA = holds.approval(approval.request, () => winA.forward(approval.request));
    const fromQ = holds.question(question, () => winQ.forward(question));
    await settle();
    assert.deepEqual(holds.cards().map((c) => c.kind).sort(), ['approval', 'question']);
    holds.release('approval');
    assert.deepEqual(holds.cards().map((c) => c.kind), ['question'], 'only approvals let go');
    // Let go means DSH's own card still answers: the window's answer comes back as DSH's.
    winA.answer('allowed-once');
    assert.equal(await fromA, 'allowed-once');
    holds.stop();
    assert.deepEqual(holds.cards(), []);
    winQ.answer({ answers: [] });
    assert.deepEqual(await fromQ, { answers: [] });
    let passed = false;
    await holds.approval(waitingApproval(dsh, 'b', { callId: 'c2' }).request, () => { passed = true; return 'rejected'; });
    assert.ok(passed, 'stopped: passed on untouched');
    assert.deepEqual(holds.cards(), []);
    holds.resume();
    void holds.approval(waitingApproval(dsh, 'c', { callId: 'c3' }).request, () => new Promise(() => {}));
    assert.equal(holds.cards().length, 1, 'held again after resume');
    holds.release();
});

// ── The mirror ───────────────────────────────────────────────────────

/** A local webhook that records what it gets and answers `status`. */
async function sink(status = 204) {
    const got = [];
    const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            got.push({ method: req.method, type: req.headers['content-type'], body: JSON.parse(body || '{}') });
            res.statusCode = status;
            res.end();
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { got, url: `http://127.0.0.1:${server.address().port}/hook/secret-token`, close: () => new Promise((resolve) => server.close(resolve)) };
}

const CARD = { id: 'decision:s:1', kind: 'decision', title: 'Cache', question: 'Postgres or SQLite?', recommendation: 'SQLite', sessionId: 's' };

/** The webhook address as DSH's key store gives it: read for each message. */
const keyStore = (value) => {
    const store = { value, reads: 0 };
    store.read = async () => {
        store.reads += 1;
        return store.value;
    };
    return store;
};

test('mirror: a webhook gets the card as plain words with mentions off; the address comes from the key store and never reaches the log', async () => {
    const hook = await sink();
    try {
        const journal = new Journal(join(mkdtempSync(join(tmpdir(), 'decisions-')), 'events.jsonl'));
        const key = keyStore(hook.url);
        const mirror = new Mirror({ config: { ...DEFAULTS, mirror: 'webhook' }, journal, readAddress: key.read });
        assert.deepEqual(await mirror.send(CARD), { ok: true });
        assert.deepEqual(hook.got, [{ method: 'POST', type: 'application/json', body: { content: mirrorText(CARD), allowed_mentions: { parse: [] } } }]);
        const [entry] = journal.list();
        assert.equal(entry.state, 'sent');
        assert.equal(entry.text, `Sent to 127.0.0.1:${new URL(hook.url).port}`);
        const page = await mirror.describe();
        assert.equal(page.mode, 'webhook');
        assert.equal(page.place, `127.0.0.1:${new URL(hook.url).port}`);
        assert.equal(page.key, 'DECISIONS_WEBHOOK_URL');
        assert.equal(page.lastHour, 1);
        assert.equal(page.problem, undefined);
        assert.deepEqual(await mirror.test(), { ok: true, place: `127.0.0.1:${new URL(hook.url).port}` });
        assert.ok(!JSON.stringify([journal.list(), page]).includes('secret-token'), 'the address is a secret');
        assert.ok(key.reads >= 3, 'read again for each message, so a new address applies at once');
    } finally {
        await hook.close();
    }
});

test('mirror: no address, a wrong one or a key store that fails is said once an hour, in words that never repeat the address', async () => {
    const clock = manualClock();
    const journal = new Journal(join(mkdtempSync(join(tmpdir(), 'decisions-')), 'events.jsonl'), { now: clock.now });
    const key = keyStore(undefined);
    const mirror = new Mirror({ config: { ...DEFAULTS, mirror: 'webhook' }, journal, readAddress: key.read, now: clock.now });
    assert.deepEqual(await mirror.send(CARD), { ok: false, reason: NO_ADDRESS });
    assert.deepEqual(await mirror.send(CARD), { ok: false, reason: NO_ADDRESS });
    const said = journal.list().filter((e) => e.text === 'Could not send new cards elsewhere');
    assert.equal(said.length, 1, 'said once, not per card');
    assert.equal(said[0].reason, NO_ADDRESS);
    assert.equal((await mirror.describe()).problem, NO_ADDRESS);
    key.value = 'http://example.com/hook/secret-token';
    assert.match((await mirror.send(CARD)).reason, /^The webhook address must start with https:\/\/ \(http:\/\/ only to this machine\), not http:\/\/$/);
    assert.equal(journal.list().filter((e) => e.text === 'Could not send new cards elsewhere').length, 2, 'a new reason is said');
    key.value = 'not an address secret-token';
    assert.match((await mirror.describe()).problem, /^The webhook address is not a web address/);
    const broken = new Mirror({ config: { ...DEFAULTS, mirror: 'webhook' }, journal, readAddress: async () => { throw new Error('locked'); }, now: clock.now });
    assert.equal((await broken.send(CARD)).reason, 'DSH\'s key store did not answer: locked');
    const test = await mirror.test();
    assert.equal(test.ok, false);
    assert.equal(journal.list()[0].state, 'not sent');
    assert.equal(journal.list()[0].by, 'you');
    assert.ok(!JSON.stringify(journal.list()).includes('secret-token'));
});

test('mirror: a refusal or an unreachable webhook is logged with the reason; past the hourly limit it holds back once', async () => {
    const hook = await sink(404);
    const clock = manualClock();
    try {
        const journal = new Journal(join(mkdtempSync(join(tmpdir(), 'decisions-')), 'events.jsonl'), { now: clock.now });
        const mirror = new Mirror({ config: { ...DEFAULTS, mirror: 'webhook', mirrorPerHour: 2 }, journal, readAddress: keyStore(hook.url).read, now: clock.now });
        const refused = await mirror.send(CARD);
        assert.equal(refused.ok, false);
        assert.match(refused.reason, /answered 404 \(check the webhook address\)$/);
        assert.equal(journal.list()[0].state, 'not sent');
        await mirror.send(CARD);
        assert.deepEqual(await mirror.send(CARD), { ok: false, reason: 'the hourly limit is reached' });
        assert.deepEqual(await mirror.send(CARD), { ok: false, reason: 'the hourly limit is reached' });
        assert.equal(journal.list().filter((e) => e.state === 'held').length, 1, 'said once');
        clock.advance(HOUR + 1000);
        const gone = new Mirror({ config: { ...DEFAULTS, mirror: 'webhook' }, journal, readAddress: keyStore('http://127.0.0.1:9/none').read, now: clock.now });
        const unreachable = await gone.send(CARD);
        assert.equal(unreachable.reason, '127.0.0.1:9: it could not be reached');
    } finally {
        await hook.close();
    }
});

test('mirror: a command gets the card as JSON on stdin, without a shell; its failures are reported', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-'));
    const out = join(dir, 'got.json');
    const ok = join(dir, 'sink.sh');
    writeFileSync(ok, `#!/bin/sh\ncat > "${out}"\n`);
    chmodSync(ok, 0o755);
    const bad = join(dir, 'bad.sh');
    writeFileSync(bad, '#!/bin/sh\necho "no route to the pager" >&2\nexit 3\n');
    chmodSync(bad, 0o755);
    const journal = new Journal(join(dir, 'events.jsonl'));
    const mirror = new Mirror({ config: { ...DEFAULTS, mirror: 'command', mirrorCommand: [ok] }, journal });
    assert.deepEqual(await mirror.send(CARD), { ok: true });
    const got = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(got, { text: mirrorText(CARD), kind: 'decision', title: 'Cache', question: 'Postgres or SQLite?', recommendation: 'SQLite', sessionId: 's' });
    assert.equal(journal.list()[0].text, 'Sent to sink.sh');
    assert.equal(mirror.place, 'sink.sh');
    const failing = new Mirror({ config: { ...DEFAULTS, mirror: 'command', mirrorCommand: [bad, '--loud'] }, journal });
    assert.deepEqual(await failing.send(CARD), { ok: false, reason: 'bad.sh exited with 3: no route to the pager' });
    const missing = new Mirror({ config: { ...DEFAULTS, mirror: 'command', mirrorCommand: [join(dir, 'nope')] }, journal });
    assert.deepEqual(await missing.send(CARD), { ok: false, reason: `The command's program ${join(dir, 'nope')} does not exist` });
    const none = new Mirror({ config: { ...DEFAULTS, mirror: 'command' }, journal });
    assert.match((await none.describe()).problem, /^No command is set: add mirrorCommand/);
    const off = new Mirror({ config: DEFAULTS, journal });
    assert.equal(off.on, false);
    assert.match((await off.test()).reason, /^Sending elsewhere is off\. Choose Webhook or Command/);
    assert.equal((await off.describe()).mode, 'off');
});

test('mirror and config: wrong values are said in words that name the setting; a save logs what changed', () => {
    assert.equal(checkWebhook('https://discord.com/api/webhooks/1/abc').host, 'discord.com');
    assert.equal(checkWebhook('http://localhost:8080/x').host, 'localhost:8080');
    assert.throws(() => checkWebhook('http://example.com/hook'), /^Error: The webhook address must start with https:\/\/ \(http:\/\/ only to this machine\), not http:\/\/$/);
    assert.throws(() => checkWebhook('discord'), /^Error: The webhook address is not a web address/);
    assert.throws(() => checkWebhook(''), new RegExp(`^Error: ${NO_ADDRESS}$`));
    assert.throws(() => checkCommand(['notify']), /must start with the program's full path/);
    assert.throws(() => checkCommand('notify me'), /^Error: No command is set/);
    assert.doesNotThrow(() => checkConfig({ ...DEFAULTS }));
    const wrong = (patch) => {
        try {
            checkConfig({ ...DEFAULTS, ...patch });
        } catch (error) {
            return { key: error.key, text: error.message };
        }
        return undefined;
    };
    assert.deepEqual(wrong({ windowHours: 0 }), { key: 'windowHours', text: 'Keep a reply\'s question for (windowHours) must be a whole number of hours from 1 to 720 (it is 0)' });
    assert.deepEqual(wrong({ mirrorPerHour: 1000 }), { key: 'mirrorPerHour', text: 'Messages sent an hour, at most (mirrorPerHour) must be a whole number from 1 to 500 (it is 1000)' });
    assert.deepEqual(wrong({ mirror: 'discord' }), { key: 'mirror', text: 'Also send new cards to (mirror) must be "off", "webhook" or "command" (it is "discord")' });
    assert.deepEqual(wrong({ approvals: 'yes' }), { key: 'approvals', text: 'Tools waiting for approval (approvals) must be true or false (it is "yes")' });
    assert.match(wrong({ mirrorUrlEnv: 'https://discord.com/x' }).text, /^The key that holds the webhook address \(mirrorUrlEnv\) must be a name of letters, digits and _/);
    assert.match(wrong({ mirrorCommand: ['notify'] }).text, /^The command \(mirrorCommand\) must start with the program's full path/);
    assert.match(wrong({ mirrorCommand: 'notify' }).text, /^The command \(mirrorCommand\) must list the program and then its arguments/);
    // A webhook or command without its address or program is not a wrong setting: the inbox works, and the page says what is missing.
    assert.equal(wrong({ mirror: 'webhook' }), undefined);
    assert.equal(wrong({ mirror: 'command' }), undefined);
    assert.deepEqual(LIVE_SETTINGS.filter((key) => !Object.hasOwn(SETTING_TITLES, key)), []);
    assert.equal(changedWords([['notify'], ['windowHours'], ['notify']]), 'A notification for each new card, Keep a reply\'s question for');
    // The log entry for a save: what changed, that it fixed a wrong setting, or that one is still wrong.
    const settings = { ...DEFAULTS, windowHours: 0 };
    const check = new SettingsCheck({ settings, check: checkConfig, liveKeys: LIVE_SETTINGS, label: 'decisions' });
    check.run();
    assert.equal(check.problem.live, true);
    const still = savedEntry(check, [['notify']]);
    assert.equal(still.text, 'Settings changed: A notification for each new card; Decisions waits until a wrong one is fixed');
    assert.equal(still.state, 'waiting on a setting');
    settings.windowHours = 24;
    const fixed = savedEntry(check, [['windowHours']]);
    assert.deepEqual(fixed, { kind: 'settings', text: 'Settings fixed: Decisions is working again', why: 'You saved Keep a reply\'s question for in Plugins.', state: 'done', by: 'you' });
    assert.equal(savedEntry(check, [['mirror']]).text, 'Settings changed: Also send new cards to');
    assert.equal(savedEntry(check, []), undefined);
});

test('cards: a plugin\'s question keeps only well-formed choices', () => {
    const card = askCard({ id: 'x', question: 'Go?', options: [{ id: 'go', label: 'Go' }, { label: 'broken' }], at: 5, source: 'Agent Terminals' }, new Map());
    assert.deepEqual(card.options, [{ id: 'go', label: 'Go' }]);
    assert.equal(card.source, 'Agent Terminals');
    assert.equal(askCard({ id: 'x' }), undefined);
});
