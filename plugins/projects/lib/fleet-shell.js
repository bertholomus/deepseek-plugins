/**
 * The all-in-one mod's old sidebar projects, as projects here. Its
 * `<DSH home>/fleet-shell/state.json` lists them in sidebar order
 * (`projects: [{ id, name }]`) and files DSH workspaces under them
 * (`projectOf: { [workspace id]: project id }`, "_none" for Ungrouped).
 * The plan is pure: the plugin's one-time import applies it, and
 * scripts/import-preview.mjs prints it without changing anything.
 *
 * @module dsh-plugin-projects/fleet-shell
 */

/**
 * @param {object} state - the old file's contents.
 * @param {object} here - what this DSH has.
 * @param {Map<string, string>} here.names - each project's name, trimmed and lower-cased, to its id.
 * @param {(workspaceId: string) => boolean} here.known - whether DSH has the workspace.
 * @param {(workspaceId: string) => boolean} here.placed - whether a project here holds it already.
 * @returns {{ groups: { name: string, join?: string, from: string, workspaces: string[] }[], kept: string[], skipped: string[], loose: string[] }}
 *   `groups`: one per name, in the old order, each a new project or one it
 *   joins (`join`, by name), with the workspaces it takes; `kept`: workspaces
 *   a project here already holds; `skipped`: ones DSH no longer has;
 *   `loose`: Ungrouped in the old sidebar, or under an old project that is gone.
 */
export function planFleetShellImport(state, { names, known, placed }) {
    const old = Array.isArray(state?.projects) ? state.projects : [];
    const projectOf = state?.projectOf !== null && typeof state?.projectOf === 'object' ? state.projectOf : {};
    const groups = [];
    const byName = new Map();
    const into = new Map();
    for (const entry of old) {
        const name = typeof entry?.name === 'string' ? entry.name.replace(/\s+/g, ' ').trim() : '';
        if (name === '' || typeof entry.id !== 'string') continue;
        const key = name.toLowerCase();
        let group = byName.get(key);
        if (!group) {
            group = { name, ...(names.has(key) ? { join: names.get(key) } : {}), from: entry.id, workspaces: [] };
            byName.set(key, group);
            groups.push(group);
        }
        into.set(entry.id, group);
    }
    const kept = [];
    const skipped = [];
    const loose = [];
    for (const [workspaceId, oldId] of Object.entries(projectOf)) {
        const group = into.get(oldId);
        if (!group) loose.push(workspaceId);
        else if (!known(workspaceId)) skipped.push(workspaceId);
        else if (placed(workspaceId)) kept.push(workspaceId);
        else group.workspaces.push(workspaceId);
    }
    return { groups, kept, skipped, loose };
}
