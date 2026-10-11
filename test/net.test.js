import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { netHunks, lineDelta, MAX_NET_DISTANCE } from '../plugins/projects/lib/changes.js';
import { NetTexts, changedPath, readSide, MAX_NET_BYTES } from '../plugins/projects/lib/net.js';

// A thread's net diff per file (plugins/projects/lib/changes.js netHunks, net.js): what its edits came to, from the
// file's text before its first edit to its text after its last. The manager's hook and the Changes tab are in
// plugins/projects/test/smoke.mjs.

/** A file's lines, as a diff counts them: a last newline ends the last line. */
const lines = (text) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));
/** A hunk's side as lines, as DSH's diff reads it: '' (or none) has none. */
const sideLines = (text) => (typeof text === 'string' && text !== '' ? text.split('\n') : []);
/** Lines as a file's text. */
const fileText = (list) => (list.length > 0 ? `${list.join('\n')}\n` : '');

/** Put a net diff's hunks back into the old text: each hunk's old side, context and all, is where the diff says. */
function apply(before, hunks) {
    const out = lines(before);
    let at = 0;
    for (const hunk of hunks) {
        const old = sideLines(hunk.oldText);
        const start = old.length === 0 ? at : out.findIndex((_, i) => i >= at && old.every((line, k) => out[i + k] === line));
        assert.ok(start >= 0, `hunk ${JSON.stringify(hunk.oldText)} is in the old text`);
        const fresh = sideLines(hunk.newText);
        out.splice(start, old.length, ...fresh);
        at = start + fresh.length;
    }
    return out;
}

test('net diff: one hunk per run of changes, three lines of context, runs six or fewer lines apart in one', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n') + '\n';
    const after = before.replace('l2\n', 'L2\n').replace('l8\n', 'L8\n').replace('l17\n', '');
    const net = netHunks(before, after);
    assert.deepEqual(net, {
        added: 2, deleted: 3,
        hunks: [
            { oldText: 'l0\nl1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\nl11', newText: 'l0\nl1\nL2\nl3\nl4\nl5\nl6\nl7\nL8\nl9\nl10\nl11' },
            { oldText: 'l14\nl15\nl16\nl17\nl18\nl19', newText: 'l14\nl15\nl16\nl18\nl19' },
        ],
    });
    assert.deepEqual(apply(before, net.hunks), lines(after));
});

test('net diff: a new file is one hunk of its text; equal texts none; line endings and a last newline don\'t count', () => {
    assert.deepEqual(netHunks(null, 'a\nb\n'), { added: 2, deleted: 0, created: true, hunks: [{ oldText: null, newText: 'a\nb' }] });
    assert.deepEqual(netHunks(null, ''), { added: 0, deleted: 0, created: true, hunks: [] });
    assert.deepEqual(netHunks('a\nb\n', 'a\nb\n'), { added: 0, deleted: 0, hunks: [] });
    assert.deepEqual(netHunks('a\r\nb\r\n', 'a\nb'), { added: 0, deleted: 0, hunks: [] });
    assert.deepEqual(netHunks('', 'x\n'), { added: 1, deleted: 0, hunks: [{ oldText: '', newText: 'x' }] });
    assert.deepEqual(netHunks('x\n', ''), { added: 0, deleted: 1, hunks: [{ oldText: 'x', newText: '' }] });
});

test('net diff: past MAX_NET_DISTANCE differing lines there is none', () => {
    const many = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join('\n');
    assert.equal(netHunks(many('a', MAX_NET_DISTANCE), many('b', 1)), null);
    assert.equal(netHunks(many('a', 400), many('b', 400)).added, 400);
});

test('net diff: random edits come back whole, counted as a line diff counts them', () => {
    let seed = 7;
    const random = (n) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % n;
    };
    let fresh = 0;
    // `few` draws lines from a handful of words, so many lines repeat (the counts must still be a shortest diff's);
    // otherwise each line is its own, so each hunk's old side is found in one place only and the hunks can be put back.
    for (const few of [false, true]) {
        for (let round = 0; round < 300; round++) {
            const word = () => (few ? `w${random(4)}` : `n${fresh++}`);
            const before = Array.from({ length: random(30) }, word);
            const after = [...before];
            for (let k = random(6); k > 0; k--) {
                const at = random(after.length + 1);
                if (random(2) === 0 && after.length > 0) after.splice(Math.min(at, after.length - 1), 1);
                else after.splice(at, 0, word());
            }
            const net = netHunks(fileText(before), fileText(after));
            const text = `${JSON.stringify(before)} → ${JSON.stringify(after)}`;
            assert.deepEqual({ added: net.added, deleted: net.deleted }, lineDelta(before, after), text);
            if (!few) assert.deepEqual(apply(fileText(before), net.hunks), after, text);
        }
    }
});

test('net texts: the path a file-tool call changes, and a file as one side', async () => {
    assert.equal(changedPath('write', { file_path: ' a.md ', content: '' }), 'a.md');
    assert.equal(changedPath('write', { file_path: 'a.md' }), undefined);
    assert.equal(changedPath('edit', { file_path: 'a.md', old_string: 'x', new_string: 'y' }), 'a.md');
    assert.equal(changedPath('str_replace_editor', { command: 'view', path: 'a.md' }), undefined);
    assert.equal(changedPath('str_replace_editor', { command: 'insert', path: 'a.md', new_str: 'x' }), 'a.md');
    assert.equal(changedPath('read', { file_path: 'a.md' }), undefined);
    const dir = mkdtempSync(join(tmpdir(), 'net-side-'));
    assert.deepEqual(await readSide(join(dir, 'none')), { kind: 'absent' });
    writeFileSync(join(dir, 'text'), 'hi\n');
    assert.equal((await readSide(join(dir, 'text'))).text, 'hi\n');
    writeFileSync(join(dir, 'bin'), Buffer.from([104, 0, 105]));
    assert.equal((await readSide(join(dir, 'bin'))).kind, 'binary');
    writeFileSync(join(dir, 'big'), Buffer.alloc(MAX_NET_BYTES + 1, 97));
    assert.deepEqual(await readSide(join(dir, 'big')), { kind: 'big' });
    assert.deepEqual(await readSide(dir), { kind: 'unreadable' });
});

test('net texts: calls on one file run one at a time, each seeing the file as the last one left it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'net-order-'));
    const net = new NetTexts(join(dir, 'net'));
    const file = join(dir, 'f.txt');
    const seen = [];
    const slow = (text, ms) => net.around('t', file, async () => {
        seen.push(`start ${text}`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        writeFileSync(file, `${text}\n`);
        seen.push(`end ${text}`);
    });
    await Promise.all([slow('one', 30), slow('two', 1), slow('three', 1)]);
    assert.deepEqual(seen, ['start one', 'end one', 'start two', 'end two', 'start three', 'end three']);
    assert.deepEqual(await net.view('t', file), { net: { added: 1, deleted: 0, created: true, hunks: [{ oldText: null, newText: 'three' }] } });
    // A big file, or one that isn't text, has no net diff, and says why.
    const big = join(dir, 'big.txt');
    writeFileSync(big, Buffer.alloc(MAX_NET_BYTES + 10, 97));
    await net.around('t', big, async () => writeFileSync(big, 'small\n'));
    assert.deepEqual(await net.view('t', big), { why: 'big' });
});

test('net texts: a file the thread edited before the plugin kept texts has no net diff, and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'net-calls-'));
    const net = new NetTexts(join(dir, 'net'));
    const file = join(dir, 'f.txt');
    writeFileSync(file, 'a\n');
    await net.around('t', file, async () => writeFileSync(file, 'b\n'), 'c1');
    // A call that changed nothing names no edit, and isn't needed for one.
    await net.around('t', file, async () => {}, 'c2');
    await net.around('t', file, async () => writeFileSync(file, 'c\n'), 'c3');
    const whole = { net: { added: 1, deleted: 1, hunks: [{ oldText: 'a', newText: 'c' }] } };
    assert.deepEqual(await net.view('t', file, ['c1', 'c3']), whole);
    assert.deepEqual(await net.view('t', file), whole, 'no records to check against');
    assert.deepEqual(await net.view('t', file, ['c0', 'c1', 'c3']), { why: 'partial' });
    // Read from disk by a new process, the same.
    assert.deepEqual(await new NetTexts(join(dir, 'net')).view('t', file, ['c0', 'c1', 'c3']), { why: 'partial' });
});

test('net texts: at start, threads the store no longer has lose their texts, then the oldest past the limit, once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'net-prune-'));
    const root = join(dir, 'net');
    const lines = [];
    const net = new NetTexts(root);
    net.log = (line) => lines.push(line);
    const folder = (name, bytes, ageDays) => {
        mkdirSync(join(root, name), { recursive: true });
        const index = join(root, name, 'index.json');
        writeFileSync(index, JSON.stringify({ version: 1, bytes, files: {} }));
        const at = Date.now() / 1000 - ageDays * 86400;
        utimesSync(index, at, at);
    };
    folder('old', 300 * 1024 * 1024, 30);
    folder('mid', 200 * 1024 * 1024, 10);
    folder('new', 100 * 1024 * 1024, 1);
    folder('gone', 10, 1);
    writeFileSync(join(root, 'not.a.thread'), 'x');
    // A store with no threads (as one that failed to load) leaves them all.
    assert.deepEqual(await new NetTexts(root).prune(new Set()), []);
    assert.deepEqual(await net.prune(new Set(['old', 'mid', 'new'])), ['gone', 'old']);
    assert.deepEqual(readdirSync(root).sort(), ['mid', 'new', 'not.a.thread']);
    assert.deepEqual(lines, ['net-prune gone gone', 'net-prune old oldest']);
    assert.deepEqual(await net.prune(new Set(['mid'])), [], 'once a process');
});

test('net texts: a thread whose call is still running keeps its index in memory, however many threads come after', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'net-lru-'));
    const net = new NetTexts(join(dir, 'net'));
    const file = join(dir, 'f.txt');
    let finish;
    const held = new Promise((resolve) => { finish = resolve; });
    const slow = net.around('a', file, async () => { await held; writeFileSync(file, 'a\n'); }, 'ca');
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let i = 0; i < 60; i++) await net.around(`t${i}`, join(dir, `g${i}.txt`), async () => writeFileSync(join(dir, `g${i}.txt`), 'x\n'), `c${i}`);
    assert.ok(net.indexes.has('a'));
    assert.ok(net.indexes.size <= 51, `${net.indexes.size} indexes`);
    finish();
    await slow;
    assert.deepEqual(await net.view('a', file, ['ca']), { net: { added: 1, deleted: 0, created: true, hunks: [{ oldText: null, newText: 'a' }] } });
});
