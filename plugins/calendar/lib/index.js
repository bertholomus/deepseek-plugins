/**
 * dsh-plugin-calendar — the user's calendars in DSH, for the user and for
 * agents.
 *
 * Calendars come from iCloud, Fastmail, Nextcloud and other CalDAV servers,
 * Google, Microsoft 365 and Outlook.com, subscribed .ics feeds, and
 * calendars kept on this computer (lib/sources). The host half
 * (lib/manager.js) syncs them into the plugin's own store and routes every
 * change to the server that holds the event. The window (lib/client.js) has
 * a Calendar page and an agenda beside chats, styled to sit on the
 * wallpaper plugin's glass when it is on; agents get calendar_* tools
 * (lib/tools.js), and whether a chat may change calendars is decided per
 * call by its permission (lib/policy.js).
 *
 * Passwords and sign-ins are kept in DSH's credential store, never in the
 * plugin's files or log.
 *
 * @module dsh-plugin-calendar
 */
import z from '@deepseek-ai/schemastery';
import { CalendarManager } from './manager.js';
import { MODES, changeGate } from './policy.js';
import { CalendarRemote, SERVICE } from './remote.js';
import { calendarTools } from './tools.js';

export const name = 'calendar';

/** Host services the plugin uses. */
export const inject = ['tools', 'credentials'];

export const Config = z.object({
    /** Master switch. */
    enabled: z.boolean().default(true),
    /** Accounts, calendars and choices (mode 600); each calendar's events are in an events folder beside it. */
    storeFile: z.string().default('~/.dsh/calendar/calendar.json'),
    /** Action log, mode 600: ids, kinds and counts, never event text or secrets. Empty turns it off. */
    logFile: z.string().default('~/.dsh/calendar/calendar.log'),
    /** How often accounts sync, in minutes (at least 5). */
    syncMinutes: z.number().default(15),
    /** The user's time zone (IANA, like Europe/Berlin). Empty: this computer's. */
    timeZone: z.string().default(''),
    /** Agents' calendar tools. Off: chats can't see or change calendars; the window still can. */
    tools: z.boolean().default(true),
    /**
     * Whether agents may change calendars: 'preset' by the chat's permission
     * (Read Only can't, Full access can, others ask first), 'ask' always ask
     * first, 'off' never.
     */
    agentChanges: z.union(MODES).default('preset'),
    /**
     * Whether a chat's change that emails someone (an invitation, an update,
     * a cancellation, an answer) asks the user first, naming who gets what,
     * whatever agentChanges says. A chat that can't ask (Full access) is
     * refused such changes instead. Off: emailing changes follow
     * agentChanges like any other.
     */
    askBeforeEmails: z.boolean().default(true),
    /** Google sign-in: the client id of the user's own OAuth client (Desktop app). The window can set it too. */
    googleClientId: z.string().default(''),
    /** The credential (DSH's store or the environment) that holds that client's secret. */
    googleClientSecretRef: z.string().default('CALENDAR_GOOGLE_CLIENT_SECRET'),
    /** Microsoft sign-in: the application (client) id of the user's own app registration, with public client flows on. */
    microsoftClientId: z.string().default(''),
    /** Microsoft tenant: 'common' for work, school and personal accounts, or a tenant id. */
    microsoftTenant: z.string().default('common'),
    /** Test servers in place of Google's and Microsoft's (tests only). */
    googleApiBase: z.string(),
    googleAuthorizeUrl: z.string(),
    googleTokenUrl: z.string(),
    googleUserinfoUrl: z.string(),
    microsoftGraphBase: z.string(),
    microsoftLoginBase: z.string(),
});

const TEST_ENDPOINTS = ['googleApiBase', 'googleAuthorizeUrl', 'googleTokenUrl', 'googleUserinfoUrl', 'microsoftGraphBase', 'microsoftLoginBase'];

/** The credential record that holds one account's password or sign-in. */
const recordOf = (accountId) => `calendar/${accountId}`;

export function apply(ctx, config) {
    if (!config.enabled) return;

    // Each account's secret, in DSH's credential store as a record of this plugin's own.
    const secrets = {
        async get(accountId) {
            const record = await ctx.credentials.readRecord(recordOf(accountId));
            return record?.kind === 'grant' ? record.payload : undefined;
        },
        async set(accountId, payload) {
            await ctx.credentials.modifyRecord(recordOf(accountId), async () => ({ kind: 'grant', payload }));
        },
        async clear(accountId) {
            await ctx.credentials.deleteRecord(recordOf(accountId));
        },
    };

    let manager;
    /** What Google's and Microsoft's sign-ins need, read each time one starts or a token refreshes. */
    const clientSettings = async () => {
        const prefs = manager?.store.prefs ?? {};
        let googleClientSecret = '';
        try {
            googleClientSecret = (await ctx.credentials.resolve(config.googleClientSecretRef))?.value ?? '';
        } catch {
            // An unusable reference reads as not set: the window says what's missing.
        }
        const out = {
            googleClientId: String(prefs.googleClientId || config.googleClientId || '').trim(),
            googleClientSecret,
            microsoftClientId: String(prefs.microsoftClientId || config.microsoftClientId || '').trim(),
            microsoftTenant: String(prefs.microsoftTenant || config.microsoftTenant || 'common').trim(),
        };
        for (const key of TEST_ENDPOINTS) if (typeof config[key] === 'string' && config[key].trim() !== '') out[key] = config[key].trim();
        return out;
    };

    manager = new CalendarManager({ config, secrets, clientSettings, logger: ctx.logger });
    // Switched off or reloaded: this manager stops (writing what it holds), and the next start reads the files.
    ctx.effect(() => () => manager.dispose(), 'calendar.manager()');

    const setup = {
        async signInReady() {
            const s = await clientSettings();
            return {
                google: { ready: s.googleClientId !== '' && s.googleClientSecret !== '', secretSet: s.googleClientSecret !== '', ...(s.googleClientId ? { clientId: s.googleClientId } : {}) },
                microsoft: { ready: s.microsoftClientId !== '', ...(s.microsoftClientId ? { clientId: s.microsoftClientId, tenant: s.microsoftTenant } : {}) },
            };
        },
        async setGoogleSecret(secret) {
            await ctx.credentials.set(config.googleClientSecretRef, secret);
        },
    };

    // The window's endpoints (remote.js), served by DSH's own gateway.
    ctx.inject(['typertGateway'], (scope) => {
        scope.provide(SERVICE, new CalendarRemote(scope, manager, setup));
    });

    if (config.tools) {
        // Each tool is marked as the user's own (tools.js PERSONAL), so project sessions get it only as the user allows.
        for (const tool of calendarTools(manager)) ctx.tools.register(tool);
        // Changes go through the chat's permission first (policy.js).
        const service = (key) => {
            try { return ctx.get?.(key); } catch { return undefined; }
        };
        ctx.on('tools/pre-execute', changeGate({
            presets: () => service('permissionPresets'),
            approval: () => service('approval'),
            manager,
            mode: () => config.agentChanges,
            askEmails: () => config.askBeforeEmails !== false,
            log: (line) => manager.log(line),
        }));
    }

    manager.start().then(() => {
        ctx.logger?.info?.('calendar: %d calendar(s) in %d account(s)', Object.keys(manager.store.calendars).length, Object.keys(manager.store.accounts).length);
    }, (error) => {
        ctx.logger?.warn?.('calendar: startup failed: %s', error?.message ?? error);
    });
}
