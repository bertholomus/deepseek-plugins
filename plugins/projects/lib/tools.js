/**
 * Model-facing project tools, registered in one agent's scope. The coordinator
 * gets the thread and settings tools, a thread gets project_handback, and both
 * get project_memory. Each tool is bound to its project (and thread) when it
 * is registered, so a call can never reach another project.
 *
 * @module dsh-plugin-projects/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { HANDBACK_STATUSES, threadLink } from './prompts.js';

/**
 * Every project tool returns its text for the model and a view for the DSH
 * window. The view becomes the result's presentation meta, which the
 * `projectSession` projection folds into thread cards and rosters
 * (projection.js); the model sees only the text.
 */
const OUTPUT = {
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            text: { type: 'string', required: true },
            view: { type: 'json' },
        },
    },
    render: (_args, value) => [{ type: 'text', text: value.text }],
    presentationMeta: (_args, value) => value.view ?? null,
};

/** Ordinary failures come back as text so the model can correct itself. */
async function guarded(run) {
    try {
        return await run();
    } catch (error) {
        return { text: `Failed: ${error?.message ?? String(error)}` };
    }
}

function tool(spec) {
    return defineTool({ output: OUTPUT, timeoutMs: 90000, ...spec, execute: (args, exec) => guarded(() => spec.execute(args, exec)) });
}

/** An optional text argument; an empty string counts as not given, as some models send one for every field. */
const given = (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value);

const MODEL_HELP = 'Model as "provider:model" or a bare model id; "default" clears it.';
const EFFORT_HELP = 'Reasoning effort the model offers (for DeepSeek: off, low, high, max); "default" clears it.';

/**
 * Build the tools for one project session.
 * @param {import('./projects.js').ProjectManager} manager
 * @param {{projectId: string, role: 'coordinator'|'thread', threadId?: string}} who
 */
export function projectTools(manager, who) {
    const { projectId, role, threadId } = who;
    /** The model's text plus the view the DSH window draws from (see projects.js view()). */
    const result = (text, details) => ({ text, view: manager.view(projectId, who, details) });
    /** A thread id as the model typed it (" t3 " is t3). */
    const id = (value) => String(value ?? '').trim();
    const shared = [
        tool({
            name: 'project_memory',
            description: 'Read or write the project\'s shared memory file. Every coordinator and thread in the project reads it. Store durable facts: decisions, conventions, how the user wants to work.',
            parameters: {
                action: { type: 'string', required: true, enum: ['read', 'append', 'replace'], description: 'read, append (add lines at the end), or replace (rewrite the whole file)' },
                text: { type: 'string', description: 'Text to append, or the full new content for replace' },
            },
            async execute(args) {
                return result(manager.memory(projectId, args.action, args.text));
            },
        }),
    ];

    if (role === 'thread') {
        return [
            ...shared,
            tool({
                name: 'project_handback',
                description: 'Report to the project coordinator. Call once when you finish, get blocked, or need a decision only the user can make. Lead the summary with the result: what changed, where (paths, links), and what you need, if anything.',
                parameters: {
                    status: { type: 'string', required: true, enum: HANDBACK_STATUSES, description: 'done, blocked, needs_decision, or progress (a milestone before you finish)' },
                    summary: { type: 'string', required: true, description: 'Short report, result first' },
                },
                async execute(args) {
                    const text = await manager.handback(projectId, threadId, args.status, args.summary);
                    return result(text, { action: { kind: 'handback', thread: threadId, status: args.status } });
                },
            }),
        ];
    }

    return [
        ...shared,
        tool({
            name: 'project_thread_start',
            description: 'Start a new thread: a separate DSH session in the project workspace that works on one ask and reports back with a handback. Use one thread per distinct ask.',
            parameters: {
                title: { type: 'string', required: true, description: 'A few plain words naming the work, in the user\'s vocabulary' },
                brief: { type: 'string', required: true, description: 'Self-contained instructions: the user\'s ask in their words, needed facts from memory, and any default you picked' },
                model: { type: 'string', description: 'Optional model for this thread only, as "provider:model" or a bare model id. Leave it out for the project\'s thread default.' },
                effort: { type: 'string', description: 'Optional effort for this thread only (for DeepSeek: off, low, high, max). Leave it out for the project\'s thread default.' },
            },
            async execute(args) {
                const r = await manager.startThread(projectId, { ...args, model: given(args.model), effort: given(args.effort) });
                const notes = r.notes?.length ? ` Note: ${r.notes.join('; ')}.` : '';
                return result(
                    `Started ${r.threadId} "${r.title}" (${r.route}). It will hand back when done.${notes} Link it in replies as [${r.title}](${threadLink(r.threadId)}).`,
                    { action: { kind: 'start', thread: r.threadId }, threads: [r.threadId] },
                );
            },
        }),
        tool({
            name: 'project_thread_send',
            description: 'Send a message to a thread. By default it is queued as the thread\'s next turn; steer=true delivers it into the running turn at the next step.',
            parameters: {
                thread: { type: 'string', required: true, description: 'Thread id, e.g. "t3"' },
                text: { type: 'string', required: true, description: 'The message' },
                steer: { type: 'boolean', description: 'Deliver into the running turn instead of queueing' },
            },
            async execute(args) {
                const text = await manager.sendToThread(projectId, args.thread, args.text, args.steer === true);
                return result(text, { action: { kind: 'send', thread: id(args.thread), ...(args.steer === true ? { status: 'steer' } : {}) }, threads: [id(args.thread)] });
            },
        }),
        tool({
            name: 'project_thread_list',
            description: 'List the project\'s threads with live status and last handback.',
            parameters: {
                include_resolved: { type: 'boolean', description: 'Also list resolved threads' },
            },
            async execute(args) {
                return result(manager.listThreads(projectId, args.include_resolved === true), { full: true });
            },
        }),
        tool({
            name: 'project_thread_read',
            description: 'Read the latest messages of a thread (user and assistant text).',
            parameters: {
                thread: { type: 'string', required: true, description: 'Thread id, e.g. "t3"' },
                count: { type: 'number', description: 'How many recent messages (default 6, max 30)' },
            },
            async execute(args) {
                return result(await manager.readThread(projectId, args.thread, args.count), { threads: [id(args.thread)] });
            },
        }),
        tool({
            name: 'project_thread_update',
            description: 'Change a thread: rename it, change its model or effort, mark it resolved or reopen it, or stop its current turn.',
            parameters: {
                thread: { type: 'string', required: true, description: 'Thread id, e.g. "t3"' },
                title: { type: 'string', description: 'New title' },
                model: { type: 'string', description: `${MODEL_HELP} "default" returns to the project's thread default.` },
                effort: { type: 'string', description: `${EFFORT_HELP} "default" returns to the project's thread default.` },
                resolved: { type: 'boolean', description: 'true to resolve, false to reopen' },
                stop: { type: 'boolean', description: 'Stop the running turn; queued messages are kept' },
            },
            async execute(args) {
                const title = given(args.title);
                const text = await manager.updateThread(projectId, args.thread, { ...args, title, model: given(args.model), effort: given(args.effort) });
                // The change a card names: the one the user most needs to see. A stop counts only if a turn was running.
                const stopped = args.stop === true && text.includes('current turn stopped');
                const status = stopped ? 'stopped' : args.resolved === true ? 'resolved' : args.resolved === false ? 'reopened' : title ? 'renamed' : null;
                return result(text, { ...(status ? { action: { kind: 'update', thread: id(args.thread), status } } : {}), threads: [id(args.thread)] });
            },
        }),
        tool({
            name: 'project_settings',
            description: 'Show or change the project settings: default model and effort for the coordinator and for new threads, and pause. Call with no arguments to show them. Use only when the user asks.',
            parameters: {
                coordinator_model: { type: 'string', description: `Coordinator model. ${MODEL_HELP}` },
                coordinator_effort: { type: 'string', description: `Coordinator effort. ${EFFORT_HELP}` },
                thread_model: { type: 'string', description: `Default model for new threads. ${MODEL_HELP}` },
                thread_effort: { type: 'string', description: `Default effort for new threads. ${EFFORT_HELP}` },
                paused: { type: 'boolean', description: 'true pauses new threads and holds handbacks; false resumes and delivers held handbacks' },
            },
            async execute(args) {
                return result(await manager.updateSettings(projectId, {
                    coordinatorModel: given(args.coordinator_model),
                    coordinatorEffort: given(args.coordinator_effort),
                    threadModel: given(args.thread_model),
                    threadEffort: given(args.thread_effort),
                    paused: args.paused,
                }));
            },
        }),
    ];
}
