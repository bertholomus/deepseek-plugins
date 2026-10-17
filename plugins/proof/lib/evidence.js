/**
 * Evidence in a turn: what its tools showed, and whether it backs a claim.
 * Pure: the session projection (projection.js) calls it on every tool
 * result, and once per claim at a turn's end.
 *
 * Each tool result becomes one small item: which tool, what kind of run
 * (a test, a build, lint, a CI read, a deploy, a request to a server, a
 * checksum, another command, a change to files, a read), whether it went
 * well (the exit code, a test summary, a push that went through, an HTTP
 * status), and the facts worth quoting: test counts, a file hash or
 * commit, a metric that moved, the figures it printed.
 *
 * DSH's bash tool writes stdout, then `[stderr]`, then markers such as
 * `[exit code: 1]`, `[timed out after …ms]` or `[killed by signal: …]`; a
 * command that exits 0 gets no marker. Other tools are read by their
 * words ("exit=0", "Exit code: 0", "12 passed").
 *
 * @module dsh-plugin-proof/evidence
 */
import { CHANGE_CLAIM } from './claims.js';

// ── Which tool did what ────────────────────────────────────────────

const SHELL_TOOL = /^(bash|shell|sh|zsh|exec|execute|run|run_command|run_shell|terminal|command|cmd|pwsh|powershell|bash_persistent)$|(^|_)(bash|shell|exec|command|terminal)(_|$)/i;
const CHANGE_TOOL = /(^|_)(edit|edits|multi_edit|multiedit|write|writes|create|create_file|apply_patch|patch|str_replace|replace|insert|delete|remove|rename|move|mkdir|notebook_edit|save)(_|$)/i;
const READ_TOOL = /(^|_)(read|grep|glob|ls|list|view|cat|search|find|fetch|open|stat|tree|get|lookup|inspect|query|show|diff|log|status)(_|$)/i;
/** DSH's own bookkeeping tools: never evidence of work. */
const BOOKKEEPING_TOOL = /^(todo_write|todo_read|todowrite|create_goal|get_goal|update_goal|ask_user_question|question|present|plan|think|exit_plan_mode)$/i;

const TEST_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|t|e2e|test:\S+|check|verify|ci)\b|\b(node|deno|bun)\s+(--test|test)\b|\bnpx\s+(jest|vitest|mocha|playwright|ava|tap|cypress)\b|\b(jest|vitest|mocha|pytest|py\.test|tox|nox|rspec|phpunit|ctest|ava|karma|cypress\s+run|playwright\s+test)\b|\bgo\s+test\b|\bcargo\s+(test|nextest)\b|\bmvnw?\s+(\S+\s+)*(test|verify)\b|\bgradlew?\s+(\S+\s+)*(\S*:)?(test\w*|check\w*|connected\w*Test)\b|\bxcodebuild\b[^|;&]*\btest\b|\b(flutter|dart)\s+test\b|\bsbt\s+(\S+\s+)*test\b|\b(nx|turbo|lerna)\s+(run\s+)?(\S+:)?test\b|\bpnpm\s+(-r|--recursive)\s+test\b|\b(stack|cabal)\s+test\b|\bzig\s+build\s+test\b|\bgotestsum\b|\b(python3?|uv\s+run|poetry\s+run)\s+-m\s+(pytest|unittest)\b|\bmake\s+(-\S+\s+(\S+\s+)?)*(test|check|ci|e2e)\b|\bdotnet\s+test\b|\bswift\s+test\b|\bmix\s+test\b|\brake\s+(test|spec)\b|\bbundle\s+exec\s+(rspec|rake\s+(test|spec))\b|\bscripts\/e2e|\b\S*test\S*\.(sh|mjs|js|py)\b|\be2e\.(mjs|js|sh)\b|\bbazel\s+test\b|(^|[\s/])(ci|verify|check|checks|validate|precommit|pre-commit)([-_.]\S*)?\.(sh|mjs|js|py)\b|\bscripts\/(ci|verify|check|validate)\S*|\bpre-commit\s+run\b/i;
const BUILD_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(build|build:\S+|compile|typecheck|type-check|tsc|bundle)\b|\btsc\b|\bcargo\s+(build|check)\b|\bgo\s+(build|vet)\b|\bmake(\s+(all|build|install|release))?\s*($|[;&|])|\bmvnw?\s+(\S+\s+)*(package|compile|install)\b|\bgradlew?\s+(\S+\s+)*(\S*:)?(build|assemble\w*|bundle\w*|jar|shadowJar|compile\w*)\b|\bdotnet\s+build\b|\bswift\s+build\b|\bwebpack\b|\bvite\s+build\b|\besbuild\b|\brollup\b|\bnext\s+build\b|\bnode\s+--check\b|\bpython3?\s+-m\s+(py_compile|compileall)\b|\bxcodebuild\b|\bcmake\s+--build\b|\bninja\b|\bdocker\s+(build|buildx\s+build|compose\s+build)\b|\bbazel\s+build\b|\bmix\s+compile\b/i;
const LINT_CMD = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(lint|lint:\S+|format:check|fmt:check|check:format)\b|\b(eslint|ruff|flake8|pylint|mypy|pyright|golangci-lint|shellcheck|stylelint|rubocop|swiftlint|biome\s+(check|lint)|oxlint|phpstan|psalm)\b|\bprettier\s+(--check|-c)\b|\bblack\s+--check\b|\bcargo\s+(clippy|fmt\s+--check)\b|\bgofmt\s+-l\b|\b(bash|sh|zsh|dash|ksh)\s+-n\b|\bphp\s+-l\b|\b(ruby|perl)\s+-c\b|\bterraform\s+(validate|fmt\s+-{1,2}check)\b|\bnginx\s+-t\b|\b(yamllint|hadolint|actionlint|markdownlint(-cli2)?|ktlint|detekt|credo|standardrb|tflint|staticcheck|revive)\b|\bsqlfluff\s+lint\b|\bbuf\s+lint\b|\b(dart|flutter)\s+analyze\b/i;
const CI_CMD = /\bgh\s+(run\s+(view|list|watch)|pr\s+(checks|status|view)|workflow\s+view)\b|\bglab\s+ci\b|\bcircleci\b|\bbuildkite\b|\bcurl\b[^|;&]*\/(actions|checks|statuses|pipelines)\b/i;
/** Where a command ships work: a repository, a package registry, or a running environment. */
const PUSH_CMD = /\bgit\s+push\b|\bgh\s+pr\s+merge\b|\bgh-pages\b|\bgh\s+release\s+create\b/i;
const DEPLOY_REMOTE = /\bgit\s+push\s+(-\S+\s+)*(heroku|dokku|deploy|production|prod|staging|live|fly|render|piku)\b|\bgh-pages\b/i;
const PUBLISH_CMD = /\b(npm|pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b|\bgem\s+push\b|\bdocker\s+(push|buildx\s+build\b[^|;&]*--push)\b|\bgh\s+release\s+create\b|\bmvnw?\s+(\S+\s+)*deploy\b|\bgradlew?\s+(\S+\s+)*publish\w*\b|\bdotnet\s+nuget\s+push\b|\b(poetry|uv|flit|hatch)\s+publish\b|\bmix\s+hex\.publish\b|\bpod\s+trunk\s+push\b/i;
const RELEASE_CMD = /\bkubectl\b[^|;&]*\b(apply|rollout|set\s+image|replace|scale|patch)\b|\bhelm\s+(upgrade|install|rollback)\b|\b(fly|flyctl)\s+(deploy|releases?)\b|\bvercel\b|\bnetlify\s+deploy\b|\bheroku\s+(releases|container:release|deploy)\b|\bterraform\s+apply\b|\bpulumi\s+up\b|\bwrangler\s+(deploy|publish)\b|\bfirebase\s+deploy\b|\bgcloud\s+(\S+\s+)*deploy\b|\baws\s+(s3\s+sync|deploy|ecs\s+update-service|lambda\s+update-function-code|cloudformation\s+deploy)\b|\bcap\s+\S+\s+deploy\b|\bansible-playbook\b|\bkamal\s+deploy\b|(^|[\s;&|/])deploy(\.sh)?(\s|$)|\b(npm|pnpm|yarn)\s+run\s+deploy\b|\bmake\s+deploy\b|\brsync\b[^|;&]*\s[\w.@-]+:\S*|\bscp\b[^|;&]*\s[\w.@-]+:\S*|\bdocker\s+compose\s+(\S+\s+)*up\b|\bsystemctl\s+(restart|reload)\b/i;
/** Reads of what a registry holds. */
const REGISTRY_READ_CMD = /\bnpm\s+(view|info|show)\b|\bpip3?\s+index\s+versions\b|\bcargo\s+search\b|\bgem\s+list\s+(-r|--remote)\b|\bdocker\s+(manifest\s+inspect|pull)\b|\bcrane\s+(digest|ls)\b|\bskopeo\s+inspect\b/i;
/** A request to a server, or a status read of what runs. */
const PROBE_CMD = /\b(curl|wget|httpie|xh|hey|ab)\b|\bhttp\s+(get|head|post\s+)?\S*https?:|\bkubectl\b[^|;&]*\b(get\s+(pods?|po|deploy(ments?)?|svc|services?)|describe)\b|\bsystemctl\s+status\b|\bdocker\s+(ps|compose\s+ps)\b|\b(fly|flyctl)\s+status\b|\bheroku\s+ps\b/i;
/** Runs that apply infrastructure, a playbook or a database migration. */
const MIGRATE_CMD = /\b(sqlite3|duckdb)\s+\S+\s*<\s*\S+|\b(psql|mysql|mariadb|sqlcmd)\b[^|;&]*(\s-f\s|\s--file[= ]|<\s*\S+)|\balembic\s+upgrade\b|\b(rails|rake)\s+db:(migrate|schema:load|setup)\b(?!:status)|\bprisma\s+(migrate\s+(deploy|dev|reset)|db\s+push)\b|\b(knex|sequelize(-cli)?)\s+(migrate:latest|db:migrate)\b|\bgoose\b[^|;&]*\bup\b|\bmigrate\b[^|;&]*\s(up|-up)\b|\bflyway\s+migrate\b|\bdbmate\s+(up|migrate)\b|\bliquibase\s+update\b|\b(php\s+artisan|manage\.py|django-admin)\s+migrate\b(?!:status)|\bdiesel\s+migration\s+run\b|\bsqlx\s+migrate\s+run\b|\bmix\s+ecto\.migrate\b|\bdotnet\s+ef\s+database\s+update\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(db:)?migrate\b|\bdrizzle-kit\s+(push|migrate)\b/i;
const APPLY_CMD = /\b(terraform|tofu)\s+(\S+\s+)*apply\b|\bpulumi\s+up\b|\bkubectl\b[^|;&]*\b(apply|create|replace|patch|set\s+(image|env))\b|\bhelm\s+(upgrade|install)\b|\bansible-playbook\b|\bcdk\s+deploy\b|\baws\s+cloudformation\s+deploy\b|\bkustomize\b[^|;&]*\|\s*kubectl\s+apply\b|\bargocd\s+app\s+sync\b|\bnomad\s+(job\s+)?run\b/i;
/** Commands that start a job or workflow somewhere else, which then runs on its own. */
const JOB_CMD = /\bargo\s+submit\b|\bgh\s+workflow\s+run\b|\bgh\s+run\s+rerun\b|\bkubectl\s+create\s+job\b|\bsbatch\b|\bqsub\b|\bbsub\b|\bairflow\s+dags\s+trigger\b|\baws\s+batch\s+submit-job\b|\baws\s+glue\s+start-job-run\b|\baws\s+stepfunctions\s+start-execution\b|\bdatabricks\s+(jobs\s+run-now|runs\s+submit)\b|\bgcloud\s+(dataflow\s+jobs\s+run|dataproc\s+jobs\s+submit|batch\s+jobs\s+submit|run\s+jobs\s+execute)\b|\bprefect\s+deployment\s+run\b|\bdagster\s+job\s+launch\b|\bnomad\s+job\s+run\b/i;
const HASH_CMD = /\b(sha\d+sum|shasum|md5sum|b2sum|cksum|gpg\s+--verify|cosign\s+verify|minisign\s+-V)\b/i;
const CHANGE_CMD = /(^|[;&|(]\s*|\s)(sed\s+-i|perl\s+-p?i|mv|cp|rm|mkdir|touch|tee|chmod|ln|patch|truncate|install|git\s+(apply|commit|checkout|restore|reset|mv|rm|merge|rebase|cherry-pick|stash\s+pop|add|tag)|(npm|pnpm|yarn|bun)(\s+(-{1,2}[\w-]+(=\S+)?|--filter\s+\S+|-F\s+\S+|-C\s+\S+|--prefix\s+\S+|--cwd\s+\S+|workspace\s+\S+))*\s+(add|install|i|uninstall|remove|rm|update|up|ci|version)\b|pip3?\s+install|uv\s+(add|pip\s+install)|poetry\s+add|cargo\s+add|go\s+get|bundle\s+(install|update)|composer\s+(require|update|install)|apply_patch|python3?\s+-c\s+.*\b(open|write)\b|alembic\s+upgrade|rails\s+db:migrate(?!:status)|prisma\s+migrate|eslint\s+(\S+\s+)*--fix|prettier\s+(\S+\s+)*(--write|-w)|ruff\s+(check\s+(\S+\s+)*--fix|format)|black(?!\s+(\S+\s+)*--check)|gofmt\s+-w|go\s+fmt|cargo\s+fmt(?!\s+(\S+\s+)*--check)|rubocop\s+(\S+\s+)*(-a|-A|--autocorrect\S*)|(npm|pnpm|yarn)\s+(run\s+)?(format|fmt|lint:fix|fix)\b|npm\s+audit\s+fix|codemod|jscodeshift)\b|[^2&]>\s*[^&|\s>]|>>/i;
/** A change to code that tests must run after (as against a commit, a branch, docs or notes). */
const CODE_CHANGE_CMD = /(^|[;&|(]\s*|\s)(sed\s+-i|perl\s+-p?i|patch|git\s+(apply|restore|cherry-pick|stash\s+pop|checkout\s+(\S+\s+)?--\s)|apply_patch)(\s|$)/i;
/** Files and code that hold a route or a handler: `routes/`, `api/`, `*_controller.rb`, `@router.get(`, `app.post(`, `path('…'`. */
const ROUTE_FILE = /(^|[\/\s_.-])(routes?|routers?|controllers?|handlers?|endpoints?|apis?|views?|urls|server|app|main|index|resources?)(\/|\.\w+\b|[_-])/i;
const ROUTE_CODE = /\.(get|post|put|patch|delete|route|all|add_url_rule|add_api_route|api_route|handle|handlefunc|handler|register|mount)\s*\(|@(get|post|put|patch|delete|route|api_route)\b|@\w+\.(get|post|put|patch|delete|route|api_route)\s*\(|@(Get|Post|Put|Patch|Delete|Request)Mapping\b|\b(path|re_path|url)\s*\(\s*r?['"]|\bRoute::\w+\s*\(|^\s*(get|post|put|patch|delete|resources?)\s+['":\/]|\(\s*req\s*,\s*res\b|\breq\s*:\s*Request\b|\bNext(Request|Response)\b|\bhttp\.ResponseWriter\b|\b(Http|Json)Response\b|\bjsonify\s*\(|\bres\.(json|send|status)\s*\(|\bc\.JSON\s*\(|\bResponseEntity\b|@(Rest)?Controller\b|\bAPIRouter\s*\(|\bBlueprint\s*\(|\bexpress\s*\(\s*\)|\bexport\s+(async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b|\bhandler\s*[:=(]/im;
const DOC_FILE = /\.(md|mdx|markdown|txt|rst|adoc|org)$|(^|\/)(docs?)\/|(^|\/)\.github\/|(^|\/)(CHANGELOG|README|LICENSE|NOTICE|AUTHORS|CONTRIBUTING|HANDOFF|TODO|\.gitignore|\.editorconfig)(\.|$)/i;

// ── What a tool's output says ──────────────────────────────────────

/** How a run ended: an exit code, or 'timeout', 'signal', 'stopped', 'denied' or 'error'; null when the tool does not say. */
export function exitOf(text, { isError = false, shell = false } = {}) {
    const t = typeof text === 'string' ? text : '';
    const marker = [...t.matchAll(/\[exit code: (-?\d+)\]/g)].at(-1);
    if (marker) return Number(marker[1]);
    if (/\[timed out after \d+ ?ms\]/.test(t)) return 'timeout';
    if (/\[killed by signal: [^\]]+\]/.test(t)) return 'signal';
    if (/\[stopped: [^\]]*\]/.test(t)) return 'stopped';
    if (/\[sandbox: [^\]]*(denied|failed)[^\]]*\]/.test(t)) return 'denied';
    if (isError) return 'error';
    const said = /\b(?:exit(?:ed)?(?:\s+with)?(?:\s+(?:code|status))?|exit_code|exitcode|exit status|return code|returncode|rc)\s*[:=]?\s*(-?\d{1,3})\b/i.exec(t);
    if (said) return Number(said[1]);
    return shell ? 0 : null;
}

const num = (v) => (v === undefined ? undefined : Number(String(v).replace(/,/g, '')));

/**
 * Test counts in a runner's summary (the last one in the output wins):
 * `{ passed, failed, total? }`, or undefined.
 */
export function testCountsIn(text) {
    if (typeof text !== 'string' || text === '') return undefined;
    const found = [];
    const add = (passed, failed, total) => {
        const p = num(passed) ?? (total !== undefined && failed !== undefined ? num(total) - num(failed) : undefined);
        if (p === undefined || Number.isNaN(p)) return;
        found.push({ passed: p, failed: num(failed) ?? 0, ...(total !== undefined ? { total: num(total) } : {}) });
    };
    let m;
    // node --test: TAP ("# tests 12", "# pass 12", "# fail 0") or the spec reporter ("ℹ pass 12")
    const tapPass = [...text.matchAll(/^(?:#|ℹ) pass (\d+)\s*$/gm)].at(-1);
    if (tapPass) {
        const fail = [...text.matchAll(/^(?:#|ℹ) fail (\d+)\s*$/gm)].at(-1);
        const total = [...text.matchAll(/^(?:#|ℹ) tests (\d+)\s*$/gm)].at(-1);
        add(tapPass[1], fail?.[1] ?? 0, total?.[1]);
    }
    // jest: "Tests:       1 failed, 2 skipped, 10 passed, 13 total"
    for (m of text.matchAll(/Tests:\s+(?:(\d+) failed,\s*)?(?:\d+ (?:skipped|todo|pending),\s*)*(?:(\d+) passed,\s*)?(\d+) total/g)) add(m[2] ?? 0, m[1] ?? 0, m[3]);
    // vitest: "Tests  1 failed | 10 passed (11)"
    for (m of text.matchAll(/Tests\s+(?:(\d+) failed\s*\|\s*)?(\d+) passed(?:\s*\|\s*\d+ (?:skipped|todo))?\s*\((\d+)\)/g)) add(m[2], m[1] ?? 0, m[3]);
    // pytest: "===== 1 failed, 4 passed, 1 skipped in 0.20s =====", "5 passed in 0.12s"
    for (m of text.matchAll(/(?:^|=+\s|\s)(?:(\d+) failed,\s*)?(\d+) passed(?:,\s*(\d+) failed)?(?:,\s*\d+ (?:skipped|warnings?|xfailed|xpassed|errors?|deselected))*\s+in\s+[\d.]+\s*s/gm)) add(m[2], m[1] ?? m[3] ?? 0);
    for (m of text.matchAll(/(?:^|=+\s)(\d+) failed(?:,\s*\d+ (?:skipped|warnings?|errors?))*\s+in\s+[\d.]+\s*s/gm)) add(0, m[1]);
    // mocha: "12 passing", "2 failing"
    const passing = [...text.matchAll(/^\s*(\d+) passing\b/gm)].at(-1);
    if (passing) add(passing[1], [...text.matchAll(/^\s*(\d+) failing\b/gm)].at(-1)?.[1] ?? 0);
    // cargo: "test result: ok. 5 passed; 0 failed;"
    for (m of text.matchAll(/test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed/g)) add(m[1], m[2]);
    // rspec: "12 examples, 0 failures"
    for (m of text.matchAll(/(\d+) examples?, (\d+) failures?/g)) add(num(m[1]) - num(m[2]), m[2], m[1]);
    // unittest: "Ran 12 tests in 0.003s" then "OK" or "FAILED (failures=1, errors=1)"
    for (m of text.matchAll(/Ran (\d+) tests? in [\d.]+s\s+(OK|FAILED \(([^)]*)\))/g)) {
        const failed = m[2] === 'OK' ? 0 : [...(m[3] ?? '').matchAll(/(?:failures|errors)=(\d+)/g)].reduce((a, x) => a + Number(x[1]), 0);
        add(num(m[1]) - failed, failed, m[1]);
    }
    // phpunit: "OK (12 tests, 30 assertions)", "Tests: 12, Assertions: 30, Failures: 2, Errors: 1."
    for (m of text.matchAll(/OK \((\d+) tests?, \d+ assertions?\)/g)) add(m[1], 0, m[1]);
    for (m of text.matchAll(/Tests: (\d+), Assertions: \d+((?:, (?:Failures|Errors|Skipped|Incomplete|Risky|Warnings|Deprecations|Notices): \d+)+)/g)) {
        const bad = [...m[2].matchAll(/(?:Failures|Errors): (\d+)/g)].reduce((a, x) => a + Number(x[1]), 0);
        add(num(m[1]) - bad, bad, m[1]);
    }
    // maven surefire: "Tests run: 18, Failures: 2, Errors: 1, Skipped: 0" (the last line is the total; skipped ones did not pass)
    const surefire = [...text.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+)(?:, Skipped: (\d+))?/g)].at(-1);
    if (surefire) add(num(surefire[1]) - num(surefire[2]) - num(surefire[3]) - num(surefire[4] ?? 0), num(surefire[2]) + num(surefire[3]), surefire[1]);
    // gradle: "12 tests completed, 2 failed"
    for (m of text.matchAll(/(\d+) tests? completed(?:, (\d+) failed)?/g)) add(num(m[1]) - num(m[2] ?? 0), m[2] ?? 0, m[1]);
    // dotnet: "Failed:     0, Passed:    42, Skipped:     0, Total:    42"
    for (m of text.matchAll(/Failed:\s+(\d+), Passed:\s+(\d+)(?:, Skipped:\s+\d+)?, Total:\s+(\d+)/g)) add(m[2], m[1], m[3]);
    // go: "ok  	example.com/pkg	0.012s" lines, "FAIL	example.com/pkg	0.3s", "--- FAIL: TestX"
    const goOk = (text.match(/^ok[ \t]+\S+[ \t]+(?:\(cached\)|[\d.]+s)/gm) ?? []).length;
    const goFail = (text.match(/^(?:FAIL[ \t]+\S+[ \t]+(?:[\d.]+s|\[)|--- FAIL: \S+)/gm) ?? []).length;
    if (goOk || goFail) add(goOk, goFail);
    // Plain words: "101 passed, 0 failed", "12/12 passed", "All 42 tests passed", "42 tests passed", "3 tests, 0 failures"
    for (m of text.matchAll(/\b(\d+) (?:tests? |checks? )?passed,?\s+(\d+) failed\b/gi)) add(m[1], m[2]);
    for (m of text.matchAll(/\b(\d+)\s*\/\s*(\d+) (?:tests? |checks? )?(?:passed|passing|ok|green)\b/gi)) add(m[1], num(m[2]) - num(m[1]), m[2]);
    for (m of text.matchAll(/\ball (\d+) (?:tests?|checks?|specs?) (?:passed|pass|ok)\b/gi)) add(m[1], 0, m[1]);
    for (m of text.matchAll(/\b(\d+) (?:tests?|specs?|checks?) (?:passed|ok)\b(?![,;]\s*\d+ failed)/gi)) add(m[1], 0);
    for (m of text.matchAll(/\b(\d+) tests?, (\d+) failures?\b/gi)) add(num(m[1]) - num(m[2]), m[2], m[1]);
    // PASS/FAIL lines only: count them when nothing above matched.
    if (found.length === 0) {
        const passLines = (text.match(/^\s*(?:✓|✔|PASS\b|ok \d+ )/gm) ?? []).length;
        const failLines = (text.match(/^\s*(?:✗|✘|×|FAIL\b|not ok \d+ )/gm) ?? []).length;
        if (passLines + failLines >= 2) add(passLines, failLines);
    }
    return found.at(-1);
}

/** The first file hash or commit in the output: sha256, a full commit id, or a short one in a push or commit line. */
export function hashIn(text) {
    if (typeof text !== 'string') return undefined;
    const long = /\b[0-9a-f]{64}\b|\b[0-9a-f]{40}\b/i.exec(text);
    if (long) return long[0].toLowerCase();
    const short = /\b([0-9a-f]{7,12})\.\.([0-9a-f]{7,12})\b|^\[[\w./-]+ ([0-9a-f]{7,12})\]|\bcommit ([0-9a-f]{7,40})\b/m.exec(text);
    return short ? (short[2] ?? short[3] ?? short[4]).toLowerCase() : undefined;
}

const UNIT = '(?:ms|s|sec|secs|seconds|min|%|pp|MB|GB|KB|kB|B|MiB|GiB|KiB|tok\\/s|tokens\\/s|t\\/s|req\\/s|rps|qps|ops\\/s|fps|x|°C|items|rows|errors|warnings)';
const DELTA = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${UNIT}?\\s*(?:→|->|=>|⟶|\\bto\\b)\\s*(\\d+(?:\\.\\d+)?)\\s*${UNIT}`, 'i');
const BEFORE_AFTER = /\bbefore\b[^\n]{0,30}?(\d+(?:\.\d+)?)[^\n]{0,60}?\bafter\b[^\n]{0,30}?(\d+(?:\.\d+)?)/i;

/** The first metric that moved in the output ("p50 310 ms -> 120 ms", "before 42 … after 7"), as quoted text. */
export function metricIn(text) {
    if (typeof text !== 'string') return undefined;
    const m = DELTA.exec(text) ?? BEFORE_AFTER.exec(text);
    if (!m) return undefined;
    const start = Math.max(0, text.lastIndexOf('\n', m.index) + 1);
    const end = text.indexOf('\n', m.index + m[0].length);
    return text.slice(start, end < 0 ? undefined : end).trim().slice(0, 120);
}

const NUMS = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+\.\d+|\d+)\s?(ms|µs|us|ns|s|sec|secs|seconds|min|mins|%|x|×|kib|mib|gib|kb|mb|gb|b|bytes|req\/s|rps|qps|ops\/s|tok\/s|fps)?(?![\w/])/gi;
const MAX_NUMS = 64;

/**
 * The figures an output prints, for checking the figures a claim quotes:
 * numbers with a unit or a decimal point first, then whole numbers. Times
 * also count in the other unit (1.8 s is 1800 ms). Capped.
 */
export function numsIn(text) {
    if (typeof text !== 'string' || text === '') return [];
    const strong = new Set();
    const weak = new Set();
    for (const m of text.matchAll(NUMS)) {
        const value = num(m[1]);
        if (!Number.isFinite(value)) continue;
        const unit = (m[2] ?? '').toLowerCase();
        if (unit || /[.,]/.test(m[1])) {
            strong.add(value);
            if (unit === 's' || unit === 'sec' || unit === 'secs' || unit === 'seconds') strong.add(Math.round(value * 1000 * 1000) / 1000);
            if (unit === 'ms') strong.add(value / 1000);
            if (unit === 'min' || unit === 'mins') strong.add(value * 60);
        } else if (value >= 2) weak.add(value);
        if (strong.size >= MAX_NUMS) break;
    }
    return [...strong, ...[...weak].filter((v) => !strong.has(v))].slice(0, MAX_NUMS);
}

/** Readings where a lower number is better. */
const LOWER_IS_BETTER = /^(p\d+(\.\d)?|mean|median|avg|average|latency|duration|time|took|size|bundle|memory|rss|heap|cpu|errors?)$/;
const SERIES = /\b(p\d{2}(?:\.\d)?|mean|median|avg|average|latency|duration|throughput)\b\s*[:=]?\s*(\d+(?:\.\d+)?)\s*(ms|µs|us|s|sec|req\/s|rps|qps|ops\/s|tok\/s)?|(\d+(?:\.\d+)?)\s*(req\/s|rps|qps|ops\/s|tok\/s)\b/gi;

/** Benchmark readings in output order: `[{ l: 'p50', v: 310 }]`, times in ms. */
export function seriesIn(text) {
    if (typeof text !== 'string' || text === '') return [];
    const out = [];
    for (const m of text.matchAll(SERIES)) {
        let label = (m[1] ?? m[5] ?? '').toLowerCase();
        let value = num(m[2] ?? m[4]);
        const unit = (m[3] ?? m[5] ?? '').toLowerCase();
        if (!Number.isFinite(value)) continue;
        if (label === 'throughput') label = unit || 'rps';
        if (unit === 's' || unit === 'sec') value *= 1000;
        if (unit === 'µs' || unit === 'us') value /= 1000;
        out.push({ l: label, v: value });
        if (out.length >= 16) break;
    }
    return out;
}

/** Measures of a model's quality, and which way is better. */
const QUALITY = /^(?:(train|training|val|valid|validation|dev|test|eval|holdout|macro|micro|weighted|mean|best|top)[_\s-]?)*(acc|accuracy|f1|auc|roc_auc|precision|recall|bleu|rouge\w*|map|ndcg|mrr|score|top-?[15]|em|exact_match|r2|loss|perplexity|ppl|wer|cer|mae|mse|rmse)$/i;
const LOWER_QUALITY = /^(loss|perplexity|ppl|wer|cer|mae|mse|rmse)$/i;
const READING = /(?<![\w.])([a-z][\w-]{0,30}?)\s*(?:[:=]\s*|\s{1,8})(-?\d*\.\d+|-?\d+)(?![\w.%])/gi;

/** A model's quality readings in output order: `[{ l: 'val_acc', m: 'acc', s: 'val', v: 0.871 }]`, at most 24. */
export function readingsIn(text) {
    if (typeof text !== 'string' || text === '') return [];
    const out = [];
    for (const m of text.matchAll(READING)) {
        const label = m[1].toLowerCase();
        const q = QUALITY.exec(label);
        if (!q) continue;
        const split = /^(train|training)/.test(label) ? 'train' : /^(val|valid|validation|dev)/.test(label) ? 'val' : /^(test|eval|holdout)/.test(label) ? 'test' : '';
        out.push({ l: label, m: q[2].toLowerCase().replace(/^accuracy$/, 'acc'), s: split, v: Number(m[2]) });
        if (out.length >= 24) break;
    }
    return out;
}

/** A benchmark table's metric columns. */
const TABLE_METRIC = /^(p\d{2}(\.\d)?|mean|median|avg|average|min|max|latency|duration|time|ops\/s|req\/s|rps|qps|tok\/s|throughput|ns\/op|allocs\/op|b\/op)$/i;
/** A table row that is the baseline the other row is measured against. */
const BASELINE = /^(main|master|trunk|baseline|base|before|old|control|current|reference)$/i;
const CELL = /^(-?\d{1,3}(?:,\d{3})+|-?\d+(?:\.\d+)?)\s*(ms|µs|us|ns|s|sec)?$/i;
const cellsOf = (line) => line.replace(/^\|\s*|\s*\|$/g, '').split(/\s*\|\s*|\t+|\s{2,}/).map((c) => c.trim()).filter(Boolean);

/**
 * A benchmark table of a baseline row and one other ("store  p50  p95 /
 * main  318ms  412ms / indexed  357ms  489ms") as readings in that order,
 * baseline first: `[{ l, v }]`, times in ms; empty when there is none.
 */
export function tableIn(text) {
    if (typeof text !== 'string' || text === '') return [];
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200);
    for (let h = 0; h < lines.length - 2; h += 1) {
        const head = cellsOf(lines[h]);
        if (head.length < 2 || !head.slice(1).some((c) => TABLE_METRIC.test(c))) continue;
        const rows = [];
        for (let r = h + 1; r < lines.length && rows.length < 3; r += 1) {
            if (/^[-=|+:\s]+$/.test(lines[r])) continue;
            const cells = cellsOf(lines[r]);
            if (cells.length !== head.length) break;
            const values = cells.slice(1).map((c) => CELL.exec(c));
            if (values.some((v) => !v)) break;
            rows.push({ label: cells[0], values: values.map((v) => {
                const unit = (v[2] ?? '').toLowerCase();
                const n = num(v[1]);
                return unit === 's' || unit === 'sec' ? n * 1000 : unit === 'µs' || unit === 'us' ? n / 1000 : unit === 'ns' ? n / 1e6 : n;
            }) });
        }
        if (rows.length !== 2) continue;
        const base = rows.findIndex((r) => BASELINE.test(r.label));
        if (base < 0 || BASELINE.test(rows[1 - base].label)) continue;
        const out = [];
        for (const row of [rows[base], rows[1 - base]]) {
            head.slice(1).forEach((label, at) => { if (TABLE_METRIC.test(label)) out.push({ l: label.toLowerCase(), v: row.values[at] }); });
        }
        return out;
    }
    return [];
}

/** File hashes an output lists ("<sha256>  dist/app.tar.gz", "SHA256 (app.tar.gz) = <sha256>"): `[{ h, f }]`, by file name. */
export function hashPairsIn(text) {
    if (typeof text !== 'string' || text === '') return [];
    const out = [];
    for (const line of text.split(/\r?\n/).slice(0, 400)) {
        const gnu = /^\s*(?:\d+\t)?([0-9a-f]{32,128})\s+[* ]?(\S+)\s*$/i.exec(line);
        const bsd = /^\s*(?:\d+\t)?(?:SHA\d+|MD5|BLAKE2\w*)\s*\((\S+)\)\s*=\s*([0-9a-f]{32,128})\s*$/i.exec(line);
        const h = gnu?.[1] ?? bsd?.[2];
        const f = gnu?.[2] ?? bsd?.[1];
        if (h && f) out.push({ h: h.toLowerCase(), f: f.split(/[\\/]/).pop() });
        if (out.length >= 8) break;
    }
    return out;
}

const MAX_LINE = 120;
/** The line of `text` at `index`, trimmed and clipped. */
function lineAt(text, index) {
    const start = text.lastIndexOf('\n', index) + 1;
    const end = text.indexOf('\n', index);
    return clip(text.slice(start, end < 0 ? undefined : end).trim(), MAX_LINE);
}
/** An output's first two and last six lines, for checking a claim that quotes them. */
function linesOf(text) {
    const all = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !/^\[(stderr|exit code: -?\d+)\]$/.test(l));
    const keep = all.length > 8 ? [...all.slice(0, 2), ...all.slice(-6)] : all;
    return keep.map((l) => clip(l, MAX_LINE));
}

/** Output that says a deploy, push or publish went through (true), failed (false), or neither (undefined). */
export function deployIn(text) {
    if (typeof text !== 'string' || text === '') return undefined;
    if (/(\[rejected\]|\[remote rejected\]|failed to push|\bERR! (code|publish|403|404)\b|\bdeploy(ment)? failed\b|\brelease failed\b|\brollout failed\b|\berror: failed\b|^fatal:|\bpermission denied\b|\bdenied:|\bauthentication failed\b|\b403 Forbidden\b|\b401 Unauthorized\b|\bchecks failed\b|\btimed out waiting\b|\bexceeded its progress deadline\b|\bfailed to (deploy|release|publish|upload)\b|\bError: (?!0\b))/im.test(text)) return false;
    if (/^\s+[0-9a-f]{7,12}\.\.\.?[0-9a-f]{7,12}\s+\S+\s+->\s+\S+/m.test(text)) return true;
    if (/^\s*\*\s+\[new (branch|tag)\]\s+\S+\s+->\s+\S+/m.test(text)) return true;
    if (/^\+\s+[@\w./-]+@\d+\.\d+\.\d+/m.test(text)) return true;
    if (/\bEverything up-to-date\b/.test(text)) return true;
    if (/: digest: sha256:[0-9a-f]{12,}/.test(text)) return true;
    if (/\b(Merged pull request|Squashed and merged|Rebased and merged|✓ Merged)\b/i.test(text)) return true;
    if (/\b(deployed|deployment (complete|completed|succeeded|successful|is live|ready)|successfully (deployed|released|published|rolled out|uploaded)|rollout complete|release (v?\S+ )?(created|published)|published to|live at|now live|uploaded to|version \S+ is live|Released v\d+|Production: https?:|Published|Uploading distributions|View at:\s+https?:|Apply complete!|deployment "\S+" successfully rolled out)\b/i.test(text)) return true;
    if (/\bHTTP\/[\d.]+ 2\d\d\b|\b(200|201|202|204) (OK|Created|Accepted|No Content)\b|"status"\s*:\s*"(ok|healthy|success|deployed|live)"/i.test(text)) return true;
    return undefined;
}

/** A CI read that shows success (true), failure (false), or neither. */
export function ciIn(text) {
    if (typeof text !== 'string' || text === '') return undefined;
    const t = text.replace(/\b(0|no|zero) (failed|failures?|failing)\b/gi, ' ');
    if (/^\s*(X|✗|✘|×)\s|\bfail(ed|ure|ing)?\b|\bcancell?ed\b|\btimed[_ ]out\b|\baction_required\b|\bconclusion["']?\s*:\s*["']?(failure|cancelled)/im.test(t)) return false;
    if (/^\s*(\*|•|pending|in_progress|queued)\s|\b(in progress|pending|queued|in_progress|waiting)\b/im.test(t) && !/\b(success|passed|completed|successful)\b|✓|✔/i.test(t)) return undefined;
    if (/\b(success|successful|passed|completed\s+success|all checks (have )?passed|conclusion["']?\s*:\s*["']?success)\b|✓|✔/i.test(t)) return true;
    return undefined;
}

/** The HTTP status a request printed: a number, 'ok' for a healthy body, 0 for no answer; undefined when it does not say. */
export function statusIn(text) {
    if (typeof text !== 'string') return undefined;
    const head = [...text.matchAll(/\bHTTP\/[\d.]+\s+(\d{3})\b/g)].at(-1);
    if (head) return Number(head[1]);
    const curlError = /\bcurl: \(\d+\)[^\n]*?\b(?:error|returned)[^\n]*?\b([1-5]\d\d)\b/i.exec(text);
    if (curlError) return Number(curlError[1]);
    // A bare code, as `curl -w '%{http_code}'` prints it, alone or before its time ("200 9.31s").
    const bare = /^\s*(\d{3})(?:\s+\d+(?:\.\d+)?\s*m?s)?\s*$/m.exec(text);
    if (bare && Number(bare[1]) >= 100 && Number(bare[1]) < 600) return Number(bare[1]);
    if (/\bcurl: \(\d+\)|\bconnection refused\b|\bcould not resolve\b|\bfailed to connect\b|\bno route to host\b/i.test(text)) return 0;
    const body = text.replace(/\[stderr\][\s\S]*$/, '').trim();
    if (/^("?(ok|healthy|up|pong|alive|ready|pass)"?|\{[^{}]{0,300}"(status|state|health)"\s*:\s*"(ok|healthy|up|pass|passing|ready|green|success)"[^{}]{0,300}\})$/i.test(body)) return 'ok';
    if (/^\{[^{}]{0,300}"(status|state|health)"\s*:\s*"(down|unhealthy|fail|failing|error|degraded|red)"/i.test(body)) return 503;
    return undefined;
}

/** What an output says about health checks: true when they pass, false when one fails, else undefined. */
export function healthIn(text) {
    if (typeof text !== 'string' || text === '') return undefined;
    if (/\b(health ?checks? (failed|failing)|unhealthy|failing health|readiness probe failed|liveness probe failed)\b|\b(GET|HEAD) \S+ -> [45]\d\d\b|\bCrashLoopBackOff\b/i.test(text)) return false;
    if (/\b(health ?checks? (passing|passed|ok)|all checks passing|is now in a good state|\bhealthy\b|readiness probe succeeded)\b|\b(GET|HEAD) \S+ -> 2\d\d\b/i.test(text)) return true;
    return undefined;
}

/** The word a status read reports on its own line ("Status: Succeeded"), as printed; the last one wins. */
function stateIn(text) {
    if (typeof text !== 'string' || text === '') return undefined;
    return [...text.matchAll(/(?:^|\n|[{,])\s*"?(?:status|phase|state|result|conclusion)"?\s*[:=]\s*"?([A-Za-z_]+)/gi)].at(-1)?.[1];
}

/** A job state a status read prints without a key: a line that is only the word (`success`), or one in capitals in a table (`COMPLETED`). */
function stateWordIn(text) {
    if (typeof text !== 'string' || text === '') return undefined;
    const alone = [...text.matchAll(/^\s*(success|succeeded|failed|running|queued|completed|cancell?ed)\s*$/gim)].at(-1);
    if (alone) return alone[1];
    return [...text.matchAll(/\b(COMPLETED|SUCCEEDED|FAILED|CANCELL?ED|TIMEOUT|OUT_OF_MEMORY|NODE_FAIL|PREEMPTED|RUNNING|PENDING)\b/g)].at(-1)?.[1];
}

/** The state a status read reports on its own line ("Status: Succeeded", "phase: Failed", `"state": "RUNNING"`): true, false or 'running'. */
export function endedIn(text) {
    const said = (stateIn(text) ?? stateWordIn(text))?.toLowerCase();
    if (!said) {
        // `kubectl wait --for=condition=complete` and `kubectl get job` say it their own way.
        if (/\bcondition met\b/i.test(text ?? '')) return true;
        const done = /^\s*NAME\s+COMPLETIONS\b[^\n]*\n\s*\S+\s+(\d+)\/(\d+)\s/m.exec(text ?? '');
        return done ? (done[1] === done[2] ? true : 'running') : undefined;
    }
    if (/^(succeeded|success|successful|completed?|done|finished|ok|passed)$/.test(said)) return true;
    if (/^(failed|failure|error|errored|cancell?ed|aborted|timedout|timed_out|timeout|killed|crashed|lost|terminated|oomkilled)$/.test(said)) return false;
    if (/^(pending|running|queued|in_progress|inprogress|submitted|starting|started|scheduled|waiting|active|runnable)$/.test(said)) return 'running';
    return undefined;
}

/** What a benchmark run says about speed: false when it says it got slower, true when faster; else undefined. */
const SLOWER = /\b(performance has regressed|performance regression|regressed by|regression detected|got slower|is slower|slower than (?:the )?(?:baseline|main|before|previous))\b/i;
const FASTER = /\b(performance has improved|improved by|got faster|is faster|faster than (?:the )?(?:baseline|main|before|previous))\b/i;

/** Pods or services that are not well, in a status read. */
const UNWELL_STATE = /\b(CrashLoopBackOff|ImagePullBackOff|ErrImagePull|OOMKilled|CreateContainerConfigError|Evicted|failed \(Result|inactive \(dead\)|Exited \(\d+\)|unhealthy|Restarting|Error)\b/;
const UNWELL = new RegExp(`${UNWELL_STATE.source}|^\\S+\\s+0\\/\\d+\\s`, 'm');
/** Pods or services that are well, in the same kind of read. */
const WELL = /^\S+\s+(\d+)\/\1\s+Running\b|\bactive \(running\)|\bUp \d+ (seconds?|minutes?|hours?|days?)\b(?! \(unhealthy\))/m;

/** The warnings an output reports: its summary count, or its `warning:` lines. */
export function warningsIn(text) {
    if (typeof text !== 'string' || text === '') return 0;
    let n = 0;
    for (const m of text.matchAll(/\b(\d+)\s+warn(?:ing)?s?\b|\bwarnings?:\s*(\d+)\b|\b(\d+)\s+Warning\(s\)/gi)) n = Math.max(n, Number(m[1] ?? m[2] ?? m[3]));
    const lines = (text.match(/^[^\n]*\bwarning\b\s*(?::|\[|\s{2,})[^\n]*$/gim) ?? []).length;
    return Math.max(n, lines);
}

/** HTTP statuses a run reports having seen ("Expected status 503, got 200", "HTTP/1.1 404"), at most four. */
export function codesIn(text) {
    if (typeof text !== 'string' || text === '') return [];
    const out = new Set();
    for (const m of text.matchAll(/\b(?:got|received|returned|responded with|status(?:\s+code)?|statusCode|response code)\s*[:=]?\s*([1-5]\d\d)\b|\bHTTP\/[\d.]+\s+([1-5]\d\d)\b/gi)) {
        out.add(Number(m[1] ?? m[2]));
        if (out.size >= 4) break;
    }
    return [...out];
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The command a shell call ran, from its arguments (an object, or JSON text). */
export function commandOf(args) {
    let a = args;
    if (typeof a === 'string') {
        try { a = JSON.parse(a); } catch { return oneLine(a); }
    }
    if (!a || typeof a !== 'object') return '';
    const c = a.command ?? a.cmd ?? a.script ?? a.input ?? a.code;
    return Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : '';
}

/** The file a change or read tool worked on, from its arguments. */
function fileOf(args) {
    let a = args;
    if (typeof a === 'string') {
        try { a = JSON.parse(a); } catch { return ''; }
    }
    if (!a || typeof a !== 'object') return '';
    const f = a.file_path ?? a.path ?? a.filePath ?? a.file ?? a.target ?? a.filename ?? a.notebook_path ?? (Array.isArray(a.paths) ? a.paths[0] : undefined);
    return typeof f === 'string' ? f : '';
}

/** The text a change tool writes, from its arguments: the new string, the content or the patch. */
function contentOf(args) {
    let a = args;
    if (typeof a === 'string') {
        try { a = JSON.parse(a); } catch { return a; }
    }
    if (!a || typeof a !== 'object') return '';
    const c = a.new_string ?? a.content ?? a.patch ?? a.diff ?? a.text ?? (Array.isArray(a.edits) ? a.edits.map((e) => e?.new_string ?? '').join('\n') : '');
    return typeof c === 'string' ? c.slice(0, 20000) : '';
}

const base = (path) => path.split(/[\\/]/).filter(Boolean).slice(-2).join('/');

/** How a run went, from its exit and what its output says. */
function outcome(exit, extra) {
    if (extra === false) return false;
    if (typeof exit === 'number') return exit === 0;
    if (exit === null) return extra ?? null;
    return false;
}

/** What kind of run a shell command is. */
function kindOfCommand(command, tests) {
    const ships = targetsOf(command).some((t) => t === 'repo' || t === 'registry' || t === 'env');
    return TEST_CMD.test(command) ? 'test'
        : LINT_CMD.test(command) ? 'lint'
            : ships ? 'deploy'
                : CI_CMD.test(command) ? 'ci'
                    : BUILD_CMD.test(command) ? 'build'
                        : HASH_CMD.test(command) ? 'hash'
                            : PROBE_CMD.test(command) || REGISTRY_READ_CMD.test(command) ? 'probe'
                                : tests ? 'test'
                                    : CHANGE_CMD.test(command) ? 'change' : 'run';
}

/** Where a shipping command sends the work: repo, registry, env; tag and merge for local ones. */
function targetsOf(command) {
    const out = new Set();
    if (PUSH_CMD.test(command)) out.add('repo');
    if (PUBLISH_CMD.test(command)) out.add('registry');
    if (RELEASE_CMD.test(command) || DEPLOY_REMOTE.test(command)) out.add('env');
    if (/\bgit\s+tag\b/i.test(command)) out.add('tag');
    if (/\bgit\s+(merge|rebase)\b/i.test(command)) out.add('merge');
    return [...out];
}

/**
 * One tool call and its result as an evidence item:
 * `{ tool, kind, ok, exit?, cmd?, change?, code?, targets?, shipped?, status?, health?, tests?, hash?, metric?, series?, nums?, text }`.
 * `kind` is test, build, lint, ci, deploy, probe, hash, run, change, read or other;
 * bookkeeping tools (todos, goals, questions) give undefined.
 */
export function itemOf({ name, args, text, isError = false }) {
    const tool = String(name ?? '');
    if (tool === '' || BOOKKEEPING_TOOL.test(tool)) return undefined;
    const out = typeof text === 'string' ? text : '';
    const shell = SHELL_TOOL.test(tool);
    const command = shell ? commandOf(args) : '';
    const tests = testCountsIn(out);
    const hash = hashIn(out);
    const metric = metricIn(out);
    const table = tableIn(out);
    const series = table.length ? table : seriesIn(out);
    const nums = numsIn(out);
    const pairs = hashPairsIn(out);
    const exit = exitOf(out, { isError, shell });
    const facts = {};
    const warnings = warningsIn(out);
    if (warnings) facts.warnings = warnings;
    const codes = codesIn(out);
    if (codes.length) facts.codes = codes;
    if (tests && !(shell && /^(deploy|probe|lint|hash|build)$/.test(kindOfCommand(commandOf(args), tests)))) facts.tests = tests;
    if (hash) facts.hash = hash;
    if (metric) facts.metric = metric;
    if (series.length) facts.series = series;
    // A table of a baseline row and one other is a before-and-after in one run.
    if (table.length) facts.ab = true;
    if (nums.length) facts.nums = nums;
    if (pairs.length) facts.pairs = pairs;
    const readings = readingsIn(out);
    if (readings.length) facts.readings = readings;
    const ciRead = shell && CI_CMD.test(commandOf(args)) ? ciIn(out) : undefined;
    const ended = ciRead ?? endedIn(out) ?? (shell && CI_CMD.test(commandOf(args)) && /\b(in progress|in_progress|queued|pending|waiting)\b/i.test(out) ? 'running' : undefined);
    if (ended !== undefined) {
        facts.ended = ended;
        const state = stateIn(out) ?? stateWordIn(out);
        if (state) facts.state = clip(state, 24);
    }
    const slower = SLOWER.exec(out);
    if (slower) facts.perf = { ok: false, said: lineAt(out, slower.index) };
    else if (FASTER.test(out)) facts.perf = { ok: true, said: lineAt(out, FASTER.exec(out).index) };
    if (shell) {
        const changes = CHANGE_CMD.test(command);
        const targets = targetsOf(command);
        const ships = targets.some((t) => t === 'repo' || t === 'registry' || t === 'env');
        const kind = kindOfCommand(command, tests);
        const http = kind === 'probe' && /\b(curl|wget|httpie|xh|hey|ab|http)\b/i.test(command) && !/\bkubectl\b/i.test(command) ? statusIn(out) : undefined;
        const health = healthIn(out);
        const registry = kind === 'probe' && REGISTRY_READ_CMD.test(command);
        const extra = kind === 'test' && tests ? tests.failed === 0 && tests.passed > 0
            : kind === 'deploy' ? deployIn(out)
                : kind === 'ci' ? ciIn(out)
                    : kind === 'hash' ? (/\b(FAILED|did NOT match|BAD signature|mismatch)\b/i.test(out) ? false : undefined)
                        : kind === 'probe' && !registry ? (http !== undefined ? http === 'ok' || (http >= 200 && http < 400) : (UNWELL.test(out) || health === false ? false : undefined))
                            : (kind === 'build' || kind === 'lint') && /(^|\s)(error TS\d+|error\[E\d+\]|ERROR in |BUILD FAILED|FAILURE:|Failed to compile|compiled with \d+ errors?|✖ \d+ problems? \([1-9]\d* errors?)/m.test(out) ? false
                                : undefined;
        // A probe that answered says how it went even when the exit is 0 (curl prints 502 and exits 0).
        const ok = kind === 'probe' && http !== undefined && exit === 0 ? extra : outcome(exit, extra);
        const shipped = ships ? (kind === 'deploy' ? ok : outcome(exit, deployIn(out))) : undefined;
        // A download that went through (`curl -sO …` before a checksum) is a request that answered.
        const fetched = kind !== 'probe' && /\b(curl|wget)\b/i.test(command) && exit === 0 && !/\bcurl: \(\d+\)|\b(4\d\d|5\d\d) (Not Found|Forbidden|Unauthorized|Internal Server Error|Bad Gateway|Service Unavailable)\b/i.test(out);
        const ran = `\`${clip(oneLine(command) || tool, 80)}\``;
        const how = typeof exit === 'number' ? `exited ${exit}` : exit === null ? 'ran' : exit === 'error' ? 'failed to run' : exit === 'denied' ? 'was denied by the sandbox' : exit === 'timeout' ? 'timed out' : `ended (${exit})`;
        // A status read that lists some pods well and some not ("2 in CrashLoopBackOff, 3 Running").
        const unwell = kind === 'probe' && http === undefined && UNWELL.test(out);
        const mixed = unwell && WELL.test(out);
        const detail = http !== undefined ? (http === 0 ? 'no answer' : http === 'ok' ? 'answered ok' : `HTTP ${http}`)
            : unwell ? `it shows ${UNWELL_STATE.exec(out)?.[1] ?? 'a pod that is not ready'}${mixed ? ' next to others running' : ''}`
            : facts.tests ? `${tests.passed} passed, ${tests.failed} failed`
                : hash ? hash.slice(0, 12)
                    : facts.state && kind !== 'ci' ? `status ${facts.state}`
                        : metric ?? (kind === 'deploy' && extra ? 'went through' : '');
        return {
            tool, kind, ok, exit,
            cmd: clip(oneLine(command), 240),
            ...(changes ? { change: true } : {}),
            ...(CODE_CHANGE_CMD.test(command) ? { code: true } : {}),
            ...(APPLY_CMD.test(command) || MIGRATE_CMD.test(command) ? { apply: true } : {}),
            ...(mixed ? { mixed: true } : {}),
            ...(targets.length ? { targets } : {}),
            ...(ships ? { shipped } : {}),
            ...(http !== undefined ? { status: http } : {}),
            ...(health !== undefined ? { health } : {}),
            ...(kind === 'ci' && /\b(deploy|publish|upload|release|rollout|ship)/i.test(out) ? { deploys: true } : {}),
            ...(JOB_CMD.test(command) ? { job: true } : {}),
            ...(changes && (ROUTE_FILE.test(command) || ROUTE_CODE.test(command)) ? { route: true } : {}),
            ...(registry ? { registry: true } : {}),
            ...(fetched ? { fetched: true } : {}),
            ...(ships && /\bEverything up-to-date\b/.test(out) ? { upToDate: true } : {}),
            ...(series.length && /\b(before|baseline)\b[\s\S]*\b(after|patched|now)\b/i.test(out) ? { ab: true } : {}),
            ...facts,
            ...(out.trim() ? { lines: linesOf(out) } : {}),
            text: clip(`${ran} ${how}${detail ? `: ${detail}` : ''}`, 180),
        };
    }
    if (CHANGE_TOOL.test(tool)) {
        const file = fileOf(args);
        const ok = !isError && !/^\s*(error|failed|could not|cannot|no such file)/i.test(out);
        const route = ROUTE_FILE.test(file) || ROUTE_CODE.test(contentOf(args));
        return { tool, kind: 'change', ok, change: true, ...(DOC_FILE.test(file) ? {} : { code: true }), ...(route ? { route: true } : {}), ...facts, text: clip(`${tool}${file ? ` ${base(file)}` : ''}${ok ? '' : ' (failed)'}`, 180) };
    }
    if (READ_TOOL.test(tool)) {
        const file = fileOf(args);
        return { tool, kind: 'read', ok: !isError, ...facts, text: clip(`${tool}${file ? ` ${base(file)}` : ''}`, 180) };
    }
    // Any other tool (a plugin's or a server's): its own words say how it went.
    const said = deployIn(out);
    const ok = isError ? false : typeof exit === 'number' ? exit === 0 : tests ? tests.failed === 0 : !/^\s*(error|failed|could not|cannot)\b/i.test(out);
    const kind = tests ? 'test' : said !== undefined && /deploy|release|publish|push/i.test(tool) ? 'deploy' : 'other';
    const first = oneLine(out).slice(0, 100);
    return { tool, kind, ok, ...(typeof exit === 'number' ? { exit } : {}), ...(kind === 'deploy' ? { shipped: ok && said !== false } : {}), ...facts, ...(out.trim() ? { lines: linesOf(out) } : {}), text: clip(`${tool}${first ? `: ${first}` : ''}`, 180) };
}

// ── Does the evidence back the claim ───────────────────────────────

const RUNS = new Set(['test', 'build', 'lint', 'ci', 'deploy', 'run', 'probe', 'hash']);
const ACCEPT = {
    tests: ['test'],
    build: ['build', 'test'],
    lint: ['lint'],
    ci: ['ci', 'test'],
    hash: ['hash'],
    any: ['test', 'build', 'lint', 'ci', 'hash'],
};
/** Which runs show a fix worked, by what the claim is about. */
const FIX_CHECKS = {
    tests: ['test'],
    build: ['build', 'test'],
    lint: ['lint'],
    ci: ['ci', 'test'],
    any: ['test', 'run', 'probe', 'build', 'deploy', 'hash', 'ci'],
};
const NONE_RAN = {
    tests: 'No test ran in this turn.',
    build: 'No build or test ran in this turn.',
    lint: 'No lint ran in this turn.',
    ci: 'No CI result was read and no test ran in this turn.',
    hash: 'No checksum was computed in this turn.',
    any: 'Nothing in this turn ran tests, a build, lint or a CI check.',
};
const LAST_FAILED = { tests: 'test run', build: 'build', lint: 'lint run', ci: 'check', hash: 'checksum check', any: 'run' };
const TARGET_WORDS = {
    repo: { none: 'No push ran in this turn.', last: 'push' },
    registry: { none: 'Nothing in this turn published it: no publish or image push ran.', last: 'publish' },
    env: { none: 'No deploy ran in this turn.', last: 'deploy' },
    any: { none: 'No deploy, push or publish ran in this turn.', last: 'deploy, push or publish' },
};

/** The number of tests a claim names ("all 42 tests", "12/12 pass"), or undefined. */
function namedCount(text) {
    const m = /\b(\d+)\s*\/\s*(\d+)\b|\b(?:all\s+)?(\d+)\s+(?:of\s+(?:its|the)\s+)?(?:unit\s+|e2e\s+|integration\s+)?(?:tests?|specs?|examples?)\b/i.exec(text);
    if (!m) return undefined;
    return { passed: num(m[1] ?? m[3]), total: num(m[2] ?? m[3]) };
}

const WRAPPERS = new Set(['npx', 'bunx', 'pnpx', 'sudo', 'time', 'env', 'exec', 'command', 'nice']);
/** A command's words that matter for matching: no flags, no `FOO=1`, no wrappers such as npx or `python -m`. */
function wordsOf(command) {
    const out = [];
    const raw = String(command).toLowerCase().split(/[\s;&|()]+/).filter(Boolean);
    for (let at = 0; at < raw.length; at += 1) {
        const w = raw[at];
        if (w.startsWith('-') || /^[a-z_][a-z0-9_]*=/.test(w)) continue;
        if (out.length === 0 && WRAPPERS.has(w)) continue;
        if ((w === 'python' || w === 'python3') && raw[at + 1] === '-m') continue;
        if ((w === 'uv' || w === 'poetry') && raw[at + 1] === 'run') { at += 1; continue; }
        if (w === 'bundle' && raw[at + 1] === 'exec') { at += 1; continue; }
        out.push(w.replace(/^\.\//, ''));
    }
    return out;
}

/** Whether `wanted` (a command a claim names) ran in `item`: its first words in order, flags aside. */
function ranCommand(item, wanted) {
    if (!item.cmd) return false;
    const all = wordsOf(wanted);
    const words = all.slice(0, all[1] === 'run' || all[1] === 'exec' ? 3 : 2);
    if (words.length === 0) return false;
    const have = wordsOf(item.cmd);
    let at = 0;
    for (const w of have) {
        if (at < words.length && (w === words[at] || w.endsWith(`/${words[at]}`) || (words[at].includes('/') && w.startsWith(words[at])))) at += 1;
    }
    return at === words.length;
}

/** How far a figure a claim quotes may be from what printed: half its last digit (310 is 305 to 315), and 5 %. */
function slack(metric) {
    const digits = String(metric.text ?? metric.value).replace(/[^\d.]/g, '');
    const [whole = '', frac] = digits.split('.');
    const zeros = whole.length - whole.replace(/0+$/, '').length;
    const place = frac ? 10 ** -frac.length : 10 ** Math.min(zeros, whole.length - 1);
    return Math.max(0.05 * Math.abs(metric.value), place / 2);
}

const near = (a, b, room) => Math.abs(a - b) <= room;

/** Whether the turn printed a figure. */
function printed(items, metric) {
    const room = slack(metric);
    return items.some((i) => (i.nums ?? []).some((n) => near(n, metric.value, room)));
}

/** Whether a figure of an "it got faster" claim follows from two printed ones: their difference, ratio or change in percent. */
function derivable(items, metric) {
    const room = slack(metric);
    const all = [...new Set(items.flatMap((i) => i.nums ?? []))].slice(0, 160);
    for (const a of all) {
        for (const b of all) {
            if (a === b || a <= 0 || b <= 0) continue;
            if (near(a - b, metric.value, room)) return true;
            if (near(a / b, metric.value, Math.max(room, 0.15))) return true;
            if (near(((a - b) / a) * 100, metric.value, Math.max(room, 1.5))) return true;
        }
    }
    return false;
}

/** The benchmark readings that moved the wrong way for an "it got faster" claim, as words; undefined when none did. */
function worse(items) {
    const runs = items.filter((i) => (i.series ?? []).length);
    const pairs = new Map();
    const first = runs[0];
    const last = runs.at(-1);
    if (runs.length >= 2 && ranCommand(first, last.cmd ?? '') ) {
        // The same benchmark twice: each label's first reading in the first run against the one in the last.
        const firstOf = (item) => {
            const m = new Map();
            for (const r of item.series) if (!m.has(r.l)) m.set(r.l, r.v);
            return m;
        };
        const a = firstOf(first);
        const b = firstOf(last);
        for (const [label, from] of a) if (b.has(label)) pairs.set(label, [from, b.get(label)]);
    } else if (runs.length >= 1 && last.ab) {
        // One run that prints before and after: each label's first reading against its last.
        for (const r of last.series) {
            if (!pairs.has(r.l)) pairs.set(r.l, [r.v, r.v]);
            else pairs.get(r.l)[1] = r.v;
        }
    }
    const bad = [];
    let good = 0;
    for (const [label, [from, to]] of pairs) {
        if (to === from) continue;
        const lower = LOWER_IS_BETTER.test(label);
        const unit = lower ? ' ms' : '';
        if (lower ? to > from : to < from) bad.push(`${label} ${from}${unit} -> ${to}${unit}`);
        else good += 1;
    }
    return bad.length && good === 0 ? bad.slice(0, 2).join(', ') : undefined;
}

const said = (item) => item.text;
const lastIndex = (list, test) => {
    for (let i = list.length - 1; i >= 0; i -= 1) if (test(list[i])) return i;
    return -1;
};
const listed = (parts) => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]);

/** Figures that come from arithmetic on what printed ("3x faster", "40% less", "saved 2 s"). */
const derived = (metric, claim) => metric.unit === 'x' || metric.unit === '×' || /\b(by|less|fewer|faster|slower|smaller|cut|drop(ped)?|reduc\w*|improv\w*|sav(ed|es|ing)|shav\w*|lower|higher)\b/i.test(claim.part ?? '') && metric.unit === '%';

/** What a named command, a quoted figure or a turn's own benchmark says, before the kind's own rule: a result, or undefined. */
function namedChecks(claim, list) {
    if (claim.kind === 'passed' || claim.kind === 'deployed') {
        for (const wanted of claim.commands ?? []) {
            const runs = list.filter((i) => ranCommand(i, wanted));
            if (runs.length === 0) return { verdict: 'unbacked', evidence: [], why: `It names \`${clip(wanted, 60)}\`, which did not run in this turn.` };
            const last = runs.at(-1);
            if (last.ok === false) return { verdict: 'contradicted', evidence: [said(last)], why: `\`${clip(wanted, 60)}\` did not pass in this turn: ${last.text}.` };
        }
    }
    if (claim.improved) {
        const wrong = worse(list);
        if (wrong) return { verdict: 'contradicted', evidence: list.filter((i) => i.series).slice(-2).map(said), why: `The turn's own numbers went the other way: ${wrong}.` };
        // The benchmark's own words: "Performance has regressed."
        const verdict = list.filter((i) => i.perf).at(-1);
        if (verdict && verdict.perf.ok === false) return { verdict: 'contradicted', evidence: [said(verdict)], why: `The turn's own benchmark says it got slower: "${verdict.perf.said}".` };
    }
    const required = (claim.metrics ?? []).filter((m) => !derived(m, claim));
    const missing = required.filter((m) => !printed(list, m) && !(claim.improved && derivable(list, m)));
    if (missing.length) {
        return { verdict: 'unbacked', evidence: [], why: `It quotes ${listed(missing.slice(0, 3).map((m) => m.text))}, which no output in this turn shows.` };
    }
    return undefined;
}

/** A person's message that asks to build or cut something: "Cut the signed release APK", "Rebuild the marts". */
const BUILD_ASK = /(^|[.!?\n]\s*)(please\s+|now\s+|then\s+|also\s+)?(cut|build|rebuild|package|assemble|compile|bundle|sign|release)\b|\b(can|could|would|will) you\s+(please\s+)?(cut|build|rebuild|package|assemble|compile|bundle|sign|release)\b/i;
/** Words of a person's message that ask for a change to files. */
const CHANGE_ASK = /\b(add|fix|make|change|update|create|write|rename|remove|delete|move|refactor|implement|migrate|convert|rewrite|bump|pin|upgrade|downgrade|wire|register|expose|export|document|port|split|extract|replace|clean up|set up|configure|enable|disable|introduce|backfill|patch|edit|consolidate|dedupe|deduplicate|tidy|merge|inline|simplify|restructure|reorgani[sz]e|rework|tweak|adjust|harden|generate|regenerate|scaffold|stub|vendor|provision|apply|spin up)\b/i;

/** Words of a claim's sentence that make a CI read cover all it names ("PR #12 is green: lint, tests and build pass"). */
const CI_WORDS = /\b(ci|pipelines?|workflows?|github actions|checks|pr\s*#?\d+|pull request|the pr|#\d+)\b/i;

/**
 * A file whose hash the turn computed differs from the hash a manifest or
 * a download listed for it: a contradiction, or undefined.
 */
function hashClash(list) {
    const listed = new Map();
    for (const i of list) if (i.kind !== 'hash') for (const p of i.pairs ?? []) listed.set(p.f, { ...p, item: i });
    for (const i of [...list].reverse()) {
        if (i.kind !== 'hash') continue;
        for (const p of i.pairs ?? []) {
            const other = listed.get(p.f);
            if (other && other.h.length === p.h.length && other.h !== p.h) {
                return { verdict: 'contradicted', evidence: [said(other.item), said(i)], why: `The turn's own output shows two different hashes for ${p.f}: ${other.h.slice(0, 12)}… listed, ${p.h.slice(0, 12)}… computed.` };
            }
        }
    }
    return undefined;
}

/** A claim of no warnings at all ("compiled with zero warnings"); "no new warnings" allows old ones. */
const NO_WARNINGS = /\b(?:no|zero|0)\s+(?:compiler\s+|build\s+|lint\s+|type\s+|javac\s+)?warnings?\b|\bwarning-free\b|\bwithout\s+(?:any\s+)?warnings\b|\bnot a single warning\b/i;

/** Kinds of tests: how a claim names them, and how a command limits a run to them. */
const SUITES = [
    { name: 'unit', said: /\bunit\b/i, ran: /\bunit\b|--lib\b/i },
    { name: 'integration', said: /\bintegration\b/i, ran: /\bintegration\b|--test\s+(?!-)\S|\bit\b(?=[:/])/i },
    { name: 'end-to-end', said: /\b(e2e|end-to-end)\b/i, ran: /\be2e\b|\bend-to-end\b|\bplaywright\b|\bcypress\b/i },
    { name: 'doc', said: /\bdoc(?:-|\s)?tests?\b|\bdoctests?\b/i, ran: /--doc\b|\bdoctest/i },
    { name: 'smoke', said: /\bsmoke\b/i, ran: /\bsmoke\b/i },
];
/** The kinds of tests a command was limited to; empty when it ran them all. */
const suitesRun = (cmd) => SUITES.filter((k) => k.ran.test(cmd ?? '')).map((k) => k.name);

/** Rule for `passed` and one subject: its runs, the last one passed, after the last change to code. */
function passedFor(subject, claim, list) {
    const words = claim.part ?? claim.text;
    const accept = ACCEPT[subject] ?? ACCEPT.any;
    const fits = (i) => accept.includes(i.kind) || (i.tests && subject !== 'lint' && subject !== 'hash') || (claim.commands ?? []).some((c) => ranCommand(i, c));
    const relevant = list.filter(fits);
    if (relevant.length === 0) return { verdict: 'unbacked', evidence: [], why: NONE_RAN[subject] ?? NONE_RAN.any };
    const last = relevant.at(-1);
    const what = LAST_FAILED[subject] ?? 'run';
    if (last.ok === false) return { verdict: 'contradicted', evidence: [said(last)], why: `The last ${what} in this turn did not pass: ${last.text}.` };
    if (last.ok === null) return { verdict: 'unbacked', evidence: [said(last)], why: `It is not clear how the last ${what} ended: ${last.text}.` };
    if (NO_WARNINGS.test(claim.text ?? words) && (last.warnings ?? 0) > 0) {
        return { verdict: 'contradicted', evidence: [said(last)], why: `It says there are no warnings, and the last ${what} in this turn printed ${last.warnings === 1 ? 'one' : last.warnings}: ${last.text}.` };
    }
    // Code changed after the last run: the run does not cover it (a CI read or a checksum is about something else).
    const lastCode = lastIndex(list, (i) => i.code && i.ok !== false);
    if (subject !== 'ci' && subject !== 'hash' && last.kind !== 'ci' && lastCode > list.lastIndexOf(last)) {
        return { verdict: 'unbacked', evidence: [said(last), said(list[lastCode])], why: `The last ${what} came before the last change (${list[lastCode].text}); nothing ran after it.` };
    }
    if (subject === 'hash') {
        const clash = hashClash(list);
        if (clash) return clash;
    }
    // "The integration suite is green" after a run of the doc tests only.
    const named = subject === 'tests' || subject === 'any' ? SUITES.filter((k) => k.said.test(claim.text ?? words)).map((k) => k.name) : [];
    if (named.length) {
        const runs = relevant.filter((i) => i.kind === 'test' || i.tests);
        const covers = (i) => { const ran = suitesRun(i.cmd); return ran.length === 0 || ran.some((k) => named.includes(k)); };
        if (runs.length && !runs.some(covers)) {
            return { verdict: 'unbacked', evidence: runs.slice(-2).map(said), why: `It names the ${listed(named)} tests, and the test run in this turn was limited to the ${listed(suitesRun(runs.at(-1).cmd))} tests: ${runs.at(-1).text}.` };
        }
    }
    // "The suite is fully green — all 42 tests pass": the count may sit in the sentence's other clause.
    const count = subject === 'tests' || subject === 'any' ? namedCount(words) ?? namedCount(claim.text ?? '') : undefined;
    const counted = relevant.filter((i) => i.tests);
    if (count && counted.length) {
        const sums = counted.reduce((a, i) => a + i.tests.passed, 0);
        const fitsCount = counted.some((i) => i.tests.passed === count.passed || i.tests.total === count.total || i.tests.passed === count.total) || sums === count.passed;
        if (!fitsCount) {
            const shown = counted.at(-1).tests;
            return { verdict: 'contradicted', evidence: counted.map(said), why: `It names ${count.passed} tests; the run in this turn shows ${shown.passed} passed${shown.failed ? `, ${shown.failed} failed` : ''}.` };
        }
    }
    return { verdict: 'backed', evidence: relevant.slice(-3).map(said), why: '' };
}

/** Rule for `passed`: each kind of run it names passed (a passing CI read covers them all when the sentence is about CI or a PR). */
function judgePassed(claim, list) {
    const subjects = claim.subjects ?? [claim.subject ?? 'any'];
    if (subjects.length > 1 && CI_WORDS.test(claim.text)) {
        const reads = list.filter((i) => i.kind === 'ci');
        if (reads.length) return passedFor('ci', claim, list);
    }
    let backed;
    for (const subject of subjects) {
        const result = passedFor(subject, claim, list);
        if (result.verdict !== 'backed') return result;
        backed = backed ?? result;
    }
    return backed;
}

/** A place a local run cannot speak for: a shared environment or a remote address. */
const REMOTE_PLACE = /\b(staging|production|prod|deployed|https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)\S+)/i;

/** Rule for `deployed`: something shipped to the place the claim names, and nothing after it says it is down. */
function judgeDeployed(claim, list) {
    const target = claim.target ?? 'any';
    const words = claim.part ?? claim.text;
    const order = (a, b) => list.indexOf(a) - list.indexOf(b);
    const probes = list.filter((i) => i.kind === 'probe' && !i.registry);
    if (target === 'health') {
        // The sentence names what the check is: "the api is healthy — GET /health returns 200".
        const sentence = claim.text ?? words;
        const checks = list.filter((i) => (i.kind === 'probe' && !i.registry) || i.health !== undefined || i.fetched);
        const code = /\b(?:returns?|returned|answers?|answered|responds?(?:\s+with)?|responded(?:\s+with)?|status(?:\s+code)?|http|code|gives|got|->|→)\s*:?\s*(?:an?\s+)?(?:http\s+)?([1-5]\d\d)\b|\b([1-5]\d\d)\s+(?:ok|created|accepted|no content)\b/i.exec(sentence);
        const status = code ? Number(code[1] ?? code[2]) : undefined;
        // A run in this turn saw the status it names ("Expected status 503, got 200"): what it answers is shown, though not where it runs.
        const seen = status !== undefined && !REMOTE_PLACE.test(sentence) ? list.filter((i) => (i.codes ?? []).includes(status)) : [];
        if (checks.length === 0) {
            if (seen.length) return { verdict: 'backed', evidence: seen.slice(-2).map(said), why: '' };
            return { verdict: 'unbacked', evidence: [], why: 'Nothing in this turn checked it: no request to it and no status read ran.' };
        }
        // "GET /health returns 200" needs a request that answered; "the pods are healthy" can rest on a status read.
        const needsRequest = status !== undefined || /(^|\s)\/[\w.-]+|\b(endpoint|url|https?:)/i.test(sentence);
        const requests = list.filter((i) => i.status !== undefined || i.health !== undefined || (i.fetched && status === undefined));
        if (needsRequest && requests.length === 0) {
            if (seen.length) return { verdict: 'backed', evidence: seen.slice(-2).map(said), why: '' };
            return { verdict: 'unbacked', evidence: checks.slice(-1).map(said), why: 'No request to it ran in this turn: nothing shows what it answers.' };
        }
        const last = needsRequest ? requests.at(-1) : checks.at(-1);
        // "The old pods are still serving": a status read with some well and some not shows the ones it names.
        if (last.mixed && /\b(still|old|previous|existing|remaining|other|rest)\b/i.test(sentence)) return { verdict: 'backed', evidence: [said(last)], why: '' };
        const ok = last.kind === 'probe' || last.fetched ? last.ok : last.health;
        if (ok === false || (status !== undefined && typeof last.status === 'number' && last.status !== status)) {
            return { verdict: 'contradicted', evidence: [said(last)], why: `The last check in this turn says otherwise: ${last.text}.` };
        }
        if (ok !== true) return { verdict: 'unbacked', evidence: [said(last)], why: `It is not clear what the last check in this turn returned: ${last.text}.` };
        return { verdict: 'backed', evidence: checks.slice(-3).map(said), why: '' };
    }
    const to = (i, t) => (i.targets ?? []).includes(t);
    const ships = (i) => i.kind === 'deploy' || to(i, 'repo') || to(i, 'registry') || to(i, 'env');
    // Local steps count when the claim is only about them: "tagged v1.2" with `git tag`, "merged into main" with `git merge`.
    const remote = /\b(push(ed)?|origin|remote|github|gitlab|upstream|deployed|released|published|shipped)\b/i.test(words);
    const local = (i) => !remote && ((to(i, 'tag') && /\btag/i.test(words)) || (to(i, 'merge') && /\bmerg/i.test(words)));
    const deploys = list.filter((i) => {
        if (target === 'repo') return (ships(i) && to(i, 'repo')) || local(i);
        if (target === 'registry') return (ships(i) && to(i, 'registry')) || (i.registry && i.ok === true);
        if (target === 'env') return (ships(i) && (to(i, 'env') || (i.targets ?? []).length === 0)) || i.deploys === true;
        return ships(i) || local(i) || i.deploys === true;
    }).sort(order);
    const tw = TARGET_WORDS[target] ?? TARGET_WORDS.any;
    if (deploys.length === 0) {
        // Nothing shipped in this turn, but a request shows where it runs: that says whether it is up.
        if (target === 'env' && probes.length) {
            const last = probes.at(-1);
            if (last.ok === false) return { verdict: 'contradicted', evidence: [said(last)], why: `A check in this turn says it is not up: ${last.text}.` };
            // "It is live on staging" is a state a request shows; "deployed 2.4.1" is an act, shown only by an answer that names the version.
            const acted = /\b(deployed|redeployed|released|shipped|rolled out|rolled back|promoted|published|pushed)\b/i.test(words);
            const version = /\bv?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\b/.exec(claim.text ?? words)?.[1];
            const shows = version !== undefined && probes.some((p) => (p.lines ?? []).some((l) => l.includes(version)));
            if (last.ok === true && (!acted || shows)) return { verdict: 'backed', evidence: probes.slice(-2).map(said), why: '' };
            if (last.ok === true) return { verdict: 'unbacked', evidence: probes.slice(-1).map(said), why: `A request answered, but nothing in this turn deployed it${version ? `, and the answer does not show ${version}` : ''}.` };
        }
        // "chalk is on 6.0.1": a version, which a run that printed the name next to it shows (`+ chalk 6.0.1`).
        const at = target !== 'env' ? /^(.*?)\b(?:is|are)\s+(?:now\s+)?(?:on|at)\s+v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)\b/i.exec(words) : undefined;
        if (at && !/\b(deployed|redeployed|released|shipped|rolled out|promoted|published|pushed)\b/i.test(words)) {
            const names = tokensOf(at[1]).filter((t) => !GENERIC.has(t) && !/^\d/.test(t));
            const shows = list.filter((i) => i.kind !== 'read' && i.ok !== false && (i.lines ?? []).some((l) => l.includes(at[2]) && names.some((n) => l.toLowerCase().includes(n))));
            if (names.length && shows.length) return { verdict: 'backed', evidence: shows.slice(-2).map(said), why: '' };
        }
        const pushes = target === 'env' ? list.filter((i) => to(i, 'repo')) : [];
        return { verdict: 'unbacked', evidence: pushes.slice(-1).map(said), why: pushes.length ? 'A push ran, but nothing in this turn deployed it or checked where it runs.' : tw.none };
    }
    const last = deploys.at(-1);
    const went = last.shipped ?? last.ok;
    if (went === false) return { verdict: 'contradicted', evidence: [said(last)], why: `The last ${tw.last} in this turn did not go through: ${last.text}.` };
    // "Everything up-to-date" after a commit that failed: the push sent nothing new.
    if (last.upToDate) {
        const commit = list.slice(0, list.indexOf(last)).filter((i) => /\bgit\s+commit\b/i.test(i.cmd ?? '')).at(-1);
        if (commit && commit.ok === false) return { verdict: 'contradicted', evidence: [said(commit), said(last)], why: `The commit in this turn did not go through (${commit.text}), so the push sent nothing new.` };
    }
    if (target === 'env' || target === 'any') {
        // What ran after the deploy and says it is not well (pods crashing, a failed health check).
        const after = list.slice(list.indexOf(last) + 1).filter((i) => (i.kind === 'probe' && !i.registry && i.ok === false) || i.health === false);
        if (after.length) return { verdict: 'contradicted', evidence: [said(last), said(after.at(-1))], why: `After the ${tw.last}, a check in this turn says it is not up: ${after.at(-1).text}.` };
        if (last.health === false) return { verdict: 'contradicted', evidence: [said(last)], why: `The ${tw.last} in this turn reports a failing health check: ${last.text}.` };
    }
    if (went !== true) return { verdict: 'unbacked', evidence: [said(last)], why: `It is not clear the last ${tw.last} went through: ${last.text}.` };
    return { verdict: 'backed', evidence: deploys.slice(-3).map(said), why: '' };
}

/** The bar a comparison is against, from a sentence: "the current model's 0.88 val accuracy", "an F1 of 0.9". */
function barIn(text) {
    const t = String(text ?? '');
    const metric = String.raw`(acc(?:uracy)?|f1|auc|precision|recall|bleu|rouge|map|ndcg|mrr|loss|perplexity|wer|cer|mae|rmse|score)`;
    const split = String.raw`(?:(val(?:idation)?|test|dev|eval)[\s_-]+)?`;
    const m = new RegExp(String.raw`(?<![\w.])(\d*\.\d+|\d+)\s*(%)?\s+${split}${metric}\b`, 'i').exec(t)
        ?? new RegExp(String.raw`\b${split}${metric}\s*(?:of|at|=|:|is|was)?\s*(\d*\.\d+|\d+)(%)?`, 'i').exec(t);
    if (!m) return undefined;
    const first = /^[\d.]/.test(m[0]);
    const value = Number(first ? m[1] : m[3]);
    const pct = first ? m[2] : m[4];
    const words = first ? [m[3], m[4]] : [m[1], m[2]];
    const s = /^(val|dev)/i.test(words[0] ?? '') ? 'val' : /^(test|eval)/i.test(words[0] ?? '') ? 'test' : '';
    const name = words[1].toLowerCase().replace(/^accuracy$/, 'acc');
    return { v: pct || value > 1 ? value / 100 : value, m: name, s, text: m[0].trim() };
}

/** Rule for `fixed`: a change, then a run of the right kind that passed. */
function judgeFixed(claim, list, prompt = '') {
    // "It beats the current model's 0.88": the best reading this turn printed for that measure, against the bar.
    if (claim.beats) {
        const bar = barIn(claim.text) ?? barIn(prompt);
        const scale = (v) => (bar && !LOWER_QUALITY.test(bar.m) && v > 1 ? v / 100 : v);
        const seen = bar ? list.flatMap((i) => (i.readings ?? []).filter((r) => r.m === bar.m && r.s !== 'train' && (!bar.s || !r.s || r.s === bar.s)).map((r) => ({ r, i, v: scale(r.v) }))) : [];
        if (seen.length) {
            const lower = LOWER_QUALITY.test(bar.m);
            const best = seen.reduce((a, b) => ((lower ? b.v < a.v : b.v > a.v) ? b : a));
            if (lower ? best.v >= bar.v : best.v <= bar.v) {
                return { verdict: 'contradicted', evidence: [said(best.i)], why: `It says it beats ${bar.text}; the best ${best.r.l} this turn printed is ${best.r.v}.` };
            }
            return { verdict: 'backed', evidence: [said(best.i)], why: '' };
        }
    }
    if (claim.improved) {
        // The figures it quotes printed (checked before this); else a run that measured something.
        const quoted = list.filter((i) => (claim.metrics ?? []).some((m) => printed([i], m)));
        const measured = list.filter((i) => (i.series ?? []).length || i.metric || (i.readings ?? []).length);
        const shown = quoted.length ? quoted : measured;
        if (shown.length) return { verdict: 'backed', evidence: shown.slice(-3).map(said), why: '' };
        return { verdict: 'unbacked', evidence: [], why: 'Nothing in this turn measured it: no benchmark or timing ran.' };
    }
    const lastChange = lastIndex(list, (i) => i.change || i.kind === 'change');
    const after = list.slice(lastChange + 1).filter((i) => RUNS.has(i.kind));
    // A command that changed files and ran something in one go counts as a run after the change.
    const same = lastChange >= 0 && RUNS.has(list[lastChange].kind) ? [list[lastChange]] : [];
    const checks = [...same, ...after];
    if (checks.length === 0) {
        const other = list.filter((i) => i.kind === 'other' && i.ok === true);
        if (other.length) return { verdict: 'backed', evidence: other.slice(-2).map(said), why: '' };
        return lastChange >= 0
            ? { verdict: 'unbacked', evidence: [said(list[lastChange])], why: 'Files changed in this turn, and nothing ran after the last change to show it works.' }
            : { verdict: 'unbacked', evidence: [], why: 'Nothing in this turn ran the code or a check.' };
    }
    const kinds = FIX_CHECKS[claim.subject ?? 'any'] ?? FIX_CHECKS.any;
    const fitting = checks.filter((i) => kinds.includes(i.kind));
    const last = (fitting.length ? fitting : checks).at(-1);
    if (last.ok === false) return { verdict: 'contradicted', evidence: [said(last)], why: `The last run after the change did not pass: ${last.text}.` };
    return { verdict: 'backed', evidence: checks.slice(-3).map(said), why: '' };
}

/** Verbs of a done claim whose output is a build or a generated file, not an edit. */
const BUILT = /\b(built|rebuilt|generated|regenerated|compiled|bundled|packaged)\b/i;
/** A done claim in the first person or led by its verb ("I added", "Added the flag"), as against a description ("X is wired to Y"). */
const ACTIVE = new RegExp(String.raw`^(i|we)\b|\b(i'?ve|i have|we'?ve|we have|i|we)\s+(now\s+|also\s+|just\s+|then\s+)?\w+ed\b|^(?:${CHANGE_CLAIM.source.replace(/^\\b\(/, '(').replace(/\)\\b$/, ')')})`, 'i');

/** Runs that ended: "lint and unit-tests finished", "the nightly jobs completed". */
const RUN_DONE = /\b(lint|[\w-]*tests?|specs?|builds?|checks?|ci|jobs?|pipelines?|workflows?|e2e|suites?|runs?|benchmarks?)\s+(?:(?:have|has|all|both|also|now|just)\s+)*(finished|completed|ended)\b/i;
/** Work that is a run, said to have finished: "Backfill complete", "Training finished for v7". */
const RAN_DONE = /\b(training|backfill|import|export|sync|ingest(?:ion)?|crawl|scrape|reindex(?:ing)?|indexing|seed(?:ing)?|etl|batch|script|load test|dry run|replay|transcode|render(?:ing)?|conversion|dump|restore|backup|upload|download|eval(?:uation)?|fine-?tun(?:e|ing)|simulation|sweep)\s+(?:[\w.-]+\s+){0,2}?(?:is\s+|has\s+|have\s+|was\s+)?(?:now\s+|all\s+)?(finished|completed|complete|done|succeeded|ran to completion)\b/i;
/** "Applied it to dev.db", "the playbook is applied to both hosts": an apply to infrastructure or a database, not a patch or a suggestion. */
const APPLIED = /\bapplied\b(?!\s+(?:the\s+|your\s+|its\s+|their\s+|all\s+|both\s+|my\s+|these\s+|those\s+)?(?:patch(?:es)?|diffs?|suggestions?|fix(?:es)?|edits?|review|feedback|formatting|format|rename|codemod|lint|autofix(?:es)?|stash|style|changes? to (?:the\s+)?(?:file|code)))/i;
const APPLY_PLACE = /\b(terraform|tofu|pulumi|vpc|subnets?|buckets?|clusters?|staging|production|prod|manifests?|helm|charts?|playbooks?|hosts|servers?|migrations?|schema|databases?|db|k8s|kubernetes|infra(?:structure)?|stacks?|namespaces?|ingress|security groups?|iam|dns)\b|[\w-]+\.(tf|tfvars|hcl|sql|db|sqlite3?)\b/i;
/** Files whose change counts once it is applied. */
const INFRA_FILE = /\.(tf|tfvars|hcl|sql)\b|\b(playbooks?|manifests?|k8s|charts?|helm|migrations?)\//i;

/** A job said to have finished: "it has since finished", "the run completed successfully". */
const FINISHED = /\b(?:has|have|had)\s+(?:since\s+|now\s+|already\s+|just\s+)?(?:finished|completed|succeeded|ended)\b|\b(?:finished|completed|succeeded)\s+(?:successfully|ok|fine|cleanly|without errors)\b|\b(?:it|the (?:job|run|workflow|pipeline|dag|batch|backfill|task))\s+(?:finished|completed|succeeded|ended)\b/i;
/** "Ran it on staging", "ran the migration against prod": a run the claim names. */
const RAN_ON = /\b(?:ran|re-?ran|executed)\s+(?:it|them|this|that|the\s+[\w-]+(?:\s+[\w-]+)?)\s+(?:on|against|in|into)\s+/i;
/** An endpoint by its method and path: "GET /api/reports/summary". */
const ROUTE_NAMED = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w\/{}:.*-]*/;
/** Counts of what a run handled: "1,384,002 rows", "5000 users". */
const COUNT = /(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)\s+(rows|records|documents|docs|events|messages|items|entries|objects|users|orders|files|keys|vectors|embeddings|samples|examples|pages|chunks|tickets|accounts|customers|products|images|videos|emails)\b/gi;
/** The counts a sentence quotes, as figures to find in the turn's output. */
function countsIn(text) {
    const out = [];
    for (const m of String(text).matchAll(COUNT)) {
        const value = num(m[1]);
        if (value >= 2) out.push({ value, unit: '', raw: m[1], text: `${m[1]} ${m[2]}` });
        if (out.length >= 4) break;
    }
    return out;
}

/** Rule for `done`: a change for a claim that says it changed something (or a bare "Done" after a request for one); else any tool that worked. */
function judgeDone(claim, list, prompt) {
    const words = (claim.part ?? claim.text).trim();
    const bare = /^(all\s+)?(done|complete|completed|finished|sorted|all set|all wrapped up|wrapped up)\W*$/i.test(words);
    // "Cut the release APK" asks for a build: the claim that it is built is then this turn's work, not a description.
    const asked = CHANGE_ASK.test(prompt) || (BUILT.test(words) && BUILD_ASK.test(prompt));
    const changeClaim = CHANGE_CLAIM.test(words) || (bare && asked);
    // "Submitted the backfill; it has since finished": a job that runs elsewhere, shown finished by a status read after it started.
    const started = lastIndex(list, (i) => i.job && i.ok !== false);
    if (started >= 0 && !bare && (FINISHED.test(words) || RAN_DONE.test(words))) {
        const read = list.slice(started).filter((i) => i.ended !== undefined).at(-1);
        if (read?.ended === true) return { verdict: 'backed', evidence: [said(list[started]), said(read)], why: '' };
        if (read?.ended === false) return { verdict: 'contradicted', evidence: [said(read)], why: `The last status read in this turn says it did not finish well: ${read.text}.` };
        return { verdict: 'unbacked', evidence: read ? [said(read)] : [said(list[started])], why: read ? `It was started in this turn, and the last status read says it is still going: ${read.text}.` : 'It was started in this turn, and nothing after that shows it finished.' };
    }
    // "Added the migration and ran it on staging": when the turn applied something, the run it names is that apply.
    const applies = list.filter((i) => i.apply);
    // "Applied the change" to infrastructure or a database: an apply that ran and went through, not only an edit of its files.
    if ((APPLIED.test(words) && (APPLY_PLACE.test(claim.text ?? words) || list.some((i) => i.kind === 'change' && INFRA_FILE.test(i.text)))) || (RAN_ON.test(words) && applies.length)) {
        if (applies.length === 0) return { verdict: 'unbacked', evidence: [], why: 'Nothing in this turn applied it: no terraform or kubectl apply, playbook, helm upgrade or migration ran.' };
        const last = applies.at(-1);
        if (last.ok === false) return { verdict: 'contradicted', evidence: [said(last)], why: `The last apply in this turn did not go through: ${last.text}.` };
        if (last.ok !== true) return { verdict: 'unbacked', evidence: [said(last)], why: `It is not clear the last apply went through: ${last.text}.` };
        return { verdict: 'backed', evidence: applies.slice(-2).map(said), why: '' };
    }
    // "Backfill complete", "Training finished": the run itself, which must have ended well.
    if (RAN_DONE.test(words) && !RUN_DONE.test(words)) {
        const runs = list.filter((i) => RUNS.has(i.kind) && i.kind !== 'probe' && i.kind !== 'hash');
        if (runs.length === 0) return { verdict: 'unbacked', evidence: [], why: 'Nothing in this turn ran it, so nothing shows it finished.' };
        const last = runs.at(-1);
        if (last.ok === false) return { verdict: 'contradicted', evidence: [said(last)], why: `The last run in this turn did not finish well: ${last.text}.` };
        // "October backfill complete: 1,384,002 rows": counts of what it handled, which a run must have printed.
        const unshown = countsIn(claim.text ?? words).filter((c) => !printed(list, c) && !String(prompt).includes(c.raw));
        if (unshown.length) return { verdict: 'unbacked', evidence: runs.slice(-1).map(said), why: `It quotes ${listed(unshown.slice(0, 2).map((c) => c.text))}, which no output in this turn shows.` };
        return { verdict: 'backed', evidence: runs.slice(-2).map(said), why: '' };
    }
    // "The IE11 path is wired through legacyPlugin" after a question describes the code; after "wire it" it claims the work.
    if (changeClaim && !bare && prompt !== '' && !asked && !ACTIVE.test(words)) {
        return { verdict: 'backed', evidence: list.filter((i) => i.kind === 'read' || i.ok === true).slice(-2).map(said), why: '' };
    }
    // "lint and unit-tests finished": runs that ended, which a run or a CI read in this turn shows.
    if (RUN_DONE.test(words)) {
        const runs = list.filter((i) => i.kind === 'ci' || i.kind === 'test' || i.kind === 'lint' || i.kind === 'build');
        if (runs.length) return { verdict: 'backed', evidence: runs.slice(-2).map(said), why: '' };
    }
    // "Committed the fix" after a `git commit` that failed.
    const commit = /\bcommitted\b/i.test(words) ? list.filter((i) => /\bgit\s+commit\b/i.test(i.cmd ?? '')).at(-1) : undefined;
    if (commit && commit.ok === false) return { verdict: 'contradicted', evidence: [said(commit)], why: `The commit in this turn did not go through: ${commit.text}.` };
    if (changeClaim) {
        // An apply or a deploy to an environment changes things too ("created the bucket" with `terraform apply`).
        const acts = (i) => i.change || i.kind === 'change' || i.apply || (i.kind === 'deploy' && (i.targets ?? []).includes('env'));
        const builds = (i) => BUILT.test(words) && (i.kind === 'build' || i.kind === 'run');
        const made = (i) => (acts(i) || i.kind === 'other' || builds(i)) && i.ok !== false;
        const changes = list.filter(made);
        // "Added `GET /api/reports/summary`": an endpoint needs a change to a route or a handler, not only to its types.
        const route = asked || ACTIVE.test(words) ? ROUTE_NAMED.exec(`${claim.text ?? words} ${claim.next ?? ''}`) : null;
        const edits = changes.filter((i) => i.change || i.kind === 'change');
        if (route && edits.length && !edits.some((i) => i.route)) {
            return { verdict: 'unbacked', evidence: edits.slice(-2).map(said), why: `It names the endpoint ${route[0]}, and no change in this turn touched a route or a handler: ${listed(edits.slice(-2).map(said))}.` };
        }
        if (changes.length) return { verdict: 'backed', evidence: changes.slice(-3).map(said), why: '' };
        const failed = list.filter((i) => (acts(i) || builds(i)) && i.ok === false);
        const what = failed.length && !acts(failed.at(-1)) ? (failed.at(-1).kind === 'build' ? 'build' : 'run') : 'change';
        if (failed.length) return { verdict: 'contradicted', evidence: failed.slice(-2).map(said), why: `The ${what} in this turn did not go through: ${failed.at(-1).text}.` };
        return { verdict: 'unbacked', evidence: [], why: bare ? 'You asked for a change, and nothing in this turn changed a file.' : 'Nothing in this turn changed a file or ran a change.' };
    }
    const worked = list.filter((i) => i.ok !== false);
    if (worked.length) return { verdict: 'backed', evidence: worked.slice(-3).map(said), why: '' };
    return { verdict: 'unbacked', evidence: list.slice(-2).map(said), why: 'Every tool in this turn failed.' };
}

// ── A claim that quotes the output ─────────────────────────────────

const STOP = new Set('a an and or of to in on at for with is are was were be been being it its this that these those now all both each every from by as so then than our your my we i you they has have had do does did also just still only here there which who what into onto via per out up over after before since when while new same one'.split(' '));
/** Words every success claim uses: they do not tie a claim to one output. */
const GENERIC = new Set('pass passed passes passing test tests testing build builds built ok okay green clean cleanly success successful successfully fine works working work worked done complete completed finished fixed deployed deploy pushed push released release shipped merged live healthy ready check checks checked run ran runs error errors fail failed failure failures true false yes no none zero everything returns returned return status code verified verify 0'.split(' '));
const HEX = /^(?=[0-9a-f]*\d)[0-9a-f]{7,}$/;
const tokensOf = (text) => (String(text).toLowerCase().replace(/[⟨⟩`*_"“”'’]/g, ' ').match(/[a-z0-9]+(?:\.[a-z0-9]+)*/g) ?? [])
    .map((t) => t.replace(/^v(?=\d)/, ''))
    .filter((t) => !STOP.has(t) && (t.length > 1 || /\d/.test(t)));
const stem = (t) => (t.length > 4 ? t.replace(/(ing|ed|es|s)$/, '') : t);
const holds = (set, word) => set.has(word) || set.has(stem(word)) || (HEX.test(word) && [...set].some((t) => t.startsWith(word)));

/**
 * Whether a claim only restates what the turn's runs printed ("e2e / smoke
 * — successful in 3m10s" under `gh pr checks`): every word of it is in a
 * run's command or output, and one line holds two of its words that are not
 * stock success words. A backed result, or undefined. Reads do not count: a
 * file that says "all tests pass" shows nothing ran.
 */
export function quotedBy(claim, items) {
    const words = [...new Set(tokensOf(claim.text ?? claim.part ?? ''))];
    const special = words.filter((w) => !GENERIC.has(w) && !GENERIC.has(stem(w)));
    if (special.length < 2) return undefined;
    const sources = (Array.isArray(items) ? items : []).filter((i) => i && i.kind !== 'read' && i.kind !== 'change' && i.ok !== false);
    const sets = [];
    for (const i of sources) {
        for (const line of [i.cmd ?? '', ...(i.lines ?? [])]) {
            if (!line) continue;
            const set = new Set();
            for (const t of tokensOf(line)) { set.add(t); set.add(stem(t)); }
            sets.push({ set, item: i });
        }
    }
    if (!words.every((w) => sets.some(({ set }) => holds(set, w)))) return undefined;
    if (!sets.some(({ set }) => special.filter((w) => holds(set, w)).length >= 2)) return undefined;
    const from = [...new Set(sets.filter(({ set }) => special.some((w) => holds(set, w))).map(({ item }) => item))];
    return { verdict: 'backed', evidence: from.slice(-3).map(said), why: '' };
}

/**
 * Whether `items` (this turn's evidence, in order) back `claim`:
 * `{ verdict: 'backed'|'unbacked'|'contradicted', evidence: string[], why }`.
 * `why` is one plain sentence a person reads under the claim. `prompt` is
 * the person's message that started the turn: a bare "Done" after "add X"
 * needs a change.
 */
export function judge(claim, items, { prompt = '' } = {}) {
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (list.length === 0) return { verdict: 'unbacked', evidence: [], why: 'No tool ran in this turn.' };
    const result = namedChecks(claim, list)
        ?? (claim.kind === 'passed' ? judgePassed(claim, list)
            : claim.kind === 'deployed' ? judgeDeployed(claim, list)
                : claim.kind === 'fixed' ? judgeFixed(claim, list, typeof prompt === 'string' ? prompt : '')
                    : judgeDone(claim, list, typeof prompt === 'string' ? prompt : ''));
    // Nothing of the right kind ran, but the claim restates a run's own output word for word.
    if (result.verdict === 'unbacked' && result.evidence.length === 0) return quotedBy(claim, list) ?? result;
    return result;
}

/** Whether a person's message asks for new work (then an earlier turn's evidence does not back this turn's claims). */
export function asksForWork(text) {
    if (typeof text !== 'string' || text.trim() === '') return false;
    const t = text.trim();
    if (/^(thanks|thank you|thx|great|nice|cool|ok|okay|perfect|awesome|got it|sounds good)\b[^a-z]*$/i.test(t)) return false;
    const VERB = '(add|fix|make|change|update|create|write|rename|remove|delete|move|refactor|implement|build|deploy|ship|release|publish|push|run|test|install|set up|configure|migrate|convert|rewrite|try|redo|revert|merge|bump|clean|split|extract|replace|finish|do|continue|carry on|go ahead|proceed|start|consolidate|dedupe|deduplicate|tidy|upgrade|downgrade|pin|enable|disable|wire|hook up|port|document|optimi[sz]e|speed up|improve|reduce|harden|patch|tweak|adjust|tune|simplify|restructure|reorgani[sz]e|rework|polish|format|resolve|handle|support|integrate|scaffold|generate|regenerate|backfill|seed|rotate|roll back|rollback|commit|tag|apply|rebase|squash|sync|vendor|stub|mock|train|retrain|provision|spin up|kick off|execute|import|export|reindex|restore|load)';
    return new RegExp(`(^|[.!\\n]\\s*)(please\\s+|now\\s+|then\\s+|also\\s+|and\\s+)?${VERB}\\b`, 'i').test(t)
        || new RegExp(`\\b(can|could|would|will) you\\s+(please\\s+)?${VERB}\\b`, 'i').test(t)
        || new RegExp(`\\b(i want|i'd like|i need|we need|let's)\\b[^.?!]{0,40}\\b${VERB}\\b`, 'i').test(t);
}
