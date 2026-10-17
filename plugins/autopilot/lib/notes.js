/**
 * Autopilot's words: the notes it puts into a session (for the agent), and
 * the "why" line it logs with every action (for the person). Each note
 * starts with "[Autopilot]" so the agent and the person reading the chat
 * both see who wrote it.
 *
 * @module dsh-plugin-autopilot/notes
 */
import { clip } from './shared/safe.js';
import { count, spanWords, timeWords } from './shared/words.js';

const DECISION_HINT = 'If something blocks you, end your reply with one line: DECISION NEEDED: <question> — recommend: <your pick>.';

/** What is still open in a session, in a few words: "3 open todos (next: “Write the test”)". */
export function openWork(state) {
    const parts = [];
    const todos = state?.todos;
    if (todos?.open > 0) parts.push(`${count(todos.open, 'open todo')}${todos.next ? ` (next: “${clip(todos.next, 80)}”)` : ''}`);
    const goal = state?.goal;
    if (goal?.phase === 'active') parts.push(`the goal “${clip(goal.objective, 80)}”${goal.max ? ` (round ${goal.rounds} of ${goal.max})` : ''}`);
    return parts.join(' and ');
}

/** The note for a session whose turn DSH cut off when it stopped. */
export function carryOnNote(end, state, now = Date.now()) {
    const work = openWork(state);
    return [
        `[Autopilot] DSH stopped while you were working: turn ${end.turn} was cut off at ${timeWords(end.at, now)}.`,
        'Check what already finished (files, commands, todos), then carry on from where you stopped.',
        work ? `Still open: ${work}.` : '',
        DECISION_HINT,
    ].filter(Boolean).join(' ');
}

/** The note for an idle session with open todos. */
export function nudgeNote(state) {
    const todos = state?.todos ?? {};
    return [
        `[Autopilot] You stopped with ${count(todos.open ?? 0, 'open todo')}${todos.next ? ` (next: “${clip(todos.next, 100)}”)` : ''}.`,
        'Carry on with the next one, or mark the ones that are done.',
        DECISION_HINT,
    ].join(' ');
}

/** The note after a turn that failed, for a session with open work. */
export function errorNote(end, state) {
    const work = openWork(state);
    return [
        `[Autopilot] Your last turn (turn ${end.turn}) failed${end.error ? `: ${clip(end.error, 160)}` : ''}.`,
        'Carry on from where you stopped.',
        work ? `Still open: ${work}.` : '',
        'If the same error comes back, stop and end your reply with one line: DECISION NEEDED: <question> — recommend: <your pick>.',
    ].filter(Boolean).join(' ');
}

/** The note that carries a person's own answer into the session. */
export function answerNote(text) {
    return `[Autopilot] The user answered: ${text}`;
}

// ── Why lines, for the event log ─────────────────────────────────────

export function whyResume(end, now = Date.now()) {
    // DSH closes a running turn as interrupted on its next start, after a quit, a restart or a crash alike.
    const how = end.kind === 'interrupted' ? 'DSH stopped before it finished (a quit, a restart or a crash)' : 'DSH shut down under it';
    return `Turn ${end.turn} was cut off at ${timeWords(end.at, now)}: ${how}. Nobody has written in the session since.`;
}

export function whyNudge(state, idleMs) {
    return `It has been idle for ${spanWords(idleMs)} after turn ${state.end?.turn ?? state.turn} with ${count(state.todos?.open ?? 0, 'open todo')}, and its last reply asked you nothing.`;
}

export function whyRearmIdle(state, idleMs) {
    return `Its goal “${clip(state.goal?.objective, 80)}” is active but stopped (a DSH restart or an error stops a goal), and it has been idle for ${spanWords(idleMs)}.`;
}

export function whyRearmError(end, state) {
    return `Turn ${end.turn} failed${end.error ? ` (${clip(end.error, 120)})` : ''}, which stops a goal; the goal “${clip(state.goal?.objective, 80)}” was still active.`;
}

export function whyErrorNote(end, state) {
    return `Turn ${end.turn} failed${end.error ? ` (${clip(end.error, 120)})` : ''} with ${openWork(state) || 'work'} still open.`;
}

export function whyBackOff(maxNudges) {
    return `${maxNudges === 1 ? 'A note' : `${maxNudges} notes in a row`} brought no progress (no todo done, no goal round), so Autopilot leaves this session to you until you write in it or it moves on its own.`;
}

export function whyGiveUp(tries) {
    return `It failed again after ${count(tries, 'try', 'tries')}, so Autopilot stops retrying and leaves it to you.`;
}

export function whyHeld(limit) {
    return `Autopilot already sent ${limit} notes in the last hour, the most it sends; it tries again when the hour has room.`;
}

// ── Questions, for the "Ask first" rule ───────────────────────────────

export function question(plan, title) {
    const name = title ? `“${clip(title, 60)}”` : 'This session';
    switch (plan.kind) {
        case 'resume': return `${name} was cut off when DSH stopped. Tell it to carry on?`;
        case 'nudge': return `${name} stopped with ${openWork(plan.state) || 'open work'}. Tell it to carry on?`;
        case 'rearm': return `${name} has an active goal that stopped. Start the goal again?`;
        case 'error': return `${name} failed (${clip(plan.end?.error || 'an error', 80)}) with work open. Tell it to carry on?`;
        default: return `${name} may need a push. Go ahead?`;
    }
}

/** The button for doing what a plan does. */
export function actionLabel(plan) {
    return plan.action === 'rearm' ? 'Start the goal again' : 'Tell it to carry on';
}
