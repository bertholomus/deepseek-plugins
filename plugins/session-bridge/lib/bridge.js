/**
 * The session bridge's working parts, without DSH's own packages: its
 * settings in words, the API's routes, the action log and the socket.
 * lib/index.js hands it DSH's services; the unit tests hand it stand-ins
 * (test/session-bridge.test.js), and the real-DSH test drives it in DSH
 * (test/e2e/run.mjs).
 *
 * Every route answers JSON. A request that waits (`wait=<seconds>`) is
 * woken by DSH's own session events, never by polling.
 *
 * @module dsh-plugin-session-bridge/bridge
 */
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants as fsc, fchmodSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const PLUGIN = 'session-bridge';
/** The longest socket path macOS takes (104 bytes with its closing zero byte). */
export const SOCKET_PATH_MAX = 103;
/** The action log starts a new part past this size; the old part is kept once, as `<logFile>.1`. */
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
/** The longest a request may wait for news (`wait`), in seconds. */
export const WAIT_MAX_SECONDS = 600;
/** The most events one page holds. */
export const EVENTS_LIMIT_MAX = 2000;
/** maxBodyBytes: its default and its range. */
export const MAX_BODY_DEFAULT = 1048576;
export const MAX_BODY_RANGE = Object.freeze([1024, 64 * 1024 * 1024]);
/** A request id a caller chooses: letters, digits and . _ : - (128 at most). A resend adds `~<n>`, which no caller's id can hold. */
export const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** How many request ids the bridge remembers, for "already sent" and "already made". */
const REMEMBERED = 5000;
const TITLE_MAX = 500;
const TEXT_PREVIEW = 4000;
/** How long the bridge gives DSH for one call, in ms: it answers 504 when DSH takes longer. */
export const READ_MS = 20000;
export const PROMPT_MS = 60000;
/** The file beside the socket that remembers which session each create's request id made. */
export const CREATES_FILE = 'creates.jsonl';
const SETTING_KEYS = new Set(['enabled', 'socketPath', 'logFile', 'maxBodyBytes']);

// ── Small helpers ─────────────────────────────────────────────────────

export const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** `~/x` as the home folder's x; anything else as it is. */
export const expandHome = (path) => (path === '~' ? homedir() : path.startsWith('~/') ? homedir() + path.slice(1) : path);

/** A value as a person would read it in a setting's message. */
function shown(value) {
    if (typeof value === 'string') return `"${value.length > 60 ? `${value.slice(0, 59)}…` : value}"`;
    try { return JSON.stringify(value); } catch { return String(value); }
}

/** One short line for an error: its message, never a stack. */
export function errorText(error, max = 300) {
    let text;
    if (error instanceof Error) text = error.message || error.name;
    else if (typeof error === 'string') text = error;
    else {
        try { text = JSON.stringify(error); } catch { text = String(error); }
    }
    text = String(text ?? 'unknown error').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** An error the bridge answers with: an HTTP status, a code and a sentence. */
export class BridgeError extends Error {
    constructor(status, code, message, extra = undefined) {
        super(message);
        this.status = status;
        this.code = code;
        if (extra) this.extra = extra;
    }
}

const bad = (message) => new BridgeError(400, 'bad-request', message);

/** The code DSH (or the bridge) gave an error, or "internal". */
export function codeOf(error) {
    const code = error?.code ?? error?.remote?.code;
    return typeof code === 'string' && code ? code : 'internal';
}

/**
 * The HTTP status for an error: the bridge's own, else from DSH's code.
 * Not found is 404, a bad request 400, DSH too slow 504, DSH refusing in
 * its own words (a code such as session/model-unavailable) 409, else 500.
 */
export function statusFor(error) {
    if (error instanceof BridgeError) return error.status;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 504;
    const code = codeOf(error);
    if (/(^|[/-])not-found$/.test(code)) return 404;
    if (code === 'gateway/bad-request') return 400;
    if (code === 'gateway/cancelled') return 504;
    if (code.includes('/') && code !== 'gateway/internal') return 409;
    return 500;
}

/** Whether DSH said "no such session": its code, its own error class, or its words. Any other failure is not a 404. */
export function isNotFound(error) {
    if (statusFor(error) === 404) return true;
    if (error?.constructor?.name === 'ApiSessionNotFound' || error?.code === 'SESSION_QUERY_SESSION_NOT_FOUND') return true;
    return /^session "[^"]*" not found$/.test(typeof error?.message === 'string' ? error.message : '');
}

/**
 * `promise`, or a rejection made by `onTimeout` when it takes longer than `ms`. DSH checks a call's signal only
 * as the call starts, so the bridge keeps its own deadline. A late failure of `promise` is caught, never unhandled.
 */
export function withDeadline(promise, ms, onTimeout) {
    let timer;
    const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
        timer.unref?.();
    });
    Promise.resolve(promise).catch(() => {});
    return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ── Settings ──────────────────────────────────────────────────────────

const YES = new Set([true, 1, 'true', 'yes', 'on', '1']);
const NO = new Set([false, 0, 'false', 'no', 'off', '0']);

/**
 * The settings the bridge works with, and what is wrong with the ones given,
 * in words. A wrong value never stops the bridge: that one setting falls back
 * to its default, and the problem is said in DSH's log, the bridge's log and
 * GET /health.
 * @param {unknown} raw - the row's config as DSH hands it.
 * @param {{ socketPath: string, logFile: string }} defaults - in DSH's data folder.
 * @returns {{ values: { enabled: boolean, socketPath: string, logFile: string, maxBodyBytes: number }, problems: string[] }}
 */
export function checkSettings(raw, defaults) {
    const given = isRecord(raw) ? raw : {};
    const problems = [];
    const values = { enabled: true, socketPath: defaults.socketPath, logFile: defaults.logFile, maxBodyBytes: MAX_BODY_DEFAULT };
    const set = (key) => given[key] !== undefined && given[key] !== null;
    if (!isRecord(raw) && raw !== undefined && raw !== null) problems.push(`The settings must be a map of keys; got ${shown(raw)}. The bridge uses its defaults.`);

    if (set('enabled')) {
        const v = typeof given.enabled === 'string' ? given.enabled.trim().toLowerCase() : given.enabled;
        if (YES.has(v)) values.enabled = true;
        else if (NO.has(v)) values.enabled = false;
        else problems.push(`enabled must be true or false, not ${shown(given.enabled)}; the bridge stays on.`);
        if (typeof given.enabled !== 'boolean' && (YES.has(v) || NO.has(v))) problems.push(`enabled is ${shown(given.enabled)}; read as ${values.enabled}. Write it as true or false, without quotes.`);
    }

    if (set('socketPath')) {
        const v = given.socketPath;
        const path = typeof v === 'string' ? expandHome(v.trim()) : '';
        if (typeof v !== 'string' || v.trim() === '') problems.push(`socketPath must be a file path, not ${shown(v)}; the bridge uses ${values.socketPath}.`);
        else if (!isAbsolute(path)) problems.push(`socketPath must be a full path (starting with / or ~/), not ${shown(v)}; the bridge uses ${values.socketPath}.`);
        else if (Buffer.byteLength(path) > SOCKET_PATH_MAX) problems.push(`socketPath is ${Buffer.byteLength(path)} bytes long; the system takes at most ${SOCKET_PATH_MAX}. The bridge uses ${values.socketPath}.`);
        else values.socketPath = resolve(path);
    }

    if (set('logFile')) {
        const v = given.logFile;
        const path = typeof v === 'string' ? expandHome(v.trim()) : '';
        if (typeof v !== 'string') problems.push(`logFile must be a file path, or "" for no log, not ${shown(v)}; the bridge logs to ${values.logFile}.`);
        else if (v.trim() === '') values.logFile = '';
        else if (!isAbsolute(path)) problems.push(`logFile must be a full path (starting with / or ~/), not ${shown(v)}; the bridge logs to ${values.logFile}.`);
        else values.logFile = resolve(path);
    }

    if (set('maxBodyBytes')) {
        const v = given.maxBodyBytes;
        const [min, max] = MAX_BODY_RANGE;
        if (typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max) values.maxBodyBytes = v;
        else problems.push(`maxBodyBytes must be a whole number of bytes from ${min} to ${max}, not ${shown(v)}; the bridge takes up to ${MAX_BODY_DEFAULT}.`);
    }

    for (const key of Object.keys(given)) {
        if (!SETTING_KEYS.has(key)) problems.push(`${key} is not a setting of the session bridge and is ignored (its settings: ${[...SETTING_KEYS].join(', ')}).`);
    }
    return { values, problems };
}

// ── The session's log, read for a caller ──────────────────────────────

/** The text of one message-like event, or ''. */
export function textOf(event) {
    const msg = event?.data?.message ?? event?.data;
    const content = msg?.content;
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
}

/** One durable event, compact, for the wire (the shape every client of the bridge reads). */
export function summarize(event, full) {
    const out = { seq: event.seq, type: event.type, time: event.time };
    const d = event.data ?? {};
    if (d.turn !== undefined) out.turn = d.turn;
    if (event.type === 'turn/end') out.reason = d.reason;
    if (event.type === 'model/selection') out.selection = d;
    if (event.type === 'session/title') out.title = d.title;
    // Who sent a user message: the user (or this bridge, with its request id), another session or a plugin.
    if (event.type === 'user/message' && d.source !== undefined) out.source = d.source;
    if (event.type === 'agent/error' || event.type?.endsWith('/error')) out.error = JSON.stringify(d).slice(0, 2000);
    const text = textOf(event);
    if (text) out.text = full ? text : text.length > TEXT_PREVIEW ? `${text.slice(0, TEXT_PREVIEW)}…(+${text.length - TEXT_PREVIEW})` : text;
    const msg = d.message;
    if (msg?.role) out.role = msg.role;
    if (Array.isArray(msg?.content)) {
        const calls = msg.content.filter((b) => b?.type === 'toolCall' || b?.type === 'tool-call' || b?.type === 'tool_call');
        if (calls.length) out.toolCalls = calls.map((c) => c.name ?? c.toolName).filter(Boolean);
    }
    return out;
}

/** The last assistant text among `events`: { seq, text }, or null. */
export function lastAssistantText(events) {
    for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i];
        const role = e?.data?.message?.role;
        if ((e.type === 'assistant/message' || role === 'assistant') && textOf(e)) return { seq: e.seq, text: textOf(e) };
    }
    return null;
}

/** A session's state as GET /sessions/:id reports it. */
export function sessionSummary(sessionId, header, events, agent) {
    const starts = events.filter((e) => e.type === 'turn/start').length;
    const ends = events.filter((e) => e.type === 'turn/end');
    // The header keeps the title the session was made with; a rename is a session/title event.
    const renamed = events.findLast((e) => e.type === 'session/title')?.data?.title;
    return {
        sessionId,
        cwd: header?.cwd,
        title: renamed ?? header?.title,
        attached: agent !== undefined,
        status: agent?.status ?? 'cold',
        turns: { started: starts, ended: ends.length, lastEnd: ends.at(-1)?.data?.reason ?? null },
        lastSeq: events.at(-1)?.seq ?? -1,
        lastAssistant: lastAssistantText(events),
    };
}

/** Which attempt of `requestId` an rpcId is: 1 for the id itself, n for `<id>~n` (sent again), 0 for another id. */
export function attemptOf(rpcId, requestId) {
    if (typeof rpcId !== 'string') return 0;
    if (rpcId === requestId) return 1;
    if (!rpcId.startsWith(`${requestId}~`)) return 0;
    const n = Number(rpcId.slice(requestId.length + 1));
    return Number.isInteger(n) && n >= 2 ? n : 0;
}

/** The rpcId DSH gets for one attempt: the request id itself, then `<id>~2`, `<id>~3` for each send after a cut-off turn. */
export const rpcIdFor = (requestId, attempt) => (attempt > 1 ? `${requestId}~${attempt}` : requestId);

/** Turn ends after which a prompt was not done: DSH stopped or crashed under the turn, or the turn failed. */
const UNFINISHED = new Set(['interrupted', 'error']);

/**
 * What became of one prompt, read from the session's own log, by its request id:
 *
 * - "waiting": not in the log yet (on its way into DSH);
 * - "queued": in DSH's inbox, for the next turn (a followup) or the next step (a steer);
 * - "read": a turn took it and is still running;
 * - "answered": the turn that read it finished (completed) or was stopped on purpose (aborted): how (`end`),
 *   and its last reply (`reply`, or null);
 * - "unfinished": the turn that read it ended without finishing it: DSH stopped or crashed under it
 *   (interrupted), or it failed (error). Send it again with the same id: the bridge sends it once more;
 * - "dropped": it left the inbox but never reached the log as a message: the turn that took it was cut off
 *   before DSH saved it, or it was taken out of the queue (`removed: true`). Send it again.
 *
 * A prompt sent again after a cut-off turn goes to DSH as `<id>~2` (then `~3`), because DSH takes each rpcId
 * once per session; the newest attempt counts, and `attempt` names it when it is not the first.
 * @param {object[]} events - the session's log.
 * @param {string} requestId - the caller's (or the bridge's) request id.
 * @param {number} [sent] - the attempt this bridge has sent and may not see yet in the log (0: none).
 */
export function requestState(events, requestId, sent = 0) {
    let latest = 0;
    for (const e of events) {
        if (e.type === 'user/message') latest = Math.max(latest, attemptOf(e.data?.source?.rpcId, requestId));
        else if (e.type === 'agent/inbox/spliced' && Array.isArray(e.data?.inserted)) {
            for (const m of e.data.inserted) latest = Math.max(latest, attemptOf(m?.source?.rpcId, requestId));
        }
    }
    const attempt = Math.max(latest, sent);
    const named = attempt > 1 ? { attempt } : {};
    if (sent > latest || latest === 0) return { requestId, state: 'waiting', ...named };
    return { requestId, ...attemptState(events, rpcIdFor(requestId, latest)), ...named };
}

/** The state of one attempt (one rpcId) in the session's log. */
function attemptState(events, rpcId) {
    const mine = (message) => message?.source?.rpcId === rpcId;
    const at = events.findLastIndex((e) => e.type === 'user/message' && mine(e.data));
    if (at >= 0) {
        const message = events[at];
        const start = events.slice(0, at).findLast((e) => e.type === 'turn/start');
        const endAt = events.findIndex((e, i) => i > at && e.type === 'turn/end');
        const out = { state: 'read', seq: message.seq };
        const turn = start?.data?.turn ?? message.data?.turn;
        if (turn !== undefined) out.turn = turn;
        if (endAt >= 0) {
            out.end = endOf(events[endAt]);
            out.state = UNFINISHED.has(out.end.kind) ? 'unfinished' : 'answered';
            out.reply = lastAssistantText(events.slice(at + 1, endAt));
        }
        return out;
    }
    // Not a message in the log yet: replay DSH's inbox (its two lists, as DSH folds them) to see where it is.
    const inbox = { 'next-turn': [], 'next-step': [] };
    let queued;
    let taken;
    let removed = false;
    for (const e of events) {
        if (e.type !== 'agent/inbox/spliced' || !isRecord(e.data)) continue;
        const d = e.data;
        const list = inbox[d.target] ?? (inbox[d.target] = []);
        const inserted = Array.isArray(d.inserted) ? d.inserted : [];
        const out = list.splice(Number.isInteger(d.start) ? d.start : 0, Number.isInteger(d.removedCount) ? d.removedCount : 0, ...inserted);
        // The latest attempt counts: a prompt sent again after it was dropped is queued anew.
        if (out.some(mine) && queued !== undefined && taken === undefined) {
            taken = e;
            // DSH marks a removal from the queue (in the window, or a clear) as canceled; a turn taking it has no outcome.
            removed = d.outcome === 'canceled';
        }
        if (inserted.some(mine)) {
            queued = e;
            taken = undefined;
            removed = false;
        }
    }
    if (!queued) return { state: 'waiting' };
    if (!taken) return { state: 'queued', seq: queued.seq, target: queued.data.target };
    if (removed) return { state: 'dropped', seq: taken.seq, removed: true };
    const before = events.filter((e) => e.seq <= taken.seq);
    const lastStart = before.findLast((e) => e.type === 'turn/start');
    const lastEnd = before.findLast((e) => e.type === 'turn/end');
    const open = lastStart !== undefined && (lastEnd === undefined || lastEnd.seq < lastStart.seq);
    const out = { state: 'dropped', seq: taken.seq };
    if (open && lastStart.data?.turn !== undefined) out.turn = lastStart.data.turn;
    if (!open) return out;
    const end = events.find((e) => e.seq > taken.seq && e.type === 'turn/end');
    if (!end) return { ...out, state: 'read' };
    return { ...out, end: endOf(end) };
}

/** A turn/end event as `{ seq, kind, ... }`. */
function endOf(event) {
    const reason = event.data?.reason;
    return { seq: event.seq, ...(isRecord(reason) ? reason : { kind: String(reason ?? 'unknown') }) };
}

/** States a prompt does not leave by itself (a wait ends on them). */
const FINAL = new Set(['answered', 'unfinished', 'dropped']);

// ── Query values ──────────────────────────────────────────────────────

/** A whole-number query value in [min, max] (above max: max), or its default; anything else is a 400 in words. */
function wholeParam(url, key, fallback, min, max, what = `a whole number of at least ${min}`) {
    const raw = url.searchParams.get(key);
    if (raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw bad(`${key} must be ${what}, not "${raw.slice(0, 40)}".`);
    return Math.min(n, max);
}

// ── The bridge ────────────────────────────────────────────────────────

/**
 * Request ids sent through the bridge since DSH started: id → session id,
 * oldest first, bounded. It is the module's, so it outlives a bridge that a
 * settings change or switching off and on starts again.
 */
const SENT = new Map();

/**
 * Which session each create's request id made, kept in a file beside the socket (mode 600, one JSON line per
 * create: the request id, the session id and its workspace; never a text or a title), so a create retried
 * after DSH restarts finds its session. It holds the last 5000 and is written again, shorter, past 10000 lines.
 */
export function createsRecord(file) {
    const map = new Map();
    let loaded = false;
    let lines = 0;
    const load = () => {
        if (loaded) return;
        loaded = true;
        if (!file) return;
        let text = '';
        try {
            text = readFileSync(file, 'utf8');
        } catch {
            return;
        }
        for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            lines += 1;
            try {
                const entry = JSON.parse(line);
                if (typeof entry?.requestId === 'string' && typeof entry.sessionId === 'string') {
                    map.delete(entry.requestId);
                    map.set(entry.requestId, entry);
                }
            } catch {}
        }
        while (map.size > REMEMBERED) map.delete(map.keys().next().value);
    };
    const writeAll = () => {
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, [...map.values()].map((e) => `${JSON.stringify(e)}\n`).join(''), { mode: 0o600, flag: 'w' });
        renameSync(tmp, file);
        lines = map.size;
    };
    return {
        get(requestId) {
            load();
            return map.get(requestId);
        },
        /** Remember one; a file that cannot be written is said (the caller logs it) and never stops the create. */
        add(entry) {
            load();
            map.delete(entry.requestId);
            map.set(entry.requestId, entry);
            while (map.size > REMEMBERED) map.delete(map.keys().next().value);
            if (!file) return;
            if (lines + 1 > 2 * REMEMBERED) return writeAll();
            const fd = openSync(file, fsc.O_WRONLY | fsc.O_APPEND | fsc.O_CREAT | fsc.O_NOFOLLOW, 0o600);
            try {
                fchmodSync(fd, 0o600);
                writeSync(fd, `${JSON.stringify(entry)}\n`);
            } finally {
                closeSync(fd);
            }
            lines += 1;
        },
        get size() {
            load();
            return map.size;
        },
    };
}

/**
 * One bridge: its routes over DSH's services, its log and its socket.
 *
 * @param {object} options
 * @param {{ sessionController: () => any, workspaceRegistry: () => any, agents: () => any }} options.host - DSH's services, read when used.
 * @param {{ values: object, problems: string[] }} options.settings - from checkSettings.
 * @param {{ info: Function, warn: Function, error?: Function }} [options.logger] - DSH's logger.
 * @param {string} [options.version] - the plugin's version, for GET /health.
 */
export function createBridge({ host, settings, logger, version = '', sent = SENT, logMaxBytes = LOG_MAX_BYTES, readMs = READ_MS, promptMs = PROMPT_MS }) {
    const { values, problems } = settings;
    const socketPath = values.socketPath;
    const say = {
        info: (...a) => { try { logger?.info?.(...a); } catch {} },
        warn: (...a) => { try { logger?.warn?.(...a); } catch {} },
        error: (...a) => { try { (logger?.error ?? logger?.warn)?.(...a); } catch {} },
    };

    // ── The action log: actions and sizes, never a prompt's text or a title ──
    const logFile = values.logFile;
    let logSize = -1;
    function log(line) {
        if (!logFile) return;
        try {
            const text = `${new Date().toISOString()} ${line}\n`;
            const bytes = Buffer.byteLength(text);
            if (logSize < 0) {
                mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
                try {
                    logSize = lstatSync(logFile).size;
                } catch {
                    logSize = 0;
                }
            }
            if (logSize > 0 && logSize + bytes > logMaxBytes) {
                renameSync(logFile, `${logFile}.1`);
                logSize = 0;
            }
            // O_NOFOLLOW: a symlink at the log's path is never written through. The mode is 600 even for a log that was wider.
            const fd = openSync(logFile, fsc.O_WRONLY | fsc.O_APPEND | fsc.O_CREAT | fsc.O_NOFOLLOW, 0o600);
            try {
                fchmodSync(fd, 0o600);
                writeSync(fd, text);
            } finally {
                closeSync(fd);
            }
            logSize += bytes;
        } catch {
            // The log never stops the bridge; the next line tries again from the file's real size.
            logSize = -1;
        }
    }

    // ── Waiting for news: woken by DSH's own session events ──
    /** sessionId → Set of wake functions. */
    const waiters = new Map();
    let stopping = false;

    /** DSH committed an event to a session's log (lib/index.js passes every one). */
    function onSessionEvent(sessionId) {
        const set = waiters.get(sessionId);
        if (!set) return;
        for (const wake of [...set]) wake();
    }

    /**
     * Run `check` now and again after each event of the session, until it
     * says yes, `ms` pass, the caller goes away or the bridge stops.
     * @returns {Promise<'yes' | 'timeout' | 'stopped' | 'gone'>} why the wait ended.
     */
    function waitUntil(sessionId, ms, check, signal) {
        return new Promise((resolvePromise, reject) => {
            let done = false;
            let timer;
            let busy = false;
            let again = false;
            const finish = (value, error) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                const set = waiters.get(sessionId);
                set?.delete(wake);
                if (set?.size === 0) waiters.delete(sessionId);
                signal?.removeEventListener?.('abort', onAbort);
                if (error) reject(error);
                else resolvePromise(value);
            };
            const run = async () => {
                if (done) return;
                if (busy) {
                    again = true;
                    return;
                }
                busy = true;
                try {
                    do {
                        again = false;
                        if (await check()) return finish('yes');
                    } while (again && !done);
                } catch (error) {
                    finish(undefined, error);
                } finally {
                    busy = false;
                }
            };
            const wake = () => {
                if (stopping) return finish('stopped');
                void run();
            };
            const onAbort = () => finish('gone');
            if (signal?.aborted) return finish('gone');
            if (stopping) return finish('stopped');
            signal?.addEventListener?.('abort', onAbort, { once: true });
            if (!waiters.has(sessionId)) waiters.set(sessionId, new Set());
            waiters.get(sessionId).add(wake);
            timer = setTimeout(() => finish('timeout'), ms);
            timer.unref?.();
            // An event that landed between the caller's first read and this registration is not missed.
            void run();
        });
    }

    // ── DSH, read and asked ──
    const sc = () => host.sessionController();

    async function inspect(sessionId) {
        let r;
        try {
            r = await withDeadline(sc().inspect(sessionId, AbortSignal.timeout(readMs)), readMs, () => Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
        } catch (error) {
            if (statusFor(error) === 504) throw new BridgeError(504, 'dsh/timeout', `DSH did not read session ${sessionId} in ${readMs / 1000} s; try again.`);
            if (isNotFound(error)) throw new BridgeError(404, 'session/not-found', errorText(error) || `session "${sessionId}" not found`);
            // Not "not found": the session may well be there, so a caller must not make a new one for its job.
            throw new BridgeError(500, 'session/read-failed', `DSH could not read session ${sessionId}: ${errorText(error)}. The session may still be there: try again; DSH's log says more.`);
        }
        return { header: r?.meta, events: Array.isArray(r?.events) ? r.events : [] };
    }

    /** Remember an attempt this bridge is sending (or sent) for a request id, before DSH is asked. */
    const remember = (requestId, sessionId, attempt) => {
        sent.delete(requestId);
        sent.set(requestId, { sessionId, attempt });
        while (sent.size > REMEMBERED) sent.delete(sent.keys().next().value);
    };
    /** The attempt this bridge sent for a request id to this session, or 0. */
    const sentAttempt = (requestId, sessionId) => {
        const memo = sent.get(requestId);
        if (memo === sessionId) return 1;
        return memo?.sessionId === sessionId ? memo.attempt : 0;
    };
    const forget = (requestId, sessionId, attempt) => {
        if (sentAttempt(requestId, sessionId) === attempt) sent.delete(requestId);
    };

    function requestIdOf(body) {
        if (body.requestId === undefined || body.requestId === null) return undefined;
        if (typeof body.requestId !== 'string' || !REQUEST_ID.test(body.requestId)) {
            throw bad('requestId must be 1 to 128 letters, digits or . _ : - (starting with a letter or digit).');
        }
        return body.requestId;
    }

    async function prompt(sessionId, body) {
        const text = body.text;
        if (typeof text !== 'string' || text.trim() === '') throw bad('text is required: the message to send, as a string.');
        if (body.mode !== undefined && body.mode !== null && body.mode !== 'followup' && body.mode !== 'steer') {
            throw bad(`mode must be "followup" (after the running turn) or "steer" (into it), not ${shown(body.mode)}.`);
        }
        const mode = body.mode === 'steer' ? 'steer' : 'followup';
        const own = requestIdOf(body);
        const requestId = own ?? `bridge-${randomUUID()}`;
        let attempt = 1;
        if (own) {
            // A caller's own id makes a retry safe: one DSH has (queued, read or answered), or one this bridge is
            // still handing over, is not sent again. A dropped one is sent again; an unfinished one (its turn was
            // cut off after DSH saved it) is sent once more as the next attempt, which DSH takes as a new message.
            const { events } = await inspect(sessionId);
            const known = sentAttempt(own, sessionId);
            const now = requestState(events, own, known);
            if (now.state === 'queued' || now.state === 'read' || now.state === 'answered' || (now.state === 'waiting' && known > 0)) {
                log(`prompt ${sessionId} already-sent request=${own} state=${now.state}`);
                return { accepted: true, alreadySent: true, state: now.state, mode, requestId: own, chars: text.length, ...(now.attempt ? { attempt: now.attempt } : {}) };
            }
            const last = now.attempt ?? (now.state === 'waiting' ? 0 : 1);
            attempt = now.state === 'unfinished' ? last + 1 : Math.max(last, 1);
        }
        // Remembered before DSH is asked, so a retry that comes while this one is on its way is not sent twice.
        remember(requestId, sessionId, attempt);
        const rpcId = rpcIdFor(requestId, attempt);
        const call = Promise.resolve().then(() => sc().prompt({ sessionId, content: [{ type: 'text', text }], mode, requestId: rpcId }, AbortSignal.timeout(promptMs)));
        let late = false;
        try {
            await withDeadline(call, promptMs, () => {
                late = true;
                return new BridgeError(504, 'dsh/timeout', `DSH did not take the prompt in ${promptMs / 1000} s. It may still take it: ask GET /sessions/${sessionId}/requests/${requestId} before you send it again.`, { requestId });
            });
        } catch (error) {
            if (late) {
                // Still remembered: DSH may take it yet, and a retry meanwhile must not send it twice.
                log(`prompt ${sessionId} timeout request=${requestId} after=${promptMs}ms`);
                call.then(() => log(`prompt ${sessionId} taken-late request=${requestId}`), (refused) => {
                    forget(requestId, sessionId, attempt);
                    log(`prompt ${sessionId} refused-late request=${requestId} ${errorText(refused)}`);
                });
            } else {
                forget(requestId, sessionId, attempt);
            }
            throw error;
        }
        log(`prompt ${sessionId} mode=${mode} chars=${text.length} request=${requestId}${attempt > 1 ? ` attempt=${attempt}` : ''}`);
        return { accepted: true, mode, requestId, chars: text.length, ...(attempt > 1 ? { attempt, resent: true } : {}) };
    }

    function effortOf(body) {
        if (body.reasoningEffort === undefined || body.reasoningEffort === null) return undefined;
        if (typeof body.reasoningEffort !== 'string' || !body.reasoningEffort.trim()) throw bad('reasoningEffort must be a string, such as "high".');
        return body.reasoningEffort;
    }

    async function selectModel(sessionId, body) {
        if (typeof body.provider !== 'string' || !body.provider || typeof body.model !== 'string' || !body.model) {
            throw bad('provider and model are required, as strings (GET /models lists them).');
        }
        const effort = effortOf(body);
        const r = await sc().selectModel({ sessionId, provider: body.provider, model: body.model, ...(effort ? { reasoningEffort: effort } : {}) });
        log(`model ${sessionId} ${body.provider}/${body.model}${effort ? ` ${effort}` : ''}`);
        return r;
    }

    function titleOf(body) {
        if (typeof body.title !== 'string' || body.title.trim() === '') throw bad('title is required, as a string.');
        if (body.title.length > TITLE_MAX) throw bad(`title may be at most ${TITLE_MAX} characters.`);
        return body.title;
    }

    async function rename(sessionId, title) {
        const r = await sc().rename({ sessionId, title });
        log(`rename ${sessionId} chars=${title.length}`);
        return r;
    }

    async function workspaceFor(body) {
        const registry = host.workspaceRegistry();
        if (body.workspaceId !== undefined && body.workspaceId !== null) {
            if (typeof body.workspaceId !== 'string' || !body.workspaceId) throw bad('workspaceId must be a string (GET /workspaces lists them).');
            const ws = registry.get(body.workspaceId);
            if (!ws) throw new BridgeError(404, 'workspace/not-found', `No workspace ${body.workspaceId} (GET /workspaces lists them).`);
            return ws;
        }
        if (body.workspacePath !== undefined && body.workspacePath !== null) {
            if (typeof body.workspacePath !== 'string' || !body.workspacePath.trim()) throw bad('workspacePath must be a folder path, as a string.');
            const path = expandHome(body.workspacePath.trim());
            if (!isAbsolute(path)) throw bad(`workspacePath must be a full path (starting with / or ~/), not ${shown(body.workspacePath)}.`);
            let st;
            try { st = statSync(path); } catch {}
            if (!st?.isDirectory()) throw bad(`workspacePath ${shown(body.workspacePath)} is not a folder on this computer; make it first.`);
            return registry.create(resolve(path));
        }
        throw bad('workspacePath (a folder) or workspaceId (from GET /workspaces) is required.');
    }

    // ── Creates: one session per request id, even when retried after a timeout or a restart ──
    const creates = createsRecord(socketPath ? join(dirname(socketPath), CREATES_FILE) : '');
    /** request id → the create (or carry-on) running for it now, so retries that overlap run one after another. */
    const creating = new Map();

    function checkCreate(body) {
        for (const key of ['title', 'text', 'provider', 'model', 'agentPreset']) {
            if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') throw bad(`${key} must be a string.`);
        }
        if (body.title) titleOf(body);
        if ((body.provider || body.model) && !(body.provider && body.model)) throw bad('provider and model go together: give both, or neither for DSH\'s default model.');
        if (effortOf(body) !== undefined && !body.model) throw bad('reasoningEffort goes with provider and model: give all three (GET /models lists them), or none for DSH\'s default model and effort.');
        if (typeof body.text === 'string' && body.text !== '' && body.text.trim() === '') throw bad('text must hold more than spaces: the first message to send.');
        return requestIdOf(body);
    }

    async function createSession(body) {
        const own = checkCreate(body);
        if (!own) return makeSession(body);
        // Retries of one request id run one after another: the second finds the session the first made.
        const before = creating.get(own) ?? Promise.resolve();
        const run = before.catch(() => {}).then(() => (creates.get(own) ? carryOn(creates.get(own), body, own) : makeSession(body, own)));
        creating.set(own, run);
        try {
            return await run;
        } finally {
            if (creating.get(own) === run) creating.delete(own);
        }
    }

    /** The steps after the session exists: its model, its title, its first prompt. A step that fails says which. */
    async function steps(sessionId, workspace, body, out, skip = {}) {
        let stepName = 'model';
        try {
            if (body.model && !skip.model) out.model = await selectModel(sessionId, body);
            stepName = 'title';
            if (body.title && !skip.title) out.title = await rename(sessionId, body.title);
            stepName = 'prompt';
            if (body.text) out.prompt = await prompt(sessionId, { text: body.text, mode: 'followup', requestId: body.requestId });
        } catch (error) {
            const status = statusFor(error);
            const code = error instanceof BridgeError ? error.code : codeOf(error);
            throw new BridgeError(status, code, `Session ${sessionId} was made, but setting its ${stepName} failed: ${errorText(error)}`, { sessionId, workspace, failedStep: stepName });
        }
        return out;
    }

    async function makeSession(body, own) {
        const ws = await workspaceFor(body);
        const created = await sc().create({ workspaceId: ws.id, ...(body.agentPreset ? { agentPreset: body.agentPreset } : {}) });
        const sessionId = created.sessionId;
        const workspace = { id: ws.id, path: ws.path };
        log(`create ${sessionId} ws=${ws.path}${body.agentPreset ? ` preset=${body.agentPreset}` : ''}${own ? ` request=${own}` : ''}`);
        if (own) {
            try {
                creates.add({ requestId: own, sessionId, workspace, time: new Date().toISOString() });
            } catch (error) {
                log(`error remembering create request=${own}: ${errorText(error)}`);
            }
        }
        // The session exists from here on: a step that fails says so, with the session's id, so the caller can carry on or clean up.
        return steps(sessionId, workspace, body, { sessionId, workspace });
    }

    /** A create retried with its request id: the session it made, with the steps it did not finish done now, once. */
    async function carryOn(known, body, own) {
        const ws = await workspaceFor(body);
        if (ws.id !== known.workspace?.id) {
            throw new BridgeError(409, 'request/conflict', `Request id ${own} already made session ${known.sessionId} in ${known.workspace?.path ?? 'another folder'}; use a new request id for a session in ${ws.path}.`, { sessionId: known.sessionId });
        }
        let read;
        try {
            read = await inspect(known.sessionId);
        } catch (error) {
            if (error?.status !== 404) throw error;
            throw new BridgeError(409, 'request/session-gone', `Request id ${own} made session ${known.sessionId}, which DSH no longer has; use a new request id to make another.`, { sessionId: known.sessionId });
        }
        const { header, events } = read;
        const chosen = events.findLast((e) => e.type === 'model/selection')?.data;
        const sameModel = chosen?.provider === body.provider && chosen?.model === body.model && (effortOf(body) === undefined || chosen?.reasoningEffort === body.reasoningEffort);
        const title = events.findLast((e) => e.type === 'session/title')?.data?.title ?? header?.title;
        log(`create ${known.sessionId} already-made request=${own}`);
        return steps(known.sessionId, known.workspace, body, { sessionId: known.sessionId, workspace: known.workspace, alreadyCreated: true }, { model: sameModel, title: title === body.title });
    }

    // ── Routes ──
    const ROUTES = 'GET /health, /workspaces, /models, /sessions, /sessions/:id, /sessions/:id/events, /sessions/:id/requests/:requestId; POST /sessions, /sessions/:id/prompt, /model, /cancel, /rename';
    const notFound = () => new BridgeError(404, 'not-found', `No such path. The bridge answers ${ROUTES}.`);
    const method405 = (allow) => new BridgeError(405, 'method', `Use ${allow} here.`, { allow });

    async function route(method, url, readBody, signal) {
        const path = url.pathname.replace(/\/+$/, '') || '/';
        let parts;
        try {
            parts = path.split('/').filter(Boolean).map(decodeURIComponent);
        } catch {
            throw bad('The path is not valid URL encoding.');
        }
        if (path === '/health') {
            if (method !== 'GET') throw method405('GET');
            return { ok: true, plugin: PLUGIN, version, pid: process.pid, socket: socketPath, problems };
        }
        if (path === '/workspaces') {
            if (method !== 'GET') throw method405('GET');
            return host.workspaceRegistry().list().map((w) => ({ id: w.id, path: w.path, title: w.title, sessions: w.sessionIds?.length ?? 0 }));
        }
        if (path === '/models') {
            if (method !== 'GET') throw method405('GET');
            return sc().modelCatalog();
        }
        if (parts[0] !== 'sessions' || parts.length > 4) throw notFound();
        if (parts.length === 1) {
            if (method === 'GET') return (await sc().list({}, AbortSignal.timeout(READ_MS))).items;
            if (method === 'POST') return createSession(await readBody());
            throw method405('GET, POST');
        }
        const sessionId = parts[1];
        if (sessionId.length > 200) throw bad('That is not a session id.');
        const action = parts[2];
        if (action === undefined) {
            if (method !== 'GET') throw method405('GET');
            const { header, events } = await inspect(sessionId);
            return sessionSummary(sessionId, header, events, host.agents()?.get?.(sessionId));
        }
        if (action === 'events') {
            if (parts.length > 3) throw notFound();
            if (method !== 'GET') throw method405('GET');
            return eventsPage(sessionId, url, signal);
        }
        if (action === 'requests') {
            if (parts.length !== 4) throw notFound();
            if (method !== 'GET') throw method405('GET');
            return requestPage(sessionId, parts[3], url, signal);
        }
        if (parts.length > 3 || !['prompt', 'model', 'cancel', 'rename'].includes(action)) throw notFound();
        if (method !== 'POST') throw method405('POST');
        const body = await readBody();
        if (action === 'prompt') return prompt(sessionId, body);
        if (action === 'model') return selectModel(sessionId, body);
        if (action === 'rename') return rename(sessionId, titleOf(body));
        if (host.agents()?.get?.(sessionId) === undefined) {
            await inspect(sessionId); // a 404 when there is no such session
            throw new BridgeError(409, 'session/not-running', `Session ${sessionId} is not open in DSH, so no turn runs to cancel.`);
        }
        const r = await sc().cancel({ sessionId });
        log(`cancel ${sessionId}`);
        return r;
    }

    async function eventsPage(sessionId, url, signal) {
        const after = Math.max(-1, wholeParam(url, 'after', -1, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'a whole number: the last seq you have, or -1 for the start'));
        const limit = wholeParam(url, 'limit', 200, 1, EVENTS_LIMIT_MAX, `a whole number from 1 to ${EVENTS_LIMIT_MAX}`);
        const wait = wholeParam(url, 'wait', 0, 0, WAIT_MAX_SECONDS, `a whole number of seconds from 0 to ${WAIT_MAX_SECONDS}`);
        const full = url.searchParams.get('full') === '1';
        const types = url.searchParams.get('types');
        const want = types ? new Set(types.split(',').map((t) => t.trim()).filter(Boolean)) : null;
        const pick = (list) => list.filter((e) => e.seq > after && (!want || want.has(e.type)));
        let { events } = await inspect(sessionId);
        let chosen = pick(events);
        let ended;
        if (wait > 0 && chosen.length === 0) {
            ended = await waitUntil(sessionId, wait * 1000, async () => {
                ({ events } = await inspect(sessionId));
                chosen = pick(events);
                return chosen.length > 0;
            }, signal);
        }
        const more = chosen.length > limit;
        chosen = chosen.slice(0, limit);
        return { lastSeq: events.at(-1)?.seq ?? -1, more, events: chosen.map((e) => summarize(e, full)), ...waited(wait, ended) };
    }

    /** What a wait says: `timedOut` (as before) when it ended without news, and `stopped` when the bridge's stop ended it. */
    function waited(wait, ended) {
        if (!(wait > 0)) return {};
        return { timedOut: ended !== undefined && ended !== 'yes', ...(ended === 'stopped' ? { stopped: true } : {}) };
    }

    async function requestPage(sessionId, requestId, url, signal) {
        if (!REQUEST_ID.test(requestId)) throw bad('That is not a request id (the requestId a prompt answered with).');
        const wait = wholeParam(url, 'wait', 0, 0, WAIT_MAX_SECONDS, `a whole number of seconds from 0 to ${WAIT_MAX_SECONDS}`);
        let { events } = await inspect(sessionId);
        let state = requestState(events, requestId, sentAttempt(requestId, sessionId));
        if (state.state === 'waiting' && sentAttempt(requestId, sessionId) === 0) {
            throw new BridgeError(404, 'request/not-found', `Session ${sessionId} has no message with request id ${requestId}: none is in its log, and the bridge sent none to it since DSH started.`);
        }
        let ended;
        if (wait > 0 && !FINAL.has(state.state)) {
            ended = await waitUntil(sessionId, wait * 1000, async () => {
                ({ events } = await inspect(sessionId));
                state = requestState(events, requestId, sentAttempt(requestId, sessionId));
                return FINAL.has(state.state);
            }, signal);
        }
        return { sessionId, ...state, ...waited(wait, ended) };
    }

    // ── HTTP ──
    async function readBodyOf(req) {
        const declared = Number(req.headers['content-length']);
        if (Number.isFinite(declared) && declared > values.maxBodyBytes) throw new BridgeError(413, 'too-large', `The request body is ${declared} bytes; the bridge takes at most ${values.maxBodyBytes} (maxBodyBytes).`);
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            size += chunk.length;
            if (size > values.maxBodyBytes) throw new BridgeError(413, 'too-large', `The request body is over ${values.maxBodyBytes} bytes (maxBodyBytes).`);
            chunks.push(chunk);
        }
        if (size === 0) return {};
        let value;
        try {
            value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
            throw new BridgeError(400, 'bad-json', 'The body is not valid JSON.');
        }
        if (!isRecord(value)) throw new BridgeError(400, 'bad-json', 'The body must be a JSON object, such as {"text": "…"}.');
        return value;
    }

    async function handle(req, res) {
        let status = 200;
        let payload;
        let headers = {};
        const controller = new AbortController();
        res.once('close', () => controller.abort());
        let url;
        try {
            url = new URL(req.url ?? '/', 'http://bridge.local');
            if (stopping) throw new BridgeError(503, 'stopping', 'The session bridge is stopping; try again when DSH is back.');
            payload = await route(req.method ?? 'GET', url, () => readBodyOf(req), controller.signal);
        } catch (error) {
            status = statusFor(error);
            const code = error instanceof BridgeError ? error.code : codeOf(error);
            payload = { error: { code: String(code), message: errorText(error, 2000) } };
            if (error?.extra) {
                const { allow, ...rest } = error.extra;
                if (allow) headers = { allow };
                Object.assign(payload, rest);
            }
            log(`error ${req.method} ${url?.pathname ?? '?'} ${status} ${code} ${errorText(error)}`);
            if (status === 413) headers.connection = 'close';
        }
        if (res.destroyed || res.writableEnded) return;
        const text = JSON.stringify(payload ?? null);
        res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...headers });
        res.end(text);
    }

    // ── The socket ──
    let server;
    let boundIno;
    let refused;

    async function start() {
        for (const problem of problems) {
            log(`setting: ${problem}`);
            say.warn('session-bridge: %s', problem);
        }
        refused = await prepareSocket(socketPath);
        if (refused || stopping) {
            if (refused) {
                log(`not listening on ${socketPath}: ${refused}`);
                say.error('session-bridge: not listening on %s: %s', socketPath, refused);
            }
            return false;
        }
        server = createServer((req, res) => {
            handle(req, res).catch((error) => {
                // handle answers every error itself; this is for a write that fails.
                log(`error answering ${req.method} ${req.url}: ${errorText(error)}`);
                try { res.destroy(); } catch {}
            });
        });
        server.on('error', (error) => {
            log(`server error ${errorText(error)}`);
            say.warn('session-bridge: server error %s', errorText(error));
        });
        const listening = new Promise((resolvePromise, reject) => {
            server.once('listening', resolvePromise);
            server.once('error', reject);
        });
        // The umask is the whole process's, so it is narrowed only around listen(), which binds the
        // socket before it returns: the socket is made 600, and nothing else DSH makes meanwhile is touched.
        const oldUmask = process.umask(0o177);
        try {
            server.listen(socketPath);
        } finally {
            process.umask(oldUmask);
        }
        try {
            await listening;
        } catch (error) {
            refused = errorText(error);
            log(`not listening on ${socketPath}: ${refused}`);
            say.error('session-bridge: not listening on %s: %s', socketPath, refused);
            server = undefined;
            return false;
        }
        try {
            chmodSync(socketPath, 0o600);
            boundIno = statSync(socketPath).ino;
        } catch {}
        log(`listening ${socketPath} pid=${process.pid}`);
        say.info('session-bridge: listening on %s', socketPath);
        return true;
    }

    /** Stop: wake every waiting request (each answers with what it has), close the socket, remove its file. */
    async function stop() {
        stopping = true;
        for (const set of [...waiters.values()]) for (const wake of [...set]) wake();
        const s = server;
        server = undefined;
        if (!s) return;
        await new Promise((resolvePromise) => {
            const force = setTimeout(() => s.closeAllConnections?.(), 2000);
            force.unref?.();
            s.close(() => {
                clearTimeout(force);
                resolvePromise();
            });
            s.closeIdleConnections?.();
        });
        // Node removes the socket file as it closes; this removes it only if it is still the one this bridge made.
        try {
            if (boundIno !== undefined && lstatSync(socketPath).ino === boundIno) unlinkSync(socketPath);
        } catch {}
        log('stopped');
    }

    return {
        start,
        stop,
        handle,
        route,
        onSessionEvent,
        log,
        get refused() { return refused; },
        get listening() { return Boolean(server?.listening); },
        get waiting() { let n = 0; for (const set of waiters.values()) n += set.size; return n; },
        socketPath,
        settings: values,
        problems,
    };
}

/** Whether something answers on a Unix socket now. */
export function answers(path, ms = 1000) {
    return new Promise((resolvePromise) => {
        const socket = connect(path);
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolvePromise(value);
        };
        socket.once('connect', () => done(true));
        socket.once('error', () => done(false));
        // Something holds it but does not answer: it is someone's, so it is left alone.
        socket.setTimeout(ms, () => done(true));
    });
}

/** Whether a folder is the home folder, however it is spelt (another letter case, a symlink): by device and inode. */
function isHome(dir, st) {
    if (resolve(dir) === resolve(homedir())) return true;
    try {
        const home = statSync(homedir());
        return st.dev === home.dev && st.ino === home.ino;
    } catch {
        return false;
    }
}

/**
 * Make the socket's place ready, or say in words why the bridge will not
 * listen there. Its folder is closed to everyone else (700) unless it is a
 * shared one (the home folder, a sticky folder such as /tmp, another user's),
 * which the bridge refuses instead of closing. An old socket nobody answers
 * on (left by a crash) is removed; a live one, or a file that is not a
 * socket, is never touched.
 * @returns {Promise<string | undefined>} why not, or undefined when ready.
 */
export async function prepareSocket(socketPath) {
    if (typeof socketPath !== 'string' || !isAbsolute(socketPath)) return 'the socket path must be a full path';
    if (Buffer.byteLength(socketPath) > SOCKET_PATH_MAX) return `the socket path is ${Buffer.byteLength(socketPath)} bytes; the system takes at most ${SOCKET_PATH_MAX}. Choose a shorter socketPath.`;
    const dir = dirname(socketPath);
    let st;
    try {
        st = statSync(dir);
    } catch (error) {
        if (error?.code !== 'ENOENT') return `its folder ${dir} cannot be read (${error?.code ?? errorText(error)})`;
    }
    if (!st) {
        try {
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            chmodSync(dir, 0o700);
        } catch (error) {
            return `its folder ${dir} cannot be made (${error?.code ?? errorText(error)})`;
        }
    } else {
        if (!st.isDirectory()) return `${dir} is not a folder`;
        if (typeof process.getuid === 'function' && st.uid !== process.getuid()) return `its folder ${dir} belongs to another user; give the socket a folder of its own`;
        if ((st.mode & 0o1000) !== 0 || isHome(dir, st)) return `its folder ${dir} is shared, and the bridge closes its folder to everyone else; give the socket a folder of its own, such as ${resolve(dir, 'session-bridge', 'bridge.sock')}`;
        try {
            chmodSync(dir, 0o700);
        } catch (error) {
            return `its folder ${dir} cannot be closed to other users (${error?.code ?? errorText(error)})`;
        }
    }
    let entry;
    try {
        entry = lstatSync(socketPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') return `${socketPath} cannot be read (${error?.code ?? errorText(error)})`;
    }
    if (entry) {
        if (!entry.isSocket()) return `${socketPath} is a file that is not a socket, and the bridge never deletes one; move it or choose another socketPath`;
        if (await answers(socketPath)) return `another program answers on ${socketPath} (another DSH, or a second session-bridge row); the bridge does not take it over`;
        try {
            unlinkSync(socketPath);
        } catch (error) {
            if (error?.code !== 'ENOENT') return `the old socket ${socketPath} cannot be removed (${error?.code ?? errorText(error)})`;
        }
    }
    return undefined;
}
