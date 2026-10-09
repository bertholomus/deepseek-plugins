import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveSettings, applyRoute, checkSelection } from '../plugins/projects/lib/settings.js';
import { handbackMessage, idleMessage, rosterLines } from '../plugins/projects/lib/prompts.js';

// Full end-to-end coverage lives in plugins/projects/test/smoke.mjs (needs the DSH peers).

test('projects: settings layers', () => {
    const s = effectiveSettings({ threadEffort: 'low' }, { threadEffort: 'high' }, {});
    assert.deepEqual(s.threadEffort, { value: 'high', source: 'project config' });
    assert.equal(s.threadModel.source, 'DSH default');
});

test('projects: route override keeps unset parts', () => {
    const base = { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' };
    assert.deepEqual(applyRoute(base, undefined, 'max'), { ...base, reasoningEffort: 'max' });
    assert.deepEqual(applyRoute(base, 'other:m', undefined), { ...base, provider: 'other', model: 'm' });
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
