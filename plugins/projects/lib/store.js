/**
 * Durable project state. One JSON file, atomic writes, mode 600. Shape:
 *
 * { version: 1, projects: { [projectId]: {
 *     coordinatorSessionId, settings: { coordinatorModel?, coordinatorEffort?, threadModel?, threadEffort?, paused?, goal?: the user's, from
 *       Project settings only, yourTools?, coordinatorPermission?, threadPermission? },
 *     nextThread, pendingHandbacks: [text | {text, from: thread session}], threadStarts: [ms], rowSeen?: { the project row's models, efforts and access last seen },
 *     welcomedSession?: the coordinator session that got (or never needed) its first-turn welcome,
 *     coordinatorRoute?, coordinatorAccess?: the model route and permission setting the coordinator last got,
 *     threads: { [threadId]: { sessionId, title, model?, effort?, resolved, createdAt,
 *       ask?: the user's words it started with, tools?: the user's tools (guardedTools names) the user's words gave it,
 *       permission?: the DSH permission preset it started on or was moved to,
 *       lastHandback?: { status, summary, at }, lastDirect?: { at, reply }, handbackTimes: [ms],
 *       busy?: true while a turn runs, seenTurn?: key of the last turn reviewed,
 *       lastEnding?: { text, kind, at }: that turn, when it failed or stopped without a handback (prompts.js describeEnding),
 *       changes?: [{ turn, seq, added, deleted, total, files: [{ path, added, deleted, binary?, oversized? }], turns? }] (changes.js) } },
 *     home?: id of the DSH workspace its coordinator and threads work in,
 *     awaiting?: [{ to: a chat's session id, name: as the coordinator named it, from: the coordinator's session id,
 *       after: the chat's last event seq before the message, at }]: messages to chats outside the project (project_message)
 *       whose reply hasn't come back yet,
 *     A project made in the window also keeps its definition here (a profile row has its own):
 *     name, source: 'page' | 'import', createdAt, order: its place among them, importedFrom?: the old project's id } },
 *   categories?, categoryOf?, workspaceOf, imports: categories, from when they were part of this plugin (below) }
 *
 * Categories moved to the categories plugin (plugins/categories). This
 * plugin only keeps what an older version of it wrote about them: it loads
 * and saves `categories`, `categoryOf`, `workspaceOf` and `imports` as it
 * finds them (a file without categories is saved without them), because
 * that older version needs them if the user goes back to it, and the
 * categories plugin reads them once to bring the user's categories over.
 * Nothing here changes them:
 *   categories: { [categoryId]: { name, order: its place in the list, createdAt, source: 'group' | 'page' | 'import',
 *     importedFrom?: the old sidebar project's id } }: named sets of DSH workspaces,
 *   categoryOf: { [DSH workspace id]: categoryId }: the category each workspace was in, one at most,
 *   workspaceOf: { [DSH workspace id]: projectId }: before categories, the group each workspace was in,
 *   imports: { fleetShell?: { at, file, categories, joined, workspaces, skipped }, categories?: { at, categories, workspaces, backup? } }:
 *     the one-time imports and moves that older version made.
 *
 * Before categories, a project made on the Projects page or imported was a
 * group of workspaces (◇) that got a coordinator only when the user added
 * one. Their entries stay under `projects`, and only the ones with a
 * coordinator are projects.
 *
 * Settings here are the project's own: set in its Project settings dialog,
 * by picking a model in its coordinator's DSH model picker, or by the
 * coordinator with project_settings (never the goal or access, which only
 * the user sets). They sit above the profile config; deleting a key means
 * "use default".
 *
 * @module dsh-plugin-projects/store
 */
import { readFileSync, renameSync, writeFileSync, mkdirSync, chmodSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Resolve a '~'-prefixed path. */
export function expand(p) {
    return p.startsWith('~/') || p === '~' ? `${homedir()}${p.slice(1)}` : p;
}

/** DSH's own data folder: `$DSH_HOME`, else ~/.dsh, as DSH resolves it. */
export function dshHome() {
    const env = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
    return env === '' ? join(homedir(), '.dsh') : resolve(expand(env));
}

/**
 * Resolve one of the plugin's data paths. One under ~/.dsh lives in DSH's
 * data folder, so a DSH run with its own DSH_HOME (a test copy) keeps its
 * own projects instead of sharing the main one's.
 */
export function dataPath(p) {
    if (p === '~/.dsh' || p.startsWith('~/.dsh/')) return `${dshHome()}${p.slice('~/.dsh'.length)}`;
    return expand(p);
}

/**
 * Create a folder (and missing parents) as mode 700. The mode is set
 * explicitly because the process umask is shared: another plugin that
 * narrows it while we create folders would otherwise leave them without
 * the execute bit, and nothing inside could be opened. An existing folder
 * keeps its mode, unless its owner (us) cannot use it; that one gets the
 * owner bits back.
 * @param {string} dir
 */
export function ensurePrivateDir(dir) {
    // One level at a time, chmod before descending: a recursive mkdir under a
    // narrowed umask (e.g. 0177) makes the parent 600 and then cannot enter it
    // to create the child (EACCES on macOS; root skips the check, so CI as root passes).
    const missing = [];
    for (let d = dir; !existsSync(d); d = dirname(d)) {
        missing.unshift(d);
        if (dirname(d) === d) break;
    }
    if (missing.length === 0) {
        const st = statSync(dir);
        if ((st.mode & 0o700) !== 0o700 && st.uid === process.getuid?.()) chmodSync(dir, (st.mode & 0o777) | 0o700);
        return;
    }
    for (const d of missing) {
        try { mkdirSync(d, { mode: 0o700 }); } catch (error) { if (error?.code !== 'EEXIST') throw error; }
        chmodSync(d, 0o700);
    }
}

/** Open stores by file, so every manager in this process shares one copy. */
const opened = new Map();

export class ProjectStore {
    /**
     * The store for a file, shared within the process. A manager left over
     * from a config reload may still be finishing a tool call; sharing the
     * copy means its writes and the new manager's never overwrite each other.
     * @param {string} file - store path.
     */
    static open(file) {
        const path = dataPath(file);
        let store = opened.get(path);
        if (!store) {
            store = new ProjectStore(path);
            opened.set(path, store);
        }
        return store;
    }

    /** @param {string} file - store path. */
    constructor(file) {
        this.file = dataPath(file);
        /** @type {Record<string, object>} */
        this.projects = {};
        // Kept as found, never changed here: categories are the categories plugin's now (see the module doc).
        /** @type {Record<string, string>} workspace id → project id (groups, before categories) */
        this.workspaceOf = {};
        /** @type {Record<string, object>} category id → its definition */
        this.categories = {};
        /** @type {Record<string, string>} workspace id → category id */
        this.categoryOf = {};
        /** Whether the file has categories (an older version of this plugin made them): only then are they saved. */
        this.hasCategories = false;
        /** @type {Record<string, object>} */
        this.imports = {};
        this.load();
    }

    load() {
        const plain = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
        try {
            const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
            if (parsed?.version === 1 && parsed.projects && typeof parsed.projects === 'object') {
                this.projects = parsed.projects;
                this.workspaceOf = Object.fromEntries(Object.entries(plain(parsed.workspaceOf)).filter(([, id]) => typeof id === 'string'));
                this.hasCategories = plain(parsed.categories) === parsed.categories;
                this.categories = Object.fromEntries(Object.entries(plain(parsed.categories))
                    .filter(([, c]) => plain(c) === c && typeof c.name === 'string' && c.name.trim() !== ''));
                this.categoryOf = Object.fromEntries(Object.entries(plain(parsed.categoryOf)).filter(([, id]) => typeof id === 'string'));
                this.imports = plain(parsed.imports);
            }
        } catch {
            // Missing or corrupt store: start clean, never crash.
            this.projects = {};
            this.workspaceOf = {};
            this.categories = {};
            this.categoryOf = {};
            this.hasCategories = false;
            this.imports = {};
        }
    }

    /** Persist atomically; the store must survive crashes mid-write. */
    save() {
        try {
            ensurePrivateDir(dirname(this.file));
            const tmp = `${this.file}.tmp`;
            // Still version 1: an older version of the plugin reads the file as it did and keeps its groups.
            const state = {
                version: 1, projects: this.projects, workspaceOf: this.workspaceOf,
                ...(this.hasCategories ? { categories: this.categories, categoryOf: this.categoryOf } : {}),
                imports: this.imports,
            };
            writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
            chmodSync(tmp, 0o600);
            renameSync(tmp, this.file);
        } catch {
            // Best-effort for availability; the next mutation retries.
        }
    }

    /** The project entry, created empty on first use. */
    project(projectId) {
        const p = this.projects[projectId] ??= {};
        p.settings ??= {};
        p.threads ??= {};
        p.pendingHandbacks ??= [];
        p.nextThread ??= 1;
        return p;
    }

    /** Merge fields into a project entry and persist. */
    putProject(projectId, fields) {
        Object.assign(this.project(projectId), fields);
        this.save();
    }

    /** Set or clear (value undefined) runtime setting overrides. */
    putSettings(projectId, changes) {
        const settings = this.project(projectId).settings;
        for (const [key, value] of Object.entries(changes)) {
            if (value === undefined) delete settings[key];
            else settings[key] = value;
        }
        this.save();
    }

    /** Reserve the next short thread id ("t1", "t2", ...). Never reused. */
    reserveThreadId(projectId) {
        const p = this.project(projectId);
        const id = `t${p.nextThread}`;
        p.nextThread += 1;
        this.save();
        return id;
    }

    thread(projectId, threadId) {
        return this.projects[projectId]?.threads?.[threadId] ?? null;
    }

    putThread(projectId, threadId, fields) {
        const threads = this.project(projectId).threads;
        threads[threadId] = { ...threads[threadId], ...fields };
        this.save();
        return threads[threadId];
    }

    /**
     * Forget a project and its state. The groups of workspaces from before
     * categories (`workspaceOf`) stay as they are: a project made since
     * never held one.
     */
    removeProject(projectId) {
        delete this.projects[projectId];
        this.save();
    }

    /** Find which project and role a session belongs to. */
    lookup(sessionId) {
        for (const [projectId, p] of Object.entries(this.projects)) {
            if (p.coordinatorSessionId === sessionId) return { projectId, role: 'coordinator' };
            for (const [threadId, t] of Object.entries(p.threads ?? {})) {
                if (t.sessionId === sessionId) return { projectId, role: 'thread', threadId };
            }
        }
        return null;
    }
}
