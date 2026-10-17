/**
 * What Decisions lists, as pure functions over what the suite already
 * knows: the watcher's rows (each session's state, with the ask at the end
 * of its last reply), DSH's question-box projection, the coordinator's
 * thread roster, and the questions suite plugins raise. No DSH imports, so
 * the rules are tested without DSH.
 *
 * A card is one thing waiting on a person:
 *
 *     { id, kind, sessionId, title, question, recommendation?, detail?,
 *       at, running, answer, ... }
 *
 * `kind` is what it is (KINDS); `answer` is how Decisions answers it:
 * 'approval' (Allow once or Reject), 'questions' (the question box's
 * choices), 'text' (words sent into the session), 'ask' (a suite plugin's
 * own options), or 'open' (only the session itself can answer it).
 *
 * @module dsh-plugin-decisions/cards
 */
import { clip, isRecord } from './shared/safe.js';
import { cutOff } from './shared/words.js';

/** Every kind of card, most urgent first: approvals and questions hold a running turn. */
export const KINDS = Object.freeze(['approval', 'question', 'ask', 'decision', 'blocked', 'thread', 'reply']);

/** A card's kind in a word or two, as the page and notifications say it. */
export const KIND_WORDS = Object.freeze({
    approval: 'Approval',
    question: 'Question',
    ask: 'Asks you',
    decision: 'Decision',
    blocked: 'Blocked',
    thread: 'Thread',
    reply: 'Asked you',
});

/** The sessions Decisions reads: a subagent's asks go to its parent, not to the person. */
export const readable = (row) => isRecord(row) && typeof row.sessionId === 'string' && !row.parentSessionId && row.origin !== 'subagent';

/** Turn ends after which the reply's ask stands. */
const ASK_ENDS = new Set(['completed', 'blocked', 'aborted', 'max-tokens']);

const titleOf = (row) => (typeof row?.title === 'string' && row.title.trim() ? row.title.trim() : 'Untitled session');

/**
 * The card for what a session's last reply asks: a DECISION NEEDED line, a
 * BLOCKED line, or (with `replies`) a plain question. None while the
 * session runs, when anything was written in since the turn ended (the
 * person answered, or a plugin's note moved it on), or when the turn ended
 * longer than `windowMs` ago.
 * @param {object} row - a watcher row (`sessionWatch.list()`).
 * @param {{ replies?: boolean, windowMs?: number, now?: number }} [options]
 */
export function replyCard(row, { replies = true, windowMs = 0, now = Date.now() } = {}) {
    const state = row?.state;
    const ask = state?.ask;
    const end = state?.end;
    if (!readable(row) || !isRecord(ask) || !isRecord(end) || state.open || row.status === 'running') return undefined;
    if (ask.turn !== end.turn || !ASK_ENDS.has(end.kind) || cutOff(end)) return undefined;
    const endAt = Number(end.at) || 0;
    if (Math.max(Number(state.inAt) || 0, Number(state.userAt) || 0) > endAt) return undefined;
    if (windowMs > 0 && endAt > 0 && now - endAt > windowMs) return undefined;
    const kind = ask.kind === 'decision' ? 'decision' : ask.kind === 'blocked' ? 'blocked' : 'reply';
    if (kind === 'reply' && !replies) return undefined;
    return {
        id: `${kind}:${row.sessionId}:${end.turn}`,
        kind,
        sessionId: row.sessionId,
        title: titleOf(row),
        ...(row.cwd ? { cwd: row.cwd } : {}),
        question: String(ask.question ?? ''),
        ...(ask.recommendation ? { recommendation: String(ask.recommendation) } : {}),
        turn: end.turn,
        at: endAt,
        running: false,
        answer: 'text',
    };
}

/** One question-box question, made safe for the window. */
export function questionOf(item) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.question !== 'string') return undefined;
    const options = Array.isArray(item.options)
        ? item.options.filter((o) => isRecord(o) && typeof o.label === 'string' && o.label !== '').slice(0, 20)
            .map((o) => ({ label: o.label.slice(0, 200), ...(typeof o.description === 'string' && o.description ? { description: clip(o.description, 300) } : {}) }))
        : [];
    return {
        id: item.id.slice(0, 120),
        question: item.question.slice(0, 1000),
        ...(typeof item.header === 'string' && item.header ? { header: clip(item.header, 80) } : {}),
        ...(typeof item.detail === 'string' && item.detail ? { detail: item.detail.slice(0, 4000) } : {}),
        options,
        multiSelect: item.multiSelect === true || item.multi_select === true,
        ...(isRecord(item.intent) && typeof item.intent.kind === 'string' ? { intent: item.intent.kind } : {}),
    };
}

/** The question-box calls in a session's `userQuestions` value (DSH's live state or its saved view). */
export function activeQuestions(value) {
    const view = isRecord(value?.questions) && Array.isArray(value.questions.active) ? value.questions : value;
    return Array.isArray(view?.active) ? view.active.filter((q) => isRecord(q) && typeof q.callId === 'string' && Array.isArray(q.questions)) : [];
}

/**
 * Cards for a session's question-box calls that DSH keeps answerable: a
 * call whose wait ran out ("continued") is answered through DSH's question
 * service; one still in its first wait that Decisions does not hold is
 * answered in its session.
 * @param {object} row
 * @param {{ value: any } | undefined} projection - `sessionWatch.projection(id, 'userQuestions')`.
 */
export function questionCards(row, projection) {
    if (!readable(row) || !projection) return [];
    const cards = [];
    for (const call of activeQuestions(projection.value)) {
        const questions = call.questions.map(questionOf).filter(Boolean);
        if (questions.length === 0) continue;
        const continued = call.state === 'continued';
        cards.push({
            id: `question:${row.sessionId}:${call.callId}`,
            kind: 'question',
            sessionId: row.sessionId,
            title: titleOf(row),
            callId: call.callId,
            questions,
            question: questions[0].question,
            ...(questions.length > 1 ? { more: questions.length - 1 } : {}),
            at: 0,
            running: row.status === 'running',
            answer: continued ? 'questions' : 'open',
            ...(continued ? { late: true } : {}),
        });
    }
    return cards;
}

/** The coordinator's view of a session (`coordinatorSession`), from its live state or its saved view. */
export function coordinatorView(value) {
    if (!isRecord(value)) return undefined;
    if (typeof value.role === 'string') return value;
    return isRecord(value.v) && typeof value.v.role === 'string' ? value.v : undefined;
}

/** Handback statuses that wait on a person. */
const WAITING = new Set(['needs_decision', 'blocked']);

/**
 * Cards for a coordinating chat's threads that handed back needing a
 * decision (or blocked) and have heard nothing since: no message to the
 * thread after the handback, the thread not running, not resolved.
 * @param {object} row - the coordinating chat's watcher row.
 * @param {{ value: any } | undefined} projection - `sessionWatch.projection(id, 'coordinatorSession')`.
 * @param {Map<string, object>} rowsById - every watcher row, for the threads' own sessions.
 */
export function threadCards(row, projection, rowsById) {
    const view = coordinatorView(projection?.value);
    if (!readable(row) || view?.role !== 'coordinator' || view.off) return [];
    const cards = [];
    for (const thread of Array.isArray(view.threads) ? view.threads : []) {
        if (!isRecord(thread) || thread.resolved || typeof thread.session !== 'string' || !isRecord(thread.handback)) continue;
        if (!WAITING.has(thread.handback.status)) continue;
        // The newest card about the thread must be its handback: a later send means the chat already answered it.
        const about = (Array.isArray(view.cards) ? view.cards : []).filter((card) => isRecord(card) && card.thread === thread.id);
        if (about.length && about.at(-1).kind !== 'handback') continue;
        const own = rowsById?.get(thread.session);
        if (own?.status === 'running') continue;
        const at = Date.parse(thread.handback.at) || 0;
        if (own?.state && at > 0 && Math.max(Number(own.state.inAt) || 0, Number(own.state.userAt) || 0) > at) continue;
        cards.push({
            id: `thread:${thread.session}:${at || thread.id}`,
            kind: 'thread',
            sessionId: thread.session,
            title: clip(String(thread.title ?? 'Thread'), 120) || 'Thread',
            via: { sessionId: row.sessionId, title: titleOf(row) },
            status: thread.handback.status,
            question: String(thread.handback.summary ?? '').trim() || (thread.handback.status === 'blocked' ? 'The thread is blocked.' : 'The thread needs a decision.'),
            at,
            running: false,
            answer: 'text',
        });
    }
    return cards;
}

/** A card for a question a suite plugin raised through the watcher (Autopilot's Ask first, an agent in a terminal). */
export function askCard(ask, rowsById) {
    if (!isRecord(ask) || typeof ask.id !== 'string' || typeof ask.question !== 'string') return undefined;
    const row = typeof ask.sessionId === 'string' ? rowsById?.get(ask.sessionId) : undefined;
    const options = Array.isArray(ask.options) ? ask.options.filter((o) => isRecord(o) && typeof o.id === 'string' && typeof o.label === 'string').slice(0, 6) : [];
    return {
        id: `ask:${ask.id}`,
        kind: 'ask',
        askId: ask.id,
        ...(typeof ask.sessionId === 'string' ? { sessionId: ask.sessionId } : {}),
        title: typeof ask.title === 'string' && ask.title ? ask.title : row ? titleOf(row) : '',
        source: typeof ask.source === 'string' ? ask.source : 'A plugin',
        question: ask.question,
        ...(typeof ask.recommendation === 'string' && ask.recommendation ? { recommendation: ask.recommendation } : {}),
        ...(typeof ask.why === 'string' && ask.why ? { detail: ask.why } : {}),
        options,
        freeText: ask.freeText === true,
        at: Number(ask.at) || 0,
        running: row?.status === 'running',
        answer: 'ask',
    };
}

/** Cards in the order the page lists them: what holds a running turn first, then oldest first. */
export function byUrgency(a, b) {
    const live = (card) => (card.answer === 'approval' || (card.kind === 'question' && card.live) ? 0 : 1);
    return live(a) - live(b) || (a.at || Infinity) - (b.at || Infinity) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.id.localeCompare(b.id);
}

const LEADS = {
    decision: 'your DECISION NEEDED line',
    blocked: 'your BLOCKED line',
    reply: 'your question',
};

/**
 * The message an answer puts into the session: a tagged first line that
 * says what it answers, then the person's words as they wrote them.
 * @param {object} card
 * @param {{ text?: string, recommended?: boolean }} answer
 */
export function answerMessage(card, { text, recommended } = {}) {
    const lead = card.kind === 'thread' ? 'your handback' : LEADS[card.kind] ?? 'your question';
    const what = clip(String(card.question ?? ''), 300);
    if (recommended) {
        return `[Decisions] The person answered ${lead} (“${what}”): go with your recommendation${card.recommendation ? ` (${clip(card.recommendation, 300)})` : ''}.`;
    }
    return `[Decisions] The person answered ${lead} (“${what}”):\n\n${String(text ?? '').trim()}`;
}

/** Longest typed answer Decisions sends. */
export const ANSWER_MAX = 8000;

/**
 * Check a question-box answer against its questions and give it in DSH's
 * shape (`{ answers: [{ id, selected, custom? }] }`). A question with no
 * choice and no words is skipped, as DSH's own card skips it.
 * @throws {Error} in words, when the answer does not fit the questions.
 */
export function checkAnswers(questions, answers) {
    if (!Array.isArray(answers)) throw new Error('Send one answer for each question.');
    const given = new Map();
    for (const item of answers) {
        if (!isRecord(item) || typeof item.id !== 'string') throw new Error('Each answer names its question.');
        if (given.has(item.id)) throw new Error('Each question takes one answer.');
        given.set(item.id, item);
    }
    const out = [];
    for (const question of questions) {
        const item = given.get(question.id);
        if (!item) throw new Error(`Answer “${clip(question.question, 80)}”, or skip it.`);
        given.delete(question.id);
        const selected = Array.isArray(item.selected) ? item.selected.filter((s) => typeof s === 'string') : [];
        const labels = new Set((question.options ?? []).map((o) => o.label));
        for (const label of selected) if (!labels.has(label)) throw new Error(`“${clip(label, 60)}” is not one of the choices.`);
        if (!question.multiSelect && selected.length > 1) throw new Error(`Pick one choice for “${clip(question.question, 80)}”.`);
        const custom = typeof item.custom === 'string' && item.custom.trim() ? item.custom.trim().slice(0, ANSWER_MAX) : undefined;
        out.push({ id: question.id, selected, ...(custom ? { custom } : {}) });
    }
    if (given.size > 0) throw new Error('An answer names a question that was not asked.');
    return { answers: out };
}

/** A question-box answer in a few words, for the history ("staging", "skipped"). */
export function answerWords(answers) {
    const parts = (answers ?? []).map((a) => [...(a.selected ?? []), ...(a.custom ? [a.custom] : [])].join(', ') || 'skipped');
    return clip(parts.join('; '), 200);
}

/** The heading a notification or a mirrored message gives a card. */
export function headline(card) {
    const where = card.title ? `“${clip(card.title, 80)}”` : 'a session';
    switch (card.kind) {
        case 'approval': return `${where} waits for your approval`;
        case 'question': return `${where} asks you a question`;
        case 'decision': return `${where} needs a decision`;
        case 'blocked': return `${where} is blocked`;
        case 'thread': return `Thread ${where} ${card.status === 'blocked' ? 'is blocked' : 'needs a decision'}`;
        case 'ask': return `${card.source ?? 'A plugin'} asks about ${where}`;
        default: return `${where} asked you something`;
    }
}

/**
 * What a card is, without its session's title, for a history row (which
 * links the session beside it): "Needs a decision", "Blocked".
 */
export function lead(card) {
    switch (card.kind) {
        case 'approval': return 'Waiting for your approval';
        case 'question': return 'Asked you a question';
        case 'decision': return 'Needs a decision';
        case 'blocked': return 'Blocked';
        case 'thread': return card.status === 'blocked' ? 'The thread is blocked' : 'The thread needs a decision';
        case 'ask': return `${card.source ?? 'A plugin'} asked you`;
        default: return 'Asked you something';
    }
}

/** Cut text to `max` characters, keeping its lines. */
export function cutLines(text, max) {
    const value = String(text ?? '').trim();
    return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** The plain text a mirror sends for a card. */
export function mirrorText(card) {
    const lines = [headline(card), clip(String(card.question ?? ''), 900)];
    if (card.recommendation) lines.push(`Recommended: ${clip(card.recommendation, 300)}`);
    if (card.via?.title) lines.push(`In “${clip(card.via.title, 80)}”.`);
    lines.push('Answer it in DSH: Decisions.');
    return lines.join('\n');
}
