/**
 * Model-facing text: the coordinator and thread policies (agent-scoped system
 * prompt sections, rebuilt on every request so the roster stays live) and the
 * framing of messages that cross between sessions. Pure functions.
 *
 * @module dsh-plugin-projects/prompts
 */
import { changeTotals, changesLine } from './changes.js';

/** Messages that cross sessions start with one of these tags. */
export const TAGS = {
    brief: '[Brief from the coordinator',
    coordinator: '[From the coordinator',
    handback: '[Handback from thread',
    idle: '[Thread idle without a handback',
    approval: '[Thread waiting for approval',
    welcome: '[Project created',
};

export const HANDBACK_STATUSES = ['done', 'blocked', 'needs_decision', 'progress'];

/**
 * The Markdown link target that names a thread in a coordinator reply. DSH
 * turns a relative link into a file link of the session; the browser half
 * (client.js) claims this path and opens the thread where DSH opens the link:
 * beside the chat, or in the main view on DSH Desktop.
 */
export const THREAD_LINK_DIR = '.dsh-thread';
export const threadLink = (threadId) => `${THREAD_LINK_DIR}/${threadId}`;
/** A thread as a Markdown link, its title escaped so a bracket in it can't break the link. */
export const threadMarkdown = (threadId, title) => `[${String(title).replace(/[[\]\\]/g, '\\$&')}](${threadLink(threadId)})`;

const clip = (text, max) => {
    const s = String(text ?? '');
    return s.length > max ? `${s.slice(0, max)}…` : s;
};

/**
 * A handback's text cut for a card or a roster line: one paragraph of at
 * most `max` characters with the ellipsis, ended at a line or sentence end
 * when one falls in the second half of the room, else at a word end. Never
 * in the middle of a word or a name, which reads as something the thread
 * said. Markdown marks go; a heading ends with a colon, a list item with a
 * full stop.
 */
export function cardSummary(text, max = 300) {
    const lines = String(text ?? '').replace(/\r/g, '').split('\n')
        .map((raw) => ({
            heading: /^\s*#{1,6}\s/.test(raw),
            line: raw.replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/, '').replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim(),
        }))
        .filter(({ line }) => line);
    const flat = lines
        .map(({ heading, line }) => (lines.length === 1 || /[.!?…:;,]$/.test(line) ? line : `${line}${heading ? ':' : '.'}`))
        .join('\n');
    if (flat.length <= max) return flat.replace(/\n/g, ' ');
    const room = flat.slice(0, max - 1);
    let cut = -1;
    for (const m of room.matchAll(/[.!?…](?=\s)|\n/g)) cut = m[0] === '\n' ? m.index : m.index + 1;
    if (cut < max / 2) {
        const space = room.search(/\s\S*$/);
        cut = space > 0 ? space : max - 1;
    }
    const head = flat.slice(0, cut).replace(/[\s,;:(\[{–—-]+$/, '').replace(/\n/g, ' ');
    return /[.!?…]$/.test(head) ? `${head} …` : `${head}…`;
}

/**
 * The kinds of the user's own tools a project session leaves alone unless
 * the user's words ask for one. The first real run drifted from a test task
 * it picked itself into the user's model lanes.
 */
export const OFF_LIMITS = 'password managers and vaults, note apps, email and messaging, home or household services, control of the user\'s screen, model lanes and gateways';

const HOME_NOTE = ' (the user\'s home folder: put new files in a new subfolder, and never move or delete anything you did not create)';

/** One roster line per thread for the coordinator. */
export function rosterLines(threads, liveStatus) {
    const rows = Object.entries(threads ?? {})
        .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)));
    if (rows.length === 0) return ['(no threads yet)'];
    return rows.map(([id, t]) => {
        const status = t.resolved ? 'resolved' : liveStatus(t.sessionId);
        const last = t.lastHandback ? ` · last handback: ${t.lastHandback.status}, "${cardSummary(t.lastHandback.summary, 120)}"` : ' · no handback yet';
        const direct = t.lastDirect && !(t.lastHandback && t.lastHandback.at > t.lastDirect.at)
            ? ` · the user talked to it directly; its reply: "${cardSummary(t.lastDirect.reply, 120)}"`
            : '';
        const changed = changesLine(changeTotals(t.changes));
        // A turn that failed or stopped after the last handback is the thread's news.
        const ended = !t.resolved && t.lastEnding?.text && !(t.lastHandback && t.lastHandback.at > t.lastEnding.at)
            ? ` · ${clip(t.lastEnding.text.replace(/^The turn/, 'its last turn'), 200)}`
            : '';
        return `- ${id} · "${t.title}" · ${status}${last}${direct}${ended}${changed ? ` · ${changed}` : ''}`;
    });
}

/**
 * Coordinator policy section: ten short numbered rules, written for weaker
 * models too. Each automatic message carries its own instruction, so the
 * rules don't have to explain them. It names no model or effort: those are
 * settings, and project_settings shows them when the user asks.
 * @param {object} p - {name, goal, workspacePath, home?: the workspace is the user's home folder, guarded?: config.guardedTools names, yourTools?: 'asked'|'always', folders?: the project's other workspaces, paused, threads, memory, liveStatus}
 */
export function coordinatorPolicy(p) {
    return [
        '# Project coordinator',
        '',
        `You are the coordinator of the DSH project "${p.name}". The user talks to you here. You run their work in threads and tell them what each thread found.`,
        p.goal ? `Goal: ${p.goal}` : 'Goal: none set yet. Until the user gives one, the project is only what they ask for in this chat.',
        `Workspace: ${p.workspacePath}${p.home ? HOME_NOTE : ''}`,
        p.folders?.length ? `The project's other folders: ${p.folders.join(', ')}. A thread works in the workspace above unless project_thread_start names one of these as its folder.` : null,
        '',
        '## Rules',
        '1. Do only what the user asks. When they leave the choice of work to you, pick work that only reads and writes files in the workspace, and say what you picked.',
        `2. Never use the user's personal or infrastructure tools, yourself or in a thread: ${OFF_LIMITS}. Only the user's own words (a message, or the goal) can call for one.`,
        // Under "asked" the coordinator doesn't have them, so the rule says where such work goes.
        p.guarded?.length && p.yourTools !== 'always'
            ? `   You don't have these here: ${p.guarded.join(', ')}. When the user's words ask for work that needs one, start a thread with their words in \`ask\`; the thread gets the ones their words name.`
            : p.guarded?.length ? `   Here those include: ${p.guarded.join(', ')}.` : null,
        '3. For work, start a thread with project_thread_start, not with DSH\'s subagent or workflow tools. One thread per distinct ask; put the user\'s words in `ask`, word for word. A follow-up on a thread\'s work goes to that thread with project_thread_send.',
        `4. Name a thread to the user only as a link: [Fix the login bug](${threadLink('t3')}) for thread t3.`,
        '5. Answer yourself only what you already know: thread status, project memory, this conversation. Keep your turns short.',
        '6. Before you or a thread delete files, push, publish, send or post anything, spend money, or change settings outside the workspace, ask the user, unless their words asked for exactly that.',
        '7. Messages that start with "[" come from threads or the plugin, not the user: do what the note in them says. For "[Project created", run no tools and start no thread for it. Handbacks arrive on their own; never poll threads.',
        '8. The user may talk to a thread directly or stop it; its line under Threads then says so. A thread the user stopped stays stopped. Act on either only when the user asks you here.',
        '9. Only when the user asks: resolve a thread (project_thread_update) or change models, effort or pause (project_settings; with no arguments it shows them).',
        '10. Write to project_memory only decisions and preferences the user stated.',
        p.paused ? '11. The project is PAUSED: start no threads; handbacks wait until it resumes. Tell the user if they ask for new work.' : null,
        '',
        '## Threads',
        ...rosterLines(p.threads, p.liveStatus),
        ...memorySection(p.memory),
    ].filter((line) => line !== null).join('\n');
}

/** Under yourTools "asked": which of the user's tools a thread has, the ones the user's words for it name. */
const toolsNote = (tools) => (tools?.length ? ` You have only the ones the user's words name: ${tools.join(', ')}.` : ' You have none of them.');

/**
 * Thread policy section: the task and only the task, then one handback.
 * @param {object} p - {name, goal, threadId, title, home?: it works in the user's home folder, guarded?, yourTools?: 'asked'|'always', tools?: the guarded ones it has, memory}
 */
export function threadPolicy(p) {
    return [
        '# Project thread',
        '',
        `You are thread ${p.threadId}, "${p.title}", in the DSH project "${p.name}".`,
        p.goal ? `Project goal: ${p.goal}` : null,
        p.home ? 'You work in the user\'s home folder: put new files in a new subfolder, and never move or delete anything you did not create.' : null,
        `The project's coordinator sent your task. Its messages start with "${TAGS.brief}" or "${TAGS.coordinator}", and the user's own words follow "The user asked:". If the user writes to you here directly, their message is your task.`,
        '',
        '1. Do the task end to end, and only the task. Where a detail is unspecified, pick a sensible default, say which, and keep going.',
        `2. Do not use the user's personal or infrastructure tools (${OFF_LIMITS}) unless the user's own words ask for it. If the task needs one anyway, hand back with status blocked and say why.`,
        p.guarded?.length ? `   Here those include: ${p.guarded.join(', ')}.${p.yourTools === 'always' ? '' : toolsNote(p.tools)}` : null,
        '3. Editing files for your task is fine. Before you delete files, push, publish, send or post anything, spend money, or do anything that cannot be undone, hand back with status needs_decision, unless the user\'s words asked for exactly that.',
        '4. When you are done or stuck, call project_handback once, as your last step. Its summary is what the user reads on your card, which shows 300 characters: the result first, then where (paths, links). Only what your tools showed; mark a guess "(guess)".',
        '5. After project_handback, end your turn with one short line. Do not repeat the summary.',
        ...memorySection(p.memory),
    ].filter((line) => line !== null).join('\n');
}

function memorySection(memory) {
    if (!memory || memory.trim() === '') return [];
    return ['', '## Project memory (excerpt)', memoryExcerpt(memory)];
}

/**
 * Memory for a system prompt: all of it when short, else its start (often a
 * summary) and its end (the newest appended facts), cut at line breaks.
 */
export function memoryExcerpt(memory, max = 4000) {
    const text = String(memory ?? '').trim();
    if (text.length <= max) return text;
    const headEnd = text.lastIndexOf('\n', 1000);
    const head = text.slice(0, headEnd > 0 ? headEnd : 1000);
    const tailStart = text.indexOf('\n', text.length - (max - head.length));
    const tail = text.slice(tailStart > 0 ? tailStart + 1 : text.length - (max - head.length));
    return `${head}\n[… ${text.length - head.length - tail.length} characters left out; project_memory read shows all …]\n${tail}`;
}

/** The first message a new thread receives: the user's own words, then the coordinator's brief. */
export function briefMessage(projectName, threadId, title, brief, ask) {
    const asked = ask ? `The user asked: "${ask}"\n\n` : '';
    return `${TAGS.brief} of "${projectName}" · you are thread ${threadId}, "${title}"]\n\n${asked}${brief}`;
}

/** A later coordinator message to a thread, with the user's words when it passes on their request. */
export function coordinatorMessage(text, ask) {
    return `${TAGS.coordinator}]\n\n${ask ? `The user asked: "${ask}"\n\n` : ''}${text}`;
}

/** What the first line of the coordinator's reply to a handback carries, by its status. */
const LEAD = {
    done: 'the result in one sentence. Then at most two short lines',
    progress: 'its news in one sentence. Then at most two short lines',
    blocked: 'what it needs from the user in one sentence. Then at most two short lines',
    needs_decision: 'the decision the user must make in one sentence. Then the options, one short line each',
};

/** How the closing notes of the plugin's messages begin (old ones: "(For the user" and "(Full conversation"). */
export const NOTE_START = /\n\n\((?:The user has not seen this|For the user|Full conversation|Tell the user|If its last reply)\b[^\n]*\)\s*$/;

/**
 * An explicit handback, as the coordinator sees it. Its closing note says
 * how to answer it, where a weak model reads it: now, the thread's link
 * first, then the result. `last`: no other thread is running, so the reply
 * also closes what the user asked for.
 */
export function handbackMessage(threadId, title, status, summary, { last = false } = {}) {
    const wrap = last ? ' No other thread is running: end with one line that answers what the user asked for.' : '';
    const note = `(The user has not seen this. Reply now. First line: the link ${threadMarkdown(threadId, title)}, a colon, and ${LEAD[status] ?? LEAD.done}.${wrap} Write "the thread reports" for anything you did not check yourself. Full conversation: project_thread_read thread="${threadId}".)`;
    return `${TAGS.handback} ${threadId} · "${title}" · status: ${status}]\n\n${summary}\n\n${note}`;
}

/** A plugin message's body alone: the text between its tag line and its closing note. */
export function handbackSummary(text) {
    const s = String(text ?? '');
    const newline = s.indexOf('\n');
    return s.slice(newline < 0 ? s.length : newline).replace(NOTE_START, '').trim();
}

/**
 * The automatic note when a thread goes idle without a handback.
 * @param {string} ending - how the turn ended when it did not complete, or ''.
 */
export function idleMessage(threadId, title, lastText, ending = '') {
    const body = lastText ? `Its last reply:\n\n${clip(lastText, 1500)}` : 'It produced no reply text.';
    const link = threadMarkdown(threadId, title);
    const failed = endingStateOf(ending) === 'failed';
    const next = ending
        ? `(Tell the user in one line, starting with ${link}, that its turn ${failed ? 'failed' : 'stopped'}; its card has ${failed ? 'Retry' : 'Resume'}. Do not retry it or start a new thread unless the user asks.)`
        : `(If its last reply is a result or a question, pass it on to the user as you would a handback, starting with ${link}. If it stopped partway, send it "Finish the task and call project_handback." with project_thread_send.)`;
    return `${TAGS.idle}: ${threadId} · "${title}"]\n\n${ending ? `${ending}\n\n` : ''}${body}\n\n${next}`;
}

/**
 * An error message as a person reads it: the provider's own message when
 * DSH logged a status and a JSON body (`400: {"message": …}`), on one line,
 * clipped to 240 characters. '' when there is none.
 */
export function readableError(message) {
    let text = typeof message === 'string' ? message.trim() : '';
    const brace = text.indexOf('{');
    if (brace >= 0 && text.endsWith('}')) {
        try {
            const body = JSON.parse(text.slice(brace));
            const inner = [body?.message, body?.error?.message, body?.error, body?.detail].find((x) => typeof x === 'string' && x.trim() !== '');
            if (inner) text = inner.trim();
        } catch {}
    }
    text = text.replace(/\s+/g, ' ');
    return text.length > 240 ? `${text.slice(0, 239)}…` : text;
}

/** One line for a turn that did not complete normally, or ''. */
export function describeEnding(reason) {
    switch (reason?.kind) {
        case 'error': {
            // The provider's own words, with the HTTP status DSH logged before them (`400: {…}`).
            const message = typeof reason.error?.message === 'string' ? reason.error.message.trim() : '';
            const status = /^(\d{3}):?\s*\{/.exec(message)?.[1];
            return `The turn failed${status ? ` (HTTP ${status})` : ''}: ${clip(readableError(message) || 'unknown error', 300)}`;
        }
        case 'aborted':
            // DSH shows this one as a failure too.
            if (reason.reason?.kind === 'hook' && reason.reason.reason === 'deepseek-account/signed-out') return 'The turn failed: the user signed out of DeepSeek.';
            return 'The turn was stopped before it finished.';
        case 'max-tokens': return 'The turn hit the output token limit.';
        case 'blocked': return 'The turn was blocked.';
        case 'interrupted': return 'The turn was cut off because DSH stopped while it ran.';
        default: return '';
    }
}

/** How the roster tells a turn a person stopped (in DSH or through the session bridge), which no note reports. */
export const STOPPED_BY_USER = 'The turn was stopped by the user before it finished.';

/** Whether a describeEnding line tells of a failed or a stopped turn: 'failed', 'stopped' or undefined. */
export function endingStateOf(line) {
    const text = String(line ?? '');
    if (/^The turn (failed|was blocked)\b/.test(text)) return 'failed';
    if (/^The turn (was stopped|hit the output token limit|was cut off)\b/.test(text)) return 'stopped';
    return undefined;
}

/**
 * What a thread hears when the user retries (a failed turn) or resumes (a
 * stopped one) it from the DSH window. It comes from the coordinator, so
 * the handback goes there as usual.
 * @param {string} ending - describeEnding's line for that turn.
 */
export function continueMessage(ending, retry) {
    const why = ending ? ` ${ending.replace(/^The turn/, 'Your last turn')}${/[.!?…]$/.test(ending) ? '' : '.'}` : '';
    return `The user asked you to ${retry ? 'try again' : 'continue'}.${why} Carry on from where you left off.`;
}

/**
 * The first message a new coordinator gets. Its turn is what makes DSH list
 * the session: the sidebar hides sessions that never had a turn.
 */
export function welcomeMessage(projectName, goal) {
    const purpose = goal ? 'say what the project is for' : 'ask what the project is for, since no goal is set';
    return `${TAGS.welcome}: "${projectName}"]\n\nThis is the first message in this coordinator session. Without running any tools or starting a thread, introduce yourself in two or three short sentences: say that you run the user's work in threads and report back here, and ${purpose}.`;
}

/** The automatic note when a thread waits on a permission prompt. */
export function approvalMessage(threadId, title, sessionTitle, toolName, reason) {
    const what = `It asked to use ${toolName}${reason ? `: ${clip(reason, 300)}` : '.'}`;
    return `${TAGS.approval}: ${threadId} · "${title}"]\n\n${what}\n\nThe user approves or rejects it in the "${sessionTitle}" session.\n\n(Tell the user in one line, starting with ${threadMarkdown(threadId, title)}, what it wants to do. Do not start another thread for the same work.)`;
}
