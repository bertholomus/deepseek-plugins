/**
 * Words for Canon's search: one way to cut text into terms, used for the
 * notes and for the prompts, so a note's "Deploying" meets a prompt's
 * "deploys". Light stemming, and stop words that include the filler of a
 * chat ("thanks", "looks good", "please carry on"), so a prompt that asks
 * nothing finds nothing.
 *
 * @module dsh-plugin-canon/text
 */

/**
 * Words that say nothing about what a note or a prompt is about ("called"
 * and "named" only name a thing: "what is the mascot called?").
 */
export const STOP = new Set(`
a about above after again against all almost also am an and another any anyone anything anyway are aren around as at
away back be because been before being below between both but by can cannot could couldn did didn do does doesn doing
don done down during each either else enough etc even ever every few for from further get gets getting give given go
goes going gone got had has hasn have haven having he her here hers herself him himself his how however i if in into is
isn it its itself just keep kind know last least let lets like likely made make makes many may maybe me might mine more
most much must my myself need needs neither never new next no nor not now of off often oh ok okay on once one only onto
or other others our ours ourselves out over per perhaps please pretty quite rather re really right said same say
says see seem seems shall she should shouldn show since so some something sometimes soon still such sure take tell than
thank thanks thats the their theirs them themselves then there these they thing things think this those though through
thus to too try trying two under until up upon us use used uses using very via want wants was wasn way we well were
weren what whatever when where whether which while who whom whose why will with within without won would wouldn yeah
yes yet you your yours yourself yourselves
hi hello hey thx ty cool nice great good fine awesome perfect looks look looking sounds sound ahead carry continue
proceed lgtm sorry wait hmm hm ah ugh anyway also again stuff bit lot lots really actually basically just
called named that although unless already always usually none nothing everything someone everyone somebody anybody
everybody less
`.split(/\s+/).filter(Boolean));

/**
 * A word's stem: plural and verb endings off, and a last "e" off longer
 * words, so forms of one word meet ("rotate", "rotated", "rotating" →
 * "rotat"; "stores", "stored" → "stor"). Numbers stay as they are.
 */
export function stem(word) {
    let w = word;
    if (w.length <= 3 || /\d/.test(w)) return w;
    if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (/(?:ss|sh|ch|x|z)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith('s') && !/(?:ss|us|is|ous)$/.test(w)) w = w.slice(0, -1);
    if (w.endsWith('ing') && w.length - 3 >= 4) w = undouble(w.slice(0, -3));
    else if (w.endsWith('ed') && w.length - 2 >= 4) w = undouble(w.slice(0, -2));
    else if (w.endsWith('ly') && w.length > 5) w = w.slice(0, -2);
    if (w.endsWith('e') && w.length >= 5) w = w.slice(0, -1);
    return w;
}

/** "runn" → "run", "stopp" → "stop"; "fall" and "pass" keep theirs. */
function undouble(w) {
    return /([b-df-hj-np-tv-z])\1$/.test(w) && !/(?:ll|ss|zz|ff)$/.test(w) ? w.slice(0, -1) : w;
}

/**
 * Short forms people write for words notes spell out, and the reverse:
 * read as the whole word, in notes and prompts alike, so "certs" meets
 * "certificates", "DB" meets "database" and "auth" meets "Authentication".
 */
export const SHORT_FORMS = Object.freeze(Object.fromEntries(Object.entries({
    authentication: 'auth authn',
    authorization: 'authz',
    certificate: 'cert certs',
    configuration: 'config configs cfg conf',
    database: 'db dbs',
    dependency: 'dep deps',
    documentation: 'docs',
    environment: 'env envs',
    error: 'err errs',
    function: 'func fn',
    implementation: 'impl',
    information: 'info',
    kubernetes: 'k8s',
    infrastructure: 'infra',
    library: 'lib libs',
    message: 'msg msgs',
    millisecond: 'ms msec',
    operations: 'ops',
    package: 'pkg pkgs',
    performance: 'perf',
    production: 'prod',
    repository: 'repo repos',
    request: 'req reqs',
    response: 'resp',
    second: 'secs',
    minute: 'mins',
    tls: 'ssl',
}).flatMap(([word, shorts]) => shorts.split(' ').map((short) => [short, word]))));

const SPLIT = /[^\p{L}\p{N}]+/u;
const CAMEL = /(?<=[\p{Ll}\p{N}])(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/u;

/**
 * The terms of a text, in order, repeats kept: lower case, stemmed, stop
 * words and one-letter words dropped; a camelCase word also gives its parts.
 * @param {string} text
 * @param {{ max?: number }} [options] - stop after this many terms.
 */
export function terms(text, { max = Infinity } = {}) {
    const out = [];
    if (typeof text !== 'string' || text === '') return out;
    for (const raw of text.split(SPLIT)) {
        if (raw === '') continue;
        const parts = raw.length > 3 && CAMEL.test(raw) ? [raw, ...raw.split(CAMEL)] : [raw];
        for (const part of parts) {
            const lower = SHORT_FORMS[part.toLowerCase()] ?? part.toLowerCase();
            if (lower.length < 2 || lower.length > 40 || STOP.has(lower)) continue;
            if (/^\d+$/.test(lower) && lower.length < 2) continue;
            const s = stem(lower);
            if (s.length < 2 || STOP.has(s)) continue;
            out.push(s);
            if (out.length >= max) return out;
        }
    }
    return out;
}

/** The distinct terms of a text, in first-seen order. */
export function distinctTerms(text, options) {
    return [...new Set(terms(text, options))];
}

/**
 * Words about the vault itself and about answering from it ("answer from
 * the team's shared notes and cite the note", "is it in the canon vault?"),
 * as terms: they say where to look and how to answer, not what about, so a
 * prompt's are left out (a note may still use them).
 */
export const ABOUT_THE_VAULT = new Set(['note', 'vault', 'canon', 'shar', 'team', 'answer', 'cite', 'cited', 'citation', 'reply', 'repli']);

/**
 * The words of a text as a person wrote them, by their term: the first
 * word that gave each term, in lower case ("rotating" for "rotat"), so the
 * page shows words, never stems.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function wordsOf(text) {
    const out = new Map();
    if (typeof text !== 'string' || text === '') return out;
    for (const raw of text.split(SPLIT)) {
        if (raw === '') continue;
        const parts = raw.length > 3 && CAMEL.test(raw) ? [raw, ...raw.split(CAMEL)] : [raw];
        for (const part of parts) {
            const lower = part.toLowerCase();
            const whole = SHORT_FORMS[lower] ?? lower;
            if (whole.length < 2 || whole.length > 40 || STOP.has(whole)) continue;
            const s = stem(whole);
            if (s.length < 2 || STOP.has(s) || out.has(s)) continue;
            out.set(s, lower);
        }
    }
    return out;
}

/**
 * Everyday request words, as terms: what a coding request asks to do
 * ("write", "add", "fix", "test", "check", "run"), the parts of code it
 * names ("function", "file", "script", "regex") and how big or good
 * ("small", "simple", "faster"). They say what to do, not what about, so
 * a note never fits a prompt on them alone (search.js): a coding request
 * leaves them out of the words in common (they still weigh in what it
 * asks), and a question needs a word beyond them.
 */
export const EVERYDAY = new Set(`
add adds added adding write writes wrote written writing create make set setup fix fixes fixed fixing update change
save saved modify edit remove delete rename refactor rewrite convert generate implement run runs ran running check
test explain describe mean means meant meaning help improve optimize split format print return handle parse validate
debug translate upgrade bump
function method class file script code line snippet program module component helper util utility variable parameter
argument value string number list array object type regex loop condition statement spec unit bug issue exception
warning comment doc docs readme import package library folder directory example
small short simple quick little tiny faster slow better proper correct
`.split(/\s+/).filter(Boolean).flatMap((word) => terms(word)));

/**
 * Verbs that ask for work on code when a sentence starts with them ("Write
 * a function…", "Fix the failing test", "Can you add retries…"). Verbs that
 * ask to be told something ("tell", "show", "explain", "list") are not here,
 * and one of these asks to be told when the person is its object: "Run me
 * through a release", "Update me on…", "Read me the restore steps".
 */
export const WORK = new Set(`
add write create make set fix update change save modify edit remove delete rename refactor rewrite convert generate
implement run check test improve optimize optimise split format print return handle parse validate debug translate
upgrade bump clean review profile lint mock simplify extract wrap sort replace read
`.split(/\s+/).filter(Boolean));

/**
 * What "this …" or "my …" names when it is code in front of the person
 * ("this function", "my regex", "this SQL query", "my Docker container").
 * "This repo" and "this app" name a project, not code: "Who owns this
 * repo?" is a question.
 */
export const CODE_THINGS = new Set(`
function method class file script code line snippet program module component helper variable parameter argument
value string array object type regex loop condition statement spec test bug issue exception warning comment import
package library error query build image container diff commit branch trace stack log output config endpoint handler
callback promise goroutine thread process hook form css html json yaml sql dockerfile makefile
`.split(/\s+/).filter(Boolean));

/** Words a request may start with before its verb ("please", "can you", "could you also"). */
const LEAD_IN = /^(?:(?:please|pls|plz|kindly|hey|hi|hello|ok|okay|so|now|also|and|then|just|quickly|first|next|go ahead and|can you|could you|would you|will you|can u|could u|help me|i need you to|i want you to|i'd like you to|let's|lets|try to)\b[\s,]*)+/i;

/** Whether "this", "these" or "my" names code within the next three words. */
function speaksOfCode(text) {
    const words = text.toLowerCase().split(/[^a-z0-9.'-]+/).filter(Boolean);
    for (let i = 0; i < words.length; i += 1) {
        if (words[i] !== 'this' && words[i] !== 'these' && words[i] !== 'my') continue;
        for (const word of words.slice(i + 1, i + 4)) {
            const bare = word.replace(/[.']+$/, '');
            if (CODE_THINGS.has(bare) || CODE_THINGS.has(bare.replace(/e?s$/, ''))) return true;
        }
    }
    return false;
}

/**
 * A sentence's first word after its lead-in, and whether that word asks to
 * be told: the person is its object ("Run me through…", "Update us on…",
 * "Read me the steps"), not something to make ("Write me a function").
 */
const HEAD = /^([A-Za-z]+)(?:\s+(?:me|us)\b(\s+(?:through|on|in|about)\b)?)?/i;

/**
 * Whether a prompt is a coding request: one of its sentences starts with a
 * verb that asks for work on code (after "please", "can you" and the like),
 * or it speaks of code in front of the person ("Why does my regex match too
 * much?", "How can I make this SQL query faster?"). A question about how the
 * team works ("Can I run a migration during the close?") is not one, nor is
 * a request to be told ("Run me through a release").
 * @param {string} prompt
 */
export function isCodingRequest(prompt) {
    const text = String(prompt ?? '');
    if (speaksOfCode(text)) return true;
    for (const sentence of text.split(/(?<=[.!?;:])\s+|\n+/)) {
        const head = sentence.trim().replace(LEAD_IN, '').match(HEAD);
        const first = head?.[1]?.toLowerCase();
        const told = head !== null && /\s(?:me|us)\b/i.test(head[0]) && (head[2] !== undefined || first === 'read');
        if (first && WORK.has(first) && !told) return true;
    }
    return false;
}

/** Words that end what a work verb acts on ("a migration | that adds…", "a route | to tide-ledger"). */
const OBJECT_ENDS = new Set(`
that which who whose so to with for in on into onto from at by when where if and or but instead before after until using
via of than as
`.split(/\s+/).filter(Boolean));

/**
 * The terms of what a coding request's first work verb acts on: the words
 * after it up to the next clause or preposition ("Write a migration that
 * adds a column" → migration; "Add a route to tide-ledger" → rout).
 * @param {string} prompt
 */
export function workObject(prompt) {
    for (const sentence of String(prompt ?? '').split(/(?<=[.!?;:])\s+|\n+/)) {
        const words = sentence.trim().replace(LEAD_IN, '').split(/\s+/);
        const verb = words[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
        if (!WORK.has(verb) || /^(?:me|us)$/i.test(words[1] ?? '')) continue;
        const out = [];
        for (const word of words.slice(1)) {
            const bare = word.replace(/[^\p{L}\p{N}'-]+$/u, '');
            if (OBJECT_ENDS.has(bare.toLowerCase())) break;
            out.push(bare);
            if (/[.!?;:,]$/.test(word)) break;
        }
        return terms(out.join(' '));
    }
    return [];
}

/**
 * A prompt's distinct terms, without its words about the vault and, unless
 * `everyday` is set, without its everyday request words.
 * @param {string} text
 * @param {{ max?: number, everyday?: boolean }} [options]
 */
export function promptTerms(text, options = {}) {
    return distinctTerms(text, options).filter((t) => !ABOUT_THE_VAULT.has(t) && (options.everyday || !EVERYDAY.has(t)));
}

/** How often each term comes in a text. */
export function counts(text) {
    const out = new Map();
    for (const t of terms(text)) out.set(t, (out.get(t) ?? 0) + 1);
    return out;
}

/** A name as folders and projects are compared: lower case, runs of other characters as one "-". */
export const nameKey = (text) => String(text ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
