#!/usr/bin/env node
/**
 * Real-host end-to-end test for the projects plugin.
 *
 * Boots a real DSH (the shipped web profile, in a temporary DSH_HOME) with
 * this repo's projects and session-bridge plugins and a scripted model
 * server, then drives the coordinator and its threads through the bridge
 * socket and checks what reached the model: models and efforts on the wire,
 * tool scoping, handbacks, the automatic notes (idle, failed, stopped,
 * waiting on approval, cut off by a DSH crash), queued turns, direct talk,
 * settings, memory, pause and a restart.
 *
 *   DSH_BIN=/path/to/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/projects/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs `dsh` from PATH. KEEP=1 keeps the temp folder.
 * A DSH to test against: npm install --prefix /tmp/dsh @deepseek-ai/dsh
 * (then DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js).
 */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeModel } from './fake-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = resolve(here, '../../..');
const PROJECT = 'E2E Project';
const PROJECT_ID = 'e2e-project';

// ── harness ─────────────────────────────────────────────────────────────────

function findDsh() {
    const bin = process.env.DSH_BIN;
    if (bin) return bin.endsWith('.js') ? [process.execPath, bin] : [bin];
    try {
        const found = execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim();
        if (found) return [found];
    } catch {}
    return null;
}

let passed = 0;
let failed = 0;
function check(name, ok, detail = '') {
    if (ok) {
        passed += 1;
        console.log(`ok - ${name}`);
    } else {
        failed += 1;
        console.log(`not ok - ${name}${detail ? `\n    ${detail}` : ''}`);
    }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, timeout = 30000) {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
        try {
            const value = await fn();
            if (value) return value;
        } catch (error) {
            last = error;
        }
        await sleep(100);
    }
    throw new Error(`timed out waiting for ${what}${last ? ` (last error: ${last.message})` : ''}`);
}

const root = mkdtempSync(join(tmpdir(), 'dsh-projects-e2e-'));
const home = join(root, 'home');
const ws = join(root, 'ws');
const stateDir = join(root, 'state');
const storeFile = join(stateDir, 'projects.json');
const logFile = join(stateDir, 'projects.log');
const memoryDir = join(stateDir, 'memory');
const sock = join(root, 'bridge.sock');
const dshLog = join(root, 'dsh.log');

function bridge(method, path, body) {
    return new Promise((resolvePromise, reject) => {
        const data = body === undefined ? undefined : JSON.stringify(body);
        const req = request({
            socketPath: sock, path, method,
            headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
        }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                if (res.statusCode >= 400) reject(new Error(`${method} ${path}: ${res.statusCode} ${text.slice(0, 300)}`));
                else resolvePromise(text ? JSON.parse(text) : null);
            });
        });
        req.on('error', reject);
        if (data) req.write(data);
        req.end();
    });
}

const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const store = () => { try { return JSON.parse(readFileSync(storeFile, 'utf8')); } catch { return {}; } };
const project = () => store().projects?.[PROJECT_ID] ?? {};
const threadSession = (id) => project().threads?.[id]?.sessionId;
const modeOf = (file) => statSync(file).mode & 0o777;
const octal = (mode) => mode.toString(8);

/** The model sees "E2E:call <tool> <json>" and calls that tool. */
const call = (tool, args) => `E2E:call ${tool} ${JSON.stringify(args)}`;

function writeProfile(modelPort) {
    const profile = join(home, 'profiles', 'web');
    mkdirSync(join(profile, 'node_modules'), { recursive: true });
    const plugins = { 'dsh-plugin-projects': join(pluginsDir, 'projects'), 'dsh-plugin-session-bridge': join(pluginsDir, 'session-bridge') };
    writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
        name: 'dsh-profile-web',
        private: true,
        dependencies: Object.fromEntries(Object.entries(plugins).map(([name, dir]) => [name, `link:${dir}`])),
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...Object.keys(plugins)] } },
    }, null, 2)}\n`);
    for (const [name, dir] of Object.entries(plugins)) symlinkSync(dir, join(profile, 'node_modules', name), 'dir');
    const q = JSON.stringify;
    // The DSH default effort is "low", so a missed project selection shows on the wire.
    writeFileSync(join(profile, 'cordis.patch.yml'), `- id: agent-default-model
  config:
    provider: fake
    model: fake-model
    reasoningEffort: low
- id: llm-pi-ai
  config:
    providers:
      fake:
        displayName: Fake
        api: openai-completions
        baseURL: ${q(`http://127.0.0.1:${modelPort}/v1`)}
        apiKeyEnv: FAKE_LLM_KEY
        models:
          - id: fake-model
            name: Fake Model
            contextWindow: 131072
            reasoningEfforts:
              off:
              low: low
              high: high
              max: max
          - id: fake-flash
            name: Fake Flash
            contextWindow: 131072
            reasoningEfforts: false
- id: projects
  config:
    coordinatorEffort: max
    threadEffort: high
    approvalNoticeSeconds: 1
    storeFile: ${q(storeFile)}
    memoryDir: ${q(memoryDir)}
    logFile: ${q(logFile)}
    projects:
      - name: ${q(PROJECT)}
        goal: Prove the plugin on a real host
        workspacePath: ${q(ws)}
- id: session-bridge
  config:
    socketPath: ${q(sock)}
    logFile: ${q(join(root, 'bridge.log'))}
`);
}

function startDsh(dsh) {
    const out = openSync(dshLog, 'a');
    const local = '127.0.0.1,localhost';
    const child = spawn(dsh[0], [...dsh.slice(1), '--profile', 'web', '--no-open', '--port', '0'], {
        cwd: ws,
        env: { ...process.env, DSH_HOME: home, FAKE_LLM_KEY: 'sk-fake', DSH_TELEMETRY_DISABLED: '1', NO_PROXY: local, no_proxy: local },
        stdio: ['ignore', out, out],
    });
    closeSync(out);
    return child;
}

async function stopDsh(child) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    await exited;
    clearTimeout(timer);
}

// ── scenario ────────────────────────────────────────────────────────────────

const dsh = findDsh();
if (!dsh) {
    console.log('skipped: set DSH_BIN to a DSH bin.js (or put dsh on PATH) to run the real-host test');
    process.exit(0);
}

mkdirSync(ws, { recursive: true });
mkdirSync(join(root, 'outside'));
const model = await startFakeModel();
writeProfile(model.port);

const whoOf = (r) => /You are thread (t\d+)/.exec(r.system)?.[1]
    ?? (r.system.includes('You are the coordinator of the DSH project') ? 'coordinator' : 'other');
const since = (mark, who) => model.requests.slice(mark).filter((r) => !who || whoOf(r) === who);
const resultOf = (reqs) => reqs.find((r) => r.action.text?.startsWith('TOOL-RESULT:'))?.action.text ?? '';
const describe = (reqs) => reqs.map((r) => `${r.n} ${whoOf(r)} ${r.model} effort=${r.effort ?? '-'}`).join('; ');

async function waitIdle(sessionId) {
    await waitFor(async () => {
        const s = await bridge('GET', `/sessions/${sessionId}`);
        return s.status === 'idle' && s.turns.started === s.turns.ended;
    }, `session ${sessionId} to be idle`);
}

/** Prompt a session as the user and wait until its turn is over. */
async function say(sessionId, text) {
    const mark = model.requests.length;
    await bridge('POST', `/sessions/${sessionId}/prompt`, { text });
    await waitFor(() => since(mark).some((r) => r.fresh.includes(text)), `the model to see "${text.slice(0, 60)}"`);
    await waitIdle(sessionId);
    return since(mark);
}

/** Wait for the coordinator to answer an automatic message, then for it to be idle. */
async function coordinatorSaw(mark, reply, what) {
    const req = await waitFor(() => since(mark, 'coordinator').find((r) => r.action.text === reply), what);
    await waitIdle(project().coordinatorSessionId);
    return req;
}

let child;
let coord;
try {
    // 1. Boot: the coordinator appears on its project route, with private state.
    child = startDsh(dsh);
    await waitFor(async () => existsSync(sock) && (await bridge('GET', '/health')).ok, 'the session bridge', 90000);
    coord = await waitFor(() => project().coordinatorSessionId, 'the coordinator session');
    await waitFor(() => readText(logFile).includes(`select ${PROJECT_ID}/coordinator`), 'the coordinator selection');
    check('coordinator session is titled "◆ E2E Project"', (await bridge('GET', `/sessions/${coord}`)).title === `◆ ${PROJECT}`);
    check('coordinator selection is logged', readText(logFile).includes(`select ${PROJECT_ID}/coordinator fake:fake-model effort=max`), readText(logFile));
    check('state folder is 700', modeOf(stateDir) === 0o700, octal(modeOf(stateDir)));
    check('store file is 600', modeOf(storeFile) === 0o600, octal(modeOf(storeFile)));
    check('log file is 600', modeOf(logFile) === 0o600, octal(modeOf(logFile)));

    // 2. Thread start and handback.
    let mark = model.requests.length;
    await say(coord, call('project_thread_start', {
        title: 'Alpha',
        brief: `Do the work, then report. ${call('project_handback', { status: 'done', summary: 'Alpha finished: nothing to change.' })}`,
    }));
    let saw = await coordinatorSaw(mark, 'SAW-HANDBACK', 'the Alpha handback');
    const firstCoord = since(mark, 'coordinator')[0];
    check('coordinator asks with effort max', firstCoord.effort === 'max', describe(since(mark, 'coordinator')));
    check('coordinator has coordinator tools only', firstCoord.tools.includes('project_thread_start') && !firstCoord.tools.includes('project_handback'));
    const t1Reqs = since(mark, 't1');
    check('thread asks with effort high', t1Reqs.length > 0 && t1Reqs.every((r) => r.model === 'fake-model' && r.effort === 'high'), describe(t1Reqs));
    check('thread has thread tools only', t1Reqs[0]?.tools.includes('project_handback') && !t1Reqs[0]?.tools.includes('project_thread_start'));
    check('thread gets the brief', t1Reqs[0]?.fresh.includes(`[Brief from the coordinator of "${PROJECT}" · you are thread t1, "Alpha"]`));
    check('handback reaches the coordinator', saw.fresh.includes('[Handback from thread t1 · "Alpha" · status: done]') && saw.fresh.includes('Alpha finished'), saw.fresh.slice(0, 300));
    const t1 = threadSession('t1');
    check('thread session is titled "E2E Project › Alpha"', (await bridge('GET', `/sessions/${t1}`)).title === `${PROJECT} › Alpha`);
    check('roster shows the handback', saw.system.includes('- t1 · "Alpha" · ') && saw.system.includes('last handback: done'));
    await sleep(1000);
    check('a turn that handed back sends no idle note', !readText(logFile).includes(`idle-note ${PROJECT_ID}/t1 `) && since(mark, 'coordinator').every((r) => r.action.text !== 'SAW-IDLE'), describe(since(mark)));

    // 3. A thread that stops without a handback: the idle note.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { title: 'Beta', brief: 'Just answer.' }));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Beta idle note');
    check('idle note reaches the coordinator', saw.fresh.includes('[Thread idle without a handback: t2 · "Beta"]') && saw.fresh.includes('Plain reply.'), saw.fresh.slice(0, 300));
    const t2 = threadSession('t2');

    // 4. The user talks to a thread directly: the coordinator is not woken.
    mark = model.requests.length;
    await say(t2, 'Hello from the user.');
    await sleep(1500);
    check('direct talk does not wake the coordinator', since(mark, 'coordinator').length === 0, describe(since(mark)));
    check('direct talk is logged', readText(logFile).includes(`direct-turn ${PROJECT_ID}/t2`));

    // 5. A failed turn: the note says so. The roster now notes the direct talk.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { title: 'Gamma', brief: 'E2E:fail' }));
    check('roster notes the direct talk', since(mark, 'coordinator')[0]?.system.includes('- t2 · "Beta" · idle · no handback yet · the user talked to it directly; its reply: "Plain reply."'),
        since(mark, 'coordinator')[0]?.system.split('\n').filter((l) => l.startsWith('- t')).join(' | '));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Gamma failure note');
    check('failure note says the turn failed', saw.fresh.includes('[Thread idle without a handback: t3 · "Gamma"]') && saw.fresh.includes('The turn failed:'), saw.fresh.slice(0, 300));

    // 6. A thread waiting on a permission prompt, then stopped.
    mark = model.requests.length;
    const probe = join(root, 'outside', 'approval-probe.txt');
    await say(coord, call('project_thread_start', {
        title: 'Delta',
        brief: call('write', { file_path: probe, content: 'x', sandbox_permissions: 'danger-full-access', justification: 'E2E approval check.' }),
    }));
    saw = await coordinatorSaw(mark, 'SAW-APPROVAL', 'the Delta approval note');
    check('approval note names the tool and the session', saw.fresh.includes('[Thread waiting for approval: t4 · "Delta"]')
        && saw.fresh.includes('It asked to use write: ') && saw.fresh.includes('E2E approval check.') && saw.fresh.includes(`in the "${PROJECT} › Delta" session`), saw.fresh.slice(0, 400));
    mark = model.requests.length;
    await bridge('POST', `/sessions/${threadSession('t4')}/cancel`, {});
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Delta stopped note');
    check('stopped note says the turn was stopped', saw.fresh.includes('t4 · "Delta"') && saw.fresh.includes('The turn was stopped before it finished.'), saw.fresh.slice(0, 300));
    check('nothing was written without approval', !existsSync(probe));

    // 7. Coordinator effort changes from the next request, mid-turn.
    mark = model.requests.length;
    let reqs = await say(coord, call('project_settings', { coordinator_effort: 'low' }));
    check('settings change applies from the next request', reqs[0]?.effort === 'max' && reqs.at(-1)?.effort === 'low', describe(reqs));

    // 8. A thread model without efforts, and a bad effort.
    reqs = await say(coord, call('project_settings', { thread_model: 'fake-flash' }));
    check('settings note the dropped effort', resultOf(reqs).includes('has no effort levels'), resultOf(reqs));
    mark = model.requests.length;
    reqs = await say(coord, call('project_thread_start', { title: 'Epsilon', brief: 'Just answer.' }));
    await coordinatorSaw(mark, 'SAW-IDLE', 'the Epsilon idle note');
    const t5Reqs = since(mark, 't5');
    check('flash thread asks without effort', t5Reqs.length > 0 && t5Reqs.every((r) => r.model === 'fake-flash' && r.effort === undefined), describe(t5Reqs));
    reqs = await say(coord, call('project_settings', { thread_effort: 'ultra' }));
    check('bad effort is refused', /ultra/.test(resultOf(reqs)) && project().settings?.threadEffort !== 'ultra', resultOf(reqs));

    // 9. One thread's effort, then a coordinator message to it.
    reqs = await say(coord, call('project_thread_update', { thread: 't1', effort: 'max' }));
    check('thread update reports the change', /effort/.test(resultOf(reqs)), resultOf(reqs));
    mark = model.requests.length;
    await say(coord, call('project_thread_send', { thread: 't1', text: 'One more check, please.' }));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the t1 idle note');
    const t1More = since(mark, 't1');
    check('thread override reaches the wire', t1More.length > 0 && t1More.every((r) => r.effort === 'max'), describe(t1More));
    check('thread gets the coordinator message', t1More[0]?.fresh.includes('[From the coordinator]\n\nOne more check, please.'));

    // 10. Memory reaches the coordinator's next request and new threads.
    reqs = await say(coord, call('project_memory', { action: 'append', text: '- E2E memory fact.' }));
    check('memory is written', resultOf(reqs).includes('appended') && readText(join(memoryDir, `${PROJECT_ID}.md`)).includes('E2E memory fact.'));
    check('memory is in the coordinator prompt', reqs.at(-1)?.system.includes('E2E memory fact.'));
    check('memory folder is 700', modeOf(memoryDir) === 0o700, octal(modeOf(memoryDir)));

    // 11. List and read.
    reqs = await say(coord, call('project_thread_list', { include_resolved: true }));
    check('list shows every thread', ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].every((t) => resultOf(reqs).includes(t)), resultOf(reqs));
    reqs = await say(coord, call('project_thread_read', { thread: 't2' }));
    check('read shows what the user said, not injected context', resultOf(reqs).includes('Hello from the user.') && !resultOf(reqs).includes('Current runtime context'), resultOf(reqs));

    // 12. Resolve.
    await say(coord, call('project_thread_update', { thread: 't2', resolved: true }));
    reqs = await say(coord, call('project_thread_list', {}));
    check('resolved threads leave the list', !resultOf(reqs).includes('Beta') && resultOf(reqs).includes('Alpha'), resultOf(reqs));

    // 13. Pause holds a handback; resume delivers it.
    reqs = await say(coord, call('project_settings', { paused: true }));
    check('pause is on', resultOf(reqs).includes('Paused: yes'), resultOf(reqs));
    mark = model.requests.length;
    reqs = await say(t1, call('project_handback', { status: 'done', summary: 'Held while paused.' }));
    await sleep(500);
    check('handback is held while paused', resultOf(reqs).includes('Handback saved') && since(mark, 'coordinator').length === 0, resultOf(reqs));
    mark = model.requests.length;
    reqs = await say(coord, call('project_settings', { paused: false }));
    check('resume delivers the held handback', resultOf(reqs).includes('delivered 1 held handback'), resultOf(reqs));
    saw = await coordinatorSaw(mark, 'SAW-HANDBACK', 'the held handback');
    check('held handback arrives', saw.fresh.includes('Held while paused.'));

    // 14. A stop the coordinator asks for is not echoed back to it.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', {
        title: 'Zeta',
        brief: call('write', { file_path: probe, content: 'x', sandbox_permissions: 'danger-full-access', justification: 'E2E stop check.' }),
    }));
    await coordinatorSaw(mark, 'SAW-APPROVAL', 'the Zeta approval note');
    mark = model.requests.length;
    reqs = await say(coord, call('project_thread_update', { thread: 't6', stop: true }));
    check('coordinator can stop a thread', resultOf(reqs).includes('current turn stopped'), resultOf(reqs));
    await waitIdle(threadSession('t6'));
    await sleep(1500);
    check('its own stop is not echoed back to it', !since(mark, 'coordinator').some((r) => r.fresh.includes('t6 · "Zeta"')), describe(since(mark, 'coordinator')));

    // 15. Queued turns: the coordinator queues a second message while the first
    // turn runs; DSH runs both before going idle. The first hands back, the
    // second fails, and the coordinator hears about both.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', {
        title: 'Eta',
        brief: `E2E:slow 4000\n${call('project_handback', { status: 'done', summary: 'Eta part one done.' })}`,
    }));
    const sent = await say(coord, call('project_thread_send', { thread: 't7', text: 'E2E:fail' }));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Eta failure note');
    const t7Reqs = since(mark, 't7');
    check('the second message was queued while the first turn ran', sent[0].at < (t7Reqs[1]?.at ?? 0), describe(since(mark)));
    check('the first turn handed back', since(mark, 'coordinator').some((r) => r.fresh.includes('Eta part one done.')));
    check('the queued turn that failed gets its note', saw.fresh.includes('[Thread idle without a handback: t7 · "Eta"]') && saw.fresh.includes('The turn failed:'), saw.fresh.slice(0, 300));

    // 16. DSH dies mid-turn. At the next start the coordinator hears the thread
    // was cut off. Then: same coordinator, routes kept, threads still wired.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { title: 'Theta', brief: 'E2E:slow 120000\nWork for a long time.' }));
    await waitFor(() => since(mark, 't8').length > 0, 'the Theta request');
    const exited = new Promise((r) => child.once('exit', r));
    child.kill('SIGKILL');
    await exited;
    mark = model.requests.length;
    child = startDsh(dsh);
    await waitFor(async () => existsSync(sock) && (await bridge('GET', '/health')).ok, 'the session bridge after restart', 90000);
    await waitFor(() => readText(logFile).includes(`coordinator ${PROJECT_ID} ${coord} resumed`), 'the plugin to resume the coordinator');
    check('restart keeps the coordinator', project().coordinatorSessionId === coord);
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Theta cut-off note');
    check('a turn cut off by the crash is reported', saw.fresh.includes('[Thread idle without a handback: t8 · "Theta"]')
        && saw.fresh.includes('The turn was cut off because DSH stopped while it ran.'), saw.fresh.slice(0, 300));
    mark = model.requests.length;
    await say(coord, call('project_thread_send', { thread: 't1', text: 'After the restart.' }));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the t1 idle note after restart');
    check('coordinator keeps its effort after restart', since(mark, 'coordinator').every((r) => r.effort === 'low'), describe(since(mark, 'coordinator')));
    const t1After = since(mark, 't1');
    check('thread keeps its effort and tools after restart', t1After.length > 0 && t1After.every((r) => r.effort === 'max' && r.tools.includes('project_handback')), describe(t1After));
    check('no errors in the projects log', !/ error /.test(readText(logFile)), readText(logFile).split('\n').filter((l) => / error /.test(l)).join('\n'));
} catch (error) {
    failed += 1;
    console.log(`not ok - ${error.message}`);
    console.log('--- requests');
    for (const r of model.requests.slice(-12)) console.log(`${r.n} ${whoOf(r)} ${r.model} effort=${r.effort ?? '-'} ${JSON.stringify(r.action).slice(0, 160)}`);
    console.log('--- projects.log (tail)');
    console.log(readText(logFile).split('\n').slice(-25).join('\n'));
    console.log('--- dsh.log (tail)');
    console.log(readText(dshLog).split('\n').slice(-40).join('\n'));
} finally {
    await stopDsh(child);
    await model.close();
    if (process.env.KEEP) console.log(`kept ${root}`);
    else rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
