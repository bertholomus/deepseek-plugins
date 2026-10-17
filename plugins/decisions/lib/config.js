/**
 * Decisions' config check, apart from DSH's packages so it is tested
 * anywhere: every wrong value stops the plugin with a sentence that names
 * the setting and what it takes.
 *
 * @module dsh-plugin-decisions/config
 */
import { existsSync } from 'node:fs';
import { checkCommand, checkWebhook } from './mirror.js';

/** The defaults (lib/index.js Config). */
export const DEFAULTS = Object.freeze({
    enabled: true,
    approvals: true,
    questions: true,
    replies: true,
    threads: true,
    notify: true,
    windowHours: 72,
    mirror: 'off',
    mirrorUrl: '',
    mirrorCommand: Object.freeze([]),
    mirrorPerHour: 30,
});

/** Check the config and say what is wrong in words (DSH shows this when the plugin cannot start). */
export function checkConfig(config) {
    for (const key of ['enabled', 'approvals', 'questions', 'replies', 'threads', 'notify']) {
        if (typeof config?.[key] !== 'boolean') throw new Error(`decisions: ${key} must be true or false (got ${JSON.stringify(config?.[key])})`);
    }
    const whole = (key, min, max) => {
        const value = config?.[key];
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`decisions: ${key} must be a whole number from ${min} to ${max} (got ${JSON.stringify(value)})`);
    };
    whole('windowHours', 1, 720);
    whole('mirrorPerHour', 1, 500);
    if (!['off', 'webhook', 'command'].includes(config?.mirror)) throw new Error(`decisions: mirror must be "off", "webhook" or "command" (got ${JSON.stringify(config?.mirror)})`);
    if (config.mirror === 'webhook') checkWebhook(config.mirrorUrl);
    if (config.mirror === 'command') {
        const command = checkCommand(config.mirrorCommand);
        if (!existsSync(command[0])) throw new Error(`decisions: mirrorCommand's program ${JSON.stringify(command[0])} does not exist`);
    }
}

