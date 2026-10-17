/**
 * What Recall's page reads, in one go, and the words its log keeps (no DSH
 * packages, so its tests run anywhere).
 *
 * @module dsh-plugin-recall/page
 */
import { homedir } from 'node:os';
import { basename } from 'node:path';

/** Log entries the page's history lists, newest first. */
const HISTORY = 100;

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** The kinds of files, in the page's and the log's words. */
export const KIND_WORDS = Object.freeze({ session: 'DSH sessions', transcript: 'coding-agent transcripts', handoff: 'handoff notes' });

/** The search fields the page may send, and their bounds. */
const QUERY_FIELDS = Object.freeze({ text: 500, kind: 20, folder: 1000, model: 200, since: 60, until: 60, sort: 10 });

/** A search from the window: only known fields, of the right types. */
export function cleanQuery(query) {
    const q = query !== null && typeof query === 'object' && !Array.isArray(query) ? query : {};
    const out = {};
    for (const [key, max] of Object.entries(QUERY_FIELDS)) {
        if (typeof q[key] === 'string' && q[key].trim() !== '') out[key] = q[key].slice(0, max);
    }
    for (const key of ['limit', 'offset', 'file']) if (Number.isSafeInteger(q[key])) out[key] = q[key];
    if (q.prefix === true) out.prefix = true;
    return out;
}

/** Whether Recall works now: switched on in the profile, and every setting right. */
export const working = ({ config, check }) => config.enabled !== false && (check?.ok ?? true);

/** A length of time in words: "0.4 seconds", "12 seconds", "3 minutes". */
export function secondsWords(ms) {
    const s = Math.max(0, ms) / 1000;
    if (s < 10) return `${Math.round(s * 10) / 10} seconds`;
    if (s < 90) return `${Math.round(s)} seconds`;
    return `${Math.round(s / 60)} minutes`;
}

/**
 * Why Recall cannot search now, in words, or undefined when it can.
 * @param {{ config: object, check: object, thread: { state: string, problem: string } }} parts
 */
export function refusalOf({ config, check, thread }) {
    if (config.enabled === false) return 'Recall is switched off in DSH\'s profile (enabled: false), so it keeps no index.';
    if (!working({ config, check })) return `Recall is waiting for a setting to be fixed: ${String(check?.problem?.text ?? 'a setting is wrong').replace(/\.$/, '')}.`;
    if (thread.state === 'failed') return thread.problem || 'Recall\'s index stopped. Restart it from Recall\'s page.';
    if (thread.state === 'restarting') return thread.problem || 'Recall\'s index is starting again. Try again in a moment.';
    if (thread.state !== 'running') return 'Recall\'s index is starting. Try again in a moment.';
    return undefined;
}

/**
 * Everything the page shows.
 * @param {object} parts
 * @param {object} parts.config - the live settings.
 * @param {object} parts.check - the SettingsCheck.
 * @param {{ state: string, problem: string }} parts.thread - the index thread.
 * @param {() => Promise<object>} parts.status - the index's status (asks the thread).
 * @param {object | undefined} parts.lastStatus - the last status the thread sent.
 * @param {{ left: object[] }} parts.sources - the folders searched, and the ones left out with why.
 * @param {import('./shared/journal.js').Journal} parts.journal
 * @param {string} [parts.home] - the home folder, which the page writes as ~.
 */
export async function pageState({ config, check, thread, status, lastStatus, sources, journal, home = homedir() }) {
    const problem = check?.problem;
    const on = working({ config, check });
    let index = lastStatus;
    let stale = false;
    if (on && thread.state === 'running') {
        try {
            index = await status();
        } catch {
            stale = true;
        }
    }
    return {
        ...(problem ? { problem } : {}),
        enabled: config.enabled !== false,
        tool: config.tool !== false,
        sessions: config.sessions !== false,
        thread: { state: thread.state, problem: thread.problem || '' },
        index: on && index ? { ...index, stale } : undefined,
        left: on ? sources.left : [],
        history: journal.list({ limit: HISTORY }),
        home,
    };
}

/**
 * Turns the index thread's notes into the person's log, a few at a time:
 * - `forgot`: a folder no longer searched, and how much was taken out;
 * - `problem`: files that could not be read (gathered for two seconds, one entry);
 * - `set-aside`: the old index could not be used, so a new one is built;
 * - `caught-up`: the first full read after a start, after a rebuild or a new
 *   folder, or a large catch-up (20 files or more); small ones are not logged.
 */
export class NoteLog {
    /**
     * @param {object} options
     * @param {import('./shared/journal.js').Journal} options.journal
     * @param {(ms: number, fn: () => void) => any} [options.later] - a timer (tests pass their own).
     */
    constructor({ journal, later = (ms, fn) => { const t = setTimeout(fn, ms); t.unref?.(); return t; } }) {
        this.journal = journal;
        this.later = later;
        this.problems = [];
        this.timer = undefined;
        /** Why the next catch-up is worth a line: 'start', 'rebuild' or 'folder'. */
        this.expect = 'start';
        this.seen = new Set();
    }

    /** The next catch-up is logged, with why (a rebuild, a new folder). */
    expectCatchUp(why) {
        if (this.expect !== 'rebuild') this.expect = why;
    }

    note(note) {
        if (!note || typeof note !== 'object') return;
        switch (note.kind) {
            case 'forgot':
                this.journal.add({
                    kind: 'forgot',
                    text: `Stopped searching ${note.root}`,
                    why: `It is no longer in Recall's settings, so its ${plural(note.files ?? 0, 'file')} (${plural(note.turns ?? 0, 'turn')}) were taken out of the index.`,
                    state: 'done',
                });
                return;
            case 'problem': {
                const key = `${note.path}\n${note.error}`;
                if (this.seen.has(key)) return;
                this.seen.add(key);
                if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
                this.problems.push(note);
                if (!this.timer) this.timer = this.later(2000, () => this.flushProblems());
                return;
            }
            case 'set-aside':
                this.journal.add({
                    kind: 'set-aside',
                    text: 'Built a new index',
                    why: 'The old index could not be used (it was damaged, or from another version of Recall), so it was set aside as index.sqlite.old and every file is read again. Searches find more as it goes.',
                    state: 'done',
                });
                this.expect = 'rebuild';
                return;
            case 'caught-up': {
                const why = this.expect;
                const big = (note.read ?? 0) >= 20;
                if (!why && !big) return;
                this.expect = undefined;
                if ((note.read ?? 0) === 0 && why === 'start') return;
                const took = secondsWords(note.ms ?? 0);
                const read = `Read ${plural(note.read ?? 0, 'file')} in ${took}: ${plural(note.rows ?? 0, 'turn or note section', 'turns and note sections')} indexed.`;
                const text = why === 'rebuild' ? 'Rebuilt the index' : why === 'folder' ? 'Read the new folders' : why === 'start' ? 'Caught up with what changed' : 'Read new and changed files';
                this.journal.add({ kind: 'caught-up', text, why: read, state: 'done' });
                return;
            }
            default:
        }
    }

    flushProblems() {
        this.timer = undefined;
        const list = this.problems.splice(0);
        if (list.length === 0) return;
        const first = list[0];
        if (list.length === 1) {
            this.journal.add({ kind: 'problem', text: `Could not read ${basename(first.path)}`, why: `${first.path}: ${String(first.error).replace(/\.$/, '')}. Its turns stay as last read; Recall tries again when it changes.`, state: 'failed' });
            return;
        }
        this.journal.add({
            kind: 'problem',
            text: `Could not read ${plural(list.length, 'file')}`,
            why: `${list.slice(0, 2).map((p) => `${p.path}: ${String(p.error).replace(/\.$/, '')}`).join('; ')}${list.length > 2 ? `; and ${plural(list.length - 2, 'more')}` : ''}. Recall's page lists them under Index; it tries each again when it changes.`,
            state: 'failed',
        });
    }

    stop() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        this.flushProblems();
    }
}
