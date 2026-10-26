#!/usr/bin/env node
/**
 * Focus in a real DSH: the timer's host route with its first start, its
 * refusals in words and its own end of a timer (with no window open, under
 * a restart, and while DSH was closed at the end); settings changed while
 * DSH runs, a wrong one too; and the window: the footer button, DSH's own
 * dialog with every control, the end said once (toast and chime) even with
 * two windows open, the panel's error states, motion stopped under
 * Wallpaper's wp-still and the system's reduced motion, 760 px, switched
 * off and on in Plugins, and pictures light and dark with Wallpaper on and off.
 *
 * DSH runs from a throwaway DSH_HOME (test/e2e/harness.mjs) with this repo's
 * Focus, the session bridge (the harness's handle on DSH) and a copy of
 * Wallpaper (WALLPAPER_DIR; default ~/Projects/goal95/wt/wallpaper/plugins/wallpaper,
 * loaded read-only; without it the Wallpaper parts are skipped and said).
 * Wallpaper's picture is made here, into the throwaway home.
 *
 *   DSH_BIN=/path/to/@deepseek-ai/dsh/lib/bin.js node plugins/focus/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs the newest DSH under .e2e/; `node scripts/e2e.mjs
 * focus` runs it on each of those and on the installed app's own DSH.
 * SHOTS=<folder> keeps the window's pictures there (default
 * .e2e/shots/focus/<version>); KEEP=1 keeps the throwaway home. Without
 * Playwright the run fails, unless NO_WINDOW=1 says to run without the window.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { DshRun, checks, dismissNotices, dshBin, findPlaywright, openWindow, pluginsDir, repoRoot, setDark, shot, sleep, waitFor } from '../../../../test/e2e/harness.mjs';
import { startFakeModel } from '../../../../test/e2e/fake-model.mjs';

const bin = dshBin();
if (!bin) {
    console.log('skipped: no DSH to run (set DSH_BIN, or install one under .e2e/dsh-<version>)');
    process.exit(0);
}
const version = process.env.DSH_LABEL || (/dsh-([^/]+)\/node_modules/.exec(bin)?.[1] ?? basename(dirname(dirname(bin))));
const shots = process.env.SHOTS || join(repoRoot, '.e2e', 'shots', 'focus', version);
console.log(`# DSH ${version}: ${bin}`);
console.log(`# pictures: ${shots}`);

// Wallpaper, read-only, from its own copy; never a checkout the live DSH loads.
const wallpaperDir = resolve(process.env.WALLPAPER_DIR || join(homedir(), 'Projects', 'goal95', 'wt', 'wallpaper', 'plugins', 'wallpaper'));
const liveCopies = [join(homedir(), '.dsh-plugins'), join(homedir(), 'Projects', 'worktrees', 'dsh-split-plugins'), join(homedir(), '.dsh')];
if (liveCopies.some((dir) => wallpaperDir === dir || wallpaperDir.startsWith(`${dir}/`))) {
    console.error(`refused: ${wallpaperDir} is a copy the live DSH uses; point WALLPAPER_DIR at another copy`);
    process.exit(2);
}
const withWallpaper = existsSync(join(wallpaperDir, 'package.json'));
console.log(withWallpaper ? `# Wallpaper: ${wallpaperDir}` : `# Wallpaper: none at ${wallpaperDir}; its parts are skipped`);

const tally = checks();
const { check, step } = tally;
const json = (value) => JSON.stringify(value);
const read = (file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } };
const model = await startFakeModel();
const plugins = {
    'dsh-plugin-session-bridge': join(pluginsDir, 'session-bridge'),
    'dsh-plugin-focus': join(pluginsDir, 'focus'),
    ...(withWallpaper ? { 'dsh-plugin-wallpaper': wallpaperDir } : {}),
};
const run = new DshRun({ label: 'focus', bin, plugins });
const focusDir = join(run.home, 'focus');
const stateFile = join(focusDir, 'state.json');
const logFile = join(focusDir, 'focus.log');

// ── Wallpaper's picture, made here: a vertical gradient PNG ─────────────────
function gradientPng(width, height, top, bottom) {
    const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
        return Buffer.concat([len, body, sum]);
    };
    const raw = Buffer.alloc((width * 3 + 1) * height);
    for (let y = 0; y < height; y++) {
        const t = y / Math.max(1, height - 1);
        const row = y * (width * 3 + 1);
        for (let x = 0; x < width; x++) {
            const band = Math.sin((x / width) * Math.PI) * 22;
            for (let i = 0; i < 3; i++) raw[row + 1 + x * 3 + i] = Math.max(0, Math.min(255, Math.round(top[i] + (bottom[i] - top[i]) * t + band)));
        }
    }
    const head = Buffer.alloc(13);
    head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
if (withWallpaper) {
    const wall = join(run.home, 'wallpaper');
    mkdirSync(join(wall, 'wallpapers', 'e2e'), { recursive: true });
    writeFileSync(join(wall, 'wallpapers', 'e2e', 'focus-e2e.png'), gradientPng(1440, 900, [38, 74, 122], [204, 128, 92]));
    writeFileSync(join(wall, 'state.json'), `${JSON.stringify({ prefs: { wallpaperCollection: 'e2e', wallpaperPinned: 'focus-e2e.png', wallpaperKind: 'image', wallpaperRotate: 'off', glassTint: 35, glassBlur: 22, motion: true } }, null, 1)}\n`);
}

// ── Focus's route, as the window calls it (signed in) ───────────────────────
async function focus(method = 'GET', body, { raw } = {}) {
    const web = await run.signIn();
    const data = raw ?? (body === undefined ? undefined : JSON.stringify(body));
    const res = await fetch(new URL('/api/focus/state', web.base.origin), {
        method,
        headers: { cookie: web.cookie, origin: web.base.origin, ...(data !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: data,
    });
    const text = await res.text();
    let value = null;
    try { value = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, body: value, text };
}
const op = (o, extra = {}) => focus('POST', { op: o, ...extra });
const completesIn = (from) => (read(logFile).slice(from).match(/ complete focus /g) ?? []).length;

/** The patch's Focus row: none, or one with `config`. DSH applies a changed patch while it runs. */
function focusRow(config) {
    const patch = join(run.profile, 'cordis.patch.yml');
    const text = read(patch);
    const start = text.indexOf('- id: focus\n');
    const kept = start < 0 ? text : text.slice(0, start) + (text.indexOf('\n- id:', start + 1) < 0 ? '' : text.slice(text.indexOf('\n- id:', start + 1) + 1));
    const row = config ? `- id: focus\n  config:\n${Object.entries(config).map(([k, v]) => `    ${k}: ${JSON.stringify(v)}`).join('\n')}\n` : '';
    writeFileSync(patch, `${kept.endsWith('\n') || kept === '' ? kept : `${kept}\n`}${row}`);
}

let window;
let second;
try {
    run.writeProfile(model.port);
    await run.boot('first start');

    // ── first start ──────────────────────────────────────────────────────
    await step('first start: the default state, written to DSH_HOME/focus, served on /api/focus/state', async () => {
        const got = await focus();
        const b = got.body ?? {};
        check('GET /api/focus/state answers 200 with no-store', got.status === 200 && got.headers.get('cache-control') === 'no-store', `${got.status} ${got.headers.get('cache-control')}`);
        check('a first start: focus 25 min, idle, nothing counted, revision 0, no problems',
            b.timer?.kind === 'focus' && b.timer?.durationMs === 1500000 && b.timer?.running === false && b.sessions?.focus === 0 && b.rev === 0 && json(b.problems) === '[]'
            && json(b.settings) === json({ focusMin: 25, shortMin: 5, longMin: 15, chime: true }), got.text);
        check('the state is in the instance\'s own DSH_HOME/focus/state.json', existsSync(stateFile) && JSON.parse(read(stateFile)).rev === 0, stateFile);
        check('focus.log says the first start and the route', /first start: default state written to/.test(read(logFile)) && /started; serving \/api\/focus\/state/.test(read(logFile)), read(logFile));
        const client = await run.clientOf('dsh-plugin-focus');
        check('DSH serves Focus\'s window half', client.status === 200 && client.text.includes('dsh-plugin-focus:open'), `${client.status} ${client.url}`);
    });

    // ── refusals in words ────────────────────────────────────────────────
    await step('refusals: bad input is a 400 in words, a timer running refuses start and set (409), other methods 405', async () => {
        const bad = await focus('POST', undefined, { raw: '{nope' });
        check('a body that is not JSON: 400, in words', bad.status === 400 && /valid JSON/.test(bad.body?.error ?? ''), bad.text);
        const unknown = await op({ op: 'fly' });
        check('an unknown op: 400, naming the ops', unknown.status === 400 && /start, pause, resume, reset, set, complete/.test(unknown.body?.error ?? ''), unknown.text);
        const minutes = await focus('POST', { settings: { focusMin: 'lots' } });
        check('a length that is not a number: 400, with the range', minutes.status === 400 && /from 1 to 180/.test(minutes.body?.error ?? ''), minutes.text);
        const put = await focus('PUT', {});
        check('PUT: 405 with Allow: GET, POST', put.status === 405 && put.headers.get('allow') === 'GET, POST', `${put.status} ${put.headers.get('allow')}`);
        const started = await op({ op: 'start', kind: 'custom', durationMs: 600000 });
        const again = await op({ op: 'start', kind: 'focus', durationMs: 1500000 });
        const set = await focus('POST', { op: { op: 'set', kind: 'short', durationMs: 300000 }, settings: { chime: false } });
        const after = await focus();
        check('while a timer runs, start and set are refused (409) and change nothing, the settings with them',
            started.status === 200 && again.status === 409 && /Pause or reset it first/.test(again.body?.error ?? '') && set.status === 409
            && after.body?.timer?.kind === 'custom' && after.body?.timer?.running === true && after.body?.settings?.chime === true && after.body?.rev === started.body?.rev,
            json({ again: again.body, set: set.body, after: after.body?.timer }));
        const reset = await op({ op: 'reset' });
        check('reset: idle at its full length', reset.status === 200 && reset.body?.timer?.running === false && reset.body?.timer?.remainingMs === 600000, reset.text);
    });

    // ── the host ends a timer itself, with no window open ────────────────
    await step('with no window open, the host ends a timer at its end and counts it once', async () => {
        const mark = read(logFile).length;
        const started = await op({ op: 'start', kind: 'focus', durationMs: 10000 });
        const endAt = started.body?.timer?.endAt;
        check('started: running, ending in 10 s', started.status === 200 && started.body?.timer?.running === true && Math.abs(endAt - Date.now() - 10000) < 3000, started.text);
        await waitFor(async () => (await focus()).body?.timer?.running === false, 'the host to end the timer', 30000, 500);
        const done = (await focus()).body;
        check('ended by the host, as of its end: idle, full length again, doneAt is its endAt, one focus session counted',
            done.timer.doneAt === endAt && done.timer.remainingMs === 10000 && done.sessions.focus === 1, json(done));
        const late = await op({ op: 'complete' });
        check('a window\'s late complete counts nothing more', late.status === 200 && late.body?.changed === false && late.body?.sessions?.focus === 1, late.text);
        check('focus.log has the one end', completesIn(mark) === 1 && /complete focus 10s \(focus sessions today: 1\)/.test(read(logFile)), read(logFile).slice(mark));
    });

    // ── a restart under a running timer ──────────────────────────────────
    await step('a restart under a running timer keeps its end; one that ended while DSH was closed ends at the next start, once', async () => {
        const started = await op({ op: 'start', kind: 'custom', durationMs: 600000 });
        const endAt = started.body?.timer?.endAt;
        await run.stop();
        await run.boot('restart under a running timer');
        const back = (await focus()).body;
        check('after a restart: still running, the same end', back?.timer?.running === true && back.timer.endAt === endAt && back.timer.kind === 'custom', json(back?.timer));
        await op({ op: 'reset' });
        const before = (await focus()).body.sessions.focus;
        const mark = read(logFile).length;
        const short = await op({ op: 'start', kind: 'focus', durationMs: 10000 });
        const shortEnd = short.body?.timer?.endAt;
        await run.stop();
        check('DSH was closed before the timer ended', Date.now() < shortEnd, `${shortEnd - Date.now()} ms left`);
        if (Date.now() < shortEnd + 6000) await sleep(shortEnd + 6000 - Date.now());
        await run.boot('start after the end');
        const after = (await focus()).body;
        check('at the next start: ended as of its end, counted once',
            after?.timer?.running === false && after.timer.doneAt === shortEnd && after.sessions.focus === before + 1, json(after));
        check('focus.log says it was noted after its end', completesIn(mark) === 1 && /complete focus 10s \(focus sessions today: \d+\), noted \d+s after its end/.test(read(logFile).slice(mark)), read(logFile).slice(mark));
    });

    // ── settings while DSH runs ──────────────────────────────────────────
    await step('settings while DSH runs: a wrong dataDir is said and the default kept; a good one is used; back to none', async () => {
        const rev = (await focus()).body.rev;
        focusRow({ dataDir: 'relative/focus' });
        await waitFor(async () => ((await focus()).body?.problems ?? []).some((p) => /dataDir must be a full path/.test(p)), 'the problem in GET', 30000, 400);
        const wrong = (await focus()).body;
        check('a relative dataDir: named in GET problems, in words, and the timer still served from the default folder',
            wrong.problems.length === 1 && /dataDir must be a full path .*"relative\/focus".*keeps its timer in/.test(wrong.problems[0]) && wrong.rev >= rev, json(wrong.problems));
        check('focus.log says the setting', /setting: dataDir must be a full path/.test(read(logFile)), read(logFile).slice(-400));
        const own = join(run.root, 'focus-own');
        focusRow({ dataDir: own });
        await waitFor(() => existsSync(join(own, 'state.json')), 'the state in the configured folder', 30000, 400);
        const good = (await focus()).body;
        check('a full dataDir: the timer lives there (a first start of its own), no problems', json(good.problems) === '[]' && good.rev === 0 && existsSync(join(own, 'focus.log')), json(good));
        focusRow(null);
        await waitFor(async () => (await focus()).body?.rev >= rev, 'the default folder back', 30000, 400);
        const back = (await focus()).body;
        check('no row again: back on the default folder, its state as it was', json(back.problems) === '[]' && back.rev >= rev && back.sessions.focus >= 2, json(back));
        await op({ op: 'set', kind: 'focus', durationMs: 1500000 });
    });

    // ── the window ───────────────────────────────────────────────────────
    const pw = process.env.NO_WINDOW === '1' ? null : await findPlaywright();
    if (!pw) {
        check('the window checks ran', process.env.NO_WINDOW === '1', 'no Playwright: set PLAYWRIGHT_MODULE, or NO_WINDOW=1 to run without the window');
    } else {
        const requests = [];
        const ours = (errors) => errors.filter((e) => /focus/i.test(e) && !/Failed to load resource/.test(e));
        // The footer button and what is around it, in DSH's sidebar footer.
        const footShot = async (page, name) => {
            const box = await page.locator('[data-focus-open]').boundingBox();
            if (!box || !shots) return;
            mkdirSync(shots, { recursive: true });
            await page.waitForTimeout(400);
            const size = page.viewportSize();
            const x = Math.max(0, box.x - 220);
            const y = Math.max(0, box.y - 70);
            await page.screenshot({ path: join(shots, `${name}.png`), clip: { x, y, width: Math.min(size.width - x, 340), height: Math.min(size.height - y, 120) } });
        };
        const chimeStub = () => {
            window.__chimes = [];
            window.AudioContext = class {
                constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
                createOscillator() { const o = { type: '', frequency: { value: 0 }, connect() {}, start() { window.__chimes.push(o.frequency.value); }, stop() {} }; return o; }
                createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
                resume() { return Promise.resolve(); }
                close() { return Promise.resolve(); }
            };
        };
        await step('the window: the footer button, DSH\'s dialog and every control', async () => {
            window = await openWindow(run, pw, { width: 1280, height: 860 });
            const { page } = window;
            page.on('request', (r) => requests.push(r.url()));
            // The chime's stand-in from the page's first script on, so no click can make a real one first.
            await page.addInitScript(chimeStub);
            await page.reload({ waitUntil: 'domcontentloaded' });
            const button = page.locator('[data-focus-open]');
            await button.waitFor({ state: 'visible', timeout: 30000 });
            await dismissNotices(page);
            check('the footer button, named in words', (await button.getAttribute('aria-label')) === 'Focus timer' && (await button.getAttribute('aria-haspopup')) === 'dialog', await button.getAttribute('aria-label'));
            if (withWallpaper) {
                await waitFor(() => page.evaluate(() => document.body.classList.contains('wp-on')), 'Wallpaper on', 20000, 300).catch(() => {});
                check('Wallpaper is on (body.wp-on)', await page.evaluate(() => document.body.classList.contains('wp-on')));
            }
            check('one style sheet, with its plugin and file named', (await page.locator('style[data-plugin="dsh-plugin-focus"][data-plugin-css="dsh-plugin-focus/client.css"]').count()) === 1);
            await footShot(page, 'footer-idle-light');
            await button.click();
            const panel = page.locator('[data-focus-panel]');
            await panel.waitFor({ state: 'visible' });
            const dialog = page.getByRole('dialog').filter({ has: panel });
            check('the panel is DSH\'s dialog, titled', (await dialog.count()) === 1 && (await dialog.getByText('Focus timer', { exact: true }).count()) >= 1);
            const stateLine = panel.locator('[data-focus-state]');
            check('it says the state in words: Focus · ready, 25:00', (await stateLine.textContent()) === 'Focus · ready, 25:00' && (await panel.locator('[data-focus-time]').textContent()) === '25:00', await stateLine.textContent());
            check('the first control has the focus: Start', await page.evaluate(() => document.activeElement?.textContent === 'Start'), await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)));
            const sessions = (await focus()).body.sessions.focus;
            check('the sessions line is the host\'s count', (await panel.locator('[data-focus-sessions]').textContent()) === `${sessions} focus sessions today`, await panel.locator('[data-focus-sessions]').textContent());

            // Start, the running state, the locked lengths.
            await dialog.getByRole('button', { name: 'Start', exact: true }).click();
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'running', 'running', 10000, 200);
            const running = (await focus()).body.timer;
            check('Start: the host runs it, the panel says when it ends', running.running === true && /^Focus · running, ends at \d{1,2}:\d{2}\s?[AP]M$/.test(await stateLine.textContent()), await stateLine.textContent());
            const preset = dialog.getByRole('button', { name: 'Short break 5 min', exact: true });
            check('while it runs, the lengths are locked and the panel says why', (await preset.isDisabled()) && (await panel.getByText('Pause or reset to choose another length.').count()) === 1);
            check('the footer button says it runs, in minutes', /^Focus timer: Focus, (25|24) minutes left$/.test(await button.getAttribute('aria-label')), await button.getAttribute('aria-label'));
            await shot(page, shots, 'panel-running-light');
            await setDark(page, true);
            await shot(page, shots, 'panel-running-dark');
            await setDark(page, false);

            // Motion: none under wp-still or the system's reduced motion.
            const motion = () => page.evaluate(() => {
                const dot = document.querySelector('.fc-dot');
                const arc = document.querySelector('.fc-ring-arc.fc-run');
                return { dot: dot ? getComputedStyle(dot).animationName : 'missing', arc: arc ? getComputedStyle(arc).transitionDuration : 'missing' };
            });
            const moving = await motion();
            check('while it runs: the dot pulses and the ring moves', moving.dot === 'fc-pulse' && moving.arc !== '0s', json(moving));
            await page.evaluate(() => document.body.classList.add('wp-still'));
            const still = await motion();
            await page.evaluate(() => document.body.classList.remove('wp-still'));
            check('under body.wp-still (Wallpaper\'s Motion off): no animation, no transition', still.dot === 'none' && still.arc === '0s', json(still));
            await page.emulateMedia({ reducedMotion: 'reduce' });
            const reduced = await motion();
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            check('under reduced motion: no animation, no transition', reduced.dot === 'none' && reduced.arc === '0s', json(reduced));

            // Pause, Resume, Reset.
            await dialog.getByRole('button', { name: 'Pause', exact: true }).click();
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'paused', 'paused', 10000, 200);
            const paused = (await focus()).body.timer;
            check('Pause: the host keeps what is left, the panel says it', paused.running === false && paused.remainingMs < 1500000 && /^Focus · paused, 2\d:\d\d left$/.test(await stateLine.textContent()), await stateLine.textContent());
            await dialog.getByRole('button', { name: 'Resume', exact: true }).click();
            await waitFor(async () => (await focus()).body.timer.running === true, 'resumed', 10000, 200);
            check('Resume: running again from there', (await focus()).body.timer.endAt - Date.now() <= paused.remainingMs + 500);
            await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'ready', 'reset', 10000, 200);
            check('Reset: ready at the full length', (await panel.locator('[data-focus-time]').textContent()) === '25:00' && (await focus()).body.timer.running === false);

            // Lengths: a preset, a custom one, one out of range.
            await preset.click();
            await waitFor(async () => (await focus()).body.timer.kind === 'short', 'the short break', 10000, 200);
            check('a preset: the host sets it, the panel shows it pressed', (await panel.locator('[data-focus-time]').textContent()) === '5:00' && (await preset.getAttribute('aria-pressed')) === 'true');
            const custom = dialog.getByLabel('Custom length in minutes');
            await custom.fill('500');
            check('a custom length out of range: Set is off and the panel says the range', (await dialog.getByRole('button', { name: 'Set', exact: true }).isDisabled()) && (await panel.getByText('From 1 to 180 minutes.').count()) === 1);
            await custom.fill('2');
            await dialog.getByRole('button', { name: 'Set', exact: true }).click();
            await waitFor(async () => (await focus()).body.timer.kind === 'custom', 'the custom length', 10000, 200);
            check('a custom length: 2 min', (await focus()).body.timer.durationMs === 120000 && (await panel.locator('[data-focus-time]').textContent()) === '2:00');

            // The chime switch and the preset lengths.
            const chime = dialog.getByRole('switch', { name: 'Chime when a timer ends' }).or(dialog.getByRole('checkbox', { name: 'Chime when a timer ends' })).first();
            await chime.click();
            await waitFor(async () => (await focus()).body.settings.chime === false, 'the chime off', 10000, 200);
            check('the chime switch: off at the host', (await focus()).body.settings.chime === false);
            await chime.click();
            await waitFor(async () => (await focus()).body.settings.chime === true, 'the chime on', 10000, 200);
            const shortField = dialog.getByRole('spinbutton', { name: 'Short break' });
            await shortField.fill('7');
            await shortField.press('Enter');
            await waitFor(async () => (await focus()).body.settings.shortMin === 7, 'the short break length', 10000, 200);
            check('a preset length, typed: kept at the host, the preset button says it', (await dialog.getByRole('button', { name: 'Short break 7 min', exact: true }).count()) === 1);
            await shortField.fill('0');
            await shortField.press('Enter');
            check('a preset length out of range: refused in the field, the host unchanged', (await shortField.getAttribute('aria-invalid')) === 'true' && (await focus()).body.settings.shortMin === 7);
            await shortField.fill('5');
            await shortField.press('Enter');
            await waitFor(async () => (await focus()).body.settings.shortMin === 5, 'the short break back to 5', 10000, 200);

            // Escape closes; the focus goes back to the footer button.
            await page.keyboard.press('Escape');
            await panel.waitFor({ state: 'hidden', timeout: 10000 });
            await page.waitForTimeout(100);
            check('Escape closes it and the focus goes back to the footer button', await page.evaluate(() => document.activeElement?.hasAttribute('data-focus-open') === true), await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)));
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-controls');
        });

        await step('the end, said once: a toast and the chime in each window, one session counted for two windows', async () => {
            const { page } = window;
            second = await window.context.newPage();
            second.on('request', (r) => requests.push(r.url()));
            await second.addInitScript(chimeStub);
            await second.goto((await run.signIn()).link, { waitUntil: 'domcontentloaded' });
            await second.locator('[data-focus-open]').waitFor({ state: 'visible', timeout: 60000 });
            await dismissNotices(second);
            await second.locator('[data-focus-open]').click(); // a first click: the chime may sound from now on
            await second.keyboard.press('Escape');
            await page.locator('[data-focus-open]').click();
            await page.locator('[data-focus-panel]').waitFor({ state: 'visible' });
            const before = (await focus()).body.sessions.focus;
            const mark = read(logFile).length;
            const started = await op({ op: 'start', kind: 'focus', durationMs: 10000 });
            check('a 10 s focus, started at the host', started.status === 200, started.text);
            await page.getByText('Focus session done. Time for a break.').first().waitFor({ state: 'visible', timeout: 25000 });
            await second.bringToFront();
            await second.getByText('Focus session done. Time for a break.').first().waitFor({ state: 'visible', timeout: 15000 });
            await page.bringToFront();
            check('both windows say the end, in DSH\'s toast', true);
            check('the chime sounded in each window, two notes', json(await page.evaluate(() => window.__chimes)) === '[659.25,987.77]' && json(await second.evaluate(() => window.__chimes)) === '[659.25,987.77]',
                json([await page.evaluate(() => window.__chimes), await second.evaluate(() => window.__chimes)]));
            await shot(page, shots, 'done-toast-light');
            await page.waitForTimeout(1500);
            const after = (await focus()).body;
            check('two windows, one session counted', after.sessions.focus === before + 1 && completesIn(mark) === 1, json({ before, after: after.sessions, log: read(logFile).slice(mark) }));
            check('the panel says it is done, and the new count', /^Focus · done at /.test(await page.locator('[data-focus-state]').textContent())
                && (await page.locator('[data-focus-sessions]').textContent()) === `${after.sessions.focus} focus sessions today`, await page.locator('[data-focus-state]').textContent());
            await second.close();
            second = undefined;
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-end');
        });

        await step('live data: a change made elsewhere shows within a poll; a read that fails is said, and Try again', async () => {
            const { page } = window;
            const stateLine = page.locator('[data-focus-state]');
            await op({ op: 'set', kind: 'long', durationMs: 900000 });
            await waitFor(async () => (await page.locator('[data-focus-time]').textContent()) === '15:00', 'the change from elsewhere', 12000, 300);
            check('a length set elsewhere shows in the open panel within a poll', (await stateLine.textContent()) === 'Long break · ready, 15:00', await stateLine.textContent());
            await page.route('**/api/focus/state', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"a stand-in failure"}' }));
            await page.locator('[data-focus-stale]').waitFor({ state: 'visible', timeout: 12000 });
            check('a read that fails: the panel says so, and that it tries again', /a stand-in failure.*tries again every few seconds/.test(await page.locator('[data-focus-stale]').textContent()), await page.locator('[data-focus-stale]').textContent());
            await page.locator('[data-focus-primary]').click();
            await page.getByText('Not changed: a stand-in failure').first().waitFor({ state: 'visible', timeout: 10000 });
            check('an op that fails: a toast says nothing changed, and why', true);
            await page.keyboard.press('Escape');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.locator('[data-focus-open]').waitFor({ state: 'visible', timeout: 60000 });
            await page.locator('[data-focus-open]').click();
            const error = page.locator('[data-focus-error]');
            await error.waitFor({ state: 'visible', timeout: 10000 });
            check('no state at all: the panel says Focus can\'t reach its timer, what to check, and Try again',
                /^Focus can't reach its timer: a stand-in failure\. Check that the Focus plugin is on in Plugins, then try again\.$/.test(await error.textContent())
                && (await page.getByRole('button', { name: 'Try again', exact: true }).count()) === 1, await error.textContent());
            await shot(page, shots, 'panel-error-light');
            await page.unroute('**/api/focus/state');
            await page.getByRole('button', { name: 'Try again', exact: true }).click();
            await page.locator('[data-focus-state]').waitFor({ state: 'visible', timeout: 10000 });
            check('Try again: the timer is back', (await page.locator('[data-focus-state]').textContent()) === 'Long break · ready, 15:00');
            await page.keyboard.press('Escape');
        }, async () => {
            if (window?.page) { await window.page.unroute('**/api/focus/state').catch(() => {}); await shot(window.page, shots, 'failed-live'); }
        });

        await step('pictures: light and dark, wide and 760 px, Wallpaper on and off; the panel fits at 760 px', async () => {
            const { page } = window;
            await op({ op: 'start', kind: 'focus', durationMs: 1500000 });
            const open = async () => {
                if (!(await page.locator('[data-focus-panel]').isVisible().catch(() => false))) await page.locator('[data-focus-open]').click();
                await page.locator('[data-focus-panel]').waitFor({ state: 'visible' });
                await page.waitForTimeout(1200);
            };
            const fits = () => page.evaluate(() => {
                const w = innerWidth;
                const h = innerHeight;
                const box = document.querySelector('[data-focus-panel]')?.closest('[role="dialog"]')?.getBoundingClientRect();
                const controls = [...document.querySelectorAll('[data-focus-panel] button, [data-focus-panel] input, [role="dialog"] button')].map((el) => el.getBoundingClientRect());
                return { box: box && { l: box.left, r: box.right, t: box.top, b: box.bottom }, w, h, ok: Boolean(box) && box.left >= 0 && box.right <= w && controls.every((r) => r.width === 0 || (r.left >= 0 && r.right <= w)) };
            });
            const set = async (name, wide, dark) => {
                await page.setViewportSize({ width: wide ? 1280 : 760, height: 860 });
                await setDark(page, dark);
                await open();
                await shot(page, shots, name);
            };
            const label = withWallpaper ? 'wallpaper' : 'plain';
            await set(`panel-${label}-light`, true, false);
            await set(`panel-${label}-dark`, true, true);
            await set(`panel-${label}-760-dark`, false, true);
            const narrow = await fits();
            check('at 760 px the dialog and every control are inside the window', narrow.ok, json(narrow));
            await set(`panel-${label}-760-light`, false, false);
            await page.keyboard.press('Escape');
            await page.setViewportSize({ width: 1280, height: 860 });
            await footShot(page, 'footer-running-light');
            await setDark(page, true);
            await footShot(page, 'footer-running-dark');
            await setDark(page, false);
            if (withWallpaper) {
                const off = await run.api('pluginManager/setBundleEnabled', { name: 'dsh-plugin-wallpaper', enabled: false });
                await waitFor(() => page.evaluate(() => !document.body.classList.contains('wp-on')), 'Wallpaper off', 20000, 300);
                check('Wallpaper switched off in Plugins: DSH applies it and Focus keeps working', off.ok === true && (await page.locator('[data-focus-open]').count()) === 1, json(off));
                await set('panel-plain-light', true, false);
                await set('panel-plain-dark', true, true);
                await set('panel-plain-760-light', false, false);
                await page.keyboard.press('Escape');
                await page.setViewportSize({ width: 1280, height: 860 });
                await setDark(page, false);
                const on = await run.api('pluginManager/setBundleEnabled', { name: 'dsh-plugin-wallpaper', enabled: true });
                check('Wallpaper switched on again', on.ok === true, json(on));
            }
            await op({ op: 'reset' });
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-pictures');
        });

        await step('Focus switched off in Plugins leaves nothing; on again repeats nothing and keeps the timer', async () => {
            const { page } = window;
            const kept = (await focus()).body;
            const off = await run.api('pluginManager/setBundleEnabled', { name: 'dsh-plugin-focus', enabled: false });
            check('switched off: DSH applies it, with no failure', off.ok === true && off.value?.application === 'applied' && !off.value?.error, json(off));
            const gone = (r) => r.status !== 200 || !r.body?.timer;
            await waitFor(async () => gone(await focus()), 'the route to go', 20000, 300);
            await waitFor(async () => (await page.locator('[data-focus-open]').count()) === 0 && (await page.locator('style[data-plugin="dsh-plugin-focus"]').count()) === 0, 'the button and style to go', 20000, 300).catch(() => {});
            const offRead = await focus();
            check('off: no timer served, no footer button, no panel, no style sheet', gone(offRead) && (await page.locator('[data-focus-open], [data-focus-panel], style[data-plugin="dsh-plugin-focus"]').count()) === 0, `${offRead.status} ${offRead.text.slice(0, 120)}`);
            const on = await run.api('pluginManager/setBundleEnabled', { name: 'dsh-plugin-focus', enabled: true });
            check('switched on again: DSH applies it', on.ok === true && on.value?.application === 'applied' && !on.value?.error, json(on));
            await waitFor(async () => !gone(await focus()), 'the route back', 30000, 300);
            await page.locator('[data-focus-open]').waitFor({ state: 'visible', timeout: 30000 });
            const back = (await focus()).body;
            check('on again: one footer button, one style sheet, the timer and the count as they were',
                (await page.locator('[data-focus-open]').count()) === 1 && (await page.locator('style[data-plugin="dsh-plugin-focus"]').count()) === 1
                && back.sessions.focus === kept.sessions.focus && back.rev === kept.rev && back.timer.kind === kept.timer.kind,
                json({ kept: kept.sessions, back: back.sessions }));
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-plugins');
        });

        const origin = (await run.signIn()).base.origin;
        const foreign = requests.filter((u) => /\/api\/focus\//.test(u) && !u.startsWith(origin));
        check('Focus\'s calls went only to its own route on the window\'s origin', requests.some((u) => u.includes('/api/focus/state')) && foreign.length === 0, json(foreign));
        check('no errors from Focus in the window', ours(window.errors).length === 0, ours(window.errors).join('\n'));
    }
    check('focus.log never held a stack', !/\n\s+at /.test(read(logFile)), read(logFile).slice(-600));
} catch (error) {
    check('the run finished', false, error?.stack ?? error);
    console.log(run.logText().slice(-3000));
} finally {
    if (second) await second.close().catch(() => {});
    if (window) await window.browser.close().catch(() => {});
    await run.stop();
    await model.close();
    run.cleanup();
}

console.log(`\n# ${tally.passed} passed, ${tally.failed} failed`);
if (tally.failed) console.log(`# failed: ${tally.failures.join('; ')}`);
process.exit(tally.failed ? 1 : 0);
