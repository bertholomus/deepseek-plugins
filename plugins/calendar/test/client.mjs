/**
 * The browser half's pure parts: lib/client.js loaded the way DSH loads it
 * (a classic script that hands its factory to DSH's module loader), with
 * stand-ins for React and DSH's primitives, and the helpers its views are
 * built on (module.exports.internals) checked on their own: days and zones,
 * repeat rules, where events go in the grid, and what a change may email.
 *
 *   node --test plugins/calendar/test/client.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/** Load the browser half the way DSH does; the primitives are stand-ins (a component is its own name). */
function loadClient({ loader = true } = {}) {
    let loaded;
    const window = { ...(loader ? { __ModuleLoader__: { load: (m) => { loaded = m; } } } : {}), addEventListener: () => {}, removeEventListener: () => {} };
    runInNewContext(SOURCE, { window, URL, console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask });
    if (!loaded) return { window };
    const ui = new Proxy({}, { get: (_target, name) => (typeof name === 'string' && /^[A-Z]/.test(name) ? name : undefined) });
    const modules = {
        react: {
            createElement: (type, props, ...children) => ({ type, props, children }), Fragment: 'Fragment',
            useState: (init) => [typeof init === 'function' ? init() : init, () => {}], useRef: (current) => ({ current }),
            useEffect: () => {}, useLayoutEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useSyncExternalStore: (_s, get) => get(),
        },
        'react-dom': { createPortal: (node) => node },
        '@deepseek-ai/dsh-client-ui-primitives': ui,
    };
    return { id: loaded.id, client: loaded.factory((name) => modules[name]) };
}

/** A value from the client's realm as a plain one here (its arrays and objects have that realm's prototypes). */
const plain = (value) => JSON.parse(JSON.stringify(value));

const { id, client } = loadClient();
const I = client.internals;
const LA = 'America/Los_Angeles';
const BERLIN = 'Europe/Berlin';

test('loads as DSH loads a browser half, and stays quiet without DSH', () => {
    assert.equal(id, 'dsh-plugin-calendar');
    assert.equal(typeof client.apply, 'function');
    assert.deepEqual(plain(client.inject), ['slots']);
    // No module loader (or no window at all): nothing happens, nothing throws.
    assert.doesNotThrow(() => loadClient({ loader: false }));
    assert.doesNotThrow(() => runInNewContext(SOURCE, {}));
    // A card for each calendar tool.
    assert.deepEqual([...I.TOOL_NAMES].sort(), ['calendar_create_event', 'calendar_delete_event', 'calendar_events', 'calendar_free_time', 'calendar_get_event',
        'calendar_list_calendars', 'calendar_respond', 'calendar_search', 'calendar_update_event']);
});

test('styles stay on the plugin\'s own roots and follow the wallpaper\'s public contract', () => {
    const css = I.CSS;
    assert.ok(css.includes('var(--wp-blur') && css.includes('var(--wp-tint') && css.includes('body.wp-still'));
    assert.ok(css.includes('data-ds-dark-theme'));
    // No rule for :root, html or body on their own, and no DSH class names.
    for (const rule of css.split('}')) {
        const selector = rule.split('{')[0].trim();
        if (!selector || selector.startsWith('@')) continue;
        assert.ok(!/(^|,)\s*(:root|html|body)\s*(,|$)/.test(selector), selector);
    }
    assert.ok(!/\[class\*="(?!dshcal-)|\._[a-z]/i.test(css), 'no DSH internals');
});

test('wall clocks and instants in a zone, across the clock changes', () => {
    // An ordinary day in Los Angeles (UTC-7 in October) and in Berlin.
    assert.equal(I.toInstant('2026-10-12T09:30', LA), Date.parse('2026-10-12T16:30:00Z'));
    assert.equal(I.toLocal(Date.parse('2026-10-12T16:30:00Z'), LA), '2026-10-12T09:30:00');
    assert.equal(I.toInstant('2026-10-12T09:30', BERLIN), Date.parse('2026-10-12T07:30:00Z'));
    // Spring forward: 02:30 doesn't happen on Mar 8, 2026 in Los Angeles; it takes the offset from before the gap.
    assert.equal(I.toInstant('2026-03-08T02:30', LA), Date.parse('2026-03-08T10:30:00Z'));
    // Fall back: 01:30 happens twice on Nov 1, 2026; the first is meant.
    assert.equal(I.toInstant('2026-11-01T01:30', LA), Date.parse('2026-11-01T08:30:00Z'));
    // A day's start, and how long the day of a change is.
    assert.equal(I.startOfDay('2026-11-01', LA), Date.parse('2026-11-01T07:00:00Z'));
    assert.equal(I.startOfDay('2026-11-02', LA) - I.startOfDay('2026-11-01', LA), 25 * 3_600_000);
    assert.equal(I.dayIn(Date.parse('2026-10-12T06:59:00Z'), LA), '2026-10-11');
    assert.equal(I.minutesIn(Date.parse('2026-10-12T16:30:00Z'), LA), 9 * 60 + 30);
    assert.ok(Number.isNaN(I.toInstant('not a time', LA)));
    assert.equal(I.toInstant('2026-10-12T09:30', 'UTC'), Date.parse('2026-10-12T09:30:00Z'));
});

test('days: adding, weeks, months', () => {
    assert.equal(I.addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(I.addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(I.daysBetween('2026-10-11', '2026-11-11'), 31);
    assert.equal(I.weekdayOf('2026-10-11'), 0);
    assert.equal(I.weekStartOf('2026-10-14', 0), '2026-10-11');
    assert.equal(I.weekStartOf('2026-10-14', 1), '2026-10-12');
    assert.equal(I.weekStartOf('2026-10-11', 1), '2026-10-05');
    assert.equal(I.addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(I.addMonths('2026-11-15', 2), '2027-01-15');
    assert.equal(I.addMonths('2026-01-15', -1), '2025-12-15');
    assert.equal(I.isDay('2026-02-29'), false);
    assert.equal(I.isDay('2028-02-29'), true);
    assert.equal(I.weekStartFrom({ weekStart: 1 }), 1);
    assert.equal(I.weekStartFrom({ weekStart: 0 }), 0);
    assert.ok([0, 1, 6].includes(I.weekStartFrom({})));
});

test('what each view shows', () => {
    const week = I.rangeOf('week', '2026-10-14', 1, LA);
    assert.deepEqual([week.first, week.last, week.days.length], ['2026-10-12', '2026-10-18', 7]);
    assert.equal(week.from, I.startOfDay('2026-10-12', LA));
    assert.equal(week.to, I.startOfDay('2026-10-19', LA));
    // A narrow page's week: three days from the day.
    const narrow = I.rangeOf('week', '2026-10-14', 1, LA, { compact: true });
    assert.deepEqual(plain(narrow.days), ['2026-10-14', '2026-10-15', '2026-10-16']);
    // A month: whole weeks around it.
    const month = I.rangeOf('month', '2026-10-14', 0, LA);
    assert.deepEqual([month.first, month.last], ['2026-09-27', '2026-10-31']);
    const monthMon = I.rangeOf('month', '2026-11-03', 1, LA);
    assert.deepEqual([monthMon.first, monthMon.last], ['2026-10-26', '2026-12-06']);
    assert.equal(I.rangeOf('day', '2026-10-14', 1, LA).days.length, 1);
    assert.equal(I.rangeOf('agenda', '2026-10-14', 1, LA).days.length, 30);
    assert.equal(I.stepFrom('week', '2026-10-14', 1), '2026-10-21');
    assert.equal(I.stepFrom('week', '2026-10-14', -1, true), '2026-10-11');
    assert.equal(I.stepFrom('month', '2026-10-31', 1), '2026-11-01');
});

test('short times for a month\'s day follow the locale', () => {
    const at = (h, m) => Date.parse(`2026-10-12T${String(h + 7).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
    const parts = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: LA }).formatToParts(at(9, 30));
    const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
    if (/^[ap]\.?\s?m\.?$/i.test(period.trim())) {
        assert.equal(I.shortTime(at(9, 30), LA), '9:30am');
        assert.equal(I.shortTime(at(11, 0), LA), '11am');
        assert.equal(I.shortTime(at(15, 5), LA), '3:05pm');
    } else {
        // 24-hour clocks (and other ways of writing the half of the day) as the locale writes them.
        assert.equal(I.shortTime(at(9, 30), LA), parts.map((p) => p.value).join(''));
    }
});

test('text on a calendar\'s color is readable', () => {
    for (const color of I.PALETTE) {
        const text = I.textOn(color);
        const ratio = I.contrast(I.luminance(I.rgbOf(color)), I.luminance(I.rgbOf(text)));
        assert.ok(ratio >= 3, `${color} with ${text}: ${ratio.toFixed(2)}`);
    }
    assert.equal(I.textOn('#ffeb3b'), '#111412');
    assert.equal(I.textOn('#1e3a8a'), '#ffffff');
    assert.equal(I.textOn('not a color'), '#ffffff');
    assert.equal(I.colorOf('nope'), I.PALETTE[0]);
});

test('repeat rules: the Repeat field\'s choices and back', () => {
    const day = '2026-10-12'; // a Monday, the second in October
    const round = (mode) => I.ruleFromRepeat({ ...I.repeatFromRule('', day, false, LA), mode }, day, false, LA);
    assert.equal(round('weekly'), 'FREQ=WEEKLY;BYDAY=MO');
    assert.equal(round('weekdays'), 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    assert.equal(round('monthly'), 'FREQ=MONTHLY;BYMONTHDAY=12');
    assert.equal(round('monthly-nth'), 'FREQ=MONTHLY;BYDAY=2MO');
    assert.equal(round('yearly'), 'FREQ=YEARLY');
    assert.equal(round('none'), '');
    for (const [rule, mode] of [['FREQ=WEEKLY;BYDAY=MO', 'weekly'], ['RRULE:FREQ=WEEKLY', 'weekly'], ['FREQ=DAILY', 'daily'], ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'weekdays'],
        ['FREQ=MONTHLY;BYMONTHDAY=12', 'monthly'], ['FREQ=MONTHLY;BYDAY=2MO', 'monthly-nth'], ['FREQ=YEARLY', 'yearly'], ['FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'custom'],
        ['FREQ=DAILY;COUNT=5', 'custom'], ['FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO', 'keep'], ['FREQ=MONTHLY;BYDAY=3TU', 'keep'], ['garbage', 'keep']]) {
        assert.equal(I.repeatFromRule(rule, day, false, LA).mode, mode, rule);
    }
    // A rule the field can't show is kept exactly as it was.
    const odd = I.repeatFromRule('FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO', day, false, LA);
    assert.equal(I.ruleFromRepeat(odd, day, false, LA), 'FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO');
    // Custom: every 2 weeks on Monday and Wednesday, until a day (its last second on the event's clock).
    const custom = I.repeatFromRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', day, false, LA);
    custom.custom = { ...custom.custom, end: 'on', until: '2026-12-31' };
    assert.equal(I.ruleFromRepeat(custom, day, false, LA), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270101T075959Z');
    const back = I.repeatFromRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20270101T075959Z', day, false, LA);
    assert.equal(back.custom.until, '2026-12-31');
    assert.equal(I.ruleFromRepeat({ ...custom, custom: { ...custom.custom, end: 'on' } }, day, true, LA), 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231');
    assert.equal(I.repeatProblem({ mode: 'custom', custom: { ...custom.custom, days: [] } }, day), 'Pick at least one day of the week.');
    assert.equal(I.repeatProblem({ mode: 'custom', custom: { ...custom.custom, until: '2026-01-01' } }, day), 'The end date is on or after the start.');
});

test('events side by side in a day: close starts share the width, a later one goes over, indented', () => {
    const round = (n) => Number(n.toFixed(3));
    const place = (items, maxCols) => Object.fromEntries([...I.columnsOf(items, 20, 30, maxCols).places].map(([key, p]) => [key, [round(p.left), round(p.width), p.level]]));
    // Alone: the whole column.
    assert.deepEqual(place([{ key: 'a', from: 540, to: 600 }]), { a: [0, 1, 0] });
    // Starting together: halves.
    assert.deepEqual(place([{ key: 'a', from: 540, to: 600 }, { key: 'b', from: 540, to: 570 }]), { a: [0, 0.5, 0], b: [0.5, 0.5, 0] });
    // One that starts an hour into a long one: over it, indented, the first keeps its width.
    assert.deepEqual(place([{ key: 'long', from: 540, to: 720 }, { key: 'later', from: 600, to: 660 }]), { long: [0, 1, 0], later: [0.14, 0.86, 1] });
    // Back to back: no overlap, each the whole column.
    assert.deepEqual(place([{ key: 'a', from: 540, to: 600 }, { key: 'b', from: 600, to: 660 }]), { a: [0, 1, 0], b: [0, 1, 0] });
    // Four at the same time: quarters.
    const four = place(['a', 'b', 'c', 'd'].map((key) => ({ key, from: 600, to: 660 })));
    assert.deepEqual(Object.values(four).map((p) => p[1]), [0.25, 0.25, 0.25, 0.25]);
    assert.deepEqual(Object.values(four).map((p) => p[0]).sort(), [0, 0.25, 0.5, 0.75]);
    // More than fit side by side: the first ones in thirds, and "+2" in the last third for the others.
    const crowd = ['a', 'b', 'c', 'd'].map((key) => ({ key, from: 600, to: 660 }));
    const capped = I.columnsOf(crowd, 20, 30, 3);
    assert.deepEqual(Object.keys(place(crowd, 3)), ['a', 'b']);
    assert.deepEqual(plain(capped.more.map((m) => [round(m.left), round(m.width), m.from, m.to, m.count])), [[0.667, 0.333, 600, 660, 2]]);
    // Ones left out at different times get a "+N" each.
    const spread = [...crowd, { key: 'e', from: 600, to: 900 }, { key: 'f', from: 840, to: 870 }, { key: 'g', from: 840, to: 870 }];
    const runs = I.columnsOf(spread, 20, 30, 3).more.map((m) => [m.from, m.to, m.count]);
    assert.deepEqual(plain(runs), [[600, 660, 3], [840, 870, 1]]);
    // Room enough: nothing left out.
    assert.equal(I.columnsOf(crowd, 20, 30, 8).more.length, 0);
});

test('a day\'s timed events on its clock, and the all-day row\'s bars', () => {
    const ev = (id, start, end, extra = {}) => ({ id, start: Date.parse(start), end: Date.parse(end), ...extra });
    const late = ev('late', '2026-10-13T05:00:00Z', '2026-10-13T08:00:00Z'); // 22:00–01:00 in Los Angeles
    const segs = I.daySegments([late, ev('x', '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z')], '2026-10-12', LA);
    assert.deepEqual(plain(segs.map((s) => [s.key, s.from, s.to])), [['late', 22 * 60, 1440], ['x', 9 * 60, 10 * 60]]);
    assert.deepEqual(plain(I.daySegments([late], '2026-10-13', LA).map((s) => [s.from, s.to])), [[0, 60]]);
    const days = I.daySpan('2026-10-11', '2026-10-17');
    // An overnight event stays on the day it starts in a month's row; an all-day one spans its days, cut at the row's ends.
    const all = I.barItems([late, { id: 'trip', allDay: true, startDay: '2026-10-09', lastDay: '2026-10-12', start: 0, end: 0 }], days, LA, () => true);
    assert.deepEqual(plain(all.map((b) => [b.key, b.a, b.b, b.contStart, b.contEnd])), [['late', 1, 1, false, false], ['trip', 0, 1, true, false]]);
    // Lanes, and "+N more" where a day has more than fit.
    const layout = I.lanesOf([{ key: 'a', a: 0, b: 2 }, { key: 'b', a: 1, b: 1 }, { key: 'c', a: 1, b: 1 }], 7);
    assert.equal(layout.lanes, 3);
    const fit = I.fitLanes(layout, 2);
    assert.deepEqual(plain(fit.more), [{ day: 1, count: 2, lane: 1 }]);
    assert.deepEqual(plain(fit.pieces.map((p) => [p.key, p.a, p.b])), [['a', 0, 2]]);
});

test('a failed call in one sentence: the plugin\'s own words where it has them', () => {
    assert.equal(I.errorText({ code: 'calendar/refused', message: 'that calendar is read-only' }), 'That calendar is read-only.');
    assert.equal(I.errorText({ code: 'calendar/needs-notify', message: 'Saving this emails an update to ann@example.com' }), 'Saving this emails an update to ann@example.com.');
    assert.equal(I.errorText({ code: 'calendar/unreachable', message: 'x' }), I.TEXT.unreachable);
    assert.match(I.errorText({ code: 'calendar/failed', message: 'the server said no' }), /^That didn't work: The server said no\.$/);
    assert.equal(I.errorText(undefined), I.TEXT.unreachable);
});

test('who a change can email, as far as the window can tell', () => {
    const cal = (kind, canEmail = true) => ({ id: `c-${kind}`, kind, canEmail });
    const own = { id: 'ev-1', organizer: null };
    const organized = { id: 'ev-2', organizer: { email: 'me@example.com' } };
    const invitation = { id: 'ev-3', invitation: true, canRespond: true, organizer: { email: 'boss@example.com' } };
    const mode = (args) => { const m = I.mailMode(args); return `${m.mode}:${m.to}${m.cannot ? ':cannot' : ''}`; };
    // Nobody to tell.
    assert.equal(mode({ kind: 'create', calendar: cal('google'), guests: 0 }), 'none:guests');
    // Google emails only when asked: a box to tick.
    assert.equal(mode({ kind: 'create', calendar: cal('google'), guests: 2 }), 'ask:guests');
    assert.equal(mode({ kind: 'delete', calendar: cal('google'), occurrence: organized, guests: 2 }), 'ask:guests');
    // Microsoft emails them anyway: the host asks (needs-notify), the window says so ahead.
    assert.equal(mode({ kind: 'update', calendar: cal('microsoft'), occurrence: organized, guests: 1 }), 'always:guests');
    // A CalDAV server makes a meeting of the user's own event only when told to; one they organize gets emailed anyway.
    assert.equal(mode({ kind: 'create', calendar: cal('caldav'), guests: 1 }), 'ask:guests');
    assert.equal(mode({ kind: 'update', calendar: cal('caldav'), occurrence: own, guests: 1 }), 'ask:guests');
    assert.equal(mode({ kind: 'update', calendar: cal('caldav'), occurrence: organized, guests: 1 }), 'always:guests');
    // Calendars that can't email (kept in DSH, subscriptions, CalDAV without scheduling): never offered, and said.
    assert.equal(mode({ kind: 'create', calendar: cal('local', false), guests: 1 }), 'none:guests:cannot');
    assert.equal(mode({ kind: 'delete', calendar: cal('local', false), occurrence: own, guests: 1 }), 'none:guests');
    // Someone else's invitation: no change emails anyone, taking it out may tell the organizer.
    assert.equal(mode({ kind: 'update', calendar: cal('google'), occurrence: invitation, guests: 3 }), 'none:organizer');
    assert.equal(mode({ kind: 'delete', calendar: cal('google'), occurrence: invitation, guests: 3 }), 'ask:organizer');
    assert.equal(mode({ kind: 'delete', calendar: cal('microsoft'), occurrence: invitation, guests: 3 }), 'none:organizer');
    assert.equal(mode({ kind: 'delete', calendar: cal('caldav'), occurrence: invitation, guests: 3, scope: 'one' }), 'always:organizer');
    assert.equal(I.roleOf(invitation), 'guest');
    assert.equal(I.roleOf(own), 'own');
    assert.equal(I.roleOf(organized), 'organizer');
    assert.deepEqual(I.othersOf([{ email: 'me@example.com', self: true }, { email: 'ann@example.com' }, { name: 'no address' }]).map((p) => p.email), ['ann@example.com']);
});

test('notify goes to the host only after the user\'s own click', async () => {
    const draft = (extra = {}) => ({
        title: 'Review', allDay: false, startDay: '2026-10-12', startTime: '09:00', endDay: '2026-10-12', endTime: '10:00', timeZone: LA,
        repeat: { mode: 'none', custom: {} }, calendarId: 'c-1', location: '', url: '', description: '', alarms: [], guests: [{ email: 'ann@example.com' }],
        busy: true, private: false, notify: null, ...extra,
    });
    assert.equal(I.createInput(draft()).notify, undefined);
    assert.equal(I.createInput(draft({ notify: true })).notify, true);
    assert.equal(I.createInput(draft({ notify: true, guests: [] })).notify, undefined);
    const before = draft();
    assert.equal(I.changePatch(before, draft({ title: 'Review 2' }), { repeatTouched: false, originalRule: '' }).notify, undefined);
    assert.equal(I.changePatch(before, draft({ title: 'Review 2', notify: true }), { repeatTouched: false, originalRule: '' }).notify, true);
    // Nothing changed: no patch, so nobody is told anything.
    assert.deepEqual({ ...I.changePatch(before, draft({ notify: true }), { repeatTouched: false, originalRule: '' }) }, {});

    // The host says the change would email people: the user is asked with its words; only Send makes it again,
    // with notify, held to the people the user was shown (approved).
    const refusal = { ok: false, error: { code: 'calendar/needs-notify', message: 'Saving this emails an update to ann@example.com', details: { people: ['ann@example.com', 7] } } };
    const calls = [];
    const make = (answer, first = refusal) => async (how) => { calls.push(plain(how)); return how.notify ? answer : first; };
    const asked = [];
    const ask = (send) => async (text, keep) => { asked.push([text, keep]); return send; };
    const done = { ok: true, value: { occurrence: { id: 'ev-1', emailed: { what: 'an update', to: ['ann@example.com'] } } } };
    assert.deepEqual(await I.withConsent(ask(true), 'Don\'t change it', make(done)), done);
    assert.deepEqual(calls, [{}, { notify: true, approved: ['ann@example.com'] }]);
    assert.deepEqual(asked, [['Saving this emails an update to ann@example.com.', 'Don\'t change it']]);
    calls.length = 0;
    const kept = await I.withConsent(ask(false), 'Don\'t change it', make(done));
    assert.equal(kept.kept, true);
    assert.deepEqual(calls, [{}]);
    // A refusal that names nobody: Send says notify alone, and the host holds the change to its own first look.
    calls.length = 0;
    const unnamed = { ok: false, error: { code: 'calendar/needs-notify', message: 'Saving this emails invitations' } };
    assert.deepEqual(await I.withConsent(ask(true), 'Don\'t add it', make(done, unnamed)), done);
    assert.deepEqual(calls, [{}, { notify: true }]);
    // The event changed between the question and Send: the host's refusal comes back as it is, not tried again.
    calls.length = 0;
    const changed = { ok: false, error: { code: 'calendar/changed', message: 'The event changed since this change was looked at' } };
    assert.deepEqual(await I.withConsent(ask(true), 'Don\'t change it', make(changed)), changed);
    assert.equal(calls.length, 2);
    // Any other answer is the result as it is, asked nothing.
    calls.length = 0;
    asked.length = 0;
    const refused = { ok: false, error: { code: 'calendar/refused', message: 'read-only' } };
    assert.deepEqual(await I.withConsent(ask(true), 'x', async (how) => { calls.push(plain(how)); return refused; }), refused);
    assert.deepEqual([calls, asked], [[{}], []]);
});

test('a series that would lose part of itself on a move asks first, then may ask about emails too', async () => {
    const words = 'Moving this series to Calendar would drop 1 occurrence changed on its own: Microsoft takes a new repeating event as its rule alone.';
    const drops = { ok: false, error: { code: 'calendar/drops-changes', message: words } };
    const needs = { ok: false, error: { code: 'calendar/needs-notify', message: 'Moving it emails invitations to ann@example.com', details: { people: ['ann@example.com'] } } };
    const done = { ok: true, value: { occurrence: { id: 'ev-9', calendarId: 'c-ms' } } };
    const run = async ({ dropAnswer, sendAnswer, answers, drop = true }) => {
        const calls = [];
        const questions = [];
        const make = async (how) => { calls.push(plain(how)); return answers[calls.length - 1]; };
        const ask = async (text) => { questions.push(['send', text]); return sendAnswer; };
        const dropAsk = async (text) => { questions.push(['drop', text]); return dropAnswer; };
        const result = await I.withConsent(ask, 'Don\'t move it', make, drop ? dropAsk : undefined);
        return { result, calls, questions };
    };
    // Move anyway: made again with dropChanges.
    let r = await run({ dropAnswer: true, answers: [drops, done] });
    assert.deepEqual(r.result, done);
    assert.deepEqual(r.calls, [{}, { dropChanges: true }]);
    assert.deepEqual(r.questions, [['drop', words]]);
    // Don't move it: nothing more is sent.
    r = await run({ dropAnswer: false, answers: [drops] });
    assert.equal(r.result.kept, true);
    assert.equal(r.result.error.code, 'calendar/drops-changes');
    assert.deepEqual(r.calls, [{}]);
    // Moved anyway, then it would email people: asked again, and Send keeps dropChanges.
    r = await run({ dropAnswer: true, sendAnswer: true, answers: [drops, needs, done] });
    assert.deepEqual(r.result, done);
    assert.deepEqual(r.calls, [{}, { dropChanges: true }, { dropChanges: true, notify: true, approved: ['ann@example.com'] }]);
    assert.deepEqual(r.questions.map((q) => q[0]), ['drop', 'send']);
    // Without a way to ask (no move there), the refusal is the answer.
    r = await run({ drop: false, answers: [drops] });
    assert.deepEqual(r.result, drops);
    assert.deepEqual(r.calls, [{}]);
});

test('the window\'s own refusals keep the host\'s words', () => {
    for (const code of ['calendar/changed', 'calendar/drops-changes', 'calendar/choose-calendar']) {
        assert.equal(I.errorText({ code, message: 'the host says why' }), 'The host says why.');
    }
    assert.equal(I.CHOOSE_CALENDAR, 'Choose the calendar it goes to.');
});

test('what was emailed, in a sentence', () => {
    assert.equal(I.emailedText({ what: 'an update', to: ['ann@example.com', 'bob@example.com'] }), 'Emailed an update to ann@example.com and bob@example.com.');
    assert.equal(I.emailedText({ what: 'the invitation', to: ['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org', 'e@x.org'] }), 'Emailed the invitation to a@x.org, b@x.org, c@x.org and 2 others.');
    assert.equal(I.emailedText({ to: [] }), '');
    assert.equal(I.emailedText(undefined), '');
});

test('who a change emailed, and whose calendars it reached without email', () => {
    const ann = ['ann@example.com'];
    assert.equal(I.contactText({ reached: { how: 'add', to: ann } }), 'Put on the calendars of ann@example.com, without emailing anyone.');
    assert.equal(I.contactText({ reached: { how: 'remove', to: ['ann@example.com', 'bob@example.com'] } }), 'Taken off the calendars of ann@example.com and bob@example.com, without emailing anyone.');
    assert.equal(I.contactText({ reached: { how: 'change', to: ann } }), 'Changed on the calendars of ann@example.com, without emailing anyone.');
    assert.equal(I.contactText({ reached: { how: 'other', to: ann } }), 'Changed on the calendars of ann@example.com, without emailing anyone.');
    // Emailed some, reached others.
    assert.equal(I.contactText({ emailed: { what: 'a cancellation', to: ann }, reached: { how: 'add', to: ['bob@example.com'] } }),
        'Emailed a cancellation to ann@example.com. Put on the calendars of bob@example.com.');
    assert.equal(I.contactText({ emailed: { what: 'an update', to: ann } }), 'Emailed an update to ann@example.com.');
    for (const nothing of [undefined, {}, { reached: { how: 'add', to: [] } }, { reached: { how: 'add', to: [1, ''] } }, { reached: 'ann' }]) assert.equal(I.contactText(nothing), '');
});

test('after a move, the other changes go to the same occurrence in the moved event', () => {
    const moved = { id: 'ev-new.20261012T093000', eventId: 'ev-new', calendarId: 'c-2' };
    assert.equal(I.sameOccurrence(moved, { id: 'ev-old.20261019T093000' }).id, 'ev-new.20261019T093000');
    assert.equal(I.sameOccurrence({ id: 'ev-new', eventId: 'ev-new' }, { id: 'ev-old' }).id, 'ev-new');
    const before = { id: 'ev-old.20261019T093000' };
    assert.equal(I.sameOccurrence(undefined, before), before);
    // An answer the page can follow has its time; a move the host lost sight of answers with an id alone.
    assert.equal(I.placed({ id: 'ev-1', start: Date.UTC(2026, 9, 12, 9), end: Date.UTC(2026, 9, 12, 10) }), true);
    assert.equal(I.placed({ id: 'ev-1', allDay: true, startDay: '2026-10-12' }), true);
    for (const stub of [undefined, null, { id: 'ev-1' }, { id: 'ev-1', allDay: true }, { start: 1 }, { id: 'ev-1', start: Number.NaN }]) assert.equal(I.placed(stub), false);
});

test('a new event goes to the default calendar, or to one the user picks when there is none', () => {
    const calendars = [
        { id: 'c-work', account: 'Work', kind: 'google', name: 'Work', readOnly: false },
        { id: 'c-home', account: 'Home', kind: 'caldav', name: 'Home', readOnly: false },
        { id: 'c-feed', account: 'Holidays', kind: 'ics', name: 'Holidays', readOnly: true },
    ];
    const chosen = I.writableCalendars({ calendars, defaultCalendar: 'c-home' });
    assert.deepEqual(plain(chosen.list.map((c) => c.id)), ['c-work', 'c-home']);
    assert.equal(chosen.defaultId, 'c-home');
    // No default (nothing chosen, and no main calendar stands out): none is picked for the user.
    for (const defaultCalendar of [undefined, null, '', 'c-feed', 'c-gone']) assert.equal(I.writableCalendars({ calendars, defaultCalendar }).defaultId, '');
    const draft = I.draftFrom({ preset: { startDay: '2026-10-12', startTime: '09:00' }, state: { calendars }, zone: LA });
    assert.equal(draft.calendarId, '');
    assert.equal(I.draftFrom({ preset: { calendarId: 'c-work' }, state: { calendars }, zone: LA }).calendarId, 'c-work');
    assert.equal(I.draftFrom({ preset: {}, state: { calendars, defaultCalendar: 'c-work' }, zone: LA }).calendarId, 'c-work');
    // Saving asks for one, or, when none can be written, says so.
    const titled = { ...draft, title: 'Planning' };
    assert.deepEqual(plain(I.draftProblems(titled, 2)), { calendarId: 'Choose the calendar it goes to.' });
    assert.match(I.draftProblems(titled, 0).calendarId, /^There is no calendar that can be written/);
    assert.deepEqual(plain(I.draftProblems({ ...titled, calendarId: 'c-work' }, 2)), {});
});

test('after removing an account: DSH\'s access withdrawn, or the page to withdraw it on', () => {
    const google = { id: 'a-1', kind: 'google', name: 'ann@gmail.com' };
    const microsoft = { id: 'a-2', kind: 'microsoft', name: 'pat@outlook.com' };
    const caldav = { id: 'a-3', kind: 'caldav', name: 'Fastmail' };
    assert.deepEqual(plain(I.removalNotice(google, { revoked: true })), { toast: 'Removed ann@gmail.com. DSH\'s access was withdrawn at Google.' });
    // Google couldn't be reached: its page.
    const unreached = I.removalNotice(google, { revoked: false, manageUrl: 'https://myaccount.google.com/linkedapps' });
    assert.equal(unreached.toast, 'Removed ann@gmail.com.');
    assert.equal(unreached.manageUrl, 'https://myaccount.google.com/linkedapps');
    assert.match(unreached.text, /^Google couldn't be reached to withdraw DSH's access to ann@gmail\.com\./);
    // Microsoft: always its page, as an app can't withdraw its own access there.
    const ms = I.removalNotice(microsoft, { revoked: false, manageUrl: 'https://account.live.com/consent/Manage' });
    assert.equal(ms.manageUrl, 'https://account.live.com/consent/Manage');
    assert.match(ms.text, /^Microsoft doesn't let an app withdraw its own access/);
    // Neither: nothing more is said. A page only on https.
    assert.deepEqual(plain(I.removalNotice(caldav, {})), { toast: 'Removed Fastmail.' });
    assert.deepEqual(plain(I.removalNotice(caldav, undefined)), { toast: 'Removed Fastmail.' });
    assert.deepEqual(plain(I.removalNotice(microsoft, { manageUrl: 'http://account.live.com/consent/Manage' })), { toast: 'Removed pat@outlook.com.' });
    assert.deepEqual(plain(I.removalNotice(microsoft, { manageUrl: 'javascript:alert(1)' })), { toast: 'Removed pat@outlook.com.' });
});

test('a sign-in\'s way back to DSH, for the address to paste', () => {
    const ms = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=x&redirect_uri=http%3A%2F%2Flocalhost%3A53122&response_type=code';
    assert.equal(I.returnAddress(ms), 'http://localhost:53122');
    const google = 'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A4100%2F&client_id=y';
    assert.equal(I.returnAddress(google), 'http://127.0.0.1:4100');
    // Only an address on the computer DSH runs on.
    assert.equal(I.returnAddress('https://login.example.com/authorize?redirect_uri=https%3A%2F%2Fexample.com%2F'), '');
    assert.equal(I.returnAddress('not an address'), '');
    assert.equal(I.returnAddress(undefined), '');
});

test('a call\'s arguments for its card, as far as they have streamed', () => {
    assert.deepEqual({ ...I.callArgs({ argsRaw: '{"title":"Dentist","start":"2026-10-13T09:30","calendarId":"c"}' }) }, { title: 'Dentist', start: '2026-10-13T09:30' });
    assert.deepEqual({ ...I.callArgs({}, '{"title":"Dent') }, { title: 'Dent' });
    assert.deepEqual({ ...I.callArgs({ args: { text: (key) => (key === 'query' ? 'dentist' : undefined) } }) }, { query: 'dentist' });
    assert.equal(I.runningTitle('calendar_create_event', { title: 'Dentist', start: '2026-10-13T09:30' }).startsWith('Add “Dentist” at '), true);
    assert.equal(I.runningTitle('calendar_events', {}), 'Calendar for the week');
    // A move's card says where it went.
    assert.equal(I.doneTitle({ kind: 'moved', occurrence: { title: 'Team sync', calendar: 'Calendar' } }, {}, LA), 'Moved “Team sync” to Calendar');
});
