/**
 * dsh-plugin-decisions — one inbox for everything waiting on you.
 *
 * Every session that waits on a person shows here as a card: a reply that
 * ends with `DECISION NEEDED: … — recommend: …` or `BLOCKED: …` (or, with
 * `replies`, a plain question), a tool waiting for approval, a question in
 * DSH's question box, a coordinator thread that handed back needing a
 * decision, and the questions suite plugins raise (Autopilot's Ask first).
 * Each card says what is asked, what the agent recommends, which session
 * (one click opens it) and how long it has waited. Answering sends the
 * answer into the session: it steers a running turn, starts the next one
 * of an idle session, or settles the approval or question DSH is holding,
 * and the session's own log proves it arrived.
 *
 * A badge on the sidebar entry counts what waits; with the notifications
 * plugin running, new cards notify; an optional mirror (a webhook or a
 * command) sends a short note to wherever the person is. It reads every
 * session through Session Watch, which must run too.
 *
 * @module dsh-plugin-decisions
 */
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { Inbox, parseData } from './inbox.js';
import { LIVE_SETTINGS, WEBHOOK_KEY, checkConfig, savedEntry } from './config.js';
import { Mirror } from './mirror.js';
import { DecisionsRemote, SERVICE } from './remote.js';
import { JsonStore } from './shared/files.js';
import { Journal } from './shared/journal.js';
import { errorText, guard } from './shared/safe.js';
import { SettingsCheck, live, liveSettings } from './shared/settings.js';

export { SETTING_TITLES, LIVE_SETTINGS, WEBHOOK_KEY, checkConfig, changedWords } from './config.js';

export const name = 'decisions';

/** The session watcher; DSH starts Decisions only while it runs. */
export const inject = ['sessionWatch'];

/** A setting that names a key in DSH's key store, as DSH marks its own (its settings pages show whether the key is set). */
const keyRef = (schema) => (typeof schema?.role === 'function' ? schema.role('credential-ref') : schema);

/**
 * Settings: types and defaults here, the rest in checkConfig (lib/config.js),
 * so a wrong value is said in words on Decisions' page instead of stopping
 * it at start. The live ones are on its page in Plugins and apply as soon as
 * they are saved.
 */
export const Config = z.object({
    /** Profile only. false keeps Decisions loaded but idle: it lists and holds nothing, and its page says so. */
    enabled: z.boolean().default(true),
    /** Tools waiting for approval ("Allow once" or "Reject"). */
    approvals: live(z.boolean().default(true)),
    /** Questions in DSH's question box. */
    questions: live(z.boolean().default(true)),
    /** Replies that end with a plain question for you (DECISION NEEDED and BLOCKED lines always show). */
    replies: live(z.boolean().default(true)),
    /** Coordinator threads that handed back needing a decision, or blocked. */
    threads: live(z.boolean().default(true)),
    /** A system notification for each new card, through the notifications plugin. */
    notify: live(z.boolean().default(true)),
    /** How long a reply's question stays in the inbox, in hours (1 to 720). */
    windowHours: live(z.number().default(72)),
    /** Where new cards are also sent: "off", "webhook" or "command". */
    mirror: live(z.string().default('off')),
    /** The key in DSH's key store that holds the webhook address (never the address itself). */
    mirrorUrlEnv: live(keyRef(z.string()).default(WEBHOOK_KEY)),
    /** Profile only: the program's full path, then its arguments, run without a shell; the card comes as JSON on stdin. */
    mirrorCommand: z.array(z.string()).default([]),
    /** The most messages sent elsewhere in an hour (1 to 500). */
    mirrorPerHour: live(z.number().default(30)),
});

export function apply(ctx, config) {
    const logger = ctx.logger;
    const watch = ctx.sessionWatch;
    const settings = liveSettings(config);
    // A wrong value never stops Decisions from starting: it lists and holds nothing, and its page says which setting to change.
    const check = new SettingsCheck({ settings, check: checkConfig, liveKeys: LIVE_SETTINGS, label: 'decisions', logger });
    check.run();
    // Its folder in DSH's data folder, as DSH resolves it (DSH_HOME, else ~/.dsh).
    const dir = dshHomePath('decisions');
    const bump = () => watch.hub?.bump?.('decisions');
    const store = new JsonStore(join(dir, 'state.json'), { parse: parseData, logger });
    const journal = new Journal(join(dir, 'events.jsonl'), { logger, onChange: bump });

    // System notifications through the notifications plugin, when it runs; one that fails never stops Decisions.
    let notifications;
    ctx.inject(['notifications'], (scope) => {
        const service = scope.notifications;
        notifications = service;
        return () => { if (notifications === service) notifications = undefined; };
    });
    // DSH's question service: late answers to questions whose wait ran out go through it.
    let questions;
    ctx.inject(['userQuestions'], (scope) => {
        const service = scope.userQuestions;
        questions = service;
        return () => { if (questions === service) questions = undefined; };
    });
    // DSH's key store: the webhook address lives there (or in the environment DSH starts in), never in the settings file.
    let credentials;
    ctx.inject(['credentials'], (scope) => {
        const service = scope.credentials;
        credentials = service;
        return () => { if (credentials === service) credentials = undefined; };
    });
    const readAddress = async () => {
        if (typeof credentials?.resolve !== 'function') throw new Error('this DSH has no key store running');
        const found = await credentials.resolve(settings.mirrorUrlEnv);
        return typeof found?.value === 'string' ? found.value : undefined;
    };

    const mirror = new Mirror({ config: settings, journal, logger, readAddress });
    const inbox = new Inbox({
        watch,
        config: settings,
        store,
        journal,
        logger,
        mirror,
        questions: () => questions,
        changed: bump,
        notify: (item) => {
            const sent = notifications?.notify?.(item);
            if (sent && typeof sent.then === 'function') sent.then(undefined, (error) => logger?.warn?.(`decisions: a notification failed: ${errorText(error)}`));
        },
    });
    const working = () => settings.enabled !== false && check.ok;

    if (settings.enabled !== false) {
        // First in DSH's chain for these requests, so the card shows here too. A kind switched off, a wrong
        // setting or any failure passes the request on untouched: DSH's own card works as it always does.
        const passOn = (label, kind, hold) => (request, next) => {
            try {
                if (!working() || !inbox.started || settings[kind] === false) return next();
                return hold(request, next);
            } catch (error) {
                logger?.warn?.(`decisions: ${label}: ${errorText(error)}`);
                return next();
            }
        };
        ctx.on('approval/request', passOn('approval', 'approvals', (request, next) => inbox.holds.approval(request, next)), true);
        ctx.on('user-questions/request', passOn('question', 'questions', (request, next) => inbox.holds.question(request, next)), true);
    }
    if (working()) inbox.start();

    // Settings saved on Decisions' page in Plugins: checked again, and they apply at once.
    ctx.on('loader/volatile-update', guard(logger, 'decisions: settings', (paths) => {
        const entry = savedEntry(check, paths);
        if (entry) journal.add(entry);
        if (!working()) {
            if (inbox.started) inbox.stop();
        } else {
            // A kind switched off lets its held requests go back to DSH's own card alone.
            if (settings.approvals === false) inbox.holds.release('approval');
            if (settings.questions === false) inbox.holds.release('question');
            if (inbox.started) inbox.soon(0);
            else inbox.start();
        }
        bump();
    }));

    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new DecisionsRemote({ inbox, journal, config: settings, check, mirror, watch, notifications: () => notifications !== undefined }));
    });

    ctx.effect(() => () => {
        inbox.stop();
        store.close();
    }, 'decisions: inbox');
}
