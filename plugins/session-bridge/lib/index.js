/**
 * dsh-plugin-session-bridge — a local control surface for the running DSH.
 *
 * It serves a small JSON API on a Unix socket (owner-only, no TCP port) and
 * drives the Host's own `sessionController` service: the same code path the
 * window uses. Sessions created or prompted here show up live in the DSH
 * window, and the user can watch and take over there.
 *
 *   GET  /health                           {ok, plugin, version, pid, socket, problems}
 *   GET  /workspaces | /models | /sessions
 *   POST /sessions                         {workspacePath|workspaceId, title?, provider?, model?, reasoningEffort?, agentPreset?, text?, requestId?}
 *   GET  /sessions/:id                     status, turns, last reply
 *   GET  /sessions/:id/events              ?after=<seq>&limit=<n>&full=1&types=a,b&wait=<s>
 *   GET  /sessions/:id/requests/:rid       what became of one prompt (?wait=<s> until it is answered)
 *   POST /sessions/:id/prompt              {text, mode?: "followup"|"steer", requestId?}
 *   POST /sessions/:id/model | /cancel | /rename
 *
 * The routes, the settings check, the log and the socket are in lib/bridge.js,
 * which needs none of DSH's packages; this file wires it to DSH.
 *
 * @module dsh-plugin-session-bridge
 */
import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { readFileSync } from 'node:fs';
import { checkSettings, createBridge, errorText } from './bridge.js';

export const name = 'session-bridge';
export const inject = ['sessionController', 'workspaceRegistry', 'agents'];

/**
 * Settings. Their types and ranges are checked in lib/bridge.js
 * (checkSettings), which says what is wrong in words; any value is taken
 * here, so a wrong one never stops DSH loading the bridge. The socket and
 * the log default to DSH's own data folder (DSH_HOME, else the home
 * folder's .dsh), so a second DSH with its own home gets its own socket.
 */
export const Config = z.object({
    enabled: z.any().default(true).description('Serve the API (true) or not (false).'),
    socketPath: z.any().description('The Unix socket to listen on. Default: session-bridge/bridge.sock in DSH\'s data folder.'),
    logFile: z.any().description('The action log (mode 600); "" for none. Default: session-bridge/bridge.log in DSH\'s data folder.'),
    maxBodyBytes: z.any().default(1048576).description('The largest request body taken, in bytes (1024 to 67108864).'),
});

const VERSION = (() => {
    try {
        return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? '';
    } catch {
        return '';
    }
})();

/**
 * Start the bridge. When it cannot listen (a refused socket path, a socket another program answers on), apply
 * fails with the reason, so DSH shows the plugin as failed ("Problem" on its Plugins page) and logs why, instead
 * of "Running". Switching the plugin off and on in Plugins (or restarting DSH) tries again: DSH does not
 * start a plugin that failed to start again when only its row is saved.
 */
export async function apply(ctx, config) {
    const settings = checkSettings(config, {
        socketPath: dshHomePath('session-bridge', 'bridge.sock'),
        logFile: dshHomePath('session-bridge', 'bridge.log'),
    });
    if (!settings.values.enabled) {
        // Switched off in the profile: nothing listens and nothing is written; a wrong setting is still said.
        for (const problem of settings.problems) ctx.logger.warn('session-bridge: %s', problem);
        ctx.logger.info('session-bridge: off (enabled: false); nothing listens');
        return;
    }
    const bridge = createBridge({
        host: {
            sessionController: () => ctx.sessionController,
            workspaceRegistry: () => ctx.workspaceRegistry,
            agents: () => ctx.agents,
        },
        settings,
        logger: ctx.logger,
        version: VERSION,
    });
    // A request that waits for news is woken by DSH's own events. Nothing here may throw into DSH's dispatch.
    ctx.on('session/event', (session, event) => {
        try {
            bridge.onSessionEvent(session?.id, event);
        } catch (error) {
            ctx.logger.warn('session-bridge: session event %s', errorText(error));
        }
    });
    let failure;
    let disposed = false;
    const started = bridge.start().catch((error) => {
        failure = errorText(error);
        bridge.log(`not listening: ${failure}`);
        return false;
    });
    ctx.effect(() => async () => {
        disposed = true;
        await started;
        await bridge.stop();
    });
    const listening = await started;
    const why = bridge.refused ?? failure;
    if (!listening && !disposed && why) {
        throw new Error(`Session Bridge is not listening on ${bridge.socketPath}: ${why}. Fix socketPath in its row (or free the socket), then switch the plugin off and on in Plugins, or restart DSH.`);
    }
}
