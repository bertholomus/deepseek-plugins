/**
 * What a command sends outside the workspace, read before it runs: a web
 * request that does more than read (a method other than GET, HEAD or
 * OPTIONS, or a body), a push, a publish, a deploy or another change made
 * through a service's command-line tool, a command run or a file copied on
 * another machine, an email; a script or a task that does one of these,
 * known by its name or by what it runs; code given inline that posts. A
 * read (a GET, a clone, an install, a list or a view) is not a send.
 *
 * It reads a command line the way the shell would, closely enough for the
 * commands a model writes. It is a check against a well-meant mistake, not
 * a sandbox: a program it doesn't know, or a send inside a library the
 * command runs, goes through.
 *
 * @module dsh-plugin-projects/sends
 */
import { basename, dirname, isAbsolute, resolve } from 'node:path';

/** How deep scripts that run scripts are followed. */
const MAX_DEPTH = 3;
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE', 'TRACE', 'CONNECT']);

// ── Reading a command line ────────────────────────────────────────────────

/**
 * The index of the `)` that closes the `(` at `open`, quotes and nesting
 * kept; the end of the text when none does. A here-document's body is text,
 * so an apostrophe in it opens no quote. A quote that nothing closes is
 * read as a plain character.
 */
function closeParen(s, open) {
    let depth = 0;
    // In `$((…))`, `<<` shifts.
    const docs = s[open + 1] === '(' ? null : [];
    for (let i = open; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') { i++; continue; }
        if (c === '\n' && docs?.length > 0) { i = bodiesAt(s, i + 1, docs.splice(0)).end - 1; continue; }
        if (c === '<' && s[i + 1] === '<' && s[i + 2] !== '<' && docs) {
            const doc = heredocAt(s, i + 2);
            if (doc) { docs.push(doc); i = doc.end - 1; continue; }
        }
        if (c === '#' && /[\s;(|&]/.test(s[i - 1] ?? ' ')) { const end = s.indexOf('\n', i); i = (end < 0 ? s.length : end) - 1; continue; }
        if (c === "'") { const end = s.indexOf("'", i + 1); if (end >= 0) i = end; continue; }
        if (c === '"') { const end = closeDouble(s, i + 1); if (end < s.length) i = end; continue; }
        if (c === '`') { i = closeBacktick(s, i + 1); continue; }
        if (c === '(') depth++;
        else if (c === ')' && --depth === 0) return i;
    }
    return s.length;
}

/** The here-document `<<WORD` or `<<-WORD` names after `at`: its delimiter with quotes taken off, whether tabs are stripped, and where the word ends. */
function heredocAt(s, at) {
    let i = at;
    const strip = s[i] === '-';
    if (strip) i++;
    while (s[i] === ' ' || s[i] === '\t') i++;
    let delim = '';
    while (i < s.length && !/[\s;&|<>()]/.test(s[i])) {
        const c = s[i];
        if (c === "'" || c === '"') {
            const end = s.indexOf(c, i + 1);
            if (end < 0) return null;
            delim += s.slice(i + 1, end);
            i = end + 1;
        } else if (c === '\\') {
            delim += s[i + 1] ?? '';
            i += 2;
        } else {
            delim += c;
            i++;
        }
    }
    return delim === '' ? null : { delim, strip, end: i };
}

/** The bodies of here-documents, which start on the line at `at`: each one's lines up to its delimiter, and where the last one ends. */
function bodiesAt(s, at, docs) {
    let i = at;
    const bodies = [];
    for (const doc of docs) {
        const lines = [];
        while (i < s.length) {
            const end = s.indexOf('\n', i);
            const line = s.slice(i, end < 0 ? s.length : end);
            i = end < 0 ? s.length : end + 1;
            // `<<-` takes the tabs off each line, the last one's too.
            const bare = doc.strip ? line.replace(/^\t+/, '') : line;
            if (bare === doc.delim) break;
            lines.push(bare);
        }
        bodies.push(lines.join('\n'));
    }
    return { bodies, end: i };
}

/** The index of the `"` that closes a double-quoted text starting at `from`. */
function closeDouble(s, from) {
    for (let i = from; i < s.length; i++) {
        const c = s[i];
        if (c === '\\') { i++; continue; }
        if (c === '"') return i;
        if (c === '$' && s[i + 1] === '(') { i = closeParen(s, i + 1); continue; }
        if (c === '`') i = closeBacktick(s, i + 1);
    }
    return s.length;
}

function closeBacktick(s, from) {
    for (let i = from; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '`') return i;
    }
    return s.length;
}

function closeBrace(s, open) {
    let depth = 0;
    for (let i = open; i < s.length; i++) {
        if (s[i] === '\\') { i++; continue; }
        if (s[i] === '{') depth++;
        else if (s[i] === '}' && --depth === 0) return i;
    }
    return s.length;
}

/**
 * A command line in simple commands, as bash splits it: each with its
 * words (quotes taken off), the here-documents and here-strings it reads,
 * and whether its output goes on to the next one (`|`). `$(…)`, backquotes
 * and `<(…)` are command lines of their own (`nested`).
 * @returns {{commands: {words: string[], inputs: string[], pipe: boolean}[], nested: string[]}}
 */
export function splitShell(text) {
    const s = String(text ?? '');
    const commands = [];
    const nested = [];
    let words = [];
    let inputs = [];
    let word = null;
    let redirect = null;
    let strip = false;
    let pending = [];
    const add = (part) => { word = (word ?? '') + part; };
    const endWord = () => {
        if (word === null) return;
        const done = word;
        word = null;
        if (redirect === 'heredoc') pending.push({ delim: done, strip, into: inputs });
        else if (redirect === 'here') inputs.push(done);
        else if (redirect !== 'target') words.push(done);
        redirect = null;
    };
    const endCommand = (pipe) => {
        endWord();
        if (words.length > 0 || inputs.length > 0) commands.push({ words, inputs, pipe });
        words = [];
        inputs = [];
    };
    // Here-documents start on the line after the one that names them.
    const readBodies = (at) => {
        const { bodies, end } = bodiesAt(s, at, pending);
        pending.forEach((doc, k) => doc.into.push(bodies[k]));
        pending = [];
        return end;
    };
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        const next = s[i + 1];
        if (c === '\\') {
            if (next !== '\n' && i + 1 < s.length) add(next);
            i += 2;
        } else if (c === "'" || (c === '"' && closeDouble(s, i + 1) >= s.length)) {
            // A quote that nothing closes is a plain character, so what follows it is still read.
            const end = c === "'" ? s.indexOf("'", i + 1) : -1;
            add(end < 0 ? c : s.slice(i + 1, end));
            i = end < 0 ? i + 1 : end + 1;
        } else if (c === '"') {
            const end = closeDouble(s, i + 1);
            const inner = s.slice(i + 1, end);
            for (let k = 0; k < inner.length; k++) {
                if (inner[k] === '$' && inner[k + 1] === '(' && inner[k + 2] !== '(') {
                    const close = closeParen(inner, k + 1);
                    nested.push(inner.slice(k + 2, close));
                    k = close;
                } else if (inner[k] === '`') {
                    const close = closeBacktick(inner, k + 1);
                    nested.push(inner.slice(k + 1, close));
                    k = close;
                }
            }
            add(inner.replace(/\\(["\\$`])/g, '$1'));
            i = end + 1;
        } else if (c === '$' && next === "'") {
            let k = i + 2;
            let text = '';
            for (; k < s.length && s[k] !== "'"; k++) {
                if (s[k] === '\\' && k + 1 < s.length) { k++; text += ({ n: '\n', t: '\t' })[s[k]] ?? s[k]; } else text += s[k];
            }
            add(text);
            i = k + 1;
        } else if (c === '$' && next === '(') {
            const close = closeParen(s, i + 1);
            if (s[i + 2] !== '(') nested.push(s.slice(i + 2, close));
            add(s.slice(i, close + 1));
            i = close + 1;
        } else if (c === '$' && next === '{') {
            const close = closeBrace(s, i + 1);
            add(s.slice(i, close + 1));
            i = close + 1;
        } else if (c === '`') {
            const close = closeBacktick(s, i + 1);
            nested.push(s.slice(i + 1, close));
            add(s.slice(i, close + 1));
            i = close + 1;
        } else if ((c === '<' || c === '>') && next === '(') {
            const close = closeParen(s, i + 1);
            nested.push(s.slice(i + 2, close));
            add(s.slice(i, close + 1));
            i = close + 1;
        } else if (c === '#' && word === null) {
            const end = s.indexOf('\n', i);
            i = end < 0 ? s.length : end;
        } else if (c === ' ' || c === '\t' || c === '\r') {
            endWord();
            i++;
        } else if (c === '<' || c === '>' || (c === '&' && next === '>')) {
            // A file descriptor's number before the operator is no word.
            if (word !== null && /^\d+$/.test(word)) word = null;
            else endWord();
            const op = ['<<<', '<<-', '&>>', '<<', '&>', '>>', '>&', '<&', '>|', '<>'].find((o) => s.startsWith(o, i)) ?? c;
            i += op.length;
            redirect = op === '<<<' ? 'here' : op.startsWith('<<') ? 'heredoc' : 'target';
            strip = op === '<<-';
        } else if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')') {
            const op = ['&&', '||', '|&', ';;'].find((o) => s.startsWith(o, i)) ?? c;
            endCommand(op === '|' || op === '|&');
            i += op.length;
            if (c === '\n' && pending.length > 0) i = readBodies(i);
        } else {
            add(c);
            i++;
        }
    }
    endCommand(false);
    if (pending.length > 0) readBodies(s.length);
    return { commands, nested };
}

/** A program's name as its path ends: `/usr/bin/curl` and `curl.exe` are `curl`. */
function programOf(word) {
    return basename(String(word ?? '')).replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/** Its own words, where a scope or a version doesn't name the program: `@vercel/cli@1` is `vercel`. */
const PACKAGE_BINS = {
    'netlify-cli': 'netlify', 'firebase-tools': 'firebase', 'aws-cdk': 'cdk', 'cdktf-cli': 'cdktf', '@railway/cli': 'railway', '@vercel/cli': 'vercel',
    '@changesets/cli': 'changeset', '@vscode/vsce': 'vsce', '@cloudflare/wrangler': 'wrangler', 'serverless': 'serverless', '@nestjs/cli': 'nest',
};
function packageBin(spec) {
    const plain = String(spec).replace(/^(@[^/@]+\/[^@]+|[^@]+)@.*$/, '$1');
    return PACKAGE_BINS[plain] ?? programOf(plain.replace(/^@[^/]+\//, ''));
}

/**
 * Options before a command's own words: `takes` names the options whose
 * value is the next word (a set of short letters and long names).
 * @returns the index of the first word that is no option.
 */
function skipOptions(args, takes, from = 0) {
    let i = from;
    while (i < args.length) {
        const a = args[i];
        if (a === '--') return i + 1;
        if (!a.startsWith('-') || a === '-') return i;
        if (a.startsWith('--')) {
            i += !a.includes('=') && takes.has(a) ? 2 : 1;
            continue;
        }
        // Short options together: one that takes a value takes the rest of the word, or the next word.
        let k = 1;
        for (; k < a.length; k++) if (takes.has(a[k])) break;
        i += k < a.length && k === a.length - 1 ? 2 : 1;
    }
    return i;
}

/** The words that aren't options, values of `takes` skipped. */
function positionals(args, takes = new Set()) {
    const out = [];
    let i = 0;
    while (i < args.length) {
        const a = args[i];
        if (a === '--') { out.push(...args.slice(i + 1)); break; }
        if (a.startsWith('-') && a !== '-') {
            if (a.startsWith('--')) i += !a.includes('=') && takes.has(a) ? 2 : 1;
            else {
                let k = 1;
                for (; k < a.length; k++) if (takes.has(a[k])) break;
                i += k < a.length && k === a.length - 1 ? 2 : 1;
            }
            continue;
        }
        out.push(a);
        i++;
    }
    return out;
}

/** An option's value: `--name=value`, `--name value`, `-Xvalue` or `-X value`. */
function optionValue(args, names) {
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--') break;
        for (const name of names) {
            if (a === name) return args[i + 1] ?? '';
            if (name.startsWith('--') && a.startsWith(`${name}=`)) return a.slice(name.length + 1);
            if (!name.startsWith('--') && name.length === 2 && a.startsWith(name) && a.length > 2 && !a.startsWith('--')) return a.slice(2);
        }
    }
    return undefined;
}

const has = (args, ...names) => args.some((a) => names.includes(a) || names.some((n) => n.startsWith('--') && a.startsWith(`${n}=`)));
const dryRun = (args) => args.some((a) => a === '--dry-run' || a.startsWith('--dry-run=') || a === '--dryrun');

// Commands that only run the command after them.
const WRAP = {
    sudo: new Set(['u', 'g', 'h', 'p', 'C', 'D', 'r', 't', 'T', 'U', '--user', '--group', '--host', '--prompt', '--close-from', '--chdir', '--role', '--type', '--command-timeout', '--other-user']),
    doas: new Set(['u', 'C']),
    command: new Set(), builtin: new Set(), exec: new Set(['a']), nohup: new Set(), setsid: new Set(), unbuffer: new Set(), chronic: new Set(),
    time: new Set(['f', 'o', '--format', '--output']), nice: new Set(['n', '--adjustment']), ionice: new Set(['c', 'n', 'p', '--class', '--classdata']),
    stdbuf: new Set(['i', 'o', 'e', '--input', '--output', '--error']), caffeinate: new Set(['t', 'w']),
    strace: new Set(['e', 'o', 'p', 's', 'u', 'E', 'a', 'b', 'I', 'O', 'P', 'S', 'X']), ltrace: new Set(['e', 'o', 'p', 's', 'u', 'n', 'a']),
    torsocks: new Set(['u', 'p', 'a', 'P']), proxychains: new Set(['f']), proxychains4: new Set(['f']), tsocks: new Set(),
    xargs: new Set(['I', 'n', 'P', 'L', 's', 'd', 'E', 'a', '--max-args', '--max-procs', '--max-lines', '--max-chars', '--delimiter', '--eof', '--arg-file', '--replace']),
    'aws-vault': null, op: null, doppler: null, infisical: null, dotenv: null, chamber: null, direnv: null, envchain: null, teller: null,
};

/** Runners whose command follows `--`, or a fixed number of words: `aws-vault exec PROFILE -- cmd`, `op run -- cmd`. */
function afterRunner(name, args) {
    const dash = args.indexOf('--');
    if (dash >= 0) return args.slice(dash + 1);
    if (name === 'aws-vault' && args[0] === 'exec') return args.slice(skipOptions(args, new Set(['d', '--duration', '--region', '--mfa-token']), 1) + 1);
    if (name === 'direnv' && args[0] === 'exec') return args.slice(2);
    if (name === 'chamber' && args[0] === 'exec') return args.slice(2);
    if (name === 'envchain') return args.slice(skipOptions(args, new Set()) + 1);
    return [];
}

/** The command a line runs once what only wraps it is taken off: `sudo env X=1 timeout 5 curl …` runs curl. */
function commandOf(words) {
    let w = words;
    for (let guard = 0; guard < 16 && w.length > 0; guard++) {
        const first = w[0];
        if (/^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(first)) { w = w.slice(1); continue; }
        if (['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}', 'time', 'coproc', 'fi', 'done', 'esac'].includes(first)) { w = w.slice(1); continue; }
        if (['for', 'case', 'select', 'function', 'in'].includes(first)) return [];
        const name = programOf(first);
        if (name === 'env') {
            const args = w.slice(1);
            let i = 0;
            while (i < args.length) {
                const a = args[i];
                if (a === '--') { i++; break; }
                if (a === '-S' || a === '--split-string') return [...splitWords(args[i + 1] ?? ''), ...args.slice(i + 2)];
                if (a.startsWith('--split-string=')) return [...splitWords(a.slice(15)), ...args.slice(i + 1)];
                if (a === '-u' || a === '-C' || a === '--unset' || a === '--chdir') { i += 2; continue; }
                if (a.startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(a)) { i++; continue; }
                break;
            }
            w = args.slice(i);
            continue;
        }
        if (name === 'timeout') {
            const args = w.slice(1);
            const at = skipOptions(args, new Set(['s', 'k', '--signal', '--kill-after']));
            w = args.slice(at + 1);
            continue;
        }
        if (name === 'flock') {
            const args = w.slice(1);
            const at = skipOptions(args, new Set(['w', 'E', '--timeout', '--conflict-exit-code']));
            const c = optionValue(args, ['-c', '--command']);
            if (c !== undefined) return splitWords(c);
            w = args.slice(at + 1);
            continue;
        }
        if (name === 'watch') {
            const args = w.slice(1);
            w = args.slice(skipOptions(args, new Set(['n', 'q', '--interval', '--equexit', '--differences'])));
            if (w.length === 1) w = splitWords(w[0]);
            continue;
        }
        if (!(name in WRAP)) break;
        const args = w.slice(1);
        if (WRAP[name] === null) {
            w = afterRunner(name, args);
            continue;
        }
        if (name === 'command' && (args.includes('-v') || args.includes('-V'))) return [];
        w = args.slice(skipOptions(args, WRAP[name]));
    }
    return w;
}

/** A string's words as the shell would split it, quotes taken off. */
function splitWords(text) {
    return splitShell(text).commands.flatMap((c) => c.words);
}

// ── What each program sends ───────────────────────────────────────────────

/** Where a URL points, short: host, port and path, without its scheme, user or query. */
export function placeOf(url) {
    const s = String(url ?? '').trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/^[^@/]*@/, '').replace(/[?#].*$/, '');
    return s.length > 60 ? `${s.slice(0, 59)}…` : s;
}

const looksLikeUrl = (a) => /^(https?|ftps?|sftp|scp|smtps?|wss?|tftp|dict|ldaps?|telnet|mqtt|gopher):\/\//i.test(a) || /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?(\/|$)/i.test(a);

function request(method, url, program) {
    const where = placeOf(url);
    return { kind: 'request', program, what: `sends a ${method} to ${where || 'a server'} (${program})` };
}

const CURL_TAKES = new Set([...'AbcCdDeEFHKmoPQrtTuUwxXyYz',
    '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json', '--form', '--form-string', '--upload-file', '--request', '--header',
    '--proxy-header', '--output', '--user', '--user-agent', '--referer', '--cookie', '--cookie-jar', '--config', '--proxy', '--proxy-user', '--write-out',
    '--range', '--max-time', '--connect-timeout', '--retry', '--retry-delay', '--retry-max-time', '--cert', '--cert-type', '--key', '--key-type', '--cacert',
    '--capath', '--crlfile', '--pinnedpubkey', '--continue-at', '--dump-header', '--resolve', '--connect-to', '--limit-rate', '--max-filesize', '--max-redirs',
    '--output-dir', '--interface', '--dns-servers', '--oauth2-bearer', '--aws-sigv4', '--variable', '--trace', '--trace-ascii', '--stderr', '--unix-socket',
    '--abstract-unix-socket', '--local-port', '--pass', '--proto', '--proto-redir', '--proto-default', '--mail-from', '--mail-rcpt', '--mail-auth', '--url',
    '--url-query', '--time-cond', '--tls-max', '--ciphers', '--curves', '--netrc-file', '--noproxy', '--preproxy', '--socks4', '--socks4a', '--socks5',
    '--socks5-hostname', '--login-options', '--service-name', '--telnet-option', '--keepalive-time', '--expect100-timeout', '--speed-limit', '--speed-time',
    '--rate', '--parallel-max', '--request-target', '--doh-url', '--etag-save', '--etag-compare', '--create-file-mode', '--ftp-port', '--ftp-method']);

function curl(args) {
    let method;
    let body = false;
    let upload = false;
    let head = false;
    let get = false;
    let mail = false;
    let url;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--') { url ??= args[i + 1]; break; }
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            const name = eq > 0 ? a.slice(0, eq) : a;
            const value = () => (eq > 0 ? a.slice(eq + 1) : args[++i]);
            if (name === '--request') method = value();
            else if (['--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json', '--form', '--form-string'].includes(name)) { value(); body = true; }
            else if (name === '--upload-file') { value(); upload = true; }
            else if (name === '--head') head = true;
            else if (name === '--get') get = true;
            else if (name === '--mail-rcpt' || name === '--mail-from') { value(); mail = true; }
            else if (name === '--url') url ??= value();
            else if (eq < 0 && CURL_TAKES.has(name)) i++;
            continue;
        }
        if (a.startsWith('-') && a.length > 1) {
            for (let k = 1; k < a.length; k++) {
                const f = a[k];
                if (f === 'I') head = true;
                else if (f === 'G') get = true;
                if (!CURL_TAKES.has(f)) continue;
                const value = k + 1 < a.length ? a.slice(k + 1) : args[++i];
                if (f === 'X') method = value;
                else if (f === 'd' || f === 'F') body = true;
                else if (f === 'T') upload = true;
                break;
            }
            continue;
        }
        url ??= a;
    }
    if (mail || /^smtps?:/i.test(url ?? '')) return mail || upload ? { kind: 'email', program: 'curl', what: 'sends email (curl)' } : null;
    const verb = method ? String(method).toUpperCase() : body ? (get ? 'GET' : 'POST') : upload ? 'PUT' : head ? 'HEAD' : 'GET';
    return READ_METHODS.has(verb) ? null : request(verb, url, 'curl');
}

const WGET_TAKES = new Set([...'OoaiBtTwQPUelARDIX', '--output-document', '--output-file', '--append-output', '--input-file', '--base', '--tries', '--timeout',
    '--wait', '--quota', '--directory-prefix', '--user-agent', '--execute', '--level', '--accept', '--reject', '--domains', '--include-directories',
    '--exclude-directories', '--header', '--user', '--password', '--http-user', '--http-password', '--load-cookies', '--save-cookies', '--post-data',
    '--post-file', '--body-data', '--body-file', '--method', '--referer', '--ca-certificate', '--certificate', '--private-key', '--limit-rate']);

function wget(args) {
    const method = optionValue(args, ['--method']);
    const body = has(args, '--post-data', '--post-file', '--body-data', '--body-file');
    const verb = method ? method.toUpperCase() : body ? 'POST' : 'GET';
    return READ_METHODS.has(verb) ? null : request(verb, positionals(args, WGET_TAKES)[0], 'wget');
}

const HTTPIE_TAKES = new Set([...'aAovs', '--auth', '--auth-type', '--output', '--verify', '--cert', '--cert-key', '--timeout', '--proxy', '--session',
    '--session-read-only', '--style', '--print', '--pretty', '--format-options', '--max-redirects', '--max-headers', '--boundary', '--raw', '--ssl', '--ciphers', '--default-scheme']);

/** HTTPie (`http`, `https`) and xh: `http [METHOD] URL [items]`; a data item makes it a POST. */
function httpie(args, program) {
    const pos = positionals(args, HTTPIE_TAKES);
    let at = 0;
    let method;
    if (pos.length > 1 && HTTP_METHODS.has(pos[0].toUpperCase()) && /^[A-Za-z]+$/.test(pos[0])) method = pos[at++].toUpperCase();
    const url = pos[at];
    const data = pos.slice(at + 1).some((item) => {
        const m = /(==|:=@|:=|=@|=|@|:)/.exec(item);
        return m !== null && m[1] !== '==' && m[1] !== ':';
    }) || has(args, '--raw') || has(args, '-f', '--form', '--multipart');
    const verb = method ?? (data ? 'POST' : 'GET');
    return READ_METHODS.has(verb) ? null : request(verb, url, program);
}

/** PowerShell's web cmdlets: `-Method Post`, or a body. */
function webCmdlet(args, program) {
    const lower = args.map((a) => a.toLowerCase());
    const valueOf = (name) => {
        const at = lower.findIndex((a) => a === name || a.startsWith(`${name}:`));
        if (at < 0) return undefined;
        return lower[at].includes(':') ? args[at].slice(args[at].indexOf(':') + 1) : args[at + 1];
    };
    const method = valueOf('-method');
    const body = ['-body', '-infile', '-form'].some((name) => valueOf(name) !== undefined);
    const verb = method ? method.toUpperCase() : body ? 'POST' : 'GET';
    if (READ_METHODS.has(verb)) return null;
    const url = valueOf('-uri') ?? args.find((a) => looksLikeUrl(a));
    return request(verb, url, program);
}

const GIT_TAKES = new Set(['C', 'c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--super-prefix', '--list-cmds']);

function git(args) {
    const at = skipOptions(args, GIT_TAKES);
    const sub = args[at];
    const rest = args.slice(at + 1);
    if (sub === 'push') {
        if (dryRun(rest) || rest.includes('-n')) return null;
        const remote = positionals(rest, new Set(['o', '--push-option', '--repo', '--receive-pack', '--exec', '--signed', '--force-with-lease']))[0];
        return { kind: 'push', program: 'git', what: `pushes to ${remote ?? 'its remote'} (git push)` };
    }
    if (sub === 'send-email') return { kind: 'email', program: 'git', what: 'sends patches by email (git send-email)' };
    if ((sub === 'svn' && rest[0] === 'dcommit') || (sub === 'lfs' && rest[0] === 'push')) return { kind: 'push', program: 'git', what: `pushes to its remote (git ${sub} ${rest[0]})` };
    return null;
}

/** What `gh` and `glab` change on the host, by command group. */
const FORGE_WRITES = {
    gh: {
        pr: ['create', 'merge', 'close', 'reopen', 'comment', 'edit', 'review', 'ready', 'lock', 'unlock', 'update-branch', 'revert'],
        issue: ['create', 'close', 'reopen', 'comment', 'edit', 'delete', 'transfer', 'pin', 'unpin', 'lock', 'unlock', 'develop'],
        release: ['create', 'delete', 'delete-asset', 'edit', 'upload'],
        repo: ['create', 'delete', 'edit', 'fork', 'rename', 'archive', 'unarchive', 'sync'],
        gist: ['create', 'edit', 'delete', 'rename'], label: ['create', 'edit', 'delete', 'clone'],
        secret: ['set', 'delete', 'remove'], variable: ['set', 'delete', 'remove'],
        workflow: ['run', 'enable', 'disable'], run: ['rerun', 'cancel', 'delete'], cache: ['delete'],
        codespace: ['create', 'delete', 'edit', 'stop', 'ssh', 'cp', 'rebuild'],
        project: ['create', 'delete', 'edit', 'close', 'copy', 'field-create', 'field-delete', 'item-add', 'item-archive', 'item-create', 'item-delete', 'item-edit', 'link', 'unlink', 'mark-template'],
        'ssh-key': ['add', 'delete'], 'gpg-key': ['add', 'delete'],
    },
    glab: {
        mr: ['create', 'merge', 'close', 'reopen', 'note', 'approve', 'revoke', 'update', 'delete', 'rebase', 'subscribe', 'unsubscribe', 'todo'],
        issue: ['create', 'close', 'reopen', 'note', 'delete', 'update', 'subscribe', 'unsubscribe'],
        release: ['create', 'delete', 'upload'], repo: ['create', 'delete', 'fork', 'archive', 'transfer', 'mirror'],
        ci: ['run', 'retry', 'cancel', 'delete', 'trigger'], variable: ['set', 'delete', 'update', 'import'],
        label: ['create', 'delete'], snippet: ['create'], schedule: ['create', 'delete', 'run'],
    },
};
const FORGE_HOST = { gh: 'GitHub', glab: 'GitLab', hub: 'GitHub' };

function forge(args, program) {
    const at = skipOptions(args, new Set(['R', '--repo', '--hostname']));
    const [group, verb, third] = args.slice(at);
    const where = FORGE_HOST[program];
    if (group === 'api') {
        const rest = args.slice(at + 1);
        const endpoint = positionals(rest, new Set(['X', 'f', 'F', 'H', 'q', 't', 'p', '--method', '--field', '--raw-field', '--header', '--input', '--jq', '--template', '--preview', '--hostname', '--cache']))[0] ?? '';
        if (endpoint === 'graphql') return rest.some((a) => /\bmutation\b/.test(a)) ? { kind: 'request', program, what: `makes a change on ${where} (${program} api graphql mutation)` } : null;
        const method = optionValue(rest, ['-X', '--method']);
        const fields = has(rest, '-f', '-F', '--field', '--raw-field', '--input') || rest.some((a) => /^-[fF]./.test(a));
        const verbOf = method ? method.toUpperCase() : fields ? 'POST' : 'GET';
        return READ_METHODS.has(verbOf) ? null : { kind: 'request', program, what: `sends a ${verbOf} to the ${where} API (${program} api ${endpoint.slice(0, 50)})` };
    }
    if (program === 'gh' && group === 'repo' && verb === 'deploy-key') return ['add', 'delete'].includes(third) ? { kind: 'request', program, what: `makes a change on ${where} (gh repo deploy-key ${third})` } : null;
    if (program === 'hub') {
        const writes = { 'pull-request': true, create: true, fork: true, delete: true, release: ['create', 'edit', 'delete'], issue: ['create', 'update', 'transfer'] };
        const w = writes[group];
        return w === true || (Array.isArray(w) && w.includes(verb)) ? { kind: 'request', program, what: `makes a change on GitHub (hub ${[group, Array.isArray(w) ? verb : ''].join(' ').trim()})` } : null;
    }
    return FORGE_WRITES[program]?.[group]?.includes(verb) ? { kind: 'request', program, what: `makes a change on ${where} (${program} ${group} ${verb})` } : null;
}

/**
 * Publishing and deploying tools, by subcommand: `true` for any use of it,
 * a list for the second word it needs, or a function of the words after it.
 */
const PUBLISH = {
    npm: { publish: true, unpublish: true, deprecate: true, undeprecate: true, 'dist-tag': ['add', 'rm', 'remove'], owner: ['add', 'rm', 'remove'], access: ['set', 'grant', 'revoke', 'public', 'restricted'], star: true, unstar: true },
    pnpm: { publish: true }, yarn: { publish: true, npm: ['publish'] }, bun: { publish: true },
    cargo: { publish: true, yank: true, owner: true }, twine: { upload: true, register: true }, poetry: { publish: true }, flit: { publish: true },
    hatch: { publish: true }, uv: { publish: true }, pdm: { publish: true }, gem: { push: true, yank: true, owner: true },
    dotnet: { nuget: ['push', 'delete'] }, pod: { trunk: ['push', 'delete', 'deprecate', 'add-owner', 'remove-owner'], repo: ['push'] },
    vsce: { publish: true, unpublish: true }, ovsx: { publish: true }, flutter: { pub: ['publish'] }, dart: { pub: ['publish'] },
    mix: { 'hex.publish': true, 'hex.retire': true, 'hex.owner': true }, swift: { 'package-registry': ['publish'] },
    changeset: { publish: true }, lerna: { publish: true }, eas: { submit: true, update: true },
};
const DEPLOY = {
    docker: {
        push: true, stack: ['deploy', 'rm', 'remove', 'up'], service: ['create', 'update', 'rm', 'remove', 'scale', 'rollback'], compose: ['push'],
        image: ['push'], manifest: ['push'], trust: ['sign'],
        build: (rest, args) => imagePush(args), buildx: (rest, args) => ['build', 'bake'].includes(rest[0]) && imagePush(args),
    },
    podman: { push: true, manifest: ['push'], build: (rest, args) => imagePush(args) }, buildah: { push: true, manifest: ['push'] },
    skopeo: { copy: true, delete: true, sync: true },
    crane: { push: true, copy: true, cp: true, delete: true, tag: true, append: true, mutate: true, rebase: true, flatten: true },
    oras: { push: true, attach: true, tag: true, copy: true, cp: true },
    helm: { install: true, upgrade: true, uninstall: true, delete: true, del: true, rollback: true, push: true, test: true },
    kubectl: { apply: true, create: true, delete: true, patch: true, replace: true, scale: true, autoscale: true, rollout: ['restart', 'undo', 'pause', 'resume'], set: true, edit: true, label: true, annotate: true, drain: true, cordon: true, uncordon: true, taint: true, expose: true, run: true, cp: true, exec: true, attach: true, certificate: true },
    terraform: { apply: true, destroy: true, import: true, taint: true, untaint: true, state: ['rm', 'mv', 'push', 'replace-provider'], 'force-unlock': true, workspace: ['new', 'delete'] },
    terragrunt: { apply: true, destroy: true, import: true, 'run-all': ['apply', 'destroy', 'import'], 'apply-all': true, 'destroy-all': true, run: ['apply', 'destroy'] },
    pulumi: { up: true, update: true, destroy: true, import: true, refresh: true, cancel: true, stack: ['rm'] },
    cdk: { deploy: true, destroy: true, bootstrap: true, import: true, watch: true }, cdktf: { deploy: true, destroy: true },
    sam: { deploy: true, delete: true, sync: true, publish: true, remote: ['invoke'] },
    serverless: { deploy: true, remove: true, rollback: true, invoke: (rest) => rest[0] !== 'local' },
    netlify: { deploy: true, 'sites:create': true, 'sites:delete': true, 'env:set': true, 'env:unset': true, 'env:import': true, 'functions:invoke': true },
    wrangler: {
        deploy: true, publish: true, delete: true, rollback: true, secret: ['put', 'delete', 'bulk'], 'kv:key': ['put', 'delete'], 'kv:bulk': ['put', 'delete'],
        kv: (rest) => ['put', 'delete'].includes(rest[1]) || (rest[0] === 'namespace' && ['create', 'delete'].includes(rest[1])),
        r2: (rest) => ['put', 'delete', 'create'].includes(rest[1]), d1: (rest, args) => args.includes('--remote') && ['execute', 'migrations'].includes(rest[0]),
        pages: ['deploy', 'publish'], versions: ['deploy', 'upload'], triggers: ['deploy'], queues: ['create', 'delete'],
    },
    railway: { up: true, deploy: true, down: true, delete: true, redeploy: true, variables: ['set', 'delete'] },
    eb: { deploy: true, create: true, terminate: true, setenv: true, scale: true, restart: true, swap: true, abort: true, upgrade: true },
    nomad: { run: true, stop: true, job: ['run', 'stop', 'dispatch', 'revert', 'scale', 'promote'], deployment: ['promote', 'fail', 'pause', 'resume', 'unblock'], alloc: ['stop', 'restart', 'exec', 'signal'] },
    supabase: { db: (rest, args) => rest[0] === 'push' || (rest[0] === 'reset' && args.includes('--linked')), functions: ['deploy', 'delete'], secrets: ['set', 'unset'], storage: ['cp', 'mv', 'rm'] },
    surge: () => true, 'gh-pages': () => true, np: () => true,
};
const ALIASES = { tofu: 'terraform', oc: 'kubectl', k: 'kubectl', sls: 'serverless', vc: 'vercel', flyctl: 'fly', ncat: 'nc', netcat: 'nc', 'release-it': 'releaseIt', mutt: 'mail', neomutt: 'mail', mailx: 'mail', 's-nail': 'mail' };

const KUBE_TAKES = new Set(['n', 's', '--namespace', '--context', '--kubeconfig', '--server', '--cluster', '--user', '--token', '--as', '--as-group', '--request-timeout', '--certificate-authority', '--client-certificate', '--client-key', '--kube-context', '--kube-token', '--kube-apiserver', '--repository-config', '--registry-config']);
const NPM_TAKES = new Set(['C', 'w', 'F', '--prefix', '--cwd', '--dir', '--directory', '--registry', '--tag', '--access', '--otp', '--workspace', '--userconfig', '--cache', '--loglevel', '--filter', '--scope']);
/** Per program, the options before a subcommand that take the next word as their value. */
const TAKES = {
    default: new Set(['C', '--prefix', '--cwd', '--dir', '--directory']),
    npm: NPM_TAKES, pnpm: NPM_TAKES, yarn: NPM_TAKES, bun: NPM_TAKES,
    kubectl: KUBE_TAKES, helm: KUBE_TAKES,
    terraform: new Set(['-chdir']), terragrunt: new Set(['-chdir', '--terragrunt-working-dir']),
    pulumi: new Set(['C', 's', '--cwd', '--stack']),
    docker: new Set(['c', 'H', 'l', 't', 'f', 'o', '--context', '--host', '--config', '--log-level', '--tlscacert', '--tlscert', '--tlskey', '--tag', '--file', '--platform',
        '--build-arg', '--target', '--output', '--cache-from', '--cache-to', '--label', '--secret', '--ssh', '--progress', '--network', '--builder', '--project-name', 'p']),
    podman: new Set(['c', '--connection', '--url', '--root', '--runroot', '--log-level']),
    cargo: new Set(['C', 'Z', '--manifest-path', '--config', '--color']),
};
/** A build that pushes its image: `--push`, or an output of type registry. */
const imagePush = (args) => has(args, '--push') || args.some((a, i) => /type=registry/.test(a) && (a.startsWith('--output') || /^(-o|--output)$/.test(args[i - 1] ?? '')));

/** A tool from PUBLISH or DEPLOY: its subcommand (and the word after) decides. */
function table(entries, args, program, kind) {
    if (typeof entries === 'function') return entries(args) ? { kind, program, what: `${kind === 'publish' ? 'publishes' : 'deploys'} (${program})` } : null;
    const pos = positionals(args, TAKES[program] ?? TAKES.default);
    const sub = pos[0];
    const rule = sub !== undefined && Object.hasOwn(entries, sub) ? entries[sub] : undefined;
    const rest = pos.slice(1);
    const hit = rule === true || (Array.isArray(rule) && rule.includes(rest[0])) || (typeof rule === 'function' && rule(rest, args));
    if (!hit || dryRun(args)) return null;
    const words = [program, sub, Array.isArray(rule) || (typeof rule === 'function' && /^[a-z][a-z0-9:-]*$/.test(rest[0] ?? '')) ? rest[0] : ''].join(' ').trim();
    if (kind === 'publish') return { kind, program, what: `publishes (${words})` };
    return { kind, program, what: `makes a change with ${program} (${words})` };
}

const CLOUD_VERBS = /^(create|delete|deploy|update|patch|set|add|remove|import|start|stop|restart|reset|resize|rollback|publish|submit|cancel|enable|disable|undelete|restore|attach|detach|apply|upload|ssh|scp|purge|invoke|send|assign|scale|swap|sync|execute|run|move|rename|promote|failover|revoke|grant|rotate|resume|suspend|reboot|terminate|destroy|associate|disassociate|register|deregister|tag|untag)([-_]|$)/;
const CLOUD_READ_GROUPS = { gcloud: ['config', 'auth', 'components', 'info', 'help', 'topic', 'version', 'init', 'feedback', 'survey', 'cheat-sheet'], az: ['login', 'logout', 'account', 'config', 'extension', 'version', 'find', 'upgrade', 'interactive', 'init', 'cloud', 'feedback', 'survey'], doctl: ['auth', 'version', 'completion'] };

/** gcloud, az and doctl: a command whose words include a verb that changes something (`gcloud run deploy`, `az group delete`). */
function cloud(args, program) {
    const pos = positionals(args, new Set(['--project', '--region', '--zone', '--subscription', '--resource-group', 'g', '--output', 'o', '--format', '--query', '--account', '--configuration', '--context', 't', '--access-token']));
    if (pos.length === 0 || CLOUD_READ_GROUPS[program].includes(pos[0])) return null;
    const verb = pos.slice(0, 5).find((w) => CLOUD_VERBS.test(w));
    return verb ? { kind: 'deploy', program, what: `makes a change in the cloud (${program} ${pos.slice(0, pos.indexOf(verb) + 1).join(' ').slice(0, 60)})` } : null;
}

const AWS_TAKES = new Set(['--profile', '--region', '--output', '--endpoint-url', '--query', '--cli-input-json', '--cli-input-yaml', '--color', '--ca-bundle', '--cli-read-timeout', '--cli-connect-timeout', '--page-size', '--max-items', '--starting-token', '--cli-binary-format']);
const AWS_VERBS = /^(create|delete|put|update|modify|start|stop|terminate|run|invoke|publish|send|deploy|register|deregister|attach|detach|associate|disassociate|reboot|restore|tag|untag|enable|disable|import|cancel|reset|set|add|remove|replace|accept|reject|authorize|revoke|copy|upload|execute|apply|batch|transact|purge|complete|abort|change|rotate|restart|promote|failover|initiate|respond|resume|suspend|signal|subscribe|unsubscribe|confirm|allocate|release|assign|unassign|activate|deactivate)(-|$)/;

function aws(args) {
    const pos = positionals(args, AWS_TAKES);
    const [service, op] = pos;
    if (!service || service === 'configure' || service === 'help' || has(args, '--dryrun', '--dry-run')) return null;
    if (service === 's3') {
        if (['rm', 'mb', 'rb'].includes(op)) return { kind: 'deploy', program: 'aws', what: `changes S3 (aws s3 ${op} ${placeOf(pos[2] ?? '')})` };
        if (['cp', 'mv', 'sync'].includes(op) && (/^s3:\/\//i.test(pos.at(-1)) || (op === 'mv' && /^s3:\/\//i.test(pos[2] ?? '')))) return { kind: 'deploy', program: 'aws', what: `copies to S3 (aws s3 ${op} → ${placeOf(pos.at(-1))})` };
        return null;
    }
    return AWS_VERBS.test(op ?? '') ? { kind: 'deploy', program: 'aws', what: `makes a change in AWS (aws ${service} ${op})` } : null;
}

const HEROKU_VERBS = /(^|:)(create|destroy|delete|set|unset|add|remove|push|release|restart|run|promote|rollback|scale|update|transfer|attach|detach|reset|enable|disable|cancel|rename|upgrade|downgrade|kill|stop|start|import|clear)$/;
const FLY_WRITES = new Set(['create', 'destroy', 'delete', 'set', 'unset', 'import', 'deploy', 'run', 'start', 'stop', 'update', 'restart', 'clone', 'kill', 'cordon', 'extend', 'fork', 'attach', 'detach', 'allocate-v4', 'allocate-v6', 'release', 'add', 'remove', 'failover', 'move', 'console', 'sftp']);
const VERCEL_READS = new Set(['dev', 'build', 'pull', 'link', 'login', 'logout', 'whoami', 'ls', 'list', 'inspect', 'logs', 'help', 'init', 'switch', 'bisect', 'telemetry', 'git', 'project', 'projects', 'teams', 'team', 'env', 'certs', 'dns', 'domains', 'alias', 'secrets', 'integration']);
const STRIPE_VERBS = new Set(['create', 'update', 'delete', 'refund', 'cancel', 'capture', 'pay', 'send', 'void', 'finalize', 'approve', 'decline', 'close', 'reject', 'verify', 'resend', 'mark_uncollectible', 'mark-uncollectible', 'trigger', 'post']);

function deployTool(name, args) {
    const pos = positionals(args, new Set(['a', 'app', '--app', 'r', '--remote', 'c', '--config', '--team', '--scope', '--token', '--project', '--profile']));
    if (name === 'heroku') return pos[0] && (HEROKU_VERBS.test(pos[0]) || ['create', 'destroy', 'run', 'restart', 'rollback', 'promote'].includes(pos[0])) ? { kind: 'deploy', program: name, what: `makes a change on Heroku (heroku ${pos[0]})` } : null;
    if (name === 'fly') return ['deploy', 'launch', 'destroy', 'scale'].includes(pos[0]) || FLY_WRITES.has(pos[1]) ? { kind: 'deploy', program: name, what: `makes a change on Fly (fly ${pos.slice(0, 2).join(' ')})` } : null;
    if (name === 'vercel') {
        // Bare, or with a folder, it deploys.
        const sub = pos[0];
        const writes = { env: ['add', 'rm', 'remove'], alias: ['set', 'rm', 'remove'], domains: ['add', 'rm', 'remove', 'move', 'transfer-in', 'buy'], dns: ['add', 'rm', 'remove', 'import'], secrets: ['add', 'rm', 'remove', 'rename'], certs: ['add', 'issue', 'rm', 'remove'], project: ['add', 'rm', 'remove'], projects: ['add', 'rm', 'remove'] };
        if (sub === undefined || !(VERCEL_READS.has(sub) || ['deploy', 'redeploy', 'rm', 'remove', 'promote', 'rollback'].includes(sub)) || ['deploy', 'redeploy', 'rm', 'remove', 'promote', 'rollback'].includes(sub)) {
            if (sub !== undefined && VERCEL_READS.has(sub)) return writes[sub]?.includes(pos[1]) ? { kind: 'deploy', program: name, what: `makes a change on Vercel (vercel ${sub} ${pos[1]})` } : null;
            return { kind: 'deploy', program: name, what: `deploys (vercel${sub && !sub.includes('/') && sub !== '.' ? ` ${sub}` : ''})` };
        }
        return writes[sub]?.includes(pos[1]) ? { kind: 'deploy', program: name, what: `makes a change on Vercel (vercel ${sub} ${pos[1]})` } : null;
    }
    if (name === 'firebase') return pos[0] && (pos[0] === 'deploy' || /:(delete|set|push|update|remove|import|deploy|rollback|disable|clone|distribute|create)$/.test(pos[0])) ? { kind: 'deploy', program: name, what: `makes a change on Firebase (firebase ${pos[0]})` } : null;
    if (name === 'stripe') return pos.slice(0, 3).some((w) => STRIPE_VERBS.has(w)) ? { kind: 'deploy', program: name, what: `makes a change in Stripe (stripe ${pos.slice(0, 3).join(' ')})` } : null;
    if (name === 'goreleaser') return (pos[0] ?? 'release') === 'release' && !has(args, '--snapshot', '--skip-publish') && !args.some((a) => /^--skip=.*publish/.test(a)) ? { kind: 'publish', program: name, what: 'publishes a release (goreleaser)' } : null;
    if (name === 'semantic-release' || name === 'releaseIt') return dryRun(args) || has(args, '-d') ? null : { kind: 'publish', program: name, what: `publishes a release (${name === 'releaseIt' ? 'release-it' : name})` };
    if (name === 'ansible-playbook') return has(args, '--check', '-C', '--syntax-check', '--list-hosts', '--list-tasks', '--list-tags') ? null : { kind: 'remote', program: name, what: 'runs a playbook on other machines (ansible-playbook)' };
    if (name === 'ansible') return has(args, '--list-hosts') || ['ping', 'setup', 'gather_facts', 'debug'].includes(optionValue(args, ['-m', '--module-name'])) ? null : { kind: 'remote', program: name, what: 'runs commands on other machines (ansible)' };
    return null;
}

const SSH_TAKES = new Set([...'bcDEeFIiJLlmOoPpQRSWw', 'B']);

/** `[user@]host:path`, `host::module`, `scp://…`: a place on another machine. */
const remotePath = (a) => /^[a-z][a-z0-9+.-]*:\/\//i.test(a) || (/^[^/\s:]+:/.test(a) && !/^[a-z]:[\\/]/i.test(a));

function remote(name, args) {
    if (name === 'ssh' || name === 'mosh' || name === 'autossh' || name === 'rsh') {
        if (has(args, '-G', '-V', '-Q')) return null;
        const host = positionals(args, SSH_TAKES)[0];
        return { kind: 'remote', program: name, what: `runs commands on ${placeOf(host) || 'another machine'} (${name})` };
    }
    if (name === 'scp' || name === 'rsync') {
        const pos = positionals(args, name === 'scp' ? new Set([...'cDFiJlPoSX']) : new Set(['e', '--rsh', '--rsync-path', '--exclude-from', '--include-from', '--files-from', '--password-file', '--log-file', '--partial-dir', '--temp-dir', '--backup-dir', '--suffix', '--chmod', '--chown', '--timeout', '--contimeout', '--port', '--bwlimit']));
        const dest = pos.at(-1);
        return pos.length > 1 && remotePath(dest) ? { kind: 'remote', program: name, what: `copies files to ${placeOf(dest.replace(/:.*$/, '')) || 'another machine'} (${name})` } : null;
    }
    if (name === 'rclone') {
        const pos = positionals(args, new Set(['--config', '--include', '--exclude', '--filter', '--transfers', '--checkers', '--bwlimit', '--log-file', '--log-level', '--max-age', '--min-age']));
        const [sub, ...paths] = pos;
        const writes = ['copy', 'copyto', 'sync', 'move', 'moveto', 'delete', 'deletefile', 'purge', 'mkdir', 'rmdir', 'rmdirs', 'rcat', 'touch', 'settier', 'bisync', 'cleanup', 'dedupe', 'copyurl'];
        if (!writes.includes(sub)) return null;
        const target = ['copy', 'copyto', 'sync', 'move', 'moveto', 'bisync', 'copyurl'].includes(sub) ? paths.at(-1) : paths[0];
        return target && /^[^/\s:]+:/.test(target) ? { kind: 'remote', program: name, what: `changes files on ${target.replace(/:.*$/, '')} (rclone ${sub})` } : null;
    }
    if (name === 's3cmd' || name === 'gsutil' || name === 'azcopy') {
        const pos = positionals(args, new Set(['-c', '--config', 'o', 'h']));
        const sub = pos[0];
        const dest = pos.at(-1) ?? '';
        const writes = { s3cmd: ['put', 'del', 'rm', 'mb', 'rb', 'setacl', 'setpolicy', 'delpolicy', 'modify', 'restore'], gsutil: ['rm', 'mb', 'rb', 'setmeta', 'acl', 'iam', 'defacl', 'retention'], azcopy: ['remove', 'make', 'rm'] };
        const copy = ['cp', 'mv', 'sync', 'rsync', 'copy'].includes(sub) && /^(s3|gs|https?):\/\//i.test(dest);
        return copy || writes[name].includes(sub) ? { kind: 'remote', program: name, what: `changes files in the cloud (${name} ${sub})` } : null;
    }
    if (['sftp', 'ftp', 'lftp', 'tftp'].includes(name)) return { kind: 'remote', program: name, what: `opens a file transfer to ${placeOf(positionals(args, new Set([...'bBDFiJlPRSoe'])).at(-1) ?? '') || 'another machine'} (${name})` };
    if (name === 'nc') {
        if (args.some((a) => /^-[a-zA-Z]*[zl]/.test(a))) return null;
        return { kind: 'remote', program: name, what: `opens a raw connection to ${positionals(args, new Set([...'ipsswWxXqI']))[0] ?? 'another machine'} (nc)` };
    }
    if (['socat', 'telnet', 'websocat', 'wscat'].includes(name)) return { kind: 'remote', program: name, what: `opens a connection that can send anything (${name})` };
    if (name === 'grpcurl') return args.some((a) => a === 'list' || a === 'describe') ? null : { kind: 'request', program: name, what: 'calls a remote service (grpcurl)' };
    return null;
}

function mail(name, args) {
    if (name === 'sendmail' && args.some((a) => /^-b[vtp]$/.test(a))) return null;
    if (name === 'mail' && !args.some((a) => a.includes('@')) && !has(args, '-s')) return null;
    return { kind: 'email', program: name, what: `sends email (${name})` };
}

// ── Code ──────────────────────────────────────────────────────────────────

const CODE_SENDS = [
    [/\b(?:requests|httpx|urllib3|session|aiohttp|client)\s*\.\s*(post|put|patch|delete)\s*\(/i, (m) => `a ${m[1].toUpperCase()}`],
    [/\.\s*(?:request|open)\s*\(\s*['"](POST|PUT|PATCH|DELETE)['"]/i, (m) => `a ${m[1].toUpperCase()}`],
    [/\bhttp\.(Post|PostForm)\s*\(|\bNet::HTTP\.(post|post_form|put|patch|delete)\b/, (m) => `a ${(m[1] ?? m[2]).replace(/_form$|Form$/, '').toUpperCase()}`],
    [/\bmethod\s*[:=]\s*['"`](POST|PUT|PATCH|DELETE)['"`]/i, (m) => `a ${m[1].toUpperCase()}`],
    [/\b(?:axios|got|ky|superagent|needle|ofetch|\$fetch|undici)\s*\.\s*(post|put|patch|delete)\s*\(/i, (m) => `a ${m[1].toUpperCase()}`],
    [/\burlopen\s*\([^)]*\bdata\s*=/, () => 'a POST'],
    [/\bNet::HTTP::(Post|Put|Patch|Delete)\b|\b(?:HTTParty|Faraday|RestClient)\s*\.\s*(post|put|patch|delete)\b/, (m) => `a ${(m[1] ?? m[2]).toUpperCase()}`],
    [/\bHTTP::Request->new\(\s*['"]?(POST|PUT|PATCH|DELETE)/, (m) => `a ${m[1]}`],
    [/\bCURLOPT_(?:POST|POSTFIELDS|UPLOAD|CUSTOMREQUEST)\b/, () => 'a request that changes something'],
    [/\bInvoke-(?:WebRequest|RestMethod)\b[^\n]*-Method\s+['"]?(Post|Put|Patch|Delete)\b/i, (m) => `a ${m[1].toUpperCase()}`],
];
const CODE_MAIL = /\b(?:smtplib|nodemailer|Net::SMTP|Mail::Sendmail|PHPMailer|Send-MailMessage)\b/;

/** Code that runs commands: then its strings and lists of strings are read as command lines. */
const SPAWNS = /\b(?:subprocess|os\.system|os\.popen|os\.exec\w*|pexpect|child_process|execSync|execFileSync|spawnSync|spawn|execFile|execa|execaSync|Bun\.spawn|Bun\.\$|Deno\.Command|Deno\.run|Open3|shell_exec|passthru|proc_open|popen|system|exec|IO\.popen|Process\.(?:spawn|start)|ProcessBuilder|Runtime\.getRuntime)\b|\$`|%x[({[]|\bqx[({[/]/;

/**
 * What code sends: a web request with a method that changes something, or
 * an email; or a command line it runs (a string that starts with a known
 * program, or a list of its words) that sends.
 * @returns {{kind: string, what: string, program: string}|null}
 */
export function codeSendOf(code, ctx = { depth: 0 }, program = 'code') {
    const text = String(code ?? '');
    for (const [re, said] of CODE_SENDS) {
        const m = re.exec(text);
        if (m) return { kind: 'request', program, what: `runs code that sends ${said(m)} (${program})` };
    }
    if (CODE_MAIL.test(text)) return { kind: 'email', program, what: `runs code that sends email (${program})` };
    // Its strings are read as commands only where it runs commands, so a message that mentions one is no send.
    if ((ctx.depth ?? 0) >= MAX_DEPTH || !SPAWNS.test(text)) return null;
    const deeper = { ...ctx, depth: (ctx.depth ?? 0) + 1 };
    const said = (found) => (found ? { ...found, what: `runs code that ${found.what}` } : null);
    // A program and its words as a list: `spawn('git', ['push'])`, `subprocess.run(['git', 'push'])`.
    for (const m of text.matchAll(/(['"])([^'"\n]{1,200})\1\s*,\s*\[([^\]]{0,600})\]/g)) {
        const found = wordsSendOf([m[2], ...[...m[3].matchAll(/(['"])([^'"\n]*)\1/g)].map((w) => w[2])], deeper);
        if (found) return said(found);
    }
    for (const m of text.matchAll(/\[\s*((?:(['"])[^'"\n]{0,200}\2\s*,\s*){1,30}(['"])[^'"\n]{0,200}\3)\s*,?\s*\]/g)) {
        const found = wordsSendOf([...m[1].matchAll(/(['"])([^'"\n]*)\1/g)].map((w) => w[2]), deeper);
        if (found) return said(found);
    }
    // A command line as one string: `execSync('git push')`, `os.system("curl -X POST …")`.
    for (const m of text.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.){3,400})\1/g)) {
        if (!/\s/.test(m[2])) continue;
        const found = lineSendOf(m[2].replace(/\$\{[^}]*\}/g, 'X'), deeper);
        if (found) return said(found);
    }
    return null;
}

// ── Scripts and tasks ─────────────────────────────────────────────────────

/** Words in a name that say it sends: always, or only when what it runs can't be read. */
const STRONG = new Set(['deploy', 'deploys', 'deployment', 'deployments', 'redeploy', 'undeploy', 'publish', 'upload', 'uploads', 'ship', 'rollout', 'promote', 'notify', 'announce', 'broadcast']);
const WEAK = new Set(['release', 'releases', 'push', 'send', 'submit']);

/** The words of a name: `scripts/publish-npm.mjs` and `pushImage` give [scripts, publish, npm, mjs] and [push, image]. */
function nameWords(name) {
    return String(name).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean);
}
function sendingName(name, known) {
    const words = nameWords(name);
    return words.some((w) => STRONG.has(w)) || (!known && words.some((w) => WEAK.has(w)));
}

/** A test's file: `test/x.mjs`, `x.test.js`, `test_x.py`, `x_test.go`, `spec/x_spec.rb`. */
const TEST_FILE = /(^|\/)(tests?|__tests__|spec|specs|e2e)\/|[._-](test|spec)\.[a-z]+$|(^|\/)test_[^/]*\.py$|_test\.[a-z]+$/i;
const SCRIPT_EXT = /\.(sh|bash|zsh|ksh|py|js|mjs|cjs|ts|mts|rb|pl|php|ps1|lua|r)$/i;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash', 'fish', 'mksh']);
const INTERPRETERS = new Set(['python', 'python2', 'python3', 'node', 'nodejs', 'deno', 'bun', 'ruby', 'perl', 'php', 'rscript', 'lua', 'ts-node', 'tsx', 'osascript', 'pwsh', 'powershell']);
const isPython = (name) => /^python(\d+(\.\d+)?)?$/.test(name);

/** A folder named from another, or null when it can't be told (the other is unknown, the name has a variable or a ~). */
function within(cwd, dir) {
    if (typeof dir !== 'string' || dir.includes('$') || dir.startsWith('~')) return null;
    if (isAbsolute(dir)) return dir;
    return typeof cwd === 'string' ? resolve(cwd, dir) : null;
}

/** A file a command names, read through the caller (only files in the workspace are given). */
function readScript(ctx, path) {
    if (typeof ctx.read !== 'function' || typeof path !== 'string' || path === '' || path.includes('$') || path.startsWith('~')) return undefined;
    if (!isAbsolute(path) && (ctx.cwd === null || ctx.cwd === undefined)) return undefined;
    const full = isAbsolute(path) ? path : resolve(ctx.cwd, path);
    try {
        const text = ctx.read(full);
        return typeof text === 'string' ? { text, full } : undefined;
    } catch {
        return undefined;
    }
}

/** Code or a shell script, by its first line, else by the program or the file's name. */
function contentSendOf(text, how, ctx, label) {
    const first = text.slice(0, 200).split('\n')[0];
    // `#!/usr/bin/env -S node --flag` runs node.
    const shebang = first.startsWith('#!') ? programOf(first.slice(2).trim().split(/\s+/).find((w, i) => !(i === 0 && /\/env$/.test(w)) && !w.startsWith('-')) ?? '') : undefined;
    const kind = shebang ?? how;
    if (SHELLS.has(kind) || (kind === undefined && /\.(sh|bash|zsh|ksh)$/i.test(label))) return lineSendOf(text, ctx);
    return codeSendOf(text, ctx, kind ?? 'code');
}

/** A script run from a file: by its name, and by what it runs when it can be read. */
function scriptSendOf(path, how, ctx) {
    const shown = String(path);
    if (TEST_FILE.test(shown)) return null;
    const file = (ctx.depth ?? 0) < MAX_DEPTH ? readScript(ctx, shown) : undefined;
    if (file) {
        const deeper = { ...ctx, depth: (ctx.depth ?? 0) + 1, cwd: dirname(file.full) };
        const inside = contentSendOf(file.text, how, deeper, shown);
        if (inside) return { kind: 'script', program: inside.program, what: `runs ${shown}, which ${inside.what}` };
    }
    return sendingName(basename(shown), file !== undefined) ? { kind: 'script', program: basename(shown), what: `runs ${shown}, whose name says it ${nameVerb(shown)}` } : null;
}

/** The sending word a name holds, for the user: "deploys", "publishes". */
function nameVerb(name) {
    const word = nameWords(name).find((w) => STRONG.has(w) || WEAK.has(w)) ?? 'sends';
    const verbs = { deploy: 'deploys', deploys: 'deploys', deployment: 'deploys', deployments: 'deploys', redeploy: 'deploys', undeploy: 'undeploys', publish: 'publishes', upload: 'uploads', uploads: 'uploads', ship: 'ships', rollout: 'rolls out', promote: 'promotes', notify: 'notifies', announce: 'announces', broadcast: 'broadcasts', release: 'releases', releases: 'releases', push: 'pushes', send: 'sends', submit: 'submits' };
    return verbs[word] ?? 'sends';
}

/** `npm run X`, `yarn X`, `pnpm X`, `bun run X`: the script in package.json, and the ones npm runs around it. */
function packageScript(program, name, ctx, prefix, label = `${program} run ${name}`) {
    const pkg = readScript({ ...ctx, cwd: prefix ? within(ctx.cwd, prefix) : ctx.cwd }, 'package.json');
    let scripts;
    try { scripts = pkg ? JSON.parse(pkg.text)?.scripts : undefined; } catch { scripts = undefined; }
    if (scripts && typeof scripts === 'object' && (ctx.depth ?? 0) < MAX_DEPTH) {
        const deeper = { ...ctx, depth: (ctx.depth ?? 0) + 1, cwd: dirname(pkg.full) };
        for (const key of [`pre${name}`, name, `post${name}`]) {
            if (typeof scripts[key] !== 'string') continue;
            const inside = lineSendOf(scripts[key], deeper);
            if (inside) return { kind: 'script', program: inside.program, what: `runs ${label}, which ${inside.what}` };
        }
    }
    const known = scripts !== undefined && typeof scripts?.[name] === 'string';
    return sendingName(name, known) ? { kind: 'script', program, what: `runs ${label}, whose name says it ${nameVerb(name)}` } : null;
}

/** A make target's recipe lines, from the Makefile (a rule's own lines, not its prerequisites'). */
/** A make target's rule: its recipe lines and its prerequisites (all the rules for it, joined). */
function makeRule(text, target) {
    const recipes = [];
    const needs = [];
    let inRule = false;
    for (const line of text.replace(/\\\n/g, ' ').split('\n')) {
        if (line.startsWith('\t')) {
            if (inRule) recipes.push(line.slice(1).replace(/^[@+-]+/, ''));
            continue;
        }
        const m = /^([^:#=\t][^:=]*?)\s*::?(?!=)(.*)$/.exec(line);
        if (m) {
            inRule = m[1].trim().split(/\s+/).includes(target);
            if (inRule) {
                const [deps, recipe] = m[2].split(';');
                needs.push(...deps.split('|').join(' ').trim().split(/\s+/).filter((d) => d !== '' && !d.includes('$') && !d.includes('%')));
                if (recipe !== undefined && recipe.trim() !== '') recipes.push(recipe.trim());
            }
        } else if (line.trim() !== '' && !line.startsWith('#')) inRule = false;
    }
    return { recipes, needs };
}

/** What a make target runs, its prerequisites first (each once). */
function makeSendOf(makefile, target, ctx, seen = new Set()) {
    if (seen.has(target) || seen.size > 40) return null;
    seen.add(target);
    const { recipes, needs } = makeRule(makefile.text, target);
    for (const need of needs) {
        const found = makeSendOf(makefile, need, ctx, seen);
        if (found) return found;
    }
    for (const recipe of recipes) {
        const found = lineSendOf(recipe.replace(/\$\(MAKE\)|\$\{MAKE\}/g, 'make'), ctx);
        if (found) return found;
    }
    return null;
}

function make(args, ctx) {
    // Only says what it would run.
    if (args.some((a) => /^-[a-zA-Z]*[nqp]/.test(a) && !a.startsWith('--')) || has(args, '--dry-run', '--just-print', '--recon', '--question', '--print-data-base')) return null;
    const dir = optionValue(args, ['-C', '--directory']);
    const file = optionValue(args, ['-f', '--file', '--makefile']);
    const where = { ...ctx, cwd: dir ? within(ctx.cwd, dir) : ctx.cwd };
    const targets = positionals(args, new Set(['C', 'f', 'I', 'o', 'W', 'j', 'l', '--directory', '--file', '--makefile', '--include-dir', '--old-file', '--what-if', '--jobs', '--load-average'])).filter((t) => !t.includes('='));
    const makefile = file ? readScript(where, file) : (readScript(where, 'GNUmakefile') ?? readScript(where, 'makefile') ?? readScript(where, 'Makefile'));
    let wanted = targets;
    if (wanted.length === 0 && makefile) {
        const first = makefile.text.split('\n').map((l) => /^([^.:#=\t\s][^:=\s]*)\s*::?(?!=)/.exec(l)).find(Boolean);
        wanted = first ? [first[1]] : [];
    }
    for (const target of wanted) {
        if (makefile && (ctx.depth ?? 0) < MAX_DEPTH) {
            const inside = makeSendOf(makefile, target, { ...where, depth: (ctx.depth ?? 0) + 1, cwd: dirname(makefile.full) });
            if (inside) return { kind: 'script', program: inside.program, what: `runs make ${target}, which ${inside.what}` };
        }
        if (sendingName(target, makefile !== undefined)) return { kind: 'script', program: 'make', what: `runs make ${target}, whose name says it ${nameVerb(target)}` };
    }
    return null;
}

/** Task runners whose tasks the plugin doesn't read: by the task's name. */
const RUNNERS = new Set(['just', 'task', 'rake', 'gulp', 'grunt', 'invoke', 'inv', 'nox', 'tox', 'mage', 'fab', 'poe', 'fastlane', 'cake']);

/** npm, pnpm, yarn and bun: publishing, running a package's binary, or running a script. */
const YARN_OWN = new Set(['add', 'install', 'remove', 'upgrade', 'up', 'init', 'info', 'why', 'list', 'config', 'cache', 'workspaces', 'workspace', 'set', 'plugin', 'version', 'pack', 'bin', 'link', 'unlink', 'audit', 'outdated', 'global', 'import', 'licenses', 'login', 'logout', 'owner', 'tag', 'team', 'create', 'node', 'patch', 'patch-commit', 'rebuild', 'constraints', 'dedupe', 'explain', 'search', 'stage', 'unplug', 'check']);
const PNPM_OWN = new Set(['add', 'install', 'i', 'remove', 'rm', 'uninstall', 'update', 'up', 'upgrade', 'init', 'list', 'ls', 'why', 'outdated', 'audit', 'config', 'store', 'link', 'unlink', 'prune', 'rebuild', 'import', 'pack', 'patch', 'patch-commit', 'env', 'setup', 'server', 'root', 'bin', 'licenses', 'fetch', 'dedupe', 'create', 'deploy', 'doctor', 'cache']);

function packageManager(name, args, ctx) {
    const rest = args.slice(skipOptions(args, NPM_TAKES));
    const prefix = optionValue(args, ['--prefix', '-C', '--dir', '--cwd']);
    const [sub, ...more] = rest;
    if (sub === undefined) return null;
    const fromTable = table(PUBLISH[name] ?? {}, rest, name, 'publish');
    if (fromTable) return fromTable;
    if ((name === 'npm' && (sub === 'exec' || sub === 'x')) || ((name === 'pnpm' || name === 'yarn') && (sub === 'exec' || sub === 'dlx')) || (name === 'bun' && sub === 'x')) {
        const words = more.slice(skipOptions(more, new Set(['p', '--package', 'c', '--call'])));
        const call = optionValue(more, ['-c', '--call']);
        if (call !== undefined) return lineSendOf(call, ctx);
        return words.length > 0 ? wordsSendOf([packageBin(words[0]), ...words.slice(1)], ctx) : null;
    }
    // pnpm's own `deploy` copies a package to a folder: no send.
    if (name === 'pnpm' && sub === 'deploy') return null;
    if (sub === 'run' || sub === 'run-script' || sub === 'rum' || sub === 'urn') {
        const script = more.find((w) => !w.startsWith('-'));
        return script ? packageScript(name, script, ctx, prefix) : null;
    }
    // `npm version` runs preversion, version and postversion (a push, often).
    if (name === 'npm' && ['start', 'test', 't', 'restart', 'stop', 'version'].includes(sub)) return packageScript(name, sub === 't' ? 'test' : sub, ctx, prefix, `npm ${sub}`);
    if ((name === 'yarn' && !YARN_OWN.has(sub)) || (name === 'pnpm' && !PNPM_OWN.has(sub))) return packageScript(name, sub, ctx, prefix, `${name} ${sub}`);
    if (name === 'bun' && !['install', 'i', 'add', 'remove', 'rm', 'update', 'upgrade', 'init', 'create', 'link', 'unlink', 'pm', 'build', 'test', 'outdated', 'patch', 'repl', 'exec'].includes(sub)) {
        if (SCRIPT_EXT.test(sub) || sub.includes('/')) return scriptSendOf(sub, 'bun', ctx);
        return packageScript(name, sub, ctx, prefix, `bun ${sub}`);
    }
    return null;
}

/** Python run as `python -m twine upload` or on a file or on code. */
function interpreter(name, args, ctx, inputs) {
    const deeper = { ...ctx, depth: (ctx.depth ?? 0) + 1 };
    // A syntax check runs nothing: `bash -n`, `node --check`, `ruby -c`, `perl -c`, `php -l`.
    const short = (letter) => args.some((a) => !a.startsWith('--') && new RegExp(`^-[a-zA-Z]*${letter}[a-zA-Z]*$`).test(a));
    if ((SHELLS.has(name) && (short('n') || has(args, '--no-execute'))) || ((name === 'node' || name === 'nodejs') && (has(args, '--check') || args.includes('-c')))
        || ((name === 'ruby' || name === 'perl') && args.includes('-c')) || (name === 'php' && args.includes('-l'))) return null;
    if (SHELLS.has(name) || name === 'source' || name === '.') {
        const c = name === 'source' || name === '.' ? undefined : args.findIndex((a) => /^-[a-z]*c[a-z]*$/i.test(a) && !a.startsWith('--'));
        if (c !== undefined && c >= 0) return args[c + 1] !== undefined && (ctx.depth ?? 0) < MAX_DEPTH ? lineSendOf(args[c + 1], deeper) : null;
        const file = positionals(args, new Set(['o', 'O', '--init-file', '--rcfile']))[0];
        if (file !== undefined && file !== '-') return scriptSendOf(file, name === 'source' || name === '.' ? 'bash' : name, ctx);
        for (const input of inputs) { const found = (ctx.depth ?? 0) < MAX_DEPTH ? lineSendOf(input, deeper) : null; if (found) return found; }
        return null;
    }
    if (name === 'pwsh' || name === 'powershell') {
        const command = optionValue(args.map((a) => (/^-(c|command)$/i.test(a) ? '-Command' : a)), ['-Command']);
        if (command !== undefined) return (ctx.depth ?? 0) < MAX_DEPTH ? lineSendOf(command, { ...deeper, shell: 'pwsh' }) : null;
        const file = optionValue(args.map((a) => (/^-(f|file)$/i.test(a) ? '-File' : a)), ['-File']);
        return file !== undefined ? scriptSendOf(file, 'pwsh', ctx) : null;
    }
    let code = optionValue(args, isPython(name) ? ['-c'] : name === 'php' ? ['-r'] : name === 'osascript' ? ['-e'] : ['-e', '--eval', '-p', '--print', '-E']);
    if (name === 'osascript') {
        const script = args.filter((_, i) => args[i - 1] === '-e').join('\n');
        if (script && /\bsend\b|tell application "(Messages|Mail|Microsoft Outlook|Slack)"/i.test(script)) return { kind: 'message', program: name, what: 'sends a message (osascript)' };
        code = undefined;
        if (script) return null;
    }
    if (code !== undefined) return codeSendOf(code, deeper, name);
    if (isPython(name)) {
        const m = optionValue(args, ['-m']);
        if (m !== undefined) return wordsSendOf([m, ...args.slice(args.indexOf(m) + 1)], ctx);
    }
    if (name === 'deno' && args[0] === 'eval') return codeSendOf(args[1] ?? '', deeper, name);
    const pos = positionals(args, isPython(name) ? new Set(['W', 'X', 'Q']) : new Set(['r', '--require', '--import', '--loader', '--experimental-loader', '--env-file', '-C', '--conditions']));
    const file = name === 'deno' && pos[0] === 'run' ? pos[1] : pos[0];
    if (file !== undefined && file !== '-') return scriptSendOf(file, name, ctx);
    for (const input of inputs) { const found = codeSendOf(input, deeper, name); if (found) return found; }
    return null;
}

// ── One command, one line ─────────────────────────────────────────────────

/** What one simple command (its words) sends, or null. */
function wordsSendOf(rawWords, ctx, inputs = []) {
    const words = commandOf(rawWords);
    if (words.length === 0) return null;
    const first = words[0];
    let name = programOf(first);
    name = ALIASES[name] ?? name;
    const args = words.slice(1);
    // Help and version text only.
    if (args.includes('--help') || args.includes('--version')) return null;
    if (name === 'eval') return (ctx.depth ?? 0) < MAX_DEPTH ? lineSendOf(args.join(' '), { ...ctx, depth: (ctx.depth ?? 0) + 1 }) : null;
    if (['npx', 'bunx', 'pnpx'].includes(name)) {
        const call = optionValue(args, ['-c', '--call']);
        if (call !== undefined) return lineSendOf(call, ctx);
        const rest = args.slice(skipOptions(args, new Set(['p', '--package'])));
        return rest.length > 0 ? wordsSendOf([packageBin(rest[0]), ...rest.slice(1)], ctx) : null;
    }
    // Runners of a tool or a project's command: `uvx twine upload`, `poetry run python x.py`, `uv tool run …`.
    const from = name === 'uvx' ? 0
        : (name === 'pipx' || ['uv', 'poetry', 'pipenv', 'pdm', 'hatch', 'rye', 'conda', 'mamba', 'micromamba'].includes(name)) && args[0] === 'run' ? 1
        : name === 'uv' && args[0] === 'tool' && args[1] === 'run' ? 2 : -1;
    if (from >= 0) {
        const rest = args.slice(from);
        const command = rest.slice(skipOptions(rest, new Set(['n', 'p', 'e', '--with', '--python', '--project', '--directory', '--from', '--name', '--prefix', '--env', '--spec', '--package'])));
        return command.length > 0 ? wordsSendOf(command, ctx) : null;
    }
    // What `find` runs on each file: `find . -exec curl -T {} … \;`.
    if (name === 'find') {
        for (let i = 0; i < args.length; i++) {
            if (!['-exec', '-execdir', '-ok', '-okdir'].includes(args[i])) continue;
            const end = args.findIndex((a, k) => k > i && (a === ';' || a === '+'));
            const found = wordsSendOf(args.slice(i + 1, end < 0 ? args.length : end), ctx);
            if (found) return found;
        }
        return null;
    }
    switch (name) {
        case 'curl': return ctx.shell === 'pwsh' && args.some((a) => /^-(method|body|uri|infile)(:|$)/i.test(a)) ? webCmdlet(args, 'curl') : curl(args);
        case 'wget': return ctx.shell === 'pwsh' && args.some((a) => /^-(method|body|uri|infile)(:|$)/i.test(a)) ? webCmdlet(args, 'wget') : wget(args);
        case 'http': case 'https': case 'xh': case 'xhs': return httpie(args, name);
        case 'invoke-webrequest': case 'invoke-restmethod': case 'iwr': case 'irm': return webCmdlet(args, name);
        case 'send-mailmessage': return { kind: 'email', program: name, what: 'sends email (Send-MailMessage)' };
        case 'git': return git(args);
        case 'gh': case 'glab': case 'hub': return forge(args, name);
        case 'aws': return aws(args);
        case 'gcloud': case 'az': case 'doctl': return cloud(args, name);
        case 'npm': case 'pnpm': case 'yarn': case 'bun': return packageManager(name, args, ctx);
        case 'make': case 'gmake': case 'bmake': return make(args, ctx);
        case 'mvn': case 'mvnw': return args.some((a) => /^(deploy|release:perform|site-deploy|deploy:deploy-file|jib:build)$/.test(a)) ? { kind: 'publish', program: name, what: 'publishes (mvn deploy)' } : null;
        case 'gradle': case 'gradlew': {
            const task = args.find((a) => /^(:[\w-]+)*:?(publish|upload|deploy|release|jib|pushImage|bintrayUpload|artifactoryPublish)\w*$/i.test(a));
            return task ? { kind: 'publish', program: name, what: `publishes (gradle ${task})` } : null;
        }
        case 'twine': case 'poetry': case 'flit': case 'hatch': case 'pdm': case 'uv': case 'gem': case 'cargo': case 'dotnet': case 'pod': case 'vsce': case 'ovsx':
        case 'flutter': case 'dart': case 'mix': case 'swift': case 'changeset': case 'lerna': case 'eas':
            return table(PUBLISH[name], args, name, 'publish');
        case 'ssh': case 'mosh': case 'autossh': case 'rsh': case 'scp': case 'rsync': case 'rclone': case 's3cmd': case 'gsutil': case 'azcopy':
        case 'sftp': case 'ftp': case 'lftp': case 'tftp': case 'nc': case 'socat': case 'telnet': case 'websocat': case 'wscat': case 'grpcurl':
            return remote(name, args);
        case 'sendmail': case 'mail': case 'msmtp': case 'swaks': case 'ssmtp': case 'esmtp': return mail(name, args);
        case 'heroku': case 'fly': case 'vercel': case 'firebase': case 'stripe': case 'goreleaser': case 'semantic-release': case 'releaseIt':
        case 'ansible-playbook': case 'ansible':
            return deployTool(name, args);
        default: break;
    }
    if (Object.hasOwn(DEPLOY, name)) return table(DEPLOY[name], args, name, 'deploy');
    if (RUNNERS.has(name)) {
        const task = positionals(args, new Set(['f', 'd', '--justfile', '--taskfile', '--dir', '-t'])).find((t) => sendingName(t, false));
        return task ? { kind: 'script', program: name, what: `runs ${name} ${task}, whose name says it ${nameVerb(task)}` } : null;
    }
    if (SHELLS.has(name) || INTERPRETERS.has(name) || isPython(name) || name === 'source' || name === '.') return interpreter(name, args, ctx, inputs);
    if (first.includes('/') || SCRIPT_EXT.test(first)) return scriptSendOf(first, undefined, ctx);
    return null;
}

/** What a command line sends: each of its commands, then the command lines inside it. */
function lineSendOf(text, ctx) {
    const { commands, nested } = splitShell(text);
    let here = ctx;
    for (let i = 0; i < commands.length; i++) {
        const { words, inputs } = commands[i];
        // A later command runs where `cd` went: `cd web && npm run deploy`.
        // Somewhere it can't tell (`cd "$DIR"`, `cd ~/x`, `cd -`), no file is read: names alone count.
        if (words[0] === 'cd' || words[0] === 'pushd' || words[0] === 'popd') {
            const to = words.length === 2 ? words[1] : undefined;
            here = { ...here, cwd: to === undefined || /^[~$-]/.test(to) || to.includes('$') ? null : within(here.cwd, to) };
            continue;
        }
        // Text piped into an interpreter is its code: `cat <<EOF | python3`, `echo '…' | node`.
        const before = i > 0 && commands[i - 1].pipe ? commands[i - 1] : undefined;
        const fed = before ? [...before.inputs, ...(['echo', 'printf'].includes(before.words[0]) ? [before.words.slice(1).filter((w) => !/^-[neE]+$/.test(w)).join(' ')] : [])] : [];
        const found = wordsSendOf(words, here, [...inputs, ...fed]);
        if (found) return found;
    }
    if ((ctx.depth ?? 0) < MAX_DEPTH) {
        for (const inner of nested) {
            const found = lineSendOf(inner, { ...ctx, depth: (ctx.depth ?? 0) + 1 });
            if (found) return found;
        }
    }
    return null;
}

/**
 * What a shell command sends outside the workspace, or null.
 * @param {string} command - the command line, as the shell tool gets it.
 * @param {object} [options]
 * @param {'bash'|'pwsh'} [options.shell] - which shell runs it.
 * @param {string} [options.cwd] - the folder it runs in, for the files it names.
 * @param {(path: string) => string|undefined} [options.read] - a file's text by its full path, or undefined (only files the caller lets it read).
 * @returns {{kind: string, what: string, program: string}|null} what it sends, said after "it": "sends a POST to 127.0.0.1:8787/deploy (curl)".
 */
export function sendOf(command, options = {}) {
    if (typeof command !== 'string' || command.trim() === '') return null;
    return lineSendOf(command, { depth: 0, shell: options.shell ?? 'bash', cwd: options.cwd, read: options.read });
}
