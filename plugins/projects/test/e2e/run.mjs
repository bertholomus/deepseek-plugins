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
 * settings, memory, pause, a restart, the browser half DSH serves for the
 * plugin's page, a saved default that applies without a restart, the Project
 * settings endpoints the window calls, and a pick in DSH's own model picker.
 *
 *   DSH_BIN=/path/to/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/projects/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs `dsh` from PATH. KEEP=1 keeps the temp folder.
 * A DSH to test against: npm install --prefix /tmp/dsh @deepseek-ai/dsh
 * (then DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js).
 */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
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

/** GET from the DSH web server. */
function httpGet(url, headers = {}) {
    return new Promise((resolvePromise, reject) => {
        const req = request(url, { headers }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, text }));
        });
        req.on('error', reject);
        req.end();
    });
}

/** Sign in to DSH's web server as a browser does, from the newest sign-in link in its log. */
async function signInWeb() {
    const signIn = [...readText(dshLog).matchAll(/dsh web: (\S+)/g)].at(-1)?.[1] ?? '';
    const cookie = String((await httpGet(signIn)).headers['set-cookie']?.[0] ?? '').split(';')[0];
    return { base: new URL('./', signIn), cookie };
}

/** Call a Remote endpoint the way the window does: POST /api/<endpoint> with a client-request envelope. */
function webApi(web, endpoint, args) {
    return new Promise((resolvePromise, reject) => {
        const body = JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: endpoint, payload: { args } });
        const req = request(new URL(`api/${endpoint}`, web.base), {
            method: 'POST',
            headers: { cookie: web.cookie, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        }, (res) => {
            let text = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { text += c; });
            res.on('end', () => {
                let result;
                try { result = JSON.parse(text).result; } catch {}
                resolvePromise(result ?? { ok: false, error: { code: `http/${res.statusCode}`, message: text.slice(0, 300) } });
            });
        });
        req.on('error', reject);
        req.end(body);
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

const profile = join(home, 'profiles', 'web');

function writeProfile(modelPort) {
    mkdirSync(join(profile, 'node_modules'), { recursive: true });
    const plugins = { 'dsh-plugin-projects': join(pluginsDir, 'projects'), 'dsh-plugin-session-bridge': join(pluginsDir, 'session-bridge') };
    writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
        name: 'dsh-profile-web',
        private: true,
        dependencies: Object.fromEntries(Object.entries(plugins).map(([name, dir]) => [name, `link:${dir}`])),
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...Object.keys(plugins)] } },
    }, null, 2)}\n`);
    for (const [name, dir] of Object.entries(plugins)) symlinkSync(dir, join(profile, 'node_modules', name), 'dir');
    writePatch(modelPort, { coordinatorEffort: 'max', threadEffort: 'high' });
}

/**
 * Write the profile's cordis.patch.yml with these plugin-wide defaults. DSH
 * watches the file, so a rewrite while it runs is a config save, the same
 * write the defaults form on the plugin's page makes.
 */
function writePatch(modelPort, defaults) {
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
          - id: fake-mini
            name: Fake Mini
            contextWindow: 131072
            reasoningEfforts:
              off:
              high: high
- id: projects
  config:
${Object.entries(defaults).map(([key, value]) => `    ${key}: ${q(value)}\n`).join('')}    approvalNoticeSeconds: 1
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

/**
 * A session's `projectSession` value (what the DSH window draws, projection.js)
 * as DSH last saved it in its projection cache, which it writes at every turn end.
 */
function windowView(sessionId) {
    try {
        const doc = JSON.parse(readFileSync(join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), 'utf8'));
        return doc?.record?.rows?.projectSession?.val?.v ?? null;
    } catch {
        return null;
    }
}

/** Wait for the coordinator to answer an automatic message, then for it to be idle. */
async function coordinatorSaw(mark, reply, what) {
    const req = await waitFor(() => since(mark, 'coordinator').find((r) => r.action.text === reply), what);
    await waitIdle(project().coordinatorSessionId);
    return req;
}

let child;
/** Each user message in a session: who sent it (its `source`) and its text. */
async function messagesOf(sessionId) {
    const { events } = await bridge('GET', `/sessions/${sessionId}/events?types=user/message&limit=2000&full=1`);
    return events.map((e) => ({ source: e.source, text: e.text ?? '' }));
}
const startingWith = (msgs, prefix) => msgs.findLast((m) => m.text.startsWith(prefix));
const fromPlugin = (m) => m?.source?.kind === 'cordis-host-runner';
const fromSession = (m, sessionId) => m?.source?.kind === 'agent-message' && m.source.form === 'relay' && m.source.senderSessionId === sessionId;
const sourcesText = (msgs) => JSON.stringify(msgs.map((m) => [m.source?.kind, m.source?.senderSessionId?.slice(0, 8), m.text.slice(0, 40)]));

let coord;
try {
    // 1. Boot: the coordinator appears on its project route, with private state.
    child = startDsh(dsh);
    await waitFor(async () => existsSync(sock) && (await bridge('GET', '/health')).ok, 'the session bridge', 90000);
    coord = await waitFor(() => project().coordinatorSessionId, 'the coordinator session');
    await waitFor(() => readText(logFile).includes(`select ${PROJECT_ID}/coordinator`), 'the coordinator selection');
    check('coordinator session is titled "◆ E2E Project"', (await bridge('GET', `/sessions/${coord}`)).title === `◆ ${PROJECT}`);
    check('coordinator selection is logged', readText(logFile).includes(`select ${PROJECT_ID}/coordinator fake:fake-model effort=max`), readText(logFile));
    // DSH lists a session only after its first turn, so a new coordinator introduces itself.
    const welcome = await coordinatorSaw(0, 'SAW-WELCOME', 'the coordinator welcome');
    check('a new coordinator introduces itself', welcome.fresh.includes(`[Project created: "${PROJECT}"]`) && welcome.effort === 'max', welcome.fresh.slice(0, 200));
    mkdirSync(join(root, 'plain'));
    const blankSession = (await bridge('POST', '/sessions', { workspacePath: join(root, 'plain') })).sessionId;
    const listed = await bridge('GET', '/sessions');
    check('DSH lists the coordinator; a session without a turn stays hidden',
        listed.find((s) => s.sessionId === coord)?.blank === false && listed.find((s) => s.sessionId === blankSession)?.blank === true,
        JSON.stringify(listed.map((s) => [s.sessionId === coord ? 'coordinator' : s.sessionId === blankSession ? 'blank' : 'other', s.blank])));
    check('state folder is 700', modeOf(stateDir) === 0o700, octal(modeOf(stateDir)));
    check('store file is 600', modeOf(storeFile) === 0o600, octal(modeOf(storeFile)));
    check('log file is 600', modeOf(logFile) === 0o600, octal(modeOf(logFile)));
    // The browser half: DSH serves it for the plugin's page, and it parses
    // (DSH sends browser halves in batches, so one that does not parse breaks others).
    const signIn = /dsh web: (\S+)/.exec(readText(dshLog))?.[1] ?? '';
    const cookie = String((await httpGet(signIn)).headers['set-cookie']?.[0] ?? '').split(';')[0];
    const app = await httpGet(new URL('./', signIn).href, { cookie });
    const clientUrl = /"id":"dsh-plugin-projects","url":"([^"]+)"/.exec(app.text)?.[1];
    const client = clientUrl ? await httpGet(new URL(clientUrl, new URL('./', signIn)).href, { cookie }) : { status: 0, text: '' };
    let parses = false;
    try { new Script(client.text); parses = true; } catch {}
    check('DSH serves the browser half and it parses', client.status === 200 && client.text.includes("'plugins.bundle.config'")
        && client.text.includes("'conversation.chat.turnTail'") && parses,
        `${clientUrl ?? 'not in the boot graph'}: ${client.status}`);

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
    // The window's view, folded by DSH from the real session events.
    const view = await waitFor(() => (windowView(coord)?.threads?.some((t) => t.id === 't1' && t.handback?.status === 'done') ? windowView(coord) : null),
        'the coordinator view with the Alpha handback', 15000).catch(() => windowView(coord));
    check('the window view lists the thread, its handback and its cards', view?.role === 'coordinator' && view.project?.name === PROJECT
        && view.threads?.[0]?.session === t1 && view.threads[0].title === 'Alpha'
        && ['start', 'handback'].every((kind) => view.cards?.some((c) => c.kind === kind && c.thread === 't1' && Number.isSafeInteger(c.turn))),
        JSON.stringify(view)?.slice(0, 400));
    check('the window view marks the welcome turn and that the user has asked something since', view?.cards?.some((c) => c.kind === 'welcome' && Number.isSafeInteger(c.turn))
        && view.asked === true, JSON.stringify(view?.cards)?.slice(0, 300));
    const threadView = windowView(t1);
    check('the window view of a thread names its coordinator', threadView?.role === 'thread' && threadView.coordinator === coord
        && threadView.thread?.id === 't1' && threadView.cards?.some((c) => c.kind === 'handback'), JSON.stringify(threadView)?.slice(0, 300));
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
    // Who DSH shows as the sender: a brief or a handback comes from the session
    // that sent it (DSH draws a "Task message received" notice), a note from the
    // plugin ("Plugin status updated"); the user's own words stay the user's.
    const coordMsgs = await messagesOf(coord);
    check('the welcome and the idle note come from the plugin', fromPlugin(startingWith(coordMsgs, '[Project created'))
        && fromPlugin(startingWith(coordMsgs, '[Thread idle without a handback: t2')), sourcesText(coordMsgs));
    check('a handback comes from its thread', fromSession(startingWith(coordMsgs, '[Handback from thread t1'), t1), sourcesText(coordMsgs));
    const t1Msgs = await messagesOf(t1);
    check('a brief comes from the coordinator', fromSession(startingWith(t1Msgs, '[Brief from the coordinator'), coord), sourcesText(t1Msgs));
    const t2Msgs = await messagesOf(t2);
    check('the user\'s own words stay the user\'s', startingWith(t2Msgs, 'Hello from the user.')?.source?.kind === 'user', sourcesText(t2Msgs));

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
    check('a coordinator message comes from the coordinator', fromSession(startingWith(await messagesOf(t1), '[From the coordinator]'), coord));

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
    const held = (await messagesOf(coord)).findLast((m) => m.text.includes('Held while paused.'));
    check('a held handback still comes from its thread', fromSession(held, t1), JSON.stringify(held?.source));

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
    check('a restart does not welcome the coordinator again', model.requests.filter((r) => r.fresh.includes('[Project created')).length === 1);
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Theta cut-off note');
    check('a turn cut off by the crash is reported', saw.fresh.includes('[Thread idle without a handback: t8 · "Theta"]')
        && saw.fresh.includes('The turn was cut off because DSH stopped while it ran.'), saw.fresh.slice(0, 300));
    mark = model.requests.length;
    await say(coord, call('project_thread_send', { thread: 't1', text: 'After the restart.' }));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the t1 idle note after restart');
    check('coordinator keeps its effort after restart', since(mark, 'coordinator').every((r) => r.effort === 'low'), describe(since(mark, 'coordinator')));
    const t1After = since(mark, 't1');
    check('thread keeps its effort and tools after restart', t1After.length > 0 && t1After.every((r) => r.effort === 'max' && r.tools.includes('project_handback')), describe(t1After));

    // 17. New defaults saved while DSH runs (the form on the plugin's page
    // writes the same file) apply without restarting the plugin, to whatever
    // follows the defaults. The project's own choices (coordinator effort
    // low, thread model fake-flash) stay: a project's choice comes first.
    const starts = () => readText(logFile).split('\n').filter((l) => l.includes(` coordinator ${PROJECT_ID} `)).length;
    const saves = () => readText(logFile).split('\n').filter((l) => l.endsWith(' defaults saved')).length;
    const startsBefore = starts();
    const savesBefore = saves();
    writePatch(model.port, { coordinatorEffort: 'high', threadModel: 'fake:fake-model', threadEffort: 'max' });
    await waitFor(() => saves() > savesBefore, 'the plugin to see the saved defaults');
    check('saved defaults leave the project\'s own choices', project().settings?.coordinatorEffort === 'low' && project().settings?.threadModel === 'fake:fake-flash'
        && !readText(logFile).includes(' replaced '), JSON.stringify(project().settings));
    check('the plugin was not restarted', starts() === startsBefore, `${startsBefore} → ${starts()}`);

    // 18. The Project settings dialog's endpoints, called as the window calls them.
    const web = await signInWeb();
    let answer = await webApi(web, 'dsh-plugin-projects/describe', { target: threadSession('t1') });
    check('the window reads a project through one of its threads', answer.ok && answer.value.project.id === PROJECT_ID && answer.value.project.coordinator === coord
        && answer.value.settings.coordinatorEffort.value === 'low' && answer.value.settings.coordinatorEffort.inherited.value === 'high'
        && answer.value.threads.some((t) => t.id === 't5' && t.model === 'fake:fake-flash'), JSON.stringify(answer).slice(0, 500));
    answer = await webApi(web, 'dsh-plugin-projects/update', { target: coord, changes: { coordinatorEffort: null } });
    await waitFor(() => readText(logFile).includes(`select ${PROJECT_ID}/coordinator fake:fake-model effort=high`), 'the coordinator to follow the default again');
    check('"Use default" in the window hands the coordinator back to the saved default', answer.ok && answer.value.settings.coordinatorEffort.source === 'plugin default'
        && answer.value.settings.coordinatorEffort.value === 'high', JSON.stringify(answer).slice(0, 300));
    answer = await webApi(web, 'dsh-plugin-projects/update', { target: coord, changes: { threadEffort: 'ultra' } });
    check('the window gets the plugin\'s refusal', answer.ok === false && answer.error?.code === 'projects/refused' && /ultra/.test(answer.error.message), JSON.stringify(answer));
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { title: 'Iota', brief: 'Just answer.' }));
    await coordinatorSaw(mark, 'SAW-IDLE', 'the Iota idle note');
    check('the coordinator asks with the default effort again', since(mark, 'coordinator').every((r) => r.effort === 'high'), describe(since(mark, 'coordinator')));
    check('the coordinator prompt shows the project\'s thread model', since(mark, 'coordinator')[0]?.system.includes('- New threads: fake:fake-flash · effort max'),
        since(mark, 'coordinator')[0]?.system.split('\n').filter((l) => l.startsWith('- Coordinator:') || l.startsWith('- New threads:')).join(' | '));
    const t9Reqs = since(mark, 't9');
    check('a new thread starts on the project\'s own thread model', t9Reqs.length > 0 && t9Reqs.every((r) => r.model === 'fake-flash' && r.effort === undefined), describe(t9Reqs));

    // 19. A model picked in DSH's own picker (the composer's model menu) becomes the project's coordinator setting.
    answer = await webApi(web, 'session/selectModel', { request: { sessionId: coord, provider: 'fake', model: 'fake-model', reasoningEffort: 'max' } });
    await waitFor(() => readText(logFile).includes(`picked ${PROJECT_ID}/coordinator fake:fake-model effort=max`), 'the pick to reach the project', 10000).catch(() => {});
    check('a pick in DSH\'s model picker becomes the coordinator setting', answer.ok && project().settings?.coordinatorModel === 'fake:fake-model' && project().settings?.coordinatorEffort === 'max',
        `${JSON.stringify(answer).slice(0, 200)} ${JSON.stringify(project().settings)}`);
    check('selections the plugin makes itself are not taken for picks', readText(logFile).split('\n').filter((l) => / picked /.test(l)).length === 1,
        readText(logFile).split('\n').filter((l) => / picked | select /.test(l)).join('\n'));
    mark = model.requests.length;
    await say(coord, call('project_thread_send', { thread: 't5', text: 'After the new defaults.' }));
    await coordinatorSaw(mark, 'SAW-IDLE', 'the t5 idle note after the new defaults');
    check('the coordinator runs on the pick', since(mark, 'coordinator').every((r) => r.model === 'fake-model' && r.effort === 'max'), describe(since(mark, 'coordinator')));
    const t5After = since(mark, 't5');
    check('a thread keeps the model it started with', t5After.length > 0 && t5After.every((r) => r.model === 'fake-flash' && r.effort === undefined), describe(t5After));

    // 20. An effort the thread model lacks never stops a start: the thread runs at the nearest level it offers.
    answer = await webApi(web, 'dsh-plugin-projects/update', { target: coord, changes: { threadModel: 'fake:fake-mini' } });
    check('the window says the inherited effort is fitted', answer.ok && (answer.value?.notes ?? []).some((n) => /fake:fake-mini doesn't offer effort "max", so it runs at "high"/.test(n)),
        JSON.stringify(answer).slice(0, 400));
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { title: 'Kappa', brief: 'Just answer.' }));
    await coordinatorSaw(mark, 'SAW-IDLE', 'the Kappa idle note');
    const kappa = since(mark, 't10');
    check('a thread whose model lacks the default effort starts at the nearest one', kappa.length > 0 && kappa.every((r) => r.model === 'fake-mini' && r.effort === 'high'), describe(kappa));

    // 21. The plugin's page lists every project with what it runs and where each setting comes from.
    answer = await webApi(web, 'dsh-plugin-projects/list', {});
    const row = answer.ok ? answer.value.projects.find((p) => p.id === PROJECT_ID) : undefined;
    check('the plugin page lists the project, its settings and where each comes from', row?.coordinator === coord && row.paused === false
        && row.settings.coordinatorModel.value === 'fake:fake-model' && row.settings.coordinatorModel.source === 'project setting'
        && row.settings.threadModel.value === 'fake:fake-mini' && row.settings.threadEffort.source === 'plugin default'
        && row.live?.model === 'fake-model' && row.live?.reasoningEffort === 'max' && row.threads.open > 0, JSON.stringify(answer).slice(0, 600));
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
