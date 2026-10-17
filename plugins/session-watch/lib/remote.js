/**
 * The watcher's endpoints for the suite's windows, served by DSH's own
 * gateway as `/api/dsh-plugin-session-watch/<method>`.
 *
 * - `wait(since, timeoutMs)`: one request a window keeps open; it answers
 *   when any suite plugin's channel moves (or after `timeoutMs`), so each
 *   plugin's window reads its own state only when something changed.
 * - `sessions()`: every session with its state word, for the suite's pages.
 *
 * Parameters are plain names: the gateway reads them from the method source.
 *
 * @module dsh-plugin-session-watch/remote
 */
import { bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';

/** Wire namespace: the window calls `/api/dsh-plugin-session-watch/<method>`. */
export const NAMESPACE = 'dsh-plugin-session-watch';
/** Cordis service key the gateway finds the service by. */
export const SERVICE = 'dshPluginSessionWatchRemote';

/** Longest a window's open request waits. */
export const MAX_WAIT_MS = 25000;

export class SessionWatchRemote {
    /**
     * @param {import('./watch.js').SessionWatch} watch
     * @param {import('./shared/hub.js').Hub} hub
     */
    constructor(watch, hub) {
        this.watch = watch;
        this.hub = hub;
        this.typertRemote = bindTypertRemote(this, SERVICE, { namespace: NAMESPACE });
    }

    /** Answer when a channel moves past `since`, or after `timeoutMs` (at most 25 s). */
    async wait(since, timeoutMs) {
        const ms = Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 0), MAX_WAIT_MS) : MAX_WAIT_MS;
        return this.hub.wait(since, ms);
    }

    /** Every session DSH lists, with the watcher's state and its state word. */
    async sessions() {
        return { items: await this.watch.list() };
    }
}
