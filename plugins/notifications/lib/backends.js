/**
 * dsh-plugin-notifications, the senders. One notification goes out through
 * exactly one of these:
 *
 * - desktop: DSH's own desktopRuntime (Electron main). It already does the
 *   whole job: it sends nothing while the window is focused, it flashes the
 *   taskbar on Windows and badges the dock elsewhere, and a click brings the
 *   window up. Present in the Desktop app; absent in a browser profile and
 *   a terminal DSH.
 * - browser: the plugin's own browser half in a DSH window (the Web
 *   Notifications API), for the `web` profile served to a browser. The host
 *   queues the notification and the window shows it; this module only
 *   carries the payload.
 * - cli: a command-line sender (osascript, notify-send, PowerShell toast)
 *   when no DSH window is around to show one. A clean fallback, never a
 *   second copy: it only runs when no browser half has polled recently.
 *
 * @module dsh-plugin-notifications/backends
 */
import { spawn } from 'node:child_process';

/** Collapse whitespace so a notification is one line. */
export function oneLine(text) {
    return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** DSH's own sender; the payload is {title, body} (see its notifications plugin). */
export function desktopSend(runtime, notification) {
    runtime.notifyAttention({ title: notification.title, body: notification.body });
}

/** An AppleScript string literal. */
const appleLiteral = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** A PowerShell single-quoted string literal, on one line. */
const psLiteral = (text) => `'${oneLine(text).replace(/'/g, "''")}'`;

/**
 * The command that shows one notification on this platform, or null when
 * the platform has none here. Windows takes a text toast through the
 * PowerShell WinRT projection; Linux takes notify-send; macOS takes
 * osascript. Nothing is run through a shell: every word is its own argument.
 * @param {NodeJS.Platform} platform
 */
export function cliCommand(platform, { title, body }) {
    if (platform === 'darwin') {
        return { command: 'osascript', args: ['-e', `display notification ${appleLiteral(body)} with title ${appleLiteral(title)}`] };
    }
    if (platform === 'linux') {
        return { command: 'notify-send', args: ['--app-name=DSH', title, body] };
    }
    if (platform === 'win32') {
        const script = [
            '[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]',
            `$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)`,
            `$x=$t.GetElementsByTagName('text')`,
            `[void]$x.Item(0).AppendChild($t.CreateTextNode(${psLiteral(title)}))`,
            `[void]$x.Item(1).AppendChild($t.CreateTextNode(${psLiteral(body)}))`,
            `[void][Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('DSH').Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
        ].join(';');
        return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
    }
    return null;
}

/**
 * Send one notification through the platform's command. Fire and forget:
 * a stuck child is killed after timeoutMs, a missing command is reported
 * once through onError, and neither throws into the caller.
 * @returns whether a command was started.
 */
export function cliSend(platform, notification, { spawnImpl = spawn, timeoutMs = 15000, onError = () => {} } = {}) {
    const cmd = cliCommand(platform, notification);
    if (!cmd) return false;
    try {
        const child = spawnImpl(cmd.command, cmd.args, { stdio: 'ignore' });
        const timer = setTimeout(() => child.kill(), timeoutMs);
        timer.unref?.();
        child.on('error', (error) => {
            clearTimeout(timer);
            onError(error);
        });
        child.on('close', () => clearTimeout(timer));
        return true;
    } catch (error) {
        onError(error);
        return false;
    }
}
