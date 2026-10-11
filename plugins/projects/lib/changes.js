/**
 * A thread's code changes: per turn, the files it changed and lines added
 * and deleted, counted from its own file-tool records (below), in the
 * shape of DSH's per-turn change summaries (the `workspaceChanges` service
 * behind DSH's "Edited N files +a -d" card). The plugin stores them with
 * the thread, so the totals outlive a DSH restart; DSH keeps its own
 * summary, which Review opens, only while the session lives in the
 * running Host. Pure functions.
 *
 * @module dsh-plugin-projects/changes
 */

/** Records kept per thread (older turns fold into one) and files kept per record. */
export const MAX_TURNS = 40;
export const MAX_FILES = 100;

const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : 0);

/**
 * One turn's summary as the store keeps it.
 * @param {number} seq - the `workspace/changes` event that announced it.
 * @param {object} summary - DSH's summary: {turn, files: [{path, display, added, deleted, binary?, oversized?}], total, added, deleted}.
 * @returns {{turn, seq, added, deleted, total, files: Array<{path, added, deleted, binary?, oversized?}>}|null}
 */
export function changeRecord(seq, summary) {
    if (!Number.isSafeInteger(seq) || summary === null || typeof summary !== 'object' || !Number.isSafeInteger(summary.turn)) return null;
    const files = (Array.isArray(summary.files) ? summary.files : []).slice(0, MAX_FILES).map((f) => ({
        path: String(f?.display ?? f?.path ?? '').slice(0, 300),
        added: count(f?.added),
        deleted: count(f?.deleted),
        ...(f?.binary === true ? { binary: true } : {}),
        ...(f?.oversized === true ? { oversized: true } : {}),
    }));
    return { turn: summary.turn, seq, added: count(summary.added), deleted: count(summary.deleted), total: Math.max(count(summary.total), files.length), files };
}

/**
 * A thread's records with one turn's newest summary in place of an earlier
 * one (DSH announces a turn again when its changes change); a summary
 * without files drops the turn. Past MAX_TURNS the two oldest records fold
 * into one, so the totals still count every turn.
 */
export function withChange(records, record) {
    const rest = (Array.isArray(records) ? records : []).filter((r) => r?.turn !== record.turn);
    if (record.total > 0) rest.push(record);
    rest.sort((a, b) => a.seq - b.seq);
    while (rest.length > MAX_TURNS) rest.splice(0, 2, folded(rest[0], rest[1]));
    return rest;
}

/** Two records as one, in the later one's place: lines summed, files merged by path, `turns` counting both. */
function folded(a, b) {
    const byPath = new Map();
    for (const f of [...(Array.isArray(a.files) ? a.files : []), ...(Array.isArray(b.files) ? b.files : [])]) {
        const was = byPath.get(f?.path);
        byPath.set(f?.path, was ? { ...was, added: count(was.added) + count(f.added), deleted: count(was.deleted) + count(f.deleted) } : f);
    }
    const files = [...byPath.values()].slice(0, MAX_FILES);
    const unlisted = (r) => Math.max(0, count(r.total) - (Array.isArray(r.files) ? r.files.length : 0));
    return {
        turn: b.turn, seq: b.seq, added: count(a.added) + count(b.added), deleted: count(a.deleted) + count(b.deleted),
        total: byPath.size + unlisted(a) + unlisted(b), files, turns: turnsIn(a) + turnsIn(b),
    };
}

/** How many turns a record stands for (more than one once older turns fold into it). */
const turnsIn = (r) => (Number.isSafeInteger(r?.turns) && r.turns > 1 ? r.turns : 1);

/**
 * A thread's changes over all its turns: lines added and deleted (summed
 * over the turns, as each turn's card counts them), how many files, and
 * the newest turn that changed files (`last`, what DSH's Review tab opens).
 * null when it changed nothing.
 */
export function changeTotals(records) {
    const list = Array.isArray(records) ? records.filter((r) => r && Number.isSafeInteger(r.seq) && Number.isSafeInteger(r.turn)) : [];
    if (list.length === 0) return null;
    const paths = new Set();
    let added = 0;
    let deleted = 0;
    let unlisted = 0;
    let turns = 0;
    for (const r of list) {
        turns += turnsIn(r);
        added += count(r.added);
        deleted += count(r.deleted);
        const files = Array.isArray(r.files) ? r.files : [];
        for (const f of files) paths.add(f?.path);
        unlisted += Math.max(0, count(r.total) - files.length);
    }
    const last = list[list.length - 1];
    return { added, deleted, files: paths.size + unlisted, turns, last: { seq: last.seq, turn: last.turn } };
}

/** "changed 2 files (+18 -3)", or '' when there is nothing to say. */
export function changesLine(totals) {
    if (!totals || !(totals.files > 0)) return '';
    return `changed ${totals.files} file${totals.files === 1 ? '' : 's'} (+${totals.added} -${totals.deleted})`;
}

/**
 * A thread's own edits. DSH's per-turn summary diffs the whole folder, so
 * threads sharing a folder would be credited with each other's edits: the
 * plugin counts a thread's changes from its own file-tool records (and its
 * subagents') instead, and keeps them in the records above, one per turn.
 * A shell command's edits aren't in its records, so they don't count yet.
 */

/** DSH's file tools whose records say what they changed. */
export const FILE_TOOLS = new Set(['write', 'edit', 'str_replace_editor']);

/** Past this many cells (lines × lines), a hunk's middle counts whole instead of being matched line by line. */
const MATCH_CELLS = 4_000_000;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = (value) => (typeof value === 'string' ? value : '');

/** A file's text as lines, the way git counts them: '' has none, and a final newline ends the last line. */
function fileLines(text) {
    if (typeof text !== 'string' || text === '') return [];
    const body = text.replace(/\r\n?/g, '\n');
    return (body.endsWith('\n') ? body.slice(0, -1) : body).split('\n');
}

/** A hunk's side as lines (DSH joins them with '\n'); null or '' has none. */
const hunkLines = (text) => (typeof text === 'string' && text !== '' ? text.split('\n') : []);

/** How many lines two lists share in order (a longest common subsequence), in two rows. */
function commonLines(a, b) {
    let prev = new Uint32Array(b.length + 1);
    let row = new Uint32Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) row[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], row[j - 1]);
        [prev, row] = [row, prev];
    }
    return prev[b.length];
}

/**
 * Lines added and deleted from one list of lines to another, as a diff
 * counts them: the lines both keep in order stay, the rest of the old
 * ones are deleted and the rest of the new ones added.
 */
export function lineDelta(before, after) {
    const a = Array.isArray(before) ? before : [];
    const b = Array.isArray(after) ? after : [];
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let end = 0;
    while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
    const x = a.slice(start, a.length - end);
    const y = b.slice(start, b.length - end);
    const same = x.length > 0 && y.length > 0 && x.length * y.length <= MATCH_CELLS ? commonLines(x, y) : 0;
    return { added: y.length - same, deleted: x.length - same };
}

/**
 * What one successful file-tool call changed: its file, and lines added
 * and deleted. DSH's `write` and `edit` keep their hunks (with three lines
 * of context) in the result's `meta.diffs`, and a new file's text is the
 * call's `content`; `str_replace_editor` keeps only its arguments.
 * @returns {{path: string, added: number, deleted: number, created?: true}|null} null when it changed nothing countable.
 */
export function editOf(name, args, meta) {
    const a = isObject(args) ? args : {};
    const m = isObject(meta) ? meta : {};
    const pathOf = (...values) => values.map((v) => (typeof v === 'string' ? v.trim() : '')).find((v) => v !== '') ?? '';
    if (name === 'write' || name === 'edit') {
        const path = pathOf(m.path, a.file_path);
        if (!path) return null;
        if (name === 'write' && m.operation === 'create') return { path, added: fileLines(textOf(a.content)).length, deleted: 0, created: true };
        if (!Array.isArray(m.diffs)) return null;
        let added = 0;
        let deleted = 0;
        for (const hunk of m.diffs) {
            if (!isObject(hunk)) continue;
            const n = lineDelta(hunkLines(hunk.oldText), hunkLines(hunk.newText));
            added += n.added;
            deleted += n.deleted;
        }
        return { path, added, deleted };
    }
    if (name === 'str_replace_editor') {
        const path = pathOf(a.path);
        if (!path) return null;
        switch (a.command) {
            case 'create': return { path, added: fileLines(textOf(a.file_text)).length, deleted: 0, created: true };
            case 'str_replace': return { path, ...lineDelta(fileLines(textOf(a.old_str)), fileLines(textOf(a.new_str))) };
            case 'insert': return { path, added: fileLines(textOf(a.new_str)).length, deleted: 0 };
            default: return null;
        }
    }
    return null;
}

/** A tool call's arguments, which DSH may keep as JSON text. */
function argsOf(value) {
    if (typeof value !== 'string') return isObject(value) ? value : {};
    try { return JSON.parse(value); } catch { return {}; }
}

/**
 * The edits in a session's records, in order: each successful file-tool
 * call (its `tool/call` and then its `tool/result`) as an edit with the
 * turn it ran in and its result's seq. Failed calls changed nothing.
 * @returns {Array<{turn: number, seq: number, path: string, added: number, deleted: number, created?: true}>}
 */
export function editsIn(events) {
    const calls = new Map();
    const out = [];
    for (const event of Array.isArray(events) ? events : []) {
        if (event?.type === 'tool/call') {
            const d = event.data;
            if (FILE_TOOLS.has(d?.name) && typeof d.callId === 'string') calls.set(d.callId, { name: d.name, args: d.arguments, turn: d.turn });
            continue;
        }
        if (event?.type !== 'tool/result') continue;
        const message = event.data?.message;
        const callId = message?.toolCallId ?? message?.source?.callId;
        const call = calls.get(callId);
        if (!call) continue;
        calls.delete(callId);
        if (message?.isError === true || event.data?.error !== undefined) continue;
        const edit = editOf(call.name, argsOf(call.args), event.data?.meta);
        if (!edit || !(edit.added + edit.deleted > 0 || edit.created)) continue;
        const turn = Number.isSafeInteger(event.data?.turn) ? event.data.turn : call.turn;
        if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(event.seq)) continue;
        out.push({ turn, seq: event.seq, ...edit });
    }
    return out;
}

/**
 * Edits as one summary in the shape of DSH's per-turn summary, which
 * `changeRecord` keeps: each file once, its lines summed over its edits,
 * a path inside the folder written relative to it.
 * @param {string} [folder] - the thread's folder.
 * @returns {{turn, files: Array<{path, added, deleted}>, total, added, deleted}|null} null when nothing changed.
 */
export function editSummary(turn, edits, folder = '') {
    const root = typeof folder === 'string' ? folder.replace(/\/+$/, '') : '';
    const place = (path) => {
        const p = root !== '' && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
        return p.replace(/^(\.\/)+/, '');
    };
    const byPath = new Map();
    for (const e of Array.isArray(edits) ? edits : []) {
        if (typeof e?.path !== 'string' || e.path === '') continue;
        const path = place(e.path);
        const was = byPath.get(path) ?? { path, added: 0, deleted: 0 };
        byPath.set(path, { path, added: was.added + count(e.added), deleted: was.deleted + count(e.deleted) });
    }
    if (byPath.size === 0) return null;
    const files = [...byPath.values()];
    return { turn, files, total: files.length, added: files.reduce((n, f) => n + f.added, 0), deleted: files.reduce((n, f) => n + f.deleted, 0) };
}
