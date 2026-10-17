/**
 * Proof's host half: which sentences are claims (claims.js), what a tool's
 * output shows (evidence.js), and the per-session ledger DSH folds over a
 * session's events (projection.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsIn, kindOf, sentencesOf } from '../plugins/proof/lib/claims.js';
import { asksForWork, ciIn, deployIn, exitOf, hashIn, healthIn, itemOf, judge, numsIn, seriesIn, statusIn, testCountsIn } from '../plugins/proof/lib/evidence.js';
import { INITIAL, KEY, STATE_VERSION, applyEvent, flagged, foldAll, parseState, parseView, proofProjection, viewOf } from '../plugins/proof/lib/projection.js';

const bash = (command, output) => itemOf({ name: 'bash', args: { command }, text: output });
const edit = (file) => itemOf({ name: 'edit', args: { file_path: file, old_string: 'a', new_string: 'b' }, text: `The file ${file} has been updated successfully.` });
const read = (file) => itemOf({ name: 'read', args: { file_path: file }, text: '     1\tx' });
const only = (text) => {
    const found = claimsIn(text);
    assert.equal(found.length, 1, `${text}: ${JSON.stringify(found)}`);
    return found[0];
};

// ── Claims ─────────────────────────────────────────────────────────

test('claims: plain success statements of each kind', () => {
    assert.equal(only('All 42 tests pass.').kind, 'passed');
    assert.equal(only('The build is green.').kind, 'passed');
    assert.equal(only('Deployed to staging.').kind, 'deployed');
    assert.equal(only('Pushed to main.').target, 'repo');
    assert.equal(only('Published @acme/sdk@1.2.0 to npm.').target, 'registry');
    assert.equal(only('GET /health returns 200.').target, 'health');
    assert.equal(only('Fixed the crash in the parser.').kind, 'fixed');
    assert.equal(only('The parser no longer panics on empty input.').kind, 'fixed');
    assert.equal(only('I added the endpoint and its route.').kind, 'done');
    assert.equal(only('Done.').kind, 'done');
});

test('claims: questions, plans, conditions, hedges and failures claim nothing', () => {
    for (const text of [
        'Should I deploy it to staging?',
        'Once CI passes I will merge it.',
        'I\'ll run the tests next.',
        'The build still fails on Windows.',
        '3 tests fail; the cause is the timezone.',
        'This suggests the guard moved below the discount block.',
        'Nothing is committed yet.',
        'The README says the build passes.',
        'If the tests pass, it is safe to ship.',
    ]) assert.deepEqual(claimsIn(text), [], text);
});

test('claims: code blocks, quotes and tables are not read', () => {
    const text = 'Here is the plan:\n\n```\nAll tests pass\n```\n\n> Deployed to prod\n\n| step | state |\n| deploy | done |\n';
    assert.deepEqual(claimsIn(text), []);
});

test('claims: "no failures" and "zero errors" back a claim up rather than negate it', () => {
    assert.equal(only('Lint is clean with zero errors.').kind, 'passed');
    assert.equal(only('The suite passes with no failures.').kind, 'passed');
    assert.equal(only('`node --test`: 12 pass, 0 fail.').kind, 'passed');
    assert.equal(only('Full suite: 42 passed, 1 skipped, 2 xfailed.').kind, 'passed');
});

test('claims: a sentence is read clause by clause, one claim of each kind', () => {
    const found = claimsIn('Pushed to main — CI should pick it up.');
    assert.deepEqual(found.map((c) => [c.kind, c.part]), [['deployed', 'Pushed to main']]);
    const two = claimsIn('Deployed to staging and GET /health returns 200.');
    assert.deepEqual(two.map((c) => c.target), ['env', 'health']);
});

test('claims: what a passed claim names, and the commands and figures it quotes', () => {
    const c = only('`go test -race ./...` is clean and coverage is at 92%.');
    assert.deepEqual(c.commands, ['go test -race ./...']);
    assert.deepEqual(c.metrics.map((m) => m.value), [92]);
    assert.deepEqual(only('Lint, tests and the build pass.').subjects, ['lint', 'tests', 'build']);
    assert.equal(only('Checksums verified: every artifact matches its published SHA-256.').subject, 'hash');
    // Output in backticks is not a command.
    assert.equal(only('Rails is on 7.0.8.1 (`Bundle updated!`) and rspec is green.').commands, undefined);
});

test('claims: deploy words used as adjectives, or about something else, claim nothing', () => {
    assert.deepEqual(claimsIn('It reads the published checksum from the release page.'), []);
    assert.deepEqual(claimsIn('Landing it requires rewriting a branch that\'s already pushed.'), []);
});

test('claims: sentences keep version numbers whole, and kindOf names the first claim', () => {
    assert.deepEqual(sentencesOf('Bumped to v1.2.0. Tests pass.'), ['Bumped to v1.2.0.', 'Tests pass.']);
    assert.equal(kindOf('Tests pass.'), 'passed');
    assert.equal(kindOf('What next?'), undefined);
});

// ── What tools show ────────────────────────────────────────────────

test('evidence: exit codes from DSH\'s markers and from words', () => {
    assert.equal(exitOf('ok', { shell: true }), 0);
    assert.equal(exitOf('boom\n[exit code: 2]', { shell: true }), 2);
    assert.equal(exitOf('x\n[timed out after 120000ms]', { shell: true }), 'timeout');
    assert.equal(exitOf('Exit code: 0'), 0);
    assert.equal(exitOf('nothing said'), null);
});

test('evidence: test counts from the common runners', () => {
    assert.deepEqual(testCountsIn('# tests 12\n# pass 12\n# fail 0\n'), { passed: 12, failed: 0, total: 12 });
    assert.deepEqual(testCountsIn('Tests:       1 failed, 10 passed, 11 total'), { passed: 10, failed: 1, total: 11 });
    assert.deepEqual(testCountsIn(' Tests  2 failed | 40 passed (42)'), { passed: 40, failed: 2, total: 42 });
    assert.deepEqual(testCountsIn('===== 1 failed, 4 passed in 0.20s ====='), { passed: 4, failed: 1 });
    assert.deepEqual(testCountsIn('test result: ok. 5 passed; 0 failed; 0 ignored'), { passed: 5, failed: 0 });
    assert.deepEqual(testCountsIn('12 examples, 0 failures'), { passed: 12, failed: 0, total: 12 });
    assert.deepEqual(testCountsIn('Ran 7 tests in 0.010s\n\nOK'), { passed: 7, failed: 0, total: 7 });
    assert.deepEqual(testCountsIn('Tests: 12, Assertions: 31, Failures: 2.'), { passed: 10, failed: 2, total: 12 });
    assert.deepEqual(testCountsIn('Tests run: 18, Failures: 2, Errors: 1, Skipped: 0'), { passed: 15, failed: 3, total: 18 });
    assert.deepEqual(testCountsIn('ok  \texample.com/a\t0.01s\n--- FAIL: TestB (0.00s)\nFAIL\texample.com/b\t0.02s'), { passed: 1, failed: 2 });
    assert.equal(testCountsIn('nothing here'), undefined);
});

test('evidence: pushes, publishes, deploys, CI reads, requests and checksums', () => {
    assert.equal(deployIn('To github.com:a/b.git\n   abc1234..def5678  main -> main'), true);
    assert.equal(deployIn(' ! [rejected]        main -> main (fetch first)\nerror: failed to push some refs'), false);
    assert.equal(deployIn('+ @acme/sdk@1.2.0'), true);
    assert.equal(deployIn('npm ERR! code E403'), false);
    assert.equal(ciIn('✓ build\n✓ test'), true);
    assert.equal(ciIn('✓ build\nX e2e'), false);
    assert.equal(ciIn('* build  in progress'), undefined);
    assert.equal(statusIn('HTTP/2 200\ncontent-type: text/plain'), 200);
    assert.equal(statusIn('502\n'), 502);
    assert.equal(statusIn('curl: (22) The requested URL returned error: 503'), 503);
    assert.equal(statusIn('curl: (7) Failed to connect to localhost port 8080'), 0);
    assert.equal(statusIn('{"status":"ok"}'), 'ok');
    assert.equal(healthIn('✗ [2/2] ready: GET /ready -> 502'), false);
    assert.equal(hashIn('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  dist/app.tgz').length, 64);
});

test('evidence: figures and benchmark readings', () => {
    assert.ok(numsIn('p50 310ms p95 1.2s').includes(310));
    assert.ok(numsIn('p50 310ms p95 1.2s').includes(1200));
    assert.deepEqual(seriesIn('p50 310ms p95 612ms'), [{ l: 'p50', v: 310 }, { l: 'p95', v: 612 }]);
});

test('evidence: each tool result becomes one item of the right kind', () => {
    assert.equal(bash('npm test', '# pass 3\n# fail 0').kind, 'test');
    assert.equal(bash('npx eslint src/', '').kind, 'lint');
    assert.equal(bash('npm run build', 'built in 2s').kind, 'build');
    assert.deepEqual(bash('git push origin main', '   a1b2c3d..e4f5a6b  main -> main').targets, ['repo']);
    assert.deepEqual(bash('npm publish', '+ pkg@1.0.0').targets, ['registry']);
    assert.deepEqual(bash('kubectl -n prod rollout status deploy/api', 'deployment "api" successfully rolled out').targets, ['env']);
    assert.equal(bash('curl -sI https://staging.example.com/health', 'HTTP/2 200').status, 200);
    assert.equal(bash('gh pr checks 12', '✓ build\n✓ test').kind, 'ci');
    assert.equal(bash('sha256sum -c SHA256SUMS', 'a.tgz: FAILED\n[exit code: 1]').ok, false);
    assert.equal(edit('src/a.ts').code, true);
    assert.equal(edit('README.md').code, undefined);
    assert.equal(itemOf({ name: 'todo_write', args: {}, text: 'Todos updated.' }), undefined);
});

// ── Judging ────────────────────────────────────────────────────────

test('judge: a test claim needs a passing test run after the last code change', () => {
    const claim = only('All tests pass.');
    assert.equal(judge(claim, [edit('src/a.ts'), bash('npm test', '# pass 4\n# fail 0')]).verdict, 'backed');
    assert.equal(judge(claim, [edit('src/a.ts')]).verdict, 'unbacked');
    assert.equal(judge(claim, [bash('npm test', '# pass 3\n# fail 1\n[exit code: 1]')]).verdict, 'contradicted');
    const stale = judge(claim, [bash('npm test', '# pass 4\n# fail 0'), edit('src/a.ts')]);
    assert.equal(stale.verdict, 'unbacked');
    assert.match(stale.why, /came before the last change/);
    // A change to docs after the run does not matter.
    assert.equal(judge(claim, [bash('npm test', '# pass 4\n# fail 0'), edit('CHANGELOG.md')]).verdict, 'backed');
    // Lint is not a test run.
    assert.equal(judge(claim, [bash('npx eslint .', '')]).verdict, 'unbacked');
});

test('judge: a named count must match the run', () => {
    const run = bash('npx jest', 'Tests:       40 passed, 40 total');
    assert.equal(judge(only('All 40 tests pass.'), [run]).verdict, 'backed');
    assert.equal(judge(only('All 42 tests pass.'), [run]).verdict, 'contradicted');
});

test('judge: a named command must have run, and passed', () => {
    const claim = only('`go test ./...` passes.');
    assert.equal(judge(claim, [bash('go test ./... -race', 'ok  \tx/a\t0.1s')]).verdict, 'backed');
    assert.match(judge(claim, [bash('go vet ./...', '')]).why, /names `go test \.\/\.\.\.`, which did not run/);
});

test('judge: quoted figures must appear in the output', () => {
    const claim = only('41/41 passing, and coverage is at 92%.');
    assert.equal(judge(claim, [bash('npm test -- --coverage', '# pass 41\n# fail 0\nAll files | 92.1 |')]).verdict, 'backed');
    assert.match(judge(claim, [bash('npm test', '# pass 41\n# fail 0')]).why, /quotes 92%/);
});

test('judge: a deploy claim needs a deploy to that place, and nothing after it that says it is down', () => {
    assert.equal(judge(only('Pushed to main.'), [bash('git push origin main', '   a1b2c3d..e4f5a6b  main -> main')]).verdict, 'backed');
    assert.equal(judge(only('Pushed to main.'), [bash('git status', 'On branch main')]).verdict, 'unbacked');
    const push = bash('git push origin main', '   a1b2c3d..e4f5a6b  main -> main');
    assert.match(judge(only('Deployed to staging.'), [push]).why, /A push ran, but nothing in this turn deployed it/);
    const rollout = bash('kubectl -n staging rollout status deploy/api', 'deployment "api" successfully rolled out');
    assert.equal(judge(only('Deployed to staging.'), [rollout]).verdict, 'backed');
    const down = bash('curl -s -o /dev/null -w "%{http_code}" https://staging.example.com/health', '502');
    assert.equal(judge(only('Deployed to staging.'), [rollout, down]).verdict, 'contradicted');
    assert.equal(judge(only('Published @acme/sdk@1.2.0 to npm.'), [bash('npm publish', 'npm ERR! code E403\n[exit code: 1]')]).verdict, 'contradicted');
});

test('judge: a health claim with a status needs a request that answered it', () => {
    const claim = only('GET /health returns 200.');
    assert.equal(judge(claim, [bash('curl -sI https://x.example.com/health', 'HTTP/2 200')]).verdict, 'backed');
    assert.equal(judge(claim, [bash('curl -sI https://x.example.com/health', 'HTTP/2 503')]).verdict, 'contradicted');
    assert.equal(judge(claim, [bash('kubectl get pods', 'api-1  1/1  Running  0  2m')]).verdict, 'unbacked');
});

test('judge: a fix needs a change and a passing run after it', () => {
    const claim = only('Fixed the crash.');
    assert.equal(judge(claim, [edit('src/a.ts'), bash('npm test', '# pass 3\n# fail 0')]).verdict, 'backed');
    assert.match(judge(claim, [edit('src/a.ts')]).why, /nothing ran after the last change/);
    assert.equal(judge(claim, [edit('src/a.ts'), bash('npm test', '# pass 2\n# fail 1\n[exit code: 1]')]).verdict, 'contradicted');
});

test('judge: "it got faster" needs a measurement, and the turn\'s own numbers going the right way', () => {
    const claim = only('The encoder is faster: p50 310ms → 120ms.');
    const before = bash('npm run bench', 'p50 310ms p95 612ms');
    assert.equal(judge(claim, [before, edit('src/enc.ts'), bash('npm run bench', 'p50 120ms p95 300ms')]).verdict, 'backed');
    // Slower than before: the turn's own numbers say otherwise.
    assert.equal(judge(claim, [before, edit('src/enc.ts'), bash('npm run bench', 'p50 480ms p95 900ms')]).verdict, 'contradicted');
    // No figure it quotes printed anywhere.
    assert.equal(judge(claim, [edit('src/enc.ts'), bash('npm run bench', 'p50 280ms p95 600ms')]).verdict, 'unbacked');
    const worse = judge(only('The encoder is much faster now.'), [before, edit('src/enc.ts'), bash('npm run bench', 'p50 480ms p95 900ms')]);
    assert.equal(worse.verdict, 'contradicted');
    assert.match(worse.why, /went the other way: p50 310 ms -> 480 ms/);
});

test('judge: "done" needs a change when it says it changed something, or when the person asked for one', () => {
    assert.equal(judge(only('I added the migration.'), [edit('db/0033.py')]).verdict, 'backed');
    assert.equal(judge(only('I added the migration.'), [read('db/0032.py')]).verdict, 'unbacked');
    assert.equal(judge(only('Done.'), [read('a.ts')], { prompt: 'Add a retry to the client.' }).verdict, 'unbacked');
    assert.equal(judge(only('Done.'), [read('a.ts')], { prompt: 'Have a look at the client.' }).verdict, 'backed');
    // A description of the code after a question is not a claim of work.
    assert.equal(judge(only('The legacy path is wired through legacyPlugin.'), [read('vite.config.ts')], { prompt: 'Why is IE11 still in the bundle?' }).verdict, 'backed');
    assert.equal(judge(only('I added the migration.'), []).why, 'No tool ran in this turn.');
});

test('asksForWork: requests for new work, as against thanks and questions', () => {
    assert.equal(asksForWork('Now rename the module.'), true);
    assert.equal(asksForWork('Can you add a test for it?'), true);
    assert.equal(asksForWork('thanks, can you summarize?'), false);
    assert.equal(asksForWork('ok'), false);
});

// ── The session projection ─────────────────────────────────────────

let seq = 0;
function turn(n, { prompt = '', tools = [], reply = '', end = 'completed' } = {}) {
    const ev = [
        { type: 'turn/start', seq: ++seq, time: seq, data: { turn: n } },
        { type: 'user/message', seq: ++seq, time: seq, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] } },
    ];
    tools.forEach(([name, args, output], i) => {
        const callId = `c${n}-${i}`;
        ev.push({ type: 'tool/call', seq: ++seq, time: seq, data: { turn: n, step: i, callId, name, arguments: args } });
        ev.push({ type: 'tool/result', seq: ++seq, time: seq, data: { turn: n, step: i, message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: output }] } } });
    });
    if (reply) ev.push({ type: 'assistant/message', seq: ++seq, time: seq, data: { turn: n, message: { role: 'assistant', content: [{ type: 'text', text: reply }] } } });
    ev.push({ type: 'turn/end', seq: ++seq, time: seq, data: { turn: n, reason: { kind: end } } });
    return ev;
}
const testRun = ['bash', { command: 'npm test' }, '# pass 5\n# fail 0'];

test('projection: a backed claim is quiet, an unbacked one is flagged on its turn', () => {
    const state = foldAll([
        ...turn(1, { prompt: 'Fix it.', tools: [['edit', { file_path: 'src/a.ts' }, 'The file src/a.ts has been updated successfully.'], testRun], reply: 'Fixed. All 5 tests pass.' }),
        ...turn(2, { prompt: 'Now deploy it.', tools: [], reply: 'Deployed to staging.' }),
    ]);
    assert.deepEqual(state.claims.map((c) => [c.turn, c.kind, c.verdict]), [[1, 'fixed', 'backed'], [1, 'passed', 'backed'], [2, 'deployed', 'unbacked']]);
    const view = viewOf(state);
    assert.equal(view.total, 3);
    assert.deepEqual(view.flagged.map((c) => c.turn), [2]);
    assert.match(view.flagged[0].why, /asked for new work/);
});

test('projection: a summary turn leans on the turn before; a request for new work does not', () => {
    const work = turn(1, { prompt: 'Run the tests.', tools: [testRun], reply: 'All 5 tests pass.' });
    const thanks = foldAll([...work, ...turn(2, { prompt: 'thanks, can you summarize?', reply: 'All 5 tests pass.' })]);
    const leaned = thanks.claims.find((c) => c.turn === 2);
    assert.equal(leaned.verdict, 'backed');
    assert.equal(leaned.from, 1);
    const renamed = foldAll([...work, ...turn(2, { prompt: 'Now rename the module.', reply: 'Renamed it; all 5 tests pass.' })]);
    assert.ok(renamed.claims.filter((c) => c.turn === 2).every((c) => c.verdict === 'unbacked'));
});

test('projection: a stopped or failed turn is not judged', () => {
    const state = foldAll(turn(1, { prompt: 'Deploy.', reply: 'Deployed to staging.', end: 'cancelled' }));
    assert.deepEqual(state.claims, []);
});

test('projection: apply never throws, and an event that changes nothing returns the same state', () => {
    for (const junk of [null, 1, 'x', {}, { type: 1 }, { type: 'tool/result', data: null }, { type: 'turn/end' }]) {
        assert.doesNotThrow(() => applyEvent(INITIAL, junk));
    }
    assert.equal(applyEvent(INITIAL, { type: 'something/else', data: {} }), INITIAL);
    assert.equal(applyEvent('garbage', { type: 'turn/end', data: {} }), INITIAL);
});

test('projection: saved state and views parse back, and anything unknown becomes the empty ledger', () => {
    const state = foldAll(turn(1, { prompt: 'Deploy.', reply: 'Deployed to staging.' }));
    assert.deepEqual(parseState(JSON.parse(JSON.stringify(state))), state);
    assert.equal(parseState({ v: 99 }), INITIAL);
    assert.equal(parseState(undefined), INITIAL);
    const view = viewOf(state);
    assert.deepEqual(parseView(JSON.parse(JSON.stringify(view))).flagged.map((c) => c.id), view.flagged.map((c) => c.id));
    assert.deepEqual(parseView('x'), { total: 0, flagged: [] });
    assert.equal(flagged({ verdict: 'contradicted' }), true);
    assert.equal(flagged({ verdict: 'backed' }), false);
});

test('projection: the definition DSH registers', () => {
    const def = proofProjection();
    assert.equal(def.key, KEY);
    assert.equal(def.stateVersion, STATE_VERSION);
    assert.equal(def.init(), INITIAL);
    assert.equal(typeof def.wire.view, 'function');
});

test('projection: the view is the same object while the claims do not change (DSH sends a view only when it changes)', () => {
    let state = foldAll(turn(1, { prompt: 'Deploy.', reply: 'Deployed to staging.' }));
    const before = viewOf(state);
    state = applyEvent(state, { type: 'turn/start', seq: 1000, time: 1000, data: { turn: 2 } });
    state = applyEvent(state, { type: 'tool/call', seq: 1001, time: 1001, data: { callId: 'x', name: 'bash', arguments: { command: 'ls' } } });
    assert.equal(viewOf(state), before);
});
