/**
 * The calendar manager: accounts and their calendars, syncing, the events
 * in a span of time, and changes routed to the server that holds each
 * event. The window (remote.js) and the agent tools (tools.js) both go
 * through it, so the user and agents see and change the same calendars.
 *
 * Ids it hands out:
 *   account     'local', or 'acct-' + 8 hex (also the credential record's id)
 *   calendar    'cal-' + 12 hex, from its account and its server id
 *   event       'ev-' + 12 hex, from its calendar and uid; the same across syncs (a
 *               series and its changed occurrences share it, whichever items hold them)
 *   occurrence  the event id, plus '.' and the original start of that
 *               occurrence ('ev-…​.20261012T093000', '.20261012' for a day) when
 *               the event repeats
 *
 * @module dsh-plugin-calendar/manager
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync } from 'node:fs';
import { occurrences } from './expand.js';
import { request } from './http.js';
import { editIcs, newUid, readIcs } from './ical.js';
import { cleanRecord, instantOf, sameTime } from './model.js';
import { describeRule, expandWall, parseRule, ruleText, WEEKDAYS } from './recur.js';
import { CalendarStore, dataPath, ensurePrivateDir } from './store.js';
import { SourceError, sourceModule } from './sources/index.js';
import { addDays, dayIn, daysBetween, isDay, isZone, localZone, normalLocal, toInstant, toLocal, wallMs, wallOf } from './zones.js';
import { dirname } from 'node:path';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const CONFLICT = Symbol('conflict');

/** A refusal the user (or the agent) can act on: its message says what to do. */
export class CalendarError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CalendarError';
    }
}

const hex = (text, n) => createHash('sha256').update(text).digest('hex').slice(0, n);
export const calendarIdOf = (accountId, remoteId) => `cal-${hex(`${accountId}\n${remoteId}`, 12)}`;
export const eventIdOf = (calendarId, uid) => `ev-${hex(`${calendarId}\n${uid}`, 12)}`;

/** A Time as the part of an occurrence id after the dot. */
export function compactTime(time) {
    if ('date' in time) return time.date.replaceAll('-', '');
    return `${time.local.replace(/[-:]/g, '')}${time.tz === 'UTC' ? 'Z' : ''}`;
}

/** That part back to a Time, in the series' zone. */
function timeOfCompact(text, tz) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(text);
    if (m === null) return undefined;
    if (m[4] === undefined) return { date: `${m[1]}-${m[2]}-${m[3]}` };
    return { local: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`, tz: m[7] ? 'UTC' : (tz ?? null) };
}

/** Colors for calendars that come without one. */
export const PALETTE = ['#4f7cff', '#e5484d', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e54666', '#0090ff', '#ad7f58', '#6e56cf'];

const KIND_NAMES = { local: 'On this computer', ics: 'Subscription', caldav: 'CalDAV', google: 'Google', microsoft: 'Microsoft' };

/** Fields a change may set, as the window and the tools give them. */
const INPUT_FIELDS = ['title', 'start', 'end', 'allDay', 'timeZone', 'location', 'description', 'url', 'repeat', 'alarms', 'attendees', 'busy', 'privacy', 'status', 'conference'];

export class CalendarManager {
    /**
     * @param {object} opts
     * @param {object} opts.config - the plugin's settings (index.js Config).
     * @param {{get(id): Promise<any>, set(id, payload): Promise<void>, clear(id): Promise<void>}} opts.secrets -
     *   the accounts' secrets, by account id (DSH's credential store).
     * @param {() => Promise<object>} [opts.clientSettings] - OAuth client ids and the like, read when a source needs them.
     * @param {typeof fetch} [opts.fetch] - for tests.
     * @param {() => number} [opts.now] - for tests.
     * @param {object} [opts.logger] - DSH's logger, for warnings.
     */
    constructor({ config, secrets, clientSettings, fetch, now, logger }) {
        this.config = config;
        this.secrets = secrets;
        this.clientSettings = clientSettings ?? (async () => ({}));
        this.fetch = fetch;
        this.now = now ?? Date.now;
        this.logger = logger;
        this.store = new CalendarStore(config.storeFile);
        this.logFile = config.logFile ? dataPath(config.logFile) : '';
        /** Bumped on every change the window should redraw for. */
        this.version = 1;
        this.sources = new Map();
        this.locks = new Map();
        this.flows = new Map();
        this.timers = new Set();
        this.syncing = new Set();
        this.disposed = false;
        this.indexVersion = 0;
        this.eventIndex = new Map();
    }

    // ── Lifecycle ──────────────────────────────────────────────────────

    async start() {
        this.store.sweep();
        if (!Object.values(this.store.accounts).some((a) => a.kind === 'local')) {
            this.store.accounts.local = {
                id: 'local', kind: 'local', name: KIND_NAMES.local, createdAt: this.now(),
                calendars: [{ remoteId: 'personal', name: 'Personal', color: PALETTE[0] }],
            };
            this.log('account added local');
        }
        await this.refreshCalendars('local');
        this.saveState();
        const minutes = Math.max(5, Number(this.config.syncMinutes) || 15);
        this.later(() => this.syncAll(), 3000);
        const every = setInterval(() => { void this.syncAll(); }, minutes * MINUTE);
        every.unref?.();
        this.timers.add({ clear: () => clearInterval(every) });
    }

    dispose() {
        this.disposed = true;
        for (const t of this.timers) t.clear();
        this.timers.clear();
        for (const flow of this.flows.values()) {
            try { flow.handle?.cancel?.(); } catch {}
        }
        this.flows.clear();
        this.store.flush();
    }

    /** Run something once after a delay, unless the plugin stops first. */
    later(run, ms) {
        const entry = {};
        const timer = setTimeout(() => {
            this.timers.delete(entry);
            if (!this.disposed) void Promise.resolve().then(run).catch((error) => this.log(`error later ${short(error)}`));
        }, ms);
        timer.unref?.();
        entry.clear = () => clearTimeout(timer);
        this.timers.add(entry);
    }

    /** One line in the plugin's log: ids, kinds and counts, never secrets or event text. */
    log(line) {
        if (!this.logFile) return;
        try {
            const fresh = !existsSync(this.logFile);
            if (fresh) ensurePrivateDir(dirname(this.logFile));
            appendFileSync(this.logFile, `${new Date(this.now()).toISOString()} ${line}\n`, { mode: 0o600 });
            if (fresh) chmodSync(this.logFile, 0o600);
        } catch {
            // The log is for diagnosis; never let it break a change.
        }
    }

    saveState() {
        try {
            this.store.save();
        } catch (error) {
            this.log(`error save ${short(error)}`);
        }
    }

    changed() {
        this.version++;
    }

    /** The user's zone: the plugin setting, else this computer's. */
    zone() {
        const own = typeof this.config.timeZone === 'string' ? this.config.timeZone.trim() : '';
        return own !== '' && isZone(own) ? own : localZone();
    }

    // ── Sources ────────────────────────────────────────────────────────

    async envFor(account) {
        const settings = await this.clientSettings();
        return {
            request: (url, init = {}) => request(url, { ...init, allowHttp: account.allowHttp === true || init.allowHttp === true, fetch: this.fetch ?? init.fetch }),
            secret: {
                get: () => this.secrets.get(account.id),
                set: (payload) => this.secrets.set(account.id, payload),
                clear: () => this.secrets.clear(account.id),
            },
            log: (line) => this.log(`${account.id} ${line}`),
            now: this.now,
            zone: this.zone(),
            settings,
        };
    }

    /** The source for an account, made once per account (and again after the account changes). */
    async source(account) {
        const key = `${account.id}\n${account.kind}\n${account.url ?? ''}\n${account.username ?? ''}\n${JSON.stringify(account.calendars ?? [])}`;
        const had = this.sources.get(account.id);
        if (had?.key === key) return had;
        const module = await sourceModule(account.kind);
        const made = { key, module, style: module.style, source: module.create(account, await this.envFor(account)) };
        this.sources.set(account.id, made);
        return made;
    }

    // ── Accounts and calendars ─────────────────────────────────────────

    account(id) {
        const account = this.store.accounts[id];
        if (account === undefined) throw new CalendarError(`There is no calendar account "${id}".`);
        return account;
    }

    calendar(id) {
        const calendar = this.store.calendars[id];
        if (calendar === undefined) throw new CalendarError(`There is no calendar "${id}". The calendars are: ${this.calendarList().map((c) => `${c.name} (${c.id})`).join(', ') || 'none'}.`);
        return calendar;
    }

    /** A calendar's name and color: the user's own choice over the server's. */
    calendarName(calendar) {
        return calendar.own?.name || calendar.name || 'Calendar';
    }

    calendarColor(calendar) {
        return calendar.own?.color || calendar.color || PALETTE[0];
    }

    calendarView(calendar) {
        const account = this.store.accounts[calendar.accountId];
        return {
            id: calendar.id,
            accountId: calendar.accountId,
            account: account?.name ?? '',
            kind: account?.kind ?? '',
            name: this.calendarName(calendar),
            color: this.calendarColor(calendar),
            readOnly: calendar.readOnly === true,
            hidden: calendar.hidden === true,
            isDefault: this.defaultCalendarId() === calendar.id,
            ...(calendar.timeZone ? { timeZone: calendar.timeZone } : {}),
            ...(calendar.description ? { description: calendar.description } : {}),
            ...(calendar.error ? { error: calendar.error.message } : {}),
            ...(calendar.syncedAt ? { syncedAt: calendar.syncedAt } : {}),
        };
    }

    /** Every calendar, in account order then name. */
    calendarList() {
        const accounts = Object.values(this.store.accounts);
        const order = new Map(accounts.map((a, i) => [a.id, a.kind === 'local' ? -1 : i]));
        return Object.values(this.store.calendars)
            .sort((a, b) => (order.get(a.accountId) ?? 0) - (order.get(b.accountId) ?? 0) || this.calendarName(a).localeCompare(this.calendarName(b)))
            .map((c) => this.calendarView(c));
    }

    accountView(account) {
        return {
            id: account.id,
            kind: account.kind,
            kindName: KIND_NAMES[account.kind] ?? account.kind,
            name: account.name,
            ...(account.email ? { email: account.email } : {}),
            ...(account.username ? { username: account.username } : {}),
            ...(account.url ? { url: safeAddress(account.url) } : {}),
            ...(account.preset ? { preset: account.preset } : {}),
            status: this.syncing.has(account.id) ? 'syncing' : account.error?.code === 'auth' ? 'signin' : account.error ? 'error' : 'ok',
            ...(account.error ? { error: account.error.message } : {}),
            ...(account.syncedAt ? { syncedAt: account.syncedAt } : {}),
        };
    }

    /** The calendar new events go to: the user's choice, else the first one that can be written. */
    defaultCalendarId() {
        const chosen = this.store.prefs.defaultCalendar;
        if (chosen && this.store.calendars[chosen] && !this.store.calendars[chosen].readOnly) return chosen;
        const writable = Object.values(this.store.calendars).filter((c) => !c.readOnly && !c.hidden);
        const local = writable.find((c) => c.accountId === 'local');
        return (writable.find((c) => c.accountId !== 'local') ?? local ?? writable[0])?.id;
    }

    /** Read the account's calendars from its server; add new ones, drop gone ones. */
    async refreshCalendars(accountId) {
        const account = this.account(accountId);
        const { source } = await this.source(account);
        const found = await source.calendars();
        const seen = new Set();
        let added = 0;
        for (const [i, c] of found.entries()) {
            const id = calendarIdOf(account.id, c.remoteId);
            seen.add(id);
            const had = this.store.calendars[id];
            const color = c.color || had?.color || PALETTE[(Object.keys(this.store.calendars).length + i) % PALETTE.length];
            this.store.calendars[id] = {
                ...had, id, accountId: account.id, remoteId: c.remoteId, name: c.name || had?.name || 'Calendar', color,
                readOnly: c.readOnly === true, mode: c.mode ?? 'masters',
                ...(c.timeZone ? { timeZone: c.timeZone } : {}), ...(c.description ? { description: c.description } : {}),
            };
            if (had === undefined) {
                added++;
                this.store.itemsOf(id);
            }
        }
        let dropped = 0;
        for (const c of Object.values(this.store.calendars)) {
            if (c.accountId === account.id && !seen.has(c.id)) {
                this.store.dropCalendar(c.id);
                dropped++;
            }
        }
        account.calendarsAt = this.now();
        if (added || dropped) this.log(`calendars ${account.id} added=${added} dropped=${dropped} total=${seen.size}`);
        this.saveState();
        this.changed();
    }

    /**
     * Add an account: a subscription ({kind: 'ics', url, name?}), or a CalDAV
     * account ({kind: 'caldav', url, username, password, preset?, name?,
     * allowHttp?}), checked before it's kept. Google and Microsoft accounts
     * come from startSignIn.
     */
    async addAccount(input) {
        const kind = input?.kind;
        if (kind === 'ics') return this.addSubscription(input);
        if (kind === 'caldav') return this.addCalDav(input);
        if (kind === 'google' || kind === 'microsoft') throw new CalendarError(`${KIND_NAMES[kind]} accounts are added by signing in.`);
        throw new CalendarError('Say which kind of account: a subscription (ics) or CalDAV.');
    }

    newAccountId() {
        for (;;) {
            const id = `acct-${randomBytes(4).toString('hex')}`;
            if (!this.store.accounts[id]) return id;
        }
    }

    async addSubscription(input) {
        const raw = String(input.url ?? '').trim();
        let url;
        try {
            url = new URL(raw.replace(/^webcals?:\/\//i, 'https://'));
        } catch {
            throw new CalendarError('Give the calendar\'s address, like https://example.com/calendar.ics or webcal://….');
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CalendarError('A subscribed calendar\'s address starts with https:// or webcal://.');
        const id = this.newAccountId();
        const account = { id, kind: 'ics', name: String(input.name ?? '').trim() || url.hostname, url: raw, createdAt: this.now(), ...(input.allowHttp === true ? { allowHttp: true } : {}) };
        this.store.accounts[id] = account;
        try {
            await this.refreshCalendars(id);
            const [calendar] = Object.values(this.store.calendars).filter((c) => c.accountId === id);
            await this.syncCalendar(calendar.id, { throwErrors: true });
            if (!input.name && calendar.name) account.name = calendar.name;
        } catch (error) {
            this.forgetAccount(id);
            throw asCalendarError(error);
        }
        this.log(`account added ${id} ics`);
        this.saveState();
        return this.accountView(account);
    }

    async addCalDav(input) {
        const username = String(input.username ?? '').trim();
        const password = String(input.password ?? '');
        const url = String(input.url ?? '').trim();
        if (url === '') throw new CalendarError('Give the server\'s address.');
        if (username === '' || password === '') throw new CalendarError('Give the user name and the password (an app password for iCloud, Fastmail and Yahoo).');
        const id = this.newAccountId();
        const account = {
            id, kind: 'caldav', name: String(input.name ?? '').trim() || username, url, username,
            ...(input.preset ? { preset: String(input.preset) } : {}), ...(input.allowHttp === true ? { allowHttp: true } : {}),
            createdAt: this.now(),
        };
        if (/^[^@\s]+@[^@\s]+$/.test(username)) account.email = username;
        await this.secrets.set(id, { password });
        try {
            const module = await sourceModule('caldav');
            const found = await module.discover(account, await this.envFor(account));
            if (!found?.calendars?.length) throw new CalendarError('The server has no calendars for this account.');
            this.store.accounts[id] = account;
            await this.refreshCalendars(id);
        } catch (error) {
            delete this.store.accounts[id];
            await this.secrets.clear(id).catch(() => {});
            this.sources.delete(id);
            throw asCalendarError(error);
        }
        this.log(`account added ${id} caldav${account.preset ? ` ${account.preset}` : ''}`);
        this.saveState();
        void this.syncAccount(id);
        return this.accountView(account);
    }

    /** Change an account's name, or its password (CalDAV), then sync it. */
    async updateAccount(id, patch = {}) {
        const account = this.account(id);
        if (typeof patch.name === 'string' && patch.name.trim() !== '') account.name = patch.name.trim();
        if (typeof patch.password === 'string' && patch.password !== '') {
            if (account.kind !== 'caldav') throw new CalendarError('Only CalDAV accounts have a password here; sign in again for Google and Microsoft.');
            await this.secrets.set(id, { password: patch.password });
            delete account.error;
            this.sources.delete(id);
            void this.syncAccount(id);
        }
        this.saveState();
        this.changed();
        return this.accountView(account);
    }

    /** Remove an account: its calendars and their events leave this plugin (nothing on the server changes). */
    async removeAccount(id) {
        const account = this.account(id);
        if (account.kind === 'local') throw new CalendarError('The calendars on this computer stay; delete a calendar instead.');
        this.forgetAccount(id);
        await this.secrets.clear(id).catch(() => {});
        this.log(`account removed ${id} ${account.kind}`);
        this.saveState();
        this.changed();
    }

    forgetAccount(id) {
        for (const c of Object.values(this.store.calendars)) if (c.accountId === id) this.store.dropCalendar(c.id);
        delete this.store.accounts[id];
        this.sources.delete(id);
    }

    /** A new calendar on this computer. */
    async createCalendar({ name, color } = {}) {
        const account = this.account('local');
        const title = String(name ?? '').trim();
        if (title === '') throw new CalendarError('Give the calendar a name.');
        const remoteId = `cal-${randomBytes(4).toString('hex')}`;
        account.calendars = [...(account.calendars ?? []), { remoteId, name: title, color: validColor(color) ?? PALETTE[(account.calendars?.length ?? 0) % PALETTE.length] }];
        this.sources.delete('local');
        await this.refreshCalendars('local');
        this.log('calendar added local');
        return this.calendarView(this.calendar(calendarIdOf('local', remoteId)));
    }

    /** Delete a calendar on this computer, with its events. */
    async deleteCalendar(id) {
        const calendar = this.calendar(id);
        if (calendar.accountId !== 'local') throw new CalendarError('Only calendars on this computer are deleted here; hide a synced one, or delete it in its own app.');
        const account = this.account('local');
        if ((account.calendars ?? []).length <= 1) throw new CalendarError('This is the last calendar on this computer; it stays.');
        account.calendars = account.calendars.filter((c) => c.remoteId !== calendar.remoteId);
        this.sources.delete('local');
        await this.refreshCalendars('local');
        this.log('calendar deleted local');
    }

    /** The user's choices for a calendar: name, color, hidden. */
    updateCalendar(id, patch = {}) {
        const calendar = this.calendar(id);
        const own = { ...calendar.own };
        if (typeof patch.name === 'string') {
            const name = patch.name.trim();
            if (calendar.accountId === 'local' && name !== '') {
                const account = this.account('local');
                account.calendars = (account.calendars ?? []).map((c) => (c.remoteId === calendar.remoteId ? { ...c, name } : c));
                calendar.name = name;
                this.sources.delete('local');
            } else if (name === '') {
                delete own.name;
            } else {
                own.name = name;
            }
        }
        if (typeof patch.color === 'string') {
            const color = validColor(patch.color);
            if (color) own.color = color;
        }
        calendar.own = own;
        if (typeof patch.hidden === 'boolean') calendar.hidden = patch.hidden;
        this.saveState();
        this.changed();
        return this.calendarView(calendar);
    }

    setDefaultCalendar(id) {
        const calendar = this.calendar(id);
        if (calendar.readOnly) throw new CalendarError(`"${this.calendarName(calendar)}" can't be written, so new events can't go there.`);
        this.store.prefs.defaultCalendar = id;
        this.saveState();
        this.changed();
    }

    setPrefs(patch = {}) {
        const prefs = this.store.prefs;
        if (patch.weekStart === null || (Number.isInteger(patch.weekStart) && patch.weekStart >= 0 && patch.weekStart <= 6)) {
            if (patch.weekStart === null) delete prefs.weekStart;
            else prefs.weekStart = patch.weekStart;
        }
        if (typeof patch.view === 'string' && ['month', 'week', 'day', 'agenda'].includes(patch.view)) prefs.view = patch.view;
        if (typeof patch.googleClientId === 'string') prefs.googleClientId = patch.googleClientId.trim();
        if (typeof patch.microsoftClientId === 'string') prefs.microsoftClientId = patch.microsoftClientId.trim();
        if (typeof patch.microsoftTenant === 'string') prefs.microsoftTenant = patch.microsoftTenant.trim();
        this.saveState();
        this.changed();
        return { ...prefs };
    }

    // ── Signing in (Google, Microsoft) ─────────────────────────────────

    /**
     * Start signing in to Google or Microsoft, for a new account or again for
     * one whose sign-in ran out. Google: open `url` in a browser on this
     * computer (or paste where it ends with finishSignIn). Microsoft: open
     * `verificationUri` anywhere and enter `userCode`.
     */
    async startSignIn(kind, accountId) {
        if (kind !== 'google' && kind !== 'microsoft') throw new CalendarError('Signing in is for Google and Microsoft accounts.');
        const existing = accountId ? this.account(accountId) : undefined;
        if (existing && existing.kind !== kind) throw new CalendarError('That account is of another kind.');
        for (const [id, flow] of this.flows) {
            if (flow.status === 'waiting') {
                try { flow.handle?.cancel?.(); } catch {}
                this.flows.delete(id);
            }
        }
        const module = await sourceModule(kind);
        const env = await this.envFor(existing ?? { id: 'new', kind });
        let handle;
        try {
            handle = kind === 'google' ? await module.signIn(env, existing?.email ? { loginHint: existing.email } : {}) : await module.signIn(env);
        } catch (error) {
            throw asCalendarError(error);
        }
        const id = `flow-${randomBytes(6).toString('hex')}`;
        const flow = { id, kind, status: 'waiting', handle, accountId, created: this.now() };
        this.flows.set(id, flow);
        handle.done.then((result) => this.finishFlow(flow, result), (error) => {
            flow.status = 'failed';
            flow.error = asCalendarError(error).message;
            this.log(`signin failed ${kind} ${error?.code ?? ''}`);
        });
        this.later(() => {
            if (flow.status === 'waiting') {
                try { handle.cancel?.(); } catch {}
                flow.status = 'failed';
                flow.error = 'The sign-in took too long. Start it again.';
            }
            this.later(() => this.flows.delete(id), 10 * MINUTE);
        }, 15 * MINUTE);
        this.log(`signin started ${kind}`);
        return this.flowView(flow);
    }

    flowView(flow) {
        const h = flow.handle ?? {};
        return {
            flow: flow.id, kind: flow.kind, status: flow.status,
            ...(h.url ? { url: h.url } : {}),
            ...(h.userCode ? { userCode: h.userCode, verificationUri: h.verificationUri, message: h.message, expiresAt: h.expiresAt } : {}),
            ...(flow.error ? { error: flow.error } : {}),
            ...(flow.account ? { account: this.accountView(this.store.accounts[flow.account] ?? { id: flow.account, kind: flow.kind, name: '' }) } : {}),
        };
    }

    async finishFlow(flow, result) {
        try {
            const email = typeof result?.email === 'string' ? result.email : '';
            let account = flow.accountId ? this.store.accounts[flow.accountId] : undefined;
            if (account === undefined) {
                // Signing in again to an account already here keeps it.
                account = Object.values(this.store.accounts).find((a) => a.kind === flow.kind && email && a.email?.toLowerCase() === email.toLowerCase());
            }
            if (account === undefined) {
                const id = this.newAccountId();
                account = { id, kind: flow.kind, name: email || KIND_NAMES[flow.kind], ...(email ? { email } : {}), createdAt: this.now() };
            }
            await this.secrets.set(account.id, result.grant);
            delete account.error;
            this.store.accounts[account.id] = account;
            this.sources.delete(account.id);
            await this.refreshCalendars(account.id);
            flow.status = 'done';
            flow.account = account.id;
            this.log(`signin done ${flow.kind} ${account.id}`);
            this.saveState();
            void this.syncAccount(account.id);
        } catch (error) {
            flow.status = 'failed';
            flow.error = asCalendarError(error).message;
            this.log(`signin failed ${flow.kind} ${short(error)}`);
        }
    }

    signInStatus(flowId) {
        const flow = this.flows.get(flowId);
        if (flow === undefined) throw new CalendarError('That sign-in is over. Start it again.');
        return this.flowView(flow);
    }

    /** Google, when the browser can't come back to this computer: the address it ended on, pasted. */
    async finishSignIn(flowId, pastedUrl) {
        const flow = this.flows.get(flowId);
        if (flow === undefined) throw new CalendarError('That sign-in is over. Start it again.');
        if (typeof flow.handle?.finish !== 'function') throw new CalendarError('This sign-in finishes on its own once the code is entered.');
        try {
            await flow.handle.finish(String(pastedUrl ?? '').trim());
        } catch (error) {
            throw asCalendarError(error);
        }
        for (let i = 0; i < 50 && flow.status === 'waiting'; i++) await new Promise((r) => setTimeout(r, 100));
        return this.flowView(flow);
    }

    cancelSignIn(flowId) {
        const flow = this.flows.get(flowId);
        if (flow === undefined) return;
        try { flow.handle?.cancel?.(); } catch {}
        this.flows.delete(flowId);
    }

    // ── Syncing ────────────────────────────────────────────────────────

    /** The span of time sources that sync a window keep: three months back, thirteen ahead, by whole months. */
    syncWindow() {
        const d = new Date(this.now());
        return { from: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 3, 1), to: Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 13, 1) };
    }

    /** One thing at a time per key; the rest wait their turn. */
    async locked(key, run) {
        const before = this.locks.get(key) ?? Promise.resolve();
        let release;
        const mine = new Promise((resolve) => { release = resolve; });
        const chain = before.then(() => mine);
        this.locks.set(key, chain);
        await before.catch(() => {});
        try {
            return await run();
        } finally {
            release();
            if (this.locks.get(key) === chain) this.locks.delete(key);
        }
    }

    async syncAll() {
        for (const account of Object.values(this.store.accounts)) {
            if (this.disposed) return;
            if (account.kind === 'local') continue;
            if (account.error?.code === 'auth') continue;
            if (account.error?.code === 'rate' && account.error.until > this.now()) continue;
            await this.syncAccount(account.id).catch(() => {});
        }
    }

    /** Sync an account's calendars (and its calendar list, at most hourly or when asked). */
    async syncAccount(accountId, { calendars: listToo = false } = {}) {
        const account = this.store.accounts[accountId];
        if (account === undefined || account.kind === 'local') return;
        if (this.syncing.has(accountId)) return;
        this.syncing.add(accountId);
        this.changed();
        try {
            if (listToo || !account.calendarsAt || this.now() - account.calendarsAt > HOUR) {
                try {
                    await this.refreshCalendars(accountId);
                } catch (error) {
                    this.noteError(account, undefined, error);
                    return;
                }
            }
            let failed = false;
            for (const calendar of Object.values(this.store.calendars).filter((c) => c.accountId === accountId)) {
                if (this.disposed) return;
                const ok = await this.syncCalendar(calendar.id).catch(() => false);
                if (!ok) failed = true;
                if (account.error?.code === 'auth') break;
            }
            if (!failed) delete account.error;
            account.syncedAt = this.now();
            this.saveState();
        } finally {
            this.syncing.delete(accountId);
            this.changed();
        }
    }

    /** Sync one calendar. @returns whether it worked. */
    async syncCalendar(calendarId, { throwErrors = false } = {}) {
        return this.locked(`sync:${calendarId}`, async () => {
            const calendar = this.store.calendars[calendarId];
            if (calendar === undefined) return false;
            const account = this.store.accounts[calendar.accountId];
            if (account === undefined) return false;
            try {
                const { source, style } = await this.source(account);
                const result = await source.sync({ ...calendar, remoteId: calendar.remoteId }, calendar.sync, this.syncWindow());
                this.applySync(calendar, style, result);
                calendar.sync = result.state;
                calendar.syncedAt = this.now();
                delete calendar.error;
                if (result.calendar) {
                    if (result.calendar.name && !calendar.own?.name && account.kind === 'ics') calendar.name = result.calendar.name;
                    if (result.calendar.color && account.kind === 'ics') calendar.color = result.calendar.color;
                    if (result.calendar.timeZone) calendar.timeZone = result.calendar.timeZone;
                }
                this.saveState();
                return true;
            } catch (error) {
                this.noteError(account, calendar, error);
                this.saveState();
                if (throwErrors) throw error;
                return false;
            } finally {
                this.changed();
            }
        });
    }

    noteError(account, calendar, error) {
        const code = error instanceof SourceError ? error.code : error?.code === 'timeout' || error?.name === 'HttpError' ? 'network' : 'server';
        const message = error instanceof SourceError || error instanceof CalendarError ? error.message : `Syncing failed: ${short(error)}`;
        const note = { code, message, at: this.now() };
        if (code === 'rate') note.until = this.now() + (Number(error.retryAfter) || 60) * 1000;
        if (calendar) calendar.error = note;
        if (code === 'auth' || code === 'rate' || calendar === undefined) account.error = note;
        this.log(`error sync ${account.id}${calendar ? ` ${calendar.id}` : ''} ${code}`);
    }

    /** What a sync brought, into the calendar's items. */
    applySync(calendar, style, result) {
        const zone = this.zone();
        const prepare = (item) => {
            let events = Array.isArray(item.events) ? item.events : [];
            if (style === 'ics' && typeof item.raw === 'string' && events.length === 0) events = readIcs(item.raw, { zone }).events;
            const out = { remoteId: item.remoteId, events: events.map(cleanRecord) };
            if (item.etag !== undefined) out.etag = item.etag;
            if (style === 'ics' && typeof item.raw === 'string' && !calendar.readOnly) out.raw = item.raw;
            return out;
        };
        if (result.reset) {
            const next = {};
            for (const item of result.items ?? []) next[item.remoteId] = prepare(item);
            this.store.items.set(calendar.id, next);
        } else {
            const items = this.store.itemsOf(calendar.id);
            for (const item of result.items ?? []) items[item.remoteId] = prepare(item);
            for (const remoteId of result.removed ?? []) delete items[remoteId];
        }
        const count = (result.items?.length ?? 0) + (result.removed?.length ?? 0);
        if (result.reset || count > 0) {
            this.store.touch(calendar.id);
            this.changed();
            this.log(`synced ${calendar.id} ${result.reset ? 'reset' : 'delta'} items=${result.items?.length ?? 0} removed=${result.removed?.length ?? 0}`);
        }
    }

    // ── Reading ────────────────────────────────────────────────────────

    /** event id → where it lives; rebuilt when the data changed. */
    index() {
        if (this.indexVersion === this.version) return this.eventIndex;
        const map = new Map();
        for (const calendar of Object.values(this.store.calendars)) {
            for (const item of Object.values(this.store.itemsOf(calendar.id))) {
                for (const record of item.events ?? []) {
                    const id = eventIdOf(calendar.id, record.uid);
                    if (!map.has(id)) map.set(id, { calendarId: calendar.id, uid: record.uid });
                }
            }
        }
        this.eventIndex = map;
        this.indexVersion = this.version;
        return map;
    }

    /** The account's own addresses, to tell which attendee is the user. */
    selfEmails(account) {
        const out = new Set();
        for (const value of [account?.email, account?.username]) if (typeof value === 'string' && value.includes('@')) out.add(value.toLowerCase());
        return out;
    }

    selfOf(record, account) {
        const mine = this.selfEmails(account);
        return (record.attendees ?? []).find((p) => p.self || mine.has(String(p.email).toLowerCase()));
    }

    /**
     * The occurrences in [from, to), each with its calendar, item and ids.
     * @param {{from: number, to: number, calendars?: string[], all?: boolean}} q - calendars: these
     *   only (hidden ones too); all: hidden calendars too.
     */
    find({ from, to, calendars, all = false }) {
        const zone = this.zone();
        const out = [];
        const wanted = calendars?.length ? new Set(calendars) : undefined;
        for (const calendar of Object.values(this.store.calendars)) {
            if (wanted ? !wanted.has(calendar.id) : (calendar.hidden && !all)) continue;
            // A series and its changed occurrences can sit in different items (Google keeps each as its own event).
            const groups = new Map();
            for (const item of Object.values(this.store.itemsOf(calendar.id))) {
                for (const record of item.events ?? []) {
                    let group = groups.get(record.uid);
                    if (group === undefined) {
                        group = { records: [], items: new Map() };
                        groups.set(record.uid, group);
                    }
                    group.records.push(record);
                    group.items.set(record, item);
                }
            }
            for (const group of groups.values()) {
                for (const o of occurrences(group.records, { from, to, zone, mode: calendar.mode })) {
                    out.push({ o, calendar, item: group.items.get(o.record) });
                }
            }
        }
        return out.sort((a, b) => a.o.start - b.o.start || Number(b.o.allDay) - Number(a.o.allDay) || a.o.end - b.o.end);
    }

    /** An occurrence as the window and the tools see it. */
    view({ o, calendar, item }) {
        const record = o.record;
        const series = o.series;
        const account = this.store.accounts[calendar.accountId];
        const eventId = eventIdOf(calendar.id, record.uid);
        const repeats = series !== undefined || record.seriesRemoteId !== undefined;
        const zone = this.zone();
        // An event in its own zone shows on that zone's clock; a floating or UTC one on the user's.
        const own = record.allDay ? null : (record.start.tz ?? null);
        const tz = own === 'UTC' ? null : own;
        const self = this.selfOf(record, account);
        const out = {
            id: o.recurrenceId ? `${eventId}.${compactTime(o.recurrenceId)}` : eventId,
            eventId,
            calendarId: calendar.id,
            calendar: this.calendarName(calendar),
            color: this.calendarColor(calendar),
            title: record.title || '(No title)',
            start: o.start,
            end: o.end,
            allDay: o.allDay,
        };
        if (o.allDay) {
            out.startDay = o.startDay;
            out.lastDay = addDays(o.endDay, -1);
        } else {
            out.timeZone = tz ?? zone;
            out.startLocal = toLocal(o.start, tz ?? zone).slice(0, 16);
            out.endLocal = toLocal(o.end, tz ?? zone).slice(0, 16);
        }
        for (const key of ['location', 'description', 'url', 'conference', 'privacy', 'organizer', 'categories']) {
            if (record[key] !== undefined) out[key] = record[key];
        }
        if (record.attendees?.length) out.attendees = record.attendees.map((p) => ({ ...p, ...(p === self ? { self: true } : {}) }));
        if (record.alarms?.length) out.alarms = record.alarms;
        out.status = record.status ?? 'confirmed';
        out.busy = record.busy !== false;
        if (repeats) {
            out.recurring = true;
            // What a change to one occurrence can reach: Google and CalDAV split a series; Microsoft's can't be.
            out.scopes = calendar.mode === 'instances' ? ['one', 'all'] : ['one', 'following', 'all'];
            const rule = series?.rrule;
            if (rule) {
                out.repeat = rule;
                out.repeats = describeRule(rule, untilWords(rule, tz ?? zone));
            } else {
                out.repeats = 'Repeats';
            }
            if (series !== undefined && record !== series) out.changed = true;
        }
        if (self) out.myStatus = self.status ?? 'needs-action';
        out.readOnly = calendar.readOnly === true;
        if (self && !(record.organizer && this.selfEmails(account).has(String(record.organizer.email).toLowerCase()))) out.canRespond = !out.readOnly;
        return out;
    }

    /** The occurrences in [from, to) as views. */
    events({ from, to, calendars, limit = 3000 }) {
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new CalendarError('Give a start and an end, the end after the start.');
        if (to - from > 3 * 366 * DAY) throw new CalendarError('Ask for at most three years at a time.');
        const found = this.find({ from, to, calendars });
        return { occurrences: found.slice(0, limit).map((f) => this.view(f)), more: found.length > limit };
    }

    /**
     * Events whose text has every word of `text` (title, place, notes,
     * people), between from and to (default: a year back to a year ahead),
     * upcoming ones first.
     */
    search({ text, from, to, calendars, limit = 50 }) {
        const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length === 0) throw new CalendarError('Say what to look for.');
        const now = this.now();
        const start = Number.isFinite(from) ? from : now - 366 * DAY;
        const end = Number.isFinite(to) ? to : now + 366 * DAY;
        const hits = this.find({ from: start, to: end, calendars }).filter(({ o, calendar }) => {
            const r = o.record;
            const hay = [r.title, r.location, r.description, this.calendarName(calendar), ...(r.attendees ?? []).flatMap((p) => [p.name, p.email]), r.organizer?.name, r.organizer?.email]
                .filter(Boolean).join('\n').toLowerCase();
            return words.every((w) => hay.includes(w));
        });
        const upcoming = hits.filter(({ o }) => o.end >= now);
        const past = hits.filter(({ o }) => o.end < now).reverse();
        const ordered = [...upcoming, ...past];
        return { occurrences: ordered.slice(0, limit).map((f) => this.view(f)), more: ordered.length > limit };
    }

    /** One occurrence by id. */
    event(id) {
        const at = this.locate(id);
        const zone = this.zone();
        const from = at.originalStart - DAY * 2;
        const to = at.originalStart + DAY * 2 + Math.max(0, at.length);
        const found = this.find({ from, to, calendars: [at.calendar.id] })
            .filter(({ o }) => o.record.uid === at.uid
                && (at.recurrenceId ? o.recurrenceId && sameTime(o.recurrenceId, at.recurrenceId) : true));
        if (found.length === 0) {
            // A changed occurrence moved far, or an occurrence taken out: show the record as it stands.
            const record = at.override ?? at.master;
            if (!record) throw new CalendarError(`There is no event "${id}" any more.`);
            const start = instantOf(record.start, zone);
            const view = this.view({ o: { record, series: at.master && at.master.rrule ? at.master : undefined, recurrenceId: at.recurrenceId, start, end: instantOf(record.end, zone), allDay: record.allDay, startDay: record.start.date, endDay: record.end.date }, calendar: at.calendar, item: at.overrideItem ?? at.item });
            return view;
        }
        return this.view(found[0]);
    }

    /**
     * Busy times in [from, to): merged spans when the user is taken (events
     * that show as busy, not declined, not cancelled), and the free gaps.
     */
    busy({ from, to, calendars }) {
        const spans = [];
        for (const f of this.find({ from, to, calendars })) {
            const { o, calendar } = f;
            if (o.record.busy === false || o.record.status === 'cancelled') continue;
            const self = this.selfOf(o.record, this.store.accounts[calendar.accountId]);
            if (self?.status === 'declined') continue;
            spans.push([Math.max(o.start, from), Math.min(o.end, to)]);
        }
        spans.sort((a, b) => a[0] - b[0]);
        const merged = [];
        for (const s of spans) {
            const last = merged[merged.length - 1];
            if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
            else merged.push([...s]);
        }
        const free = [];
        let cursor = from;
        for (const [s, e] of merged) {
            if (s > cursor) free.push([cursor, s]);
            cursor = Math.max(cursor, e);
        }
        if (cursor < to) free.push([cursor, to]);
        return { busy: merged.map(([s, e]) => ({ start: s, end: e })), free: free.map(([s, e]) => ({ start: s, end: e })) };
    }

    /**
     * Free slots of at least `minutes` in [from, to), within the hours of the
     * day given (wall clock in the user's zone), on the weekdays given.
     */
    freeSlots({ from, to, minutes = 30, dayStart = '09:00', dayEnd = '17:00', days = [1, 2, 3, 4, 5], calendars, limit = 20 }) {
        const zone = this.zone();
        const { busy } = this.busy({ from, to, calendars });
        const need = Math.max(5, Number(minutes) || 30) * MINUTE;
        const slots = [];
        for (let day = dayIn(from, zone); slots.length < limit; day = addDays(day, 1)) {
            const dayMs = toInstant(`${day}T00:00:00`, zone, zone);
            if (dayMs >= to) break;
            const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
            if (Array.isArray(days) && days.length > 0 && !days.includes(weekday)) continue;
            let s = Math.max(from, toInstant(`${day}T${hhmm(dayStart)}:00`, zone, zone));
            const e = Math.min(to, toInstant(`${day}T${hhmm(dayEnd)}:00`, zone, zone));
            for (const b of busy) {
                if (b.end <= s || b.start >= e) continue;
                if (b.start - s >= need) slots.push({ start: s, end: b.start });
                s = Math.max(s, b.end);
            }
            if (e - s >= need) slots.push({ start: s, end: e });
        }
        return { slots: slots.slice(0, limit), zone };
    }

    // ── Finding what a change is about ─────────────────────────────────

    /**
     * Where an occurrence id points: its calendar, item, records, and for an
     * occurrence of a series which one (its original start).
     */
    locate(id) {
        const text = String(id ?? '').trim();
        const dot = text.indexOf('.');
        const eventId = dot < 0 ? text : text.slice(0, dot);
        const part = dot < 0 ? '' : text.slice(dot + 1);
        const ref = this.index().get(eventId);
        if (ref === undefined) throw new CalendarError(`There is no event "${text}". Look it up again: ids come from calendar_events and calendar_search.`);
        const calendar = this.calendar(ref.calendarId);
        const records = [];
        const itemOf = new Map();
        for (const item of Object.values(this.store.itemsOf(calendar.id))) {
            for (const record of item.events ?? []) {
                if (record.uid !== ref.uid) continue;
                records.push(record);
                itemOf.set(record, item);
            }
        }
        if (records.length === 0) throw new CalendarError(`There is no event "${text}" any more.`);
        const master = records.find((r) => r.recurrenceId === undefined);
        let override;
        let recurrenceId;
        if (part !== '') {
            override = records.find((r) => r.recurrenceId && compactTime(r.recurrenceId) === part);
            recurrenceId = override?.recurrenceId ?? timeOfCompact(part, (master ?? records[0])?.start?.tz);
            if (recurrenceId === undefined) throw new CalendarError(`"${text}" isn't an event id.`);
            override ??= records.find((r) => r.recurrenceId && sameTime(r.recurrenceId, recurrenceId));
        } else if (master === undefined) {
            // Instances mode: the item is one occurrence.
            override = records[0];
            recurrenceId = override?.recurrenceId;
        }
        const zone = this.zone();
        const base = override ?? master;
        if (base === undefined) throw new CalendarError(`There is no event "${text}" any more.`);
        const originalStart = recurrenceId ? startOfTime(recurrenceId, zone) : startOfTime(base.start, zone);
        const length = master ? spanLength(master, zone) : spanLength(base, zone);
        return {
            id: text, eventId, calendar, account: this.store.accounts[calendar.accountId], uid: ref.uid, records, master, override,
            // The item a series lives in (CalDAV keeps its changed occurrences there too), and the changed occurrence's own.
            item: itemOf.get(master ?? base), overrideItem: override ? itemOf.get(override) : undefined, itemOf,
            recurrenceId, originalStart, length,
            series: master !== undefined && (master.rrule !== undefined || master.rdates?.length > 0),
            instance: master === undefined && base.seriesRemoteId !== undefined,
        };
    }

    writable(calendar) {
        if (calendar.readOnly) throw new CalendarError(`"${this.calendarName(calendar)}" is read only${this.store.accounts[calendar.accountId]?.kind === 'ics' ? ' (a subscription)' : ''}; change it where it's published.`);
        const account = this.store.accounts[calendar.accountId];
        if (account?.error?.code === 'auth') throw new CalendarError(`The ${account.name} account needs signing in again first (Calendar page → Accounts).`);
    }

    // ── Changing ───────────────────────────────────────────────────────

    /**
     * A record from what the window or a tool gives (see INPUT_FIELDS),
     * over `base` when changing one.
     */
    recordFrom(input, base) {
        const zone = this.zone();
        const record = base ? structuredClone(base) : { title: '' };
        const has = (key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
        if (has('title')) record.title = String(input.title ?? '').trim();
        for (const key of ['location', 'description', 'url', 'conference']) {
            if (has(key)) {
                const value = input[key] === null ? '' : String(input[key]).trim();
                if (value === '') delete record[key];
                else record[key] = value;
            }
        }
        if (has('url') && record.url && !/^https?:\/\//i.test(record.url)) throw new CalendarError('A link starts with https:// or http://.');
        if (has('busy')) record.busy = input.busy !== false;
        if (has('privacy')) {
            if (input.privacy === null || input.privacy === 'public' || input.privacy === '') delete record.privacy;
            else if (input.privacy === 'private' || input.privacy === 'confidential') record.privacy = input.privacy;
            else throw new CalendarError('privacy is public, private or confidential.');
        }
        if (has('status')) {
            if (!['confirmed', 'tentative', 'cancelled'].includes(input.status)) throw new CalendarError('status is confirmed, tentative or cancelled.');
            record.status = input.status;
        }
        if (has('alarms')) {
            const list = input.alarms === null ? [] : Array.isArray(input.alarms) ? input.alarms : [input.alarms];
            const minutes = [...new Set(list.map(Number))];
            if (minutes.some((m) => !Number.isInteger(m) || m < 0 || m > 40320)) throw new CalendarError('Reminders are whole minutes before the start, 0 to 40320 (four weeks).');
            if (minutes.length > 0) record.alarms = minutes.sort((a, b) => a - b);
            else delete record.alarms;
        }
        if (has('attendees')) {
            const list = input.attendees === null ? [] : input.attendees;
            if (!Array.isArray(list)) throw new CalendarError('attendees is a list of people: [{email, name?}].');
            const had = new Map((base?.attendees ?? []).map((p) => [String(p.email).toLowerCase(), p]));
            const people = [];
            for (const p of list) {
                const email = String(typeof p === 'string' ? p : p?.email ?? '').trim();
                if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CalendarError(`"${email}" isn't an email address.`);
                const old = had.get(email.toLowerCase());
                const person = { ...old, email };
                if (typeof p === 'object' && typeof p.name === 'string' && p.name.trim()) person.name = p.name.trim();
                if (typeof p === 'object' && p.optional === true) person.role = 'optional';
                else if (typeof p === 'object' && p.optional === false) person.role = 'required';
                person.status ??= 'needs-action';
                person.role ??= 'required';
                people.push(person);
            }
            if (people.length > 0) record.attendees = people;
            else delete record.attendees;
        }
        if (has('repeat')) {
            const rule = input.repeat === null ? '' : String(input.repeat).trim().replace(/^RRULE:/i, '');
            if (rule === '') {
                delete record.rrule;
                delete record.rdates;
                delete record.exdates;
            } else {
                try {
                    parseRule(rule);
                } catch (error) {
                    throw new CalendarError(`The repeat rule can't be read: ${error.message}. Write it like FREQ=WEEKLY;BYDAY=MO,WE or FREQ=MONTHLY;BYMONTHDAY=1;COUNT=6.`);
                }
                record.rrule = rule.toUpperCase();
            }
        }
        // Times: given start and end, a start alone (the length stays), an end alone, or allDay switched.
        const allDay = has('allDay') ? input.allDay === true : has('start') ? isDay(String(input.start).trim()) : (record.allDay === true);
        const tzIn = has('timeZone') && input.timeZone ? String(input.timeZone).trim() : undefined;
        if (tzIn !== undefined && !isZone(tzIn) && tzIn !== 'UTC') throw new CalendarError(`"${tzIn}" isn't a time zone; use an IANA name like Europe/Berlin or America/New_York.`);
        // Wall clocks are read as the event shows them: in its own zone, or the user's for a floating or UTC event.
        const oldTz = record.start && !('date' in record.start) && record.start.tz !== 'UTC' ? record.start.tz : undefined;
        const tz = tzIn ?? oldTz ?? zone;
        if (has('start') || has('end') || has('allDay') || has('timeZone') || base === undefined) {
            const oldLength = base ? spanLength(base, zone) : allDay ? DAY : HOUR;
            let start;
            if (has('start')) start = timeFrom(input.start, allDay, tz, 'start');
            else if (base) start = convertTime(record.start, allDay, tz, zone);
            else throw new CalendarError('Give the start: a day (2026-10-12) or a time (2026-10-12T09:30).');
            let end;
            if (has('end') && input.end !== null && input.end !== '') {
                end = timeFrom(input.end, allDay, tz, 'end');
                if (allDay) end = { date: addDays(end.date, 1) };
            } else if (allDay) {
                const days = base && record.allDay && has('start') ? Math.max(1, Math.round(oldLength / DAY)) : base && record.allDay ? daysBetween(record.start.date, record.end.date) : 1;
                end = { date: addDays(start.date, Math.max(1, days)) };
            } else {
                const length = base && !record.allDay ? oldLength : HOUR;
                const startMs = toInstant(start.local, start.tz, zone);
                end = { local: toLocal(startMs + length, start.tz), tz: start.tz };
            }
            if (allDay) {
                if (end.date <= start.date) throw new CalendarError('The last day is before the first.');
            } else if (toInstant(end.local, end.tz, zone) < toInstant(start.local, start.tz, zone)) {
                throw new CalendarError('The end is before the start.');
            }
            record.start = start;
            record.end = end;
            record.allDay = allDay;
        }
        if (!record.title) throw new CalendarError('Give the event a title.');
        return cleanRecord(record);
    }

    /** Run a change; when the server says the event changed meanwhile, sync and try once more. */
    async changing(calendarId, run) {
        return this.locked(`sync:${calendarId}`, async () => {
            try {
                return await run();
            } catch (error) {
                if (!(error instanceof SourceError) || error.code !== 'conflict') throw asCalendarError(error);
            }
            this.log(`conflict ${calendarId} retry`);
            return CONFLICT;
        }).then(async (result) => {
            if (result !== CONFLICT) return result;
            await this.syncCalendar(calendarId);
            return this.locked(`sync:${calendarId}`, async () => {
                try {
                    return await run();
                } catch (error) {
                    throw asCalendarError(error);
                }
            });
        });
    }

    /** Write a CalDAV or local item's new text (null: no event left in it). */
    async putIcs(calendar, item, edits, uid) {
        const { source } = await this.source(this.store.accounts[calendar.accountId]);
        const raw = editIcs(item?.raw ?? null, edits, { now: this.now(), zone: this.zone() });
        const items = this.store.itemsOf(calendar.id);
        let made;
        if (raw === null) {
            await source.remove({ ...calendar }, item);
            delete items[item.remoteId];
        } else {
            const put = await source.put({ ...calendar }, item ?? null, raw, uid);
            if (item && item.remoteId !== put.remoteId) delete items[item.remoteId];
            made = { remoteId: put.remoteId, ...(put.etag !== undefined ? { etag: put.etag } : {}), raw, events: readIcs(raw, { zone: this.zone() }).events };
            items[put.remoteId] = made;
        }
        this.store.touch(calendar.id);
        this.changed();
        return made;
    }

    /** Items a Google or Microsoft change sent back, into the store; a sync soon after fills in the rest. */
    takeItems(calendar, items = [], removed = []) {
        const store = this.store.itemsOf(calendar.id);
        for (const item of items) store[item.remoteId] = { remoteId: item.remoteId, ...(item.etag !== undefined ? { etag: item.etag } : {}), events: (item.events ?? []).map(cleanRecord) };
        for (const remoteId of removed) delete store[remoteId];
        this.store.touch(calendar.id);
        this.changed();
        this.later(() => this.syncCalendar(calendar.id), 1500);
    }

    /**
     * A new event.
     * @param {object} input - calendarId (default: the default calendar), and INPUT_FIELDS.
     * @param {string} by - who asked, for the log: 'window' or 'agent'.
     */
    async createEvent(input, by = 'window') {
        const calendarId = input.calendarId || this.defaultCalendarId();
        if (!calendarId) throw new CalendarError('There is no calendar that can be written.');
        const calendar = this.calendar(calendarId);
        this.writable(calendar);
        const record = this.recordFrom(input);
        record.uid = newUid();
        const created = await this.changing(calendar.id, async () => {
            const { source, style } = await this.source(this.store.accounts[calendar.accountId]);
            if (style === 'ics') {
                const item = await this.putIcs(calendar, null, [{ uid: record.uid, record }], record.uid);
                return { remoteId: item.remoteId, uid: record.uid };
            }
            const items = await source.create({ ...calendar }, { ...record, ...(input.notify === true ? { notify: true } : {}) });
            this.takeItems(calendar, items);
            const first = items?.[0];
            return { remoteId: first?.remoteId, uid: first?.events?.[0]?.uid ?? record.uid };
        });
        this.log(`create ${calendar.id} by=${by}${record.rrule ? ' repeats' : ''}${record.attendees ? ` people=${record.attendees.length}` : ''}`);
        const eventId = eventIdOf(calendar.id, created.uid);
        const zone = this.zone();
        const startMs = startOfTime(record.start, zone);
        const first = this.find({ from: startMs - DAY, to: startMs + 2 * DAY + spanLength(record, zone), calendars: [calendar.id] })
            .find(({ o }) => o.record.uid === created.uid);
        return first ? this.view(first) : { id: eventId, eventId, calendarId: calendar.id, title: record.title };
    }

    /**
     * Change an event. scope: 'one' (this occurrence of a series), 'following'
     * (this one and the ones after it), 'all' (the series, or a single event).
     */
    async updateEvent(id, patch = {}, scope = 'all', by = 'window') {
        const first = this.locate(id);
        this.writable(first.calendar);
        if (patch.calendarId && patch.calendarId !== first.calendar.id) return this.moveEvent(id, patch.calendarId, by, { notify: patch.notify === true });
        const which = this.scopeOf(first, scope);
        // Google and Microsoft tell guests about a change only when asked (the tools' notify_guests).
        const tell = patch.notify === true ? { notify: true } : {};
        let after;
        await this.changing(first.calendar.id, async () => {
            const at = this.locate(id);
            const { source, style } = await this.source(at.account);
            const calendar = at.calendar;
            if (which === 'one') {
                const current = this.occurrenceRecord(at);
                const changed = this.recordFrom(patch, current);
                changed.uid = at.uid;
                changed.recurrenceId = at.recurrenceId ?? current.recurrenceId;
                delete changed.rrule;
                delete changed.rdates;
                delete changed.exdates;
                if (style === 'ics') {
                    await this.putIcs(calendar, at.item, [{ uid: at.uid, recurrenceId: changed.recurrenceId, record: { ...changed, sequence: (current.sequence ?? 0) + 1 } }], at.uid);
                } else {
                    this.takeItems(calendar, await source.update({ ...calendar }, { item: at.overrideItem ?? at.item, record: at.override ?? at.master, occurrence: at.recurrenceId }, { ...diffOf(current, changed), ...tell }, 'one'));
                }
                return;
            }
            if (which === 'following') {
                after = await this.splitSeries(at, source, style, patch);
                return;
            }
            // The whole series, or a single event: the change moves it by as much as this occurrence moved.
            const master = at.master ?? at.override;
            const changed = this.recordFrom(this.shiftedPatch(at, patch), master);
            const zone = this.zone();
            const delta = at.series && at.master && changed.allDay === (at.master.allDay === true)
                ? startOfTime(changed.start, zone) - startOfTime(at.master.start, zone) : 0;
            const moveTime = (time) => {
                if ('date' in time) return { date: addDays(time.date, Math.round(delta / DAY)) };
                return { local: toLocal(instantOf(time, zone) + delta, time.tz ?? zone), tz: time.tz ?? null };
            };
            const ownRule = Object.prototype.hasOwnProperty.call(patch, 'repeat');
            if (delta !== 0 && !ownRule) {
                // Taken-out dates move with the series, and a weekly rule's days with its start.
                if (at.master.exdates?.length) changed.exdates = at.master.exdates.map(moveTime);
                if (changed.rrule) changed.rrule = shiftRuleDays(changed.rrule, at.master.start, changed.start);
            }
            changed.uid = at.uid;
            changed.sequence = (master.sequence ?? 0) + 1;
            if (style === 'ics') {
                const edits = [{ uid: at.uid, record: changed }];
                if (delta !== 0 && !ownRule) {
                    // Changed occurrences keep naming the occurrence they stand in for.
                    for (const r of at.records.filter((x) => x.recurrenceId)) {
                        edits.push({ uid: at.uid, recurrenceId: r.recurrenceId, record: { ...r, recurrenceId: moveTime(r.recurrenceId) } });
                    }
                }
                await this.putIcs(calendar, at.item, edits, at.uid);
            } else {
                this.takeItems(calendar, await source.update({ ...calendar }, { item: at.item, record: master }, { ...diffOf(master, changed), ...tell }, 'all'));
            }
            // The occurrence that was asked about, where it is now.
            after = { uid: at.uid, near: at.series ? at.originalStart + delta : startOfTime(changed.start, zone) };
        });
        this.log(`update ${first.calendar.id} ${first.eventId} scope=${which} by=${by}`);
        try {
            if (which === 'one' || after === undefined) return this.event(which === 'one' ? id : first.eventId);
            return this.viewNear(first.calendar.id, after.uid, after.near) ?? this.event(eventIdOf(first.calendar.id, after.uid));
        } catch {
            return { id };
        }
    }

    /** The view of an event's occurrence nearest a time (within a day): what a change made. */
    viewNear(calendarId, uid, near) {
        const found = this.find({ from: near - DAY, to: near + 2 * DAY, calendars: [calendarId] }).filter(({ o }) => o.record.uid === uid);
        if (found.length === 0) return undefined;
        found.sort((a, b) => Math.abs(a.o.start - near) - Math.abs(b.o.start - near));
        return this.view(found[0]);
    }

    /** The scope a change really has: a single event's is 'all'. */
    scopeOf(at, scope) {
        const s = scope ?? 'all';
        if (!['one', 'following', 'all'].includes(s)) throw new CalendarError('scope is one, following or all.');
        if (!at.series && !at.instance) return 'all';
        if (at.instance && s === 'following') throw new CalendarError('This account can change one occurrence or the whole series, not this and the following ones.');
        if (s !== 'all' && !at.recurrenceId) throw new CalendarError('Give the id of the occurrence (with its date part) to change only it.');
        return s;
    }

    /** The record an occurrence of a series stands for: its changed record, or the series' at that start. */
    occurrenceRecord(at) {
        if (at.override) return at.override;
        const master = at.master;
        const zone = this.zone();
        const record = structuredClone(master);
        delete record.rrule;
        delete record.rdates;
        delete record.exdates;
        if ('date' in at.recurrenceId) {
            record.start = { date: at.recurrenceId.date };
            record.end = { date: addDays(at.recurrenceId.date, daysBetween(master.start.date, master.end.date)) };
        } else {
            const startMs = instantOf(at.recurrenceId, zone);
            const tz = master.start.tz ?? null;
            record.start = { local: toLocal(startMs, tz ?? zone), tz };
            record.end = { local: toLocal(startMs + spanLength(master, zone), tz ?? zone), tz };
        }
        record.recurrenceId = at.recurrenceId;
        return record;
    }

    /**
     * A change to a whole series given on one of its occurrences: its start
     * and end, if given, move the series' own start and end by as much.
     */
    shiftedPatch(at, patch) {
        if (!at.series || !at.recurrenceId || (patch.start === undefined && patch.end === undefined)) return patch;
        const zone = this.zone();
        const current = this.occurrenceRecord(at);
        const moved = this.recordFrom({ start: patch.start, end: patch.end, allDay: patch.allDay, timeZone: patch.timeZone }, current);
        const master = at.master;
        if (moved.allDay !== (master.allDay === true)) return { ...patch, start: moved.allDay ? moved.start.date : moved.start.local, end: moved.allDay ? addDays(moved.end.date, -1) : moved.end.local };
        const delta = startOfTime(moved.start, zone) - startOfTime(current.start, zone);
        const length = spanLength(moved, zone);
        if (moved.allDay) {
            const days = Math.round(delta / DAY);
            return { ...patch, start: addDays(master.start.date, days), end: addDays(addDays(master.start.date, days), Math.max(1, Math.round(length / DAY)) - 1) };
        }
        const tz = moved.start.tz ?? master.start.tz;
        const startMs = startOfTime(master.start, zone) + delta;
        return { ...patch, timeZone: tz ?? undefined, start: toLocal(startMs, tz ?? zone), end: toLocal(startMs + length, tz ?? zone) };
    }

    /** "This and following": the series ends before this occurrence; a new one starts here with the change. */
    async splitSeries(at, source, style, patch) {
        const master = at.master;
        const zone = this.zone();
        if (master?.rrule === undefined) throw new CalendarError('Only a repeating series can be changed from one occurrence on.');
        const rule = parseRule(master.rrule);
        const splitAt = at.originalStart;
        const firstStart = startOfTime(master.start, zone);
        if (splitAt <= firstStart) {
            // From the first occurrence on is the whole series.
            return this.updateWhole(at, source, style, patch);
        }
        const tell = patch.notify === true ? { notify: true } : {};
        const before = { ...rule };
        let after = { ...rule };
        if (rule.count !== undefined) {
            const done = countBefore(master, rule, splitAt, zone);
            before.count = done;
            after.count = Math.max(1, rule.count - done);
        } else {
            before.until = untilBefore(at.recurrenceId, master, zone);
            delete before.count;
        }
        const older = structuredClone(master);
        older.rrule = ruleText(before);
        older.exdates = (master.exdates ?? []).filter((t) => startOfTime(t, zone) < splitAt);
        older.rdates = (master.rdates ?? []).filter((t) => startOfTime(t, zone) < splitAt);
        older.sequence = (master.sequence ?? 0) + 1;
        const current = this.occurrenceRecord(at);
        const base = structuredClone(master);
        base.start = current.start;
        base.end = current.end;
        base.rrule = ruleText(after);
        base.exdates = (master.exdates ?? []).filter((t) => startOfTime(t, zone) >= splitAt);
        base.rdates = (master.rdates ?? []).filter((t) => startOfTime(t, zone) >= splitAt);
        delete base.recurrenceId;
        delete base.remoteId;
        delete base.sequence;
        const newer = this.recordFrom(patch, cleanRecord(base));
        newer.uid = newUid();
        if (newer.rrule && rule.byDay && !patch.repeat && newer.start.local?.slice(0, 10) !== current.start.local?.slice(0, 10)) {
            newer.rrule = shiftRuleDays(newer.rrule, current.start, newer.start);
        }
        const later = at.records.filter((r) => r.recurrenceId && startOfTime(r.recurrenceId, zone) >= splitAt);
        const near = startOfTime(newer.start, zone);
        if (style === 'ics') {
            const edits = [{ uid: at.uid, record: older }, ...later.map((r) => ({ uid: at.uid, recurrenceId: r.recurrenceId, record: null }))];
            await this.putIcs(at.calendar, at.item, edits, at.uid);
            await this.putIcs(at.calendar, null, [{ uid: newer.uid, record: newer }], newer.uid);
            return { uid: newer.uid, near };
        }
        this.takeItems(at.calendar, await source.update({ ...at.calendar }, { item: at.item, record: master }, { rrule: older.rrule, ...tell }, 'all'));
        const made = await source.create({ ...at.calendar }, { ...newer, ...tell });
        this.takeItems(at.calendar, made);
        // Google and Microsoft give the new series their own uid.
        return { uid: made?.find((i) => i.events?.length)?.events[0].uid ?? newer.uid, near };
    }

    async updateWhole(at, source, style, patch) {
        const master = at.master;
        const zone = this.zone();
        const changed = this.recordFrom(this.shiftedPatch(at, patch), master);
        changed.uid = at.uid;
        changed.sequence = (master.sequence ?? 0) + 1;
        if (style === 'ics') await this.putIcs(at.calendar, at.item, [{ uid: at.uid, record: changed }], at.uid);
        else this.takeItems(at.calendar, await source.update({ ...at.calendar }, { item: at.item, record: master }, { ...diffOf(master, changed), ...(patch.notify === true ? { notify: true } : {}) }, 'all'));
        return { uid: at.uid, near: startOfTime(changed.start, zone) };
    }

    /** Move an event to another calendar: made there, then taken out here. */
    async moveEvent(id, calendarId, by = 'window', { notify = false } = {}) {
        const at = this.locate(id);
        const target = this.calendar(calendarId);
        this.writable(target);
        this.writable(at.calendar);
        if (at.instance || (at.recurrenceId && !at.series)) throw new CalendarError('Move the whole series, from its own event.');
        const zone = this.zone();
        const records = at.records;
        const { source: to, style: toStyle } = await this.source(this.store.accounts[target.accountId]);
        const uid = at.uid;
        if (toStyle === 'ics') {
            await this.changing(target.id, () => this.putIcs(target, null, records.map((r) => ({ uid, recurrenceId: r.recurrenceId, record: r })), uid));
        } else {
            // A new event there: its guests are invited only when asked (Microsoft would email them all).
            const master = structuredClone(at.master ?? records[0]);
            if (notify) master.notify = true;
            else delete master.attendees;
            await this.changing(target.id, async () => this.takeItems(target, await to.create({ ...target }, master)));
        }
        await this.deleteEvent(at.master ? at.eventId : id, 'all', by);
        this.log(`move ${at.calendar.id} ${target.id} by=${by}`);
        const startMs = startOfTime((at.master ?? records[0]).start, zone);
        const found = this.find({ from: startMs - DAY, to: startMs + 2 * DAY, calendars: [target.id] }).find(({ o }) => o.record.uid === uid);
        return found ? this.view(found) : { id };
    }

    /** Delete an event, one occurrence, or this and the following ones. opts.notify: Google tells the guests. */
    async deleteEvent(id, scope = 'all', by = 'window', { notify = false } = {}) {
        const tell = notify ? { notify: true } : {};
        const first = this.locate(id);
        this.writable(first.calendar);
        const which = this.scopeOf(first, scope);
        await this.changing(first.calendar.id, async () => {
            const at = this.locate(id);
            const { source, style } = await this.source(at.account);
            const calendar = at.calendar;
            const zone = this.zone();
            if (which === 'all') {
                if (style === 'ics') {
                    await this.putIcs(calendar, at.item, at.records.map((r) => ({ uid: at.uid, recurrenceId: r.recurrenceId, record: null })), at.uid);
                } else {
                    const out = await source.remove({ ...calendar }, { item: at.item, record: at.master ?? at.override, occurrence: at.recurrenceId, ...tell }, 'all');
                    this.takeItems(calendar, out?.items, out?.removed ?? [at.item.remoteId]);
                }
                return;
            }
            if (which === 'one') {
                if (style === 'ics') {
                    if (!at.master) {
                        await this.putIcs(calendar, at.overrideItem ?? at.item, [{ uid: at.uid, recurrenceId: at.recurrenceId, record: null }], at.uid);
                        return;
                    }
                    const master = structuredClone(at.master);
                    master.exdates = [...(master.exdates ?? []), at.recurrenceId];
                    master.sequence = (master.sequence ?? 0) + 1;
                    const edits = [{ uid: at.uid, record: master }];
                    if (at.override) edits.push({ uid: at.uid, recurrenceId: at.override.recurrenceId, record: null });
                    await this.putIcs(calendar, at.item, edits, at.uid);
                } else {
                    const out = await source.remove({ ...calendar }, { item: at.overrideItem ?? at.item, record: at.override ?? at.master, occurrence: at.recurrenceId, ...tell }, 'one');
                    this.takeItems(calendar, out?.items, out?.removed);
                }
                return;
            }
            // This and the following ones: the series ends before this one.
            const master = at.master;
            const rule = parseRule(master.rrule);
            if (at.originalStart <= startOfTime(master.start, zone)) {
                if (style === 'ics') await this.putIcs(calendar, at.item, at.records.map((r) => ({ uid: at.uid, recurrenceId: r.recurrenceId, record: null })), at.uid);
                else {
                    const out = await source.remove({ ...calendar }, { item: at.item, record: master, ...tell }, 'all');
                    this.takeItems(calendar, out?.items, out?.removed ?? [at.item.remoteId]);
                }
                return;
            }
            const before = { ...rule };
            if (rule.count !== undefined) before.count = countBefore(master, rule, at.originalStart, zone);
            else before.until = untilBefore(at.recurrenceId, master, zone);
            const older = structuredClone(master);
            older.rrule = ruleText(before);
            older.sequence = (master.sequence ?? 0) + 1;
            if (style === 'ics') {
                const later = at.records.filter((r) => r.recurrenceId && startOfTime(r.recurrenceId, zone) >= at.originalStart);
                await this.putIcs(calendar, at.item, [{ uid: at.uid, record: older }, ...later.map((r) => ({ uid: at.uid, recurrenceId: r.recurrenceId, record: null }))], at.uid);
            } else {
                this.takeItems(calendar, await source.update({ ...calendar }, { item: at.item, record: master }, { rrule: older.rrule, ...tell }, 'all'));
            }
        });
        this.log(`delete ${first.calendar.id} ${first.eventId} scope=${which} by=${by}`);
    }

    /** Answer an invitation: accepted, declined or tentative. */
    async respond(id, status, scope = 'all', by = 'window') {
        if (!['accepted', 'declined', 'tentative'].includes(status)) throw new CalendarError('The answer is accepted, declined or tentative.');
        const first = this.locate(id);
        this.writable(first.calendar);
        const which = this.scopeOf(first, scope === 'following' ? 'all' : scope);
        await this.changing(first.calendar.id, async () => {
            const at = this.locate(id);
            const { source, style } = await this.source(at.account);
            const base = which === 'one' ? this.occurrenceRecord(at) : (at.master ?? at.override);
            const self = this.selfOf(base, at.account);
            if (!self) throw new CalendarError('You aren\'t on this event\'s guest list, so there is nothing to answer.');
            if (style === 'ics') {
                const record = structuredClone(base);
                record.attendees = record.attendees.map((p) => (String(p.email).toLowerCase() === String(self.email).toLowerCase() ? { ...p, status } : p));
                await this.putIcs(at.calendar, at.item, [{ uid: at.uid, ...(which === 'one' ? { recurrenceId: at.recurrenceId } : {}), record }], at.uid);
            } else if (typeof source.respond === 'function') {
                this.takeItems(at.calendar, await source.respond({ ...at.calendar }, { item: which === 'one' ? (at.overrideItem ?? at.item) : at.item, record: which === 'one' ? (at.override ?? at.master) : (at.master ?? at.override), occurrence: which === 'one' ? at.recurrenceId : undefined }, status, which));
            } else {
                throw new CalendarError('This account can\'t answer invitations from here.');
            }
        });
        this.log(`respond ${first.calendar.id} ${first.eventId} ${status} by=${by}`);
        return this.event(id);
    }

    // ── Files ──────────────────────────────────────────────────────────

    /** A calendar as one iCalendar file. */
    exportCalendar(id) {
        const calendar = this.calendar(id);
        const records = Object.values(this.store.itemsOf(calendar.id)).flatMap((item) => item.events ?? []);
        const text = editIcs(null, records.map((r) => ({ uid: r.uid, recurrenceId: r.recurrenceId, record: r })), { now: this.now(), zone: this.zone() }) ?? editIcs(null, [], {});
        return { name: this.calendarName(calendar), ics: text ?? 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', events: records.length };
    }

    /** Events from an iCalendar file into a calendar that can be written; ones already there (same uid) are left. */
    async importIcs(calendarId, text) {
        const calendar = this.calendar(calendarId);
        this.writable(calendar);
        const { events } = readIcs(String(text ?? ''), { zone: this.zone() });
        if (events.length === 0) throw new CalendarError('The file has no events.');
        const have = new Set(Object.values(this.store.itemsOf(calendar.id)).flatMap((i) => (i.events ?? []).map((r) => r.uid)));
        const byUid = new Map();
        for (const r of events) {
            if (have.has(r.uid)) continue;
            const list = byUid.get(r.uid);
            if (list) list.push(r);
            else byUid.set(r.uid, [r]);
        }
        const { source, style } = await this.source(this.store.accounts[calendar.accountId]);
        let added = 0;
        for (const [uid, list] of byUid) {
            await this.changing(calendar.id, async () => {
                if (style === 'ics') await this.putIcs(calendar, null, list.map((r) => ({ uid, recurrenceId: r.recurrenceId, record: r })), uid);
                else {
                    // Imported events invite nobody: their guests stay out (Microsoft would email them all).
                    const master = structuredClone(list.find((r) => !r.recurrenceId) ?? list[0]);
                    delete master.attendees;
                    this.takeItems(calendar, await source.create({ ...calendar }, master));
                }
            });
            added++;
        }
        this.log(`import ${calendar.id} added=${added} skipped=${events.length - added}`);
        return { added, skipped: byUid.size === 0 ? events.length : events.length - [...byUid.values()].flat().length };
    }

    // ── For the window ─────────────────────────────────────────────────

    state() {
        return {
            version: this.version,
            zone: this.zone(),
            accounts: Object.values(this.store.accounts).map((a) => this.accountView(a)),
            calendars: this.calendarList(),
            defaultCalendar: this.defaultCalendarId() ?? null,
            prefs: {
                ...(this.store.prefs.weekStart !== undefined ? { weekStart: this.store.prefs.weekStart } : {}),
                ...(this.store.prefs.view ? { view: this.store.prefs.view } : {}),
            },
            syncing: this.syncing.size > 0,
        };
    }
}

// ── Helpers ────────────────────────────────────────────────────────────

const short = (error) => String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 160);

function asCalendarError(error) {
    if (error instanceof CalendarError) return error;
    if (error instanceof SourceError) return new CalendarError(error.message);
    if (error?.name === 'HttpError') return new CalendarError(error.message);
    return error instanceof Error ? error : new Error(String(error));
}

function safeAddress(url) {
    try {
        const u = new URL(String(url).replace(/^webcals?:\/\//i, 'https://'));
        return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
        return '';
    }
}

function validColor(color) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(color ?? '').trim());
    return m ? `#${m[1].toLowerCase()}` : undefined;
}

function hhmm(text) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim());
    if (!m || Number(m[1]) > 24 || Number(m[2]) > 59) throw new CalendarError('Hours of the day are like 09:00 and 17:30.');
    return Number(m[1]) === 24 ? '23:59' : `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** When a time starts, in epoch ms (a day: its midnight in the user's zone). */
function startOfTime(time, zone) {
    if ('date' in time) return toInstant(`${time.date}T00:00:00`, zone, zone);
    return instantOf(time, zone);
}

/** How long a record lasts, in ms. */
function spanLength(record, zone) {
    if (!record?.start || !record?.end) return 0;
    if ('date' in record.start) return daysBetween(record.start.date, record.end.date) * DAY;
    return Math.max(0, instantOf(record.end, zone) - instantOf(record.start, zone));
}

/**
 * A time from what a tool or the window gives: 'YYYY-MM-DD' for a day,
 * 'YYYY-MM-DDTHH:MM[:SS]' for a wall clock in the zone, or with Z or an
 * offset for an instant (kept as the zone's wall clock at that instant).
 */
function timeFrom(value, allDay, tz, what) {
    const text = String(value ?? '').trim();
    if (allDay) {
        const day = text.slice(0, 10);
        if (!isDay(day)) throw new CalendarError(`The ${what} day "${text}" isn't a date like 2026-10-12.`);
        return { date: day };
    }
    if (isDay(text)) throw new CalendarError(`The ${what} "${text}" is a day; give a time like ${text}T09:30, or make the event all-day.`);
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
    if (withZone) {
        const ms = Date.parse(text);
        if (!Number.isFinite(ms)) throw new CalendarError(`The ${what} "${text}" isn't a time.`);
        return { local: toLocal(ms, tz), tz };
    }
    const local = normalLocal(text);
    if (local === undefined || !isDay(local.slice(0, 10))) throw new CalendarError(`The ${what} "${text}" isn't a time like 2026-10-12T09:30.`);
    return { local, tz };
}

/** A record's time moved to all-day or timed, or to another zone, keeping the wall clock. */
function convertTime(time, allDay, tz, zone) {
    if (allDay) return { date: 'date' in time ? time.date : time.local.slice(0, 10) };
    if ('date' in time) return { local: `${time.date}T09:00:00`, tz };
    if ((time.tz ?? null) === (tz ?? null)) return time;
    return { local: time.local, tz };
}

/** The fields that differ between two records: a patch for Google and Microsoft. */
function diffOf(before, after) {
    const patch = {};
    for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
        if (key === 'uid' || key === 'remoteId' || key === 'sequence' || key === 'updated' || key === 'created') continue;
        if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) patch[key] = after?.[key] ?? null;
    }
    return patch;
}

/** How many occurrences a series has before an instant. */
function countBefore(master, rule, before, zone) {
    const allDay = 'date' in master.start;
    const tz = allDay ? zone : (master.start.tz ?? zone);
    const startWall = wallMs(allDay ? `${master.start.date}T00:00:00` : master.start.local);
    let n = 0;
    for (const wall of expandWall(rule, startWall, {})) {
        const at = toInstant(wallOf(wall), tz, zone);
        if (at >= before) break;
        n++;
        if (n > 100000) break;
    }
    return n;
}

/** UNTIL for a series that ends just before an occurrence. */
function untilBefore(recurrenceId, master, zone) {
    if ('date' in master.start) {
        const day = 'date' in recurrenceId ? recurrenceId.date : recurrenceId.local.slice(0, 10);
        return addDays(day, -1).replaceAll('-', '');
    }
    const at = instantOf(recurrenceId, zone) - 1000;
    if (master.start.tz === null || master.start.tz === undefined) return wallOf(wallMs(toLocal(at, zone))).replace(/[-:]/g, '');
    return `${new Date(at).toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** BYDAY of a weekly rule moved with its start, when the start moved to another weekday. */
function shiftRuleDays(rrule, from, to) {
    const rule = parseRule(rrule);
    if (!rule.byDay || rule.byDay.some((d) => d.n) || !from?.local || !to?.local) return rrule;
    const days = Math.round((Date.parse(`${to.local.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.local.slice(0, 10)}T00:00:00Z`)) / DAY);
    if (days === 0) return rrule;
    rule.byDay = rule.byDay.map(({ wd }) => ({ wd: (((wd + days) % 7) + 7) % 7, n: 0 }));
    return ruleText(rule);
}

/** UNTIL in words for describeRule, in the event's zone. */
function untilWords(rrule, zone) {
    try {
        const rule = parseRule(rrule);
        if (!rule.until) return undefined;
        const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(rule.until);
        if (!m) return undefined;
        const day = m[7] ? dayIn(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), zone) : `${m[1]}-${m[2]}-${m[3]}`;
        return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    } catch {
        return undefined;
    }
}

export { INPUT_FIELDS, WEEKDAYS };
