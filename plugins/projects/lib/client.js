/**
 * dsh-plugin-projects, browser half: the "Default models" form on the
 * plugin's page in DSH (Plugins → dsh-plugin-projects). It edits the four
 * plugin-wide defaults through DSH's own settings forms, so a save lands in
 * the profile's cordis.patch.yml and the running plugin switches without a
 * restart (projects.js noteDefaults() says how a save meets a change made
 * through a coordinator).
 *
 * Hand-written in the module format DSH serves to the browser, so the plugin
 * needs no build step: the factory gets DSH's module `require` and returns
 * the client plugin (inject + apply).
 *
 * @module dsh-plugin-projects/client
 */
// DSH serves browser halves in one script; never throw here, or the others stop loading too.
if (typeof window !== 'undefined' && window.__ModuleLoader__) window.__ModuleLoader__.load({
    id: 'dsh-plugin-projects',
    factory: (require) => {
        const module = { exports: {} };
        Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' });
        const React = require('react');
        const ui = require('@deepseek-ai/dsh-client-ui-primitives');
        const h = React.createElement;

        /** The plugin's row id in the profile; DSH serves its settings under it. */
        const ENTRY = 'projects';
        /** The package whose page shows the form. */
        const BUNDLE = 'dsh-plugin-projects';
        const ROUTES = [
            { id: 'coordinator', title: 'Coordinator', hint: 'The ◆ session you talk to in each project.', model: 'coordinatorModel', effort: 'coordinatorEffort' },
            { id: 'thread', title: 'New threads', hint: 'A running thread keeps the model it started with.', model: 'threadModel', effort: 'threadEffort' },
        ];
        const FIELDS = ROUTES.flatMap((route) => [route.model, route.effort]);
        const LABELS = {
            unavailable: 'The projects plugin is not running, so its defaults cannot be changed right now.',
            readOnly: 'This DSH stores settings read-only.',
            saveFailed: 'DSH did not save these. Your choices are still here, so you can try again.',
            save: 'Save',
            saving: 'Saving…',
        };
        const INSERTED_TWICE = 'DSH can\'t save here because your profile adds this plugin with "insert:" (the older setup). In cordis.patch.yml, change that row to "- id: projects" with its "config:", as in the plugin README. Below is what the plugin runs with now.';
        const NOTE = 'These apply to every project that doesn\'t set its own in the profile. Asking a coordinator to change one changes it for that project until you change it here again.';

        const CSS = [
            '.dshp-heading{margin:0 0 4px;font-size:14px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshp-section{display:flex;flex-direction:column;gap:2px;padding:12px 0}',
            '.dshp-section+.dshp-section{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-title{margin:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshp-hint,.dshp-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-note{padding-top:4px}',
            '.dshp-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-top:8px}',
            '.dshp-field{display:flex;flex-direction:column;gap:6px;min-width:0}',
            '.dshp-field.dshp-model{flex:1 1 240px}',
            '.dshp-label{font-size:12px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
            '.dshp-select{height:34px;min-width:0;padding:0 10px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshp-select:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}',
            '.dshp-select:disabled{color:var(--dsw-alias-label-tertiary)}',
        ].join('');
        const CSS_ID = `${BUNDLE}/client.css`;
        if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`) === null) {
            const tag = document.createElement('style');
            tag.dataset.plugin = BUNDLE;
            tag.dataset.pluginCss = CSS_ID;
            tag.textContent = CSS;
            document.head.appendChild(tag);
        }

        /** The Host model catalog, read again each time the form opens. */
        function catalogSource(ctx) {
            let snapshot = { status: 'idle', value: undefined };
            const listeners = new Set();
            const set = (next) => {
                snapshot = next;
                for (const listener of [...listeners]) listener();
            };
            return {
                getSnapshot: () => snapshot,
                subscribe: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                load() {
                    if (snapshot.status === 'loading') return;
                    set({ status: 'loading', value: snapshot.value });
                    let session;
                    try { session = ctx.remote.session; } catch { session = undefined; }
                    if (!session || typeof session.modelCatalog !== 'function') {
                        set({ status: 'failed', value: undefined });
                        return;
                    }
                    Promise.resolve().then(() => session.modelCatalog()).then((result) => {
                        const value = result && result.ok === true ? result.value : result && Array.isArray(result.groups) ? result : undefined;
                        set(value ? { status: 'ready', value } : { status: 'failed', value: snapshot.value });
                    }, () => set({ status: 'failed', value: snapshot.value }));
                },
            };
        }

        /** Every model in a catalog, keyed "provider:model" as the plugin stores it. */
        function modelsOf(catalog) {
            const out = [];
            for (const group of (catalog && catalog.groups) || []) {
                for (const model of group.models || []) {
                    const reasoning = model.reasoning || {};
                    out.push({
                        key: `${group.id}:${model.id}`,
                        provider: group.id,
                        providerName: group.name || group.id,
                        id: model.id,
                        name: model.name || model.id,
                        efforts: (reasoning.efforts || []).map((e) => ({ id: e.id, name: e.name || e.id })),
                        defaultEffort: reasoning.defaultEffort,
                    });
                }
            }
            return out;
        }

        /** The catalog model a stored value names: "provider:model", "provider/model" or a bare id. */
        function findModel(models, text, defaultProvider) {
            const value = String(text || '').trim();
            if (value === '') return undefined;
            const m = /^([a-zA-Z0-9_-]+)[:/](.+)$/.exec(value);
            if (m) return models.find((x) => x.provider === m[1] && x.id === m[2]);
            const hits = models.filter((x) => x.id === value);
            return hits.find((x) => x.provider === defaultProvider) || hits[0];
        }

        const effortName = (model, id) => ((model && model.efforts.find((e) => e.id === id)) || { name: id }).name;

        /**
         * Whether the profile adds the plugin's row with `insert` (the older
         * setup): the row is then in the profile twice, the plugin runs the
         * later one, and DSH refuses every save. It shows as values the plugin
         * runs with that come from neither layer a save edits.
         */
        function insertedTwice(snapshot) {
            if (!snapshot || snapshot.status !== 'ready') return false;
            const has = (layer, key) => layer !== null && typeof layer === 'object' && layer[key] !== undefined && layer[key] !== '';
            return FIELDS.some((key) => has(snapshot.value, key) && !has(snapshot.user, key) && !has(snapshot.base, key));
        }

        function ModelField({ id, field, models, catalog, disabled, onEdit }) {
            // Until the catalog arrives, a stored model is shown as it is, not as missing.
            const known = models.length > 0;
            const def = catalog && catalog.default;
            const defaultModel = def ? findModel(models, `${def.provider}:${def.model}`) : undefined;
            const chosen = findModel(models, field.text, def && def.provider);
            const value = field.text === '' ? '' : chosen ? chosen.key : field.text;
            const groups = [];
            for (const model of models) {
                let group = groups.find((g) => g.provider === model.provider);
                if (!group) groups.push(group = { provider: model.provider, name: model.providerName, models: [] });
                group.models.push(model);
            }
            return h('div', { className: 'dshp-field dshp-model' },
                h('label', { className: 'dshp-label', htmlFor: id }, 'Model'),
                h('select', {
                    id, className: 'dshp-select', value, disabled,
                    onChange: (event) => onEdit(event.target.value),
                },
                h('option', { value: '' }, `DSH default${defaultModel ? ` (${defaultModel.name})` : ''}`),
                ...groups.map((group) => h('optgroup', { key: group.provider, label: group.name },
                    ...group.models.map((model) => h('option', { key: model.key, value: model.key }, model.name)))),
                value !== '' && !chosen ? h('option', { value }, known ? `${value} (not in this DSH)` : value) : null));
        }

        /**
         * The effort segments. "Default" is what the plugin then sends: with
         * no model set, the effort of your DSH default; with a model set, that
         * model's own default.
         */
        function EffortField({ id, field, model, known, dshDefault, catalog, disabled, onEdit }) {
            const efforts = model ? model.efforts : [];
            const def = catalog && catalog.default;
            const fallback = (dshDefault && def && def.reasoningEffort) || (model && model.defaultEffort);
            const options = [{ value: 'default', label: fallback ? `Default (${effortName(model, fallback)})` : 'Default' }]
                .concat(efforts.map((e) => ({ value: e.id, label: e.name })));
            // Only a model the catalog lists can say an effort is not offered (or that it has none).
            const listed = known && model !== undefined;
            if (field.text !== '' && !efforts.some((e) => e.id === field.text)) options.push({ value: field.text, label: listed ? `${field.text} (not offered)` : field.text });
            return h('div', { className: 'dshp-field' },
                h('span', { className: 'dshp-label', id: `${id}-label` }, 'Effort'),
                options.length < 2 && listed
                    ? h('p', { className: 'dshp-hint' }, 'This model has no effort levels.')
                    : h(ui.SegmentedControl, {
                        id, label: 'Effort', disabled, options,
                        value: field.text === '' ? 'default' : field.text,
                        onChange: (next) => onEdit(next === 'default' ? '' : next),
                    }));
        }

        /** Plain text controls, for a DSH whose model catalog cannot be read. */
        function TextFields({ route, state, actions, disabled }) {
            const text = (name, label, hint) => h(ui.SettingsValueField, {
                id: `dshp-${route.id}-${name}`, label, hint,
                overriddenLabel: 'Set here', resetLabel: 'Use default', invalidLabel: 'Not a valid value.',
                disabled, placeholder: 'Default',
                ...state[name],
                onEdit: (value) => actions.edit(name, value),
                onReset: () => actions.resetField(name),
            });
            return [
                text(route.model, 'Model', '"provider:model" or a model id; empty uses the DSH default.'),
                text(route.effort, 'Effort', 'For DeepSeek: off, low, high or max; empty uses the model default.'),
            ];
        }

        function RouteSection({ route, state, actions, catalog, models, disabled }) {
            const field = state[route.model];
            const def = catalog.value && catalog.value.default;
            const model = field.text === ''
                ? def && findModel(models, `${def.provider}:${def.model}`)
                : findModel(models, field.text, def && def.provider);
            const pickers = catalog.status === 'failed' && models.length === 0
                ? TextFields({ route, state, actions, disabled })
                : [
                    h(ModelField, { key: 'model', id: `dshp-${route.id}-model`, field, models, catalog: catalog.value, disabled, onEdit: (value) => actions.edit(route.model, value) }),
                    h(EffortField, { key: 'effort', id: `dshp-${route.id}-effort`, field: state[route.effort], model, known: models.length > 0, dshDefault: field.text === '', catalog: catalog.value, disabled, onEdit: (value) => actions.edit(route.effort, value) }),
                ];
            return h('section', { className: 'dshp-section', 'data-projects-route': route.id },
                h('h4', { className: 'dshp-title' }, route.title),
                h('p', { className: 'dshp-hint' }, route.hint),
                h('div', { className: 'dshp-row' }, ...pickers));
        }

        function DefaultsForm({ form, catalog }) {
            const snapshot = React.useSyncExternalStore(form.subscribe, form.getSnapshot);
            const cat = React.useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
            React.useEffect(() => { catalog.load(); }, [catalog]);
            const models = modelsOf(cat.value);
            // A save would be refused, so the form shows the values read-only with the fix.
            const state = snapshot.insertedTwice ? { ...snapshot, writable: false } : snapshot;
            const labels = snapshot.insertedTwice ? { ...LABELS, readOnly: INSERTED_TWICE } : LABELS;
            const disabled = !state.writable || state.saving;
            return h('div', { 'data-projects-defaults': true },
                h('h3', { className: 'dshp-heading' }, 'Default models'),
                h(ui.SettingsForm, { labels, state, onSave: form.actions.save, onDiscard: form.actions.discard },
                    ...ROUTES.map((route) => h(RouteSection, { key: route.id, route, state, actions: form.actions, catalog: cat, models, disabled })),
                    h('p', { className: 'dshp-note' }, NOTE)));
        }

        /** Required services (cordis inject). */
        const inject = ['slots', 'configForms', 'remote', 'remote.session'];

        function apply(ctx) {
            const scope = ctx.configForms.get(ENTRY);
            const model = new ui.SettingsFormModel(scope, FIELDS.map((name) => ui.settingsTextField(name)));
            const store = model.bind(() => ({
                ...model.shell(),
                insertedTwice: insertedTwice(scope.getSnapshot()),
                ...Object.fromEntries(FIELDS.map((name) => [name, model.field(name)])),
            }));
            const form = {
                subscribe: (listener) => store.subscribe(listener),
                getSnapshot: () => store.getSnapshot(),
                actions: model.actions(),
            };
            ctx.effect(() => () => model.dispose(), 'projects: defaults form');
            const catalog = catalogSource(ctx);
            const Page = (props) => (props.view === 'summary'
                ? 'Default models and effort for coordinators and threads.'
                : h(DefaultsForm, { form, catalog }));
            ctx.effect(() => ctx.configForms.whileServed([ENTRY], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
                name: 'plugins.bundle.config',
                key: BUNDLE,
            }, Page))), 'projects: defaults page');
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        return module.exports;
    },
});
