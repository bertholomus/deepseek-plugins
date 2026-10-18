// Wallpaper and glass — host side.
// Keeps the look's settings and the wallpaper library, and serves both to the client bundle on /api/wallpaper/*.
// Everything lives in this plugin's own folder (<DSH home>/wallpaper).

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync, renameSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, basename } from 'node:path';

export const name = 'wallpaper';
export const inject = [];

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh');
const DEFAULTS = {
  dataDir: join(DSH_HOME, 'wallpaper'), // state.json, wp-cache/, wallpaper.log
  wallpaperDir: null, // one folder per collection; null = <dataDir>/wallpapers. Nothing else is ever shown as wallpaper.
};
const PREF_DEFAULTS = {
  headline: '',
  wallpaperCollection: null, wallpaperPinned: null, wallpaperRotate: null, wallpaperRotateMin: 60,
  wallpaperOpacity: 90, wallpaperFrost: 4, glassBlur: 22, glassTint: 55, motion: true,
};
// The only settings this plugin keeps. Anything else sent to /state is ignored.
const PREF_KEYS = [...Object.keys(PREF_DEFAULTS), 'wallpaperKind', 'wallpaperColour', 'wallpaperColours', 'wallpaperGradient'];
const IMG = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

const expand = (p) => (typeof p === 'string' && p.startsWith('~/') ? homedir() + p.slice(1) : p);
const now = () => new Date().toISOString();
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));

export async function apply(ctx, rawConfig) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) };
  const dataDir = expand(config.dataDir);
  const wpDir = expand(config.wallpaperDir || join(dataDir, 'wallpapers'));
  mkdirSync(join(dataDir, 'wp-cache'), { recursive: true });
  const logFile = join(dataDir, 'wallpaper.log');
  const log = (msg) => { try { appendFileSync(logFile, `${now()} ${msg}\n`); } catch {} };
  const readJson = (p, fallback) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; } };
  const writeJson = (p, v) => { const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(v, null, 1)); renameSync(tmp, p); };

  // ---------------------------------------------------------------- settings
  const statePath = join(dataDir, 'state.json');
  const firstStart = !existsSync(statePath);
  let state = { prefs: { ...PREF_DEFAULTS }, ...readJson(statePath, {}) };
  state.prefs = { ...PREF_DEFAULTS, ...pick(state.prefs, PREF_KEYS) };
  const saveState = () => writeJson(statePath, state);
  mkdirSync(wpDir, { recursive: true });
  if (firstStart) saveState();

  // ---------------------------------------------------------------- wallpaper library
  // Collections are the folders in wpDir. Nothing else counts, so screenshots and other image folders are never
  // wallpaper. Removing a picture moves it to the macOS Trash.
  const SAFE_NAME = /^[\w][\w .,'()+&-]{0,79}$/;
  const safeName = (n) => typeof n === 'string' && SAFE_NAME.test(n.trim()) && !n.includes('..') && n.trim() === n;
  const wallpapers = () => {
    const out = {};
    try {
      for (const c of readdirSync(wpDir)) {
        const dir = join(wpDir, c);
        try { if (c.startsWith('.') || !statSync(dir).isDirectory()) continue; } catch { continue; }
        out[c] = readdirSync(dir).filter((f) => !f.startsWith('.') && IMG.has(extname(f).toLowerCase())).sort();
      }
    } catch {}
    return out;
  };
  // Pictures are served at 2880 px on the long edge as JPEG, made once with sips and cached in wp-cache/.
  const wallpaperFile = (collection, file) => new Promise((resolve) => {
    const all = wallpapers();
    if (!all[collection]?.includes(file)) return resolve(null);
    const src = join(wpDir, collection, file);
    const out = join(dataDir, 'wp-cache', `${collection}--${file.replace(/\.[^.]+$/, '')}.jpg`);
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) return resolve(out);
    execFile('/usr/bin/sips', ['-Z', '2880', '-s', 'format', 'jpeg', '-s', 'formatOptions', '82', src, '--out', out], { timeout: 30000 }, (err) => resolve(err ? src : out));
  });
  const uniqueIn = (dir, name) => {
    const ext = extname(name); const stem = name.slice(0, name.length - ext.length);
    let n = name; let i = 2;
    while (existsSync(join(dir, n))) n = `${stem} ${i++}${ext}`;
    return n;
  };
  const wallpaperAdd = ({ collection, name, data }) => {
    if (!safeName(collection) || !existsSync(join(wpDir, collection))) return { error: 'pick a collection first' };
    const base = basename(String(name ?? '')).replace(/[^\w .,'()+&-]/g, '-').slice(0, 120);
    if (!IMG.has(extname(base).toLowerCase()) || !safeName(base.replace(/\.[^.]+$/, ''))) return { error: `${name} is not a JPEG, PNG, WebP or HEIC image` };
    const m = String(data ?? '').match(/^data:image\/[\w.+-]+;base64,(.+)$/);
    if (!m) return { error: 'no image data' };
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > 60 * 1024 * 1024) return { error: `${name} is larger than 60 MB` };
    const file = uniqueIn(join(wpDir, collection), base);
    writeFileSync(join(wpDir, collection, file), buf);
    log(`wallpaper added: ${collection}/${file} (${Math.round(buf.length / 1024)} KB)`);
    return { ok: true, collection, file };
  };
  const wallpaperRemove = ({ collection, file }) => {
    if (!safeName(collection) || typeof file !== 'string' || !wallpapers()[collection]?.includes(file)) return { error: 'no such wallpaper' };
    const trash = join(homedir(), '.Trash');
    mkdirSync(trash, { recursive: true });
    const dest = uniqueIn(trash, file);
    renameSync(join(wpDir, collection, file), join(trash, dest));
    if (state.prefs.wallpaperPinned === file) { state.prefs.wallpaperPinned = null; saveState(); }
    log(`wallpaper moved to the Trash: ${collection}/${file} -> ~/.Trash/${dest}`);
    return { ok: true, trashed: dest };
  };
  const collectionCreate = ({ name }) => {
    const n = String(name ?? '').trim();
    if (!safeName(n)) return { error: 'use letters, numbers, spaces and - _ . , ( ) + &' };
    if (existsSync(join(wpDir, n))) return { error: `${n} already exists` };
    mkdirSync(join(wpDir, n));
    log(`wallpaper collection created: ${n}`);
    return { ok: true, name: n };
  };
  const collectionRename = ({ from, to }) => {
    const t = String(to ?? '').trim();
    if (!safeName(from) || !existsSync(join(wpDir, from))) return { error: 'no such collection' };
    if (!safeName(t)) return { error: 'use letters, numbers, spaces and - _ . , ( ) + &' };
    if (t === from) return { ok: true, name: t };
    if (existsSync(join(wpDir, t))) return { error: `${t} already exists` };
    renameSync(join(wpDir, from), join(wpDir, t));
    if (state.prefs.wallpaperCollection === from) { state.prefs.wallpaperCollection = t; saveState(); }
    log(`wallpaper collection renamed: ${from} -> ${t}`);
    return { ok: true, name: t };
  };

  // ---------------------------------------------------------------- routes
  const tilde = (p) => (p.startsWith(homedir() + '/') ? '~' + p.slice(homedir().length) : p);
  const json = (v, status = 200) => Response.json(v, { status, headers: { 'cache-control': 'no-store' } });
  const body = async (req) => { try { return await req.json(); } catch { return {}; } };
  const view = () => ({ prefs: state.prefs, wallpapers: wallpapers(), wallpaperDir: tilde(wpDir) });
  const routes = [
    ['GET', 'state', () => json(view())],
    ['POST', 'state', async (req) => {
      const patch = await body(req);
      if (patch.prefs && typeof patch.prefs === 'object') state.prefs = { ...state.prefs, ...pick(patch.prefs, PREF_KEYS) };
      saveState();
      return json({ ok: true, ...view() });
    }],
    ['POST', 'wallpaper-add', async (req) => { const r = wallpaperAdd(await body(req)); return json(r, r.error ? 400 : 200); }],
    ['POST', 'wallpaper-remove', async (req) => { const r = wallpaperRemove(await body(req)); return json(r, r.error ? 400 : 200); }],
    ['POST', 'collection-create', async (req) => { const r = collectionCreate(await body(req)); return json(r, r.error ? 400 : 200); }],
    ['POST', 'collection-rename', async (req) => { const r = collectionRename(await body(req)); return json(r, r.error ? 400 : 200); }],
    ['GET', 'wallpaper', async (req) => {
      const u = new URL(req.url);
      const path = await wallpaperFile(u.searchParams.get('c') || '', u.searchParams.get('f') || '');
      if (!path) return new Response('not found', { status: 404 });
      return new Response(readFileSync(path), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' } });
    }],
  ];
  // One exact route per path (the registry is keyed by path); dispatch on method.
  const byPath = new Map();
  for (const [method, path, handler] of routes) {
    const entry = byPath.get(path) ?? {};
    entry[method] = handler;
    byPath.set(path, entry);
  }
  ctx.inject(['connection'], (c) => {
    try {
      const connection = c.get?.('connection') ?? c.connection;
      if (typeof connection?.fetch?.register !== 'function') { log('connection.fetch.register missing'); return; }
      for (const [path, handlers] of byPath) {
        c.effect(() => connection.fetch.register({
          path: `/api/wallpaper/${path}`, methods: Object.keys(handlers), requestBody: 'buffered',
          fetch: async (req) => {
            const handler = handlers[req.method];
            if (!handler) return new Response('method not allowed', { status: 405 });
            try { return await handler(req); } catch (e) { log(`route ${path} failed: ${e?.stack ?? e}`); return json({ error: String(e?.message ?? e) }, 500); }
          },
        }), `wallpaper: ${path}`);
      }
      log(`started; ${byPath.size} routes; library ${tilde(wpDir)}`);
    } catch (e) { log(`route registration failed: ${e?.stack ?? e}`); }
  });
}
