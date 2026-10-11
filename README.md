# deepseek-plugins

Community plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Desktop.

Each plugin is a normal DSH plugin package. You add it to a DSH profile's bundles and set it up in the profile's `cordis.patch.yml`. Setup changes apply without a restart when the profile uses `patchReload: live`.

| Plugin | What it does |
| --- | --- |
| [`dsh-site`](plugins/dsh-site) | Serves the running DSH Desktop GUI to other devices on a private network (for example a Tailscale tailnet). Same sessions, same workspaces, same tools as the machine itself. |
| [`discord`](plugins/discord) | Connects a Discord bot to DSH sessions. Each Discord thread is one persistent agent session, and the agent answers through Discord tools. Full bot setup steps are in its README. |
| [`categories`](plugins/categories) | Categories of workspaces in DSH's session list: a header per category over its workspaces, Other workspaces for the rest, made and arranged from the list or the Categories page. |
| [`projects`](plugins/projects) | Projects. A coordinator session per project starts thread sessions for focused work, threads hand results back to it, and each project has default models and effort levels for the coordinator and for threads. |
| [`calendar`](plugins/calendar) | Your calendars, for you and your agents: iCloud, Google, Microsoft 365 and Exchange Online, Fastmail, Nextcloud and other CalDAV servers, subscribed `.ics` feeds, and calendars on this computer. Agents read them and, as their permission allows, change them. |
| [`session-bridge`](plugins/session-bridge) | A local JSON API on a Unix socket that drives the Host's own session controller. Scripts and other agents can create, prompt, steer, cancel and read DSH sessions, and you watch them live in the DSH window. |

These plugins are independent work. They are not made or endorsed by DeepSeek.

## Install a plugin

DSH loads a plugin only when the profile lists its package in `dsh.profile.bundles`. The plugin's bundle then adds the plugin's row, and you configure that row in the profile's `cordis.patch.yml`. The examples use the default desktop profile at `~/.dsh/profiles/desktop` and the `projects` plugin.

| Plugin | Package | Row id |
| --- | --- | --- |
| dsh-site | `dsh-plugin-dsh-site` | `dsh-site` |
| discord | `dsh-plugin-discord` | `discord` |
| categories | `dsh-plugin-categories` | `categories` |
| projects | `dsh-plugin-projects` | `projects` |
| calendar | `dsh-plugin-calendar` | `calendar` |
| session-bridge | `dsh-plugin-session-bridge` | `session-bridge` |

1. Clone this repository:

   ```bash
   git clone https://github.com/bertholomus/deepseek-plugins ~/.dsh-plugins/deepseek-plugins
   ```

2. Back up the two profile files:

   ```bash
   cd ~/.dsh/profiles/desktop
   ts=$(date -u +%Y%m%dT%H%M%SZ)
   cp cordis.patch.yml cordis.patch.yml.bak-$ts
   cp package.json package.json.bak-$ts
   ```

3. Add the plugin to the profile with the `dsh` command that DSH Desktop installs. The `dsh` from npm refuses to change the desktop profile.

   ```bash
   dsh plugin --profile desktop add ~/.dsh-plugins/deepseek-plugins/plugins/projects
   ```

   This links the package into the profile and adds it to `dsh.profile.bundles`. To do the same by hand, in `~/.dsh/profiles/desktop`:

   - In `package.json`, add `"dsh-plugin-projects": "link:/Users/<you>/.dsh-plugins/deepseek-plugins/plugins/projects"` to `dependencies`.
   - In the same file, add `"dsh-plugin-projects"` to the end of `dsh.profile.bundles`.
   - Link it into `node_modules`: `ln -s ~/.dsh-plugins/deepseek-plugins/plugins/projects node_modules/dsh-plugin-projects`

   Nothing else needs installing. The plugins list `@deepseek-ai/schemastery` and the DSH packages they use as `peerDependencies`, and DSH gives them its own copies. Keep them as peers in your own copy of a plugin. DSH doesn't look in the profile's `node_modules` for a linked plugin's `dependencies`, so a plugin that lists them there fails to import unless its own folder has them installed.

4. Configure the plugin in `cordis.patch.yml`. Its bundle already adds the row, so address the row by its id and give it a `config`. Each plugin README gives its config.

   ```yaml
   - id: projects
     config:
       # the plugin's settings
   ```

5. Restart DSH Desktop. A running DSH does not load new bundles. After that, changes to the row apply live when the profile uses `patchReload: live`.

A row added with `insert` while the bundle is also listed still works, because the configured row is the one that runs. The address form above avoids the duplicate row.

## Remove a plugin

1. Delete its row from `cordis.patch.yml`.
2. In `package.json`, delete the package from `dsh.profile.bundles` and its dependency.
3. Remove the `node_modules/dsh-plugin-*` symlink.
4. Restart DSH Desktop.

Or restore the backups from step 2 of the install.

## Tests

```bash
npm test                                  # dsh-site, session-bridge, projects (pure logic), the categories window, calendar
npm install --no-save @deepseek-ai/schemastery @deepseek-ai/dsh-llm@next @deepseek-ai/dsh-brand@next @deepseek-ai/dsh-tools@next
node plugins/discord/test/smoke.mjs       # discord (no token needed)
node plugins/projects/test/smoke.mjs      # projects (fake DSH host)
node plugins/categories/test/smoke.mjs    # categories (fake DSH host)

# projects + session-bridge on a real DSH, with a scripted model server
npm install --prefix /tmp/dsh @deepseek-ai/dsh
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js npm run test:e2e

# categories + session-bridge on a real DSH
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js npm run test:e2e:categories

# calendar + session-bridge on a real DSH (RADICALE_VENV, a virtualenv with radicale, adds a CalDAV account)
DSH_BIN=/tmp/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js npm run test:e2e:calendar
```

## License

MIT
