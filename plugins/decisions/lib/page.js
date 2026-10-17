/**
 * What Decisions' page shows, read in one go (no DSH imports, so its tests
 * run anywhere).
 *
 * @module dsh-plugin-decisions/page
 */

/** Log entries the page's history lists, newest first. */
const HISTORY = 150;

/** The page's view of the inbox. */
export async function pageState({ inbox, journal, config, mirror, notifications }) {
    const enabled = config.enabled !== false;
    const { waiting, dismissed } = enabled ? await inbox.list() : { waiting: [], dismissed: [] };
    return {
        enabled,
        sources: {
            approvals: config.approvals !== false,
            questions: config.questions !== false,
            replies: config.replies !== false,
            threads: config.threads !== false,
        },
        notify: config.notify !== false,
        notifications: Boolean(notifications?.()),
        windowHours: config.windowHours,
        waiting,
        dismissed: dismissed.slice(0, 60),
        history: journal.list({ limit: HISTORY }),
        mirror: mirror.status(),
    };
}
