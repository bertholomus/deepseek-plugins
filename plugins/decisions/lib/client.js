/**
 * dsh-plugin-decisions, browser half: Decisions' page in DSH's sidebar.
 *
 * - The entry in DSH's panel list (`sidebar.panellist`, order 2), with the
 *   count of what waits on you, and its page in `main`.
 * - The page: everything waiting on you, most urgent first (what holds a
 *   running turn), each card with its question, the agent's recommendation,
 *   the session (one click opens it) and how long it has waited, and the
 *   controls its kind takes: Allow once or Reject, the question box's
 *   choices, an answer in words or the recommendation, or a plugin's own
 *   options. Then what you dismissed, and what happened (new cards, your
 *   answers and whether the session got them, what went elsewhere). When
 *   Decisions cannot work it says why and what to do: Session Watch is off,
 *   Decisions is not running, or a setting is wrong.
 * - Its settings on its page in Plugins (DSH's `plugins.bundle.config`),
 *   saved through DSH's own settings form; the webhook address goes to
 *   DSH's key store, never the settings file.
 *
 * Hand-written in the module format DSH serves to the browser (no build
 * step). Nothing here may throw at load: DSH joins every plugin's browser
 * half into one script, and one error would stop the others.
 *
 * @module dsh-plugin-decisions/client
 */
// DSH serves browser halves in one script; never throw here, or the others stop loading too.
if (typeof window !== 'undefined' && window.__ModuleLoader__) window.__ModuleLoader__.load({
    id: 'dsh-plugin-decisions',
    factory: (require) => {
        const module = { exports: {} };
        Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' });
        const React = require('react');
        const ui = require('@deepseek-ai/dsh-client-ui-primitives');
        const h = React.createElement;

        // <suite-kit>
// The suite's window kit (source: shared/client-kit.js; copied by scripts/sync-shared.mjs, checked by npm test).
function suiteKit({ prefix: P, bundle, React, ui, h }) {
    const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
    const win = typeof window === 'undefined' ? undefined : window;
    const doc = typeof document === 'undefined' ? undefined : document;

    const css = [
        `:is(.${P}-page,.${P}-pane,.${P}-pop){--${P}-glass:rgba(14,18,17,var(--wp-tint,.55));--${P}-conv:rgba(10,13,12,calc(var(--wp-tint,.55) + .2));--${P}-fill:rgba(255,255,255,.04);--${P}-text-2:color-mix(in srgb,var(--dsw-alias-label-secondary) 80%,var(--dsw-alias-label-primary));--${P}-glyph:color-mix(in srgb,var(--dsw-alias-label-tertiary) 75%,var(--dsw-alias-label-primary));--${P}-error:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary));--${P}-link:color-mix(in srgb,var(--dsw-alias-link,var(--dsw-alias-state-business-primary)) 85%,var(--dsw-alias-label-primary));--${P}-ok:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary));--${P}-warn:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 55%,var(--dsw-alias-label-primary));--${P}-ring:var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}`,
        `body:not([data-ds-dark-theme]) :is(.${P}-page,.${P}-pane,.${P}-pop){--${P}-glass:rgba(250,250,246,var(--wp-tint,.55));--${P}-conv:rgba(250,250,246,calc(var(--wp-tint,.55) + .2));--${P}-fill:rgba(20,26,22,.035)}`,
        `@media (prefers-reduced-transparency:reduce){:is(.${P}-page,.${P}-pane,.${P}-pop){--${P}-glass:rgba(14,18,17,.9);--${P}-conv:rgba(10,13,12,.95)}body:not([data-ds-dark-theme]) :is(.${P}-page,.${P}-pane,.${P}-pop){--${P}-glass:rgba(250,250,246,.9);--${P}-conv:rgba(250,250,246,.95)}}`,
        `.${P}-page{box-sizing:border-box;height:100%;overflow:auto;padding:12px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}`,
        `[data-platform=darwin] .${P}-page{padding-top:calc(12px + var(--dsh-frame-top-clearance,0px))}`,
        `.${P}-stack{display:flex;flex-direction:column;gap:12px;max-width:1040px;margin:0 auto;min-width:0}`,
        `.${P}-card{box-sizing:border-box;min-width:0;background:var(--${P}-glass);-webkit-backdrop-filter:blur(var(--wp-blur,22px)) saturate(140%);backdrop-filter:blur(var(--wp-blur,22px)) saturate(140%);border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-lg);padding:14px 16px}`,
        `.${P}-card.${P}-main{background:var(--${P}-conv)}`,
        `.${P}-card .${P}-card{background:var(--${P}-fill);-webkit-backdrop-filter:none;backdrop-filter:none}`,
        `.${P}-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}`,
        `.${P}-head-text{min-width:0;flex:1 1 240px}`,
        `.${P}-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}`,
        `.${P}-h1{margin:0;font:var(--dsw-font-l-20);color:var(--dsw-alias-label-primary)}`,
        `.${P}-h2{margin:0;font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}`,
        `.${P}-sub{margin:2px 0 0;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
        `.${P}-note{margin:8px 0 0;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
        `.${P}-num{font-variant-numeric:tabular-nums}`,
        `.${P}-list{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column}`,
        `.${P}-item{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1);min-width:0}`,
        `.${P}-item:first-child{border-top:0}`,
        `.${P}-item-main{min-width:0;flex:1 1 auto}`,
        `.${P}-item-side{flex:0 0 auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end}`,
        `.${P}-title{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}`,
        `.${P}-meta{margin-top:2px;font:var(--dsw-font-xs-13);color:var(--${P}-text-2);overflow-wrap:anywhere}`,
        `.${P}-why{margin-top:4px;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
        `.${P}-quote{margin:6px 0 0;padding:8px 10px;border-radius:var(--dsw-radius-sm);background:var(--${P}-fill);font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere}`,
        `.${P}-link{padding:0;border:0;background:none;font:inherit;color:var(--${P}-link);text-decoration:underline;text-underline-offset:2px;cursor:pointer;text-align:left;overflow-wrap:anywhere}`,
        `.${P}-error{color:var(--${P}-error)}`,
        `.${P}-ok{color:var(--${P}-ok)}`,
        `.${P}-alert{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 0;font:var(--dsw-font-xs-13);color:var(--${P}-error)}`,
        `.${P}-empty{padding:18px 4px;text-align:left}`,
        `.${P}-empty-title{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}`,
        `.${P}-empty-text{margin:4px 0 0;font:var(--dsw-font-xs-13);color:var(--${P}-text-2);max-width:60ch}`,
        `.${P}-loading{padding:18px 4px;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
        `.${P}-loading::after{content:"";display:inline-block;width:1.2em;text-align:left;animation:${P}-dots 1.2s steps(4,end) infinite}`,
        `@keyframes ${P}-dots{0%{content:""}25%{content:"."}50%{content:".."}75%{content:"..."}}`,
        `.${P}-page :is(button,a,input,select,textarea,[tabindex]):focus-visible,.${P}-pane :is(button,a,input,select,textarea,[tabindex]):focus-visible{outline:2px solid var(--${P}-ring);outline-offset:1px;border-radius:var(--dsw-radius-xs)}`,
        `.${P}-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,
        `.${P}-glyph{color:var(--${P}-glyph)}`,
        `.${P}-badge{position:absolute;top:-5px;right:-7px;min-width:14px;height:14px;padding:0 3px;box-sizing:border-box;border-radius:7px;background:var(--dsw-alias-state-error-primary);color:#fff;font:600 10px/14px var(--dsw-font-family,system-ui);font-variant-numeric:tabular-nums;text-align:center}`,
        `.${P}-icon{position:relative;display:inline-flex;align-items:center;justify-content:center}`,
        `.${P}-trouble-title{margin:10px 0 0;font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}`,
        `.${P}-trouble-text{margin:4px 0 0;font:var(--dsw-font-xs-13);color:var(--${P}-text-2);max-width:68ch}`,
        `.${P}-trouble .${P}-actions{margin-top:10px}`,
        `.${P}-settings{display:flex;flex-direction:column;gap:0;min-width:0;color:var(--dsw-alias-label-primary)}`,
        `.${P}-set-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0;border-top:.5px solid var(--dsw-alias-border-l2);min-width:0}`,
        `.${P}-set-row:first-child{border-top:0}`,
        `.${P}-set-text{min-width:0;flex:1 1 auto}`,
        `.${P}-set-title{font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary)}`,
        `.${P}-set-hint{margin-top:2px;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary)}`,
        `.${P}-set-control{flex:0 0 auto;display:flex;align-items:center;gap:10px}`,
        `.${P}-set-reset{padding:0;border:0;background:none;font:var(--dsw-font-xs-13);color:var(--dsw-alias-link,var(--dsw-alias-state-business-primary));text-decoration:underline;text-underline-offset:2px;cursor:pointer}`,
        `.${P}-set-reset:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px;border-radius:var(--dsw-radius-xs)}`,
        `.${P}-set-note{margin:10px 0 0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);max-width:72ch}`,
        `.${P}-set-group{margin:14px 0 2px;font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-secondary)}`,
        `.${P}-set-error{margin:4px 0 0;font:var(--dsw-font-xs-13);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary))}`,
        `@media (max-width:560px){.${P}-set-row{flex-wrap:wrap}.${P}-set-control{width:100%;justify-content:flex-start}}`,
        `body.wp-still :is(.${P}-page,.${P}-pane,.${P}-pop),body.wp-still :is(.${P}-page,.${P}-pane,.${P}-pop)::before,body.wp-still :is(.${P}-page,.${P}-pane,.${P}-pop)::after,body.wp-still :is(.${P}-page,.${P}-pane,.${P}-pop) *,body.wp-still :is(.${P}-page,.${P}-pane,.${P}-pop) *::before,body.wp-still :is(.${P}-page,.${P}-pane,.${P}-pop) *::after{animation:none!important;transition:none!important}`,
        `@media (prefers-reduced-motion:reduce){:is(.${P}-page,.${P}-pane,.${P}-pop),:is(.${P}-page,.${P}-pane,.${P}-pop)::before,:is(.${P}-page,.${P}-pane,.${P}-pop)::after,:is(.${P}-page,.${P}-pane,.${P}-pop) *,:is(.${P}-page,.${P}-pane,.${P}-pop) *::before,:is(.${P}-page,.${P}-pane,.${P}-pop) *::after{animation:none!important;transition:none!important}}`,
    ];

    /** Append the plugin's one style sheet to <head>, once: the kit's rules and the plugin's own. */
    function injectStyle(own = [], target = doc) {
        if (!target?.head || target.querySelector(`style[data-plugin="${bundle}"]`)) return;
        const style = target.createElement('style');
        style.setAttribute('data-plugin', bundle);
        style.setAttribute('data-plugin-css', `${bundle}/client.css`);
        style.textContent = [...css, ...own].join('\n');
        target.head.appendChild(style);
    }

    /** Remove the plugin's style sheet (the plugin is switched off). */
    function removeStyle(target = doc) {
        target?.querySelector?.(`style[data-plugin="${bundle}"]`)?.remove();
    }

    /** The window's DSH connection, as the plugin's parts receive it. */
    const connections = { current: undefined, waiting: new Set() };
    function setConnection(connection) {
        connections.current = connection;
        if (connection) for (const done of [...connections.waiting]) done(connection);
    }
    function whenConnected(ms = 10000) {
        if (connections.current) return Promise.resolve(connections.current);
        return new Promise((resolve) => {
            const done = (value) => {
                connections.waiting.delete(done);
                clearTimeout(timer);
                resolve(value);
            };
            const timer = setTimeout(() => done(connections.current), ms);
            connections.waiting.add(done);
        });
    }

    /** DSH's gateway answers 404 for a plugin whose host half is not running (switched off, or it needs a plugin that is). */
    const missing = (text) => /\b404\b/.test(text);

    /**
     * A plugin's endpoints over DSH's connection: `call(method, args)` gives
     * `{ ok, value }` or `{ ok: false, error: { code, message } }`, the
     * message in words. Code `not-running`: DSH runs no such plugin now.
     */
    function link(namespace, { name = 'This plugin' } = {}) {
        const notRunning = { ok: false, error: { code: 'not-running', message: `${name} is not running in DSH.` } };
        return {
            async call(method, args = {}) {
                const connection = connections.current ?? await whenConnected();
                if (!connection) return { ok: false, error: { code: 'unreachable', message: 'This window is not connected to DSH yet.' } };
                let result;
                try {
                    result = await connection.rpc.call('/api', `${namespace}/${method}`, { args });
                } catch (error) {
                    if (missing(String(error?.message ?? error))) return notRunning;
                    return { ok: false, error: { code: 'unreachable', message: 'DSH did not answer. Check that DSH is still running, then try again.' } };
                }
                // A plugin's own refusals carry its code ("autopilot/refused"); the gateway's transport failures do not.
                if (isRecord(result) && result.ok === false && isRecord(result.error) && !String(result.error.code ?? '').includes('/') && missing(String(result.error.message ?? ''))) return notRunning;
                return isRecord(result) && (result.ok === true || (result.ok === false && isRecord(result.error))) ? result
                    : { ok: false, error: { code: 'unreadable', message: `${name} sent an answer this window cannot read. Reload the window.` } };
            },
            /** The value, or a thrown Error with the plugin's words (and its `code`). */
            async read(method, args) {
                const result = await this.call(method, args);
                if (result.ok) return result.value;
                throw Object.assign(new Error(result.error?.message || `${name} did not answer.`), { code: result.error?.code });
            },
        };
    }

    // ── DSH's Plugins page ────────────────────────────────────────────
    const nav = { current: undefined };
    /** DSH's `pluginNavigation` service, as the plugin's parts receive it. */
    function setNavigation(service) {
        nav.current = service;
    }
    /** Whether this DSH can open a plugin's page in Plugins (draw a button for it only then). */
    const canOpenPlugin = () => typeof nav.current?.openBundle === 'function';
    /** Open a plugin's page in DSH's Plugins page (its switch and its settings); false when this DSH cannot. */
    function openPlugin(packageName) {
        try {
            if (typeof nav.current?.openBundle !== 'function') return false;
            nav.current.openBundle(packageName);
            return true;
        } catch {
            return false;
        }
    }

    // ── One open request per window, for every suite plugin ───────────
    const HUB_KEY = 'dsh-plugin-session-watch/hub/v1';
    const HUB_NS = 'dsh-plugin-session-watch';

    function createHub() {
        const state = { providers: new Set(), subs: new Set(), since: undefined, running: false, failures: 0 };
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const hidden = () => Boolean(doc && doc.visibilityState === 'hidden');
        const visible = () => new Promise((resolve) => {
            if (!doc || !hidden()) return resolve();
            const on = () => {
                if (hidden()) return;
                doc.removeEventListener('visibilitychange', on);
                resolve();
            };
            doc.addEventListener('visibilitychange', on);
        });
        const connection = () => {
            for (const provider of state.providers) {
                try {
                    const c = provider();
                    if (c) return c;
                } catch { /* a plugin that left gives none */ }
            }
            return undefined;
        };
        const notify = (changed) => {
            for (const sub of [...state.subs]) {
                if (changed === 'all' || sub.channels.some((channel) => changed.has(channel))) {
                    try { sub.fn(); } catch { /* one window part never stops the others */ }
                }
            }
        };
        async function loop() {
            if (state.running) return;
            state.running = true;
            try {
                while (state.subs.size > 0) {
                    if (hidden()) {
                        await visible();
                        // Back in view: everything may have moved.
                        notify('all');
                        continue;
                    }
                    const c = connection();
                    if (!c) {
                        await sleep(1000);
                        continue;
                    }
                    let result;
                    try {
                        result = await c.rpc.call('/api', `${HUB_NS}/wait`, { args: { since: state.since, timeoutMs: 25000 } });
                    } catch {
                        result = undefined;
                    }
                    if (isRecord(result) && result.ok === true && isRecord(result.value)) {
                        const next = result.value;
                        const prev = state.since;
                        state.since = next;
                        state.failures = 0;
                        if (!prev || prev.epoch !== next.epoch) notify('all');
                        else {
                            const changed = new Set();
                            const was = prev.versions ?? {};
                            for (const [channel, n] of Object.entries(next.versions ?? {})) if ((was[channel] ?? 0) !== n) changed.add(channel);
                            if (changed.size) notify(changed);
                        }
                        continue;
                    }
                    // The watcher is not running (or failed): read on a slow timer instead, and keep trying.
                    state.failures += 1;
                    notify('all');
                    await sleep(Math.min(30000, 2000 * 2 ** Math.min(state.failures, 4)));
                }
            } finally {
                state.running = false;
            }
        }
        return {
            /** A plugin offers its connection; the hub uses any one that works. */
            attach(provider) {
                state.providers.add(provider);
                return () => state.providers.delete(provider);
            },
            /** Call `fn` when any of `channels` moves (and once at the start). */
            subscribe(channels, fn) {
                const sub = { channels, fn };
                state.subs.add(sub);
                void loop();
                return () => state.subs.delete(sub);
            },
            get since() { return state.since; },
        };
    }

    function sharedHub() {
        const scope = win ?? globalThis;
        if (!scope[HUB_KEY]) scope[HUB_KEY] = createHub();
        return scope[HUB_KEY];
    }

    const hub = {
        attach: () => sharedHub().attach(() => connections.current),
        subscribe: (channels, fn) => sharedHub().subscribe(channels, fn),
    };

    /**
     * Data from `read`, read again whenever the hub moves on one of `channels`
     * (gathered over `delayMs`). A failed read keeps the last good data and
     * says so in `error`.
     */
    function useLive(read, channels, { delayMs = 250 } = {}) {
        const [state, setState] = React.useState({ data: undefined, error: undefined, code: undefined, loading: true });
        const readRef = React.useRef(read);
        readRef.current = read;
        const timer = React.useRef(undefined);
        const alive = React.useRef(true);
        const refresh = React.useCallback(async () => {
            try {
                const data = await readRef.current();
                if (alive.current) setState({ data, error: undefined, code: undefined, loading: false });
            } catch (error) {
                if (alive.current) setState((s) => ({ data: s.data, error: String(error?.message ?? error), code: typeof error?.code === 'string' ? error.code : undefined, loading: false }));
            }
        }, []);
        const key = channels.join(',');
        React.useEffect(() => {
            alive.current = true;
            void refresh();
            const off = hub.subscribe(channels, () => {
                clearTimeout(timer.current);
                timer.current = setTimeout(() => { void refresh(); }, delayMs);
            });
            return () => {
                alive.current = false;
                clearTimeout(timer.current);
                off();
            };
        }, [key]);
        return { ...state, refresh };
    }

    // ── Words ─────────────────────────────────────────────────────────
    const clock = (at) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

    /** "9:41 PM" today, "yesterday 9:41 PM", else "Oct 3, 9:41 PM". */
    function timeText(at, now = Date.now()) {
        if (!Number.isFinite(at) || at <= 0) return '';
        const when = new Date(at);
        if (sameDay(when, new Date(now))) return clock(at);
        if (sameDay(when, new Date(now - 86400000))) return `yesterday ${clock(at)}`;
        return `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${clock(at)}`;
    }

    /** "just now", "4 min ago", "2 h ago", then the date. */
    function agoText(at, now = Date.now()) {
        if (!Number.isFinite(at) || at <= 0) return '';
        const s = Math.round((now - at) / 1000);
        if (s < 45) return 'just now';
        const m = Math.round(s / 60);
        if (m < 60) return `${m} min ago`;
        const hrs = Math.round(m / 60);
        if (hrs < 24) return `${hrs} h ago`;
        return timeText(at, now);
    }

    /** A length of time in words: "5 seconds", "1 minute", "10 minutes", "2 hours", "1.5 hours". */
    function spanText(seconds) {
        const n = Number(seconds);
        if (!Number.isFinite(n) || n < 0) return '';
        const unit = (value, word) => `${value} ${word}${value === 1 ? '' : 's'}`;
        if (n < 60) return unit(Math.round(n), 'second');
        if (n < 3600) return unit(Math.round(n / 60), 'minute');
        const hours = Math.round(n / 360) / 10;
        return unit(hours, 'hour');
    }

    /** DSH's tag tone for one of the suite's state words. */
    function toneOf(word) {
        switch (word) {
            case 'running': case 'working': case 'queued': case 'in the queue': case 'sending': case 'starting': case 'waiting for a round': return 'info';
            case 'waiting for approval': case 'waiting on you': case 'needs a decision': case 'asked you': case 'asks you': case 'cut off': case 'cut short': case 'backed off': case 'gave up': case 'held': case 'not confirmed': case 'waiting on a setting': return 'warning';
            case 'failed': case 'blocked': case 'not delivered': case 'not started': case 'not sent': return 'danger';
            case 'delivered': case 'started': case 'done': case 'answered': case 'read': case 'sent': return 'success';
            case 'stopped': case 'paused': return 'neutral';
            default: return 'quiet';
        }
    }

    // ── Parts ─────────────────────────────────────────────────────────

    /** A page the plugin owns in DSH's main view: unpainted root, glass cards inside. */
    function Page({ label, children, attrs = {} }) {
        return h('section', { className: `${P}-page`, 'aria-label': label, ...attrs }, h('div', { className: `${P}-stack` }, children));
    }

    /** A glass card; `main` for the card people read (tint + .2). */
    function Card({ title, sub, actions, main = false, children, className = '', attrs = {}, headingLevel = 2 }) {
        const heading = title ? h(headingLevel === 1 ? 'h1' : 'h2', { className: headingLevel === 1 ? `${P}-h1` : `${P}-h2` }, title) : null;
        return h('section', { className: `${P}-card${main ? ` ${P}-main` : ''}${className ? ` ${className}` : ''}`, ...(title ? { 'aria-label': typeof title === 'string' ? title : undefined } : {}), ...attrs },
            title || sub || actions ? h('div', { className: `${P}-head` },
                h('div', { className: `${P}-head-text` }, heading, sub ? h('p', { className: `${P}-sub` }, sub) : null),
                actions ? h('div', { className: `${P}-actions` }, actions) : null) : null,
            children);
    }

    /** An empty state that says what it means and what to do next. */
    function Empty({ title, text, action }) {
        return h('div', { className: `${P}-empty`, role: 'status' },
            h('div', { className: `${P}-empty-title` }, title),
            text ? h('p', { className: `${P}-empty-text` }, text) : null,
            action ? h('div', { style: { marginTop: '10px' } }, action) : null);
    }

    /** "Couldn't refresh: …  Retry": the old data stays on screen above it. */
    function ErrorLine({ text, onRetry, lead = 'Couldn\'t refresh' }) {
        return h('div', { className: `${P}-alert`, role: 'alert' },
            h('span', null, `${lead}: ${text}`),
            onRetry ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: onRetry }, 'Retry') : null);
    }

    function Loading({ text = 'Loading' }) {
        return h('div', { className: `${P}-loading`, role: 'status', 'aria-live': 'polite' }, text);
    }

    /** A state in words, in DSH's tag. */
    function StateTag({ word }) {
        return h(ui.Tag, { tone: toneOf(word) }, word);
    }

    /** A time as "4 min ago", with the full time on hover and for screen readers. */
    function TimeText({ at, now }) {
        if (!Number.isFinite(at) || at <= 0) return null;
        const full = new Date(at).toLocaleString();
        return h('time', { className: `${P}-num`, dateTime: new Date(at).toISOString(), title: full }, agoText(at, now));
    }

    // ── States every suite page shares ────────────────────────────────

    const WATCH_PACKAGE = 'dsh-plugin-session-watch';
    const watchLink = link(WATCH_PACKAGE, { name: 'Session Watch' });

    /**
     * What the page shows when its plugin cannot be read: not running (with
     * why: the Session Watch it needs is off, or the plugin itself stopped)
     * or DSH not answering. Each says what to do next, with a button to the
     * place to do it; the page comes back by itself once the plugin runs.
     */
    function Trouble({ name, packageName, code, text, onRetry, needsWatch = true }) {
        const [watchUp, setWatchUp] = React.useState(undefined);
        React.useEffect(() => {
            if (code !== 'not-running' || !needsWatch) return undefined;
            let alive = true;
            void watchLink.call('status').then((result) => { if (alive) setWatchUp(result.ok || result.error?.code !== 'not-running'); });
            return () => { alive = false; };
        }, [code, needsWatch, text]);
        const button = (label, target) => (typeof nav.current?.openBundle === 'function'
            ? h(ui.Button, { variant: 'primary', size: 'sm', onClick: () => openPlugin(target) }, label) : null);
        const retry = onRetry ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: onRetry }, 'Check again') : null;
        let kind;
        let title;
        let next;
        let action = null;
        if (code === 'not-running' && needsWatch && watchUp === false) {
            kind = 'watch-off';
            title = `${name} needs Session Watch, which is not running.`;
            next = `Switch Session Watch on in Plugins. This page comes back by itself once it runs.`;
            action = button('Open Session Watch in Plugins', WATCH_PACKAGE);
        } else if (code === 'not-running') {
            kind = 'not-running';
            title = `${name} is not running.`;
            next = `Open ${name} in Plugins and switch it off and on again. If it still does not start, restart DSH.`;
            action = button(`Open ${name} in Plugins`, packageName);
        } else {
            kind = 'unreachable';
            title = `Couldn't read ${name}.`;
            next = text || 'DSH did not answer. Check that DSH is still running, then try again.';
        }
        return h('div', { className: `${P}-trouble`, role: 'alert', 'data-suite-trouble': kind },
            h('p', { className: `${P}-trouble-title` }, title),
            h('p', { className: `${P}-trouble-text` }, next),
            h('div', { className: `${P}-actions` }, action, retry));
    }

    /**
     * A setting is wrong, so the plugin does no work: which setting, what it
     * must be, and where to change it (its settings in Plugins when the
     * person can change it there, else DSH's profile).
     */
    function SettingsProblem({ name, packageName, problem }) {
        const live = problem?.live === true;
        return h('div', { className: `${P}-trouble`, role: 'alert', 'data-suite-trouble': 'setting' },
            h('p', { className: `${P}-trouble-title` }, `${name} is waiting for a setting to be fixed.`),
            h('p', { className: `${P}-trouble-text` }, `${String(problem?.text ?? 'A setting is wrong').replace(/\.$/, '')}.`),
            h('p', { className: `${P}-trouble-text` }, live
                ? `Change it in ${name}'s settings in Plugins. ${name} starts working again as soon as you save.`
                : `Change it in ${name}'s entry in DSH's profile (cordis.patch.yml), then restart DSH.`),
            live && typeof nav.current?.openBundle === 'function'
                ? h('div', { className: `${P}-actions` }, h(ui.Button, { variant: 'primary', size: 'sm', onClick: () => openPlugin(packageName) }, `Open ${name}'s settings`)) : null);
    }

    // ── Settings on the plugin's page in Plugins ──────────────────────

    /**
     * How one setting turns from its stored value into the text its control
     * shows, and back. A draft the setting cannot take (a number out of its
     * range) blocks the Save, so nothing out of range is ever stored.
     */
    function fieldSpec(f) {
        const clear = { kind: 'clear' };
        const whole = (text) => (/^\d+$/.test(text) ? Number(text) : undefined);
        switch (f.kind) {
            case 'switch':
                return { field: f.name, format: (v) => (v === true ? 'on' : v === false ? 'off' : ''), parse: (t) => (t === 'on' ? { kind: 'set', value: true } : t === 'off' ? { kind: 'set', value: false } : t === '' ? clear : undefined) };
            case 'choice':
                return { field: f.name, format: (v) => (typeof v === 'string' ? v : ''), parse: (t) => (t === '' ? clear : f.options.some((o) => o.value === t) ? { kind: 'set', value: t } : undefined) };
            case 'number':
                return {
                    field: f.name,
                    format: (v) => (Number.isFinite(v) ? String(v) : ''),
                    parse: (t) => {
                        const text = String(t).trim();
                        if (text === '') return clear;
                        const n = whole(text);
                        return n !== undefined && n >= f.min && n <= f.max ? { kind: 'set', value: n } : undefined;
                    },
                };
            case 'numbers':
                return {
                    field: f.name,
                    format: (v) => (Array.isArray(v) ? v.join(', ') : ''),
                    parse: (t) => {
                        const text = String(t).trim();
                        if (text === '') return clear;
                        const list = text.split(/[\s,]+/).filter(Boolean).map(whole);
                        if (list.length === 0 || list.length > (f.maxItems ?? 10)) return undefined;
                        return list.every((n) => n !== undefined && n >= f.min && n <= f.max) ? { kind: 'set', value: list } : undefined;
                    },
                };
            default:
                return {
                    field: f.name,
                    format: (v) => (typeof v === 'string' ? v : ''),
                    parse: (t) => {
                        const text = String(t).trim();
                        if (text === '') return clear;
                        return typeof f.accepts === 'function' && !f.accepts(text) ? undefined : { kind: 'set', value: text };
                    },
                };
        }
    }

    /** The words under a number that does not fit. */
    function invalidWords(f) {
        if (f.invalid) return f.invalid;
        if (f.kind === 'number') return `A whole number from ${f.min} to ${f.max}, or empty for the default (${f.default}).`;
        if (f.kind === 'numbers') return `Up to ${f.maxItems ?? 10} whole numbers from ${f.min} to ${f.max}, with commas between them, or empty for the default (${(f.default ?? []).join(', ')}).`;
        return 'This value does not fit here.';
    }

    /**
     * A secret's row (a webhook address, a token): DSH's own secret field,
     * which shows whether one is set and where from, never the value. What is
     * typed is checked as it is typed (`f.check(text)` gives the words for a
     * value that does not fit, which then is not saved), stored in DSH's key
     * store on Save, and removable here when it lives there.
     */
    function SecretRow({ f, state, disabled, actions, keeper }) {
        const [draft, setDraft] = React.useState('');
        const [problem, setProblem] = React.useState('');
        const [removing, setRemoving] = React.useState(false);
        // Saved or discarded: the form no longer holds the draft, so the field empties.
        React.useEffect(() => { if (state.text === '' && draft !== '' && !problem) setDraft(''); }, [state.text]);
        const info = state.key ?? {};
        const fromEnvironment = info.configured && info.source === 'env';
        const stateLabel = !info.configured ? (f.unsetLabel ?? 'Not set')
            : fromEnvironment ? (f.envLabel ?? 'Set where DSH starts')
                : (f.setLabel ?? 'Set');
        const onEdit = (text) => {
            setDraft(text);
            const words = text.trim() === '' || typeof f.check !== 'function' ? '' : f.check(text.trim()) || '';
            setProblem(words);
            actions.edit(f.name, words ? '' : text);
        };
        const remove = async () => {
            setRemoving(true);
            try { await keeper?.remove(); } finally { setRemoving(false); }
        };
        return h('div', { className: `${P}-set-row`, 'data-suite-setting': f.name, 'data-suite-secret': info.configured ? (fromEnvironment ? 'env' : 'set') : 'unset' },
            h('div', { className: `${P}-set-text` },
                h(ui.SettingsSecretField, { id: `${P}-set-${f.name}`, label: f.title, hint: fromEnvironment ? (f.envHint ?? f.hint) : f.hint, disabled: disabled || info.writable === false, text: draft, configured: info.configured === true, stateLabel, onEdit }),
                problem ? h('p', { className: `${P}-set-error`, role: 'alert' }, problem) : null,
                info.configured && !fromEnvironment && info.writable !== false && keeper
                    ? h('button', { type: 'button', className: `${P}-set-reset`, disabled: disabled || removing, onClick: () => void remove() }, f.removeLabel ?? 'Remove it') : null));
    }

    /** One setting's row: a switch or a choice drawn here, anything typed in DSH's own field. */
    function SettingRow({ f, state, disabled, actions }) {
        const id = `${P}-set-${f.name}`;
        const edit = (text) => actions.edit(f.name, text);
        const reset = state.overridden
            ? h('button', { type: 'button', className: `${P}-set-reset`, disabled, onClick: () => actions.resetField(f.name), 'aria-label': `Use the default for ${f.title}` }, 'Use the default') : null;
        if (f.kind === 'switch' || f.kind === 'choice') {
            return h('div', { className: `${P}-set-row`, 'data-suite-setting': f.name },
                h('div', { className: `${P}-set-text` },
                    h('div', { className: `${P}-set-title`, id: `${id}-label` }, f.title),
                    h('div', { className: `${P}-set-hint` }, f.hint)),
                h('div', { className: `${P}-set-control` }, reset,
                    f.kind === 'switch'
                        ? h(ui.Switch, { checked: state.text === 'on', label: f.title, disabled, onChange: (next) => edit(next ? 'on' : 'off') })
                        : h(ui.SegmentedControl, { id, label: f.title, value: state.text || f.default, options: f.options, disabled, onChange: edit })));
        }
        return h('div', { className: `${P}-set-row`, 'data-suite-setting': f.name },
            h('div', { className: `${P}-set-text` },
                h(ui.SettingsValueField, {
                    id,
                    label: f.title,
                    hint: f.hint,
                    text: state.text,
                    overridden: state.overridden,
                    invalid: state.invalid,
                    overriddenLabel: 'Changed',
                    resetLabel: 'Use the default',
                    invalidLabel: invalidWords(f),
                    disabled,
                    numeric: f.kind === 'number',
                    onEdit: edit,
                    onReset: () => actions.resetField(f.name),
                })));
    }

    function SettingsBody({ form, name, fields, note }) {
        const snap = React.useSyncExternalStore(form.subscribe, form.getSnapshot);
        const disabled = !snap.writable || snap.saving;
        const labels = {
            unavailable: `${name} is not running, so its settings cannot be changed right now. Switch it on above.`,
            readOnly: 'This DSH keeps its settings read-only, so they cannot be changed here.',
            saveFailed: 'DSH did not save these. Your changes are still here, so you can try again.',
            save: 'Save',
            saving: 'Saving…',
        };
        const rows = [];
        for (const f of fields) {
            if (f.group) rows.push(h('h4', { key: `g-${f.name}`, className: `${P}-set-group` }, f.group));
            const state = snap[f.name] ?? { text: '', overridden: false, invalid: false };
            if (f.kind === 'secret') {
                const keeper = form.keepers?.get(f.name);
                if (keeper) rows.push(h(SecretRow, { key: f.name, f, state, disabled, actions: form.actions, keeper }));
                continue;
            }
            rows.push(h(SettingRow, { key: f.name, f, state, disabled, actions: form.actions }));
        }
        return h('div', { className: `${P}-settings`, 'data-suite-settings': bundle },
            h(ui.SettingsForm, { labels, state: snap, onSave: form.actions.save, onDiscard: form.actions.discard },
                ...rows,
                note ? h('p', { key: 'note', className: `${P}-set-note` }, note) : null));
    }

    /**
     * A secret kept in DSH's key store (never the settings file), under the
     * key name the setting `f.keyFrom` holds (else `f.defaultKey`): whether
     * one is set and where from, storing what the person typed, removing it.
     * Values only ever go to DSH; nothing here reads one back.
     */
    function keyKeeper(ctx, scope, f, changed) {
        const credentials = ctx.remote.credentials;
        const refOf = () => {
            const named = scope.getSnapshot?.()?.value?.[f.keyFrom];
            return typeof named === 'string' && named ? named : f.defaultKey;
        };
        const keeper = {
            info: { ref: refOf(), configured: false, writable: true },
            ref: refOf,
            async read() {
                const ref = refOf();
                try {
                    const response = await credentials.describe([ref]);
                    if (response?.ok !== true || ref !== refOf()) return;
                    const view = response.value?.[ref];
                    keeper.info = { ref, configured: view?.configured === true, writable: view?.writable !== false, ...(typeof view?.source === 'string' ? { source: view.source } : {}) };
                } catch {
                    keeper.info = { ...keeper.info, ref };
                }
                changed();
            },
            async write(text) {
                let response;
                try { response = await credentials.set(refOf(), text); } catch { response = { ok: false }; }
                await keeper.read();
                return response?.ok !== false && keeper.info.configured;
            },
            async remove() {
                try { await credentials.unset(refOf()); } catch { /* the read below shows what is stored */ }
                await keeper.read();
            },
        };
        return keeper;
    }

    /**
     * Put the plugin's settings on its page in Plugins: DSH's own settings
     * form (staged as typed, written on Save), registered only while DSH
     * serves them, which is while the plugin runs. Each field:
     * `{ name, kind: 'switch'|'choice'|'number'|'numbers'|'text'|'secret', title, hint, default, min?, max?, options?, group? }`;
     * a secret also takes `keyFrom`, `defaultKey`, `check(text)`, and its
     * labels (`setLabel`, `envLabel`, `unsetLabel`, `envHint`, `removeLabel`),
     * and needs DSH's `remote.credentials`.
     * Does nothing on a DSH without settings forms.
     */
    function applySettings(ctx, { entry, name, summary, fields, note }) {
        if (typeof ui.SettingsFormModel !== 'function' || typeof ui.SettingsForm !== 'function' || typeof ctx.configForms?.get !== 'function') return;
        const scope = ctx.configForms.get(entry);
        const canKeep = typeof ui.SettingsSecretField === 'function' && typeof ctx.remote?.credentials?.describe === 'function';
        const plain = fields.filter((f) => f.kind !== 'secret');
        const secrets = canKeep ? fields.filter((f) => f.kind === 'secret') : [];
        let store;
        const keepers = new Map(secrets.map((f) => [f.name, keyKeeper(ctx, scope, f, () => store?.set(projection()))]));
        const model = new ui.SettingsFormModel(scope, plain.map(fieldSpec), secrets.map((f) => ({ field: f.name, write: (text) => keepers.get(f.name).write(text) })));
        const projection = () => ({
            ...model.shell(),
            ...Object.fromEntries(plain.map((f) => [f.name, model.field(f.name)])),
            ...Object.fromEntries(secrets.map((f) => [f.name, { ...model.field(f.name), key: keepers.get(f.name).info }])),
        });
        store = model.bind(projection);
        const form = { subscribe: (fn) => store.subscribe(fn), getSnapshot: () => store.getSnapshot(), actions: model.actions(), keepers };
        const View = (props) => (props?.view === 'summary' ? summary : h(SettingsBody, { form, name, fields: [...plain, ...secrets].sort((a, b) => fields.indexOf(a) - fields.indexOf(b)), note }));
        ctx.effect(() => () => model.dispose(), `${bundle}: settings form`);
        if (keepers.size > 0) {
            const readAll = () => { for (const keeper of keepers.values()) void keeper.read(); };
            readAll();
            // A key stored elsewhere (another page, another window) or a new key name: read again.
            ctx.effect(() => scope.subscribe?.(() => { for (const keeper of keepers.values()) if (keeper.ref() !== keeper.info.ref) void keeper.read(); }) ?? (() => {}), `${bundle}: settings keys`);
            if (typeof ctx.remote.$on === 'function') ctx.effect(() => ctx.remote.$on('credentials/reference-updated', (ref) => { for (const keeper of keepers.values()) if (keeper.info.ref === ref) void keeper.read(); }), `${bundle}: settings key changes`);
        }
        ctx.effect(() => ctx.configForms.whileServed([entry], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: bundle }, View))), `${bundle}: settings page`);
    }

    return {
        P, css, injectStyle, removeStyle, setConnection, whenConnected, link, hub, useLive,
        setNavigation, canOpenPlugin, openPlugin, fieldSpec, invalidWords, applySettings,
        timeText, agoText, spanText, toneOf, isRecord,
        Page, Card, Empty, ErrorLine, Loading, StateTag, TimeText, Trouble, SettingsProblem, SettingsBody, SettingRow, SecretRow,
    };
}
// </suite-kit>

        const BUNDLE = 'dsh-plugin-decisions';
        const PAGE = `${BUNDLE}:page`;
        const kit = suiteKit({ prefix: 'dshdc', bundle: BUNDLE, React, ui, h });
        const P = kit.P;
        const api = kit.link(BUNDLE, { name: 'Decisions' });

        const TEXT = {
            entry: 'Decisions',
            title: 'Decisions',
            summary: 'Everything waiting on you, in one place: decision lines, tools waiting for approval, questions, and threads that need a decision. Answer here and the answer goes into the session.',
            disabled: 'Decisions is switched off in DSH\'s profile (enabled: false in its entry in cordis.patch.yml), so it lists nothing and holds nothing. To use it, set enabled to true there and restart DSH. To remove it instead, switch it off in Plugins.',
            waiting: 'Waiting on you',
            nothing: 'Nothing waits on you',
            nothingText: 'When a session asks you something (a DECISION NEEDED line, a tool that needs approval, a question in the question box, a thread that needs a decision), it shows here, and you can answer it here.',
            dismissed: 'Dismissed',
            dismissedSub: 'Hidden from the list. A session that still waits for an answer still waits in the session.',
            history: 'What happened',
            historySub: 'Newest first: new cards, your answers and whether the session got them, and what went elsewhere.',
            noHistory: 'Nothing yet',
            noHistoryText: 'New cards and your answers show here, each with whether the session got it.',
            loading: 'Reading what waits on you',
            settings: 'Settings',
            sent: 'What it sent',
        };

        /** A card's state word (one set of words on every surface). */
        const KIND_WORD = Object.freeze({
            approval: 'waiting for approval',
            question: 'asks you',
            ask: 'asks you',
            decision: 'needs a decision',
            blocked: 'blocked',
            thread: 'needs a decision',
            reply: 'asked you',
        });
        const wordOf = (card) => (card.kind === 'thread' && card.status === 'blocked' ? 'blocked' : KIND_WORD[card.kind] ?? 'asked you');

        const SOURCE_WORDS = Object.freeze({
            approvals: 'tools waiting for approval',
            questions: 'question-box questions',
            replies: 'replies that ask you something',
            threads: 'threads that need a decision',
        });

        const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];

        /** What is wrong with a webhook address as it is typed, or '' (the host checks it again before each send). */
        function webhookProblem(text) {
            let url;
            try { url = new URL(text); } catch { return 'That is not a web address: give the whole address, starting with https://'; }
            if (url.protocol === 'https:') return '';
            if (url.protocol === 'http:' && LOOPBACK.includes(url.hostname)) return '';
            return 'The address must start with https:// (http:// only to this machine).';
        }

        /** Decisions' settings on its page in Plugins: the same names and ranges as its config (lib/config.js). */
        const SETTINGS = [
            { name: 'approvals', kind: 'switch', title: 'Tools waiting for approval', hint: 'List a tool that asks to run with more access, with Allow once and Reject.', default: true, group: 'What it lists' },
            { name: 'questions', kind: 'switch', title: 'Questions in the question box', hint: 'List the questions an agent asks in DSH\'s question box, with their choices.', default: true },
            { name: 'replies', kind: 'switch', title: 'Replies that end with a question', hint: 'List a reply that ends by asking you something. DECISION NEEDED and BLOCKED lines are listed either way.', default: true },
            { name: 'threads', kind: 'switch', title: 'Threads that need a decision', hint: 'List a coordinator\'s thread that handed back needing a decision, or blocked.', default: true },
            { name: 'windowHours', kind: 'number', title: 'Keep a reply\'s question for, in hours', hint: 'An older reply\'s question leaves the list; the session still has it.', default: 72, min: 1, max: 720 },
            { name: 'notify', kind: 'switch', title: 'A notification for each new card', hint: 'Through DSH\'s notifications, while they run. Questions other plugins raise notify through those plugins.', default: true, group: 'Telling you' },
            { name: 'mirror', kind: 'choice', title: 'Also send new cards to', hint: 'A short note for each new card: to a webhook (such as a chat channel\'s), or to a command of yours.', default: 'off', options: [{ value: 'off', label: 'Nowhere' }, { value: 'webhook', label: 'Webhook' }, { value: 'command', label: 'Command' }], group: 'Somewhere else' },
            {
                name: 'webhookAddress',
                kind: 'secret',
                title: 'Webhook address',
                hint: 'Kept in DSH\'s key store, never in the settings file. Leave it empty to keep the one you have.',
                keyFrom: 'mirrorUrlEnv',
                defaultKey: 'DECISIONS_WEBHOOK_URL',
                check: webhookProblem,
                setLabel: 'An address is set',
                envLabel: 'Set where DSH starts',
                unsetLabel: 'No address yet',
                envHint: 'Set in the environment DSH started in, so change it there.',
                removeLabel: 'Remove the address',
            },
            { name: 'mirrorPerHour', kind: 'number', title: 'Messages sent an hour, at most', hint: 'Past this, Decisions holds back and says so once; it still lists everything.', default: 30, min: 1, max: 500 },
        ];
        const SETTINGS_SUMMARY = 'What Decisions lists, whether it notifies you, and where else new cards go.';
        const SETTINGS_NOTE = 'Changes apply as soon as you save. Command runs the program set in DSH\'s profile (mirrorCommand in Decisions\' entry).';

        const CSS = [
            `.${P}-status{margin:10px 0 0;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `.${P}-lines{margin:8px 0 0;display:flex;flex-direction:column;gap:4px;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `.${P}-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}`,
            `.${P}-warn{color:var(--${P}-warn)}`,
            `.${P}-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}`,
            `.${P}-session{font:var(--dsw-font-s-strong-14)}`,
            `.${P}-ask{margin:8px 0 0;font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere}`,
            `.${P}-rec{margin:6px 0 0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary)}`,
            `.${P}-rec-label{color:var(--${P}-text-2)}`,
            `.${P}-code{font-family:var(--dsw-font-family-mono,ui-monospace,SFMono-Regular,Menlo,monospace);max-height:12em;overflow:auto}`,
            `.${P}-answer{margin-top:10px;display:flex;flex-direction:column;gap:8px;min-width:0}`,
            `.${P}-label{font:var(--dsw-font-xs-strong-13);color:var(--dsw-alias-label-primary)}`,
            `.${P}-textarea,.${P}-input{box-sizing:border-box;width:100%;min-width:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--${P}-fill);color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}`,
            `.${P}-textarea{resize:vertical;min-height:4.5em}`,
            `.${P}-textarea::placeholder,.${P}-input::placeholder{color:var(--${P}-text-2)}`,
            `.${P}-question{margin:0;padding:0;border:0;min-width:0;display:flex;flex-direction:column;gap:6px}`,
            `.${P}-legend{padding:0;margin:0 0 2px;font:var(--dsw-font-s-strong-14);color:var(--dsw-alias-label-primary);white-space:pre-wrap;overflow-wrap:anywhere}`,
            `.${P}-option{display:flex;align-items:flex-start;gap:8px;cursor:pointer;font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}`,
            `.${P}-option input{margin:3px 0 0;accent-color:var(--dsw-alias-state-business-primary)}`,
            `.${P}-option-hint{display:block;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `.${P}-hint{font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `.${P}-details{margin-top:6px}`,
            `.${P}-details>summary{cursor:pointer;font:var(--dsw-font-xs-13);color:var(--${P}-link);width:max-content;border-radius:var(--dsw-radius-xs)}`,
            `.${P}-details>summary:focus-visible{outline:2px solid var(--${P}-ring);outline-offset:1px}`,
            `.${P}-log-time{flex:0 0 auto;min-width:64px;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `.${P}-alert[tabindex]:focus{outline:none}`,
            `.${P}-alert[tabindex]:focus-visible{outline:2px solid var(--${P}-ring);outline-offset:1px}`,
            `@media (max-width:560px){.${P}-item{flex-wrap:wrap}.${P}-item-side{justify-content:flex-start;width:100%}}`,
        ];

        // ── Words ─────────────────────────────────────────────────────

        const listWords = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

        /** What it lists, and what is switched off. */
        function sourcesText(sources) {
            const keys = Object.keys(SOURCE_WORDS);
            const on = keys.filter((k) => sources?.[k] !== false).map((k) => SOURCE_WORDS[k]);
            const off = keys.filter((k) => sources?.[k] === false).map((k) => SOURCE_WORDS[k]);
            const lead = `It lists DECISION NEEDED and BLOCKED lines${on.length ? `, ${listWords(on)}` : ''}, and other plugins' questions.`;
            return off.length ? `${lead} Switched off in its settings: ${listWords(off)}.` : lead;
        }

        function notifyText(data) {
            if (!data.notify) return 'Notifications are off in its settings.';
            return data.notifications ? 'Each new card notifies you.' : 'Each new card would notify you, but DSH\'s notifications are not running.';
        }

        /** Where new cards also go, or why they cannot. */
        function mirrorText(m) {
            if (!m || m.mode === 'off') return '';
            if (m.problem) return `New cards cannot go elsewhere: ${String(m.problem).replace(/\.$/, '')}.`;
            const where = m.mode === 'webhook' ? (m.place ? `the webhook at ${m.place}` : 'the webhook') : (m.place || 'your command');
            return `New cards also go to ${where}: ${m.lastHour} of ${m.perHour} this hour.`;
        }

        /** "waiting 4 minutes", with the full time for hover and screen readers. */
        function Waited({ at, now }) {
            if (!Number.isFinite(at) || at <= 0) return null;
            const seconds = Math.max(0, ((now ?? Date.now()) - at) / 1000);
            return h('time', { className: `${P}-num`, dateTime: new Date(at).toISOString(), title: new Date(at).toLocaleString() }, seconds < 45 ? 'waiting since just now' : `waiting ${kit.spanText(seconds)}`);
        }

        /** Where a card comes from, in words, beside its session. */
        function originWords(card) {
            if (card.kind === 'thread' && card.via?.title) return `a thread of “${card.via.title}”`;
            if (card.kind === 'ask') return `from ${card.source || 'a plugin'}`;
            if (card.kind === 'question' && card.late) return 'its wait ran out; your answer reaches it as a new message';
            return '';
        }

        // ── Data ──────────────────────────────────────────────────────

        const readState = () => api.read('state');

        /** Do something on the host: `{ value }`, or `{ problem }` in words. */
        async function run(method, args) {
            const result = await api.call(method, args);
            return result.ok ? { value: result.value } : { problem: result.error?.message || 'Decisions did not answer.' };
        }

        /** What an action did, in a line (shown where the person is looking, and read out). */
        function saidText(method, card, value) {
            const where = card?.title ? `“${card.title}”` : 'the session';
            if (method === 'answer') {
                switch (value?.state) {
                    case 'delivered': return `Your answer reached ${where}.`;
                    case 'in the queue': return `Your answer to ${where} waits in its queue. What happened says when the session reads it.`;
                    case 'answered': return `Answered. ${card?.source || 'The plugin that asked'} carries it out.`;
                    default: return `Sent your answer to ${where}. What happened says when the session has it.`;
                }
            }
            if (method === 'dismiss') return 'Dismissed. It stays under Dismissed if you want it back.';
            if (method === 'undismiss') return 'Brought back.';
            if (method === 'testMirror') return `Test message sent${value?.place ? ` to ${value.place}` : ''}.`;
            return '';
        }

        /** A clock that moves every 30 seconds, so "waiting 4 minutes" stays true. */
        function useNow(ms = 30000) {
            const [now, setNow] = React.useState(() => Date.now());
            React.useEffect(() => {
                const timer = setInterval(() => setNow(Date.now()), ms);
                return () => clearInterval(timer);
            }, [ms]);
            return now;
        }

        // ── Parts ─────────────────────────────────────────────────────

        function useOpener(openSession) {
            return React.useCallback((sessionId) => {
                try { openSession?.(sessionId); } catch (error) { console?.warn?.('dsh-plugin-decisions: could not open the session', error); }
            }, [openSession]);
        }

        function SessionLink({ title, sessionId, onOpen }) {
            if (!sessionId) return h('span', { className: `${P}-session` }, title || 'A plugin');
            return h('button', { type: 'button', className: `${P}-link ${P}-session`, onClick: () => onOpen(sessionId), title: 'Open this session' }, title || 'Untitled session');
        }

        function HeaderCard({ data, busy, act, said }) {
            const waiting = data.waiting.length;
            const urgent = data.waiting.filter((c) => c.answer === 'approval' || c.live).length;
            const status = !data.enabled ? TEXT.disabled
                : waiting === 0 ? 'Nothing waits on you.'
                    : [`${waiting} waiting on you`, urgent ? `${urgent} holding a running turn` : ''].filter(Boolean).join(' · ');
            const mirror = mirrorText(data.mirror);
            const canOpen = kit.canOpenPlugin();
            return h(kit.Card, {
                title: TEXT.title,
                headingLevel: 1,
                main: true,
                sub: TEXT.summary,
                actions: canOpen ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: () => kit.openPlugin(BUNDLE) }, TEXT.settings) : null,
                attrs: { 'data-decisions-header': data.enabled ? 'on' : 'off' },
            },
            h('p', { className: `${P}-status` }, status),
            data.enabled ? h('div', { className: `${P}-lines` },
                h('div', { className: `${P}-line`, 'data-decisions-sources': '' }, sourcesText(data.sources)),
                h('div', { className: `${P}-line`, 'data-decisions-notify': '' }, notifyText(data)),
                mirror ? h('div', { className: `${P}-line${data.mirror.problem ? ` ${P}-warn` : ''}`, 'data-decisions-mirror': data.mirror.problem ? 'problem' : data.mirror.mode },
                    h('span', null, mirror),
                    data.mirror.problem
                        ? (canOpen ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: () => kit.openPlugin(BUNDLE) }, 'Open Decisions\' settings') : null)
                        : h(ui.Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => void act('testMirror', {}) }, 'Send a test')) : null,
                mirror ? h('div', { className: said?.where === 'mirror' ? `${P}-line ${P}-ok` : `${P}-sr`, role: 'status', 'aria-live': 'polite', 'data-decisions-test-said': '' }, said?.where === 'mirror' ? said.text : '') : null) : null,
            data.watchProblem ? h('p', { className: `${P}-note`, 'data-decisions-watch-problem': '' }, `Session Watch uses its default for a wrong setting: ${String(data.watchProblem.text).replace(/\.$/, '')}. Change it in Session Watch's settings in Plugins.`) : null);
        }

        function ApprovalAnswer({ card, busy, answer }) {
            return h('div', { className: `${P}-actions`, style: { marginTop: '10px' } },
                h(ui.Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => void answer({ decision: 'allow' }) }, 'Allow once'),
                h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => void answer({ decision: 'reject' }) }, 'Reject'));
        }

        const domId = (text) => String(text).replace(/[^A-Za-z0-9_-]/g, '_');

        function TextAnswer({ card, busy, answer }) {
            const [text, setText] = React.useState('');
            const id = `${P}-answer-${domId(card.id)}`;
            const send = () => { if (text.trim()) void answer({ text }).then((ok) => { if (ok) setText(''); }); };
            return h('div', { className: `${P}-answer` },
                h('label', { className: `${P}-label`, htmlFor: id }, 'Your answer'),
                h('textarea', {
                    id,
                    className: `${P}-textarea`,
                    rows: 3,
                    value: text,
                    disabled: busy,
                    placeholder: card.recommendation ? 'Write your answer, or go with the recommendation' : 'Write your answer',
                    onChange: (event) => setText(event.target.value),
                    onKeyDown: (event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                            event.preventDefault();
                            send();
                        }
                    },
                }),
                h('div', { className: `${P}-actions` },
                    h(ui.Button, { variant: 'primary', size: 'sm', disabled: busy || !text.trim(), onClick: send }, 'Send'),
                    card.recommendation ? h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => void answer({ recommended: true }) }, 'Go with the recommendation') : null,
                    h('span', { className: `${P}-hint` }, card.running ? 'The session is running: your answer steers its current turn.' : 'It goes into the session as your next message.')));
        }

        function QuestionsAnswer({ card, busy, answer }) {
            const [picked, setPicked] = React.useState({});
            const [own, setOwn] = React.useState({});
            const questions = card.questions ?? [];
            const toggle = (q, label) => setPicked((was) => {
                const now = was[q.id] ?? [];
                return { ...was, [q.id]: q.multiSelect ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label] };
            });
            const answers = questions.map((q) => ({ id: q.id, selected: picked[q.id] ?? [], ...(own[q.id]?.trim() ? { custom: own[q.id].trim() } : {}) }));
            const ready = answers.some((a) => a.selected.length > 0 || a.custom);
            return h('div', { className: `${P}-answer` },
                ...questions.map((q, i) => h('fieldset', { key: q.id, className: `${P}-question` },
                    h('legend', { className: `${P}-legend` }, q.header ? `${q.header}: ${q.question}` : q.question),
                    q.detail ? h('p', { className: `${P}-why` }, q.detail) : null,
                    ...(q.options ?? []).map((o) => h('label', { key: o.label, className: `${P}-option` },
                        h('input', { type: q.multiSelect ? 'checkbox' : 'radio', name: `${P}-q-${domId(card.id)}-${i}`, checked: (picked[q.id] ?? []).includes(o.label), disabled: busy, onChange: () => toggle(q, o.label) }),
                        h('span', null, o.label, o.description ? h('span', { className: `${P}-option-hint` }, o.description) : null))),
                    h('input', { type: 'text', className: `${P}-input`, 'aria-label': `Your own answer to: ${q.question}`, placeholder: 'Or write your own answer', value: own[q.id] ?? '', disabled: busy, onChange: (event) => setOwn((was) => ({ ...was, [q.id]: event.target.value })) }))),
                h('div', { className: `${P}-actions` },
                    h(ui.Button, { variant: 'primary', size: 'sm', disabled: busy || !ready, onClick: () => void answer({ answers }) }, questions.length > 1 ? 'Send answers' : 'Send answer'),
                    questions.length > 1 ? h('span', { className: `${P}-hint` }, 'A question you leave blank is skipped.') : null));
        }

        function AskAnswer({ card, busy, answer }) {
            const [text, setText] = React.useState('');
            const id = `${P}-answer-${domId(card.id)}`;
            return h('div', { className: `${P}-answer` },
                (card.options ?? []).length ? h('div', { className: `${P}-actions` },
                    ...card.options.map((o, i) => h(ui.Button, { key: o.id, variant: i === 0 ? 'primary' : 'outline', size: 'sm', disabled: busy, onClick: () => void answer({ option: o.id }) }, o.label))) : null,
                card.freeText ? [
                    h('label', { key: 'l', className: `${P}-label`, htmlFor: id }, 'Or answer in your words'),
                    h('textarea', { key: 't', id, className: `${P}-textarea`, rows: 2, value: text, disabled: busy, onChange: (event) => setText(event.target.value) }),
                    h('div', { key: 'a', className: `${P}-actions` }, h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy || !text.trim(), onClick: () => void answer({ text }) }, 'Send')),
                ] : null);
        }

        /** One thing waiting on you, with the controls its kind takes. */
        function DecisionCard({ card, onOpen, act, busyId, now }) {
            const [failure, setFailure] = React.useState(undefined);
            const alertRef = React.useRef(null);
            const busy = busyId === card.id || card.sending === true;
            const shown = failure || card.error;
            React.useEffect(() => { if (shown) alertRef.current?.focus?.(); }, [shown]);
            const answer = async (input) => {
                setFailure(undefined);
                const problem = await act('answer', { id: card.id, answer: input }, card);
                if (problem) setFailure(problem);
                return !problem;
            };
            const origin = originWords(card);
            const asksInForm = card.answer === 'questions';
            let controls = null;
            if (card.answer === 'approval') controls = h(ApprovalAnswer, { card, busy, answer });
            else if (card.answer === 'questions') controls = h(QuestionsAnswer, { card, busy, answer });
            else if (card.answer === 'text') controls = h(TextAnswer, { card, busy, answer });
            else if (card.answer === 'ask') controls = h(AskAnswer, { card, busy, answer });
            else if (card.sessionId) {
                controls = h('div', { className: `${P}-actions`, style: { marginTop: '10px' } },
                    h(ui.Button, { variant: 'primary', size: 'sm', onClick: () => onOpen(card.sessionId) }, 'Answer in the session'),
                    h('span', { className: `${P}-hint` }, card.kind === 'approval' ? 'Decisions was not holding this request when DSH asked, so answer it in the session.' : 'Only the session can take this answer.'));
            }
            return h('li', { className: `${P}-item`, 'data-decisions-card': card.kind, 'data-decisions-id': card.id },
                h('div', { className: `${P}-item-main` },
                    h('div', { className: `${P}-card-top` },
                        h(kit.StateTag, { word: wordOf(card) }),
                        h(SessionLink, { title: card.title, sessionId: card.sessionId, onOpen }),
                        h('span', { className: `${P}-meta` }, origin ? `${origin} · ` : '', h(Waited, { at: card.at, now }))),
                    asksInForm ? null : h('p', { className: `${P}-ask` }, card.question),
                    card.more && !asksInForm ? h('p', { className: `${P}-why` }, `And ${card.more} more question${card.more === 1 ? '' : 's'}.`) : null,
                    card.recommendation ? h('p', { className: `${P}-rec`, 'data-decisions-recommendation': '' }, h('span', { className: `${P}-rec-label` }, 'Recommended: '), card.recommendation) : null,
                    card.what ? h('p', { className: `${P}-quote ${P}-code` }, card.what) : null,
                    card.detail ? h('p', { className: `${P}-why` }, card.detail) : null,
                    card.lines?.length ? h('details', { className: `${P}-details` }, h('summary', null, 'More about the call'), h('p', { className: `${P}-quote` }, card.lines.join('\n'))) : null,
                    card.answer === 'approval' || card.live ? h('p', { className: `${P}-why` }, 'The session waits on this. Answer here or in the session: the first answer counts.') : null,
                    controls,
                    shown ? h('p', { className: `${P}-alert`, role: 'alert', tabIndex: -1, ref: alertRef, 'data-decisions-error': '' }, /^Not /.test(String(shown)) ? String(shown) : `Not sent: ${shown}`) : null,
                    card.sending ? h(kit.Loading, { text: 'Sending your answer' }) : null),
                h('div', { className: `${P}-item-side` },
                    h(ui.Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => void act('dismiss', { id: card.id }, card) }, 'Dismiss')));
        }

        function WaitingCard({ data, onOpen, act, busyId, now, said }) {
            const shown = said?.where === 'list' ? said.text : '';
            const line = React.useRef(null);
            const acted = React.useRef(0);
            React.useEffect(() => { if (shown) acted.current = Date.now(); }, [said?.n]);
            // The card you answered leaves the list a moment later: the keyboard goes to the line that says what happened, not to the page's top.
            React.useEffect(() => {
                if (!acted.current || Date.now() - acted.current > 5000 || typeof document === 'undefined') return;
                const at = document.activeElement;
                if (at && at !== document.body && at.isConnected) return;
                acted.current = 0;
                line.current?.focus?.({ preventScroll: true });
            });
            return h(kit.Card, { title: TEXT.waiting, main: true, attrs: { 'data-decisions-waiting': String(data.waiting.length) } },
                // What your last answer did, said where you are looking (and to screen readers).
                h('p', { ref: line, tabIndex: -1, className: shown ? `${P}-note ${P}-ok` : `${P}-sr`, role: 'status', 'aria-live': 'polite', 'data-decisions-said': '' }, shown),
                data.waiting.length === 0
                    ? h(kit.Empty, { title: TEXT.nothing, text: TEXT.nothingText })
                    : h('ul', { className: `${P}-list` }, ...data.waiting.map((card) => h(DecisionCard, { key: card.id, card, onOpen, act, busyId, now }))));
        }

        function DismissedCard({ data, onOpen, act, busyId }) {
            if (data.dismissed.length === 0) return null;
            return h(kit.Card, { title: `${TEXT.dismissed} (${data.dismissed.length})`, sub: TEXT.dismissedSub, attrs: { 'data-decisions-dismissed': '' } },
                h('details', { className: `${P}-details` }, h('summary', null, 'Show them'),
                    h('ul', { className: `${P}-list` }, ...data.dismissed.map((card) => h('li', { key: card.id, className: `${P}-item`, 'data-decisions-dismissed-id': card.id },
                        h('div', { className: `${P}-item-main` },
                            h('div', { className: `${P}-card-top` }, h(kit.StateTag, { word: wordOf(card) }), h(SessionLink, { title: card.title, sessionId: card.sessionId, onOpen })),
                            h('p', { className: `${P}-why` }, card.question)),
                        h('div', { className: `${P}-item-side` },
                            h(ui.Button, { variant: 'outline', size: 'sm', disabled: busyId === card.id, onClick: () => void act('undismiss', { id: card.id }, card) }, 'Bring back')))))));
        }

        function HistoryRow({ entry, onOpen }) {
            const state = entry.state && entry.state !== 'done' ? entry.state : '';
            const failed = state === 'not delivered' || state === 'not sent';
            return h('li', { className: `${P}-item`, 'data-decisions-entry': entry.kind },
                h('span', { className: `${P}-log-time` }, h(kit.TimeText, { at: entry.at })),
                h('div', { className: `${P}-item-main` },
                    h('div', null,
                        entry.sessionId ? h(SessionLink, { title: entry.title || 'Untitled session', sessionId: entry.sessionId, onOpen }) : null,
                        entry.sessionId ? h('span', { className: `${P}-meta` }, ' · ') : null,
                        h('span', null, entry.text),
                        entry.by === 'you' ? h('span', { className: `${P}-meta` }, ' · You') : null),
                    entry.question ? h('div', { className: `${P}-meta` }, entry.kind === 'answer' ? `To: ${entry.question}` : entry.question) : null,
                    entry.why ? h('div', { className: `${P}-why` }, `Why: ${entry.why}`) : null,
                    entry.reason ? h('div', { className: `${P}-why${failed ? ` ${P}-error` : ''}` }, `${failed ? `${state[0].toUpperCase()}${state.slice(1)}: ` : ''}${String(entry.reason).replace(/\.$/, '')}.`) : null,
                    entry.note ? h('details', { className: `${P}-details` }, h('summary', null, TEXT.sent), h('p', { className: `${P}-quote` }, entry.note)) : null),
                state ? h('div', { className: `${P}-item-side` }, h(kit.StateTag, { word: state })) : null);
        }

        function HistoryCard({ data, onOpen }) {
            const [all, setAll] = React.useState(false);
            const shown = all ? data.history : data.history.slice(0, 30);
            return h(kit.Card, { title: TEXT.history, sub: TEXT.historySub, attrs: { 'data-decisions-history': '' } },
                data.history.length === 0 ? h(kit.Empty, { title: TEXT.noHistory, text: TEXT.noHistoryText })
                    : [
                        h('ul', { key: 'l', className: `${P}-list` }, ...shown.map((entry) => h(HistoryRow, { key: entry.id, entry, onOpen }))),
                        data.history.length > shown.length ? h('div', { key: 'm', style: { marginTop: '8px' } }, h(ui.Button, { variant: 'ghost', size: 'sm', onClick: () => setAll(true) }, `Show all ${data.history.length}`)) : null,
                    ]);
        }

        function DecisionsPage({ decisions }) {
            const live = kit.useLive(readState, ['decisions', 'sessions', 'asks', 'settings'], { delayMs: 300 });
            const now = useNow();
            const [busyId, setBusyId] = React.useState(undefined);
            const [failure, setFailure] = React.useState(undefined);
            const [said, setSaid] = React.useState({ text: '', where: '', n: 0 });
            const onOpen = useOpener(decisions?.openSession);
            /**
             * Answer, dismiss, bring back or test. A card shows its own failure
             * (the answer's words come back to it); the others show under the
             * header. What it did is said where the person is looking.
             */
            const act = React.useCallback(async (method, args, card) => {
                setBusyId(card?.id ?? method);
                setFailure(undefined);
                const { problem, value } = await run(method, args);
                setBusyId(undefined);
                if (problem && method !== 'answer') setFailure(problem);
                if (!problem) setSaid((was) => ({ text: saidText(method, card, value), where: method === 'testMirror' ? 'mirror' : 'list', n: was.n + 1 }));
                void live.refresh();
                return problem;
            }, [live.refresh]);
            const data = live.data;
            // Not running (or Session Watch is off): old data would mislead, so the page says why and what to do.
            const down = live.code === 'not-running' || (data === undefined && live.error);
            return h(kit.Page, { label: TEXT.title, attrs: { 'data-decisions-page': '' } },
                down
                    ? h(kit.Card, { title: TEXT.title, headingLevel: 1, main: true, sub: TEXT.summary },
                        h(kit.Trouble, { name: 'Decisions', packageName: BUNDLE, code: live.code, text: live.error, onRetry: live.refresh }))
                    : data === undefined
                        ? h(kit.Card, { title: TEXT.title, headingLevel: 1, main: true }, h(kit.Loading, { text: TEXT.loading }))
                        : data.problem
                            ? [
                                h(kit.Card, { key: 'head', title: TEXT.title, headingLevel: 1, main: true, sub: TEXT.summary, attrs: { 'data-decisions-header': 'problem' } },
                                    h(kit.SettingsProblem, { name: 'Decisions', packageName: BUNDLE, problem: data.problem })),
                                h(HistoryCard, { key: 'history', data, onOpen }),
                            ]
                            : [
                                h(HeaderCard, { key: 'head', data, busy: busyId !== undefined, act, said }),
                                live.error ? h(kit.ErrorLine, { key: 'refresh', text: live.error, onRetry: live.refresh }) : null,
                                failure ? h('p', { key: 'act', className: `${P}-alert`, role: 'alert', 'data-decisions-failure': '' }, /^Not /.test(failure) ? failure : `Not done: ${failure}`) : null,
                                data.enabled ? h(WaitingCard, { key: 'waiting', data, onOpen, act, busyId, now, said }) : null,
                                data.enabled ? h(DismissedCard, { key: 'dismissed', data, onOpen, act, busyId }) : null,
                                h(HistoryCard, { key: 'history', data, onOpen }),
                            ]);
        }

        /** The panel entry's glyph, with the count of what waits on you. */
        function DecisionsIcon({ size = 16 }) {
            const live = kit.useLive(() => api.read('badge'), ['decisions', 'asks', 'settings'], { delayMs: 500 });
            const down = live.code === 'not-running' || live.data?.off === true;
            const waiting = down ? 0 : live.data?.waiting ?? 0;
            return h('span', { className: `${P}-icon`, 'data-decisions-icon': down ? 'off' : String(waiting) },
                h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: down ? { opacity: 0.55 } : undefined },
                    h('path', { d: 'M4 13.5 6.2 6.4A2 2 0 0 1 8.1 5h7.8a2 2 0 0 1 1.9 1.4L20 13.5' }),
                    h('path', { d: 'M4 13.5V17a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.5h-4.5l-1.2 2h-4.6l-1.2-2Z' })),
                waiting > 0 ? h('span', { className: `${P}-badge` }, waiting > 9 ? '9+' : String(waiting)) : null,
                waiting > 0 ? h('span', { className: `${P}-sr` }, `${waiting} waiting on you`) : null);
        }

        const inject = ['slots'];

        function apply(ctx) {
            try {
                kit.injectStyle(CSS);
            } catch (error) {
                console?.warn?.('dsh-plugin-decisions: style:', error);
            }
            ctx.effect?.(() => () => kit.removeStyle(), 'decisions: style');
            ctx.inject(['connection'], (scope) => scope.effect(() => {
                kit.setConnection(scope.connection);
                const detach = kit.hub.attach();
                return () => {
                    detach();
                    kit.setConnection(undefined);
                };
            }, 'decisions: connection'));
            ctx.inject(['uiWorkspace'], (scope) => applyViews(scope));
            // DSH's Plugins page: the buttons that open Decisions' (or Session Watch's) switch and settings.
            ctx.inject(['pluginNavigation'], (scope) => {
                kit.setNavigation(scope.pluginNavigation);
                return () => kit.setNavigation(undefined);
            });
            // Its settings on its page in Plugins, through DSH's own settings form; the webhook address through DSH's key store.
            ctx.inject(['configForms', 'remote', 'remote.session', 'remote.credentials'], (scope) => {
                try {
                    kit.applySettings(scope, { entry: 'decisions', name: 'Decisions', summary: SETTINGS_SUMMARY, fields: SETTINGS, note: SETTINGS_NOTE });
                } catch (error) {
                    console?.warn?.('dsh-plugin-decisions: settings:', error);
                }
            });
        }

        /** The page and its sidebar entry, once DSH's workspace (which opens sessions) is there. */
        function applyViews(ctx) {
            const decisions = {
                openSession(sessionId) {
                    if (typeof sessionId !== 'string' || sessionId === '') return;
                    try { ctx.uiWorkspace.openSession(sessionId); } catch (error) { console?.warn?.('dsh-plugin-decisions: could not open the session', error); }
                },
            };
            const withApi = () => ({ decisions });
            ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PAGE, inject: withApi }, DecisionsPage));
            // After Plugins (0), before Autopilot (3), Agent Terminals (4) and Categories (6).
            ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PAGE, order: 2, label: TEXT.entry }, DecisionsIcon));
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        // For the plugin's own tests.
        module.exports.internals = { kit, TEXT, KIND_WORD, CSS, SETTINGS, SETTINGS_SUMMARY, SETTINGS_NOTE, wordOf, sourcesText, notifyText, mirrorText, webhookProblem, originWords, DecisionsPage, DecisionsIcon, DecisionCard, HeaderCard, WaitingCard, HistoryCard, DismissedCard };
        return module.exports;
    },
});
