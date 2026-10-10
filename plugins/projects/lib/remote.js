/**
 * The plugin's endpoints for its browser half. DSH's own panels reach the
 * Host through Remote namespaces its gateway serves on the window's
 * connection (`/api/<namespace>/<method>`, the same carrier in the desktop
 * app and in a browser). This module adds one more, `dsh-plugin-projects`,
 * so the Project settings dialog in lib/client.js reads and changes a
 * project's models, effort and pause the way the coordinator's
 * project_settings tool does, through the same manager methods, and its
 * access settings (the user's tools, permissions), which only it does, the
 * plugin's page lists every project with its models, a failed or stopped
 * thread runs again from its card (Retry, Resume), and the session list and
 * the Projects page make projects and arrange workspaces in categories.
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
     * for the plugin's page, and every category with its workspaces, with
     * the user's tools (guardedTools) and the permissions DSH offers.
     */
    async list() {
        try {
            // DSH's own order keeps reading in category order, so a screen reader hears the list as it is drawn.
            void this.manager.syncWorkspaceOrder();
            return { ...this.lists(), guarded: this.manager.guards().map(([name]) => name), permissions: this.manager.permissionCatalog() };
        } catch (error) {
            throw failure(error);
        }
    }

    /** What every change answers with: the projects and the categories as they are now. */
    lists() {
        return { projects: this.manager.listProjects(), categories: this.manager.listCategories() };
    }

    /**
     * A new project from the Projects page: its ◆ coordinator starts in the
     * workspace, and its threads work there.
     * @param name - its name.
     * @param workspace - the DSH workspace id it works in.
     * @returns {project: the new id, coordinator: its session id, projects, categories}.
     */
    async create(name, workspace) {
        try {
            const made = await this.manager.createProject(name, typeof workspace === 'string' ? workspace : '');
            return { project: made.id, coordinator: made.coordinator, ...this.lists() };
        } catch (error) {
            throw failure(error);
        }
    }

    /** Rename a project made on the Projects page. @returns the projects and categories. */
    async rename(project, name) {
        try {
            await this.manager.renameProject(this.manager.projectFor(project), name);
            return this.lists();
        } catch (error) {
            throw failure(error);
        }
    }

    /** Delete a project made on the Projects page whose coordinator never started. @returns the projects and categories. */
    async remove(project) {
        try {
            this.manager.deleteProject(this.manager.projectFor(project));
            return this.lists();
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Start the coordinator of a project made on the Projects page that has
     * none (it never started, or it was deleted in DSH).
     * @returns {coordinator: its session id, projects, categories}.
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
     * A new category, last in the list.
     * @param name - its name.
     * @param workspace - optional: a DSH workspace id it holds from the start.
     * @returns {category: the new id, projects, categories}.
     */
    async createCategory(name, workspace) {
        try {
            const id = await this.manager.createCategory(name, typeof workspace === 'string' && workspace !== '' ? workspace : undefined);
            return { category: id, ...this.lists() };
        } catch (error) {
            throw failure(error);
        }
    }

    /** Rename a category. @returns the projects and categories. */
    async renameCategory(category, name) {
        try {
            this.manager.renameCategory(category, name);
            return this.lists();
        } catch (error) {
            throw failure(error);
        }
    }

    /** Delete a category; its workspaces go to Other workspaces. @returns the projects and categories. */
    async removeCategory(category) {
        try {
            await this.manager.removeCategory(category);
            return this.lists();
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Move a category before another one, or (before empty) to the end.
     * @returns the projects and categories.
     */
    async moveCategory(category, before) {
        try {
            await this.manager.moveCategory(category, typeof before === 'string' ? before : null);
            return this.lists();
        } catch (error) {
            throw failure(error);
        }
    }

    /**
     * Put a DSH workspace in a category (empty for none), before another of
     * its workspaces or (before empty) after the last.
     * @returns the projects and categories.
     */
    async fileWorkspace(workspace, category, before) {
        try {
            if (typeof workspace !== 'string' || workspace === '') throw new ProjectError('workspace is required');
            await this.manager.fileWorkspace(workspace, typeof category === 'string' && category !== '' ? category : null, typeof before === 'string' ? before : null);
            return this.lists();
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
    'describe', 'list', 'update', 'continueThread', 'create', 'rename', 'remove', 'addCoordinator',
    'createCategory', 'renameCategory', 'removeCategory', 'moveCategory', 'fileWorkspace',
]);
