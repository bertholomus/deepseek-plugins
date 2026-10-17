/**
 * The outbound mirror: a short message for each new card, sent where the
 * person is when they are away from DSH. Off unless the config turns it on.
 *
 * - `webhook`: a POST of `{ content }` (Discord's webhook shape) to
 *   `mirrorUrl`, which must be https (or http to this machine, for a local
 *   sink). Mentions are switched off, so an agent's text can never ping
 *   anyone.
 * - `command`: `mirrorCommand` (an absolute path, then its arguments) run
 *   without a shell, with the card as JSON on stdin.
 *
 * At most `mirrorPerHour` messages an hour; past that it holds back and
 * says so once. Every send and every failure goes in the event log, which
 * names the host or the program, never the address (a webhook address is
 * a secret).
 *
 * @module dsh-plugin-decisions/mirror
 */
import { spawn as spawnProcess } from 'node:child_process';
import { basename, isAbsolute } from 'node:path';
import { clip, errorText } from './shared/safe.js';
import { cutLines, mirrorText } from './cards.js';

/** Hosts an http (not https) webhook may use: this machine only. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** Longest message a webhook gets (Discord takes 2000 characters). */
const WEBHOOK_MAX = 1900;

/**
 * Check a webhook address: https, or http to this machine. Returns the URL,
 * or throws in words that name the setting.
 */
export function checkWebhook(text) {
    if (typeof text !== 'string' || text.trim() === '') throw new Error('decisions: mirrorUrl is empty; give the webhook address (https://…), or set mirror to "off"');
    let url;
    try { url = new URL(text.trim()); } catch { throw new Error('decisions: mirrorUrl is not a web address; give the full webhook address, starting with https://'); }
    if (url.protocol === 'https:') return url;
    if (url.protocol === 'http:' && LOOPBACK.has(url.hostname)) return url;
    throw new Error(`decisions: mirrorUrl must start with https:// (http:// only to this machine), not ${url.protocol}//`);
}

/** Check a command sink: an absolute program path, then plain arguments. Throws in words. */
export function checkCommand(command) {
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== 'string')) {
        throw new Error('decisions: mirrorCommand must list the program (an absolute path) and then its arguments, for example ["/usr/local/bin/notify", "--to", "me"]');
    }
    if (!isAbsolute(command[0])) throw new Error(`decisions: mirrorCommand must start with an absolute path to the program (got ${JSON.stringify(command[0])})`);
    return command;
}

/** Where the mirror sends, in words safe to show: a host or a program name, never a secret. */
export function mirrorPlace(config) {
    try {
        if (config?.mirror === 'webhook') return checkWebhook(config.mirrorUrl).host;
        if (config?.mirror === 'command') return basename(checkCommand(config.mirrorCommand)[0]);
    } catch { /* checkConfig already said what is wrong */ }
    return '';
}

export class Mirror {
    /**
     * @param {object} options
     * @param {object} options.config - Decisions' config.
     * @param {import('./shared/journal.js').Journal} options.journal
     * @param {{ warn: Function }} [options.logger]
     * @param {typeof fetch} [options.fetch]
     * @param {typeof spawnProcess} [options.spawn]
     * @param {() => number} [options.now]
     */
    constructor({ config, journal, logger, fetch = globalThis.fetch, spawn = spawnProcess, now = Date.now }) {
        this.config = config;
        this.journal = journal;
        this.logger = logger;
        this.fetch = fetch;
        this.spawn = spawn;
        this.now = now;
        /** When each message of the last hour went. */
        this.sent = [];
        /** The hour (ms) the limit was last reported for, so it is said once an hour. */
        this.heldReported = 0;
        /** The last send's outcome, for the page. */
        this.last = undefined;
    }

    get on() {
        return this.config.mirror === 'webhook' || this.config.mirror === 'command';
    }

    get place() {
        return mirrorPlace(this.config);
    }

    /** What the page shows about the mirror. */
    status() {
        const hourAgo = this.now() - 3600000;
        return {
            mode: this.on ? this.config.mirror : 'off',
            place: this.place,
            perHour: this.config.mirrorPerHour,
            lastHour: this.sent.filter((at) => at > hourAgo).length,
            ...(this.last ? { last: this.last } : {}),
        };
    }

    /**
     * Mirror one card. Never throws; resolves to `{ ok, reason? }` and logs
     * the outcome.
     * @param {object} card
     */
    async send(card) {
        if (!this.on) return { ok: false, reason: 'the mirror is off' };
        const now = this.now();
        this.sent = this.sent.filter((at) => at > now - 3600000);
        if (this.sent.length >= this.config.mirrorPerHour) {
            if (now - this.heldReported > 3600000) {
                this.heldReported = now;
                this.journal.add({ kind: 'mirror', text: `Held back mirrored messages: ${this.config.mirrorPerHour} went out in the last hour`, why: 'mirrorPerHour caps them; Decisions still lists everything.', state: 'held' });
            }
            return { ok: false, reason: 'the hourly limit is reached' };
        }
        this.sent.push(now);
        const entry = this.journal.add({
            kind: 'mirror',
            cardId: card.id,
            ...(card.sessionId ? { sessionId: card.sessionId } : {}),
            title: card.title ?? '',
            text: `Mirrored to ${this.place || 'the mirror'}`,
            state: 'sending',
        });
        const result = await this.deliver(mirrorText(card), card);
        this.journal.set(entry.id, result.ok ? { state: 'sent' } : { state: 'not sent', reason: result.reason });
        this.last = { at: this.now(), ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) };
        return result;
    }

    /** Send a test message now (from the page), past the hourly limit. */
    async test() {
        if (!this.on) return { ok: false, reason: 'The mirror is off. Set mirror to "webhook" or "command" in Plugins → Decisions.' };
        const entry = this.journal.add({ kind: 'mirror', text: `Sent a test message to ${this.place || 'the mirror'}`, state: 'sending', by: 'you' });
        const result = await this.deliver('Decisions can reach you here. When something waits on you in DSH, a short note comes here.', { kind: 'test', title: 'Test', question: 'Decisions can reach you here.' });
        this.journal.set(entry.id, result.ok ? { state: 'sent' } : { state: 'not sent', reason: result.reason });
        this.last = { at: this.now(), ok: result.ok, ...(result.reason ? { reason: result.reason } : {}) };
        return result;
    }

    async deliver(text, card) {
        try {
            if (this.config.mirror === 'webhook') return await this.post(text);
            return await this.run(text, card);
        } catch (error) {
            return { ok: false, reason: errorText(error, 200) };
        }
    }

    async post(text) {
        let url;
        try { url = checkWebhook(this.config.mirrorUrl); } catch (error) { return { ok: false, reason: errorText(error).replace(/^decisions: /, '') }; }
        if (typeof this.fetch !== 'function') return { ok: false, reason: 'this DSH has no way to make web requests' };
        let response;
        try {
            response = await this.fetch(url, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content: cutLines(text, WEBHOOK_MAX), allowed_mentions: { parse: [] } }),
                signal: AbortSignal.timeout(10000),
                redirect: 'error',
            });
        } catch (error) {
            const why = error?.name === 'TimeoutError' ? 'it did not answer within 10 seconds' : 'it could not be reached';
            return { ok: false, reason: `${url.host}: ${why}` };
        }
        try { await response.body?.cancel?.(); } catch { /* the answer's body is not needed */ }
        if (response.ok) return { ok: true };
        return { ok: false, reason: `${url.host} answered ${response.status}${response.status === 401 || response.status === 403 || response.status === 404 ? ' (check the webhook address)' : response.status === 429 ? ' (too many messages; it will take more later)' : ''}` };
    }

    run(text, card) {
        let command;
        try { command = checkCommand(this.config.mirrorCommand); } catch (error) { return Promise.resolve({ ok: false, reason: errorText(error).replace(/^decisions: /, '') }); }
        const name = basename(command[0]);
        return new Promise((resolve) => {
            let child;
            let done = false;
            const finish = (result) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(result);
            };
            const timer = setTimeout(() => {
                try { child?.kill('SIGTERM'); } catch { /* it is gone */ }
                finish({ ok: false, reason: `${name} did not finish within 15 seconds` });
            }, 15000);
            timer.unref?.();
            try {
                child = this.spawn(command[0], command.slice(1), { shell: false, stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
            } catch (error) {
                finish({ ok: false, reason: `${name} could not start: ${errorText(error, 120)}` });
                return;
            }
            let stderr = '';
            child.stderr?.on?.('data', (chunk) => { if (stderr.length < 400) stderr += String(chunk); });
            child.on('error', (error) => finish({ ok: false, reason: `${name} could not start: ${error?.code === 'ENOENT' ? 'no such program' : error?.code === 'EACCES' ? 'it is not executable' : errorText(error, 120)}` }));
            child.on('close', (code, signal) => {
                if (code === 0) finish({ ok: true });
                else finish({ ok: false, reason: `${name} ${signal ? `stopped on ${signal}` : `exited with ${code}`}${stderr.trim() ? `: ${clip(stderr, 160)}` : ''}` });
            });
            const payload = {
                text,
                kind: card?.kind ?? '',
                title: card?.title ?? '',
                question: card?.question ?? '',
                ...(card?.recommendation ? { recommendation: card.recommendation } : {}),
                ...(card?.sessionId ? { sessionId: card.sessionId } : {}),
            };
            try {
                child.stdin?.on?.('error', () => { /* a program that does not read stdin */ });
                child.stdin?.end?.(`${JSON.stringify(payload)}\n`);
            } catch { /* the close handler reports the outcome */ }
        });
    }
}
