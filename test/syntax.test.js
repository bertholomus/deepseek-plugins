import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

for (const f of ['plugins/dsh-site/lib/index.js', 'plugins/dsh-site/lib/cidr.js', 'plugins/session-bridge/lib/index.js', ...['index','client','router','store','llm','titles','split','tools','trace'].map((n) => `plugins/discord/lib/${n}.js`), ...['index','projects','store','settings','prompts','tools'].map((n) => `plugins/projects/lib/${n}.js`)]) {
    test(`syntax ${f}`, () => {
        assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f]));
    });
}
