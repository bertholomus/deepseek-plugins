/**
 * A thread's net changes: each file's text from before the thread's first
 * edit of it and after its latest, so its Changes tab can show one diff per
 * file, what its edits (and its subagents') came to. DSH's records keep
 * each edit's hunks only, and its own whole-file captures last a turn and
 * go with the session, so the plugin keeps its own, around each file-tool
 * call of a thread or of a subagent working for one (the manager's
 * `tools/execute` hook). They live in the plugin's folder, one folder per
 * thread session (net/<session>/, mode 700, files 600): index.json says
 * what each side of each file is, and each kept text is a file of its own.
 * A thread keeps at most MAX_NET_FILES files and MAX_NET_THREAD_BYTES; at
 * each start, threads the store no longer has lose theirs, and so do the
 * oldest past MAX_NET_TOTAL_BYTES in all.
 *
 * A side is 'text' (kept), 'absent' (no file: the thread created it),
 * 'big' (past MAX_NET_BYTES, or the thread's MAX_NET_THREAD_BYTES used up),
 * 'binary' or 'unreadable'. A file that anything else changed between two
 * of the thread's calls on it (another thread, the user, a command) is
 * `mixed`: a diff from its first text to its last would credit the thread
 * with that change too. Each entry names the calls that changed the file,
 * so a file the thread edited before the plugin kept texts (an older
 * version's edits) is `partial`: its first kept text isn't the thread's first.
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { ensurePrivateDir } from './store.js';
import { netHunks } from './changes.js';

/** The largest file kept, each side. */
export const MAX_NET_BYTES = 1024 * 1024;
/** The most files one thread keeps texts of. */
export const MAX_NET_FILES = 100;
/** The most text one thread keeps in all. */
export const MAX_NET_THREAD_BYTES = 32 * 1024 * 1024;
/** The most text all threads keep; past it, the threads that edited longest ago lose theirs first (NetTexts.prune). */
export const MAX_NET_TOTAL_BYTES = 512 * 1024 * 1024;
/** Bytes looked at for a NUL before a file counts as binary, as git does. */
const BINARY_PROBE = 8000;
/** Threads whose index stays in memory. */
const INDEXES = 50;
/** The most calls one file's entry names; past them it stops checking for edits it missed. */
const MAX_NET_CALLS = 500;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashOf = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The path a file-tool call is about to change, as the call names it:
 * `write`, `edit` and the changing `str_replace_editor` commands. Other
 * calls, and incomplete arguments, give undefined.
 */
export function changedPath(name, args) {
    if (!isObject(args)) return undefined;
    const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
    switch (name) {
        case 'write': return typeof args.content === 'string' ? text(args.file_path) : undefined;
        case 'edit': return typeof args.old_string === 'string' && typeof args.new_string === 'string' ? text(args.file_path) : undefined;
        case 'str_replace_editor': return ['create', 'str_replace', 'insert'].includes(args.command) ? text(args.path) : undefined;
        default: return undefined;
    }
}

/**
 * A path as the file system has it, links resolved (a missing file's
 * folder), so one file has one key whichever way a call or a record names it.
 */
export function canonicalPath(path) {
    try { return realpathSync(path); } catch {}
    try { return join(realpathSync(dirname(path)), basename(path)); } catch {}
    return path;
}

/** A file as one side: {kind, text?, hash?}. Never throws. */
export async function readSide(file, maxBytes = MAX_NET_BYTES) {
    let handle;
    try {
        handle = await open(file, 'r');
    } catch (error) {
        return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? { kind: 'absent' } : { kind: 'unreadable' };
    }
    try {
        const stat = await handle.stat();
        if (!stat.isFile()) return { kind: 'unreadable' };
        if (stat.size > maxBytes) return { kind: 'big' };
        const bytes = await handle.readFile();
        if (bytes.length > maxBytes) return { kind: 'big' };
        const hash = hashOf(bytes);
        if (bytes.subarray(0, BINARY_PROBE).includes(0)) return { kind: 'binary', hash };
        return { kind: 'text', text: bytes.toString('utf8'), hash };
    } catch {
        return { kind: 'unreadable' };
    } finally {
        await handle.close().catch(() => {});
    }
}

/** A kept text, if it is still the one its hash names; undefined otherwise. */
async function readKept(file, hash) {
    try {
        const bytes = await readFile(file);
        return hashOf(bytes) === hash ? bytes.toString('utf8') : undefined;
    } catch {
        return undefined;
    }
}

/** Keepers by folder, so two managers on one folder (a config reload) share one index. */
const opened = new Map();

export class NetTexts {
    /** The keeper of a folder, shared within the process; `log` gets its error lines. */
    static open(root, log) {
        let net = opened.get(root);
        if (!net) {
            net = new NetTexts(root);
            opened.set(root, net);
        }
        if (typeof log === 'function') net.log = log;
        return net;
    }

    constructor(root) {
        this.root = root;
        this.log = () => {};
        /** Thread session → its index {files: {path: entry}, bytes}, the newest last. */
        this.indexes = new Map();
        /** `${thread}\n${path}` → the tail of the calls on that file, so each call's sides are its own. */
        this.files = new Map();
        /** Thread session → the tail of its index's writes. */
        this.writes = new Map();
    }

    /**
     * Once a process, as the plugin starts: remove the folders of threads the
     * store no longer has (`keep`: the session of every thread it has,
     * archived projects' too; with none, as from a store that failed to
     * load, it leaves every folder as it is), then, while all of them keep more than
     * MAX_NET_TOTAL_BYTES, those of the threads that edited longest ago. A
     * thread this process is already keeping texts for stays. Never throws;
     * returns the folders it removed.
     */
    async prune(keep) {
        const removed = [];
        if (this.pruned) return removed;
        this.pruned = true;
        let names;
        try {
            names = await readdir(this.root);
        } catch {
            return removed;
        }
        const nameOf = (id) => basename(this.dir(id));
        const kept = new Set([...keep].map(nameOf));
        if (kept.size === 0) return removed;
        const busy = new Set([...this.indexes.keys(), ...this.writes.keys(), ...[...this.files.keys()].map((key) => key.split('\n')[0])].map(nameOf));
        const drop = async (name, why) => {
            try {
                await rm(join(this.root, name), { recursive: true, force: true });
                removed.push(name);
                this.log(`net-prune ${name} ${why}`);
            } catch (error) {
                this.log(`error net-prune ${String(error?.message ?? error).slice(0, 200)}`);
            }
        };
        const sized = [];
        for (const name of names) {
            if (!/^[\w-]{1,128}$/.test(name) || busy.has(name)) continue;
            if (!kept.has(name)) {
                await drop(name, 'gone');
                continue;
            }
            try {
                const index = join(this.root, name, 'index.json');
                const [text, info] = await Promise.all([readFile(index, 'utf8'), stat(index)]);
                const bytes = JSON.parse(text)?.bytes;
                sized.push({ name, bytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0, at: info.mtimeMs });
            } catch {}
        }
        let total = sized.reduce((n, entry) => n + entry.bytes, 0);
        for (const entry of sized.sort((a, b) => a.at - b.at)) {
            if (total <= MAX_NET_TOTAL_BYTES) break;
            await drop(entry.name, 'oldest');
            total -= entry.bytes;
        }
        return removed;
    }

    /** A thread session's folder: its id, or a hash of an id that isn't a plain name. */
    dir(thread) {
        const id = String(thread);
        return join(this.root, /^[\w-]{1,128}$/.test(id) ? id : hashOf(id).slice(0, 32));
    }

    /** A thread's index, read once. */
    async index(thread) {
        const cached = this.indexes.get(thread);
        if (cached) {
            this.indexes.delete(thread);
            this.indexes.set(thread, cached);
            return cached;
        }
        let index = { files: {}, bytes: 0 };
        try {
            const parsed = JSON.parse(await readFile(join(this.dir(thread), 'index.json'), 'utf8'));
            if (isObject(parsed?.files)) index = { files: parsed.files, bytes: Number.isSafeInteger(parsed.bytes) ? parsed.bytes : 0 };
        } catch {}
        // Another call read it meanwhile: keep the copy that one may have changed.
        const raced = this.indexes.get(thread);
        if (raced) return raced;
        this.indexes.set(thread, index);
        // The least used go, but never one a call still holds or a write still has to save.
        const busy = new Set([...this.files.keys()].map((key) => key.slice(0, key.indexOf('\n'))));
        for (const key of [...this.indexes.keys()].slice(0, -INDEXES)) {
            if (!this.writes.has(key) && !busy.has(key)) this.indexes.delete(key);
        }
        return index;
    }

    /** Write a thread's index, after any write of it still running, as it is when its turn comes. */
    save(thread) {
        const write = async () => {
            const index = this.indexes.get(thread);
            if (!index) return;
            const dir = this.dir(thread);
            ensurePrivateDir(dir);
            const temp = join(dir, `index.json.${process.pid}.tmp`);
            await writeFile(temp, JSON.stringify({ version: 1, bytes: index.bytes, files: index.files }), { mode: 0o600 });
            await rename(temp, join(dir, 'index.json'));
        };
        const tail = (this.writes.get(thread) ?? Promise.resolve()).then(write).catch((error) => {
            this.log(`error net-index ${String(error?.message ?? error).slice(0, 200)}`);
        });
        this.writes.set(thread, tail);
        void tail.then(() => {
            if (this.writes.get(thread) === tail) this.writes.delete(thread);
        });
        return tail;
    }

    /** Keep one text in a thread's folder, whole or not at all. */
    async keep(thread, name, text) {
        const dir = this.dir(thread);
        ensurePrivateDir(dir);
        const temp = join(dir, `${name}.${process.pid}.tmp`);
        await writeFile(temp, text, { mode: 0o600 });
        await rename(temp, join(dir, name));
    }

    /**
     * Run one file-tool call (`run`: the rest of DSH's chain; `call`: its id)
     * on `file` for `thread`, keeping the file's text before the thread's
     * first call on it and after each. Calls on one file wait for each other;
     * the call's own outcome is returned or thrown as it is.
     */
    async around(thread, file, run, call = undefined) {
        const key = `${thread}\n${file}`;
        const prev = this.files.get(key) ?? Promise.resolve();
        let done;
        const gate = new Promise((resolve) => { done = resolve; });
        const mine = prev.then(() => gate);
        this.files.set(key, mine);
        await prev;
        try {
            await this.before(thread, file);
            return await run();
        } finally {
            await this.after(thread, file, call);
            done();
            if (this.files.get(key) === mine) this.files.delete(key);
        }
    }

    /** Before a call: the file's first text, or whether anything else changed it since the thread's last call. */
    async before(thread, file) {
        try {
            const index = await this.index(thread);
            const entry = index.files[file];
            if (isObject(entry)) {
                if (entry.mixed !== true && typeof entry.hash === 'string') {
                    const now = await readSide(file);
                    if (now.hash !== entry.hash) {
                        entry.mixed = true;
                        await this.save(thread);
                    }
                }
                return;
            }
            if (Object.keys(index.files).length >= MAX_NET_FILES) return;
            const key = hashOf(file).slice(0, 32);
            const side = await readSide(file);
            const fresh = { key, before: side.kind, after: null, hash: null, calls: [] };
            if (side.kind === 'text') {
                const size = Buffer.byteLength(side.text);
                if (index.bytes + size > MAX_NET_THREAD_BYTES) fresh.before = 'big';
                else {
                    await this.keep(thread, `${key}.before`, side.text);
                    index.bytes += size;
                    Object.assign(fresh, { beforeHash: side.hash, beforeBytes: size });
                }
            }
            index.files[file] = fresh;
            await this.save(thread);
        } catch (error) {
            this.log(`error net-before ${String(error?.message ?? error).slice(0, 200)}`);
        }
    }

    /** After a call: the file's text now, the thread's latest, and the call that made it. */
    async after(thread, file, call) {
        try {
            const index = await this.index(thread);
            const entry = index.files[file];
            if (!isObject(entry)) return;
            const side = await readSide(file);
            if (side.kind === entry.after && side.hash !== undefined && side.hash === entry.hash) return;
            entry.after = side.kind;
            entry.hash = side.hash ?? null;
            if (typeof call === 'string' && call !== '' && Array.isArray(entry.calls)) {
                if (entry.calls.length < MAX_NET_CALLS) entry.calls.push(call);
                else entry.callsFull = true;
            }
            if (side.kind === 'text') {
                const size = Buffer.byteLength(side.text);
                const was = Number.isSafeInteger(entry.afterBytes) ? entry.afterBytes : 0;
                if (index.bytes - was + size > MAX_NET_THREAD_BYTES) entry.after = 'big';
                else {
                    await this.keep(thread, `${entry.key}.after`, side.text);
                    index.bytes += size - was;
                    entry.afterBytes = size;
                }
            }
            await this.save(thread);
        } catch (error) {
            this.log(`error net-after ${String(error?.message ?? error).slice(0, 200)}`);
        }
    }

    /**
     * What a thread's calls on a file came to: {net} (netHunks, with `since`
     * when the file changed after the thread's last call), or {why}: 'none'
     * (nothing kept: the thread's edits came before the plugin kept texts,
     * or past MAX_NET_FILES), 'partial' (one of `calls`, the ids of the
     * thread's edits of the file in its records, isn't one the plugin kept
     * texts around), 'mixed', 'big' or 'binary'.
     */
    async view(thread, file, calls = undefined) {
        const index = await this.index(thread);
        const entry = index.files[file];
        if (!isObject(entry)) return { why: 'none' };
        if (Array.isArray(calls) && Array.isArray(entry.calls) && entry.callsFull !== true) {
            const seen = new Set(entry.calls);
            if (calls.some((call) => !seen.has(call))) return { why: 'partial' };
        }
        if (entry.mixed === true) return { why: 'mixed' };
        for (const why of ['big', 'binary']) {
            if (entry.before === why || entry.after === why) return { why };
        }
        if ((entry.before !== 'text' && entry.before !== 'absent') || entry.after !== 'text') return { why: 'none' };
        const dir = this.dir(thread);
        const before = entry.before === 'text' ? await readKept(join(dir, `${entry.key}.before`), entry.beforeHash) : null;
        const after = await readKept(join(dir, `${entry.key}.after`), entry.hash);
        if (before === undefined || after === undefined) return { why: 'none' };
        const net = netHunks(before, after);
        if (!net) return { why: 'big' };
        const now = await readSide(file);
        return { net: now.hash === entry.hash ? net : { ...net, since: true } };
    }
}
