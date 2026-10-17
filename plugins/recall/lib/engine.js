/**
 * The index's one owner: the store, the indexer, and the answers to what
 * the plugin asks (search, a turn in full, the filters' choices, status).
 * It runs inside the worker thread (lib/worker.js); tests and the bench
 * run it in their own thread.
 *
 * Search: the words become an FTS5 query (lib/query.js); the best 400 or
 * so matching turns are ranked by bm25 over title, prompt, reply and tools,
 * lifted a little when recent, and grouped by session (or file), so one
 * long session does not fill the page: each result is a session's best
 * turn, with how many of its other turns match and which.
 *
 * @module dsh-plugin-recall/engine
 */
import { homedir } from 'node:os';
import { Indexer } from './indexer.js';
import { parseQuery, spanOf } from './query.js';
import { Store } from './store.js';

const DAY = 86_400_000;
/** Bounds on a search. */
export const SEARCH_LIMITS = Object.freeze({ results: 50, offset: 1000, candidates: 4000, count: 5000, others: 8 });
/** The kinds of files Recall reads. */
export const KINDS = Object.freeze(['session', 'transcript', 'handoff']);

const clamp = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback);
const words = (value, max = 300) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);

/** A folder as the index keeps it: absolute, `~/` expanded, no trailing slash. */
export function folderOf(value, home = homedir()) {
    const text = words(value, 1000);
    if (!text) return undefined;
    const full = text === '~' ? home : text.startsWith('~/') ? `${home}${text.slice(1)}` : text;
    return full.length > 1 ? full.replace(/\/+$/, '') : full;
}

/** How much more a recent turn counts: up to 30% for today, about half that after two weeks. */
const lift = (time, now) => 1 + 0.3 * Math.exp(-Math.max(0, now - time) / (20 * DAY));

export class Engine {
    /**
     * @param {object} options
     * @param {string} options.file - the index file.
     * @param {object} options.sqlite - node:sqlite.
     * @param {(level: string, text: string) => void} [options.log]
     * @param {(note: object) => void} [options.note]
     * @param {() => number} [options.now]
     * @param {() => number} [options.clock] - a fine clock, for how long a search took.
     */
    constructor({ file, sqlite, log = () => {}, note = () => {}, now = Date.now, clock = () => performance.now() }) {
        this.now = now;
        this.clock = clock;
        this.note = note;
        this.store = new Store(file, sqlite, { log });
        if (this.store.setAside) note({ kind: 'set-aside' });
        this.indexer = new Indexer({ store: this.store, log, note, now });
        this.facetCache = undefined;
        this.busySince = 0;
        this.busyRead = 0;
        this.busyRows = 0;
    }

    /** One request from the plugin. Throws a message in words. */
    handle(op, args = {}) {
        switch (op) {
            case 'configure':
                this.indexer.configure(Array.isArray(args.sources) ? args.sources : []);
                this.facetCache = undefined;
                return this.status();
            case 'touch':
                for (const id of Array.isArray(args.sessionIds) ? args.sessionIds.slice(0, 500) : []) this.indexer.touchSession(id);
                return true;
            case 'rescan':
                this.indexer.scan();
                return this.status();
            case 'rebuild':
                this.indexer.rebuild();
                this.facetCache = undefined;
                return this.status();
            case 'search':
                return this.search(args);
            case 'facets':
                return this.facets();
            case 'status':
                return this.status();
            case 'turn':
                return this.turn(args.id);
            default:
                throw new Error(`Recall's index has no "${String(op).slice(0, 40)}".`);
        }
    }

    /**
     * Index for about `budgetMs`.
     * @returns {{ more: boolean, idle?: { read: number, rows: number, ms: number } }} `idle`: the index just caught up.
     */
    work(budgetMs = 40) {
        const was = this.indexer.busy;
        if (!was) return { more: false };
        if (!this.busySince) {
            this.busySince = this.now();
            this.busyRead = this.indexer.read;
            this.busyRows = this.indexer.rowsPut;
        }
        const more = this.indexer.step(budgetMs);
        if (this.indexer.rowsPut !== this.busyRowsSeen) {
            this.busyRowsSeen = this.indexer.rowsPut;
            this.facetCache = undefined;
        }
        if (more) return { more };
        const idle = { read: this.indexer.read - this.busyRead, rows: this.indexer.rowsPut - this.busyRows, ms: this.now() - this.busySince };
        this.busySince = 0;
        return { more: false, idle };
    }

    /**
     * Search.
     * @param {object} q
     * @param {string} [q.text] - words, "phrases", -left-out words, OR; empty lists the newest turns.
     * @param {string} [q.kind] - session, transcript or handoff.
     * @param {string} [q.folder] - a folder; its subfolders count.
     * @param {string} [q.model]
     * @param {string} [q.since] - see query.momentOf.
     * @param {string} [q.until]
     * @param {'best'|'newest'} [q.sort]
     * @param {number} [q.limit] - results (sessions) on the page, 1 to 50.
     * @param {number} [q.offset]
     * @param {boolean} [q.prefix] - the last word may be cut short (typing).
     * @param {number} [q.file] - only this file's turns, one result each.
     */
    search(q = {}) {
        const started = this.clock();
        const text = typeof q.text === 'string' ? q.text.slice(0, 500) : '';
        const parsed = parseQuery(text, { prefix: q.prefix === true });
        const span = spanOf({ since: words(q.since, 60), until: words(q.until, 60), now: this.now() });
        const file = Number.isSafeInteger(q.file) && q.file > 0 ? q.file : undefined;
        const filters = {
            kind: KINDS.includes(q.kind) ? q.kind : undefined,
            folder: folderOf(q.folder),
            model: words(q.model, 200),
            from: span.from,
            to: span.to,
            file,
        };
        const limit = clamp(q.limit, 1, SEARCH_LIMITS.results, 20);
        const offset = clamp(q.offset, 0, SEARCH_LIMITS.offset, 0);
        const sort = q.sort === 'newest' ? 'newest' : 'best';
        const base = { text, words: parsed.words, excluded: parsed.excluded, sort, filters: { ...filters, from: span.from ?? null, to: span.to ?? null } };
        if (text.trim() && !parsed.match) return { ...base, total: 0, totalMore: false, sessions: 0, results: [], more: false, took: this.took(started), nothing: 'no-words' };
        const cap = Math.min(SEARCH_LIMITS.candidates, Math.max(400, (offset + limit) * 10));
        const rows = this.store.candidates({ match: parsed.match, sort: parsed.match ? sort : 'newest', cap, filters });
        const now = this.now();
        if (parsed.match && sort === 'best') {
            for (const r of rows) r.rank = r.score * lift(r.time, now);
            rows.sort((a, b) => a.rank - b.rank);
        }
        // One result per file: its best turn, with its other matching turns.
        const groups = new Map();
        for (const r of rows) {
            const key = file === undefined ? r.file : r.id;
            const g = groups.get(key);
            if (!g) groups.set(key, { best: r, hits: 1, others: [] });
            else {
                g.hits += 1;
                if (g.others.length < SEARCH_LIMITS.others) g.others.push({ turn: r.turn, seq: r.seq });
            }
        }
        const ordered = [...groups.values()];
        const page = ordered.slice(offset, offset + limit);
        const ids = page.map((g) => g.best.id);
        const snippets = this.store.snippets(parsed.match, ids);
        const asked = this.store.asked(ids);
        const files = this.store.filesByIds([...new Set(page.map((g) => g.best.file))]);
        const total = this.store.count({ match: parsed.match, filters, cap: SEARCH_LIMITS.count });
        const results = page.map((g) => this.resultOf(g, files.get(g.best.file), snippets.get(g.best.id), asked.get(g.best.id)));
        return {
            ...base,
            total: Math.min(total, SEARCH_LIMITS.count),
            totalMore: total > SEARCH_LIMITS.count,
            sessions: groups.size,
            sessionsMore: rows.length >= cap,
            results,
            more: ordered.length > offset + limit,
            took: this.took(started),
        };
    }

    took(started) {
        return Math.round((this.clock() - started) * 10) / 10;
    }

    resultOf(g, f = {}, snippet = '', asked = '') {
        const d = g.best;
        return {
            id: `${d.file}.${d.turn}`,
            file: d.file,
            kind: d.kind,
            own: f.own === 1,
            sessionId: f.session || undefined,
            path: d.kind === 'session' && f.own === 1 ? undefined : f.path,
            title: f.title || '',
            turn: d.turn,
            seq: d.seq,
            line: d.line,
            label: d.label,
            time: d.time,
            folder: d.folder,
            model: d.model,
            running: d.done === 0,
            snippet: snippet ?? '',
            asked: String(asked ?? '').replace(/\s+/g, ' ').trim(),
            hits: g.hits,
            others: g.others.sort((a, b) => a.turn - b.turn),
        };
    }

    /** One turn (or note section) in full, by its result id ("12.4"). */
    turn(id) {
        const m = /^(\d{1,12})\.(\d{1,9})$/.exec(String(id ?? '').trim());
        if (!m) throw new Error('Name a result by its id, such as 12.4.');
        const d = this.store.doc(Number(m[1]), Number(m[2]));
        if (!d) throw new Error('That result is no longer in the index (its file changed or went). Search again.');
        const f = this.store.fileById(d.file) ?? {};
        const turns = this.store.turnsOf(d.file);
        const at = turns.indexOf(d.turn);
        return {
            id: `${d.file}.${d.turn}`,
            file: d.file,
            kind: d.kind,
            own: f.own === 1,
            sessionId: f.session || undefined,
            path: f.path,
            title: d.title || f.title || '',
            turn: d.turn,
            seq: d.seq,
            line: d.line,
            label: d.label,
            time: d.time,
            folder: d.folder,
            model: d.model,
            running: d.done === 0,
            prompt: d.prompt ?? '',
            reply: d.reply ?? '',
            tools: d.tools ?? '',
            prev: at > 0 ? turns[at - 1] : undefined,
            next: at >= 0 && at < turns.length - 1 ? turns[at + 1] : undefined,
            count: turns.length,
        };
    }

    /** The filters' choices (kept a few seconds; read again after new rows). */
    facets() {
        if (this.facetCache && this.now() - this.facetCache.at < 5000) return this.facetCache.value;
        const value = this.store.facets();
        this.facetCache = { at: this.now(), value };
        return value;
    }

    /** Where the index is. */
    status() {
        const ix = this.indexer.status();
        const byRoot = new Map(this.store.rootTotals().map((r) => [`${r.kind}:${r.root}`, r]));
        return {
            ...ix,
            totals: this.store.totals(),
            bytes: this.store.bytes(),
            problems: this.store.problems(10),
            roots: ix.roots.map((r) => {
                const t = byRoot.get(`${r.kind}:${r.root}`);
                return { ...r, indexed: t?.files ?? 0, turns: t?.turns ?? 0, problems: t?.problems ?? 0, last: t?.last ?? 0 };
            }),
        };
    }

    close() {
        this.store.close();
    }
}
