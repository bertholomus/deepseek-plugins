/**
 * The write rules for agents: whether a chat may add, change, answer or
 * delete events, decided per call before the tool runs (DSH's
 * `tools/pre-execute`). Reading is never gated here.
 *
 * The plugin setting `agentChanges`:
 *   'preset' (default) - by the session's permission: Read Only can't
 *            change calendars; Full access changes them without asking; Auto
 *            leaves each change to its reviewer; anything else (Workspace
 *            Write, a custom mix) asks the user first, in DSH's approval
 *            prompt, saying what would change.
 *   'ask'    - every change asks the user first. A session whose approval
 *            policy never asks gets a refusal instead.
 *   'off'    - agents can't change calendars; the window still can.
 *
 * @module dsh-plugin-calendar/policy
 */
export const MODES = ['preset', 'ask', 'off'];

/** The tools that change calendars (tools.js); the rest only read. */
export const CHANGE_TOOLS = new Set(['calendar_create_event', 'calendar_update_event', 'calendar_delete_event', 'calendar_respond']);

/**
 * What a session may do, from its permission preset: the preset's sandbox
 * ('read-only', 'workspace-write', 'danger-full-access'), 'auto', or
 * 'unknown' (a custom mix, or a DSH without presets).
 */
export function accessOf(presets, session) {
    if (!presets || !session) return 'unknown';
    try {
        const name = presets.current(session);
        if (name === 'auto') return 'auto';
        if (typeof name !== 'string' || name === 'custom') return 'unknown';
        const sandbox = presets.resolve(name)?.sandbox;
        return ['read-only', 'workspace-write', 'danger-full-access'].includes(sandbox) ? sandbox : 'unknown';
    } catch {
        return 'unknown';
    }
}

/**
 * The decision for one change, without DSH: 'allow', 'ask', or a refusal
 * ({deny: reason for the model}).
 */
export function decide(mode, access) {
    if (mode === 'off') {
        return { deny: 'Changing the user\'s calendars from chats is switched off in the calendar plugin\'s settings. Tell the user what you would change; they can do it on the Calendar page.' };
    }
    if (mode === 'ask') return 'ask';
    if (access === 'read-only') {
        return { deny: 'This session\'s permission is Read Only: it can read the user\'s calendars but not change them. Tell the user what you would change; they can do it on the Calendar page, or give this session more access.' };
    }
    if (access === 'danger-full-access' || access === 'auto') return 'allow';
    return 'ask';
}

const clip = (text, n = 80) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const SCOPE_WORDS = { one: 'only this occurrence of ', following: 'this and the following occurrences of ', all: '' };

/** calendar_update_event's `clear`, in words. */
const CLEAR_WORDS = { location: 'no place', description: 'no notes', url: 'no link', repeat: 'stop repeating' };

/** A change in words for the approval prompt: what, which event, where. Never throws. */
export function describeChange(manager, name, args = {}) {
    const a = args !== null && typeof args === 'object' ? args : {};
    const eventWords = () => {
        try {
            const o = manager.event(String(a.id ?? ''));
            const zone = manager.zone();
            const day = o.allDay ? o.startDay : o.startLocal?.slice(0, 10);
            const time = o.allDay ? 'all day' : `${o.startLocal?.slice(11, 16)}${o.timeZone && o.timeZone !== zone ? ` ${o.timeZone}` : ''}`;
            return `“${clip(o.title)}” (${day} ${time}, ${o.calendar})`;
        } catch {
            return 'an event';
        }
    };
    const calendarWords = () => {
        try {
            const id = a.calendar_id || manager.defaultCalendarId();
            return id ? manager.calendarName(manager.calendar(id)) : 'the default calendar';
        } catch {
            return 'a calendar';
        }
    };
    const guests = Array.isArray(a.guests) ? a.guests.length : 0;
    const invite = a.notify_guests === true && guests > 0 ? `, and email ${guests === 1 ? 'an invitation' : `${guests} invitations`}` : '';
    switch (name) {
        case 'calendar_create_event': {
            const when = [a.start, a.end].filter((t) => typeof t === 'string' && t.trim() !== '').map((t) => clip(t, 30)).join(' to ');
            return `Add “${clip(a.title)}” (${when}${a.repeat ? ', repeating' : ''}) to ${calendarWords()}${invite}?`;
        }
        case 'calendar_update_event': {
            const fields = ['title', 'start', 'end', 'all_day', 'time_zone', 'location', 'description', 'url', 'repeat', 'reminders', 'guests', 'busy', 'private']
                .filter((k) => a[k] !== undefined && a[k] !== null && !(typeof a[k] === 'string' && a[k].trim() === ''))
                .map((k) => k.replace('_', ' '));
            const cleared = Array.isArray(a.clear) ? [...new Set(a.clear)].filter((k) => Object.hasOwn(CLEAR_WORDS, k)).map((k) => CLEAR_WORDS[k]) : [];
            const moving = typeof a.calendar_id === 'string' && a.calendar_id.trim() !== '' ? ` and move it to ${calendarWords()}` : '';
            const what = fields.length + cleared.length ? `: ${[...fields, ...cleared].join(', ')}` : '';
            return `Change ${SCOPE_WORDS[a.scope] ?? ''}${eventWords()}${what}${moving}${invite}?`;
        }
        case 'calendar_delete_event':
            return `Delete ${SCOPE_WORDS[a.scope] ?? ''}${eventWords()}${a.notify_guests === true ? ', and tell its guests' : ''}?`;
        case 'calendar_respond':
            return `Answer ${eventWords()}: ${clip(a.answer, 20)}? The organizer is told.`;
        default:
            return `Change the calendar (${name})?`;
    }
}

/**
 * The `tools/pre-execute` gate for the calendar's change tools. Other gates
 * run first; a refusal or a question from them stands.
 * @param {{presets: () => object|undefined, manager: object, mode: () => string, log: (line: string) => void}} deps
 */
export function changeGate({ presets, manager, mode, log }) {
    return async (exec, next) => {
        if (!CHANGE_TOOLS.has(exec?.name)) return next();
        const downstream = await next();
        if (downstream?.kind !== 'allow') return downstream;
        const access = accessOf(presets(), exec.agent?.session);
        const decision = decide(mode(), access);
        log(`policy ${exec.name} access=${access} ${typeof decision === 'string' ? decision : 'deny'}`);
        if (decision === 'allow') return { kind: 'allow' };
        if (decision === 'ask') {
            const text = describeChange(manager, exec.name, exec.arguments);
            return { kind: 'ask', reason: `Calendar: ${text}`, displayReason: { en: text } };
        }
        return { kind: 'deny', reason: decision.deny };
    };
}
