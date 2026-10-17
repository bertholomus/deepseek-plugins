/**
 * Recall's settings in words: their titles, which ones its page in Plugins
 * can change while it runs, what each must be, and the folders they name.
 * No DSH packages here, so the checks run in plain unit tests too.
 *
 * A wrong value never stops Recall from starting: it searches nothing, and
 * its page says which setting is wrong, what it must be, and where to
 * change it. A folder that is not there is not a wrong setting (a disk
 * may be unplugged): its status on the page says so.
 *
 * @module dsh-plugin-recall/config
 */
import { homedir } from 'node:os';
import { isAbsolute, join, normalize } from 'node:path';
import { SettingError, changedEntry, changedTitles, onOff } from './shared/settings.js';

/** The settings, in the words the page, the settings form and the errors use. */
export const SETTING_TITLES = Object.freeze({
    enabled: 'Recall on',
    sessions: 'Search this DSH\'s sessions',
    sessionFolders: 'More DSH session folders',
    transcriptFolders: 'Coding-agent transcript folders',
    handoffFolders: 'Handoff note folders',
    tool: 'Let agents search with recall_search',
});

/** The settings its page in Plugins can change while it runs. */
export const LIVE_SETTINGS = Object.freeze(['sessions', 'sessionFolders', 'transcriptFolders', 'handoffFolders', 'tool']);

/** What Recall uses when the profile sets nothing (the defaults in lib/index.js Config). */
export const DEFAULTS = Object.freeze({
    enabled: true,
    sessions: true,
    sessionFolders: [],
    transcriptFolders: [],
    handoffFolders: [],
    tool: true,
});

/** The folder lists, and the kind of file each holds. */
export const FOLDER_SETTINGS = Object.freeze({ sessionFolders: 'session', transcriptFolders: 'transcript', handoffFolders: 'handoff' });

/** The most folders one list takes. */
export const MAX_FOLDERS = 20;

const shown = (value) => {
    if (value === undefined) return 'empty';
    try { return JSON.stringify(value).slice(0, 120); } catch { return String(value).slice(0, 120); }
};

/** A folder as written ("~/notes", "/Users/me/notes/"), made absolute; undefined when it cannot be one. */
export function expandFolder(text, home = homedir()) {
    if (typeof text !== 'string') return undefined;
    const t = text.trim();
    if (!t || t.length > 1000 || t.includes('\0')) return undefined;
    const full = t === '~' ? home : t.startsWith('~/') ? join(home, t.slice(2)) : t;
    if (!isAbsolute(full)) return undefined;
    const clean = normalize(full);
    return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

/** Throw unless `settings[key]` is a list of folders. */
function folderList(settings, key) {
    const value = settings?.[key];
    const title = `${SETTING_TITLES[key]} (${key})`;
    if (!Array.isArray(value)) throw new SettingError(key, `${title} must be a list of folders, such as ["~/notes"] (it is ${shown(value)})`);
    if (value.length > MAX_FOLDERS) throw new SettingError(key, `${title} may list at most ${MAX_FOLDERS} folders (it lists ${value.length})`);
    for (const folder of value) {
        if (expandFolder(folder) === undefined) {
            throw new SettingError(key, `${title} must list folders by their full path or a path from ~/, such as ~/notes (${shown(folder)} is not one)`);
        }
    }
    return value;
}

/** Check the settings and say what is wrong in words (a SettingError naming the setting). */
export function checkConfig(settings) {
    const t = SETTING_TITLES;
    onOff(settings, 'enabled', t.enabled);
    onOff(settings, 'sessions', t.sessions);
    for (const key of Object.keys(FOLDER_SETTINGS)) folderList(settings, key);
    onOff(settings, 'tool', t.tool);
}

/**
 * The folders Recall searches, from its settings: this DSH's sessions
 * (when on), then each list's folders, made absolute. The same folder twice
 * counts once, and a folder inside another of the same kind is left out
 * (the outer one holds it), with why in `left`.
 * @param {object} settings
 * @param {{ sessionsDir: string, home?: string }} where - this DSH's sessions folder.
 * @returns {{ sources: { kind: string, root: string, own: boolean }[], left: { kind: string, root: string, why: string }[] }}
 */
export function sourcesOf(settings, { sessionsDir, home = homedir() }) {
    const sources = [];
    const left = [];
    if (settings?.sessions !== false && sessionsDir) sources.push({ kind: 'session', root: sessionsDir, own: true });
    const own = sessionsDir ? normalize(sessionsDir) : '';
    for (const [key, kind] of Object.entries(FOLDER_SETTINGS)) {
        const list = Array.isArray(settings?.[key]) ? settings[key] : [];
        for (const raw of list) {
            const root = expandFolder(raw, home);
            if (!root) continue;
            if (kind === 'session' && (root === own || join(root, 'sessions') === own)) {
                left.push({ kind, root, why: settings?.sessions === false ? 'This is this DSH\'s own sessions folder: switch on "Search this DSH\'s sessions" instead.' : 'This is this DSH\'s own sessions folder, already searched.' });
                continue;
            }
            const same = sources.find((s) => s.kind === kind && (s.root === root || root.startsWith(`${s.root}/`)));
            if (same) {
                left.push({ kind, root, why: same.root === root ? 'Listed twice.' : `Inside ${same.root}, which is already searched.` });
                continue;
            }
            // An outer folder listed after an inner one: the outer one holds it.
            for (let i = sources.length - 1; i >= 0; i -= 1) {
                const s = sources[i];
                if (s.kind === kind && !s.own && s.root.startsWith(`${root}/`)) {
                    left.push({ kind, root: s.root, why: `Inside ${root}, which is already searched.` });
                    sources.splice(i, 1);
                }
            }
            sources.push({ kind, root, own: false });
        }
    }
    return { sources, left };
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
    return changedEntry(check, paths, { name: 'Recall', titles: SETTING_TITLES });
}
