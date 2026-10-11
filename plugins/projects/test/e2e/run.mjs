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
 * settings endpoints the window calls, a pick in DSH's own model picker,
 * a thread's code changes as DSH records them, failed and stopped threads
 * as the window shows them, with Retry and Resume, a project made in the
 * window and the Projects page's order, a thread in its project's
 * workspace, a coordinator's message to a chat in no project and to
 * another project's coordinator,
 * and the user's tools and permissions: an MCP
 * server named as one of the user's tools that no coordinator is offered
 * and a thread gets only from the user's words, threads on Workspace Write,
 * and a thread's command that sends outside the workspace waiting for the
 * user's Allow once each time, answered as the window does, while a
 * coordinator's is refused.
 *
 *   DSH_BIN=/path/to/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/projects/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs `dsh` from PATH. KEEP=1 keeps the temp folder.
 * A DSH to test against: npm install --prefix /tmp/dsh @deepseek-ai/dsh
 * (then DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js).
 */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { startFakeModel } from './fake-model.mjs';
import { STATE_VERSION } from '../../lib/projection.js';

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
/** Every call that reaches the stand-in for the user's lane-catalog MCP server (fake-mcp.mjs). */
const mcpCalls = join(root, 'mcp-calls.log');

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

/**
 * DSH's approval prompts as the window gets them: its events stream on /api/remote.mux brings each request, and
 * $events/result answers one, as the prompt's Allow once and Reject do.
 */
async function approvalsOf(web) {
    const url = new URL('api/remote.mux', web.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url, { headers: { cookie: web.cookie, origin: web.base.origin } });
    const asked = [];
    const taken = new Set();
    let clientId;
    let failure;
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'open', streamId: 'events', endpoint: '$events', payload: { args: {} } })));
    socket.addEventListener('error', (event) => { failure = event.message ?? 'socket error'; });
    socket.addEventListener('message', ({ data }) => {
        let frame;
        try { frame = JSON.parse(String(data)); } catch { return; }
        if (frame.streamId !== 'events') return;
        if (frame.type === 'error') failure = JSON.stringify(frame.error);
        const value = frame.type === 'item' ? frame.value : undefined;
        if (value?.type === 'ready') clientId = value.clientId;
        else if (value?.type === 'waterfall' && value.event === 'approval/request') asked.push(value);
    });
    await waitFor(() => {
        if (failure) throw new Error(failure);
        return clientId;
    }, 'the window\'s events stream');
    return {
        /** The next prompt whose request matches, not taken before. */
        next: (what, match) => waitFor(() => {
            const found = asked.find((a) => !taken.has(a.eventId) && match(a.request ?? {}));
            if (found) taken.add(found.eventId);
            return found;
        }, what),
        answer: (prompt, outcome) => webApi(web, '$events/result', { clientId, eventId: prompt.eventId, outcome: { kind: 'result', value: outcome } }),
        close: () => socket.close(),
    };
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
    // The DSH default effort is "low", so a missed project selection shows on the wire. lane-catalog
    // stands in for one of the user's MCP servers; new sessions get Full access, as in the user's DSH.
    writeFileSync(join(profile, 'cordis.patch.yml'), `- insert:
    - id: mcp-lane-catalog
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        transport: stdio
        serverName: lane-catalog
        command: ${q(process.execPath)}
        args: [${q(join(here, 'fake-mcp.mjs'))}, ${q(mcpCalls)}]
        failOnStartupError: true
- id: permission
  config:
    defaultPreset: danger-full-access
    presets:
      read-only:
        sandbox: read-only
        approval: ask
      workspace-write:
        sandbox: workspace-write
        approval: ask
      danger-full-access:
        sandbox: danger-full-access
        approval: never
- id: agent-default-model
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
    guardedTools:
      lane-catalog:
        - lanes
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

/** A session's saved `projectSession` row's state version, or null. */
function savedVersion(sessionId) {
    try {
        return JSON.parse(readFileSync(join(home, 'storages', 'session_projcache', 'sessions', `${sessionId}.json`), 'utf8'))?.record?.rows?.projectSession?.ver ?? null;
    } catch {
        return null;
    }
}

/** Give sessions' saved `projectSession` rows an older state version, as an older version of the plugin left them (DSH stopped). */
function ageViews(ids, ver) {
    const aged = [];
    for (const id of ids) {
        const file = join(home, 'storages', 'session_projcache', 'sessions', `${id}.json`);
        try {
            const doc = JSON.parse(readFileSync(file, 'utf8'));
            if (!doc?.record?.rows?.projectSession) continue;
            doc.record.rows.projectSession.ver = ver;
            writeFileSync(file, JSON.stringify(doc));
            aged.push(id);
        } catch {}
    }
    return aged;
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
        ask: 'Check the Alpha work and report.',
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
    // A DSH goal's rounds had a coordinator poll its threads (behaviour review 3), so it isn't offered create_goal; threads are.
    check('a coordinator is kept off DSH goals, and a thread is not', !firstCoord.tools.includes('create_goal') && firstCoord.tools.includes('update_goal')
        && t1Reqs[0]?.tools.includes('create_goal'), `${firstCoord.tools.join(',')} | ${t1Reqs[0]?.tools.join(',')}`);
    check('thread gets the brief, the user\'s words first', t1Reqs[0]?.fresh.includes(`[Brief from the coordinator of "${PROJECT}" · you are thread t1, "Alpha"]\n\nThe user asked: "Check the Alpha work and report."\n\nDo the work`), t1Reqs[0]?.fresh.slice(0, 300));
    check('handback reaches the coordinator', saw.fresh.includes('[Handback from thread t1 · "Alpha" · status: done]') && saw.fresh.includes('Alpha finished'), saw.fresh.slice(0, 300));
    check('the handback says how to answer it: now, the thread\'s link first, then the result', saw.fresh.includes('(The user has not seen this. Reply now. First line: the link [Alpha](.dsh-thread/t1), a colon, and the result in one sentence.'), saw.fresh.slice(-400));
    const t1 = threadSession('t1');
    check('thread session is titled "Alpha"', (await bridge('GET', `/sessions/${t1}`)).title === 'Alpha');
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
    // DSH folds the thread's own view from its events; it can trail the coordinator's by a moment.
    const threadView = await waitFor(() => (windowView(t1)?.cards?.some((c) => c.kind === 'handback') ? windowView(t1) : null),
        'the thread view with its handback card', 15000).catch(() => windowView(t1));
    check('the window view of a thread names its coordinator', threadView?.role === 'thread' && threadView.coordinator === coord
        && threadView.thread?.id === 't1' && threadView.cards?.some((c) => c.kind === 'handback'), JSON.stringify(threadView)?.slice(0, 300));
    await sleep(1000);
    check('a turn that handed back sends no idle note', !readText(logFile).includes(`idle-note ${PROJECT_ID}/t1 `) && since(mark, 'coordinator').every((r) => r.action.text !== 'SAW-IDLE'), describe(since(mark)));

    // 3. A thread that stops without a handback: the idle note.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Beta', brief: 'Just answer.' }));
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

    // 5. A failed turn: the plugin nudges it once, from its coordinator; when it fails again, the note says so.
    // The roster now notes the direct talk.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Gamma', brief: 'E2E:fail' }));
    check('roster notes the direct talk', since(mark, 'coordinator')[0]?.system.includes('- t2 · "Beta" · idle · no handback yet · the user talked to it directly; its reply: "Plain reply."'),
        since(mark, 'coordinator')[0]?.system.split('\n').filter((l) => l.startsWith('- t')).join(' | '));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Gamma failure note');
    check('failure note says the turn failed, in the provider\'s words', saw.fresh.includes('[Thread idle without a handback: t3 · "Gamma"]') && saw.fresh.includes('The turn failed (HTTP 400): fake model rejected the request'), saw.fresh.slice(0, 300));
    const gamma = since(mark, 't3');
    check('a failed turn gets one nudge from its coordinator, sent by the plugin, and the note comes when it fails again', gamma.length >= 2
        && gamma.at(-1).fresh.includes('[From the coordinator]\n\nCarry on from where you left off and finish the task.') && readText(logFile).includes(`nudge ${PROJECT_ID}/t3 ended=error`)
        && saw.fresh.includes('that its turn failed again after a nudge') && !since(mark, 'coordinator').some((r) => r.fresh.includes('Nudge it once'))
        && fromSession(startingWith(await messagesOf(threadSession('t3')), '[From the coordinator]'), coord), describe(since(mark)));

    // 6. A thread waiting on a permission prompt, then stopped.
    mark = model.requests.length;
    const probe = join(root, 'outside', 'approval-probe.txt');
    await say(coord, call('project_thread_start', {
        ask: 'Please do this.',
        title: 'Delta',
        brief: call('write', { file_path: probe, content: 'x', sandbox_permissions: 'danger-full-access', justification: 'E2E approval check.' }),
    }));
    saw = await coordinatorSaw(mark, 'SAW-APPROVAL', 'the Delta approval note');
    check('approval note names the tool and the session', saw.fresh.includes('[Thread waiting for approval: t4 · "Delta"]')
        && saw.fresh.includes('It asked to use write: ') && saw.fresh.includes('E2E approval check.') && saw.fresh.includes('in the "Delta" session'), saw.fresh.slice(0, 400));
    // A person's stop stays a stop: no note goes to the coordinator (so it can't send the thread on by
    // itself), and its roster says the user stopped it.
    mark = model.requests.length;
    await bridge('POST', `/sessions/${threadSession('t4')}/cancel`, {});
    await waitFor(() => readText(logFile).includes(`user-stop ${PROJECT_ID}/t4`) && project().threads?.t4?.lastEnding, 'the Delta user-stop log');
    await waitIdle(threadSession('t4'));
    await sleep(1500);
    check('a person\'s stop sends the coordinator no note', since(mark, 'coordinator').length === 0
        && project().threads.t4.lastEnding.text === 'The turn was stopped by the user before it finished.', `${describe(since(mark, 'coordinator'))} ${JSON.stringify(project().threads.t4.lastEnding)}`);
    check('nothing was written without approval', !existsSync(probe));

    // 7. Coordinator effort changes from the next request, mid-turn.
    mark = model.requests.length;
    let reqs = await say(coord, call('project_settings', { coordinator_effort: 'low' }));
    check('settings change applies from the next request', reqs[0]?.effort === 'max' && reqs.at(-1)?.effort === 'low', describe(reqs));

    // 8. A thread model without efforts, and a bad effort.
    reqs = await say(coord, call('project_settings', { thread_model: 'fake-flash' }));
    check('settings note the dropped effort', resultOf(reqs).includes('has no effort levels'), resultOf(reqs));
    mark = model.requests.length;
    reqs = await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Epsilon', brief: 'Just answer.' }));
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
    // A title longer than DSH keeps (80 bytes) is cut once, at a word, with "…", and DSH keeps exactly that.
    reqs = await say(coord, call('project_thread_update', { thread: 't2', title: 'Draft the spring launch announcement with product highlights, pricing tiers and a wholesale FAQ' }));
    const longTitle = 'Draft the spring launch announcement with product highlights, pricing tiers…';
    check('a long title is cut once, at a word, and DSH keeps it whole', resultOf(reqs).includes(`renamed to "${longTitle}"`)
        && (await bridge('GET', `/sessions/${t2}`)).title === longTitle, `${resultOf(reqs).slice(0, 200)} / ${(await bridge('GET', `/sessions/${t2}`)).title}`);

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
        ask: 'Please do this.',
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
        ask: 'Please do this.',
        title: 'Eta',
        brief: `E2E:slow 4000\n${call('project_handback', { status: 'done', summary: 'Eta part one done.' })}`,
    }));
    const sent = await say(coord, call('project_thread_send', { thread: 't7', text: 'E2E:fail' }));
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Eta failure note');
    const t7Reqs = since(mark, 't7');
    check('the second message was queued while the first turn ran', sent[0].at < (t7Reqs[1]?.at ?? 0), describe(since(mark)));
    check('the first turn handed back', since(mark, 'coordinator').some((r) => r.fresh.includes('Eta part one done.')));
    check('the queued turn that failed gets its note', saw.fresh.includes('[Thread idle without a handback: t7 · "Eta"]') && saw.fresh.includes('The turn failed (HTTP 400):'), saw.fresh.slice(0, 300));

    // 16. DSH dies mid-turn. At the next start the plugin nudges the thread that
    // was cut off, and the coordinator hears how that went. Then: same
    // coordinator, routes kept, threads still wired.
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Theta', brief: 'E2E:slow 120000\nWork for a long time.' }));
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
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Theta idle note after its nudge');
    const theta = since(mark, 't8')[0];
    check('a turn cut off by the crash gets the nudge at the next start, and the coordinator hears how it went', readText(logFile).includes(`nudge ${PROJECT_ID}/t8 ended=interrupted`)
        && theta?.fresh.includes('[From the coordinator]\n\nCarry on from where you left off and finish the task.') && theta.action.text === 'NUDGED'
        && saw.fresh.includes('[Thread idle without a handback: t8 · "Theta"]') && saw.fresh.includes('NUDGED')
        && !since(mark, 'coordinator').some((r) => r.fresh.includes('The turn was cut off because DSH stopped while it ran.')), `${theta?.fresh.slice(0, 300)} | ${saw.fresh.slice(0, 300)}`);
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
    // The goal: set in the window, over the profile row's, and read by the coordinator and threads from their next request.
    answer = await webApi(web, 'dsh-plugin-projects/update', { target: coord, changes: { goal: 'Prove the plugin on a real host.\nKeep each check small.' } });
    check('the window sets the project\'s goal over its profile row\'s', answer.ok && answer.value.goal.value === 'Prove the plugin on a real host.\nKeep each check small.'
        && answer.value.goal.source === 'project setting' && answer.value.goal.inherited === 'Prove the plugin on a real host' && project().settings?.goal === answer.value.goal.value,
        JSON.stringify(answer.value?.goal ?? answer).slice(0, 300));
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Iota', brief: 'Just answer.' }));
    await coordinatorSaw(mark, 'SAW-IDLE', 'the Iota idle note');
    check('the coordinator asks with the default effort again', since(mark, 'coordinator').every((r) => r.effort === 'high'), describe(since(mark, 'coordinator')));
    // Models and efforts are settings: neither the coordinator's own prompt section nor its start result names them unless it chose one.
    const iota = since(mark, 'coordinator');
    const policyOf = (r) => { const at = r.system.indexOf('# Project coordinator'); return at < 0 ? '' : r.system.slice(at, r.system.indexOf('\n## Threads', at)); };
    check('the coordinator\'s prompt and start result name no model', iota.length > 0 && iota.every((r) => policyOf(r) !== '' && !/fake-|effort (max|high)|## Settings/.test(policyOf(r)))
        && resultOf(iota) === 'TOOL-RESULT: Started t9 "Iota". It reports back when done. Link it as [Iota](.dsh-thread/t9).',
        `${resultOf(iota)} || ${iota.map((r) => policyOf(r).split('\n').filter((l) => /fake-|effort|Settings/.test(l)).join(' | ')).join(' ;; ')}`);
    const t9Reqs = since(mark, 't9');
    check('a new thread starts on the project\'s own thread model', t9Reqs.length > 0 && t9Reqs.every((r) => r.model === 'fake-flash' && r.effort === undefined), describe(t9Reqs));
    check('the coordinator and a new thread read the goal set in the window', iota.every((r) => policyOf(r).includes('\nGoal: Prove the plugin on a real host.\n  Keep each check small.\nWorkspace: '))
        && t9Reqs.every((r) => r.system.includes('\nProject goal: Prove the plugin on a real host.\n  Keep each check small.\n')),
        `${iota.map((r) => policyOf(r).split('\n').slice(3, 6).join(' | ')).join(' ;; ')} || ${t9Reqs.map((r) => (r.system.match(/Project goal:[^]{0,80}/) ?? [''])[0]).join(' ;; ')}`);
    answer = await webApi(web, 'dsh-plugin-projects/update', { target: coord, changes: { goal: null } });
    check('"Use your profile\'s" gives the project its row\'s goal back', answer.ok && answer.value.goal.value === 'Prove the plugin on a real host' && answer.value.goal.source === 'project config'
        && project().settings?.goal === undefined, JSON.stringify(answer.value?.goal ?? answer).slice(0, 300));

    // Scope: a start that would use a guarded tool the user's words don't name is refused, and one without their words never runs.
    reqs = await say(coord, call('project_thread_start', { ask: 'Write a haiku about rain.', title: 'Lanes', brief: 'Use mcp__lane-catalog__lanes_status to list the lanes.' }));
    check('a start that would use a guarded tool the user did not ask for is refused', resultOf(reqs).startsWith('TOOL-RESULT: Failed: this would use lane-catalog, and the user\'s words do not ask for it.')
        && readText(logFile).includes(`guard ${PROJECT_ID} start lane-catalog`), resultOf(reqs));
    check('the coordinator\'s rules name the user\'s tools it doesn\'t have', reqs.some((r) => r.system.includes('\n   You don\'t have these here: lane-catalog. When the user\'s words ask for work that needs one, start a thread with their words in `ask`; the thread gets the ones their words name.\n')),
        reqs.at(-1)?.system.split('\n').filter((l) => /these here|include/.test(l)).join(' | '));
    reqs = await say(coord, call('project_thread_start', { title: 'No ask', brief: 'Just answer.' }));
    check('a start without the user\'s words is rejected before it runs', resultOf(reqs) !== '' && /\bask\b/.test(resultOf(reqs))
        && !Object.values(project().threads ?? {}).some((t) => t.title === 'No ask' || t.title === 'Lanes'), resultOf(reqs).slice(0, 300));

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
    await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Kappa', brief: 'Just answer.' }));
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

    // 21b. News: what threads hand back or finish waits for the user, from anywhere in the window, until they open the coordinator.
    answer = await webApi(web, 'dsh-plugin-projects/news', {});
    const newsHere = answer.ok ? answer.value.news.find((n) => n.coordinator === coord) : undefined;
    check('the window hears what threads finished, newest last, until the user opens the coordinator', newsHere?.project === PROJECT_ID && newsHere.unread.length > 0
        && newsHere.unread.at(-1).thread === 't10' && newsHere.unread.at(-1).kind === 'finished' && newsHere.unread.at(-1).title === 'Kappa'
        && readText(logFile).includes(`news ${PROJECT_ID}/t10 finished`), JSON.stringify(answer).slice(-600));
    answer = await webApi(web, 'dsh-plugin-projects/seeNews', { target: coord, seq: newsHere?.seq });
    check('opening the coordinator sees its news', answer.ok && answer.value.news.find((n) => n.coordinator === coord)?.unread.length === 0, JSON.stringify(answer).slice(0, 300));

    // 22. Code changes: a thread's edits show as +a -d · N files, as DSH's own
    // "Edited N files" card counts them, with the turn DSH's Review tab opens.
    // The totals outlive a DSH restart; DSH's diff of them does not.
    const git = (...args) => execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd: ws, stdio: 'ignore' });
    let gitReady = true;
    try {
        writeFileSync(join(ws, 'README.md'), '# E2E\n');
        git('init', '-q');
        git('add', 'README.md');
        git('commit', '-q', '-m', 'Start');
    } catch {
        gitReady = false;
    }
    check('git makes the workspace a repository, so DSH records each turn\'s changes', gitReady);
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Lambda', brief: call('write', { file_path: join(ws, 'notes.md'), content: 'one\ntwo\nthree\n' }) }));
    await coordinatorSaw(mark, 'SAW-IDLE', 'the Lambda idle note');
    const lambdaId = Object.entries(project().threads ?? {}).find(([, t]) => t.title === 'Lambda')?.[0];
    const lambda = threadSession(lambdaId);
    const turnsKept = (n) => waitFor(() => (project().threads?.[lambdaId]?.changes?.length === n ? true : null), `${n} Lambda turn(s) with changes in the store`, 15000).catch(() => false);
    await turnsKept(1);
    const changesOf = async (web) => {
        const read = await webApi(web, 'dsh-plugin-projects/describe', { target: coord });
        return read.ok ? read.value.threads.find((t) => t.id === lambdaId)?.changes : undefined;
    };
    const dshCard = async (web, seq) => {
        const res = await httpGet(new URL(`api/changes.summary?${new URLSearchParams({ sessionId: lambda, seq: String(seq) })}`, web.base).href, { cookie: web.cookie });
        let value = null;
        try { value = JSON.parse(res.text); } catch {}
        return { status: res.status, value };
    };
    let lc = await changesOf(web);
    const firstSeq = lc?.last.seq;
    let card = lc ? await dshCard(web, lc.last.seq) : { status: 0, value: null };
    check('a thread\'s edit shows as +a -d · N files, as DSH\'s own card counts it', lc?.added === 3 && lc.deleted === 0 && lc.files === 1 && lc.turns === 1 && lc.reviewable === true
        && card.status === 200 && card.value?.added === 3 && card.value.deleted === 0 && card.value.total === 1 && card.value.turn === lc.last.turn,
        `${JSON.stringify(lc)} ${card.status} ${JSON.stringify(card.value)?.slice(0, 200)}`);
    // The window's live copy: DSH writes its projection cache at the turn's
    // end, before it announces the turn's changes, so ask the running Host.
    const projected = await webApi(web, 'session/projections', { request: { sessionId: lambda } });
    const pv = projected.ok ? projected.value?.values?.projectSession : undefined;
    const lambdaView = pv?.role ? pv : pv?.v;
    check('the thread\'s own view marks the turn, so the window reads its changes again', lambdaView?.role === 'thread'
        && lambdaView.changes?.some((c) => c.seq === lc?.last.seq && c.turn === lc?.last.turn), projected.ok ? JSON.stringify(lambdaView) : JSON.stringify(projected).slice(0, 400));
    // A second turn (the user talking to the thread) edits the file it wrote: lines add up, the file counts once.
    await say(lambda, call('edit', { file_path: join(ws, 'notes.md'), old_string: 'two', new_string: 'TWO' }));
    await turnsKept(2);
    lc = await changesOf(web);
    check('changes add up over the thread\'s turns, and Review opens the newest', lc?.added === 4 && lc.deleted === 1 && lc.files === 1 && lc.turns === 2
        && lc.reviewable === true && lc.last.seq > firstSeq && lc.last.seq === project().threads[lambdaId].changes[1].seq, JSON.stringify(lc));
    // 22b. Two threads of the project in one folder (the changes study's P1): A only waits while B
    // edits, so DSH's summary of each of A's turns lists B's edits. The plugin counts each thread's
    // own: A changed nothing, B the file it wrote (its shell edit isn't counted until shell edits are).
    const quietThread = async (title) => {
        const at = model.requests.length;
        await say(coord, call('project_thread_start', { ask: 'Please do this.', title, brief: 'Wait for the next message.' }));
        await coordinatorSaw(at, 'SAW-IDLE', `the ${title} idle note`);
        return Object.entries(project().threads ?? {}).find(([, t]) => t.title === title)?.[0];
    };
    const waitsId = await quietThread('Waits');
    const writesId = await quietThread('Writes');
    const sessionA = threadSession(waitsId);
    const sessionB = threadSession(writesId);
    const wait6 = call('bash', { command: 'sleep 6; echo A-done', description: 'wait' });
    const overlap = async (aText, bText) => {
        const at = model.requests.length;
        await bridge('POST', `/sessions/${sessionA}/prompt`, { text: aText });
        await waitFor(() => since(at).some((r) => r.fresh.includes(aText)), 'A to start waiting');
        await say(sessionB, bText);
        await waitIdle(sessionA);
    };
    await overlap(wait6, call('write', { file_path: join(ws, 'b-new.txt'), content: 'from B\n' }));
    await overlap(wait6, call('bash', { command: "printf 'from B shell\\n' >> README.md", description: 'append' }));
    const marksOf = async (sessionId) => {
        const got = await webApi(web, 'session/projections', { request: { sessionId } });
        const value = got.ok ? got.value?.values?.projectSession : undefined;
        return (value?.role ? value : value?.v)?.changes ?? [];
    };
    const filesIn = async (sessionId, seq) => {
        const res = await httpGet(new URL(`api/changes.summary?${new URLSearchParams({ sessionId, seq: String(seq) })}`, web.base).href, { cookie: web.cookie });
        try { return (JSON.parse(res.text)?.files ?? []).map((f) => f.display ?? f.path); } catch { return []; }
    };
    const dshForA = async () => (await Promise.all((await marksOf(sessionA)).map((m) => filesIn(sessionA, m.seq)))).flat();
    const seenByDsh = await waitFor(async () => { const files = await dshForA(); return files.some((f) => f.endsWith('b-new.txt')) ? files : null; }, 'DSH announcing A\'s turn with B\'s file', 20000).catch(() => null);
    check('DSH credits a thread that only waited with what another thread changed in its folder', seenByDsh !== null, JSON.stringify(await dshForA()));
    await waitFor(() => (project().threads?.[writesId]?.changes?.length === 1 ? true : null), 'B\'s write in the store', 15000).catch(() => false);
    const readThreads = await webApi(web, 'dsh-plugin-projects/describe', { target: coord });
    const changesFor = (id) => (readThreads.ok ? readThreads.value.threads.find((t) => t.id === id)?.changes : undefined);
    const filesOfB = (project().threads?.[writesId]?.changes ?? []).flatMap((r) => r.files.map((f) => f.path));
    check('each thread counts only its own edits: none for the one that waited, its file for the one that wrote', changesFor(waitsId) === null
        && (project().threads?.[waitsId]?.changes ?? []).length === 0 && changesFor(writesId)?.files === 1 && changesFor(writesId).added === 1 && changesFor(writesId).deleted === 0
        && filesOfB.join() === 'b-new.txt', `A ${JSON.stringify(changesFor(waitsId))} B ${JSON.stringify(changesFor(writesId))} ${filesOfB.join()}`);

    // DSH restarts: the totals stay with the plugin, and Review is no longer offered.
    const lastSeq = lc?.last.seq;
    const signIns = () => [...readText(dshLog).matchAll(/dsh web: (\S+)/g)].length;
    const signInsBefore = signIns();
    await stopDsh(child);
    // (25) Views saved by an older version of the plugin, which DSH drops until the session is next loaded.
    const agedViews = ageViews([coord, threadSession('t1')], STATE_VERSION - 1);
    child = startDsh(dsh);
    await waitFor(async () => existsSync(sock) && (await bridge('GET', '/health')).ok, 'the session bridge after the second restart', 90000);
    const viewsBack = await waitFor(() => agedViews.length === 2 && agedViews.every((id) => savedVersion(id) === STATE_VERSION), 'the old views read again', 30000).catch(() => false);
    check('views an older version of the plugin saved are read again at start, from the store', viewsBack && /records refreshed=2\b/.test(readText(logFile))
        && windowView(threadSession('t1'))?.role === 'thread' && windowView(threadSession('t1'))?.coordinator === coord && windowView(coord)?.role === 'coordinator',
        `${agedViews.length} aged; ${agedViews.map((id) => savedVersion(id)).join(',')}; ${(/records refreshed=\d+/.exec(readText(logFile)) ?? ['no refresh'])[0]}`);
    await waitFor(() => signIns() > signInsBefore, 'the new web sign-in link', 30000);
    const webAgain = await signInWeb();
    lc = await waitFor(() => changesOf(webAgain), 'the project after the second restart', 30000).catch(() => undefined);
    card = lastSeq !== undefined ? await dshCard(webAgain, lastSeq) : { status: 0, value: null };
    check('after a restart the thread\'s changes stay, without a diff to review', lc?.added === 4 && lc.deleted === 1 && lc.files === 1 && lc.reviewable === false && card.status === 404,
        `${JSON.stringify(lc)} ${card.status}`);
    mark = model.requests.length;
    await say(coord, 'Which threads changed files?');
    const lambdaLine = since(mark, 'coordinator')[0]?.system.split('\n').find((l) => l.startsWith(`- ${lambdaId} · "Lambda" · `)) ?? '';
    check('the coordinator\'s roster says what the thread changed', lambdaLine.startsWith(`- ${lambdaId} · "Lambda" · idle · no handback yet · the user talked to it directly`)
        && lambdaLine.endsWith(' · changed 1 file (+4 -1)'), lambdaLine);

    // 23. Failed and stopped threads: each thread's own view says how its
    // last turn ended (read cold after the restart; Theta's nudge finished it),
    // the roster tells the coordinator, and Retry and Resume from the window
    // send the thread on.
    const viewOf = async (sessionId) => {
        const read = await webApi(webAgain, 'session/projections', { request: { sessionId } });
        const value = read.ok ? read.value?.values?.projectSession : undefined;
        return value?.role ? value : value?.v;
    };
    const endings = {};
    for (const id of ['t1', 't3', 't4', 't6', 't7', 't8']) endings[id] = (await viewOf(threadSession(id)))?.ending;
    const shape = (e) => (e ? [e.state, e.kind, e.cause ?? null] : null);
    check('a thread\'s own view says how its last turn ended', JSON.stringify(['t1', 't3', 't4', 't6', 't7', 't8'].map((id) => shape(endings[id])))
        === JSON.stringify([null, ['failed', 'error', null], ['stopped', 'aborted', 'user'], ['stopped', 'aborted', 'user'], ['failed', 'error', null], null]),
        JSON.stringify(endings));
    check('a failure reads as the provider\'s message', endings.t3?.message === 'fake model rejected the request' && typeof endings.t3?.code === 'string', JSON.stringify(endings.t3));
    mark = model.requests.length;
    await say(coord, 'Which threads failed?');
    const roster = since(mark, 'coordinator')[0]?.system.split('\n').filter((l) => l.startsWith('- t')) ?? [];
    const lineOf = (id) => roster.find((l) => l.startsWith(`- ${id} · `)) ?? '';
    check('the roster tells the coordinator which threads failed or stopped', lineOf('t3').includes('· its last turn failed (HTTP 400): fake model rejected the request')
        && lineOf('t4').includes('· stopped by the user (they can resume it) ·') && lineOf('t8') !== '' && !lineOf('t8').includes('its last turn')
        && lineOf('t7').includes('last handback: done') && lineOf('t7').includes('its last turn failed') && !lineOf('t1').includes('its last turn'), roster.join('\n'));
    check('the coordinator is told to leave a thread the user stopped stopped', since(mark, 'coordinator')[0]?.system.includes('A thread the user stopped stays stopped: when you mention it, say the user stopped it and it can be resumed.'));
    // Retry: the thread hears it from its coordinator, runs, and its failure clears.
    const refusedWhy = (answer) => (answer.ok ? 'ok' : `${answer.error?.code}: ${answer.error?.message}`);
    let answer2 = await webApi(webAgain, 'dsh-plugin-projects/continueThread', { target: coord, thread: 't1' });
    check('a thread whose last turn finished has nothing to retry', !answer2.ok && answer2.error?.code === 'projects/refused' && /nothing to retry/.test(answer2.error.message), refusedWhy(answer2));
    answer2 = await webApi(webAgain, 'dsh-plugin-projects/continueThread', { target: coord, thread: 't2' });
    check('a resolved thread is not retried', !answer2.ok && /is resolved/.test(answer2.error?.message ?? ''), refusedWhy(answer2));
    mark = model.requests.length;
    answer2 = await webApi(webAgain, 'dsh-plugin-projects/continueThread', { target: threadSession('t3'), thread: 't3' });
    saw = await coordinatorSaw(mark, 'SAW-IDLE', 'the Gamma retry\'s idle note');
    const retried = since(mark, 't3')[0];
    check('Retry sends the thread on from its coordinator', answer2.ok && answer2.value?.project?.id === PROJECT_ID
        && retried?.fresh.includes('[From the coordinator]\n\nThe user asked you to try again. Your last turn failed (HTTP 400): fake model rejected the request. Carry on from where you left off.') && retried.action.text === 'RESUMED'
        && fromSession(startingWith(await messagesOf(threadSession('t3')), '[From the coordinator]'), coord), `${refusedWhy(answer2)} ${retried?.fresh.slice(0, 300)}`);
    check('the coordinator hears how the retry went', saw.fresh.includes('[Thread idle without a handback: t3 · "Gamma"]') && saw.fresh.includes('RESUMED'), saw.fresh.slice(0, 300));
    check('a turn that finishes clears the failure', (await viewOf(threadSession('t3')))?.ending === undefined, JSON.stringify(await viewOf(threadSession('t3'))));
    // Resume: the same for a stopped thread.
    mark = model.requests.length;
    answer2 = await webApi(webAgain, 'dsh-plugin-projects/continueThread', { target: coord, thread: 't4' });
    await coordinatorSaw(mark, 'SAW-IDLE', 'the Delta resume\'s idle note');
    check('Resume continues a stopped thread', answer2.ok && since(mark, 't4')[0]?.fresh.includes('The user asked you to continue. Your last turn was stopped by the user before it finished.')
        && (await viewOf(threadSession('t4')))?.ending === undefined, `${refusedWhy(answer2)} ${since(mark, 't4')[0]?.fresh.slice(0, 300)}`);
    check('the plugin logs each retry', readText(logFile).includes(`thread-continue ${PROJECT_ID}/t3 after=error`) && readText(logFile).includes(`thread-continue ${PROJECT_ID}/t4 after=aborted`));

    // 24. Projects made in the window. New project starts a ◆ coordinator in
    // a workspace at once; the Projects page lists every project in DSH's
    // own workspace order; a profile project is renamed in the profile, and
    // one with a coordinator isn't deleted. A thread works in its project's
    // workspace, whatever folder is named.
    const dirA = join(root, 'made-here');
    const dirB = join(root, 'elsewhere');
    mkdirSync(dirA);
    mkdirSync(dirB);
    const wsA = (await bridge('POST', '/sessions', { workspacePath: dirA })).workspace.id;
    await bridge('POST', '/sessions', { workspacePath: dirB });
    const api = (method, args) => webApi(webAgain, `dsh-plugin-projects/${method}`, args);
    mark = model.requests.length;
    let lists = await api('create', { name: 'Made Here', workspace: wsA });
    const madeId = lists.value?.project;
    const madeCoord = lists.value?.coordinator;
    await waitFor(() => since(mark).some((r) => r.system.includes('You are the coordinator of the DSH project "Made Here"') && r.fresh.includes('[Project created')), 'the new coordinator\'s welcome');
    const madeView = madeCoord ? await bridge('GET', `/sessions/${madeCoord}`) : null;
    check('New project starts a welcomed ◆ coordinator in its workspace', lists.ok && madeView?.cwd === realpathSync(dirA) && madeView?.title === '◆ Made Here'
        && lists.value.projects.find((p) => p.id === madeId)?.home === wsA, JSON.stringify(madeView).slice(0, 300));
    lists = await api('list', {});
    const order = (await bridge('GET', '/workspaces')).map((w) => w.id);
    const places = lists.value?.projects?.map((p) => order.indexOf(p.home)) ?? [];
    check('the Projects page lists every project in DSH\'s own workspace order, with no categories', lists.ok
        && lists.value.projects.map((p) => p.id).sort().join() === [PROJECT_ID, madeId].sort().join()
        && places.every((at, i) => at >= 0 && (i === 0 || places[i - 1] <= at)) && Object.keys(lists.value).sort().join() === 'guarded,permissions,projects',
    `${JSON.stringify(lists.value?.projects?.map((p) => [p.id, p.home]))} ${JSON.stringify(order)}`);
    let refused = await api('rename', { project: PROJECT_ID, name: 'Nope' });
    check('a profile project is renamed in the profile, not here', !refused.ok && /set in your profile/.test(refused.error?.message ?? ''), JSON.stringify(refused));
    refused = await api('remove', { project: madeId });
    check('a project with a coordinator isn\'t deleted', !refused.ok && /has a coordinator/.test(refused.error?.message ?? ''), JSON.stringify(refused));
    refused = await api('createCategory', { name: 'Later', workspace: wsA });
    check('categories are no part of this plugin', !refused.ok, JSON.stringify(refused).slice(0, 300));
    mark = model.requests.length;
    await say(coord, call('project_thread_start', { ask: 'Please do this.', title: 'Mu', brief: 'Just answer.', folder: 'elsewhere' }));
    await coordinatorSaw(mark, 'SAW-IDLE', 'the Mu idle note');
    const muId = Object.entries(project().threads ?? {}).find(([, t]) => t.title === 'Mu')?.[0];
    const muView = muId ? await bridge('GET', `/sessions/${threadSession(muId)}`) : null;
    check('a thread works in its project\'s workspace, whatever folder is named', muView?.cwd === realpathSync(ws), JSON.stringify(muView).slice(0, 300));
    check('the coordinator isn\'t offered other folders', !since(mark, 'coordinator')[0]?.system.includes('other folders'), since(mark, 'coordinator')[0]?.system.split('\n').filter((l) => /folder/i.test(l)).join(' | '));

    // 25. The user's tools and permissions. lane-catalog, one of the user's own tools in this profile
    // (guardedTools), runs as an MCP server for every session. Under "Your tools: Only when asked", the
    // default, no coordinator is offered it or can call it, and a thread has it only when the user's own
    // words for it name it. Threads run on Workspace Write; DSH's default here is Full access, as in the
    // user's own DSH, and coordinators keep it.
    const LANES = 'mcp__lane-catalog__lanes_status';
    const plainId = (await bridge('POST', '/sessions', { workspacePath: join(root, 'plain'), text: 'Hello plain session.' })).sessionId;
    await waitIdle(plainId);
    const plainReq = model.requests.find((r) => r.fresh.includes('Hello plain session.'));
    check('the user\'s MCP server reaches an ordinary session', plainReq?.tools.includes(LANES) === true, plainReq?.tools.join(','));
    reqs = await say(coord, `E2E:force ${LANES} {}`);
    check('a coordinator is never offered the user\'s tool', reqs[0]?.tools.includes('bash') && !reqs[0].tools.includes(LANES)
        && model.requests.filter((r) => whoOf(r) === 'coordinator').every((r) => !r.tools.includes(LANES)), reqs[0]?.tools.join(','));
    check('its call to it anyway is refused before it reaches the server, with what to do instead', resultOf(reqs).includes('which this project keeps out of the coordinator. When the user asks for work that needs it, start a thread')
        && readText(mcpCalls) === '', resultOf(reqs));
    // Made Here's coordinator is new: the user has written nothing to it yet. The start's arguments go as JSON with every "l"
    // escaped, so the message that carries them (the user's words, here) names no tool, nor "lanes", while the ask does.
    const madeThreads = () => Object.values(store().projects?.[madeId]?.threads ?? {});
    const s4 = 'Use lane-catalog to check which of my model lanes are up right now.';
    const lanesStart = `E2E:call project_thread_start ${JSON.stringify({ ask: s4, title: 'Lanes up', brief: `Report which are up. E2E:force ${LANES} {}` }).replace(/l/g, '\\u006c').replace(/L/g, '\\u004c')}`;
    reqs = await say(madeCoord, lanesStart);
    check('an ask that names the user\'s tool when the user never did is refused', resultOf(reqs).startsWith('TOOL-RESULT: Failed: ask names lane-catalog, but the user\'s messages don\'t.')
        && readText(logFile).includes(` guard ${madeId} ask-unsaid lane-catalog`) && !madeThreads().some((t) => t.title === 'Lanes up'), resultOf(reqs));
    await say(madeCoord, s4);
    mark = model.requests.length;
    reqs = await say(madeCoord, lanesStart);
    check('once the user asks for it by name, the thread starts with it', /^TOOL-RESULT: Started t\d+ "Lanes up"\. It reports back when done\. The user's words give it lane-catalog\./.test(resultOf(reqs)), resultOf(reqs));
    await waitFor(() => since(mark).some((r) => r.system.includes('the DSH project "Made Here"') && whoOf(r) === 'coordinator' && r.action.text === 'SAW-IDLE'), 'the Lanes up idle note');
    await waitIdle(madeCoord);
    const lanesReqs = since(mark).filter((r) => /You are thread t\d+, "Lanes up", in the DSH project "Made Here"/.test(r.system));
    check('the thread is offered the tool the user\'s words name, and its call reaches the server', lanesReqs[0]?.tools.includes(LANES) && resultOf(lanesReqs).includes('alpha up, beta up')
        && readText(mcpCalls).trim().split('\n').length === 1 && readText(logFile).includes(` wall ${madeId}/coordinator `), `${lanesReqs[0]?.tools.filter((t) => t.startsWith('mcp__')).join(',')} | ${resultOf(lanesReqs)}`);
    // The user writes to a thread directly: the tools their words there name are its own from that turn on.
    mark = model.requests.length;
    await say(t2, `Please ask lane-catalog which are up. E2E:force ${LANES} {}`);
    const direct = since(mark, 't2').filter((r) => r.system.includes(`in the DSH project "${PROJECT}"`));
    check('the user\'s own words in a thread give it that tool for the same turn', direct[0]?.tools.includes(LANES) && resultOf(direct).includes('alpha up, beta up')
        && readText(logFile).includes(`tools ${PROJECT_ID}/t2 +lane-catalog from the user in the thread`), `${direct[0]?.tools.filter((t) => t.startsWith('mcp__')).join(',')} | ${resultOf(direct)}`);
    // Permissions, as DSH itself holds them.
    let described = await webApi(webAgain, 'dsh-plugin-projects/describe', { target: madeCoord });
    const lanesRow = described.value?.threads?.find((t) => t.title === 'Lanes up');
    check('a thread runs on Workspace Write, its coordinator on Read Only, and the window shows both', described.ok && lanesRow?.permission === 'workspace-write'
        && described.value.project.permission === 'read-only' && lanesRow.tools?.join() === 'lane-catalog' && described.value.project.tools?.length === 0
        && described.value.permissions?.options?.map((o) => o.value).join() === 'read-only,workspace-write,danger-full-access', JSON.stringify(described.value ?? described).slice(0, 600));
    const lanesThread = madeThreads().find((t) => t.title === 'Lanes up');
    const lanesEvents = (await bridge('GET', `/sessions/${lanesThread?.sessionId}/events?types=permission/preset,user/message&limit=50`)).events;
    const presetAt = lanesEvents.findLastIndex((e) => e.type === 'permission/preset');
    check('it is on Workspace Write before it reads its brief', presetAt > 0 && lanesEvents.findIndex((e) => e.type === 'user/message') > presetAt, JSON.stringify(lanesEvents.map((e) => e.type)));
    described = await webApi(webAgain, 'dsh-plugin-projects/describe', { target: coord });
    check('every thread the plugin started ran on Workspace Write', described.ok && described.value.threads.length > 3 && described.value.threads.every((t) => t.permission === 'workspace-write'),
        JSON.stringify(described.value?.threads?.map((t) => [t.id, t.permission])));
    // Project settings moves the coordinator at once, and new threads start on what it says.
    let changed = await webApi(webAgain, 'dsh-plugin-projects/update', { target: madeCoord, changes: { coordinatorPermission: 'workspace-write' } });
    check('Project settings moves a coordinator to another permission', changed.ok && changed.value.project.permission === 'workspace-write'
        && changed.value.access.coordinatorPermission.source === 'project setting', JSON.stringify(changed).slice(0, 400));
    changed = await webApi(webAgain, 'dsh-plugin-projects/update', { target: madeCoord, changes: { coordinatorPermission: null, threadPermission: 'read-only' } });
    check('and back to Read Only, the plugin\'s default', changed.ok && changed.value.project.permission === 'read-only' && changed.value.access.threadPermission.value === 'read-only', JSON.stringify(changed).slice(0, 400));
    // On Read Only a coordinator changes no files, and what would need approval is refused without asking the user.
    const coordinatorFile = join(dirA, 'coordinator-probe.txt');
    mark = model.requests.length;
    await say(madeCoord, call('write', { file_path: coordinatorFile, content: 'x', sandbox_permissions: 'danger-full-access', justification: 'E2E coordinator check.' }));
    await waitFor(() => readText(logFile).includes(` read-only-refused ${madeId}/coordinator write`), 'the coordinator\'s refused write');
    const pending = (await bridge('GET', `/sessions/${madeCoord}/events?types=approval/asked,approval/decided&limit=20`)).events ?? [];
    check('a coordinator on Read Only writes nothing, and asks the user nothing', !existsSync(coordinatorFile)
        && pending.filter((e) => e.type === 'approval/decided').every((e) => e.data?.outcome !== 'allowed-once'),
        `${existsSync(coordinatorFile)} ${JSON.stringify(pending.map((e) => [e.type, e.data?.outcome]))} ${resultOf(since(mark).filter((r) => whoOf(r) === 'coordinator')).slice(0, 300)}`);
    // A call asking for a wider sandbox is refused before DSH would ask anyone, in words that aren't the user's no.
    const wideFile = join(dirA, 'coordinator-wide.txt');
    mark = model.requests.length;
    const wide = await say(madeCoord, call('bash', { command: `touch ${JSON.stringify(wideFile)}`, description: 'Touch a file', sandbox_permissions: 'danger-full-access', justification: 'E2E coordinator check.' }));
    await waitFor(() => readText(logFile).includes(` read-only-refused ${madeId}/coordinator bash wider`), 'the coordinator\'s refused wider call');
    const asked = (await bridge('GET', `/sessions/${madeCoord}/events?types=approval/asked&limit=20`)).events ?? [];
    const wideResult = resultOf(wide.filter((r) => whoOf(r) === 'coordinator'));
    check('a coordinator on Read Only asking for a wider sandbox is refused before anyone is asked, and not as the user\'s no', !existsSync(wideFile)
        && wideResult.includes('You are on Read Only, so this didn\'t run and nobody was asked') && !/rejected/.test(wideResult) && asked.length === pending.filter((e) => e.type === 'approval/asked').length,
        `${existsSync(wideFile)} ${asked.length} ${wideResult.slice(0, 300)}`);
    const readOnlyFile = join(dirA, 'read-only-probe.txt');
    mark = model.requests.length;
    await say(madeCoord, call('project_thread_start', { ask: 'Please do this.', title: 'Read only', brief: call('write', { file_path: readOnlyFile, content: 'x' }) }));
    // DSH's sandbox refuses the write, or asks the user; either way nothing is written.
    await waitFor(() => since(mark).some((r) => r.system.includes('the DSH project "Made Here"') && whoOf(r) === 'coordinator' && /^SAW-(IDLE|APPROVAL)$/.test(r.action.text ?? '')), 'the Read only note');
    described = await webApi(webAgain, 'dsh-plugin-projects/describe', { target: madeCoord });
    check('a thread on Read Only can\'t write even in its own folder', described.value?.threads?.find((t) => t.title === 'Read only')?.permission === 'read-only' && !existsSync(readOnlyFile),
        resultOf(since(mark).filter((r) => /You are thread t\d+, "Read only", in the DSH project/.test(r.system))));

    // 25b. Rule 6, held by the plugin: a thread's command that sends outside the workspace waits for the user in DSH's
    // prompt, which says what it sends, and its coordinator hears so; Allow once runs it once, and the same command
    // again, as a retry, asks again (a Reject sends nothing); a read runs; two sends in one step ask once; a send that
    // asks for a wider sandbox is asked about before DSH asks to widen it; the coordinator's own send is refused without
    // asking anyone; a thread whose approvals never ask is refused, with what the user can do. The test answers the
    // prompt as the window does.
    const hits = [];
    const sink = createServer((req, res) => {
        hits.push(`${req.method} ${req.url}`);
        req.resume();
        req.on('end', () => res.end(req.method === 'GET' ? 'SINK-UP' : 'SINK-RECEIVED'));
    });
    await new Promise((r) => sink.listen(0, '127.0.0.1', r));
    const sinkAt = `127.0.0.1:${sink.address().port}`;
    const posted = () => hits.filter((h) => !h.startsWith('GET ')).length;
    const prompts = await approvalsOf(webAgain);
    try {
        const deploy = { command: `curl -sS -X POST --data '{"v":1}' http://${sinkAt}/deploy`, description: 'Deploy the build' };
        const sends = `sends a POST to ${sinkAt}/deploy (curl)`;
        const ofDeploy = (r) => r.toolName === 'bash' && r.reason === `the command ${sends}. The thread says: "Deploy the build"`;
        mark = model.requests.length;
        await say(coord, call('project_thread_start', { ask: 'Deploy the build to staging.', title: 'Send', brief: call('bash', deploy) }));
        const first = await prompts.next('the Send prompt', ofDeploy);
        saw = await coordinatorSaw(mark, 'SAW-APPROVAL', 'the Send approval note');
        const sendId = Object.entries(project().threads ?? {}).find(([, t]) => t.title === 'Send')?.[0];
        const asks = () => readText(logFile).split('\n').filter((line) => line.endsWith(` send-ask ${PROJECT_ID}/${sendId} request curl`)).length;
        check('a thread\'s command that sends waits for the user in DSH\'s prompt, which says what it sends, then the thread\'s own words for it',
            first.request.displayReason?.en === `This command ${sends}. A thread asks you before each command that sends outside the workspace.\nThe thread says: "Deploy the build"`
            && posted() === 0 && asks() === 1, JSON.stringify(first.request));
        check('its coordinator hears what it waits on', saw.fresh.includes(`[Thread waiting for approval: ${sendId} · "Send"]`)
            && saw.fresh.includes(`It asked to use bash: the command ${sends}`), saw.fresh.slice(0, 400));
        mark = model.requests.length;
        const allowed = await prompts.answer(first, 'allowed-once');
        await coordinatorSaw(mark, 'SAW-IDLE', 'the Send idle note');
        check('Allow once runs it, once', allowed?.ok === true && hits.filter((h) => h === 'POST /deploy').length === 1 && resultOf(since(mark, sendId)).includes('SINK-RECEIVED'),
            `${JSON.stringify(allowed)} ${hits.join()} ${resultOf(since(mark, sendId))}`);
        mark = model.requests.length;
        await say(coord, call('project_thread_send', { thread: sendId, text: call('bash', deploy) }));
        const again = await prompts.next('the retry\'s prompt', ofDeploy);
        await prompts.answer(again, 'rejected');
        await coordinatorSaw(mark, 'SAW-IDLE', 'the retry\'s idle note');
        check('the same command again, as a retry, asks again, and a Reject sends nothing', again.eventId !== first.eventId && asks() === 2 && posted() === 1
            && resultOf(since(mark, sendId)).includes('the user rejected tool "bash"'), `${asks()} ${hits.join()} ${resultOf(since(mark, sendId))}`);
        mark = model.requests.length;
        await say(coord, call('project_thread_start', { ask: 'Check that staging is up.', title: 'Read', brief: call('bash', { command: `curl -sS http://${sinkAt}/health`, description: 'Check staging' }) }));
        await coordinatorSaw(mark, 'SAW-IDLE', 'the Read idle note');
        const readId = Object.entries(project().threads ?? {}).find(([, t]) => t.title === 'Read')?.[0];
        const readAsked = (await bridge('GET', `/sessions/${threadSession(readId)}/events?types=approval/asked&limit=20`)).events ?? [];
        check('a read runs without asking', hits.includes('GET /health') && readAsked.length === 0, `${hits.join()} ${readAsked.length}`);
        // Two sends in one step: DSH asks about them one after another, so the plugin puts the first in front of the user
        // and refuses the second unasked; the thread reads the answer before it sends again.
        mark = model.requests.length;
        const both = [call('bash', { command: `curl -sS -X POST http://${sinkAt}/first`, description: 'Send the first' }), call('bash', { command: `curl -sS -X POST http://${sinkAt}/second`, description: 'Send the second' })];
        await say(coord, call('project_thread_start', { ask: 'Send both.', title: 'Both', brief: both.join('\n') }));
        const firstOfTwo = await prompts.next('the Both prompt', (r) => r.toolName === 'bash' && r.reason?.startsWith(`the command sends a POST to ${sinkAt}/first (curl)`));
        await prompts.answer(firstOfTwo, 'rejected');
        await coordinatorSaw(mark, 'SAW-IDLE', 'the Both idle note');
        const bothId = Object.entries(project().threads ?? {}).find(([, t]) => t.title === 'Both')?.[0];
        const bothAsked = (await bridge('GET', `/sessions/${threadSession(bothId)}/events?types=approval/asked&limit=20`)).events ?? [];
        check('two sends in one step put one prompt in front of the user; the other is refused unasked, with what to do', bothAsked.length === 1 && posted() === 1
            && resultOf(since(mark, bothId)).includes(`the command sends a POST to ${sinkAt}/second (curl). Another command of yours that sends, from the same step, went to the user first`)
            && readText(logFile).includes(`send-refused ${PROJECT_ID}/${bothId} request curl one-at-a-time`), `${bothAsked.length} ${hits.join()} ${resultOf(since(mark, bothId))}`);
        // A send that asks for a wider sandbox: the plugin's prompt comes first, and DSH asks to widen the sandbox only
        // once that one is allowed, in the tool itself. A Reject there sends nothing.
        mark = model.requests.length;
        const wide = { command: `curl -sS -X POST http://${sinkAt}/wide`, description: 'Send it wide', sandbox_permissions: 'danger-full-access', justification: 'E2E escalation check.' };
        await say(coord, call('project_thread_start', { ask: 'Send it with wider access.', title: 'Wide', brief: call('bash', wide) }));
        const ours = await prompts.next('the Wide prompt', (r) => r.toolName === 'bash' && r.reason?.startsWith(`the command sends a POST to ${sinkAt}/wide (curl)`));
        await prompts.answer(ours, 'allowed-once');
        const widen = await prompts.next('DSH\'s prompt to widen the Wide sandbox', (r) => r.toolName === 'bash' && r.reason === 'escalate sandbox to danger-full-access: E2E escalation check.');
        await prompts.answer(widen, 'rejected');
        await coordinatorSaw(mark, 'SAW-IDLE', 'the Wide idle note');
        check('a send that asks for a wider sandbox shows the plugin\'s prompt first, and DSH asks to widen it only after that Allow once',
            ours.request.displayReason?.en === `This command sends a POST to ${sinkAt}/wide (curl). A thread asks you before each command that sends outside the workspace.\nThe thread says: "Send it wide" and, for wider access, "E2E escalation check."`
            && posted() === 1, `${JSON.stringify(ours.request)} ${JSON.stringify(widen.request)} ${hits.join()}`);
        const coordAsked = async () =>((await bridge('GET', `/sessions/${coord}/events?types=approval/asked&limit=50`)).events ?? []).length;
        const askedBefore = await coordAsked();
        reqs = await say(coord, call('bash', { command: `curl -sS -X POST http://${sinkAt}/deploy`, description: 'Deploy' }));
        check('a coordinator\'s send is refused, and nobody is asked', resultOf(reqs).includes(`Not run: the command ${sends}. You don't send anything yourself`)
            && posted() === 1 && (await coordAsked()) === askedBefore && readText(logFile).includes(`send-refused ${PROJECT_ID}/coordinator request curl`), resultOf(reqs));
        changed = await webApi(webAgain, 'dsh-plugin-projects/update', { target: madeCoord, changes: { threadPermission: 'danger-full-access' } });
        mark = model.requests.length;
        await say(madeCoord, call('project_thread_start', { ask: 'Please do this.', title: 'Never asks', brief: call('bash', { command: `curl -sS -X POST http://${sinkAt}/deploy`, description: 'Deploy' }) }));
        await waitFor(() => since(mark).some((r) => r.system.includes('the DSH project "Made Here"') && whoOf(r) === 'coordinator' && r.action.text === 'SAW-IDLE'), 'the Never asks idle note');
        await waitIdle(madeCoord);
        const neverReqs = since(mark).filter((r) => /You are thread t\d+, "Never asks", in the DSH project "Made Here"/.test(r.system));
        check('a thread whose approvals never ask can\'t send, and hears what the user can do', changed.ok && resultOf(neverReqs).includes('this thread\'s permission never asks')
            && resultOf(neverReqs).includes('the user can put this thread on Workspace Write') && posted() === 1 && new RegExp(` send-refused ${madeId}/t\\d+ request curl never-asks`).test(readText(logFile)), resultOf(neverReqs));
        await webApi(webAgain, 'dsh-plugin-projects/update', { target: madeCoord, changes: { threadPermission: 'read-only' } });
    } finally {
        prompts.close();
        sink.close();
    }

    // 26. A coordinator's message out of its project (project_message): to a chat in no project, and to another
    // project's coordinator. The chat stays outside: no project tools or prompt, no role in the window. Its answer
    // comes back to the coordinator once, and a turn the message started can't send one on.
    const plainTitle = (await bridge('GET', `/sessions/${plainId}`)).title;
    const ours = (r) => r.system.includes(`You are the coordinator of the DSH project "${PROJECT}"`);
    mark = model.requests.length;
    reqs = await say(coord, call('project_message', { to: plainId, ask: 'Say hello to my plain chat for me.', text: 'Hello from the e2e project.' }));
    check('a coordinator sends a chat in no project the message the user asked for', resultOf(reqs) === `TOOL-RESULT: Sent to "${plainTitle}". Its reply comes back to you once, as a note.`, resultOf(reqs));
    const plainSaw = await waitFor(() => since(mark).find((r) => r.fresh.includes(`[Message from the coordinator of "${PROJECT}"]`)), 'the chat\'s turn on the message');
    check('the chat reads it as from the project, with the user\'s words, and has no project tools or prompt', plainSaw.fresh.includes('The user asked: "Say hello to my plain chat for me."')
        && plainSaw.fresh.includes('Hello from the e2e project.') && !plainSaw.tools.some((t) => t.startsWith('project_')) && !/Project (coordinator|thread)/.test(plainSaw.system),
    `${plainSaw.tools.filter((t) => t.startsWith('project_')).join(',')} | ${plainSaw.fresh.slice(0, 300)}`);
    const replyReq = await waitFor(() => since(mark).find((r) => ours(r) && r.fresh.includes(`[Reply from "${plainTitle}"]`)), 'the reply note');
    await waitIdle(coord);
    check('its answer comes back to the coordinator as a note', replyReq.fresh.includes('SAW-MESSAGE') && replyReq.action.text === 'SAW-REPLY'
        && readText(logFile).includes(`message-reply ${PROJECT_ID} ${plainId} delivered`), replyReq.fresh.slice(0, 300));
    check('the window shows no project on that chat', !(await viewOf(plainId)), JSON.stringify(await viewOf(plainId)));
    mark = model.requests.length;
    await say(plainId, 'Second hello.');
    await new Promise((r) => setTimeout(r, 1500));
    check('a later turn of that chat sends the coordinator nothing', !since(mark).some((r) => ours(r)), describe(since(mark)));
    mark = model.requests.length;
    const bounce = call('project_message', { to: PROJECT, ask: 'Tell the E2E project hello.', text: 'Hello back.' });
    reqs = await say(coord, call('project_message', { to: '◆ Made Here', ask: 'Ask Made Here to say hello back.', text: bounce }));
    check('a coordinator sends another project\'s coordinator a message', resultOf(reqs) === 'TOOL-RESULT: Sent to ◆ Made Here. Its reply comes back to you once, as a note.', resultOf(reqs));
    const back = await waitFor(() => since(mark).find((r) => ours(r) && r.fresh.includes('[Reply from ◆ Made Here]')), 'Made Here\'s reply');
    await waitIdle(coord);
    check('that coordinator can\'t send one on in a turn the message started, and its answer comes back', back.fresh.includes('TOOL-RESULT: Failed: a message goes out of the project only in a turn the user started')
        && readText(logFile).includes(` guard ${madeId} message-not-asked`) && !readText(logFile).includes(`message ${madeId} `), back.fresh.slice(0, 400));

    // 27. Archive: the project goes with its coordinator and threads, and comes back with them. A new start leaves
    // it archived without making a coordinator, and DSH's own Archive and Unarchive on the ◆ row take the threads too.
    const webArchive = await signInWeb();
    // DSH's archive set, read through its own endpoint: unarchiving an id it doesn't hold changes nothing and answers with the set.
    const archivedNow = async () => (await webApi(webArchive, 'workspace/unarchiveSession', { request: { sessionId: 'e2e-none' } })).value?.archivedSessionIds ?? [];
    const projectSessions = [coord, ...Object.values(project().threads ?? {}).map((t) => t.sessionId).filter(Boolean)];
    let archiveAnswer = await webApi(webArchive, 'dsh-plugin-projects/archive', { project: coord });
    let inArchive = await archivedNow();
    check('Archive project archives the coordinator and every thread in DSH', archiveAnswer.ok && archiveAnswer.value.archived === projectSessions.length
        && projectSessions.every((id) => inArchive.includes(id)), `${JSON.stringify(archiveAnswer).slice(0, 200)} ${projectSessions.length} ${inArchive.length}`);
    check('the list says the project is archived', archiveAnswer.value?.projects?.find((p) => p.id === PROJECT_ID)?.archived === true
        && project().archived?.via === 'window', JSON.stringify(project().archived));
    mark = model.requests.length;
    await stopDsh(child);
    const logBefore = readText(logFile).length;
    child = startDsh(dsh);
    await waitFor(async () => existsSync(sock) && (await bridge('GET', '/health')).ok, 'the session bridge after the archive', 90000);
    // The other project's coordinator resumes as usual: the plugin's start is past this project by then.
    await waitFor(() => readText(logFile).slice(logBefore).includes(`coordinator ${madeId} `), 'the plugin to start again', 60000);
    await new Promise((r) => setTimeout(r, 1500));
    const webAfter = await signInWeb();
    const heldAfter = (await webApi(webAfter, 'workspace/unarchiveSession', { request: { sessionId: 'e2e-none' } })).value?.archivedSessionIds ?? [];
    check('a new start keeps it archived, wakes nothing of it and makes no coordinator', project().coordinatorSessionId === coord && project().archived
        && projectSessions.every((id) => heldAfter.includes(id)) && !readText(logFile).slice(logBefore).includes(`coordinator ${PROJECT_ID} `)
        && since(mark).every((r) => !r.system.includes(`You are the coordinator of the DSH project "${PROJECT}"`)), readText(logFile).slice(logBefore).slice(0, 600));
    archiveAnswer = await webApi(webAfter, 'dsh-plugin-projects/restore', { project: PROJECT_ID });
    inArchive = (await webApi(webAfter, 'workspace/unarchiveSession', { request: { sessionId: 'e2e-none' } })).value?.archivedSessionIds ?? [];
    check('Restore project brings the coordinator and every thread back', archiveAnswer.ok && archiveAnswer.value.restored === projectSessions.length
        && projectSessions.every((id) => !inArchive.includes(id)) && project().archived === undefined
        && readText(logFile).includes(`coordinator ${PROJECT_ID} ${coord} resumed`), JSON.stringify(archiveAnswer).slice(0, 200));
    // DSH's own Archive on the idle ◆ row, as its menu or shortcut does it: the plugin takes the threads.
    let own = await webApi(webAfter, 'workspace/archiveSession', { request: { sessionId: coord } });
    if (!own.ok && own.error?.code === 'workspace/session-active') {
        // Something of the project still runs, so DSH asks first; its dialog's Stop and archive does this.
        own = await webApi(webAfter, 'workspace/archiveSession', { request: { sessionId: coord, stopActivity: true } });
    }
    const followed = await waitFor(async () => {
        const ids = (await webApi(webAfter, 'workspace/unarchiveSession', { request: { sessionId: 'e2e-none' } })).value?.archivedSessionIds ?? [];
        return projectSessions.every((id) => ids.includes(id)) ? ids : null;
    }, 'the threads following the ◆ row into the archive', 15000).catch(() => null);
    check('DSH\'s own Archive on the ◆ row archives the project\'s threads too', own.ok && followed !== null && project().archived?.via === 'dsh', JSON.stringify(own).slice(0, 200));
    await webApi(webAfter, 'workspace/unarchiveSession', { request: { sessionId: coord } });
    const cameBack = await waitFor(async () => {
        const ids = (await webApi(webAfter, 'workspace/unarchiveSession', { request: { sessionId: 'e2e-none' } })).value?.archivedSessionIds ?? [];
        return projectSessions.every((id) => !ids.includes(id)) ? true : null;
    }, 'the threads coming back with the ◆ row', 15000).catch(() => false);
    check('DSH\'s own Unarchive on the ◆ row brings them back', cameBack === true && project().archived === undefined
        && /archive e2e-project via=dsh sessions=\d+\n[^]*restore e2e-project via=dsh sessions=\d+/.test(readText(logFile)), readText(logFile).split('\n').filter((l) => /archive|restore/.test(l)).join('\n'));
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
