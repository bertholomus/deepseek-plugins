/**
 * dsh-plugin-projects, browser half. Three parts:
 *
 * - The "Default models" form on the plugin's page in DSH (Plugins →
 *   dsh-plugin-projects). It edits the four plugin-wide defaults through
 *   DSH's own settings forms, so a save lands in the profile's
 *   cordis.patch.yml and the running plugin switches without a restart.
 * - Project settings: a dialog per project, opened from a project
 *   session's header, its Threads menu and pane, or its row's menu in the
 *   session list. It sets the coordinator's and new threads' model and
 *   effort, each open thread's, and pause, through the plugin's endpoints
 *   (remote.js), with a model picker shaped like DSH's own.
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
        const NOTE = 'These apply to every project that doesn\'t set its own. A project\'s own choice, made in its Project settings, in its coordinator\'s model menu or by asking the coordinator, comes first. Default follows DSH\'s default model, which is the one last picked in any DSH chat.';

        /** DSH's branch glyph, as a mask for links drawn by DSH's markdown. */
        const BRANCH_MASK = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#000" stroke-width="1.3"><path d="M1.015 8h4.681c.723 0 1.085 0 1.425-.08.302-.072.591-.19.857-.35.3-.18.558-.433 1.075-.939l2.275-2.225"/><path d="M1.012 8h4.684c.723 0 1.085 0 1.425.08.302.072.591.19.857.35.3.18.558.433 1.075.939l2.275 2.225"/><circle cx="12.45" cy="3.308" r="1.57"/><circle cx="12.45" cy="12.692" r="1.57"/></svg>')}")`;
        /** DSH's focus ring color, as its own controls draw it. */
        const RING = 'var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))';
        // DSH's error red and link blue reach only 4.5 and 4.2:1 as small text on white: a touch of the
        // label colour takes them past 5:1 in light and further from the background in dark.
        const ERROR_TEXT = 'color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary))';
        const LINK_TEXT = 'color-mix(in srgb,var(--dsw-alias-link,var(--dsw-alias-state-business-primary)) 85%,var(--dsw-alias-label-primary))';
        const CSS = [
            // Keyboard focus: DSH's ring on every plugin control. DSH's own buttons (Open, Retry, Save…) get its outline;
            // the plugin's own controls draw it inset below, so a scrolling list can't clip it.
            `:where(.dshp-t-card-actions,.dshp-t-paused,.dshp-dock,.dshp-ps,.dshp-page,.dshp-pg-actions,.dshp-pg-empty,.dshp-t-chat-bar,.dshp-t-pane-gear) button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ${RING};outline-offset:2px}`,
            // Default models form
            '.dshp-heading{margin:0 0 4px;font-size:14px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshp-section{display:flex;flex-direction:column;gap:2px;padding:12px 0}',
            '.dshp-section+.dshp-section{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-title{margin:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshp-hint,.dshp-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
            '.dshp-note{padding-top:4px}',
            '.dshp-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-top:8px}',
            '.dshp-route{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px}',
            '.dshp-route-text{display:flex;flex-direction:column;gap:2px;flex:1 1 220px;min-width:0}',
            '.dshp-route-text .dshp-hint{margin:0}',
            '.dshp-route-note{color:var(--dsw-alias-label-secondary)}',
            '.dshp-route>.dshp-hint{flex:1 1 220px}',
            // The plugin's page: every project and what it runs
            '.dshp-page{display:flex;flex-direction:column}',
            '.dshp-projects{display:flex;flex-direction:column;gap:2px;margin-top:12px;padding:16px 0 4px;border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-projects .dshp-hint{color:var(--dsw-alias-label-secondary)}',
            '.dshp-pt{display:flex;flex-direction:column;margin-top:10px;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4));border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2));container-type:inline-size}',
            '.dshp-pt-row{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) 84px;align-items:center;gap:6px 16px;box-sizing:border-box;min-height:60px;padding:10px 14px}',
            '.dshp-pt-row+.dshp-pt-row{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-pt-head{min-height:0;padding-top:9px;padding-bottom:7px;font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-pt-cell{display:flex;flex-direction:column;min-width:0}',
            '.dshp-pt-label{display:none}',
            '.dshp-pt-name{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
            '.dshp-pt-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-pt-diamond{flex:none;font-size:10px;line-height:1}',
            '.dshp-pt-badge{flex:none;padding:0 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-interactive-bg-hover);font-size:11px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-pt-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}',
            '.dshp-pt-source{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-pt-action{align-items:flex-end}',
            '.dshp-pt-state{padding:14px 0 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '@container (width<=560px){.dshp-pt-head{display:none}.dshp-pt-row{grid-template-columns:minmax(0,1fr) auto}.dshp-pt-row>.dshp-pt-cell:nth-child(2),.dshp-pt-row>.dshp-pt-cell:nth-child(3){grid-column:1/-1}.dshp-pt-action{grid-row:1;grid-column:2}.dshp-pt-label{display:block;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}}',
            // Model picker: DSH's composer model menu, as a settings control
            '.dshp-mp{position:relative;display:inline-flex;flex:none;min-width:0;max-width:100%}',
            '.dshp-mp-trigger{display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;min-width:0;max-width:min(300px,100%);height:32px;padding:0 10px 0 12px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;cursor:pointer}',
            '.dshp-mp-trigger:hover:not(:disabled),.dshp-mp-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-mp-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
            '.dshp-mp-trigger:disabled{cursor:default;opacity:.6}',
            '.dshp-mp-name{min-width:0;overflow:hidden;text-overflow:ellipsis}',
            '.dshp-mp-effort{flex-shrink:1000;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}',
            '.dshp-mp-trigger>svg,.dshp-mp-trigger>span:last-child:not(.dshp-mp-name):not(.dshp-mp-effort){flex:none;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-mp-chev{transition:transform .12s}',
            '.dshp-mp-chev-open{transform:rotate(180deg)}',
            '.dshp-mp-menu{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;width:max-content;min-width:min(264px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:min(380px,calc(100vh - 96px));padding:4px;overflow:hidden;box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);color:var(--dsw-alias-label-primary);outline:none}',
            '.dshp-mp-cell,.dshp-mp-opt,.dshp-mp-back{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;border:0;border-radius:var(--dsw-radius-md);background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;outline:none}',
            '.dshp-mp-cell{height:34px;padding:0 8px;font-size:13px;line-height:20px}',
            '.dshp-mp-cell:hover,.dshp-mp-cell:focus-visible,.dshp-mp-opt:hover:not(:disabled),.dshp-mp-opt:focus-visible,.dshp-mp-back:hover,.dshp-mp-back:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-mp-cell-label{flex:none;white-space:nowrap}',
            '.dshp-mp-cell-value{flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-secondary)}',
            '.dshp-mp-cell>svg{flex:none;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-tertiary))}',
            '.dshp-mp-back{height:28px;margin-bottom:2px;padding:0 7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-mp-back:hover,.dshp-mp-back:focus-visible{color:var(--dsw-alias-label-primary)}',
            '.dshp-mp-opt{min-height:34px;padding:5px 7px;font-size:13px;line-height:18px}',
            '.dshp-mp-opt:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
            '.dshp-mp-opt-copy{display:flex;flex-direction:column;flex:1;min-width:0}',
            '.dshp-mp-opt-name,.dshp-mp-opt-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-mp-opt-detail{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-mp-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary)}',
            '.dshp-mp-check svg{width:14px;height:14px}',
            '.dshp-mp-sep{flex:none;height:.5px;margin:3px 7px;background:var(--dsw-alias-border-l2)}',
            '.dshp-mp-list{min-height:0;overflow-y:auto}',
            '.dshp-mp-search{position:relative;flex:none;margin:2px 0 3px}',
            '.dshp-mp-search .dshp-mp-search-box{display:flex;height:auto;padding:5px 7px;border:0 solid transparent;border-radius:var(--dsw-radius-md);background:none}',
            '.dshp-mp-search .dshp-mp-search-box:focus-within{border-color:transparent}',
            '.dshp-mp-search .dshp-mp-search-box input{padding:0;font-size:12px;line-height:normal}',
            '.dshp-mp-search .dshp-mp-search-box input::placeholder{color:var(--dsw-alias-label-secondary)}',
            '.dshp-mp-search .dshp-mp-search-query{padding-right:34px}',
            '.dshp-mp-search-clear{position:absolute;top:50%;right:4px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;transform:translateY(-50%)}',
            '.dshp-mp-search-clear:hover,.dshp-mp-search-clear:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}',
            `.dshp-mp-search-clear:focus-visible{box-shadow:inset 0 0 0 2px ${RING}}`,
            '.dshp-mp-empty{padding:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            // Threads: header menu
            '.dshp-t-hdr{position:relative;display:inline-flex;align-items:center;gap:2px;min-width:0}',
            // A project session's title is its own name (no project prefix), so its header crumb may use more of the
            // header than DSH's 220 px; it still gives way first when the header is narrow.
            'header:has([data-projects-threads]) nav [class*="crumbCurrent"]{max-width:min(560px,40vw)}',
            '.dshp-t-trigger{display:inline-flex;align-items:center;gap:5px;min-width:0;min-height:28px;padding:3px 6px;border:0;border-radius:var(--dsw-radius-sm);background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer}',
            '.dshp-t-trigger:hover,.dshp-t-trigger:focus-visible,.dshp-t-trigger[aria-expanded=true]{color:var(--dsw-alias-label-primary)}',
            `.dshp-t-trigger:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);box-shadow:inset 0 0 0 2px ${RING}}`,
            '.dshp-t-trigger svg{flex:none}',
            '.dshp-t-label{min-width:0;overflow:hidden;text-overflow:ellipsis}',
            '.dshp-t-parent .dshp-t-label{max-width:180px}',
            '.dshp-t-diamond{flex:none;font-size:10px;line-height:1}',
            '.dshp-t-signal{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px}',
            '.dshp-t-chev{transition:transform .12s}',
            '.dshp-t-chev-open{transform:rotate(180deg)}',
            '@container (width<=480px){.dshp-t-parent .dshp-t-label{display:none}}',
            '.dshp-t-menu{position:fixed;z-index:100;box-sizing:border-box;display:flex;flex-direction:column;width:400px;max-width:calc(100vw - 32px);max-height:min(560px,calc(100vh - 120px));padding:4px;box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);color:var(--dsw-alias-label-primary);outline:none}',
            '.dshp-t-menu-head{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:6px 9px 4px}',
            '.dshp-t-menu-head .dshp-t-project{max-width:100%}',
            '.dshp-t-project{display:inline-flex;align-items:center;gap:6px;flex:1;min-width:0;padding:2px 0;border:0;border-radius:var(--dsw-radius-sm);background:none;font:inherit;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary);text-align:left}',
            'button.dshp-t-project{cursor:pointer}',
            'button.dshp-t-project:hover .dshp-t-project-name,button.dshp-t-project:focus-visible .dshp-t-project-name{text-decoration:underline}',
            `button.dshp-t-project:focus-visible{outline:none;box-shadow:0 0 0 2px ${RING}}`,
            '.dshp-t-project-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-t-count{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
            '.dshp-t-menu-body{flex:1 1 auto;min-height:0;overflow:auto}',
            '.dshp-t-menu-foot{margin-top:3px;padding-top:3px;border-top:.5px solid var(--dsw-alias-border-l2)}',
            // Threads: what the coordinator and new threads run on, under the project name
            '.dshp-t-models{display:flex;flex-direction:column;margin:0 0 3px;padding:0 0 3px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-t-models-row{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:28px;padding:4px 9px;border:0;border-radius:var(--dsw-radius-md);background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-primary);text-align:left}',
            'button.dshp-t-models-row{cursor:pointer}',
            'button.dshp-t-models-row:hover,button.dshp-t-models-row:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
            'button.dshp-t-models-row:focus-visible{outline:none;box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
            '.dshp-t-models-label{flex:none;width:84px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-models-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-t-models-row>svg{flex:none;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-pane .dshp-t-models{margin:0 0 6px;padding:0 0 8px}',
            '.dshp-t-pane .dshp-t-models-row{min-height:32px;padding:6px 10px;font-size:13px;line-height:20px}',
            '.dshp-t-pane .dshp-t-models-label{width:96px}',
            '.dshp-t-group{display:flex;align-items:center;gap:4px;box-sizing:border-box;width:100%;padding:8px 9px 3px;border:0;background:none;font:inherit;font-size:11px;font-weight:500;line-height:16px;color:var(--dsw-alias-label-secondary);text-align:left}',
            'button.dshp-t-group{cursor:pointer;border-radius:var(--dsw-radius-sm)}',
            'button.dshp-t-group:hover,button.dshp-t-group:focus-visible{outline:none;color:var(--dsw-alias-label-primary)}',
            `button.dshp-t-group:focus-visible{box-shadow:inset 0 0 0 2px ${RING}}`,
            'button.dshp-t-group svg{flex:none;transition:transform .12s}',
            'button.dshp-t-group[aria-expanded=true] svg{transform:rotate(90deg)}',
            // Threads: rows (menu and pane)
            '.dshp-t-row{position:relative;display:grid;grid-template-columns:14px minmax(0,1fr) auto;column-gap:8px;align-items:start;box-sizing:border-box;width:100%;min-height:44px;padding:6px 6px 6px 9px;border-radius:var(--dsw-radius-lg);font-size:12px;line-height:17px;color:var(--dsw-alias-label-primary);cursor:pointer;outline:none}',
            '.dshp-t-row:hover,.dshp-t-row:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
            `.dshp-t-row:focus-visible{box-shadow:inset 0 0 0 2px ${RING}}`,
            '.dshp-t-row[aria-disabled=true]{cursor:default}',
            '.dshp-t-row[aria-disabled=true]:hover{background:none}',
            '.dshp-t-dot{grid-column:1;grid-row:1;display:inline-flex;align-items:center;justify-content:center;width:14px;height:17px}',
            '.dshp-t-text{display:contents}',
            '.dshp-t-name{grid-column:2;grid-row:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            // The second line: the summary keeps at least 150px; the counts, model and time wrap under it when they need more.
            '.dshp-t-second{grid-column:2;grid-row:2;display:flex;flex-wrap:wrap;align-items:center;column-gap:8px;row-gap:1px;min-width:0}',
            '.dshp-t-row[aria-current=true] .dshp-t-name{font-weight:600}',
            '.dshp-t-line{flex:1 1 150px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-meta{flex:none;margin-left:auto;display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;height:16px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}',
            '.dshp-t-model{min-width:0;overflow:hidden;text-overflow:ellipsis}',
            '.dshp-t-ago{flex:none}',
            '.dshp-t-row>:not(.dshp-t-dot):not(.dshp-t-text){grid-column:3;grid-row:1/3;align-self:center}',
            '.dshp-t-icon{flex:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;margin:-4px -2px -4px 0;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:none;color:var(--dsw-alias-label-tertiary);cursor:pointer}',
            '.dshp-t-icon:hover,.dshp-t-icon:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
            `.dshp-t-icon:focus-visible{box-shadow:inset 0 0 0 2px ${RING}}`,
            '.dshp-t-notice{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 9px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            `.dshp-t-error{color:${ERROR_TEXT}}`,
            '.dshp-t-retry{flex:none;display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border:0;border-radius:var(--dsw-radius-sm);background:none;font:inherit;font-size:12px;color:inherit;cursor:pointer}',
            '.dshp-t-retry:hover,.dshp-t-retry:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}',
            `.dshp-t-retry:focus-visible{box-shadow:inset 0 0 0 2px ${RING}}`,
            '.dshp-t-foot-btn{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-height:32px;padding:6px 9px;border:0;border-radius:var(--dsw-radius-lg);background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer}',
            '.dshp-t-foot-btn:hover,.dshp-t-foot-btn:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
            `.dshp-t-foot-btn:focus-visible{box-shadow:inset 0 0 0 2px ${RING}}`,
            // Threads: right-sidebar pane
            '.dshp-t-pane{box-sizing:border-box;height:100%;overflow:auto;padding:14px 10px 24px;color:var(--dsw-alias-label-primary);container:dshp-pane/inline-size}',
            '.dshp-t-pane-head{display:flex;flex-direction:column;gap:2px;padding:0 10px 8px}',
            '.dshp-t-pane-head .dshp-t-project{font-size:14px;line-height:20px}',
            '.dshp-t-pane-head .dshp-t-count{font-size:12px;line-height:18px}',
            '.dshp-t-pane .dshp-t-row{min-height:54px;padding:8px 8px 8px 10px;font-size:13px;line-height:18px}',
            '.dshp-t-pane .dshp-t-dot{height:18px}',
            '.dshp-t-pane .dshp-t-meta{height:17px;line-height:17px}',
            '.dshp-t-pane .dshp-t-line{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;white-space:normal;font-size:12px;line-height:17px}',
            '.dshp-t-pane .dshp-t-group{padding:12px 10px 4px}',
            '.dshp-t-empty{padding:28px 16px;text-align:center;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            // Threads: a thread's chat in the right sidebar
            '.dshp-t-chat{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0}',
            '.dshp-t-chat-bar{flex:none;display:flex;align-items:center;gap:8px;box-sizing:border-box;min-height:40px;padding:4px 8px 4px 12px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-t-chat-title{display:flex;flex-direction:column;flex:1;min-width:0}',
            '.dshp-t-chat-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:500;line-height:17px;color:var(--dsw-alias-label-primary)}',
            '.dshp-t-chat-sub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-chat-body{display:flex;flex:1 1 auto;min-width:0;min-height:0}',
            '.dshp-t-tab-title{display:inline-flex;align-items:center;gap:6px;min-width:0}',
            '.dshp-t-tab-title>span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            // Threads: cards under a turn
            '.dshp-t-cards{display:flex;flex-direction:column;overflow:hidden;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-bg-layer-1);container-type:inline-size}',
            // A card is a grid: icon, then verb, name and reason stacked, then counts, state and actions.
            '.dshp-t-card{display:grid;grid-template-columns:28px minmax(0,1fr) auto auto auto;align-items:center;row-gap:1px;box-sizing:border-box;min-height:48px;padding:8px 10px 8px 12px}',
            '.dshp-t-card+.dshp-t-card{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-t-card-icon{grid-column:1;grid-row:1/4;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-card-text{display:contents}',
            '.dshp-t-card-verb{grid-column:2;grid-row:1;min-width:0;margin-left:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-card-title{grid-column:2;grid-row:2;justify-self:start;max-width:calc(100% - 10px);margin-left:10px;overflow:hidden;padding:0;border:0;background:none;font:inherit;font-size:13px;font-weight:500;line-height:19px;color:var(--dsw-alias-label-primary);text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}',
            '.dshp-t-card-title:hover{text-decoration:underline}',
            `.dshp-t-card-title:focus-visible{outline:none;border-radius:3px;box-shadow:0 0 0 2px ${RING}}`,
            '.dshp-t-card-title:disabled{cursor:default;text-decoration:none}',
            '.dshp-t-card-state{grid-column:4;grid-row:1/4;margin-left:10px;display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
            '.dshp-t-card-actions{grid-column:5;grid-row:1/4;margin-left:10px;display:inline-flex;align-items:center;gap:4px}',
            '.dshp-t-card>.dshp-t-changes{grid-column:3;grid-row:1/4;margin-left:10px}',
            '.dshp-t-card-side{display:contents}',
            '.dshp-t-card-actions .dshp-t-icon{width:28px;height:28px;margin:0}',
            // Threads: a thread whose last turn failed or stopped, on its newest card
            '.dshp-t-card[data-card-tone=error] .dshp-t-card-icon{color:var(--dsw-alias-state-error-primary)}',
            '.dshp-t-card-why{grid-column:2;grid-row:3;margin-left:10px;display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:12px;line-height:17px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}',
            '.dshp-t-row-acts{display:inline-flex;align-items:center;gap:2px}',
            '.dshp-t-icon:disabled{cursor:default}',
            // A narrow chat gives the name the counts' room: they join the verb line, and drop their file count first.
            '@container (width<=560px){.dshp-t-card>.dshp-t-changes{grid-row:1;height:16px;margin-left:6px;padding:0 3px}.dshp-t-card>.dshp-t-changes .dshp-t-changes-icon{display:none}.dshp-t-card-title,.dshp-t-card-why{grid-column:2/4}}',
            // Narrower still, the state and buttons move to a row of their own under the name, which keeps the card's width.
            '@container (width<=460px){.dshp-t-card .dshp-t-files{display:none}.dshp-t-card-icon{align-self:start}.dshp-t-card-side{grid-column:2/4;grid-row:4;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0 0 10px}.dshp-t-card-side>.dshp-t-card-state,.dshp-t-card-side>.dshp-t-card-actions{margin-left:0}.dshp-t-card-side>.dshp-t-card-actions:only-child{margin-left:auto}}',
            '@container (width<=300px){.dshp-t-go-label{display:none}}',
            // Threads: a thread's code changes, in DSH's colors for added and deleted lines
            '.dshp-t-changes{flex:none;display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;height:26px;padding:0 7px;border:0;border-radius:var(--dsw-radius-md);background:none;font:inherit;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
            'button.dshp-t-changes{cursor:pointer}',
            'button.dshp-t-changes:hover,button.dshp-t-changes:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
            'button.dshp-t-changes:focus-visible{box-shadow:inset 0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
            '.dshp-t-changes-icon{flex:none;display:inline-flex}',
            '.dshp-t-counts{display:inline-flex;gap:5px;font-family:var(--ds-font-family-code);font-variant-numeric:tabular-nums}',
            // DSH's green is too light to read on white at this size; deepened toward the text color.
            '.dshp-t-added{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary))}',
            `.dshp-t-deleted{color:${ERROR_TEXT}}`,
            // DSH's hover card is dark in both themes.
            '.dshp-t-hover-line .dshp-t-added{color:var(--dsw-alias-state-success-primary)}',
            '.dshp-t-hover-line .dshp-t-deleted{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 60%,white)}',
            '.dshp-t-row-changes{flex:none;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}',
            // Threads: a new project's suggested first asks, under the coordinator's greeting
            '.dshp-t-suggest{display:flex;flex-direction:column;gap:8px}',
            '.dshp-t-suggest-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-suggest-list{display:flex;flex-wrap:wrap;gap:8px}',
            '.dshp-t-suggest-item{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;max-width:100%;min-height:32px;padding:5px 12px 5px 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-bg-layer-1);font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;transition:background-color .1s}',
            '.dshp-t-suggest-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-t-suggest-item:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
            '.dshp-t-suggest-item svg{flex:none;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-suggest-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            // Threads: a paused project, in the menu and the pane
            '.dshp-t-paused{display:flex;align-items:center;gap:10px;margin:0 0 4px;padding:8px 8px 8px 10px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-t-paused-icon{flex:none;display:inline-flex;color:var(--dsw-alias-label-primary)}',
            '.dshp-t-paused-text{flex:1;min-width:0}',
            '.dshp-t-paused-text b{font-weight:600;color:var(--dsw-alias-label-primary)}',
            '.dshp-t-pane .dshp-t-paused{margin:0 0 8px;padding:10px 10px 10px 12px;font-size:13px;line-height:19px}',
            '.dshp-t-paused-mark{color:var(--dsw-alias-label-secondary)}',
            // A paused project, above the message box (as DSH docks a goal there)
            '.dshp-dock{box-sizing:border-box;width:calc(100% - 2 * var(--dsh-composer-side-clearance,0px) - 4 * var(--dsh-composer-dock-inset,0px));margin:0 auto;container:dshp-dock/inline-size}',
            '.dshp-dock-bar{isolation:isolate;position:relative;box-sizing:border-box;display:flex;align-items:center;gap:10px;width:100%;max-width:calc(var(--dsh-composer-card-max-width,760px) - 4 * var(--dsh-composer-dock-inset,0px));min-height:36px;margin:0 auto;padding:4px 5px 4px 12px;border-radius:var(--dsw-radius-md);box-shadow:var(--dsw-elevation-panel);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1)}',
            '.dshp-dock-bar::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);pointer-events:none}',
            '.dshp-dock-glyph{flex:none;display:inline-flex;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-dock-label{flex:none;font-size:13px;font-weight:500;line-height:24px;color:var(--dsw-alias-label-primary)}',
            '.dshp-dock-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary-dimmed,var(--dsw-alias-label-secondary))}',
            // In a narrow chat the text takes its own line under the label, so the held count and what it means stay whole.
            '@container dshp-dock (max-width:600px){.dshp-dock-bar{flex-wrap:wrap;row-gap:0;padding-bottom:7px}.dshp-dock-label{flex:1 1 auto}.dshp-dock-text{order:1;box-sizing:border-box;flex:1 1 100%;padding-inline:24px 7px;white-space:normal}}',
            // Threads: `[title](.dsh-thread/t3)` in a reply (DSH draws it as a file link)
            'button[title*=".dsh-thread/"]>svg:first-child{display:none}',
            `button[title*=".dsh-thread/"][title]{color:${LINK_TEXT}}`,
            `button[title*=".dsh-thread/"]::before{content:"";display:inline-block;flex:none;width:1.1em;height:1.1em;margin-right:5px;vertical-align:-.25em;background-color:currentColor;-webkit-mask:${BRANCH_MASK} center/contain no-repeat;mask:${BRANCH_MASK} center/contain no-repeat}`,
            // DSH draws the link as an inline block, which sits on its last line: in a list, a link that wraps would
            // pull the bullet down to its second line, so it hangs from the top of the line instead.
            'li button[title*=".dsh-thread/"]{vertical-align:top}',
            // Threads: session list rows. A thread row right under its coordinator is indented so its corner sits
            // under the coordinator's ◆ (the rules come with the coordinator's row, see RowPlace); a thread row
            // anywhere else keeps a branch mark.
            '.dshp-t-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-branch{display:inline-flex}',
            '.dshp-t-corner{display:none}',
            '.dshp-t-hover{display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:#cfd3d6}',
            '.dshp-t-hover-head{display:flex;align-items:center;gap:6px;color:#fff}',
            '.dshp-t-hover-line{color:#adb2b8;overflow-wrap:anywhere}',
            // The same 6px between the counts and "· N files" as on cards and rows.
            '.dshp-t-hover-line[data-projects-changes]{display:flex;align-items:center;gap:6px}',
            // Project settings dialog
            '.dshp-t-gear{padding:3px 5px}',
            '.dshp-t-pane-head{position:relative;padding-right:40px}',
            '.dshp-t-pane-gear{position:absolute;top:2px;right:6px}',
            '.dshp-ps.dshp-ps{width:min(560px,100%);max-height:100%}',
            '.dshp-ps-content{min-height:0;overflow-y:auto;padding-bottom:4px;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)}',
            '.dshp-ps-sub{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
            '.dshp-ps-sub b{font-weight:500;color:var(--dsw-alias-label-primary)}',
            '.dshp-ps-path{display:inline-flex;align-items:center;gap:4px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-path>svg{flex:none}',
            '.dshp-ps-path>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-ps-section+.dshp-ps-section{margin-top:22px}',
            '.dshp-ps-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 2px 8px}',
            '.dshp-ps-heading{margin:0;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}',
            '.dshp-ps-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
            '.dshp-ps-card{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4));border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2))}',
            '.dshp-ps-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;box-sizing:border-box;min-height:60px;padding:12px 14px}',
            '.dshp-ps-row+.dshp-ps-row{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-ps-text{display:flex;flex-direction:column;flex:1 1 220px;gap:2px;min-width:0}',
            '.dshp-ps-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
            '.dshp-ps-title>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-ps-title>.dshp-ps-dot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px}',
            '.dshp-ps-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-source{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-fit{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-own{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-own::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}',
            '.dshp-ps-link{padding:0;border:0;background:none;font:inherit;color:var(--dsw-alias-label-secondary);text-decoration:underline;text-decoration-color:var(--dsw-alias-border-l4);text-underline-offset:2px;cursor:pointer}',
            '.dshp-ps-link:hover,.dshp-ps-link:focus-visible{outline:none;color:var(--dsw-alias-label-primary);text-decoration-color:currentColor}',
            `.dshp-ps-link:focus-visible{border-radius:3px;box-shadow:0 0 0 2px ${RING}}`,
            '.dshp-ps-link:disabled{cursor:default;opacity:.6}',
            '.dshp-ps-alert{flex:1 0 100%;margin:0;padding:6px 8px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px}',
            `.dshp-ps-alert.dshp-ps-error{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));color:${ERROR_TEXT}}`,
            '.dshp-ps-alert.dshp-ps-info{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-empty{padding:16px 14px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-more{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;min-height:40px;padding:8px 14px;border:0;border-top:.5px solid var(--dsw-alias-border-l2);background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);text-align:left;cursor:pointer;border-radius:0 0 var(--dsw-radius-xl) var(--dsw-radius-xl)}',
            '.dshp-ps-more:hover,.dshp-ps-more:focus-visible{outline:none;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
            `.dshp-ps-more:focus-visible{box-shadow:inset 0 0 0 2px ${RING}}`,
            '.dshp-ps-more svg{transition:transform .12s}',
            '.dshp-ps-more[aria-expanded=true] svg{transform:rotate(90deg)}',
            '.dshp-ps-note{margin:18px 2px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:36px 12px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
            `.dshp-ps-state.dshp-ps-error{color:${ERROR_TEXT}}`,
            // The Projects page (the Projects entry in the sidebar): DSH's page layout, as on Automation tasks,
            // with a card per project and its threads by state.
            '.dshp-pg{display:flex;width:100%;min-width:0;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.6}',
            '.dshp-pg-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable;--dsh-scrollbar-width:9px;--dsh-scrollbar-thumb-border:2px}',
            '.dshp-pg-content{max-width:960px;margin:0 auto;padding:0 clamp(24px,4vw,48px) 48px}',
            '.dshp-pg-heading{display:flex;align-items:baseline;gap:12px;margin-bottom:20px;padding-top:28px}',
            '[data-platform=darwin] .dshp-pg-heading{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}',
            '.dshp-pg-heading h1{margin:0;font-size:20px;font-weight:500;line-height:28px}',
            '.dshp-pg-count{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-pg-list{display:flex;flex-direction:column;gap:16px;margin:0;padding:0;list-style:none}',
            '.dshp-pg-card{border:.5px solid var(--dsw-alias-border-l3);border-radius:16px;background:var(--dsw-alias-bg-base)}',
            '.dshp-pg-head{display:flex;align-items:center;gap:12px;min-height:32px;padding:14px 14px 0 18px}',
            '.dshp-pg-title{display:flex;align-items:center;gap:10px;flex:1;min-width:0;margin:0;font-size:16px;font-weight:500;line-height:24px}',
            '.dshp-pg-name{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:100%;padding:0;border:0;border-radius:4px;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}',
            '.dshp-pg-name:disabled{cursor:default}',
            '.dshp-pg-name:not(:disabled):hover .dshp-pg-name-text{text-decoration:underline;text-underline-offset:3px}',
            `.dshp-pg-name:focus-visible{outline:none;box-shadow:0 0 0 2px ${RING}}`,
            '.dshp-pg-diamond{flex:none;font-size:13px}',
            '.dshp-pg-name-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-pg-badge{flex:none;display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:11px;background:var(--dsw-alias-interactive-bg-hover);font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-pg-actions{flex:none;display:flex;align-items:center;gap:6px}',
            '.dshp-pg-meta{display:flex;flex-wrap:wrap;align-items:center;min-width:0;padding:2px 18px 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-pg-meta>*+*::before{content:"·";padding:0 6px}',
            '.dshp-pg-folder{display:inline-flex;align-items:center;gap:4px;min-width:0}',
            '.dshp-pg-folder>svg{flex:none}',
            '.dshp-pg-models{display:flex;flex-wrap:wrap;gap:2px 16px;padding:2px 18px 0;font-size:13px;line-height:20px}',
            '.dshp-pg-model{display:inline-flex;align-items:baseline;gap:6px;min-width:0;padding:0;border:0;border-radius:4px;background:none;font:inherit;color:var(--dsw-alias-label-primary);text-align:left}',
            '.dshp-pg-model>span:first-child{color:var(--dsw-alias-label-secondary)}',
            'button.dshp-pg-model{cursor:pointer}',
            'button.dshp-pg-model:hover>span:last-child{text-decoration:underline;text-underline-offset:3px}',
            `button.dshp-pg-model:focus-visible{outline:none;box-shadow:0 0 0 2px ${RING}}`,
            '.dshp-pg-body{padding:10px 8px 8px}',
            '.dshp-pg-body .dshp-t-paused{margin:0 4px 6px}',
            '.dshp-pg-body .dshp-t-row{grid-template-columns:16px minmax(0,1fr) auto;column-gap:10px;min-height:52px;padding:8px 10px;border-radius:12px;font-size:14px;line-height:21px}',
            '.dshp-pg-body .dshp-t-dot{width:16px;height:21px}',
            '.dshp-pg-body .dshp-t-line,.dshp-pg-body .dshp-t-meta{height:auto;font-size:13px;line-height:20px}',
            '.dshp-pg-body .dshp-t-group{padding:8px 10px 4px;font-size:12px;line-height:18px}',
            '.dshp-pg-body .dshp-t-notice{padding:6px 10px 8px;font-size:13px;line-height:20px}',
            '.dshp-pg-state{padding:48px 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}',
            `.dshp-pg-state.dshp-t-error{color:${ERROR_TEXT}}`,
            '.dshp-pg-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:72px 20px;text-align:center;color:var(--dsw-alias-label-secondary)}',
            '.dshp-pg-empty-glyph{display:inline-flex;margin-bottom:4px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-pg-empty h2{margin:0;font-size:15px;font-weight:500;line-height:22px;color:var(--dsw-alias-label-primary)}',
            '.dshp-pg-empty p{max-width:440px;margin:0;font-size:13px;line-height:21px}',
            '.dshp-pg-empty .dshp-pg-cta{margin-top:12px}',
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

        /**
         * The Host model catalog, shared by every part of the window: the
         * forms read it again each time they open, and the thread views load
         * it once to name models.
         * @param remoteOf - DSH's `remote` service, or undefined until DSH provides it.
         */
        function catalogSource(remoteOf) {
            let snapshot = { status: 'idle', value: undefined };
            let tried = 0;
            // A reload asked for while a read is in flight runs once that read lands.
            let again = false;
            const listeners = new Set();
            const set = (next) => {
                snapshot = next;
                for (const listener of [...listeners]) listener();
                if (again && next.status !== 'loading') {
                    again = false;
                    source.load();
                }
            };
            const source = {
                getSnapshot: () => snapshot,
                subscribe: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                load() {
                    if (snapshot.status === 'loading') return;
                    tried = Date.now();
                    set({ status: 'loading', value: snapshot.value });
                    let session;
                    try { session = remoteOf()?.session; } catch { session = undefined; }
                    if (!session || typeof session.modelCatalog !== 'function') {
                        set({ status: 'failed', value: snapshot.value });
                        return;
                    }
                    Promise.resolve().then(() => session.modelCatalog()).then((result) => {
                        const value = result && result.ok === true ? result.value : result && Array.isArray(result.groups) ? result : undefined;
                        set(value ? { status: 'ready', value } : { status: 'failed', value: snapshot.value });
                    }, () => set({ status: 'failed', value: snapshot.value }));
                },
                /** Load once, for views that only name models; a failed read is tried again after a while. */
                ensure() {
                    if (snapshot.status === 'idle' || (snapshot.status === 'failed' && Date.now() - tried > 15000)) source.load();
                },
                /** DSH's remote arrived or changed: the next ensure reads again. */
                reset() {
                    if (snapshot.status !== 'loading') set({ status: 'idle', value: snapshot.value });
                },
                /** DSH's default model may have changed: read again now, or right after the read in flight. */
                reload() {
                    if (snapshot.status === 'loading') again = true;
                    else source.load();
                },
            };
            return source;
        }

        const selectionKey = (s) => (s ? `${s.provider}:${s.model}:${s.reasoningEffort ?? ''}` : '');

        /**
         * Each loaded session's model pick, keyed as selectionKey ('' for a
         * session DSH has sent with no pick yet); sessions DSH has not sent
         * are left out, so loading one is not taken for a pick.
         */
        function picksIn(state) {
            const out = new Map();
            const ids = new Set([...Object.keys(state?.projectionsBySession ?? {}), ...Object.keys(state?.byId ?? {})]);
            for (const id of ids) {
                const value = state.projectionsBySession?.[id]?.values?.modelSelection ?? state.byId?.[id]?.projectionValues?.modelSelection;
                if (isObject(value)) out.set(id, selectionKey(selectionIn(state, id)));
            }
            return out;
        }

        /** After a pick, when to read the catalog again while it still names another default (ms after the pick). */
        const DEFAULT_RETRIES = [300, 1000, 2500];

        /**
         * A pick in any chat's composer is also DSH's new default model, saved
         * in the background (its session controller's selectModel). The
         * catalog read once would keep naming the old one, so a new pick in a
         * loaded session reads it again, and again a moment later while the
         * save has not landed. The plugin's own picks for its sessions leave
         * DSH's default as it is; they cost a few reads.
         * @returns a stop function.
         */
        function followDefault(sessions, catalog, timers = {}) {
            const frame = timers.frame ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16));
            const cancel = timers.cancel ?? (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout);
            const later = timers.later ?? setTimeout;
            const clear = timers.clear ?? clearTimeout;
            let seen = picksIn(sessions.list.getSnapshot());
            let pending = 0;
            let retry;
            const check = () => {
                pending = 0;
                const now = picksIn(sessions.list.getSnapshot());
                let picked;
                for (const [id, key] of now) if (key !== '' && seen.has(id) && seen.get(id) !== key) picked = key;
                seen = now;
                // A catalog nothing has read yet is read fresh by the first view that needs it.
                if (picked === undefined || catalog.getSnapshot().status === 'idle') return;
                clear(retry);
                catalog.reload();
                const again = (i, at) => {
                    if (i >= DEFAULT_RETRIES.length) { retry = undefined; return; }
                    retry = later(() => {
                        if (selectionKey(catalog.getSnapshot().value?.default) === picked) { retry = undefined; return; }
                        catalog.reload();
                        again(i + 1, DEFAULT_RETRIES[i]);
                    }, DEFAULT_RETRIES[i] - at);
                };
                again(0, 0);
            };
            const off = sessions.list.subscribe(() => { if (!pending) pending = frame(check); });
            return () => {
                off();
                if (pending) cancel(pending);
                clear(retry);
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

        /** Provider groups of a model list in catalog order, DSH's own account first as its picker does. */
        function groupsOf(models) {
            const groups = [];
            for (const model of models) {
                let group = groups.find((g) => g.provider === model.provider);
                if (!group) groups.push(group = { provider: model.provider, name: model.providerName, models: [] });
                group.models.push(model);
            }
            const rank = (group) => (group.provider === 'deepseek-account' ? 0 : group.provider === 'deepseek-official' ? 1 : 2);
            return groups.sort((a, b) => rank(a) - rank(b));
        }

        /** A catalog read once for the pickers: its models, provider groups, every effort they list, and the DSH default. */
        function catalogView(catalog) {
            const models = modelsOf(catalog);
            const def = catalog && catalog.default;
            const known = [...new Set(models.flatMap((model) => model.efforts.map((e) => e.id)))];
            return { models, groups: groupsOf(models), known, def, defaultModel: def ? findModel(models, `${def.provider}:${def.model}`) : undefined };
        }

        /** Effort names from least to most reasoning, ranked as the plugin ranks them (lib/settings.js). */
        const EFFORT_ORDER = ['off', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

        /** The level a model runs for an effort it lacks, as the plugin picks it: the highest at or below it, else its lowest. */
        function nearestEffort(offered, effort, known) {
            const rank = (e) => {
                const i = EFFORT_ORDER.indexOf(e);
                return i >= 0 ? i : EFFORT_ORDER.length + known.indexOf(e);
            };
            const below = offered.filter((e) => rank(e) <= rank(effort)).sort((a, b) => rank(b) - rank(a));
            return below[0] ?? [...offered].sort((a, b) => rank(a) - rank(b))[0];
        }

        /**
         * What a model and effort setting runs on: the catalog model (DSH's
         * default model when none is set) and the effort DSH fills in for it.
         * @param {object} cv - catalogView().
         * @param {string|undefined} modelText - "provider:model", or unset.
         * @param {string|undefined} effortText - an effort id, or unset.
         */
        function resolveRoute(cv, modelText, effortText) {
            const set = typeof modelText === 'string' && modelText.trim() !== '';
            const model = set ? findModel(cv.models, modelText, cv.def && cv.def.provider) : cv.defaultModel;
            const efforts = model ? model.efforts : [];
            const wanted = typeof effortText === 'string' && effortText.trim() !== '' ? effortText.trim() : undefined;
            const asked = wanted ?? (!set && cv.def && cv.def.reasoningEffort ? cv.def.reasoningEffort : model && model.defaultEffort);
            // An effort the model lacks runs at the nearest level it offers (the
            // plugin fits it the same way), or at its default when no model has it.
            const lacks = model && efforts.length > 0 && asked !== undefined && !efforts.some((e) => e.id === asked);
            const effort = lacks ? (cv.known.includes(asked) ? nearestEffort(efforts.map((e) => e.id), asked, cv.known) : model.defaultEffort) : asked;
            // A model the catalog lists says whether it has efforts; until then a stored effort shows as it is.
            const shown = model ? (efforts.length > 0 ? effort : undefined) : wanted;
            return {
                model,
                name: model ? model.name : set ? modelText.trim().replace(/^[a-zA-Z0-9_-]+[:/]/, '') : 'DSH default',
                efforts,
                effort: shown,
                // Like DSH's picker: a model whose provider picks the effort shows "Default".
                effortName: shown !== undefined ? effortName(model, shown) : efforts.length > 0 ? 'Default' : undefined,
                // A set effort the model can't use: fitted, or ignored by a model with no levels.
                unused: lacks || (model && efforts.length === 0 && wanted !== undefined) ? wanted ?? asked : undefined,
            };
        }

        /** An effort's name as any catalog model lists it. */
        function anyEffortName(cv, id) {
            for (const model of cv.models) {
                const found = model.efforts.find((e) => e.id === id);
                if (found) return found.name;
            }
            return String(id).charAt(0).toUpperCase() + String(id).slice(1);
        }

        /**
         * Why a set effort is not what runs (resolveRoute's `unused`), or
         * undefined. An inherited effort on a model without levels is left
         * unsaid, as DSH's picker hides effort for such a model.
         */
        function effortNote(cv, route, own = true) {
            if (route.unused === undefined || !route.model || (!own && route.efforts.length === 0)) return undefined;
            const asked = anyEffortName(cv, route.unused);
            return route.efforts.length === 0
                ? `${route.name} has no effort levels, so ${asked} isn't used.`
                : `${route.name} doesn't offer ${asked}, so it runs at ${route.effortName}.`;
        }

        /**
         * What a loaded session's next request really uses, when it differs
         * from what its setting shows: a coordinator set up on an earlier DSH
         * default keeps that model, and a change can fail.
         */
        function liveNote(cv, route, live) {
            if (!isObject(live) || typeof live.provider !== 'string' || typeof live.model !== 'string' || !route.model) return undefined;
            const model = findModel(cv.models, `${live.provider}:${live.model}`);
            const effort = typeof live.reasoningEffort === 'string' ? live.reasoningEffort : undefined;
            if (model && model.key === route.model.key && (effort === undefined || route.effort === undefined || effort === route.effort)) return undefined;
            return `It runs on ${model ? model.name : live.model}${effort ? ` · ${model ? effortName(model, effort) : effort}` : ''} right now.`;
        }

        const MEASURE = Object.freeze({ visibility: 'hidden', left: 0, top: 0 });

        /**
         * A model and effort control in the shape of DSH's own composer
         * picker: a "Model · Effort" trigger opening a menu with a Model row
         * and an Effort row, each leading to its list (models by provider, with
         * search past four). With `fallback`, both lists start with Default,
         * which hands the choice back to what the setting inherits; without it
         * they hold explicit choices only.
         * @param props.value - {model?, effort?}: the values in force.
         * @param props.own - {model, effort}: whether each is set at this level, so Default is not checked.
         * @param props.fallback - {model?, effort?, modelLabel?, effortLabel?}: what Default means, or undefined.
         * @param props.onPick - called with {model?, effort?}: a value, or null for Default.
         * @param props.autoOpen - open the menu once, when the picker first shows.
         */
        function ModelPicker({ id, label, catalog, value, own, fallback, busy = false, disabled = false, autoOpen = false, onPick }) {
            const cv = React.useMemo(() => catalogView(catalog), [catalog]);
            const route = resolveRoute(cv, value.model, value.effort);
            const base = fallback ? resolveRoute(cv, fallback.model, fallback.effort) : undefined;
            const effortBase = fallback ? resolveRoute(cv, value.model, fallback.effort) : undefined;
            const [open, setOpen] = React.useState(false);
            const [pane, setPane] = React.useState('root');
            const [query, setQuery] = React.useState('');
            const [side, setSide] = React.useState('bottom');
            const rootRef = React.useRef(null);
            const triggerRef = React.useRef(null);
            const menuRef = React.useRef(null);
            const listRef = React.useRef(null);
            const searchRef = React.useRef(null);
            const intent = React.useRef(null);
            const position = ui.useAnchoredPosition({ open, anchorRef: triggerRef, panelRef: menuRef, side, align: 'end', gap: 6, margin: 12 });
            const close = React.useCallback((refocus) => {
                setOpen(false);
                setPane('root');
                setQuery('');
                if (refocus) queueMicrotask(() => triggerRef.current?.focus());
            }, []);
            const dismiss = React.useCallback((next) => { if (!next) close(false); }, [close]);
            ui.useDismissOnOutsidePointer(rootRef, open, dismiss, menuRef);
            React.useEffect(() => { if (disabled) close(false); }, [disabled, close]);
            const showSearch = cv.models.length > 4;
            const typed = showSearch ? query.trim() : '';
            const groups = React.useMemo(() => cv.groups.map((group) => ({ ...group, models: ui.rankByName(group.models, typed) }))
                .filter((group) => group.models.length > 0), [cv.groups, typed]);
            // Once a pane is placed: the search field, the row that opened it, or its checked row.
            React.useLayoutEffect(() => {
                const want = intent.current;
                const menu = menuRef.current;
                if (!open || position === null || want === null || !menu) return;
                intent.current = null;
                const first = menu.querySelector('[data-dshp-pick]:not(:disabled):not([data-dshp-pick=back])');
                const target = want === 'search' ? searchRef.current
                    : want === 'model' || want === 'effort' ? menu.querySelector(`[data-dshp-pick=${want}]`)
                        : want === 'checked' ? menu.querySelector('[data-dshp-pick][aria-checked=true]') ?? first : first;
                target?.focus();
            }, [open, position, pane]);
            React.useEffect(() => {
                const viewport = listRef.current;
                if (!open || pane !== 'model' || viewport === null) return undefined;
                return ui.observeStickyMenuGroups(viewport);
            }, [open, pane, groups]);

            const show = () => {
                if (disabled) return;
                const rect = triggerRef.current?.getBoundingClientRect();
                const below = rect ? window.innerHeight - rect.bottom : Infinity;
                setSide(rect && below < 320 && rect.top > below ? 'top' : 'bottom');
                setPane('root');
                setQuery('');
                intent.current = 'first';
                setOpen(true);
            };
            // Opened from a project's models summary: this menu is what the user asked for.
            React.useEffect(() => { if (autoOpen) show(); }, []);
            const drill = (next) => {
                setQuery('');
                intent.current = next === 'model' && showSearch ? 'search' : 'checked';
                setPane(next);
            };
            const back = () => {
                intent.current = pane;
                setQuery('');
                setPane('root');
            };
            const pick = (change) => {
                close(true);
                onPick(change);
            };
            /** A model change also sets an effort the new model offers, when the effort that would apply is not one. */
            // A new model keeps no effort it can't use: an own effort it lacks is
            // cleared (no levels) or moved to its default; an inherited one is
            // fitted by the plugin when it runs.
            const withEffort = (model, change) => {
                const applies = own.effort ? value.effort : fallback?.effort;
                if (!model || !applies || model.efforts.some((e) => e.id === applies)) return change;
                if (model.efforts.length === 0) return own.effort ? { ...change, effort: null } : change;
                return { ...change, effort: model.defaultEffort ?? model.efforts[0].id };
            };
            const chooseModel = (model) => {
                if (model === null) return own.model ? pick(withEffort(base?.model, { model: null })) : close(true);
                if (own.model && route.model?.key === model.key) return close(true);
                return pick(withEffort(model, { model: model.key }));
            };
            const chooseEffort = (effort) => {
                if (effort === null) return own.effort ? pick({ effort: null }) : close(true);
                if (own.effort && route.effort === effort) return close(true);
                return pick({ effort });
            };

            const onMenuKey = (event) => {
                if (event.nativeEvent?.isComposing) return;
                const menu = menuRef.current;
                if (!menu) return;
                const items = [...menu.querySelectorAll('[data-dshp-pick]:not(:disabled)')];
                const at = items.indexOf(document.activeElement);
                const inSearch = searchRef.current !== null && event.target === searchRef.current;
                const stop = () => { event.preventDefault(); event.stopPropagation(); };
                if (event.key === 'Escape') {
                    stop();
                    if (pane === 'root') close(true);
                    else back();
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    stop();
                    if (items.length === 0) return;
                    const step = event.key === 'ArrowDown' ? 1 : -1;
                    if (inSearch) (step > 0 ? items[0] : items[items.length - 1]).focus();
                    else if (at === 0 && step < 0 && searchRef.current) searchRef.current.focus();
                    else items[at < 0 ? 0 : (at + step + items.length) % items.length].focus();
                } else if ((event.key === 'Home' || event.key === 'End') && !inSearch) {
                    stop();
                    items[event.key === 'Home' ? 0 : items.length - 1]?.focus();
                } else if (event.key === 'ArrowLeft' && !inSearch && pane !== 'root') {
                    stop();
                    back();
                } else if (event.key === 'ArrowRight' && pane === 'root' && at >= 0) {
                    stop();
                    items[at].click();
                } else if (event.key === 'Enter' && inSearch) {
                    stop();
                    menu.querySelector('[data-dshp-model]:not(:disabled)')?.click();
                } else if (event.key === 'Tab') {
                    stop();
                    if (event.shiftKey) {
                        if (pane === 'root') close(true);
                        else back();
                    } else if (at >= 0) items[at].click();
                    else close(true);
                }
            };

            const check = (on) => h('span', { className: 'dshp-mp-check', 'aria-hidden': true }, on ? h(ui.IconCheckOutlineRegular, { size: 14 }) : null);
            const option = ({ key, name, detail, checked, onClick, model = false }) => h('button', {
                key, type: 'button', role: 'menuitemradio', 'aria-checked': checked, className: 'dshp-mp-opt',
                'data-dshp-pick': 'opt', 'data-dshp-model': model ? '' : undefined, title: detail ? `${name} · ${detail}` : name, onClick,
            },
            h('span', { className: 'dshp-mp-opt-copy' },
                h('span', { className: 'dshp-mp-opt-name' }, name),
                detail ? h('span', { className: 'dshp-mp-opt-detail' }, detail) : null),
            check(checked));
            const cell = (which, text, shown) => h('button', {
                key: which, type: 'button', role: 'menuitem', className: 'dshp-mp-cell', 'data-dshp-pick': which, onClick: () => drill(which),
            },
            h('span', { className: 'dshp-mp-cell-label' }, text),
            h('span', { className: 'dshp-mp-cell-value' }, shown),
            h(ui.IconChevronRightOutlineRegular, { size: 12 }));
            const backRow = (text) => h('button', { key: 'back', type: 'button', className: 'dshp-mp-back', 'data-dshp-pick': 'back', onClick: back },
                h(ui.IconChevronLeftOutlineRegular, { size: 12 }), h('span', null, text));
            const sep = (key) => h('div', { key, className: 'dshp-mp-sep', role: 'separator' });

            let content;
            if (pane === 'root') {
                content = [
                    cell('model', 'Model', route.name),
                    route.efforts.length > 0 ? cell('effort', 'Effort', route.effortName ?? 'Default') : null,
                ];
            } else if (pane === 'model') {
                content = [
                    backRow('Model'),
                    showSearch ? h('div', { key: 'search', className: 'dshp-mp-search' }, h(ui.Input, {
                        ref: searchRef, className: query !== '' ? 'dshp-mp-search-box dshp-mp-search-query' : 'dshp-mp-search-box', type: 'text', role: 'searchbox',
                        placeholder: 'Search models…', 'aria-label': 'Search models', value: query,
                        onChange: (event) => setQuery(event.target.value),
                    }), query !== '' ? h('button', {
                        type: 'button', className: 'dshp-mp-search-clear', 'aria-label': 'Clear search',
                        onClick: () => { setQuery(''); searchRef.current?.focus(); },
                    }, h(ui.IconCloseFillRegular, null)) : null) : null,
                    base && typed === '' ? option({
                        key: 'default', name: 'Default', checked: !own.model, onClick: () => chooseModel(null),
                        detail: `${fallback.model ? fallback.modelLabel ?? 'Default' : 'DSH default'} · ${base.name}`,
                    }) : null,
                    base && typed === '' ? sep('sep') : null,
                    h('div', { key: 'list', ref: listRef, className: 'dshp-mp-list scrollable', role: 'menu', 'aria-label': 'Models', hidden: groups.length === 0 },
                        ...groups.map((group) => h(ui.MenuGroup, { key: group.provider, label: group.name },
                            ...group.models.map((model) => option({
                                key: model.key, name: model.name, model: true, onClick: () => chooseModel(model),
                                checked: own.model && route.model !== undefined && route.model.key === model.key,
                            }))))),
                    groups.length === 0 ? h('div', { key: 'empty', className: 'dshp-mp-empty', role: 'status' },
                        cv.models.length === 0 ? 'No models to choose from yet.' : 'No matching models.') : null,
                ];
            } else {
                const effortSource = fallback?.effort ? fallback.effortLabel ?? 'Default' : value.model ? 'Model default' : 'DSH default';
                content = [
                    backRow('Effort'),
                    effortBase ? option({
                        key: 'default', name: 'Default', checked: !own.effort, onClick: () => chooseEffort(null),
                        detail: `${effortSource} · ${effortBase.effortName ?? 'none'}`,
                    }) : null,
                    effortBase ? sep('sep') : null,
                    ...route.efforts.map((effort) => option({
                        key: effort.id, name: effort.name, onClick: () => chooseEffort(effort.id),
                        checked: own.effort && route.effort === effort.id,
                    })),
                ];
            }
            const caption = route.effortName ? `${route.name} · ${route.effortName}` : route.name;
            const menu = open ? ReactDOM.createPortal(h(ui.MenuSurface, {
                ref: menuRef, id: `${id}-menu`, className: 'dshp-mp-menu', role: pane === 'model' ? 'group' : 'menu',
                'aria-label': `${label}: model and effort`, 'data-projects-model-menu': id,
                style: position ?? MEASURE,
                onKeyDown: onMenuKey,
            }, ...content), document.body) : null;
            return h('div', { ref: rootRef, className: 'dshp-mp', 'data-projects-model-picker': id },
                h('button', {
                    ref: triggerRef, type: 'button', id, className: 'dshp-mp-trigger', disabled,
                    'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? `${id}-menu` : undefined,
                    'aria-label': `${label}: ${caption}`, 'aria-busy': busy || undefined, title: caption,
                    onClick: () => (open ? close(true) : show()),
                    onKeyDown: (event) => {
                        if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !open) {
                            event.preventDefault();
                            show();
                        }
                    },
                },
                h('span', { className: 'dshp-mp-name' }, route.name),
                route.effortName ? h('span', { className: 'dshp-mp-effort' }, route.effortName) : null,
                busy ? h(ui.StateDot, { state: 'ongoing' }) : h(ui.IconChevronDownOutlineRegular, { size: 12, className: open ? 'dshp-mp-chev dshp-mp-chev-open' : 'dshp-mp-chev' })),
                menu);
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
            const head = h('h4', { className: 'dshp-title' }, route.title);
            if (catalog.status === 'failed' && models.length === 0) {
                return h('section', { className: 'dshp-section', 'data-projects-route': route.id },
                    head, h('p', { className: 'dshp-hint' }, route.hint),
                    h('div', { className: 'dshp-row' }, ...TextFields({ route, state, actions, disabled })));
            }
            const text = (name) => state[name].text.trim();
            const cv = catalogView(catalog.value);
            const shown = resolveRoute(cv, text(route.model) || undefined, text(route.effort) || undefined);
            const note = text(route.effort) !== '' ? effortNote(cv, shown) : undefined;
            const fix = shown.efforts.length === 0 ? { label: 'Clear it', value: '' } : { label: `Use ${shown.effortName}`, value: shown.effort ?? '' };
            return h('section', { className: 'dshp-section', 'data-projects-route': route.id },
                head,
                h('div', { className: 'dshp-route' },
                    h('div', { className: 'dshp-route-text' },
                        h('p', { className: 'dshp-hint' }, route.hint),
                        note ? h('p', { className: 'dshp-hint dshp-route-note', 'data-projects-route-note': '' }, note, ' ',
                            h('button', { type: 'button', className: 'dshp-ps-link', disabled, onClick: () => actions.edit(route.effort, fix.value) }, fix.label)) : null),
                    h(ModelPicker, {
                        id: `dshp-${route.id}`, label: route.title, catalog: catalog.value, disabled,
                        value: { model: text(route.model) || undefined, effort: text(route.effort) || undefined },
                        own: { model: text(route.model) !== '', effort: text(route.effort) !== '' },
                        // Unset plugin defaults leave the choice to DSH's own default model.
                        fallback: {},
                        onPick: (pick) => {
                            if (pick.model !== undefined) actions.edit(route.model, pick.model ?? '');
                            if (pick.effort !== undefined) actions.edit(route.effort, pick.effort ?? '');
                        },
                    })));
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

        const TABLE = {
            heading: 'Projects',
            hint: 'What each project runs. A project\'s own choice comes first, then its row in your profile, then the Default models above.',
            loading: 'Loading projects…',
            failed: 'The projects plugin didn\'t answer, so its projects can\'t be listed right now.',
            none: 'No projects yet. Add one under "projects" in this plugin\'s config.',
            project: 'Project',
            settings: 'Settings',
            paused: 'Paused',
        };
        /** Where a project's model and effort come from: a line for one source, a phrase each for two. */
        const SOURCE_LINE = { 'project setting': 'Set for this project', 'project config': 'From your profile', 'plugin default': 'From Default models', 'DSH default': 'Follows DSH\'s default model' };
        const SOURCE_PHRASE = { 'project setting': 'set for this project', 'project config': 'from your profile', 'plugin default': 'from Default models', 'DSH default': 'follows DSH' };

        /**
         * The source of a model and effort pair, naming the effort's own
         * source when it differs. `long` adds what DSH's default model is.
         */
        function sourceLine(m, e, { long = false } = {}) {
            if (!isObject(e) || e.value == null || e.source === m?.source) {
                const line = SOURCE_LINE[m?.source] ?? '';
                return long && m?.source === 'DSH default' ? `${line}, the one last picked in any DSH chat` : line;
            }
            return `Model ${SOURCE_PHRASE[m?.source] ?? ''} · effort ${SOURCE_PHRASE[e.source] ?? ''}`;
        }

        /** A coordinator selection signature, to read the table again when a pick changes one. */
        function selectionsKey(state, sessionIds) {
            return sessionIds.map((id) => {
                const picked = selectionIn(state, id);
                return picked ? `${picked.provider}:${picked.model}:${picked.reasoningEffort ?? ''}` : '';
            }).join('|');
        }

        /**
         * Every project with what its coordinator and new threads run on and
         * where each setting comes from, as the plugin resolves them. It reads
         * again every few seconds while shown, and soon after a pick in a
         * coordinator's model menu.
         */
        function ProjectsTable({ link, dialog, catalog, sessionsOf }) {
            const cat = React.useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
            const cv = React.useMemo(() => catalogView(cat.value), [cat.value]);
            const settingsOn = useSettingsAvailable(dialog);
            const [list, setList] = React.useState(null);
            const [failed, setFailed] = React.useState(false);
            const alive = React.useRef(true);
            const read = React.useCallback(async () => {
                const result = await link.call('list', {});
                if (!alive.current) return;
                if (result.ok && Array.isArray(result.value?.projects)) {
                    setList(result.value.projects.filter((p) => isObject(p) && typeof p.id === 'string'));
                    setFailed(false);
                } else {
                    setFailed(true);
                }
            }, [link]);
            React.useEffect(() => {
                alive.current = true;
                catalog.ensure();
                void read();
                const timer = setInterval(() => {
                    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void read();
                }, 3000);
                return () => { alive.current = false; clearInterval(timer); };
            }, [read, catalog]);
            const coordinators = (list ?? EMPTY).map((p) => p.coordinator).filter((id) => typeof id === 'string' && id !== '');
            const key = coordinators.join('\n');
            React.useEffect(() => {
                const sessions = sessionsOf();
                if (!sessions?.list || coordinators.length === 0) return undefined;
                let last = selectionsKey(sessions.list.getSnapshot(), coordinators);
                const timers = new Set();
                const later = (ms) => { const t = setTimeout(() => { timers.delete(t); void read(); }, ms); timers.add(t); };
                const unsubscribe = sessions.list.subscribe(() => {
                    const next = selectionsKey(sessions.list.getSnapshot(), coordinators);
                    if (next === last) return;
                    last = next;
                    // The plugin records a pick as it happens; read once soon and once more to be sure.
                    later(300);
                    later(1500);
                });
                return () => { unsubscribe(); for (const t of timers) clearTimeout(t); };
            }, [key, read, sessionsOf]);

            const head = [
                h('h3', { key: 'h', className: 'dshp-heading' }, TABLE.heading),
                h('p', { key: 'p', className: 'dshp-hint' }, TABLE.hint),
            ];
            let body;
            if (list === null) {
                body = h('div', { className: 'dshp-pt-state', role: failed ? 'alert' : 'status' }, failed ? TABLE.failed : TABLE.loading);
            } else if (list.length === 0) {
                body = h('div', { className: 'dshp-pt-state' }, TABLE.none);
            } else {
                const cell = (key, label, value, caption) => h('div', { key, className: 'dshp-pt-cell', role: 'cell' },
                    h('span', { className: 'dshp-pt-label' }, label),
                    h('span', { className: 'dshp-pt-value', title: value }, value),
                    caption ? h('span', { className: 'dshp-pt-source' }, caption) : null);
                const routeCell = (p, key, label, mKey, eKey, live) => {
                    const m = p.settings?.[mKey];
                    const e = p.settings?.[eKey];
                    const route = resolveRoute(cv, m?.value ?? undefined, e?.value ?? undefined);
                    return cell(key, label, routeLabel(route), (live ? liveNote(cv, route, live) : undefined) ?? sourceLine(m, levelsOf(route) ? e : undefined));
                };
                const threadsLine = (t) => {
                    const open = Number(t?.open) || 0;
                    const resolved = Number(t?.resolved) || 0;
                    if (open + resolved === 0) return 'No threads yet';
                    return resolved > 0 ? `${plural(open, 'open thread')} · ${resolved} resolved` : plural(open, 'open thread');
                };
                body = h('div', { className: 'dshp-pt', role: 'table', 'aria-label': TABLE.heading },
                    h('div', { className: 'dshp-pt-row dshp-pt-head', role: 'row' },
                        ...[TABLE.project, TEXT.coordinator, 'New threads', ''].map((text, i) => h('span', { key: i, role: 'columnheader' }, text))),
                    ...list.map((p) => h('div', { key: p.id, className: 'dshp-pt-row', role: 'row', 'data-projects-table-row': p.id },
                        h('div', { className: 'dshp-pt-cell', role: 'cell' },
                            h('span', { className: 'dshp-pt-name' },
                                h('span', { className: 'dshp-pt-diamond', 'aria-hidden': true }, '◆'),
                                h('span', { className: 'dshp-pt-name-text', title: p.workspace || undefined }, p.name || p.id),
                                p.paused ? h('span', { className: 'dshp-pt-badge' }, TABLE.paused) : null),
                            h('span', { className: 'dshp-pt-source' }, threadsLine(p.threads))),
                        routeCell(p, 'c', TEXT.coordinator, 'coordinatorModel', 'coordinatorEffort', p.live),
                        routeCell(p, 't', 'New threads', 'threadModel', 'threadEffort'),
                        h('div', { className: 'dshp-pt-cell dshp-pt-action', role: 'cell' },
                            settingsOn ? h(ui.Button, {
                                variant: 'outline', size: 'sm', 'aria-label': `${SETTINGS.title}: ${p.name || p.id}`,
                                onClick: () => dialog.open(p.id),
                            }, TABLE.settings) : null))));
            }
            return h('section', { className: 'dshp-projects', 'data-projects-table': '' }, ...head, body);
        }

        function applyDefaultsForm(ctx, { catalog, link, dialog, sessionsOf }) {
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
            const Page = (props) => (props.view === 'summary'
                ? 'Default models and effort for coordinators and threads.'
                : h('div', { className: 'dshp-page' },
                    h(DefaultsForm, { form, catalog }),
                    h(ProjectsTable, { link, dialog, catalog, sessionsOf })));
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
        /** DSH's Review tab for one turn's changes (dsh-client-ui-deliverables): `<session>/<seq>/<turn>`. */
        const REVIEW_PREFIX = 'dsh-resource://changes-review/session/';
        const IDS = {
            menu: `${BUNDLE}/threads-menu`,
            cards: `${BUNDLE}/thread-cards`,
            mark: `${BUNDLE}/thread-mark`,
            hover: `${BUNDLE}/thread-hover`,
            chat: `${BUNDLE}/thread-chat`,
            pane: `${BUNDLE}/threads-pane`,
            link: `${BUNDLE}/thread-link`,
            settings: `${BUNDLE}/project-settings`,
            settingsItem: `${BUNDLE}/project-settings-item`,
            paused: `${BUNDLE}/paused-bar`,
            place: `${BUNDLE}/row-place`,
            page: `${BUNDLE}/projects`,
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
            paused: 'Paused',
            projectPaused: 'Project paused',
            pausedCoordinator: 'New threads and handbacks wait until you resume.',
            pausedNewThreads: 'New threads wait too.',
            pausedThread: 'This thread\'s handbacks wait until the project resumes.',
            heldLine: 'held until you resume',
            handbackHeld: 'Handback held',
            handbackHeldWhy: 'The project is paused, so the coordinator gets this handback when you resume.',
            resume: 'Resume',
            resuming: 'Resuming…',
            resumeFailed: 'Couldn\'t resume the project.',
            tryAsking: 'Try asking',
            suggestCopied: 'Copied. Paste it in the message box below.',
            reviewChanges: 'Review changes',
            reviewLatest: 'Review the latest changes',
            diffGone: 'DSH no longer has this diff. It keeps diffs until it restarts.',
            retryThread: 'Retry',
            resumeThread: 'Resume',
            retrying: 'Retrying…',
            resumingThread: 'Resuming…',
            continueFailed: 'Couldn\'t reach the thread.',
        };
        /** A new project's first asks, shown under the coordinator's greeting until the user writes. */
        const SUGGESTIONS = [
            'Look around this folder and suggest what to work on first',
            'Plan the work and start a thread for each part',
            'Start a thread that reviews the code for bugs',
        ];
        const GROUPS = [
            { id: 'waiting', label: 'Waiting on you' },
            { id: 'running', label: 'Running' },
            { id: 'done', label: 'Done' },
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
         * What a session's next request runs on, from DSH's own
         * `modelSelection` projection (the one its composer picker shows), or
         * undefined before DSH has sent it.
         */
        function selectionIn(state, sessionId) {
            if (typeof sessionId !== 'string' || sessionId === '' || !state) return undefined;
            const value = state.projectionsBySession?.[sessionId]?.values?.modelSelection ?? state.byId?.[sessionId]?.projectionValues?.modelSelection;
            const picked = isObject(value) ? value.next ?? value.lastUsed : undefined;
            return isObject(picked) && typeof picked.provider === 'string' && typeof picked.model === 'string' ? picked : undefined;
        }
        const sameSelection = (a, b) => a === b || (a != null && b != null
            && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort);
        const sameSelections = (a, b) => {
            const keys = Object.keys(a);
            return keys.length === Object.keys(b).length && keys.every((key) => sameSelection(a[key], b[key]));
        };

        /** The selections of some sessions, by session id; the same object until one of them changes. */
        function useSelections(useSessions, sessionIds) {
            const key = sessionIds.join('\n');
            // The ids are read through `key`, so a new array of the same ids keeps the selector.
            const select = React.useCallback((state) => {
                const out = {};
                for (const id of sessionIds) {
                    const picked = selectionIn(state, id);
                    if (picked) out[id] = picked;
                }
                return out;
            }, [key]);
            return useSessions(select, sameSelections);
        }

        /** A selection named as DSH's model menu names it: "DeepSeek V4 · High", or just the model when it has no effort levels. */
        function selectionText(cv, picked) {
            if (!isObject(picked)) return undefined;
            const model = findModel(cv.models, `${picked.provider}:${picked.model}`);
            const name = model ? model.name : picked.model;
            if (model && model.efforts.length === 0) return name;
            const effort = typeof picked.reasoningEffort === 'string' ? picked.reasoningEffort : model?.defaultEffort;
            if (effort === undefined) return model ? `${name} · Default` : name;
            return `${name} · ${model ? effortName(model, effort) : anyEffortName(cv, effort)}`;
        }

        /** Whether a resolved setting's model takes an effort (an unknown model might). */
        const levelsOf = (route) => !route.model || route.efforts.length > 0;

        /** A resolved setting (resolveRoute) as one label. */
        const routeLabel = (route) => (route.effortName ? `${route.name} · ${route.effortName}` : route.name);

        /** DSH's model catalog for naming models; loads it once while `active`. */
        function useCatalogView(catalog, active = true) {
            const snapshot = React.useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
            React.useEffect(() => { if (active) catalog.ensure(); }, [catalog, active, snapshot.status]);
            return React.useMemo(() => catalogView(snapshot.value), [snapshot.value]);
        }

        /**
         * What the plugin says about projects (remote.js), shared by every
         * view in the window: `describe` for one project's settings and
         * pause, `list` for every project's pause (the session list marks a
         * paused coordinator). A view watches what it shows; while any does
         * and the window is visible, it is read again every 15 s, and a
         * change made in this window shows everywhere at once.
         * @param link - the plugin's endpoints (hostLink).
         */
        function projectFacts(link) {
            const described = new Map();
            const projectOf = new Map();
            const pausedAt = new Map();
            const last = new Map();
            const reading = new Map();
            const watching = new Map();
            const listeners = new Set();
            let version = 0;
            let timer;
            /** The last list answer (null until one came), and whether the last read failed. */
            let listed = null;
            let listFailed = false;
            const emit = () => {
                version += 1;
                for (const listener of [...listeners]) listener();
            };
            const once = (key, maxAge, run) => {
                if (reading.has(key)) return reading.get(key);
                if (Date.now() - (last.get(key) ?? 0) < maxAge) return Promise.resolve();
                const promise = run().catch(() => {}).finally(() => {
                    last.set(key, Date.now());
                    reading.delete(key);
                });
                reading.set(key, promise);
                return promise;
            };
            const put = (target, value) => {
                if (!isObject(value) || !isObject(value.project) || typeof value.project.id !== 'string' || !isObject(value.settings)) return;
                const id = value.project.id;
                if (typeof target === 'string') projectOf.set(target, id);
                if (typeof value.project.coordinator === 'string') {
                    projectOf.set(value.project.coordinator, id);
                    pausedAt.set(value.project.coordinator, value.paused?.value === true);
                }
                for (const t of Array.isArray(value.threads) ? value.threads : []) {
                    if (typeof t?.session === 'string') projectOf.set(t.session, id);
                }
                described.set(id, value);
                emit();
            };
            const describe = (target, maxAge = 0) => {
                if (typeof target !== 'string' || target === '') return Promise.resolve();
                return once(`d:${target}`, maxAge, async () => {
                    const result = await link.call('describe', { target });
                    if (result.ok) put(target, result.value);
                });
            };
            const list = (maxAge = 0) => once('list', maxAge, async () => {
                const result = await link.call('list', {});
                if (!result.ok || !Array.isArray(result.value?.projects)) {
                    if (!listFailed) { listFailed = true; emit(); }
                    return;
                }
                listFailed = false;
                listed = result.value.projects.filter((p) => isObject(p) && typeof p.id === 'string');
                for (const p of result.value.projects) {
                    if (!isObject(p) || typeof p.coordinator !== 'string') continue;
                    pausedAt.set(p.coordinator, p.paused === true);
                    if (typeof p.id !== 'string') continue;
                    projectOf.set(p.coordinator, p.id);
                    const d = described.get(p.id);
                    if (d && (d.paused?.value === true) !== (p.paused === true)) described.set(p.id, { ...d, paused: { ...d.paused, value: p.paused === true } });
                }
                emit();
            });
            const read = (key, maxAge) => (key === 'list' ? list(maxAge) : describe(key.slice(2), maxAge));
            const tick = () => {
                if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                for (const key of watching.keys()) void read(key, 10000);
            };
            return {
                subscribe(listener) {
                    listeners.add(listener);
                    return () => { listeners.delete(listener); };
                },
                getSnapshot: () => version,
                /** describe's answer for the project a session (or project id) belongs to, or null. */
                info(target) {
                    const id = projectOf.get(target) ?? (described.has(target) ? target : undefined);
                    return id === undefined ? null : described.get(id) ?? null;
                },
                /** Every project as `list` last answered (null until it has), and whether the last read failed. */
                projects: () => listed,
                listFailed: () => listFailed,
                /** Whether a coordinator's project is paused, as last read; undefined until read. */
                paused(coordinator) {
                    const d = this.info(coordinator);
                    return d ? d.paused?.value === true : pausedAt.get(coordinator);
                },
                put,
                describe,
                list,
                /**
                 * Keep reading `d:<session>` (its project) or `list` while
                 * the returned function has not been called.
                 */
                watch(key) {
                    if (typeof key !== 'string' || key === '' || key === 'd:') return () => {};
                    watching.set(key, (watching.get(key) ?? 0) + 1);
                    void read(key, 5000);
                    timer ??= setInterval(tick, 15000);
                    return () => {
                        const n = (watching.get(key) ?? 1) - 1;
                        if (n > 0) watching.set(key, n);
                        else watching.delete(key);
                        if (watching.size === 0 && timer !== undefined) {
                            clearInterval(timer);
                            timer = undefined;
                        }
                    };
                },
                /** Change a project's settings (remote.js `update`); its answer updates every view. */
                async change(target, changes) {
                    const result = await link.call('update', { target, changes });
                    if (result.ok) put(target, result.value);
                    return result;
                },
                /** Run a thread again after its last turn failed or stopped (remote.js `continueThread`). */
                async continueThread(target, thread) {
                    const result = await link.call('continueThread', { target, thread });
                    if (result.ok) put(target, result.value);
                    return result;
                },
            };
        }

        /** Re-render when anything the plugin says about projects changes. */
        const useFacts = (facts) => React.useSyncExternalStore(facts.subscribe, facts.getSnapshot);
        /** Watch a facts key (`d:<session>` or `list`) while `on`. */
        function useWatch(facts, key, on = true) {
            React.useEffect(() => (on && key ? facts.watch(key) : undefined), [facts, key, on]);
        }

        /**
         * A project as the plugin describes it (remote.js `describe`): read
         * when `enabled` turns on, and again every 15 s while `active`.
         */
        function useProjectInfo(facts, target, enabled, active) {
            useFacts(facts);
            React.useEffect(() => { if (enabled) void facts.describe(target, 5000); }, [facts, target, enabled]);
            useWatch(facts, typeof target === 'string' ? `d:${target}` : null, enabled && active);
            return enabled ? facts.info(target) : null;
        }

        /**
         * Whether a coordinator's project is paused (undefined until known),
         * kept current by watching `watch` (`d:<coordinator>` or `list`).
         */
        function usePaused(facts, coordinator, watch) {
            useWatch(facts, watch, typeof coordinator === 'string');
            return React.useSyncExternalStore(facts.subscribe, () => (typeof coordinator === 'string' ? facts.paused(coordinator) : undefined));
        }

        /** How many messages a pause holds for a coordinator, as last read. */
        const useHeld = (facts, coordinator) => React.useSyncExternalStore(facts.subscribe, () => facts.info(coordinator)?.paused?.held ?? 0);
        /** The handbacks a pause holds ([{thread, status}]), as last read. */
        const useHeldHandbacks = (facts, coordinator) => React.useSyncExternalStore(facts.subscribe, () => facts.info(coordinator)?.paused?.handbacks ?? EMPTY);

        /**
         * A thread whose handback a pause holds says so, instead of "No
         * handback yet", and sits where that handback puts it (Done, or
         * Waiting on you for a decision).
         */
        function withHeld(rows, handbacks) {
            if (!Array.isArray(handbacks) || handbacks.length === 0) return rows;
            const held = new Map();
            for (const hb of handbacks) if (isObject(hb) && typeof hb.thread === 'string') held.set(hb.thread, hb.status);
            return rows.map((row) => {
                if (!held.has(row.id) || row.running || row.pending || row.group === 'running' || row.group === 'resolved') return row;
                const status = held.get(row.id);
                const state = rowState({ resolved: false, running: false, pending: undefined, hb: { status }, ending: undefined });
                const label = HANDBACK_LABELS[status] ?? 'Handback';
                return { ...row, group: state.group, dot: state.dot, stateLabel: state.label, ending: undefined, line: `${label} · ${TEXT.heldLine}`, held: true };
            });
        }

        /** Resume a paused project; `failed` says the last try didn't go through. */
        function useResume(facts, target) {
            const [state, setState] = React.useState('idle');
            const alive = React.useRef(true);
            React.useEffect(() => () => { alive.current = false; }, []);
            const resume = React.useCallback(async () => {
                setState('busy');
                const result = await facts.change(target, { paused: false });
                if (alive.current) setState(result.ok ? 'idle' : 'failed');
            }, [facts, target]);
            return { busy: state === 'busy', failed: state === 'failed', resume };
        }

        /** What a pause means where it is shown, with how many messages it holds for the coordinator. */
        function pausedText(role, held, handbacks = 0) {
            if (role === 'thread') return TEXT.pausedThread;
            if (!(held > 0)) return TEXT.pausedCoordinator;
            // The count comes first, so a narrow bar cuts the explanation rather than the count.
            return `${held === handbacks ? plural(held, 'handback') : plural(held, 'message')} held until you resume. ${TEXT.pausedNewThreads}`;
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

        /** A handback's state and summary, without saying the state twice ("Blocked · Blocked: …"). */
        function toldText(hb) {
            const label = HANDBACK_LABELS[hb.status] ?? String(hb.status ?? '');
            const summary = typeof hb.summary === 'string' ? hb.summary.trim() : '';
            if (summary === '') return label;
            const rest = summary.slice(label.length);
            if (label !== '' && summary.slice(0, label.length).toLowerCase() === label.toLowerCase() && (rest === '' || /^[\s:.,;—–-]/.test(rest))) return summary;
            return `${label} · ${summary}`;
        }

        /** A thread's last turn when it failed or stopped (its own projection value's `ending`), or undefined. */
        function endingOf(value) {
            const ending = value?.ending;
            return isObject(ending) && (ending.state === 'failed' || ending.state === 'stopped') ? ending : undefined;
        }
        const endingIn = (state, sessionId) => endingOf(valueIn(state, sessionId));
        const sameEndings = (a, b) => {
            const keys = Object.keys(a);
            return keys.length === Object.keys(b).length && keys.every((key) => a[key]?.seq === b[key]?.seq && a[key]?.state === b[key]?.state);
        };

        /** The failed or stopped last turns of some sessions, by session id; the same object until one of them changes. */
        function useEndings(useSessions, sessionIds) {
            const key = sessionIds.join('\n');
            // The ids are read through `key`, so a new array of the same ids keeps the selector.
            const select = React.useCallback((state) => {
                const out = {};
                for (const id of sessionIds) {
                    const ending = endingIn(state, id);
                    if (ending) out[id] = ending;
                }
                return out;
            }, [key]);
            return useSessions(select, sameEndings);
        }

        /** Why a thread's last turn didn't finish, as a sentence ('' when it was simply stopped). */
        function endingReason(ending) {
            switch (ending?.kind) {
                case 'error': return typeof ending.message === 'string' && ending.message !== '' ? ending.message : 'DSH couldn\'t finish the turn.';
                case 'blocked': return 'A DSH plugin blocked the turn.';
                case 'signed-out': return 'You signed out of DeepSeek.';
                case 'interrupted': return 'DSH closed while it ran.';
                case 'max-tokens': return 'It reached the output token limit.';
                default:
                    if (ending?.cause === 'hook') return ending.hook ? `A DSH plugin stopped it (${ending.hook}).` : 'A DSH plugin stopped it.';
                    if (ending?.cause === 'disposed') return 'Its session closed while it ran.';
                    return '';
            }
        }

        /** A failed or stopped last turn as one line: "Failed · <why>", "Stopped before it finished", "Stopped · <why>". */
        function endingLine(ending) {
            const why = endingReason(ending);
            if (ending.state === 'failed') return `Failed · ${why}`;
            return why ? `Stopped · ${why}` : 'Stopped before it finished';
        }

        /**
         * A thread's state in the one vocabulary every view uses: its group
         * in the Threads menu, its dot, its label. A failed or stopped last
         * turn counts when it came after the last handback.
         */
        function rowState({ resolved, running, pending, hb, ending }) {
            const later = ending !== undefined && !(Date.parse(hb?.at ?? '') > Date.parse(ending.at ?? ''));
            const ended = !resolved && !running && !pending && later ? ending : undefined;
            const failed = ended?.state === 'failed';
            const asks = !ended && (hb?.status === 'needs_decision' || hb?.status === 'blocked');
            const done = !ended && hb?.status === 'done';
            const group = resolved ? 'resolved' : pending || (!running && (asks || failed)) ? 'waiting' : running ? 'running' : done ? 'done' : 'idle';
            const dot = resolved ? 'done' : pending ? 'warning' : running ? 'ongoing' : failed ? 'error' : asks ? 'warning' : done ? 'done' : 'idle';
            const label = resolved ? 'Resolved' : pending ? 'Needs you' : running ? 'Running' : failed ? 'Failed' : ended ? 'Stopped'
                : hb?.status === 'blocked' ? 'Blocked' : asks ? 'Needs a decision' : done ? 'Done' : 'Idle';
            return { group, dot, label, ending: ended };
        }

        /** One roster entry with its live state, as the menu, the pane and the cards show it. */
        function threadRow(entry, statuses, byId, endings) {
            const session = typeof entry.session === 'string' && entry.session !== '' ? entry.session : undefined;
            const status = session ? statuses?.get?.(session) : undefined;
            const summary = session ? byId?.[session] : undefined;
            const running = (status?.running ?? summary?.running) === true;
            const pending = status?.pendingInteraction ?? undefined;
            const hb = isObject(entry.handback) ? entry.handback : undefined;
            const state = rowState({ resolved: entry.resolved === true, running, pending, hb, ending: session ? endings?.[session] : undefined });
            const told = hb ? toldText(hb) : undefined;
            const line = pending ? pendingLine(pending)
                : running ? (hb?.status === 'progress' && hb.summary ? `Working… · ${hb.summary}` : 'Working…')
                    : state.ending ? endingLine(state.ending)
                        : told ?? (entry.resolved ? 'Resolved' : 'No handback yet');
            const at = Number.isFinite(summary?.updatedAt) ? summary.updatedAt : Date.parse(hb?.at ?? entry.created ?? '');
            return {
                entry, id: entry.id, title: entry.title || entry.id, session, group: state.group, dot: state.dot, line, stateLabel: state.label,
                running, pending: pending !== undefined, ending: state.ending, at: Number.isFinite(at) ? at : undefined,
            };
        }

        /** The sessions of a roster's open threads, whose own projections say how their last turn ended. */
        function openSessions(roster) {
            const out = [];
            for (const entry of Array.isArray(roster) ? roster : EMPTY) {
                if (isObject(entry) && entry.resolved !== true && typeof entry.session === 'string' && entry.session !== '') out.push(entry.session);
            }
            return out;
        }

        function rowsOf(roster, statuses, byId, endings) {
            const rows = (roster ?? EMPTY).filter((entry) => isObject(entry) && typeof entry.id === 'string').map((entry) => threadRow(entry, statuses, byId, endings));
            // Newest activity first within a group; then the newest thread.
            return rows.sort((a, b) => (b.at ?? 0) - (a.at ?? 0) || threadNumber(b.id) - threadNumber(a.id));
        }

        /** The sessions of some rows (threads without a session yet are left out). */
        const rowSessions = (rows) => rows.map((row) => row.session).filter((id) => id !== undefined);

        function countsOf(rows) {
            const count = (group) => rows.filter((row) => row.group === group).length;
            return {
                open: rows.length - count('resolved'), running: count('running'), waiting: count('waiting'), resolved: count('resolved'),
                failed: rows.filter((row) => row.dot === 'error').length,
            };
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

        /** A refusal from the plugin as a sentence, or that the thread couldn't be reached. */
        function continueError(error) {
            const message = String(error?.message ?? '').trim();
            if (error?.code === 'projects/refused' && message) return `${message.replace(/^./, (c) => c.toUpperCase())}${/[.!?]$/.test(message) ? '' : '.'}`;
            return TEXT.continueFailed;
        }

        /**
         * Retry a thread whose last turn failed, or resume one that stopped:
         * the plugin sends it on with a message from its coordinator. Busy
         * until the thread runs again (its row then stops offering it), with
         * the plugin's refusal when it says no.
         */
        function useContinue(projects, row) {
            const [state, setState] = React.useState({ busy: false, error: '' });
            const alive = React.useRef(true);
            React.useEffect(() => () => { alive.current = false; }, []);
            React.useEffect(() => {
                if (!state.busy) return undefined;
                // A thread that doesn't start (DSH refused the message) is offered again.
                const timer = setTimeout(() => { if (alive.current) setState({ busy: false, error: '' }); }, 15000);
                return () => clearTimeout(timer);
            }, [state.busy]);
            const session = row?.session;
            const thread = row?.id;
            const run = React.useCallback(async () => {
                if (typeof session !== 'string' || typeof thread !== 'string') return;
                setState({ busy: true, error: '' });
                const result = await projects.facts.continueThread(session, thread);
                if (alive.current && !result.ok) setState({ busy: false, error: continueError(result.error) });
            }, [projects, session, thread]);
            return { ...state, run, retry: row?.ending?.state === 'failed' };
        }

        /** Retry or Resume as an icon button on a Threads menu or pane row. */
        function RowContinue({ row, projects }) {
            const { busy, error, run, retry } = useContinue(projects, row);
            const label = retry ? TEXT.retryThread : TEXT.resumeThread;
            return h(ui.Tooltip, { label: error || label, side: 'bottom', align: 'end', portal: true },
                h('button', {
                    type: 'button', className: error ? 'dshp-t-icon dshp-t-error' : 'dshp-t-icon', disabled: busy, 'aria-busy': busy || undefined,
                    'aria-label': `${label}: ${row.title}${error ? `. ${error}` : ''}`, 'data-projects-continue': retry ? 'retry' : 'resume',
                    onClick: (event) => { event.preventDefault(); event.stopPropagation(); void run(); },
                    onKeyDown: (event) => event.stopPropagation(),
                }, busy ? h(ui.StateDot, { state: 'ongoing' }) : h(retry ? ui.IconRefreshOutlineRegular : ui.IconPlayOutlineRegular, { size: 14 })));
        }

        /**
         * One thread: its name on the first line; its state and summary on
         * the second, with its code changes, its model and the time. A model
         * equal to `quietModel` (what new threads start on, which the menu
         * names once at its top) is left off the line and named in a tooltip
         * when the row is hovered or focused, so the summary keeps its room.
         */
        function ThreadRow({ row, current, now, model, quietModel, changes, onOpen, action, projects }) {
            const enabled = !current && row.session !== undefined;
            const quiet = model !== undefined && model === quietModel;
            const open = () => { if (enabled) onOpen(row); };
            const acts = [
                row.ending && row.session !== undefined && projects ? h(RowContinue, { key: 'continue', row, projects }) : null,
                action && enabled ? h(ui.Tooltip, { key: 'action', label: action.label, side: 'bottom', align: 'end', portal: true },
                    h('button', {
                        type: 'button', className: 'dshp-t-icon', 'aria-label': `${action.label}: ${row.title}`,
                        onClick: (event) => { event.preventDefault(); event.stopPropagation(); action.run(row); },
                        onKeyDown: (event) => event.stopPropagation(),
                    }, h(action.icon, { size: 14 }))) : null,
            ].filter(Boolean);
            const body = h('div', {
                className: 'dshp-t-row', role: 'button', tabIndex: enabled ? 0 : -1,
                'data-dshp-item': '', 'data-thread': row.id, 'data-changes': changes ? '' : undefined,
                'aria-current': current ? 'true' : undefined,
                'aria-disabled': enabled ? undefined : 'true',
                'aria-label': `${row.title}. ${current ? `${TEXT.current}. ` : ''}${row.line}${changes ? `. ${changesText(changes)}` : ''}${model ? `. Runs on ${model}` : ''}`,
                'data-projects-runs-on': model || undefined,
                onClick: open,
                onKeyDown: (event) => {
                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    open();
                },
            },
            h('span', { className: 'dshp-t-dot', 'data-state': row.dot }, h(ui.StateDot, { state: row.dot })),
            h('span', { className: 'dshp-t-text' },
                h('span', { className: 'dshp-t-name' }, row.title),
                h('span', { className: 'dshp-t-second' },
                    h('span', { className: 'dshp-t-line' }, current ? `${TEXT.current} · ${row.line}` : row.line),
                    h('span', { className: 'dshp-t-meta' },
                        changes ? h('span', { className: 'dshp-t-row-changes', 'data-projects-changes': '' }, ...changeCounts(changes)) : null,
                        model && !quiet ? h('span', { className: 'dshp-t-model', title: model, 'data-projects-thread-model': '' }, model) : null,
                        row.at !== undefined ? h('span', { className: 'dshp-t-ago' }, ago(row.at, now)) : null))),
            acts.length > 0 ? h('span', { className: 'dshp-t-row-acts' }, ...acts) : null);
            return quiet ? h(ui.Tooltip, { label: `Runs on ${model}`, side: 'right', delayMs: 500, focusDelayMs: 300, portal: true }, body) : body;
        }

        /** The groups a thread list folds behind a count until clicked. */
        const FOLDED = Object.freeze(['resolved']);

        /**
         * Rows grouped as Waiting on you, Running, Done, Idle and Resolved.
         * A group in `fold` shows as "Resolved · 3" and opens on a click; it
         * starts open when it holds the current chat's row.
         */
        function ThreadList({ rows, current, now, models, quietModel, changes, onOpen, action, projects, fold = FOLDED }) {
            const [shown, setShown] = React.useState(() => new Set(rows.filter((row) => row.session !== undefined && row.session === current).map((row) => row.group)));
            const toggle = (id) => setShown((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
            });
            return GROUPS.map((group) => {
                const members = rows.filter((row) => row.group === group.id);
                if (members.length === 0) return null;
                const list = members.map((row) => h(ThreadRow, {
                    key: row.id, row, current: row.session !== undefined && row.session === current, now, onOpen, action, projects, quietModel,
                    model: row.session !== undefined ? models?.[row.session] : undefined,
                    changes: changes?.[row.id],
                }));
                if (!fold.includes(group.id)) {
                    return h('div', { key: group.id, role: 'group', 'aria-label': group.label, 'data-thread-group': group.id },
                        h('div', { className: 'dshp-t-group' }, group.label), ...list);
                }
                const open = shown.has(group.id);
                return h('div', { key: group.id, role: 'group', 'aria-label': group.label, 'data-thread-group': group.id },
                    h('button', {
                        type: 'button', className: 'dshp-t-group', 'data-dshp-item': '', 'aria-expanded': open,
                        onClick: () => toggle(group.id),
                    }, h(ui.IconChevronRightOutlineRegular, { size: 12 }), `${group.label} · ${members.length}`),
                    ...(open ? list : []));
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

        /**
         * What the project runs on, at the top of the Threads menu and pane:
         * the coordinator's model and effort and what new threads start on.
         * Each opens Project settings with that model menu open.
         */
        function ModelsSummary({ coordinator, thread, onPick }) {
            const item = (id, label, text) => {
                const shown = text ?? '…';
                const content = [
                    h('span', { key: 'l', className: 'dshp-t-models-label' }, label),
                    h('span', { key: 'v', className: 'dshp-t-models-value', title: text }, shown),
                ];
                if (!onPick) return h('div', { key: id, className: 'dshp-t-models-row', 'data-projects-models': id }, ...content);
                return h('button', {
                    key: id, type: 'button', className: 'dshp-t-models-row', 'data-dshp-item': '', 'data-projects-models': id,
                    'aria-label': `${label}: ${text ?? 'loading'}. Change it in ${SETTINGS.title}`,
                    onClick: () => onPick(id),
                }, ...content, h(ui.IconChevronRightOutlineRegular, { key: 'c', size: 12 }));
            };
            return h('div', { className: 'dshp-t-models', role: 'group', 'aria-label': 'Models' },
                item('coordinator', TEXT.coordinator, coordinator),
                item('thread', 'New threads', thread));
        }

        /**
         * The labels ModelsSummary shows: what the coordinator runs on now
         * (its own model selection), else its setting, and the setting new
         * threads start on.
         */
        function summaryModels(cv, models, coordinator, info) {
            const s = info?.settings;
            const route = (model, effort) => (s ? routeLabel(resolveRoute(cv, s[model]?.value ?? undefined, s[effort]?.value ?? undefined)) : undefined);
            return {
                coordinator: (coordinator ? models[coordinator] : undefined) ?? route('coordinatorModel', 'coordinatorEffort'),
                thread: route('threadModel', 'threadEffort'),
            };
        }

        /**
         * A roster's rows with their live state, each open thread's own
         * ending included. Thread sessions this window hasn't loaded are read
         * once, so a thread that failed or stopped says so from the start.
         * @param held - the handbacks a pause holds ([{thread, status}]).
         */
        function useRows(projects, useSessions, roster, statuses, byId, held) {
            const sessions = React.useMemo(() => openSessions(roster), [roster]);
            const endings = useEndings(useSessions, sessions);
            const key = sessions.join('\n');
            React.useEffect(() => {
                for (const id of sessions) projects.refresh(id);
            }, [key, projects]);
            return React.useMemo(() => withHeld(rowsOf(roster, statuses, byId, endings), held), [roster, statuses, byId, endings, held]);
        }

        /** The model labels of a roster's sessions and its coordinator, read live from DSH. */
        function useRosterModels(projects, useSessions, rows, coordinator, active) {
            const ids = React.useMemo(() => {
                const out = rows.map((row) => row.session).filter((id) => id !== undefined);
                if (coordinator) out.push(coordinator);
                return out;
            }, [rows, coordinator]);
            const selections = useSelections(useSessions, ids);
            const cv = useCatalogView(projects.catalog, active);
            const key = ids.join('\n');
            // Sessions DSH hasn't loaded in this window send their selection once their projections are read.
            React.useEffect(() => {
                if (active) for (const id of ids) projects.refresh(id);
            }, [active, key, projects]);
            const models = React.useMemo(() => {
                const out = {};
                for (const [id, picked] of Object.entries(selections)) out[id] = selectionText(cv, picked);
                return out;
            }, [selections, cv]);
            return { cv, models };
        }

        const GROUPED = new Intl.NumberFormat('en-US');
        const ALWAYS = Object.freeze({ getSnapshot: () => true, subscribe: () => () => {} });

        /** A thread's changes as the plugin describes them (lines added and deleted, files, the newest turn to review), or undefined. */
        function changesOf(value) {
            return isObject(value) && Number.isSafeInteger(value.added) && Number.isSafeInteger(value.deleted)
                && Number.isSafeInteger(value.files) && value.files > 0 ? value : undefined;
        }

        /** "2 files changed: 18 lines added, 3 deleted", for screen readers. */
        const changesText = (changes) => `${plural(changes.files, 'file')} changed: ${plural(changes.added, 'line')} added, ${changes.deleted} deleted`;

        /** "+18 -3 · 2 files", in DSH's colors for added and deleted lines. */
        function changeCounts(changes) {
            return [
                h('span', { key: 'c', className: 'dshp-t-counts' },
                    h('span', { className: 'dshp-t-added' }, `+${GROUPED.format(changes.added)}`),
                    h('span', { className: 'dshp-t-deleted' }, `-${GROUPED.format(changes.deleted)}`)),
                h('span', { key: 'f', className: 'dshp-t-files' }, `· ${plural(changes.files, 'file')}`),
            ];
        }

        /** Whether DSH shows code changes in chats (its developer tools setting, as its own "Edited N files" card does); on where DSH doesn't say. */
        function useCodeChanges(projects) {
            const store = projects.codeChanges?.() ?? ALWAYS;
            const subscribe = React.useCallback((listener) => store.subscribe(listener), [store]);
            const get = React.useCallback(() => store.getSnapshot(), [store]);
            return React.useSyncExternalStore(subscribe, get) !== false;
        }

        /** The newest turn in which a thread changed files, from its own projection ('' when none). */
        function lastChange(value) {
            const list = Array.isArray(value?.changes) ? value.changes : EMPTY;
            return list.length > 0 && Number.isSafeInteger(list[list.length - 1]?.seq) ? String(list[list.length - 1].seq) : '';
        }

        /**
         * Each thread's code changes, by thread id, as the plugin keeps them
         * from DSH's per-turn summaries (describe's `threads[].changes`). A
         * thread's own projection marks each turn that changes files, and the
         * project is read again then, so a card updates as the turn ends.
         * @param {string[]} sessions - the shown threads' sessions.
         */
        function useThreadChanges(projects, useSessions, coordinator, sessions, active) {
            const key = sessions.join('\n');
            // The ids are read through `key`, so a new array of the same ids keeps the selector.
            const select = React.useCallback((state) => sessions.map((id) => lastChange(valueIn(state, id))).join(','), [key]);
            const marks = useSessions(select);
            const shown = useCodeChanges(projects);
            const facts = projects.facts;
            const on = active && shown && typeof coordinator === 'string' && coordinator !== '' && sessions.length > 0;
            const seen = React.useRef(marks);
            React.useEffect(() => {
                if (!on) return undefined;
                const fresh = seen.current !== marks;
                seen.current = marks;
                void facts.describe(coordinator, fresh ? 0 : 5000);
                if (!fresh) return undefined;
                // The plugin keeps a summary a moment after DSH announces it; read once more to be sure.
                const timer = setTimeout(() => { void facts.describe(coordinator, 0); }, 1500);
                return () => clearTimeout(timer);
            }, [on, coordinator, marks, facts]);
            const threads = React.useSyncExternalStore(facts.subscribe, () => (on ? facts.info(coordinator)?.threads : undefined));
            return React.useMemo(() => {
                const out = {};
                for (const t of Array.isArray(threads) ? threads : EMPTY) {
                    const changes = isObject(t) && typeof t.id === 'string' ? changesOf(t.changes) : undefined;
                    if (changes) out[t.id] = changes;
                }
                return out;
            }, [threads]);
        }

        /**
         * A thread's changes on its card: "+18 -3 · 2 files", opening DSH's
         * Review tab on the newest turn that changed files while DSH still
         * has its diff.
         */
        function CardChanges({ changes, onReview }) {
            const counts = changeCounts(changes);
            if (!changes.reviewable || !onReview) {
                return h('span', { className: 'dshp-t-changes', title: `${changesText(changes)}. ${TEXT.diffGone}`, 'data-projects-changes': 'gone' }, ...counts);
            }
            const label = changes.turns > 1 ? TEXT.reviewLatest : TEXT.reviewChanges;
            // DSH's own code-file tile, the mark on its "Edited N files" card.
            const icon = ui.FileTypeIcon ? h('span', { className: 'dshp-t-changes-icon', 'aria-hidden': true }, h(ui.FileTypeIcon, { kind: 'code', size: 16 })) : null;
            return h(ui.Tooltip, { label, side: 'top', align: 'end' },
                h('button', {
                    type: 'button', className: 'dshp-t-changes', 'aria-label': `${label}. ${changesText(changes)}`,
                    'data-projects-changes': '', onClick: onReview,
                }, icon, ...counts));
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
            const settingsOn = useSettingsAvailable(projects.settings);
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
            const paused = usePaused(projects.facts, coordinator, coordinator ? `d:${coordinator}` : null) === true;
            const handbacks = useHeldHandbacks(projects.facts, coordinator);
            const rows = useRows(projects, useSessions, info?.roster, statuses, byId, paused ? handbacks : EMPTY);
            const { cv, models } = useRosterModels(projects, useSessions, rows, coordinator, open);
            const changes = useThreadChanges(projects, useSessions, coordinator, rowSessions(rows), open);
            const described = useProjectInfo(projects.facts, sessionId, info !== undefined, open);
            if (info === undefined) return null;

            const counts = countsOf(rows);
            const signal = counts.failed > 0 ? 'error' : counts.waiting > 0 ? 'warning' : counts.running > 0 ? 'ongoing' : null;
            const threadsLabel = counts.open > 0 ? plural(counts.open, 'thread') : TEXT.threads;
            const label = paused ? `${TEXT.paused} · ${threadsLabel}` : threadsLabel;
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
                'aria-label': `${TEXT.threads}: ${paused ? `${TEXT.projectPaused}, ` : ''}${info.roster === null ? TEXT.loading : summaryText(counts)}`,
                'data-projects-threads-trigger': '', 'data-projects-paused': paused ? '' : undefined,
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
            signal ? h('span', { className: 'dshp-t-signal' }, h(ui.StateDot, { state: signal }))
                : paused ? h(ui.IconPauseOutlineRegular, { size: 14 }) : h(ui.IconBranchOutlineRegular, { size: 14 }),
            h('span', { className: 'dshp-t-label' }, label),
            h(ui.IconChevronDownOutlineRegular, { size: 12, className: open ? 'dshp-t-chev dshp-t-chev-open' : 'dshp-t-chev' }));

            const notice = rosterNotice(info, rows, projects);
            const summary = summaryModels(cv, models, coordinator, described);
            const openSettings = (pick) => { change(false); projects.settings.open(sessionId, typeof pick === 'string' ? { pick } : undefined); };
            const foot = [
                projects.hasPane() ? h('button', { key: 'pane', type: 'button', className: 'dshp-t-foot-btn', 'data-dshp-item': '', onClick: () => { change(false); projects.openPane(); } },
                    h(ui.IconFlatListOutlineRegular, { size: 14 }), TEXT.openPane) : null,
                settingsOn ? h('button', { key: 'settings', type: 'button', className: 'dshp-t-foot-btn', 'data-dshp-item': '', onClick: openSettings },
                    h(ui.IconSlidersTwoOutlineRegular, { size: 14 }), SETTINGS.title) : null,
            ].filter(Boolean);
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
            h(ModelsSummary, { ...summary, onPick: settingsOn ? openSettings : undefined }),
            paused ? h(PausedNotice, { coordinator, role: info.me.role, projects }) : null,
            h('div', { className: 'dshp-t-menu-body' },
                notice ?? h(ThreadList, {
                    rows, current: sessionId, now, models, changes, projects,
                    // The menu names what new threads start on at its top; a row names its model only when it differs.
                    quietModel: summary.thread,
                    onOpen: (row) => openSession(row.session),
                    action: { label: TEXT.openBeside, icon: ui.IconCompareSplitOutlineRegular, run: (row) => { change(false); projects.openBeside(row.session); } },
                })),
            foot.length > 0 ? h('div', { className: 'dshp-t-menu-foot' }, ...foot) : null), document.body) : null;
            const gear = settingsOn ? h(ui.Tooltip, { label: SETTINGS.title, side: 'bottom' },
                h('button', {
                    type: 'button', className: 'dshp-t-trigger dshp-t-gear', 'aria-label': SETTINGS.title, 'data-projects-settings-trigger': '',
                    onClick: openSettings,
                }, h(ui.IconSlidersTwoOutlineRegular, { size: 14 }))) : null;

            return h('div', { ref: rootRef, className: 'dshp-t-hdr', 'data-projects-threads': info.me.role, onMouseLeave: scheduleClose },
                parent, trigger, gear, menu);
        }

        /**
         * The Threads pane in the right sidebar: the project's threads by state.
         * A row opens the thread's chat as a tab here; its button makes it the
         * main chat.
         */
        function ThreadsPane({ sessionId, useSessions, useSessionStatus, useTabInfo, projects }) {
            const { tab } = useTabInfo();
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const settingsOn = useSettingsAvailable(projects.settings);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            const now = useNow(tab.visible !== false);
            const rootRef = React.useRef(null);
            const coordinator = info?.coordinator;
            React.useEffect(() => {
                if (coordinator !== undefined && coordinator !== sessionId) projects.refresh(coordinator);
            }, [coordinator, sessionId, projects]);
            const visible = tab.visible !== false;
            const paused = usePaused(projects.facts, coordinator, coordinator && visible ? `d:${coordinator}` : null) === true;
            const handbacks = useHeldHandbacks(projects.facts, coordinator);
            const rows = useRows(projects, useSessions, info?.roster, statuses, byId, paused ? handbacks : EMPTY);
            const { cv, models } = useRosterModels(projects, useSessions, rows, coordinator, info !== undefined && visible);
            const changes = useThreadChanges(projects, useSessions, coordinator, rowSessions(rows), info !== undefined && visible);
            const described = useProjectInfo(projects.facts, sessionId, info !== undefined, visible);
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
                info.roster !== null ? h('span', { className: 'dshp-t-count' }, summaryText(countsOf(rows))) : null,
                settingsOn ? h('span', { className: 'dshp-t-pane-gear' }, h(ui.Tooltip, { label: SETTINGS.title, side: 'bottom', align: 'end', portal: true },
                    h('button', {
                        type: 'button', className: 'dshp-t-icon', 'aria-label': SETTINGS.title, 'data-projects-settings-trigger': '',
                        onClick: () => projects.settings.open(sessionId),
                    }, h(ui.IconSlidersTwoOutlineRegular, { size: 14 })))) : null),
            h(ModelsSummary, { ...summaryModels(cv, models, coordinator, described), onPick: settingsOn ? (pick) => projects.settings.open(sessionId, { pick }) : undefined }),
            paused ? h(PausedNotice, { coordinator, role: info.me.role, projects }) : null,
            notice ?? h(ThreadList, {
                rows, current: sessionId, now, models, changes, projects,
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
            const dot = status?.pendingInteraction ? 'warning' : running ? 'ongoing' : endingOf(value)?.state === 'failed' ? 'error' : 'idle';
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
        /** An idle note's card when the thread's turn failed or stopped (the note says so first). */
        const IDLE_VIEWS = {
            failed: { icon: 'IconWarningTriangleOutlineRegular', verb: 'Turn failed', tone: 'error' },
            stopped: { icon: 'IconStopFillRegular', verb: 'Stopped before it finished' },
        };

        /**
         * How one card reads: its icon, its line above the name, and what it
         * opens. `held` lists the handbacks a paused project holds.
         */
        function cardView(card, info, statuses, byId, here, endings, held = EMPTY) {
            const handback = HANDBACK_LABELS[card.status] ?? card.status;
            if (info.me.role === 'thread') {
                // A thread's own turn: only its handback is news, and it points at the coordinator.
                if (card.kind !== 'handback' || !info.coordinator) return null;
                // While the project is paused, the thread's newest handback waits for Resume.
                const waits = held.some((hb) => isObject(hb) && hb.thread === info.me.thread?.id)
                    && !(info.me.cards ?? EMPTY).some((c) => isObject(c) && c.kind === 'handback' && c.seq > card.seq);
                return {
                    key: `handback-${card.seq ?? ''}`, kind: card.kind, icon: waits ? ui.IconPauseOutlineRegular : ui.IconTreeCornerRegular,
                    verb: `${waits ? TEXT.handbackHeld : 'Handed back to the coordinator'}${handback ? ` · ${handback}` : ''}`,
                    note: waits ? TEXT.handbackHeldWhy : undefined,
                    title: `◆ ${info.project.name || TEXT.coordinator}`, session: info.coordinator === here ? undefined : info.coordinator,
                };
            }
            const entry = (info.roster ?? EMPTY).find((t) => isObject(t) && t.id === card.thread);
            // A handback a pause holds counts as the thread's state, as in the Threads menu.
            const row = entry ? withHeld([threadRow(entry, statuses, byId, endings)], held)[0] : undefined;
            const base = {
                key: card.thread ?? `${card.kind}-${card.seq ?? ''}`, kind: card.kind, threadId: card.thread, seq: card.seq,
                title: row?.title ?? card.thread ?? TEXT.thread, session: row?.session, row,
                state: row ? { dot: row.dot, label: row.stateLabel } : undefined,
            };
            switch (card.kind) {
                case 'start': return { ...base, icon: ui.IconBranchOutlineRegular, verb: 'Started a thread' };
                case 'send': return { ...base, icon: ui.IconSendOutlineRegular, verb: card.status === 'steer' ? 'Steered a running thread' : 'Sent a message to a thread' };
                case 'update': return { ...base, icon: ui[UPDATE_ICONS[card.status]] ?? ui.IconEditOutlineRegular, verb: UPDATE_VERBS[card.status] ?? 'Updated a thread' };
                case 'handback': return { ...base, icon: ui.IconTreeCornerRegular, verb: `Handback${handback ? ` · ${handback}` : ''}` };
                case 'idle': {
                    const ended = IDLE_VIEWS[card.status];
                    return { ...base, icon: (ended && ui[ended.icon]) || ui.IconPauseOutlineRegular, verb: ended?.verb ?? 'Went idle without a handback', tone: ended?.tone };
                }
                case 'approval': return { ...base, icon: ui.IconWarningOutlineRegular, verb: 'Is waiting for your approval' };
                default: return null;
            }
        }

        function ThreadCard({ view, projects }) {
            const enabled = view.session !== undefined;
            // The thread's newest card says why its last turn failed or stopped, and offers to run it again.
            const ending = enabled && view.newest ? view.row?.ending : undefined;
            const go = useContinue(projects, ending ? view.row : undefined);
            const why = ending ? go.error || endingReason(ending) : '';
            const goLabel = go.retry ? TEXT.retryThread : TEXT.resumeThread;
            return h('div', { className: 'dshp-t-card', 'data-thread': view.threadId, 'data-card-kind': view.kind, 'data-card-tone': view.tone },
                h('span', { className: 'dshp-t-card-icon', 'aria-hidden': true }, h(view.icon, { size: 16 })),
                h('div', { className: 'dshp-t-card-text' },
                    h('span', { className: 'dshp-t-card-verb', title: view.note ?? (view.model ? `${view.verb} · ${view.model}` : undefined) },
                        view.verb, view.model ? h('span', { className: 'dshp-t-card-model', 'data-projects-thread-model': '' }, ` · ${view.model}`) : null),
                    h('button', {
                        type: 'button', className: 'dshp-t-card-title', disabled: !enabled,
                        title: enabled ? `${TEXT.open}: ${view.title}` : undefined,
                        onClick: () => projects.openSession(view.session),
                    }, view.title),
                    why ? h('span', {
                        className: go.error ? 'dshp-t-card-why dshp-t-error' : 'dshp-t-card-why', title: why,
                        role: go.error ? 'alert' : undefined, 'data-projects-ending': ending.state,
                    }, why) : null),
                view.changes ? h(CardChanges, {
                    changes: view.changes,
                    onReview: enabled && view.changes.last ? () => projects.openReview(view.session, view.changes.last) : undefined,
                }) : null,
                view.state || enabled ? h('div', { className: 'dshp-t-card-side' },
                view.state ? h('span', { className: 'dshp-t-card-state' },
                    h(ui.StateDot, { state: view.state.dot }),
                    h('span', { className: 'dshp-t-card-state-label' }, view.state.label)) : null,
                enabled ? h('div', { className: 'dshp-t-card-actions' },
                    ending ? h(ui.Button, {
                        variant: 'outline', size: 'sm', disabled: go.busy, 'aria-label': `${goLabel}: ${view.title}`,
                        'data-projects-continue': go.retry ? 'retry' : 'resume',
                        icon: h(go.retry ? ui.IconRefreshOutlineRegular : ui.IconPlayOutlineRegular, { size: 14 }),
                        onClick: () => { void go.run(); },
                    }, h('span', { className: 'dshp-t-go-label' }, go.busy ? (go.retry ? TEXT.retrying : TEXT.resumingThread) : goLabel)) : null,
                    h(ui.Tooltip, { label: TEXT.openBeside, side: 'top', align: 'end' },
                        h('button', {
                            type: 'button', className: 'dshp-t-icon', 'aria-label': `${TEXT.openBeside}: ${view.title}`,
                            onClick: () => projects.openBeside(view.session),
                        }, h(ui.IconCompareSplitOutlineRegular, { size: 16 }))),
                    h(ui.Button, { variant: 'outline', size: 'sm', onClick: () => projects.openSession(view.session) }, TEXT.open)) : null) : null);
        }

        function ThreadCardList({ sessionId, cards, useSessions, useSessionStatus, projects }) {
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            // How each card's thread last ended, from the thread's own projection.
            const ofCards = info?.me.role === 'coordinator'
                ? cards.map((card) => (info.roster ?? EMPTY).find((t) => isObject(t) && t.id === card.thread)?.session).filter((id) => typeof id === 'string' && id !== '')
                : EMPTY;
            const endings = useEndings(useSessions, ofCards);
            // What a pause holds, so a held handback reads the same here as in the Threads menu.
            const coordinator = info?.me.role === 'coordinator' ? sessionId : info?.coordinator;
            const paused = usePaused(projects.facts, coordinator, coordinator ? 'list' : null) === true;
            const heldList = useHeldHandbacks(projects.facts, coordinator);
            React.useEffect(() => { if (paused && coordinator) void projects.facts.describe(coordinator, 15000); }, [paused, coordinator, projects]);
            const held = paused ? heldList : EMPTY;
            const all = info?.me.role === 'coordinator' && Array.isArray(info.me.cards) ? info.me.cards : EMPTY;
            const newest = (view) => view.threadId !== undefined && !all.some((c) => isObject(c) && c.thread === view.threadId && c.seq > view.seq);
            const views = info === undefined ? EMPTY : cards.map((card) => cardView(card, info, statuses, byId, sessionId, endings, held)).filter(Boolean)
                .map((view) => (newest(view) ? { ...view, newest: true } : view));
            // A coordinator's cards say what each thread runs on.
            const threadSessions = views.filter((view) => view.threadId !== undefined && view.session !== undefined).map((view) => view.session);
            const selections = useSelections(useSessions, threadSessions);
            const cv = useCatalogView(projects.catalog, threadSessions.length > 0);
            const key = threadSessions.join('\n');
            React.useEffect(() => {
                for (const id of threadSessions) projects.refresh(id);
            }, [key, projects]);
            // And what each changed in the workspace.
            const changes = useThreadChanges(projects, useSessions, info?.me.role === 'coordinator' ? sessionId : undefined, threadSessions, true);
            // A new project suggests first asks under its greeting until the user writes or a thread starts.
            const suggest = info !== undefined && info.me.role === 'coordinator' && info.me.asked !== true
                && Array.isArray(info.roster) && info.roster.length === 0 && cards.some((card) => card.kind === 'welcome');
            if (views.length === 0) return suggest ? h(Suggestions, { sessionId, projects }) : null;
            return h('div', { className: 'dshp-t-cards', 'data-projects-thread-cards': '' },
                ...views.map((view) => h(ThreadCard, {
                    key: view.key, projects,
                    view: view.threadId !== undefined && view.session !== undefined
                        ? { ...view, model: selectionText(cv, selections[view.session]), changes: changes[view.threadId] }
                        : view,
                })));
        }

        /** Under a finished turn: a card for each thread the turn started, steered, resolved or heard from. */
        function ThreadCards({ sessionId, turn, useProjection, useSessions, useSessionStatus, projects }) {
            const cards = useProjection(KEY, (value) => cardsOf(value, turn?.turn), sameList);
            if (cards.length === 0) return null;
            return h(ThreadCardList, { sessionId, cards, useSessions, useSessionStatus, projects });
        }

        /**
         * A new project's first asks, under the coordinator's greeting until
         * the user writes or a thread starts. One goes into the message box,
         * ready to send or change.
         */
        function Suggestions({ sessionId, projects }) {
            const [copied, setCopied] = React.useState(false);
            const use = (text) => {
                if (projects.draft(sessionId, text)) return;
                // No message box to fill (DSH changed it): copy the ask instead.
                Promise.resolve(globalThis.navigator?.clipboard?.writeText(text)).then(() => setCopied(true), () => {});
            };
            return h('div', { className: 'dshp-t-suggest', 'data-projects-suggestions': '' },
                h('div', { className: 'dshp-t-suggest-label', id: `dshp-suggest-${sessionId}` }, TEXT.tryAsking),
                h('div', { className: 'dshp-t-suggest-list', role: 'group', 'aria-labelledby': `dshp-suggest-${sessionId}` },
                    ...SUGGESTIONS.map((text) => h('button', {
                        key: text, type: 'button', className: 'dshp-t-suggest-item', 'data-projects-suggestion': '', onClick: () => use(text),
                    }, h(ui.IconSparkleRegular, { size: 14 }), h('span', null, text)))),
                copied ? h('div', { className: 'dshp-t-suggest-note', role: 'status' }, TEXT.suggestCopied) : null);
        }

        /** A paused project's line in the Threads menu and pane, with Resume. */
        function PausedNotice({ coordinator, role, projects }) {
            const { busy, failed, resume } = useResume(projects.facts, coordinator);
            const held = useHeld(projects.facts, coordinator);
            const handbacks = useHeldHandbacks(projects.facts, coordinator);
            return h('div', { className: 'dshp-t-paused', 'data-projects-paused': role },
                h('span', { className: 'dshp-t-paused-icon', 'aria-hidden': true }, h(ui.IconPauseOutlineRegular, { size: 14 })),
                h('div', { className: 'dshp-t-paused-text', role: 'status' },
                    h('b', null, TEXT.projectPaused), ' ', pausedText(role, held, handbacks.length),
                    failed ? h('span', { className: 'dshp-t-error' }, ` ${TEXT.resumeFailed}`) : null),
                h(ui.Button, {
                    variant: 'outline', size: 'sm', disabled: busy, 'data-projects-resume': '',
                    icon: h(ui.IconPlayOutlineRegular, { size: 14 }), onClick: () => { void resume(); },
                }, busy ? TEXT.resuming : TEXT.resume));
        }

        /**
         * Above the message box of every session of a paused project, the way
         * DSH shows a goal: what the pause means here, and Resume.
         */
        function PausedBar({ sessionId, useSessions, projects }) {
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const coordinator = info?.coordinator;
            const paused = usePaused(projects.facts, coordinator, coordinator ? `d:${coordinator}` : null);
            const held = useHeld(projects.facts, coordinator);
            const handbacks = useHeldHandbacks(projects.facts, coordinator);
            const { busy, failed, resume } = useResume(projects.facts, coordinator);
            if (info === undefined || paused !== true) return null;
            const text = failed ? TEXT.resumeFailed : pausedText(info.me.role, held, handbacks.length);
            return h('div', { className: 'dshp-dock', 'data-projects-paused-bar': info.me.role },
                h('div', { className: 'dshp-dock-bar', role: 'status', title: text },
                    h('span', { className: 'dshp-dock-glyph', 'aria-hidden': true }, h(ui.IconPauseOutlineRegular, { size: 14 })),
                    h('span', { className: 'dshp-dock-label' }, TEXT.projectPaused),
                    h('span', { className: failed ? 'dshp-dock-text dshp-t-error' : 'dshp-dock-text' }, text),
                    h(ui.Button, {
                        variant: 'outline', size: 'sm', disabled: busy, 'data-projects-resume': '',
                        icon: h(ui.IconPlayOutlineRegular, { size: 14 }), onClick: () => { void resume(); },
                    }, busy ? TEXT.resuming : TEXT.resume)));
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

        /**
         * What an idle thread row's mark says beyond "a thread": that it
         * failed, or waits on the user (a decision, a block), as its rows in
         * the Threads menu say. DSH draws its own dot while a thread runs or
         * waits on a prompt. '' for nothing to say.
         */
        function markState(state, sessionId) {
            const value = valueIn(state, sessionId);
            if (value?.role !== 'thread') return '';
            const roster = valueIn(state, value.coordinator)?.threads;
            const entry = Array.isArray(roster) ? roster.find((t) => isObject(t) && t.session === sessionId) : undefined;
            if (entry?.resolved === true) return '';
            const row = rowState({ resolved: false, running: false, pending: undefined, hb: isObject(entry?.handback) ? entry.handback : undefined, ending: endingIn(state, sessionId) });
            return row.dot === 'error' || row.dot === 'warning' ? `${row.dot}:${row.label}` : '';
        }

        /**
         * A row's mark: a corner while it nests under its coordinator, a
         * branch anywhere else (nestingRules picks), or the thread's state dot when it
         * failed or waits on the user; a pause sign on a paused project's
         * coordinator.
         */
        function ThreadMark({ sessionId, useSessions, projects }) {
            const thread = useSessions((state) => isThreadRow(state, sessionId));
            const coordinator = useSessions((state) => !isThreadRow(state, sessionId) && coordinatorName(state, sessionId) !== undefined);
            const paused = usePaused(projects.facts, coordinator ? sessionId : undefined, coordinator ? 'list' : null) === true;
            const mark = useSessions((state) => (thread ? markState(state, sessionId) : ''));
            const parent = useSessions((state) => (thread ? valueIn(state, sessionId)?.coordinator : undefined));
            // A thread row's state comes from its own session and its coordinator's roster; read both once if DSH hasn't.
            React.useEffect(() => { if (thread) projects.refresh(sessionId); }, [thread, sessionId, projects]);
            React.useEffect(() => { if (typeof parent === 'string' && parent !== '') projects.refresh(parent); }, [parent, projects]);
            if (paused) {
                return h('span', { className: 'dshp-t-mark dshp-t-paused-mark', role: 'img', 'aria-label': TEXT.projectPaused, title: TEXT.projectPaused, 'data-projects-paused-mark': '' },
                    h(ui.IconPauseOutlineRegular, { size: 12 }));
            }
            if (!thread) return null;
            if (mark !== '') {
                const [dot, label] = [mark.slice(0, mark.indexOf(':')), mark.slice(mark.indexOf(':') + 1)];
                return h('span', { className: 'dshp-t-mark', role: 'img', 'aria-label': `Project thread: ${label}`, title: label, 'data-projects-thread-mark': dot },
                    h(ui.StateDot, { state: dot }));
            }
            return h('span', { className: 'dshp-t-mark', role: 'img', 'aria-label': 'Project thread', 'data-projects-thread-mark': '' },
                h('span', { className: 'dshp-t-corner' }, h(ui.IconTreeCornerRegular, { size: 12 })),
                h('span', { className: 'dshp-t-branch' }, h(ui.IconBranchOutlineRegular, { size: 12 })));
        }

        /** The project name a coordinator session stands for, or undefined. */
        function coordinatorName(state, sessionId) {
            const value = valueIn(state, sessionId);
            if (value?.role === 'coordinator' && typeof value.project?.name === 'string' && value.project.name !== '') return value.project.name;
            const title = state?.byId?.[sessionId]?.title;
            return typeof title === 'string' && title.startsWith('◆ ') && title.length > 2 ? title.slice(2) : undefined;
        }

        /** Coordinator session ids by project name, once per session list state. */
        const coordinatorIdsCache = new WeakMap();
        function coordinatorIds(state) {
            if (!isObject(state)) return new Map();
            let ids = coordinatorIdsCache.get(state);
            if (ids === undefined) {
                ids = new Map();
                for (const id of Object.keys(state.byId ?? {})) {
                    const name = coordinatorName(state, id);
                    if (name !== undefined && !ids.has(name)) ids.set(name, id);
                }
                coordinatorIdsCache.set(state, ids);
            }
            return ids;
        }

        /**
         * A session list row's place in a project: `coordinator:<its id>`,
         * `thread:<its coordinator's id>`, or '' for any other session.
         */
        function rowPlace(state, sessionId) {
            if (!isObject(state)) return '';
            const value = valueIn(state, sessionId);
            if (value?.role === 'coordinator' || (!value && coordinatorName(state, sessionId) !== undefined)) return `coordinator:${sessionId}`;
            if (value?.role === 'thread') return typeof value.coordinator === 'string' && value.coordinator !== '' ? `thread:${value.coordinator}` : '';
            if (value || !isThreadRow(state, sessionId)) return '';
            // A thread from before titles lost "<project> › ", whose projection hasn't reached the list yet.
            const title = state.byId[sessionId].title;
            const of = coordinatorIds(state).get(title.slice(0, title.indexOf(' › ')));
            return of === undefined ? '' : `thread:${of}`;
        }

        /**
         * The CSS that nests a coordinator's threads under it in DSH's session
         * list. Each row of the list sits in a wrapper of its own and the
         * wrappers are siblings; RowPlace marks each row from inside it. A
         * thread's wrapper nests when every wrapper between it and the
         * coordinator's holds a thread of that coordinator. DSH lists every
         * session as a top-level row, in recency or manual order, so any other
         * row in between ends the run, and a thread above its coordinator
         * stays where DSH put it, with its branch mark.
         * @param of - the coordinator's session id.
         */
        function nestingRules(of) {
            if (typeof of !== 'string' || !/^[\w.:-]+$/.test(of)) return '';
            const holds = (role) => `:has(>[data-row-key] [data-projects-row="${role}"][data-projects-of="${of}"])`;
            const C = holds('coordinator');
            const T = holds('thread');
            const nested = `[role="tree"] ${C}~${T}:not(${C}~:not(${T})~*)`;
            return [
                `${nested}>[data-row-key]{padding-inline-start:calc(var(--dshp-nest,30px) + var(--dsh-workspace-indent,0px))}`,
                `${nested} .dshp-t-corner{display:inline-flex}`,
                `${nested} .dshp-t-branch{display:none}`,
            ].join('\n');
        }

        /**
         * A row's place in its project, from inside the row: a hidden mark in
         * the row's actions seat, which DSH mounts on every row whether it is
         * idle or busy, for nestingRules to read; and on a coordinator's row,
         * those rules, which come and go with the row. Nothing of DSH's own
         * is changed.
         */
        function RowPlace({ sessionId, useSessions }) {
            const place = useSessions((state) => rowPlace(state, sessionId));
            if (place === '') return null;
            const at = place.indexOf(':');
            const role = place.slice(0, at);
            const of = place.slice(at + 1);
            return h('span', { hidden: true, 'data-projects-row': role, 'data-projects-of': of },
                role === 'coordinator' ? h('style', null, nestingRules(of)) : null);
        }

        /**
         * A thread's state in its session-list hover card. DSH ends the card
         * with the session's own status ("● Idle", "● Running"), so this says
         * what the thread last did: its handback, or how its last turn ended.
         */
        function hoverLine(row) {
            if (row.pending) return undefined;
            if (row.running || row.held || row.entry.resolved) return row.line;
            if (row.ending) {
                const why = endingReason(row.ending);
                if (row.ending.state === 'failed') return `Last turn failed · ${why}`;
                return why ? `Last turn stopped · ${why}` : 'Last turn stopped before it finished';
            }
            return isObject(row.entry.handback) ? `Last handback · ${row.line}` : row.line;
        }

        function ThreadHover({ sessionId, useSessions, useSessionStatus, projects }) {
            const info = useSessions((state) => projectContext(state, sessionId), sameContext);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            const own = info?.me.role === 'thread';
            const endingSessions = React.useMemo(() => (own ? [sessionId] : openSessions(info?.roster)), [own, sessionId, info?.roster]);
            const endings = useEndings(useSessions, endingSessions);
            const picked = useSessions((state) => selectionIn(state, sessionId), sameSelection);
            const cv = useCatalogView(projects.catalog, info !== undefined);
            const paused = usePaused(projects.facts, info?.coordinator, info?.coordinator ? 'list' : null) === true;
            const handbacks = useHeldHandbacks(projects.facts, info?.coordinator);
            const thread = info?.me.role === 'thread';
            const changed = useThreadChanges(projects, useSessions, thread ? info.coordinator : undefined, thread ? [sessionId] : EMPTY, true)[info?.me.thread?.id];
            // Which handbacks a pause holds is in the project's description; read it once for this card.
            React.useEffect(() => { if (paused && info?.coordinator) void projects.facts.describe(info.coordinator, 15000); }, [paused, info?.coordinator, projects]);
            if (info === undefined) return null;
            const project = info.project.name ?? '';
            const runs = picked ? h('div', { className: 'dshp-t-hover-line', 'data-projects-thread-model': '' }, `Runs on ${selectionText(cv, picked)}`) : null;
            const pause = paused ? h('div', { className: 'dshp-t-hover-line', 'data-projects-paused': '' }, `${TEXT.projectPaused}. ${pausedText(info.me.role, 0)}`) : null;
            if (info.me.role === 'thread') {
                const entry = (info.roster ?? EMPTY).find((t) => isObject(t) && t.session === sessionId);
                const row = entry ? withHeld([threadRow(entry, statuses, byId, endings)], paused ? handbacks : EMPTY)[0] : undefined;
                const line = row ? hoverLine(row) : undefined;
                return h('div', { className: 'dshp-t-hover', 'data-projects-thread-hover': '' },
                    h('div', { className: 'dshp-t-hover-head' }, h(ui.IconTreeCornerRegular, { size: 12 }), `Thread ${info.me.thread?.id ?? ''} of ◆ ${project}`),
                    line ? h('div', { className: 'dshp-t-hover-line', 'data-projects-state': row.dot }, line) : null,
                    changed ? h('div', { className: 'dshp-t-hover-line', 'data-projects-changes': '' }, ...changeCounts(changed)) : null,
                    runs, pause);
            }
            const counts = countsOf(rowsOf(info.roster, statuses, byId, endings));
            return h('div', { className: 'dshp-t-hover', 'data-projects-thread-hover': '' },
                h('div', { className: 'dshp-t-hover-head' }, h('span', { 'aria-hidden': true }, '◆'), `Coordinator of ${project}`),
                h('div', { className: 'dshp-t-hover-line' }, counts.open + counts.resolved > 0 ? summaryText(counts).replace(/^(\d+) open/, (m, n) => plural(Number(n), 'open thread')) : 'No threads yet'),
                runs, pause);
        }

        /** Navigation the thread views share, with the model catalog and the plugin's endpoints; nothing here throws into React. */
        function threadsApi(ctx, dialog = settingsDialog(), shared = {}) {
            const warn = (what, error) => { console.warn(`[projects] ${what}: ${error?.message ?? error}`); };
            const openSession = (sessionId) => {
                if (typeof sessionId !== 'string' || sessionId === '') return;
                try { ctx.uiWorkspace.openSession(sessionId); } catch (error) { warn('could not open the session', error); }
            };
            const failed = new Set();
            const catalog = shared.catalog ?? catalogSource(() => undefined);
            const link = shared.link ?? hostLink(() => undefined, catalog);
            /** DSH's message box of a session (its composer's shell), or undefined. */
            const composerOf = (sessionId) => {
                const scope = ctx.sessions?.scope?.(sessionId);
                const shell = scope?.get?.('conversation')?.input?.for?.(scope);
                return shell && (typeof shell.actions?.setDraft === 'function' || typeof shell.setDraft === 'function') ? shell : undefined;
            };
            return {
                openSession,
                /** The Project settings dialog, for the entry points. */
                settings: dialog,
                /** DSH's model catalog, to name the models sessions run on. */
                catalog,
                /** The plugin's endpoints (remote.js). */
                link,
                /** What the plugin says about projects, shared by the window's views. */
                facts: shared.facts ?? projectFacts(link),
                /**
                 * Put text in a session's message box and move the keyboard
                 * there, ready to send or change. @returns whether it could.
                 */
                draft(sessionId, text) {
                    try {
                        const shell = typeof sessionId === 'string' && sessionId !== '' ? composerOf(sessionId) : undefined;
                        if (!shell) return false;
                        if (typeof shell.actions?.setDraft === 'function') shell.actions.setDraft(text);
                        else shell.setDraft(text);
                        shell.focus?.();
                        return true;
                    } catch (error) {
                        warn('could not put the ask in the message box', error);
                        return false;
                    }
                },
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
                /**
                 * DSH's Review tab on one turn's changes (`last`: {seq, turn}).
                 * The tab reviews the session whose sidebar holds it, so the
                 * thread opens and the tab opens in its sidebar once DSH has
                 * set that sidebar up (a moment later). Where DSH can't open a
                 * tab in another session, the thread opens, with DSH's own
                 * card for its changes.
                 */
                openReview(sessionId, last) {
                    if (typeof sessionId !== 'string' || sessionId === '' || !isObject(last)) return;
                    const address = `${REVIEW_PREFIX}${encodeURIComponent(sessionId)}/${last.seq}/${last.turn}`;
                    const sidebar = ctx.sidebarRight;
                    openSession(sessionId);
                    if (typeof sidebar?.openResourceIn !== 'function' || typeof sidebar.actionsFor !== 'function') return;
                    let tries = 0;
                    const place = () => {
                        try {
                            if (sidebar.actionsFor(sessionId) !== undefined) {
                                sidebar.openResourceIn(sessionId, address, { params: { index: 0 } });
                                return;
                            }
                        } catch (error) {
                            warn('could not open the changes', error);
                            return;
                        }
                        if (++tries < 50) setTimeout(place, 100);
                    };
                    place();
                },
                /** DSH's developer tools setting, which shows or hides code changes in chats; undefined where DSH has none. */
                codeChanges() {
                    try {
                        const store = ctx.get('configForms')?.developerTools?.enabled;
                        return store && typeof store.subscribe === 'function' && typeof store.getSnapshot === 'function' ? store : undefined;
                    } catch {
                        return undefined;
                    }
                },
                hasPane() {
                    try { return ctx.get('sidebarRightTabs')?.get?.(KINDS.pane) !== undefined; } catch { return false; }
                },
                /** DSH's Plugins page at this plugin (its Default models and projects); undefined where DSH can't open it. */
                get openDefaults() {
                    let nav;
                    try { nav = ctx.get?.('pluginNavigation'); } catch { nav = undefined; }
                    if (!nav || typeof nav.openBundle !== 'function') return undefined;
                    return () => {
                        try { nav.openBundle(BUNDLE); } catch (error) { warn('could not open the plugin\'s page', error); }
                    };
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

        function applyThreads(ctx, dialog, shared) {
            const projects = threadsApi(ctx, dialog, shared);
            const withApi = () => ({ projects });
            ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
                name: 'conversation.session.header.actions', id: IDS.menu, order: -25, inject: withApi,
            }, ThreadsMenu));
            ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
                name: 'conversation.chat.turnTail', id: IDS.cards, order: 30, inject: withApi,
            }, ThreadCards));
            ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
                name: 'sidebar.session.row.leading', id: IDS.mark, order: 20, inject: withApi,
            }, ThreadMark));
            // Threads under their coordinator in the session list: a mark inside each row, read by CSS.
            ctx.slots.inject('sidebar.workspaces.session.row.action', () => ctx.slots.register({
                name: 'sidebar.workspaces.session.row.action', id: IDS.place, order: 900,
            }, RowPlace));
            ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
                name: 'conversation.input.dock', id: IDS.paused, order: 15, inject: withApi,
            }, PausedBar));
            ctx.slots.inject('sidebar.session.row.hover', () => ctx.slots.register({
                name: 'sidebar.session.row.hover', id: IDS.hover, order: 20, inject: withApi,
            }, ThreadHover));
            // The Projects entry in DSH's sidebar, after Plugins, and the page it opens.
            ctx.slots.inject('main', () => ctx.slots.register({
                name: 'main', key: IDS.page, inject: withApi,
            }, ProjectsPage));
            ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
                name: 'sidebar.panellist', id: IDS.page, order: 5, label: PAGE.title,
            }, ProjectsIcon));
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

        // ── Projects page ──────────────────────────────────────────────────

        const PAGE = {
            title: 'Projects',
            loading: 'Loading projects…',
            emptyTitle: 'No projects yet',
            emptyText: 'A project is a ◆ coordinator you talk to and the threads it starts, working in one of your folders. Add one in the plugin\'s settings and it shows up here.',
            emptyAction: 'Open the plugin\'s settings',
            notStarted: 'The coordinator starts the next time DSH loads the plugin.',
            open: 'Open',
        };

        /**
         * The Projects entry's icon, drawn like DSH's own (a 16 px grid and a
         * 1 px stroke): a project's ◆ coordinator branching into its threads.
         */
        function ProjectsIcon({ size = 16 }) {
            return h('svg', {
                width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
                strokeWidth: 1, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
            },
            h('path', { d: 'M4.6 5 7.6 8l-3 3-3-3Z' }),
            h('path', { d: 'M7.6 8 11.32 4.4M7.6 8l3.72 3.6' }),
            h('circle', { cx: 12.45, cy: 3.31, r: 1.57 }),
            h('circle', { cx: 12.45, cy: 12.69, r: 1.57 }));
        }

        /** When a project last moved: its coordinator's or any thread's newest update. */
        function lastActive(project, byId) {
            let at = 0;
            const consider = (id) => {
                const t = typeof id === 'string' ? byId?.[id]?.updatedAt : undefined;
                if (Number.isFinite(t) && t > at) at = t;
            };
            consider(project.coordinator);
            return at;
        }

        /**
         * One project on the Projects page: its name (which opens the
         * coordinator), its folder and what its threads are doing, what it
         * runs on (each opens Project settings with that menu open), the
         * pause with Resume, and its threads by state, as in the Threads
         * menu; Done, Idle and Resolved fold behind their counts.
         */
        function ProjectCard({ project, useSessions, useSessionStatus, projects, now, settingsOn }) {
            const coordinator = typeof project.coordinator === 'string' && project.coordinator !== '' ? project.coordinator : undefined;
            const info = useSessions((state) => (coordinator ? projectContext(state, coordinator) : undefined), sameContext);
            const statuses = useSessionStatus((value) => value);
            const byId = useSessions((state) => state.byId);
            React.useEffect(() => { if (coordinator) projects.refresh(coordinator); }, [coordinator, projects]);
            const paused = project.paused === true || usePaused(projects.facts, coordinator, null) === true;
            const handbacks = useHeldHandbacks(projects.facts, coordinator);
            useWatch(projects.facts, coordinator && paused ? `d:${coordinator}` : null, paused);
            const rows = useRows(projects, useSessions, info?.roster, statuses, byId, paused ? handbacks : EMPTY);
            const { cv, models } = useRosterModels(projects, useSessions, rows, coordinator, true);
            const changes = useThreadChanges(projects, useSessions, coordinator, rowSessions(rows), true);
            const summary = summaryModels(cv, models, coordinator, { settings: project.settings });
            const name = project.name || project.id;
            const headingId = `dshp-pg-${project.id}`;
            const open = () => { if (coordinator) projects.openSession(coordinator); };
            const target = coordinator ?? project.id;
            // What its threads are doing; nothing for a project without threads, whose list says so.
            const counts = info?.roster ? countsOf(rows)
                : { open: Number(project.threads?.open) || 0, waiting: 0, running: 0, resolved: Number(project.threads?.resolved) || 0 };
            const threadsText = counts.open + counts.resolved > 0 ? summaryText(counts) : null;
            const model = (id, label, text) => {
                const content = [h('span', { key: 'l' }, label), h('span', { key: 'v' }, text ?? '…')];
                if (!settingsOn) return h('span', { key: id, className: 'dshp-pg-model', 'data-projects-models': id }, ...content);
                return h('button', {
                    key: id, type: 'button', className: 'dshp-pg-model', 'data-projects-models': id,
                    'aria-label': `${label}: ${text ?? 'loading'}. Change it in ${SETTINGS.title}`,
                    onClick: () => projects.settings.open(target, { pick: id }),
                }, ...content);
            };
            let body;
            if (!coordinator) body = h('div', { className: 'dshp-t-notice' }, PAGE.notStarted);
            else if (info === undefined) body = h('div', { className: 'dshp-t-notice', role: 'status' }, TEXT.loading);
            else {
                body = rosterNotice(info, rows, projects) ?? h(ThreadList, {
                    rows, now, models, changes, projects, quietModel: summary.thread,
                    fold: ['done', 'idle', 'resolved'],
                    onOpen: (row) => projects.openSession(row.session),
                });
            }
            return h('section', { className: 'dshp-pg-card', 'aria-labelledby': headingId, 'data-projects-project': project.id, onKeyDown: (event) => arrowKeys(event, event.currentTarget) },
                h('div', { className: 'dshp-pg-head' },
                    h('h2', { className: 'dshp-pg-title', id: headingId },
                        h('button', { type: 'button', className: 'dshp-pg-name', disabled: !coordinator, onClick: open, 'aria-label': `Open ◆ ${name}` },
                            h('span', { className: 'dshp-pg-diamond', 'aria-hidden': true }, '◆'),
                            h('span', { className: 'dshp-pg-name-text' }, name)),
                        paused ? h('span', { className: 'dshp-pg-badge', 'data-projects-paused': '' }, h(ui.IconPauseOutlineRegular, { size: 12 }), TEXT.paused) : null),
                    h('span', { className: 'dshp-pg-actions' },
                        settingsOn ? h(ui.Tooltip, { label: SETTINGS.title, side: 'bottom' },
                            h('button', {
                                type: 'button', className: 'dshp-t-icon', 'aria-label': `${SETTINGS.title}: ${name}`, 'data-projects-settings-trigger': '',
                                onClick: () => projects.settings.open(target),
                            }, h(ui.IconSlidersTwoOutlineRegular, { size: 14 }))) : null,
                        coordinator ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: open, 'aria-label': `${PAGE.open} ◆ ${name}` }, PAGE.open) : null)),
                h('div', { className: 'dshp-pg-meta' },
                    project.workspace ? h('span', { className: 'dshp-pg-folder', title: project.workspace },
                        h(ui.IconFolderCloseRegular, { size: 13, 'aria-hidden': true }), h('span', null, folderName(project.workspace))) : null,
                    threadsText ? h('span', { 'data-projects-summary': '' }, threadsText) : null),
                h('div', { className: 'dshp-pg-models', role: 'group', 'aria-label': 'Models' },
                    model('coordinator', TEXT.coordinator, summary.coordinator),
                    model('thread', 'New threads', summary.thread)),
                h('div', { className: 'dshp-pg-body' },
                    paused && coordinator ? h(PausedNotice, { coordinator, role: 'coordinator', projects }) : null,
                    body));
        }

        /**
         * The Projects page, opened from the Projects entry in DSH's sidebar:
         * every project as a card, the most recently active first.
         */
        function ProjectsPage({ useSessions, useSessionStatus, projects }) {
            useFacts(projects.facts);
            useWatch(projects.facts, 'list');
            const settingsOn = useSettingsAvailable(projects.settings);
            const listed = projects.facts.projects();
            const failed = projects.facts.listFailed();
            const byId = useSessions((state) => state.byId);
            const now = useNow(true);
            const order = React.useMemo(() => {
                if (!Array.isArray(listed)) return EMPTY;
                // Most recent activity first; the profile's order among projects that never ran.
                return listed.map((p, i) => ({ p, i, at: lastActive(p, byId) })).sort((a, b) => b.at - a.at || a.i - b.i).map((x) => x.p);
            }, [listed, byId]);
            let content;
            if (listed === null) {
                content = failed
                    ? h('div', { className: 'dshp-pg-state dshp-t-error', role: 'alert' }, SETTINGS.unreachable, ' ',
                        h('button', { type: 'button', className: 'dshp-t-retry', onClick: () => { void projects.facts.list(0); } },
                            h(ui.IconRefreshOutlineRegular, { size: 12 }), TEXT.retry))
                    : h('div', { className: 'dshp-pg-state', role: 'status' }, PAGE.loading);
            } else if (order.length === 0) {
                content = h('div', { className: 'dshp-pg-empty', 'data-projects-empty': '' },
                    h('span', { className: 'dshp-pg-empty-glyph' }, h(ProjectsIcon, { size: 28 })),
                    h('h2', null, PAGE.emptyTitle),
                    h('p', null, PAGE.emptyText),
                    projects.openDefaults ? h(ui.Button, { variant: 'outline', size: 'sm', className: 'dshp-pg-cta', onClick: () => projects.openDefaults() }, PAGE.emptyAction) : null);
            } else {
                content = h('ul', { className: 'dshp-pg-list' },
                    ...order.map((project) => h('li', { key: project.id },
                        h(ProjectCard, { project, useSessions, useSessionStatus, projects, now, settingsOn }))));
            }
            return h('div', { className: 'dshp-pg', 'data-projects-page': '' },
                h('div', { className: 'dshp-pg-scroll' },
                    h('div', { className: 'dshp-pg-content' },
                        h('div', { className: 'dshp-pg-heading' },
                            h('h1', null, PAGE.title),
                            Array.isArray(listed) && listed.length > 0 ? h('span', { className: 'dshp-pg-count' }, plural(listed.length, 'project')) : null),
                        content)));
        }

        // ── Project settings ───────────────────────────────────────────────

        const SETTINGS = {
            title: 'Project settings',
            close: 'Close',
            loading: 'Loading this project\'s settings…',
            unreachable: 'The projects plugin didn\'t answer. If it was just updated, restart DSH so the new version loads.',
            retry: 'Try again',
            catalogFailed: 'DSH\'s model list didn\'t load, so the pickers can\'t list models.',
            models: 'Models',
            threads: 'Threads',
            project: 'Project',
            noThreads: 'No threads yet. Each thread the coordinator starts shows up here with its model.',
            allResolved: 'Every thread is resolved.',
            pause: 'Pause this project',
            pauseHint: 'New threads and handbacks wait until you resume.',
            own: 'Set for this project',
            useDefault: 'Use default',
            running: 'Running. A change applies from its next request.',
            resolved: 'Resolved.',
            note: 'Projects that don\'t choose their own models use the plugin\'s Default models.',
            openDefaults: 'Default models for all projects',
        };
        const SETTING_ROUTES = [
            { id: 'coordinator', title: 'Coordinator', hint: 'The ◆ session you talk to. A model you pick in its chat lands here too.', model: 'coordinatorModel', effort: 'coordinatorEffort' },
            { id: 'thread', title: 'New threads', hint: 'What each new thread starts on. Running threads keep theirs.', model: 'threadModel', effort: 'threadEffort' },
        ];
        /** Where an inherited value comes from, in the pickers' Default rows and under a row. */
        const SOURCE_LABELS = { 'project setting': 'This project', 'project config': 'Your profile', 'plugin default': 'Default models', 'DSH default': 'DSH default' };

        /**
         * Which project the dialog shows, if any. Any part of the window opens
         * it with a session (or project) id; the dialog part, once its DSH
         * services are there, marks it available so the entry points show.
         */
        function settingsDialog() {
            let snapshot = { target: null, seq: 0, available: false, pick: null };
            const listeners = new Set();
            const set = (next) => {
                snapshot = { ...snapshot, ...next };
                for (const listener of [...listeners]) listener();
            };
            return {
                getSnapshot: () => snapshot,
                subscribe: (listener) => {
                    listeners.add(listener);
                    return () => listeners.delete(listener);
                },
                /** @param options - {pick?: 'coordinator'|'thread'}: open with that model menu open. */
                open(target, options) {
                    const pick = options?.pick === 'coordinator' || options?.pick === 'thread' ? options.pick : null;
                    if (typeof target === 'string' && target !== '' && snapshot.available) set({ target, seq: snapshot.seq + 1, pick });
                },
                close() {
                    if (snapshot.target !== null) set({ target: null });
                },
                connect() {
                    set({ available: true });
                    return () => set({ available: false, target: null, pick: null });
                },
            };
        }
        const useSettingsAvailable = (dialog) => React.useSyncExternalStore(dialog.subscribe, () => dialog.getSnapshot().available);

        /**
         * The plugin's endpoints (remote.js) over the window's own connection,
         * with DSH's model catalog.
         * @param connectionOf - DSH's `connection` service, or undefined until DSH provides it.
         */
        function hostLink(connectionOf, catalog) {
            return {
                catalog,
                async call(method, args) {
                    try {
                        const connection = connectionOf();
                        if (!connection) throw new Error('the window is not connected to DSH yet');
                        const result = await connection.rpc.call('/api', `${BUNDLE}/${method}`, { args });
                        if (isObject(result) && (result.ok === true || (result.ok === false && isObject(result.error)))) return result;
                        return { ok: false, error: { code: 'projects/unreadable', message: 'The plugin sent an answer this window can\'t read.' } };
                    } catch (error) {
                        return { ok: false, error: { code: 'projects/unreachable', message: String(error?.message ?? error) } };
                    }
                },
            };
        }

        /** A folder's own name from its path ("storefront" from "/work/storefront/"). */
        function folderName(path) {
            const parts = String(path).split(/[\\/]+/).filter(Boolean);
            return parts.length > 0 ? parts[parts.length - 1] : String(path);
        }

        /** A failed call as one sentence: the plugin's own refusal, or that it can't be reached. */
        function errorText(error) {
            const code = String(error?.code ?? '');
            const message = String(error?.message ?? '').trim();
            if (code === 'projects/refused' && message) return `${message.replace(/^./, (c) => c.toUpperCase())}${/[.!?]$/.test(message) ? '' : '.'}`;
            if (code === 'projects/unreachable' || code.startsWith('gateway/not') || code.startsWith('rpc/')) return SETTINGS.unreachable;
            return message ? `The change didn't go through: ${message}` : SETTINGS.unreachable;
        }

        /** The parts of a change's notes worth showing: a dropped effort, or a model that could not be set. */
        function noteText(notes) {
            const parts = [];
            for (const note of Array.isArray(notes) ? notes : []) {
                if (typeof note !== 'string') continue;
                for (const part of note.replace(/^t\d+: /, '').split(/; |(?<=\.) /)) {
                    // Efforts a model can't use show on the row itself (effortNote), so only failures are told here.
                    if (/could not/.test(part)) parts.push(part.replace(/^but the /, 'The ').replace(/\.?$/, '.'));
                }
            }
            return parts.join(' ');
        }

        function SettingRow({ id, lead, title, description, source, note, control, message }) {
            return h('div', { className: 'dshp-ps-row', 'data-projects-setting': id },
                h('div', { className: 'dshp-ps-text' },
                    h('div', { className: 'dshp-ps-title' },
                        lead ?? null,
                        h('span', null, title)),
                    description ? h('div', { className: 'dshp-ps-desc' }, description) : null,
                    source ? h('div', { className: 'dshp-ps-source' }, ...source) : null,
                    note ? h('div', { className: 'dshp-ps-fit', 'data-projects-setting-note': '' }, note) : null),
                control,
                message ? h('p', {
                    className: `dshp-ps-alert ${message.kind === 'error' ? 'dshp-ps-error' : 'dshp-ps-info'}`,
                    role: message.kind === 'error' ? 'alert' : 'status',
                }, message.text) : null);
        }

        function Section({ id, heading, meta, children }) {
            return h('section', { className: 'dshp-ps-section', 'data-projects-settings-section': id },
                h('div', { className: 'dshp-ps-head' },
                    h('h3', { className: 'dshp-ps-heading' }, heading),
                    meta ? h('span', { className: 'dshp-ps-count' }, meta) : null),
                h('div', { className: 'dshp-ps-card' }, children));
        }

        /**
         * One project's settings: the coordinator's and new threads' model and
         * effort, each thread's, and pause. Every change goes to the plugin at
         * once, like DSH's own settings, and the dialog shows what the plugin
         * then holds; it reads again every few seconds, so a change made in a
         * chat or by the coordinator shows up too.
         */
        /** Stands in for DSH's session store where a slot doesn't get one: nothing known. */
        const noSessions = (select) => select({});

        function ProjectSettings({ target, pick, link, facts, dialog, openDefaults, useSessionStatus, useSessions = noSessions }) {
            const catalog = React.useSyncExternalStore(link.catalog.subscribe, link.catalog.getSnapshot);
            const statuses = useSessionStatus((value) => value);
            const [data, setData] = React.useState(null);
            const [failure, setFailure] = React.useState(null);
            const [busy, setBusy] = React.useState(null);
            const [message, setMessage] = React.useState(null);
            const [showResolved, setShowResolved] = React.useState(false);
            const reads = React.useRef(0);
            const alive = React.useRef(true);
            React.useEffect(() => () => { alive.current = false; }, []);
            // Each thread's dot says what the Threads menu says, a failed or stopped last turn included.
            const threadSessions = React.useMemo(() => openSessions(Array.isArray(data?.threads)
                ? data.threads.map((t) => (isObject(t) ? { ...t, resolved: t.resolved === true } : t)) : EMPTY), [data?.threads]);
            const endings = useEndings(useSessions, threadSessions);
            const read = React.useCallback(async () => {
                const seq = ++reads.current;
                const result = await link.call('describe', { target });
                if (!alive.current || seq !== reads.current) return;
                if (result.ok && isObject(result.value) && isObject(result.value.settings)) {
                    setData(result.value);
                    setFailure(null);
                    facts?.put(target, result.value);
                } else {
                    setFailure(errorText(result.ok ? undefined : result.error));
                }
            }, [link, target]);
            React.useEffect(() => {
                link.catalog.load();
                void read();
                const timer = setInterval(() => {
                    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void read();
                }, 8000);
                return () => clearInterval(timer);
            }, [link, read]);

            const change = async (key, changes) => {
                setBusy(key);
                setMessage(null);
                // A read already on its way would show the values from before the change.
                reads.current += 1;
                const result = await link.call('update', { target, changes });
                if (!alive.current) return;
                setBusy(null);
                if (!result.ok) {
                    setMessage({ key, kind: 'error', text: errorText(result.error) });
                    return;
                }
                if (isObject(result.value) && isObject(result.value.settings)) {
                    setData(result.value);
                    // The other views (the pause bar, the menu, the session list) show the change at once.
                    facts?.put(target, result.value);
                }
                const note = noteText(result.value?.notes);
                if (note) setMessage({ key, kind: 'info', text: note });
            };
            const messageFor = (key) => (message?.key === key ? message : null);

            let body;
            if (data === null) {
                body = failure
                    ? h('div', { className: 'dshp-ps-state dshp-ps-error', role: 'alert' }, failure,
                        h(ui.Button, { variant: 'outline', size: 'sm', onClick: () => { setFailure(null); void read(); } }, SETTINGS.retry))
                    : h('div', { className: 'dshp-ps-state', role: 'status' }, SETTINGS.loading);
            } else {
                const disabled = busy !== null;
                const cv = catalogView(catalog.value);
                const notesFor = (shown, live, ownEffort = true) => [effortNote(cv, shown, ownEffort), liveNote(cv, shown, live)].filter(Boolean).join(' ') || undefined;
                const routeRow = (route) => {
                    const m = data.settings[route.model] ?? {};
                    const e = data.settings[route.effort] ?? {};
                    const shown = resolveRoute(cv, m.value ?? undefined, e.value ?? undefined);
                    const own = { model: m.source === 'project setting', effort: e.source === 'project setting' };
                    const reset = { ...(own.model ? { [route.model]: null } : {}), ...(own.effort ? { [route.effort]: null } : {}) };
                    const source = own.model || own.effort
                        ? [h('span', { key: 'own', className: 'dshp-ps-own' }, SETTINGS.own),
                            h('button', { key: 'reset', type: 'button', className: 'dshp-ps-link', disabled, onClick: () => change(route.id, reset) }, SETTINGS.useDefault)]
                        : [h('span', { key: 'from' }, sourceLine(m, levelsOf(shown) ? e : undefined, { long: true }))];
                    return h(SettingRow, {
                        key: route.id, id: route.id, title: route.title, description: route.hint, source, message: messageFor(route.id),
                        note: notesFor(shown, route.id === 'coordinator' ? data.project?.live : undefined, own.effort),
                        control: h(ModelPicker, {
                            id: `dshp-ps-${route.id}`, label: route.title, catalog: catalog.value, busy: busy === route.id, disabled,
                            value: { model: m.value, effort: e.value }, own, autoOpen: pick === route.id,
                            fallback: {
                                model: m.inherited?.value, effort: e.inherited?.value,
                                modelLabel: SOURCE_LABELS[m.inherited?.source], effortLabel: SOURCE_LABELS[e.inherited?.source],
                            },
                            onPick: (pick) => change(route.id, {
                                ...(pick.model !== undefined ? { [route.model]: pick.model } : {}),
                                ...(pick.effort !== undefined ? { [route.effort]: pick.effort } : {}),
                            }),
                        }),
                    });
                };
                const threads = Array.isArray(data.threads) ? data.threads.filter((t) => isObject(t) && typeof t.id === 'string') : [];
                const open = threads.filter((t) => !t.resolved);
                const resolved = threads.filter((t) => t.resolved);
                const threadRowFor = (t) => {
                    const key = `thread:${t.id}`;
                    const status = typeof t.session === 'string' ? statuses?.get?.(t.session) : undefined;
                    const running = status?.running === true;
                    // The same states as the Threads menu.
                    const { dot } = rowState({
                        resolved: t.resolved === true, running, pending: status?.pendingInteraction ?? undefined,
                        hb: typeof t.handback === 'string' ? { status: t.handback } : undefined,
                        ending: typeof t.session === 'string' ? endings[t.session] : undefined,
                    });
                    return h(SettingRow, {
                        key, id: key, title: t.title || t.id, message: messageFor(key),
                        note: notesFor(resolveRoute(cv, t.model ?? undefined, t.effort ?? undefined), t.live),
                        lead: h('span', { className: 'dshp-ps-dot' }, h(ui.StateDot, { state: dot })),
                        description: t.resolved ? SETTINGS.resolved : running ? SETTINGS.running : undefined,
                        control: h(ModelPicker, {
                            id: `dshp-ps-${t.id}`, label: `${t.title || t.id} (${t.id})`, catalog: catalog.value, busy: busy === key, disabled,
                            value: { model: t.model ?? undefined, effort: t.effort ?? undefined }, own: { model: true, effort: true },
                            onPick: (pick) => change(key, { thread: t.id, ...pick }),
                        }),
                    });
                };
                const shown = showResolved ? [...open, ...resolved] : open;
                body = [
                    catalog.status === 'failed' && !catalog.value ? h('p', { key: 'catalog', className: 'dshp-ps-alert dshp-ps-info', role: 'status' }, SETTINGS.catalogFailed, ' ',
                        h('button', { type: 'button', className: 'dshp-ps-link', onClick: () => link.catalog.load() }, SETTINGS.retry)) : null,
                    h(Section, { key: 'models', id: 'models', heading: SETTINGS.models }, ...SETTING_ROUTES.map(routeRow)),
                    h(Section, { key: 'threads', id: 'threads', heading: SETTINGS.threads, meta: threads.length > 0 ? `${open.length} open` : undefined },
                        shown.length === 0 ? h('div', { key: 'empty', className: 'dshp-ps-empty' }, threads.length === 0 ? SETTINGS.noThreads : SETTINGS.allResolved) : null,
                        ...shown.map(threadRowFor),
                        resolved.length > 0 ? h('button', {
                            key: 'more', type: 'button', className: 'dshp-ps-more', 'aria-expanded': showResolved, onClick: () => setShowResolved((value) => !value),
                        }, h(ui.IconChevronRightOutlineRegular, { size: 12 }), `${showResolved ? 'Hide' : 'Show'} ${plural(resolved.length, 'resolved thread')}`) : null),
                    h(Section, { key: 'project', id: 'project', heading: SETTINGS.project },
                        h(SettingRow, {
                            id: 'paused', title: SETTINGS.pause, description: SETTINGS.pauseHint, message: messageFor('paused'),
                            control: h(ui.Switch, { checked: data.paused?.value === true, label: SETTINGS.pause, disabled, onChange: (next) => change('paused', { paused: next }) }),
                        })),
                    h('p', { key: 'note', className: 'dshp-ps-note' }, SETTINGS.note,
                        openDefaults ? [' ', h('button', {
                            key: 'defaults', type: 'button', className: 'dshp-ps-link', 'data-projects-open-defaults': '',
                            onClick: () => { if (openDefaults()) dialog.close(); },
                        }, SETTINGS.openDefaults)] : null),
                ];
            }
            const project = data?.project;
            return h(ui.Modal, {
                open: true, title: SETTINGS.title, closeLabel: SETTINGS.close, className: 'dshp-ps', contentClassName: 'dshp-ps-content',
                onClose: () => dialog.close(),
                description: project ? h('span', { className: 'dshp-ps-sub', 'data-projects-settings': project.id },
                    h('span', null, '◆ ', h('b', null, project.name)),
                    // The folder by name, as DSH's session list shows it; the whole path on hover.
                    project.workspace ? h('span', { className: 'dshp-ps-path', title: project.workspace, 'data-projects-workspace': project.workspace },
                        ui.IconFolderCloseRegular ? h(ui.IconFolderCloseRegular, { size: 13, 'aria-hidden': true }) : null,
                        h('span', null, folderName(project.workspace))) : null) : undefined,
            }, body);
        }

        /** The dialog in DSH's overlay layer, mounted while a project's settings are open. */
        function ProjectSettingsOverlay({ dialog, link, facts, openDefaults, useSessionStatus, useSessions }) {
            const state = React.useSyncExternalStore(dialog.subscribe, dialog.getSnapshot);
            if (state.target === null) return null;
            return h(ProjectSettings, {
                key: `${state.target}\u0000${state.seq}`, target: state.target, pick: state.pick, link, facts, dialog, useSessionStatus, useSessions,
                openDefaults: openDefaults(false) ? openDefaults : undefined,
            });
        }

        /** "Project settings" in a project session's menu in the session list. */
        function SettingsMenuItem({ sessionId, useMenuOpenState, useSessions, dialog }) {
            const [, setMenuOpen] = useMenuOpenState();
            const project = useSessions((state) => valueIn(state, sessionId) !== undefined || isThreadRow(state, sessionId) || coordinatorName(state, sessionId) !== undefined);
            if (!project) return null;
            return h(ui.MenuItemButton, {
                icon: h(ui.IconSlidersTwoOutlineRegular, {}),
                onSelect: () => {
                    setMenuOpen(false);
                    dialog.open(sessionId);
                },
            }, SETTINGS.title);
        }

        function applySettings(ctx, dialog, link, facts) {
            /** DSH's Plugins page, at this plugin; false when this DSH can't open it. Called without `go`, it only asks. */
            const openDefaults = (go = true) => {
                let nav;
                try { nav = ctx.get?.('pluginNavigation'); } catch { nav = undefined; }
                if (!nav || typeof nav.openBundle !== 'function') return false;
                if (!go) return true;
                try { nav.openBundle(BUNDLE); return true; } catch { return false; }
            };
            ctx.slots.inject('shell.overlay', () => ctx.slots.register({
                name: 'shell.overlay', id: IDS.settings, inject: () => ({ dialog, link, facts, openDefaults }),
            }, ProjectSettingsOverlay));
            ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
                name: 'sidebar.workspaces.session.menu.item', id: IDS.settingsItem, order: 250, inject: () => ({ dialog }),
            }, SettingsMenuItem));
            ctx.effect(() => dialog.connect(), 'projects: project settings');
        }

        /** Required services (cordis inject); each part below waits for its own. */
        const inject = ['slots'];

        function apply(ctx) {
            const dialog = settingsDialog();
            // DSH's services the parts share, once DSH provides them: one model catalog and one link to the plugin.
            const bound = {};
            const bind = (name, then) => (scope) => scope.effect(() => {
                const service = scope[name];
                bound[name] = service;
                then?.();
                return () => { if (bound[name] === service) bound[name] = undefined; };
            }, `projects: ${name}`);
            const catalog = catalogSource(() => bound.remote);
            const link = hostLink(() => bound.connection, catalog);
            const facts = projectFacts(link);
            const sessionsOf = () => bound.sessions;
            ctx.inject(['remote', 'remote.session'], bind('remote', () => catalog.reset()));
            ctx.inject(['connection'], bind('connection'));
            ctx.inject(['sessions'], (scope) => {
                bind('sessions')(scope);
                // New threads on DSH's default name what the next one runs, after a pick anywhere changes it.
                scope.effect(() => followDefault(scope.sessions, catalog), 'projects: DSH default model');
            });
            ctx.inject(['configForms', 'remote', 'remote.session'], (scope) => applyDefaultsForm(scope, { catalog, link, dialog, sessionsOf }));
            ctx.inject(['connection', 'remote', 'remote.session'], (scope) => applySettings(scope, dialog, link, facts));
            ctx.inject(['sessions', 'uiWorkspace', 'sidebarRight'], (scope) => applyThreads(scope, dialog, { catalog, link, facts }));
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        // For the plugin's own tests: the pure helpers the views are built on.
        module.exports.internals = {
            valueIn, projectContext, threadRow, rowsOf, countsOf, summaryText, cardsOf, cardView, resolveLink, linkTarget, chatAddress, chatSessionOf, isThreadRow, ago, rowPlace, nestingRules,
            catalogView, catalogSource, picksIn, followDefault, ThreadRow, resolveRoute, effortNote, liveNote, settingsDialog, hostLink, errorText, noteText,
            selectionIn, selectionText, summaryModels, sourceLine, toldText, projectFacts, pausedText, withHeld, SUGGESTIONS,
            changesOf, changesText, lastChange, REVIEW_PREFIX,
            rowState, endingOf, endingIn, endingReason, endingLine, openSessions, markState, hoverLine, continueError, GROUPS,
        };
        return module.exports;
    },
});
