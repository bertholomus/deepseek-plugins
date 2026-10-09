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
 * section, a model route override and, for threads, the idle watcher. Other
 * sessions never see any of it.
 *
 * @module dsh-plugin-projects/projects
 */
import { appendFileSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectStore, expand } from './store.js';
import { effectiveSettings, applyRoute, checkSelection, describeRoute } from './settings.js';
import {
    coordinatorPolicy, threadPolicy, rosterLines, briefMessage, coordinatorMessage,
    handbackMessage, idleMessage, HANDBACK_STATUSES,
} from './prompts.js';

/** Order of the project section in the assembled system prompt (after first-party guidance). */
const SECTION_ORDER = 9500;
const HOUR = 60 * 60 * 1000;

/** Lower-kebab id from a project name. */
export function slugify(name) {
    return String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'project';
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
        this.store = new ProjectStore(config.storeFile);
        this.logFile = config.logFile ? expand(config.logFile) : '';
        if (this.logFile) {
            try { mkdirSync(dirname(this.logFile), { recursive: true, mode: 0o700 }); } catch {}
        }
        /** projectId → normalized project row. */
        this.projects = new Map();
        for (const row of config.projects ?? []) {
            const id = slugify(row.id || row.name);
            if (this.projects.has(id)) {
                this.log(`config duplicate project id ${id}; keeping the first row`);
                continue;
            }
            this.projects.set(id, { ...row, id, workspacePath: expand(row.workspacePath) });
        }
        /** Agent → disposer for its installed project scope. */
        this.installed = new Map();
        /** sessionId → {running, handedBack} for thread turn tracking. */
        this.turns = new Map();
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
        return effectiveSettings(this.config, this.project(projectId), this.store.project(projectId).settings);
    }

    paused(projectId) {
        const override = this.store.project(projectId).settings.paused;
        return typeof override === 'boolean' ? override : this.project(projectId).paused === true;
    }

    liveStatus(sessionId) {
        const agent = this.ctx.agents.get(sessionId);
        return agent ? agent.status : 'idle';
    }

    async catalog() {
        try { return await this.sc.modelCatalog(); } catch { return undefined; }
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    /** Attach to live agents, then make sure every project has a coordinator. */
    async start() {
        for (const agent of this.ctx.agents.list?.() ?? []) this.maybeInstall(agent);
        for (const id of this.projects.keys()) {
            try {
                await this.ensureCoordinator(id);
                if (!this.paused(id)) await this.flushPending(id);
            } catch (error) {
                this.log(`error coordinator ${id} ${String(error?.message ?? error).slice(0, 300)}`);
                this.ctx.logger?.warn?.('projects: could not start coordinator for %s: %s', id, error?.message ?? error);
            }
        }
    }

    async dispose() {
        for (const dispose of this.installed.values()) {
            try { dispose(); } catch {}
        }
        this.installed.clear();
    }

    async exists(sessionId) {
        if (!sessionId) return false;
        try {
            await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
            return true;
        } catch {
            return false;
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

    async ensureCoordinator(projectId) {
        const project = this.project(projectId);
        const stored = this.store.project(projectId);
        if (await this.exists(stored.coordinatorSessionId)) {
            const live = this.ctx.agents.get(stored.coordinatorSessionId);
            if (live) this.maybeInstall(live);
            return stored.coordinatorSessionId;
        }
        const sessionId = await this.createSession(project);
        this.store.putProject(projectId, { coordinatorSessionId: sessionId, coordinatorCreatedAt: new Date().toISOString() });
        await this.attach(sessionId);
        await this.sc.rename({ sessionId, title: `◆ ${project.name}` }).catch(() => {});
        this.log(`coordinator ${projectId} ${sessionId}`);
        return sessionId;
    }

    async prompt(sessionId, text, mode = 'queue') {
        await this.sc.prompt({
            sessionId,
            requestId: `projects-${randomUUID()}`,
            mode,
            content: [{ type: 'text', text }],
        }, AbortSignal.timeout(60000));
    }

    // ── agent scope ────────────────────────────────────────────────────────

    maybeInstall(agent) {
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
            add(scoped.on('agent/request', async (_event, next) => {
                const resolved = await next();
                const route = this.routeFor(who);
                return route ? applyRoute(resolved, route.model, route.effort) : resolved;
            }));
            if (role === 'thread') {
                add(scoped.on('agent/status', ({ status }) => {
                    void this.onThreadStatus(projectId, threadId, agent, status).catch((error) => {
                        this.log(`error status ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                    });
                }));
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

    /** Track thread turns; an idle edge without a handback sends the automatic note. */
    async onThreadStatus(projectId, threadId, agent, status) {
        const state = this.turns.get(agent.id) ?? { running: false, handedBack: false };
        if (status === 'running') {
            if (!state.running) this.turns.set(agent.id, { running: true, handedBack: false });
            return;
        }
        if (status !== 'idle' || !state.running) return;
        this.turns.set(agent.id, { running: false, handedBack: false });
        if (state.handedBack || this.config.autoHandback !== 'idle') return;
        const t = this.store.thread(projectId, threadId);
        if (!t || t.resolved || !this.allowHandback(projectId, threadId)) return;
        const last = await this.lastAssistantText(agent.id);
        await this.deliver(projectId, idleMessage(threadId, t.title, last));
        this.log(`idle-note ${projectId}/${threadId} chars=${last.length}`);
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

    async lastAssistantText(sessionId) {
        try {
            const r = await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
            const events = r.events ?? [];
            for (let i = events.length - 1; i >= 0; i--) {
                if (roleOf(events[i]) === 'assistant' && textOf(events[i])) return textOf(events[i]);
            }
        } catch {}
        return '';
    }

    /** Send text to the coordinator, or hold it while the project is paused or unreachable. */
    async deliver(projectId, text) {
        const stored = this.store.project(projectId);
        if (this.paused(projectId) || !stored.coordinatorSessionId) {
            this.store.putProject(projectId, { pendingHandbacks: [...stored.pendingHandbacks, text] });
            return 'held';
        }
        try {
            await this.prompt(stored.coordinatorSessionId, text, 'queue');
            return 'delivered';
        } catch (error) {
            this.log(`error deliver ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            this.store.putProject(projectId, { pendingHandbacks: [...stored.pendingHandbacks, text] });
            return 'held';
        }
    }

    async flushPending(projectId) {
        const stored = this.store.project(projectId);
        const pending = stored.pendingHandbacks;
        if (pending.length === 0 || !stored.coordinatorSessionId) return 0;
        this.store.putProject(projectId, { pendingHandbacks: [] });
        let sent = 0;
        for (let i = 0; i < pending.length; i++) {
            try {
                await this.prompt(stored.coordinatorSessionId, pending[i], 'queue');
                sent += 1;
            } catch {
                this.store.putProject(projectId, { pendingHandbacks: [...pending.slice(i), ...this.store.project(projectId).pendingHandbacks] });
                break;
            }
        }
        this.log(`flush ${projectId} sent=${sent}`);
        return sent;
    }

    // ── operations behind the tools ────────────────────────────────────────

    requireThread(projectId, threadId) {
        const t = this.store.thread(projectId, String(threadId ?? '').trim());
        if (!t) {
            const known = Object.keys(this.store.project(projectId).threads).join(', ') || 'none';
            throw new ProjectError(`no thread "${threadId}" in this project (threads: ${known})`);
        }
        return t;
    }

    async startThread(projectId, { title, brief, model, effort }) {
        const project = this.project(projectId);
        if (this.paused(projectId)) throw new ProjectError('the project is paused; new threads are blocked until it resumes');
        const cleanTitle = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
        if (!cleanTitle) throw new ProjectError('title is required');
        if (!String(brief ?? '').trim()) throw new ProjectError('brief is required');
        const s = this.settings(projectId);
        const check = checkSelection(await this.catalog(), model ?? s.threadModel.value, effort ?? s.threadEffort.value);
        if (!check.ok) throw new ProjectError(check.error);

        const threadId = this.store.reserveThreadId(projectId);
        const sessionId = await this.createSession(project);
        this.store.putThread(projectId, threadId, {
            sessionId, title: cleanTitle, model: check.model, effort: check.effort,
            resolved: false, createdAt: new Date().toISOString(), handbackTimes: [],
        });
        await this.attach(sessionId);
        await this.sc.rename({ sessionId, title: `${project.name} › ${cleanTitle}` }).catch(() => {});
        await this.prompt(sessionId, briefMessage(project.name, threadId, cleanTitle, brief.trim()), 'queue');
        this.log(`thread-start ${projectId}/${threadId} ${sessionId} brief-chars=${brief.length}`);
        return { threadId, sessionId, title: cleanTitle, route: describeRoute(check.model, check.effort) };
    }

    async sendToThread(projectId, threadId, text, steer) {
        const t = this.requireThread(projectId, threadId);
        if (!String(text ?? '').trim()) throw new ProjectError('text is required');
        if (t.resolved) this.store.putThread(projectId, threadId, { resolved: false });
        await this.attach(t.sessionId);
        await this.prompt(t.sessionId, coordinatorMessage(text.trim()), steer ? 'steer' : 'queue');
        this.log(`thread-send ${projectId}/${threadId} mode=${steer ? 'steer' : 'queue'} chars=${text.length}`);
        return `${steer ? 'Steered' : 'Sent to'} ${threadId}${t.resolved ? ' (reopened)' : ''}.`;
    }

    listThreads(projectId, includeResolved) {
        const all = this.store.project(projectId).threads;
        const threads = includeResolved ? all : Object.fromEntries(Object.entries(all).filter(([, t]) => !t.resolved));
        const hidden = Object.keys(all).length - Object.keys(threads).length;
        return [...rosterLines(threads, (sid) => this.liveStatus(sid)), hidden > 0 ? `(${hidden} resolved hidden)` : '']
            .filter(Boolean).join('\n');
    }

    async readThread(projectId, threadId, count = 6) {
        const t = this.requireThread(projectId, threadId);
        const r = await this.sc.inspect(t.sessionId, AbortSignal.timeout(20000));
        const msgs = (r.events ?? [])
            .map((e) => ({ role: roleOf(e), text: textOf(e) }))
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text);
        const n = Math.max(1, Math.min(Number(count) || 6, 30));
        const lines = msgs.slice(-n).map((m) => `## ${m.role}\n${m.text.length > 3000 ? `${m.text.slice(0, 3000)}…` : m.text}`);
        return [`${threadId} · "${t.title}" · ${t.resolved ? 'resolved' : this.liveStatus(t.sessionId)} · ${describeRoute(t.model, t.effort)}`, ...lines].join('\n\n');
    }

    async updateThread(projectId, threadId, changes) {
        const t = this.requireThread(projectId, threadId);
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
        }
        if (changes.resolved !== undefined) {
            fields.resolved = changes.resolved === true;
            out.push(fields.resolved ? 'resolved' : 'reopened');
        }
        if (Object.keys(fields).length > 0) this.store.putThread(projectId, threadId, fields);
        if (changes.stop === true) {
            await this.sc.cancel({ sessionId: t.sessionId });
            out.push('current turn stopped (queued messages kept)');
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
        let catalog;
        for (const [mKey, eKey] of pairs) {
            if (changes[mKey] === undefined && changes[eKey] === undefined) continue;
            catalog ??= await this.catalog();
            const model = changes[mKey] === undefined ? current[mKey].value : val(changes[mKey]);
            const effort = changes[eKey] === undefined ? current[eKey].value : val(changes[eKey]);
            const check = checkSelection(catalog, model, effort);
            if (!check.ok) throw new ProjectError(check.error);
            if (changes[mKey] !== undefined) next[mKey] = changes[mKey] === 'default' ? undefined : check.model;
            if (changes[eKey] !== undefined) next[eKey] = changes[eKey] === 'default' ? undefined : check.effort;
        }
        const wasPaused = this.paused(projectId);
        if (changes.paused !== undefined) next.paused = changes.paused;
        this.store.putSettings(projectId, next);
        let flushed = 0;
        if (wasPaused && !this.paused(projectId)) flushed = await this.flushPending(projectId);
        this.log(`settings ${projectId} ${Object.keys(next).join(',')}`);
        const s = this.settings(projectId);
        return [
            `Coordinator: ${describeRoute(s.coordinatorModel.value, s.coordinatorEffort.value)} (${s.coordinatorModel.source} / ${s.coordinatorEffort.source})`,
            `New threads: ${describeRoute(s.threadModel.value, s.threadEffort.value)} (${s.threadModel.source} / ${s.threadEffort.source})`,
            `Paused: ${this.paused(projectId) ? 'yes' : 'no'}${flushed ? ` (delivered ${flushed} held handbacks)` : ''}`,
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
        if (!add && action === 'append') throw new ProjectError('text is required');
        const body = action === 'append' ? `${this.readMemory(projectId).replace(/\s*$/, '')}\n${add}\n`.replace(/^\n/, '') : `${add}\n`;
        if (Buffer.byteLength(body) > this.config.maxMemoryBytes) {
            throw new ProjectError(`memory would exceed ${this.config.maxMemoryBytes} bytes; summarize it with action "replace"`);
        }
        mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
        writeFileSync(path, body, { mode: 0o600 });
        this.log(`memory ${projectId} ${action} bytes=${statSync(path).size}`);
        return `Project memory ${action === 'append' ? 'appended' : 'replaced'} (${Buffer.byteLength(body)} bytes).`;
    }

    async handback(projectId, threadId, agentId, status, summary) {
        if (!HANDBACK_STATUSES.includes(status)) throw new ProjectError(`status must be one of ${HANDBACK_STATUSES.join(', ')}`);
        const text = String(summary ?? '').trim();
        if (!text) throw new ProjectError('summary is required');
        const t = this.requireThread(projectId, threadId);
        if (!this.allowHandback(projectId, threadId)) {
            throw new ProjectError(`handback limit reached (${this.config.maxHandbacksPerHour} per hour); finish the work and hand back once`);
        }
        this.store.putThread(projectId, threadId, { lastHandback: { status, summary: text.slice(0, 500), at: new Date().toISOString() } });
        if (status !== 'progress') {
            const state = this.turns.get(agentId);
            if (state) state.handedBack = true;
        }
        const outcome = await this.deliver(projectId, handbackMessage(threadId, t.title, status, text));
        this.log(`handback ${projectId}/${threadId} status=${status} chars=${text.length} ${outcome}`);
        return outcome === 'delivered'
            ? 'Handback delivered to the coordinator.'
            : 'Handback saved; the coordinator gets it when the project resumes.';
    }
}
