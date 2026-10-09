/**
 * End-to-end tests for dsh-plugin-projects against a fake DSH host: the
 * coordinator is created, it starts a thread, the thread hands back, settings
 * and pause behave, and state survives a restart. No DSH install needed; the
 * peers (@deepseek-ai/schemastery, @deepseek-ai/dsh-tools) must resolve.
 *
 * Run:  node plugins/projects/test/smoke.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as plugin from '../lib/index.js';
import { effectiveSettings, applyRoute, checkSelection, parseModelSpec, pluginDefaults } from '../lib/settings.js';
import { slugify, timing } from '../lib/projects.js';

const CATALOG = {
    default: { provider: 'deepseek', model: 'deepseek-v4' },
    routableProviders: ['deepseek', 'other'],
    groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [
            { id: 'deepseek-v4', name: 'V4', reasoning: { efforts: ['off', 'low', 'high', 'max'].map((id) => ({ id, name: id })), defaultEffort: 'high' } },
            { id: 'deepseek-v4-flash', name: 'V4 Flash', reasoning: { efforts: ['off', 'high'].map((id) => ({ id, name: id })) } },
        ] },
        { id: 'other', name: 'Other', models: [{ id: 'big-model', name: 'Big' }] },
    ],
    failures: [],
};

/** Agent-scoped context: records registrations and dispatches scoped events. */
class FakeScope {
    constructor() {
        this.registered = new Map();
        this.sections = new Map();
        this.listeners = new Map();
        const self = this;
        this.tools = {
            register(def) {
                assert.ok(!self.registered.has(def.name), `duplicate tool ${def.name}`);
                self.registered.set(def.name, def);
                return () => self.registered.delete(def.name);
            },
        };
        this.systemPrompt = {
            section(sec) {
                self.sections.set(sec.name, sec);
                return () => self.sections.delete(sec.name);
            },
        };
    }
    on(event, fn, options) {
        const list = this.listeners.get(event) ?? [];
        if (options?.prepend) list.unshift(fn);
        else list.push(fn);
        this.listeners.set(event, list);
        return () => this.listeners.set(event, (this.listeners.get(event) ?? []).filter((f) => f !== fn));
    }
    /** Run the `agent/request` waterfall as cordis does: the first listener is outermost. */
    async request(base) {
        const list = this.listeners.get('agent/request') ?? [];
        const run = (i) => (i >= list.length ? Promise.resolve(base) : list[i]({}, () => run(i + 1)));
        return run(0);
    }
    emitStatus(agent, status) {
        agent.status = status;
        for (const fn of this.listeners.get('agent/status') ?? []) fn({ agent, status });
    }
    /** An event appended to this agent's session log. */
    sessionEvent(event) {
        for (const fn of this.listeners.get('session/event') ?? []) fn({}, event);
    }
    section() {
        const sec = [...this.sections.values()][0];
        return typeof sec?.text === 'function' ? sec.text({}) : sec?.text;
    }
    /** Call a tool as the model would. Like DSH, the call and its result go into the session log. */
    async call(name, args) {
        const def = this.registered.get(name);
        assert.ok(def, `tool ${name} not registered (have ${[...this.registered.keys()].join(', ')})`);
        const log = this.log?.();
        const callId = `call-${++toolCalls}`;
        log?.push({ seq: log.length + 1, type: 'tool/call', data: { callId, name, arguments: args } });
        const value = await def.execute(args, { agent: this.agent, callId });
        log?.push({ seq: log.length + 1, type: 'tool/result', data: { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text: value }] } } });
        return value;
    }
}
let toolCalls = 0;

/** The Host's model service: validates a call config and fills in the default effort. */
const fakeLlm = {
    calls: 0,
    async resolveCallConfig(config) {
        fakeLlm.calls += 1;
        const model = CATALOG.groups.find((g) => g.id === config.provider)?.models.find((m) => m.id === config.model);
        if (!model) throw new Error(`unknown model ${config.provider}:${config.model}`);
        const efforts = model.reasoning?.efforts.map((e) => e.id);
        const effective = config.reasoningEffort ?? model.reasoning?.defaultEffort;
        if (effective !== undefined && !efforts?.includes(effective)) throw new Error(`effort ${effective} unsupported`);
        return { ...config, ...(effective === undefined ? {} : { reasoningEffort: effective }) };
    },
};

/**
 * A fake Host with sessionController, agents and workspaceRegistry.
 * `selection: true` adds the per-session model selection a real DSH Host has
 * (its own `agent/request` listener, installed before `agent/created`, plus
 * `sessionController.agents.selectForNextRequest`).
 */
function fakeHost({ selection = false, hostListener = selection } = {}) {
    const listeners = new Map();
    const effects = [];
    const sessions = new Map(); // id → {events, prompts, title, cwd}
    const live = new Map(); // id → agent
    let n = 0;
    const selections = []; // [{sessionId, selection}] in call order
    const services = {
        agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
        llm: fakeLlm,
    };
    const host = {
        sessions, live, effects, selections, services,
        logger: { info() {}, warn() {} },
        get: (name) => services[name],
        on(event, fn) {
            const list = listeners.get(event) ?? [];
            list.push(fn);
            listeners.set(event, list);
        },
        effect(fn) { effects.push(fn()); },
        emit(event, payload) { for (const fn of listeners.get(event) ?? []) fn(payload); },
        agents: { get: (id) => live.get(id), list: () => [...live.values()] },
        workspaceRegistry: { async create(path) { return { id: `ws:${path}`, path }; } },
        wake(id) {
            if (live.has(id)) return live.get(id);
            const ctx = new FakeScope();
            const agent = { id, status: 'idle', ctx };
            ctx.agent = agent;
            ctx.log = () => sessions.get(id)?.events;
            if (hostListener) {
                // Like DSH's own selection listener: it rewrites the route of every request.
                ctx.on('agent/request', async (_e, next) => ({ ...await next(), provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'host' }));
            }
            live.set(id, agent);
            host.emit('agent/created', { agent, source: 'resume' });
            return agent;
        },
        sessionController: {
            async create(req) {
                const sessionId = `s${++n}`;
                sessions.set(sessionId, { events: [], prompts: [], title: null, cwd: req.workspaceId });
                return { sessionId };
            },
            async resolveAgent(id) {
                if (!sessions.has(id)) return { error: { code: 'session/not-found' } };
                return { agent: host.wake(id) };
            },
            async inspect(id) {
                if (host.inspectError) throw host.inspectError;
                if (!sessions.has(id)) throw new Error('session/not-found');
                const events = sessions.get(id).events;
                if (live.has(id)) return { meta: {}, events };
                // Like DSH's cold read: a turn left open by a crash reads as ended, "interrupted".
                const open = events.findLastIndex((e) => e.type === 'turn/start') > events.findLastIndex((e) => e.type === 'turn/end');
                return { meta: {}, events: open ? [...events, { seq: events.length + 1, type: 'turn/end', data: { reason: { kind: 'interrupted' } } }] : events };
            },
            async prompt(req) {
                assert.ok(req.requestId && req.content[0].text);
                const s = sessions.get(req.sessionId);
                s.prompts.push({ mode: req.mode, text: req.content[0].text });
                // Like DSH: the prompt is logged as a user message with its request id.
                s.events.push({ seq: s.events.length + 1, type: 'user/message', data: { content: req.content, source: { kind: 'user', rpcId: req.requestId } } });
                return { accepted: true };
            },
            async rename(req) { sessions.get(req.sessionId).title = req.title; return { title: req.title, seq: 1 }; },
            cancel(req) { sessions.get(req.sessionId).cancelled = true; return {}; },
            async modelCatalog() { return CATALOG; },
        },
    };
    if (selection) {
        host.sessionController.agents = {
            selectForNextRequest(agent, sel) {
                assert.equal(live.get(agent.id), agent, 'selection targets the live agent');
                selections.push({ sessionId: agent.id, selection: sel, promptsBefore: sessions.get(agent.id).prompts.length });
            },
        };
    }
    return host;
}

function setup(overrides = {}, dir = mkdtempSync(join(tmpdir(), 'projects-')), hostOptions = {}) {
    const host = fakeHost(hostOptions);
    const raw = {
        // Most tests count coordinator messages from zero; the welcome has its own tests.
        welcome: false,
        threadEffort: 'high',
        storeFile: join(dir, 'projects.json'),
        memoryDir: join(dir, 'memory'),
        logFile: join(dir, 'projects.log'),
        projects: [{ name: 'DSH Plugins', goal: 'Ship good DSH plugins', workspacePath: '/work/dsh', coordinatorEffort: 'max' }],
        ...overrides,
    };
    const config = plugin.Config(raw);
    plugin.apply(host, config);
    return { host, config, raw, dir };
}

/** Change live config the way DSH does when its settings page saves, then tell the plugin. */
function saveDefaults(host, config, values) {
    for (const [key, value] of Object.entries(values)) config[key][Symbol.for('cosmokit.volatile.write')](value);
    host.emit('loader/volatile-update', Object.keys(values).map((key) => [key]));
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const coordinatorOf = (host) => [...host.live.values()].find((a) => host.sessions.get(a.id).title === '◆ DSH Plugins');

// ── pure settings ───────────────────────────────────────────────────────────

test('settings resolve override → project → plugin → DSH default', () => {
    const s = effectiveSettings({ threadModel: 'a:x', threadEffort: 'low' }, { threadEffort: 'high' }, { threadEffort: 'max' });
    assert.deepEqual(s.threadModel, { value: 'a:x', source: 'plugin default' });
    assert.deepEqual(s.threadEffort, { value: 'max', source: 'project setting' });
    assert.deepEqual(s.coordinatorModel, { value: undefined, source: 'DSH default' });
    assert.equal(effectiveSettings({}, { coordinatorEffort: '  ' }).coordinatorEffort.source, 'DSH default');
    // DSH hands the plugin-wide defaults over as live references; tests and older hosts as plain strings.
    assert.deepEqual(pluginDefaults({ threadEffort: 'high', coordinatorEffort: { get: () => 'max' }, threadModel: { get: () => undefined } }),
        { coordinatorModel: undefined, coordinatorEffort: 'max', threadModel: undefined, threadEffort: 'high' });
    const parsed = plugin.Config({ threadEffort: 'low' });
    assert.equal(pluginDefaults(parsed).threadEffort, 'low');
    assert.equal(pluginDefaults(parsed).coordinatorEffort, undefined);
});

test('model specs and route rewriting', () => {
    assert.deepEqual(parseModelSpec('deepseek:deepseek-v4', 'x'), { provider: 'deepseek', model: 'deepseek-v4' });
    assert.deepEqual(parseModelSpec('other/big-model', 'x'), { provider: 'other', model: 'big-model' });
    assert.deepEqual(parseModelSpec('bare', 'deepseek'), { provider: 'deepseek', model: 'bare' });
    const base = { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high', maxTokens: 9 };
    assert.deepEqual(applyRoute(base, undefined, undefined), base);
    assert.deepEqual(applyRoute(base, 'other:big-model', 'max'), { ...base, provider: 'other', model: 'big-model', reasoningEffort: 'max' });
    // A new model without an effort runs at that model's own default effort.
    assert.deepEqual(applyRoute(base, 'deepseek-v4-flash', undefined), { provider: 'deepseek', model: 'deepseek-v4-flash', maxTokens: 9 });
    assert.deepEqual(applyRoute(base, undefined, 'low'), { ...base, reasoningEffort: 'low' });
});

test('selection is checked against the host catalog', () => {
    assert.deepEqual(checkSelection(CATALOG, 'deepseek-v4-flash', 'high'), { ok: true, model: 'deepseek:deepseek-v4-flash', effort: 'high' });
    assert.match(checkSelection(CATALOG, 'deepseek-v4-flash', 'max').error, /not offered.*off, high/);
    assert.match(checkSelection(CATALOG, 'nope', undefined).error, /unknown model "nope"/);
    assert.deepEqual(checkSelection(CATALOG, undefined, 'max'), { ok: true, effort: 'max' });
    assert.match(checkSelection(CATALOG, undefined, 'medium').error, /not offered by deepseek:deepseek-v4/);
    // A model without effort levels drops the effort and says so.
    assert.deepEqual(checkSelection(CATALOG, 'other:big-model', 'max'), { ok: true, model: 'other:big-model', note: 'other:big-model has no effort levels, so effort "max" is not used' });
    assert.deepEqual(checkSelection(undefined, 'x:y', 'z'), { ok: true, model: 'x:y', effort: 'z' });
    assert.equal(slugify('DSH Plugins!'), 'dsh-plugins');
    assert.equal(slugify('Café Ops'), 'cafe-ops');
    // Names in other scripts keep their letters, so two of them do not collide.
    assert.equal(slugify('前端'), '前端');
    assert.notEqual(slugify('前端'), slugify('后端'));
    assert.equal(slugify('!!!'), 'project');
});

test('config: required fields and defaults', () => {
    const c = plugin.Config({});
    assert.equal(c.enabled, true);
    assert.equal(c.autoHandback, 'idle');
    assert.equal(c.welcome, true);
    assert.deepEqual(c.projects, []);
    assert.throws(() => plugin.Config({ projects: [{ name: 'x' }] }), /workspacePath/);
    assert.throws(() => plugin.Config({ autoHandback: 'always' }));
    assert.equal(plugin.name, 'projects');
    assert.ok(plugin.inject.includes('sessionController') && plugin.inject.includes('systemPrompt'));
});

// ── end to end on the fake host ─────────────────────────────────────────────

test('coordinator is created, titled and gets coordinator tools', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    assert.ok(coord, 'coordinator session exists');
    assert.equal(host.sessions.get(coord.id).cwd, 'ws:/work/dsh');
    assert.deepEqual([...coord.ctx.registered.keys()].sort(), [
        'project_memory', 'project_settings', 'project_thread_list', 'project_thread_read',
        'project_thread_send', 'project_thread_start', 'project_thread_update',
    ]);
    const text = coord.ctx.section();
    assert.match(text, /coordinator of the DSH project "DSH Plugins"/);
    assert.match(text, /Goal: Ship good DSH plugins/);
    assert.match(text, /Coordinator: DSH default model · effort max/);
    assert.match(text, /New threads: DSH default model · effort high/);
    // Coordinator requests run at effort max, model untouched.
    assert.deepEqual(await coord.ctx.request({ provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' }),
        { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'max' });
});

test('other sessions get nothing', async () => {
    const { host } = setup();
    await tick();
    host.sessions.set('plain', { events: [], prompts: [] });
    const agent = host.wake('plain');
    assert.equal(agent.ctx.registered.size, 0);
    assert.equal(agent.ctx.sections.size, 0);
});

test('thread start → brief → handback → coordinator turn', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    const out = await coord.ctx.call('project_thread_start', { title: 'Add CI', brief: 'Add a GitHub Actions workflow running npm test.' });
    assert.match(out, /^Started t1 "Add CI" \(DSH default model · effort high\)/);

    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const ts = host.sessions.get(thread.id);
    assert.equal(ts.title, 'DSH Plugins › Add CI');
    assert.equal(ts.prompts.length, 1);
    assert.equal(ts.prompts[0].mode, 'queue');
    assert.match(ts.prompts[0].text, /^\[Brief from the coordinator of "DSH Plugins" · you are thread t1, "Add CI"\]\n\nAdd a GitHub Actions/);
    assert.deepEqual([...thread.ctx.registered.keys()].sort(), ['project_handback', 'project_memory']);
    assert.match(thread.ctx.section(), /You are thread t1, "Add CI"/);
    assert.equal((await thread.ctx.request({ provider: 'deepseek', model: 'deepseek-v4' })).reasoningEffort, 'high');

    // The thread works, hands back, goes idle: one handback, no idle note.
    thread.ctx.emitStatus(thread, 'running');
    assert.equal(await thread.ctx.call('project_handback', { status: 'done', summary: 'CI added in .github/workflows/test.yml' }), 'Handback delivered to the coordinator.');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.match(cp[0].text, /^\[Handback from thread t1 · "Add CI" · status: done\]\n\nCI added/);
    assert.match(coord.ctx.section(), /t1 · "Add CI" · idle · last handback: done, "CI added/);

    // Schema-invalid input is rejected by dsh-tools before execute; ordinary failures come back as text.
    await assert.rejects(thread.ctx.call('project_handback', { status: 'finished', summary: 'x' }), { code: 'INVALID_ARGS' });
    assert.match(await thread.ctx.call('project_handback', { status: 'done', summary: '  ' }), /^Failed: summary is required/);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'X', brief: 'y', effort: 'medium' }), /^Failed: effort "medium" is not offered/);
    assert.match(await coord.ctx.call('project_thread_send', { thread: 't9', text: 'hi' }), /^Failed: no thread "t9".*threads: t1/);
});

test('idle without a handback sends the automatic note with the last reply', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Docs', brief: 'Write docs.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    host.sessions.get(thread.id).events.push({ seq: 1, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'I wrote half the docs.' }] } } });
    thread.ctx.emitStatus(thread, 'running');
    await thread.ctx.call('project_handback', { status: 'progress', summary: 'Halfway' });
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 2, 'progress handback plus idle note');
    assert.match(cp[1].text, /^\[Thread idle without a handback: t1 · "Docs"\]\n\nIts last reply:\n\nI wrote half the docs\./);
    assert.match(await coord.ctx.call('project_thread_read', { thread: 't1' }), /## assistant\nI wrote half the docs\./);
});

test('autoHandback off sends only explicit handbacks', async () => {
    const { host } = setup({ autoHandback: 'off' });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Quiet', brief: 'Work.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    thread.ctx.emitStatus(thread, 'running');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.equal(host.sessions.get(coord.id).prompts.length, 0);
});

test('settings: change, validate, reset to default, per-thread override', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    assert.match(await coord.ctx.call('project_settings', {}), /Coordinator: DSH default model · effort max \(DSH default \/ project config\)/);
    const changed = await coord.ctx.call('project_settings', { thread_model: 'deepseek-v4-flash', coordinator_effort: 'low' });
    assert.match(changed, /New threads: deepseek:deepseek-v4-flash · effort high \(project setting \/ plugin default\)/);
    assert.match(changed, /Coordinator: DSH default model · effort low/);
    assert.equal((await coord.ctx.request({ provider: 'deepseek', model: 'deepseek-v4' })).reasoningEffort, 'low');
    assert.match(await coord.ctx.call('project_settings', { thread_effort: 'max' }), /^Failed: effort "max" is not offered by deepseek:deepseek-v4-flash/);
    assert.match(await coord.ctx.call('project_settings', { coordinator_effort: 'default' }), /Coordinator: DSH default model · effort max \(DSH default \/ project config\)/);

    assert.match(await coord.ctx.call('project_thread_start', { title: 'Big', brief: 'Think hard.', model: 'other:big-model', effort: 'max' }),
        /^Started t1 "Big" \(other:big-model · effort default\)\. It will hand back when done\. Note: other:big-model has no effort levels/);
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    assert.deepEqual(await thread.ctx.request({ provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' }), { provider: 'other', model: 'big-model' });
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't1', model: 'default', effort: 'default' }), /route deepseek:deepseek-v4-flash · effort high/);
    assert.deepEqual(await thread.ctx.request({ provider: 'deepseek', model: 'deepseek-v4' }), { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' });
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't1', stop: true }), /t1: no turn was running\./);
    assert.equal(host.sessions.get(thread.id).cancelled, undefined);
    thread.ctx.emitStatus(thread, 'running');
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't1', resolved: true, stop: true }), /resolved; current turn stopped/);
    assert.equal(host.sessions.get(thread.id).cancelled, true);
    assert.match(await coord.ctx.call('project_thread_list', {}), /\(no threads yet\)\n\(1 resolved hidden\)/);
    assert.match(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'One more thing.' }), /Sent to t1 \(reopened\)/);
});

test('pause blocks threads and holds handbacks until resume', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Work', brief: 'Do it.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    assert.match(await coord.ctx.call('project_settings', { paused: true }), /Paused: yes/);
    assert.match(coord.ctx.section(), /PAUSED/);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'No', brief: 'x' }), /^Failed: the project is paused/);
    assert.match(await thread.ctx.call('project_handback', { status: 'done', summary: 'Finished.' }), /saved; the coordinator gets it when the project resumes/);
    assert.equal(host.sessions.get(coord.id).prompts.length, 0);
    assert.match(await coord.ctx.call('project_settings', { paused: false }), /Paused: no \(delivered 1 held handbacks\)/);
    assert.match(host.sessions.get(coord.id).prompts[0].text, /status: done\]\n\nFinished\./);
});

test('handback rate cap', async () => {
    const { host } = setup({ maxHandbacksPerHour: 2 });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Loop', brief: 'x' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    await thread.ctx.call('project_handback', { status: 'progress', summary: 'a' });
    await thread.ctx.call('project_handback', { status: 'progress', summary: 'b' });
    assert.match(await thread.ctx.call('project_handback', { status: 'done', summary: 'c' }), /^Failed: handback limit reached \(2 per hour\)/);
});

test('thread start cap stops a coordinator that keeps starting threads', async () => {
    const { host, dir } = setup({ maxThreadsPerHour: 2 });
    await tick();
    const coord = coordinatorOf(host);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'One', brief: 'x' }), /^Started t1/);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'Two', brief: 'x' }), /^Started t2/);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'Three', brief: 'x' }), /^Failed: thread limit reached: this project started 2 threads in the last hour/);
    assert.equal(host.sessions.size, 3, 'coordinator plus two threads');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /thread-limit dsh-plugins 2/);
    // Sending to an existing thread still works.
    assert.match(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Carry on.' }), /^Sent to t1/);
});

test('memory is shared and shown in both policies', async () => {
    const { host, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    assert.equal(await coord.ctx.call('project_memory', { action: 'read' }), '(project memory is empty)');
    await coord.ctx.call('project_memory', { action: 'append', text: '- Node 22 everywhere.' });
    await coord.ctx.call('project_thread_start', { title: 'T', brief: 'x' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    await thread.ctx.call('project_memory', { action: 'append', text: '- CI runs npm test.' });
    assert.equal(readFileSync(join(dir, 'memory', 'dsh-plugins.md'), 'utf8'), '- Node 22 everywhere.\n- CI runs npm test.\n');
    assert.match(coord.ctx.section(), /## Project memory \(excerpt\)\n- Node 22 everywhere\.\n- CI runs npm test\./);
    assert.match(thread.ctx.section(), /- CI runs npm test\./);
    assert.match(await coord.ctx.call('project_memory', { action: 'replace', text: 'x'.repeat(70000) }), /^Failed: memory would exceed/);
    // An empty replace would erase everything, so it is refused.
    assert.match(await coord.ctx.call('project_memory', { action: 'replace' }), /^Failed: text is required/);
    assert.match(await coord.ctx.call('project_memory', { action: 'replace', text: '  ' }), /^Failed: text is required/);
    assert.equal(readFileSync(join(dir, 'memory', 'dsh-plugins.md'), 'utf8'), '- Node 22 everywhere.\n- CI runs npm test.\n');
});

test('restart: same coordinator, threads re-attach on resume', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const coord = coordinatorOf(first.host);
    await coord.ctx.call('project_thread_start', { title: 'Survivor', brief: 'x' });
    const threadId = [...first.host.live.keys()].find((id) => id !== coord.id);

    // A new host process over the same sessions and store.
    const host = fakeHost();
    for (const [id, s] of first.host.sessions) host.sessions.set(id, s);
    plugin.apply(host, first.config);
    await tick();
    assert.equal(host.sessions.size, 2, 'no new coordinator was created');
    const thread = host.wake(threadId);
    assert.ok(thread.ctx.registered.has('project_handback'));
    assert.match(thread.ctx.section(), /thread t1, "Survivor"/);

    // Disposal unwinds scoped registrations.
    for (const dispose of host.effects) await dispose();
    assert.equal(thread.ctx.registered.size, 0);
    assert.equal(thread.ctx.sections.size, 0);
});

test('a deleted coordinator is recreated on load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const host = fakeHost();
    plugin.apply(host, first.config); // no sessions carried over
    await tick();
    assert.ok(coordinatorOf(host));
});

// ── a Host with per-session model selection (real DSH) ─────────────────────

const SELECTING = { selection: true };

test('override mode stays outermost over the Host selection listener', async () => {
    const { host } = setup({}, undefined, { hostListener: true });
    await tick();
    const coord = coordinatorOf(host);
    assert.deepEqual(await coord.ctx.request({ provider: 'x', model: 'y' }), { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'max' });
});

test('session mode: coordinator and threads get DSH model selections, not request rewrites', async () => {
    const { host } = setup({}, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    assert.deepEqual(host.selections, [{ sessionId: coord.id, selection: { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'max' }, promptsBefore: 0 }]);
    // Only the Host's own listener rewrites requests.
    assert.equal(coord.ctx.listeners.get('agent/request').length, 1);

    // A thread is selected before its brief arrives.
    assert.match(await coord.ctx.call('project_thread_start', { title: 'Fast', brief: 'Go.', model: 'deepseek-v4-flash' }), /^Started t1 "Fast" \(deepseek:deepseek-v4-flash · effort high\)\. It will hand back when done\.$/);
    const t1 = [...host.live.values()].find((a) => a.id !== coord.id);
    assert.deepEqual(host.selections[1], { sessionId: t1.id, selection: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' }, promptsBefore: 0 });

    // A model without effort levels: the default effort is dropped with a note.
    assert.match(await coord.ctx.call('project_thread_start', { title: 'Big', brief: 'Go.', model: 'big-model' }), /\(other:big-model · effort default\).*Note: other:big-model has no effort levels, so effort "high" is not used\.$/);
    assert.deepEqual(host.selections[2].selection, { provider: 'other', model: 'big-model' });

    // project_thread_update re-selects the thread.
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't1', effort: 'off' }), /route deepseek:deepseek-v4-flash · effort off from the next request/);
    assert.deepEqual(host.selections[3], { sessionId: t1.id, selection: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'off' }, promptsBefore: 1 });
    await coord.ctx.call('project_thread_update', { thread: 't1', title: 'Renamed' });
    assert.equal(host.selections.length, 4, 'a rename selects nothing');
});

test('session mode: coordinator settings re-select only on change, and "default" restores it', async () => {
    const { host } = setup({}, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    const efforts = () => host.selections.filter((s) => s.sessionId === coord.id).map((s) => s.selection.reasoningEffort);
    assert.deepEqual(efforts(), ['max']);
    await coord.ctx.call('project_settings', { coordinator_effort: 'low' });
    await coord.ctx.call('project_settings', { coordinator_effort: 'low' });
    await coord.ctx.call('project_settings', { thread_effort: 'max' });
    assert.deepEqual(efforts(), ['max', 'low'], 'no selection when nothing about the coordinator changed');
    await coord.ctx.call('project_settings', { coordinator_effort: 'default' });
    assert.deepEqual(efforts(), ['max', 'low', 'max']);
});

test('session mode: a project on DSH defaults selects nothing until a setting is made', async () => {
    const { host } = setup({ threadEffort: '', projects: [{ name: 'DSH Plugins', workspacePath: '/work/dsh' }] }, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Plain', brief: 'Go.' });
    assert.deepEqual(host.selections, []);
    await coord.ctx.call('project_settings', { coordinator_model: 'deepseek-v4-flash' });
    assert.deepEqual(host.selections.map((s) => s.selection), [{ provider: 'deepseek', model: 'deepseek-v4-flash' }]);
    // Back to the DSH default selection, with the adapter's default effort filled in.
    await coord.ctx.call('project_settings', { coordinator_model: 'default' });
    assert.deepEqual(host.selections.at(-1).selection, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' });
});

test('session mode: restart keeps the coordinator selection; a changed profile re-selects it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir, SELECTING);
    await tick();
    assert.equal(first.host.selections.length, 1);

    const again = fakeHost(SELECTING);
    for (const [id, s] of first.host.sessions) again.sessions.set(id, s);
    plugin.apply(again, first.config);
    await tick();
    assert.equal(again.selections.length, 0, 'unchanged settings: the session keeps its selection');

    const changed = fakeHost(SELECTING);
    for (const [id, s] of first.host.sessions) changed.sessions.set(id, s);
    plugin.apply(changed, plugin.Config({ ...first.raw, projects: [{ ...first.raw.projects[0], coordinatorEffort: 'low' }] }));
    await tick();
    assert.deepEqual(changed.selections.map((s) => s.selection.reasoningEffort), ['low']);
});

test('defaults form: a saved default switches the coordinator and new threads, and replaces a coordinator change', async () => {
    const SELECTING = { selection: true };
    const { host, config, dir } = setup({ coordinatorEffort: 'high', projects: [{ name: 'DSH Plugins', workspacePath: '/work/dsh' }] }, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    const efforts = () => host.selections.filter((s) => s.sessionId === coord.id).map((s) => s.selection.reasoningEffort);
    assert.deepEqual(efforts(), ['high']);
    // The user asked the coordinator for max-effort threads in this project.
    await coord.ctx.call('project_settings', { thread_effort: 'max' });
    assert.match(await coord.ctx.call('project_settings', {}), /New threads: DSH default model · effort max \(DSH default \/ project setting\)/);

    // Then saved new defaults on the plugin's page.
    saveDefaults(host, config, { coordinatorEffort: 'max', threadEffort: 'off' });
    await tick();
    assert.deepEqual(efforts(), ['high', 'max'], 'the coordinator switches from its next request');
    assert.match(await coord.ctx.call('project_settings', {}), /New threads: DSH default model · effort off \(DSH default \/ plugin default\)/);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'After', brief: 'Go.' }), /Started t1/);
    const t1 = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'DSH Plugins › After');
    assert.equal(host.selections.find((s) => s.sessionId === t1.id).selection.reasoningEffort, 'off');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /defaults dsh-plugins coordinatorEffort,threadEffort replaced threadEffort/);

    // A save that changes nothing the plugin uses re-selects nothing; an empty default is an unset one.
    saveDefaults(host, config, { coordinatorEffort: 'max' });
    saveDefaults(host, config, { coordinatorModel: ' ' });
    await tick();
    assert.deepEqual(efforts(), ['high', 'max']);
    assert.equal(readFileSync(join(dir, 'projects.log'), 'utf8').match(/ defaults /g).length, 1);
});

test('defaults form: a default changed while DSH was stopped replaces the coordinator change at the next start', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const coordId = coordinatorOf(first.host).id;
    assert.match(await coordinatorOf(first.host).ctx.call('project_settings', { thread_effort: 'off', coordinator_effort: 'low' }), /New threads: DSH default model · effort off/);
    const restart = async (raw) => {
        const host = fakeHost();
        for (const [id, s] of first.host.sessions) host.sessions.set(id, s);
        plugin.apply(host, plugin.Config(raw));
        await tick();
        return host.wake(coordId);
    };
    // Restarted with the same defaults: the coordinator's changes stand.
    assert.match(await (await restart(first.raw)).ctx.call('project_settings', {}), /effort low \(DSH default \/ project setting\)\nNew threads: DSH default model · effort off \(DSH default \/ project setting\)/);
    // Restarted after the thread effort default changed: that change is replaced, the coordinator's own stands.
    assert.match(await (await restart({ ...first.raw, threadEffort: 'max' })).ctx.call('project_settings', {}),
        /effort low \(DSH default \/ project setting\)\nNew threads: DSH default model · effort max \(DSH default \/ plugin default\)/);
});

/**
 * Load the browser half the way DSH does: a classic script that hands its
 * factory to the module loader, which calls it with DSH's module require.
 */
function loadClient() {
    let loaded;
    runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), { window: { __ModuleLoader__: { load: (m) => { loaded = m; } } } });
    const ui = {
        SettingsFormModel: class {
            constructor(scope) { this.scope = scope; }
            bind(project) { return { getSnapshot: project, subscribe: () => () => {} }; }
            shell() { return { available: this.scope.getSnapshot().status === 'ready', writable: true, dirty: false, invalid: false, saving: false, failed: false }; }
            field(name) { return { text: this.scope.getSnapshot().value?.[name] ?? '', overridden: false, invalid: false }; }
            actions() { return {}; }
            dispose() {}
        },
        settingsTextField: (field) => ({ field }),
    };
    const modules = { react: { createElement: (type, props, ...children) => ({ type, props, children }) }, '@deepseek-ai/dsh-client-ui-primitives': ui };
    return { id: loaded.id, client: loaded.factory((name) => modules[name]) };
}

test('browser half: the defaults form registers on the plugin page, read-only when the profile adds the row twice', () => {
    const { id, client } = loadClient();
    assert.equal(id, 'dsh-plugin-projects');
    // Values made inside the script's context: copy them before comparing.
    assert.deepEqual([...client.inject], ['slots', 'configForms', 'remote', 'remote.session']);
    let snapshot = { status: 'ready', value: { coordinatorEffort: 'max' }, base: {}, user: { coordinatorEffort: 'max' }, writable: true, revision: 1 };
    const registered = [];
    client.apply({
        effect: (fn) => fn(),
        configForms: {
            get: (ns) => (assert.equal(ns, 'projects'), { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true }),
            whileServed: (names, fn) => (assert.deepEqual([...names], ['projects']), fn()),
        },
        slots: {
            inject: (_name, fn) => fn(),
            register: (slot, component) => { registered.push({ slot, component }); return () => {}; },
        },
    });
    assert.deepEqual(registered.map((r) => ({ ...r.slot })), [{ name: 'plugins.bundle.config', key: 'dsh-plugin-projects' }]);
    const page = registered[0].component;
    assert.match(page({ view: 'summary' }), /^Default models/);
    const form = page({ view: 'page' }).props.form;
    assert.equal(form.getSnapshot().coordinatorEffort.text, 'max');
    assert.equal(form.getSnapshot().insertedTwice, false);
    // The older setup adds the row with insert: the value the plugin runs with comes from neither layer a save edits.
    snapshot = { ...snapshot, user: {} };
    assert.equal(form.getSnapshot().insertedTwice, true);
    snapshot = { ...snapshot, base: { coordinatorEffort: 'max' } };
    assert.equal(form.getSnapshot().insertedTwice, false);
    snapshot = { status: 'loading', value: undefined, base: undefined, user: undefined, writable: true, revision: undefined };
    assert.equal(form.getSnapshot().insertedTwice, false);
});

test('session mode: a failed selection is reported, and the coordinator retries later', async () => {
    const { host, dir } = setup({}, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    host.services.llm = { async resolveCallConfig() { throw new Error('provider offline'); } };
    assert.match(await coord.ctx.call('project_thread_start', { title: 'T', brief: 'Go.' }), /Note: the model could not be set, so the thread runs on the DSH default/);
    assert.match(await coord.ctx.call('project_settings', { coordinator_effort: 'low' }), /The coordinator model could not be switched/);
    host.services.llm = fakeLlm;
    await coord.ctx.call('project_settings', { thread_effort: 'max' });
    assert.deepEqual(host.selections.filter((s) => s.sessionId === coord.id).map((s) => s.selection.reasoningEffort), ['max', 'low'], 'the next settings call retries the coordinator');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /error select dsh-plugins\/t1 provider offline/);
});

// ── turns the user drives in a thread ──────────────────────────────────────

const userSays = (host, sessionId, text, kind = 'user') => {
    const s = host.sessions.get(sessionId);
    s.events.push({ seq: s.events.length + 1, type: 'user/message', data: { content: [{ type: 'text', text }], source: { kind, rpcId: kind === 'user' ? 'gui-1' : undefined } } });
};
const assistantSays = (host, sessionId, text) => {
    const s = host.sessions.get(sessionId);
    s.events.push({ seq: s.events.length + 1, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text }] } } });
};

test('a turn the user drives in a thread does not wake the coordinator', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Chat', brief: 'Help the user.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);

    // The user talks to the thread in its own session; the Host adds its runtime context.
    userSays(host, thread.id, 'What does this function do?');
    userSays(host, thread.id, 'Current runtime context. ...', 'runtime-context');
    assistantSays(host, thread.id, 'It parses the config.');
    thread.ctx.emitStatus(thread, 'running');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.equal(host.sessions.get(coord.id).prompts.length, 0, 'no idle note for a direct turn');
    assert.match(coord.ctx.section(), /t1 · "Chat" · idle · no handback yet · the user talked to it directly; its reply: "It parses the config\."/);

    // A turn the coordinator starts still gets the note when it ends without a handback.
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Also check the tests.' });
    userSays(host, thread.id, '[model changed: ...]', 'model-selection');
    assistantSays(host, thread.id, 'Tests pass.');
    thread.ctx.emitStatus(thread, 'running');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.match(cp[0].text, /^\[Thread idle without a handback: t1 · "Chat"\]\n\nIts last reply:\n\nTests pass\./);

    // project_thread_read shows prompts and replies, not injected context.
    const read = await coord.ctx.call('project_thread_read', { thread: 't1', count: 10 });
    assert.match(read, /## user\nWhat does this function do\?/);
    assert.doesNotMatch(read, /runtime context|model changed/);
});

// ── failed turns and permission prompts ────────────────────────────────────

test('the idle note says when a thread turn failed', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Flaky', brief: 'Call the lane.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const ts = host.sessions.get(thread.id);
    ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'provider unavailable', code: 'NETWORK' } } } });
    thread.ctx.emitStatus(thread, 'running');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.match(host.sessions.get(coord.id).prompts[0].text, /^\[Thread idle without a handback: t1 · "Flaky"\]\n\nThe turn failed: provider unavailable\n\nIt produced no reply text\./);
});

test('a stop the coordinator asks for does not come back as a note', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Long', brief: 'Run the long job.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const ts = host.sessions.get(thread.id);
    const endTurn = (kind) => ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: 1, reason: { kind } } });

    thread.ctx.emitStatus(thread, 'running');
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't1', stop: true }), /current turn stopped/);
    assert.equal(ts.cancelled, true);
    endTurn('aborted');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.equal(host.sessions.get(coord.id).prompts.length, 0, 'no note for its own stop');

    // A stop from anywhere else (the user, in the thread's session) is still reported.
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Try again.' });
    thread.ctx.emitStatus(thread, 'running');
    endTurn('aborted');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.match(cp[0].text, /^\[Thread idle without a handback: t1 · "Long"\]\n\nThe turn was stopped before it finished\./);
});

test('a permission prompt left unanswered tells the coordinator', async () => {
    const { host } = setup({ approvalNoticeSeconds: 0.02 });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Deploy', brief: 'Deploy the site.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const wait = () => new Promise((r) => setTimeout(r, 60));

    // Answered quickly: nothing to report.
    thread.ctx.sessionEvent({ type: 'approval/asked', data: { id: 'a1', toolName: 'bash', reason: 'runs rm -rf build' } });
    thread.ctx.sessionEvent({ type: 'approval/decided', data: { id: 'a1', outcome: 'allowed-once' } });
    await wait();
    assert.equal(host.sessions.get(coord.id).prompts.length, 0);

    // Left waiting: the coordinator hears which thread and what it wants.
    thread.ctx.sessionEvent({ type: 'approval/asked', data: { id: 'a2', toolName: 'bash', reason: 'runs ./deploy.sh' } });
    await wait();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.equal(cp[0].text, '[Thread waiting for approval: t1 · "Deploy"]\n\nIt asked to use bash: runs ./deploy.sh\n\nThe user approves or rejects it in the "DSH Plugins › Deploy" session.');

    // The user is in the thread directly: the prompt is in front of them.
    userSays(host, thread.id, 'Go ahead and deploy.');
    thread.ctx.sessionEvent({ type: 'approval/asked', data: { id: 'a3', toolName: 'bash' } });
    await wait();
    assert.equal(cp.length, 1);
});

test('permission prompt notices stop with the plugin and can be turned off', async () => {
    for (const [seconds, unload] of [[0.02, true], [0, false]]) {
        const { host } = setup({ approvalNoticeSeconds: seconds });
        await tick();
        const coord = coordinatorOf(host);
        await coord.ctx.call('project_thread_start', { title: 'Quiet', brief: 'Work.' });
        const thread = [...host.live.values()].find((a) => a.id !== coord.id);
        thread.ctx.sessionEvent({ type: 'approval/asked', data: { id: 'b1', toolName: 'bash' } });
        if (unload) for (const dispose of host.effects) await dispose();
        await new Promise((r) => setTimeout(r, 60));
        assert.equal(host.sessions.get(coord.id).prompts.length, 0);
    }
    assert.throws(() => setup({ approvalNoticeSeconds: -1 }), /approvalNoticeSeconds/);
});

// ── turns DSH runs back to back, and turns the plugin did not see end ──────

/** Mark turns in a session log the way DSH does. */
const turnMarks = (host, sessionId) => {
    const log = host.sessions.get(sessionId).events;
    const push = (type, data) => log.push({ seq: log.length + 1, type, data });
    return {
        start: () => push('turn/start', {}),
        end: (kind = 'completed', message) => push('turn/end', { reason: { kind, ...(message ? { error: { message } } : {}) } }),
    };
};
const threadOf = (host, coord) => [...host.live.values()].find((a) => a.id !== coord.id);
/** Dispose the plugin and apply it again, as cordis does when its config is saved. */
async function reload(host, config) {
    for (const dispose of host.effects.splice(0)) await dispose();
    plugin.apply(host, config);
}
/** A new host process over the same session logs and store. */
function restart(sessions, config) {
    const host = fakeHost();
    for (const [id, s] of sessions) host.sessions.set(id, { ...s, prompts: [] });
    plugin.apply(host, config);
    return host;
}

test('a queued coordinator message that fails after a handback still gets its note', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Two', brief: 'Do A.' });
    const thread = threadOf(host, coord);
    const turn = turnMarks(host, thread.id);

    // Turn A hands back. The coordinator queues B meanwhile; DSH runs B next without going idle.
    thread.ctx.emitStatus(thread, 'running');
    turn.start();
    await thread.ctx.call('project_handback', { status: 'done', summary: 'A is done.' });
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Now do B.' });
    turn.end();
    turn.start();
    turn.end('error', 'provider unavailable');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 2, 'the handback, then a note for B');
    assert.match(cp[0].text, /status: done\]\n\nA is done\./);
    assert.match(cp[1].text, /^\[Thread idle without a handback: t1 · "Two"\]\n\nThe turn failed: provider unavailable/);

    // A last turn that hands back sends no note, even after one that did not.
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'And C.' });
    thread.ctx.emitStatus(thread, 'running');
    turn.start();
    turn.end();
    turn.start();
    await thread.ctx.call('project_handback', { status: 'done', summary: 'C is done.' });
    turn.end();
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.equal(cp.length, 3);
    assert.match(cp[2].text, /C is done\./);
});

test('a new coordinator introduces itself once, so DSH lists it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({ welcome: true }, dir);
    await tick();
    const coord = coordinatorOf(first.host);
    assert.deepEqual(first.host.sessions.get(coord.id).prompts, [
        { mode: 'queue', text: '[Project created: "DSH Plugins"]\n\nThis is the first message in this coordinator session.' },
    ]);
    assert.match(coord.ctx.section(), /A message starting with "\[Project created" is automatic/);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), new RegExp(`welcome dsh-plugins ${coord.id} delivered`));
    const second = restart(first.host.sessions, first.config);
    await tick();
    assert.equal(second.sessions.get(coord.id).prompts.length, 0, 'welcomed once');
});

test('a coordinator from before the welcome gets it only if it never had a turn', async () => {
    // Never used: DSH still hides it, so the next start welcomes it.
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const coord = coordinatorOf(first.host);
    const second = restart(first.host.sessions, plugin.Config({ ...first.raw, welcome: true }));
    await tick();
    assert.match(second.sessions.get(coord.id).prompts[0]?.text ?? '', /^\[Project created: "DSH Plugins"\]/);

    // Used already: DSH lists it, so it gets nothing, and later starts don't read its log again.
    const usedDir = mkdtempSync(join(tmpdir(), 'projects-'));
    const used = setup({}, usedDir);
    await tick();
    const usedCoord = coordinatorOf(used.host);
    turnMarks(used.host, usedCoord.id).start();
    turnMarks(used.host, usedCoord.id).end();
    const again = restart(used.host.sessions, plugin.Config({ ...used.raw, welcome: true }));
    await tick();
    assert.equal(again.sessions.get(usedCoord.id).prompts.length, 0);
    assert.equal(JSON.parse(readFileSync(join(usedDir, 'projects.json'), 'utf8')).projects['dsh-plugins'].welcomedSession, usedCoord.id);

    // A failed log read skips the welcome for now and doesn't stop the start.
    const flakyDir = mkdtempSync(join(tmpdir(), 'projects-'));
    const flaky = setup({}, flakyDir);
    await tick();
    const flakyCoord = coordinatorOf(flaky.host);
    const host = fakeHost();
    for (const [id, s] of flaky.host.sessions) host.sessions.set(id, { ...s, prompts: [] });
    const inspect = host.sessionController.inspect;
    let reads = 0;
    host.sessionController.inspect = async (id, signal) => {
        if (id === flakyCoord.id && reads++ === 1) throw new Error('read timed out');
        return inspect(id, signal);
    };
    plugin.apply(host, plugin.Config({ ...flaky.raw, welcome: true }));
    await tick();
    assert.equal(host.sessions.get(flakyCoord.id).prompts.length, 0);
    assert.match(readFileSync(join(flakyDir, 'projects.log'), 'utf8'), /error welcome dsh-plugins read timed out/);
    assert.equal(JSON.parse(readFileSync(join(flakyDir, 'projects.json'), 'utf8')).projects['dsh-plugins'].welcomedSession, undefined);
});

test('a thread turn cut off by a DSH stop is reported at the next start, once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const coord = coordinatorOf(first.host);
    await coord.ctx.call('project_thread_start', { title: 'Long', brief: 'Run the long job.' });
    const thread = threadOf(first.host, coord);
    thread.ctx.emitStatus(thread, 'running');
    turnMarks(first.host, thread.id).start();
    assistantSays(first.host, thread.id, 'Starting the job.');

    // DSH stops mid-turn; the next process reads the open turn as interrupted.
    const second = restart(first.host.sessions, first.config);
    await tick();
    const cp = second.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.equal(cp[0].text, '[Thread idle without a handback: t1 · "Long"]\n\nThe turn was cut off because DSH stopped while it ran.\n\nIts last reply:\n\nStarting the job.');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /idle-note dsh-plugins\/t1 chars=17 ended=interrupted/);

    const third = restart(first.host.sessions, first.config);
    await tick();
    assert.equal(third.sessions.get(coord.id).prompts.length, 0, 'reported once');
});

test('a config reload while a thread runs still reports its turn and its permission prompt', async () => {
    const { host, config } = setup({ approvalNoticeSeconds: 0.02 });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Busy', brief: 'Deploy it.' });
    const thread = threadOf(host, coord);
    thread.ctx.emitStatus(thread, 'running');
    const log = host.sessions.get(thread.id).events;
    const asked = { seq: log.length + 1, type: 'approval/asked', data: { id: 'a1', toolName: 'bash', reason: 'runs ./deploy.sh' } };
    log.push(asked);
    thread.ctx.sessionEvent(asked);

    await reload(host, config);
    await new Promise((r) => setTimeout(r, 80));
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1, 'the new plugin instance watches the prompt');
    assert.match(cp[0].text, /^\[Thread waiting for approval: t1 · "Busy"\]\n\nIt asked to use bash: runs \.\/deploy\.sh/);

    log.push({ seq: log.length + 1, type: 'approval/decided', data: { id: 'a1', outcome: 'rejected' } });
    assistantSays(host, thread.id, 'The deploy was rejected.');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.equal(cp.length, 2, 'and reports the turn when it ends');
    assert.match(cp[1].text, /^\[Thread idle without a handback: t1 · "Busy"\]\n\nIts last reply:\n\nThe deploy was rejected\./);
});

test('a turn that ends during a reload is reported by the new instance', async () => {
    const { host, config } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { title: 'Gap', brief: 'Work.' });
    const thread = threadOf(host, coord);
    thread.ctx.emitStatus(thread, 'running');
    for (const dispose of host.effects.splice(0)) await dispose();
    // The turn ends while no plugin instance listens.
    const turn = turnMarks(host, thread.id);
    turn.start();
    assistantSays(host, thread.id, 'Finished in the gap.');
    turn.end();
    thread.ctx.emitStatus(thread, 'idle');
    plugin.apply(host, config);
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.match(cp[0].text, /^\[Thread idle without a handback: t1 · "Gap"\]\n\nIts last reply:\n\nFinished in the gap\./);
});

test('a handback the coordinator cannot take is retried, in order', async () => {
    timing.retryMs = 20;
    try {
        const { host, dir } = setup();
        await tick();
        const coord = coordinatorOf(host);
        await coord.ctx.call('project_thread_start', { title: 'Retry', brief: 'x' });
        const thread = threadOf(host, coord);
        const prompt = host.sessionController.prompt;
        let refuse = true;
        host.sessionController.prompt = async (req) => {
            if (refuse && req.sessionId === coord.id) throw new Error('session/writer-held');
            return prompt(req);
        };
        const retrying = 'Handback saved; the coordinator could not take it just now, and it is sent again automatically.';
        assert.equal(await thread.ctx.call('project_handback', { status: 'progress', summary: 'First.' }), retrying);
        assert.equal(await thread.ctx.call('project_handback', { status: 'done', summary: 'Second.' }), retrying);
        refuse = false;
        await new Promise((r) => setTimeout(r, 100));
        const cp = host.sessions.get(coord.id).prompts.map((p) => p.text);
        assert.equal(cp.length, 2);
        assert.match(cp[0], /status: progress\]\n\nFirst\./);
        assert.match(cp[1], /status: done\]\n\nSecond\./);
        assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /error deliver dsh-plugins session\/writer-held/);
        // The handback counts, so going idle sends no extra note.
        thread.ctx.emitStatus(thread, 'running');
        thread.ctx.emitStatus(thread, 'idle');
        await tick();
        assert.equal(host.sessions.get(coord.id).prompts.length, 2);
    } finally {
        timing.retryMs = 60000;
    }
});

test('a thread started while the plugin reloads stays a project thread', async () => {
    const { host, config, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    // Hold session creation, so the reload lands in the middle of the start.
    const create = host.sessionController.create;
    let release;
    host.sessionController.create = (req) => new Promise((r) => { release = () => r(create(req)); });
    const started = coord.ctx.call('project_thread_start', { title: 'Mid', brief: 'x' });
    await tick();
    host.sessionController.create = create;
    await reload(host, config);
    await tick();
    release();
    assert.match(await started, /^Started t1 "Mid"/);
    const thread = threadOf(host, coord);
    assert.deepEqual([...thread.ctx.registered.keys()].sort(), ['project_handback', 'project_memory']);
    // A write by the new instance keeps the thread.
    await coord.ctx.call('project_settings', { thread_effort: 'max' });
    assert.ok(JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads.t1);
    assert.match(await coord.ctx.call('project_thread_list', {}), /t1 · "Mid"/);
});

test('a reload during startup makes one coordinator, not two', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const host = fakeHost();
    const config = plugin.Config({
        storeFile: join(dir, 'projects.json'), memoryDir: join(dir, 'memory'), logFile: join(dir, 'projects.log'),
        projects: [{ name: 'DSH Plugins', workspacePath: '/work/dsh' }],
    });
    plugin.apply(host, config);
    await reload(host, config);
    await tick();
    assert.equal([...host.sessions.values()].filter((s) => s.title === '◆ DSH Plugins').length, 1);
    assert.equal(host.sessions.size, 1);
});

test('a coordinator that cannot be read right now is not replaced', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const host = fakeHost();
    for (const [id, s] of first.host.sessions) host.sessions.set(id, s);
    host.inspectError = new Error('read timed out');
    plugin.apply(host, first.config);
    await tick();
    assert.equal(host.sessions.size, 1, 'no second coordinator');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /error coordinator dsh-plugins read timed out/);
});

test('empty optional arguments count as not given; thread ids are trimmed', async () => {
    const { host, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'E', brief: 'x', model: '', effort: '' }), /^Started t1 "E" \(DSH default model · effort high\)/);
    assert.match(await coord.ctx.call('project_thread_start', { title: 'D', brief: 'x', model: 'default', effort: 'default' }), /^Started t2 "D" \(DSH default model · effort high\)/);
    await coord.ctx.call('project_settings', { thread_model: 'deepseek-v4-flash' });
    assert.match(await coord.ctx.call('project_settings', { thread_model: '', coordinator_effort: ' ' }), /New threads: deepseek:deepseek-v4-flash · effort high \(project setting/);
    assert.match(await coord.ctx.call('project_thread_update', { thread: ' t1 ', model: '', effort: '', title: '' }), /^t1: nothing to change\.$/);
    assert.match(await coord.ctx.call('project_thread_send', { thread: ' t2 ', text: 'More.' }), /^Sent to t2\.$/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads), ['t1', 't2']);
});
