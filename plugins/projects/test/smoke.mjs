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
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol';
import * as plugin from '../lib/index.js';
import { effectiveSettings, effectiveAccess, applyRoute, checkSelection, parseModelSpec, pluginDefaults } from '../lib/settings.js';
import { slugify, timing, clipTitle, guardList, guardedIn, unsaidPart } from '../lib/projects.js';
import { changeRecord, withChange, changeTotals, changesLine, MAX_TURNS, lineDelta, editOf, editsIn, editSummary } from '../lib/changes.js';
import { describeEnding, endingStateOf, continueMessage, readableError, welcomeMessage, handbackSummary, handbackMessage, idleMessage, approvalMessage, questionMessage, userMustFix, cardSummary, threadMarkdown, outsideMessage, replyMessage, NUDGE } from '../lib/prompts.js';
import { ProjectStore, dataPath, dshHome } from '../lib/store.js';

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
    /** Run the `approval/request` waterfall as DSH's approval service does; past every listener, the user is asked. */
    async approval(req) {
        const list = this.listeners.get('approval/request') ?? [];
        const run = (i) => (i >= list.length ? Promise.resolve('asked the user') : Promise.resolve(list[i](req, () => run(i + 1))));
        return run(0);
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
    refusal(name, args = {}) {
        for (const check of this.guards) {
            const reason = check({ name, agent: this.agent, arguments: args });
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
    /** Every insertBefore call, as [id, beforeId]. */
    const moves = [];
    /** DSH's archive set, and every archive call as [id, stopActivity]. */
    const archived = [];
    const archives = [];
    /** The fake Host, for DSH's archive events (bind). */
    let host;
    // Like DSH's storage domain: the registry's state, after each durable write.
    const changed = () => host?.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'put', value: { workspaceIds: [...order], archivedSessionIds: [...archived], pinnedSessionIds: [] } });
    const named = (name, message) => Object.assign(new Error(message), { name });
    return {
        add,
        moves,
        archives,
        bind(h) { host = h; },
        get archivedSessionIds() { return [...archived]; },
        /**
         * DSH's: without stopActivity, refused while the session has work (the
         * `workspace/session-activity` waterfall; its own turn innermost here);
         * with it, archived, then its turn stopped the way the user's stop does.
         */
        async archiveSession(id, options = {}) {
            if (archived.includes(id)) return;
            if (!host.sessions.has(id)) throw named('WorkspaceUnknownSessionError', `cannot archive session '${id}': live sessions and session persistence hold no such session`);
            if (options.stopActivity !== true) {
                const activity = await host.waterfall('workspace/session-activity', { sessionId: id }, async () => (host.live.get(id)?.status === 'running' ? [{ kind: 'turn' }] : []));
                if (activity.length > 0) throw Object.assign(named('WorkspaceActiveSessionError', `session '${id}' has work`), { activity });
            }
            archived.push(id);
            archives.push([id, options.stopActivity === true]);
            changed();
            const agent = host.live.get(id);
            if (options.stopActivity === true && agent?.status === 'running') {
                const log = host.sessions.get(id).events;
                log.push({ seq: log.length + 1, type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'user' } } } });
                agent.ctx.emitStatus(agent, 'idle');
            }
        },
        async unarchiveSession(id) {
            if (!archived.includes(id)) return;
            archived.splice(archived.indexOf(id), 1);
            changed();
        },
        async create(path) { return add(path); },
        async resolveByPath(path) { return spaces.get(`ws:${path}`); },
        get: (id) => spaces.get(id),
        list: () => order.map((id) => spaces.get(id)),
        delete(id) { spaces.delete(id); order.splice(order.indexOf(id), 1); },
        /** DSH's: move a workspace before another, or (no anchor) to the end. */
        async insertBefore(id, beforeId) {
            if (!order.includes(id) || (beforeId !== undefined && !order.includes(beforeId))) throw new Error('workspace order: unknown workspace');
            moves.push([id, beforeId]);
            order.splice(order.indexOf(id), 1);
            order.splice(beforeId === undefined ? order.length : order.indexOf(beforeId), 0, id);
            return [...order];
        },
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
        emit(event, ...args) { for (const fn of listeners.get(event) ?? []) fn(...args); },
        /** Like cordis: each listener gets the request and the rest of the chain; the first is outermost. */
        waterfall(event, args, last) {
            const list = listeners.get(event) ?? [];
            const run = (i) => (i >= list.length ? last() : Promise.resolve(list[i](args, () => run(i + 1))));
            return run(0);
        },
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
                // The session's folder, when a test gives it one.
                const meta = typeof sessions.get(id).folder === 'string' ? { cwd: sessions.get(id).folder } : {};
                if (live.has(id)) return { meta, events };
                // Like DSH's cold read: a turn left open by a crash reads as ended, "interrupted".
                const open = events.findLastIndex((e) => e.type === 'turn/start') > events.findLastIndex((e) => e.type === 'turn/end');
                return { meta, events: open ? [...events, { seq: events.length + 1, type: 'turn/end', data: { reason: { kind: 'interrupted' } } }] : events };
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
                return { items: [...sessions].map(([sessionId, s]) => ({ sessionId, updatedAt: 0, running: false, ...(typeof s.cwd === 'string' ? { cwd: s.cwd } : {}), ...(s.title ? { projections: { kind: 'cached', asOfSeq: 1, values: { title: s.title } } } : {}) })) };
            },
            cancel(req) { sessions.get(req.sessionId).cancelled = true; return {}; },
            async modelCatalog() { return CATALOG; },
        },
    };
    host.workspaceRegistry.bind(host);
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
    // coordinator on Read Only and threads on Workspace Write.
    assert.deepEqual(effectiveAccess({}, {}, {}), {
        yourTools: { value: 'asked', source: 'plugin default' },
        coordinatorPermission: { value: 'read-only', source: 'plugin default' },
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
        'project_memory', 'project_message', 'project_settings', 'project_thread_list', 'project_thread_read',
        'project_thread_send', 'project_thread_start', 'project_thread_update',
    ]);
    const text = coord.ctx.section();
    assert.match(text, /coordinator of the DSH project "DSH Plugins"/);
    assert.match(text, /Goal: Ship good DSH plugins/);
    // Models and efforts are settings: the coordinator's prompt names none of them (project_settings shows them).
    assert.doesNotMatch(text, /## Settings|DSH default model|effort (max|high)/);
    assert.match(text, /\n10\. Only when the user asks: resolve a thread \(project_thread_update\) or change models, effort or pause \(project_settings; with no arguments it shows them\)\./);
    // Eleven short numbered rules a weaker model can follow: the user's ask and nothing else, work it picks itself only in the
    // workspace, off the user's personal and infrastructure tools, one way to start a thread, and every thread named as a link.
    assert.deepEqual(text.match(/^\d+\. /gm), ['1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ', '10. ', '11. ']);
    assert.match(text, /\n1\. Do only what the user asks\. When they leave the choice of work to you, pick one small task that only reads and writes files in the workspace, start it now, and say what you picked; don't ask them to choose\./);
    assert.match(text, /\n2\. Never use the user's personal or infrastructure tools \(password managers and vaults, note apps, email and messaging, home or household services, control of the user's screen, model lanes and gateways\), yourself or in a thread, in any way \(tool, command line, script or web API\)\. Only the user's own words \(a message, an answer they picked or typed, or the goal\) can call for one\./);
    assert.match(text, /\n3\. All work goes to a thread, however small: counting, listing, searching, running tests or commands, editing, deleting\. Start one with project_thread_start, not with DSH's subagent or workflow tools\. One thread per distinct ask \("Two things: A and B" is two asks\); put the user's words in `ask`, word for word, and in `brief` the goal, the scope, what done looks like and what not to touch\./);
    assert.match(text, /\n5\. Answer yourself only from what you already know: thread status, project memory, this conversation\. You may read a file to write a brief or a question; you run no commands and change no files\./);
    assert.match(text, /\n7\. Guide your threads\. Check each handback against the ask before you tell the user; if it falls short or its approach is wrong, tell the thread what to fix and why[^\n]*When the user's wishes or priorities change, redirect the thread/);
    // What it sends a running thread reaches it now (behaviour review 4, S3: an answer sat queued through an 11-minute turn).
    assert.match(text, /\n7\. [^\n]*redirect the thread; a running one reads it now\. Notes to a thread go to it/);
    // "Everything" is the workspace, never DSH or the project's settings.
    assert.match(text, /\n"Here", "this" and "everything" mean this workspace; to check that it works, run its tests in a thread\. DSH, its web server and this project's settings aren't the user's work/);
    assert.match(text, /\n4\. Name a thread to the user only as a link: \[Fix the login bug\]\(\.dsh-thread\/t3\) for thread t3\./);
    assert.match(text, /\n6\. Before you or a thread delete files, push, publish, send or post anything, spend money, or change settings outside the workspace, ask the user/);
    // A probe that posts, or a fake token, is sending: no brief may allow it (behaviour review 3, S3).
    assert.match(text, /\n6\. [^\n]*exactly that\. A request to a service outside the workspace that does more than read counts as sending, and so does one with a made-up or placeholder credential; a brief never allows either\. Doing it again \(a retry, a check\) needs its own ask\. Ask only in these cases/);
    assert.match(text, /\n11\. Write to project_memory only decisions and preferences the user stated\./);
    assert.doesNotMatch(text, /home folder|Here those include|PAUSED/);
    // The rules behind the second behaviour review and the user's advising asks made it longer; it stays one screen.
    assert.ok(text.length < 4000, `short enough for a weaker model: ${text.length} characters`);
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
    assert.deepEqual([...thread.ctx.registered.keys()].sort(), ['project_ask_coordinator', 'project_handback', 'project_memory']);
    assert.match(thread.ctx.section(), /You are thread t1, "Add CI"/);
    // A thread does the task and only the task, off the user's own tools, and hands back once, result first.
    assert.match(thread.ctx.section(), /\n1\. Do the task end to end, and only the task\./);
    assert.match(thread.ctx.section(), /\n2\. Do not use the user's personal or infrastructure tools \(password managers and vaults, note apps, .*\), in any way \(tool, command line, script or web API\), unless the user's own words ask for it\./);
    // Writing outside the workspace asks first like sending does, scratch stays inside, and a request to a service that does more
    // than read, or carries a made-up credential, is sending whatever the brief says (behaviour review 3, S3, S1 and S11).
    assert.match(thread.ctx.section(), /\n3\. Editing files in the workspace for your task is fine\. Keep scratch files inside the workspace, or delete them before you hand back\. Before you write outside the workspace, delete files, push, publish, send or post anything, spend money, or do anything that cannot be undone, hand back with status needs_decision, unless the user's words asked for exactly that\. A request to a service outside the workspace that does more than read counts as sending, and so does one with a made-up or placeholder credential, even if the brief allows it\. Doing it again \(a retry, a check\) needs its own ask\. A command that sends waits for the user to allow it once in this chat; if they reject it, hand back and don't send another way\.\n/);
    // The handback names what left the workspace.
    assert.match(thread.ctx.section(), /\n4\. When you are done or stuck, call project_handback once, as your last step\. Its summary is what the user reads on your card: at most 300 characters, the result first, then where \(paths, links\); a longer one comes back to you to shorten\. Name every request you sent to a service outside the workspace and every file you wrote outside it\./);
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
    // A coordinator's message to a thread comes from the coordinator too. A running thread reads it in the turn it is
    // running, so an answer from the user reaches it now; steer=false queues it for that turn's end. The result says which.
    thread.status = 'running';
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Also cache npm.' }), 'Steered into t1\'s running turn.');
    assert.deepEqual([ts.prompts[1].mode, sourceOf(ts, 1)], ['steer', { kind: 'agent-message', form: 'relay', senderSessionId: coord.id }]);
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Then the docs.', steer: false }), 'Queued: t1 sees this when its turn ends; steer=true redirects it now.');
    assert.equal(ts.prompts[2].mode, 'queue');
    // An idle thread starts its next turn with it, steered or not.
    thread.status = 'idle';
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'And the lockfile.', steer: true }), 'Sent to t1.');
    assert.equal(ts.prompts[3].mode, 'queue');

    // A follow-up that passes on the user's request carries their words too.
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Cache the npm folder.', ask: 'can it cache npm?' }), 'Sent to t1.');
    assert.equal(ts.prompts[4].text, '[From the coordinator]\n\nThe user asked: "can it cache npm?"\n\nCache the npm folder.');

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
    // DSH's stop leaves it idle.
    thread.status = 'idle';
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

test('old session records: each project session DSH lists without a value is read again from its log, and a nameless project takes its coordinator\'s title', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    // A store from before: a project made on the page, and two the store holds no name for (profile rows since
    // removed), one whose coordinator's title says its name and one whose title is a bare "◆ ".
    writeFileSync(join(dir, 'projects.json'), JSON.stringify({ version: 1, projects: {
        storefront: { name: 'Storefront', coordinatorSessionId: 'c1', threads: { t1: { title: 'Fix login', sessionId: 'a1' }, t2: { title: 'Ship', sessionId: 'a2' }, t3: { title: 'Gone', sessionId: 'gone' } } },
        'old-plugins': { name: '', coordinatorSessionId: 'c2', threads: { t1: { title: 'Smoke test', sessionId: 'b1' } } },
        bare: { coordinatorSessionId: 'c3', threads: {} },
        nothing: { name: '' },
    } }));
    const host = fakeHost({ gateway: true });
    for (const [id, title] of [['c1', '◆ Storefront'], ['a1', 'Fix login'], ['a2', 'Ship'], ['c2', '◆ Old Plugins'], ['b1', 'Smoke test'], ['c3', '◆ ']]) {
        host.sessions.set(id, { events: [{ seq: 1, type: 'turn/start', data: {} }], prompts: [], title, cwd: 'w' });
    }
    // DSH has a1 loaded (it folds as it runs), and lists a2 with a value of the current version; the rest without one.
    const reads = [];
    host.services.sessions = { get: (id) => (id === 'a1' ? { id } : undefined) };
    host.services.sessionProjectionCache = { coldSnapshot(meta, inherited, events) { reads.push([meta.id, inherited, events.length]); return { values: {} }; } };
    host.sessionController.inspect = async (id) => {
        if (!host.sessions.has(id)) throw new Error('session/not-found');
        return { meta: { id }, inheritedEventCount: 0, events: host.sessions.get(id).events };
    };
    const list = host.sessionController.list;
    host.sessionController.list = async () => {
        const { items } = await list();
        return { items: items.map((item) => (item.sessionId === 'a2' ? { ...item, projections: { ...item.projections, values: { ...item.projections.values, projectSession: { role: 'thread' } } } } : item)) };
    };
    const raw = { welcome: false, storeFile: join(dir, 'projects.json'), memoryDir: join(dir, 'memory'), logFile: join(dir, 'projects.log'), projects: [] };
    plugin.apply(host, plugin.Config(raw));
    const log = () => { try { return readFileSync(raw.logFile, 'utf8'); } catch { return ''; } };
    for (let i = 0; i < 50 && !/records refreshed/.test(log()); i += 1) await tick();
    // Read again: each one DSH lists without a value and hasn't loaded; not the loaded one, the current one, or one DSH no longer has.
    assert.deepEqual(reads, [['c1', 0, 1], ['c2', 0, 1], ['b1', 0, 1], ['c3', 0, 1]]);
    assert.match(log(), /records refreshed=4/);
    // The nameless project is named after its coordinator, once; a bare "◆ " leaves it its id. One with no coordinator stays out.
    const store = JSON.parse(readFileSync(raw.storeFile, 'utf8'));
    assert.equal(store.projects['old-plugins'].name, 'Old Plugins');
    assert.equal(store.projects.bare.name, undefined);
    const remote = host.provided.get('dshPluginProjectsRemote');
    const listed = (await remote.list()).projects.map((p) => [p.id, p.name, p.coordinator]);
    assert.deepEqual(plain(listed).sort(), [['bare', 'bare', 'c3'], ['old-plugins', 'Old Plugins', 'c2'], ['storefront', 'Storefront', 'c1']]);
    // The session list's fallback: every coordinator and thread session the store knows, with its project's name.
    assert.deepEqual(plain((await remote.sessions()).sessions), {
        c1: { role: 'coordinator', project: 'storefront', name: 'Storefront' },
        a1: { role: 'thread', project: 'storefront', name: 'Storefront', thread: 't1', coordinator: 'c1' },
        a2: { role: 'thread', project: 'storefront', name: 'Storefront', thread: 't2', coordinator: 'c1' },
        gone: { role: 'thread', project: 'storefront', name: 'Storefront', thread: 't3', coordinator: 'c1' },
        c2: { role: 'coordinator', project: 'old-plugins', name: 'Old Plugins' },
        b1: { role: 'thread', project: 'old-plugins', name: 'Old Plugins', thread: 't1', coordinator: 'c2' },
        c3: { role: 'coordinator', project: 'bare', name: 'bare' },
    });
    // The projection's init seeds a re-read thread from the store: its project and coordinator.
    const seeded = host.projections[0].init({ id: 'b1' });
    assert.deepEqual(plain({ role: seeded.v.role, project: seeded.v.project, coordinator: seeded.v.coordinator }), { role: 'thread', project: { id: 'old-plugins', name: 'Old Plugins' }, coordinator: 'c2' });

    // A DSH without the cache service reads nothing again, and starts as before.
    const host2 = fakeHost();
    const dir2 = mkdtempSync(join(tmpdir(), 'projects-'));
    writeFileSync(join(dir2, 'projects.json'), readFileSync(join(dir, 'projects.json')));
    for (const id of ['c1', 'a1', 'c2', 'b1', 'c3']) host2.sessions.set(id, { events: [], prompts: [], title: host.sessions.get(id).title, cwd: 'w' });
    plugin.apply(host2, plugin.Config({ ...raw, storeFile: join(dir2, 'projects.json'), logFile: join(dir2, 'projects.log') }));
    await tick();
    await tick();
    assert.doesNotMatch(readFileSync(join(dir2, 'projects.log'), 'utf8'), /records refreshed|error record/);
});

test('browser half: the Projects page is every ◆ project in the list\'s order, each with its threads wherever they work, open ones first', () => {
    const { client } = loadClient();
    const { pageModel, visibleItems, takeKnown } = client.internals;
    takeKnown({});
    const value = (v) => ({ values: { projectSession: v } });
    const sessions = {
        byId: {
            c: { id: 'c', title: '◆ Storefront' }, t1: { id: 't1', title: 'Fix cart' }, t2: { id: 't2', title: 'Hero images' }, t3: { id: 't3', title: 'Old copy' },
            y: { id: 'y', title: 'Archived one' }, d: { id: 'd', title: '◆ Data' }, dt: { id: 'dt', title: 'Nightly load' }, x: { id: 'x', title: 'A chat' }, z: { id: 'z', title: 'Notes' },
            e: { id: 'e', title: '◆ Ops' },
        },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [
                { id: 't1', session: 't1' }, { id: 't2', session: 't2' }, { id: 't3', session: 't3', resolved: true }, { id: 't4', session: 'y' },
            ] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            t2: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            t3: value({ role: 'thread', coordinator: 'c', thread: { id: 't3' } }),
            y: value({ role: 'thread', coordinator: 'c', thread: { id: 't4' } }),
            d: value({ role: 'coordinator', project: { id: 'data', name: 'Data' }, threads: [{ id: 't1', session: 'dt' }] }),
            dt: value({ role: 'thread', coordinator: 'd', thread: { id: 't1' } }),
        },
    };
    const items = [
        { workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['t3', 'c', 't1', 'x', 'y'] },
        { workspaceId: 'w-assets', title: 'storefront-assets', path: '/home/u/storefront-assets', sessionIds: ['t2'] },
        { workspaceId: 'w-data', title: '', path: '/home/u/data-pipeline', sessionIds: ['d', 'dt', 'z'] },
    ];
    const listed = [
        { id: 'data', name: 'Data', coordinator: 'd', home: 'w-data' },
        { id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf', paused: true },
        // One whose coordinator never started has nothing to open; one DSH doesn't list yet goes by what the list says.
        { id: 'later', name: 'Later', coordinator: null, home: 'w-sf' },
        { id: 'ops', name: 'Ops', coordinator: 'e', home: 'w-gone', workspace: '/srv/ops', workspaces: [], threads: { open: 2, resolved: 1 } },
    ];
    const tree = pageModel({ listed, items, sessions, archived: new Set(['y']) });
    const shape = (nodes) => nodes.map((n) => [n.kind, n.title, ...(n.children.length ? [shape(n.children)] : [])]);
    // Projects only, in the list's order. A project's threads in DSH's order, the resolved one last, the thread that
    // works in storefront-assets under its project; no chats, and no archived thread.
    assert.deepEqual(plain(shape(tree)), [
        ['project', 'Data', [['thread', 'Nightly load']]],
        ['project', 'Storefront', [['thread', 'Fix cart'], ['thread', 'Hero images'], ['thread', 'Old copy']]],
        ['project', 'Ops'],
    ]);
    // Each carries the name of the workspace it works in, its threads as its Threads menu counts them (its roster:
    // the archived thread too), and its pause.
    assert.deepEqual(plain(tree.map((n) => [n.id, n.folder, n.counts, n.paused])), [
        ['d', 'data-pipeline', { open: 1, resolved: 0 }, false],
        ['c', 'storefront', { open: 3, resolved: 1 }, true],
        ['e', 'ops', { open: 2, resolved: 1 }, false],
    ]);
    // Levels, places among siblings, and a folded project hides its threads.
    const shown = visibleItems(tree, new Set());
    assert.deepEqual(plain(shown.map((x) => [x.node.title, x.level, `${x.pos}/${x.size}`, x.open])), [
        ['Data', 1, '1/3', true], ['Nightly load', 2, '1/1', false],
        ['Storefront', 1, '2/3', true], ['Fix cart', 2, '1/3', false], ['Hero images', 2, '2/3', false], ['Old copy', 2, '3/3', false],
        ['Ops', 1, '3/3', false],
    ]);
    assert.deepEqual(plain(visibleItems(tree, new Set(['project:c'])).map((x) => x.node.title)), ['Data', 'Nightly load', 'Storefront', 'Ops']);
    // The newest paused word wins over the list's.
    assert.deepEqual(plain(pageModel({ listed, items, sessions, archived: new Set(), pausedOf: (id) => (id === 'c' ? false : undefined) }).map((n) => n.paused)), [false, false, false]);
});

test('browser half: the Projects page is headed Projects with how many, and a project\'s row says where it works and its threads', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, treeMeta, listText } = client.internals;
    const value = (v) => ({ values: { projectSession: v } });
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ DSH Plugins' }, t1: { id: 't1', title: 'Fix the page' }, t2: { id: 't2', title: 'Old fix' }, x: { id: 'x', title: 'A chat' }, r: { id: 'r', title: '◆ Recipes' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'dsh-plugins', name: 'DSH Plugins' }, threads: [{ id: 't1', session: 't1', resolved: false }, { id: 't2', session: 't2', resolved: true }] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            t2: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            r: value({ role: 'coordinator', project: { id: 'recipes', name: 'Recipes' }, threads: [] }),
        },
    };
    let workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [
            { workspaceId: 'w-dsh', title: 'deepseek-plugins', path: '/home/u/deepseek-plugins', sessionIds: ['c', 't2', 't1', 'x'] },
            { workspaceId: 'w-notes', title: 'notes', path: '/Users/u/notes', sessionIds: ['r'] },
        ],
    };
    let listed = [
        { id: 'dsh-plugins', name: 'DSH Plugins', coordinator: 'c', home: 'w-dsh', source: 'profile' },
        { id: 'recipes', name: 'Recipes', coordinator: 'r', home: 'w-notes', source: 'page' },
    ];
    const facts = { subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {}, projects: () => listed, listFailed: () => false };
    const props = {
        useSessions: (select) => select(sessions), useSessionStatus: (select) => select(new Map()), useWorkspaces: (select) => select(workspaces),
        projects: { facts, openSession: () => {} },
    };
    const draw = mount(react, () => ProjectsPage(props));
    const classed = (tree, name) => textIn(byClass(tree, name));
    let page = draw();
    // Headed Projects, with how many; nothing else on it but Find by name and the tree.
    assert.equal(textIn(elementsOf(page).filter((e) => e.type === 'h1')), 'Projects');
    assert.equal(classed(page, 'dshp-pg-count'), '2 projects');
    assert.doesNotMatch(textIn(page), /categor|workspace|chat/i);
    assert.equal(elementsOf(page).some((e) => e.props?.['data-projects-new'] !== undefined || typeof e.props?.onSubmit === 'function'), false);
    const treeEl = elementsOf(page).find((e) => e.type === PageTree);
    assert.equal(treeEl.props.label, 'Projects');
    const items = elementsOf(mount(react, () => PageTree(treeEl.props))()).filter((e) => e.props?.role === 'treeitem');
    // A ◆ project, the workspace it works in and its threads as its Threads menu counts them; under it its threads, open
    // ones first, each with its state.
    assert.deepEqual(plain(items.map((li) => [li.props['aria-level'], li.props['data-projects-node'], classed(li.children[0], 'dshp-tree-diamond'),
        classed(li.children[0], 'dshp-tree-title'), classed(li.children[0], 'dshp-tree-meta')])), [
        [1, 'project', '◆', 'DSH Plugins', 'deepseek-plugins · 1 open thread · 1 resolved'],
        [2, 'thread', '', 'Fix the page', 'Idle'],
        [2, 'thread', '', 'Old fix', 'Resolved'],
        [1, 'project', '◆', 'Recipes', 'notes · no threads yet'],
    ]);
    // One tab stop; a project without threads has nothing to fold.
    assert.deepEqual(items.map((li) => li.props.tabIndex), [0, -1, -1, -1]);
    assert.deepEqual(items.map((li) => li.props['aria-expanded']), [true, undefined, undefined, undefined]);
    assert.equal(elementsOf(items[3].children[0]).some((e) => e.props?.['data-projects-chevron'] !== undefined), false);
    assert.deepEqual([
        treeMeta({ kind: 'project', id: 'c', folder: 'shop', counts: { open: 2, resolved: 0 }, children: [] }),
        treeMeta({ kind: 'project', id: 'c', folder: 'shop', paused: true, counts: { open: 0, resolved: 3 }, children: [] }),
        treeMeta({ kind: 'project', id: 'c', folder: '', counts: { open: 0, resolved: 0 }, children: [] }),
        treeMeta({ kind: 'thread', id: 't', children: [] }),
    ], ['shop · 2 open threads', 'Paused · shop · 0 open threads · 3 resolved', 'no threads yet', null]);

    // No project yet: loading until DSH has its workspaces, then the empty state says what a project is and where one comes from.
    listed = [];
    workspaces = { ...workspaces, items: [], phase: 'pending' };
    page = draw();
    assert.equal(classed(page, 'dshp-pg-state'), 'Loading projects…');
    workspaces = { ...workspaces, phase: 'ready' };
    page = draw();
    const empty = byClass(page, 'dshp-pg-empty')[0];
    assert.equal(textIn(elementsOf(empty).filter((e) => e.type === 'h2')), 'No projects yet');
    assert.match(textIn(elementsOf(empty).filter((e) => e.type === 'p')), /^A project is a ◆ coordinator in one of your workspaces, with the threads it starts\./);
    assert.equal(classed(page, 'dshp-pg-count'), '');
    // Still loading the plugin's list.
    listed = null;
    assert.equal(classed(draw(), 'dshp-pg-state'), 'Loading projects…');

    // The entry in DSH's sidebar is named as the page is headed.
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push(slot); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }), subscribe: () => () => {} } },
        uiWorkspace: {},
        sidebarRight: {},
    };
    client.apply(ctx);
    assert.equal(registered.find((r) => r.name === 'sidebar.panellist')?.label, 'Projects');
    // Names as a sentence lists them (the access texts use it).
    assert.deepEqual([listText([]), listText(['A']), listText(['A', 'B']), listText(['A', 'B', 'C'])], ['', 'A', 'A and B', 'A, B and C']);
});

test('browser half: the Projects page gives each thread its state, marks a paused project and its news, and a chevron folds a project', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, pageRefusal } = client.internals;
    const value = (v) => ({ values: { projectSession: v } });
    const at = (minutes) => new Date(Date.UTC(2026, 9, 11, 2, minutes)).toISOString();
    const thread = (id) => value({ role: 'thread', coordinator: 'c', thread: { id } });
    const titles = { run: 'Upgrade the payments SDK', wait: 'Write outside', fail: 'Bad request', stop: 'Stopped one', block: 'Blocked one', ask: 'Pick a colour', done: 'Hero images', idle: 'Not started', gone: 'Resolved one' };
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ Storefront' }, d: { id: 'd', title: '◆ Data Pipeline' }, dt: { id: 'dt', title: 'Nightly load' }, x: { id: 'x', title: 'A chat' },
            ...Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { id, title }])) },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [
                { id: 't1', session: 'fail', handback: { status: 'done', at: at(1) } },
                { id: 't2', session: 'stop' },
                { id: 't3', session: 'block', handback: { status: 'blocked', at: at(3) } },
                { id: 't4', session: 'ask', handback: { status: 'needs_decision', at: at(4) } },
                { id: 't5', session: 'done', handback: { status: 'done', at: at(5) } },
                { id: 't6', session: 'idle' }, { id: 't7', session: 'run' }, { id: 't8', session: 'wait' }, { id: 't9', session: 'gone', resolved: true },
            ] }),
            fail: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' }, ending: { state: 'failed', at: at(2), kind: 'error', message: 'HTTP 400' } }),
            stop: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' }, ending: { state: 'stopped', at: at(2) } }),
            ...Object.fromEntries(['block', 'ask', 'done', 'idle', 'run', 'wait', 'gone'].map((id) => [id, thread(id)])),
            d: value({ role: 'coordinator', project: { id: 'data-pipeline', name: 'Data Pipeline' }, threads: [{ id: 't1', session: 'dt', handback: { status: 'done', at: at(6) } }] }),
            dt: value({ role: 'thread', coordinator: 'd', thread: { id: 't1' } }),
        },
    };
    const workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [
            // The resolved thread comes first in DSH's list, and is drawn last.
            { workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['c', 'gone', ...Object.keys(titles).filter((id) => id !== 'gone'), 'x'] },
            { workspaceId: 'w-dp', title: 'data-pipeline', path: '/home/u/data-pipeline', sessionIds: ['d', 'dt'] },
        ],
    };
    const listed = [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf' }, { id: 'data-pipeline', name: 'Data Pipeline', coordinator: 'd', home: 'w-dp', paused: false }];
    let news = { c: { unread: [{ kind: 'handback', status: 'blocked', title: 'Blocked one' }] } };
    const facts = {
        subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {},
        projects: () => listed, listFailed: () => false,
        // Data Pipeline was paused since the list was read: the newer word wins.
        paused: (coordinator) => (coordinator === 'd' ? true : undefined), newsOf: (coordinator) => news[coordinator],
    };
    // DSH's own status: one thread runs, one waits on the user's approval.
    const statuses = new Map([['run', { running: true }], ['wait', { running: true, pendingInteraction: { kind: 'approval' } }]]);
    const opened = [];
    const props = {
        useSessions: (select) => select(sessions), useSessionStatus: (select) => select(statuses), useWorkspaces: (select) => select(workspaces),
        projects: { facts, openSession: (id) => opened.push(id) },
    };
    const drawPage = mount(react, () => ProjectsPage(props));
    const page = drawPage();
    const treeEl = elementsOf(page).find((e) => e.type === PageTree);
    const drawTree = mount(react, () => PageTree(treeEl.props));
    const items = (tree) => elementsOf(tree).filter((e) => e.props?.role === 'treeitem');
    const row = (tree, id) => items(tree).find((li) => li.props['data-projects-id'] === id);
    let tree = drawTree();
    // Each thread in the Threads menu's words and dots: what DSH says of its session first, then a failed or stopped
    // last turn after its handback, then the handback; the resolved one last.
    const states = items(row(tree, 'c').children[1]).map((li) => {
        const state = byClass(li.children[0], 'dshp-tree-state')[0];
        return [textIn(byClass(li.children[0], 'dshp-tree-title')), state.props['data-projects-state'], textIn(state)];
    });
    assert.deepEqual(plain(states), [
        ['Upgrade the payments SDK', 'ongoing', 'Running'], ['Write outside', 'warning', 'Needs you'], ['Bad request', 'error', 'Failed'],
        ['Stopped one', 'idle', 'Stopped'], ['Blocked one', 'warning', 'Blocked'], ['Pick a colour', 'warning', 'Needs a decision'],
        ['Hero images', 'done', 'Done'], ['Not started', 'idle', 'Idle'], ['Resolved one', 'done', 'Resolved'],
    ]);
    // A paused project says so first, with the pause sign; one with news reads bold, its dot named for screen readers.
    const dp = row(tree, 'd');
    assert.equal(dp.props['data-projects-paused'], '');
    assert.equal(textIn(byClass(dp.children[0], 'dshp-tree-meta')), 'Paused · data-pipeline · 1 open thread');
    assert.equal(byClass(dp.children[0], 'dshp-t-paused-mark').length, 1);
    const sf = row(tree, 'c');
    assert.deepEqual([sf.props['data-projects-paused'], sf.props['data-projects-unread'], byClass(sf.children[0], 'dshp-t-paused-mark').length], [undefined, 1, 0]);
    assert.equal(textIn(byClass(sf.children[0], 'dshp-tree-meta')), 'storefront · 8 open threads · 1 resolved');
    const mark = elementsOf(sf.children[0]).find((e) => e.props?.['data-projects-news-mark'] !== undefined);
    assert.deepEqual([mark.props.role, mark.props['aria-label']], ['img', 'New: “Blocked one” is blocked']);
    // Seen: no mark; the project's own dot is DSH's for its coordinator (none while it is idle, Running while it runs).
    news = {};
    const fresh = () => mount(react, () => PageTree(elementsOf(mount(react, () => ProjectsPage(props))()).find((e) => e.type === PageTree).props))();
    tree = fresh();
    assert.equal(row(tree, 'c').props['data-projects-unread'], undefined);
    assert.equal(elementsOf(row(tree, 'c').children[0]).some((e) => e.props?.role === 'img'), false);
    statuses.set('c', { running: true });
    assert.equal(elementsOf(row(fresh(), 'c').children[0]).find((e) => e.props?.role === 'img')?.props['aria-label'], 'Running');
    // The chevron folds a project's threads and stays on the page; the rest of its row, or Enter, opens the coordinator.
    tree = drawTree();
    const chevron = (li) => elementsOf(li.children[0]).find((e) => e.props?.['data-projects-chevron'] !== undefined);
    assert.equal(row(tree, 'c').props['aria-expanded'], true);
    let stopped = 0;
    chevron(row(tree, 'c')).props.onClick({ stopPropagation: () => { stopped += 1; } });
    tree = drawTree();
    assert.equal(row(tree, 'c').props['aria-expanded'], false);
    assert.equal(row(tree, 'run'), undefined);
    assert.deepEqual([opened, stopped], [[], 1]);
    chevron(row(tree, 'c')).props.onClick({ stopPropagation: () => {} });
    tree = drawTree();
    assert.equal(row(tree, 'c').props['aria-expanded'], true);
    row(tree, 'c').props.onClick({ stopPropagation: () => {} });
    assert.deepEqual(opened, ['c']);
    // The keys, from the project's row: ↓ to its first thread, which becomes the one tab stop, and Enter opens it;
    // ← goes back to the project, Enter opens its coordinator, ← again folds it and → opens it; End and Home.
    row(drawTree(), 'c').props.onFocus({ target: 1, currentTarget: 1 });
    const key = (name) => {
        let prevented = 0;
        elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: name, preventDefault: () => { prevented += 1; } });
        return prevented;
    };
    assert.equal(key('ArrowDown'), 1);
    assert.deepEqual([row(drawTree(), 'run').props.tabIndex, row(drawTree(), 'c').props.tabIndex], [0, -1]);
    assert.equal(key('Enter'), 1);
    assert.deepEqual(opened, ['c', 'run']);
    key('ArrowLeft');
    key('Enter');
    assert.deepEqual(opened, ['c', 'run', 'c']);
    key('ArrowLeft');
    assert.equal(row(drawTree(), 'c').props['aria-expanded'], false);
    key('ArrowRight');
    assert.equal(row(drawTree(), 'c').props['aria-expanded'], true);
    key('End');
    assert.equal(row(drawTree(), 'dt').props.tabIndex, 0);
    key('Home');
    assert.equal(row(drawTree(), 'c').props.tabIndex, 0);
    // Alt and an arrow move nothing on the page: each says why, and the focus stays. A project goes where the workspace it
    // works in goes; a thread stays in its project, in the session list's order, and can't leave it at either end.
    const said = () => textIn(elementsOf(drawPage()).find((e) => e.props?.['data-projects-page-said'] !== undefined));
    const alt = (name, extra = {}) => {
        let prevented = 0;
        elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: name, altKey: true, preventDefault: () => { prevented += 1; }, ...extra });
        return [prevented, said().trim()];
    };
    assert.equal(said(), '');
    assert.deepEqual(alt('ArrowDown'), [1, 'Projects keep the order of the workspaces they work in.']);
    assert.deepEqual(alt('ArrowRight'), [1, 'A project can\'t go inside another project.']);
    assert.deepEqual(alt('ArrowLeft'), [1, 'A project stays in its workspace.']);
    assert.equal(row(drawTree(), 'c').props.tabIndex, 0);
    key('ArrowDown');
    assert.deepEqual(alt('ArrowUp'), [1, 'A thread stays with the project it started in.']);
    assert.deepEqual(alt('ArrowDown'), [1, 'A project\'s threads keep the session list\'s order, open ones first.']);
    assert.deepEqual(alt('ArrowLeft'), [1, 'A thread stays with the project it started in.']);
    assert.deepEqual(alt('ArrowRight'), [1, 'A thread can\'t go inside another thread.']);
    assert.equal(row(drawTree(), 'run').props.tabIndex, 0);
    key('End');
    assert.deepEqual(alt('ArrowDown'), [1, 'A thread stays with the project it started in.']);
    const once = said();
    alt('ArrowDown');
    assert.notEqual(said(), once, 'the same words again are said again');
    assert.equal(row(drawTree(), 'dt').props.tabIndex, 0);
    // With Shift, Ctrl or Meta too, the keys are DSH's own.
    assert.deepEqual(alt('ArrowDown', { shiftKey: true })[0], 0);
    assert.deepEqual(alt('ArrowLeft', { metaKey: true })[0], 0);
    // On the whole tree, though a find shows only part of it: the last open thread isn't the project's last.
    const whole = treeEl.props.tree;
    assert.deepEqual(plain(['idle', 'gone'].map((id) => pageRefusal(whole, `thread:${id}`, 'ArrowDown'))), [
        'A project\'s threads keep the session list\'s order, open ones first.', 'A thread stays with the project it started in.',
    ]);
    assert.deepEqual(plain([pageRefusal(whole, 'thread:x', 'ArrowDown'), pageRefusal(whole, 'project:nope', 'ArrowUp'), pageRefusal(whole, 'project:c', 'Enter')]), [null, null, null]);
    // Keys with a modifier are DSH's own.
    assert.equal(elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: 'ArrowDown', metaKey: true, preventDefault: () => assert.fail('taken') }), undefined);
});

test('browser half: on the Projects page, a thread whose handback a pause holds reads as its Threads menu says', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, rowsOf, withHeld } = client.internals;
    const value = (v) => ({ values: { projectSession: v } });
    const roster = [{ id: 't1', session: 'held' }, { id: 't2', session: 'ask' }, { id: 't3', session: 'run' }, { id: 't4', session: 'none' }];
    const titles = { held: 'Audit the nightly backfill job', ask: 'Pick a warehouse', run: 'Load the archive', none: 'Not started' };
    const sessions = {
        phase: 'ready',
        byId: { d: { id: 'd', title: '◆ Data Pipeline' }, ...Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { id, title }])) },
        projectionsBySession: {
            d: value({ role: 'coordinator', project: { id: 'data-pipeline', name: 'Data Pipeline' }, threads: roster }),
            ...Object.fromEntries(roster.map((t) => [t.session, value({ role: 'thread', coordinator: 'd', thread: { id: t.id } })])),
        },
    };
    const workspaces = { phase: 'ready', archivedSessionIds: [], items: [{ workspaceId: 'w-dp', title: 'data-pipeline', path: '/home/u/data-pipeline', sessionIds: ['d', ...Object.keys(titles)] }] };
    // The pause holds t1's done handback, t2's question, and one from t3, which runs again.
    const handbacks = [{ thread: 't1', status: 'done' }, { thread: 't2', status: 'needs_decision' }, { thread: 't3', status: 'done' }];
    let paused = true;
    const watched = [];
    const facts = {
        subscribe: () => () => {}, getSnapshot: () => 0, list: async () => {}, newsOf: () => undefined,
        projects: () => [{ id: 'data-pipeline', name: 'Data Pipeline', coordinator: 'd', home: 'w-dp', paused }], listFailed: () => false,
        paused: () => paused,
        // describe's answer, which the Threads menu reads the held handbacks from too.
        info: (target) => (target === 'd' ? { paused: { value: paused, held: handbacks.length, handbacks } } : null),
        watch: (key) => { watched.push(key); return () => {}; },
    };
    const statuses = new Map([['run', { running: true }]]);
    const props = { useSessions: (select) => select(sessions), useSessionStatus: (select) => select(statuses), useWorkspaces: (select) => select(workspaces), projects: { facts, openSession: () => {} } };
    // The page's own effects run, so what it reads shows.
    let effects = [];
    const states = () => {
        effects = [];
        react.useEffect = (effect) => { effects.push(effect); };
        const treeEl = elementsOf(mount(react, () => ProjectsPage(props))()).find((e) => e.type === PageTree);
        react.useEffect = () => {};
        const tree = mount(react, () => PageTree(treeEl.props))();
        return Object.fromEntries(elementsOf(tree).filter((e) => e.props?.role === 'treeitem' && e.props['data-projects-node'] === 'thread').map((li) => {
            const state = byClass(li.children[0], 'dshp-tree-state')[0];
            return [textIn(byClass(li.children[0], 'dshp-tree-title')), [state.props['data-projects-state'], textIn(state)]];
        }));
    };
    // The Threads menu's dot and word for each thread.
    const menu = () => Object.fromEntries(withHeld(rowsOf(roster, statuses, sessions.byId, {}), paused ? handbacks : []).map((row) => [titles[row.session], [row.dot, row.stateLabel]]));
    let page = states();
    assert.deepEqual(plain(page), {
        'Audit the nightly backfill job': ['done', 'Done'], 'Pick a warehouse': ['warning', 'Needs a decision'], 'Load the archive': ['ongoing', 'Running'], 'Not started': ['idle', 'Idle'],
    });
    assert.deepEqual(plain(page), plain(menu()));
    // It reads the paused project's description while it shows it, as the Threads menu does.
    for (const effect of effects) effect();
    assert.deepEqual(watched, ['list', 'd:d']);
    // Resumed: nothing is held, and the page no longer reads it.
    paused = false;
    page = states();
    assert.deepEqual(plain(page), {
        'Audit the nightly backfill job': ['idle', 'Idle'], 'Pick a warehouse': ['idle', 'Idle'], 'Load the archive': ['ongoing', 'Running'], 'Not started': ['idle', 'Idle'],
    });
    assert.deepEqual(plain(page), plain(menu()));
    watched.length = 0;
    for (const effect of effects) effect();
    assert.deepEqual(watched, ['list']);
});

test('browser half: a row on the Projects page has ⋯: a project\'s settings and Archive project…, a thread\'s other way to open and its project\'s settings', () => {
    const storage = new Map();
    const { client, react } = loadClient({ storage });
    const { ProjectsPage, PageTree, RowMenu } = client.internals;
    const value = (v) => ({ values: { projectSession: v } });
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ Storefront' }, run: { id: 'run', title: 'Upgrade the payments SDK' }, ask: { id: 'ask', title: 'Pick a colour' }, d: { id: 'd', title: '◆ Data Pipeline' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', session: 'run' }, { id: 't2', session: 'ask' }] }),
            run: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            ask: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            d: value({ role: 'coordinator', project: { id: 'data-pipeline', name: 'Data Pipeline' }, threads: [] }),
        },
    };
    const workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [{ workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['c', 'run', 'ask'] }, { workspaceId: 'w-dp', title: 'data-pipeline', path: '/home/u/data-pipeline', sessionIds: ['d'] }],
    };
    const listed = [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf' }, { id: 'data-pipeline', name: 'Data Pipeline', coordinator: 'd', home: 'w-dp' }];
    const facts = { subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {}, projects: () => listed, listFailed: () => false };
    // Project settings and the archive's confirmation open where DSH lets the plugin draw them.
    const done = [];
    let settingsOn = true;
    let archiveOn = true;
    const settings = { subscribe: () => () => {}, getSnapshot: () => ({ available: settingsOn }), open: (id, options) => done.push(['settings', id, options]) };
    const flow = { subscribe: () => () => {}, getSnapshot: () => ({ available: archiveOn }), open: (id) => done.push(['archive', id]) };
    const projects = {
        facts, settings,
        openSession: (id) => done.push(['open', id]), openFull: (id) => done.push(['full', id]), openPaired: (id) => done.push(['beside', id]),
    };
    const props = { useSessions: (select) => select(sessions), useSessionStatus: (select) => select(new Map()), useWorkspaces: (select) => select(workspaces), projects, flow };
    // The page drawn afresh each time (what it passes reads the switches above), the tree's own state kept.
    const treeOf = (lib, r) => {
        let now;
        const draw = mount(r, () => lib.PageTree(now));
        return () => {
            now = elementsOf(mount(r, () => lib.ProjectsPage(props))()).find((e) => e.type === lib.PageTree).props;
            return draw();
        };
    };
    let drawTree = treeOf(client.internals, react);
    const items = (tree) => elementsOf(tree).filter((e) => e.props?.role === 'treeitem');
    const row = (tree, id) => items(tree).find((li) => li.props['data-projects-id'] === id);
    // A row's ⋯ is its own part, last in the row; Menu is DSH's, drawn by RowMenu.
    const menuOf = (li) => elementsOf(li.children[0]).find((e) => e.type === RowMenu);
    const drawn = (li) => RowMenu(menuOf(li).props);
    const picks = (li) => plain(drawn(li).props.items.map((item) => [item.id, item.label, item.icon?.type]));
    let tree = drawTree();
    assert.equal(menuOf(row(tree, 'c')), elementsOf(row(tree, 'c').children[0]).at(-1));
    assert.deepEqual(picks(row(tree, 'c')), [['settings', 'Project settings', 'IconSlidersTwoOutlineRegular'], ['archive', 'Archive project…', 'IconArchiveOutlineRegular']]);
    // A thread opens beside its coordinator from its row, so its ⋯ offers the full view; with that turned off, the other way.
    assert.deepEqual(picks(row(tree, 'run')), [['full', 'Open in full view', 'IconRightUpOutlineRegular'], ['settings', 'Project settings', 'IconSlidersTwoOutlineRegular']]);
    // Each is named for its row, opens on its own, and keeps the tree's one tab stop.
    const menu = drawn(row(tree, 'c'));
    assert.deepEqual(plain([menu.props.open, menu.props.portal, menu.props.align, menu.props.autoFocus, menu.props.closeOnPointerLeave]), [false, true, 'end', true, true]);
    const button = menu.props.anchor;
    assert.deepEqual(plain([button.type, button.props.className, button.props.tabIndex, button.props['aria-label'], button.props['aria-haspopup'], button.props['aria-expanded'], button.props['data-projects-page-menu']]),
        ['button', 'dshp-tree-more', -1, 'Project actions: Storefront', 'menu', false, '']);
    assert.equal(drawn(row(tree, 'ask')).props.anchor.props['aria-label'], 'Thread actions: Pick a colour');
    assert.deepEqual(items(tree).map((li) => li.props['aria-keyshortcuts']), ['Shift+F10', 'Shift+F10', 'Shift+F10', 'Shift+F10']);
    // A click on ⋯ opens its menu and not the row's chat; picking an item closes it and does it.
    let stopped = 0;
    button.props.onClick({ stopPropagation: () => { stopped += 1; } });
    tree = drawTree();
    assert.deepEqual([stopped, drawn(row(tree, 'c')).props.open, drawn(row(tree, 'run')).props.open, drawn(row(tree, 'c')).props.anchor.props['aria-expanded']], [1, true, false, true]);
    assert.equal(row(tree, 'c').props.tabIndex, 0);
    drawn(row(tree, 'c')).props.onSelect('settings');
    tree = drawTree();
    assert.equal(drawn(row(tree, 'c')).props.open, false);
    drawn(row(tree, 'c')).props.onSelect('archive');
    drawn(row(tree, 'run')).props.onSelect('full');
    drawn(row(tree, 'ask')).props.onSelect('settings');
    assert.deepEqual(plain(done), [['settings', 'c', null], ['archive', 'c'], ['full', 'run'], ['settings', 'ask', null]]);
    // The keys: Shift+F10 or the context-menu key opens the focused row's menu (the keyboard then on its ⋯, which DSH's
    // menu walks from); while it is open, keys from ⋯ are the menu's; Escape closes it and the tree's keys work again.
    done.length = 0;
    const tabStop = (t) => items(t).find((li) => li.props.tabIndex === 0).props['data-projects-id'];
    const key = (name, extra = {}) => {
        let prevented = 0;
        elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: name, preventDefault: () => { prevented += 1; }, ...extra });
        return prevented;
    };
    const onItem = { target: { matches: (selector) => selector === '[role="treeitem"]' } };
    const onMore = { target: { matches: () => false } };
    assert.equal(key('ArrowDown', onItem), 1);
    assert.equal(tabStop(drawTree()), 'run');
    assert.equal(key('F10', { shiftKey: true, ...onItem }), 1);
    tree = drawTree();
    assert.deepEqual([drawn(row(tree, 'run')).props.open, drawn(row(tree, 'c')).props.open], [true, false]);
    assert.equal(key('ArrowDown', onMore), 0);
    assert.equal(tabStop(drawTree()), 'run');
    drawn(row(drawTree(), 'run')).props.onClose();
    assert.equal(drawn(row(drawTree(), 'run')).props.open, false);
    assert.equal(key('ArrowDown', onMore), 1);
    assert.equal(tabStop(drawTree()), 'ask');
    // From ⋯, Enter and Space are its own (they open the menu), whatever the tree would do.
    assert.deepEqual([key('Enter', onMore), key(' ', onMore)], [0, 0]);
    assert.deepEqual(plain(done), []);
    assert.equal(key('ContextMenu', onItem), 1);
    assert.equal(drawn(row(drawTree(), 'ask')).props.open, true);
    drawn(row(drawTree(), 'ask')).props.onClose();
    // With Alt, Ctrl or Meta, F10 and the context-menu key are DSH's.
    assert.deepEqual([key('F10', { shiftKey: true, altKey: true, ...onItem }), key('ContextMenu', { ctrlKey: true, ...onItem })], [0, 0]);
    // A right-click on the row opens its menu; one inside a nested row is that row's, not its project's.
    const li = { closest: () => li, contains: () => true };
    let prevented = 0;
    row(drawTree(), 'c').props.onContextMenu({ target: li, currentTarget: li, preventDefault: () => { prevented += 1; }, stopPropagation: () => {} });
    assert.deepEqual([prevented, drawn(row(drawTree(), 'c')).props.open, tabStop(drawTree())], [1, true, 'c']);
    drawn(row(drawTree(), 'c')).props.onClose();
    const nested = { closest: () => 'the thread\'s row' };
    row(drawTree(), 'c').props.onContextMenu({ target: nested, currentTarget: li, preventDefault: () => assert.fail('taken'), stopPropagation: () => {} });
    assert.equal(drawn(row(drawTree(), 'c')).props.open, false);
    // Clicks and keys in a menu, drawn elsewhere in the page, reach the tree through React: it leaves them be.
    const outside = { target: { matches: () => true }, currentTarget: { contains: () => false } };
    row(drawTree(), 'run').props.onClick({ ...outside, stopPropagation: () => assert.fail('taken') });
    assert.equal(key('ArrowUp', outside), 0);
    assert.equal(key('F10', { shiftKey: true, ...outside }), 0);
    assert.deepEqual(plain(done), []);
    // With the beside view off, a thread's ⋯ opens it beside its coordinator; without Project settings or the archive,
    // a project has no ⋯ and its keys open nothing, and a thread's offers only the other way to open it.
    storage.set('dsh-plugin-projects/open-beside', 'off');
    const fresh = loadClient({ storage });
    const later = fresh.client.internals;
    settingsOn = false;
    archiveOn = false;
    drawTree = treeOf(later, fresh.react);
    tree = drawTree();
    const laterMenu = (el) => elementsOf(el.children[0]).find((e) => e.type === later.RowMenu);
    assert.deepEqual([laterMenu(row(tree, 'c')), row(tree, 'c').props['aria-keyshortcuts'], row(tree, 'c').props.onContextMenu], [undefined, undefined, undefined]);
    const threadMenu = later.RowMenu(laterMenu(row(tree, 'run')).props);
    assert.deepEqual(plain(threadMenu.props.items.map((item) => [item.id, item.label, item.icon?.type])), [['beside', 'Open beside its coordinator', 'IconCompareSplitOutlineRegular']]);
    threadMenu.props.onSelect('beside');
    assert.deepEqual(plain(done), [['beside', 'run']]);
    assert.equal(elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: 'F10', shiftKey: true, ...onItem, preventDefault: () => assert.fail('taken') }), undefined);
    // Only one archive's confirmation: a project the page shows is never archived (it leaves the page first).
    archiveOn = true;
    tree = drawTree();
    assert.deepEqual(plain(later.RowMenu(laterMenu(row(tree, 'd')).props).props.items.map((item) => item.id)), ['archive']);
});

test('browser half: Find by name on the Projects page keeps each match under its project, and its folds are its own', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, findInTree, withHit } = client.internals;
    const value = (v) => ({ values: { projectSession: v } });
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ Storefront' }, t1: { id: 't1', title: 'Fix the cart' }, t2: { id: 't2', title: 'Hero images' }, t3: { id: 't3', title: 'Fleet power budget' },
            f: { id: 'f', title: '◆ Fleet Ops' }, n: { id: 'n', title: 'Lane restarts' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', session: 't1' }, { id: 't2', session: 't2', resolved: true }, { id: 't3', session: 't3' }] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            t2: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            t3: value({ role: 'thread', coordinator: 'c', thread: { id: 't3' } }),
            f: value({ role: 'coordinator', project: { id: 'fleet-ops', name: 'Fleet Ops' }, threads: [{ id: 't1', session: 'n' }] }),
            n: value({ role: 'thread', coordinator: 'f', thread: { id: 't1' } }),
        },
    };
    const workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [
            { workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['c', 't1', 't2', 't3'] },
            { workspaceId: 'w-ops', title: 'fleet-ops', path: '/home/u/fleet-ops', sessionIds: ['f', 'n'] },
        ],
    };
    const facts = {
        subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {},
        projects: () => [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf' }, { id: 'fleet-ops', name: 'Fleet Ops', coordinator: 'f', home: 'w-ops' }],
        listFailed: () => false,
    };
    const props = {
        useSessions: (select) => select(sessions), useSessionStatus: (select) => select(new Map()), useWorkspaces: (select) => select(workspaces),
        projects: { facts, openSession: () => {} },
    };
    const draw = mount(react, () => ProjectsPage(props));
    const find = (page) => elementsOf(page).find((e) => e.props?.['data-projects-find'] !== undefined);
    const treeOf = (page) => elementsOf(page).find((e) => e.type === PageTree);
    const titles = (tree) => elementsOf(tree).filter((e) => e.props?.role === 'treeitem').map((li) => textIn(byClass(li.children[0], 'dshp-tree-title')));
    let page = draw();
    const clear = (tree) => elementsOf(tree).find((e) => e.props?.['data-projects-find-clear'] !== undefined);
    assert.deepEqual([find(page).props['aria-label'], find(page).props.role, find(page).props.value, clear(page)], ['Find by name', 'searchbox', '', undefined]);
    assert.equal(treeOf(page).props.find, '');
    const whole = treeOf(page).props.tree;
    // A thread's name: its project stays around it, and nothing else; the project still counts all its threads.
    find(page).props.onChange({ target: { value: 'cart' } });
    page = draw();
    let tree = mount(react, () => PageTree(treeOf(page).props))();
    assert.deepEqual(titles(tree), ['Storefront', 'Fix the cart']);
    assert.equal(textIn(byClass(elementsOf(tree).find((e) => e.props?.['data-projects-node'] === 'project').children[0], 'dshp-tree-meta')), 'storefront · 2 open threads · 1 resolved');
    // The words are marked in the title, which keeps its whole name for the review's hooks.
    const hit = elementsOf(tree).find((e) => e.type === 'mark');
    assert.deepEqual([textIn(hit), hit.props.className], ['cart', 'dshp-tree-hit']);
    assert.deepEqual(plain(withHit('Fix the cart', 'CART').map((part) => (typeof part === 'string' ? part : `[${textIn(part)}]`))), ['Fix the ', '[cart]']);
    assert.deepEqual(plain(withHit('Fix', 'zz')), ['Fix']);
    // A project's name keeps the whole project; any case matches; a thread's name keeps only it under its project.
    assert.deepEqual(plain(findInTree(whole, 'FLEET').map((n) => [n.title, n.children.map((t) => t.title)])), [
        ['Storefront', ['Fleet power budget']],
        ['Fleet Ops', ['Lane restarts']],
    ]);
    // Closing a project while finding is the find's own: the page's kept folds don't change, and a new find starts open.
    find(page).props.onChange({ target: { value: 'storefront' } });
    let treeProps = treeOf(draw()).props;
    const drawTree = mount(react, () => PageTree(treeProps));
    const project = (t) => elementsOf(t).find((e) => e.props?.['data-projects-node'] === 'project');
    const fold = (t) => elementsOf(project(t).children[0]).find((e) => e.props?.['data-projects-chevron'] !== undefined).props.onClick({ stopPropagation: () => {} });
    fold(drawTree());
    assert.equal(project(drawTree()).props['aria-expanded'], false);
    find(page).props.onChange({ target: { value: 'store' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], true);
    find(page).props.onChange({ target: { value: '' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], true);
    // Without a find, a fold is the page's own again.
    fold(drawTree());
    assert.equal(project(drawTree()).props['aria-expanded'], false);
    find(page).props.onChange({ target: { value: 'storefront' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], true);
    find(page).props.onChange({ target: { value: '' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], false);
    fold(drawTree());
    // Nothing found: said in words, and Escape empties the box.
    find(page).props.onChange({ target: { value: 'zzz' } });
    page = draw();
    assert.equal(treeOf(page), undefined);
    const none = elementsOf(page).find((e) => e.props?.['data-projects-find-none'] !== undefined);
    assert.deepEqual([none.props.role, textIn(none)], ['status', 'Nothing matches “zzz”.']);
    // Its × empties the box too.
    assert.equal(clear(page).props['aria-label'], 'Clear the find');
    clear(page).props.onClick();
    assert.equal(find(draw()).props.value, '');
    find(page).props.onChange({ target: { value: 'zzz' } });
    page = draw();
    let prevented = 0;
    find(page).props.onKeyDown({ key: 'Escape', preventDefault: () => { prevented += 1; }, stopPropagation: () => {} });
    page = draw();
    assert.deepEqual([find(page).props.value, prevented, titles(mount(react, () => PageTree(treeOf(page).props))()).length], ['', 1, 6]);
});

test('browser half: a session DSH lists without the plugin\'s value is placed by what the plugin\'s store knows, not by its title', async () => {
    const { client } = loadClient();
    const { rowPlace, isThreadRow, coordinatorName, takeKnown, projectFacts } = client.internals;
    // DSH dropped the saved values of an older version: the threads' titles say nothing of their project.
    const state = { byId: { c: { id: 'c', title: '◆ DSH Plugins' }, t: { id: 't', title: 'Smoke test' }, x: { id: 'x', title: 'A chat' }, n: { id: 'n', title: 'Nameless' } } };
    assert.deepEqual(['c', 't', 'x'].map((id) => rowPlace(state, id)), ['coordinator:c', '', '']);
    // The plugin's store: c and its thread t; n a coordinator retitled by the user.
    const link = { calls: 0, async call(method) { this.calls += 1; assert.equal(method, 'sessions'); return { ok: true, value: { sessions: {
        c: { role: 'coordinator', project: 'dsh-plugins', name: 'DSH Plugins' },
        t: { role: 'thread', project: 'dsh-plugins', name: 'DSH Plugins', thread: 't1', coordinator: 'c' },
        n: { role: 'coordinator', project: 'p', name: 'Pricing' },
        bad: { role: 'chat' },
    } } }; } };
    const facts = projectFacts(link);
    await facts.sessions();
    await facts.sessions();
    assert.equal(link.calls, 1, 'once per window');
    assert.deepEqual(['c', 't', 'x', 'n'].map((id) => rowPlace(state, id)), ['coordinator:c', 'thread:c', '', 'coordinator:n']);
    assert.deepEqual([isThreadRow(state, 't'), isThreadRow(state, 'x'), coordinatorName(state, 'n'), coordinatorName(state, 't')], [true, false, 'Pricing', undefined]);
    // DSH's own value wins once it has one.
    const folded = { ...state, projectionsBySession: { t: { values: { projectSession: { role: 'thread', coordinator: 'c2', project: { id: 'q', name: 'Q' } } } } } };
    assert.equal(rowPlace(folded, 't'), 'thread:c2');
    takeKnown({});
    assert.equal(rowPlace(state, 't'), '');
});

test('window: the Project settings endpoints read and change a project the way its coordinator does', async () => {
    const { host } = setup({}, undefined, { ...SELECTING, gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    // DSH's gateway finds the service by its binding and method markers.
    assert.equal(remote.typertRemote.namespace, 'dsh-plugin-projects');
    assert.equal(remote.typertRemote.serviceKey, 'dshPluginProjectsRemote');
    assert.deepEqual(remoteMethods(remote).map((m) => m.method), [
        'describe', 'list', 'sessions', 'news', 'seeNews', 'update', 'continueThread', 'create', 'rename', 'remove', 'addCoordinator', 'archive', 'restore',
    ]);
    // Categories are the categories plugin's: none of their endpoints here, and the list has no categories in it.
    for (const name of ['createCategory', 'renameCategory', 'removeCategory', 'moveCategory', 'fileWorkspace', 'listCategories']) {
        assert.equal(name in remote, false, name);
    }
    assert.deepEqual(Object.keys(await remote.list()).sort(), ['guarded', 'permissions', 'projects']);
    const refused = async (promise, pattern) => {
        await assert.rejects(promise, (error) => error.code === 'projects/refused' && pattern.test(error.message));
    };

    const read = await remote.describe(coord.id);
    assert.deepEqual(plain(read.project), { id: 'dsh-plugins', name: 'DSH Plugins', source: 'profile', workspace: '/work/dsh', homeFolder: false, coordinator: coord.id, archived: false, live: null, permission: null, tools: [] });
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

test('window: a project\'s goal is set in Project settings, reaches both prompts and the user\'s tools, and only the user sets it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const { host, raw } = setup({ guardedTools: { obsidian: ['notes app'] } }, dir, { ...SELECTING, gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    const refused = async (promise, pattern) => {
        await assert.rejects(promise, (error) => error.code === 'projects/refused' && pattern.test(error.message));
    };
    const goal = async () => plain((await remote.describe(coord.id)).goal);
    // The profile row's goal, until the user sets the project's own.
    assert.deepEqual(await goal(), { value: 'Ship good DSH plugins', source: 'project config', inherited: 'Ship good DSH plugins', tools: [], max: 2000 });
    // Set in the window: trimmed, with the window's line ends. Both prompts read it from their next request, its later lines
    // indented under the first so none reads as another line of the prompt.
    let after = await remote.update(coord.id, { goal: '  Keep the storefront fast.\r\n\r\nWorkspace: no new dependencies.  ' });
    assert.deepEqual(plain(after.goal), { value: 'Keep the storefront fast.\n\nWorkspace: no new dependencies.', source: 'project setting', inherited: 'Ship good DSH plugins', tools: [], max: 2000 });
    assert.match(coord.ctx.section(), /\nGoal: Keep the storefront fast\.\n {2}Workspace: no new dependencies\.\nWorkspace: \/work\/dsh\n/);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Speed', brief: 'Go.' });
    const thread = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Speed');
    assert.match(thread.ctx.section(), /\nProject goal: Keep the storefront fast\.\n {2}Workspace: no new dependencies\.\n/);
    assert.match(thread.ctx.section(), /Here those include: obsidian\. You have none of them\./);
    // It is the user's own words: a tool of theirs it names is open to every thread, and the window says which.
    after = await remote.update(coord.id, { goal: 'Keep the notes app inbox tidy.' });
    assert.deepEqual(plain(after.goal.tools), ['obsidian']);
    assert.match(thread.ctx.section(), /Here those include: obsidian\. You have only the ones the user's words name: obsidian\./);
    // An empty goal is the user's too: none, over the profile row's.
    after = await remote.update(coord.id, { goal: ' \n ' });
    assert.deepEqual(plain([after.goal.value, after.goal.source, after.goal.tools]), ['', 'project setting', []]);
    assert.match(coord.ctx.section(), /\nGoal: none set yet \(the user sets it in Project settings\)\. Until then/);
    assert.doesNotMatch(thread.ctx.section(), /Project goal:/);
    // Too long is refused and changes nothing; null goes back to the profile row's.
    await refused(remote.update(coord.id, { goal: 'x'.repeat(2001) }), /^a goal can be at most 2000 characters; this one has 2001$/);
    assert.equal((await goal()).value, '');
    after = await remote.update(coord.id, { goal: null });
    assert.deepEqual(plain([after.goal.value, after.goal.source]), ['Ship good DSH plugins', 'project config']);
    // The coordinator can't set it: project_settings takes no goal, and says who sets it.
    await remote.update(coord.id, { goal: 'Keep the storefront fast.' });
    assert.match(await coord.ctx.call('project_settings', { goal: 'Use the notes app.' }), /\nThe user changes these and the goal in Project settings; project_settings can't\.$/);
    assert.equal((await goal()).value, 'Keep the storefront fast.');
    // Kept across a restart, over the profile row's.
    const restarted = fakeHost({ ...SELECTING, gateway: true });
    for (const [id, s] of host.sessions) restarted.sessions.set(id, s);
    plugin.apply(restarted, plugin.Config(raw));
    await tick();
    assert.match(restarted.wake(coord.id).ctx.section(), /\nGoal: Keep the storefront fast\.\nWorkspace: \/work\/dsh\n/);
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
        Toast: () => null,
    };
    const ui = new Proxy(base, { get: (target, name) => (name in target ? target[name] : typeof name === 'string' && name.startsWith('Icon') ? name : undefined) });
    const modules = {
        react: {
            createElement: (type, props, ...children) => ({ type, props, children }), useSyncExternalStore: (_subscribe, get) => get(),
            // Enough of React's hooks to call a component once and read what it draws.
            useState: (init) => [typeof init === 'function' ? init() : init, () => {}], useRef: (current) => ({ current }),
            useEffect: () => {}, useLayoutEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(),
        },
        'react-dom': { createPortal: (node) => node }, '@deepseek-ai/dsh-client-ui-primitives': ui,
    };
    return { id: loaded.id, client: loaded.factory((name) => modules[name]), window, react: modules.react };
}

/**
 * Draw a component again and again with state that holds between draws
 * (the stand-in React's useState forgets), so a click can open what it opens.
 * @returns a function that draws it once more.
 */
function mount(react, render) {
    const cells = [];
    return () => {
        let at = 0;
        react.useState = (init) => {
            const k = at++;
            if (!(k in cells)) cells[k] = typeof init === 'function' ? init() : init;
            return [cells[k], (next) => { cells[k] = typeof next === 'function' ? next(cells[k]) : next; }];
        };
        return render();
    };
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
        ['shell.overlay', 'dsh-plugin-projects/archive', null],
        ['sidebar.workspaces.session.menu.item', 'dsh-plugin-projects/archive-item', 260],
        ['conversation.session.header.actions', 'dsh-plugin-projects/threads-menu', -25],
        ['conversation.chat.turnTail', 'dsh-plugin-projects/thread-cards', 30],
        ['conversation.chat.node', 'turn-trigger', null],
        ['sidebar.session.row.leading', 'dsh-plugin-projects/thread-mark', 20],
        ['sidebar.workspaces.session.row.action', 'dsh-plugin-projects/row-place', 900],
        ['conversation.input.dock', 'dsh-plugin-projects/coordinator-offer', 14],
        ['conversation.input.dock', 'dsh-plugin-projects/paused-bar', 15],
        ['conversation.input.dock', 'dsh-plugin-projects/ending-bar', 16],
        ['sidebar.session.row.hover', 'dsh-plugin-projects/thread-hover', 20],
        ['sidebar.workspaces.session.menu.item', 'dsh-plugin-projects/full-view-item', 50],
        ['shell.overlay', 'dsh-plugin-projects/news-notice', null],
        ['shell.overlay', 'dsh-plugin-projects/session-list', null],
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

test('browser half: the goal in Project settings is saved with Save, put back with Escape, and says which of the user\'s tools it opens', async () => {
    const { client, react } = loadClient();
    const { GoalRow } = client.internals;
    const saves = [];
    let accept = true;
    let goal = { value: 'Ship good DSH plugins', source: 'project config', inherited: 'Ship good DSH plugins', tools: [], max: 2000 };
    const draw = mount(react, () => GoalRow({ goal, busy: false, message: null, onSave: async (changes) => { saves.push(changes); return accept; } }));
    const hook = (row, name) => elementsOf(row).find((e) => e.props?.[name] !== undefined);
    const box = (row) => hook(row, 'data-projects-goal');
    const key = (row, k, mods = {}) => {
        const seen = { prevented: false, stopped: false };
        box(row).props.onKeyDown({ key: k, ...mods, preventDefault: () => { seen.prevented = true; }, stopPropagation: () => { seen.stopped = true; } });
        return seen;
    };
    let row = draw();
    // From the profile: its text in the box, where it comes from, and nothing to save.
    assert.deepEqual(plain([box(row).props.value, box(row).props.maxLength, textIn(byClass(row, 'dshp-ps-source')), hook(row, 'data-projects-goal-save') ?? null]),
        ['Ship good DSH plugins', 2000, 'From your profile', null]);
    assert.equal(textIn(byClass(row, 'dshp-ps-title')), 'Goal');
    // Typing shows Save and Cancel; the same text again, spaces aside, has nothing to save.
    box(row).props.onChange({ target: { value: 'Keep the storefront fast. ' } });
    row = draw();
    assert.deepEqual([textIn(hook(row, 'data-projects-goal-save')), textIn(byClass(row, 'dshp-ps-goal-actions'))], ['Save', 'CancelSave']);
    box(row).props.onChange({ target: { value: 'Ship good DSH plugins  ' } });
    assert.equal(hook(draw(), 'data-projects-goal-save'), undefined);
    // Escape while it is changed puts the text back, and the dialog stays open; with nothing changed, Escape is the dialog's.
    box(row).props.onChange({ target: { value: 'Keep the storefront fast.' } });
    assert.deepEqual(key(draw(), 'Escape'), { prevented: true, stopped: true });
    row = draw();
    assert.deepEqual([box(row).props.value, hook(row, 'data-projects-goal-save') ?? null], ['Ship good DSH plugins', null]);
    assert.deepEqual(key(row, 'Escape'), { prevented: false, stopped: false });
    // Enter alone is a new line; Save, or Ctrl+Enter, sends the text, and once the plugin takes it the box shows what it holds.
    box(row).props.onChange({ target: { value: 'Keep the storefront fast.' } });
    assert.deepEqual(key(draw(), 'Enter'), { prevented: false, stopped: false });
    hook(draw(), 'data-projects-goal-save').props.onClick();
    await tick();
    assert.deepEqual(plain(saves), [{ goal: 'Keep the storefront fast.' }]);
    goal = { ...goal, value: 'Keep the storefront fast.', source: 'project setting', tools: [] };
    row = draw();
    assert.deepEqual([box(row).props.value, hook(row, 'data-projects-goal-save') ?? null, textIn(byClass(row, 'dshp-ps-source'))],
        ['Keep the storefront fast.', null, 'Set for this projectUse your profile\'s']);
    // A refused save keeps what was typed.
    accept = false;
    box(row).props.onChange({ target: { value: 'x'.repeat(10) } });
    assert.deepEqual(key(draw(), 'Enter', { ctrlKey: true }), { prevented: true, stopped: false });
    await tick();
    assert.deepEqual([plain(saves.at(-1)), box(draw()).props.value], [{ goal: 'xxxxxxxxxx' }, 'xxxxxxxxxx']);
    // "Use your profile's" gives the profile row's goal back.
    accept = true;
    hook(draw(), 'data-projects-goal-reset').props.onClick();
    await tick();
    assert.deepEqual(plain(saves.at(-1)), { goal: null });
    goal = { ...goal, value: 'Ship good DSH plugins', source: 'project config' };
    assert.equal(box(draw()).props.value, 'Ship good DSH plugins');
    // The user's tools a goal names are open to every thread, so the row names them.
    goal = { ...goal, value: 'Keep the obsidian inbox tidy', source: 'project setting', tools: ['obsidian'] };
    assert.equal(textIn(hook(draw(), 'data-projects-goal-tools')), 'It names obsidian, so every thread in this project can use it.');
    goal = { ...goal, tools: ['obsidian', 'dsh_vault'] };
    assert.equal(textIn(hook(draw(), 'data-projects-goal-tools')), 'It names obsidian and dsh_vault, so every thread in this project can use them.');
    // A project made in the window has no profile goal: an empty box, its placeholder, and no source line.
    goal = { value: '', source: 'none', inherited: '', tools: [], max: 2000 };
    row = draw();
    assert.deepEqual([box(row).props.value, box(row).props.placeholder, byClass(row, 'dshp-ps-source').length], ['', 'What this project is for', 0]);
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
        // A stop DSH counts as the user's is named as theirs.
        ['t6', 'idle', 'idle', 'Stopped', 'Stopped by you'],
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
        { state: 'stopped', kind: 'aborted', cause: 'disposed' }, { state: 'stopped', kind: 'aborted', cause: 'user' }, { state: 'stopped', kind: 'aborted' },
    ].map(endingLine)), [
        'Failed · A DSH plugin blocked the turn.', 'Failed · You signed out of DeepSeek.', 'Failed · DSH couldn\'t finish the turn.',
        'Stopped · DSH closed while it ran.', 'Stopped · It reached the output token limit.', 'Stopped · A DSH plugin stopped it (budget).',
        'Stopped · Its session closed while it ran.', 'Stopped by you', 'Stopped before it finished',
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
    // What a screen reader hears after each row's title (DSH's own status can take the mark's seat, never these words).
    const { RowPlace, rowWords } = client.internals;
    const useMarked = (select) => select(marked);
    assert.deepEqual(plain(['s-t7', 's-t11', 's-t8', 's-c', 'nope'].map((id) => RowPlace({ sessionId: id, useSessions: useMarked })?.props['data-projects-words'] ?? null)),
        ['Project thread: Failed', 'Project thread: Blocked', 'Project thread', 'Project', null]);
    assert.equal(rowWords({ role: 'coordinator', paused: true }), 'Project paused');
    assert.equal(rowWords({ role: 'coordinator', paused: true, news: { unread: [{ kind: 'failed', title: 'Deploy' }] } }), 'Project paused, New: “Deploy” failed');
    assert.equal(rowWords({ role: '' }), '');

    // The hover card says what the thread last did; DSH ends it with the session's own status.
    assert.deepEqual(plain(['t7', 't6', 't8', 't9'].map((id) => hoverLine(byId[id]))), [
        'Last turn failed · The model rejected the request.', 'Last turn stopped by you', 'Last handback · Done · Spike done.', 'Last turn failed · The model rejected the request.',
    ]);
    assert.equal(hoverLine({ ...byId.t7, pending: true }), undefined);
    assert.equal(hoverLine(rowsOf([{ id: 't1', session: 's1', title: 'x', resolved: false }], new Map(), {}, {})[0]), 'No handback yet');

    // A refusal reads as the plugin's sentence.
    assert.equal(continueError({ code: 'projects/refused', message: 't7 is running already' }), 'T7 is running already.');
    assert.equal(continueError({ code: 'projects/unreachable', message: 'socket' }), 'Couldn\'t reach the thread.');
});

test('browser half: each session list row says its place in a project, and the CSS nests each project by it', () => {
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

    // The projects drawn in a section, read from the marks in its rows: each coordinator there with its threads
    // there, at its wrapper's place (from 1), its threads in DSH's order; a coordinator without threads here, or a
    // thread whose coordinator is elsewhere, nests nothing.
    const { sectionGroups } = client.internals;
    const markOf = (mark) => (mark ? { getAttribute: (name) => ({ 'data-projects-row': mark[0], 'data-projects-of': mark[1] })[name] ?? null } : null);
    const rowEl = (key, mark) => ({ getAttribute: (name) => (name === 'data-row-key' ? key : null), querySelector: (sel) => (sel === '[data-projects-row]' ? markOf(mark) : null) });
    const wrap = (key, mark) => ({ children: [rowEl(key, mark)] });
    const section = {
        children: [
            wrap('workspace:w'), wrap('session:x'), wrap('session:t2', ['thread', 'c']), wrap('session:c', ['coordinator', 'c']),
            wrap('session:d', ['coordinator', 'd']), wrap('session:e', ['coordinator', 'e']), wrap('session:t1', ['thread', 'c']),
            wrap('session:et', ['thread', 'e']), wrap('session:far', ['thread', 'elsewhere']), { children: [] }, wrap('overflow:w'),
        ],
    };
    assert.deepEqual(plain(sectionGroups(section)), [
        { coordinator: 'c', at: 4, threads: ['t2', 't1'] },
        { coordinator: 'e', at: 6, threads: ['et'] },
    ]);
    assert.deepEqual(plain(sectionGroups(null)), []);

    // The rules name the coordinators' and threads' rows by DSH's row keys, lay out and move only the wrappers of
    // their own section (each coordinator, then its threads, then what DSH lists after the coordinator), and look
    // no deeper than a wrapper's child or a section's grandchildren, with no sibling selector: one row's change
    // restyles one section, cheaply (1.8 s to 0.1 s at 300 chats).
    const css = nestingRules([{ coordinator: 'ses_01.ab-c:9', at: 4, threads: ['ses_t1', 'ses_t2'] }]);
    const rules = css.split('\n');
    const list = '[role="tree"] div:has(>*>[data-row-key="session:ses_01.ab-c:9"])';
    const C = ':has(>[data-row-key="session:ses_01.ab-c:9"])';
    const T = ':has(>[data-row-key="session:ses_t1"],>[data-row-key="session:ses_t2"])';
    assert.equal(rules.length, 9);
    for (const rule of rules) assert.ok(rule.startsWith(list), rule);
    assert.ok(rules.includes(`${list}{display:flex;flex-direction:column}`));
    assert.ok(rules.includes(`${list}>:nth-child(n+5){order:3}`));
    // The coordinator's and threads' own orders come after the rule for what follows them, so they win.
    assert.ok(rules.indexOf(`${list}>${C}{order:1}`) > rules.indexOf(`${list}>:nth-child(n+5){order:3}`));
    assert.ok(rules.indexOf(`${list}>${T}{order:2}`) > rules.indexOf(`${list}>:nth-child(n+5){order:3}`));
    assert.ok(rules.includes(`${list}>${T}>[data-row-key]{padding-inline-start:calc(var(--dshp-nest,24px) + var(--dsh-workspace-indent,0px))}`));
    // The corner is drawn in the indent, not in the row's leading seat; the branch mark leaves the seat but is still read aloud.
    assert.ok(rules.some((rule) => rule.startsWith(`${list}>${T}::before{content:"";position:absolute;`)));
    assert.ok(rules.includes(`${list}>${T} .dshp-t-mark[data-projects-thread-mark=""]{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}`));
    // DSH's time (the row's third child, before its actions) leaves the row too, still read aloud, so the indent
    // doesn't cost the title its room; a status DSH writes there instead ("Approval") and the actions stay.
    assert.ok(rules.includes(`${list}>${T}>[data-row-key]>:nth-child(3):not(:last-child,[aria-hidden="true"]){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}`));
    const has = (ids) => `:has(${ids.map((id) => `>[data-row-key="session:${id}"]`).join(',')})`;
    // Two projects in one workspace stay apart: each is drawn where its coordinator is, and what DSH lists after a
    // coordinator follows that project's threads.
    const two = nestingRules([{ coordinator: 'b', at: 6, threads: ['bt'] }, { coordinator: 'a', at: 2, threads: ['at1', 'at2'] }]).split('\n');
    const L2 = '[role="tree"] div:has(>*>[data-row-key="session:a"])';
    assert.deepEqual(two.slice(2, 8), [
        `${L2}>:nth-child(n+3){order:3}`, `${L2}>:nth-child(n+7){order:6}`,
        `${L2}>${has(['a'])}{order:1}`, `${L2}>${has(['at1', 'at2'])}{order:2}`,
        `${L2}>${has(['b'])}{order:4}`, `${L2}>${has(['bt'])}{order:5}`,
    ]);
    assert.ok(two.includes(`${L2}>${has(['at1', 'at2', 'bt'])}>[data-row-key]{padding-inline-start:calc(var(--dshp-nest,24px) + var(--dsh-workspace-indent,0px))}`));
    for (const rule of [...rules, ...two]) {
        // A :has() inside another makes a browser drop the whole rule; a descendant step inside one, or a
        // sibling selector after one, is what made the old rules slow.
        assert.doesNotMatch(rule, /:has\([^)]*:has\(/, rule);
        for (const inside of rule.match(/:has\([^)]*\)/g) ?? []) assert.doesNotMatch(inside, /\]\s+\[|\*\s+\[/, rule);
        assert.doesNotMatch(rule, /~/, rule);
    }
    // Nothing to nest, or no place yet: no rules; an id that could break out of the selector gets none, a thread's is left out.
    assert.equal(nestingRules([]), '');
    assert.equal(nestingRules(undefined), '');
    assert.equal(nestingRules([{ coordinator: 'c', at: 2, threads: [] }]), '');
    assert.equal(nestingRules([{ coordinator: 'c', at: 0, threads: ['t1'] }]), '');
    assert.equal(nestingRules([{ coordinator: 'a"] *{display:none} [x="', at: 2, threads: ['t1'] }]), '');
    assert.equal(nestingRules([{ coordinator: '', at: 2, threads: ['t1'] }]), '');
    const kept = nestingRules([{ coordinator: 'c', at: 2, threads: ['t1', 'x"] *{display:none} [y="'] }]);
    assert.match(kept, /:has\(>\[data-row-key="session:t1"\]\)/);
    assert.doesNotMatch(kept, /x"\]/);
});

test('browser half: the plugin\'s mark gives way to any other mark in a row\'s leading seat, which never widens', () => {
    let css = '';
    const document = {
        addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null,
        createElement: () => ({ dataset: {} }), head: { appendChild: (tag) => { css = tag.textContent; } },
    };
    loadClient({ document });
    // Beside DSH's Automation task mark or another plugin's, in DSH's slot or in the seat itself, the plugin's mark
    // is hidden the screen-reader way (the row's description still says what it shows); alone, it is drawn. It is
    // the only rule that reaches into DSH's row, so nothing widens the seat or moves the other marks in it.
    const intoRow = css.split('}').filter((rule) => rule.includes('[data-row-key^="session:"]>'));
    assert.deepEqual(intoRow, [
        '[data-row-key^="session:"]>* .dshp-t-mark:not(:only-child),[data-row-key^="session:"]>* [data-slot]:not(:only-child)>.dshp-t-mark'
        + '{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0',
    ]);
});

/** Just enough of the DOM for the session list's passes: attributes, children, and the selectors they use. */
class FakeEl {
    constructor(tag, attrs = {}, children = []) {
        this.tagName = tag.toUpperCase();
        this.attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
        this.children = children;
        this.parentElement = null;
        for (const child of children) child.parentElement = this;
    }
    get id() { return this.attrs.get('id') ?? ''; }
    set id(value) { this.attrs.set('id', String(value)); }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    /** `[a]`, `[a="v"]`, `[a^="v"]`, and the one compound selector the passes use, `[role="tree"] div`. */
    matches(selector) {
        if (selector === '[role="tree"] div') {
            if (this.tagName !== 'DIV') return false;
            for (let e = this.parentElement; e; e = e.parentElement) if (e.getAttribute('role') === 'tree') return true;
            return false;
        }
        const m = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(selector);
        if (!m) throw new Error(`selector not faked: ${selector}`);
        const value = this.getAttribute(m[1]);
        return value !== null && (!m[2] || (m[2] === '=' ? value === m[3] : value.startsWith(m[3])));
    }
    querySelectorAll(selector) {
        const out = [];
        const walk = (el) => { for (const child of el.children) { if (child.matches(selector)) out.push(child); walk(child); } };
        walk(this);
        return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) {
        for (let e = this; e; e = e.parentElement) if (e.matches(selector)) return e;
        return null;
    }
}

test('browser half: a screen reader meets each project\'s rows in drawn order, and hears the plugin\'s words after each title', () => {
    const { client } = loadClient();
    const { nestingRules, nestedOrder, readInOrder, describeRows, undoRows } = client.internals;
    // The order the CSS draws a section in: what DSH lists before the first coordinator, then each coordinator,
    // its threads in DSH's order, and what DSH lists after it. The same two projects as the CSS above.
    const groups = [{ coordinator: 'b', at: 6, threads: ['bt'] }, { coordinator: 'a', at: 2, threads: ['at1', 'at2'] }];
    const keys = ['x', 'a', 'y', 'at2', 'bt', 'b', 'z', 'at1', ''];
    assert.deepEqual(plain(nestedOrder(groups, keys)), [1, 2, 4, 8, 3, 6, 5, 7, 9]);
    const css = nestingRules(groups);
    for (const [order, rule] of [[3, ':nth-child(n+3)'], [6, ':nth-child(n+7)'], [1, 'session:a"]'], [2, 'session:at1"]'], [4, 'session:b"]'], [5, 'session:bt"]']]) {
        assert.ok(css.split('\n').some((line) => line.includes(rule) && line.endsWith(`{order:${order}}`)), rule);
    }
    // Nothing to nest, or DSH's own order already: nothing to reorder.
    assert.equal(nestedOrder([], keys), null);
    assert.equal(nestedOrder([{ coordinator: 'a', at: 1, threads: ['t'] }], ['a', 't', 'x']), null);
    assert.equal(nestedOrder(groups, []), null);

    // DSH's list: a section of wrappers, each holding a row; RowPlace's mark inside each project's row.
    const place = (role, of, words) => new FakeEl('span', { 'data-projects-row': role, 'data-projects-of': of, 'data-projects-words': words });
    const row = (key, mark, attrs = {}) => new FakeEl('div', { 'data-row-key': key, role: 'treeitem', ...attrs }, mark ? [new FakeEl('span', {}, [mark])] : []);
    const wrap = (r, attrs = {}) => new FakeEl('span', attrs, [r]);
    const rows = {
        head: row('workspace:w'), chat: row('session:chat'),
        t2: row('session:t2', place('thread', 'c', 'Project thread: Failed')), c: row('session:c', place('coordinator', 'c', 'Project')),
        late: row('session:late'), t1: row('session:t1', place('thread', 'c', 'Project thread')),
        old: row('session:old', place('thread', 'c', 'Project thread'), { 'aria-description': 'Archived' }),
    };
    const kids = [wrap(rows.head), wrap(rows.chat), wrap(rows.t2), wrap(rows.c, { id: 'dsh-own' }), wrap(rows.late), wrap(rows.t1), wrap(rows.old)];
    const section = new FakeEl('div', {}, kids);
    const tree = new FakeEl('div', { role: 'tree' }, [section]);
    readInOrder(tree);
    // The section owns its children in drawn order: the coordinator, its threads, then the chat DSH lists after it.
    // A child keeps an id it has; the others get the plugin's.
    const ids = section.getAttribute('aria-owns').split(' ');
    assert.deepEqual(plain(ids.map((id) => kids.findIndex((k) => k.id === id))), [0, 1, 3, 2, 5, 6, 4]);
    assert.equal(kids[3].id, 'dsh-own');
    assert.ok(kids.filter((k, i) => i !== 3).every((k) => k.id.startsWith('dshp-o-')));
    assert.ok(section.hasAttribute('data-projects-owns'));
    // Each project row says its words as its description; a description DSH gave a row is DSH's and stays.
    describeRows(tree);
    assert.equal(rows.t2.getAttribute('aria-description'), 'Project thread: Failed');
    assert.equal(rows.c.getAttribute('aria-description'), 'Project');
    assert.equal(rows.old.getAttribute('aria-description'), 'Archived');
    assert.equal(rows.chat.getAttribute('aria-description'), null);
    // The words change with the row; DSH taking a row's description back keeps its own; words gone, description gone.
    rows.t2.children[0].children[0].setAttribute('data-projects-words', 'Project thread');
    rows.c.setAttribute('aria-description', 'Archived');
    rows.t1.children[0].children[0].setAttribute('data-projects-words', '');
    describeRows(tree);
    assert.equal(rows.t2.getAttribute('aria-description'), 'Project thread');
    assert.equal(rows.c.getAttribute('aria-description'), 'Archived');
    assert.equal(rows.c.getAttribute('data-projects-said'), null);
    assert.equal(rows.t1.getAttribute('aria-description'), null);
    // A thread that leaves the section (or DSH drawing the project in its own order) ends the plugin's order there.
    section.children = section.children.filter((k) => k !== kids[2] && k !== kids[5] && k !== kids[6]);
    readInOrder(tree);
    assert.equal(section.getAttribute('aria-owns'), null);
    assert.equal(section.hasAttribute('data-projects-owns'), false);
    assert.equal(kids[3].id, 'dsh-own');
    assert.equal(kids[1].id, '');
    // A list drawn as one flat list (the rows' section is the list itself) is never reordered: the CSS doesn't nest it.
    const flat = new FakeEl('div', { role: 'tree' }, [wrap(row('session:x')), wrap(row('session:t9', place('thread', 'c9', 'Project thread'))), wrap(row('session:c9', place('coordinator', 'c9', 'Project')))]);
    readInOrder(flat);
    assert.equal(flat.getAttribute('aria-owns'), null);
    // Switched off: the list as DSH draws it, DSH's own descriptions kept.
    section.children = kids;
    readInOrder(tree);
    describeRows(tree);
    assert.ok(section.hasAttribute('aria-owns'));
    undoRows(tree);
    assert.equal(section.getAttribute('aria-owns'), null);
    assert.ok(kids.every((k, i) => i === 3 || k.id === ''));
    assert.equal(rows.t2.getAttribute('aria-description'), null);
    assert.equal(rows.old.getAttribute('aria-description'), 'Archived');
    assert.equal(rows.c.getAttribute('aria-description'), 'Archived');
});

test('browser half: the session list overlay looks only for DSH\'s own list, and draws nothing but a refusal\'s toast', () => {
    const asked = [];
    const document = {
        addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ dataset: {} }), head: { appendChild: () => {} },
        querySelector: (selector) => { asked.push(selector); return null; },
    };
    const { client, react } = loadClient({ document });
    asked.length = 0;
    react.useLayoutEffect = () => {};
    const { SessionList, SIDEBAR } = client.internals;
    // No list in the window yet: nothing to watch or nest, and nothing drawn.
    assert.equal(mount(react, () => SessionList({ useWorkspaces: (select) => select({ pinnedSessionIds: ['c'] }) }))(), null);
    assert.equal(mount(react, () => SessionList({}))(), null);
    assert.deepEqual([...new Set(asked)], ['[data-slot="sidebar.workspaces"] [role="tree"]']);
    // What it says when it refuses a drag speaks of projects, threads and chats only.
    assert.deepEqual(Object.keys(SIDEBAR), ['threadStays', 'chatOut', 'projectIn', 'chatStays', 'projectStays']);
    for (const text of Object.values(SIDEBAR)) assert.doesNotMatch(text, /categor/i);
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

test('browser half: a thread opened beside its coordinator, or from the Threads panel, takes the place of the thread tab already there', () => {
    const { client } = loadClient();
    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const thread = (id) => ({ role: 'thread', coordinator: 'c', thread: { id } });
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { projectSession: value } } : {}), retainedBy: { mainView: main } });
    const snapshot = { ids: ['c', 't1', 't2', 't3'], byId: { c: row(coordValue, 1), t1: row(thread('t1')), t2: row(thread('t2')), t3: row(thread('t3')) }, phase: 'ready', projectionsBySession: {} };
    const address = (id) => `dsh-resource://projectthread/session/${encodeURIComponent(id)}`;
    let tabs = [];
    let front;
    const placed = [];
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push(slot); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, retain: () => ({ release() {} }) },
        uiWorkspace: { openSession: () => {} },
        sidebarRight: {
            mounted: { getSnapshot: () => 'c' },
            tabsIn: (id) => (id === 'c' ? tabs : []),
            active: () => front,
            openResource: (at, options) => placed.push([decodeURIComponent(at.split('/').pop()), options.kind, options.replaceTab ?? null]),
        },
    };
    client.apply(ctx);
    const { projects } = registered.find((r) => r.name === 'main').inject();
    // The first thread gets a tab; opened again, DSH brings that tab to the front.
    projects.openThread('t1');
    tabs = [{ id: 'a', kind: 'projectthread', contentId: address('t1') }];
    projects.openThread('t1');
    // Another thread takes the place of the thread tab in front, else of the newest one (here the Threads panel is in front).
    projects.openThread('t2');
    tabs = [{ id: 'a', kind: 'projectthread', contentId: address('t1') }, { id: 'p', kind: 'projectthreads', contentId: 'dsh-resource://page/projectthreads' },
        { id: 'b', kind: 'projectthread', contentId: address('t2') }];
    front = { id: 'a' };
    projects.openThread('t3');
    front = { id: 'p' };
    projects.openThread('t3');
    assert.deepEqual(placed, [['t1', 'projectthread', null], ['t1', 'projectthread', null], ['t2', 'projectthread', 'a'], ['t3', 'projectthread', 'a'], ['t3', 'projectthread', 'b']]);

    // From the Threads panel (in front, in the coordinator's sidebar): the newest thread tab gives way and the panel stays.
    placed.length = 0;
    assert.equal(projects.replaceThreadTab('c', 't3'), true);
    assert.deepEqual(placed, [['t3', 'projectthread', 'b']]);
    // The panel opens the thread its own way when there's none to replace, the thread is there already, or its sidebar isn't on screen.
    assert.equal(projects.replaceThreadTab('c', 't2'), false);
    assert.equal(projects.replaceThreadTab('t1', 't3'), false);
    tabs = [{ id: 'p', kind: 'projectthreads', contentId: 'dsh-resource://page/projectthreads' }];
    assert.equal(projects.replaceThreadTab('c', 't3'), false);
    assert.equal(placed.length, 1);
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
    // Stopped by the user: when, and that they did.
    card = ThreadCard({ view: view({ state: 'stopped', kind: 'aborted', cause: 'user', turn: 3, seq: 9, at: at.toISOString() }, { dot: 'idle', label: 'Stopped' }), projects });
    assert.equal(textIn(byClass(card, 'dshp-t-card-why')), `${hhmm} · You stopped it.`);
    // Stopped with no reason to give: just when.
    card = ThreadCard({ view: view({ state: 'stopped', kind: 'aborted', turn: 3, seq: 9, at: at.toISOString() }, { dot: 'idle', label: 'Stopped' }), projects });
    assert.equal(textIn(byClass(card, 'dshp-t-card-why')), hhmm);
    // A card that isn't the thread's newest says none of it.
    card = ThreadCard({ view: { ...view(failed, { dot: 'error', label: 'Failed' }), newest: false }, projects });
    assert.deepEqual([byClass(card, 'dshp-t-card-why').length, textIn(byClass(card, 'dshp-t-card-state-text'))], [0, 'Failed']);
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
    const fail = () => {
        thread.ctx.emitStatus(thread, 'running');
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/start', data: { turn: ts.events.length } });
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: ts.events.length, reason: { kind: 'error', error: { message: 'provider unavailable', code: 'NETWORK' } } } });
        thread.ctx.emitStatus(thread, 'idle');
    };
    // The plugin nudges it first; the coordinator hears when that didn't help.
    fail();
    await tick();
    assert.equal(host.sessions.get(coord.id).prompts.length, 0);
    fail();
    await tick();
    assert.match(host.sessions.get(coord.id).prompts[0].text, /^\[Thread idle without a handback: t1 · "Flaky"\]\n\nThe turn failed: provider unavailable\n\nIt produced no reply text\./);
});

test('a thread that ends its turn again without a handback after its one message goes to the user; failures count apart', async () => {
    const { host, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Stall', brief: 'Write the notes.' });
    const thread = threadOf(host, coord);
    const ts = host.sessions.get(thread.id);
    const cp = host.sessions.get(coord.id).prompts;
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');
    const marks = turnMarks(host, thread.id);
    const stall = (reply) => {
        thread.ctx.emitStatus(thread, 'running');
        marks.start();
        assistantSays(host, thread.id, reply);
        marks.end();
        thread.ctx.emitStatus(thread, 'idle');
    };
    const first = /\n\n\(If its last reply is a result, check it against the ask[^]*\. Send nothing more if it ends this way again: you will be told to tell the user\.\)$/;
    const again = (reply) => `[Thread idle without a handback: t1 · "Stall"]\n\nIts last reply:\n\n${reply}\n\n(It ended its turn again without a handback after it was nudged. Tell the user in one line, starting with [Stall](.dsh-thread/t1), what its last reply says. Send it nothing more unless the user asks.)`;

    // The first time, the coordinator sends it one message.
    stall('Which file?');
    await tick();
    assert.match(cp.at(-1).text, first);
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'The README.' });
    // A failure in between gets the plugin's own nudge and leaves the count alone.
    thread.ctx.emitStatus(thread, 'running');
    marks.start();
    marks.end('error', 'provider unavailable');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.equal(ts.prompts.at(-1).text, '[From the coordinator]\n\nCarry on from where you left off and finish the task.');
    // It ends again without a handback: the coordinator tells the user, and sends it nothing more.
    const notes = cp.length;
    stall('Still reading.');
    await tick();
    assert.equal(cp.length, notes + 1);
    assert.equal(cp.at(-1).text, again('Still reading.'));
    stall('Reading more.');
    await tick();
    assert.equal(cp.at(-1).text, again('Reading more.'), 'still the user\'s, until something new');
    assert.match(log(), / idle-note dsh-plugins\/t1 chars=11\n[^]* nudge dsh-plugins\/t1 ended=error\n[^]* idle-note dsh-plugins\/t1 chars=14 again\n/);

    // The user's words start the count again, and so does a handback.
    userSays(host, coord.id, 'Write the notes in NOTES.md.');
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Write them in NOTES.md.', ask: 'Write the notes in NOTES.md.' });
    stall('Which heading?');
    await tick();
    assert.match(cp.at(-1).text, first);
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Finish the task and call project_handback.' });
    thread.ctx.emitStatus(thread, 'running');
    marks.start();
    await thread.ctx.call('project_handback', { status: 'done', summary: 'Wrote NOTES.md.' });
    marks.end();
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Now the changelog.' });
    stall('Which version?');
    await tick();
    assert.match(cp.at(-1).text, first);
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
    assert.match(coord.ctx.section(), /idle · stopped by the user \(they can resume it\) · no handback yet(\n|$)/);
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
        [{ kind: 'aborted', reason: { kind: 'disposed' } }, 'The turn was cut off because its session closed while it ran.', 'stopped'],
        [{ kind: 'interrupted' }, 'The turn was cut off because DSH closed while it ran.', 'stopped'],
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
    assert.match(coord.ctx.section(), /- t1 · "Long" · idle · stopped by the user \(they can resume it\) · no handback yet(\n|$)/);
    assert.match(coord.ctx.section(), /A thread the user stopped stays stopped/);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /user-stop dsh-plugins\/t1/);

    // Any other stop (a plugin's hook) gets the one nudge; when it stops again, the coordinator hears.
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Try again.' });
    stopBy({ kind: 'hook', reason: 'budget' });
    await tick();
    const cp = host.sessions.get(coord.id).prompts;
    assert.equal(cp.length, 0);
    assert.equal(ts.prompts.at(-1).text, '[From the coordinator]\n\nCarry on from where you left off and finish the task.');
    stopBy({ kind: 'hook', reason: 'budget' });
    await tick();
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
    assert.equal(cp[0].text, '[Thread waiting for approval: t1 · "Deploy"]\n\nIt asked to use bash: runs ./deploy.sh\n\nThe user approves or rejects it in the "Deploy" session.\n\n(Tell the user in one line, starting with [Deploy](.dsh-thread/t1), what it wants to do and that they approve or reject it in its chat. Never approve it yourself or do the work another way, and do not start another thread for it.)');

    // The user is in the thread directly: the prompt is in front of them.
    userSays(host, thread.id, 'Go ahead and deploy.');
    thread.ctx.sessionEvent({ type: 'approval/asked', data: { id: 'a3', toolName: 'bash' } });
    await wait();
    assert.equal(cp.length, 1);
});

test('news: what threads hand back or need the user for waits per project until the user opens the coordinator', async () => {
    const { host } = setup({ approvalNoticeSeconds: 0.02 }, undefined, { gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    const unread = async () => plain((await remote.news()).news.find((n) => n.coordinator === coord.id)).unread.map(({ at, ...item }) => item);
    assert.deepEqual(plain((await remote.news()).news), [{ project: 'dsh-plugins', name: 'DSH Plugins', coordinator: coord.id, seq: 0, seen: 0, unread: [] }]);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Docs', brief: 'Write docs.' });
    const thread = [...host.live.values()].find((a) => a.id !== coord.id);
    const ts = host.sessions.get(thread.id);

    // Progress is the coordinator's business only; a result is news once the coordinator has it.
    thread.ctx.emitStatus(thread, 'running');
    await thread.ctx.call('project_handback', { status: 'progress', summary: 'Halfway' });
    assert.deepEqual(await unread(), []);
    await thread.ctx.call('project_handback', { status: 'blocked', summary: 'No access to the wiki.' });
    const turnEnd = (reason = { kind: 'completed' }) => ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: ts.events.length, reason } });
    turnEnd();
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    assert.deepEqual(await unread(), [{ seq: 1, kind: 'handback', thread: 't1', title: 'Docs', status: 'blocked' }]);

    // A turn that ends without a handback; a permission prompt left waiting.
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Finish the docs.' });
    ts.events.push({ seq: ts.events.length + 1, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: 'Done with the docs.' }] } } });
    turnEnd();
    thread.ctx.emitStatus(thread, 'running');
    thread.ctx.emitStatus(thread, 'idle');
    await tick();
    thread.ctx.sessionEvent({ type: 'approval/asked', data: { id: 'a1', toolName: 'bash', reason: 'runs ./publish.sh' } });
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual((await unread()).map((n) => [n.seq, n.kind]), [[1, 'handback'], [2, 'finished'], [3, 'approval']]);

    // The user opened the coordinator after the window showed them up to 2: only what came after stays unread.
    assert.deepEqual(plain((await remote.seeNews(coord.id, 2)).news[0]).unread.map((n) => n.seq), [3]);
    await remote.seeNews('dsh-plugins');
    assert.deepEqual(await unread(), []);
    // A failed turn: the plugin nudges it first, so the user hears only when it fails again.
    const fail = () => {
        turnEnd({ kind: 'error', error: { message: 'provider unavailable', code: 'NETWORK' } });
        thread.ctx.emitStatus(thread, 'running');
        thread.ctx.emitStatus(thread, 'idle');
    };
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Publish it.' });
    fail();
    await tick();
    assert.deepEqual(await unread(), []);
    assert.equal(host.sessions.get(thread.id).prompts.at(-1).text, '[From the coordinator]\n\nCarry on from where you left off and finish the task.');
    fail();
    await tick();
    assert.deepEqual((await unread()).map((n) => [n.seq, n.kind]), [[4, 'failed']]);

    // While the project is paused a handback waits, and so does its news; it comes with the handback on resume.
    await remote.seeNews(coord.id);
    await coord.ctx.call('project_settings', { paused: true });
    await thread.ctx.call('project_handback', { status: 'done', summary: 'Published.' });
    assert.deepEqual(await unread(), []);
    await coord.ctx.call('project_settings', { paused: false });
    await tick();
    assert.deepEqual(await unread(), [{ seq: 5, kind: 'handback', thread: 't1', title: 'Docs', status: 'done' }]);
    // It outlives a reload: the store keeps it.
    assert.equal(JSON.parse(readFileSync(host.provided.get('dshPluginProjectsRemote').manager.store.file, 'utf8')).projects['dsh-plugins'].news.seq, 5);
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

test('a queued coordinator message that fails after a handback still gets its nudge', async () => {
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
    assert.equal(cp.length, 1, 'the handback; B\'s failure gets the plugin\'s nudge');
    assert.match(cp[0].text, /status: done\]\n\nA is done\./);
    assert.equal(host.sessions.get(thread.id).prompts.at(-1).text, '[From the coordinator]\n\nCarry on from where you left off and finish the task.');

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
    assert.equal(cp.length, 2);
    assert.match(cp[1].text, /C is done\./);
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
    assert.match(coord.ctx.section(), /\n8\. Messages that start with "\[" come from threads or the plugin, not the user: do what the note in them says\. For "\[Project created", run no tools and start no thread for it\./);
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
    // A failed or stopped turn: the coordinator nudges it first, and tells the user when that didn't help or only they can fix it.
    assert.match(idleMessage('t3', 'Flaky', '', 'The turn failed (HTTP 500): boom', { nudge: true }), /\n\n\(The user has not seen this\. Nudge it once: send it "Carry on from where you left off and finish the task\." with project_thread_send thread="t3", and say nothing to the user unless it fails again\.\)$/);
    assert.match(idleMessage('t3', 'Flaky', '', 'The turn failed (HTTP 500): boom', { again: true }), /\n\n\(Tell the user in one line, starting with \[Flaky\]\(\.dsh-thread\/t3\), that its turn failed again after a nudge and why; its card has Retry\. Send it nothing more unless the user asks\.\)$/);
    assert.match(idleMessage('t3', 'Long', '', 'The turn was stopped before it finished.'), /that its turn stopped and why; its card has Resume\./);
    assert.equal(userMustFix('The turn failed: the user signed out of DeepSeek.'), true);
    assert.equal(userMustFix('The turn failed (HTTP 500): boom'), false);
    // A turn that just ended without a handback: one message (the answer, or the nudge), then the user hears of the next
    // such turn in one line (behaviour review 3: a stalled thread got three messages, then the coordinator did the work).
    assert.match(idleMessage('t3', 'Chat', 'Which file?'), /\n\n\(If its last reply is a result, check it against the ask and pass it on as you would a handback, starting with \[Chat\]\(\.dsh-thread\/t3\)\. Otherwise send it one message with project_thread_send thread="t3": the answer to its question when the user's words, the brief or project memory answer it \(ask the user only what is theirs to decide\), else "Finish the task and call project_handback\."\. Send nothing more if it ends this way again: you will be told to tell the user\.\)$/);
    assert.match(idleMessage('t3', 'Chat', 'Still reading.', '', { again: true }), /\n\n\(It ended its turn again without a handback after it was nudged\. Tell the user in one line, starting with \[Chat\]\(\.dsh-thread\/t3\), what its last reply says\. Send it nothing more unless the user asks\.\)$/);
    assert.equal(NUDGE, 'Carry on from where you left off and finish the task.');
    assert.match(approvalMessage('t4', 'Deploy', 'Deploy', 'shell', 'rm -rf build'), /\n\n\(Tell the user in one line, starting with \[Deploy\]\(\.dsh-thread\/t4\), what it wants to do and that they approve or reject it in its chat\. Never approve it yourself or do the work another way, and do not start another thread for it\.\)$/);
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
    assert.match(coord.ctx.section(), /\n2\. Never use the user's personal or infrastructure tools \([^\n]*\n   You don't have these here: lane-catalog, family_1password, cua\. When the user's words ask for work that needs one, start a thread with their words in `ask`; the thread gets the ones their words name\.\n3\. /);
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
    await say(coord, 'Tidy up.');
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
    const say = userTyping(host);
    await say(coord, 'Which of my lanes are up?');
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Which of my lanes are up?', title: 'Lanes', brief: 'Ask lane-catalog.' }), /^Started t1 "Lanes"\. It reports back when done\. The user's words give it lane-catalog\./);
    // The goal names obsidian, so every thread has it.
    await say(coord, 'Sort the inbox.');
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Sort the inbox.', title: 'Inbox', brief: 'Use obsidian to file the inbox notes.' }), /^Started t2/);
    const inbox = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Inbox');
    assert.match(inbox.ctx.section(), /Here those include: lane-catalog, obsidian\. You have only the ones the user's words name: obsidian\./);
    // An alias asks for its tool only from the user's words: a brief that says "lanes" uses no tool by that.
    await say(coord, 'Write a poem.');
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
test('ask holds only the user\'s words: each sentence copied from what they wrote, their box answers or the goal', async () => {
    const { host, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    const say = userTyping(host);
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');
    const start = (ask, title) => coord.ctx.call('project_thread_start', { ask, title, brief: 'Do it.' });
    const refused = (part, where = 'brief') => `Failed: ask holds only the user's own words, copied from their messages, and they didn't write "${part}". Put what you add (the task you picked, the scope) in ${where}`;
    // Before the user has written anything, there is nothing to check against.
    assert.match(await start('Run the smoke tests.', 'Before'), /^Started t1 /);
    // Behaviour review 3, S1 r3: the user left the choice to the coordinator, which put its own picks in ask.
    await say(coord, 'I\'m testing the coordinator. Pick a small test task or two and run them!');
    assert.equal(await start('Run the smoke tests and report the failures.', 'Smoke'), refused('Run the smoke tests and report the failures'));
    assert.match(log(), / guard dsh-plugins ask-not-theirs start\n/);
    assert.equal(await start('The user asked: Pick a small test task or two and run them!', 'Prefixed'), refused('The user asked: Pick a small test task or two and run them'));
    assert.equal(await start('Pick a small test task or two and run the', 'Cut'), refused('Pick a small test task or two and run the'), 'a word inside another word is not that word');
    // Their words as they wrote them, whatever the case, quotes and spacing; sentences from two messages; the goal; a box answer.
    assert.match(await start('"pick a small test task or two  and run them"', 'Smoke'), /^Started t2 /);
    await say(coord, 'Also check the README links.');
    assert.match(await start('I\'m testing the coordinator.\nAlso check the README links.', 'Links'), /^Started t3 /);
    assert.match(await start('Ship good DSH plugins.', 'Goal'), /^Started t4 /);
    const events = coord.ctx.log();
    events.push({ seq: events.length + 1, type: 'tool/call', data: { callId: 'q1', name: 'ask_user_question', arguments: {} } });
    events.push({ seq: events.length + 1, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'q1', content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'which', selected: ['Fix the flaky test'] }] }) }] } } });
    assert.match(await start('Fix the flaky test', 'Flaky'), /^Started t5 /);
    // A message that passes on their request is held to the same; one without their words isn't checked.
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't2', text: 'Then the e2e.', ask: 'Run the e2e too.' }), refused('Run the e2e too', 'text'));
    assert.match(log(), / guard dsh-plugins ask-not-theirs send\n/);
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't2', text: 'Then the links.', ask: 'Also check the README links.' }), 'Sent to t2.');
    assert.equal(await coord.ctx.call('project_thread_send', { thread: 't2', text: 'Carry on.' }), 'Sent to t2.');
    assert.equal(unsaidPart('Fix it. Then ship it!', 'fix it'), 'Then ship it');
    assert.equal(unsaidPart('Fix deploy.sh v1.4.2', 'Please fix deploy.sh v1.4.2 now'), '');
    assert.equal(unsaidPart('  ', 'anything'), '');
});

test('a coordinator is kept off DSH goals: create_goal is hidden and refused, and a goal round is no reason to poll', async () => {
    const { host, dir } = setup({}, undefined, { tools: ['shell', 'read_file', 'get_goal', 'create_goal', 'update_goal'] });
    await tick();
    const coord = coordinatorOf(host);
    assert.deepEqual(coord.ctx.offered(), ['shell', 'read_file', 'get_goal', 'update_goal']);
    assert.equal(coord.ctx.refusal('create_goal', { objective: 'Get the deploy script working.' }), 'A coordinator doesn\'t set DSH goals: your threads hand back when they finish, so nothing needs to continue in rounds. The project\'s goal is the user\'s, in Project settings.');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), / goal-refused dsh-plugins\/coordinator create_goal\n/);
    // A goal the user set with /goal still runs, and its rounds don't send it to its threads.
    assert.equal(coord.ctx.refusal('update_goal', { action: 'complete' }), undefined);
    assert.match(coord.ctx.section(), /Handbacks and questions arrive on their own; never poll threads, not even in a "<goal_round>"\.\n/);
    // Threads keep them.
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Work', brief: 'Do it.' });
    const thread = threadOf(host, coord);
    assert.deepEqual(thread.ctx.offered(), ['shell', 'read_file', 'get_goal', 'create_goal', 'update_goal']);
    assert.equal(thread.ctx.refusal('create_goal', { objective: 'x' }), undefined);
});

const HOST_TOOLS = ['shell', 'read_file', 'mcp__lane-catalog__lanes_status', 'mcp__lane-catalog__pick_lane', 'mcp__family_1password__get_item', 'mcp__cua__click', 'mcp__tavily__search'];

test('a coordinator on Read Only reads and directs; threads ask it, get nudged, and can\'t reach the user\'s servers around the wall', async () => {
    const { host, dir } = setup({ guardedTools: { 'lane-catalog': ['lanes'] } }, undefined, { gateway: true, tools: HOST_TOOLS, presets: true });
    await tick();
    const pp = host.services.permissionPresets;
    const coord = coordinatorOf(host);
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');
    const stored = () => JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads;
    const threadNamed = (title) => [...host.live.values()].find((a) => host.sessions.get(a.id).title === title);
    const cp = () => host.sessions.get(coord.id).prompts;

    // Read Only: DSH's file tools are refused with what to do instead (a view only reads), and what would need the
    // user's approval is refused without asking them.
    assert.equal(pp.current(coord.session), 'read-only');
    assert.match(coord.ctx.refusal('write', { path: 'a.txt' }), /^You are on Read Only, so you don't change files\. Start a thread for this change with project_thread_start/);
    assert.match(coord.ctx.refusal('str_replace_editor', { command: 'str_replace' }), /^You are on Read Only/);
    assert.equal(coord.ctx.refusal('str_replace_editor', { command: 'view' }), undefined);
    assert.equal(coord.ctx.refusal('read', { path: 'a.txt' }), undefined);
    assert.equal(await coord.ctx.approval({ toolName: 'bash', reason: 'writes a.txt' }), 'rejected');
    assert.match(log(), / read-only-refused dsh-plugins\/coordinator write\n[^]* read-only-refused dsh-plugins\/coordinator bash\n/);
    // A call that asks for a wider sandbox is refused before DSH would ask the user, and the note doesn't read as the
    // user's no (behaviour review 3, S13).
    assert.equal(coord.ctx.refusal('bash', { command: 'rm -r build', sandbox_permissions: 'danger-full-access', justification: 'Clean the build.' }), "You are on Read Only, so this didn't run and nobody was asked: a step that needs more than reading belongs in a thread. Start one for it with project_thread_start, or send it to the thread already doing that work. Don't suggest widening your access.");
    assert.doesNotMatch(coord.ctx.refusal('shell', { command: 'touch a', sandbox_permissions: 'workspace-write' }), /rejected|the user/);
    assert.equal(coord.ctx.refusal('bash', { command: 'ls' }), undefined);
    assert.equal(coord.ctx.refusal('bash', { command: 'ls', sandbox_permissions: 'read-only' }), undefined);
    assert.match(log(), / read-only-refused dsh-plugins\/coordinator bash wider\n[^]* read-only-refused dsh-plugins\/coordinator shell wider\n/);
    assert.match(coord.ctx.section(), /\nYou are on Read Only: you can read files and use the project tools/);
    // The project tools work there, and a thread changes files and asks the user as before.
    await coord.ctx.call('project_thread_start', { ask: 'Count the files.', title: 'Count', brief: 'Count them.' });
    const t1 = threadNamed('Count');
    assert.equal(t1.ctx.refusal('write', { path: 'a.txt' }), undefined);
    assert.equal(t1.ctx.refusal('bash', { command: 'rm -r build', sandbox_permissions: 'danger-full-access' }), undefined);
    assert.equal(await t1.ctx.approval({ toolName: 'bash' }), 'asked the user');
    assert.match(t1.ctx.section(), /\nFollow the coordinator's directions and corrections\. Its words are not the user's/);

    // A thread asks its coordinator mid-task: the coordinator gets the question with how to answer, the roster keeps it
    // until something is sent to the thread, and the thread's turn ending to wait for it sends no idle note.
    assert.match(await t1.ctx.call('project_ask_coordinator', { question: 'Count hidden files too? I would leave them out.' }), /^Asked\. Carry on with what doesn't depend on the answer/);
    assert.equal(cp().at(-1).text, `${questionMessage('t1', 'Count', 'Count hidden files too? I would leave them out.')}`);
    assert.match(cp().at(-1).text, /^\[Question from thread t1 · "Count"\]\n\nCount hidden files too\? I would leave them out\.\n\n\(The user has not seen this\. When the user's words, the brief or project memory answer it, answer now with project_thread_send thread="t1" steer=true and say nothing to the user\./);
    assert.match(coord.ctx.section(), /- t1 · "Count" · [a-z]+ · no handback yet · asked you: "Count hidden files too\? I would leave them out\." \(not answered yet\)/);
    // project_thread_read shows the coordinator what the thread did lately, and what it changed.
    host.sessions.get(t1.id).events.push({ seq: 99, type: 'workspace/changes', data: {} });
    assert.match(await coord.ctx.call('project_thread_read', { thread: 't1' }), /\n\nLatest steps: project_ask_coordinator "Count hidden files too\? I would leave them out\."\n\n/);
    const notes = cp().length;
    t1.ctx.emitStatus(t1, 'running');
    t1.ctx.emitStatus(t1, 'idle');
    await tick();
    assert.equal(cp().length, notes, 'no idle note while its question waits');
    assert.match(log(), / idle-question dsh-plugins\/t1\n/);
    await coord.ctx.call('project_thread_send', { thread: 't1', text: 'Leave them out.', steer: true });
    assert.equal(stored().t1.question, undefined);
    assert.doesNotMatch(coord.ctx.section(), /asked you:/);

    // A turn that fails: the plugin nudges the thread itself, so the coordinator takes no turn that would only say so, and
    // the coordinator tells the user when it fails again (behaviour review 3, S9).
    const ts = host.sessions.get(t1.id);
    const turn = (reason) => {
        t1.ctx.emitStatus(t1, 'running');
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/start', data: { turn: ts.events.length } });
        ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { turn: ts.events.length, reason } });
        t1.ctx.emitStatus(t1, 'idle');
    };
    const failure = { kind: 'error', error: { message: '500: {"message":"Upstream timed out."}' } };
    const quiet = cp().length;
    turn(failure);
    await tick();
    assert.equal(cp().length, quiet, 'no note: the plugin nudged it');
    assert.equal(ts.prompts.at(-1).text, '[From the coordinator]\n\nCarry on from where you left off and finish the task.');
    assert.deepEqual(sourceOf(ts, ts.prompts.length - 1), { kind: 'agent-message', form: 'relay', senderSessionId: coord.id });
    turn(failure);
    await tick();
    assert.match(cp().at(-1).text, /\n\n\(Tell the user in one line, starting with \[Count\]\(\.dsh-thread\/t1\), that its turn failed again after a nudge and why; its card has Retry\./);
    assert.match(log(), / nudge dsh-plugins\/t1 ended=error\n[^]* idle-note dsh-plugins\/t1 chars=0 ended=error again\n/);
    // Only the user can fix a sign-in: they hear of it at once.
    turn({ kind: 'aborted', reason: { kind: 'hook', reason: 'deepseek-account/signed-out' } });
    await tick();
    assert.match(cp().at(-1).text, /^\[Thread idle without a handback: t1 · "Count"\]\n\nThe turn failed: the user signed out of DeepSeek\.[^]*\n\n\(Tell the user in one line/);

    // DSH's resource tools name the server in an argument: a thread without the user's lane catalog can't read it that way.
    assert.match(t1.ctx.refusal('read_mcp_resource', { server: 'lane-catalog', uri: 'lanes://all' }), /^This is one of the user's own tools/);
    assert.match(t1.ctx.refusal('list_mcp_resources', { server: 'lane-catalog' }), /^This is one of the user's own tools/);
    assert.equal(t1.ctx.refusal('list_mcp_resources', { server: 'tavily' }), undefined);

    // An answer the user picked or typed in DSH's question box is their words: an ask from it may name their tools.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Check my lanes.', title: 'Lanes', brief: 'Report.' }), /^Failed: ask names lane-catalog, but the user's messages don't/);
    const events = coord.ctx.log();
    events.push({ seq: events.length + 1, type: 'tool/call', data: { callId: 'q1', name: 'ask_user_question', arguments: {} } });
    events.push({ seq: events.length + 1, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'q1', content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'what', selected: [], custom: 'Check my lanes.' }] }) }] } } });
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'Check my lanes.', title: 'Lanes', brief: 'Report.' }), /^Started t2 "Lanes"/);

    // The user's own pick of another permission lifts Read Only.
    pp.pick(coord.id, 'workspace-write');
    assert.equal(coord.ctx.refusal('write', { path: 'a.txt' }), undefined);
    assert.equal(await coord.ctx.approval({ toolName: 'bash' }), 'asked the user');
    assert.doesNotMatch(coord.ctx.section(), /You are on Read Only/);
});

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
    await say(coord, 'Tidy the notes folder.');
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
    // Without the tools' names: the coordinator mentions them only when asked.
    assert.match(shown, /\nThe user's tools: every session has them\nThe user changes these and the goal in Project settings; project_settings can't\.$/);
    assert.equal(coord.ctx.registered.get('project_settings').parameters.your_tools, undefined);
    // Back to the default, and only the two words are settings.
    read = await remote.update(coord.id, { yourTools: null });
    assert.deepEqual([read.access.yourTools.source, coord.ctx.offered()], ['plugin default', OTHERS]);
    await assert.rejects(remote.update(coord.id, { yourTools: 'sometimes' }), (error) => error.code === 'projects/refused' && /your tools must be "asked" or "always"/.test(error.message));
    assert.match(await coord.ctx.call('project_settings', {}), /\nThe user's tools: you don't have them; a thread has the ones the user's words for it name\n/);

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

test('permissions: threads start on Workspace Write, the coordinator on Read Only, and the user\'s picks become the settings', async () => {
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
    // The coordinator goes on Read Only, the plugin's default, when it loads.
    assert.deepEqual([pp.current(coord.session), pp.sets.map((x) => [x.sessionId, x.preset]), stored().coordinatorAccess], ['read-only', [[coord.id, 'read-only']], 'read-only']);
    assert.match(log(), / permission dsh-plugins\/coordinator read-only\n/);

    // A thread is on Workspace Write before it reads its brief.
    await coord.ctx.call('project_thread_start', { ask: 'Add CI.', title: 'CI', brief: 'Add CI.' });
    const t1 = threadNamed('CI');
    assert.equal(pp.current(t1.session), 'workspace-write');
    assert.deepEqual(pp.sets.at(-1), { sessionId: t1.id, preset: 'workspace-write', promptsBefore: 0 });
    assert.equal(stored().threads.t1.permission, 'workspace-write');
    assert.match(log(), / permission dsh-plugins\/t1 workspace-write\n/);
    // That change was the plugin's own, not a pick of the user's.
    assert.doesNotMatch(log(), /picked-permission/);

    // The window: each setting with its source, every thread's permission, and the presets DSH offers (not Auto).
    let read = await remote.describe(coord.id);
    assert.equal(read.project.permission, 'read-only');
    assert.deepEqual(plain(read.access.coordinatorPermission), { value: 'read-only', source: 'plugin default', inherited: { value: 'read-only', source: 'plugin default' } });
    assert.deepEqual(plain(read.access.threadPermission), { value: 'workspace-write', source: 'plugin default', inherited: { value: 'workspace-write', source: 'plugin default' } });
    assert.deepEqual(plain(read.permissions.options.map((o) => [o.value, o.name])), [['read-only', 'Read Only'], ['workspace-write', 'Workspace Write'], ['danger-full-access', 'Full access']]);
    assert.equal(read.permissions.defaultPreset, 'danger-full-access');
    assert.deepEqual(read.threads.map((t) => t.permission), ['workspace-write']);
    assert.equal(plain(await remote.list()).projects[0].permission, 'read-only');

    // The user picks Full access for the thread in DSH's own permission menu: its setting follows.
    pp.pick(t1.id, 'danger-full-access');
    assert.equal(stored().threads.t1.permission, 'danger-full-access');
    assert.match(log(), / picked-permission dsh-plugins\/t1 danger-full-access\n/);
    // And Workspace Write for the coordinator: that becomes the project's coordinator setting.
    pp.pick(coord.id, 'workspace-write');
    read = await remote.describe(coord.id);
    assert.deepEqual(plain(read.access.coordinatorPermission), { value: 'workspace-write', source: 'project setting', inherited: { value: 'read-only', source: 'plugin default' } });
    assert.equal(read.project.permission, 'workspace-write');

    // Project settings moves the coordinator at once; null goes back to the plugin's Read Only.
    read = await remote.update(coord.id, { coordinatorPermission: 'danger-full-access' });
    assert.deepEqual([pp.current(coord.session), read.notes], ['danger-full-access', []]);
    read = await remote.update(coord.id, { coordinatorPermission: null });
    assert.deepEqual([pp.current(coord.session), read.access.coordinatorPermission.source], ['read-only', 'plugin default']);
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
    assert.match(await coord.ctx.call('project_settings', {}), /\nPermissions: coordinator read-only, new threads read-only\nThe user changes these and the goal in Project settings; project_settings can't\.$/);
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

test('project_message: a coordinator messages a chat or another project when the user asks, never adopts it, and hears the answer once', async () => {
    const { host, dir, config } = setup({
        guardedTools: ['lane-catalog'],
        projects: [
            { name: 'DSH Plugins', goal: 'Ship good DSH plugins', workspacePath: '/work/dsh', coordinatorEffort: 'max' },
            { name: 'Storefront', workspacePath: '/work/shop' },
        ],
    });
    await tick();
    const coord = coordinatorOf(host);
    const shop = [...host.live.values()].find((a) => host.sessions.get(a.id).title === '◆ Storefront');
    const say = userTyping(host);
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');
    const store = () => JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects;
    // Chats outside any project, as DSH lists them; two share a title.
    host.sessions.set('chat-login', { events: [], prompts: [], title: 'Fix login', cwd: '/work/dsh' });
    host.sessions.set('chat-notes-a', { events: [], prompts: [], title: 'Notes', cwd: '/work/a' });
    host.sessions.set('chat-notes-b', { events: [], prompts: [], title: 'Notes', cwd: '/work/b' });
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Chat', brief: 'Help the user.' });
    await shop.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Checkout', brief: 'Fix checkout.' });
    const asked = 'Tell the Fix login chat that the tests pass on main.';
    const send = (args) => coord.ctx.call('project_message', { to: 'Fix login', ask: asked, text: 'The tests pass on main.', ...args });

    // Only in a turn the user started, with the user's own words.
    assert.equal(await send(), 'Failed: a message goes out of the project only in a turn the user started. Tell the user what came in, and send it when they ask');
    await say(coord, `${asked} Thanks!`);
    assert.equal(await send({ ask: 'tell fix login the tests pass' }), 'Failed: ask must be the user\'s own words, copied from their message here');
    assert.match(log(), /guard dsh-plugins message-not-asked\n[^]*guard dsh-plugins message-unsaid\n/);
    // Who it can reach: not itself or its own threads, not another project's thread, and one chat per name.
    assert.equal(await send({ to: '◆ DSH Plugins' }), 'Failed: that is this project: you are its coordinator');
    assert.equal(await send({ to: 'Chat' }), 'Failed: that is this project\'s thread t1: use project_thread_send');
    assert.equal(await send({ to: 'Checkout' }), 'Failed: that is a thread of ◆ Storefront, and a thread stays with its project. Send it to ◆ Storefront instead');
    assert.equal(await send({ to: 'Notes' }), 'Failed: 2 chats are called "Notes": chat-notes-a (in /work/a); chat-notes-b (in /work/b). Put the id of the one the user means in to, or ask the user');
    assert.equal(await send({ to: 'Fix logins' }), 'Failed: no chat or project here is called "Fix logins". Other projects: ◆ Storefront. Recent chats: "Fix login", "Notes", "Notes". Put one of these in to as it is written, or ask the user which chat they mean');
    // A chat outside a project has all of the user's tools, so the message may name one only when the user's words do.
    assert.match(await send({ text: 'Then check lane-catalog.' }), /^Failed: this would use lane-catalog, and the user's words do not ask for it\. .*If the user did ask, put their words in ask\. /);
    assert.equal(host.sessions.get('chat-login').prompts.length, 0, 'nothing was sent');

    assert.equal(await send(), 'Sent to "Fix login". Its reply comes back to you once, as a note.');
    const chat = host.live.get('chat-login');
    const sent = host.sessions.get('chat-login').prompts;
    assert.deepEqual(sent.map((p) => p.mode), ['queue']);
    assert.equal(sent[0].text, outsideMessage('DSH Plugins', asked, 'The tests pass on main.'));
    assert.match(sent[0].text, /^\[Message from the coordinator of "DSH Plugins"\]\n\nThe user asked: "Tell the Fix login chat that the tests pass on main\."\n\nThe tests pass on main\.\n\n\(Sent by the coordinator of the project "DSH Plugins" at the user's request\. This chat stays outside that project\. Answer here: your reply goes back to that coordinator once\.\)$/);
    assert.deepEqual(sourceOf(host.sessions.get('chat-login'), 0), { kind: 'agent-message', form: 'relay', senderSessionId: coord.id });
    // Never adopted: no project tools, no project section, no role in the window, no place in the store.
    assert.equal(chat.ctx.registered.size, 0);
    assert.equal(chat.ctx.sections.size, 0);
    assert.equal(fold(host, 'chat-login'), null);
    assert.equal(Object.values(store()).some((p) => Object.values(p.threads ?? {}).some((t) => t.sessionId === 'chat-login')), false);
    assert.deepEqual(store()['dsh-plugins'].awaiting.map((w) => [w.to, w.name, w.from, w.after]), [['chat-login', '"Fix login"', coord.id, -1]]);
    assert.match(log(), new RegExp(`message dsh-plugins to=chat chat-login chars=23 ask-chars=${asked.length}\\n`));

    // The chat answers in its own turn; the coordinator hears it once, from that chat.
    const before = host.sessions.get(coord.id).prompts.length;
    const marks = turnMarks(host, 'chat-login');
    host.emit('agent/status', { agent: chat, status: 'running' });
    marks.start();
    assistantSays(host, 'chat-login', 'Thanks, I will rebase on main.');
    marks.end();
    host.emit('agent/status', { agent: chat, status: 'idle' });
    await tick();
    host.emit('agent/status', { agent: chat, status: 'idle' });
    await tick();
    const notes = host.sessions.get(coord.id).prompts.slice(before);
    assert.deepEqual(notes.map((p) => p.text), [replyMessage('"Fix login"', 'Thanks, I will rebase on main.')]);
    assert.match(notes[0].text, /^\[Reply from "Fix login"\]\n\nThanks, I will rebase on main\.\n\n\(The user has not seen this\. Tell them in a line or two what "Fix login" answered\. Send it nothing more unless the user asks\.\)$/);
    assert.equal(sourceOf(host.sessions.get(coord.id), before)?.senderSessionId, 'chat-login');
    assert.equal(store()['dsh-plugins'].awaiting.length, 0);
    assert.match(log(), /message-reply dsh-plugins chat-login delivered chars=30\n/);
    // A note is not the user: it can't send another message on its own.
    assert.match(await send(), /^Failed: a message goes out of the project only in a turn the user started\./);
    // The user's words don't count as theirs in the chat it reached either: the window counts it as a message from that project.
    assert.equal(fold(host, shop.id)?.asked ?? false, false);

    // Another project's coordinator, by its name. It isn't the user there, so it gives that project nothing the user didn't.
    const toShop = 'Ask Storefront whether the checkout tests pass.';
    await say(coord, toShop);
    assert.equal(await coord.ctx.call('project_message', { to: 'Storefront', ask: toShop, text: 'Do the checkout tests pass?' }), 'Sent to ◆ Storefront. Its reply comes back to you once, as a note.');
    assert.match(host.sessions.get(shop.id).prompts.at(-1).text, /^\[Message from the coordinator of "DSH Plugins"\]\n\nThe user asked: "Ask Storefront whether the checkout tests pass\."\n\nDo the checkout tests pass\?\n\n/);
    assert.equal(fold(host, shop.id)?.asked ?? false, false, 'the other project\'s window does not take it for its user\'s words');
    await say(shop, 'Hello from the shop user.');
    assert.equal(fold(host, shop.id)?.asked, true);
    // The other coordinator's turn fails: the note says so first.
    const shopTurn = turnMarks(host, shop.id);
    shopTurn.start();
    shopTurn.end('error', '500: {"message":"gateway down"}');
    host.emit('agent/status', { agent: shop, status: 'idle' });
    await tick();
    assert.equal(host.sessions.get(coord.id).prompts.at(-1).text, replyMessage('◆ Storefront', '', 'The turn failed (HTTP 500): gateway down'));
    assert.match(log(), /message-reply dsh-plugins s\d+ delivered chars=0 ended=other\n/);

    // A message whose answer comes while DSH is off is delivered at the next start, once.
    await say(coord, `${asked} Again please.`);
    assert.match(await send({ ask: `${asked} Again please.`, text: 'Main is green again.' }), /^Sent to "Fix login"\./);
    for (const dispose of host.effects.splice(0)) await dispose();
    marks.start();
    assistantSays(host, 'chat-login', 'Noted.');
    marks.end();
    const again = restart(host.sessions, config);
    await tick();
    await tick();
    const coordAgain = coordinatorOf(again);
    assert.equal(again.sessions.get(coordAgain.id).prompts.filter((p) => p.text.startsWith('[Reply from')).map((p) => p.text).join('|'), replyMessage('"Fix login"', 'Noted.'));
    assert.equal(store()['dsh-plugins'].awaiting.length, 0);
    // A message older than a day is let go at start.
    for (const dispose of again.effects.splice(0)) await dispose();
    const kept = ProjectStore.open(config.storeFile);
    kept.putProject('dsh-plugins', { awaiting: [{ to: 'chat-notes-a', name: '"Notes"', from: coordAgain.id, after: -1, at: '2026-01-01T00:00:00.000Z' }] });
    restart(again.sessions, config);
    await tick();
    assert.equal(store()['dsh-plugins'].awaiting.length, 0);
    assert.match(log(), /message-expired dsh-plugins n=1\n/);
    assert.doesNotMatch(log(), / error /);
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
    // A message from another project's coordinator, and the answer it brings back.
    assert.deepEqual(plain(noticeOf(data(outsideMessage('DSH Plugins', 'Tell Fix login.', 'Main is green.')))),
        { kind: 'message', project: 'DSH Plugins', body: 'The user asked: "Tell Fix login."\n\nMain is green.' });
    assert.deepEqual(plain(noticeOf(data(replyMessage('"Fix login"', 'Thanks.')))), { kind: 'reply', name: 'Fix login', status: '', body: 'Thanks.' });
    assert.deepEqual(plain(noticeOf(data(replyMessage('◆ Storefront', '', 'The turn failed (HTTP 500): down')))),
        { kind: 'reply', name: '◆ Storefront', status: 'failed', body: 'The turn failed (HTTP 500): down\n\nIt answered without text.' });
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
    // A summary longer than its card goes back once to be shortened (behaviour review 3); the next is taken as it is,
    // and kept for the cards cut at a sentence end, never inside a word.
    const long = { status: 'done', summary: `Fixed it. ${'Checked every file again carefully. '.repeat(20)}` };
    assert.equal(await a.ctx.call('project_handback', long), 'Failed: summary is 729 characters, and your card shows 300. Call project_handback again with at most 300: the result first, then where (paths, links), then what you need, keeping any request sent or file written outside the workspace; leave out how you got there');
    assert.equal(cp.length, 2, 'it went back to the thread');
    await a.ctx.call('project_handback', long);
    assert.equal(cp.length, 3);
    const kept = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads.t1.lastHandback.summary;
    assert.ok(kept.length <= 500 && kept.endsWith('carefully. …'), kept);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), / handback-long dsh-plugins\/t1 chars=729\n[^]* handback dsh-plugins\/t1 status=done chars=729 long delivered\n/);
    // Markdown counts as the card shows it, and the next long one goes back again.
    assert.match(await a.ctx.call('project_handback', long), /^Failed: summary is 729 characters/);
    assert.equal(await a.ctx.call('project_handback', { status: 'done', summary: `**Fixed it.**\n\n- ${'x'.repeat(285)}` }), 'Handback delivered to the coordinator.');
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

test('a thread turn cut off by DSH closing is reported at the next start, once, and the thread waits for the user', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({}, dir);
    await tick();
    const coord = coordinatorOf(first.host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Long', brief: 'Run the long job.' });
    const thread = threadOf(first.host, coord);
    thread.ctx.emitStatus(thread, 'running');
    turnMarks(first.host, thread.id).start();
    assistantSays(first.host, thread.id, 'Starting the job.');

    // DSH quits (or crashes) mid-turn; the next process reads the open turn as interrupted.
    const second = restart(first.host.sessions, first.config);
    await tick();
    // Nothing sends the thread on, as the user quit: the coordinator is told why it stopped, and its card has Resume.
    assert.deepEqual(second.sessions.get(thread.id).prompts, []);
    assert.deepEqual(second.sessions.get(coord.id).prompts.map((p) => p.text), ['[Thread idle without a handback: t1 · "Long"]\n\nThe turn was cut off because DSH closed while it ran.\n\nIts last reply:\n\nStarting the job.\n\n(Tell the user in one line, starting with [Long](.dsh-thread/t1), that its turn stopped and why; its card has Resume. Send it nothing more unless the user asks.)']);
    const log = readFileSync(join(dir, 'projects.log'), 'utf8');
    assert.match(log, / idle-note dsh-plugins\/t1 chars=17 ended=interrupted\n/);
    assert.doesNotMatch(log, / nudge dsh-plugins\/t1 /);
    assert.equal(JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads.t1.lastEnding.text, 'The turn was cut off because DSH closed while it ran.');

    const third = restart(first.host.sessions, first.config);
    await tick();
    assert.equal(third.sessions.get(coord.id).prompts.length, 0, 'reported once');
    assert.equal(third.sessions.get(thread.id).prompts.length, 0, 'not sent on');
});

test('a thread waiting on a permission prompt when DSH quits gets the cut-off note at the next start, not another approval note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const first = setup({ approvalNoticeSeconds: 0.02 }, dir);
    await tick();
    const coord = coordinatorOf(first.host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Copy', brief: 'Copy the notes outside the workspace.' });
    const thread = threadOf(first.host, coord);
    const ts = first.host.sessions.get(thread.id);
    thread.ctx.emitStatus(thread, 'running');
    turnMarks(first.host, thread.id).start();
    thread.ctx.sessionEvent({ type: 'approval/asked', data: { id: 'a1', toolName: 'write', reason: 'copies the notes outside the workspace' } });
    await new Promise((r) => setTimeout(r, 60));
    assert.match(first.host.sessions.get(coord.id).prompts.at(-1)?.text ?? '', /^\[Thread waiting for approval: t1 · "Copy"\]/);

    // DSH quits with the prompt open, closing the session under the turn.
    ts.events.push({ seq: ts.events.length + 1, type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'disposed' } } } });
    const second = restart(first.host.sessions, first.config);
    await tick();
    await new Promise((r) => setTimeout(r, 60));
    // Not sent on, so it asks for nothing again; the coordinator hears once why it stopped.
    assert.deepEqual(second.sessions.get(thread.id).prompts, []);
    assert.deepEqual(second.sessions.get(coord.id).prompts.map((p) => p.text.split('\n\n').slice(0, 3).join('\n\n')),
        ['[Thread idle without a handback: t1 · "Copy"]\n\nThe turn was cut off because its session closed while it ran.\n\nIt produced no reply text.']);
    assert.match(second.sessions.get(coord.id).prompts[0].text, /its card has Resume\. Send it nothing more unless the user asks\.\)$/);
    assert.doesNotMatch(readFileSync(join(dir, 'projects.log'), 'utf8'), / nudge dsh-plugins\/t1 /);
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

test('a permission prompt the coordinator heard about isn\'t sent again when the plugin reloads or is switched off and on', async () => {
    const { host, config, dir } = setup({ approvalNoticeSeconds: 0.02 });
    await tick();
    const coord = coordinatorOf(host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Busy', brief: 'Deploy it.' });
    const thread = threadOf(host, coord);
    thread.ctx.emitStatus(thread, 'running');
    const log = host.sessions.get(thread.id).events;
    const ask = (id, reason) => {
        const asked = { seq: log.length + 1, type: 'approval/asked', data: { id, toolName: 'bash', reason } };
        log.push(asked);
        thread.ctx.sessionEvent(asked);
    };
    const wait = () => new Promise((r) => setTimeout(r, 80));
    const cp = host.sessions.get(coord.id).prompts;
    ask('a1', 'runs ./deploy.sh');
    await wait();
    assert.equal(cp.length, 1);

    // Each new instance watches the prompt the turn still waits on, but the coordinator already heard about it:
    // another note would start another turn of the coordinator's.
    await reload(host, config);
    await wait();
    await reload(host, config);
    await wait();
    assert.equal(cp.length, 1, 'told once across two reloads');
    // A new prompt in the same turn is news.
    ask('a2', 'runs ./publish.sh');
    await wait();
    assert.equal(cp.length, 2);
    assert.match(cp[1].text, /runs \.\/publish\.sh/);
    await reload(host, config);
    await wait();
    assert.equal(cp.length, 2);
    assert.equal((readFileSync(join(dir, 'projects.log'), 'utf8').match(/approval-note /g) ?? []).length, 2);
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
    assert.deepEqual([...thread.ctx.registered.keys()].sort(), ['project_ask_coordinator', 'project_handback', 'project_memory']);
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

test('browser half: news from threads marks the ◆ row and shows one notice for the newest, until the coordinator is opened', async () => {
    const { client } = loadClient();
    const { projectFacts, NewsNotice, ThreadMark, RowPlace, newsLine, newsDot, takeKnown } = client.internals;
    takeKnown({});
    let seq = 1;
    let seen = 0;
    let items = [{ seq: 1, kind: 'handback', thread: 't1', title: 'Old news', status: 'done', at: '2026-10-11T01:00:00Z' }];
    const calls = [];
    const answer = () => ({ ok: true, value: { news: [
        { project: 'p1', name: 'Shop', coordinator: 'c1', seq, seen, unread: items.filter((i) => i.seq > seen) },
        { project: 'p2', name: 'Quiet', coordinator: 'c2', seq: 0, seen: 0, unread: [] },
    ] } });
    const link = {
        async call(method, args) {
            calls.push([method, args]);
            if (method === 'news') return answer();
            if (method === 'seeNews') { seen = args.seq; return answer(); }
            return { ok: false, error: { code: 'projects/refused', message: 'no' } };
        },
    };
    const facts = projectFacts(link);
    const closed = () => false;
    // The first read only learns where each coordinator is: what was already waiting marks the row, with no notice.
    await facts.news(closed);
    assert.equal(facts.notice(), null);
    assert.deepEqual(plain(facts.newsOf('c1').unread.map((i) => i.seq)), [1]);
    assert.equal(facts.newsOf('c2'), undefined);
    // What comes next, while the user looks elsewhere, is the notice: the newest, and how many more.
    seq = 3;
    items = [...items, { seq: 2, kind: 'finished', thread: 't2', title: 'Docs', at: '2026-10-11T01:05:00Z' },
        { seq: 3, kind: 'approval', thread: 't1', title: 'Deploy', at: '2026-10-11T01:06:00Z' }];
    await facts.news(closed);
    assert.deepEqual(plain(facts.notice()), { key: 'c1:3', coordinator: 'c1', name: 'Shop', item: items[2], more: 1 });
    // A notice the same read already showed is not shown twice; one the user dismissed stays gone.
    facts.dropNotice('c1:3');
    await facts.news(closed);
    assert.equal(facts.notice(), null);
    // With the coordinator open, news arrives in front of the user: no notice.
    seq = 4;
    items = [...items, { seq: 4, kind: 'failed', thread: 't1', title: 'Deploy', at: '2026-10-11T01:07:00Z' }];
    await facts.news((id) => id === 'c1');
    assert.equal(facts.notice(), null);

    // The row: a dot in the leading seat that says what came, and a mark the CSS reads to make the title bold.
    const state = { byId: { c1: { title: '◆ Shop', projectionValues: { projectSession: { role: 'coordinator', project: { name: 'Shop' }, threads: [] } } } } };
    const useSessions = (select) => select(state);
    const projects = { facts, refresh() {} };
    const mark = ThreadMark({ sessionId: 'c1', useSessions, projects });
    assert.equal(mark.props['data-projects-news-mark'], 4);
    assert.equal(mark.props.title, '4 new, latest: “Deploy” failed');
    assert.equal(mark.children[0].props.state, 'error');
    // The dot is drawn only; a screen reader hears the news after the title, from the row's words.
    assert.equal(mark.props['aria-hidden'], true);
    assert.equal(mark.props['aria-label'], undefined);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-unread'], 4);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-words'], 'Project, 4 new, latest: “Deploy” failed');
    // Opening the coordinator sees everything the window knew of, at once, and the plugin keeps it seen.
    await facts.seeNews('c1');
    assert.deepEqual(plain(calls.at(-1)), ['seeNews', { target: 'c1', seq: 4 }]);
    assert.equal(facts.newsOf('c1'), undefined);
    assert.equal(ThreadMark({ sessionId: 'c1', useSessions, projects }), null);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-unread'], undefined);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-words'], 'Project');
    await facts.seeNews('c1');
    assert.equal(calls.filter(([m]) => m === 'seeNews').length, 1, 'nothing unread: no call');

    // The notice is DSH's own banner, with Open; a thread waiting on the user reads as a warning, a result as done.
    seq = 5;
    items = [...items, { seq: 5, kind: 'handback', thread: 't2', title: 'Docs', status: 'done', at: '2026-10-11T01:08:00Z' }];
    await facts.news(closed);
    const opened = [];
    const toast = NewsNotice({ projects: { facts, openSession: (id) => opened.push(id) } });
    assert.equal(toast.props.text, '◆ Shop: “Docs” handed back.');
    assert.equal(toast.props.tone, 'success');
    assert.equal(toast.props.actions[0].label, 'Open');
    toast.props.actions[0].onClick();
    assert.deepEqual(opened, ['c1']);
    assert.equal(facts.notice(), null);
    assert.equal(NewsNotice({ projects: { facts } }), null);
    assert.deepEqual(['blocked', 'needs_decision', 'done'].map((status) => newsLine({ kind: 'handback', title: 'X', status })),
        ['“X” is blocked', '“X” needs a decision', '“X” handed back']);
    assert.deepEqual([[{ kind: 'handback', status: 'done' }], [{ kind: 'finished' }, { kind: 'stopped' }], [{ kind: 'approval' }, { kind: 'failed' }]].map(newsDot),
        ['done', 'warning', 'error']);
});

test('browser half: a plain chat in a project\'s workspace offers its coordinator, which opens in one click with what the user typed', () => {
    const storage = new Map();
    const { client } = loadClient({ storage });
    const { CoordinatorOffer, workspaceOfSession, projectIn, takeKnown } = client.internals;
    takeKnown({});
    const state = {
        byId: {
            c1: { title: '◆ Shop', projectionValues: { projectSession: { role: 'coordinator', project: { name: 'Shop' }, threads: [] } } },
            t1: { title: 'Fix cart', projectionValues: { projectSession: { role: 'thread', coordinator: 'c1', thread: { id: 't1' } } } },
            chat: { title: 'Smoke test' }, fresh: { title: '', blank: true }, team: { title: 'Teammate', parentId: 'chat' }, far: { title: 'Elsewhere' },
        },
    };
    const workspaces = { items: [
        { workspaceId: 'w-shop', path: '/u/shop', sessionIds: ['c1', 't1', 'chat', 'fresh', 'team'] },
        { workspaceId: 'w-notes', path: '/u/notes', sessionIds: ['far'] },
    ] };
    const listed = [{ id: 'old', name: 'Old', coordinator: null, home: 'w-notes' }, { id: 'shop', name: 'Shop', coordinator: 'c1', home: 'w-shop' }];
    assert.equal(workspaceOfSession(workspaces, 'chat'), 'w-shop');
    assert.equal(workspaceOfSession(workspaces, 'nowhere'), undefined);
    assert.equal(projectIn(listed, 'w-shop').id, 'shop');
    assert.equal(projectIn(listed, 'w-notes'), undefined, 'a project with no coordinator offers nothing');
    const opened = [];
    const cleared = [];
    const projects = {
        facts: { subscribe: () => () => {}, getSnapshot: () => 0, projects: () => listed, list: async () => {} },
        openWithDraft: (id, text) => opened.push([id, text]),
    };
    const offer = (sessionId, draft = '') => CoordinatorOffer({
        sessionId, projects, useSessions: (select) => select(state), useWorkspaces: (select) => select(workspaces),
        useInput: (select) => select({ draft }), inputActions: { setDraft: (text) => cleared.push(text) },
    });
    // A new chat, or one with messages, in the workspace where ◆ Shop works: the offer, with one button.
    for (const id of ['fresh', 'chat']) {
        const bar = offer(id);
        assert.equal(bar.props['data-projects-offer'], 'shop');
        assert.match(textIn(bar), /This folder has a project\.Its coordinator runs the work in threads\.Talk to ◆ Shop/);
    }
    // What the user typed goes with them, and leaves this chat's box.
    const button = elementsOf(offer('chat', '  run the smoke test  ')).find((el) => el.props?.['data-projects-offer-open'] === '');
    assert.match(textIn(offer('chat', 'x')), /What you typed goes with you\./);
    button.props.onClick();
    assert.deepEqual(plain(opened), [['c1', 'run the smoke test']]);
    assert.deepEqual(plain(cleared), ['']);
    elementsOf(offer('fresh')).find((el) => el.props?.['data-projects-offer-open'] === '').props.onClick();
    assert.deepEqual(plain(opened.at(-1)), ['c1', '']);
    assert.equal(cleared.length, 1, 'an empty box is left alone');
    // Not on the coordinator, its threads, a teammate DSH started under a chat, or a chat in a folder without a project.
    for (const id of ['c1', 't1', 'team', 'far']) assert.equal(offer(id), null, id);
    // Nor for an archived project, or one whose ◆ row DSH has archived before the plugin's list says so.
    assert.equal(projectIn([{ ...listed[1], archived: true }], 'w-shop'), undefined);
    assert.equal(projectIn(listed, 'w-shop', new Set(['c1'])), undefined);
    workspaces.archivedSessionIds = ['c1'];
    assert.equal(offer('chat'), null);
    delete workspaces.archivedSessionIds;
    assert.equal(offer('chat').props['data-projects-offer'], 'shop');
    // Turned off for the folder: gone there, and only there.
    storage.set('dsh-plugin-projects/offer-off', JSON.stringify(['w-shop']));
    assert.equal(offer('chat'), null);
});

// ── projects made in the window, and the store ─────────────────────────────

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

test('projects page: a new project is a coordinator in a workspace, started at once, whose threads work there too', async () => {
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

    // The profile project works in its own folder once DSH has it.
    const list = await remote.list();
    assert.deepEqual(project(list, 'dsh-plugins').workspaces.map((w) => w.id), ['ws:/work/dsh']);

    // A new project: its coordinator starts in the workspace straight away.
    const made = await remote.create('  Recipes  ', 'ws:/work/b');
    assert.equal(made.project, 'recipes');
    const coord = host.live.get(made.coordinator);
    assert.equal(host.sessions.get(made.coordinator).title, '◆ Recipes');
    assert.equal(host.sessions.get(made.coordinator).cwd, 'ws:/work/b');
    const { settings, access, ...recipes } = project(made, 'recipes');
    assert.deepEqual(recipes, {
        id: 'recipes', name: 'Recipes', source: 'page', workspace: '/work/b', home: 'ws:/work/b',
        workspaces: [{ id: 'ws:/work/b', path: '/work/b', title: 'b' }],
        coordinator: made.coordinator, live: null, permission: null, paused: false, archived: false, threads: { open: 0, resolved: 0 },
    });
    // Without a profile row, its models and access are the plugin's defaults.
    assert.deepEqual([settings.coordinatorEffort, settings.threadEffort], [{ value: null, source: 'DSH default' }, { value: 'high', source: 'plugin default' }]);
    assert.deepEqual(access, {
        yourTools: { value: 'asked', source: 'plugin default' },
        coordinatorPermission: { value: 'read-only', source: 'plugin default' },
        threadPermission: { value: 'workspace-write', source: 'plugin default' },
    });
    assert.ok(coord.ctx.registered.has('project_thread_start'), 'the coordinator gets the project tools');
    assert.match(coord.ctx.section(), /You are the coordinator of the DSH project "Recipes"\. The user talks to you here\. You run their work in threads, guide the threads while they work, and tell the user what each thread found\.\nGoal: none set yet \(the user sets it in Project settings\)\. Until then, the project is only what they ask for in this chat\.\nWorkspace: \/work\/b\n"Here", "this" and "everything" mean this workspace;[^\n]*\nYou are on Read Only:[^\n]*\n\n## Rules/);
    // A workspace can hold more than one project; names are unique ids.
    assert.equal((await remote.create('Recipes', 'ws:/work/b')).project, 'recipes-2');
    // The Projects page's order: DSH's order of each project's workspace (DSH lists the newest workspace first), then
    // the profile's order, then the order they were made in here.
    assert.equal((await remote.create('Alpha', 'ws:/work/a')).project, 'alpha');
    assert.deepEqual(host.workspaceRegistry.list().map((ws) => ws.id), ['ws:/work/dsh', 'ws:/work/a', 'ws:/work/b', 'ws:/work/c']);
    assert.deepEqual((await remote.list()).projects.map((p) => p.id), ['dsh-plugins', 'alpha', 'recipes', 'recipes-2']);
    await refused(remote.create('   ', 'ws:/work/a'), /a project needs a name/);
    await refused(remote.create('Nowhere'), /a project needs a workspace to work in/);
    await refused(remote.create('Nowhere', 'ws:/nope'), /DSH has no such workspace/);

    // A thread works in its project's workspace, whatever folder a model names, so it shows under its project.
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'In a', brief: 'Go.', folder: 'a' });
    const t1 = [...host.sessions].find(([, v]) => v.title === 'In a');
    assert.equal(t1[1].cwd, 'ws:/work/b');
    assert.equal(ProjectStore.open(raw.storeFile).projects.recipes.threads.t1.folder, undefined);

    // Renaming follows into the coordinator's title; a profile project is renamed in the profile.
    await remote.rename('recipes', 'Recipe Lab');
    assert.equal(host.sessions.get(made.coordinator).title, '◆ Recipe Lab');
    await refused(remote.rename('dsh-plugins', 'X'), /name is set in your profile/);
    // Deleting: only a project whose coordinator never started.
    await refused(remote.remove('recipes'), /has a coordinator/);
    await refused(remote.remove('dsh-plugins'), /set in your profile/);

    // After a restart: the same projects, the coordinator resumed, nothing new made.
    const sessions = host.sessions.size;
    const again = fakeHost(options);
    for (const [id, session] of host.sessions) again.sessions.set(id, session);
    again.workspaceRegistry = host.workspaceRegistry;
    plugin.apply(again, plugin.Config(raw));
    await tick();
    const after = await again.provided.get('dshPluginProjectsRemote').list();
    // In the same order.
    assert.deepEqual(after.projects.map((p) => [p.id, p.name, p.coordinator !== null, p.workspaces.map((w) => w.id)]), [
        ['dsh-plugins', 'DSH Plugins', true, ['ws:/work/dsh']],
        ['alpha', 'Alpha', true, ['ws:/work/a']],
        ['recipes', 'Recipe Lab', true, ['ws:/work/b']],
        ['recipes-2', 'Recipes', true, ['ws:/work/b']],
    ]);
    assert.equal(again.sessions.size, sessions);
    assert.match(readFileSync(raw.logFile, 'utf8'), new RegExp(`coordinator recipes ${made.coordinator} resumed`));
});

test('projects page: a project whose coordinator was deleted in DSH gets no new one unasked, and a new one when the user asks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const options = { gateway: true, workspaces: ['/work/a'] };
    const { host, raw } = setup({}, dir, options);
    await tick();
    const remote = host.provided.get('dshPluginProjectsRemote');
    const first = (await remote.create('Lab', 'ws:/work/a')).coordinator;
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
    assert.equal(again.sessions.get(second).cwd, 'ws:/work/a');
});

test('store: what an older version wrote about categories and its groups is saved exactly as the file has it, and nothing acts on it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    // The old sidebar's file, which an older version imported once: nothing reads it now.
    mkdirSync(join(home, 'fleet-shell'));
    writeFileSync(join(home, 'fleet-shell', 'state.json'), JSON.stringify({ projects: [{ id: 'p1', name: 'Old Alpha' }], projectOf: { 'ws:/work/c': 'p1' } }));
    // An older version's file: its categories, a group from before them that never got a coordinator, and its imports.
    const old = {
        version: 1,
        projects: { kitchen: { name: 'Kitchen', source: 'import', createdAt: 1, order: 0, importedFrom: 'k1' } },
        workspaceOf: { 'ws:/work/a': 'kitchen' },
        categories: {
            work: { name: 'Work', order: 0, createdAt: 2, source: 'group' },
            home: { name: 'Home', order: 1, createdAt: 3, source: 'import', importedFrom: 'h1' },
            // Even one an older version would have passed over.
            blank: { name: '  ', order: 2 },
        },
        categoryOf: { 'ws:/work/a': 'work', 'ws:/work/b': 'home' },
        imports: {
            categories: { at: 2, categories: 1, workspaces: 1 },
            fleetShell: { at: 3, file: '/old/fleet-shell/state.json', categories: 1, joined: 0, workspaces: 1, skipped: 0 },
        },
    };
    const options = { gateway: true, workspaces: ['/work/a', '/work/b', '/work/c'] };
    const kept = async (dir, file) => {
        const { host, raw } = setup({}, dir, options);
        await tick();
        const remote = host.provided.get('dshPluginProjectsRemote');
        // A group without a coordinator is not a project.
        assert.deepEqual((await remote.list()).projects.map((p) => p.id), ['dsh-plugins']);
        // Saved again and again since: the profile project's coordinator, a new project, its rename.
        await remote.create('Recipes', 'ws:/work/b');
        await remote.rename('recipes', 'Recipe Lab');
        const saved = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
        assert.deepEqual(Object.keys(saved.projects).sort(), ['dsh-plugins', 'kitchen', 'recipes']);
        assert.deepEqual(saved.projects.kitchen, file.projects.kitchen);
        // No copy of the file, nothing about categories or the old sidebar in the log, and DSH's workspace order untouched.
        assert.deepEqual(readdirSync(dir).filter((name) => name.endsWith('.json')), ['projects.json']);
        assert.doesNotMatch(readFileSync(raw.logFile, 'utf8'), /categor|fleet-shell|workspace-order/);
        assert.deepEqual(host.workspaceRegistry.moves, []);
        return saved;
    };
    await withDshHome(home, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'projects-'));
        writeFileSync(join(dir, 'projects.json'), JSON.stringify(old));
        const saved = await kept(dir, old);
        for (const key of ['workspaceOf', 'categories', 'categoryOf', 'imports']) assert.deepEqual(saved[key], old[key], key);

        // A file from before categories (an older version would have made them from its groups) is saved without any.
        const before = { version: 1, projects: old.projects, workspaceOf: old.workspaceOf };
        const dir2 = mkdtempSync(join(tmpdir(), 'projects-'));
        writeFileSync(join(dir2, 'projects.json'), JSON.stringify(before));
        const saved2 = await kept(dir2, before);
        assert.deepEqual(Object.keys(saved2), ['version', 'projects', 'workspaceOf']);
        assert.deepEqual(saved2.workspaceOf, old.workspaceOf);
    });
});

test('store: switched off and on again, the plugin reads its file anew and keeps what changed there meanwhile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'projects-'));
    const file = join(dir, 'projects.json');
    writeFileSync(file, JSON.stringify({
        version: 1, projects: {}, workspaceOf: {},
        categories: { work: { name: 'Work', order: 0, createdAt: 1, source: 'page' }, home: { name: 'Home', order: 1, createdAt: 2, source: 'page' } },
        categoryOf: { 'ws:/work/a': 'work', 'ws:/work/b': 'home' },
        imports: { categories: { at: 1, categories: 0, workspaces: 0 } },
    }));
    const options = { gateway: true, workspaces: ['/work/a', '/work/b'] };
    const { host, raw } = setup({}, dir, options);
    await tick();
    assert.ok(JSON.parse(readFileSync(file, 'utf8')).projects['dsh-plugins'].coordinatorSessionId, 'the first start saved');
    // Switched off: DSH runs the plugin's disposers.
    for (const dispose of host.effects.splice(0)) await dispose();
    // Meanwhile the file changes: a category goes, and a project setting changes.
    const onDisk = JSON.parse(readFileSync(file, 'utf8'));
    delete onDisk.categories.home;
    delete onDisk.categoryOf['ws:/work/b'];
    onDisk.projects['dsh-plugins'].settings.threadEffort = 'low';
    writeFileSync(file, JSON.stringify(onDisk));
    // Switched on again, in the same DSH.
    const again = fakeHost(options);
    for (const [id, session] of host.sessions) again.sessions.set(id, session);
    again.workspaceRegistry = host.workspaceRegistry;
    plugin.apply(again, plugin.Config(raw));
    await tick();
    const remote = again.provided.get('dshPluginProjectsRemote');
    const row = (await remote.list()).projects.find((p) => p.id === 'dsh-plugins');
    assert.deepEqual(row.settings.threadEffort, { value: 'low', source: 'project setting' }, 'the file as it is now');
    // Its next save keeps the change, and the categories exactly as the file has them.
    await remote.update('dsh-plugins', { paused: true });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual([saved.projects['dsh-plugins'].settings.threadEffort, saved.projects['dsh-plugins'].settings.paused], ['low', true]);
    for (const key of ['workspaceOf', 'categories', 'categoryOf', 'imports']) assert.deepEqual(saved[key], onDisk[key], key);
    // While it runs, a save writes them as the file has them just then, never the copy it read at start.
    const now = JSON.parse(readFileSync(file, 'utf8'));
    now.categories.later = { name: 'Later', order: 1, createdAt: 3, source: 'page' };
    writeFileSync(file, JSON.stringify(now));
    await remote.update('dsh-plugins', { paused: false });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).categories, now.categories);
});

test('store: a reload keeps one copy, so a tool call that outlives the old instance and the new one\'s writes both stay', async () => {
    const { host, config, dir } = setup();
    await tick();
    const coord = coordinatorOf(host);
    // Hold session creation, so the tool call outlives the instance that took it.
    const create = host.sessionController.create;
    let release;
    host.sessionController.create = (req) => new Promise((r) => { release = () => r(create(req)); });
    const started = coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Late', brief: 'x' });
    await tick();
    host.sessionController.create = create;
    await reload(host, config);
    await tick();
    // The new instance writes first, then the old one's call finishes.
    await coord.ctx.call('project_settings', { thread_effort: 'max' });
    release();
    assert.match(await started, /^Started t1 "Late"/);
    const saved = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'];
    assert.deepEqual([saved.settings.threadEffort, saved.threads.t1?.title], ['max', 'Late']);
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

test('changes: a thread counts its own edits (and its subagents\'), never what others changed in its folder', async () => {
    const { host, dir } = setup({}, undefined, { ...SELECTING, gateway: true });
    // DSH's workspace-changes service: a summary per turn of everything that changed in the folder, while it holds the session.
    const summaries = new Map();
    host.services.workspaceChanges = { summary: (sessionId, seq) => summaries.get(`${sessionId}/${seq}`) };
    await tick();
    const coord = coordinatorOf(host);
    const remote = host.provided.get('dshPluginProjectsRemote');
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Edit', brief: 'Go.' });
    const t1 = threadOf(host, coord);
    await coord.ctx.call('project_thread_start', { ask: 'Please do this.', title: 'Wait', brief: 'Go.' });
    const t2 = [...host.live.values()].find((a) => a.id !== coord.id && a.id !== t1.id);
    for (const t of [t1, t2]) host.sessions.get(t.id).folder = '/work/dsh';
    const log = (t) => host.sessions.get(t.id).events;
    const push = (t, type, data) => { const e = { seq: log(t).length + 1, type, data }; log(t).push(e); t.ctx.sessionEvent(e); return e; };
    let calls = 0;
    /** A file-tool call and its result, as DSH logs them. */
    const tool = (t, turn, name, args, meta, isError = false) => {
        const callId = `fc-${++calls}`;
        push(t, 'tool/call', { turn, callId, name, arguments: JSON.stringify(args) });
        push(t, 'tool/result', { turn, message: { role: 'tool', toolCallId: callId, isError, content: [] }, ...(meta ? { meta } : {}) });
    };
    const turn = async (t, n, body) => {
        t.ctx.emitStatus(t, 'running');
        push(t, 'turn/start', { turn: n });
        body();
        push(t, 'turn/end', { turn: n, reason: { kind: 'completed' } });
        t.ctx.emitStatus(t, 'idle');
        await tick();
    };
    // Like DSH: the announcement at the turn's end, its summary of the whole folder right after.
    const announce = (t, turn, files) => {
        const e = push(t, 'workspace/changes', { turn });
        summaries.set(`${t.id}/${e.seq}`, { turn, cwd: '/work/dsh', files, total: files.length, added: files.reduce((n, f) => n + f.added, 0), deleted: files.reduce((n, f) => n + f.deleted, 0) });
        return e.seq;
    };
    assert.equal((await remote.describe(coord.id)).threads[0].changes, null, 'nothing changed yet');
    // t1 writes a new file and edits another; meanwhile t2 only waits, and DSH credits both turns with every file.
    const whole = [{ path: '/work/dsh/a.md', display: 'a.md', added: 3, deleted: 0 }, { path: '/work/dsh/b.js', display: 'b.js', added: 1, deleted: 1 }, { path: '/work/dsh/c.txt', display: 'c.txt', added: 5, deleted: 0 }];
    await turn(t1, 1, () => {
        tool(t1, 1, 'write', { file_path: '/work/dsh/a.md', content: 'one\ntwo\nthree\n' }, { operation: 'create', path: '/work/dsh/a.md', diffs: [] });
        tool(t1, 1, 'edit', { file_path: 'b.js', old_string: 'x = 1', new_string: 'x = 2' }, { path: 'b.js', diffs: [{ path: 'b.js', oldText: 'a\nx = 1\nb', newText: 'a\nx = 2\nb' }] });
        // A failed call changed nothing.
        tool(t1, 1, 'edit', { file_path: 'missing.js', old_string: 'q', new_string: 'r' }, undefined, true);
    });
    const seq1 = announce(t1, 1, whole);
    await turn(t2, 1, () => tool(t2, 1, 'bash', { command: 'sleep 6' }, { cwd: '/work/dsh' }));
    announce(t2, 1, whole);
    await tick();
    let read = await remote.describe(coord.id);
    const of = (t) => read.threads.find((x) => x.session === t.id)?.changes ?? null;
    assert.deepEqual(plain(of(t1)), { added: 4, deleted: 1, files: 2, turns: 1, last: { seq: seq1, turn: 1 }, reviewable: true });
    assert.equal(of(t2), null, 'the thread that only waited changed nothing, whatever DSH says of its folder');
    assert.deepEqual(plain(host.store?.thread?.('dsh-plugins', 't1')?.changes ?? JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'].threads.t1.changes), [
        { turn: 1, seq: seq1, added: 4, deleted: 1, total: 2, files: [{ path: 'a.md', added: 3, deleted: 0 }, { path: 'b.js', added: 1, deleted: 1 }] },
    ]);
    // Another turn edits a.md again (str_replace_editor), and t1's subagent creates c.txt: lines add up, a.md counts once.
    await turn(t1, 2, () => {
        tool(t1, 2, 'str_replace_editor', { command: 'str_replace', path: 'a.md', old_str: 'two', new_str: 'TWO\nand a half' }, undefined);
        const sub = { id: 'sub-1', header: { parentSession: t1.id, origin: 'subagent' } };
        host.emit('session/event', sub, { seq: 3, type: 'tool/call', data: { turn: 1, callId: 'sc-1', name: 'write', arguments: { file_path: '/work/dsh/c.txt', content: 'c\n' } } });
        host.emit('session/event', sub, { seq: 4, type: 'tool/result', data: { turn: 1, message: { toolCallId: 'sc-1' }, meta: { operation: 'create', path: '/work/dsh/c.txt', diffs: [] } } });
        // A chat's own edit, in no thread, is nobody's here.
        host.emit('session/event', { id: 'chat-1', header: {} }, { seq: 5, type: 'tool/call', data: { turn: 1, callId: 'cc-1', name: 'write', arguments: { file_path: '/work/dsh/d.txt', content: 'd\n' } } });
        host.emit('session/event', { id: 'chat-1', header: {} }, { seq: 6, type: 'tool/result', data: { turn: 1, message: { toolCallId: 'cc-1' }, meta: { operation: 'create', diffs: [] } } });
    });
    const seq2 = announce(t1, 2, whole);
    await tick();
    read = await remote.describe(t1.id);
    assert.deepEqual(plain(of(t1)), { added: 7, deleted: 2, files: 3, turns: 2, last: { seq: seq2, turn: 2 }, reviewable: true });
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /changes dsh-plugins\/t1 turn=2 files=2 \+3 -1 subagents=1/);
    // The coordinator hears it in its roster and in project_thread_list.
    assert.match(coord.ctx.section(), /- t1 · "Edit" · idle · no handback yet · changed 3 files \(\+7 -2\)/);
    assert.match(await coord.ctx.call('project_thread_list', {}), /changed 3 files \(\+7 -2\)/);
    // DSH drops its copy when it restarts: the totals stay, and Review is no longer offered.
    summaries.clear();
    read = await remote.describe(coord.id);
    assert.deepEqual(plain(of(t1)), { added: 7, deleted: 2, files: 3, turns: 2, last: { seq: seq2, turn: 2 }, reviewable: false });
    // A turn DSH never announces (it saw nothing change in the folder) keeps its own edits after a wait, under its end.
    remote.manager.announceWaitMs = 20;
    await turn(t1, 3, () => tool(t1, 3, 'write', { file_path: '/elsewhere/notes.md', content: 'n\n' }, { operation: 'create', path: '/elsewhere/notes.md', diffs: [] }));
    assert.equal((await remote.describe(coord.id)).threads.find((x) => x.session === t1.id).changes.turns, 2, 'waiting for DSH');
    await new Promise((r) => setTimeout(r, 60));
    read = await remote.describe(coord.id);
    const endOf3 = log(t1).findLast((e) => e.type === 'turn/end').seq;
    assert.deepEqual(plain(of(t1)), { added: 8, deleted: 2, files: 4, turns: 3, last: { seq: endOf3, turn: 3 }, reviewable: false });
    // A DSH without the service: an announcement changes nothing and throws nothing.
    delete host.services.workspaceChanges;
    push(t1, 'workspace/changes', { turn: 2 });
    await tick();
    assert.equal((await remote.describe(coord.id)).threads.find((x) => x.session === t1.id).changes.turns, 3);
    // A thread from before the plugin counted its own edits kept DSH's folder-wide numbers: counted again from its log, once.
    const manager = remote.manager;
    manager.store.putThread('dsh-plugins', 't2', { changes: [{ turn: 1, seq: 9, added: 9, deleted: 1, total: 3, files: [{ path: 'a.md', added: 3, deleted: 0 }] }], ownCounts: undefined });
    manager.store.putThread('dsh-plugins', 't1', { ownCounts: undefined });
    await manager.recountChanges();
    assert.equal(manager.store.thread('dsh-plugins', 't2').changes.length, 0);
    assert.equal(manager.store.thread('dsh-plugins', 't2').ownCounts, true);
    // Its own log has t1's edits but not its subagent's, which drop out.
    assert.deepEqual(plain(manager.store.thread('dsh-plugins', 't1').changes.map((r) => [r.turn, r.added, r.deleted, r.files.map((f) => f.path).join(',')]).sort((a, b) => a[0] - b[0])),
        [[1, 4, 1, 'a.md,b.js'], [2, 2, 1, 'a.md'], [3, 1, 0, '/elsewhere/notes.md']]);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /changes recounted dsh-plugins\/t2 turns=0 was=1/);
    await manager.recountChanges();
    assert.equal((readFileSync(join(dir, 'projects.log'), 'utf8').match(/changes recounted/g) ?? []).length, 2, 'once per thread');
});

test('changes: own edits count lines as a diff does', () => {
    const L = (text) => text.split('\n');
    assert.deepEqual(lineDelta(L('one\ntwo\nthree'), L('one\nTWO\nthree')), { added: 1, deleted: 1 });
    // Two changes in one hunk keep the lines between them.
    assert.deepEqual(lineDelta(L('a\nb\nc\nd\ne\nf\ng'), L('a\nB\nc\nd\ne\nF\ng')), { added: 2, deleted: 2 });
    assert.deepEqual(lineDelta([], L('x\ny')), { added: 2, deleted: 0 });
    assert.deepEqual(lineDelta(L('x\ny'), []), { added: 0, deleted: 2 });
    assert.deepEqual(editOf('write', { file_path: 'n.md', content: 'one\ntwo\n' }, { operation: 'create', diffs: [] }), { path: 'n.md', added: 2, deleted: 0, created: true });
    assert.deepEqual(editOf('write', { file_path: 'e.md', content: '' }, { operation: 'create', diffs: [] }), { path: 'e.md', added: 0, deleted: 0, created: true });
    assert.deepEqual(editOf('write', { file_path: 'n.md', content: 'x' }, { operation: 'update', diffs: [{ path: 'n.md', oldText: 'one\ntwo', newText: 'x' }] }), { path: 'n.md', added: 1, deleted: 2 });
    // A pure insertion's hunk has no old side.
    assert.deepEqual(editOf('edit', { file_path: 'i.md' }, { diffs: [{ path: 'i.md', oldText: null, newText: 'new line' }] }), { path: 'i.md', added: 1, deleted: 0 });
    assert.deepEqual(editOf('str_replace_editor', { command: 'insert', path: 's.md', insert_line: 2, new_str: 'p\nq\n' }), { path: 's.md', added: 2, deleted: 0 });
    assert.deepEqual(editOf('str_replace_editor', { command: 'create', path: 's.md', file_text: 'p\n' }), { path: 's.md', added: 1, deleted: 0, created: true });
    assert.equal(editOf('str_replace_editor', { command: 'view', path: 's.md' }), null);
    assert.equal(editOf('read', { file_path: 'r.md' }, {}), null);
    assert.equal(editOf('edit', {}, { diffs: [] }), null, 'no path');
    // A summary names each file once, inside the folder relative to it.
    assert.deepEqual(plain(editSummary(4, [{ path: '/w/a.md', added: 2, deleted: 0 }, { path: './a.md', added: 1, deleted: 1 }, { path: '/elsewhere/b.md', added: 1, deleted: 0 }], '/w/')),
        { turn: 4, files: [{ path: 'a.md', added: 3, deleted: 1 }, { path: '/elsewhere/b.md', added: 1, deleted: 0 }], total: 2, added: 4, deleted: 1 });
    assert.equal(editSummary(1, []), null);
    // Records in order: a result counts only after its call, and a forked log's inherited part is skipped by the caller.
    assert.deepEqual(plain(editsIn([
        { seq: 1, type: 'tool/result', data: { turn: 1, message: { toolCallId: 'early' }, meta: { operation: 'create', diffs: [] } } },
        { seq: 2, type: 'tool/call', data: { turn: 1, callId: 'w', name: 'write', arguments: { file_path: 'w.md', content: 'w\n' } } },
        { seq: 3, type: 'tool/result', data: { turn: 1, message: { toolCallId: 'w' }, meta: { operation: 'create', diffs: [] } } },
    ])), [{ turn: 1, seq: 3, path: 'w.md', added: 1, deleted: 0, created: true }]);
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
    c = def.apply(c, idle(4, 'The turn was cut off because DSH closed while it ran.'));
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

// ── archive: a project goes, and comes back, with its coordinator and threads ──

/** A project with its coordinator and two threads, Alpha and Beta, and the window's endpoints. */
async function projectWithThreads() {
    const made = setup({}, undefined, { gateway: true });
    await tick();
    const coord = coordinatorOf(made.host);
    await coord.ctx.call('project_thread_start', { ask: 'Please do A.', title: 'Alpha', brief: 'Do A.' });
    await coord.ctx.call('project_thread_start', { ask: 'Please do B.', title: 'Beta', brief: 'Do B.' });
    const [alpha, beta] = [...made.host.live.values()].filter((a) => a.id !== coord.id);
    return { ...made, coord, alpha, beta, registry: made.host.workspaceRegistry, remote: made.host.provided.get('dshPluginProjectsRemote') };
}
const settle = async () => { for (let i = 0; i < 5; i += 1) await tick(); };
const storedIn = (dir) => JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8')).projects['dsh-plugins'];
/** Switch the plugin off: its manager stops, and its store is read anew by the next one. */
async function switchOff(host) {
    for (const dispose of host.effects.splice(0)) await dispose();
}
/** A new Host process over the same session logs, with DSH's archive set as given, and the plugin on it. */
async function startOver(old, config, archived) {
    const host = fakeHost({ gateway: true });
    for (const [id, s] of old.sessions) host.sessions.set(id, { ...s, prompts: [] });
    for (const id of archived) await host.workspaceRegistry.archiveSession(id, { stopActivity: true });
    host.workspaceRegistry.archives.splice(0);
    plugin.apply(host, config);
    await settle();
    return host;
}

test('archiving a project stops and archives its coordinator and threads, and Restore brings them all back', async () => {
    const { host, dir, coord, alpha, beta, registry, remote } = await projectWithThreads();
    const turn = turnMarks(host, beta.id);
    beta.ctx.emitStatus(beta, 'running');
    turn.start();
    const sent = host.sessions.get(coord.id).prompts.length;

    const answer = await remote.archive(coord.id);
    assert.equal(answer.archived, 3);
    // The coordinator first, so it starts nothing more, then each thread; what runs stops.
    assert.deepEqual(registry.archives, [[coord.id, true], [alpha.id, true], [beta.id, true]]);
    assert.equal(beta.status, 'idle');
    assert.equal(answer.projects.find((p) => p.id === 'dsh-plugins').archived, true);
    assert.equal((await remote.describe('dsh-plugins')).project.archived, true);
    assert.deepEqual(storedIn(dir).archived.sessions, [coord.id, alpha.id, beta.id]);
    assert.equal(storedIn(dir).archived.via, 'window');
    await settle();
    assert.equal(host.sessions.get(coord.id).prompts.length, sent, 'the stop it made sends the coordinator nothing');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /archive dsh-plugins via=window sessions=3\n[^]*archived-turn dsh-plugins\/t2/);

    // Archived: nothing new starts, what a thread sends waits, and the window has no news of it.
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'More.', title: 'Gamma', brief: 'Do C.' }), /^Failed: the project is archived; restore it first/);
    assert.match(await alpha.ctx.call('project_handback', { status: 'done', summary: 'A is done.' }), /coordinator gets it when the project resumes/);
    assert.equal(host.sessions.get(coord.id).prompts.length, sent);
    assert.deepEqual((await remote.news()).news.map((n) => n.project), []);
    assert.deepEqual((await remote.archive('dsh-plugins')).archived, 0, 'archiving again changes nothing');

    const back = await remote.restore('dsh-plugins');
    assert.equal(back.restored, 3);
    assert.deepEqual(registry.archivedSessionIds, []);
    assert.equal(back.projects.find((p) => p.id === 'dsh-plugins').archived, false);
    assert.equal(storedIn(dir).archived, undefined);
    await settle();
    // What waited for the coordinator reaches it now.
    const prompts = host.sessions.get(coord.id).prompts;
    assert.equal(prompts.length, sent + 1);
    assert.match(prompts.at(-1).text, /Handback from thread t1[^]*A is done\./);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /restore dsh-plugins via=window sessions=3/);
    assert.match(await coord.ctx.call('project_thread_start', { ask: 'More.', title: 'Gamma', brief: 'Do C.' }), /t3/);
});

test('another project\'s coordinator can\'t message an archived project: it would wake its coordinator', async () => {
    const { host } = setup({ projects: [
        { name: 'DSH Plugins', workspacePath: '/work/dsh' },
        { name: 'Storefront', workspacePath: '/work/shop' },
    ] }, undefined, { gateway: true });
    await tick();
    const coord = coordinatorOf(host);
    const shop = [...host.live.values()].find((a) => host.sessions.get(a.id).title === '◆ Storefront');
    const remote = host.provided.get('dshPluginProjectsRemote');
    await remote.archive(shop.id);
    const sent = host.sessions.get(shop.id).prompts.length;
    const ask = 'Ask Storefront whether the checkout tests pass.';
    await userTyping(host)(coord, ask);
    assert.equal(await coord.ctx.call('project_message', { to: 'Storefront', ask, text: 'Do they pass?' }),
        'Failed: ◆ Storefront is archived; the user can bring it back with Restore project in its ◆ row\'s menu');
    assert.equal(host.sessions.get(shop.id).prompts.length, sent);
    await remote.restore(shop.id);
    assert.match(await coord.ctx.call('project_message', { to: 'Storefront', ask, text: 'Do they pass?' }), /^Sent to ◆ Storefront\./);
});

test('DSH\'s own Archive on the ◆ row takes the threads with it, and asks first while one runs', async () => {
    const { host, dir, coord, alpha, beta, registry } = await projectWithThreads();
    beta.ctx.emitStatus(beta, 'running');
    turnMarks(host, beta.id).start();

    // Archived without stopping: DSH asks the user first, and names the running thread.
    await assert.rejects(registry.archiveSession(coord.id), (error) => {
        assert.equal(error.name, 'WorkspaceActiveSessionError');
        assert.deepEqual(error.activity, [{ kind: 'project threads', items: [{ id: beta.id, label: 'Beta' }] }]);
        return true;
    });
    assert.deepEqual(registry.archivedSessionIds, []);
    // A thread's own archive asks nothing about the project, and leaves it alone.
    await registry.archiveSession(alpha.id);
    await settle();
    assert.equal(storedIn(dir).archived, undefined);
    await registry.unarchiveSession(alpha.id);

    // The user confirms: DSH stops and archives the coordinator, and the plugin takes the threads.
    await registry.archiveSession(coord.id, { stopActivity: true });
    await settle();
    assert.deepEqual(new Set(registry.archivedSessionIds), new Set([coord.id, alpha.id, beta.id]));
    assert.equal(beta.status, 'idle');
    assert.equal(storedIn(dir).archived.via, 'dsh');

    // Unarchive on the ◆ row (or Undo on DSH's notice) brings them all back.
    await registry.unarchiveSession(coord.id);
    await settle();
    assert.deepEqual(registry.archivedSessionIds, []);
    assert.equal(storedIn(dir).archived, undefined);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /archive dsh-plugins via=dsh sessions=2\n[^]*restore dsh-plugins via=dsh sessions=2/);
    // Idle, a coordinator is archived without asking.
    beta.ctx.emitStatus(beta, 'idle');
    await registry.archiveSession(coord.id);
    await settle();
    assert.equal(registry.archivedSessionIds.length, 3);
});

test('a start matches what DSH archived meanwhile, and finishes an archive made by hand in the file', async () => {
    const { host, config, dir, coord, alpha, beta } = await projectWithThreads();
    await switchOff(host);

    // While the plugin was off, DSH archived the ◆ row: its threads follow at the start, and no coordinator is made.
    let next = await startOver(host, config, [coord.id]);
    assert.deepEqual(new Set(next.workspaceRegistry.archivedSessionIds), new Set([coord.id, alpha.id, beta.id]));
    assert.equal(storedIn(dir).archived.via, 'start');
    assert.equal(next.sessions.size, host.sessions.size);
    assert.equal(next.live.size, 0, 'nothing of an archived project is woken');
    await switchOff(next);

    // A thread the user unarchived on its own stays out.
    next = await startOver(host, config, [coord.id, beta.id]);
    assert.deepEqual(next.workspaceRegistry.archives, []);
    assert.equal(storedIn(dir).archived.via, 'start');
    await switchOff(next);

    // DSH unarchived the ◆ row meanwhile: the project comes back with its threads, and its coordinator resumes.
    next = await startOver(host, config, [alpha.id, beta.id]);
    assert.deepEqual(next.workspaceRegistry.archivedSessionIds, []);
    assert.equal(storedIn(dir).archived, undefined);
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), new RegExp(`restore dsh-plugins via=start sessions=2\\n[^]*coordinator dsh-plugins ${coord.id} resumed`));
    await switchOff(next);

    // Archived by hand in the file, with DSH closed: the start archives the sessions in DSH and keeps how it was made.
    const file = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
    file.projects['dsh-plugins'].archived = { at: '2026-10-11T04:23:47.000Z', via: 'hand' };
    writeFileSync(join(dir, 'projects.json'), JSON.stringify(file));
    next = await startOver(host, config, []);
    assert.deepEqual(next.workspaceRegistry.archives, [[coord.id, true], [alpha.id, true], [beta.id, true]]);
    assert.deepEqual(storedIn(dir).archived, { at: '2026-10-11T04:23:47.000Z', via: 'hand', sessions: [coord.id, alpha.id, beta.id] });
    assert.equal((await next.provided.get('dshPluginProjectsRemote').list()).projects[0].archived, true);
});

test('a start archives nothing for a coordinator DSH had archived before the plugin looked, or has no session for', async () => {
    const { host, config, dir, coord, alpha, beta } = await projectWithThreads();
    assert.deepEqual(storedIn(dir).dshArchive, { coordinator: coord.id, archived: false }, 'a new coordinator is noted unarchived');
    await switchOff(host);
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');

    // A store from before the plugin noted DSH's archive (or a DSH home copied from another): the ◆ row is archived
    // in DSH, but nothing says that happened while the plugin was off, so the project stays as it is.
    const file = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
    delete file.projects['dsh-plugins'].dshArchive;
    writeFileSync(join(dir, 'projects.json'), JSON.stringify(file));
    let next = await startOver(host, config, [coord.id, alpha.id]);
    assert.deepEqual(next.workspaceRegistry.archives, []);
    assert.equal(storedIn(dir).archived, undefined);
    assert.deepEqual(storedIn(dir).dshArchive, { coordinator: coord.id, archived: true });
    assert.doesNotMatch(log(), /archive dsh-plugins via=start/);
    await switchOff(next);
    // Still so at the next start: no change, nothing to do.
    next = await startOver(host, config, [coord.id, alpha.id]);
    assert.deepEqual(next.workspaceRegistry.archives, []);
    assert.equal(storedIn(dir).archived, undefined);
    await switchOff(next);
    // Unarchived in DSH meanwhile: only noted. Then archived in DSH while the plugin was off: its threads go too.
    next = await startOver(host, config, [alpha.id]);
    assert.deepEqual(storedIn(dir).dshArchive, { coordinator: coord.id, archived: false });
    await switchOff(next);
    next = await startOver(host, config, [coord.id, alpha.id]);
    assert.deepEqual(next.workspaceRegistry.archives, [[beta.id, true]]);
    assert.equal(storedIn(dir).archived.via, 'start');
    assert.deepEqual(storedIn(dir).archived.sessions, [coord.id, alpha.id, beta.id]);
    await switchOff(next);

    // Archived by hand in the file while DSH already has every session archived: nothing to archive, and the mark
    // now lists them, so a later start knows them as the archive's own.
    const marked = JSON.parse(readFileSync(join(dir, 'projects.json'), 'utf8'));
    marked.projects['dsh-plugins'].archived = { at: '2026-10-11T04:23:47.000Z', via: 'hand' };
    writeFileSync(join(dir, 'projects.json'), JSON.stringify(marked));
    next = await startOver(host, config, [coord.id, alpha.id, beta.id]);
    assert.deepEqual(next.workspaceRegistry.archives, []);
    assert.deepEqual(storedIn(dir).archived, { at: '2026-10-11T04:23:47.000Z', via: 'hand', sessions: [coord.id, alpha.id, beta.id] });
    assert.match(log(), /archive dsh-plugins via=start sessions=0\n/);
    await switchOff(next);
    // And DSH unarchiving its ◆ row meanwhile brings the project back.
    next = await startOver(host, config, [alpha.id, beta.id]);
    assert.equal(storedIn(dir).archived, undefined);
    assert.deepEqual(next.workspaceRegistry.archivedSessionIds, []);
});

test('a start archives nothing for a coordinator DSH has no session for, though its archive names it', async () => {
    const { host, config, dir, coord } = await projectWithThreads();
    await switchOff(host);
    // A DSH home copied from another: its archive set names the coordinator, but DSH holds no such session.
    const copied = fakeHost({ gateway: true });
    for (const [id, s] of host.sessions) copied.sessions.set(id, { ...s, prompts: [] });
    await copied.workspaceRegistry.archiveSession(coord.id, { stopActivity: true });
    copied.workspaceRegistry.archives.splice(0);
    copied.sessions.delete(coord.id);
    plugin.apply(copied, config);
    await settle();
    assert.deepEqual(copied.workspaceRegistry.archives, []);
    assert.equal(storedIn(dir).archived, undefined);
    assert.doesNotMatch(readFileSync(join(dir, 'projects.log'), 'utf8'), /archive dsh-plugins via=start/);
});

test('archiving refuses what DSH refuses, and a session DSH no longer has counts as gone', async () => {
    const { host, dir, coord, alpha, registry, remote } = await projectWithThreads();
    host.sessions.delete(alpha.id);
    const real = registry.archiveSession;
    registry.archiveSession = async (id, options) => {
        if (id === coord.id) throw new Error('disk full');
        return real.call(registry, id, options);
    };
    await assert.rejects(remote.archive('dsh-plugins'), { code: 'projects/refused', message: /didn't archive 1 of ◆ DSH Plugins's sessions; try again/ });
    assert.ok(!storedIn(dir).archived.sessions.includes(coord.id));
    assert.ok(storedIn(dir).archived.sessions.includes(alpha.id), 'gone from DSH: nothing to archive');
    registry.archiveSession = real;
    assert.equal((await remote.archive('dsh-plugins')).archived, 1, 'trying again archives what was left');
    assert.match(readFileSync(join(dir, 'projects.log'), 'utf8'), /error archive dsh-plugins s1 disk full/);
});

test('browser half: an archived project leaves the Projects page, and its ◆ row\'s menu archives it or brings it back', async () => {
    const { client, react } = loadClient();
    const { pageModel, takeKnown, archiveFlow, ArchiveMenuItem, ArchiveConfirm, ArchiveOverlay, ARCHIVE } = client.internals;
    takeKnown({});
    const value = (v) => ({ values: { projectSession: v } });
    const sessions = {
        byId: { c: { id: 'c', title: '◆ Storefront' }, t1: { id: 't1', title: 'Fix cart' }, d: { id: 'd', title: '◆ Data' }, x: { id: 'x', title: 'A chat' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', session: 't1' }] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            d: value({ role: 'coordinator', project: { id: 'data', name: 'Data' }, threads: [] }),
        },
    };
    const items = [{ workspaceId: 'w', title: 'w', path: '/w', sessionIds: ['c', 't1', 'd', 'x'] }];
    const listed = [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w' }, { id: 'data', name: 'Data', coordinator: 'd', home: 'w' }];
    const titles = (tree) => plain(tree.map((n) => n.title));
    assert.deepEqual(titles(pageModel({ listed, items, sessions, archived: new Set() })), ['Storefront', 'Data']);
    // Archived by the plugin, or its ◆ row archived in DSH (the plugin follows): off the page, threads and all.
    assert.deepEqual(titles(pageModel({ listed: [{ ...listed[0], archived: true }, listed[1]], items, sessions, archived: new Set() })), ['Data']);
    assert.deepEqual(titles(pageModel({ listed, items, sessions, archived: new Set(['d']) })), ['Storefront']);

    const calls = [];
    let answer = { ok: true, value: { projects: [] } };
    const facts = {
        info: () => ({ project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', title: 'Fix cart', session: 't1' }, { id: 't2', title: 'Old copy', session: 't2' }] }),
        describe: async () => {}, subscribe: () => () => {}, getSnapshot: () => 0,
        archive: async (target, restore) => { calls.push([target, restore === true]); return answer; },
    };
    const flow = archiveFlow();
    flow.connect();
    const closed = [];
    const item = (sessionId, archived = []) => ArchiveMenuItem({
        sessionId, useMenuOpenState: () => [true, (open) => closed.push(open)], useSessions: (select) => select(sessions),
        useWorkspaces: (select) => select({ archivedSessionIds: archived }), flow, facts,
    });
    // Only on a ◆ row: a thread or a chat has none.
    assert.equal(item('t1'), null);
    assert.equal(item('x'), null);
    const archiveItem = item('c');
    assert.equal(textIn(archiveItem), ARCHIVE.item);
    assert.equal(archiveItem.props.icon.type, 'IconArchiveOutlineRegular');
    archiveItem.props.onSelect();
    assert.deepEqual(closed, [false]);
    assert.equal(flow.getSnapshot().target, 'c');

    // It asks first: what goes, what runs now and stops, and how to bring it back.
    const statuses = new Map([['t1', { running: true }]]);
    const draw = mount(react, () => ArchiveConfirm({ target: 'c', flow, facts, useSessionStatus: (select) => select(statuses) }));
    let modal = draw();
    assert.equal(modal.props.title, 'Archive ◆ Storefront?');
    assert.equal(modal.props.description, 'Its coordinator and its 2 threads leave the session list and the Projects page, and whatever runs in them stops first. Nothing is deleted.');
    assert.match(textIn(modal.children), /^Running now: Fix cart\.To bring them back, show archived chats in the session list and choose Restore project in the ◆ row's menu\.$/);
    const confirmOf = (m) => elementsOf(m.props.footer).find((e) => e.props?.['data-projects-archive-confirm'] === '');
    // DSH refuses part of it: the dialog stays, and says so.
    answer = { ok: false, error: { code: 'projects/refused', message: 'DSH didn\'t archive 1 of ◆ Storefront\'s sessions; try again' } };
    confirmOf(modal).props.onClick();
    await tick();
    modal = draw();
    assert.equal(byClass(modal.children, 'dshp-ar-error')[0].props.role, 'alert');
    assert.equal(textIn(byClass(modal.children, 'dshp-ar-error')), 'DSH didn\'t archive 1 of ◆ Storefront\'s sessions; try again.');
    assert.equal(flow.getSnapshot().target, 'c');
    answer = { ok: true, value: { projects: [] } };
    confirmOf(modal).props.onClick();
    await tick();
    assert.deepEqual(calls, [['c', false], ['c', false]]);
    // Back, it says how many threads came with it, as the plugin lists them.
    facts.projects = () => [{ id: 'storefront', coordinator: 'c', threads: { open: 1, resolved: 1 } }];
    assert.equal(flow.getSnapshot().target, null, 'archived: the dialog closes');

    // The notice says so, with Undo, which brings it all back.
    let toast = elementsOf(ArchiveOverlay({ flow, facts })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Storefront archived with its 2 threads.');
    assert.equal(toast.props.actions[0].label, 'Undo');
    toast.props.actions[0].onClick();
    await tick();
    assert.deepEqual(calls.at(-1), ['c', true]);
    toast = elementsOf(ArchiveOverlay({ flow, facts })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Storefront is back with its 2 threads.');
    assert.deepEqual(plain(toast.props.actions), []);

    // Shown with DSH's archived chats, the ◆ row's menu restores it.
    const restoreItem = item('c', ['c']);
    assert.equal(textIn(restoreItem), ARCHIVE.restore);
    assert.equal(restoreItem.props.icon.type, 'IconUnarchiveOutlineRegular');
    restoreItem.props.onSelect();
    await tick();
    assert.deepEqual(calls.at(-1), ['c', true]);

    // A project with no threads: its coordinator alone, in the singular.
    const lone = { ...facts, info: () => ({ project: { id: 'data', name: 'Data' }, threads: [] }), projects: () => [{ id: 'data', coordinator: 'd', threads: { open: 0, resolved: 0 } }] };
    const one = mount(react, () => ArchiveConfirm({ target: 'd', flow, facts: lone, useSessionStatus: (select) => select(new Map()) }))();
    assert.equal(one.props.title, 'Archive ◆ Data?');
    assert.equal(one.props.description, 'Its coordinator leaves the session list and the Projects page, and whatever runs in it stops first. Nothing is deleted.');
    assert.equal(textIn(one.children), 'To bring it back, show archived chats in the session list and choose Restore project in the ◆ row\'s menu.');
    elementsOf(one.props.footer).find((e) => e.props?.['data-projects-archive-confirm'] === '').props.onClick();
    await tick();
    toast = elementsOf(ArchiveOverlay({ flow, facts: lone })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Data archived.');
    toast.props.actions[0].onClick();
    await tick();
    toast = elementsOf(ArchiveOverlay({ flow, facts: lone })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Data is back.');
});

test('rule 6, held: a thread\'s command that sends waits for the user in DSH\'s prompt, every time; a coordinator\'s, a subagent\'s and one that can\'t ask are refused', async () => {
    const work = mkdtempSync(join(tmpdir(), 'projects-work-'));
    writeFileSync(join(work, 'deploy.sh'), '#!/bin/sh\ncurl -fsS -X POST --data @build.json http://127.0.0.1:8787/deploy\n');
    writeFileSync(join(work, 'run.sh'), '#!/bin/sh\necho ok\n');
    writeFileSync(join(work, 'package.json'), JSON.stringify({ scripts: { build: 'tsc', release: 'npm publish' } }));
    const outside = mkdtempSync(join(tmpdir(), 'projects-outside-'));
    writeFileSync(join(outside, 'run.sh'), '#!/bin/sh\ngit push\n');
    const { host, dir } = setup({ projects: [{ name: 'DSH Plugins', goal: 'Ship good DSH plugins', workspacePath: work }] }, undefined, { presets: true });
    // DSH's approval service: a session's policy, "ask" unless a test says otherwise.
    const policies = new Map();
    host.services.approval = { effectivePolicy: (session) => policies.get(session.id) ?? 'ask' };
    await tick();
    const coord = coordinatorOf(host);
    const log = () => readFileSync(join(dir, 'projects.log'), 'utf8');
    // DSH's pre-execute stage for one call, its own checks having decided `own`.
    const gate = (agent, name, args, own = { kind: 'allow' }) => host.waterfall('tools/pre-execute', { name, arguments: args, agent, callId: `pre-${++toolCalls}` }, () => Promise.resolve(own));
    await coord.ctx.call('project_thread_start', { ask: 'Get the staging deploy working.', title: 'Deploy', brief: 'Fix deploy.sh.' });
    const t1 = [...host.live.values()].find((a) => host.sessions.get(a.id).title === 'Deploy');

    // A thread's send asks the user, saying what it sends; the same send again asks again.
    const post = { command: 'curl -sS -X POST --data @build.json http://127.0.0.1:8787/deploy', description: 'Deploy' };
    const asked = {
        kind: 'ask',
        reason: 'the command sends a POST to 127.0.0.1:8787/deploy (curl)',
        displayReason: { en: 'This command sends a POST to 127.0.0.1:8787/deploy (curl). A thread asks you before each command that sends outside the workspace.' },
    };
    assert.deepEqual(await gate(t1, 'bash', post), asked);
    assert.deepEqual(await gate(t1, 'bash', post), asked);
    // A script in the workspace by what it runs, a package script, a push.
    assert.equal((await gate(t1, 'bash', { command: 'STAGING_TOKEN=x ./deploy.sh' })).reason, 'the command runs ./deploy.sh, which sends a POST to 127.0.0.1:8787/deploy (curl)');
    assert.equal((await gate(t1, 'bash', { command: 'npm run release' })).reason, 'the command runs npm run release, which publishes (npm publish)');
    assert.equal((await gate(t1, 'bash', { command: 'git push origin main' })).reason, 'the command pushes to origin (git push)');
    // Reads run: a GET, a syntax check, a dry run, a script that doesn't send, a build.
    for (const command of ['curl -sS http://127.0.0.1:8787/deploy', 'bash -n deploy.sh', 'git push --dry-run', './run.sh', 'npm run build', 'git status']) {
        assert.deepEqual(await gate(t1, 'bash', { command }), { kind: 'allow' }, command);
    }
    // Nothing outside the workspace is read: that run.sh pushes, but only its name is seen.
    assert.deepEqual(await gate(t1, 'bash', { command: './run.sh', workdir: outside }), { kind: 'allow' });
    // Code run_code runs itself, and PowerShell.
    assert.equal((await gate(t1, 'run_code', { code: "await fetch('https://api.example.com/items', { method: 'POST', body: '{}' });" })).reason, 'the command runs code that sends a POST (run_code)');
    assert.deepEqual(await gate(t1, 'run_code', { code: "console.log(await (await fetch('https://api.example.com/items')).text());" }), { kind: 'allow' });
    assert.equal((await gate(t1, 'pwsh', { command: 'Invoke-RestMethod -Method Post -Uri https://api.example.com/items' })).kind, 'ask');
    assert.deepEqual(await gate(t1, 'web_fetch', { url: 'https://example.com' }), { kind: 'allow' });
    // DSH's own refusals and prompts stand.
    assert.deepEqual(await gate(t1, 'bash', { command: 'git push' }, { kind: 'deny', reason: 'sandbox' }), { kind: 'deny', reason: 'sandbox' });
    assert.deepEqual(await gate(t1, 'bash', { command: 'git push' }, { kind: 'ask', reason: 'wider' }), { kind: 'ask', reason: 'wider' });

    // A thread whose approvals never ask can't send, and hears how the user can let it ask.
    policies.set(t1.id, 'never');
    assert.deepEqual(await gate(t1, 'bash', { command: 'git push origin main' }), {
        kind: 'deny',
        reason: "Not run: the command pushes to origin (git push). A thread asks the user before each command that sends outside the workspace, and this thread's permission never asks. Hand back with status needs_decision and say exactly what you would send; the user can put this thread on Workspace Write so it can ask. Don't send it another way.",
    });
    policies.delete(t1.id);
    // The coordinator is refused, and nobody is asked.
    assert.deepEqual(await gate(coord, 'bash', { command: 'npm publish' }), {
        kind: 'deny',
        reason: "Not run: the command publishes (npm publish). You don't send anything yourself: start a thread with the user's words in `ask`; it asks the user before each command that sends.",
    });
    // A thread's subagent, and a subagent's subagent, are refused; a chat the user forked from the thread, and any
    // other chat, run as DSH decides.
    const sub = host.wake('sub-1');
    sub.session.header = { origin: 'subagent', parentSession: t1.id };
    const subsub = host.wake('sub-2');
    subsub.session.header = { origin: 'subagent', parentSession: 'sub-1' };
    const fork = host.wake('fork-1');
    fork.session.header = { parentSession: t1.id };
    assert.match((await gate(sub, 'bash', { command: 'git push' })).reason, /^Not run: the command pushes to its remote \(git push\)\. A subagent doesn't send anything outside the workspace: say in your result what you would send, and the thread you work for asks the user first\.$/);
    assert.equal((await gate(subsub, 'bash', { command: 'git push' })).kind, 'deny');
    assert.deepEqual(await gate(fork, 'bash', { command: 'git push' }), { kind: 'allow' });
    assert.deepEqual(await gate(host.wake('plain-1'), 'bash', { command: 'git push' }), { kind: 'allow' });

    // The log says who and what kind of send, never the command.
    assert.match(log(), / send-ask dsh-plugins\/t1 request curl\n/);
    assert.match(log(), / send-refused dsh-plugins\/t1 push git never-asks\n/);
    assert.match(log(), / send-refused dsh-plugins\/coordinator publish npm\n/);
    assert.match(log(), / send-refused dsh-plugins\/t1 subagent push git\n/);
    assert.doesNotMatch(log(), /127\.0\.0\.1|origin main|build\.json/);
    // A check that throws lets the call run, logged.
    const broken = { ...t1, get session() { throw new Error('gone'); } };
    assert.deepEqual(await gate(broken, 'bash', post), { kind: 'allow' });
    assert.match(log(), / error send-check gone\n/);
});
