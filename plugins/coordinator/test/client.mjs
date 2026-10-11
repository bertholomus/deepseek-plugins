/**
 * Tests for the browser half of dsh-plugin-coordinator (lib/client.js),
 * loaded the way DSH loads it, with stand-ins for React and DSH's
 * primitives. No DSH install needed.
 *
 * Run:  node plugins/coordinator/test/client.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { welcomeMessage, handbackMessage, idleMessage, approvalMessage, outsideMessage, replyMessage } from '../lib/prompts.js';

const tick = () => new Promise((r) => setTimeout(r, 10));
/** Values made inside the script's context, copied so they compare as plain data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/**
 * Load the browser half the way DSH does: a classic script that hands its
 * factory to the module loader, which calls it with DSH's module require.
 * The primitives are stand-ins; an icon is its own name.
 */
function loadClient({ storage, document, innerWidth, primitives = {} } = {}) {
    let loaded;
    const localStorage = storage ? { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, String(value)); } } : undefined;
    const window = { __ModuleLoader__: { load: (m) => { loaded = m; } }, localStorage, addEventListener: () => {}, removeEventListener: () => {}, innerWidth };
    runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
        window, ...(document ? { document } : {}),
        URL, console, setInterval, clearInterval, setTimeout, clearTimeout, queueMicrotask,
    });
    const base = {
        SettingsFormModel: class {
            constructor(scope) { this.scope = scope; }
            bind(project) { return { getSnapshot: project, subscribe: () => () => {} }; }
            shell() { return { available: this.scope.getSnapshot().status === 'ready', writable: true, dirty: false, invalid: false, saving: false, failed: false }; }
            field(name) { return { text: this.scope.getSnapshot().value?.[name] ?? '', overridden: false, invalid: false }; }
            actions() { return {}; }
            dispose() {}
        },
        settingsTextField: (field) => ({ field }),
        Toast: () => null,
        ...primitives,
    };
    const ui = new Proxy(base, { get: (target, name) => (name in target ? target[name] : typeof name === 'string' && name.startsWith('Icon') ? name : undefined) });
    const modules = {
        react: {
            createElement: (type, props, ...children) => ({ type, props, children }), useSyncExternalStore: (_subscribe, get) => get(),
            // Enough of React's hooks to call a component once and read what it draws.
            useState: (init) => [typeof init === 'function' ? init() : init, () => {}], useRef: (current) => ({ current }),
            useEffect: () => {}, useLayoutEffect: () => {}, useCallback: (fn) => fn, useMemo: (fn) => fn(), useId: () => ':r0:',
        },
        'react-dom': { createPortal: (node) => node }, '@deepseek-ai/dsh-client-ui-primitives': ui,
    };
    return { id: loaded.id, client: loaded.factory((name) => modules[name]), window, react: modules.react };
}

/**
 * Draw a component again and again with state that holds between draws
 * (the stand-in React's useState forgets), so a click can open what it opens.
 * @returns a function that draws it once more.
 */
function mount(react, render) {
    const cells = [];
    return () => {
        let at = 0;
        react.useState = (init) => {
            const k = at++;
            if (!(k in cells)) cells[k] = typeof init === 'function' ? init() : init;
            return [cells[k], (next) => { cells[k] = typeof next === 'function' ? next(cells[k]) : next; }];
        };
        return render();
    };
}

/** Every element in a tree a component returned (the test React's {type, props, children}), depth first. */
function elementsOf(node, out = []) {
    if (Array.isArray(node)) { for (const child of node) elementsOf(child, out); return out; }
    if (node === null || typeof node !== 'object') return out;
    out.push(node);
    elementsOf(node.children, out);
    return out;
}
/** The text an element tree shows. */
const textIn = (node) => (Array.isArray(node) ? node.map(textIn).join('') : node === null || node === undefined || node === false ? ''
    : typeof node === 'object' ? textIn(node.children) : String(node));
const byClass = (tree, name) => elementsOf(tree).filter((e) => String(e.props?.className ?? '').split(' ').includes(name));

/** Just enough of the DOM for the session list's passes: attributes, children, and the selectors they use. */
class FakeEl {
    constructor(tag, attrs = {}, children = []) {
        this.tagName = tag.toUpperCase();
        this.attrs = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
        this.children = children;
        this.parentElement = null;
        for (const child of children) child.parentElement = this;
    }
    get id() { return this.attrs.get('id') ?? ''; }
    set id(value) { this.attrs.set('id', String(value)); }
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    hasAttribute(name) { return this.attrs.has(name); }
    removeAttribute(name) { this.attrs.delete(name); }
    /** `[a]`, `[a="v"]`, `[a^="v"]`, lists of them, and the one compound selector the passes use, `[role="tree"] div`. */
    matches(selector) {
        if (selector.includes(',')) return selector.split(',').some((one) => this.matches(one));
        if (selector === '[role="tree"] div') {
            if (this.tagName !== 'DIV') return false;
            for (let e = this.parentElement; e; e = e.parentElement) if (e.getAttribute('role') === 'tree') return true;
            return false;
        }
        const m = /^\[([\w-]+)(?:(\^?=)"([^"]*)")?\]$/.exec(selector);
        if (!m) throw new Error(`selector not faked: ${selector}`);
        const value = this.getAttribute(m[1]);
        return value !== null && (!m[2] || (m[2] === '=' ? value === m[3] : value.startsWith(m[3])));
    }
    querySelectorAll(selector) {
        const out = [];
        const walk = (el) => { for (const child of el.children) { if (child.matches(selector)) out.push(child); walk(child); } };
        walk(this);
        return out;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector) {
        for (let e = this; e; e = e.parentElement) if (e.matches(selector)) return e;
        return null;
    }
}

/**
 * Draw a component again and again with state, refs and effects that hold
 * between draws, effects running after each draw (their dependencies are
 * the component's own business), so a fetch it starts can land.
 */
function liveMount(react, render) {
    const cells = [];
    const refs = [];
    return () => {
        let at = 0;
        let ref = 0;
        const effects = [];
        react.useState = (init) => {
            const k = at++;
            if (!(k in cells)) cells[k] = typeof init === 'function' ? init() : init;
            return [cells[k], (next) => { cells[k] = typeof next === 'function' ? next(cells[k]) : next; }];
        };
        react.useRef = (init) => {
            const k = ref++;
            if (!(k in refs)) refs[k] = { current: init };
            return refs[k];
        };
        react.useEffect = (fn) => { effects.push(fn); };
        const out = render();
        for (const fn of effects) fn();
        return out;
    };
}

test('browser half: the Projects page is every ◆ project in the list\'s order, each with its threads wherever they work, open ones first', () => {
    const { client } = loadClient();
    const { pageModel, visibleItems, takeKnown } = client.internals;
    takeKnown({});
    const value = (v) => ({ values: { coordinatorSession: v } });
    const sessions = {
        byId: {
            c: { id: 'c', title: '◆ Storefront' }, t1: { id: 't1', title: 'Fix cart' }, t2: { id: 't2', title: 'Hero images' }, t3: { id: 't3', title: 'Old copy' },
            y: { id: 'y', title: 'Archived one' }, d: { id: 'd', title: '◆ Data' }, dt: { id: 'dt', title: 'Nightly load' }, x: { id: 'x', title: 'A chat' }, z: { id: 'z', title: 'Notes' },
            e: { id: 'e', title: '◆ Ops' },
        },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [
                { id: 't1', session: 't1' }, { id: 't2', session: 't2' }, { id: 't3', session: 't3', resolved: true }, { id: 't4', session: 'y' },
            ] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            t2: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            t3: value({ role: 'thread', coordinator: 'c', thread: { id: 't3' } }),
            y: value({ role: 'thread', coordinator: 'c', thread: { id: 't4' } }),
            d: value({ role: 'coordinator', project: { id: 'data', name: 'Data' }, threads: [{ id: 't1', session: 'dt' }] }),
            dt: value({ role: 'thread', coordinator: 'd', thread: { id: 't1' } }),
        },
    };
    const items = [
        { workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['t3', 'c', 't1', 'x', 'y'] },
        { workspaceId: 'w-assets', title: 'storefront-assets', path: '/home/u/storefront-assets', sessionIds: ['t2'] },
        { workspaceId: 'w-data', title: '', path: '/home/u/data-pipeline', sessionIds: ['d', 'dt', 'z'] },
    ];
    const listed = [
        { id: 'data', name: 'Data', coordinator: 'd', home: 'w-data' },
        { id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf', paused: true },
        // One whose coordinator never started has nothing to open; one DSH doesn't list yet goes by what the list says.
        { id: 'later', name: 'Later', coordinator: null, home: 'w-sf' },
        { id: 'ops', name: 'Ops', coordinator: 'e', home: 'w-gone', workspace: '/srv/ops', workspaces: [], threads: { open: 2, resolved: 1 } },
    ];
    const tree = pageModel({ listed, items, sessions, archived: new Set(['y']) });
    const shape = (nodes) => nodes.map((n) => [n.kind, n.title, ...(n.children.length ? [shape(n.children)] : [])]);
    // Projects only, in the list's order. A project's threads in DSH's order, the resolved one last, the thread that
    // works in storefront-assets under its project; no chats, and no archived thread.
    assert.deepEqual(plain(shape(tree)), [
        ['project', 'Data', [['thread', 'Nightly load']]],
        ['project', 'Storefront', [['thread', 'Fix cart'], ['thread', 'Hero images'], ['thread', 'Old copy']]],
        ['project', 'Ops'],
    ]);
    // Each carries the name of the workspace it works in, its threads as its Threads menu counts them (its roster:
    // the archived thread too), and its pause.
    assert.deepEqual(plain(tree.map((n) => [n.id, n.folder, n.counts, n.paused])), [
        ['d', 'data-pipeline', { open: 1, resolved: 0 }, false],
        ['c', 'storefront', { open: 3, resolved: 1 }, true],
        ['e', 'ops', { open: 2, resolved: 1 }, false],
    ]);
    // Levels, places among siblings, and a folded project hides its threads.
    const shown = visibleItems(tree, new Set());
    assert.deepEqual(plain(shown.map((x) => [x.node.title, x.level, `${x.pos}/${x.size}`, x.open])), [
        ['Data', 1, '1/3', true], ['Nightly load', 2, '1/1', false],
        ['Storefront', 1, '2/3', true], ['Fix cart', 2, '1/3', false], ['Hero images', 2, '2/3', false], ['Old copy', 2, '3/3', false],
        ['Ops', 1, '3/3', false],
    ]);
    assert.deepEqual(plain(visibleItems(tree, new Set(['project:c'])).map((x) => x.node.title)), ['Data', 'Nightly load', 'Storefront', 'Ops']);
    // The newest paused word wins over the list's.
    assert.deepEqual(plain(pageModel({ listed, items, sessions, archived: new Set(), pausedOf: (id) => (id === 'c' ? false : undefined) }).map((n) => n.paused)), [false, false, false]);
});

test('browser half: the Projects page is headed Projects with how many, and a project\'s row says where it works and its threads', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, treeMeta, listText } = client.internals;
    const value = (v) => ({ values: { coordinatorSession: v } });
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ DSH Plugins' }, t1: { id: 't1', title: 'Fix the page' }, t2: { id: 't2', title: 'Old fix' }, x: { id: 'x', title: 'A chat' }, r: { id: 'r', title: '◆ Recipes' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'dsh-plugins', name: 'DSH Plugins' }, threads: [{ id: 't1', session: 't1', resolved: false }, { id: 't2', session: 't2', resolved: true }] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            t2: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            r: value({ role: 'coordinator', project: { id: 'recipes', name: 'Recipes' }, threads: [] }),
        },
    };
    let workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [
            { workspaceId: 'w-dsh', title: 'deepseek-plugins', path: '/home/u/deepseek-plugins', sessionIds: ['c', 't2', 't1', 'x'] },
            { workspaceId: 'w-notes', title: 'notes', path: '/Users/u/notes', sessionIds: ['r'] },
        ],
    };
    let listed = [
        { id: 'dsh-plugins', name: 'DSH Plugins', coordinator: 'c', home: 'w-dsh', source: 'profile' },
        { id: 'recipes', name: 'Recipes', coordinator: 'r', home: 'w-notes', source: 'page' },
    ];
    const facts = { subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {}, projects: () => listed, listFailed: () => false };
    const props = {
        useSessions: (select) => select(sessions), useSessionStatus: (select) => select(new Map()), useWorkspaces: (select) => select(workspaces),
        projects: { facts, openSession: () => {} },
    };
    const draw = mount(react, () => ProjectsPage(props));
    const classed = (tree, name) => textIn(byClass(tree, name));
    let page = draw();
    // Headed Projects, with how many; nothing else on it but Find by name and the tree.
    assert.equal(textIn(elementsOf(page).filter((e) => e.type === 'h1')), 'Projects');
    assert.equal(classed(page, 'dshp-pg-count'), '2 projects');
    assert.doesNotMatch(textIn(page), /categor|workspace|chat/i);
    assert.equal(elementsOf(page).some((e) => e.props?.['data-projects-new'] !== undefined || typeof e.props?.onSubmit === 'function'), false);
    const treeEl = elementsOf(page).find((e) => e.type === PageTree);
    assert.equal(treeEl.props.label, 'Projects');
    const items = elementsOf(mount(react, () => PageTree(treeEl.props))()).filter((e) => e.props?.role === 'treeitem');
    // A ◆ project, the workspace it works in and its threads as its Threads menu counts them; under it its threads, open
    // ones first, each with its state.
    assert.deepEqual(plain(items.map((li) => [li.props['aria-level'], li.props['data-projects-node'], classed(li.children[0], 'dshp-tree-diamond'),
        classed(li.children[0], 'dshp-tree-title'), classed(li.children[0], 'dshp-tree-meta')])), [
        [1, 'project', '◆', 'DSH Plugins', 'deepseek-plugins · 1 open thread · 1 resolved'],
        [2, 'thread', '', 'Fix the page', 'Idle'],
        [2, 'thread', '', 'Old fix', 'Resolved'],
        [1, 'project', '◆', 'Recipes', 'notes · no threads yet'],
    ]);
    // One tab stop; a project without threads has nothing to fold.
    assert.deepEqual(items.map((li) => li.props.tabIndex), [0, -1, -1, -1]);
    assert.deepEqual(items.map((li) => li.props['aria-expanded']), [true, undefined, undefined, undefined]);
    assert.equal(elementsOf(items[3].children[0]).some((e) => e.props?.['data-projects-chevron'] !== undefined), false);
    assert.deepEqual([
        treeMeta({ kind: 'project', id: 'c', folder: 'shop', counts: { open: 2, resolved: 0 }, children: [] }),
        treeMeta({ kind: 'project', id: 'c', folder: 'shop', paused: true, counts: { open: 0, resolved: 3 }, children: [] }),
        treeMeta({ kind: 'project', id: 'c', folder: '', counts: { open: 0, resolved: 0 }, children: [] }),
        treeMeta({ kind: 'thread', id: 't', children: [] }),
    ], ['shop · 2 open threads', 'Paused · shop · 0 open threads · 3 resolved', 'no threads yet', null]);

    // No project yet: loading until DSH has its workspaces, then the empty state says what a project is and where one comes from.
    listed = [];
    workspaces = { ...workspaces, items: [], phase: 'pending' };
    page = draw();
    assert.equal(classed(page, 'dshp-pg-state'), 'Loading projects…');
    workspaces = { ...workspaces, phase: 'ready' };
    page = draw();
    const empty = byClass(page, 'dshp-pg-empty')[0];
    assert.equal(textIn(elementsOf(empty).filter((e) => e.type === 'h2')), 'No projects yet');
    assert.match(textIn(elementsOf(empty).filter((e) => e.type === 'p')), /^A project is a ◆ coordinator in one of your workspaces, with the threads it starts\./);
    assert.equal(classed(page, 'dshp-pg-count'), '');
    // Still loading the plugin's list.
    listed = null;
    assert.equal(classed(draw(), 'dshp-pg-state'), 'Loading projects…');

    // The entry in DSH's sidebar is named as the page is headed.
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push(slot); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }), subscribe: () => () => {} } },
        uiWorkspace: {},
        sidebarRight: {},
    };
    client.apply(ctx);
    assert.equal(registered.find((r) => r.name === 'sidebar.panellist')?.label, 'Projects');
    // Names as a sentence lists them (the access texts use it).
    assert.deepEqual([listText([]), listText(['A']), listText(['A', 'B']), listText(['A', 'B', 'C'])], ['', 'A', 'A and B', 'A, B and C']);
});

test('browser half: the Projects page gives each thread its state, marks a paused project and its news, and a chevron folds a project', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, pageRefusal } = client.internals;
    const value = (v) => ({ values: { coordinatorSession: v } });
    const at = (minutes) => new Date(Date.UTC(2026, 9, 11, 2, minutes)).toISOString();
    const thread = (id) => value({ role: 'thread', coordinator: 'c', thread: { id } });
    const titles = { run: 'Upgrade the payments SDK', wait: 'Write outside', fail: 'Bad request', stop: 'Stopped one', block: 'Blocked one', ask: 'Pick a colour', done: 'Hero images', idle: 'Not started', gone: 'Resolved one' };
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ Storefront' }, d: { id: 'd', title: '◆ Data Pipeline' }, dt: { id: 'dt', title: 'Nightly load' }, x: { id: 'x', title: 'A chat' },
            ...Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { id, title }])) },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [
                { id: 't1', session: 'fail', handback: { status: 'done', at: at(1) } },
                { id: 't2', session: 'stop' },
                { id: 't3', session: 'block', handback: { status: 'blocked', at: at(3) } },
                { id: 't4', session: 'ask', handback: { status: 'needs_decision', at: at(4) } },
                { id: 't5', session: 'done', handback: { status: 'done', at: at(5) } },
                { id: 't6', session: 'idle' }, { id: 't7', session: 'run' }, { id: 't8', session: 'wait' }, { id: 't9', session: 'gone', resolved: true },
            ] }),
            fail: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' }, ending: { state: 'failed', at: at(2), kind: 'error', message: 'HTTP 400' } }),
            stop: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' }, ending: { state: 'stopped', at: at(2) } }),
            ...Object.fromEntries(['block', 'ask', 'done', 'idle', 'run', 'wait', 'gone'].map((id) => [id, thread(id)])),
            d: value({ role: 'coordinator', project: { id: 'data-pipeline', name: 'Data Pipeline' }, threads: [{ id: 't1', session: 'dt', handback: { status: 'done', at: at(6) } }] }),
            dt: value({ role: 'thread', coordinator: 'd', thread: { id: 't1' } }),
        },
    };
    const workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [
            // The resolved thread comes first in DSH's list, and is drawn last.
            { workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['c', 'gone', ...Object.keys(titles).filter((id) => id !== 'gone'), 'x'] },
            { workspaceId: 'w-dp', title: 'data-pipeline', path: '/home/u/data-pipeline', sessionIds: ['d', 'dt'] },
        ],
    };
    const listed = [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf' }, { id: 'data-pipeline', name: 'Data Pipeline', coordinator: 'd', home: 'w-dp', paused: false }];
    let news = { c: { unread: [{ kind: 'handback', status: 'blocked', title: 'Blocked one' }] } };
    const facts = {
        subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {},
        projects: () => listed, listFailed: () => false,
        // Data Pipeline was paused since the list was read: the newer word wins.
        paused: (coordinator) => (coordinator === 'd' ? true : undefined), newsOf: (coordinator) => news[coordinator],
    };
    // DSH's own status: one thread runs, one waits on the user's approval.
    const statuses = new Map([['run', { running: true }], ['wait', { running: true, pendingInteraction: { kind: 'approval' } }]]);
    const opened = [];
    const props = {
        useSessions: (select) => select(sessions), useSessionStatus: (select) => select(statuses), useWorkspaces: (select) => select(workspaces),
        projects: { facts, openSession: (id) => opened.push(id) },
    };
    const drawPage = mount(react, () => ProjectsPage(props));
    const page = drawPage();
    const treeEl = elementsOf(page).find((e) => e.type === PageTree);
    const drawTree = mount(react, () => PageTree(treeEl.props));
    const items = (tree) => elementsOf(tree).filter((e) => e.props?.role === 'treeitem');
    const row = (tree, id) => items(tree).find((li) => li.props['data-projects-id'] === id);
    let tree = drawTree();
    // Each thread in the Threads menu's words and dots: what DSH says of its session first, then a failed or stopped
    // last turn after its handback, then the handback; the resolved one last.
    const states = items(row(tree, 'c').children[1]).map((li) => {
        const state = byClass(li.children[0], 'dshp-tree-state')[0];
        return [textIn(byClass(li.children[0], 'dshp-tree-title')), state.props['data-projects-state'], textIn(state)];
    });
    assert.deepEqual(plain(states), [
        ['Upgrade the payments SDK', 'ongoing', 'Running'], ['Write outside', 'warning', 'Needs you'], ['Bad request', 'error', 'Failed'],
        ['Stopped one', 'idle', 'Stopped'], ['Blocked one', 'warning', 'Blocked'], ['Pick a colour', 'warning', 'Needs a decision'],
        ['Hero images', 'done', 'Done'], ['Not started', 'idle', 'Idle'], ['Resolved one', 'done', 'Resolved'],
    ]);
    // A paused project says so first, with the pause sign; one with news reads bold, its dot named for screen readers.
    const dp = row(tree, 'd');
    assert.equal(dp.props['data-projects-paused'], '');
    assert.equal(textIn(byClass(dp.children[0], 'dshp-tree-meta')), 'Paused · data-pipeline · 1 open thread');
    assert.equal(byClass(dp.children[0], 'dshp-t-paused-mark').length, 1);
    const sf = row(tree, 'c');
    assert.deepEqual([sf.props['data-projects-paused'], sf.props['data-projects-unread'], byClass(sf.children[0], 'dshp-t-paused-mark').length], [undefined, 1, 0]);
    assert.equal(textIn(byClass(sf.children[0], 'dshp-tree-meta')), 'storefront · 8 open threads · 1 resolved');
    const mark = elementsOf(sf.children[0]).find((e) => e.props?.['data-projects-news-mark'] !== undefined);
    assert.deepEqual([mark.props.role, mark.props['aria-label']], ['img', 'New: “Blocked one” is blocked']);
    // Seen: no mark; the project's own dot is DSH's for its coordinator (none while it is idle, Running while it runs).
    news = {};
    const fresh = () => mount(react, () => PageTree(elementsOf(mount(react, () => ProjectsPage(props))()).find((e) => e.type === PageTree).props))();
    tree = fresh();
    assert.equal(row(tree, 'c').props['data-projects-unread'], undefined);
    assert.equal(elementsOf(row(tree, 'c').children[0]).some((e) => e.props?.role === 'img'), false);
    statuses.set('c', { running: true });
    assert.equal(elementsOf(row(fresh(), 'c').children[0]).find((e) => e.props?.role === 'img')?.props['aria-label'], 'Running');
    // The chevron folds a project's threads and stays on the page; the rest of its row, or Enter, opens the coordinator.
    tree = drawTree();
    const chevron = (li) => elementsOf(li.children[0]).find((e) => e.props?.['data-projects-chevron'] !== undefined);
    assert.equal(row(tree, 'c').props['aria-expanded'], true);
    let stopped = 0;
    chevron(row(tree, 'c')).props.onClick({ stopPropagation: () => { stopped += 1; } });
    tree = drawTree();
    assert.equal(row(tree, 'c').props['aria-expanded'], false);
    assert.equal(row(tree, 'run'), undefined);
    assert.deepEqual([opened, stopped], [[], 1]);
    chevron(row(tree, 'c')).props.onClick({ stopPropagation: () => {} });
    tree = drawTree();
    assert.equal(row(tree, 'c').props['aria-expanded'], true);
    row(tree, 'c').props.onClick({ stopPropagation: () => {} });
    assert.deepEqual(opened, ['c']);
    // The keys, from the project's row: ↓ to its first thread, which becomes the one tab stop, and Enter opens it;
    // ← goes back to the project, Enter opens its coordinator, ← again folds it and → opens it; End and Home.
    row(drawTree(), 'c').props.onFocus({ target: 1, currentTarget: 1 });
    const key = (name) => {
        let prevented = 0;
        elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: name, preventDefault: () => { prevented += 1; } });
        return prevented;
    };
    assert.equal(key('ArrowDown'), 1);
    assert.deepEqual([row(drawTree(), 'run').props.tabIndex, row(drawTree(), 'c').props.tabIndex], [0, -1]);
    assert.equal(key('Enter'), 1);
    assert.deepEqual(opened, ['c', 'run']);
    key('ArrowLeft');
    key('Enter');
    assert.deepEqual(opened, ['c', 'run', 'c']);
    key('ArrowLeft');
    assert.equal(row(drawTree(), 'c').props['aria-expanded'], false);
    key('ArrowRight');
    assert.equal(row(drawTree(), 'c').props['aria-expanded'], true);
    key('End');
    assert.equal(row(drawTree(), 'dt').props.tabIndex, 0);
    key('Home');
    assert.equal(row(drawTree(), 'c').props.tabIndex, 0);
    // Alt and an arrow move nothing on the page: each says why, and the focus stays. A project goes where the workspace it
    // works in goes; a thread stays in its project, in the session list's order, and can't leave it at either end.
    const said = () => textIn(elementsOf(drawPage()).find((e) => e.props?.['data-projects-page-said'] !== undefined));
    const alt = (name, extra = {}) => {
        let prevented = 0;
        elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: name, altKey: true, preventDefault: () => { prevented += 1; }, ...extra });
        return [prevented, said().trim()];
    };
    assert.equal(said(), '');
    assert.deepEqual(alt('ArrowDown'), [1, 'Projects keep the order of the workspaces they work in.']);
    assert.deepEqual(alt('ArrowRight'), [1, 'A project can\'t go inside another project.']);
    assert.deepEqual(alt('ArrowLeft'), [1, 'A project stays in its workspace.']);
    assert.equal(row(drawTree(), 'c').props.tabIndex, 0);
    key('ArrowDown');
    assert.deepEqual(alt('ArrowUp'), [1, 'A thread stays with the project it started in.']);
    assert.deepEqual(alt('ArrowDown'), [1, 'A project\'s threads keep the session list\'s order, open ones first.']);
    assert.deepEqual(alt('ArrowLeft'), [1, 'A thread stays with the project it started in.']);
    assert.deepEqual(alt('ArrowRight'), [1, 'A thread can\'t go inside another thread.']);
    assert.equal(row(drawTree(), 'run').props.tabIndex, 0);
    key('End');
    assert.deepEqual(alt('ArrowDown'), [1, 'A thread stays with the project it started in.']);
    const once = said();
    alt('ArrowDown');
    assert.notEqual(said(), once, 'the same words again are said again');
    assert.equal(row(drawTree(), 'dt').props.tabIndex, 0);
    // With Shift, Ctrl or Meta too, the keys are DSH's own.
    assert.deepEqual(alt('ArrowDown', { shiftKey: true })[0], 0);
    assert.deepEqual(alt('ArrowLeft', { metaKey: true })[0], 0);
    // On the whole tree, though a find shows only part of it: the last open thread isn't the project's last.
    const whole = treeEl.props.tree;
    assert.deepEqual(plain(['idle', 'gone'].map((id) => pageRefusal(whole, `thread:${id}`, 'ArrowDown'))), [
        'A project\'s threads keep the session list\'s order, open ones first.', 'A thread stays with the project it started in.',
    ]);
    assert.deepEqual(plain([pageRefusal(whole, 'thread:x', 'ArrowDown'), pageRefusal(whole, 'project:nope', 'ArrowUp'), pageRefusal(whole, 'project:c', 'Enter')]), [null, null, null]);
    // Keys with a modifier are DSH's own.
    assert.equal(elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: 'ArrowDown', metaKey: true, preventDefault: () => assert.fail('taken') }), undefined);
});

test('browser half: on the Projects page, a thread whose handback a pause holds reads as its Threads menu says', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, rowsOf, withHeld } = client.internals;
    const value = (v) => ({ values: { coordinatorSession: v } });
    const roster = [{ id: 't1', session: 'held' }, { id: 't2', session: 'ask' }, { id: 't3', session: 'run' }, { id: 't4', session: 'none' }];
    const titles = { held: 'Audit the nightly backfill job', ask: 'Pick a warehouse', run: 'Load the archive', none: 'Not started' };
    const sessions = {
        phase: 'ready',
        byId: { d: { id: 'd', title: '◆ Data Pipeline' }, ...Object.fromEntries(Object.entries(titles).map(([id, title]) => [id, { id, title }])) },
        projectionsBySession: {
            d: value({ role: 'coordinator', project: { id: 'data-pipeline', name: 'Data Pipeline' }, threads: roster }),
            ...Object.fromEntries(roster.map((t) => [t.session, value({ role: 'thread', coordinator: 'd', thread: { id: t.id } })])),
        },
    };
    const workspaces = { phase: 'ready', archivedSessionIds: [], items: [{ workspaceId: 'w-dp', title: 'data-pipeline', path: '/home/u/data-pipeline', sessionIds: ['d', ...Object.keys(titles)] }] };
    // The pause holds t1's done handback, t2's question, and one from t3, which runs again.
    const handbacks = [{ thread: 't1', status: 'done' }, { thread: 't2', status: 'needs_decision' }, { thread: 't3', status: 'done' }];
    let paused = true;
    const watched = [];
    const facts = {
        subscribe: () => () => {}, getSnapshot: () => 0, list: async () => {}, newsOf: () => undefined,
        projects: () => [{ id: 'data-pipeline', name: 'Data Pipeline', coordinator: 'd', home: 'w-dp', paused }], listFailed: () => false,
        paused: () => paused,
        // describe's answer, which the Threads menu reads the held handbacks from too.
        info: (target) => (target === 'd' ? { paused: { value: paused, held: handbacks.length, handbacks } } : null),
        watch: (key) => { watched.push(key); return () => {}; },
    };
    const statuses = new Map([['run', { running: true }]]);
    const props = { useSessions: (select) => select(sessions), useSessionStatus: (select) => select(statuses), useWorkspaces: (select) => select(workspaces), projects: { facts, openSession: () => {} } };
    // The page's own effects run, so what it reads shows.
    let effects = [];
    const states = () => {
        effects = [];
        react.useEffect = (effect) => { effects.push(effect); };
        const treeEl = elementsOf(mount(react, () => ProjectsPage(props))()).find((e) => e.type === PageTree);
        react.useEffect = () => {};
        const tree = mount(react, () => PageTree(treeEl.props))();
        return Object.fromEntries(elementsOf(tree).filter((e) => e.props?.role === 'treeitem' && e.props['data-projects-node'] === 'thread').map((li) => {
            const state = byClass(li.children[0], 'dshp-tree-state')[0];
            return [textIn(byClass(li.children[0], 'dshp-tree-title')), [state.props['data-projects-state'], textIn(state)]];
        }));
    };
    // The Threads menu's dot and word for each thread.
    const menu = () => Object.fromEntries(withHeld(rowsOf(roster, statuses, sessions.byId, {}), paused ? handbacks : []).map((row) => [titles[row.session], [row.dot, row.stateLabel]]));
    let page = states();
    assert.deepEqual(plain(page), {
        'Audit the nightly backfill job': ['done', 'Done'], 'Pick a warehouse': ['warning', 'Needs a decision'], 'Load the archive': ['ongoing', 'Running'], 'Not started': ['idle', 'Idle'],
    });
    assert.deepEqual(plain(page), plain(menu()));
    // It reads the paused project's description while it shows it, as the Threads menu does.
    for (const effect of effects) effect();
    assert.deepEqual(watched, ['list', 'd:d']);
    // Resumed: nothing is held, and the page no longer reads it.
    paused = false;
    page = states();
    assert.deepEqual(plain(page), {
        'Audit the nightly backfill job': ['idle', 'Idle'], 'Pick a warehouse': ['idle', 'Idle'], 'Load the archive': ['ongoing', 'Running'], 'Not started': ['idle', 'Idle'],
    });
    assert.deepEqual(plain(page), plain(menu()));
    watched.length = 0;
    for (const effect of effects) effect();
    assert.deepEqual(watched, ['list']);
});

test('browser half: a row on the Projects page has ⋯: a project\'s settings and Archive project…, a thread\'s other way to open and its project\'s settings', async () => {
    const storage = new Map();
    const { client, react } = loadClient({ storage });
    const { ProjectsPage, PageTree, RowMenu } = client.internals;
    const value = (v) => ({ values: { coordinatorSession: v } });
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ Storefront' }, run: { id: 'run', title: 'Upgrade the payments SDK' }, ask: { id: 'ask', title: 'Pick a colour' }, d: { id: 'd', title: '◆ Data Pipeline' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', session: 'run' }, { id: 't2', session: 'ask' }] }),
            run: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            ask: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            d: value({ role: 'coordinator', project: { id: 'data-pipeline', name: 'Data Pipeline' }, threads: [] }),
        },
    };
    const workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [{ workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['c', 'run', 'ask'] }, { workspaceId: 'w-dp', title: 'data-pipeline', path: '/home/u/data-pipeline', sessionIds: ['d'] }],
    };
    const listed = [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf' }, { id: 'data-pipeline', name: 'Data Pipeline', coordinator: 'd', home: 'w-dp' }];
    const facts = { subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {}, projects: () => listed, listFailed: () => false };
    // Project settings and the archive's confirmation open where DSH lets the plugin draw them.
    const done = [];
    let settingsOn = true;
    let archiveOn = true;
    const settings = { subscribe: () => () => {}, getSnapshot: () => ({ available: settingsOn }), open: (id, options) => done.push(['settings', id, options]) };
    const flow = { subscribe: () => () => {}, getSnapshot: () => ({ available: archiveOn }), open: (id) => done.push(['archive', id]) };
    const projects = {
        facts, settings,
        openSession: (id) => done.push(['open', id]), openFull: (id) => done.push(['full', id]), openPaired: (id) => done.push(['beside', id]),
    };
    const props = { useSessions: (select) => select(sessions), useSessionStatus: (select) => select(new Map()), useWorkspaces: (select) => select(workspaces), projects, flow };
    // The page drawn afresh each time (what it passes reads the switches above), the tree's own state kept.
    const treeOf = (lib, r) => {
        let now;
        const draw = mount(r, () => lib.PageTree(now));
        return () => {
            now = elementsOf(mount(r, () => lib.ProjectsPage(props))()).find((e) => e.type === lib.PageTree).props;
            return draw();
        };
    };
    let drawTree = treeOf(client.internals, react);
    const items = (tree) => elementsOf(tree).filter((e) => e.props?.role === 'treeitem');
    const row = (tree, id) => items(tree).find((li) => li.props['data-projects-id'] === id);
    // A row's ⋯ is its own part, last in the row; Menu is DSH's, drawn by RowMenu.
    const menuOf = (li) => elementsOf(li.children[0]).find((e) => e.type === RowMenu);
    const drawn = (li) => RowMenu(menuOf(li).props);
    const picks = (li) => plain(drawn(li).props.items.map((item) => [item.id, item.label, item.icon?.type]));
    let tree = drawTree();
    assert.equal(menuOf(row(tree, 'c')), elementsOf(row(tree, 'c').children[0]).at(-1));
    assert.deepEqual(picks(row(tree, 'c')), [['settings', 'Project settings', 'IconSlidersTwoOutlineRegular'], ['archive', 'Archive project…', 'IconArchiveOutlineRegular']]);
    // A thread opens beside its coordinator from its row, so its ⋯ offers the full view; with that turned off, the other way.
    assert.deepEqual(picks(row(tree, 'run')), [['full', 'Open in full view', 'IconRightUpOutlineRegular'], ['thread-settings', 'Model and permission…', 'IconSlidersTwoOutlineRegular'], ['settings', 'Project settings', 'IconSlidersTwoOutlineRegular']]);
    // Each is named for its row, opens on its own, and keeps the tree's one tab stop.
    const menu = drawn(row(tree, 'c'));
    // DSH's autoFocus misses a list in the page's body (hidden while it measures it), so the page's own hook finds it by its class.
    assert.deepEqual(plain([menu.props.open, menu.props.portal, menu.props.align, menu.props.autoFocus === true, menu.props.closeOnPointerLeave, /^dshp-menu-\d+$/.test(menu.props.listClassName)]),
        [false, true, 'end', false, true, true]);
    const button = menu.props.anchor;
    assert.deepEqual(plain([button.type, button.props.className, button.props.tabIndex, button.props['aria-label'], button.props['aria-haspopup'], button.props['aria-expanded'], button.props['data-projects-page-menu']]),
        ['button', 'dshp-tree-more', -1, 'Project actions: Storefront', 'menu', false, '']);
    assert.equal(drawn(row(tree, 'ask')).props.anchor.props['aria-label'], 'Thread actions: Pick a colour');
    assert.deepEqual(items(tree).map((li) => li.props['aria-keyshortcuts']), ['Shift+F10', 'Shift+F10', 'Shift+F10', 'Shift+F10']);
    // A click on ⋯ opens its menu and not the row's chat; picking an item closes it and does it.
    let stopped = 0;
    button.props.onClick({ stopPropagation: () => { stopped += 1; } });
    tree = drawTree();
    assert.deepEqual([stopped, drawn(row(tree, 'c')).props.open, drawn(row(tree, 'run')).props.open, drawn(row(tree, 'c')).props.anchor.props['aria-expanded']], [1, true, false, true]);
    assert.equal(row(tree, 'c').props.tabIndex, 0);
    drawn(row(tree, 'c')).props.onSelect('settings');
    tree = drawTree();
    assert.equal(drawn(row(tree, 'c')).props.open, false);
    drawn(row(tree, 'c')).props.onSelect('archive');
    drawn(row(tree, 'run')).props.onSelect('full');
    drawn(row(tree, 'ask')).props.onSelect('settings');
    assert.deepEqual(plain(done), [['settings', 'c', null], ['archive', 'c'], ['full', 'run'], ['settings', 'ask', null]]);
    // The keys: Shift+F10 or the context-menu key opens the focused row's menu (the keyboard then on its ⋯, which DSH's
    // menu walks from); while it is open, keys from ⋯ are the menu's; Escape closes it and the tree's keys work again.
    done.length = 0;
    const tabStop = (t) => items(t).find((li) => li.props.tabIndex === 0).props['data-projects-id'];
    const key = (name, extra = {}) => {
        let prevented = 0;
        elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: name, preventDefault: () => { prevented += 1; }, ...extra });
        return prevented;
    };
    const onItem = { target: { matches: (selector) => selector === '[role="treeitem"]' } };
    const onMore = { target: { matches: () => false } };
    assert.equal(key('ArrowDown', onItem), 1);
    assert.equal(tabStop(drawTree()), 'run');
    assert.equal(key('F10', { shiftKey: true, ...onItem }), 1);
    tree = drawTree();
    assert.deepEqual([drawn(row(tree, 'run')).props.open, drawn(row(tree, 'c')).props.open], [true, false]);
    assert.equal(key('ArrowDown', onMore), 0);
    assert.equal(tabStop(drawTree()), 'run');
    drawn(row(drawTree(), 'run')).props.onClose();
    assert.equal(drawn(row(drawTree(), 'run')).props.open, false);
    assert.equal(key('ArrowDown', onMore), 1);
    assert.equal(tabStop(drawTree()), 'ask');
    // From ⋯, Enter and Space are its own (they open the menu), whatever the tree would do.
    assert.deepEqual([key('Enter', onMore), key(' ', onMore)], [0, 0]);
    assert.deepEqual(plain(done), []);
    assert.equal(key('ContextMenu', onItem), 1);
    assert.equal(drawn(row(drawTree(), 'ask')).props.open, true);
    drawn(row(drawTree(), 'ask')).props.onClose();
    // With Alt, Ctrl or Meta, F10 and the context-menu key are DSH's.
    assert.deepEqual([key('F10', { shiftKey: true, altKey: true, ...onItem }), key('ContextMenu', { ctrlKey: true, ...onItem })], [0, 0]);
    // A right-click on the row opens its menu; one inside a nested row is that row's, not its project's.
    const li = { closest: () => li, contains: () => true };
    let prevented = 0;
    row(drawTree(), 'c').props.onContextMenu({ target: li, currentTarget: li, preventDefault: () => { prevented += 1; }, stopPropagation: () => {} });
    assert.deepEqual([prevented, drawn(row(drawTree(), 'c')).props.open, tabStop(drawTree())], [1, true, 'c']);
    drawn(row(drawTree(), 'c')).props.onClose();
    const nested = { closest: () => 'the thread\'s row' };
    row(drawTree(), 'c').props.onContextMenu({ target: nested, currentTarget: li, preventDefault: () => assert.fail('taken'), stopPropagation: () => {} });
    assert.equal(drawn(row(drawTree(), 'c')).props.open, false);
    // Clicks and keys in a menu, drawn elsewhere in the page, reach the tree through React: it leaves them be.
    const outside = { target: { matches: () => true }, currentTarget: { contains: () => false } };
    row(drawTree(), 'run').props.onClick({ ...outside, stopPropagation: () => assert.fail('taken') });
    assert.equal(key('ArrowUp', outside), 0);
    assert.equal(key('F10', { shiftKey: true, ...outside }), 0);
    assert.deepEqual(plain(done), []);
    // With the beside view off, a thread's ⋯ opens it beside its coordinator; without Project settings or the archive,
    // a project has no ⋯ and its keys open nothing, and a thread's offers only the other way to open it.
    storage.set('dsh-plugin-coordinator/open-beside', 'off');
    const fresh = loadClient({ storage });
    const later = fresh.client.internals;
    settingsOn = false;
    archiveOn = false;
    drawTree = treeOf(later, fresh.react);
    tree = drawTree();
    const laterMenu = (el) => elementsOf(el.children[0]).find((e) => e.type === later.RowMenu);
    assert.deepEqual([laterMenu(row(tree, 'c')), row(tree, 'c').props['aria-keyshortcuts'], row(tree, 'c').props.onContextMenu], [undefined, undefined, undefined]);
    const threadMenu = later.RowMenu(laterMenu(row(tree, 'run')).props);
    assert.deepEqual(plain(threadMenu.props.items.map((item) => [item.id, item.label, item.icon?.type])), [['beside', 'Open beside its coordinator', 'IconCompareSplitOutlineRegular']]);
    threadMenu.props.onSelect('beside');
    assert.deepEqual(plain(done), [['beside', 'run']]);
    assert.equal(elementsOf(drawTree()).find((e) => e.props?.role === 'tree').props.onKeyDown({ key: 'F10', shiftKey: true, ...onItem, preventDefault: () => assert.fail('taken') }), undefined);
    // Only one archive's confirmation: a project the page shows is never archived (it leaves the page first).
    archiveOn = true;
    tree = drawTree();
    assert.deepEqual(plain(later.RowMenu(laterMenu(row(tree, 'd')).props).props.items.map((item) => item.id)), ['archive']);
    // Where the plugin can change a thread, its ⋯ has Mark resolved (Stop while it runs), sent as the user's own.
    const changed = [];
    facts.change = async (target, changes) => { changed.push([target, plain(changes)]); return { ok: true, value: {} }; };
    tree = drawTree();
    const resolving = later.RowMenu(laterMenu(row(tree, 'run')).props);
    assert.deepEqual(plain(resolving.props.items.map((item) => [item.id, item.label])), [['beside', 'Open beside its coordinator'], ['resolve', 'Mark resolved']]);
    resolving.props.onSelect('resolve');
    await tick();
    assert.deepEqual(changed, [['run', { thread: 't1', resolved: true }]]);
    delete facts.change;
});

test('browser half: Find by name on the Projects page keeps each match under its project, and its folds are its own', () => {
    const { client, react } = loadClient();
    const { ProjectsPage, PageTree, findInTree, withHit } = client.internals;
    const value = (v) => ({ values: { coordinatorSession: v } });
    const sessions = {
        phase: 'ready',
        byId: { c: { id: 'c', title: '◆ Storefront' }, t1: { id: 't1', title: 'Fix the cart' }, t2: { id: 't2', title: 'Hero images' }, t3: { id: 't3', title: 'Fleet power budget' },
            f: { id: 'f', title: '◆ Fleet Ops' }, n: { id: 'n', title: 'Lane restarts' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', session: 't1' }, { id: 't2', session: 't2', resolved: true }, { id: 't3', session: 't3' }] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            t2: value({ role: 'thread', coordinator: 'c', thread: { id: 't2' } }),
            t3: value({ role: 'thread', coordinator: 'c', thread: { id: 't3' } }),
            f: value({ role: 'coordinator', project: { id: 'fleet-ops', name: 'Fleet Ops' }, threads: [{ id: 't1', session: 'n' }] }),
            n: value({ role: 'thread', coordinator: 'f', thread: { id: 't1' } }),
        },
    };
    const workspaces = {
        phase: 'ready', archivedSessionIds: [],
        items: [
            { workspaceId: 'w-sf', title: 'storefront', path: '/home/u/storefront', sessionIds: ['c', 't1', 't2', 't3'] },
            { workspaceId: 'w-ops', title: 'fleet-ops', path: '/home/u/fleet-ops', sessionIds: ['f', 'n'] },
        ],
    };
    const facts = {
        subscribe: () => () => {}, getSnapshot: () => 0, watch: () => () => {}, list: async () => {},
        projects: () => [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w-sf' }, { id: 'fleet-ops', name: 'Fleet Ops', coordinator: 'f', home: 'w-ops' }],
        listFailed: () => false,
    };
    const props = {
        useSessions: (select) => select(sessions), useSessionStatus: (select) => select(new Map()), useWorkspaces: (select) => select(workspaces),
        projects: { facts, openSession: () => {} },
    };
    const draw = mount(react, () => ProjectsPage(props));
    const find = (page) => elementsOf(page).find((e) => e.props?.['data-projects-find'] !== undefined);
    const treeOf = (page) => elementsOf(page).find((e) => e.type === PageTree);
    const titles = (tree) => elementsOf(tree).filter((e) => e.props?.role === 'treeitem').map((li) => textIn(byClass(li.children[0], 'dshp-tree-title')));
    let page = draw();
    const clear = (tree) => elementsOf(tree).find((e) => e.props?.['data-projects-find-clear'] !== undefined);
    assert.deepEqual([find(page).props['aria-label'], find(page).props.role, find(page).props.value, clear(page)], ['Find by name', 'searchbox', '', undefined]);
    assert.equal(treeOf(page).props.find, '');
    const whole = treeOf(page).props.tree;
    // A thread's name: its project stays around it, and nothing else; the project still counts all its threads.
    find(page).props.onChange({ target: { value: 'cart' } });
    page = draw();
    let tree = mount(react, () => PageTree(treeOf(page).props))();
    assert.deepEqual(titles(tree), ['Storefront', 'Fix the cart']);
    assert.equal(textIn(byClass(elementsOf(tree).find((e) => e.props?.['data-projects-node'] === 'project').children[0], 'dshp-tree-meta')), 'storefront · 2 open threads · 1 resolved');
    // The words are marked in the title, which keeps its whole name for the review's hooks.
    const hit = elementsOf(tree).find((e) => e.type === 'mark');
    assert.deepEqual([textIn(hit), hit.props.className], ['cart', 'dshp-tree-hit']);
    assert.deepEqual(plain(withHit('Fix the cart', 'CART').map((part) => (typeof part === 'string' ? part : `[${textIn(part)}]`))), ['Fix the ', '[cart]']);
    assert.deepEqual(plain(withHit('Fix', 'zz')), ['Fix']);
    // A project's name keeps the whole project; any case matches; a thread's name keeps only it under its project.
    assert.deepEqual(plain(findInTree(whole, 'FLEET').map((n) => [n.title, n.children.map((t) => t.title)])), [
        ['Storefront', ['Fleet power budget']],
        ['Fleet Ops', ['Lane restarts']],
    ]);
    // Closing a project while finding is the find's own: the page's kept folds don't change, and a new find starts open.
    find(page).props.onChange({ target: { value: 'storefront' } });
    let treeProps = treeOf(draw()).props;
    const drawTree = mount(react, () => PageTree(treeProps));
    const project = (t) => elementsOf(t).find((e) => e.props?.['data-projects-node'] === 'project');
    const fold = (t) => elementsOf(project(t).children[0]).find((e) => e.props?.['data-projects-chevron'] !== undefined).props.onClick({ stopPropagation: () => {} });
    fold(drawTree());
    assert.equal(project(drawTree()).props['aria-expanded'], false);
    find(page).props.onChange({ target: { value: 'store' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], true);
    find(page).props.onChange({ target: { value: '' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], true);
    // Without a find, a fold is the page's own again.
    fold(drawTree());
    assert.equal(project(drawTree()).props['aria-expanded'], false);
    find(page).props.onChange({ target: { value: 'storefront' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], true);
    find(page).props.onChange({ target: { value: '' } });
    treeProps = treeOf(draw()).props;
    assert.equal(project(drawTree()).props['aria-expanded'], false);
    fold(drawTree());
    // Nothing found: said in words, and Escape empties the box.
    find(page).props.onChange({ target: { value: 'zzz' } });
    page = draw();
    assert.equal(treeOf(page), undefined);
    const none = elementsOf(page).find((e) => e.props?.['data-projects-find-none'] !== undefined);
    assert.deepEqual([none.props.role, textIn(none)], ['status', 'Nothing matches “zzz”.']);
    // Its × empties the box too.
    assert.equal(clear(page).props['aria-label'], 'Clear the find');
    clear(page).props.onClick();
    assert.equal(find(draw()).props.value, '');
    find(page).props.onChange({ target: { value: 'zzz' } });
    page = draw();
    let prevented = 0;
    find(page).props.onKeyDown({ key: 'Escape', preventDefault: () => { prevented += 1; }, stopPropagation: () => {} });
    page = draw();
    assert.deepEqual([find(page).props.value, prevented, titles(mount(react, () => PageTree(treeOf(page).props))()).length], ['', 1, 6]);
});

test('browser half: a session DSH lists without the plugin\'s value is placed by what the plugin\'s store knows, not by its title', async () => {
    const { client } = loadClient();
    const { rowPlace, isThreadRow, coordinatorName, takeKnown, projectFacts } = client.internals;
    // DSH dropped the saved values of an older version: the threads' titles say nothing of their project.
    const state = { byId: { c: { id: 'c', title: '◆ DSH Plugins' }, t: { id: 't', title: 'Smoke test' }, x: { id: 'x', title: 'A chat' }, n: { id: 'n', title: 'Nameless' } } };
    assert.deepEqual(['c', 't', 'x'].map((id) => rowPlace(state, id)), ['coordinator:c', '', '']);
    // The plugin's store: c and its thread t; n a coordinator retitled by the user.
    const link = { calls: 0, async call(method) { this.calls += 1; assert.equal(method, 'sessions'); return { ok: true, value: { sessions: {
        c: { role: 'coordinator', project: 'dsh-plugins', name: 'DSH Plugins' },
        t: { role: 'thread', project: 'dsh-plugins', name: 'DSH Plugins', thread: 't1', coordinator: 'c' },
        n: { role: 'coordinator', project: 'p', name: 'Pricing' },
        bad: { role: 'chat' },
    } } }; } };
    const facts = projectFacts(link);
    await facts.sessions();
    await facts.sessions();
    assert.equal(link.calls, 1, 'once per window');
    assert.deepEqual(['c', 't', 'x', 'n'].map((id) => rowPlace(state, id)), ['coordinator:c', 'thread:c', '', 'coordinator:n']);
    assert.deepEqual([isThreadRow(state, 't'), isThreadRow(state, 'x'), coordinatorName(state, 'n'), coordinatorName(state, 't')], [true, false, 'Pricing', undefined]);
    // DSH's own value wins once it has one.
    const folded = { ...state, projectionsBySession: { t: { values: { coordinatorSession: { role: 'thread', coordinator: 'c2', project: { id: 'q', name: 'Q' } } } } } };
    assert.equal(rowPlace(folded, 't'), 'thread:c2');
    takeKnown({});
    assert.equal(rowPlace(state, 't'), '');
});

test('browser half: the defaults form registers on the plugin page, read-only when the profile adds the row twice', () => {
    const { id, client } = loadClient();
    assert.equal(id, 'dsh-plugin-coordinator');
    // Each part waits for its own DSH services, so only the slots are required.
    assert.deepEqual([...client.inject], ['slots']);
    let snapshot = { status: 'ready', value: { coordinatorEffort: 'max' }, base: {}, user: { coordinatorEffort: 'max' }, writable: true, revision: 1 };
    const registered = [];
    const groups = [];
    const ctx = {
        effect: (fn) => fn(),
        // This DSH serves the settings services only; the threads part keeps waiting.
        inject: (names, fn) => { groups.push([...names]); if (names.includes('configForms')) fn(ctx); },
        configForms: {
            get: (ns) => (assert.equal(ns, 'coordinator'), { getSnapshot: () => snapshot, subscribe: () => () => {}, mutate: async () => true }),
            whileServed: (names, fn) => (assert.deepEqual([...names], ['coordinator']), fn()),
        },
        slots: {
            inject: (_name, fn) => fn(),
            register: (slot, component) => { registered.push({ slot, component }); return () => {}; },
        },
    };
    client.apply(ctx);
    // The shared services first (model catalog, connection, sessions), then the three parts.
    assert.deepEqual(groups, [['remote', 'remote.session'], ['connection'], ['sessions'],
        ['configForms', 'remote', 'remote.session'], ['connection', 'remote', 'remote.session'], ['sessions', 'uiWorkspace', 'sidebarRight']]);
    assert.deepEqual(registered.map((r) => ({ ...r.slot })), [{ name: 'plugins.bundle.config', key: 'dsh-plugin-coordinator' }]);
    const page = registered[0].component;
    assert.match(page({ view: 'summary' }), /^Default models/);
    // The page: the Default models form, the Threads switch, then every project with what it runs.
    const [formPart, optionsPart, tablePart] = page({ view: 'page' }).children;
    assert.equal(optionsPart.type.name, 'ThreadOptions');
    assert.equal(tablePart.type.name, 'ProjectsTable');
    assert.deepEqual(Object.keys(tablePart.props).sort(), ['catalog', 'dialog', 'link', 'sessionsOf']);
    const form = formPart.props.form;
    assert.equal(form.getSnapshot().coordinatorEffort.text, 'max');
    assert.equal(form.getSnapshot().insertedTwice, false);
    // The older setup adds the row with insert: the value the plugin runs with comes from neither layer a save edits.
    snapshot = { ...snapshot, user: {} };
    assert.equal(form.getSnapshot().insertedTwice, true);
    snapshot = { ...snapshot, base: { coordinatorEffort: 'max' } };
    assert.equal(form.getSnapshot().insertedTwice, false);
    snapshot = { status: 'loading', value: undefined, base: undefined, user: undefined, writable: true, revision: undefined };
    assert.equal(form.getSnapshot().insertedTwice, false);
});

test('browser half: threads add a header menu, turn cards, sidebar marks and right-sidebar tabs', () => {
    const { client } = loadClient();
    const registered = [];
    const types = [];
    const protocols = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push({ ...slot }); return () => {}; } },
        resources: { register: (provider) => { protocols.push(provider.protocol); return () => {}; } },
        sidebarRightTabs: { register: (type) => { types.push(type); return () => {}; } },
        sessions: { list: { getSnapshot: () => ({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }), subscribe: () => () => {} } },
        uiWorkspace: {},
        sidebarRight: {},
    };
    client.apply(ctx);
    assert.deepEqual(registered.map((r) => [r.name, r.id ?? r.key ?? null, r.order ?? null]), [
        ['shell.overlay', 'dsh-plugin-coordinator/project-settings', null],
        ['sidebar.workspaces.session.menu.item', 'dsh-plugin-coordinator/project-settings-item', 250],
        ['shell.overlay', 'dsh-plugin-coordinator/archive', null],
        ['sidebar.workspaces.session.menu.item', 'dsh-plugin-coordinator/archive-item', 260],
        ['shell.overlay', 'dsh-plugin-coordinator/rename', null],
        ['conversation.session.header.actions', 'dsh-plugin-coordinator/threads-menu', -25],
        ['conversation.chat.turnTail', 'dsh-plugin-coordinator/thread-cards', 30],
        ['conversation.chat.node', 'turn-trigger', null],
        ['sidebar.session.row.leading', 'dsh-plugin-coordinator/thread-mark', 20],
        ['sidebar.workspaces.session.row.action', 'dsh-plugin-coordinator/row-place', 900],
        ['conversation.input.dock', 'dsh-plugin-coordinator/coordinator-offer', 14],
        ['conversation.input.dock', 'dsh-plugin-coordinator/paused-bar', 15],
        ['conversation.input.dock', 'dsh-plugin-coordinator/ending-bar', 16],
        ['sidebar.session.row.hover', 'dsh-plugin-coordinator/thread-hover', 20],
        ['sidebar.workspaces.session.menu.item', 'dsh-plugin-coordinator/full-view-item', 50],
        ['shell.overlay', 'dsh-plugin-coordinator/news-notice', null],
        ['shell.overlay', 'dsh-plugin-coordinator/session-list', null],
        ['main', 'dsh-plugin-coordinator/projects', null],
        ['sidebar.panellist', 'dsh-plugin-coordinator/projects', 5],
        ['sidebar.right.pane.tab', 'dsh-plugin-coordinator/thread-chat', null],
        ['sidebar.right.pane.tab.title', 'dsh-plugin-coordinator/thread-chat', null],
        ['projects.thread.conversation', null, null],
        ['sidebar.right.pane.tab', 'dsh-plugin-coordinator/threads-pane', null],
        ['sidebar.right.pane.tab', 'dsh-plugin-coordinator/thread-link', null],
        ['sidebar.right.pane.tab', 'dsh-plugin-coordinator/thread-changes', null],
        ['sidebar.right.pane.tab.title', 'dsh-plugin-coordinator/thread-changes', null],
    ]);
    // The thread chat tab hosts the conversation slot it renders.
    const chatTab = registered.find((r) => r.name === 'sidebar.right.pane.tab' && r.key === 'dsh-plugin-coordinator/thread-chat');
    assert.deepEqual(plain(chatTab.children), { 'projects.thread.conversation': { kind: 'single', scope: 'session' } });
    assert.deepEqual(protocols, ['projectthread']);
    assert.deepEqual(types.map((t) => [t.id, t.kind, t.patterns ? [...t.patterns] : null]), [
        ['dsh-plugin-coordinator/thread-chat', 'projectthread', ['dsh-resource://projectthread/session/**']],
        ['dsh-plugin-coordinator/threads-pane', 'projectthreads', null],
        ['dsh-plugin-coordinator/thread-link', 'projectthreadlink', ['dsh-resource://file/session/**/.dsh-thread/*', 'dsh-resource://file/session/*/.t*']],
        ['dsh-plugin-coordinator/thread-changes', 'projectchanges', ['dsh-resource://projectchanges/session/**']],
    ]);
    const [chat, pane, link, changes] = types;
    assert.equal(chat.canOpen('dsh-resource://projectthread/session/s%2F1'), true);
    assert.equal(chat.canOpen('dsh-resource://projectthread/other/s1'), false);
    assert.equal(chat.title('dsh-resource://projectthread/session/s1'), 'Thread');
    assert.equal(pane.title(), 'Threads');
    // `[title](.dsh-thread/t3)` in a reply opens the thread, not DSH's file viewer.
    assert.equal(link.canOpen('dsh-resource://file/session/s%2F1/.dsh-thread/t3'), true);
    assert.equal(link.canOpen('dsh-resource://file/session/s1/.dsh-thread/notes.md'), false);
    assert.equal(link.title('dsh-resource://file/session/s1/.dsh-thread/T12'), 'Thread t12');
    // So does the short `[title](.t3)`; a file whose name only starts with `.t` stays DSH's.
    assert.equal(link.canOpen('dsh-resource://file/session/s%2F1/.t3'), true);
    assert.equal(link.title('dsh-resource://file/session/s1/.t12'), 'Thread t12');
    for (const name of ['.tmp', '.tool-versions', '.t', '.t3x', '.t3.md', '.T3', 'docs/.t3']) {
        assert.equal(link.canOpen(`dsh-resource://file/session/s1/${name}`), false, name);
    }
    assert.equal(link.priority, undefined, 'the extension band ranks above the builtin file viewer');
    // A thread's Changes tab, addressed by its session.
    assert.equal(changes.canOpen('dsh-resource://projectchanges/session/s%2F1'), true);
    assert.equal(changes.canOpen('dsh-resource://projectchanges/session/'), false);
    assert.equal(changes.canOpen('dsh-resource://projectthread/session/s1'), false);
    assert.equal(changes.title('dsh-resource://projectchanges/session/s1'), 'Changes · Thread');
});

test('browser half: Project settings opens per session, calls the plugin\'s endpoints and reads models as DSH does', async () => {
    const { client } = loadClient();
    const { settingsDialog, hostLink, errorText, noteText, catalogView, resolveRoute, effortNote, liveNote } = client.internals;
    // The dialog opens only once its part is running, and closes when that part stops.
    const dialog = settingsDialog();
    let changes = 0;
    dialog.subscribe(() => { changes += 1; });
    dialog.open('s1');
    assert.equal(dialog.getSnapshot().target, null);
    const disconnect = dialog.connect();
    dialog.open('s1');
    assert.deepEqual(plain(dialog.getSnapshot()), { target: 's1', seq: 1, available: true, pick: null });
    dialog.open('s1', { pick: 'thread' });
    assert.deepEqual(plain(dialog.getSnapshot()), { target: 's1', seq: 2, available: true, pick: 'thread' }, 'opening again starts fresh, here with the New threads menu open');
    dialog.open('s1', { pick: 'nope' });
    assert.equal(dialog.getSnapshot().pick, null);
    dialog.close();
    dialog.open('');
    assert.equal(dialog.getSnapshot().target, null);
    disconnect();
    assert.deepEqual(plain(dialog.getSnapshot()), { target: null, seq: 3, available: false, pick: null });
    assert.equal(changes, 6);

    // Calls go over the window's connection to /api/dsh-plugin-coordinator/<method>.
    const sent = [];
    let reply = { ok: true, value: { project: { id: 'p' } } };
    const link = hostLink(() => ({ rpc: { call: async (channel, endpoint, payload) => { sent.push([channel, endpoint, payload]); if (reply instanceof Error) throw reply; return reply; } } }));
    assert.deepEqual(plain(await link.call('describe', { target: 's1' })), { ok: true, value: { project: { id: 'p' } } });
    assert.deepEqual(plain(sent), [['/api', 'dsh-plugin-coordinator/describe', { args: { target: 's1' } }]]);
    reply = { ok: false, error: { code: 'coordinator/refused', message: 'effort "ultra" is not offered by a:b. Choose one of: off, high' } };
    const refused = await link.call('update', { target: 's1', changes: {} });
    assert.equal(errorText(refused.error), 'Effort "ultra" is not offered by a:b. Choose one of: off, high.');
    reply = new Error('transport failure for /api/dsh-plugin-coordinator/update: HTTP 404');
    assert.match(errorText((await link.call('update', {})).error), /didn't answer\. If it was just updated, restart DSH/);
    reply = 'garbage';
    assert.equal((await link.call('describe', {})).error.code, 'projects/unreadable');
    // Before DSH has given the window its connection, a call says the plugin can't be reached.
    const early = await hostLink(() => undefined).call('list', {});
    assert.equal(early.error.code, 'projects/unreachable');
    assert.match(errorText(early.error), /didn't answer/);

    // Only the notes that change what the user sees are shown.
    // Efforts a model can't use show on the row, so the notes about them are not repeated.
    assert.equal(noteText(['Threads: other:big has no effort levels, so effort "high" is not used.']), '');
    assert.equal(noteText(['t1: route a:b · effort high from the next request.']), '');
    assert.equal(noteText(['t1: route a:b · effort default from the next request; but the model could not be set, so it keeps its current one (details in the projects log).']),
        'The model could not be set, so it keeps its current one (details in the projects log).');

    // What a setting runs on, named as DSH's picker names it.
    const catalog = {
        default: { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' },
        groups: [
            { id: 'other', name: 'Other', models: [{ id: 'big-model', name: 'Big' }] },
            { id: 'deepseek-account', name: 'DeepSeek', models: [
                { id: 'deepseek-v4', name: 'V4', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' } },
                { id: 'deepseek-v4-flash', name: 'V4 Flash', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } },
            ] },
        ],
    };
    const cv = catalogView(catalog);
    assert.deepEqual(plain(cv.groups.map((g) => g.provider)), ['deepseek-account', 'other'], 'DSH\'s own account comes first');
    const shown = (model, effort, view = cv) => { const r = resolveRoute(view, model, effort); return [r.name, r.effortName ?? null]; };
    assert.deepEqual(shown(undefined, undefined), ['V4', 'Low'], 'nothing set: the DSH default selection');
    assert.deepEqual(shown('deepseek-account:deepseek-v4', undefined), ['V4', 'Max'], 'a model set: its own default effort');
    assert.deepEqual(shown('deepseek-v4', 'low'), ['V4', 'Low']);
    assert.deepEqual(shown('other:big-model', 'max'), ['Big', null], 'a model without efforts shows none');
    assert.deepEqual(shown('deepseek-account:deepseek-v4-flash', undefined), ['V4 Flash', 'Default'], 'a model without a default effort: the provider\'s');
    assert.deepEqual(shown('deepseek:deepseek-v4-pro', 'max', catalogView(undefined)), ['deepseek-v4-pro', 'max'], 'before the catalog arrives, the stored values');
    assert.equal(noteText(['Threads: deepseek:deepseek-v4-flash doesn\'t offer effort "max", so it runs at "high".']), '');

    // An effort the model lacks shows what runs, as the plugin fits it, and says why.
    const note = (model, effort) => effortNote(cv, resolveRoute(cv, model, effort)) ?? null;
    assert.deepEqual(shown('deepseek-account:deepseek-v4-flash', 'max'), ['V4 Flash', 'Off'], 'max on a model with only off runs at off');
    assert.equal(note('deepseek-account:deepseek-v4-flash', 'max'), 'V4 Flash doesn\'t offer Max, so it runs at Off.');
    assert.equal(note('other:big-model', 'low'), 'Big has no effort levels, so Low isn\'t used.');
    assert.equal(effortNote(cv, resolveRoute(cv, 'other:big-model', 'low'), false) ?? null, null, 'an inherited effort on a model without levels goes unsaid');
    assert.match(effortNote(cv, resolveRoute(cv, 'deepseek-account:deepseek-v4-flash', 'max'), false), /runs at Off/, 'a fitted one is said even when inherited');
    assert.equal(note('deepseek-account:deepseek-v4', 'low'), null);
    assert.equal(note('other:big-model', undefined), null);
    assert.deepEqual(shown('deepseek-account:deepseek-v4', 'medium'), ['V4', 'Max'], 'an effort no model offers runs at the model\'s default');
    // What a loaded session really runs, when it differs from its setting.
    const live = (model, effort, running) => liveNote(cv, resolveRoute(cv, model, effort), running) ?? null;
    assert.equal(live(undefined, undefined, { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' }), null);
    assert.equal(live(undefined, undefined, { provider: 'deepseek-account', model: 'deepseek-v4-flash', reasoningEffort: 'off' }), 'It runs on V4 Flash · Off right now.');
    assert.equal(live('deepseek-account:deepseek-v4', 'max', { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' }), 'It runs on V4 · Low right now.');
    assert.equal(live('deepseek-account:deepseek-v4', 'max', null), null);
    assert.equal(live('other:big-model', undefined, { provider: 'other', model: 'big-model' }), null);
});

test('browser half: the goal in Project settings is saved with Save, put back with Escape, and says which of the user\'s tools it opens', async () => {
    const { client, react } = loadClient();
    const { GoalRow } = client.internals;
    const saves = [];
    let accept = true;
    let goal = { value: 'Ship good DSH plugins', source: 'project config', inherited: 'Ship good DSH plugins', tools: [], max: 2000 };
    const draw = mount(react, () => GoalRow({ goal, busy: false, message: null, onSave: async (changes) => { saves.push(changes); return accept; } }));
    const hook = (row, name) => elementsOf(row).find((e) => e.props?.[name] !== undefined);
    const box = (row) => hook(row, 'data-projects-goal');
    const key = (row, k, mods = {}) => {
        const seen = { prevented: false, stopped: false };
        box(row).props.onKeyDown({ key: k, ...mods, preventDefault: () => { seen.prevented = true; }, stopPropagation: () => { seen.stopped = true; } });
        return seen;
    };
    let row = draw();
    // From the profile: its text in the box, where it comes from, and nothing to save.
    assert.deepEqual(plain([box(row).props.value, box(row).props.maxLength, textIn(byClass(row, 'dshp-ps-source')), hook(row, 'data-projects-goal-save') ?? null]),
        ['Ship good DSH plugins', 2000, 'From your profile', null]);
    assert.equal(textIn(byClass(row, 'dshp-ps-title')), 'Goal');
    // Typing shows Save and Cancel; the same text again, spaces aside, has nothing to save.
    box(row).props.onChange({ target: { value: 'Keep the storefront fast. ' } });
    row = draw();
    assert.deepEqual([textIn(hook(row, 'data-projects-goal-save')), textIn(byClass(row, 'dshp-ps-goal-actions'))], ['Save', 'CancelSave']);
    box(row).props.onChange({ target: { value: 'Ship good DSH plugins  ' } });
    assert.equal(hook(draw(), 'data-projects-goal-save'), undefined);
    // Escape while it is changed puts the text back, and the dialog stays open; with nothing changed, Escape is the dialog's.
    box(row).props.onChange({ target: { value: 'Keep the storefront fast.' } });
    assert.deepEqual(key(draw(), 'Escape'), { prevented: true, stopped: true });
    row = draw();
    assert.deepEqual([box(row).props.value, hook(row, 'data-projects-goal-save') ?? null], ['Ship good DSH plugins', null]);
    assert.deepEqual(key(row, 'Escape'), { prevented: false, stopped: false });
    // Enter alone is a new line; Save, or Ctrl+Enter, sends the text, and once the plugin takes it the box shows what it holds.
    box(row).props.onChange({ target: { value: 'Keep the storefront fast.' } });
    assert.deepEqual(key(draw(), 'Enter'), { prevented: false, stopped: false });
    hook(draw(), 'data-projects-goal-save').props.onClick();
    await tick();
    assert.deepEqual(plain(saves), [{ goal: 'Keep the storefront fast.' }]);
    goal = { ...goal, value: 'Keep the storefront fast.', source: 'project setting', tools: [] };
    row = draw();
    assert.deepEqual([box(row).props.value, hook(row, 'data-projects-goal-save') ?? null, textIn(byClass(row, 'dshp-ps-source'))],
        ['Keep the storefront fast.', null, 'Set for this projectUse your profile\'s']);
    // A refused save keeps what was typed.
    accept = false;
    box(row).props.onChange({ target: { value: 'x'.repeat(10) } });
    assert.deepEqual(key(draw(), 'Enter', { ctrlKey: true }), { prevented: true, stopped: false });
    await tick();
    assert.deepEqual([plain(saves.at(-1)), box(draw()).props.value], [{ goal: 'xxxxxxxxxx' }, 'xxxxxxxxxx']);
    // "Use your profile's" gives the profile row's goal back.
    accept = true;
    hook(draw(), 'data-projects-goal-reset').props.onClick();
    await tick();
    assert.deepEqual(plain(saves.at(-1)), { goal: null });
    goal = { ...goal, value: 'Ship good DSH plugins', source: 'project config' };
    assert.equal(box(draw()).props.value, 'Ship good DSH plugins');
    // The user's tools a goal names are open to every thread, so the row names them.
    goal = { ...goal, value: 'Keep the obsidian inbox tidy', source: 'project setting', tools: ['obsidian'] };
    assert.equal(textIn(hook(draw(), 'data-projects-goal-tools')), 'It names obsidian, so every thread in this project can use it.');
    goal = { ...goal, tools: ['obsidian', 'dsh_vault'] };
    assert.equal(textIn(hook(draw(), 'data-projects-goal-tools')), 'It names obsidian and dsh_vault, so every thread in this project can use them.');
    // A project made in the window has no profile goal: an empty box, its placeholder, and no source line.
    goal = { value: '', source: 'none', inherited: '', tools: [], max: 2000 };
    row = draw();
    assert.deepEqual([box(row).props.value, box(row).props.placeholder, byClass(row, 'dshp-ps-source').length], ['', 'What this project is for', 0]);
});

test('browser half: rows, cards and the plugin page name what each session runs on, as DSH\'s model menu does', () => {
    const { client } = loadClient();
    const { selectionIn, selectionText, summaryModels, sourceLine, toldText, catalogView } = client.internals;
    const cv = catalogView({
        default: { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' },
        groups: [
            { id: 'other', name: 'Other', models: [{ id: 'big-model', name: 'Big' }] },
            { id: 'deepseek-account', name: 'DeepSeek', models: [
                { id: 'deepseek-v4', name: 'V4', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'max', name: 'Max' }], defaultEffort: 'max' } },
                { id: 'deepseek-v4-flash', name: 'V4 Flash', reasoning: { efforts: [{ id: 'off', name: 'Off' }] } },
            ] },
        ],
    });
    // DSH's own modelSelection projection: the next request's selection, else the last one used.
    const picked = { provider: 'deepseek-account', model: 'deepseek-v4', reasoningEffort: 'low' };
    const state = {
        byId: { a: { projectionValues: { modelSelection: { lastUsed: { provider: 'other', model: 'big-model' }, next: picked } } } },
        projectionsBySession: {
            b: { values: { modelSelection: { lastUsed: { provider: 'other', model: 'big-model' }, next: null } } },
            c: { values: { modelSelection: { lastUsed: null, next: null } } },
        },
    };
    assert.deepEqual(plain(selectionIn(state, 'a')), picked);
    assert.deepEqual(plain(selectionIn(state, 'b')), { provider: 'other', model: 'big-model' });
    assert.equal(selectionIn(state, 'c'), undefined);
    assert.equal(selectionIn(state, 'nope'), undefined);
    // Named as DSH's composer names them.
    assert.equal(selectionText(cv, picked), 'V4 · Low');
    assert.equal(selectionText(cv, { provider: 'deepseek-account', model: 'deepseek-v4' }), 'V4 · Max', 'no effort: the model\'s default');
    assert.equal(selectionText(cv, { provider: 'deepseek-account', model: 'deepseek-v4-flash' }), 'V4 Flash · Default', 'no default either: the provider\'s');
    assert.equal(selectionText(cv, { provider: 'other', model: 'big-model', reasoningEffort: 'high' }), 'Big', 'a model without levels shows none');
    assert.equal(selectionText(catalogView(undefined), { provider: 'x', model: 'm1', reasoningEffort: 'high' }), 'm1 · High', 'before the catalog arrives');
    assert.equal(selectionText(cv, undefined), undefined);
    // The menu's summary: what the coordinator runs on now, else its setting; what new threads start on.
    const info = { settings: {
        coordinatorModel: { value: null, source: 'DSH default' }, coordinatorEffort: { value: 'max', source: 'project config' },
        threadModel: { value: 'other:big-model', source: 'project setting' }, threadEffort: { value: 'high', source: 'plugin default' },
    } };
    assert.deepEqual(plain(summaryModels(cv, {}, 'c1', info)), { coordinator: 'V4 · Max', thread: 'Big' });
    assert.deepEqual(plain(summaryModels(cv, { c1: 'V4 Flash · Off' }, 'c1', info)), { coordinator: 'V4 Flash · Off', thread: 'Big' });
    assert.deepEqual(plain(summaryModels(cv, {}, 'c1', null)), {});
    // Where a project's setting comes from, on the plugin page.
    assert.equal(sourceLine({ value: 'a:b', source: 'project setting' }, { value: 'max', source: 'project setting' }), 'Set for this project');
    assert.equal(sourceLine({ value: 'a:b', source: 'plugin default' }, { value: 'max', source: 'project config' }), 'Model from Default models · effort from your profile');
    assert.equal(sourceLine({ value: null, source: 'DSH default' }, { value: 'max', source: 'plugin default' }), 'Model follows DSH · effort from Default models');
    assert.equal(sourceLine({ value: null, source: 'DSH default' }, { value: null, source: 'DSH default' }), 'Follows DSH\'s default model');
    assert.equal(sourceLine({ value: null, source: 'DSH default' }, { value: null, source: 'DSH default' }, { long: true }), 'Follows DSH\'s default model, the one last picked in any DSH chat');
    assert.equal(sourceLine({ value: 'a:b', source: 'project setting' }, { value: null, source: 'DSH default' }), 'Set for this project', 'an effort set nowhere is the model\'s own');
    // A handback that starts with its own state doesn't say it twice.
    assert.equal(toldText({ status: 'blocked', summary: 'Blocked: the token expired.' }), 'Blocked: the token expired.');
    assert.equal(toldText({ status: 'done', summary: 'done.' }), 'done.');
    assert.equal(toldText({ status: 'done', summary: 'Doneness checks pass.' }), 'Done · Doneness checks pass.');
    assert.equal(toldText({ status: 'needs_decision', summary: 'Pick A or B.' }), 'Needs your decision · Pick A or B.');
    assert.equal(toldText({ status: 'progress' }), 'Progress update');
});

test('browser half: New threads follows DSH\'s default after a pick in any chat; a row names a model the menu already names only on hover', async () => {
    const { client } = loadClient();
    const { catalogSource, picksIn, followDefault, ThreadRow } = client.internals;
    // DSH saves a composer pick as its default in the background, so the catalog is read again.
    let def = { provider: 'p', model: 'old' };
    let reads = 0;
    let answer;
    const remote = { session: { modelCatalog: () => { reads += 1; return new Promise((resolve) => { answer = () => resolve({ ok: true, value: { default: def, groups: [] } }); }); } } };
    const catalog = catalogSource(() => remote);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    catalog.ensure();
    await tick();
    assert.equal(reads, 1);
    // A reload asked for mid-read waits for that read, then reads once more.
    catalog.reload();
    catalog.reload();
    await tick();
    assert.equal(reads, 1);
    def = { provider: 'p', model: 'new' };
    answer();
    await tick();
    assert.equal(reads, 2);
    assert.equal(catalog.getSnapshot().status, 'loading');
    answer();
    await tick();
    assert.deepEqual(plain([catalog.getSnapshot().status, catalog.getSnapshot().value.default.model, reads]), ['ready', 'new', 2]);

    // Picks per loaded session; one DSH has not sent is left out.
    const pick = (model, effort) => ({ lastUsed: null, next: { provider: 'p', model, ...(effort ? { reasoningEffort: effort } : {}) } });
    let state = {
        byId: { a: {}, b: {}, cold: {} },
        projectionsBySession: { a: { values: { modelSelection: pick('m1', 'high') } }, b: { values: { modelSelection: { lastUsed: null, next: null } } } },
    };
    assert.deepEqual(plain([...picksIn(state)]), [['a', 'p:m1:high'], ['b', '']]);
    const listeners = new Set();
    const sessions = { list: { getSnapshot: () => state, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } };
    const frames = [];
    const timers = [];
    const fake = { reloads: 0, status: 'idle', value: { default: { provider: 'p', model: 'm1', reasoningEffort: 'high' } } };
    const watched = { reload: () => { fake.reloads += 1; }, getSnapshot: () => ({ status: fake.status, value: fake.value }) };
    const stop = followDefault(sessions, watched, {
        frame: (fn) => frames.push(fn), cancel: () => {}, later: (fn, ms) => (timers.push({ fn, ms }), timers.length), clear: () => {},
    });
    const emit = (next) => { state = next; for (const fn of listeners) fn(); while (frames.length) frames.shift()(); };
    // While nothing has read the catalog, a pick leaves it for the first view that needs it.
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: pick('m1', 'max') } } } });
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: pick('m1', 'high') } } } });
    assert.deepEqual([fake.reloads, timers.length], [0, 0]);
    fake.status = 'ready';
    // A session DSH sends for the first time is not a pick.
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, cold: { values: { modelSelection: pick('m9') } } } });
    assert.equal(fake.reloads, 0);
    // A pick in a session that had none (a new chat), then a changed pick: each reads the catalog again.
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, b: { values: { modelSelection: pick('m2') } } } });
    assert.equal(fake.reloads, 1);
    // The save had not landed by the first read: more reads a moment later, while the catalog names another default.
    assert.deepEqual(timers.map((x) => x.ms), [300]);
    timers.at(-1).fn();
    assert.deepEqual([fake.reloads, ...timers.map((x) => x.ms)], [2, 300, 700]);
    timers.at(-1).fn();
    timers.at(-1).fn();
    assert.deepEqual([fake.reloads, ...timers.map((x) => x.ms)], [4, 300, 700, 1500], 'at most three more reads');
    // A changed effort is a pick too; once a read names it, no more reads.
    timers.length = 0;
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: pick('m1', 'low') } } } });
    assert.equal(fake.reloads, 5);
    fake.value = { default: { provider: 'p', model: 'm1', reasoningEffort: 'low' } };
    timers.at(-1).fn();
    assert.deepEqual([fake.reloads, timers.length], [5, 1]);
    // Changes that are not picks: a turn using the pick, an unrelated session update.
    emit({ ...state, byId: { ...state.byId, a: { title: 'renamed' } } });
    emit({ ...state, projectionsBySession: { ...state.projectionsBySession, a: { values: { modelSelection: { lastUsed: pick('m1', 'low').next, next: pick('m1', 'low').next } } } } });
    assert.equal(fake.reloads, 5);
    stop();
    assert.equal(listeners.size, 0);

    // The menu names New threads' model at its top, so a row on the same model names it in a tooltip only.
    const row = { id: 't1', title: 'Fix login', line: 'Running', dot: 'ongoing', session: 's1' };
    const bodyOf = (el) => (el.props.className === 'dshp-t-row' ? el : el.children[0]);
    const mainOf = (el) => bodyOf(el).children.find((c) => c?.props?.className === 'dshp-t-main');
    const meta = (props) => {
        const text = mainOf(ThreadRow({ row, now: 0, onOpen() {}, ...props })).children.find((c) => c?.props?.className === 'dshp-t-text');
        const second = text.children.find((c) => c?.props?.className === 'dshp-t-second');
        return second.children.find((c) => c?.props?.className === 'dshp-t-meta');
    };
    const modelOf = (props) => meta(props).children.find((c) => c?.props?.className === 'dshp-t-model');
    const quiet = ThreadRow({ row, now: 0, model: 'V4 · High', quietModel: 'V4 · High', onOpen() {} });
    assert.deepEqual(plain([quiet.props.label, quiet.props.delayMs > 0, bodyOf(quiet).props['data-projects-runs-on'], mainOf(quiet).props['aria-label']]),
        ['Runs on V4 · High', true, 'V4 · High', 'Fix login. Running. Runs on V4 · High']);
    assert.equal(modelOf({ model: 'V4 · High', quietModel: 'V4 · High' }), undefined);
    assert.equal(modelOf({ model: 'V4 · Low', quietModel: 'V4 · High' }).children[0], 'V4 · Low');
    assert.equal(ThreadRow({ row, now: 0, model: 'V4 · Low', quietModel: 'V4 · High', onOpen() {} }).props.className, 'dshp-t-row', 'no tooltip when the row shows its model');
    assert.equal(modelOf({}), undefined);
    // The code changes sit on the second line with the model and the time, not beside the name.
    const counted = meta({ changes: { added: 18, deleted: 3, files: 2 }, model: 'V4 · Low' }).children.filter(Boolean).map((c) => c.props.className);
    assert.deepEqual(counted, ['dshp-t-row-changes', 'dshp-t-model']);

    // No control sits inside another: the row's open button holds its text, and Retry and its ⋯ are the button's siblings.
    const opened = [];
    const action = { label: 'Open beside', icon: () => null, run() {} };
    const failed = ThreadRow({ row: { ...row, ending: { state: 'failed' } }, now: 0, onOpen: (r) => opened.push(r.id), action, projects: {}, slots: 2 });
    const main = mainOf(failed);
    const acts = bodyOf(failed).children.find((c) => c?.props?.className === 'dshp-t-row-acts');
    assert.equal(main.type, 'button');
    assert.equal(bodyOf(failed).props.role, undefined, 'the row itself is no button');
    assert.deepEqual(elementsOf(main.children).filter((e) => e.type === 'button' || e.props?.['aria-label'] !== undefined), [], 'nothing pressable inside the open button');
    assert.equal(acts.children.length, 2, 'Retry and the ⋯ sit beside the open button');
    assert.deepEqual(plain([main.props['data-dshp-item'], main.props.tabIndex, bodyOf(failed).props['data-acts'], bodyOf(failed).props.style]), ['', 0, '', { '--dshp-t-acts': '56px' }]);
    main.props.onClick();
    assert.deepEqual(opened, ['t1']);
    // The current chat's row: read out as current, left out of arrow keys, and opening it does nothing.
    const here = mainOf(ThreadRow({ row, current: true, now: 0, onOpen: (r) => opened.push(r.id) }));
    assert.deepEqual(plain([here.props['aria-current'], here.props['aria-disabled'], here.props.tabIndex]), ['true', 'true', -1]);
    here.props.onClick();
    assert.deepEqual(opened, ['t1']);
    // Focusing the row itself focuses its open button.
    let focused = '';
    const rowEl = { firstElementChild: { focus: () => { focused = 'main'; } } };
    bodyOf(failed).props.onFocus({ target: rowEl, currentTarget: rowEl });
    assert.equal(focused, 'main');
});

test('browser half: a thread row\'s ⋯ holds the other way to open it, its changes, Stop, and Mark resolved or Reopen', async () => {
    const { client, react } = loadClient();
    const { ThreadRow, ThreadMore, ThreadList, threadMenuItems, rowMenuItems, runThreadItem, inMoreList } = client.internals;
    const row = { id: 't1', title: 'Fix login', line: 'Done · Fixed it', dot: 'done', session: 's1', group: 'done', running: false };
    const did = [];
    const facts = { change: async (target, changes) => { did.push(['change', target, plain(changes)]); return { ok: true, value: {} }; } };
    const projects = { facts, hasChanges: () => true, openChanges: (id) => did.push(['changes', id]) };
    const action = { label: 'Open in full view', icon: 'IconRightUpOutlineRegular', run: (r) => did.push(['full', r.session]) };
    const changes = { added: 18, deleted: 3, files: 2, turns: 2, reviewable: true, last: { seq: 9, turn: 2 } };
    const ids = (items) => plain(items.map((item) => item.id));
    // A finished thread: the other way to open it, its changes, Mark resolved.
    assert.deepEqual(plain(rowMenuItems({ row, action, changes, projects }).map((i) => [i.id, i.label])),
        [['open', 'Open in full view'], ['changes', 'See what this thread changed'], ['resolve', 'Mark resolved']]);
    // Running, with no changes yet: Stop instead, and no changes to see.
    assert.deepEqual(ids(rowMenuItems({ row: { ...row, running: true, group: 'running' }, action, projects })), ['open', 'stop']);
    // Resolved: Reopen. The chat you're in has no other way to open it.
    assert.deepEqual(ids(rowMenuItems({ row: { ...row, group: 'resolved' }, current: true, action, projects })), ['reopen']);
    // A DSH without the Changes tab offers DSH's Review, as the cards do; without the plugin to change it, only the ways to open it.
    assert.deepEqual(plain(rowMenuItems({ row, action, changes, projects: { hasChanges: () => false, openReview() {} } }).map((i) => i.label)), ['Open in full view', 'Review the latest changes']);
    // A thread with no session yet has no ⋯; the Projects page's (threadMenuItems alone) has Stop while it runs.
    assert.deepEqual(plain(rowMenuItems({ row: { ...row, session: undefined }, action, changes, projects })), []);
    assert.deepEqual(ids(threadMenuItems({ thread: { running: true, resolved: false }, live: true })), ['stop']);
    assert.deepEqual(ids(threadMenuItems({ thread: { running: false, resolved: false }, live: false })), []);

    // The row: its ⋯ sits at its end, and a right-click on the row or Shift+F10 on its button opens it.
    const draw = mount(react, () => ThreadRow({ row, now: 0, onOpen() {}, action, changes, projects, onLeave: () => did.push(['leave']) }));
    const moreOf = (el) => el.children.find((c) => c?.props?.className === 'dshp-t-row-acts').children.find((c) => c?.type === ThreadMore);
    let el = draw();
    assert.deepEqual([ids(moreOf(el).props.items), moreOf(el).props.open, el.children[0].props['aria-keyshortcuts']], [['open', 'changes', 'resolve'], false, 'Shift+F10']);
    const event = (extra = {}) => ({ preventDefault() {}, stopPropagation() {}, ...extra });
    el.props.onContextMenu(event());
    el = draw();
    assert.equal(moreOf(el).props.open, true);
    moreOf(el).props.setOpen(false);
    el = draw();
    el.children[0].props.onKeyDown(event({ key: 'F10' }));
    assert.equal(moreOf(draw()).props.open, false, 'F10 alone is DSH\'s');
    el.children[0].props.onKeyDown(event({ key: 'ContextMenu' }));
    assert.equal(moreOf(draw()).props.open, true);
    // Its items: the other way to open it, its Changes tab (the list closes first), and the change through the plugin.
    await moreOf(el).props.run('open');
    await moreOf(el).props.run('changes');
    assert.equal(await moreOf(el).props.run('resolve'), '');
    assert.deepEqual(did, [['full', 's1'], ['leave'], ['changes', 's1'], ['change', 's1', { thread: 't1', resolved: true }]]);

    // What each change sends, and the plugin's refusal or a failure as a sentence.
    did.length = 0;
    await runThreadItem('stop', { target: 'c', thread: 't2', facts });
    await runThreadItem('reopen', { target: 'c', thread: 't2', facts });
    assert.deepEqual(did, [['change', 'c', { thread: 't2', stop: true }], ['change', 'c', { thread: 't2', resolved: false }]]);
    const refusing = { change: async () => ({ ok: false, error: { code: 'coordinator/refused', message: 'the turn could not be stopped (busy)' } }) };
    assert.equal(await runThreadItem('stop', { target: 'c', thread: 't2', facts: refusing }), 'The turn could not be stopped (busy).');
    assert.equal(await runThreadItem('stop', { target: 'c', thread: 't2', facts: { change: async () => { throw new Error('gone'); } } }), 'Couldn\'t change the thread.');

    // The ⋯ itself: named for its thread, and a refusal shows on it as Retry's does.
    const drawMore = mount(react, () => ThreadMore({ title: 'Fix login', items: [{ id: 'stop', label: 'Stop' }], run: async () => 'The turn could not be stopped (busy).', open: false, setOpen() {} }));
    let menu = drawMore();
    assert.deepEqual(plain([menu.props.anchor.props['aria-label'], menu.props.anchor.props['data-projects-row-menu'], menu.props.anchor.props['aria-haspopup'], /^dshp-t-more-list dshp-menu-\d+$/.test(menu.props.listClassName), menu.props.autoFocus === true]),
        ['Thread actions: Fix login', '', 'menu', true, false]);
    // Its keys reach DSH's menu: nothing on the ⋯ stops them on their way.
    assert.equal(menu.props.anchor.props.onKeyDown, undefined);
    menu.props.onSelect('stop');
    await tick();
    menu = drawMore();
    assert.deepEqual([menu.props.anchor.props.className, menu.props.anchor.props['aria-label']], ['dshp-t-icon dshp-t-error', 'Thread actions: Fix login. The turn could not be stopped (busy).']);

    // Its list is drawn in the page's body, and the Threads menu counts a click there as its own.
    const list = { nodeType: 1, closest: (sel) => (sel === '.dshp-t-more-list' ? {} : null) };
    assert.deepEqual([inMoreList(list), inMoreList({ nodeType: 3, parentElement: list }), inMoreList({ nodeType: 1, closest: () => null }), inMoreList(null)], [true, true, false, false]);

    // Every row with a session has its ⋯, so a list keeps one button's room for it, two with Retry.
    const room = (rows) => elementsOf(ThreadList({ rows, now: 0, onOpen() {}, action, projects })).find((e) => e.type === ThreadRow).props.slots;
    assert.equal(room([row]), 1);
    assert.equal(room([row, { ...row, id: 't2', session: 's2', group: 'waiting', ending: { state: 'failed' } }]), 2);
});

test('browser half: a thread\'s ⋯ has Rename…, which renames it through the plugin in a dialog, and Model and permission…, which opens Project settings at its row', async () => {
    const { client, react } = loadClient();
    const { ThreadRow, ThreadMore, rowMenuItems, threadMenuItems, runThreadItem, renameFlow, RenameThread, RenameOverlay, settingsDialog } = client.internals;
    const rename = renameFlow();
    const settings = settingsDialog();
    const row = { id: 't1', title: 'Fix login', line: 'Done · Fixed it', dot: 'done', session: 's1', group: 'done', running: false };
    const did = [];
    let answer = { ok: true, value: { notes: ['t1: renamed to "Sign-in fix".'] } };
    const facts = { change: async (target, changes) => { did.push(['change', target, plain(changes)]); return answer; } };
    const projects = { facts, rename, settings };
    const action = { label: 'Open in full view', icon: 'IconRightUpOutlineRegular', run: () => {} };
    const ids = (items) => plain(items.map((item) => item.id));
    // Neither shows until its dialog is drawn in this window.
    assert.deepEqual(ids(rowMenuItems({ row, action, projects })), ['open', 'resolve']);
    const offRename = rename.connect();
    const offSettings = settings.connect();
    // After the ways to open it, before Stop, Mark resolved or Reopen.
    assert.deepEqual(plain(rowMenuItems({ row, action, projects }).map((i) => [i.id, i.label, i.icon.type])), [
        ['open', 'Open in full view', 'IconRightUpOutlineRegular'], ['rename', 'Rename…', 'IconEditOutlineRegular'],
        ['thread-settings', 'Model and permission…', 'IconSlidersTwoOutlineRegular'], ['resolve', 'Mark resolved', 'IconCheckCircleOutlineRegular'],
    ]);
    assert.deepEqual(ids(rowMenuItems({ row: { ...row, running: true, group: 'running' }, action, projects })), ['open', 'rename', 'thread-settings', 'stop']);
    // Without the plugin to rename it, only its row in Project settings.
    assert.deepEqual(ids(threadMenuItems({ thread: { running: false, resolved: false }, live: false, rename, settings })), ['thread-settings']);

    // Each opens elsewhere, so the Threads menu closes first; neither changes anything by itself.
    const left = [];
    const draw = mount(react, () => ThreadRow({ row, now: 0, onOpen() {}, action, projects, onLeave: () => left.push('leave') }));
    const moreOf = (el) => el.children.find((c) => c?.props?.className === 'dshp-t-row-acts').children.find((c) => c?.type === ThreadMore);
    assert.equal(await moreOf(draw()).props.run('rename'), '');
    assert.deepEqual(plain(rename.getSnapshot().ask), { target: 's1', thread: 't1', title: 'Fix login' });
    assert.equal(await moreOf(draw()).props.run('thread-settings'), '');
    assert.deepEqual([settings.getSnapshot().target, settings.getSnapshot().pick], ['s1', 'thread:t1']);
    assert.deepEqual([left, did], [['leave', 'leave'], []]);
    // As the Projects page runs them, through any session of the project.
    rename.close();
    await runThreadItem('rename', { target: 'c', thread: 't2', title: 'Old copy', rename, settings });
    assert.deepEqual(plain(rename.getSnapshot().ask), { target: 'c', thread: 't2', title: 'Old copy' });
    // Project settings takes a thread's own row (thread:<id>), and nothing else that looks like one.
    settings.open('c', { pick: 'thread:t2' });
    assert.equal(settings.getSnapshot().pick, 'thread:t2');
    settings.open('c', { pick: 'thread:../t2' });
    assert.equal(settings.getSnapshot().pick, null);

    // The dialog: the name now, ready to type over.
    rename.close();
    assert.equal(RenameOverlay({ flow: rename, facts }), null);
    rename.open({ target: 's1', thread: 't1', title: 'Fix login' });
    const shown = RenameOverlay({ flow: rename, facts });
    assert.equal(shown.type, RenameThread);
    const drawDialog = mount(react, () => RenameThread(shown.props));
    const input = (d) => elementsOf(d.children).find((e) => e.props?.['data-projects-rename-input'] !== undefined);
    const saveOf = (d) => elementsOf(d.props.footer).find((e) => e.props?.['data-projects-rename-save'] !== undefined);
    const submit = (d) => elementsOf(d.children).find((e) => e.type === 'form').props.onSubmit({ preventDefault() {} });
    let dialog = drawDialog();
    assert.deepEqual(plain([dialog.props.title, dialog.props.className, input(dialog).props.value, input(dialog).props['aria-label'], input(dialog).props['data-modal-autofocus'], saveOf(dialog).props.variant, textIn(saveOf(dialog))]),
        ['Rename thread', 'dshp-rn', 'Fix login', 'Thread name', '', 'primary', 'Rename']);
    // Only spaces can't be saved; the same name, spaces aside, closes it with no change.
    input(dialog).props.onChange({ target: { value: '   ' } });
    assert.equal(saveOf(drawDialog()).props.disabled, true);
    input(dialog).props.onChange({ target: { value: '  Fix   login ' } });
    submit(drawDialog());
    await tick();
    assert.deepEqual([did, rename.getSnapshot().ask], [[], null]);

    // A new name goes to the plugin with its spaces tidied; a refusal shows in the dialog, which stays open.
    rename.open({ target: 's1', thread: 't1', title: 'Fix login' });
    const again = mount(react, () => RenameThread(RenameOverlay({ flow: rename, facts }).props));
    dialog = again();
    input(dialog).props.onChange({ target: { value: '  Sign-in   fix ' } });
    answer = { ok: false, error: { code: 'coordinator/refused', message: 'no thread t1 in this project' } };
    submit(again());
    await tick();
    dialog = again();
    const alert = byClass(dialog.children, 'dshp-ar-error')[0];
    assert.deepEqual([alert.props.role, textIn(alert), rename.getSnapshot().ask?.thread], ['alert', 'No thread t1 in this project.', 't1']);
    // While the plugin answers: Renaming…, and nothing to press twice.
    let finish;
    facts.change = (target, changes) => { did.push(['change', target, plain(changes)]); return new Promise((resolve) => { finish = resolve; }); };
    saveOf(dialog).props.onClick();
    dialog = again();
    assert.deepEqual([saveOf(dialog).props.disabled, input(dialog).props.disabled, textIn(byClass(dialog.children, 'dshp-ar-line')[0])], [true, true, 'Renaming…']);
    finish({ ok: true, value: { notes: ['t1: renamed to "Sign-in fix".'] } });
    await tick();
    assert.deepEqual(did, [['change', 's1', { thread: 't1', title: 'Sign-in fix' }], ['change', 's1', { thread: 't1', title: 'Sign-in fix' }]]);
    assert.equal(rename.getSnapshot().ask, null, 'renamed: the dialog closes');

    // Gone from this window (its overlay unmounted): nothing opens, and the ⋯ doesn't offer it.
    offRename();
    rename.open({ target: 's1', thread: 't1', title: 'Fix login' });
    assert.equal(rename.getSnapshot().ask, null);
    assert.deepEqual(ids(rowMenuItems({ row, action, projects })), ['open', 'thread-settings', 'resolve']);
    offSettings();
    assert.deepEqual(ids(rowMenuItems({ row, action, projects })), ['open', 'resolve']);
});

test('browser half: over 8 threads, Find a thread keeps the rows whose name holds the words, resolved ones too, with the words marked', () => {
    const { client, react } = loadClient();
    const { ThreadFind, ThreadList, ThreadRow, findRows, FIND_FROM } = client.internals;
    const rows = ['Fix login', 'Hero images', 'Cart totals', 'Login copy'].map((title, i) => ({
        id: `t${i + 1}`, title, line: 'Done', dot: 'done', session: `s${i + 1}`, group: i === 3 ? 'resolved' : 'done', running: false,
    }));
    assert.equal(FIND_FROM, 8);
    assert.deepEqual(plain(findRows(rows, ' LOGIN ').map((r) => r.id)), ['t1', 't4']);
    assert.equal(findRows(rows, '  '), rows);
    // The list passes the words to its rows, and while finding the Resolved group's matches show unfolded.
    const listed = (props) => elementsOf(mount(react, () => ThreadList({ now: 0, onOpen() {}, ...props }))()).filter((e) => e.type === ThreadRow).map((e) => [e.props.row.id, e.props.find]);
    assert.deepEqual(plain(listed({ rows: findRows(rows, 'login'), find: 'login', fold: [] })), [['t1', 'login'], ['t4', 'login']]);
    // Without words, Resolved stays folded behind its count.
    assert.deepEqual(plain(listed({ rows })), [['t1', ''], ['t2', ''], ['t3', '']]);
    // A row marks the words in its name, which keeps its whole name for its label.
    const drawn = mount(react, () => ThreadRow({ row: rows[3], now: 0, onOpen() {}, find: 'login' }))();
    const name = byClass(drawn, 'dshp-t-name')[0];
    assert.deepEqual(plain([textIn(name), name.children.map((c) => (typeof c === 'string' ? c : `[${textIn(c)}]`)), byClass(name, 'dshp-tree-hit').length]), ['Login copy', ['[Login]', ' copy'], 1]);
    assert.match(drawn.children[0].props['aria-label'], /^Login copy\. /);

    // The box: one of the panel's items, so the arrows go on to the rows; Home and End stay in its words, and Escape clears them.
    const said = [];
    const inputRef = { current: { focus: () => said.push('focus') } };
    const box = (find) => ThreadFind({ find, setFind: (value) => said.push(value), inputRef });
    const inputOf = (el) => elementsOf(el).find((e) => e.props?.['data-projects-thread-find'] !== undefined);
    const clearOf = (el) => elementsOf(el).find((e) => e.props?.['data-projects-thread-find-clear'] !== undefined);
    assert.deepEqual(plain([inputOf(box('')).props.role, inputOf(box('')).props['aria-label'], inputOf(box('')).props.placeholder, inputOf(box('')).props['data-dshp-item'], inputOf(box('')).props.className, clearOf(box(''))]),
        ['searchbox', 'Find a thread', 'Find a thread', '', 'dshp-t-find-box', null]);
    inputOf(box('')).props.onChange({ target: { value: 'log' } });
    const press = (key, find) => {
        const event = { key, stopped: false, prevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.prevented = true; } };
        inputOf(box(find)).props.onKeyDown(event);
        return [event.stopped, event.prevented];
    };
    assert.deepEqual([press('Home', 'log'), press('End', 'log'), press('ArrowDown', 'log'), press('ArrowUp', 'log'), press('Escape', 'log'), press('Escape', '')],
        [[true, false], [true, false], [false, false], [false, false], [true, true], [false, false]]);
    // Its × clears the words and hands the keyboard back to the box.
    assert.deepEqual([inputOf(box('log')).props.className, clearOf(box('log')).props['aria-label']], ['dshp-t-find-box dshp-t-find-query', 'Clear the find']);
    clearOf(box('log')).props.onClick();
    assert.deepEqual(said, ['log', '', '', 'focus']);
});

test('browser half: the arrows leave a row\'s open ⋯ to DSH\'s menu, and go on from a row\'s ⋯ when it is closed', () => {
    const focused = [];
    const doc = {
        activeElement: null,
        addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ dataset: {} }), head: { appendChild: () => {} }, querySelector: () => null,
    };
    const { client } = loadClient({ document: doc });
    const { arrowKeys } = client.internals;
    const item = (name) => ({ name, focus() { focused.push(name); doc.activeElement = this; }, closest: () => null });
    const rows = [item('a'), item('b'), item('c')];
    const row = (main) => ({ contains: (node) => node === main });
    const more = (main, open) => ({ name: `${main.name}-more`, closest: (sel) => (sel === '.dshp-t-row' ? row(main) : sel === '[data-projects-row-menu][aria-expanded="true"]' && open ? {} : null) });
    const root = { querySelectorAll: () => rows };
    const press = (key, target) => {
        let prevented = false;
        doc.activeElement = target;
        arrowKeys({ key, target, preventDefault: () => { prevented = true; } }, root);
        return prevented;
    };
    // From b's ⋯ (closed), Down goes to c and Up to a, not to the list's ends.
    assert.equal(press('ArrowDown', more(rows[1], false)), true);
    assert.equal(press('ArrowUp', more(rows[1], false)), true);
    // From a row's button, as before.
    press('ArrowDown', rows[2]);
    assert.deepEqual(focused, ['c', 'a', 'a']);
    // With b's list open, the keys are DSH's menu's: nothing moves and nothing is prevented.
    assert.equal(press('ArrowDown', more(rows[1], true)), false);
    assert.deepEqual(focused, ['c', 'a', 'a']);
});

test('browser half: the Threads menu opens when the pointer moves onto its trigger, not when the header moves the trigger under a still pointer', async () => {
    const doc = { body: 'body', addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => ({}) };
    const { client, react } = loadClient({ document: doc, primitives: { useAnchoredPosition: () => null, useDismissOnOutsidePointer: () => {}, MenuSurface: 'MenuSurface' } });
    const { ThreadsMenu } = client.internals;
    const state = { projectionsBySession: { 's-c': { values: { coordinatorSession: { role: 'coordinator', project: { name: 'Shop' }, threads: [] } } } } };
    const quiet = { subscribe: () => () => {} };
    const projects = {
        facts: { ...quiet, getSnapshot: () => 0, watch: () => () => {}, paused: () => false, info: () => undefined, describe: async () => {} },
        settings: { ...quiet, getSnapshot: () => ({ available: false }) },
        catalog: { ...quiet, getSnapshot: () => ({ status: 'ready', value: undefined }), ensure: () => {} },
        refresh: () => {}, hasPane: () => false, hasChanges: () => false,
    };
    // State and refs hold between draws, as React's do; effects don't run.
    const refs = [];
    const draw = mount(react, () => {
        let at = 0;
        react.useRef = (init) => {
            const k = at++;
            if (!(k in refs)) refs[k] = { current: init };
            return refs[k];
        };
        return ThreadsMenu({ sessionId: 's-c', useSessions: (select) => select(state), useSessionStatus: (select) => select(new Map()), projects });
    });
    const shown = () => {
        const tree = draw();
        const all = elementsOf(tree);
        const trigger = all.find((e) => e.props?.['data-projects-threads-trigger'] === '').props;
        const menu = all.find((e) => e.props?.['data-projects-threads-menu'] === '')?.props;
        return { root: tree.props, trigger, menu, open: trigger['aria-expanded'] };
    };
    const later = () => new Promise((r) => setTimeout(r, 200));
    // What the browser sends the trigger, in its order, to whichever of these the trigger listens to.
    const send = (props, ...events) => { for (const [name, event] of events) props[name]?.(event); };
    const mouse = (x, y) => ({ pointerType: 'mouse', movementX: x, movementY: y });
    const enter = [['onPointerEnter', mouse(0, 0)], ['onMouseEnter', {}]];
    const move = (x, y) => [['onPointerMove', mouse(x, y)], ['onMouseMove', {}]];
    let at = shown();
    assert.equal(at.open, false);

    // Opening the Changes tab from the pill re-flows the header and puts the trigger under the pointer, which
    // doesn't move: the browser says the pointer came in, and no more. The menu stays closed.
    send(at.trigger, ...enter);
    await later();
    at = shown();
    assert.deepEqual([at.open, at.menu], [false, undefined]);
    // A move of nothing (as a browser may send after a re-flow), or a finger's: still closed.
    send(at.trigger, ...move(0, 0), ['onPointerMove', { pointerType: 'touch', movementX: 6, movementY: 2 }]);
    await later();
    at = shown();
    assert.equal(at.open, false);
    // The pointer moves there: it opens, a moment later.
    send(at.trigger, ...move(3, -1));
    assert.equal(shown().open, false);
    await later();
    at = shown();
    assert.equal(at.open, true);
    assert.equal(at.menu.role, 'dialog');

    // From the open menu back onto the trigger (the menu's leave comes between the pointer's and the mouse's
    // enter), it stays open.
    send(at.trigger, enter[0]);
    at.menu.onMouseLeave({});
    send(at.trigger, enter[1], ...move(-2, 0));
    await later();
    at = shown();
    assert.equal(at.open, true);
    // Out of the header, it closes; a move on the trigger after that (still there once Escape closed it, say)
    // doesn't open it again until the pointer comes onto it anew.
    at.root.onMouseLeave({});
    await later();
    at = shown();
    assert.equal(at.open, false);
    send(at.trigger, ...move(2, 2));
    await later();
    assert.equal(shown().open, false);
    // Passing over the trigger and out of the header doesn't open it.
    send(at.trigger, ...enter, ...move(4, 0));
    at.root.onMouseLeave({});
    await later();
    assert.equal(shown().open, false);
    // Coming onto it and moving there, it opens.
    send(at.trigger, ...enter, ...move(1, 0));
    await later();
    assert.equal(shown().open, true);
});

test('browser half: Rename, Mark resolved or Reopen from a row shows at once, and the coordinator\'s own later change wins', () => {
    const { client } = loadClient();
    const { newestRoster: resolvedRoster } = client.internals;
    const seen = new Map();
    const roster = (t1, t2 = true) => [{ id: 't1', resolved: t1 }, { id: 't2', resolved: t2 }];
    const answer = (t1, t2 = true) => [{ id: 't1', resolved: t1 }, { id: 't2', resolved: t2 }];
    const shown = (r, a) => plain(resolvedRoster(r, a, seen, 'c').map((e) => e.resolved));
    // Agreeing, the roster itself comes back.
    const same = roster(false);
    assert.equal(resolvedRoster(same, answer(false), seen, 'c'), same);
    // Mark resolved in the window: the plugin's answer changed last.
    assert.deepEqual(shown(roster(false), answer(true)), [true, true]);
    // The coordinator's next project tool records it too.
    assert.deepEqual(shown(roster(true), answer(true)), [true, true]);
    // The coordinator reopens it with its tool: the roster changed last, before the plugin is read again.
    assert.deepEqual(shown(roster(false), answer(true)), [false, true]);
    assert.deepEqual(shown(roster(false), answer(false)), [false, true]);
    // After a reload the first look takes the plugin's answer (the roster waits on the coordinator's next tool).
    assert.deepEqual(plain(resolvedRoster(roster(false), answer(true), new Map(), 'c').map((e) => e.resolved)), [true, true]);
    // Threads the plugin hasn't named, or no answer yet: the roster as it is.
    assert.deepEqual(plain(resolvedRoster(roster(false), [{ id: 't9', resolved: true }], new Map(), 'c').map((e) => e.resolved)), [false, true]);
    assert.equal(resolvedRoster(same, undefined, new Map(), 'c'), same);
    // A name works the same way: Rename in the window shows at once, and the coordinator's own rename after it wins.
    const names = new Map();
    const named = (r, a) => plain(resolvedRoster([{ id: 't1', title: r }], [{ id: 't1', title: a }], names, 'c').map((e) => e.title));
    assert.deepEqual(named('Fix login', 'Fix login'), ['Fix login']);
    assert.deepEqual(named('Fix login', 'Fix the login loop'), ['Fix the login loop']);
    assert.deepEqual(named('Fix the login loop', 'Fix the login loop'), ['Fix the login loop']);
    assert.deepEqual(named('Login loop', 'Fix the login loop'), ['Login loop']);
    // An answer without a name leaves the roster's.
    assert.deepEqual(plain(resolvedRoster([{ id: 't1', title: 'Fix login' }], [{ id: 't1', title: '' }], new Map(), 'c').map((e) => e.title)), ['Fix login']);
});

test('browser half: access reads as DSH names it, and each thread row says what it can reach', () => {
    const { client } = loadClient();
    const { permissionName, permissionShown, permissionIn, toolsText, accessOf, accessSummary, ThreadRow, ModelsSummary } = client.internals;
    const catalog = {
        defaultPreset: 'danger-full-access',
        options: [
            { value: 'read-only', name: 'read-only' }, { value: 'workspace-write', name: 'Workspace Write' }, { value: 'danger-full-access', name: 'danger-full-access' },
            { value: 'team-review', name: 'team-review' }, { value: 'night', name: 'Night shift' },
        ],
    };
    // DSH's own labels for its presets; another kebab-case name title-cased, any other as given.
    assert.deepEqual(['read-only', 'workspace-write', 'danger-full-access', 'team-review', 'night', 'custom', 'not-offered'].map((v) => permissionName(v, catalog)),
        ['Read Only', 'Workspace Write', 'Full access', 'Team Review', 'Night shift', 'Custom', 'Not Offered']);
    assert.equal(permissionName('', catalog), undefined);
    assert.equal(permissionName('read-only', { options: [{ value: 'read-only', name: 'Look only' }] }), 'Look only', 'a preset the profile renamed keeps its name');
    // "default" is DSH's default for new sessions.
    assert.deepEqual(plain(permissionShown('default', catalog)), { preset: 'danger-full-access', name: 'Full access' });
    assert.deepEqual(plain(permissionShown('default', null)), { name: 'DSH default' });
    assert.deepEqual(plain(permissionShown('workspace-write', null)), { preset: 'workspace-write', name: 'Workspace Write' });
    assert.deepEqual([toolsText('all'), toolsText(['cua', 'lane-catalog']), toolsText([]), toolsText(undefined)], ['all of them', 'cua, lane-catalog', 'none', 'none']);
    // DSH's permissions projection, from either place the window's store keeps it.
    assert.equal(permissionIn({ projectionsBySession: { s1: { values: { permissions: { currentValue: 'read-only' } } } } }, 's1'), 'read-only');
    assert.equal(permissionIn({ byId: { s1: { projectionValues: { permissions: { currentValue: 'workspace-write' } } } } }, 's1'), 'workspace-write');
    assert.equal(permissionIn({ byId: { s1: {} } }, 's1'), undefined);
    assert.equal(permissionIn(undefined, 's1'), undefined);

    // What each thread can reach: the preset DSH shows now wins over the one the plugin last saw.
    const info = {
        access: { yourTools: { value: 'asked' }, threadPermission: { value: 'workspace-write' } }, guarded: ['lane-catalog', 'cua'], permissions: catalog,
        threads: [{ id: 't1', session: 's1', permission: 'workspace-write', tools: ['lane-catalog'] }, { id: 't2', session: 's2', permission: 'workspace-write', tools: [] }, { id: 't3', tools: [] }],
    };
    assert.deepEqual(plain(accessOf(info, { s2: 'read-only' })), { s1: { permission: 'workspace-write', tools: ['lane-catalog'] }, s2: { permission: 'read-only', tools: [] } });
    assert.deepEqual(plain(accessOf(null, {})), {});
    // The menu's access rows: what new threads start on, and the user's tools once any are listed.
    assert.deepEqual(plain(accessSummary(info)), { permission: { preset: 'workspace-write', name: 'Workspace Write' }, tools: 'Only when asked' });
    assert.equal(accessSummary({ ...info, access: { ...info.access, yourTools: { value: 'always' } } }).tools, 'Always');
    assert.deepEqual(plain(accessSummary({ ...info, guarded: [] })), { permission: { preset: 'workspace-write', name: 'Workspace Write' } });
    assert.deepEqual(plain(accessSummary({ ...info, permissions: null })), { tools: 'Only when asked' });
    assert.deepEqual(plain(accessSummary({ ...info, guarded: [], permissions: null })), {});
    assert.deepEqual(plain(accessSummary(null)), {});

    // A row names the user's tools it has, and a permission other than new threads' default.
    const row = { id: 't1', title: 'Check lanes', line: 'Running', dot: 'ongoing', session: 's1' };
    const bodyOf = (el) => (el.props.className === 'dshp-t-row' ? el : el.children[0]);
    const mainOf = (el) => bodyOf(el).children.find((c) => c?.props?.className === 'dshp-t-main');
    const chips = (access) => {
        const main = mainOf(ThreadRow({ row, now: 0, onOpen() {}, access, quietPermission: 'workspace-write', permissions: catalog }));
        return { label: main.props['aria-label'], tools: textIn(byClass(main, 'dshp-t-tools')), permission: byClass(main, 'dshp-t-perm').map((e) => [e.props['data-projects-thread-permission'], textIn(e)]) };
    };
    assert.deepEqual(plain(chips({ permission: 'workspace-write', tools: ['lane-catalog'] })),
        { label: 'Check lanes. Running. Your tools: lane-catalog', tools: 'lane-catalog', permission: [] });
    assert.deepEqual(plain(chips({ permission: 'read-only', tools: [] })),
        { label: 'Check lanes. Running. Read Only', tools: '', permission: [['read-only', 'Read Only']] });
    assert.deepEqual(plain(chips({ permission: 'danger-full-access', tools: 'all' })),
        { label: 'Check lanes. Running. Full access. Your tools: all of them', tools: 'all of them', permission: [['danger-full-access', 'Full access']] });
    assert.deepEqual(plain(chips(undefined)), { label: 'Check lanes. Running', tools: '', permission: [] });

    // The menu's top: rows for new threads' permission and the user's tools, each opening Project settings at Access.
    const picked = [];
    const summary = ModelsSummary({ coordinator: 'V4 · Max', thread: 'V4 · High', access: accessSummary(info), onPick: (id) => picked.push(id) });
    const rows = summary.children.filter(Boolean);
    assert.deepEqual(rows.map((r) => r.props['data-projects-models']), ['coordinator', 'thread', 'access', 'tools']);
    assert.deepEqual(rows.slice(2).map((r) => r.props['aria-label']),
        ['Thread access: Workspace Write. Change it in Project settings', 'Your tools: Only when asked. Change it in Project settings']);
    rows[2].props.onClick();
    rows[3].props.onClick();
    assert.deepEqual(picked, ['access', 'access']);
    assert.equal(ModelsSummary({ coordinator: 'V4 · Max', thread: 'V4 · High' }).children.filter(Boolean).length, 2);
    assert.equal(ModelsSummary({ coordinator: 'V4 · Max', thread: 'V4 · High', access: {} }).children.filter(Boolean).length, 2);
});

test('browser half: thread rows, cards and links read the projection as DSH sends it', () => {
    const { client } = loadClient();
    const { projectContext, rowsOf, countsOf, summaryText, cardsOf, cardView, resolveLink, linkTarget, chatAddress, chatSessionOf, isThreadRow } = client.internals;
    const coordValue = { role: 'coordinator', project: { id: 'p', name: 'DSH Plugins' }, threads: [
        { id: 't1', session: 's-t1', title: 'Add CI', resolved: false, created: '2026-10-09T10:00:00.000Z', handback: { status: 'done', summary: 'CI added.', at: '2026-10-09T11:00:00.000Z' } },
        { id: 't2', session: 's-t2', title: 'Fix login', resolved: false, created: '2026-10-09T12:00:00.000Z', handback: { status: 'needs_decision', summary: 'Pick A or B.', at: '2026-10-09T13:00:00.000Z' } },
        { id: 't3', session: 's-t3', title: 'Write docs', resolved: false, created: '2026-10-09T14:00:00.000Z' },
        { id: 't4', session: 's-t4', title: 'Old spike', resolved: true, created: '2026-10-08T14:00:00.000Z' },
    ], cards: [
        { turn: 2, seq: 10, kind: 'start', thread: 't3' },
        { turn: 2, seq: 11, kind: 'send', thread: 't3', status: 'steer' },
        { turn: 2, seq: 12, kind: 'start', thread: 't4' },
        { turn: 3, seq: 20, kind: 'handback', thread: 't2', status: 'needs_decision' },
    ] };
    const threadValue = { role: 'thread', project: { name: 'DSH Plugins' }, coordinator: 's-c', thread: { id: 't3', title: 'Write docs' },
        cards: [{ turn: 1, seq: 5, kind: 'handback', thread: 't3', status: 'progress' }] };
    // The session list as DSH's store holds it: values on rows (cached) or loaded per session.
    const state = {
        ids: ['s-c', 's-t1', 's-t3', 's-plain'],
        phase: 'ready',
        byId: {
            's-c': { id: 's-c', title: '◆ DSH Plugins', projectionValues: { coordinatorSession: coordValue } },
            's-t1': { id: 's-t1', title: 'DSH Plugins › Add CI' },
            's-t3': { id: 's-t3', title: 'DSH Plugins › Write docs', running: true, updatedAt: Date.parse('2026-10-09T15:00:00.000Z') },
            's-plain': { id: 's-plain', title: 'Something else' },
        },
        projectionsBySession: { 's-t3': { state: 'ready', values: { coordinatorSession: threadValue } } },
    };
    const statuses = new Map([['s-t3', { running: true }]]);

    // The coordinator's roster, newest activity first, each with what it needs.
    const coord = projectContext(state, 's-c');
    const rows = rowsOf(coord.roster, statuses, state.byId);
    assert.deepEqual(plain(rows.map((r) => [r.id, r.group, r.dot, r.line])), [
        ['t3', 'running', 'ongoing', 'Working…'],
        ['t2', 'waiting', 'warning', 'Needs your decision · Pick A or B.'],
        ['t1', 'done', 'done', 'Done · CI added.'],
        ['t4', 'resolved', 'done', 'Resolved'],
    ]);
    assert.deepEqual(plain(countsOf(rows)), { open: 3, running: 1, waiting: 1, resolved: 1, failed: 0 });
    assert.equal(summaryText(countsOf(rows)), '3 open · 1 waiting on you · 1 running · 1 resolved');
    // A thread reads the roster from its coordinator, and knows it is still loading before then.
    const thread = projectContext(state, 's-t3');
    assert.equal(thread.coordinator, 's-c');
    assert.equal(thread.roster, coord.roster);
    const early = projectContext({ ...state, byId: { ...state.byId, 's-c': { id: 's-c' } }, projectionsBySession: { ...state.projectionsBySession, 's-c': { state: 'loading', values: {} } } }, 's-t3');
    assert.deepEqual([early.roster, early.load], [null, 'loading']);
    assert.equal(projectContext(state, 's-plain'), undefined);

    // Cards: one per thread in a turn, the first action wins.
    assert.deepEqual(plain(cardsOf(coordValue, 2).map((c) => [c.kind, c.thread])), [['start', 't3'], ['start', 't4']]);
    assert.equal(cardsOf(coordValue, 9).length, 0);
    const [handback] = cardsOf(coordValue, 3).map((card) => cardView(card, coord, statuses, state.byId, 's-c'));
    // A card says its thread's state once, beside the name: while the handback's state is the thread's, its line says only "Handback".
    assert.deepEqual(plain([handback.verb, handback.title, handback.session, handback.state.label, handback.icon]), ['Handback', 'Fix login', 's-t2', 'Needs a decision', 'IconTreeCornerRegular']);
    const steer = cardView({ turn: 2, seq: 11, kind: 'send', thread: 't3', status: 'steer' }, coord, statuses, state.byId, 's-c');
    assert.deepEqual(plain([steer.verb, steer.state.label]), ['Steered a thread', 'Running']);
    const verbOf = (card) => { const v = cardView({ turn: 2, seq: 1, ...card }, coord, statuses, state.byId, 's-c'); return [v.verb, v.state.label]; };
    assert.deepEqual(plain([
        verbOf({ kind: 'update', thread: 't4', status: 'resolved' }), verbOf({ kind: 'update', thread: 't3', status: 'resolved' }),
        verbOf({ kind: 'handback', thread: 't3', status: 'done' }), verbOf({ kind: 'handback', thread: 't3', status: 'progress' }),
        verbOf({ kind: 'approval', thread: 't3' }),
    ]), [
        ['Updated a thread', 'Resolved'], ['Resolved a thread', 'Running'],
        // Once the thread moved on, the line keeps what the event said.
        ['Handback · Done', 'Running'], ['Progress update', 'Running'],
        ['Asked for your approval', 'Running'],
    ]);
    // In a thread, its own handback card points back at the coordinator.
    const own = cardView(threadValue.cards[0], thread, statuses, state.byId, 's-t3');
    assert.deepEqual(plain([own.verb, own.title, own.session]), ['Handed back to the coordinator · Progress update', '◆ DSH Plugins', 's-c']);
    // While the project is paused, the thread's own card says its handback waits, and the coordinator's cards
    // read a held handback as the Threads menu does.
    const heldOwn = cardView(threadValue.cards[0], thread, statuses, state.byId, 's-t3', undefined, [{ thread: 't3', status: 'progress' }]);
    assert.deepEqual(plain([heldOwn.verb, heldOwn.note, heldOwn.icon]), ['Handback held · Progress update', 'The project is paused, so the coordinator gets this handback when you resume.', 'IconPauseOutlineRegular']);
    assert.equal(cardView(threadValue.cards[0], thread, statuses, state.byId, 's-t3', undefined, [{ thread: 't9', status: 'done' }]).verb, 'Handed back to the coordinator · Progress update');
    const heldCard = cardView({ turn: 2, seq: 12, kind: 'send', thread: 't2' }, coord, statuses, state.byId, 's-c', undefined, [{ thread: 't2', status: 'blocked' }]);
    assert.deepEqual(plain([heldCard.state.label, heldCard.state.dot, heldCard.row.line, heldCard.row.held]), ['Blocked', 'warning', 'Blocked · held until you resume', true]);

    // A thread link as DSH resolves `.dsh-thread/t3` against the coordinator's session.
    const target = linkTarget(`dsh-resource://file/session/${encodeURIComponent('s-c')}/.dsh-thread/T3`);
    assert.deepEqual(plain(target), { sessionId: 's-c', threadId: 't3' });
    assert.deepEqual(plain(resolveLink(state, target)), { state: 'found', session: 's-t3', coordinator: 's-c' });
    assert.equal(resolveLink(state, { sessionId: 's-c', threadId: 't9' }).state, 'missing');
    assert.equal(resolveLink(state, { sessionId: 's-t3', threadId: 't3' }).state, 'found');
    assert.equal(resolveLink(state, { sessionId: 'not-loaded', threadId: 't1' }).state, 'loading');
    assert.equal(resolveLink(state, undefined).state, 'invalid');
    assert.equal(linkTarget('dsh-resource://file/session/s-c/.dsh-thread/notes.md'), undefined);
    // The short `.t3` names the same thread; `.tmp` names a file.
    assert.deepEqual(plain(linkTarget('dsh-resource://file/session/s-c/.t3')), plain(target));
    assert.deepEqual(plain(resolveLink(state, linkTarget('dsh-resource://file/session/s-c/.t3'))), { state: 'found', session: 's-t3', coordinator: 's-c' });
    assert.equal(linkTarget('dsh-resource://file/session/s-c/.tmp'), undefined);

    // A sidebar chat address keeps any session id intact.
    assert.equal(chatSessionOf(chatAddress('sess/with ?#%')), 'sess/with ?#%');
    assert.equal(chatSessionOf('dsh-resource://subagentchat/session/x'), undefined);

    // Sidebar marks: from the projection, or from the "<project> › " title before DSH has folded the row.
    assert.deepEqual(['s-t3', 's-t1', 's-c', 's-plain'].map((id) => isThreadRow(state, id)), [true, true, false, false]);
});

test('browser half: a failed or stopped thread reads Failed or Stopped everywhere, with its reason and Retry or Resume', () => {
    const { client } = loadClient();
    const { projectContext, rowsOf, countsOf, cardView, rowState, endingIn, endingLine, openSessions, markState, hoverLine, withHeld, continueError, GROUPS } = client.internals;
    const at = (h) => `2026-10-10T${String(h).padStart(2, '0')}:00:00.000Z`;
    const failed = { state: 'failed', kind: 'error', message: 'The model rejected the request.', turn: 1, seq: 9, at: at(10) };
    const stopped = { state: 'stopped', kind: 'aborted', cause: 'user', turn: 1, seq: 7, at: at(10) };
    const coordValue = { role: 'coordinator', project: { id: 'p', name: 'Storefront' }, threads: [
        { id: 't6', session: 's-t6', title: 'Refactor cart state', resolved: false, created: at(8) },
        { id: 't7', session: 's-t7', title: 'Generate size-guide tables', resolved: false, created: at(8) },
        // A done handback after a stop: the handback is the news.
        { id: 't8', session: 's-t8', title: 'Caching spike', resolved: false, created: at(8), handback: { status: 'done', summary: 'Spike done.', at: at(11) } },
        // A failure after a decision handback: the failure is the news.
        { id: 't9', session: 's-t9', title: 'Fix the login loop', resolved: false, created: at(8), handback: { status: 'needs_decision', summary: 'A or B?', at: at(9) } },
        { id: 't10', session: 's-t10', title: 'Old', resolved: true, created: at(7) },
    ], cards: [
        { turn: 4, seq: 30, kind: 'start', thread: 't7' },
        { turn: 5, seq: 40, kind: 'idle', thread: 't7', status: 'failed' },
        { turn: 5, seq: 41, kind: 'idle', thread: 't6', status: 'stopped' },
        { turn: 5, seq: 42, kind: 'idle', thread: 't8' },
    ] };
    const thread = (id, ending) => ({ role: 'thread', project: { name: 'Storefront' }, coordinator: 's-c', thread: { id }, ...(ending ? { ending } : {}) });
    const state = {
        byId: { 's-c': { id: 's-c', title: '◆ Storefront', projectionValues: { coordinatorSession: coordValue } } },
        projectionsBySession: {
            's-t6': { values: { coordinatorSession: thread('t6', stopped) } },
            's-t7': { values: { coordinatorSession: thread('t7', failed) } },
            's-t8': { values: { coordinatorSession: thread('t8', stopped) } },
            's-t9': { values: { coordinatorSession: thread('t9', { ...failed, at: at(12) }) } },
            's-t10': { values: { coordinatorSession: thread('t10', failed) } },
        },
    };
    const coord = projectContext(state, 's-c');
    assert.deepEqual(plain(openSessions(coord.roster)), ['s-t6', 's-t7', 's-t8', 's-t9'], 'resolved threads need no ending');
    const endings = Object.fromEntries(openSessions(coord.roster).map((id) => [id, endingIn(state, id)]).filter(([, e]) => e));
    const rows = rowsOf(coord.roster, new Map(), state.byId, endings);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.deepEqual(plain(['t7', 't6', 't8', 't9', 't10'].map((id) => [id, byId[id].group, byId[id].dot, byId[id].stateLabel, byId[id].line])), [
        ['t7', 'waiting', 'error', 'Failed', 'Failed · The model rejected the request.'],
        // A stop DSH counts as the user's is named as theirs.
        ['t6', 'idle', 'idle', 'Stopped', 'Stopped by you'],
        ['t8', 'done', 'done', 'Done', 'Done · Spike done.'],
        ['t9', 'waiting', 'error', 'Failed', 'Failed · The model rejected the request.'],
        ['t10', 'resolved', 'done', 'Resolved', 'Resolved'],
    ]);
    assert.deepEqual(plain(countsOf(rows)), { open: 4, running: 0, waiting: 2, resolved: 1, failed: 2 });
    assert.deepEqual(plain(GROUPS.map((g) => g.label)), ['Waiting on you', 'Running', 'Done', 'Idle', 'Resolved']);
    // Running, a prompt and resolved win over an old ending; a held handback is newer than any.
    assert.equal(rowState({ running: true, ending: failed }).label, 'Running');
    assert.equal(rowState({ pending: { kind: 'approval' }, ending: failed }).label, 'Needs you');
    assert.equal(rowState({ resolved: true, ending: failed }).label, 'Resolved');
    assert.equal(rowState({ hb: { status: 'blocked' } }).label, 'Blocked');
    assert.deepEqual(plain(withHeld([byId.t7], [{ thread: 't7', status: 'done' }]).map((r) => [r.group, r.stateLabel, r.line, r.ending])),
        [['done', 'Done', 'Done · held until you resume', null]]);
    // Why, for each way a turn ends.
    assert.deepEqual(plain([
        { state: 'failed', kind: 'blocked' }, { state: 'failed', kind: 'signed-out' }, { state: 'failed', kind: 'error' },
        { state: 'stopped', kind: 'interrupted' }, { state: 'stopped', kind: 'max-tokens' }, { state: 'stopped', kind: 'aborted', cause: 'hook', hook: 'budget' },
        { state: 'stopped', kind: 'aborted', cause: 'disposed' }, { state: 'stopped', kind: 'aborted', cause: 'user' }, { state: 'stopped', kind: 'aborted' },
    ].map(endingLine)), [
        'Failed · A DSH plugin blocked the turn.', 'Failed · You signed out of DeepSeek.', 'Failed · DSH couldn\'t finish the turn.',
        'Stopped · DSH closed while it ran.', 'Stopped · It reached the output token limit.', 'Stopped · A DSH plugin stopped it (budget).',
        'Stopped · Its session closed while it ran.', 'Stopped by you', 'Stopped before it finished',
    ]);

    // Cards: the idle note's card names the failure; every card of the thread says its state now.
    const statuses = new Map();
    const views = coordValue.cards.map((card) => cardView(card, coord, statuses, state.byId, 's-c', endings));
    assert.deepEqual(plain(views.map((v) => [v.threadId, v.verb, v.tone ?? null, v.state.label, v.row.ending?.state ?? null])), [
        ['t7', 'Started a thread', null, 'Failed', 'failed'],
        ['t7', 'Ended without a handback', 'error', 'Failed', 'failed'],
        ['t6', 'Ended without a handback', null, 'Stopped', 'stopped'],
        ['t8', 'Went idle without a handback', null, 'Done', null],
    ]);
    // No word twice on a card: the state is said beside the name, not again in its line.
    for (const v of views) assert.ok(!v.verb.split(/\W+/).includes(v.state.label), `${v.verb} / ${v.state.label}`);
    assert.deepEqual(plain(views.slice(0, 3).map((v) => v.icon)), ['IconBranchOutlineRegular', 'IconWarningTriangleOutlineRegular', 'IconStopFillRegular']);

    // The session list: a failed thread's mark is red, a waiting one's amber; DSH draws running ones.
    const marked = { ...state, projectionsBySession: { ...state.projectionsBySession, 's-t11': { values: { coordinatorSession: thread('t11') } } } };
    marked.byId = { ...state.byId, 's-c': { ...state.byId['s-c'], projectionValues: { coordinatorSession: { ...coordValue, threads: [...coordValue.threads,
        { id: 't11', session: 's-t11', title: 'CDN', resolved: false, handback: { status: 'blocked', summary: 'Token expired.', at: at(9) } }] } } } };
    assert.deepEqual(plain(['s-t7', 's-t6', 's-t8', 's-t11', 's-t10', 's-c', 'nope'].map((id) => markState(marked, id))),
        ['error:Failed', '', '', 'warning:Blocked', '', '', '']);
    // What a screen reader hears after each row's title (DSH's own status can take the mark's seat, never these words).
    const { RowPlace, rowWords } = client.internals;
    const useMarked = (select) => select(marked);
    assert.deepEqual(plain(['s-t7', 's-t11', 's-t8', 's-c', 'nope'].map((id) => RowPlace({ sessionId: id, useSessions: useMarked })?.props['data-projects-words'] ?? null)),
        ['Project thread: Failed', 'Project thread: Blocked', 'Project thread', 'Project', null]);
    assert.equal(rowWords({ role: 'coordinator', paused: true }), 'Project paused');
    assert.equal(rowWords({ role: 'coordinator', paused: true, news: { unread: [{ kind: 'failed', title: 'Deploy' }] } }), 'Project paused, New: “Deploy” failed');
    assert.equal(rowWords({ role: '' }), '');

    // The hover card says what the thread last did; DSH ends it with the session's own status.
    assert.deepEqual(plain(['t7', 't6', 't8', 't9'].map((id) => hoverLine(byId[id]))), [
        'Last turn failed · The model rejected the request.', 'Last turn stopped by you', 'Last handback · Done · Spike done.', 'Last turn failed · The model rejected the request.',
    ]);
    assert.equal(hoverLine({ ...byId.t7, pending: true }), undefined);
    assert.equal(hoverLine(rowsOf([{ id: 't1', session: 's1', title: 'x', resolved: false }], new Map(), {}, {})[0]), 'No handback yet');

    // A refusal reads as the plugin's sentence.
    assert.equal(continueError({ code: 'coordinator/refused', message: 't7 is running already' }), 'T7 is running already.');
    assert.equal(continueError({ code: 'projects/unreachable', message: 'socket' }), 'Couldn\'t reach the thread.');
});

test('browser half: each session list row says its place in a project, and the CSS nests each project by it', () => {
    const { client } = loadClient();
    const { rowPlace, nestingCss, nestedPlaces } = client.internals;
    const coord = (name) => ({ role: 'coordinator', project: { name }, threads: [] });
    const state = {
        byId: {
            c: { title: '◆ DSH Plugins', projectionValues: { coordinatorSession: coord('DSH Plugins') } },
            t1: { title: 'DSH Plugins › Add CI' },
            t2: { title: 'Fix login', projectionValues: { coordinatorSession: { role: 'thread', coordinator: 'c', thread: { id: 't2' } } } },
            t3: { title: 'Renamed by hand', projectionValues: { coordinatorSession: { role: 'thread', coordinator: 'c', thread: { id: 't3' } } } },
            o: { title: '◆ Other' },
            ot: { title: 'Other › Its thread' },
            plain: { title: 'Release notes' },
            odd: { title: 'Nobody › Not a thread' },
            lost: { title: 'x', projectionValues: { coordinatorSession: { role: 'thread', thread: { id: 't9' } } } },
        },
    };
    // A coordinator by its projection or its "◆ " title; a thread by its projection whatever its title,
    // or (before its projection reaches the list) by an old "<project> › " title with that coordinator listed.
    assert.equal(rowPlace(state, 'c'), 'coordinator:c');
    assert.equal(rowPlace(state, 'o'), 'coordinator:o');
    assert.equal(rowPlace(state, 't1'), 'thread:c');
    assert.equal(rowPlace(state, 't2'), 'thread:c');
    assert.equal(rowPlace(state, 't3'), 'thread:c');
    assert.equal(rowPlace(state, 'ot'), 'thread:o');
    assert.equal(rowPlace(state, 'plain'), '');
    assert.equal(rowPlace(state, 'odd'), '');
    assert.equal(rowPlace(state, 'lost'), '');
    assert.equal(rowPlace(state, 'missing'), '');
    assert.equal(rowPlace(undefined, 'c'), '');

    // The projects drawn in a section, read from the marks in its rows: each coordinator there with its threads
    // there, at its wrapper's place (from 1), its threads in DSH's order; a coordinator without threads here, or a
    // thread whose coordinator is elsewhere, nests nothing.
    const { sectionGroups } = client.internals;
    const markOf = (mark) => (mark ? { getAttribute: (name) => ({ 'data-projects-row': mark[0], 'data-projects-of': mark[1] })[name] ?? null } : null);
    const rowEl = (key, mark) => ({ getAttribute: (name) => (name === 'data-row-key' ? key : null), querySelector: (sel) => (sel === '[data-projects-row]' ? markOf(mark) : null) });
    const wrap = (key, mark) => ({ children: [rowEl(key, mark)] });
    const section = {
        children: [
            wrap('workspace:w'), wrap('session:x'), wrap('session:t2', ['thread', 'c']), wrap('session:c', ['coordinator', 'c']),
            wrap('session:d', ['coordinator', 'd']), wrap('session:e', ['coordinator', 'e']), wrap('session:t1', ['thread', 'c']),
            wrap('session:et', ['thread', 'e']), wrap('session:far', ['thread', 'elsewhere']), { children: [] }, wrap('overflow:w'),
        ],
    };
    assert.deepEqual(plain(sectionGroups(section)), [
        { coordinator: 'c', at: 4, threads: ['t2', 't1'] },
        { coordinator: 'e', at: 6, threads: ['et'] },
    ]);
    assert.deepEqual(plain(sectionGroups(null)), []);

    // The rules find a section, each child's place and the nested threads by the plugin's marks (markNesting), never
    // by what an element holds: each ends in a mark or DSH's row key, so one row's change restyles that row, not the
    // list (1.8 s to 0.1 s at 300 chats with :has() rules that looked no deeper than a section's grandchildren; the
    // marks take the rest).
    const rules = nestingCss().split('\n');
    const S = '[role="tree"] div[data-projects-nests]';
    const T = `${S}>[data-projects-nested]`;
    for (const rule of rules) {
        assert.ok(rule.startsWith(S), rule);
        assert.doesNotMatch(rule.slice(0, rule.indexOf('{')), /:has\(|~|\+/, rule);
    }
    assert.ok(rules.includes(`${S}{display:flex;flex-direction:column}`));
    // Each order a mark can say has its rule, ten projects' worth; a section with more gets more.
    assert.equal(rules.filter((rule) => rule.includes('[data-projects-order=')).length, 30);
    assert.ok(rules.includes(`${S}>[data-projects-order="3"]{order:3}`));
    assert.equal(nestingCss(33).split('\n').filter((rule) => rule.includes('[data-projects-order=')).length, 33);
    assert.equal(nestingCss(12), nestingCss());
    // A child DSH adds goes last until the plugin's next pass gives it its place: DSH measures its rows for their
    // animation before that pass, and the rows Show more adds belong at the end.
    assert.ok(rules.includes(`${S}>:not([data-projects-order]){order:31}`));
    assert.ok(nestingCss(33).split('\n').includes(`${S}>:not([data-projects-order]){order:34}`));
    assert.ok(rules.includes(`${T}>[data-row-key]{padding-inline-start:calc(var(--dshp-nest,24px) + var(--dsh-workspace-indent,0px))}`));
    // The corner is drawn in the indent, not in the row's leading seat; the branch mark leaves the seat but is still read aloud.
    assert.ok(rules.some((rule) => rule.startsWith(`${T}::before{content:"";position:absolute;`)));
    assert.ok(rules.includes(`${T} .dshp-t-mark[data-projects-thread-mark=""]{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}`));
    // DSH's time (the row's third child, before its actions) leaves the row too, still read aloud, so the indent
    // doesn't cost the title its room; a status DSH writes there instead ("Approval") and the actions stay.
    assert.ok(rules.includes(`${T}>[data-row-key]>:nth-child(3):not(:last-child,[aria-hidden="true"]){position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}`));
    // Where each child is drawn: what DSH lists before the first coordinator stays first, then each project where its
    // coordinator is (the coordinator, its threads, what DSH lists after it), so two projects in one workspace stay apart.
    const keys = ['', 'x', 'a', 'y', 'at2', 'bt', 'b', 'z', 'at1'];
    assert.deepEqual(plain(nestedPlaces([{ coordinator: 'b', at: 7, threads: ['bt'] }, { coordinator: 'a', at: 3, threads: ['at1', 'at2'] }], keys)), {
        order: [0, 0, 1, 3, 2, 5, 4, 6, 2],
        nested: [false, false, false, false, true, true, false, false, true],
    });
    // Nothing to nest, or no place yet: nothing; a thread with no id is left out.
    assert.equal(nestedPlaces([], keys), null);
    assert.equal(nestedPlaces(undefined, keys), null);
    assert.equal(nestedPlaces([{ coordinator: 'a', at: 3, threads: [] }], keys), null);
    assert.equal(nestedPlaces([{ coordinator: 'a', at: 0, threads: ['at1'] }], keys), null);
    assert.equal(nestedPlaces([{ coordinator: '', at: 3, threads: ['at1'] }], keys), null);
    assert.equal(nestedPlaces([{ coordinator: 'a', at: 3, threads: ['at1'] }], []), null);
    assert.deepEqual(plain(nestedPlaces([{ coordinator: 'a', at: 3, threads: ['', 'at1'] }], keys).nested), [false, false, false, false, false, false, false, false, true]);
});

test('browser half: the plugin\'s mark gives way to any other mark in a row\'s leading seat, which never widens', () => {
    let css = '';
    const document = {
        addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null,
        createElement: () => ({ dataset: {} }), head: { appendChild: (tag) => { css = tag.textContent; } },
    };
    loadClient({ document });
    // Beside DSH's Automation task mark or another plugin's, in DSH's slot or in the seat itself, the plugin's mark
    // is hidden the screen-reader way (the row's description still says what it shows); alone, it is drawn. It is
    // the only rule that reaches into DSH's row, so nothing widens the seat or moves the other marks in it.
    const intoRow = css.split('}').filter((rule) => rule.includes('[data-row-key^="session:"]>'));
    assert.deepEqual(intoRow, [
        '[data-row-key^="session:"]>* .dshp-t-mark:not(:only-child),[data-row-key^="session:"]>* [data-slot]:not(:only-child)>.dshp-t-mark'
        + '{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0',
    ]);
});

test('browser half: a screen reader meets each project\'s rows in drawn order, and hears the plugin\'s words after each title', () => {
    const { client } = loadClient();
    const { nestedPlaces, nestedOrder, markNesting, readInOrder, describeRows, markUnread, undoRows } = client.internals;
    // The order the CSS draws a section in: what DSH lists before the first coordinator, then each coordinator,
    // its threads in DSH's order, and what DSH lists after it, by the orders the plugin's marks give.
    const groups = [{ coordinator: 'b', at: 6, threads: ['bt'] }, { coordinator: 'a', at: 2, threads: ['at1', 'at2'] }];
    const keys = ['x', 'a', 'y', 'at2', 'bt', 'b', 'z', 'at1', ''];
    assert.deepEqual(plain(nestedOrder(groups, keys)), [1, 2, 4, 8, 3, 6, 5, 7, 9]);
    assert.deepEqual(plain(nestedPlaces(groups, keys).order), [0, 1, 3, 2, 5, 4, 6, 2, 6]);
    // Nothing to nest, or DSH's own order already: nothing to reorder.
    assert.equal(nestedOrder([], keys), null);
    assert.equal(nestedOrder([{ coordinator: 'a', at: 1, threads: ['t'] }], ['a', 't', 'x']), null);
    assert.equal(nestedOrder(groups, []), null);

    // DSH's list: a section of wrappers, each holding a row; RowPlace's mark inside each project's row.
    const place = (role, of, words) => new FakeEl('span', { 'data-projects-row': role, 'data-projects-of': of, 'data-projects-words': words });
    const row = (key, mark, attrs = {}) => new FakeEl('div', { 'data-row-key': key, role: 'treeitem', ...attrs }, mark ? [new FakeEl('span', {}, [mark])] : []);
    const wrap = (r, attrs = {}) => new FakeEl('span', attrs, [r]);
    const rows = {
        head: row('workspace:w'), chat: row('session:chat'),
        t2: row('session:t2', place('thread', 'c', 'Project thread: Failed')), c: row('session:c', place('coordinator', 'c', 'Project')),
        late: row('session:late'), t1: row('session:t1', place('thread', 'c', 'Project thread')),
        old: row('session:old', place('thread', 'c', 'Project thread'), { 'aria-description': 'Archived' }),
    };
    const kids = [wrap(rows.head), wrap(rows.chat), wrap(rows.t2), wrap(rows.c, { id: 'dsh-own' }), wrap(rows.late), wrap(rows.t1), wrap(rows.old)];
    const section = new FakeEl('div', {}, kids);
    const tree = new FakeEl('div', { role: 'tree' }, [section]);
    // The CSS's marks: the section nests; each child its order (0 for what DSH lists before the coordinator, so only a
    // child DSH added since the last pass has none); the threads' wrappers nested. The highest order sizes the sheet.
    const marks = () => plain(kids.map((k) => [k.getAttribute('data-projects-order'), k.hasAttribute('data-projects-nested')]));
    assert.equal(markNesting(tree), 3);
    assert.equal(section.getAttribute('data-projects-nests'), '');
    assert.deepEqual(marks(), [['0', false], ['0', false], ['2', true], ['1', false], ['3', false], ['2', true], ['2', true]]);
    assert.equal(markNesting(tree), 3, 'a second pass changes nothing');
    assert.deepEqual(marks(), [['0', false], ['0', false], ['2', true], ['1', false], ['3', false], ['2', true], ['2', true]]);
    // A chat DSH adds after the coordinator has no order until the next pass, which puts it after the project.
    const fresh = wrap(row('session:fresh'));
    section.children = [...kids, fresh];
    assert.equal(fresh.getAttribute('data-projects-order'), null);
    markNesting(tree);
    assert.equal(fresh.getAttribute('data-projects-order'), '3');
    section.children = kids;
    markNesting(tree);
    assert.deepEqual(marks(), [['0', false], ['0', false], ['2', true], ['1', false], ['3', false], ['2', true], ['2', true]]);
    readInOrder(tree);
    // The section owns its children in drawn order: the coordinator, its threads, then the chat DSH lists after it.
    // A child keeps an id it has; the others get the plugin's.
    const ids = section.getAttribute('aria-owns').split(' ');
    assert.deepEqual(plain(ids.map((id) => kids.findIndex((k) => k.id === id))), [0, 1, 3, 2, 5, 6, 4]);
    assert.equal(kids[3].id, 'dsh-own');
    assert.ok(kids.filter((k, i) => i !== 3).every((k) => k.id.startsWith('dshp-o-')));
    assert.ok(section.hasAttribute('data-projects-owns'));
    // Each project row says its words as its description; a description DSH gave a row is DSH's and stays.
    describeRows(tree);
    assert.equal(rows.t2.getAttribute('aria-description'), 'Project thread: Failed');
    assert.equal(rows.c.getAttribute('aria-description'), 'Project');
    assert.equal(rows.old.getAttribute('aria-description'), 'Archived');
    assert.equal(rows.chat.getAttribute('aria-description'), null);
    // The words change with the row; DSH taking a row's description back keeps its own; words gone, description gone.
    rows.t2.children[0].children[0].setAttribute('data-projects-words', 'Project thread');
    rows.c.setAttribute('aria-description', 'Archived');
    rows.t1.children[0].children[0].setAttribute('data-projects-words', '');
    describeRows(tree);
    assert.equal(rows.t2.getAttribute('aria-description'), 'Project thread');
    assert.equal(rows.c.getAttribute('aria-description'), 'Archived');
    assert.equal(rows.c.getAttribute('data-projects-said'), null);
    assert.equal(rows.t1.getAttribute('aria-description'), null);
    // A coordinator with news the user hasn't seen: its row is marked (the CSS makes it bold), and unmarked when it's read.
    const news = rows.c.children[0].children[0];
    news.setAttribute('data-projects-unread', '2');
    markUnread(tree);
    assert.deepEqual([rows.c.getAttribute('data-projects-unread-row'), rows.t2.getAttribute('data-projects-unread-row')], ['', null]);
    news.removeAttribute('data-projects-unread');
    markUnread(tree);
    assert.equal(rows.c.hasAttribute('data-projects-unread-row'), false);
    news.setAttribute('data-projects-unread', '1');
    markUnread(tree);
    // A thread that leaves the section (or DSH drawing the project in its own order) ends the plugin's order there.
    section.children = section.children.filter((k) => k !== kids[2] && k !== kids[5] && k !== kids[6]);
    readInOrder(tree);
    assert.equal(section.getAttribute('aria-owns'), null);
    assert.equal(section.hasAttribute('data-projects-owns'), false);
    assert.equal(kids[3].id, 'dsh-own');
    assert.equal(kids[1].id, '');
    assert.equal(markNesting(tree), 0);
    assert.equal(section.hasAttribute('data-projects-nests'), false);
    assert.ok(section.children.every((k) => !k.hasAttribute('data-projects-order') && !k.hasAttribute('data-projects-nested')));
    // A list drawn as one flat list (the rows' section is the list itself) is never reordered: the CSS doesn't nest it.
    const flat = new FakeEl('div', { role: 'tree' }, [wrap(row('session:x')), wrap(row('session:t9', place('thread', 'c9', 'Project thread'))), wrap(row('session:c9', place('coordinator', 'c9', 'Project')))]);
    readInOrder(flat);
    assert.equal(flat.getAttribute('aria-owns'), null);
    assert.equal(markNesting(flat), 0);
    assert.equal(flat.hasAttribute('data-projects-nests'), false);
    assert.ok(flat.children.every((k) => !k.hasAttribute('data-projects-order') && !k.hasAttribute('data-projects-nested')));
    // Switched off: the list as DSH draws it, DSH's own descriptions kept, none of the plugin's marks.
    section.children = kids;
    markNesting(tree);
    readInOrder(tree);
    describeRows(tree);
    assert.ok(section.hasAttribute('aria-owns'));
    assert.ok(section.hasAttribute('data-projects-nests'));
    undoRows(tree);
    assert.equal(section.getAttribute('aria-owns'), null);
    assert.ok(kids.every((k, i) => i === 3 || k.id === ''));
    assert.equal(rows.t2.getAttribute('aria-description'), null);
    assert.equal(rows.old.getAttribute('aria-description'), 'Archived');
    assert.equal(rows.c.getAttribute('aria-description'), 'Archived');
    assert.equal(section.hasAttribute('data-projects-nests'), false);
    assert.deepEqual(marks(), kids.map(() => [null, false]));
    assert.equal(rows.c.hasAttribute('data-projects-unread-row'), false);
});

test('browser half: the session list overlay looks only for DSH\'s own list, and draws nothing but a refusal\'s toast', () => {
    const asked = [];
    const document = {
        addEventListener: () => {}, removeEventListener: () => {}, createElement: () => ({ dataset: {} }), head: { appendChild: () => {} },
        querySelector: (selector) => { asked.push(selector); return null; },
    };
    const { client, react } = loadClient({ document });
    asked.length = 0;
    react.useLayoutEffect = () => {};
    const { SessionList, SIDEBAR } = client.internals;
    // No list in the window yet: nothing to watch or nest, and nothing drawn.
    assert.equal(mount(react, () => SessionList({ useWorkspaces: (select) => select({ pinnedSessionIds: ['c'] }) }))(), null);
    assert.equal(mount(react, () => SessionList({}))(), null);
    assert.deepEqual([...new Set(asked)], ['[data-slot="sidebar.workspaces"] [role="tree"]']);
    // What it says when it refuses a drag speaks of projects, threads and chats only.
    assert.deepEqual(Object.keys(SIDEBAR), ['threadStays', 'chatOut', 'projectIn', 'chatStays', 'projectStays']);
    for (const text of Object.values(SIDEBAR)) assert.doesNotMatch(text, /categor/i);
});

test('browser half: a thread opens beside its coordinator, and in full view where the window is too narrow or when asked', async () => {
    const { client } = loadClient();
    const { roomFor } = client.internals;
    // DSH's own rule: a 400 px main chat and a 300 px right sidebar beside the left sidebar; under 768 px it covers the window.
    assert.equal(roomFor(1280, 280), true);
    assert.equal(roomFor(980, 280), true);
    assert.equal(roomFor(979, 280), false);
    assert.equal(roomFor(1100, 418), false);
    assert.equal(roomFor(1118, 418), true);
    assert.equal(roomFor(1713, 418), true);
    assert.equal(roomFor(768, 0), true);
    assert.equal(roomFor(767, 0), false);

    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const threadValue = { role: 'thread', coordinator: 'c', thread: { id: 't1' } };
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { coordinatorSession: value } } : {}), retainedBy: { mainView: main } });
    let snapshot = { ids: ['c', 't', 'p'], byId: { c: row(coordValue), t: row(threadValue), p: row(null, 1) }, phase: 'ready', projectionsBySession: {} };
    const listeners = new Set();
    const set = (byId) => { snapshot = { ...snapshot, byId: { ...snapshot.byId, ...byId } }; for (const fn of [...listeners]) fn(); };
    const opened = [];
    const beside = [];
    const holds = [];
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push(slot); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: {
            list: { getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
            retain: (id, options) => { holds.push([id, options.source]); set({ [id]: { ...snapshot.byId[id], retainedBy: { mainView: (snapshot.byId[id].retainedBy.mainView ?? 0) + 1 } } }); return { release: () => holds.push(['release', id]) }; },
        },
        // DSH's main view: the chat it opens takes the hold, the one before lets go.
        uiWorkspace: {
            openSession: (id) => {
                opened.push(id);
                const byId = {};
                for (const [key, value] of Object.entries(snapshot.byId)) byId[key] = { ...value, retainedBy: { mainView: key === id ? 1 : 0 } };
                set(byId);
            },
        },
        sidebarRight: { mounted: { getSnapshot: () => 'c' }, openResource: (address, options) => beside.push([decodeURIComponent(address.split('/').pop()), options.kind]) },
    };
    client.apply(ctx);
    const { projects } = registered.find((r) => r.name === 'main').inject();
    // A thread from a card, a row or the Projects page: its coordinator as the main chat, the thread beside it.
    projects.openThread('t');
    assert.deepEqual(opened, ['c']);
    assert.deepEqual(beside, [['t', 'projectthread']]);
    // Any other chat opens as itself; Full view opens the thread as the main chat.
    projects.openThread('p');
    projects.openFull('t');
    assert.deepEqual(opened, ['c', 'p', 't']);
    assert.equal(beside.length, 1);

    // DSH opening a thread itself (its session list, its search): the plugin holds the coordinator while DSH switches,
    // then the coordinator takes the thread's place and the thread opens beside it.
    ctx.uiWorkspace.openSession('p');
    opened.length = 0;
    beside.length = 0;
    set({ t: { ...snapshot.byId.t, retainedBy: { mainView: 1 } } });
    assert.deepEqual(holds, [['c', 'mainView']]);
    set({ p: { ...snapshot.byId.p, retainedBy: { mainView: 0 } } });
    assert.deepEqual(opened, ['c']);
    assert.deepEqual(holds, [['c', 'mainView'], ['release', 'c']]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(beside, [['t', 'projectthread']]);
    // A thread opened in full view stays the main chat.
    holds.length = 0;
    opened.length = 0;
    beside.length = 0;
    projects.openFull('t');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual([opened, holds, beside], [['t'], [], []]);
});

test('browser half: a thread opened beside its coordinator, or from the Threads panel, takes the place of the thread tab already there', () => {
    const { client } = loadClient();
    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const thread = (id) => ({ role: 'thread', coordinator: 'c', thread: { id } });
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { coordinatorSession: value } } : {}), retainedBy: { mainView: main } });
    const snapshot = { ids: ['c', 't1', 't2', 't3'], byId: { c: row(coordValue, 1), t1: row(thread('t1')), t2: row(thread('t2')), t3: row(thread('t3')) }, phase: 'ready', projectionsBySession: {} };
    const address = (id) => `dsh-resource://projectthread/session/${encodeURIComponent(id)}`;
    let tabs = [];
    let front;
    const placed = [];
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot) => { registered.push(slot); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, retain: () => ({ release() {} }) },
        uiWorkspace: { openSession: () => {} },
        sidebarRight: {
            mounted: { getSnapshot: () => 'c' },
            tabsIn: (id) => (id === 'c' ? tabs : []),
            active: () => front,
            openResource: (at, options) => placed.push([decodeURIComponent(at.split('/').pop()), options.kind, options.replaceTab ?? null]),
        },
    };
    client.apply(ctx);
    const { projects } = registered.find((r) => r.name === 'main').inject();
    // The first thread gets a tab; opened again, DSH brings that tab to the front.
    projects.openThread('t1');
    tabs = [{ id: 'a', kind: 'projectthread', contentId: address('t1') }];
    projects.openThread('t1');
    // Another thread takes the place of the thread tab in front, else of the newest one (here the Threads panel is in front).
    projects.openThread('t2');
    tabs = [{ id: 'a', kind: 'projectthread', contentId: address('t1') }, { id: 'p', kind: 'projectthreads', contentId: 'dsh-resource://page/projectthreads' },
        { id: 'b', kind: 'projectthread', contentId: address('t2') }];
    front = { id: 'a' };
    projects.openThread('t3');
    front = { id: 'p' };
    projects.openThread('t3');
    assert.deepEqual(placed, [['t1', 'projectthread', null], ['t1', 'projectthread', null], ['t2', 'projectthread', 'a'], ['t3', 'projectthread', 'a'], ['t3', 'projectthread', 'b']]);

    // From the Threads panel (in front, in the coordinator's sidebar): the newest thread tab gives way and the panel stays.
    placed.length = 0;
    assert.equal(projects.replaceThreadTab('c', 't3'), true);
    assert.deepEqual(placed, [['t3', 'projectthread', 'b']]);
    // The panel opens the thread its own way when there's none to replace, the thread is there already, or its sidebar isn't on screen.
    assert.equal(projects.replaceThreadTab('c', 't2'), false);
    assert.equal(projects.replaceThreadTab('t1', 't3'), false);
    tabs = [{ id: 'p', kind: 'projectthreads', contentId: 'dsh-resource://page/projectthreads' }];
    assert.equal(projects.replaceThreadTab('c', 't3'), false);
    assert.equal(placed.length, 1);
});

test('browser half: with "Open threads beside their coordinator" off, a thread opens on its own and its menus pair it', async () => {
    const storage = new Map([['dsh-plugin-coordinator/open-beside', 'off']]);
    const { client } = loadClient({ storage });
    const { besidePref } = client.internals;
    assert.equal(besidePref.get(), false);
    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const threadValue = { role: 'thread', coordinator: 'c', thread: { id: 't1' } };
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { coordinatorSession: value } } : {}), retainedBy: { mainView: main } });
    let snapshot = { ids: ['c', 't', 'p'], byId: { c: row(coordValue), t: row(threadValue), p: row(null, 1) }, phase: 'ready', projectionsBySession: {} };
    const listeners = new Set();
    const set = (byId) => { snapshot = { ...snapshot, byId: { ...snapshot.byId, ...byId } }; for (const fn of [...listeners]) fn(); };
    const opened = [];
    const beside = [];
    const holds = [];
    const registered = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: (slot, component) => { registered.push({ slot, component }); return () => {}; } },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: {
            list: { getSnapshot: () => snapshot, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } },
            retain: (id, options) => { holds.push([id, options.source]); return { release: () => holds.push(['release', id]) }; },
        },
        uiWorkspace: {
            openSession: (id) => {
                opened.push(id);
                const byId = {};
                for (const [key, value] of Object.entries(snapshot.byId)) byId[key] = { ...value, retainedBy: { mainView: key === id ? 1 : 0 } };
                set(byId);
            },
        },
        sidebarRight: { mounted: { getSnapshot: () => 'c' }, openResource: (address, options) => beside.push([decodeURIComponent(address.split('/').pop()), options.kind]) },
    };
    client.apply(ctx);
    const { projects } = registered.find((r) => r.slot.name === 'main').slot.inject();
    // A thread from a row, a card's name or the Projects page opens as the main chat, as before the setting.
    projects.openThread('t');
    assert.deepEqual([opened, beside], [['t'], []]);
    // The card's Open, and "Open beside its coordinator", still pair it.
    projects.openPaired('t');
    assert.deepEqual([opened, beside], [['t', 'c'], [['t', 'projectthread']]]);
    // DSH opening a thread itself (its session list, its search): it stays as DSH opened it.
    ctx.uiWorkspace.openSession('p');
    opened.length = 0;
    beside.length = 0;
    set({ t: { ...snapshot.byId.t, retainedBy: { mainView: 1 } } });
    set({ p: { ...snapshot.byId.p, retainedBy: { mainView: 0 } } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual([opened, holds, beside], [[], [], []]);
    // A thread's menu in the session list offers to pair it, even while it is the main chat.
    const item = registered.find((r) => r.slot.id === 'dsh-plugin-coordinator/full-view-item');
    const menuItem = () => item.component({ sessionId: 't', useMenuOpenState: () => [true, () => {}], useSessions: (select) => select(snapshot), ...item.slot.inject() });
    let shown = menuItem();
    assert.deepEqual(shown.children, ['Open beside its coordinator']);
    shown.props.onSelect();
    assert.deepEqual([opened, beside], [['c'], [['t', 'projectthread']]]);

    // Turned on (the plugin page's switch): kept for the next start, and threads pair again.
    besidePref.set(true);
    assert.equal(storage.get('dsh-plugin-coordinator/open-beside'), 'on');
    shown = menuItem();
    assert.deepEqual(shown.children, ['Open in full view']);
    opened.length = 0;
    beside.length = 0;
    projects.openThread('t');
    assert.deepEqual([opened, beside], [['c'], [['t', 'projectthread']]]);
    besidePref.set(false);
    assert.equal(storage.get('dsh-plugin-coordinator/open-beside'), 'off');
    // No storage at all (a locked-down window): on.
    assert.equal(loadClient().client.internals.besidePref.get(), true);
});

test('browser half: a click on a thread row in DSH\'s session list opens the pair straight away, so DSH never shows the thread first', () => {
    let onClick;
    const document = {
        addEventListener: (type, fn, capture) => { if (type === 'click' && capture === true) onClick = fn; },
        removeEventListener: () => {}, querySelector: () => null,
        createElement: () => ({ dataset: {} }), head: { appendChild: () => {} },
    };
    const storage = new Map();
    const { client, window } = loadClient({ document, innerWidth: 1440, storage });
    const coordValue = { role: 'coordinator', project: { name: 'P' }, threads: [] };
    const threadValue = { role: 'thread', coordinator: 'c', thread: { id: 't1' } };
    const row = (value, main = 0) => ({ title: 'x', ...(value ? { projectionValues: { coordinatorSession: value } } : {}), retainedBy: { mainView: main } });
    const snapshot = { ids: ['c', 't', 'p'], byId: { c: row(coordValue), t: row(threadValue), p: row(null, 1) }, phase: 'ready', projectionsBySession: {} };
    const opened = [];
    const beside = [];
    const ctx = {
        effect: (fn) => fn(),
        inject: (names, fn) => { if (!names.includes('configForms')) fn(ctx); },
        slots: { inject: (_name, fn) => fn(), register: () => () => {} },
        resources: { register: () => () => {} },
        sidebarRightTabs: { register: () => () => {} },
        sessions: { list: { getSnapshot: () => snapshot, subscribe: () => () => {} }, retain: () => ({ release: () => {} }) },
        uiWorkspace: { openSession: (id) => opened.push(id) },
        sidebarRight: { mounted: { getSnapshot: () => 'c' }, openResource: (address, options) => beside.push([decodeURIComponent(address.split('/').pop()), options.kind]) },
    };
    client.apply(ctx);
    assert.equal(typeof onClick, 'function', 'one capturing listener for the whole window');
    // A click on a row of DSH's list (data-row-key="session:<id>"), or on a button inside it.
    const click = (id, { inButton = false, ...event } = {}) => {
        const rowEl = { getAttribute: (name) => (name === 'data-row-key' ? `session:${id}` : null), contains: () => true };
        const target = { closest: (selector) => (selector.includes('data-row-key') ? rowEl : inButton ? { button: true } : null) };
        const e = { button: 0, defaultPrevented: false, target, prevented: false, stopped: false, ...event };
        e.preventDefault = () => { e.prevented = true; };
        e.stopPropagation = () => { e.stopped = true; };
        onClick(e);
        return e.prevented && e.stopped;
    };
    // A thread: its coordinator as the main chat and the thread beside it, without DSH opening the thread first.
    assert.equal(click('t'), true);
    assert.deepEqual([opened, beside], [['c'], [['t', 'projectthread']]]);
    // DSH's as before: another chat, the row's own buttons, a modifier key, another mouse button, a click already handled.
    opened.length = 0;
    beside.length = 0;
    assert.deepEqual([click('p'), click('t', { inButton: true }), click('t', { metaKey: true }), click('t', { button: 1 }), click('t', { defaultPrevented: true })],
        [false, false, false, false, false]);
    // Also when the window has no room for both, or the setting is off.
    window.innerWidth = 700;
    assert.equal(click('t'), false);
    window.innerWidth = 1440;
    client.internals.besidePref.set(false);
    assert.equal(click('t'), false);
    client.internals.besidePref.set(true);
    // And for the thread that is already the main chat (full view).
    snapshot.byId = { ...snapshot.byId, t: row(threadValue, 1), p: row(null, 0) };
    assert.equal(click('t'), false);
    assert.deepEqual([opened, beside], [[], []]);
});

test('browser half: a thread\'s newest card says when its last turn ended, and how many times in a row', () => {
    const { client } = loadClient();
    const { ThreadCard, clockOf, againText } = client.internals;
    const now = Date.parse('2026-10-10T18:30:00');
    assert.deepEqual([clockOf(Date.parse('2026-10-10T14:58:00'), now), clockOf(Date.parse('2026-10-09T09:05:00'), now), clockOf(Date.parse('2025-12-31T23:59:00'), now), clockOf(NaN, now)],
        ['14:58', 'Oct 9, 09:05', 'Dec 31, 2025, 23:59', '']);
    assert.deepEqual([1, 2, 3, undefined].map(againText), ['', 'twice', '3 times', '']);
    const at = new Date(Date.now() - 60000);
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    const projects = { openThread: () => {}, openPaired: () => {}, openFull: () => {}, openReview: () => {}, facts: { continueThread: async () => ({ ok: true }) } };
    const view = (ending, state) => ({
        key: 't7', kind: 'idle', threadId: 't7', seq: 5, newest: true, title: 'Generate size-guide tables', session: 's-t7', verb: 'Ended without a handback', icon: 'IconWarningTriangleOutlineRegular',
        state, row: { id: 't7', session: 's-t7', title: 'Generate size-guide tables', ending },
    });
    const failed = { state: 'failed', kind: 'error', message: 'The model rejected the request.', turn: 3, seq: 9, at: at.toISOString() };
    // Failed once: the state once, beside the name; the time and the reason under it; Retry.
    let card = ThreadCard({ view: view(failed, { dot: 'error', label: 'Failed' }), projects });
    assert.deepEqual([textIn(byClass(card, 'dshp-t-card-state-label')), textIn(byClass(card, 'dshp-t-card-state-text')), textIn(byClass(card, 'dshp-t-card-why'))],
        ['Failed', 'Failed', `${hhmm} · The model rejected the request.`]);
    assert.equal(elementsOf(card).find((e) => e.props?.['data-projects-continue'])?.props['data-projects-continue'], 'retry');
    // Retried and failed again: it says so, and the time moves on.
    card = ThreadCard({ view: view({ ...failed, times: 2, turn: 4 }, { dot: 'error', label: 'Failed' }), projects });
    assert.deepEqual([textIn(byClass(card, 'dshp-t-card-state-label')), textIn(byClass(card, 'dshp-t-card-state-text'))], ['Failed', 'Failed twice']);
    // Stopped by the user: when, and that they did.
    card = ThreadCard({ view: view({ state: 'stopped', kind: 'aborted', cause: 'user', turn: 3, seq: 9, at: at.toISOString() }, { dot: 'idle', label: 'Stopped' }), projects });
    assert.equal(textIn(byClass(card, 'dshp-t-card-why')), `${hhmm} · You stopped it.`);
    // Stopped with no reason to give: just when.
    card = ThreadCard({ view: view({ state: 'stopped', kind: 'aborted', turn: 3, seq: 9, at: at.toISOString() }, { dot: 'idle', label: 'Stopped' }), projects });
    assert.equal(textIn(byClass(card, 'dshp-t-card-why')), hhmm);
    // A card that isn't the thread's newest says none of it.
    card = ThreadCard({ view: { ...view(failed, { dot: 'error', label: 'Failed' }), newest: false }, projects });
    assert.deepEqual([byClass(card, 'dshp-t-card-why').length, textIn(byClass(card, 'dshp-t-card-state-text'))], [0, 'Failed']);
});

test('browser half: a thread\'s newest card says what it is doing (its step, how far along, how long) or what it reported, never its state twice', () => {
    const { client } = loadClient();
    const { ThreadCard, CardDetail, progressOf, elapsedText, handbackGist, cardDetail, threadRow, pendingAsk } = client.internals;
    const todos = [
        { content: 'Build the fr-FR glossary', status: 'completed' }, { content: 'Translate pages 1–120', status: 'completed' },
        { content: 'Translate   pages 121–240', status: 'in_progress' }, { content: 'Review size names', status: 'pending' },
    ];
    // DSH's to-do list: how many are done, and the step in progress.
    assert.deepEqual(plain(progressOf(todos)), { done: 2, total: 4, current: 'Translate pages 121–240' });
    assert.deepEqual(plain(progressOf([{ content: 'A', status: 'completed' }, { content: ' ', status: 'pending' }, null, { status: 'pending' }])), { done: 1, total: 1 });
    assert.deepEqual([progressOf(null), progressOf([]), progressOf('x')], [undefined, undefined, undefined]);
    assert.deepEqual([0, 45000, 192000, 3840000, -1, NaN].map(elapsedText), ['0s', '45s', '3m 12s', '1h 4m', '', '']);
    // A handback's summary without its state ahead of it.
    assert.deepEqual([
        handbackGist({ status: 'blocked', summary: 'Blocked: the CDN token\n expired.' }), handbackGist({ status: 'done', summary: 'Done' }),
        handbackGist({ status: 'done', summary: 'Doneness checks pass.' }), handbackGist({ status: 'needs_decision', summary: 'Fix A or fix B?' }), handbackGist({}),
    ], ['The CDN token expired.', '', 'Doneness checks pass.', 'Fix A or fix B?', '']);

    const T = Date.parse('2026-10-11T12:00:00Z');
    const row = (extra) => ({ id: 't10', session: 's10', title: 'Translate product pages', entry: { id: 't10' }, ...extra });
    const view = (r, extra = {}) => ({ key: 't10', kind: 'start', threadId: 't10', seq: 4, newest: true, title: r.title, session: 's10', verb: 'Started a thread', icon: 'IconBranchOutlineRegular', state: { dot: 'ongoing', label: 'Running' }, row: r, ...extra });
    // Running: its step, how far along and how long its turn has run.
    const running = row({ running: true });
    assert.deepEqual(plain(cardDetail(view(running), { todos, turnAt: T - 192000 }, T)), { kind: 'running', progress: { done: 2, total: 4, current: 'Translate pages 121–240' }, step: 'Translate pages 121–240', elapsed: '3m 12s' });
    // Without a list: its progress handback, else only the time; with nothing at all, no line.
    const progressing = row({ running: true, entry: { id: 't10', handback: { status: 'progress', summary: 'Progress update: halfway, 120 of 240.' } } });
    assert.deepEqual(plain(cardDetail(view(progressing), { turnAt: T - 5000 }, T)), { kind: 'running', step: 'Halfway, 120 of 240.', elapsed: '5s' });
    assert.deepEqual(plain(cardDetail(view(running), { turnAt: T }, T)), { kind: 'running', elapsed: '0s' });
    assert.equal(cardDetail(view(running), undefined, T), undefined);
    // Reported: what it said. Waiting on you: what it asks, and that it waits unless the card says so already. A failed or stopped turn has its own line.
    const told = row({ entry: { id: 't10', handback: { status: 'blocked', summary: 'Blocked: the CDN token expired.' } } });
    assert.deepEqual(plain(cardDetail(view(told), undefined, T)), { kind: 'told', text: 'The CDN token expired.' });
    const waiting = row({ running: true, pending: true, pendingInteraction: { kind: 'approval' } });
    assert.deepEqual(plain(cardDetail(view(waiting), { todos, turnAt: T }, T)), { kind: 'pending', text: 'Waiting for your approval' });
    assert.equal(cardDetail(view(waiting, { kind: 'approval' }), undefined, T), undefined);
    // What it asks is what DSH's prompt says: an approval's reason, a question.
    const reason = { kind: 'approval', toolName: 'shell', reason: 'escalate sandbox', displayReason: { en: 'Allow this operation with\n full access: npm install stripe', zh: '…' } };
    const asking = row({ running: true, pending: true, pendingInteraction: reason });
    assert.deepEqual(plain(cardDetail(view(asking), undefined, T)), { kind: 'pending', text: 'Waiting for your approval · Allow this operation with full access: npm install stripe' });
    assert.deepEqual(plain(cardDetail(view(asking, { kind: 'approval' }), undefined, T)), { kind: 'pending', text: 'Allow this operation with full access: npm install stripe' });
    assert.deepEqual([
        pendingAsk({ kind: 'approval', reason: ' tool "shell" requires approval ' }), pendingAsk({ kind: 'question', questions: [{ id: 'a', question: ' ' }, { id: 'b', question: 'Ship fix A or fix B?' }] }),
        pendingAsk({ kind: 'question', questions: [] }), pendingAsk({ kind: 'approval' }), pendingAsk(undefined),
    ], ['tool "shell" requires approval', 'Ship fix A or fix B?', '', '', '']);
    assert.equal(cardDetail(view(row({ ending: { state: 'failed' }, entry: told.entry })), undefined, T), undefined);

    // Drawn: a meter with how many steps are done, the step, and the clock; the reader hears it as words.
    const line = CardDetail({ detail: cardDetail(view(running), { todos, turnAt: T - 192000 }, T) });
    const meter = elementsOf(line).find((e) => e.props?.role === 'progressbar');
    assert.deepEqual(plain([line.props['data-projects-card-detail'], line.props.title, meter.props['aria-valuenow'], meter.props['aria-valuemax'], meter.props['aria-valuetext'], meter.children[0].props.style.width]),
        ['running', '2 of 4 steps done · Translate pages 121–240 · running 3m 12s', 2, 4, '2 of 4', '50%']);
    assert.deepEqual([textIn(byClass(line, 'dshp-t-card-count')), textIn(byClass(line, 'dshp-t-card-step')), textIn(byClass(line, 'dshp-t-card-elapsed'))], ['2/4', 'Translate pages 121–240', '3m 12s']);
    assert.equal(textIn(line), '2/4·Translate pages 121–240·3m 12s');
    // On the card: under its name, only on the thread's newest card; no word twice.
    const projects = { openThread: () => {}, openPaired: () => {}, openFull: () => {}, facts: { continueThread: async () => ({ ok: true }) } };
    const detailOf = (c) => elementsOf(c).find((e) => e.type === CardDetail);
    let card = ThreadCard({ view: { ...view(told, { state: { dot: 'blocked', label: 'Blocked' } }) }, projects });
    const drawn = CardDetail(detailOf(card).props);
    assert.deepEqual([textIn(drawn), drawn.props['data-projects-card-detail']], ['The CDN token expired.', 'told']);
    const words = `${textIn(card)} ${textIn(drawn)}`.toLowerCase().match(/[a-z]+/g);
    assert.equal(new Set(words).size, words.length, `a word twice: ${words.join(' ')}`);
    card = ThreadCard({ view: { ...view(told), newest: false }, projects });
    assert.equal(detailOf(card), undefined);
    // A failed turn's own line wins over it.
    card = ThreadCard({ view: view(row({ ending: { state: 'failed', kind: 'error', message: 'No key.', at: new Date().toISOString() }, entry: told.entry }), { state: { dot: 'error', label: 'Failed' } }), projects });
    assert.deepEqual([detailOf(card), byClass(card, 'dshp-t-card-why').length], [undefined, 1]);

    // The Threads menu and panel: a running row with a list says how far along it is.
    const statuses = new Map([['s10', { running: true }]]);
    const live = { s10: { todos, turnAt: T } };
    assert.equal(threadRow({ id: 't10', session: 's10', title: 'Translate' }, statuses, {}, {}, live).line, '2/4 · Translate pages 121–240');
    assert.equal(threadRow({ id: 't10', session: 's10', title: 'Translate' }, statuses, {}, {}, { s10: { todos: [{ content: 'A', status: 'completed' }] } }).line, '1 of 1 steps done');
    assert.equal(threadRow({ id: 't10', session: 's10', title: 'Translate' }, statuses, {}, {}, undefined).line, 'Working…');
    // And a row waiting on you says what it asks.
    const asked = new Map([['s10', { running: true, pendingInteraction: { kind: 'question', questions: [{ id: 'q', question: 'Which locale first?' }] } }]]);
    assert.equal(threadRow({ id: 't10', session: 's10', title: 'Translate' }, asked, {}, {}, live).line, 'Has a question for you · Which locale first?');
});

test('browser half: the plugin\'s messages get a notice that names them, without the note to the coordinator', () => {
    const { client } = loadClient();
    const { noticeOf } = client.internals;
    const data = (text, kind = 'agent-message') => ({ content: [{ type: 'text', text }], source: { kind }, time: 1 });
    const handback = handbackMessage('t1', 'Add CI', 'done', 'CI added.', { last: true });
    assert.deepEqual(plain(noticeOf(data(handback))), { kind: 'handback', thread: 't1', name: 'Add CI', status: 'done', body: 'CI added.' });
    assert.deepEqual(plain(noticeOf(data(idleMessage('t3', 'Flaky', '', 'The turn failed (HTTP 500): boom'), 'cordis-host-runner'))),
        { kind: 'idle', thread: 't3', name: 'Flaky', status: 'failed', body: 'The turn failed (HTTP 500): boom\n\nIt produced no reply text.' });
    assert.equal(noticeOf(data(approvalMessage('t4', 'Deploy', 'Deploy', 'shell', 'rm -rf build'), 'cordis-host-runner')).body,
        'It asked to use shell: rm -rf build\n\nThe user approves or rejects it in the "Deploy" session.');
    assert.equal(noticeOf(data(welcomeMessage('Recipes', ''), 'cordis-host-runner')).kind, 'welcome');
    // A message from another project's coordinator, and the answer it brings back.
    assert.deepEqual(plain(noticeOf(data(outsideMessage('DSH Plugins', 'Tell Fix login.', 'Main is green.')))),
        { kind: 'message', project: 'DSH Plugins', body: 'The user asked: "Tell Fix login."\n\nMain is green.' });
    assert.deepEqual(plain(noticeOf(data(replyMessage('"Fix login"', 'Thanks.')))), { kind: 'reply', name: 'Fix login', status: '', body: 'Thanks.' });
    assert.deepEqual(plain(noticeOf(data(replyMessage('◆ Storefront', '', 'The turn failed (HTTP 500): down')))),
        { kind: 'reply', name: '◆ Storefront', status: 'failed', body: 'The turn failed (HTTP 500): down\n\nIt answered without text.' });
    // The user's own words, and other agents' messages, keep DSH's own notice.
    assert.equal(noticeOf(data(handback, 'user')), undefined);
    assert.equal(noticeOf(data('A message from another agent.')), undefined);
});

test('browser half: one store of what the plugin says about projects, shared by the views and read while they watch', async () => {
    const { client } = loadClient();
    const { projectFacts, pausedText, withHeld, SUGGESTIONS, suggestionsFor } = client.internals;
    const calls = [];
    let paused = true;
    const project = () => ({
        project: { id: 'p1', name: 'P', coordinator: 'c1' }, settings: {},
        paused: { value: paused, source: 'project setting', inherited: false, held: paused ? 2 : 0 },
        threads: [{ id: 't1', session: 's1' }],
    });
    const link = {
        async call(method, args) {
            calls.push(method);
            if (method === 'describe') return { ok: true, value: project() };
            if (method === 'list') return { ok: true, value: { projects: [{ id: 'p1', coordinator: 'c1', paused }, { id: 'p2', coordinator: 'c2', paused: false }] } };
            if (method === 'update' && args.target === 'c1') { paused = args.changes.paused; return { ok: true, value: project() }; }
            return { ok: false, error: { code: 'coordinator/refused', message: 'no' } };
        },
    };
    const facts = projectFacts(link);
    let changes = 0;
    facts.subscribe(() => { changes += 1; });
    assert.equal(facts.paused('c1'), undefined, 'unknown until read');
    // A thread's session reads its project; the coordinator and the other threads share it.
    await facts.describe('s1');
    assert.equal(facts.info('s1').project.id, 'p1');
    assert.equal(facts.info('c1'), facts.info('s1'));
    assert.equal(facts.paused('c1'), true);
    await facts.describe('s1', 60000);
    assert.deepEqual(calls, ['describe'], 'a fresh read is not repeated');
    // The list covers every coordinator, the session list's paused marks.
    await facts.list();
    assert.deepEqual([facts.paused('c1'), facts.paused('c2'), facts.paused('c3')], [true, false, undefined]);
    // A change answers with the project, and every view shows it at once.
    const before = changes;
    assert.equal((await facts.change('c1', { paused: false })).ok, true);
    assert.equal(facts.paused('c1'), false);
    assert.equal(facts.info('s1').paused.held, 0);
    assert.ok(changes > before);
    assert.equal((await facts.change('c2', { paused: false })).ok, false);
    // A watch reads now (unless just read) and every 15 s; the last unwatch stops the timer, so this test can end.
    const fresh = projectFacts(link);
    const stop = fresh.watch('list');
    const again = fresh.watch('list');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(fresh.paused('c2'), false);
    stop();
    again();
    assert.equal(typeof fresh.watch(''), 'function');
    // What a pause means where it shows.
    assert.equal(pausedText('coordinator', 0), 'New threads and handbacks wait until you resume.');
    assert.equal(pausedText('coordinator', 1), '1 message held until you resume. New threads wait too.');
    assert.equal(pausedText('coordinator', 2, 2), '2 handbacks held until you resume. New threads wait too.');
    assert.equal(pausedText('thread', 3), 'This thread\'s handbacks wait until the project resumes.');
    assert.equal(SUGGESTIONS.length, 3);
    // A project in the user's home folder gets first asks that don't send anyone through all of it; none until describe answers.
    assert.equal(suggestionsFor(null), null);
    assert.equal(suggestionsFor(project()), SUGGESTIONS);
    const home = suggestionsFor({ project: { id: 'p1', homeFolder: true } });
    assert.ok(home.length >= 2 && home.every((text) => !/look around|this folder|the code/i.test(text)), home.join(' | '));
    // A thread whose handback the pause holds says so, instead of "No handback yet"; running and resolved rows keep theirs.
    const rows = [{ id: 't1', group: 'idle', line: 'No handback yet' }, { id: 't2', group: 'running', line: 'Working…' }, { id: 't3', group: 'idle', line: 'No handback yet' }];
    assert.equal(withHeld(rows, []), rows);
    assert.deepEqual(plain(withHeld(rows, [{ thread: 't1', status: 'done' }, { thread: 't2', status: 'blocked' }]).map((r) => r.line)),
        ['Done · held until you resume', 'Working…', 'No handback yet']);
    // And sits where that handback puts it: Done, or Waiting on you for a decision or a block.
    assert.deepEqual(plain(withHeld(rows, [{ thread: 't1', status: 'done' }, { thread: 't3', status: 'needs_decision' }]).map((r) => [r.group, r.dot, r.stateLabel])),
        [['done', 'done', 'Done'], ['running', null, null], ['waiting', 'warning', 'Needs a decision']]);
});

test('browser half: news from threads marks the ◆ row and shows one notice for the newest, until the coordinator is opened', async () => {
    const { client } = loadClient();
    const { projectFacts, NewsNotice, ThreadMark, RowPlace, newsLine, newsDot, takeKnown } = client.internals;
    takeKnown({});
    let seq = 1;
    let seen = 0;
    let items = [{ seq: 1, kind: 'handback', thread: 't1', title: 'Old news', status: 'done', at: '2026-10-11T01:00:00Z' }];
    const calls = [];
    const answer = () => ({ ok: true, value: { news: [
        { project: 'p1', name: 'Shop', coordinator: 'c1', seq, seen, unread: items.filter((i) => i.seq > seen) },
        { project: 'p2', name: 'Quiet', coordinator: 'c2', seq: 0, seen: 0, unread: [] },
    ] } });
    const link = {
        async call(method, args) {
            calls.push([method, args]);
            if (method === 'news') return answer();
            if (method === 'seeNews') { seen = args.seq; return answer(); }
            return { ok: false, error: { code: 'coordinator/refused', message: 'no' } };
        },
    };
    const facts = projectFacts(link);
    const closed = () => false;
    // The first read only learns where each coordinator is: what was already waiting marks the row, with no notice.
    await facts.news(closed);
    assert.equal(facts.notice(), null);
    assert.deepEqual(plain(facts.newsOf('c1').unread.map((i) => i.seq)), [1]);
    assert.equal(facts.newsOf('c2'), undefined);
    // What comes next, while the user looks elsewhere, is the notice: the newest, and how many more.
    seq = 3;
    items = [...items, { seq: 2, kind: 'finished', thread: 't2', title: 'Docs', at: '2026-10-11T01:05:00Z' },
        { seq: 3, kind: 'approval', thread: 't1', title: 'Deploy', at: '2026-10-11T01:06:00Z' }];
    await facts.news(closed);
    assert.deepEqual(plain(facts.notice()), { key: 'c1:3', coordinator: 'c1', name: 'Shop', item: items[2], more: 1 });
    // A notice the same read already showed is not shown twice; one the user dismissed stays gone.
    facts.dropNotice('c1:3');
    await facts.news(closed);
    assert.equal(facts.notice(), null);
    // With the coordinator open, news arrives in front of the user: no notice.
    seq = 4;
    items = [...items, { seq: 4, kind: 'failed', thread: 't1', title: 'Deploy', at: '2026-10-11T01:07:00Z' }];
    await facts.news((id) => id === 'c1');
    assert.equal(facts.notice(), null);

    // The row: a dot in the leading seat that says what came, and a mark the CSS reads to make the title bold.
    const state = { byId: { c1: { title: '◆ Shop', projectionValues: { coordinatorSession: { role: 'coordinator', project: { name: 'Shop' }, threads: [] } } } } };
    const useSessions = (select) => select(state);
    const projects = { facts, refresh() {} };
    const mark = ThreadMark({ sessionId: 'c1', useSessions, projects });
    assert.equal(mark.props['data-projects-news-mark'], 4);
    assert.equal(mark.props.title, '4 new, latest: “Deploy” failed');
    assert.equal(mark.children[0].props.state, 'error');
    // The dot is drawn only; a screen reader hears the news after the title, from the row's words.
    assert.equal(mark.props['aria-hidden'], true);
    assert.equal(mark.props['aria-label'], undefined);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-unread'], 4);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-words'], 'Project, 4 new, latest: “Deploy” failed');
    // Opening the coordinator sees everything the window knew of, at once, and the plugin keeps it seen.
    await facts.seeNews('c1');
    assert.deepEqual(plain(calls.at(-1)), ['seeNews', { target: 'c1', seq: 4 }]);
    assert.equal(facts.newsOf('c1'), undefined);
    assert.equal(ThreadMark({ sessionId: 'c1', useSessions, projects }), null);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-unread'], undefined);
    assert.equal(RowPlace({ sessionId: 'c1', useSessions, projects }).props['data-projects-words'], 'Project');
    await facts.seeNews('c1');
    assert.equal(calls.filter(([m]) => m === 'seeNews').length, 1, 'nothing unread: no call');

    // The notice is DSH's own banner, with Open; a thread waiting on the user reads as a warning, a result as done.
    seq = 5;
    items = [...items, { seq: 5, kind: 'handback', thread: 't2', title: 'Docs', status: 'done', at: '2026-10-11T01:08:00Z' }];
    await facts.news(closed);
    const opened = [];
    const toast = NewsNotice({ projects: { facts, openSession: (id) => opened.push(id) } });
    assert.equal(toast.props.text, '◆ Shop: “Docs” handed back.');
    assert.equal(toast.props.tone, 'success');
    assert.equal(toast.props.actions[0].label, 'Open');
    toast.props.actions[0].onClick();
    assert.deepEqual(opened, ['c1']);
    assert.equal(facts.notice(), null);
    assert.equal(NewsNotice({ projects: { facts } }), null);
    assert.deepEqual(['blocked', 'needs_decision', 'done'].map((status) => newsLine({ kind: 'handback', title: 'X', status })),
        ['“X” is blocked', '“X” needs a decision', '“X” handed back']);
    assert.deepEqual([[{ kind: 'handback', status: 'done' }], [{ kind: 'finished' }, { kind: 'stopped' }], [{ kind: 'approval' }, { kind: 'failed' }]].map(newsDot),
        ['done', 'warning', 'error']);
});

test('browser half: a plain chat in a project\'s workspace offers its coordinator, which opens in one click with what the user typed', () => {
    const storage = new Map();
    const { client } = loadClient({ storage });
    const { CoordinatorOffer, workspaceOfSession, projectIn, takeKnown } = client.internals;
    takeKnown({});
    const state = {
        byId: {
            c1: { title: '◆ Shop', projectionValues: { coordinatorSession: { role: 'coordinator', project: { name: 'Shop' }, threads: [] } } },
            t1: { title: 'Fix cart', projectionValues: { coordinatorSession: { role: 'thread', coordinator: 'c1', thread: { id: 't1' } } } },
            chat: { title: 'Smoke test' }, fresh: { title: '', blank: true }, team: { title: 'Teammate', parentId: 'chat' }, far: { title: 'Elsewhere' },
        },
    };
    const workspaces = { items: [
        { workspaceId: 'w-shop', path: '/u/shop', sessionIds: ['c1', 't1', 'chat', 'fresh', 'team'] },
        { workspaceId: 'w-notes', path: '/u/notes', sessionIds: ['far'] },
    ] };
    const listed = [{ id: 'old', name: 'Old', coordinator: null, home: 'w-notes' }, { id: 'shop', name: 'Shop', coordinator: 'c1', home: 'w-shop' }];
    assert.equal(workspaceOfSession(workspaces, 'chat'), 'w-shop');
    assert.equal(workspaceOfSession(workspaces, 'nowhere'), undefined);
    assert.equal(projectIn(listed, 'w-shop').id, 'shop');
    assert.equal(projectIn(listed, 'w-notes'), undefined, 'a project with no coordinator offers nothing');
    const opened = [];
    const cleared = [];
    const projects = {
        facts: { subscribe: () => () => {}, getSnapshot: () => 0, projects: () => listed, list: async () => {} },
        openWithDraft: (id, text) => opened.push([id, text]),
    };
    const offer = (sessionId, draft = '') => CoordinatorOffer({
        sessionId, projects, useSessions: (select) => select(state), useWorkspaces: (select) => select(workspaces),
        useInput: (select) => select({ draft }), inputActions: { setDraft: (text) => cleared.push(text) },
    });
    // A new chat, or one with messages, in the workspace where ◆ Shop works: the offer, with one button.
    for (const id of ['fresh', 'chat']) {
        const bar = offer(id);
        assert.equal(bar.props['data-projects-offer'], 'shop');
        assert.match(textIn(bar), /This folder has a project\.Its coordinator runs the work in threads\.Talk to ◆ Shop/);
    }
    // What the user typed goes with them, and leaves this chat's box.
    const button = elementsOf(offer('chat', '  run the smoke test  ')).find((el) => el.props?.['data-projects-offer-open'] === '');
    assert.match(textIn(offer('chat', 'x')), /What you typed goes with you\./);
    button.props.onClick();
    assert.deepEqual(plain(opened), [['c1', 'run the smoke test']]);
    assert.deepEqual(plain(cleared), ['']);
    elementsOf(offer('fresh')).find((el) => el.props?.['data-projects-offer-open'] === '').props.onClick();
    assert.deepEqual(plain(opened.at(-1)), ['c1', '']);
    assert.equal(cleared.length, 1, 'an empty box is left alone');
    // Not on the coordinator, its threads, a teammate DSH started under a chat, or a chat in a folder without a project.
    for (const id of ['c1', 't1', 'team', 'far']) assert.equal(offer(id), null, id);
    // Nor for an archived project, or one whose ◆ row DSH has archived before the plugin's list says so.
    assert.equal(projectIn([{ ...listed[1], archived: true }], 'w-shop'), undefined);
    assert.equal(projectIn(listed, 'w-shop', new Set(['c1'])), undefined);
    workspaces.archivedSessionIds = ['c1'];
    assert.equal(offer('chat'), null);
    delete workspaces.archivedSessionIds;
    assert.equal(offer('chat').props['data-projects-offer'], 'shop');
    // Turned off for the folder: gone there, and only there.
    storage.set('dsh-plugin-coordinator/offer-off', JSON.stringify(['w-shop']));
    assert.equal(offer('chat'), null);
});

test('browser half: a thread\'s changes read as DSH\'s card counts them, and its projection says when to read them again', () => {
    const { client } = loadClient();
    const { changesOf, changesText, lastChange, REVIEW_PREFIX } = client.internals;
    const changes = { added: 18, deleted: 3, files: 2, turns: 1, last: { seq: 12, turn: 2 }, reviewable: true };
    assert.equal(changesOf(changes), changes);
    for (const bad of [null, undefined, 'x', { added: 1, deleted: 0, files: 0 }, { added: '1', deleted: 0, files: 1 }]) assert.equal(changesOf(bad), undefined);
    assert.equal(changesText(changes), '2 files changed: 18 lines added, 3 deleted');
    assert.equal(changesText({ ...changes, files: 1, added: 1 }), '1 file changed: 1 line added, 3 deleted');
    assert.equal(lastChange({ role: 'thread', changes: [{ turn: 1, seq: 9 }, { turn: 2, seq: 15 }] }), '15');
    assert.equal(lastChange({ role: 'thread' }), '');
    assert.equal(lastChange(undefined), '');
    // DSH's own Review tab, as its "Edited N files" card opens it.
    assert.equal(REVIEW_PREFIX, 'dsh-resource://changes-review/session/');
});

test('browser half: a file in a Changes tab shows what its edits came to, each edit a click away', () => {
    const { client } = loadClient({ primitives: { DiffBlock: 'DiffBlock', PathLabel: 'PathLabel', FileTypeIcon: 'FileTypeIcon', Tooltip: 'Tooltip' } });
    const { ChangedFile, shownCounts } = client.internals;
    const edits = [
        { turn: 1, seq: 3, added: 3, deleted: 0, created: true, hunks: [{ oldText: null, newText: 'one\ntwo\nthree\n' }] },
        { turn: 2, seq: 7, added: 1, deleted: 1, hunks: [{ oldText: 'two', newText: 'TWO' }] },
    ];
    const file = { path: 'notes.md', added: 4, deleted: 1, created: true, edits, net: { added: 3, deleted: 0, created: true, hunks: [{ oldText: null, newText: 'one\nTWO\nthree' }] } };
    let asked = 0;
    const draw = (f, each = false) => ChangedFile({ file: f, open: true, onToggle() {}, each, onEach: () => { asked += 1; } });
    const find = (tree, attr, value = '') => elementsOf(tree).find((e) => e.props?.[attr] === value);
    let out = draw(file);
    // Its head, and the tab's totals, count what the edits came to; the edits' own sum is theirs.
    assert.equal(find(out, 'className', 'dshp-ch-file-toggle').props['aria-label'], 'notes.md (new): 3 lines added, 0 deleted');
    assert.deepEqual(plain(shownCounts(file)), plain(file.net));
    assert.equal(shownCounts({ ...file, net: undefined }).added, 4);
    // One diff, of what the edits came to; the edits fold under "Each edit (2)".
    assert.deepEqual(plain(elementsOf(find(out, 'data-projects-changes-net')).find((e) => e.type === 'DiffBlock').props.diffs), [{ path: 'notes.md', oldText: null, newText: 'one\nTWO\nthree' }]);
    assert.equal(elementsOf(out).filter((e) => e.type === 'DiffBlock').length, 1);
    const each = find(out, 'data-projects-changes-each');
    assert.deepEqual([textIn(each), each.props['aria-expanded'], each.props['aria-controls']], ['Each edit (2)', false, undefined]);
    each.props.onClick();
    assert.equal(asked, 1);
    out = draw(file, true);
    const opened = find(out, 'data-projects-changes-edits');
    assert.equal(find(out, 'data-projects-changes-each').props['aria-controls'], opened.props.id);
    assert.deepEqual(plain(elementsOf(opened).filter((e) => e.type === 'DiffBlock').map((d) => d.props.diffs.map((x) => x.newText))), [['one\ntwo\nthree\n'], ['TWO']]);
    assert.deepEqual(byClass(opened, 'dshp-ch-edit-head').map(textIn), ['Edit 1 · Turn 1+3-0', 'Edit 2 · Turn 2+1-1']);
    // Edits that undid each other, and a file changed since, say so.
    out = draw({ ...file, created: false, net: { added: 0, deleted: 0, hunks: [], undone: true, since: true } });
    assert.equal(find(out, 'className', 'dshp-ch-file-toggle').props['aria-label'], 'notes.md: 0 lines added, 0 deleted');
    assert.deepEqual(byClass(find(out, 'data-projects-changes-net'), 'dshp-ch-note').map(textIn), [
        'Its edits undid each other: the file is as it was before.',
        'The file has changed since these edits. This is how they left it.',
    ]);
    // No lines changed for another reason: only line endings or the last newline, or a new, empty file; one edit.
    const sameOf = (f) => byClass(find(draw(f), 'data-projects-changes-net'), 'dshp-ch-note').map(textIn);
    assert.deepEqual(sameOf({ ...file, created: false, net: { added: 0, deleted: 0, hunks: [], endings: true } }), ['Only line endings or the last newline changed.']);
    assert.deepEqual(sameOf({ ...file, net: { added: 0, deleted: 0, created: true, hunks: [], empty: true } }), ['A new, empty file.']);
    assert.deepEqual(sameOf({ ...file, created: false, edits: [edits[1]], net: { added: 0, deleted: 0, hunks: [], undone: true } }), ['Its edit left the file as it was.']);
    // A diff with edits the list doesn't have says so.
    assert.deepEqual(sameOf({ ...file, net: { ...file.net, unlisted: true } }), ['This also has edits by subagents that aren\'t listed here.']);
    // Too much for the tab: its counts, and why there's no diff.
    out = draw({ ...file, net: { ...file.net, hunks: [], clipped: true } });
    assert.deepEqual(byClass(find(out, 'data-projects-changes-net'), 'dshp-ch-note').map(textIn), ['Part of this is too large to show here. Its lines are still counted.']);
    // No one diff: the edits one by one, and why (nothing to say for edits from before the plugin kept texts).
    out = draw({ ...file, net: undefined, netWhy: 'mixed' });
    assert.equal(textIn(find(out, 'data-projects-changes-why', 'mixed')), 'Shown edit by edit: the file also changed some other way between or during these edits.');
    assert.deepEqual([find(out, 'data-projects-changes-each'), elementsOf(out).filter((e) => e.type === 'DiffBlock').length], [undefined, 2]);
    assert.equal(find(out, 'className', 'dshp-ch-file-toggle').props['aria-label'], 'notes.md (new): 4 lines added, 1 deleted');
    for (const why of ['big', 'large', 'full', 'many', 'binary', 'encoding', 'outside', 'secret']) assert.ok(find(draw({ ...file, net: undefined, netWhy: why }), 'data-projects-changes-why', why), why);
    assert.equal(textIn(find(draw({ ...file, net: undefined, netWhy: 'outside' }), 'data-projects-changes-why', 'outside')), 'Shown edit by edit: no copies are kept of files outside the thread\'s folders.');
    // One edit: its diff is the file's one diff, so there's no "Each edit".
    out = draw({ ...file, edits: [edits[1]], net: { added: 1, deleted: 1, hunks: [{ oldText: 'two', newText: 'TWO' }] } }, true);
    assert.deepEqual([find(out, 'data-projects-changes-each'), find(out, 'data-projects-changes-edits'), elementsOf(out).filter((e) => e.type === 'DiffBlock').length], [undefined, undefined, 1]);
    assert.equal(elementsOf(draw({ ...file, net: undefined, netWhy: 'none' })).some((e) => e.props?.['data-projects-changes-why'] !== undefined), false);
});

test('browser half: a thread\'s Changes tab lists its files with their diffs, and its counts open it', async () => {
    const { client, react } = loadClient({ primitives: { DiffBlock: 'DiffBlock', PathLabel: 'PathLabel', FileTypeIcon: 'FileTypeIcon', Tooltip: 'Tooltip' } });
    const { ThreadChangesTab, ThreadChangesTitle, ChangedFile, editsText, fileAddress, readFailure, changesOpener, CardChanges, changesAddress, changesSessionOf, DIFF_LABELS } = client.internals;
    // The tab's address names the thread's session.
    assert.equal(changesAddress('s/1'), 'dsh-resource://projectchanges/session/s%2F1');
    assert.equal(changesSessionOf(changesAddress('s/1')), 's/1');
    assert.equal(changesSessionOf('dsh-resource://projectthread/session/s1'), undefined);
    // DSH's own file tab reads a file through the thread's session: inside its folder relative to it, else absolute.
    assert.equal(fileAddress('s1', 'src/a b.js'), 'dsh-resource://file/session/s1/src/a%20b.js');
    assert.equal(fileAddress('s1', './x.md'), 'dsh-resource://file/session/s1/x.md');
    assert.equal(fileAddress('s1', '/elsewhere/c:d.md'), 'dsh-resource://file/session/s1//elsewhere/c:d.md');
    assert.equal(editsText([{ turn: 2 }, { turn: 1 }, { turn: 2, by: 'Docs helper' }]), 'Turns 1, 2 · by this thread and Docs helper');
    assert.equal(editsText([{ turn: 3, by: 'A' }, { turn: 3, by: 'B' }]), 'Turn 3 · by A and B');
    assert.equal(editsText([{ turn: 1 }]), 'Turn 1');
    assert.equal(readFailure({ code: 'coordinator/refused', message: 'couldn\'t read t1\'s records: read timed out' }), 'Couldn\'t read t1\'s records: read timed out.');
    assert.match(readFailure({ code: 'projects/unreachable', message: 'socket closed' }), /didn't answer/);
    assert.equal(readFailure({ code: 'x', message: 'boom' }), 'Couldn\'t read this thread\'s changes. boom');
    assert.equal(DIFF_LABELS.expand(4), '… 4 more lines');

    // The tab: reading, then each file with its counts and DSH's diff of its edits' hunks.
    const value = {
        project: 'p', thread: 't1', title: 'Edit docs', session: 's-t1', folder: '/w',
        files: [
            { path: 'a.md', added: 4, deleted: 2, created: true, edits: [
                { turn: 1, seq: 3, added: 2, deleted: 0, created: true, hunks: [{ oldText: null, newText: 'one\ntwo\n' }] },
                { turn: 2, seq: 2, by: 'Docs helper', added: 1, deleted: 1, hunks: [{ oldText: 'two', newText: 'TWO' }], clipped: true },
            ], alsoBy: [{ thread: 't2', title: 'Other', session: 's-t2' }] },
            { path: 'src/b.js', added: 1, deleted: 1, edits: [{ turn: 1, seq: 5, added: 1, deleted: 1, hunks: [{ oldText: 'x = 1', newText: 'x = 2' }] }] },
        ],
        turns: [{ turn: 1, seq: 6, reviewable: true }, { turn: 2, seq: 9 }],
        unread: 1,
    };
    const calls = [];
    let answer = { ok: true, value };
    const opened = [];
    const projects = {
        link: { call: async (method, args) => { calls.push([method, { ...args }]); return answer; } },
        openThread: (id) => opened.push(['thread', id]), openChanges: (id) => opened.push(['changes', id]), openReview: (id, last) => opened.push(['review', id, last.seq, last.turn]),
    };
    const tab = { contentId: changesAddress('s-t1'), visible: true, actions: { openResource: (address) => opened.push(['file', address]) } };
    let marks = [{ turn: 1, seq: 6 }];
    const state = () => ({
        byId: { 's-t1': { displayTitle: 'Edit docs (DSH)' } },
        projectionsBySession: { 's-t1': { values: { coordinatorSession: { role: 'thread', coordinator: 's-c', thread: { id: 't1', title: 'Edit docs' }, changes: marks } } } },
    });
    const draw = liveMount(react, () => ThreadChangesTab({ useTabInfo: () => ({ tab }), useSessions: (select) => select(state()), projects }));
    let tree = draw();
    assert.equal(tree.props['data-state'], 'loading');
    assert.equal(textIn(byClass(tree, 'dshp-t-empty')), 'Reading changes…');
    assert.deepEqual(plain(calls), [['changes', { target: 's-t1' }]]);
    await tick();
    tree = draw();
    assert.equal(tree.props['data-state'], 'ready');
    assert.equal(textIn(byClass(tree, 'dshp-ch-name')), 'Edit docs');
    assert.equal(textIn(byClass(tree, 'dshp-ch-sub')), '+5-3· 2 files');
    const files = elementsOf(tree).filter((e) => e.type === ChangedFile);
    assert.deepEqual(files.map((f) => [f.props.file.path, f.props.open]), [['a.md', true], ['src/b.js', true]]);
    // A file: its name, "new", its counts; DSH's diff of each edit under its place, turn, author and counts; when, by
    // whom, and who else.
    let file = files[0].type(files[0].props);
    assert.equal(file.props['data-projects-changes-file'], 'a.md');
    const head = elementsOf(file).find((e) => e.props?.className === 'dshp-ch-file-toggle');
    assert.equal(head.props['aria-expanded'], true);
    assert.equal(head.props['aria-label'], 'a.md (new): 4 lines added, 2 deleted');
    assert.deepEqual([elementsOf(head).find((e) => e.type === 'PathLabel').props.path, textIn(head)], ['a.md', 'new+4-2']);
    const diffs = elementsOf(file).filter((e) => e.type === 'DiffBlock');
    assert.deepEqual(plain(diffs.map((d) => d.props.diffs)), [[{ path: 'a.md', oldText: null, newText: 'one\ntwo\n' }], [{ path: 'a.md', oldText: 'two', newText: 'TWO' }]]);
    assert.deepEqual(diffs.map((d) => d.props.maxLines), [40, 40]);
    assert.deepEqual(elementsOf(file).filter((e) => e.props?.['data-projects-changes-edit'] !== undefined).map((e) => e.props['data-projects-changes-edit']), ['1', '2']);
    assert.deepEqual(byClass(file, 'dshp-ch-note').map(textIn), [
        'Turns 1, 2 · by this thread and Docs helper',
        'Edit 1 · Turn 1+2-0',
        'Edit 2 · Turn 2 · by Docs helper+1-1',
        'Part of this is too large to show here. Its lines are still counted.',
        'Also changed by Other.',
    ]);
    // Its "open" button opens DSH's own file tab; another thread's name opens that thread's Changes.
    elementsOf(file).find((e) => e.props?.['data-projects-changes-open'] === '').props.onClick();
    elementsOf(file).find((e) => e.props?.className === 'dshp-ch-link').props.onClick();
    assert.deepEqual(opened.splice(0), [['file', 'dsh-resource://file/session/s-t1/a.md'], ['changes', 's-t2']]);
    // DSH's review of a turn it still holds, what couldn't be read, and what isn't shown yet.
    assert.deepEqual(byClass(tree, 'dshp-ch-note').map(textIn), [
        'DSH\'s review of the whole folder: Turn 1',
        'What 1 subagent changed couldn\'t be read.',
        'Edits made by commands the thread ran in its shell aren\'t shown yet.',
    ]);
    elementsOf(tree).find((e) => e.props?.['data-projects-changes-review'] === '1').props.onClick();
    elementsOf(tree).find((e) => e.props?.className === 'dshp-ch-name').props.onClick();
    assert.deepEqual(opened.splice(0), [['review', 's-t1', 6, 1], ['thread', 's-t1']]);
    // A click on a file's name folds it.
    files[0].props.onToggle();
    tree = draw();
    assert.deepEqual(elementsOf(tree).filter((e) => e.type === ChangedFile).map((f) => f.props.open), [false, true]);
    file = ChangedFile(elementsOf(tree).find((e) => e.type === ChangedFile).props);
    assert.equal(byClass(file, 'dshp-ch-file-body').length, 0);
    // Drawn again, nothing is read again until the thread's records gain a turn, or on Read again.
    draw();
    assert.equal(calls.length, 1);
    marks = [...marks, { turn: 2, seq: 9 }];
    tree = draw();
    assert.equal(calls.length, 2);
    assert.equal(tree.props['data-state'], 'ready', 'what it showed stays while it reads');
    await tick();
    // A read that fails keeps what it showed, and says so; Read again tries once more.
    answer = { ok: false, error: { code: 'coordinator/refused', message: 'couldn\'t read t1\'s records: read timed out' } };
    elementsOf(draw()).find((e) => e.props?.['data-projects-changes-read'] === '').props.onClick();
    tree = draw();
    await tick();
    tree = draw();
    assert.equal(calls.length, 3);
    assert.equal(byClass(tree, 'dshp-ch-file').length + elementsOf(tree).filter((e) => e.type === ChangedFile).length, 2);
    assert.equal(textIn(byClass(tree, 'dshp-t-error')), 'Couldn\'t read t1\'s records: read timed out.');
    // A thread that changed nothing says so; a hidden tab reads nothing.
    const quiet = liveMount(react, () => ThreadChangesTab({ useTabInfo: () => ({ tab: { ...tab, contentId: changesAddress('s-t9'), visible: false } }), useSessions: (select) => select(state()), projects }));
    quiet();
    assert.equal(calls.length, 3);
    answer = { ok: true, value: { ...value, files: [], turns: [], unread: undefined } };
    const none = liveMount(react, () => ThreadChangesTab({ useTabInfo: () => ({ tab: { ...tab, contentId: changesAddress('s-t9') } }), useSessions: (select) => select(state()), projects }));
    none();
    await tick();
    tree = none();
    assert.equal(textIn(byClass(tree, 'dshp-t-empty')), 'This thread hasn\'t changed any files yet.');
    // Many files start folded.
    answer = { ok: true, value: { ...value, files: Array.from({ length: 9 }, (_, i) => ({ path: `f${i}.md`, added: 1, deleted: 0, edits: [] })) } };
    const many = liveMount(react, () => ThreadChangesTab({ useTabInfo: () => ({ tab: { ...tab, contentId: changesAddress('s-t8') } }), useSessions: (select) => select(state()), projects }));
    many();
    await tick();
    tree = many();
    assert.ok(elementsOf(tree).filter((e) => e.type === ChangedFile).every((f) => f.props.open === false));
    assert.equal(textIn(byClass(tree, 'dshp-ch-note')[0]), '9 files folded. Open one to see its diff.');
    // The tab's title names the thread.
    assert.equal(textIn(ThreadChangesTitle({ useTabInfo: () => ({ tab }), useSessions: (select) => select(state()) })), 'Changes · Edit docs');

    // A card's counts open the thread's Changes tab; a DSH without it opens DSH's Review while it can; else they only say.
    const counts = { added: 5, deleted: 3, files: 2, turns: 2, last: { seq: 9, turn: 2 }, reviewable: false };
    const withTab = { ...projects, hasChanges: () => true };
    let card = CardChanges({ changes: counts, ...changesOpener(withTab, 's-t1', counts) });
    const button = elementsOf(card).find((e) => e.type === 'button');
    assert.equal(button.props['aria-label'], 'See what this thread changed. 2 files changed: 5 lines added, 3 deleted');
    assert.equal(button.props['data-projects-changes'], '');
    button.props.onClick();
    assert.deepEqual(opened.splice(0), [['changes', 's-t1']]);
    const noTab = { ...projects, hasChanges: () => false };
    card = CardChanges({ changes: { ...counts, reviewable: true }, ...changesOpener(noTab, 's-t1', { ...counts, reviewable: true }) });
    assert.equal(elementsOf(card).find((e) => e.type === 'button').props['data-projects-changes'], 'review');
    card = CardChanges({ changes: counts, ...changesOpener(noTab, 's-t1', counts) });
    assert.equal(card.props['data-projects-changes'], 'gone');
    assert.deepEqual(plain(changesOpener(withTab, undefined, counts)), {}, 'a card whose thread has no session opens nothing');
});

test('browser half: an archived project leaves the Projects page, and its ◆ row\'s menu archives it or brings it back', async () => {
    const { client, react } = loadClient();
    const { pageModel, takeKnown, archiveFlow, ArchiveMenuItem, ArchiveConfirm, ArchiveOverlay, ARCHIVE } = client.internals;
    takeKnown({});
    const value = (v) => ({ values: { coordinatorSession: v } });
    const sessions = {
        byId: { c: { id: 'c', title: '◆ Storefront' }, t1: { id: 't1', title: 'Fix cart' }, d: { id: 'd', title: '◆ Data' }, x: { id: 'x', title: 'A chat' } },
        projectionsBySession: {
            c: value({ role: 'coordinator', project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', session: 't1' }] }),
            t1: value({ role: 'thread', coordinator: 'c', thread: { id: 't1' } }),
            d: value({ role: 'coordinator', project: { id: 'data', name: 'Data' }, threads: [] }),
        },
    };
    const items = [{ workspaceId: 'w', title: 'w', path: '/w', sessionIds: ['c', 't1', 'd', 'x'] }];
    const listed = [{ id: 'storefront', name: 'Storefront', coordinator: 'c', home: 'w' }, { id: 'data', name: 'Data', coordinator: 'd', home: 'w' }];
    const titles = (tree) => plain(tree.map((n) => n.title));
    assert.deepEqual(titles(pageModel({ listed, items, sessions, archived: new Set() })), ['Storefront', 'Data']);
    // Archived by the plugin, or its ◆ row archived in DSH (the plugin follows): off the page, threads and all.
    assert.deepEqual(titles(pageModel({ listed: [{ ...listed[0], archived: true }, listed[1]], items, sessions, archived: new Set() })), ['Data']);
    assert.deepEqual(titles(pageModel({ listed, items, sessions, archived: new Set(['d']) })), ['Storefront']);

    const calls = [];
    let answer = { ok: true, value: { projects: [] } };
    const facts = {
        info: () => ({ project: { id: 'storefront', name: 'Storefront' }, threads: [{ id: 't1', title: 'Fix cart', session: 't1' }, { id: 't2', title: 'Old copy', session: 't2' }] }),
        describe: async () => {}, subscribe: () => () => {}, getSnapshot: () => 0,
        archive: async (target, restore) => { calls.push([target, restore === true]); return answer; },
    };
    const flow = archiveFlow();
    flow.connect();
    const closed = [];
    const item = (sessionId, archived = []) => ArchiveMenuItem({
        sessionId, useMenuOpenState: () => [true, (open) => closed.push(open)], useSessions: (select) => select(sessions),
        useWorkspaces: (select) => select({ archivedSessionIds: archived }), flow, facts,
    });
    // Only on a ◆ row: a thread or a chat has none.
    assert.equal(item('t1'), null);
    assert.equal(item('x'), null);
    const archiveItem = item('c');
    assert.equal(textIn(archiveItem), ARCHIVE.item);
    assert.equal(archiveItem.props.icon.type, 'IconArchiveOutlineRegular');
    archiveItem.props.onSelect();
    assert.deepEqual(closed, [false]);
    assert.equal(flow.getSnapshot().target, 'c');

    // It asks first: what goes, what runs now and stops, and how to bring it back.
    const statuses = new Map([['t1', { running: true }]]);
    const draw = mount(react, () => ArchiveConfirm({ target: 'c', flow, facts, useSessionStatus: (select) => select(statuses) }));
    let modal = draw();
    assert.equal(modal.props.title, 'Archive ◆ Storefront?');
    assert.equal(modal.props.description, 'Its coordinator and its 2 threads leave the session list and the Projects page, and whatever runs in them stops first. Nothing is deleted.');
    assert.match(textIn(modal.children), /^Running now: Fix cart\.To bring them back, show archived chats in the session list and choose Restore project in the ◆ row's menu\.$/);
    const confirmOf = (m) => elementsOf(m.props.footer).find((e) => e.props?.['data-projects-archive-confirm'] === '');
    // DSH refuses part of it: the dialog stays, and says so.
    answer = { ok: false, error: { code: 'coordinator/refused', message: 'DSH didn\'t archive 1 of ◆ Storefront\'s sessions; try again' } };
    confirmOf(modal).props.onClick();
    await tick();
    modal = draw();
    assert.equal(byClass(modal.children, 'dshp-ar-error')[0].props.role, 'alert');
    assert.equal(textIn(byClass(modal.children, 'dshp-ar-error')), 'DSH didn\'t archive 1 of ◆ Storefront\'s sessions; try again.');
    assert.equal(flow.getSnapshot().target, 'c');
    answer = { ok: true, value: { projects: [] } };
    confirmOf(modal).props.onClick();
    await tick();
    assert.deepEqual(calls, [['c', false], ['c', false]]);
    // Back, it says how many threads came with it, as the plugin lists them.
    facts.projects = () => [{ id: 'storefront', coordinator: 'c', threads: { open: 1, resolved: 1 } }];
    assert.equal(flow.getSnapshot().target, null, 'archived: the dialog closes');

    // The notice says so, with Undo, which brings it all back.
    let toast = elementsOf(ArchiveOverlay({ flow, facts })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Storefront archived with its 2 threads.');
    assert.equal(toast.props.actions[0].label, 'Undo');
    toast.props.actions[0].onClick();
    await tick();
    assert.deepEqual(calls.at(-1), ['c', true]);
    toast = elementsOf(ArchiveOverlay({ flow, facts })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Storefront is back with its 2 threads.');
    assert.deepEqual(plain(toast.props.actions), []);

    // Shown with DSH's archived chats, the ◆ row's menu restores it.
    const restoreItem = item('c', ['c']);
    assert.equal(textIn(restoreItem), ARCHIVE.restore);
    assert.equal(restoreItem.props.icon.type, 'IconUnarchiveOutlineRegular');
    restoreItem.props.onSelect();
    await tick();
    assert.deepEqual(calls.at(-1), ['c', true]);

    // A project with no threads: its coordinator alone, in the singular.
    const lone = { ...facts, info: () => ({ project: { id: 'data', name: 'Data' }, threads: [] }), projects: () => [{ id: 'data', coordinator: 'd', threads: { open: 0, resolved: 0 } }] };
    const one = mount(react, () => ArchiveConfirm({ target: 'd', flow, facts: lone, useSessionStatus: (select) => select(new Map()) }))();
    assert.equal(one.props.title, 'Archive ◆ Data?');
    assert.equal(one.props.description, 'Its coordinator leaves the session list and the Projects page, and whatever runs in it stops first. Nothing is deleted.');
    assert.equal(textIn(one.children), 'To bring it back, show archived chats in the session list and choose Restore project in the ◆ row\'s menu.');
    elementsOf(one.props.footer).find((e) => e.props?.['data-projects-archive-confirm'] === '').props.onClick();
    await tick();
    toast = elementsOf(ArchiveOverlay({ flow, facts: lone })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Data archived.');
    toast.props.actions[0].onClick();
    await tick();
    toast = elementsOf(ArchiveOverlay({ flow, facts: lone })).find((e) => e.props?.holdMs);
    assert.equal(toast.props.text, '◆ Data is back.');
});
