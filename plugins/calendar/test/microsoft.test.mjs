// The Microsoft source (lib/sources/microsoft.js) against the Graph and
// sign-in stand-in (test/standins/microsoft.mjs). Run with:
//   node --test plugins/calendar/test/microsoft.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from '../lib/http.js';
import { SourceError } from '../lib/sources/index.js';
import { create, graphZone, htmlToText, kind, patternFromRrule, rruleFromPattern, signIn, style } from '../lib/sources/microsoft.js';
import { start } from './standins/microsoft.mjs';

const ZONE = 'America/Los_Angeles';
const ACCOUNT = { id: 'acct-ms', kind: 'microsoft', name: 'Work', email: 'robin@example.com' };
const NOW = Date.parse('2026-10-11T12:00:00Z');
const FROM = Date.parse('2026-10-11T00:00:00Z');
const TO = Date.parse('2026-10-25T00:00:00Z');
const NO_TIME = '0001-01-01T00:00:00Z';
const LA = (local) => ({ local, tz: ZONE });
const pst = (dateTime) => ({ dateTime, timeZone: 'Pacific Standard Time' });

/** A secret as DSH's credential store hands it to a source. */
function memorySecret(value) {
    const secret = {
        value,
        sets: 0,
        get: async () => secret.value,
        set: async (next) => {
            secret.value = next;
            secret.sets += 1;
        },
        clear: async () => {
            secret.value = undefined;
        },
    };
    return secret;
}

/** A stand-in, an env signed in to it, and a source for the account. */
async function setup(t, { signedIn = true } = {}) {
    const graph = await start();
    t.after(() => graph.close());
    const logs = [];
    const clock = { now: NOW };
    const secret = memorySecret(signedIn ? { ...graph.store.issueGrant(), expiresAt: NOW + 3_600_000 } : undefined);
    const env = {
        request: (url, init) => request(url, init),
        secret,
        log: (line) => logs.push(line),
        now: () => clock.now,
        zone: ZONE,
        settings: { ...graph.settings },
    };
    return { graph, store: graph.store, env, secret, logs, clock, source: create(ACCOUNT, env) };
}

/** A weekly series on Mondays and Wednesdays, 9:30 to 10:00 Pacific, from Monday 2026-10-05. */
function weeklySeries(store, calendarId, extra = {}) {
    return store.addEvent(calendarId, {
        subject: 'Team sync',
        start: pst('2026-10-05T09:30:00'),
        end: pst('2026-10-05T10:00:00'),
        recurrence: {
            pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'wednesday'], firstDayOfWeek: 'sunday' },
            range: { type: 'noEnd', startDate: '2026-10-05' },
        },
        ...extra,
    });
}

const byTitle = (items, title) => items.find((i) => i.events[0].title === title);
const byId = (items, id) => items.find((i) => i.remoteId === id);
const isSourceError = (code) => (error) => error instanceof SourceError && error.code === code;

test('the module is the microsoft events source', () => {
    assert.equal(kind, 'microsoft');
    assert.equal(style, 'events');
    for (const fn of [create, signIn, rruleFromPattern, patternFromRrule]) assert.equal(typeof fn, 'function');
    const source = create(ACCOUNT, { request, secret: memorySecret(), now: Date.now, zone: ZONE, settings: {} });
    for (const name of ['calendars', 'sync', 'create', 'update', 'remove', 'respond']) assert.equal(typeof source[name], 'function', name);
});

// ── Sign-in ────────────────────────────────────────────────────────────

test('device code sign-in: pending twice, then the grant and who signed in', async (t) => {
    const graph = await start();
    t.after(() => graph.close());
    const env = { request: (url, init) => request(url, init), now: () => Date.now(), zone: ZONE, settings: graph.settings, log() {} };
    const before = Date.now();
    const flow = await signIn(env);
    assert.match(flow.userCode, /^[0-9A-F]{9}$/);
    assert.equal(flow.verificationUri, 'https://microsoft.com/devicelogin');
    assert.ok(flow.message.includes(flow.userCode));
    assert.ok(flow.expiresAt >= before + 900_000 && flow.expiresAt <= Date.now() + 900_000);
    assert.equal(typeof flow.cancel, 'function');

    const { grant, email, name } = await flow.done;
    assert.equal(email, 'robin@example.com');
    assert.equal(name, 'Robin Park');
    assert.ok(graph.store.accessTokens.has(grant.accessToken));
    assert.ok(graph.store.refreshTokens.has(grant.refreshToken));
    assert.ok(grant.expiresAt > before + 3_500_000 && grant.expiresAt <= Date.now() + 3_599_000);
    assert.equal(grant.scope, 'Calendars.ReadWrite User.Read');
    assert.deepEqual(Object.keys(grant).sort(), ['accessToken', 'expiresAt', 'refreshToken', 'scope']);
    // Two answers of authorization_pending, then the grant; never faster than the interval.
    assert.equal(graph.store.counts.devicePolls, 3);
    assert.equal(graph.store.counts.tooFast, 0);

    const [code] = graph.store.requestsTo('/oauth2/v2.0/devicecode', 'POST');
    assert.equal(code.path, '/login/common/oauth2/v2.0/devicecode');
    assert.deepEqual(code.body, { client_id: 'stand-in-client-id', scope: 'offline_access Calendars.ReadWrite User.Read' });
    const polls = graph.store.requestsTo('/login/common/oauth2/v2.0/token', 'POST');
    assert.equal(polls.length, 3);
    for (const poll of polls) assert.equal(poll.body.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
    assert.equal(graph.store.requestsTo('/v1.0/me', 'GET').length, 1);
});

test('device code sign-in: the address falls back to the user principal name, and the tenant setting is used', async (t) => {
    const graph = await start();
    t.after(() => graph.close());
    graph.store.user.mail = null;
    graph.store.user.userPrincipalName = 'robin@contoso.example';
    const env = { request: (url, init) => request(url, init), now: () => Date.now(), zone: ZONE, settings: { ...graph.settings, microsoftTenant: 'organizations' } };
    const flow = await signIn(env);
    const { email } = await flow.done;
    assert.equal(email, 'robin@contoso.example');
    assert.deepEqual([...new Set(graph.store.tenants)], ['organizations']);
});

test('device code sign-in: declined, run out, stopped, or no app to sign in with', async (t) => {
    const graph = await start();
    t.after(() => graph.close());
    const env = { request: (url, init) => request(url, init), now: () => Date.now(), zone: ZONE, settings: graph.settings };

    graph.store.devicePlan = ['authorization_pending', 'authorization_declined'];
    let flow = await signIn(env);
    await assert.rejects(flow.done, (e) => isSourceError('auth')(e) && /declined/.test(e.message));

    graph.store.devicePlan = ['expired_token'];
    flow = await signIn(env);
    await assert.rejects(flow.done, (e) => isSourceError('auth')(e) && /ran out/.test(e.message));

    // The code runs out on this side too, without asking Microsoft again.
    graph.store.devicePlan = ['authorization_pending'];
    const polls = graph.store.counts.devicePolls;
    let calls = 0;
    flow = await signIn({ ...env, now: () => (calls++ === 0 ? Date.now() : Date.now() + 1_000_000_000) });
    await assert.rejects(flow.done, (e) => isSourceError('auth')(e) && /ran out/.test(e.message));
    assert.equal(graph.store.counts.devicePolls, polls);

    // Pending for ever, until the user stops it.
    flow = await signIn(env);
    while (graph.store.counts.devicePolls === polls) await new Promise((resolve) => setTimeout(resolve, 5));
    flow.cancel();
    await assert.rejects(flow.done, (e) => isSourceError('auth')(e) && /stopped/.test(e.message));

    // An app id Microsoft doesn't know, and none at all.
    await assert.rejects(signIn({ ...env, settings: { ...graph.settings, microsoftClientId: 'not-registered' } }), isSourceError('config'));
    const { microsoftClientId, ...noApp } = graph.settings;
    await assert.rejects(signIn({ ...env, settings: noApp }), (e) => isSourceError('config')(e) && /microsoftClientId/.test(e.message));
    assert.equal(typeof microsoftClientId, 'string');
});

test('device code sign-in: a dropped connection or a busy server while polling only slows it down', async (t) => {
    const graph = await start();
    t.after(() => graph.close());
    const env = { request: (url, init) => request(url, init), now: () => Date.now(), zone: ZONE, settings: graph.settings };
    graph.store.devicePlan = ['authorization_pending', 'grant'];
    graph.store.failNext({ path: '/oauth2/v2.0/token', drop: true });
    graph.store.failNext({ path: '/oauth2/v2.0/token', status: 503, headers: { 'Retry-After': '1' } });
    const flow = await signIn(env);
    const { email } = await flow.done;
    assert.equal(email, 'robin@example.com');
    // Two failed polls, then the plan: pending, then the grant.
    assert.equal(graph.store.requestsTo('/oauth2/v2.0/token', 'POST').length, 4);
    assert.equal(graph.store.counts.tooFast, 0);
});

test('device code sign-in: slow_down waits five seconds longer', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const answers = [
        [200, { device_code: 'device', user_code: 'B7K2LMQPX', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 1, message: 'Open the page.' }],
        [400, { error: 'slow_down', error_description: 'AADSTS70016: slow down' }],
        [400, { error: 'authorization_pending', error_description: 'AADSTS70016: pending' }],
        [200, { token_type: 'Bearer', access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'Calendars.ReadWrite User.Read' }],
        [200, { displayName: 'Robin Park', mail: 'robin@example.com', userPrincipalName: 'robin@example.com' }],
    ];
    const stub = async (url, init) => {
        calls.push({ url, init });
        const [status, body] = answers.shift();
        const text = JSON.stringify(body);
        return { status, ok: status < 300, url, headers: new Headers(), text, json: () => JSON.parse(text) };
    };
    const flow = await signIn({ request: stub, now: () => NOW, zone: ZONE, settings: { microsoftClientId: 'app' } });
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const tick = async (ms) => {
        t.mock.timers.tick(ms);
        await settle();
        await settle();
    };
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://login.microsoftonline.com/common/oauth2/v2.0/devicecode');
    await tick(999);
    assert.equal(calls.length, 1);
    await tick(1);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://login.microsoftonline.com/common/oauth2/v2.0/token');
    // slow_down: the interval is now 1 + 5 seconds.
    await tick(5999);
    assert.equal(calls.length, 2);
    await tick(1);
    assert.equal(calls.length, 3);
    await tick(5999);
    assert.equal(calls.length, 3);
    await tick(1);
    const result = await flow.done;
    assert.equal(calls.length, 5);
    assert.equal(calls[4].url, 'https://graph.microsoft.com/v1.0/me');
    assert.equal(calls[4].init.headers.Authorization, 'Bearer access');
    assert.deepEqual(result, {
        grant: { accessToken: 'access', refreshToken: 'refresh', expiresAt: NOW + 3_600_000, scope: 'Calendars.ReadWrite User.Read' },
        email: 'robin@example.com',
        name: 'Robin Park',
    });
});

// ── Tokens ─────────────────────────────────────────────────────────────

test('refresh: renews before the token runs out, saves the rotated grant, one renewal at a time', async (t) => {
    const { store, source, secret, clock, env } = await setup(t);
    store.addCalendar({ name: 'Work' });
    const first = { ...secret.value, expiresAt: NOW + 60_000 };
    secret.value = first;
    await source.calendars();
    assert.equal(store.counts.refreshes, 1);
    assert.equal(secret.sets, 1);
    assert.notEqual(secret.value.accessToken, first.accessToken);
    assert.notEqual(secret.value.refreshToken, first.refreshToken);
    assert.equal(secret.value.expiresAt, NOW + 3_599_000);
    // Rotation: the old refresh token is spent; the saved one is the one that works.
    assert.ok(!store.refreshTokens.has(first.refreshToken));
    assert.ok(store.refreshTokens.has(secret.value.refreshToken));
    const [renewal] = store.requestsTo('/oauth2/v2.0/token', 'POST');
    assert.equal(renewal.body.grant_type, 'refresh_token');
    assert.equal(renewal.body.client_id, 'stand-in-client-id');
    assert.equal(renewal.body.scope, 'offline_access Calendars.ReadWrite User.Read');
    // The calendars were asked for with the new token.
    assert.equal(store.requestsTo('/v1.0/me/calendars', 'GET').length, 1);

    // Three calls with a token about to run out: one renewal.
    clock.now = secret.value.expiresAt - 30_000;
    await Promise.all([source.calendars(), source.calendars(), source.calendars()]);
    assert.equal(store.counts.refreshes, 2);
    assert.equal(secret.sets, 2);

    // Plenty of time left: no renewal.
    clock.now = secret.value.expiresAt - 10 * 60_000;
    await source.calendars();
    assert.equal(store.counts.refreshes, 2);

    // Two sources for one account share the renewal: the rotated refresh token is spent once.
    const other = create(ACCOUNT, env);
    clock.now = secret.value.expiresAt - 30_000;
    await Promise.all([source.calendars(), other.calendars()]);
    assert.equal(store.counts.refreshes, 3);
    assert.ok(store.refreshTokens.has(secret.value.refreshToken));
});

test('refresh: a refresh token Microsoft turned down means signing in again', async (t) => {
    const { store, source, secret } = await setup(t);
    store.addCalendar({ name: 'Work' });
    store.revokeRefreshTokens();
    secret.value = { ...secret.value, expiresAt: NOW - 1 };
    await assert.rejects(source.calendars(), isSourceError('auth'));
    assert.equal(secret.sets, 0);
    secret.value = undefined;
    await assert.rejects(source.calendars(), isSourceError('auth'));
});

test('a 401 renews the sign-in once and tries again', async (t) => {
    const { store, source, secret } = await setup(t);
    store.addCalendar({ name: 'Work' });
    const before = secret.value;
    store.revokeAccessTokens();
    assert.equal((await source.calendars()).length, 1);
    assert.equal(store.counts.refreshes, 1);
    assert.equal(store.requestsTo('/v1.0/me/calendars', 'GET').length, 2);
    assert.notEqual(secret.value.refreshToken, before.refreshToken);

    // Two calls turned down at once: still one renewal.
    store.revokeAccessTokens();
    await Promise.all([source.calendars(), source.calendars()]);
    assert.equal(store.counts.refreshes, 2);

    // Turned down again after renewing: sign in again.
    store.failNext({ path: '/v1.0/me/calendars', status: 401, times: 2 });
    await assert.rejects(source.calendars(), isSourceError('auth'));
    assert.equal(store.counts.refreshes, 3);
});

// ── Calendars ──────────────────────────────────────────────────────────

test('calendars: every page, with colors, read-only ones and instances mode', async (t) => {
    const { store, source } = await setup(t);
    store.pageSize = 2;
    const main = store.addCalendar({ name: 'Calendar', hexColor: '#E74856', isDefaultCalendar: true });
    const family = store.addCalendar({ name: 'Family', color: 'lightTeal' });
    const holidays = store.addCalendar({ name: 'Holidays', color: 'auto', canEdit: false });
    assert.deepEqual(await source.calendars(), [
        { remoteId: main, name: 'Calendar', color: '#e74856', readOnly: false, mode: 'instances' },
        { remoteId: family, name: 'Family', color: '#6fcfcf', readOnly: false, mode: 'instances' },
        { remoteId: holidays, name: 'Holidays', readOnly: true, mode: 'instances' },
    ]);
    assert.equal(store.requestsTo('/v1.0/me/calendars', 'GET').length, 2);
});

// ── Sync ───────────────────────────────────────────────────────────────

test('sync: a first round reads the window, then a delta brings a change and a removal', async (t) => {
    const { store, source } = await setup(t);
    store.pageSize = 3;
    const cal = store.addCalendar({ name: 'Work' });
    const review = store.addEvent(cal, {
        subject: 'Design review',
        body: { contentType: 'html', content: '<html><body><div>Slides: <b>v2</b> &amp; notes</div><div><br></div><div>Room 4</div></body></html>' },
        start: { dateTime: '2026-10-13T15:00:00', timeZone: 'W. Europe Standard Time' },
        end: { dateTime: '2026-10-13T16:00:00', timeZone: 'W. Europe Standard Time' },
        location: { displayName: 'Room 4' },
        showAs: 'tentative',
        sensitivity: 'private',
        isReminderOn: true,
        reminderMinutesBeforeStart: 10,
        categories: ['Blue category'],
        organizer: { emailAddress: { name: 'Ana Silva', address: 'ana@example.com' } },
        isOrganizer: false,
        responseStatus: { response: 'notResponded', time: NO_TIME },
        onlineMeeting: { joinUrl: 'https://teams.example.com/l/meetup-join/19%3ameeting' },
        attendees: [
            { type: 'required', status: { response: 'none', time: NO_TIME }, emailAddress: { name: 'Robin Park', address: 'robin@example.com' } },
            { type: 'optional', status: { response: 'tentativelyAccepted', time: NO_TIME }, emailAddress: { name: 'Lee Chen', address: 'lee@example.com' } },
            { type: 'resource', status: { response: 'accepted', time: NO_TIME }, emailAddress: { name: 'Room 4', address: 'room4@example.com' } },
            { type: 'required', status: { response: 'declined', time: NO_TIME }, emailAddress: { name: 'kim@example.com', address: 'kim@example.com' } },
        ],
    });
    const offsite = store.addEvent(cal, {
        subject: 'Offsite', isAllDay: true, showAs: 'free', isReminderOn: false,
        start: pst('2026-10-15T00:00:00'), end: pst('2026-10-17T00:00:00'),
    });
    const series = weeklySeries(store, cal, { body: { contentType: 'text', content: 'Notes\r\nas text' } });
    store.updateEvent(store.occurrenceId(series, '2026-10-14'), { start: pst('2026-10-14T11:00:00'), end: pst('2026-10-14T11:30:00') });
    store.deleteEvent(store.occurrenceId(series, '2026-10-19'));
    const custom = store.addEvent(cal, {
        subject: 'Old Outlook zone', start: { dateTime: '2026-10-20T08:00:00', timeZone: 'Eastern Standard Time' },
        end: { dateTime: '2026-10-20T09:00:00', timeZone: 'Eastern Standard Time' },
        originalStartTimeZone: 'tzone://Microsoft/Custom', originalEndTimeZone: 'tzone://Microsoft/Custom',
    });
    const utc = store.addEvent(cal, {
        subject: 'UTC call', start: { dateTime: '2026-10-21T12:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-10-21T12:30:00', timeZone: 'UTC' },
        originalStartTimeZone: 'tzone://Microsoft/Utc', originalEndTimeZone: 'tzone://Microsoft/Utc',
    });
    const cancelled = store.addEvent(cal, {
        subject: 'Canceled: Planning', isCancelled: true, start: pst('2026-10-22T14:00:00'), end: pst('2026-10-22T15:00:00'),
        organizer: { emailAddress: { name: 'Ana Silva', address: 'ana@example.com' } }, isOrganizer: false,
    });
    store.addEvent(cal, { subject: 'Later', start: pst('2026-11-20T10:00:00'), end: pst('2026-11-20T11:00:00') });

    const first = await source.sync({ remoteId: cal, name: 'Work' }, undefined, { from: FROM, to: TO });
    assert.equal(first.reset, true);
    assert.deepEqual(first.removed, []);
    assert.equal(first.state.from, '2026-10-11T00:00:00Z');
    assert.equal(first.state.to, '2026-10-25T00:00:00Z');
    assert.match(first.state.deltaLink, /\$deltatoken=/);
    const [opening, ...pages] = store.requestsTo('/calendarView/delta', 'GET');
    assert.equal(opening.path, `/v1.0/me/calendars/${cal}/calendarView/delta`);
    assert.equal(opening.query.startdatetime, '2026-10-11T00:00:00Z');
    assert.equal(opening.query.enddatetime, '2026-10-25T00:00:00Z');
    assert.equal(opening.prefer, 'outlook.timezone="UTC", odata.maxpagesize=100');
    assert.ok(pages.length >= 2, 'followed the next pages');
    for (const page of pages) assert.match(page.search, /^\?\$skiptoken=/);

    // Three occurrences of the series (one moved, one cancelled), and five single events.
    assert.equal(first.items.length, 8);
    assert.equal(byTitle(first.items, 'Later'), undefined);
    for (const item of first.items) assert.match(item.etag, /^W\/"/);

    const reviewJson = store.json(review);
    assert.deepEqual(byId(first.items, review).events, [{
        uid: reviewJson.iCalUId,
        title: 'Design review',
        description: 'Slides: v2 & notes\n\nRoom 4',
        location: 'Room 4',
        start: { local: '2026-10-13T15:00:00', tz: 'Europe/Berlin' },
        end: { local: '2026-10-13T16:00:00', tz: 'Europe/Berlin' },
        allDay: false,
        busy: true,
        privacy: 'private',
        organizer: { email: 'ana@example.com', name: 'Ana Silva' },
        attendees: [
            { email: 'robin@example.com', name: 'Robin Park', status: 'needs-action', role: 'required', self: true },
            { email: 'lee@example.com', name: 'Lee Chen', status: 'tentative', role: 'optional' },
            { email: 'room4@example.com', name: 'Room 4', status: 'accepted', role: 'non-participant' },
            { email: 'kim@example.com', status: 'declined', role: 'required' },
        ],
        alarms: [10],
        conference: 'https://teams.example.com/l/meetup-join/19%3ameeting',
        categories: ['Blue category'],
        created: reviewJson.createdDateTime,
        updated: reviewJson.lastModifiedDateTime,
    }]);

    const offsiteJson = store.json(offsite);
    assert.deepEqual(byId(first.items, offsite).events, [{
        uid: offsiteJson.iCalUId, title: 'Offsite', start: { date: '2026-10-15' }, end: { date: '2026-10-17' }, allDay: true, busy: false,
        created: offsiteJson.createdDateTime, updated: offsiteJson.lastModifiedDateTime,
    }]);

    // Occurrences: one item each, with the series' id, their original start and the series' UID.
    const seriesUid = store.json(series).iCalUId;
    const monday = byId(first.items, store.occurrenceId(series, '2026-10-12')).events[0];
    assert.deepEqual(
        { uid: monday.uid, title: monday.title, description: monday.description, start: monday.start, end: monday.end, recurrenceId: monday.recurrenceId, seriesRemoteId: monday.seriesRemoteId, rrule: monday.rrule },
        { uid: seriesUid, title: 'Team sync', description: 'Notes\r\nas text', start: LA('2026-10-12T09:30:00'), end: LA('2026-10-12T10:00:00'), recurrenceId: LA('2026-10-12T09:30:00'), seriesRemoteId: series, rrule: undefined },
    );
    const moved = byId(first.items, store.occurrenceId(series, '2026-10-14')).events[0];
    assert.deepEqual(moved.start, LA('2026-10-14T11:00:00'));
    assert.deepEqual(moved.recurrenceId, LA('2026-10-14T09:30:00'));
    assert.equal(moved.uid, seriesUid);
    assert.ok(byId(first.items, store.occurrenceId(series, '2026-10-21')));
    assert.equal(byId(first.items, store.occurrenceId(series, '2026-10-19')), undefined);

    // Zones: Outlook's made-up zone reads in the user's zone; UTC stays UTC.
    assert.deepEqual(byId(first.items, custom).events[0].start, LA('2026-10-20T05:00:00'));
    assert.deepEqual(byId(first.items, utc).events[0].start, { local: '2026-10-21T12:00:00', tz: 'UTC' });
    assert.equal(byId(first.items, cancelled).events[0].status, 'cancelled');

    // Behind the client's back: one change, one deletion, one occurrence cancelled.
    store.updateEvent(review, { subject: 'Design review (moved)', start: { dateTime: '2026-10-13T17:00:00', timeZone: 'W. Europe Standard Time' }, end: { dateTime: '2026-10-13T18:00:00', timeZone: 'W. Europe Standard Time' } });
    store.deleteEvent(offsite);
    store.deleteEvent(store.occurrenceId(series, '2026-10-21'));
    const second = await source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO });
    assert.equal(second.reset, false);
    assert.deepEqual(second.items.map((i) => i.remoteId), [review]);
    assert.equal(second.items[0].events[0].title, 'Design review (moved)');
    assert.deepEqual(second.items[0].events[0].start, { local: '2026-10-13T17:00:00', tz: 'Europe/Berlin' });
    assert.deepEqual(second.removed.sort(), [offsite, store.occurrenceId(series, '2026-10-21')].sort());
    assert.notEqual(second.state.deltaLink, first.state.deltaLink);
    const resumed = store.requestsTo('/calendarView/delta', 'GET').at(-1);
    assert.match(resumed.search, /^\?\$deltatoken=/);
    assert.equal(resumed.query.startdatetime, undefined);

    // Nothing changed: nothing comes.
    const third = await source.sync({ remoteId: cal }, second.state, { from: FROM, to: TO });
    assert.deepEqual([third.reset, third.items, third.removed], [false, [], []]);
});

test('sync: delta entries without their fields are read in full', async (t) => {
    const { store, source } = await setup(t);
    store.sparseDelta = true;
    const cal = store.addCalendar({ name: 'Work' });
    const id = store.addEvent(cal, { subject: 'Standup', start: pst('2026-10-12T09:00:00'), end: pst('2026-10-12T09:15:00') });
    const first = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    store.updateEvent(id, { subject: 'Standup (longer)', end: pst('2026-10-12T09:30:00') });
    const second = await source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO });
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].events[0].title, 'Standup (longer)');
    assert.deepEqual(second.items[0].events[0].end, LA('2026-10-12T09:30:00'));
    assert.equal(store.requestsTo(`/v1.0/me/events/${id}`, 'GET').length, 1);
});

test('sync: a new window starts over; the same day\'s window keeps the sync link', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    store.addEvent(cal, { subject: 'Week one', start: pst('2026-10-12T09:00:00'), end: pst('2026-10-12T10:00:00') });
    store.addEvent(cal, { subject: 'Week three', start: pst('2026-10-27T09:00:00'), end: pst('2026-10-27T10:00:00') });
    const first = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    assert.deepEqual(first.items.map((i) => i.events[0].title), ['Week one']);

    // Later the same day: the window widens to the same whole days, so the delta goes on.
    const same = await source.sync({ remoteId: cal }, first.state, { from: FROM + 5 * 3_600_000, to: TO - 3_600_000 });
    assert.equal(same.reset, false);

    // A week on: a new window, a new first round.
    const week = 7 * 86_400_000;
    const moved = await source.sync({ remoteId: cal }, same.state, { from: FROM + week, to: TO + week });
    assert.equal(moved.reset, true);
    assert.deepEqual(moved.items.map((i) => i.events[0].title), ['Week three']);
    assert.equal(moved.state.from, '2026-10-18T00:00:00Z');
    const opening = store.requestsTo('/calendarView/delta', 'GET').at(-1);
    assert.equal(opening.query.startdatetime, '2026-10-18T00:00:00Z');
    assert.equal(opening.query.enddatetime, '2026-11-01T00:00:00Z');
});

test('sync: a sync link Graph refuses (410, or 400 on the link) starts over', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    store.addEvent(cal, { subject: 'Standup', start: pst('2026-10-12T09:00:00'), end: pst('2026-10-12T09:15:00') });
    const first = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });

    store.expireDeltaTokens();
    const again = await source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO });
    assert.equal(again.reset, true);
    assert.equal(again.items.length, 1);

    store.refusal = { status: 400, code: 'ErrorInvalidSyncStateData' };
    store.expireDeltaTokens();
    const third = await source.sync({ remoteId: cal }, again.state, { from: FROM, to: TO });
    assert.equal(third.reset, true);
    assert.equal(third.items.length, 1);
});

test('sync: a page link to another site is not followed', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    store.failNext({ path: '/calendarView/delta', status: 200, body: { value: [], '@odata.nextLink': 'https://elsewhere.example.com/v1.0/me/calendarView/delta?$skiptoken=x' } });
    await assert.rejects(source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO }), isSourceError('server'));
    assert.equal(store.requestsTo('/calendarView/delta').length, 1);
});

// ── Changes ────────────────────────────────────────────────────────────

test('create: a timed event, with people, a reminder, privacy and free time', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const items = await source.create({ remoteId: cal }, {
        uid: 'made-here', title: 'Lunch with Sam', description: 'Bring the notes.\nAnd the plan.', location: 'Harry\'s Bar',
        start: LA('2026-10-20T12:00:00'), end: LA('2026-10-20T13:30:00'), allDay: false,
        busy: false, privacy: 'private', alarms: [10], categories: ['Green category'],
        attendees: [
            { email: 'sam@example.com', name: 'Sam Lee', role: 'required' },
            { email: 'kim@example.com', role: 'optional' },
            { email: 'robin@example.com', name: 'Robin Park', self: true },
        ],
        notify: true,
    });
    const [sent] = store.requestsTo(`/v1.0/me/calendars/${cal}/events`, 'POST');
    assert.deepEqual(sent.body, {
        subject: 'Lunch with Sam',
        body: { contentType: 'text', content: 'Bring the notes.\nAnd the plan.' },
        location: { displayName: 'Harry\'s Bar' },
        showAs: 'free',
        sensitivity: 'private',
        isReminderOn: true,
        reminderMinutesBeforeStart: 10,
        attendees: [
            { emailAddress: { address: 'sam@example.com', name: 'Sam Lee' }, type: 'required' },
            { emailAddress: { address: 'kim@example.com' }, type: 'optional' },
        ],
        categories: ['Green category'],
        isAllDay: false,
        start: { dateTime: '2026-10-20T12:00:00', timeZone: 'Pacific Standard Time' },
        end: { dateTime: '2026-10-20T13:30:00', timeZone: 'Pacific Standard Time' },
    });
    assert.equal(sent.prefer, 'outlook.timezone="UTC"');
    assert.equal(items.length, 1);
    const [item] = items;
    assert.ok(store.events.has(item.remoteId));
    const record = item.events[0];
    assert.equal(record.title, 'Lunch with Sam');
    assert.equal(record.description, 'Bring the notes.\nAnd the plan.');
    assert.deepEqual([record.start, record.end], [LA('2026-10-20T12:00:00'), LA('2026-10-20T13:30:00')]);
    assert.deepEqual([record.busy, record.privacy, record.alarms, record.location], [false, 'private', [10], 'Harry\'s Bar']);
    assert.deepEqual(record.organizer, { email: 'robin@example.com', name: 'Robin Park', self: true });
    assert.deepEqual(record.attendees.map((p) => [p.email, p.status, p.role]), [['sam@example.com', 'needs-action', 'required'], ['kim@example.com', 'needs-action', 'optional']]);

    // A zone without a Windows name keeps its IANA id; UTC is UTC.
    const [amsterdam] = await source.create({ remoteId: cal }, { title: 'Canal walk', start: { local: '2026-10-21T10:00:00', tz: 'Europe/Amsterdam' }, end: { local: '2026-10-21T11:00:00', tz: 'Europe/Amsterdam' } });
    assert.deepEqual(store.requestsTo(`/v1.0/me/calendars/${cal}/events`, 'POST')[1].body.start, { dateTime: '2026-10-21T10:00:00', timeZone: 'Europe/Amsterdam' });
    assert.deepEqual(amsterdam.events[0].start, { local: '2026-10-21T10:00:00', tz: 'Europe/Amsterdam' });
    const [inUtc] = await source.create({ remoteId: cal }, { title: 'Server window', start: { local: '2026-10-22T02:00:00', tz: 'UTC' }, end: { local: '2026-10-22T03:00:00', tz: 'UTC' } });
    assert.equal(store.requestsTo(`/v1.0/me/calendars/${cal}/events`, 'POST')[2].body.start.timeZone, 'UTC');
    assert.deepEqual(inUtc.events[0].start, { local: '2026-10-22T02:00:00', tz: 'UTC' });
});

test('create: an all-day event goes from midnight to midnight in the user\'s zone', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const [item] = await source.create({ remoteId: cal }, { title: 'Conference', start: { date: '2026-10-24' }, end: { date: '2026-10-26' }, allDay: true, alarms: [] });
    const [sent] = store.requestsTo('/events', 'POST');
    assert.deepEqual([sent.body.isAllDay, sent.body.start, sent.body.end, sent.body.isReminderOn], [
        true, { dateTime: '2026-10-24T00:00:00', timeZone: 'Pacific Standard Time' }, { dateTime: '2026-10-26T00:00:00', timeZone: 'Pacific Standard Time' }, false,
    ]);
    const record = item.events[0];
    assert.deepEqual([record.start, record.end, record.allDay, record.alarms], [{ date: '2026-10-24' }, { date: '2026-10-26' }, true, undefined]);

    // One day when the end is missing.
    await source.create({ remoteId: cal }, { title: 'Holiday', start: { date: '2026-12-25' } });
    assert.equal(store.requestsTo('/events', 'POST')[1].body.end.dateTime, '2026-12-26T00:00:00');
});

test('create: a recurring event comes back as its occurrences in the window, as a sync brings them', async (t) => {
    const { store, source, logs } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const ny = (local) => ({ local, tz: 'America/New_York' });
    const items = await source.create({ remoteId: cal }, {
        title: 'Office hours', start: ny('2026-10-13T08:00:00'), end: ny('2026-10-13T09:00:00'), rrule: 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=4',
    });
    const [sent] = store.requestsTo('/events', 'POST');
    assert.deepEqual(sent.body.recurrence, {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'thursday'], firstDayOfWeek: 'monday' },
        range: { type: 'numbered', startDate: '2026-10-13', numberOfOccurrences: 4 },
    });
    assert.equal(sent.body.start.timeZone, 'Eastern Standard Time');
    const [series] = [...store.events.keys()];

    // Before any sync the window is a month back to a year ahead, in whole days.
    const [read] = store.requestsTo(`/v1.0/me/events/${series}/instances`, 'GET');
    assert.deepEqual([read.query.startdatetime, read.query.enddatetime], ['2026-09-10T00:00:00Z', '2027-10-13T00:00:00Z']);
    assert.equal(read.prefer, 'outlook.timezone="UTC", odata.maxpagesize=100');
    // The series' own event is never an item: its occurrences are, each with the series' uid.
    assert.deepEqual(items.map((i) => i.remoteId), ['2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22'].map((day) => store.occurrenceId(series, day)));
    assert.deepEqual(items.map((i) => i.events[0].start.local), ['2026-10-13T08:00:00', '2026-10-15T08:00:00', '2026-10-20T08:00:00', '2026-10-22T08:00:00']);
    for (const { events: [record] } of items) {
        assert.equal(record.seriesRemoteId, series);
        assert.equal(record.start.tz, 'America/New_York');
        assert.deepEqual(record.recurrenceId, record.start);
        assert.equal(record.rrule, undefined);
    }
    assert.equal(new Set(items.map((i) => i.events[0].uid)).size, 1);

    // A sync brings the very same items.
    const first = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    assert.deepEqual(first.items, items);

    // After a sync a new series is read for the calendar's window, every page of it, and the delta brings the same ids.
    store.pageSize = 2;
    const daily = await source.create({ remoteId: cal }, { title: 'Stand-up', start: LA('2026-10-20T08:00:00'), end: LA('2026-10-20T08:15:00'), rrule: 'FREQ=DAILY;COUNT=30' });
    const standUp = [...store.events.keys()].find((id) => id !== series);
    const reads = store.requestsTo(`/v1.0/me/events/${standUp}/instances`, 'GET');
    assert.equal(reads.length, 3);
    assert.deepEqual([reads[0].query.startdatetime, reads[0].query.enddatetime], ['2026-10-11T00:00:00Z', '2026-10-25T00:00:00Z']);
    assert.deepEqual(daily.map((i) => i.events[0].start.local), ['20', '21', '22', '23', '24'].map((d) => `2026-10-${d}T08:00:00`));
    const second = await source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO });
    assert.equal(second.reset, false);
    assert.deepEqual(second.items.map((i) => i.remoteId).sort(), daily.map((i) => i.remoteId).sort());

    // The series is saved even when its occurrences can't be read: they come with the next sync.
    store.failNext({ method: 'GET', path: '/instances', status: 503 });
    assert.deepEqual(await source.create({ remoteId: cal }, { title: 'Retro', start: LA('2026-10-23T16:00:00'), end: LA('2026-10-23T17:00:00'), rrule: 'FREQ=WEEKLY;COUNT=2' }), []);
    assert.ok(logs.some((line) => line.includes('next sync') && line.includes('(rate)')));
    const third = await source.sync({ remoteId: cal }, second.state, { from: FROM, to: TO });
    assert.deepEqual(third.items.map((i) => i.events[0].title), ['Retro']);

    // A rule Outlook can't keep is turned down before anything is sent.
    await assert.rejects(source.create({ remoteId: cal }, { title: 'Hourly', start: ny('2026-10-13T08:00:00'), end: ny('2026-10-13T08:10:00'), rrule: 'FREQ=HOURLY' }), isSourceError('config'));
    assert.equal(store.requestsTo('/events', 'POST').length, 3);
});

test('guests: Microsoft invites them as soon as they are saved, so only with notify', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const base = { title: 'Planning', start: LA('2026-10-20T10:00:00'), end: LA('2026-10-20T11:00:00') };
    const sam = { email: 'sam@example.com', name: 'Sam Lee', role: 'required', status: 'needs-action' };
    const kim = { email: 'kim@example.com', role: 'required', status: 'needs-action' };
    const posts = () => store.requestsTo('/events', 'POST');
    const patches = () => store.requestsTo('/v1.0/me/events/', 'PATCH');

    await assert.rejects(source.create({ remoteId: cal }, { ...base, attendees: [sam] }), (error) => isSourceError('config')(error) && /invitation/.test(error.message));
    assert.equal(posts().length, 0);
    // The account itself isn't a guest.
    await source.create({ remoteId: cal }, { ...base, attendees: [{ email: 'Robin@Example.com', self: true }] });
    assert.deepEqual(posts()[0].body.attendees, []);
    const [meeting] = await source.create({ remoteId: cal }, { ...base, attendees: [sam], notify: true });
    assert.deepEqual(posts()[1].body.attendees, [{ emailAddress: { address: 'sam@example.com', name: 'Sam Lee' }, type: 'required' }]);
    assert.equal('notify' in posts()[1].body, false);

    // A change that adds someone needs it too; one that keeps or drops guests, or changes something else, doesn't.
    const target = { item: meeting, record: meeting.events[0] };
    await assert.rejects(source.update({ remoteId: cal }, target, { attendees: [sam, kim] }, 'all'), isSourceError('config'));
    assert.equal(patches().length, 0);
    await source.update({ remoteId: cal }, target, { attendees: [{ ...sam, role: 'optional' }] }, 'all');
    await source.update({ remoteId: cal }, target, { title: 'Planning (room 4)' }, 'all');
    const [both] = await source.update({ remoteId: cal }, target, { attendees: [sam, kim], notify: true }, 'all');
    assert.deepEqual(both.events[0].attendees.map((p) => p.email), ['sam@example.com', 'kim@example.com']);
    assert.equal('notify' in patches()[2].body, false);
    // notify on the target or its record counts as well.
    const lee = { email: 'lee@example.com' };
    await source.update({ remoteId: cal }, { ...target, notify: true }, { attendees: [sam, kim, lee] }, 'all');
    await source.update({ remoteId: cal }, { item: both, record: { ...both.events[0], notify: true } }, { attendees: [sam, kim, lee] }, 'all');
    await source.update({ remoteId: cal }, { item: both, record: both.events[0] }, { attendees: null }, 'all');
    assert.equal(patches().length, 6);
    assert.deepEqual(patches()[5].body, { attendees: [] });
});

test('update: one occurrence, then the whole series, then a single event', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const series = weeklySeries(store, cal);
    const single = store.addEvent(cal, { subject: 'Dentist', start: pst('2026-10-16T08:00:00'), end: pst('2026-10-16T09:00:00') });
    const sync = async () => (await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO })).items;
    let items = await sync();
    const occurrence = (day) => byId(items, store.occurrenceId(series, day));
    const target = (item) => ({ item, record: item.events[0], occurrence: item.events[0].recurrenceId });

    // One occurrence moves and is renamed.
    const changed = await source.update({ remoteId: cal }, target(occurrence('2026-10-12')), {
        title: 'Sync (moved)', start: LA('2026-10-12T13:00:00'), end: LA('2026-10-12T13:30:00'),
    }, 'one');
    const [patch] = store.requestsTo('/v1.0/me/events/', 'PATCH');
    assert.equal(patch.path, `/v1.0/me/events/${store.occurrenceId(series, '2026-10-12')}`);
    assert.deepEqual(patch.body, {
        subject: 'Sync (moved)', isAllDay: false,
        start: { dateTime: '2026-10-12T13:00:00', timeZone: 'Pacific Standard Time' },
        end: { dateTime: '2026-10-12T13:30:00', timeZone: 'Pacific Standard Time' },
    });
    assert.equal(changed.length, 1);
    assert.equal(changed[0].remoteId, store.occurrenceId(series, '2026-10-12'));
    assert.deepEqual(
        [changed[0].events[0].title, changed[0].events[0].start, changed[0].events[0].recurrenceId, changed[0].events[0].seriesRemoteId],
        ['Sync (moved)', LA('2026-10-12T13:00:00'), LA('2026-10-12T09:30:00'), series],
    );

    // Only a new start: the occurrence keeps its length.
    await source.update({ remoteId: cal }, target(occurrence('2026-10-14')), { start: LA('2026-10-14T14:00:00') }, 'one');
    assert.deepEqual(store.requestsTo('/v1.0/me/events/', 'PATCH')[1].body.end, { dateTime: '2026-10-14T14:30:00', timeZone: 'Pacific Standard Time' });

    // The whole series is renamed: the occurrences come with the next sync.
    assert.deepEqual(await source.update({ remoteId: cal }, target(occurrence('2026-10-21')), { title: 'Weekly sync' }, 'all'), []);
    const [, , renamed] = store.requestsTo('/v1.0/me/events/', 'PATCH');
    assert.equal(renamed.path, `/v1.0/me/events/${series}`);
    assert.deepEqual(renamed.body, { subject: 'Weekly sync' });
    items = await sync();
    assert.equal(occurrence('2026-10-21').events[0].title, 'Weekly sync');
    assert.equal(occurrence('2026-10-14').events[0].title, 'Weekly sync');
    assert.equal(occurrence('2026-10-12').events[0].title, 'Sync (moved)');

    // The whole series an hour later.
    await source.update({ remoteId: cal }, target(occurrence('2026-10-19')), { start: LA('2026-10-19T10:30:00'), end: LA('2026-10-19T11:00:00') }, 'all');
    const later = store.requestsTo('/v1.0/me/events/', 'PATCH').at(-1);
    assert.deepEqual(later.body, {
        isAllDay: false,
        start: { dateTime: '2026-10-05T10:30:00', timeZone: 'Pacific Standard Time' },
        end: { dateTime: '2026-10-05T11:00:00', timeZone: 'Pacific Standard Time' },
    });
    items = await sync();
    assert.deepEqual(occurrence('2026-10-19').events[0].start, LA('2026-10-19T10:30:00'));

    // The whole series a day later: its days of the week move along.
    await source.update({ remoteId: cal }, target(occurrence('2026-10-19')), { start: LA('2026-10-20T10:30:00'), end: LA('2026-10-20T11:00:00') }, 'all');
    const nextDay = store.requestsTo('/v1.0/me/events/', 'PATCH').at(-1);
    assert.deepEqual(nextDay.body.start, { dateTime: '2026-10-06T10:30:00', timeZone: 'Pacific Standard Time' });
    assert.deepEqual(nextDay.body.recurrence, {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday', 'thursday'], firstDayOfWeek: 'sunday' },
        range: { type: 'noEnd', startDate: '2026-10-06', recurrenceTimeZone: 'Pacific Standard Time' },
    });
    items = await sync();
    assert.deepEqual(items.filter((i) => i.events[0].seriesRemoteId === series).map((i) => i.events[0].start.local),
        ['2026-10-13T10:30:00', '2026-10-15T10:30:00', '2026-10-20T10:30:00', '2026-10-22T10:30:00']);

    // A new rule for the series.
    await source.update({ remoteId: cal }, target(occurrence('2026-10-20')), { rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' }, 'all');
    assert.deepEqual(store.requestsTo('/v1.0/me/events/', 'PATCH').at(-1).body.recurrence, {
        pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' },
        range: { type: 'numbered', startDate: '2026-10-06', numberOfOccurrences: 3 },
    });

    // A single event: 'all' is the event itself, and it comes back.
    items = await sync();
    const [dentist] = await source.update({ remoteId: cal }, { item: byId(items, single), record: byId(items, single).events[0] }, { title: 'Dentist (new time)', location: 'Main St' }, 'all');
    assert.deepEqual(store.requestsTo('/v1.0/me/events/', 'PATCH').at(-1).body, { subject: 'Dentist (new time)', location: { displayName: 'Main St' } });
    assert.deepEqual([dentist.remoteId, dentist.events[0].title, dentist.events[0].location], [single, 'Dentist (new time)', 'Main St']);
});

test('update: an occurrence of a series item (not an occurrence item) is found by its original start', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const series = store.addEvent(cal, {
        subject: 'Review', start: pst('2026-10-12T15:00:00'), end: pst('2026-10-12T16:00:00'),
        recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', startDate: '2026-10-12', numberOfOccurrences: 5 } },
    });
    // The series as a calendar that keeps series would hold it.
    const master = { remoteId: series, events: [{ uid: 'review', title: 'Review', start: LA('2026-10-12T15:00:00'), end: LA('2026-10-12T16:00:00'), allDay: false, rrule: 'FREQ=DAILY;COUNT=5' }] };
    const [changed] = await source.update({ remoteId: cal }, { item: master, record: master.events[0], occurrence: LA('2026-10-14T15:00:00') }, { title: 'Review (Wednesday)' }, 'one');
    assert.equal(changed.remoteId, store.occurrenceId(master.remoteId, '2026-10-14'));
    assert.equal(changed.events[0].title, 'Review (Wednesday)');
    assert.equal(store.requestsTo(`/v1.0/me/events/${master.remoteId}/instances`, 'GET').length, 1);
    await assert.rejects(
        source.update({ remoteId: cal }, { item: master, record: master.events[0], occurrence: LA('2026-10-30T15:00:00') }, { title: 'x' }, 'one'),
        isSourceError('not-found'),
    );
});

test('update: a single event that takes a rule becomes its occurrences', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const single = store.addEvent(cal, { subject: 'Yoga', start: pst('2026-10-13T18:00:00'), end: pst('2026-10-13T19:00:00') });
    const first = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    const item = byId(first.items, single);
    const items = await source.update({ remoteId: cal }, { item, record: item.events[0] }, { rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3' }, 'all');
    assert.deepEqual(store.requestsTo('/v1.0/me/events/', 'PATCH')[0].body, {
        recurrence: {
            pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' },
            range: { type: 'numbered', startDate: '2026-10-13', numberOfOccurrences: 3 },
        },
    });
    // Its own item empties, and its occurrences in the synced window come instead (the third is after it).
    assert.deepEqual(items[0], { remoteId: single, events: [] });
    assert.deepEqual(items.slice(1).map((i) => i.remoteId), [store.occurrenceId(single, '2026-10-13'), store.occurrenceId(single, '2026-10-20')]);
    for (const { events: [record] } of items.slice(1)) {
        assert.equal(record.seriesRemoteId, single);
        assert.equal(record.uid, item.events[0].uid);
    }
    // The next sync says the same: the event went from the view, its occurrences came.
    const second = await source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO });
    assert.deepEqual(second.removed, [single]);
    assert.deepEqual(second.items, items.slice(1));
});

test('remove: an occurrence, a whole series, a single event, and one already gone', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const series = weeklySeries(store, cal);
    const single = store.addEvent(cal, { subject: 'Dentist', start: pst('2026-10-16T08:00:00'), end: pst('2026-10-16T09:00:00') });
    const first = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    const target = (id) => ({ item: byId(first.items, id), record: byId(first.items, id).events[0] });

    const wednesday = store.occurrenceId(series, '2026-10-14');
    assert.deepEqual(await source.remove({ remoteId: cal }, target(wednesday), 'one'), { removed: [wednesday], items: [] });
    assert.equal(store.requestsTo('/v1.0/me/events/', 'DELETE')[0].path, `/v1.0/me/events/${wednesday}`);
    const second = await source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO });
    assert.deepEqual(second.removed, [wednesday]);

    const monday = store.occurrenceId(series, '2026-10-12');
    assert.deepEqual(await source.remove({ remoteId: cal }, target(monday), 'all'), { removed: [series, monday], items: [] });
    assert.equal(store.requestsTo('/v1.0/me/events/', 'DELETE')[1].path, `/v1.0/me/events/${series}`);
    const third = await source.sync({ remoteId: cal }, second.state, { from: FROM, to: TO });
    assert.deepEqual(third.removed.sort(), first.items.filter((i) => i.events[0].seriesRemoteId === series && i.remoteId !== wednesday).map((i) => i.remoteId).sort());

    assert.deepEqual(await source.remove({ remoteId: cal }, target(single), 'all'), { removed: [single], items: [] });
    assert.deepEqual(await source.remove({ remoteId: cal }, target(single), 'all'), { removed: [single], items: [] });
    assert.equal(store.events.size, 0);
});

test('respond: accept, maybe and decline, with sendResponse', async (t) => {
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const invited = {
        organizer: { emailAddress: { name: 'Ana Silva', address: 'ana@example.com' } },
        isOrganizer: false,
        responseStatus: { response: 'notResponded', time: NO_TIME },
        attendees: [{ type: 'required', status: { response: 'none', time: NO_TIME }, emailAddress: { name: 'Robin Park', address: 'robin@example.com' } }],
    };
    const single = store.addEvent(cal, { subject: 'Quarterly plan', start: pst('2026-10-16T13:00:00'), end: pst('2026-10-16T14:00:00'), ...invited });
    const series = weeklySeries(store, cal, invited);
    const { items } = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    const target = (id) => ({ item: byId(items, id), record: byId(items, id).events[0] });
    const own = (item) => item.events[0].attendees.find((p) => p.self).status;
    assert.equal(own(byId(items, single)), 'needs-action');

    const [accepted] = await source.respond({ remoteId: cal }, target(single), 'accepted', 'all');
    assert.equal(own(accepted), 'accepted');
    const monday = store.occurrenceId(series, '2026-10-12');
    const [maybe] = await source.respond({ remoteId: cal }, target(monday), 'tentative', 'one');
    assert.equal(maybe.remoteId, monday);
    assert.equal(own(maybe), 'tentative');
    assert.deepEqual(await source.respond({ remoteId: cal }, target(monday), 'declined', 'all'), []);

    assert.deepEqual(store.responses, [
        { id: single, action: 'accept', sendResponse: true },
        { id: monday, action: 'tentativelyAccept', sendResponse: true },
        { id: series, action: 'decline', sendResponse: true },
    ]);
    assert.deepEqual(store.requestsTo('/accept', 'POST')[0].body, { sendResponse: true });
    await assert.rejects(source.respond({ remoteId: cal }, target(single), 'maybe', 'all'), isSourceError('config'));
});

// ── Mapping ────────────────────────────────────────────────────────────

test('recurrence mappers: every pattern type, both ways', () => {
    const start = LA('2026-10-13T09:00:00');
    const noEnd = { type: 'noEnd', startDate: '2026-10-13' };
    const cases = [
        ['FREQ=DAILY', { type: 'daily', interval: 1 }, noEnd],
        ['FREQ=DAILY;INTERVAL=3;COUNT=10', { type: 'daily', interval: 3 }, { type: 'numbered', startDate: '2026-10-13', numberOfOccurrences: 10 }],
        ['FREQ=WEEKLY;BYDAY=TU', { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' }, noEnd],
        ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;WKST=SU', { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'wednesday', 'friday'], firstDayOfWeek: 'sunday' }, noEnd],
        ['FREQ=WEEKLY;UNTIL=20261231T075959Z;BYDAY=TU', { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' }, { type: 'endDate', startDate: '2026-10-13', endDate: '2026-12-30' }],
        ['FREQ=MONTHLY;BYMONTHDAY=13', { type: 'absoluteMonthly', interval: 1, dayOfMonth: 13 }, noEnd],
        ['FREQ=MONTHLY;INTERVAL=3;BYDAY=2TU', { type: 'relativeMonthly', interval: 3, daysOfWeek: ['tuesday'], index: 'second' }, noEnd],
        ['FREQ=MONTHLY;BYDAY=-1FR', { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' }, noEnd],
        ['FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1', { type: 'relativeMonthly', interval: 1, daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], index: 'first' }, noEnd],
        ['FREQ=MONTHLY;BYDAY=3WE', { type: 'relativeMonthly', interval: 1, daysOfWeek: ['wednesday'], index: 'third' }, noEnd],
        ['FREQ=MONTHLY;BYDAY=4SA', { type: 'relativeMonthly', interval: 1, daysOfWeek: ['saturday'], index: 'fourth' }, noEnd],
        ['FREQ=YEARLY;BYMONTH=10;BYMONTHDAY=13', { type: 'absoluteYearly', interval: 1, dayOfMonth: 13, month: 10 }, noEnd],
        ['FREQ=YEARLY;INTERVAL=2;COUNT=5;BYMONTH=11;BYDAY=4TH', { type: 'relativeYearly', interval: 2, daysOfWeek: ['thursday'], index: 'fourth', month: 11 }, { type: 'numbered', startDate: '2026-10-13', numberOfOccurrences: 5 }],
        ['FREQ=YEARLY;BYMONTH=3;BYDAY=SA,SU;BYSETPOS=-1', { type: 'relativeYearly', interval: 1, daysOfWeek: ['saturday', 'sunday'], index: 'last', month: 3 }, noEnd],
    ];
    for (const [rrule, pattern, range] of cases) {
        assert.deepEqual(patternFromRrule(rrule, start), { pattern, range }, rrule);
        assert.equal(rruleFromPattern({ pattern, range }, start), rrule, rrule);
    }

    // All day: UNTIL is a date.
    const day = { date: '2026-10-13' };
    assert.deepEqual(patternFromRrule('FREQ=WEEKLY;UNTIL=20261231;BYDAY=TU', day).range, { type: 'endDate', startDate: '2026-10-13', endDate: '2026-12-31' });
    assert.equal(rruleFromPattern({ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' }, range: { type: 'endDate', startDate: '2026-10-13', endDate: '2026-12-31' } }, day), 'FREQ=WEEKLY;UNTIL=20261231;BYDAY=TU');

    // What Graph sends: every property, the unused ones empty, and the range's own zone.
    assert.equal(rruleFromPattern({
        pattern: { type: 'weekly', interval: 1, month: 0, dayOfMonth: 0, daysOfWeek: ['monday'], firstDayOfWeek: 'sunday', index: 'first' },
        range: { type: 'endDate', startDate: '2017-09-04', endDate: '2017-12-31', recurrenceTimeZone: 'Pacific Standard Time', numberOfOccurrences: 0 },
    }, LA('2017-09-04T12:00:00')), 'FREQ=WEEKLY;UNTIL=20180101T075959Z;BYDAY=MO;WKST=SU');
    assert.equal(rruleFromPattern({ pattern: { type: 'relativeMonthly', interval: 1, month: 0, dayOfMonth: 0, daysOfWeek: ['thursday'], firstDayOfWeek: 'sunday', index: 'last' }, range: { type: 'noEnd', startDate: '2026-10-29', endDate: '0001-01-01', numberOfOccurrences: 0 } }, LA('2026-10-29T09:00:00')), 'FREQ=MONTHLY;BYDAY=-1TH');

    // What a rule leaves out comes from the start (a Tuesday, the 13th of October).
    const parts = (rrule) => patternFromRrule(rrule, start).pattern;
    assert.deepEqual(parts('FREQ=WEEKLY'), { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' });
    assert.deepEqual(parts('FREQ=MONTHLY'), { type: 'absoluteMonthly', interval: 1, dayOfMonth: 13 });
    assert.deepEqual(parts('FREQ=YEARLY'), { type: 'absoluteYearly', interval: 1, dayOfMonth: 13, month: 10 });
    assert.deepEqual(parts('FREQ=YEARLY;BYMONTH=4'), { type: 'absoluteYearly', interval: 1, dayOfMonth: 13, month: 4 });
    // Other ways to say the same.
    assert.deepEqual(parts('RRULE:freq=daily;byday=mo,tu,we,th,fr'), { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], firstDayOfWeek: 'monday' });
    assert.deepEqual(parts('FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2'), { type: 'relativeMonthly', interval: 1, daysOfWeek: ['tuesday'], index: 'second' });
    assert.deepEqual(parts('FREQ=MONTHLY;BYMONTHDAY=-1'), { type: 'relativeMonthly', interval: 1, daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'], index: 'last' });
    assert.deepEqual(parts('FREQ=WEEKLY;BYDAY=TU;X-NAME=1'), { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' });

    // What Graph can't say.
    for (const rrule of [
        'FREQ=HOURLY', 'FREQ=MINUTELY', 'FREQ=WEEKLY;BYHOUR=9,15', 'FREQ=YEARLY;BYWEEKNO=20', 'FREQ=YEARLY;BYYEARDAY=100',
        'FREQ=MONTHLY;BYDAY=5MO', 'FREQ=MONTHLY;BYDAY=1MO,3MO', 'FREQ=MONTHLY;BYMONTHDAY=1,15', 'FREQ=MONTHLY;BYDAY=TU',
        'FREQ=MONTHLY;BYMONTHDAY=-2', 'FREQ=MONTHLY;BYMONTH=3', 'FREQ=YEARLY;BYMONTH=1,7;BYMONTHDAY=1', 'FREQ=YEARLY;BYDAY=20MO',
        'FREQ=DAILY;INTERVAL=2;BYDAY=MO', 'FREQ=WEEKLY;BYDAY=1MO', 'FREQ=WEEKLY;COUNT=3;UNTIL=20261231', 'FREQ=WEEKLY;INTERVAL=0',
        'FREQ=MONTHLY;BYDAY=TU,WE;BYSETPOS=1,2', 'FREQ=MONTHLY;BYMONTHDAY=13;BYDAY=FR', 'FREQ=WEEKLY;UNTIL=2026', 'INTERVAL=2', '',
        'FREQ=FORTNIGHTLY', 'FREQ=MONTHLY;RSCALE=HEBREW',
    ]) {
        assert.throws(() => patternFromRrule(rrule, start), (e) => isSourceError('config')(e) && /^[A-Z].*\.$/.test(e.message), rrule);
    }
    assert.throws(() => rruleFromPattern({ pattern: { type: 'lunar', interval: 1 }, range: noEnd }, start), isSourceError('config'));
    assert.throws(() => rruleFromPattern({ pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 0 }, range: noEnd }, start), isSourceError('config'));
});

test('Windows zone names (and Graph\'s other zone names) to IANA', async (t) => {
    assert.equal(graphZone('Pacific Standard Time', ZONE), 'America/Los_Angeles');
    assert.equal(graphZone('W. Europe Standard Time', ZONE), 'Europe/Berlin');
    assert.equal(graphZone('Tokyo Standard Time', ZONE), 'Asia/Tokyo');
    assert.ok(['Asia/Kolkata', 'Asia/Calcutta'].includes(graphZone('India Standard Time', ZONE)));
    assert.equal(graphZone('UTC', ZONE), 'UTC');
    assert.equal(graphZone('tzone://Microsoft/Utc', ZONE), 'UTC');
    assert.equal(graphZone('tzone://Microsoft/Custom', ZONE), ZONE);
    assert.equal(graphZone('Customized Time Zone', ZONE), ZONE);
    assert.equal(graphZone('Europe/Amsterdam', ZONE), 'Europe/Amsterdam');
    assert.equal(graphZone('', ZONE), ZONE);

    // As a sync reads them: the wall clock where the event was made.
    const { store, source } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    const tokyo = store.addEvent(cal, { subject: 'Tokyo', start: { dateTime: '2026-10-14T09:00:00', timeZone: 'Tokyo Standard Time' }, end: { dateTime: '2026-10-14T10:00:00', timeZone: 'Tokyo Standard Time' } });
    const delhi = store.addEvent(cal, { subject: 'Delhi', start: { dateTime: '2026-10-14T09:30:00', timeZone: 'India Standard Time' }, end: { dateTime: '2026-10-14T10:00:00', timeZone: 'India Standard Time' } });
    const { items } = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    assert.deepEqual(byId(items, tokyo).events[0].start, { local: '2026-10-14T09:00:00', tz: 'Asia/Tokyo' });
    assert.equal(byId(items, delhi).events[0].start.local, '2026-10-14T09:30:00');
});

test('event bodies: HTML to plain text', () => {
    assert.equal(htmlToText('<html><head><style>p{margin:0}</style></head><body><p>Agenda &amp; notes</p><ul><li>One</li><li>Two</li></ul></body></html>'), 'Agenda & notes\n- One\n- Two');
    assert.equal(htmlToText('<p class=MsoNormal>First</p>\r\n<p class=MsoNormal>&nbsp;</p>\r\n<p class=MsoNormal>Second &lt;b&gt; &#8211; &#x2014; &amp;lt;</p>'), 'First\n\nSecond <b> – — &lt;');
    assert.equal(htmlToText('<div><br></div><div>Hello<br>World<br></div><div><br></div><div>Bye</div>'), 'Hello\nWorld\n\nBye');
    assert.equal(htmlToText('<table><tr><td>A</td><td>B</td></tr></table><!-- note --><script>x()</script>'), 'A B');
});

// ── Errors ─────────────────────────────────────────────────────────────

test('errors: throttling, refusals and the network as SourceErrors that hold no secrets', async (t) => {
    const { store, source, env, secret, logs } = await setup(t);
    const cal = store.addCalendar({ name: 'Work' });
    store.addEvent(cal, { subject: 'Standup', start: pst('2026-10-12T09:00:00'), end: pst('2026-10-12T09:15:00') });

    store.failNext({ path: '/v1.0/me/calendars', status: 429, headers: { 'Retry-After': '7' } });
    await assert.rejects(source.calendars(), (e) => isSourceError('rate')(e) && e.retryAfter === 7);
    store.failNext({ path: '/calendarView/delta', status: 503, headers: { 'Retry-After': '30' } });
    await assert.rejects(source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO }), (e) => isSourceError('rate')(e) && e.retryAfter === 30);

    const first = await source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO });
    const target = { item: first.items[0], record: first.items[0].events[0] };
    store.failNext({ path: `/v1.0/me/calendars/${cal}/events`, method: 'POST', status: 403 });
    await assert.rejects(source.create({ remoteId: cal }, { title: 'x', start: LA('2026-10-12T09:00:00'), end: LA('2026-10-12T10:00:00') }), isSourceError('forbidden'));
    store.failNext({ path: '/v1.0/me/events/', method: 'PATCH', status: 404 });
    await assert.rejects(source.update({ remoteId: cal }, target, { title: 'x' }, 'all'), isSourceError('not-found'));
    store.failNext({ path: '/v1.0/me/events/', method: 'PATCH', status: 400, body: { error: { code: 'ErrorOccurrenceCrossingBoundary', message: 'Modified occurrence is crossing or overlapping adjacent occurrence.' } } });
    await assert.rejects(source.update({ remoteId: cal }, target, { title: 'x' }, 'all'), (e) => isSourceError('server')(e) && /ErrorOccurrenceCrossingBoundary/.test(e.message));
    // A 410 or a 400 in a first round is an error, not a loop.
    store.failNext({ path: '/calendarView/delta', status: 410 });
    await assert.rejects(source.sync({ remoteId: cal }, undefined, { from: FROM, to: TO }), isSourceError('not-found'));

    // Nothing to reach, and plain http to another computer.
    const closed = create(ACCOUNT, { ...env, settings: { ...env.settings, microsoftGraphBase: 'http://127.0.0.1:9/v1.0' } });
    await assert.rejects(closed.calendars(), isSourceError('network'));
    const plain = create(ACCOUNT, { ...env, settings: { ...env.settings, microsoftGraphBase: 'http://graph.example.com/v1.0' } });
    await assert.rejects(plain.calendars(), isSourceError('config'));

    // No error message and no log line holds a token or a URL's query.
    const errors = [];
    for (const run of [
        () => source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO }),
        () => { store.failNext({ path: '$deltatoken', status: 500 }); return source.sync({ remoteId: cal }, first.state, { from: FROM, to: TO }); },
        () => { store.revokeRefreshTokens(); store.revokeAccessTokens(); return source.calendars(); },
    ]) {
        try {
            await run();
        } catch (error) {
            errors.push(error.message);
        }
    }
    assert.equal(errors.length, 2);
    const secrets = [secret.value.accessToken, secret.value.refreshToken, 'deltatoken', 'skiptoken', 'Bearer'];
    for (const line of [...errors, ...logs]) for (const s of secrets) assert.ok(!line.includes(s), `"${line}" holds a secret`);
});
