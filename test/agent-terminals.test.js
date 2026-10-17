// Agent Terminals (plugins/agent-terminals): its launch rules, its transcript readers and status, its typist, the
// stand-in coding agent it is tested with, and its engine end to end over a stand-in DSH terminal controller whose
// "shell" really starts the stand-in agent. index.js, remote.js and the browser half run in real DSH
// (scripts/e2e.mjs agent-terminals).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    STYLES, argvOf, dataFolder, eventsMeta, findNewTranscript, findTranscriptById, folderKey, launchLine, pickShell, programName, shellWord, transcriptPath,
} from '../plugins/agent-terminals/lib/launch.js';
import { Tail, callSummary, emptyFold, entriesOf, foldEntry, parseLines, provenIn, statusOf } from '../plugins/agent-terminals/lib/transcripts.js';
import { PASTE_END, PASTE_START, Typist, messageKeys, pasteSwitch } from '../plugins/agent-terminals/lib/typist.js';
import { AgentTerminals, checkLaunch, exitWords, parseData, splitArgs } from '../plugins/agent-terminals/lib/agents.js';
import { DEFAULTS, LIVE_SETTINGS, SETTING_TITLES, changedWords, checkConfig, savedEntry } from '../plugins/agent-terminals/lib/config.js';
import { detectAgents, keepsProjects, keepsSessions } from '../plugins/agent-terminals/lib/detect.js';
import { STYLE_CHOICES, pageState } from '../plugins/agent-terminals/lib/page.js';
import { JsonStore } from '../plugins/agent-terminals/lib/shared/files.js';
import { Journal } from '../plugins/agent-terminals/lib/shared/journal.js';
import { SettingsCheck } from '../plugins/agent-terminals/lib/shared/settings.js';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'e2e', 'fake-agent.mjs');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = new Set();
after(() => {
    for (const child of children) {
        try { child.kill('SIGKILL'); } catch {}
    }
});

async function until(fn, what, timeout = 15000, every = 50) {
    const started = Date.now();
    let last;
    while (Date.now() - started < timeout) {
        try {
            last = await fn();
            if (last) return last;
        } catch (error) {
            last = error;
        }
        await sleep(every);
    }
    throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

const tmp = (label) => realpathSync(mkdtempSync(join(tmpdir(), `agent-terminals-${label}-`)));

// ── Launch rules ───────────────────────────────────────────────────────

test('launch: each style starts and resumes with its own arguments, in the right place', () => {
    const flags = { program: 'agent', args: ['--model', 'x'], style: 'flags', conversationId: 'c1' };
    assert.deepEqual(argvOf(flags), ['agent', '--model', 'x', '--session-id', 'c1']);
    assert.deepEqual(argvOf(flags, { resume: true }), ['agent', '--model', 'x', '--resume', 'c1']);
    const sub = { program: 'tool', args: ['--full-auto'], style: 'subcommand' };
    assert.deepEqual(argvOf(sub), ['tool', '--full-auto']);
    assert.equal(argvOf(sub, { resume: true }), undefined, 'no id yet: nothing to resume');
    assert.deepEqual(argvOf({ ...sub, conversationId: 'r9' }, { resume: true }), ['tool', 'resume', 'r9', '--full-auto'], 'a subcommand goes first');
    assert.deepEqual(argvOf({ program: 'oc', args: [], style: 'continue' }, { resume: true }), ['oc', '--continue']);
    assert.deepEqual(argvOf({ program: 'oc', args: [], style: 'continue' }), ['oc']);
    assert.equal(argvOf({ program: 'x', style: 'plain' }, { resume: true }), undefined);
    assert.deepEqual(argvOf({ program: 'x', style: 'nonsense' }), ['x'], 'an unknown style runs the program plainly');
    for (const [id, style] of Object.entries(STYLES)) {
        // Named by how the CLI works; the branding scan in coordinator.test.js keeps product names out.
        assert.ok(style.label && style.detail, `${id} is described in words`);
    }
});

test('launch: the command line is quoted for a POSIX shell, and exec replaces the shell', () => {
    assert.equal(shellWord('plain-word_1.2/x:y=z,@%+'), 'plain-word_1.2/x:y=z,@%+');
    assert.equal(shellWord('two words'), '\'two words\'');
    assert.equal(shellWord('it\'s'), '\'it\'\\\'\'s\'');
    assert.equal(shellWord(''), '\'\'');
    assert.equal(shellWord('~/x'), '\'~/x\'', 'a tilde is not expanded behind the person\'s back');
    assert.equal(shellWord('$(rm -rf /)'), '\'$(rm -rf /)\'');
    assert.equal(launchLine(['/usr/bin/agent', '--name', 'a b']), 'exec /usr/bin/agent --name \'a b\'');
    assert.deepEqual(pickShell([{ path: '/bin/fish' }, { path: '/bin/bash' }, { path: '/bin/zsh' }]), { path: '/bin/zsh' }, 'zsh first');
    assert.deepEqual(pickShell([{ path: 'C:/x/pwsh.exe' }, { path: '/usr/bin/bash' }]), { path: '/usr/bin/bash' });
    assert.equal(pickShell([{ path: '/bin/fish' }]), undefined, 'no POSIX shell: nothing to type a command into');
    assert.equal(pickShell(undefined), undefined);
});

test('launch: where a CLI keeps its conversations', () => {
    assert.equal(programName('/usr/local/bin/agent'), 'agent');
    assert.equal(programName(''), 'agent');
    assert.equal(dataFolder({ program: '/opt/bin/tool' }, '/home/me'), '/home/me/.tool');
    assert.equal(dataFolder({ program: 'tool', data: '~/elsewhere' }, '/home/me'), '/home/me/elsewhere');
    assert.equal(folderKey('/Users/me/my app'), '-Users-me-my-app');
    const home = tmp('paths');
    const folder = join(home, 'work');
    mkdirSync(folder);
    const agent = { program: 'agent', style: 'flags', folder, conversationId: 'abc', data: join(home, 'data') };
    assert.equal(transcriptPath(agent, home), join(home, 'data', 'projects', folderKey(folder), 'abc.jsonl'));
    assert.equal(transcriptPath({ ...agent, style: 'plain' }, home), undefined);
    assert.equal(transcriptPath({ ...agent, conversationId: undefined }, home), undefined);
    assert.equal(transcriptPath({ ...agent, style: 'subcommand', transcript: '/x.jsonl' }, home), '/x.jsonl');
});

// ── Transcripts ────────────────────────────────────────────────────────

const at = (s) => new Date(Date.UTC(2026, 9, 17, 3, 0, s)).toISOString();
const msgLine = (type, message, s, extra = {}) => ({ type, message, timestamp: at(s), uuid: `u${s}`, sessionId: 'c1', ...extra });

test('transcripts: a messages-style file reads as user words, calls, results and replies', () => {
    assert.deepEqual(entriesOf('messages', msgLine('user', { role: 'user', content: 'Fix the tests' }, 1)), [{ kind: 'user', at: Date.parse(at(1)), text: 'Fix the tests' }]);
    assert.deepEqual(entriesOf('messages', msgLine('user', { role: 'user', content: '<command-name>/clear</command-name>' }, 1)), [], 'a command echo is not the person\'s words');
    assert.deepEqual(entriesOf('messages', msgLine('user', { role: 'user', content: '<system-reminder>x</system-reminder>' }, 1)), [], 'wrapped context is not the person\'s words');
    assert.deepEqual(entriesOf('messages', msgLine('user', { role: 'user', content: 'hi' }, 1, { isMeta: true })), []);
    assert.deepEqual(entriesOf('messages', msgLine('user', { role: 'user', content: 'hi' }, 1, { isSidechain: true })), [], 'a helper\'s side conversation is not the agent\'s');
    const call = entriesOf('messages', msgLine('assistant', { role: 'assistant', content: [{ type: 'text', text: 'Running them.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }], stop_reason: 'tool_use' }, 2));
    assert.deepEqual(call.map((e) => e.kind), ['call', 'reply']);
    assert.equal(call[0].summary, 'npm test');
    assert.equal(call[1].final, false, 'a reply with a call is not the last word');
    assert.deepEqual(entriesOf('messages', msgLine('user', { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] }, 3)).map((e) => e.kind), ['result']);
    const done = entriesOf('messages', msgLine('assistant', { role: 'assistant', content: [{ type: 'text', text: 'All 12 pass.' }], stop_reason: 'end_turn' }, 4));
    assert.equal(done[0].final, true);
    assert.deepEqual(entriesOf('messages', null), []);
    assert.deepEqual(entriesOf('messages', { type: 'summary', summary: 'x' }), []);
    assert.equal(callSummary('{"command":["bash","-lc","ls -la"]}'), 'ls -la');
    assert.equal(callSummary({ file_path: '/a/b.js' }), '/a/b.js');
    assert.equal(callSummary('not json'), 'not json');
});

test('transcripts: an events-style file reads the same way', () => {
    const ev = (type, payload, s) => ({ timestamp: at(s), type, payload });
    assert.deepEqual(entriesOf('events', ev('session_meta', { id: 'r1', cwd: '/w' }, 0)), [{ kind: 'meta', at: Date.parse(at(0)), id: 'r1', cwd: '/w' }]);
    assert.equal(entriesOf('events', ev('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Go' }] }, 1))[0].text, 'Go');
    assert.deepEqual(entriesOf('events', ev('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>x</environment_context>' }] }, 1)), []);
    assert.equal(entriesOf('events', ev('response_item', { type: 'function_call', name: 'shell', arguments: '{"command":["bash","-lc","make"]}', call_id: 'f1' }, 2))[0].summary, 'make');
    assert.equal(entriesOf('events', ev('response_item', { type: 'function_call_output', call_id: 'f1', output: 'ok' }, 3))[0].kind, 'result');
    assert.equal(entriesOf('events', ev('event_msg', { type: 'task_complete', last_agent_message: 'Built.' }, 4))[0].final, true);
    assert.equal(entriesOf('events', ev('event_msg', { type: 'turn_aborted' }, 4))[0].final, false);
    assert.equal(entriesOf('events', ev('event_msg', { type: 'exec_approval_request', call_id: 'f2', command: ['rm', '-rf', 'build'] }, 5))[0].kind, 'approval');
    assert.deepEqual(entriesOf('events', ev('event_msg', { type: 'token_count' }, 5)), []);
});

test('transcripts: the fold says what the agent does now', () => {
    const now = Date.parse(at(10));
    let fold = emptyFold();
    assert.equal(statusOf(fold, { now }).status, 'starting');
    assert.equal(statusOf(fold, { now, exited: true }).status, 'stopped');
    assert.equal(statusOf(fold, { now, transcript: false }).status, 'running');
    fold = foldEntry(fold, { kind: 'user', at: now - 5000, text: 'Fix the tests' });
    assert.equal(statusOf(fold, { now }).status, 'working');
    assert.match(statusOf(fold, { now }).detail, /Fix the tests/);
    fold = foldEntry(fold, { kind: 'call', at: now - 4000, callId: 't1', tool: 'Bash', summary: 'npm test' });
    assert.deepEqual([statusOf(fold, { now, askAfterMs: 20000 }).status, statusOf(fold, { now, askAfterMs: 20000 }).detail], ['working', 'Running Bash: npm test']);
    const asking = statusOf(fold, { now, askAfterMs: 3000 });
    assert.equal(asking.status, 'waiting on you', 'a call that waits long is most likely an approval prompt');
    assert.equal(asking.call.callId, 't1');
    fold = foldEntry(fold, { kind: 'result', at: now - 3000, callId: 't1' });
    fold = foldEntry(fold, { kind: 'reply', at: now - 2900, text: 'Done: all pass.', final: false });
    assert.equal(statusOf(fold, { now, settleMs: 4000 }).status, 'working', 'a reply not yet settled may go on');
    assert.equal(statusOf(fold, { now: now + 5000, settleMs: 4000 }).status, 'idle');
    fold = foldEntry(fold, { kind: 'reply', at: now - 2800, text: 'One more line.', final: true });
    assert.equal(fold.reply.text, 'Done: all pass.\nOne more line.', 'a reply said in parts is one reply');
    assert.equal(statusOf(fold, { now }).status, 'idle');
    fold = foldEntry(fold, { kind: 'user', at: now - 2000, text: 'Ship it?' });
    fold = foldEntry(fold, { kind: 'reply', at: now - 1000, text: 'Ready.\nDECISION NEEDED: Deploy now? — recommend: Yes, deploy', final: true });
    const waiting = statusOf(fold, { now });
    assert.equal(waiting.status, 'waiting on you');
    assert.equal(waiting.ask.recommendation, 'Yes, deploy');
    fold = foldEntry(fold, { kind: 'user', at: now - 900, text: 'Yes' });
    fold = foldEntry(fold, { kind: 'reply', at: now - 800, text: 'Deployed. Let me know if you want the docs updated too.', final: true });
    assert.equal(statusOf(fold, { now }).status, 'idle', 'an offer waits on nobody');
    fold = foldEntry(fold, { kind: 'approval', at: now - 100, summary: 'rm -rf build', callId: 'f9' });
    assert.equal(statusOf(fold, { now }).status, 'waiting on you');
    assert.equal(statusOf(fold, { now }).call.approval, true);
    fold = foldEntry(fold, { kind: 'result', at: now, callId: 'f9' });
    assert.equal(fold.approval, undefined, 'answered');
    assert.equal(fold.turns, 3);
    const same = foldEntry(fold, { kind: 'user', at: now + 5000, text: 'Yes' });
    assert.equal(same.turns, 4, 'the same words later are a new message');
    const echo = foldEntry(same, { kind: 'user', at: now + 5500, text: 'Yes' });
    assert.equal(echo.turns, 4, 'the same words logged twice in a moment are one message');
    assert.equal(foldEntry(fold, { kind: 'unknown' }), fold);
});

test('transcripts: proof is the agent\'s own transcript showing the words, after they were typed', () => {
    let fold = emptyFold();
    fold = foldEntry(fold, { kind: 'user', at: 1000, text: 'Please   run\nthe tests' });
    assert.ok(provenIn(fold, 'Please run the tests', 1000));
    assert.ok(provenIn(fold, 'Please run the tests', 2500), 'a little clock skew is allowed');
    assert.equal(provenIn(fold, 'Please run the tests', 10000), undefined, 'an older message with the same words is no proof');
    assert.equal(provenIn(fold, 'Something else', 0), undefined);
    assert.equal(provenIn(fold, '   ', 0), undefined);
    const long = 'x'.repeat(500);
    fold = foldEntry(fold, { kind: 'user', at: 2000, text: `${long} (trimmed by the CLI)` });
    assert.ok(provenIn(fold, long, 2000), 'the first 160 characters are enough');
});

test('transcripts: a file is read as it grows, whole lines only', () => {
    const dir = tmp('tail');
    const file = join(dir, 't.jsonl');
    const tail = new Tail(file);
    assert.deepEqual(tail.read(), { lines: [], reset: false }, 'no file yet');
    writeFileSync(file, '{"a":1}\n{"b":');
    assert.deepEqual(tail.read().lines, ['{"a":1}']);
    appendFileSync(file, '2}\n\n');
    assert.deepEqual(tail.read().lines, ['{"b":2}']);
    assert.deepEqual(tail.read().lines, []);
    writeFileSync(file, '{"c":3}\n');
    const again = tail.read();
    assert.equal(again.reset, true, 'a file that shrank is read again');
    assert.deepEqual(again.lines, ['{"c":3}']);
    writeFileSync(file, '{"skip":"me"}\n{"keep":1}\n');
    assert.deepEqual(new Tail(file, { maxBytes: 12 }).read().lines, ['{"keep":1}'], 'only the end of a big file, from its next whole line');
    assert.deepEqual(new Tail(file, { maxBytes: 11 }).read().lines, ['{"keep":1}'], 'a cut right after a line break keeps the line');
    writeFileSync(file, '{"skip":"me"}\n{"keep":1}');
    const cut = new Tail(file, { maxBytes: 4 });
    assert.deepEqual(cut.read().lines, [], 'a cut into a line still being written');
    appendFileSync(file, '\n{"next":2}\n');
    assert.deepEqual(cut.read().lines, ['{"next":2}'], 'the cut line is never read as a whole one');
    assert.deepEqual(parseLines('messages', ['not json', JSON.stringify(msgLine('user', { role: 'user', content: 'hi' }, 1))]).map((e) => e.text), ['hi']);
});

// ── Typist ─────────────────────────────────────────────────────────────

test('typist: a message is pasted when the program asked for it, else typed with its lines joined', () => {
    assert.deepEqual(messageKeys('one line', true), { data: `${PASTE_START}one line${PASTE_END}`, paste: true, flattened: false });
    assert.deepEqual(messageKeys('a\nb', true), { data: `${PASTE_START}a\rb${PASTE_END}`, paste: true, flattened: false }, 'line breaks in a paste go as a terminal sends them');
    assert.deepEqual(messageKeys('one line', false), { data: 'one line', paste: false, flattened: false });
    assert.deepEqual(messageKeys('a\n\nb', false), { data: 'a b', paste: false, flattened: true }, 'a line break would send it early');
    assert.deepEqual(messageKeys('one line', undefined).paste, false, 'unknown: one line is safe as keys');
    assert.deepEqual(messageKeys('a\nb', undefined).paste, true, 'unknown: more lines need a paste');
    assert.equal(messageKeys('esc\x1b[201~ape', true).data, `${PASTE_START}esc[201~ape${PASTE_END}`, 'a message cannot end the paste early');
    assert.equal(pasteSwitch('x\x1b[?2004hy\x1b[?2004l'), false);
    assert.equal(pasteSwitch('\x1b[?2004h'), true);
    assert.equal(pasteSwitch('nothing'), undefined);
});

test('typist: direct typing goes into the terminal\'s process without taking the tab\'s control', async () => {
    const writes = [];
    const terminal = { info: { state: 'running' }, handle: { write: async (data) => { writes.push(data); } }, screen: { modes: { bracketedPasteMode: true }, rows: 2, buffer: { active: { baseY: 0, getLine: (y) => ({ translateToString: () => ['› ', ''][y] }) } } } };
    const controller = { owners: new Map([['s1', { terminals: new Map([['t1', terminal]]) }]]) };
    const typist = new Typist({ controller: () => controller, wait: async () => {} });
    assert.deepEqual(typist.way('s1', 't1'), { way: 'direct' });
    assert.equal(typist.pasteMode('s1', 't1'), true);
    assert.deepEqual(typist.screenLines('s1', 't1'), ['› ', '']);
    const typed = await typist.type({ id: 's1' }, 't1', 'Hello');
    assert.deepEqual(typed, { way: 'direct', paste: true, flattened: false });
    assert.deepEqual(writes, [`${PASTE_START}Hello${PASTE_END}`, '\r']);
    writes.length = 0;
    await typist.write({ id: 's1' }, 't1', 'y'.repeat(2500));
    assert.deepEqual(writes.map((w) => w.length), [1024, 1024, 452], 'long input goes in pieces');
    await assert.rejects(typist.type({ id: 's1' }, 't1', 'z'.repeat(40 * 1024)), /longer than 32 KB/);
    terminal.info.state = 'exited';
    assert.match(typist.way('s1', 't1').problem, /no way to type/);
    const forced = new Typist({ controller: () => ({ owners: controller.owners }), method: () => 'attached' });
    terminal.info.state = 'running';
    assert.match(forced.way('s1', 't1').problem, /no terminal input for plugins/);
});

test('typist: the attached way takes the input, learns the paste mode, and lets go', async () => {
    const writes = [];
    const ended = [];
    const controller = {
        follow(agent, id, attachmentId, signal) {
            return (async function* () {
                yield { type: 'snapshot', sequence: 0, screen: 'prompt\x1b[?2004h', info: { controllerId: attachmentId } };
                await new Promise((resolve) => signal.addEventListener('abort', resolve));
                ended.push(attachmentId);
            })();
        },
        async write(agent, id, attachmentId, data) { writes.push([attachmentId, data]); },
    };
    const typist = new Typist({ controller: () => controller, wait: async () => {} });
    assert.deepEqual(typist.way('s1', 't1'), { way: 'attached' });
    const typed = await typist.type({ id: 's1' }, 't1', 'Hi');
    assert.equal(typed.way, 'attached');
    assert.equal(typed.paste, true, 'the paste mode came from the screen it got');
    assert.equal(writes.length, 2);
    assert.equal(writes[0][1], `${PASTE_START}Hi${PASTE_END}`);
    assert.ok(typist.takenAt('s1', 't1') > 0, 'the window is told it lost control, to take it back');
    typist.release('s1', 't1');
    await sleep(10);
    assert.equal(ended.length, 1, 'the attachment ended');
});

// ── Settings, page, detection, input checks ───────────────────────────

test('config: every setting is checked in words, and a save says what changed', () => {
    assert.doesNotThrow(() => checkConfig({ ...DEFAULTS }));
    assert.throws(() => checkConfig({ ...DEFAULTS, proofSeconds: 1 }), /Wait for proof before pressing Enter again \(proofSeconds\) must be a whole number of seconds from 2 to 120 \(it is 1\)/);
    assert.throws(() => checkConfig({ ...DEFAULTS, enterRetries: 9 }), /from 0 to 5/);
    assert.throws(() => checkConfig({ ...DEFAULTS, typing: 'fast' }), /"auto", "direct" or "attached"/);
    assert.throws(() => checkConfig({ ...DEFAULTS, notify: 'yes' }), /true or false/);
    for (const key of LIVE_SETTINGS) assert.ok(SETTING_TITLES[key], `${key} has a title`);
    assert.equal(changedWords([['openTabs'], ['proofSeconds']]), 'Open an agent\'s terminal tab with its session, Wait for proof before pressing Enter again');
    const settings = { ...DEFAULTS };
    const check = new SettingsCheck({ settings, check: checkConfig, liveKeys: LIVE_SETTINGS, label: 'agent-terminals' });
    check.run();
    settings.proofSeconds = 500;
    assert.match(savedEntry(check, [['proofSeconds']]).text, /waits until a wrong one is fixed/);
    settings.proofSeconds = 8;
    assert.match(savedEntry(check, [['proofSeconds']]).text, /Settings fixed/);
    assert.equal(savedEntry(check, []), undefined);
});

test('start form: what is sent is checked in words', () => {
    const home = tmp('form');
    mkdirSync(join(home, 'app'));
    assert.throws(() => checkLaunch({}, { home }), /Name the program/);
    assert.throws(() => checkLaunch({ program: 'a\nb', style: 'flags', folder: home }, { home }), /one line/);
    assert.throws(() => checkLaunch({ program: 'my agent', style: 'flags', folder: home }, { home }), /one word/);
    assert.throws(() => checkLaunch({ program: 'agent', style: 'odd', folder: home }, { home }), /flags, subcommand, continue, plain/);
    assert.throws(() => checkLaunch({ program: 'agent', style: 'flags' }, { home }), /Choose the folder/);
    assert.throws(() => checkLaunch({ program: 'agent', style: 'flags', folder: 'rel/path' }, { home }), /full path/);
    assert.throws(() => checkLaunch({ program: 'agent', style: 'flags', folder: join(home, 'none') }, { home }), /There is no folder at/);
    assert.throws(() => checkLaunch({ program: 'agent', style: 'flags', folder: home, data: 'rel' }, { home }), /full path, such as ~\/.agent/);
    assert.throws(() => checkLaunch({ program: 'agent', style: 'flags', folder: home, args: '--x "open' }, { home }), /not closed/);
    const spec = checkLaunch({ program: 'agent', style: 'flags', folder: '~/app', args: '--model "big one" -v', task: '  Fix it  ' }, { home });
    assert.deepEqual(spec, { program: 'agent', args: ['--model', 'big one', '-v'], style: 'flags', folder: join(home, 'app'), name: 'agent · app', task: 'Fix it' });
    assert.equal(checkLaunch({ program: 'agent', style: 'plain', sessionId: 's1' }).folder, undefined, 'a session brings its own folder');
    assert.deepEqual(splitArgs(`a 'b c' "" d`), ['a', 'b c', '', 'd']);
});

test('detect: coding agents are found by the conversations they keep, not by name', () => {
    const home = tmp('detect');
    mkdirSync(join(home, '.alpha', 'projects', '-w-app'), { recursive: true });
    writeFileSync(join(home, '.alpha', 'projects', '-w-app', 'c1.jsonl'), '{}\n');
    mkdirSync(join(home, '.beta', 'sessions', '2026', '10', '17'), { recursive: true });
    writeFileSync(join(home, '.beta', 'sessions', '2026', '10', '17', 'rollout-x-r1.jsonl'), '{}\n');
    mkdirSync(join(home, '.gamma', 'projects'), { recursive: true });
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'alpha'), '#!/bin/sh\n');
    import('node:fs').then(({ chmodSync }) => chmodSync(join(home, '.local', 'bin', 'alpha'), 0o755));
    assert.ok(keepsProjects(join(home, '.alpha')));
    assert.equal(keepsProjects(join(home, '.gamma')), undefined, 'an empty projects folder is not an agent');
    assert.ok(keepsSessions(join(home, '.beta')));
    const found = detectAgents(home, { path: '' });
    assert.deepEqual(found.map((f) => [f.program, f.style]).sort(), [['alpha', 'flags'], ['beta', 'subcommand']]);
});

test('page: its state reads in one go, and says what is wrong', async () => {
    const journal = new Journal(join(tmp('page'), 'events.jsonl'));
    journal.add({ kind: 'start', text: 'Started x', why: 'You did.' });
    const state = await pageState({
        agents: { list: () => [{ key: 'a' }], recent: [] },
        journal,
        config: { ...DEFAULTS },
        check: { ok: false, problem: { text: 'x must be y', key: 'proofSeconds', live: true } },
        watch: { settings: {} },
        terminals: () => undefined,
        detected: async () => [{ program: 'alpha' }],
        workspaces: () => [{ path: '/w', title: 'w' }],
    });
    assert.equal(state.problem.key, 'proofSeconds');
    assert.equal(state.terminals, false);
    assert.equal(state.agents.length, 1);
    assert.equal(state.history[0].text, 'Started x');
    assert.equal(state.styles.length, 4);
    assert.deepEqual(STYLE_CHOICES.map((s) => s.id), ['flags', 'subcommand', 'continue', 'plain']);
});

test('saved state: a broken or older file never stops it', () => {
    assert.deepEqual(parseData(undefined), { version: 1, agents: {}, recent: [] });
    assert.deepEqual(parseData({ agents: { 'bad key!': { sessionId: 's', program: 'x' }, ok: { program: 'x' } } }).agents, {});
    const data = parseData({ agents: { k1: { sessionId: 's1', program: 'agent', style: 'weird', launches: -1, deliveries: [{ id: 'm', text: 't', state: 'typing' }, { id: 'n', state: 'queued' }] } } });
    assert.equal(data.agents.k1.style, 'plain');
    assert.equal(data.agents.k1.launches, 1);
    assert.equal(data.agents.k1.terminalId, 'agent-k1-1');
    assert.deepEqual(data.agents.k1.deliveries.map((d) => [d.id, d.state]), [['m', 'queued']], 'a message cut off while typed is typed again');
    assert.match(exitWords({ program: 'nope' }, 127), /could not find nope/);
    assert.match(exitWords({ program: 'x' }, 0, 'Start again runs it anew.'), /runs it anew/);
});

// ── The stand-in agent on its own ──────────────────────────────────────

function runFake(args, cwd) {
    const child = spawn(process.execPath, [FAKE, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    children.add(child);
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('exit', () => children.delete(child));
    return { child, out: () => out, type: (data) => child.stdin.write(data) };
}

test('stand-in agent: a pasted message and its Enter make one transcript entry and a reply', async () => {
    const dir = tmp('fake-flags');
    const fake = runFake(['--style', 'flags', '--data', join(dir, 'data'), '--session-id', 'c1'], dir);
    await until(() => fake.out().includes('›'), 'its prompt');
    fake.type(`${PASTE_START}#work=20 line one\rline two${PASTE_END}`);
    await sleep(50);
    fake.type('\r');
    const file = join(dir, 'data', 'projects', folderKey(dir), 'c1.jsonl');
    const lines = await until(() => existsSync(file) && readFileSync(file, 'utf8').split('\n').filter(Boolean).length >= 2 && readFileSync(file, 'utf8').split('\n').filter(Boolean), 'the reply');
    const entries = parseLines('messages', lines);
    assert.equal(entries[0].text, '#work=20 line one\nline two', 'one message, both lines');
    assert.match(entries.at(-1).text, /^Done: line one/);
    fake.type('\x04');
    await until(() => fake.child.exitCode === 0, 'it to quit on Ctrl-D');
});

test('stand-in agent: with --swallow-enter the first Enter after a paste is lost, the second sends', async () => {
    const dir = tmp('fake-swallow');
    const fake = runFake(['--style', 'flags', '--data', join(dir, 'data'), '--session-id', 'c2', '--swallow-enter'], dir);
    await until(() => fake.out().includes('›'), 'its prompt');
    fake.type(`${PASTE_START}#work=10 hello${PASTE_END}`);
    await sleep(30);
    fake.type('\r');
    await sleep(300);
    const file = join(dir, 'data', 'projects', folderKey(dir), 'c2.jsonl');
    assert.equal(existsSync(file), false, 'nothing sent yet');
    fake.type('\r');
    await until(() => existsSync(file), 'the second Enter to send it');
    fake.child.kill('SIGTERM');
});

test('stand-in agent: the events style names its conversation in a new dated file, and resume appends to it', async () => {
    const dir = tmp('fake-events');
    const data = join(dir, 'data');
    const started = Date.now();
    const first = runFake(['--style', 'subcommand', '--data', data], dir);
    await until(() => first.out().includes('›'), 'its prompt');
    const found = await until(() => findNewTranscript({ program: 'x', style: 'subcommand', data, folder: dir }, dir, started), 'its new file');
    assert.equal(eventsMeta(found.path).cwd, dir);
    const link = join(tmp('link'), 'here');
    symlinkSync(dir, link);
    assert.equal(findNewTranscript({ program: 'x', style: 'subcommand', data, folder: link }, dir, started)?.path, found.path, 'its folder named through a link is the same folder');
    assert.equal(findNewTranscript({ program: 'x', style: 'subcommand', data, folder: tmp('other') }, dir, started), undefined, 'another folder\'s conversation is not its');
    assert.equal(findNewTranscript({ program: 'x', style: 'subcommand', data, folder: dir }, dir, started, new Set([found.path])), undefined, 'a file another agent took is not its');
    first.type(`${PASTE_START}#work=10 #tool build it${PASTE_END}`);
    await sleep(30);
    first.type('\r');
    await until(() => readFileSync(found.path, 'utf8').includes('task_complete'), 'its answer');
    first.child.kill('SIGTERM');
    await until(() => first.child.exitCode !== null || first.child.signalCode !== null, 'it to stop');
    const second = runFake(['--style', 'subcommand', '--data', data, 'resume', found.id], dir);
    await until(() => second.out().includes(`Resumed conversation ${found.id}`), 'the resume');
    assert.equal(findTranscriptById({ program: 'x', data }, dir, found.id), found.path);
    second.type('#work=10 again\r');
    await until(() => readFileSync(found.path, 'utf8').split('\n').filter((l) => l.includes('again')).length >= 2, 'the resumed answer');
    let fold = emptyFold();
    for (const entry of parseLines('events', readFileSync(found.path, 'utf8').split('\n').filter(Boolean))) fold = foldEntry(fold, entry);
    assert.equal(fold.turns, 2);
    assert.equal(fold.id, found.id);
    assert.equal(statusOf(fold, { now: Date.now() + 10000 }).status, 'idle');
    second.child.kill('SIGTERM');
});

// ── The engine over a stand-in DSH ─────────────────────────────────────

const strip = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b./g, '');

/** A stand-in for one DSH session terminal: a "shell" that runs `exec <program> <args>` for real, with pipes. */
class FakeTerminal {
    constructor(id, cwd) {
        this.cwd = cwd;
        this.info = { id, state: 'running', exitCode: null, title: 'zsh', cols: 120, rows: 32 };
        this.output = 'me@mac app % ';
        this.paste = true;
        this.line = '';
        this.child = undefined;
        this.handle = { write: async (data) => this.input(data) };
        const self = this;
        this.screen = {
            rows: 32,
            modes: { get bracketedPasteMode() { return self.paste; } },
            buffer: { active: { baseY: 0, getLine: (y) => ({ translateToString: () => self.lines()[y] ?? '' }) } },
        };
    }

    lines() {
        const all = strip(this.output).split(/\r?\n/).map((line) => line.split('\r').at(-1));
        return all.slice(-32).concat(Array(32).fill('')).slice(0, 32);
    }

    input(data) {
        if (this.child) {
            this.child.stdin.write(data);
            return;
        }
        // The shell echoes what is typed at its prompt, as a terminal does.
        for (const ch of data) {
            if (ch === '\r') {
                this.print('\r\n');
                this.run(this.line);
                this.line = '';
            } else {
                this.print(ch);
                this.line += ch;
            }
        }
    }

    run(line) {
        const words = splitArgs(line);
        if (words[0] !== 'exec' || words.length < 2) {
            this.print(`zsh: ${line}\r\n`);
            return;
        }
        this.paste = false;
        const child = spawn(words[1], words.slice(2), { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        children.add(child);
        this.child = child;
        child.stdout.on('data', (chunk) => this.print(chunk.toString('utf8')));
        child.stderr.on('data', (chunk) => this.print(chunk.toString('utf8')));
        const done = (code) => {
            children.delete(child);
            if (this.child === child) this.child = undefined;
            if (this.info.state === 'running') this.info = { ...this.info, state: 'exited', exitCode: code };
        };
        child.on('error', () => done(127));
        child.on('exit', (code, signal) => done(code ?? (signal === 'SIGTERM' ? 143 : 129)));
    }

    print(text) {
        this.output = `${this.output}${text}`.slice(-20000);
        const mode = pasteSwitch(text);
        if (mode !== undefined) this.paste = mode;
    }

    kill() {
        try { this.child?.kill('SIGTERM'); } catch {}
    }
}

class FakeController {
    constructor() {
        this.owners = new Map();
    }

    owner(sessionId) {
        let owner = this.owners.get(sessionId);
        if (!owner) {
            owner = { terminals: new Map(), closedIds: new Set() };
            this.owners.set(sessionId, owner);
        }
        return owner;
    }

    async shells() { return [{ path: '/bin/zsh', name: 'zsh' }]; }

    list(sessionId) {
        return [...(this.owners.get(sessionId)?.terminals.values() ?? [])].map((t) => t.info);
    }

    async create(agent, request) {
        const owner = this.owner(agent.id);
        if (owner.closedIds.has(request.id)) throw new Error('Terminal was closed in this Session');
        const existing = owner.terminals.get(request.id);
        if (existing) return existing.info;
        if (owner.terminals.size >= 8) throw new Error('Session terminal limit reached');
        const terminal = new FakeTerminal(request.id, agent.session.header.cwd);
        owner.terminals.set(request.id, terminal);
        return terminal.info;
    }

    rename(agent, id, title) {
        const terminal = this.owners.get(agent.id)?.terminals.get(id);
        if (terminal) terminal.info = { ...terminal.info, title };
    }

    async close(agent, id) {
        const owner = this.owner(agent.id);
        owner.closedIds.add(id);
        owner.terminals.get(id)?.kill();
        owner.terminals.delete(id);
    }

    retain(sessionId, id, signal) {
        return (async function* () {
            yield { type: 'retained' };
            await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        })();
    }

    terminal(sessionId, id) {
        return this.owners.get(sessionId)?.terminals.get(id);
    }

    /** DSH quits: every terminal ends, and nothing about them is kept. */
    restart() {
        for (const owner of this.owners.values()) for (const terminal of owner.terminals.values()) terminal.kill();
        this.owners = new Map();
    }
}

function fakeWatch() {
    const sessions = new Map();
    return {
        sessions,
        asks: new Map(),
        externals: new Map(),
        delivered: [],
        add(sessionId, cwd) {
            sessions.set(sessionId, { id: sessionId, session: { header: { cwd } }, followup() {}, status: 'idle' });
        },
        async resolveAgent(id) {
            const agent = sessions.get(id);
            if (!agent) throw new Error(`session "${id}" not found`);
            return agent;
        },
        async get(id) {
            return { sessionId: id, ...(sessions.has(id) ? { cwd: sessions.get(id).session.header.cwd } : {}) };
        },
        sessionOf(id) { return sessions.get(id); },
        raiseAsk(ask) { this.asks.set(ask.id, ask); return ask; },
        dropAsk(id) { return this.asks.delete(id); },
        setExternal(id, external) {
            if (external === null) this.externals.delete(id);
            else this.externals.set(id, external);
        },
        async deliver(sessionId, text) {
            this.delivered.push({ sessionId, text });
            return { state: 'queued' };
        },
    };
}

function engine({ dir = tmp('engine'), watch = fakeWatch(), controller = new FakeController(), config = {}, store } = {}) {
    let n = 0;
    const notices = [];
    const settings = { ...DEFAULTS, proofSeconds: 1, askAfterSeconds: 1, ...config };
    const sessions = {
        async create(folder) {
            const id = `s${++n}-${Math.random().toString(36).slice(2, 6)}`;
            watch.add(id, folder);
            return id;
        },
        async rename() {},
    };
    const theStore = store ?? new JsonStore(join(dir, 'state.json'), { parse: parseData, delayMs: 5 });
    const journal = new Journal(join(dir, 'events.jsonl'));
    // DSH's server keeps its process alive; here the waits must (the plugin's own timers do not hold a process open).
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const typist = new Typist({ controller: () => controller, method: () => settings.typing, wait });
    const agents = new AgentTerminals({
        watch, controller: () => controller, sessions, typist, config: settings, store: theStore, journal, home: dir,
        notify: (item) => notices.push(item), tickMs: 100, wait,
    });
    return { agents, watch, controller, settings, store: theStore, journal, notices, dir };
}

const fakeArgs = (data, extra = []) => ['--style', 'flags', '--data', data, ...extra];

test('engine: start an agent, type its first message in, and prove it from its transcript', async () => {
    const { agents, watch, controller, journal, dir } = engine();
    const folder = join(dir, 'app');
    mkdirSync(folder);
    agents.start();
    try {
        const started = await agents.launch({ program: FAKE, args: fakeArgs(join(dir, 'data')), style: 'flags', data: join(dir, 'data'), folder, name: 'Stand-in', task: '#work=50 #reply=Hello from the stand-in first task' });
        assert.equal(started.problem, undefined);
        const key = started.agent.key;
        const record = agents.records[key];
        assert.equal(watch.delivered.length, 1, 'its session got a first turn, so DSH lists it');
        assert.match(watch.delivered[0].text, /coding agent runs in this session's terminal/);
        const terminal = controller.terminal(record.sessionId, record.terminalId);
        assert.ok(terminal, 'a terminal in its session');
        assert.equal(terminal.info.title, 'Stand-in');
        await until(() => agents.view(record).deliveries[0]?.state === 'delivered', 'the first message proven');
        const view = agents.view(record);
        assert.equal(view.deliveries[0].enters, 1);
        assert.equal(view.deliveries[0].way, 'direct');
        await until(() => agents.view(record).status === 'idle', 'idle after its answer');
        assert.equal(agents.view(record).lastReply.text, 'Hello from the stand-in first task');
        assert.equal(watch.externals.get(record.sessionId).status, 'idle', 'the session row says so');
        assert.ok(journal.list().some((e) => e.kind === 'proof' && /has the message/.test(e.text)));
        assert.match(terminal.output, /exec .*fake-agent\.mjs --style flags/, 'it was started with exec');
        assert.match(terminal.output, new RegExp(`--session-id ${record.conversationId}`), 'with the id it gave it');
    } finally {
        agents.stop();
        controller.restart();
    }
});

test('engine: a question in its reply goes to Decisions, and the answer is typed in', async () => {
    const { agents, watch, controller, notices, dir } = engine();
    agents.start();
    try {
        const { agent } = await agents.launch({ program: FAKE, args: fakeArgs(join(dir, 'data')), style: 'flags', data: join(dir, 'data'), folder: dir, name: 'Asker' });
        const record = agents.records[agent.key];
        await until(() => agents.view(record).ready, 'it to be ready');
        agents.send(agent.key, '#work=30 #ask Can we go?');
        await until(() => agents.view(record).status === 'waiting on you', 'its question');
        const ask = [...watch.asks.values()][0];
        assert.equal(ask.question, 'Use the fast path?');
        assert.equal(ask.recommendation, 'Yes, the fast path');
        assert.deepEqual(ask.options, [{ id: 'recommended', label: 'Go with the recommendation' }]);
        assert.equal(ask.freeText, true);
        assert.equal(ask.sessionId, record.sessionId);
        assert.equal(notices.length, 1, 'one notification');
        assert.match(notices[0].title, /Asker waits on you/);
        const result = ask.onAnswer('recommended', 'you');
        assert.match(result.text, /Typed into Asker's terminal/);
        await until(() => agents.view(record).deliveries[0]?.state === 'delivered', 'the answer proven');
        assert.equal(agents.view(record).deliveries[0].text, 'Go with your recommendation: Yes, the fast path');
        await until(() => watch.asks.size === 0, 'the question dropped once answered');
        await until(() => agents.view(record).status === 'idle', 'idle again');
    } finally {
        agents.stop();
        controller.restart();
    }
});

test('engine: a swallowed Enter is pressed again, and the proof says so', async () => {
    const { agents, controller, dir } = engine();
    agents.start();
    try {
        const { agent } = await agents.launch({ program: FAKE, args: fakeArgs(join(dir, 'data'), ['--swallow-enter']), style: 'flags', data: join(dir, 'data'), folder: dir });
        const record = agents.records[agent.key];
        await until(() => agents.view(record).ready, 'it to be ready');
        agents.send(agent.key, '#work=20 swallow test');
        const done = await until(() => agents.view(record).deliveries.find((d) => d.state === 'delivered'), 'proof after the second Enter', 20000);
        assert.equal(done.enters, 2);
        assert.match(done.why, /after Enter 2 times/);
    } finally {
        agents.stop();
        controller.restart();
    }
});

test('engine: a tool call waiting in its terminal holds the next message, and Decisions says to answer there', async () => {
    const { agents, watch, controller, dir } = engine();
    agents.start();
    try {
        const { agent } = await agents.launch({ program: FAKE, args: fakeArgs(join(dir, 'data')), style: 'flags', data: join(dir, 'data'), folder: dir, name: 'Careful' });
        const record = agents.records[agent.key];
        await until(() => agents.view(record).ready, 'it to be ready');
        agents.send(agent.key, '#work=20 #approve make a file');
        await until(() => agents.view(record).status === 'waiting on you', 'its approval prompt', 20000);
        const ask = [...watch.asks.values()][0];
        assert.match(ask.question, /It asks to run “touch approved.txt”/);
        assert.equal(ask.onAnswer, undefined, 'only its terminal can answer');
        assert.match(ask.answerHint, /Answer in its terminal/);
        agents.send(agent.key, '#work=20 after the approval');
        await until(() => agents.view(record).deliveries[0].state === 'waiting', 'the next message to wait');
        assert.match(agents.view(record).deliveries[0].why, /waits on you in its terminal/);
        // The person answers in the terminal.
        await controller.terminal(record.sessionId, record.terminalId).handle.write('1');
        await until(() => existsSync(join(dir, 'approved.txt')), 'the approved command to run');
        await until(() => agents.view(record).deliveries[0].state === 'delivered', 'the held message typed in after');
        assert.equal(watch.asks.size, 0);
    } finally {
        agents.stop();
        controller.restart();
    }
});

test('engine: stop, start again with its conversation, and pick up after a DSH restart', async () => {
    const dir = tmp('restart');
    const controller = new FakeController();
    const watch = fakeWatch();
    const first = engine({ dir, watch, controller });
    first.agents.start();
    let key;
    let record;
    try {
        const { agent } = await first.agents.launch({ program: FAKE, args: fakeArgs(join(dir, 'data')), style: 'flags', data: join(dir, 'data'), folder: dir, name: 'Keeper', task: '#work=20 remember the number 41' });
        key = agent.key;
        record = first.agents.records[key];
        await until(() => first.agents.view(record).deliveries[0]?.state === 'delivered', 'its first message');
        const firstTerminal = record.terminalId;
        await first.agents.stopAgent(key);
        assert.equal(first.agents.view(record).status, 'stopped');
        assert.equal(controller.terminal(record.sessionId, firstTerminal), undefined, 'its terminal is closed');
        await first.agents.startAgain(key);
        assert.notEqual(record.terminalId, firstTerminal, 'a closed terminal id is not used again in the same DSH');
        await until(() => controller.terminal(record.sessionId, record.terminalId)?.output.includes(`Resumed conversation ${record.conversationId}`), 'the resume');
        first.agents.send(key, '#work=20 second message');
        await until(() => first.agents.view(record).deliveries[0]?.state === 'delivered', 'the second message');
        assert.equal(first.agents.view(record).turns, 2, 'one conversation');
    } finally {
        first.agents.stop();
    }
    // DSH quits and starts again: its terminals are gone, and this is a new process.
    controller.restart();
    first.store.data.agents[key].hostPid = 1;
    first.store.flush();
    const second = engine({ dir, watch, controller, store: new JsonStore(join(dir, 'state.json'), { parse: parseData, delayMs: 5 }) });
    second.agents.start();
    try {
        const again = second.agents.records[key];
        await until(() => controller.terminal(again.sessionId, again.terminalId)?.output.includes(`Resumed conversation ${again.conversationId}`), 'the resume after the restart');
        assert.equal(again.terminalId, record.terminalId, 'the same terminal id, so the window\'s tab finds it');
        await until(() => second.agents.view(again).status === 'idle', 'idle with its old answer');
        second.agents.send(key, '#work=20 third message');
        await until(() => second.agents.view(again).deliveries[0]?.state === 'delivered', 'the third message');
        assert.equal(second.agents.view(again).turns, 3);
        assert.ok(second.journal.list().some((e) => /Started Keeper again after DSH restarted/.test(e.text)));
    } finally {
        second.agents.stop();
        controller.restart();
    }
});

test('engine: a reload of the plugin leaves the agent running, and a message typed just before is still proven', async () => {
    const dir = tmp('reload');
    const controller = new FakeController();
    const watch = fakeWatch();
    const first = engine({ dir, watch, controller });
    first.agents.start();
    let key;
    let terminal;
    try {
        const { agent } = await first.agents.launch({ program: FAKE, args: fakeArgs(join(dir, 'data')), style: 'flags', data: join(dir, 'data'), folder: dir, name: 'Steady' });
        key = agent.key;
        const record = first.agents.records[key];
        terminal = controller.terminal(record.sessionId, record.terminalId);
        await until(() => first.agents.view(record).ready, 'ready');
        first.agents.send(key, '#work=600 typed before the reload');
        await until(() => first.agents.view(record).deliveries[0]?.state === 'typed', 'typed in', 15000, 10);
    } finally {
        first.agents.stop();
    }
    assert.equal(watch.externals.size, 0, 'a stopped Agent Terminals leaves no status on the rows');
    const second = engine({ dir, watch, controller, store: new JsonStore(join(dir, 'state.json'), { parse: parseData, delayMs: 5 }) });
    second.agents.start();
    try {
        const record = second.agents.records[key];
        assert.equal(controller.terminal(record.sessionId, record.terminalId), terminal, 'the same terminal, never started again');
        await until(() => second.agents.view(record).deliveries[0]?.state === 'delivered', 'its proof, found after the reload');
        assert.equal(second.agents.view(record).deliveries[0].enters, 1, 'no Enter pressed again');
        await until(() => second.agents.view(record).status === 'idle', 'idle');
        assert.equal(second.journal.list().filter((e) => e.kind === 'restart').length, 0, 'not taken for a DSH restart');
        assert.equal((terminal.output.match(/exec /g) ?? []).length, 1, 'started once');
    } finally {
        second.agents.stop();
        controller.restart();
    }
});

test('engine: an agent that exits, a program that is not there, and a program with no transcript', async () => {
    const { agents, controller, dir } = engine();
    agents.start();
    try {
        const { agent } = await agents.launch({ program: FAKE, args: fakeArgs(join(dir, 'data')), style: 'flags', data: join(dir, 'data'), folder: dir, name: 'Leaver' });
        const record = agents.records[agent.key];
        await until(() => agents.view(record).ready, 'ready');
        agents.send(agent.key, '#work=10 #exit bye');
        await until(() => agents.view(record).status === 'stopped', 'it to stop');
        assert.match(agents.view(record).detail, /exited by itself \(code 0\)/);
        assert.equal(record.wanted, 'stopped');

        const missing = await agents.launch({ program: join(dir, 'no-such-agent'), style: 'plain', folder: dir, name: 'Ghost' });
        const ghost = agents.records[missing.agent.key];
        await until(() => agents.view(ghost).status === 'stopped', 'the missing program to end');
        assert.match(agents.view(ghost).detail, /could not find/);

        const plain = await agents.launch({ program: FAKE, args: ['--style', 'plain'], style: 'plain', folder: dir, name: 'Quiet' });
        const quiet = agents.records[plain.agent.key];
        await until(() => agents.view(quiet).ready, 'ready');
        assert.equal(agents.view(quiet).status, 'running');
        agents.send(plain.agent.key, '#work=10 no transcript here');
        await until(() => agents.view(quiet).deliveries[0]?.state === 'typed', 'typed in');
        assert.match(agents.view(quiet).deliveries[0].why, /keeps no transcript/);
        await assert.rejects(agents.launch({ program: FAKE, style: 'plain', sessionId: quiet.sessionId }), /already has a coding agent/);
        await agents.forget(plain.agent.key);
        assert.equal(agents.records[plain.agent.key], undefined);
    } finally {
        agents.stop();
        controller.restart();
    }
});

test('engine: the events style is followed through its dated file, across a start again', async () => {
    const { agents, controller, dir } = engine();
    agents.start();
    try {
        const { agent } = await agents.launch({ program: FAKE, args: ['--style', 'subcommand', '--data', join(dir, 'data')], style: 'subcommand', data: join(dir, 'data'), folder: dir, name: 'Eventful', task: '#work=20 #tool first' });
        const record = agents.records[agent.key];
        await until(() => agents.view(record).deliveries[0]?.state === 'delivered', 'its first message');
        assert.ok(record.conversationId, 'its id came from its file');
        assert.match(record.transcript, /rollout-.*\.jsonl$/);
        await agents.stopAgent(agent.key);
        await agents.startAgain(agent.key);
        const terminal = controller.terminal(record.sessionId, record.terminalId);
        await until(() => terminal.output.includes(`Resumed conversation ${record.conversationId}`), 'the resume');
        assert.match(terminal.output, new RegExp(`fake-agent\\.mjs resume ${record.conversationId} --style subcommand`), 'resume comes right after the program');
        agents.send(agent.key, '#work=20 second');
        await until(() => agents.view(record).deliveries[0]?.state === 'delivered', 'the second message');
        assert.equal(agents.view(record).turns, 2);
    } finally {
        agents.stop();
        controller.restart();
    }
});
