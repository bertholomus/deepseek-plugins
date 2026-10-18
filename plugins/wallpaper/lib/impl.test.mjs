// Offline test of the Wallpaper host: the settings it keeps, its defaults, and the library routes. Runs in a
// temporary home, so nothing real is read or written: node plugins/wallpaper/lib/impl.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'wallpaper-test-'));
process.env.HOME = home;
process.env.DSH_HOME = join(home, '.dsh');

const routes = {};
const ctx = {
  inject: (_deps, fn) => fn({ connection: { fetch: { register: (def) => { routes[def.path] = def; return () => {}; } } }, effect: (f) => f() }),
  effect: (f) => f(),
};
const { apply } = await import('./impl.js');
await apply(ctx, {});
const call = async (method, path, body) => {
  const r = routes[`/api/wallpaper/${path}`];
  assert.ok(r, `route ${path} registered`);
  const url = `http://x/api/wallpaper/${path}`;
  const res = await r.fetch(new Request(url, method === 'GET' ? {} : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
  return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
};

// Defaults: no headline (DSH's own shows), no collection picked, and nothing but the plugin's own folder.
let r = await call('GET', 'state');
assert.equal(r.json.prefs.headline, '', 'headline defaults to empty');
assert.equal(r.json.prefs.wallpaperCollection, null, 'no collection is picked by default');
assert.deepEqual(r.json.wallpapers, {}, 'no collections exist on a fresh start');
assert.deepEqual(readdirSync(join(home, '.dsh')).filter((n) => !n.startsWith('.')), ['wallpaper'], 'only the wallpaper folder appears in the DSH home');

// POST state keeps only Wallpaper settings.
r = await call('POST', 'state', { prefs: { glassTint: 70, projectsSidebar: false }, projects: [] });
assert.equal(r.json.prefs.glassTint, 70);
assert.ok(!('projectsSidebar' in r.json.prefs));
assert.ok(!('projects' in JSON.parse(readFileSync(join(home, '.dsh', 'wallpaper', 'state.json'), 'utf8'))));

// Library: make and rename a collection, add a picture, move it to the Trash.
assert.equal((await call('POST', 'collection-create', { name: '../evil' })).status, 400);
assert.equal((await call('POST', 'collection-create', { name: 'Space' })).json.name, 'Space');
assert.equal((await call('POST', 'collection-rename', { from: 'Space', to: 'Stars' })).json.name, 'Stars');
const png = 'data:image/png;base64,' + Buffer.from('png bytes').toString('base64');
assert.equal((await call('POST', 'wallpaper-add', { collection: 'Stars', name: 'nebula.png', data: png })).json.file, 'nebula.png');
assert.equal((await call('POST', 'wallpaper-add', { collection: 'Stars', name: 'evil.sh', data: png })).status, 400);
assert.equal((await call('POST', 'wallpaper-remove', { collection: 'Stars', file: 'nebula.png' })).json.trashed, 'nebula.png');
assert.ok(existsSync(join(home, '.Trash', 'nebula.png')), 'removed picture is in the Trash');

// A second start keeps the saved state and invents nothing.
await apply(ctx, {});
r = await call('GET', 'state');
assert.equal(r.json.prefs.glassTint, 70, 'saved settings survive a restart');
assert.deepEqual(r.json.wallpapers, { Stars: [] });
console.log('wallpaper host: all checks passed');
