#!/usr/bin/env node
/**
 * What this version of the plugin does once at its first start in this DSH,
 * shown before it runs: the groups of workspaces from before become
 * categories, and the all-in-one mod's old sidebar projects come in as
 * categories (only their names and which workspaces each held). It only
 * reads: <DSH home>/fleet-shell/state.json, DSH's workspaces
 * (<DSH home>/storages/workspace.json) and the plugin's store (the default
 * <DSH home>/projects/projects.json, or the path given). DSH home is
 * $DSH_HOME, else ~/.dsh.
 *
 *   node plugins/projects/scripts/import-preview.mjs [store file]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { dataPath, dshHome } from '../lib/store.js';
import { planFleetShellImport } from '../lib/fleet-shell.js';
import { planCategories } from '../lib/categories.js';

const home = dshHome();
const read = (file) => {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        return error;
    }
};
const short = (path) => (typeof path === 'string' && path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path);

console.log(`Preview for ${short(home)}. Read-only: nothing changes.`);
const workspaceFile = join(home, 'storages', 'workspace.json');
const registry = read(workspaceFile);
if (registry instanceof Error) {
    console.log(`Can't read DSH's workspaces (${short(workspaceFile)}): ${registry.message}`);
    process.exit(1);
}
const workspaces = registry?.tables?.workspaces ?? {};
const label = (id) => {
    const ws = workspaces[id];
    return ws ? `${ws.title || id} (${short(ws.path)})` : id;
};
const storeFile = dataPath(process.argv[2] ?? '~/.dsh/projects/projects.json');
const store = read(storeFile);
const stored = store instanceof Error ? {} : store;
const projects = stored.projects ?? {};
// Profile projects keep no name in the store; the profile has it.
const profile = Object.keys(projects).filter((id) => typeof projects[id]?.name !== 'string');

// 1. Groups become categories, once.
let categories = stored.categories;
let categoryOf = stored.categoryOf ?? {};
if (categories === null || typeof categories !== 'object') {
    const plan = planCategories(stored, profile.map((id) => ({ id, name: id })), new Date().toISOString());
    ({ categories, categoryOf } = plan);
    console.log(`\nGroups become categories, once, at the first start with this version (the store is copied to ${short(storeFile.replace(/\.json$/, '.v1.json'))} first):\n`);
    if (plan.order.length === 0) console.log('No groups: nothing to do.');
    plan.order.forEach((id, i) => {
        const held = Object.keys(categoryOf).filter((ws) => categoryOf[ws] === id);
        console.log(`${i + 1}. ${profile.includes(id) ? `The project "${id}" from your profile, under the same name` : categories[id].name}`);
        for (const ws of held) console.log(`     ${label(ws)}`);
        if (held.length === 0) console.log('     (no workspaces)');
    });
    const kept = Object.entries(projects).filter(([id, p]) => typeof p?.coordinatorSessionId === 'string' && (profile.includes(id) || typeof p.home === 'string'));
    if (kept.length > 0) console.log(`\nProjects with a coordinator stay projects, in their coordinator's workspace: ${kept.map(([id, p]) => `${id}${p.home ? ` in ${label(p.home)}` : ''}`).join(', ')}`);
    const groups = Object.entries(projects).filter(([id, p]) => typeof p?.name === 'string' && typeof p.coordinatorSessionId !== 'string' && typeof p.home !== 'string').map(([id]) => id);
    if (groups.length > 0) console.log(`Groups without a coordinator are only categories now: ${groups.join(', ')}`);
} else {
    console.log(`\nGroups already became categories${stored.imports?.categories?.at ? ` (${stored.imports.categories.at})` : ''}.`);
}

// 2. The old sidebar's projects come in as categories, once.
const oldFile = join(home, 'fleet-shell', 'state.json');
if (stored.imports?.fleetShell) {
    const done = stored.imports.fleetShell;
    const made = done.categories ?? done.projects;
    console.log(`\nThe old sidebar was already imported (${done.at}): ${made} ${done.categories === undefined ? 'groups' : 'categories'}, ${done.workspaces} workspaces, ${done.skipped} skipped. It won't run again.`);
    process.exit(0);
}
const state = read(oldFile);
if (state instanceof Error) {
    console.log(state.code === 'ENOENT' ? `\nNothing to import: ${short(oldFile)} doesn't exist.` : `\nThe import would log an error and do nothing: ${short(oldFile)} can't be read (${state.message}).`);
    process.exit(0);
}
const holder = (workspaceId) => (categories[categoryOf[workspaceId]] ? categoryOf[workspaceId] : undefined);
const names = new Map(Object.entries(categories).map(([id, c]) => [String(c.name).trim().toLowerCase(), id]));
const plan = planFleetShellImport(state, { names, known: (id) => Boolean(workspaces[id]), placed: (id) => holder(id) !== undefined });

console.log(`\nFrom ${short(oldFile)}, once, at the first DSH start with this version (names and workspaces only; its instructions, files and defaults stay behind):\n`);
plan.groups.forEach((group, i) => {
    console.log(`${i + 1}. ${group.name}${group.join ? ` joins the category "${group.join}" (same name)` : ', a new category'}`);
    for (const id of group.workspaces) console.log(`     ${label(id)}`);
    if (group.workspaces.length === 0) console.log('     (no workspaces)');
});
const list = (ids, what) => console.log(`\n${what}: ${ids.length === 0 ? 'none' : ids.map((id) => (holder(id) ? `${label(id)} in "${holder(id)}"` : label(id))).join(', ')}`);
list(plan.kept, 'Already in a category here, stays there');
list(plan.loose, 'Ungrouped in the old sidebar, goes to Other workspaces');
list(plan.skipped, "Gone from DSH, skipped");
// A coordinator this DSH doesn't have means the store came from another DSH (one with its own DSH_HOME, say).
const listed = new Set(Object.values(workspaces).flatMap((ws) => (Array.isArray(ws?.sessionIds) ? ws.sessionIds : [])));
const strangers = Object.entries(projects).filter(([, p]) => typeof p?.coordinatorSessionId === 'string' && !listed.has(p.coordinatorSessionId));
if (strangers.length > 0) console.log(`\nCheck the store first: it names coordinators this DSH doesn't list in any workspace: ${strangers.map(([id, p]) => `${id} (${p.coordinatorSessionId})`).join(', ')}. At its next start the plugin would make a new coordinator for each.`);
const made = plan.groups.filter((g) => !g.join).length;
console.log(`\nResult: ${made} new categories, ${plan.groups.length - made} joined, ${plan.groups.reduce((n, g) => n + g.workspaces.length, 0)} workspaces placed, ${plan.skipped.length} skipped.`);
