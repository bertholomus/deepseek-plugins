# Wallpaper

Wallpaper and glass for DeepSeek Harness Desktop. It only changes how DSH looks: the wallpaper, colours, frosted
glass, motion and the headline. It adds one button and one panel, and nothing else. It never hides or rearranges
DSH's controls and never touches another plugin's UI or files.

## What it does

- **Wallpaper.** Full-bleed pictures with a 1.1 s crossfade. Collections are the folders in the plugin's
  `wallpapers/` folder; nothing else is ever shown as wallpaper, so screenshots never are. Add pictures (Add images,
  or drop them on the grid; big photos are scaled to 3840 px), move one to the macOS Trash, make or rename a collection.
- **Colours like macOS.** Ten presets with a light and a dark tone, your own colours from the **+** picker, a Gradient
  switch, and Both / Light / Dark to set the two modes separately.
- **Rotation.** Every 1, 5, 15 or 30 min, or 1, 2, 4, 8, 12 or 24 h, through the pictures of the collection or
  through the colours. **Off · keep this one** stops on what shows now; clicking a picture pins it.
- **Colour mode.** Dark / Light / System (System follows macOS). It is DSH's own appearance setting, written only
  when you click.
- **Glass.** DSH's sidebar, conversation, composer and right panel become frosted cards over the wallpaper, and
  DSH's own pages in `main` (Plugins, Automation tasks) get the same glass card. Sliders for wallpaper opacity and
  frost, glass blur and tint. While it is on, DSH's secondary and tertiary labels are deepened toward the label
  colour (DESIGN.md section 3) so its text reads on glass in light mode; the layer is removed when it turns off.
- **Motion.** The crossfade and the panel's animations. The Motion switch turns motion off everywhere on the page
  (macOS Reduce Motion always wins).
- **Headline.** Your own text over DSH's hero text, edited in the panel. Empty by default, which shows DSH's own
  headline. It is drawn with CSS; nothing writes DSH settings or the app bundle.

Open the panel with the picture button in the sidebar footer, next to Settings.

## For other plugins

Wallpaper publishes three things on `<body>` that other plugins may read (never write):

| What | Meaning |
| --- | --- |
| `--wp-blur` | the glass blur, for example `22px` |
| `--wp-tint` | the glass opacity, `0.1` to `0.95` |
| class `wp-still` | the Motion switch is off |

A plugin that wants to follow the glass draws its cards with `background: rgba(14,18,17,var(--wp-tint,.55))` and
`backdrop-filter: blur(var(--wp-blur,22px))`, so they follow the sliders when Wallpaper is on and use their own
defaults when it is off. A plugin page that paints its own opaque ground can stay as it is: Wallpaper's skins
section gives such pages the conversation card's glass without touching their content.

## Config

Row `wallpaper` in the profile's `cordis.patch.yml`. Every key is optional.

| Key | Default | |
| --- | --- | --- |
| `dataDir` | `<DSH home>/wallpaper` | `state.json`, `wp-cache/` (resized pictures) and `wallpaper.log` |
| `wallpaperDir` | `<dataDir>/wallpapers` | one folder per collection |

`<DSH home>` is `$DSH_HOME`, or `~/.dsh` when it is not set, so a test DSH keeps its own copy. Wallpaper reads and
writes nothing outside its own folder. No wallpaper pictures ship with the plugin; the library starts empty and is
yours to fill.

## Files

- `lib/index.js`: tiny host entry that loads `impl.js` with a fresh URL on every enable.
- `lib/impl.js`: host side. Settings and the picture library; routes on `/api/wallpaper/*`.
- `lib/client.js`: the look and the panel, hand-written React (no build step). DSH hot-reloads it when it changes.
- `lib/impl.test.mjs`: offline test of the host in a temporary home: `node lib/impl.test.mjs`.
