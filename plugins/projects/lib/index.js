/**
 * dsh-plugin-projects — Claude-Code-style projects for DSH Desktop.
 *
 * Each project in the plugin config gets one coordinator session in its
 * workspace. The coordinator starts thread sessions for focused work with
 * project tools; threads report back with project_handback, and the handback
 * arrives in the coordinator as its next turn. Every session is an ordinary
 * DSH session made through the Host's sessionController, so the user watches
 * and talks to the coordinator and every thread in the DSH window.
 *
 * Settings mirror Claude Code's project page: coordinator model and effort,
 * thread model and effort (plugin-wide defaults, per-project config, and
 * runtime changes through the coordinator), plus pause.
 *
 * @module dsh-plugin-projects
 */
import z from '@deepseek-ai/schemastery';
import { ProjectManager } from './projects.js';
import { projectTools } from './tools.js';

export const name = 'projects';

/** Host services the plugin drives. */
export const inject = ['sessionController', 'workspaceRegistry', 'agents', 'tools', 'systemPrompt'];

const Project = z.object({
    /** Stable id (lower-kebab). Defaults to the name, slugified. Changing it orphans the project's state. */
    id: z.string(),
    /** Display name; also the coordinator session title. */
    name: z.string().required(),
    /** The outcome the coordinator works toward. */
    goal: z.string().default(''),
    /** Workspace folder for the coordinator and every thread. */
    workspacePath: z.string().required(),
    /** Agent preset for new project sessions; empty uses the DSH default. */
    agentPreset: z.string(),
    /** Coordinator model ("provider:model" or bare id); empty uses the plugin default. */
    coordinatorModel: z.string(),
    /** Coordinator reasoning effort; empty uses the plugin default. */
    coordinatorEffort: z.string(),
    /** Default model for new threads; empty uses the plugin default. */
    threadModel: z.string(),
    /** Default effort for new threads; empty uses the plugin default. */
    threadEffort: z.string(),
    /** Block new threads and hold handbacks. The coordinator's project_settings can override it. */
    paused: z.boolean().default(false),
    /** Project memory file; defaults to <memoryDir>/<id>.md. */
    memoryFile: z.string(),
});

export const Config = z.object({
    /** Master switch. */
    enabled: z.boolean().default(true),
    /** Projects, one coordinator each. */
    projects: z.array(Project).default([]),
    /** Plugin-wide default coordinator model; empty uses the DSH default model. */
    coordinatorModel: z.string(),
    /** Plugin-wide default coordinator effort; empty uses the model's default. */
    coordinatorEffort: z.string(),
    /** Plugin-wide default model for new threads. */
    threadModel: z.string(),
    /** Plugin-wide default effort for new threads. */
    threadEffort: z.string(),
    /** "idle": when a thread ends a turn the coordinator started without a handback, tell the coordinator. "off": only explicit handbacks. */
    autoHandback: z.union(['idle', 'off']).default('idle'),
    /** Handbacks (explicit plus automatic) one thread may send per hour; stops runaway loops. */
    maxHandbacksPerHour: z.number().default(30),
    /** Seconds a thread started by the coordinator may wait on a permission prompt before the coordinator is told. 0 turns it off. */
    approvalNoticeSeconds: z.number().default(60),
    /** Durable project state. */
    storeFile: z.string().default('~/.dsh/projects/projects.json'),
    /** Folder for project memory files. */
    memoryDir: z.string().default('~/.dsh/projects/memory'),
    /** Largest memory file the tools will write. */
    maxMemoryBytes: z.number().default(65536),
    /** Action log, mode 600, never prompt text. Empty turns it off. */
    logFile: z.string().default('~/.dsh/projects/projects.log'),
});

export function apply(ctx, config) {
    if (!config.enabled) return;
    for (const key of ['maxHandbacksPerHour', 'maxMemoryBytes']) {
        if (!Number.isInteger(config[key]) || config[key] < 1) throw new Error(`projects: ${key} must be a positive integer`);
    }
    if (!(config.approvalNoticeSeconds >= 0)) throw new Error('projects: approvalNoticeSeconds must be 0 or more');
    const manager = new ProjectManager({ ctx, config, buildTools: projectTools });

    ctx.on('agent/created', ({ agent }) => {
        manager.maybeInstall(agent);
    });
    ctx.on('agent/disposed', ({ agent }) => {
        manager.forget(agent);
    });
    ctx.effect(() => () => manager.dispose(), 'projects.scopes()');

    // Coordinators are created after composition settles; failures are logged, never thrown.
    manager.start().then(() => {
        ctx.logger.info('projects: %d project(s) ready', manager.projects.size);
    }, (error) => {
        ctx.logger.warn('projects: startup failed: %s', error?.message ?? error);
    });
}
