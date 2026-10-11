/**
 * The plugin's durable state, in its own folder (~/.dsh/calendar, mode 700):
 *
 *   calendar.json            accounts, calendars and the user's choices for
 *                            them, sync state, preferences (mode 600). Never a
 *                            secret: passwords and sign-ins are in DSH's
 *                            credential store.
 *   events/<calendar>.json   each calendar's items: what the server holds
 *                            (iCalendar text for CalDAV and local calendars)
 *                            and the events read from it (mode 600).
 *
 * calendar.json:
 * { version: 1,
 *   accounts: { [id]: { id, kind, name, url?, username?, email?, preset?, allowHttp?, createdAt,
 *     calendars?: [{remoteId, name, color}] (local accounts: their calendars), error?, syncedAt? } },
 *   calendars: { [id]: { id, accountId, remoteId, name, color?, readOnly?, timeZone?, description?, mode?,
 *     own?: {name?, color?} (the user's choices, over the server's), hidden?, sync?: opaque state, syncedAt?, error? } },
 *   prefs: { defaultCalendar?, weekStart?, ... } }
 *
 * @module dsh-plugin-calendar/store
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/** Resolve a '~'-prefixed path. */
export function expand(p) {
    return p.startsWith('~/') || p === '~' ? `${homedir()}${p.slice(1)}` : p;
}

/** DSH's own data folder: `$DSH_HOME`, else ~/.dsh, as DSH resolves it. */
export function dshHome() {
    const env = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
    return env === '' ? join(homedir(), '.dsh') : resolve(expand(env));
}

/** A data path: one under ~/.dsh follows DSH_HOME, so a test copy of DSH keeps its own calendars. */
export function dataPath(p) {
    if (p === '~/.dsh' || p.startsWith('~/.dsh/')) return `${dshHome()}${p.slice('~/.dsh'.length)}`;
    return expand(p);
}

/** A folder (and missing parents) as mode 700, whatever the umask. */
export function ensurePrivateDir(dir) {
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

/** Write a file atomically as mode 600, its folder made private first. */
export function writePrivate(file, text) {
    ensurePrivateDir(dirname(file));
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
}

const plain = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});
const ID = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * Each start of the plugin reads the files as they are then; nothing is
 * kept across a switch-off, so the next start sees what the files say.
 */
export class CalendarStore {
    /** @param {string} file - calendar.json's path; the events folder sits beside it. */
    constructor(file) {
        this.file = dataPath(file);
        this.eventsDir = join(dirname(this.file), 'events');
        this.accounts = {};
        this.calendars = {};
        this.prefs = {};
        /** @type {Map<string, Record<string, object>>} calendar id → its items by remote id */
        this.items = new Map();
        this.dirty = new Set();
        this.timer = undefined;
        this.load();
    }

    load() {
        this.accounts = {};
        this.calendars = {};
        this.prefs = {};
        this.items.clear();
        try {
            const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
            if (parsed?.version === 1) {
                for (const [id, a] of Object.entries(plain(parsed.accounts))) {
                    if (ID.test(id) && typeof a?.kind === 'string') this.accounts[id] = { ...a, id };
                }
                for (const [id, c] of Object.entries(plain(parsed.calendars))) {
                    if (ID.test(id) && typeof c?.accountId === 'string' && this.accounts[c.accountId]) this.calendars[id] = { ...c, id };
                }
                this.prefs = plain(parsed.prefs);
            }
        } catch {
            // Missing or unreadable: start clean, never crash.
        }
        for (const id of Object.keys(this.calendars)) {
            try {
                const parsed = JSON.parse(readFileSync(this.eventsFile(id), 'utf8'));
                this.items.set(id, parsed?.version === 1 ? plain(parsed.items) : {});
            } catch {
                this.items.set(id, {});
            }
        }
    }

    eventsFile(calendarId) {
        return join(this.eventsDir, `${calendarId}.json`);
    }

    /** Write calendar.json now. */
    save() {
        writePrivate(this.file, `${JSON.stringify({ version: 1, accounts: this.accounts, calendars: this.calendars, prefs: this.prefs }, null, 1)}\n`);
    }

    /** A calendar's items by remote id (made empty on first use). */
    itemsOf(calendarId) {
        let items = this.items.get(calendarId);
        if (items === undefined) {
            items = {};
            this.items.set(calendarId, items);
        }
        return items;
    }

    /** Mark a calendar's items changed; they're written shortly after (several changes, one write). */
    touch(calendarId) {
        this.dirty.add(calendarId);
        if (this.timer !== undefined) return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flush();
        }, 400);
        this.timer.unref?.();
    }

    /** Write every changed calendar's items now. */
    flush() {
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        for (const id of [...this.dirty]) {
            this.dirty.delete(id);
            if (!this.calendars[id]) continue;
            try {
                writePrivate(this.eventsFile(id), `${JSON.stringify({ version: 1, items: this.itemsOf(id) })}\n`);
            } catch {
                // Kept in memory; the next change writes it again.
                this.dirty.add(id);
            }
        }
    }

    /** Forget a calendar and its items. */
    dropCalendar(calendarId) {
        delete this.calendars[calendarId];
        this.items.delete(calendarId);
        this.dirty.delete(calendarId);
        try { rmSync(this.eventsFile(calendarId), { force: true }); } catch {}
    }

    /** Events files of calendars the store no longer has (left by a crash): removed. */
    sweep() {
        try {
            for (const name of readdirSync(this.eventsDir)) {
                const id = name.replace(/\.json$/, '');
                if (name.endsWith('.json') && !this.calendars[id]) rmSync(join(this.eventsDir, name), { force: true });
                if (name.endsWith('.tmp')) rmSync(join(this.eventsDir, name), { force: true });
            }
        } catch {}
    }
}
