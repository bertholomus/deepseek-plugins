# deepseek-plugins

Community plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) Desktop.

Each plugin is a normal DSH plugin package. It loads into the running desktop Host through the profile's `cordis.patch.yml`. With `patchReload: live`, DSH loads and unloads it without a restart.

| Plugin | What it does |
| --- | --- |
| [`dsh-site`](plugins/dsh-site) | Serves the running DSH Desktop GUI to other devices on a private network (for example a Tailscale tailnet). Same sessions, same workspaces, same tools as the machine itself. |
| [`discord`](plugins/discord) | Connects a Discord bot to DSH sessions. Each Discord thread is one persistent agent session, and the agent answers through Discord tools. Full bot setup steps are in its README. |
| [`projects`](plugins/projects) | Claude-Code-style projects. A coordinator session per project starts thread sessions for focused work, threads hand results back to it, and each project has default models and effort levels for the coordinator and for threads. |
| [`session-bridge`](plugins/session-bridge) | A local JSON API on a Unix socket that drives the Host's own session controller. Scripts and other agents can create, prompt, steer, cancel and read DSH sessions, and you watch them live in the DSH window. |

These plugins are independent work. They are not made or endorsed by DeepSeek.

## Install a plugin

The examples use the default desktop profile at `~/.dsh/profiles/desktop`.

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

3. Add the plugin as a linked dependency in `package.json`:

   ```json
   "dsh-plugin-dsh-site": "link:/Users/<you>/.dsh-plugins/deepseek-plugins/plugins/dsh-site"
   ```

4. Link it into the profile's `node_modules`:

   ```bash
   ln -s ~/.dsh-plugins/deepseek-plugins/plugins/dsh-site node_modules/dsh-plugin-dsh-site
   ```

   The plugins need `@deepseek-ai/schemastery`, which the desktop profile already has.

5. Add an `insert` row to `cordis.patch.yml`. Each plugin README gives its row.

If the profile uses `patchReload: live`, the plugin starts in a few seconds. Otherwise restart DSH Desktop.

## Remove a plugin

1. Delete its row from `cordis.patch.yml`.
2. Delete its dependency from `package.json`.
3. Remove the `node_modules/dsh-plugin-*` symlink.

Or restore the backups from step 2.

## Tests

```bash
npm test                                  # dsh-site, session-bridge, projects (pure logic)
npm install --no-save @deepseek-ai/schemastery @deepseek-ai/dsh-llm@next @deepseek-ai/dsh-brand@next @deepseek-ai/dsh-tools@next
node plugins/discord/test/smoke.mjs       # discord (no token needed)
node plugins/projects/test/smoke.mjs      # projects (fake DSH host)
```

## License

MIT
