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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol';
import * as plugin from '../lib/index.js';
import { effectiveSettings, effectiveAccess, applyRoute, checkSelection, parseModelSpec, pluginDefaults } from '../lib/settings.js';
import { slugify, timing, clipTitle, guardList, guardedIn } from '../lib/projects.js';
import { changeRecord, withChange, changeTotals, changesLine, MAX_TURNS } from '../lib/changes.js';
import { describeEnding, endingStateOf, continueMessage, readableError, welcomeMessage, handbackSummary, handbackMessage, idleMessage, approvalMessage, cardSummary, threadMarkdown } from '../lib/prompts.js';
import { ProjectStore, dataPath, dshHome } from '../lib/store.js';
import { planFleetShellImport } from '../lib/fleet-shell.js';

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
    /** @param {object} [host] - the fake Host, whose tool names (host.toolNames) tools.restrict() knows. */
    constructor(host) {
        this.host = host;
        this.registered = new Map();
        /** Presentation meta of each tool result, in call order. */
        this.metas = [];
        this.sections = new Map();
        this.listeners = new Map();
        /** The deny lists of tools.restrict() in force, and the tools.guard() checks, as DSH keeps them for one agent. */
        this.restrictions = [];
        this.guards = [];
        const self = this;
        this.tools = {
            register(def) {
                assert.ok(!self.registered.has(def.name), `duplicate tool ${def.name}`);
                self.registered.set(def.name, def);
                return () => self.registered.delete(def.name);
            },
            /** Like DSH: a name it doesn't offer throws, and the disposer lifts this restriction alone. */
            restrict({ deny }) {
                const unknown = deny.filter((name) => !(host?.toolNames ?? []).includes(name));
                if (unknown.length > 0) throw new Error(`tools.restrict() names unknown global tools ${unknown.join(', ')}`);
                const entry = [...deny];
                self.restrictions.push(entry);
                return () => self.restrictions.splice(self.restrictions.indexOf(entry) >>> 0, 1);
            },
            guard(check) {
                self.guards.push(check);
                return () => self.guards.splice(self.guards.indexOf(check) >>> 0, 1);
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
    /** The Host's tools this agent's model is offered now: every one no restriction denies. */
    offered() {
        const denied = new Set(this.restrictions.flat());
        return (this.host?.toolNames ?? []).filter((name) => !denied.has(name));
    }
    /** What DSH's guards say before this agent calls a tool: the first refusal, or undefined. */
    refusal(name) {
        for (const check of this.guards) {
            const reason = check({ name, agent: this.agent });
            if (reason !== undefined) return reason;
        }
        return undefined;
    }
    /** Call a tool as the model would. Like DSH, the call and its result go into the session log. */
    async call(name, args) {
        const def = this.registered.get(name);
        assert.ok(def, `tool ${name} not registered (have ${[...this.registered.keys()].join(', ')})`);
        const log = this.log?.();
        const callId = `call-${++toolCalls}`;
        log?.push({ seq: log.length + 1, type: 'tool/call', data: { callId, name, arguments: args } });
        const value = await def.execute(args, { agent: this.agent, callId });
        // As DSH does: check the value against the output schema, render it for the model, and record the meta.
        assert.deepEqual(validateJsonSchemaValue(def.output.schema, value, 'value'), [], `${name} returned a value its schema refuses`);
        const text = def.output.render(args, value).map((block) => block.text).join('');
        const meta = def.output.presentationMeta?.(args, value);
        this.metas.push({ name, meta });
        log?.push({ seq: log.length + 1, type: 'tool/result', time: Date.now(), data: { message: { role: 'tool', toolCallId: callId, content: [{ type: 'text', text }] }, ...(meta === undefined ? {} : { meta }) } });
        return text;
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
 * DSH's workspace registry: one workspace per folder (id "ws:<path>"),
 * newest first, as DSH orders a new one. `add` is a folder DSH already has.
 */
function fakeWorkspaces(initial = []) {
    const spaces = new Map();
    const order = [];
    const add = (path, title = path.split('/').pop()) => {
        const id = `ws:${path}`;
        if (!spaces.has(id)) {
            spaces.set(id, { id, path, title });
            order.unshift(id);
        }
        return spaces.get(id);
    };
    // Listed in the order given.
    for (const path of [...initial].reverse()) add(path);
    return {
        add,
        async create(path) { return add(path); },
        async resolveByPath(path) { return spaces.get(`ws:${path}`); },
        get: (id) => spaces.get(id),
        list: () => order.map((id) => spaces.get(id)),
        delete(id) { spaces.delete(id); order.splice(order.indexOf(id), 1); },
    };
}

/**
 * DSH's permission presets: every session is on one, a new one on the
 * user's default. set() logs `permission/preset` on the session when it
 * changes, as DSH's own permission menu does; pick() is the user doing that.
 */
function fakePresets(sessions, live) {
    const options = [
        { value: 'read-only', name: 'Read Only', description: 'Read files; ask before edits and commands' },
        { value: 'workspace-write', name: 'Workspace Write', description: 'Edit files in the workspace; ask before going outside it' },
        { value: 'danger-full-access', name: 'Full access', description: 'No sandbox and no approvals' },
        { value: 'auto', name: 'Auto review' },
    ];
    const on = new Map();
    const pp = {
        names: ['read-only', 'workspace-write', 'danger-full-access'],
        defaultPreset: 'danger-full-access',
        /** Every set() call, with how many messages the session had then. */
        sets: [],
        /** Tests set it to make set() fail. */
        fail: false,
        catalog: () => ({ options: [...options, { value: 'custom', name: 'Custom' }], defaultOptions: options, defaultPreset: pp.defaultPreset }),
        current: (session) => on.get(session.id) ?? pp.defaultPreset,
        set(session, name) {
            if (!pp.names.includes(name)) throw new Error(`permission: unknown preset "${name}"`);
            if (pp.fail) throw new Error('permission: the session refused it');
            pp.sets.push({ sessionId: session.id, preset: name, promptsBefore: sessions.get(session.id)?.prompts.length });
            if (pp.current(session) === name) return;
            on.set(session.id, name);
            live.get(session.id)?.ctx.sessionEvent({ type: 'permission/preset', data: { preset: name } });
        },
        pick: (sessionId, name) => pp.set({ id: sessionId }, name),
    };
    return pp;
}

/**
 * A fake Host with sessionController, agents and workspaceRegistry.
 * `selection: true` adds the per-session model selection a real DSH Host has
 * (its own `agent/request` listener, installed before `agent/created`, plus
 * `sessionController.agents.selectForNextRequest`). `tools` names the
 * Host's tools (DSH's own and the MCP servers'), which a project may keep
 * from a session; `presets: true` adds DSH's permission presets.
 */
function fakeHost({ selection = false, hostListener = selection, gateway = false, workspaces = [], tools = [], presets = false } = {}) {
    const listeners = new Map();
    const effects = [];
    const sessions = new Map(); // id → {events, prompts, title, cwd}
    const live = new Map(); // id → agent
    let n = 0;
    const selections = []; // [{sessionId, selection}] in call order
    const projections = []; // definitions registered on ctx.sessionProjections
    const services = {
        agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4' }) },
        llm: fakeLlm,
        sessionProjections: { register(def) { projections.push(def); return () => projections.splice(projections.indexOf(def), 1); } },
        ...(gateway ? { typertGateway: {} } : {}),
        ...(presets ? { permissionPresets: fakePresets(sessions, live) } : {}),
    };
    /** Services the plugin provides (cordis `ctx.provide`), such as its window endpoints. */
    const provided = new Map();
    const host = {
        sessions, live, effects, selections, services, projections, provided,
        /** The Host's tool names; a test adds one and emits `tools/change`, as an MCP server connecting does. */
        toolNames: [...tools],
        /** DSH's tool registry as the plugin's context reads it: every tool a session could be offered. */
        tools: {
            view: () => ({ restrictableNames: new Set(host.toolNames) }),
            schemas: () => host.toolNames.map((name) => ({ name })),
        },
        logger: { info() {}, warn() {} },
        provide(name, value) { provided.set(name, value); },
        get: (name) => services[name],
        /** Like cordis: run the callback only when every named service is present. */
        inject(names, fn) {
            if (!names.every((name) => services[name])) return;
            fn(Object.assign(Object.create(host), Object.fromEntries(names.map((name) => [name, services[name]]))));
        },
        on(event, fn) {
            const list = listeners.get(event) ?? [];
            list.push(fn);
            listeners.set(event, list);
        },
        effect(fn) { effects.push(fn()); },
        emit(event, payload) { for (const fn of listeners.get(event) ?? []) fn(payload); },
        agents: { get: (id) => live.get(id), list: () => [...live.values()] },
        workspaceRegistry: fakeWorkspaces(workspaces),
        /**
         * Like DSH's agent inbox: a message is logged as a user message with
         * its source (the user's, an agent's or a plugin's). Tests replace it
         * to refuse a session.
         */
        accept(sessionId, mode, message) {
            const s = sessions.get(sessionId);
            s.prompts.push({ mode, text: message.content[0].text });
            s.events.push({ seq: s.events.length + 1, type: 'user/message', time: Date.now(), data: { ...message } });
        },
        wake(id) {
            if (live.has(id)) return live.get(id);
            const ctx = new FakeScope(host);
            const agent = {
                id, status: 'idle', ctx, session: { id },
                followup(message) { host.accept(id, 'queue', message); },
                steer(message) { host.accept(id, 'steer', message); },
            };
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
            /** What the window sends when the user types: logged as the user's, with its request id. */
            async prompt(req) {
                assert.ok(req.requestId && req.content[0].text);
                host.accept(req.sessionId, req.mode, { id: `m-${req.requestId}`, role: 'user', content: req.content, source: { kind: 'user', rpcId: req.requestId } });
                return { accepted: true };
            },
            async rename(req) { sessions.get(req.sessionId).title = req.title; return { title: req.title, seq: 1 }; },
            /** Like DSH's list: a summary per session, its title in the title projection. */
            async list() {
                if (host.listError) throw host.listError;
                return { items: [...sessions].map(([sessionId, s]) => ({ sessionId, updatedAt: 0, running: false, ...(s.title ? { projections: { kind: 'cached', asOfSeq: 1, values: { title: s.title } } } : {}) })) };
            },
            cancel(req) { sessions.get(req.sessionId).cancelled = true; return {}; },
            async modelCatalog() { return CATALOG; },
        },
    };
    if (selection) {
        host.sessionController.agents = {
            selectForNextRequest(agent, sel) {
                assert.equal(live.get(agent.id), agent, 'selection targets the live agent');
                selections.push({ sessionId: agent.id, selection: sel, promptsBefore: sessions.get(agent.id).prompts.length });
                // Like DSH: the selection is a session event, the same one a pick in DSH's own model picker appends.
                agent.ctx.sessionEvent({ type: 'model/selection', data: { ...sel } });
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
/** The source of the nth message a session was sent. */
const sourceOf = (session, n) => session.events.filter((e) => e.type === 'user/message')[n]?.data.source;
const coordinatorOf = (host) => [...host.live.values()].find((a) => host.sessions.get(a.id).title === '◆ DSH Plugins');
/** The user typing in a session's chat in the DSH window: logged as the user's own message. */
function userTyping(host) {
    let typed = 0;
    return (session, text) => host.sessionController.prompt({ sessionId: session.id, requestId: `typed-${++typed}`, content: [{ type: 'text', text }], mode: 'queue' });
}

// ── pure settings ───────────────────────────────────────────────────────────

test('settings resolve override → project → plugin → DSH default', () => {
    const s = effectiveSettings({ threadModel: 'a:x', threadEffort: 'low' }, { threadEffort: 'high' }, { threadEffort: 'max' });
    assert.deepEqual(s.threadModel, { value: 'a:x', source: 'plugin default' });
    assert.deepEqual(s.threadEffort, { value: 'max', source: 'project setting' });
    assert.deepEqual(s.coordinatorModel, { value: undefined, source: 'DSH default' });
    assert.equal(effectiveSettings({}, { coordinatorEffort: '  ' }).coordinatorEffort.source, 'DSH default');
    // DSH hands the plugin-wide defaults over as live references; tests and older hosts as plain strings.
    assert.deepEqual(pluginDefaults({ threadEffort: 'high', coordinatorEffort: { get: () => 'max' }, threadModel: { get: () => undefined }, yourTools: { get: () => 'always' } }), {
        coordinatorModel: undefined, coordinatorEffort: 'max', threadModel: undefined, threadEffort: 'high',
        yourTools: 'always', coordinatorPermission: undefined, threadPermission: undefined,
    });
    const parsed = plugin.Config({ threadEffort: 'low' });
    assert.equal(pluginDefaults(parsed).threadEffort, 'low');
    assert.equal(pluginDefaults(parsed).coordinatorEffort, undefined);
    // Access settings layer the same way, but their last layer is the plugin's own: your tools only when asked, the
    // coordinator on DSH's default permission and threads on Workspace Write.
    assert.deepEqual(effectiveAccess({}, {}, {}), {
        yourTools: { value: 'asked', source: 'plugin default' },
        coordinatorPermission: { value: 'default', source: 'plugin default' },
        threadPermission: { value: 'workspace-write', source: 'plugin default' },
    });
    // A word that is no mode is not a setting; a permission is checked against DSH's presets where it is used.
    const access = effectiveAccess({ yourTools: ' Always ', threadPermission: 'read-only' }, { yourTools: 'sometimes', coordinatorPermission: 'workspace-write' }, { threadPermission: 'danger-full-access' });
    assert.deepEqual(access.yourTools, { value: 'always', source: 'plugin default' });
    assert.deepEqual(access.coordinatorPermission, { value: 'workspace-write', source: 'project config' });
    assert.deepEqual(access.threadPermission, { value: 'danger-full-access', source: 'project setting' });
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
    assert.match(checkSelection(CATALOG, 'deepseek-v4-flash', 'low').error, /^effort "low" is not offered by deepseek:deepseek-v4-flash\. Choose one of: off, high$/);
    assert.match(checkSelection(CATALOG, undefined, 'medium').error, /^effort "medium" is not offered by any model\. Efforts in this DSH: off, low, high, max$/);
    // Fitting: the nearest level the model offers at or below the wanted one, with a note.
    assert.deepEqual(checkSelection(CATALOG, 'deepseek-v4-flash', 'max', { fit: 'known' }),
        { ok: true, model: 'deepseek:deepseek-v4-flash', effort: 'high', fitted: true, note: 'deepseek:deepseek-v4-flash doesn\'t offer effort "max", so it runs at "high"' });
    assert.equal(checkSelection(CATALOG, 'deepseek-v4-flash', 'low', { fit: true }).effort, 'off');
    assert.match(checkSelection(CATALOG, 'deepseek-v4-flash', 'ultra', { fit: 'known' }).error, /not offered by any model/);
    assert.deepEqual(checkSelection(CATALOG, 'deepseek-v4-flash', 'ultra', { fit: true }),
        { ok: true, model: 'deepseek:deepseek-v4-flash', fitted: true, note: 'effort "ultra" is not offered by any model, so deepseek:deepseek-v4-flash runs at its default effort' });
    assert.deepEqual(checkSelection(CATALOG, 'deepseek-v4-flash', 'high', { fit: true }), { ok: true, model: 'deepseek:deepseek-v4-flash', effort: 'high' });
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
    // Models and efforts are settings: the coordinator's prompt names none of them (project_settings shows them).
    assert.doesNotMatch(text, /## Settings|DSH default model|effort (max|high)/);
    assert.match(text, /\n9\. Only when the user asks: resolve a thread \(project_thread_update\) or change models, effort or pause \(project_settings; with no arguments it shows them\)\./);
    // Ten short numbered rules a weaker model can follow: the user's ask and nothing else, work it picks itself only in the
    // workspace, off the user's personal and infrastructure tools, one way to start a thread, and every thread named as a link.
    assert.deepEqual(text.match(/^\d+\. /gm), ['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ', '10. ']);
    assert.match(text, /\n1\. Do only what the user asks\. When they leave the choice of work to you, pick work that only reads and writes files in the workspace, and say what you picked\./);
    assert.match(text, /\n2\. Never use the user's personal or infrastructure tools, yourself or in a thread: password managers and vaults, note apps, email and messaging, home or household services, control of the user's screen, model lanes and gateways\. Only the user's own words \(a message, or the goal\) can call for one\./);
    assert.match(text, /\n3\. For work, start a thread with project_thread_start, not with DSH's subagent or workflow tools\. One thread per distinct ask; put the user's words in `ask`, word for word\./);
    assert.match(text, /\n4\. Name a thread to the user only as a link: \[Fix the login bug\]\(\.dsh-thread\/t3\) for thread t3\./);
    assert.match(text, /\n6\. Before you or a thread delete files, push, publish, send or post anything, spend money, or change settings outside the workspace, ask the user/);
    assert.match(text, /\n10\. Write to project_memory only decisions and preferences the user stated\./);
    assert.doesNotMatch(text, /home folder|Here those include|PAUSED/);
    assert.ok(text.length < 2400, `short enough for a weaker model: ${text.length} characters`);
    // Nor do the tools' descriptions name a provider's efforts.
    for (const [name, def] of coord.ctx.registered) assert.doesNotMatch(JSON.stringify([def.description, def.parameters]), /deepseek|off, low, high, max/i, name);
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
    const out = await coord.ctx.call('project_thread_start', { ask: 'Add CI that runs our tests.', title: 'Add CI', brief: 'Add a GitHub Actions workflow running npm test.' });
    assert.equal(out, 'Started t1 "Add CI". It reports back when done. Link it as [Add CI](.dsh-thread/t1).');

    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const ts = host.sessions.get(thread.id);
    // The session is titled by the thread alone: the list nests it under its ◆ coordinator.
    assert.equal(ts.title, 'Add CI');
    assert.equal(ts.prompts.length, 1);
    assert.equal(ts.prompts[0].mode, 'queue');
    // The user's own words come first, then the coordinator's brief.
    assert.match(ts.prompts[0].text, /^\[Brief from the coordinator of "DSH Plugins" · you are thread t1, "Add CI"\]\n\nThe user asked: "Add CI that runs our tests\."\n\nAdd a GitHub Actions/);
    // As DSH sends its own agents' messages, so DSH draws a notice, not a user bubble.
    assert.deepEqual(sourceOf(ts, 0), { kind: 'agent-message', form: 'relay', senderSessionId: coord.id });
    assert.deepEqual([...thread.ctx.registered.keys()].sort(), ['project_handback', 'project_memory']);
    assert.match(thread.ctx.section(), /You are thread t1, "Add CI"/);
    // A thread does the task and only the task, off the user's own tools, and hands back once, result first.
    assert.match(thread.ctx.section(), /\n1\. Do the task end to end, and only the task\./);
    assert.match(thread.ctx.section(), /\n2\. Do not use the user's personal or infrastructure tools \(password managers and vaults, note apps, .*\) unless the user's own words ask for it\./);
    assert.match(thread.ctx.section(), /\n3\. Editing files for your task is fine\. Before you delete files, push, publish/);
    assert.match(thread.ctx.section(), /\n4\. When you are done or stuck, call project_handback once, as your last step\..*shows 300 characters: the result first/);
    assert.match(thread.ctx.section(), /\n5\. After project_handback, end your turn with one short line\./);
    assert.doesNotMatch(thread.ctx.section(), /Here those include/, 'no guarded tools are configured');
    assert.equal((await thread.ctx.request({ provider: 'deepseek', model: 'deepseek-v4' })).reasoningEffort, 'high');

    // The thread works, hands back, goes idle: one handback, no idle note.
    thread.ctx.emitStatus(thread, 'running');
    assert.equal(await thread.ctx.call('project_handback', { status: 'done', summary: 'CI added in .github/workflows/test.yml' }), 'Handback delivered to the coordinator.');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.match(cp[0].text, /^\[Handback from thread t1 · "Add CI" · status: done\]\n\nCI added/);
    // Its last paragraph says how to answer, when the coordinator answers: now, the link first, then the result; and with no
    // other thread at work, a line that closes the user's ask.
    assert.match(cp[0].text, /\n\n\(The user has not seen this\. Reply now\. First line: the link \[Add CI\]\(\.dsh-thread\/t1\), a colon, and the result in one sentence\. Then at most two short lines\. No other thread is running: end with one line that answers what the user asked for\. Write "the thread reports" for anything you did not check yourself\. Full conversation: project_thread_read thread="t1"\.\)$/);
    assert.deepEqual(sourceOf(host.sessions.get(coord.id), 0), { kind: 'agent-message', form: 'relay', senderSessionId: thread.id }, 'a handback comes from its thread');
    assert.match(coord.ctx.section(), /t1 · "Add CI" · idle · last handback: done, "CI added/);
    // A coordinator's message to a thread comes from the coordinator too.
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Also cache npm.', steer: true }), 'Steered t1.');
    assert.deepEqual([ts.prompts[1].mode, sourceOf(ts, 1)], ['steer', { kind: 'agent-message', form: 'relay', senderSessionId: coord.id }]);

    // A follow-up that passes on the user's request carries their words too.
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Cache the npm folder.', ask: 'can it cache npm?' }), 'Sent to t1.');
    assert.equal(ts.prompts[2].text, '[From the coordinator]\n\nThe user asked: "can it cache npm?"\n\nCache the npm folder.');

    // Schema-invalid input is rejected by dsh-tools before execute; ordinary failures come back as text.
    await assert.rejects(thread.ctx.call('project_handback', { status: 'finished', summary: 'x' }), { code: 'INVALID_ARGS' });
    await assert.rejects(coord.ctx.call('project_thread_start', { title: 'X', brief: 'y' }), { code: 'INVALID_ARGS' }, 'a thread start needs the user\'s words');
    assert.match(await coord.ctx.call('project_thread_start', { ask: '  ', title: 'X', brief: 'y' }), /^Failed: ask is required: copy the user's words from their message/);
    assert.match(await thread.ctx.call('project_handback', { status: 'done', summary: '  ' }), /^Failed: summary is required/);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'X', brief: 'y', effort: 'medium' }), /^Failed: effort "medium" is not offered/);
    assert.match(await coord.ctx.call('project_thread_send', { thread: 't9', text: 'hi' }), /^Failed: no thread "t9".*threads: t1/);
});

test('idle without a handback sends the automatic note with the last reply', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Docs', brief: 'Write docs.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    host.sessions.get(thread.id).events.push({ seq: 1, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'I wrote half the docs.' }] } } });
    thread.ctx.emitStatus(thread, 'running');
    await thread.ctx.call('project_handback', { status: 'progress', summary: 'Halfway' });
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 2, 'progress handback plus idle note');
    assert.match(cp[1].text, /^\[Thread idle without a handback: t1 · "Docs"\]\n\nIts last reply:\n\nI wrote half the docs\./);
    // The plugin's own note, which DSH draws as "Plugin status updated".
    assert.deepEqual(sourceOf(host.sessions.get(coord.id), 1), { kind: 'cordis-host-runner' });
    assert.match(await coord.ctx.call('project_thread_read', { thread: 't1' }), /## assistant\nI wrote half the docs\./);
});

test('autoHandback off sends only explicit handbacks', async () => {
    const { host } = setup({ autoHandback: 'off' });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Quiet', brief: 'Work.' });
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

    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Big', brief: 'Think hard.', model: 'other:big-model', effort: 'max' }),
        /^Started t1 "Big"\. It reports back when done\. It runs on other:big-model · effort default\. Note: other:big-model has no effort levels/);
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Work', brief: 'Do it.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    assert.match(await coord.ctx.call('project_settings', { paused: true }), /Paused: yes/);
    assert.match(coord.ctx.section(), /PAUSED/);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'No', brief: 'x' }), /^Failed: the project is paused/);
    assert.match(await thread.ctx.call('project_handback', { status: 'done', summary: 'Finished.' }), /saved; the coordinator gets it when the project resumes/);
    assert.equal(host.sessions.get(coord.id).prompts.length, 0);
    assert.match(await coord.ctx.call('project_settings', { paused: false }), /Paused: no \(delivered 1 held handbacks\)/);
    assert.match(host.sessions.get(coord.id).prompts[0].text, /status: done\]\n\nFinished\./);
});

test('handback rate cap', async () => {
    const { host } = setup({ maxHandbacksPerHour: 2 });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Loop', brief: 'x' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    await thread.ctx.call('project_handback', { status: 'progress', summary: 'a' });
    await thread.ctx.call('project_handback', { status: 'progress', summary: 'b' });
    assert.match(await thread.ctx.call('project_handback', { status: 'done', summary: 'c' }), /^Failed: handback limit reached \(2 per hour\)/);
});

test('thread start cap stops a coordinator that keeps starting threads', async () => {
    const { host, dir } = setup({ maxThreadsPerHour: 2 });
    await tick();
    const coord = coordinatorOf(host);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'One', brief: 'x' }), /^Started t1/);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Two', brief: 'x' }), /^Started t2/);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Three', brief: 'x' }), /^Failed: thread limit reached: this project started 2 threads in the last hour/);
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'T', brief: 'x' });
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Survivor', brief: 'x' });
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
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Fast', brief: 'Go.', model: 'deepseek-v4-flash' }), /^Started t1 "Fast"\. It reports back when done\. It runs on deepseek:deepseek-v4-flash · effort high\. Link it as \[Fast\]\(\.dsh-thread\/t1\)\.$/);
    const t1 = [...host.live.values()].find((a) => a.id !== coord.id);
    assert.deepEqual(host.selections[1], { sessionId: t1.id, selection: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'high' }, promptsBefore: 0 });

    // A model without effort levels: the default effort is dropped with a note.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Big', brief: 'Go.', model: 'big-model' }), /It runs on other:big-model · effort default\. Note: other:big-model has no effort levels, so effort "high" is not used\. Link it as \[Big\]\(\.dsh-thread\/t2\)\.$/);
    assert.deepEqual(host.selections[2].selection, { provider: 'other', model: 'big-model' });

    // project_thread_update re-selects the thread.
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't1', effort: 'off' }), /route deepseek:deepseek-v4-flash · effort off from the next request/);
    assert.deepEqual(host.selections[3], { sessionId: t1.id, selection: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'off' }, promptsBefore: 1 });
    await coord.ctx.call('project_thread_update', { thread: 't1', title: 'Renamed' });
    assert.equal(host.selections.length, 4, 'a rename selects nothing');
});

test('an effort the DSH default model lacks never stops a thread: it runs at the nearest level, and own efforts follow a new model', async () => {
    const { host } = setup({ threadEffort: 'max' }, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    // The user picks V4 Flash somewhere in DSH, which makes it the DSH default model (the judge's B1).
    const flash = { provider: 'deepseek', model: 'deepseek-v4-flash' };
    host.services.agentDefaultModel.currentSelection = () => ({ ...flash });
    const started = await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Fast', brief: 'Go.' });
    // A fitted default is a setting the coordinator didn't choose: the start says nothing of it.
    assert.equal(started, 'Started t1 "Fast". It reports back when done. Link it as [Fast](.dsh-thread/t1).');
    const t1 = [...host.live.values()].find((a) => a.id !== coord.id);
    assert.deepEqual(host.selections.at(-1), { sessionId: t1.id, selection: { ...flash, reasoningEffort: 'high' }, promptsBefore: 0 });
    // An effort named in the start is fitted too; only one no model offers is refused.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Two', brief: 'Go.', model: 'deepseek-v4-flash', effort: 'max' }), /It runs on deepseek:deepseek-v4-flash · effort high\. Note: .*runs at "high"/);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Three', brief: 'Go.', effort: 'ultra' }), /^Failed: effort "ultra" is not offered by any model/);
    // "Use default" goes through when the inherited effort doesn't fit the default model, and the coordinator runs fitted.
    await coord.ctx.call('project_settings', { coordinator_effort: 'off' });
    const reset = await coord.ctx.call('project_settings', { coordinator_effort: 'default' });
    assert.match(reset, /Coordinator: deepseek:deepseek-v4-flash doesn't offer effort "max", so it runs at "high"\./);
    assert.deepEqual(host.selections.filter((x) => x.sessionId === coord.id).at(-1).selection, { ...flash, reasoningEffort: 'high' });
    // A setting made now must still be offered.
    assert.match(await coord.ctx.call('project_settings', { thread_model: 'deepseek-v4-flash', thread_effort: 'max' }), /^Failed: effort "max" is not offered by deepseek:deepseek-v4-flash/);
    // The project's own effort follows a new model: fitted to what it offers, cleared when it has none.
    await coord.ctx.call('project_settings', { thread_model: 'deepseek-v4', thread_effort: 'max' });
    assert.match(await coord.ctx.call('project_settings', { thread_model: 'deepseek-v4-flash' }), /New threads: deepseek:deepseek-v4-flash · effort high \(project setting \/ project setting\)/);
    assert.match(await coord.ctx.call('project_settings', { thread_model: 'big-model' }), /New threads: other:big-model · effort max \(project setting \/ plugin default\)/);
    // A thread moved to a model without its effort keeps the nearest one.
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't2', model: 'deepseek-v4' }), /route deepseek:deepseek-v4 · effort high/);
    assert.match(await coord.ctx.call('project_thread_update', { thread: 't2', model: 'deepseek-v4-flash', effort: 'low' }), /^Failed: effort "low" is not offered by deepseek:deepseek-v4-flash/);
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

test('session mode: on DSH defaults the coordinator gets no selection until a setting is made, and a thread keeps the default it started on', async () => {
    const { host } = setup({ threadEffort: '', projects: [{ name: 'DSH Plugins', workspacePath: '/work/dsh' }] }, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    assert.deepEqual(host.selections, []);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Plain', brief: 'Go.' });
    const t1 = [...host.live.values()].find((a) => a.id !== coord.id);
    // The thread is put on the DSH default of the moment and records it, so a pick
    // elsewhere in DSH (which changes the DSH default) doesn't move it.
    assert.deepEqual(host.selections.map((s) => [s.sessionId, s.selection]), [[t1.id, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' }]]);
    const read = await coord.ctx.call('project_thread_read', { thread: 't1' });
    assert.match(read, /^t1 · "Plain" · \w+\n/);
    assert.doesNotMatch(read.split('\n')[0], /deepseek|effort/, 'reading a thread names no model');
    host.selections.length = 0;
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

test('defaults form: a saved default switches what follows the defaults, and a project\'s own settings stay', async () => {
    const { host, config, dir } = setup({ coordinatorEffort: 'high', projects: [{ name: 'DSH Plugins', workspacePath: '/work/dsh' }] }, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    const efforts = () => host.selections.filter((s) => s.sessionId === coord.id).map((s) => s.selection.reasoningEffort);
    assert.deepEqual(efforts(), ['high']);
    // The user asked the coordinator for max-effort threads in this project.
    await coord.ctx.call('project_settings', { thread_effort: 'max' });

    // Then saved new defaults on the plugin's page.
    saveDefaults(host, config, { coordinatorEffort: 'max', threadEffort: 'off' });
    await tick();
    assert.deepEqual(efforts(), ['high', 'max'], 'a coordinator on the default switches from its next request');
    assert.match(await coord.ctx.call('project_settings', {}), /New threads: DSH default model · effort max \(DSH default \/ project setting\)/, 'the project\'s own choice stays');
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'After', brief: 'Go.' }), /Started t1/);
    const t1 = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'After');
    assert.equal(host.selections.find((s) => s.sessionId === t1.id).selection.reasoningEffort, 'max');

    // A coordinator with its own effort keeps it through later saves.
    await coord.ctx.call('project_settings', { coordinator_effort: 'low' });
    saveDefaults(host, config, { coordinatorEffort: 'off' });
    await tick();
    assert.deepEqual(efforts(), ['high', 'max', 'low']);
    // A save that changes nothing the plugin uses re-selects nothing; an empty default is an unset one.
    saveDefaults(host, config, { coordinatorEffort: 'off' });
    saveDefaults(host, config, { coordinatorModel: ' ' });
    await tick();
    assert.deepEqual(efforts(), ['high', 'max', 'low']);
    const log = readFileSync(join(dir, 'projects.log'), 'utf8');
    assert.equal(log.match(/ defaults saved/g).length, 4);
    assert.doesNotMatch(log, / replaced /);
});

test('profile: a model or effort edited in the project\'s row replaces the project\'s own choice of it at the next start', async () => {
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
    // Restarted with the same profile, or with other plugin defaults: the project's choices stand.
    assert.match(await (await restart(first.raw)).ctx.call('project_settings', {}), /effort low \(DSH default \/ project setting\)\nNew threads: DSH default model · effort off \(DSH default \/ project setting\)/);
    assert.match(await (await restart({ ...first.raw, threadEffort: 'max', coordinatorEffort: 'high' })).ctx.call('project_settings', {}),
        /effort low \(DSH default \/ project setting\)\nNew threads: DSH default model · effort off \(DSH default \/ project setting\)/);
    // Restarted after the row's coordinator effort was edited by hand: that edit wins over the earlier choice; the other stays.
    const edited = { ...first.raw, projects: [{ ...first.raw.projects[0], coordinatorEffort: 'high' }] };
    assert.match(await (await restart(edited)).ctx.call('project_settings', {}),
        /effort high \(DSH default \/ project config\)\nNew threads: DSH default model · effort off \(DSH default \/ project setting\)/);
    // Seen once, the row no longer replaces anything.
    await coordinatorOf(first.host).ctx.call('project_settings', {});
    assert.match(await (await restart(edited)).ctx.call('project_settings', {}), /effort high \(DSH default \/ project config\)/);
    const log = readFileSync(join(dir, 'projects.log'), 'utf8');
    assert.equal(log.match(/ row dsh-plugins /g).length, 1);
    assert.match(log, / row dsh-plugins coordinatorEffort replaced coordinatorEffort/);
});

test('picker: a model the user picks in DSH\'s own picker becomes the project\'s setting; the plugin\'s own selections do not', async () => {
    const { host, dir } = setup({}, undefined, { ...SELECTING, gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    const threadRoute = async () => (await remote.describe(coord.id)).threads.map((t) => `${t.id} ${t.model} ${t.effort}`);
    const selectionsBefore = host.selections.length;
    // A pick without an effort: the model is the project's now, the effort falls back.
    coord.ctx.sessionEvent({ type: 'model/selection', data: { provider: 'other', model: 'big-model' } });
    assert.match(await coord.ctx.call('project_settings', {}), /^Coordinator: other:big-model · effort max \(project setting \/ project config\)/);
    coord.ctx.sessionEvent({ type: 'model/selection', data: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'off' } });
    assert.match(await coord.ctx.call('project_settings', {}), /^Coordinator: deepseek:deepseek-v4-flash · effort off \(project setting \/ project setting\)/);
    assert.equal(host.selections.length, selectionsBefore, 'the coordinator already runs on the pick, so nothing selects it again');
    // In a thread, the pick becomes that thread's model.
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Picked', brief: 'Go.' });
    const t1 = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Picked');
    t1.ctx.sessionEvent({ type: 'model/selection', data: { provider: 'other', model: 'big-model' } });
    assert.deepEqual(await threadRoute(), ['t1 other:big-model null']);
    // Selections the plugin makes itself, and malformed events, change no setting.
    await coord.ctx.call('project_thread_update', { thread: 't1', model: 'deepseek-v4', effort: 'low' });
    coord.ctx.sessionEvent({ type: 'model/selection', data: {} });
    coord.ctx.sessionEvent({ type: 'model/selection' });
    const log = readFileSync(join(dir, 'projects.log'), 'utf8');
    assert.deepEqual(log.split('\n').filter((l) => / picked /.test(l)).map((l) => l.replace(/^\S+ /, '')), [
        'picked dsh-plugins/coordinator other:big-model effort=-',
        'picked dsh-plugins/coordinator deepseek:deepseek-v4-flash effort=off',
        'picked dsh-plugins/t1 other:big-model effort=-',
    ]);
    assert.deepEqual(await threadRoute(), ['t1 deepseek:deepseek-v4 low']);
});

test('window: the Project settings endpoints read and change a project the way its coordinator does', async () => {
    const { host } = setup({}, undefined, { ...SELECTING, gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    // DSH's gateway finds the service by its binding and method markers.
    assert.equal(remote.typertRemote.namespace, 'dsh-plugin-projects');
    assert.equal(remote.typertRemote.serviceKey, 'dshPluginProjectsRemote');
    assert.deepEqual(remoteMethods(remote).map((m) => m.method), ['describe', 'list', 'update', 'continueThread', 'create', 'move', 'rename', 'remove', 'addCoordinator']);
    const refused = async (promise, pattern) => {
        await assert.rejects(promise, (error) => error.code === 'projects/refused' && pattern.test(error.message));
    };

    const read = await remote.describe(coord.id);
    assert.deepEqual(plain(read.project), { id: 'dsh-plugins', name: 'DSH Plugins', source: 'profile', workspace: '/work/dsh', homeFolder: false, coordinator: coord.id, live: null, permission: null, tools: [] });
    // Access settings come with their sources too. This DSH has no permission presets, and none of the user's tools are named.
    assert.deepEqual(plain(read.access.yourTools), { value: 'asked', source: 'plugin default', inherited: { value: 'asked', source: 'plugin default' } });
    assert.deepEqual([read.guarded, read.permissions], [[], null]);
    assert.deepEqual(plain(read.settings.coordinatorEffort), { value: 'max', source: 'project config', inherited: { value: 'max', source: 'project config' } });
    assert.deepEqual(plain(read.settings.threadEffort), { value: 'high', source: 'plugin default', inherited: { value: 'high', source: 'plugin default' } });
    assert.deepEqual(plain(read.paused), { value: false, source: 'project config', inherited: false, held: 0, handbacks: [] });
    assert.deepEqual(read.threads, []);
    assert.deepEqual(plain(await remote.describe('dsh-plugins')), plain(read));
    await refused(remote.describe('nope'), /"nope" is not a project here/);
    await refused(remote.describe(''), /no project given/);

    // Coordinator effort, set and given back to the default: the coordinator follows both.
    const efforts = () => host.selections.filter((s) => s.sessionId === coord.id).map((s) => s.selection.reasoningEffort);
    let after = await remote.update(coord.id, { coordinatorEffort: 'low' });
    assert.deepEqual(plain(after.settings.coordinatorEffort), { value: 'low', source: 'project setting', inherited: { value: 'max', source: 'project config' } });
    assert.deepEqual(after.notes, []);
    after = await remote.update(coord.id, { coordinatorEffort: null });
    assert.equal(after.settings.coordinatorEffort.source, 'project config');
    assert.deepEqual(efforts(), ['max', 'low', 'max']);
    // Values are checked against DSH's models; a model without efforts says so.
    await refused(remote.update(coord.id, { threadEffort: 'ultra' }), /effort "ultra" is not offered/);
    after = await remote.update(coord.id, { threadModel: 'big-model' });
    assert.deepEqual([after.settings.threadModel.value, after.notes], ['other:big-model', ['Threads: other:big-model has no effort levels, so effort "high" is not used.']]);
    await refused(remote.update(coord.id, 'max'), /changes must be an object/);

    // A thread, named by its own session: its model changes from its next request.
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Window', brief: 'Go.', model: 'deepseek-v4' });
    const t1 = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Window');
    after = await remote.update(t1.id, { thread: 't1', model: 'deepseek:deepseek-v4-flash', effort: 'off' });
    assert.deepEqual(plain(after.threads.map(({ id, title, session, resolved, model, effort }) => ({ id, title, session, resolved, model, effort }))),
        [{ id: 't1', title: 'Window', session: t1.id, resolved: false, model: 'deepseek:deepseek-v4-flash', effort: 'off' }]);
    assert.deepEqual(host.selections.at(-1), { sessionId: t1.id, selection: { provider: 'deepseek', model: 'deepseek-v4-flash', reasoningEffort: 'off' }, promptsBefore: 1 });
    await refused(remote.update(coord.id, { thread: 't9', model: 'deepseek-v4' }), /no thread "t9"/);

    // Pause, and back to what the profile says.
    after = await remote.update(coord.id, { paused: true });
    assert.deepEqual(plain(after.paused), { value: true, source: 'project setting', inherited: false, held: 0, handbacks: [] });
    await refused(coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Blocked', brief: 'Go.' }).then((text) => {
        throw Object.assign(new Error(text), { code: /paused/.test(text) ? 'projects/refused' : 'unexpected' });
    }), /paused/);
    // What a pause holds for the coordinator is counted, for the window's pause bar.
    await t1.ctx.call('project_handback', { status: 'done', summary: 'Held.' });
    assert.deepEqual(plain((await remote.describe(coord.id)).paused), { value: true, source: 'project setting', inherited: false, held: 1, handbacks: [{ thread: 't1', status: 'done' }] });
    after = await remote.update(coord.id, { paused: null });
    assert.deepEqual(plain(after.paused), { value: false, source: 'project config', inherited: false, held: 0, handbacks: [] });

    // The plugin's page lists every project with its settings and where each comes from.
    const listed = plain(await remote.list());
    assert.deepEqual(listed.projects.map(({ id, name, workspace, coordinator, paused, threads }) => ({ id, name, workspace, coordinator, paused, threads })),
        [{ id: 'dsh-plugins', name: 'DSH Plugins', workspace: '/work/dsh', coordinator: coord.id, paused: false, threads: { open: 1, resolved: 0 } }]);
    assert.deepEqual(listed.projects[0].settings, {
        coordinatorModel: { value: null, source: 'DSH default' },
        coordinatorEffort: { value: 'max', source: 'project config' },
        threadModel: { value: 'other:big-model', source: 'project setting' },
        threadEffort: { value: 'high', source: 'plugin default' },
    });
});

/**
 * Load the browser half the way DSH does: a classic script that hands its
 * factory to the module loader, which calls it with DSH's module require.
 * The primitives are stand-ins; an icon is its own name.
 */
function loadClient({ storage, document, innerWidth } = {}) {
    let loaded;
    const localStorage = storage ? { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, String(value)); } } : undefined;
    const window = { __ModuleLoader__: { load: (m) => { loaded = m; } }, localStorage, addEventListener: () => {}, removeEventListener: () => {}, innerWidth };
    runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
        window, ...(document ? { document } : {}),
        URL, console, setInterval, clearInterval, setTimeout, clearTimeout, queueMicrotask,
    });
    const base = {
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
    const ui = new Proxy(base, { get: (target, name) => (name in target ? target[name] : typeof name === 'string' && name.startsWith('Icon') ? name : undefined) });
    const modules = {
        react: {
            createElement: (type, props, ...children) => ({ type, props, children }), useSyncExternalStore: (_subscribe, get) => get(),
            // Enough of React's hooks to call a component once and read what it draws.
            useState: (init) => [typeof init === 'function' ? init() : init, () => {}], useRef: (current) => ({ current }),
            useEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(),
        },
        'react-dom': {}, '@deepseek-ai/dsh-client-ui-primitives': ui,
    };
    return { id: loaded.id, client: loaded.factory((name) => modules[name]), window };
}

/** Every element in a tree a component returned (the test React's {type, props, children}), depth first. */
function elementsOf(node, out = []) {
    if (Array.isArray(node)) { for (const child of node) elementsOf(child, out); return out; }
    if (node === null || typeof node !== 'object') return out;
    out.push(node);
    elementsOf(node.children, out);
    return out;
}
/** The text an element tree shows. */
const textIn = (node) => (Array.isArray(node) ? node.map(textIn).join('') : node === null || node === undefined || node === false ? ''
    : typeof node === 'object' ? textIn(node.children) : String(node));
const byClass = (tree, name) => elementsOf(tree).filter((e) => String(e.props?.className ?? '').split(' ').includes(name));

/** Values made inside the script's context, copied so they compare as plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

test('browser half: the defaults form registers on the plugin page, read-only when the profile adds the row twice', () => {
    const { id, client } = loadClient();
    assert.equal(id, 'dsh-plugin-projects');
    // Each part waits for its own DSH services, so only the slots are required.
    assert.deepEqual([...client.inject], ['slots']);
    let snapshot = { status: 'ready', value: { coordinatorEffort: 'max' }, base: {}, user: { coordinatorEffort: 'max' }, writable: true, revision: 1 };
    const registered = [];
    const groups = [];
    const ctx = {
        effect: (fn) => fn(),
        // This DSH serves the settings services only; the threads part keeps waiting.
        inject: (names, fn) => { groups.push([...names]); if (names.includes('configForms')) fn(ctx); },
        configForms: {
            get: (ns) => (assert.equal(ns, 'projects'), { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true }),
            whileServed: (names, fn) => (assert.deepEqual([...names], ['projects']), fn()),
        },
        slots: {
            inject: (_name, fn) => fn(),
            register: (slot, component) => { registered.push({ slot, component }); return () => {}; },
        },
    };
    client.apply(ctx);
    // The shared services first (model catalog, connection, sessions), then the three parts.
    assert.deepEqual(groups, [['remote', 'remote.session'], ['connection'], ['sessions'],
        ['configForms', 'remote', 'remote.session'], ['connection', 'remote', 'remote.session'], ['sessions', 'uiWorkspace', 'sidebarRight']]);
    assert.deepEqual(registered.map((r) => ({ ...r.slot })), [{ name: 'plugins.bundle.config', key: 'dsh-plugin-projects' }]);
    const page = registered[0].component;
    assert.match(page({ view: 'summary' }), /^Default models/);
    // The page: the Default models form, the Threads switch, then every project with what it runs.
    const [formPart, optionsPart, tablePart] = page({ view: 'page' }).children;
    assert.equal(optionsPart.type.name, 'ThreadOptions');
    assert.equal(tablePart.type.name, 'ProjectsTable');
    assert.deepEqual(Object.keys(tablePart.props).sort(), ['catalog', 'dialog', 'link', 'sessionsOf']);
    const form = formPart.props.form;
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

test('browser half: threads add a header menu, turn cards, sidebar marks and right-sidebar tabs', () => {
    const { client } = loadClient();
    const registered = [];
    const types = [];
    const protocols = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push({ ...slot }); return () => {}; } },
        resources: { register: (provider) => { protocols.push(provider.protocol); return () => {}; } },
        sidebarRightTabs: { register: (type) => { types.push(type); return () => {}; } },
        sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }), subscribe: () => () => {} } },
        uiWorkspace: {},
        sidebarRight: {},
    };
    client.apply(ctx);
    assert.deepEqual(registered.map((r) => [r.name, r.id ?? r.key ?? null, r.order ?? null]), [
        ['shell.overlay', 'dsh-plugin-projects/project-settings', null],
        ['sidebar.workspaces.session.menu.item', 'dsh-plugin-projects/project-settings-item', 250],
        ['conversation.session.header.actions', 'dsh-plugin-projects/threads-menu', -25],
        ['conversation.chat.turnTail', 'dsh-plugin-projects/thread-cards', 30],
        ['conversation.chat.node', 'turn-trigger', null],
        ['sidebar.session.row.leading', 'dsh-plugin-projects/thread-mark', 20],
        ['sidebar.workspaces.session.row.action', 'dsh-plugin-projects/row-place', 900],
        ['conversation.input.dock', 'dsh-plugin-projects/paused-bar', 15],
        ['conversation.input.dock', 'dsh-plugin-projects/ending-bar', 16],
        ['sidebar.session.row.hover', 'dsh-plugin-projects/thread-hover', 20],
        ['sidebar.workspaces.session.menu.item', 'dsh-plugin-projects/full-view-item', 50],
        ['shell.overlay', 'dsh-plugin-projects/sidebar-groups', null],
        ['main', 'dsh-plugin-projects/projects', null],
        ['sidebar.panellist', 'dsh-plugin-projects/projects', 5],
        ['sidebar.right.pane.tab', 'dsh-plugin-projects/thread-chat', null],
        ['sidebar.right.pane.tab.title', 'dsh-plugin-projects/thread-chat', null],
        ['projects.thread.conversation', null, null],
        ['sidebar.right.pane.tab', 'dsh-plugin-projects/threads-pane', null],
        ['sidebar.right.pane.tab', 'dsh-plugin-projects/thread-link', null],
    ]);
    // The thread chat tab hosts the conversation slot it renders.
    const chatTab = registered.find((r) => r.name === 'sidebar.right.pane.tab' && r.key === 'dsh-plugin-projects/thread-chat');
    assert.deepEqual(plain(chatTab.children), { 'projects.thread.conversation': { kind: 'single', scope: 'session' } });
    assert.deepEqual(protocols, ['projectthread']);
    assert.deepEqual(types.map((t) => [t.id, t.kind, t.patterns ? [...t.patterns] : null]), [
        ['dsh-plugin-projects/thread-chat', 'projectthread', ['dsh-resource://projectthread/session/**']],
        ['dsh-plugin-projects/threads-pane', 'projectthreads', null],
        ['dsh-plugin-projects/thread-link', 'projectthreadlink', ['dsh-resource://file/session/**/.dsh-thread/*']],
    ]);
    const [chat, pane, link] = types;
    assert.equal(chat.canOpen('dsh-resource://projectthread/session/s%2F1'), true);
    assert.equal(chat.canOpen('dsh-resource://projectthread/other/s1'), false);
    assert.equal(chat.title('dsh-resource://projectthread/session/s1'), 'Thread');
    assert.equal(pane.title(), 'Threads');
    // `[title](.dsh-thread/t3)` in a reply opens the thread, not DSH's file viewer.
    assert.equal(link.canOpen('dsh-resource://file/session/s%2F1/.dsh-thread/t3'), true);
    assert.equal(link.canOpen('dsh-resource://file/session/s1/.dsh-thread/notes.md'), false);
    assert.equal(link.title('dsh-resource://file/session/s1/.dsh-thread/T12'), 'Thread t12');
    assert.equal(link.priority, undefined, 'the extension band ranks above the builtin file viewer');
});

test('browser half: Project settings opens per session, calls the plugin\'s endpoints and reads models as DSH does', async () => {
    const { client } = loadClient();
    const { settingsDialog, hostLink, errorText, noteText, catalogView, resolveRoute, effortNote, liveNote } = client.internals;
    // The dialog opens only once its part is running, and closes when that part stops.
    const dialog = settingsDialog();
    let changes = 0;
    dialog.subscribe(() => { changes += 1; });
    dialog.open('s1');
    assert.equal(dialog.getSnapshot().target, null);
    const disconnect = dialog.connect();
    dialog.open('s1');
    assert.deepEqual(plain(dialog.getSnapshot()), { target: 's1', seq: 1, available: true, pick: null });
    dialog.open('s1', { pick: 'thread' });
    assert.deepEqual(plain(dialog.getSnapshot()), { target: 's1', seq: 2, available: true, pick: 'thread' }, 'opening again starts fresh, here with the New threads menu open');
    dialog.open('s1', { pick: 'nope' });
    assert.equal(dialog.getSnapshot().pick, null);
    dialog.close();
    dialog.open('');
    assert.equal(dialog.getSnapshot().target, null);
    disconnect();
    assert.deepEqual(plain(dialog.getSnapshot()), { target: null, seq: 3, available: false, pick: null });
    assert.equal(changes, 6);

    // Calls go over the window's connection to /api/dsh-plugin-projects/<method>.
    const sent = [];
    let reply = { ok: true, value: { project: { id: 'p' } } };
    const link = hostLink(() => ({ rpc: { call: async (channel, endpoint, payload) => { sent.push([channel, endpoint, payload]); if (reply instanceof Error) throw reply; return reply; } } }));
    assert.deepEqual(plain(await link.call('describe', { target: 's1' })), { ok: true, value: { project: { id: 'p' } } });
    assert.deepEqual(plain(sent), [['/api', 'dsh-plugin-projects/describe', { args: { target: 's1' } }]]);
    reply = { ok: false, error: { code: 'projects/refused', message: 'effort "ultra" is not offered by a:b. Choose one of: off, high' } };
    const refused = await link.call('update', { target: 's1', changes: {} });
    assert.equal(errorText(refused.error), 'Effort "ultra" is not offered by a:b. Choose one of: off, high.');
    reply = new Error('transport failure for /api/dsh-plugin-projects/update: HTTP 404');
    assert.match(errorText((await link.call('update', {})).error), /didn't answer\. If it was just updated, restart DSH/);
    reply = 'garbage';
    assert.equal((await link.call('describe', {})).error.code, 'projects/unreadable');
    // Before DSH has given the window its connection, a call says the plugin can't be reached.
    const early = await hostLink(() => undefined).call('list', {});
    assert.equal(early.error.code, 'projects/unreachable');
    assert.match(errorText(early.error), /didn't answer/);

    // Only the notes that change what the user sees are shown.
    // Efforts a model can't use show on the row, so the notes about them are not repeated.
    assert.equal(noteText(['Threads: other:big has no effort levels, so effort "high" is not used.']), '');
    assert.equal(noteText(['t1: route a:b · effort high from the next request.']), '');
    assert.equal(noteText(['t1: route a:b · effort default from the next request; but the model could not be set, so it keeps its current one (details in the projects log).']),
        'The model could not be set, so it keeps its current one (details in the projects log).');

    // What a setting runs on, named as DSH's picker names it.
    const catalog = {
        default: { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' },
        groups: [
            { id: 'other', name: 'Other', models: [{ id: 'big-model', name: 'Big' }] },
            { id: 'deepseek-account', name: 'DeepSeek', models: [
                { id: 'deepseek-v4', name: 'V4', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' } },
                { id: 'deepseek-v4-flash', name: 'V4 Flash', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } },
            ] },
        ],
    };
    const cv = catalogView(catalog);
    assert.deepEqual(plain(cv.groups.map((g) => g.provider)), ['deepseek-account', 'other'], 'DSH\'s own account comes first');
    const shown = (model, effort, view = cv) => { const r = resolveRoute(view, model, effort); return [r.name, r.effortName ?? null]; };
    assert.deepEqual(shown(undefined, undefined), ['V4', 'Low'], 'nothing set: the DSH default selection');
    assert.deepEqual(shown('deepseek-account:deepseek-v4', undefined), ['V4', 'Max'], 'a model set: its own default effort');
    assert.deepEqual(shown('deepseek-v4', 'low'), ['V4', 'Low']);
    assert.deepEqual(shown('other:big-model', 'max'), ['Big', null], 'a model without efforts shows none');
    assert.deepEqual(shown('deepseek-account:deepseek-v4-flash', undefined), ['V4 Flash', 'Default'], 'a model without a default effort: the provider\'s');
    assert.deepEqual(shown('deepseek:deepseek-v4-pro', 'max', catalogView(undefined)), ['deepseek-v4-pro', 'max'], 'before the catalog arrives, the stored values');
    assert.equal(noteText(['Threads: deepseek:deepseek-v4-flash doesn\'t offer effort "max", so it runs at "high".']), '');

    // An effort the model lacks shows what runs, as the plugin fits it, and says why.
    const note = (model, effort) => effortNote(cv, resolveRoute(cv, model, effort)) ?? null;
    assert.deepEqual(shown('deepseek-account:deepseek-v4-flash', 'max'), ['V4 Flash', 'Off'], 'max on a model with only off runs at off');
    assert.equal(note('deepseek-account:deepseek-v4-flash', 'max'), 'V4 Flash doesn\'t offer Max, so it runs at Off.');
    assert.equal(note('other:big-model', 'low'), 'Big has no effort levels, so Low isn\'t used.');
    assert.equal(effortNote(cv, resolveRoute(cv, 'other:big-model', 'low'), false) ?? null, null, 'an inherited effort on a model without levels goes unsaid');
    assert.match(effortNote(cv, resolveRoute(cv, 'deepseek-account:deepseek-v4-flash', 'max'), false), /runs at Off/, 'a fitted one is said even when inherited');
    assert.equal(note('deepseek-account:deepseek-v4', 'low'), null);
    assert.equal(note('other:big-model', undefined), null);
    assert.deepEqual(shown('deepseek-account:deepseek-v4', 'medium'), ['V4', 'Max'], 'an effort no model offers runs at the model\'s default');
    // What a loaded session really runs, when it differs from its setting.
    const live = (model, effort, running) => liveNote(cv, resolveRoute(cv, model, effort), running) ?? null;
    assert.equal(live(undefined, undefined, { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' }), null);
    assert.equal(live(undefined, undefined, { provider: 'deepseek-account', model: 'deepseek-v4-flash', reasoningEffort: 'off' }), 'It runs on V4 Flash · Off right now.');
    assert.equal(live('deepseek-account:deepseek-v4', 'max', { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' }), 'It runs on V4 · Low right now.');
    assert.equal(live('deepseek-account:deepseek-v4', 'max', null), null);
    assert.equal(live('other:big-model', undefined, { provider: 'other', model: 'big-model' }), null);
});

test('browser half: rows, cards and the plugin page name what each session runs on, as DSH\'s model menu does', () => {
    const { client } = loadClient();
    const { selectionIn, selectionText, summaryModels, sourceLine, toldText, catalogView } = client.internals;
    const cv = catalogView({
        default: { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' },
        groups: [
            { id: 'other', name: 'Other', models: [{ id: 'big-model', name: 'Big' }] },
            { id: 'deepseek-account', name: 'DeepSeek', models: [
                { id: 'deepseek-v4', name: 'V4', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' } },
                { id: 'deepseek-v4-flash', name: 'V4 Flash', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } },
            ] },
        ],
    });
    // DSH's own modelSelection projection: the next request's selection, else the last one used.
    const picked = { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' };
    const state = {
        byId: { a: { projectionValues: { modelSelection: { lastUsed: { provider: 'other', model: 'big-model' }, next: picked } } } },
        projectionsBySession: {
            b: { values: { modelSelection: { lastUsed: { provider: 'other', model: 'big-model' }, next: null } } },
            c: { values: { modelSelection: { lastUsed: null, next: null } } },
        },
    };
    assert.deepEqual(plain(selectionIn(state, 'a')), picked);
    assert.deepEqual(plain(selectionIn(state, 'b')), { provider: 'other', model: 'big-model' });
    assert.equal(selectionIn(state, 'c'), undefined);
    assert.equal(selectionIn(state, 'nope'), undefined);
    // Named as DSH's composer names them.
    assert.equal(selectionText(cv, picked), 'V4 · Low');
    assert.equal(selectionText(cv, { provider: 'deepseek-account', model: 'deepseek-v4' }), 'V4 · Max', 'no effort: the model\'s default');
    assert.equal(selectionText(cv, { provider: 'deepseek-account', model: 'deepseek-v4-flash' }), 'V4 Flash · Default', 'no default either: the provider\'s');
    assert.equal(selectionText(cv, { provider: 'other', model: 'big-model', reasoningEffort: 'high' }), 'Big', 'a model without levels shows none');
    assert.equal(selectionText(catalogView(undefined), { provider: 'x', model: 'm1', reasoningEffort: 'high' }), 'm1 · High', 'before the catalog arrives');
    assert.equal(selectionText(cv, undefined), undefined);
    // The menu's summary: what the coordinator runs on now, else its setting; what new threads start on.
    const info = { settings: {
        coordinatorModel: { value: null, source: 'DSH default' }, coordinatorEffort: { value: 'max', source: 'project config' },
        threadModel: { value: 'other:big-model', source: 'project setting' }, threadEffort: { value: 'high', source: 'plugin default' },
    } };
    assert.deepEqual(plain(summaryModels(cv, {}, 'c1', info)), { coordinator: 'V4 · Max', thread: 'Big' });
    assert.deepEqual(plain(summaryModels(cv, { c1: 'V4 Flash · Off' }, 'c1', info)), { coordinator: 'V4 Flash · Off', thread: 'Big' });
    assert.deepEqual(plain(summaryModels(cv, {}, 'c1', null)), {});
    // Where a project's setting comes from, on the plugin page.
    assert.equal(sourceLine({ value: 'a:b', source: 'project setting' }, { value: 'max', source: 'project setting' }), 'Set for this project');
    assert.equal(sourceLine({ value: 'a:b', source: 'plugin default' }, { value: 'max', source: 'project config' }), 'Model from Default models · effort from your profile');
    assert.equal(sourceLine({ value: null, source: 'DSH default' }, { value: 'max', source: 'plugin default' }), 'Model follows DSH · effort from Default models');
    assert.equal(sourceLine({ value: null, source: 'DSH default' }, { value: null, source: 'DSH default' }), 'Follows DSH\'s default model');
    assert.equal(sourceLine({ value: null, source: 'DSH default' }, { value: null, source: 'DSH default' }, { long: true }), 'Follows DSH\'s default model, the one last picked in any DSH chat');
    assert.equal(sourceLine({ value: 'a:b', source: 'project setting' }, { value: null, source: 'DSH default' }), 'Set for this project', 'an effort set nowhere is the model\'s own');
    // A handback that starts with its own state doesn't say it twice.
    assert.equal(toldText({ status: 'blocked', summary: 'Blocked: the token expired.' }), 'Blocked: the token expired.');
    assert.equal(toldText({ status: 'done', summary: 'done.' }), 'done.');
    assert.equal(toldText({ status: 'done', summary: 'Doneness checks pass.' }), 'Done · Doneness checks pass.');
    assert.equal(toldText({ status: 'needs_decision', summary: 'Pick A or B.' }), 'Needs your decision · Pick A or B.');
    assert.equal(toldText({ status: 'progress' }), 'Progress update');
});

test('browser half: New threads follows DSH\'s default after a pick in any chat; a row names a model the menu already names only on hover', async () => {
    const { client } = loadClient();
    const { catalogSource, picksIn, followDefault, ThreadRow } = client.internals;
    // DSH saves a composer pick as its default in the background, so the catalog is read again.
    let def = { provider: 'p', model: 'old' };
    let reads = 0;
    let answer;
    const remote = { session: { modelCatalog: () => { reads += 1; return new Promise((resolve) => { answer = () => resolve({ ok: true, value: { default: def, groups: [] } }); }); } } };
    const catalog = catalogSource(() => remote);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    catalog.ensure();
    await tick();
    assert.equal(reads, 1);
    // A reload asked for mid-read waits for that read, then reads once more.
    catalog.reload();
    catalog.reload();
    await tick();
    assert.equal(reads, 1);
    def = { provider: 'p', model: 'new' };
    answer();
    await tick();
    assert.equal(reads, 2);
    assert.equal(catalog.getSnapshot().status, 'loading');
    answer();
    await tick();
    assert.deepEqual(plain([catalog.getSnapshot().status, catalog.getSnapshot().value.default.model, reads]), ['ready', 'new', 2]);

    // Picks per loaded session; one DSH has not sent is left out.
    const pick = (model, effort) => ({ lastUsed: null, next: { provider: 'p', model, ...(effort ? { reasoningEffort: effort } : {}) } });
    let state = {
        byId: { a: {}, b: {}, cold: {} },
        projectionsBySession: { a: { values: { modelSelection: pick('m1', 'high') } }, b: { values: { modelSelection: { lastUsed: null, next: null } } } },
    };
    assert.deepEqual(plain([...picksIn(state)]), [['a', 'p:m1:high'], ['b', '']]);
    const listeners = new Set();
    const sessions = { list: { getSnapshot: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } };
    const frames = [];
    const timers = [];
    const fake = { reloads: 0, status: 'idle', value: { default: { provider: 'p', model: 'm1', reasoningEffort: 'high' } } };
    const watched = { reload: () => { fake.reloads += 1; }, getSnapshot: () => ({ status: fake.status, value: fake.value }) };
    const stop = followDefault(sessions, watched, {
        frame: (fn) => frames.push(fn), cancel: () => {}, later: (fn, ms) => (timers.push({ fn, ms }), timers.length), clear: () => {},
    });
    const emit = (next) => { state = next; for (const fn of listeners) fn(); while (frames.length) frames.shift()(); };
    // While nothing has read the catalog, a pick leaves it for the first view that needs it.
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: pick('m1', 'max') } } } });
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: pick('m1', 'high') } } } });
    assert.deepEqual([fake.reloads, timers.length], [0, 0]);
    fake.status = 'ready';
    // A session DSH sends for the first time is not a pick.
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, cold: { values: { modelSelection: pick('m9') } } } });
    assert.equal(fake.reloads, 0);
    // A pick in a session that had none (a new chat), then a changed pick: each reads the catalog again.
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, b: { values: { modelSelection: pick('m2') } } } });
    assert.equal(fake.reloads, 1);
    // The save had not landed by the first read: more reads a moment later, while the catalog names another default.
    assert.deepEqual(timers.map((x) => x.ms), [300]);
    timers.at(-1).fn();
    assert.deepEqual([fake.reloads, ...timers.map((x) => x.ms)], [2, 300, 700]);
    timers.at(-1).fn();
    timers.at(-1).fn();
    assert.deepEqual([fake.reloads, ...timers.map((x) => x.ms)], [4, 300, 700, 1500], 'at most three more reads');
    // A changed effort is a pick too; once a read names it, no more reads.
    timers.length = 0;
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: pick('m1', 'low') } } } });
    assert.equal(fake.reloads, 5);
    fake.value = { default: { provider: 'p', model: 'm1', reasoningEffort: 'low' } };
    timers.at(-1).fn();
    assert.deepEqual([fake.reloads, timers.length], [5, 1]);
    // Changes that are not picks: a turn using the pick, an unrelated session update.
    emit({ ...state, byId: { ...state.byId, a: { title: 'renamed' } } });
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: { lastUsed: pick('m1', 'low').next, next: pick('m1', 'low').next } } } } });
    assert.equal(fake.reloads, 5);
    stop();
    assert.equal(listeners.size, 0);

    // The menu names New threads' model at its top, so a row on the same model names it in a tooltip only.
    const row = { id: 't1', title: 'Fix login', line: 'Running', dot: 'ongoing', session: 's1' };
    const bodyOf = (el) => (el.props.className === 'dshp-t-row' ? el : el.children[0]);
    const mainOf = (el) => bodyOf(el).children.find((c) => c?.props?.className === 'dshp-t-main');
    const meta = (props) => {
        const text = mainOf(ThreadRow({ row, now: 0, onOpen() {}, ...props })).children.find((c) => c?.props?.className === 'dshp-t-text');
        const second = text.children.find((c) => c?.props?.className === 'dshp-t-second');
        return second.children.find((c) => c?.props?.className === 'dshp-t-meta');
    };
    const modelOf = (props) => meta(props).children.find((c) => c?.props?.className === 'dshp-t-model');
    const quiet = ThreadRow({ row, now: 0, model: 'V4 · High', quietModel: 'V4 · High', onOpen() {} });
    assert.deepEqual(plain([quiet.props.label, quiet.props.delayMs > 0, bodyOf(quiet).props['data-projects-runs-on'], mainOf(quiet).props['aria-label']]),
        ['Runs on V4 · High', true, 'V4 · High', 'Fix login. Running. Runs on V4 · High']);
    assert.equal(modelOf({ model: 'V4 · High', quietModel: 'V4 · High' }), undefined);
    assert.equal(modelOf({ model: 'V4 · Low', quietModel: 'V4 · High' }).children[0], 'V4 · Low');
    assert.equal(ThreadRow({ row, now: 0, model: 'V4 · Low', quietModel: 'V4 · High', onOpen() {} }).props.className, 'dshp-t-row', 'no tooltip when the row shows its model');
    assert.equal(modelOf({}), undefined);
    // The code changes sit on the second line with the model and the time, not beside the name.
    const counted = meta({ changes: { added: 18, deleted: 3, files: 2 }, model: 'V4 · Low' }).children.filter(Boolean).map((c) => c.props.className);
    assert.deepEqual(counted, ['dshp-t-row-changes', 'dshp-t-model']);

    // No control sits inside another: the row's open button holds its text, and Retry and Open beside are the button's siblings.
    const opened = [];
    const action = { label: 'Open beside', icon: () => null, run() {} };
    const failed = ThreadRow({ row: { ...row, ending: { state: 'failed' } }, now: 0, onOpen: (r) => opened.push(r.id), action, projects: {}, slots: 2 });
    const main = mainOf(failed);
    const acts = bodyOf(failed).children.find((c) => c?.props?.className === 'dshp-t-row-acts');
    assert.equal(main.type, 'button');
    assert.equal(bodyOf(failed).props.role, undefined, 'the row itself is no button');
    assert.deepEqual(elementsOf(main.children).filter((e) => e.type === 'button' || e.props?.['aria-label'] !== undefined), [], 'nothing pressable inside the open button');
    assert.equal(acts.children.length, 2, 'Retry and Open beside sit beside the open button');
    assert.deepEqual(plain([main.props['data-dshp-item'], main.props.tabIndex, bodyOf(failed).props['data-acts'], bodyOf(failed).props.style]), ['', 0, '', { '--dshp-t-acts': '56px' }]);
    main.props.onClick();
    assert.deepEqual(opened, ['t1']);
    // The current chat's row: read out as current, left out of arrow keys, and opening it does nothing.
    const here = mainOf(ThreadRow({ row, current: true, now: 0, onOpen: (r) => opened.push(r.id) }));
    assert.deepEqual(plain([here.props['aria-current'], here.props['aria-disabled'], here.props.tabIndex]), ['true', 'true', -1]);
    here.props.onClick();
    assert.deepEqual(opened, ['t1']);
    // Focusing the row itself focuses its open button.
    let focused = '';
    const rowEl = { firstElementChild: { focus: () => { focused = 'main'; } } };
    bodyOf(failed).props.onFocus({ target: rowEl, currentTarget: rowEl });
    assert.equal(focused, 'main');
});

test('browser half: access reads as DSH names it, and each thread row says what it can reach', () => {
    const { client } = loadClient();
    const { permissionName, permissionShown, permissionIn, toolsText, accessOf, accessSummary, ThreadRow, ModelsSummary } = client.internals;
    const catalog = {
        defaultPreset: 'danger-full-access',
        options: [
            { value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'Workspace Write' }, { value: 'danger-full-access', name: 'danger-full-access' },
            { value: 'team-review', name: 'team-review' }, { value: 'night', name: 'Night shift' },
        ],
    };
    // DSH's own labels for its presets; another kebab-case name title-cased, any other as given.
    assert.deepEqual(['read-only', 'workspace-write', 'danger-full-access', 'team-review', 'night', 'custom', 'not-offered'].map((v) => permissionName(v, catalog)),
        ['Read Only', 'Workspace Write', 'Full access', 'Team Review', 'Night shift', 'Custom', 'Not Offered']);
    assert.equal(permissionName('', catalog), undefined);
    assert.equal(permissionName('read-only', { options: [{ value: 'read-only', name: 'Look only' }] }), 'Look only', 'a preset the profile renamed keeps its name');
    // "default" is DSH's default for new sessions.
    assert.deepEqual(plain(permissionShown('default', catalog)), { preset: 'danger-full-access', name: 'Full access' });
    assert.deepEqual(plain(permissionShown('default', null)), { name: 'DSH default' });
    assert.deepEqual(plain(permissionShown('workspace-write', null)), { preset: 'workspace-write', name: 'Workspace Write' });
    assert.deepEqual([toolsText('all'), toolsText(['cua', 'lane-catalog']), toolsText([]), toolsText(undefined)], ['all of them', 'cua, lane-catalog', 'none', 'none']);
    // DSH's permissions projection, from either place the window's store keeps it.
    assert.equal(permissionIn({ projectionsBySession: { s1: { values: { permissions: { currentValue: 'read-only' } } } } }, 's1'), 'read-only');
    assert.equal(permissionIn({ byId: { s1: { projectionValues: { permissions: { currentValue: 'workspace-write' } } } } }, 's1'), 'workspace-write');
    assert.equal(permissionIn({ byId: { s1: {} } }, 's1'), undefined);
    assert.equal(permissionIn(undefined, 's1'), undefined);

    // What each thread can reach: the preset DSH shows now wins over the one the plugin last saw.
    const info = {
        access: { yourTools: { value: 'asked' }, threadPermission: { value: 'workspace-write' } }, guarded: ['lane-catalog', 'cua'], permissions: catalog,
        threads: [{ id: 't1', session: 's1', permission: 'workspace-write', tools: ['lane-catalog'] }, { id: 't2', session: 's2', permission: 'workspace-write', tools: [] }, { id: 't3', tools: [] }],
    };
    assert.deepEqual(plain(accessOf(info, { s2: 'read-only' })), { s1: { permission: 'workspace-write', tools: ['lane-catalog'] }, s2: { permission: 'read-only', tools: [] } });
    assert.deepEqual(plain(accessOf(null, {})), {});
    // The menu's access rows: what new threads start on, and the user's tools once any are listed.
    assert.deepEqual(plain(accessSummary(info)), { permission: { preset: 'workspace-write', name: 'Workspace Write' }, tools: 'Only when asked' });
    assert.equal(accessSummary({ ...info, access: { ...info.access, yourTools: { value: 'always' } } }).tools, 'Always');
    assert.deepEqual(plain(accessSummary({ ...info, guarded: [] })), { permission: { preset: 'workspace-write', name: 'Workspace Write' } });
    assert.deepEqual(plain(accessSummary({ ...info, permissions: null })), { tools: 'Only when asked' });
    assert.deepEqual(plain(accessSummary({ ...info, guarded: [], permissions: null })), {});
    assert.deepEqual(plain(accessSummary(null)), {});

    // A row names the user's tools it has, and a permission other than new threads' default.
    const row = { id: 't1', title: 'Check lanes', line: 'Running', dot: 'ongoing', session: 's1' };
    const bodyOf = (el) => (el.props.className === 'dshp-t-row' ? el : el.children[0]);
    const mainOf = (el) => bodyOf(el).children.find((c) => c?.props?.className === 'dshp-t-main');
    const chips = (access) => {
        const main = mainOf(ThreadRow({ row, now: 0, onOpen() {}, access, quietPermission: 'workspace-write', permissions: catalog }));
        return { label: main.props['aria-label'], tools: textIn(byClass(main, 'dshp-t-tools')), permission: byClass(main, 'dshp-t-perm').map((e) => [e.props['data-projects-thread-permission'], textIn(e)]) };
    };
    assert.deepEqual(plain(chips({ permission: 'workspace-write', tools: ['lane-catalog'] })),
        { label: 'Check lanes. Running. Your tools: lane-catalog', tools: 'lane-catalog', permission: [] });
    assert.deepEqual(plain(chips({ permission: 'read-only', tools: [] })),
        { label: 'Check lanes. Running. Read Only', tools: '', permission: [['read-only', 'Read Only']] });
    assert.deepEqual(plain(chips({ permission: 'danger-full-access', tools: 'all' })),
        { label: 'Check lanes. Running. Full access. Your tools: all of them', tools: 'all of them', permission: [['danger-full-access', 'Full access']] });
    assert.deepEqual(plain(chips(undefined)), { label: 'Check lanes. Running', tools: '', permission: [] });

    // The menu's top: rows for new threads' permission and the user's tools, each opening Project settings at Access.
    const picked = [];
    const summary = ModelsSummary({ coordinator: 'V4 · Max', thread: 'V4 · High', access: accessSummary(info), onPick: (id) => picked.push(id) });
    const rows = summary.children.filter(Boolean);
    assert.deepEqual(rows.map((r) => r.props['data-projects-models']), ['coordinator', 'thread', 'access', 'tools']);
    assert.deepEqual(rows.slice(2).map((r) => r.props['aria-label']),
        ['Thread access: Workspace Write. Change it in Project settings', 'Your tools: Only when asked. Change it in Project settings']);
    rows[2].props.onClick();
    rows[3].props.onClick();
    assert.deepEqual(picked, ['access', 'access']);
    assert.equal(ModelsSummary({ coordinator: 'V4 · Max', thread: 'V4 · High' }).children.filter(Boolean).length, 2);
    assert.equal(ModelsSummary({ coordinator: 'V4 · Max', thread: 'V4 · High', access: {} }).children.filter(Boolean).length, 2);
});

test('browser half: thread rows, cards and links read the projection as DSH sends it', () => {
    const { client } = loadClient();
    const { projectContext, rowsOf, countsOf, summaryText, cardsOf, cardView, resolveLink, linkTarget, chatAddress, chatSessionOf, isThreadRow } = client.internals;
    const coordValue = { role: 'coordinator', project: { id: 'p', name: 'DSH Plugins' }, threads: [
        { id: 't1', session: 's-t1', title: 'Add CI', resolved: false, created: '2026-10-09T10:00:00.000Z', handback: { status: 'done', summary: 'CI added.', at: '2026-10-09T11:00:00.000Z' } },
        { id: 't2', session: 's-t2', title: 'Fix login', resolved: false, created: '2026-10-09T12:00:00.000Z', handback: { status: 'needs_decision', summary: 'Pick A or B.', at: '2026-10-09T13:00:00.000Z' } },
        { id: 't3', session: 's-t3', title: 'Write docs', resolved: false, created: '2026-10-09T14:00:00.000Z' },
        { id: 't4', session: 's-t4', title: 'Old spike', resolved: true, created: '2026-10-08T14:00:00.000Z' },
    ], cards: [
        { turn: 2, seq: 10, kind: 'start', thread: 't3' },
        { turn: 2, seq: 11, kind: 'send', thread: 't3', status: 'steer' },
        { turn: 2, seq: 12, kind: 'start', thread: 't4' },
        { turn: 3, seq: 20, kind: 'handback', thread: 't2', status: 'needs_decision' },
    ] };
    const threadValue = { role: 'thread', project: { name: 'DSH Plugins' }, coordinator: 's-c', thread: { id: 't3', title: 'Write docs' },
        cards: [{ turn: 1, seq: 5, kind: 'handback', thread: 't3', status: 'progress' }] };
    // The session list as DSH's store holds it: values on rows (cached) or loaded per session.
    const state = {
        ids: ['s-c', 's-t1', 's-t3', 's-plain'],
        phase: 'ready',
        byId: {
            's-c': { id: 's-c', title: '◆ DSH Plugins', projectionValues: { projectSession: coordValue } },
            's-t1': { id: 's-t1', title: 'DSH Plugins › Add CI' },
            's-t3': { id: 's-t3', title: 'DSH Plugins › Write docs', running: true, updatedAt: Date.parse('2026-10-09T15:00:00.000Z') },
            's-plain': { id: 's-plain', title: 'Something else' },
        },
        projectionsBySession: { 's-t3': { state: 'ready', values: { projectSession: threadValue } } },
    };
    const statuses = new Map([['s-t3', { running: true }]]);

    // The coordinator's roster, newest activity first, each with what it needs.
    const coord = projectContext(state, 's-c');
    const rows = rowsOf(coord.roster, statuses, state.byId);
    assert.deepEqual(plain(rows.map((r) => [r.id, r.group, r.dot, r.line])), [
        ['t3', 'running', 'ongoing', 'Working…'],
        ['t2', 'waiting', 'warning', 'Needs your decision · Pick A or B.'],
        ['t1', 'done', 'done', 'Done · CI added.'],
        ['t4', 'resolved', 'done', 'Resolved'],
    ]);
    assert.deepEqual(plain(countsOf(rows)), { open: 3, running: 1, waiting: 1, resolved: 1, failed: 0 });
    assert.equal(summaryText(countsOf(rows)), '3 open · 1 waiting on you · 1 running · 1 resolved');
    // A thread reads the roster from its coordinator, and knows it is still loading before then.
    const thread = projectContext(state, 's-t3');
    assert.equal(thread.coordinator, 's-c');
    assert.equal(thread.roster, coord.roster);
    const early = projectContext({ ...state, byId: { ...state.byId, 's-c': { id: 's-c' } }, projectionsBySession: { ...state.projectionsBySession, 's-c': { state: 'loading', values: {} } } }, 's-t3');
    assert.deepEqual([early.roster, early.load], [null, 'loading']);
    assert.equal(projectContext(state, 's-plain'), undefined);

    // Cards: one per thread in a turn, the first action wins.
    assert.deepEqual(plain(cardsOf(coordValue, 2).map((c) => [c.kind, c.thread])), [['start', 't3'], ['start', 't4']]);
    assert.equal(cardsOf(coordValue, 9).length, 0);
    const [handback] = cardsOf(coordValue, 3).map((card) => cardView(card, coord, statuses, state.byId, 's-c'));
    // A card says its thread's state once, beside the name: while the handback's state is the thread's, its line says only "Handback".
    assert.deepEqual(plain([handback.verb, handback.title, handback.session, handback.state.label, handback.icon]), ['Handback', 'Fix login', 's-t2', 'Needs a decision', 'IconTreeCornerRegular']);
    const steer = cardView({ turn: 2, seq: 11, kind: 'send', thread: 't3', status: 'steer' }, coord, statuses, state.byId, 's-c');
    assert.deepEqual(plain([steer.verb, steer.state.label]), ['Steered a thread', 'Running']);
    const verbOf = (card) => { const v = cardView({ turn: 2, seq: 1, ...card }, coord, statuses, state.byId, 's-c'); return [v.verb, v.state.label]; };
    assert.deepEqual(plain([
        verbOf({ kind: 'update', thread: 't4', status: 'resolved' }), verbOf({ kind: 'update', thread: 't3', status: 'resolved' }),
        verbOf({ kind: 'handback', thread: 't3', status: 'done' }), verbOf({ kind: 'handback', thread: 't3', status: 'progress' }),
        verbOf({ kind: 'approval', thread: 't3' }),
    ]), [
        ['Updated a thread', 'Resolved'], ['Resolved a thread', 'Running'],
        // Once the thread moved on, the line keeps what the event said.
        ['Handback · Done', 'Running'], ['Progress update', 'Running'],
        ['Asked for your approval', 'Running'],
    ]);
    // In a thread, its own handback card points back at the coordinator.
    const own = cardView(threadValue.cards[0], thread, statuses, state.byId, 's-t3');
    assert.deepEqual(plain([own.verb, own.title, own.session]), ['Handed back to the coordinator · Progress update', '◆ DSH Plugins', 's-c']);
    // While the project is paused, the thread's own card says its handback waits, and the coordinator's cards
    // read a held handback as the Threads menu does.
    const heldOwn = cardView(threadValue.cards[0], thread, statuses, state.byId, 's-t3', undefined, [{ thread: 't3', status: 'progress' }]);
    assert.deepEqual(plain([heldOwn.verb, heldOwn.note, heldOwn.icon]), ['Handback held · Progress update', 'The project is paused, so the coordinator gets this handback when you resume.', 'IconPauseOutlineRegular']);
    assert.equal(cardView(threadValue.cards[0], thread, statuses, state.byId, 's-t3', undefined, [{ thread: 't9', status: 'done' }]).verb, 'Handed back to the coordinator · Progress update');
    const heldCard = cardView({ turn: 2, seq: 12, kind: 'send', thread: 't2' }, coord, statuses, state.byId, 's-c', undefined, [{ thread: 't2', status: 'blocked' }]);
    assert.deepEqual(plain([heldCard.state.label, heldCard.state.dot, heldCard.row.line, heldCard.row.held]), ['Blocked', 'warning', 'Blocked · held until you resume', true]);

    // A thread link as DSH resolves `.dsh-thread/t3` against the coordinator's session.
    const target = linkTarget(`dsh-resource://file/session/${encodeURIComponent('s-c')}/.dsh-thread/T3`);
    assert.deepEqual(plain(target), { sessionId: 's-c', threadId: 't3' });
    assert.deepEqual(plain(resolveLink(state, target)), { state: 'found', session: 's-t3', coordinator: 's-c' });
    assert.equal(resolveLink(state, { sessionId: 's-c', threadId: 't9' }).state, 'missing');
    assert.equal(resolveLink(state, { sessionId: 's-t3', threadId: 't3' }).state, 'found');
    assert.equal(resolveLink(state, { sessionId: 'not-loaded', threadId: 't1' }).state, 'loading');
    assert.equal(resolveLink(state, undefined).state, 'invalid');
    assert.equal(linkTarget('dsh-resource://file/session/s-c/.dsh-thread/notes.md'), undefined);

    // A sidebar chat address keeps any session id intact.
    assert.equal(chatSessionOf(chatAddress('sess/with ?#%')), 'sess/with ?#%');
    assert.equal(chatSessionOf('dsh-resource://subagentchat/session/x'), undefined);

    // Sidebar marks: from the projection, or from the "<project> › " title before DSH has folded the row.
    assert.deepEqual(['s-t3', 's-t1', 's-c', 's-plain'].map((id) => isThreadRow(state, id)), [true, true, false, false]);
});

test('browser half: a failed or stopped thread reads Failed or Stopped everywhere, with its reason and Retry or Resume', () => {
    const { client } = loadClient();
    const { projectContext, rowsOf, countsOf, cardView, rowState, endingIn, endingLine, openSessions, markState, hoverLine, withHeld, continueError, GROUPS } = client.internals;
    const at = (h) => `2026-10-10T${String(h).padStart(2, '0')}:00:00.000Z`;
    const failed = { state: 'failed', kind: 'error', message: 'The model rejected the request.', turn: 1, seq: 9, at: at(10) };
    const stopped = { state: 'stopped', kind: 'aborted', cause: 'user', turn: 1, seq: 7, at: at(10) };
    const coordValue = { role: 'coordinator', project: { id: 'p', name: 'Storefront' }, threads: [
        { id: 't6', session: 's-t6', title: 'Refactor cart state', resolved: false, created: at(8) },
        { id: 't7', session: 's-t7', title: 'Generate size-guide tables', resolved: false, created: at(8) },
        // A done handback after a stop: the handback is the news.
        { id: 't8', session: 's-t8', title: 'Caching spike', resolved: false, created: at(8), handback: { status: 'done', summary: 'Spike done.', at: at(11) } },
        // A failure after a decision handback: the failure is the news.
        { id: 't9', session: 's-t9', title: 'Fix the login loop', resolved: false, created: at(8), handback: { status: 'needs_decision', summary: 'A or B?', at: at(9) } },
        { id: 't10', session: 's-t10', title: 'Old', resolved: true, created: at(7) },
    ], cards: [
        { turn: 4, seq: 30, kind: 'start', thread: 't7' },
        { turn: 5, seq: 40, kind: 'idle', thread: 't7', status: 'failed' },
        { turn: 5, seq: 41, kind: 'idle', thread: 't6', status: 'stopped' },
        { turn: 5, seq: 42, kind: 'idle', thread: 't8' },
    ] };
    const thread = (id, ending) => ({ role: 'thread', project: { name: 'Storefront' }, coordinator: 's-c', thread: { id }, ...(ending ? { ending } : {}) });
    const state = {
        byId: { 's-c': { id: 's-c', title: '◆ Storefront', projectionValues: { projectSession: coordValue } } },
        projectionsBySession: {
            's-t6': { values: { projectSession: thread('t6', stopped) } },
            's-t7': { values: { projectSession: thread('t7', failed) } },
            's-t8': { values: { projectSession: thread('t8', stopped) } },
            's-t9': { values: { projectSession: thread('t9', { ...failed, at: at(12) }) } },
            's-t10': { values: { projectSession: thread('t10', failed) } },
        },
    };
    const coord = projectContext(state, 's-c');
    assert.deepEqual(plain(openSessions(coord.roster)), ['s-t6', 's-t7', 's-t8', 's-t9'], 'resolved threads need no ending');
    const endings = Object.fromEntries(openSessions(coord.roster).map((id) => [id, endingIn(state, id)]).filter(([, e]) => e));
    const rows = rowsOf(coord.roster, new Map(), state.byId, endings);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.deepEqual(plain(['t7', 't6', 't8', 't9', 't10'].map((id) => [id, byId[id].group, byId[id].dot, byId[id].stateLabel, byId[id].line])), [
        ['t7', 'waiting', 'error', 'Failed', 'Failed · The model rejected the request.'],
        ['t6', 'idle', 'idle', 'Stopped', 'Stopped before it finished'],
        ['t8', 'done', 'done', 'Done', 'Done · Spike done.'],
        ['t9', 'waiting', 'error', 'Failed', 'Failed · The model rejected the request.'],
        ['t10', 'resolved', 'done', 'Resolved', 'Resolved'],
    ]);
    assert.deepEqual(plain(countsOf(rows)), { open: 4, running: 0, waiting: 2, resolved: 1, failed: 2 });
    assert.deepEqual(plain(GROUPS.map((g) => g.label)), ['Waiting on you', 'Running', 'Done', 'Idle', 'Resolved']);
    // Running, a prompt and resolved win over an old ending; a held handback is newer than any.
    assert.equal(rowState({ running: true, ending: failed }).label, 'Running');
    assert.equal(rowState({ pending: { kind: 'approval' }, ending: failed }).label, 'Needs you');
    assert.equal(rowState({ resolved: true, ending: failed }).label, 'Resolved');
    assert.equal(rowState({ hb: { status: 'blocked' } }).label, 'Blocked');
    assert.deepEqual(plain(withHeld([byId.t7], [{ thread: 't7', status: 'done' }]).map((r) => [r.group, r.stateLabel, r.line, r.ending])),
        [['done', 'Done', 'Done · held until you resume', null]]);
    // Why, for each way a turn ends.
    assert.deepEqual(plain([
        { state: 'failed', kind: 'blocked' }, { state: 'failed', kind: 'signed-out' }, { state: 'failed', kind: 'error' },
        { state: 'stopped', kind: 'interrupted' }, { state: 'stopped', kind: 'max-tokens' }, { state: 'stopped', kind: 'aborted', cause: 'hook', hook: 'budget' },
        { state: 'stopped', kind: 'aborted', cause: 'disposed' },
    ].map(endingLine)), [
        'Failed · A DSH plugin blocked the turn.', 'Failed · You signed out of DeepSeek.', 'Failed · DSH couldn\'t finish the turn.',
        'Stopped · DSH closed while it ran.', 'Stopped · It reached the output token limit.', 'Stopped · A DSH plugin stopped it (budget).',
        'Stopped · Its session closed while it ran.',
    ]);

    // Cards: the idle note's card names the failure; every card of the thread says its state now.
    const statuses = new Map();
    const views = coordValue.cards.map((card) => cardView(card, coord, statuses, state.byId, 's-c', endings));
    assert.deepEqual(plain(views.map((v) => [v.threadId, v.verb, v.tone ?? null, v.state.label, v.row.ending?.state ?? null])), [
        ['t7', 'Started a thread', null, 'Failed', 'failed'],
        ['t7', 'Ended without a handback', 'error', 'Failed', 'failed'],
        ['t6', 'Ended without a handback', null, 'Stopped', 'stopped'],
        ['t8', 'Went idle without a handback', null, 'Done', null],
    ]);
    // No word twice on a card: the state is said beside the name, not again in its line.
    for (const v of views) assert.ok(!v.verb.split(/\W+/).includes(v.state.label), `${v.verb} / ${v.state.label}`);
    assert.deepEqual(plain(views.slice(0, 3).map((v) => v.icon)), ['IconBranchOutlineRegular', 'IconWarningTriangleOutlineRegular', 'IconStopFillRegular']);

    // The session list: a failed thread's mark is red, a waiting one's amber; DSH draws running ones.
    const marked = { ...state, projectionsBySession: { ...state.projectionsBySession, 's-t11': { values: { projectSession: thread('t11') } } } };
    marked.byId = { ...state.byId, 's-c': { ...state.byId['s-c'], projectionValues: { projectSession: { ...coordValue, threads: [...coordValue.threads,
        { id: 't11', session: 's-t11', title: 'CDN', resolved: false, handback: { status: 'blocked', summary: 'Token expired.', at: at(9) } }] } } } };
    assert.deepEqual(plain(['s-t7', 's-t6', 's-t8', 's-t11', 's-t10', 's-c', 'nope'].map((id) => markState(marked, id))),
        ['error:Failed', '', '', 'warning:Blocked', '', '', '']);

    // The hover card says what the thread last did; DSH ends it with the session's own status.
    assert.deepEqual(plain(['t7', 't6', 't8', 't9'].map((id) => hoverLine(byId[id]))), [
        'Last turn failed · The model rejected the request.', 'Last turn stopped before it finished', 'Last handback · Done · Spike done.', 'Last turn failed · The model rejected the request.',
    ]);
    assert.equal(hoverLine({ ...byId.t7, pending: true }), undefined);
    assert.equal(hoverLine(rowsOf([{ id: 't1', session: 's1', title: 'x', resolved: false }], new Map(), {}, {})[0]), 'No handback yet');

    // A refusal reads as the plugin's sentence.
    assert.equal(continueError({ code: 'projects/refused', message: 't7 is running already' }), 'T7 is running already.');
    assert.equal(continueError({ code: 'projects/unreachable', message: 'socket' }), 'Couldn\'t reach the thread.');
});

test('browser half: each session list row says its place in a project, and the CSS nests by it', () => {
    const { client } = loadClient();
    const { rowPlace, nestingRules } = client.internals;
    const coord = (name) => ({ role: 'coordinator', project: { name }, threads: [] });
    const state = {
        byId: {
            c: { title: '◆ DSH Plugins', projectionValues: { projectSession: coord('DSH Plugins') } },
            t1: { title: 'DSH Plugins › Add CI' },
            t2: { title: 'Fix login', projectionValues: { projectSession: { role: 'thread', coordinator: 'c', thread: { id: 't2' } } } },
            t3: { title: 'Renamed by hand', projectionValues: { projectSession: { role: 'thread', coordinator: 'c', thread: { id: 't3' } } } },
            o: { title: '◆ Other' },
            ot: { title: 'Other › Its thread' },
            plain: { title: 'Release notes' },
            odd: { title: 'Nobody › Not a thread' },
            lost: { title: 'x', projectionValues: { projectSession: { role: 'thread', thread: { id: 't9' } } } },
        },
    };
    // A coordinator by its projection or its "◆ " title; a thread by its projection whatever its title,
    // or (before its projection reaches the list) by an old "<project> › " title with that coordinator listed.
    assert.equal(rowPlace(state, 'c'), 'coordinator:c');
    assert.equal(rowPlace(state, 'o'), 'coordinator:o');
    assert.equal(rowPlace(state, 't1'), 'thread:c');
    assert.equal(rowPlace(state, 't2'), 'thread:c');
    assert.equal(rowPlace(state, 't3'), 'thread:c');
    assert.equal(rowPlace(state, 'ot'), 'thread:o');
    assert.equal(rowPlace(state, 'plain'), '');
    assert.equal(rowPlace(state, 'odd'), '');
    assert.equal(rowPlace(state, 'lost'), '');
    assert.equal(rowPlace(state, 'missing'), '');
    assert.equal(rowPlace(undefined, 'c'), '');

    // The rules name the coordinator in every selector, lay out and move only the wrappers of its own
    // workspace's list (coordinator, then its threads, then the rest), and change rows only through the plugin's own marks.
    const css = nestingRules('ses_01.ab-c:9');
    const rules = css.split('\n');
    const list = '[role="tree"] :has(>*>[data-row-key] [data-projects-row="coordinator"][data-projects-of="ses_01.ab-c:9"])';
    const C = ':has(>[data-row-key] [data-projects-row="coordinator"][data-projects-of="ses_01.ab-c:9"])';
    const T = ':has(>[data-row-key] [data-projects-row="thread"][data-projects-of="ses_01.ab-c:9"])';
    assert.equal(rules.length, 8);
    for (const rule of rules) assert.ok(rule.startsWith(list), rule);
    assert.ok(rules.includes(`${list}{display:flex;flex-direction:column}`));
    assert.ok(rules.includes(`${list}>${C}{order:1}`));
    assert.ok(rules.includes(`${list}>${T}{order:2}`));
    assert.ok(rules.includes(`${list}>:is(${C},${T})~:not(${C},${T}){order:3}`));
    assert.ok(rules.includes(`${list}>${T}>[data-row-key]{padding-inline-start:calc(var(--dshp-nest,30px) + var(--dsh-workspace-indent,0px))}`));
    // A :has() inside another makes a browser drop the whole rule.
    for (const rule of rules) assert.doesNotMatch(rule, /:has\([^)]*:has\(/, rule);
    // An id that could break out of the selector gets no rules.
    assert.equal(nestingRules('a"] *{display:none} [x="'), '');
    assert.equal(nestingRules(''), '');
    assert.equal(nestingRules(undefined), '');
});

test('browser half: a thread opens beside its coordinator, and in full view where the window is too narrow or when asked', async () => {
    const { client } = loadClient();
    const { roomFor } = client.internals;
    // DSH's own rule: a 400 px main chat and a 300 px right sidebar beside the left sidebar; under 768 px it covers the window.
    assert.equal(roomFor(1280, 280), true);
    assert.equal(roomFor(980, 280), true);
    assert.equal(roomFor(979, 280), false);
    assert.equal(roomFor(1100, 418), false);
    assert.equal(roomFor(1118, 418), true);
    assert.equal(roomFor(1713, 418), true);
    assert.equal(roomFor(768, 0), true);
    assert.equal(roomFor(767, 0), false);

    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const threadValue = { role: 'thread', coordinator: 'c', thread: { id: 't1' } };
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { projectSession: value } } : {}), retainedBy: { mainView: main } });
    let snapshot = { ids: ['c', 't', 'p'], byId: { c: row(coordValue), t: row(threadValue), p: row(null, 1) }, phase: 'ready', projectionsBySession: {} };
    const listeners = new Set();
    const set = (byId) => { snapshot = { ...snapshot, byId: { ...snapshot.byId, ...byId } }; for (const fn of [...listeners]) fn(); };
    const opened = [];
    const beside = [];
    const holds = [];
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push(slot); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: {
            list: { getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
            retain: (id, options) => { holds.push([id, options.source]); set({ [id]: { ...snapshot.byId[id], retainedBy: { mainView: (snapshot.byId[id].retainedBy.mainView ?? 0) + 1 } } }); return { release: () => holds.push(['release', id]) }; },
        },
        // DSH's main view: the chat it opens takes the hold, the one before lets go.
        uiWorkspace: {
            openSession: (id) => {
                opened.push(id);
                const byId = {};
                for (const [key, value] of Object.entries(snapshot.byId)) byId[key] = { ...value, retainedBy: { mainView: key === id ? 1 : 0 } };
                set(byId);
            },
        },
        sidebarRight: { mounted: { getSnapshot: () => 'c' }, openResource: (address, options) => beside.push([decodeURIComponent(address.split('/').pop()), options.kind]) },
    };
    client.apply(ctx);
    const { projects } = registered.find((r) => r.name === 'main').inject();
    // A thread from a card, a row or the Projects page: its coordinator as the main chat, the thread beside it.
    projects.openThread('t');
    assert.deepEqual(opened, ['c']);
    assert.deepEqual(beside, [['t', 'projectthread']]);
    // Any other chat opens as itself; Full view opens the thread as the main chat.
    projects.openThread('p');
    projects.openFull('t');
    assert.deepEqual(opened, ['c', 'p', 't']);
    assert.equal(beside.length, 1);

    // DSH opening a thread itself (its session list, its search): the plugin holds the coordinator while DSH switches,
    // then the coordinator takes the thread's place and the thread opens beside it.
    ctx.uiWorkspace.openSession('p');
    opened.length = 0;
    beside.length = 0;
    set({ t: { ...snapshot.byId.t, retainedBy: { mainView: 1 } } });
    assert.deepEqual(holds, [['c', 'mainView']]);
    set({ p: { ...snapshot.byId.p, retainedBy: { mainView: 0 } } });
    assert.deepEqual(opened, ['c']);
    assert.deepEqual(holds, [['c', 'mainView'], ['release', 'c']]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(beside, [['t', 'projectthread']]);
    // A thread opened in full view stays the main chat.
    holds.length = 0;
    opened.length = 0;
    beside.length = 0;
    projects.openFull('t');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual([opened, holds, beside], [['t'], [], []]);
});

test('browser half: with "Open threads beside their coordinator" off, a thread opens on its own and its menus pair it', async () => {
    const storage = new Map([['dsh-plugin-projects/open-beside', 'off']]);
    const { client } = loadClient({ storage });
    const { besidePref } = client.internals;
    assert.equal(besidePref.get(), false);
    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const threadValue = { role: 'thread', coordinator: 'c', thread: { id: 't1' } };
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { projectSession: value } } : {}), retainedBy: { mainView: main } });
    let snapshot = { ids: ['c', 't', 'p'], byId: { c: row(coordValue), t: row(threadValue), p: row(null, 1) }, phase: 'ready', projectionsBySession: {} };
    const listeners = new Set();
    const set = (byId) => { snapshot = { ...snapshot, byId: { ...snapshot.byId, ...byId } }; for (const fn of [...listeners]) fn(); };
    const opened = [];
    const beside = [];
    const holds = [];
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot, component) => { registered.push({ slot, component }); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: {
            list: { getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
            retain: (id, options) => { holds.push([id, options.source]); return { release: () => holds.push(['release', id]) }; },
        },
        uiWorkspace: {
            openSession: (id) => {
                opened.push(id);
                const byId = {};
                for (const [key, value] of Object.entries(snapshot.byId)) byId[key] = { ...value, retainedBy: { mainView: key === id ? 1 : 0 } };
                set(byId);
            },
        },
        sidebarRight: { mounted: { getSnapshot: () => 'c' }, openResource: (address, options) => beside.push([decodeURIComponent(address.split('/').pop()), options.kind]) },
    };
    client.apply(ctx);
    const { projects } = registered.find((r) => r.slot.name === 'main').slot.inject();
    // A thread from a row, a card's name or the Projects page opens as the main chat, as before the setting.
    projects.openThread('t');
    assert.deepEqual([opened, beside], [['t'], []]);
    // The card's Open, and "Open beside its coordinator", still pair it.
    projects.openPaired('t');
    assert.deepEqual([opened, beside], [['t', 'c'], [['t', 'projectthread']]]);
    // DSH opening a thread itself (its session list, its search): it stays as DSH opened it.
    ctx.uiWorkspace.openSession('p');
    opened.length = 0;
    beside.length = 0;
    set({ t: { ...snapshot.byId.t, retainedBy: { mainView: 1 } } });
    set({ p: { ...snapshot.byId.p, retainedBy: { mainView: 0 } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual([opened, holds, beside], [[], [], []]);
    // A thread's menu in the session list offers to pair it, even while it is the main chat.
    const item = registered.find((r) => r.slot.id === 'dsh-plugin-projects/full-view-item');
    const menuItem = () => item.component({ sessionId: 't', useMenuOpenState: () => [true, () => {}], useSessions: (select) => select(snapshot), ...item.slot.inject() });
    let shown = menuItem();
    assert.deepEqual(shown.children, ['Open beside its coordinator']);
    shown.props.onSelect();
    assert.deepEqual([opened, beside], [['c'], [['t', 'projectthread']]]);

    // Turned on (the plugin page's switch): kept for the next start, and threads pair again.
    besidePref.set(true);
    assert.equal(storage.get('dsh-plugin-projects/open-beside'), 'on');
    shown = menuItem();
    assert.deepEqual(shown.children, ['Open in full view']);
    opened.length = 0;
    beside.length = 0;
    projects.openThread('t');
    assert.deepEqual([opened, beside], [['c'], [['t', 'projectthread']]]);
    besidePref.set(false);
    assert.equal(storage.get('dsh-plugin-projects/open-beside'), 'off');
    // No storage at all (a locked-down window): on.
    assert.equal(loadClient().client.internals.besidePref.get(), true);
});

test('browser half: a click on a thread row in DSH\'s session list opens the pair straight away, so DSH never shows the thread first', () => {
    let onClick;
    const document = {
        addEventListener: (type, fn, capture) => { if (type === 'click' && capture === true) onClick = fn; },
        removeEventListener: () => {}, querySelector: () => null,
        createElement: () => ({ dataset: {} }), head: { appendChild: () => {} },
    };
    const storage = new Map();
    const { client, window } = loadClient({ document, innerWidth: 1440, storage });
    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const threadValue = { role: 'thread', coordinator: 'c', thread: { id: 't1' } };
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { projectSession: value } } : {}), retainedBy: { mainView: main } });
    const snapshot = { ids: ['c', 't', 'p'], byId: { c: row(coordValue), t: row(threadValue), p: row(null, 1) }, phase: 'ready', projectionsBySession: {} };
    const opened = [];
    const beside = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: () => () => {} },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, retain: () => ({ release: () => {} }) },
        uiWorkspace: { openSession: (id) => opened.push(id) },
        sidebarRight: { mounted: { getSnapshot: () => 'c' }, openResource: (address, options) => beside.push([decodeURIComponent(address.split('/').pop()), options.kind]) },
    };
    client.apply(ctx);
    assert.equal(typeof onClick, 'function', 'one capturing listener for the whole window');
    // A click on a row of DSH's list (data-row-key="session:<id>"), or on a button inside it.
    const click = (id, { inButton = false, ...event } = {}) => {
        const rowEl = { getAttribute: (name) => (name === 'data-row-key' ? `session:${id}` : null), contains: () => true };
        const target = { closest: (selector) => (selector.includes('data-row-key') ? rowEl : inButton ? { button: true } : null) };
        const e = { button: 0, defaultPrevented: false, target, prevented: false, stopped: false, ...event };
        e.preventDefault = () => { e.prevented = true; };
        e.stopPropagation = () => { e.stopped = true; };
        onClick(e);
        return e.prevented && e.stopped;
    };
    // A thread: its coordinator as the main chat and the thread beside it, without DSH opening the thread first.
    assert.equal(click('t'), true);
    assert.deepEqual([opened, beside], [['c'], [['t', 'projectthread']]]);
    // DSH's as before: another chat, the row's own buttons, a modifier key, another mouse button, a click already handled.
    opened.length = 0;
    beside.length = 0;
    assert.deepEqual([click('p'), click('t', { inButton: true }), click('t', { metaKey: true }), click('t', { button: 1 }), click('t', { defaultPrevented: true })],
        [false, false, false, false, false]);
    // Also when the window has no room for both, or the setting is off.
    window.innerWidth = 700;
    assert.equal(click('t'), false);
    window.innerWidth = 1440;
    client.internals.besidePref.set(false);
    assert.equal(click('t'), false);
    client.internals.besidePref.set(true);
    // And for the thread that is already the main chat (full view).
    snapshot.byId = { ...snapshot.byId, t: row(threadValue, 1), p: row(null, 0) };
    assert.equal(click('t'), false);
    assert.deepEqual([opened, beside], [[], []]);
});

test('browser half: a thread\'s newest card says when its last turn ended, and how many times in a row', () => {
    const { client } = loadClient();
    const { ThreadCard, clockOf, againText } = client.internals;
    const now = Date.parse('2026-10-10T18:30:00');
    assert.deepEqual([clockOf(Date.parse('2026-10-10T14:58:00'), now), clockOf(Date.parse('2026-10-09T09:05:00'), now), clockOf(Date.parse('2025-12-31T23:59:00'), now), clockOf(NaN, now)],
        ['14:58', 'Oct 9, 09:05', 'Dec 31, 2025, 23:59', '']);
    assert.deepEqual([1, 2, 3, undefined].map(againText), ['', 'twice', '3 times', '']);
    const at = new Date(Date.now() - 60000);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const projects = { openThread: () => {}, openPaired: () => {}, openFull: () => {}, openReview: () => {}, facts: { continueThread: async () => ({ ok: true }) } };
    const view = (ending, state) => ({
        key: 't7', kind: 'idle', threadId: 't7', seq: 5, newest: true, title: 'Generate size-guide tables', session: 's-t7', verb: 'Ended without a handback', icon: 'IconWarningTriangleOutlineRegular',
        state, row: { id: 't7', session: 's-t7', title: 'Generate size-guide tables', ending },
    });
    const failed = { state: 'failed', kind: 'error', message: 'The model rejected the request.', turn: 3, seq: 9, at: at.toISOString() };
    // Failed once: the state once, beside the name; the time and the reason under it; Retry.
    let card = ThreadCard({ view: view(failed, { dot: 'error', label: 'Failed' }), projects });
    assert.deepEqual([textIn(byClass(card, 'dshp-t-card-state-label')), textIn(byClass(card, 'dshp-t-card-state-text')), textIn(byClass(card, 'dshp-t-card-why'))],
        ['Failed', 'Failed', `${hhmm} · The model rejected the request.`]);
    assert.equal(elementsOf(card).find((e) => e.props?.['data-projects-continue'])?.props['data-projects-continue'], 'retry');
    // Retried and failed again: it says so, and the time moves on.
    card = ThreadCard({ view: view({ ...failed, times: 2, turn: 4 }, { dot: 'error', label: 'Failed' }), projects });
    assert.deepEqual([textIn(byClass(card, 'dshp-t-card-state-label')), textIn(byClass(card, 'dshp-t-card-state-text'))], ['Failed', 'Failed twice']);
    // Stopped with no reason to give: just when.
    card = ThreadCard({ view: view({ state: 'stopped', kind: 'aborted', cause: 'user', turn: 3, seq: 9, at: at.toISOString() }, { dot: 'idle', label: 'Stopped' }), projects });
    assert.equal(textIn(byClass(card, 'dshp-t-card-why')), hhmm);
    // A card that isn't the thread's newest says none of it.
    card = ThreadCard({ view: { ...view(failed, { dot: 'error', label: 'Failed' }), newest: false }, projects });
    assert.deepEqual([byClass(card, 'dshp-t-card-why').length, textIn(byClass(card, 'dshp-t-card-state-text'))], [0, 'Failed']);
});

test('browser half: DSH\'s session list is grouped by project, collapsible, with Other workspaces last', () => {
    const { client } = loadClient();
    const { sidebarGroups, sidebarRules, OTHERS } = client.internals;
    const items = ['w1', 'w2', 'w3', 'w4', 'w5'].map((workspaceId) => ({ workspaceId, sessionIds: [] }));
    const listed = [
        { id: 'a', name: 'Alpha', coordinator: 's-a', workspaces: [{ id: 'w2' }, { id: 'gone' }] },
        { id: 'b', name: 'Beta', workspaces: [{ id: 'w1' }, { id: 'w2' }, { id: 'w4' }] },
        { id: 'c', name: 'Empty', workspaces: [{ id: 'gone' }] },
    ];
    // In the plugin's order; a workspace counts once, in its first project; DSH's deleted ones and empty projects drop out.
    assert.deepEqual(plain(sidebarGroups(listed, items)), [
        { id: 'a', name: 'Alpha', glyph: '◆', workspaces: ['w2'] },
        { id: 'b', name: 'Beta', glyph: '◇', workspaces: ['w1', 'w4'] },
        { id: OTHERS, name: 'Other workspaces', glyph: '', workspaces: ['w3', 'w5'] },
    ]);
    // No project holding a listed workspace, or not known yet: DSH's list as it is.
    assert.equal(sidebarGroups([listed[2]], items), null);
    assert.equal(sidebarGroups(null, items), null);
    assert.equal(sidebarGroups(listed, undefined), null);

    const groups = sidebarGroups(listed, items);
    const rules = sidebarRules(groups, new Set(['b'])).split('\n');
    const on = '[data-slot="sidebar.workspaces"] [role="tree"]:has(>[data-projects-sb]):has(>div>*>[data-row-key^="workspace:"])';
    const section = (id) => `div:has(>*>[data-row-key="workspace:${id}"])`;
    for (const rule of rules) assert.doesNotMatch(rule, /:has\([^)]*:has\(/, rule);
    assert.ok(rules.includes(`${on}{display:flex;flex-direction:column}`));
    // Each workspace's section right after its project's header (headers take the even places), a collapsed project's hidden.
    assert.ok(rules.includes(`${on}>${section('w2')}{order:1}`));
    assert.ok(rules.includes(`${on}>${section('w1')}{order:3;display:none!important}`));
    assert.ok(rules.includes(`${on}>${section('w3')}{order:5}`));
    // Headers hide where DSH shows no workspaces (In one list, search).
    assert.ok(rules.includes('[data-slot="sidebar.workspaces"] [role="tree"]:not(:has(>div>*>[data-row-key^="workspace:"]))>[data-projects-sb]{display:none}'));
    // An id that could break out of a selector gets no rule.
    const odd = sidebarRules([{ id: 'x', name: 'X', glyph: '◇', workspaces: ['a"] *{display:none} [x="'] }], new Set()).split('\n');
    for (const rule of odd) assert.doesNotMatch(rule, /display:none\} \[x=/);
});

test('browser half: the Projects page puts a project on one row: its workspaces, what waits on you, what runs, when it moved', () => {
    const { client } = loadClient();
    const { placeWorkspaces, chatsIn, pulseOf, pulseText, listText } = client.internals;
    const items = [
        { workspaceId: 'w1', title: 'api', path: '/home/u/api', sessionIds: ['s1', 's2', 's3', 'c'] },
        { workspaceId: 'w2', title: '', path: '/home/u/web', sessionIds: ['s4'] },
        { workspaceId: 'w3', title: 'loose', path: '/home/u/loose', sessionIds: [] },
    ];
    const listed = [{ id: 'p', workspaces: [{ id: 'w1' }, { id: 'w2' }, { id: 'gone', title: 'Gone' }] }];
    const placed = placeWorkspaces(listed, items, true);
    assert.deepEqual(plain(placed.of.get('p')).map((ws) => [ws.id, ws.title]), [['w1', 'api'], ['w2', 'web']]);
    assert.deepEqual(plain(placed.others).map((ws) => ws.id), ['w3']);
    // Before DSH's list has loaded, a workspace the plugin knows stays.
    assert.deepEqual(plain(placeWorkspaces(listed, items, false).of.get('p')).map((ws) => ws.id), ['w1', 'w2', 'gone']);

    const sessions = {
        byId: {
            s1: { id: 's1', title: 'One', updatedAt: 100 },
            s2: { id: 's2', title: 'Two', updatedAt: 300, running: true },
            s3: { id: 's3', title: 'Blank', updatedAt: 500, blank: true },
            s4: { id: 's4', title: 'Four', updatedAt: 200 },
            c: { id: 'c', title: '◆ P', updatedAt: 50, projectionValues: { projectSession: { role: 'coordinator', project: { name: 'P' }, threads: [] } } },
        },
    };
    // A workspace's chats, newest first: none archived or blank, and no coordinator or thread.
    assert.deepEqual(plain(chatsIn(placed.of.get('p')[0], sessions, new Set(['s9'])).map((row) => row.id)), ['s2', 's1']);
    assert.deepEqual(plain(chatsIn(placed.of.get('p')[0], sessions, new Set(['s2'])).map((row) => row.id)), ['s1']);
    const statuses = new Map([['s1', { pendingInteraction: { kind: 'approval' } }]]);
    assert.deepEqual(plain(pulseOf(['s1', 's2', 's4', 'missing', undefined], sessions, statuses)), { waiting: 1, running: 1, at: 300 });
    assert.deepEqual(plain(pulseOf([], sessions, statuses)), { waiting: 0, running: 0, at: 0 });
    assert.equal(pulseText({ waiting: 2, running: 1, at: 1 }), ', 2 waiting on you, 1 running');
    assert.equal(pulseText({ waiting: 0, running: 0, at: 1 }), '');
    assert.deepEqual([listText([]), listText(['A']), listText(['A', 'B']), listText(['A', 'B', 'C'])], ['', 'A', 'A and B', 'A, B and C']);
});

test('session mode: a failed selection is reported, and the coordinator retries later', async () => {
    const { host, dir } = setup({}, undefined, SELECTING);
    await tick();
    const coord = coordinatorOf(host);
    host.services.llm = { async resolveCallConfig() { throw new Error('provider offline'); } };
    assert.doesNotMatch(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'T', brief: 'Go.' }), /Note/, 'a setting the coordinator didn\'t choose gets no note');
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'U', brief: 'Go.', effort: 'high' }), /Note: the model could not be set, so the thread runs on the DSH default/);
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Chat', brief: 'Help the user.' });
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Flaky', brief: 'Call the lane.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const ts = host.sessions.get(thread.id);
    ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: 1, reason: { kind: 'error', error: { message: 'provider unavailable', code: 'NETWORK' } } } });
    thread.ctx.emitStatus(thread, 'running');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.match(host.sessions.get(coord.id).prompts[0].text, /^\[Thread idle without a handback: t1 · "Flaky"\]\n\nThe turn failed: provider unavailable\n\nIt produced no reply text\./);
});

test('a failed or stopped thread shows in the roster until a turn finishes; Retry and Resume send it on from its coordinator', async () => {
    const { host, dir } = setup({}, undefined, { gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Flaky', brief: 'Call the lane.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const ts = host.sessions.get(thread.id);
    const turn = (reason) => {
        thread.ctx.emitStatus(thread, 'running');
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/start', data: { turn: ts.events.length } });
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: ts.events.length, reason } });
        thread.ctx.emitStatus(thread, 'idle');
    };
    const refused = (promise, pattern) => assert.rejects(promise, (error) => error.code === 'projects/refused' && pattern.test(error.message));

    // A turn that finished leaves nothing to retry.
    turn({ kind: 'completed' });
    await tick();
    await refused(remote.continueThread(coord.id, 't1'), /nothing to retry/);

    // A failed turn: the coordinator's roster says so, until a later turn finishes.
    turn({ kind: 'error', error: { message: '400: {"message":"The model rejected the request."}', code: 'INVALID_REQUEST' } });
    await tick();
    assert.match(coord.ctx.section(), /- t1 · "Flaky" · idle · no handback yet · its last turn failed \(HTTP 400\): The model rejected the request\.$/m);
    thread.status = 'running';
    await refused(remote.continueThread(coord.id, 't1'), /running already/);
    thread.status = 'idle';
    await refused(remote.continueThread(coord.id, 't9'), /no thread "t9"/);
    await refused(remote.continueThread(coord.id, ''), /thread is required/);

    // Retry (from any session of the project) sends the thread a message from its coordinator.
    const sent = ts.prompts.length;
    const described = await remote.continueThread(thread.id, 't1');
    assert.equal(described.project.id, 'dsh-plugins');
    assert.equal(ts.prompts.length, sent + 1);
    assert.equal(ts.prompts.at(-1).text, '[From the coordinator]\n\nThe user asked you to try again. Your last turn failed (HTTP 400): The model rejected the request. Carry on from where you left off.');
    assert.deepEqual(plain(ts.events.at(-1).data.source), { kind: 'agent-message', form: 'relay', senderSessionId: coord.id });
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /thread-continue dsh-plugins\/t1 after=error/);
    turn({ kind: 'completed' });
    await tick();
    assert.doesNotMatch(coord.ctx.section(), /its last turn/);

    // A stopped turn resumes; a handback after it is newer news.
    turn({ kind: 'aborted', reason: { kind: 'user' } });
    await tick();
    assert.match(coord.ctx.section(), /no handback yet · its last turn was stopped by the user before it finished\./);
    await remote.continueThread(coord.id, 't1');
    assert.match(ts.prompts.at(-1).text, /^\[From the coordinator\]\n\nThe user asked you to continue\. Your last turn was stopped by the user before it finished\. Carry on/);
    thread.ctx.emitStatus(thread, 'running');
    await thread.ctx.call('project_handback', { status: 'done', summary: 'Lane called.' });
    ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: 99, reason: { kind: 'error', error: { message: 'late' } } } });
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.match(coord.ctx.section(), /- t1 · "Flaky" · idle · last handback: done, "Lane called\."(?! · its last turn)/);
    await refused(remote.continueThread(coord.id, 't1'), /nothing to retry/);

    // A resolved thread has nothing to retry.
    await coord.ctx.call('project_thread_update', { thread: 't1', resolved: true });
    await refused(remote.continueThread(coord.id, 't1'), /is resolved/);
});

test('turn endings: what the coordinator is told, what the thread hears on Retry or Resume, and the error a person reads', () => {
    const lines = [
        [{ kind: 'error', error: { message: 'boom' } }, 'The turn failed: boom', 'failed'],
        [{ kind: 'error', error: { message: '429: {"error":{"message":"Rate limited.","type":"rate_limit"}}' } }, 'The turn failed (HTTP 429): Rate limited.', 'failed'],
        [{ kind: 'blocked' }, 'The turn was blocked.', 'failed'],
        [{ kind: 'aborted', reason: { kind: 'hook', reason: 'deepseek-account/signed-out' } }, 'The turn failed: the user signed out of DeepSeek.', 'failed'],
        [{ kind: 'aborted', reason: { kind: 'user' } }, 'The turn was stopped before it finished.', 'stopped'],
        [{ kind: 'interrupted' }, 'The turn was cut off because DSH stopped while it ran.', 'stopped'],
        [{ kind: 'max-tokens' }, 'The turn hit the output token limit.', 'stopped'],
        [{ kind: 'completed' }, '', undefined],
    ];
    for (const [reason, line, state] of lines) {
        assert.equal(describeEnding(reason), line);
        assert.equal(endingStateOf(line), state, line);
    }
    assert.equal(endingStateOf('The turnover was high.'), undefined);
    assert.equal(continueMessage('The turn hit the output token limit.', false), 'The user asked you to continue. Your last turn hit the output token limit. Carry on from where you left off.');
    assert.equal(continueMessage('', true), 'The user asked you to try again. Carry on from where you left off.');
    assert.equal(continueMessage('The turn failed (HTTP 400): bad attachment', true), 'The user asked you to try again. Your last turn failed (HTTP 400): bad attachment. Carry on from where you left off.');
    // DSH logs a provider's status and JSON body; people read the message inside.
    assert.equal(readableError('400: {"message":"The model rejected the request: bad attachment.","type":"invalid_request_error"}'), 'The model rejected the request: bad attachment.');
    assert.equal(readableError('429 {"error":{"message":"Rate limited.","type":"rate_limit"}}'), 'Rate limited.');
    assert.equal(readableError('503: {"error":"Lane busy"}'), 'Lane busy');
    assert.equal(readableError('fetch failed\n  caused by: ECONNREFUSED'), 'fetch failed caused by: ECONNREFUSED');
    assert.equal(readableError('500: {not json}'), '500: {not json}');
    assert.equal(readableError(undefined), '');
    assert.equal(readableError('x'.repeat(500)).length, 240);
});

test('a stop the coordinator asks for, or a person makes, does not come back as a note', async () => {
    const { host, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Long', brief: 'Run the long job.' });
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

    // A person's stop (DSH's stop button, the session bridge) sends no note either, so the coordinator can't send
    // the thread on by itself; its roster says the user stopped it.
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Try again.' });
    const stopBy = (cause) => {
        thread.ctx.emitStatus(thread, 'running');
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/start', data: { turn: ts.events.length } });
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: ts.events.length, reason: { kind: 'aborted', reason: cause } } });
        thread.ctx.emitStatus(thread, 'idle');
    };
    stopBy({ kind: 'user' });
    await tick();
    assert.deepEqual(host.sessions.get(coord.id).prompts.map((p) => p.text.slice(0, 120)), [], 'no note for a person\'s stop');
    assert.match(coord.ctx.section(), /- t1 · "Long" · idle · no handback yet · its last turn was stopped by the user before it finished\./);
    assert.match(coord.ctx.section(), /A thread the user stopped stays stopped/);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /user-stop dsh-plugins\/t1/);

    // Any other stop (a plugin's hook, a closed session) is still reported, and the coordinator decides.
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Try again.' });
    stopBy({ kind: 'hook', reason: 'budget' });
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.match(cp[0].text, /^\[Thread idle without a handback: t1 · "Long"\]\n\nThe turn was stopped before it finished\./);
});

test('a permission prompt left unanswered tells the coordinator', async () => {
    const { host } = setup({ approvalNoticeSeconds: 0.02 });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Deploy', brief: 'Deploy the site.' });
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
    assert.equal(cp[0].text, '[Thread waiting for approval: t1 · "Deploy"]\n\nIt asked to use bash: runs ./deploy.sh\n\nThe user approves or rejects it in the "Deploy" session.\n\n(Tell the user in one line, starting with [Deploy](.dsh-thread/t1), what it wants to do. Do not start another thread for the same work.)');

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
        await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Quiet', brief: 'Work.' });
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Two', brief: 'Do A.' });
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
        { mode: 'queue', text: '[Project created: "DSH Plugins"]\n\nThis is the first message in this coordinator session. Without running any tools or starting a thread, introduce yourself in two or three short sentences: say that you run the user\'s work in threads and report back here, and say what the project is for.' },
    ]);
    assert.deepEqual(sourceOf(first.host.sessions.get(coord.id), 0), { kind: 'cordis-host-runner' }, 'the welcome is the plugin\'s, not the user\'s');
    // On the Mac a coordinator ran `git pull` in its workspace during its welcome.
    assert.match(coord.ctx.section(), /\n7\. Messages that start with "\[" come from threads or the plugin, not the user: do what the note in them says\. For "\[Project created", run no tools and start no thread for it\./);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), new RegExp(`welcome dsh-plugins ${coord.id} delivered`));
    const second = restart(first.host.sessions, first.config);
    await tick();
    assert.equal(second.sessions.get(coord.id).prompts.length, 0, 'welcomed once');
});

test('model-facing text: a project without a goal asks for one; a handback\'s note and a thread link', () => {
    assert.match(welcomeMessage('Recipes', ''), /^\[Project created: "Recipes"\]\n\n.*Without running any tools or starting a thread, .* and ask what the project is for, since no goal is set\.$/);
    assert.match(welcomeMessage('Recipes', 'Cook'), /and say what the project is for\.$/);
    // The card's summary leaves out the note to the coordinator: today's and the older ones.
    const blocked = handbackMessage('t2', 'x', 'blocked', 'Needs a token (CI).');
    assert.match(blocked, /\n\n\(The user has not seen this\. Reply now\. First line: the link \[x\]\(\.dsh-thread\/t2\), a colon, and what it needs from the user in one sentence\. Then at most two short lines\. Write "the thread reports"/);
    assert.doesNotMatch(blocked, /No other thread is running/);
    assert.match(handbackMessage('t2', 'x', 'needs_decision', 'A or B?'), /the decision the user must make in one sentence\. Then the options, one short line each\./);
    assert.equal(handbackSummary(blocked), 'Needs a token (CI).');
    assert.equal(handbackSummary(handbackMessage('t2', 'x', 'done', 'Done.', { last: true })), 'Done.');
    assert.equal(handbackSummary('[Handback from thread t2 · "x" · status: blocked]\n\nNeeds a token (CI).\n\n(For the user: lead with what blocks it in a line or two, as t2\'s report, and link the thread: [x](.dsh-thread/t2). Full conversation: project_thread_read thread="t2".)'), 'Needs a token (CI).');
    assert.equal(handbackSummary('[Handback from thread t2 · "x" · status: done]\n\nDone.\n\n(Full conversation: project_thread_read thread="t2".)'), 'Done.');
    // The idle and approval notes carry their own instruction, with the thread's link.
    assert.match(idleMessage('t3', 'Flaky', '', 'The turn failed (HTTP 500): boom'), /\n\n\(Tell the user in one line, starting with \[Flaky\]\(\.dsh-thread\/t3\), that its turn failed; its card has Retry\. Do not retry it or start a new thread unless the user asks\.\)$/);
    assert.match(idleMessage('t3', 'Long', '', 'The turn was stopped before it finished.'), /that its turn stopped; its card has Resume\./);
    assert.match(idleMessage('t3', 'Chat', 'Which file?'), /\n\n\(If its last reply is a result or a question, pass it on to the user as you would a handback, starting with \[Chat\]\(\.dsh-thread\/t3\)\. If it stopped partway, send it "Finish the task and call project_handback\." with project_thread_send\.\)$/);
    assert.match(approvalMessage('t4', 'Deploy', 'Deploy', 'shell', 'rm -rf build'), /\n\n\(Tell the user in one line, starting with \[Deploy\]\(\.dsh-thread\/t4\), what it wants to do\. Do not start another thread for the same work\.\)$/);
    // A card or roster line is cut at a sentence end, or a word end, never inside a name (the first real run's card ended
    // "…deepseek-v41-a7 (DeepSeek-V4.1-Flash-T").
    const t2 = 'Lane probe (2026-10-10 10:48 AM PDT, read-only, no files touched): 3 lanes in ~/.dsh/lanes.json — 1 up, 2 down, 0 busy, 0 auth_failed. Up: glm53-a5 (GLM-5.3-Flash-EXL3, 850k ctx, traits long/reasoning/vision/primary). Down: glm53-full-a1a4 (the 1M-ctx lane) and deepseek-v41-a7 (DeepSeek-V4.1-Flash-TF), both with the same detail.';
    assert.equal(cardSummary(t2, 300), 'Lane probe (2026-10-10 10:48 AM PDT, read-only, no files touched): 3 lanes in ~/.dsh/lanes.json — 1 up, 2 down, 0 busy, 0 auth_failed. Up: glm53-a5 (GLM-5.3-Flash-EXL3, 850k ctx, traits long/reasoning/vision/primary). …');
    assert.equal(cardSummary(t2, 120), 'Lane probe (2026-10-10 10:48 AM PDT, read-only, no files touched): 3 lanes in ~/.dsh/lanes.json — 1 up, 2 down, 0…');
    assert.equal(cardSummary(`${'One sentence. '.repeat(3)}${'word '.repeat(80)}`, 100), `${'One sentence. '.repeat(3)}${'word '.repeat(10)}word…`);
    assert.equal(cardSummary('## Result\n\n- Wrote **notes/venv.md** with three bullets\n- Checked it with `cat`'), 'Result: Wrote notes/venv.md with three bullets. Checked it with cat.');
    assert.equal(cardSummary('Done'), 'Done');
    assert.equal(cardSummary(`${'a'.repeat(40)} ${'b'.repeat(400)}`, 100), `${'a'.repeat(40)}…`);
    // A bracket in a title can't break the link.
    assert.equal(threadMarkdown('t4', 'Fix [the] login'), '[Fix \\[the\\] login](.dsh-thread/t4)');
});

test('scope: a thread start or message that would use a guarded tool needs the user\'s words, and the prompts name those tools', async () => {
    const { host, dir } = setup({ guardedTools: ['lane-catalog', 'family_1password', 'cua'] });
    await tick();
    const coord = coordinatorOf(host);
    const say = userTyping(host);
    assert.match(coord.ctx.section(), /\n2\. Never use the user's personal or infrastructure tools, [^\n]*\n   You don't have these here: lane-catalog, family_1password, cua\. When the user's words ask for work that needs one, start a thread with their words in `ask`; the thread gets the ones their words name\.\n3\. /);
    // The first real run's t2: a test task the coordinator picked itself, sent to the user's model lanes.
    const drift = await coord.ctx.call('project_thread_start', {
        ask: 'I\'m simply testing out the effectiveness of the coordinator - can we find a small test-task or a couple test-tasks to roll on for this test?',
        title: 'Test task: lane probe report',
        brief: 'Use the lane-catalog MCP tools (lanes_status, pick_lane) to report which lanes are up.',
    });
    assert.equal(drift, 'Failed: this would use lane-catalog, and the user\'s words do not ask for it. Keep the work inside the workspace, or ask the user first. If the user did ask, put their words in ask. If the text only says not to use it, leave that out: threads already have that rule');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /guard dsh-plugins start lane-catalog\n/);
    // A tool id names its server too, and a refused start makes no thread.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Check things.', title: 'Probe', brief: 'Call mcp__lane-catalog__lanes_status.' }), /^Failed: this would use lane-catalog,/);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Check things.', title: 'Token', brief: 'Get the token from family_1password, then use cua to log in.' }), /^Failed: this would use family_1password, cua, and the user's words do not ask for them\./);
    // Scenario S4. An ask is the user's words only if the user wrote them: one naming their tool that they never did is refused.
    const s4 = 'Use lane-catalog to check which of my model lanes are up right now.';
    const lanes = { ask: s4, title: 'Lanes up', brief: 'Call lanes_status on lane-catalog and report each lane\'s state.' };
    assert.equal(await coord.ctx.call('project_thread_start', lanes),
        'Failed: ask names lane-catalog, but the user\'s messages don\'t. Put only the user\'s own words in ask, copied from their message, or ask the user first');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /guard dsh-plugins ask-unsaid lane-catalog\n/);
    assert.equal(host.live.size, 1, 'no thread session was made');
    // Once the user asks for it by name, the thread starts with their words and that tool.
    await say(coord, s4);
    assert.equal(await coord.ctx.call('project_thread_start', lanes),
        'Started t1 "Lanes up". It reports back when done. The user\'s words give it lane-catalog. Link it as [Lanes up](.dsh-thread/t1).');
    const t1 = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Lanes up');
    assert.match(host.sessions.get(t1.id).prompts[0].text, new RegExp(`\n\nThe user asked: "${s4.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\n\nCall lanes_status`));
    const stored = () => JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads;
    assert.deepEqual([stored().t1.ask, stored().t1.tools], [s4, ['lane-catalog']]);
    assert.match(t1.ctx.section(), /\n   Here those include: lane-catalog, family_1password, cua\. You have only the ones the user's words name: lane-catalog\.\n3\. Editing files/);
    // A name inside another word is not that tool.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Tidy up.', title: 'Vacuum', brief: 'Vacuum the cuatro folder; cuda stays.' }), /^Started t2 "Vacuum"\. It reports back when done\. Link/);
    const t2 = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Vacuum');
    assert.match(t2.ctx.section(), /\n   Here those include: lane-catalog, family_1password, cua\. You have none of them\.\n3\. /);
    // A message to a thread: the thread's tools, or the user's words given with the message, must name the tool.
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Also run pick_lane on lane-catalog.' }), 'Sent to t1.');
    assert.match(await coord.ctx.call('project_thread_send', { thread: 't2', text: 'Then check lane-catalog.' }), /^Failed: this would use lane-catalog, and the user's words do not ask for it\. .*If the user did ask, put their words in ask, or start a thread for it with their words in ask\./);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /guard dsh-plugins send lane-catalog\n/);
    const token = { thread: 't2', text: 'Then read the token from family_1password.', ask: 'grab the token from my family 1password' };
    assert.match(await coord.ctx.call('project_thread_send', token), /^Failed: ask names family_1password, but the user's messages don't\./);
    await say(coord, 'For the vacuum thread: grab the token from my family 1password');
    assert.equal(await coord.ctx.call('project_thread_send', token), 'Sent to t2.');
    assert.deepEqual(stored().t2.tools, ['family_1password']);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /tools dsh-plugins\/t2 \+family_1password from the user's words in a message\n/);
});

test('scope: the user\'s word for a guarded tool, or the goal, asks for it; a home-folder workspace gets a note', async () => {
    const { host } = setup({
        guardedTools: { 'lane-catalog': ['lanes', 'model lanes'], obsidian: ['notes app'] },
        projects: [{ name: 'DSH Plugins', goal: 'Keep the obsidian inbox tidy', workspacePath: homedir() }],
    }, undefined, { gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    assert.match(coord.ctx.section(), /\nWorkspace: [^\n]+ \(the user's home folder: put new files in a new subfolder, and never move or delete anything you did not create\)\n/);
    assert.match(coord.ctx.section(), /You don't have these here: lane-catalog, obsidian\./);
    await userTyping(host)(coord, 'Which of my lanes are up?');
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Which of my lanes are up?', title: 'Lanes', brief: 'Ask lane-catalog.' }), /^Started t1 "Lanes"\. It reports back when done\. The user's words give it lane-catalog\./);
    // The goal names obsidian, so every thread has it.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Sort the inbox.', title: 'Inbox', brief: 'Use obsidian to file the inbox notes.' }), /^Started t2/);
    const inbox = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Inbox');
    assert.match(inbox.ctx.section(), /Here those include: lane-catalog, obsidian\. You have only the ones the user's words name: obsidian\./);
    // An alias asks for its tool only from the user's words: a brief that says "lanes" uses no tool by that.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Write a poem.', title: 'Poem', brief: 'A poem about swimming lanes.' }), /^Started t3/);
    const thread = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Lanes');
    assert.match(thread.ctx.section(), /\nYou work in the user's home folder: put new files in a new subfolder, and never move or delete anything you did not create\.\n/);
    // The window hears it too, for its first asks.
    const remote = host.provided.get('dshPluginProjectsRemote');
    assert.equal((await remote.describe(coord.id)).project.homeFolder, true);
    assert.equal(guardedIn('mcp__lane-catalog__lanes_status', guardList(['lane-catalog'])).join(), 'lane-catalog');
    assert.deepEqual(guardList({ a: ['x', ' ', 'y'], ' ': ['z'] }), [['a', ['x', 'y']]]);
    assert.deepEqual(guardedIn('My Lanes and the Notes App', guardList({ 'lane-catalog': ['lane'], obsidian: ['notes app'] }), { aliases: true }), ['lane-catalog', 'obsidian']);
});

/** DSH's own tools and the user's MCP servers, as a session is offered them before any restriction. */
const HOST_TOOLS = ['shell', 'read_file', 'mcp__lane-catalog__lanes_status', 'mcp__lane-catalog__pick_lane', 'mcp__family_1password__get_item', 'mcp__cua__click', 'mcp__tavily__search'];

test('your tools: a coordinator never has the user\'s tools, and a thread has only the ones the user\'s own words name', async () => {
    const { host, dir, config } = setup({ guardedTools: { 'lane-catalog': ['lanes'], family_1password: ['1password'], cua: [] } }, undefined, { gateway: true, tools: HOST_TOOLS });
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    const say = userTyping(host);
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');
    const stored = () => JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads;
    const threadNamed = (title) => [...host.live.values()].find((a) => host.sessions.get(a.id).title === title);
    const OTHERS = ['shell', 'read_file', 'mcp__tavily__search'];

    // Scenario S4's coordinator answered from lane-catalog itself. Under "asked", the default, its model is never offered one of the user's tools.
    assert.deepEqual(coord.ctx.offered(), OTHERS);
    assert.match(log(), new RegExp(` wall dsh-plugins/coordinator ${coord.id} hid=4 allowed=-\n`));
    // A call to one anyway is refused before it reaches the tool, with what to do instead.
    assert.equal(coord.ctx.refusal('mcp__lane-catalog__lanes_status'), 'This is one of the user\'s own tools, which this project keeps out of the coordinator. When the user asks for work that needs it, start a thread with their words in ask: the thread gets the tools their words name.');
    assert.match(log(), / wall-refused dsh-plugins\/coordinator mcp__lane-catalog__lanes_status\n/);
    assert.equal(coord.ctx.refusal('shell'), undefined);
    assert.equal(coord.ctx.refusal('project_thread_start'), undefined);

    // So it starts a thread with the user's words, and the thread has the tools they name, by name or by the user's word for one.
    const ask = 'Which of my lanes are up right now?';
    await say(coord, ask);
    assert.match(await coord.ctx.call('project_thread_start', { ask, title: 'Lanes', brief: 'Report each lane.' }), /^Started t1 "Lanes"\. It reports back when done\. The user's words give it lane-catalog\. /);
    const t1 = threadNamed('Lanes');
    assert.deepEqual(t1.ctx.offered(), ['shell', 'read_file', 'mcp__lane-catalog__lanes_status', 'mcp__lane-catalog__pick_lane', 'mcp__tavily__search']);
    assert.equal(t1.ctx.refusal('mcp__cua__click'), 'This is one of the user\'s own tools, and the user\'s words for this thread don\'t name it. If the task needs it, hand back with status blocked and say so.');
    assert.equal(t1.ctx.refusal('mcp__lane-catalog__pick_lane'), undefined);
    // A thread whose words name none of them has none.
    await coord.ctx.call('project_thread_start', { ask: 'Tidy the notes folder.', title: 'Tidy', brief: 'Tidy it.' });
    const t2 = threadNamed('Tidy');
    assert.deepEqual(t2.ctx.offered(), OTHERS);

    // The user writes to a thread directly: the tools their words there name are its too, from
    // the turn that answers them. Like DSH, the message is queued before that turn gathers its
    // tools and logged after; the queued copy already gives them.
    await say(t2, 'use cua to click through the setup dialog');
    const typed = host.sessions.get(t2.id).events.at(-1);
    t2.ctx.sessionEvent({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [typed.data] } });
    assert.deepEqual(t2.ctx.offered(), ['shell', 'read_file', 'mcp__cua__click', 'mcp__tavily__search']);
    t2.ctx.sessionEvent(typed);
    assert.equal(log().match(/ tools dsh-plugins\/t2 \+cua from the user in the thread\n/g)?.length, 1);
    // A queued message from the coordinator gives it nothing either.
    t2.ctx.sessionEvent({ type: 'agent/inbox/spliced', data: { target: 'next-turn', start: 0, inserted: [{ id: 'm-relay', role: 'user', content: [{ type: 'text', text: 'Use family_1password too.' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: coord.id } }] } });
    assert.deepEqual(stored().t2.tools, ['cua']);
    // A message from the coordinator gives it nothing.
    t2.ctx.sessionEvent({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'Use family_1password too.' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: coord.id } } });
    assert.deepEqual(stored().t2.tools, ['cua']);
    // The coordinator passes on the user's words with a message: the tools they name join the thread's.
    const more = 'Also have the lanes thread get my 1password token for the gateway.';
    await say(coord, more);
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Get the gateway token from family_1password.', ask: more }), 'Sent to t1.');
    assert.deepEqual([stored().t1.tools, t1.ctx.offered().includes('mcp__family_1password__get_item')], [['lane-catalog', 'family_1password'], true]);

    // An MCP server connects or changes its tools: the walls follow, one restriction per session.
    host.toolNames.push('mcp__cua__type');
    host.emit('tools/change');
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual([coord.ctx.offered().includes('mcp__cua__type'), t1.ctx.offered().includes('mcp__cua__type'), t2.ctx.offered().includes('mcp__cua__type')], [false, false, true]);
    assert.deepEqual([coord.ctx.restrictions.length, t1.ctx.restrictions.length, t2.ctx.restrictions.length], [1, 1, 1]);

    // Project settings shows who has which, and the plugin page's list names the user's tools.
    let read = await remote.describe(coord.id);
    assert.deepEqual(plain([read.project.tools, read.threads.map((t) => [t.id, t.tools]), read.guarded]),
        [[], [['t1', ['lane-catalog', 'family_1password']], ['t2', ['cua']]], ['lane-catalog', 'family_1password', 'cua']]);
    assert.deepEqual(plain((await remote.list()).guarded), ['lane-catalog', 'family_1password', 'cua']);

    // "Always", set in Project settings: every session has them, and the coordinator's prompt keeps only the rule.
    read = await remote.update(coord.id, { yourTools: 'always' });
    assert.deepEqual(plain(read.access.yourTools), { value: 'always', source: 'project setting', inherited: { value: 'asked', source: 'plugin default' } });
    assert.deepEqual([coord.ctx.offered(), t2.ctx.offered()], [host.toolNames, host.toolNames]);
    assert.deepEqual([read.project.tools, read.threads[1].tools], ['all', 'all']);
    assert.match(coord.ctx.section(), /\n   Here those include: lane-catalog, family_1password, cua\.\n3\. /);
    assert.equal(coord.ctx.refusal('mcp__lane-catalog__lanes_status'), undefined);
    // The coordinator can see the setting, and can't change it.
    const shown = await coord.ctx.call('project_settings', {});
    assert.match(shown, /\nThe user's tools \(lane-catalog, family_1password, cua\): every session has them\nThe user changes these in Project settings; project_settings can't\.$/);
    assert.equal(coord.ctx.registered.get('project_settings').parameters.your_tools, undefined);
    // Back to the default, and only the two words are settings.
    read = await remote.update(coord.id, { yourTools: null });
    assert.deepEqual([read.access.yourTools.source, coord.ctx.offered()], ['plugin default', OTHERS]);
    await assert.rejects(remote.update(coord.id, { yourTools: 'sometimes' }), (error) => error.code === 'projects/refused' && /your tools must be "asked" or "always"/.test(error.message));
    assert.match(await coord.ctx.call('project_settings', {}), /\nThe user's tools \(lane-catalog, family_1password, cua\): you don't have them; a thread has the ones the user's words for it name\n/);

    // The list of the user's tools is live: the plugin page saves it, and every wall and prompt follows without a reload.
    saveDefaults(host, config, { guardedTools: ['lane-catalog'] });
    await tick();
    assert.deepEqual(coord.ctx.offered(), host.toolNames.filter((name) => !name.startsWith('mcp__lane-catalog__')));
    assert.match(coord.ctx.section(), /\n   You don't have these here: lane-catalog\. When/);
    saveDefaults(host, config, { guardedTools: [] });
    await tick();
    assert.deepEqual([coord.ctx.offered(), coord.ctx.restrictions.length], [host.toolNames, 0]);
});

test('your tools: a reload attaches to loaded coordinators without reading their logs, and puts every wall back', async () => {
    const { host, config } = setup({ guardedTools: ['lane-catalog'] }, undefined, { tools: HOST_TOOLS });
    await tick();
    const coord = coordinatorOf(host);
    await userTyping(host)(coord, 'Ask lane-catalog which lanes are up.');
    await coord.ctx.call('project_thread_start', { ask: 'Ask lane-catalog which lanes are up.', title: 'Lanes', brief: 'Go.' });
    const t1 = threadOf(host, coord);
    const inspect = host.sessionController.inspect;
    const reads = [];
    host.sessionController.inspect = (id, ...rest) => { reads.push(id); return inspect(id, ...rest); };
    await reload(host, config);
    await tick();
    assert.deepEqual(reads.filter((id) => id === coord.id), [], 'a coordinator DSH has loaded needs no read of its log');
    assert.equal(coord.ctx.offered().some((name) => name.startsWith('mcp__lane-catalog__')), false);
    assert.equal(t1.ctx.offered().some((name) => name.startsWith('mcp__lane-catalog__')), true);
    assert.deepEqual([coord.ctx.restrictions.length, coord.ctx.guards.length, t1.ctx.guards.length], [1, 1, 1]);
});

test('permissions: threads start on Workspace Write, the coordinator stays on DSH\'s default, and the user\'s picks become the settings', async () => {
    const { host, dir } = setup({}, undefined, { gateway: true, presets: true });
    await tick();
    const pp = host.services.permissionPresets;
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');
    const stored = () => JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'];
    const threadNamed = (title) => [...host.live.values()].find((a) => host.sessions.get(a.id).title === title);
    const refused = async (promise, pattern) => {
        await assert.rejects(promise, (error) => error.code === 'projects/refused' && pattern.test(error.message));
    };
    // The coordinator keeps the permission DSH gave it, the user's default: the plugin changes nothing.
    assert.deepEqual([pp.current(coord.session), pp.sets, stored().coordinatorAccess], ['danger-full-access', [], 'default']);

    // A thread is on Workspace Write before it reads its brief.
    await coord.ctx.call('project_thread_start', { ask: 'Add CI.', title: 'CI', brief: 'Add CI.' });
    const t1 = threadNamed('CI');
    assert.equal(pp.current(t1.session), 'workspace-write');
    assert.deepEqual(pp.sets, [{ sessionId: t1.id, preset: 'workspace-write', promptsBefore: 0 }]);
    assert.equal(stored().threads.t1.permission, 'workspace-write');
    assert.match(log(), / permission dsh-plugins\/t1 workspace-write\n/);
    // That change was the plugin's own, not a pick of the user's.
    assert.doesNotMatch(log(), /picked-permission/);

    // The window: each setting with its source, every thread's permission, and the presets DSH offers (not Auto).
    let read = await remote.describe(coord.id);
    assert.equal(read.project.permission, 'danger-full-access');
    assert.deepEqual(plain(read.access.coordinatorPermission), { value: 'default', source: 'plugin default', inherited: { value: 'default', source: 'plugin default' } });
    assert.deepEqual(plain(read.access.threadPermission), { value: 'workspace-write', source: 'plugin default', inherited: { value: 'workspace-write', source: 'plugin default' } });
    assert.deepEqual(plain(read.permissions.options.map((o) => [o.value, o.name])), [['read-only', 'Read Only'], ['workspace-write', 'Workspace Write'], ['danger-full-access', 'Full access']]);
    assert.equal(read.permissions.defaultPreset, 'danger-full-access');
    assert.deepEqual(read.threads.map((t) => t.permission), ['workspace-write']);
    assert.equal(plain(await remote.list()).projects[0].permission, 'danger-full-access');

    // The user picks Full access for the thread in DSH's own permission menu: its setting follows.
    pp.pick(t1.id, 'danger-full-access');
    assert.equal(stored().threads.t1.permission, 'danger-full-access');
    assert.match(log(), / picked-permission dsh-plugins\/t1 danger-full-access\n/);
    // And Read Only for the coordinator: that becomes the project's coordinator setting.
    pp.pick(coord.id, 'read-only');
    read = await remote.describe(coord.id);
    assert.deepEqual(plain(read.access.coordinatorPermission), { value: 'read-only', source: 'project setting', inherited: { value: 'default', source: 'plugin default' } });
    assert.equal(read.project.permission, 'read-only');

    // Project settings moves the coordinator at once; null goes back to DSH's default.
    read = await remote.update(coord.id, { coordinatorPermission: 'workspace-write' });
    assert.deepEqual([pp.current(coord.session), read.notes], ['workspace-write', []]);
    read = await remote.update(coord.id, { coordinatorPermission: null });
    assert.deepEqual([pp.current(coord.session), read.access.coordinatorPermission.source], ['danger-full-access', 'plugin default']);
    assert.equal(log().match(/picked-permission dsh-plugins\/coordinator/g).length, 1, 'only the user\'s own pick');
    // New threads start on what Project settings says; running threads keep theirs.
    await remote.update(coord.id, { threadPermission: 'read-only' });
    await coord.ctx.call('project_thread_start', { ask: 'Read the docs.', title: 'Docs', brief: 'Read them.' });
    assert.deepEqual([pp.current(threadNamed('Docs').session), pp.current(t1.session)], ['read-only', 'danger-full-access']);
    // One thread, from its row in Project settings.
    read = await remote.update(coord.id, { thread: 't1', permission: 'workspace-write' });
    assert.deepEqual([pp.current(t1.session), read.notes, read.threads.find((t) => t.id === 't1').permission], ['workspace-write', ['t1: permission workspace-write.'], 'workspace-write']);
    // Only DSH's presets, or "default".
    await refused(remote.update(coord.id, { threadPermission: 'yolo' }), /^"yolo" is not one of DSH's permissions \(default, read-only, workspace-write, danger-full-access\)$/);
    await refused(remote.update(coord.id, { thread: 't1', permission: 'auto' }), /^"auto" is not one of DSH's permissions$/);
    // The coordinator sees them, and has no way to change them.
    assert.match(await coord.ctx.call('project_settings', {}), /\nPermissions: coordinator DSH's default \(danger-full-access\), new threads read-only\nThe user changes these in Project settings; project_settings can't\.$/);
    // A thread DSH won't put on its permission doesn't start: its session never gets the brief.
    pp.fail = true;
    assert.equal(await coord.ctx.call('project_thread_start', { ask: 'More.', title: 'Stuck', brief: 'Go.' }),
        'Failed: t3 could not be put on the permission "read-only", so it did not start. Tell the user (details in the projects log)');
    assert.deepEqual([host.sessions.get(stored().threads.t3.sessionId).prompts.length, stored().threads.t3.resolved], [0, true]);
    assert.match(log(), / error permission dsh-plugins\/t3 permission: the session refused it\n/);
});

test('permissions: a project row sets them, and a permission DSH doesn\'t offer stops thread starts with a reason', async () => {
    const { host } = setup({ projects: [{ name: 'DSH Plugins', workspacePath: '/work/dsh', coordinatorPermission: 'read-only', threadPermission: 'yolo' }] }, undefined, { presets: true });
    await tick();
    const pp = host.services.permissionPresets;
    const coord = coordinatorOf(host);
    // A new coordinator goes on its setting when it is made.
    assert.equal(pp.current(coord.session), 'read-only');
    assert.equal(await coord.ctx.call('project_thread_start', { ask: 'Go.', title: 'X', brief: 'Go.' }),
        'Failed: threads in this project start on the permission "yolo", which DSH doesn\'t offer. Tell the user to choose another in Project settings');
    assert.equal(host.live.size, 1, 'no thread session was made');
});

test('browser half: the plugin\'s messages get a notice that names them, without the note to the coordinator', () => {
    const { client } = loadClient();
    const { noticeOf } = client.internals;
    const data = (text, kind = 'agent-message') => ({ content: [{ type: 'text', text }], source: { kind }, time: 1 });
    const handback = handbackMessage('t1', 'Add CI', 'done', 'CI added.', { last: true });
    assert.deepEqual(plain(noticeOf(data(handback))), { kind: 'handback', thread: 't1', name: 'Add CI', status: 'done', body: 'CI added.' });
    assert.deepEqual(plain(noticeOf(data(idleMessage('t3', 'Flaky', '', 'The turn failed (HTTP 500): boom'), 'cordis-host-runner'))),
        { kind: 'idle', thread: 't3', name: 'Flaky', status: 'failed', body: 'The turn failed (HTTP 500): boom\n\nIt produced no reply text.' });
    assert.equal(noticeOf(data(approvalMessage('t4', 'Deploy', 'Deploy', 'shell', 'rm -rf build'), 'cordis-host-runner')).body,
        'It asked to use shell: rm -rf build\n\nThe user approves or rejects it in the "Deploy" session.');
    assert.equal(noticeOf(data(welcomeMessage('Recipes', ''), 'cordis-host-runner')).kind, 'welcome');
    // The user's own words, and other agents' messages, keep DSH's own notice.
    assert.equal(noticeOf(data(handback, 'user')), undefined);
    assert.equal(noticeOf(data('A message from another agent.')), undefined);
});

test('a handback\'s note asks for a closing line only when no other thread is at work', async () => {
    const { host, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Do A and B.', title: 'A', brief: 'Do A.' });
    await coord.ctx.call('project_thread_start', { ask: 'Do A and B.', title: 'B', brief: 'Do B.' });
    const [a, b] = ['A', 'B'].map((title) => [...host.live.values()].find((x) => host.sessions.get(x.id).title === title));
    b.ctx.emitStatus(b, 'running');
    a.ctx.emitStatus(a, 'running');
    await a.ctx.call('project_handback', { status: 'done', summary: 'A is done.' });
    a.ctx.emitStatus(a, 'idle');
    await tick();
    await b.ctx.call('project_handback', { status: 'done', summary: 'B is done.' });
    b.ctx.emitStatus(b, 'idle');
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.doesNotMatch(cp[0].text, /No other thread is running/, 'B was still at work');
    assert.match(cp[1].text, /No other thread is running: end with one line that answers what the user asked for\./);
    // A long handback is kept for the cards cut at a sentence end, never inside a word.
    await a.ctx.call('project_handback', { status: 'done', summary: `Fixed it. ${'Checked every file again carefully. '.repeat(20)}` });
    const kept = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads.t1.lastHandback.summary;
    assert.ok(kept.length <= 500 && kept.endsWith('carefully. …'), kept);
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Long', brief: 'Run the long job.' });
    const thread = threadOf(first.host, coord);
    thread.ctx.emitStatus(thread, 'running');
    turnMarks(first.host, thread.id).start();
    assistantSays(first.host, thread.id, 'Starting the job.');

    // DSH stops mid-turn; the next process reads the open turn as interrupted.
    const second = restart(first.host.sessions, first.config);
    await tick();
    const cp = second.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 1);
    assert.equal(cp[0].text, '[Thread idle without a handback: t1 · "Long"]\n\nThe turn was cut off because DSH stopped while it ran.\n\nIts last reply:\n\nStarting the job.\n\n(Tell the user in one line, starting with [Long](.dsh-thread/t1), that its turn stopped; its card has Resume. Do not retry it or start a new thread unless the user asks.)');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /idle-note dsh-plugins\/t1 chars=17 ended=interrupted/);

    const third = restart(first.host.sessions, first.config);
    await tick();
    assert.equal(third.sessions.get(coord.id).prompts.length, 0, 'reported once');
});

test('a long thread title is cut once, after a whole word, with "…", and fits DSH\'s 80-byte session titles', () => {
    const long = 'Draft the spring launch announcement with product highlights, pricing tiers and a wholesale FAQ';
    assert.equal(clipTitle(long), 'Draft the spring launch announcement with product highlights, pricing tiers…');
    assert.equal(clipTitle('  Fix   the login\nloop '), 'Fix the login loop');
    assert.equal(clipTitle('x'.repeat(80)), 'x'.repeat(80));
    const wide = clipTitle('多'.repeat(40));
    assert.ok(Buffer.byteLength(wide) <= 80 && wide.endsWith('…'), wide);
    assert.equal(clipTitle('x'.repeat(100)), `${'x'.repeat(77)}…`);
    // A title an older version cut at 80 characters ends at its last whole word.
    assert.equal(clipTitle(long.slice(0, 80), { cut: true }), 'Draft the spring launch announcement with product highlights, pricing tiers…');
});

test('thread sessions an older version titled "<project> › <title>" are renamed once; a title the user changed stays', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const coord = coordinatorOf(first.host);
    for (const title of ['Old', 'Mine', 'Cold', 'Long']) await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title, brief: `Do ${title}.` });
    const idOf = (title) => [...first.host.sessions].find(([, s]) => s.title === title)[0];
    const [old, mine, cold, long] = ['Old', 'Mine', 'Cold', 'Long'].map(idOf);
    // As an older version titled them, one renamed by the user, one whose title only its log has.
    first.host.sessions.get(old).title = 'DSH Plugins › Old';
    first.host.sessions.get(mine).title = 'My own name';
    first.host.sessions.get(cold).title = null;
    first.host.sessions.get(cold).events.push({ seq: 90, type: 'session/title', data: { title: 'Cold start' } }, { seq: 91, type: 'session/title', data: { title: 'DSH Plugins › Cold' } });
    // The window's store is shared by the plugin's instances in one DSH, as when it reloads.
    const store = ProjectStore.open(join(dir, 'projects.json'));
    assert.equal(store.project('dsh-plugins').plainTitles, true, 'a new project needs no pass');
    store.putProject('dsh-plugins', { plainTitles: undefined });
    // An older version also cut a long title at 80 characters, and DSH cut the session's title at 80 bytes.
    const cut80 = 'Draft the spring launch announcement with product highlights, pricing tiers and a wholesale FAQ'.slice(0, 80);
    store.putThread('dsh-plugins', 't4', { title: cut80 });
    let dshCut = '';
    for (const char of `DSH Plugins › ${cut80}`) { if (Buffer.byteLength(dshCut + char) > 80) break; dshCut += char; }
    first.host.sessions.get(long).title = dshCut.trimEnd();

    const second = restart(first.host.sessions, first.config);
    await tick();
    assert.equal(second.sessions.get(old).title, 'Old');
    assert.equal(second.sessions.get(mine).title, 'My own name');
    assert.equal(second.sessions.get(cold).title, 'Cold');
    const whole = 'Draft the spring launch announcement with product highlights, pricing tiers…';
    assert.equal(second.sessions.get(long).title, whole);
    assert.equal(store.thread('dsh-plugins', 't4').title, whole);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /thread-titles renamed=3/);

    // Once: an old-style title the user sets later stays.
    second.sessions.get(old).title = 'DSH Plugins › Old';
    const third = restart(second.sessions, first.config);
    await tick();
    assert.equal(third.sessions.get(old).title, 'DSH Plugins › Old');

    // A list DSH can't read is logged and tried again at the next start; the start itself goes on.
    store.putProject('dsh-plugins', { plainTitles: undefined });
    const fourth = fakeHost();
    for (const [id, s] of third.sessions) fourth.sessions.set(id, { ...s, prompts: [] });
    fourth.listError = new Error('list is down');
    plugin.apply(fourth, first.config);
    await tick();
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /error thread-titles list is down/);
    assert.equal(store.project('dsh-plugins').plainTitles, undefined);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /coordinator dsh-plugins s1 resumed[^]*error thread-titles/);
});

test('a config reload while a thread runs still reports its turn and its permission prompt', async () => {
    const { host, config } = setup({ approvalNoticeSeconds: 0.02 });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Busy', brief: 'Deploy it.' });
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
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Gap', brief: 'Work.' });
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
        await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Retry', brief: 'x' });
        const thread = threadOf(host, coord);
        const accept = host.accept;
        let refuse = true;
        host.accept = (sessionId, mode, message) => {
            if (refuse && sessionId === coord.id) throw new Error('session/writer-held');
            return accept(sessionId, mode, message);
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
    const started = coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Mid', brief: 'x' });
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
    assert.equal(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'E', brief: 'x', model: '', effort: '' }), 'Started t1 "E". It reports back when done. Link it as [E](.dsh-thread/t1).');
    assert.equal(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'D', brief: 'x', model: 'default', effort: 'default' }), 'Started t2 "D". It reports back when done. Link it as [D](.dsh-thread/t2).');
    await coord.ctx.call('project_settings', { thread_model: 'deepseek-v4-flash' });
    assert.match(await coord.ctx.call('project_settings', { thread_model: '', coordinator_effort: ' ' }), /New threads: deepseek:deepseek-v4-flash · effort high \(project setting/);
    assert.match(await coord.ctx.call('project_thread_update', { thread: ' t1 ', model: '', effort: '', title: '' }), /^t1: nothing to change\.$/);
    assert.match(await coord.ctx.call('project_thread_send', { thread: ' t2 ', text: 'More.' }), /^Sent to t2\.$/);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads), ['t1', 't2']);
});

test('browser half: one store of what the plugin says about projects, shared by the views and read while they watch', async () => {
    const { client } = loadClient();
    const { projectFacts, pausedText, withHeld, SUGGESTIONS, suggestionsFor } = client.internals;
    const calls = [];
    let paused = true;
    const project = () => ({
        project: { id: 'p1', name: 'P', coordinator: 'c1' }, settings: {},
        paused: { value: paused, source: 'project setting', inherited: false, held: paused ? 2 : 0 },
        threads: [{ id: 't1', session: 's1' }],
    });
    const link = {
        async call(method, args) {
            calls.push(method);
            if (method === 'describe') return { ok: true, value: project() };
            if (method === 'list') return { ok: true, value: { projects: [{ id: 'p1', coordinator: 'c1', paused }, { id: 'p2', coordinator: 'c2', paused: false }] } };
            if (method === 'update' && args.target === 'c1') { paused = args.changes.paused; return { ok: true, value: project() }; }
            return { ok: false, error: { code: 'projects/refused', message: 'no' } };
        },
    };
    const facts = projectFacts(link);
    let changes = 0;
    facts.subscribe(() => { changes += 1; });
    assert.equal(facts.paused('c1'), undefined, 'unknown until read');
    // A thread's session reads its project; the coordinator and the other threads share it.
    await facts.describe('s1');
    assert.equal(facts.info('s1').project.id, 'p1');
    assert.equal(facts.info('c1'), facts.info('s1'));
    assert.equal(facts.paused('c1'), true);
    await facts.describe('s1', 60000);
    assert.deepEqual(calls, ['describe'], 'a fresh read is not repeated');
    // The list covers every coordinator, the session list's paused marks.
    await facts.list();
    assert.deepEqual([facts.paused('c1'), facts.paused('c2'), facts.paused('c3')], [true, false, undefined]);
    // A change answers with the project, and every view shows it at once.
    const before = changes;
    assert.equal((await facts.change('c1', { paused: false })).ok, true);
    assert.equal(facts.paused('c1'), false);
    assert.equal(facts.info('s1').paused.held, 0);
    assert.ok(changes > before);
    assert.equal((await facts.change('c2', { paused: false })).ok, false);
    // A watch reads now (unless just read) and every 15 s; the last unwatch stops the timer, so this test can end.
    const fresh = projectFacts(link);
    const stop = fresh.watch('list');
    const again = fresh.watch('list');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fresh.paused('c2'), false);
    stop();
    again();
    assert.equal(typeof fresh.watch(''), 'function');
    // What a pause means where it shows.
    assert.equal(pausedText('coordinator', 0), 'New threads and handbacks wait until you resume.');
    assert.equal(pausedText('coordinator', 1), '1 message held until you resume. New threads wait too.');
    assert.equal(pausedText('coordinator', 2, 2), '2 handbacks held until you resume. New threads wait too.');
    assert.equal(pausedText('thread', 3), 'This thread\'s handbacks wait until the project resumes.');
    assert.equal(SUGGESTIONS.length, 3);
    // A project in the user's home folder gets first asks that don't send anyone through all of it; none until describe answers.
    assert.equal(suggestionsFor(null), null);
    assert.equal(suggestionsFor(project()), SUGGESTIONS);
    const home = suggestionsFor({ project: { id: 'p1', homeFolder: true } });
    assert.ok(home.length >= 2 && home.every((text) => !/look around|this folder|the code/i.test(text)), home.join(' | '));
    // A thread whose handback the pause holds says so, instead of "No handback yet"; running and resolved rows keep theirs.
    const rows = [{ id: 't1', group: 'idle', line: 'No handback yet' }, { id: 't2', group: 'running', line: 'Working…' }, { id: 't3', group: 'idle', line: 'No handback yet' }];
    assert.equal(withHeld(rows, []), rows);
    assert.deepEqual(plain(withHeld(rows, [{ thread: 't1', status: 'done' }, { thread: 't2', status: 'blocked' }]).map((r) => r.line)),
        ['Done · held until you resume', 'Working…', 'No handback yet']);
    // And sits where that handback puts it: Done, or Waiting on you for a decision or a block.
    assert.deepEqual(plain(withHeld(rows, [{ thread: 't1', status: 'done' }, { thread: 't3', status: 'needs_decision' }]).map((r) => [r.group, r.dot, r.stateLabel])),
        [['done', 'done', 'Done'], ['running', null, null], ['waiting', 'warning', 'Needs a decision']]);
});

// ── projects as groups of workspaces (the Projects page and the import) ───

/** Run with DSH's data folder at `home`, as a DSH started with DSH_HOME does. */
async function withDshHome(home, run) {
    const was = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
        return await run();
    } finally {
        if (was === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = was;
    }
}

test('data paths under ~/.dsh follow DSH_HOME, as DSH\'s own data does', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    await withDshHome(home, () => {
        assert.equal(dataPath('~/.dsh/projects/projects.json'), join(home, 'projects/projects.json'));
        assert.equal(dataPath('~/.dsh'), home);
        assert.equal(dataPath('~/notes/memory'), join(homedir(), 'notes/memory'));
        assert.equal(dataPath('/abs/projects.json'), '/abs/projects.json');
        assert.equal(dshHome(), home);
    });
    await withDshHome('', () => assert.equal(dataPath('~/.dsh/projects/projects.json'), join(homedir(), '.dsh/projects/projects.json')));
});

test('projects page: a project holds workspaces, and gets a coordinator only when one is added', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const options = { gateway: true, workspaces: ['/work/a', '/work/b', '/work/c'] };
    const { host, raw } = setup({}, dir, options);
    await tick();
    const remote = host.provided.get('dshPluginProjectsRemote');
    const refused = async (promise, pattern) => {
        await assert.rejects(promise, (error) => error.code === 'projects/refused' && pattern.test(error.message));
    };
    const project = (list, id) => {
        const found = list.projects.find((p) => p.id === id);
        return found === undefined ? undefined : plain(found);
    };
    const spaces = (list, id) => project(list, id)?.workspaces.map((w) => w.id);
    const sessionsBefore = host.sessions.size;

    // The profile project holds its own folder once DSH has it.
    let list = await remote.list();
    assert.deepEqual(spaces(list, 'dsh-plugins'), ['ws:/work/dsh']);
    assert.equal(project(list, 'dsh-plugins').source, 'profile');

    // A new project, holding one workspace: no coordinator, no session.
    let made = await remote.create('  Recipes  ', 'ws:/work/a');
    assert.equal(made.project, 'recipes');
    const { settings, access, ...recipes } = project(made, 'recipes');
    assert.deepEqual(recipes, {
        id: 'recipes', name: 'Recipes', source: 'page', workspace: '/work/a', home: 'ws:/work/a',
        workspaces: [{ id: 'ws:/work/a', path: '/work/a', title: 'a' }],
        coordinator: null, live: null, permission: null, paused: false, threads: { open: 0, resolved: 0 },
    });
    // Without a profile row, its models and access are the plugin's defaults.
    assert.deepEqual([settings.coordinatorEffort, settings.threadEffort], [{ value: null, source: 'DSH default' }, { value: 'high', source: 'plugin default' }]);
    assert.deepEqual(access, {
        yourTools: { value: 'asked', source: 'plugin default' },
        coordinatorPermission: { value: 'default', source: 'plugin default' },
        threadPermission: { value: 'workspace-write', source: 'plugin default' },
    });
    assert.equal(host.sessions.size, sessionsBefore);
    // Names are unique ids; an empty one is refused.
    assert.equal((await remote.create('Recipes')).project, 'recipes-2');
    await refused(remote.create('   '), /a project needs a name/);

    // Workspaces move between projects, in DSH's order, and back to none.
    list = await remote.move('ws:/work/c', 'recipes');
    list = await remote.move('ws:/work/b', 'recipes');
    assert.deepEqual(spaces(list, 'recipes'), ['ws:/work/a', 'ws:/work/b', 'ws:/work/c']);
    list = await remote.move('ws:/work/c', 'recipes-2');
    assert.deepEqual([spaces(list, 'recipes'), spaces(list, 'recipes-2')], [['ws:/work/a', 'ws:/work/b'], ['ws:/work/c']]);
    list = await remote.move('ws:/work/c', null);
    assert.deepEqual(spaces(list, 'recipes-2'), []);
    await refused(remote.move('ws:/nope', 'recipes'), /DSH has no such workspace/);
    await refused(remote.move('ws:/work/a', 'nope'), /"nope" is not a project here/);
    // The folder a coordinator works in stays in its project.
    await refused(remote.move('ws:/work/dsh', 'recipes'), /dsh is where ◆ DSH Plugins's coordinator works/);

    // A coordinator, added in a chosen workspace of the project.
    await refused(remote.addCoordinator('recipes', 'ws:/work/c'), /c is not in Recipes/);
    await refused(remote.addCoordinator('recipes-2'), /Recipes holds no workspace yet/);
    const added = await remote.addCoordinator('recipes', 'ws:/work/b');
    const coord = host.live.get(added.coordinator);
    assert.equal(host.sessions.get(added.coordinator).title, '◆ Recipes');
    assert.equal(host.sessions.get(added.coordinator).cwd, 'ws:/work/b');
    assert.deepEqual([project(added, 'recipes').coordinator, project(added, 'recipes').home, project(added, 'recipes').workspace], [added.coordinator, 'ws:/work/b', '/work/b']);
    assert.ok(coord.ctx.registered.has('project_thread_start'), 'the coordinator gets the project tools');
    assert.match(coord.ctx.section(), /You are the coordinator of the DSH project "Recipes"\. The user talks to you here\. You run their work in threads and tell them what each thread found\.\nGoal: none set yet\. Until the user gives one, the project is only what they ask for in this chat\.\nWorkspace: \/work\/b\nThe project's other folders: \/work\/a\. A thread works in the workspace above unless project_thread_start names one of these as its folder\./);
    assert.equal((await remote.addCoordinator('recipes')).coordinator, added.coordinator, 'adding again keeps the one it has');
    await refused(remote.move('ws:/work/b', null), /b is where ◆ Recipes's coordinator works/);
    list = await remote.move('ws:/work/a', 'recipes-2');
    assert.deepEqual(spaces(list, 'recipes'), ['ws:/work/b']);
    list = await remote.move('ws:/work/a', 'recipes');

    // A thread can work in another of the project's folders, named by its folder name.
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'In a', brief: 'Go.', folder: 'a' });
    const t1 = [...host.sessions].find(([, v]) => v.title === 'In a');
    assert.equal(t1[1].cwd, 'ws:/work/a');
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Nowhere', brief: 'Go.', folder: '/work/c' }), /^Failed: "\/work\/c" is not one of this project's folders \(\/work\/a, \/work\/b\)/);

    // Renaming follows into the coordinator's title; a profile project is renamed in the profile.
    await remote.rename('recipes', 'Recipe Lab');
    assert.equal(host.sessions.get(added.coordinator).title, '◆ Recipe Lab');
    await refused(remote.rename('dsh-plugins', 'X'), /name is set in your profile/);
    // Deleting: only a project without a coordinator; its workspaces go back to none.
    await refused(remote.remove('recipes'), /has a coordinator/);
    await refused(remote.remove('dsh-plugins'), /set in your profile/);
    list = await remote.move('ws:/work/c', 'recipes-2');
    list = await remote.remove('recipes-2');
    assert.equal(project(list, 'recipes-2'), undefined);
    assert.equal(plain(ProjectStore.open(raw.storeFile).workspaceOf)['ws:/work/c'], undefined);

    // After a restart: the same projects and workspaces, the coordinator resumed, nothing new made.
    const sessions = host.sessions.size;
    const again = fakeHost(options);
    for (const [id, session] of host.sessions) again.sessions.set(id, session);
    again.workspaceRegistry = host.workspaceRegistry;
    plugin.apply(again, plugin.Config(raw));
    await tick();
    const after = await again.provided.get('dshPluginProjectsRemote').list();
    assert.deepEqual(after.projects.map((p) => [p.id, p.name, p.coordinator !== null, p.workspaces.map((w) => w.id)]), [
        ['dsh-plugins', 'DSH Plugins', true, ['ws:/work/dsh']],
        ['recipes', 'Recipe Lab', true, ['ws:/work/a', 'ws:/work/b']],
    ]);
    assert.equal(again.sessions.size, sessions);
    assert.match(readFileSync(raw.logFile, 'utf8'), new RegExp(`coordinator recipes ${added.coordinator} resumed`));
});

test('projects page: a project whose coordinator was deleted in DSH goes back to none, and gets a new one when added', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const options = { gateway: true, workspaces: ['/work/a'] };
    const { host, raw } = setup({}, dir, options);
    await tick();
    const remote = host.provided.get('dshPluginProjectsRemote');
    await remote.create('Lab', 'ws:/work/a');
    const first = (await remote.addCoordinator('lab')).coordinator;
    // The user deletes the coordinator session in DSH; the next start finds it gone.
    host.sessions.delete(first);
    host.live.delete(first);
    const again = fakeHost(options);
    for (const [id, session] of host.sessions) again.sessions.set(id, session);
    again.workspaceRegistry = host.workspaceRegistry;
    plugin.apply(again, plugin.Config(raw));
    await tick();
    const remote2 = again.provided.get('dshPluginProjectsRemote');
    const lab = (await remote2.list()).projects.find((p) => p.id === 'lab');
    assert.equal(lab.coordinator, null);
    assert.equal([...again.sessions.values()].filter((v) => v.title === '◆ Lab').length, 0, 'no coordinator is made unasked');
    const second = (await remote2.addCoordinator('lab')).coordinator;
    assert.notEqual(second, first);
    assert.equal(again.sessions.get(second).title, '◆ Lab');
});

test('import: the old sidebar\'s projects come in once, in their order, without coordinators; the old file is only read', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    const file = join(home, 'fleet-shell', 'state.json');
    mkdirSync(join(home, 'fleet-shell'));
    const old = {
        prefs: { projectsSidebar: true, treeOrder: 'updated' },
        projects: [
            { id: 'p4', name: 'Local Model Recipe', instructions: '', files: [], defaults: {} },
            { id: 'p3', name: 'Fleet  Services', instructions: '', files: [], defaults: {} },
            { id: 'p1', name: 'dsh plugins', instructions: '', files: [], defaults: {} },
            { id: 'p9', name: 'Security' },
            { id: 'p8', name: '   ' },
        ],
        projectOf: {
            'ws:/work/a': 'p4', 'ws:/work/b': 'p3', 'ws:/work/gone': 'p3', 'ws:/work/c': '_none',
            'ws:/work/d': 'p1', 'ws:/work/dsh': 'p4', 'ws:/work/e': 'p-deleted',
        },
    };
    const text = `${JSON.stringify(old, null, 2)}\n`;
    writeFileSync(file, text);
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const options = { gateway: true, workspaces: ['/work/dsh', '/work/a', '/work/b', '/work/c', '/work/d', '/work/e'] };
    await withDshHome(home, async () => {
        const { host, raw } = setup({}, dir, options);
        await tick();
        const remote = host.provided.get('dshPluginProjectsRemote');
        const list = await remote.list();
        assert.deepEqual(list.projects.map((p) => [p.id, p.name, p.source, p.coordinator !== null, p.workspaces.map((w) => w.id)]), [
            // The profile project keeps its folder and takes in the old project of the same name.
            ['dsh-plugins', 'DSH Plugins', 'profile', true, ['ws:/work/dsh', 'ws:/work/d']],
            ['local-model-recipe', 'Local Model Recipe', 'import', false, ['ws:/work/a']],
            ['fleet-services', 'Fleet Services', 'import', false, ['ws:/work/b']],
            ['security', 'Security', 'import', false, []],
        ]);
        assert.equal([...host.sessions.values()].filter((v) => v.title?.startsWith('◆')).length, 1, 'only the profile project has a coordinator');
        const store = plain(ProjectStore.open(raw.storeFile));
        assert.deepEqual({ ...store.imports.fleetShell, at: 'x' }, { at: 'x', file, projects: 3, joined: 1, workspaces: 3, skipped: 1 });
        assert.equal(store.projects['local-model-recipe'].importedFrom, 'p4');
        assert.match(readFileSync(raw.logFile, 'utf8'), /import fleet-shell projects=3 joined=1 workspaces=3 skipped=1/);
        assert.equal(readFileSync(file, 'utf8'), text, 'the old file is unchanged');

        // Once only: a later start with a changed old file imports nothing.
        writeFileSync(file, JSON.stringify({ ...old, projects: [...old.projects, { id: 'p7', name: 'Later' }], projectOf: { 'ws:/work/c': 'p7' } }));
        await remote.move('ws:/work/b', null);
        const again = fakeHost(options);
        for (const [id, session] of host.sessions) again.sessions.set(id, session);
        again.workspaceRegistry = host.workspaceRegistry;
        plugin.apply(again, plugin.Config(raw));
        await tick();
        const after = await again.provided.get('dshPluginProjectsRemote').list();
        assert.deepEqual(after.projects.map((p) => [p.id, p.workspaces.map((w) => w.id)]), [
            ['dsh-plugins', ['ws:/work/dsh', 'ws:/work/d']], ['local-model-recipe', ['ws:/work/a']], ['fleet-services', []], ['security', []],
        ]);
    });
});

test('import: an unreadable old file is logged and tried again at the next start; none at all is quiet', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    await withDshHome(home, async () => {
        const { host, raw } = setup({}, dir, { gateway: true });
        await tick();
        assert.deepEqual(plain(ProjectStore.open(raw.storeFile).imports), {});
        assert.doesNotMatch(readFileSync(raw.logFile, 'utf8'), /import/);
        mkdirSync(join(home, 'fleet-shell'));
        writeFileSync(join(home, 'fleet-shell', 'state.json'), '{ not json');
        const again = fakeHost({ gateway: true });
        for (const [id, session] of host.sessions) again.sessions.set(id, session);
        again.workspaceRegistry = host.workspaceRegistry;
        plugin.apply(again, plugin.Config(raw));
        await tick();
        assert.match(readFileSync(raw.logFile, 'utf8'), /error import fleet-shell/);
        assert.deepEqual(plain(ProjectStore.open(raw.storeFile).imports), {});
    });
});

test('import plan: one group per name in the old order, a name already here joins it, and what stays where it is', () => {
    const state = {
        projects: [{ id: 'p1', name: ' Alpha  One ' }, { id: 'p2', name: 'beta' }, { id: 'p3', name: 'alpha one' }, { id: 'p4', name: ' ' }, { id: 5, name: 'No id' }],
        projectOf: { w1: 'p1', w2: 'p3', w3: 'p2', w4: '_none', w5: 'p-deleted', w6: 'p1', w7: 'p2' },
    };
    const plan = planFleetShellImport(state, { names: new Map([['beta', 'beta-here']]), known: (id) => id !== 'w6', placed: (id) => id === 'w7' });
    assert.deepEqual(plan, {
        groups: [{ name: 'Alpha One', from: 'p1', workspaces: ['w1', 'w2'] }, { name: 'beta', join: 'beta-here', from: 'p2', workspaces: ['w3'] }],
        kept: ['w7'], skipped: ['w6'], loose: ['w4', 'w5'],
    });
    const none = { groups: [], kept: [], skipped: [], loose: [] };
    const here = { names: new Map(), known: () => true, placed: () => false };
    assert.deepEqual(planFleetShellImport(null, here), none);
    assert.deepEqual(planFleetShellImport({ projects: 'p1', projectOf: null }, here), none);
});

test('import preview: says what the import will do, reading only, and that it ran once it has', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    for (const dir of ['fleet-shell', 'storages', 'projects']) mkdirSync(join(home, dir));
    const state = { projects: [{ id: 'p1', name: 'Fleet Services' }, { id: 'p2', name: 'Security' }], projectOf: { w1: 'p1', w2: 'p1', w3: 'p2', w4: '_none', w9: 'p2' } };
    const workspaces = {
        w1: { path: '/work/fleet-ops', title: 'fleet-ops', sessionIds: ['s-chat'] },
        w2: { path: '/work/plugins', title: 'deepseek-plugins', sessionIds: ['s-coordinator'] },
        w3: { path: '/work/lab', title: 'Vulnerability Lab', sessionIds: [] },
        w4: { path: '/work/discord', title: 'DSH Discord', sessionIds: [] },
    };
    const files = {
        [join(home, 'fleet-shell', 'state.json')]: JSON.stringify(state),
        [join(home, 'storages', 'workspace.json')]: JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: {}, tables: { workspaces } }),
        [join(home, 'projects', 'projects.json')]: JSON.stringify({ version: 1, projects: { 'dsh-plugins': { coordinatorSessionId: 's-coordinator' }, elsewhere: { coordinatorSessionId: 's-other-dsh' } } }),
    };
    for (const [file, text] of Object.entries(files)) writeFileSync(file, text);
    const script = fileURLToPath(new URL('../scripts/import-preview.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [script], { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /1\. Fleet Services, a new project without a coordinator\n {5}fleet-ops \(\/work\/fleet-ops\)\n2\. Security, a new project without a coordinator\n {5}Vulnerability Lab \(\/work\/lab\)\n/);
    assert.match(first.stdout, /Already in a project here, stays there: deepseek-plugins \(\/work\/plugins\) in "dsh-plugins"/);
    assert.match(first.stdout, /Ungrouped in the old sidebar, goes to Other workspaces: DSH Discord \(\/work\/discord\)/);
    assert.match(first.stdout, /Gone from DSH, skipped: w9/);
    assert.match(first.stdout, /Result: 2 new projects, 0 joined, 2 workspaces placed, 1 skipped\./);
    assert.match(first.stdout, /it names coordinators this DSH doesn't list in any workspace: elsewhere \(s-other-dsh\)\./);
    assert.doesNotMatch(first.stdout, /dsh-plugins \(s-coordinator\)/);
    for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(file, 'utf8'), text, `${file} is unchanged`);
    writeFileSync(join(home, 'projects', 'projects.json'), JSON.stringify({ version: 1, projects: {}, imports: { fleetShell: { at: '2026-10-10T15:00:00.000Z', projects: 2, workspaces: 2, skipped: 1 } } }));
    assert.match(run().stdout, /Already imported \(2026-10-10T15:00:00\.000Z\): 2 projects, 2 workspaces, 1 skipped\. It won't run again\./);
});

// ── code changes (changes.js) ──────────────────────────────────────────────

test('changes: each turn\'s newest summary is kept, and the totals count a file once', () => {
    const summary = (turn, files) => ({
        turn, cwd: '/w', files, total: files.length,
        added: files.reduce((n, f) => n + f.added, 0), deleted: files.reduce((n, f) => n + f.deleted, 0),
    });
    const r1 = changeRecord(7, summary(1, [{ path: '/w/a.md', display: 'a.md', added: 3, deleted: 0 }, { path: '/w/img.png', display: 'img.png', added: 0, deleted: 0, binary: true }]));
    assert.deepEqual(r1, { turn: 1, seq: 7, added: 3, deleted: 0, total: 2, files: [{ path: 'a.md', added: 3, deleted: 0 }, { path: 'img.png', added: 0, deleted: 0, binary: true }] });
    assert.equal(changeRecord(7, null), null);
    assert.equal(changeRecord(undefined, summary(1, [])), null);
    let list = withChange(undefined, r1);
    const r2 = changeRecord(12, summary(2, [{ path: '/w/a.md', display: 'a.md', added: 1, deleted: 1 }]));
    list = withChange(list, r2);
    assert.deepEqual(changeTotals(list), { added: 4, deleted: 1, files: 2, turns: 2, last: { seq: 12, turn: 2 } });
    assert.equal(changesLine(changeTotals(list)), 'changed 2 files (+4 -1)');
    // DSH announces a turn again when its changes change: the newer one replaces it; one without files drops it.
    list = withChange(list, changeRecord(15, summary(2, [{ path: '/w/a.md', display: 'a.md', added: 2, deleted: 1 }])));
    assert.deepEqual(list.map((r) => [r.turn, r.seq, r.added]), [[1, 7, 3], [2, 15, 2]]);
    list = withChange(list, changeRecord(16, summary(2, [])));
    assert.deepEqual(changeTotals(list), { added: 3, deleted: 0, files: 2, turns: 1, last: { seq: 7, turn: 1 } });
    // Files DSH counted but did not list (over its cap) still count.
    const capped = changeRecord(20, { turn: 3, files: [{ display: 'x.js', added: 1, deleted: 0 }], total: 5, added: 9, deleted: 4 });
    assert.deepEqual(changeTotals([capped]), { added: 9, deleted: 4, files: 5, turns: 1, last: { seq: 20, turn: 3 } });
    assert.equal(changesLine(changeTotals([changeRecord(1, summary(1, [{ display: 'one.md', added: 1, deleted: 0 }]))])), 'changed 1 file (+1 -0)');
    assert.equal(changeTotals([]), null);
    assert.equal(changeTotals(undefined), null);
    assert.equal(changesLine(null), '');
    // Past MAX_TURNS the oldest turns fold together: fewer records, every turn still counted.
    let many = [];
    for (let turn = 1; turn <= MAX_TURNS + 5; turn++) {
        many = withChange(many, changeRecord(turn * 10, summary(turn, [{ display: 'f.md', added: 1, deleted: 0 }, { display: `only-${turn}.md`, added: 2, deleted: 1 }])));
    }
    assert.equal(many.length, MAX_TURNS);
    assert.deepEqual(changeTotals(many), { added: 3 * (MAX_TURNS + 5), deleted: MAX_TURNS + 5, files: MAX_TURNS + 6, turns: MAX_TURNS + 5, last: { seq: (MAX_TURNS + 5) * 10, turn: MAX_TURNS + 5 } });
    assert.deepEqual(many[0].files.find((f) => f.path === 'f.md'), { path: 'f.md', added: 6, deleted: 0 });
});

test('changes: a thread\'s file changes reach the window and its coordinator, and outlive DSH\'s own copy', async () => {
    const { host, dir } = setup({}, undefined, { ...SELECTING, gateway: true });
    // DSH's workspace-changes service: it serves a summary while it holds the session.
    const summaries = new Map();
    host.services.workspaceChanges = { summary: (sessionId, seq) => summaries.get(`${sessionId}/${seq}`) };
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Edit', brief: 'Go.' });
    const t1 = threadOf(host, coord);
    const announce = (seq, turn, files) => {
        // Like DSH: the event first, its summary right after.
        t1.ctx.sessionEvent({ type: 'workspace/changes', seq, data: { turn } });
        summaries.set(`${t1.id}/${seq}`, {
            turn, cwd: '/work/dsh', files, total: files.length,
            added: files.reduce((n, f) => n + f.added, 0), deleted: files.reduce((n, f) => n + f.deleted, 0),
        });
    };
    assert.equal((await remote.describe(coord.id)).threads[0].changes, null, 'nothing changed yet');
    announce(7, 1, [{ path: '/work/dsh/a.md', display: 'a.md', added: 3, deleted: 0 }, { path: '/work/dsh/b.js', display: 'b.js', added: 10, deleted: 2 }]);
    await tick();
    let read = await remote.describe(coord.id);
    assert.deepEqual(plain(read.threads[0].changes), { added: 13, deleted: 2, files: 2, turns: 1, last: { seq: 7, turn: 1 }, reviewable: true });
    // Another turn edits one of the same files: lines add up, the file counts once, and Review opens the newest turn.
    announce(12, 2, [{ path: '/work/dsh/a.md', display: 'a.md', added: 1, deleted: 1 }]);
    await tick();
    read = await remote.describe(t1.id);
    assert.deepEqual(plain(read.threads[0].changes), { added: 14, deleted: 3, files: 2, turns: 2, last: { seq: 12, turn: 2 }, reviewable: true });
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /changes dsh-plugins\/t1 turn=2 files=1 \+1 -1/);
    // The coordinator hears it in its roster and in project_thread_list.
    assert.match(coord.ctx.section(), /- t1 · "Edit" · idle · no handback yet · changed 2 files \(\+14 -3\)/);
    assert.match(await coord.ctx.call('project_thread_list', {}), /changed 2 files \(\+14 -3\)/);
    // DSH drops its copy when it restarts: the totals stay, and Review is no longer offered.
    summaries.clear();
    read = await remote.describe(coord.id);
    assert.deepEqual(plain(read.threads[0].changes), { added: 14, deleted: 3, files: 2, turns: 2, last: { seq: 12, turn: 2 }, reviewable: false });
    // A DSH without the service: an announcement it never serves changes nothing and throws nothing.
    delete host.services.workspaceChanges;
    t1.ctx.sessionEvent({ type: 'workspace/changes', seq: 20, data: { turn: 3 } });
    await tick();
    assert.equal((await remote.describe(coord.id)).threads[0].changes.turns, 2);
});

test('browser half: a thread\'s changes read as DSH\'s card counts them, and its projection says when to read them again', () => {
    const { client } = loadClient();
    const { changesOf, changesText, lastChange, REVIEW_PREFIX } = client.internals;
    const changes = { added: 18, deleted: 3, files: 2, turns: 1, last: { seq: 12, turn: 2 }, reviewable: true };
    assert.equal(changesOf(changes), changes);
    for (const bad of [null, undefined, 'x', { added: 1, deleted: 0, files: 0 }, { added: '1', deleted: 0, files: 1 }]) assert.equal(changesOf(bad), undefined);
    assert.equal(changesText(changes), '2 files changed: 18 lines added, 3 deleted');
    assert.equal(changesText({ ...changes, files: 1, added: 1 }), '1 file changed: 1 line added, 3 deleted');
    assert.equal(lastChange({ role: 'thread', changes: [{ turn: 1, seq: 9 }, { turn: 2, seq: 15 }] }), '15');
    assert.equal(lastChange({ role: 'thread' }), '');
    assert.equal(lastChange(undefined), '');
    // DSH's own Review tab, as its "Edited N files" card opens it.
    assert.equal(REVIEW_PREFIX, 'dsh-resource://changes-review/session/');
});

// ── the DSH window's view (projection.js) ───────────────────────────────────

/** Fold a session log through the registered projection, as DSH's drive does. */
function fold(host, sessionId, events = host.sessions.get(sessionId).events) {
    const def = host.projections[0];
    let state = def.init({ id: sessionId });
    for (const event of events) state = def.apply(state, event);
    return def.wire.viewSchema.parse(def.wire.view(state));
}

test('projection: coordinator roster and cards, thread role and coordinator link', async () => {
    const { host } = setup();
    await tick();
    assert.equal(host.projections.length, 1);
    assert.equal(host.projections[0].key, 'projectSession');
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Add CI', brief: 'Add a workflow.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    // The tool result records the view; the model sees only text.
    const started = coord.ctx.metas.at(-1);
    assert.equal(started.name, 'project_thread_start');
    assert.deepEqual(started.meta.action, { kind: 'start', thread: 't1' });
    assert.equal(started.meta.threads[0].session, thread.id);

    // A session the store does not know yet (DSH folds new sessions from their first event) reads only events.
    const coordEvents = host.sessions.get(coord.id).events;
    const fresh = fold(host, 'not-in-store', coordEvents);
    assert.equal(fresh.role, 'coordinator');
    assert.deepEqual(fresh.project, { id: 'dsh-plugins', name: 'DSH Plugins' });
    assert.deepEqual(fresh.threads.map((t) => [t.id, t.session, t.title, t.resolved]), [['t1', thread.id, 'Add CI', false]]);
    assert.deepEqual(fresh.cards.map((c) => [c.kind, c.thread]), [['start', 't1']]);

    // The brief names the thread and, through its request id, the coordinator.
    const tv = fold(host, 'not-in-store', host.sessions.get(thread.id).events);
    assert.equal(tv.role, 'thread');
    assert.deepEqual(tv.thread, { id: 't1', title: 'Add CI' });
    assert.equal(tv.project.name, 'DSH Plugins');
    assert.equal(tv.coordinator, coord.id);

    // A handback: the coordinator's roster and a card; the thread's own card.
    thread.ctx.emitStatus(thread, 'running');
    await thread.ctx.call('project_handback', { status: 'done', summary: 'CI added in .github/workflows/test.yml' });
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    const after = fold(host, 'not-in-store', coordEvents);
    assert.deepEqual(after.cards.map((c) => [c.kind, c.thread, c.status ?? null]), [['start', 't1', null], ['handback', 't1', 'done']]);
    assert.equal(after.threads[0].handback.status, 'done');
    assert.equal(after.threads[0].handback.summary, 'CI added in .github/workflows/test.yml');
    const own = fold(host, 'not-in-store', host.sessions.get(thread.id).events);
    assert.deepEqual(own.cards.map((c) => [c.kind, c.status]), [['handback', 'done']]);

    // Resolve: a card, and the roster says so.
    await coord.ctx.call('project_thread_update', { thread: 't1', resolved: true });
    const resolved = fold(host, 'not-in-store', coordEvents);
    assert.deepEqual(resolved.cards.at(-1), { turn: 0, seq: resolved.cards.at(-1).seq, kind: 'update', thread: 't1', status: 'resolved' });
    assert.equal(resolved.threads[0].resolved, true);
});

test('projection: sessions the store knows are seeded; older events add cards but never roll the roster back', async () => {
    const { host } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Old name', brief: 'x' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    await coord.ctx.call('project_thread_update', { thread: 't1', title: 'New name' });
    const events = host.sessions.get(coord.id).events.map((e) => ({ ...e, time: 1 })); // written long before the fold
    const seeded = fold(host, coord.id, events);
    assert.equal(seeded.threads[0].title, 'New name', 'the seed is newer than the replayed start');
    assert.deepEqual(seeded.cards.map((c) => [c.kind, c.status ?? null]), [['start', null], ['update', 'renamed']]);
    const tv = fold(host, thread.id, []);
    assert.deepEqual([tv.role, tv.thread.title, tv.coordinator], ['thread', 'New name', coord.id]);
    assert.equal(fold(host, 'plain-session', []), null);
});

test('projection: a new coordinator\'s welcome turn, and whether the user has asked anything since', () => {
    const { host } = setup();
    const def = host.projections[0];
    assert.equal(def.stateVersion, 6, 'the fold changed, so DSH folds every session again');
    const msg = (seq, text, source) => ({ type: 'user/message', seq, time: seq, data: { content: [{ type: 'text', text }], ...(source ? { source } : {}) } });
    let s = def.apply(def.init({ id: 'new' }), { type: 'turn/start', data: { turn: 0 } });
    s = def.apply(s, msg(1, '[Project created: "DSH Plugins"]\n\nThis is the first message in this coordinator session.', { kind: 'cordis-host-runner' }));
    assert.deepEqual([s.v.role, s.v.project.name, s.v.asked], ['coordinator', 'DSH Plugins', undefined]);
    assert.deepEqual(s.v.cards, [{ turn: 0, seq: 1, kind: 'welcome' }]);
    // Another plugin's or another session's message is not the user asking.
    assert.equal(def.apply(s, msg(2, 'Cordis install x completed successfully.', { kind: 'cordis-host-runner' })), s);
    assert.equal(def.apply(s, msg(2, 'Agent s9 sent a message.', { kind: 'agent-message', form: 'relay', senderSessionId: 's9' })), s);
    s = def.apply(s, { type: 'turn/start', data: { turn: 1 } });
    const asked = def.apply(s, msg(3, 'Plan the work.', { kind: 'user', rpcId: 'browser-1' }));
    assert.equal(asked.v.asked, true);
    assert.equal(def.apply(asked, msg(4, 'More.', { kind: 'user', rpcId: 'browser-2' })), asked, 'once is enough');
    assert.equal(def.apply(s, msg(3, 'Plan the work.')).v.asked, true, 'a message without a source is the user\'s');
    // A thread's own user messages leave it as it is.
    const brief = def.apply(def.init({ id: 't' }), msg(1, '[Brief from the coordinator of "DSH Plugins" · you are thread t1, "Go"]\n\nGo.', { kind: 'agent-message', form: 'relay', senderSessionId: 'c' }));
    assert.equal(def.apply(brief, msg(2, 'Hello.', { kind: 'user', rpcId: 'browser-3' })), brief);
    assert.equal(def.apply(brief, msg(3, '[Project created: "DSH Plugins"]\n\nx', { kind: 'cordis-host-runner' })), brief, 'a thread never takes a welcome');
});

test('projection: a thread notes each turn that changed files, a newer announcement replacing its turn', () => {
    const { host } = setup();
    const def = host.projections[0];
    const brief = { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '[Brief from the coordinator of "DSH Plugins" · you are thread t1, "Go"]\n\nGo.' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 'c' } } };
    let s = def.apply(def.apply(def.init({ id: 't' }), { type: 'turn/start', data: { turn: 1 } }), brief);
    s = def.apply(s, { type: 'workspace/changes', seq: 9, data: { turn: 1 } });
    s = def.apply(def.apply(s, { type: 'turn/start', data: { turn: 2 } }), { type: 'workspace/changes', seq: 15, data: { turn: 2 } });
    assert.deepEqual(s.v.changes, [{ turn: 1, seq: 9 }, { turn: 2, seq: 15 }]);
    s = def.apply(s, { type: 'workspace/changes', seq: 18, data: { turn: 2 } });
    assert.deepEqual(s.v.changes, [{ turn: 1, seq: 9 }, { turn: 2, seq: 18 }]);
    // A coordinator's or an unknown session's changes are not a thread's.
    const plainState = def.init({ id: 'plain' });
    assert.equal(def.apply(plainState, { type: 'workspace/changes', seq: 3, data: { turn: 1 } }), plainState);
    const welcome = def.apply(def.init({ id: 'c' }), { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '[Project created: "DSH Plugins"]\n\nHi.' }], source: { kind: 'cordis-host-runner' } } });
    assert.equal(def.apply(welcome, { type: 'workspace/changes', seq: 4, data: { turn: 0 } }), welcome);
});

test('projection: a thread\'s last turn that failed or stopped, until a turn finishes or hands back', () => {
    const { host } = setup();
    const def = host.projections[0];
    const T0 = Date.parse('2026-10-10T10:00:00.000Z');
    const brief = { type: 'user/message', seq: 1, time: T0, data: { content: [{ type: 'text', text: '[Brief from the coordinator of "DSH Plugins" · you are thread t1, "Flaky"]\n\nGo.' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 'c' } } };
    const end = (seq, reason, turn = 1) => ({ type: 'turn/end', seq, time: T0 + seq, data: { turn, reason } });
    let s = def.apply(def.apply(def.init({ id: 't' }), { type: 'turn/start', data: { turn: 1 } }), brief);
    s = def.apply(s, end(2, { kind: 'error', error: { message: '400: {"message":"The model rejected the request: bad attachment.","type":"invalid_request_error"}', code: 'INVALID_REQUEST' } }));
    assert.deepEqual(plain(def.wire.view(s).ending), {
        turn: 1, seq: 2, at: new Date(T0 + 2).toISOString(), state: 'failed', kind: 'error', message: 'The model rejected the request: bad attachment.', code: 'INVALID_REQUEST',
    });
    // Stopped by the user, cut off by DSH closing, at the token limit; blocked and a sign-out read as failed, as DSH shows them.
    for (const [reason, want] of [
        [{ kind: 'aborted', reason: { kind: 'user' } }, ['stopped', 'aborted', 'user', undefined]],
        [{ kind: 'aborted', reason: { kind: 'hook', reason: 'budget' } }, ['stopped', 'aborted', 'hook', 'budget']],
        [{ kind: 'interrupted' }, ['stopped', 'interrupted', undefined, undefined]],
        [{ kind: 'max-tokens' }, ['stopped', 'max-tokens', undefined, undefined]],
        [{ kind: 'blocked' }, ['failed', 'blocked', undefined, undefined]],
        [{ kind: 'aborted', reason: { kind: 'hook', reason: 'deepseek-account/signed-out' } }, ['failed', 'signed-out', undefined, undefined]],
    ]) {
        const e = def.wire.view(def.apply(s, end(3, reason, 2))).ending;
        assert.deepEqual([e.state, e.kind, e.cause, e.hook, e.turn, e.seq], [...want, 2, 3], JSON.stringify(reason));
    }
    // The same ending again in a later turn is counted, so a retry that failed again says so; any other ending,
    // the same turn's end again, or a finished turn in between starts the count over.
    const fail = (seq, turn) => end(seq, { kind: 'error', error: { message: 'again' } }, turn);
    const again = def.apply(s, fail(3, 2));
    assert.deepEqual([def.wire.view(again).ending.times, def.wire.view(def.apply(again, fail(4, 3))).ending.times], [2, 3]);
    assert.equal(def.wire.view(def.apply(again, end(4, { kind: 'aborted', reason: { kind: 'user' } }, 3))).ending.times, undefined);
    assert.equal(def.wire.view(def.apply(s, fail(3, 1))).ending.times, undefined);
    assert.equal(def.wire.view(def.apply(def.apply(again, end(4, { kind: 'completed' }, 3)), fail(5, 4))).ending.times, undefined);
    // A turn that finishes clears it; an ending this fold doesn't know, or none, keeps what was.
    assert.equal(def.wire.view(def.apply(s, end(4, { kind: 'completed' }, 2))).ending, undefined);
    assert.equal(def.apply(s, end(5, { kind: 'forked' })), s);
    assert.equal(def.apply(s, { type: 'turn/end', seq: 6, data: { turn: 2 } }), s);
    // A turn that handed back a result is told by its handback, even when it failed after; a progress handback isn't a result.
    const handback = (seq, status, turn) => ({ type: 'tool/result', seq, time: T0 + seq, data: { turn, meta: { dshProjects: 1, role: 'thread', project: { id: 'p', name: 'DSH Plugins' }, thread: { id: 't1', title: 'Flaky' }, coordinator: 'c', action: { kind: 'handback', thread: 't1', status } } } });
    let h = def.apply(def.apply(s, { type: 'turn/start', data: { turn: 3 } }), handback(7, 'done', 3));
    assert.equal(def.wire.view(def.apply(h, end(8, { kind: 'error', error: { message: 'late' } }, 3))).ending, undefined);
    h = def.apply(def.apply(s, { type: 'turn/start', data: { turn: 3 } }), handback(7, 'progress', 3));
    assert.equal(def.wire.view(def.apply(h, end(8, { kind: 'aborted', reason: { kind: 'user' } }, 3))).ending.state, 'stopped');
    // A coordinator's turns keep no ending.
    const welcome = def.apply(def.init({ id: 'c' }), { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '[Project created: "DSH Plugins"]\n\nHi.' }], source: { kind: 'cordis-host-runner' } } });
    assert.equal(def.apply(welcome, end(2, { kind: 'error', error: { message: 'x' } }, 0)), welcome);
    // The coordinator's idle card says when the thread's turn failed or stopped (the note's first line).
    const idle = (seq, first) => ({ type: 'user/message', seq, time: seq, data: { content: [{ type: 'text', text: `[Thread idle without a handback: t1 · "Flaky"]\n\n${first}\n\nIt produced no reply text.` }], source: { kind: 'cordis-host-runner' } } });
    let c = def.apply(welcome, idle(3, 'The turn failed: 400: {"message":"x"}'));
    c = def.apply(c, idle(4, 'The turn was cut off because DSH stopped while it ran.'));
    c = def.apply(c, idle(5, 'Its last reply:'));
    assert.deepEqual(plain(c.v.cards.slice(1).map((card) => card.status ?? null)), ['failed', 'stopped', null]);
});

test('projection: unrelated and malformed events keep the same state; parsing never throws', () => {
    const { host } = setup();
    const def = host.projections[0];
    const state = def.init({ id: 'plain' });
    for (const event of [null, {}, { type: 'assistant/message' }, { type: 'tool/result', data: { meta: { other: 1 } } }, { type: 'user/message', data: null },
        // A user typing a tag is not the plugin speaking.
        { type: 'user/message', data: { content: [{ type: 'text', text: '[Handback from thread t1 · "x" · status: done]' }], source: { kind: 'user', rpcId: 'browser-1' } } },
        { type: 'user/message', data: { content: [{ type: 'text', text: '[Handback from thread t1 · "x" · status: done]' }], source: { kind: 'runtime-context' } } },
        // An agent's message names its sender; one that doesn't is not the plugin's.
        { type: 'user/message', data: { content: [{ type: 'text', text: '[Handback from thread t1 · "x" · status: done]' }], source: { kind: 'agent-message', form: 'relay' } } },
        // DSH's own agents and plugins send untagged text.
        { type: 'user/message', data: { content: [{ type: 'text', text: 'Agent s9 sent a message: done' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 's9' } } },
        { type: 'user/message', data: { content: [{ type: 'text', text: 'Cordis install x completed successfully.' }], source: { kind: 'cordis-host-runner' } } }]) {
        assert.equal(def.apply(state, event), state);
    }
    // A turn moves the internal turn counter but not the value DSH sends.
    const next = def.apply(state, { type: 'turn/start', data: { turn: 3 } });
    assert.equal(next.turn, 3);
    assert.equal(def.wire.view(next), def.wire.view(state));
    for (const bad of [undefined, null, 'x', 5, [], { turn: -1, v: 'no' }, { v: { role: 'boss', project: {} } }]) {
        const parsed = def.stateSchema.parse(bad);
        assert.equal(parsed.v, null);
        assert.equal(parsed.turn, 0);
    }
    assert.equal(def.wire.viewSchema.parse('nope'), null);
    // A handback card lands on the turn the message arrived in.
    let s = def.apply(state, { type: 'turn/start', data: { turn: 7 } });
    s = def.apply(s, { type: 'user/message', seq: 40, time: 5, data: { content: [{ type: 'text', text: '[Handback from thread t2 · "Say "hi"" · status: needs_decision]\n\nPick A or B.\n\n(Full conversation: project_thread_read thread="t2".)' }], source: { kind: 'user', rpcId: 'projects-abc' } } });
    assert.deepEqual(s.v.cards, [{ turn: 7, seq: 40, kind: 'handback', thread: 't2', status: 'needs_decision' }]);
    assert.deepEqual(s.v.threads, [{ id: 't2', session: null, title: 'Say "hi"', resolved: false, handback: { status: 'needs_decision', summary: 'Pick A or B.', at: new Date(5).toISOString() } }]);
    // Messages sent as an agent's (the coordinator's brief, a thread's handback) or a plugin's (the notes) fold the same way.
    s = def.apply(s, { type: 'user/message', seq: 41, time: 6, data: { content: [{ type: 'text', text: '[Handback from thread t3 · "Docs" · status: done]\n\nWritten.' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 's-t3' } } });
    s = def.apply(s, { type: 'user/message', seq: 42, time: 7, data: { content: [{ type: 'text', text: '[Thread idle without a handback: t2 · "Say "hi""]\n\nIt stopped.' }], source: { kind: 'cordis-host-runner' } } });
    assert.deepEqual(s.v.cards.slice(1), [{ turn: 7, seq: 41, kind: 'handback', thread: 't3', status: 'done' }, { turn: 7, seq: 42, kind: 'idle', thread: 't2' }]);
    assert.equal(s.v.threads.find((t) => t.id === 't3').handback.summary, 'Written.');
    let brief = def.apply(def.stateSchema.parse(undefined), { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: '[Brief from the coordinator of "DSH Plugins" · you are thread t4, "Ship"]\n\nShip it.' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 's-c' } } });
    assert.deepEqual([brief.v.role, brief.v.coordinator, brief.v.thread], ['thread', 's-c', { id: 't4', title: 'Ship' }]);
    brief = def.apply(brief, { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: '[From the coordinator]\n\nAlso this.' }], source: { kind: 'agent-message', form: 'relay', senderSessionId: 's-c2' } } });
    assert.equal(brief.v.coordinator, 's-c2', 'a coordinator made again writes from its new session');
});
