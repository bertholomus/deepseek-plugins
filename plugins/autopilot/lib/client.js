/**
 * dsh-plugin-autopilot, browser half: Autopilot's page in DSH's sidebar.
 *
 * - The entry in DSH's panel list (`sidebar.panellist`, order 3), with a
 *   count when Autopilot waits on an answer, and its page in `main`.
 * - The page: the kill switch and the default rule; questions waiting on
 *   you; every session with its state, its open work, its next check and
 *   its rule (Auto, Ask first, Off); and the event log, where each action
 *   says what it did, why, and whether the session's log shows it arrived.
 *
 * Hand-written in the module format DSH serves to the browser (no build
 * step). Nothing here may throw at load: DSH joins every plugin's browser
 * half into one script, and one error would stop the others.
 *
 * @module dsh-plugin-autopilot/client
 */
// DSH serves browser halves in one script; never throw here, or the others stop loading too.
if (typeof window !== 'undefined' && window.__ModuleLoader__) window.__ModuleLoader__.load({
    id: 'dsh-plugin-autopilot',
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

    /** A plugin's endpoints over DSH's connection: `call(method, args)` gives `{ ok, value }` or `{ ok: false, error }`. */
    function link(namespace) {
        return {
            async call(method, args = {}) {
                const connection = connections.current ?? await whenConnected();
                if (!connection) return { ok: false, error: { code: 'unreachable', message: 'This window is not connected to DSH yet.' } };
                let result;
                try {
                    result = await connection.rpc.call('/api', `${namespace}/${method}`, { args });
                } catch (error) {
                    return { ok: false, error: { code: 'unreachable', message: `DSH did not answer (${String(error?.message ?? error).slice(0, 160)}).` } };
                }
                return isRecord(result) && (result.ok === true || (result.ok === false && isRecord(result.error))) ? result
                    : { ok: false, error: { code: 'unreadable', message: 'The plugin sent an answer this window cannot read.' } };
            },
            /** The value, or a thrown Error with the plugin's words. */
            async read(method, args) {
                const result = await this.call(method, args);
                if (result.ok) return result.value;
                throw new Error(result.error?.message || 'The plugin did not answer.');
            },
        };
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
        const [state, setState] = React.useState({ data: undefined, error: undefined, loading: true });
        const readRef = React.useRef(read);
        readRef.current = read;
        const timer = React.useRef(undefined);
        const alive = React.useRef(true);
        const refresh = React.useCallback(async () => {
            try {
                const data = await readRef.current();
                if (alive.current) setState({ data, error: undefined, loading: false });
            } catch (error) {
                if (alive.current) setState((s) => ({ data: s.data, error: String(error?.message ?? error), loading: false }));
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

    /** DSH's tag tone for one of the suite's state words. */
    function toneOf(word) {
        switch (word) {
            case 'running': case 'working': case 'queued': case 'in the queue': case 'sending': case 'starting': case 'waiting for a round': return 'info';
            case 'waiting for approval': case 'waiting on you': case 'needs a decision': case 'asked you': case 'cut off': case 'cut short': case 'backed off': case 'held': return 'warning';
            case 'failed': case 'blocked': case 'not delivered': case 'not started': return 'danger';
            case 'delivered': case 'started': case 'done': case 'answered': case 'read': return 'success';
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

    return {
        P, css, injectStyle, removeStyle, setConnection, whenConnected, link, hub, useLive,
        timeText, agoText, toneOf, isRecord,
        Page, Card, Empty, ErrorLine, Loading, StateTag, TimeText,
    };
}
// </suite-kit>

        const BUNDLE = 'dsh-plugin-autopilot';
        const PAGE = `${BUNDLE}:page`;
        const kit = suiteKit({ prefix: 'dshap', bundle: BUNDLE, React, ui, h });
        const P = kit.P;
        const api = kit.link(BUNDLE);

        const RULES = [
            { value: 'auto', label: 'Auto' },
            { value: 'ask', label: 'Ask first' },
            { value: 'off', label: 'Off' },
        ];
        const RULE_HINT = {
            auto: 'Autopilot acts on its own.',
            ask: 'Autopilot asks you first, here and in Decisions.',
            off: 'Autopilot leaves the session alone.',
        };

        const TEXT = {
            entry: 'Autopilot',
            title: 'Autopilot',
            summary: 'Keeps your sessions moving when nobody is watching: after a restart it tells cut-off sessions to carry on, it nudges idle sessions with open todos, and it starts goals again that an error stopped.',
            on: 'Autopilot is on',
            off: 'Autopilot is off',
            offLine: 'Off: no notes, no resumes, no goal starts. Nothing it scheduled will run.',
            disabled: 'Autopilot is switched off in its settings (Plugins → Autopilot → enabled), so it watches nothing. Switch it on there to use this page.',
            defaultRule: 'Sessions without their own rule',
            waiting: 'Waiting for you',
            sessions: 'Sessions',
            log: 'What Autopilot did',
            logSub: 'Newest first. Each line says why, and whether the session shows it arrived.',
            noSessions: 'No sessions yet',
            noSessionsText: 'Start a chat in DSH. Autopilot watches every session from its first turn.',
            noWork: 'No session has open work',
            noWorkText: 'Sessions with open todos or an active goal show here. Choose All to see every session.',
            noLog: 'Nothing yet',
            noLogText: 'When Autopilot acts, asks or holds back, it says what and why here.',
            open: 'Open',
            tryAgain: 'Try again',
            sent: 'What it sent',
            loading: 'Reading the sessions',
        };

        const CSS = [
            `.${P}-status{margin:10px 0 0;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `.${P}-switch{display:flex;align-items:center;gap:10px;font:var(--dsw-font-s-strong-14)}`,
            `.${P}-rule-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}`,
            `.${P}-rule-label{font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `.${P}-filters{display:flex;gap:8px;align-items:center}`,
            `.${P}-session-rule{display:flex;flex-direction:column;align-items:flex-end;gap:4px}`,
            `.${P}-session-rule-note{font:var(--dsw-font-xxs-12);color:var(--${P}-text-2)}`,
            `.${P}-details{margin-top:6px}`,
            `.${P}-details>summary{cursor:pointer;font:var(--dsw-font-xs-13);color:var(--${P}-link);width:max-content;border-radius:var(--dsw-radius-xs)}`,
            `.${P}-details>summary:focus-visible{outline:2px solid var(--${P}-ring);outline-offset:1px}`,
            `.${P}-log-time{flex:0 0 auto;min-width:64px;font:var(--dsw-font-xs-13);color:var(--${P}-text-2)}`,
            `@media (max-width:560px){.${P}-item{flex-wrap:wrap}.${P}-item-side{justify-content:flex-start;width:100%}.${P}-session-rule{align-items:flex-start}}`,
        ];

        // ── Data ──────────────────────────────────────────────────────

        const readState = () => api.read('state');

        /** Do something on the host, then refresh; failures come back as words. */
        async function run(method, args) {
            const result = await api.call(method, args);
            if (!result.ok) return result.error?.message || 'Autopilot did not answer.';
            return undefined;
        }

        // ── Parts ─────────────────────────────────────────────────────

        function useOpener(openSession) {
            return React.useCallback((sessionId) => {
                try { openSession?.(sessionId); } catch (error) { console?.warn?.('dsh-plugin-autopilot: could not open the session', error); }
            }, [openSession]);
        }

        function SessionTitle({ title, sessionId, onOpen }) {
            return h('button', { type: 'button', className: `${P}-link ${P}-title`, onClick: () => onOpen(sessionId), title: 'Open this session' }, title);
        }

        /** The kill switch, the summary and the default rule. */
        function HeaderCard({ data, busy, act }) {
            const paused = data.paused;
            const enabled = data.enabled;
            const status = !enabled ? TEXT.disabled
                : paused ? TEXT.offLine
                    : [`Watching ${data.watching} session${data.watching === 1 ? '' : 's'}`,
                        `${data.notesLastHour} of ${data.settings.maxNotesPerHour} notes used this hour`,
                        `a session gets a note after ${Math.round(data.settings.idleSeconds / 60) || 1} quiet minute${Math.round(data.settings.idleSeconds / 60) === 1 ? '' : 's'} with work open`].join(' · ');
            return h(kit.Card, {
                title: TEXT.title,
                headingLevel: 1,
                main: true,
                sub: TEXT.summary,
                actions: enabled ? h('div', { className: `${P}-switch` },
                    h('span', { 'aria-hidden': 'true' }, paused ? 'Off' : 'On'),
                    h(ui.Switch, { checked: !paused, label: paused ? TEXT.off : TEXT.on, disabled: busy, onChange: (next) => act('setPaused', { paused: !next }) })) : null,
                attrs: { 'data-autopilot-header': paused ? 'off' : 'on' },
            },
            h('p', { className: `${P}-status`, role: 'status' }, status),
            enabled ? h('div', { className: `${P}-rule-row` },
                h('span', { className: `${P}-rule-label`, id: `${P}-default-rule-label` }, TEXT.defaultRule),
                h(ui.SegmentedControl, { id: `${P}-default-rule`, label: TEXT.defaultRule, value: data.defaultRule, options: RULES, disabled: busy, onChange: (rule) => act('setDefaultRule', { rule }) }),
                h('span', { className: `${P}-rule-label` }, RULE_HINT[data.defaultRule] ?? '')) : null);
        }

        /** Questions Autopilot waits on, and sessions it backed off from. */
        function WaitingCard({ data, busy, act, onOpen }) {
            const backed = data.sessions.filter((s) => s.backedOff || s.gaveUp);
            if (data.asks.length === 0 && backed.length === 0) return null;
            return h(kit.Card, { title: TEXT.waiting, sub: 'Autopilot holds these until you choose.', attrs: { 'data-autopilot-waiting': '' } },
                h('ul', { className: `${P}-list` },
                    ...data.asks.map((ask) => h('li', { key: ask.id, className: `${P}-item`, 'data-autopilot-ask': ask.id },
                        h('div', { className: `${P}-item-main` },
                            h('div', { className: `${P}-title` }, ask.question),
                            ask.why ? h('div', { className: `${P}-why` }, ask.why) : null,
                            h('div', { className: `${P}-meta` }, 'Asked ', h(kit.TimeText, { at: ask.at }))),
                        h('div', { className: `${P}-item-side` },
                            h(ui.Button, { variant: 'primary', size: 'sm', disabled: busy, onClick: () => act('answer', { id: ask.id, answer: 'go' }) }, ask.recommendation || 'Go ahead'),
                            h(ui.Button, { variant: 'ghost', size: 'sm', disabled: busy, onClick: () => act('answer', { id: ask.id, answer: 'skip' }) }, 'Leave it'),
                            ask.sessionId ? h(ui.Button, { variant: 'ghost', size: 'sm', onClick: () => onOpen(ask.sessionId) }, TEXT.open) : null))),
                    ...backed.map((s) => h('li', { key: `b-${s.sessionId}`, className: `${P}-item`, 'data-autopilot-backed': s.sessionId },
                        h('div', { className: `${P}-item-main` },
                            h(SessionTitle, { title: s.title, sessionId: s.sessionId, onOpen }),
                            h('div', { className: `${P}-why` }, s.gaveUp ? 'Autopilot stopped retrying: it kept failing.' : 'Autopilot backed off: its notes brought no progress.')),
                        h('div', { className: `${P}-item-side` },
                            h(kit.StateTag, { word: 'backed off' }),
                            h(ui.Button, { variant: 'outline', size: 'sm', disabled: busy, onClick: () => act('retry', { sessionId: s.sessionId }) }, TEXT.tryAgain))))));
        }

        function nextText(next) {
            if (!next) return '';
            const at = kit.timeText(next.at);
            const what = next.trigger === 'resume' ? 'resume' : next.trigger === 'error' ? 'retry' : 'check';
            return next.at <= Date.now() + 5000 ? `${what} now` : `${what} at ${at}`;
        }

        function SessionRow({ s, busy, act, onOpen }) {
            const meta = [s.folder, s.work, s.next ? `next: ${nextText(s.next)}` : '', s.last ? `last: ${s.last.text.toLowerCase()} ${kit.agoText(s.last.at)}` : ''].filter(Boolean).join(' · ');
            return h('li', { className: `${P}-item`, 'data-autopilot-session': s.sessionId },
                h('div', { className: `${P}-item-main` },
                    h(SessionTitle, { title: s.title, sessionId: s.sessionId, onOpen }),
                    meta ? h('div', { className: `${P}-meta` }, meta) : null),
                h('div', { className: `${P}-item-side` },
                    h(kit.StateTag, { word: s.word }),
                    h('div', { className: `${P}-session-rule` },
                        h(ui.SegmentedControl, { id: `${P}-rule-${s.sessionId}`, label: `Rule for ${s.title}`, value: s.rule, options: RULES, disabled: busy, onChange: (rule) => act('setRule', { sessionId: s.sessionId, rule }) }),
                        h('span', { className: `${P}-session-rule-note` }, s.own ? h('button', { type: 'button', className: `${P}-link`, disabled: busy, onClick: () => act('setRule', { sessionId: s.sessionId, rule: null }) }, 'Use the default') : 'The default'))));
        }

        function SessionsCard({ data, busy, act, onOpen }) {
            const [filter, setFilter] = React.useState('work');
            const withWork = data.sessions.filter((s) => s.work || s.next || s.word === 'cut off' || s.word === 'failed');
            const shown = filter === 'work' ? withWork : data.sessions;
            return h(kit.Card, {
                title: TEXT.sessions,
                main: true,
                sub: `${data.sessions.length} recent session${data.sessions.length === 1 ? '' : 's'}, ${withWork.length} with work open.`,
                actions: h(ui.SegmentedControl, { id: `${P}-filter`, label: 'Which sessions', value: filter, options: [{ value: 'work', label: 'Open work' }, { value: 'all', label: 'All' }], onChange: setFilter }),
                attrs: { 'data-autopilot-sessions': filter },
            },
            data.sessions.length === 0 ? h(kit.Empty, { title: TEXT.noSessions, text: TEXT.noSessionsText })
                : shown.length === 0 ? h(kit.Empty, { title: TEXT.noWork, text: TEXT.noWorkText, action: h(ui.Button, { variant: 'outline', size: 'sm', onClick: () => setFilter('all') }, 'Show all sessions') })
                    : h('ul', { className: `${P}-list` }, ...shown.map((s) => h(SessionRow, { key: s.sessionId, s, busy, act, onOpen }))));
        }

        const BY_WORDS = { you: 'You', Autopilot: 'Autopilot' };

        function LogRow({ entry, onOpen }) {
            const state = entry.state && entry.state !== 'done' ? entry.state : '';
            return h('li', { className: `${P}-item`, 'data-autopilot-entry': entry.kind },
                h('span', { className: `${P}-log-time` }, h(kit.TimeText, { at: entry.at })),
                h('div', { className: `${P}-item-main` },
                    h('div', null,
                        entry.sessionId ? h(SessionTitle, { title: entry.title || 'Untitled session', sessionId: entry.sessionId, onOpen }) : null,
                        entry.sessionId ? h('span', { className: `${P}-meta` }, ' · ') : null,
                        h('span', null, entry.text),
                        entry.by === 'you' ? h('span', { className: `${P}-meta` }, ` · ${BY_WORDS.you}`) : null),
                    entry.why ? h('div', { className: `${P}-why` }, `Why: ${entry.why}`) : null,
                    entry.reason ? h('div', { className: `${P}-why${state === 'not delivered' ? ` ${P}-error` : ''}` }, state === 'not delivered' ? `Not delivered: ${entry.reason}.` : `${entry.reason[0].toUpperCase()}${entry.reason.slice(1)}.`) : null,
                    entry.note ? h('details', { className: `${P}-details` }, h('summary', null, TEXT.sent), h('p', { className: `${P}-quote` }, entry.note)) : null),
                state ? h('div', { className: `${P}-item-side` }, h(kit.StateTag, { word: state })) : null);
        }

        function LogCard({ data, onOpen }) {
            return h(kit.Card, { title: TEXT.log, sub: TEXT.logSub, main: true, attrs: { 'data-autopilot-log': '' } },
                data.log.length === 0 ? h(kit.Empty, { title: TEXT.noLog, text: TEXT.noLogText })
                    : h('ul', { className: `${P}-list` }, ...data.log.map((entry) => h(LogRow, { key: entry.id, entry, onOpen }))));
        }

        function AutopilotPage({ autopilot }) {
            const live = kit.useLive(readState, ['autopilot', 'sessions', 'asks'], { delayMs: 400 });
            const [busy, setBusy] = React.useState(false);
            const [failure, setFailure] = React.useState(undefined);
            const onOpen = useOpener(autopilot?.openSession);
            const act = React.useCallback(async (method, args) => {
                setBusy(true);
                setFailure(undefined);
                const problem = await run(method, args);
                setBusy(false);
                if (problem) setFailure(problem);
                void live.refresh();
            }, [live.refresh]);
            const data = live.data;
            return h(kit.Page, { label: TEXT.title, attrs: { 'data-autopilot-page': '' } },
                data === undefined
                    ? h(kit.Card, { title: TEXT.title, headingLevel: 1, main: true },
                        live.error ? h(kit.ErrorLine, { lead: 'Couldn\'t read Autopilot', text: live.error, onRetry: live.refresh }) : h(kit.Loading, { text: TEXT.loading }))
                    : [
                        h(HeaderCard, { key: 'head', data, busy, act }),
                        live.error ? h(kit.ErrorLine, { key: 'refresh', text: live.error, onRetry: live.refresh }) : null,
                        failure ? h(kit.ErrorLine, { key: 'act', lead: 'Not changed', text: failure }) : null,
                        data.enabled ? h(WaitingCard, { key: 'waiting', data, busy, act, onOpen }) : null,
                        data.enabled ? h(SessionsCard, { key: 'sessions', data, busy, act, onOpen }) : null,
                        h(LogCard, { key: 'log', data, onOpen }),
                    ]);
        }

        /** The panel entry's glyph, with a count while Autopilot waits on an answer. */
        function AutopilotIcon({ size = 16 }) {
            const live = kit.useLive(() => api.read('badge'), ['autopilot', 'asks'], { delayMs: 600 });
            const asks = live.data?.asks ?? 0;
            const paused = live.data?.paused === true;
            return h('span', { className: `${P}-icon`, 'data-autopilot-icon': paused ? 'off' : 'on' },
                h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: paused ? { opacity: 0.55 } : undefined },
                    h('path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }),
                    h('path', { d: 'M20 4.5v4h-4' }),
                    h('path', { d: 'M10 8.8 15.2 12 10 15.2Z', fill: 'currentColor', stroke: 'none' })),
                asks > 0 ? h('span', { className: `${P}-badge` }, asks > 9 ? '9+' : String(asks)) : null);
        }

        const inject = ['slots'];

        function apply(ctx) {
            try {
                kit.injectStyle(CSS);
            } catch (error) {
                console?.warn?.('dsh-plugin-autopilot: style:', error);
            }
            ctx.effect?.(() => () => kit.removeStyle(), 'autopilot: style');
            ctx.inject(['connection'], (scope) => scope.effect(() => {
                kit.setConnection(scope.connection);
                const detach = kit.hub.attach();
                return () => {
                    detach();
                    kit.setConnection(undefined);
                };
            }, 'autopilot: connection'));
            ctx.inject(['uiWorkspace'], (scope) => applyViews(scope));
        }

        /** The page and its sidebar entry, once DSH's workspace (which opens sessions) is there. */
        function applyViews(ctx) {
            const autopilot = {
                openSession(sessionId) {
                    if (typeof sessionId !== 'string' || sessionId === '') return;
                    try { ctx.uiWorkspace.openSession(sessionId); } catch (error) { console?.warn?.('dsh-plugin-autopilot: could not open the session', error); }
                },
            };
            const withApi = () => ({ autopilot });
            ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PAGE, inject: withApi }, AutopilotPage));
            // After Plugins (0) and Decisions (2), before Agent Terminals (4) and Categories (6).
            ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PAGE, order: 3, label: TEXT.entry }, AutopilotIcon));
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        // For the plugin's own tests.
        module.exports.internals = { kit, TEXT, RULES, CSS, nextText, AutopilotPage, AutopilotIcon, HeaderCard, SessionsCard, LogCard, WaitingCard };
        return module.exports;
    },
});
