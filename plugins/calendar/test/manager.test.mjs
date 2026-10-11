/**
 * The manager on calendars kept on this computer and a subscribed feed:
 * adding, reading, changing (one occurrence, this and the following ones,
 * the whole series), moving, deleting, answering, searching, free time,
 * export and import, and a restart that keeps everything.
 *
 *   node --test plugins/calendar/test/manager.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalendarError, CalendarManager } from '../lib/manager.js';

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

test('a subscribed feed is read only, follows its ETag, and survives a restart', async (t) => {
    let hits = 0;
    let body = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//Feed//EN', 'X-WR-CALNAME:Holidays', 'X-WR-TIMEZONE:Europe/Berlin',
        'BEGIN:VEVENT', 'UID:h1@test', 'DTSTAMP:20260101T000000Z', 'DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261104', 'SUMMARY:Holiday', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:h2@test', 'DTSTAMP:20260101T000000Z', 'DTSTART:20261104T170000Z', 'DURATION:PT2H', 'SUMMARY:Webinar', 'END:VEVENT',
        'END:VCALENDAR', '',
    ].join('\r\n');
    const server = createServer((req, res) => {
        if (req.url !== '/feed.ics') {
            res.writeHead(404);
            return res.end('not here');
        }
        hits++;
        if (req.headers['if-none-match'] === '"v1"' && body.includes('Webinar')) {
            res.writeHead(304);
            return res.end();
        }
        res.writeHead(200, { 'content-type': 'text/calendar', etag: '"v1"' });
        res.end(body);
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    t.after(() => server.close());
    const url = `http://127.0.0.1:${server.address().port}/feed.ics`;
    const { make, done } = setup();
    let m = make();
    try {
        await m.start();
        const account = await m.addAccount({ kind: 'ics', url });
        assert.equal(account.name, 'Holidays', 'named by the feed');
        const cal = m.state().calendars.find((c) => c.accountId === account.id);
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
        // The feed drops an event.
        body = body.replace(/BEGIN:VEVENT\r\nUID:h2@test[\s\S]*?END:VEVENT\r\n/, '');
        await m.syncAccount(account.id);
        assert.deepEqual(m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.map((o) => o.title), ['Holiday']);
        const ids = m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.map((o) => o.id);
        m.dispose();

        // The next start reads the files: same calendars, same ids.
        m = make();
        await m.start();
        assert.deepEqual(m.events({ from: at('2026-11-01T00:00'), to: at('2026-11-08T00:00') }).occurrences.map((o) => o.id), ids);
        await m.removeAccount(account.id);
        assert.equal(m.state().calendars.length, 1);
        await assert.rejects(m.addAccount({ kind: 'ics', url: 'ftp://example.com/x.ics' }), /https/);
        await assert.rejects(m.addAccount({ kind: 'ics', url: `http://127.0.0.1:${server.address().port}/missing` }), CalendarError);
        assert.equal(m.state().accounts.length, 1, 'a feed that fails is not kept');
    } finally {
        m.dispose();
        done();
    }
});
