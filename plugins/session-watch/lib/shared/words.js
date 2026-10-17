/**
 * The suite's words for sessions, one set on every surface (DESIGN.md §9):
 * what state a session is in, whether its last reply asks a person
 * something, and times in plain words.
 *
 * @module suite/shared/words
 */

/** Whether a turn end means DSH stopped under a running turn (a restart, a crash, a reload). */
export function cutOff(end) {
    return Boolean(end) && (end.kind === 'interrupted' || (end.kind === 'aborted' && end.cause === 'disposed'));
}

/**
 * One word (or short phrase) for a session's state.
 * @param {{ status?: string, blank?: boolean, external?: { status: string }, state?: object | null }} row
 */
export function stateWord(row) {
    if (!row) return 'unknown';
    if (row.external?.status) return row.external.status;
    const state = row.state ?? {};
    if (row.status === 'running') return state.approvals?.length ? 'waiting for approval' : 'running';
    if (state.open) return 'cut off';
    const end = state.end;
    if (!end) return row.blank ? 'new' : 'idle';
    if (cutOff(end)) return 'cut off';
    if (end.kind === 'error') return 'failed';
    if (end.kind === 'aborted') return 'stopped';
    if (end.kind === 'blocked') return 'blocked';
    if (end.kind === 'max-tokens') return 'cut short';
    return 'idle';
}

/** A suite decision line: `DECISION NEEDED: <question> — recommend: <pick>` (a hyphen or "--" works too). */
export const DECISION_LINE = /^[\s>*_`-]*DECISION NEEDED\s*[:：]\s*(.+?)\s*(?:(?:—|–|--|-)\s*recommend(?:ation)?\s*[:：]\s*(.+?))?\s*[*_`]*\s*$/im;

/** The question and recommendation of the last decision line in a text, or undefined. */
export function decisionIn(text) {
    if (typeof text !== 'string' || !/DECISION NEEDED/i.test(text)) return undefined;
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const match = DECISION_LINE.exec(lines[i]);
        if (match) {
            const question = match[1].trim();
            if (!question) continue;
            return { question, ...(match[2] ? { recommendation: match[2].trim() } : {}) };
        }
    }
    return undefined;
}

const ASKS = [
    /\bDECISION NEEDED\b/i,
    /^\s*BLOCKED\s*:/im,
    /\b(?:waiting|wait) (?:for|on) (?:your|you)\b/i,
    /\b(?:let me know|your call|your decision|need your|needs your|please confirm|can you confirm|could you confirm)\b/i,
    /\b(?:should I|shall I|do you want|would you like|which (?:one|option) (?:do|would) you)\b/i,
];

/**
 * Whether a reply's end asks a person for something: a decision line, a
 * BLOCKED line, a question at the end, or a plain request for their word.
 * Read from the last few lines only, where an agent asks.
 */
export function asksSomeone(text) {
    if (typeof text !== 'string' || text.trim() === '') return false;
    const lines = text.trim().split('\n').map((line) => line.trim()).filter(Boolean);
    const tail = lines.slice(-6).join('\n');
    if (/\?\s*[*_`)\]]*\s*$/.test(lines.at(-1) ?? '')) return true;
    return ASKS.some((pattern) => pattern.test(tail));
}

/** "9:41 PM" today, "yesterday 9:41 PM", or "Oct 3, 9:41 PM", in this machine's zone. */
export function timeWords(at, now = Date.now()) {
    if (!Number.isFinite(at) || at <= 0) return 'an unknown time';
    const when = new Date(at);
    const clock = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const day = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const today = new Date(now);
    if (day(when) === day(today)) return clock;
    const yesterday = new Date(now - 86400000);
    if (day(when) === day(yesterday)) return `yesterday ${clock}`;
    return `${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock}`;
}

/** "45 seconds", "10 minutes", "2 hours", "3 days". */
export function spanWords(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
    const m = Math.round(s / 60);
    if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h} hour${h === 1 ? '' : 's'}`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'}`;
}

/** "1 open todo", "3 open todos". */
export function count(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
}
