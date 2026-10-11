/**
 * The plugin's endpoints for its browser half. DSH's own panels reach the
 * Host through Remote namespaces its gateway serves on the window's
 * connection (`/api/<namespace>/<method>`, the same carrier in the desktop
 * app and in a browser). This module adds one more, `dsh-plugin-projects`,
 * so the Project settings dialog in lib/client.js reads and changes a
 * project's models, effort and pause the way the coordinator's
 * project_settings tool does, through the same manager methods, and its
 * access settings (the user's tools, permissions), which only it does, the
 * plugin's page and the Projects page list every project, a failed or
 * stopped thread runs again from its card (Retry, Resume), a project is made
 * in a workspace, renamed or removed (create, rename, remove,
 * addCoordinator), and the window hears what the user hasn't seen yet
 * (news, seeNews).
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

    /**
     * Every project with its models and access settings and their sources,
     * for the plugin's page and the Projects page, in the Projects page's
     * order, with the user's tools (guardedTools) and the permissions DSH
     * offers.
     */
    async list() {
        try {
            return { ...this.lists(), guarded: this.manager.guards().map(([name]) => name), permissions: this.manager.permissionCatalog() };
        } catch (error) {
            throw failure(error);
        }
    }

    /** What every change answers with: the projects as they are now. */
    lists() {
        return { projects: this.manager.listProjects() };
    }

    /**
     * Every coordinator and thread session the plugin knows, by session id,
     * for the session list while DSH has no value of the plugin's
     * projection for one (a session from before an update, not opened since).
     */
    async sessions() {
        try {
            return { sessions: this.manager.knownSessions() };
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * What the user hasn't seen yet, per project with a coordinator: threads
     * that handed back, finished, wait on the user's approval, or failed or
     * stopped (the ◆ row's mark and the window's notice).
     * @returns {news: [{project, name, coordinator, seq, seen, unread}]}
     */
    async news() {
        try {
            return { news: this.manager.listNews() };
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * The user opened a coordinator: its project's news up to `seq` is seen.
     * @param target - a project id, or the id of its coordinator or one of its threads.
     * @param seq - the newest news the window showed them; omitted, all of it.
     * @returns as news.
     */
    async seeNews(target, seq) {
        try {
            this.manager.seeNews(this.manager.projectFor(target), Number.isInteger(seq) ? seq : undefined);
            return { news: this.manager.listNews() };
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * A new project made in the window: its ◆ coordinator starts in the
     * workspace, and its threads work there.
     * @param name - its name.
     * @param workspace - the DSH workspace id it works in.
     * @returns {project: the new id, coordinator: its session id, projects}.
     */
    async create(name, workspace) {
        try {
            const made = await this.manager.createProject(name, typeof workspace === 'string' ? workspace : '');
            return { project: made.id, coordinator: made.coordinator, ...this.lists() };
        } catch (error) {
            throw failure(error);
        }
    }

    /** Rename a project made in the window. @returns the projects. */
    async rename(project, name) {
        try {
            await this.manager.renameProject(this.manager.projectFor(project), name);
            return this.lists();
        } catch (error) {
            throw failure(error);
        }
    }

    /** Delete a project made in the window whose coordinator never started. @returns the projects. */
    async remove(project) {
        try {
            this.manager.deleteProject(this.manager.projectFor(project));
            return this.lists();
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Start the coordinator of a project made in the window that has none
     * (it never started, or it was deleted in DSH).
     * @returns {coordinator: its session id, projects}.
     */
    async addCoordinator(project) {
        try {
            const sessionId = await this.manager.startCoordinator(this.manager.projectFor(project));
            return { coordinator: sessionId, ...this.lists() };
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
     * Change a project's settings, or one thread's model, effort or
     * permission. Values are strings; null goes back to the default.
     * `paused` is a boolean. Access settings change only here (and in the
     * profile): yourTools "asked" or "always", a permission DSH offers or
     * "default".
     * @param target - as for describe.
     * @param changes - {coordinatorModel?, coordinatorEffort?, threadModel?, threadEffort?, paused?,
     *   yourTools?, coordinatorPermission?, threadPermission?} or {thread, model?, effort?, permission?}.
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
markRemote(ProjectsRemote, [
    'describe', 'list', 'sessions', 'news', 'seeNews', 'update', 'continueThread', 'create', 'rename', 'remove', 'addCoordinator',
]);
