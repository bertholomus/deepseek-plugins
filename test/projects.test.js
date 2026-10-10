import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSettings, applyRoute, checkSelection } from '../plugins/projects/lib/settings.js';
import { handbackMessage, idleMessage, rosterLines, memoryExcerpt } from '../plugins/projects/lib/prompts.js';
import { ensurePrivateDir } from '../plugins/projects/lib/store.js';
import { mkdtempSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Full end-to-end coverage lives in plugins/projects/test/smoke.mjs (needs the DSH peers).

test('projects: settings layers', () => {
    const s = effectiveSettings({ threadEffort: 'low' }, { threadEffort: 'high' }, {});
    assert.deepEqual(s.threadEffort, { value: 'high', source: 'project config' });
    assert.equal(s.threadModel.source, 'DSH default');
});

test('projects: route override keeps the model when unset; a new model gets its default effort', () => {
    const base = { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' };
    assert.deepEqual(applyRoute(base, undefined, 'max'), { ...base, reasoningEffort: 'max' });
    assert.deepEqual(applyRoute(base, 'other:m', undefined), { provider: 'other', model: 'm' });
});

test('projects: a model without effort levels drops the effort with a note', () => {
    const catalog = { default: { provider: 'p', model: 'a' }, groups: [{ id: 'p', models: [{ id: 'a', reasoning: { efforts: [{ id: 'max' }] } }, { id: 'b' }] }] };
    assert.deepEqual(checkSelection(catalog, 'b', 'max'), { ok: true, model: 'p:b', note: 'p:b has no effort levels, so effort "max" is not used' });
    assert.deepEqual(checkSelection(catalog, undefined, 'max'), { ok: true, effort: 'max' });
    // An effort no model offers is still refused, even where it would not be used.
    assert.deepEqual(checkSelection(catalog, 'b', 'ultra'), { ok: false, error: 'effort "ultra" is not offered by any model. Efforts in this DSH: max' });
});

test('projects: no catalog accepts the selection as given', () => {
    assert.deepEqual(checkSelection(undefined, 'p:m', 'max'), { ok: true, model: 'p:m', effort: 'max' });
});

test('projects: message framing', () => {
    assert.match(handbackMessage('t2', 'Fix CI', 'blocked', 'Needs a token.'), /^\[Handback from thread t2 · "Fix CI" · status: blocked\]\n\nNeeds a token\./);
    assert.match(idleMessage('t2', 'Fix CI', ''), /It produced no reply text\./);
    assert.deepEqual(rosterLines({}, () => 'idle'), ['(no threads yet)']);
    assert.match(rosterLines({ t1: { title: 'A', sessionId: 's', resolved: true } }, () => 'idle')[0], /t1 · "A" · resolved · no handback yet/);
});

test('projects: a long memory shows its start and its newest lines', () => {
    const memory = ['# Summary', ...Array.from({ length: 400 }, (_, i) => `- fact ${i}`)].join('\n');
    const excerpt = memoryExcerpt(memory);
    assert.ok(excerpt.startsWith('# Summary\n- fact 0\n'));
    assert.ok(excerpt.endsWith('\n- fact 399'));
    assert.match(excerpt, /\n\[… \d+ characters left out; project_memory read shows all …\]\n- fact \d+\n/);
    assert.ok(excerpt.length < 4100, `${excerpt.length}`);
    assert.equal(memoryExcerpt('short'), 'short');
});

test('projects: private folders are 700 even under a narrowed umask, and an unusable one is repaired', { skip: process.platform === 'win32' }, () => {
    const root = mkdtempSync(join(tmpdir(), 'projects-dir-'));
    const mode = (p) => statSync(p).mode & 0o777;
    const old = process.umask(0o177);
    try {
        ensurePrivateDir(join(root, 'a', 'b'));
    } finally {
        process.umask(old);
    }
    assert.equal(mode(join(root, 'a')), 0o700);
    assert.equal(mode(join(root, 'a', 'b')), 0o700);
    mkdirSync(join(root, 'broken'), { mode: 0o600 });
    ensurePrivateDir(join(root, 'broken'));
    assert.equal(mode(join(root, 'broken')), 0o700);
    mkdirSync(join(root, 'shared'), { mode: 0o755 });
    ensurePrivateDir(join(root, 'shared'));
    assert.equal(mode(join(root, 'shared')), 0o755, 'a usable folder keeps its mode');
});

test('projects: DSH lists the plugin as "Projects", with one plain sentence and its icon', () => {
    const dir = new URL('../plugins/projects/', import.meta.url);
    const pkg = JSON.parse(readFileSync(new URL('package.json', dir), 'utf8'));
    const meta = JSON.parse(readFileSync(new URL('locale/en.json', dir), 'utf8')).meta;
    assert.equal(meta.title, 'Projects');
    assert.match(meta.description, /^[^.\n]+\.$/);
    assert.doesNotMatch(`${meta.description} ${pkg.description}`, /Claude/);
    // DSH reads both through the package's exports, and the icon as a file in the package (at most 256 KiB).
    assert.equal(pkg.exports['./locale/*.json'], './locale/*.json');
    assert.equal(pkg.exports['./package.json'], './package.json');
    assert.ok(pkg.files.includes('locale') && pkg.files.includes(pkg.icon.replace(/^\.\//, '')));
    const icon = readFileSync(new URL(pkg.icon, dir), 'utf8');
    assert.match(icon, /^<svg [^>]*viewBox="0 0 36 36"/);
    assert.ok(Buffer.byteLength(icon) < 256 * 1024);
});
