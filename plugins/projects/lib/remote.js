/**
 * The plugin's endpoints for its browser half. DSH's own panels reach the
 * Host through Remote namespaces its gateway serves on the window's
 * connection (`/api/<namespace>/<method>`, the same carrier in the desktop
 * app and in a browser). This module adds one more, `dsh-plugin-projects`,
 * so the Project settings dialog in lib/client.js reads and changes a
 * project's models, effort and pause the way the coordinator's
 * project_settings tool does, through the same manager methods, the
 * plugin's page lists every project with its models, a failed or stopped
 * thread runs again from its card (Retry, Resume), and the Projects page
 * makes projects, moves workspaces between them and adds coordinators.
 *
 * The gateway finds a Remote service by its `typertRemote` binding and the
 * method markers on its prototype; DSH's own services get both from
 * TypeScript decorators, applied here by hand. Parameters are plain names,
 * since the gateway reads them from the method source.
 *
 * @module dsh-plugin-projects/remote
 */
import { Remote, RemoteError, bindTypertRemote } from '@deepseek-ai/dsh-typert-protocol';
import { ProjectError } from './projects.js';

/** Wire namespace: the client calls `/api/dsh-plugin-projects/<method>`. */
export const NAMESPACE = 'dsh-plugin-projects';
/** Cordis service key the gateway looks the service up by. */
export const SERVICE = 'dshPluginProjectsRemote';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A plugin error the user can act on, as a Remote failure the dialog shows. */
function failure(error) {
    if (error instanceof ProjectError) return new RemoteError('projects/refused', error.message, {});
    return error;
}

export class ProjectsRemote {
    /**
     * @param {object} ctx - the plugin's context (the binding reads it).
     * @param {object} manager - the ProjectManager.
     */
    constructor(ctx, manager) {
        this.ctx = ctx;
        this.manager = manager;
        this.typertRemote = bindTypertRemote(this, SERVICE, { namespace: NAMESPACE });
    }

    /**
     * A project's settings and threads, as the dialog shows them.
     * @param target - a project id, or the id of its coordinator or one of its threads.
     */
    async describe(target) {
        try {
            return await this.manager.describeProject(this.manager.projectFor(target));
        } catch (error) {
            throw failure(error);
        }
    }

    /** Every project with its models and their sources, for the plugin's page. */
    async list() {
        try {
            return { projects: this.manager.listProjects() };
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * A new project from the Projects page, without a coordinator.
     * @param name - its name.
     * @param workspace - optional: a DSH workspace id it holds from the start.
     * @returns {project: the new id, projects: every project as list returns them}.
     */
    async create(name, workspace) {
        try {
            const id = this.manager.createProject(name, typeof workspace === 'string' && workspace !== '' ? workspace : undefined);
            return { project: id, projects: this.manager.listProjects() };
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Put a DSH workspace in a project, or (project null) in none.
     * @returns every project as list returns them.
     */
    async move(workspace, project) {
        try {
            if (typeof workspace !== 'string' || workspace === '') throw new ProjectError('workspace is required');
            this.manager.moveWorkspace(workspace, typeof project === 'string' && project !== '' ? this.manager.projectFor(project) : null);
            return { projects: this.manager.listProjects() };
        } catch (error) {
            throw failure(error);
        }
    }

    /** Rename a project made on the Projects page or imported. @returns every project. */
    async rename(project, name) {
        try {
            await this.manager.renameProject(this.manager.projectFor(project), name);
            return { projects: this.manager.listProjects() };
        } catch (error) {
            throw failure(error);
        }
    }

    /** Delete a project made on the Projects page or imported, without a coordinator. @returns every project. */
    async remove(project) {
        try {
            this.manager.deleteProject(this.manager.projectFor(project));
            return { projects: this.manager.listProjects() };
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Add a coordinator to a project made on the Projects page or imported.
     * @param workspace - optional: which of its workspaces it works in.
     * @returns {coordinator: its session id, projects: every project}.
     */
    async addCoordinator(project, workspace) {
        try {
            const sessionId = await this.manager.startCoordinator(this.manager.projectFor(project), typeof workspace === 'string' && workspace !== '' ? workspace : undefined);
            return { coordinator: sessionId, projects: this.manager.listProjects() };
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Run a thread again after its last turn failed (Retry) or stopped (Resume).
     * @param target - as for describe.
     * @param thread - the thread's id (t3).
     * @returns the project as describe returns it.
     */
    async continueThread(target, thread) {
        try {
            if (typeof thread !== 'string' || thread === '') throw new ProjectError('thread is required');
            return await this.manager.continueThread(this.manager.projectFor(target), thread);
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Change a project's settings, or one thread's model and effort. Values
     * are strings; null goes back to the default. `paused` is a boolean.
     * @param target - as for describe.
     * @param changes - {coordinatorModel?, coordinatorEffort?, threadModel?, threadEffort?, paused?}
     *   or {thread, model?, effort?}.
     * @returns the project as describe returns it, with `notes` from the change.
     */
    async update(target, changes) {
        try {
            if (!isObject(changes)) throw new ProjectError('changes must be an object');
            return await this.manager.changeFromWindow(this.manager.projectFor(target), changes);
        } catch (error) {
            throw failure(error);
        }
    }
}

/** Mark methods the way the `@Remote` decorator does in DSH's TypeScript. */
function markRemote(Class, names) {
    for (const name of names) {
        Remote(Class.prototype[name], {
            kind: 'method', name, static: false, private: false,
            addInitializer(init) { init.call(Object.create(Class.prototype)); },
        });
    }
}
markRemote(ProjectsRemote, ['describe', 'list', 'update', 'continueThread', 'create', 'move', 'rename', 'remove', 'addCoordinator']);
