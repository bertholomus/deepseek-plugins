#!/usr/bin/env node
/**
 * Session Watch in a real DSH: its fold of every session's events, its
 * service as the suite's plugins call it, its window endpoints, its record
 * of running turns across a quit and a crash, its setting in Plugins, and
 * switching it off and on.
 *
 * DSH runs from a throwaway DSH_HOME (test/e2e/harness.mjs) with the
 * session bridge, Session Watch and a stand-in user of its service
 * (test/e2e/probe: it calls `sessionWatch` as Autopilot, Decisions and
 * Agent Terminals do, and serves what it gets to this test), a scripted
 * model (test/e2e/fake-model.mjs), and new sessions on Workspace Write, so
 * writing outside the workspace asks for approval. The message wait
 * (`deliveryTimeoutSeconds`) is 15 seconds here.
 *
 * - Served: the browser half parses; `status`, `sessions` and `wait`
 *   answer; `wait` answers at once when the window is behind and holds
 *   until its time when it is not.
 * - The fold, from DSH's own events: a todo list, a decision line with its
 *   pick, a goal that completes, a tool waiting for approval and a question
 *   waiting in DSH's question box (each with its state word, cleared when
 *   answered); listeners hear turn starts, states and turn ends in order;
 *   the window's view leaves the reply text out, and `fullState` has it.
 * - Delivery with proof: a message is queued, then delivered, and the
 *   session's own log (read through DSH) shows it inside the turn the
 *   delivery names; a steer goes into the running turn; a session that
 *   does not exist is refused in words; a message no turn reads in time is
 *   reported not delivered and taken back out of the queue, so the next
 *   turn never reads it.
 * - Cut off by a stop: DSH quit (SIGTERM) and crashed (SIGKILL to its
 *   process group) under running turns; the record of running turns names
 *   them; after each start `cutOffSessions` finds them (checked against
 *   their logs) and not the sessions that finished; a carry-on message to
 *   the cut-off session (not loaded) is delivered into a new turn.
 * - Sessions not loaded keep their state from DSH's saved values.
 * - Questions for a person: raised, answered once (the asker's handler gets
 *   the answer), refused a second time in words, and an answer's outcome told.
 * - An outside agent's state shows on its session's row, and goes.
 * - Its folder is 700 and running.json 600.
 * - A number in quotes in the profile (#32): Session Watch starts, works
 *   with its default, and `status` names the setting and the value. In the
 *   window, its page in Plugins flags the value as the form opens, says the
 *   quotes are what is wrong, and saving the number fixes it; a value out
 *   of range cannot be saved. Pictures light, dark and at 760 px.
 * - Switched off in Plugins: DSH reports no failure, its endpoints and its
 *   service go, its style sheet goes; on again, it serves at once.
 *
 *   DSH_BIN=/path/to/@deepseek-ai/dsh/lib/bin.js node plugins/session-watch/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs the newest DSH under .e2e/; `node scripts/e2e.mjs
 * session-watch` runs it on each of those and on the installed app's own
 * DSH. SHOTS=<folder> keeps the window's pictures there (default
 * .e2e/shots/session-watch/<version>); KEEP=1 keeps the throwaway DSH_HOME.
 * Without Playwright the run fails, unless NO_WINDOW=1 says to run without
 * the window checks (the summary then says they were skipped).
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Script } from 'node:vm';
import { DshRun, checks, dshBin, findPlaywright, modeOf, openWindow, pluginsDir, repoRoot, setDark, shot, sleep, waitFor } from '../../../../test/e2e/harness.mjs';
import { startFakeModel } from '../../../../test/e2e/fake-model.mjs';

const bin = dshBin();
if (!bin) {
    console.log('skipped: no DSH to run (set DSH_BIN, or install one under .e2e/dsh-<version>)');
    process.exit(0);
}
const version = process.env.DSH_LABEL || (/dsh-([^/]+)\/node_modules/.exec(bin)?.[1] ?? basename(dirname(dirname(bin))));
const shots = process.env.SHOTS || join(repoRoot, '.e2e', 'shots', 'session-watch', version);
console.log(`# DSH ${version}: ${bin}`);
console.log(`# pictures: ${shots}`);

const WAIT_SECONDS = 15;
const tally = checks();
const { check, step } = tally;
const model = await startFakeModel();
const rowsWith = ({ timeout = WAIT_SECONDS } = {}) => `- id: permission
  config:
    defaultPreset: workspace-write
- id: session-watch
  config:
    deliveryTimeoutSeconds: ${JSON.stringify(timeout)}
`;
const run = new DshRun({
    label: 'session-watch',
    bin,
    plugins: {
        'dsh-plugin-session-bridge': join(pluginsDir, 'session-bridge'),
        'dsh-plugin-session-watch': join(pluginsDir, 'session-watch'),
        'dsh-plugin-session-watch-probe': join(pluginsDir, 'session-watch', 'test', 'e2e', 'probe'),
    },
    rows: rowsWith(),
});
const outside = join(run.root, 'outside');
mkdirSync(outside, { recursive: true });

/** Start DSH again with other rows. */
async function restartWith(rows, what) {
    await run.stop();
    run.rows = rows;
    run.writeProfile(model.port);
    await run.boot(what);
}

/** Session Watch's own window endpoints, and the stand-in user's (its service, called in DSH). */
const watchApi = (method, args = {}) => run.api(`dsh-plugin-session-watch/${method}`, args);
const probeApi = async (method, args = {}) => {
    const r = await run.api(`dsh-plugin-session-watch-probe/${method}`, args);
    if (!r.ok) throw new Error(`probe ${method}: ${JSON.stringify(r.error)}`);
    return r.value;
};
const probeReady = () => waitFor(async () => (await run.api('dsh-plugin-session-watch-probe/ready')).value?.ready === true, 'the stand-in user to have the watcher', 30000, 200);
/** One session's row as the window's `sessions` endpoint gives it. */
const windowRow = async (sessionId) => {
    const r = await watchApi('sessions');
    if (!r.ok) throw new Error(`sessions: ${JSON.stringify(r.error)}`);
    return r.value.items.find((row) => row.sessionId === sessionId);
};
const call = (tool, args) => `E2E:call ${tool} ${JSON.stringify(args)}`;
const todos = (...items) => JSON.stringify(items.map(([content, status]) => ({ content, status })));
const idleSession = (sessionId) => waitFor(async () => {
    const s = await run.session(sessionId);
    return s.status !== 'running' && s.turns.started > 0 && s.turns.started === s.turns.ended ? s : null;
}, `${sessionId} to finish its turn`, 30000);
const runningSession = (sessionId) => waitFor(async () => (await run.session(sessionId)).status === 'running', `${sessionId} to run`, 30000);
/** Wait until the session's row (from the probe: the service's `get`) passes `test`. */
const rowWhen = (sessionId, test, what, timeout = 20000) => {
    let last;
    return waitFor(async () => {
        last = await probeApi('row', { sessionId });
        return test(last) ? last : null;
    }, `${sessionId}: ${what}`, timeout, 250).catch((error) => {
        throw new Error(`${error.message}; last row ${JSON.stringify(last)}`);
    });
};
/** A delivery from the probe once settled (delivered or failed). */
const settled = (id, timeout = 30000) => waitFor(async () => {
    const d = await probeApi('delivery', { id });
    return d && (d.state === 'delivered' || d.state === 'failed') ? d : null;
}, `delivery ${id} to settle`, timeout, 250);
/** Where `id`'s user/message sits in the log: its turn (the turn/start before it with no turn/end between), or undefined. */
function turnOf(log, id) {
    const at = log.findIndex((e) => e.type === 'user/message' && e.data?.id === id);
    if (at < 0) return undefined;
    const before = log.slice(0, at);
    const start = before.findLast((e) => e.type === 'turn/start');
    const end = before.findLast((e) => e.type === 'turn/end');
    if (!start || (end && end.seq > start.seq)) return undefined;
    return start.data?.turn;
}

const ids = {};
let window;
let pw = null;
try {
    pw = await findPlaywright();
    if (!pw && process.env.NO_WINDOW !== '1') throw new Error('Playwright is not installed (set NO_WINDOW=1 to run without the window checks)');
    run.writeProfile(model.port);
    await run.boot('first start');
    await probeReady();

    // ── Served ─────────────────────────────────────────────────────────
    await step('served: the browser half parses, and its window endpoints answer', async () => {
        const client = await run.clientOf('dsh-plugin-session-watch');
        let parsed = false;
        try {
            new Script(client.text);
            parsed = true;
        } catch {}
        check('DSH serves Session Watch\'s browser half, and it parses', client.status === 200 && parsed, `status ${client.status}`);
        const status = await watchApi('status');
        check('status: running, with no setting to fix', status.ok && status.value.running === true && !status.value.problem, JSON.stringify(status));
        const sessions = await watchApi('sessions');
        check('sessions: a list (empty in a new home)', sessions.ok && Array.isArray(sessions.value.items), JSON.stringify(sessions).slice(0, 300));
        const first = await watchApi('wait', { timeoutMs: 1000 });
        check('wait: a window with nothing seen gets the change numbers at once', first.ok && typeof first.value?.epoch === 'string' && typeof first.value?.versions === 'object', JSON.stringify(first));
        const t0 = Date.now();
        const held = await watchApi('wait', { since: first.value, timeoutMs: 800 });
        const took = Date.now() - t0;
        check('wait: a window that is up to date is held until something moves or its time is up', held.ok && took >= 700 && took < 10000, `${took} ms`);
    });

    // ── The fold ───────────────────────────────────────────────────────
    const prompts = await run.prompts();
    let since = (await probeApi('events', { since: 0 })).next;
    ids.todos = await run.newSession(`E2E:todos ${todos(['Read the brief', 'completed'], ['Write the code', 'in_progress'], ['Test it', 'pending'])}`, 'Todo list');
    ids.decision = await run.newSession('E2E:say Everything is ready for the release.\\nDECISION NEEDED: Ship the release today? — recommend: yes, after the smoke test', 'Release call');
    ids.goal = await run.newSession('E2E:goal Write three lines about rivers', 'River goal');
    await idleSession(ids.todos);
    await idleSession(ids.decision);
    await step('the fold: a todo list, a decision line and a goal, from DSH\'s own events', async () => {
        const row = await rowWhen(ids.todos, (r) => r.state?.todos?.total === 3, 'its todos');
        check('a todo list in counts, with the item to work on next', JSON.stringify(row.state.todos) === JSON.stringify({ open: 2, active: 1, done: 1, total: 3, next: 'Write the code' }), JSON.stringify(row.state.todos));
        check('its last turn ended, finished: the row reads idle, its title is DSH\'s', row.state.end?.kind === 'completed' && row.state.open === false && row.status === 'idle' && row.word === 'idle' && row.title === 'Todo list', JSON.stringify({ end: row.state.end, status: row.status, word: row.word, title: row.title }));
        const heard = (await probeApi('events', { since })).items.filter((e) => e.sessionId === ids.todos);
        const order = heard.map((e) => (e.type === 'state' ? `state:${e.change}` : e.type)).filter((t) => ['turn-start', 'state:todo/write', 'turn-end'].includes(t));
        check('listeners hear the turn start, the todo list and the turn end, in order', JSON.stringify(order) === JSON.stringify(['turn-start', 'state:todo/write', 'turn-end']), JSON.stringify(heard.map((e) => e.type + (e.change ? `:${e.change}` : ''))));
        check('the turn end names how it ended', heard.find((e) => e.type === 'turn-end')?.end?.kind === 'completed', JSON.stringify(heard.find((e) => e.type === 'turn-end')));
        const decision = await rowWhen(ids.decision, (r) => r.state?.ask, 'its ask');
        check('a DECISION NEEDED line: the question and the pick, with its turn', decision.state.ask.kind === 'decision' && decision.state.ask.question === 'Ship the release today?' && decision.state.ask.recommendation === 'yes, after the smoke test' && decision.state.ask.turn === 1, JSON.stringify(decision.state.ask));
        const view = await windowRow(ids.decision);
        check('the window\'s view of a session leaves the reply text out', view && view.state.ask?.question === 'Ship the release today?' && view.state.text === undefined && view.word === 'idle', JSON.stringify(view).slice(0, 400));
        const full = await probeApi('full', { sessionId: ids.decision });
        check('fullState has the reply text, for the plugins that read it', typeof full?.text === 'string' && full.text.includes('DECISION NEEDED: Ship the release today?'), JSON.stringify(full).slice(0, 300));
        const goal = await rowWhen(ids.goal, (r) => r.state?.goal && r.state.goal.phase !== 'active' && r.status !== 'running', 'its goal to finish', 40000);
        check('a goal: its objective, its phase when it completes, and its rounds', goal.state.goal.objective === 'Write three lines about rivers' && goal.state.goal.phase === 'complete' && goal.state.goal.rounds >= 1, JSON.stringify(goal.state.goal));
    });

    ids.approval = await run.newSession(call('write', { file_path: join(outside, 'draft.txt'), content: 'The draft.', sandbox_permissions: 'danger-full-access', justification: 'It saves the draft next to the workspace.' }), 'Draft upload');
    ids.question = await run.newSession(call('ask_user_question', {
        questions: [{ id: 'env', question: 'Which environment should I deploy to?', header: 'Target', options: [{ label: 'staging' }, { label: 'production' }] }],
        timeout: -1,
    }), 'Deploy target');
    await step('the fold: a tool waiting for approval and a question in DSH\'s question box, each with its word, and cleared when answered', async () => {
        const approval = await rowWhen(ids.approval, (r) => r.word === 'waiting for approval', 'waiting for approval');
        check('a tool waiting for approval: the row says so, and names the tool', approval.status === 'running' && approval.state.approvals?.length === 1 && approval.state.approvals[0].tool === 'write', JSON.stringify(approval.state.approvals));
        const question = await rowWhen(ids.question, (r) => r.word === 'waiting for your answer', 'waiting for an answer');
        check('a question in DSH\'s question box: the row says so, with the question', question.state.asking?.question === 'Which environment should I deploy to?', JSON.stringify(question.state.asking));
        const prompt = await waitFor(() => prompts.find('approval/request', (r) => /the draft next to the workspace/.test(r.reason ?? '')), 'the window\'s prompt for the draft', 30000, 200);
        await prompts.answer(prompt, 'rejected');
        const after = await rowWhen(ids.approval, (r) => !r.state.approvals && r.status !== 'running', 'the approval answered', 30000);
        check('answered (rejected), the approval is cleared and the turn ends', !after.state.approvals && after.state.end !== undefined, JSON.stringify({ approvals: after.state.approvals, end: after.state.end }));
        check('the rejected tool never ran: no file was written', !existsSync(join(outside, 'draft.txt')));
        const ask = await waitFor(() => prompts.find('user-questions/request', (r) => JSON.stringify(r).includes('Which environment')), 'the window\'s prompt for the question', 30000, 200);
        await prompts.answer(ask, { answers: [{ id: 'env', selected: ['staging'] }] });
        const answered = await rowWhen(ids.question, (r) => !r.state.asking, 'the question answered', 30000).catch(() => null);
        check('answered, the question is cleared', answered && !answered.state.asking, JSON.stringify(answered?.state?.asking ?? answered));
    });

    // ── Delivery with proof ────────────────────────────────────────────
    await step('delivery: queued, then delivered, and the session\'s own log shows it inside the turn it names', async () => {
        since = (await probeApi('events', { since: 0 })).next;
        const first = await probeApi('deliver', { sessionId: ids.todos, text: 'Probe note: carry on with the tests.' });
        check('deliver returns as soon as the session\'s queue shows it (or a turn already read it)', first.state === 'queued' || first.state === 'delivered', JSON.stringify(first));
        const done = await settled(first.id);
        check('then delivered, naming the turn that read it', done.state === 'delivered' && Number.isSafeInteger(done.turn) && done.turn >= 2, JSON.stringify(done));
        const log = await probeApi('log', { sessionId: ids.todos });
        const spliced = log.findIndex((e) => e.type === 'agent/inbox/spliced' && (e.data?.inserted ?? []).some((m) => m.id === first.id));
        const read = log.findIndex((e) => e.type === 'user/message' && e.data?.id === first.id);
        check('the session\'s log has it in the queue first, then read in', spliced >= 0 && read > spliced, `spliced at ${spliced}, read at ${read}`);
        check('the message sits inside the very turn the delivery names', turnOf(log, first.id) === done.turn, `turn ${turnOf(log, first.id)} vs ${done.turn}`);
        const states = (await probeApi('events', { since })).items.filter((e) => e.type === 'delivery' && e.delivery?.id === first.id).map((e) => e.delivery.state);
        check('listeners hear queued, then delivered', JSON.stringify(states) === JSON.stringify(['queued', 'delivered']) || JSON.stringify(states) === JSON.stringify(['delivered']), JSON.stringify(states));
        check('the message is marked as a plugin\'s, not the person\'s', log[read]?.data?.source?.kind === 'cordis-host-runner', JSON.stringify(log[read]?.data?.source));
    });
    await step('delivery: a steer goes into the running turn; a session that does not exist is refused in words', async () => {
        ids.steer = await run.newSession('E2E:slow', 'Long run');
        await runningSession(ids.steer);
        await waitFor(() => model.held.size === 1, 'the long turn\'s reply to be held open', 20000, 100);
        const steer = await probeApi('deliver', { sessionId: ids.steer, text: 'Probe steer: also check the docs.', mode: 'steer' });
        model.release();
        const done = await settled(steer.id);
        const log = await probeApi('log', { sessionId: ids.steer });
        check('a steer is read into the turn that was running (turn 1), and its log proves it', done.state === 'delivered' && done.turn === 1 && turnOf(log, steer.id) === 1, JSON.stringify(done));
        const missing = await probeApi('deliver', { sessionId: 'no-such-session', text: 'Hello?' });
        check('a session that does not exist: not delivered, and why', missing.state === 'failed' && /^the session could not be opened: /.test(missing.reason ?? ''), JSON.stringify(missing));
    });
    await step(`delivery: a message no turn reads within ${WAIT_SECONDS} seconds is reported not delivered, and taken back out of the queue`, async () => {
        ids.late = await run.newSession('E2E:slow', 'Held turn');
        await runningSession(ids.late);
        const late = await probeApi('deliver', { sessionId: ids.late, text: 'Probe late note: this one must never be read.' });
        check('queued behind the running turn', late.state === 'queued', JSON.stringify(late));
        const done = await settled(late.id, (WAIT_SECONDS + 15) * 1000);
        check('past the wait: not delivered, and the reason says it was taken back', done.state === 'failed' && done.reason === `no turn read it within ${WAIT_SECONDS} seconds, so Session Watch took it back out of the session's queue`, JSON.stringify(done));
        model.release();
        await idleSession(ids.late);
        await sleep(1500);
        const log = await probeApi('log', { sessionId: ids.late });
        const removedAt = log.findIndex((e) => e.type === 'agent/inbox/spliced' && e.data?.removedCount === 1);
        check('the session\'s log records it taken out of the queue', removedAt >= 0, JSON.stringify(log.filter((e) => e.type === 'agent/inbox/spliced').map((e) => e.data)).slice(0, 600));
        check('and no turn ever read it: the claim "not delivered" holds', !log.some((e) => e.type === 'user/message' && e.data?.id === late.id));
    });

    // ── Cut off by a stop ──────────────────────────────────────────────
    ids.quit = await run.newSession('E2E:slow', 'Long migration');
    await runningSession(ids.quit);
    await step('the record of running turns names the turn running now', async () => {
        const file = join(run.home, 'session-watch', 'running.json');
        const named = await waitFor(() => {
            try {
                return Object.hasOwn(JSON.parse(readFileSync(file, 'utf8')).sessions ?? {}, ids.quit);
            } catch {
                return false;
            }
        }, 'running.json to name the running turn', 10000, 200).catch(() => false);
        check('running.json names the session whose turn runs', named);
    });
    await run.stop();
    check('DSH quits (SIGTERM) under a running turn', !run.alive());
    prompts.close();
    await run.boot('after a quit');
    await probeReady();
    await step('after a quit: cutOffSessions finds the cut-off session (checked against its log) and not the ones that finished', async () => {
        const found = await probeApi('cutOff', { withinMs: 0 });
        const mine = found.find((f) => f.sessionId === ids.quit);
        check('the session DSH quit under is found, with how its turn ended', Boolean(mine) && typeof mine.end?.kind === 'string' && mine.title === 'Long migration', JSON.stringify(found));
        check('sessions that finished their turns are not', !found.some((f) => [ids.todos, ids.decision, ids.steer].includes(f.sessionId)), JSON.stringify(found.map((f) => f.title)));
        const row = await windowRow(ids.quit);
        check('its row reads cut off, and it is not loaded', row?.word === 'cut off' && row.status === 'cold', JSON.stringify({ word: row?.word, status: row?.status }));
        const note = await probeApi('deliver', { sessionId: ids.quit, text: 'Probe carry-on: DSH stopped while you were working; carry on.' });
        const done = await settled(note.id);
        const log = await probeApi('log', { sessionId: ids.quit });
        check('a carry-on message to it (not loaded) loads it and is delivered into a new turn, as its log shows', done.state === 'delivered' && done.turn >= 2 && turnOf(log, note.id) === done.turn, JSON.stringify(done));
    });
    await step('sessions not loaded keep their state from DSH\'s saved values', async () => {
        const row = await windowRow(ids.todos);
        check('a session not loaded since the start: status cold, its todos and its last turn still known', row?.status === 'cold' && row.state?.todos?.total === 3 && row.state?.end?.kind === 'completed', JSON.stringify({ status: row?.status, todos: row?.state?.todos, end: row?.state?.end }));
        const full = await probeApi('full', { sessionId: ids.decision });
        check('its reply text, which the saved value leaves out, is folded from its log', typeof full?.text === 'string' && full.text.includes('DECISION NEEDED'), JSON.stringify(full).slice(0, 200));
    });
    model.release();
    ids.crash = await run.newSession('E2E:slow', 'Long import');
    await runningSession(ids.crash);
    await waitFor(() => {
        try {
            return Object.hasOwn(JSON.parse(readFileSync(join(run.home, 'session-watch', 'running.json'), 'utf8')).sessions ?? {}, ids.crash);
        } catch {
            return false;
        }
    }, 'running.json to name the turn before the crash', 10000, 200).catch(() => {});
    await run.crash();
    check('DSH crashed (SIGKILL to its process group) under a running turn', !run.alive());
    await run.boot('after a crash');
    await probeReady();
    await step('after a crash: the cut-off session is found too', async () => {
        const found = await probeApi('cutOff', { withinMs: 0 });
        check('the session DSH crashed under is found', found.some((f) => f.sessionId === ids.crash), JSON.stringify(found.map((f) => f.title)));
        check('the one already carried on is not found again', !found.some((f) => f.sessionId === ids.quit), JSON.stringify(found.map((f) => f.title)));
    });

    // ── Questions, outside agents, files ───────────────────────────────
    await step('questions for a person: raised, answered once, refused a second time in words, and an answer\'s outcome told', async () => {
        since = (await probeApi('events', { since: 0 })).next;
        const raised = await probeApi('raise', { id: 'probe-q1', sessionId: ids.todos, question: 'Run the slow tests too?' });
        check('a raised question has its time and no handler on the wire', raised.id === 'probe-q1' && Number.isFinite(raised.at) && raised.onAnswer === undefined, JSON.stringify(raised));
        const waiting = await probeApi('asks');
        check('it waits', waiting.waiting.some((a) => a.id === 'probe-q1' && a.question === 'Run the slow tests too?'), JSON.stringify(waiting));
        const answered = await probeApi('answer', { id: 'probe-q1', answer: 'yes' });
        const after = await probeApi('asks');
        check('answered: the asker\'s handler gets the answer and who gave it, and it no longer waits', answered.ok === true && answered.told === true && after.answers.some((a) => a.id === 'probe-q1' && a.answer === 'yes' && a.by === 'test') && !after.waiting.some((a) => a.id === 'probe-q1'), JSON.stringify({ answered, after }));
        const again = await probeApi('answer', { id: 'probe-q1', answer: 'no' });
        check('a second answer is refused in words', again.ok === false && again.error === 'This question is no longer waiting.', JSON.stringify(again));
        check('an answer\'s outcome is told once its asker knows; a word that is not an outcome is refused', (await probeApi('outcome', { id: 'probe-q1', state: 'delivered' })) === true && (await probeApi('outcome', { id: 'probe-q1', state: 'sent' })) === false);
        const heard = (await probeApi('events', { since })).items.filter((e) => e.type === 'ask').map((e) => e.change);
        check('listeners hear raised, answered and the outcome', JSON.stringify(heard) === JSON.stringify(['raised', 'answered', 'outcome']), JSON.stringify(heard));
    });
    await step('an outside agent\'s state shows on its session\'s row, and goes', async () => {
        await probeApi('external', { sessionId: ids.todos, status: 'waiting on you' });
        const row = await windowRow(ids.todos);
        check('the row carries the outside agent\'s state as its word', row?.word === 'waiting on you' && row.external?.label === 'Probe agent', JSON.stringify({ word: row?.word, external: row?.external }));
        await probeApi('external', { sessionId: ids.todos, status: null });
        const cleared = await windowRow(ids.todos);
        check('cleared, the row reads as before', !cleared?.external && cleared?.word === 'idle', JSON.stringify({ word: cleared?.word, external: cleared?.external }));
    });
    await step('private folder and file', async () => {
        const dir = join(run.home, 'session-watch');
        const file = join(dir, 'running.json');
        check('the watcher\'s folder is 700 and running.json 600', modeOf(dir) === 0o700 && modeOf(file) === 0o600, `${modeOf(dir).toString(8)} ${modeOf(file).toString(8)}`);
    });

    // ── A number in quotes (#32) ───────────────────────────────────────
    await restartWith(rowsWith({ timeout: String(WAIT_SECONDS) }), 'a number in quotes');
    await probeReady();
    await step('a number in quotes in the profile: Session Watch starts, keeps working with its default, and names the setting with its value', async () => {
        const status = await watchApi('status');
        check('status names the setting, its range and the value as the profile has it', status.ok && status.value.running === true && status.value.problem?.text === `How long a message may wait to be read (deliveryTimeoutSeconds) must be a whole number of seconds from 10 to 86400 (it is "${WAIT_SECONDS}")` && status.value.problem?.live === true && status.value.problem?.key === 'deliveryTimeoutSeconds', JSON.stringify(status));
        const note = await probeApi('deliver', { sessionId: ids.todos, text: 'Probe note while a setting is wrong.' });
        const done = await settled(note.id);
        check('the watcher still delivers, with proof, while its setting waits', done.state === 'delivered', JSON.stringify(done));
    });
    if (pw) {
        await step('its page in Plugins: the value in quotes is flagged as the form opens, the quotes named; saving the number fixes it', async () => {
            window = await openWindow(run, pw, { entry: 'Plugins' });
            const { page } = window;
            await page.getByRole('button', { name: 'Plugins', exact: true }).first().click();
            const view = page.getByRole('button', { name: 'View Session Watch' });
            await view.waitFor({ state: 'visible', timeout: 20000 });
            await view.click();
            const form = page.locator('[data-suite-settings="dsh-plugin-session-watch"]');
            await form.waitFor({ state: 'visible', timeout: 20000 });
            const field = form.getByLabel('How long a message may wait to be read, in seconds');
            const flagged = page.locator('[data-suite-setting="deliveryTimeoutSeconds"][data-suite-invalid]');
            await flagged.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
            const words = (await flagged.count()) ? (await flagged.innerText()).replace(/\n+/g, ' ') : '';
            check('the form shows the value with its quotes, flagged at once, and says the quotes are what is wrong',
                (await field.inputValue()) === `"${WAIT_SECONDS}"` && words.includes('It is saved as text, in quotes. Type a whole number from 10 to 86400, without the quotes, then save.'), `${await field.inputValue()} | ${words}`);
            check('the field is marked invalid for a screen reader too', (await field.getAttribute('aria-invalid')) === 'true', String(await field.getAttribute('aria-invalid')));
            await shot(page, shots, 'settings-in-quotes-light');
            await setDark(page, true);
            await shot(page, shots, 'settings-in-quotes-dark');
            await setDark(page, false);
            await page.setViewportSize({ width: 760, height: 860 });
            const wide = await page.evaluate(() => document.documentElement.scrollWidth);
            check('at 760 px its page has no sideways scroll', wide <= 760, `${wide} px`);
            await shot(page, shots, 'settings-760-light');
            await page.setViewportSize({ width: 1280, height: 860 });
            const save = form.getByRole('button', { name: 'Save' });
            await field.fill('5');
            const refused = (await page.locator('[data-suite-setting="deliveryTimeoutSeconds"]').innerText()).replace(/\n+/g, ' ');
            check('a value out of range cannot be saved, and the form says what fits', await save.isDisabled() && refused.includes('A whole number from 10 to 86400, or empty for the default (600).'), refused);
            await field.fill(String(WAIT_SECONDS));
            check('the number typed without the quotes can be saved', !(await save.isDisabled()));
            await save.click();
            const fixed = await waitFor(async () => {
                const r = await watchApi('status');
                return r.ok && !r.value.problem ? r.value : null;
            }, 'the setting to be fixed', 20000, 300).catch(() => null);
            check('saved, the setting is fixed at once', Boolean(fixed), JSON.stringify(fixed));
            const patch = readFileSync(join(run.profile, 'cordis.patch.yml'), 'utf8');
            check('the profile now holds the number, without quotes', new RegExp(`deliveryTimeoutSeconds: ${WAIT_SECONDS}\\b`).test(patch) && !patch.includes(`deliveryTimeoutSeconds: "${WAIT_SECONDS}"`), patch.split('\n').filter((l) => /deliveryTimeout/.test(l)).join(' | '));
            await page.waitForTimeout(500);
            check('the flag is gone once saved', (await page.locator('[data-suite-setting="deliveryTimeoutSeconds"][data-suite-invalid]').count()) === 0);
            await shot(page, shots, 'settings-fixed-light');
            await setDark(page, true);
            await shot(page, shots, 'settings-fixed-dark');
            await setDark(page, false);
            const ours = window.errors.filter((text) => /session-watch/i.test(text));
            check('no errors from Session Watch in the window', ours.length === 0, ours.join('\n'));
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-settings');
        });
        await step('switched off in Plugins: no failure from DSH, its endpoints, service and style sheet go; on again, it serves at once', async () => {
            const { page } = window;
            const styleCount = () => page.locator('style[data-plugin-css="dsh-plugin-session-watch/client.css"]').count();
            const styled = await styleCount();
            const failed = page.getByText(/Could not (disable|enable)/);
            const watchSwitch = page.getByRole('switch', { name: 'Enable Session Watch' });
            await watchSwitch.click();
            await waitFor(async () => (await watchSwitch.getAttribute('aria-checked')) === 'false', 'Session Watch\'s switch to go off', 20000, 200);
            await waitFor(async () => (await watchApi('status')).ok === false, 'its endpoints to go', 20000, 300);
            await sleep(2000);
            const offWords = (await failed.count()) ? await failed.first().innerText() : '';
            check('switched off, DSH reports no failure', offWords === '', offWords);
            const gone = await watchApi('status');
            check('its window endpoints are gone, said in words', gone.ok === false, JSON.stringify(gone));
            const probe = await run.api('dsh-plugin-session-watch-probe/ready');
            check('its service is gone: the plugin that used it no longer has it', probe.ok && probe.value.ready === false, JSON.stringify(probe));
            check('it leaves nothing behind in the window: its style sheet is gone', styled === 1 && (await styleCount()) === 0, `${styled} then ${await styleCount()}`);
            await shot(page, shots, 'switched-off-light');
            await watchSwitch.click();
            await waitFor(async () => (await watchApi('status')).ok === true, 'its endpoints to come back', 30000, 300);
            await probeReady();
            check('on again, it serves at once and its user has it again', true);
            const note = await probeApi('deliver', { sessionId: ids.todos, text: 'Probe note after switching on again.' });
            check('and it delivers with proof again', (await settled(note.id)).state === 'delivered');
            await waitFor(async () => (await styleCount()) === 1, 'its style sheet to come back once', 10000, 200).catch(() => {});
            check('its style sheet is back, once', (await styleCount()) === 1, String(await styleCount()));
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-switch');
        });
        await window?.browser?.close().catch(() => {});
        window = undefined;
    }
} catch (error) {
    check('the run finished', false, error?.stack ?? error);
    if (window?.page) await shot(window.page, shots, 'failed').catch(() => {});
} finally {
    await window?.browser?.close().catch(() => {});
    model.release();
    await run.stop();
    await model.close();
    const warnings = run.logText().split('\n').filter((line) => /session-watch/i.test(line) && /warn|error|fail/i.test(line));
    if (warnings.length) console.log(`# DSH said about Session Watch:\n${warnings.slice(-20).map((l) => `#   ${l}`).join('\n')}`);
    run.cleanup();
}
console.log(`\n# DSH ${version}: ${tally.passed} passed, ${tally.failed} failed${pw ? '' : ', window checks skipped (no Playwright)'}`);
process.exit(tally.failed ? 1 : 0);
