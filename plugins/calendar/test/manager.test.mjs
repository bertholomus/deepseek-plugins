/**
 * The manager on calendars kept on this computer and a subscribed feed:
 * adding, reading, changing (one occurrence, this and the following ones,
 * the whole series), moving, deleting, answering, searching, free time,
 * export and import, and a restart that keeps everything. A feed's address
 * stays in its credential record, out of the files, the log and anything
 * the window or an agent gets.
 *
 *   node --test plugins/calendar/test/manager.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { register } from 'node:module';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalendarError, CalendarManager, calendarIdOf } from '../lib/manager.js';

// The agents' tools without DSH: a stand-in for its tool package, whose defineTool hands each tool back as it is.
const TOOLS_STANDIN = 'data:text/javascript,export const defineTool = (tool) => tool;';
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, next) {
    return specifier === '@deepseek-ai/dsh-tools' ? { shortCircuit: true, url: ${JSON.stringify(TOOLS_STANDIN)} } : next(specifier, context);
}`)}`);
const { calendarTools } = await import('../lib/tools.js');

const ZONE = 'Europe/Berlin';
const NOW = Date.parse('2026-10-11T10:00:00Z');
const at = (local) => Date.parse(`${local}+02:00`);

function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'calendar-manager-'));
    const vault = new Map();
    const secrets = {
        async get(id) { return vault.get(id); },
        async set(id, payload) { vault.set(id, structuredClone(payload)); },
        async clear(id) { vault.delete(id); },
    };
    const config = { storeFile: join(dir, 'calendar.json'), logFile: join(dir, 'calendar.log'), syncMinutes: 15, timeZone: ZONE };
    const make = () => new CalendarManager({ config, secrets, now: () => NOW });
    return { dir, vault, config, make, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const week = (m, from = '2026-10-12T00:00', to = '2026-10-26T00:00') => m.events({ from: at(from), to: at(to) }).occurrences;
const titles = (list) => list.map((o) => `${o.startLocal ?? o.startDay} ${o.title}`);

test('a calendar on this computer: add, read, change and delete single events', async () => {
    const { make, done, config } = setup();
    const m = make();
    try {
        await m.start();
        const state = m.state();
        assert.equal(state.zone, ZONE);
        assert.equal(state.calendars.length, 1);
        assert.equal(state.calendars[0].name, 'Personal');
        assert.equal(state.defaultCalendar, state.calendars[0].id);

        const dentist = await m.createEvent({ title: 'Dentist', start: '2026-10-13T09:30', end: '2026-10-13T10:15', location: 'Main St 1', alarms: [30, 10] }, 'agent');
        assert.equal(dentist.title, 'Dentist');
        assert.equal(dentist.startLocal, '2026-10-13T09:30');
        assert.equal(dentist.endLocal, '2026-10-13T10:15');
        assert.equal(dentist.timeZone, ZONE);
        assert.equal(dentist.start, at('2026-10-13T09:30'));
        assert.deepEqual(dentist.alarms, [10, 30]);
        assert.match(dentist.id, /^ev-[0-9a-f]{12}$/);

        const trip = await m.createEvent({ title: 'Trip', start: '2026-10-20', end: '2026-10-22' });
        assert.equal(trip.allDay, true);
        assert.equal(trip.startDay, '2026-10-20');
        assert.equal(trip.lastDay, '2026-10-22');

        const timedDefault = await m.createEvent({ title: 'Call', start: '2026-10-14T16:00' });
        assert.equal(timedDefault.endLocal, '2026-10-14T17:00', 'an hour by default');

        assert.deepEqual(titles(week(m)), ['2026-10-13T09:30 Dentist', '2026-10-14T16:00 Call', '2026-10-20 Trip']);

        // A start alone moves the event and keeps its length; another zone keeps the event's own wall clock.
        const moved = await m.updateEvent(dentist.id, { start: '2026-10-13T11:00' });
        assert.equal(moved.startLocal, '2026-10-13T11:00');
        assert.equal(moved.endLocal, '2026-10-13T11:45');
        const ny = await m.updateEvent(timedDefault.id, { start: '2026-10-14T09:00', timeZone: 'America/New_York' });
        assert.equal(ny.timeZone, 'America/New_York');
        assert.equal(ny.startLocal, '2026-10-14T09:00');
        assert.equal(ny.start, Date.parse('2026-10-14T09:00:00-04:00'));
        // Given with an offset, a time is the same instant on the event's own clock.
        const offset = await m.updateEvent(timedDefault.id, { start: '2026-10-14T17:00+02:00' });
        assert.equal(offset.startLocal, '2026-10-14T11:00');
        assert.equal(offset.timeZone, 'America/New_York');

        // Fields clear with null; bad input is refused with a message that says what to give.
        const cleared = await m.updateEvent(dentist.id, { location: null, alarms: [] });
        assert.equal(cleared.location, undefined);
        assert.equal(cleared.alarms, undefined);
        await assert.rejects(m.updateEvent(dentist.id, { end: '2026-10-13T08:00' }), CalendarError);
        await assert.rejects(m.createEvent({ title: 'x', start: 'soon' }), /isn't a time/);
        await assert.rejects(m.createEvent({ title: '', start: '2026-10-13T09:00' }), /title/);
        await assert.rejects(m.createEvent({ title: 'x', start: '2026-10-13T09:00', repeat: 'FREQ=SOMETIMES' }), /repeat rule/);
        await assert.rejects(m.updateEvent('ev-000000000000', { title: 'x' }), /There is no event/);

        // The item on disk is iCalendar text, and the files are private.
        await m.store.flush();
        const file = m.store.eventsFile(state.calendars[0].id);
        const saved = JSON.parse(readFileSync(file, 'utf8'));
        const raw = Object.values(saved.items).map((i) => i.raw).join('\n');
        assert.match(raw, /SUMMARY:Dentist/);
        assert.match(raw, /DTSTART;TZID=Europe\/Berlin:20261013T110000/);
        assert.match(raw, /BEGIN:VTIMEZONE\r\nTZID:America\/New_York/);
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.equal(statSync(config.storeFile).mode & 0o777, 0o600);
        assert.equal(statSync(join(config.storeFile, '..')).mode & 0o777, 0o700);

        await m.deleteEvent(trip.id);
        assert.deepEqual(titles(week(m)), ['2026-10-13T11:00 Dentist', '2026-10-14T11:00 Call']);
        assert.match(readFileSync(config.logFile, 'utf8'), /create cal-[0-9a-f]+ by=agent/);
        assert.doesNotMatch(readFileSync(config.logFile, 'utf8'), /Dentist/, 'the log has no event text');
    } finally {
        m.dispose();
        done();
    }
});

test('a repeating event: one occurrence, this and the following ones, the whole series', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        const standup = await m.createEvent({ title: 'Standup', start: '2026-10-12T09:00', end: '2026-10-12T09:15', repeat: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' });
        assert.equal(standup.recurring, true);
        assert.equal(standup.repeats, 'Every week on Monday, Wednesday and Friday');
        let list = week(m);
        assert.equal(list.length, 6);
        assert.deepEqual(list.map((o) => o.id.split('.')[1]), ['20261012T090000', '20261014T090000', '20261016T090000', '20261019T090000', '20261021T090000', '20261023T090000']);
        assert.ok(list.every((o) => o.eventId === standup.eventId));

        // Only Wednesday's moves; it says it changed.
        const wed = list[1];
        const changed = await m.updateEvent(wed.id, { start: '2026-10-14T10:00' }, 'one');
        assert.equal(changed.startLocal, '2026-10-14T10:00');
        assert.equal(changed.endLocal, '2026-10-14T10:15');
        assert.equal(changed.changed, true);
        assert.equal(changed.id, wed.id, 'a changed occurrence keeps its id');
        list = week(m);
        assert.deepEqual(titles(list).slice(0, 3), ['2026-10-12T09:00 Standup', '2026-10-14T10:00 Standup', '2026-10-16T09:00 Standup']);

        // An occurrence taken out.
        await m.deleteEvent(list[2].id, 'one');
        list = week(m);
        assert.equal(list.length, 5);
        assert.ok(!list.some((o) => o.startLocal === '2026-10-16T09:00'));

        // From the 19th on: a new title; the earlier ones (and Wednesday's change) stay.
        const mon = list.find((o) => o.startLocal === '2026-10-19T09:00');
        const following = await m.updateEvent(mon.id, { title: 'Team sync' }, 'following');
        assert.equal(following.title, 'Team sync');
        list = week(m);
        assert.deepEqual(titles(list), [
            '2026-10-12T09:00 Standup', '2026-10-14T10:00 Standup',
            '2026-10-19T09:00 Team sync', '2026-10-21T09:00 Team sync', '2026-10-23T09:00 Team sync',
        ]);
        const older = m.event(list[0].id);
        assert.match(older.repeat, /UNTIL=20261019T065959Z/);
        assert.notEqual(list[2].eventId, list[0].eventId, 'the new part is its own series');

        // The whole new series moves half an hour, given on one of its occurrences.
        const fri = list.find((o) => o.startLocal === '2026-10-23T09:00');
        await m.updateEvent(fri.id, { start: '2026-10-23T09:30' }, 'all');
        list = week(m);
        assert.deepEqual(titles(list).slice(2), ['2026-10-19T09:30 Team sync', '2026-10-21T09:30 Team sync', '2026-10-23T09:30 Team sync']);
        assert.ok(list.slice(2).every((o) => o.endLocal.endsWith('09:45')));

        // Moving a weekly series to another weekday moves its days with it.
        const tue = await m.updateEvent(list[2].id, { start: '2026-10-20T09:30' }, 'all');
        assert.match(tue.repeat, /BYDAY=TU,TH,SA/);

        // A scope only for repeating events, and a whole-series change through its own id.
        await assert.rejects(m.updateEvent(standup.eventId, { title: 'x' }, 'one'), /occurrence/);
        const series = await m.updateEvent(standup.eventId, { title: 'Daily' }, 'all');
        assert.equal(series.title, 'Daily');
        assert.equal(m.event(list[1].id).title, 'Standup', 'a changed occurrence keeps its own title');

        // This and the following ones, deleted: the series ends before.
        const nov = m.events({ from: at('2026-10-26T00:00'), to: at('2026-11-30T00:00') }).occurrences.filter((o) => o.title === 'Team sync');
        assert.ok(nov.length > 5);
        await m.deleteEvent(nov[2].id, 'following');
        const after = m.events({ from: at('2026-10-26T00:00'), to: at('2027-03-01T00:00') }).occurrences.filter((o) => o.title === 'Team sync');
        assert.equal(after.length, 2);

        // The whole series deleted, its changed occurrence too.
        await m.deleteEvent(standup.eventId, 'all');
        assert.ok(!week(m).some((o) => o.eventId === standup.eventId));
    } finally {
        m.dispose();
        done();
    }
});

test('counted series split and all-day series', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        const pay = await m.createEvent({ title: 'Rent', start: '2026-11-01', repeat: 'FREQ=MONTHLY;BYMONTHDAY=1;COUNT=6' });
        assert.equal(pay.allDay, true);
        const all = m.events({ from: at('2026-10-01T00:00'), to: at('2027-06-01T00:00') }).occurrences;
        assert.deepEqual(all.map((o) => o.startDay), ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01']);
        await m.updateEvent(all[3].id, { title: 'Rent (new place)' }, 'following');
        const split = m.events({ from: at('2026-10-01T00:00'), to: at('2027-06-01T00:00') }).occurrences;
        assert.deepEqual(split.map((o) => `${o.startDay} ${o.title}`), [
            '2026-11-01 Rent', '2026-12-01 Rent', '2027-01-01 Rent',
            '2027-02-01 Rent (new place)', '2027-03-01 Rent (new place)', '2027-04-01 Rent (new place)',
        ]);
        assert.match(m.event(split[0].id).repeat, /COUNT=3/);
        assert.match(m.event(split[3].id).repeat, /COUNT=3/);
        // A three-day event that repeats yearly.
        const fest = await m.createEvent({ title: 'Festival', start: '2026-12-30', end: '2027-01-01', repeat: 'FREQ=YEARLY' });
        assert.equal(fest.lastDay, '2027-01-01');
        const next = m.events({ from: at('2027-12-31T00:00'), to: at('2028-01-02T00:00') }).occurrences.find((o) => o.title === 'Festival');
        assert.equal(next.startDay, '2027-12-30');
        assert.equal(next.lastDay, '2028-01-01');
    } finally {
        m.dispose();
        done();
    }
});

test('search, busy time and free slots', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        await m.createEvent({ title: 'Dentist', start: '2026-10-13T09:30', end: '2026-10-13T10:15', location: 'Main St' });
        await m.createEvent({ title: 'Lunch with Sam', start: '2026-10-13T12:00', end: '2026-10-13T13:00', attendees: ['sam@example.com'] });
        await m.createEvent({ title: 'Focus', start: '2026-10-13T14:00', end: '2026-10-13T16:00', busy: false });
        await m.createEvent({ title: 'Old dentist visit', start: '2026-09-01T09:00' });
        const found = m.search({ text: 'dentist' }).occurrences;
        assert.deepEqual(found.map((o) => o.title), ['Dentist', 'Old dentist visit'], 'upcoming first');
        assert.deepEqual(m.search({ text: 'main dentist' }).occurrences.map((o) => o.title), ['Dentist']);
        assert.deepEqual(m.search({ text: 'sam@example' }).occurrences.map((o) => o.title), ['Lunch with Sam']);
        assert.throws(() => m.search({ text: '  ' }), CalendarError);
        const { slots } = m.freeSlots({ from: at('2026-10-13T00:00'), to: at('2026-10-14T00:00'), minutes: 60 });
        assert.deepEqual(slots.map((s) => [new Date(s.start).toISOString(), new Date(s.end).toISOString()]), [
            ['2026-10-13T08:15:00.000Z', '2026-10-13T10:00:00.000Z'],
            ['2026-10-13T11:00:00.000Z', '2026-10-13T15:00:00.000Z'],
        ], 'free shows through events marked free');
        const weekend = m.freeSlots({ from: at('2026-10-17T00:00'), to: at('2026-10-19T00:00') });
        assert.equal(weekend.slots.length, 0, 'Saturday and Sunday are left out by default');
    } finally {
        m.dispose();
        done();
    }
});

test('calendars: make, rename, hide, default, move an event between them, export and import', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        const work = await m.createCalendar({ name: 'Work', color: '#30A46C' });
        assert.equal(work.color, '#30a46c');
        const personal = m.state().calendars.find((c) => c.name === 'Personal');
        const series = await m.createEvent({ title: 'Gym', start: '2026-10-12T18:00', repeat: 'FREQ=WEEKLY;COUNT=4', calendarId: personal.id });
        const occ = week(m).filter((o) => o.title === 'Gym');
        await m.updateEvent(occ[1].id, { title: 'Gym (late)', start: '2026-10-19T20:00' }, 'one');
        const moved = await m.updateEvent(series.eventId, { calendarId: work.id });
        assert.equal(moved.calendarId, work.id);
        const after = week(m).filter((o) => o.title.startsWith('Gym'));
        assert.ok(after.every((o) => o.calendarId === work.id), 'the series and its changed occurrence moved');
        assert.deepEqual(titles(after), ['2026-10-12T18:00 Gym', '2026-10-19T20:00 Gym (late)']);

        m.updateCalendar(work.id, { hidden: true });
        assert.equal(week(m).filter((o) => o.title.startsWith('Gym')).length, 0, 'hidden calendars are left out');
        assert.equal(m.events({ from: at('2026-10-12T00:00'), to: at('2026-10-26T00:00'), calendars: [work.id] }).occurrences.length, 2, 'unless asked for');
        m.updateCalendar(work.id, { hidden: false, name: 'Job' });
        m.setDefaultCalendar(work.id);
        assert.equal(m.state().defaultCalendar, work.id);
        const made = await m.createEvent({ title: 'Review', start: '2026-10-15T10:00' });
        assert.equal(made.calendar, 'Job');

        const exported = m.exportCalendar(work.id);
        assert.equal(exported.events, 3);
        assert.match(exported.ics, /BEGIN:VCALENDAR/);
        assert.match(exported.ics, /RECURRENCE-ID/);
        const copy = await m.createCalendar({ name: 'Copy' });
        const imported = await m.importIcs(copy.id, exported.ics);
        assert.equal(imported.added, 2);
        const again = await m.importIcs(copy.id, exported.ics);
        assert.equal(again.added, 0, 'the same events again are left');
        assert.equal(m.events({ from: at('2026-10-12T00:00'), to: at('2026-10-26T00:00'), calendars: [copy.id] }).occurrences.length, 3);

        await assert.rejects(m.deleteCalendar(m.state().calendars.find((c) => c.name === 'Personal').id).then(() => m.deleteCalendar(work.id)).then(() => m.deleteCalendar(copy.id)), /last calendar/);
    } finally {
        m.dispose();
        done();
    }
});

test('answering an invitation on a calendar whose account has the user\'s address', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        m.store.accounts.local.email = 'me@example.com';
        const ev = await m.createEvent({ title: 'Planning', start: '2026-10-15T14:00', attendees: ['me@example.com', { email: 'boss@example.com', name: 'Boss' }] });
        // An invitation from someone else.
        const at0 = m.locate(ev.id);
        at0.master.organizer = { email: 'boss@example.com', name: 'Boss' };
        m.changed();
        const seen = m.event(ev.id);
        assert.equal(seen.myStatus, 'needs-action');
        assert.equal(seen.canRespond, true);
        const answered = await m.respond(ev.id, 'accepted');
        assert.equal(answered.myStatus, 'accepted');
        await assert.rejects(m.respond(ev.id, 'maybe'), /accepted, declined or tentative/);
    } finally {
        m.dispose();
        done();
    }
});

test('a subscribed feed is read only, follows its ETag, survives a restart, and its address stays a secret', async (t) => {
    let hits = 0;
    let answer = 200;
    let body = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Feed//EN', 'X-WR-CALNAME:Holidays', 'X-WR-TIMEZONE:Europe/Berlin',
        'BEGIN:VEVENT', 'UID:h1@test', 'DTSTAMP:20260101T000000Z', 'DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104', 'SUMMARY:Holiday', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:h2@test', 'DTSTAMP:20260101T000000Z', 'DTSTART:20261104T170000Z', 'DURATION:PT2H', 'SUMMARY:Webinar', 'END:VEVENT',
        'END:VCALENDAR', '',
    ].join('\r\n');
    // A private feed's address, like Google's secret one: its key is in the path (and here in the query too).
    const key = 'private-9f8e7d6c5b4a3928';
    const query = 'token=1706f5e4d3c2b1a0';
    const path = `/calendar/ical/me%40example.com/${key}/basic.ics?${query}`;
    const server = createServer((req, res) => {
        if (req.url !== path) {
            res.writeHead(404);
            return res.end('not here');
        }
        hits++;
        if (answer !== 200) {
            res.writeHead(answer, answer === 429 ? { 'retry-after': '120' } : {});
            return res.end();
        }
        if (req.headers['if-none-match'] === '"v1"' && body.includes('Webinar')) {
            res.writeHead(304);
            return res.end();
        }
        res.writeHead(200, { 'content-type': 'text/calendar', etag: '"v1"' });
        res.end(body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const host = `127.0.0.1:${server.address().port}`;
    const url = `http://${host}${path}`;
    const { dir, vault, config, make, done } = setup();
    // The address may be in the account's credential record only. Each check says where it looked, never what it found.
    const hidden = (text, where) => assert.ok(!String(text).includes(key) && !String(text).includes(query), `${where} holds the feed's address`);
    const listCalendars = (manager) => calendarTools(manager).find((tool) => tool.name === 'calendar_list_calendars').execute({});
    /** Not in calendar.json, the events files or the log, nor in what the window or an agent gets. */
    const hiddenEverywhere = async (manager) => {
        manager.store.flush();
        const events = join(dir, 'events');
        for (const file of [config.storeFile, config.logFile, ...readdirSync(events).map((name) => join(events, name))]) hidden(readFileSync(file, 'utf8'), file);
        hidden(JSON.stringify(manager.state()), 'the window\'s state');
        hidden(JSON.stringify(await listCalendars(manager)), 'calendar_list_calendars');
    };
    let m = make();
    try {
        await m.start();
        const account = await m.addAccount({ kind: 'ics', url });
        // The account shows its host; the address is in its record, and its calendar has a fixed remote id.
        hidden(JSON.stringify(account), 'the account view');
        await hiddenEverywhere(m);
        assert.equal(account.name, 'Holidays', 'named by the feed');
        assert.equal(account.host, host);
        assert.ok(!('url' in account), 'the account view has no url');
        assert.ok(vault.get(account.id)?.url === url, 'the address is in the account\'s record');
        assert.equal(JSON.parse(readFileSync(config.storeFile, 'utf8')).accounts[account.id].host, host);
        const cal = m.state().calendars.find((c) => c.accountId === account.id);
        assert.ok(m.store.calendars[cal.id].remoteId === 'feed', 'the feed\'s calendar has a fixed remote id');
        assert.equal(cal.readOnly, true);
        const list = m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences;
        assert.deepEqual(list.map((o) => o.title), ['Holiday', 'Webinar']);
        assert.equal(list[1].startLocal, '2026-11-04T18:00');
        assert.equal(list[1].endLocal, '2026-11-04T20:00');
        assert.ok(list.every((o) => o.readOnly));
        await assert.rejects(m.updateEvent(list[0].id, { title: 'x' }), /read only/);
        await assert.rejects(m.deleteEvent(list[0].id), /read only/);
        assert.throws(() => m.setDefaultCalendar(cal.id), /can't be written/);
        await m.syncAccount(account.id);
        assert.equal(hits, 2);
        assert.equal(m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.length, 2, 'a 304 changes nothing');
        await hiddenEverywhere(m);

        // A failed fetch: the window's message names the host only, and agents get a fixed category, never the message.
        answer = 500;
        await m.syncAccount(account.id);
        const failed = m.state().calendars.find((c) => c.id === cal.id);
        hidden(failed.error, 'the calendar\'s error');
        assert.equal(failed.error, `Reading the calendar at ${host}: the server answered HTTP 500.`);
        assert.equal(failed.problem, 'server error');
        const listed = await listCalendars(m);
        hidden(JSON.stringify(listed), 'calendar_list_calendars');
        assert.match(listed.text, /^- Holidays · Holidays · read only · problem: server error {2}\[id cal-/m);
        assert.ok(!('error' in listed.view.calendars.find((c) => c.id === cal.id)), 'the chat card has no message');
        await hiddenEverywhere(m);
        // Told to wait, the account has a problem too.
        answer = 429;
        await m.syncAccount(account.id);
        await hiddenEverywhere(m);
        const waiting = m.state().accounts.find((a) => a.id === account.id);
        assert.equal(waiting.status, 'error');
        assert.equal(waiting.problem, 'rate limited');
        assert.match((await listCalendars(m)).text, /\nAccounts with problems:\n- Holidays: rate limited$/);
        answer = 200;
        await m.syncAccount(account.id);
        assert.equal(m.state().calendars.find((c) => c.id === cal.id).error, undefined);
        assert.equal(m.state().accounts.find((a) => a.id === account.id).status, 'ok');

        // The feed drops an event.
        body = body.replace(/BEGIN:VEVENT\r\nUID:h2@test[\s\S]*?END:VEVENT\r\n/, '');
        await m.syncAccount(account.id);
        assert.deepEqual(m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.map((o) => o.title), ['Holiday']);
        const ids = m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.map((o) => o.id);
        m.dispose();

        // The next start reads the files (same calendars, same ids), and the feed from the address in its record.
        m = make();
        await m.start();
        assert.deepEqual(m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.map((o) => o.id), ids);
        const before = hits;
        await m.syncAccount(account.id);
        assert.ok(hits > before, 'fetched from the address in its record');
        await hiddenEverywhere(m);
        assert.equal(m.state().calendars.find((c) => c.id === cal.id).error, undefined);
        m.dispose();

        // A calendar.json from before the address moved to the record: it was the account's url, and the
        // calendar's remoteId (so its id too), and old errors named it. The next start moves it, once.
        const old = JSON.parse(readFileSync(config.storeFile, 'utf8'));
        const oldId = calendarIdOf(account.id, url);
        old.accounts[account.id] = { ...old.accounts[account.id], url, error: { code: 'rate', message: `Reading ${url}: the server asked to wait.`, at: NOW, until: NOW } };
        delete old.accounts[account.id].host;
        old.calendars[oldId] = { ...old.calendars[cal.id], id: oldId, remoteId: url, own: { name: 'Feiertage' }, error: { code: 'server', message: `Reading ${url}: the server answered HTTP 500.`, at: NOW } };
        delete old.calendars[cal.id];
        writeFileSync(config.storeFile, JSON.stringify(old));
        vault.delete(account.id);
        m = make();
        assert.ok(!('url' in m.state().accounts.find((a) => a.id === account.id)), 'before the move too, the window gets no url for a feed');
        await m.start();
        await hiddenEverywhere(m);
        assert.ok(vault.get(account.id)?.url === url, 'the address moved to the account\'s record');
        assert.equal(m.store.accounts[account.id].host, host);
        assert.deepEqual(m.state().calendars.filter((c) => c.accountId === account.id).map((c) => [c.id, c.name, c.error]), [[cal.id, 'Feiertage', undefined]],
            'the calendar has the feed\'s id again, with the user\'s name for it');
        await m.syncAccount(account.id);
        assert.deepEqual(m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.map((o) => o.title), ['Holiday'], 'its events come again');
        await hiddenEverywhere(m);
        m.dispose();
        m = make();
        await m.start();
        assert.equal(readFileSync(config.logFile, 'utf8').match(/address moved/g)?.length, 1, 'moved once');

        // Removing the account removes its record.
        await m.removeAccount(account.id);
        assert.equal(m.state().calendars.length, 1);
        assert.equal(vault.has(account.id), false);
        await assert.rejects(m.addAccount({ kind: 'ics', url: 'ftp://example.com/x.ics' }), /https/);
        // A feed that fails is refused in words that name the host only, and neither it nor its record is kept.
        const refused = await m.addAccount({ kind: 'ics', url: `http://${host}/calendar/ical/me%40example.com/${key}-gone/basic.ics?${query}` }).then(() => undefined, (error) => error);
        assert.ok(refused instanceof CalendarError, 'a feed that fails is refused');
        hidden(refused.message, 'the refusal');
        assert.equal(refused.message, `Reading the calendar at ${host}: the server has no such thing (any more).`);
        // Nothing answers at the address: the network's error names the host only too.
        const closed = createServer();
        await new Promise((r) => closed.listen(0, '127.0.0.1', r));
        const nobody = `127.0.0.1:${closed.address().port}`;
        await new Promise((r) => closed.close(r));
        const unreachable = await m.addAccount({ kind: 'ics', url: `http://${nobody}${path}` }).then(() => undefined, (error) => error);
        assert.ok(unreachable instanceof CalendarError, 'a feed nobody answers for is refused');
        hidden(unreachable.message, 'the refusal');
        assert.equal(unreachable.message, `Couldn't reach ${nobody}: the connection was refused`);
        assert.equal(m.state().accounts.length, 1, 'a feed that fails is not kept');
        assert.equal(vault.size, 0, 'nor its record');
        await hiddenEverywhere(m);
    } finally {
        m.dispose();
        done();
    }
});

// ── Guests and email ───────────────────────────────────────────────────

/**
 * A stand-in source for an account added to the store by hand: CalDAV-like
 * ('ics': iCalendar text, put and remove) or Google/Microsoft-like
 * ('events': create, update, remove, respond). Every call is noted.
 */
function standIn(m, account, calendar, style) {
    const calls = [];
    let n = 0;
    const source = style === 'ics' ? {
        async put(_calendar, item, raw, uid) {
            calls.push({ op: 'put', raw, item: item?.remoteId });
            return { remoteId: item?.remoteId ?? `${calendar.remoteId}${uid}.ics`, etag: `"e${++n}"` };
        },
        async remove(_calendar, item, opts = {}) {
            calls.push({ op: 'remove', item: item?.remoteId, ...opts });
        },
        async sync(_calendar, state) { return { reset: false, items: [], removed: [], state: state ?? {} }; },
    } : {
        async create(_calendar, record) {
            calls.push({ op: 'create', record });
            const uid = `${account.kind}-${++n}`;
            const { notify: _notify, ...kept } = record;
            return [{ remoteId: uid, events: [{ ...kept, uid, organizer: { email: account.email, self: true } }] }];
        },
        async update(_calendar, target, patch, scope) {
            calls.push({ op: 'update', patch, scope });
            return [];
        },
        async remove(_calendar, target, scope) {
            calls.push({ op: 'remove', notify: target.notify === true, scope });
            return { removed: [target.item.remoteId], items: [] };
        },
        async respond(_calendar, target, status, scope) {
            calls.push({ op: 'respond', status, scope });
            return [];
        },
        async sync(_calendar, state) { return { reset: false, items: [], removed: [], state: state ?? {} }; },
    };
    m.store.accounts[account.id] = { calendarsAt: NOW, ...account };
    m.store.calendars[calendar.id] = { readOnly: false, mode: 'masters', color: '#4f7cff', ...calendar, accountId: account.id };
    m.store.itemsOf(calendar.id);
    const previous = m.source.bind(m);
    m.source = async (a) => (a.id === account.id ? { style, source } : previous(a));
    m.changed();
    return calls;
}

/** An invitation from someone else, as a CalDAV server would hold it. */
function invitationIcs(uid, start) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z',
        `DTSTART;TZID=Europe/Berlin:${start}`, 'DURATION:PT1H', 'SUMMARY:Board review',
        'ORGANIZER;CN=Boss:mailto:boss@example.com', 'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:me@icloud.com',
        'ATTENDEE;PARTSTAT=ACCEPTED:mailto:ann@example.com', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
}

/** iCalendar text with its folded lines joined again. */
const unfold = (raw) => String(raw).replace(/\r\n[ \t]/g, '');

const refusedFor = (code, pattern) => (error) => error instanceof CalendarError && error.code === code && pattern.test(error.message);

test('CalDAV that schedules: a change that would email guests is made only when it says to tell them', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        const calls = standIn(m,
            { id: 'dav', kind: 'caldav', name: 'iCloud', url: 'https://caldav.icloud.com/', username: 'me@icloud.com', email: 'me@icloud.com', addresses: ['me@icloud.com'] },
            { id: 'cal-dav', remoteId: 'https://p52-caldav.icloud.com/1/calendars/home/', name: 'Home', scheduling: true }, 'ics');
        assert.equal(m.calendarView(m.calendar('cal-dav')).canEmail, true);

        // Guests without telling them: the server isn't asked to schedule (no organizer), and nobody is emailed.
        const quiet = await m.createEvent({ calendarId: 'cal-dav', title: 'Lunch', start: '2026-10-14T12:00', attendees: ['ann@example.com'] });
        assert.equal(quiet.emailed, undefined);
        assert.doesNotMatch(unfold(calls.at(-1).raw), /ORGANIZER/);
        assert.match(unfold(calls.at(-1).raw), /ATTENDEE.*ann@example\.com/);

        // Telling them names the user as the organizer, and the server sends the invitations.
        const meeting = await m.createEvent({ calendarId: 'cal-dav', title: 'Planning', start: '2026-10-15T10:00', attendees: ['ann@example.com', 'bob@example.com'], notify: true });
        assert.deepEqual(meeting.emailed, { what: 'invitations', to: ['ann@example.com', 'bob@example.com'] });
        assert.match(unfold(calls.at(-1).raw), /ORGANIZER:mailto:me@icloud\.com/);

        // Now the server emails its guests about every change: refused without notify, nothing sent to the server.
        const sent = calls.length;
        await assert.rejects(m.updateEvent(meeting.id, { start: '2026-10-15T11:00' }),
            refusedFor('needs-notify', /^This would email an update to ann@example\.com and bob@example\.com \(this calendar's server emails a meeting's guests itself\)/));
        await assert.rejects(m.deleteEvent(meeting.id), refusedFor('needs-notify', /a cancellation to ann@example\.com and bob@example\.com/));
        assert.equal(calls.length, sent);
        // The user's own reminders tell nobody anything.
        assert.equal((await m.updateEvent(meeting.id, { alarms: [15] })).emailed, undefined);
        const moved = await m.updateEvent(meeting.id, { start: '2026-10-15T11:00', notify: true });
        assert.deepEqual(moved.emailed, { what: 'an update', to: ['ann@example.com', 'bob@example.com'] });
        assert.equal(moved.startLocal, '2026-10-15T11:00');
        // A guest taken off is told too.
        const fewer = await m.updateEvent(meeting.id, { attendees: ['ann@example.com'], notify: true });
        assert.deepEqual(fewer.emailed.to, ['ann@example.com', 'bob@example.com']);

        // Someone else's invitation: taking it out doesn't decline it unless asked (Schedule-Reply: F).
        const items = m.store.itemsOf('cal-dav');
        items['https://p52-caldav.icloud.com/1/calendars/home/inv-1.ics'] = {
            remoteId: 'https://p52-caldav.icloud.com/1/calendars/home/inv-1.ics', etag: '"i1"', raw: invitationIcs('inv-1', '20261016T090000'),
            events: (await import('../lib/ical.js')).readIcs(invitationIcs('inv-1', '20261016T090000'), { zone: ZONE }).events,
        };
        m.changed();
        const invitation = week(m).find((o) => o.title === 'Board review');
        assert.equal(invitation.invitation, true);
        assert.equal(invitation.canRespond, true);
        await assert.rejects(m.updateEvent(invitation.id, { attendees: ['ann@example.com', 'eve@example.com'], notify: true }), /someone else's invitation: only its organizer changes who is invited/);
        await assert.rejects(m.moveEvent(invitation.id, m.defaultCalendarId() === 'cal-dav' ? m.state().calendars.find((c) => c.name === 'Personal').id : m.defaultCalendarId()), /someone else's invitation/);
        const answered = await m.respond(invitation.id, 'accepted');
        assert.deepEqual(answered.emailed, { what: 'the answer', to: ['boss@example.com'] });
        await assert.rejects(m.respond(invitation.id, 'declined', 'following'), /one occurrence \(one\) or the whole series \(all\)/);
        assert.deepEqual(await m.deleteEvent(invitation.id), {});
        assert.deepEqual(calls.at(-1), { op: 'remove', item: 'https://p52-caldav.icloud.com/1/calendars/home/inv-1.ics', scheduleReply: false });

        // Many guests: five by name, then how many more.
        const crowd = Array.from({ length: 7 }, (_, i) => `p${i + 1}@example.com`);
        const big = await m.createEvent({ calendarId: 'cal-dav', title: 'All hands', start: '2026-10-16T15:00', attendees: crowd, notify: true });
        await assert.rejects(m.deleteEvent(big.id), refusedFor('needs-notify', /to p1@example\.com, p2@example\.com, p3@example\.com, p4@example\.com, p5@example\.com and 2 more \(/));
        assert.deepEqual((await m.deleteEvent(big.id, 'all', 'window', { notify: true })).emailed.to, crowd);
        assert.equal(calls.at(-1).scheduleReply, undefined);

        // What the log keeps: counts, never addresses.
        const log = readFileSync(m.config.logFile, 'utf8');
        assert.match(log, /create cal-dav by=window people=2 mail=2/);
        assert.doesNotMatch(log, /@example\.com|@icloud\.com/);
    } finally {
        m.dispose();
        done();
    }
});

test('CalDAV that doesn\'t schedule, and calendars kept here: nothing is emailed, and a change that says to tell guests is refused', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        standIn(m, { id: 'rad', kind: 'caldav', name: 'Radicale', url: 'https://dav.example.com/', username: 'me', email: 'me@example.com' },
            { id: 'cal-rad', remoteId: 'https://dav.example.com/me/cal/', name: 'Cal', scheduling: false }, 'ics');
        assert.equal(m.calendarView(m.calendar('cal-rad')).canEmail, false);
        await assert.rejects(m.createEvent({ calendarId: 'cal-rad', title: 'X', start: '2026-10-14T12:00', attendees: ['ann@example.com'], notify: true }),
            /This calendar's server doesn't email guests\. Save it without telling them, and tell them another way\./);
        const ev = await m.createEvent({ calendarId: 'cal-rad', title: 'X', start: '2026-10-14T12:00', attendees: ['ann@example.com'] });
        assert.equal((await m.updateEvent(ev.id, { start: '2026-10-14T13:00' })).emailed, undefined);

        const personal = m.state().calendars.find((c) => c.name === 'Personal');
        assert.equal(personal.canEmail, false);
        const local = await m.createEvent({ calendarId: personal.id, title: 'Y', start: '2026-10-14T12:00', attendees: ['ann@example.com'] });
        await assert.rejects(m.deleteEvent(local.id, 'all', 'window', { notify: true }), /Calendars kept in DSH can't email anyone/);
        // Without guests, telling them is nothing to refuse.
        const alone = await m.createEvent({ calendarId: personal.id, title: 'Z', start: '2026-10-14T15:00', notify: true });
        assert.equal(alone.emailed, undefined);
    } finally {
        m.dispose();
        done();
    }
});

test('Microsoft and Google: Microsoft emails a meeting\'s guests about every change, Google only when told', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        const ms = standIn(m, { id: 'ms', kind: 'microsoft', name: 'Outlook', email: 'me@outlook.com' }, { id: 'cal-ms', remoteId: 'AAA', name: 'Calendar' }, 'events');
        await assert.rejects(m.createEvent({ calendarId: 'cal-ms', title: 'Sync', start: '2026-10-14T12:00', attendees: ['ann@example.com'] }),
            refusedFor('needs-notify', /invitations to ann@example\.com \(Microsoft invites the guests as soon as an event with them is saved\)/));
        assert.equal(ms.length, 0);
        const sync = await m.createEvent({ calendarId: 'cal-ms', title: 'Sync', start: '2026-10-14T12:00', attendees: ['ann@example.com'], notify: true });
        assert.equal(ms.at(-1).record.notify, true);
        assert.deepEqual(sync.emailed, { what: 'invitations', to: ['ann@example.com'] });
        await assert.rejects(m.updateEvent(sync.id, { title: 'Sync (moved)' }), refusedFor('needs-notify', /an update to ann@example\.com \(Microsoft emails a meeting's guests about each change to it\)/));
        await m.updateEvent(sync.id, { title: 'Sync (moved)', notify: true });
        assert.equal(ms.at(-1).patch.notify, true);
        await assert.rejects(m.deleteEvent(sync.id), refusedFor('needs-notify', /a cancellation to ann@example\.com \(Microsoft emails a meeting's guests when it is cancelled\)/));
        // An event of the user's own with no one else on it: nothing to tell.
        const solo = await m.createEvent({ calendarId: 'cal-ms', title: 'Focus', start: '2026-10-14T15:00' });
        assert.deepEqual(await m.deleteEvent(solo.id), {});

        const google = standIn(m, { id: 'g', kind: 'google', name: 'Google', email: 'me@gmail.com' }, { id: 'cal-g', remoteId: 'primary', name: 'Me' }, 'events');
        const lunch = await m.createEvent({ calendarId: 'cal-g', title: 'Lunch', start: '2026-10-15T12:00', attendees: ['ann@example.com'] });
        assert.equal(google.at(-1).record.notify, undefined, 'Google is told not to email');
        assert.equal(lunch.emailed, undefined);
        assert.equal((await m.updateEvent(lunch.id, { start: '2026-10-15T13:00' })).emailed, undefined);
        assert.deepEqual((await m.updateEvent(lunch.id, { start: '2026-10-15T12:30', notify: true })).emailed, { what: 'an update', to: ['ann@example.com'] });
        assert.equal(google.at(-1).patch.notify, true);
        assert.deepEqual(await m.deleteEvent(lunch.id, 'all', 'window', { notify: true }), { emailed: { what: 'a cancellation', to: ['ann@example.com'] } });
        assert.equal(google.at(-1).notify, true);
    } finally {
        m.dispose();
        done();
    }
});

test('moving: only a whole event or series, on its own; a meeting moved is a new one for its guests', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        const work = await m.createCalendar({ name: 'Work' });
        const personal = m.state().calendars.find((c) => c.name === 'Personal');
        await m.createEvent({ title: 'Gym', start: '2026-10-12T18:00', repeat: 'FREQ=DAILY;COUNT=5', calendarId: personal.id });
        const gym = () => week(m).filter((o) => o.title === 'Gym');
        const second = gym()[1];
        await assert.rejects(m.updateEvent(second.id, { calendarId: work.id, start: '2026-10-13T19:00' }, 'one'), /Only a whole event or series moves to another calendar/);
        await assert.rejects(m.updateEvent(second.id, { calendarId: work.id }, 'following'), /Only a whole event or series moves/);
        await assert.rejects(m.updateEvent(second.id, { calendarId: work.id, title: 'Gym!' }, 'all'), /Move the event to the other calendar on its own first, then change it there\./);
        assert.equal(gym().length, 5);
        assert.ok(gym().every((o) => o.calendarId === personal.id), 'nothing moved, nothing lost');
        const moved = await m.updateEvent(second.id, { calendarId: work.id }, 'all');
        assert.equal(moved.calendarId, work.id);
        assert.equal(gym().length, 5);
        assert.ok(gym().every((o) => o.calendarId === work.id));

        // A meeting with guests moved to a server that schedules: its guests get a new invitation, so it says to tell them.
        const calls = standIn(m, { id: 'dav', kind: 'caldav', name: 'iCloud', url: 'https://caldav.icloud.com/', username: 'me@icloud.com', email: 'me@icloud.com' },
            { id: 'cal-dav', remoteId: 'https://p52-caldav.icloud.com/1/calendars/home/', name: 'Home', scheduling: true }, 'ics');
        const party = await m.createEvent({ title: 'Party', start: '2026-10-17T19:00', calendarId: personal.id, attendees: ['ann@example.com'] });
        await assert.rejects(m.updateEvent(party.id, { calendarId: 'cal-dav' }),
            refusedFor('needs-notify', /^This would email invitations to ann@example\.com \(a meeting moved to another calendar is a new meeting for its guests\)/));
        assert.equal(calls.length, 0);
        const there = await m.updateEvent(party.id, { calendarId: 'cal-dav', notify: true });
        assert.equal(there.calendarId, 'cal-dav');
        assert.deepEqual(there.emailed, { what: 'invitations', to: ['ann@example.com'] });
        assert.match(unfold(calls.at(-1).raw), /ORGANIZER:mailto:me@icloud\.com/);
        assert.equal(week(m).filter((o) => o.title === 'Party').length, 1, 'gone from Personal');
    } finally {
        m.dispose();
        done();
    }
});

test('a change decided on the event as it was is not tried again after the event changed on its server', async () => {
    const { make, done } = setup();
    const m = make();
    try {
        await m.start();
        const calls = standIn(m, { id: 'dav', kind: 'caldav', name: 'Fastmail', url: 'https://caldav.fastmail.com/', username: 'me@fastmail.com', email: 'me@fastmail.com' },
            { id: 'cal-dav', remoteId: 'https://caldav.fastmail.com/dav/calendars/user/me/Default/', name: 'Default', scheduling: true }, 'ics');
        const ev = await m.createEvent({ calendarId: 'cal-dav', title: 'Haircut', start: '2026-10-16T17:00' });
        const { SourceError } = await import('../lib/sources/index.js');
        const source = (await m.source(m.store.accounts.dav)).source;
        const put = source.put;
        let refusals = 0;
        source.put = async (...args) => {
            if (refusals++ === 0) throw new SourceError('conflict', 'The event changed on the server meanwhile.');
            return put(...args);
        };
        await assert.rejects(m.updateEvent(ev.id, { start: '2026-10-16T18:00' }), /changed on its server meanwhile \(in another app, or by someone else\), so nothing was done/);
        assert.equal(refusals, 1, 'not tried again');
        // A change that doesn't depend on the time still is.
        refusals = 0;
        const renamed = await m.updateEvent(ev.id, { title: 'Haircut (Main St)' });
        assert.equal(renamed.title, 'Haircut (Main St)');
        assert.equal(refusals, 2);
        assert.ok(calls.length >= 2);
    } finally {
        m.dispose();
        done();
    }
});
