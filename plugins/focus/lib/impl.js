// Focus — host side.
// Keeps the pomodoro settings, the countdown timer and the daily session count in this plugin's
// own folder (<DSH home>/focus: state.json, focus.log) and serves them on /api/focus/state.
// The countdown is stored as an absolute endAt so it stays correct across page reloads and DSH
// restarts; the client ticks locally and only POSTs op:'complete' when it reaches zero.

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const name = 'focus';
export const inject = [];

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DEFAULTS = {
  dataDir: join(DSH_HOME, 'focus'), // state.json, focus.log
};
const SETTINGS_DEFAULTS = { focusMin: 25, shortMin: 5, longMin: 15, chime: true };
const MINUTE_KEYS = ['focusMin', 'shortMin', 'longMin'];
const KINDS = ['focus', 'short', 'long', 'custom'];
const OPS = ['start', 'pause', 'resume', 'reset', 'set', 'complete'];
const FOCUS_DEFAULT_MS = 25 * 60_000;
const DURATION_MIN_MS = 10_000;
const DURATION_MAX_MS = 10_800_000; // 3 h
const MINUTES_MIN = 1;
const MINUTES_MAX = 180;

const expand = (p) => (typeof p === 'string' && p.startsWith('~/') ? homedir() + p.slice(1) : p);
const now = () => new Date().toISOString();
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const fmtS = (ms) => `${Math.round(ms / 1000)}s`;

// Remaining time for the canonical timer shape. While running, endAt is authoritative
// (remainingMs is only a stale cache); while idle, remainingMs is. Exported for the offline test;
// the client mirrors this logic in its local tick.
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

export async function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  const dataDir = expand(config.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const logFile = join(dataDir, 'focus.log');
  const log = (msg) => { try { appendFileSync(logFile, `${now()} ${msg}\n`); } catch {} };
  const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
  const writeJson = (p, v) => { const tmp = `${p}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 1)); renameSync(tmp, p); };

  // ---------------------------------------------------------------- state
  const statePath = join(dataDir, 'state.json');
  const firstStart = !existsSync(statePath);
  const state = {
    settings: { ...SETTINGS_DEFAULTS },
    timer: { kind: 'focus', durationMs: FOCUS_DEFAULT_MS, remainingMs: FOCUS_DEFAULT_MS, endAt: null, running: false, doneAt: null },
    sessions: { date: localDay(), focus: 0 },
  };
  const saved = readJson(statePath, null);
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    if (saved.settings && typeof saved.settings === 'object' && !Array.isArray(saved.settings)) Object.assign(state.settings, saved.settings);
    if (saved.timer && typeof saved.timer === 'object' && !Array.isArray(saved.timer)) Object.assign(state.timer, saved.timer);
    if (saved.sessions && typeof saved.sessions === 'object' && !Array.isArray(saved.sessions)) Object.assign(state.sessions, saved.sessions);
  }
  // Back to the canonical shape: only known settings keys, minutes 1–180, typed timer fields.
  const s = state.settings;
  state.settings = {
    focusMin: isNum(s.focusMin) ? clamp(s.focusMin, MINUTES_MIN, MINUTES_MAX) : SETTINGS_DEFAULTS.focusMin,
    shortMin: isNum(s.shortMin) ? clamp(s.shortMin, MINUTES_MIN, MINUTES_MAX) : SETTINGS_DEFAULTS.shortMin,
    longMin: isNum(s.longMin) ? clamp(s.longMin, MINUTES_MIN, MINUTES_MAX) : SETTINGS_DEFAULTS.longMin,
    chime: typeof s.chime === 'boolean' ? s.chime : SETTINGS_DEFAULTS.chime,
  };
  const t = state.timer;
  state.timer = {
    kind: KINDS.includes(t.kind) ? t.kind : 'focus',
    durationMs: isNum(t.durationMs) ? clamp(t.durationMs, DURATION_MIN_MS, DURATION_MAX_MS) : FOCUS_DEFAULT_MS,
    remainingMs: isNum(t.remainingMs) ? clamp(t.remainingMs, 0, DURATION_MAX_MS) : FOCUS_DEFAULT_MS,
    endAt: isNum(t.endAt) ? t.endAt : null,
    running: t.running === true,
    doneAt: isNum(t.doneAt) ? t.doneAt : null,
  };
  if (state.timer.running && state.timer.endAt === null) state.timer.running = false; // without its endAt a running timer is unusable
  if (!state.timer.running) state.timer.endAt = null; // idle → remainingMs is the authority

  const rolledFrom = state.sessions.date;
  rollSessions(state, localDay());
  const saveState = () => writeJson(statePath, state);
  if (firstStart) { saveState(); log(`first start: default state written to ${statePath}`); }
  else if (state.sessions.date !== rolledFrom) { saveState(); log(`day rolled over from ${rolledFrom}; focus count reset`); }

  // ---------------------------------------------------------------- ops
  // Each validator returns [error, normalized]; the request mutates nothing unless every part is
  // valid, so a 400 never leaves half a patch behind.
  const validateSettings = (patch) => {
    const out = {};
    for (const k of MINUTE_KEYS) {
      if (k in patch) {
        if (!isNum(patch[k])) return [`settings.${k} must be a number of minutes`];
        out[k] = clamp(patch[k], MINUTES_MIN, MINUTES_MAX);
      }
    }
    if ('chime' in patch) {
      if (typeof patch.chime !== 'boolean') return ['settings.chime must be true or false'];
      out.chime = patch.chime;
    }
    return [null, out];
  };

  const validateOp = (op) => {
    if (!op || typeof op !== 'object' || Array.isArray(op)) return ['op must be an object like { op: "start", kind, durationMs }'];
    if (!OPS.includes(op.op)) return [`unknown op: ${JSON.stringify(op.op ?? null)}`];
    if (op.op === 'start' || op.op === 'set') {
      if (!KINDS.includes(op.kind)) return [`kind must be one of: ${KINDS.join(', ')}`];
      if (!isNum(op.durationMs)) return ['durationMs must be a number of milliseconds'];
      return [null, { op: op.op, kind: op.kind, durationMs: clamp(op.durationMs, DURATION_MIN_MS, DURATION_MAX_MS) }];
    }
    return [null, { op: op.op }];
  };

  const runOp = (op, at) => {
    switch (op.op) {
      case 'start': {
        state.timer = { kind: op.kind, durationMs: op.durationMs, remainingMs: op.durationMs, endAt: at + op.durationMs, running: true, doneAt: null };
        log(`start ${op.kind} ${fmtS(op.durationMs)}, ends ${new Date(at + op.durationMs).toISOString()}`);
        return;
      }
      case 'pause': {
        if (!state.timer.running) return; // idle pause would do null math on endAt; keep the state
        state.timer.remainingMs = Math.max(0, state.timer.endAt - at);
        state.timer.running = false;
        state.timer.endAt = null;
        log(`pause ${state.timer.kind} at ${fmtS(state.timer.remainingMs)} left`);
        return;
      }
      case 'resume': {
        if (state.timer.running) return; // endAt is authoritative while running; re-deriving from the stale remainingMs cache would corrupt it
        state.timer.endAt = at + Math.max(0, state.timer.remainingMs);
        state.timer.running = true;
        log(`resume ${state.timer.kind} at ${fmtS(state.timer.remainingMs)} left`);
        return;
      }
      case 'reset': {
        state.timer.running = false;
        state.timer.remainingMs = state.timer.durationMs;
        state.timer.endAt = null;
        state.timer.doneAt = null;
        log(`reset ${state.timer.kind} to ${fmtS(state.timer.durationMs)}`);
        return;
      }
      case 'set': {
        state.timer = { kind: op.kind, durationMs: op.durationMs, remainingMs: op.durationMs, endAt: null, running: false, doneAt: null };
        log(`set ${op.kind} to ${fmtS(op.durationMs)}`);
        return;
      }
      case 'complete': {
        const { kind } = state.timer;
        state.timer.running = false;
        state.timer.endAt = null;
        state.timer.remainingMs = state.timer.durationMs;
        state.timer.doneAt = at;
        if (kind === 'focus') {
          rollSessions(state, localDay()); // land the increment in today's bucket
          state.sessions.focus += 1;
          log(`complete focus (focus sessions today: ${state.sessions.focus})`);
        } else {
          log(`complete ${kind}`);
        }
        return;
      }
    }
  };

  // ---------------------------------------------------------------- routes
  const json = (v, status = 200) => Response.json(v, { status, headers: { 'cache-control': 'no-store' } });
  const stateView = () => {
    const before = state.sessions;
    const sessions = rollSessions(state, localDay());
    if (sessions !== before) { saveState(); log(`day rolled over to ${sessions.date}; focus count reset`); }
    return { settings: state.settings, timer: state.timer, sessions };
  };
  const postState = async (req) => {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'request body must be valid JSON' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'request body must be a JSON object' }, 400);
    let settingsPatch = null; let op = null;
    if (body.settings != null) {
      if (typeof body.settings !== 'object' || Array.isArray(body.settings)) return json({ error: 'settings must be a JSON object' }, 400);
      const [err, patch] = validateSettings(body.settings);
      if (err) return json({ error: err }, 400);
      settingsPatch = patch;
    }
    if (body.op != null) {
      const [err, value] = validateOp(body.op);
      if (err) return json({ error: err }, 400);
      op = value;
    }
    // Everything validated — mutate once, then persist.
    if (settingsPatch) {
      const entries = Object.entries(settingsPatch);
      if (entries.length) {
        Object.assign(state.settings, settingsPatch);
        log(`settings: ${entries.map(([k, v]) => `${k}=${v}`).join(', ')}`);
      }
    }
    if (op) runOp(op, Date.now());
    saveState();
    return json({ ok: true, ...stateView() });
  };

  ctx.inject(['connection'], (c) => {
    try {
      const connection = c.get?.('connection') ?? c.connection;
      if (typeof connection?.fetch?.register !== 'function') { log('connection.fetch.register missing'); return; }
      c.effect(() => connection.fetch.register({
        path: '/api/focus/state',
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (req) => {
          try {
            if (req.method === 'GET') return json(stateView());
            if (req.method === 'POST') return await postState(req);
            return new Response('method not allowed', { status: 405 });
          } catch (e) {
            log(`route state failed: ${e?.stack ?? e}`);
            return json({ error: String(e?.message ?? e) }, 500);
          }
        },
      }), 'focus: state');
      log('started; serving /api/focus/state (GET, POST)');
    } catch (e) { log(`route registration failed: ${e?.stack ?? e}`); }
  });
}
