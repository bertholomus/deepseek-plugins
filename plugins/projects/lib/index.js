/**
 * dsh-plugin-projects — projects for DSH Desktop.
 *
 * Each project in the plugin config gets one coordinator session in its
 * workspace. The coordinator starts thread sessions for focused work with
 * project tools; threads report back with project_handback, and the handback
 * arrives in the coordinator as its next turn. Every session is an ordinary
 * DSH session made through the Host's sessionController, so the user watches
 * and talks to the coordinator and every thread in the DSH window.
 *
 * Settings: coordinator model and effort, thread model and effort, plus
 * pause. Each project sets its own in
 * its Project settings dialog (lib/client.js, through remote.js), by picking
 * a model in its coordinator's DSH model picker, or through the coordinator;
 * projects that set none use the plugin-wide defaults. Those are live config,
 * so the form on the plugin's page in DSH changes them without a restart.
 * Access settings work the same way, except that only the user changes
 * them: whether project sessions have the user's own tools, and the DSH
 * permission preset of the coordinator and of new threads.
 *
 * @module dsh-plugin-projects
 */
import z from '@deepseek-ai/schemastery';
import { ProjectManager } from './projects.js';
import { projectTools } from './tools.js';
import { projectSessionProjection } from './projection.js';
import { ProjectsRemote, SERVICE } from './remote.js';

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
    /** "asked" or "always": who in this project may use the user's own tools (guardedTools); empty uses the plugin default. */
    yourTools: z.string(),
    /** The coordinator's DSH permission preset, or "default" for DSH's default; empty uses the plugin default. */
    coordinatorPermission: z.string(),
    /** The DSH permission preset new threads start on, or "default"; empty uses the plugin default. */
    threadPermission: z.string(),
    /** Block new threads and hold handbacks. The coordinator's project_settings can override it. */
    paused: z.boolean().default(false),
    /** Project memory file; defaults to <memoryDir>/<id>.md. */
    memoryFile: z.string(),
});

/**
 * A setting DSH's settings page may change while the plugin runs. The plugin
 * reads it through pluginDefaults(); a schemastery without volatile fields
 * keeps it ordinary config.
 */
const live = (schema) => (typeof schema.volatile === 'function' ? schema.volatile() : schema);

export const Config = z.object({
    /** Master switch. */
    enabled: z.boolean().default(true),
    /** Projects, one coordinator each. */
    projects: z.array(Project).default([]),
    /** Plugin-wide default coordinator model; empty uses the DSH default model. */
    coordinatorModel: live(z.string()),
    /** Plugin-wide default coordinator effort; empty uses the model's default. */
    coordinatorEffort: live(z.string()),
    /** Plugin-wide default model for new threads. */
    threadModel: live(z.string()),
    /** Plugin-wide default effort for new threads. */
    threadEffort: live(z.string()),
    /**
     * Who may use the user's own tools (guardedTools) in projects. "asked"
     * (the default): no coordinator has them, and a thread has only the
     * ones the user's own words for it name. "always": every project
     * session has them, and only the prompts' rule and the thread checks
     * stand between them and the model.
     */
    yourTools: live(z.string()),
    /** Plugin-wide coordinator permission: a DSH permission preset (read-only, workspace-write, danger-full-access), or "default" for DSH's default for new sessions. Empty means read-only: the coordinator reads, its threads change files, and what would need approval is refused without asking. */
    coordinatorPermission: live(z.string()),
    /** Plugin-wide permission new threads start on: a DSH permission preset, or "default" for DSH's default. Empty means workspace-write. */
    threadPermission: live(z.string()),
    /** "idle": when a thread ends a turn the coordinator started without a handback, tell the coordinator. "off": only explicit handbacks. */
    autoHandback: z.union(['idle', 'off']).default('idle'),
    /** Handbacks (explicit plus automatic) one thread may send per hour; stops runaway loops. */
    maxHandbacksPerHour: z.number().default(30),
    /** New threads one project may start per hour; stops a coordinator stuck starting threads in a loop. */
    maxThreadsPerHour: z.number().default(20),
    /** Seconds a thread started by the coordinator may wait on a permission prompt before the coordinator is told. 0 turns it off. */
    approvalNoticeSeconds: z.number().default(60),
    /** A new coordinator introduces itself in a first turn. DSH lists a session only after its first turn, so without it the coordinator stays out of the sidebar until someone messages it. */
    welcome: z.boolean().default(true),
    /** Durable project state. */
    storeFile: z.string().default('~/.dsh/projects/projects.json'),
    /** Folder for project memory files. */
    memoryDir: z.string().default('~/.dsh/projects/memory'),
    /** Largest memory file the tools will write. */
    maxMemoryBytes: z.number().default(65536),
    /**
     * The user's personal and infrastructure tools (MCP server or tool
     * names) that project sessions use only when the user's own words ask
     * for them: a list, or a map from each name to the words the user may
     * call it by, e.g. { "lane-catalog": ["lanes", "model lanes"] }. The
     * prompts name them, a thread start or message that names one is
     * refused unless the user's words or the project's goal name it, and
     * under yourTools "asked" sessions don't have them at all. Live, so an
     * edit doesn't restart the plugin.
     */
    guardedTools: live(z.union([z.array(z.string()), z.dict(z.array(z.string()))]).default([])),
    /** Action log, mode 600, never prompt text. Empty turns it off. */
    logFile: z.string().default('~/.dsh/projects/projects.log'),
});

export function apply(ctx, config) {
    if (!config.enabled) return;
    for (const key of ['maxHandbacksPerHour', 'maxThreadsPerHour', 'maxMemoryBytes']) {
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
    // A chat a coordinator messaged (project_message) went idle: its answer goes back to that coordinator once.
    ctx.on('agent/status', ({ agent, status }) => {
        manager.onAgentStatus(agent, status);
    });
    // The defaults form saved: only the live fields changed, so the plugin keeps running.
    ctx.on('loader/volatile-update', () => {
        void manager.onDefaultsChanged();
    });
    // An MCP server connected, reconnected or changed its tools: the user's tools stay out of the sessions that may not use them.
    ctx.on('tools/change', () => {
        manager.onToolsChanged();
    });
    ctx.effect(() => () => manager.dispose(), 'projects.scopes()');
    // What the DSH window draws for project sessions: roles, rosters and thread
    // cards (lib/projection.js). Optional, so a Host without projections still runs projects.
    ctx.inject(['sessionProjections'], (scope) => {
        scope.sessionProjections.register(projectSessionProjection((sessionId) => manager.seedView(sessionId)));
    });

    // The Project settings dialog's endpoints (remote.js), served by DSH's own
    // gateway. Optional too: without them the dialog says it can't reach the plugin.
    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new ProjectsRemote(scope, manager));
    });

    // Coordinators are created after composition settles; failures are logged, never thrown.
    manager.start().then(() => {
        ctx.logger.info('projects: %d project(s) ready', manager.projects.size);
    }, (error) => {
        ctx.logger.warn('projects: startup failed: %s', error?.message ?? error);
    });
}
