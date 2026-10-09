/**
 * The project runtime. Each configured project has one coordinator session;
 * the coordinator starts thread sessions with project tools, threads report
 * back with handbacks, and both kinds of session are ordinary DSH sessions
 * created through the Host's own sessionController, so they show live in the
 * DSH window.
 *
 * Project behaviour is attached to the live Agent, not to the session file:
 * on every `agent/created` (fresh, resumed, cleared) the manager looks the
 * session up in the store and installs agent-scoped tools, a system prompt
 * section and, for threads, the idle watcher. Other sessions never see any
 * of it.
 *
 * Models and effort are set the way the DSH model picker sets them: a durable
 * `model/selection` on the one session, so the DSH window shows the right
 * model and the user can still change it there. The picker's public path
 * (`sessionController.selectModel`) also overwrites the global default model,
 * so the manager calls the controller's per-session step directly. When a
 * Host does not have that step, it falls back to rewriting every model
 * request of project sessions.
 *
 * @module dsh-plugin-projects/projects
 */
import { appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore, expand, ensurePrivateDir } from './store.js';
import { SETTING_KEYS, effectiveSettings, applyRoute, checkSelection, describeRoute, parseModelSpec, pluginDefaults } from './settings.js';
import {
    coordinatorPolicy, threadPolicy, rosterLines, briefMessage, coordinatorMessage,
    handbackMessage, idleMessage, approvalMessage, describeEnding, HANDBACK_STATUSES, TAGS,
} from './prompts.js';

/** Order of the project section in the assembled system prompt (after first-party guidance). */
const SECTION_ORDER = 9500;
const HOUR = 60 * 60 * 1000;

/** Delivery retry delays for a coordinator that cannot take a message; tests shorten them. */
export const timing = { retryMs: 60000, maxRetryMs: 15 * 60000 };

/** What project_handback returns. The idle review counts a turn as handed back by these texts. */
const HANDBACK_SENT = 'Handback delivered to the coordinator.';
const HANDBACK_HELD = 'Handback saved; the coordinator gets it when the project resumes.';
const HANDBACK_RETRY = 'Handback saved; the coordinator could not take it just now, and it is sent again automatically.';

/**
 * Lower-kebab id from a project name. Letters in any script are kept
 * (前端 and 后端 stay apart); accents are dropped.
 */
export function slugify(name) {
    const slug = String(name ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return [...slug].slice(0, 48).join('').replace(/-+$/, '') || 'project';
}

/** The newest manager per store file. One left over from a config reload hands late work to it. */
const managers = new Map();
/** Coordinator checks in flight, by store file and project, so two managers never make two coordinators. */
const ensuring = new Map();

/** Whether a session read failed because the session does not exist, not for another reason. */
function isNotFound(error) {
    return error?.constructor?.name === 'ApiSessionNotFound' || error?.code === 'session/not-found'
        || /not[ -]found/i.test(String(error?.message ?? ''));
}

/** Arguments of a logged tool call: an object, or JSON text. */
function argsOf(value) {
    if (typeof value !== 'string') return value ?? {};
    try { return JSON.parse(value); } catch { return {}; }
}

/** Text of one message-like session event, or ''. */
function textOf(event) {
    const content = (event?.data?.message ?? event?.data)?.content;
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
}

/** Role of one message-like session event, or null. */
function roleOf(event) {
    const role = event?.data?.message?.role;
    if (role) return role;
    if (event?.type === 'assistant/message') return 'assistant';
    if (event?.type === 'user/message') return 'user';
    return null;
}

/** Request ids of the prompts this plugin sends; they mark coordinator-driven turns. */
const RPC_PREFIX = 'projects-';

/**
 * A prompt someone sent to the session, or null. User-role messages the Host
 * injects (runtime context, model-change notices) have another source kind.
 */
function promptOf(event) {
    if (roleOf(event) !== 'user') return null;
    const source = (event?.data?.message ?? event?.data)?.source;
    if (source?.kind !== undefined && source.kind !== 'user') return null;
    const text = textOf(event);
    if (!text) return null;
    const fromProject = String(source?.rpcId ?? '').startsWith(RPC_PREFIX) || text.startsWith(TAGS.brief) || text.startsWith(TAGS.coordinator);
    return { text, fromProject };
}

/**
 * Where one turn sits in a session log. `current` is the turn running now;
 * otherwise the last turn that ended. A log without turn markers counts as
 * one turn. Returns event indexes [start, end), the end reason and whether
 * the turn has ended.
 */
function turnRange(events, current) {
    const lastIndex = (type, before) => {
        for (let i = before - 1; i >= 0; i--) if (events[i]?.type === type) return i;
        return -1;
    };
    const lastEnd = lastIndex('turn/end', events.length);
    if (current) {
        const lastStart = lastIndex('turn/start', events.length);
        return { start: lastStart > lastEnd ? lastStart : lastEnd + 1, end: events.length, ended: false };
    }
    if (lastEnd < 0) return { start: Math.max(lastIndex('turn/start', events.length), 0), end: events.length, ended: false };
    const start = Math.max(lastIndex('turn/start', lastEnd), lastIndex('turn/end', lastEnd) + 1);
    return { start, end: lastEnd + 1, reason: events[lastEnd].data?.reason ?? null, ended: true };
}

export class ProjectError extends Error {}

export class ProjectManager {
    /**
     * @param {object} options
     * @param {object} options.ctx - plugin context (sessionController, workspaceRegistry, agents).
     * @param {object} options.config - validated plugin config.
     * @param {Function} options.buildTools - (manager, who) => tool definitions for one agent.
     */
    constructor({ ctx, config, buildTools }) {
        this.ctx = ctx;
        this.config = config;
        this.buildTools = buildTools;
        this.store = ProjectStore.open(config.storeFile);
        managers.set(this.store.file, this);
        this.disposed = false;
        this.logFile = config.logFile ? expand(config.logFile) : '';
        if (this.logFile) {
            try { ensurePrivateDir(dirname(this.logFile)); } catch {}
        }
        /**
         * 'session': set models with the controller's per-session selection.
         * 'override': this Host lacks it; rewrite each project model request.
         */
        this.selectionMode = typeof ctx.sessionController?.agents?.selectForNextRequest === 'function' ? 'session' : 'override';
        /** projectId → normalized project row. */
        this.projects = new Map();
        for (const row of config.projects ?? []) {
            const id = slugify(row.id || row.name);
            if (this.projects.has(id)) {
                this.log(`config duplicate project id ${id}; keeping the first row`);
                ctx.logger?.warn?.('projects: two projects have the id "%s"; only the first runs. Give the other an id.', id);
                continue;
            }
            this.projects.set(id, { ...row, id, workspacePath: expand(row.workspacePath) });
        }
        /** Agent → disposer for its installed project scope. */
        this.installed = new Map();
        /** sessionId → {running, stopped?: {key}} for thread turn tracking. */
        this.turns = new Map();
        /** sessionId → (approval id → timer) for permission prompts not yet answered. */
        this.approvals = new Map();
        /** projectId → tail of its delivery chain, so messages reach the coordinator in order. */
        this.chains = new Map();
        /** projectId → {timer, attempt} for held messages waiting on a retry. */
        this.retries = new Map();
    }

    /** One action line, mode 600. Sizes and ids only, never prompt text. */
    log(line) {
        if (!this.logFile) return;
        try { appendFileSync(this.logFile, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }); } catch {}
    }

    get sc() {
        return this.ctx.sessionController;
    }

    project(projectId) {
        const p = this.projects.get(projectId);
        if (!p) throw new ProjectError(`project "${projectId}" is not configured`);
        return p;
    }

    settings(projectId) {
        return effectiveSettings(pluginDefaults(this.config), this.project(projectId), this.store.project(projectId).settings);
    }

    /**
     * Compare the plugin defaults with the ones this project last saw. A
     * default that changed since (on the plugin's page in DSH, or in the
     * profile) replaces the project's own change of that setting made through
     * the coordinator, so the newest change wins. The first look only records.
     * @returns {string[]} the settings whose project change was replaced.
     */
    noteDefaults(projectId) {
        // Empty means "use the default", however it is written.
        const plain = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
        const now = pluginDefaults(this.config);
        const p = this.store.project(projectId);
        const seen = p.defaultsSeen;
        const changed = SETTING_KEYS.filter((key) => plain(now[key]) !== plain(seen?.[key]));
        if (seen && changed.length === 0) return [];
        const replaced = seen ? changed.filter((key) => p.settings[key] !== undefined) : [];
        if (replaced.length) this.store.putSettings(projectId, Object.fromEntries(replaced.map((key) => [key, undefined])));
        this.store.putProject(projectId, { defaultsSeen: Object.fromEntries(SETTING_KEYS.map((key) => [key, plain(now[key])])) });
        if (seen) this.log(`defaults ${projectId} ${changed.join(',')}${replaced.length ? ` replaced ${replaced.join(',')}` : ''}`);
        return replaced;
    }

    /**
     * The plugin defaults changed while the plugin runs (DSH's settings page
     * saved them). Coordinators switch from their next request; new threads
     * start with the new defaults, and running threads keep theirs.
     */
    async onDefaultsChanged() {
        for (const projectId of this.projects.keys()) {
            if (this.disposed) return;
            try {
                this.noteDefaults(projectId);
                await this.applyCoordinatorRoute(projectId);
            } catch (error) {
                this.log(`error defaults ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            }
        }
    }

    paused(projectId) {
        const override = this.store.project(projectId).settings.paused;
        return typeof override === 'boolean' ? override : this.project(projectId).paused === true;
    }

    liveStatus(sessionId) {
        const agent = this.ctx.agents.get(sessionId);
        return agent ? agent.status : 'idle';
    }

    /** The Host model catalog, cached briefly; undefined when unavailable. */
    async catalog() {
        if (this.catalogCache && Date.now() - this.catalogCache.at < 30000) return this.catalogCache.value;
        let value;
        try { value = await this.sc.modelCatalog(); } catch { value = undefined; }
        this.catalogCache = value ? { value, at: Date.now() } : null;
        return value;
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    /**
     * Attach to live agents, make sure every project has a coordinator,
     * deliver held messages, and review thread turns that ended while the
     * plugin was not watching (DSH stopped or the plugin reloaded mid-turn).
     */
    async start() {
        for (const agent of this.ctx.agents.list?.() ?? []) this.maybeInstall(agent);
        for (const id of this.projects.keys()) {
            if (this.disposed) return;
            try {
                this.noteDefaults(id);
                await this.ensureCoordinator(id);
            } catch (error) {
                this.log(`error coordinator ${id} ${String(error?.message ?? error).slice(0, 300)}`);
                this.ctx.logger?.warn?.('projects: could not start coordinator for %s: %s', id, error?.message ?? error);
                continue;
            }
            // Reloaded meanwhile: the new manager delivers and reviews.
            if (this.disposed) return;
            await this.flushPending(id);
            await this.catchUp(id);
        }
    }

    async dispose() {
        this.disposed = true;
        if (managers.get(this.store.file) === this) managers.delete(this.store.file);
        for (const dispose of this.installed.values()) {
            try { dispose(); } catch {}
        }
        this.installed.clear();
        for (const sessionId of [...this.approvals.keys()]) this.clearApprovals(sessionId);
        for (const { timer } of this.retries.values()) clearTimeout(timer);
        this.retries.clear();
    }

    /** Whether a session exists. Only "not found" means no; any other read error is thrown. */
    async exists(sessionId) {
        if (!sessionId) return false;
        try {
            await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
            return true;
        } catch (error) {
            if (isNotFound(error)) return false;
            throw error;
        }
    }

    /** Create one ordinary session in the project's workspace. */
    async createSession(project) {
        const ws = await this.ctx.workspaceRegistry.create(project.workspacePath);
        const created = await this.sc.create({ workspaceId: ws.id, ...(project.agentPreset ? { agentPreset: project.agentPreset } : {}) });
        return created.sessionId;
    }

    /** Resolve a session's live agent and install project behaviour on it. */
    async attach(sessionId) {
        const r = await this.sc.resolveAgent(sessionId);
        if (r?.agent) this.maybeInstall(r.agent);
        return r?.agent;
    }

    /** One coordinator check per project at a time, across managers. */
    async ensureCoordinator(projectId) {
        const key = `${this.store.file}#${projectId}`;
        while (ensuring.has(key)) await ensuring.get(key).catch(() => {});
        const run = this.ensureCoordinatorOnce(projectId);
        ensuring.set(key, run);
        try {
            return await run;
        } finally {
            if (ensuring.get(key) === run) ensuring.delete(key);
        }
    }

    async ensureCoordinatorOnce(projectId) {
        const project = this.project(projectId);
        const stored = this.store.project(projectId);
        if (await this.exists(stored.coordinatorSessionId)) {
            const live = this.ctx.agents.get(stored.coordinatorSessionId);
            if (live) this.maybeInstall(live);
            await this.applyCoordinatorRoute(projectId);
            this.log(`coordinator ${projectId} ${stored.coordinatorSessionId} resumed`);
            return stored.coordinatorSessionId;
        }
        // The plugin reloaded meanwhile; the new manager makes the coordinator.
        if (this.disposed) return null;
        const sessionId = await this.createSession(project);
        this.store.putProject(projectId, {
            coordinatorSessionId: sessionId, coordinatorCreatedAt: new Date().toISOString(), coordinatorRoute: undefined,
        });
        await this.attach(sessionId);
        await this.sc.rename({ sessionId, title: `◆ ${project.name}` }).catch(() => {});
        await this.applyCoordinatorRoute(projectId);
        this.log(`coordinator ${projectId} ${sessionId}`);
        return sessionId;
    }

    async prompt(sessionId, text, mode = 'queue') {
        await this.sc.prompt({
            sessionId,
            requestId: `${RPC_PREFIX}${randomUUID()}`,
            mode,
            content: [{ type: 'text', text }],
        }, AbortSignal.timeout(60000));
    }

    // ── agent scope ────────────────────────────────────────────────────────

    maybeInstall(agent) {
        // A tool call that outlived a config reload hands its new session to the new manager.
        if (this.disposed) {
            managers.get(this.store.file)?.maybeInstall(agent);
            return;
        }
        if (!agent || this.installed.has(agent)) return;
        const who = this.store.lookup(agent.id);
        if (!who || !this.projects.has(who.projectId)) return;
        // Runs inside the serial `agent/created` listener chain, where a throw
        // would fail the session's creation: log and leave the session plain.
        try {
            this.installed.set(agent, this.install(agent, who));
        } catch (error) {
            this.log(`error attach ${agent.id} ${String(error?.message ?? error).slice(0, 300)}`);
            this.ctx.logger?.warn?.('projects: could not attach to session %s: %s', agent.id, error?.message ?? error);
            return;
        }
        this.log(`attach ${who.role} ${who.projectId}${who.threadId ? `/${who.threadId}` : ''} ${agent.id}`);
    }

    forget(agent) {
        const dispose = this.installed.get(agent);
        if (!dispose) return;
        this.installed.delete(agent);
        try { dispose(); } catch {}
    }

    /** Install tools, prompt section, route override and status watcher in one agent scope. */
    install(agent, who) {
        const scoped = agent.ctx;
        const disposers = [];
        const add = (d) => { if (typeof d === 'function') disposers.push(d); };
        const { projectId, role, threadId } = who;
        try {
            add(scoped.systemPrompt?.section({
                name: `projects:${role}`,
                order: SECTION_ORDER,
                interpolate: false,
                text: () => (role === 'coordinator' ? this.coordinatorText(projectId) : this.threadText(projectId, threadId)),
            }));
            for (const tool of this.buildTools(this, who)) add(scoped.tools.register(tool));
            if (this.selectionMode === 'override') {
                // Outermost, so the Host's own selection listener cannot undo it.
                add(scoped.on('agent/request', async (_event, next) => {
                    const resolved = await next();
                    const route = await this.checkedRoute(who);
                    return route ? applyRoute(resolved, route.model, route.effort) : resolved;
                }, { prepend: true }));
            }
            if (role === 'thread') {
                if (agent.status === 'running') {
                    // Attached mid-turn (the plugin reloaded): review the turn when it ends,
                    // and watch the permission prompts it is already waiting on.
                    this.turns.set(agent.id, { running: true });
                    const t = this.store.thread(projectId, threadId);
                    if (t && !t.busy) this.store.putThread(projectId, threadId, { busy: true });
                    void this.rearmApprovals(projectId, threadId, agent).catch((error) => {
                        this.log(`error approval ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                    });
                }
                add(scoped.on('agent/status', ({ status }) => {
                    void this.onThreadStatus(projectId, threadId, agent, status).catch((error) => {
                        this.log(`error status ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                    });
                }));
                add(scoped.on('session/event', (_session, event) => this.onThreadEvent(projectId, threadId, agent, event)));
                add(() => this.clearApprovals(agent.id));
            }
        } catch (error) {
            for (const d of disposers.reverse()) { try { d(); } catch {} }
            throw error;
        }
        return () => { for (const d of disposers.reverse()) { try { d(); } catch {} } };
    }

    /** The model route for one session, read live so setting changes apply on the next request. */
    routeFor(who) {
        if (!this.projects.has(who.projectId)) return null;
        if (who.role === 'coordinator') {
            const s = this.settings(who.projectId);
            return { model: s.coordinatorModel.value, effort: s.coordinatorEffort.value };
        }
        const t = this.store.thread(who.projectId, who.threadId);
        return t ? { model: t.model, effort: t.effort } : null;
    }

    /** The route checked against the catalog: an effort the model lacks is dropped. */
    async checkedRoute(who) {
        const route = this.routeFor(who);
        if (!route || (!route.model && !route.effort)) return route;
        const check = checkSelection(await this.catalog(), route.model, route.effort);
        return check.ok ? { model: check.model ?? route.model, effort: check.effort } : route;
    }

    /**
     * The complete selection for a route. An unset model means the DSH
     * default model; an unset effort means the model's own default, and a
     * fully unset route means the DSH default selection.
     */
    fullSelection(route) {
        let base = {};
        try { base = this.ctx.get?.('agentDefaultModel')?.currentSelection?.() ?? {}; } catch {}
        if (!route?.model && !route?.effort) return base.provider && base.model ? { ...base } : null;
        const parsed = route.model ? parseModelSpec(route.model, base.provider) : { provider: base.provider, model: base.model };
        if (!parsed?.provider || !parsed.model) return null;
        return { provider: parsed.provider, model: parsed.model, ...(route.effort ? { reasoningEffort: route.effort } : {}) };
    }

    /** Validate a selection and fill in the adapter's default effort, as the DSH picker does. */
    async resolveSelection(selection) {
        const llm = this.ctx.get?.('llm');
        if (typeof llm?.resolveCallConfig !== 'function') return selection;
        const r = await llm.resolveCallConfig(selection, AbortSignal.timeout(20000));
        return { provider: r.provider, model: r.model, ...(r.reasoningEffort === undefined ? {} : { reasoningEffort: String(r.reasoningEffort) }) };
    }

    /**
     * Put one session on its project route from its next model request, the
     * way the DSH model picker does, without saving a global default.
     * @returns whether a selection was recorded.
     */
    async selectRoute(agent, who) {
        if (this.selectionMode !== 'session' || !agent) return false;
        const label = `${who.projectId}/${who.threadId ?? 'coordinator'}`;
        try {
            const wanted = this.fullSelection(await this.checkedRoute(who));
            if (!wanted) throw new Error('no DSH default model to build on');
            const selection = await this.resolveSelection(wanted);
            this.sc.agents.selectForNextRequest(agent, selection);
            this.log(`select ${label} ${selection.provider}:${selection.model} effort=${selection.reasoningEffort ?? '-'}`);
            return true;
        } catch (error) {
            this.log(`error select ${label} ${String(error?.message ?? error).slice(0, 200)}`);
            this.ctx.logger?.warn?.('projects: could not set the model for %s: %s', label, error?.message ?? error);
            return false;
        }
    }

    /**
     * Select the coordinator's route when its settings differ from the ones
     * it last got. A new coordinator on the DSH default needs no selection.
     * @returns false only when a needed selection failed.
     */
    async applyCoordinatorRoute(projectId) {
        if (this.selectionMode !== 'session') return true;
        const stored = this.store.project(projectId);
        if (!stored.coordinatorSessionId) return true;
        const s = this.settings(projectId);
        const key = JSON.stringify([s.coordinatorModel.value ?? null, s.coordinatorEffort.value ?? null]);
        if (stored.coordinatorRoute === key) return true;
        if (stored.coordinatorRoute === undefined && key === '[null,null]') {
            this.store.putProject(projectId, { coordinatorRoute: key });
            return true;
        }
        let agent;
        try {
            agent = await this.attach(stored.coordinatorSessionId);
        } catch (error) {
            this.log(`error select ${projectId}/coordinator ${String(error?.message ?? error).slice(0, 200)}`);
            return false;
        }
        if (!await this.selectRoute(agent, { projectId, role: 'coordinator' })) return false;
        this.store.putProject(projectId, { coordinatorRoute: key });
        return true;
    }

    readMemory(projectId) {
        try { return readFileSync(this.memoryPath(projectId), 'utf8'); } catch { return ''; }
    }

    coordinatorText(projectId) {
        const project = this.project(projectId);
        return coordinatorPolicy({
            name: project.name,
            goal: project.goal,
            workspacePath: project.workspacePath,
            paused: this.paused(projectId),
            threads: this.store.project(projectId).threads,
            settings: this.settings(projectId),
            memory: this.readMemory(projectId),
            liveStatus: (sid) => this.liveStatus(sid),
        });
    }

    threadText(projectId, threadId) {
        const project = this.project(projectId);
        const t = this.store.thread(projectId, threadId);
        return threadPolicy({ name: project.name, goal: project.goal, threadId, title: t?.title ?? threadId, memory: this.readMemory(projectId) });
    }

    /**
     * Track thread turns. DSH runs queued messages as back-to-back turns and
     * goes idle once at the end, so the review looks at the last turn only.
     */
    async onThreadStatus(projectId, threadId, agent, status) {
        const state = this.turns.get(agent.id) ?? { running: false };
        if (status === 'running') {
            if (state.running) return;
            this.turns.set(agent.id, { running: true });
            // Marks a turn in flight, so one cut off by a DSH stop is reviewed at the next start.
            const t = this.store.thread(projectId, threadId);
            if (t && !t.busy) this.store.putThread(projectId, threadId, { busy: true });
            return;
        }
        if (status !== 'idle' || !state.running) return;
        this.turns.set(agent.id, { running: false });
        if (this.store.thread(projectId, threadId)?.busy) this.store.putThread(projectId, threadId, { busy: false });
        await this.reviewTurn(projectId, threadId, agent.id, { stopped: state.stopped });
    }

    /**
     * Review a thread's last ended turn once. A turn the coordinator started
     * that ended without a handback sends the automatic note. A turn the user
     * started by talking to the thread directly is only recorded for the
     * coordinator's roster: the user is already there, and a note would make
     * the coordinator take a turn for nothing.
     * @param {object} [options]
     * @param {{key: unknown}} [options.stopped] - the turn the coordinator stopped.
     * @param {boolean} [options.catchUp] - reviewing at start: only a turn that really ended.
     */
    async reviewTurn(projectId, threadId, sessionId, { stopped, catchUp = false } = {}) {
        const turn = await this.readTurn(sessionId);
        const t = this.store.thread(projectId, threadId);
        if (!t || t.resolved || (catchUp && !turn.ended)) return;
        if (turn.ended) {
            if (t.seenTurn === turn.key) return;
            this.store.putThread(projectId, threadId, { seenTurn: turn.key });
        }
        if (turn.handedBack) return;
        // The coordinator stopped this turn itself, so a note would only echo that back.
        if (stopped && stopped.key === turn.key && turn.endKind === 'aborted') return;
        if (!turn.fromProject) {
            this.store.putThread(projectId, threadId, { lastDirect: { at: new Date().toISOString(), reply: turn.reply.slice(0, 500) } });
            this.log(`direct-turn ${projectId}/${threadId} chars=${turn.reply.length}`);
            return;
        }
        if (this.config.autoHandback !== 'idle' || !this.allowHandback(projectId, threadId)) return;
        await this.deliver(projectId, idleMessage(threadId, t.title, turn.reply, turn.ending));
        this.log(`idle-note ${projectId}/${threadId} chars=${turn.reply.length}${turn.ending ? ` ended=${turn.endKind}` : ''}`);
    }

    /**
     * At start: review the turns of threads that were mid-turn when the
     * plugin last looked, unless they are running now (their end is watched).
     */
    async catchUp(projectId) {
        for (const [threadId, t] of Object.entries(this.store.project(projectId).threads)) {
            if (this.disposed) return;
            if (!t.busy || t.resolved) continue;
            if (this.ctx.agents.get(t.sessionId)?.status === 'running') continue;
            this.store.putThread(projectId, threadId, { busy: false });
            try {
                await this.reviewTurn(projectId, threadId, t.sessionId, { catchUp: true });
            } catch (error) {
                this.log(`error catch-up ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
            }
        }
    }

    /**
     * Watch a thread's permission prompts. One still unanswered after
     * approvalNoticeSeconds tells the coordinator, so a thread it started
     * does not sit on a prompt nobody sees.
     */
    onThreadEvent(projectId, threadId, agent, event) {
        const id = event?.data?.id;
        if (!id) return;
        if (event.type === 'approval/decided') {
            clearTimeout(this.approvals.get(agent.id)?.get(id));
            this.approvals.get(agent.id)?.delete(id);
            return;
        }
        if (event.type !== 'approval/asked' || !(this.config.approvalNoticeSeconds > 0)) return;
        const pending = this.approvals.get(agent.id) ?? new Map();
        this.approvals.set(agent.id, pending);
        const timer = setTimeout(() => {
            pending.delete(id);
            void this.noticeApproval(projectId, threadId, agent, event.data).catch((error) => {
                this.log(`error approval ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
            });
        }, this.config.approvalNoticeSeconds * 1000);
        timer.unref?.();
        pending.set(id, timer);
    }

    clearApprovals(sessionId) {
        for (const timer of this.approvals.get(sessionId)?.values() ?? []) clearTimeout(timer);
        this.approvals.delete(sessionId);
    }

    /** Watch the permission prompts a running turn already waits on (after a reload). */
    async rearmApprovals(projectId, threadId, agent) {
        const events = (await this.sc.inspect(agent.id, AbortSignal.timeout(20000))).events ?? [];
        const { start } = turnRange(events, true);
        const open = new Map();
        for (const event of events.slice(start)) {
            if (event?.type === 'approval/asked' && event.data?.id) open.set(event.data.id, event);
            else if (event?.type === 'approval/decided') open.delete(event.data?.id);
        }
        for (const event of open.values()) this.onThreadEvent(projectId, threadId, agent, event);
    }

    async noticeApproval(projectId, threadId, agent, data) {
        const t = this.store.thread(projectId, threadId);
        if (!t || t.resolved || !this.projects.has(projectId)) return;
        const turn = await this.readTurn(agent.id, { current: true });
        // The user is talking to the thread directly, so the prompt is in front of them.
        if (!turn.fromProject || !this.allowHandback(projectId, threadId)) return;
        const sessionTitle = `${this.project(projectId).name} › ${t.title}`;
        await this.deliver(projectId, approvalMessage(threadId, t.title, sessionTitle, String(data.toolName ?? 'a tool'), data.reason));
        this.log(`approval-note ${projectId}/${threadId} tool=${String(data.toolName ?? '').slice(0, 60)}`);
    }

    /** Rate cap: at most maxHandbacksPerHour per thread, explicit and automatic together. */
    allowHandback(projectId, threadId) {
        const t = this.store.thread(projectId, threadId);
        const now = Date.now();
        const recent = (t?.handbackTimes ?? []).filter((ms) => now - ms < HOUR);
        if (recent.length >= this.config.maxHandbacksPerHour) return false;
        this.store.putThread(projectId, threadId, { handbackTimes: [...recent, now] });
        return true;
    }

    /**
     * One turn of a session, read from its log: the last one that ended, or
     * with `current` the one running now. Returns its `key` (the seq of its
     * first event), whether it `ended`, how (`endKind`, and `ending` as a line
     * when that was not a normal completion), its last reply, whether it
     * handed back, and whether its prompt came from this project (the
     * coordinator) rather than from the user directly.
     */
    async readTurn(sessionId, { current = false } = {}) {
        const events = (await this.sc.inspect(sessionId, AbortSignal.timeout(20000))).events ?? [];
        const { start, end, reason, ended } = turnRange(events, current);
        let reply = '';
        let prompt = null;
        const handbacks = new Map();
        let handedBack = false;
        for (let i = start; i < end; i++) {
            const event = events[i];
            if (roleOf(event) === 'assistant') reply = textOf(event) || reply;
            prompt = promptOf(event) ?? prompt;
            if (event?.type === 'tool/call' && event.data?.name === 'project_handback') {
                handbacks.set(event.data.callId, argsOf(event.data.arguments)?.status);
            } else if (event?.type === 'tool/result') {
                const callId = event.data?.message?.toolCallId ?? event.data?.message?.source?.callId;
                const status = handbacks.get(callId);
                if (status && status !== 'progress' && textOf(event).startsWith('Handback ')) handedBack = true;
            }
        }
        // A turn with no prompt of its own (woken by the Host) belongs to the last prompt before it.
        for (let i = start - 1; !prompt && i >= 0; i--) prompt = promptOf(events[i]);
        return {
            key: events[start]?.seq ?? start,
            ended,
            endKind: reason?.kind,
            ending: describeEnding(reason),
            reply,
            handedBack,
            fromProject: prompt ? prompt.fromProject : true,
        };
    }

    /** Run one delivery step after the ones before it, so the coordinator gets messages in order. */
    serial(projectId, step) {
        const run = (this.chains.get(projectId) ?? Promise.resolve()).then(step);
        this.chains.set(projectId, run.catch(() => {}));
        return run;
    }

    /**
     * Send text to the coordinator after anything held before it. It is
     * held while the project is paused, and retried when the coordinator
     * cannot take it.
     * @returns {Promise<'delivered'|'held'>}
     */
    deliver(projectId, text) {
        return this.serial(projectId, async () => {
            const pending = this.store.project(projectId).pendingHandbacks;
            this.store.putProject(projectId, { pendingHandbacks: [...pending, text] });
            if (this.paused(projectId)) return 'held';
            return (await this.sendHeld(projectId)) === 0 ? 'delivered' : 'held';
        });
    }

    /** Deliver held messages now, unless paused. @returns how many were sent. */
    flushPending(projectId) {
        return this.serial(projectId, async () => {
            const before = this.store.project(projectId).pendingHandbacks.length;
            if (before === 0 || this.paused(projectId)) return 0;
            const sent = before - await this.sendHeld(projectId);
            this.log(`flush ${projectId} sent=${sent}`);
            return sent;
        });
    }

    /** Send held messages in order until one fails; then retry later. Runs inside `serial`. @returns how many are left. */
    async sendHeld(projectId) {
        const sessionId = this.store.project(projectId).coordinatorSessionId;
        // No coordinator yet: the next start makes one and sends them.
        if (!sessionId) return this.store.project(projectId).pendingHandbacks.length;
        while (this.store.project(projectId).pendingHandbacks.length > 0 && !this.paused(projectId)) {
            try {
                await this.prompt(sessionId, this.store.project(projectId).pendingHandbacks[0], 'queue');
            } catch (error) {
                this.log(`error deliver ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
                this.retryLater(projectId);
                break;
            }
            this.store.putProject(projectId, { pendingHandbacks: this.store.project(projectId).pendingHandbacks.slice(1) });
        }
        const left = this.store.project(projectId).pendingHandbacks.length;
        if (left === 0) {
            clearTimeout(this.retries.get(projectId)?.timer);
            this.retries.delete(projectId);
        }
        return left;
    }

    /** Try held messages again later, backing off up to timing.maxRetryMs. */
    retryLater(projectId) {
        const retry = this.retries.get(projectId) ?? { attempt: 0 };
        if (retry.timer || this.disposed) return;
        const delay = Math.min(timing.retryMs * 2 ** retry.attempt, timing.maxRetryMs);
        retry.attempt += 1;
        retry.timer = setTimeout(() => {
            retry.timer = undefined;
            void this.flushPending(projectId);
        }, delay);
        retry.timer.unref?.();
        this.retries.set(projectId, retry);
    }

    // ── operations behind the tools ────────────────────────────────────────

    /** The thread for an id as the model typed it (" t3 " is t3), or an error that lists the threads. */
    requireThread(projectId, threadId) {
        const id = String(threadId ?? '').trim();
        const t = this.store.thread(projectId, id);
        if (!t) {
            const known = Object.keys(this.store.project(projectId).threads).join(', ') || 'none';
            throw new ProjectError(`no thread "${id}" in this project (threads: ${known})`);
        }
        return { id, t };
    }

    async startThread(projectId, { title, brief, model, effort }) {
        const project = this.project(projectId);
        if (this.paused(projectId)) throw new ProjectError('the project is paused; new threads are blocked until it resumes');
        const cleanTitle = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!cleanTitle) throw new ProjectError('title is required');
        if (!String(brief ?? '').trim()) throw new ProjectError('brief is required');
        const s = this.settings(projectId);
        // Not given, or "default": the project's thread default.
        const or = (value, fallback) => (value === undefined || value === 'default' ? fallback : value);
        const check = checkSelection(await this.catalog(), or(model, s.threadModel.value), or(effort, s.threadEffort.value));
        if (!check.ok) throw new ProjectError(check.error);
        // Every attempt counts, so a coordinator caught in a loop stops even when starts fail.
        const now = Date.now();
        const starts = (this.store.project(projectId).threadStarts ?? []).filter((ms) => now - ms < HOUR);
        if (starts.length >= this.config.maxThreadsPerHour) {
            this.log(`thread-limit ${projectId} ${starts.length}`);
            throw new ProjectError(`thread limit reached: this project started ${starts.length} threads in the last hour (maxThreadsPerHour). Tell the user, and continue in existing threads with project_thread_send`);
        }
        this.store.putProject(projectId, { threadStarts: [...starts, now] });

        const threadId = this.store.reserveThreadId(projectId);
        const sessionId = await this.createSession(project);
        this.store.putThread(projectId, threadId, {
            sessionId, title: cleanTitle, model: check.model, effort: check.effort,
            resolved: false, createdAt: new Date().toISOString(), handbackTimes: [], seenTurn: null,
        });
        const agent = await this.attach(sessionId);
        const notes = check.note ? [check.note] : [];
        if ((check.model || check.effort) && this.selectionMode === 'session'
            && !await this.selectRoute(agent, { projectId, role: 'thread', threadId })) {
            notes.push('the model could not be set, so the thread runs on the DSH default (details in the projects log)');
        }
        await this.sc.rename({ sessionId, title: `${project.name} › ${cleanTitle}` }).catch(() => {});
        await this.prompt(sessionId, briefMessage(project.name, threadId, cleanTitle, brief.trim()), 'queue');
        this.log(`thread-start ${projectId}/${threadId} ${sessionId} brief-chars=${brief.length}`);
        return { threadId, sessionId, title: cleanTitle, route: describeRoute(check.model, check.effort), notes };
    }

    async sendToThread(projectId, threadId, text, steer) {
        const { id, t } = this.requireThread(projectId, threadId);
        if (!String(text ?? '').trim()) throw new ProjectError('text is required');
        if (t.resolved) this.store.putThread(projectId, id, { resolved: false });
        await this.attach(t.sessionId);
        await this.prompt(t.sessionId, coordinatorMessage(text.trim()), steer ? 'steer' : 'queue');
        this.log(`thread-send ${projectId}/${id} mode=${steer ? 'steer' : 'queue'} chars=${text.length}`);
        return `${steer ? 'Steered' : 'Sent to'} ${id}${t.resolved ? ' (reopened)' : ''}.`;
    }

    listThreads(projectId, includeResolved) {
        const all = this.store.project(projectId).threads;
        const threads = includeResolved ? all : Object.fromEntries(Object.entries(all).filter(([, t]) => !t.resolved));
        const hidden = Object.keys(all).length - Object.keys(threads).length;
        return [...rosterLines(threads, (sid) => this.liveStatus(sid)), hidden > 0 ? `(${hidden} resolved hidden)` : '']
            .filter(Boolean).join('\n');
    }

    async readThread(projectId, threadId, count = 6) {
        const { id, t } = this.requireThread(projectId, threadId);
        const r = await this.sc.inspect(t.sessionId, AbortSignal.timeout(20000));
        const msgs = (r.events ?? [])
            .map((e) => (roleOf(e) === 'user' ? { role: 'user', text: promptOf(e)?.text } : { role: roleOf(e), text: textOf(e) }))
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text);
        const n = Math.max(1, Math.min(Number(count) || 6, 30));
        const lines = msgs.slice(-n).map((m) => `## ${m.role}\n${m.text.length > 3000 ? `${m.text.slice(0, 3000)}…` : m.text}`);
        return [`${id} · "${t.title}" · ${t.resolved ? 'resolved' : this.liveStatus(t.sessionId)} · ${describeRoute(t.model, t.effort)}`, ...lines].join('\n\n');
    }

    async updateThread(projectId, threadKey, changes) {
        const { id: threadId, t } = this.requireThread(projectId, threadKey);
        const out = [];
        const fields = {};
        if (changes.title !== undefined && String(changes.title).trim()) {
            fields.title = String(changes.title).replace(/\s+/g, ' ').trim().slice(0, 80);
            await this.sc.rename({ sessionId: t.sessionId, title: `${this.project(projectId).name} › ${fields.title}` }).catch(() => {});
            out.push(`renamed to "${fields.title}"`);
        }
        if (changes.model !== undefined || changes.effort !== undefined) {
            const s = this.settings(projectId);
            const wantModel = changes.model === undefined ? t.model : changes.model === 'default' ? s.threadModel.value : changes.model;
            const wantEffort = changes.effort === undefined ? t.effort : changes.effort === 'default' ? s.threadEffort.value : changes.effort;
            const check = checkSelection(await this.catalog(), wantModel, wantEffort);
            if (!check.ok) throw new ProjectError(check.error);
            fields.model = check.model;
            fields.effort = check.effort;
            out.push(`route ${describeRoute(check.model, check.effort)} from the next request`);
            if (check.note) out.push(check.note);
        }
        if (changes.resolved !== undefined) {
            fields.resolved = changes.resolved === true;
            out.push(fields.resolved ? 'resolved' : 'reopened');
        }
        if (Object.keys(fields).length > 0) this.store.putThread(projectId, threadId, fields);
        if ('model' in fields && this.selectionMode === 'session'
            && !await this.selectRoute(await this.attach(t.sessionId), { projectId, role: 'thread', threadId })) {
            out.push('but the model could not be set, so it keeps its current one (details in the projects log)');
        }
        if (changes.stop === true) {
            if (this.ctx.agents.get(t.sessionId)?.status !== 'running') {
                out.push('no turn was running');
            } else {
                const state = this.turns.get(t.sessionId);
                if (state?.running) state.stopped = { key: (await this.readTurn(t.sessionId, { current: true })).key };
                try {
                    await this.sc.cancel({ sessionId: t.sessionId });
                    out.push('current turn stopped (queued messages kept)');
                } catch (error) {
                    if (state) state.stopped = undefined;
                    out.push(`the turn could not be stopped (${String(error?.message ?? error).slice(0, 200)})`);
                }
            }
        }
        this.log(`thread-update ${projectId}/${threadId} ${Object.keys(fields).join(',')}${changes.stop ? ',stop' : ''}`);
        return out.length ? `${threadId}: ${out.join('; ')}.` : `${threadId}: nothing to change.`;
    }

    /**
     * Change runtime settings. A value of "default" clears the override.
     * @param {object} changes - coordinatorModel, coordinatorEffort, threadModel, threadEffort, paused.
     */
    async updateSettings(projectId, changes) {
        const next = {};
        const current = this.settings(projectId);
        const val = (v) => (v === 'default' ? undefined : v);
        const pairs = [['coordinatorModel', 'coordinatorEffort'], ['threadModel', 'threadEffort']];
        const notes = [];
        let catalog;
        for (const [mKey, eKey] of pairs) {
            if (changes[mKey] === undefined && changes[eKey] === undefined) continue;
            catalog ??= await this.catalog();
            const model = changes[mKey] === undefined ? current[mKey].value : val(changes[mKey]);
            const effort = changes[eKey] === undefined ? current[eKey].value : val(changes[eKey]);
            const check = checkSelection(catalog, model, effort);
            if (!check.ok) throw new ProjectError(check.error);
            if (changes[mKey] !== undefined) next[mKey] = changes[mKey] === 'default' ? undefined : check.model;
            if (changes[eKey] !== undefined) next[eKey] = changes[eKey] === 'default' ? undefined : (check.effort ?? effort.trim());
            if (check.note) notes.push(`${mKey === 'coordinatorModel' ? 'Coordinator' : 'Threads'}: ${check.note}.`);
        }
        const wasPaused = this.paused(projectId);
        if (changes.paused !== undefined) next.paused = changes.paused;
        this.store.putSettings(projectId, next);
        // Every call also retries a coordinator selection that failed before.
        if (!await this.applyCoordinatorRoute(projectId)) {
            notes.push('The coordinator model could not be switched; it keeps its current one (details in the projects log).');
        }
        let flushed = 0;
        if (wasPaused && !this.paused(projectId)) flushed = await this.flushPending(projectId);
        this.log(`settings ${projectId} ${Object.keys(next).join(',')}`);
        const s = this.settings(projectId);
        return [
            `Coordinator: ${describeRoute(s.coordinatorModel.value, s.coordinatorEffort.value)} (${s.coordinatorModel.source} / ${s.coordinatorEffort.source})`,
            `New threads: ${describeRoute(s.threadModel.value, s.threadEffort.value)} (${s.threadModel.source} / ${s.threadEffort.source})`,
            `Paused: ${this.paused(projectId) ? 'yes' : 'no'}${flushed ? ` (delivered ${flushed} held handbacks)` : ''}`,
            ...notes,
        ].join('\n');
    }

    memoryPath(projectId) {
        const project = this.project(projectId);
        return project.memoryFile ? expand(project.memoryFile) : `${expand(this.config.memoryDir)}/${projectId}.md`;
    }

    memory(projectId, action, text) {
        const path = this.memoryPath(projectId);
        if (action === 'read') {
            const body = this.readMemory(projectId);
            return body.trim() ? body : '(project memory is empty)';
        }
        if (action !== 'append' && action !== 'replace') throw new ProjectError('action must be read, append or replace');
        const add = String(text ?? '').trim();
        // Also for replace: an empty replace would erase the whole memory.
        if (!add) throw new ProjectError('text is required');
        const body = action === 'append' ? `${this.readMemory(projectId).replace(/\s*$/, '')}\n${add}\n`.replace(/^\n/, '') : `${add}\n`;
        if (Buffer.byteLength(body) > this.config.maxMemoryBytes) {
            throw new ProjectError(`memory would exceed ${this.config.maxMemoryBytes} bytes; summarize it with action "replace"`);
        }
        ensurePrivateDir(dirname(path));
        writeFileSync(path, body, { mode: 0o600 });
        this.log(`memory ${projectId} ${action} bytes=${statSync(path).size}`);
        return `Project memory ${action === 'append' ? 'appended' : 'replaced'} (${Buffer.byteLength(body)} bytes).`;
    }

    /**
     * A thread's report to the coordinator. The idle review finds it in the
     * thread's log, by the result text this returns.
     */
    async handback(projectId, threadId, status, summary) {
        if (!HANDBACK_STATUSES.includes(status)) throw new ProjectError(`status must be one of ${HANDBACK_STATUSES.join(', ')}`);
        const text = String(summary ?? '').trim();
        if (!text) throw new ProjectError('summary is required');
        const { t } = this.requireThread(projectId, threadId);
        if (!this.allowHandback(projectId, threadId)) {
            throw new ProjectError(`handback limit reached (${this.config.maxHandbacksPerHour} per hour); finish the work and hand back once`);
        }
        this.store.putThread(projectId, threadId, { lastHandback: { status, summary: text.slice(0, 500), at: new Date().toISOString() } });
        const outcome = await this.deliver(projectId, handbackMessage(threadId, t.title, status, text));
        this.log(`handback ${projectId}/${threadId} status=${status} chars=${text.length} ${outcome}`);
        if (outcome === 'delivered') return HANDBACK_SENT;
        return this.paused(projectId) ? HANDBACK_HELD : HANDBACK_RETRY;
    }
}
