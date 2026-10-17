/**
 * dsh-plugin-proof — claims need evidence.
 *
 * When a turn's reply says something is done, passing, fixed or deployed,
 * Proof reads what that turn ran (tool output, exit codes, test counts,
 * metric changes, file hashes) and judges the claim: shown (quiet),
 * no evidence (flagged on the turn), or contradicted by the turn's own
 * output (flagged). It does this in a session projection DSH folds over
 * every committed event (lib/projection.js), so it costs no model call
 * and the flag appears the moment the turn ends.
 *
 * Its page lists the sessions with claims and each one's whole ledger
 * (claim, evidence, verdict, check), with export as Markdown, CSV or JSON.
 * An optional independent check (lib/verifier.js) opens a short, fresh,
 * read-only thread on a cheap local model that re-runs or re-reads the
 * evidence and answers VERIFIED or NOT VERIFIED with its reason: when the
 * person presses Check (the default), by itself for each new flagged
 * claim, or never.
 *
 * It needs nothing else running. With Session Watch running, its page
 * updates through the suite's one open request per window.
 *
 * @module dsh-plugin-proof
 */
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { LIVE_SETTINGS, checkConfig, savedEntry } from './config.js';
import { sessionRows, titleOf } from './ledger.js';
import { KEY, proofProjection } from './projection.js';
import { ProofRemote, SERVICE } from './remote.js';
import { CHECK_TOOLS, Verifier, parseChecks, refusalOf } from './verifier.js';
import { working } from './page.js';
import { JsonStore } from './shared/files.js';
import { Journal } from './shared/journal.js';
import { errorText, guard } from './shared/safe.js';
import { SettingsCheck, live, liveSettings } from './shared/settings.js';

export { SETTING_TITLES, LIVE_SETTINGS, VERIFIER_CHOICES, checkConfig, changedWords } from './config.js';

export const name = 'proof';

/** DSH's session controller (sessions, the ledger, check threads) and its projections (the claims). */
export const inject = ['sessionController', 'sessionProjections'];

/**
 * Settings: types and defaults here, the rest in checkConfig (lib/config.js),
 * so a wrong value is said in words on Proof's page instead of stopping it
 * at start. The live ones are on its page in Plugins and apply as soon as
 * they are saved.
 */
export const Config = z.object({
    /** Profile only. false keeps Proof loaded but idle: it reads no claims, and its page says so. */
    enabled: z.boolean().default(true),
    /** Show a flag on each turn whose claim nothing in the turn shows, or its own output contradicts. */
    flags: live(z.boolean().default(true)),
    /** The independent check: "off", "ask" (when you press Check) or "auto" (by itself, for each new flagged claim). */
    verifier: live(z.string().default('ask')),
    /** The provider of the check model, as DSH's model list names it. */
    verifierProvider: live(z.string().default('owner-ascents')),
    /** The check model, as DSH's model list names it: a cheap local one. */
    verifierModel: live(z.string().default('GLM-5.3-Flash-EXL3')),
    /** The longest a check may take, in minutes (1 to 30); it is stopped after that. */
    verifierMinutes: live(z.number().default(5)),
    /** The most checks that start in an hour (1 to 120); more wait their turn. */
    verifierPerHour: live(z.number().default(12)),
});

/** How Proof's own messages are marked in a session's log, as DSH marks a plugin's. */
const PLUGIN_SOURCE = Object.freeze({ kind: 'cordis-host-runner' });

export function apply(ctx, config) {
    const logger = ctx.logger;
    const settings = liveSettings(config);
    // A wrong value never stops Proof from starting: it flags and checks nothing, and its page says which setting to change.
    const check = new SettingsCheck({ settings, check: checkConfig, liveKeys: LIVE_SETTINGS, label: 'proof', logger });
    check.run();
    const isWorking = () => working({ config: settings, check });

    // The suite's change numbers live with Session Watch; without it the page reads again every few seconds.
    let hub;
    ctx.inject(['sessionWatch'], (scope) => {
        const mine = scope.sessionWatch?.hub;
        hub = mine;
        return () => { if (hub === mine) hub = undefined; };
    });
    const bump = () => { try { hub?.bump?.('proof'); } catch { /* the page reads again later */ } };

    // Its folder in DSH's data folder, as DSH resolves it (DSH_HOME, else ~/.dsh).
    const dir = dshHomePath('proof');
    const journal = new Journal(join(dir, 'events.jsonl'), { logger, onChange: bump });
    const store = new JsonStore(join(dir, 'checks.json'), { parse: parseChecks, logger });
    const sc = ctx.sessionController;

    // DSH's session list, read at most every two seconds: the page's sessions and the titles.
    let listed = { at: 0, items: [] };
    const listItems = async () => {
        if (Date.now() - listed.at < 2000) return listed.items;
        const result = await sc.list({}, AbortSignal.timeout(20000));
        const items = Array.isArray(result?.items) ? result.items : [];
        listed = { at: Date.now(), items };
        return items;
    };

    /** The tool names DSH offers a session before any restriction. */
    const toolNames = (agent) => {
        const tools = ctx.get?.('tools');
        try {
            const known = tools?.view?.(agent)?.restrictableNames;
            if (known instanceof Set) return [...known];
        } catch { /* the schemas below */ }
        try {
            return (tools?.schemas?.() ?? []).map((s) => s?.name).filter((n) => typeof n === 'string');
        } catch {
            return [];
        }
    };

    // A check thread is read-only before its first turn, and its agent is guarded each time DSH makes one.
    const ALLOWED = new Set(CHECK_TOOLS);
    const guarded = new WeakSet();
    const installCheck = (agent, cwd) => {
        if (!agent || guarded.has(agent)) return;
        const session = agent.session;
        if (!session || typeof session.append !== 'function') throw new Error('DSH gave no session to make read-only');
        const projections = ctx.sessionProjections;
        // DSH's own write paths for a session's file policy and approvals: the log keeps them for every later turn.
        if (projections.stateOf(session, 'sandboxMode') !== 'read-only') session.append('sandbox/mode', { mode: 'read-only' });
        if (projections.stateOf(session, 'permissions')?.approval !== 'never') session.append('approval/policy', { policy: 'never' });
        const scoped = agent.ctx;
        if (typeof scoped?.tools?.guard !== 'function') throw new Error('this DSH cannot guard a thread\'s tools');
        const deny = toolNames(agent).filter((n) => !ALLOWED.has(n));
        if (deny.length > 0 && typeof scoped.tools.restrict === 'function') scoped.tools.restrict({ deny });
        scoped.tools.guard((exec) => refusalOf(exec, { cwd: session.header?.cwd ?? cwd }));
        guarded.add(agent);
    };

    const dsh = {
        inspect: (sessionId) => sc.inspect(sessionId, AbortSignal.timeout(20000)),
        titleOf: async (sessionId) => {
            const item = (await listItems()).find((i) => i?.sessionId === sessionId);
            return item ? titleOf(item) : '';
        },
        async resolveModel(wanted) {
            const llm = ctx.get?.('llm');
            if (typeof llm?.resolveCallConfig !== 'function') throw new Error('this DSH has no model service');
            const r = await llm.resolveCallConfig(wanted, AbortSignal.timeout(20000));
            return { provider: r.provider, model: r.model, ...(r.reasoningEffort === undefined ? {} : { reasoningEffort: String(r.reasoningEffort) }) };
        },
        // In the checked session's workspace, so it lists beside it; in its folder when it has no workspace.
        async createNear(sessionId, newId, cwd) {
            let workspace;
            try { workspace = ctx.get?.('workspaceRegistry')?.list?.().find((w) => w?.sessionIds?.includes?.(sessionId)); } catch { workspace = undefined; }
            await sc.create(workspace ? { sessionId: newId, workspaceId: workspace.id } : { sessionId: newId, ...(cwd ? { cwd } : {}) });
            listed = { at: 0, items: [] };
        },
        rename: (sessionId, title) => sc.rename({ sessionId, title }),
        async agentOf(sessionId) {
            const found = await sc.resolveAgent(sessionId);
            if (!found?.agent) throw new Error(found?.error?.message ?? found?.error?.code ?? 'DSH did not open the thread');
            return found.agent;
        },
        prepare: (agent, { cwd } = {}) => installCheck(agent, cwd),
        // For this thread only, as DSH's model picker does: DSH's default model is never changed.
        select(agent, selection) {
            if (typeof sc.agents?.selectForNextRequest !== 'function') throw new Error('this DSH cannot choose a model for one thread');
            sc.agents.selectForNextRequest(agent, selection);
        },
        async send(agent, text) {
            agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: PLUGIN_SOURCE }));
            const sessions = ctx.get?.('sessions');
            if (typeof sessions?.flush === 'function' && agent.session && !await sessions.flush(agent.session)) throw new Error('the thread did not save the message');
        },
        cancel: (sessionId) => sc.cancel({ sessionId }),
    };

    const verifier = new Verifier({ config: settings, working: isWorking, dsh, store, journal, logger, changed: bump });

    if (settings.enabled !== false) {
        // The claims: folded by DSH over every committed event of every session.
        ctx.sessionProjections.register(proofProjection());
        // A new claim: the page moves, and with "By itself" a new flagged one is checked. Only a view that changed
        // counts: DSH may tell of every event a turn commits.
        const seen = new Map();
        const signature = (view) => `${view?.check === true ? 'check' : ''}${view?.total ?? 0}:${(view?.flagged ?? []).map((c) => c?.id).join(',')}`;
        ctx.sessionProjections.onChanged(guard(logger, 'proof: claims', (session, key, value) => {
            if (key !== KEY || typeof session?.id !== 'string') return;
            const sig = signature(value);
            if (seen.get(session.id) === sig) return;
            seen.delete(session.id);
            seen.set(session.id, sig);
            if (seen.size > 2000) seen.delete(seen.keys().next().value);
            bump();
            verifier.onView(session.id, value);
        }));
        // A check thread's reply and its turn's end.
        ctx.on('session/event', guard(logger, 'proof: session event', (session, event) => verifier.onEvent(session, event)));
        // DSH makes a check thread's agent again after a restart or a while idle: guarded again.
        ctx.on('agent/created', guard(logger, 'proof: check thread', ({ agent }) => {
            if (verifier.isCheckSession(agent?.id)) installCheck(agent);
        }));
        verifier.start();
    }

    // Settings saved on Proof's page in Plugins: checked again, and they apply at once.
    ctx.on('loader/volatile-update', guard(logger, 'proof: settings', (paths) => {
        const entry = savedEntry(check, paths);
        if (entry) journal.add(entry);
        verifier.settingsChanged();
        bump();
    }));

    const rows = async () => {
        try {
            return sessionRows((await listItems()).filter((i) => !verifier.isCheckSession(i?.sessionId)));
        } catch (error) {
            throw new Error(`DSH's session list could not be read (${errorText(error, 160)}). Reload the page to try again.`);
        }
    };

    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new ProofRemote({ config: settings, check, verifier, journal, dsh, rows }));
    });

    ctx.effect(() => () => {
        verifier.stop();
        store.close();
    }, 'proof: checks');
}
