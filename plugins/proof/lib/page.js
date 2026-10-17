/**
 * What Proof's page and its flags read, in one go (no DSH packages, so its
 * tests run anywhere).
 *
 * @module dsh-plugin-proof/page
 */
import { countsOf, ledgerOf, withChecks } from './ledger.js';

/** Log entries the page's history lists, newest first. */
const HISTORY = 150;

/** Whether Proof works now: switched on in the profile, and every setting right. */
export const working = ({ config, check }) => config.enabled !== false && (check?.ok ?? true);

/** The independent check's settings and how much of its hour is used. */
function verifierState(config, verifier) {
    const budget = verifier.budget();
    return {
        mode: verifier.mode,
        provider: config.verifierProvider,
        model: config.verifierModel,
        minutes: config.verifierMinutes,
        perHour: config.verifierPerHour,
        used: budget.used,
        nextAt: budget.nextAt,
    };
}

/** Everything the page shows. `rows()` reads the sessions with claims (DSH's list). */
export async function pageState({ config, check, verifier, journal, rows }) {
    const problem = check?.problem;
    const on = working({ config, check });
    return {
        ...(problem ? { problem } : {}),
        enabled: config.enabled !== false,
        flags: config.flags !== false,
        verifier: verifierState(config, verifier),
        sessions: on ? await rows() : [],
        checks: verifier.recent(40),
        history: journal.list({ limit: HISTORY }),
    };
}

/**
 * What one session's flags need: whether to show them, how checks run, and
 * the session's checks. In one of Proof's check threads, `checkOf` says
 * what it checks: the claim, the session it came from, and the answer.
 */
export async function sessionState({ config, check, verifier, dsh }, sessionId) {
    const on = working({ config, check });
    const of = verifier.checkOf(sessionId);
    let checkOf;
    if (of) {
        let title = '';
        try { title = (await dsh?.titleOf?.(of.sessionId)) ?? ''; } catch { title = ''; }
        checkOf = { sessionId: of.sessionId, turn: of.turn, claim: of.claim, state: of.state, reason: of.reason ?? '', model: of.model ?? '', title };
    }
    return {
        on,
        flags: on && config.flags !== false,
        verifier: on ? verifier.mode : 'off',
        isCheck: verifier.isCheckSession(sessionId),
        ...(checkOf ? { checkOf } : {}),
        checks: verifier.checksFor(sessionId).slice(0, 60),
    };
}

/**
 * One session's whole ledger: its claims (folded from its log), each with
 * its check, the counts, and the session's title and folder.
 * @param {{ inspect: (id: string) => Promise<{ meta: object, events: object[] }>, titleOf: (id: string) => Promise<string> }} dsh
 */
export async function ledgerState({ dsh, verifier }, sessionId) {
    const { meta, events } = await dsh.inspect(sessionId);
    const { check, claims } = ledgerOf(events);
    const all = withChecks(claims, verifier.checksFor(sessionId));
    let title = '';
    try { title = (await dsh.titleOf(sessionId)) ?? ''; } catch { title = ''; }
    return {
        session: { id: sessionId, title, cwd: typeof meta?.cwd === 'string' ? meta.cwd : '' },
        isCheck: check || verifier.isCheckSession(sessionId),
        counts: countsOf(all),
        claims: all,
    };
}
