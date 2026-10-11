/**
 * Tests for dsh-plugin-categories' host half against a fake DSH host:
 * categories and their workspaces, DSH's workspace order kept in step, the
 * one-time move from the projects plugin's store, the old sidebar's import
 * and its preview. No DSH install needed; the peers
 * (@deepseek-ai/schemastery, @deepseek-ai/dsh-typert-protocol) must resolve.
 *
 * Run:  node plugins/categories/test/smoke.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol';
import * as plugin from '../lib/index.js';
import { CategoryStore, dataPath } from '../lib/store.js';
import { clipName, slugify, longestRun } from '../lib/categories.js';
import { planFleetShellImport, planFromProjects } from '../lib/plan.js';

const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((r) => setTimeout(r, 10));
const mode = (path) => statSync(path).mode & 0o777;
/** The action log, '' before its first line. */
const logOf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

/**
 * DSH's workspace registry: get, list (DSH's order, a new workspace first)
 * and insertBefore, the call DSH's own workspace drag makes.
 */
function fakeWorkspaces(initial = []) {
    const spaces = new Map();
    const order = [];
    const add = (path, title = path.split('/').pop()) => {
        const id = `ws:${path}`;
        if (!spaces.has(id)) {
            spaces.set(id, { id, path, title });
            order.unshift(id);
        }
        return spaces.get(id);
    };
    // Listed in the order given.
    for (const path of [...initial].reverse()) add(path);
    /** Every insertBefore call, as [id, beforeId]. */
    const moves = [];
    return {
        add,
        moves,
        get: (id) => spaces.get(id),
        list: () => order.map((id) => spaces.get(id)),
        /** DSH's: move a workspace before another, or (no anchor) to the end. */
        async insertBefore(id, beforeId) {
            if (!order.includes(id) || (beforeId !== undefined && !order.includes(beforeId))) throw new Error('workspace order: unknown workspace');
            moves.push([id, beforeId]);
            order.splice(order.indexOf(id), 1);
            order.splice(beforeId === undefined ? order.length : order.indexOf(beforeId), 0, id);
            return [...order];
        },
    };
}

/** A fake Host with DSH's workspace registry and, with `gateway`, the window's gateway. */
function fakeHost({ workspaces = [], gateway = true, registry = fakeWorkspaces(workspaces) } = {}) {
    const services = gateway ? { typertGateway: {} } : {};
    const provided = new Map();
    const host = {
        provided,
        workspaceRegistry: registry,
        logger: { info() {}, warn() {} },
        provide(name, value) { provided.set(name, value); },
        inject(names, fn) {
            if (!names.every((name) => services[name])) return;
            fn(Object.assign(Object.create(host), Object.fromEntries(names.map((name) => [name, services[name]]))));
        },
        on() {},
        effect() {},
    };
    return host;
}

function setup(overrides = {}, dir = mkdtempSync(join(tmpdir(), 'categories-')), hostOptions = {}) {
    const host = fakeHost(hostOptions);
    const raw = {
        storeFile: join(dir, 'categories', 'categories.json'),
        logFile: join(dir, 'categories', 'categories.log'),
        projectsStoreFile: join(dir, 'projects', 'projects.json'),
        ...overrides,
    };
    plugin.apply(host, plugin.Config(raw));
    return { host, raw, dir, remote: host.provided.get('dshPluginCategoriesRemote') };
}

/** The same plugin started again, as after a DSH restart, on the same workspaces. */
async function restart(host, raw) {
    const again = fakeHost({ registry: host.workspaceRegistry });
    // A new process: the store is read from its file again.
    CategoryStore.open(raw.storeFile).load();
    plugin.apply(again, plugin.Config(raw));
    await tick();
    return again.provided.get('dshPluginCategoriesRemote');
}

/** Run with DSH's data folder at `home`, as a DSH started with DSH_HOME does. */
async function withDshHome(home, run) {
    const was = process.env.DSH_HOME;
    process.env.DSH_HOME = home;
    try {
        return await run();
    } finally {
        if (was === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = was;
    }
}

const refused = async (promise, pattern) => {
    await assert.rejects(promise, (error) => error.code === 'categories/refused' && pattern.test(error.message));
};
const tree = (list) => plain(list.categories).map((c) => [c.id, c.name, c.workspaces.map((w) => w.id.slice(9))]);

test('categories: the window\'s endpoints, as DSH\'s gateway finds them', async () => {
    const { remote } = setup();
    assert.equal(remote.typertRemote.namespace, 'dsh-plugin-categories');
    assert.equal(remote.typertRemote.serviceKey, 'dshPluginCategoriesRemote');
    assert.deepEqual(remoteMethods(remote).map((m) => m.method), ['list', 'createCategory', 'renameCategory', 'removeCategory', 'moveCategory', 'fileWorkspace']);
    assert.deepEqual(plain(await remote.list()), { categories: [] });
    // Off: no endpoints, nothing written.
    const dir = mkdtempSync(join(tmpdir(), 'categories-'));
    const off = setup({ enabled: false }, dir);
    assert.equal(off.remote, undefined);
    await tick();
    assert.equal(existsSync(join(dir, 'categories')), false);
});

test('categories: named sets of workspaces in their order, kept in step with DSH\'s own workspace order', async () => {
    const { host, raw, remote } = setup({}, undefined, { workspaces: ['/work/dsh', '/work/a', '/work/b', '/work/c', '/work/d'] });
    await tick();
    const registry = host.workspaceRegistry;
    const dshOrder = () => registry.list().map((ws) => ws.id.slice(9));
    assert.deepEqual(dshOrder(), ['dsh', 'a', 'b', 'c', 'd']);

    let list = await remote.createCategory('  Fleet Services ', 'ws:/work/c');
    assert.equal(list.category, 'fleet-services');
    assert.deepEqual(tree(list), [['fleet-services', 'Fleet Services', ['c']]]);
    // Each workspace as DSH has it.
    assert.deepEqual(plain(list.categories[0].workspaces), [{ id: 'ws:/work/c', path: '/work/c', title: 'c' }]);
    assert.equal(list.categories[0].source, 'page');
    // DSH's order follows: each category's workspaces together, in the categories' order, then the rest.
    assert.deepEqual(dshOrder(), ['c', 'dsh', 'a', 'b', 'd']);
    list = await remote.createCategory('Lab');
    assert.deepEqual(tree(list), [['fleet-services', 'Fleet Services', ['c']], ['lab', 'Lab', []]]);
    await remote.fileWorkspace('ws:/work/a', 'lab');
    list = await remote.fileWorkspace('ws:/work/b', 'lab', 'ws:/work/a');
    assert.deepEqual(tree(list), [['fleet-services', 'Fleet Services', ['c']], ['lab', 'Lab', ['b', 'a']]]);
    assert.deepEqual(dshOrder(), ['c', 'b', 'a', 'dsh', 'd']);
    // Filed with no anchor, a workspace goes last in its category; moving to another one takes it out of the first.
    list = await remote.fileWorkspace('ws:/work/b', 'lab', '');
    assert.deepEqual(tree(list)[1][2], ['a', 'b']);
    list = await remote.fileWorkspace('ws:/work/b', 'fleet-services', 'ws:/work/c');
    assert.deepEqual(tree(list), [['fleet-services', 'Fleet Services', ['b', 'c']], ['lab', 'Lab', ['a']]]);
    assert.deepEqual(dshOrder(), ['b', 'c', 'a', 'dsh', 'd']);

    // Categories move; DSH's order moves with them, as few workspaces as it takes.
    const before = registry.moves.length;
    list = await remote.moveCategory('lab', 'fleet-services');
    assert.deepEqual(tree(list).map(([id]) => id), ['lab', 'fleet-services']);
    assert.deepEqual(dshOrder(), ['a', 'b', 'c', 'dsh', 'd']);
    assert.equal(registry.moves.length - before, 1);
    list = await remote.moveCategory('lab', '');
    assert.deepEqual(tree(list).map(([id]) => id), ['fleet-services', 'lab']);

    // Rename; refusals.
    list = await remote.renameCategory('lab', 'Labs');
    assert.equal(tree(list)[1][1], 'Labs');
    await refused(remote.renameCategory('nope', 'X'), /"nope" is not a category here/);
    await refused(remote.renameCategory('lab', ' \n '), /a category needs a name/);
    await refused(remote.createCategory('   '), /a category needs a name/);
    await refused(remote.createCategory('Other', 'ws:/nope'), /DSH has no such workspace/);
    await refused(remote.fileWorkspace('ws:/nope', 'lab'), /DSH has no such workspace/);
    await refused(remote.fileWorkspace('', 'lab'), /workspace is required/);
    await refused(remote.fileWorkspace('ws:/work/a', 'nope'), /"nope" is not a category here/);
    await refused(remote.fileWorkspace('ws:/work/d', 'lab', 'ws:/work/b'), /that workspace is in another category/);
    await refused(remote.moveCategory('lab', 'nope'), /"nope" is not a category here/);
    await refused(remote.removeCategory('nope'), /"nope" is not a category here/);
    // Ids stay as made, and are unique; a long name is cut once, at a word.
    assert.equal((await remote.createCategory('Lab')).category, 'lab-2');
    await remote.removeCategory('lab-2');
    const long = await remote.createCategory(`${'Quarterly planning '.repeat(6)}notes`);
    const made = long.categories.find((c) => c.id === long.category);
    assert.ok(Buffer.byteLength(made.name) <= 80 && made.name.endsWith('planning…'), made.name);
    await remote.removeCategory(long.category);

    // Out of a category: last among the workspaces in none.
    list = await remote.fileWorkspace('ws:/work/b', '');
    assert.deepEqual(tree(list), [['fleet-services', 'Fleet Services', ['c']], ['lab', 'Labs', ['a']]]);
    assert.deepEqual(dshOrder(), ['c', 'a', 'dsh', 'd', 'b']);

    // Deleting a category leaves its workspaces where they are, in none.
    list = await remote.removeCategory('lab');
    assert.deepEqual(tree(list), [['fleet-services', 'Fleet Services', ['c']]]);
    assert.deepEqual(dshOrder(), ['c', 'a', 'dsh', 'd', 'b']);

    // A workspace DSH adds later (DSH lists it first) goes after the categories when the window lists, among the others in none.
    registry.add('/work/new');
    assert.equal(dshOrder()[0], 'new');
    await remote.list();
    await tick();
    assert.deepEqual(dshOrder(), ['c', 'new', 'a', 'dsh', 'd', 'b']);

    // After a restart: the same categories; DSH's order needs no moves.
    const moves = registry.moves.length;
    assert.deepEqual(tree(await (await restart(host, raw)).list()), [['fleet-services', 'Fleet Services', ['c']]]);
    assert.equal(registry.moves.length, moves);
    const saved = JSON.parse(readFileSync(raw.storeFile, 'utf8'));
    assert.deepEqual([saved.version, Object.keys(saved.categories), saved.categoryOf], [1, ['fleet-services'], { 'ws:/work/c': 'fleet-services' }]);
    // Private: the store and log are mode 600, their folder 700; the log holds ids and counts.
    assert.deepEqual([mode(raw.storeFile), mode(raw.logFile), mode(join(raw.storeFile, '..'))], [0o600, 0o600, 0o700]);
    const log = readFileSync(raw.logFile, 'utf8');
    for (const line of ['category-new fleet-services page', 'workspace ws:/work/c category=fleet-services', 'category-move lab before=fleet-services', 'category-rename lab', 'category-delete lab', 'workspace ws:/work/b category=none']) {
        assert.ok(log.includes(line), line);
    }
    assert.doesNotMatch(log, /Labs|Fleet Services/);
});

/** The projects plugin's store as the live 5f0487a writes it: categories, placements, the import's record. */
function projectsStoreWithCategories() {
    return {
        version: 1,
        projects: {
            'dsh-plugins': { settings: { goal: 'Ship it' }, threads: { t1: { sessionId: 's-t1', title: 'Fix CI' } }, pendingHandbacks: [], nextThread: 2, coordinatorSessionId: 's-dsh', home: 'ws:/work/dsh' },
            'testing-out-coordinator': { name: 'Testing out Coordinator', source: 'page', order: 0, coordinatorSessionId: 's-test', home: 'ws:/work/notes' },
        },
        workspaceOf: { 'ws:/work/dsh': 'dsh-plugins' },
        categories: {
            'dsh-plugins': { name: 'DSH Plugins', order: 0, createdAt: '2026-10-10T08:13:00.000Z', source: 'group' },
            'local-model-recipe': { name: 'Local Model Recipe', order: 1, createdAt: '2026-10-10T08:13:00.000Z', source: 'import', importedFrom: 'p4' },
            'fleet-services': { name: 'Fleet Services', order: 2, createdAt: '2026-10-10T08:13:00.000Z', source: 'import', importedFrom: 'p3' },
            experimentation: { name: 'Experimentation', order: 3, createdAt: '2026-10-10T08:13:00.000Z', source: 'import', importedFrom: 'p2' },
            'testing-out-coordinator': { name: 'General', order: 4, createdAt: '2026-10-10T09:00:00.000Z', source: 'group' },
            broken: { order: 5 },
        },
        categoryOf: {
            'ws:/work/dsh': 'dsh-plugins', 'ws:/work/a': 'local-model-recipe', 'ws:/work/b': 'local-model-recipe', 'ws:/work/ops': 'fleet-services',
            'ws:/work/lab': 'experimentation', 'ws:/work/notes': 'testing-out-coordinator', 'ws:/work/gone': 'fleet-services', 'ws:/work/x': 'broken',
        },
        imports: {
            fleetShell: { at: '2026-10-10T08:13:00.000Z', file: '/home/u/.dsh/fleet-shell/state.json', projects: 5, joined: 0, workspaces: 14, skipped: 0 },
            categories: { at: '2026-10-11T01:37:00.000Z', categories: 5, workspaces: 14, backup: '/home/u/.dsh/projects/projects.v1.json' },
        },
    };
}

test('move: at the first start, whatever categories the projects plugin kept come over unchanged, with a copy of its store; it is only read', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    // An old sidebar file is there too: its import already ran (the projects store says so), so it doesn't run again.
    mkdirSync(join(home, 'fleet-shell'));
    writeFileSync(join(home, 'fleet-shell', 'state.json'), JSON.stringify({ projects: [{ id: 'p9', name: 'Security' }], projectOf: { 'ws:/work/c': 'p9' } }));
    const dir = mkdtempSync(join(tmpdir(), 'categories-'));
    mkdirSync(join(dir, 'projects'));
    const projectsFile = join(dir, 'projects', 'projects.json');
    const text = `${JSON.stringify(projectsStoreWithCategories(), null, 2)}\n`;
    writeFileSync(projectsFile, text, { mode: 0o600 });
    const options = { workspaces: ['/work/new', '/work/dsh', '/work/a', '/work/b', '/work/ops', '/work/lab', '/work/notes', '/work/c'] };
    await withDshHome(home, async () => {
        const { host, raw, remote } = setup({}, dir, options);
        await tick();
        const list = await remote.list();
        // The same ids, names (General stays General), sources and order; the workspaces DSH has.
        assert.deepEqual(plain(list.categories).map((c) => [c.id, c.name, c.source, c.importedFrom ?? null, c.workspaces.map((w) => w.id.slice(9))]), [
            ['dsh-plugins', 'DSH Plugins', 'group', null, ['dsh']],
            ['local-model-recipe', 'Local Model Recipe', 'import', 'p4', ['a', 'b']],
            ['fleet-services', 'Fleet Services', 'import', 'p3', ['ops']],
            ['experimentation', 'Experimentation', 'import', 'p2', ['lab']],
            ['testing-out-coordinator', 'General', 'group', null, ['notes']],
        ]);
        const store = JSON.parse(readFileSync(raw.storeFile, 'utf8'));
        const source = projectsStoreWithCategories();
        // Each category as it was, field for field; a placement DSH no longer lists is kept too; the broken one isn't.
        assert.deepEqual(store.categories, Object.fromEntries(Object.entries(source.categories).filter(([id]) => id !== 'broken')));
        assert.deepEqual(store.categoryOf, Object.fromEntries(Object.entries(source.categoryOf).filter(([, id]) => id !== 'broken')));
        // The old sidebar's import is remembered as made, so it doesn't run again here.
        assert.deepEqual(store.imports.fleetShell, source.imports.fleetShell);
        const copy = join(dir, 'categories', 'from-projects.json');
        assert.deepEqual({ ...store.imports.projects, at: 'x' }, { at: 'x', file: projectsFile, from: 'categories', categories: 5, workspaces: 7, backup: copy });
        assert.equal(readFileSync(copy, 'utf8'), text, 'a copy of the projects store as it was');
        assert.equal(mode(copy), 0o600);
        assert.equal(readFileSync(projectsFile, 'utf8'), text, 'the projects store is only read');
        assert.match(readFileSync(raw.logFile, 'utf8'), /move from projects from=categories categories=5 workspaces=7 backup=/);
        assert.doesNotMatch(readFileSync(raw.logFile, 'utf8'), /import fleet-shell/);
        // DSH's order reads like the list: each category's workspaces together, then the rest.
        assert.deepEqual(host.workspaceRegistry.list().map((ws) => ws.id.slice(9)), ['dsh', 'a', 'b', 'ops', 'lab', 'notes', 'new', 'c']);

        // Once: the projects store changes, a category is renamed here; a restart moves nothing again.
        writeFileSync(projectsFile, JSON.stringify({ version: 1, projects: {}, categories: { other: { name: 'Other', order: 0 } }, categoryOf: {} }));
        await remote.renameCategory('testing-out-coordinator', 'Notes');
        const again = await restart(host, raw);
        assert.deepEqual(tree(await again.list()).map(([id, name]) => [id, name]), [
            ['dsh-plugins', 'DSH Plugins'], ['local-model-recipe', 'Local Model Recipe'], ['fleet-services', 'Fleet Services'], ['experimentation', 'Experimentation'], ['testing-out-coordinator', 'Notes'],
        ]);
        assert.equal(readFileSync(raw.logFile, 'utf8').match(/move from projects/g).length, 1);

        // The plugin's store gone (the user deleted it to move again): a second copy, the first kept.
        const first = readFileSync(copy, 'utf8');
        rmSync(raw.storeFile);
        await restart(host, raw);
        assert.equal(readFileSync(copy, 'utf8'), first);
        assert.equal(JSON.parse(readFileSync(raw.storeFile, 'utf8')).imports.projects.backup, join(dir, 'categories', 'from-projects-2.json'));
    });
});

test('move: a projects store from before categories gives its groups, never a project that has a coordinator and only its own workspace', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'categories-'));
    mkdirSync(join(dir, 'projects'));
    const projectsFile = join(dir, 'projects', 'projects.json');
    const old = {
        version: 1,
        projects: {
            // From the projects plugin's settings (no name in its store): a coordinator, its own workspace and two more.
            'dsh-plugins': { settings: {}, threads: {}, coordinatorSessionId: 's-dsh', home: 'ws:/work/dsh' },
            // From its settings too, with a coordinator and only its own workspace: a project, not a category.
            storefront: { coordinatorSessionId: 's-sf', home: 'ws:/work/sf' },
            // Made on the Projects page, with a coordinator added, holding only its own workspace (no home recorded).
            lab: { name: 'Lab', source: 'page', createdAt: '2026-10-09T08:30:00.000Z', order: 1, coordinatorSessionId: 's-lab' },
            // Groups without a coordinator, one of them empty.
            'local-model-recipe': { name: 'Local Model Recipe', source: 'import', createdAt: '2026-10-09T08:13:00.000Z', order: 0, importedFrom: 'p4' },
            empty: { name: 'Empty', source: 'page', createdAt: '2026-10-09T09:00:00.000Z', order: 2 },
            // From its settings, no coordinator yet, never held a workspace: never a group.
            docs: {},
        },
        workspaceOf: {
            'ws:/work/dsh': 'dsh-plugins', 'ws:/work/d': 'dsh-plugins', 'ws:/work/e': 'dsh-plugins', 'ws:/work/sf': 'storefront',
            'ws:/work/lab': 'lab', 'ws:/work/a': 'local-model-recipe',
        },
        imports: { fleetShell: { at: '2026-10-09T08:13:00.000Z', projects: 1, joined: 0, workspaces: 1, skipped: 0 } },
    };
    writeFileSync(projectsFile, JSON.stringify(old));
    const { raw, remote } = setup({}, dir, { workspaces: ['/work/dsh', '/work/d', '/work/e', '/work/sf', '/work/lab', '/work/a'] });
    await tick();
    assert.deepEqual(plain((await remote.list()).categories).map((c) => [c.id, c.name, c.source, c.workspaces.map((w) => w.id.slice(9))]), [
        ['dsh-plugins', 'dsh-plugins', 'group', ['dsh', 'd', 'e']],
        ['local-model-recipe', 'Local Model Recipe', 'import', ['a']],
        ['empty', 'Empty', 'group', []],
    ]);
    const store = JSON.parse(readFileSync(raw.storeFile, 'utf8'));
    assert.deepEqual({ ...store.imports.projects, at: 'x', backup: 'y' }, { at: 'x', file: projectsFile, from: 'groups', categories: 3, workspaces: 4, projects: ['storefront', 'lab'], backup: 'y' });
    assert.deepEqual(store.imports.fleetShell, old.imports.fleetShell);
    assert.equal(store.categories['local-model-recipe'].createdAt, '2026-10-09T08:13:00.000Z');
    assert.equal(store.categories['local-model-recipe'].importedFrom, 'p4');
    assert.match(readFileSync(raw.logFile, 'utf8'), /move from projects from=groups categories=3 workspaces=4 projects=2 backup=/);
});

test('move: no projects store is nothing to move, done once; one that can\'t be read waits for the next start', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    await withDshHome(home, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'categories-'));
        const { host, raw, remote } = setup({}, dir);
        await tick();
        assert.deepEqual(plain(await remote.list()), { categories: [] });
        const store = JSON.parse(readFileSync(raw.storeFile, 'utf8'));
        assert.deepEqual({ ...store.imports.projects, at: 'x' }, { at: 'x', file: raw.projectsStoreFile, from: 'none', categories: 0, workspaces: 0 });
        assert.equal(existsSync(join(dir, 'categories', 'from-projects.json')), false);
        assert.equal(logOf(raw.logFile), '');
        // A projects store that turns up later doesn't move anything: the move ran.
        mkdirSync(join(dir, 'projects'));
        writeFileSync(raw.projectsStoreFile, JSON.stringify(projectsStoreWithCategories()));
        assert.deepEqual(plain(await (await restart(host, raw)).list()), { categories: [] });

        // Unreadable (not JSON): logged, nothing written, tried again at the next start.
        const dir2 = mkdtempSync(join(tmpdir(), 'categories-'));
        mkdirSync(join(dir2, 'projects'));
        writeFileSync(join(dir2, 'projects', 'projects.json'), '{ not json');
        const second = setup({}, dir2);
        await tick();
        assert.match(readFileSync(second.raw.logFile, 'utf8'), /error move from projects/);
        assert.equal(existsSync(second.raw.storeFile), false);
        writeFileSync(join(dir2, 'projects', 'projects.json'), JSON.stringify(projectsStoreWithCategories()));
        const later = await restart(second.host, second.raw);
        assert.equal((await later.list()).categories.length, 5);
    });
});

test('move plan: categories as they are, groups from before them, and nothing from anything else', () => {
    const now = '2026-10-11T04:00:00.000Z';
    const plan = planFromProjects(projectsStoreWithCategories(), now);
    assert.deepEqual([plan.from, plan.order], ['categories', ['dsh-plugins', 'local-model-recipe', 'fleet-services', 'experimentation', 'testing-out-coordinator']]);
    // Order by their place in the list, then as listed.
    const shuffled = planFromProjects({ version: 1, categories: { b: { name: 'B', order: 1 }, a: { name: 'A', order: 0 }, c: { name: 'C' } }, categoryOf: { w: 'c', v: 'nope' } }, now);
    assert.deepEqual([shuffled.order, shuffled.categoryOf], [['a', 'b', 'c'], { w: 'c' }]);
    // An empty categories object is a store that made categories and had none.
    assert.deepEqual(plain(planFromProjects({ version: 1, projects: { x: { name: 'X' } }, workspaceOf: { w: 'x' }, categories: {} }, now)), { from: 'categories', categories: {}, categoryOf: {}, order: [], projects: [] });
    const none = { from: 'none', categories: {}, categoryOf: {}, order: [], projects: [] };
    for (const stored of [null, {}, { version: 2, categories: { a: { name: 'A' } } }, { version: 1, projects: {} }, 'text']) {
        assert.deepEqual(plain(planFromProjects(stored, now)), none, JSON.stringify(stored));
    }
    // The import's record comes along even with nothing else.
    assert.deepEqual(planFromProjects({ version: 1, projects: {}, imports: { fleetShell: { at: 't' } } }, now).fleetShell, { at: 't' });
});

test('import: the old sidebar\'s projects come in once, as categories in their order; only names and workspaces, and the old file is only read', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    const file = join(home, 'fleet-shell', 'state.json');
    mkdirSync(join(home, 'fleet-shell'));
    const old = {
        prefs: { projectsSidebar: true, treeOrder: 'updated' },
        projects: [
            { id: 'p4', name: 'Local Model Recipe', instructions: '', files: [], defaults: {} },
            { id: 'p3', name: 'Fleet  Services', instructions: '', files: [], defaults: {} },
            { id: 'p1', name: 'dsh plugins', instructions: '', files: [], defaults: {} },
            { id: 'p9', name: 'Security' },
            { id: 'p8', name: '   ' },
        ],
        projectOf: {
            'ws:/work/a': 'p4', 'ws:/work/b': 'p3', 'ws:/work/gone': 'p3', 'ws:/work/c': '_none',
            'ws:/work/d': 'p1', 'ws:/work/dsh': 'p4', 'ws:/work/e': 'p-deleted',
        },
        agentOverride: { lane: 'x' },
    };
    const text = `${JSON.stringify(old, null, 2)}\n`;
    writeFileSync(file, text);
    const dir = mkdtempSync(join(tmpdir(), 'categories-'));
    const options = { workspaces: ['/work/dsh', '/work/a', '/work/b', '/work/c', '/work/d', '/work/e'] };
    await withDshHome(home, async () => {
        const { host, raw, remote } = setup({ storeFile: '~/.dsh/categories/categories.json', logFile: '~/.dsh/categories/categories.log' }, dir, options);
        await tick();
        const list = await remote.list();
        assert.deepEqual(plain(list.categories).map((c) => [c.id, c.name, c.source, c.importedFrom, c.workspaces.map((w) => w.id.slice(9))]), [
            ['local-model-recipe', 'Local Model Recipe', 'import', 'p4', ['dsh', 'a']],
            ['fleet-services', 'Fleet Services', 'import', 'p3', ['b']],
            ['dsh-plugins', 'dsh plugins', 'import', 'p1', ['d']],
            ['security', 'Security', 'import', 'p9', []],
        ]);
        // Its data lives in DSH's data folder, as DSH_HOME says.
        assert.equal(raw.storeFile, '~/.dsh/categories/categories.json');
        const storeFile = join(home, 'categories', 'categories.json');
        const store = JSON.parse(readFileSync(storeFile, 'utf8'));
        assert.deepEqual({ ...store.imports.fleetShell, at: 'x' }, { at: 'x', file, categories: 4, joined: 0, workspaces: 4, skipped: 1 });
        assert.doesNotMatch(JSON.stringify(store), /lane|agentOverride|instructions/);
        assert.match(readFileSync(join(home, 'categories', 'categories.log'), 'utf8'), /import fleet-shell categories=4 joined=0 workspaces=4 skipped=1/);
        assert.equal(readFileSync(file, 'utf8'), text, 'the old file is unchanged');
        assert.deepEqual(host.workspaceRegistry.list().map((ws) => ws.id.slice(9)), ['dsh', 'a', 'b', 'd', 'c', 'e']);

        // Once only: a later start with a changed old file imports nothing.
        writeFileSync(file, JSON.stringify({ ...old, projects: [...old.projects, { id: 'p7', name: 'Later' }], projectOf: { 'ws:/work/c': 'p7' } }));
        await remote.fileWorkspace('ws:/work/b', '');
        const after = await (await restart(host, { ...raw })).list();
        assert.deepEqual(plain(after.categories).map((c) => [c.id, c.workspaces.map((w) => w.id.slice(9))]), [
            ['local-model-recipe', ['dsh', 'a']], ['fleet-services', []], ['dsh-plugins', ['d']], ['security', []],
        ]);
        assert.equal(dataPath(raw.storeFile), storeFile);
    });
});

test('import: a name that is already a category joins it; an unreadable old file is logged and tried again; none at all is quiet', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    await withDshHome(home, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'categories-'));
        mkdirSync(join(dir, 'projects'));
        // The projects plugin made one category, and never imported the old sidebar.
        writeFileSync(join(dir, 'projects', 'projects.json'), JSON.stringify({ version: 1, projects: {}, categories: { fleet: { name: 'Fleet Services', order: 0 } }, categoryOf: { 'ws:/work/a': 'fleet' } }));
        const options = { workspaces: ['/work/a', '/work/b', '/work/c'] };
        const { host, raw } = setup({}, dir, options);
        await tick();
        assert.doesNotMatch(logOf(raw.logFile), /import/);
        mkdirSync(join(home, 'fleet-shell'));
        writeFileSync(join(home, 'fleet-shell', 'state.json'), '{ not json');
        await restart(host, raw);
        assert.match(readFileSync(raw.logFile, 'utf8'), /error import fleet-shell/);
        assert.equal(JSON.parse(readFileSync(raw.storeFile, 'utf8')).imports.fleetShell, undefined);
        writeFileSync(join(home, 'fleet-shell', 'state.json'), JSON.stringify({ projects: [{ id: 'p3', name: ' fleet services' }], projectOf: { 'ws:/work/b': 'p3', 'ws:/work/a': 'p3' } }));
        const again = await restart(host, raw);
        assert.deepEqual(tree(await again.list()), [['fleet', 'Fleet Services', ['a', 'b']]]);
        assert.match(readFileSync(raw.logFile, 'utf8'), /import fleet-shell categories=0 joined=1 workspaces=1 skipped=0/);
    });
});

test('import plan: one group per name in the old order, a name already here joins it, and what stays where it is', () => {
    const state = {
        projects: [{ id: 'p1', name: ' Alpha  One ' }, { id: 'p2', name: 'beta' }, { id: 'p3', name: 'alpha one' }, { id: 'p4', name: ' ' }, { id: 5, name: 'No id' }],
        projectOf: { w1: 'p1', w2: 'p3', w3: 'p2', w4: '_none', w5: 'p-deleted', w6: 'p1', w7: 'p2' },
    };
    const plan = planFleetShellImport(state, { names: new Map([['beta', 'beta-here']]), known: (id) => id !== 'w6', placed: (id) => id === 'w7' });
    assert.deepEqual(plan, {
        groups: [{ name: 'Alpha One', from: 'p1', workspaces: ['w1', 'w2'] }, { name: 'beta', join: 'beta-here', from: 'p2', workspaces: ['w3'] }],
        kept: ['w7'], skipped: ['w6'], loose: ['w4', 'w5'],
    });
    const none = { groups: [], kept: [], skipped: [], loose: [] };
    const here = { names: new Map(), known: () => true, placed: () => false };
    assert.deepEqual(planFleetShellImport(null, here), none);
    assert.deepEqual(planFleetShellImport({ projects: 'p1', projectOf: null }, here), none);
});

test('import preview: says what the move from the projects store and the import will do, reading only, and that they ran once they have', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'));
    for (const dir of ['fleet-shell', 'storages', 'projects']) mkdirSync(join(home, dir));
    const state = { projects: [{ id: 'p1', name: 'Fleet Services' }, { id: 'p2', name: 'Security' }], projectOf: { w1: 'p1', w2: 'p1', w3: 'p2', w4: '_none', w9: 'p2' } };
    const workspaces = {
        w1: { path: '/work/fleet-ops', title: 'fleet-ops', sessionIds: ['s-chat'] },
        w2: { path: '/work/plugins', title: 'deepseek-plugins', sessionIds: ['s-coordinator'] },
        w3: { path: '/work/lab', title: 'Vulnerability Lab', sessionIds: [] },
        w4: { path: '/work/discord', title: 'DSH Discord', sessionIds: [] },
    };
    const projectsFile = join(home, 'projects', 'projects.json');
    const files = {
        [join(home, 'fleet-shell', 'state.json')]: JSON.stringify(state),
        [join(home, 'storages', 'workspace.json')]: JSON.stringify({ unit: { name: 'workspace', version: 2 }, global: {}, tables: { workspaces } }),
        [projectsFile]: JSON.stringify({
            version: 1,
            projects: { 'dsh-plugins': { coordinatorSessionId: 's-coordinator', home: 'w2' } },
            categories: { 'dsh-plugins': { name: 'DSH Plugins', order: 0, source: 'group' }, lab: { name: 'Lab', order: 1, source: 'page' } },
            categoryOf: { w2: 'dsh-plugins', w3: 'lab' },
        }),
    };
    for (const [file, text] of Object.entries(files)) writeFileSync(file, text);
    const script = fileURLToPath(new URL('../scripts/import-preview.mjs', import.meta.url));
    const run = () => spawnSync(process.execPath, [script], { env: { ...process.env, DSH_HOME: home }, encoding: 'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /From the projects plugin's store \(.*projects\.json, only read; copied to .*from-projects\.json first\), at the first start:\n\n1\. DSH Plugins\n {5}deepseek-plugins \(\/work\/plugins\)\n2\. Lab\n {5}Vulnerability Lab \(\/work\/lab\)\n/);
    assert.match(first.stdout, /1\. Fleet Services, a new category\n {5}fleet-ops \(\/work\/fleet-ops\)\n2\. Security, a new category\n {5}\(no workspaces\)\n/);
    assert.match(first.stdout, /names and workspaces only; its instructions, files and defaults stay behind/);
    assert.match(first.stdout, /Already in a category here, stays there: deepseek-plugins \(\/work\/plugins\) in "dsh-plugins", Vulnerability Lab \(\/work\/lab\) in "lab"/);
    assert.match(first.stdout, /Ungrouped in the old sidebar, goes to Other workspaces: DSH Discord \(\/work\/discord\)/);
    assert.match(first.stdout, /Gone from DSH, skipped: w9/);
    assert.match(first.stdout, /Result: 2 new categories, 0 joined, 1 workspaces placed, 1 skipped\./);
    for (const [file, text] of Object.entries(files)) assert.equal(readFileSync(file, 'utf8'), text, `${file} is unchanged`);
    assert.equal(existsSync(join(home, 'categories')), false, 'nothing of its own is made');
    // Once both have run, it says so.
    mkdirSync(join(home, 'categories'));
    writeFileSync(join(home, 'categories', 'categories.json'), JSON.stringify({
        version: 1, categories: {}, categoryOf: {},
        imports: { projects: { at: '2026-10-11T04:00:00.000Z', categories: 5, workspaces: 14 }, fleetShell: { at: '2026-10-10T15:00:00.000Z', projects: 2, workspaces: 2, skipped: 1 } },
    }));
    const done = run().stdout;
    assert.match(done, /The categories already came over from the projects plugin \(2026-10-11T04:00:00\.000Z\): 5 categories, 14 workspaces\./);
    assert.match(done, /The old sidebar was already imported \(2026-10-10T15:00:00\.000Z\): 2 groups, 2 workspaces, 1 skipped\. It won't run again\./);
});

test('names and ids: one line within DSH\'s 80 bytes, ids in any script', () => {
    assert.equal(clipName('  Fleet \n Services '), 'Fleet Services');
    assert.equal(clipName('x'.repeat(80)), 'x'.repeat(80));
    assert.ok(Buffer.byteLength(clipName('前端'.repeat(30))) <= 80);
    assert.equal(slugify('Fleet Services'), 'fleet-services');
    assert.notEqual(slugify('前端'), slugify('后端'));
    assert.equal(slugify('Café'), 'cafe');
    assert.equal(slugify('!!!'), 'category');
    assert.deepEqual(longestRun([3, 0, 1, 4, 2]), [1, 2, 3]);
    assert.deepEqual(longestRun([]), []);
});
