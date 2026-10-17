/**
 * What Autopilot's page shows, read from the pilot, the watcher and the
 * event log in one go (no DSH imports, so its tests run anywhere).
 *
 * @module dsh-plugin-autopilot/page
 */
import { basename } from 'node:path';
import { openWork } from './notes.js';

/** How many sessions the page lists. */
const MAX_SESSIONS = 80;

/** The page's view of everything Autopilot knows. */
export async function pageState({ pilot, watch, journal, config }) {
    const rows = await watch.list();
    const pending = pilot.pending();
    const latest = new Map();
    for (const entry of journal.list({ limit: 400 })) if (entry.sessionId && !latest.has(entry.sessionId)) latest.set(entry.sessionId, entry);
    const sessions = [];
    for (const row of rows) {
        if (row.parentSessionId || row.origin === 'subagent' || row.blank) continue;
        if (sessions.length >= MAX_SESSIONS) break;
        const s = pilot.data.sessions[row.sessionId] ?? {};
        const last = latest.get(row.sessionId);
        sessions.push({
            sessionId: row.sessionId,
            title: row.title || 'Untitled session',
            folder: row.cwd ? basename(row.cwd) : '',
            word: row.word,
            work: openWork(row.state) || '',
            rule: pilot.ruleOf(row.sessionId),
            own: Object.hasOwn(pilot.data.rules, row.sessionId),
            updatedAt: row.updatedAt,
            ...(pending[row.sessionId] ? { next: pending[row.sessionId] } : {}),
            ...(s.backedOff ? { backedOff: s.backedOff } : {}),
            ...(s.gaveUp ? { gaveUp: s.gaveUp } : {}),
            ...(last ? { last: { text: last.text, state: last.state, at: last.at } } : {}),
        });
    }
    const hourAgo = Date.now() - 3600000;
    return {
        enabled: config.enabled !== false,
        paused: pilot.data.paused === true,
        defaultRule: pilot.defaultRule(),
        settings: {
            idleSeconds: config.idleSeconds,
            maxNotesPerHour: config.maxNotesPerHour,
            maxNudges: config.maxNudges,
            resumeWindowHours: config.resumeWindowHours,
            resumeAfterRestart: config.resumeAfterRestart !== false,
        },
        notesLastHour: pilot.data.notes.filter((at) => at > hourAgo).length,
        watching: rows.filter((row) => !row.parentSessionId && row.origin !== 'subagent').length,
        sessions,
        asks: (watch.asks?.() ?? []).filter((ask) => ask.source === 'Autopilot'),
        log: journal.list({ limit: 150 }),
    };
}
