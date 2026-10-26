/**
 * Offline tests for dsh-plugin-notifications: the settings and their
 * checks, the per-platform sender choice, the queue the browser half takes
 * and what the window reports back, the recent list and the log lines that
 * prove each outcome, the state kept across restarts, the endpoints, the
 * host wiring, the coordinator's news contract, and the browser half's
 * sender and pure helpers. No DSH install and no network: a fake spawn, a
 * fake desktopRuntime and a fake Notification stand in for the real
 * senders, so nothing here shows a real notification.
 *
 * DSH's own packages (the plugin's peers) come from the newest runtime
 * under `.e2e/` (peers.mjs); without one, the tests that need them are
 * skipped and say so.
 *
 * Run:  node --test plugins/notifications/test/notifications.test.js   (npm test runs it too)
 */
import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Notifier, EVENT_FIELDS, BROWSER_TTL_MS, MAX_QUEUED, QUEUE_STALE_MS, RECENT_MAX, TITLE_MAX, WINDOW_OUTCOMES } from '../lib/notifier.js';
import { oneLine, cliCommand, cliSend, desktopSend, iconFor } from '../lib/backends.js';
import { checkSettings, DEFAULTS, TITLES } from '../lib/config.js';
import { StateFile, parseState, emptyState } from '../lib/state.js';

register('./peers.mjs', import.meta.url);
const peers = await import('@deepseek-ai/dsh-typert-protocol').then(async (protocol) => ({
    protocol,
    remote: await import('../lib/remote.js'),
    plugin: await import('../lib/index.js'),
    projects: await import('../../coordinator/lib/projects.js'),
    coordinator: await import('../../coordinator/lib/index.js'),
})).catch((error) => {
    console.log(`# DSH's packages were not found (${String(error?.message ?? error).slice(0, 120)}): link .e2e to run the tests that need them`);
    return undefined;
});
const needsPeers = peers ? {} : { skip: 'DSH\'s packages are not here: link .e2e (see the README)' };

// The browser half is loaded once, in the module format DSH serves: a window
// with a module loader, then the file. Each test runs the factory again with
// its own fake `require`.
const clientMetas = [];
globalThis.window = { __ModuleLoader__: { load: (meta) => clientMetas.push(meta) } };
await import('../lib/client.js');
delete globalThis.window;
if (clientMetas.length !== 1) throw new Error(`the browser half loaded ${clientMetas.length} times`);
/** @returns the plugin's own test helpers, from a fresh factory run. */
const clientInternals = (requireImpl = () => ({})) => clientMetas[0].factory(requireImpl).internals;

const CONFIG = { ...DEFAULTS };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A logger that keeps its lines, as cordis would print them ('%s' first). */
function lines() {
    const out = [];
    const keep = (level) => (...args) => out.push(`${level} ${args[0] === '%s' ? args.slice(1).join(' ') : args.join(' ')}`);
    return { out, logger: { info: keep('info'), warn: keep('warn') } };
}

/** A store in memory, shaped like StateFile. */
function memoryStore(initial) {
    let saved = initial ? JSON.parse(JSON.stringify(initial)) : undefined;
    return {
        saves: 0,
        load: () => parseState(saved ? JSON.parse(JSON.stringify(saved)) : undefined),
        save(state) { this.saves += 1; saved = JSON.parse(JSON.stringify(state)); return true; },
        get saved() { return saved; },
    };
}

/** A fake cordis context: provide records, inject runs only with every service, like DSH's. */
function fakeCtx(services = {}, logger = { info() {}, warn() {} }) {
    const provided = new Map();
    const effects = [];
    const ctx = {
        provided,
        effects,
        logger,
        provide(name, value) { provided.set(name, value); return () => provided.delete(name); },
        inject(names, fn) {
            if (!names.every((name) => services[name])) return;
            return fn(Object.assign(Object.create(ctx), Object.fromEntries(names.map((name) => [name, services[name]]))));
        },
        effect(fn) { effects.push(fn()); },
    };
    return ctx;
}

const withTempHome = async (fn) => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-notifications-unit-'));
    const before = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
        return await fn(home);
    } finally {
        if (before === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = before;
        rmSync(home, { recursive: true, force: true });
    }
};

// ── The senders ──────────────────────────────────────────────────────

test('senders: one line', () => {
    assert.equal(oneLine('  a\n\nb\tc  '), 'a b c');
    assert.equal(oneLine(undefined), '');
});

test('senders: the platform command and its quoting', () => {
    // macOS takes no command-line sender at all: osascript cannot set a
    // per-notification icon, so its posts show Script Editor's icon.
    assert.equal(cliCommand('darwin', { title: 'T', body: 'B' }), null);
    assert.equal(cliSend('darwin', { title: 'T', body: 'B' }, { spawnImpl: () => assert.fail('macOS must not spawn a sender') }), false);
    assert.deepEqual(cliCommand('linux', { title: 'T', body: 'B' }),
        { command: 'notify-send', args: ['--app-name=DSH', 'T', 'B'] });
    assert.deepEqual(cliCommand('linux', { title: 'T', body: 'B' }, { path: '/i/whale.svg' }),
        { command: 'notify-send', args: ['--app-name=DSH', '--icon=/i/whale.svg', 'T', 'B'] });
    const win = cliCommand('win32', { title: "it's", body: 'B' });
    assert.equal(win.command, 'powershell.exe');
    assert.match(win.args[3], /CreateTextNode\('it''s'\)/);
    assert.doesNotMatch(win.args[3], /ToastImageAndText02/);
    const winIcon = cliCommand('win32', { title: 'T', body: 'B' }, { path: 'C:\\icons\\whale.png' });
    assert.match(winIcon.args[3], /ToastImageAndText02/);
    assert.match(winIcon.args[3], /file:\/\/\/C:\/icons\/whale\.png/);
    assert.equal(cliCommand('sunos', { title: 'T', body: 'B' }), null);
});

test('senders: a missing command is reported, never thrown', () => {
    const errors = [];
    const failed = cliSend('linux', { title: 'T', body: 'B' }, { spawnImpl: () => { throw new Error('no notify-send'); }, onError: (e) => errors.push(e) });
    assert.equal(failed, false);
    assert.match(String(errors[0]), /notify-send/);
    assert.equal(cliSend('sunos', { title: 'T', body: 'B' }, {}), false);
});

test('senders: a command that fails or hangs is reported once', async () => {
    const children = [];
    const spawnImpl = () => {
        const child = new EventEmitter();
        child.kill = () => child.emit('close', null, 'SIGTERM');
        children.push(child);
        return child;
    };
    const errors = [];
    assert.equal(cliSend('linux', { title: 'T', body: 'B' }, { spawnImpl, onError: (e) => errors.push(String(e.message)) }), true);
    children[0].emit('close', 1, null);
    children[0].emit('error', new Error('later'));
    assert.deepEqual(errors, ['notify-send exited with code 1'], 'one report, the first');
    assert.equal(cliSend('linux', { title: 'T', body: 'B' }, { spawnImpl, timeoutMs: 5, onError: (e) => errors.push(String(e.message)) }), true);
    await new Promise((r) => setTimeout(r, 30));
    assert.match(errors[1], /notify-send was stopped after/);
    const ok = [];
    cliSend('linux', { title: 'T', body: 'B' }, { spawnImpl, onError: (e) => ok.push(e) });
    children[2].emit('close', 0, null);
    assert.deepEqual(ok, [], 'a clean exit reports nothing');
});

test('senders: iconFor picks what each platform can show, and the command gets it', () => {
    assert.match(iconFor('linux').path, /icon\.svg$/);
    assert.match(iconFor('win32').path, /icon\.png$/);
    assert.equal(iconFor('darwin'), undefined);
    let seen;
    cliSend('linux', { title: 'T', body: 'B' }, {
        spawnImpl: (command, args) => { seen = { command, args }; return { on() {}, kill() {} }; },
        icon: { path: '/i/whale.svg' },
    });
    assert.deepEqual(seen.args, ['--app-name=DSH', '--icon=/i/whale.svg', 'T', 'B']);
});

test('senders: the desktop sender is DSH\'s own call shape', () => {
    const seen = [];
    desktopSend({ notifyAttention: (n) => seen.push(n) }, { title: 'T', body: 'B' });
    assert.deepEqual(seen, [{ title: 'T', body: 'B' }]);
});

// ── Settings ─────────────────────────────────────────────────────────

test('settings: switches default on; a wrong type counts as the default and is named in words', () => {
    assert.deepEqual(checkSettings({}), { settings: DEFAULTS, problems: [] });
    assert.deepEqual(checkSettings(undefined).settings, DEFAULTS);
    assert.deepEqual(checkSettings('nonsense').settings, DEFAULTS);
    const { settings, problems } = checkSettings({ enabled: 'yes', notifyApproval: false, notifyFleet: 0 });
    assert.equal(settings.enabled, true);
    assert.equal(settings.notifyApproval, false);
    assert.equal(settings.notifyFleet, true);
    assert.deepEqual(problems.map((p) => p.key), ['enabled', 'notifyFleet']);
    assert.equal(problems[0].text, '“Send system notifications” (enabled) must be true or false, but it is "yes"; it counts as on until you change it');
    assert.match(problems[1].text, /^“Fleet findings” \(notifyFleet\) must be true or false, but it is 0;/);
    for (const key of Object.keys(DEFAULTS)) assert.ok(TITLES[key], key);
});

// ── State on disk ────────────────────────────────────────────────────

test('state: saved whole, folder 700 and file 600, read back as it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-notifications-state-'));
    try {
        const file = join(dir, 'notifications', 'state.json');
        const errors = [];
        const store = new StateFile(file, { onError: (what) => errors.push(what) });
        assert.deepEqual(store.load(), emptyState(), 'no file yet: empty, and no error');
        const state = { seq: 3, epoch: 'ab12cd34', queue: [{ id: 3, title: 'T', body: '', at: new Date().toISOString() }], recent: [{ id: 3, title: 'T', body: '', at: new Date().toISOString(), state: 'waiting', detail: 'x', via: 'window' }] };
        assert.equal(store.save(state), true);
        assert.equal(statSync(join(dir, 'notifications')).mode & 0o777, 0o700);
        assert.equal(statSync(file).mode & 0o777, 0o600);
        assert.deepEqual(store.load(), state);
        writeFileSync(file, '{ broken');
        assert.deepEqual(store.load(), emptyState());
        assert.deepEqual(errors, ['its saved state was unreadable, so it starts empty']);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test('state: malformed entries are left out, and ids keep counting up', () => {
    const parsed = parseState({ seq: 2, epoch: 'bad epoch!', queue: [{ id: 9, title: 'T', at: 'x' }, { id: 'no' }], recent: [{ id: 4, title: 'R', at: 'x', state: 'shown' }, { id: 5, title: 'R', at: 'x' }] });
    assert.equal(parsed.seq, 9);
    assert.equal(parsed.epoch, '');
    assert.deepEqual(parsed.queue.map((i) => i.id), [9]);
    assert.deepEqual(parsed.recent.map((i) => i.id), [4]);
    assert.deepEqual(parseState(null), emptyState());
});

// ── The notifier ─────────────────────────────────────────────────────

test('notifier: the settings gate every notification, and each is listed and logged with why', () => {
    const { out, logger } = lines();
    const sent = [];
    const send = () => { sent.push('cli'); return true; };
    const off = new Notifier({ settings: () => ({ ...CONFIG, enabled: false }), send, logger, platform: 'linux' });
    assert.equal(off.notify({ title: 'T', kind: 'handback' }), 'off');
    assert.deepEqual(off.recent.map((e) => [e.state, e.detail]), [['not shown', 'Notifications are switched off in its settings.']]);
    const perKind = new Notifier({ settings: () => ({ ...CONFIG, notifyApproval: false }), send, logger, platform: 'linux' });
    assert.equal(perKind.notify({ title: 'T', kind: 'approval' }), 'off');
    assert.equal(perKind.recent[0].detail, '“Waiting for approval” is switched off in its settings.');
    assert.equal(perKind.notify({ title: 'T', kind: 'handback' }), 'cli');
    // An unknown kind is not gated: the caller's own settings say what it is.
    assert.equal(perKind.notify({ title: 'T' }), 'cli');
    assert.deepEqual(sent, ['cli', 'cli']);
    assert.ok(out.some((line) => line === 'info notifications: #1 (approval) “T” not shown: “Waiting for approval” is switched off in its settings.'), out.join('\n'));
    assert.ok(out.some((line) => /^info notifications: #2 \(handback\) “T” sent: No DSH window was open, so it went to notify-send\.$/.test(line)), out.join('\n'));
});

test('notifier: DSH\'s desktop sender wins where DSH provides it; one that throws is a failure, never a throw', () => {
    const seen = [];
    const notifier = new Notifier({ settings: () => CONFIG, send: () => assert.fail('the cli sender must not run') });
    notifier.desktop = { notifyAttention: (n) => seen.push(n) };
    assert.equal(notifier.notify({ title: 'T', body: 'B' }), 'desktop');
    assert.deepEqual(seen, [{ title: 'T', body: 'B' }]);
    assert.equal(notifier.recent[0].state, 'sent');
    assert.equal(notifier.pending().desktop, true);
    notifier.desktop = { notifyAttention: () => { throw new Error('no window'); } };
    assert.equal(notifier.notify({ title: 'T2' }), 'none');
    assert.deepEqual([notifier.recent[1].state, notifier.recent[1].detail], ['failed', 'DSH\'s desktop notifications refused it: no window.']);
});

test('notifier: the queue for a window: taken, reported shown, and the report is the proof', () => {
    let clock = 1000;
    const { out, logger } = lines();
    const sent = [];
    const notifier = new Notifier({ settings: () => CONFIG, send: () => { sent.push('cli'); return true; }, now: () => clock, logger, platform: 'linux' });
    // No window has polled yet: the command takes it (the browser half is a tab that has not come up).
    assert.equal(notifier.notify({ title: 'T0' }), 'cli');
    notifier.markBrowserSeen();
    assert.equal(notifier.notify({ title: 'T1', body: 'B1', sessionId: 's1' }), 'browser');
    assert.equal(notifier.notify({ title: 'T2', body: 'B2' }), 'browser');
    const pending = notifier.pending();
    assert.equal(pending.desktop, false);
    assert.match(pending.epoch, /^[0-9a-f]{8}$/);
    assert.deepEqual(pending.items.map((item) => [item.title, item.body, item.sessionId]), [['T1', 'B1', 's1'], ['T2', 'B2', undefined]]);
    assert.ok(pending.items.every((item) => Number.isInteger(item.id) && typeof item.at === 'string'));
    const [one, two] = pending.items.map((item) => item.id);
    assert.equal(notifier.entry(one).state, 'waiting');
    // The window takes both: one it shows (its report comes later), one it did not need to (you were looking).
    assert.equal(notifier.acknowledge([one, two], [{ id: two, outcome: 'watching' }]), 2);
    assert.equal(notifier.entry(one).state, 'sent');
    assert.deepEqual([notifier.entry(two).state, notifier.entry(two).detail], ['not shown', 'You were looking at DSH, so no notification was needed.']);
    assert.deepEqual(notifier.pending().items, []);
    // The system's show event, reported by the window: now it is shown, and the log says so.
    assert.equal(notifier.acknowledge([], [{ id: one, outcome: 'shown' }]), 0);
    assert.equal(notifier.entry(one).state, 'shown');
    assert.ok(out.includes(`info notifications: #${one} shown: Shown on screen by DSH's window (the system reported it).`), out.join('\n'));
    // Reports it cannot read change nothing.
    assert.equal(notifier.acknowledge('nope', [null, { id: 'x' }, { id: one, outcome: 'nonsense' }]), 0);
    assert.equal(notifier.entry(one).state, 'shown');
    // A failure with the window's reason, in words.
    notifier.notify({ title: 'T3' });
    const three = notifier.pending().items[0].id;
    notifier.acknowledge([three], [{ id: three, outcome: 'failed', detail: 'Notification is not a constructor' }]);
    assert.deepEqual([notifier.entry(three).state, notifier.entry(three).detail], ['failed', 'DSH\'s window could not show it: Notification is not a constructor.']);
    // The window must keep polling: after the ttl the command takes over again.
    clock += BROWSER_TTL_MS + 1;
    assert.equal(notifier.notify({ title: 'T4' }), 'cli');
    assert.deepEqual(sent, ['cli', 'cli']);
});

test('notifier: a desktop host queues for its hidden window past the poll ttl; macOS never falls to a command', () => {
    let clock = 1000;
    const sent = [];
    const notifier = new Notifier({ settings: () => CONFIG, desktopHost: true, platform: 'darwin', send: () => { sent.push('cli'); return true; }, now: () => clock });
    // No poll has ever arrived: the Desktop app's window still exists (hidden,
    // minimised or behind others), so its renderer is the DSH-icon sender.
    assert.equal(notifier.notify({ title: 'Hidden', body: 'B' }), 'browser');
    clock += BROWSER_TTL_MS + 1;
    assert.equal(notifier.notify({ title: 'Still hidden' }), 'browser');
    assert.deepEqual(sent, [], 'macOS must not fall back to the command line');
    assert.deepEqual(notifier.pending().items.map((item) => item.title), ['Hidden', 'Still hidden']);
    assert.equal(notifier.sender(), 'window');
    // A terminal DSH on macOS with no window: nothing is sent, and the words say why.
    const tab = new Notifier({ settings: () => CONFIG, platform: 'darwin', send: () => assert.fail('macOS has no command sender'), now: () => clock });
    assert.equal(tab.notify({ title: 'T' }), 'none');
    assert.equal(tab.recent[0].detail, 'No DSH window was open to show it, and macOS has no other sender that shows DSH\'s icon.');
    assert.equal(tab.sender(), 'none');
});

test('notifier: the queue sheds items no window took in 5 minutes, and says so', () => {
    let clock = 10_000;
    const notifier = new Notifier({ settings: () => CONFIG, desktopHost: true, send: () => true, now: () => clock });
    notifier.notify({ title: 'Old' });
    clock += QUEUE_STALE_MS + 1;
    notifier.notify({ title: 'New' });
    assert.deepEqual(notifier.pending().items.map((item) => item.title), ['New']);
    assert.deepEqual([notifier.recent[0].state, notifier.recent[0].detail], ['not shown', 'No DSH window took it within 5 minutes, so it was dropped rather than shown late.']);
});

test('notifier: the queue keeps the newest MAX_QUEUED, and the dropped ones say why', () => {
    const notifier = new Notifier({ settings: () => CONFIG, send: () => true, desktopHost: true });
    for (let i = 0; i < MAX_QUEUED + 5; i += 1) notifier.notify({ title: `T${i}` });
    const items = notifier.pending().items;
    assert.equal(items.length, MAX_QUEUED);
    assert.equal(items.at(-1).title, `T${MAX_QUEUED + 4}`);
    assert.equal(notifier.recent[0].detail, `More than ${MAX_QUEUED} waited for a window at once, so the oldest were dropped.`);
    for (let i = 0; i < RECENT_MAX; i += 1) notifier.notify({ title: `More ${i}` });
    assert.equal(notifier.recent.length, RECENT_MAX, 'the recent list keeps its newest');
});

test('notifier: a restart loses nothing and repeats nothing: the queue, the list, the ids and the epoch come back', () => {
    const store = memoryStore();
    const first = new Notifier({ settings: () => CONFIG, desktopHost: true, store });
    first.notify({ title: 'Before', sessionId: 's1' });
    first.notify({ title: 'Taken' });
    const { epoch, items } = first.pending();
    first.acknowledge([items[1].id], [{ id: items[1].id, outcome: 'shown' }]);
    const { out, logger } = lines();
    const second = new Notifier({ settings: () => CONFIG, desktopHost: true, store, logger });
    assert.equal(second.pending().epoch, epoch, 'the same epoch: a window\'s shown list still applies');
    assert.deepEqual(second.pending().items.map((item) => [item.title, item.sessionId]), [['Before', 's1']]);
    assert.deepEqual(second.recent.map((e) => [e.title, e.state]), [['Before', 'waiting'], ['Taken', 'shown']]);
    second.notify({ title: 'After' });
    assert.equal(second.recent.at(-1).id, 3, 'ids go on counting');
    assert.ok(out.includes('info notifications: 1 notification(s) still waiting for DSH\'s window from before the restart'), out.join('\n'));
});

test('notifier: notify never throws, whatever it is given', () => {
    const { out, logger } = lines();
    const broken = new Notifier({ settings: () => { throw new Error('settings gone'); }, logger });
    assert.equal(broken.notify({ title: 'T' }), 'none');
    assert.ok(out.some((line) => line === 'warn notifications: a notification could not be handled: settings gone'), out.join('\n'));
    const notifier = new Notifier({ settings: () => CONFIG, desktopHost: true });
    assert.equal(notifier.notify(null), 'browser');
    assert.equal(notifier.notify('just a string'), 'browser');
    assert.equal(notifier.notify({ title: 42, body: { x: 1 }, kind: 7, sessionId: 9 }), 'browser');
    assert.deepEqual(notifier.recent.map((e) => e.title), ['DSH', 'DSH', '42']);
    assert.equal(notifier.recent[2].sessionId, undefined);
    notifier.notify({ title: 'x'.repeat(500) });
    assert.equal(notifier.recent.at(-1).title.length, TITLE_MAX);
    assert.ok(notifier.recent.at(-1).title.endsWith('…'));
    const badLogger = new Notifier({ settings: () => CONFIG, desktopHost: true, logger: { info() { throw new Error('log gone'); } } });
    assert.equal(badLogger.notify({ title: 'T' }), 'browser', 'a logger that throws never fails a send');
});

test('notifier: a command sender that fails later turns its entry into a failure, and saves it', () => {
    let fail;
    const store = memoryStore();
    const notifier = new Notifier({ settings: () => CONFIG, platform: 'linux', store, send: (_n, onError) => { fail = onError; return true; } });
    assert.equal(notifier.notify({ title: 'T' }), 'cli');
    assert.equal(notifier.recent[0].state, 'sent');
    fail(new Error('spawn notify-send ENOENT'));
    assert.deepEqual([notifier.recent[0].state, notifier.recent[0].detail], ['failed', 'notify-send failed: spawn notify-send ENOENT.']);
    assert.equal(store.saved.recent[0].state, 'failed');
    const never = new Notifier({ settings: () => CONFIG, platform: 'win32', send: () => false });
    assert.equal(never.notify({ title: 'T' }), 'none');
    assert.deepEqual([never.recent[0].state, never.recent[0].detail], ['failed', 'a PowerShell toast could not be started.']);
});

test('notifier: the status the page reads, and the test it logs', () => {
    const notifier = new Notifier({ settings: () => ({ ...CONFIG, enabled: false }), platform: 'darwin', problems: [{ key: 'notifyFleet', text: 'wrong' }] });
    notifier.notify({ title: 'A' });
    const id = notifier.noteTest('shown');
    notifier.noteTest('failed', 'Notification is not a constructor');
    notifier.noteTest('unconfirmed');
    const status = notifier.status();
    assert.equal(status.enabled, false);
    assert.equal(status.sender, 'none');
    assert.deepEqual(status.problems, [{ key: 'notifyFleet', text: 'wrong' }]);
    assert.deepEqual(status.recent.map((e) => [e.title, e.state]), [['Notifications test', 'sent'], ['Notifications test', 'failed'], ['Notifications test', 'shown'], ['A', 'not shown']]);
    assert.equal(status.recent[1].detail, 'DSH\'s window could not show it: Notification is not a constructor.');
    assert.equal(status.recent[2].id, id);
    assert.equal(WINDOW_OUTCOMES.unconfirmed.state, 'sent');
});

// ── The endpoints ────────────────────────────────────────────────────

test('endpoints: the gateway can name every method, so the queue is served (not 404)', needsPeers, () => {
    // The gateway answers "not found" for a namespace whose methods carry no
    // Remote marker — the browser half then never polls and every macOS
    // notification fell to osascript and its Script Editor icon. The marker
    // is what `remoteMethods` reads, exactly what the gateway consults.
    const { NotificationsRemote } = peers.remote;
    const remote = new NotificationsRemote(new Notifier({ settings: () => CONFIG }));
    const named = peers.protocol.remoteMethods(remote).map((marker) => marker.method).sort();
    assert.deepEqual(named, ['acknowledge', 'noteTest', 'pending', 'status']);
    assert.equal(remote.typertRemote.namespace, 'dsh-plugin-notifications');
});

test('endpoints: they mark the window seen and answer it; a failure reaches the window in words', needsPeers, async () => {
    const { NotificationsRemote } = peers.remote;
    const notifier = new Notifier({ settings: () => CONFIG, now: () => 5, platform: 'darwin' });
    const remote = new NotificationsRemote(notifier);
    assert.equal(notifier.lastBrowserSeen, 0);
    const answer = await remote.pending();
    assert.equal(notifier.lastBrowserSeen, 5);
    assert.deepEqual({ ...answer, epoch: 'x' }, { desktop: false, epoch: 'x', items: [] });
    assert.equal(await remote.acknowledge([1, 2], []), 0);
    assert.equal((await remote.status()).sender, 'window');
    assert.equal(typeof await remote.noteTest('shown', ''), 'number');
    notifier.status = () => { throw new Error('disk gone'); };
    await assert.rejects(() => remote.status(), (error) => error instanceof peers.protocol.RemoteError && /^Notifications could not answer: disk gone$/.test(error.message));
});

// ── The host half ────────────────────────────────────────────────────

test('host: it wires the service, DSH\'s desktop runtime and the endpoints, keeps its state in DSH\'s data folder, and logs its start', needsPeers, async () => {
    await withTempHome(async (home) => {
        const attention = [];
        const providedThroughGateway = new Map();
        const { out, logger } = lines();
        const ctx = fakeCtx({
            desktopRuntime: { notifyAttention: (n) => attention.push(n) },
            typertGateway: { provide: (name, value) => providedThroughGateway.set(name, value) },
        }, logger);
        peers.plugin.apply(ctx, peers.plugin.Config({}));
        assert.ok(ctx.provided.has('notifications'), 'the notifications service is provided');
        assert.equal(ctx.provided.get('notifications').notify({ title: 'T', body: 'B', kind: 'handback' }), 'desktop');
        assert.deepEqual(attention, [{ title: 'T', body: 'B' }]);
        const remote = ctx.provided.get(peers.remote.SERVICE);
        assert.ok(remote instanceof peers.remote.NotificationsRemote, 'the gateway serves the remote');
        assert.equal((await remote.pending()).desktop, true);
        assert.ok(out.some((line) => /^info notifications: started \(on; /.test(line)), out.join('\n'));
        assert.ok(out.includes('info notifications: DSH\'s own desktop notifications are here: they send from now on'));
        const file = join(home, 'notifications', 'state.json');
        assert.ok(existsSync(file), 'the state file is in DSH\'s data folder');
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).recent[0].title, 'T');
        assert.equal(statSync(file).mode & 0o777, 0o600);
    });
});

test('host: switched off it still answers callers, with \'off\'; a wrong setting never stops it', needsPeers, async () => {
    await withTempHome(async () => {
        const off = fakeCtx({ typertGateway: { provide() {} } });
        peers.plugin.apply(off, peers.plugin.Config({ enabled: false }));
        assert.equal(off.provided.get('notifications').notify({ title: 'T' }), 'off');
        const { out, logger } = lines();
        const wrong = fakeCtx({ typertGateway: { provide: (name, value) => wrong.provided.set(name, value) } }, logger);
        const config = peers.plugin.Config({ notifyHandback: 'no', enabled: 1 });
        assert.doesNotThrow(() => peers.plugin.apply(wrong, config));
        assert.ok(out.some((line) => line.startsWith('warn notifications: a setting is wrong: “Handbacks” (notifyHandback) must be true or false, but it is "no"')), out.join('\n'));
        const status = wrong.provided.get(peers.remote.SERVICE).notifier.status();
        assert.deepEqual(status.problems.map((p) => p.key), ['enabled', 'notifyHandback']);
        assert.equal(status.enabled, true, 'a wrong master switch counts as on, as the page says');
    });
});

// ── The coordinator's news, the plugin's main caller ─────────────────

test('callers: the coordinator notes its news to the sink, with the thread\'s session', needsPeers, () => {
    const sinks = [];
    const puts = [];
    const manager = {
        store: {
            project: () => ({ news: {} }),
            thread: () => ({ title: 'Fix CI', sessionId: 's9' }),
            putProject: (id, patch) => puts.push(patch),
        },
        log: () => {},
        newsSink: (item) => sinks.push(item),
    };
    peers.projects.ProjectManager.prototype.noteNews.call(manager, 'p1', { kind: 'handback', thread: 't1', status: 'blocked' });
    assert.deepEqual(sinks, [{ seq: 1, kind: 'handback', thread: 't1', title: 'Fix CI', status: 'blocked', at: sinks[0].at, session: 's9', projectId: 'p1' }]);
    assert.equal(puts.length, 1);
    // No sink (the plugin is absent or off): the news is still kept, nothing throws.
    peers.projects.ProjectManager.prototype.noteNews.call({ store: manager.store, log: () => {} }, 'p1', { kind: 'approval', thread: 't1' });
});

test('callers: the coordinator\'s one line for a news item', needsPeers, () => {
    const line = peers.coordinator.coordinatorNewsLine;
    assert.equal(line({ kind: 'handback', title: 'Fix CI' }), '“Fix CI” handed back');
    assert.equal(line({ kind: 'handback', status: 'blocked', title: 'Fix CI' }), '“Fix CI” is blocked');
    assert.equal(line({ kind: 'finished', title: 'Fix CI' }), '“Fix CI” ended without a handback');
    assert.equal(line({ kind: 'approval', title: 'Fix CI' }), '“Fix CI” is waiting for approval');
    assert.equal(line({ kind: 'failed', title: 'Fix CI' }), '“Fix CI” failed');
    assert.equal(line({ kind: 'stopped', title: 'Fix CI' }), '“Fix CI” stopped');
});

// ── The browser half ─────────────────────────────────────────────────

test('window: every news kind is gated by a setting with a switch on the page', needsPeers, () => {
    for (const field of Object.values(EVENT_FIELDS)) assert.match(field, /^notify/);
    const defaults = peers.plugin.Config({});
    const { FIELDS, EVENTS } = clientInternals();
    for (const field of Object.values(EVENT_FIELDS)) {
        assert.equal(defaults[field], true, field);
        assert.ok(FIELDS.includes(field), field);
        assert.equal(EVENTS.find((event) => event.field === field).title, TITLES[field], 'the page and the log use one title');
    }
});

test('window: it loads in the module format DSH serves; the form shows what the plugin counts', () => {
    const internals = clientInternals();
    assert.deepEqual(internals.FIELDS, ['enabled', 'notifyHandback', 'notifyFinished', 'notifyApproval', 'notifyFailed', 'notifyStopped', 'notifyFleet']);
    const spec = internals.boolSpec('enabled');
    assert.deepEqual(spec.parse('on'), { kind: 'set', value: true });
    assert.deepEqual(spec.parse('off'), { kind: 'set', value: false });
    assert.equal(spec.parse('maybe'), undefined);
    assert.equal(spec.format(false), 'off');
    assert.equal(spec.format(true), 'on');
    assert.equal(spec.format('yes'), 'on', 'a wrong value shows as the default the plugin uses');
});

test('window: the style sheet is appended once, under the plugin\'s name, and removed when it stops', () => {
    const { injectStyle, removeStyle, CSS } = clientInternals();
    const heads = [];
    const styleEl = () => ({ attrs: {}, textContent: '', setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, remove() { heads.splice(heads.indexOf(this), 1); } });
    const doc = { querySelector: () => (heads.length > 0 ? heads[0] : null), querySelectorAll: () => heads.slice(), createElement: styleEl, head: { appendChild: (el) => heads.push(el) } };
    injectStyle(doc);
    injectStyle(doc);
    assert.equal(heads.length, 1);
    assert.equal(heads[0].getAttribute('data-plugin'), 'dsh-plugin-notifications');
    assert.equal(heads[0].getAttribute('data-plugin-css'), 'dsh-plugin-notifications/client.css');
    removeStyle(doc);
    assert.equal(heads.length, 0);
    assert.match(CSS, /body\.wp-still \.dshn-page::before/);
    assert.match(CSS, /prefers-reduced-motion/);
    assert.doesNotMatch(CSS, /:root|html\b|:has\(/);
    assert.doesNotMatch(CSS, /(^|[^-])body\{/);
});

/** A fake Web Notification: records what would show; the test fires its events. */
function fakeNotificationClass(permission = 'granted') {
    class FakeNotification {
        constructor(title, options) {
            this.title = title;
            this.options = options;
            this.closed = false;
            FakeNotification.made.push(this);
        }
        close() { this.closed = true; }
    }
    FakeNotification.made = [];
    FakeNotification.permission = permission;
    return FakeNotification;
}

/** A link to the host that answers `pending` with `queue()` and records every call. */
function fakeLink(queue) {
    return {
        calls: [],
        async call(method, args) {
            this.calls.push([method, args]);
            if (method === 'pending') return { ok: true, value: await queue() };
            return { ok: true, value: 1 };
        },
        acks() { return this.calls.filter(([method]) => method === 'acknowledge').map(([, args]) => args); },
    };
}

const memoryStorage = () => {
    const map = new Map();
    return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
};

const now = () => new Date().toISOString();
const hiddenDoc = () => ({ hasFocus: () => false, visibilityState: 'hidden', addEventListener() {}, removeEventListener() {} });

test('window: it shows while nobody looks, reports the system\'s show event, takes the rest, and stands down on the desktop', async () => {
    const { applyPoller } = clientInternals();
    const Notification = fakeNotificationClass();
    const doc = hiddenDoc();
    let pendings = 0;
    const link = fakeLink(() => {
        pendings += 1;
        if (pendings === 3) return { desktop: true, items: [] };
        return { desktop: false, epoch: 'e1', items: [{ id: pendings * 10 + 1, title: 'T1', body: 'B1', at: now() }, { id: pendings * 10 + 2, title: 'T2', body: 'B2', at: now() }] };
    });
    const disposers = [];
    const poller = applyPoller({ effect(fn) { disposers.push(fn()); } }, link, { Notification, doc, win: undefined, storage: memoryStorage(), wait: 1000 });
    assert.equal(await poller.read(), 2, 'both show while the window is hidden');
    assert.deepEqual(Notification.made.map((n) => [n.title, n.options.body, n.options.tag]), [['T1', 'B1', 'dsh-plugin-notifications:e1:11'], ['T2', 'B2', 'dsh-plugin-notifications:e1:12']]);
    assert.deepEqual(link.acks()[0], { ids: [11, 12], results: [] }, 'taken at once; the show reports follow');
    Notification.made[0].onshow();
    Notification.made[1].onerror();
    await tick();
    assert.deepEqual(link.acks().slice(1), [{ ids: [], results: [{ id: 11, outcome: 'shown', detail: '' }] }, { ids: [], results: [{ id: 12, outcome: 'failed', detail: 'the system refused to show it' }] }]);
    // Looking at it: nothing shows, and the host hears why.
    doc.hasFocus = () => true;
    doc.visibilityState = 'visible';
    Notification.made.length = 0;
    await poller.read();
    assert.equal(Notification.made.length, 0, 'a watched window needs no notification');
    assert.deepEqual(link.acks().at(-1), { ids: [21, 22], results: [{ id: 21, outcome: 'watching' }, { id: 22, outcome: 'watching' }] });
    // The desktop answer stands the sender down: the read that learned it was the last call.
    const before = link.calls.length;
    await poller.read();
    assert.equal(poller.state.desktopHandled, true);
    assert.deepEqual(link.calls.slice(before).map(([method]) => method), ['pending']);
    assert.equal(await poller.read(), 0);
    assert.equal(link.calls.length, before + 1, 'stood down: no more polls');
    disposers[0]();
});

test('window: a notification no event confirms is reported as not confirmed; one whose constructor throws, as failed', async () => {
    const { showNotification } = clientInternals();
    const results = [];
    const Notification = fakeNotificationClass();
    showNotification({ id: 1, title: 'T' }, { Notification, win: undefined, wait: 10, onResult: (...r) => results.push(r) });
    await new Promise((r) => setTimeout(r, 30));
    Notification.made[0].onshow?.();
    assert.deepEqual(results, [['unconfirmed', '']], 'reported once, the first answer');
    class Broken { constructor() { throw new TypeError('Illegal constructor'); } }
    showNotification({ id: 2, title: 'T' }, { Notification: Broken, win: undefined, onResult: (...r) => results.push(r) });
    assert.deepEqual(results[1], ['failed', 'Illegal constructor']);
});

test('window: a click brings the window up and opens the chat the news is about', () => {
    const { showNotification } = clientInternals();
    const Notification = fakeNotificationClass();
    const opened = [];
    let focused = 0;
    showNotification({ id: 1, title: 'T', sessionId: 'session-7' }, { Notification, win: { focus: () => { focused += 1; } }, wait: 10, openSession: () => (id) => opened.push(id) });
    Notification.made[0].onclick();
    assert.equal(focused, 1);
    assert.deepEqual(opened, ['session-7']);
    assert.equal(Notification.made[0].closed, true);
    // No chat to open (Fleet's news), or no workspace yet: the window still comes up, nothing throws.
    showNotification({ id: 2, title: 'T' }, { Notification, win: { focus: () => { focused += 1; } }, wait: 10, openSession: () => undefined });
    Notification.made[1].onclick();
    assert.equal(focused, 2);
    assert.deepEqual(opened, ['session-7']);
});

test('window: many at once show as the newest two and one summary of the rest', async () => {
    const { applyPoller, planShows, summaryOf, SHOW_AT_ONCE, SHOW_SINGLE } = clientInternals();
    assert.equal(SHOW_AT_ONCE, 3);
    assert.equal(SHOW_SINGLE, 2);
    assert.deepEqual(planShows([1, 2, 3]), { single: [1, 2, 3], summarized: [] });
    assert.deepEqual(planShows([1, 2, 3, 4, 5]), { single: [4, 5], summarized: [1, 2, 3] });
    assert.deepEqual(summaryOf([{ id: 1, title: 'A' }, { id: 2, title: 'B' }]), { id: 1, key: 'summary:1,2', title: 'DSH: 2 more updates', body: 'A · B' });
    const Notification = fakeNotificationClass();
    const items = [1, 2, 3, 4, 5].map((id) => ({ id, title: `T${id}`, body: '', at: now() }));
    const link = fakeLink(() => ({ desktop: false, epoch: 'e', items }));
    const disposers = [];
    const poller = applyPoller({ effect(fn) { disposers.push(fn()); } }, link, { Notification, doc: hiddenDoc(), win: undefined, storage: memoryStorage(), wait: 1000 });
    assert.equal(await poller.read(), 3);
    assert.deepEqual(Notification.made.map((n) => n.title), ['T4', 'T5', 'DSH: 3 more updates']);
    assert.equal(Notification.made[2].options.body, 'T1 · T2 · T3');
    Notification.made[2].onshow();
    await tick();
    assert.deepEqual(link.acks().at(-1), { ids: [], results: [1, 2, 3].map((id) => ({ id, outcome: 'summary', detail: '' })) });
    disposers[0]();
});

test('window: a reload never shows an item twice', async () => {
    const { applyPoller } = clientInternals();
    const storage = memoryStorage();
    const Notification = fakeNotificationClass();
    const queue = () => ({ desktop: false, epoch: 'e9', items: [{ id: 4, title: 'Once', body: '', at: now() }] });
    const disposers = [];
    const first = applyPoller({ effect(fn) { disposers.push(fn()); } }, fakeLink(queue), { Notification, doc: hiddenDoc(), win: undefined, storage, wait: 1000 });
    assert.equal(await first.read(), 1);
    // The window reloads before the host heard it was taken (a restart in between): the same item comes again.
    const link = fakeLink(queue);
    const second = applyPoller({ effect(fn) { disposers.push(fn()); } }, link, { Notification, doc: hiddenDoc(), win: undefined, storage, wait: 1000 });
    assert.equal(await second.read(), 0);
    assert.equal(Notification.made.length, 1, 'shown once');
    assert.deepEqual(link.acks().at(-1), { ids: [4], results: [] }, 'taken, so it leaves the queue');
    // A new epoch (the host's state was deleted): its id 4 is a new item, and shows.
    const fresh = applyPoller({ effect(fn) { disposers.push(fn()); } }, fakeLink(() => ({ ...queue(), epoch: 'f0' })), { Notification, doc: hiddenDoc(), win: undefined, storage, wait: 1000 });
    assert.equal(await fresh.read(), 1);
    for (const dispose of disposers) dispose();
});

test('window: stale items are dropped and said so; blocked ones are dropped and said so', async () => {
    const { applyPoller } = clientInternals();
    const disposers = [];
    const old = new Date(Date.now() - 6 * 60_000).toISOString();
    const Notification = fakeNotificationClass();
    const link = fakeLink(() => ({ desktop: false, epoch: 'e', items: [{ id: 1, title: 'Old', body: '', at: old }] }));
    const poller = applyPoller({ effect(fn) { disposers.push(fn()); } }, link, { Notification, doc: hiddenDoc(), win: undefined, storage: memoryStorage() });
    assert.equal(await poller.read(), 0);
    assert.deepEqual(Notification.made, []);
    assert.deepEqual(link.acks().at(-1), { ids: [1], results: [{ id: 1, outcome: 'stale' }] });
    const Denied = fakeNotificationClass('denied');
    const blocked = fakeLink(() => ({ desktop: false, epoch: 'e', items: [{ id: 2, title: 'B', body: '', at: now() }] }));
    await applyPoller({ effect(fn) { disposers.push(fn()); } }, blocked, { Notification: Denied, doc: hiddenDoc(), win: undefined, storage: memoryStorage() }).read();
    assert.deepEqual(blocked.acks().at(-1), { ids: [2], results: [{ id: 2, outcome: 'denied' }] });
    for (const dispose of disposers) dispose();
});

test('window: the sender survives the 404 that used to kill polling', async () => {
    const { applyPoller } = clientInternals();
    const Notification = fakeNotificationClass();
    const warns = [];
    const disposers = [];
    // The old bug: the gateway answered HTTP 404 ("not found") for the
    // unmarked methods, and the sender gave up and the host fell back to
    // osascript. A failing call must now be a retry, not a stop.
    let failing = true;
    const link = {
        calls: [],
        async call(method, args) {
            this.calls.push([method, args]);
            if (method === 'pending') {
                if (failing) throw new Error('transport failure for /api/dsh-plugin-notifications/pending: HTTP 404');
                return { ok: true, value: { desktop: false, epoch: 'e', items: [{ id: 7, title: 'After the fix', body: '', at: now() }] } };
            }
            return { ok: true, value: 1 };
        },
    };
    const poller = applyPoller({ effect(fn) { disposers.push(fn()); } }, link, { Notification, doc: hiddenDoc(), win: undefined, storage: memoryStorage(), warn: (m) => warns.push(m) });
    assert.equal(await poller.read(), 0, 'a transport failure shows nothing and throws nothing');
    await poller.read();
    assert.equal(poller.state.transportFailed, true);
    assert.equal(warns.length, 1, 'the failure is warned about once, not every poll');
    assert.match(warns[0], /404/);
    failing = false;
    assert.equal(await poller.read(), 1, 'the next poll still works');
    assert.deepEqual(Notification.made.map((n) => n.title), ['After the fix']);
    assert.equal(poller.state.transportFailed, false);
    disposers[0]();
});

test('window: with permission unanswered the queue waits; once allowed, it shows', async () => {
    const { applyPoller } = clientInternals();
    const Notification = fakeNotificationClass('default');
    const link = fakeLink(() => ({ desktop: false, epoch: 'e', items: [{ id: 3, title: 'Waiting', body: '', at: now() }] }));
    const disposers = [];
    const poller = applyPoller({ effect(fn) { disposers.push(fn()); } }, link, { Notification, doc: hiddenDoc(), win: undefined, storage: memoryStorage() });
    assert.equal(await poller.read(), 0);
    assert.deepEqual(link.acks(), [], 'nothing is taken, so the items wait');
    Notification.permission = 'granted';
    assert.equal(await poller.read(), 1, 'once the ask is answered, the waiting items show');
    assert.deepEqual(link.acks().at(-1), { ids: [3], results: [] });
    // A window with no notification support takes nothing either: another window may show them.
    const none = fakeLink(() => ({ desktop: false, epoch: 'e', items: [{ id: 5, title: 'X', body: '', at: now() }] }));
    assert.equal(await applyPoller({ effect(fn) { disposers.push(fn()); } }, none, { Notification: undefined, doc: hiddenDoc(), win: undefined, storage: memoryStorage() }).read(), 0);
    assert.deepEqual(none.acks(), []);
    for (const dispose of disposers) dispose();
});

test('window: permission is asked once where an ask can work, and not where it cannot', () => {
    const { ensurePermissionOnce, permissionState, permissionLine, TEXT } = clientInternals();
    const asks = [];
    const electronNotification = Object.assign(() => {}, { permission: 'default', requestPermission: () => { asks.push('ask'); return Promise.resolve('granted'); } });
    ensurePermissionOnce(electronNotification, { userAgent: 'Mozilla/5.0 (Macintosh) Electron/44.0.0' });
    assert.deepEqual(asks, ['ask']);
    ensurePermissionOnce(electronNotification, { userAgent: 'Mozilla/5.0 (Macintosh) Chrome/141.0.0.0 Safari/537.36' });
    assert.deepEqual(asks, ['ask'], 'a browser needs the settings page button; no silent ask');
    ensurePermissionOnce(Object.assign(() => {}, { permission: 'granted' }), { userAgent: 'Mozilla/5.0 Electron/44.0.0' });
    assert.deepEqual(asks, ['ask'], 'granted needs no ask');
    assert.equal(ensurePermissionOnce(undefined, undefined), undefined);
    assert.equal(permissionState({ Notification: Object.assign(() => {}, { permission: 'granted' }), navigator: { userAgent: 'Electron/44' } }), 'desktop');
    assert.equal(permissionState({ Notification: Object.assign(() => {}, { permission: 'denied' }), navigator: { userAgent: 'Electron/44' } }), 'denied', 'blocked in the app too is said as blocked');
    assert.equal(permissionState({}), 'none');
    assert.equal(permissionLine('default'), TEXT.permDefault);
});

test('window: where notifications go, in words, for each sender', () => {
    const { whereWords, whenWords } = clientInternals();
    assert.match(whereWords({ sender: 'desktop' }, true), /^DSH's own desktop notifications send them/);
    assert.match(whereWords({ sender: 'window', desktopHost: true }, true), /^This DSH window shows them, with DSH's icon, while it is hidden, minimised or behind other windows/);
    assert.match(whereWords({ sender: 'window', desktopHost: false, windowSeenAt: new Date().toISOString() }, true), /^A DSH window in your browser shows them while you are not looking at it \(it last checked in at \d/);
    assert.match(whereWords({ sender: 'command', platform: 'linux' }, true), /go to notify-send\.$/);
    assert.match(whereWords({ sender: 'command', platform: 'win32' }, true), /go to a PowerShell toast\.$/);
    assert.match(whereWords({ sender: 'none', platform: 'darwin' }, true), /macOS has no other sender that shows DSH's icon: news is listed below but not shown until a DSH window is open\.$/);
    assert.match(whereWords({ sender: 'window' }, false), /^Notifications are switched off\. Switch on “Send system notifications” above and save/);
    assert.equal(whereWords(undefined, true), '');
    assert.match(whenWords(new Date().toISOString()), /^\d{1,2}:\d{2}/);
    assert.match(whenWords('2020-01-02T03:04:05Z'), /, /, 'another day says the day');
    assert.equal(whenWords('not a time'), '');
});
