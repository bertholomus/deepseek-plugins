/**
 * The plugin's one way out to the network. Every call to a calendar server
 * goes through `request`, which:
 *
 * - refuses plain http except to this computer (a stand-in server, a
 *   CalDAV server on localhost) unless the account allows it;
 * - follows redirects itself (at most 5), never from https to http, and
 *   drops the Authorization header when a redirect leaves the origin unless
 *   the caller's `keepAuth` says the new host is the same service (iCloud
 *   sends CalDAV clients from caldav.icloud.com to a pNN-caldav.icloud.com);
 * - stops after `timeoutMs` and after `maxBytes` of body;
 * - never puts a header value, a URL's query or a body in an error message,
 *   so a password or token can't reach a log or a model.
 *
 * @module dsh-plugin-calendar/http
 */

/** A failed request. `code`: timeout, network, too-large, insecure, redirects, aborted. */
export class HttpError extends Error {
    constructor(code, message, status) {
        super(message);
        this.name = 'HttpError';
        this.code = code;
        if (status !== undefined) this.status = status;
    }
}

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

/** Whether a URL points at this computer. */
export function isLoopback(url) {
    try {
        return LOOPBACK.test(new URL(url).hostname);
    } catch {
        return false;
    }
}

/** A URL for messages: scheme, host and path only (no user, password or query). */
export function safeUrl(url) {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
        return '(not a URL)';
    }
}

/** The host two labels deep ("p52-caldav.icloud.com" → "icloud.com"), to tell one service's hosts. */
export function siteOf(url) {
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (LOOPBACK.test(host) || /^[\d.]+$/.test(host) || host.includes(':')) return host;
        return host.split('.').slice(-2).join('.');
    } catch {
        return '';
    }
}

/** keepAuth for services that move clients between their own hosts: same site (siteOf), https kept. */
export const sameSite = (from, to) => siteOf(from) === siteOf(to) && new URL(to).protocol === new URL(from).protocol;

/** keepAuth by default: the same origin only. */
const sameOrigin = (from, to) => new URL(from).origin === new URL(to).origin;

/**
 * One HTTP exchange.
 * @param {string} url
 * @param {object} [init]
 * @param {string} [init.method] - GET by default.
 * @param {Record<string,string>} [init.headers]
 * @param {string|Uint8Array} [init.body]
 * @param {number} [init.timeoutMs] - the whole exchange, redirects included (30 s).
 * @param {number} [init.maxBytes] - the most body read (20 MB).
 * @param {AbortSignal} [init.signal]
 * @param {boolean} [init.allowHttp] - plain http to other computers too.
 * @param {(from: string, to: string) => boolean} [init.keepAuth] - whether a redirect keeps Authorization.
 * @param {typeof fetch} [init.fetch] - for tests.
 * @returns {Promise<{status: number, ok: boolean, url: string, headers: Headers, text: string, json: () => any}>}
 */
export async function request(url, init = {}) {
    const {
        method = 'GET', headers = {}, body, timeoutMs = 30_000, maxBytes = 20 * 1024 * 1024,
        signal, allowHttp = false, keepAuth = sameOrigin, fetch: fetchImpl = globalThis.fetch,
    } = init;
    const timer = AbortSignal.timeout(timeoutMs);
    const abort = signal ? AbortSignal.any([signal, timer]) : timer;
    let current = String(url);
    let sent = { ...headers };
    let verb = method;
    let payload = body;
    for (let hop = 0; ; hop++) {
        let target;
        try {
            target = new URL(current);
        } catch {
            throw new HttpError('network', 'The address is not a valid URL.');
        }
        if (target.protocol !== 'https:' && target.protocol !== 'http:') throw new HttpError('insecure', `Only https addresses work here, not ${target.protocol}`);
        if (target.protocol === 'http:' && !allowHttp && !isLoopback(current)) {
            throw new HttpError('insecure', `${safeUrl(current)} is plain http; calendars on another computer need https.`);
        }
        let response;
        try {
            response = await fetchImpl(current, { method: verb, headers: sent, body: payload, redirect: 'manual', signal: abort });
        } catch (error) {
            if (timer.aborted) throw new HttpError('timeout', `${safeUrl(current)} didn't answer within ${Math.round(timeoutMs / 1000)} s.`);
            if (signal?.aborted) throw new HttpError('aborted', 'Stopped.');
            throw new HttpError('network', `Couldn't reach ${safeUrl(current)}: ${networkReason(error)}`);
        }
        if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
            if (hop >= 5) throw new HttpError('redirects', `${safeUrl(url)} redirected too many times.`);
            const next = new URL(response.headers.get('location'), current).toString();
            if (target.protocol === 'https:' && next.startsWith('http:') && !isLoopback(next)) {
                throw new HttpError('insecure', `${safeUrl(current)} redirected to plain http.`);
            }
            try { await response.body?.cancel(); } catch {}
            if (!keepAuth(current, next)) {
                sent = Object.fromEntries(Object.entries(sent).filter(([k]) => k.toLowerCase() !== 'authorization'));
            }
            // 303, and 301/302 after a POST, become a GET without a body, as browsers do.
            if (response.status === 303 || ((response.status === 301 || response.status === 302) && verb === 'POST')) {
                verb = 'GET';
                payload = undefined;
            }
            current = next;
            continue;
        }
        const text = await readText(response, maxBytes, current);
        return {
            status: response.status,
            ok: response.status >= 200 && response.status < 300,
            url: current,
            headers: response.headers,
            text,
            json() {
                try {
                    return JSON.parse(text);
                } catch {
                    throw new HttpError('network', `${safeUrl(current)} sent something that isn't JSON (HTTP ${response.status}).`, response.status);
                }
            },
        };
    }
}

/** The body as text, at most maxBytes of it. */
async function readText(response, maxBytes, url) {
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > maxBytes) {
        try { await response.body?.cancel(); } catch {}
        throw new HttpError('too-large', `${safeUrl(url)} sent more than ${Math.round(maxBytes / 1048576)} MB.`, response.status);
    }
    if (!response.body) return '';
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
            try { await reader.cancel(); } catch {}
            throw new HttpError('too-large', `${safeUrl(url)} sent more than ${Math.round(maxBytes / 1048576)} MB.`, response.status);
        }
        chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
}

/** Why a fetch failed, in words, without the URL (the caller names it). */
function networkReason(error) {
    const cause = error?.cause;
    const code = cause?.code ?? error?.code;
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the name doesn\'t resolve';
    if (code === 'ECONNREFUSED') return 'the connection was refused';
    if (code === 'ECONNRESET') return 'the connection was reset';
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'the connection timed out';
    if (typeof code === 'string' && /CERT|SSL|TLS/i.test(code)) return 'its certificate isn\'t trusted';
    return typeof code === 'string' ? code : 'the request failed';
}

/** Basic auth header value. */
export function basicAuth(user, password) {
    return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}

/** A form body (application/x-www-form-urlencoded). */
export function formBody(fields) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) params.set(k, String(v));
    return params.toString();
}
