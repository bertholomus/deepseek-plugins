/**
 * Canon's settings in words: their titles, which ones its page in Plugins
 * can change while it runs, what each must be, and what its log says after
 * a save. No DSH packages here, so the checks run in plain unit tests too.
 *
 * A wrong value never stops Canon from starting: it adds nothing to turns
 * and writes nothing, and its page says which setting is wrong, what it
 * must be, and where to change it. A vault folder that is right as a
 * setting but cannot be read (missing, no permission) is not a setting
 * problem: the page says what is wrong with the folder instead.
 *
 * @module dsh-plugin-canon/config
 */
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { SettingError, changedEntry, changedTitles, oneOf, onOff, wholeNumber } from './shared/settings.js';

/** The settings, in the words the page, the settings form and the errors use. */
export const SETTING_TITLES = Object.freeze({
    enabled: 'Canon on',
    vault: 'Vault folder',
    access: 'What Canon may write',
    draftsFolder: 'Drafts folder',
    promote: 'Allow promoting drafts',
    promoteFolder: 'Promoted notes go to',
    recall: 'Add notes to turns',
    maxNotes: 'Notes a turn, at most',
    maxChars: 'Characters a turn, at most',
});

/** The settings its page in Plugins can change while it runs (all but `enabled`). */
export const LIVE_SETTINGS = Object.freeze(['vault', 'access', 'draftsFolder', 'promote', 'promoteFolder', 'recall', 'maxNotes', 'maxChars']);

/** What Canon may write into the vault: nothing, or new draft notes in the drafts folder. */
export const ACCESS_CHOICES = Object.freeze({ 'read-only': 'Read only', drafts: 'Drafts' });

/** What Canon uses when the profile sets nothing (the defaults in lib/index.js Config). */
export const DEFAULTS = Object.freeze({
    enabled: true,
    vault: '',
    access: 'read-only',
    draftsFolder: 'Drafts',
    promote: false,
    promoteFolder: '',
    recall: true,
    maxNotes: 3,
    maxChars: 2000,
});

/** The ranges the numbers must be in (the settings form uses the same). */
export const RANGES = Object.freeze({ maxNotes: [1, 10], maxChars: [400, 8000] });

const shown = (value) => {
    if (value === undefined) return 'empty';
    try { return JSON.stringify(value).slice(0, 120); } catch { return String(value).slice(0, 120); }
};

/** A setting as the person reads it: its title, then its name in the profile. */
const named = (key) => `${SETTING_TITLES[key]} (${key})`;

/**
 * The vault folder a setting names, as a full path: `~/` is the home
 * folder; '' when none is set. Never throws; `undefined` when the value is
 * not a path at all (checkConfig says why).
 * @param {unknown} value
 * @param {string} [home]
 */
export function vaultPath(value, home = homedir()) {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    if (text === '') return '';
    if (/[\0\r\n]/.test(text)) return undefined;
    const expanded = text === '~' ? home : text.startsWith('~/') ? join(home, text.slice(2)) : text;
    if (!isAbsolute(expanded)) return undefined;
    return resolve(normalize(expanded));
}

/** A path as a person reads it: the home folder as ~. */
export function displayPath(path, home = homedir()) {
    if (typeof path !== 'string' || path === '') return '';
    if (path === home) return '~';
    return path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

/**
 * A folder inside the vault, as a setting names it: '' (the vault's top
 * level) when `optional`, else segments of letters, digits, spaces and
 * - _ . ( ), joined by /, none hidden (starting with a dot) and none `..`.
 * Gives the cleaned relative path, or undefined.
 */
export function folderIn(value, { optional = false } = {}) {
    if (typeof value !== 'string') return undefined;
    const text = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    if (text === '') return optional ? '' : undefined;
    if (text.length > 200) return undefined;
    const parts = text.split('/');
    if (parts.some((p) => p === '' || p.startsWith('.') || !/^[\p{L}\p{N} _().,'&+-]+$/u.test(p) || p.trim() !== p)) return undefined;
    return parts.join('/');
}

/** Whether `inner` is `outer` or a folder inside it (both full paths). */
export const within = (inner, outer) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : `${outer}${sep}`);

/**
 * Check the settings and say what is wrong in words (a SettingError naming
 * the setting).
 * @param {object} settings
 * @param {{ home?: string, dshHome?: string }} [env] - the home folder, and DSH's data folder (Canon never reads or
 *   writes there).
 */
export function checkConfig(settings, { home = homedir(), dshHome } = {}) {
    onOff(settings, 'enabled', SETTING_TITLES.enabled);
    const raw = settings?.vault;
    const vault = vaultPath(raw, home);
    if (vault === undefined) {
        throw new SettingError('vault', `${named('vault')} must be the full path of your Obsidian vault's folder, such as ~/Obsidian/Canon or /Users/you/Canon (it is ${shown(raw)})`);
    }
    if (vault !== '') {
        if (vault === sep || vault === resolve(home)) {
            throw new SettingError('vault', `${named('vault')} must be the vault's own folder, not ${vault === sep ? 'the whole disk' : 'your home folder'} (it is ${shown(raw)})`);
        }
        if (dshHome) {
            const data = resolve(dshHome);
            if (within(vault, data)) throw new SettingError('vault', `${named('vault')} must not be in DSH's data folder (${displayPath(data, home)}): Canon never reads or writes there (it is ${shown(raw)})`);
            if (within(data, vault)) throw new SettingError('vault', `${named('vault')} must not hold DSH's data folder (${displayPath(data, home)}): choose the vault's own folder (it is ${shown(raw)})`);
        }
    }
    oneOf(settings, 'access', ACCESS_CHOICES, SETTING_TITLES.access);
    const drafts = folderIn(settings?.draftsFolder);
    if (drafts === undefined) {
        throw new SettingError('draftsFolder', `${named('draftsFolder')} must be a folder inside the vault, such as Drafts or Canon/Drafts: letters, digits and spaces, no part starting with a dot, no .. (it is ${shown(settings?.draftsFolder)})`);
    }
    onOff(settings, 'promote', SETTING_TITLES.promote);
    const target = folderIn(settings?.promoteFolder, { optional: true });
    if (target === undefined) {
        throw new SettingError('promoteFolder', `${named('promoteFolder')} must be empty (the vault's top level) or a folder inside the vault, such as Notes: letters, digits and spaces, no part starting with a dot, no .. (it is ${shown(settings?.promoteFolder)})`);
    }
    const lower = (p) => p.toLowerCase();
    if (target !== '' && (lower(target) === lower(drafts) || lower(target).startsWith(`${lower(drafts)}/`))) {
        throw new SettingError('promoteFolder', `${named('promoteFolder')} must be outside the drafts folder (${drafts}): notes there are never added to turns (it is ${shown(settings?.promoteFolder)})`);
    }
    onOff(settings, 'recall', SETTING_TITLES.recall);
    wholeNumber(settings, 'maxNotes', ...RANGES.maxNotes, '', SETTING_TITLES.maxNotes);
    wholeNumber(settings, 'maxChars', ...RANGES.maxChars, 'characters', SETTING_TITLES.maxChars);
}

/** The settings a change touched, by their titles in quotes, from DSH's changed paths. */
export function changedWords(paths) {
    return changedTitles(paths, SETTING_TITLES);
}

/**
 * After the settings changed (a save in Plugins, or an edit of DSH's
 * profile): check again, and the log entry that says what changed, or
 * undefined when nothing did.
 */
export function savedEntry(check, paths) {
    return changedEntry(check, paths, { name: 'Canon', titles: SETTING_TITLES });
}

/**
 * The settings as Canon uses them (only while every value is right): the
 * vault's full path, its folders, and what it may do.
 * @param {object} settings - from liveSettings.
 * @param {string} [home]
 */
export function resolved(settings, home = homedir()) {
    return {
        vault: vaultPath(settings.vault, home) || '',
        draftsFolder: folderIn(settings.draftsFolder) ?? DEFAULTS.draftsFolder,
        promoteFolder: folderIn(settings.promoteFolder, { optional: true }) ?? '',
        access: settings.access === 'drafts' ? 'drafts' : 'read-only',
        promote: settings.promote === true,
        recall: settings.recall !== false,
        maxNotes: Number.isInteger(settings.maxNotes) ? settings.maxNotes : DEFAULTS.maxNotes,
        maxChars: Number.isInteger(settings.maxChars) ? settings.maxChars : DEFAULTS.maxChars,
    };
}
