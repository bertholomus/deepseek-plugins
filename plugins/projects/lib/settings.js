/**
 * Model and effort settings. Four settings mirror Claude Code's project page:
 * coordinator model, coordinator effort, thread model, thread effort. Each
 * resolves from the first layer that sets it:
 *
 *   runtime override (project_settings tool) → project row in the profile → plugin row → DSH default
 *
 * A thread fixes its model and effort when it starts (start arguments win
 * over the thread defaults), and keeps them until changed with
 * project_thread_update. Pure functions, no host imports.
 *
 * @module dsh-plugin-projects/settings
 */

export const SETTING_KEYS = ['coordinatorModel', 'coordinatorEffort', 'threadModel', 'threadEffort'];

const set = (v) => typeof v === 'string' && v.trim() !== '';

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

/**
 * Check a model spec and effort against the host model catalog, and return
 * the canonical "provider:model". With no catalog, accept as given. A model
 * with no effort levels drops the effort and says so in `note`, so a
 * project-wide effort default does not break threads on such a model.
 * @param {object|undefined} catalog - sessionController.modelCatalog() value.
 * @param {string|undefined} modelSpec - requested model, or undefined to keep the default.
 * @param {string|undefined} effort - requested effort, or undefined.
 * @returns {{ok: true, model?: string, effort?: string, note?: string} | {ok: false, error: string}}
 */
export function checkSelection(catalog, modelSpec, effort) {
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
        if (entry && entry.efforts.length === 0) {
            // The effort is kept for a later model switch, so refuse one no model offers.
            const known = [...new Set(models.flatMap((m) => m.efforts))];
            if (known.length > 0 && !known.includes(e)) {
                return { ok: false, error: `effort "${e}" is not offered by any model. Efforts in this DSH: ${known.join(', ')}` };
            }
            return { ok: true, ...(model ? { model } : {}), note: `${entry.provider}:${entry.model} has no effort levels, so effort "${e}" is not used` };
        }
        if (entry && !entry.efforts.includes(e)) {
            return { ok: false, error: `effort "${e}" is not offered by ${entry.provider}:${entry.model}. Choose one of: ${entry.efforts.join(', ')}` };
        }
        return { ok: true, ...(model ? { model } : {}), effort: e };
    }
    return { ok: true, ...(model ? { model } : {}) };
}

/** One-line description of a model/effort pair for the model and the user. */
export function describeRoute(model, effort) {
    return `${model ?? 'DSH default model'} · effort ${effort ?? 'default'}`;
}
