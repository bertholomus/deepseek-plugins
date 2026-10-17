/**
 * Proof's browser half: loaded as DSH loads it, the flag after a turn, its
 * page (sessions, ledger, export, checks, history) drawn as plain element
 * trees, and its settings form.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LIVE_SETTINGS, SETTING_TITLES, VERIFIER_CHOICES, checkConfig } from '../plugins/proof/lib/config.js';
import { OTHER_NAMES, elementsOf, loadClient, statefulReact, textIn } from './helpers/client.mjs';

const CLIENT = new URL('../plugins/proof/lib/client.js', import.meta.url);
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const buttons = (tree) => elementsOf(tree).filter((e) => e.type === 'Button' || e.type === 'button');
const button = (tree, label) => buttons(tree).find((e) => textIn(e) === label);
const withAttr = (tree, name) => elementsOf(tree).filter((e) => e.props?.[name] !== undefined);

const now = Date.now();
const UNSHOWN = { id: '3:0', turn: 3, seq: 40, at: now - 60000, kind: 'deployed', verdict: 'unbacked', text: 'Deployed to staging.', part: 'Deployed to staging.', why: 'No tool ran in this turn, and it was asked for new work, so the runs before it do not show this.', evidence: [] };
const AGAINST = { id: '2:1', turn: 2, seq: 30, at: now - 120000, kind: 'passed', verdict: 'contradicted', text: 'Fixed the parser; all tests pass.', part: 'all tests pass', why: 'The last test run in this turn did not pass: `npm test` exited 0: 4 passed, 1 failed.', evidence: ['`npm test` exited 0: 4 passed, 1 failed'] };
const VIEW = { total: 4, flagged: [AGAINST, UNSHOWN] };
const SESSION = { on: true, flags: true, verifier: 'ask', isCheck: false, checks: [] };

/** DSH's connection as the window has it: answers by method name; anything else never answers (the hub's wait). */
function connect(kit, answers) {
    const calls = [];
    kit.setConnection({ rpc: { call: async (_path, method, payload) => {
        const name = method.replace('dsh-plugin-proof/', '');
        calls.push([name, plain(payload.args)]);
        const answer = answers[name];
        if (answer === undefined) return new Promise(() => {});
        const value = typeof answer === 'function' ? await answer(payload.args) : answer;
        return value?.ok === false ? value : { ok: true, value };
    } } });
    return calls;
}

test('browser half: loads as DSH loads it, adds its entry (order 5), its page, its flag (order 40) and one style sheet', () => {
    const heads = [];
    const document = {
        querySelector: () => null,
        createElement: (type) => ({ type, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } }),
        head: { appendChild: (tag) => { heads.push(tag); } },
    };
    const { id, client } = loadClient(CLIENT, { document });
    assert.equal(id, 'dsh-plugin-proof');
    assert.equal(heads.length, 0, 'styles wait for apply');
    const registered = [];
    const opened = [];
    const panels = [];
    const scope = {
        slots: { inject: (_name, fn) => { fn(); }, register: (spec, component) => { registered.push({ spec, component }); return () => {}; } },
        uiWorkspace: { openSession: (sessionId) => { opened.push(sessionId); } },
        get: (name) => (name === 'layout' ? { selectPanel: (key) => panels.push(key) } : undefined),
        effect: () => {},
    };
    client.apply({ ...scope, inject: (names, fn) => { if (names[0] === 'uiWorkspace') fn(scope); } });
    assert.equal(heads.length, 1);
    assert.equal(heads[0].attributes['data-plugin'], 'dsh-plugin-proof');
    assert.equal(heads[0].attributes['data-plugin-css'], 'dsh-plugin-proof/client.css');
    const css = heads[0].textContent;
    assert.match(css, /\.dshpf-flag\{/);
    assert.match(css, /background:var\(--dsw-alias-bg-layer-1\);border:\.5px solid var\(--dsw-alias-border-l4\);border-radius:var\(--dsw-radius-lg\)/, 'a card in a chat is drawn as DSH draws its own there');
    assert.doesNotMatch(css.split('\n').filter((rule) => rule.startsWith('.dshpf-flag')).join('\n'), /backdrop-filter/, 'no blur in the chat');
    assert.match(css, /font-size:var\(--dsh-content-font-size,14px\)/, 'the claim follows the chat\'s text size');
    assert.match(css, /body\.wp-still/);
    assert.match(css, /prefers-reduced-motion/);
    assert.doesNotMatch(css, /:has\(/);
    assert.doesNotMatch(css, /(^|\})\s*(:root|html|body)\s*\{/m, 'nothing on the page root');
    const entry = registered.find((r) => r.spec.name === 'sidebar.panellist');
    assert.deepEqual(plain(entry.spec), { name: 'sidebar.panellist', id: 'dsh-plugin-proof:page', order: 5, label: 'Proof' });
    const page = registered.find((r) => r.spec.name === 'main');
    assert.equal(page.spec.key, 'dsh-plugin-proof:page');
    const flag = registered.find((r) => r.spec.name === 'conversation.chat.turnTail');
    assert.deepEqual(plain(flag.spec), { name: 'conversation.chat.turnTail', id: 'dsh-plugin-proof:flag', order: 40, label: 'Proof' });
    // The views it opens: a session in DSH's workspace, its own page through DSH's layout.
    client.internals.views.openSession('s1');
    client.internals.views.openSession('');
    client.internals.views.openPage();
    assert.deepEqual(opened, ['s1'], 'an empty id opens nothing');
    assert.deepEqual(panels, ['dsh-plugin-proof:page']);
});

test('the flag: each turn reads only its own flagged claims; a check thread says what it checks on its first turn', () => {
    const { client } = loadClient(CLIENT);
    const { flagOf, sameFlag, ProofFlag, flagHead } = client.internals;
    assert.deepEqual(plain(flagOf(VIEW, 3)), [plain(UNSHOWN)]);
    assert.deepEqual(plain(flagOf(VIEW, 2)), [plain(AGAINST)]);
    assert.equal(flagOf(VIEW, 1), flagOf(VIEW, 7), 'no claims: the same empty list every time, so the turn does not draw again');
    assert.equal(flagOf(undefined, 1).length, 0);
    assert.equal(flagOf({ flagged: 'x' }, 1).length, 0);
    assert.equal(flagOf(VIEW, Number.NaN).length, 0);
    const check = flagOf({ total: 0, flagged: [], check: true, first: 4 }, 4);
    assert.equal(check.check, true);
    assert.equal(flagOf({ total: 0, flagged: [], check: true, first: 4 }, 5).length, 0);
    assert.equal(flagOf({ total: 0, flagged: [], check: true }, 1).check, true, 'an older view without its first turn: turn 1');
    assert.equal(sameFlag(flagOf(VIEW, 3), flagOf(plain(VIEW), 3)), true, 'a new view with the same claims is the same flag');
    assert.equal(sameFlag(flagOf(VIEW, 3), [{ ...UNSHOWN, verdict: 'contradicted' }]), false);

    // DSH's useProjection with a selector and an equality.
    const asked = [];
    const useProjection = (view) => (key, select, equal) => { asked.push([key, typeof equal]); return select(view); };
    assert.equal(ProofFlag({ turn: { turn: 1 }, sessionId: 's', useProjection: useProjection(VIEW) }), null, 'a turn with no flagged claim draws nothing');
    assert.deepEqual(asked[0], ['proofClaims', 'function']);
    assert.equal(ProofFlag({ turn: { turn: 3 }, sessionId: 's' }), null, 'no projections in this DSH: nothing');
    assert.equal(ProofFlag({ turn: { turn: 3 }, sessionId: 's', useProjection: () => { throw new Error('gone'); } }), null);
    assert.equal(ProofFlag({ turn: { turn: 3 }, sessionId: '', useProjection: useProjection(VIEW) }), null);
    // With claims, it waits for Proof's word on whether flags show before drawing anything.
    assert.equal(ProofFlag({ turn: { turn: 3 }, sessionId: 's', useProjection: useProjection(VIEW) }), null);

    assert.equal(flagHead([UNSHOWN]), 'Nothing in this turn shows this');
    assert.equal(flagHead([AGAINST]), 'This turn\'s own output says otherwise');
    assert.equal(flagHead([UNSHOWN, { ...UNSHOWN, id: '3:1' }]), '2 claims this turn does not show');
    assert.equal(flagHead([UNSHOWN, AGAINST]), '2 claims this turn does not show (1 contradicted)');
    assert.equal(flagHead([AGAINST, { ...AGAINST, id: '2:2' }]), 'This turn\'s own output contradicts 2 claims');
});

test('the flag: says which claim and why, checks it on a press, and opens the check and the ledger', async (t) => {
    const { react, mount } = statefulReact();
    const { client } = loadClient(CLIENT, { react });
    const { kit, ProofFlag, views, spotlight } = client.internals;
    let session = SESSION;
    const calls = connect(kit, {
        session: () => session,
        check: ({ claimId }) => (claimId === '9:9' ? { ok: false, error: { code: 'proof/refused', message: 'The independent check is off.' } } : { key: `s#${claimId}`, state: 'queued' }),
    });
    t.after(() => kit.setConnection(undefined));
    const opened = [];
    views.openSession = (id) => opened.push(id);
    views.openPage = () => opened.push('page');
    const useProjection = (key, select) => select(VIEW);
    const flag = mount(ProofFlag, { turn: { turn: 3 }, sessionId: 's', useProjection });
    t.after(() => flag.unmount());
    assert.equal(flag.tree, null, 'nothing until Proof says flags show');
    await settle(5);
    const text = textIn(flag.tree);
    assert.equal(flag.tree.props['aria-label'], 'Proof');
    assert.equal(flag.tree.props['data-proof-flag'], 'unbacked');
    assert.match(flag.tree.props.className, /dshpf-pane dshpf-flag/);
    assert.match(text, /^Proof · Nothing in this turn shows this/);
    assert.match(text, /“Deployed to staging\.”/);
    assert.match(text, /No tool ran in this turn, and it was asked for new work, so the runs before it do not show this\./);
    assert.deepEqual(calls[0], ['session', { sessionId: 's' }]);

    // Check it: the host is asked, and the flag reads the session again.
    session = { ...SESSION, checks: [{ key: 's#3:0', claimId: '3:0', state: 'running', model: 'GLM-5.3-Flash-EXL3 from owner-ascents', checkSessionId: 'session-c' }] };
    await button(flag.tree, 'Check it').props.onClick();
    await settle(5);
    assert.deepEqual(calls.find(([m]) => m === 'check'), ['check', { sessionId: 's', claimId: '3:0' }]);
    let line = withAttr(flag.tree, 'data-proof-check')[0];
    assert.equal(line.props['data-proof-check'], 'running');
    assert.equal(line.props.role, 'status');
    assert.match(textIn(line), /^checkingChecking in a read-only thread on GLM-5\.3-Flash-EXL3 from owner-ascents\.Open the check$/);
    assert.equal(button(flag.tree, 'Check it'), undefined, 'no second press while it runs');
    button(line, 'Open the check').props.onClick();
    assert.deepEqual(opened, ['session-c']);

    // Its answer, when the turn draws again.
    session = { ...SESSION, checks: [{ key: 's#3:0', claimId: '3:0', state: 'not-verified', reason: 'staging still runs the old image', checkSessionId: 'session-c' }] };
    const answered = mount(ProofFlag, { turn: { turn: 3 }, sessionId: 's', useProjection });
    t.after(() => answered.unmount());
    await settle(5);
    assert.ok(button(answered.tree, 'Check again'), 'a finished check can run again');
    line = withAttr(answered.tree, 'data-proof-check')[0];
    assert.match(textIn(line), /not verifiedNot verified: staging still runs the old image\./);
    const tag = elementsOf(line).find((e) => e.type === 'Tag');
    assert.equal(tag.props.tone, 'danger');

    // Open in Proof: its page, on this session.
    button(answered.tree, 'Open in Proof').props.onClick();
    assert.equal(opened.at(-1), 'page');
    assert.equal(spotlight.get().sessionId, 's');
    assert.equal(spotlight.get().claimId, '3:0');
});

test('the flag: a contradiction shows what the turn showed; refusals say why; off, a check thread or no checks draw less', async (t) => {
    const { react, mount } = statefulReact();
    const { client } = loadClient(CLIENT, { react });
    const { kit, ProofFlag } = client.internals;
    let session = { ...SESSION, verifier: 'off' };
    connect(kit, {
        session: () => session,
        check: { ok: false, error: { code: 'proof/refused', message: 'The independent check is off. Turn it on in Proof\'s settings ("Independent check").' } },
    });
    t.after(() => kit.setConnection(undefined));
    const against = mount(ProofFlag, { turn: { turn: 2 }, sessionId: 's', useProjection: (key, select) => select(VIEW) });
    t.after(() => against.unmount());
    await settle(5);
    assert.equal(against.tree.props['data-proof-flag'], 'contradicted');
    const text = textIn(against.tree);
    assert.match(text, /^Proof · This turn's own output says otherwise/);
    assert.match(text, /What the turn shows: `npm test` exited 0: 4 passed, 1 failed/);
    assert.equal(button(against.tree, 'Check it'), undefined, 'the check is off: no Check');

    session = { ...SESSION };
    const on = mount(ProofFlag, { turn: { turn: 2 }, sessionId: 's', useProjection: (key, select) => select(VIEW) });
    t.after(() => on.unmount());
    await settle(5);
    await button(on.tree, 'Check it').props.onClick();
    await settle(5);
    const alert = elementsOf(on.tree).find((e) => e.props?.role === 'alert');
    assert.equal(textIn(alert), 'Not checked: The independent check is off. Turn it on in Proof\'s settings ("Independent check").');

    for (const quiet of [{ ...SESSION, flags: false }, { ...SESSION, isCheck: true }]) {
        session = quiet;
        const view = mount(ProofFlag, { turn: { turn: 3 }, sessionId: 's', useProjection: (key, select) => select(VIEW) });
        await settle(5);
        assert.equal(view.tree, null, JSON.stringify(quiet));
        view.unmount();
    }
});

test('the flag in a check thread: what it checks, its state, and the way back', async (t) => {
    const { react, mount } = statefulReact();
    const { client } = loadClient(CLIENT, { react });
    const { kit, ProofFlag, views } = client.internals;
    connect(kit, { session: { ...SESSION, isCheck: true, checkOf: { sessionId: 's', turn: 3, claim: 'Deployed to staging.', state: 'verified', reason: 'The rollout shows 1.4.2 live.', model: 'm', title: 'Release' } } });
    t.after(() => kit.setConnection(undefined));
    const opened = [];
    views.openSession = (id) => opened.push(id);
    const view = { total: 0, flagged: [], check: true, first: 1 };
    const note = mount(ProofFlag, { turn: { turn: 1 }, sessionId: 'session-c', useProjection: (key, select) => select(view) });
    t.after(() => note.unmount());
    await settle(5);
    assert.equal(note.tree.props['data-proof-flag'], 'check');
    const text = textIn(note.tree);
    assert.match(text, /^Proof · An independent check/);
    assert.match(text, /This thread checks “Deployed to staging\.” from turn 3 of “Release”\. It can read and run commands, but nothing it runs can write a file\./);
    assert.match(text, /verifiedVerified: The rollout shows 1\.4\.2 live\./);
    button(note.tree, 'Open the checked session').props.onClick();
    assert.deepEqual(opened, ['s']);
    // Later turns of the thread: nothing.
    assert.equal(ProofFlag({ turn: { turn: 2 }, sessionId: 'session-c', useProjection: (key, select) => select(view) }), null);
});

const PAGE_STATE = {
    enabled: true,
    flags: true,
    verifier: { mode: 'ask', provider: 'owner-ascents', model: 'GLM-5.3-Flash-EXL3', minutes: 5, perHour: 12, used: 1, nextAt: 0 },
    sessions: [
        { sessionId: 's', title: 'Release', cwd: '/w', updatedAt: now - 30000, running: false, total: 4, flagged: 3, contradicted: 2, latest: { id: '3:0', turn: 3, verdict: 'unbacked', text: 'Deployed to staging.' } },
        { sessionId: 'q', title: '', cwd: '/w', updatedAt: now - 90000, running: true, total: 2, flagged: 0, contradicted: 0 },
    ],
    checks: [{ key: 's#3:0', sessionId: 's', claimId: '3:0', turn: 3, claim: 'Deployed to staging.', state: 'verified', reason: 'The rollout shows 1.4.2 live.', by: 'you', model: 'm', checkSessionId: 'session-c', queuedAt: now - 50000, startedAt: now - 40000, endedAt: now - 20000 }],
    history: [
        { id: 'h2', at: now - 20000, kind: 'check', sessionId: 's', text: 'Verified: “Deployed to staging.”', why: 'The rollout shows 1.4.2 live.' },
        { id: 'h1', at: now - 50000, kind: 'settings', text: 'Settings saved: "Independent check"', why: 'It applies now.' },
    ],
};
const LEDGER = {
    session: { id: 's', title: 'Release', cwd: '/w' },
    isCheck: false,
    counts: { total: 4, backed: 1, unbacked: 1, contradicted: 2, flagged: 3 },
    claims: [
        { id: '1:0', turn: 1, at: now - 300000, kind: 'passed', verdict: 'backed', text: 'All 5 tests pass.', why: '', evidence: ['`npm test` exited 0: 5 passed, 0 failed'], ran: ['`npm test` exited 0: 5 passed, 0 failed'], ask: 'Run the tests.' },
        { ...AGAINST, id: '2:0', kind: 'fixed', ran: ['src/date.js changed', '`npm test` exited 0: 4 passed, 1 failed'], ask: 'Fix the date parser.' },
        { ...AGAINST, ran: ['src/date.js changed', '`npm test` exited 0: 4 passed, 1 failed'], ask: 'Fix the date parser.' },
        { ...UNSHOWN, ran: [], ask: 'Now deploy it.', check: PAGE_STATE.checks[0] },
    ],
};

test('the page: the header, the sessions, a ledger with its claims, and checks that open their threads', async (t) => {
    const { react, mount } = statefulReact();
    const { client } = loadClient(CLIENT, { react });
    const { kit, ProofPage, views, spotlight } = client.internals;
    const calls = connect(kit, {
        state: PAGE_STATE,
        ledger: ({ sessionId }) => (sessionId === 's' ? LEDGER : { session: { id: sessionId, title: '', cwd: '' }, isCheck: false, counts: { total: 2, backed: 2, unbacked: 0, contradicted: 0, flagged: 0 }, claims: LEDGER.claims.slice(0, 1).map((c) => ({ ...c, id: `${sessionId}-${c.id}` })) }),
        check: { key: 's#2:1', state: 'queued' },
    });
    t.after(() => kit.setConnection(undefined));
    const opened = [];
    views.openSession = (id) => opened.push(id);
    const page = mount(ProofPage, {});
    t.after(() => page.unmount());
    assert.match(textIn(page.tree), /Reading the claims/);
    await settle(5);
    let text = textIn(page.tree);
    assert.match(text, /2 sessions with claims · 3 claims flagged/);
    assert.match(text, /Flags are on: a turn whose claim nothing in it shows gets a short card after it\./);
    assert.match(text, /A flagged claim is checked when you press Check: a fresh read-only thread on GLM-5\.3-Flash-EXL3 from owner-ascents, for at most 5 minutes\. 1 of 12 this hour\./);
    const rows = withAttr(page.tree, 'data-proof-session');
    assert.deepEqual(rows.map((r) => r.props['data-proof-session']), ['s', 'q']);
    assert.equal(rows[0].props['aria-current'], 'true', 'the newest session with a flagged claim is open first');
    assert.match(textIn(rows[0]), /Release4 claims · latest flagged: “Deployed to staging\.”contradicted/);
    assert.match(textIn(rows[1]), /Untitled session2 claimsshown/);

    // The ledger: flagged claims first, newest at the top, each with why, evidence and what its turn ran.
    const ledger = () => withAttr(page.tree, 'data-proof-ledger')[0];
    assert.equal(ledger().props['data-proof-ledger'], 's');
    assert.match(textIn(ledger()), /^Ledger: Release4 claims: 1 shown by their turn, 1 with no evidence, 2 contradicted\./);
    let claims = withAttr(ledger(), 'data-proof-verdict');
    assert.deepEqual(claims.map((c) => c.props['data-proof-claim']), ['3:0', '2:1', '2:0'], 'flagged only, newest first');
    assert.match(textIn(claims[0]), /Turn 3/);
    assert.match(textIn(claims[0]), /· deployed/);
    assert.match(textIn(claims[0]), /verifiedVerified: The rollout shows 1\.4\.2 live\./);
    assert.match(textIn(claims[1]), /What the turn shows: `npm test` exited 0: 4 passed, 1 failed/);
    assert.match(textIn(claims[1]), /What the turn ran \(2\)/);
    assert.equal(button(claims[0], 'Check again').type, 'Button', 'a checked claim can be checked again');
    // All claims: the shown one too, its evidence named as what shows it.
    const filter = elementsOf(ledger()).find((e) => e.type === 'SegmentedControl');
    assert.deepEqual(plain(filter.props.options.map((o) => o.label)), ['Flagged (3)', 'All claims (4)']);
    elementsOf(ledger()).find((e) => e.props?.['data-suite-choice']).props.onClickCapture({ target: { closest: () => ({ id: `${filter.props.id}-all` }) } });
    await settle(5);
    claims = withAttr(ledger(), 'data-proof-verdict');
    assert.equal(claims.length, 4);
    assert.match(textIn(claims[3]), /Shown by: `npm test` exited 0: 5 passed, 0 failed/);
    assert.equal(button(claims[3], 'Check'), undefined, 'a shown claim has nothing to check');

    // Check from the ledger.
    await button(claims[1], 'Check').props.onClick();
    await settle(5);
    assert.deepEqual(calls.find(([m]) => m === 'check'), ['check', { sessionId: 's', claimId: '2:1' }]);
    const said = withAttr(ledger(), 'data-proof-said')[0];
    assert.equal(said.props.role, 'status');
    assert.equal(textIn(said), 'Checking “Fixed the parser; all tests pass.” in a fresh read-only thread.');

    // The checks card opens a check's thread, and its session.
    const checks = withAttr(page.tree, 'data-proof-checks')[0];
    assert.match(textIn(checks), /“Deployed to staging\.”Turn 3 of Release · you askedVerified: The rollout shows 1\.4\.2 live\.Open the check/);
    button(checks, 'Open the check').props.onClick();
    button(checks, 'Release').props.onClick();
    assert.deepEqual(opened, ['session-c', 's']);
    // The history.
    text = textIn(withAttr(page.tree, 'data-proof-history')[0]);
    assert.match(text, /Release · Verified: “Deployed to staging\.”The rollout shows 1\.4\.2 live\./);
    assert.match(text, /Settings saved: "Independent check"It applies now\./);

    // Another session, and a flag's Open in Proof.
    rows[1].props.onClick();
    await settle(5);
    assert.equal(ledger().props['data-proof-ledger'], 'q');
    spotlight.set({ sessionId: 's', claimId: '3:0', n: 1 });
    page.update({});
    await settle(5);
    assert.equal(ledger().props['data-proof-ledger'], 's');
});

test('the page: exports download the host\'s file, Copy puts Markdown on the clipboard, and failures say so', async (t) => {
    const { react, mount } = statefulReact();
    const clicks = [];
    const document = { createElement: (type) => ({ type, click() { clicks.push({ type, href: this.href, download: this.download, rel: this.rel }); } }) };
    const copied = [];
    const navigator = { clipboard: { writeText: async (text) => { copied.push(text); } } };
    const { client } = loadClient(CLIENT, { react, globals: { document, navigator, Blob } });
    const { kit, LedgerCard } = client.internals;
    const files = { md: { name: 'proof-ledger-release-2026-10-17.md', type: 'text/markdown', text: '# Claims ledger: Release\n' }, csv: { name: 'proof-ledger-release-2026-10-17.csv', type: 'text/csv', text: 'session\r\n' } };
    const calls = connect(kit, {
        ledger: LEDGER,
        exportLedger: ({ format }) => files[format] ?? { ok: false, error: { code: 'proof/refused', message: 'Export as Markdown, CSV or JSON.' } },
    });
    t.after(() => kit.setConnection(undefined));
    const card = mount(LedgerCard, { sessionId: 's', verifier: 'ask', row: undefined });
    t.after(() => card.unmount());
    await settle(5);
    const said = () => withAttr(card.tree, 'data-proof-said')[0];
    await button(card.tree, 'Markdown').props.onClick();
    await settle(5);
    assert.deepEqual(calls.filter(([m]) => m === 'exportLedger'), [['exportLedger', { sessionId: 's', format: 'md' }]]);
    assert.equal(clicks.length, 1);
    assert.equal(clicks[0].download, 'proof-ledger-release-2026-10-17.md');
    assert.match(clicks[0].href, /^blob:/);
    assert.equal(textIn(said()), 'Downloaded proof-ledger-release-2026-10-17.md.');
    await button(card.tree, 'CSV').props.onClick();
    await settle(5);
    assert.equal(clicks.at(-1).download, 'proof-ledger-release-2026-10-17.csv');
    await button(card.tree, 'JSON').props.onClick();
    await settle(5);
    assert.equal(said().props.role, 'alert');
    assert.equal(textIn(said()), 'Not exported: Export as Markdown, CSV or JSON.');
    await button(card.tree, 'Copy').props.onClick();
    await settle(5);
    assert.deepEqual(copied, ['# Claims ledger: Release\n']);
    assert.equal(textIn(said()), 'Copied the ledger as Markdown.');

    // A window without a clipboard: it says so, and what to do instead.
    const { react: r2, mount: m2 } = statefulReact();
    const bare = loadClient(CLIENT, { react: r2 }).client;
    connect(bare.internals.kit, { ledger: LEDGER, exportLedger: files.md });
    const other = m2(bare.internals.LedgerCard, { sessionId: 's', verifier: 'ask' });
    t.after(() => { other.unmount(); bare.internals.kit.setConnection(undefined); });
    await settle(5);
    await button(other.tree, 'Copy').props.onClick();
    await settle(5);
    assert.equal(textIn(withAttr(other.tree, 'data-proof-said')[0]), 'Not copied: this window may not use the clipboard. Download it as Markdown instead.');
    await button(other.tree, 'Markdown').props.onClick();
    await settle(5);
    assert.match(textIn(withAttr(other.tree, 'data-proof-said')[0]), /^Not exported: this window could not save the file \(/);
});

test('the page: empty, switched off, a wrong setting, the check off, and Proof not running each say what to do', async (t) => {
    const { react, mount } = statefulReact();
    const { client } = loadClient(CLIENT, { react });
    const { kit, ProofPage, TEXT } = client.internals;
    kit.setNavigation({ openBundle: () => {} });
    t.after(() => kit.setNavigation(undefined));
    let state = { ...PAGE_STATE, sessions: [], checks: [], history: [], verifier: { ...PAGE_STATE.verifier, mode: 'off' } };
    connect(kit, { state: () => state });
    t.after(() => kit.setConnection(undefined));
    const empty = mount(ProofPage, {});
    t.after(() => empty.unmount());
    await settle(5);
    let text = textIn(empty.tree);
    assert.match(text, new RegExp(`${TEXT.noSessions}${TEXT.noSessionsText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(text, /The independent check is off\./);
    assert.match(text, /The independent check is offTurn it on in Proof's settings to have a fresh read-only thread on a local model re-run or re-read a flagged claim's evidence\./);
    assert.ok(button(empty.tree, 'Open Proof\'s settings'), 'a way to its settings');
    assert.match(text, /Nothing yetChecks you ask for, exports and setting changes show here\./);
    assert.equal(withAttr(empty.tree, 'data-proof-ledger').length, 0, 'no ledger without a session');

    state = { ...PAGE_STATE, enabled: false, sessions: [] };
    const off = mount(ProofPage, {});
    t.after(() => off.unmount());
    await settle(5);
    text = textIn(off.tree);
    assert.match(text, /Proof is switched off in DSH's profile \(enabled: false in its entry in cordis\.patch\.yml\), so it reads no claims\./);
    assert.equal(withAttr(off.tree, 'data-proof-sessions').length, 0);

    state = { ...PAGE_STATE, problem: { key: 'verifierMinutes', text: 'Minutes a check may take (verifierMinutes) must be a whole number of minutes from 1 to 30 (it is 0)', live: true } };
    const wrong = mount(ProofPage, {});
    t.after(() => wrong.unmount());
    await settle(5);
    text = textIn(wrong.tree);
    assert.match(text, /Proof is waiting for a setting to be fixed\./);
    assert.match(text, /\(it is 0\)\.Change it in Proof's settings in Plugins\. Proof starts working again as soon as you save\./);
    assert.ok(button(wrong.tree, 'Open Proof\'s settings'));
    assert.equal(withAttr(wrong.tree, 'data-proof-history').length, 1, 'what happened still shows');

    const { react: r2, mount: m2 } = statefulReact();
    const down = loadClient(CLIENT, { react: r2 }).client;
    down.internals.kit.setConnection({ rpc: { call: async () => { throw new Error('404 Not Found'); } } });
    const gone = m2(down.internals.ProofPage, {});
    t.after(() => { gone.unmount(); down.internals.kit.setConnection(undefined); });
    await settle(5);
    text = textIn(gone.tree);
    assert.match(text, /Proof is not running\./);
    assert.match(text, /Open Proof in Plugins and switch it off and on again/);
    assert.doesNotMatch(text, /Session Watch/, 'Proof needs nothing else');
});

test('settings in Plugins: the form has every live setting, takes what the config takes, and saves through DSH', async () => {
    const { client } = loadClient(CLIENT);
    const { SETTINGS, TEXT, CSS, SETTINGS_NOTE, SETTINGS_SUMMARY } = client.internals;
    assert.deepEqual(plain(SETTINGS.map((f) => f.name).sort()), [...LIVE_SETTINGS].sort());
    for (const f of SETTINGS) {
        assert.equal(f.title, SETTING_TITLES[f.name], `${f.name}: the form and the config use the same words`);
        assert.deepEqual(plain(f.default), plain(DEFAULTS[f.name]), `${f.name}: the form's default is the config's`);
        if (f.kind === 'choice') {
            assert.deepEqual(plain(f.options.map((o) => [o.value, o.label])), Object.entries(VERIFIER_CHOICES));
            for (const o of f.options) assert.doesNotThrow(() => checkConfig({ ...DEFAULTS, [f.name]: o.value }));
        }
        if (f.kind === 'number') {
            assert.doesNotThrow(() => checkConfig({ ...DEFAULTS, [f.name]: f.min }), f.name);
            assert.doesNotThrow(() => checkConfig({ ...DEFAULTS, [f.name]: f.max }), f.name);
            assert.throws(() => checkConfig({ ...DEFAULTS, [f.name]: f.min - 1 }), f.name);
            assert.throws(() => checkConfig({ ...DEFAULTS, [f.name]: f.max + 1 }), f.name);
        }
        if (f.kind === 'text') {
            for (const value of ['owner-ascents', 'GLM-5.3-Flash-EXL3', 'org/model@v2', 'a:b+c']) {
                assert.equal(f.accepts(value), true, value);
                assert.doesNotThrow(() => checkConfig({ ...DEFAULTS, [f.name]: value }));
            }
            for (const value of ['-dash', 'two words', 'x'.repeat(121), 'a\nb']) {
                assert.equal(f.accepts(value), false, value);
                assert.throws(() => checkConfig({ ...DEFAULTS, [f.name]: value }));
            }
        }
    }
    assert.doesNotMatch(JSON.stringify(TEXT) + CSS.join('') + JSON.stringify(SETTINGS) + SETTINGS_NOTE + SETTINGS_SUMMARY, OTHER_NAMES);

    // Drawn through DSH's own settings form while DSH serves Proof's settings.
    const models = [];
    class SettingsFormModel {
        constructor(scope, specs) { this.scope = scope; this.specs = specs; models.push(this); }
        bind(project) { const value = project(); return { subscribe: () => () => {}, getSnapshot: () => value, set() {} }; }
        shell() { return { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }; }
        field(name) { const spec = this.specs.find((s) => s.field === name); return { text: spec.format(this.scope.getSnapshot().value[name]), overridden: false, invalid: false }; }
        actions() { return { edit() {}, resetField() {}, save() {}, discard() {} }; }
        dispose() { this.disposed = true; }
    }
    const { client: formClient } = loadClient(CLIENT, { ui: { SettingsFormModel, SettingsForm: (props) => ({ type: 'SettingsForm', props, children: props.children }) } });
    const registered = [];
    const served = [];
    const effects = [];
    const scope = {
        configForms: {
            get: (entry) => ({ entry, getSnapshot: () => ({ status: 'ready', writable: true, value: { ...DEFAULTS } }), subscribe: () => () => {} }),
            whileServed: (entries, fn) => { served.push(entries); return fn(); },
        },
        slots: { inject: (_name, fn) => fn(), register: (spec, component) => { registered.push({ spec, component }); return () => {}; } },
        effect: (fn) => { effects.push(fn); },
        inject: (names, fn) => { if (names[0] === 'configForms') fn(scope); },
    };
    formClient.apply(scope);
    for (const fn of effects) fn();
    await settle();
    assert.deepEqual(plain(served), [['proof']]);
    assert.equal(models[0].scope.entry, 'proof');
    assert.deepEqual(plain(models[0].specs.map((s) => s.field).sort()), [...LIVE_SETTINGS].sort());
    const entry = registered.find((item) => item.spec.name === 'plugins.bundle.config');
    assert.equal(entry.spec.key, 'dsh-plugin-proof');
    assert.equal(entry.component({ view: 'summary' }), SETTINGS_SUMMARY);
    const page = textIn(entry.component({}));
    assert.match(page, /Independent check/);
    assert.match(page, /never write a file/);
});
