// Focus — host entry. Kept tiny on purpose: it loads impl.js with a fresh URL each time the plugin is
// (re)enabled, so turning the plugin off and on in Settings → Plugins picks up new host code without a restart.
import z from '@deepseek-ai/schemastery';

export const name = 'focus';
export const inject = [];

/**
 * The one setting. Any value is taken here and checked in impl.js (checkConfig), which says what is
 * wrong in words and keeps the default: a wrong value never stops DSH loading Focus.
 */
export const Config = z.object({
  dataDir: z.any().description('The folder for the timer (state.json) and the log (focus.log): a full path, starting with / or ~/. Default: focus in DSH\'s data folder.'),
});

export async function apply(ctx, config) {
  const impl = await import(new URL(`./impl.js?v=${Date.now()}`, import.meta.url).href);
  return impl.apply(ctx, config);
}
