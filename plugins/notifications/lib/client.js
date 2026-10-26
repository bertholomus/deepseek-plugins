/**
 * dsh-plugin-notifications, browser half. Two parts:
 *
 * - The settings page in DSH (Plugins → Notifications), in DSH's
 *   `plugins.bundle.config` slot: a master switch and one per event,
 *   written through DSH's own settings form; where notifications go right
 *   now; whether this window may show them (asked once, from a click); a
 *   test notification; and the recent notifications with what became of
 *   each, the ones from a chat with a button that opens it.
 * - The sender: the browser half polls the plugin's endpoints (remote.js)
 *   for its queue and shows each item through the Web Notifications API
 *   while nobody is looking at the window, then tells the host what became
 *   of each — shown (the system's own show event), not needed, dropped or
 *   failed. A click brings DSH's window up and opens the chat the news is
 *   about. Where DSH sends through its own desktopRuntime, the answer's
 *   `desktop` flag tells this half to stand down.
 *
 * Hand-written in the module format DSH serves to the browser, so the
 * plugin needs no build step. Each part waits for the DSH services it
 * uses, and nothing here may throw at load: DSH joins every plugin's
 * browser half into one script, and one error would stop the others.
 *
 * @module dsh-plugin-notifications/client
 */
// DSH serves browser halves in one script; never throw here, or the others stop loading too.
if (typeof window !== 'undefined' && window.__ModuleLoader__) window.__ModuleLoader__.load({
    id: 'dsh-plugin-notifications',
    factory: (require) => {
        const module = { exports: {} };
        Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' });
        const React = require('react');
        const ui = require('@deepseek-ai/dsh-client-ui-primitives');
        const h = React.createElement;

        /** The plugin's row id in the profile; DSH serves its settings under it. */
        const ENTRY = 'notifications';
        /** The package whose page shows the form, and the wire namespace's other half. */
        const BUNDLE = 'dsh-plugin-notifications';
        /** How often the browser half polls the queue. */
        const POLL_MS = 15000;
        /** How often the settings page reads the status while it is open. */
        const STATUS_MS = 10000;
        /** Queued items older than this are dropped, not shown (notifier.js QUEUE_STALE_MS). */
        const STALE_MS = 5 * 60_000;
        /** How long the window waits for the system's show event before it reports "not confirmed". */
        const SHOW_WAIT_MS = 8000;
        /** More than this many at once: the newest SHOW_SINGLE show alone and the rest in one summary. */
        const SHOW_AT_ONCE = 3;
        const SHOW_SINGLE = 2;
        /** How many recent notifications the page lists. */
        const RECENT_SHOWN = 10;

        /** The events the settings page offers, in the window notice's words. */
        const EVENTS = [
            { field: 'notifyHandback', title: 'Handbacks', hint: 'A thread reported back to its coordinating chat.' },
            { field: 'notifyFinished', title: 'Ended without a handback', hint: 'A thread ended a turn without reporting back.' },
            { field: 'notifyApproval', title: 'Waiting for approval', hint: 'A thread waits on a permission prompt.' },
            { field: 'notifyFailed', title: 'Failed after a nudge', hint: 'A thread failed again after the coordinator nudged it once.' },
            { field: 'notifyStopped', title: 'Stopped after a nudge', hint: 'A thread was stopped again after the coordinator nudged it once.' },
            { field: 'notifyFleet', title: 'Fleet findings', hint: 'An Ascent starts running hot, runs low on memory, logs a GPU error or stops answering, and when that clears.' },
        ];

        const TEXT = {
            summary: 'System notifications when DSH\'s window is hidden or unfocused.',
            enabled: 'Send system notifications',
            enabledHint: 'Other plugins\' news (the coordinator\'s threads, Decisions, Fleet) while you are not looking at DSH. Each switch below covers one kind; news of any other kind follows this switch alone.',
            note: 'A click on a notification brings DSH\'s window up and opens the chat it is about.',
            whereTitle: 'Where they go now',
            permTitle: 'This window',
            permGranted: 'This window may show notifications.',
            permDenied: 'Notifications are blocked for this site in this browser\'s settings. Allow them there, then reload this page.',
            permDefault: 'This browser asks you once before DSH may show notifications. Until you allow them, news waits here for up to 5 minutes.',
            permAsk: 'Allow notifications',
            permNone: 'This window has no notification support, so it cannot show them.',
            permDesktop: 'The Desktop app allows them. macOS decides how they show: System Settings → Notifications → DeepSeek Harness.',
            testTitle: 'A test notification',
            testHint: 'Shows one now from this window, even while you look at it, and says whether the system showed it.',
            testSend: 'Send a test notification',
            testSending: 'Sent. Waiting for the system to say it showed it…',
            recentTitle: 'Recent notifications',
            recentEmpty: 'None yet. News from other plugins shows here with what became of it, so a notification you missed is never lost.',
            recentHint: 'The newest first, with what became of each.',
            recentLog: (file) => `The newest first, with what became of each. Every one is also a line in ${file}.`,
            openChat: 'Open chat',
            unreachable: 'Could not read where notifications go: the plugin did not answer. It tries again by itself.',
            problemsTitle: 'A setting is wrong',
            problemsFix: 'Set it with its switch above and save.',
        };

        /** One word for each state, the same on every line. */
        const STATE_WORDS = { shown: 'Shown', sent: 'Sent', waiting: 'Waiting', 'not shown': 'Not shown', failed: 'Failed' };

        const CSS = [
            // DSH's secondary colour deepened toward its label colour (DESIGN.md §3), for small text in both themes.
            '.dshn-page{--dshn-text-2:color-mix(in srgb,var(--dsw-alias-label-secondary) 80%,var(--dsw-alias-label-primary));color:var(--dsw-alias-label-primary)}',
            '.dshn-section{padding:8px 0}',
            '.dshn-row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:4px 0;flex-wrap:wrap}',
            '.dshn-row-text{min-width:0;flex:1 1 240px}',
            '.dshn-row>button,.dshn-row>[role=switch]{flex:0 0 auto}',
            '.dshn-title{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary)}',
            '.dshn-hint{margin:2px 0 0;font:var(--dsw-font-xs-13);color:var(--dshn-text-2);overflow-wrap:anywhere}',
            '.dshn-hint:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:4px}',
            '.dshn-note{margin:8px 0 0;font:var(--dsw-font-xs-13);color:var(--dshn-text-2);overflow-wrap:anywhere}',
            '.dshn-problem{margin:8px 0 0;font:var(--dsw-font-xs-13);color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary));overflow-wrap:anywhere}',
            '.dshn-list{list-style:none;margin:6px 0 0;padding:0;border-top:.5px solid var(--dsw-alias-border-l2)}',
            '.dshn-item{display:flex;align-items:flex-start;gap:12px;padding:8px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}',
            '.dshn-when{flex:0 0 auto;min-width:64px;font:var(--dsw-font-xs-13);font-variant-numeric:tabular-nums;color:var(--dshn-text-2)}',
            '.dshn-what{flex:1 1 220px;min-width:0}',
            '.dshn-what-title{font:var(--dsw-font-s-14);color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
            '.dshn-what-state{margin-top:2px;font:var(--dsw-font-xs-13);color:var(--dshn-text-2);overflow-wrap:anywhere}',
            '.dshn-word{font:var(--dsw-font-xs-strong-13)}',
            '.dshn-item[data-notifications-state=shown] .dshn-word{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 60%,var(--dsw-alias-label-primary))}',
            '.dshn-item[data-notifications-state=failed] .dshn-word{color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 85%,var(--dsw-alias-label-primary))}',
            '.dshn-item>button{flex:0 0 auto}',
            'body.wp-still .dshn-page,body.wp-still .dshn-page::before,body.wp-still .dshn-page::after,body.wp-still .dshn-page *,body.wp-still .dshn-page *::before,body.wp-still .dshn-page *::after{animation:none!important;transition:none!important}',
            '@media (prefers-reduced-motion:reduce){.dshn-page,.dshn-page::before,.dshn-page::after,.dshn-page *,.dshn-page *::before,.dshn-page *::after{animation:none!important;transition:none!important}}',
        ].join('\n');

        /** One style sheet for the whole plugin, appended to <head> once. */
        function injectStyle(doc = document) {
            if (doc.querySelector('style[data-plugin="dsh-plugin-notifications"]')) return;
            const style = doc.createElement('style');
            style.setAttribute('data-plugin', 'dsh-plugin-notifications');
            style.setAttribute('data-plugin-css', 'dsh-plugin-notifications/client.css');
            style.textContent = CSS;
            doc.head.appendChild(style);
        }

        function removeStyle(doc = document) {
            for (const el of doc.querySelectorAll('style[data-plugin="dsh-plugin-notifications"]')) el.remove();
        }

        const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

        /** The services the parts share, set by their injects (each may be missing). */
        const shared = { link: undefined, openSession: undefined, openPage: undefined };

        /** Web Notifications in this window: 'granted', 'denied', 'default', 'desktop' (the Desktop app), or 'none' where the API is missing. */
        function permissionState(scope = globalThis) {
            const Notification = scope.Notification;
            if (typeof Notification !== 'function') return 'none';
            if (scope.navigator?.userAgent?.includes('Electron') && Notification.permission !== 'denied') return 'desktop';
            return Notification.permission === 'granted' || Notification.permission === 'denied' ? Notification.permission : 'default';
        }

        /** Ask once, from a click; resolves to the permission after the user answers. */
        async function askPermission(scope = globalThis) {
            const Notification = scope.Notification;
            if (typeof Notification?.requestPermission !== 'function') return 'none';
            try {
                return await Notification.requestPermission();
            } catch {
                return 'denied';
            }
        }

        const permissionLine = (kind) => (kind === 'granted' ? TEXT.permGranted
            : kind === 'denied' ? TEXT.permDenied
            : kind === 'desktop' ? TEXT.permDesktop
            : kind === 'none' ? TEXT.permNone
            : TEXT.permDefault);

        /** The permission row: state in words, and the one-time ask as a button. Focus stays in the row after the ask. */
        function PermissionRow({ permState = permissionState, askFor = askPermission }) {
            const [kind, setKind] = React.useState(() => permState());
            const hint = React.useRef(null);
            const asked = React.useRef(false);
            const kindNow = React.useRef(kind);
            kindNow.current = kind;
            const ask = async () => {
                const answer = await askFor();
                const next = answer === 'granted' || answer === 'denied' ? answer : permState();
                // Only an answer takes the button away; dismissed, it stays where the keyboard is.
                asked.current = next !== kindNow.current;
                setKind(next);
            };
            // The button goes away with the answer: once it is gone, keep the keyboard's place on the row's words.
            React.useEffect(() => {
                if (!asked.current) return;
                asked.current = false;
                try { hint.current?.focus?.(); } catch { /* the row may be gone */ }
            }, [kind]);
            return h('section', { className: 'dshn-section', 'data-notifications-permission': kind },
                h('div', { className: 'dshn-row' },
                    h('div', { className: 'dshn-row-text' },
                        h('div', { className: 'dshn-title' }, TEXT.permTitle),
                        h('div', { className: 'dshn-hint', ref: hint, tabIndex: -1, role: 'status' }, permissionLine(kind))),
                    kind === 'default' ? h(ui.Button, { variant: 'outline', size: 'sm', onClick: ask }, TEXT.permAsk) : null));
        }

        /** The settings page's field specs: DSH's form stages drafts as text, so on/off are the words. A value that is not a switch shows as the default the plugin uses (on). */
        const boolSpec = (field) => ({
            field,
            format: (value) => ((typeof value === 'boolean' ? value : true) ? 'on' : 'off'),
            parse: (text) => (text === 'on' ? { kind: 'set', value: true } : text === 'off' ? { kind: 'set', value: false } : undefined),
        });

        const FIELDS = ['enabled', ...EVENTS.map((event) => event.field)];

        const LABELS = {
            unavailable: 'The notifications plugin is not running, so its settings cannot be changed right now.',
            readOnly: 'This DSH stores settings read-only.',
            saveFailed: 'DSH did not save these. Your choices are still here, so you can try again.',
            save: 'Save',
            saving: 'Saving…',
        };

        /** A time of day as people read it ("10:42 AM"), with the date when it is not today. */
        function whenWords(iso, now = new Date()) {
            const at = new Date(iso);
            if (Number.isNaN(at.getTime())) return '';
            const time = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            return at.toDateString() === now.toDateString() ? time : `${at.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
        }

        /** Where notifications go now, in a sentence, from the host's status. */
        function whereWords(status, enabled) {
            if (enabled === false) return 'Notifications are switched off. Switch on “Send system notifications” above and save to get them.';
            if (!isRecord(status)) return '';
            if (status.sender === 'desktop') return 'DSH\'s own desktop notifications send them. They skip while you are looking at DSH.';
            if (status.sender === 'window' && status.desktopHost) return 'This DSH window shows them, with DSH\'s icon, while it is hidden, minimised or behind other windows — not while you are looking at it.';
            if (status.sender === 'window') return `A DSH window in your browser shows them while you are not looking at it${status.windowSeenAt ? ` (it last checked in at ${whenWords(status.windowSeenAt)})` : ''}. Keep a DSH tab open to get them.`;
            if (status.sender === 'command') return `No DSH window has checked in for a while, so they go to ${status.platform === 'win32' ? 'a PowerShell toast' : 'notify-send'}.`;
            return status.platform === 'darwin'
                ? 'No DSH window has checked in for a while, and macOS has no other sender that shows DSH\'s icon: news is listed below but not shown until a DSH window is open.'
                : 'No DSH window has checked in for a while, and this system has no notification command DSH can use: news is listed below but not shown.';
        }

        /**
         * The host's status, read when the page opens, every STATUS_MS while
         * the window can be seen, and when `bump` changes (after a test).
         */
        function useStatus(linkOf, bump, { every = STATUS_MS } = {}) {
            const [state, setState] = React.useState({ status: undefined, failed: false });
            React.useEffect(() => {
                let live = true;
                const read = async () => {
                    const link = linkOf();
                    if (!link) return;
                    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
                    try {
                        const result = await link.call('status', {});
                        if (!live) return;
                        if (isRecord(result) && result.ok === true && isRecord(result.value)) setState({ status: result.value, failed: false });
                        else setState((before) => ({ status: before.status, failed: true }));
                    } catch {
                        if (live) setState((before) => ({ status: before.status, failed: true }));
                    }
                };
                void read();
                const timer = setInterval(() => { void read(); }, every);
                return () => {
                    live = false;
                    clearInterval(timer);
                };
            }, [bump]);
            return state;
        }

        /**
         * Send one test notification from a user click (so a permission ask
         * is allowed too), name the outcome on the page — shown (the
         * system's own show event), blocked, or failed and why — and tell
         * the host, so the log and the recent list have it too.
         */
        function useTestSend(linkOf, onDone = () => {}, { Notification = globalThis.Notification, win = typeof window === 'undefined' ? undefined : window, wait = SHOW_WAIT_MS } = {}) {
            const [line, setLine] = React.useState('');
            const send = async () => {
                const report = (outcome, detail = '') => {
                    void Promise.resolve(linkOf()?.call('noteTest', { outcome, detail })).catch(() => {}).finally(onDone);
                };
                if (typeof Notification !== 'function') {
                    setLine(`Not shown: ${TEXT.permNone}`);
                    report('failed', 'this window has no notification support');
                    return;
                }
                let permission = Notification.permission;
                if (permission === 'default') permission = await askPermission({ Notification });
                if (permission === 'denied') {
                    setLine(`Not shown: ${TEXT.permDenied}`);
                    report('denied');
                    return;
                }
                setLine(TEXT.testSending);
                showNotification({ id: 0, key: 'test', title: 'Notifications test', body: 'If you can read this, DSH can show you notifications.' }, {
                    Notification,
                    win,
                    wait,
                    onResult: (outcome, detail) => {
                        setLine(outcome === 'shown' ? 'Shown: the system reported showing it.'
                            : outcome === 'unconfirmed' ? 'Sent, but the system did not say it showed it. Focus or Do Not Disturb can hold notifications back.'
                            : `Not shown: ${detail || 'the system refused it'}.`);
                        report(outcome, detail);
                    },
                });
            };
            return [line, send];
        }

        /** One recent notification: when, what, what became of it, and a way to the chat. */
        function RecentItem({ item, openSession }) {
            const word = STATE_WORDS[item.state] ?? item.state;
            return h('li', { className: 'dshn-item', 'data-notifications-item': item.id, 'data-notifications-state': item.state },
                h('span', { className: 'dshn-when' }, whenWords(item.at)),
                h('div', { className: 'dshn-what' },
                    h('div', { className: 'dshn-what-title' }, item.title),
                    h('div', { className: 'dshn-what-state' }, h('span', { className: 'dshn-word' }, `${word}. `), item.detail ?? '')),
                item.sessionId && openSession
                    ? h(ui.Button, { variant: 'ghost', size: 'sm', 'aria-label': `${TEXT.openChat}: ${item.title}`, onClick: () => openSession(item.sessionId) }, TEXT.openChat)
                    : null);
        }

        /** The plugin page's switches, written through DSH's settings form on Save; then where they go, this window, a test, and the recent ones. */
        function SettingsPage({ form, linkOf = () => shared.link, openerOf = () => shared.openSession }) {
            const snapshot = React.useSyncExternalStore(form.subscribe, form.getSnapshot);
            const disabled = !snapshot.writable || snapshot.saving;
            const on = (name) => snapshot[name]?.text === 'on';
            const toggle = (name) => (next) => form.actions.edit(name, next ? 'on' : 'off');
            const [bump, setBump] = React.useState(0);
            // A save applies at once (the settings are live): read where they go and what is wrong again when it lands.
            const saving = Boolean(snapshot.saving);
            const wasSaving = React.useRef(saving);
            React.useEffect(() => {
                if (wasSaving.current && !saving) setBump((n) => n + 1);
                wasSaving.current = saving;
            }, [saving]);
            const { status, failed } = useStatus(linkOf, bump);
            const [testLine, sendTest] = useTestSend(linkOf, () => setBump((n) => n + 1));
            const openSession = openerOf();
            const recent = Array.isArray(status?.recent) ? status.recent.filter(isRecord).slice(0, RECENT_SHOWN) : [];
            const problems = Array.isArray(status?.problems) ? status.problems.filter(isRecord) : [];
            const where = whereWords(status, status?.enabled);
            return h('div', { className: 'dshn-page', 'data-notifications-settings': true },
                h(ui.SettingsForm, { labels: LABELS, state: snapshot, onSave: form.actions.save, onDiscard: form.actions.discard },
                    h('section', { className: 'dshn-section', 'data-notifications-master': '' },
                        h('div', { className: 'dshn-row' },
                            h('div', { className: 'dshn-row-text' },
                                h('div', { className: 'dshn-title' }, TEXT.enabled),
                                h('div', { className: 'dshn-hint' }, TEXT.enabledHint)),
                            h(ui.Switch, { checked: on('enabled'), label: TEXT.enabled, disabled, onChange: toggle('enabled') }))),
                    ...EVENTS.map((event) => h('section', { key: event.field, className: 'dshn-section', 'data-notifications-event': event.field },
                        h('div', { className: 'dshn-row' },
                            h('div', { className: 'dshn-row-text' },
                                h('div', { className: 'dshn-title' }, event.title),
                                h('div', { className: 'dshn-hint' }, event.hint)),
                            h(ui.Switch, { checked: on(event.field), label: event.title, disabled, onChange: toggle(event.field) })))),
                    h('p', { className: 'dshn-note' }, TEXT.note)),
                problems.length > 0
                    ? h('section', { className: 'dshn-section', 'data-notifications-problems': '', role: 'alert' },
                        h('div', { className: 'dshn-title' }, TEXT.problemsTitle),
                        ...problems.map((problem) => h('p', { key: problem.key, className: 'dshn-problem' }, `${problem.text}. ${TEXT.problemsFix}`)))
                    : null,
                h('section', { className: 'dshn-section', 'data-notifications-where': status?.sender ?? (failed ? 'unreachable' : 'loading') },
                    h('div', { className: 'dshn-title' }, TEXT.whereTitle),
                    h('div', { className: 'dshn-hint' }, where || (failed ? TEXT.unreachable : 'Reading…')),
                    status && failed ? h('div', { className: 'dshn-hint' }, TEXT.unreachable) : null),
                h(PermissionRow),
                h('section', { className: 'dshn-section', 'data-notifications-test': '' },
                    h('div', { className: 'dshn-row' },
                        h('div', { className: 'dshn-row-text' },
                            h('div', { className: 'dshn-title' }, TEXT.testTitle),
                            h('div', { className: 'dshn-hint' }, TEXT.testHint)),
                        h(ui.Button, { variant: 'outline', size: 'sm', onClick: () => { void sendTest(); } }, TEXT.testSend)),
                    h('p', { className: 'dshn-note', role: 'status', 'data-notifications-test-result': '' }, testLine)),
                h('section', { className: 'dshn-section', 'data-notifications-recent': String(recent.length), 'aria-label': TEXT.recentTitle },
                    h('div', { className: 'dshn-title' }, TEXT.recentTitle),
                    h('div', { className: 'dshn-hint', 'data-notifications-recent-hint': '' },
                        recent.length > 0 ? (typeof status?.logFile === 'string' && status.logFile ? TEXT.recentLog(status.logFile) : TEXT.recentHint) : status ? TEXT.recentEmpty : ''),
                    recent.length > 0 ? h('ul', { className: 'dshn-list' }, ...recent.map((item) => h(RecentItem, { key: item.id, item, openSession }))) : null));
        }

        /** The plugin page on DSH's Plugins page, served while the plugin runs. */
        function applySettingsForm(scope) {
            const configScope = scope.configForms.get(ENTRY);
            const model = new ui.SettingsFormModel(configScope, FIELDS.map(boolSpec));
            const store = model.bind(() => ({
                ...model.shell(),
                ...Object.fromEntries(FIELDS.map((name) => [name, model.field(name)])),
            }));
            const form = {
                subscribe: (listener) => store.subscribe(listener),
                getSnapshot: () => store.getSnapshot(),
                actions: model.actions(),
            };
            const Page = (props) => (props?.view === 'summary' ? TEXT.summary : h(SettingsPage, { form }));
            scope.effect(() => () => model.dispose(), 'notifications: settings form');
            scope.effect(() => scope.configForms.whileServed([ENTRY], () => scope.slots.inject('plugins.bundle.config', () => scope.slots.register({
                name: 'plugins.bundle.config',
                key: BUNDLE,
            }, Page))), 'notifications: settings page');
        }

        /** The window's link to the plugin's endpoints (remote.js), like DSH's own panels use. */
        function hostLink(connectionOf) {
            return {
                /** Never throws: a call that could not be made answers as a refusal does. */
                async call(method, args) {
                    try {
                        const connection = connectionOf();
                        if (!connection) return { ok: false, error: { code: 'notifications/unreachable', message: 'the window is not connected to DSH yet' } };
                        const result = await connection.rpc.call('/api', `${BUNDLE}/${method}`, { args });
                        return isRecord(result) && (result.ok === true || (result.ok === false && isRecord(result.error))) ? result
                            : { ok: false, error: { code: 'notifications/unreadable', message: 'the plugin sent an answer this window cannot read' } };
                    } catch (error) {
                        return { ok: false, error: { code: 'notifications/unreachable', message: String(error?.message ?? error) } };
                    }
                },
            };
        }

        /** Keys of the items this window has shown, so a reload never shows one twice. */
        const SHOWN_KEY = `${BUNDLE}/shown`;

        function shownKeys(storage = globalThis.localStorage) {
            try {
                const list = JSON.parse(storage?.getItem(SHOWN_KEY) ?? '[]');
                return new Set(Array.isArray(list) ? list.filter((key) => typeof key === 'string') : []);
            } catch {
                return new Set();
            }
        }

        function rememberShown(keys, storage = globalThis.localStorage) {
            try {
                storage?.setItem(SHOWN_KEY, JSON.stringify([...keys].slice(-100)));
            } catch { /* storage may refuse: the in-memory set still holds for this window */ }
        }

        /**
         * Show one notification. A click brings the window up and opens the
         * chat it is about. What the system did comes back once through
         * `onResult`: 'shown' (its show event), 'failed' with the reason
         * (its error event, or a constructor that threw), or 'unconfirmed'
         * when neither came within `wait` ms.
         */
        function showNotification(item, { Notification = globalThis.Notification, win = globalThis.window, onResult = () => {}, wait = SHOW_WAIT_MS, openSession = () => shared.openSession, openPage = () => shared.openPage } = {}) {
            let settled = false;
            const settle = (outcome, detail = '') => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                try { onResult(outcome, detail); } catch { /* a report never stops the sender */ }
            };
            let notification;
            const timer = setTimeout(() => settle('unconfirmed'), wait);
            timer.unref?.();
            try {
                notification = new Notification(item.title, { body: item.body ?? '', tag: `${BUNDLE}:${item.key ?? item.id}` });
            } catch (error) {
                settle('failed', String(error?.message ?? error).slice(0, 200));
                return undefined;
            }
            notification.onshow = () => settle('shown');
            notification.onerror = () => settle('failed', 'the system refused to show it');
            notification.onclick = () => {
                try { win?.focus?.(); } catch { /* the window may be gone */ }
                const open = openSession();
                const page = openPage();
                if (item.sessionId && typeof open === 'function') {
                    try { open(item.sessionId); } catch { /* the chat may be gone */ }
                } else if (item.page && typeof page === 'function') {
                    // A summary of several: its click opens the recent list on the plugin's page.
                    try { page(); } catch { /* DSH may have no Plugins page here */ }
                }
                try { notification.close(); } catch { /* already closed */ }
            };
            return notification;
        }

        /** Which items show alone and which share one summary notification. */
        function planShows(items) {
            if (items.length <= SHOW_AT_ONCE) return { single: items, summarized: [] };
            return { single: items.slice(-SHOW_SINGLE), summarized: items.slice(0, -SHOW_SINGLE) };
        }

        /** The one notification for several that came at once. */
        function summaryOf(items) {
            const titles = items.map((item) => item.title).filter(Boolean);
            const body = titles.join(' · ');
            return {
                id: items[0].id,
                key: `summary:${items.map((item) => item.id).join(',')}`,
                title: `DSH: ${items.length} more updates`,
                body: body.length > 300 ? `${body.slice(0, 299)}…` : body,
                page: true,
            };
        }

        /**
         * Ask once where an ask can work without a click: the Desktop app's
         * window (Electron) grants it; a browser needs the settings page's
         * Allow button, because its prompt is refused without a user gesture.
         */
        function ensurePermissionOnce(Notification = globalThis.Notification, nav = (typeof navigator === 'undefined' ? undefined : navigator)) {
            if (typeof Notification !== 'function' || Notification.permission !== 'default') return;
            if (!nav?.userAgent?.includes('Electron')) return;
            try {
                void Notification.requestPermission?.();
            } catch { /* the ask is best-effort; the settings page can ask again */ }
        }

        /**
         * The sender: poll the queue, show what is new while nobody looks at
         * the window, take the rest, and say what became of each. When the
         * answer says the Desktop app sends natively, stand down entirely.
         * The queue is only taken where it can be shown or is worthless: with
         * permission still 'default' the items wait in the host's queue, so
         * they show once the ask is answered.
         */
        function applyPoller(scope, link, { now = Date.now, Notification = globalThis.Notification, win = typeof window === 'undefined' ? undefined : window, doc = typeof document === 'undefined' ? undefined : document, storage = globalThis.localStorage, warn = (message) => console?.warn?.(message), wait = SHOW_WAIT_MS } = {}) {
            const seen = shownKeys(storage);
            const state = { stopped: false, desktopHandled: false, transportFailed: false };
            const stop = () => {
                state.stopped = true;
            };
            const transportTrouble = (detail) => {
                if (!state.transportFailed) {
                    state.transportFailed = true;
                    warn(`dsh-plugin-notifications: the queue is unreachable right now (${detail}); retrying`);
                }
            };
            const tell = (ids, results) => {
                if (ids.length === 0 && results.length === 0) return;
                void Promise.resolve(link.call('acknowledge', { ids, results })).catch(() => {});
            };
            let inflight;
            /** One read at a time: a call while one runs gets that one's answer. */
            const read = () => {
                if (state.stopped) return Promise.resolve(0);
                if (inflight) return inflight;
                inflight = readOnce().catch(() => 0).finally(() => { inflight = undefined; });
                return inflight;
            };
            const readOnce = async () => {
                let result;
                try {
                    result = await link.call('pending', {});
                } catch (error) {
                    transportTrouble(String(error?.message ?? error));
                    return 0;
                }
                if (state.stopped) return 0;
                if (!isRecord(result) || result.ok !== true || !isRecord(result.value)) {
                    transportTrouble(isRecord(result) && isRecord(result.error) ? String(result.error.code ?? result.error.message ?? 'refused') : 'unreadable answer');
                    return 0;
                }
                state.transportFailed = false;
                if (result.value.desktop === true) {
                    state.desktopHandled = true;
                    stop();
                    return 0;
                }
                const epoch = typeof result.value.epoch === 'string' ? result.value.epoch : '';
                const items = Array.isArray(result.value.items) ? result.value.items.filter((item) => isRecord(item) && typeof item.id === 'number') : [];
                if (items.length === 0) return 0;
                // No notification support here: take nothing (another window may show them, or the host drops them in words).
                if (typeof Notification !== 'function') return 0;
                const permission = Notification.permission;
                // permission 'default': take nothing, so the items wait in the queue and show once the ask is answered.
                if (permission !== 'granted' && permission !== 'denied') return 0;
                // Not watching = the window cannot be seen (hidden or minimised)
                // or does not have focus. hasFocus can lie for a hidden window,
                // so ask visibility too.
                const watching = Boolean(doc && doc.hasFocus() && doc.visibilityState !== 'hidden');
                const took = [];
                const results = [];
                const toShow = [];
                for (const item of items) {
                    const key = `${epoch}:${item.id}`;
                    const at = typeof item.at === 'string' ? Date.parse(item.at) : NaN;
                    took.push(item.id);
                    if (seen.has(key)) continue; // shown before a reload: never twice
                    if (Number.isFinite(at) && now() - at > STALE_MS) results.push({ id: item.id, outcome: 'stale' });
                    else if (permission === 'denied') results.push({ id: item.id, outcome: 'denied' });
                    else if (watching || !doc) results.push({ id: item.id, outcome: 'watching' });
                    else toShow.push({ ...item, key });
                }
                const { single, summarized } = planShows(toShow);
                for (const item of [...single, ...summarized]) seen.add(item.key);
                if (single.length + summarized.length > 0) rememberShown(seen, storage);
                tell(took, results);
                let shown = 0;
                for (const item of single) {
                    shown += 1;
                    showNotification(item, { Notification, win, wait, onResult: (outcome, detail) => tell([], [{ id: item.id, outcome: outcome === 'unconfirmed' ? 'unconfirmed' : outcome, detail }]) });
                }
                if (summarized.length > 0) {
                    shown += 1;
                    showNotification(summaryOf(summarized), {
                        Notification, win, wait,
                        onResult: (outcome, detail) => tell([], summarized.map((item) => ({ id: item.id, outcome: outcome === 'shown' ? 'summary' : outcome, detail }))),
                    });
                }
                return shown;
            };
            ensurePermissionOnce(Notification);
            const timer = setInterval(() => { void read(); }, POLL_MS);
            const wake = () => { void read(); };
            if (doc) {
                doc.addEventListener('visibilitychange', wake);
                win?.addEventListener?.('focus', wake);
                win?.addEventListener?.('blur', wake);
            }
            // The first look right away, so news that waited through a reload shows without a 15 s wait.
            void read();
            scope.effect(() => () => {
                stop();
                clearInterval(timer);
                if (doc) {
                    doc.removeEventListener('visibilitychange', wake);
                    win?.removeEventListener?.('focus', wake);
                    win?.removeEventListener?.('blur', wake);
                }
            }, 'notifications: browser sender');
            return { read, state };
        }

        const inject = ['slots'];

        function apply(ctx) {
            // One part failing must not stop the others (DESIGN.md §8).
            try {
                injectStyle();
                ctx.effect?.(() => () => {
                    try { removeStyle(); } catch { /* the page may be gone */ }
                }, 'notifications: style');
            } catch (error) {
                console?.warn?.('dsh-plugin-notifications: style:', error);
            }
            ctx.inject(['connection'], (scope) => {
                try {
                    const link = hostLink(() => scope.connection);
                    shared.link = link;
                    scope.effect(() => () => { if (shared.link === link) shared.link = undefined; }, 'notifications: link');
                    applyPoller(scope, link);
                } catch (error) {
                    console?.warn?.('dsh-plugin-notifications: browser sender:', error);
                }
            });
            // DSH's workspace opens chats: a click on a notification, and the page's Open chat.
            ctx.inject(['uiWorkspace'], (scope) => {
                const open = (sessionId) => {
                    if (typeof sessionId !== 'string' || sessionId === '') return;
                    try { scope.uiWorkspace.openSession(sessionId); } catch (error) { console?.warn?.('dsh-plugin-notifications: could not open the chat', error); }
                };
                shared.openSession = open;
                return () => { if (shared.openSession === open) shared.openSession = undefined; };
            });
            // DSH's Plugins page: a click on a summary notification opens the recent list here.
            ctx.inject(['pluginNavigation'], (scope) => {
                const open = () => {
                    try { scope.pluginNavigation.openBundle?.(BUNDLE); } catch (error) { console?.warn?.('dsh-plugin-notifications: could not open its page', error); }
                };
                shared.openPage = open;
                return () => { if (shared.openPage === open) shared.openPage = undefined; };
            });
            ctx.inject(['configForms', 'remote', 'remote.session'], (scope) => {
                try {
                    applySettingsForm(scope);
                } catch (error) {
                    console?.warn?.('dsh-plugin-notifications: settings page:', error);
                }
            });
        }

        module.exports.inject = inject;
        module.exports.apply = apply;
        // For the plugin's own tests: the pure helpers the parts are built on.
        module.exports.internals = {
            FIELDS, EVENTS, TEXT, LABELS, CSS, STATE_WORDS, SHOW_AT_ONCE, SHOW_SINGLE, boolSpec, injectStyle, removeStyle, permissionState, askPermission, permissionLine, ensurePermissionOnce, hostLink, showNotification, planShows, summaryOf, shownKeys, rememberShown, whereWords, whenWords, isRecord, applyPoller, applySettingsForm, shared, SettingsPage, RecentItem,
        };
        return module.exports;
    },
});
