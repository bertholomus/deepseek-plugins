# Calendar

Your calendars in DSH, for you and for your agents: iCloud, Google, Microsoft 365, Outlook.com and Exchange Online, Fastmail, Nextcloud, Yahoo, mailbox.org, Zoho and any other CalDAV server, subscribed `.ics` feeds, and calendars kept on this computer. The plugin syncs them into a store of its own and sends every change to the server that holds the event, so your phone and your other apps see it too.

> **Status.** This version is the host half: the accounts, the sync, the store, the agents' tools and their write rules, and the endpoints the window uses. The window (a Calendar page, the account dialog and an agenda beside chats, drawn on the wallpaper plugin's glass when it is on) comes next. Until then, a new DSH has the **Personal** calendar on this computer, and agents can read and change it.

## Accounts

| Service | How it connects | What you give it |
| --- | --- | --- |
| iCloud | CalDAV, `caldav.icloud.com` | Your Apple Account email and an **app-specific password** (account.apple.com → Sign-In and Security → App-Specific Passwords; it needs two-factor authentication). Not your Apple Account password. |
| Fastmail | CalDAV, `caldav.fastmail.com` | Your full email address and an app password with calendar access (Settings → Privacy & Security → Manage app passwords and access). |
| Nextcloud | CalDAV, at your server's `/remote.php/dav` | Your Nextcloud's address, user name and an app password (Settings → Security → Devices & sessions). |
| Yahoo | CalDAV, `caldav.calendar.yahoo.com` | Your email address and an app password (Account Security → Create app password). |
| mailbox.org, Zoho Calendar | CalDAV | Your address and password, or an application password with two-factor authentication. Zoho accounts in another data center use its domain (`calendar.zoho.eu`). |
| Any other CalDAV server | CalDAV from any address you give: the server, `/.well-known/caldav`, your principal or one calendar | User name and password. |
| Google Calendar | Google Calendar API, signing in in your browser | Once: an OAuth client of your own (see [Google](#google)). |
| Microsoft 365, Outlook.com, Exchange Online | Microsoft Graph, signing in with a code | Once: an app registration of your own (see [Microsoft](#microsoft)). |
| A subscribed calendar | An `https://` or `webcal://` address of an `.ics` file (holidays, a team's published calendar, sports fixtures, a booking site) | Nothing else. It is read only, and fetched again only when the server says it changed. |
| On this computer | The plugin's own store | Nothing. **Personal** is made at the first start; you can add more. |

Passwords and sign-ins are kept in DSH's credential store, never in the plugin's files or its log, and a password goes only to the site its account names (iCloud's own `pNN-caldav.icloud.com` hosts included). Removing an account removes its password or sign-in and its copies of the events; nothing on the server changes.

Not reached yet: calendars that live only in the Mac's Calendar app (*On My Mac*, which needs Apple's EventKit on the Mac), and an Exchange server of your own outside Exchange Online (its published `.ics` address can be subscribed).

### Google

Google lets an app read your calendar only through an OAuth client that someone registered, and the plugin ships none, so no shared secret sits in this repository. You make your own once:

1. In [Google Cloud console](https://console.cloud.google.com/), pick or make a project and enable the **Google Calendar API** (APIs & Services → Library).
2. Set up its OAuth consent screen (Google Auth Platform): user type **External**, your address as a test user. Set the app to **In production**: in *Testing*, Google ends every sign-in after 7 days. Google then shows its "unverified app" screen at sign-in, which is expected for a client only you use.
3. Make a client of type **Desktop app** and copy its client id (it ends in `.apps.googleusercontent.com`) and its secret.
4. Give both to the plugin. The id goes in the plugin's store (or `googleClientId` in its config); the secret goes in DSH's credential store as `CALENDAR_GOOGLE_CLIENT_SECRET` (or the name `googleClientSecretRef` gives).

Signing in opens Google in your browser and comes back to this computer on `127.0.0.1` (with PKCE). When the browser runs on another device, the page it ends on doesn't load; its address finishes the sign-in when you paste it. The plugin asks for your calendars (`calendar`), and `openid email` to know which address signed in.

### Microsoft

Microsoft's sign-in needs an app registration of your own:

1. In [Microsoft Entra admin center](https://entra.microsoft.com/) → App registrations → New registration. For any account, choose *Accounts in any organizational directory and personal Microsoft accounts*; for one work account, your organization only (then give its tenant id).
2. Under Authentication, turn **Allow public client flows** on. It needs no redirect address and no secret.
3. The plugin asks for `Calendars.ReadWrite`, `User.Read` and `offline_access`; a work tenant may need an admin to consent to them.
4. Give the plugin its **Application (client) ID** (or `microsoftClientId` in its config) and the tenant (`common` by default).

Signing in shows a short code and Microsoft's page (`microsoft.com/devicelogin`): type the code there, on any device. Microsoft emails guests as soon as an event with guests is saved, and you can't hold that back, so a change that would invite or tell guests is made only when it says to tell them, and is otherwise refused with the reason.

## For agents

Chats get these tools (`tools: false` hides them all):

| Tool | What it does |
| --- | --- |
| `calendar_list_calendars` | The calendars, with their ids, which can be written, and the default. |
| `calendar_events` | What's on between two times (the next 7 days unless told), each with its id. |
| `calendar_search` | Events with every word asked for. |
| `calendar_get_event` | Everything about one event: time and zone, repeat rule, guests and their answers, reminders, notes, links. |
| `calendar_free_time` | Free slots of a given length within working hours (Monday to Friday, 09:00 to 17:00 unless told). |
| `calendar_create_event` | Adds an event, to the default calendar unless told. |
| `calendar_update_event` | Changes an event: its title, time, place, notes, repeat rule, reminders, guests, or calendar (a move). `clear` empties a field; an empty string changes nothing. |
| `calendar_delete_event` | Deletes an event. |
| `calendar_respond` | Answers an invitation: accepted, declined or tentative. The organizer is told. |

Times go in and come out in your time zone (`timeZone`, else this computer's), and an event kept in another zone shows its own clock too. A change to a repeating event needs to say which: this occurrence, this and the following ones, or the whole series; without it the tool tells the model to ask you. Guests get an email only when the call says to tell them, which the tools say only your words should ask for.

### Which chats may change your calendars

Reading is always allowed while the tools are on. Changes (adding, changing, deleting and answering) follow `agentChanges`:

- **`preset`** (the default) goes by the chat's DSH permission. On **Read Only** a change is refused, and the model is told why and that you can make it yourself. On **Workspace Write**, or a custom mix, DSH's approval prompt asks you first and says what would change: *Delete “Haircut” (2026-10-16 17:00, Personal)?* On **Full access** changes go through without asking, and on **Auto** its reviewer decides.
- **`ask`**: every change asks you first. A chat that never asks (Full access) is refused instead.
- **`off`**: no chat changes your calendars.

The log notes each decision (`policy calendar_delete_event access=workspace-write ask`), never the event.

A calendar is personal. With the projects plugin, a project's threads get your personal tools only when your words ask for them, and coordinators never do: list `calendar` in its `guardedTools` (the name covers every `calendar_*` tool) to hold your calendar back from projects the same way. A thread then gets it when your words for it say *calendar* (or a word you list for it).

```yaml
- id: projects
  config:
    guardedTools:
      calendar: [agenda, my schedule]
```

## Sync

Each account syncs at the start and then every `syncMinutes` (15 by default). CalDAV accounts ask for what changed (sync-collection) where the server has it, and otherwise compare each event's tag; Google uses its sync tokens; Microsoft keeps three months back and thirteen ahead and asks only for what changed; a subscription is fetched again when its server says it changed. A change goes to the server first, and only if the server took it is it kept here; if the event changed there meanwhile, the plugin syncs and tries once more. Events repeat by their rules (every week, the last Friday of the month, until a date or a count), with the occurrences someone moved or cancelled.

## Settings

The plugin needs no config. Its row in `cordis.patch.yml`:

```yaml
- id: calendar
  config:
    timeZone: Europe/Berlin
```

| Setting | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | Off: the plugin does nothing. |
| `timeZone` | `''` | Your time zone (IANA, like `Europe/Berlin`); empty uses this computer's. |
| `syncMinutes` | `15` | How often accounts sync, in minutes (at least 5). |
| `tools` | `true` | The agents' tools. Off: chats can't see or change your calendars. |
| `agentChanges` | `preset` | Which chats may change calendars: `preset`, `ask` or `off` (above). |
| `googleClientId` | `''` | Your Google OAuth client's id (the window can set it too). |
| `googleClientSecretRef` | `CALENDAR_GOOGLE_CLIENT_SECRET` | The DSH credential that holds that client's secret. |
| `microsoftClientId` | `''` | Your Microsoft app registration's client id (the window can set it too). |
| `microsoftTenant` | `common` | The Microsoft tenant: `common`, `organizations`, `consumers` or a tenant id. |
| `storeFile` | `~/.dsh/calendar/calendar.json` | Accounts, calendars and choices. |
| `logFile` | `~/.dsh/calendar/calendar.log` | The log; empty turns it off. |

## Where things are kept

- `~/.dsh/calendar/` (in `$DSH_HOME` when DSH runs with one), mode 700: `calendar.json` with the accounts, calendars, your choices and the sync state; `events/<calendar>.json` with each calendar's events (for CalDAV and local calendars, the iCalendar text too); and `calendar.log` with ids, kinds and counts, never event text, passwords, tokens or addresses with their queries. Each file is mode 600.
- DSH's credential store: one record per account, `calendar/<account id>`, with its password or its sign-in, and your Google client's secret.

## Setup

1. Install the plugin as in the [root README](../../README.md#install-a-plugin):

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/calendar
   ```

   That adds `dsh-plugin-calendar` to the profile's `package.json` (`dependencies` and `dsh.profile.bundles`). The plugin's bundle adds its row (`id: calendar`).

2. Restart DSH Desktop once so it loads the new bundle.

## Known limits

- Microsoft: a change made here and one made elsewhere at the same time aren't caught (the last one wins); an event's status, link, conference, extra dates and skipped dates aren't written to Microsoft, and only the first reminder is.
- Moving or importing an event into a Google or Microsoft calendar leaves its guests behind unless the move says to tell them, so no one is emailed by surprise.
- Moving a repeating event to another calendar moves the series as it is defined, without the occurrences that were moved or changed on their own.

## Tests

```bash
node --test plugins/calendar/test/*.test.mjs      # store, repeats, zones, CalDAV, Google and Microsoft (stand-ins), write rules

# also against a real CalDAV server: a Python virtualenv with radicale installed
RADICALE_VENV=/path/to/venv node --test plugins/calendar/test/*.test.mjs

# on a real DSH, with a scripted model server (Read Only, Workspace Write and Full access chats)
npm install --prefix /tmp/dsh @deepseek-ai/dsh
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js RADICALE_VENV=/path/to/venv node plugins/calendar/test/e2e/run.mjs
```

No test uses a real account: Google and Microsoft are stand-in servers (`test/standins`), and CalDAV runs against answers shaped like iCloud's, Fastmail's and Nextcloud's (`test/fixtures`), a stand-in server and, when it is installed, a real Radicale server.
