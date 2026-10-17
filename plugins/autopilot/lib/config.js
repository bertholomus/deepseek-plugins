/**
 * Autopilot's settings in words: their titles, which ones its page in
 * Plugins can change while it runs, the ranges each must be in, and what
 * its log says after a save. No DSH packages here, so the checks run in
 * plain unit tests too.
 *
 * @module dsh-plugin-autopilot/config
 */
import { oneOf, onOff, wholeNumber, wholeNumbers } from './shared/settings.js';

/** The settings on Autopilot's page in Plugins, in the words the page and its errors use. */
export const SETTING_TITLES = Object.freeze({
    enabled: 'Autopilot on',
    defaultRule: 'The rule for sessions without their own',
    resumeAfterRestart: 'Resume after a restart',
    resumeWindowHours: 'Resume sessions cut off within',
    idleSeconds: 'Quiet time before a note',
    idleWindowHours: 'At start, look back',
    maxNudges: 'Notes in a row without progress',
    maxNotesPerHour: 'Notes an hour, at most',
    errorRetrySeconds: 'Waits before each try after an error',
    startDelaySeconds: 'Wait after DSH starts',
});

/** The settings its page in Plugins can change while it runs. */
export const LIVE_SETTINGS = Object.freeze(['resumeAfterRestart', 'resumeWindowHours', 'idleSeconds', 'idleWindowHours', 'maxNudges', 'maxNotesPerHour', 'errorRetrySeconds']);

/** What Autopilot uses when the profile sets nothing (the defaults in lib/index.js Config). */
export const DEFAULTS = Object.freeze({
    enabled: true, defaultRule: 'auto', resumeAfterRestart: true, resumeWindowHours: 6, idleSeconds: 600, idleWindowHours: 2,
    maxNudges: 2, maxNotesPerHour: 20, errorRetrySeconds: Object.freeze([120, 600, 1800]), startDelaySeconds: 20,
});

/** Check the settings and say what is wrong in words (a SettingError naming the setting). */
export function checkConfig(settings) {
    const t = SETTING_TITLES;
    onOff(settings, 'enabled', t.enabled);
    oneOf(settings, 'defaultRule', ['auto', 'ask', 'off'], t.defaultRule);
    onOff(settings, 'resumeAfterRestart', t.resumeAfterRestart);
    wholeNumber(settings, 'resumeWindowHours', 1, 168, 'hours', t.resumeWindowHours);
    wholeNumber(settings, 'idleSeconds', 5, 86400, 'seconds', t.idleSeconds);
    wholeNumber(settings, 'idleWindowHours', 1, 168, 'hours', t.idleWindowHours);
    wholeNumber(settings, 'maxNudges', 1, 10, '', t.maxNudges);
    wholeNumber(settings, 'maxNotesPerHour', 1, 500, '', t.maxNotesPerHour);
    wholeNumbers(settings, 'errorRetrySeconds', { minItems: 1, maxItems: 10, min: 0, max: 86400 }, 'seconds', t.errorRetrySeconds);
    wholeNumber(settings, 'startDelaySeconds', 0, 600, 'seconds', t.startDelaySeconds);
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
        return { kind: 'settings', text: `Settings changed${words ? `: ${words}` : ''}; Autopilot waits until a wrong one is fixed`, why: `${check.problem.text}.`, state: 'waiting on a setting', by: 'you' };
    }
    if (was) return { kind: 'settings', text: 'Settings fixed: Autopilot is working again', why: `You saved ${words || 'its settings'} in Plugins.`, state: 'done', by: 'you' };
    if (words) return { kind: 'settings', text: `Settings changed: ${words}`, why: 'You saved them in Plugins. They apply now.', state: 'done', by: 'you' };
    return undefined;
}
