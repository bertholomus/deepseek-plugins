/**
 * dsh-plugin-session-watch — the shared session watcher for the suite.
 *
 * Autopilot, Decisions and Agent Terminals all need to know what every
 * session is doing: whether a turn runs, how the last one ended, its todos,
 * its goal, the approvals it waits on. This plugin is the one place that
 * reads it, from DSH's own events, and serves it to them as the
 * `sessionWatch` service (lib/watch.js):
 *
 *     ctx.inject(['sessionWatch'], (scope) => {
 *         const watch = scope.sessionWatch;
 *         watch.on((event) => { if (event.type === 'turn-end') … });
 *         await watch.deliver(sessionId, 'Carry on.');   // resolves on proof, never on "sent"
 *     });
 *
 * Nothing polls: DSH drives the watcher's projection (lib/fold.js) over
 * every committed event, and one window request per window carries every
 * suite plugin's changes (lib/remote.js, shared/hub.js).
 *
 * @module dsh-plugin-session-watch
 */
import z from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { sessionWatchProjection } from './fold.js';
import { SessionWatch } from './watch.js';
import { SessionWatchRemote, SERVICE } from './remote.js';
import { Hub } from './shared/hub.js';
import { pluginDir } from './shared/files.js';
import { errorText, guard } from './shared/safe.js';

export const name = 'session-watch';

/** Host services the watcher reads: DSH's session controller, sessions, agents and projections. */
export const inject = ['sessionController', 'sessions', 'agents', 'sessionProjections'];

export const Config = z.object({
    /** How long a message may wait to be read into a turn before its delivery is reported as failed, in seconds. */
    deliveryTimeoutSeconds: z.natural().min(10).max(86400).default(600),
});

/** How plugin messages are marked in a session's log, as DSH marks a plugin's own. */
const PLUGIN_SOURCE = Object.freeze({ kind: 'cordis-host-runner' });

/** Check the config and say what is wrong in words. */
export function checkConfig(config) {
    const seconds = config?.deliveryTimeoutSeconds;
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 86400) {
        throw new Error(`session-watch: deliveryTimeoutSeconds must be a whole number of seconds from 10 to 86400 (got ${JSON.stringify(seconds)})`);
    }
}

export function apply(ctx, config) {
    checkConfig(config);
    const logger = ctx.logger;
    const hub = new Hub();
    const watch = new SessionWatch({
        ctx,
        config,
        logger,
        hub,
        dir: pluginDir('session-watch'),
        makeMessage: (text) => createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }),
    });

    // The watcher's own state of every session, driven by DSH over every committed event.
    ctx.sessionProjections.register(sessionWatchProjection());

    // One listener each, guarded: nothing the watcher does may fail the DSH call that raised the event.
    ctx.on('session/event', guard(logger, 'session-watch: session event', (session, event) => watch.onSessionEvent(session, event)));
    ctx.on('agent/created', guard(logger, 'session-watch: agent created', ({ agent }) => watch.onAgent(agent, 'created')));
    ctx.on('agent/disposed', guard(logger, 'session-watch: agent disposed', ({ agent }) => watch.onAgent(agent, 'disposed')));
    ctx.on('agent/status', guard(logger, 'session-watch: agent status', ({ agent, status }) => watch.onStatus(agent, status)));
    ctx.on('agent/inbox/discarded', guard(logger, 'session-watch: inbox discard', ({ agent, message }) => watch.onDiscarded(agent, message)));

    // Turns running now (the plugin restarted under them) go on the record too.
    try {
        for (const agent of ctx.agents.list?.() ?? []) {
            if (agent?.status === 'running' && typeof agent.id === 'string') watch.running.data.sessions[agent.id] = { at: Date.now() };
        }
        watch.running.change();
    } catch (error) {
        logger?.warn?.(`session-watch: could not read the running agents: ${errorText(error)}`);
    }

    // The goal service, when DSH has one: Autopilot reads and re-arms goals through it.
    ctx.inject(['goals'], (scope) => {
        watch.goals = scope.goals;
        return () => { if (watch.goals === scope.goals) watch.goals = undefined; };
    });

    ctx.provide('sessionWatch', watch);

    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new SessionWatchRemote(watch, hub));
    });

    ctx.effect(() => () => {
        hub.close();
        watch.close();
    }, 'session-watch: watcher');
}
