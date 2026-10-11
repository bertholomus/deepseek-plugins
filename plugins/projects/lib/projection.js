/**
 * The `projectSession` session projection: what the DSH window needs to draw
 * a project session. It says whether a session is a coordinator or a thread
 * and of which project, holds a coordinator's thread roster and a thread's
 * coordinator, and lists the cards each turn earned (a thread started, a
 * handback arrived). DSH folds it on the Host over every committed event of
 * every session and sends the value to the browser half (lib/client.js),
 * which never reads session logs itself.
 *
 * The fold reads only what project sessions already record: the
 * presentation meta of project tool results (tools.js), the tagged
 * messages the plugin sends (prompts.js), which DSH logs as an agent's or a
 * plugin's message (earlier versions sent them as the user's, with a
 * request id that marks them), whether the user has written in a
 * coordinator yet (a new project suggests first asks until then), the
 * turns in which a thread changed files (DSH's `workspace/changes` events;
 * the window then reads the numbers from the plugin), and how a thread's
 * last turn ended (DSH's `turn/end`), so a failed or stopped thread says so.
 * A session the store already knows
 * is seeded from the store the first time DSH folds it, so sessions from
 * before this version show their project and threads at once; replayed
 * events older than the seed then add cards but never overwrite the roster.
 *
 * DSH runs `apply` inside its event commit and parses persisted state
 * without catching, so `apply` and both parsers never throw.
 *
 * Value shape (`null` for sessions outside any project):
 *
 * { role: 'coordinator'|'thread', project: { id?, name }, coordinator?: sessionId,
 *   thread?: { id, title }, threads?: [{ id, session, title, resolved, created?, handback? }],
 *   cards?: [{ turn, seq, kind, thread?, status? }], asked?: true, changes?: [{ turn, seq }],
 *   ending?: { state: 'failed'|'stopped', kind, turn, seq, at, message?, code?, cause?, hook?, times? } }
 *
 * Card kinds: start, send, update (tool results), handback, idle, approval
 * (the plugin's messages), and welcome: the turn a new coordinator
 * introduced itself in. An idle card's status says when the thread's turn
 * failed or stopped (from the note's first line). `asked` is set once the
 * user writes in a coordinator. `changes` lists a thread's turns that
 * changed files, oldest first. `ending` is a thread's last turn when it
 * didn't finish: it failed (DSH logged an error, a plugin blocked it, or
 * the user signed out) or it stopped (stopped, cut off by DSH closing, or at
 * the output token limit); a turn that finishes, or hands back a result
 * before it ends, clears it. `times` counts the same ending in a row, from
 * 2 (a thread retried that failed again).
 *
 * @module dsh-plugin-projects/projection
 */
import { TAGS, endingStateOf, readableError, handbackSummary, cardSummary } from './prompts.js';

/** The projection key; the browser half reads the same name. */
export const PROJECTION_KEY = 'projectSession';
/** Bump when the state shape or fold changes; DSH then refolds from the log. */
export const STATE_VERSION = 6;
/** Most recent cards kept per session; older turns rarely scroll into view. */
export const MAX_CARDS = 60;
/** Threads kept in a roster: every open one, then the newest resolved ones. */
export const MAX_THREADS = 60;
/** A thread's turns with file changes kept in its value (the newest). */
export const MAX_CHANGES = 40;
/** Marks the presentation meta of project tool results. */
export const META_MARK = 'dshProjects';

const INITIAL = Object.freeze({ turn: 0, v: null });
/** Request ids of plugin prompts sent as the user's (earlier versions): `projects-<uuid>`, then `@<coordinator session>`. */
const RPC = /^projects-[^@]*(?:@(.+))?$/;
/** Source kinds of the plugin's messages now: an agent's (from the coordinator or a thread) or a plugin's. */
const AGENT_MESSAGE = 'agent-message';
const PLUGIN_MESSAGE = 'cordis-host-runner';
const BRIEF = /^\[Brief from the coordinator of "(.*)" · you are thread (t\d+), "(.*)"\]$/;
const HANDBACK = /^\[Handback from thread (t\d+) · "(.*)" · status: ([a-z_]+)\]$/;
const IDLE = /^\[Thread idle without a handback: (t\d+) · "(.*)"\]$/;
const APPROVAL = /^\[Thread waiting for approval: (t\d+) · "(.*)"\]$/;
const QUESTION = /^\[Question from thread (t\d+) · "(.*)"\]$/;
const WELCOME = /^\[Project created: "(.*)"\]$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max) : undefined);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One roster entry as stored in the value, or null when it is not one. */
function threadEntry(raw) {
    if (!isObject(raw) || typeof raw.id !== 'string' || !/^t\d+$/.test(raw.id)) return null;
    const entry = { id: raw.id, session: str(raw.session, 120) ?? null, title: str(raw.title, 120) ?? raw.id, resolved: raw.resolved === true };
    if (typeof raw.created === 'string') entry.created = raw.created.slice(0, 40);
    if (isObject(raw.handback) && typeof raw.handback.status === 'string') {
        entry.handback = { status: raw.handback.status.slice(0, 20), summary: str(raw.handback.summary, 300) ?? '', at: str(raw.handback.at, 40) ?? null };
    }
    return entry;
}

const threadNumber = (entry) => Number(entry.id.slice(1));

/** Keep every open thread and the newest resolved ones, in thread order. */
function trimRoster(list) {
    const sorted = [...list].sort((a, b) => threadNumber(a) - threadNumber(b));
    if (sorted.length <= MAX_THREADS) return sorted;
    const open = sorted.filter((t) => !t.resolved);
    const resolved = sorted.filter((t) => t.resolved).slice(-Math.max(MAX_THREADS - open.length, 0));
    const keep = new Set([...open, ...resolved]);
    return sorted.filter((t) => keep.has(t));
}

/** Upsert roster entries by id; `replace` drops the ones not given. */
function mergeRoster(current, entries, replace) {
    const byId = new Map(replace ? [] : (current ?? []).map((t) => [t.id, t]));
    for (const entry of entries) byId.set(entry.id, { ...byId.get(entry.id), ...entry });
    return trimRoster([...byId.values()]);
}

/** A card for a turn, keeping the newest MAX_CARDS. */
function withCard(v, card) {
    const cards = [...(v.cards ?? []), card];
    return { ...v, cards: cards.length > MAX_CARDS ? cards.slice(-MAX_CARDS) : cards };
}

/** The visible value with role and project set, from what an event says. */
function identify(v, role, project, extra = {}) {
    const base = v ?? { role, project };
    const next = { ...base, ...extra };
    // A coordinator never turns into a thread or back; the first role seen holds.
    next.role = base.role ?? role;
    next.project = { ...base.project, ...project };
    return next;
}

/**
 * Text and sender of a message this plugin sent, or null. `sender` is the
 * session it came from, when known: the coordinator for a brief or a
 * coordinator's message, the thread for a handback.
 */
function messageOf(event) {
    const data = event?.data;
    const message = isObject(data?.message) ? data.message : data;
    if (!isObject(message) || !Array.isArray(message.content)) return null;
    const source = isObject(message.source) ? message.source : {};
    let sender;
    if (source.kind === AGENT_MESSAGE) {
        sender = str(source.senderSessionId, 120);
        if (!sender) return null;
    } else if (source.kind !== PLUGIN_MESSAGE) {
        if (source.kind !== undefined && source.kind !== 'user') return null;
        const rpc = RPC.exec(typeof source.rpcId === 'string' ? source.rpcId : '');
        // Only messages this plugin sent carry project meaning; a user typing a tag does not.
        if (!rpc) return null;
        sender = rpc[1];
    }
    let text = '';
    for (const block of message.content) if (block?.type === 'text' && typeof block.text === 'string') text += block.text;
    return text.startsWith('[') ? { text, sender } : null;
}

/** The user's own words in a coordinator: from now on it has been asked something. */
function applyUserMessage(state, event) {
    if (state.v?.role !== 'coordinator' || state.v.asked === true) return state;
    const data = event?.data;
    const message = isObject(data?.message) ? data.message : data;
    const kind = isObject(message?.source) ? message.source.kind : undefined;
    if (kind !== undefined && kind !== 'user') return state;
    return { ...state, v: { ...state.v, asked: true } };
}

/** Fold one plugin message (or the user's) into the state, or return the same state. */
function applyMessage(state, event) {
    const message = messageOf(event);
    if (!message) return applyUserMessage(state, event);
    const { text, sender } = message;
    const newline = text.indexOf('\n');
    const head = newline < 0 ? text : text.slice(0, newline);
    const fresh = !(state.since > 0) || !(event.time < state.since);
    let m;
    if (text.startsWith(TAGS.brief) && (m = BRIEF.exec(head))) {
        const v = identify(state.v, 'thread', { name: m[1] }, {
            thread: { id: m[2], title: clip(m[3], 120) },
            ...(sender ? { coordinator: sender } : {}),
        });
        return { ...state, v: state.v?.role === 'coordinator' ? state.v : v };
    }
    if (text.startsWith(TAGS.coordinator)) {
        // A coordinator made again (the old one was deleted) writes from its new session.
        if (state.v?.role !== 'thread' || !sender || state.v.coordinator === sender) return state;
        return { ...state, v: { ...state.v, coordinator: sender } };
    }
    if (text.startsWith(TAGS.welcome) && (m = WELCOME.exec(head))) {
        if (state.v?.role === 'thread') return state;
        return { ...state, v: withCard(identify(state.v, 'coordinator', { name: m[1] }), { turn: state.turn, seq: event.seq, kind: 'welcome' }) };
    }
    if (text.startsWith(TAGS.handback) && (m = HANDBACK.exec(head))) {
        if (state.v?.role === 'thread') return state;
        let v = identify(state.v, 'coordinator', {});
        if (fresh) {
            const body = handbackSummary(text);
            const known = (v.threads ?? []).find((t) => t.id === m[1]);
            const handback = { status: m[3], summary: cardSummary(body, 300), at: Number.isFinite(event.time) ? new Date(event.time).toISOString() : null };
            v = { ...v, threads: mergeRoster(v.threads, [{ ...(known ?? { id: m[1], session: null, title: clip(m[2], 120), resolved: false }), handback }], false) };
        }
        return { ...state, v: withCard(v, { turn: state.turn, seq: event.seq, kind: 'handback', thread: m[1], status: m[3] }) };
    }
    for (const [tag, pattern, kind] of [[TAGS.idle, IDLE, 'idle'], [TAGS.approval, APPROVAL, 'approval'], [TAGS.question, QUESTION, 'question']]) {
        if (text.startsWith(tag) && (m = pattern.exec(head))) {
            if (state.v?.role === 'thread') return state;
            // An idle note says first when the turn failed or stopped (prompts.js idleMessage).
            const ended = kind === 'idle' && newline >= 0 ? endingStateOf(text.slice(newline).trim()) : undefined;
            return { ...state, v: withCard(identify(state.v, 'coordinator', {}), { turn: state.turn, seq: event.seq, kind, thread: m[1], ...(ended ? { status: ended } : {}) }) };
        }
    }
    return state;
}

/** Fold the presentation meta of one project tool result, or return the same state. */
function applyToolMeta(state, event) {
    const meta = event?.data?.meta;
    if (!isObject(meta) || meta[META_MARK] !== 1) return state;
    const role = meta.role === 'thread' ? 'thread' : 'coordinator';
    if (state.v?.role && state.v.role !== role) return state;
    const project = isObject(meta.project) ? { ...(str(meta.project.id, 80) ? { id: meta.project.id } : {}), ...(str(meta.project.name, 120) ? { name: meta.project.name } : {}) } : {};
    let v = identify(state.v, role, project);
    if (typeof meta.coordinator === 'string') v.coordinator = meta.coordinator.slice(0, 120);
    if (role === 'thread' && isObject(meta.thread) && /^t\d+$/.test(String(meta.thread.id))) {
        v.thread = { id: meta.thread.id, title: str(meta.thread.title, 120) ?? meta.thread.id };
    }
    const fresh = !(state.since > 0) || !(event.time < state.since);
    if (role === 'coordinator' && Array.isArray(meta.threads) && fresh) {
        v.threads = mergeRoster(v.threads, meta.threads.map(threadEntry).filter(Boolean), meta.full === true);
    }
    const action = meta.action;
    if (isObject(action) && typeof action.kind === 'string') {
        const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : state.turn;
        v = withCard(v, {
            turn, seq: event.seq, kind: action.kind.slice(0, 20),
            ...(typeof action.thread === 'string' ? { thread: action.thread.slice(0, 12) } : {}),
            ...(typeof action.status === 'string' ? { status: action.status.slice(0, 20) } : {}),
        });
    }
    return { ...state, v };
}

/**
 * A thread's turn changed files (DSH announces each turn's changes, and a
 * turn again when they change): note the event, so the window knows to
 * read the thread's changes again.
 */
function applyChanges(state, event) {
    if (state.v?.role !== 'thread' || !Number.isSafeInteger(event?.seq)) return state;
    const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : state.turn;
    const list = (Array.isArray(state.v.changes) ? state.v.changes : []).filter((c) => c?.turn !== turn);
    list.push({ turn, seq: event.seq });
    return { ...state, v: { ...state.v, changes: list.slice(-MAX_CHANGES) } };
}

/**
 * How a turn ended, as the window shows a thread's last turn: null when it
 * finished, undefined for an ending this fold doesn't know (it keeps what
 * it had). DSH shows a sign-out as a failure, so this does too.
 */
function endingOf(reason, event, turn) {
    if (!isObject(reason) || typeof reason.kind !== 'string') return undefined;
    const base = { turn, seq: event.seq, at: Number.isFinite(event.time) ? new Date(event.time).toISOString() : null };
    switch (reason.kind) {
        case 'completed': return null;
        case 'error': {
            const error = isObject(reason.error) ? reason.error : {};
            const code = str(error.code, 60);
            return { ...base, state: 'failed', kind: 'error', message: readableError(error.message), ...(code ? { code } : {}) };
        }
        case 'blocked': return { ...base, state: 'failed', kind: 'blocked' };
        case 'aborted': {
            const cause = isObject(reason.reason) ? reason.reason : {};
            if (cause.kind === 'hook' && cause.reason === 'deepseek-account/signed-out') return { ...base, state: 'failed', kind: 'signed-out' };
            const kind = str(cause.kind, 20);
            const hook = cause.kind === 'hook' ? str(cause.reason, 120) : undefined;
            return { ...base, state: 'stopped', kind: 'aborted', ...(kind ? { cause: kind } : {}), ...(hook ? { hook } : {}) };
        }
        case 'interrupted': return { ...base, state: 'stopped', kind: 'interrupted' };
        case 'max-tokens': return { ...base, state: 'stopped', kind: 'max-tokens' };
        default: return undefined;
    }
}

/**
 * A thread's turn ended: keep how, when it didn't finish, so the window
 * shows the thread as failed or stopped until a later turn finishes. A
 * turn that handed back a result (not just progress) is told by its
 * handback instead.
 */
function applyTurnEnd(state, event) {
    if (state.v?.role !== 'thread') return state;
    const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : state.turn;
    const handedBack = (state.v.cards ?? []).some((c) => c?.kind === 'handback' && c.turn === turn && c.status !== 'progress');
    const ending = handedBack ? null : endingOf(event.data?.reason, event, turn);
    if (ending === undefined) return state;
    if (ending !== null) {
        // The same ending again (a retry that failed again, a resume stopped again): count it, so the window says so.
        const before = state.v.ending;
        const times = before?.state === ending.state && before.turn !== turn ? (Number.isSafeInteger(before.times) ? before.times : 1) + 1 : 1;
        return { ...state, v: { ...state.v, ending: times > 1 ? { ...ending, times } : ending } };
    }
    if (state.v.ending === undefined) return state;
    const { ending: _finished, ...v } = state.v;
    return { ...state, v };
}

/** One event folded into the state; the same reference when the event says nothing about projects. */
export function applyEvent(state, event) {
    try {
        switch (event?.type) {
            case 'turn/start': {
                const turn = event.data?.turn;
                return Number.isSafeInteger(turn) && turn !== state.turn ? { ...state, turn } : state;
            }
            case 'user/message': return applyMessage(state, event);
            case 'tool/result': return applyToolMeta(state, event);
            case 'workspace/changes': return applyChanges(state, event);
            case 'turn/end': return applyTurnEnd(state, event);
            default: return state;
        }
    } catch {
        return state;
    }
}

/** Persisted or seeded state, made safe; never throws. */
export function parseState(value) {
    if (!isObject(value)) return INITIAL;
    const turn = Number.isSafeInteger(value.turn) && value.turn >= 0 ? value.turn : 0;
    const v = isObject(value.v) && (value.v.role === 'coordinator' || value.v.role === 'thread') && isObject(value.v.project) ? value.v : null;
    return { turn, v, ...(Number.isFinite(value.since) && value.since > 0 ? { since: value.since } : {}) };
}

/**
 * The projection definition for DSH's `ctx.sessionProjections`.
 * @param {(sessionId: string) => object|null} seed - the store's view of a session it knows, or null.
 */
export function projectSessionProjection(seed) {
    return {
        key: PROJECTION_KEY,
        stateVersion: STATE_VERSION,
        stateSchema: { parse: parseState },
        init(header) {
            let v = null;
            try { v = header?.id ? seed(header.id) : null; } catch { v = null; }
            return v ? { turn: 0, v, since: Date.now() } : INITIAL;
        },
        apply: applyEvent,
        wire: {
            viewSchema: { parse: (value) => (isObject(value) ? value : null) },
            view: (state) => state?.v ?? null,
        },
    };
}
