#!/usr/bin/env node
/**
 * Real-host end-to-end test for the categories plugin.
 *
 * Boots a real DSH (the shipped web profile, in a temporary DSH_HOME) with
 * this repo's categories and session-bridge plugins. A first start without
 * categories makes DSH's workspaces; then, as on the user's DSH, the
 * projects plugin's store holds categories from before this plugin and the
 * all-in-one mod's old sidebar file is there. At the next start the plugin
 * moves the categories over once, exactly as they are (reading the projects
 * store only), doesn't read the old sidebar file (that store had
 * categories), and keeps DSH's own workspace order in step. Then the
 * window's endpoints (list, make, file, move, rename, delete, refusals), the
 * browser half DSH serves, and a restart that changes nothing. Then a real
 * window (Chromium on the web profile, Playwright from .e2e/tools): the
 * session list by category with every workspace still there, folding by
 * click and by key, the Categories page on its glass card, find, the chip at
 * the top of a chat, light and dark, 760 px and contrast, and switched off
 * in Plugins it leaves no header, mark, class or style sheet behind; on
 * again, one of everything. Pictures go to SHOTS (default
 * .e2e/shots/categories/<DSH version>/). Without Playwright the run fails,
 * unless NO_WINDOW=1 says to run without the window.
 *
 * With COORDINATOR=1 the coordinator plugin runs beside it: neither answers
 * for the other, the projects store stays as it was (rollback data), the
 * coordinator logs nothing about categories, and DSH's order stays the
 * categories'.
 *
 *   node scripts/e2e.mjs categories      every DSH under .e2e/ and the app's own, with the live fingerprint
 *   DSH_BIN=/path/to/node_modules/@deepseek-ai/dsh/lib/bin.js node plugins/categories/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs `dsh` from PATH. KEEP=1 keeps the temp folder.
 */
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';
import { findPlaywright, openWindow, repoRoot, setDark, shot } from '../../../../test/e2e/harness.mjs';
import { startFakeModel } from '../../../../test/e2e/fake-model.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = resolve(here, '../../..');
const WITH_COORDINATOR = process.env.COORDINATOR === '1';
/** Which DSH this is, for the pictures' folder (scripts/e2e.mjs names it). */
const version = process.env.DSH_LABEL || (/dsh-([^/]+)\/node_modules/.exec(process.env.DSH_BIN ?? '')?.[1] ?? 'dsh');
const shots = process.env.SHOTS || join(repoRoot, '.e2e', 'shots', 'categories', version);
const json = (value) => JSON.stringify(value);

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

const root = mkdtempSync(join(tmpdir(), 'dsh-categories-e2e-'));
const home = join(root, 'home');
const ws = join(root, 'ws');
const sock = join(root, 'bridge.sock');
const dshLog = join(root, 'dsh.log');
// The plugins' default places, in DSH's data folder (DSH_HOME).
const categoriesDir = join(home, 'categories');
const storeFile = join(categoriesDir, 'categories.json');
const logFile = join(categoriesDir, 'categories.log');
const projectsFile = join(home, 'projects', 'projects.json');
const oldFile = join(home, 'fleet-shell', 'state.json');

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

const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
const modeOf = (file) => statSync(file).mode & 0o777;
const octal = (mode) => mode.toString(8);

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

const profile = join(home, 'profiles', 'web');

/** The web profile with these of the repo's plugins linked in, and its patch. */
function writeProfile(names) {
    rmSync(join(profile, 'node_modules'), { recursive: true, force: true });
    mkdirSync(join(profile, 'node_modules'), { recursive: true });
    const plugins = Object.fromEntries(names.map((name) => [`dsh-plugin-${name}`, join(pluginsDir, name)]));
    writeFileSync(join(profile, 'package.json'), `${JSON.stringify({
        name: 'dsh-profile-web',
        private: true,
        dependencies: Object.fromEntries(Object.entries(plugins).map(([name, dir]) => [name, `link:${dir}`])),
        dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...Object.keys(plugins)] } },
    }, null, 2)}\n`);
    for (const [name, dir] of Object.entries(plugins)) symlinkSync(dir, join(profile, 'node_modules', name), 'dir');
    const q = JSON.stringify;
    // The categories plugin gets no config row: its defaults put its data in DSH's data folder.
    // The scripted model answers the one chat the window checks (E2E:say); a provider is named so DSH has a default.
    writeFileSync(join(profile, 'cordis.patch.yml'), `- id: agent-default-model
  config:
    provider: fake
    model: fake-model
- id: llm-pi-ai
  config:
    providers:
      fake:
        displayName: Fake
        api: openai-completions
        baseURL: http://127.0.0.1:${model.port}/v1
        apiKeyEnv: FAKE_LLM_KEY
        models:
          - id: fake-model
            name: Fake Model
            contextWindow: 131072
            reasoningEfforts: false
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

const signIns = () => [...readText(dshLog).matchAll(/dsh web: (\S+)/g)].length;

/** Start DSH and wait for the bridge and a new web sign-in link. */
async function boot(dsh, what) {
    const before = signIns();
    const child = startDsh(dsh);
    await waitFor(async () => existsSync(sock) && (await bridge('GET', '/health')).ok, `the session bridge (${what})`, 90000);
    await waitFor(() => signIns() > before, `the web sign-in link (${what})`, 30000);
    return child;
}

const dsh = findDsh();
if (!dsh) {
    console.log('skipped: set DSH_BIN to a DSH bin.js (or put dsh on PATH) to run the real-host test');
    process.exit(0);
}

mkdirSync(ws, { recursive: true });
const model = await startFakeModel();
let child;
let win;
try {
    // 1. A DSH without categories: its workspaces are made.
    writeProfile(['session-bridge']);
    child = await boot(dsh, 'first start');
    const dirs = Object.fromEntries(['a', 'b', 'c', 'd', 'e'].map((k) => [k, join(root, `work-${k}`)]));
    const wsId = {};
    for (const [k, dir] of Object.entries(dirs)) {
        mkdirSync(dir);
        wsId[k] = (await bridge('POST', '/sessions', { workspacePath: dir })).workspace.id;
    }
    // DSH's own folder as a workspace too, the one the projects plugin's ◆ project works in.
    const homeWs = (await bridge('POST', '/sessions', { workspacePath: ws })).workspace.id;
    await stopDsh(child);

    // 2. As on the user's DSH: the projects plugin's store has four categories in their places, one (General)
    // with the same id as a ◆ project and one placement of a workspace DSH no longer has; groups from before
    // categories are still recorded; the old sidebar was never imported. The old sidebar file still names
    // projects the user deleted as categories.
    const projectsStore = {
        version: 1,
        projects: {
            'e2e-project': { settings: { goal: 'Keep it' }, threads: {}, pendingHandbacks: [], nextThread: 1, home: homeWs },
            'testing-out-coordinator': { name: 'Testing out Coordinator', source: 'page', order: 0, settings: {}, threads: {}, pendingHandbacks: [], nextThread: 3, home: wsId.a },
        },
        workspaceOf: { [wsId.b]: 'dsh-plugins', [wsId.a]: 'testing-out-coordinator' },
        categories: {
            'local-model-recipe': { name: 'Local Model Recipe', order: 1, createdAt: '2026-10-10T08:13:00.000Z', source: 'import', importedFrom: 'p4' },
            'fleet-services': { name: 'Fleet Services', order: 2, createdAt: '2026-10-10T08:13:00.000Z', source: 'import', importedFrom: 'p3' },
            experimentation: { name: 'Experimentation', order: 3, createdAt: '2026-10-10T08:13:00.000Z', source: 'import', importedFrom: 'p2' },
            'testing-out-coordinator': { name: 'General', order: 0, createdAt: '2026-10-10T09:00:00.000Z', source: 'group' },
        },
        categoryOf: { [wsId.c]: 'local-model-recipe', 'clef-quant-gone': 'local-model-recipe', [wsId.d]: 'fleet-services', [wsId.e]: 'experimentation', [wsId.a]: 'testing-out-coordinator', [wsId.b]: 'testing-out-coordinator' },
        imports: { categories: { at: '2026-10-11T01:37:00.000Z', categories: 5, workspaces: 14 } },
    };
    mkdirSync(dirname(projectsFile), { recursive: true });
    const projectsText = `${JSON.stringify(projectsStore, null, 2)}\n`;
    writeFileSync(projectsFile, projectsText, { mode: 0o600 });
    mkdirSync(dirname(oldFile), { recursive: true });
    writeFileSync(oldFile, `${JSON.stringify({
        prefs: { projectsSidebar: true },
        projects: [
            { id: 'p1', name: 'DSH Plugins', instructions: 'not read', files: [], defaults: {} },
            { id: 'p4', name: 'Local Model Recipe' }, { id: 'p5', name: 'General' }, { id: 'p6', name: 'Project Testing' }, { id: 'p7', name: 'Security' },
        ],
        projectOf: { [wsId.b]: 'p1', [wsId.c]: 'p4', [wsId.a]: 'p5', [homeWs]: 'p6', [wsId.e]: 'p7' },
        agentOverride: { lane: 'not read' },
    }, null, 2)}\n`);
    const oldText = readText(oldFile);

    // 3. The plugin's first start: the categories move over once, exactly as they are; the old sidebar isn't read.
    writeProfile(WITH_COORDINATOR ? ['categories', 'session-bridge', 'coordinator'] : ['categories', 'session-bridge']);
    child = await boot(dsh, 'categories\' first start');
    await waitFor(() => readText(logFile).includes('move from projects'), 'the move from the projects store', 30000);
    const web = await signInWeb();
    const api = (method, args) => webApi(web, `dsh-plugin-categories/${method}`, args);
    let lists = await waitFor(async () => { const r = await api('list', {}); return r.ok ? r : null; }, 'the categories endpoint', 30000);
    const category = (name) => lists.value?.categories?.find((c) => c.name === name);
    const holds = (name) => category(name)?.workspaces?.map((w) => w.id) ?? [];
    const store = readJson(storeFile);
    check('the projects plugin\'s categories come over exactly as they are, General keeping the id it shares with a ◆ project',
        JSON.stringify(store.categories) === JSON.stringify(projectsStore.categories) && JSON.stringify(store.categoryOf) === JSON.stringify(projectsStore.categoryOf),
        JSON.stringify({ categories: store.categories, categoryOf: store.categoryOf }));
    check('the list shows them in their order, each with the workspaces DSH has', JSON.stringify(lists.value?.categories?.map((c) => [c.id, c.name])) === JSON.stringify([
        ['testing-out-coordinator', 'General'], ['local-model-recipe', 'Local Model Recipe'], ['fleet-services', 'Fleet Services'], ['experimentation', 'Experimentation'],
    ]) && holds('General').length === 2 && holds('General').includes(wsId.a) && holds('General').includes(wsId.b) && holds('Local Model Recipe').join() === wsId.c
        && holds('Fleet Services').join() === wsId.d && holds('Experimentation').join() === wsId.e, JSON.stringify(lists.value?.categories));
    check('the move is logged once, with a copy of the projects store', readText(logFile).split('\n').filter((l) => l.includes(' move from projects ')).length === 1
        && readText(logFile).includes('move from projects from=categories categories=4 workspaces=6 backup=') && readText(join(categoriesDir, 'from-projects.json')) === projectsText,
    readText(logFile));
    check('the projects store is only read', readText(projectsFile) === projectsText);
    check('the old sidebar isn\'t read: nothing deleted comes back', !readText(logFile).includes('fleet-shell') && store.imports?.fleetShell === undefined
        && !['DSH Plugins', 'Project Testing', 'Security'].some((name) => category(name)) && readText(oldFile) === oldText && !/not read|agentOverride/.test(readText(storeFile)),
    readText(logFile));
    check('the plugin\'s folder is 700, its store, log and copy 600', modeOf(categoriesDir) === 0o700 && modeOf(storeFile) === 0o600 && modeOf(logFile) === 0o600
        && modeOf(join(categoriesDir, 'from-projects.json')) === 0o600,
    [categoriesDir, storeFile, logFile].map((f) => octal(modeOf(f))).join(' '));
    const dshOrder = async () => (await bridge('GET', '/workspaces')).map((w) => w.id);
    const together = (order, ids) => ids.length === 0 || order.slice(order.indexOf(ids[0]), order.indexOf(ids[0]) + ids.length).join() === ids.join();
    let order = await waitFor(async () => {
        const now = await dshOrder();
        return together(now, holds('General')) && now.indexOf(holds('General')[0]) === 0 ? now : null;
    }, 'DSH\'s order in category order', 15000).catch(async () => dshOrder());
    check('DSH\'s own workspace order holds each category together, in their order, then the rest', together(order, holds('General')) && order.indexOf(holds('General')[0]) === 0
        && order.indexOf(wsId.c) === 2 && order.indexOf(wsId.d) === 3 && order.indexOf(wsId.e) === 4 && order.indexOf(homeWs) === 5, JSON.stringify(order));

    // The browser half: DSH serves it, and it parses (DSH sends browser halves in batches, so one that does not parse breaks others).
    const app = await httpGet(web.base.href, { cookie: web.cookie });
    const clientUrl = /"id":"dsh-plugin-categories","url":"([^"]+)"/.exec(app.text)?.[1];
    const client = clientUrl ? await httpGet(new URL(clientUrl, web.base).href, { cookie: web.cookie }) : { status: 0, text: '' };
    let parses = false;
    try { new Script(client.text); parses = true; } catch {}
    check('DSH serves the browser half and it parses', client.status === 200 && parses, `${clientUrl ?? 'not in the boot graph'}: ${client.status}`);

    // 4. The window's endpoints.
    lists = await api('createCategory', { name: 'Later', workspace: homeWs });
    const laterId = lists.value?.category;
    check('a new category is last, with the workspace it was made with', lists.ok && laterId === 'later' && lists.value.categories.at(-1)?.id === laterId && holds('Later').join() === homeWs,
        JSON.stringify(lists));
    lists = await api('fileWorkspace', { workspace: wsId.d, category: laterId, before: homeWs });
    order = await dshOrder();
    check('a workspace filed before another lands there, in DSH\'s order too', lists.ok && holds('Later').join() === `${wsId.d},${homeWs}` && holds('Fleet Services').length === 0
        && together(order, [wsId.d, homeWs]), `${JSON.stringify(lists.value?.categories)} ${JSON.stringify(order)}`);
    lists = await api('moveCategory', { category: laterId, before: 'testing-out-coordinator' });
    order = await dshOrder();
    check('a category moves, and DSH\'s order with it', lists.ok && lists.value.categories[0]?.id === laterId && order.indexOf(homeWs) < order.indexOf(wsId.a),
        `${JSON.stringify(lists.value?.categories?.map((c) => c.id))} ${JSON.stringify(order)}`);
    lists = await api('renameCategory', { category: laterId, name: 'Later On' });
    check('a category is renamed', lists.ok && category('Later On')?.id === laterId);
    const refusals = [
        [await api('fileWorkspace', { workspace: wsId.a, category: 'nope' }), /"nope" is not a category here/],
        [await api('createCategory', { name: '   ' }), /a category needs a name/],
        [await api('fileWorkspace', { workspace: 'no-such-workspace', category: laterId }), /DSH has no such workspace/],
        [await api('fileWorkspace', { workspace: wsId.c, category: laterId, before: wsId.a }), /that workspace is in another category/],
    ];
    check('what can\'t be done is refused, saying why', refusals.every(([r, pattern]) => !r.ok && r.error?.code === 'categories/refused' && pattern.test(r.error.message)),
        JSON.stringify(refusals.map(([r]) => r.error ?? r)));
    lists = await api('removeCategory', { category: laterId });
    order = await dshOrder();
    check('deleting a category leaves its workspaces in DSH, in none', lists.ok && !category('Later On') && order.includes(wsId.d) && order.includes(homeWs)
        && order.indexOf(wsId.e) < order.indexOf(wsId.d) && order.indexOf(wsId.e) < order.indexOf(homeWs), JSON.stringify(order));
    lists = await api('fileWorkspace', { workspace: wsId.d, category: 'fleet-services' });
    check('a workspace goes back into a moved-over category', lists.ok && holds('Fleet Services').join() === wsId.d, JSON.stringify(lists.value?.categories));

    if (WITH_COORDINATOR) {
        // Beside the coordinator plugin: each answers for its own, and the projects store stays as it was.
        const coordinating = await webApi(web, 'dsh-plugin-coordinator/list', {});
        check('the coordinator plugin answers for its coordinating chats only', coordinating.ok && Array.isArray(coordinating.value?.projects)
            && coordinating.value.categories === undefined, JSON.stringify(coordinating).slice(0, 300));
        check('the projects store is still only read', readText(projectsFile) === projectsText);
        const coordinatorLog = readText(join(home, 'coordinator', 'coordinator.log'));
        check('the coordinator plugin logs nothing about categories or DSH\'s workspace order', !/categor|workspace-order|fleet-shell/.test(coordinatorLog),
            coordinatorLog.split('\n').filter((l) => /categor|workspace-order|fleet-shell/.test(l)).join('\n'));
    }

    // 5. A restart: nothing moves or comes in again; the categories and DSH's order are as they were.
    const before = { categories: lists.value?.categories, order: await dshOrder(), store: readText(storeFile) };
    const orderLines = () => readText(logFile).split('\n').filter((l) => l.includes(' workspace-order ')).length;
    const linesBefore = orderLines();
    await stopDsh(child);
    child = await boot(dsh, 'restart');
    const webAgain = await signInWeb();
    const again = await waitFor(async () => { const r = await webApi(webAgain, 'dsh-plugin-categories/list', {}); return r.ok ? r : null; }, 'the categories after the restart', 30000);
    await sleep(500);
    check('after a restart the categories are as they were, nothing moved or imported again', JSON.stringify(again.value?.categories) === JSON.stringify(before.categories)
        && readText(logFile).split('\n').filter((l) => / move from projects /.test(l)).length === 1 && !readText(logFile).includes('fleet-shell') && readText(storeFile) === before.store,
    readText(logFile));
    check('DSH\'s order needed no moves', JSON.stringify(await dshOrder()) === JSON.stringify(before.order) && orderLines() === linesBefore, `${orderLines()} vs ${linesBefore}`);

    // 6. In a real window (Chromium on DSH's web profile): the session list by category, with every one of DSH's
    //    workspaces still there; folding by click and by key; the Categories page on its glass card; the chip at the
    //    top of a chat; light and dark, 760 px, contrast; and switched off in Plugins it leaves nothing behind, then
    //    on again draws one of everything. Pictures in .e2e/shots/categories/<DSH version>/.
    const pw = await findPlaywright();
    if (!pw && process.env.NO_WINDOW !== '1') throw new Error('Playwright is not installed: install it under .e2e/tools, or set NO_WINDOW=1');
    if (pw) {
        const titles = { a: 'work-a', b: 'work-b', c: 'work-c', d: 'work-d', e: 'work-e' };
        // A chat in a workspace of General, for the chip (a blank New Session shows none).
        const chat = (await bridge('POST', '/sessions', { workspacePath: dirs.a, title: 'Chip check', text: 'E2E:say Filed under General.' })).sessionId;
        await waitFor(async () => (await bridge('GET', `/sessions/${encodeURIComponent(chat)}`))?.status === 'idle', 'the chat to finish its turn', 60000).catch(() => {});
        const link = [...readText(dshLog).matchAll(/dsh web: (\S+)/g)].at(-1)?.[1];
        win = await openWindow({ signIn: async () => ({ link }) }, pw, { width: 1280, height: 860 });
        const { page } = win;
        const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
        const section = async (name, fn) => {
            try {
                await fn();
            } catch (error) {
                check(name, false, error?.stack ?? String(error));
                await shot(page, shots, `failed-${slug(name)}`).catch(() => {});
            }
        };
        const heads = () => page.locator('[data-categories-sb] [data-categories-title]').allInnerTexts();
        const listText = () => page.locator('[data-slot="sidebar.workspaces"]').innerText();
        /** The lowest text contrast in `selector`, each text's colour over its grounds layered down to DSH's body. */
        const lowestContrast = (selector) => page.evaluate((sel) => {
            const parse = (c) => {
                const m = /rgba?\(([^)]+)\)/.exec(c);
                if (!m) return null;
                const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
                return { r, g, b, a };
            };
            const lum = ({ r, g, b }) => {
                const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const ground = (el) => {
                const layers = [];
                for (let node = el; node; node = node.parentElement) {
                    const c = parse(getComputedStyle(node).backgroundColor);
                    if (c && c.a > 0) layers.push(c);
                    if (c && c.a >= 1) break;
                }
                let base = document.body.hasAttribute('data-ds-dark-theme') ? { r: 21, g: 21, b: 23 } : { r: 255, g: 255, b: 255 };
                for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
                return base;
            };
            const out = [];
            for (const el of document.querySelectorAll(`${sel} *`)) {
                const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
                if (!own || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
                const fg = parse(getComputedStyle(el).color);
                if (!fg) continue;
                const bg = ground(el);
                const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
                const [l1, l2] = [lum(mixed), lum(bg)].sort((x, y) => y - x);
                out.push({ ratio: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100, text: el.textContent.trim().slice(0, 40) });
            }
            return out.sort((x, y) => x.ratio - y.ratio).slice(0, 3);
        }, selector);

        await section('the session list by category in a real window', async () => {
            await waitFor(async () => (await heads()).length >= 5, 'the headers in DSH\'s session list', 60000);
            check('the session list shows a header per category in their order, then Other workspaces', json(await heads()) === json(['General', 'Local Model Recipe', 'Fleet Services', 'Experimentation', 'Other workspaces']), json(await heads()));
            const text = await listText();
            check('every one of DSH\'s workspaces is still in its list, under its category (the plugin hides none)', Object.values(titles).every((t) => text.includes(t)), text.slice(0, 400));
            const general = page.locator('[data-categories-sb="testing-out-coordinator"]');
            check('a header says its name and count to a screen reader', (await general.getAttribute('aria-label')) === 'General, 2 workspaces' && (await general.getAttribute('aria-expanded')) === 'true', await general.getAttribute('aria-label'));
            await shot(page, shots, 'sidebar-light');
            await setDark(page, true);
            await shot(page, shots, 'sidebar-dark');
            await setDark(page, false);
            // A click folds it: its workspaces leave the list; Enter on the header opens it again, the keyboard staying there.
            await general.click();
            await waitFor(async () => (await general.getAttribute('aria-expanded')) === 'false', 'the fold', 5000);
            const foldedOut = !(await page.locator('[data-slot="sidebar.workspaces"]').getByText(titles.a, { exact: true }).first().isVisible());
            check('a click folds a category: its workspaces leave the list, the others stay', foldedOut && (await listText()).includes(titles.c), (await listText()).slice(0, 300));
            await shot(page, shots, 'sidebar-folded-light');
            await page.keyboard.press('Shift');
            await general.focus();
            await page.keyboard.press('Enter');
            await waitFor(async () => (await general.getAttribute('aria-expanded')) === 'true', 'the unfold by key', 5000);
            const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-categories-sb'));
            const ring = await general.evaluate((el) => getComputedStyle(el).boxShadow);
            check('Enter opens it again, the keyboard stays on the header, and its ring shows', focused === 'testing-out-coordinator' && /inset/.test(ring) && (await page.locator('[data-slot="sidebar.workspaces"]').getByText(titles.a, { exact: true }).first().isVisible()), json({ focused, ring }));
        });

        await section('the Categories page on its glass card', async () => {
            await page.getByText('Categories', { exact: true }).first().click();
            const pageRoot = page.locator('[data-categories-page]');
            await pageRoot.waitFor({ state: 'visible', timeout: 20000 });
            const heading = await pageRoot.locator('h1').innerText();
            const count = await pageRoot.locator('.dshc-pg-count').innerText();
            const rows = await pageRoot.locator('[role="treeitem"][data-categories-node="category"] > .dshc-tree-row .dshc-tree-title').allInnerTexts();
            check('the page: its heading, its count, each category in order with Other workspaces last', heading === 'Categories' && count === '4 categories' && json(rows) === json(['General', 'Local Model Recipe', 'Fleet Services', 'Experimentation', 'Other workspaces']), json({ heading, count, rows }));
            const grounds = await page.evaluate(() => {
                const root = getComputedStyle(document.querySelector('.dshc-pg'));
                const card = getComputedStyle(document.querySelector('.dshc-pg-scroll'));
                return { root: root.backgroundColor, card: card.backgroundColor, blur: card.backdropFilter || card.webkitBackdropFilter, radius: card.borderTopLeftRadius };
            });
            check('its root is unpainted and its content sits on one glass card at tint + .2 (DESIGN.md)', grounds.root === 'rgba(0, 0, 0, 0)' && /, 0\.75\)$/.test(grounds.card) && /blur\(22px\)/.test(grounds.blur), json(grounds));
            await shot(page, shots, 'page-light');
            await setDark(page, true);
            const dark = await page.evaluate(() => getComputedStyle(document.querySelector('.dshc-pg-scroll')).backgroundColor);
            check('dark: the card takes the dark glass', /^rgba\(10, 13, 12, 0\.75\)$/.test(dark), dark);
            await shot(page, shots, 'page-dark');
            for (const theme of ['dark', 'light']) {
                await setDark(page, theme === 'dark');
                const worst = await lowestContrast('[data-categories-page]');
                check(`${theme}: every text on the page reaches 4.5:1`, worst.length > 0 && worst[0].ratio >= 4.5, json(worst));
            }
            // Find by name keeps the matches; the tree is one tab stop with ↓ from the box.
            const findBox = pageRoot.locator('input[data-categories-find], [data-categories-find] input').first();
            await findBox.fill('fleet');
            const found = await pageRoot.locator('[role="treeitem"][data-categories-node="category"] > .dshc-tree-row .dshc-tree-title').allInnerTexts();
            check('find by name keeps what matches', json(found) === json(['Fleet Services']), json(found));
            await shot(page, shots, 'page-find-light');
            await findBox.press('Escape');
        });

        await section('a 760 px window', async () => {
            await page.setViewportSize({ width: 760, height: 900 });
            await page.waitForTimeout(600);
            const fit = await page.evaluate(() => {
                const card = document.querySelector('.dshc-pg-scroll');
                return card ? { scroll: card.scrollWidth, client: card.clientWidth, width: card.getBoundingClientRect().width } : null;
            });
            check('760 px: the page fits without a sideways scroll', Boolean(fit) && fit.scroll <= fit.client + 1, json(fit));
            await shot(page, shots, 'page-760-light');
            await setDark(page, true);
            await shot(page, shots, 'page-760-dark');
            await setDark(page, false);
            await page.setViewportSize({ width: 1280, height: 860 });
            await page.waitForTimeout(600);
        });

        await section('the chip at the top of a chat', async () => {
            await page.locator('[data-slot="sidebar.workspaces"]').getByText('Chip check', { exact: true }).first().click();
            const chip = page.locator('[data-categories-chip]');
            await chip.first().waitFor({ state: 'visible', timeout: 20000 });
            const words = await chip.first().innerText();
            const label = await chip.first().getAttribute('aria-label');
            check('a chat in a category shows Category / workspace among DSH\'s header buttons, named for screen readers', /General\s*\/\s*work-a/.test(words) && (await chip.count()) === 1 && /General/.test(label ?? '') && /work-a/.test(label ?? ''), json({ words, label }));
            await shot(page, shots, 'chip-light');
            await setDark(page, true);
            await shot(page, shots, 'chip-dark');
            await setDark(page, false);
        });

        await section('switched off in Plugins it leaves nothing behind; on again, one of everything', async () => {
            const webNow = await signInWeb();
            const off = await webApi(webNow, 'pluginManager/setBundleEnabled', { name: 'dsh-plugin-categories', enabled: false });
            await waitFor(async () => (await page.locator('[data-categories-sb]').count()) === 0, 'the headers to go', 30000).catch(() => {});
            await page.waitForTimeout(800);
            const left = await page.evaluate(() => ({
                sheets: document.querySelectorAll('style[data-plugin="dsh-plugin-categories"]').length,
                marks: [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => a.name.startsWith('data-categories'))).map((el) => el.tagName).slice(0, 5),
                classes: document.querySelectorAll('[class*="dshc-"]').length,
            }));
            const text = await listText();
            check('switched off (as the Plugins page does): no header, mark, class or style sheet of its own is left', off.ok && left.sheets === 0 && left.marks.length === 0 && left.classes === 0, json({ off: off.ok, left }));
            check('… and DSH\'s list shows every workspace, as DSH draws it', Object.values(titles).every((t) => text.includes(t)), text.slice(0, 300));
            await shot(page, shots, 'off-light');
            const on = await webApi(webNow, 'pluginManager/setBundleEnabled', { name: 'dsh-plugin-categories', enabled: true });
            await waitFor(async () => (await heads()).length >= 5, 'the headers to come back', 60000);
            await page.waitForTimeout(800);
            const again = await page.evaluate(() => ({
                sheets: document.querySelectorAll('style[data-plugin="dsh-plugin-categories"]').length,
                general: document.querySelectorAll('[data-categories-sb="testing-out-coordinator"]').length,
            }));
            check('on again: its headers back as they were, one style sheet, nothing doubled', on.ok && again.sheets === 1 && again.general === 1 && json(await heads()) === json(['General', 'Local Model Recipe', 'Fleet Services', 'Experimentation', 'Other workspaces']), json({ on: on.ok, again, heads: await heads() }));
        });

        const ours = win.errors.filter((text) => /categor/i.test(text));
        check('no errors from the plugin in the window', ours.length === 0, ours.join('\n'));
    }
} catch (error) {
    failed += 1;
    console.log(`not ok - e2e aborted: ${error?.stack ?? error}`);
    console.log(readText(dshLog).split('\n').slice(-40).join('\n'));
} finally {
    await win?.browser?.close().catch(() => {});
    await stopDsh(child);
    await model.close?.();
    if (process.env.KEEP === '1') console.log(`kept ${root}`);
    else rmSync(root, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
