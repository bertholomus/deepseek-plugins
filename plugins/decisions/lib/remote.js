/**
 * Decisions' endpoints for its page, served by DSH's own gateway as
 * `/api/dsh-plugin-decisions/<method>`. Parameters are plain names: the
 * gateway reads them from the method source. Every method answers in
 * words a person can read; none throws a raw error at the window.
 *
 * @module dsh-plugin-decisions/remote
 */
import { Remote, RemoteError, bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
import { pageState } from './page.js';

export const NAMESPACE = 'dsh-plugin-decisions';
export const SERVICE = 'dshPluginDecisionsRemote';

export class DecisionsRemote {
    constructor({ inbox, journal, config, mirror, notifications }) {
        this.inbox = inbox;
        this.journal = journal;
        this.config = config;
        this.mirror = mirror;
        this.notifications = notifications;
        this.typertRemote = bindTypertRemote(this, SERVICE, { namespace: NAMESPACE });
    }

    /** Run one endpoint: what it throws reaches the window as its message, in words. */
    async run(work) {
        try {
            return await work();
        } catch (error) {
            throw new RemoteError('decisions/refused', String(error?.message ?? error).slice(0, 300), {});
        }
    }

    off() {
        if (this.config.enabled === false) throw new Error('Decisions is switched off in its settings (Plugins → Decisions → enabled).');
    }

    /** Everything the page shows. */
    async state() {
        return this.run(() => pageState(this));
    }

    /** The panel icon's count: what waits, and how much of it holds a running turn. */
    async badge() {
        return this.run(async () => (this.config.enabled === false ? { waiting: 0, urgent: 0, off: true } : this.inbox.badge()));
    }

    /** Answer one card; `answer`'s shape depends on the card (see Inbox.answer). */
    async answer(id, answer) {
        return this.run(async () => {
            this.off();
            return this.inbox.answer(id, answer);
        });
    }

    /** Hide a card here (the session itself still waits, if it does). */
    async dismiss(id) {
        return this.run(async () => {
            this.off();
            if (typeof id !== 'string' || id === '') throw new Error('Name what to dismiss.');
            return this.inbox.dismiss(id);
        });
    }

    /** Bring a dismissed card back. */
    async undismiss(id) {
        return this.run(async () => {
            this.off();
            if (typeof id !== 'string' || id === '') throw new Error('Name what to bring back.');
            return this.inbox.undismiss(id);
        });
    }

    /** Send a test message through the mirror. */
    async testMirror() {
        return this.run(async () => {
            this.off();
            const result = await this.mirror.test();
            if (!result.ok) throw new Error(`Not sent: ${result.reason}`);
            return { ok: true, place: this.mirror.place };
        });
    }
}

/** Mark methods the way the `@Remote` decorator does in DSH's TypeScript: DSH's gateway serves only marked methods. */
function markRemote(Class, names) {
    for (const name of names) {
        Remote(Class.prototype[name], {
            kind: 'method', name, static: false, private: false,
            addInitializer(init) { init.call(Object.create(Class.prototype)); },
        });
    }
}
markRemote(DecisionsRemote, ['state', 'badge', 'answer', 'dismiss', 'undismiss', 'testMirror']);
