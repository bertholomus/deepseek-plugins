/**
 * The plugin's settings, checked in words. Each key takes any value in the
 * profile, so a wrong type (`enabled: "no"`, a number for a path) never
 * stops the plugin: that key counts as its default, the plugin's log warns
 * once at start, and the Categories page names it until it is fixed.
 *
 * @module dsh-plugin-categories/config
 */

/** What each key must be, said in a problem's words. */
const MUST = Object.freeze({
    enabled: 'true or false',
    storeFile: 'a file path',
    logFile: 'a file path, or empty for no log',
    projectsStoreFile: 'a file path, or empty to skip the move from the projects plugin',
});

const shown = (value) => {
    if (typeof value === 'string') return JSON.stringify(value);
    try {
        const text = JSON.stringify(value);
        return text === undefined ? String(value) : text.length > 60 ? `${text.slice(0, 59)}…` : text;
    } catch {
        return String(value);
    }
};

/**
 * The settings to run with, and what was wrong with the ones given.
 * @param raw - the row's config as DSH hands it (defaults already filled in for missing keys).
 * @param defaults - each key's default, as the plugin's schema gives it (index.js DEFAULTS).
 * @returns {{ config: object, problems: Array<{ key: string, text: string }> }}
 */
export function checkConfig(raw, defaults) {
    const DEFAULTS = defaults;
    const given = raw !== null && typeof raw === 'object' ? raw : {};
    const config = { ...DEFAULTS };
    const problems = [];
    const wrong = (key, value, counts) => {
        problems.push({ key, text: `${key} must be ${MUST[key]}, but it is ${shown(value)}; ${counts} until you change it` });
    };
    for (const key of Object.keys(DEFAULTS)) {
        const value = given[key];
        if (value === undefined || value === null) continue;
        if (key === 'enabled') {
            if (typeof value === 'boolean') config.enabled = value;
            else wrong(key, value, 'it counts as true');
            continue;
        }
        // A path: text, empty only where empty means "none".
        const empty = typeof value === 'string' && value.trim() === '';
        if (typeof value === 'string' && (!empty || key !== 'storeFile')) config[key] = empty ? '' : value;
        else wrong(key, value, `${DEFAULTS[key]} is used`);
    }
    return { config, problems };
}
