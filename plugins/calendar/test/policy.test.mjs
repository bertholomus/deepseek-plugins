/**
 * The write rules for agents (lib/policy.js), without DSH: which access
 * each permission preset gives, the decision for each setting, the words
 * DSH's approval prompt shows, and the pre-execute gate's answers.
 *
 *   node --test plugins/calendar/test/policy.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_TOOLS, MODES, accessOf, changeGate, decide, describeChange } from '../lib/policy.js';

/** DSH's permission presets, as the plugin sees them: the session's preset by name, and what a name means. */
function presetsWith(name, { throws = false } = {}) {
    const sandboxes = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', 'danger-full-access': 'danger-full-access' };
    return {
        current(session) {
            if (throws) throw new Error('no presets here');
            return session?.preset ?? name;
        },
        resolve(preset) {
            if (!(preset in sandboxes)) throw new Error(`unknown preset ${preset}`);
            return { sandbox: sandboxes[preset], approval: preset === 'danger-full-access' ? 'never' : 'on-request' };
        },
    };
}

/** What describeChange reads from the manager: an event by id, the user's zone and the calendars. */
const manager = {
    event(id) {
        const events = {
            haircut: { title: 'Haircut', allDay: false, startLocal: '2026-10-16T17:00', timeZone: null, calendar: 'Personal' },
            standup: { title: 'Standup', allDay: false, startLocal: '2026-10-19T09:30', timeZone: 'America/New_York', calendar: 'Work' },
            trip: { title: 'Trip', allDay: true, startDay: '2026-10-20', calendar: 'Personal' },
            long: { title: `A very long title ${'x'.repeat(200)}`, allDay: false, startLocal: '2026-10-16T08:00', timeZone: 'Europe/Berlin', calendar: 'Personal' },
        };
        if (!(id in events)) throw new Error('no such event');
        return events[id];
    },
    zone: () => 'Europe/Berlin',
    defaultCalendarId: () => 'personal',
    calendar(id) {
        if (id !== 'personal' && id !== 'work') throw new Error('no such calendar');
        return { id, name: id === 'personal' ? 'Personal' : 'Work' };
    },
    calendarName: (calendar) => calendar.name,
};

test('policy: the settings and the tools that change calendars', () => {
    assert.deepEqual(MODES, ['preset', 'ask', 'off']);
    assert.deepEqual([...CHANGE_TOOLS].sort(), ['calendar_create_event', 'calendar_delete_event', 'calendar_respond', 'calendar_update_event']);
    for (const reading of ['calendar_events', 'calendar_search', 'calendar_get_event', 'calendar_free_time', 'calendar_list_calendars']) {
        assert.equal(CHANGE_TOOLS.has(reading), false, reading);
    }
});

test('policy: access from the session\'s permission preset', () => {
    const session = {};
    assert.equal(accessOf(presetsWith('read-only'), session), 'read-only');
    assert.equal(accessOf(presetsWith('workspace-write'), session), 'workspace-write');
    assert.equal(accessOf(presetsWith('danger-full-access'), session), 'danger-full-access');
    assert.equal(accessOf(presetsWith('auto'), session), 'auto');
    // A custom mix, a preset the plugin doesn't know, no presets or no session: unknown (asks).
    assert.equal(accessOf(presetsWith('custom'), session), 'unknown');
    assert.equal(accessOf(presetsWith('team-preset'), session), 'unknown');
    assert.equal(accessOf(presetsWith('read-only', { throws: true }), session), 'unknown');
    assert.equal(accessOf(undefined, session), 'unknown');
    assert.equal(accessOf(presetsWith('read-only'), undefined), 'unknown');
    assert.equal(accessOf({ current: () => 42, resolve: () => ({}) }, session), 'unknown');
    assert.equal(accessOf({ current: () => 'workspace-write', resolve: () => undefined }, session), 'unknown');
});

test('policy: the decision for each setting and access', () => {
    const accesses = ['read-only', 'workspace-write', 'danger-full-access', 'auto', 'unknown'];
    const expected = {
        preset: { 'read-only': 'deny', 'workspace-write': 'ask', 'danger-full-access': 'allow', auto: 'allow', unknown: 'ask' },
        ask: { 'read-only': 'ask', 'workspace-write': 'ask', 'danger-full-access': 'ask', auto: 'ask', unknown: 'ask' },
        off: { 'read-only': 'deny', 'workspace-write': 'deny', 'danger-full-access': 'deny', auto: 'deny', unknown: 'deny' },
    };
    for (const mode of MODES) {
        for (const access of accesses) {
            const decision = decide(mode, access);
            const kind = typeof decision === 'string' ? decision : 'deny';
            assert.equal(kind, expected[mode][access], `${mode} / ${access}`);
            if (kind === 'deny') assert.match(decision.deny, /Calendar page/, 'a refusal says where the user can make the change');
        }
    }
    assert.match(decide('preset', 'read-only').deny, /Read Only/);
    assert.match(decide('off', 'danger-full-access').deny, /switched off/);
});

test('policy: the approval prompt says what would change', () => {
    assert.equal(describeChange(manager, 'calendar_create_event', { title: 'Dentist', start: '2026-10-14 09:00', end: '2026-10-14 10:00' }),
        'Add “Dentist” (2026-10-14 09:00 to 2026-10-14 10:00) to Personal?');
    assert.equal(describeChange(manager, 'calendar_create_event', { title: 'Review', start: 'tomorrow 15:00', repeat: 'FREQ=WEEKLY', calendar_id: 'work', guests: ['a@example.com', 'b@example.com'], notify_guests: true }),
        'Add “Review” (tomorrow 15:00, repeating) to Work, and email 2 invitations?');
    // Guests without notify_guests: nobody is emailed, so the prompt doesn't say so.
    assert.equal(describeChange(manager, 'calendar_create_event', { title: 'Lunch', start: '2026-10-14 12:00', guests: ['a@example.com'] }),
        'Add “Lunch” (2026-10-14 12:00) to Personal?');
    assert.equal(describeChange(manager, 'calendar_create_event', { title: 'Lunch', start: '2026-10-14 12:00', guests: ['a@example.com'], notify_guests: true }),
        'Add “Lunch” (2026-10-14 12:00) to Personal, and email an invitation?');
    assert.equal(describeChange(manager, 'calendar_create_event', { title: 'X', start: '2026-10-14', calendar_id: 'gone' }),
        'Add “X” (2026-10-14) to a calendar?');

    assert.equal(describeChange(manager, 'calendar_update_event', { id: 'haircut', start: '2026-10-16 18:00', end: '2026-10-16 19:00' }),
        'Change “Haircut” (2026-10-16 17:00, Personal): start, end?');
    assert.equal(describeChange(manager, 'calendar_update_event', { id: 'standup', scope: 'one', title: 'Standup (moved)', time_zone: 'Europe/Berlin' }),
        'Change only this occurrence of “Standup” (2026-10-19 09:30 America/New_York, Work): title, time zone?');
    assert.equal(describeChange(manager, 'calendar_update_event', { id: 'standup', scope: 'following', clear: ['repeat'] }),
        'Change this and the following occurrences of “Standup” (2026-10-19 09:30 America/New_York, Work): stop repeating?');
    // Empty strings change nothing (some models send every field); `clear` empties one.
    assert.equal(describeChange(manager, 'calendar_update_event', { id: 'haircut', title: '', location: '', repeat: '', end: '2026-10-16 18:30', clear: ['location', 'url', 'location', 'toString'] }),
        'Change “Haircut” (2026-10-16 17:00, Personal): end, no place, no link?');
    assert.equal(describeChange(manager, 'calendar_update_event', { id: 'trip', calendar_id: 'work', location: '' }),
        'Change “Trip” (2026-10-20 all day, Personal) and move it to Work?');
    const long = describeChange(manager, 'calendar_update_event', { id: 'long', description: 'more' });
    assert.ok(long.length < 140, 'a long title is cut short');
    assert.match(long, /^Change “A very long title x+…” \(2026-10-16 08:00, Personal\): description\?$/);

    assert.equal(describeChange(manager, 'calendar_delete_event', { id: 'haircut' }), 'Delete “Haircut” (2026-10-16 17:00, Personal)?');
    assert.equal(describeChange(manager, 'calendar_delete_event', { id: 'standup', scope: 'all', notify_guests: true }),
        'Delete “Standup” (2026-10-19 09:30 America/New_York, Work), and tell its guests?');
    assert.equal(describeChange(manager, 'calendar_delete_event', { id: 'nope' }), 'Delete an event?');
    assert.equal(describeChange(manager, 'calendar_respond', { id: 'standup', answer: 'declined' }),
        'Answer “Standup” (2026-10-19 09:30 America/New_York, Work): declined? The organizer is told.');
    // Arguments that aren't an object never break the prompt.
    assert.equal(describeChange(manager, 'calendar_delete_event', null), 'Delete an event?');
    assert.equal(describeChange(manager, 'calendar_something', {}), 'Change the calendar (calendar_something)?');
});

test('policy: the gate before each tool runs', async () => {
    const lines = [];
    const gate = (preset, mode = 'preset') => changeGate({
        presets: () => presetsWith(preset),
        manager,
        mode: () => mode,
        log: (line) => lines.push(line),
    });
    const allow = async () => ({ kind: 'allow' });
    const call = (name, args = {}) => ({ name, arguments: args, agent: { session: {} } });

    // Reading tools and other plugins' tools pass straight through.
    let reached = 0;
    const counted = async () => { reached++; return { kind: 'allow' }; };
    assert.deepEqual(await gate('read-only')(call('calendar_events'), counted), { kind: 'allow' });
    assert.deepEqual(await gate('read-only')(call('shell'), counted), { kind: 'allow' });
    assert.equal(reached, 2);
    assert.equal(lines.length, 0);

    // A refusal or a question from another gate stands.
    const denied = { kind: 'deny', reason: 'another gate said no' };
    assert.deepEqual(await gate('danger-full-access')(call('calendar_delete_event', { id: 'haircut' }), async () => denied), denied);
    const asked = { kind: 'ask', reason: 'another gate asks' };
    assert.deepEqual(await gate('danger-full-access')(call('calendar_delete_event', { id: 'haircut' }), async () => asked), asked);

    assert.deepEqual(await gate('danger-full-access')(call('calendar_create_event', { title: 'A', start: '2026-10-14 09:00' }), allow), { kind: 'allow' });
    assert.deepEqual(await gate('auto')(call('calendar_create_event', { title: 'A', start: '2026-10-14 09:00' }), allow), { kind: 'allow' });

    const refused = await gate('read-only')(call('calendar_update_event', { id: 'haircut', title: 'B' }), allow);
    assert.equal(refused.kind, 'deny');
    assert.match(refused.reason, /Read Only/);

    const question = await gate('workspace-write')(call('calendar_delete_event', { id: 'haircut' }), allow);
    assert.deepEqual(question, {
        kind: 'ask',
        reason: 'Calendar: Delete “Haircut” (2026-10-16 17:00, Personal)?',
        displayReason: { en: 'Delete “Haircut” (2026-10-16 17:00, Personal)?' },
    });

    const off = await gate('danger-full-access', 'off')(call('calendar_respond', { id: 'standup', answer: 'accepted' }), allow);
    assert.equal(off.kind, 'deny');
    assert.match(off.reason, /switched off/);
    assert.equal((await gate('danger-full-access', 'ask')(call('calendar_respond', { id: 'standup', answer: 'accepted' }), allow)).kind, 'ask');

    // A session the presets can't place asks.
    const unplaced = changeGate({ presets: () => undefined, manager, mode: () => 'preset', log: (line) => lines.push(line) });
    assert.equal((await unplaced(call('calendar_create_event', { title: 'A', start: '2026-10-14' }), allow)).kind, 'ask');

    // The log has the tool, the access and the decision: no titles, no arguments.
    assert.deepEqual(lines, [
        'policy calendar_create_event access=danger-full-access allow',
        'policy calendar_create_event access=auto allow',
        'policy calendar_update_event access=read-only deny',
        'policy calendar_delete_event access=workspace-write ask',
        'policy calendar_respond access=danger-full-access deny',
        'policy calendar_respond access=danger-full-access ask',
        'policy calendar_create_event access=unknown ask',
    ]);
});
