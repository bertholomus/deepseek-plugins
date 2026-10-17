/**
 * Proof's host half around the projection: the claims ledger and its
 * export (ledger.js), the independent check (verifier.js) with DSH and
 * time stood in for, and what its page and flags read (page.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { CHECK_WORDS, EXPORT_FORMATS, VERDICT_WORDS, countsOf, csvField, exportLedger, exportName, ledgerOf, sessionRows, titleOf, withChecks } from '../plugins/proof/lib/ledger.js';
import { CHECK_LINE, KEY, foldAll, viewOf } from '../plugins/proof/lib/projection.js';
import { CHECK_TOOLS, Verifier, parseChecks, promptFor, refusalOf, verdictIn } from '../plugins/proof/lib/verifier.js';
import { ledgerState, pageState, sessionState, working } from '../plugins/proof/lib/page.js';
import { JsonStore } from '../plugins/proof/lib/shared/files.js';
import { Journal } from '../plugins/proof/lib/shared/journal.js';
import { manualClock, settle } from './helpers/clock.mjs';
import { tempDir } from './helpers/temp.mjs';

let seq = 0;
/** One turn of a session's log, as DSH writes it. */
function turn(n, { prompt = '', tools = [], reply = '', end = 'completed', source = { kind: 'user' }, at } = {}) {
    const time = () => (at ?? 1_000_000) + (++seq);
    const ev = [
        { type: 'turn/start', seq: ++seq, time: time(), data: { turn: n } },
        { type: 'user/message', seq: ++seq, time: time(), data: { role: 'user', source, content: [{ type: 'text', text: prompt }] } },
    ];
    tools.forEach(([name, args, output], i) => {
        const callId = `c${n}-${i}-${seq}`;
        ev.push({ type: 'tool/call', seq: ++seq, time: time(), data: { turn: n, step: i, callId, name, arguments: args } });
        ev.push({ type: 'tool/result', seq: ++seq, time: time(), data: { turn: n, step: i, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: output }] } } });
    });
    if (reply) ev.push({ type: 'assistant/message', seq: ++seq, time: time(), data: { turn: n, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } } });
    ev.push({ type: 'turn/end', seq: ++seq, time: time(), data: { turn: n, reason: { kind: end } } });
    return ev;
}
const testRun = ['bash', { command: 'npm test' }, '# pass 5\n# fail 0'];
const failingRun = ['bash', { command: 'npm test' }, '# pass 4\n# fail 1\nnot ok 5 - parses dates'];

/** A session with one claim of each verdict: shown (1), contradicted (2), no evidence (3), and a write-up leaning on 1 (4). */
function mixedSession() {
    return [
        ...turn(1, { prompt: 'Run the tests.', tools: [testRun], reply: 'All 5 tests pass.' }),
        ...turn(2, { prompt: 'Fix the date parser.', tools: [['edit', { file_path: 'src/date.js' }, 'The file src/date.js has been updated successfully.'], failingRun], reply: 'Fixed the parser; all tests pass.' }),
        ...turn(3, { prompt: 'Now deploy it.', reply: 'Deployed to staging.' }),
    ];
}

// ── The ledger ─────────────────────────────────────────────────────

test('ledger: every claim a session made, with what its turn ran and what the person asked', () => {
    const { check, claims } = ledgerOf(mixedSession());
    assert.equal(check, false);
    assert.deepEqual(claims.map((c) => [c.turn, c.verdict]), [[1, 'backed'], [2, 'contradicted'], [2, 'contradicted'], [3, 'unbacked']].filter((_, i) => i < claims.length));
    const shown = claims.find((c) => c.turn === 1);
    assert.equal(shown.ask, 'Run the tests.');
    assert.equal(shown.ran.length, 1);
    assert.match(shown.ran[0], /npm test/);
    const none = claims.find((c) => c.turn === 3);
    assert.deepEqual(none.ran, [], 'a turn that ran nothing lists nothing');
    assert.match(none.why, /\S/);
    // A summary turn leans on the turn before: its runs are that turn's.
    const leaned = ledgerOf([...turn(1, { prompt: 'Run the tests.', tools: [testRun], reply: 'Ran them.' }), ...turn(2, { prompt: 'thanks, can you summarize?', reply: 'All 5 tests pass.' })]).claims.find((c) => c.turn === 2);
    assert.equal(leaned.verdict, 'backed');
    assert.equal(leaned.from, 1);
    assert.match(leaned.ran[0], /npm test/);
    // Junk and an empty log: no claims, never a throw.
    assert.deepEqual(ledgerOf(undefined), { check: false, claims: [] });
    assert.deepEqual(ledgerOf([null, 3, { type: 'turn/end' }]), { check: false, claims: [] });
});

test('ledger: a check thread (its first message from Proof starts with the check line) is never judged', () => {
    const events = [
        ...turn(1, { prompt: `${CHECK_LINE} Check one claim another session made.`, source: { kind: 'cordis-host-runner' }, tools: [testRun], reply: 'Re-ran it: all 5 tests pass.\nVERIFIED: npm test exited 0 with 5 passing.' }),
        ...turn(2, { prompt: 'and deploy it', reply: 'Deployed to staging.' }),
    ];
    assert.deepEqual(ledgerOf(events), { check: true, claims: [] });
    const state = foldAll(events);
    assert.equal(state.check, true);
    assert.equal(state.first, 1, 'its first turn, where the window says what it checks');
    assert.deepEqual(viewOf(state), { total: 0, flagged: [], check: true, first: 1 });
    // The same words from the person, or after claims were made, do not make a session a check thread.
    assert.equal(ledgerOf(turn(1, { prompt: `${CHECK_LINE} please`, reply: 'Deployed to staging.' })).check, false);
    const later = [...turn(1, { prompt: 'Deploy.', reply: 'Deployed to staging.' }), ...turn(2, { prompt: `${CHECK_LINE} x`, source: { kind: 'cordis-host-runner' }, reply: 'ok' })];
    assert.equal(ledgerOf(later).check, false);
    assert.equal(ledgerOf(later).claims.length, 1, 'a ledger with claims is never wiped');
});

test('ledger: counts, checks by claim, titles and the sessions with claims', () => {
    const { claims } = ledgerOf(mixedSession());
    const counts = countsOf(claims);
    assert.equal(counts.total, claims.length);
    assert.equal(counts.backed + counts.unbacked + counts.contradicted, counts.total);
    assert.equal(counts.flagged, counts.unbacked + counts.contradicted);
    const check = { claimId: claims.at(-1).id, state: 'verified', reason: 'It is live.' };
    const joined = withChecks(claims, [check]);
    assert.equal(joined.at(-1).check, check);
    assert.equal(joined[0].check, undefined);
    assert.equal(titleOf({ projections: { values: { title: 'A' } } }), 'A');
    assert.equal(titleOf({ projections: { values: { title: { title: 'B' } } } }), 'B');
    assert.equal(titleOf({}), '');

    const view = (events) => JSON.parse(JSON.stringify(viewOf(foldAll(events))));
    const items = [
        { sessionId: 'old', updatedAt: 1, cwd: '/w/old', projections: { values: { title: 'Old', [KEY]: view(turn(1, { prompt: 'Deploy.', reply: 'Deployed to staging.' })) } } },
        { sessionId: 'new', updatedAt: 9, running: true, projections: { values: { title: { title: 'New' }, [KEY]: view(mixedSession()) } } },
        { sessionId: 'quiet', updatedAt: 5, projections: { values: { [KEY]: view(turn(1, { prompt: 'Run the tests.', tools: [testRun], reply: 'All 5 tests pass.' })) } } },
        { sessionId: 'none', updatedAt: 7, projections: { values: { [KEY]: { total: 0, flagged: [] } } } },
        { sessionId: 'check', updatedAt: 8, projections: { values: { [KEY]: { total: 0, flagged: [], check: true, first: 1 } } } },
        { sessionId: 'junk', updatedAt: 6, projections: { values: { [KEY]: 'x' } } },
        null,
    ];
    const rows = sessionRows(items);
    assert.deepEqual(rows.map((r) => r.sessionId), ['new', 'quiet', 'old'], 'newest first; no claims, check threads and junk left out');
    assert.equal(rows[0].title, 'New');
    assert.equal(rows[0].running, true);
    assert.ok(rows[0].flagged >= 2);
    assert.ok(rows[0].contradicted >= 1);
    assert.equal(rows[0].latest.turn, 3);
    assert.equal(rows[1].flagged, 0);
    assert.equal(rows[1].latest, undefined);
    assert.equal(rows[2].cwd, '/w/old');
    assert.equal(sessionRows(items, { limit: 1 }).length, 1);
});

// ── Export ─────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 9, 17, 17, 30, 0);

test('export: Markdown, a table a person reads, its cells safe', () => {
    const { claims } = ledgerOf(mixedSession());
    const all = withChecks(claims, [{ claimId: claims.at(-1).id, state: 'not-verified', reason: 'Nothing | answers on staging.' }]);
    const file = exportLedger({ id: 'session-1234abcd', title: 'Date parser | fix', cwd: '/work/app' }, all, 'md', NOW);
    assert.equal(file.type, 'text/markdown');
    assert.equal(file.name, 'proof-ledger-date-parser-fix-2026-10-17.md');
    const text = file.text;
    assert.match(text, /^# Claims ledger: Date parser \| fix\n/);
    assert.match(text, /Session `session-1234abcd` in `\/work\/app`\. Exported 2026-10-17T17:30:00Z\./);
    assert.match(text, /\| Turn \| Claim \| Verdict \| Why \| Evidence \| Independent check \|/);
    assert.match(text, /\| 3 \| Deployed to staging\. \| No evidence \|/);
    assert.match(text, /Not verified: Nothing \\\| answers on staging\./, 'a pipe in a cell is escaped');
    const rows = text.split('\n').filter((l) => /^\| \d/.test(l));
    assert.equal(rows.length, claims.length);
    for (const row of rows) assert.equal(row.split(/(?<!\\)\|/).length, 8, `six cells: ${row}`);
    const empty = exportLedger({ id: 'session-9' }, [], 'md', NOW).text;
    assert.match(empty, /0 claims: 0 shown by their turn/);
    assert.match(empty, /This session has made no claim of done, passed, fixed or deployed yet\./);
});

test('export: CSV a spreadsheet opens as data, never as a formula', () => {
    assert.equal(csvField('plain'), 'plain');
    assert.equal(csvField('a, b'), '"a, b"');
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField('two\nlines'), '"two\nlines"');
    assert.equal(csvField('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
    for (const lead of ['+', '-', '@', '\t', '\r']) assert.ok(csvField(`${lead}1`).replace(/^"/, '').startsWith(`'${lead}`), JSON.stringify(lead));
    assert.equal(csvField(3), '3');
    assert.equal(csvField(undefined), '');

    const claims = [{ id: '1:0', turn: 1, at: NOW, kind: 'passed', text: '=1+1 tests pass, all "green"', verdict: 'unbacked', why: 'No run, in this turn.', evidence: [], ran: ['`ls` exited 0'], check: { state: 'verified', reason: 'Re-ran, 5 pass', endedAt: NOW } }];
    const file = exportLedger({ id: 's1', title: 'T' }, claims, 'csv', NOW);
    assert.equal(file.type, 'text/csv');
    assert.equal(file.name, 'proof-ledger-t-2026-10-17.csv');
    const lines = file.text.split('\r\n');
    assert.equal(lines[0], 'session,title,turn,claimed_at,kind,claim,verdict,why,evidence,ran,check,check_reason,checked_at');
    assert.equal(lines[1], 's1,T,1,2026-10-17T17:30:00Z,passed,"\'=1+1 tests pass, all ""green""",No evidence,"No run, in this turn.",,`ls` exited 0,Verified,"Re-ran, 5 pass",2026-10-17T17:30:00Z');
    assert.equal(lines.at(-1), '', 'every row ends with CRLF');
});

test('export: JSON with every field, and refusals in words', () => {
    const { claims } = ledgerOf([...turn(1, { prompt: 'Run the tests.', tools: [testRun], reply: 'Ran them.' }), ...turn(2, { prompt: 'thanks, summarize', reply: 'All 5 tests pass.' })]);
    const all = withChecks(claims, [{ claimId: claims[0].id, state: 'verified', reason: 'Re-ran: 5 pass.', model: 'Flash from owner-ascents', by: 'you', checkSessionId: 'session-c', startedAt: NOW - 60000, endedAt: NOW }]);
    const file = exportLedger({ id: 'session-abcdef0123', title: '', cwd: '/w' }, all, 'json', NOW);
    assert.equal(file.type, 'application/json');
    assert.equal(file.name, 'proof-ledger-abcdef01-2026-10-17.json', 'no title: the id names it');
    const data = JSON.parse(file.text);
    assert.deepEqual(data.session, { id: 'session-abcdef0123', title: '', cwd: '/w' });
    assert.equal(data.exportedAt, '2026-10-17T17:30:00Z');
    assert.equal(data.counts.total, 1);
    assert.equal(data.claims[0].evidenceFromTurn, 1);
    assert.equal(data.claims[0].verdict, 'backed');
    assert.deepEqual(data.claims[0].check, { state: 'verified', reason: 'Re-ran: 5 pass.', model: 'Flash from owner-ascents', by: 'you', checkSession: 'session-c', startedAt: '2026-10-17T17:29:00Z', endedAt: '2026-10-17T17:30:00Z' });
    assert.deepEqual(EXPORT_FORMATS, ['md', 'csv', 'json']);
    assert.throws(() => exportLedger({ id: 's' }, [], 'pdf'), /Export as Markdown \(md\), CSV \(csv\) or JSON \(json\), not "pdf"\./);
    assert.equal(exportName({ id: 'session-x', title: '  ### ' }, 'md', NOW), 'proof-ledger-x-2026-10-17.md');
    assert.equal(VERDICT_WORDS.unbacked, 'No evidence');
    assert.equal(CHECK_WORDS.failed, 'Could not check');
});

// ── The check thread's limits ──────────────────────────────────────

const sh = (command) => ({ name: 'bash', arguments: JSON.stringify({ command }) });

test('check threads: only tools that read or run, and no command that sends or changes anything', () => {
    for (const name of CHECK_TOOLS) assert.equal(refusalOf({ name, arguments: '{}' }), undefined, name);
    for (const name of ['edit', 'write', 'multi_edit', 'apply_patch', 'agent', '']) assert.match(refusalOf({ name }), /only read and run commands, so .* is refused/);
    for (const command of [
        'npm test', 'git log --oneline -5', 'git status', 'git diff HEAD~1', 'grep -rn "git commit" .', 'curl -s https://example.com/health',
        'kubectl get pods -n staging', 'sha256sum dist/app.tgz', 'grep -r service .', 'echo kill', 'docker ps', 'sed -n 1,20p a.txt',
        'pytest -q', 'node --test', 'terraform plan', 'gh pr list', 'jq . package.json', 'crontab -l', 'git branch -a', 'cargo test', 'go test ./...', 'make test',
    ]) assert.equal(refusalOf(sh(command)), undefined, command);
    const said = (command) => refusalOf(sh(command)) ?? '';
    assert.match(said('git push origin main'), /^Refused: it pushes to origin \(git push\), and a check never sends anything elsewhere\. Check by reading instead\.$/);
    assert.match(said('npm publish'), /^Refused: it publishes/);
    assert.match(said('curl -X POST https://api.example.com/deploy'), /^Refused: it /);
    for (const [command, words] of [
        ['git commit -am wip', 'git commit changes the repository'],
        ['cd app && git reset --hard', 'git reset changes the repository'],
        ['npm install left-pad', 'npm install changes the installed packages'],
        ['npm ci', 'npm ci changes the installed packages'],
        ['sudo pkill node', 'pkill changes running processes'],
        ['systemctl restart api', 'systemctl changes running processes'],
        ['docker run --rm alpine true', 'docker run changes containers'],
        ['sed -i s/a/b/ x.txt', 'sed -i edits files'],
        ['crontab jobs.txt', 'crontab changes scheduled jobs'],
        ['git branch -D old', 'git branch with that option changes the repository'],
        ['pip install requests', 'pip install changes what is installed'],
    ]) assert.equal(said(command), `Refused: ${words}, and a check only reads and runs. Check without changing anything.`, command);
    // Arguments as an object, as "cmd", or not JSON at all.
    assert.match(refusalOf({ name: 'bash', arguments: { cmd: 'git push' } }), /^Refused/);
    assert.match(refusalOf({ name: 'bash', arguments: 'git push' }), /^Refused/);
    assert.equal(refusalOf({ name: 'bash', arguments: { command: '  ' } }), undefined);
});

test('check verdicts: the last line that starts with VERIFIED or NOT VERIFIED, and its reason', () => {
    assert.deepEqual(verdictIn('Ran `npm test`.\nVERIFIED: npm test exited 0 with 5 passing.'), { state: 'verified', reason: 'npm test exited 0 with 5 passing.' });
    assert.deepEqual(verdictIn('**NOT VERIFIED** — the hash differs from the listing.'), { state: 'not-verified', reason: 'the hash differs from the listing.' });
    assert.deepEqual(verdictIn('> ## Not Verified. Nothing answers on staging.'), { state: 'not-verified', reason: 'Nothing answers on staging.' });
    assert.deepEqual(verdictIn('The tests ran clean.\nVERIFIED'), { state: 'verified', reason: 'The tests ran clean.' });
    assert.deepEqual(verdictIn('If it had failed I would say NOT VERIFIED.\nVERIFIED: 5 pass.'), { state: 'verified', reason: '5 pass.' }, 'the last verdict line counts');
    assert.equal(verdictIn('UNVERIFIED claim, I think.'), undefined);
    assert.equal(verdictIn('It seems fine.'), undefined);
    assert.equal(verdictIn(''), undefined);
    assert.equal(verdictIn(undefined), undefined);
    assert.equal(verdictIn(`VERIFIED: ${'x'.repeat(500)}`).reason.length <= 300, true);
});

test('check prompt: the claim, the ask, what the turn ran, the limits and how to answer', () => {
    const claim = { turn: 3, text: 'Deployed to staging.', ask: 'Now deploy it.', ran: ['`kubectl apply -f k8s/` exited 0'], why: 'Nothing in this turn deployed.' };
    const text = promptFor({ claim, title: 'Release', cwd: '/work/app', minutes: 5 });
    assert.ok(text.startsWith(`${CHECK_LINE} Check one claim another session made, on your own, without changing anything.`));
    assert.match(text, /The claim, from turn 3 of "Release" \(in \/work\/app\):\n> Deployed to staging\./);
    assert.match(text, /What the person asked in that turn:\n> Now deploy it\./);
    assert.match(text, /What that turn ran:\n- `kubectl apply -f k8s\/` exited 0/);
    assert.match(text, /Proof's reading: Nothing in this turn deployed\./);
    assert.match(text, /Work in \/work\/app\./);
    assert.match(text, /nothing it runs can write a file, not even in \/tmp/);
    assert.match(text, /You have about 5 minutes\./);
    assert.ok(text.endsWith('End your reply with one line that starts with VERIFIED or NOT VERIFIED, then the reason in one sentence.'));
    const leaned = promptFor({ claim: { turn: 2, text: 'All pass.', from: 1, ran: [], why: '' }, title: '', minutes: 1 });
    assert.match(leaned, /from turn 2 of that session:/);
    assert.match(leaned, /What turn 1 ran \(that turn ran nothing itself\):\n- nothing: it ran no command and read no file\./);
    assert.match(leaned, /Proof's reading: nothing in that turn shows it\./);
    assert.match(leaned, /You have about 1 minute\./);
});

test('check store: anything unknown is dropped, the rest kept', () => {
    assert.deepEqual(parseChecks(undefined), { v: 1, checks: {}, sessions: {}, autoSince: 0 });
    assert.deepEqual(parseChecks({ v: 2, checks: { a: {} } }).checks, {});
    const data = parseChecks({
        v: 1,
        autoSince: 5,
        sessions: { 'session-c': 's#1:0', bad: 3 },
        checks: {
            's#1:0': { sessionId: 's', claimId: '1:0', state: 'verified', turn: 1, claim: 'Done.', reason: 'Yes.', by: 'auto', model: 'm', checkSessionId: 'session-c', queuedAt: 1, startedAt: 2, endedAt: 3, reply: 'r'.repeat(900) },
            's#2:0': { sessionId: 's', claimId: '2:0', state: 'exploded' },
            junk: 'x',
        },
    });
    assert.deepEqual(Object.keys(data.checks), ['s#1:0']);
    assert.equal(data.checks['s#1:0'].reply.length, 600);
    assert.equal(data.checks['s#1:0'].by, 'auto');
    assert.deepEqual(data.sessions, { 'session-c': 's#1:0' });
    assert.equal(data.autoSince, 5);
});

// ── The independent check ──────────────────────────────────────────

/** DSH as the verifier asks for it: sessions with logs, and every call it made. */
function standInDsh(sessions = {}) {
    const calls = [];
    const dsh = {
        calls,
        sessions,
        noModel: false,
        cannotCreate: false,
        named: (name) => calls.filter((c) => c[0] === name),
        async inspect(id) {
            calls.push(['inspect', id]);
            const s = sessions[id];
            if (!s) throw new Error(`no session ${id}`);
            return { meta: { cwd: s.cwd ?? '' }, events: s.events ?? [] };
        },
        async titleOf(id) { return sessions[id]?.title ?? ''; },
        async resolveModel(wanted) {
            calls.push(['resolveModel', wanted]);
            if (dsh.noModel) throw new Error('no such model');
            return { provider: wanted.provider, model: wanted.model, reasoningEffort: 'max' };
        },
        async createNear(sessionId, id, cwd) {
            calls.push(['createNear', sessionId, id, cwd]);
            if (dsh.cannotCreate) throw new Error('the disk is full');
            sessions[id] = { cwd, events: [] };
        },
        async rename(id, title) { calls.push(['rename', id, title]); },
        async agentOf(id) { calls.push(['agentOf', id]); return { id }; },
        prepare(agent, { cwd } = {}) { calls.push(['prepare', agent.id, cwd]); },
        async select(agent, selection) { calls.push(['select', agent.id, selection]); },
        async send(agent, text) { calls.push(['send', agent.id, text]); },
        async cancel(id) { calls.push(['cancel', id]); },
    };
    return dsh;
}

const SETTINGS = { enabled: true, flags: true, verifier: 'ask', verifierProvider: 'owner-ascents', verifierModel: 'GLM-5.3-Flash-EXL3', verifierMinutes: 5, verifierPerHour: 12 };

/** A verifier over stand-ins, with its store and log on disk in a temp folder. */
function bench({ settings = {}, sessions, ok = true } = {}) {
    const clock = manualClock();
    const dir = tempDir('proof-verifier');
    const config = { ...SETTINGS, ...settings };
    const dsh = standInDsh(sessions ?? { s: { cwd: '/work/app', title: 'Release', events: mixedSession() } });
    const store = new JsonStore(join(dir, 'checks.json'), { parse: parseChecks });
    const journal = new Journal(join(dir, 'events.jsonl'), { now: clock.now });
    let changes = 0;
    const state = { ok };
    const verifier = new Verifier({
        config, working: () => state.ok && config.enabled !== false, dsh, store, journal, logger: { warn() {} },
        changed: () => { changes += 1; }, now: clock.now, after: clock.after, clear: clock.clearTimer,
    });
    return { clock, dir, config, dsh, store, journal, verifier, state, changes: () => changes };
}

const claimOf = (events, verdict) => ledgerOf(events).claims.find((c) => c.verdict === verdict);
const reply = (text) => ({ type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } });
const ended = (kind = 'completed', extra = {}) => ({ type: 'turn/end', data: { reason: { kind, ...extra } } });

test('check: off, or Proof not working, says so and starts nothing', async () => {
    const off = bench({ settings: { verifier: 'off' } });
    await assert.rejects(off.verifier.request('s', '3:0'), /The independent check is off\. Turn it on in Proof's settings \("Independent check"\)\./);
    const down = bench({ ok: false });
    await assert.rejects(down.verifier.request('s', '3:0'), /Proof is not working now: see the top of its page\./);
    const ask = bench();
    await assert.rejects(ask.verifier.request('', '3:0'), /Name the session and the claim to check\./);
    await assert.rejects(ask.verifier.request('s', 'nope'), /That claim is not in the session's log any more, so it cannot be checked\./);
    assert.equal(ask.dsh.named('createNear').length, 0);
});

test('check: a fresh read-only thread beside the session, on the check model, asked the claim; VERIFIED settles it', async () => {
    const b = bench();
    const claim = claimOf(b.dsh.sessions.s.events, 'unbacked');
    const queued = await b.verifier.request('s', claim.id);
    assert.equal(queued.state === 'queued' || queued.state === 'running', true);
    assert.equal(queued.by, 'you');
    assert.equal(queued.model, 'GLM-5.3-Flash-EXL3 from owner-ascents');
    await settle();
    const check = b.verifier.data.checks[`s#${claim.id}`];
    assert.equal(check.state, 'running');
    const id = check.checkSessionId;
    assert.match(id, /^session-[0-9a-f-]{36}$/);
    assert.equal(b.verifier.isCheckSession(id), true);
    assert.equal(b.verifier.checkOf(id), check);
    assert.deepEqual(b.dsh.named('createNear')[0], ['createNear', 's', id, '/work/app']);
    assert.deepEqual(b.dsh.named('rename')[0], ['rename', id, 'Proof check · Deployed to staging.']);
    assert.deepEqual(b.dsh.named('prepare')[0], ['prepare', id, '/work/app'], 'made read-only before it is asked anything');
    assert.deepEqual(b.dsh.named('select')[0], ['select', id, { provider: 'owner-ascents', model: 'GLM-5.3-Flash-EXL3', reasoningEffort: 'max' }]);
    const order = b.dsh.calls.map((c) => c[0]);
    assert.ok(order.indexOf('prepare') < order.indexOf('send') && order.indexOf('select') < order.indexOf('send'));
    const prompt = b.dsh.named('send')[0][2];
    assert.ok(prompt.startsWith(CHECK_LINE));
    assert.match(prompt, /from turn 3 of "Release" \(in \/work\/app\)/);
    // Asking again while it runs gives the same check back.
    assert.equal(await b.verifier.request('s', claim.id), check);
    assert.equal(b.dsh.named('createNear').length, 1);
    // Its own thread's claims are never checked.
    await assert.rejects(b.verifier.request(id, '1:0'), /one of Proof's own check threads/);

    b.verifier.onEvent({ id }, reply('kubectl shows no rollout on staging.'));
    b.verifier.onEvent({ id: 'someone-else' }, ended());
    assert.equal(check.state, 'running', 'another session\'s turn end changes nothing');
    b.verifier.onEvent({ id }, reply('I looked at the rollout history.\nNOT VERIFIED: staging still runs the old image.'));
    b.verifier.onEvent({ id }, ended());
    assert.equal(check.state, 'not-verified');
    assert.equal(check.reason, 'staging still runs the old image.');
    assert.match(check.reply, /NOT VERIFIED/);
    assert.equal(b.dsh.named('cancel').length, 0);
    const log = b.journal.list().map((e) => e.text);
    assert.deepEqual(log, ['Not verified: “Deployed to staging.”', 'Checking “Deployed to staging.”', 'Check asked for: “Deployed to staging.”']);
    assert.equal(b.journal.list()[1].why, 'In a new read-only thread on GLM-5.3-Flash-EXL3 from owner-ascents, for at most 5 minutes.');
    assert.ok(b.changes() >= 3);
    // The store on disk has it.
    b.store.flush();
    const saved = parseChecks(JSON.parse(readFileSync(join(b.dir, 'checks.json'), 'utf8')));
    assert.equal(saved.checks[`s#${claim.id}`].state, 'not-verified');
    assert.equal(saved.sessions[id], `s#${claim.id}`);
    // Check again: a new thread; the old one no longer answers for the claim.
    await b.verifier.request('s', claim.id);
    await settle();
    const again = b.verifier.data.checks[`s#${claim.id}`];
    assert.notEqual(again.checkSessionId, id);
    assert.equal(b.verifier.checkOf(id), undefined);
    assert.equal(b.verifier.isCheckSession(id), true, 'still known as a check thread');
});

test('check: one at a time, and at most the hour\'s budget; the rest wait their turn', async () => {
    const events = [
        ...turn(1, { prompt: 'Deploy.', reply: 'Deployed to staging.' }),
        ...turn(2, { prompt: 'Publish it.', reply: 'Published @acme/sdk@1.2.0 to npm.' }),
        ...turn(3, { prompt: 'Deploy prod.', reply: 'Deployed to production.' }),
    ];
    const b = bench({ settings: { verifierPerHour: 2 }, sessions: { s: { cwd: '/w', events } } });
    const ids = ledgerOf(events).claims.map((c) => c.id);
    assert.equal(ids.length, 3);
    for (const id of ids) await b.verifier.request('s', id);
    await settle();
    const checks = ids.map((id) => b.verifier.data.checks[`s#${id}`]);
    assert.deepEqual(checks.map((c) => c.state), ['running', 'queued', 'queued'], 'one at a time');
    const answer = (check, text) => {
        b.verifier.onEvent({ id: check.checkSessionId }, reply(text));
        b.verifier.onEvent({ id: check.checkSessionId }, ended());
    };
    answer(checks[0], 'VERIFIED: it answers.');
    await settle();
    assert.deepEqual(checks.map((c) => c.state), ['verified', 'running', 'queued']);
    answer(checks[1], 'VERIFIED: the registry lists 1.2.0.');
    await settle();
    assert.equal(checks[2].state, 'queued', 'two started this hour: the third waits');
    assert.equal(b.verifier.budget().used, 2);
    assert.ok(b.verifier.budget().nextAt > b.clock.now());
    await b.clock.advance(59 * 60_000);
    assert.equal(checks[2].state, 'queued');
    await b.clock.advance(2 * 60_000);
    assert.equal(checks[2].state, 'running', 'it starts when the hour allows');
    // A new ask while the budget is used up says when it starts.
    const late = bench({ settings: { verifierPerHour: 1 }, sessions: { s: { cwd: '/w', events } } });
    await late.verifier.request('s', ids[0]);
    await settle();
    late.verifier.onEvent({ id: late.verifier.data.checks[`s#${ids[0]}`].checkSessionId }, ended());
    const waiting = await late.verifier.request('s', ids[1]);
    assert.match(waiting.reason, /^Waits until .+: 1 checks have started in the last hour, the most Proof's settings allow\.$/);
});

test('check: one that takes too long is stopped and unclear; turns that end badly say why', async () => {
    const b = bench();
    const claim = claimOf(b.dsh.sessions.s.events, 'unbacked');
    await b.verifier.request('s', claim.id);
    await settle();
    const check = b.verifier.data.checks[`s#${claim.id}`];
    await b.clock.advance(5 * 60_000 + 1);
    assert.equal(check.state, 'unclear');
    assert.equal(check.reason, 'It took longer than 5 minutes, so Proof stopped it. Open the check to see how far it got.');
    assert.deepEqual(b.dsh.named('cancel')[0], ['cancel', check.checkSessionId]);
    // Late events from the stopped thread change nothing.
    b.verifier.onEvent({ id: check.checkSessionId }, reply('VERIFIED: fine.'));
    b.verifier.onEvent({ id: check.checkSessionId }, ended());
    assert.equal(check.state, 'unclear');

    const outcomes = [
        [[ended('error', { message: 'model overloaded' })], 'failed', "The check's turn ended with an error: model overloaded."],
        [[ended('cancelled')], 'unclear', 'The check was stopped before it answered.'],
        [[reply('It looks fine to me.'), ended()], 'unclear', 'Its reply did not end with VERIFIED or NOT VERIFIED. Open the check to read it.'],
        [[ended()], 'unclear', 'It ended without a reply.'],
        [[reply('VERIFIED')], 'running', ''],
    ];
    for (const [events, state, reason] of outcomes) {
        const c = bench();
        await c.verifier.request('s', claim.id);
        await settle();
        const k = c.verifier.data.checks[`s#${claim.id}`];
        for (const event of events) c.verifier.onEvent({ id: k.checkSessionId }, event);
        assert.equal(k.state, state, reason);
        assert.equal(k.reason, reason);
        c.verifier.stop();
    }
    const quiet = bench();
    await quiet.verifier.request('s', claim.id);
    await settle();
    const k = quiet.verifier.data.checks[`s#${claim.id}`];
    quiet.verifier.onEvent({ id: k.checkSessionId }, reply('VERIFIED'));
    quiet.verifier.onEvent({ id: k.checkSessionId }, ended());
    assert.equal(k.state, 'verified');
    assert.equal(k.reason, 'It gave no reason.');
});

test('check: when DSH cannot start it, the check says where it stopped, in words', async () => {
    const noModel = bench();
    noModel.dsh.noModel = true;
    const claim = claimOf(noModel.dsh.sessions.s.events, 'unbacked');
    await noModel.verifier.request('s', claim.id);
    await settle();
    const a = noModel.verifier.data.checks[`s#${claim.id}`];
    assert.equal(a.state, 'failed');
    assert.equal(a.reason, 'DSH has no model GLM-5.3-Flash-EXL3 from owner-ascents to check with (no such model). Pick one DSH lists in Proof\'s settings ("Check with the model").');
    assert.equal(noModel.dsh.named('createNear').length, 0);

    const noThread = bench();
    noThread.dsh.cannotCreate = true;
    await noThread.verifier.request('s', claim.id);
    await settle();
    const b = noThread.verifier.data.checks[`s#${claim.id}`];
    assert.equal(b.state, 'failed');
    assert.equal(b.reason, 'Could not start the check while opening the check thread: the disk is full.');
    assert.equal(noThread.dsh.named('send').length, 0);

    // The claim left the log between the ask and the start.
    const gone = bench();
    const asked = await gone.verifier.request('s', 'zz:9', { claim: { id: 'zz:9', turn: 9, text: 'Shipped.', verdict: 'unbacked' } });
    await settle();
    assert.equal(asked.state, 'failed');
    assert.equal(asked.reason, 'The claim is not in the session\'s log any more.');
});

test('check: switching the check off drops what waits; a restart finishes what it cut off', async () => {
    const events = [...turn(1, { prompt: 'Deploy.', reply: 'Deployed to staging.' }), ...turn(2, { prompt: 'Publish it.', reply: 'Published @acme/sdk@1.2.0 to npm.' })];
    const b = bench({ sessions: { s: { cwd: '/w', events } } });
    const [one, two] = ledgerOf(events).claims;
    await b.verifier.request('s', one.id);
    await b.verifier.request('s', two.id);
    await settle();
    b.config.verifier = 'off';
    b.verifier.settingsChanged();
    await settle();
    const waiting = b.verifier.data.checks[`s#${two.id}`];
    assert.equal(waiting.state, 'failed');
    assert.equal(waiting.reason, 'Not checked: the independent check was switched off.');
    assert.equal(b.verifier.data.checks[`s#${one.id}`].state, 'running', 'the one already running finishes');

    // Proof restarts with checks that were running.
    const r = bench({ sessions: { s: { cwd: '/w', events }, 'session-done': { events: [reply('VERIFIED: the registry lists it.'), ended()] }, 'session-open': { events: [reply('Looking…')] } } });
    const base = { sessionId: 's', turn: 1, claim: 'Deployed to staging.', verdict: 'unbacked', by: 'you', model: 'm', queuedAt: r.clock.now() - 1000, startedAt: r.clock.now() - 1000, reason: '' };
    r.verifier.data.checks['s#a'] = { ...base, key: 's#a', claimId: 'a', state: 'running' };
    r.verifier.data.checks['s#b'] = { ...base, key: 's#b', claimId: 'b', state: 'running', checkSessionId: 'session-done' };
    r.verifier.data.checks['s#c'] = { ...base, key: 's#c', claimId: 'c', state: 'running', checkSessionId: 'session-open' };
    r.verifier.data.checks['s#d'] = { ...base, key: 's#d', claimId: 'd', state: 'running', checkSessionId: 'session-lost' };
    for (const k of ['b', 'c', 'd']) r.verifier.data.sessions[r.verifier.data.checks[`s#${k}`].checkSessionId] = `s#${k}`;
    r.verifier.start();
    await settle();
    assert.equal(r.verifier.data.checks['s#a'].state, 'failed');
    assert.equal(r.verifier.data.checks['s#a'].reason, 'Proof restarted before this check began. Press Check to run it again.');
    assert.equal(r.verifier.data.checks['s#b'].state, 'verified', 'its answer was already in its thread');
    assert.equal(r.verifier.data.checks['s#c'].state, 'running', 'still running: it waits for its answer again');
    assert.match(r.verifier.data.checks['s#d'].reason, /^Proof restarted while this check ran, and its thread could not be read \(no session session-lost\)\./);
    r.verifier.onEvent({ id: 'session-open' }, reply('NOT VERIFIED: no such version.'));
    r.verifier.onEvent({ id: 'session-open' }, ended());
    assert.equal(r.verifier.data.checks['s#c'].state, 'not-verified');
});

test('check: "By itself" checks each new flagged claim once, and none made before it was on', async () => {
    const b = bench({ settings: { verifier: 'auto' } });
    b.verifier.start();
    const since = b.verifier.data.autoSince;
    assert.equal(since, b.clock.now());
    const flaggedView = (claims) => ({ total: claims.length, flagged: claims });
    const fresh = { id: '3:0', turn: 3, at: since + 10, text: 'Deployed to staging.', verdict: 'unbacked' };
    const old = { id: '2:0', turn: 2, at: since - 10, text: 'Fixed it.', verdict: 'unbacked' };
    b.verifier.onView('s', flaggedView([old, fresh]));
    b.verifier.onView('s', flaggedView([old, fresh]));
    await settle();
    const keys = Object.keys(b.verifier.data.checks);
    assert.deepEqual(keys, ['s#3:0'], 'once, and only the new claim');
    assert.equal(b.verifier.data.checks['s#3:0'].by, 'auto');
    assert.match(b.journal.list().at(-1).why, /by itself/);
    // Check threads and a check view are never checked.
    const id = b.verifier.data.checks['s#3:0'].checkSessionId;
    b.verifier.onView(id, flaggedView([{ ...fresh, id: '1:0' }]));
    b.verifier.onView('t', { total: 0, flagged: [], check: true });
    await settle();
    assert.equal(Object.keys(b.verifier.data.checks).length, 1);
    // Back to "ask": nothing by itself, and "By itself" starts afresh next time.
    b.config.verifier = 'ask';
    b.verifier.settingsChanged();
    assert.equal(b.verifier.data.autoSince, 0);
    b.verifier.onView('s', flaggedView([{ ...fresh, id: '4:0', at: b.clock.now() + 5 }]));
    await settle();
    assert.equal(Object.keys(b.verifier.data.checks).length, 1);
});

test('check: the store keeps the latest 400 checks and forgets the threads of those it drops', () => {
    const b = bench();
    for (let i = 0; i < 405; i += 1) {
        const key = `s#${i}:0`;
        b.verifier.data.checks[key] = { key, sessionId: 's', claimId: `${i}:0`, turn: i, claim: 'x', verdict: 'unbacked', state: 'verified', reason: '', by: 'you', model: '', checkSessionId: `session-${i}`, queuedAt: i, endedAt: i };
        b.verifier.data.sessions[`session-${i}`] = key;
    }
    b.verifier.trim();
    assert.equal(Object.keys(b.verifier.data.checks).length, 400);
    assert.equal(b.verifier.data.checks['s#0:0'], undefined, 'the oldest go first');
    assert.equal(b.verifier.isCheckSession('session-0'), false);
    assert.equal(b.verifier.isCheckSession('session-404'), true);
    assert.equal(b.verifier.recent(3).length, 3);
});

// ── What the page and the flags read ───────────────────────────────

test('page: everything in one read; sessions only while Proof works; a check thread says what it checks', async () => {
    const b = bench();
    const claim = claimOf(b.dsh.sessions.s.events, 'unbacked');
    await b.verifier.request('s', claim.id);
    await settle();
    const parts = { config: b.config, check: { ok: true }, verifier: b.verifier, journal: b.journal, dsh: b.dsh, rows: async () => [{ sessionId: 's', total: 4 }] };
    const state = await pageState(parts);
    assert.equal(state.problem, undefined);
    assert.equal(state.enabled, true);
    assert.equal(state.flags, true);
    assert.deepEqual(state.verifier, { mode: 'ask', provider: 'owner-ascents', model: 'GLM-5.3-Flash-EXL3', minutes: 5, perHour: 12, used: 1, nextAt: 0 });
    assert.deepEqual(state.sessions, [{ sessionId: 's', total: 4 }]);
    assert.equal(state.checks.length, 1);
    assert.equal(state.history.length, 2);
    const problem = { key: 'verifierMinutes', text: 'x', live: true };
    const broken = await pageState({ ...parts, check: { ok: false, problem } });
    assert.equal(broken.problem, problem);
    assert.deepEqual(broken.sessions, [], 'nothing is read while a setting is wrong');
    assert.equal(working({ config: { enabled: false }, check: { ok: true } }), false);

    const session = await sessionState(parts, 's');
    assert.deepEqual({ ...session, checks: session.checks.length }, { on: true, flags: true, verifier: 'ask', isCheck: false, checks: 1 });
    const id = b.verifier.data.checks[`s#${claim.id}`].checkSessionId;
    const thread = await sessionState(parts, id);
    assert.equal(thread.isCheck, true);
    assert.deepEqual(thread.checkOf, { sessionId: 's', turn: 3, claim: 'Deployed to staging.', state: 'running', reason: '', model: 'GLM-5.3-Flash-EXL3 from owner-ascents', title: 'Release' });
    const quiet = await sessionState({ ...parts, config: { ...b.config, flags: false } }, 's');
    assert.equal(quiet.flags, false);
    const down = await sessionState({ ...parts, check: { ok: false } }, 's');
    assert.deepEqual([down.on, down.flags, down.verifier], [false, false, 'off']);

    const ledger = await ledgerState(parts, 's');
    assert.deepEqual(ledger.session, { id: 's', title: 'Release', cwd: '/work/app' });
    assert.equal(ledger.isCheck, false);
    assert.equal(ledger.counts.total, ledger.claims.length);
    assert.equal(ledger.claims.find((c) => c.id === claim.id).check.state, 'running');
    await assert.rejects(ledgerState(parts, 'missing'), /no session missing/);
});
