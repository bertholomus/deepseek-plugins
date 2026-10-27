#!/usr/bin/env node
/**
 * Focus in a real DSH: the timer's host route with its first start, its
 * refusals in words and its own end of a timer (with no window open, under
 * a restart, and while DSH was closed at the end), seen and undo; settings
 * changed while DSH runs, a wrong one too; and the window: the footer button,
 * DSH's own dialog with every control, no AudioContext before a click, Reset
 * and Undo, the end said once (toast with the next step, chime) even with two
 * windows open, the footer's mark until a panel shows the end, a hidden
 * window, the panel's error states, motion stopped under Wallpaper's wp-still
 * and the system's reduced motion, DSH's 760 px rail with Wallpaper on, off
 * and on (the neighbour's button whole, the keyboard shortcut), switched off
 * and on in Plugins, and pictures light and dark with Wallpaper on and off.
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
/** True once `fn` holds, within 5 s; false if it never does (the check then prints what is there). */
const settles = (fn, ms = 5000) => waitFor(fn, 'the window', ms, 100).then(() => true, () => false);
/** After a start, the route may come up a moment after the bridge: wait for it. */
const focusUp = (what) => waitFor(async () => Boolean((await focus()).body?.timer), `Focus's route (${what})`, 60000, 300);
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
    await focusUp('first start');

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
        check('DSH serves Focus\'s window half', client.status === 200 && client.text.includes('"dsh-plugin-focus"') && client.text.includes('sidebar.footer.action') && client.text.includes('shell.overlay'), `${client.status} ${client.url}`);
    });

    // ── refusals in words ────────────────────────────────────────────────
    await step('refusals: bad input is a 400 in words, a timer running refuses start and set (409), other methods 405', async () => {
        const bad = await focus('POST', undefined, { raw: '{nope' });
        check('a body that is not JSON: 400, in words', bad.status === 400 && /valid JSON/.test(bad.body?.error ?? ''), bad.text);
        const unknown = await op({ op: 'fly' });
        check('an unknown op: 400, naming the ops', unknown.status === 400 && /start, pause, resume, reset, set, complete/.test(unknown.body?.error ?? ''), unknown.text);
        const minutes = await focus('POST', { settings: { focusMin: 'lots' } });
        check('a length that is not a number: 400, with the range', minutes.status === 400 && /from 1 to 180/.test(minutes.body?.error ?? ''), minutes.text);
        for (const method of ['PUT', 'PATCH', 'DELETE']) {
            const other = await focus(method, method === 'DELETE' ? undefined : {});
            check(`${method}: 405 with Allow: GET, POST, in words`, other.status === 405 && other.headers.get('allow') === 'GET, POST' && other.body?.error === 'Use GET or POST here.', `${other.status} ${other.headers.get('allow')} ${other.text}`);
        }
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
        const undone = await op({ op: 'undo' });
        check('undo after a Reset of a started timer: running again, to the same end', undone.status === 200 && undone.body?.timer?.running === true && undone.body?.timer?.endAt === started.body?.timer?.endAt, undone.text);
        const twice = await op({ op: 'undo' });
        check('a second undo: 409, in words', twice.status === 409 && twice.body?.error === 'There is no Reset to undo: the timer changed since, or the Reset was more than a minute ago.', twice.text);
        await op({ op: 'reset' });
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
        check('no window showed it: the end is not seen (doneSeen false)', done.timer.doneSeen === false, json(done.timer));
        const seen = await op({ op: 'seen' });
        const seenAgain = await op({ op: 'seen' });
        check('seen: marked once, logged', seen.status === 200 && seen.body?.changed === true && seen.body?.timer?.doneSeen === true && seenAgain.body?.changed === false
            && /seen: the end of focus at /.test(read(logFile).slice(mark)), json({ seen: seen.body?.timer, again: seenAgain.body?.changed }));
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
        await focusUp('restart');
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
        await focusUp('start after the end');
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
        check('the words the window shows name no path',
            wrong.problems[0].endsWith('Focus keeps its timer in its default folder (focus in DSH\'s data folder).') && !wrong.problems[0].includes(run.home) && !/\/(Users|home|var|tmp|private)\//.test(wrong.problems[0]), json(wrong.problems));
        check('DSH\'s log names the folder in use', run.logText().includes(`its folder: ${focusDir}`), run.logText().split('\n').filter((l) => /focus/.test(l)).slice(-6).join('\n'));
        check('focus.log says the setting', /setting: dataDir must be a full path/.test(read(logFile)), read(logFile).slice(-400));
        const own = join(run.root, 'focus-own');
        focusRow({ dataDir: own });
        await waitFor(async () => existsSync(join(own, 'state.json')) && (await focus()).body?.rev === 0, 'the timer served from the configured folder', 30000, 400);
        const good = (await focus()).body;
        check('a full dataDir: the timer lives there (a first start of its own), no problems', json(good.problems) === '[]' && good.rev === 0 && existsSync(join(own, 'focus.log')), json(good));
        focusRow(null);
        await waitFor(async () => (await focus()).body?.rev >= rev && rev > 0, 'the default folder back', 30000, 400);
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
            window.__acMade = 0;
            window.AudioContext = class {
                constructor() { window.__acMade += 1; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
                createOscillator() { const o = { type: '', frequency: { value: 0 }, connect() {}, start() { window.__chimes.push(o.frequency.value); }, stop() {} }; return o; }
                createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
                resume() { return Promise.resolve(); }
                close() { return Promise.resolve(); }
            };
        };
        /** DSH's toast (role alert) that says `words`, and a button in it. */
        const toastOf = (page, words) => page.getByRole('alert').filter({ hasText: words });
        const toastButton = (page, words, name) => toastOf(page, words).getByRole('button', { name, exact: true });
        /** The footer button's mark and name, and the host's doneSeen. */
        const markOf = async (page) => ({ mark: await page.locator('[data-focus-open]').getAttribute('data-focus-mark', { timeout: 2000 }).catch(() => null), label: await page.locator('[data-focus-open]').getAttribute('aria-label', { timeout: 2000 }).catch(() => null) });
        const shortcut = (page) => page.keyboard.press('Meta+Alt+Shift+KeyF');
        await step('the window: the footer button, DSH\'s dialog and every control', async () => {
            window = await openWindow(run, pw, { width: 1280, height: 860 });
            const { page } = window;
            page.on('request', (r) => requests.push(r.url()));
            // The chime's stand-in from the page's first script on, so no click can make a real one first.
            await page.addInitScript(chimeStub);
            await page.reload({ waitUntil: 'domcontentloaded' });
            const button = page.locator('[data-focus-open]');
            await button.waitFor({ state: 'visible', timeout: 30000 });
            await page.waitForTimeout(1500);
            check('no AudioContext before a click: nothing can sound on page load', (await page.evaluate(() => window.__acMade)) === 0, String(await page.evaluate(() => window.__acMade)));
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
            check('the first click makes one AudioContext, for the chime', (await page.evaluate(() => window.__acMade)) === 1, String(await page.evaluate(() => window.__acMade)));
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
            const resumed = (await focus()).body.timer;
            check('Resume: running again from there', resumed.endAt - Date.now() <= paused.remainingMs + 500);
            check('focus.log says when the resumed timer ends', new RegExp(`resume focus at \\d+s left, ends ${new Date(resumed.endAt).toISOString().replace(/\./g, '\\.')}`).test(read(logFile)), read(logFile).slice(-300));
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'running', 'running again', 10000, 200);
            await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'ready', 'reset', 10000, 200);
            check('Reset: ready at the full length', (await panel.locator('[data-focus-time]').textContent()) === '25:00' && (await focus()).body.timer.running === false);
            const undoRow = panel.locator('[data-focus-undo]');
            const undo = undoRow.getByRole('button', { name: 'Undo', exact: true });
            const offered = await undo.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
            check('a Reset of a started timer: the panel says it, with Undo under its state line, and no toast covers the dialog',
                offered && (await undoRow.textContent()).startsWith('Focus session reset.') && (await page.getByRole('alert').filter({ hasText: 'reset' }).count()) === 0, (await panel.textContent()).slice(0, 200));
            await shot(page, shots, 'reset-undo-light');
            if (offered) await undo.click();
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'running', 'undone', 10000, 200).catch(() => {});
            const undone = (await focus()).body.timer;
            check('Undo: running again, to the same end; the Undo row goes', undone.running === true && undone.endAt === resumed.endAt && (await undoRow.count()) === 0, json({ before: resumed.endAt, after: undone.endAt }));
            check('focus.log says the Reset and the Undo', /reset focus to 1500s \(it was running with \d+s left; Undo can bring it back for 60s\)/.test(read(logFile)) && /undo reset: focus running again, ends /.test(read(logFile)), read(logFile).slice(-500));
            await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'ready', 'reset again', 10000, 200);

            // Lengths: a preset, a custom one, one out of range.
            await preset.click();
            await waitFor(async () => (await focus()).body.timer.kind === 'short', 'the short break', 10000, 200);
            // The host changes before its answer reaches the window: give the panel a moment to take it.
            const pressed = await settles(async () => (await panel.locator('[data-focus-time]').textContent()) === '5:00' && (await preset.getAttribute('aria-pressed')) === 'true');
            check('a preset: the host sets it, the panel shows it pressed', pressed, pressed ? '' : `${await panel.locator('[data-focus-time]').textContent()} pressed=${await preset.getAttribute('aria-pressed')}`);
            const custom = dialog.getByLabel('Custom length in minutes');
            const named = await panel.locator('label.fc-custom-field').filter({ has: page.locator('[data-focus-custom]') }).locator('.fc-custom-name').textContent().catch(() => null);
            check('the custom field has its name beside it, in its label: Custom', named === 'Custom' && (await panel.locator('.fc-custom-name').isVisible()), String(named));
            await custom.fill('500');
            check('a custom length out of range: Set is off and the panel says the range', (await dialog.getByRole('button', { name: 'Set', exact: true }).isDisabled()) && (await panel.getByText('From 1 to 180 minutes.').count()) === 1);
            await custom.fill('2');
            await dialog.getByRole('button', { name: 'Set', exact: true }).click();
            await waitFor(async () => (await focus()).body.timer.kind === 'custom', 'the custom length', 10000, 200);
            const two = await settles(async () => (await panel.locator('[data-focus-time]').textContent()) === '2:00');
            check('a custom length: 2 min', (await focus()).body.timer.durationMs === 120000 && two, two ? '' : await panel.locator('[data-focus-time]').textContent());

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
            const said = await settles(async () => (await dialog.getByRole('button', { name: 'Short break 7 min', exact: true }).count()) === 1);
            check('a preset length, typed: kept at the host, the preset button says it', said, said ? '' : (await panel.locator('[data-focus-preset]').allTextContents()).join(' | '));
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

        await step('the end, said once: a toast with the next step and the chime in each window, one session counted for two windows; the mark until a panel shows it', async () => {
            const { page } = window;
            second = await window.context.newPage();
            second.on('request', (r) => requests.push(r.url()));
            await second.addInitScript(chimeStub);
            await second.goto((await run.signIn()).link, { waitUntil: 'domcontentloaded' });
            await second.locator('[data-focus-open]').waitFor({ state: 'visible', timeout: 60000 });
            await dismissNotices(second);
            await second.locator('[data-focus-open]').click(); // a first click: the chime may sound from now on
            await second.keyboard.press('Escape');
            await page.bringToFront();
            if (await page.locator('[data-focus-panel]').isVisible().catch(() => false)) await page.keyboard.press('Escape');
            await page.evaluate(() => { window.__chimes = []; });
            const before = (await focus()).body.sessions.focus;
            const mark = read(logFile).length;
            const started = await op({ op: 'start', kind: 'focus', durationMs: 10000 });
            check('a 10 s focus, started at the host', started.status === 200, started.text);
            const words = 'Focus session done. Time for a break.';
            await toastOf(page, words).first().waitFor({ state: 'visible', timeout: 25000 });
            const shownAt = Date.now();
            await second.bringToFront();
            await toastOf(second, words).first().waitFor({ state: 'visible', timeout: 15000 });
            await page.bringToFront();
            check('both windows say the end, in DSH\'s toast', true);
            // The pomodoro's next step: a short break, a long one after every fourth focus session today.
            const fourth = (before + 1) % 4 === 0;
            const nextLabel = fourth ? 'Start long break' : 'Start short break';
            check(`the toast offers the next step: ${nextLabel}`, (await toastButton(page, words, nextLabel).count()) === 1 && (await toastButton(second, words, nextLabel).count()) === 1,
                (await page.getByRole('alert').allTextContents()).join(' | '));
            check('the chime sounded in each window, two notes', json(await page.evaluate(() => window.__chimes)) === '[659.25,987.77]' && json(await second.evaluate(() => window.__chimes)) === '[659.25,987.77]',
                json([await page.evaluate(() => window.__chimes), await second.evaluate(() => window.__chimes)]));
            await shot(page, shots, 'done-toast-light');
            const marks = [await markOf(page), await markOf(second)];
            const marked = (m) => m.mark === 'ended' && /^Focus timer: Focus session done at \d{1,2}:\d{2}\s?[AP]M$/.test(m.label ?? '');
            check('with no panel open, both footer buttons carry the done mark and say what ended', marks.every(marked) && (await focus()).body.timer.doneSeen === false, json(marks));
            // The toast is held 12 s (DSH's own default is 3 s): still there at 8 s, gone after its hold.
            const toastLook = () => page.evaluate((w) => { const t = [...document.querySelectorAll('[role="alert"]')].find((e) => e.textContent.includes(w)); return t ? { hold: t.style.getPropertyValue('--dsh-toast-hold'), opacity: Number(getComputedStyle(t).opacity) } : null; }, words);
            await page.waitForTimeout(Math.max(0, shownAt + 8000 - Date.now()));
            const at8 = await toastLook();
            check('the end\'s toast is held 12 s: still showing at 8 s', at8?.hold === '12000ms' && at8.opacity > 0.9, json(at8));
            await waitFor(async () => (await toastLook()) === null, 'the toast to go', 12000, 250);
            const after = await markOf(page);
            check('after the toast has gone, the footer button still says what ended', marked(after), json(after));
            await footShot(page, 'footer-done-light');
            await setDark(page, true);
            await footShot(page, 'footer-done-dark');
            await setDark(page, false);
            const counted = (await focus()).body;
            check('two windows, one session counted', counted.sessions.focus === before + 1 && completesIn(mark) === 1, json({ before, after: counted.sessions, log: read(logFile).slice(mark) }));

            // A panel shows it: seen at the host, the mark goes in both windows.
            await page.locator('[data-focus-open]').click();
            await page.locator('[data-focus-panel]').waitFor({ state: 'visible' });
            await waitFor(async () => (await focus()).body.timer.doneSeen === true, 'seen at the host', 10000, 200).catch(() => {});
            check('the open panel tells the host it was seen (logged once)', (await focus()).body.timer.doneSeen === true && (read(logFile).slice(mark).match(/ seen: the end of focus /g) ?? []).length === 1, read(logFile).slice(mark));
            const plain = await settles(async () => (await markOf(page)).mark === 'done' && (await markOf(page)).label === 'Focus timer');
            await second.bringToFront();
            const plainToo = await settles(async () => (await markOf(second)).mark === 'done' && (await markOf(second)).label === 'Focus timer', 8000);
            await page.bringToFront();
            check('the mark goes in this window at once, and in the other within a read', plain && plainToo, json([await markOf(page), await markOf(second)]));
            check('the panel says it is done, and the new count', /^Focus · done at /.test(await page.locator('[data-focus-state]').textContent())
                && (await page.locator('[data-focus-sessions]').textContent()) === `${counted.sessions.focus} focus sessions today`, await page.locator('[data-focus-state]').textContent());
            const face = [await page.locator('[data-focus-time]').textContent(), await page.locator('[data-focus-next]').textContent().catch(() => null)];
            const nextFace = fourth ? ['15:00', 'Long break next'] : ['5:00', 'Short break next'];
            check(`the done clock shows the next step and names it: ${nextFace.join(', ')}`, json(face) === json(nextFace), json(face));
            await shot(page, shots, 'panel-done-light');
            await second.close();
            second = undefined;
        }, async () => {
            if (window?.page) await shot(window.page, shots, 'failed-end');
        });

        await step('live data: a change made elsewhere shows within a poll; an end with the panel open is said in the panel; a read that fails is said, and Try again', async () => {
            const { page } = window;
            const stateLine = page.locator('[data-focus-state]');
            // An end while the panel is open: the panel says it and the chime sounds; no toast covers the dialog.
            await page.evaluate(() => { window.__chimes = []; });
            await op({ op: 'start', kind: 'custom', durationMs: 10000 });
            await waitFor(async () => (await stateLine.getAttribute('data-focus-state')) === 'done', 'the end in the open panel', 25000, 200).catch(() => {});
            await page.waitForTimeout(800);
            const inPanel = [await stateLine.textContent(), await page.locator('[data-focus-primary]').textContent()];
            check('an end with the panel open: the panel says it, with the next step, and chimes; no toast over the dialog',
                /^Custom · done at \d{1,2}:\d{2}\s?[AP]M$/.test(inPanel[0]) && inPanel[1] === 'Start again' && json(await page.evaluate(() => window.__chimes)) === '[659.25,987.77]'
                && (await page.getByRole('alert').filter({ hasText: 'Timer done' }).count()) === 0, json({ inPanel, chimes: await page.evaluate(() => window.__chimes), alerts: await page.getByRole('alert').allTextContents() }));
            await op({ op: 'set', kind: 'long', durationMs: 900000 });
            await waitFor(async () => (await page.locator('[data-focus-time]').textContent()) === '15:00', 'the change from elsewhere', 12000, 300);
            check('a length set elsewhere shows in the open panel within a poll', (await stateLine.textContent()) === 'Long break · ready, 15:00', await stateLine.textContent());
            await page.route('**/api/focus/state', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"a stand-in failure"}' }));
            await page.locator('[data-focus-stale]').waitFor({ state: 'visible', timeout: 12000 });
            check('a read that fails: the panel says so, and that it tries again', /a stand-in failure.*tries again every few seconds/.test(await page.locator('[data-focus-stale]').textContent()), await page.locator('[data-focus-stale]').textContent());
            await page.locator('[data-focus-primary]').click();
            const note = page.locator('[data-focus-panel] [data-focus-note]');
            const noted = await note.waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
            check('an op that fails: the open panel says nothing changed, and why (no toast over the dialog)', noted && (await note.textContent()) === 'Not changed: a stand-in failure' && (await note.getAttribute('role')) === 'alert'
                && (await page.getByRole('alert').filter({ hasText: 'Not changed' }).count()) === 1, noted ? await note.textContent() : (await page.getByRole('alert').allTextContents()).join(' | '));
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

        await step('a hidden window chimes at the end and says it when shown again, with its time; its toast starts the next step', async () => {
            const { page } = window;
            if (await page.locator('[data-focus-panel]').isVisible().catch(() => false)) await page.keyboard.press('Escape');
            await page.evaluate(() => { window.__chimes = []; });
            const started = await op({ op: 'start', kind: 'focus', durationMs: 12000 });
            await waitFor(async () => (await markOf(page)).mark === 'running', 'the window to know it runs', 12000, 200);
            // Hidden as a minimized or covered window is: the page says so and tells it (headless pages stay visible).
            const visibility = (hidden) => page.evaluate((h) => {
                if (h) Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
                else delete document.visibilityState;
                document.dispatchEvent(new Event('visibilitychange'));
            }, hidden);
            await visibility(true);
            await waitFor(async () => (await focus()).body.timer.running === false, 'the end', 30000, 300);
            await page.waitForTimeout(2500); // the window's tick at zero, and its answer
            const late = /Focus session done at \d{1,2}:\d{2}\s?[AP]M\. Time for a break\./;
            const saidWhileHidden = await page.getByRole('alert').filter({ hasText: /Focus session done/ }).count();
            check('hidden at the end: nothing said while hidden', saidWhileHidden === 0, (await page.getByRole('alert').allTextContents()).join(' | '));
            check('hidden at the end: the chime sounded (it is heard, not seen)', json(await page.evaluate(() => window.__chimes)) === '[659.25,987.77]', json(await page.evaluate(() => window.__chimes)));
            check('hidden at the end: the footer button carries the mark', (await markOf(page)).mark === 'ended', json(await markOf(page)));
            await visibility(false);
            const toast = page.getByRole('alert').filter({ hasText: late });
            const said = await toast.first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
            check('shown again: the end is said, with the time it ended', said && (await focus()).body.timer.doneAt === started.body?.timer?.endAt, (await page.getByRole('alert').allTextContents()).join(' | '));
            check('shown again: no second chime', json(await page.evaluate(() => window.__chimes)) === '[659.25,987.77]', json(await page.evaluate(() => window.__chimes)));
            await shot(page, shots, 'late-toast-light');
            const fourth = (await focus()).body.sessions.focus % 4 === 0;
            const [label, kind, ms] = fourth ? ['Start long break', 'long', 900000] : ['Start short break', 'short', 300000];
            const next = toast.getByRole('button', { name: label, exact: true });
            if (said) await next.click();
            await waitFor(async () => (await focus()).body.timer.running === true, 'the next step', 10000, 200).catch(() => {});
            const now = (await focus()).body.timer;
            check(`the toast's button starts the next step: ${label}`, now.running === true && now.kind === kind && now.durationMs === ms, json(now));
            const gone = await settles(async () => (await toast.count()) === 0, 3000);
            check('the toast goes with its click', gone);
            await op({ op: 'reset' });
            await op({ op: 'set', kind: 'focus', durationMs: 1500000 });
        }, async () => {
            if (window?.page) {
                await window.page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); }).catch(() => {});
                await shot(window.page, shots, 'failed-hidden');
            }
        });

        // The visible width of each button in DSH's footer outlet: its box cut by every ancestor that clips it.
        const footerRow = (page) => page.evaluate(() => {
            const outlet = document.querySelector('[data-slot="sidebar.footer.action"]');
            const shown = (el) => {
                const r = el.getBoundingClientRect();
                let left = r.left;
                let right = r.right;
                for (let p = el.parentElement; p; p = p.parentElement) {
                    const cs = getComputedStyle(p);
                    if (cs.overflowX !== 'visible' || cs.overflow !== 'visible') { const pr = p.getBoundingClientRect(); left = Math.max(left, pr.left); right = Math.min(right, pr.right); }
                }
                return Math.max(0, Math.round(right - left));
            };
            const buttons = outlet ? [...outlet.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0) : [];
            return {
                seat: document.querySelector('[data-focus-seat]')?.getAttribute('data-focus-seat') ?? null,
                buttons: buttons.map((b) => ({ name: b.getAttribute('aria-label') || b.textContent.trim().slice(0, 30), focus: b.hasAttribute('data-focus-open'), width: Math.round(b.getBoundingClientRect().width), shown: shown(b) })),
            };
        });
        const railShot = async (page, name) => {
            if (!shots) return;
            const box = await page.evaluate(() => {
                let p = document.querySelector('[data-slot="sidebar.footer.action"]')?.parentElement;
                while (p && p.getBoundingClientRect().width === 0) p = p.parentElement;
                const r = p?.getBoundingClientRect();
                return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
            });
            if (!box) return;
            mkdirSync(shots, { recursive: true });
            await page.waitForTimeout(400);
            const size = page.viewportSize();
            const x = Math.max(0, Math.floor(box.x - 24));
            const y = Math.max(0, Math.floor(box.y - 140));
            await page.screenshot({ path: join(shots, `${name}.png`), clip: { x, y, width: Math.min(size.width - x, Math.ceil(box.w) + 260), height: Math.min(size.height - y, Math.ceil(box.h) + 170) } });
        };

        await step('DSH\'s 760 px rail: Focus gives its seat to Wallpaper\'s footer button and opens with the shortcut; alone it is in the rail and opens with a click', async () => {
            const { page } = window;
            await page.setViewportSize({ width: 760, height: 860 });
            await page.waitForTimeout(800);
            const panel = page.locator('[data-focus-panel]');
            const whole = (b) => b.shown >= b.width && b.width >= 28;
            if (withWallpaper) {
                await settles(async () => (await footerRow(page)).seat === 'given');
                const row = await footerRow(page);
                check('with Wallpaper on: Focus gives its seat, and the footer button before it is whole', row.seat === 'given' && row.buttons.length >= 1 && !row.buttons.some((b) => b.focus) && row.buttons.every(whole), json(row));
                await railShot(page, 'rail-760-wallpaper-light');
                await shortcut(page);
                const opened = await panel.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
                check('the shortcut (⇧⌥⌘F) opens the panel there', opened);
                if (opened) { await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden', timeout: 10000 }); }
                const off = await run.api('pluginManager/setBundleEnabled', { name: 'dsh-plugin-wallpaper', enabled: false });
                check('Wallpaper switched off in Plugins', off.ok === true, json(off));
                await settles(async () => (await footerRow(page)).seat === 'kept', 20000);
            }
            const alone = await footerRow(page);
            const mine = alone.buttons.find((b) => b.focus);
            check(withWallpaper ? 'Wallpaper off: Focus\'s button is back in the rail, whole' : 'alone in the rail: Focus\'s button is whole', alone.seat === 'kept' && Boolean(mine) && whole(mine), json(alone));
            await railShot(page, 'rail-760-plain-light');
            await page.locator('[data-focus-open]').click();
            const clicked = await panel.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
            check('a click on it in the rail opens the panel', clicked);
            if (clicked) { await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden', timeout: 10000 }); }
            if (withWallpaper) {
                const on = await run.api('pluginManager/setBundleEnabled', { name: 'dsh-plugin-wallpaper', enabled: true });
                await waitFor(() => page.evaluate(() => document.body.classList.contains('wp-on')), 'Wallpaper on again', 20000, 300).catch(() => {});
                const again = await settles(async () => (await footerRow(page)).seat === 'given', 20000);
                const row = await footerRow(page);
                check('Wallpaper on again: Focus gives way again, the neighbour whole', on.ok === true && again && row.buttons.every(whole) && !row.buttons.some((b) => b.focus), json(row));
            }
            await page.setViewportSize({ width: 1280, height: 860 });
            const wide = await settles(async () => (await footerRow(page)).buttons.some((b) => b.focus));
            check('wide again: Focus\'s button is back beside its neighbour', wide, json(await footerRow(page)));
        }, async () => {
            if (window?.page) { await shot(window.page, shots, 'failed-rail'); await window.page.setViewportSize({ width: 1280, height: 860 }).catch(() => {}); }
        });

        await step('pictures: light and dark, wide and 760 px, Wallpaper on and off; the panel fits at 760 px', async () => {
            const { page } = window;
            await op({ op: 'start', kind: 'focus', durationMs: 1500000 });
            const open = async () => {
                if (!(await page.locator('[data-focus-panel]').isVisible().catch(() => false))) {
                    await page.waitForTimeout(600);
                    // In the folded rail with Wallpaper's button before it, Focus gave its seat: the shortcut opens it.
                    if (await page.locator('[data-focus-open]').isVisible().catch(() => false)) await page.locator('[data-focus-open]').click();
                    else await shortcut(page);
                }
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
            await page.waitForTimeout(500);
            await shortcut(page);
            const opened = await page.locator('[data-focus-panel]').waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false);
            check('on again: the shortcut opens the panel (registered again, once)', opened);
            if (opened) await page.keyboard.press('Escape');
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
