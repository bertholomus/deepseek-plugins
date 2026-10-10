#!/usr/bin/env node
/**
 * What the plugin's one-time import of the all-in-one mod's old sidebar
 * projects does in this DSH, shown before it runs. It only reads:
 * <DSH home>/fleet-shell/state.json, DSH's workspaces
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

const home = dshHome();
const read = (file) => {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        return error;
    }
};
const short = (path) => (typeof path === 'string' && path.startsWith(`${homedir()}/`) ? `~${path.slice(homedir().length)}` : path);

console.log(`Import preview for ${short(home)}. Read-only: nothing changes.`);
const oldFile = join(home, 'fleet-shell', 'state.json');
const state = read(oldFile);
if (state instanceof Error) {
    console.log(state.code === 'ENOENT' ? `Nothing to import: ${short(oldFile)} doesn't exist.` : `The import would log an error and do nothing: ${short(oldFile)} can't be read (${state.message}).`);
    process.exit(0);
}
const workspaceFile = join(home, 'storages', 'workspace.json');
const registry = read(workspaceFile);
if (registry instanceof Error) {
    console.log(`Can't read DSH's workspaces (${short(workspaceFile)}): ${registry.message}`);
    process.exit(1);
}
const workspaces = registry?.tables?.workspaces ?? {};
const storeFile = dataPath(process.argv[2] ?? '~/.dsh/projects/projects.json');
const store = read(storeFile);
const stored = store instanceof Error ? {} : store;
const projects = stored.projects ?? {};
if (stored.imports?.fleetShell) {
    const done = stored.imports.fleetShell;
    console.log(`Already imported (${done.at}): ${done.projects} projects, ${done.workspaces} workspaces, ${done.skipped} skipped. It won't run again.`);
    process.exit(0);
}

// Where each project's coordinator works: a profile project claims that workspace before the import runs.
const homeOf = new Map();
for (const [id, p] of Object.entries(projects)) {
    const at = p?.home ?? Object.entries(workspaces).find(([, ws]) => Array.isArray(ws?.sessionIds) && ws.sessionIds.includes(p?.coordinatorSessionId))?.[0];
    if (typeof at === 'string') homeOf.set(at, id);
}
const holder = (workspaceId) => stored.workspaceOf?.[workspaceId] ?? homeOf.get(workspaceId);
const names = new Map(Object.entries(projects).filter(([, p]) => typeof p?.name === 'string').map(([id, p]) => [p.name.trim().toLowerCase(), id]));
const plan = planFleetShellImport(state, { names, known: (id) => Boolean(workspaces[id]), placed: (id) => holder(id) !== undefined });
const label = (id) => {
    const ws = workspaces[id];
    return ws ? `${ws.title || id} (${short(ws.path)})` : id;
};

console.log(`From ${short(oldFile)}, once, at the first DSH start with this version:\n`);
plan.groups.forEach((group, i) => {
    console.log(`${i + 1}. ${group.name}${group.join ? ` joins the project "${group.join}" (same name)` : ', a new project without a coordinator'}`);
    for (const id of group.workspaces) console.log(`     ${label(id)}`);
    if (group.workspaces.length === 0) console.log('     (no workspaces)');
});
const list = (ids, what) => console.log(`\n${what}: ${ids.length === 0 ? 'none' : ids.map((id) => (holder(id) ? `${label(id)} in "${holder(id)}"` : label(id))).join(', ')}`);
list(plan.kept, 'Already in a project here, stays there');
list(plan.loose, 'Ungrouped in the old sidebar, goes to Other workspaces');
list(plan.skipped, "Gone from DSH, skipped");
// A coordinator this DSH doesn't have means the store came from another DSH (one with its own DSH_HOME, say).
const listed = new Set(Object.values(workspaces).flatMap((ws) => (Array.isArray(ws?.sessionIds) ? ws.sessionIds : [])));
const strangers = Object.entries(projects).filter(([, p]) => typeof p?.coordinatorSessionId === 'string' && !listed.has(p.coordinatorSessionId));
if (strangers.length > 0) console.log(`\nCheck the store first: it names coordinators this DSH doesn't list in any workspace: ${strangers.map(([id, p]) => `${id} (${p.coordinatorSessionId})`).join(', ')}. At its next start the plugin would make a new coordinator for each.`);
const profile = Object.keys(projects).filter((id) => typeof projects[id]?.name !== 'string');
if (profile.length > 0) console.log(`\nProjects from the profile (their names aren't in the store; an old project with the same name would join one): ${profile.join(', ')}`);
const made = plan.groups.filter((g) => !g.join).length;
console.log(`\nResult: ${made} new projects, ${plan.groups.length - made} joined, ${plan.groups.reduce((n, g) => n + g.workspaces.length, 0)} workspaces placed, ${plan.skipped.length} skipped.`);
