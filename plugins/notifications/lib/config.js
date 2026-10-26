/**
 * dsh-plugin-notifications, its settings in words. No DSH packages here, so
 * the checks run in plain unit tests too.
 *
 * A wrong value never stops the plugin: each setting that is not on or off
 * falls back to its default, the log says so, and the settings page names
 * the setting, what it must be and what it is.
 *
 * Every setting is a live field: DSH serves a plugin's page in Plugins only
 * for live fields, hands each to the plugin as a reference whose value
 * changes in place when the person saves (`valueOf` reads it), and says so
 * with `loader/volatile-update`. So a save applies at once, with no restart.
 *
 * @module dsh-plugin-notifications/config
 */

/** The settings, in the words the settings page uses. */
export const TITLES = Object.freeze({
    enabled: 'Send system notifications',
    notifyHandback: 'Handbacks',
    notifyFinished: 'Ended without a handback',
    notifyApproval: 'Waiting for approval',
    notifyFailed: 'Failed after a nudge',
    notifyStopped: 'Stopped after a nudge',
    notifyFleet: 'Fleet findings',
});

/** Every setting is a switch, on unless the profile says otherwise. */
export const DEFAULTS = Object.freeze(Object.fromEntries(Object.keys(TITLES).map((key) => [key, true])));

const shown = (value) => {
    if (value === undefined) return 'empty';
    try { return JSON.stringify(value).slice(0, 80); } catch { return String(value).slice(0, 80); }
};

/** A setting's value now: a live field's reference (`{ get() }`) read, a plain value as it is. */
export const valueOf = (value) => (value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value);

/** The config DSH passed, with each live field read as it is now. */
export function readConfig(config) {
    const given = config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
    return Object.fromEntries(Object.keys(given).map((key) => [key, valueOf(given[key])]));
}

/** The keys a change touched, from DSH's changed paths (`[['notifyFleet'], …]`), by their titles: “Fleet findings”. */
export function changedWords(paths) {
    const keys = [...new Set((Array.isArray(paths) ? paths : []).map((path) => (Array.isArray(path) ? path[0] : path)).filter((key) => typeof key === 'string'))];
    return keys.map((key) => (TITLES[key] ? `“${TITLES[key]}”` : key)).join(', ');
}

/**
 * The settings to use, and what is wrong with the ones given.
 * @param {object} raw - the config DSH passed (any shape).
 * @returns {{ settings: Record<string, boolean>, problems: { key: string, text: string }[] }}
 */
export function checkSettings(raw) {
    const given = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const settings = {};
    const problems = [];
    for (const [key, fallback] of Object.entries(DEFAULTS)) {
        const value = given[key];
        if (value === undefined || typeof value === 'boolean') {
            settings[key] = value ?? fallback;
            continue;
        }
        settings[key] = fallback;
        problems.push({ key, text: `“${TITLES[key]}” (${key}) must be true or false, but it is ${shown(value)}; it counts as ${fallback ? 'on' : 'off'} until you change it` });
    }
    return { settings, problems };
}
