/**
 * Model-facing text: the coordinator and thread policies (agent-scoped system
 * prompt sections, rebuilt on every request so the roster stays live) and the
 * framing of messages that cross between sessions. Pure functions.
 *
 * @module dsh-plugin-projects/prompts
 */
import { describeRoute } from './settings.js';

/** Messages that cross sessions start with one of these tags. */
export const TAGS = {
    brief: '[Brief from the coordinator',
    coordinator: '[From the coordinator',
    handback: '[Handback from thread',
    idle: '[Thread idle without a handback',
    approval: '[Thread waiting for approval',
};

export const HANDBACK_STATUSES = ['done', 'blocked', 'needs_decision', 'progress'];

const clip = (text, max) => {
    const s = String(text ?? '');
    return s.length > max ? `${s.slice(0, max)}…` : s;
};

/** One roster line per thread for the coordinator. */
export function rosterLines(threads, liveStatus) {
    const rows = Object.entries(threads ?? {})
        .sort(([a], [b]) => Number(a.slice(1)) - Number(b.slice(1)));
    if (rows.length === 0) return ['(no threads yet)'];
    return rows.map(([id, t]) => {
        const status = t.resolved ? 'resolved' : liveStatus(t.sessionId);
        const last = t.lastHandback ? ` · last handback: ${t.lastHandback.status}, "${clip(t.lastHandback.summary, 120)}"` : ' · no handback yet';
        const direct = t.lastDirect && !(t.lastHandback && t.lastHandback.at > t.lastDirect.at)
            ? ` · the user talked to it directly; its reply: "${clip(t.lastDirect.reply, 120)}"`
            : '';
        return `- ${id} · "${t.title}" · ${status}${last}${direct}`;
    });
}

/**
 * Coordinator policy section.
 * @param {object} p - {name, goal, workspacePath, paused, threads, settings, memory, liveStatus}
 */
export function coordinatorPolicy(p) {
    const s = p.settings;
    return [
        `# Project coordinator`,
        '',
        `You are the coordinator of the DSH project "${p.name}".`,
        p.goal ? `Goal: ${p.goal}` : 'Goal: (none set)',
        `Workspace: ${p.workspacePath}`,
        '',
        '## How this project works',
        '- You talk with the user in this session. Threads are separate DSH sessions that you start for focused work. They show in the sidebar, and the user can open any thread and talk to it directly.',
        '- Keep your own turns short. When the user asks for work (a fix, a feature, research, a document), start a thread with project_thread_start instead of doing the deep work here. Answer directly only what you already know: project state, thread status, memory.',
        '- One thread per distinct ask. A follow-up about work that already has a thread goes to that thread with project_thread_send. Several unrelated asks in one message get one thread each.',
        '- Write each brief so the thread can work without this conversation: the user\'s ask in their own words, the facts it needs from project memory, and the default you picked where the ask is ambiguous. Do not add deliverables the user did not ask for.',
        '- Tell the user in one line that the thread started and what it is called.',
        `- Threads report back with handbacks. A handback arrives here as a message starting with "${TAGS.handback}". Tell the user the result in a line or two and name the thread. If the thread asks a question you can answer from what you know, answer it with project_thread_send; otherwise ask the user. When a thread is done and nothing is open, resolve it with project_thread_update.`,
        `- A message starting with "${TAGS.idle}" is automatic: the thread ended a turn you started without calling project_handback. If it says the turn failed or was stopped, tell the user. Otherwise read the thread with project_thread_read only if it matters, and nudge the thread if it stalled.`,
        `- A message starting with "${TAGS.approval}" is automatic: a thread you started is stopped on a permission prompt. Tell the user which thread and what it wants to do; they approve or reject it in that thread's session. Do not start another thread for the same work.`,
        '- The user can talk to a thread directly in its own session. Those turns do not come to you; the roster below notes them. Do not answer them here.',
        '- Record durable facts (decisions, conventions, how the user wants to work) with project_memory, so later threads and a restarted coordinator know them.',
        '- Never poll threads in a loop. Handbacks arrive on their own.',
        '',
        '## Settings',
        `- Coordinator: ${describeRoute(s.coordinatorModel.value, s.coordinatorEffort.value)}`,
        `- New threads: ${describeRoute(s.threadModel.value, s.threadEffort.value)}`,
        '- Change them with project_settings when the user asks. A thread can also get its own model or effort at start or with project_thread_update.',
        p.paused ? '- The project is PAUSED: do not start threads. Handbacks are held until it resumes. Tell the user if they ask for new work.' : null,
        '',
        '## Threads',
        ...rosterLines(p.threads, p.liveStatus),
        ...memorySection(p.memory),
    ].filter((line) => line !== null).join('\n');
}

/**
 * Thread policy section.
 * @param {object} p - {name, goal, threadId, title, memory}
 */
export function threadPolicy(p) {
    return [
        '# Project thread',
        '',
        `You are thread ${p.threadId}, "${p.title}", in the DSH project "${p.name}".`,
        p.goal ? `Project goal: ${p.goal}` : null,
        `A coordinator session started you. Its brief and later messages start with "${TAGS.brief}" or "${TAGS.coordinator}". The user may also talk to you directly in this session; their messages are the main ask when they do.`,
        '',
        '- Do the work in your brief end to end. Where the ask forks on a detail nobody specified, pick a reasonable default, say which, and keep going. Stop to ask only when the choice changes the outcome or cannot be undone.',
        '- When you finish, get blocked, or need a decision only the user can make, call project_handback once with a status and a short summary that leads with the result (what changed, where, file paths or links). That is how the coordinator and the user hear from you; your plain replies stay in this session.',
        '- Use status "progress" only for a milestone the coordinator must know before you finish.',
        '- Check project_memory before relying on assumptions about the project, and add durable facts you learn.',
        ...memorySection(p.memory),
    ].filter((line) => line !== null).join('\n');
}

function memorySection(memory) {
    if (!memory || memory.trim() === '') return [];
    return ['', '## Project memory (excerpt)', clip(memory.trim(), 4000)];
}

/** The first message a new thread receives. */
export function briefMessage(projectName, threadId, title, brief) {
    return `${TAGS.brief} of "${projectName}" · you are thread ${threadId}, "${title}"]\n\n${brief}`;
}

/** A later coordinator message to a thread. */
export function coordinatorMessage(text) {
    return `${TAGS.coordinator}]\n\n${text}`;
}

/** An explicit handback, as the coordinator sees it. */
export function handbackMessage(threadId, title, status, summary) {
    return `${TAGS.handback} ${threadId} · "${title}" · status: ${status}]\n\n${summary}\n\n(Full conversation: project_thread_read thread="${threadId}".)`;
}

/**
 * The automatic note when a thread goes idle without a handback.
 * @param {string} ending - how the turn ended when it did not complete, or ''.
 */
export function idleMessage(threadId, title, lastText, ending = '') {
    const body = lastText ? `Its last reply:\n\n${clip(lastText, 1500)}` : 'It produced no reply text.';
    return `${TAGS.idle}: ${threadId} · "${title}"]\n\n${ending ? `${ending}\n\n` : ''}${body}`;
}

/** One line for a turn that did not complete normally, or ''. */
export function describeEnding(reason) {
    switch (reason?.kind) {
        case 'error': return `The turn failed: ${clip(reason.error?.message ?? 'unknown error', 300)}`;
        case 'aborted': return 'The turn was stopped before it finished.';
        case 'max-tokens': return 'The turn hit the output token limit.';
        case 'blocked': return 'The turn was blocked.';
        case 'interrupted': return 'The turn was cut off because DSH stopped while it ran.';
        default: return '';
    }
}

/** The automatic note when a thread waits on a permission prompt. */
export function approvalMessage(threadId, title, sessionTitle, toolName, reason) {
    const what = `It asked to use ${toolName}${reason ? `: ${clip(reason, 300)}` : '.'}`;
    return `${TAGS.approval}: ${threadId} · "${title}"]\n\n${what}\n\nThe user approves or rejects it in the "${sessionTitle}" session.`;
}
