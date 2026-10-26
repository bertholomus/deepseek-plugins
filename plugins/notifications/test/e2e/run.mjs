#!/usr/bin/env node
/**
 * Notifications in a real DSH: a plugin's news through the notifications
 * service, shown by a real DSH window, with every outcome proven in the
 * plugin's log file and on its settings page.
 *
 * DSH runs from a throwaway DSH_HOME (test/e2e/harness.mjs) with the
 * session bridge, the notifications plugin and a stand-in caller
 * (test/e2e/caller) that calls the service exactly as the coordinator,
 * Decisions and Fleet do. The window is a real Chromium on DSH's web
 * profile, with the Web Notifications API replaced by a recorder that
 * fires the system's show event: nothing reaches this computer's screen,
 * and the test reads what the sender would have shown.
 *
 * - The browser half is served and parses; the endpoints answer over DSH's
 *   gateway (the 404 that once sent every notification to the wrong app).
 * - No window yet: on macOS nothing is sent (no command sender), and the
 *   log says why; the plugin's state file is 700/600 in DSH's data folder.
 * - A window in the background: the news shows with its title and body,
 *   the window reports the system's show event, and the log and the page
 *   say "shown"; a click brings the window up and opens the chat the news
 *   is about.
 * - A window you are looking at: nothing shows, and the page says why.
 * - Five at once: the newest two alone and one summary of the rest.
 * - The settings page in Plugins (DSH's own form): where notifications go,
 *   this window's permission, the recent list with Open chat, a kind
 *   switched off and saved (the next one of that kind is "off", in words),
 *   the test button; light and dark pictures, a 760 px window, keyboard
 *   focus on its controls.
 * - A browser that has not answered the permission ask: news waits, the
 *   Allow button asks, focus stays on the row, and the news then shows.
 * - A restart with news waiting: after it the news shows once, and a
 *   reload does not show it again.
 * - Switched off and on from Plugins: callers get nothing while off, its
 *   style sheet leaves the window, and on again it works with one sheet.
 * - A wrong setting in the profile: the plugin still starts and works, the
 *   log warns, and the page names the setting.
 *
 *   DSH_BIN=/path/to/@deepseek-ai/dsh/lib/bin.js node plugins/notifications/test/e2e/run.mjs
 *
 * Without DSH_BIN it runs the newest DSH under .e2e/; `node scripts/e2e.mjs
 * notifications` runs it on each of those and on the installed app's own
 * DSH. SHOTS=<folder> keeps the window's pictures there (default
 * .e2e/shots/notifications/<version>); KEEP=1 keeps the throwaway DSH_HOME.
 * Without Playwright the run fails, unless NO_WINDOW=1 says to run without
 * the window checks.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Script } from 'node:vm';
import { DshRun, checks, dismissNotices, dshBin, findPlaywright, freePort, launchChromium, pluginsDir, repoRoot, setDark, shot, sleep, waitFor } from '../../../../test/e2e/harness.mjs';
import { startFakeModel } from '../../../../test/e2e/fake-model.mjs';

const bin = dshBin();
if (!bin) {
    console.log('skipped: no DSH to run (set DSH_BIN, or install one under .e2e/dsh-<version>)');
    process.exit(0);
}
const version = process.env.DSH_LABEL || (/dsh-([^/]+)\/node_modules/.exec(bin)?.[1] ?? basename(dirname(dirname(bin))));
const shots = process.env.SHOTS || join(repoRoot, '.e2e', 'shots', 'notifications', version);
console.log(`# DSH ${version}: ${bin}`);
console.log(`# pictures: ${shots}`);

const tally = checks();
const { check, step } = tally;
const json = (value) => JSON.stringify(value);
const model = await startFakeModel();
const here = dirname(new URL(import.meta.url).pathname);
const BUNDLE = 'dsh-plugin-notifications';
/** The app's own DSH runs under the app's binary as Node (scripts/e2e.mjs runs this test under it too). */
const desktopApp = process.versions.electron !== undefined;

/** The notifications row's settings in the profile (restated whole, as a patch row replaces its config). */
const rowsWith = (config = {}) => (Object.keys(config).length === 0 ? '' : `- id: notifications
  config:
${Object.entries(config).map(([key, value]) => `    ${key}: ${JSON.stringify(value)}`).join('\n')}
`);

const run = new DshRun({
    label: 'notifications',
    bin,
    port: await freePort(),
    plugins: {
        'dsh-plugin-session-bridge': join(pluginsDir, 'session-bridge'),
        [BUNDLE]: join(pluginsDir, 'notifications'),
        'dsh-plugin-notifications-e2e-caller': join(here, 'caller'),
    },
});
const stateFile = join(run.home, 'notifications', 'state.json');
const api = (method, args = {}) => run.api(`${BUNDLE}/${method}`, args);
/** A notification through the stand-in caller, as another plugin sends one: what the service answered. */
const notify = async (notification) => {
    const result = await run.api('dsh-plugin-notifications-e2e-caller/notify', { notification });
    return result.ok ? result.value : `error: ${json(result.error)}`;
};
const status = async () => {
    const result = await api('status');
    if (!result.ok) throw new Error(`status: ${json(result.error)}`);
    return result.value;
};
const entryOf = async (title) => (await status()).recent.find((item) => item.title === title);
/** The plugin's log lines, from its own file (DSH 0.2 writes no plugin's log lines out), each without its time: `info #12 …`. */
const logFile = () => join(run.home, 'notifications', 'notifications.log');
const logLines = () => (existsSync(logFile()) ? readFileSync(logFile(), 'utf8') : '').split('\n').filter(Boolean).map((line) => line.replace(/^\S+ /, ''));

/**
 * The window's Web Notifications, replaced by a recorder: each one is kept
 * in `window.__notes` (title, body, tag, and its click), and the system's
 * show event fires 50 ms later. `window.__watching` says whether the person
 * looks at the window (document.hasFocus); `startPermission` is the
 * browser's answer so far, `askAnswer` what the ask resolves to.
 */
const fakeNotifications = ({ startPermission = 'granted', askAnswer = 'granted' } = {}) => `
(() => {
    window.__notes = [];
    window.__watching = false;
    class RecordedNotification {
        constructor(title, options = {}) {
            this.title = title;
            this.body = options.body;
            this.tag = options.tag;
            window.__notes.push(this);
            setTimeout(() => { try { this.onshow && this.onshow(); } catch (e) {} }, 50);
        }
        close() { this.closed = true; }
        static requestPermission() {
            RecordedNotification.permission = ${JSON.stringify(askAnswer)};
            return Promise.resolve(RecordedNotification.permission);
        }
    }
    RecordedNotification.permission = ${JSON.stringify(startPermission)};
    Object.defineProperty(window, 'Notification', { value: RecordedNotification, configurable: true, writable: true });
    Document.prototype.hasFocus = function () { return Boolean(window.__watching); };
})();`;

/**
 * A signed-in window whose Web Notifications are the recorder from its first
 * script on, so no news is taken before the recorder is there.
 */
async function openFakeWindow(pw, { width = 1280, height = 860, fake = {} } = {}) {
    const web = await run.signIn();
    const browser = await launchChromium(pw);
    const context = await browser.newContext({ viewport: { width, height }, locale: 'en-US', colorScheme: 'light', timezoneId: 'America/Los_Angeles' });
    await context.addInitScript({ content: fakeNotifications(fake) });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(web.link, { waitUntil: 'domcontentloaded' });
    // DSH's first-run notices, out of the way (they can come seconds late).
    const end = Date.now() + 30000;
    let calm = Date.now();
    while (Date.now() < end && Date.now() - calm < 4000) {
        if (await dismissNotices(page)) calm = Date.now();
        await page.waitForTimeout(400);
    }
    return { browser, context, page, errors };
}

const notes = (page) => page.evaluate(() => window.__notes.map((n) => ({ title: n.title, body: n.body, tag: n.tag, closed: Boolean(n.closed) })));
/** Make the window look at its queue now (it polls every 15 s, and at once on focus or blur). */
const poke = (page) => page.evaluate(() => window.dispatchEvent(new Event('blur')));

/** Open DSH's Plugins page at the notifications plugin's settings, as a person does: Plugins, then its card. */
async function openSettings(page) {
    const form = page.locator('[data-notifications-settings]');
    if (await form.isVisible().catch(() => false)) return form;
    const entry = page.getByRole('button', { name: 'Plugins', exact: true });
    if (await entry.count()) await entry.first().click();
    else await page.getByText('Plugins', { exact: true }).first().click();
    // The card's title is DSH's "View <name>" button.
    const card = page.getByRole('button', { name: 'View Notifications', exact: true });
    await card.waitFor({ state: 'visible', timeout: 20000 });
    await card.click();
    await form.waitFor({ state: 'visible', timeout: 20000 });
    return form;
}

/** Quit DSH and start it again with the profile as it is. */
async function restart(what, rows) {
    await run.stop();
    if (rows !== undefined) {
        run.rows = rows;
        run.writeProfile(model.port);
    }
    await run.boot(what);
    await waitFor(async () => (await api('status')).ok, `the notifications endpoints (${what})`, 60000, 300);
}

let window;
try {
    run.writeProfile(model.port);
    await run.boot('first start');
    await waitFor(async () => (await api('status')).ok, 'the notifications endpoints', 60000, 300);

    // ── Served, and its endpoints answer ───────────────────────────────
    await step('the browser half is served and parses; the endpoints answer over DSH\'s gateway', async () => {
        const client = await run.clientOf(BUNDLE);
        let parses = false;
        try {
            new Script(client.text);
            parses = true;
        } catch {}
        check('DSH serves the browser half, and it parses', client.status === 200 && parses && client.text.includes('dsh-plugin-notifications'), `${client.status} ${client.url}`);
        const s = await status();
        check('status answers before any window: no window has checked in', s.windowSeenAt === '' && s.enabled === true && Array.isArray(s.recent) && s.recent.length === 0 && s.problems.length === 0, json(s));
        const unknown = await api('nope');
        check('a method it does not have is refused, not served', unknown.ok === false, json(unknown));
        // The app's own DSH runs under the app's binary (Electron as Node), as it does inside the app: the plugin takes it for the Desktop app.
        const expected = desktopApp ? /^info started \(on; the Desktop app; sender now: window\)/ : /^info started \(on; no Desktop app; sender now: (none|command)\)/;
        check(`the log says it started, and where notifications go (${desktopApp ? 'the Desktop app\'s DSH' : 'a DSH in a terminal'})`, logLines().some((line) => expected.test(line)), logLines().join('\n'));
    });

    // ── No window: on macOS nothing is sent, in words ──────────────────
    await step('with no window, nothing is sent where no sender shows DSH\'s icon, and the log says why', async () => {
        const sent = await notify({ title: 'No window yet', body: 'B', kind: 'handback' });
        const entry = await entryOf('No window yet');
        if (desktopApp) {
            // The Desktop app's window is there even while hidden, so the news waits for it (and shows when it looks).
            check('the Desktop app\'s DSH: the news waits for the app\'s window, and the list says so', sent === 'browser' && entry?.state === 'waiting' && entry.detail === 'Waiting for DSH\'s window to show it.', json({ sent, entry }));
        } else if (process.platform === 'darwin') {
            check('macOS: the caller is told none, nothing is spawned, and the reason is listed', sent === 'none' && entry?.state === 'not shown' && entry.detail === 'No DSH window was open to show it, and macOS has no other sender that shows DSH\'s icon.', json({ sent, entry }));
        } else {
            check('a command sender takes it where the system has one', ['cli', 'none'].includes(sent) && Boolean(entry), json({ sent, entry }));
        }
        check('the log has the line, with its id and kind', logLines().some((line) => line.includes(`#${entry?.id} (handback) “No window yet”`)), logLines().slice(-5).join('\n'));
        check('its state is kept in DSH\'s data folder, the folder 700 and the file 600', existsSync(stateFile) && (statSync(dirname(stateFile)).mode & 0o777) === 0o700 && (statSync(stateFile).mode & 0o777) === 0o600, stateFile);
    });

    const pw = await findPlaywright();
    if (!pw && process.env.NO_WINDOW !== '1') throw new Error('Playwright is not installed: install it under .e2e/tools, or set NO_WINDOW=1');
    const sessionText = 'Notifications e2e: the chat a notification opens. E2E:say Done, and the chat says so.';
    let sessionId;
    if (pw) {
        sessionId = await run.newSession(sessionText, 'Fix the flaky upload test');
        await waitFor(async () => (await run.session(sessionId))?.status === 'idle', 'the session to finish its turn', 120000, 500).catch(() => {});

        // ── A window in the background ─────────────────────────────────
        window = await openFakeWindow(pw);
        await waitFor(async () => (await status()).sender === 'window', 'the window to check in', 60000, 300);
        await step('a window in the background shows the news, reports the system\'s show event, and a click opens its chat', async () => {
            const { page } = window;
            const sent = await notify({ title: '“Fix the flaky upload test” handed back', body: 'Ready for review', kind: 'handback', sessionId });
            check('the caller is told it is queued for DSH\'s window', sent === 'browser', sent);
            await poke(page);
            const shown = await waitFor(async () => (await notes(page)).find((n) => n.title === '“Fix the flaky upload test” handed back'), 'the window to show it', 30000, 300);
            check('the window shows it with its title and body, tagged with its id', shown.body === 'Ready for review' && /^dsh-plugin-notifications:[\w-]+:\d+$/.test(shown.tag ?? ''), json(shown));
            const entry = await waitFor(async () => {
                const found = await entryOf('“Fix the flaky upload test” handed back');
                return found?.state === 'shown' ? found : undefined;
            }, 'the window to report it shown', 20000, 300);
            check('the host lists it as shown, on the system\'s word', entry.detail === 'Shown on screen by DSH\'s window (the system reported it).' && entry.sessionId === sessionId, json(entry));
            check('the log says shown, by its id', logLines().some((line) => line === `info #${entry.id} shown: Shown on screen by DSH's window (the system reported it).`), logLines().slice(-6).join('\n'));
            // The person clicks it: DSH's window comes up with that chat open.
            await page.evaluate(() => window.__notes.at(-1).onclick());
            await page.getByText('Notifications e2e: the chat a notification opens.', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
            check('a click opens the chat the news is about, and closes the notification', (await notes(page)).at(-1).closed === true, json(await notes(page)));
            await shot(page, shots, 'chat-opened-light');
        }, async () => { if (window?.page) await shot(window.page, shots, 'failed-background'); });

        await step('a window you are looking at shows nothing, and says why', async () => {
            const { page } = window;
            await page.evaluate(() => { window.__watching = true; });
            const before = (await notes(page)).length;
            check('the caller is told it is queued', (await notify({ title: 'While you look', kind: 'approval' })) === 'browser');
            await poke(page);
            const entry = await waitFor(async () => {
                const found = await entryOf('While you look');
                return found?.state === 'not shown' ? found : undefined;
            }, 'the window to take it', 20000, 300);
            check('nothing shows, and the list says you were looking', (await notes(page)).length === before && entry.detail === 'You were looking at DSH, so no notification was needed.', json(entry));
            await page.evaluate(() => { window.__watching = false; });
        });

        await step('five at once: the newest two alone and one summary of the rest, each listed', async () => {
            const { page } = window;
            const before = (await notes(page)).length;
            for (const n of [1, 2, 3, 4, 5]) await notify({ title: `Burst ${n}`, kind: 'finished' });
            await poke(page);
            const made = await waitFor(async () => {
                const all = (await notes(page)).slice(before);
                return all.length >= 3 ? all : undefined;
            }, 'the burst to show', 30000, 300);
            await sleep(500);
            check('three notifications: Burst 4, Burst 5 and a summary of three', json(made.map((n) => n.title)) === json(['Burst 4', 'Burst 5', 'DSH: 3 more updates']) && made[2].body === 'Burst 1 · Burst 2 · Burst 3', json(made));
            const s = await waitFor(async () => {
                const now = await status();
                const burst = now.recent.filter((item) => item.title.startsWith('Burst '));
                return burst.length === 5 && burst.every((item) => item.state === 'shown') ? now : undefined;
            }, 'the burst to be reported', 20000, 300);
            const words = s.recent.filter((item) => item.title.startsWith('Burst ')).map((item) => `${item.title}: ${item.detail}`);
            check('each is listed shown, the three in one notification', words.filter((w) => w.endsWith('in one notification with others that came at once.')).length === 3, words.join('\n'));
        });

        // ── The settings page ──────────────────────────────────────────
        await step('its settings page in Plugins: switches in DSH\'s own form, where they go, the recent list with Open chat', async () => {
            const { page } = window;
            const form = await openSettings(page);
            const switches = await form.getByRole('switch').count();
            check('DSH\'s own form with the master switch and one per kind', switches === 7 && (await form.getByRole('switch', { name: 'Fleet findings' }).count()) === 1, String(switches));
            const where = await page.locator('[data-notifications-where]').innerText();
            const whereExpected = desktopApp ? /This DSH window shows them, with DSH's icon, while it is hidden, minimised or behind other windows/ : /A DSH window in your browser shows them while you are not looking at it/;
            check('where they go now, in words', whereExpected.test(where), where);
            const permission = await page.locator('[data-notifications-permission]').innerText();
            check('this window\'s permission, in words', /This window may show notifications\./.test(permission), permission);
            const recent = page.locator('[data-notifications-recent] li');
            await waitFor(async () => (await recent.count()) >= 5, 'the recent list', 15000, 300);
            const rows = await recent.allInnerTexts();
            check('the recent list: newest first, each with its time and what became of it', /^Burst 5|\n?Burst 5/.test(rows[0].split('\n').slice(1).join('\n')) && rows.some((r) => /Fix the flaky upload test/.test(r) && /Shown\. Shown on screen by DSH's window/.test(r)) && rows.some((r) => /While you look/.test(r) && /Not shown\. You were looking at DSH/.test(r)), rows.slice(0, 8).join('\n---\n'));
            check('no ids, raw paths or JSON where people read', !/dsh-plugin-|\{|\bsession-[0-9a-f]{6,}|\/Users\//.test(rows.join('\n') + where + permission), rows.join(' | ').slice(0, 400));
            const hint = await page.locator('[data-notifications-recent-hint]').innerText();
            check('the list names the log file that has every one', hint.includes(`Every one is also a line in ${logFile()}.`), hint);
            const open = page.getByRole('button', { name: 'Open chat: “Fix the flaky upload test” handed back' });
            check('the one from a chat has Open chat', (await open.count()) === 1);
            await shot(page, shots, 'settings-light');
            await setDark(page, true);
            await shot(page, shots, 'settings-dark');
            await setDark(page, false);
            await open.click();
            await page.getByText('Notifications e2e: the chat a notification opens.', { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 });
            check('Open chat opens it', true);
        }, async () => { if (window?.page) await shot(window.page, shots, 'failed-settings'); });

        await step('a kind switched off and saved: the next one of that kind is "off", in words, on the page too', async () => {
            const { page } = window;
            const form = await openSettings(page);
            await form.getByRole('switch', { name: 'Fleet findings' }).click();
            await form.getByRole('button', { name: 'Save' }).click();
            await waitFor(async () => /notifyFleet:\s*false/.test(readFileSync(join(run.profile, 'cordis.patch.yml'), 'utf8')), 'the save to reach the profile', 20000, 300);
            const sent = await waitFor(async () => {
                const answer = await notify({ title: 'A3 is running hot', body: '91 °C', kind: 'fleet' });
                return answer === 'off' ? answer : undefined;
            }, 'the setting to apply', 30000, 500).catch(() => 'not off');
            const entry = await entryOf('A3 is running hot');
            check('the caller is told off, and the list says which switch', sent === 'off' && entry?.state === 'not shown' && entry.detail === '“Fleet findings” is switched off in its settings.', json({ sent, entry }));
            check('other kinds still go', (await notify({ title: 'Still on', kind: 'handback' })) === 'browser');
            check('the earlier ones are still listed after the save (it restarted with them)', (await status()).recent.some((item) => item.title === 'Burst 1'), '');
        }, async () => { if (window?.page) await shot(window.page, shots, 'failed-switch'); });

        await step('the test button shows one now, says the system showed it, and logs it', async () => {
            const { page } = window;
            await openSettings(page);
            await page.evaluate(() => { window.__watching = true; });
            const before = (await notes(page)).length;
            const button = page.getByRole('button', { name: 'Send a test notification' });
            await button.focus();
            await page.keyboard.press('Enter');
            const line = page.locator('[data-notifications-test-result]');
            await waitFor(async () => /^Shown: the system reported showing it\.$/.test(await line.innerText()), 'the test line', 15000, 300);
            const made = (await notes(page)).slice(before);
            check('it shows even while you look, and the line says the system showed it', made.length === 1 && made[0].title === 'Notifications test', json(made));
            check('focus stays on the button after the test', await button.evaluate((el) => el === document.activeElement));
            const ring = await button.evaluate((el) => getComputedStyle(el).outlineStyle + ' ' + getComputedStyle(el).outlineWidth);
            check('the focused button shows a ring', /solid|auto/.test(ring), ring);
            const entry = await waitFor(async () => (await entryOf('Notifications test')), 'the test in the list', 15000, 300);
            check('the test is in the list and the log', entry.state === 'shown' && logLines().some((l) => l.startsWith(`info #${entry.id} (test) “Notifications test” shown`)), json(entry));
            await page.evaluate(() => { window.__watching = false; });
            await shot(page, shots, 'settings-tested-light');
        }, async () => { if (window?.page) await shot(window.page, shots, 'failed-test'); });

        await step('a 760 px window: the page fits without a sideways scroll, every state word readable', async () => {
            const { page } = window;
            await page.setViewportSize({ width: 760, height: 900 });
            await openSettings(page);
            const fit = await page.evaluate(() => {
                const root = document.querySelector('[data-notifications-settings]');
                const over = [...root.querySelectorAll('*')].filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'hidden' && el.clientWidth > 0).map((el) => el.className || el.tagName).slice(0, 5);
                return { width: root.getBoundingClientRect().width, scroll: root.scrollWidth, client: root.clientWidth, over };
            });
            check('no sideways scroll in the page at 760 px', fit.scroll <= fit.client + 1 && fit.over.length === 0, json(fit));
            await shot(page, shots, 'settings-760-light');
            await setDark(page, true);
            await shot(page, shots, 'settings-760-dark');
            await setDark(page, false);
            await page.setViewportSize({ width: 1280, height: 860 });
        }, async () => { if (window?.page) await shot(window.page, shots, 'failed-760'); });

        await step('contrast: every text style on the page reaches 4.5:1, light and dark', async () => {
            const { page } = window;
            await openSettings(page);
            for (const dark of [false, true]) {
                await setDark(page, dark);
                const worst = await page.evaluate(() => {
                    const parse = (c) => {
                        const m = /rgba?\(([^)]+)\)/.exec(c);
                        if (!m) return null;
                        const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
                        return { r, g, b, a };
                    };
                    const lum = ({ r, g, b }) => {
                        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
                        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
                    };
                    const ground = (el) => {
                        // Layer the grounds down to an opaque one.
                        const layers = [];
                        for (let node = el; node; node = node.parentElement) {
                            const c = parse(getComputedStyle(node).backgroundColor);
                            if (c && c.a > 0) layers.push(c);
                            if (c && c.a >= 1) break;
                        }
                        let base = document.body.hasAttribute('data-ds-dark-theme') ? { r: 21, g: 21, b: 23 } : { r: 255, g: 255, b: 255 };
                        for (const c of layers.reverse()) base = { r: c.r * c.a + base.r * (1 - c.a), g: c.g * c.a + base.g * (1 - c.a), b: c.b * c.a + base.b * (1 - c.a) };
                        return base;
                    };
                    const out = [];
                    for (const el of document.querySelectorAll('[data-notifications-settings] *')) {
                        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
                        if (!own || !el.getClientRects().length) continue;
                        const fg = parse(getComputedStyle(el).color);
                        if (!fg) continue;
                        const bg = ground(el);
                        const mixed = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
                        const [l1, l2] = [lum(mixed), lum(bg)].sort((a, b) => b - a);
                        out.push({ ratio: (l1 + 0.05) / (l2 + 0.05), text: el.textContent.trim().slice(0, 40), cls: String(el.className).slice(0, 40) });
                    }
                    return out.sort((a, b) => a.ratio - b.ratio).slice(0, 3);
                });
                check(`${dark ? 'dark' : 'light'}: the lowest text contrast is 4.5:1 or more`, worst.length > 0 && worst[0].ratio >= 4.5, json(worst));
            }
            await setDark(page, false);
        });

        // ── A browser that has not answered the ask ─────────────────────
        await step('a browser that has not answered the ask: news waits, Allow asks, focus stays on the row, then the news shows', async () => {
            const asking = await openFakeWindow(pw, { fake: { startPermission: 'default', askAnswer: 'granted' } });
            try {
                // The first window must not take this one: it stays focused (looking), and the asking window is the only one in the background.
                await window.page.evaluate(() => { window.__watching = true; });
                const page = asking.page;
                await openSettings(page);
                const row = page.locator('[data-notifications-permission]');
                check('the row says the browser asks once, with an Allow button', /This browser asks you once before DSH may show notifications/.test(await row.innerText()) && (await row.getByRole('button', { name: 'Allow notifications' }).count()) === 1, await row.innerText());
                await shot(page, shots, 'permission-ask-light');
                await row.getByRole('button', { name: 'Allow notifications' }).focus();
                await page.keyboard.press('Enter');
                await waitFor(async () => /This window may show notifications\./.test(await row.innerText()), 'the answer', 10000, 200);
                const focused = await page.evaluate(() => document.activeElement?.closest('[data-notifications-permission]') !== null);
                check('after the answer, the row says so and keeps the keyboard\'s place', focused, await page.evaluate(() => document.activeElement?.outerHTML?.slice(0, 120)));
            } finally {
                await asking.browser.close().catch(() => {});
                await window.page.evaluate(() => { window.__watching = false; });
            }
        }, async () => { if (window?.page) await shot(window.page, shots, 'failed-ask'); });

        const ours = window.errors.filter((text) => /notifications/i.test(text));
        check('no errors from the plugin in the window', ours.length === 0, ours.join('\n'));
        await window.browser.close().catch(() => {});
        window = undefined;
    }

    // ── A restart with news waiting ────────────────────────────────────
    await step('a restart with news waiting: it shows once afterwards, and a reload does not show it again', async () => {
        // The window has just gone (within the 90 s a browser window counts as around), so the news queues for it.
        const sent = await notify({ title: 'Waited through a restart', kind: 'handback', sessionId });
        check('queued while a window counts as around', sent === 'browser', sent);
        await restart('a restart with news waiting');
        check('the log says what still waits after the restart', logLines().some((line) => /^info \d+ notification\(s\) still waiting for DSH's window from before the restart/.test(line)), logLines().slice(-8).join('\n'));
        const waiting = await entryOf('Waited through a restart');
        check('the list kept it, still waiting', waiting?.state === 'waiting', json(waiting));
        if (!pw) return;
        window = await openFakeWindow(pw);
        const { page } = window;
        await waitFor(async () => (await notes(page)).some((n) => n.title === 'Waited through a restart'), 'the waiting news to show', 30000, 300);
        await waitFor(async () => (await entryOf('Waited through a restart'))?.state === 'shown', 'it to be reported shown', 20000, 300);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(3000);
        await poke(page);
        await sleep(1500);
        const again = (await notes(page)).filter((n) => n.title === 'Waited through a restart');
        check('shown once after the restart, and not again after a reload', again.length === 0, json(again));
    }, async () => { if (window?.page) await shot(window.page, shots, 'failed-restart'); });

    // ── Switched off and on from Plugins ───────────────────────────────
    await step('switched off and on from Plugins: callers get nothing while off, its sheet leaves the window, and on again it works', async () => {
        const off = await run.api('pluginManager/setBundleEnabled', { name: BUNDLE, enabled: false });
        await waitFor(async () => !(await api('status')).ok, 'the plugin to stop', 30000, 300);
        check('switched off: the caller finds no service', (await notify({ title: 'While off' })) === 'absent');
        if (window?.page) {
            await waitFor(async () => (await window.page.locator('style[data-plugin="dsh-plugin-notifications"]').count()) === 0, 'its style sheet to leave', 15000, 300).catch(() => {});
            check('its style sheet leaves the window', (await window.page.locator('style[data-plugin="dsh-plugin-notifications"]').count()) === 0);
        }
        const on = await run.api('pluginManager/setBundleEnabled', { name: BUNDLE, enabled: true });
        await waitFor(async () => (await api('status')).ok, 'the plugin to run again', 30000, 300);
        check('switched off and on (as the Plugins page does)', off.ok && on.ok, json([off, on]).slice(0, 300));
        // On again, its browser half comes back to the open window, which checks in at once.
        if (window?.page) await waitFor(async () => (await status()).sender === 'window', 'the window to check in again', 30000, 300).catch(() => {});
        const again = await notify({ title: 'On again', kind: 'handback' });
        check('on again it takes news, and nothing was added while off', (window?.page ? again === 'browser' : ['browser', 'none', 'cli'].includes(again)) && !(await status()).recent.some((item) => item.title === 'While off'), again);
        const ids = Object.fromEntries((await status()).recent.map((item) => [item.title, item.id]));
        check('ids went on counting across the restart and the switch', ids['On again'] > ids['Waited through a restart'] && ids['Waited through a restart'] > ids['No window yet'], json(ids));
        if (window?.page) {
            await waitFor(async () => (await window.page.locator('style[data-plugin="dsh-plugin-notifications"]').count()) === 1, 'its style sheet to come back', 15000, 300).catch(() => {});
            check('one style sheet of its own again', (await window.page.locator('style[data-plugin="dsh-plugin-notifications"]').count()) === 1);
        }
    }, async () => { if (window?.page) await shot(window.page, shots, 'failed-off-on'); });
    await window?.browser?.close().catch(() => {});
    window = undefined;

    // ── A wrong setting ────────────────────────────────────────────────
    await step('a wrong setting in the profile: it still starts and works, the log warns, and the page names the setting', async () => {
        await restart('a wrong setting', rowsWith({ enabled: true, notifyHandback: 'no' }));
        check('the log warns, naming the setting and what it counts as', logLines().some((line) => line.startsWith('warn a setting is wrong: “Handbacks” (notifyHandback) must be true or false, but it is "no"; it counts as on until you change it')), logLines().slice(-6).join('\n'));
        const s = await status();
        check('the status names it for the page', s.problems.length === 1 && s.problems[0].key === 'notifyHandback', json(s.problems));
        const sent = await notify({ title: 'Despite a wrong setting', kind: 'handback' });
        check('it still works: news of that kind goes, as the default says', ['browser', 'none', 'cli'].includes(sent), sent);
        if (pw) {
            window = await openFakeWindow(pw);
            await openSettings(window.page);
            const problem = await window.page.locator('[data-notifications-problems]').innerText();
            check('the page names the setting, what it must be, and how to fix it', /A setting is wrong/.test(problem) && /“Handbacks” \(notifyHandback\) must be true or false, but it is "no"; it counts as on until you change it\. Set it with its switch above and save\./.test(problem), problem);
            await shot(window.page, shots, 'settings-wrong-setting-light');
        }
    }, async () => { if (window?.page) await shot(window.page, shots, 'failed-wrong-setting'); });
} catch (error) {
    check('the run finished', false, error?.stack ?? error);
} finally {
    await window?.browser?.close().catch(() => {});
    await run.stop().catch(() => {});
    await model.close?.();
    run.cleanup();
}

console.log(`\n# ${tally.passed} passed, ${tally.failed} failed`);
if (tally.failed > 0) console.log(`# failed: ${tally.failures.join(' | ')}`);
process.exit(tally.failed > 0 ? 1 : 0);
