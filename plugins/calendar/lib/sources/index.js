/**
 * Where calendars come from. Each kind of account is a source module in
 * this folder; the manager (lib/manager.js) stores what they return,
 * expands recurring events, schedules syncs and routes changes to them.
 *
 * A source module exports:
 *
 *   kind   - the account kind it serves ('caldav', 'google', ...).
 *   style  - 'ics': it reads and writes iCalendar text (CalDAV, the local
 *            calendar, subscriptions); the manager edits the text, the
 *            source only stores and fetches it. 'events': it maps events
 *            to and from the server's own JSON (Google, Microsoft, EventKit).
 *   create(account, env) → a source for one account (below).
 *
 * `account` is what the plugin stores about an account, never a secret:
 *   {id, kind, name, url?, host?, username?, email?, preset?, allowHttp?}.
 *   A subscription has its host only: its address is its secret.
 *
 * `env` is what a source may use:
 *   request(url, init) - lib/http.js `request`, with the account's allowHttp
 *                        and the test fetch already applied. All network goes
 *                        through it.
 *   secret             - the account's secret in DSH's credential store:
 *                        `get()` → payload or undefined, `set(payload)`, `clear()`.
 *                        A password, an OAuth grant {refreshToken, accessToken,
 *                        expiresAt, scope}, or a subscription's address {url}
 *                        (a private feed's key is in its path). Never logged,
 *                        never returned.
 *   log(line)          - the plugin's log: ids and counts, never secrets,
 *                        event text or URLs with queries.
 *   now()              - epoch ms (tests move it).
 *   zone               - the user's zone (IANA id).
 *   settings           - the plugin's settings (OAuth client ids and the like).
 *
 * Every source has:
 *
 *   calendars() → [{remoteId, name, color?, readOnly?, timeZone?, description?,
 *                   mode?: 'masters' | 'instances'}]
 *       The account's calendars that hold events. 'instances': the source
 *       hands each occurrence of a series over on its own (see model.js).
 *
 *   sync(calendar, state, {from, to, signal}) → {reset, items, removed, state}
 *       What changed in one calendar since `state` (opaque JSON this source
 *       returned last time; undefined the first time). `reset` true: `items`
 *       is the whole calendar. Otherwise `items` are new or changed and
 *       `removed` the remote ids gone. `from`/`to` (epoch ms) bound the
 *       window a source that syncs a window (Microsoft's calendar view) keeps.
 *       `calendar` is {remoteId, ...what calendars() said}.
 *
 * An 'ics' source also has:
 *
 *   put(calendar, item | null, raw, uid) → {remoteId, etag}
 *       Store iCalendar text: a new resource (item null; it must not exist
 *       yet), or a changed one (only if its etag is still item.etag).
 *   remove(calendar, item) → undefined
 *       Delete a resource (only if its etag is still item.etag).
 *
 * An 'events' source also has:
 *
 *   create(calendar, record) → Item[]
 *   update(calendar, target, patch, scope) → Item[]
 *       target: {item, record, occurrence?}: the item and record changed, and
 *       for one occurrence of a series its original start (a Time). patch:
 *       the record fields to change. scope: 'all' (the series or a single
 *       event) or 'one' (that occurrence only).
 *   remove(calendar, target, scope) → {removed: string[], items: Item[]}
 *   respond(calendar, target, status, scope) → Item[]   (optional)
 *       Answer an invitation: 'accepted', 'declined' or 'tentative'.
 *
 * Errors: throw a SourceError with a code the manager acts on: 'auth'
 * (sign in again), 'conflict' (changed on the server meanwhile: the manager
 * syncs and tries once more), 'not-found', 'forbidden' (read-only),
 * 'rate' (with retryAfter in seconds), 'server', 'network', 'config'.
 * Messages are for the user: plain, without secrets. Agents get a fixed
 * category by the code instead (PROBLEMS), never a message.
 *
 * @module dsh-plugin-calendar/sources
 */

export class SourceError extends Error {
    /**
     * @param {'auth'|'conflict'|'not-found'|'forbidden'|'rate'|'server'|'network'|'config'} code
     * @param {string} message - for the user.
     * @param {{status?: number, retryAfter?: number}} [extra]
     */
    constructor(code, message, extra = {}) {
        super(message);
        this.name = 'SourceError';
        this.code = code;
        if (extra.status !== undefined) this.status = extra.status;
        if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
    }
}

/** A SourceError for an HTTP answer that wasn't a success. */
export function statusError(status, what, headers) {
    if (status === 401) return new SourceError('auth', `${what}: the server didn't accept the sign-in.`, { status });
    if (status === 403) return new SourceError('forbidden', `${what}: the server doesn't allow this.`, { status });
    if (status === 404 || status === 410) return new SourceError('not-found', `${what}: the server has no such thing (any more).`, { status });
    if (status === 409 || status === 412) return new SourceError('conflict', `${what}: it changed on the server meanwhile.`, { status });
    if (status === 429 || status === 503) {
        const header = headers?.get?.('retry-after');
        const after = header === null || header === undefined || String(header).trim() === '' ? NaN : Number(header);
        return new SourceError('rate', `${what}: the server asked to wait.`, { status, retryAfter: Number.isFinite(after) && after >= 0 ? after : 60 });
    }
    return new SourceError('server', `${what}: the server answered HTTP ${status}.`, { status });
}

/**
 * A calendar's or an account's problem as agents see it: a fixed category
 * by its code. The message stays for the window: it can hold a server's
 * own words.
 */
export const PROBLEMS = {
    auth: 'sign-in needed', network: 'can\'t reach the server', forbidden: 'the server refused', 'not-found': 'not found',
    rate: 'rate limited', server: 'server error', config: 'setup problem',
};

/** The category for an error's code; any other code is a server error. */
export const problemOf = (code) => (Object.hasOwn(PROBLEMS, code) ? PROBLEMS[code] : PROBLEMS.server);

/** The source modules by account kind, loaded when first needed. */
const LOADERS = {
    local: () => import('./local.js'),
    ics: () => import('./subscription.js'),
    caldav: () => import('./caldav.js'),
    google: () => import('./google.js'),
    microsoft: () => import('./microsoft.js'),
};

/** The kinds of account the plugin knows. */
export const KINDS = Object.keys(LOADERS);

/** The source module for an account kind. */
export async function sourceModule(kind) {
    const load = LOADERS[kind];
    if (load === undefined) throw new SourceError('config', `There is no "${kind}" kind of calendar account.`);
    return load();
}
