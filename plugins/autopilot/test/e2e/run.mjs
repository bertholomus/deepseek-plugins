#!/usr/bin/env node
/**
 * Autopilot in a real DSH: its host half over the real session watcher, its
 * page in a real window, and DSH quit and crashed under running turns.
 *
 * DSH runs from a throwaway DSH_HOME (test/e2e/harness.mjs) with the
 * session bridge, Session Watch and Autopilot, and a scripted model
 * (test/e2e/fake-model.mjs) that plays the agent. Autopilot's waits are
 * short here (idleSeconds 5, startDelaySeconds 1, errorRetrySeconds 2).
 *
 * - The browser half is served and parses; the endpoints answer, and refuse
 *   bad input in words.
 * - A session that stops with open todos gets a note, read into a turn (the
 *   session's own log shows the note and the turn it started); two notes
 *   that bring no progress and Autopilot backs off; notes that bring
 *   progress go on until the todos are done, with no back-off.
 * - Ask first raises a question instead; Off leaves the session alone; a
 *   last reply that asks the person something is left alone.
 * - A goal stopped by a failed turn is started again, and its next round
 *   runs (the goal completes).
 * - The switch: off, a session with open work gets nothing; on again, it
 *   gets its note.
 * - The page, from DSH's sidebar: the question with its answer buttons, the
 *   backed-off session with Try again, the sessions with their rules, the
 *   log with a Why line for every action; light and dark pictures. Its
 *   buttons work: the answer sends the note, Try again nudges again, a rule
 *   changed to Auto acts, the switch goes off and on.
 * - DSH quit under two running turns (one a goal round): after the start,
 *   each gets a carry-on note, read into a turn, and the goal's next round
 *   runs after it; nothing handled before the quit is done again.
 * - DSH crashed (SIGKILL to its process group) under a running turn: the
 *   watcher's record of running turns names it, and after the start it gets
 *   its note.
 * - Autopilot's and the watcher's folders are 700 and their files 600.
 * - A quiet session that Autopilot leaves to the person says why on its row.
 * - A wrong setting in the profile: Autopilot starts but does no work, and
 *   its page says which setting, what it must be and where to change it;
 *   its button opens Autopilot's settings in Plugins (DSH's own form),
 *   which refuses a value out of range; saving a good one fixes it, the log
 *   says who did, and the waiting session gets its note.
 * - Session Watch's own setting in Plugins.
 * - Session Watch off: Autopilot's page says it needs Session Watch, with a
 *   button that opens it in Plugins.
 * - `enabled: false`: the page says Autopilot watches nothing, and how to
 *   change it.
 *
 *   DSH_BIN=/path/to/@deepseek-ai/dsh/lib/bin.js node plugins/autopilot/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs the newest DSH under .e2e/; `node scripts/e2e.mjs
 * autopilot` runs it on each of those and on the installed app's own DSH
 * (under the app's binary as Node). SHOTS=<folder> keeps
 * the window's pictures there (default .e2e/shots/autopilot/<version>);
 * KEEP=1 keeps the throwaway DSH_HOME. Without Playwright the run fails,
 * unless NO_WINDOW=1 says to run without the window checks (the summary
 * then says they were skipped).
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Script } from 'node:vm';
import { DshRun, checks, dshBin, findPlaywright, modeOf, openWindow, pluginsDir, repoRoot, setDark, shot, sleep, waitFor } from '../../../../test/e2e/harness.mjs';
import { startFakeModel } from '../../../../test/e2e/fake-model.mjs';

const bin = dshBin();
if (!bin) {
    console.log('skipped: no DSH to run (set DSH_BIN, or install one under .e2e/dsh-<version>)');
    process.exit(0);
}
const version = process.env.DSH_LABEL || (/dsh-([^/]+)\/node_modules/.exec(bin)?.[1] ?? basename(dirname(dirname(bin))));
const shots = process.env.SHOTS || join(repoRoot, '.e2e', 'shots', 'autopilot', version);
console.log(`# DSH ${version}: ${bin}`);
console.log(`# pictures: ${shots}`);

const IDLE = 5;
const tally = checks();
const { check, step } = tally;
const model = await startFakeModel();
/** The profile's rows for the two plugins, with the e2e's short waits; `off` lists rows switched off in the profile. */
const rowsWith = ({ off = [], idle = IDLE, enabled = true } = {}) => `- id: autopilot
${off.includes('autopilot') ? '  disabled: true\n' : ''}  config:
${enabled ? '' : '    enabled: false\n'}    idleSeconds: ${idle}
    startDelaySeconds: 1
    errorRetrySeconds: [2, 2]
    maxNotesPerHour: 80
- id: session-watch
${off.includes('session-watch') ? '  disabled: true\n' : ''}  config:
    deliveryTimeoutSeconds: 60
`;
const run = new DshRun({
    label: 'autopilot',
    bin,
    plugins: {
        'dsh-plugin-session-bridge': join(pluginsDir, 'session-bridge'),
        'dsh-plugin-session-watch': join(pluginsDir, 'session-watch'),
        'dsh-plugin-autopilot': join(pluginsDir, 'autopilot'),
    },
    rows: rowsWith(),
});
/** Start DSH again with other rows (the plugin settings a person would have in the profile). */
async function restartWith(rows, what) {
    await run.stop();
    run.rows = rows;
    run.writeProfile(model.port);
    await run.boot(what);
}

const api = async (method, args = {}) => run.api(`dsh-plugin-autopilot/${method}`, args);
const state = async () => {
    const r = await api('state');
    if (!r.ok) throw new Error(`state: ${JSON.stringify(r.error)}`);
    return r.value;
};
/** Autopilot's log entries for one session, oldest first. */
const entriesOf = async (sessionId, kind) => (await state()).log.filter((e) => e.sessionId === sessionId && (!kind || e.kind === kind)).reverse();
const count = async (sessionId, kind, wanted = undefined) => (await entriesOf(sessionId, kind)).filter((e) => !wanted || e.state === wanted).length;
/** Wait for the n-th entry of `kind` for a session to reach `wanted`; that entry. */
const entryReaches = (sessionId, kind, wanted, n = 1, timeout = 60000) => waitFor(async () => {
    const found = (await entriesOf(sessionId, kind)).filter((e) => e.state === wanted);
    return found.length >= n ? found[n - 1] : null;
}, `${kind} ${wanted} #${n} for ${sessionId}`, timeout, 300);

const todos = (...items) => JSON.stringify(items.map(([content, status]) => ({ content, status })));
const idleSession = async (sessionId) => waitFor(async () => {
    const s = await run.session(sessionId);
    return s.status !== 'running' && s.turns.started > 0 && s.turns.started === s.turns.ended ? s : null;
}, `${sessionId} to finish its turn`, 30000);

/** Whether the session's log shows `text` as a message in it, with a turn started after it (DSH read it in). */
async function readIntoTurn(sessionId, text) {
    const events = await run.events(sessionId);
    const at = events.findIndex((e) => e.type === 'user/message' && typeof e.text === 'string' && e.text.startsWith(text));
    if (at < 0) return false;
    const turnBefore = events.slice(0, at).findLast((e) => e.type === 'turn/start');
    const endBefore = events.slice(0, at).findLast((e) => e.type === 'turn/end');
    // Read into a turn: the message sits inside a turn (after its turn/start, with no turn/end between).
    return Boolean(turnBefore) && (!endBefore || endBefore.seq < turnBefore.seq);
}

let window;
let pw;
const ids = {};
try {
    run.writeProfile(model.port);
    await run.boot('first start');
    await waitFor(async () => (await api('state')).ok, 'Autopilot\'s endpoints', 30000);

    // ── The browser half and the endpoints ─────────────────────────────
    await step('DSH serves Autopilot\'s browser half and it parses', async () => {
        const client = await run.clientOf('dsh-plugin-autopilot');
        let parses = false;
        try {
            new Script(client.text);
            parses = true;
        } catch {}
        check('DSH serves Autopilot\'s browser half and it parses', client.status === 200 && parses && client.text.includes('dsh-plugin-autopilot'), `${client.url ?? 'not in the boot graph'}: ${client.status}`);
    });
    await step('the endpoints answer, and refuse bad input in words', async () => {
        const s = await state();
        check('the state endpoint answers: on, Auto by default, the e2e settings', s.enabled === true && s.paused === false && s.defaultRule === 'auto' && s.settings.idleSeconds === IDLE, JSON.stringify({ enabled: s.enabled, paused: s.paused, rule: s.defaultRule, settings: s.settings }));
        const noSession = await api('setRule', { sessionId: '', rule: 'auto' });
        const badRule = await api('setRule', { sessionId: 'session-x', rule: 'sometimes' });
        const badSwitch = await api('setPaused', { paused: 'yes' });
        const badAnswer = await api('answer', { id: 'autopilot:nothing', answer: 'go' });
        check('bad input is refused with a message a person can act on',
            noSession.ok === false && /Name the session/.test(noSession.error?.message)
            && badRule.ok === false && /Auto, Ask first or Off/.test(badRule.error?.message)
            && badSwitch.ok === false && /switch Autopilot off/.test(badSwitch.error?.message)
            && badAnswer.ok === false && typeof badAnswer.error?.message === 'string' && badAnswer.error.message.length > 0,
        JSON.stringify([noSession.error, badRule.error, badSwitch.error, badAnswer.error]));
        const badge = await api('badge');
        check('the sidebar badge endpoint answers', badge.ok && badge.value.asks === 0 && badge.value.paused === false, JSON.stringify(badge));
    });

    // ── Sessions that stop with work open ──────────────────────────────
    ids.report = await run.newSession(`E2E:todos ${todos(['Write the report', 'in_progress'], ['Check the numbers', 'pending'])}`, 'Quarterly report');
    ids.progress = await run.newSession(`E2E:todos ${todos(['Draft the outline', 'in_progress'], ['Write section one', 'pending'], ['Write section two', 'pending'])}\n#note=progress`, 'Release notes');
    ids.ask = await run.newSession(`E2E:todos ${todos(['Rename the config keys', 'in_progress'])}\n#note=progress`, 'Config cleanup');
    ids.off = await run.newSession(`E2E:todos ${todos(['Update the changelog', 'in_progress'])}\n#note=progress`, 'Changelog');
    ids.question = await run.newSession(`E2E:todos ${todos(['Deploy the fix', 'pending'])}\n#final=ask`, 'Deploy question');
    ids.fix = await run.newSession('E2E:goal Fix the failing build [r1=fail]', 'Build fix');
    await api('setRule', { sessionId: ids.ask, rule: 'ask' });
    await api('setRule', { sessionId: ids.off, rule: 'off' });

    await step('a session that stops with open todos gets a note, read into a turn', async () => {
        const first = await entryReaches(ids.report, 'nudge', 'delivered', 1, 40000);
        check('a session that stops with open todos gets a note, delivered (proven by a turn reading it)', first.state === 'delivered' && typeof first.turn === 'number', JSON.stringify(first));
        check('the note names the open work, and is signed', /^\[Autopilot\] You stopped with 2 open todos \(next: “Write the report”\)/.test(first.note ?? ''), first.note);
        check('its Why line says what Autopilot saw', /idle for 5 seconds after turn 1 with 2 open todos, and its last reply asked you nothing/.test(first.why ?? ''), first.why);
        check('the session\'s own log shows the note read into a turn', await readIntoTurn(ids.report, '[Autopilot] You stopped with 2 open todos'));
    });
    await step('two notes with no progress, and Autopilot backs off', async () => {
        await entryReaches(ids.report, 'nudge', 'delivered', 2, 40000);
        const off = await entryReaches(ids.report, 'backoff', 'backed off', 1, 40000);
        check('two notes that bring no progress, and Autopilot backs off, saying why', /2 notes in a row brought no progress/.test(off.why ?? ''), off.why);
        await sleep((IDLE * 2 + 2) * 1000);
        check('after backing off it sends no more notes', (await count(ids.report, 'nudge')) === 2, `${await count(ids.report, 'nudge')} notes`);
        const row = (await state()).sessions.find((s) => s.sessionId === ids.report);
        check('the page lists it as backed off', Boolean(row?.backedOff), JSON.stringify(row));
    });
    await step('notes that bring progress go on until the work is done, without backing off', async () => {
        await waitFor(async () => (await run.session(ids.progress)).status !== 'running' && (await count(ids.progress, 'nudge', 'delivered')) >= 3, 'three notes for the session that makes progress', 60000, 500);
        await sleep((IDLE + 3) * 1000);
        const notes = await count(ids.progress, 'nudge');
        const backoffs = await count(ids.progress, 'backoff');
        const row = (await state()).sessions.find((s) => s.sessionId === ids.progress);
        check('a todo done after each note: three notes, no back-off, and nothing open at the end', notes === 3 && backoffs === 0 && !row?.work, JSON.stringify({ notes, backoffs, work: row?.work }));
    });
    await step('Ask first asks; Off and a question to the person are left alone', async () => {
        const asked = await entryReaches(ids.ask, 'ask', 'asked you', 1, 40000);
        const s = await state();
        const ask = s.asks.find((a) => a.sessionId === ids.ask);
        check('under Ask first, Autopilot asks instead of acting, with its recommendation', Boolean(ask) && /Config cleanup/.test(ask.question) && typeof ask.recommendation === 'string' && (await count(ids.ask, 'nudge')) === 0,
            JSON.stringify({ asked, ask }));
        const badge = await api('badge');
        check('the sidebar badge counts the question', badge.ok && badge.value.asks === 1, JSON.stringify(badge));
        await idleSession(ids.off);
        await idleSession(ids.question);
        check('Off: no note, no question', (await entriesOf(ids.off)).filter((e) => e.kind !== 'rule').length === 0, JSON.stringify(await entriesOf(ids.off)));
        check('a last reply that asks the person something is left alone', (await entriesOf(ids.question)).length === 0, JSON.stringify(await entriesOf(ids.question)));
        const held = (await state()).sessions.find((x) => x.sessionId === ids.question);
        check('its row says why Autopilot leaves it to the person', held?.hold === 'waits for you: its last reply asks you something', JSON.stringify(held));
    });
    await step('a goal stopped by a failed turn is started again, and its next round runs', async () => {
        const rearm = await entryReaches(ids.fix, 'rearm', 'started', 1, 40000);
        check('a goal stopped by a failed turn is started again, proven by its next round', rearm.reason === 'round 2 began', JSON.stringify(rearm));
        check('its Why line names the error in plain words, not the provider\'s JSON', /^Turn 2 failed \(400: E2E: the scripted model refused this request\.\), which stops a goal; the goal “Fix the failing build \[r1=fail\]” was still active\.$/.test(rearm.why ?? ''), rearm.why);
        const ends = await waitFor(async () => {
            const events = await run.events(ids.fix, 'goal/change');
            return events.length >= 3 ? events : null;
        }, 'the goal to complete', 30000);
        const complete = (await run.savedEvents(ids.fix)).some((e) => e.type === 'goal/change' && e.data?.goal?.phase === 'complete');
        check('the goal\'s round completes it', complete, JSON.stringify(ends.map((e) => e.type)));
    });

    // ── The switch ─────────────────────────────────────────────────────
    await step('off: nothing runs; on again: the session gets its note', async () => {
        await api('setPaused', { paused: true });
        ids.paused = await run.newSession(`E2E:todos ${todos(['Tidy the imports', 'in_progress'])}\n#note=progress`, 'Imports');
        await idleSession(ids.paused);
        await sleep((IDLE + 4) * 1000);
        check('while Autopilot is off, a session with open work gets nothing', (await entriesOf(ids.paused)).length === 0, JSON.stringify(await entriesOf(ids.paused)));
        await api('setPaused', { paused: false });
        const note = await entryReaches(ids.paused, 'nudge', 'delivered', 1, 30000);
        check('on again, it looks at every session: the session gets its note', note.state === 'delivered', JSON.stringify(note));
    });

    // ── The page ───────────────────────────────────────────────────────
    pw = await findPlaywright();
    if (!pw) {
        check('Playwright is here for the window checks (NO_WINDOW=1 runs without them)', process.env.NO_WINDOW === '1', 'install it: npm i --prefix .e2e/tools playwright-core (or set PLAYWRIGHT_MODULE)');
    } else {
        await step('the page', async () => {
            window = await openWindow(run, pw, { entry: 'Autopilot' });
            const { page } = window;
            await page.getByRole('button', { name: 'Autopilot', exact: true }).first().click();
            await page.locator('[data-autopilot-page]').waitFor({ state: 'visible', timeout: 20000 });
            await page.locator('[data-autopilot-log] [data-autopilot-entry]').first().waitFor({ state: 'visible' });
            const header = await page.locator('[data-autopilot-header]').getAttribute('data-autopilot-header');
            const status = await page.locator('[data-autopilot-header] [role="status"]').textContent();
            check('the page opens from DSH\'s sidebar, on, with what it watches in words', header === 'on' && /^Watching \d+ sessions · \d+ of 80 notes used this hour · a session with open work gets a note after 5 seconds of quiet$/.test(status ?? ''), `${header} | ${status}`);
            const anyAsk = page.locator('[data-autopilot-ask]');
            const backed = page.locator(`[data-autopilot-backed="${ids.report}"]`);
            check('Waiting for you: the question, with its answer buttons and Open', (await anyAsk.count()) === 1
                && (await anyAsk.getByRole('button').allTextContents()).join('|').includes('Leave it')
                && (await anyAsk.getByRole('button', { name: 'Open', exact: true }).count()) === 1, await anyAsk.textContent().catch(() => ''));
            check('Waiting for you: the backed-off session, with Try again', (await backed.count()) === 1 && (await backed.getByRole('button', { name: 'Try again' }).count()) === 1, await backed.textContent().catch(() => ''));
            const whyLines = await page.locator('[data-autopilot-log] [data-autopilot-entry] >> text=/^Why: /').count();
            const entries = await page.locator('[data-autopilot-log] [data-autopilot-entry]').count();
            check('every entry in the log has its Why line', entries > 5 && whyLines >= entries - 2, `${whyLines} Why lines for ${entries} entries`);
            const icon = await page.locator('[data-autopilot-icon]').first().textContent();
            check('the sidebar icon shows the question waiting', /1/.test(icon ?? ''), icon);
            const hold = await page.locator(`[data-autopilot-session="${ids.question}"] [data-autopilot-hold]`).textContent().catch(() => '');
            check('a held session says why on its row', hold === 'Waits for you: its last reply asks you something.', hold);
            await shot(page, shots, 'autopilot-light');
            await shot(page, shots, 'waiting-light', page.locator('[data-autopilot-waiting]'));
            await setDark(page, true);
            await shot(page, shots, 'autopilot-dark');
            await shot(page, shots, 'waiting-dark', page.locator('[data-autopilot-waiting]'));
            await page.locator('[data-autopilot-log]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
            await shot(page, shots, 'log-dark');
            await setDark(page, false);
            await shot(page, shots, 'log-light');
            await page.locator('[data-autopilot-page]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
            // A narrow window: the page reflows, nothing spills sideways.
            await page.setViewportSize({ width: 760, height: 900 });
            await page.waitForTimeout(500);
            const spill = await page.locator('[data-autopilot-page]').evaluate((el) => el.scrollWidth - el.clientWidth);
            check('in a narrow window nothing on the page spills sideways', spill <= 1, `${spill}px wider than the page`);
            await shot(page, shots, 'narrow-light');
            await page.setViewportSize({ width: 1280, height: 860 });
            await page.waitForTimeout(300);
        });
        await step('the page\'s buttons', async () => {
            const { page } = window;
            // The question's recommended answer sends the note.
            const ask = page.locator('[data-autopilot-ask]').first();
            await ask.getByRole('button').first().click();
            const answered = await entryReaches(ids.ask, 'nudge', 'delivered', 1, 30000);
            check('the question\'s first button sends the note, delivered', answered.state === 'delivered' && answered.by === 'you', JSON.stringify(answered));
            await page.locator('[data-autopilot-ask]').waitFor({ state: 'detached', timeout: 15000 });
            check('the question leaves the page once answered', (await page.locator('[data-autopilot-ask]').count()) === 0);
            // Try again on the backed-off session.
            const before = await count(ids.report, 'nudge');
            await page.locator(`[data-autopilot-backed="${ids.report}"]`).getByRole('button', { name: 'Try again' }).click();
            await waitFor(async () => (await count(ids.report, 'nudge', 'delivered')) > before, 'the note after Try again', 30000, 300);
            check('Try again nudges the backed-off session again', true);
            // A rule changed on the page: the session left alone under Off gets its note under Auto.
            await page.locator('[data-autopilot-sessions]').getByRole('tab', { name: 'All', exact: true }).click();
            const row = page.locator(`[data-autopilot-session="${ids.off}"]`);
            await row.waitFor({ state: 'visible' });
            await row.getByRole('tab', { name: 'Auto', exact: true }).click();
            const ruled = await entryReaches(ids.off, 'nudge', 'delivered', 1, 30000);
            check('a rule changed to Auto on the page acts at once', ruled.state === 'delivered', JSON.stringify(ruled));
            await shot(page, shots, 'sessions-light', page.locator('[data-autopilot-sessions]'));
            // The switch.
            const toggle = page.locator('[data-autopilot-header] [role="switch"]');
            await toggle.click();
            await page.locator('[data-autopilot-header="off"]').waitFor({ timeout: 15000 });
            check('the switch turns Autopilot off', (await state()).paused === true);
            const ruleLine = await page.locator('[data-autopilot-rule-row="off"]').textContent().catch(() => '');
            check('while off, the rule line says the rule applies when Autopilot is on', /Applies when Autopilot is on\./.test(ruleLine ?? ''), ruleLine);
            await shot(page, shots, 'off-light', page.locator('[data-autopilot-header]'));
            await page.locator('[data-autopilot-header] [role="switch"]').click();
            await page.locator('[data-autopilot-header="on"]').waitFor({ timeout: 15000 });
            check('and on again', (await state()).paused === false);
            const ours = window.errors.filter((text) => /autopilot|session-watch/i.test(text));
            check('no errors from the suite in the window', ours.length === 0, ours.join('\n'));
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-buttons');
        });
        await window?.browser?.close().catch(() => {});
        window = undefined;
    }

    // ── A quit under running turns ──────────────────────────────────────
    // The report session goes back to backed off (no progress after Try again) before the quit, so nothing is in flight.
    await entryReaches(ids.report, 'backoff', 'backed off', 2, 60000).catch(() => {});
    ids.cut = await run.newSession('E2E:slow', 'Long migration');
    ids.cutGoal = await run.newSession('E2E:goal Write the summary [r1=slow]', 'Summary goal');
    await waitFor(async () => (await run.session(ids.cut)).status === 'running', 'the long turn to run', 30000);
    await waitFor(async () => {
        const s = await run.session(ids.cutGoal);
        return s.status === 'running' && s.turns.started >= 2;
    }, 'the goal round to run', 30000);
    const before = (await state()).log.length;
    const reportNotes = await count(ids.report, 'nudge');
    const quitAt = Date.now();
    await run.stop();
    check('DSH quits (SIGTERM) under two running turns', !run.alive(), `quit took ${Date.now() - quitAt} ms`);
    await run.boot('after a quit');
    await waitFor(async () => (await api('state')).ok, 'Autopilot\'s endpoints after the quit', 30000);
    await step('after a quit: each cut-off session gets a carry-on note, read into a turn', async () => {
        const note = await entryReaches(ids.cut, 'resume', 'delivered', 1, 40000);
        check('after a quit, the cut-off session gets a carry-on note, delivered', note.state === 'delivered', JSON.stringify(note));
        check('the note says what happened and what to do', /^\[Autopilot\] DSH stopped while you were working: turn 1 was cut off \(its last step was at .+\)\. Check what already finished \(files, commands, todos\), then carry on from where you stopped\./.test(note.note ?? ''), note.note);
        check('its Why line says a quit can do it too', /DSH stopped before it finished \(a quit, a restart or a crash\)/.test(note.why ?? ''), note.why);
        check('the session\'s own log shows the note read into a turn', await readIntoTurn(ids.cut, '[Autopilot] DSH stopped while you were working'));
        const goalNote = await entryReaches(ids.cutGoal, 'resume', 'delivered', 1, 40000);
        check('the goal\'s session gets its note too, naming the goal', /Still open: the goal “Write the summary \[r1=slow\]” \(round 1 of 6\)/.test(goalNote.note ?? ''), goalNote.note);
        const rearm = await entryReaches(ids.cutGoal, 'rearm', 'started', 1, 40000);
        check('then its goal starts again, proven by the next round', rearm.reason === 'round 2 began', JSON.stringify(rearm));
    });
    await step('a restart never repeats what was handled', async () => {
        await sleep((IDLE * 2 + 2) * 1000);
        const s = await state();
        const fresh = s.log.slice(0, s.log.length - before);
        const repeats = fresh.filter((e) => ![ids.cut, ids.cutGoal].includes(e.sessionId) && e.kind !== 'skip');
        check('nothing handled before the quit is done again', repeats.length === 0 && (await count(ids.report, 'nudge')) === reportNotes, JSON.stringify(repeats.map((e) => [e.kind, e.title, e.state])));
        check('the rules survive the quit', (await state()).sessions.find((x) => x.sessionId === ids.ask)?.rule === 'ask');
    });

    // ── A crash under a running turn ────────────────────────────────────
    ids.crash = await run.newSession('E2E:slow', 'Big refactor');
    await waitFor(async () => (await run.session(ids.crash)).status === 'running', 'the turn to run before the crash', 30000);
    await sleep(500);
    await run.crash();
    await step('a crash: the record of running turns names the session, and it gets its note after the start', async () => {
        const runningFile = join(run.home, 'session-watch', 'running.json');
        const record = JSON.parse(readFileSync(runningFile, 'utf8'));
        check('the watcher\'s record of running turns names the cut-off session, in a private file', Boolean(record.sessions?.[ids.crash]) && modeOf(runningFile) === 0o600, JSON.stringify(record));
        await run.boot('after a crash');
        await waitFor(async () => (await api('state')).ok, 'Autopilot\'s endpoints after the crash', 30000);
        const note = await entryReaches(ids.crash, 'resume', 'delivered', 1, 40000);
        check('after a crash, the cut-off session gets its carry-on note, delivered', note.state === 'delivered', JSON.stringify(note));
        check('the session\'s own log shows it read into a turn', await readIntoTurn(ids.crash, '[Autopilot] DSH stopped while you were working'));
    });

    // ── Files ──────────────────────────────────────────────────────────
    await step('private folders and files', async () => {
        const dirs = ['autopilot', 'session-watch'].map((d) => join(run.home, d));
        const files = [join(run.home, 'autopilot', 'state.json'), join(run.home, 'autopilot', 'events.jsonl'), join(run.home, 'session-watch', 'running.json')];
        const modes = [...dirs, ...files].map((p) => `${p.slice(run.home.length + 1)} ${modeOf(p).toString(8)}`);
        check('Autopilot\'s and the watcher\'s folders are 700 and their files 600', dirs.every((d) => modeOf(d) === 0o700) && files.every((f) => modeOf(f) === 0o600), modes.join(', '));
    });

    // ── A wrong setting, fixed in Plugins ──────────────────────────────
    await restartWith(rowsWith({ idle: 2 }), 'a wrong setting');
    await waitFor(async () => (await api('state')).ok, 'Autopilot\'s endpoints with a wrong setting', 30000);
    await step('a wrong setting: Autopilot starts, does no work, and says which setting and what it must be', async () => {
        const s = await state();
        check('a wrong value does not stop Autopilot from starting: its state names the setting, the range and the value',
            s.problem?.text === 'Quiet time before a note (idleSeconds) must be a whole number of seconds from 5 to 86400 (it is 2)' && s.problem?.live === true, JSON.stringify(s.problem));
        ids.waiting = await run.newSession(`E2E:todos ${todos(['Sort the inbox', 'in_progress'])}\n#note=progress`, 'Inbox');
        await idleSession(ids.waiting);
        await sleep(6000);
        check('while a setting is wrong, Autopilot does no work', (await entriesOf(ids.waiting)).length === 0, JSON.stringify(await entriesOf(ids.waiting)));
        const refused = await api('setPaused', { paused: true });
        check('its page\'s actions say why they cannot go', refused.ok === false && /waiting for a setting to be fixed/.test(refused.error?.message ?? ''), JSON.stringify(refused));
    });
    if (pw) {
        await step('a wrong setting, in the window: the page says what to change and opens Autopilot\'s settings in Plugins, which fix it', async () => {
            window = await openWindow(run, pw, { entry: 'Autopilot' });
            const { page } = window;
            await page.getByRole('button', { name: 'Autopilot', exact: true }).first().click();
            const problem = page.locator('[data-suite-trouble="setting"]');
            await problem.waitFor({ state: 'visible', timeout: 20000 });
            const words = (await problem.innerText()).replace(/\n+/g, ' ');
            check('the page says which setting is wrong, what it must be, and where to change it',
                /^Autopilot is waiting for a setting to be fixed\. Quiet time before a note \(idleSeconds\) must be a whole number of seconds from 5 to 86400 \(it is 2\)\. Change it in Autopilot's settings in Plugins\. Autopilot starts working again as soon as you save\./.test(words), words);
            await shot(page, shots, 'setting-light');
            await setDark(page, true);
            await shot(page, shots, 'setting-dark');
            await setDark(page, false);
            await page.getByRole('button', { name: 'Open Autopilot\'s settings' }).click();
            const form = page.locator('[data-suite-settings="dsh-plugin-autopilot"]');
            await form.waitFor({ state: 'visible', timeout: 20000 });
            const labels = await form.locator('label').allTextContents();
            check('its button opens Autopilot\'s settings in Plugins, in DSH\'s own form', labels.includes('Quiet time before a note, in seconds') && labels.includes('Waits before each try after an error, in seconds') && (await form.getByRole('switch', { name: 'Resume after a restart' }).count()) === 1, labels.join(' | '));
            const field = page.getByLabel('Quiet time before a note, in seconds');
            await field.fill('3');
            const save = form.getByRole('button', { name: 'Save' });
            const refusedWords = await page.locator('[data-suite-setting="idleSeconds"]').innerText();
            check('the form will not save a value out of range, and says what fits', await save.isDisabled() && /A whole number from 5 to 86400, or empty for the default \(600\)\./.test(refusedWords), refusedWords);
            await shot(page, shots, 'settings-light');
            await setDark(page, true);
            await shot(page, shots, 'settings-dark');
            await setDark(page, false);
            await field.fill(String(IDLE));
            await save.click();
            const fixed = await waitFor(async () => {
                const r = await api('state');
                return r.ok && !r.value.problem ? r.value : null;
            }, 'the setting to be fixed', 20000);
            const entry = fixed.log.find((e) => e.kind === 'settings');
            check('saving a good value fixes it at once, and the log says who did', fixed.settings.idleSeconds === IDLE && entry?.text === 'Settings fixed: Autopilot is working again' && entry?.by === 'you' && entry?.why === 'You saved Quiet time before a note in Plugins.', JSON.stringify(entry));
            const note = await entryReaches(ids.waiting, 'nudge', 'delivered', 1, 30000);
            check('once fixed, the session that waited gets its note', note.state === 'delivered', JSON.stringify(note));
            // Session Watch's own setting, on its page in Plugins: back to the plugin list, then its card.
            const viewWatch = page.getByRole('button', { name: 'View Session Watch' });
            await page.getByRole('button', { name: 'Back to plugins' }).click();
            await viewWatch.waitFor({ state: 'visible', timeout: 15000 });
            await viewWatch.click();
            const watchForm = page.locator('[data-suite-settings="dsh-plugin-session-watch"]');
            await watchForm.waitFor({ state: 'visible', timeout: 20000 });
            const watchField = await watchForm.getByLabel('How long a message may wait to be read, in seconds').inputValue();
            check('Session Watch\'s page in Plugins has its one setting, with the profile\'s value', watchField === '60', watchField);
            await shot(page, shots, 'watch-settings-light');
            const ours = window.errors.filter((text) => /autopilot|session-watch/i.test(text));
            check('no errors from the suite in the window', ours.length === 0, ours.join('\n'));
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-settings');
        });
        await window?.browser?.close().catch(() => {});
        window = undefined;
    }

    // ── Session Watch off ──────────────────────────────────────────────
    await restartWith(rowsWith({ off: ['session-watch'] }), 'Session Watch off');
    await step('Session Watch off: Autopilot cannot start, and its page says what it needs', async () => {
        const r = await api('state');
        check('without Session Watch, Autopilot\'s host half does not run', r.ok === false, JSON.stringify(r));
        if (!pw) return;
        window = await openWindow(run, pw, { entry: 'Autopilot' });
        const { page } = window;
        await page.getByRole('button', { name: 'Autopilot', exact: true }).first().click();
        const trouble = page.locator('[data-suite-trouble="watch-off"]');
        await trouble.waitFor({ state: 'visible', timeout: 20000 });
        const words = (await trouble.innerText()).replace(/\n+/g, ' ');
        check('the page says Autopilot needs Session Watch, and what to do, with no HTTP status',
            /^Autopilot needs Session Watch, which is not running\. Switch Session Watch on in Plugins\. This page comes back by itself once it runs\./.test(words) && !/404|HTTP|transport/.test(words), words);
        await shot(page, shots, 'watch-off-light');
        await setDark(page, true);
        await shot(page, shots, 'watch-off-dark');
        await setDark(page, false);
        await trouble.getByRole('button', { name: 'Open Session Watch in Plugins' }).click();
        await page.getByText('dsh-plugin-session-watch', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 });
        check('its button opens Session Watch in Plugins', true);
        await shot(page, shots, 'watch-off-plugins-light');
    }, async () => {
        if (window?.page) await shot(window.page, shots, 'failed-watch-off');
    });
    await window?.browser?.close().catch(() => {});
    window = undefined;

    // ── enabled: false ─────────────────────────────────────────────────
    await restartWith(rowsWith({ enabled: false }), 'enabled: false');
    await waitFor(async () => (await api('state')).ok, 'Autopilot\'s endpoints with enabled: false', 30000);
    await step('enabled: false: Autopilot watches nothing, and its page says so and how to change it', async () => {
        const s = await state();
        check('with enabled: false Autopilot is loaded but idle', s.enabled === false && !s.problem, JSON.stringify({ enabled: s.enabled, problem: s.problem }));
        if (!pw) return;
        window = await openWindow(run, pw, { entry: 'Autopilot' });
        const { page } = window;
        await page.getByRole('button', { name: 'Autopilot', exact: true }).first().click();
        const header = page.locator('[data-autopilot-header]');
        await header.waitFor({ state: 'visible', timeout: 20000 });
        const words = (await header.innerText()).replace(/\n+/g, ' ');
        check('the page says it watches nothing, and how to change that', /Autopilot is switched off in DSH's profile \(enabled: false in its entry in cordis\.patch\.yml\), so it watches nothing\. To use it, set enabled to true there and restart DSH\./.test(words), words);
        await shot(page, shots, 'disabled-light');
    }, async () => {
        if (window?.page) await shot(window.page, shots, 'failed-disabled');
    });
} catch (error) {
    check('the run finished', false, error?.stack ?? error);
    if (window?.page) await shot(window.page, shots, 'failed').catch(() => {});
} finally {
    await window?.browser?.close().catch(() => {});
    model.release();
    await run.stop();
    await model.close();
    const warnings = run.logText().split('\n').filter((line) => /autopilot|session-watch/i.test(line) && /warn|error|fail/i.test(line));
    if (warnings.length) console.log(`# DSH said about the suite:\n${warnings.slice(-20).map((l) => `#   ${l}`).join('\n')}`);
    run.cleanup();
}
console.log(`\n# DSH ${version}: ${tally.passed} passed, ${tally.failed} failed${pw ? '' : ', window checks skipped (no Playwright)'}`);
process.exit(tally.failed ? 1 : 0);
