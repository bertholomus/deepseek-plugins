/**
 * The project runtime. Each configured project has one coordinator session;
 * the coordinator starts thread sessions with project tools, threads report
 * back with handbacks, and both kinds of session are ordinary DSH sessions
 * created through the Host's own sessionController, so they show live in the
 * DSH window.
 *
 * Project behaviour is attached to the live Agent, not to the session file:
 * on every `agent/created` (fresh, resumed, cleared) the manager looks the
 * session up in the store and installs agent-scoped tools, a system prompt
 * section and, for threads, the idle watcher. Other sessions never see any
 * of it.
 *
 * Models and effort are set the way the DSH model picker sets them: a durable
 * `model/selection` on the one session, so the DSH window shows the right
 * model. The picker's public path (`sessionController.selectModel`) also
 * overwrites the global default model, so the manager calls the controller's
 * per-session step directly. When a Host does not have that step, it falls
 * back to rewriting every model request of project sessions.
 *
 * The binding runs both ways: a model the user picks in DSH's own picker for
 * a coordinator becomes the project's coordinator setting, and one picked
 * for a thread becomes that thread's, so the project's settings always say
 * what its sessions run on. Permission presets are set and followed the
 * same way, through DSH's own permission presets.
 *
 * The user's own tools (config.guardedTools: their MCP servers for
 * passwords, notes, lanes and the like) stay out of project sessions under
 * yourTools "asked": the manager leaves them out of what each session's
 * model is offered (DSH's per-agent tools.restrict) and refuses a call to
 * one anyway (tools.guard). A thread gets the ones the user's own words for
 * it name, checked against what the user wrote to the coordinator.
 *
 * The plugin's messages go into a session the way DSH's own agents and
 * plugins send theirs, not as the user's: a brief or a coordinator's message
 * is an agent's message from the coordinator, a handback one from the
 * thread, and the automatic notes and the welcome are a plugin's message.
 * DSH draws each as a collapsed notice ("Task message received", "Plugin
 * status updated") instead of a user bubble; the model reads the same text.
 *
 * @module dsh-plugin-projects/projects
 */
import { appendFileSync, readFileSync, writeFileSync, statSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { ProjectStore, expand, dataPath, ensurePrivateDir } from './store.js';
import {
    SETTING_KEYS, ACCESS_KEYS, TOOL_MODES, effectiveSettings, effectiveAccess, applyRoute, checkSelection, describeRoute, parseModelSpec, pluginDefaults, liveValue,
} from './settings.js';
import {
    coordinatorPolicy, threadPolicy, rosterLines, briefMessage, coordinatorMessage, cardSummary,
    handbackMessage, idleMessage, approvalMessage, questionMessage, userMustFix, welcomeMessage, describeEnding, endingStateOf, continueMessage, HANDBACK_STATUSES, TAGS, STOPPED_BY_USER, NUDGE,
    outsideMessage, replyMessage,
} from './prompts.js';
import { META_MARK, MAX_THREADS, PROJECTION_KEY } from './projection.js';
import { changeRecord, changeTotals, withChange, editsIn, editOf, editSummary, FILE_TOOLS } from './changes.js';
import { sendOf, codeSendOf } from './sends.js';

/** Order of the project section in the assembled system prompt (after first-party guidance). */
const SECTION_ORDER = 9500;
const HOUR = 60 * 60 * 1000;
/** DSH keeps a session title to 80 bytes of UTF-8 (`maxTitleBytes` in its base profile) and cuts anything longer. */
const TITLE_BYTES = 80;
/** The longest goal the user can set in Project settings: it goes into every request of the project's sessions. */
const GOAL_CHARS = 2000;

/**
 * A thread's one title, used for its session and everywhere the plugin names it. It fits DSH's session-title
 * limit, so DSH never cuts it again; a longer title is cut once, after the last whole word that fits, with "…".
 * `cut` says the text was already cut short (by an older version), so it ends at a word with "…" even if it fits.
 */
export function clipTitle(value, { cut = false } = {}) {
    const line = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!cut && Buffer.byteLength(line) <= TITLE_BYTES) return line;
    const room = TITLE_BYTES - Buffer.byteLength('…');
    let fit = '';
    let bytes = 0;
    for (const char of line) {
        bytes += Buffer.byteLength(char);
        if (bytes > room) break;
        fit += char;
    }
    // Back up to the end of the last whole word, unless that would leave less than half.
    if (fit.length < line.length ? line[fit.length] !== ' ' : cut) {
        const space = fit.lastIndexOf(' ');
        if (space >= fit.length / 2) fit = fit.slice(0, space);
    }
    const end = fit.replace(/[\s.,;:!?…–—-]+$/u, '');
    return `${end === '' ? fit : end}…`;
}

/** A title as DSH keeps it: one line, cut at its byte limit wherever that falls. */
function dshTitle(value) {
    let out = '';
    let bytes = 0;
    for (const char of String(value ?? '').replace(/\s+/g, ' ').trim()) {
        bytes += Buffer.byteLength(char);
        if (bytes > TITLE_BYTES) break;
        out += char;
    }
    return out.trimEnd();
}

/** Delivery retry delays for a coordinator that cannot take a message; tests shorten them. */
export const timing = { retryMs: 60000, maxRetryMs: 15 * 60000 };

/** What project_handback returns. The idle review counts a turn as handed back by these texts. */
const HANDBACK_SENT = 'Handback delivered to the coordinator.';
const HANDBACK_HELD = 'Handback saved; the coordinator gets it when the project resumes.';
const HANDBACK_RETRY = 'Handback saved; the coordinator could not take it just now, and it is sent again automatically.';
const QUESTION_SENT = 'Asked. Carry on with what doesn\'t depend on the answer; it arrives here as a message from the coordinator. If nothing can go on without it, end your turn with one short line.';
const QUESTION_HELD = 'Saved; the coordinator gets it when the project resumes. Pick a sensible default, say which, and carry on.';
const QUESTION_RETRY = 'Saved; the coordinator could not take it just now, and it is sent again automatically. Carry on with what doesn\'t depend on the answer.';
/** Why work for an archived project is refused, by its tools and in the window. */
const ARCHIVED = 'the project is archived; restore it first';
/** DSH's tools that change files, which a coordinator on Read Only is refused (str_replace_editor's view only reads). */
const WRITE_TOOLS = new Set(['write', 'edit', 'str_replace_editor']);
const READ_ONLY_REASON = 'You are on Read Only, so you don\'t change files. Start a thread for this change with project_thread_start, or send it to the thread already doing that work.';
/**
 * A coordinator on Read Only asking for a wider sandbox (DSH's shell, file and code tools take `sandbox_permissions`):
 * refused before DSH asks anyone, so it never reads as the user's refusal and isn't taken for a reason to widen its access.
 */
const READ_ONLY_WIDER = 'You are on Read Only, so this didn\'t run and nobody was asked: a step that needs more than reading belongs in a thread. Start one for it with project_thread_start, or send it to the thread already doing that work. Don\'t suggest widening your access.';
/** Whether a call asks for a sandbox wider than reading. */
const asksWider = (exec) => {
    const mode = isObject(exec?.arguments) ? exec.arguments.sandbox_permissions : undefined;
    return typeof mode === 'string' && mode.trim() !== '' && mode.trim() !== 'read-only';
};
/**
 * DSH's tools a coordinator is kept off: a DSH goal's rounds had it read and steer its threads again and again
 * (behaviour review 3), while their handbacks come on their own. A goal the user sets with /goal still runs.
 */
const COORDINATOR_HIDDEN = new Set(['create_goal']);
const GOAL_REASON = 'A coordinator doesn\'t set DSH goals: your threads hand back when they finish, so nothing needs to continue in rounds. The project\'s goal is the user\'s, in Project settings.';
/** DSH's tools that run a command or code: what they send outside the workspace waits for the user (holdSend). */
const SEND_TOOLS = new Set(['bash', 'pwsh', 'run_code']);
/** The largest script or package.json the send check reads to see what a command runs. */
const MAX_SCRIPT_BYTES = 256 * 1024;
/** Why a command that sends didn't run, by who tried it; `what` says what it sends ("sends a POST to …"). */
const SEND_REASONS = {
    coordinator: (what) => `Not run: the command ${what}. You don't send anything yourself: start a thread with the user's words in \`ask\`; it asks the user before each command that sends.`,
    subagent: (what) => `Not run: the command ${what}. A subagent doesn't send anything outside the workspace: say in your result what you would send, and the thread you work for asks the user first.`,
    never: (what) => `Not run: the command ${what}. A thread asks the user before each command that sends outside the workspace, and this thread's permission never asks. Hand back with status needs_decision and say exactly what you would send; the user can put this thread on Workspace Write so it can ask. Don't send it another way.`,
};

/** DSH's tools that reach an MCP server named in their `server` argument, not in their own name. */
const SERVER_TOOLS = new Set(['list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A stored project's name, trimmed; '' when the store holds none. */
const storedName = (stored) => (typeof stored?.name === 'string' ? stored.name.trim() : '');

/**
 * Lower-kebab id from a project name. Letters in any script are kept
 * (前端 and 后端 stay apart); accents are dropped.
 */
export function slugify(name) {
    const slug = String(name ?? '').normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
    return [...slug].slice(0, 48).join('').replace(/-+$/, '') || 'project';
}

/** The newest manager per store file. One left over from a config reload hands late work to it. */
const managers = new Map();
/** Every manager not yet disposed. */
const liveManagers = new Set();
/** Coordinator checks in flight, by store file and project, so two managers never make two coordinators. */
const ensuring = new Map();
/** Archives and restores in flight, by store file and project: one at a time, and DSH's own archive set changing meanwhile is theirs. */
const archiving = new Map();

/** Whether a session read failed because the session does not exist, not for another reason. */
function isNotFound(error) {
    return error?.constructor?.name === 'ApiSessionNotFound' || error?.code === 'session/not-found'
        || /not[ -]found/i.test(String(error?.message ?? ''));
}

/**
 * config.guardedTools as [name, aliases] pairs. It is a list of MCP server
 * (or tool) names, or a map from each name to the words the user may call
 * it by, such as "lane-catalog": ["lanes", "model lanes"].
 */
export function guardList(guardedTools) {
    const entries = Array.isArray(guardedTools) ? guardedTools.map((name) => [name, []]) : Object.entries(guardedTools ?? {});
    return entries
        .map(([name, aliases]) => [String(name ?? '').trim(), (Array.isArray(aliases) ? aliases : []).map((a) => String(a ?? '').trim()).filter(Boolean)])
        .filter(([name]) => name);
}

/** Text as lower-case words between spaces: "-", "_" and other marks all separate words. */
const wordsOf = (text) => ` ${String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Whether words (from wordsOf) hold a name as whole words, also in the plural. */
function holds(words, name) {
    const w = wordsOf(name).trim();
    return w !== '' && [` ${w} `, ` ${w}s `, ` ${w}es `].some((form) => words.includes(form));
}

/**
 * The user's answers in DSH's question box (ask_user_question) in a
 * session's log: the options they picked and what they typed. The tool's
 * result is the answers as JSON ({answers: [{id, selected, custom?}]}).
 */
export function questionAnswers(events) {
    const asked = new Set();
    const out = [];
    for (const event of Array.isArray(events) ? events : []) {
        const data = event?.data;
        if (event?.type === 'tool/call' && data?.name === 'ask_user_question' && typeof data.callId === 'string') {
            asked.add(data.callId);
            continue;
        }
        if (event?.type !== 'tool/result' || !asked.has(data?.message?.toolCallId) || data.error !== undefined || data.message.isError === true) continue;
        const text = (Array.isArray(data.message.content) ? data.message.content : []).find((b) => b?.type === 'text')?.text;
        let parsed;
        try { parsed = JSON.parse(text); } catch { continue; }
        for (const answer of Array.isArray(parsed?.answers) ? parsed.answers : []) {
            for (const picked of Array.isArray(answer?.selected) ? answer.selected : []) if (typeof picked === 'string') out.push(picked);
            if (typeof answer?.custom === 'string') out.push(answer.custom);
        }
    }
    return out;
}

/**
 * The guarded tools a text names: by name, also inside a tool id such as
 * mcp__lane-catalog__lanes_status, and with `aliases`, by the words the
 * user may call one by. A brief uses a tool when it names it; the user's
 * words ask for one when they name it or an alias.
 */
export function guardedIn(text, guard, { aliases = false } = {}) {
    const words = wordsOf(text);
    return guard.filter(([name, alias]) => holds(words, name) || (aliases && alias.some((a) => holds(words, a)))).map(([name]) => name);
}

/** A thread's latest tool calls, newest last, each with the argument that says what it touched: 'bash "npm test"; read "src/a.js"'. */
function stepsOf(events, max = 8) {
    const calls = events.filter((e) => e?.type === 'tool/call' && typeof e.data?.name === 'string').slice(-max);
    return calls.map((e) => {
        const args = argsOf(e.data.arguments);
        const what = ['command', 'path', 'file_path', 'pattern', 'query', 'url', 'thread', 'question']
            .map((key) => args?.[key]).find((v) => typeof v === 'string' && v.trim() !== '');
        return what ? `${e.data.name} ${JSON.stringify(what.replace(/\s+/g, ' ').slice(0, 80))}` : e.data.name;
    }).join('; ');
}

/** The files a thread's turns changed, merged by path: "src/a.js (+3 −1), README.md (+10 −0)", or ''. */
function changedFiles(records, max = 12) {
    const byPath = new Map();
    for (const r of Array.isArray(records) ? records : []) {
        for (const f of Array.isArray(r?.files) ? r.files : []) {
            if (typeof f?.path !== 'string' || f.path === '') continue;
            const was = byPath.get(f.path) ?? { added: 0, deleted: 0 };
            byPath.set(f.path, { added: was.added + (Number(f.added) || 0), deleted: was.deleted + (Number(f.deleted) || 0) });
        }
    }
    const list = [...byPath].slice(0, max).map(([path, n]) => `${path} (+${n.added} −${n.deleted})`);
    return list.length === 0 ? '' : `${list.join(', ')}${byPath.size > max ? `, and ${byPath.size - max} more` : ''}`;
}

/** Whether a folder is the user's home folder, where a project must not scatter files. */
const isHome = (folder) => typeof folder === 'string' && expand(folder).replace(/\/+$/, '') === homedir().replace(/\/+$/, '');

/** The plugin's own tools, never taken for one of the user's even when a guarded name is a word in them. */
const OWN_TOOLS = new Set(['project_memory', 'project_handback', 'project_ask_coordinator', 'project_thread_start', 'project_thread_send', 'project_thread_list', 'project_thread_read', 'project_thread_update', 'project_settings', 'project_message']);

/** Text as its words alone (lower case, no punctuation), to find an ask in what the user wrote. */
const wordsKey = (text) => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The first sentence of an `ask` that isn't in what the user wrote, or '':
 * each must be there word for word (case and punctuation aside), so the
 * user's sentences may come from different messages but none may be the
 * coordinator's own.
 */
export function unsaidPart(ask, said) {
    const corpus = ` ${wordsKey(said)} `;
    for (const part of String(ask ?? '').split(/[.!?;…]+(?=\s|$)|\n+/)) {
        const key = wordsKey(part);
        if (key !== '' && !corpus.includes(` ${key} `)) return part.trim();
    }
    return '';
}

/** What a handback's card shows of its summary, in characters. */
const CARD_CHARS = 300;

/** Messages to chats outside a project that wait for their reply: at most this many per project, for this long. */
const MAX_AWAITING = 20;
/**
 * What the user hears about from anywhere in the window (the ◆ row's mark
 * and a notice): a thread handed back, finished its turn without one, waits
 * on the user's approval, or failed or stopped after its nudge. The newest
 * are kept per project.
 */
export const NEWS_KINDS = ['handback', 'finished', 'approval', 'failed', 'stopped'];
const MAX_NEWS = 20;
const AWAIT_MS = 24 * 60 * 60 * 1000;

/** The guarded names (guardList) a tool's name holds: mcp__lane-catalog__lanes_status holds lane-catalog. */
const guardsOfTool = (name, guard) => (typeof name === 'string' && !OWN_TOOLS.has(name) ? guardedIn(name, guard) : []);

/** What a session's call to one of the user's tools it may not use returns, before the call reaches the tool. */
const WALL_REASONS = {
    coordinator: 'This is one of the user\'s own tools, which this project keeps out of the coordinator. When the user asks for work that needs it, start a thread with their words in ask: the thread gets the tools their words name.',
    thread: 'This is one of the user\'s own tools, and the user\'s words for this thread don\'t name it. If the task needs it, hand back with status blocked and say so.',
};

/** One thread as the DSH window shows it in a roster (see projection.js). */
function rosterEntry(id, t) {
    const entry = { id, session: t.sessionId, title: t.title, resolved: t.resolved === true };
    if (t.createdAt) entry.created = t.createdAt;
    if (t.lastHandback) entry.handback = { status: t.lastHandback.status, summary: cardSummary(t.lastHandback.summary, 300), at: t.lastHandback.at ?? null };
    return entry;
}

/** Thread ids for a full roster: every open thread, then the newest resolved ones. */
function rosterIds(threads) {
    const ids = Object.keys(threads ?? {}).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const open = ids.filter((id) => !threads[id].resolved);
    const resolved = ids.filter((id) => threads[id].resolved).slice(-Math.max(MAX_THREADS - open.length, 0));
    const keep = new Set([...open, ...resolved]);
    return ids.filter((id) => keep.has(id));
}

/** The handbacks among the messages a pause holds: which thread, with what status. */
function heldHandbacks(pending) {
    const out = [];
    for (const item of Array.isArray(pending) ? pending : []) {
        const text = typeof item === 'string' ? item : typeof item?.text === 'string' ? item.text : '';
        const m = /^\[Handback from thread (t\d+) · ".*" · status: ([a-z_]+)\]$/.exec(text.split('\n', 1)[0]);
        if (m) out.push({ thread: m[1], status: m[2] });
    }
    return out;
}

/**
 * A file's text for the send check: a regular file of at most
 * MAX_SCRIPT_BYTES inside one of the folders (links followed), else
 * undefined. Nothing outside the workspace is read.
 */
function textInside(roots, path) {
    try {
        const full = realpathSync(path);
        const inside = roots.some((root) => {
            let real;
            try { real = realpathSync(root); } catch { return false; }
            return full === real || full.startsWith(real.endsWith(sep) ? real : `${real}${sep}`);
        });
        if (!inside) return undefined;
        const stat = statSync(full);
        return stat.isFile() && stat.size <= MAX_SCRIPT_BYTES ? readFileSync(full, 'utf8') : undefined;
    } catch {
        return undefined;
    }
}

/** Arguments of a logged tool call: an object, or JSON text. */
function argsOf(value) {
    if (typeof value !== 'string') return value ?? {};
    try { return JSON.parse(value); } catch { return {}; }
}

/** A session's own events from DSH's inspect: a forked session's log starts with its parent's, which aren't its own. */
function ownEvents(inspected) {
    const events = Array.isArray(inspected?.events) ? inspected.events : [];
    const inherited = Number.isSafeInteger(inspected?.inheritedEventCount) ? inspected.inheritedEventCount : 0;
    return inherited > 0 ? events.slice(inherited) : events;
}

/** Text of one message-like session event, or ''. */
function textOf(event) {
    const content = (event?.data?.message ?? event?.data)?.content;
    if (!Array.isArray(content)) return '';
    return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');
}

/** Role of one message-like session event, or null. */
function roleOf(event) {
    const role = event?.data?.message?.role;
    if (role) return role;
    if (event?.type === 'assistant/message') return 'assistant';
    if (event?.type === 'user/message') return 'user';
    return null;
}

/** Request ids of the prompts earlier versions sent as the user's; they mark coordinator-driven turns. */
const RPC_PREFIX = 'projects-';

/** Who a plugin message comes from, as DSH records its own: an agent (a session) or a plugin. */
const agentSource = (senderSessionId) => ({ kind: 'agent-message', form: 'relay', senderSessionId });
const PLUGIN_SOURCE = Object.freeze({ kind: 'cordis-host-runner' });
const PLUGIN_KINDS = new Set(['agent-message', PLUGIN_SOURCE.kind]);
const PROJECT_TAGS = Object.values(TAGS);

/**
 * A prompt someone sent to the session, or null. The user's own messages
 * have source kind "user"; so did this plugin's before it sent them as an
 * agent's or a plugin's message. Other user-role messages DSH adds (runtime
 * context, model-change notices, its own agents' messages) are not prompts.
 */
function promptOf(event) {
    if (roleOf(event) !== 'user') return null;
    const source = (event?.data?.message ?? event?.data)?.source;
    const text = textOf(event);
    if (!text) return null;
    if (source?.kind === undefined || source.kind === 'user') {
        const fromProject = String(source?.rpcId ?? '').startsWith(RPC_PREFIX) || text.startsWith(TAGS.brief) || text.startsWith(TAGS.coordinator);
        return { text, fromProject };
    }
    if (PLUGIN_KINDS.has(source.kind) && PROJECT_TAGS.some((tag) => text.startsWith(tag))) return { text, fromProject: true };
    return null;
}

/**
 * Where one turn sits in a session log. `current` is the turn running now;
 * otherwise the last turn that ended. A log without turn markers counts as
 * one turn. Returns event indexes [start, end), the end reason and whether
 * the turn has ended.
 */
function turnRange(events, current) {
    const lastIndex = (type, before) => {
        for (let i = before - 1; i >= 0; i--) if (events[i]?.type === type) return i;
        return -1;
    };
    const lastEnd = lastIndex('turn/end', events.length);
    if (current) {
        const lastStart = lastIndex('turn/start', events.length);
        return { start: lastStart > lastEnd ? lastStart : lastEnd + 1, end: events.length, ended: false };
    }
    if (lastEnd < 0) return { start: Math.max(lastIndex('turn/start', events.length), 0), end: events.length, ended: false };
    const start = Math.max(lastIndex('turn/start', lastEnd), lastIndex('turn/end', lastEnd) + 1);
    return { start, end: lastEnd + 1, reason: events[lastEnd].data?.reason ?? null, ended: true };
}

/** What the manager stored as a coordinator's applied route, to tell when its settings changed. */
function routeKey(model, effort) {
    return JSON.stringify([model ?? null, effort ?? null]);
}

/** A model selection as one comparable string. */
function selectionKey(selection) {
    return `${selection?.provider}\u0000${selection?.model}\u0000${selection?.reasoningEffort ?? ''}`;
}

export class ProjectError extends Error {}

export class ProjectManager {
    /**
     * @param {object} options
     * @param {object} options.ctx - plugin context (sessionController, workspaceRegistry, agents).
     * @param {object} options.config - validated plugin config.
     * @param {Function} options.buildTools - (manager, who) => tool definitions for one agent.
     */
    constructor({ ctx, config, buildTools }) {
        this.ctx = ctx;
        this.config = config;
        this.buildTools = buildTools;
        /** The store's file; its copy is `store`. */
        this.storeFile = dataPath(config.storeFile);
        // With no other manager running on the file (the plugin was switched off, or this is the first), read it
        // again: it may have changed while the plugin was off. One still running (a config reload) shares its copy.
        if (![...liveManagers].some((m) => m.storeFile === this.storeFile)) ProjectStore.release(this.storeFile);
        liveManagers.add(this);
        managers.set(this.storeFile, this);
        this.disposed = false;
        this.logFile = config.logFile ? dataPath(config.logFile) : '';
        if (this.logFile) {
            try { ensurePrivateDir(dirname(this.logFile)); } catch {}
        }
        /**
         * 'session': set models with the controller's per-session selection.
         * 'override': this Host lacks it; rewrite each project model request.
         */
        this.selectionMode = typeof ctx.sessionController?.agents?.selectForNextRequest === 'function' ? 'session' : 'override';
        /**
         * projectId → the project: a row in the profile, which always has a
         * coordinator, or one made on the Projects page or imported, which
         * gets one when the user adds it.
         */
        this.projects = new Map();
        for (const row of config.projects ?? []) {
            const id = slugify(row.id || row.name);
            if (this.projects.has(id)) {
                this.log(`config duplicate project id ${id}; keeping the first row`);
                ctx.logger?.warn?.('projects: two projects have the id "%s"; only the first runs. Give the other an id.', id);
                continue;
            }
            this.projects.set(id, { ...row, id, source: 'profile', workspacePath: expand(row.workspacePath) });
        }
        for (const id of Object.keys(this.store.projects)) this.addStored(id);
        /** Agent → disposer for its installed project scope. */
        this.installed = new Map();
        /** sessionId → {running, stopped?: {key}} for thread turn tracking. */
        this.turns = new Map();
        /** sessionId → (approval id → timer) for permission prompts not yet answered. */
        this.approvals = new Map();
        /** projectId → tail of its delivery chain, so messages reach the coordinator in order. */
        this.chains = new Map();
        /** projectId → {timer, attempt} for held messages waiting on a retry. */
        this.retries = new Map();
        /** sessionId → the selection the manager just made there, so its own `model/selection` is not taken for the user's pick. */
        this.ownSelections = new Map();
        /** Agent → who it is ({projectId, role, threadId?}), for every agent the manager installed on. */
        this.roles = new Map();
        /** Agent → {key, dispose}: the user's tools it doesn't see (tools.restrict), as a sorted key. */
        this.walls = new Map();
        /** sessionId → the permission preset the manager just put it on, so its own `permission/preset` is not taken for the user's pick. */
        this.ownPermissions = new Map();
        /** The pending pass over every wall after DSH's tool list changed. */
        this.wallTimer = undefined;
        /** Session ids of chats outside a project that owe a coordinator the reply to its message (project_message). */
        this.awaited = new Set();
        /** sessionId → the check of its replies running now, so one reply is never delivered twice. */
        this.replyChecks = new Map();
        /** Thread sessionId → (turn → the seq of DSH's announcement of that turn's changes), so its Review tab opens the turn. */
        this.announced = new Map();
        /** Thread sessionId → its turn now (the last `turn/start`), for what its subagents change meanwhile. */
        this.threadTurns = new Map();
        /** Thread sessionId → its subagents' edits, newest last: [{turn, path, added, deleted}]. */
        this.subEdits = new Map();
        /** `${sessionId}\n${callId}` → a subagent's file-tool call waiting for its result: {name, args, thread}. */
        this.subCalls = new Map();
        /** A subagent's sessionId → the thread session it works for, or null when none. */
        this.subThreads = new Map();
        /** A session's id → the project session it works for as a subagent ({projectId, role, threadId?}), or null. */
        this.subProjects = new Map();
        /** How long a thread turn's changes wait for DSH's announcement before they are kept without it. */
        this.announceWaitMs = 3000;
    }

    /** One action line, mode 600. Sizes and ids only, never prompt text. */
    log(line) {
        if (!this.logFile) return;
        try { appendFileSync(this.logFile, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 }); } catch {}
    }

    get sc() {
        return this.ctx.sessionController;
    }

    /**
     * The file's shared copy, looked up on each use: a tool call that
     * outlives this manager (a config reload, the plugin switched off) writes
     * into the copy the newest manager reads, never over it.
     */
    get store() {
        return ProjectStore.open(this.storeFile);
    }

    project(projectId) {
        const p = this.projects.get(projectId);
        if (!p) throw new ProjectError(`project "${projectId}" is not configured`);
        return p;
    }

    /**
     * Add a project the store defines (made in the window) to the running
     * set. A profile row with the same id wins. Its folder is its
     * coordinator's workspace. A group of workspaces from an older version
     * of the plugin that never got a coordinator is not a project.
     */
    addStored(projectId) {
        const stored = this.store.projects[projectId];
        if (stored === null || typeof stored !== 'object' || this.projects.has(projectId)) return;
        if (typeof stored.home !== 'string' && typeof stored.coordinatorSessionId !== 'string') return;
        // One with no name in the store (a profile row since removed) still has its coordinator and threads to keep
        // together; its coordinator's title names it (nameNameless).
        if (storedName(stored) === '' && typeof stored.coordinatorSessionId !== 'string') return;
        const manager = this;
        this.projects.set(projectId, {
            id: projectId,
            goal: '',
            source: stored.source === 'import' ? 'import' : 'page',
            get name() { return storedName(manager.store.projects[projectId]) || projectId; },
            get workspacePath() { return manager.homeOf(projectId)?.path; },
        });
    }

    /** Whether the project is a row in the profile (its name, folder and coordinator are set there). */
    fromProfile(projectId) {
        return this.projects.get(projectId)?.source === 'profile';
    }

    /** DSH's workspace with this id, or undefined. */
    workspace(workspaceId) {
        try {
            return typeof workspaceId === 'string' && workspaceId !== '' ? this.ctx.workspaceRegistry?.get?.(workspaceId) : undefined;
        } catch {
            return undefined;
        }
    }

    /** DSH's workspaces in its own (sidebar) order. */
    workspaceList() {
        try {
            const list = this.ctx.workspaceRegistry?.list?.();
            return Array.isArray(list) ? list : [];
        } catch {
            return [];
        }
    }

    /** The DSH workspace a project's coordinator and threads work in, once DSH has it. */
    homeOf(projectId) {
        return this.workspace(this.store.projects[projectId]?.home);
    }

    /** Note which DSH workspace a profile project's folder is, once DSH has one there. */
    async noteHome(projectId) {
        if (!this.fromProfile(projectId)) return;
        let ws;
        try { ws = await this.ctx.workspaceRegistry.resolveByPath(this.project(projectId).workspacePath); } catch { ws = undefined; }
        if (!ws?.id) return;
        const stored = this.store.project(projectId);
        if (stored.home !== ws.id) this.store.putProject(projectId, { home: ws.id });
    }

    settings(projectId) {
        return effectiveSettings(pluginDefaults(this.config), this.project(projectId), this.store.project(projectId).settings);
    }

    /** The project's access settings: the user's tools, coordinator and thread permissions, each with its source. */
    access(projectId) {
        return effectiveAccess(pluginDefaults(this.config), this.project(projectId), this.store.project(projectId).settings);
    }

    /** config.guardedTools as [name, aliases] pairs, read now: it is live config. */
    guards() {
        return guardList(liveValue(this.config.guardedTools));
    }

    // ── the user's own tools ──────────────────────────────────────────────

    /**
     * The user's tools (guarded names) one project session may use. Under
     * "always" every one. Under "asked" none for the coordinator; a thread
     * has the ones the user's own words for it named (its `tools`: checked
     * against what the user wrote when it started or got a message, or
     * typed in the thread itself) and the ones the project's goal names.
     * @param {{projectId: string, role: string, threadId?: string}} who
     * @returns {Set<string>|'all'}
     */
    toolsFor(who) {
        if (!this.projects.has(who.projectId)) return new Set();
        if (this.access(who.projectId).yourTools.value === 'always') return 'all';
        if (who.role !== 'thread') return new Set();
        const guard = this.guards();
        const known = new Set(guard.map(([name]) => name));
        const names = new Set(guardedIn(this.goalOf(who.projectId), guard, { aliases: true }));
        const t = this.store.thread(who.projectId, who.threadId);
        for (const name of Array.isArray(t?.tools) ? t.tools : []) if (known.has(name)) names.add(name);
        return names;
    }

    /**
     * Every tool name DSH offers a session before any restriction (its own
     * tools and the user's MCP servers), as tools.restrict() knows them.
     */
    toolNames(agent) {
        const tools = this.ctx.tools;
        try {
            const known = tools?.view?.(agent)?.restrictableNames;
            if (known instanceof Set) return [...known];
        } catch {}
        try {
            return (tools?.schemas?.() ?? []).map((s) => s?.name).filter((name) => typeof name === 'string');
        } catch {
            return [];
        }
    }

    /** The tools of the user's that a session may not use, by tool name. */
    walledTools(agent, who) {
        const guard = this.guards();
        if (guard.length === 0) return [];
        const allowed = this.toolsFor(who);
        if (allowed === 'all') return [];
        return this.toolNames(agent).filter((name) => {
            const hits = guardsOfTool(name, guard);
            return hits.length > 0 && !hits.some((g) => allowed.has(g));
        });
    }

    /**
     * Keep the user's tools a session may not use out of what its model is
     * offered (DSH's per-agent tools.restrict). Done again whenever the
     * answer can change: settings, the thread's tools, DSH's tool list.
     */
    applyWall(agent, who) {
        if (this.disposed || typeof agent?.ctx?.tools?.restrict !== 'function') return;
        const label = `${who.projectId}/${who.threadId ?? 'coordinator'}`;
        let deny;
        try {
            const own = who.role === 'coordinator' ? this.toolNames(agent).filter((name) => COORDINATOR_HIDDEN.has(name)) : [];
            deny = [...this.walledTools(agent, who), ...own].sort();
        } catch (error) {
            this.log(`error wall ${label} ${String(error?.message ?? error).slice(0, 200)}`);
            return;
        }
        const key = deny.join('\n');
        const was = this.walls.get(agent);
        // Nothing to hide and nothing hidden: no wall, and no log line.
        if ((was?.key ?? '') === key) return;
        let dispose;
        if (deny.length > 0) {
            try {
                dispose = agent.ctx.tools.restrict({ deny });
            } catch (error) {
                // The old wall stays; the guard refuses these tools' calls meanwhile.
                this.log(`error wall ${label} ${String(error?.message ?? error).slice(0, 200)}`);
                return;
            }
        }
        // The new wall is up before the old one comes down.
        this.walls.set(agent, { key, dispose });
        try { was?.dispose?.(); } catch {}
        const allowed = this.toolsFor(who);
        const kept = allowed === 'all' ? 'all' : [...allowed].join(',') || '-';
        this.log(`wall ${label} ${agent.id} hid=${deny.length} allowed=${kept}`);
    }

    dropWall(agent) {
        const wall = this.walls.get(agent);
        this.walls.delete(agent);
        try { wall?.dispose?.(); } catch {}
    }

    /**
     * Why a call to one of the user's tools is refused, or undefined. DSH
     * asks before every call of the session, so this holds even in the
     * moment before a wall is updated.
     */
    wallReason(who, name) {
        try {
            const guard = this.guards();
            if (guard.length === 0) return undefined;
            const hits = guardsOfTool(name, guard);
            if (hits.length === 0) return undefined;
            const allowed = this.toolsFor(who);
            if (allowed === 'all' || hits.some((g) => allowed.has(g))) return undefined;
            this.log(`wall-refused ${who.projectId}/${who.threadId ?? 'coordinator'} ${String(name).slice(0, 80)}`);
            return who.role === 'thread' ? WALL_REASONS.thread : WALL_REASONS.coordinator;
        } catch {
            return undefined;
        }
    }

    /**
     * Why a call is refused, or undefined: a file change by a coordinator
     * on Read Only; wallReason by the tool's name; and for DSH's MCP
     * resource tools by the server their `server` argument names, so the
     * user's servers can't be read around the wall.
     */
    callReason(who, exec) {
        const name = exec?.name;
        if (who.role === 'coordinator' && WRITE_TOOLS.has(name) && !(name === 'str_replace_editor' && exec.arguments?.command === 'view')
            && this.readOnlyCoordinator(who.projectId)) {
            this.log(`read-only-refused ${who.projectId}/coordinator ${name}`);
            return READ_ONLY_REASON;
        }
        if (who.role === 'coordinator' && asksWider(exec) && this.readOnlyCoordinator(who.projectId)) {
            this.log(`read-only-refused ${who.projectId}/coordinator ${name} wider`);
            return READ_ONLY_WIDER;
        }
        if (who.role === 'coordinator' && COORDINATOR_HIDDEN.has(name)) {
            this.log(`goal-refused ${who.projectId}/coordinator ${name}`);
            return GOAL_REASON;
        }
        const byName = this.wallReason(who, name);
        if (byName !== undefined || !SERVER_TOOLS.has(name)) return byName;
        try {
            const server = exec.arguments?.server;
            return typeof server === 'string' && server.trim() !== '' ? this.wallReason(who, `mcp__${server.trim()}__${name}`) : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Rule 6, held here and not only in the prompts: a command that sends
     * outside the workspace (lib/sends.js: a request that does more than
     * read, a push, a publish, a deploy, a command on another machine, an
     * email, or a script or task that does one) waits for the user. A
     * thread's asks them in DSH's approval prompt, every time, so a retry
     * or a check asks again; a thread whose approvals never ask, a
     * coordinator and a subagent are refused. Called for every session's
     * calls (index.js) once DSH's own checks let one run. Undefined lets it
     * run: any other call, a session outside the projects, and any error
     * (a check against a mistake, not a sandbox). Never logs the command.
     */
    holdSend(exec) {
        try {
            if (this.disposed || !SEND_TOOLS.has(exec?.name) || !exec.agent) return undefined;
            const session = exec.agent.session;
            const own = this.store.lookup(exec.agent.id);
            const who = own ?? this.projectAbove(session);
            if (!who || !this.projects.has(who.projectId)) return undefined;
            const args = argsOf(exec.arguments);
            const project = this.project(who.projectId);
            const folder = (who.role === 'thread' ? this.store.thread(who.projectId, who.threadId)?.folder : undefined) ?? project.workspacePath;
            const cwd = typeof session?.header?.cwd === 'string' ? session.header.cwd : folder;
            const roots = [cwd, folder, project.workspacePath].filter((root) => typeof root === 'string' && root !== '').map(expand);
            const here = typeof args.workdir === 'string' && args.workdir.trim() !== '' ? resolve(expand(cwd), expand(args.workdir.trim())) : expand(cwd);
            const found = exec.name === 'run_code'
                ? codeSendOf(String(args.code ?? ''), { depth: 0, cwd: here, read: (path) => textInside(roots, path) }, 'run_code')
                : sendOf(String(args.command ?? ''), { shell: exec.name, cwd: here, read: (path) => textInside(roots, path) });
            if (!found) return undefined;
            const label = `${who.projectId}/${who.threadId ?? 'coordinator'}${own ? '' : ' subagent'} ${found.kind} ${String(found.program).slice(0, 40)}`;
            if (!own) {
                this.log(`send-refused ${label}`);
                return { kind: 'deny', reason: SEND_REASONS.subagent(found.what) };
            }
            if (who.role !== 'thread') {
                this.log(`send-refused ${label}`);
                return { kind: 'deny', reason: SEND_REASONS.coordinator(found.what) };
            }
            if (this.approvalPolicyOf(session) !== 'ask') {
                this.log(`send-refused ${label} never-asks`);
                return { kind: 'deny', reason: SEND_REASONS.never(found.what) };
            }
            this.log(`send-ask ${label}`);
            return {
                kind: 'ask',
                reason: `the command ${found.what}`,
                displayReason: { en: `This command ${found.what}. A thread asks you before each command that sends outside the workspace.` },
            };
        } catch (error) {
            this.log(`error send-check ${String(error?.message ?? error).slice(0, 200)}`);
            return undefined;
        }
    }

    /** "ask" when DSH would put an approval prompt in front of the user for this session, else "never". */
    approvalPolicyOf(session) {
        try {
            const approval = this.ctx.get?.('approval');
            if (typeof approval?.effectivePolicy !== 'function') return 'never';
            return approval.effectivePolicy(session) === 'ask' ? 'ask' : 'never';
        } catch {
            return 'never';
        }
    }

    /**
     * The project session a subagent works for, through subagents of
     * subagents: {projectId, role, threadId?}, or null for any other session
     * (one the user forked from a thread is the user's own chat).
     */
    projectAbove(session) {
        const id = session?.id;
        if (typeof id !== 'string') return null;
        if (this.subProjects.has(id)) return this.subProjects.get(id);
        let header = session.header;
        let found = null;
        for (let depth = 0; depth < 8 && header?.origin === 'subagent' && typeof header.parentSession === 'string'; depth++) {
            const who = this.store.lookup(header.parentSession);
            if (who) {
                found = who;
                break;
            }
            header = this.ctx.agents.get(header.parentSession)?.session?.header;
        }
        this.subProjects.set(id, found);
        for (const key of [...this.subProjects.keys()].slice(0, -500)) this.subProjects.delete(key);
        return found;
    }

    /** Every installed session's wall again (of one project, or all). */
    rewall(projectId) {
        for (const [agent, who] of this.roles) {
            if (projectId === undefined || who.projectId === projectId) this.applyWall(agent, who);
        }
    }

    /** DSH's tool list changed (an MCP server came or went): walls again, once the changes settle. */
    onToolsChanged() {
        if (this.disposed || this.wallTimer !== undefined) return;
        this.wallTimer = setTimeout(() => {
            this.wallTimer = undefined;
            // A throw in a timer would end DSH's Host.
            try { this.rewall(); } catch (error) { this.log(`error wall ${String(error?.message ?? error).slice(0, 200)}`); }
        }, 50);
        this.wallTimer.unref?.();
    }

    /**
     * What the user wrote to the coordinator: their own messages in its
     * chat and their answers in DSH's question box, not the plugin's or the
     * threads'. '' when there is no coordinator or its log can't be read.
     */
    async userText(projectId) {
        const sessionId = this.store.project(projectId).coordinatorSessionId;
        if (!sessionId) return '';
        try {
            const events = (await this.sc.inspect(sessionId, AbortSignal.timeout(20000))).events ?? [];
            return [...events.map(promptOf).filter((p) => p && !p.fromProject).map((p) => p.text), ...questionAnswers(events)].join('\n');
        } catch (error) {
            this.log(`error user-words ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            return '';
        }
    }

    /**
     * The user's tools an `ask` names, checked against what the user wrote:
     * each must also be named in the user's own messages to the coordinator
     * or in the project's goal. An ask that names one the user never wrote
     * is not the user's words, so it is refused.
     * @returns {Promise<string[]>} the guarded names the ask gives its thread.
     */
    async askedTools(projectId, ask) {
        const guard = this.guards();
        if (guard.length === 0 || !ask) return [];
        const named = guardedIn(ask, guard, { aliases: true });
        if (named.length === 0) return [];
        const said = new Set(guardedIn(`${this.goalOf(projectId)}\n${await this.userText(projectId)}`, guard, { aliases: true }));
        const unsaid = named.filter((name) => !said.has(name));
        if (unsaid.length > 0) {
            this.log(`guard ${projectId} ask-unsaid ${unsaid.join(',')}`);
            throw new ProjectError(`ask names ${unsaid.join(', ')}, but the user's messages don't. Put only the user's own words in ask, copied from their message, or ask the user first`);
        }
        return named;
    }

    /**
     * An `ask` holds only the user's words: each of its sentences copied
     * from what they wrote to the coordinator (their messages, their
     * answers in DSH's question box) or from the project's goal, so a
     * thread never reads the coordinator's own words after "The user
     * asked:". Before the user has written anything (or when the log can't
     * be read) there is nothing to check against, and it passes.
     */
    async requireUserWords(projectId, ask, kind) {
        const wrote = await this.userText(projectId);
        if (wrote.trim() === '') return;
        const part = unsaidPart(ask, `${this.goalOf(projectId)}\n${wrote}`);
        if (part === '') return;
        this.log(`guard ${projectId} ask-not-theirs ${kind}`);
        const shown = part.length > 80 ? `${part.slice(0, 79)}…` : part;
        throw new ProjectError(`ask holds only the user's own words, copied from their messages, and they didn't write "${shown}". Put what you add (the task you picked, the scope) in ${kind === 'start' ? 'brief' : 'text'}`);
    }

    /** Give a thread more of the user's tools, named by the user's words; its wall follows at once. */
    addThreadTools(projectId, threadId, names, why) {
        const t = this.store.thread(projectId, threadId);
        if (!t || names.length === 0) return;
        const have = Array.isArray(t.tools) ? t.tools : [];
        const added = names.filter((name) => !have.includes(name));
        if (added.length === 0) return;
        this.store.putThread(projectId, threadId, { tools: [...have, ...added] });
        this.log(`tools ${projectId}/${threadId} +${added.join(',')} ${why}`);
        const agent = this.ctx.agents.get(t.sessionId);
        if (agent && this.roles.has(agent)) this.applyWall(agent, this.roles.get(agent));
    }

    // ── permissions ───────────────────────────────────────────────────────

    /** DSH's permission presets service, or undefined on a DSH without it. */
    presets() {
        try {
            const pp = this.ctx.get?.('permissionPresets');
            return pp && typeof pp.set === 'function' && typeof pp.current === 'function' ? pp : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * The presets DSH offers for new sessions, in its order ({value, name,
     * description?}, as its permission menu lists them, without the
     * experimental Auto), and the one new sessions get. null without them.
     */
    permissionCatalog() {
        const pp = this.presets();
        if (!pp) return null;
        try {
            const c = pp.catalog();
            const options = (Array.isArray(c?.defaultOptions) ? c.defaultOptions : [])
                .filter((o) => typeof o?.value === 'string' && o.value !== 'custom' && o.value !== 'auto')
                .map((o) => ({ value: o.value, name: typeof o.name === 'string' ? o.name : o.value, ...(typeof o.description === 'string' ? { description: o.description } : {}) }));
            return { options, defaultPreset: typeof c?.defaultPreset === 'string' ? c.defaultPreset : null };
        } catch {
            return null;
        }
    }

    /**
     * The preset a permission setting puts a session on: DSH's default for
     * new sessions for "default", undefined for a name DSH doesn't offer.
     */
    presetOf(value) {
        const catalog = this.permissionCatalog();
        if (!catalog) return undefined;
        if (value === 'default') return catalog.defaultPreset ?? undefined;
        return catalog.options.some((o) => o.value === value) ? value : undefined;
    }

    /** A loaded session's permission preset now (DSH's name, or "custom"), or undefined. */
    permissionOf(sessionId) {
        try {
            const session = typeof sessionId === 'string' ? this.ctx.agents.get(sessionId)?.session : undefined;
            const preset = session ? this.presets()?.current(session) : undefined;
            return typeof preset === 'string' ? preset : undefined;
        } catch {
            return undefined;
        }
    }

    /**
     * Put one session on a permission preset, the way DSH's permission menu
     * does, marked as the manager's own change.
     * @returns whether the session is on it now.
     */
    setPermission(agent, preset, label) {
        const pp = this.presets();
        if (!pp || !agent?.session || typeof preset !== 'string') return false;
        try {
            if (pp.current(agent.session) === preset) return true;
            this.ownPermissions.set(agent.id, preset);
            pp.set(agent.session, preset);
            this.log(`permission ${label} ${preset}`);
            return pp.current(agent.session) === preset;
        } catch (error) {
            this.ownPermissions.delete(agent.id);
            this.log(`error permission ${label} ${String(error?.message ?? error).slice(0, 200)}`);
            return false;
        }
    }

    /** Whether the project's coordinator is set to Read Only (the plugin's default), whatever DSH offers. */
    readOnlyCoordinator(projectId) {
        try {
            return this.access(projectId).coordinatorPermission.value === 'read-only';
        } catch {
            return false;
        }
    }

    /**
     * Put the coordinator on its permission setting when the setting
     * differs from the one it last got. A coordinator on DSH's default needs
     * nothing (DSH gave it that one); an unloaded coordinator gets it when
     * it loads.
     * @returns false only when a needed change failed.
     */
    applyCoordinatorPermission(projectId, agent = undefined) {
        const stored = this.store.project(projectId);
        if (!stored.coordinatorSessionId || !this.presets()) return true;
        const want = this.access(projectId).coordinatorPermission.value;
        if (stored.coordinatorAccess === want) return true;
        if (stored.coordinatorAccess === undefined && want === 'default') {
            this.store.putProject(projectId, { coordinatorAccess: want });
            return true;
        }
        const live = agent ?? this.ctx.agents.get(stored.coordinatorSessionId);
        if (!live) return true;
        let preset = this.presetOf(want);
        if (!preset && want === 'read-only') {
            // A DSH without a Read Only preset keeps it on its default; the refusals above still keep it from writing.
            preset = this.presetOf('default');
            this.log(`permission ${projectId}/coordinator read-only not offered, on ${preset ?? 'unknown'}`);
        }
        if (!preset) {
            this.log(`permission ${projectId}/coordinator unknown preset ${want}`);
            return false;
        }
        if (!this.setPermission(live, preset, `${projectId}/coordinator`)) return false;
        this.store.putProject(projectId, { coordinatorAccess: want });
        return true;
    }

    /**
     * A `permission/preset` on a project session that the manager didn't
     * make: the user's pick in DSH's own permission menu. On a coordinator
     * it becomes the project's coordinator setting, on a thread that
     * thread's, so the settings say what the sessions run with.
     */
    onPermission(who, agent, data) {
        try {
            const preset = data?.preset;
            if (typeof preset !== 'string' || preset === 'custom' || !this.projects.has(who.projectId)) return;
            if (this.ownPermissions.get(agent.id) === preset) {
                this.ownPermissions.delete(agent.id);
                return;
            }
            if (who.role === 'coordinator') {
                this.store.putSettings(who.projectId, { coordinatorPermission: preset });
                this.store.putProject(who.projectId, { coordinatorAccess: preset });
            } else {
                if (!this.store.thread(who.projectId, who.threadId)) return;
                this.store.putThread(who.projectId, who.threadId, { permission: preset });
            }
            this.log(`picked-permission ${who.projectId}/${who.threadId ?? 'coordinator'} ${preset}`);
        } catch (error) {
            this.log(`error picked-permission ${who.projectId} ${String(error?.message ?? error).slice(0, 200)}`);
        }
    }

    /**
     * Compare the project's row in the profile with the one this project
     * last saw. A model, effort or access setting the row changed since (an
     * edit by hand) replaces the project's own setting of it, made in its
     * Project settings, in its coordinator's model or permission menu or
     * through the coordinator: all of them are this project's, so the newest
     * wins. The plugin defaults never replace a project's own setting. The
     * first look only records.
     * @returns {string[]} the settings whose project setting was replaced.
     */
    noteProjectRow(projectId) {
        // Empty means "use the default", however it is written.
        const plain = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
        const row = this.project(projectId);
        const p = this.store.project(projectId);
        const seen = p.rowSeen;
        const keys = [...SETTING_KEYS, ...ACCESS_KEYS];
        const changed = keys.filter((key) => plain(row[key]) !== plain(seen?.[key]));
        if (seen && changed.length === 0) return [];
        const replaced = seen ? changed.filter((key) => p.settings[key] !== undefined) : [];
        if (replaced.length) this.store.putSettings(projectId, Object.fromEntries(replaced.map((key) => [key, undefined])));
        this.store.putProject(projectId, { rowSeen: Object.fromEntries(keys.map((key) => [key, plain(row[key])])), defaultsSeen: undefined });
        if (seen) this.log(`row ${projectId} ${changed.join(',')}${replaced.length ? ` replaced ${replaced.join(',')}` : ''}`);
        return replaced;
    }

    /**
     * The plugin defaults changed while the plugin runs (DSH's settings page
     * saved them, or the profile's live fields were edited). A coordinator
     * that runs on a default switches from its next request, and to its
     * permission now; new threads start with the new defaults, and running
     * threads keep theirs. A project's own settings stay. Every session's
     * wall follows the user's tools as they are now.
     */
    async onDefaultsChanged() {
        this.log('defaults saved');
        // Your tools, or the list of them, may have changed.
        try { this.rewall(); } catch (error) { this.log(`error wall ${String(error?.message ?? error).slice(0, 200)}`); }
        for (const projectId of this.projects.keys()) {
            if (this.disposed) return;
            try {
                this.applyCoordinatorPermission(projectId);
                await this.applyCoordinatorRoute(projectId);
            } catch (error) {
                this.log(`error defaults ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            }
        }
    }

    paused(projectId) {
        const override = this.store.project(projectId).settings.paused;
        return typeof override === 'boolean' ? override : this.project(projectId).paused === true;
    }

    /** Whether the project is archived: its coordinator and threads are archived in DSH (archiveProject). */
    archived(projectId) {
        return isObject(this.store.projects[projectId]?.archived);
    }

    /** Paused or archived: what is sent to the coordinator waits, and no thread starts. */
    held(projectId) {
        return this.archived(projectId) || this.paused(projectId);
    }

    /**
     * What the project is for, as the coordinator's and threads' prompts
     * read it: the goal the user set in Project settings, else the profile
     * row's, else none (''). It counts as the user's own words.
     */
    goalOf(projectId) {
        const own = this.store.project(projectId).settings.goal;
        if (typeof own === 'string') return own;
        const goal = this.project(projectId).goal;
        return typeof goal === 'string' ? goal.trim() : '';
    }

    liveStatus(sessionId) {
        const agent = this.ctx.agents.get(sessionId);
        return agent ? agent.status : 'idle';
    }

    /** The Host model catalog, cached briefly; undefined when unavailable. */
    async catalog() {
        let value;
        if (this.catalogCache && Date.now() - this.catalogCache.at < 30000) {
            value = this.catalogCache.value;
        } else {
            try { value = await this.sc.modelCatalog(); } catch { value = undefined; }
            this.catalogCache = value ? { value, at: Date.now() } : null;
        }
        // The DSH default changes with every pick in DSH's model picker, so
        // checks use the current one, the same one fullSelection builds on.
        let current;
        try { current = this.ctx.get?.('agentDefaultModel')?.currentSelection?.(); } catch {}
        if (!value || !current?.provider || !current?.model) return value;
        if (value.default?.provider === current.provider && value.default?.model === current.model) return value;
        return { ...value, default: { provider: current.provider, model: current.model } };
    }

    // ── lifecycle ──────────────────────────────────────────────────────────

    /**
     * Attach to live agents, make sure every project has a coordinator,
     * deliver held messages, and review thread turns that ended while the
     * plugin was not watching (DSH stopped or the plugin reloaded mid-turn).
     */
    async start() {
        for (const agent of this.ctx.agents.list?.() ?? []) this.maybeInstall(agent);
        await this.nameNameless();
        if (this.disposed) return;
        await this.refreshRecords();
        if (this.disposed) return;
        for (const id of this.projects.keys()) await this.noteHome(id);
        if (this.disposed) return;
        // A ◆ coordinator archived or unarchived in DSH while the plugin was off: its threads follow it now.
        await this.matchArchive();
        for (const id of [...this.projects.keys()]) {
            if (this.disposed) return;
            await this.resume(id);
        }
        if (!this.disposed) await this.catchUpReplies();
        if (!this.disposed) await this.plainThreadTitles();
        if (!this.disposed) await this.recountChanges();
    }

    /**
     * Bring a project's coordinator up as at a start: made, or resumed on
     * its settings, then what was held for it delivered and the turns its
     * threads ended meanwhile reviewed. Not while the project is archived,
     * nor for one made in the window whose coordinator never started: it
     * gets one when the user asks.
     */
    async resume(id) {
        if (this.archived(id)) return;
        if (!this.fromProfile(id) && !this.store.projects[id]?.coordinatorSessionId) return;
        try {
            if (this.fromProfile(id)) this.noteProjectRow(id);
            const sessionId = await this.ensureCoordinator(id);
            if (!sessionId) return;
            await this.noteHome(id);
        } catch (error) {
            this.log(`error coordinator ${id} ${String(error?.message ?? error).slice(0, 300)}`);
            this.ctx.logger?.warn?.('projects: could not start coordinator for %s: %s', id, error?.message ?? error);
            return;
        }
        // Reloaded meanwhile: the new manager delivers and reviews.
        if (this.disposed) return;
        await this.flushPending(id);
        await this.catchUp(id);
    }

    async dispose() {
        this.disposed = true;
        liveManagers.delete(this);
        if (managers.get(this.storeFile) === this) managers.delete(this.storeFile);
        for (const dispose of this.installed.values()) {
            try { dispose(); } catch {}
        }
        this.installed.clear();
        this.roles.clear();
        clearTimeout(this.wallTimer);
        this.wallTimer = undefined;
        for (const sessionId of [...this.approvals.keys()]) this.clearApprovals(sessionId);
        for (const { timer } of this.retries.values()) clearTimeout(timer);
        this.retries.clear();
        // The last manager on the file lets its copy go, so the plugin switched on again reads the file anew.
        if (![...liveManagers].some((m) => m.storeFile === this.storeFile)) ProjectStore.release(this.storeFile);
    }

    /** DSH's session list: [{sessionId, projections: {values}}, …]; [] when it can't be read. */
    async listed() {
        try {
            const { items } = await this.sc.list({}, AbortSignal.timeout(20000));
            return Array.isArray(items) ? items : [];
        } catch (error) {
            this.log(`error list ${String(error?.message ?? error).slice(0, 200)}`);
            return [];
        }
    }

    /**
     * A project the store holds no name for (one from a profile row since
     * removed) takes its coordinator's title, "◆ DSH Plugins", once; until
     * then, and when the title says nothing more, it goes by its id. Never
     * an empty name, so never a bare "◆ ".
     */
    async nameNameless() {
        const nameless = [...this.projects.keys()].filter((id) => !this.fromProfile(id) && storedName(this.store.projects[id]) === ''
            && typeof this.store.projects[id]?.coordinatorSessionId === 'string');
        if (nameless.length === 0) return;
        const titles = new Map((await this.listed()).map((item) => [item?.sessionId, item?.projections?.values?.title]));
        for (const projectId of nameless) {
            if (this.disposed) return;
            const sessionId = this.store.projects[projectId].coordinatorSessionId;
            let title = titles.get(sessionId);
            if (typeof title !== 'string') title = await this.sessionTitle(sessionId).catch(() => undefined);
            const name = typeof title === 'string' && title.startsWith('◆ ') ? clipTitle(title.slice(2)) : '';
            if (name === '') continue;
            this.store.putProject(projectId, { name });
            this.log(`name ${projectId} from its coordinator`);
        }
    }

    /**
     * Every session the store knows for a running project, for the session
     * list while DSH has no value of this plugin's projection for it.
     * @returns {Record<string, {role: 'coordinator'|'thread', project: string, name: string, thread?: string, coordinator?: string}>}
     */
    knownSessions() {
        const out = {};
        for (const projectId of this.projects.keys()) {
            const stored = this.store.project(projectId);
            const coordinator = typeof stored.coordinatorSessionId === 'string' && stored.coordinatorSessionId !== '' ? stored.coordinatorSessionId : undefined;
            const name = this.project(projectId).name;
            if (coordinator) out[coordinator] = { role: 'coordinator', project: projectId, name };
            for (const [threadId, t] of Object.entries(stored.threads ?? {})) {
                if (typeof t?.sessionId !== 'string' || t.sessionId === '' || out[t.sessionId]) continue;
                out[t.sessionId] = { role: 'thread', project: projectId, name, thread: threadId, ...(coordinator ? { coordinator } : {}) };
            }
        }
        return out;
    }

    /**
     * DSH keeps each session's value of this plugin's projection from the
     * version of the plugin that last folded it, and drops a value from
     * another version when it lists the session, until that session is next
     * loaded. So after an update a thread nobody opened since showed flat in
     * the session list, with no mark. Once per start, every project session
     * DSH lists without a value is read again from its log, starting from
     * the store's view (the projection's init), and DSH saves the result as
     * it saves any cold read. Sessions DSH has loaded fold as they run.
     */
    async refreshRecords() {
        let cache;
        try { cache = this.ctx.get?.('sessionProjectionCache'); } catch { cache = undefined; }
        if (typeof cache?.coldSnapshot !== 'function') return;
        const known = Object.keys(this.knownSessions());
        if (known.length === 0) return;
        const items = new Map((await this.listed()).map((item) => [item?.sessionId, item]));
        const loaded = (id) => {
            try { return this.ctx.get?.('sessions')?.get?.(id) !== undefined; } catch { return false; }
        };
        let refreshed = 0;
        for (const sessionId of known) {
            if (this.disposed) return;
            const item = items.get(sessionId);
            if (!item || loaded(sessionId)) continue;
            const value = item.projections?.values?.[PROJECTION_KEY];
            if (value !== null && typeof value === 'object' && (value.role === 'coordinator' || value.role === 'thread')) continue;
            try {
                const { meta, inheritedEventCount, events } = await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
                if (loaded(sessionId)) continue;
                cache.coldSnapshot(meta, inheritedEventCount ?? 0, Array.isArray(events) ? events : []);
                refreshed += 1;
            } catch (error) {
                this.log(`error record ${sessionId} ${String(error?.message ?? error).slice(0, 200)}`);
            }
        }
        if (refreshed > 0) this.log(`records refreshed=${refreshed}`);
    }

    /**
     * Threads started before thread sessions lost the project's name in
     * front ("Storefront › Fix login") keep it until renamed. Once per
     * project, a thread session still titled exactly that is renamed to the
     * thread's own title; a title the user changed is left as it is.
     */
    async plainThreadTitles() {
        try {
            const todo = [...this.projects.keys()].filter((id) => this.store.project(id).plainTitles !== true);
            if (todo.length === 0) return;
            const old = new Map();
            for (const projectId of todo) {
                const name = this.project(projectId).name;
                for (const [threadId, t] of Object.entries(this.store.project(projectId).threads ?? {})) {
                    const was = t?.title;
                    if (typeof was !== 'string' || was === '') continue;
                    // Older versions cut titles at 80 characters, mid-word and without "…".
                    const title = clipTitle(was, { cut: was.length >= 80 });
                    if (title !== was) this.store.putThread(projectId, threadId, { title });
                    if (typeof t.sessionId === 'string') old.set(t.sessionId, { from: dshTitle(`${name} › ${was}`), to: title });
                }
            }
            let renamed = 0;
            if (old.size > 0) {
                const { items } = await this.sc.list({}, AbortSignal.timeout(20000));
                const titles = new Map((Array.isArray(items) ? items : []).map((item) => [item?.sessionId, item?.projections?.values?.title]));
                for (const [sessionId, { from, to }] of old) {
                    if (this.disposed) return;
                    let now = titles.get(sessionId);
                    if (typeof now !== 'string') now = await this.sessionTitle(sessionId).catch(() => undefined);
                    if (now !== from) continue;
                    await this.sc.rename({ sessionId, title: to }).then(() => { renamed += 1; }, () => {});
                }
            }
            for (const projectId of todo) this.store.putProject(projectId, { plainTitles: true });
            this.log(`thread-titles renamed=${renamed}`);
        } catch (error) {
            this.log(`error thread-titles ${String(error?.message ?? error).slice(0, 300)}`);
        }
    }

    /** A session's title as DSH lists it, else as its log has it; undefined when neither says. */
    async currentTitle(sessionId) {
        try {
            const { items } = await this.sc.list({}, AbortSignal.timeout(20000));
            const title = (Array.isArray(items) ? items : []).find((item) => item?.sessionId === sessionId)?.projections?.values?.title;
            if (typeof title === 'string') return title;
        } catch {}
        return this.sessionTitle(sessionId).catch(() => undefined);
    }

    /** A session's title as its log has it (its newest title event), or undefined. */
    async sessionTitle(sessionId) {
        const { events } = await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
        for (let i = (events?.length ?? 0) - 1; i >= 0; i--) {
            if (events[i]?.type === 'session/title' && typeof events[i].data?.title === 'string') return events[i].data.title;
        }
        return undefined;
    }

    /** Whether a session exists. Only "not found" means no; any other read error is thrown. */
    async exists(sessionId) {
        if (!sessionId) return false;
        try {
            await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
            return true;
        } catch (error) {
            if (isNotFound(error)) return false;
            throw error;
        }
    }

    /** Create one ordinary session in the project's workspace, or another folder of it. */
    async createSession(project, folder = project.workspacePath) {
        const ws = await this.ctx.workspaceRegistry.create(folder);
        const created = await this.sc.create({ workspaceId: ws.id, ...(project.agentPreset ? { agentPreset: project.agentPreset } : {}) });
        return created.sessionId;
    }

    /** Resolve a session's live agent and install project behaviour on it. */
    async attach(sessionId) {
        const r = await this.sc.resolveAgent(sessionId);
        if (r?.agent) this.maybeInstall(r.agent);
        return r?.agent;
    }

    /** One coordinator check per project at a time, across managers. */
    async ensureCoordinator(projectId, { create = this.fromProfile(projectId) } = {}) {
        const key = `${this.storeFile}#${projectId}`;
        while (ensuring.has(key)) await ensuring.get(key).catch(() => {});
        const run = this.ensureCoordinatorOnce(projectId, create);
        ensuring.set(key, run);
        try {
            return await run;
        } finally {
            if (ensuring.get(key) === run) ensuring.delete(key);
        }
    }

    /**
     * @param {boolean} create - make a coordinator when there is none: always
     *   for a profile project; for one made on the Projects page, only when the
     *   user adds it. Without, a coordinator session that is gone (deleted in
     *   DSH) leaves the project without one.
     */
    async ensureCoordinatorOnce(projectId, create) {
        const project = this.project(projectId);
        const stored = this.store.project(projectId);
        // A coordinator DSH has loaded exists; only one it hasn't needs its log read to know.
        const live = stored.coordinatorSessionId ? this.ctx.agents.get(stored.coordinatorSessionId) : undefined;
        if (live || await this.exists(stored.coordinatorSessionId)) {
            if (live) this.maybeInstall(live);
            this.seeArchive(projectId, stored.coordinatorSessionId);
            await this.applyCoordinatorRoute(projectId);
            this.applyCoordinatorPermission(projectId);
            this.log(`coordinator ${projectId} ${stored.coordinatorSessionId} resumed`);
            await this.welcome(projectId, stored.coordinatorSessionId, false);
            return stored.coordinatorSessionId;
        }
        if (!create) {
            if (stored.coordinatorSessionId) {
                this.store.putProject(projectId, { coordinatorSessionId: undefined, welcomedSession: undefined });
                this.log(`coordinator ${projectId} gone`);
            }
            return null;
        }
        if (typeof project.workspacePath !== 'string' || project.workspacePath === '') {
            throw new ProjectError(`"${project.name}" has no workspace for its coordinator to work in; move one into it first`);
        }
        // The plugin reloaded meanwhile; the new manager makes the coordinator.
        if (this.disposed) return null;
        const sessionId = await this.createSession(project);
        this.store.putProject(projectId, {
            coordinatorSessionId: sessionId, coordinatorCreatedAt: new Date().toISOString(), coordinatorRoute: undefined, coordinatorAccess: undefined,
            dshArchive: { coordinator: sessionId, archived: false },
        });
        // Attaching puts it on its permission setting (install).
        await this.attach(sessionId);
        await this.sc.rename({ sessionId, title: `◆ ${project.name}` }).catch(() => {});
        await this.applyCoordinatorRoute(projectId);
        this.log(`coordinator ${projectId} ${sessionId}`);
        await this.welcome(projectId, sessionId, true);
        return sessionId;
    }

    /**
     * Give a coordinator its first turn: it introduces itself. DSH lists a
     * session only once it has had a turn, so until then the user can't find
     * the coordinator in the sidebar to talk to it. Once per coordinator
     * session; held like any message while the project is paused.
     * @param {boolean} fresh - the session was just created, so it has had no turn.
     */
    async welcome(projectId, sessionId, fresh) {
        if (!this.config.welcome) return;
        const stored = this.store.project(projectId);
        if (stored.welcomedSession === sessionId) return;
        if (!fresh) {
            // A coordinator from before this check: welcome it only if it never had a turn.
            let used;
            try {
                const events = (await this.sc.inspect(sessionId, AbortSignal.timeout(20000))).events ?? [];
                used = events.some((e) => e?.type === 'turn/start') || stored.pendingHandbacks.length > 0;
            } catch (error) {
                this.log(`error welcome ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
                return;
            }
            if (used) {
                this.store.putProject(projectId, { welcomedSession: sessionId });
                return;
            }
        }
        this.store.putProject(projectId, { welcomedSession: sessionId });
        const project = this.project(projectId);
        const outcome = await this.deliver(projectId, welcomeMessage(project.name, this.goalOf(projectId)));
        this.log(`welcome ${projectId} ${sessionId} ${outcome}`);
    }

    /**
     * Send a session a message, waking it when idle, as DSH's own agents and
     * scheduled tasks do. Done once the session log has it.
     * @param {'queue'|'steer'} mode - its next turn, or into the turn running now.
     * @param {string} [from] - the session it comes from (an agent's message,
     *   which also tells a thread's projection its coordinator), or none for
     *   the plugin's own notes.
     */
    async prompt(sessionId, text, mode = 'queue', from = undefined) {
        const found = await this.sc.resolveAgent(sessionId);
        if (!found?.agent) throw new Error(`session ${sessionId} is not available: ${found?.error?.message ?? found?.error?.code ?? 'not found'}`);
        this.maybeInstall(found.agent);
        const message = createUserMessage({ content: [{ type: 'text', text }], source: from ? agentSource(from) : PLUGIN_SOURCE });
        if (mode === 'steer') found.agent.steer(message);
        else found.agent.followup(message);
        const sessions = this.ctx.get?.('sessions');
        if (typeof sessions?.flush === 'function' && found.agent.session && !await sessions.flush(found.agent.session)) {
            throw new Error(`session ${sessionId} did not save the message`);
        }
    }

    // ── agent scope ────────────────────────────────────────────────────────

    maybeInstall(agent) {
        // A tool call that outlived a config reload hands its new session to the new manager.
        if (this.disposed) {
            managers.get(this.storeFile)?.maybeInstall(agent);
            return;
        }
        if (!agent || this.installed.has(agent)) return;
        const who = this.store.lookup(agent.id);
        if (!who || !this.projects.has(who.projectId)) return;
        // Runs inside the serial `agent/created` listener chain, where a throw
        // would fail the session's creation: log and leave the session plain.
        try {
            this.installed.set(agent, this.install(agent, who));
        } catch (error) {
            this.log(`error attach ${agent.id} ${String(error?.message ?? error).slice(0, 300)}`);
            this.ctx.logger?.warn?.('projects: could not attach to session %s: %s', agent.id, error?.message ?? error);
            return;
        }
        this.roles.set(agent, who);
        this.log(`attach ${who.role} ${who.projectId}${who.threadId ? `/${who.threadId}` : ''} ${agent.id}`);
    }

    forget(agent) {
        const dispose = this.installed.get(agent);
        if (!dispose) return;
        this.installed.delete(agent);
        this.roles.delete(agent);
        try { dispose(); } catch {}
    }

    /** Install tools, prompt section, route override and status watcher in one agent scope. */
    install(agent, who) {
        const scoped = agent.ctx;
        const disposers = [];
        const add = (d) => { if (typeof d === 'function') disposers.push(d); };
        const { projectId, role, threadId } = who;
        try {
            add(scoped.systemPrompt?.section({
                name: `projects:${role}`,
                order: SECTION_ORDER,
                interpolate: false,
                text: () => (role === 'coordinator' ? this.coordinatorText(projectId) : this.threadText(projectId, threadId)),
            }));
            for (const tool of this.buildTools(this, who)) add(scoped.tools.register(tool));
            if (this.selectionMode === 'override') {
                // Outermost, so the Host's own selection listener cannot undo it.
                add(scoped.on('agent/request', async (_event, next) => {
                    const resolved = await next();
                    const route = await this.checkedRoute(who);
                    return route ? applyRoute(resolved, route.model, route.effort) : resolved;
                }, { prepend: true }));
            }
            if (role === 'thread') {
                if (agent.status === 'running') {
                    // Attached mid-turn (the plugin reloaded): review the turn when it ends,
                    // and watch the permission prompts it is already waiting on.
                    this.turns.set(agent.id, { running: true });
                    const t = this.store.thread(projectId, threadId);
                    if (t && !t.busy) this.store.putThread(projectId, threadId, { busy: true });
                    void this.rearmApprovals(projectId, threadId, agent).catch((error) => {
                        this.log(`error approval ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                    });
                }
                add(scoped.on('agent/status', ({ status }) => {
                    void this.onThreadStatus(projectId, threadId, agent, status).catch((error) => {
                        this.log(`error status ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                    });
                }));
                add(scoped.on('session/event', (_session, event) => this.onThreadEvent(projectId, threadId, agent, event)));
                add(() => this.clearApprovals(agent.id));
            } else {
                add(scoped.on('session/event', (_session, event) => {
                    if (event?.type === 'model/selection') this.onSelection(who, agent, event.data);
                    else if (event?.type === 'permission/preset') this.onPermission(who, agent, event.data);
                }));
                // On Read Only, what would need the user's approval (a write, a wider sandbox) is refused without asking them.
                add(scoped.on('approval/request', (req, next) => {
                    if (!this.readOnlyCoordinator(projectId)) return next();
                    this.log(`read-only-refused ${projectId}/coordinator ${String(req?.toolName ?? 'request').slice(0, 80)}`);
                    return 'rejected';
                }, { prepend: true }));
                // A setting changed while it was not loaded.
                this.applyCoordinatorPermission(projectId, agent);
            }
            add(() => this.ownSelections.delete(agent.id));
            add(() => this.ownPermissions.delete(agent.id));
            // The user's tools it may not use: left out of what its model is offered, and refused if called anyway.
            if (typeof scoped.tools?.guard === 'function') add(scoped.tools.guard((exec) => this.callReason(who, exec)));
            add(() => this.dropWall(agent));
            this.applyWall(agent, who);
        } catch (error) {
            for (const d of disposers.reverse()) { try { d(); } catch {} }
            throw error;
        }
        return () => { for (const d of disposers.reverse()) { try { d(); } catch {} } };
    }

    /** The model route for one session, read live so setting changes apply on the next request. */
    routeFor(who) {
        if (!this.projects.has(who.projectId)) return null;
        if (who.role === 'coordinator') {
            const s = this.settings(who.projectId);
            return { model: s.coordinatorModel.value, effort: s.coordinatorEffort.value };
        }
        const t = this.store.thread(who.projectId, who.threadId);
        return t ? { model: t.model, effort: t.effort } : null;
    }

    /**
     * The route checked against the catalog. An effort the model lacks is
     * dropped or fitted to the nearest level it offers, so a default model
     * that changed under an inherited effort still runs.
     */
    async checkedRoute(who) {
        const route = this.routeFor(who);
        if (!route || (!route.model && !route.effort)) return route;
        const check = checkSelection(await this.catalog(), route.model, route.effort, { fit: true });
        if (check.ok && check.fitted) this.log(`fit ${who.projectId}/${who.threadId ?? 'coordinator'} ${check.note}`);
        return check.ok ? { model: check.model ?? route.model, effort: check.effort } : route;
    }

    /**
     * The complete selection for a route. An unset model means the DSH
     * default model; an unset effort means the model's own default, and a
     * fully unset route means the DSH default selection.
     */
    fullSelection(route) {
        let base = {};
        try { base = this.ctx.get?.('agentDefaultModel')?.currentSelection?.() ?? {}; } catch {}
        if (!route?.model && !route?.effort) return base.provider && base.model ? { ...base } : null;
        const parsed = route.model ? parseModelSpec(route.model, base.provider) : { provider: base.provider, model: base.model };
        if (!parsed?.provider || !parsed.model) return null;
        return { provider: parsed.provider, model: parsed.model, ...(route.effort ? { reasoningEffort: route.effort } : {}) };
    }

    /** Validate a selection and fill in the adapter's default effort, as the DSH picker does. */
    async resolveSelection(selection) {
        const llm = this.ctx.get?.('llm');
        if (typeof llm?.resolveCallConfig !== 'function') return selection;
        const r = await llm.resolveCallConfig(selection, AbortSignal.timeout(20000));
        return { provider: r.provider, model: r.model, ...(r.reasoningEffort === undefined ? {} : { reasoningEffort: String(r.reasoningEffort) }) };
    }

    /**
     * Put one session on its project route from its next model request, the
     * way the DSH model picker does, without saving a global default.
     * @returns the selection recorded, or false.
     */
    async selectRoute(agent, who) {
        if (this.selectionMode !== 'session' || !agent) return false;
        const label = `${who.projectId}/${who.threadId ?? 'coordinator'}`;
        try {
            const wanted = this.fullSelection(await this.checkedRoute(who));
            if (!wanted) throw new Error('no DSH default model to build on');
            const selection = await this.resolveSelection(wanted);
            this.ownSelections.set(agent.id, selectionKey(selection));
            this.sc.agents.selectForNextRequest(agent, selection);
            this.log(`select ${label} ${selection.provider}:${selection.model} effort=${selection.reasoningEffort ?? '-'}`);
            return selection;
        } catch (error) {
            this.ownSelections.delete(agent.id);
            this.log(`error select ${label} ${String(error?.message ?? error).slice(0, 200)}`);
            this.ctx.logger?.warn?.('projects: could not set the model for %s: %s', label, error?.message ?? error);
            return false;
        }
    }

    /**
     * Select the coordinator's route when its settings differ from the ones
     * it last got. A new coordinator on the DSH default needs no selection.
     * @returns false only when a needed selection failed.
     */
    async applyCoordinatorRoute(projectId) {
        if (this.selectionMode !== 'session') return true;
        const stored = this.store.project(projectId);
        if (!stored.coordinatorSessionId) return true;
        const s = this.settings(projectId);
        const key = routeKey(s.coordinatorModel.value, s.coordinatorEffort.value);
        if (stored.coordinatorRoute === key) return true;
        if (stored.coordinatorRoute === undefined && key === '[null,null]') {
            this.store.putProject(projectId, { coordinatorRoute: key });
            return true;
        }
        let agent;
        try {
            agent = await this.attach(stored.coordinatorSessionId);
        } catch (error) {
            this.log(`error select ${projectId}/coordinator ${String(error?.message ?? error).slice(0, 200)}`);
            return false;
        }
        if (!await this.selectRoute(agent, { projectId, role: 'coordinator' })) return false;
        this.store.putProject(projectId, { coordinatorRoute: key });
        return true;
    }

    /**
     * A `model/selection` on a project session. One the manager made itself
     * is skipped. Any other is the user's pick in DSH's own model picker
     * (the composer's model menu or /model): on a coordinator it becomes the
     * project's coordinator model and effort, on a thread that thread's, so
     * the project's settings say what its sessions run on.
     */
    onSelection(who, agent, data) {
        try {
            if (typeof data?.provider !== 'string' || typeof data?.model !== 'string' || !this.projects.has(who.projectId)) return;
            if (this.ownSelections.get(agent.id) === selectionKey(data)) {
                this.ownSelections.delete(agent.id);
                return;
            }
            const model = `${data.provider}:${data.model}`;
            const effort = typeof data.reasoningEffort === 'string' && data.reasoningEffort !== '' ? data.reasoningEffort : undefined;
            if (who.role === 'coordinator') {
                this.store.putSettings(who.projectId, { coordinatorModel: model, coordinatorEffort: effort });
                // It already runs on the pick, so nothing selects it again.
                const s = this.settings(who.projectId);
                this.store.putProject(who.projectId, { coordinatorRoute: routeKey(s.coordinatorModel.value, s.coordinatorEffort.value) });
            } else {
                if (!this.store.thread(who.projectId, who.threadId)) return;
                this.store.putThread(who.projectId, who.threadId, { model, effort });
            }
            this.log(`picked ${who.projectId}/${who.threadId ?? 'coordinator'} ${model} effort=${effort ?? '-'}`);
        } catch (error) {
            this.log(`error picked ${who.projectId} ${String(error?.message ?? error).slice(0, 200)}`);
        }
    }

    readMemory(projectId) {
        try { return readFileSync(this.memoryPath(projectId), 'utf8'); } catch { return ''; }
    }

    coordinatorText(projectId) {
        const project = this.project(projectId);
        return coordinatorPolicy({
            name: project.name,
            goal: this.goalOf(projectId),
            workspacePath: project.workspacePath,
            home: isHome(project.workspacePath),
            guarded: this.guards().map(([name]) => name),
            yourTools: this.access(projectId).yourTools.value,
            readOnly: this.readOnlyCoordinator(projectId),
            paused: this.paused(projectId),
            threads: this.store.project(projectId).threads,
            memory: this.readMemory(projectId),
            liveStatus: (sid) => this.liveStatus(sid),
        });
    }

    threadText(projectId, threadId) {
        const project = this.project(projectId);
        const t = this.store.thread(projectId, threadId);
        const tools = this.toolsFor({ projectId, role: 'thread', threadId });
        return threadPolicy({
            name: project.name,
            goal: this.goalOf(projectId),
            threadId,
            title: t?.title ?? threadId,
            home: isHome(t?.folder ?? project.workspacePath),
            guarded: this.guards().map(([name]) => name),
            yourTools: tools === 'all' ? 'always' : 'asked',
            // Under "asked", the user's tools this thread has.
            tools: tools === 'all' ? undefined : [...tools],
            memory: this.readMemory(projectId),
        });
    }

    /**
     * Track thread turns. DSH runs queued messages as back-to-back turns and
     * goes idle once at the end, so the review looks at the last turn only.
     */
    async onThreadStatus(projectId, threadId, agent, status) {
        const state = this.turns.get(agent.id) ?? { running: false };
        if (status === 'running') {
            if (state.running) return;
            this.turns.set(agent.id, { running: true });
            // Marks a turn in flight, so one cut off by a DSH stop is reviewed at the next start.
            const t = this.store.thread(projectId, threadId);
            if (t && !t.busy) this.store.putThread(projectId, threadId, { busy: true });
            return;
        }
        if (status !== 'idle' || !state.running) return;
        this.turns.set(agent.id, { running: false });
        if (this.store.thread(projectId, threadId)?.busy) this.store.putThread(projectId, threadId, { busy: false });
        await this.reviewTurn(projectId, threadId, agent.id, { stopped: state.stopped });
    }

    /**
     * Review a thread's last ended turn once. A turn the coordinator started
     * that ended without a handback sends the automatic note. A turn the user
     * started by talking to the thread directly is only recorded for the
     * coordinator's roster: the user is already there, and a note would make
     * the coordinator take a turn for nothing.
     * @param {object} [options]
     * @param {{key: unknown}} [options.stopped] - the turn the coordinator stopped.
     * @param {boolean} [options.catchUp] - reviewing at start: only a turn that really ended.
     */
    async reviewTurn(projectId, threadId, sessionId, { stopped, catchUp = false } = {}) {
        const turn = await this.readTurn(sessionId);
        // What the turn changed, from the thread's own edits, whatever happens below.
        if (turn.ended) {
            try {
                await this.recordOwnChanges(projectId, threadId, sessionId, turn.number, { ...turn.read, waitForDsh: true });
            } catch (error) {
                this.log(`error changes ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
            }
        }
        const t = this.store.thread(projectId, threadId);
        if (!t || t.resolved || (catchUp && !turn.ended)) return;
        // The coordinator stopped this turn itself, so a note would only echo that back.
        const byCoordinator = Boolean(stopped && stopped.key === turn.key && turn.endKind === 'aborted');
        // A person stopped it, in DSH or through the session bridge: it stays stopped until they resume it.
        const byUser = !byCoordinator && turn.endKind === 'aborted' && turn.stopCause === 'user';
        if (turn.ended) {
            if (t.seenTurn === turn.key) return;
            // How the turn ended, for the coordinator's roster: kept while it failed or stopped.
            const text = byUser ? STOPPED_BY_USER : turn.ending;
            const ending = !turn.handedBack && endingStateOf(text) ? text.slice(0, 400) : undefined;
            this.store.putThread(projectId, threadId, {
                seenTurn: turn.key,
                lastEnding: ending ? { text: ending, kind: turn.endKind, at: new Date().toISOString() } : undefined,
            });
        }
        if (turn.handedBack || byCoordinator) return;
        if (this.archived(projectId)) {
            // Archiving stopped it, or the user brought it back alone and talked to it: nothing for the coordinator.
            this.log(`archived-turn ${projectId}/${threadId}`);
            return;
        }
        if (byUser) {
            // No note, so the coordinator takes no turn and can't send it on by itself.
            this.log(`user-stop ${projectId}/${threadId}`);
            return;
        }
        if (!turn.fromProject) {
            // The user talked to it there, so a question it had asked the coordinator is theirs to answer now.
            this.store.putThread(projectId, threadId, { lastDirect: { at: new Date().toISOString(), reply: turn.reply.slice(0, 500) }, question: undefined });
            this.log(`direct-turn ${projectId}/${threadId} chars=${turn.reply.length}`);
            return;
        }
        if (t.question && !turn.ending) {
            // It ended its turn to wait for the answer to its question, which the coordinator already has.
            this.log(`idle-question ${projectId}/${threadId}`);
            return;
        }
        if (this.config.autoHandback !== 'idle' || !this.allowHandback(projectId, threadId)) return;
        // One nudge in a row for a turn that ended without a handback, counted apart for a turn that failed or stopped
        // and one that just ended, so each note says what happened; the user hears when it didn't help, or when only they
        // can fix it, and the coordinator sends nothing more. A failed or stopped turn's nudge the plugin sends itself,
        // since a coordinator turn would only say so; while the project is paused its note waits like any other, and the
        // coordinator nudges it on resume. A handback, the user's words or their Retry start the count again.
        // A turn cut off because DSH closed while it ran (a quit, or a crash: its log can't tell them apart) gets no
        // nudge and doesn't count, so nothing starts again on its own after the user quits: the note tells them, and
        // the thread waits for their Resume.
        const ended = Boolean(endingStateOf(turn.ending));
        const cutOff = turn.endKind === 'interrupted' || (turn.endKind === 'aborted' && turn.stopCause === 'disposed');
        const again = !cutOff && (ended ? t.nudged === true : t.stalled === true);
        const nudge = !again && !cutOff && !(ended && userMustFix(turn.ending));
        if (!cutOff) this.store.putThread(projectId, threadId, ended ? { nudged: nudge ? true : undefined } : { nudged: undefined, stalled: true });
        if (nudge && ended && !this.held(projectId) && await this.nudgeThread(projectId, threadId, turn)) return;
        const news = nudge && ended ? undefined : { kind: ended ? endingStateOf(turn.ending) : 'finished', thread: threadId };
        await this.deliver(projectId, idleMessage(threadId, t.title, turn.reply, turn.ending, { nudge: nudge && ended, again }), undefined, news);
        this.log(`idle-note ${projectId}/${threadId} chars=${turn.reply.length}${turn.ending ? ` ended=${turn.endKind}` : ''}${nudge && ended ? ' nudge' : ''}${again ? ' again' : ''}`);
    }

    /**
     * The one nudge after a turn that failed or stopped without a handback, sent to the thread as from its
     * coordinator (the next turn's end is reviewed as the coordinator's).
     * @returns whether it went; when it didn't, the coordinator gets the note and nudges it.
     */
    async nudgeThread(projectId, threadId, turn) {
        try {
            await this.sendToThread(projectId, threadId, NUDGE, false);
        } catch (error) {
            this.log(`error nudge ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
            return false;
        }
        this.log(`nudge ${projectId}/${threadId} ended=${turn.endKind}`);
        return true;
    }

    /**
     * At start: review the turns of threads that were mid-turn when the
     * plugin last looked, unless they are running now (their end is watched).
     */
    async catchUp(projectId) {
        for (const [threadId, t] of Object.entries(this.store.project(projectId).threads)) {
            if (this.disposed) return;
            if (!t.busy || t.resolved) continue;
            if (this.ctx.agents.get(t.sessionId)?.status === 'running') continue;
            this.store.putThread(projectId, threadId, { busy: false });
            try {
                await this.reviewTurn(projectId, threadId, t.sessionId, { catchUp: true });
            } catch (error) {
                this.log(`error catch-up ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
            }
        }
    }

    /**
     * Watch a thread's permission prompts. One still unanswered after
     * approvalNoticeSeconds tells the coordinator, so a thread it started
     * does not sit on a prompt nobody sees.
     */
    onThreadEvent(projectId, threadId, agent, event) {
        if (event?.type === 'model/selection') {
            this.onSelection({ projectId, role: 'thread', threadId }, agent, event.data);
            return;
        }
        if (event?.type === 'permission/preset') {
            this.onPermission({ projectId, role: 'thread', threadId }, agent, event.data);
            return;
        }
        if (event?.type === 'turn/start') {
            if (Number.isSafeInteger(event.data?.turn)) this.threadTurns.set(agent.id, event.data.turn);
            return;
        }
        if (event?.type === 'workspace/changes') {
            this.noteChanges(projectId, threadId, agent.id, event.seq, event.data?.turn);
            return;
        }
        // DSH queues a message (agent/inbox/spliced) before the turn that reads it gathers its
        // tools, and logs it (user/message) once that turn already has them: the queued copy
        // is what lets the user's words give a tool to the very turn that answers them.
        if (event?.type === 'agent/inbox/spliced') {
            for (const message of Array.isArray(event.data?.inserted) ? event.data.inserted : []) this.onThreadPrompt(projectId, threadId, promptOf({ type: 'user/message', data: message }));
            return;
        }
        const prompt = promptOf(event);
        if (prompt) {
            this.onThreadPrompt(projectId, threadId, prompt);
            return;
        }
        const id = event?.data?.id;
        if (!id) return;
        if (event.type === 'approval/decided') {
            clearTimeout(this.approvals.get(agent.id)?.get(id));
            this.approvals.get(agent.id)?.delete(id);
            return;
        }
        if (event.type !== 'approval/asked' || !(this.config.approvalNoticeSeconds > 0)) return;
        const pending = this.approvals.get(agent.id) ?? new Map();
        this.approvals.set(agent.id, pending);
        const timer = setTimeout(() => {
            pending.delete(id);
            void this.noticeApproval(projectId, threadId, agent, event.data).catch((error) => {
                this.log(`error approval ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
            });
        }, this.config.approvalNoticeSeconds * 1000);
        timer.unref?.();
        pending.set(id, timer);
    }

    /** The user writing to a thread directly: the tools their words name are theirs to give it. */
    onThreadPrompt(projectId, threadId, prompt) {
        if (!prompt || prompt.fromProject) return;
        try {
            const guard = this.guards();
            if (guard.length > 0) this.addThreadTools(projectId, threadId, guardedIn(prompt.text, guard, { aliases: true }), 'from the user in the thread');
        } catch (error) {
            this.log(`error tools ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
        }
    }

    /**
     * DSH announced a thread turn's changes. Its summary diffs the whole
     * folder, so it would credit the thread with what other threads and
     * chats there changed meanwhile: the plugin counts the turn from the
     * thread's own edits instead, and keeps DSH's announcement only so its
     * Review tab opens that turn.
     */
    noteChanges(projectId, threadId, sessionId, seq, turn) {
        if (!Number.isSafeInteger(seq) || !Number.isSafeInteger(turn)) return;
        const turns = this.announced.get(sessionId) ?? new Map();
        turns.set(turn, seq);
        // The newest few turns are enough: a turn is announced at its end.
        for (const key of [...turns.keys()].slice(0, -8)) turns.delete(key);
        this.announced.set(sessionId, turns);
        void this.recordOwnChanges(projectId, threadId, sessionId, turn).catch((error) => {
            this.log(`error changes ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
        });
    }

    /**
     * Keep one turn's changes with the thread, counted from its own
     * file-tool records (write, edit, str_replace_editor) and its
     * subagents': lines added and deleted per file, so the totals outlive a
     * DSH restart. A turn that changed nothing of its own keeps no record.
     * @param {{events: object[], folder?: string, endSeq?: number, waitForDsh?: boolean}} [read] - the thread's log, when the caller
     *   already read it; `waitForDsh` at the turn's end, when DSH may still announce the turn.
     */
    async recordOwnChanges(projectId, threadId, sessionId, turn, read = undefined) {
        if (!Number.isSafeInteger(turn) || !this.store.thread(projectId, threadId)) return;
        let { events, folder, endSeq } = read ?? {};
        if (!Array.isArray(events)) {
            const inspected = await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
            events = ownEvents(inspected);
            folder = inspected?.meta?.cwd;
        }
        // From here on nothing waits, so what was announced meanwhile and the stored records are read as they are now.
        const t = this.store.thread(projectId, threadId);
        if (!t) return;
        const own = editsIn(events).filter((e) => e.turn === turn);
        const sub = (this.subEdits.get(sessionId) ?? []).filter((e) => e.turn === turn);
        // Subagent edits of turns long over are no longer needed.
        if (this.subEdits.has(sessionId)) this.subEdits.set(sessionId, this.subEdits.get(sessionId).filter((e) => Number.isSafeInteger(e.turn) && e.turn >= turn - 2));
        const was = (Array.isArray(t.changes) ? t.changes : []).find((r) => r?.turn === turn);
        const summary = editSummary(turn, [...own, ...sub], folder ?? this.ctx.agents.get(sessionId)?.session?.header?.cwd);
        if (!summary && !was) return;
        const announced = this.announced.get(sessionId)?.get(turn);
        // DSH announces a turn's changes a moment after the turn ends: wait for that, so the record
        // carries its seq and Review opens the turn. Without one (nothing changed in the folder as
        // DSH sees it, or no DSH service), the turn's end stands in.
        if (announced === undefined && read?.waitForDsh && summary && this.ctx.get?.('workspaceChanges')) {
            const timer = setTimeout(() => {
                if (this.disposed || this.announced.get(sessionId)?.has(turn)) return;
                void this.recordOwnChanges(projectId, threadId, sessionId, turn, { ...read, waitForDsh: false }).catch((error) => {
                    this.log(`error changes ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                });
            }, this.announceWaitMs);
            timer.unref?.();
            return;
        }
        const seq = announced ?? (Number.isSafeInteger(endSeq) ? endSeq : undefined) ?? own.at(-1)?.seq ?? was?.seq ?? 0;
        const record = summary ? changeRecord(seq, summary) : { turn, seq, added: 0, deleted: 0, total: 0, files: [] };
        if (!record) return;
        const changes = withChange(t.changes, record);
        if (JSON.stringify(changes) === JSON.stringify(t.changes ?? [])) return;
        try {
            this.store.putThread(projectId, threadId, { changes });
        } catch (error) {
            this.log(`error changes ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
            return;
        }
        this.log(`changes ${projectId}/${threadId} turn=${turn} files=${record.total} +${record.added} -${record.deleted}${sub.length > 0 ? ` subagents=${sub.length}` : ''}`);
    }

    /**
     * Every session's events, as DSH's own change recorder hears them: a
     * file edit by a subagent (or a teammate) that works for a thread counts
     * for that thread's turn. The thread's own edits are read from its log.
     * Never throws: this runs inside DSH's event delivery.
     */
    onSessionEvent(session, event) {
        const type = event?.type;
        if (type !== 'tool/call' && type !== 'tool/result') return;
        try {
            const id = session?.id;
            if (typeof id !== 'string') return;
            if (type === 'tool/call') {
                if (!FILE_TOOLS.has(event.data?.name) || typeof event.data.callId !== 'string') return;
                const thread = this.threadAbove(session);
                if (!thread) return;
                this.subCalls.set(`${id}\n${event.data.callId}`, { name: event.data.name, args: event.data.arguments, thread });
                for (const key of [...this.subCalls.keys()].slice(0, -200)) this.subCalls.delete(key);
                return;
            }
            const message = event.data?.message;
            const key = `${id}\n${message?.toolCallId ?? message?.source?.callId}`;
            const call = this.subCalls.get(key);
            if (!call) return;
            this.subCalls.delete(key);
            if (message?.isError === true || event.data?.error !== undefined) return;
            let args = call.args;
            if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
            const edit = editOf(call.name, args, event.data?.meta);
            if (!edit || !(edit.added + edit.deleted > 0 || edit.created)) return;
            const list = this.subEdits.get(call.thread) ?? [];
            list.push({ turn: this.threadTurns.get(call.thread) ?? null, seq: event.seq, ...edit });
            this.subEdits.set(call.thread, list.slice(-500));
        } catch (error) {
            this.log(`error subagent-edit ${String(error?.message ?? error).slice(0, 200)}`);
        }
    }

    /** The thread session a subagent's session works for: its nearest ancestor that is a thread, or null. */
    threadAbove(session) {
        const id = session?.id;
        if (this.subThreads.has(id)) return this.subThreads.get(id);
        let parent = session?.header?.parentSession;
        let found = null;
        for (let depth = 0; depth < 8 && typeof parent === 'string' && parent !== ''; depth++) {
            const who = this.store.lookup(parent);
            if (who) {
                if (who.role === 'thread') found = parent;
                break;
            }
            parent = this.ctx.agents.get(parent)?.session?.header?.parentSession;
        }
        this.subThreads.set(id, found);
        for (const key of [...this.subThreads.keys()].slice(0, -500)) this.subThreads.delete(key);
        return found;
    }

    /**
     * Threads from before the plugin counted their own edits kept DSH's
     * whole-folder numbers: count each one again from its log, once. A
     * subagent's edits in those turns aren't in the thread's log, so they
     * drop out.
     */
    async recountChanges() {
        for (const projectId of [...this.projects.keys()]) {
            for (const [threadId, t] of Object.entries(this.store.project(projectId)?.threads ?? {})) {
                if (this.disposed) return;
                if (t?.ownCounts === true || typeof t?.sessionId !== 'string') continue;
                if (!Array.isArray(t.changes) || t.changes.length === 0) {
                    this.store.putThread(projectId, threadId, { ownCounts: true });
                    continue;
                }
                let inspected;
                try {
                    inspected = await this.sc.inspect(t.sessionId, AbortSignal.timeout(20000));
                } catch (error) {
                    // Tried again at the next start.
                    this.log(`error recount ${projectId}/${threadId} ${String(error?.message ?? error).slice(0, 200)}`);
                    continue;
                }
                if (this.disposed) return;
                const fresh = this.store.thread(projectId, threadId);
                if (!fresh) continue;
                const byTurn = new Map();
                for (const edit of editsIn(ownEvents(inspected))) byTurn.set(edit.turn, [...(byTurn.get(edit.turn) ?? []), edit]);
                let changes = [];
                for (const [turn, edits] of byTurn) {
                    const summary = editSummary(turn, edits, inspected?.meta?.cwd);
                    const record = summary && changeRecord((Array.isArray(fresh.changes) ? fresh.changes : []).find((r) => r?.turn === turn)?.seq ?? edits.at(-1).seq, summary);
                    if (record) changes = withChange(changes, record);
                }
                this.store.putThread(projectId, threadId, { changes, ownCounts: true });
                this.log(`changes recounted ${projectId}/${threadId} turns=${changes.length} was=${Array.isArray(fresh.changes) ? fresh.changes.length : 0}`);
            }
        }
    }

    /**
     * A thread's changes as the window shows them: totals over its turns,
     * and whether DSH can still show the newest turn's diff.
     */
    threadChanges(t) {
        const totals = changeTotals(t.changes);
        if (!totals) return null;
        let reviewable = false;
        try { reviewable = typeof t.sessionId === 'string' && this.ctx.get?.('workspaceChanges')?.summary?.(t.sessionId, totals.last.seq) !== undefined; } catch {}
        return { ...totals, reviewable };
    }

    clearApprovals(sessionId) {
        for (const timer of this.approvals.get(sessionId)?.values() ?? []) clearTimeout(timer);
        this.approvals.delete(sessionId);
    }

    /** Watch the permission prompts a running turn already waits on (after a reload). */
    async rearmApprovals(projectId, threadId, agent) {
        const events = (await this.sc.inspect(agent.id, AbortSignal.timeout(20000))).events ?? [];
        const { start } = turnRange(events, true);
        // The turn it is in, for what its subagents change before it ends.
        const turnNow = events[start]?.type === 'turn/start' ? events[start].data?.turn : undefined;
        if (Number.isSafeInteger(turnNow) && !this.threadTurns.has(agent.id)) this.threadTurns.set(agent.id, turnNow);
        const open = new Map();
        for (const event of events.slice(start)) {
            if (event?.type === 'approval/asked' && event.data?.id) open.set(event.data.id, event);
            else if (event?.type === 'approval/decided') open.delete(event.data?.id);
        }
        for (const event of open.values()) this.onThreadEvent(projectId, threadId, agent, event);
    }

    async noticeApproval(projectId, threadId, agent, data) {
        const t = this.store.thread(projectId, threadId);
        if (!t || t.resolved || !this.projects.has(projectId) || this.archived(projectId)) return;
        // Told once: a reload or a restart watches the prompts a turn still waits on again, but the
        // coordinator already heard about this one, and each note would start a turn of its own.
        const id = String(data.id ?? '');
        if (id !== '' && t.approvalsNoted?.includes(id)) return;
        const turn = await this.readTurn(agent.id, { current: true });
        // The user is talking to the thread directly, so the prompt is in front of them.
        if (!turn.fromProject || !this.allowHandback(projectId, threadId)) return;
        if (id !== '') this.store.putThread(projectId, threadId, { approvalsNoted: [...(this.store.thread(projectId, threadId)?.approvalsNoted ?? []), id].slice(-20) });
        await this.deliver(projectId, approvalMessage(threadId, t.title, t.title, String(data.toolName ?? 'a tool'), data.reason), undefined, { kind: 'approval', thread: threadId });
        this.log(`approval-note ${projectId}/${threadId} tool=${String(data.toolName ?? '').slice(0, 60)}`);
    }

    /** Rate cap: at most maxHandbacksPerHour per thread, explicit and automatic together. */
    allowHandback(projectId, threadId) {
        const t = this.store.thread(projectId, threadId);
        const now = Date.now();
        const recent = (t?.handbackTimes ?? []).filter((ms) => now - ms < HOUR);
        if (recent.length >= this.config.maxHandbacksPerHour) return false;
        this.store.putThread(projectId, threadId, { handbackTimes: [...recent, now] });
        return true;
    }

    /**
     * One turn of a session, read from its log: the last one that ended, or
     * with `current` the one running now. Returns its `key` (the seq of its
     * first event), whether it `ended`, how (`endKind`, and `ending` as a line
     * when that was not a normal completion), its last reply, whether it
     * handed back, and whether its prompt came from this project (the
     * coordinator) rather than from the user directly.
     */
    async readTurn(sessionId, { current = false } = {}) {
        const inspected = await this.sc.inspect(sessionId, AbortSignal.timeout(20000));
        const events = inspected?.events ?? [];
        const { start, end, reason, ended } = turnRange(events, current);
        let reply = '';
        let prompt = null;
        const handbacks = new Map();
        let handedBack = false;
        for (let i = start; i < end; i++) {
            const event = events[i];
            if (roleOf(event) === 'assistant') reply = textOf(event) || reply;
            prompt = promptOf(event) ?? prompt;
            if (event?.type === 'tool/call' && event.data?.name === 'project_handback') {
                handbacks.set(event.data.callId, argsOf(event.data.arguments)?.status);
            } else if (event?.type === 'tool/result') {
                const callId = event.data?.message?.toolCallId ?? event.data?.message?.source?.callId;
                const status = handbacks.get(callId);
                if (status && status !== 'progress' && textOf(event).startsWith('Handback ')) handedBack = true;
            }
        }
        // A turn with no prompt of its own (woken by the Host) belongs to the last prompt before it.
        for (let i = start - 1; !prompt && i >= 0; i--) prompt = promptOf(events[i]);
        return {
            key: events[start]?.seq ?? start,
            ended,
            endKind: reason?.kind,
            // Who stopped a stopped turn: 'user' when a person did (DSH's stop button, the session bridge) or the coordinator did.
            stopCause: reason?.kind === 'aborted' && typeof reason.reason?.kind === 'string' ? reason.reason.kind : undefined,
            ending: describeEnding(reason),
            reply,
            handedBack,
            fromProject: prompt ? prompt.fromProject : true,
            // The turn's number, and the log as recordOwnChanges reads it.
            number: events.slice(start, end).find((e) => Number.isSafeInteger(e?.data?.turn))?.data.turn,
            read: { events: ownEvents(inspected), folder: inspected?.meta?.cwd, endSeq: ended ? events[end - 1]?.seq : undefined },
        };
    }

    /** Run one delivery step after the ones before it, so the coordinator gets messages in order. */
    serial(projectId, step) {
        const run = (this.chains.get(projectId) ?? Promise.resolve()).then(step);
        this.chains.set(projectId, run.catch(() => {}));
        return run;
    }

    /**
     * Send text to the coordinator after anything held before it. It is
     * held while the project is paused, and retried when the coordinator
     * cannot take it.
     * @param {string} [from] - the thread session it comes from; none for the plugin's own notes.
     * @param {{kind: string, thread: string, status?: string}} [news] - what the user hears about once the coordinator has it (noteNews).
     * @returns {Promise<'delivered'|'held'>}
     */
    deliver(projectId, text, from = undefined, news = undefined) {
        return this.serial(projectId, async () => {
            const pending = this.store.project(projectId).pendingHandbacks;
            const item = from || news ? { text, ...(from ? { from } : {}), ...(news ? { news } : {}) } : text;
            this.store.putProject(projectId, { pendingHandbacks: [...pending, item] });
            if (this.held(projectId)) return 'held';
            return (await this.sendHeld(projectId)) === 0 ? 'delivered' : 'held';
        });
    }

    /** Deliver held messages now, unless paused or archived. @returns how many were sent. */
    flushPending(projectId) {
        return this.serial(projectId, async () => {
            const before = this.store.project(projectId).pendingHandbacks.length;
            if (before === 0 || this.held(projectId)) return 0;
            const sent = before - await this.sendHeld(projectId);
            this.log(`flush ${projectId} sent=${sent}`);
            return sent;
        });
    }

    /** Send held messages in order until one fails; then retry later. Runs inside `serial`. @returns how many are left. */
    async sendHeld(projectId) {
        const sessionId = this.store.project(projectId).coordinatorSessionId;
        // No coordinator yet: the next start makes one and sends them.
        if (!sessionId) return this.store.project(projectId).pendingHandbacks.length;
        while (this.store.project(projectId).pendingHandbacks.length > 0 && !this.held(projectId)) {
            // A held message is its text (the plugin's own note) or {text, from?, news?} (a thread's handback, or a note the user hears about).
            const next = this.store.project(projectId).pendingHandbacks[0];
            const text = typeof next === 'string' ? next : typeof next?.text === 'string' ? next.text : '';
            try {
                if (text.trim() !== '') await this.prompt(sessionId, text, 'queue', typeof next?.from === 'string' ? next.from : undefined);
            } catch (error) {
                this.log(`error deliver ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
                this.retryLater(projectId);
                break;
            }
            this.store.putProject(projectId, { pendingHandbacks: this.store.project(projectId).pendingHandbacks.slice(1) });
            if (text.trim() !== '' && next?.news) this.noteNews(projectId, next.news);
        }
        const left = this.store.project(projectId).pendingHandbacks.length;
        if (left === 0) {
            clearTimeout(this.retries.get(projectId)?.timer);
            this.retries.delete(projectId);
        }
        return left;
    }

    /** Try held messages again later, backing off up to timing.maxRetryMs. */
    retryLater(projectId) {
        const retry = this.retries.get(projectId) ?? { attempt: 0 };
        if (retry.timer || this.disposed) return;
        const delay = Math.min(timing.retryMs * 2 ** retry.attempt, timing.maxRetryMs);
        retry.attempt += 1;
        retry.timer = setTimeout(() => {
            retry.timer = undefined;
            // DSH quits on any unhandled rejection in the Host, so a failed flush is only logged.
            void this.flushPending(projectId).catch((error) => {
                this.log(`error flush ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            });
        }, delay);
        retry.timer.unref?.();
        this.retries.set(projectId, retry);
    }

    /**
     * Something the user should hear about wherever they are in the window,
     * kept once the coordinator has it: the ◆ row shows it unread and the
     * window shows a notice, until the user opens the coordinator (seeNews).
     * @param {{kind: string, thread: string, status?: string}} news - kind from NEWS_KINDS.
     */
    noteNews(projectId, news) {
        if (!NEWS_KINDS.includes(news?.kind) || typeof news.thread !== 'string') return;
        const stored = this.store.project(projectId);
        const old = isObject(stored.news) ? stored.news : {};
        const seq = (Number.isInteger(old.seq) ? old.seq : 0) + 1;
        const item = {
            seq, kind: news.kind, thread: news.thread, title: this.store.thread(projectId, news.thread)?.title ?? news.thread,
            ...(typeof news.status === 'string' ? { status: news.status } : {}), at: new Date().toISOString(),
        };
        const items = [...(Array.isArray(old.items) ? old.items : []), item].slice(-MAX_NEWS);
        this.store.putProject(projectId, { news: { seq, seen: Number.isInteger(old.seen) ? old.seen : 0, items } });
        this.log(`news ${projectId}/${news.thread} ${news.kind}${item.status ? ` ${item.status}` : ''} seq=${seq}`);
    }

    /** The user has seen a project's news up to `seq` (all of it when omitted): they opened its coordinator. */
    seeNews(projectId, seq = undefined) {
        const news = this.store.project(projectId).news;
        if (!isObject(news) || !Number.isInteger(news.seq)) return;
        const upTo = Number.isInteger(seq) ? Math.min(seq, news.seq) : news.seq;
        if (upTo <= (news.seen ?? 0)) return;
        this.store.putProject(projectId, { news: { ...news, seen: upTo } });
    }

    /**
     * Every project with a coordinator and its news the user hasn't seen:
     * [{project, name, coordinator, seq, seen, unread: [{seq, kind, thread, title, status?, at}]}].
     */
    listNews() {
        const out = [];
        for (const projectId of this.projects.keys()) {
            const stored = this.store.project(projectId);
            if (typeof stored.coordinatorSessionId !== 'string' || this.archived(projectId)) continue;
            const news = isObject(stored.news) ? stored.news : {};
            const seq = Number.isInteger(news.seq) ? news.seq : 0;
            const seen = Number.isInteger(news.seen) ? news.seen : 0;
            const unread = (Array.isArray(news.items) ? news.items : []).filter((item) => isObject(item) && item.seq > seen);
            out.push({ project: projectId, name: this.project(projectId).name, coordinator: stored.coordinatorSessionId, seq, seen, unread });
        }
        return out;
    }

    // ── what the DSH window draws ──────────────────────────────────────────

    /**
     * What a project tool result records for the DSH window: its presentation
     * meta, which the `projectSession` projection folds (projection.js). It
     * names the project and the session's role; for a coordinator it carries
     * the roster entries the call touched (all of them with `full`), and
     * `action` is the card the call's turn shows. Never throws: a tool's
     * result must not fail over its picture.
     * @param {string} projectId
     * @param {{role: 'coordinator'|'thread', threadId?: string}} who
     * @param {{action?: object, threads?: string[], full?: boolean}} [details]
     * @returns {object|null}
     */
    view(projectId, who, details = {}) {
        try {
            const project = this.projects.get(projectId);
            if (!project) return null;
            const stored = this.store.project(projectId);
            const out = { [META_MARK]: 1, role: who.role, project: { id: projectId, name: project.name } };
            if (stored.coordinatorSessionId) out.coordinator = stored.coordinatorSessionId;
            if (who.role === 'thread') {
                out.thread = { id: who.threadId, title: stored.threads[who.threadId]?.title ?? who.threadId };
            } else {
                const ids = details.full ? rosterIds(stored.threads) : (details.threads ?? []).filter((id) => stored.threads[id]);
                out.threads = ids.map((id) => rosterEntry(id, stored.threads[id]));
                if (details.full) out.full = true;
            }
            if (details.action) out.action = details.action;
            return out;
        } catch (error) {
            this.log(`error view ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            return null;
        }
    }

    /**
     * The projection's starting value for a session this store knows, so a
     * coordinator or thread from before the projection existed shows its
     * project and threads the first time DSH folds it.
     * @param {string} sessionId
     */
    seedView(sessionId) {
        const who = this.store.lookup(sessionId);
        if (!who || !this.projects.has(who.projectId)) return null;
        return this.view(who.projectId, who, who.role === 'coordinator' ? { full: true } : {});
    }

    // ── operations behind the tools ────────────────────────────────────────

    /** The thread for an id as the model typed it (" t3 " is t3), or an error that lists the threads. */
    requireThread(projectId, threadId) {
        const id = String(threadId ?? '').trim();
        const t = this.store.thread(projectId, id);
        if (!t) {
            const known = Object.keys(this.store.project(projectId).threads).join(', ') || 'none';
            throw new ProjectError(`no thread "${id}" in this project (threads: ${known})`);
        }
        return { id, t };
    }

    /**
     * Refuse a thread start or message that would use a guarded tool
     * (config.guardedTools) the user's words don't call for: `allowed` (the
     * user's tools their checked words give the thread) or the project's
     * goal must name it. The first real run drifted from a test task the
     * coordinator picked itself into the user's model lanes; this holds
     * whatever the model makes of its prompt, under either yourTools.
     */
    guard(projectId, what, text, allowed) {
        const guard = this.guards();
        if (guard.length === 0) return;
        const ok = new Set([...allowed, ...guardedIn(this.goalOf(projectId), guard, { aliases: true })]);
        const blocked = guardedIn(text, guard).filter((name) => !ok.has(name));
        if (blocked.length === 0) return;
        this.log(`guard ${projectId} ${what} ${blocked.join(',')}`);
        const them = blocked.length > 1 ? 'them' : 'it';
        const how = what === 'send' ? 'put their words in ask, or start a thread for it with their words in ask' : 'put their words in ask';
        throw new ProjectError(`this would use ${blocked.join(', ')}, and the user's words do not ask for ${them}. Keep the work inside the workspace, or ask the user first. If the user did ask, ${how}. If the text only says not to use ${them}, leave that out: threads already have that rule`);
    }

    async startThread(projectId, { title, ask, brief, model, effort }) {
        const project = this.project(projectId);
        if (this.archived(projectId)) throw new ProjectError(ARCHIVED);
        if (this.paused(projectId)) throw new ProjectError('the project is paused; new threads are blocked until it resumes');
        const cleanTitle = clipTitle(title);
        if (!cleanTitle) throw new ProjectError('title is required');
        if (!String(brief ?? '').trim()) throw new ProjectError('brief is required');
        const userWords = typeof ask === 'string' ? ask.trim().slice(0, 4000) : '';
        if (!userWords) throw new ProjectError('ask is required: copy the user\'s words from their message');
        // A thread works where its project does, so it shows under its project in DSH's list.
        const where = project.workspacePath;
        if (!where) throw new ProjectError('DSH has no workspace for this project\'s folder right now');
        // The user's tools the thread gets: the ones the ask names that the user really wrote.
        const tools = await this.askedTools(projectId, userWords);
        this.guard(projectId, 'start', `${cleanTitle}\n${userWords}\n${brief}`, tools);
        await this.requireUserWords(projectId, userWords, 'start');
        const access = this.access(projectId);
        // Its permission preset; one DSH doesn't offer (any more) is not one to start a thread on.
        const preset = this.presets() ? this.presetOf(access.threadPermission.value) : undefined;
        if (this.presets() && !preset) {
            this.log(`permission ${projectId} unknown preset ${access.threadPermission.value}`);
            throw new ProjectError(`threads in this project start on the permission "${access.threadPermission.value}", which DSH doesn't offer. Tell the user to choose another in Project settings`);
        }
        const s = this.settings(projectId);
        // Not given, or "default": the project's thread default.
        const given = (value) => value !== undefined && value !== 'default';
        const or = (value, fallback) => (given(value) ? value : fallback);
        // An effort the model lacks never stops a start: it runs at the nearest
        // level and the result says so. Only an effort no model offers is refused.
        const check = checkSelection(await this.catalog(), or(model, s.threadModel.value), or(effort, s.threadEffort.value),
            { fit: given(effort) ? 'known' : true });
        if (!check.ok) throw new ProjectError(check.error);
        // Every attempt counts, so a coordinator caught in a loop stops even when starts fail.
        const now = Date.now();
        const starts = (this.store.project(projectId).threadStarts ?? []).filter((ms) => now - ms < HOUR);
        if (starts.length >= this.config.maxThreadsPerHour) {
            this.log(`thread-limit ${projectId} ${starts.length}`);
            throw new ProjectError(`thread limit reached: this project started ${starts.length} threads in the last hour (maxThreadsPerHour). Tell the user, and continue in existing threads with project_thread_send`);
        }
        this.store.putProject(projectId, { threadStarts: [...starts, now] });

        const threadId = this.store.reserveThreadId(projectId);
        const sessionId = await this.createSession(project, where);
        this.store.putThread(projectId, threadId, {
            sessionId, title: cleanTitle, model: check.model, effort: check.effort,
            resolved: false, createdAt: new Date().toISOString(), handbackTimes: [], seenTurn: null, ownCounts: true,
            ...(userWords ? { ask: userWords } : {}),
            tools,
        });
        const agent = await this.attach(sessionId);
        // On the project's thread permission before it reads its brief; a thread that can't be put there doesn't start.
        if (preset) {
            if (!agent || !this.setPermission(agent, preset, `${projectId}/${threadId}`)) {
                this.store.putThread(projectId, threadId, { resolved: true });
                this.log(`thread-start ${projectId}/${threadId} ${sessionId} not started: permission`);
                throw new ProjectError(`${threadId} could not be put on the permission "${preset}", so it did not start. Tell the user (details in the projects log)`);
            }
            this.store.putThread(projectId, threadId, { permission: this.permissionOf(sessionId) ?? preset });
        }
        const notes = check.note ? [check.note] : [];
        if (this.selectionMode === 'session') {
            const applied = await this.selectRoute(agent, { projectId, role: 'thread', threadId });
            if (!applied) {
                if (check.model || check.effort) notes.push('the model could not be set, so the thread runs on the DSH default (details in the projects log)');
            } else if (!check.model || (!check.effort && applied.reasoningEffort)) {
                // The thread keeps what it started on, even when the DSH default changes later, so record it.
                this.store.putThread(projectId, threadId, {
                    model: check.model ?? `${applied.provider}:${applied.model}`,
                    effort: check.effort ?? applied.reasoningEffort,
                });
            }
        }
        await this.sc.rename({ sessionId, title: cleanTitle }).catch(() => {});
        await this.prompt(sessionId, briefMessage(project.name, threadId, cleanTitle, brief.trim(), userWords), 'queue', this.store.project(projectId).coordinatorSessionId);
        this.log(`thread-start ${projectId}/${threadId} ${sessionId} brief-chars=${brief.length} ask-chars=${userWords.length}`);
        // What it runs on is named only when the coordinator asked for a model or effort: otherwise it is a setting the coordinator needs no word of.
        const asked = given(model) || given(effort);
        return {
            threadId, sessionId, title: cleanTitle, route: asked ? describeRoute(check.model, check.effort) : undefined, notes: asked ? notes : [],
            // The user's tools it has because the user's words name them, which the coordinator may tell the user.
            tools: access.yourTools.value === 'asked' ? tools : [],
        };
    }

    /**
     * Send a thread a message. `ask` is the user's words when the message
     * passes on their request; the coordinator's own messages (`ask`
     * undefined) and the plugin's (`guard` false) say only what they say.
     * The user's tools the checked ask names join the thread's before it
     * reads the message.
     */
    async sendToThread(projectId, threadId, text, steer, { ask, guard = false } = {}) {
        const { id, t } = this.requireThread(projectId, threadId);
        if (this.archived(projectId)) throw new ProjectError(ARCHIVED);
        if (!String(text ?? '').trim()) throw new ProjectError('text is required');
        const userWords = typeof ask === 'string' ? ask.trim().slice(0, 4000) : '';
        let tools = [];
        if (guard) {
            // More of the user's tools only when the user's checked words for this message name them.
            tools = await this.askedTools(projectId, userWords);
            this.guard(projectId, 'send', `${userWords}\n${text}`, [...(Array.isArray(t.tools) ? t.tools : []), ...tools]);
            if (userWords !== '') await this.requireUserWords(projectId, userWords, 'send');
        }
        if (t.resolved) this.store.putThread(projectId, id, { resolved: false });
        await this.attach(t.sessionId);
        this.addThreadTools(projectId, id, tools, 'from the user\'s words in a message');
        // Whatever the coordinator sends answers the thread's open question, if it had one.
        if (t.question) this.store.putThread(projectId, id, { question: undefined });
        // The user's words make it new work: a turn that then ends without a handback gets its own nudge.
        if (userWords !== '' && (t.nudged || t.stalled)) this.store.putThread(projectId, id, { nudged: undefined, stalled: undefined });
        await this.prompt(t.sessionId, coordinatorMessage(text.trim(), userWords), steer ? 'steer' : 'queue', this.store.project(projectId).coordinatorSessionId);
        this.log(`thread-send ${projectId}/${id} mode=${steer ? 'steer' : 'queue'} chars=${text.length}`);
        return `${steer ? 'Steered' : 'Sent to'} ${id}${t.resolved ? ' (reopened)' : ''}.`;
    }

    // ── messages to chats outside the project ──────────────────────────────

    /**
     * Whether the coordinator's turn now is one the user started: the
     * newest prompt in it is the user's own message, not a note from a
     * thread, the plugin or another chat. A message out of the project goes
     * only from such a turn, so two coordinators can't keep answering each
     * other's replies.
     */
    async userTurn(projectId) {
        const sessionId = this.store.project(projectId).coordinatorSessionId;
        if (!sessionId) return false;
        return (await this.readTurn(sessionId, { current: true })).fromProject === false;
    }

    /** The chats DSH lists (newest first), without subagents' sessions or empty ones. */
    async chatList() {
        const { items } = await this.sc.list({}, AbortSignal.timeout(20000));
        return (Array.isArray(items) ? items : [])
            .filter((item) => typeof item?.sessionId === 'string' && typeof item.cwd === 'string' && !item.parentSessionId && item.blank !== true)
            .map((item) => ({
                sessionId: item.sessionId,
                title: typeof item.projections?.values?.title === 'string' ? item.projections.values.title : '',
                cwd: item.cwd,
                updatedAt: item.updatedAt,
            }));
    }

    /**
     * The chat project_message names: another project's coordinator (its
     * name, with or without ◆, or its id), or a chat that belongs to no
     * project (its title as DSH lists it, or its session id). A thread
     * stays with its project, so naming one is refused with where to send
     * instead; so is a title several chats share.
     * @returns {Promise<{sessionId: string, name: string, kind: 'project'|'chat'}>}
     */
    async messageTarget(projectId, to) {
        const raw = String(to ?? '').trim();
        if (!raw) throw new ProjectError('to is required: a chat\'s title, or another project\'s name');
        const bare = raw.replace(/^◆\s*/, '').replace(/^"([^]*)"$/, '$1').trim();
        const key = bare.toLowerCase();
        const own = this.project(projectId);
        if (bare === projectId || String(own.name).trim().toLowerCase() === key) throw new ProjectError('that is this project: you are its coordinator');
        const toProject = (id) => {
            const name = this.project(id).name;
            const sessionId = this.store.project(id).coordinatorSessionId;
            if (!sessionId) throw new ProjectError(`◆ ${name} has no coordinator right now`);
            // A message would wake the coordinator the user retired with its project.
            if (this.archived(id)) throw new ProjectError(`◆ ${name} is archived; the user can bring it back with Restore project in its ◆ row's menu`);
            return { sessionId, name: `◆ ${name}`, kind: 'project' };
        };
        for (const [id, p] of this.projects) {
            if (id === bare || String(p.name).trim().toLowerCase() === key) return toProject(id);
        }
        const chats = await this.chatList();
        const byId = chats.find((c) => c.sessionId === raw);
        const found = byId ? [byId] : chats.filter((c) => c.title.trim().toLowerCase() === key);
        if (found.length === 0) {
            const others = [...this.projects].filter(([id]) => id !== projectId && this.store.project(id).coordinatorSessionId).map(([, p]) => `◆ ${p.name}`);
            const recent = chats.filter((c) => !this.store.lookup(c.sessionId) && c.title).slice(0, 8).map((c) => `"${c.title}"`);
            throw new ProjectError(`no chat or project here is called "${clipTitle(bare)}".${others.length ? ` Other projects: ${others.join(', ')}.` : ''}`
                + `${recent.length ? ` Recent chats: ${recent.join(', ')}.` : ''} Put one of these in to as it is written, or ask the user which chat they mean`);
        }
        if (found.length > 1) {
            const list = found.slice(0, 8).map((c) => `${c.sessionId} (in ${c.cwd}${Number.isFinite(c.updatedAt) && c.updatedAt > 0 ? `, last active ${new Date(c.updatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''})`);
            throw new ProjectError(`${found.length} chats are called "${clipTitle(bare)}": ${list.join('; ')}. Put the id of the one the user means in to, or ask the user`);
        }
        const chat = found[0];
        const who = this.store.lookup(chat.sessionId);
        if (who?.projectId === projectId) {
            if (who.role === 'coordinator') throw new ProjectError('that is this chat: you are its coordinator');
            throw new ProjectError(`that is this project's thread ${who.threadId}: use project_thread_send`);
        }
        if (who && this.projects.has(who.projectId)) {
            if (who.role === 'coordinator') return toProject(who.projectId);
            throw new ProjectError(`that is a thread of ◆ ${this.project(who.projectId).name}, and a thread stays with its project. Send it to ◆ ${this.project(who.projectId).name} instead`);
        }
        return { sessionId: chat.sessionId, name: `"${chat.title || chat.sessionId}"`, kind: 'chat' };
    }

    /** The seq of a session's newest logged event, or -1. */
    async lastSeq(sessionId) {
        const events = (await this.sc.inspect(sessionId, AbortSignal.timeout(20000))).events ?? [];
        const last = events.length - 1;
        return last < 0 ? -1 : Number.isSafeInteger(events[last]?.seq) ? events[last].seq : last;
    }

    /**
     * project_message: send a chat outside the project, or another
     * project's coordinator, a message the user asked for. It goes only in
     * a turn the user started, with their words (`ask`) as they wrote them,
     * and a guarded tool in it needs the user's words for it, as a thread's
     * start does. The chat stays outside the project: it gets no thread,
     * card, tools or place in the project. Its answer to the message comes
     * back to the coordinator once, as a note (collectReplies).
     * @returns the chat it went to.
     */
    async sendMessage(projectId, { to, ask, text }) {
        const body = String(text ?? '').trim();
        if (!body) throw new ProjectError('text is required');
        const userWords = typeof ask === 'string' ? ask.trim().slice(0, 4000) : '';
        if (!userWords) throw new ProjectError('ask is required: copy the user\'s words from their message');
        const from = this.store.project(projectId).coordinatorSessionId;
        if (!from) throw new ProjectError('this project has no coordinator right now');
        if (!await this.userTurn(projectId)) {
            this.log(`guard ${projectId} message-not-asked`);
            throw new ProjectError('a message goes out of the project only in a turn the user started. Tell the user what came in, and send it when they ask');
        }
        if (!wordsKey(await this.userText(projectId)).includes(wordsKey(userWords))) {
            this.log(`guard ${projectId} message-unsaid`);
            throw new ProjectError('ask must be the user\'s own words, copied from their message here');
        }
        const target = await this.messageTarget(projectId, to);
        // The user's tools: a chat outside a project has all of them, so the message may name only the ones the user's words do.
        const tools = await this.askedTools(projectId, userWords);
        this.guard(projectId, 'message', `${userWords}\n${body}`, tools);
        const after = await this.lastSeq(target.sessionId);
        await this.prompt(target.sessionId, outsideMessage(this.project(projectId).name, userWords, body), 'queue', from);
        const waiting = this.store.project(projectId).awaiting ?? [];
        if (!waiting.some((w) => w.to === target.sessionId)) {
            const entry = { to: target.sessionId, name: target.name, from, after, at: new Date().toISOString() };
            this.store.putProject(projectId, { awaiting: [...waiting, entry].slice(-MAX_AWAITING) });
        }
        this.awaited.add(target.sessionId);
        this.log(`message ${projectId} to=${target.kind} ${target.sessionId} chars=${body.length} ask-chars=${userWords.length}`);
        return target;
    }

    /**
     * The turn in which a chat answered a coordinator's message: the first
     * of its messages from `from` after `after`, and the turn that took it.
     */
    async messageTurn(sessionId, after, from) {
        const events = (await this.sc.inspect(sessionId, AbortSignal.timeout(20000))).events ?? [];
        const seqOf = (event, i) => (Number.isSafeInteger(event?.seq) ? event.seq : i);
        const at = events.findIndex((event, i) => seqOf(event, i) > after && roleOf(event) === 'user'
            && (event.data?.message ?? event.data)?.source?.senderSessionId === from && textOf(event).startsWith(TAGS.message));
        if (at < 0) return { found: false, ended: false };
        const end = events.findIndex((event, i) => i > at && event?.type === 'turn/end');
        if (end < 0) return { found: true, ended: false };
        let reply = '';
        for (let i = at + 1; i < end; i++) if (roleOf(events[i]) === 'assistant') reply = textOf(events[i]) || reply;
        return { found: true, ended: true, reply: reply.trim(), ending: describeEnding(events[end].data?.reason ?? null) };
    }

    /** A session went idle: if it owes a coordinator a reply, look for it, one check at a time. */
    onAgentStatus(agent, status) {
        const id = agent?.id;
        if (status !== 'idle' || this.disposed || !this.awaited.has(id)) return;
        const run = (this.replyChecks.get(id) ?? Promise.resolve()).then(() => this.collectReplies(id)).catch((error) => {
            this.log(`error message-reply ${id} ${String(error?.message ?? error).slice(0, 200)}`);
        });
        this.replyChecks.set(id, run);
        void run.finally(() => { if (this.replyChecks.get(id) === run) this.replyChecks.delete(id); });
    }

    /**
     * Deliver each reply a chat owes a coordinator, once: the answer of the
     * turn that took the message, once that turn ended. A chat DSH no
     * longer has owes nothing.
     */
    async collectReplies(target) {
        for (const projectId of [...this.projects.keys()]) {
            const mine = (this.store.project(projectId).awaiting ?? []).find((w) => w?.to === target);
            if (!mine) continue;
            let turn;
            try {
                turn = await this.messageTurn(target, mine.after, mine.from);
            } catch (error) {
                if (await this.exists(target).catch(() => true)) throw error;
                turn = undefined;
            }
            if (turn && !turn.ended) continue;
            this.store.putProject(projectId, { awaiting: (this.store.project(projectId).awaiting ?? []).filter((w) => w?.to !== target) });
            if (!turn) {
                this.log(`message-gone ${projectId} ${target}`);
                continue;
            }
            const outcome = await this.deliver(projectId, replyMessage(mine.name, turn.reply, turn.ending), target);
            this.log(`message-reply ${projectId} ${target} ${outcome} chars=${turn.reply.length}${turn.ending ? ' ended=other' : ''}`);
        }
        if (![...this.projects.keys()].some((id) => (this.store.project(id).awaiting ?? []).some((w) => w?.to === target))) this.awaited.delete(target);
    }

    /**
     * At start: the replies still owed. One that came while DSH was off is
     * delivered now; one older than a day is let go.
     */
    async catchUpReplies() {
        const now = Date.now();
        for (const projectId of this.projects.keys()) {
            const waiting = this.store.projects[projectId]?.awaiting;
            if (!Array.isArray(waiting) || waiting.length === 0) continue;
            const fresh = waiting.filter((w) => typeof w?.to === 'string' && now - Date.parse(w.at) < AWAIT_MS);
            if (fresh.length !== waiting.length) {
                this.store.putProject(projectId, { awaiting: fresh });
                this.log(`message-expired ${projectId} n=${waiting.length - fresh.length}`);
            }
            for (const w of fresh) this.awaited.add(w.to);
        }
        for (const target of [...this.awaited]) {
            if (this.disposed) return;
            if (this.ctx.agents.get(target)?.status === 'running') continue;
            await this.collectReplies(target).catch((error) => {
                this.log(`error message-reply ${target} ${String(error?.message ?? error).slice(0, 200)}`);
            });
        }
    }

    /**
     * Run a thread again after its last turn failed or stopped: Retry and
     * Resume in the DSH window. The thread hears it from its coordinator,
     * so its handback, or the idle note, reaches the coordinator as usual.
     * Refused for a resolved or running thread, and for one whose last turn
     * finished.
     * @returns the project as describeProject shows it.
     */
    async continueThread(projectId, threadKey) {
        const { id, t } = this.requireThread(projectId, threadKey);
        if (t.resolved) throw new ProjectError(`${id} is resolved`);
        if (this.ctx.agents.get(t.sessionId)?.status === 'running') throw new ProjectError(`${id} is running already`);
        const turn = await this.readTurn(t.sessionId);
        const state = turn.ended && !turn.handedBack ? endingStateOf(turn.ending) : undefined;
        if (!state) throw new ProjectError(`${id}'s last turn finished, so there is nothing to retry`);
        // As the roster tells it (a person's stop says so), once that turn was reviewed.
        const ending = t.seenTurn === turn.key && t.lastEnding?.text ? t.lastEnding.text : turn.ending;
        // The user asked for it, so a turn that then ends without a handback gets its own nudge.
        if (t.nudged || t.stalled) this.store.putThread(projectId, id, { nudged: undefined, stalled: undefined });
        await this.sendToThread(projectId, id, continueMessage(ending, state === 'failed'), false);
        this.log(`thread-continue ${projectId}/${id} after=${turn.endKind}`);
        return this.describeProject(projectId);
    }

    listThreads(projectId, includeResolved) {
        const all = this.store.project(projectId).threads;
        const threads = includeResolved ? all : Object.fromEntries(Object.entries(all).filter(([, t]) => !t.resolved));
        const hidden = Object.keys(all).length - Object.keys(threads).length;
        return [...rosterLines(threads, (sid) => this.liveStatus(sid)), hidden > 0 ? `(${hidden} resolved hidden)` : '']
            .filter(Boolean).join('\n');
    }

    async readThread(projectId, threadId, count = 6) {
        const { id, t } = this.requireThread(projectId, threadId);
        const r = await this.sc.inspect(t.sessionId, AbortSignal.timeout(20000));
        const msgs = (r.events ?? [])
            .map((e) => (roleOf(e) === 'user' ? { role: 'user', text: promptOf(e)?.text } : { role: roleOf(e), text: textOf(e) }))
            .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text);
        const n = Math.max(1, Math.min(Number(count) || 6, 30));
        const lines = msgs.slice(-n).map((m) => `## ${m.role}\n${m.text.length > 3000 ? `${m.text.slice(0, 3000)}…` : m.text}`);
        // What it is doing and what it changed, so the coordinator can follow it between handbacks.
        const steps = stepsOf(r.events ?? []);
        const files = changedFiles(t.changes);
        return [
            `${id} · "${t.title}" · ${t.resolved ? 'resolved' : this.liveStatus(t.sessionId)}`,
            files ? `Changed so far: ${files}` : null,
            steps ? `Latest steps: ${steps}` : null,
            ...lines,
        ].filter((line) => line !== null).join('\n\n');
    }

    async updateThread(projectId, threadKey, changes) {
        const { id: threadId, t } = this.requireThread(projectId, threadKey);
        const out = [];
        const fields = {};
        if (changes.title !== undefined && String(changes.title).trim()) {
            fields.title = clipTitle(changes.title);
            await this.sc.rename({ sessionId: t.sessionId, title: fields.title }).catch(() => {});
            out.push(`renamed to "${fields.title}"`);
        }
        if (changes.model !== undefined || changes.effort !== undefined) {
            const s = this.settings(projectId);
            const wantModel = changes.model === undefined ? t.model : changes.model === 'default' ? s.threadModel.value : changes.model;
            const wantEffort = changes.effort === undefined ? t.effort : changes.effort === 'default' ? s.threadEffort.value : changes.effort;
            // A new model fits the effort the thread already had; an effort given now must be offered.
            const check = checkSelection(await this.catalog(), wantModel, wantEffort,
                { fit: changes.effort === undefined || changes.effort === 'default' });
            if (!check.ok) throw new ProjectError(check.error);
            fields.model = check.model;
            fields.effort = check.effort;
            out.push(`route ${describeRoute(check.model, check.effort)} from the next request`);
            if (check.note) out.push(check.note);
        }
        if (changes.resolved !== undefined) {
            fields.resolved = changes.resolved === true;
            out.push(fields.resolved ? 'resolved' : 'reopened');
        }
        if (Object.keys(fields).length > 0) this.store.putThread(projectId, threadId, fields);
        if ('model' in fields && this.selectionMode === 'session'
            && !await this.selectRoute(await this.attach(t.sessionId), { projectId, role: 'thread', threadId })) {
            out.push('but the model could not be set, so it keeps its current one (details in the projects log)');
        }
        if (changes.stop === true) {
            if (this.ctx.agents.get(t.sessionId)?.status !== 'running') {
                out.push('no turn was running');
            } else {
                const state = this.turns.get(t.sessionId);
                if (state?.running) state.stopped = { key: (await this.readTurn(t.sessionId, { current: true })).key };
                try {
                    await this.sc.cancel({ sessionId: t.sessionId });
                    out.push('current turn stopped (queued messages kept)');
                } catch (error) {
                    if (state) state.stopped = undefined;
                    out.push(`the turn could not be stopped (${String(error?.message ?? error).slice(0, 200)})`);
                }
            }
        }
        this.log(`thread-update ${projectId}/${threadId} ${Object.keys(fields).join(',')}${changes.stop ? ',stop' : ''}`);
        return out.length ? `${threadId}: ${out.join('; ')}.` : `${threadId}: nothing to change.`;
    }

    /**
     * Change the project's own settings. A model or effort of "default"
     * clears it, so the project row or the plugin default applies again;
     * `paused: null` does the same for pause.
     * @param {object} changes - coordinatorModel, coordinatorEffort, threadModel, threadEffort, paused, and from
     *   Project settings only, goal (null: the profile row's again).
     * @returns {Promise<{notes: string[], flushed: number}>}
     */
    async changeSettings(projectId, changes) {
        const next = {};
        const current = this.settings(projectId);
        const val = (v) => (v === 'default' ? undefined : v);
        const pairs = [['coordinatorModel', 'coordinatorEffort'], ['threadModel', 'threadEffort']];
        const notes = [];
        let catalog;
        for (const [mKey, eKey] of pairs) {
            if (changes[mKey] === undefined && changes[eKey] === undefined) continue;
            catalog ??= await this.catalog();
            // A cleared setting is checked as what it falls back to.
            const inherited = effectiveSettings(pluginDefaults(this.config), this.project(projectId), {});
            const model = changes[mKey] === undefined ? current[mKey].value : changes[mKey] === 'default' ? inherited[mKey].value : changes[mKey];
            const effort = changes[eKey] === undefined ? current[eKey].value : changes[eKey] === 'default' ? inherited[eKey].value : changes[eKey];
            // An effort set now must be offered; one kept from before or inherited is fitted.
            const effortGiven = changes[eKey] !== undefined && changes[eKey] !== 'default';
            const check = checkSelection(catalog, model, effort, { fit: !effortGiven });
            if (!check.ok) throw new ProjectError(check.error);
            if (changes[mKey] !== undefined) next[mKey] = changes[mKey] === 'default' ? undefined : check.model;
            if (changes[eKey] !== undefined) next[eKey] = changes[eKey] === 'default' ? undefined : (check.effort ?? val(effort)?.trim());
            // The project's own effort follows a new model: fitted, or cleared when the model has no levels.
            else if (changes[mKey] !== undefined && current[eKey].source === 'project setting' && (check.fitted || check.effort === undefined)) next[eKey] = check.effort;
            if (check.note) notes.push(`${mKey === 'coordinatorModel' ? 'Coordinator' : 'Threads'}: ${check.note}.`);
        }
        const wasPaused = this.paused(projectId);
        if (changes.paused === null) next.paused = undefined;
        else if (typeof changes.paused === 'boolean') next.paused = changes.paused;
        // The goal: the user's own text (an empty one too), or null to use the profile row's again.
        if (changes.goal === null) next.goal = undefined;
        else if (typeof changes.goal === 'string') {
            const goal = changes.goal.replace(/\r\n?/g, '\n').trim();
            if (goal.length > GOAL_CHARS) throw new ProjectError(`a goal can be at most ${GOAL_CHARS} characters; this one has ${goal.length}`);
            next.goal = goal;
        }
        this.store.putSettings(projectId, next);
        // Every call also retries a coordinator selection that failed before.
        if (!await this.applyCoordinatorRoute(projectId)) {
            notes.push('The coordinator model could not be switched; it keeps its current one (details in the projects log).');
        }
        let flushed = 0;
        if (wasPaused && !this.paused(projectId)) flushed = await this.flushPending(projectId);
        this.log(`settings ${projectId} ${Object.keys(next).join(',')}`);
        return { notes, flushed };
    }

    /**
     * Change settings through the coordinator's project_settings tool.
     * @returns {Promise<string>} the settings after the change, as the tool reports them.
     */
    async updateSettings(projectId, changes) {
        const { notes, flushed } = await this.changeSettings(projectId, changes);
        const s = this.settings(projectId);
        return [
            `Coordinator: ${describeRoute(s.coordinatorModel.value, s.coordinatorEffort.value)} (${s.coordinatorModel.source} / ${s.coordinatorEffort.source})`,
            `New threads: ${describeRoute(s.threadModel.value, s.threadEffort.value)} (${s.threadModel.source} / ${s.threadEffort.source})`,
            `Paused: ${this.paused(projectId) ? 'yes' : 'no'}${flushed ? ` (delivered ${flushed} held handbacks)` : ''}`,
            ...this.accessLines(projectId),
            ...notes,
        ].join('\n');
    }

    /** The access settings as project_settings shows them; only the user changes them and the goal, in Project settings. */
    accessLines(projectId) {
        const a = this.access(projectId);
        const guarded = this.guards().map(([name]) => name);
        const permission = (value) => (value === 'default' ? `DSH's default (${this.presets()?.defaultPreset ?? 'unknown'})` : value);
        return [
            // Without their names: the coordinator mentions the user's tools only when asked (its rule 2 names them).
            guarded.length === 0 ? null
                : `The user's tools: ${a.yourTools.value === 'always' ? 'every session has them' : 'you don\'t have them; a thread has the ones the user\'s words for it name'}`,
            this.presets() ? `Permissions: coordinator ${permission(a.coordinatorPermission.value)}, new threads ${permission(a.threadPermission.value)}` : null,
            'The user changes these and the goal in Project settings; project_settings can\'t.',
        ].filter((line) => line !== null);
    }

    /**
     * Change the project's access settings, from the window only: the
     * user's tools ("asked" or "always") and the coordinator's and new
     * threads' permission (a preset DSH offers, or "default"). null clears
     * the project's own, so its profile row or the plugin default applies.
     * Walls follow at once, and the coordinator moves to its new
     * permission; running threads keep theirs.
     * @returns {string[]} notes.
     */
    changeAccess(projectId, changes) {
        const next = {};
        if (changes.yourTools !== undefined) {
            if (changes.yourTools !== null && !TOOL_MODES.includes(changes.yourTools)) throw new ProjectError('your tools must be "asked" or "always"');
            next.yourTools = changes.yourTools ?? undefined;
        }
        for (const key of ['coordinatorPermission', 'threadPermission']) {
            const value = changes[key];
            if (value === undefined) continue;
            if (value !== null && (typeof value !== 'string' || !this.presetOf(value))) {
                const offered = this.permissionCatalog()?.options.map((o) => o.value) ?? [];
                throw new ProjectError(offered.length ? `"${String(value).slice(0, 40)}" is not one of DSH's permissions (${['default', ...offered].join(', ')})` : 'this DSH has no permission presets');
            }
            next[key] = value ?? undefined;
        }
        if (Object.keys(next).length === 0) return [];
        this.store.putSettings(projectId, next);
        this.log(`access ${projectId} ${Object.keys(next).join(',')}`);
        if ('yourTools' in next) this.rewall(projectId);
        if ('coordinatorPermission' in next && !this.applyCoordinatorPermission(projectId)) {
            return ['The coordinator\'s permission could not be changed (details in the projects log).'];
        }
        return [];
    }

    /** Put one thread on another permission preset ("default": DSH's default for new sessions), from the window. */
    async changeThreadPermission(projectId, threadKey, value) {
        const { id, t } = this.requireThread(projectId, threadKey);
        const preset = typeof value === 'string' ? this.presetOf(value) : undefined;
        if (!preset) throw new ProjectError(`"${String(value).slice(0, 40)}" is not one of DSH's permissions`);
        const agent = await this.attach(t.sessionId);
        if (!agent || !this.setPermission(agent, preset, `${projectId}/${id}`)) throw new ProjectError(`${id}'s permission could not be changed (details in the projects log)`);
        this.store.putThread(projectId, id, { permission: preset });
        return `${id}: permission ${preset}.`;
    }

    // ── projects made in the window (remote.js) ──────────────────────────────

    /**
     * Make a project in the store, without a coordinator, and add it to the
     * running set.
     * @returns its id: the name as a slug, made unique.
     */
    makeProject(name, source, extra = {}) {
        const base = slugify(name);
        let id = base;
        for (let n = 2; this.projects.has(id) || this.store.projects[id] !== undefined; n += 1) id = `${base}-${n}`;
        const orders = Object.values(this.store.projects).map((p) => (Number.isFinite(p?.order) ? p.order : -1));
        this.store.putProject(id, { name, source, createdAt: new Date().toISOString(), order: Math.max(-1, ...orders) + 1, ...extra });
        this.addStored(id);
        this.log(`project-new ${id} ${source}`);
        return id;
    }

    /** A project name as the user typed it: one line, at most 80 bytes like a DSH title. */
    projectName(value) {
        const name = clipTitle(typeof value === 'string' ? value : '');
        if (name === '') throw new ProjectError('a project needs a name');
        return name;
    }

    /**
     * A new project from the Projects page: a ◆ coordinator in a DSH
     * workspace, started at once, whose threads work there too.
     * @returns {id, coordinator}.
     */
    async createProject(name, workspaceId) {
        const clean = this.projectName(name);
        const ws = this.workspace(workspaceId);
        if (!ws) throw new ProjectError(typeof workspaceId === 'string' && workspaceId !== '' ? 'DSH has no such workspace' : 'a project needs a workspace to work in');
        const id = this.makeProject(clean, 'page', { home: ws.id });
        const coordinator = await this.ensureCoordinator(id, { create: true });
        if (!coordinator) throw new ProjectError(`◆ ${clean} was made, but its coordinator could not start; open the Projects page to try again`);
        return { id, coordinator };
    }

    /** Rename a project made on the Projects page or imported; its coordinator, if any, follows. */
    async renameProject(projectId, name) {
        this.project(projectId);
        if (this.fromProfile(projectId)) throw new ProjectError('this project\'s name is set in your profile, so rename it there');
        const clean = this.projectName(name);
        const stored = this.store.project(projectId);
        const was = stored.name;
        if (clean === was) return;
        this.store.putProject(projectId, { name: clean });
        this.log(`project-rename ${projectId}`);
        const sessionId = stored.coordinatorSessionId;
        if (!sessionId) return;
        // The coordinator's title is "◆ <name>"; one the user renamed stays theirs.
        if (await this.currentTitle(sessionId) === dshTitle(`◆ ${was}`)) await this.sc.rename({ sessionId, title: `◆ ${clean}` }).catch(() => {});
    }

    /**
     * Delete a project made on the Projects page whose coordinator never
     * started. Its workspace and chats stay in DSH. One with a coordinator
     * keeps it: its threads would lose their project.
     */
    deleteProject(projectId) {
        const project = this.project(projectId);
        if (this.fromProfile(projectId)) throw new ProjectError('this project is set in your profile, so remove it there');
        if (this.store.projects[projectId]?.coordinatorSessionId) throw new ProjectError(`◆ ${project.name} has a coordinator, so it can't be deleted here`);
        this.store.removeProject(projectId);
        this.projects.delete(projectId);
        this.log(`project-delete ${projectId}`);
    }

    /**
     * Start the coordinator of a project made on the Projects page that has
     * none (it never started, or the user deleted it in DSH).
     * @returns the coordinator's session id.
     */
    async startCoordinator(projectId) {
        const project = this.project(projectId);
        if (this.archived(projectId)) throw new ProjectError(ARCHIVED);
        if (!this.fromProfile(projectId) && !this.homeOf(projectId)) throw new ProjectError(`DSH has no workspace for ${project.name}'s folder right now`);
        const sessionId = await this.ensureCoordinator(projectId, { create: true });
        if (!sessionId) throw new ProjectError('the coordinator could not start');
        return sessionId;
    }

    // ── archive: a project leaves DSH's session list with its coordinator and threads ──

    /** The project's sessions: its coordinator, then each thread's, resolved ones too. */
    projectSessions(projectId) {
        const stored = this.store.project(projectId);
        const ids = typeof stored.coordinatorSessionId === 'string' && stored.coordinatorSessionId !== '' ? [stored.coordinatorSessionId] : [];
        for (const id of rosterIds(stored.threads)) {
            const sessionId = stored.threads[id]?.sessionId;
            if (typeof sessionId === 'string' && sessionId !== '' && !ids.includes(sessionId)) ids.push(sessionId);
        }
        return ids;
    }

    /** DSH's archive set now; empty when this DSH has none. */
    archivedNow() {
        try {
            const ids = this.ctx.workspaceRegistry?.archivedSessionIds;
            return new Set(Array.isArray(ids) ? ids.map(String) : []);
        } catch {
            return new Set();
        }
    }

    /** Run one archive or restore of a project after any still running, across managers. */
    archiveStep(projectId, step) {
        const key = `${this.storeFile}#${projectId}`;
        const run = (archiving.get(key) ?? Promise.resolve()).then(step);
        const tail = run.then(() => {}, () => {});
        archiving.set(key, tail);
        void tail.then(() => { if (archiving.get(key) === tail) archiving.delete(key); });
        return run;
    }

    /**
     * Archive a project with its coordinator and threads: whatever runs in
     * them stops, and DSH archives each one, so they leave the session list
     * and the Projects page together. Nothing is deleted. While archived the
     * project starts no threads, and what a thread sends its coordinator
     * waits; restoreProject brings them all back.
     * @param {object} [options]
     * @param {'window'|'dsh'|'start'} [options.via] - the plugin's own action; DSH's own Archive on the ◆ row; or found so at a start.
     * @returns {{archived: number, failed: number}} how many sessions DSH archived now, and how many it refused.
     */
    async archiveProject(projectId, { via = 'window' } = {}) {
        this.project(projectId);
        const registry = this.ctx.workspaceRegistry;
        if (typeof registry?.archiveSession !== 'function') throw new ProjectError('this DSH can\'t archive sessions');
        return this.archiveStep(projectId, async () => {
            // Marked first, so nothing is sent to the coordinator meanwhile, and its own archive (below) is this one.
            const mark = this.archived(projectId) ? this.store.projects[projectId].archived : { at: new Date().toISOString(), via };
            this.store.putProject(projectId, { archived: mark });
            clearTimeout(this.retries.get(projectId)?.timer);
            this.retries.delete(projectId);
            const before = this.archivedNow();
            /** The sessions this archive has seen to: archived in DSH, or gone from it. */
            const done = new Set();
            let archived = 0;
            let failed = 0;
            for (const sessionId of this.projectSessions(projectId)) {
                this.clearApprovals(sessionId);
                if (before.has(sessionId)) {
                    done.add(sessionId);
                    continue;
                }
                try {
                    await registry.archiveSession(sessionId, { stopActivity: true });
                    done.add(sessionId);
                    archived += 1;
                } catch (error) {
                    // A session DSH no longer has (deleted there) has nothing to archive.
                    if (error?.name === 'WorkspaceUnknownSessionError') done.add(sessionId);
                    else failed += 1;
                    this.log(`error archive ${projectId} ${sessionId} ${String(error?.message ?? error).slice(0, 200)}`);
                }
            }
            this.store.putProject(projectId, { archived: { ...mark, sessions: [...done] } });
            this.log(`archive ${projectId} via=${via} sessions=${archived}${failed ? ` failed=${failed}` : ''}`);
            if (failed > 0 && via === 'window') throw new ProjectError(`DSH didn't archive ${failed} of ◆ ${this.project(projectId).name}'s sessions; try again`);
            return { archived, failed };
        });
    }

    /**
     * Bring an archived project back with its coordinator and threads: DSH
     * unarchives each one, and the coordinator gets what waited for it.
     * Work that archiving stopped stays stopped.
     * @param {object} [options]
     * @param {'window'|'dsh'|'start'} [options.via] - as for archiveProject.
     * @param {boolean} [options.resume] - bring the coordinator up now (false at a start, which does that next).
     * @returns {{restored: number}} how many sessions DSH unarchived now.
     */
    async restoreProject(projectId, { via = 'window', resume = true } = {}) {
        this.project(projectId);
        const registry = this.ctx.workspaceRegistry;
        if (typeof registry?.unarchiveSession !== 'function') throw new ProjectError('this DSH can\'t archive sessions');
        return this.archiveStep(projectId, async () => {
            const before = this.archivedNow();
            let restored = 0;
            for (const sessionId of this.projectSessions(projectId)) {
                if (!before.has(sessionId)) continue;
                try {
                    await registry.unarchiveSession(sessionId);
                    restored += 1;
                } catch (error) {
                    this.log(`error restore ${projectId} ${sessionId} ${String(error?.message ?? error).slice(0, 200)}`);
                }
            }
            const was = this.archived(projectId);
            if (was) this.store.putProject(projectId, { archived: undefined });
            this.log(`restore ${projectId} via=${via} sessions=${restored}`);
            if (was && resume && !this.disposed) await this.resume(projectId);
            return { restored };
        });
    }

    /**
     * At a start, what changed while the plugin was off: a ◆ coordinator
     * DSH archived takes its project's threads with it; an archived
     * project whose coordinator DSH unarchived comes back with its threads,
     * as when either happens while the plugin runs (onWorkspaceState); and
     * an archived project with sessions DSH never archived (it refused, or
     * the project was archived by hand in the file) has them archived now.
     * A thread the user unarchived on its own stays as they left it.
     *
     * Only a change counts: a coordinator DSH already had archived when the
     * plugin last looked, or before it ever looked (the first start of this
     * version, or a DSH home copied from another), or one DSH doesn't know,
     * archives nothing. Only the project's own mark, or DSH archiving a
     * coordinator it knows while the plugin was off, does.
     */
    async matchArchive() {
        const archived = this.archivedNow();
        this.archivedSeen = archived;
        if (typeof this.ctx.workspaceRegistry?.archiveSession !== 'function') return;
        for (const projectId of [...this.projects.keys()]) {
            if (this.disposed) return;
            const coordinator = this.store.projects[projectId]?.coordinatorSessionId;
            if (typeof coordinator !== 'string' || coordinator === '') continue;
            const mark = this.archived(projectId) ? this.store.projects[projectId].archived : undefined;
            const done = Array.isArray(mark?.sessions) ? mark.sessions : [];
            try {
                if (!mark) {
                    if (archived.has(coordinator) && this.seenArchived(projectId, coordinator) === false && await this.exists(coordinator)) {
                        await this.archiveProject(projectId, { via: 'start' });
                    }
                } else if (done.includes(coordinator) && !archived.has(coordinator)) {
                    await this.restoreProject(projectId, { via: 'start', resume: false });
                } else if (!Array.isArray(mark.sessions) || this.projectSessions(projectId).some((id) => !archived.has(id) && !done.includes(id))) {
                    // A mark made by hand lists no sessions yet: this archives what DSH hasn't and lists them all, so a
                    // later start knows which ones the archive saw to, even when DSH already had every one archived.
                    await this.archiveProject(projectId, { via: 'start' });
                }
            } catch (error) {
                this.log(`error archive-match ${projectId} ${String(error?.message ?? error).slice(0, 200)}`);
            }
            this.seeArchive(projectId, coordinator);
        }
    }

    /**
     * Whether a project's coordinator was archived in DSH when the plugin
     * last looked: true or false, or undefined when it never looked at this
     * coordinator.
     */
    seenArchived(projectId, coordinator) {
        const seen = this.store.projects[projectId]?.dshArchive;
        return seen?.coordinator === coordinator ? seen.archived === true : undefined;
    }

    /** Keep whether DSH has a project's coordinator archived now, for the next start to compare with. */
    seeArchive(projectId, coordinator, archived = this.archivedNow().has(coordinator)) {
        const seen = this.store.projects[projectId]?.dshArchive;
        if (seen?.coordinator === coordinator && seen.archived === archived) return;
        this.store.putProject(projectId, { dshArchive: { coordinator, archived } });
    }

    /**
     * DSH's archive set changed (its domain/changed event for the workspace
     * registry). A ◆ coordinator archived there, from its row's Archive or
     * the shortcut, takes its project's threads with it; unarchived there,
     * from its row or the Undo on DSH's notice, it brings them back. A
     * project whose own archive or restore is running is left to it.
     */
    onWorkspaceState(change) {
        if (this.disposed || change?.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return;
        const ids = change.value?.archivedSessionIds;
        if (!Array.isArray(ids)) return;
        const before = this.archivedSeen;
        const now = new Set(ids.map(String));
        this.archivedSeen = now;
        // Not started yet: the start matches the set as it is then.
        if (!before) return;
        for (const projectId of this.projects.keys()) {
            const coordinator = this.store.projects[projectId]?.coordinatorSessionId;
            if (typeof coordinator !== 'string' || coordinator === '' || now.has(coordinator) === before.has(coordinator)) continue;
            this.seeArchive(projectId, coordinator, now.has(coordinator));
            if (archiving.has(`${this.storeFile}#${projectId}`)) continue;
            const step = now.has(coordinator)
                ? (this.archived(projectId) ? undefined : () => this.archiveProject(projectId, { via: 'dsh' }))
                : (this.archived(projectId) ? () => this.restoreProject(projectId, { via: 'dsh' }) : undefined);
            // DSH quits on any unhandled rejection in the Host, so a failure is only logged.
            if (step) void step().catch((error) => this.log(`error archive-follow ${projectId} ${String(error?.message ?? error).slice(0, 200)}`));
        }
    }

    /**
     * What DSH's own Archive on a ◆ row stops besides the coordinator's own
     * work: its project's threads that are running now, which go with it.
     * DSH asks before stopping them and names them. Undefined when there are
     * none, or the session is no running project's coordinator.
     * @returns {{kind: string, items: {id: string, label: string}[]}|undefined}
     */
    archiveActivity(sessionId) {
        try {
            const who = typeof sessionId === 'string' ? this.store.lookup(sessionId) : null;
            if (who?.role !== 'coordinator' || !this.projects.has(who.projectId) || this.archived(who.projectId)) return undefined;
            const stored = this.store.project(who.projectId);
            const archived = this.archivedNow();
            const items = rosterIds(stored.threads)
                .filter((id) => !archived.has(stored.threads[id].sessionId) && this.ctx.agents.get(stored.threads[id].sessionId)?.status === 'running')
                .map((id) => ({ id: stored.threads[id].sessionId, label: stored.threads[id].title || id }));
            return items.length > 0 ? { kind: 'project threads', items } : undefined;
        } catch {
            return undefined;
        }
    }

    // ── the Project settings dialog (remote.js) ────────────────────────────

    /** The project a window call names: a project id, or the id of one of its sessions. */
    projectFor(target) {
        const value = typeof target === 'string' ? target.trim() : '';
        if (this.projects.has(value)) return value;
        const who = value ? this.store.lookup(value) : null;
        if (who && this.projects.has(who.projectId)) return who.projectId;
        throw new ProjectError(value ? `"${value.slice(0, 80)}" is not a project here, nor one of its sessions` : 'no project given');
    }

    /**
     * The model a loaded session runs its next request on, from DSH's own
     * model selection record; undefined when the session is not loaded.
     */
    liveSelection(sessionId) {
        try {
            const session = this.ctx.agents.get(sessionId)?.session;
            const state = session ? this.ctx.get?.('sessionProjections')?.stateOf?.(session, 'modelSelection') : undefined;
            const picked = state?.pending ?? state?.lastUsed;
            if (!picked?.provider || !picked?.model) return undefined;
            return { provider: picked.provider, model: picked.model, ...(picked.reasoningEffort ? { reasoningEffort: String(picked.reasoningEffort) } : {}) };
        } catch {
            return undefined;
        }
    }

    /**
     * A project as its Project settings dialog shows it: each of the four
     * settings and the three access settings with its source and what it
     * falls back to without the project's own, pause (with how many messages
     * it holds and whose handbacks), and every thread with its model, its
     * permission and the user's tools it has.
     */
    describeProject(projectId) {
        const project = this.project(projectId);
        const stored = this.store.project(projectId);
        const settings = this.settings(projectId);
        const inherited = effectiveSettings(pluginDefaults(this.config), project, {});
        const access = this.access(projectId);
        const inheritedAccess = effectiveAccess(pluginDefaults(this.config), project, {});
        const own = typeof stored.settings.paused === 'boolean';
        const toolsOf = (who) => {
            const tools = this.toolsFor(who);
            return tools === 'all' ? 'all' : [...tools];
        };
        return {
            project: {
                id: projectId,
                name: project.name,
                source: project.source,
                workspace: project.workspacePath ?? null,
                // The window's first asks stay out of the rest of the user's home folder.
                homeFolder: isHome(project.workspacePath),
                coordinator: stored.coordinatorSessionId ?? null,
                archived: this.archived(projectId),
                live: this.liveSelection(stored.coordinatorSessionId) ?? null,
                // Its permission preset now, while DSH has it loaded; and the user's tools it has.
                permission: this.permissionOf(stored.coordinatorSessionId) ?? null,
                tools: toolsOf({ projectId, role: 'coordinator' }),
            },
            settings: Object.fromEntries(SETTING_KEYS.map((key) => [key, { ...settings[key], inherited: inherited[key] }])),
            access: Object.fromEntries(ACCESS_KEYS.map((key) => [key, { ...access[key], inherited: inheritedAccess[key] }])),
            // The user's tools (guardedTools), and the permissions DSH offers, for the dialog's menus.
            guarded: this.guards().map(([name]) => name),
            permissions: this.permissionCatalog(),
            paused: {
                value: this.paused(projectId), source: own ? 'project setting' : 'project config', inherited: project.paused === true,
                held: stored.pendingHandbacks.length, handbacks: heldHandbacks(stored.pendingHandbacks),
            },
            // The goal, where it comes from, the profile row's under it, and the user's tools it names (every thread has those).
            goal: {
                value: this.goalOf(projectId),
                source: typeof stored.settings.goal === 'string' ? 'project setting' : typeof project.goal === 'string' && project.goal.trim() !== '' ? 'project config' : 'none',
                inherited: typeof project.goal === 'string' ? project.goal.trim() : '',
                tools: guardedIn(this.goalOf(projectId), this.guards(), { aliases: true }),
                max: GOAL_CHARS,
            },
            threads: rosterIds(stored.threads).map((id) => {
                const t = stored.threads[id];
                return {
                    id, title: t.title, session: t.sessionId ?? null, resolved: t.resolved === true,
                    model: t.model ?? null, effort: t.effort ?? null, live: this.liveSelection(t.sessionId) ?? null,
                    handback: t.lastHandback?.status ?? null,
                    changes: this.threadChanges(t),
                    permission: this.permissionOf(t.sessionId) ?? t.permission ?? null,
                    tools: toolsOf({ projectId, role: 'thread', threadId: id }),
                };
            }),
        };
    }

    /**
     * Every project as the plugin's page lists it: the four settings and the
     * access settings with their sources, what the coordinator runs on right
     * now (model and permission), pause, and how many threads are open.
     */
    listProjects() {
        // The order of the Projects page: DSH's workspace order of each project's home, then the profile's order, then
        // the projects made in the window, in their stored order.
        const workspaceAt = new Map(this.workspaceList().map((ws, i) => [ws.id, i]));
        const listed = [...this.projects.keys()].map((projectId, index) => {
            const project = this.project(projectId);
            const stored = this.store.project(projectId);
            const settings = this.settings(projectId);
            const ids = rosterIds(stored.threads);
            const open = ids.filter((id) => stored.threads[id].resolved !== true).length;
            const home = this.homeOf(projectId);
            const access = this.access(projectId);
            return {
                id: projectId,
                name: project.name,
                source: project.source,
                workspace: project.workspacePath ?? null,
                home: home?.id ?? null,
                workspaces: home ? [{ id: home.id, path: home.path, title: home.title }] : [],
                coordinator: stored.coordinatorSessionId ?? null,
                live: this.liveSelection(stored.coordinatorSessionId) ?? null,
                permission: this.permissionOf(stored.coordinatorSessionId) ?? null,
                paused: this.paused(projectId),
                archived: this.archived(projectId),
                settings: Object.fromEntries(SETTING_KEYS.map((key) => [key, { value: settings[key].value ?? null, source: settings[key].source }])),
                access: Object.fromEntries(ACCESS_KEYS.map((key) => [key, { value: access[key].value, source: access[key].source }])),
                threads: { open, resolved: ids.length - open },
                order: [
                    home && workspaceAt.has(home.id) ? workspaceAt.get(home.id) : workspaceAt.size,
                    this.fromProfile(projectId) ? index : 10000 + (Number.isFinite(stored.order) ? stored.order : index),
                ],
            };
        });
        const by = (a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1];
        return listed.sort(by).map(({ order, ...project }) => project);
    }

    /**
     * A change from the Project settings dialog: the project's settings, or
     * one thread's model, effort and permission. null puts a value back to
     * its default.
     * @param {object} changes - {coordinatorModel?, coordinatorEffort?, threadModel?, threadEffort?, paused?, goal?, yourTools?,
     *   coordinatorPermission?, threadPermission?} or {thread, model?, effort?, permission?}.
     * @returns the project as describeProject shows it, with `notes` from the change.
     */
    async changeFromWindow(projectId, changes) {
        const text = (value) => (value === null ? 'default' : typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
        // An access value: a word, or null to clear the project's own.
        const word = (value) => (value === null ? null : typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);
        let notes = [];
        if (changes.thread !== undefined) {
            const { id } = this.requireThread(projectId, changes.thread);
            if (changes.model !== undefined || changes.effort !== undefined || changes.permission === undefined) {
                notes.push(await this.updateThread(projectId, id, { model: text(changes.model), effort: text(changes.effort) }));
            }
            if (changes.permission !== undefined) notes.push(await this.changeThreadPermission(projectId, id, word(changes.permission)));
        } else {
            const access = this.changeAccess(projectId, {
                yourTools: word(changes.yourTools),
                coordinatorPermission: word(changes.coordinatorPermission),
                threadPermission: word(changes.threadPermission),
            });
            ({ notes } = await this.changeSettings(projectId, {
                coordinatorModel: text(changes.coordinatorModel),
                coordinatorEffort: text(changes.coordinatorEffort),
                threadModel: text(changes.threadModel),
                threadEffort: text(changes.threadEffort),
                paused: changes.paused === null || typeof changes.paused === 'boolean' ? changes.paused : undefined,
                goal: changes.goal === null || typeof changes.goal === 'string' ? changes.goal : undefined,
            }));
            notes = [...access, ...notes];
        }
        return { ...this.describeProject(projectId), notes };
    }

    memoryPath(projectId) {
        const project = this.project(projectId);
        return project.memoryFile ? dataPath(project.memoryFile) : `${dataPath(this.config.memoryDir)}/${projectId}.md`;
    }

    memory(projectId, action, text) {
        const path = this.memoryPath(projectId);
        if (action === 'read') {
            const body = this.readMemory(projectId);
            return body.trim() ? body : '(project memory is empty)';
        }
        if (action !== 'append' && action !== 'replace') throw new ProjectError('action must be read, append or replace');
        const add = String(text ?? '').trim();
        // Also for replace: an empty replace would erase the whole memory.
        if (!add) throw new ProjectError('text is required');
        const body = action === 'append' ? `${this.readMemory(projectId).replace(/\s*$/, '')}\n${add}\n`.replace(/^\n/, '') : `${add}\n`;
        if (Buffer.byteLength(body) > this.config.maxMemoryBytes) {
            throw new ProjectError(`memory would exceed ${this.config.maxMemoryBytes} bytes; summarize it with action "replace"`);
        }
        ensurePrivateDir(dirname(path));
        writeFileSync(path, body, { mode: 0o600 });
        this.log(`memory ${projectId} ${action} bytes=${statSync(path).size}`);
        return `Project memory ${action === 'append' ? 'appended' : 'replaced'} (${Buffer.byteLength(body)} bytes).`;
    }

    /**
     * A thread's report to the coordinator. The idle review finds it in the
     * thread's log, by the result text this returns.
     */
    async handback(projectId, threadId, status, summary) {
        if (!HANDBACK_STATUSES.includes(status)) throw new ProjectError(`status must be one of ${HANDBACK_STATUSES.join(', ')}`);
        const text = String(summary ?? '').trim();
        if (!text) throw new ProjectError('summary is required');
        const { t } = this.requireThread(projectId, threadId);
        // The card shows CARD_CHARS: a longer summary goes back once to be shortened, and the next one is taken as it is.
        const length = cardSummary(text, Number.MAX_SAFE_INTEGER).length;
        if (length > CARD_CHARS && !t.shorten) {
            this.store.putThread(projectId, threadId, { shorten: true });
            this.log(`handback-long ${projectId}/${threadId} chars=${length}`);
            throw new ProjectError(`summary is ${length} characters, and your card shows ${CARD_CHARS}. Call project_handback again with at most ${CARD_CHARS}: the result first, then where (paths, links), then what you need, keeping any request sent or file written outside the workspace; leave out how you got there`);
        }
        if (!this.allowHandback(projectId, threadId)) {
            throw new ProjectError(`handback limit reached (${this.config.maxHandbacksPerHour} per hour); finish the work and hand back once`);
        }
        this.store.putThread(projectId, threadId, { lastHandback: { status, summary: cardSummary(text, 500), at: new Date().toISOString() }, nudged: undefined, stalled: undefined, question: undefined, shorten: undefined });
        // With no other thread at work, the reply to this one also closes what the user asked for.
        const others = Object.entries(this.store.project(projectId).threads).filter(([id, o]) => id !== threadId && !o.resolved);
        const last = status !== 'progress' && !others.some(([, o]) => this.liveStatus(o.sessionId) !== 'idle');
        const news = status === 'progress' ? undefined : { kind: 'handback', thread: threadId, status };
        const outcome = await this.deliver(projectId, handbackMessage(threadId, t.title, status, text, { last }), t.sessionId, news);
        this.log(`handback ${projectId}/${threadId} status=${status} chars=${text.length}${length > CARD_CHARS ? ' long' : ''} ${outcome}`);
        if (outcome === 'delivered') return HANDBACK_SENT;
        return this.held(projectId) ? HANDBACK_HELD : HANDBACK_RETRY;
    }

    /**
     * A thread's question to its coordinator while it works. It counts
     * against the thread's handbacks per hour, and stays on the
     * coordinator's roster until something is sent to the thread.
     */
    async askCoordinator(projectId, threadId, question) {
        const text = String(question ?? '').trim();
        if (!text) throw new ProjectError('question is required');
        const { t } = this.requireThread(projectId, threadId);
        if (!this.allowHandback(projectId, threadId)) {
            throw new ProjectError(`limit reached (${this.config.maxHandbacksPerHour} messages to the coordinator per hour); pick a sensible default, say which, and carry on`);
        }
        this.store.putThread(projectId, threadId, { question: { text: text.slice(0, 500), at: new Date().toISOString() } });
        const outcome = await this.deliver(projectId, questionMessage(threadId, t.title, text), t.sessionId);
        this.log(`question ${projectId}/${threadId} chars=${text.length} ${outcome}`);
        if (outcome === 'delivered') return QUESTION_SENT;
        return this.held(projectId) ? QUESTION_HELD : QUESTION_RETRY;
    }
}
