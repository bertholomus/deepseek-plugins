/**
 * dsh-plugin-recall — search everything we already did.
 *
 * Recall keeps a full-text index of past work: this DSH's sessions (one
 * row per turn: what was asked, the reply, the commands and files its tools
 * used), and, when its settings name them, other DSH homes' sessions,
 * coding-agent transcript folders (JSON lines) and Markdown handoff notes.
 * It is local and incremental: one worker thread owns the index (SQLite with
 * FTS5, in DSH's data folder) and reads only what changed, a slice at a
 * time, so DSH's own thread never waits on it.
 *
 * Its page searches with filters (kind, folder, model, date) and opens a
 * result at its exact turn. Agents search with the `recall_search` tool.
 *
 * It needs nothing else running. With Session Watch running, its page
 * updates through the suite's one open request per window.
 *
 * @module dsh-plugin-recall
 */
import { join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { dshHomePath } from '@deepseek-ai/dsh-home-paths';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { LIVE_SETTINGS, checkConfig, savedEntry, sourcesOf } from './config.js';
import { NoteLog, refusalOf, working } from './page.js';
import { RecallRemote, SERVICE } from './remote.js';
import { IndexThread } from './thread.js';
import { toolSpec } from './tool.js';
import { ensurePrivateDir } from './shared/files.js';
import { Journal } from './shared/journal.js';
import { errorText, guard } from './shared/safe.js';
import { SettingsCheck, live, liveSettings } from './shared/settings.js';

export { SETTING_TITLES, LIVE_SETTINGS, checkConfig, changedWords } from './config.js';

export const name = 'recall';

/** Nothing is required: the gateway, the tools and Session Watch are each used when there. */
export const inject = [];

/**
 * Settings: types and defaults here, the rest in checkConfig (lib/config.js),
 * so a wrong value is said in words on Recall's page instead of stopping it
 * at start. The live ones are on its page in Plugins and apply as soon as
 * they are saved.
 */
export const Config = z.object({
    /** Profile only. false keeps Recall loaded but idle: no index thread, and its page says so. */
    enabled: z.boolean().default(true),
    /** Search this DSH's own sessions (its data folder's sessions). */
    sessions: live(z.boolean().default(true)),
    /** Other DSH homes, or their `sessions` folders, to search too. */
    sessionFolders: live(z.array(z.string()).default([])),
    /** Folders of coding-agent transcripts (JSON lines, one message a line), searched with their subfolders. */
    transcriptFolders: live(z.array(z.string()).default([])),
    /** Folders of Markdown handoff notes, searched with their subfolders. */
    handoffFolders: live(z.array(z.string()).default([])),
    /** Offer agents the recall_search tool. */
    tool: live(z.boolean().default(true)),
});

/** How long after a session's event its log is read again (events come in bursts while a turn runs). */
const TOUCH_MS = 1500;

export function apply(ctx, config) {
    const logger = ctx.logger;
    const settings = liveSettings(config);
    // A wrong value never stops Recall from starting: it searches nothing, and its page says which setting to change.
    const check = new SettingsCheck({ settings, check: checkConfig, liveKeys: LIVE_SETTINGS, label: 'recall', logger });
    check.run();

    // The suite's change numbers live with Session Watch; without it the page reads again every few seconds.
    let hub;
    ctx.inject(['sessionWatch'], (scope) => {
        const mine = scope.sessionWatch?.hub;
        hub = mine;
        return () => { if (hub === mine) hub = undefined; };
    });
    const bump = () => { try { hub?.bump?.('recall'); } catch { /* the page reads again later */ } };

    // Its folder in DSH's data folder, as DSH resolves it (DSH_HOME, else ~/.dsh).
    const dir = dshHomePath('recall');
    const sessionsDir = dshHomePath('sessions');
    const journal = new Journal(join(dir, 'events.jsonl'), { logger, onChange: bump });
    const notes = new NoteLog({ journal });

    let lastStatus;
    const thread = new IndexThread({
        file: join(dir, 'index.sqlite'),
        logger,
        onEvent: guard(logger, 'recall: index thread', (message) => {
            switch (message.type) {
                case 'changed':
                    lastStatus = message.status;
                    bump();
                    return;
                case 'note':
                    notes.note(message.note);
                    return;
                case 'log':
                    if (message.level === 'warn') logger?.warn?.(`recall: ${message.text}`);
                    else logger?.info?.(`recall: ${message.text}`);
                    return;
                case 'restarting':
                    journal.add({ kind: 'thread', text: 'The index stopped and starts again', why: message.text, state: 'waiting' });
                    return;
                case 'failed':
                    journal.add({ kind: 'thread', text: 'The index stopped', why: `${String(message.text).replace(/\.$/, '')}. Searches are refused until it runs again: press Start the index again on Recall's page, or restart DSH.`, state: 'failed' });
                    bump();
                    return;
                case 'ready':
                    bump();
                    return;
                default:
            }
        }),
    });

    // The folders to search, from the settings: sent to the index on every start and change. While a setting is
    // wrong the index keeps what it has (searches are refused until it is fixed), so a typo never empties it.
    let sources = { sources: [], left: [] };
    const configure = () => {
        if (!working({ config: settings, check })) return;
        const before = new Set(sources.sources.map((s) => `${s.kind}:${s.root}`));
        sources = sourcesOf(settings, { sessionsDir });
        if (before.size > 0 && sources.sources.some((s) => !before.has(`${s.kind}:${s.root}`))) notes.expectCatchUp('folder');
        thread.call('configure', { sources: sources.sources }, { standing: true }).catch(() => { /* sent again when the thread starts */ });
    };

    const ask = (op, args) => thread.call(op, args, { timeoutMs: 20000 });
    const refusal = () => refusalOf({ config: settings, check, thread });

    // The tool, while the settings offer it: registered and taken away as they change.
    let toolsScope;
    let dropTool;
    const syncTool = () => {
        const want = Boolean(toolsScope) && settings.enabled !== false && check.ok && settings.tool !== false;
        if (want && !dropTool) {
            try {
                const off = toolsScope.tools.register(defineTool(toolSpec({ ask, refusal })));
                dropTool = typeof off === 'function' ? off : () => {};
            } catch (error) {
                logger?.warn?.(`recall: could not offer recall_search to agents: ${errorText(error)}`);
            }
        } else if (!want && dropTool) {
            try { dropTool(); } catch { /* already gone */ }
            dropTool = undefined;
        }
    };
    ctx.inject(['tools'], (scope) => {
        toolsScope = scope;
        syncTool();
        return () => {
            toolsScope = undefined;
            try { dropTool?.(); } catch { /* the scope took it */ }
            dropTool = undefined;
        };
    });

    if (settings.enabled !== false) {
        try {
            ensurePrivateDir(dir);
        } catch (error) {
            logger?.warn?.(`recall: could not make its folder ${dir}: ${errorText(error)}`);
        }
        configure();
        thread.start();

        // A session moved: read its log again soon (events come in bursts while a turn runs).
        const touched = new Set();
        let touchTimer;
        ctx.on('session/event', guard(logger, 'recall: session event', (session) => {
            const id = typeof session?.id === 'string' ? session.id : undefined;
            if (!id || !working({ config: settings, check }) || settings.sessions === false) return;
            touched.add(id);
            if (touchTimer) return;
            touchTimer = setTimeout(() => {
                touchTimer = undefined;
                const ids = [...touched];
                touched.clear();
                thread.call('touch', { sessionIds: ids }).catch(() => { /* the next walk reads it */ });
            }, TOUCH_MS);
            touchTimer.unref?.();
        }));
        ctx.effect(() => () => {
            clearTimeout(touchTimer);
            notes.stop();
            void thread.stop();
        }, 'recall: index thread');
    }

    // Settings saved on Recall's page in Plugins: checked again, and they apply at once.
    ctx.on('loader/volatile-update', guard(logger, 'recall: settings', (paths) => {
        const entry = savedEntry(check, paths);
        if (entry) journal.add(entry);
        if (settings.enabled !== false) configure();
        syncTool();
        bump();
    }));

    const actions = {
        rebuild() {
            notes.expectCatchUp('rebuild');
            journal.add({ kind: 'rebuild', text: 'Rebuilding the index', why: 'You asked: every file is read again. Searches keep working and find more as it goes.', state: 'running' });
        },
        restart() {
            journal.add({ kind: 'thread', text: 'Starting the index again', why: 'You asked, after it had stopped.', state: 'running' });
            thread.revive();
            bump();
        },
    };

    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new RecallRemote({
            config: settings, check, thread, journal, actions,
            sources: () => sources,
            lastStatus: () => lastStatus,
        }));
    });
}
