/**
 * Canon's search: an in-memory inverted index over the vault's active
 * notes, scored like BM25F. A word in a note's title, aliases, tags, path
 * or headings counts for more than one in its body; a body's length is
 * evened out; a word few notes have counts for more than a common one.
 *
 * A note is a match only when the prompt and the note share a word in the
 * note's title, aliases, tags, path or headings, or at least two words
 * anywhere; it is kept only above a floor and near the best match. A note
 * that belongs to the session's folder (its path, its `project` or `repo`,
 * or a tag names the folder's repo) is lifted, but never makes a match on
 * its own.
 *
 * The index keeps terms and counts only, never a note's text: the passage
 * a turn gets is read from the file when it is needed (vault.js).
 *
 * @module dsh-plugin-canon/search
 */
import { counts, distinctTerms, nameKey, terms } from './text.js';

/** BM25's saturation and length weight. */
const K1 = 1.2;
const B = 0.6;
/** How much a word counts in each of a note's strong fields (the body counts 1). */
const WEIGHTS = Object.freeze({ title: 4, aliases: 3, tags: 3, path: 2, headings: 1.5 });
/** A note scores at least this, and at least this share of the best note, to be added. */
export const MIN_SCORE = 3;
export const NEAR_BEST = 0.4;
/** The lift for a note of the session's repo, and of the folder it sits in. */
export const REPO_BOOST = 1.6;
export const PARENT_BOOST = 1.2;
/**
 * A word's rarity is judged as if the vault held at least this many notes:
 * in a vault of a handful of notes every word is "common", and nothing
 * could ever reach the floor.
 */
export const SMALL_VAULT = 10;
/** Prompt terms used, at most (the rest of a long prompt adds little). */
const MAX_QUERY_TERMS = 48;
/** A note's distinct terms kept, at most. */
const MAX_NOTE_TERMS = 4000;

/**
 * Folder names that say nothing about a project: a session in
 * ~/Projects/harbor-gateway is about harbor-gateway, not about Projects.
 */
const GENERIC = new Set(['users', 'user', 'home', 'root', 'projects', 'project', 'src', 'source', 'code', 'repos', 'repo', 'repositories', 'git', 'github',
    'work', 'workspace', 'workspaces', 'dev', 'development', 'documents', 'desktop', 'downloads', 'tmp', 'temp', 'private', 'var', 'folders', 'volumes',
    'library', 'mobile-documents', 'icloud', 'opt', 'sites', 'ws', 'main', 'app', 'apps', 'packages', 'lib', 'test', 'tests']);

/**
 * What a session's folder says about which notes belong to it: the repo
 * (the folder's own name) and the folder above it, unless those are
 * generic names (Projects, src, …) or the person's own user name.
 * @param {string} folder - a full path.
 * @param {string} [home] - the home folder, whose own name is not a project.
 */
export function folderKeys(folder, home = '') {
    if (typeof folder !== 'string' || !folder.startsWith('/')) return { repo: '', parent: '' };
    const user = nameKey(String(home).split('/').filter(Boolean).at(-1) ?? '');
    const parts = folder.split('/').filter(Boolean).map(nameKey);
    const useful = (k) => Boolean(k) && k.length >= 2 && !GENERIC.has(k) && k !== user;
    const repo = parts.at(-1) ?? '';
    const parent = parts.at(-2) ?? '';
    return { repo: useful(repo) ? repo : '', parent: useful(parent) ? parent : '' };
}

export class Index {
    constructor() {
        /** Slot → note record, or null once removed. */
        this.docs = [];
        /** Note path → slot. */
        this.byPath = new Map();
        /** Term → { slots, strong, body }: parallel arrays, one entry per note that has the term. */
        this.postings = new Map();
        this.live = 0;
        this.dead = 0;
        this.bodyLength = 0;
    }

    get size() {
        return this.live;
    }

    has(path) {
        return this.byPath.has(path);
    }

    get(path) {
        const slot = this.byPath.get(path);
        return slot === undefined ? undefined : this.docs[slot] ?? undefined;
    }

    /** Every note in the index (for the page's counts and tests). */
    notes() {
        return this.docs.filter(Boolean);
    }

    /**
     * Add a note (or replace the one at its path).
     * @param {{ path: string, title: string, aliases: string[], tags: string[], projects: string[], headings: string[], body: string }} note
     * @param {{ mtimeMs?: number, size?: number }} [file]
     */
    add(note, file = {}) {
        this.remove(note.path);
        const slot = this.docs.length;
        const segments = note.path.split('/');
        const strong = new Map();
        const addStrong = (text, weight) => {
            for (const [t, n] of counts(text)) strong.set(t, (strong.get(t) ?? 0) + n * weight);
        };
        addStrong(note.title, WEIGHTS.title);
        for (const alias of note.aliases ?? []) addStrong(alias, WEIGHTS.aliases);
        for (const tag of note.tags ?? []) addStrong(tag.replace(/[/_-]+/g, ' '), WEIGHTS.tags);
        addStrong(segments.join(' ').replace(/\.md$/i, ''), WEIGHTS.path);
        for (const heading of note.headings ?? []) addStrong(heading, WEIGHTS.headings);
        const bodyTerms = terms(note.body ?? '');
        const body = new Map();
        for (const t of bodyTerms) body.set(t, (body.get(t) ?? 0) + 1);
        const all = [...new Set([...strong.keys(), ...body.keys()])].slice(0, MAX_NOTE_TERMS);
        for (const t of all) {
            let p = this.postings.get(t);
            if (!p) {
                p = { slots: [], strong: [], body: [] };
                this.postings.set(t, p);
            }
            p.slots.push(slot);
            p.strong.push(strong.get(t) ?? 0);
            p.body.push(body.get(t) ?? 0);
        }
        const keys = new Set([...segments.map((s, i) => nameKey(i === segments.length - 1 ? s.replace(/\.md$/i, '') : s)), ...(note.projects ?? []), ...(note.tags ?? []).map(nameKey)].filter(Boolean));
        this.docs.push({
            slot,
            path: note.path,
            title: note.title,
            tags: note.tags ?? [],
            keys,
            bodyLength: bodyTerms.length,
            mtimeMs: file.mtimeMs ?? 0,
            size: file.size ?? 0,
        });
        this.byPath.set(note.path, slot);
        this.live += 1;
        this.bodyLength += bodyTerms.length;
    }

    /** Remove a note by its path; nothing when it is not here. */
    remove(path) {
        const slot = this.byPath.get(path);
        if (slot === undefined) return false;
        const doc = this.docs[slot];
        this.byPath.delete(path);
        if (doc) {
            this.live -= 1;
            this.bodyLength -= doc.bodyLength;
            this.docs[slot] = null;
            this.dead += 1;
        }
        if (this.dead > 2000 && this.dead > this.live) this.compact();
        return true;
    }

    /** Drop removed notes from the lists, so they stop costing memory and time. */
    compact() {
        const moved = new Map();
        const docs = [];
        for (const doc of this.docs) {
            if (!doc) continue;
            moved.set(doc.slot, docs.length);
            doc.slot = docs.length;
            docs.push(doc);
        }
        for (const [term, p] of this.postings) {
            const next = { slots: [], strong: [], body: [] };
            for (let i = 0; i < p.slots.length; i += 1) {
                const to = moved.get(p.slots[i]);
                if (to === undefined) continue;
                next.slots.push(to);
                next.strong.push(p.strong[i]);
                next.body.push(p.body[i]);
            }
            if (next.slots.length) this.postings.set(term, next);
            else this.postings.delete(term);
        }
        this.docs = docs;
        this.byPath = new Map(docs.map((d) => [d.path, d.slot]));
        this.dead = 0;
    }

    /**
     * The notes that fit a prompt, best first, each with its score, the
     * prompt terms it matched, and whether it belongs to the folder; and
     * the few that matched some words but stayed under the floors
     * (`others`, for the page's "why not").
     * @param {string} prompt
     * @param {{ folder?: { repo: string, parent: string }, limit?: number }} [options]
     */
    search(prompt, { folder = { repo: '', parent: '' }, limit = 10 } = {}) {
        const query = distinctTerms(prompt, { max: 400 }).slice(0, MAX_QUERY_TERMS);
        if (query.length === 0 || this.live === 0) return { terms: query, results: [], others: [] };
        const n = Math.max(this.live, SMALL_VAULT);
        const average = Math.max(1, this.bodyLength / this.live);
        const found = new Map();
        for (const t of query) {
            const p = this.postings.get(t);
            if (!p) continue;
            let df = 0;
            for (const slot of p.slots) if (this.docs[slot]) df += 1;
            if (df === 0) continue;
            const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
            for (let i = 0; i < p.slots.length; i += 1) {
                const doc = this.docs[p.slots[i]];
                if (!doc) continue;
                const norm = 1 - B + B * (doc.bodyLength / average);
                const tf = p.strong[i] + p.body[i] / norm;
                const score = idf * ((tf * (K1 + 1)) / (tf + K1));
                let hit = found.get(doc.slot);
                if (!hit) {
                    hit = { doc, score: 0, matched: [], strong: 0 };
                    found.set(doc.slot, hit);
                }
                hit.score += score;
                hit.matched.push(t);
                if (p.strong[i] > 0) hit.strong += 1;
            }
        }
        const need = Math.min(2, query.length);
        const scored = [];
        for (const hit of found.values()) {
            const place = folder.repo && hit.doc.keys.has(folder.repo) ? 'repo' : folder.parent && hit.doc.keys.has(folder.parent) ? 'parent' : '';
            const boost = place === 'repo' ? REPO_BOOST : place === 'parent' ? PARENT_BOOST : 1;
            const fits = hit.strong >= 1 || hit.matched.length >= need;
            scored.push({ path: hit.doc.path, title: hit.doc.title, score: hit.score * boost, matched: hit.matched, folder: place, fits });
        }
        scored.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
        const best = scored.find((r) => r.fits)?.score ?? 0;
        const keep = (r) => r.fits && r.score >= MIN_SCORE && r.score >= best * NEAR_BEST;
        const kept = scored.filter(keep);
        const results = kept.slice(0, limit);
        const others = [...kept.slice(limit), ...scored.filter((r) => !keep(r))].slice(0, 5);
        return { terms: query, results, others };
    }
}
