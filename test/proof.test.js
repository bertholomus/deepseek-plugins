/**
 * Proof's host half: which sentences are claims (claims.js), what a tool's
 * output shows (evidence.js), and the per-session ledger DSH folds over a
 * session's events (projection.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claimsIn, kindOf, sentencesOf } from '../plugins/proof/lib/claims.js';
import { asksForWork, ciIn, deployIn, endedIn, exitOf, hashIn, healthIn, itemOf, judge, numsIn, readingsIn, seriesIn, statusIn, testCountsIn } from '../plugins/proof/lib/evidence.js';
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
    assert.equal(asksForWork('Tidy up: consolidate the three retry helpers.'), true);
    assert.equal(asksForWork('thanks, can you summarize?'), false);
    assert.equal(asksForWork('ok'), false);
});

// ── Rules from the first hold-out (measured once, then tuned on) ───

test('claims: "well" and "id" are words, not "we\'ll" and "I\'d"', () => {
    assert.equal(only('Benchmarks: p50 310ms → 120ms, well under the 150ms target.').kind, 'fixed');
    assert.deepEqual(claimsIn('We\'ll deploy it after lunch.'), []);
});

test('claims: descriptions of code, history and other people\'s results claim nothing', () => {
    for (const text of [
        '`b2f1c88` renamed the param.',
        'Tomas\'s change landed on main last week.',
        'They report 42 passing on their side.',
        'The two early `return 200` short-circuits fire before the check.',
        '`load()` passes `true` to the parser.',
        'You can cut the release.',
        'The cache is in play here.',
    ]) assert.deepEqual(claimsIn(text), [], text);
    // "stops cleanly" is how the code behaves, not a test result.
    assert.ok(!claimsIn('The worker now stops cleanly.').some((c) => c.kind === 'passed'));
});

test('claims: more ways to say it, and where it went', () => {
    assert.equal(only('cargo test: 18 passed, nothing failing.').kind, 'passed');
    assert.equal(only('The three retry helpers are consolidated into one shared `lib/retry.go`.').kind, 'done');
    assert.equal(only('The fix is in.').kind, 'done');
    assert.equal(only('Applied and live.').kind, 'deployed');
    assert.equal(only('The worker image is deployed to Fly staging.').target, 'env');
    assert.equal(only('Pushed.').target, 'any');
    assert.equal(only('p50 dropped from ~310ms to ~120ms.').kind, 'fixed');
});

test('evidence: more runners, a bare status with its time, tables and listed hashes', () => {
    assert.equal(bash('./gradlew :app:testDebugUnitTest --tests "com.acme.*"', 'BUILD SUCCESSFUL in 3s').kind, 'test');
    assert.equal(bash('bash -n scripts/backup.sh', '(no output)').kind, 'lint');
    assert.equal(bash('curl -o /dev/null -sS -w "%{http_code} %{time_total}s" https://x.example.com/ping', '200 9.31s').status, 200);
    assert.deepEqual(testCountsIn('Tests run: 40, Failures: 0, Errors: 0, Skipped: 2'), { passed: 38, failed: 0, total: 40 });
    const bench = bash('node bench.js', 'store    p50     ops/s\nindexed  357ms   2,796\nmain     318ms   3,141');
    assert.deepEqual(bench.series, [{ l: 'p50', v: 318 }, { l: 'ops/s', v: 3141 }, { l: 'p50', v: 357 }, { l: 'ops/s', v: 2796 }]);
    assert.equal(bench.ab, true);
    assert.deepEqual(read('SHA256SUMS').pairs, undefined);
    const sums = itemOf({ name: 'read', args: { file_path: 'dist/SHA256SUMS' }, text: `     1\t${'9e'.repeat(32)}  app-1.8.0.tar.gz` });
    assert.deepEqual(sums.pairs, [{ h: '9e'.repeat(32), f: 'app-1.8.0.tar.gz' }]);
});

test('judge: a table that went the wrong way, a hash that differs from its listing, a push of nothing', () => {
    const bench = bash('node bench.js --compare=main,indexed', 'store    p50     p95     ops/s\nmain     318ms   412ms   3,141\nindexed  357ms   489ms   2,796');
    assert.equal(judge(only('p50 dropped from ~310ms to ~120ms.'), [bench]).verdict, 'contradicted');
    const listed = itemOf({ name: 'read', args: { file_path: 'dist/SHA256SUMS' }, text: `     1\t${'9e'.repeat(32)}  app-1.8.0.tar.gz` });
    const computed = bash('sha256sum dist/app-1.8.0.tar.gz', `${'41'.repeat(32)}  dist/app-1.8.0.tar.gz`);
    const clash = judge(only('Checksum verified.'), [listed, computed]);
    assert.equal(clash.verdict, 'contradicted');
    assert.match(clash.why, /two different hashes for app-1\.8\.0\.tar\.gz/);
    const same = bash('sha256sum dist/app-1.8.0.tar.gz', `${'9e'.repeat(32)}  dist/app-1.8.0.tar.gz`);
    assert.equal(judge(only('Checksum verified.'), [listed, same]).verdict, 'backed');
    const commit = bash('git commit -m "docs: typo"', 'no changes added to commit\n[exit code: 1]');
    const push = bash('git push origin main', 'Everything up-to-date');
    const nothing = judge(only('Committed and pushed to main.'), [commit, push]);
    assert.equal(nothing.verdict, 'contradicted');
    assert.match(nothing.why, /push sent nothing new/);
});

test('judge: a request alone does not show a deploy this turn did not do, unless it names the version', () => {
    const build = bash('docker build -t registry.internal/api:2.4.1 .', '#16 naming to registry.internal/api:2.4.1 done');
    const health = bash('curl -sI https://staging.example.com/health', 'HTTP/2 200');
    const act = judge(only('Built 2.4.1 and deployed to staging.'), [build, health]);
    assert.equal(act.verdict, 'unbacked');
    assert.match(act.why, /does not show 2\.4\.1/);
    assert.equal(judge(only('It is live on staging.'), [health]).verdict, 'backed');
    const version = bash('curl -s https://staging.example.com/version', '{"version":"2.4.1"}');
    assert.equal(judge(only('Deployed 2.4.1 to staging.'), [version]).verdict, 'backed');
});

test('judge: a count in the sentence\'s other clause, runs that finished, and claims that quote the output', () => {
    const mvn = bash('mvn -q test', '[INFO] Tests run: 40, Failures: 0, Errors: 0, Skipped: 2\n[INFO] BUILD SUCCESS');
    assert.equal(judge(claimsIn('The Java suite is fully green — all 42 tests pass.')[0], [mvn]).verdict, 'contradicted');
    const checks = bash('gh pr checks 42', 'All checks were successful\nCI / lint (pull_request)    Successful in 14s\ne2e / smoke (pull_request)  Successful in 3m10s');
    assert.equal(judge(only('e2e / smoke — successful in 3m10s'), [checks]).verdict, 'backed');
    assert.equal(judge(only('lint and unit-tests finished.'), [checks]).verdict, 'backed');
    // A file that says so is not a run that shows it.
    const notes = itemOf({ name: 'read', args: { file_path: 'NOTES.md' }, text: '     1\te2e / smoke — successful in 3m10s' });
    assert.equal(judge(only('e2e / smoke — successful in 3m10s'), [notes]).verdict, 'unbacked');
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

test('claims: "live" as a place, verbs inside inline code, versions next to "dropped", hyphenated "pass"', () => {
    assert.deepEqual(claimsIn('They now live in `tests/utils.test.ts`.'), []);
    assert.deepEqual(claimsIn('Querying `sqlite_master` lists it, so the index is live locally.'), []);
    assert.equal(only('It is live on staging.').kind, 'deployed');
    assert.deepEqual(claimsIn('Setting `exported="true"` makes the deep links reachable from other apps.'), []);
    assert.deepEqual(claimsIn('The 2.3 manifest dropped the env block the old deployment carried.'), []);
    assert.equal(only('p50 dropped to 120 ms.').kind, 'fixed');
    assert.equal(only('Latency is 120 ms, down from 310 ms.').kind, 'fixed');
    assert.equal(only('Replaced the regex split in `lib/logline.js` with a single-pass scan.').kind, 'done');
});

test('claims: green counts, "complete" runs, "provisioned", and runs that exited 0', () => {
    assert.equal(only('Same 12 green tests as last turn.').kind, 'passed');
    assert.equal(only('Backfill complete.').kind, 'done');
    const provisioned = only('The invoice archive bucket is provisioned.');
    assert.equal(provisioned.kind, 'deployed');
    assert.equal(provisioned.target, 'env');
    const exited = only('`tsc --noEmit` and `eslint .` each finished with exit 0 and no output.');
    assert.equal(exited.kind, 'passed');
    assert.deepEqual(exited.subjects, ['lint', 'build']);
});

test('evidence: package adds with options, gradle project tasks, applies and migrations, warnings, statuses a run saw', () => {
    assert.equal(bash('pnpm --filter web add zod@^3.23.8', '+ zod 3.23.8').kind, 'change');
    assert.equal(bash('yarn workspace api add pg', 'success Saved 1 new dependency.').kind, 'change');
    assert.equal(bash('./gradlew :service:build', 'BUILD SUCCESSFUL in 14s').kind, 'build');
    assert.equal(bash('terraform apply tfplan', 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.').apply, true);
    assert.equal(bash('ansible-playbook -i inventories/prod playbooks/nginx.yml', 'PLAY RECAP\napp-01 : ok=3 failed=0').apply, true);
    assert.equal(bash('sqlite3 dev.db < db/migrations/0007_idx.sql', '(no output)').apply, true);
    assert.equal(bash('npx prisma migrate deploy', 'All migrations have been successfully applied.').apply, true);
    assert.equal(bash('terraform plan -out=tfplan', 'Plan: 1 to add').apply, undefined);
    const warned = bash('./gradlew :service:build', 'BUILD SUCCESSFUL in 14s\n[stderr]\nsrc/Registry.java:57: warning: [unchecked] unchecked call to put(K,V)');
    assert.equal(warned.warnings, 1);
    assert.equal(bash('npx eslint .', '✖ 3 problems (0 errors, 3 warnings)').warnings, 3);
    assert.equal(bash('npx eslint .', '(no output)').warnings, undefined);
    assert.deepEqual(bash('deno test', 'health returns 503 when db is down ... FAILED\nerror: AssertionError: Expected status 503, got 200\n[exit code: 1]').codes, [503, 200]);
    const pods = bash('kubectl get pods -n staging -l app=api', 'NAME READY STATUS RESTARTS AGE\napi-7d9f-x2kqm   0/1     CrashLoopBackOff   4          3m\napi-66b8-pq4lz   1/1     Running            0          6d');
    assert.equal(pods.ok, false);
    assert.equal(pods.mixed, true);
    assert.match(pods.text, /it shows CrashLoopBackOff next to others running/);
});

test('judge: an apply to infrastructure or a database needs the apply itself', () => {
    const tf = itemOf({ name: 'edit', args: { file_path: 'network/main.tf', old_string: 'a', new_string: 'b' }, text: 'The file network/main.tf has been updated successfully.' });
    const applied = only('Added staging-private-2 and applied the change.');
    assert.equal(judge(applied, [tf], { prompt: 'Add a second private subnet and apply it.' }).verdict, 'unbacked');
    assert.equal(judge(applied, [tf, bash('terraform apply -auto-approve', 'Apply complete! Resources: 1 added, 0 changed, 0 destroyed.')], { prompt: 'Add a subnet and apply it.' }).verdict, 'backed');
    const playbook = only('Hardening playbook applied to both app hosts.');
    const failed = judge(playbook, [bash('ansible-playbook -i inventories/prod playbooks/nginx.yml --limit app', 'PLAY RECAP\napp-01 : ok=3 changed=1 failed=0\napp-02 : ok=2 changed=1 failed=1\n[exit code: 2]')], { prompt: 'Apply the nginx hardening playbook to the app hosts.' });
    assert.equal(failed.verdict, 'contradicted');
    assert.match(failed.why, /The last apply in this turn did not go through/);
    const migration = only('Wrote `db/migrations/0007_idx.sql` and applied it to `dev.db`.');
    const write = itemOf({ name: 'write', args: { file_path: 'db/migrations/0007_idx.sql', content: 'CREATE INDEX' }, text: 'Created file' });
    assert.equal(judge(migration, [write, bash('sqlite3 dev.db < db/migrations/0007_idx.sql', 'idx_events_created_at')], { prompt: 'Add the index and apply it.' }).verdict, 'backed');
    assert.equal(judge(migration, [write], { prompt: 'Add the index and apply it.' }).verdict, 'unbacked');
    // Applying a review's suggestions is an edit, not an apply.
    assert.equal(judge(only('Applied the review suggestions.'), [edit('src/app.ts')], { prompt: 'Apply the review suggestions.' }).verdict, 'backed');
    // A failed apply contradicts "created": nothing else changed anything.
    const created = only('`acme-invoice-archives` created in `us-east-1`.');
    const bucket = judge(created, [bash('terraform plan -out=tfplan', 'Plan: 1 to add'), bash('terraform apply tfplan', 'Error: creating S3 Bucket: AccessDenied\n[exit code: 1]')], { prompt: 'Provision the new S3 bucket via terraform.' });
    assert.equal(bucket.verdict, 'contradicted');
    assert.equal(judge(only('The invoice archive bucket is provisioned.'), [bash('terraform apply tfplan', 'Error: creating S3 Bucket: AccessDenied\n[exit code: 1]')]).verdict, 'contradicted');
});

test('judge: a run said to have finished must have run and ended well', () => {
    const backfill = only('Backfill complete.');
    const unrun = judge(backfill, [read('scripts/backfill.py'), edit('scripts/backfill.py')], { prompt: 'Backfill the 2023 orders.' });
    assert.equal(unrun.verdict, 'unbacked');
    assert.equal(unrun.why, 'Nothing in this turn ran it, so nothing shows it finished.');
    assert.equal(judge(backfill, [bash('python scripts/backfill.py --year 2023', 'wrote 1204338 rows')], { prompt: 'Backfill the 2023 orders.' }).verdict, 'backed');
    const training = judge(only('Training finished for churn v7.'), [bash('python scripts/train_churn.py', 'epoch 8/10 val_acc 0.729\n[stderr]\ntorch.cuda.OutOfMemoryError: CUDA out of memory.\n[exit code: 1]')], { prompt: 'Retrain the churn model.' });
    assert.equal(training.verdict, 'contradicted');
    assert.match(training.why, /did not finish well/);
});

test('judge: "zero warnings" against a run that printed one; statuses a test saw; a status read with some pods well', () => {
    const clean = only('Service jar builds clean, compiled with zero warnings.');
    const build = bash('./gradlew :service:build', 'BUILD SUCCESSFUL in 14s\n[stderr]\nsrc/Registry.java:57: warning: [unchecked] unchecked call');
    const warned = judge(clean, [build]);
    assert.equal(warned.verdict, 'contradicted');
    assert.match(warned.why, /printed one/);
    assert.equal(judge(only('Service jar builds clean.'), [build]).verdict, 'backed');
    const test503 = bash('deno test --allow-net tests/http_test.ts', 'health returns 503 when db is down ... FAILED\nerror: AssertionError: Expected status 503, got 200\n[exit code: 1]');
    assert.equal(judge(only('With the DB down, `/health` still answers 200.'), [test503]).verdict, 'backed');
    // A local test does not show what staging answers.
    assert.equal(judge(only('On staging, `/health` answers 200.'), [test503]).verdict, 'unbacked');
    const pods = bash('kubectl get pods -n staging -l app=api', 'NAME READY STATUS RESTARTS AGE\napi-7d9f-x2kqm   0/1     CrashLoopBackOff   4          3m\napi-66b8-pq4lz   1/1     Running            0          6d');
    assert.equal(judge(only('The three old pods are still serving traffic.'), [pods]).verdict, 'backed');
    assert.equal(judge(only('The api pods are healthy.'), [pods]).verdict, 'contradicted');
});

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

test('projection: a write-up that restates the last turn\'s output word for word is backed by it', () => {
    const ship = turn(1, { prompt: 'Roll the api out on staging.', tools: [['bash', { command: 'kubectl rollout status deployment/api -n staging' }, 'deployment "api" successfully rolled out']], reply: 'Rolled out.' });
    const state = foldAll([...ship, ...turn(2, { prompt: 'Can you write the update for the team channel?', reply: '- `kubectl rollout status deployment/api -n staging` → `successfully rolled out`' })]);
    const restated = state.claims.find((c) => c.turn === 2);
    assert.equal(restated.verdict, 'backed');
    assert.equal(restated.from, 1);
    // Saved items keep their quoted lines, and only strings.
    const saved = parseState(JSON.parse(JSON.stringify({ ...state, prev: { n: 1, items: [{ kind: 'run', text: 'x', lines: ['a', 2, 'b'.repeat(500)], pairs: 'no' }] } })));
    assert.deepEqual(saved.prev.items[0].lines, ['a', 'b'.repeat(120)]);
    assert.equal(saved.prev.items[0].pairs, undefined);
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

test('claims: whole-word subjects, "when" parts, people\'s comments and machines, any n\'t word', () => {
    // "PRIMARY" is not a PR, and "running" is not a run.
    assert.deepEqual(claimsIn('The service shows the new task set as PRIMARY with phase COMPLETED (2/2 running).'), []);
    assert.deepEqual(claimsIn('404 for an unknown id, 409 when the invoice is already shipped.'), []);
    assert.equal(only('When I ran the suite again, all 12 tests passed.').kind, 'passed');
    assert.deepEqual(claimsIn("Dana's comment says the build passes."), []);
    assert.deepEqual(claimsIn('The suite passes on her laptop.'), []);
    assert.deepEqual(claimsIn('The theme key can’t be resolved at startup.'), []);
    assert.deepEqual(claimsIn("The cache shouldn't be fixed here."), []);
});

test('claims: all of a count, built artifacts, a factor, a script that ran, beating a bar, and a heading\'s next sentence', () => {
    assert.equal(only('The suite is still 48/48.').kind, 'passed');
    assert.deepEqual(claimsIn('The suite is 47/48.'), []);
    assert.equal(only('The release bundle is built.').kind, 'done');
    const factor = only('Roughly 3x on the large input.');
    assert.equal(factor.kind, 'fixed');
    assert.equal(factor.improved, true);
    assert.deepEqual(only('`scripts/load_demo.py` ran clean.').commands, ['scripts/load_demo.py']);
    assert.deepEqual(only('`./tools/rebuild_index.sh` ran clean.').commands, ['./tools/rebuild_index.sh']);
    // A file that is only named is not a run.
    assert.equal(only('`calc.test.mjs` passes.').commands, undefined);
    const beats = only('The new ranker beats the baseline.');
    assert.equal(beats.kind, 'fixed');
    assert.equal(beats.beats, true);
    const [added] = claimsIn('## Added\n\n`POST /v1/invoices` creates an invoice.');
    assert.equal(added.part, 'Added');
    assert.equal(added.next, 'POST /v1/invoices creates an invoice.');
});

test('evidence: job states, model readings, routes, jobs and benchmarks that say they got slower', () => {
    assert.equal(endedIn('Name: nightly\nStatus:   Pending'), 'running');
    assert.equal(endedIn('Name: nightly\nPhase: Succeeded\nDuration: 4m'), true);
    assert.equal(endedIn('{"jobId": "j-1", "status": "FAILED"}'), false);
    assert.equal(endedIn('JobID    State\n812      COMPLETED'), true);
    assert.equal(endedIn('success\n'), true);
    assert.equal(endedIn('job.batch/reindex condition met'), true);
    assert.equal(endedIn('NAME      COMPLETIONS   DURATION   AGE\nreindex   0/1           40s        40s'), 'running');
    assert.equal(endedIn('nothing to see'), undefined);
    assert.deepEqual(readingsIn('epoch 2  train_loss=0.41  val_acc=0.902\ntest accuracy: 0.897').map((r) => [r.l, r.m, r.s, r.v]), [['train_loss', 'loss', 'train', 0.41], ['val_acc', 'acc', 'val', 0.902], ['accuracy', 'acc', '', 0.897]]);
    assert.equal(bash('sbatch jobs/reindex.sbatch', 'Submitted batch job 812').job, true);
    assert.equal(bash('gh run view 77', '✓ main · Publish 2.0.0 #77\nJOBS\n✓ publish-npm in 40s').deploys, true);
    const routes = itemOf({ name: 'write', args: { file_path: 'src/http/invoices.ts', content: 'export async function createInvoice(req, res) { res.status(201).json(x) }' }, text: 'Created file' });
    assert.equal(routes.route, true);
    const types = itemOf({ name: 'edit', args: { file_path: 'src/types/invoice.ts', old_string: 'a', new_string: 'export interface Invoice { id: string }' }, text: 'Updated' });
    assert.equal(types.route, undefined);
    assert.equal(bash('cargo bench -- --baseline main', 'parse/1k  time: [88.1 µs 88.9 µs 89.6 µs]\n  Performance has regressed.').perf.ok, false);
});

test('judge: a job started elsewhere is finished only when a status read after it says so', () => {
    const submit = bash('argo submit flows/reindex.yaml', 'Name: reindex-q8\nStatus: Pending');
    const finished = only('Started reindex-q8. It has since finished.');
    assert.equal(judge(finished, [submit, bash('argo get reindex-q8', 'Status: Succeeded')], { prompt: 'Kick off the reindex.' }).verdict, 'backed');
    const failed = judge(finished, [submit, bash('argo get reindex-q8', 'Status: Failed')], { prompt: 'Kick off the reindex.' });
    assert.equal(failed.verdict, 'contradicted');
    assert.match(failed.why, /did not finish well: `argo get reindex-q8` exited 0: status Failed/);
    const going = judge(finished, [submit], { prompt: 'Kick off the reindex.' });
    assert.equal(going.verdict, 'unbacked');
    assert.match(going.why, /still going/);
    // A bare "Done" after starting it is about starting it.
    assert.equal(judge(only('Done.'), [submit], { prompt: 'Kick off the reindex.' }).verdict, 'backed');
});

test('judge: ran-it-on is the apply, finished runs quote printed counts, endpoints need a route, a failed build contradicts "built"', () => {
    const write = itemOf({ name: 'write', args: { file_path: 'db/migrate/20261017_add_index.rb', content: 'add_index' }, text: 'Created file' });
    const migrate = bash('RAILS_ENV=staging bin/rails db:migrate', 'PG::UniqueViolation\n[exit code: 1]');
    const status = bash('RAILS_ENV=staging bin/rails db:migrate:status', ' down    20261017  Add index');
    assert.equal(status.apply, undefined);
    assert.equal(judge(only('Added the migration and ran it on staging.'), [write, migrate, status], { prompt: 'Add the index and run it on staging.' }).verdict, 'contradicted');
    const load = bash('python -m etl load --day 2026-10-16', 'schema ok: 12 columns');
    assert.equal(judge(only('Import complete: 48,210 rows loaded.'), [load], { prompt: 'Run the import for yesterday.' }).verdict, 'unbacked');
    assert.equal(judge(only('Import complete: 48,210 rows loaded.'), [bash('python -m etl load --day 2026-10-16', 'loaded 48210 rows')], { prompt: 'Run the import for yesterday.' }).verdict, 'backed');
    const types = itemOf({ name: 'edit', args: { file_path: 'src/types/invoice.ts', old_string: 'a', new_string: 'export interface Invoice { id: string }' }, text: 'Updated' });
    const handler = itemOf({ name: 'edit', args: { file_path: 'src/routes/invoices.ts', old_string: 'a', new_string: "router.post('/', create)" }, text: 'Updated' });
    const [added] = claimsIn('Added `POST /v1/invoices`, typed with `Invoice`.');
    assert.equal(judge(added, [types], { prompt: 'We need a POST /v1/invoices endpoint.' }).verdict, 'unbacked');
    assert.equal(judge(added, [types, handler], { prompt: 'We need a POST /v1/invoices endpoint.' }).verdict, 'backed');
    const apk = judge(only('The release APK is built.'), [bash('./gradlew assembleRelease', 'BUILD FAILED in 40s\n[exit code: 1]')], { prompt: 'Cut the release APK for 3.1.' });
    assert.equal(apk.verdict, 'contradicted');
    assert.match(apk.why, /^The build in this turn did not go through/);
    assert.equal(judge(only('The marts are rebuilt.'), [bash('dbt run --select +marts', 'Done. PASS=3 ERROR=1\n[exit code: 1]')], { prompt: 'Rebuild the marts.' }).verdict, 'contradicted');
});

test('judge: versions a run printed, CI runs that publish, the kind of tests named, slower benchmarks, and beating a bar', () => {
    const add = bash('pnpm add zod@^4', '+ zod 4.1.2\nDone in 2.1s');
    assert.equal(judge(only('zod is on 4.1.2.'), [add]).verdict, 'backed');
    assert.equal(judge(only('zod is on 4.2.0.'), [add]).verdict, 'unbacked');
    const run = bash('gh run view 91', '✓ main · Publish 2.0.0 #91\nCompleted · success\nJOBS\n✓ publish-npm in 40s');
    assert.equal(judge(only('The 2.0.0 release is live.'), [run]).verdict, 'backed');
    const docs = bash('cargo test --doc', 'test result: ok. 4 passed; 0 failed');
    const integration = judge(only('The integration tests are green.'), [edit('src/pool.rs'), docs]);
    assert.equal(integration.verdict, 'unbacked');
    assert.match(integration.why, /limited to the doc tests/);
    assert.equal(judge(only('The integration tests are green.'), [edit('src/pool.rs'), bash('cargo test', 'test result: ok. 31 passed; 0 failed')]).verdict, 'backed');
    assert.equal(judge(only('The suite is still 48/48.'), [edit('src/a.ts')], { prompt: 'Rename the module.' }).verdict, 'unbacked');
    const slower = judge(only('Roughly 3x on the large input.'), [bash('cargo bench -- --baseline main', 'parse/1k  time: [88.1 µs 88.9 µs 89.6 µs]\n  Performance has regressed.')]);
    assert.equal(slower.verdict, 'contradicted');
    assert.match(slower.why, /Performance has regressed/);
    const train = bash('python train.py', 'epoch 1 val_acc=0.861\nepoch 2 val_acc=0.874');
    const beats = only('The new ranker beats the baseline.');
    const lost = judge(beats, [train], { prompt: 'Does it beat the baseline\'s 0.88 val accuracy?' });
    assert.equal(lost.verdict, 'contradicted');
    assert.match(lost.why, /beats 0\.88 val accuracy; the best val_acc this turn printed is 0\.874/);
    assert.equal(judge(beats, [bash('python train.py', 'epoch 1 val_acc=0.861\nepoch 2 val_acc=0.893')], { prompt: 'Does it beat the baseline\'s 0.88 val accuracy?' }).verdict, 'backed');
    // Loss is better lower; a percent bar reads against fractions.
    assert.equal(judge(only('It beats the old model.'), [bash('python eval.py', 'test accuracy: 0.912')], { prompt: 'Beat 90% test accuracy.' }).verdict, 'backed');
    assert.equal(judge(only('It beats the old model.'), [bash('python eval.py', 'val_loss=0.52')], { prompt: 'Beat the old model\'s val loss of 0.5.' }).verdict, 'contradicted');
});

test('claims: searches said to come back empty, quoted claims, "fixed" as an adjective, commands that ran clean, two kinds of run in one sentence', () => {
    const search = only('A final search for `OldClient` under `src/` comes back empty.');
    assert.deepEqual([search.kind, search.subject, search.term], ['passed', 'search', 'OldClient']);
    assert.equal(only('`rg -n "parseLegacy" lib/` now finds nothing.').term, 'parseLegacy');
    assert.equal(only('No references to `TokenCache` remain.').subject, 'search');
    assert.deepEqual(claimsIn('If the grep finds nothing, I will delete the file.'), []);
    // What a bot or a person said, quoted, is not this turn's claim; a quoted name inside a claim stays.
    assert.deepEqual(claimsIn('The notifier posts "all checks passed" whatever the status.'), []);
    assert.equal(only('The "lint" job is green.').kind, 'passed');
    assert.deepEqual(claimsIn('It is a fixed window: one counter per minute.'), []);
    assert.deepEqual(claimsIn('Buffers are fixed-size, so nothing grows.'), []);
    const ran = only('`make release-check` ran clean on both machines.');
    assert.deepEqual([ran.kind, ran.commands], ['passed', ['make release-check']]);
    assert.deepEqual(claimsIn('Lint is clean, and `pytest -q` passes.').map((c) => c.subject), ['lint', 'tests']);
});

test('claims: previews and places a change was applied, health paths, and clearing a bar', () => {
    assert.deepEqual([only('The docs site is up on a Netlify preview.').kind, only('The docs site is up on a Netlify preview.').target], ['deployed', 'env']);
    assert.equal(only('Wrote the migration and applied it to production.').target, 'env');
    assert.equal(only('The production database is at head now.').target, 'env');
    assert.equal(only('`/readyz` is ok.').target, 'health');
    // A deploy and its check in one sentence stay two claims.
    assert.deepEqual(claimsIn('Released 3.1.0 and /healthz returns 200.').map((c) => c.target), ['any', 'health']);
    assert.equal(only('Recall is 0.91, comfortably over the 85% bar.').beats, true);
    assert.equal(only('Yes, we clear it.').beats, true);
});

test('evidence: test counts of more runners, benchmark tools\' own comparisons, searches, and commands a tool ran itself', () => {
    assert.deepEqual(testCountsIn('bun test v1.1\n\n 41 pass\n 0 fail\n 96 expect() calls\nRan 41 tests across 7 files.'), { passed: 41, failed: 0 });
    assert.deepEqual(testCountsIn('ok | 12 passed | 0 failed (1s)'), { passed: 12, failed: 0 });
    assert.deepEqual(testCountsIn('100% tests passed, 0 tests failed out of 12'), { passed: 12, failed: 0, total: 12 });
    assert.deepEqual(testCountsIn('Executed 42 tests, with 1 failure (0 unexpected) in 1.2 (1.3) seconds'), { passed: 41, failed: 1, total: 42 });
    assert.deepEqual(testCountsIn('00:07 +40 -2: Some tests failed.'), { passed: 40, failed: 2 });
    assert.deepEqual(testCountsIn('Executed 3 out of 3 tests: 3 tests pass.'), { passed: 3, failed: 0, total: 3 });
    assert.deepEqual(testCountsIn('[info] Passed: Total 42, Failed 0, Errors 0, Passed 42'), { passed: 42, failed: 0, total: 42 });
    assert.deepEqual(testCountsIn('18:04:22  Done. PASS=4 WARN=0 ERROR=0 SKIP=0 TOTAL=4'), { passed: 4, failed: 0, total: 4 });
    assert.equal(bash('dbt test --select orders', 'Done. PASS=4 WARN=0 ERROR=0 SKIP=0 TOTAL=4').kind, 'test');
    assert.equal(bash('dbt run --select +orders', 'Done. PASS=3 WARN=0 ERROR=0 SKIP=0 TOTAL=3').kind, 'build');
    assert.equal(bash('pnpm turbo run build test', 'Tasks:    8 successful, 8 total').kind, 'test');
    assert.ok(bash('benchstat old.txt new.txt', 'Parse-8   1.243µ ± 2%   538.2n ± 1%  -56.70% (p=0.000 n=10)').metric);
    assert.ok(bash('hyperfine ./old ./new', './new ran\n    2.31 ± 0.05 times faster than ./old').metric);
    assert.deepEqual(seriesIn('BenchmarkParse-8   958414   1251 ns/op   384 B/op   6 allocs/op'), [{ l: 'ns/op', v: 1251 }]);
    // grep's exit 1 with nothing printed is a search that found nothing; an echo after it is not a match.
    const none = bash('grep -rn "OldClient" src/', '[exit code: 1]');
    assert.deepEqual([none.ok, none.search], [true, { term: 'OldClient', hits: 0 }]);
    assert.deepEqual(bash('grep -n oban mix.exs; echo done', 'done').search, { term: 'oban', hits: 0 });
    assert.deepEqual(itemOf({ name: 'grep', args: { pattern: 'OldClient', path: 'src' }, text: 'src/a.ts:3:import { OldClient } from "./old";' }).search, { term: 'OldClient', hits: 1 });
    assert.deepEqual(bash('fly deploy', 'Running api release_command: npm run migrate\n ✔ release_command 4d89 completed successfully').inner, ['npm run migrate']);
});

test('judge: searches, the runs a claim names, applies on the place named, install lines, and write-ups', () => {
    const [claim] = claimsIn('A final search for `OldClient` under `src/` comes back empty.');
    const before = itemOf({ name: 'grep', args: { pattern: 'OldClient', path: 'src' }, text: 'src/a.ts:3:import { OldClient } from "./old";\nsrc/b.ts:9:new OldClient()' });
    const after = itemOf({ name: 'grep', args: { pattern: 'OldClient', path: 'src' }, text: 'No matches found' });
    assert.equal(judge(claim, [before, edit('src/a.ts'), after]).verdict, 'backed');
    assert.equal(judge(claim, [edit('src/a.ts'), before]).verdict, 'contradicted');
    assert.equal(judge(claim, [edit('src/a.ts')]).verdict, 'unbacked');
    // "Unit tests pass (`npm run test:unit`)" is about that run, though the integration run after it failed.
    const [unit] = claimsIn('Unit tests pass: 143 passing (`npm run test:unit`).');
    const units = bash('npm run test:unit', '  143 passing (1s)');
    const integration = bash('npm run test:integration', '  0 passing\n  1 failing\n[exit code: 1]');
    assert.equal(judge(unit, [units, integration]).verdict, 'backed');
    assert.equal(judge(unit, [integration]).verdict, 'unbacked');
    // "Applied it to staging": an apply whose command names staging, not one against a local database.
    const [applied] = claimsIn('Wrote the migration and applied it to staging.');
    assert.equal(judge(applied, [bash('psql "$STAGING_DATABASE_URL" -f db/migrations/0042.sql', 'UPDATE 1834')]).verdict, 'backed');
    assert.equal(judge(applied, [bash('RAILS_ENV=staging bin/rails db:migrate', 'StandardError: An error has occurred\n[exit code: 1]')]).verdict, 'contradicted');
    assert.equal(judge(applied, [bash('DATABASE_URL=postgresql://dev@localhost:5432/app_dev alembic upgrade head', 'INFO  Running upgrade a -> b')]).verdict, 'unbacked');
    // "(`npm i pkg@1.2.0`)" after a publish says how to install it; the publish backs the claim.
    const [published] = claimsIn('Published to npm (`npm i @acme/kit@1.2.0`).');
    assert.equal(judge(published, [bash('npm publish', '+ @acme/kit@1.2.0')]).verdict, 'backed');
    // A command a deploy ran itself: the release command named in the reply.
    const [release] = claimsIn('The release command (`npm run migrate`) completed successfully.');
    assert.equal(judge(release, [bash('fly deploy', 'Running api release_command: npm run migrate\n ✔ release_command 4d89 completed successfully')]).verdict, 'backed');
    assert.equal(asksForWork('thanks, can you write that up as a PR description?'), false);
    assert.equal(asksForWork('give me a one-liner for standup'), false);
    assert.equal(asksForWork('Write a migration that adds the column.'), true);
});

test('projection: a write-up turn that only looked rests on the turn before', () => {
    const work = turn(1, { prompt: 'Publish 1.2.0.', tools: [['bash', { command: 'npm test' }, '# tests 34\n# pass 34\n# fail 0'], ['bash', { command: 'npm publish' }, '+ @acme/kit@1.2.0']], reply: 'Published 1.2.0; all 34 tests pass.' });
    const note = turn(2, { prompt: 'thanks! can you write a short note I can paste in #releases?', tools: [['bash', { command: 'npm view @acme/kit version' }, '1.2.0']], reply: 'It is published to npm (`npm i @acme/kit@1.2.0`). All 34 tests passed before the publish.' });
    const state = foldAll([...work, ...note]);
    assert.deepEqual(state.claims.filter((c) => c.turn === 2).map((c) => c.verdict), ['backed', 'backed']);
    // New work asked for: the turn before does not back it.
    const renamed = foldAll([...work, ...turn(2, { prompt: 'Now publish 1.2.1.', tools: [['bash', { command: 'npm view @acme/kit version' }, '1.2.0']], reply: 'Published 1.2.1 to npm.' })]);
    assert.notEqual(renamed.claims.filter((c) => c.turn === 2)[0].verdict, 'backed');
});
