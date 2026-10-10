/**
 * Categories from groups. Before categories, a project was also a group of
 * DSH workspaces in the session list (`workspaceOf`), with or without a
 * coordinator. Categories now group workspaces, and a project lives in one
 * workspace. The move is planned here, purely: the plugin applies it once
 * (`migrateCategories` in projects.js), and scripts/import-preview.mjs
 * prints it without changing anything.
 *
 * @module dsh-plugin-projects/categories
 */

const plain = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {});

/**
 * @param {object} stored - the store's `projects` and `workspaceOf`.
 * @param {{id: string, name: string}[]} profile - the profile's projects, in the profile's order.
 * @param {string} now - the time to stamp categories without one.
 * @returns {{ categories: Record<string, object>, categoryOf: Record<string, string>, order: string[] }}
 *   Each group that holds a workspace, and each one made on the Projects
 *   page or imported (an empty one too), as a category with the same id,
 *   name and place in the list (the profile's projects first, then the
 *   others as they were made or imported), holding the same workspaces.
 *   A profile project that never held a workspace was never a group, so it
 *   makes none.
 */
export function planCategories(stored, profile, now) {
    const projects = plain(stored?.projects);
    const workspaceOf = plain(stored?.workspaceOf);
    const members = (id) => Object.keys(workspaceOf).filter((ws) => workspaceOf[ws] === id);
    const fromProfile = new Map(profile.map((p) => [p.id, p.name]));
    const named = (id) => typeof projects[id]?.name === 'string' && projects[id].name.trim() !== '';
    const others = Object.keys(projects).filter((id) => !fromProfile.has(id) && named(id))
        .map((id, i) => ({ id, i, at: Number.isFinite(projects[id].order) ? projects[id].order : Infinity }))
        .sort((a, b) => a.at - b.at || a.i - b.i)
        .map(({ id }) => id);
    const categories = {};
    const categoryOf = {};
    const order = [];
    for (const id of [...profile.map((p) => p.id), ...others]) {
        const entry = plain(projects[id]);
        const held = members(id);
        if (held.length === 0 && fromProfile.has(id)) continue;
        categories[id] = {
            name: String(fromProfile.has(id) ? fromProfile.get(id) : entry.name).trim(),
            order: order.length,
            createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : now,
            source: entry.source === 'import' ? 'import' : 'group',
            ...(typeof entry.importedFrom === 'string' ? { importedFrom: entry.importedFrom } : {}),
        };
        order.push(id);
        for (const ws of held) if (categoryOf[ws] === undefined) categoryOf[ws] = id;
    }
    return { categories, categoryOf, order };
}
