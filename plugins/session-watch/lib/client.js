/**
 * dsh-plugin-session-watch, browser half: its one setting on its page in
 * Plugins (DSH's `plugins.bundle.config`), saved through DSH's own settings
 * form and used as soon as it is saved. The watcher itself has no page:
 * Autopilot, Decisions and Agent Terminals show what it sees.
 *
 * Hand-written in the module format DSH serves to the browser (no build
 * step). Nothing here may throw at load: DSH joins every plugin's browser
 * half into one script, and one error would stop the others.
 *
 * @module dsh-plugin-session-watch/client
 */
// DSH serves browser halves in one script; never throw here, or the others stop loading too.
if (typeof window !== 'undefined' && window.__ModuleLoader__) window.__ModuleLoader__.load({
    id: 'dsh-plugin-session-watch',
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
            case 'waiting for approval': case 'waiting on you': case 'needs a decision': case 'asked you': case 'cut off': case 'cut short': case 'backed off': case 'gave up': case 'held': case 'not confirmed': case 'waiting on a setting': return 'warning';
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
            rows.push(h(SettingRow, { key: f.name, f, state: snap[f.name] ?? { text: '', overridden: false, invalid: false }, disabled, actions: form.actions }));
        }
        return h('div', { className: `${P}-settings`, 'data-suite-settings': bundle },
            h(ui.SettingsForm, { labels, state: snap, onSave: form.actions.save, onDiscard: form.actions.discard },
                ...rows,
                note ? h('p', { key: 'note', className: `${P}-set-note` }, note) : null));
    }

    /**
     * Put the plugin's settings on its page in Plugins: DSH's own settings
     * form (staged as typed, written on Save), registered only while DSH
     * serves them, which is while the plugin runs. Each field:
     * `{ name, kind: 'switch'|'choice'|'number'|'numbers'|'text', title, hint, default, min?, max?, options?, group? }`.
     * Does nothing on a DSH without settings forms.
     */
    function applySettings(ctx, { entry, name, summary, fields, note }) {
        if (typeof ui.SettingsFormModel !== 'function' || typeof ui.SettingsForm !== 'function' || typeof ctx.configForms?.get !== 'function') return;
        const model = new ui.SettingsFormModel(ctx.configForms.get(entry), fields.map(fieldSpec));
        const store = model.bind(() => ({ ...model.shell(), ...Object.fromEntries(fields.map((f) => [f.name, model.field(f.name)])) }));
        const form = { subscribe: (fn) => store.subscribe(fn), getSnapshot: () => store.getSnapshot(), actions: model.actions() };
        const View = (props) => (props?.view === 'summary' ? summary : h(SettingsBody, { form, name, fields, note }));
        ctx.effect(() => () => model.dispose(), `${bundle}: settings form`);
        ctx.effect(() => ctx.configForms.whileServed([entry], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: bundle }, View))), `${bundle}: settings page`);
    }

    return {
        P, css, injectStyle, removeStyle, setConnection, whenConnected, link, hub, useLive,
        setNavigation, openPlugin, fieldSpec, invalidWords, applySettings,
        timeText, agoText, spanText, toneOf, isRecord,
        Page, Card, Empty, ErrorLine, Loading, StateTag, TimeText, Trouble, SettingsProblem, SettingsBody, SettingRow,
    };
}
// </suite-kit>

        const BUNDLE = 'dsh-plugin-session-watch';
        const kit = suiteKit({ prefix: 'dshsw', bundle: BUNDLE, React, ui, h });

        /** Its setting on its page in Plugins: the same name and range as its config (lib/config.js). */
        const SETTINGS = [
            {
                name: 'deliveryTimeoutSeconds',
                kind: 'number',
                title: 'How long a message may wait to be read, in seconds',
                hint: 'When Autopilot, Decisions or Agent Terminals put a message into a session, they wait this long for the session to read it into a turn. Past it, they say the message was not delivered.',
                default: 600,
                min: 10,
                max: 86400,
            },
        ];
        const SETTINGS_SUMMARY = 'How long a message from Autopilot, Decisions or Agent Terminals may wait to be read.';
        const SETTINGS_NOTE = 'Session Watch reads every session for Autopilot, Decisions and Agent Terminals; they stop working while it is off. A change applies as soon as you save.';

        const inject = ['slots'];

        function apply(ctx) {
            try {
                kit.injectStyle([]);
            } catch (error) {
                console?.warn?.('dsh-plugin-session-watch: style:', error);
            }
            ctx.effect?.(() => () => kit.removeStyle(), 'session-watch: style');
            // Its setting on its page in Plugins, through DSH's own settings form.
            ctx.inject(['configForms', 'remote', 'remote.session'], (scope) => {
                try {
                    kit.applySettings(scope, { entry: 'session-watch', name: 'Session Watch', summary: SETTINGS_SUMMARY, fields: SETTINGS, note: SETTINGS_NOTE });
                } catch (error) {
                    console?.warn?.('dsh-plugin-session-watch: settings:', error);
                }
            });
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        // For the plugin's own tests.
        module.exports.internals = { kit, SETTINGS, SETTINGS_SUMMARY, SETTINGS_NOTE };
        return module.exports;
    },
});
