// Focus — host side.
// Keeps the pomodoro settings, the countdown timer and the daily session count in this plugin's
// own folder (<DSH home>/focus: state.json, focus.log) and serves them on /api/focus/state.
// The countdown is stored as an absolute endAt, so it stays correct across page reloads and DSH
// restarts. The host ends a timer itself when its endAt comes (or, after DSH was closed, as soon as
// it starts again), so a focus session is counted once, on the day it ended, with or without a
// window open. A window's `complete` op only asks the host to check now.

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const name = 'focus';
export const inject = [];

export const SETTINGS_DEFAULTS = Object.freeze({ focusMin: 25, shortMin: 5, longMin: 15, chime: true });
const MINUTE_KEYS = ['focusMin', 'shortMin', 'longMin'];
export const KINDS = Object.freeze(['focus', 'short', 'long', 'custom']);
export const OPS = Object.freeze(['start', 'pause', 'resume', 'reset', 'set', 'complete', 'seen', 'undo']);
/** How long a Reset of a started timer can be undone (and only while nothing else changed). */
export const UNDO_MS = 60_000;
const FOCUS_DEFAULT_MS = 25 * 60_000;
export const DURATION_MIN_MS = 10_000;
export const DURATION_MAX_MS = 10_800_000; // 3 h
export const MINUTES_MIN = 1;
export const MINUTES_MAX = 180;
/** focus.log starts a new part past this size; the old part is kept once, as focus.log.1. */
export const LOG_MAX_BYTES = 1024 * 1024;
/** A window's `complete` counts when the end is this close: its clock and the host's may differ a little. */
export const DUE_SLACK_MS = 1500;

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtS = (ms) => `${Math.round(ms / 1000)}s`;
const expand = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? homedir() + p.slice(1) : p);
function shown(v) {
  if (typeof v === 'string') return `"${v.length > 60 ? `${v.slice(0, 59)}…` : v}"`;
  try { return JSON.stringify(v); } catch { return String(v); }
}
/** One short line for an error: its message, never a stack. */
export const errorText = (e) => String((e instanceof Error ? e.message || e.name : e) ?? 'unknown error').replace(/\s+/g, ' ').trim().slice(0, 300);

/** A file error in words people read (the code and the path go to the logs, not the window). */
export function whyInWords(e) {
  switch (e?.code) {
    case 'ENOTDIR': case 'EEXIST': return 'a file is in the way';
    case 'EACCES': case 'EPERM': return 'no permission to write there';
    case 'EROFS': return 'the disk is read-only';
    case 'ENOSPC': return 'the disk is full';
    case 'ENOENT': return 'a folder on the way is missing';
    default: return e?.code ? `error ${e.code}` : errorText(e);
  }
}
/** How the window names Focus's folder: never a raw path (DESIGN.md section 9). */
const DEFAULT_FOLDER = 'its default folder (focus in DSH\'s data folder)';
// Where the timer's folder is, in words a person can follow (the window shows no path, and DSH 0.2.1
// keeps its logger's lines in memory only, so the words do not send anyone to DSH's log).
const FOLDER_DEFAULT = 'focus in DSH\'s data folder';
const FOLDER_SET = 'the one set as dataDir in its settings';

/** The server's local day of a time, as YYYY-MM-DD. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Remaining time for the canonical timer shape. While running, endAt is authoritative
// (remainingMs is only a stale cache); while idle, remainingMs is. The client mirrors this logic in its local tick.
export const remainingOf = (timer, nowMs = Date.now()) =>
  timer?.running ? Math.max(0, timer.endAt - nowMs) : timer?.remainingMs;

// Daily rollover: a stored date that isn't `dateStr` (server-local YYYY-MM-DD) resets the count.
// Replaces state.sessions when it rolls, so `state.sessions !== before` detects a change.
export const rollSessions = (state, dateStr = localDay()) => {
  const s = state.sessions;
  if (!s || typeof s !== 'object' || s.date !== dateStr || !Number.isInteger(s.focus) || s.focus < 0) {
    state.sessions = { date: dateStr, focus: 0 };
  }
  return state.sessions;
};

/** DSH's data folder: DSH_HOME, else ~/.dsh. A test DSH has its own. */
const dshHome = (env = process.env) => env.DSH_HOME || join(homedir(), '.dsh');

/**
 * The row's config, checked in words. A wrong value never stops Focus: it keeps its timer in the
 * default folder and says why (to DSH's logger, in focus.log and in GET /api/focus/state `problems`).
 * The words name no path, since the window shows them; the logs add the folder (`fallback`).
 * @returns {{ dataDir: string, problems: string[], fallback: string }}
 */
export function checkConfig(raw, env = process.env) {
  const fallback = join(dshHome(env), 'focus');
  const problems = [];
  let dataDir = fallback;
  if (raw !== undefined && raw !== null && !isRecord(raw)) problems.push(`Focus's settings must be a map of keys, not ${shown(raw)}; it uses its defaults.`);
  const given = isRecord(raw) ? raw : {};
  const v = given.dataDir;
  if (v !== undefined && v !== null && v !== '') {
    if (typeof v !== 'string' || v.trim() === '') problems.push(`dataDir must be a folder path, not ${shown(v)}; Focus keeps its timer in ${DEFAULT_FOLDER}.`);
    else if (!isAbsolute(expand(v.trim()))) problems.push(`dataDir must be a full path (starting with / or ~/), not ${shown(v)}; Focus keeps its timer in ${DEFAULT_FOLDER}.`);
    else dataDir = resolve(expand(v.trim()));
  }
  for (const key of Object.keys(given)) if (key !== 'dataDir') problems.push(`${key} is not a setting of Focus and is ignored (its one setting is dataDir).`);
  return { dataDir, problems, fallback };
}

/** A first run's state. */
export const defaultState = (day = localDay()) => ({
  settings: { ...SETTINGS_DEFAULTS },
  timer: { kind: 'focus', durationMs: FOCUS_DEFAULT_MS, remainingMs: FOCUS_DEFAULT_MS, endAt: null, running: false, doneAt: null, doneSeen: false },
  sessions: { date: day, focus: 0 },
  rev: 0,
});

/** A saved state back in the canonical shape: only known keys, whole minutes 1–180, typed timer fields. */
export function normalizeState(saved, day = localDay()) {
  const state = defaultState(day);
  if (!isRecord(saved)) return state;
  const s = isRecord(saved.settings) ? saved.settings : {};
  for (const k of MINUTE_KEYS) if (isNum(s[k])) state.settings[k] = clamp(Math.round(s[k]), MINUTES_MIN, MINUTES_MAX);
  if (typeof s.chime === 'boolean') state.settings.chime = s.chime;
  const t = isRecord(saved.timer) ? saved.timer : {};
  state.timer = {
    kind: KINDS.includes(t.kind) ? t.kind : 'focus',
    durationMs: isNum(t.durationMs) ? clamp(t.durationMs, DURATION_MIN_MS, DURATION_MAX_MS) : FOCUS_DEFAULT_MS,
    remainingMs: isNum(t.remainingMs) ? clamp(t.remainingMs, 0, DURATION_MAX_MS) : FOCUS_DEFAULT_MS,
    endAt: isNum(t.endAt) ? t.endAt : null,
    running: t.running === true,
    doneAt: isNum(t.doneAt) ? t.doneAt : null,
    // An end saved before 0.2.1 (no doneSeen) counts as seen, so an upgrade marks nothing old.
    doneSeen: isNum(t.doneAt) ? (typeof t.doneSeen === 'boolean' ? t.doneSeen : true) : false,
  };
  if (state.timer.running && state.timer.endAt === null) state.timer.running = false; // without its endAt a running timer is unusable
  if (!state.timer.running) state.timer.endAt = null; // idle → remainingMs is the authority
  state.timer.remainingMs = Math.min(state.timer.remainingMs, state.timer.durationMs); // never more left than the length
  if (isRecord(saved.sessions)) state.sessions = { date: saved.sessions.date, focus: saved.sessions.focus };
  rollSessions(state, day);
  state.rev = Number.isInteger(saved.rev) && saved.rev >= 0 ? saved.rev : 0;
  return state;
}

/** A refusal: an HTTP status and a sentence that says what to do. */
class Refusal extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const RUNNING = {
  start: 'A timer is already running. Pause or reset it first.',
  set: 'A timer is running. Pause or reset it first, then choose another length.',
};
const NO_UNDO = 'There is no Reset to undo: the timer changed since, or the Reset was more than a minute ago.';

function validateSettings(patch) {
  if (!isRecord(patch)) throw new Refusal(400, 'settings must be a JSON object, such as {"chime": false}.');
  const out = {};
  for (const k of MINUTE_KEYS) {
    if (!(k in patch)) continue;
    if (!isNum(patch[k])) throw new Refusal(400, `settings.${k} must be a number of minutes, from ${MINUTES_MIN} to ${MINUTES_MAX}.`);
    out[k] = clamp(Math.round(patch[k]), MINUTES_MIN, MINUTES_MAX);
  }
  if ('chime' in patch) {
    if (typeof patch.chime !== 'boolean') throw new Refusal(400, 'settings.chime must be true or false.');
    out.chime = patch.chime;
  }
  return out;
}

function validateOp(op) {
  if (!isRecord(op)) throw new Refusal(400, 'op must be an object, such as {"op": "start", "kind": "focus", "durationMs": 1500000}.');
  if (!OPS.includes(op.op)) throw new Refusal(400, `op must be one of ${OPS.join(', ')}, not ${shown(op.op ?? null)}.`);
  if (op.op === 'start' || op.op === 'set') {
    if (!KINDS.includes(op.kind)) throw new Refusal(400, `kind must be one of ${KINDS.join(', ')}.`);
    if (!isNum(op.durationMs)) throw new Refusal(400, 'durationMs must be a number of milliseconds.');
    return { op: op.op, kind: op.kind, durationMs: clamp(Math.round(op.durationMs), DURATION_MIN_MS, DURATION_MAX_MS) };
  }
  return { op: op.op };
}

/**
 * Focus's working parts: its state, its ops, its own end of a timer, its log and its route. Its
 * clock, its day and its timers are handed in, so a test can run time forward.
 *
 * @param {object} options
 * @param {string} options.dataDir - state.json and focus.log live here.
 * @param {string[]} [options.problems] - what was wrong with the config, in words (no paths: the window shows them).
 * @param {(level: 'info'|'warn', text: string) => void} [options.say] - DSH's logger.
 * @param {string} [options.folder] - the folder in words, for the window: the default one or the one set.
 */
export function createFocus({
  dataDir, problems: configProblems = [], now = Date.now, day = (ms) => localDay(new Date(ms)),
  setTimer = setTimeout, clearTimer = clearTimeout, say = () => {}, logMaxBytes = LOG_MAX_BYTES,
  folder = FOLDER_DEFAULT,
}) {
  let storeProblem = null;
  let folderOk = true;
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    folderOk = false;
    // The window's words name no path but say which folder; DSH's logger gets the path and the code.
    storeProblem = `Focus could not make its folder (${whyInWords(e)}): the timer works, but is not kept across a restart. Its folder is ${folder}.`;
    say('warn', `could not make its folder ${dataDir} (${e?.code ?? errorText(e)}): the timer works, but is not kept across a restart`);
  }
  const logFile = join(dataDir, 'focus.log');
  const statePath = join(dataDir, 'state.json');

  // One ISO-stamped line in focus.log; it never throws, and starts a new part past its size.
  let logSize = -1;
  function log(line) {
    if (!folderOk) return;
    try {
      if (logSize < 0) { try { logSize = statSync(logFile).size; } catch { logSize = 0; } }
      const text = `${new Date(now()).toISOString()} ${line}\n`;
      if (logSize > 0 && logSize + Buffer.byteLength(text) > logMaxBytes) { renameSync(logFile, `${logFile}.1`); logSize = 0; }
      appendFileSync(logFile, text);
      logSize += Buffer.byteLength(text);
    } catch { logSize = -1; }
  }
  for (const p of configProblems) log(`setting: ${p}`);

  // ── state ──
  let saved = null;
  let firstStart = true;
  if (folderOk) {
    try {
      saved = JSON.parse(readFileSync(statePath, 'utf8'));
      firstStart = false;
    } catch (e) {
      if (e?.code !== 'ENOENT') {
        firstStart = false;
        log(`state.json could not be read (${errorText(e)}); starting from the defaults`);
        say('warn', `state.json could not be read (${errorText(e)}); starting from the defaults`);
      }
    }
  }
  const today = () => day(now());
  const state = normalizeState(saved, today());

  function save() {
    if (!folderOk) return;
    try {
      const tmp = `${statePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 1));
      renameSync(tmp, statePath);
      if (storeProblem) { log('state.json written again'); storeProblem = null; }
    } catch (e) {
      // The window's words name no path but say which folder; focus.log and DSH's logger get the path and the code.
      const why = `Focus could not save its timer (${whyInWords(e)}); it keeps counting, but a restart would lose the change. Its folder is ${folder}.`;
      if (storeProblem !== why) {
        const logged = `could not save its timer to ${statePath} (${e?.code ?? errorText(e)}); it keeps counting, but a restart would lose the change`;
        log(logged);
        say('warn', logged);
      }
      storeProblem = why;
    }
  }

  // ── the host's own end of a timer ──
  let timer = null;
  let stopped = false;
  // The timer as it was before the last Reset of a started timer, for Undo: kept in memory only,
  // and good only while nothing else changed (the revision is the same) and for UNDO_MS.
  let undo = null;
  const canUndo = (at) => undo !== null && undo.rev === state.rev && at - undo.at <= UNDO_MS;
  function arm() {
    if (timer) { clearTimer(timer); timer = null; }
    if (stopped || !state.timer.running) return;
    timer = setTimer(() => { timer = null; completeDue(now()); }, Math.max(0, state.timer.endAt - now()) + 25);
    timer?.unref?.();
  }
  function changed() {
    state.rev += 1;
    save();
    arm();
  }

  /** End the running timer if its end has come (within `slack`): once, as of its endAt. */
  function completeDue(at, slack = 0) {
    const t = state.timer;
    if (stopped || !t.running || t.endAt === null || t.endAt > at + slack) return false;
    const endedAt = t.endAt;
    // doneSeen: false until a window shows the end in its panel (op seen) or the next timer starts.
    state.timer = { ...t, running: false, endAt: null, remainingMs: t.durationMs, doneAt: endedAt, doneSeen: false };
    rollSessions(state, today());
    const endDay = day(endedAt);
    const late = at - endedAt > 5000 ? `, noted ${fmtS(at - endedAt)} after its end` : '';
    if (t.kind === 'focus' && endDay === state.sessions.date) {
      state.sessions.focus += 1;
      log(`complete focus ${fmtS(t.durationMs)} (focus sessions today: ${state.sessions.focus})${late}`);
    } else if (t.kind === 'focus') {
      log(`complete focus ${fmtS(t.durationMs)}, ended on ${endDay}: not counted for today${late}`);
    } else {
      log(`complete ${t.kind} ${fmtS(t.durationMs)}${late}`);
    }
    changed();
    return true;
  }

  const iso = (ms) => new Date(ms).toISOString();
  /** One op on the timer; returns whether it changed anything, and leaves `undo` set after a Reset of a started timer. */
  function runOp(op, at) {
    const t = state.timer;
    switch (op.op) {
      case 'start':
        state.timer = { kind: op.kind, durationMs: op.durationMs, remainingMs: op.durationMs, endAt: at + op.durationMs, running: true, doneAt: null, doneSeen: false };
        log(`start ${op.kind} ${fmtS(op.durationMs)}, ends ${iso(at + op.durationMs)}`);
        return true;
      case 'pause':
        if (!t.running) return false;
        state.timer = { ...t, remainingMs: Math.max(0, t.endAt - at), running: false, endAt: null };
        log(`pause ${t.kind} at ${fmtS(state.timer.remainingMs)} left`);
        return true;
      case 'resume':
        if (t.running) return false;
        state.timer = { ...t, endAt: at + Math.max(0, t.remainingMs), running: true, doneAt: null, doneSeen: false };
        log(`resume ${t.kind} at ${fmtS(t.remainingMs)} left, ends ${iso(state.timer.endAt)}`);
        return true;
      case 'reset': {
        const started = t.running || t.remainingMs < t.durationMs;
        const left = t.running ? Math.max(0, t.endAt - at) : t.remainingMs;
        state.timer = { ...t, running: false, remainingMs: t.durationMs, endAt: null, doneAt: null, doneSeen: false };
        log(`reset ${t.kind} to ${fmtS(t.durationMs)}${started ? ` (it was ${t.running ? 'running' : 'paused'} with ${fmtS(left)} left; Undo can bring it back for ${fmtS(UNDO_MS)})` : ''}`);
        undo = started ? { timer: { ...t }, at } : null;
        return true;
      }
      case 'set':
        state.timer = { kind: op.kind, durationMs: op.durationMs, remainingMs: op.durationMs, endAt: null, running: false, doneAt: null, doneSeen: false };
        log(`set ${op.kind} to ${fmtS(op.durationMs)}`);
        return true;
      case 'complete':
        return completeDue(at, DUE_SLACK_MS);
      case 'seen':
        if (t.running || t.doneAt === null || t.doneSeen) return false;
        state.timer = { ...t, doneSeen: true };
        log(`seen: the end of ${t.kind} at ${iso(t.doneAt)}`);
        return true;
      case 'undo': {
        const back = undo.timer; // canUndo was checked before anything changed
        undo = null;
        state.timer = { ...back };
        log(back.running ? `undo reset: ${back.kind} running again, ends ${iso(back.endAt)}` : `undo reset: ${back.kind} paused again at ${fmtS(back.remainingMs)} left`);
        return true;
      }
      default:
        return false;
    }
  }

  /** What GET answers: the state, its revision, and what is wrong in words. */
  function view() {
    completeDue(now());
    const before = state.sessions;
    rollSessions(state, today());
    if (state.sessions !== before) {
      log(`day rolled over to ${state.sessions.date}; focus count reset`);
      changed();
    }
    const problems = storeProblem ? [...configProblems, storeProblem] : [...configProblems];
    return { settings: { ...state.settings }, timer: { ...state.timer }, sessions: { ...state.sessions }, rev: state.rev, problems };
  }

  const json = (v, status = 200, headers = {}) => Response.json(v, { status, headers: { 'cache-control': 'no-store', ...headers } });

  async function post(req) {
    let body;
    try { body = JSON.parse(await req.text()); } catch { throw new Refusal(400, 'The request body must be valid JSON.'); }
    if (!isRecord(body)) throw new Refusal(400, 'The request body must be a JSON object, such as {"op": {"op": "pause"}}.');
    // Everything is checked before anything changes, so a refusal never leaves half a request behind.
    const patch = body.settings != null ? validateSettings(body.settings) : null;
    const op = body.op != null ? validateOp(body.op) : null;
    completeDue(now());
    if (op && RUNNING[op.op] && state.timer.running) throw new Refusal(409, RUNNING[op.op]);
    if (op?.op === 'undo' && !canUndo(now())) throw new Refusal(409, NO_UNDO);
    let did = false;
    if (patch) {
      const entries = Object.entries(patch).filter(([k, v]) => state.settings[k] !== v);
      if (entries.length) {
        Object.assign(state.settings, patch);
        log(`settings: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
        did = true;
      }
    }
    const ran = op ? runOp(op, now()) : false;
    // complete ends the timer itself (completeDue saves); everything else is saved here, once.
    if (did || (ran && op.op !== 'complete')) changed();
    // An Undo is good for the revision this Reset made, and no other.
    if (undo && op?.op === 'reset') undo.rev = state.rev;
    return json({ ok: true, changed: did || ran, ...view() });
  }

  /** The route: GET and POST /api/focus/state. Every error is an answer, never a throw into DSH. */
  async function handle(req) {
    try {
      if (req.method === 'GET') return json(view());
      if (req.method === 'POST') return await post(req);
      return json({ error: 'Use GET or POST here.' }, 405, { allow: 'GET, POST' });
    } catch (e) {
      if (e instanceof Refusal) return json({ error: e.message }, e.status);
      log(`route state failed: ${errorText(e)}`);
      return json({ error: `Focus could not do that: ${errorText(e)}` }, 500);
    }
  }

  // A timer that ended while DSH was closed ends now, as of its endAt; one still running is armed.
  if (firstStart) { save(); log(`first start: default state written to ${statePath}`); }
  else if (saved && isRecord(saved) && saved.sessions?.date !== state.sessions.date) { log(`day rolled over from ${saved.sessions?.date}; focus count reset`); save(); }
  if (!completeDue(now())) arm();

  return {
    handle,
    log,
    view,
    completeDue,
    stop() { stopped = true; if (timer) { clearTimer(timer); timer = null; } },
    get state() { return state; },
    get armed() { return timer !== null; },
    dataDir,
  };
}

export async function apply(ctx, rawConfig) {
  const { dataDir, problems, fallback } = checkConfig(rawConfig);
  const say = (level, text) => { try { ctx.logger?.[level]?.('focus: %s', text); } catch {} };
  for (const p of problems) say('warn', p);
  // The window's words name no folder; the logs do.
  if (problems.length) say('info', `its folder: ${dataDir}`);
  const focus = createFocus({ dataDir, problems, say, folder: dataDir === fallback ? FOLDER_DEFAULT : FOLDER_SET });
  if (typeof ctx.effect === 'function') ctx.effect(() => () => focus.stop(), 'focus: timer');
  ctx.inject(['connection'], (c) => {
    try {
      const connection = c.get?.('connection') ?? c.connection;
      if (typeof connection?.fetch?.register !== 'function') {
        focus.log('connection.fetch.register missing');
        say('warn', 'DSH has no connection.fetch.register; the timer is not served');
        return;
      }
      // PUT, PATCH and DELETE are routed here too, so they get the 405 with Allow below; DSH itself
      // answers 404 for a method a route does not name.
      c.effect(() => connection.fetch.register({
        path: '/api/focus/state',
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        requestBody: 'buffered',
        fetch: (req) => focus.handle(req),
      }), 'focus: state');
      focus.log(`started; serving /api/focus/state (GET, POST) from ${dataDir}`);
    } catch (e) {
      focus.log(`route registration failed: ${errorText(e)}`);
      say('warn', `route registration failed: ${errorText(e)}`);
    }
  });
}
