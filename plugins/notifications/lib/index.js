/**
 * dsh-plugin-notifications — system notifications when DSH's window is
 * hidden or unfocused, for other plugins to call.
 *
 * The host half gates every notification on the plugin's settings and sends
 * it through the first sender that is around (see notifier.js and
 * backends.js): DSH's own desktopRuntime where DSH provides it, the
 * plugin's browser half in a DSH window, and a command-line sender when no
 * window is watching (never on macOS). Every notification is logged with
 * what became of it (in its own log file: DSH 0.2 writes no plugin's log
 * lines out), and the last ones are kept on disk with the queue, so a
 * restart loses nothing and repeats nothing.
 *
 * Other plugins call it through the notifications service
 * (`ctx.inject(['notifications'], (notifications) => …)`):
 *
 *     notifications.notify({ title: '“Fix CI” handed back', body: '', kind: 'handback', sessionId });
 *
 * `kind` is optional and gates on that event's switch; `sessionId` lets a
 * click on the notification open that chat in DSH's window.
 *
 * @module dsh-plugin-notifications
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { checkSettings } from './config.js';
import { Notifier } from './notifier.js';
import { NotificationsRemote, SERVICE } from './remote.js';
import { LogFile, StateFile } from './state.js';

export const name = 'notifications';

/** Host services the plugin drives: none required, everything is probed. */
export const inject = [];

/**
 * Settings: switches, on by default. Each takes any value, so a wrong type
 * in the profile ("yes" for true, say) never stops the plugin: it counts as
 * the default, its log says so at start, and the settings page names it
 * (config.js). A save on the settings page restarts the plugin, which costs
 * nothing: the queue and the recent list are on disk.
 */
export const Config = z.object({
    /** Master switch: no notification at all when off (callers are told 'off'). */
    enabled: z.any().default(true),
    /** A thread's handback (the coordinator). */
    notifyHandback: z.any().default(true),
    /** A thread that ended a turn without a handback (the coordinator). */
    notifyFinished: z.any().default(true),
    /** A thread waiting on a permission prompt (the coordinator). */
    notifyApproval: z.any().default(true),
    /** A thread that failed after the coordinator nudged it once. */
    notifyFailed: z.any().default(true),
    /** A thread that was stopped after the coordinator nudged it once. */
    notifyStopped: z.any().default(true),
    /** Fleet: a finding on an Ascent that starts, gets worse or clears (running hot, low memory, a GPU error). */
    notifyFleet: z.any().default(true),
});

/** A path as the page shows it: the home folder as ~. */
const shownPath = (path) => {
    const home = homedir();
    return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
};

export function apply(ctx, config) {
    const { settings, problems } = checkSettings(config);
    // Its folder in DSH's data folder, as DSH resolves it (DSH_HOME, else ~/.dsh).
    const folder = dshHomePath('notifications');
    // Every line goes to DSH's logger (kept in memory by DSH 0.2) and to the
    // plugin's own file, which is where it can be read.
    const logFile = new LogFile(join(folder, 'notifications.log'));
    let logFailed = false;
    const line = (level, format, text) => {
        try { ctx.logger?.[level]?.(format, text); } catch { /* the log never fails the plugin */ }
        const written = logFile.write(level, String(text).replace(/^notifications: /, ''));
        if (!written && !logFailed) {
            logFailed = true;
            try { ctx.logger?.warn?.('%s', `notifications: could not write its log file ${logFile.file}`); } catch { /* as above */ }
        }
        if (written) logFailed = false;
    };
    const logger = { info: (format, text) => line('info', format, text), warn: (format, text) => line('warn', format, text) };
    const log = (level, text) => line(level, '%s', `notifications: ${text}`);
    for (const problem of problems) log('warn', `a setting is wrong: ${problem.text}`);
    const store = new StateFile(join(folder, 'state.json'), {
        onError: (what, error) => log('warn', `${what} (${String(error?.message ?? error).slice(0, 200)})`),
    });
    const notifier = new Notifier({
        settings: () => settings,
        logger,
        logFile: shownPath(logFile.file),
        platform: process.platform,
        // The Desktop host is Electron: its window's browser half exists even
        // while the window is hidden or minimised, so the queue is always for
        // it. DSH_CLIENT_VERSION is the Desktop build's inlined version when a
        // future build exports it; process.versions.electron is the signal
        // today's host process carries (a terminal DSH is plain Node).
        desktopHost: process.versions?.electron !== undefined || process.env.DSH_CLIENT_VERSION !== undefined,
        store,
        problems,
    });
    log('info', `started (${settings.enabled ? 'on' : 'switched off in its settings'}; ${notifier.desktopHost ? 'the Desktop app' : 'no Desktop app'}; sender now: ${notifier.sender()})`);

    // DSH's own sender (Electron main), where DSH provides it. It already
    // skips while the window is focused and shows the window on a click.
    ctx.inject(['desktopRuntime'], (scope) => {
        const runtime = scope.desktopRuntime;
        notifier.desktop = runtime;
        log('info', 'DSH\'s own desktop notifications are here: they send from now on');
        return () => { if (notifier.desktop === runtime) notifier.desktop = undefined; };
    });

    // The browser half polls this: the queue for a browser window, the
    // desktop flag that tells it to stand down, and the settings page's status.
    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new NotificationsRemote(notifier));
    });

    // What other plugins call, e.g. the coordinator on its news. It never throws.
    ctx.provide('notifications', {
        notify: (notification) => notifier.notify(notification),
    });

    ctx.effect(() => () => {
        notifier.save();
    }, 'notifications: notifier');
}
