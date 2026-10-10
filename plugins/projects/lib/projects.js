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
 * model. The picker's public path (`sessionController.selectModel`) also
 * overwrites the global default model, so the manager calls the controller's
 * per-session step directly. When a Host does not have that step, it falls
 * back to rewriting every model request of project sessions.
 *
 * The binding runs both ways: a model the user picks in DSH's own picker for
 * a coordinator becomes the project's coordinator setting, and one picked
 * for a thread becomes that thread's, so the project's settings always say
 * what its sessions run on.
 *
 * The plugin's messages go into a session the way DSH's own agents and
 * plugins send theirs, not as the user's: a brief or a coordinator's message
 * is an agent's message from the coordinator, a handback one from the
 * thread, and the automatic notes and the welcome are a plugin's message.
 * DSH draws each as a collapsed notice ("Task message received", "Plugin
 * status updated") instead of a user bubble; the model reads the same text.
 *
 * @module dsh-plugin-projects/projects
 */
import { appendFileSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ProjectStore, expand, dataPath, dshHome, ensurePrivateDir } from './store.js';
import { SETTING_KEYS, effectiveSettings, applyRoute, checkSelection, describeRoute, parseModelSpec, pluginDefaults } from './settings.js';
import {
    coordinatorPolicy, threadPolicy, rosterLines, briefMessage, coordinatorMessage,
    handbackMessage, idleMessage, approvalMessage, welcomeMessage, describeEnding, endingStateOf, continueMessage, HANDBACK_STATUSES, TAGS, STOPPED_BY_USER,
} from './prompts.js';
import { META_MARK, MAX_THREADS } from './projection.js';
import { changeRecord, changeTotals, withChange } from './changes.js';
import { planFleetShellImport } from './fleet-shell.js';

/** Order of the project section in the assembled system prompt (after first-party guidance). */
const SECTION_ORDER = 9500;
const HOUR = 60 * 60 * 1000;
/** DSH keeps a session title to 80 bytes of UTF-8 (`maxTitleBytes` in its base profile) and cuts anything longer. */
const TITLE_BYTES = 80;

/**
 * A thread's one title, used for its session and everywhere the plugin names it. It fits DSH's session-title
 * limit, so DSH never cuts it again; a longer title is cut once, after the last whole word that fits, with "…".
 * `cut` says the text was already cut short (by an older version), so it ends at a word with "…" even if it fits.
 */
export function clipTitle(value, { cut = false } = {}) {
    const line = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!cut && Buffer.byteLength(line) <= TITLE_BYTES) return line;
    const room = TITLE_BYTES - Buffer.byteLength('…');
    let fit = '';
    let bytes = 0;
    for (const char of line) {
        bytes += Buffer.byteLength(char);
        if (bytes > room) break;
        fit += char;
    }
    // Back up to the end of the last whole word, unless that would leave less than half.
    if (fit.length < line.length ? line[fit.length] !== ' ' : cut) {
        const space = fit.lastIndexOf(' ');
        if (space >= fit.length / 2) fit = fit.slice(0, space);
    }
    const end = fit.replace(/[\s.,;:!?…–—-]+$/u, '');
    return `${end === '' ? fit : end}…`;
}

/** A title as DSH keeps it: one line, cut at its byte limit wherever that falls. */
function dshTitle(value) {
    let out = '';
    let bytes = 0;
    for (const char of String(value ?? '').replace(/\s+/g, ' ').trim()) {
        bytes += Buffer.byteLength(char);
        if (bytes > TITLE_BYTES) break;
        out += char;
    }
    return out.trimEnd();
}

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

/** One thread as the DSH window shows it in a roster (see projection.js). */
function rosterEntry(id, t) {
    const entry = { id, session: t.sessionId, title: t.title, resolved: t.resolved === true };
    if (t.createdAt) entry.created = t.createdAt;
    if (t.lastHandback) entry.handback = { status: t.lastHandback.status, summary: String(t.lastHandback.summary ?? '').slice(0, 300), at: t.lastHandback.at ?? null };
    return entry;
}

/** Thread ids for a full roster: every open thread, then the newest resolved ones. */
function rosterIds(threads) {
    const ids = Object.keys(threads ?? {}).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const open = ids.filter((id) => !threads[id].resolved);
    const resolved = ids.filter((id) => threads[id].resolved).slice(-Math.max(MAX_THREADS - open.length, 0));
    const keep = new Set([...open, ...resolved]);
    return ids.filter((id) => keep.has(id));
}

/** The handbacks among the messages a pause holds: which thread, with what status. */
function heldHandbacks(pending) {
    const out = [];
    for (const item of Array.isArray(pending) ? pending : []) {
        const text = typeof item === 'string' ? item : typeof item?.text === 'string' ? item.text : '';
        const m = /^\[Handback from thread (t\d+) · ".*" · status: ([a-z_]+)\]$/.exec(text.split('\n', 1)[0]);
        if (m) out.push({ thread: m[1], status: m[2] });
    }
    return out;
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

/** Request ids of the prompts earlier versions sent as the user's; they mark coordinator-driven turns. */
const RPC_PREFIX = 'projects-';

/** Who a plugin message comes from, as DSH records its own: an agent (a session) or a plugin. */
const agentSource = (senderSessionId) => ({ kind: 'agent-message', form: 'relay', senderSessionId });
const PLUGIN_SOURCE = Object.freeze({ kind: 'cordis-host-runner' });
const PLUGIN_KINDS = new Set(['agent-message', PLUGIN_SOURCE.kind]);
const PROJECT_TAGS = Object.values(TAGS);

/**
 * A prompt someone sent to the session, or null. The user's own messages
 * have source kind "user"; so did this plugin's before it sent them as an
 * agent's or a plugin's message. Other user-role messages DSH adds (runtime
 * context, model-change notices, its own agents' messages) are not prompts.
 */
function promptOf(event) {
    if (roleOf(event) !== 'user') return null;
    const source = (event?.data?.message ?? event?.data)?.source;
    const text = textOf(event);
    if (!text) return null;
    if (source?.kind === undefined || source.kind === 'user') {
        const fromProject = String(source?.rpcId ?? '').startsWith(RPC_PREFIX) || text.startsWith(TAGS.brief) || text.startsWith(TAGS.coordinator);
        return { text, fromProject };
    }
    if (PLUGIN_KINDS.has(source.kind) && PROJECT_TAGS.some((tag) => text.startsWith(tag))) return { text, fromProject: true };
    return null;
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

/** What the manager stored as a coordinator's applied route, to tell when its settings changed. */
function routeKey(model, effort) {
    return JSON.stringify([model ?? null, effort ?? null]);
}

/** A model selection as one comparable string. */
function selectionKey(selection) {
    return `${selection?.provider}\u0000${selection?.model}\u0000${selection?.reasoningEffort ?? ''}`;
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
        this.logFile = config.logFile ? dataPath(config.logFile) : '';
        if (this.logFile) {
            try { ensurePrivateDir(dirname(this.logFile)); } catch {}
        }
        /**
         * 'session': set models with the controller's per-session selection.
         * 'override': this Host lacks it; rewrite each project model request.
         */
        this.selectionMode = typeof ctx.sessionController?.agents?.selectForNextRequest === 'function' ? 'session' : 'override';
        /**
         * projectId → the project: a row in the profile, which always has a
         * coordinator, or one made on the Projects page or imported, which
         * gets one when the user adds it.
         */
        this.projects = new Map();
        for (const row of config.projects ?? []) {
            const id = slugify(row.id || row.name);
            if (this.projects.has(id)) {
                this.log(`config duplicate project id ${id}; keeping the first row`);
                ctx.logger?.warn?.('projects: two projects have the id "%s"; only the first runs. Give the other an id.', id);
                continue;
            }
            this.projects.set(id, { ...row, id, source: 'profile', workspacePath: expand(row.workspacePath) });
        }
        for (const id of Object.keys(this.store.projects)) this.addStored(id);
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
        /** sessionId → the selection the manager just made there, so its own `model/selection` is not taken for the user's pick. */
        this.ownSelections = new Map();
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

    /**
     * Add a project the store defines (made on the Projects page or
     * imported) to the running set. A profile row with the same id wins.
     * Its folder is its coordinator's workspace, else its first one.
     */
    addStored(projectId) {
        const stored = this.store.projects[projectId];
        if (typeof stored?.name !== 'string' || stored.name.trim() === '' || this.projects.has(projectId)) return;
        const manager = this;
        this.projects.set(projectId, {
            id: projectId,
            goal: '',
            source: stored.source === 'import' ? 'import' : 'page',
            get name() { return manager.store.projects[projectId]?.name ?? projectId; },
            get workspacePath() { return manager.homeOf(projectId)?.path; },
        });
    }

    /** Whether the project is a row in the profile (its name, folder and coordinator are set there). */
    fromProfile(projectId) {
        return this.projects.get(projectId)?.source === 'profile';
    }

    /** DSH's workspace with this id, or undefined. */
    workspace(workspaceId) {
        try {
            return typeof workspaceId === 'string' && workspaceId !== '' ? this.ctx.workspaceRegistry?.get?.(workspaceId) : undefined;
        } catch {
            return undefined;
        }
    }

    /** DSH's workspaces in its own (sidebar) order. */
    workspaceList() {
        try {
            const list = this.ctx.workspaceRegistry?.list?.();
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    }

    /**
     * The workspaces in a project, in DSH's order: the ones it holds, with a
     * profile project's own folder among them once DSH has it.
     */
    workspacesIn(projectId) {
        const ids = new Set(this.store.workspacesOf(projectId));
        const home = this.store.projects[projectId]?.home;
        if (this.fromProfile(projectId) && typeof home === 'string') ids.add(home);
        return this.workspaceList().filter((ws) => ids.has(ws.id));
    }

    /** The workspace a project's coordinator works in: its home, else its first workspace. */
    homeOf(projectId) {
        const home = this.workspace(this.store.projects[projectId]?.home);
        if (home && (this.fromProfile(projectId) || this.store.workspaceOf[home.id] === projectId)) return home;
        return this.workspacesIn(projectId)[0];
    }

    /**
     * Note which DSH workspace a profile project's folder is, once DSH has
     * one there: it counts among the project's workspaces, and no other
     * project can hold it.
     */
    async noteHome(projectId) {
        if (!this.fromProfile(projectId)) return;
        let ws;
        try { ws = await this.ctx.workspaceRegistry.resolveByPath(this.project(projectId).workspacePath); } catch { ws = undefined; }
        if (!ws?.id) return;
        const stored = this.store.project(projectId);
        if (stored.home !== ws.id) this.store.putProject(projectId, { home: ws.id });
        if (this.store.workspaceOf[ws.id] !== projectId) this.store.placeWorkspace(ws.id, projectId);
    }

    settings(projectId) {
        return effectiveSettings(pluginDefaults(this.config), this.project(projectId), this.store.project(projectId).settings);
    }

    /**
     * Compare the project's row in the profile with the one this project
     * last saw. A model or effort the row changed since (an edit by hand)
     * replaces the project's own setting of it, made in its Project settings,
     * in its coordinator's model picker or through the coordinator: all of
     * them are this project's, so the newest wins. The plugin defaults never
     * replace a project's own setting. The first look only records.
     * @returns {string[]} the settings whose project setting was replaced.
     */
    noteProjectRow(projectId) {
        // Empty means "use the default", however it is written.
        const plain = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
        const row = this.project(projectId);
        const p = this.store.project(projectId);
        const seen = p.rowSeen;
        const changed = SETTING_KEYS.filter((key) => plain(row[key]) !== plain(seen?.[key]));
        if (seen && changed.length === 0) return [];
        const replaced = seen ? changed.filter((key) => p.settings[key] !== undefined) : [];
        if (replaced.length) this.store.putSettings(projectId, Object.fromEntries(replaced.map((key) => [key, undefined])));
        this.store.putProject(projectId, { rowSeen: Object.fromEntries(SETTING_KEYS.map((key) => [key, plain(row[key])])), defaultsSeen: undefined });
        if (seen) this.log(`row ${projectId} ${changed.join(',')}${replaced.length ? ` replaced ${replaced.join(',')}` : ''}`);
        return replaced;
    }

    /**
     * The plugin defaults changed while the plugin runs (DSH's settings page
     * saved them). A coordinator that runs on a default switches from its
     * next request; new threads start with the new defaults, and running
     * threads keep theirs. A project's own settings stay.
     */
    async onDefaultsChanged() {
        this.log('defaults saved');
        for (const projectId of this.projects.keys()) {
            if (this.disposed) return;
            try {
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
        let value;
        if (this.catalogCache && Date.now() - this.catalogCache.at < 30000) {
            value = this.catalogCache.value;
        } else {
            try { value = await this.sc.modelCatalog(); } catch { value = undefined; }
            this.catalogCache = value ? { value, at: Date.now() } : null;
        }
        // The DSH default changes with every pick in DSH's model picker, so
        // checks use the current one, the same one fullSelection builds on.
        let current;
        try { current = this.ctx.get?.('agentDefaultModel')?.currentSelection?.(); } catch {}
        if (!value || !current?.provider || !current?.model) return value;
        if (value.default?.provider === current.provider && value.default?.model === current.model) return value;
        return { ...value, default: { provider: current.provider, model: current.model } };
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    /**
     * Attach to live agents, make sure every project has a coordinator,
     * deliver held messages, and review thread turns that ended while the
     * plugin was not watching (DSH stopped or the plugin reloaded mid-turn).
     */
    async start() {
        for (const agent of this.ctx.agents.list?.() ?? []) this.maybeInstall(agent);
        // Profile projects claim their folders before an import places any workspace.
        for (const id of this.projects.keys()) await this.noteHome(id);
        if (this.disposed) return;
        await this.importFleetShell();
        for (const id of [...this.projects.keys()]) {
            if (this.disposed) return;
            // A project made on the Projects page or imported runs a coordinator only once the user adds one.
            if (!this.fromProfile(id) && !this.store.projects[id]?.coordinatorSessionId) continue;
            try {
                if (this.fromProfile(id)) this.noteProjectRow(id);
                const sessionId = await this.ensureCoordinator(id);
                if (!sessionId) continue;
                await this.noteHome(id);
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
        if (!this.disposed) await this.plainThreadTitles();
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

    /**
     * Threads started before thread sessions lost the project's name in
     * front ("Storefront › Fix login") keep it until renamed. Once per
     * project, a thread session still titled exactly that is renamed to the
     * thread's own title; a title the user changed is left as it is.
     */
    async plainThreadTitles() {
        try {
            const todo = [...this.projects.keys()].filter((id) => this.store.project(id).plainTitles !== true);
            if (todo.length === 0) return;
            const old = new Map();
            for (const projectId of todo) {
                const name = this.project(projectId).name;
                for (const [threadId, t] of Object.entries(this.store.project(projectId).threads ?? {})) {
                    const was = t?.title;
                    if (typeof was !== 'string' || was === '') continue;
                    // Older versions cut titles at 80 characters, mid-word and without "…".
                    const title = clipTitle(was, { cut: was.length >= 80 });
                    if (title !== was) this.store.putThread(projectId, threadId, { title });
                    if (typeof t.sessionId === 'string') old.set(t.sessionId, { from: dshTitle(`${name} › ${was}`), to: title });
                }
            }
            let renamed = 0;
            if (old.size > 0) {
                const { items } = await this.sc.list({}, AbortSignal.timeout(20000));
                const titles = new Map((Array.isArray(items) ? items : []).map((item) => [item?.sessionId, item?.projections?.values?.title]));
                for (const [sessionId, { from, to }] of old) {
                    if (this.disposed) return;
                    let now = titles.get(sessionId);
                    if (typeof now !== 'string') now = await this.sessionTitle(sessionId).catch(() => undefined);
                    if (now !== from) continue;
                    await this.sc.rename({ sessionId, title: to }).then(() => { renamed += 1; }, () => {});
                }
            }
            for (const projectId of todo) this.store.putProject(projectId, { plainTitles: true });
            this.log(`thread-titles renamed=${renamed}`);
        } catch (error) {
            this.log(`error thread-titles ${String(error?.message ?? error).slice(0, 300)}`);
        }
    }

    /** A session's title as DSH lists it, else as its log has it; undefined when neither says. */
    async currentTitle(sessionId) {
        try {
            const { items } = await this.sc.list({}, AbortSignal.timeout(20000));
            const title = (Array.isArray(items) ? items : []).find((item) => item?.sessionId === sessionId)?.projections?.values?.title;
            if (typeof title === 'string') return title;
        } catch {}
        return this.sessionTitle(sessionId).catch(() => undefined);
    }

    /** A session's title as its log has it (its newest title event), or undefined. */
    async sessionTitle(sessionId) {
        const { events } = await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
        for (let i = (events?.length ?? 0) - 1; i >= 0; i--) {
            if (events[i]?.type === 'session/title' && typeof events[i].data?.title === 'string') return events[i].data.title;
        }
        return undefined;
    }

    /**
     * Once, bring in the projects of the all-in-one mod's old sidebar
     * (`<DSH home>/fleet-shell/state.json`): each old project becomes a
     * project here, in the same order, without a coordinator, holding the
     * same DSH workspaces. A name that is already a project here joins it.
     * A workspace DSH no longer has, or one already in a project here, stays
     * where it is. The old file is only read.
     */
    async importFleetShell() {
        if (this.store.imports.fleetShell) return;
        const file = join(dshHome(), 'fleet-shell', 'state.json');
        let state;
        try {
            state = JSON.parse(readFileSync(file, 'utf8'));
        } catch (error) {
            if (error?.code !== 'ENOENT') this.log(`error import fleet-shell ${String(error?.message ?? error).slice(0, 200)}`);
            return;
        }
        const plan = planFleetShellImport(state, {
            names: new Map([...this.projects.values()].map((p) => [String(p.name).trim().toLowerCase(), p.id])),
            known: (workspaceId) => Boolean(this.workspace(workspaceId)),
            placed: (workspaceId) => Boolean(this.store.workspaceOf[workspaceId]),
        });
        let made = 0;
        let placed = 0;
        for (const group of plan.groups) {
            let id = group.join;
            if (!id) {
                id = this.makeProject(group.name, 'import', { importedFrom: group.from });
                made += 1;
            }
            for (const workspaceId of group.workspaces) {
                this.store.workspaceOf[workspaceId] = id;
                placed += 1;
            }
        }
        const joined = plan.groups.length - made;
        const skipped = plan.skipped.length;
        this.store.putImport('fleetShell', { at: new Date().toISOString(), file, projects: made, joined, workspaces: placed, skipped });
        this.log(`import fleet-shell projects=${made} joined=${joined} workspaces=${placed} skipped=${skipped}`);
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

    /** Create one ordinary session in the project's workspace, or another folder of it. */
    async createSession(project, folder = project.workspacePath) {
        const ws = await this.ctx.workspaceRegistry.create(folder);
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
    async ensureCoordinator(projectId, { create = this.fromProfile(projectId) } = {}) {
        const key = `${this.store.file}#${projectId}`;
        while (ensuring.has(key)) await ensuring.get(key).catch(() => {});
        const run = this.ensureCoordinatorOnce(projectId, create);
        ensuring.set(key, run);
        try {
            return await run;
        } finally {
            if (ensuring.get(key) === run) ensuring.delete(key);
        }
    }

    /**
     * @param {boolean} create - make a coordinator when there is none: always
     *   for a profile project; for one made on the Projects page, only when the
     *   user adds it. Without, a coordinator session that is gone (deleted in
     *   DSH) leaves the project without one.
     */
    async ensureCoordinatorOnce(projectId, create) {
        const project = this.project(projectId);
        const stored = this.store.project(projectId);
        if (await this.exists(stored.coordinatorSessionId)) {
            const live = this.ctx.agents.get(stored.coordinatorSessionId);
            if (live) this.maybeInstall(live);
            await this.applyCoordinatorRoute(projectId);
            this.log(`coordinator ${projectId} ${stored.coordinatorSessionId} resumed`);
            await this.welcome(projectId, stored.coordinatorSessionId, false);
            return stored.coordinatorSessionId;
        }
        if (!create) {
            if (stored.coordinatorSessionId) {
                this.store.putProject(projectId, { coordinatorSessionId: undefined, welcomedSession: undefined });
                this.log(`coordinator ${projectId} gone`);
            }
            return null;
        }
        if (typeof project.workspacePath !== 'string' || project.workspacePath === '') {
            throw new ProjectError(`"${project.name}" has no workspace for its coordinator to work in; move one into it first`);
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
        await this.welcome(projectId, sessionId, true);
        return sessionId;
    }

    /**
     * Give a coordinator its first turn: it introduces itself. DSH lists a
     * session only once it has had a turn, so until then the user can't find
     * the coordinator in the sidebar to talk to it. Once per coordinator
     * session; held like any message while the project is paused.
     * @param {boolean} fresh - the session was just created, so it has had no turn.
     */
    async welcome(projectId, sessionId, fresh) {
        if (!this.config.welcome) return;
        const stored = this.store.project(projectId);
        if (stored.welcomedSession === sessionId) return;
        if (!fresh) {
            // A coordinator from before this check: welcome it only if it never had a turn.
            let used;
            try {
                const events = (await this.sc.inspect(sessionId, AbortSignal.timeout(20000))).events ?? [];
                used = events.some((e) => e?.type === 'turn/start') || stored.pendingHandbacks.length > 0;
            } catch (error) {
                this.log(`error welcome ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
                return;
            }
            if (used) {
                this.store.putProject(projectId, { welcomedSession: sessionId });
                return;
            }
        }
        this.store.putProject(projectId, { welcomedSession: sessionId });
        const outcome = await this.deliver(projectId, welcomeMessage(this.project(projectId).name));
        this.log(`welcome ${projectId} ${sessionId} ${outcome}`);
    }

    /**
     * Send a session a message, waking it when idle, as DSH's own agents and
     * scheduled tasks do. Done once the session log has it.
     * @param {'queue'|'steer'} mode - its next turn, or into the turn running now.
     * @param {string} [from] - the session it comes from (an agent's message,
     *   which also tells a thread's projection its coordinator), or none for
     *   the plugin's own notes.
     */
    async prompt(sessionId, text, mode = 'queue', from = undefined) {
        const found = await this.sc.resolveAgent(sessionId);
        if (!found?.agent) throw new Error(`session ${sessionId} is not available: ${found?.error?.message ?? found?.error?.code ?? 'not found'}`);
        this.maybeInstall(found.agent);
        const message = createUserMessage({ content: [{ type: 'text', text }], source: from ? agentSource(from) : PLUGIN_SOURCE });
        if (mode === 'steer') found.agent.steer(message);
        else found.agent.followup(message);
        const sessions = this.ctx.get?.('sessions');
        if (typeof sessions?.flush === 'function' && found.agent.session && !await sessions.flush(found.agent.session)) {
            throw new Error(`session ${sessionId} did not save the message`);
        }
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
            } else {
                add(scoped.on('session/event', (_session, event) => {
                    if (event?.type === 'model/selection') this.onSelection(who, agent, event.data);
                }));
            }
            add(() => this.ownSelections.delete(agent.id));
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

    /**
     * The route checked against the catalog. An effort the model lacks is
     * dropped or fitted to the nearest level it offers, so a default model
     * that changed under an inherited effort still runs.
     */
    async checkedRoute(who) {
        const route = this.routeFor(who);
        if (!route || (!route.model && !route.effort)) return route;
        const check = checkSelection(await this.catalog(), route.model, route.effort, { fit: true });
        if (check.ok && check.fitted) this.log(`fit ${who.projectId}/${who.threadId ?? 'coordinator'} ${check.note}`);
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
     * @returns the selection recorded, or false.
     */
    async selectRoute(agent, who) {
        if (this.selectionMode !== 'session' || !agent) return false;
        const label = `${who.projectId}/${who.threadId ?? 'coordinator'}`;
        try {
            const wanted = this.fullSelection(await this.checkedRoute(who));
            if (!wanted) throw new Error('no DSH default model to build on');
            const selection = await this.resolveSelection(wanted);
            this.ownSelections.set(agent.id, selectionKey(selection));
            this.sc.agents.selectForNextRequest(agent, selection);
            this.log(`select ${label} ${selection.provider}:${selection.model} effort=${selection.reasoningEffort ?? '-'}`);
            return selection;
        } catch (error) {
            this.ownSelections.delete(agent.id);
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
        const key = routeKey(s.coordinatorModel.value, s.coordinatorEffort.value);
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

    /**
     * A `model/selection` on a project session. One the manager made itself
     * is skipped. Any other is the user's pick in DSH's own model picker
     * (the composer's model menu or /model): on a coordinator it becomes the
     * project's coordinator model and effort, on a thread that thread's, so
     * the project's settings say what its sessions run on.
     */
    onSelection(who, agent, data) {
        try {
            if (typeof data?.provider !== 'string' || typeof data?.model !== 'string' || !this.projects.has(who.projectId)) return;
            if (this.ownSelections.get(agent.id) === selectionKey(data)) {
                this.ownSelections.delete(agent.id);
                return;
            }
            const model = `${data.provider}:${data.model}`;
            const effort = typeof data.reasoningEffort === 'string' && data.reasoningEffort !== '' ? data.reasoningEffort : undefined;
            if (who.role === 'coordinator') {
                this.store.putSettings(who.projectId, { coordinatorModel: model, coordinatorEffort: effort });
                // It already runs on the pick, so nothing selects it again.
                const s = this.settings(who.projectId);
                this.store.putProject(who.projectId, { coordinatorRoute: routeKey(s.coordinatorModel.value, s.coordinatorEffort.value) });
            } else {
                if (!this.store.thread(who.projectId, who.threadId)) return;
                this.store.putThread(who.projectId, who.threadId, { model, effort });
            }
            this.log(`picked ${who.projectId}/${who.threadId ?? 'coordinator'} ${model} effort=${effort ?? '-'}`);
        } catch (error) {
            this.log(`error picked ${who.projectId} ${String(error?.message ?? error).slice(0, 200)}`);
        }
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
            folders: this.workspacesIn(projectId).map((ws) => ws.path).filter((path) => path !== project.workspacePath),
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
        // The coordinator stopped this turn itself, so a note would only echo that back.
        const byCoordinator = Boolean(stopped && stopped.key === turn.key && turn.endKind === 'aborted');
        // A person stopped it, in DSH or through the session bridge: it stays stopped until they resume it.
        const byUser = !byCoordinator && turn.endKind === 'aborted' && turn.stopCause === 'user';
        if (turn.ended) {
            if (t.seenTurn === turn.key) return;
            // How the turn ended, for the coordinator's roster: kept while it failed or stopped.
            const text = byUser ? STOPPED_BY_USER : turn.ending;
            const ending = !turn.handedBack && endingStateOf(text) ? text.slice(0, 400) : undefined;
            this.store.putThread(projectId, threadId, {
                seenTurn: turn.key,
                lastEnding: ending ? { text: ending, kind: turn.endKind, at: new Date().toISOString() } : undefined,
            });
        }
        if (turn.handedBack || byCoordinator) return;
        if (byUser) {
            // No note, so the coordinator takes no turn and can't send it on by itself.
            this.log(`user-stop ${projectId}/${threadId}`);
            return;
        }
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
        if (event?.type === 'model/selection') {
            this.onSelection({ projectId, role: 'thread', threadId }, agent, event.data);
            return;
        }
        if (event?.type === 'workspace/changes') {
            this.noteChanges(projectId, threadId, agent.id, event.seq);
            return;
        }
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

    /**
     * A thread turn changed files, as DSH announced it: keep its summary
     * with the thread, so the window can show the thread's changes after DSH
     * restarts too (DSH keeps its own copy only while the session lives).
     * DSH stores the summary right after the event, so read it a moment later.
     */
    noteChanges(projectId, threadId, sessionId, seq, attempt = 0) {
        const timer = setTimeout(() => {
            let summary;
            try { summary = this.ctx.get?.('workspaceChanges')?.summary?.(sessionId, seq); } catch {}
            if (summary === undefined) {
                if (attempt < 3) this.noteChanges(projectId, threadId, sessionId, seq, attempt + 1);
                return;
            }
            const record = changeRecord(seq, summary);
            try {
                const t = this.store.thread(projectId, threadId);
                if (!record || !t) return;
                this.store.putThread(projectId, threadId, { changes: withChange(t.changes, record) });
            } catch (error) {
                // A throw in a timer would end DSH's Host.
                this.log(`error changes ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                return;
            }
            this.log(`changes ${projectId}/${threadId} turn=${record.turn} files=${record.total} +${record.added} -${record.deleted}`);
        }, attempt === 0 ? 0 : 200 * 2 ** attempt);
        timer.unref?.();
    }

    /**
     * A thread's changes as the window shows them: totals over its turns,
     * and whether DSH can still show the newest turn's diff.
     */
    threadChanges(t) {
        const totals = changeTotals(t.changes);
        if (!totals) return null;
        let reviewable = false;
        try { reviewable = typeof t.sessionId === 'string' && this.ctx.get?.('workspaceChanges')?.summary?.(t.sessionId, totals.last.seq) !== undefined; } catch {}
        return { ...totals, reviewable };
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
        await this.deliver(projectId, approvalMessage(threadId, t.title, t.title, String(data.toolName ?? 'a tool'), data.reason));
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
            // Who stopped a stopped turn: 'user' when a person did (DSH's stop button, the session bridge) or the coordinator did.
            stopCause: reason?.kind === 'aborted' && typeof reason.reason?.kind === 'string' ? reason.reason.kind : undefined,
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
     * @param {string} [from] - the thread session it comes from; none for the plugin's own notes.
     * @returns {Promise<'delivered'|'held'>}
     */
    deliver(projectId, text, from = undefined) {
        return this.serial(projectId, async () => {
            const pending = this.store.project(projectId).pendingHandbacks;
            this.store.putProject(projectId, { pendingHandbacks: [...pending, from ? { text, from } : text] });
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
            // A held message is its text (the plugin's own note) or {text, from} (a thread's handback).
            const next = this.store.project(projectId).pendingHandbacks[0];
            const text = typeof next === 'string' ? next : typeof next?.text === 'string' ? next.text : '';
            try {
                if (text.trim() !== '') await this.prompt(sessionId, text, 'queue', typeof next?.from === 'string' ? next.from : undefined);
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
            // DSH quits on any unhandled rejection in the Host, so a failed flush is only logged.
            void this.flushPending(projectId).catch((error) => {
                this.log(`error flush ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            });
        }, delay);
        retry.timer.unref?.();
        this.retries.set(projectId, retry);
    }

    // ── what the DSH window draws ──────────────────────────────────────────

    /**
     * What a project tool result records for the DSH window: its presentation
     * meta, which the `projectSession` projection folds (projection.js). It
     * names the project and the session's role; for a coordinator it carries
     * the roster entries the call touched (all of them with `full`), and
     * `action` is the card the call's turn shows. Never throws: a tool's
     * result must not fail over its picture.
     * @param {string} projectId
     * @param {{role: 'coordinator'|'thread', threadId?: string}} who
     * @param {{action?: object, threads?: string[], full?: boolean}} [details]
     * @returns {object|null}
     */
    view(projectId, who, details = {}) {
        try {
            const project = this.projects.get(projectId);
            if (!project) return null;
            const stored = this.store.project(projectId);
            const out = { [META_MARK]: 1, role: who.role, project: { id: projectId, name: project.name } };
            if (stored.coordinatorSessionId) out.coordinator = stored.coordinatorSessionId;
            if (who.role === 'thread') {
                out.thread = { id: who.threadId, title: stored.threads[who.threadId]?.title ?? who.threadId };
            } else {
                const ids = details.full ? rosterIds(stored.threads) : (details.threads ?? []).filter((id) => stored.threads[id]);
                out.threads = ids.map((id) => rosterEntry(id, stored.threads[id]));
                if (details.full) out.full = true;
            }
            if (details.action) out.action = details.action;
            return out;
        } catch (error) {
            this.log(`error view ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            return null;
        }
    }

    /**
     * The projection's starting value for a session this store knows, so a
     * coordinator or thread from before the projection existed shows its
     * project and threads the first time DSH folds it.
     * @param {string} sessionId
     */
    seedView(sessionId) {
        const who = this.store.lookup(sessionId);
        if (!who || !this.projects.has(who.projectId)) return null;
        return this.view(who.projectId, who, who.role === 'coordinator' ? { full: true } : {});
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

    /**
     * One of the project's folders, named by its path, its workspace's title
     * or its folder name; undefined (the project workspace) when none is named.
     */
    folderOf(projectId, folder) {
        const wanted = typeof folder === 'string' ? folder.trim().replace(/[\\/]+$/, '') : '';
        if (wanted === '') return undefined;
        const spaces = this.workspacesIn(projectId);
        const lower = wanted.toLowerCase();
        const base = (path) => String(path).split(/[\\/]+/).filter(Boolean).pop() ?? '';
        const ws = spaces.find((w) => w.path === wanted || w.path === expand(wanted))
            ?? spaces.find((w) => String(w.title).toLowerCase() === lower || base(w.path).toLowerCase() === lower);
        if (!ws) {
            const names = spaces.map((w) => w.path).join(', ');
            throw new ProjectError(`"${wanted.slice(0, 80)}" is not one of this project's folders${names ? ` (${names})` : ''}`);
        }
        return ws.path;
    }

    async startThread(projectId, { title, brief, model, effort, folder }) {
        const project = this.project(projectId);
        if (this.paused(projectId)) throw new ProjectError('the project is paused; new threads are blocked until it resumes');
        const cleanTitle = clipTitle(title);
        if (!cleanTitle) throw new ProjectError('title is required');
        if (!String(brief ?? '').trim()) throw new ProjectError('brief is required');
        const where = this.folderOf(projectId, folder);
        const s = this.settings(projectId);
        // Not given, or "default": the project's thread default.
        const given = (value) => value !== undefined && value !== 'default';
        const or = (value, fallback) => (given(value) ? value : fallback);
        // An effort the model lacks never stops a start: it runs at the nearest
        // level and the result says so. Only an effort no model offers is refused.
        const check = checkSelection(await this.catalog(), or(model, s.threadModel.value), or(effort, s.threadEffort.value),
            { fit: given(effort) ? 'known' : true });
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
        const sessionId = await this.createSession(project, where);
        this.store.putThread(projectId, threadId, {
            sessionId, title: cleanTitle, model: check.model, effort: check.effort,
            resolved: false, createdAt: new Date().toISOString(), handbackTimes: [], seenTurn: null,
        });
        const agent = await this.attach(sessionId);
        const notes = check.note ? [check.note] : [];
        if (this.selectionMode === 'session') {
            const applied = await this.selectRoute(agent, { projectId, role: 'thread', threadId });
            if (!applied) {
                if (check.model || check.effort) notes.push('the model could not be set, so the thread runs on the DSH default (details in the projects log)');
            } else if (!check.model || (!check.effort && applied.reasoningEffort)) {
                // The thread keeps what it started on, even when the DSH default changes later, so record it.
                this.store.putThread(projectId, threadId, {
                    model: check.model ?? `${applied.provider}:${applied.model}`,
                    effort: check.effort ?? applied.reasoningEffort,
                });
            }
        }
        await this.sc.rename({ sessionId, title: cleanTitle }).catch(() => {});
        await this.prompt(sessionId, briefMessage(project.name, threadId, cleanTitle, brief.trim()), 'queue', this.store.project(projectId).coordinatorSessionId);
        this.log(`thread-start ${projectId}/${threadId} ${sessionId} brief-chars=${brief.length}`);
        return { threadId, sessionId, title: cleanTitle, route: describeRoute(check.model, check.effort), notes };
    }

    async sendToThread(projectId, threadId, text, steer) {
        const { id, t } = this.requireThread(projectId, threadId);
        if (!String(text ?? '').trim()) throw new ProjectError('text is required');
        if (t.resolved) this.store.putThread(projectId, id, { resolved: false });
        await this.attach(t.sessionId);
        await this.prompt(t.sessionId, coordinatorMessage(text.trim()), steer ? 'steer' : 'queue', this.store.project(projectId).coordinatorSessionId);
        this.log(`thread-send ${projectId}/${id} mode=${steer ? 'steer' : 'queue'} chars=${text.length}`);
        return `${steer ? 'Steered' : 'Sent to'} ${id}${t.resolved ? ' (reopened)' : ''}.`;
    }

    /**
     * Run a thread again after its last turn failed or stopped: Retry and
     * Resume in the DSH window. The thread hears it from its coordinator,
     * so its handback, or the idle note, reaches the coordinator as usual.
     * Refused for a resolved or running thread, and for one whose last turn
     * finished.
     * @returns the project as describeProject shows it.
     */
    async continueThread(projectId, threadKey) {
        const { id, t } = this.requireThread(projectId, threadKey);
        if (t.resolved) throw new ProjectError(`${id} is resolved`);
        if (this.ctx.agents.get(t.sessionId)?.status === 'running') throw new ProjectError(`${id} is running already`);
        const turn = await this.readTurn(t.sessionId);
        const state = turn.ended && !turn.handedBack ? endingStateOf(turn.ending) : undefined;
        if (!state) throw new ProjectError(`${id}'s last turn finished, so there is nothing to retry`);
        // As the roster tells it (a person's stop says so), once that turn was reviewed.
        const ending = t.seenTurn === turn.key && t.lastEnding?.text ? t.lastEnding.text : turn.ending;
        await this.sendToThread(projectId, id, continueMessage(ending, state === 'failed'), false);
        this.log(`thread-continue ${projectId}/${id} after=${turn.endKind}`);
        return this.describeProject(projectId);
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
            fields.title = clipTitle(changes.title);
            await this.sc.rename({ sessionId: t.sessionId, title: fields.title }).catch(() => {});
            out.push(`renamed to "${fields.title}"`);
        }
        if (changes.model !== undefined || changes.effort !== undefined) {
            const s = this.settings(projectId);
            const wantModel = changes.model === undefined ? t.model : changes.model === 'default' ? s.threadModel.value : changes.model;
            const wantEffort = changes.effort === undefined ? t.effort : changes.effort === 'default' ? s.threadEffort.value : changes.effort;
            // A new model fits the effort the thread already had; an effort given now must be offered.
            const check = checkSelection(await this.catalog(), wantModel, wantEffort,
                { fit: changes.effort === undefined || changes.effort === 'default' });
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
     * Change the project's own settings. A model or effort of "default"
     * clears it, so the project row or the plugin default applies again;
     * `paused: null` does the same for pause.
     * @param {object} changes - coordinatorModel, coordinatorEffort, threadModel, threadEffort, paused.
     * @returns {Promise<{notes: string[], flushed: number}>}
     */
    async changeSettings(projectId, changes) {
        const next = {};
        const current = this.settings(projectId);
        const val = (v) => (v === 'default' ? undefined : v);
        const pairs = [['coordinatorModel', 'coordinatorEffort'], ['threadModel', 'threadEffort']];
        const notes = [];
        let catalog;
        for (const [mKey, eKey] of pairs) {
            if (changes[mKey] === undefined && changes[eKey] === undefined) continue;
            catalog ??= await this.catalog();
            // A cleared setting is checked as what it falls back to.
            const inherited = effectiveSettings(pluginDefaults(this.config), this.project(projectId), {});
            const model = changes[mKey] === undefined ? current[mKey].value : changes[mKey] === 'default' ? inherited[mKey].value : changes[mKey];
            const effort = changes[eKey] === undefined ? current[eKey].value : changes[eKey] === 'default' ? inherited[eKey].value : changes[eKey];
            // An effort set now must be offered; one kept from before or inherited is fitted.
            const effortGiven = changes[eKey] !== undefined && changes[eKey] !== 'default';
            const check = checkSelection(catalog, model, effort, { fit: !effortGiven });
            if (!check.ok) throw new ProjectError(check.error);
            if (changes[mKey] !== undefined) next[mKey] = changes[mKey] === 'default' ? undefined : check.model;
            if (changes[eKey] !== undefined) next[eKey] = changes[eKey] === 'default' ? undefined : (check.effort ?? val(effort)?.trim());
            // The project's own effort follows a new model: fitted, or cleared when the model has no levels.
            else if (changes[mKey] !== undefined && current[eKey].source === 'project setting' && (check.fitted || check.effort === undefined)) next[eKey] = check.effort;
            if (check.note) notes.push(`${mKey === 'coordinatorModel' ? 'Coordinator' : 'Threads'}: ${check.note}.`);
        }
        const wasPaused = this.paused(projectId);
        if (changes.paused === null) next.paused = undefined;
        else if (typeof changes.paused === 'boolean') next.paused = changes.paused;
        this.store.putSettings(projectId, next);
        // Every call also retries a coordinator selection that failed before.
        if (!await this.applyCoordinatorRoute(projectId)) {
            notes.push('The coordinator model could not be switched; it keeps its current one (details in the projects log).');
        }
        let flushed = 0;
        if (wasPaused && !this.paused(projectId)) flushed = await this.flushPending(projectId);
        this.log(`settings ${projectId} ${Object.keys(next).join(',')}`);
        return { notes, flushed };
    }

    /**
     * Change settings through the coordinator's project_settings tool.
     * @returns {Promise<string>} the settings after the change, as the tool reports them.
     */
    async updateSettings(projectId, changes) {
        const { notes, flushed } = await this.changeSettings(projectId, changes);
        const s = this.settings(projectId);
        return [
            `Coordinator: ${describeRoute(s.coordinatorModel.value, s.coordinatorEffort.value)} (${s.coordinatorModel.source} / ${s.coordinatorEffort.source})`,
            `New threads: ${describeRoute(s.threadModel.value, s.threadEffort.value)} (${s.threadModel.source} / ${s.threadEffort.source})`,
            `Paused: ${this.paused(projectId) ? 'yes' : 'no'}${flushed ? ` (delivered ${flushed} held handbacks)` : ''}`,
            ...notes,
        ].join('\n');
    }

    // ── the Project settings dialog (remote.js) ────────────────────────────

    /** The project a window call names: a project id, or the id of one of its sessions. */
    // ── projects as groups of workspaces (the Projects page) ─────────────────

    /**
     * Make a project in the store, without a coordinator, and add it to the
     * running set.
     * @returns its id: the name as a slug, made unique.
     */
    makeProject(name, source, extra = {}) {
        const base = slugify(name);
        let id = base;
        for (let n = 2; this.projects.has(id) || this.store.projects[id] !== undefined; n += 1) id = `${base}-${n}`;
        const orders = Object.values(this.store.projects).map((p) => (Number.isFinite(p?.order) ? p.order : -1));
        this.store.putProject(id, { name, source, createdAt: new Date().toISOString(), order: Math.max(-1, ...orders) + 1, ...extra });
        this.addStored(id);
        this.log(`project-new ${id} ${source}`);
        return id;
    }

    /** A project name as the user typed it: one line, at most 80 bytes like a DSH title. */
    projectName(value) {
        const name = clipTitle(typeof value === 'string' ? value : '');
        if (name === '') throw new ProjectError('a project needs a name');
        return name;
    }

    /**
     * A new project from the Projects page, optionally holding a workspace.
     * @returns its id.
     */
    createProject(name, workspaceId) {
        const clean = this.projectName(name);
        if (workspaceId !== undefined && workspaceId !== null) this.checkMovable(workspaceId);
        const id = this.makeProject(clean, 'page');
        if (workspaceId !== undefined && workspaceId !== null) this.moveWorkspace(workspaceId, id);
        return id;
    }

    /** Refuse to move a workspace DSH doesn't have, or one a coordinator works in. */
    checkMovable(workspaceId) {
        const ws = this.workspace(workspaceId);
        if (!ws) throw new ProjectError('DSH has no such workspace');
        for (const id of this.projects.keys()) {
            const coordinated = this.fromProfile(id) || Boolean(this.store.projects[id]?.coordinatorSessionId);
            if (coordinated && this.homeOf(id)?.id === workspaceId) {
                throw new ProjectError(`${ws.title || 'this workspace'} is where ◆ ${this.project(id).name}'s coordinator works, so it stays in that project`);
            }
        }
        return ws;
    }

    /**
     * Put a DSH workspace in a project, or (projectId null) in none. A
     * workspace is in one project at most, so it leaves any other.
     */
    moveWorkspace(workspaceId, projectId) {
        this.checkMovable(workspaceId);
        if (projectId !== null) this.project(projectId);
        if ((this.store.workspaceOf[workspaceId] ?? null) === projectId) return;
        this.store.placeWorkspace(workspaceId, projectId);
        this.log(`workspace ${workspaceId} ${projectId ?? 'none'}`);
    }

    /** Rename a project made on the Projects page or imported; its coordinator, if any, follows. */
    async renameProject(projectId, name) {
        this.project(projectId);
        if (this.fromProfile(projectId)) throw new ProjectError('this project\'s name is set in your profile, so rename it there');
        const clean = this.projectName(name);
        const stored = this.store.project(projectId);
        const was = stored.name;
        if (clean === was) return;
        this.store.putProject(projectId, { name: clean });
        this.log(`project-rename ${projectId}`);
        const sessionId = stored.coordinatorSessionId;
        if (!sessionId) return;
        // The coordinator's title is "◆ <name>"; one the user renamed stays theirs.
        if (await this.currentTitle(sessionId) === dshTitle(`◆ ${was}`)) await this.sc.rename({ sessionId, title: `◆ ${clean}` }).catch(() => {});
    }

    /**
     * Delete a project made on the Projects page or imported. Its workspaces
     * and their sessions stay in DSH, in no project. One with a coordinator
     * keeps it: its threads would lose their project.
     */
    deleteProject(projectId) {
        const project = this.project(projectId);
        if (this.fromProfile(projectId)) throw new ProjectError('this project is set in your profile, so remove it there');
        if (this.store.projects[projectId]?.coordinatorSessionId) throw new ProjectError(`◆ ${project.name} has a coordinator, so it can't be deleted here`);
        this.store.removeProject(projectId);
        this.projects.delete(projectId);
        this.log(`project-delete ${projectId}`);
    }

    /**
     * Add a coordinator to a project made on the Projects page or imported.
     * It works in the given workspace of the project, else its first.
     * @returns the coordinator's session id.
     */
    async startCoordinator(projectId, workspaceId) {
        const project = this.project(projectId);
        const stored = this.store.project(projectId);
        if (!this.fromProfile(projectId) && !(await this.exists(stored.coordinatorSessionId))) {
            const home = workspaceId === undefined || workspaceId === null ? this.workspacesIn(projectId)[0] : this.workspace(workspaceId);
            if (!home) throw new ProjectError(`${project.name} holds no workspace yet; move one into it first`);
            if (this.store.workspaceOf[home.id] !== projectId) throw new ProjectError(`${home.title || 'that workspace'} is not in ${project.name}`);
            this.store.putProject(projectId, { home: home.id });
        }
        const sessionId = await this.ensureCoordinator(projectId, { create: true });
        if (!sessionId) throw new ProjectError('the coordinator could not start');
        return sessionId;
    }

    projectFor(target) {
        const value = typeof target === 'string' ? target.trim() : '';
        if (this.projects.has(value)) return value;
        const who = value ? this.store.lookup(value) : null;
        if (who && this.projects.has(who.projectId)) return who.projectId;
        throw new ProjectError(value ? `"${value.slice(0, 80)}" is not a project here, nor one of its sessions` : 'no project given');
    }

    /**
     * The model a loaded session runs its next request on, from DSH's own
     * model selection record; undefined when the session is not loaded.
     */
    liveSelection(sessionId) {
        try {
            const session = this.ctx.agents.get(sessionId)?.session;
            const state = session ? this.ctx.get?.('sessionProjections')?.stateOf?.(session, 'modelSelection') : undefined;
            const picked = state?.pending ?? state?.lastUsed;
            if (!picked?.provider || !picked?.model) return undefined;
            return { provider: picked.provider, model: picked.model, ...(picked.reasoningEffort ? { reasoningEffort: String(picked.reasoningEffort) } : {}) };
        } catch {
            return undefined;
        }
    }

    /**
     * A project as its Project settings dialog shows it: each of the four
     * settings with its source and what it falls back to without the
     * project's own, pause (with how many messages it holds and whose
     * handbacks), and every thread with its model.
     */
    describeProject(projectId) {
        const project = this.project(projectId);
        const stored = this.store.project(projectId);
        const settings = this.settings(projectId);
        const inherited = effectiveSettings(pluginDefaults(this.config), project, {});
        const own = typeof stored.settings.paused === 'boolean';
        return {
            project: {
                id: projectId,
                name: project.name,
                source: project.source,
                workspace: project.workspacePath ?? null,
                coordinator: stored.coordinatorSessionId ?? null,
                live: this.liveSelection(stored.coordinatorSessionId) ?? null,
            },
            settings: Object.fromEntries(SETTING_KEYS.map((key) => [key, { ...settings[key], inherited: inherited[key] }])),
            paused: {
                value: this.paused(projectId), source: own ? 'project setting' : 'project config', inherited: project.paused === true,
                held: stored.pendingHandbacks.length, handbacks: heldHandbacks(stored.pendingHandbacks),
            },
            threads: rosterIds(stored.threads).map((id) => {
                const t = stored.threads[id];
                return {
                    id, title: t.title, session: t.sessionId ?? null, resolved: t.resolved === true,
                    model: t.model ?? null, effort: t.effort ?? null, live: this.liveSelection(t.sessionId) ?? null,
                    handback: t.lastHandback?.status ?? null,
                    changes: this.threadChanges(t),
                };
            }),
        };
    }

    /**
     * Every project as the plugin's page lists it: the four settings with
     * their sources, what the coordinator runs on right now, pause, and how
     * many threads are open.
     */
    listProjects() {
        const listed = [...this.projects.keys()].map((projectId, index) => {
            const project = this.project(projectId);
            const stored = this.store.project(projectId);
            const settings = this.settings(projectId);
            const ids = rosterIds(stored.threads);
            const open = ids.filter((id) => stored.threads[id].resolved !== true).length;
            const home = this.homeOf(projectId);
            return {
                id: projectId,
                name: project.name,
                source: project.source,
                workspace: project.workspacePath ?? null,
                home: home?.id ?? null,
                workspaces: this.workspacesIn(projectId).map((ws) => ({ id: ws.id, path: ws.path, title: ws.title })),
                coordinator: stored.coordinatorSessionId ?? null,
                live: this.liveSelection(stored.coordinatorSessionId) ?? null,
                paused: this.paused(projectId),
                settings: Object.fromEntries(SETTING_KEYS.map((key) => [key, { value: settings[key].value ?? null, source: settings[key].source }])),
                threads: { open, resolved: ids.length - open },
                order: this.fromProfile(projectId) ? index : 10000 + (Number.isFinite(stored.order) ? stored.order : index),
            };
        });
        // The profile's projects in its order, then the others in the order they were made or imported.
        return listed.sort((a, b) => a.order - b.order).map(({ order, ...project }) => project);
    }

    /**
     * A change from the Project settings dialog: the project's settings, or
     * one thread's model and effort. null puts a value back to its default.
     * @param {object} changes - {coordinatorModel?, coordinatorEffort?, threadModel?, threadEffort?, paused?} or {thread, model?, effort?}.
     * @returns the project as describeProject shows it, with `notes` from the change.
     */
    async changeFromWindow(projectId, changes) {
        const text = (value) => (value === null ? 'default' : typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
        let notes;
        if (changes.thread !== undefined) {
            const { id } = this.requireThread(projectId, changes.thread);
            notes = [await this.updateThread(projectId, id, { model: text(changes.model), effort: text(changes.effort) })];
        } else {
            ({ notes } = await this.changeSettings(projectId, {
                coordinatorModel: text(changes.coordinatorModel),
                coordinatorEffort: text(changes.coordinatorEffort),
                threadModel: text(changes.threadModel),
                threadEffort: text(changes.threadEffort),
                paused: changes.paused === null || typeof changes.paused === 'boolean' ? changes.paused : undefined,
            }));
        }
        return { ...this.describeProject(projectId), notes };
    }

    memoryPath(projectId) {
        const project = this.project(projectId);
        return project.memoryFile ? dataPath(project.memoryFile) : `${dataPath(this.config.memoryDir)}/${projectId}.md`;
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
        const outcome = await this.deliver(projectId, handbackMessage(threadId, t.title, status, text), t.sessionId);
        this.log(`handback ${projectId}/${threadId} status=${status} chars=${text.length} ${outcome}`);
        if (outcome === 'delivered') return HANDBACK_SENT;
        return this.paused(projectId) ? HANDBACK_HELD : HANDBACK_RETRY;
    }
}
