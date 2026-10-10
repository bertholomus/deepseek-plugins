/**
 * dsh-plugin-projects, browser half. Two parts:
 *
 * - The "Default models" form on the plugin's page in DSH (Plugins →
 *   dsh-plugin-projects). It edits the four plugin-wide defaults through
 *   DSH's own settings forms, so a save lands in the profile's
 *   cordis.patch.yml and the running plugin switches without a restart
 *   (projects.js noteDefaults() says how a save meets a change made through a
 *   coordinator).
 * - Threads in the chat window, as in Claude Code: a Threads menu in the
 *   header of every project session (a thread also gets a link back to its
 *   coordinator), a Threads pane in the right sidebar, thread cards under the
 *   coordinator turns that started or heard from a thread, a thread's chat
 *   opened beside the current one, thread names in replies that open the
 *   thread, and a mark on thread rows in the session list. It reads the
 *   `projectSession` projection the host half folds (projection.js) and never
 *   reads session logs itself.
 *
 * Hand-written in the module format DSH serves to the browser, so the plugin
 * needs no build step: the factory gets DSH's module `require` and returns
 * the client plugin (inject + apply). Each part waits for the DSH services it
 * uses, so a DSH without some of them still runs the rest.
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
        const ReactDOM = require('react-dom');
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

        /** DSH's branch glyph, as a mask for links drawn by DSH's markdown. */
        const BRANCH_MASK = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.3"><path d="M1.015 8h4.681c.723 0 1.085 0 1.425-.08.302-.072.591-.19.857-.35.3-.18.558-.433 1.075-.939l2.275-2.225"/><path d="M1.012 8h4.684c.723 0 1.085 0 1.425.08.302.072.591.19.857.35.3.18.558.433 1.075.939l2.275 2.225"/><circle cx="12.45" cy="3.308" r="1.57"/><circle cx="12.45" cy="12.692" r="1.57"/></svg>')}")`;
        const CSS = [
            // Default models form
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
            // Threads: header menu
            '.dshp-t-hdr{position:relative;display:inline-flex;align-items:center;gap:2px;min-width:0}',
            '.dshp-t-trigger{display:inline-flex;align-items:center;gap:5px;min-width:0;min-height:28px;padding:3px 6px;border:0;border-radius:var(--dsw-radius-sm);background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;cursor:pointer}',
            '.dshp-t-trigger:hover,.dshp-t-trigger:focus-visible,.dshp-t-trigger[aria-expanded=true]{color:var(--dsw-alias-label-primary)}',
            '.dshp-t-trigger:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-t-trigger svg{flex:none}',
            '.dshp-t-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
            '.dshp-t-parent .dshp-t-label{max-width:180px}',
            '.dshp-t-diamond{flex:none;font-size:10px;line-height:1}',
            '.dshp-t-signal{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px}',
            '.dshp-t-chev{transition:transform .12s}',
            '.dshp-t-chev-open{transform:rotate(180deg)}',
            '@container (width<=480px){.dshp-t-parent .dshp-t-label{display:none}}',
            '.dshp-t-menu{position:fixed;z-index:100;box-sizing:border-box;display:flex;flex-direction:column;width:360px;max-width:calc(100vw - 32px);max-height:min(560px,calc(100vh - 120px));padding:4px;box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);color:var(--dsw-alias-label-primary);outline:none}',
            '.dshp-t-menu-head{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:6px 9px 4px}',
            '.dshp-t-menu-head .dshp-t-project{max-width:100%}',
            '.dshp-t-project{display:inline-flex;align-items:center;gap:6px;flex:1;min-width:0;padding:2px 0;border:0;border-radius:var(--dsw-radius-sm);background:none;font:inherit;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary);text-align:left}',
            'button.dshp-t-project{cursor:pointer}',
            'button.dshp-t-project:hover .dshp-t-project-name,button.dshp-t-project:focus-visible .dshp-t-project-name{text-decoration:underline}',
            'button.dshp-t-project:focus-visible{outline:none}',
            '.dshp-t-project-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-t-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
            '.dshp-t-menu-body{flex:1 1 auto;min-height:0;overflow:auto}',
            '.dshp-t-menu-foot{margin-top:3px;padding-top:3px;border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-t-group{display:flex;align-items:center;gap:4px;box-sizing:border-box;width:100%;padding:8px 9px 3px;border:0;background:none;font:inherit;font-size:11px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-tertiary);text-align:left}',
            'button.dshp-t-group{cursor:pointer;border-radius:var(--dsw-radius-sm)}',
            'button.dshp-t-group:hover,button.dshp-t-group:focus-visible{outline:none;color:var(--dsw-alias-label-primary)}',
            'button.dshp-t-group svg{flex:none;transition:transform .12s}',
            'button.dshp-t-group[aria-expanded=true] svg{transform:rotate(90deg)}',
            // Threads: rows (menu and pane)
            '.dshp-t-row{position:relative;display:flex;align-items:flex-start;gap:8px;box-sizing:border-box;width:100%;min-height:44px;padding:6px 6px 6px 9px;border-radius:var(--dsw-radius-lg);font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);cursor:pointer;outline:none}',
            '.dshp-t-row:hover,.dshp-t-row:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-t-row[aria-disabled=true]{cursor:default}',
            '.dshp-t-row[aria-disabled=true]:hover{background:none}',
            '.dshp-t-dot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:17px}',
            '.dshp-t-text{display:flex;flex-direction:column;flex:1;min-width:0}',
            '.dshp-t-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-t-row[aria-current=true] .dshp-t-name{font-weight:600}',
            '.dshp-t-line{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-meta{flex:none;display:inline-flex;align-items:center;gap:6px;height:17px;font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}',
            '.dshp-t-id{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px}',
            '.dshp-t-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:-4px -2px -4px 0;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
            '.dshp-t-icon:hover,.dshp-t-icon:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
            '.dshp-t-notice{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 9px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-error{color:var(--dsw-alias-state-error-primary)}',
            '.dshp-t-retry{flex:none;display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border:0;border-radius:var(--dsw-radius-sm);background:none;font:inherit;font-size:12px;color:inherit;cursor:pointer}',
            '.dshp-t-retry:hover,.dshp-t-retry:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-t-foot-btn{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:32px;padding:6px 9px;border:0;border-radius:var(--dsw-radius-lg);background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer}',
            '.dshp-t-foot-btn:hover,.dshp-t-foot-btn:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
            // Threads: right-sidebar pane
            '.dshp-t-pane{box-sizing:border-box;height:100%;overflow:auto;padding:14px 10px 24px;color:var(--dsw-alias-label-primary)}',
            '.dshp-t-pane-head{display:flex;flex-direction:column;gap:2px;padding:0 10px 8px}',
            '.dshp-t-pane-head .dshp-t-project{font-size:14px;line-height:20px}',
            '.dshp-t-pane-head .dshp-t-count{font-size:12px;line-height:18px}',
            '.dshp-t-pane .dshp-t-row{min-height:54px;padding:8px 8px 8px 10px;font-size:13px;line-height:18px}',
            '.dshp-t-pane .dshp-t-dot,.dshp-t-pane .dshp-t-meta{height:18px}',
            '.dshp-t-pane .dshp-t-line{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;font-size:12px;line-height:17px}',
            '.dshp-t-pane .dshp-t-group{padding:12px 10px 4px}',
            '.dshp-t-empty{padding:28px 16px;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            // Threads: a thread's chat in the right sidebar
            '.dshp-t-chat{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0}',
            '.dshp-t-chat-bar{flex:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:40px;padding:4px 8px 4px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-t-chat-title{display:flex;flex-direction:column;flex:1;min-width:0}',
            '.dshp-t-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;line-height:17px;color:var(--dsw-alias-label-primary)}',
            '.dshp-t-chat-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-chat-body{display:flex;flex:1 1 auto;min-width:0;min-height:0}',
            '.dshp-t-tab-title{display:inline-flex;align-items:center;gap:6px;min-width:0}',
            '.dshp-t-tab-title>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            // Threads: cards under a turn
            '.dshp-t-cards{display:flex;flex-direction:column;overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);container-type:inline-size}',
            '.dshp-t-card{display:flex;align-items:center;gap:10px;box-sizing:border-box;min-height:48px;padding:8px 10px 8px 12px}',
            '.dshp-t-card+.dshp-t-card{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-t-card-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-card-text{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}',
            '.dshp-t-card-verb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-card-title{align-self:flex-start;max-width:100%;overflow:hidden;padding:0;border:0;background:none;font:inherit;font-size:13px;font-weight:500;line-height:19px;color:var(--dsw-alias-label-primary);text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
            '.dshp-t-card-title:hover,.dshp-t-card-title:focus-visible{outline:none;text-decoration:underline}',
            '.dshp-t-card-title:disabled{cursor:default;text-decoration:none}',
            '.dshp-t-card-state{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
            '.dshp-t-card-actions{flex:none;display:inline-flex;align-items:center;gap:4px}',
            '.dshp-t-card-actions .dshp-t-icon{width:28px;height:28px;margin:0}',
            '@container (width<=460px){.dshp-t-card-state-label{display:none}}',
            // Threads: `[title](.dsh-thread/t3)` in a reply (DSH draws it as a file link)
            'button[title*=".dsh-thread/"]>svg:first-child{display:none}',
            `button[title*=".dsh-thread/"]::before{content:"";display:inline-block;flex:none;width:1.1em;height:1.1em;margin-right:5px;vertical-align:-.25em;background-color:currentColor;-webkit-mask:${BRANCH_MASK} center/contain no-repeat;mask:${BRANCH_MASK} center/contain no-repeat}`,
            // Threads: session list rows
            '.dshp-t-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-hover{display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:#cfd3d6}',
            '.dshp-t-hover-head{display:flex;align-items:center;gap:6px;color:#fff}',
            '.dshp-t-hover-line{color:#adb2b8;overflow-wrap:anywhere}',
        ].join('');
        const CSS_ID = `${BUNDLE}/client.css`;
        if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(CSS_ID)}]`) === null) {
            const tag = document.createElement('style');
            tag.dataset.plugin = BUNDLE;
            tag.dataset.pluginCss = CSS_ID;
            tag.textContent = CSS;
            document.head.appendChild(tag);
        }

        // ── Default models form ────────────────────────────────────────────

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

        function applyDefaultsForm(ctx) {
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

        // ── Threads in the chat window ─────────────────────────────────────

        /** The projection the host half folds for every session (projection.js). */
        const KEY = 'projectSession';
        /** A thread's chat in the right sidebar: `dsh-resource://projectthread/session/<session id>`. */
        const CHAT_PROTOCOL = 'projectthread';
        const CHAT_PREFIX = `dsh-resource://${CHAT_PROTOCOL}/session/`;
        const KINDS = { chat: 'projectthread', pane: 'projectthreads', link: 'projectthreadlink' };
        const IDS = {
            menu: `${BUNDLE}/threads-menu`,
            cards: `${BUNDLE}/thread-cards`,
            mark: `${BUNDLE}/thread-mark`,
            hover: `${BUNDLE}/thread-hover`,
            chat: `${BUNDLE}/thread-chat`,
            pane: `${BUNDLE}/threads-pane`,
            link: `${BUNDLE}/thread-link`,
        };
        /** The conversation inside a thread's sidebar chat; its tab body declares it. */
        const CONVERSATION_SLOT = 'projects.thread.conversation';
        /**
         * A coordinator reply names a thread as `[title](.dsh-thread/t3)`
         * (prompts.js threadLink); DSH turns that relative link into a file
         * address of the session, which the link tab type claims.
         */
        const LINK = /^dsh-resource:\/\/file\/session\/([^/?#]+)\/\.dsh-thread\/(t\d+)\/?(?:[?#].*)?$/i;
        const EMPTY = Object.freeze([]);
        const NO_PROJECT = Object.freeze({});
        const TEXT = {
            threads: 'Threads',
            thread: 'Thread',
            coordinator: 'Coordinator',
            openCoordinator: 'Open the coordinator',
            open: 'Open',
            openBeside: 'Open beside',
            openMain: 'Open as the main chat',
            openPane: 'Open the Threads panel',
            current: 'This chat',
            loading: 'Loading threads…',
            failed: 'Could not load this project\'s threads.',
            noCoordinator: 'This thread\'s coordinator isn\'t known yet.',
            retry: 'Retry',
            empty: 'No threads yet. When work needs its own session, the coordinator starts a thread and it shows up here.',
            notProject: 'Threads belong to projects. Open a project\'s ◆ coordinator or one of its threads to see them here.',
            chatGone: 'This thread\'s chat can\'t be opened. It may have been deleted.',
            linkLoading: 'Opening the thread…',
            linkNotProject: 'This chat isn\'t part of a project, so it has no threads.',
        };
        const GROUPS = [
            { id: 'waiting', label: 'Waiting on you' },
            { id: 'running', label: 'Running' },
            { id: 'idle', label: 'Idle' },
            { id: 'resolved', label: 'Resolved' },
        ];
        const HANDBACK_LABELS = { done: 'Done', blocked: 'Blocked', needs_decision: 'Needs your decision', progress: 'Progress update' };

        const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
        const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
        const threadNumber = (id) => Number(String(id).slice(1)) || 0;

        /** A session's `projectSession` value from DSH's shared session store, or undefined. */
        function valueIn(state, sessionId) {
            if (typeof sessionId !== 'string' || sessionId === '' || !state) return undefined;
            const value = state.projectionsBySession?.[sessionId]?.values?.[KEY] ?? state.byId?.[sessionId]?.projectionValues?.[KEY];
            return isObject(value) && (value.role === 'coordinator' || value.role === 'thread') ? value : undefined;
        }

        const chatAddress = (sessionId) => `${CHAT_PREFIX}${encodeURIComponent(sessionId)}`;

        /** The session a thread chat address names, or undefined. */
        function chatSessionOf(address) {
            let url;
            try { url = new URL(address); } catch { return undefined; }
            if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== CHAT_PROTOCOL) return undefined;
            const parts = url.pathname.split('/').filter(Boolean);
            if (parts.length !== 2 || parts[0] !== 'session') return undefined;
            try { return decodeURIComponent(parts[1]) || undefined; } catch { return undefined; }
        }

        /** The session and thread a `.dsh-thread/t3` link names, or undefined. */
        function linkTarget(address) {
            const m = LINK.exec(String(address));
            if (!m) return undefined;
            try { return { sessionId: decodeURIComponent(m[1]), threadId: m[2].toLowerCase() }; } catch { return undefined; }
        }

        /** "now", "5m", "3h", "2d", … for a moment in epoch ms. */
        function ago(at, now) {
            if (!Number.isFinite(at)) return '';
            const { unit, n } = ui.relativeTime(at, now);
            switch (unit) {
                case 'now': return 'now';
                case 'minutes': return `${n}m`;
                case 'hours': return `${n}h`;
                case 'days': return `${n}d`;
                case 'months': return `${n}mo`;
                default: return `${n}y`;
            }
        }

        /**
         * Where a session sits in its project: its own value, its coordinator,
         * the project, and the coordinator's roster (null while unknown).
         */
        function projectContext(state, sessionId) {
            const me = valueIn(state, sessionId);
            if (!me) return undefined;
            if (me.role === 'coordinator') {
                return { me, coordinator: sessionId, project: me.project ?? NO_PROJECT, roster: Array.isArray(me.threads) ? me.threads : EMPTY, load: 'ready' };
            }
            const coordinator = typeof me.coordinator === 'string' && me.coordinator !== '' ? me.coordinator : undefined;
            const parent = valueIn(state, coordinator);
            const roster = parent && Array.isArray(parent.threads) ? parent.threads : null;
            const load = roster !== null ? 'ready' : coordinator === undefined ? 'none' : state.projectionsBySession?.[coordinator]?.state ?? 'idle';
            return { me, coordinator, project: parent?.project ?? me.project ?? NO_PROJECT, roster, load };
        }
        const sameContext = (a, b) => a === b || (a !== undefined && b !== undefined && a.me === b.me && a.coordinator === b.coordinator
            && a.project === b.project && a.roster === b.roster && a.load === b.load);

        /** What a pending interaction asks of the user, in a few words. */
        function pendingLine(pending) {
            const kind = String(pending?.kind ?? '');
            return /question|review/i.test(kind) ? 'Has a question for you' : 'Waiting for your approval';
        }

        /** One roster entry with its live state, as the menu, the pane and the cards show it. */
        function threadRow(entry, statuses, byId) {
            const session = typeof entry.session === 'string' && entry.session !== '' ? entry.session : undefined;
            const status = session ? statuses?.get?.(session) : undefined;
            const summary = session ? byId?.[session] : undefined;
            const running = (status?.running ?? summary?.running) === true;
            const pending = status?.pendingInteraction ?? undefined;
            const hb = isObject(entry.handback) ? entry.handback : undefined;
            const asks = hb?.status === 'needs_decision' || hb?.status === 'blocked';
            const group = entry.resolved ? 'resolved' : pending || (!running && asks) ? 'waiting' : running ? 'running' : 'idle';
            const dot = group === 'waiting' ? 'warning' : group === 'running' ? 'ongoing' : group === 'resolved' || hb?.status === 'done' ? 'done' : 'idle';
            const told = hb ? `${HANDBACK_LABELS[hb.status] ?? hb.status}${hb.summary ? ` · ${hb.summary}` : ''}` : undefined;
            const line = pending ? pendingLine(pending)
                : running ? (hb?.status === 'progress' && hb.summary ? `Working… · ${hb.summary}` : 'Working…')
                    : told ?? (entry.resolved ? 'Resolved' : 'No handback yet');
            const stateLabel = group === 'running' ? 'Running'
                : group === 'waiting' ? (pending ? 'Needs you' : hb?.status === 'blocked' ? 'Blocked' : 'Needs a decision')
                    : group === 'resolved' ? 'Resolved' : hb?.status === 'done' ? 'Done' : 'Idle';
            const at = Number.isFinite(summary?.updatedAt) ? summary.updatedAt : Date.parse(hb?.at ?? entry.created ?? '');
            return { entry, id: entry.id, title: entry.title || entry.id, session, group, dot, line, stateLabel, at: Number.isFinite(at) ? at : undefined };
        }

        function rowsOf(roster, statuses, byId) {
            const rows = (roster ?? EMPTY).filter((entry) => isObject(entry) && typeof entry.id === 'string').map((entry) => threadRow(entry, statuses, byId));
            // Newest activity first within a group; then the newest thread.
            return rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || threadNumber(b.id) - threadNumber(a.id));
        }

        function countsOf(rows) {
            const count = (group) => rows.filter((row) => row.group === group).length;
            return { open: rows.length - count('resolved'), running: count('running'), waiting: count('waiting'), resolved: count('resolved') };
        }

        function summaryText(counts) {
            const parts = [`${counts.open} open`];
            if (counts.waiting) parts.push(`${counts.waiting} waiting on you`);
            if (counts.running) parts.push(`${counts.running} running`);
            if (counts.resolved) parts.push(`${counts.resolved} resolved`);
            return parts.join(' · ');
        }

        /** A clock for relative times that ticks while something shows them. */
        function useNow(active) {
            const [now, setNow] = React.useState(() => Date.now());
            React.useEffect(() => {
                if (!active) return undefined;
                setNow(Date.now());
                const timer = setInterval(() => setNow(Date.now()), 30000);
                return () => clearInterval(timer);
            }, [active]);
            return now;
        }

        /** Focusable items of a list, for arrow keys. */
        function focusables(root) {
            return root ? Array.from(root.querySelectorAll('[data-dshp-item]:not([aria-disabled="true"])')) : [];
        }
        function arrowKeys(event, root) {
            const items = focusables(root);
            if (items.length === 0) return;
            const index = items.indexOf(document.activeElement);
            const at = (i) => { event.preventDefault(); items[(i + items.length) % items.length].focus(); };
            if (event.key === 'ArrowDown') at(index + 1);
            else if (event.key === 'ArrowUp') at(index < 0 ? items.length - 1 : index - 1);
            else if (event.key === 'Home') at(0);
            else if (event.key === 'End') at(items.length - 1);
        }

        function ThreadRow({ row, current, now, onOpen, action }) {
            const enabled = !current && row.session !== undefined;
            const open = () => { if (enabled) onOpen(row); };
            return h('div', {
                className: 'dshp-t-row', role: 'button', tabIndex: enabled ? 0 : -1,
                'data-dshp-item': '', 'data-thread': row.id,
                'aria-current': current ? 'true' : undefined,
                'aria-disabled': enabled ? undefined : 'true',
                'aria-label': `${row.title}. ${current ? `${TEXT.current}. ` : ''}${row.line}`,
                onClick: open,
                onKeyDown: (event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    open();
                },
            },
            h('span', { className: 'dshp-t-dot' }, h(ui.StateDot, { state: row.dot })),
            h('span', { className: 'dshp-t-text' },
                h('span', { className: 'dshp-t-name' }, row.title),
                h('span', { className: 'dshp-t-line' }, current ? `${TEXT.current} · ${row.line}` : row.line)),
            h('span', { className: 'dshp-t-meta' },
                h('span', { className: 'dshp-t-id' }, row.id),
                row.at !== undefined ? h('span', null, ago(row.at, now)) : null),
            action && enabled ? h(ui.Tooltip, { label: action.label, side: 'bottom', align: 'end', portal: true },
                h('button', {
                    type: 'button', className: 'dshp-t-icon', 'aria-label': `${action.label}: ${row.title}`,
                    onClick: (event) => { event.preventDefault(); event.stopPropagation(); action.run(row); },
                    onKeyDown: (event) => event.stopPropagation(),
                }, h(action.icon, { size: 14 }))) : null);
        }

        /** Rows grouped as Waiting on you, Running, Idle and Resolved (folded). */
        function ThreadList({ rows, current, now, onOpen, action }) {
            const [showResolved, setShowResolved] = React.useState(() => rows.some((row) => row.group === 'resolved' && row.session === current));
            return GROUPS.map((group) => {
                const members = rows.filter((row) => row.group === group.id);
                if (members.length === 0) return null;
                const list = members.map((row) => h(ThreadRow, { key: row.id, row, current: row.session !== undefined && row.session === current, now, onOpen, action }));
                if (group.id !== 'resolved') {
                    return h('div', { key: group.id, role: 'group', 'aria-label': group.label, 'data-thread-group': group.id },
                        h('div', { className: 'dshp-t-group' }, group.label), ...list);
                }
                return h('div', { key: group.id, role: 'group', 'aria-label': group.label, 'data-thread-group': group.id },
                    h('button', {
                        type: 'button', className: 'dshp-t-group', 'data-dshp-item': '', 'aria-expanded': showResolved,
                        onClick: () => setShowResolved((value) => !value),
                    }, h(ui.IconChevronRightOutlineRegular, { size: 12 }), `${group.label} · ${members.length}`),
                    ...(showResolved ? list : []));
            });
        }

        /** Loading, failure or empty notice for a roster, or null when there are rows. */
        function rosterNotice(info, rows, projects) {
            if (info.roster === null) {
                if (info.load === 'none') return h('div', { className: 'dshp-t-notice' }, TEXT.noCoordinator);
                if (info.load === 'error') {
                    return h('div', { className: 'dshp-t-notice dshp-t-error', role: 'alert' }, TEXT.failed,
                        h('button', { type: 'button', className: 'dshp-t-retry', onClick: () => projects.refresh(info.coordinator, true) },
                            h(ui.IconRefreshOutlineRegular, { size: 12 }), TEXT.retry));
                }
                return h('div', { className: 'dshp-t-notice', role: 'status' }, TEXT.loading);
            }
            return rows.length === 0 ? h('div', { className: 'dshp-t-notice' }, TEXT.empty) : null;
        }

        /** The project name, as a link to the coordinator unless that is where the user is. */
        function ProjectName({ info, here, onOpen }) {
            const name = info.project.name || TEXT.coordinator;
            const content = [h('span', { key: 'd', className: 'dshp-t-diamond', 'aria-hidden': true }, '◆'), h('span', { key: 'n', className: 'dshp-t-project-name' }, name)];
            if (!info.coordinator || info.coordinator === here) return h('span', { className: 'dshp-t-project' }, ...content);
            return h('button', { type: 'button', className: 'dshp-t-project', 'data-dshp-item': '', title: TEXT.openCoordinator, onClick: onOpen }, ...content);
        }

        /**
         * The Threads menu at the top of a project session: a count with the
         * live state of the project's threads, opening a menu of them grouped
         * by state. In a thread, a link back to the coordinator comes first.
         */
        function ThreadsMenu({ sessionId, useSessions, useSessionStatus, projects }) {
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            const [open, setOpen] = React.useState(false);
            const rootRef = React.useRef(null);
            const triggerRef = React.useRef(null);
            const panelRef = React.useRef(null);
            const hoverTimer = React.useRef(undefined);
            const pinned = React.useRef(false);
            const focusFirst = React.useRef(false);
            const now = useNow(open);
            const position = ui.useAnchoredPosition({ open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16 });
            const cancelHover = () => {
                clearTimeout(hoverTimer.current);
                hoverTimer.current = undefined;
            };
            const change = React.useCallback((next) => {
                cancelHover();
                if (!next) pinned.current = false;
                setOpen(next);
            }, []);
            const scheduleClose = () => {
                cancelHover();
                if (pinned.current) return;
                hoverTimer.current = setTimeout(() => change(false), 120);
            };
            ui.useDismissOnOutsidePointer(rootRef, open, change, panelRef);
            React.useEffect(() => { change(false); }, [sessionId, change]);
            React.useEffect(() => cancelHover, []);
            React.useEffect(() => {
                if (!open) return undefined;
                const dismiss = (event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    const inside = panelRef.current?.contains(document.activeElement);
                    change(false);
                    if (inside) triggerRef.current?.focus();
                };
                document.addEventListener('keydown', dismiss);
                return () => document.removeEventListener('keydown', dismiss);
            }, [open, change]);
            React.useLayoutEffect(() => {
                if (!open || position === null || !focusFirst.current) return;
                focusFirst.current = false;
                focusables(panelRef.current)[0]?.focus();
            }, [open, position]);
            const coordinator = info?.coordinator;
            const away = coordinator !== undefined && coordinator !== sessionId;
            const unknown = info !== undefined && info.roster === null;
            React.useEffect(() => {
                if (away && (unknown || open)) projects.refresh(coordinator);
            }, [away, unknown, open, coordinator, projects]);
            const rows = React.useMemo(() => rowsOf(info?.roster, statuses, byId), [info?.roster, statuses, byId]);
            if (info === undefined) return null;

            const counts = countsOf(rows);
            const signal = counts.waiting > 0 ? 'warning' : counts.running > 0 ? 'ongoing' : null;
            const label = counts.open > 0 ? plural(counts.open, 'thread') : TEXT.threads;
            const openSession = (target) => { change(false); projects.openSession(target); };
            const parent = info.me.role === 'thread' && coordinator
                ? h(ui.Tooltip, { label: `Open ◆ ${info.project.name || TEXT.coordinator}`, side: 'bottom' },
                    h('button', { type: 'button', className: 'dshp-t-trigger dshp-t-parent', 'aria-label': TEXT.openCoordinator, onClick: () => openSession(coordinator) },
                        h('span', { className: 'dshp-t-diamond', 'aria-hidden': true }, '◆'),
                        h('span', { className: 'dshp-t-label' }, TEXT.coordinator)))
                : null;
            const trigger = h('button', {
                ref: triggerRef, type: 'button', className: 'dshp-t-trigger',
                'aria-haspopup': 'dialog', 'aria-expanded': open,
                'aria-label': `${TEXT.threads}: ${info.roster === null ? TEXT.loading : summaryText(counts)}`,
                'data-projects-threads-trigger': '',
                onMouseEnter: () => {
                    cancelHover();
                    if (open) return;
                    hoverTimer.current = setTimeout(() => { hoverTimer.current = undefined; change(true); }, 150);
                },
                onClick: () => {
                    cancelHover();
                    pinned.current = true;
                    if (!open) change(true);
                },
                onKeyDown: (event) => {
                    if (event.key !== 'ArrowDown') return;
                    event.preventDefault();
                    pinned.current = true;
                    if (open) focusables(panelRef.current)[0]?.focus();
                    else { focusFirst.current = true; change(true); }
                },
            },
            signal ? h('span', { className: 'dshp-t-signal' }, h(ui.StateDot, { state: signal })) : h(ui.IconBranchOutlineRegular, { size: 14 }),
            h('span', { className: 'dshp-t-label' }, label),
            h(ui.IconChevronDownOutlineRegular, { size: 12, className: open ? 'dshp-t-chev dshp-t-chev-open' : 'dshp-t-chev' }));

            const notice = rosterNotice(info, rows, projects);
            const menu = open ? ReactDOM.createPortal(h(ui.MenuSurface, {
                ref: panelRef, className: 'dshp-t-menu', role: 'dialog', tabIndex: -1,
                'aria-label': `${TEXT.threads} · ${info.project.name ?? ''}`,
                'data-projects-threads-menu': '',
                style: position ?? { visibility: 'hidden', left: 0, top: 0 },
                onMouseEnter: cancelHover,
                onMouseLeave: scheduleClose,
                onKeyDown: (event) => arrowKeys(event, panelRef.current),
            },
            h('div', { className: 'dshp-t-menu-head' },
                h(ProjectName, { info, here: sessionId, onOpen: () => openSession(coordinator) }),
                info.roster !== null ? h('span', { className: 'dshp-t-count' }, summaryText(counts)) : null),
            h('div', { className: 'dshp-t-menu-body' },
                notice ?? h(ThreadList, {
                    rows, current: sessionId, now,
                    onOpen: (row) => openSession(row.session),
                    action: { label: TEXT.openBeside, icon: ui.IconCompareSplitOutlineRegular, run: (row) => { change(false); projects.openBeside(row.session); } },
                })),
            projects.hasPane() ? h('div', { className: 'dshp-t-menu-foot' },
                h('button', { type: 'button', className: 'dshp-t-foot-btn', 'data-dshp-item': '', onClick: () => { change(false); projects.openPane(); } },
                    h(ui.IconFlatListOutlineRegular, { size: 14 }), TEXT.openPane)) : null), document.body) : null;

            return h('div', { ref: rootRef, className: 'dshp-t-hdr', 'data-projects-threads': info.me.role, onMouseLeave: scheduleClose },
                parent, trigger, menu);
        }

        /**
         * The Threads pane in the right sidebar: the project's threads by state.
         * A row opens the thread's chat as a tab here; its button makes it the
         * main chat.
         */
        function ThreadsPane({ sessionId, useSessions, useSessionStatus, useTabInfo, projects }) {
            const { tab } = useTabInfo();
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            const now = useNow(tab.visible !== false);
            const rootRef = React.useRef(null);
            const coordinator = info?.coordinator;
            React.useEffect(() => {
                if (coordinator !== undefined && coordinator !== sessionId) projects.refresh(coordinator);
            }, [coordinator, sessionId, projects]);
            const rows = React.useMemo(() => rowsOf(info?.roster, statuses, byId), [info?.roster, statuses, byId]);
            if (info === undefined) {
                return h('div', { className: 'dshp-t-pane', 'data-projects-threads-pane': '' }, h('div', { className: 'dshp-t-empty' }, TEXT.notProject));
            }
            const notice = rosterNotice(info, rows, projects);
            return h('div', {
                ref: rootRef, className: 'dshp-t-pane', 'data-projects-threads-pane': '',
                onKeyDown: (event) => arrowKeys(event, rootRef.current),
            },
            h('div', { className: 'dshp-t-pane-head' },
                h(ProjectName, { info, here: sessionId, onOpen: () => projects.openSession(coordinator) }),
                info.roster !== null ? h('span', { className: 'dshp-t-count' }, summaryText(countsOf(rows))) : null),
            notice ?? h(ThreadList, {
                rows, current: sessionId, now,
                onOpen: (row) => {
                    try { tab.actions.openResource(chatAddress(row.session)); } catch { projects.openBeside(row.session); }
                },
                action: { label: TEXT.openMain, icon: ui.IconRightUpOutlineRegular, run: (row) => projects.openSession(row.session) },
            }));
        }

        /** The resource behind a thread's sidebar chat: the thread session, held while the tab shows it. */
        function threadChatResources(sessions) {
            const waitForAbort = (signal) => (signal.aborted ? Promise.resolve() : new Promise((resolve) => {
                signal.addEventListener('abort', () => resolve(), { once: true });
            }));
            /** Wait until the session list has the session, or has loaded without it. */
            const listed = (sessionId, signal) => new Promise((resolve) => {
                const check = () => {
                    const state = sessions.list.getSnapshot();
                    if (state.byId[sessionId] !== undefined) return finish(true);
                    if (state.phase === 'ready' || signal.aborted) return finish(false);
                    return undefined;
                };
                let unsubscribe = () => {};
                const finish = (value) => {
                    unsubscribe();
                    signal.removeEventListener('abort', check);
                    resolve(value);
                };
                unsubscribe = sessions.list.subscribe(check);
                signal.addEventListener('abort', check, { once: true });
                check();
            });
            return {
                protocol: CHAT_PROTOCOL,
                async *open(address, { signal }) {
                    const sessionId = chatSessionOf(address);
                    if (sessionId === undefined) {
                        yield { ok: false, error: { message: `not a thread chat address: ${address}` } };
                        await waitForAbort(signal);
                        return;
                    }
                    if (!(await listed(sessionId, signal)) && signal.aborted) return;
                    let reference;
                    try {
                        reference = sessions.retain(sessionId, { source: 'projectsThreadChat', signal });
                    } catch (error) {
                        if (signal.aborted) return;
                        yield { ok: false, error: { message: String(error?.message ?? error) } };
                        await waitForAbort(signal);
                        return;
                    }
                    try {
                        yield { ok: true, value: { sessionId, reference } };
                        await waitForAbort(signal);
                    } finally {
                        reference.release();
                    }
                },
            };
        }

        /** The chat itself always shows the Chat view of the conversation. */
        function ChatOnlyView(props) {
            return props.renderSlot('conversation.session', { view: 'chat' });
        }

        /** The conversation of the session the chat tab provides (DSH's own embedded chat). */
        function ThreadConversation({ sessionId, useSession, useConversation, useSessions, renderFactorySlot }) {
            const session = useSession((value) => value);
            const conversation = useConversation((value) => value);
            const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
            const shellPhase = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
                ? 'active' : session.promptAttempted ? 'engaging' : 'blank';
            const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
            const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
            return renderFactorySlot('conversation.content', {
                variant: 'embedded',
                phase: settling ? 'settling' : hero ? 'hero' : 'active',
                hero,
            }, { slots: { views: ChatOnlyView } });
        }

        /** Live facts for the bar and title of a thread's sidebar chat. */
        function useChatFacts(threadSession, useSessions, useSessionStatus) {
            const value = useSessions((state) => valueIn(state, threadSession));
            const displayTitle = useSessions((state) => state.byId[threadSession]?.displayTitle);
            const listRunning = useSessions((state) => state.byId[threadSession]?.running === true);
            const status = useSessionStatus((map) => map.get(threadSession));
            const running = (status?.running ?? listRunning) === true;
            const title = value?.role === 'thread' ? value.thread?.title ?? displayTitle : displayTitle;
            const dot = status?.pendingInteraction ? 'warning' : running ? 'ongoing' : 'idle';
            return { value, title: title || TEXT.thread, running, dot };
        }

        function ThreadChatTab({ useTabInfo, useResource, useSessions, useSessionStatus, SessionProvider, renderSlot, projects }) {
            const { tab } = useTabInfo();
            const threadSession = chatSessionOf(tab.contentId);
            const resource = useResource(tab.contentId);
            const facts = useChatFacts(threadSession, useSessions, useSessionStatus);
            const value = facts.value;
            const sub = value?.role === 'thread'
                ? `${value.thread?.id ?? TEXT.thread} · ◆ ${value.project?.name ?? ''}`
                : value?.role === 'coordinator' ? `◆ ${TEXT.coordinator}` : '';
            return h('div', { className: 'dshp-t-chat', 'data-projects-thread-chat': threadSession ?? '' },
                h('div', { className: 'dshp-t-chat-bar' },
                    h(ui.StateDot, { state: facts.dot }),
                    h('div', { className: 'dshp-t-chat-title' },
                        h('span', { className: 'dshp-t-chat-name' }, facts.title),
                        sub ? h('span', { className: 'dshp-t-chat-sub' }, sub) : null),
                    threadSession ? h(ui.Tooltip, { label: TEXT.openMain, side: 'bottom', align: 'end' },
                        h(ui.Button, {
                            variant: 'ghost', size: 'sm', icon: h(ui.IconRightUpOutlineRegular, { size: 16 }),
                            onClick: () => projects.openSession(threadSession),
                        }, TEXT.open)) : null),
                h('div', { className: 'dshp-t-chat-body' },
                    resource.status === 'failed' && resource.value === undefined
                        ? h('div', { className: 'dshp-t-empty' }, TEXT.chatGone)
                        : resource.value === undefined ? null
                            : h(SessionProvider, { session: resource.value.reference }, renderSlot(CONVERSATION_SLOT, {}))));
        }

        function ThreadChatTitle({ useTabInfo, useSessions, useSessionStatus }) {
            const { tab } = useTabInfo();
            const facts = useChatFacts(chatSessionOf(tab.contentId), useSessions, useSessionStatus);
            return h('span', { className: 'dshp-t-tab-title' },
                facts.dot === 'idle' ? h(ui.IconBranchOutlineRegular, { size: 14 }) : h(ui.StateDot, { state: facts.dot }),
                h('span', null, facts.title));
        }

        /** Which session a `.dsh-thread/tN` link means, as far as the store knows yet. */
        function resolveLink(state, target) {
            if (!target) return { state: 'invalid' };
            const own = valueIn(state, target.sessionId);
            if (!own) {
                const load = state.projectionsBySession?.[target.sessionId]?.state;
                return { state: load === 'ready' || load === 'error' ? 'not-project' : 'loading' };
            }
            if (own.role === 'thread' && own.thread?.id === target.threadId) return { state: 'found', session: target.sessionId };
            const coordinator = own.role === 'coordinator' ? target.sessionId : own.coordinator;
            const roster = own.role === 'coordinator' ? own.threads : valueIn(state, coordinator)?.threads;
            if (!Array.isArray(roster)) return { state: coordinator ? 'loading' : 'missing', coordinator };
            const entry = roster.find((t) => isObject(t) && t.id === target.threadId);
            return typeof entry?.session === 'string' && entry.session !== ''
                ? { state: 'found', session: entry.session, coordinator }
                : { state: 'missing', coordinator };
        }
        const sameLink = (a, b) => a.state === b.state && a.session === b.session && a.coordinator === b.coordinator;

        /**
         * A `.dsh-thread/tN` link from a reply: find the thread's session and
         * open its chat in this tab's place.
         */
        function ThreadLinkTab({ useTabInfo, useSessions, projects }) {
            const { tab } = useTabInfo();
            const target = linkTarget(tab.contentId);
            const found = useSessions((state) => resolveLink(state, target), sameLink);
            React.useEffect(() => {
                if (found.state === 'found') tab.actions.openResource(chatAddress(found.session), { replaceTab: true });
            }, [found.state, found.session, tab.actions]);
            React.useEffect(() => {
                if (target) projects.refresh(target.sessionId);
                if (found.coordinator && found.coordinator !== target?.sessionId) projects.refresh(found.coordinator);
            }, [target?.sessionId, found.coordinator, projects]);
            const retry = () => {
                if (target) projects.refresh(target.sessionId, true);
                if (found.coordinator) projects.refresh(found.coordinator, true);
            };
            const text = found.state === 'found' || found.state === 'loading' ? TEXT.linkLoading
                : found.state === 'not-project' ? TEXT.linkNotProject
                    : `Thread ${target?.threadId ?? ''} isn't in this project's thread list.`;
            return h('div', { className: 'dshp-t-pane', 'data-projects-thread-link': found.state },
                h('div', { className: 'dshp-t-empty', role: 'status' }, text,
                    found.state === 'missing' ? h('div', null, h('button', { type: 'button', className: 'dshp-t-retry', onClick: retry },
                        h(ui.IconRefreshOutlineRegular, { size: 12 }), TEXT.retry)) : null));
        }

        /** The cards one turn earned, one per thread, in the order they happened. */
        function cardsOf(value, turn) {
            if (!isObject(value) || !Array.isArray(value.cards) || !Number.isSafeInteger(turn)) return EMPTY;
            const out = [];
            const seen = new Set();
            for (const card of value.cards) {
                if (!isObject(card) || card.turn !== turn || typeof card.kind !== 'string') continue;
                const key = typeof card.thread === 'string' ? card.thread : `#${card.kind}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(card);
            }
            return out.length > 0 ? out : EMPTY;
        }
        const sameList = (a, b) => a === b || (a.length === b.length && a.every((item, i) => item === b[i]));

        const UPDATE_VERBS = { stopped: 'Stopped a thread', resolved: 'Resolved a thread', reopened: 'Reopened a thread', renamed: 'Renamed a thread' };
        const UPDATE_ICONS = { stopped: 'IconStopFillRegular', resolved: 'IconCheckCircleOutlineRegular', reopened: 'IconRefreshOutlineRegular', renamed: 'IconEditOutlineRegular' };

        /** How one card reads: its icon, its line above the name, and what it opens. */
        function cardView(card, info, statuses, byId, here) {
            const handback = HANDBACK_LABELS[card.status] ?? card.status;
            if (info.me.role === 'thread') {
                // A thread's own turn: only its handback is news, and it points at the coordinator.
                if (card.kind !== 'handback' || !info.coordinator) return null;
                return {
                    key: `handback-${card.seq ?? ''}`, kind: card.kind, icon: ui.IconTreeCornerRegular,
                    verb: `Handed back to the coordinator${handback ? ` · ${handback}` : ''}`,
                    title: `◆ ${info.project.name || TEXT.coordinator}`, session: info.coordinator === here ? undefined : info.coordinator,
                };
            }
            const entry = (info.roster ?? EMPTY).find((t) => isObject(t) && t.id === card.thread);
            const row = entry ? threadRow(entry, statuses, byId) : undefined;
            const base = {
                key: card.thread ?? `${card.kind}-${card.seq ?? ''}`, kind: card.kind, threadId: card.thread,
                title: row?.title ?? card.thread ?? TEXT.thread, session: row?.session,
                state: row ? { dot: row.dot, label: row.stateLabel } : undefined,
            };
            switch (card.kind) {
                case 'start': return { ...base, icon: ui.IconBranchOutlineRegular, verb: 'Started a thread' };
                case 'send': return { ...base, icon: ui.IconSendOutlineRegular, verb: card.status === 'steer' ? 'Steered a running thread' : 'Sent a message to a thread' };
                case 'update': return { ...base, icon: ui[UPDATE_ICONS[card.status]] ?? ui.IconEditOutlineRegular, verb: UPDATE_VERBS[card.status] ?? 'Updated a thread' };
                case 'handback': return { ...base, icon: ui.IconTreeCornerRegular, verb: `Handback${handback ? ` · ${handback}` : ''}` };
                case 'idle': return { ...base, icon: ui.IconPauseOutlineRegular, verb: 'Went idle without a handback' };
                case 'approval': return { ...base, icon: ui.IconWarningOutlineRegular, verb: 'Is waiting for your approval' };
                default: return null;
            }
        }

        function ThreadCard({ view, projects }) {
            const enabled = view.session !== undefined;
            return h('div', { className: 'dshp-t-card', 'data-thread': view.threadId, 'data-card-kind': view.kind },
                h('span', { className: 'dshp-t-card-icon', 'aria-hidden': true }, h(view.icon, { size: 16 })),
                h('div', { className: 'dshp-t-card-text' },
                    h('span', { className: 'dshp-t-card-verb' }, view.verb),
                    h('button', {
                        type: 'button', className: 'dshp-t-card-title', disabled: !enabled,
                        title: enabled ? `${TEXT.open}: ${view.title}` : undefined,
                        onClick: () => projects.openSession(view.session),
                    }, view.title)),
                view.state ? h('span', { className: 'dshp-t-card-state' },
                    h(ui.StateDot, { state: view.state.dot }),
                    h('span', { className: 'dshp-t-card-state-label' }, view.state.label)) : null,
                enabled ? h('div', { className: 'dshp-t-card-actions' },
                    h(ui.Tooltip, { label: TEXT.openBeside, side: 'top', align: 'end' },
                        h('button', {
                            type: 'button', className: 'dshp-t-icon', 'aria-label': `${TEXT.openBeside}: ${view.title}`,
                            onClick: () => projects.openBeside(view.session),
                        }, h(ui.IconCompareSplitOutlineRegular, { size: 16 }))),
                    h(ui.Button, { variant: 'outline', size: 'sm', onClick: () => projects.openSession(view.session) }, TEXT.open)) : null);
        }

        function ThreadCardList({ sessionId, cards, useSessions, useSessionStatus, projects }) {
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            if (info === undefined) return null;
            const views = cards.map((card) => cardView(card, info, statuses, byId, sessionId)).filter(Boolean);
            if (views.length === 0) return null;
            return h('div', { className: 'dshp-t-cards', 'data-projects-thread-cards': '' },
                ...views.map((view) => h(ThreadCard, { key: view.key, view, projects })));
        }

        /** Under a finished turn: a card for each thread the turn started, steered, resolved or heard from. */
        function ThreadCards({ sessionId, turn, useProjection, useSessions, useSessionStatus, projects }) {
            const cards = useProjection(KEY, (value) => cardsOf(value, turn?.turn), sameList);
            if (cards.length === 0) return null;
            return h(ThreadCardList, { sessionId, cards, useSessions, useSessionStatus, projects });
        }

        /** Coordinator project names in a session list ("◆ name" titles), once per list. */
        const coordinatorNames = new WeakMap();
        function namesOf(byId) {
            let names = coordinatorNames.get(byId);
            if (names === undefined) {
                names = new Set();
                for (const row of Object.values(byId)) {
                    const title = row?.title;
                    if (typeof title === 'string' && title.startsWith('◆ ')) names.add(title.slice(2));
                }
                coordinatorNames.set(byId, names);
            }
            return names;
        }

        /**
         * Whether a session list row is a project thread: its projection says
         * so, or (before DSH has folded it) its title is "<project> › <thread>"
         * and a "◆ <project>" coordinator is in the list.
         */
        function isThreadRow(state, sessionId) {
            const value = valueIn(state, sessionId);
            if (value) return value.role === 'thread';
            const title = state.byId?.[sessionId]?.title;
            if (typeof title !== 'string') return false;
            const at = title.indexOf(' › ');
            return at > 0 && namesOf(state.byId).has(title.slice(0, at));
        }

        function ThreadMark({ sessionId, useSessions }) {
            const thread = useSessions((state) => isThreadRow(state, sessionId));
            if (!thread) return null;
            return h('span', { className: 'dshp-t-mark', role: 'img', 'aria-label': 'Project thread', 'data-projects-thread-mark': '' },
                h(ui.IconTreeCornerRegular, { size: 12 }));
        }

        function ThreadHover({ sessionId, useSessions, useSessionStatus }) {
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            if (info === undefined) return null;
            const project = info.project.name ?? '';
            if (info.me.role === 'thread') {
                const entry = (info.roster ?? EMPTY).find((t) => isObject(t) && t.session === sessionId);
                const row = entry ? threadRow(entry, statuses, byId) : undefined;
                return h('div', { className: 'dshp-t-hover', 'data-projects-thread-hover': '' },
                    h('div', { className: 'dshp-t-hover-head' }, h(ui.IconTreeCornerRegular, { size: 12 }), `Thread ${info.me.thread?.id ?? ''} of ◆ ${project}`),
                    row && row.line ? h('div', { className: 'dshp-t-hover-line' }, row.line) : null);
            }
            const counts = countsOf(rowsOf(info.roster, statuses, byId));
            return h('div', { className: 'dshp-t-hover', 'data-projects-thread-hover': '' },
                h('div', { className: 'dshp-t-hover-head' }, h('span', { 'aria-hidden': true }, '◆'), `Coordinator of ${project}`),
                h('div', { className: 'dshp-t-hover-line' }, counts.open + counts.resolved > 0 ? summaryText(counts).replace(/^(\d+) open/, (m, n) => plural(Number(n), 'open thread')) : 'No threads yet'));
        }

        /** Navigation the thread views share; nothing here throws into React. */
        function threadsApi(ctx) {
            const warn = (what, error) => { console.warn(`[projects] ${what}: ${error?.message ?? error}`); };
            const openSession = (sessionId) => {
                if (typeof sessionId !== 'string' || sessionId === '') return;
                try { ctx.uiWorkspace.openSession(sessionId); } catch (error) { warn('could not open the session', error); }
            };
            const failed = new Set();
            return {
                openSession,
                openBeside(sessionId) {
                    if (typeof sessionId !== 'string' || sessionId === '') return;
                    try {
                        ctx.sidebarRight.openResource(chatAddress(sessionId), { kind: KINDS.chat, preferNewPane: true });
                    } catch (error) {
                        warn('could not open the thread beside this chat', error);
                        openSession(sessionId);
                    }
                },
                openPane() {
                    try { ctx.sidebarRight.openTab(KINDS.pane); } catch (error) { warn('could not open the Threads panel', error); }
                },
                hasPane() {
                    try { return ctx.get('sidebarRightTabs')?.get?.(KINDS.pane) !== undefined; } catch { return false; }
                },
                /** Read a session's projections once per connection; `again` retries a failed read. */
                refresh(sessionId, again = false) {
                    if (typeof sessionId !== 'string' || sessionId === '') return;
                    if (failed.has(sessionId) && !again) return;
                    failed.delete(sessionId);
                    try {
                        Promise.resolve(ctx.sessions.refreshProjections(sessionId)).catch(() => failed.add(sessionId));
                    } catch {
                        failed.add(sessionId);
                    }
                },
            };
        }

        function applyThreads(ctx) {
            const projects = threadsApi(ctx);
            const withApi = () => ({ projects });
            ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
                name: 'conversation.session.header.actions', id: IDS.menu, order: -25, inject: withApi,
            }, ThreadsMenu));
            ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
                name: 'conversation.chat.turnTail', id: IDS.cards, order: 30, inject: withApi,
            }, ThreadCards));
            ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
                name: 'sidebar.session.row.leading', id: IDS.mark, order: 20,
            }, ThreadMark));
            ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
                name: 'sidebar.session.row.hover', id: IDS.hover, order: 20,
            }, ThreadHover));
            // The right-sidebar parts: a thread's chat, the Threads pane, and thread links from replies.
            ctx.inject(['resources', 'sidebarRightTabs'], (scope) => {
                scope.effect(() => scope.resources.register(threadChatResources(scope.sessions)), 'projects: thread chat resources');
                scope.effect(() => scope.sidebarRightTabs.register({
                    id: IDS.chat,
                    kind: KINDS.chat,
                    patterns: [`${CHAT_PREFIX}**`],
                    canOpen: (address) => chatSessionOf(address) !== undefined,
                    title: (address) => {
                        const sessionId = chatSessionOf(address);
                        const state = scope.sessions.list.getSnapshot();
                        const value = valueIn(state, sessionId);
                        return (value?.role === 'thread' ? value.thread?.title : undefined) ?? state.byId[sessionId]?.displayTitle ?? TEXT.thread;
                    },
                }), 'projects: thread chat tab');
                scope.effect(() => scope.sidebarRightTabs.register({
                    id: IDS.pane,
                    kind: KINDS.pane,
                    title: () => TEXT.threads,
                }), 'projects: threads pane');
                scope.effect(() => scope.sidebarRightTabs.register({
                    id: IDS.link,
                    kind: KINDS.link,
                    patterns: ['dsh-resource://file/session/**/.dsh-thread/*'],
                    canOpen: (address) => linkTarget(address) !== undefined,
                    title: (address) => `${TEXT.thread} ${linkTarget(address)?.threadId ?? ''}`.trim(),
                }), 'projects: thread links');
                scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
                    name: 'sidebar.right.pane.tab', key: IDS.chat, inject: withApi,
                    children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
                }, ThreadChatTab));
                scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
                    name: 'sidebar.right.pane.tab.title', key: IDS.chat,
                }, ThreadChatTitle));
                scope.slots.inject(CONVERSATION_SLOT, () => scope.slots.register({ name: CONVERSATION_SLOT }, ThreadConversation));
                scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
                    name: 'sidebar.right.pane.tab', key: IDS.pane, inject: withApi,
                }, ThreadsPane));
                scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
                    name: 'sidebar.right.pane.tab', key: IDS.link, inject: withApi,
                }, ThreadLinkTab));
            });
        }

        /** Required services (cordis inject); each part below waits for its own. */
        const inject = ['slots'];

        function apply(ctx) {
            ctx.inject(['configForms', 'remote', 'remote.session'], (scope) => applyDefaultsForm(scope));
            ctx.inject(['sessions', 'uiWorkspace', 'sidebarRight'], (scope) => applyThreads(scope));
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        // For the plugin's own tests: the pure helpers the views are built on.
        module.exports.internals = { valueIn, projectContext, threadRow, rowsOf, countsOf, summaryText, cardsOf, cardView, resolveLink, linkTarget, chatAddress, chatSessionOf, isThreadRow, ago };
        return module.exports;
    },
});
