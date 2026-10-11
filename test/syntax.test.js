import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

for (const f of ['plugins/dsh-site/lib/index.js', 'plugins/dsh-site/lib/cidr.js', 'plugins/session-bridge/lib/index.js', ...['index','client','router','store','llm','titles','split','tools','trace'].map((n) => `plugins/discord/lib/${n}.js`), ...['index','projects','store','settings','prompts','tools'].map((n) => `plugins/coordinator/lib/${n}.js`), ...['index','categories','store','plan','remote','client'].map((n) => `plugins/categories/lib/${n}.js`), ...['index','manager','store','model','zones','http','recur','ical','expand','oauth','remote','tools','args','policy','client','sources/index','sources/local','sources/subscription','sources/caldav','sources/google','sources/microsoft'].map((n) => `plugins/calendar/lib/${n}.js`)]) {
    test(`syntax ${f}`, () => {
        assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', f]));
    });
}
