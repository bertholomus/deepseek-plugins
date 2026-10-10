/**
 * A thread's code changes, from DSH's per-turn change summaries: the
 * `workspaceChanges` service behind DSH's "Edited N files +a -d" card.
 * DSH keeps a summary only while its session lives in the running Host,
 * so the plugin stores each one it hears of with the thread: the totals
 * then outlive a DSH restart, though DSH can no longer show their diff.
 * Pure functions.
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
