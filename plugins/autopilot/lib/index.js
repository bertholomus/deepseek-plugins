/**
 * dsh-plugin-autopilot — keeps sessions moving when nobody is watching.
 *
 * After a DSH restart it finds the sessions whose turn the stop cut off and
 * tells them to carry on; it nudges a session that went idle with open
 * todos (once, then backs off when nudges bring no progress); and it starts
 * a goal again after an error stopped it. Every action waits for proof from
 * the session's own log, and the event log says what it did and why.
 * Per-session rules (Auto, Ask first, Off) and a kill switch live on its
 * page in DSH's sidebar (lib/client.js).
 *
 * It reads sessions through the session watcher (plugins/session-watch),
 * which must run too; with the notifications plugin it also says, outside
 * the window, when it backs off or asks something.
 *
 * @module dsh-plugin-autopilot
 */
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { Pilot, parseData } from './pilot.js';
import { AutopilotRemote, SERVICE } from './remote.js';
import { JsonStore, pluginDir } from './shared/files.js';
import { Journal } from './shared/journal.js';
import { errorText } from './shared/safe.js';

export const name = 'autopilot';

/** The session watcher; DSH starts Autopilot only while it runs. */
export const inject = ['sessionWatch'];

export const Config = z.object({
    /** Master switch: when off, Autopilot watches nothing and its page says so. */
    enabled: z.boolean().default(true),
    /** The rule for sessions without their own: act ("auto"), ask first ("ask"), or leave alone ("off"). */
    defaultRule: z.union(['auto', 'ask', 'off']).default('auto'),
    /** After a DSH restart, tell the sessions it cut off to carry on. */
    resumeAfterRestart: z.boolean().default(true),
    /** Only sessions cut off within this many hours are resumed. */
    resumeWindowHours: z.natural().min(1).max(168).default(6),
    /** How long a session stays quiet, with work open, before a note. */
    idleSeconds: z.natural().min(5).max(86400).default(600),
    /** At start, idle sessions whose last turn ended within this many hours are looked at. */
    idleWindowHours: z.natural().min(1).max(168).default(2),
    /** Notes in a row that bring no progress before Autopilot backs off. */
    maxNudges: z.natural().min(1).max(10).default(2),
    /** The most notes and goal starts Autopilot sends in an hour, over all sessions. */
    maxNotesPerHour: z.natural().min(1).max(500).default(20),
    /** Waits before each try after a failed turn, in seconds; one try per entry. */
    errorRetrySeconds: z.array(z.natural().max(86400)).default([120, 600, 1800]),
    /** How long after DSH starts Autopilot first looks, in seconds. */
    startDelaySeconds: z.natural().max(600).default(20),
});

/** Check the config and say what is wrong in words (DSH shows this when the plugin cannot start). */
export function checkConfig(config) {
    const whole = (key, min, max) => {
        const value = config?.[key];
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`autopilot: ${key} must be a whole number from ${min} to ${max} (got ${JSON.stringify(value)})`);
    };
    whole('resumeWindowHours', 1, 168);
    whole('idleSeconds', 5, 86400);
    whole('idleWindowHours', 1, 168);
    whole('maxNudges', 1, 10);
    whole('maxNotesPerHour', 1, 500);
    whole('startDelaySeconds', 0, 600);
    if (!['auto', 'ask', 'off'].includes(config?.defaultRule)) throw new Error(`autopilot: defaultRule must be "auto", "ask" or "off" (got ${JSON.stringify(config?.defaultRule)})`);
    const retries = config?.errorRetrySeconds;
    if (!Array.isArray(retries) || retries.length === 0 || retries.length > 10 || retries.some((n) => !Number.isInteger(n) || n < 0 || n > 86400)) {
        throw new Error(`autopilot: errorRetrySeconds must list 1 to 10 waits, each a whole number of seconds up to 86400 (got ${JSON.stringify(retries)})`);
    }
}

export function apply(ctx, config) {
    checkConfig(config);
    const logger = ctx.logger;
    const watch = ctx.sessionWatch;
    const dir = pluginDir('autopilot');
    const bump = () => watch.hub?.bump?.('autopilot');
    const store = new JsonStore(join(dir, 'state.json'), { parse: parseData, logger });
    const journal = new Journal(join(dir, 'events.jsonl'), { logger, onChange: bump });

    // System notifications through the notifications plugin, when it runs; one that fails never stops Autopilot.
    let notifications;
    ctx.inject(['notifications'], (scope) => {
        const service = scope.notifications;
        notifications = service;
        return () => { if (notifications === service) notifications = undefined; };
    });
    const notify = (item) => {
        try {
            notifications?.notify?.(item);
        } catch (error) {
            logger?.warn?.(`autopilot: a notification failed: ${errorText(error)}`);
        }
    };

    const pilot = new Pilot({ watch, config, store, journal, logger, notify, changed: bump });
    if (config.enabled) pilot.start();

    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new AutopilotRemote({ pilot, watch, journal, config }));
    });

    ctx.effect(() => () => {
        pilot.stop();
        store.close();
        for (const ask of watch.asks?.() ?? []) if (ask.source === 'Autopilot') watch.dropAsk(ask.id);
    }, 'autopilot: pilot');
}
