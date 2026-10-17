/**
 * Claims in a reply: the statements that say work is done, passed, fixed or
 * deployed. Pure and quick: it runs once on each finished turn's last reply.
 *
 * A claim is a plain statement of success. Questions, plans, conditions
 * ("once the tests pass"), negations ("the build still fails"), code blocks,
 * quotes and reports of what a document says are not claims, so they never
 * get flagged. "No failures", "zero errors" and "nothing left to fix" are
 * not negations: they back a claim up.
 *
 * A sentence is read clause by clause ("Pushed to main — CI should pick it
 * up" claims the push, not the CI run), and gives at most one claim of each
 * kind. Each claim keeps the sentence (`text`) and the clause that makes it
 * (`part`).
 *
 * Kinds, from the strongest evidence they need to the weakest:
 *
 *   passed    tests, a build, lint or checks pass ("all 42 tests pass", "the build is green")
 *   deployed  shipped somewhere ("deployed to staging", "pushed to main", "published 1.2.0",
 *             "the health endpoint returns 200")
 *   fixed     a fault is gone, or a number got better ("fixed the crash", "no longer panics",
 *             "p50 310 ms -> 120 ms")
 *   done      work carried out ("done", "I added the endpoint", "renamed the files")
 *
 * A claim can also carry what it names, which the turn must show: commands
 * in inline code (`commands`, "`go test -race ./...` is clean") and figures
 * (`metrics`, "coverage is at 92%").
 *
 * @module dsh-plugin-proof/claims
 */

export const KINDS = ['passed', 'deployed', 'fixed', 'done'];

/** What a `passed` claim is about: which runs can back it. */
export const SUBJECTS = ['tests', 'build', 'lint', 'ci', 'hash', 'any'];

/** Where a `deployed` claim says the work went: which runs can back it. */
export const TARGETS = ['repo', 'registry', 'env', 'health', 'any'];

const MAX_SENTENCE = 400;
const MAX_PART = 200;
/** Inline code is kept between these marks while a sentence is read. */
const OPEN = '⟨';
const CLOSE = '⟩';

/** Markdown's marks around words, so "**All tests pass**" reads as the words; inline code is marked. */
function plain(line) {
    return line
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, `${OPEN}$1${CLOSE}`)
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
        .replace(/~~(.*?)~~/g, '')
        .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
        .replace(/[✅✔☑️🎉🚀]+/gu, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** A marked sentence as a person reads it. */
const shown = (s) => s.replaceAll(OPEN, '').replaceAll(CLOSE, '');
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The reply's sentences outside code blocks, quotes and tables, in order, inline code marked. */
function marked(text) {
    if (typeof text !== 'string' || text.trim() === '') return [];
    const out = [];
    let fenced = false;
    for (const raw of text.split(/\r?\n/)) {
        if (/^\s{0,3}(```|~~~)/.test(raw)) {
            fenced = !fenced;
            continue;
        }
        if (fenced || /^\s{0,3}>/.test(raw) || /^ {4,}\S/.test(raw) || /^\s*\|/.test(raw)) continue;
        const line = plain(raw);
        if (line === '') continue;
        // Split after a sentence's end, keeping "v1.2.0", "e.g." and "3.5 s" whole.
        for (const part of line.split(/(?<=[.!?])\s+(?=["“(⟨]?[A-Z0-9⟨])/)) {
            const s = part.trim();
            if (s.length > 1) out.push(s.length > MAX_SENTENCE ? `${s.slice(0, MAX_SENTENCE - 1)}…` : s);
        }
    }
    return out;
}

/** The reply's sentences outside code blocks, quotes and tables, in order. */
export function sentencesOf(text) {
    return marked(text).map(shown);
}

/** A sentence's clauses: split at dashes, semicolons, colons and ", so"/", and"/", but". */
function clausesOf(sentence) {
    return sentence
        .split(/\s+[—–]\s+|\s+-\s+|;\s+|:\s+(?=\S)(?!(?:all\s+)?(?:\d+\s*(?:\/\s*\d+\s+)?(?:tests?\s+)?)?(?:ok|okay|pass|passed|passes|passing|green|clean|success|successful|succeeded)\b)|,\s+(?=(?:so|and|but|while|which|because|since|although|though|yet|then|plus|with)\b)|\s+(?=(?:but|because|although|though)\s)/i)
        .map((s) => s.trim())
        .filter((s) => s.length > 1);
}

// ── What makes a clause not a claim ────────────────────────────────

/** A plan, a condition or a hope: success not yet had. */
const NOT_YET = /\b(if|once|until|unless|whenever|should|shall|will|would|could|might|may|must|need(s)? to|needed to|has to|have to|going to|gonna|want(s)? to|try(ing)? to|plan(ned|s)? to|hope(fully)?|expect(ed)? to|supposed to|let me|let['’]s|i['’]ll|we['’]ll|you'?ll|it['’]ll|that['’]ll|they'?ll|i['’]d|we['’]d|next,? i|to be (done|fixed|deployed|tested)|can then|in order to|so that|ready to|safe to|good to|able to|in case|(?:you|we|they) can|suggests?|suggesting|seems?|seemingly|appears?|apparently|probably|likely|presumably|perhaps|maybe|i think|i suspect|i believe|i guess|looks like)\b/i;
/** A sentence that says the opposite of success, or reports a failure. */
const NEGATED = /\b(not|n't|never|neither|nor|nothing|yet|without (?:running|testing|checking|verifying)|yet to|still (?:fail|failing|broken|red|erroring|crash)|fail(s|ed|ing|ure|ures)?|broken|break(s|ing)?|red\b|error(s|ed)?\b|regress(ed|ion)?|flak(y|iness)|skipped|cannot|unable|couldn'?t|didn'?t|doesn'?t|isn'?t|aren'?t|wasn'?t|weren'?t|haven'?t|hasn'?t|won'?t|instead of|rejected|denied|timed out|stalled|crashloop\w*|pending|in progress|queued)\b/i;
/** "No failures", "zero errors", "nothing left to fix": words that back a claim up, not negations. */
const POSITIVE = [
    /\b(with\s+)?(no|zero|0)\s+(new\s+|remaining\s+|more\s+|type\s+|lint\s+|test\s+|compile\s+|build\s+)?(errors?|failures?|failing (tests?|specs?)|warnings?|problems?|issues?|findings?|diagnostics?|regressions?|flakes?|offen[cs]es?)\b(\s+(left|remaining|anywhere|reported|found|to worry about)\b)?/gi,
    /\bnothing (left |else )?(to (fix|worry about|do|report|change)|(is|was) (left|blocking|failing|broken|missing|pending))\b/gi,
    /\bnothing\s+(is\s+|was\s+|left\s+)?(fail(s|ed|ing)?|broken|broke|red|regress(ed|es|ing)?|skipped)\b/gi,
    /\bnone\s+(of them\s+)?(fail(s|ed|ing)?|skipped|broke)\b/gi,
    /\b(zero|no)\s+(skipped|skips|failing|failed)\b/gi,
    /\bnothing (else )?(is )?(needed|blocking)\b/gi,
    /\bwithout (any )?(errors?|warnings?|failures?|issues?|problems?)\b/gi,
    /\b0 (fail|failed|failures?|errors?|failing)\b/gi,
    /\b\d+ (skipped|skips|xfailed|xpassed|deselected|pending|todo|ignored)\b/gi,
    /\bfail(ed|ures|ing|s)?:?\s*0\b/gi,
    /\b(not a single|not one) (failure|error|warning)\b/gi,
];
/** "no longer fails", "doesn't crash any more": a negation that claims a fix. */
const FIX_BY_NEGATION = /\bno longer\s+(fails?|failing|crash(es)?|errors?|throws?|breaks?|hangs?|panics?|leaks?|times? out|overruns?|drops?|loses?|happens?|reproduces?|deadlocks?|races?|blocks?)\b|\b(doesn'?t|does not|won'?t|will not|can'?t|cannot)\s+(fail|crash|error|throw|break|hang|panic|leak|time out|happen|reproduce|deadlock|race)\s+(any ?more|now|again)\b|\bno (more|longer any) (errors|failures|crashes|warnings|panics|races)\b|\b(the )?(bug|issue|error|problem|crash|regression|failure|leak|warning|panic|race|npe|exception)s? (is|are) (now )?(gone|fixed|resolved)\b/i;
/** A question. */
const ASKED = /\?\s*$|^(do|does|did|is|are|was|were|can|could|should|would|will|shall|have|has)\s+(you|we|i|it|they|the)\b/i;
/** What a document or a person says, not this turn's work: "the README says it is done". */
const REPORTED = /\b(the|this|that|its|their|your|his|her|our)\s+(readme|docs?|documentation|changelog|pr|pull request|description|ticket|issue|comment|commit message|author|reviewer|team|user|checklist|wiki|spec|plan|notes?|release notes)\b[^.;]{0,50}\b(says?|said|claims?|claimed|states?|stated|reports?|reported|mentions?|mentioned|promises?|promised|lists?|listed)\b|\baccording to\b|\b(claims?|claimed|allegedly|supposedly|reportedly)\b/i;
/** Deploy words used as adjectives: "the published checksum" claims nothing. */
const ADJECTIVE = /\b(the|a|an|its|our|their|this|that|these|those|every|each|any|your|my|his|her|previously|last|earlier)\s+(\w+\s+)?$|\b(that|which|who)('s|\s+(is|was|are|were|has been|had been|have been|got))\s+(already\s+|just\s+|been\s+)?$/i;
/**
 * A description, not this turn's claim: code that returns a status ("the
 * early `return 200`"), a mismatch with what the tests expect, a commit's or
 * a person's work ("`b2f1c88` renamed the param", "Tomas's change landed"),
 * and other people's results ("42 passing on their side").
 */
const DESCRIBED = /\b(where|whereas|while)\s+(the\s+)?(tests?|specs?|callers?|clients?|it|they|we|you|users?)\s+expects?\b|\b(an?|the|that|this|its)\s+(early\s+)?return\s+\d{3}\b|\bearly\s+return\s+\d{3}\b|^[A-Z][a-z]+['’]s\s+(change|pr|commit|branch|fix|patch|work|refactor|rewrite)\b|\bon their (side|end)\b|\btheir (suite|ci|tests?|builds?|runs?|machines?|team|side|end)\b|\bthey (say|said|report|reported|claim|claimed|believe|see|saw)\b|\bper the (issue|report|ticket|dashboards?|logs?)\b/i;
/** Uses of "pass" that hand something over, not a test result: "`load()` passes `true`", "passes the token through". */
const TRANSITIVE = new RegExp(String.raw`\bpass(?:es|ed|ing)?\s+(?:${OPEN}?(?:true|false|null|nil|none|undefined|nothing|it|them)${CLOSE}?|along|through|back|down|control|ownership|in\s+(?:a|an|the)\b|${OPEN}[^${CLOSE}]{1,60}${CLOSE}\s+(?:to|into|through|along|down|in|as|on|from)\b|(?:a|an|the|its|their|this|that)\s+(?:token|value|flag|param(?:eter)?s?|arg(?:ument)?s?|context|ctx|callback|handler|request|response|config|options?|opts|signal|pointer|reference|ref|buffer|string|object|map|list|array|struct|error|err|id|key|header|cookie|session|user|payload|message|event|result|func(?:tion)?|closure|promise|channel|stream|writer|reader|file|path|url|uri)s?\b)`, 'gi');

// ── What makes a clause a claim ────────────────────────────────────

const SUBJECT = String.raw`(?:(?:the\s+)?pr(?:\s*#?\d+)?|pull request(?:\s*#?\d+)?|checksums?|digests?|signatures?|tests?|specs?|test ?suites?|suites?|e2e|checks?|assertions?|examples?|cases?|builds?|bundle|lint(?:ing|er|ers)?|ci|pipelines?|workflows?|(?:ci|deploy|build|test|lint|release|e2e|nightly)\s+jobs?|runs?|type ?checks?|typecheck(?:s|ing)?|types|tsc|clippy|eslint|ruff|mypy|flake8|rubocop|pylint|golangci-lint|prettier|vet|go vet|webpack|vite|esbuild|rollup|everything|${OPEN}[^${CLOSE}]{1,80}${CLOSE})`;
const PASS_VERB = String.raw`(?:(?<!-)pass(?:es|ed|ing)?|green|(?<!\b(?:stops?|stopped|exits?|exited|shuts?\s+down|shut\s+down|terminates?|terminated|closes?|closed|cancels?|cancell?ed|unmounts?|unmounted|disconnects?|disconnected|tears?\s+down|tore\s+down|recovers?|recovered|restarts?|restarted|handles?|handled|separates?|separated|splits?|applies|applied|merges?|merged|rebases?|rebased|reverts?|reverted|drains?|drained|unwinds?|unwound|rolls?\s+back|rolled\s+back)\s)clean(?:ly)?|ok|okay|successful(?:ly)?|succeed(?:s|ed)?|went through|(?:finished|completed|ran|went|exited|exits)\s+(?:successfully|green|clean(?:ly)?|fine|ok|with 0|0|with (?:an? )?exit(?: code| status)? (?:of )?0)|complete[sd]?(?:\s+successfully)?|compiles?(?:\s+(?:cleanly|fine|successfully))?)`;
const PASS_WORD = /\b(pass(es|ed|ing)?|green|succeed(s|ed)?|success(ful(ly)?)?|clean(ly)?|ok|okay|good|compiles?|builds|went through|complete[sd]?|verified|verif(y|ies)|match(es|ed)?|exit(?: code| status)? (?:of )?0)\b/i;

const PASSED = [
    // "all 42 tests pass", "the test suite is green", "`go test ./...` is clean", "CI on main is green"
    new RegExp(String.raw`(^|\b|${OPEN})${SUBJECT}[^.;:]{0,40}?\b(?:(?:is|are|was|were|stays?|stayed|came back|comes back|looks?|now|all|still|both|also|is now|are now)\s+){0,3}${PASS_VERB}\b`, 'i'),
    // "passes all 12 tests", "passing all 18 of its tests"
    /\b(pass(es|ed)?|passing)\s+(all\s+|every\s+|the\s+)?(\d+\s+)?(of\s+(its|the|their)\s+)?(tests?|specs?|checks?|cases?|suites?|examples?)\b/i,
    // "12/12 pass", "Range tests pass 6/6", "3/3 green"
    /\b\d+\s*\/\s*\d+\s+(\w+\s+){0,2}(pass(ed|es|ing)?|green|ok)\b|\b(pass(es|ed)?|passing)\s+\d+\s*\/\s*\d+\b/i,
    // "12 passed", "1 passed", "7 passing, 0 failing", "12 pass, 0 fail"
    /\b\d+\s+(tests?\s+|specs?\s+|checks?\s+|examples?\s+|cases?\s+)?(passed|passing|pass(?=[,;.]|\s+(and\s+)?0\b))/i,
    // "`SlugTest`: OK", "`go vet`: clean"
    new RegExp(String.raw`${OPEN}[^${CLOSE}]{1,80}${CLOSE}\s*:\s*(all\s+)?(\d+\s*(\/\s*\d+\s+)?(tests?\s+)?)?(ok|okay|pass(es|ed)?|passing|green|clean|success(ful)?)\b`, 'i'),
    // "tests: 101/101 passed", "Tests = 12 ok"
    /\b(\d+\s+)?(tests?|checks?)\s*[:=]\s*\d+\s*(\/\s*\d+\s*)?(pass(ed)?|ok|green)\b/i,
    // "builds cleanly", "the bundle builds", "the crate compiles"
    /\b(builds?|built|compiles?|compiled)\s+(cleanly|successfully|fine|without (errors|warnings))\b|\b(build|bundle|app|project|crate|package|module|code|binary|site|image|service|tree)\s+(now\s+|still\s+|also\s+)?(builds|compiles)\b/i,
    // "everything is green", "all green"
    /\b(everything|all)\s+(is\s+|are\s+)?(green|passing|passes)\b/i,
    // "9 examples, 0 failures", "OK (36 tests", "BUILD SUCCESSFUL", "lints clean"
    /\b\d+ examples?, 0 failures\b|\bok\b\W{1,4}\d+ tests?\b|\bbuild successful\b|\blints?\s+clean\b|\btests?,?\s+ok\b/i,
    // "checksums verified", "every artifact matches its published SHA-256", "the signature verifies"
    /\b(checksums?|hash(es)?|digests?|signatures?|sha-?\d*(sums?)?)\b[^.;:]{0,30}?\b(verified|verif(y|ies)|match(es|ed)?|check(s|ed)? out|(is|are) (valid|correct|ok))\b/i,
    /\b(match(es|ed)?|verified against)\s+(its|their|the)\s+(published\s+|expected\s+|recorded\s+|listed\s+)?(checksums?|hash(es)?|digests?|sha-?\d*(sums?)?|signatures?)\b/i,
    // "the strict config now passes with zero errors"
    /\b(now\s+)?pass(es|ed)?\s+(with\s+)?(zero|no|0)\s+(errors?|warnings?|failures?|issues?|problems?|findings?|offen[cs]es?)\b/i,
    // "every ledger package passed"
    /\b(every|all|each|both)\s+(\w+\s+){0,2}(packages?|modules?|crates?|targets?|projects?)\s+(\w+\s+){0,1}(pass(es|ed)?|green|succeeded)\b/i,
    // "the same 12 green tests", "all 40 passing specs"
    /\b(all\s+)?\d+\s+(green|passing)\s+(unit\s+|e2e\s+|integration\s+)?(tests?|specs?|checks?|cases?|examples?)\b/i,
];

const DEPLOY_WORD = /\b(deployed|redeployed|released|shipped|rolled out|rolled back|promoted|published|pushed|merged|tagged|provisioned)\b/gi;
const DEPLOYED_OTHER = [
    /\b(is|are)\s+(now\s+)?live\b|\bgo(es)? live\b|\bwent live\b|\b(and|now)\s+live\b|^live\b|\blive\s+(on|in)\s+(staging|production|prod)\b/i,
    /\b(is|are)\s+(now\s+)?((built|pushed|published|up) and\s+)?(on|in)\s+(the\s+)?(registry|npm|pypi|crates\.io|docker ?hub|ghcr|ecr|gcr|rubygems|packagist|origin|production|prod|staging)\b/i,
    /\b(is|are)\s+(now\s+)?(on|at)\s+(v?\d+\.\d+(\.\d+)?|release v?\d+|the new (version|release|build|image))\b/i,
    /\b(created|cut)\s+the\s+(tag|release)\b/i,
];
/** "Live" as where something sits, not a deploy: "the tests now live in `tests/`", "the index is live locally". */
const LIVES_IN = /\b(?:now\s+)?lives?\s+(?:in|under|inside|within|alongside|next to|beside)\s+(?:the\s+|a\s+|its\s+|their\s+)?(?:code\b|[\w-]*\/[\w./-]*|[\w-]+\.[a-z]{1,6}\b|(?:same|new|shared|separate|own|one)\s+\w+|(?:file|folder|directory|module|package|repo|class|component|crate|namespace|workspace)s?\b)|\blive\s+locally\b|\blive\s+(?:on|in)\s+(?:my|your|this|the local)\s+(?:machine|laptop|box|db|database|checkout)\b/gi;

const HEALTH = [
    /\b(is|are)\s+(now\s+)?(healthy|up and running|serving)\b|\bserving (traffic|requests|the new (build|version|release))\b/i,
    /\b(returns?|answers?|responds?|responded|came back|comes back)\s+(with\s+)?(an?\s+)?(http\s+)?(\d{3}|ok)\b/i,
    /\bhealth\s*(checks?|endpoint|probe)?\s+(pass(es|ed)?|is ok|ok|is green|returns? ok|came back ok)\b|\bhealth checks? (are )?(passing|green)\b/i,
];

const FIXED = [
    /\b(fixed|resolved|repaired|patched|corrected|addressed|sorted|stabili[sz]ed|guarded)\b/i,
    /\b(now|it|this|that|everything)\s+works\b/i,
    /\bworks\s+(now|again|correctly|as expected|fine)\b/i,
    /\b(is|are)\s+(now\s+)?working( again| correctly| as expected)?\b/i,
    /\brenders? again\b|\bhandles? (it|them|this) (now|correctly)\b/i,
];
/** A number that got better: "p50 310 ms -> 120 ms", "2.5x faster", "cut the bundle to 182 KiB". */
const IMPROVED = [
    /\d+(\.\d+)?\s*[a-zµ%/]*\s*(→|->|=>|⟶)\s*\d/i,
    /\b\d+(\.\d+)?\s*(x|×)\s+(faster|quicker|smaller|less|fewer|lower|higher|more throughput)\b/i,
    /\b(faster|quicker|smaller|lighter|leaner|speed(ed)? up|sped up|halved|reduced|shaved|lowered|improved)\b[^.;]{0,60}\d/i,
    // "dropped to 120 ms", "cut the bundle by 40%": a figure it went to, by or from, not "cut off" or "cut the release"
    /\b(dropped|cut|fell|went down|came down|shrank|shrunk)\b(?!\s+(?:it\s+|them\s+)?off\b)\s+(?:\w+\s+){0,3}?(?:by|to|from|down to|under|below)\s+~?\d/i,
    new RegExp(String.raw`\d(?:\.\d+)?\s?(?:ms|µs|us|ns|s|sec|secs|seconds|min|mins|minutes|%|x|×|kib|mib|gib|kb|mb|gb|bytes|req\/s|rps|qps|ops\/s|tok\/s|fps)(?![\w/])[^.;]{0,40}\b(faster|quicker|smaller|lower|down from|up from|halved|reduced|dropped)\b|\b(down|up) from\s+~?\d`, 'i'),
    /\b(much|far|a lot|way|significantly)\s+(faster|quicker|smaller|lighter)\b/i,
];

/** "is in" claims at the end of a clause ("the fix is in", "is in on main"), not "is in play". */
const IS_IN = String.raw`in(?=\s*(?:$|[.,;:!)]|now\b|on\s+(?:main|master|the branch)))`;
const CHANGE_VERBS = 'cleaned|reverted|restored|simplified|trimmed|reordered|inlined|deduplicated|consolidated|normali[sz]ed|parameteri[sz]ed|vendored|scaffolded|stubbed|added|created|updated|wrote|written|implemented|renamed|removed|deleted|moved|changed|replaced|refactored|cleaned up|set up|configured|installed|migrated|converted|extracted|split|merged|rewrote|rewritten|built|rebuilt|generated|completed|finished|registered|wired|hooked up|exposed|exported|introduced|bumped|pinned|upgraded|downgraded|enabled|disabled|documented|gated|ported|switched|swapped|applied|committed|regenerated|recorded|backfilled|pruned|tightened|raised|lowered|made';
const DONE = [
    /^(all\s+)?(done|complete|completed|finished|sorted|all set|all wrapped up|wrapped up)\b/i,
    // "Backfill complete", "Index rebuild done", "Training finished for v7"
    /^(?:the\s+)?[\w-]+(?:\s+[\w-]+){0,2}\s+(?:is\s+|are\s+|has\s+|have\s+)?(?:now\s+|all\s+)?(?:done|complete|completed|finished)\b/i,
    new RegExp(String.raw`\b(is|are|it'?s|that'?s|everything'?s|all)\s+(now\s+|also\s+)?(done|complete|completed|finished|in place|implemented|${IS_IN}|registered|wired( up)?|exported|added|configured|enabled|pinned|updated|documented|set|cleaned up|ported|migrated|bumped|merged|committed)\b`, 'i'),
    new RegExp(String.raw`\b(i'?ve|i have|we'?ve|we have|i|we)\s+(now\s+|also\s+|just\s+|then\s+)?(${CHANGE_VERBS})\b`, 'i'),
    new RegExp(String.raw`^(${CHANGE_VERBS})\b`, 'i'),
    /\b(task|work|change|changes|refactor|migration|implementation|feature|fix|rename|update|upgrade|bump|backfill|patch)\s+(is|are)\s+(now\s+)?(done|complete|finished|in place|applied|in(?=\s*(?:$|[.,;:!)]|now\b|on\s+(?:main|master))))/i,
    // "Report regenerated at docs/api.md", "Dev image rebuilt as app-dev:latest", "1,834 rows updated"
    new RegExp(String.raw`^(?!(?:which|that|who|so|and|but|because|since|while|as|if|when|where|whether|although|though)\b)(?:the\s+|a\s+|an\s+|all\s+)?[\w.,/${OPEN}${CLOSE}-]+(?:\s+[\w.,/${OPEN}${CLOSE}-]+){0,3}\s+(?:now\s+|also\s+)?(?:${CHANGE_VERBS})\b(?!\s+(?:to\s+be|by\s+the\s+user))`, 'i'),
    // "Worker config now points at redis-2", ".env.example documents CACHE_URL now"
    /\bnow\s+(points|uses|returns|reads|lists|documents|leads|has|includes|contains|imports|exports|calls|sets|defaults|handles|accepts|supports|logs|retries|throws|falls back|guards|checks|skips|validates|redirects|caches)\b/i,
    /\b(points|uses|returns|reads|lists|documents|leads|has|includes|contains|imports|exports|calls|sets|defaults|handles|accepts|supports|logs|retries|throws|validates|caches)\b[^.;]{0,50}\bnow\b/i,
    /\b(is|are)\s+(now\s+)?applied\b/i,
    // "The three retry helpers are consolidated into one shared lib/retry.go", "is now gated behind a flag"
    new RegExp(String.raw`^(?!(?:which|that|who|so|and|but|because|since|while|as|if|when|where|whether|although|though)\b)(?:the\s+|a\s+|an\s+|all\s+|both\s+)?[\w.,/${OPEN}${CLOSE}-]+(?:\s+[\w.,/${OPEN}${CLOSE}-]+){0,4}\s+(?:is|are|was|were|has been|have been)\s+(?:now\s+|all\s+)*(?:${CHANGE_VERBS})\b(?:\s+\S+){0,3}?\s+(?:into|to|as|under|behind|onto)\b`, 'i'),
    new RegExp(String.raw`\b(?:is|are|has been|have been)\s+now\s+(?:${CHANGE_VERBS})\b`, 'i'),
];
/** A commit's own history, not this turn's work: "`b2f1c88` renamed the param". */
const HISTORY = new RegExp(String.raw`^(?:commit\s+)?(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\s+(?:also\s+|first\s+|originally\s+)?(?:${CHANGE_VERBS}|broke|introduced|landed|touched)\b`, 'i');
/** Words in a claim that say it changed something, so a change must show. */
export const CHANGE_CLAIM = new RegExp(String.raw`\b(${CHANGE_VERBS}|in place|(?:is|are) ${IS_IN}|now (points|uses|returns|throws|falls back|guards|reads|writes|retries|leads|lists|documents|has|includes|contains|imports|exports|calls|sets|defaults|handles|accepts|supports|logs|checks|skips|validates|redirects|caches)|(points|uses|returns|reads|lists|documents|leads|has|includes|contains|imports|exports|calls|sets|defaults|handles|accepts|supports|logs|retries|throws|validates|caches)\b[^.;]{0,50}\bnow|applied)\b`, 'i');

const SUBJECT_WORDS = {
    hash: /\b(checksums?|sha-?\d*(sums?)?|digests?|signatures?|hash(es)?)\b/i,
    lint: /\b(lint(s|er|ers|ing)?|eslint|ruff|flake8|pylint|clippy|prettier|rubocop|golangci-lint|stylelint|mypy|pyright|shellcheck)\b/i,
    tests: /\b(tests?|specs?|test ?suites?|suites?|e2e|end-to-end|assertions?|examples?|cases?|pytest|jest|vitest|mocha|rspec|phpunit|go test|cargo test|node --test)\b/i,
    ci: /\b(ci|pipelines?|workflows?|github actions|actions run|(?<!type[\s-]?)checks|(ci|deploy|build|test|lint|release|e2e|nightly)\s+jobs?|pr|pull request|pr \d+|pr #?\d+|#\d+)\b/i,
    build: /\b(build(s)?|bundle|compil(e|es|ed|ation)|tsc|type ?check(s|ing)?|typecheck(s|ing)?|types|go vet|vet)\b/i,
};

/** Every kind of run a `passed` clause names ("lint, tests and the build pass"): which runs must back it. */
function subjectsOf(text) {
    const found = Object.entries(SUBJECT_WORDS).filter(([, re]) => re.test(text)).map(([name]) => name);
    if (found.includes('hash')) return ['hash'];
    return found.length ? found : ['any'];
}

/** Where a `deployed` claim says the work went. */
function targetOf(text, healthy) {
    if (healthy) return 'health';
    const place = /\b(staging|production|prod|cluster|servers?|fly(\.io)?|heroku|vercel|netlify|render|railway|kubernetes|k8s|environment|replicas?|pods?)\b/i;
    // "The worker image is deployed to Fly staging": the place it runs, not the registry it went through.
    if (place.test(text) && /\b(deployed|redeployed|rolled out|rollout|released to|shipped to|promoted to|live|provisioned)\b/i.test(text)) return 'env';
    if (/\b(npm|pypi|crates\.io|registry|docker ?hub|ghcr|ecr|gcr|rubygems|packagist|maven central|nuget|image|container|package|published)\b|@\d+\.\d+/i.test(text) && !/\b(docs|site|pages)\b/i.test(text)) return 'registry';
    if (place.test(text) || /\b(live|deployed|redeployed|rolled out|rollout|released to|shipped|provisioned)\b/i.test(text)) return 'env';
    // A bare "Pushed" may be a git push or an image push.
    if (/\b(merged|tagged|origin|main|master|branch|remote|github|gitlab|gh-pages|tag)\b/i.test(text)) return 'repo';
    return 'any';
}

/** Tools whose name starts a command a claim can name in inline code. */
const COMMAND_START = /^(\.\/)?(npm|pnpm|yarn|npx|bun|bunx|deno|node|go|cargo|pytest|python3?|uv|poetry|pip3?|make|docker|kubectl|helm|git|gh|tsc|eslint|ruff|mypy|flake8|black|prettier|mvn|gradlew?|dotnet|swift|mix|bundle|rake|rspec|jest|vitest|mocha|phpunit|composer|terraform|fly|flyctl|vercel|netlify|curl|wget|sha256sum|shasum|twine|bazel|cmake|ninja|xcodebuild|rustc|clang|gcc|javac|java|scripts\/\S+|\S+\.sh)\b/;

/** The commands a clause names in inline code. */
function commandsIn(text) {
    const out = [];
    for (const m of text.matchAll(new RegExp(`${OPEN}([^${CLOSE}]{2,160})${CLOSE}`, 'g'))) {
        const c = m[1].trim();
        if (COMMAND_START.test(c) && /\s/.test(c) || /^(tsc|pytest|jest|vitest|mocha|rspec|phpunit|make|eslint|ruff|mypy)$/i.test(c)) out.push(c);
    }
    return out.slice(0, 3);
}

const METRIC_UNIT = String.raw`(?:ms|µs|us|ns|s|sec|secs|seconds|min|mins|minutes|%|x|×|kib|mib|gib|kb|mb|gb|b|bytes|req\/s|rps|qps|ops\/s|tok\/s|tokens\/s|t\/s|fps|rows\/s)`;
const METRIC = new RegExp(String.raw`(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(${METRIC_UNIT})(?![\w/])|(?<![\w.])(\d+(?:\.\d+)?)(?=\s*(?:→|->|=>|⟶))|(?:→|->|=>|⟶)\s*(\d+(?:\.\d+)?)(?:\s?(${METRIC_UNIT})(?![\w/]))?`, 'gi');
/** Words that make a figure in a claim a result to show, not a setting. */
const METRIC_CONTEXT = /\b(coverage|p\d{2}|latency|throughput|faster|slower|quicker|speed(up)?|benchmark|bench|memory|rss|cpu|heap|bundle|size|smaller|larger|halved|reduced|dropped|down from|up from|improved|took|runtime|duration)\b|→|->|=>|⟶|\d\s*(x|×)\b/i;

/** The figures a clause quotes as results: `[{ value, unit, text }]`. */
function metricsIn(text) {
    const plainText = shown(text);
    if (!METRIC_CONTEXT.test(plainText)) return [];
    const out = [];
    for (const m of plainText.matchAll(METRIC)) {
        const raw = m[1] ?? m[3] ?? m[4];
        const value = Number(String(raw).replace(/,/g, ''));
        if (!Number.isFinite(value)) continue;
        const unit = (m[2] ?? m[5] ?? '').toLowerCase();
        out.push({ value, unit, text: `${raw}${unit && unit !== '%' && unit !== 'x' && unit !== '×' ? ' ' : ''}${unit}`.trim() });
    }
    return out.slice(0, 6);
}

/** A clause with its inline code as a plain word: "setting `exported=true`" holds no verb. */
const prose = (s) => s.replace(new RegExp(`${OPEN}[^${CLOSE}]*${CLOSE}`, 'g'), 'code');

/** The kind of claim a clause makes, with what it is about; or undefined. */
function claimOf(clause) {
    const s = clause.trim();
    const words = shown(s);
    const said = prose(s).replace(LIVES_IN, ' ');
    if (words === '' || ASKED.test(words) || REPORTED.test(words) || NOT_YET.test(words) || DESCRIBED.test(words) || HISTORY.test(words)) return undefined;
    const fixedByNegation = FIX_BY_NEGATION.test(words);
    let rest = words;
    for (const re of POSITIVE) rest = rest.replace(re, ' ');
    if (!fixedByNegation && NEGATED.test(rest)) return undefined;
    // "returns 200, but only for the cached path": a status with a catch is not a health claim.
    const healthy = HEALTH.some((re) => re.test(words)) && !/\b(returns?|answers?|responds?|responded|came back|comes back)\b[^.;]*\b(but|however|although|though|except)\b/i.test(words);
    // "both health checks pass" is about a running service, not a test run.
    if (healthy && /\bhealth\s*(checks?|endpoints?|probes?)\b/i.test(words)) return { kind: 'deployed', target: 'health' };
    // "`load()` passes `true`" hands a value over; it is not a test result. A dot in inline code (`eslint .`) ends no sentence.
    const passing = s.replace(TRANSITIVE, ' ').replace(new RegExp(`${OPEN}[^${CLOSE}]*${CLOSE}`, 'g'), (m) => m.replace(/\./g, '·'));
    if (PASSED.some((re) => re.test(passing)) && PASS_WORD.test(shown(passing))) {
        const subjects = subjectsOf(words);
        return { kind: 'passed', subject: subjects.length === 1 ? subjects[0] : subjects.includes('ci') ? 'ci' : subjects[0], subjects };
    }
    let deployWord = false;
    for (const m of said.matchAll(DEPLOY_WORD)) {
        const before = said.slice(0, m.index);
        if (ADJECTIVE.test(before)) continue;
        if (/^pushed\s+(back|for|ahead|through)\b/i.test(said.slice(m.index))) continue;
        deployWord = true;
        break;
    }
    if (healthy || deployWord || DEPLOYED_OTHER.some((re) => re.test(said))) {
        // "Deployed to staging and /health returns 200" claims both the deploy and the check.
        const ship = healthy && deployWord ? targetOf(words, false) : undefined;
        return { kind: 'deployed', target: targetOf(words, healthy), ...(ship ? { ship } : {}) };
    }
    if (fixedByNegation || FIXED.some((re) => re.test(said))) return { kind: 'fixed' };
    if (IMPROVED.some((re) => re.test(said))) return { kind: 'fixed', improved: true };
    if (DONE.some((re) => re.test(said))) return { kind: 'done' };
    return undefined;
}

/** The kind of claim a sentence makes, or undefined (the first clause that makes one). */
export function kindOf(sentence) {
    if (typeof sentence !== 'string') return undefined;
    for (const clause of clausesOf(sentence)) {
        const found = claimOf(clause);
        if (found) return found.kind;
    }
    return undefined;
}

/**
 * The claims in a reply, in order: `{ kind, text, part, subject?, target?,
 * improved?, commands?, metrics? }`. `text` is the sentence, `part` the
 * clause that claims; `subject` for `passed`, `target` for `deployed`.
 * At most one claim of each kind per sentence, and `max` in all.
 */
export function claimsIn(text, { max = 8 } = {}) {
    const out = [];
    for (const sentence of marked(text)) {
        const kinds = new Set();
        const whole = shown(sentence);
        const clauses = clausesOf(sentence);
        if (clauses.length > 1 && !clauses.some((c) => claimOf(c))) clauses.push(sentence);
        for (const clause of clauses) {
            const found = claimOf(clause);
            if (found?.ship && !kinds.has('deployed:ship')) {
                kinds.add('deployed:ship');
                out.push({ kind: 'deployed', text: whole, part: clip(shown(clause), MAX_PART), target: found.ship, ...(commandsIn(clause).length ? { commands: commandsIn(clause) } : {}) });
                if (out.length >= max) return out;
            }
            // One claim of each kind; a deploy and a health check in one sentence are two.
            const key = found?.kind === 'deployed' ? `deployed:${found.target === 'health' ? 'health' : 'ship'}` : found?.kind;
            if (!found || kinds.has(key)) continue;
            kinds.add(key);
            const commands = commandsIn(clause);
            // Figures count wherever the sentence quotes them: "41/41 passing, and coverage is at 92%".
            const metrics = found.kind === 'passed' || found.kind === 'fixed' ? metricsIn(found.improved ? clause : sentence) : [];
            out.push({
                kind: found.kind,
                text: whole,
                part: clip(shown(clause), MAX_PART),
                ...(found.subject ? { subject: found.subject } : {}),
                ...(found.subjects && found.subjects.length > 1 ? { subjects: found.subjects } : {}),
                ...(found.target ? { target: found.target } : {}),
                ...(found.improved ? { improved: true } : {}),
                ...(commands.length ? { commands } : {}),
                ...(metrics.length ? { metrics } : {}),
            });
            if (out.length >= max) return out;
        }
    }
    return out;
}
