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
import { checkConfig } from './config.js';
import { Mirror } from './mirror.js';
import { DecisionsRemote, SERVICE } from './remote.js';
import { JsonStore } from './shared/files.js';
import { Journal } from './shared/journal.js';
import { errorText } from './shared/safe.js';

export { checkConfig };

export const name = 'decisions';

/** The session watcher; DSH starts Decisions only while it runs. */
export const inject = ['sessionWatch'];

export const Config = z.object({
    /** Master switch: when off, Decisions shows nothing and holds nothing, and its page says so. */
    enabled: z.boolean().default(true),
    /** Tools waiting for approval ("Allow once" or "Reject"). */
    approvals: z.boolean().default(true),
    /** Questions in DSH's question box. */
    questions: z.boolean().default(true),
    /** Replies that end with a plain question for you (DECISION NEEDED and BLOCKED lines always show). */
    replies: z.boolean().default(true),
    /** Coordinator threads that handed back needing a decision, or blocked. */
    threads: z.boolean().default(true),
    /** A system notification for each new card, through the notifications plugin. */
    notify: z.boolean().default(true),
    /** How long a reply's question stays in the inbox, in hours. */
    windowHours: z.natural().min(1).max(720).default(72),
    /** Where new cards are also sent: "off", "webhook" (mirrorUrl) or "command" (mirrorCommand). */
    mirror: z.union(['off', 'webhook', 'command']).default('off'),
    /** The webhook address (https; http only to this machine). Discord's webhook shape. */
    mirrorUrl: z.string().default(''),
    /** The program and its arguments, run without a shell; the card comes as JSON on stdin. */
    mirrorCommand: z.array(z.string()).default([]),
    /** The most mirrored messages in an hour. */
    mirrorPerHour: z.natural().min(1).max(500).default(30),
});

export function apply(ctx, config) {
    checkConfig(config);
    const logger = ctx.logger;
    const watch = ctx.sessionWatch;
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

    const mirror = new Mirror({ config, journal, logger });
    const inbox = new Inbox({
        watch,
        config,
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

    if (config.enabled) {
        // First in DSH's chain for these requests, so the card shows here too; any failure passes the request on untouched.
        const passOn = (label, hold) => (request, next) => {
            try {
                return hold(request, next);
            } catch (error) {
                logger?.warn?.(`decisions: ${label}: ${errorText(error)}`);
                return next();
            }
        };
        if (config.approvals) ctx.on('approval/request', passOn('approval', (request, next) => inbox.holds.approval(request, next)), true);
        if (config.questions) ctx.on('user-questions/request', passOn('question', (request, next) => inbox.holds.question(request, next)), true);
        inbox.start();
    }

    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new DecisionsRemote({ inbox, journal, config, mirror, notifications: () => notifications !== undefined }));
    });

    ctx.effect(() => () => {
        inbox.stop();
        store.close();
    }, 'decisions: inbox');
}
