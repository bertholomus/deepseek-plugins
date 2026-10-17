/**
 * Decisions' settings in words: their titles, which ones its page in
 * Plugins can change while it runs, what each must be, and what its log
 * says after a save. No DSH packages here, so the checks run in plain unit
 * tests too.
 *
 * A wrong value never stops Decisions from starting: it lists and holds
 * nothing, and its page says which setting is wrong, what it must be, and
 * where to change it.
 *
 * @module dsh-plugin-decisions/config
 */
import { commandLine, keyName, oneOf, onOff, wholeNumber } from './shared/settings.js';

/** The settings, in the words the page, the settings form and the errors use. */
export const SETTING_TITLES = Object.freeze({
    enabled: 'Decisions on',
    approvals: 'Tools waiting for approval',
    questions: 'Questions in the question box',
    replies: 'Replies that end with a question',
    threads: 'Threads that need a decision',
    notify: 'A notification for each new card',
    windowHours: 'Keep a reply\'s question for',
    mirror: 'Also send new cards to',
    mirrorUrlEnv: 'The key that holds the webhook address',
    mirrorCommand: 'The command',
    mirrorPerHour: 'Messages sent an hour, at most',
});

/** The settings its page in Plugins can change while it runs. */
export const LIVE_SETTINGS = Object.freeze(['approvals', 'questions', 'replies', 'threads', 'notify', 'windowHours', 'mirror', 'mirrorUrlEnv', 'mirrorPerHour']);

/** Where the webhook address is kept: a key in DSH's key store (or the environment DSH starts in), never the settings file. */
export const WEBHOOK_KEY = 'DECISIONS_WEBHOOK_URL';

/** What Decisions uses when the profile sets nothing (the defaults in lib/index.js Config). */
export const DEFAULTS = Object.freeze({
    enabled: true,
    approvals: true,
    questions: true,
    replies: true,
    threads: true,
    notify: true,
    windowHours: 72,
    mirror: 'off',
    mirrorUrlEnv: WEBHOOK_KEY,
    mirrorCommand: Object.freeze([]),
    mirrorPerHour: 30,
});

/** Check the settings and say what is wrong in words (a SettingError naming the setting). */
export function checkConfig(settings) {
    const t = SETTING_TITLES;
    onOff(settings, 'enabled', t.enabled);
    for (const key of ['approvals', 'questions', 'replies', 'threads', 'notify']) onOff(settings, key, t[key]);
    wholeNumber(settings, 'windowHours', 1, 720, 'hours', t.windowHours);
    oneOf(settings, 'mirror', ['off', 'webhook', 'command'], t.mirror);
    keyName(settings, 'mirrorUrlEnv', t.mirrorUrlEnv);
    commandLine(settings, 'mirrorCommand', { optional: true }, t.mirrorCommand);
    wholeNumber(settings, 'mirrorPerHour', 1, 500, '', t.mirrorPerHour);
}

/** The settings a save changed, in words, from DSH's changed paths. */
export function changedWords(paths) {
    const keys = [...new Set((Array.isArray(paths) ? paths : []).map((path) => (Array.isArray(path) ? path[0] : path)).filter((key) => typeof key === 'string'))];
    return keys.map((key) => SETTING_TITLES[key] ?? key).join(', ');
}

/**
 * After a save in Plugins (DSH's `loader/volatile-update`): check again,
 * and the log entry that says what changed, or undefined when nothing did.
 * @param {import('./shared/settings.js').SettingsCheck} check
 * @param {readonly (readonly string[])[]} paths - the settings DSH changed.
 */
export function savedEntry(check, paths) {
    const was = check.problem?.text;
    check.run();
    const words = changedWords(paths);
    if (!check.ok) {
        return { kind: 'settings', text: `Settings changed${words ? `: ${words}` : ''}; Decisions waits until a wrong one is fixed`, why: `${check.problem.text}.`, state: 'waiting on a setting', by: 'you' };
    }
    if (was) return { kind: 'settings', text: 'Settings fixed: Decisions is working again', why: `You saved ${words || 'its settings'} in Plugins.`, state: 'done', by: 'you' };
    if (words) return { kind: 'settings', text: `Settings changed: ${words}`, why: 'You saved them in Plugins. They apply now.', state: 'done', by: 'you' };
    return undefined;
}
