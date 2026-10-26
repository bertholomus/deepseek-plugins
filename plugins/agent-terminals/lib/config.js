/**
 * Agent Terminals' settings in words: their titles, which ones its page in
 * Plugins can change while it runs, what each must be, and what its log
 * says after a save. No DSH packages here, so the checks run in plain unit
 * tests too.
 *
 * A wrong value never stops Agent Terminals from starting: it starts no
 * agent and types nothing, and its page says which setting is wrong, what
 * it must be, and where to change it.
 *
 * @module dsh-plugin-agent-terminals/config
 */
import { changedEntry, changedTitles, oneOf, onOff, wholeNumber } from './shared/settings.js';

/** The settings, in the words the page, the settings form and the errors use. */
export const SETTING_TITLES = Object.freeze({
    enabled: 'Agent Terminals on',
    resumeAfterRestart: 'Start agents again after DSH restarts',
    listNewSessions: 'List a new agent\'s session in the sidebar',
    openTabs: 'Open an agent\'s terminal tab with its session',
    typeWhileWorking: 'Type messages in while the agent works',
    proofSeconds: 'Seconds without proof before Enter is pressed again',
    enterRetries: 'Press Enter again, at most',
    askAfterSeconds: 'Seconds before a waiting tool call counts as asking you',
    notify: 'A notification when an agent waits on you',
    typing: 'How messages are typed in',
});

/** The settings its page in Plugins can change while it runs. */
export const LIVE_SETTINGS = Object.freeze(['resumeAfterRestart', 'listNewSessions', 'openTabs', 'typeWhileWorking', 'proofSeconds', 'enterRetries', 'askAfterSeconds', 'notify']);

/** The ways a message can be typed in (lib/typist.js). */
export const TYPING = Object.freeze(['auto', 'direct', 'attached']);

/** What Agent Terminals uses when the profile sets nothing (the defaults in lib/index.js Config). */
export const DEFAULTS = Object.freeze({
    enabled: true,
    resumeAfterRestart: true,
    listNewSessions: true,
    openTabs: true,
    typeWhileWorking: false,
    proofSeconds: 8,
    enterRetries: 2,
    askAfterSeconds: 20,
    notify: true,
    typing: 'auto',
});

/** Check the settings and say what is wrong in words (a SettingError naming the setting). */
export function checkConfig(settings) {
    const t = SETTING_TITLES;
    for (const key of ['enabled', 'resumeAfterRestart', 'listNewSessions', 'openTabs', 'typeWhileWorking', 'notify']) onOff(settings, key, t[key]);
    wholeNumber(settings, 'proofSeconds', 2, 120, 'seconds', t.proofSeconds);
    wholeNumber(settings, 'enterRetries', 0, 5, '', t.enterRetries);
    wholeNumber(settings, 'askAfterSeconds', 5, 600, 'seconds', t.askAfterSeconds);
    oneOf(settings, 'typing', TYPING, t.typing);
}

/** The settings a change touched, by their titles in quotes, from DSH's changed paths. */
export function changedWords(paths) {
    return changedTitles(paths, SETTING_TITLES);
}

/**
 * After the settings changed (a save in Plugins, or an edit of DSH's
 * profile): check again, and the log entry that says what changed, or
 * undefined when nothing did.
 * @param {import('./shared/settings.js').SettingsCheck} check
 * @param {readonly (readonly string[])[]} paths - the settings DSH changed.
 */
export function savedEntry(check, paths) {
    return changedEntry(check, paths, { name: 'Agent Terminals', titles: SETTING_TITLES });
}

/** A value as JSON keeps it (a wrong type too), to compare with the next start's. */
function plain(value) {
    if (value === undefined) return null;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return String(value);
    }
}

/**
 * The settings as they apply now, kept in state.json: at the next start
 * they tell what an edit of DSH's profile changed in between.
 */
export function settingsSnapshot(settings) {
    return Object.fromEntries(Object.keys(SETTING_TITLES).map((key) => [key, plain(settings?.[key])]));
}

/** The settings whose values differ from the ones Agent Terminals last ran with (none when it never ran here). */
export function changedSince(before, now) {
    if (!before || typeof before !== 'object' || Array.isArray(before)) return [];
    return Object.keys(SETTING_TITLES).filter((key) => key in before && JSON.stringify(before[key]) !== JSON.stringify(now?.[key]));
}

/**
 * At a start: the log entry for the settings an edit of DSH's profile
 * changed since Agent Terminals last ran (DSH applies the file when it is
 * saved, starting Agent Terminals again with it, or a DSH that starts reads
 * it), or undefined when none changed. A save in Plugins is logged by
 * `savedEntry` as it happens.
 * @param {import('./shared/settings.js').SettingsCheck} check - run already.
 * @param {string[]} keys - from `changedSince`.
 * @param {object} settings - as they apply now.
 */
export function profileEntry(check, keys, settings) {
    if (!keys.length) return undefined;
    const words = keys.map((key) => `“${SETTING_TITLES[key] ?? key}”`).join(', ');
    if (!check.ok) return { kind: 'settings', text: `Settings changed in DSH's profile: ${words}; Agent Terminals waits until a wrong one is fixed`, why: `${check.problem.text}.`, state: 'waiting on a setting' };
    if (settings?.enabled === false) return { kind: 'settings', text: `Settings changed in DSH's profile: ${words}`, why: 'Agent Terminals is switched off there (enabled: false): it starts, reads and types nothing.', state: 'done' };
    return { kind: 'settings', text: `Settings changed in DSH's profile: ${words}`, why: 'Agent Terminals started again with them.', state: 'done' };
}
