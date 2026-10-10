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
        const CSS = [
            // Default models form
            '.dshp-heading{margin:0 0 4px;font-size:14px;font-weight:600;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshp-section{display:flex;flex-direction:column;gap:2px;padding:12px 0}',
            '.dshp-section+.dshp-section{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-title{margin:0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}',
            '.dshp-hint,.dshp-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-note{padding-top:4px}',
            '.dshp-row{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-top:8px}',
            '.dshp-route{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px}',
            '.dshp-route-text{display:flex;flex-direction:column;gap:2px;flex:1 1 220px;min-width:0}',
            '.dshp-route-text .dshp-hint{margin:0}',
            '.dshp-route-note{color:var(--dsw-alias-label-secondary)}',
            '.dshp-route>.dshp-hint{flex:1 1 220px}',
            // Model picker: DSH's composer model menu, as a settings control
            '.dshp-mp{position:relative;display:inline-flex;flex:none;min-width:0;max-width:100%}',
            '.dshp-mp-trigger{display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;min-width:0;max-width:min(300px,100%);height:32px;padding:0 10px 0 12px;border:0;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary);white-space:nowrap;cursor:pointer}',
            '.dshp-mp-trigger:hover:not(:disabled),.dshp-mp-trigger[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-mp-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
            '.dshp-mp-trigger:disabled{cursor:default;opacity:.6}',
            '.dshp-mp-name{min-width:0;overflow:hidden;text-overflow:ellipsis}',
            '.dshp-mp-effort{flex-shrink:1000;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-caption)}',
            '.dshp-mp-trigger>svg,.dshp-mp-trigger>span:last-child:not(.dshp-mp-name):not(.dshp-mp-effort){flex:none;color:var(--dsw-alias-label-caption)}',
            '.dshp-mp-chev{transition:transform .12s}',
            '.dshp-mp-chev-open{transform:rotate(180deg)}',
            '.dshp-mp-menu{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;width:max-content;min-width:min(264px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:min(380px,calc(100vh - 96px));padding:4px;overflow:hidden;box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);color:var(--dsw-alias-label-primary);outline:none}',
            '.dshp-mp-cell,.dshp-mp-opt,.dshp-mp-back{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;border:0;border-radius:var(--dsw-radius-md);background:none;font:inherit;color:inherit;text-align:left;cursor:pointer;outline:none}',
            '.dshp-mp-cell{height:34px;padding:0 8px;font-size:13px;line-height:20px}',
            '.dshp-mp-cell:hover,.dshp-mp-cell:focus-visible,.dshp-mp-opt:hover:not(:disabled),.dshp-mp-opt:focus-visible,.dshp-mp-back:hover,.dshp-mp-back:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-mp-cell-label{flex:none;white-space:nowrap}',
            '.dshp-mp-cell-value{flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-mp-cell>svg{flex:none;color:var(--dsw-alias-menu-icon,var(--dsw-alias-label-tertiary))}',
            '.dshp-mp-back{height:28px;margin-bottom:2px;padding:0 7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-mp-back:hover,.dshp-mp-back:focus-visible{color:var(--dsw-alias-label-primary)}',
            '.dshp-mp-opt{min-height:34px;padding:5px 7px;font-size:13px;line-height:18px}',
            '.dshp-mp-opt:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}',
            '.dshp-mp-opt-copy{display:flex;flex-direction:column;flex:1;min-width:0}',
            '.dshp-mp-opt-name,.dshp-mp-opt-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-mp-opt-detail{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-mp-check{flex:0 0 14px;display:grid;place-items:center;color:var(--dsw-alias-label-primary)}',
            '.dshp-mp-check svg{width:14px;height:14px}',
            '.dshp-mp-sep{flex:none;height:.5px;margin:3px 7px;background:var(--dsw-alias-border-l2)}',
            '.dshp-mp-list{min-height:0;overflow-y:auto}',
            '.dshp-mp-search{position:relative;flex:none;margin:2px 0 3px}',
            '.dshp-mp-search .dshp-mp-search-box{display:flex;height:auto;padding:5px 7px;border:0 solid transparent;border-radius:var(--dsw-radius-md);background:none}',
            '.dshp-mp-search .dshp-mp-search-box:focus-within{border-color:transparent}',
            '.dshp-mp-search .dshp-mp-search-box input{padding:0;font-size:12px;line-height:normal}',
            '.dshp-mp-search .dshp-mp-search-box input::placeholder{color:var(--dsw-alias-label-caption)}',
            '.dshp-mp-search .dshp-mp-search-query{padding-right:34px}',
            '.dshp-mp-search-clear{position:absolute;top:50%;right:4px;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:none;color:var(--dsw-alias-label-secondary);cursor:pointer;transform:translateY(-50%)}',
            '.dshp-mp-search-clear:hover,.dshp-mp-search-clear:focus-visible{outline:none;background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-mp-empty{padding:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
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
            // Threads: session list rows. A thread row right under its coordinator (rowNesting) is indented so
            // its corner sits under the coordinator's ◆; a thread row anywhere else keeps a branch mark.
            '.dshp-t-mark{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-t-branch,[data-projects-nest] .dshp-t-corner{display:inline-flex}',
            '.dshp-t-corner,[data-projects-nest] .dshp-t-branch{display:none}',
            '[data-row-key][data-projects-nest]{padding-inline-start:calc(var(--dshp-nest,30px) + var(--dsh-workspace-indent,0px))}',
            '.dshp-t-hover{display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:16px;color:#cfd3d6}',
            '.dshp-t-hover-head{display:flex;align-items:center;gap:6px;color:#fff}',
            '.dshp-t-hover-line{color:#adb2b8;overflow-wrap:anywhere}',
            // Project settings dialog
            '.dshp-t-gear{padding:3px 5px}',
            '.dshp-t-pane-head{position:relative;padding-right:40px}',
            '.dshp-t-pane-gear{position:absolute;top:2px;right:6px}',
            '.dshp-ps.dshp-ps{width:min(560px,100%);max-height:100%}',
            '.dshp-ps-content{min-height:0;overflow-y:auto;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2)}',
            '.dshp-ps-sub{display:flex;flex-wrap:wrap;align-items:center;gap:2px 8px;min-width:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}',
            '.dshp-ps-sub b{font-weight:500;color:var(--dsw-alias-label-primary)}',
            '.dshp-ps-path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-ps-section+.dshp-ps-section{margin-top:22px}',
            '.dshp-ps-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 2px 8px}',
            '.dshp-ps-heading{margin:0;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary)}',
            '.dshp-ps-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}',
            '.dshp-ps-card{display:flex;flex-direction:column;border:.5px solid var(--dsw-alias-settings-card-stroke,var(--dsw-alias-border-l4));border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2))}',
            '.dshp-ps-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;box-sizing:border-box;min-height:60px;padding:12px 14px}',
            '.dshp-ps-row+.dshp-ps-row{border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshp-ps-text{display:flex;flex-direction:column;flex:1 1 220px;gap:2px;min-width:0}',
            '.dshp-ps-title{display:flex;align-items:center;gap:8px;min-width:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary)}',
            '.dshp-ps-title>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
            '.dshp-ps-title>.dshp-ps-dot{flex:none;display:inline-flex;align-items:center;justify-content:center;width:14px}',
            '.dshp-ps-title>.dshp-ps-id{flex:none;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-ps-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-source{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-ps-fit{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-own{display:inline-flex;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-own::before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-business-primary)}',
            '.dshp-ps-link{padding:0;border:0;background:none;font:inherit;color:var(--dsw-alias-label-secondary);text-decoration:underline;text-decoration-color:var(--dsw-alias-border-l4);text-underline-offset:2px;cursor:pointer}',
            '.dshp-ps-link:hover,.dshp-ps-link:focus-visible{outline:none;color:var(--dsw-alias-label-primary);text-decoration-color:currentColor}',
            '.dshp-ps-link:disabled{cursor:default;opacity:.6}',
            '.dshp-ps-alert{flex:1 0 100%;margin:0;padding:6px 8px;border-radius:var(--dsw-radius-sm);font-size:12px;line-height:18px}',
            '.dshp-ps-alert.dshp-ps-error{background:var(--dsw-alias-interactive-bg-hover-danger,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-state-error-primary)}',
            '.dshp-ps-alert.dshp-ps-info{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
            '.dshp-ps-empty{padding:16px 14px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-ps-more{display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;min-height:40px;padding:8px 14px;border:0;border-top:.5px solid var(--dsw-alias-border-l2);background:none;font:inherit;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);text-align:left;cursor:pointer;border-radius:0 0 var(--dsw-radius-xl) var(--dsw-radius-xl)}',
            '.dshp-ps-more:hover,.dshp-ps-more:focus-visible{outline:none;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}',
            '.dshp-ps-more svg{transition:transform .12s}',
            '.dshp-ps-more[aria-expanded=true] svg{transform:rotate(90deg)}',
            '.dshp-ps-note{margin:18px 2px 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-ps-state{display:flex;flex-direction:column;align-items:center;gap:10px;padding:36px 12px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
            '.dshp-ps-state.dshp-ps-error{color:var(--dsw-alias-state-error-primary)}',
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
         */
        function ModelPicker({ id, label, catalog, value, own, fallback, busy = false, disabled = false, onPick }) {
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
            settings: `${BUNDLE}/project-settings`,
            settingsItem: `${BUNDLE}/project-settings-item`,
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
            const openSettings = () => { change(false); projects.settings.open(sessionId); };
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
            h('div', { className: 'dshp-t-menu-body' },
                notice ?? h(ThreadList, {
                    rows, current: sessionId, now,
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
                info.roster !== null ? h('span', { className: 'dshp-t-count' }, summaryText(countsOf(rows))) : null,
                settingsOn ? h('span', { className: 'dshp-t-pane-gear' }, h(ui.Tooltip, { label: SETTINGS.title, side: 'bottom', align: 'end', portal: true },
                    h('button', {
                        type: 'button', className: 'dshp-t-icon', 'aria-label': SETTINGS.title, 'data-projects-settings-trigger': '',
                        onClick: () => projects.settings.open(sessionId),
                    }, h(ui.IconSlidersTwoOutlineRegular, { size: 14 })))) : null),
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

        /** A row's mark: a corner while it nests under its coordinator, a branch anywhere else (CSS picks). */
        function ThreadMark({ sessionId, useSessions, nesting }) {
            const thread = useSessions((state) => isThreadRow(state, sessionId));
            // Every idle row mounts this seat, so a list that comes back (the sidebar reopened) gets nested again.
            React.useLayoutEffect(() => { nesting?.soon(); }, [nesting, thread]);
            if (!thread) return null;
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

        /**
         * Which rows of DSH's session list sit under their coordinator. DSH
         * draws every session as a top-level row, in recency or manual order,
         * so a thread is under its coordinator only while the two are
         * neighbours: a thread row nests when the row right above it is its
         * coordinator, or a thread of the same coordinator that nests. Any
         * other row above (a workspace header, another session) ends the run.
         * @param state - DSH's session list state.
         * @param keys - the list's `data-row-key`s, top to bottom.
         * @returns for each thread row's key: whether it nests, its full title, and its title without "<project> › ".
         */
        function nestingPlan(state, keys) {
            const names = new Map();
            for (const id of Object.keys(state?.byId ?? {})) {
                const name = coordinatorName(state, id);
                if (name !== undefined && !names.has(name)) names.set(name, id);
            }
            const plan = new Map();
            let above;
            for (const key of keys) {
                const id = typeof key === 'string' && key.startsWith('session:') ? key.slice(8) : undefined;
                const value = valueIn(state, id);
                const title = typeof state?.byId?.[id]?.title === 'string' ? state.byId[id].title : '';
                const at = title.indexOf(' › ');
                let row;
                if (id !== undefined && (value?.role === 'coordinator' || (!value && coordinatorName(state, id) !== undefined))) {
                    row = { role: 'coordinator', of: id };
                } else if (id !== undefined && (value?.role === 'thread' || (!value && at > 0 && names.has(title.slice(0, at))))) {
                    const of = value && typeof value.coordinator === 'string' && value.coordinator !== '' ? value.coordinator : names.get(title.slice(0, at));
                    if (of !== undefined) {
                        const nested = above !== undefined && above.of === of && (above.role === 'coordinator' || above.nested);
                        const name = coordinatorName(state, of);
                        const prefix = name === undefined ? undefined : `${name} › `;
                        const short = prefix !== undefined && title.startsWith(prefix) && title.length > prefix.length ? title.slice(prefix.length) : undefined;
                        row = { role: 'thread', of, nested };
                        plan.set(key, { nested, full: title, short });
                    }
                }
                above = row;
            }
            return plan;
        }

        /**
         * Keeps DSH's session list showing threads under their coordinator.
         * After each change to the list's rows (a mutation observer on the
         * list) or to the session store, one pass over the rendered rows
         * applies nestingPlan: a nesting row gets `data-projects-nest`, which
         * the CSS indents, and its title loses the "<project> › " that the
         * coordinator above already says. It only sets that attribute and the
         * title's text, which React leaves alone until the title itself
         * changes, and it puts both back when the plugin stops.
         */
        function rowNesting(sessions) {
            const ATTR = 'data-projects-nest';
            /** Rows whose title shows our short text, with that text. */
            const shown = new WeakMap();
            let tree = null;
            let observer = null;
            let frame = 0;
            let queued = false;
            let running = false;
            let warned = false;

            const titleOf = (row) => {
                for (const el of row.children) {
                    if (typeof el.className === 'string' && /(?:^|\s)[\w-]*_title(?:\s|$)/.test(el.className)) return el;
                }
                return undefined;
            };
            /** The title's single text node, the only thing React renders there. */
            const textOf = (row) => {
                const span = titleOf(row);
                const node = span?.firstChild;
                return node && node === span.lastChild && node.nodeType === 3 ? node : undefined;
            };
            function show(row, entry) {
                const node = textOf(row);
                if (node === undefined) return;
                const mine = shown.get(row);
                const want = entry?.nested && entry.short !== undefined ? entry.short : undefined;
                if (want !== undefined) {
                    // Swap only what React wrote (the full title) or what we wrote before; anything else is DSH's own label.
                    if (node.nodeValue !== entry.full && node.nodeValue !== mine) return;
                    if (node.nodeValue !== want) node.nodeValue = want;
                    shown.set(row, want);
                } else if (mine !== undefined) {
                    if (node.nodeValue === mine && entry?.full) node.nodeValue = entry.full;
                    shown.delete(row);
                }
            }
            function watch() {
                const found = document.querySelector('[role="tree"] [data-row-key^="session:"]')?.closest('[role="tree"]') ?? null;
                if (found === tree) return;
                observer?.disconnect();
                tree = found;
                if (tree === null) return;
                observer ??= new MutationObserver(run);
                observer.observe(tree, { childList: true, subtree: true, characterData: true });
            }
            function pass(off) {
                const rows = tree === null ? [] : [...tree.querySelectorAll('[data-row-key]')];
                const state = sessions.list.getSnapshot();
                const plan = off ? new Map() : nestingPlan(state, rows.map((row) => row.getAttribute('data-row-key')));
                for (const row of rows) {
                    const key = row.getAttribute('data-row-key');
                    let entry = plan.get(key);
                    if (entry === undefined && shown.has(row)) {
                        const id = key?.startsWith('session:') ? key.slice(8) : undefined;
                        entry = { nested: false, full: state?.byId?.[id]?.title };
                    }
                    const nested = entry?.nested === true;
                    if (row.hasAttribute(ATTR) !== nested) row.toggleAttribute(ATTR, nested);
                    show(row, entry);
                }
            }
            function run() {
                if (!running) return;
                try {
                    watch();
                    pass(false);
                } catch (error) {
                    if (!warned) console.warn(`[projects] could not nest thread rows: ${error?.message ?? error}`);
                    warned = true;
                }
            }
            return {
                /** Nest before the next paint (rows just mounted). */
                soon() {
                    if (queued || !running) return;
                    queued = true;
                    queueMicrotask(() => { queued = false; run(); });
                },
                start() {
                    running = true;
                    const unsubscribe = sessions.list.subscribe(() => {
                        if (frame !== 0 || !running) return;
                        frame = requestAnimationFrame(() => { frame = 0; run(); });
                    });
                    run();
                    return () => {
                        running = false;
                        unsubscribe();
                        if (frame !== 0) cancelAnimationFrame(frame);
                        frame = 0;
                        observer?.disconnect();
                        try { pass(true); } catch {}
                        tree = null;
                    };
                },
            };
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
        function threadsApi(ctx, dialog = settingsDialog()) {
            const warn = (what, error) => { console.warn(`[projects] ${what}: ${error?.message ?? error}`); };
            const openSession = (sessionId) => {
                if (typeof sessionId !== 'string' || sessionId === '') return;
                try { ctx.uiWorkspace.openSession(sessionId); } catch (error) { warn('could not open the session', error); }
            };
            const failed = new Set();
            return {
                openSession,
                /** The Project settings dialog, for the entry points. */
                settings: dialog,
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

        function applyThreads(ctx, dialog) {
            const projects = threadsApi(ctx, dialog);
            const withApi = () => ({ projects });
            ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
                name: 'conversation.session.header.actions', id: IDS.menu, order: -25, inject: withApi,
            }, ThreadsMenu));
            ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
                name: 'conversation.chat.turnTail', id: IDS.cards, order: 30, inject: withApi,
            }, ThreadCards));
            const nesting = rowNesting(ctx.sessions);
            ctx.effect(() => nesting.start(), 'projects: threads under their coordinator in the session list');
            ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
                name: 'sidebar.session.row.leading', id: IDS.mark, order: 20, inject: () => ({ nesting }),
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
            pauseHint: 'New threads wait and handbacks are held until you resume.',
            own: 'Set for this project',
            useDefault: 'Use default',
            running: 'Running. A change applies from its next request.',
            resolved: 'Resolved.',
            note: 'Projects that don\'t choose their own models use the plugin\'s Default models, in Settings → Plugins → dsh-plugin-projects.',
        };
        const SETTING_ROUTES = [
            { id: 'coordinator', title: 'Coordinator', hint: 'The ◆ session you talk to. A model you pick in its chat lands here too.', model: 'coordinatorModel', effort: 'coordinatorEffort' },
            { id: 'thread', title: 'New threads', hint: 'What each new thread starts on. Running threads keep theirs.', model: 'threadModel', effort: 'threadEffort' },
        ];
        /** Where an inherited value comes from, in the pickers' Default rows and under a row. */
        const SOURCE_LABELS = { 'project setting': 'This project', 'project config': 'Your profile', 'plugin default': 'Plugin default', 'DSH default': 'DSH default' };
        const SOURCE_CAPTIONS = { 'project config': 'From this project\'s row in your profile', 'plugin default': 'Plugin default', 'DSH default': 'DSH default: the model last picked in any DSH chat' };

        /**
         * Which project the dialog shows, if any. Any part of the window opens
         * it with a session (or project) id; the dialog part, once its DSH
         * services are there, marks it available so the entry points show.
         */
        function settingsDialog() {
            let snapshot = { target: null, seq: 0, available: false };
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
                open(target) {
                    if (typeof target === 'string' && target !== '' && snapshot.available) set({ target, seq: snapshot.seq + 1 });
                },
                close() {
                    if (snapshot.target !== null) set({ target: null });
                },
                connect() {
                    set({ available: true });
                    return () => set({ available: false, target: null });
                },
            };
        }
        const useSettingsAvailable = (dialog) => React.useSyncExternalStore(dialog.subscribe, () => dialog.getSnapshot().available);

        /** The plugin's endpoints (remote.js) and DSH's model catalog, over the window's own connection. */
        function hostLink(ctx) {
            return {
                catalog: catalogSource(ctx),
                async call(method, args) {
                    try {
                        const result = await ctx.connection.rpc.call('/api', `${BUNDLE}/${method}`, { args });
                        if (isObject(result) && (result.ok === true || (result.ok === false && isObject(result.error)))) return result;
                        return { ok: false, error: { code: 'projects/unreadable', message: 'The plugin sent an answer this window can\'t read.' } };
                    } catch (error) {
                        return { ok: false, error: { code: 'projects/unreachable', message: String(error?.message ?? error) } };
                    }
                },
            };
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

        function SettingRow({ id, lead, title, tag, description, source, note, control, message }) {
            return h('div', { className: 'dshp-ps-row', 'data-projects-setting': id },
                h('div', { className: 'dshp-ps-text' },
                    h('div', { className: 'dshp-ps-title' },
                        lead ?? null,
                        h('span', null, title),
                        tag ? h('span', { className: 'dshp-ps-id' }, tag) : null),
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
        function ProjectSettings({ target, link, dialog, useSessionStatus }) {
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
            const read = React.useCallback(async () => {
                const seq = ++reads.current;
                const result = await link.call('describe', { target });
                if (!alive.current || seq !== reads.current) return;
                if (result.ok && isObject(result.value) && isObject(result.value.settings)) {
                    setData(result.value);
                    setFailure(null);
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
                if (isObject(result.value) && isObject(result.value.settings)) setData(result.value);
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
                        : [h('span', { key: 'from' }, SOURCE_CAPTIONS[m.source === 'DSH default' ? e.source : m.source] ?? '')];
                    return h(SettingRow, {
                        key: route.id, id: route.id, title: route.title, description: route.hint, source, message: messageFor(route.id),
                        note: notesFor(shown, route.id === 'coordinator' ? data.project?.live : undefined, own.effort),
                        control: h(ModelPicker, {
                            id: `dshp-ps-${route.id}`, label: route.title, catalog: catalog.value, busy: busy === route.id, disabled,
                            value: { model: m.value, effort: e.value }, own,
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
                    // The same states as the Threads menu: a thread that asked for a decision waits on you.
                    const asks = t.handback === 'needs_decision' || t.handback === 'blocked';
                    const dot = t.resolved ? 'done' : status?.pendingInteraction || (!running && asks) ? 'warning'
                        : running ? 'ongoing' : t.handback === 'done' ? 'done' : 'idle';
                    return h(SettingRow, {
                        key, id: key, title: t.title || t.id, tag: t.id, message: messageFor(key),
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
                    h('p', { key: 'note', className: 'dshp-ps-note' }, SETTINGS.note),
                ];
            }
            const project = data?.project;
            return h(ui.Modal, {
                open: true, title: SETTINGS.title, closeLabel: SETTINGS.close, className: 'dshp-ps', contentClassName: 'dshp-ps-content',
                onClose: () => dialog.close(),
                description: project ? h('span', { className: 'dshp-ps-sub', 'data-projects-settings': project.id },
                    h('span', null, '◆ ', h('b', null, project.name)),
                    project.workspace ? h('span', { className: 'dshp-ps-path', title: project.workspace }, project.workspace) : null) : undefined,
            }, body);
        }

        /** The dialog in DSH's overlay layer, mounted while a project's settings are open. */
        function ProjectSettingsOverlay({ dialog, link, useSessionStatus }) {
            const state = React.useSyncExternalStore(dialog.subscribe, dialog.getSnapshot);
            if (state.target === null) return null;
            return h(ProjectSettings, { key: `${state.target}\u0000${state.seq}`, target: state.target, link, dialog, useSessionStatus });
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

        function applySettings(ctx, dialog) {
            const link = hostLink(ctx);
            ctx.slots.inject('shell.overlay', () => ctx.slots.register({
                name: 'shell.overlay', id: IDS.settings, inject: () => ({ dialog, link }),
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
            ctx.inject(['configForms', 'remote', 'remote.session'], (scope) => applyDefaultsForm(scope));
            ctx.inject(['connection', 'remote', 'remote.session'], (scope) => applySettings(scope, dialog));
            ctx.inject(['sessions', 'uiWorkspace', 'sidebarRight'], (scope) => applyThreads(scope, dialog));
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        // For the plugin's own tests: the pure helpers the views are built on.
        module.exports.internals = {
            valueIn, projectContext, threadRow, rowsOf, countsOf, summaryText, cardsOf, cardView, resolveLink, linkTarget, chatAddress, chatSessionOf, isThreadRow, ago, nestingPlan,
            catalogView, resolveRoute, effortNote, liveNote, settingsDialog, hostLink, errorText, noteText,
        };
        return module.exports;
    },
});
