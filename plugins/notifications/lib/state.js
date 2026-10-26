/**
 * dsh-plugin-notifications, what it keeps on disk: the queue for DSH's
 * window, the next id, and the recent notifications with what became of
 * each. One small JSON file in the plugin's folder in DSH's data folder
 * (folder 700, file 600: titles name sessions), written whole to a
 * temporary file and renamed, so a crash leaves the old file or the new
 * one, never half of one.
 *
 * Kept so that a restart (DSH's, or the plugin's own after a settings save)
 * loses nothing still worth showing and repeats nothing already shown: ids
 * keep counting up across restarts, and a window that took an item before
 * the restart never gets it again.
 *
 * @module dsh-plugin-notifications/state
 */
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** An empty state: nothing queued, nothing recent, ids from 1. */
export const emptyState = () => ({ seq: 0, epoch: '', queue: [], recent: [] });

/** A state read from disk, with anything malformed left out (never a throw). */
export function parseState(value) {
    const out = emptyState();
    if (!isRecord(value)) return out;
    if (Number.isInteger(value.seq) && value.seq > 0) out.seq = value.seq;
    if (typeof value.epoch === 'string' && /^[\w-]{1,40}$/.test(value.epoch)) out.epoch = value.epoch;
    const item = (entry) => isRecord(entry) && Number.isInteger(entry.id) && typeof entry.title === 'string' && typeof entry.at === 'string';
    if (Array.isArray(value.queue)) out.queue = value.queue.filter(item);
    if (Array.isArray(value.recent)) out.recent = value.recent.filter((entry) => item(entry) && typeof entry.state === 'string');
    // Ids only ever count up, even if the counter was lost.
    for (const entry of [...out.queue, ...out.recent]) out.seq = Math.max(out.seq, entry.id);
    return out;
}

/**
 * The state file. `load` never throws (a missing or broken file is an empty
 * state, and a broken one is reported once); `save` reports a failure
 * through `onError` and never throws either.
 */
export class StateFile {
    /**
     * @param {string} file - the file's absolute path.
     * @param {{ onError?: (what: string, error: unknown) => void }} [options]
     */
    constructor(file, { onError = () => {} } = {}) {
        this.file = file;
        this.onError = onError;
    }

    load() {
        let text;
        try {
            text = readFileSync(this.file, 'utf8');
        } catch (error) {
            if (error?.code !== 'ENOENT') this.onError('could not read its saved state', error);
            return emptyState();
        }
        try {
            return parseState(JSON.parse(text));
        } catch (error) {
            this.onError('its saved state was unreadable, so it starts empty', error);
            return emptyState();
        }
    }

    /** @returns whether the state reached the disk. */
    save(state) {
        try {
            const dir = dirname(this.file);
            mkdirSync(dir, { recursive: true, mode: 0o700 });
            chmodSync(dir, 0o700);
            const temp = `${this.file}.${process.pid}.tmp`;
            writeFileSync(temp, `${JSON.stringify({ seq: state.seq, epoch: state.epoch, queue: state.queue, recent: state.recent })}\n`, { mode: 0o600 });
            renameSync(temp, this.file);
            return true;
        } catch (error) {
            this.onError('could not save its state', error);
            return false;
        }
    }
}
