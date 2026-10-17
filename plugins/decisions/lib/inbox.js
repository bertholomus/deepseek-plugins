/**
 * The inbox: everything waiting on a person, kept current from the
 * watcher's events, and Decisions' ways to answer it.
 *
 * Cards come from what the suite already knows (lib/cards.js): the ask at
 * the end of each session's last reply, DSH's question box, the
 * coordinator's thread roster, approvals, and the questions suite plugins
 * raise. Approvals and question-box calls asked while Decisions runs are
 * also held (lib/holds.js), so they can be answered here as well as in the
 * session.
 *
 * Nothing polls: the watcher's events start a scan, which finds new cards,
 * tells the person (the notifications plugin, the mirror) once per card
 * across restarts, and moves the page's channel. Every answer is logged
 * when it goes and again when the session's own log proves it arrived (or
 * shows it did not); a failed answer puts the card back with the reason.
 *
 * @module dsh-plugin-decisions/inbox
 */
import { clip, errorText, isRecord, later } from './shared/safe.js';
import { plainError } from './shared/words.js';
import { APPROVAL_ANSWERS, Holds, approvalProof, approvalWords, lateAnswerProof, questionProof } from './holds.js';
import { ANSWER_MAX, answerMessage, answerWords, askCard, byUrgency, checkAnswers, coordinatorView, headline, lead, questionCards, readable, replyCard, threadCards } from './cards.js';

/** Ids kept per list in the store (the newest). */
const KEEP = 600;

/** More new cards than this at once make one notification, not one each. */
const NOTIFY_EACH = 3;

/** How long an answer may take to show in the session's log before it is reported unconfirmed. */
const PROOF_MS = 10 * 60 * 1000;

/** A stored id list: `{ [cardId]: ms }`, only well-formed entries. */
function idMap(value) {
    if (!isRecord(value)) return {};
    const out = {};
    for (const [id, at] of Object.entries(value)) if (typeof id === 'string' && id.length <= 400 && Number.isFinite(at)) out[id] = at;
    return out;
}

/** Make a stored value safe. */
export function parseData(value) {
    return {
        version: 1,
        seeded: value?.seeded === true,
        seen: idMap(value?.seen),
        dismissed: idMap(value?.dismissed),
        answered: idMap(value?.answered),
    };
}

/** Keep the newest `keep` ids of a map. */
function trimmed(map, keep = KEEP) {
    const entries = Object.entries(map);
    if (entries.length <= keep) return map;
    return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, keep));
}

/** DSH's question-box refusals in words. */
function questionRefusal(error) {
    switch (error?.code) {
        case 'REPLY_QUEUED': return 'an answer to this question is already waiting to be read';
        case 'BAD_ANSWER': return 'the answer must cover each question once';
        case 'CALLER_NOT_LIVE':
        case 'DELEGATED_CALLER': return 'the session cannot take answers right now; open it and answer there';
        default: return plainError(errorText(error, 200));
    }
}

const sessionWords = (card) => (card.title ? `“${clip(card.title, 80)}”` : 'the session');

export class Inbox {
    /**
     * @param {object} options
     * @param {import('../../session-watch/lib/watch.js').SessionWatch} options.watch
     * @param {object} options.config
     * @param {import('./shared/files.js').JsonStore} options.store
     * @param {import('./shared/journal.js').Journal} options.journal
     * @param {{ warn: Function }} [options.logger]
     * @param {(item: object) => void} [options.notify]
     * @param {import('./mirror.js').Mirror} [options.mirror]
     * @param {() => any} [options.questions] - DSH's question service, when it runs.
     * @param {() => void} [options.changed] - what the page shows changed.
     * @param {() => number} [options.now]
     * @param {typeof later} [options.after]
     */
    constructor({ watch, config, store, journal, logger, notify, mirror, questions, changed, now = Date.now, after = later }) {
        this.watch = watch;
        this.config = config;
        this.store = store;
        this.journal = journal;
        this.logger = logger;
        this.notify = notify;
        this.mirror = mirror;
        this.questions = questions ?? (() => undefined);
        this.changedHook = changed;
        this.now = now;
        this.after = after;
        this.holds = new Holds({ logger, now, titleOf: (id) => attemptTitle(watch, id), onChange: (change) => this.onHold(change) });
        /** Card ids an answer is on its way to. */
        this.answering = new Set();
        /** The reason an answer failed, by card id, until the card goes or is answered again. */
        this.errors = new Map();
        /** Answers waiting for the session's log to prove them. */
        this.proofs = new Set();
        this.started = false;
        this.scanning = false;
        this.again = false;
        this.queued = false;
        this.print = '';
    }

    changed() {
        try { this.changedHook?.(); } catch { /* the page refreshes on its next change */ }
    }

    // ── Life ───────────────────────────────────────────────────────────

    start() {
        if (this.started) return;
        this.started = true;
        this.holds.resume();
        this.off = this.watch.on((event) => this.onWatch(event));
        this.soon(0);
    }

    stop() {
        this.started = false;
        this.off?.();
        this.off = undefined;
        this.holds.stop();
        this.proofs.clear();
    }

    onWatch(event) {
        if (!this.started || !isRecord(event)) return;
        if (typeof event.sessionId === 'string') for (const proof of [...this.proofs]) if (proof.sessionId === event.sessionId) this.prove(proof);
        if (event.type === 'delivery') return;
        this.soon();
    }

    /** Scan shortly: events come in bursts, one scan follows them. */
    soon(ms = 400) {
        if (!this.started || this.queued) return;
        this.queued = true;
        this.after(this.logger, 'decisions: scan', ms, () => {
            this.queued = false;
            return this.scan();
        });
    }

    onHold(change) {
        if (change.type === 'held') {
            this.soon(30);
            this.changed();
            return;
        }
        const card = change.card;
        // A question whose wait ran out stays open as a late question; nothing to log.
        if (change.by === 'window' && this.started && change.code !== 'ASK_TIMED_OUT') {
            const answered = change.error === undefined;
            this.journal.add({
                kind: 'elsewhere',
                cardId: card.id,
                sessionId: card.sessionId,
                title: card.title,
                text: answered ? `Answered in the session: ${card.kind === 'approval' ? (change.value === 'allowed-once' ? 'allowed once' : change.value === 'rejected' ? 'rejected' : String(change.value ?? '')) : 'the question box'}` : 'The turn stopped before anyone answered',
                question: card.question,
                state: answered ? 'answered' : 'stopped',
            });
        }
        this.soon(30);
        this.changed();
    }

    // ── Cards ──────────────────────────────────────────────────────────

    /**
     * Everything waiting, most urgent first, and what the person dismissed.
     * Never throws: what cannot be read is left out.
     * @returns {Promise<{ waiting: object[], dismissed: object[] }>}
     */
    async list() {
        const config = this.config;
        const now = this.now();
        const windowMs = config.windowHours * 3600000;
        const data = this.store.data;
        let rows = [];
        try { rows = await this.watch.list(); } catch (error) { this.logger?.warn?.(`decisions: could not read the sessions: ${errorText(error)}`); }
        const byId = new Map(rows.map((row) => [row.sessionId, row]));
        const found = new Map();
        const add = (card) => { if (card && !found.has(card.id)) found.set(card.id, card); };
        // A held request's title as DSH lists it now (a new session's title may come after its first request).
        for (const card of this.holds.cards()) if (config[card.kind === 'approval' ? 'approvals' : 'questions'] !== false) add({ ...card, title: byId.get(card.sessionId)?.title || card.title });
        for (const row of rows) {
            if (!readable(row)) continue;
            try {
                if (config.approvals && row.status === 'running') {
                    for (const item of row.state?.approvals ?? []) {
                        const words = approvalWords({ toolName: item.tool, reason: item.reason });
                        add({
                            id: `approval:${row.sessionId}:${item.call ?? item.id}`,
                            kind: 'approval',
                            sessionId: row.sessionId,
                            title: row.title || 'Untitled session',
                            tool: item.tool,
                            question: words.question,
                            ...(words.why ? { detail: words.why } : {}),
                            at: Number(item.at) || 0,
                            running: true,
                            answer: 'open',
                        });
                    }
                }
                if (config.questions) {
                    for (const card of questionCards(row, this.watch.projection?.(row.sessionId, 'userQuestions'))) {
                        if (card.answer === 'open' && row.status !== 'running') continue;
                        if (card.answer === 'questions' && windowMs > 0 && now - (Number(row.updatedAt) || 0) > windowMs) continue;
                        add(card);
                    }
                }
                add(replyCard(row, { replies: config.replies, windowMs, now }));
                if (config.threads) for (const card of threadCards(row, this.watch.projection?.(row.sessionId, 'coordinatorSession'), byId)) add(card);
            } catch (error) {
                this.logger?.warn?.(`decisions: could not read ${row.sessionId}: ${errorText(error)}`);
            }
        }
        for (const ask of this.watch.asks?.() ?? []) add(askCard(ask, byId));
        // A thread's handback and its own last reply say the same thing: keep the handback, with any recommendation.
        const threads = new Map([...found.values()].filter((card) => card.kind === 'thread').map((card) => [card.sessionId, card]));
        for (const card of [...found.values()]) {
            const thread = threads.get(card.sessionId);
            if (!thread || !['decision', 'blocked', 'reply'].includes(card.kind)) continue;
            found.delete(card.id);
            if (card.recommendation && !thread.recommendation) thread.recommendation = card.recommendation;
        }
        const waiting = [];
        const dismissed = [];
        for (const card of found.values()) {
            if (Object.hasOwn(data.answered, card.id) && !this.errors.has(card.id)) continue;
            const item = {
                ...card,
                at: card.at || data.seen[card.id] || now,
                ...(this.errors.has(card.id) ? { error: this.errors.get(card.id) } : {}),
                ...(this.answering.has(card.id) ? { sending: true } : {}),
            };
            if (Object.hasOwn(data.dismissed, card.id)) dismissed.push({ ...item, dismissedAt: data.dismissed[card.id] });
            else waiting.push(item);
        }
        for (const id of [...this.errors.keys()]) if (!found.has(id)) this.errors.delete(id);
        waiting.sort(byUrgency);
        dismissed.sort((a, b) => b.dismissedAt - a.dismissedAt);
        return { waiting, dismissed };
    }

    /** Find new cards, tell the person about them once, and move the page. */
    async scan() {
        if (!this.started) return;
        if (this.scanning) {
            this.again = true;
            return;
        }
        this.scanning = true;
        try {
            const { waiting, dismissed } = await this.list();
            const data = this.store.data;
            const now = this.now();
            const fresh = waiting.filter((card) => !Object.hasOwn(data.seen, card.id));
            for (const card of [...fresh, ...dismissed.filter((c) => !Object.hasOwn(data.seen, c.id))]) data.seen[card.id] = card.at || now;
            if (fresh.length) data.seen = trimmed(data.seen);
            if (!data.seeded) {
                // The first look after install: what waits already is listed, not announced.
                data.seeded = true;
                this.store.change();
            } else if (fresh.length) {
                this.store.change();
                this.announce(fresh);
            }
            const print = waiting.map((c) => `${c.id}|${c.running ? 1 : 0}|${c.error ?? ''}`).join('\n');
            if (print !== this.print) {
                this.print = print;
                this.changed();
            }
        } catch (error) {
            this.logger?.warn?.(`decisions: scan failed: ${errorText(error)}`);
        } finally {
            this.scanning = false;
            if (this.again) {
                this.again = false;
                this.soon(50);
            }
        }
    }

    /** Log new cards, and tell the person: notifications (unless the raising plugin tells them itself) and the mirror. */
    announce(cards) {
        for (const card of cards) {
            this.journal.add({
                kind: 'new',
                cardId: card.id,
                ...(card.sessionId ? { sessionId: card.sessionId } : {}),
                title: card.title ?? '',
                // The row links the session, so its title is not said twice.
                text: card.sessionId ? lead(card) : headline(card),
                question: clip(String(card.question ?? ''), 300),
                ...(card.recommendation ? { recommendation: clip(card.recommendation, 200) } : {}),
            });
        }
        if (this.config.notify) {
            // Plugins' questions and threads' handbacks are announced by the plugin that raised them, and so are a thread's approvals.
            const notable = cards.filter((card) => card.kind !== 'ask' && card.kind !== 'thread' && !(card.kind === 'approval' && this.inThread(card.sessionId)));
            if (notable.length > NOTIFY_EACH) {
                this.say({ title: 'Decisions', body: `${notable.length} things wait on you. Open Decisions to answer them.`, kind: 'decision' });
            } else {
                for (const card of notable) this.say({ title: headline(card), body: clip(String(card.question ?? ''), 240), kind: 'decision', ...(card.sessionId ? { sessionId: card.sessionId } : {}) });
            }
        }
        if (this.mirror?.on) {
            for (const card of cards) {
                this.mirror.send(card).then(undefined, (error) => this.logger?.warn?.(`decisions: mirror: ${errorText(error)}`));
            }
        }
    }

    /** Whether a session is a coordinator's thread (the coordinator announces its approvals). */
    inThread(sessionId) {
        try { return coordinatorView(this.watch.projection?.(sessionId, 'coordinatorSession')?.value)?.role === 'thread'; } catch { return false; }
    }

    say(item) {
        try {
            this.notify?.(item);
        } catch (error) {
            this.logger?.warn?.(`decisions: a notification failed: ${errorText(error)}`);
        }
    }

    /** The count the sidebar shows. */
    async badge() {
        const { waiting } = await this.list();
        return { waiting: waiting.length, urgent: waiting.filter((card) => card.answer === 'approval' || card.live).length };
    }

    // ── Answers ────────────────────────────────────────────────────────

    /**
     * Answer a card. `input` by the card's kind:
     * approval `{ decision: 'allow' | 'reject' }`; question box
     * `{ answers: [{ id, selected, custom? }] }`; a reply or a thread
     * `{ text }` or `{ recommended: true }`; a plugin's question
     * `{ option }` or `{ text }`.
     * @returns {Promise<{ state: string }>} where the answer is now.
     * @throws {Error} in words, when the answer cannot go.
     */
    async answer(id, input) {
        if (typeof id !== 'string' || id === '') throw new Error('Name what you are answering.');
        if (!isRecord(input)) throw new Error('The answer is empty.');
        if (this.answering.has(id)) throw new Error('An answer to this is already on its way.');
        const { waiting, dismissed } = await this.list();
        const card = [...waiting, ...dismissed].find((c) => c.id === id);
        if (!card) throw new Error('This is no longer waiting: it was answered, or the session moved on.');
        this.answering.add(id);
        this.errors.delete(id);
        this.changed();
        try {
            switch (card.answer) {
                case 'approval': return this.answerApproval(card, input);
                case 'questions': return await this.answerQuestions(card, input);
                case 'text': return await this.answerText(card, input);
                case 'ask': return await this.answerAsk(card, input);
                default: throw new Error('Only the session can answer this: open it and answer there.');
            }
        } finally {
            this.answering.delete(id);
            this.soon(30);
            this.changed();
        }
    }

    answered(card) {
        const data = this.store.data;
        data.answered[card.id] = this.now();
        data.answered = trimmed(data.answered);
        delete data.dismissed[card.id];
        this.store.change();
    }

    /** An answer that was taken failed later: the card comes back, saying why. */
    failed(card, reason) {
        delete this.store.data.answered[card.id];
        this.store.change();
        this.errors.set(card.id, reason);
        this.soon(30);
        this.changed();
    }

    logAnswer(card, fields) {
        return this.journal.add({
            kind: 'answer',
            cardId: card.id,
            cardKind: card.kind,
            ...(card.sessionId ? { sessionId: card.sessionId } : {}),
            title: card.title ?? '',
            question: clip(String(card.question ?? ''), 300),
            by: 'you',
            ...fields,
        });
    }

    answerApproval(card, input) {
        const outcome = APPROVAL_ANSWERS[input.decision];
        if (!outcome) throw new Error('Choose Allow once or Reject.');
        const entry = this.logAnswer(card, { text: input.decision === 'allow' ? 'Allowed once' : 'Rejected', answer: input.decision === 'allow' ? 'Allow once' : 'Reject', state: 'sending' });
        if (!this.holds.answer(card.id, outcome)) {
            const reason = 'the session answered it first, or its turn stopped';
            this.journal.set(entry.id, { state: 'not delivered', reason });
            throw new Error(`This approval is no longer waiting: ${reason}.`);
        }
        this.answered(card);
        if (card.callId) this.confirm(entry.id, card, (session) => approvalProof(session, card.callId, outcome));
        else this.journal.set(entry.id, { state: 'answered' });
        return { state: 'sending' };
    }

    async answerQuestions(card, input) {
        let batch;
        try { batch = checkAnswers(card.questions ?? [], input.answers); } catch (error) { throw new Error(errorText(error)); }
        const entry = this.logAnswer(card, { text: `Answered: ${answerWords(batch.answers)}`, answer: answerWords(batch.answers), state: 'sending' });
        if (card.live) {
            if (!this.holds.answer(card.id, batch)) {
                const reason = 'the session answered it first, or its turn stopped';
                this.journal.set(entry.id, { state: 'not delivered', reason });
                throw new Error(`This question is no longer waiting: ${reason}.`);
            }
            this.answered(card);
            if (card.callId) this.confirm(entry.id, card, (session) => questionProof(session, card.callId));
            else this.journal.set(entry.id, { state: 'answered' });
            return { state: 'sending' };
        }
        // Its wait ran out: DSH's question service takes the late answer into the session.
        const service = this.questions();
        if (typeof service?.answer !== 'function') {
            const reason = 'DSH\'s question box is not running here, so only the session can take this answer';
            this.journal.set(entry.id, { state: 'not delivered', reason });
            throw new Error(`Not sent: ${reason}.`);
        }
        let agent;
        try {
            agent = await this.watch.resolveAgent(card.sessionId);
        } catch (error) {
            const reason = `the session could not be opened (${plainError(errorText(error, 160))})`;
            this.journal.set(entry.id, { state: 'not delivered', reason });
            throw new Error(`Not sent: ${reason}.`);
        }
        let accepted;
        try {
            accepted = service.answer(agent, card.callId, batch);
        } catch (error) {
            const reason = questionRefusal(error);
            this.journal.set(entry.id, { state: 'not delivered', reason });
            throw new Error(`Not sent: ${reason}.`);
        }
        if (accepted === false) {
            const reason = 'the question was already answered';
            this.journal.set(entry.id, { state: 'not delivered', reason });
            throw new Error(`Not sent: ${reason}.`);
        }
        this.answered(card);
        this.journal.set(entry.id, { state: 'in the queue' });
        this.confirm(entry.id, card, (session) => lateAnswerProof(session, card.callId), { pending: 'in the queue' });
        return { state: 'in the queue' };
    }

    async answerText(card, input) {
        const recommended = input.recommended === true;
        const text = typeof input.text === 'string' ? input.text.trim() : '';
        if (recommended && !card.recommendation) throw new Error('This has no recommendation to go with: write your answer.');
        if (!recommended && text === '') throw new Error('Write your answer first, or go with the recommendation.');
        if (text.length > ANSWER_MAX) throw new Error(`Keep the answer under ${ANSWER_MAX} characters.`);
        const message = answerMessage(card, { text, recommended });
        let running = false;
        try { running = (await this.watch.get(card.sessionId))?.status === 'running'; } catch { /* treated as idle */ }
        const entry = this.logAnswer(card, {
            text: recommended ? `Went with the recommendation: ${clip(card.recommendation, 160)}` : `Answered: ${clip(text, 160)}`,
            answer: recommended ? card.recommendation : text,
            note: message,
            state: 'sending',
            ...(running ? { why: 'The session was running, so the answer steers its current turn.' } : {}),
        });
        const delivery = await this.watch.deliver(card.sessionId, message, { mode: running ? 'steer' : 'queue' });
        if (delivery.state === 'failed') {
            this.journal.set(entry.id, { state: 'not delivered', reason: delivery.reason });
            throw new Error(`Not delivered: ${delivery.reason}.`);
        }
        this.answered(card);
        this.journal.set(entry.id, { state: delivery.state === 'delivered' ? 'delivered' : 'in the queue', ...(delivery.turn !== undefined ? { turn: delivery.turn } : {}) });
        delivery.done.then((done) => {
            if (done.state === 'delivered') {
                this.journal.set(entry.id, { state: 'delivered', ...(done.turn !== undefined ? { turn: done.turn } : {}) });
            } else {
                this.journal.set(entry.id, { state: 'not delivered', reason: done.reason });
                this.failed(card, `Not delivered: ${done.reason}.`);
            }
        }, (error) => this.logger?.warn?.(`decisions: ${errorText(error)}`));
        return { state: delivery.state === 'delivered' ? 'delivered' : 'in the queue' };
    }

    async answerAsk(card, input) {
        const option = typeof input.option === 'string' ? input.option : undefined;
        const text = typeof input.text === 'string' ? input.text.trim() : '';
        if (option !== undefined && !card.options.some((o) => o.id === option)) throw new Error('That is not one of the choices.');
        if (option === undefined && (!card.freeText || text === '')) throw new Error(card.freeText ? 'Choose an answer or write one.' : 'Choose one of the answers.');
        if (text.length > ANSWER_MAX) throw new Error(`Keep the answer under ${ANSWER_MAX} characters.`);
        const label = option !== undefined ? card.options.find((o) => o.id === option).label : text;
        const entry = this.logAnswer(card, { text: `Answered ${card.source}: ${clip(label, 160)}`, answer: label, state: 'sending' });
        const result = await this.watch.answerAsk(card.askId, option ?? text, 'you');
        if (!result?.ok) {
            const reason = plainError(String(result?.error ?? 'it did not take the answer'));
            this.journal.set(entry.id, { state: 'not delivered', reason });
            throw new Error(`Not sent: ${reason}`);
        }
        this.answered(card);
        this.journal.set(entry.id, { state: 'answered', why: `${card.source} carries it out and logs what it did on its own page.` });
        return { state: 'answered' };
    }

    /**
     * Prove an answer in the session's log: checked shortly after, on every
     * watcher event of that session, and given up after PROOF_MS.
     * @param {string} entryId - the log entry to update.
     * @param {object} card
     * @param {(session: object) => true | string | undefined} check
     */
    confirm(entryId, card, check, { pending } = {}) {
        const proof = { entryId, sessionId: card.sessionId, card, check, pending };
        this.proofs.add(proof);
        for (const ms of [250, 2000, 10000]) this.after(this.logger, 'decisions: proof', ms, () => this.prove(proof));
        this.after(this.logger, 'decisions: proof', PROOF_MS, () => {
            if (!this.proofs.delete(proof)) return;
            this.journal.set(entryId, { state: 'not confirmed', reason: 'the session\'s log does not show it yet' });
        });
    }

    prove(proof) {
        if (!this.proofs.has(proof)) return;
        let session;
        try { session = this.watch.sessionOf?.(proof.sessionId); } catch { session = undefined; }
        if (!session) return;
        let verdict;
        try { verdict = proof.check(session); } catch { verdict = undefined; }
        if (verdict === undefined) return;
        this.proofs.delete(proof);
        if (verdict === true) {
            this.journal.set(proof.entryId, { state: proof.pending ? 'delivered' : 'answered', provedAt: this.now() });
            return;
        }
        this.journal.set(proof.entryId, { state: 'not delivered', reason: verdict });
        this.failed(proof.card, `Not delivered: ${verdict}.`);
    }

    // ── Dismiss ────────────────────────────────────────────────────────

    async dismiss(id) {
        const { waiting } = await this.list();
        const card = waiting.find((c) => c.id === id);
        if (!card) throw new Error('This is no longer waiting.');
        this.store.data.dismissed[id] = this.now();
        this.store.data.dismissed = trimmed(this.store.data.dismissed);
        this.store.change();
        this.errors.delete(id);
        this.journal.add({ kind: 'dismiss', cardId: id, ...(card.sessionId ? { sessionId: card.sessionId } : {}), title: card.title ?? '', text: card.sessionId ? 'Dismissed' : `Dismissed: ${headline(card)}`, question: clip(String(card.question ?? ''), 300), by: 'you', ...(card.answer === 'approval' || card.live ? { why: `${sessionWords(card)} still waits for an answer in the session.` } : {}) });
        this.soon(30);
        this.changed();
        return { ok: true };
    }

    async undismiss(id) {
        if (!Object.hasOwn(this.store.data.dismissed, id)) throw new Error('This is not dismissed.');
        // Which card, for the history: the list still has it while it waits.
        let card;
        try { card = (await this.list()).dismissed.find((c) => c.id === id); } catch { card = undefined; }
        delete this.store.data.dismissed[id];
        this.store.change();
        this.journal.add({
            kind: 'undismiss',
            cardId: id,
            ...(card?.sessionId ? { sessionId: card.sessionId } : {}),
            title: card?.title ?? '',
            text: card ? (card.sessionId ? 'Brought back' : `Brought back: ${headline(card)}`) : 'Brought back a dismissed item',
            ...(card?.question ? { question: clip(String(card.question), 300) } : {}),
            by: 'you',
        });
        this.soon(30);
        this.changed();
        return { ok: true };
    }
}

/** A session's title from the watcher, or '' (never throws). */
function attemptTitle(watch, sessionId) {
    try { return watch.titleOf?.(sessionId) ?? ''; } catch { return ''; }
}
