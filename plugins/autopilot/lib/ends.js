/**
 * Whether a reply's end waits on the person, so a nudge would talk over
 * them: Autopilot's own reading of a session's last reply, before it tells
 * an idle session with open todos to carry on. Measured on a corpus of
 * reply endings (test/fixtures/autopilot/endings.json, test/autopilot-ends.test.js).
 *
 * It waits on the person when the reply's last lines:
 *
 * - ask for an answer (the suite's `asksForAnswer`): a question at the end,
 *   a `DECISION NEEDED` or `BLOCKED:` line, or a plain request for the
 *   person's word ("waiting for your go", "your call", "please confirm",
 *   "should I", "do you want", "would you like");
 * - or hand the next step to the person: "let me know if you want me to
 *   go on", "tell me which one", "say the word and I'll run them", "… if
 *   you'd like", "once you confirm, I'll …", "I'll wait for your review".
 *
 * An offer that hands nothing over does not count: "happy to keep going",
 * "feel free to review the diff", "let me know if you have any questions",
 * and advice that starts "If you want a stricter check, use …". Nor does
 * any offer when the reply's last sentence says what the agent does next
 * itself ("Next: the CLI.", "Moving on to the docs.", "I will carry on with
 * the remaining todos."), unless that sentence hands over too.
 *
 * @module dsh-plugin-autopilot/ends
 */
import { asksForAnswer } from './shared/words.js';

/** How many of a reply's last non-empty lines are read, as the suite's words read them. */
const TAIL_LINES = 6;

/** Offers that hand the session's next step to the person. */
const HANDS_OVER = [
    // "Let me know if you want me to continue", "Tell me which one", "Let me know when you are ready".
    /\b(?:let me know|tell me|ping me)\b/i,
    // "Say the word and I'll run them", "If you'd rather, say so".
    /\bsay (?:the word|so)\b/i,
    // "If you'd like me to…", "If you want, I can…", "If you prefer, I'll…".
    /\bif you(?:['’]d| would)? (?:like|want|prefer)(?: me\b| us\b|,? I\b)/i,
    // "Once you confirm, I'll…", "When you've had a look, I'll…", "whenever you give the go-ahead".
    /\b(?:once|when|whenever|after|as soon as) you(?:['’]ve| have)? (?:confirm|approve|review|decide|reply|answer|choose|pick|say|give|tell|check|look|had a look)/i,
    // "If you'd prefer tabs, I can reformat it": a choice the agent offers to act on (not advice: "If you want
    // to try it, run npm start").
    /^if you(?:['’]d| would)? (?:like|want|prefer|rather)\b.*\bI(?:['’]ll| will| can| could|['’]d| would)\b/i,
    // "Pick one and I'll apply it", "Give me a thumbs up and I'll publish".
    /^(?:just )?(?:pick|choose|give|send|tell|say|confirm|approve|reply|answer|decide)\b.*\band I(?:['’]ll| will| can)\b/i,
    // "I'll wait for your review", "I'll hold off until you…", "I'll stop here".
    /\bI(?:['’]ll| will| am going to|['’]m going to) (?:wait|hold off|hold|pause|stop here)\b/i,
    // "It's up to you", "whichever you prefer".
    /\b(?:up to you|whichever you (?:prefer|like|want))\b/i,
    // "Ready for your review", "Awaiting your feedback", "When you're ready, I can deploy it".
    /\b(?:ready for your|awaiting your|(?:when|once|whenever) you(?:['’]re| are) ready)\b/i,
    // "I've paused here so you can check it".
    /\bI(?:['’]ve| have) (?:paused|stopped) here\b/i,
    // "Happy to try another colour next": an offer of more work, which waits for a yes. Not "happy to keep going"
    // (the agent goes on), nor "happy to report" or "happy to help" (words of course).
    /\bhappy to (?!(?:keep|continue|carry|proceed|move|go on|report|say|confirm|share|help|announce|note|see|hear)\b)[a-z]/i,
];

/** A closing courtesy hands nothing over: "Let me know if you have any questions." */
const COURTESY = /\b(?:any (?:other |more |further )?(?:questions?|issues?|problems?|feedback|concerns?)|anything else|(?:have|got) (?:any )?questions?|run into (?:any )?(?:issues?|problems?|trouble)|(?:anything|something) (?:is unclear|comes up|breaks|looks off|goes wrong)|need (?:anything|any help|help|more)|how (?:it|that) (?:goes|works))\b/i;

/** What keeps a sentence a hand-over beside a courtesy: it asks about the next step itself. */
const NEXT_STEP = /\b(?:me to|I should|whether|which|when you|once you|how you(?:['’]d| would)? like|what you(?:['’]d| would)? like|if you want (?:me|it|that|them)|go ahead|proceed|continue|carry on)\b/i;

/** A sentence that says what the agent does next, itself: "Next: the CLI.", "Moving on to the docs.", "I will carry on with …". */
const GOES_ON = [
    /^(?:next(?: up)?|up next|then|now|after that)\s*[:—–-]/i,
    /^(?:next|then|now|after that),? I(?:['’]ll| will| am going to|['’]m going to)\b/i,
    /^next I (?:will|['’]ll|am going to)\b/i,
    /\b(?:moving on|carrying on|continuing|proceeding|going on|turning to|starting on|getting started)\b/i,
    /\bI(?:['’]ll| will| am going to|['’]m going to|['’]m| am) (?:now |next |then |also )?(?:carry on|continue|keep going|keep at it|move on|proceed|go on|start|get (?:on|started)|work on|tackle|turn to|pick up|begin|do|write|add|fix|run|update|implement|build|create|make|finish|handle|look at|check|test|deploy|commit|push|read|wire)\b/i,
    /^(?:(?:now|next|then),? )?let me (?:now )?(?:continue|carry on|move on|check|look|run|start|read|try|fix|write|add|open|inspect|confirm|verify)\b/i,
    /^on to\b/i,
];

/** What may start a line before its words: quote marks, a bullet, a list number, a heading mark. */
const LEAD = /^[\s>*_`#-]*(?:\d{1,3}[.)]\s+)?/;

/** The last lines' sentences, each without its lead or the bold and code marks around words. */
function tailSentences(text) {
    const lines = text.trim().split('\n').map((line) => line.trim()).filter(Boolean).slice(-TAIL_LINES);
    const out = [];
    for (const line of lines) {
        const plain = line.replace(LEAD, '').replace(/\*\*|__|`+/g, '').trim();
        for (const part of plain.split(/(?<=[.!?])["'”’)\]]*\s+/)) {
            const sentence = part.replace(LEAD, '').trim();
            if (sentence) out.push(sentence);
        }
    }
    return out;
}

/** Whether one sentence hands the next step to the person. */
export function handsOver(sentence) {
    // "If you want …" after an offer ("Happy to try another colour if you'd like", "… if you want it") leaves the
    // choice to the person; at a sentence's start it is advice ("If you want a stricter check, use …"), unless it
    // asks them for the go ("If you'd like me to…", "If you want, I can…").
    const trailingIf = /\S.*?\bif you(?:['’]d| would)? (?:like|want|prefer)\b/i.test(sentence) && !/^if you/i.test(sentence);
    if (!trailingIf && !HANDS_OVER.some((pattern) => pattern.test(sentence))) return false;
    return !COURTESY.test(sentence) || NEXT_STEP.test(sentence);
}

/** Whether one sentence says what the agent does next, itself. */
export function goesOn(sentence) {
    return GOES_ON.some((pattern) => pattern.test(sentence));
}

/**
 * The sentence in a reply's last lines that hands the next step to the
 * person ("Let me know if you want me to continue."), or undefined: none
 * does, or the last sentence says what the agent does next itself.
 * @param {unknown} text - the reply's text.
 */
export function handOverIn(text) {
    if (typeof text !== 'string' || text.trim() === '') return undefined;
    const sentences = tailSentences(text);
    const last = sentences.at(-1);
    if (!last) return undefined;
    // The agent says what it does next: an offer before that leaves nothing waiting.
    if (goesOn(last) && !handsOver(last)) return undefined;
    return [...sentences].reverse().find(handsOver);
}

/**
 * Whether a reply's end waits on the person (see the module's words):
 * Autopilot leaves a session alone while its last reply does.
 * @param {unknown} text - the reply's text.
 */
export function waitsOnPerson(text) {
    if (typeof text !== 'string' || text.trim() === '') return false;
    return asksForAnswer(text) || handOverIn(text) !== undefined;
}
