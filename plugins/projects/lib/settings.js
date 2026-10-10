/**
 * Model and effort settings. Four settings per project:
 * coordinator model, coordinator effort, thread model, thread effort. Each
 * resolves from the first layer that sets it:
 *
 *   the project's own setting (its Project settings dialog, its coordinator's
 *   DSH model picker, or the project_settings tool) → project row in the
 *   profile → plugin row → DSH default
 *
 * A thread fixes its model and effort when it starts (start arguments win
 * over the thread defaults), and keeps them until changed with
 * project_thread_update, the dialog or its own model picker. Pure
 * functions, no host imports.
 *
 * @module dsh-plugin-projects/settings
 */

export const SETTING_KEYS = ['coordinatorModel', 'coordinatorEffort', 'threadModel', 'threadEffort'];

const set = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * The four plugin-wide defaults as plain values. DSH hands them over as live
 * references (`{get()}`) because its settings page edits them while the
 * plugin runs; a test or an older DSH hands over plain strings.
 * @param {object} config - plugin config.
 * @returns {Record<string, string|undefined>}
 */
export function pluginDefaults(config = {}) {
    const read = (v) => (v !== null && typeof v === 'object' && typeof v.get === 'function' ? v.get() : v);
    return Object.fromEntries(SETTING_KEYS.map((key) => [key, read(config[key])]));
}

/**
 * Resolve the four settings and where each came from.
 * @param {object} plugin - plugin config (top-level defaults).
 * @param {object} project - the project's profile row.
 * @param {object} overrides - runtime overrides from the store.
 * @returns {Record<string, {value: string|undefined, source: string}>}
 */
export function effectiveSettings(plugin = {}, project = {}, overrides = {}) {
    const out = {};
    for (const key of SETTING_KEYS) {
        if (set(overrides[key])) out[key] = { value: overrides[key].trim(), source: 'project setting' };
        else if (set(project[key])) out[key] = { value: project[key].trim(), source: 'project config' };
        else if (set(plugin[key])) out[key] = { value: plugin[key].trim(), source: 'plugin default' };
        else out[key] = { value: undefined, source: 'DSH default' };
    }
    return out;
}

/**
 * Parse "provider:model", "provider/model" or a bare model id.
 * @param {string} spec
 * @param {string} fallbackProvider - provider for a bare id.
 * @returns {{provider: string, model: string}|null}
 */
export function parseModelSpec(spec, fallbackProvider) {
    const value = String(spec ?? '').trim();
    if (value === '') return null;
    const m = value.match(/^([a-zA-Z0-9_-]+)[:/](.+)$/);
    if (m) return { provider: m[1], model: m[2] };
    return { provider: fallbackProvider, model: value };
}

/**
 * Rewrite one resolved model request config with a project route. An unset
 * model leaves the request's model alone. A set model without an effort runs
 * at that model's own default effort, as a DSH model selection does.
 * @param {object} resolved - config proposed by the `agent/request` waterfall.
 * @param {string|undefined} modelSpec
 * @param {string|undefined} effort
 */
export function applyRoute(resolved, modelSpec, effort) {
    const next = { ...resolved };
    const parsed = set(modelSpec) ? parseModelSpec(modelSpec, next.provider) : null;
    if (parsed) {
        next.provider = parsed.provider;
        next.model = parsed.model;
        delete next.reasoningEffort;
    }
    if (set(effort)) next.reasoningEffort = effort.trim();
    return next;
}

/** Every model in a catalog as {provider, model, efforts}. */
function catalogModels(catalog) {
    const out = [];
    for (const group of catalog?.groups ?? []) {
        for (const model of group.models ?? []) {
            out.push({ provider: group.id, model: model.id, efforts: (model.reasoning?.efforts ?? []).map((e) => e.id) });
        }
    }
    return out;
}

/** Effort names from least to most reasoning; others rank by where models list them. */
const EFFORT_ORDER = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * The level a model offers that comes closest to an effort it doesn't: the
 * highest one at or below it (max → high), else its lowest one.
 * @param {string[]} offered - the model's efforts.
 * @param {string} effort - the wanted effort, offered by some other model.
 * @param {string[]} known - every effort in the catalog, in listing order.
 */
function nearestEffort(offered, effort, known) {
    const rank = (e) => {
        const i = EFFORT_ORDER.indexOf(e);
        return i >= 0 ? i : EFFORT_ORDER.length + known.indexOf(e);
    };
    const below = offered.filter((e) => rank(e) <= rank(effort)).sort((a, b) => rank(b) - rank(a));
    return below[0] ?? [...offered].sort((a, b) => rank(a) - rank(b))[0];
}

/**
 * Check a model spec and effort against the host model catalog, and return
 * the canonical "provider:model". With no catalog, accept as given. A model
 * with no effort levels drops the effort and says so in `note`, so a
 * project-wide effort default does not break threads on such a model.
 *
 * `fit` says what to do with an effort the model doesn't offer. Strict
 * (false) refuses it, for a value someone is setting now. 'known' runs the
 * nearest level the model offers and says so, but still refuses an effort no
 * model offers. true never refuses over effort: an inherited default must
 * not stop a thread from starting because the DSH default model changed.
 * @param {object|undefined} catalog - sessionController.modelCatalog() value.
 * @param {string|undefined} modelSpec - requested model, or undefined to keep the default.
 * @param {string|undefined} effort - requested effort, or undefined.
 * @param {{fit?: boolean|'known'}} [options]
 * @returns {{ok: true, model?: string, effort?: string, note?: string, fitted?: boolean} | {ok: false, error: string}}
 */
export function checkSelection(catalog, modelSpec, effort, { fit = false } = {}) {
    const models = catalogModels(catalog);
    const fallbackProvider = catalog?.default?.provider ?? '';
    let entry = null;
    let model;
    if (set(modelSpec)) {
        const value = modelSpec.trim();
        const explicit = /^([a-zA-Z0-9_-]+)[:/](.+)$/.test(value);
        const parsed = parseModelSpec(value, fallbackProvider);
        if (models.length > 0) {
            const hits = explicit
                ? models.filter((m) => m.provider === parsed.provider && m.model === parsed.model)
                : models.filter((m) => m.model === parsed.model);
            entry = hits.find((m) => m.provider === fallbackProvider) ?? hits[0] ?? null;
            if (!entry) {
                const sample = models.slice(0, 12).map((m) => `${m.provider}:${m.model}`).join(', ');
                return { ok: false, error: `unknown model "${value}". Available: ${sample}${models.length > 12 ? ', ...' : ''}` };
            }
            model = `${entry.provider}:${entry.model}`;
        } else {
            model = explicit || !fallbackProvider ? value : `${fallbackProvider}:${value}`;
        }
    } else if (catalog?.default) {
        entry = models.find((m) => m.provider === catalog.default.provider && m.model === catalog.default.model) ?? null;
    }
    if (set(effort)) {
        const e = effort.trim();
        const known = [...new Set(models.flatMap((m) => m.efforts))];
        const unknown = known.length > 0 && !known.includes(e);
        const name = entry ? `${entry.provider}:${entry.model}` : '';
        if (unknown && fit !== true) {
            return { ok: false, error: `effort "${e}" is not offered by any model. Efforts in this DSH: ${known.join(', ')}` };
        }
        if (entry && entry.efforts.length === 0) {
            return { ok: true, ...(model ? { model } : {}), note: `${name} has no effort levels, so effort "${e}" is not used` };
        }
        if (entry && !entry.efforts.includes(e)) {
            if (!fit) return { ok: false, error: `effort "${e}" is not offered by ${name}. Choose one of: ${entry.efforts.join(', ')}` };
            if (unknown) return { ok: true, ...(model ? { model } : {}), fitted: true, note: `effort "${e}" is not offered by any model, so ${name} runs at its default effort` };
            const near = nearestEffort(entry.efforts, e, known);
            return { ok: true, ...(model ? { model } : {}), effort: near, fitted: true, note: `${name} doesn't offer effort "${e}", so it runs at "${near}"` };
        }
        return { ok: true, ...(model ? { model } : {}), effort: e };
    }
    return { ok: true, ...(model ? { model } : {}) };
}

/** One-line description of a model/effort pair for the model and the user. */
export function describeRoute(model, effort) {
    return `${model ?? 'DSH default model'} · effort ${effort ?? 'default'}`;
}
