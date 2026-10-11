/**
 * The agent tools: read the user's calendars, find free time, and add,
 * change, answer or delete events. All named calendar_*, so a setting that
 * keeps the user's personal tools away from some sessions (the projects
 * plugin's guardedTools, by the word "calendar") covers them. Whether a
 * session may change calendars without asking is decided per call in
 * policy.js (CHANGE_TOOLS names the ones that change something).
 *
 * Every tool returns text for the model and a view the chat draws as a
 * card (client.js), never secrets.
 *
 * @module dsh-plugin-calendar/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { CalendarError } from './manager.js';
import { addDays, dayIn, isDay, isZone, normalLocal, toInstant, toLocal } from './zones.js';

const DAY = 86_400_000;

const OUTPUT = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            text: { type: 'string', required: true },
            view: { type: 'json' },
        },
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
    presentationMeta: (_args, value) => value.view ?? null,
};

/** Refusals and failures come back as text, so the model can say so or try again. */
async function guarded(run) {
    try {
        return await run();
    } catch (error) {
        if (error instanceof CalendarError) return { text: `Not done: ${error.message}` };
        return { text: `Failed: ${String(error?.message ?? error).slice(0, 400)}` };
    }
}

function tool(spec) {
    return defineTool({ output: OUTPUT, timeoutMs: 120_000, ...spec, execute: (args, exec) => guarded(() => spec.execute(args ?? {}, exec)) });
}

/** An optional text argument; an empty string counts as not given (some models send one for every field). */
const given = (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/**
 * An instant from a tool argument: 'now', 'today', 'tomorrow', a day
 * (its midnight, or the next one with `end`), a wall clock in the user's
 * zone, or a time with Z or an offset.
 */
function instantArg(value, zone, now, what, { end = false } = {}) {
    const text = String(value ?? '').trim();
    const lower = text.toLowerCase();
    if (lower === 'now') return now;
    if (lower === 'today' || lower === 'tomorrow' || lower === 'yesterday') {
        const shift = { today: 0, tomorrow: 1, yesterday: -1 }[lower] + (end ? 1 : 0);
        return toInstant(`${addDays(dayIn(now, zone), shift)}T00:00:00`, zone, zone);
    }
    if (isDay(text)) return toInstant(`${end ? addDays(text, 1) : text}T00:00:00`, zone, zone);
    if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
        const ms = Date.parse(text);
        if (Number.isFinite(ms)) return ms;
    }
    const local = normalLocal(text);
    if (local !== undefined) return toInstant(local, zone, zone);
    throw new CalendarError(`${what} "${text}" isn't a day (2026-10-12), a time (2026-10-12T09:30) or today/tomorrow.`);
}

/**
 * A start or end for a change, as the manager takes it: a day as is; a
 * wall clock read in `timeZone` when given, else in the user's zone (sent
 * with its offset, so an event in another zone stays in its own zone).
 */
function timeArg(value, timeZone, zone) {
    const text = String(value ?? '').trim();
    if (text === '' || isDay(text) || timeZone || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return text;
    const local = normalLocal(text);
    if (local === undefined) return text;
    const ms = toInstant(local, zone, zone);
    const offset = Math.round((Date.parse(`${toLocal(ms, zone)}Z`) - ms) / 60000);
    const sign = offset < 0 ? '-' : '+';
    const abs = Math.abs(offset);
    return `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/** The fields a create or update takes, from tool arguments. */
function changeInput(args, zone) {
    const input = {};
    const tz = given(args.time_zone);
    if (tz !== undefined) {
        if (!isZone(tz) && tz !== 'UTC') throw new CalendarError(`"${tz}" isn't a time zone; use an IANA name like Europe/Berlin.`);
        input.timeZone = tz;
    }
    if (given(args.title) !== undefined) input.title = args.title;
    if (given(args.start) !== undefined) input.start = timeArg(args.start, tz, zone);
    if (given(args.end) !== undefined) input.end = timeArg(args.end, tz, zone);
    if (typeof args.all_day === 'boolean') input.allDay = args.all_day;
    for (const [from, to] of [['location', 'location'], ['description', 'description'], ['url', 'url'], ['repeat', 'repeat'], ['calendar_id', 'calendarId']]) {
        if (args[from] === null) input[to] = null;
        else if (given(args[from]) !== undefined) input[to] = args[from];
    }
    if (Array.isArray(args.reminders)) input.alarms = args.reminders;
    if (Array.isArray(args.guests)) input.attendees = args.guests;
    if (typeof args.busy === 'boolean') input.busy = args.busy;
    if (typeof args.private === 'boolean') input.privacy = args.private ? 'private' : 'public';
    if (args.notify_guests === true) input.notify = true;
    return input;
}

// ── Words for the model ────────────────────────────────────────────────

const dayWords = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const clock = (ms, zone) => toLocal(ms, zone).slice(11, 16);

/** One occurrence in a line: when, what, where, and its id. */
function line(o, zone, { details = false } = {}) {
    let when;
    if (o.allDay) {
        when = o.lastDay && o.lastDay !== o.startDay ? `all day to ${dayWords(o.lastDay)}` : 'all day';
    } else {
        const sameDay = dayIn(o.start, zone) === dayIn(Math.max(o.start, o.end - 1), zone);
        when = sameDay ? `${clock(o.start, zone)}–${clock(o.end, zone)}` : `${clock(o.start, zone)} to ${dayWords(dayIn(o.end, zone))} ${clock(o.end, zone)}`;
        if (o.timeZone && o.timeZone !== zone) when += ` (${o.startLocal.slice(11)}–${o.endLocal.slice(11)} ${o.timeZone})`;
    }
    const parts = [`${when}  ${o.title}`, o.calendar];
    if (o.location) parts.push(o.location);
    if (o.conference) parts.push(`call: ${o.conference}`);
    if (o.repeats) parts.push(`repeats: ${o.repeats}${o.changed ? ' (this one changed)' : ''}`);
    if (o.attendees?.length) parts.push(`${o.attendees.length} guest${o.attendees.length === 1 ? '' : 's'}${o.myStatus ? `, you: ${o.myStatus}` : ''}`);
    if (o.status && o.status !== 'confirmed') parts.push(o.status);
    if (o.busy === false) parts.push('shows as free');
    if (o.readOnly) parts.push('read only');
    let text = `- ${parts.join(' · ')}  [id ${o.id}]`;
    if (details && o.description) text += `\n    ${o.description.replace(/\s+/g, ' ').slice(0, 300)}`;
    return text;
}

/** Occurrences grouped by day, in the user's zone. */
function agenda(list, zone, opts) {
    const out = [];
    let day;
    for (const o of list) {
        const d = o.allDay ? o.startDay : dayIn(o.start, zone);
        if (d !== day) {
            day = d;
            out.push(dayWords(d));
        }
        out.push(line(o, zone, opts));
    }
    return out.join('\n');
}

/** A smaller occurrence for the chat card. */
function card(o) {
    const keep = ['id', 'title', 'calendar', 'color', 'start', 'end', 'allDay', 'startDay', 'lastDay', 'timeZone', 'location', 'conference', 'repeats', 'myStatus', 'status', 'readOnly'];
    return Object.fromEntries(keep.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
}

/** Everything about one occurrence, for the model. */
function details(o, zone) {
    const out = [line(o, zone)];
    out.push(`  calendar: ${o.calendar} (${o.calendarId})${o.readOnly ? ', read only' : ''}`);
    if (o.allDay) out.push(`  days: ${o.startDay} to ${o.lastDay}`);
    else out.push(`  time: ${o.startLocal} to ${o.endLocal} ${o.timeZone}`);
    if (o.repeat) out.push(`  repeat rule: ${o.repeat}`);
    if (o.url) out.push(`  link: ${o.url}`);
    if (o.organizer) out.push(`  organizer: ${o.organizer.name ? `${o.organizer.name} <${o.organizer.email}>` : o.organizer.email}`);
    for (const p of o.attendees ?? []) out.push(`  guest: ${p.name ? `${p.name} <${p.email}>` : p.email} — ${p.status ?? 'needs-action'}${p.role === 'optional' ? ', optional' : ''}${p.self ? ' (the user)' : ''}`);
    if (o.alarms?.length) out.push(`  reminders: ${o.alarms.map((m) => `${m} min before`).join(', ')}`);
    if (o.privacy) out.push(`  privacy: ${o.privacy}`);
    if (o.canRespond) out.push('  the user can answer this invitation (calendar_respond)');
    if (o.description) out.push(`  notes:\n${o.description.split('\n').map((l) => `    ${l}`).join('\n')}`);
    return out.join('\n');
}

const SCOPE = {
    type: 'string', enum: ['one', 'following', 'all'],
    description: 'For a repeating event (required then): "one" this occurrence only, "following" this and the ones after it, "all" the whole series. Ask the user when they didn\'t say.',
};

/** The fields calendar_update_event can empty (its `clear`). */
const CLEARABLE = ['location', 'description', 'url', 'repeat'];

const TIME_HELP = 'A day (2026-10-12) for all-day, else a time (2026-10-12T09:30) in the user\'s time zone, or in time_zone when given.';

/** Repeating events need a scope from the model: guessing would change more (or less) than the user meant. */
function scopeFor(manager, id, scope) {
    const s = given(scope);
    const at = manager.locate(id);
    // A single event, or a series named by its own id (without an occurrence's date): the whole of it.
    if ((!at.series && !at.instance) || !at.recurrenceId) return 'all';
    if (s === undefined) throw new CalendarError('This event repeats: say scope "one" (this occurrence), "following" (this and later ones) or "all" (the series). Ask the user if they didn\'t say.');
    return s;
}

/** How a call reads in the chat while it runs: a short title, and its kind for the icon. */
const present = (title, kind) => ({ card: 'generic', title, kind });
const quoted = (text, n = 60) => {
    const t = String(text ?? '').replace(/\s+/g, ' ').trim();
    return t.length > n ? `“${t.slice(0, n - 1)}…”` : `“${t}”`;
};

/**
 * The tools, over one manager.
 * @param {import('./manager.js').CalendarManager} manager
 */
export function calendarTools(manager) {
    const zone = () => manager.zone();
    const now = () => manager.now();
    const header = () => `Times are in ${zone()} (the user's zone). Now: ${dayWords(dayIn(now(), zone()))} ${clock(now(), zone())}.`;

    return [
        tool({
            name: 'calendar_list_calendars',
            presentCall: () => present('List calendars', 'read'),
            description: 'List the user\'s calendars (ids, accounts, which can be written, which is the default for new events) and the user\'s time zone.',
            parameters: {},
            async execute() {
                const { calendars, accounts } = manager.state();
                const lines = calendars.map((c) => `- ${c.name} · ${c.account}${c.readOnly ? ' · read only' : ''}${c.isDefault ? ' · default for new events' : ''}${c.hidden ? ' · hidden in the window' : ''}${c.error ? ` · problem: ${c.error}` : ''}  [id ${c.id}]`);
                const troubled = accounts.filter((a) => a.status === 'signin' || a.status === 'error').map((a) => `- ${a.name}: ${a.error ?? 'needs attention'}`);
                const text = [header(), 'Calendars:', ...lines, ...(troubled.length ? ['Accounts with problems:', ...troubled] : [])].join('\n');
                return { text, view: { kind: 'calendars', calendars } };
            },
        }),
        tool({
            name: 'calendar_events',
            presentCall: (args) => present(given(args.from) ? `Calendar from ${args.from}${given(args.to) ? ` to ${args.to}` : ''}` : 'Calendar for the week', 'read'),
            description: 'The user\'s events between two times (default: today and the next 6 days), in time order, from every shown calendar or the ones given. Each event has an id to use with the other calendar tools.',
            parameters: {
                from: { type: 'string', description: 'Start: a day (2026-10-12), a time (2026-10-12T09:00), today or tomorrow. Default: today.' },
                to: { type: 'string', description: 'End: a day (its whole day is included), a time, today or tomorrow. Default: 7 days after the start.' },
                calendar_ids: { type: 'array', items: { type: 'string' }, description: 'Only these calendars (ids from calendar_list_calendars).' },
                details: { type: 'boolean', description: 'Also give each event\'s notes.' },
            },
            async execute(args) {
                const z = zone();
                const from = given(args.from) ? instantArg(args.from, z, now(), 'from') : instantArg('today', z, now(), 'from');
                const to = given(args.to) ? instantArg(args.to, z, now(), 'to', { end: true }) : from + 7 * DAY;
                const { occurrences, more } = manager.events({ from, to, calendars: args.calendar_ids, limit: 150 });
                const span = `${dayWords(dayIn(from, z))} to ${dayWords(dayIn(to - 1, z))}`;
                const text = occurrences.length === 0
                    ? `${header()}\nNo events from ${span}.`
                    : `${header()}\nEvents from ${span}:\n${agenda(occurrences, z, { details: args.details === true })}${more ? '\nThere are more; ask for a shorter span.' : ''}`;
                return { text, view: { kind: 'events', from, to, zone: z, occurrences: occurrences.slice(0, 60).map(card), more: more || occurrences.length > 60 } };
            },
        }),
        tool({
            name: 'calendar_search',
            presentCall: (args) => present(`Search calendar for ${quoted(args.query, 40)}`, 'search'),
            description: 'Find events by words in their title, place, notes, calendar or guests (default: a year back to a year ahead), upcoming ones first.',
            parameters: {
                query: { type: 'string', required: true, description: 'Words to find; every word must match.' },
                from: { type: 'string', description: 'Only from this day or time.' },
                to: { type: 'string', description: 'Only up to this day or time.' },
            },
            async execute(args) {
                const z = zone();
                const from = given(args.from) ? instantArg(args.from, z, now(), 'from') : undefined;
                const to = given(args.to) ? instantArg(args.to, z, now(), 'to', { end: true }) : undefined;
                const { occurrences, more } = manager.search({ text: args.query, from, to, limit: 40 });
                const text = occurrences.length === 0
                    ? `${header()}\nNothing matches "${args.query}".`
                    : `${header()}\nEvents matching "${args.query}":\n${occurrences.map((o) => `${dayWords(o.allDay ? o.startDay : dayIn(o.start, z))} ${line(o, z).slice(2)}`).map((l) => `- ${l}`).join('\n')}${more ? '\nThere are more; add words or a span.' : ''}`;
                return { text, view: { kind: 'events', zone: z, query: args.query, occurrences: occurrences.slice(0, 40).map(card), more } };
            },
        }),
        tool({
            name: 'calendar_get_event',
            presentCall: () => present('Read event', 'read'),
            description: 'Everything about one event: time and zone, repeat rule, guests and their answers, reminders, notes, links.',
            parameters: {
                id: { type: 'string', required: true, description: 'The event id from calendar_events or calendar_search.' },
            },
            async execute(args) {
                const o = manager.event(args.id);
                return { text: `${header()}\n${details(o, zone())}`, view: { kind: 'event', occurrence: card(o) } };
            },
        }),
        tool({
            name: 'calendar_free_time',
            presentCall: () => present('Find free time', 'search'),
            description: 'Free time in the user\'s calendars: open slots of at least a given length within working hours (default 09:00 to 17:00, Monday to Friday) between two times.',
            parameters: {
                from: { type: 'string', description: 'Start: a day, a time, today or tomorrow. Default: now.' },
                to: { type: 'string', description: 'End: a day (included), a time. Default: 7 days after the start.' },
                minutes: { type: 'integer', description: 'The shortest slot wanted, in minutes. Default 30.' },
                day_start: { type: 'string', description: 'Hours of the day to look in, from (HH:MM, the user\'s zone). Default 09:00.' },
                day_end: { type: 'string', description: 'Hours of the day to look in, to (HH:MM). Default 17:00.' },
                weekdays: { type: 'array', items: { type: 'string', enum: WEEKDAY_CODES }, description: 'Days of the week to look on. Default MO to FR.' },
                calendar_ids: { type: 'array', items: { type: 'string' }, description: 'Only count these calendars as busy.' },
            },
            async execute(args) {
                const z = zone();
                const from = given(args.from) ? instantArg(args.from, z, now(), 'from') : now();
                const to = given(args.to) ? instantArg(args.to, z, now(), 'to', { end: true }) : from + 7 * DAY;
                const days = Array.isArray(args.weekdays) && args.weekdays.length ? args.weekdays.map((d) => WEEKDAY_CODES.indexOf(d)).filter((d) => d >= 0) : [1, 2, 3, 4, 5];
                const { slots } = manager.freeSlots({
                    from, to, minutes: args.minutes ?? 30, dayStart: given(args.day_start) ?? '09:00', dayEnd: given(args.day_end) ?? '17:00',
                    days, calendars: args.calendar_ids, limit: 30,
                });
                const lines = slots.map((s) => `- ${dayWords(dayIn(s.start, z))} ${clock(s.start, z)}–${clock(s.end, z)} (${Math.round((s.end - s.start) / 60000)} min)`);
                const text = slots.length === 0 ? `${header()}\nNo free slot of ${args.minutes ?? 30} minutes in that span.` : `${header()}\nFree slots:\n${lines.join('\n')}`;
                return { text, view: { kind: 'free', zone: z, slots } };
            },
        }),
        tool({
            name: 'calendar_create_event',
            presentCall: (args) => present(`Add ${quoted(args.title)} at ${args.start}`, 'edit'),
            description: 'Add an event to the user\'s calendar (the default calendar unless calendar_id is given). Guests get an invitation only with notify_guests, which only the user\'s words should ask for.',
            parameters: {
                title: { type: 'string', required: true, description: 'What it is.' },
                start: { type: 'string', required: true, description: TIME_HELP },
                end: { type: 'string', description: 'A time, or for all-day events the last day (inclusive). Default: one hour after the start, or the start day.' },
                all_day: { type: 'boolean', description: 'An all-day event (also implied by a day without a time).' },
                time_zone: { type: 'string', description: 'The event\'s own time zone (IANA, like Europe/Berlin), when it isn\'t the user\'s.' },
                calendar_id: { type: 'string', description: 'The calendar (id from calendar_list_calendars).' },
                location: { type: 'string', description: 'Where.' },
                description: { type: 'string', description: 'Notes.' },
                url: { type: 'string', description: 'A link.' },
                repeat: { type: 'string', description: 'A repeat rule (RFC 5545 RRULE), like FREQ=WEEKLY;BYDAY=MO,WE or FREQ=MONTHLY;BYMONTHDAY=1;COUNT=6.' },
                reminders: { type: 'array', items: { type: 'integer' }, description: 'Reminders, in minutes before the start (like [10, 1440]).' },
                guests: { type: 'array', items: { type: 'string' }, description: 'Guests\' email addresses.' },
                notify_guests: { type: 'boolean', description: 'Send the guests invitations by email. Only when the user asked to invite them.' },
                busy: { type: 'boolean', description: 'false: the time shows as free.' },
                private: { type: 'boolean', description: 'true: others who see the calendar see only that the time is taken.' },
            },
            async execute(args) {
                const o = await manager.createEvent(changeInput(args, zone()), 'agent');
                return { text: `Added:\n${details(o, zone())}`, view: { kind: 'created', occurrence: card(o) } };
            },
        }),
        tool({
            name: 'calendar_update_event',
            presentCall: (args) => present(given(args.title) ? `Change event to ${quoted(args.title)}` : 'Change event', 'edit'),
            description: 'Change an event: its title, time, place, notes, repeat rule, reminders, guests, or calendar (calendar_id moves it). Give only what changes; `clear` empties a field.',
            parameters: {
                id: { type: 'string', required: true, description: 'The event id.' },
                scope: SCOPE,
                title: { type: 'string' },
                start: { type: 'string', description: `${TIME_HELP} Without an end, the event keeps its length.` },
                end: { type: 'string', description: 'A time, or for all-day events the last day (inclusive).' },
                all_day: { type: 'boolean' },
                time_zone: { type: 'string', description: 'The event\'s own time zone (IANA).' },
                calendar_id: { type: 'string', description: 'Move the event to this calendar.' },
                location: { type: 'string' },
                description: { type: 'string' },
                url: { type: 'string' },
                repeat: { type: 'string', description: 'A new repeat rule (RRULE). To stop it repeating, put "repeat" in clear.' },
                reminders: { type: 'array', items: { type: 'integer' }, description: 'All reminders, in minutes before the start ([] for none).' },
                guests: { type: 'array', items: { type: 'string' }, description: 'All guests\' email addresses (the full list, [] for none).' },
                notify_guests: { type: 'boolean', description: 'Email the guests about the change. Only when the user asked.' },
                busy: { type: 'boolean' },
                private: { type: 'boolean' },
                clear: { type: 'array', items: { type: 'string', enum: CLEARABLE }, description: 'Fields to empty: location, description, url, or repeat (it becomes a single event).' },
            },
            async execute(args) {
                const scope = scopeFor(manager, args.id, args.scope);
                const input = changeInput(args, zone());
                for (const field of args.clear ?? []) if (CLEARABLE.includes(field)) input[field] = null;
                const o = await manager.updateEvent(args.id, input, scope, 'agent');
                const text = o?.title ? `Changed${scope !== 'all' ? ` (${scope === 'one' ? 'this occurrence' : 'this and the following ones'})` : ''}:\n${details(o, zone())}` : 'Changed.';
                return { text, view: o?.title ? { kind: 'updated', occurrence: card(o), scope } : null };
            },
        }),
        tool({
            name: 'calendar_delete_event',
            presentCall: () => present('Delete event', 'delete'),
            description: 'Delete an event, or for a repeating one this occurrence, this and the following ones, or the whole series.',
            parameters: {
                id: { type: 'string', required: true, description: 'The event id.' },
                scope: SCOPE,
                notify_guests: { type: 'boolean', description: 'Tell the guests it\'s cancelled. Only when the user asked.' },
            },
            async execute(args) {
                const scope = scopeFor(manager, args.id, args.scope);
                const before = manager.event(args.id);
                await manager.deleteEvent(args.id, scope, 'agent', { notify: args.notify_guests === true });
                const what = scope === 'one' ? 'this occurrence of ' : scope === 'following' ? 'this and the following occurrences of ' : '';
                const when = line(before, zone()).slice(2).split('  ')[0];
                const day = before.allDay ? dayWords(before.startDay) : dayWords(dayIn(before.start, zone()));
                return { text: `Deleted ${what}"${before.title}" (${day}, ${when}).`, view: { kind: 'deleted', occurrence: card(before), scope } };
            },
        }),
        tool({
            name: 'calendar_respond',
            presentCall: (args) => present(`Answer invitation: ${args.answer}`, 'edit'),
            description: 'Answer an invitation the user got: accepted, declined or tentative. The organizer is told.',
            parameters: {
                id: { type: 'string', required: true, description: 'The event id.' },
                answer: { type: 'string', required: true, enum: ['accepted', 'declined', 'tentative'] },
                scope: { type: 'string', enum: ['one', 'all'], description: 'For a repeating event: "one" this occurrence, "all" the series.' },
            },
            async execute(args) {
                const scope = scopeFor(manager, args.id, args.scope);
                const o = await manager.respond(args.id, args.answer, scope === 'following' ? 'all' : scope, 'agent');
                return { text: `Answered ${args.answer}:\n${line(o, zone())}`, view: { kind: 'responded', occurrence: card(o), answer: args.answer } };
            },
        }),
    ];
}
