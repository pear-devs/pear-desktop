# Writing plugins

## Getting started

Create a plugin with:

```sh
nub scripts/new-plugin.ts my-plugin
nub install
```

This creates `plugins/my-plugin/index.ts`. Add npm dependencies after the name
(`nub scripts/new-plugin.ts my-plugin some-package@^1.0.0`). Run `nub run dev`
and the plugin shows up in the settings, where you can turn it on.

A plugin looks like this:

```ts
import { config, definePlugin } from "@pear/sdk";

export default definePlugin({
  id: "my-plugin", // same as the folder name
  name: "My plugin",
  description: "Shown in the settings.",
  config: {
    greeting: config.string("Hello", { label: "Greeting" }),
  },
  host: {
    start(ctx) {
      ctx.player.on("trackChange", (track) => ctx.log.info(ctx.config.greeting, track?.title));
    },
  },
  page(ctx) {
    ctx.toast(ctx.config.greeting);
  },
});
```

`host` runs in Electron's main process. Use it for windows, the tray, the file
system, network servers and other apps. `page` runs inside YTM. Use it for the
page, the player and anything visual. A plugin can have either or both.

The plugin is turned on, off and reconfigured while the app runs. Anything you
set up through `ctx` is undone when it is turned off, so there is no `stop` to
write.

## Options

All fields of `definePlugin`:

```ts
definePlugin({
  id: "my-plugin",
  name: "My plugin",
  description: "Shown in the settings.",
  authors: ["you"],
  platforms: ["linux", "win32"],  // default: all platforms
  enabledByDefault: false,        // or a list of platforms
  restartRequired: false,         // see "Plugins that can't be undone"
  config: { … },                  // see "Config"
  actions: { … },                 // see "Buttons in the settings"
  style: css`…`,                  // see "Styles"
  host: {
    start(ctx) {},                // may return a cleanup function
    commands: { … },              // see "Talking between host and page"
    rpc: { … },                   // see "API server methods"
    beforeReady(ctx) {},          // runs before the app is ready; for Chromium switches
    windowOptions(config) {},     // extra options for the main window
  },
  page: {
    start(ctx) {},                // may return a cleanup function
    runAt: "idle",                // or "start", to run before YTM's own scripts
  },
});
```

`page` can also be just a function, as in the first example.

## Config

`config` lists the plugin's settings. The settings UI is made from it, and
`ctx.config` gets its type from it.

```ts
config: {
  enabled: config.bool(true, { label: "Show the clock" }),
  size: config.number(12, { label: "Size", min: 8, max: 32, unit: "px" }),
  token: config.string("", { label: "API token", secret: true }),
  mode: config.select("short", [
    { value: "short", label: "Short" },
    { value: "long", label: "Long" },
  ], { label: "Format" }),
  sources: config.multi(["lrclib"], [
    { value: "lrclib", label: "LRCLib" },
    { value: "genius", label: "Genius" },
  ], { label: "Sources" }),
  folders: config.list([], { label: "Folders", placeholder: "/path/to/folder" }),
  hotkey: config.shortcut("", { label: "Hotkey" }),
},
```

Every field also takes `description`, `group` (a heading in the settings),
`restart: true` (the change needs an app restart) and `platforms`. Numbers take
`variant: "slider" | "stepper"`; selects take `variant: "chips" | "dropdown"`.

Read the current values from `ctx.config`. Change them with
`ctx.setConfig({ size: 14 })`.

When the user changes a setting, the plugin is restarted. To apply the change
without a restart, register a listener in `start`:

```ts
start(ctx) {
  const clock = createClock(ctx.config.size);
  ctx.onConfigChange((config) => clock.resize(config.size));
}
```

Return `"restart"` from the listener when a change still needs a restart.

## Buttons in the settings

`actions` adds buttons to the plugin's settings card. Each one runs the host
command with the same name:

```ts
actions: {
  reconnect: { label: "Reconnect", description: "Connect again now." },
},
host: {
  commands: {
    reconnect() { … },
  },
},
```

## Host API

`ctx` in `host.start`, and `this` in commands.

| | |
|---|---|
| `config`, `setConfig(patch)`, `onConfigChange(fn)` | the plugin's settings |
| `player.state` | what's playing: track, status, position, volume… |
| `player.on("change" \| "trackChange", fn)` | follow the player |
| `player.control(action)` | play, pause, skip… (see "Player actions") |
| `player.details()` | extras of the current track: views, tags, alternative title (or `null`) |
| `app`, `window`, `session` | Electron's app, the main window and its session |
| `webRequest` | Electron's `webRequest`, shared fairly with other plugins |
| `listen(emitter, event, fn)` | `emitter.on(event, fn)` that is removed when the plugin stops |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` | timers that are cleared when the plugin stops |
| `focusWindow()` | show the main window and bring it to the front |
| `addMenuItem({ label, accelerator?, click })` | an item in the app menu (under Options) and the tray menu |
| `pluginMenuItems()`, `onMenuItemsChange(fn)` | the items plugins added, for a plugin with a menu of its own (see `plugins/tray`) |
| `openSettings()` | open the settings |
| `setStatus(text)` | a status line on the plugin's settings card (`""` clears it) |
| `emit`, `request` | talk to the page part (see below) |
| `api.broadcast(event, data)` | send an event to the API server's WebSocket clients |
| `onProtocol(fn)` | commands from app protocol links |
| `onCleanup(fn)` | run `fn` when the plugin stops |
| `t(key, english, vars)` | translated text (see "Translations") |
| `log.info/warn/error` | logging, prefixed with the plugin's id |

## Page API

`ctx` in `page`.

| | |
|---|---|
| `config`, `setConfig(patch)`, `onConfigChange(fn)` | the plugin's settings |
| `player.state`, `player.control(action)` | as on the host |
| `player.on(event, fn)` | `trackLoading`, `trackChange`, `statusChange`, `timeUpdate`, `volumeChange`, `adChange`, `change` |
| `player.ready()`, `player.api` | YTM's player object, once it exists |
| `player.videoReady()` | the `<video>` element, once it exists (YTM adds it a little after its player object) |
| `player.video()` | the `<video>` element, or `null` before it exists |
| `$(name)`, `$$(name)` | find elements by selector name (see "Selectors") |
| `waitFor(name)` | wait for an element to appear |
| `mount(element, name, "prepend" \| "append")` | put an element into the page and keep it there when YTM re-renders |
| `observe(nameOrNode, options, fn)` | a `MutationObserver` |
| `listen(target, type, fn)` | `addEventListener` |
| `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` | timers |
| `addStyle(css)` | add CSS; returns `{ update, remove }` |
| `toast(message)` | show a message in YTM's toast |
| `isWindowVisible()` | whether the window is on screen; the page keeps running while it's minimized or hidden, so per-frame drawing should check this |
| `audio()` | the shared audio graph, to add Web Audio nodes (see `plugins/equalizer`) |
| `host` | talk to the host part (see below) |
| `onCleanup(fn)`, `signal` | run `fn`, or abort `signal`, when the plugin stops |
| `t`, `log` | as on the host |

Listeners, timers, observers, styles and mounted elements are all removed when
the plugin stops.

This holds for both parts even when `start` awaits and the plugin is disabled
or restarted meanwhile: whatever it registers after it stopped is undone at
once, and its timers never fire. On the page, `ctx.signal.aborted` tells it to
give up early.

## Talking between host and page

Page to host, with commands. Arguments and results are typed:

```ts
host: {
  commands: {
    async save(title: string) {
      await writeFile(join(this.app.getPath("downloads"), `${title}.txt`), title);
      return true;
    },
  },
},
page: async (ctx) => {
  const saved = await ctx.host.invoke("save", "My song");
},
```

Host to page, with events:

```ts
// host
ctx.emit("progress", 0.5);
// page
ctx.host.on("progress", (value) => …);
```

Host asks the page:

```ts
// page
ctx.host.handle("volume", () => ctx.player.api?.getVolume());
// host
const volume = await ctx.request<number>("volume");
```

## Selectors

Elements of YTM's page are found by name, for example
`ctx.$("player_bar.like_buttons")`. The names live in
`packages/sdk/src/selectors.ts`. If you need an element that isn't there, add
it to that file.

YTM has two player bars: the classic one, and a new one it gives some users.
Each `player_bar.*` name matches either, so a plugin using the names works on
both. A few exist in one layout only (`player_bar.expand_volume`,
`player_bar.volume_popup`…); their comments say so. To try your plugin on both,
pick one under Settings → Developer Tweaks → Player bar.

## Styles

```ts
import { css } from "@pear/sdk/macros" with { type: "macro" };

style: css`
  sel(nav_bar) {
    backdrop-filter: blur(8px);
  }
`,
```

`sel(name)` is replaced by the selector of that name. The CSS is checked when
the app is built, so a mistake shows up then and not in the app. `css` can't
contain `${}`; use CSS variables for values that change. `style` can also be a
function of the config: `style: (config) => …`.

## Adding elements to the page

Write JSX in a `.tsx` file that starts with `/** @jsxImportSource @pear/sdk */`.
It creates normal DOM elements:

```tsx
/** @jsxImportSource @pear/sdk */
import { definePlugin } from "@pear/sdk";
import { Icon } from "@pear/sdk/dom";

const STAR = "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

export default definePlugin({
  id: "my-plugin",
  name: "My plugin",
  page(ctx) {
    const button = (
      <button class="my-plugin-button" title="Star" onClick={() => ctx.toast("Starred")}>
        <Icon path={STAR} />
      </button>
    );
    ctx.mount(button, "player_bar.right_controls_buttons", "prepend");
  },
});
```

`@pear/sdk/dom` also has:

- `picker(ctx, options)`: a player-bar button with a menu of choices, like the
  quality and speed pickers. See `plugins/quality-changer`.
- `popupMenuItem(ctx, options)`: an entry in YTM's ⋮ menus. See
  `plugins/picture-in-picture`.
- `shadowHost(tag, css)`: an element whose content YTM's CSS can't reach.
- `anchoredPopover(ctx, { name, label })`: an empty popover in the pickers'
  look that you fill and show next to any element (`show(element, position)`,
  `hide()`), and close when you like. See the downloader's Downloads popover.
- `containScroll(element, signal)` and `isolateKeys(element, signal)`: the wheel
  and key presses inside `element` don't reach the page behind it.
- `sidebarEntry(ctx, { name, label, icon, onClick })`: an entry in YTM's
  sidebar, under Home and Library, in the full and the collapsed sidebar. Its
  `setBadge(text)` shows a small count next to it; `elements` and `focus()` are
  there to put a popover on it, and `setSelected(true)` highlights it while its
  page shows. See `plugins/downloader`.
- `openBrowsePage(browseId)`: opens one of YTM's pages in place, as its own
  links do, e.g. `openBrowsePage("FEmusic_offline")` for its Downloads page.

For bigger UIs that change a lot, like the lyrics panel, use Preact instead
(see `plugins/synced-lyrics`).

## Translations

The plugin's name, description, settings and buttons are translated
automatically. For any other text, use `ctx.t`:

```ts
ctx.toast(ctx.t("plugins.my-plugin.saved", "Saved “{{title}}”", { title }));
```

Then run `nub run i18n`. It adds the English text to
`src/i18n/resources/en.json`, which translators work from.

## API server methods

Other apps can call a plugin through the API server (when the user turns it
on). The input is checked before `run` is called:

```ts
import { v } from "@pear/sdk/rpc";

host: {
  rpc: {
    segments: {
      summary: "Skip segments of a video",
      input: v.object({ videoId: v.string() }),
      run({ videoId }) {
        return fetchSegments(videoId);
      },
    },
  },
},
```

This becomes `POST /api/v1/plugins/my-plugin/segments`, listed at `/swagger`.
`ctx.api.broadcast(event, data)` sends events to WebSocket clients. See
`plugins/sponsorblock`.

## Player actions

`ctx.player.control({ type: "next" })`. The types are `play`, `pause`,
`toggle`, `next`, `previous`, `seek` (`seconds`), `seekBy` (`seconds`),
`volume` (`value`, 0–100), `mute` (`muted`), `like`, `dislike`, `shuffle` and
`repeat`.

## Plugins that can't be undone

Some changes to the page can't be reversed, such as replacing one of its
global functions. Set `restartRequired: true`. The settings then ask for a
restart when the plugin is turned on or off. See
`plugins/performance-improvement`.

## Helpers

`@pear/sdk/util` has small helpers: `clamp`, `sleep`, `debounce`,
`formatDuration`, `isPlaying(state)`, `errorMessage(error)` and `ytmUrl(path)`.

## Testing

`nub run test` runs unit tests; put a plugin's tests in `plugins/<id>/test/`.

`nub run test:e2e my-plugin` runs the app against the real YTM with the e2e
tests whose file name matches. A test looks like this:

```ts
import { expect, test } from "./fixtures.ts";
import { mainWindow, playTestTrack } from "./launch.ts";
import { setConfig } from "./helpers/plugins.ts";
import { waitForTrackPlaying } from "./helpers/playback.ts";

test("my-plugin shows the greeting", async ({ launch }) => {
  const app = await launch({ plugins: { "my-plugin": { enabled: true } } });
  const page = await mainWindow(app);
  await playTestTrack(page);
  await waitForTrackPlaying(page);
  await setConfig(page, "my-plugin", { greeting: "Hi" });
  await expect(page.locator(".my-plugin-greeting")).toHaveText("Hi");
});
```

Put it in `apps/desktop/e2e/`. Never sign in to Google in a test: Google then
blocks the whole network for a while.

## Gotchas

**Code outside `host` and `page` runs in both places.** A top-level statement
runs in the main process and in the page, and the page can't use Electron or
Node:

```ts
// Breaks the page: Tray doesn't exist there.
const tray = new Tray(icon);

// Works: only the host runs it.
host: {
  start(ctx) {
    const tray = new Tray(icon);
    ctx.onCleanup(() => tray.destroy());
  },
},
```

Constants and functions at the top level are fine.

**Set things up through `ctx`, or clean them up yourself.** Plain
`addEventListener`, `setInterval` or `new MutationObserver` keep running after
the plugin is turned off:

```ts
// Keeps firing after the plugin is off.
video.addEventListener("ended", onEnded);
setInterval(tick, 1000);

// Removed when the plugin stops.
ctx.listen(video, "ended", onEnded);
ctx.setInterval(tick, 1000);
```

**Write translation keys out in full.** `nub run i18n` finds texts by looking
for `t("key", "English")` in the code, so a key it can't read is missed:

```ts
// Missed.
const t = (key: string, english: string) => ctx.t(`plugins.my-plugin.${key}`, english);
t("saved", "Saved");

// Found.
ctx.t("plugins.my-plugin.saved", "Saved");
```

**Selectors are names, not CSS.** `ctx.$` takes a name from the selector list:

```ts
ctx.$(".right-controls-buttons");             // type error
ctx.$("player_bar.right_controls_buttons");   // works
```

**Don't write YTM's class names into your code.** `"ytmusic-player-bar .title"`
finds nothing for users with the new player bar; the selector name does:

```ts
document.querySelector("ytmusic-player-bar .title"); // classic bar only
ctx.$("player_bar.title");                           // either bar
```

**JSX event names are capitalised once.** It's `onKeydown`, `onPointerdown`
and `onBeforetoggle`, not `onKeyDown`. JSX elements are typed `HTMLElement`, so
cast when you need an input's value:

```tsx
const slider = (<input type="range" min="0" max="1" step="0.1" />) as HTMLInputElement;
slider.valueAsNumber;
```

**Picker styles need both class names.** The picker's own CSS is added after
yours, so a rule with one class loses:

```css
/* Loses. */
.pear-speed-popover { width: 260px; }
/* Wins. */
.pear-picker-popover.pear-speed-popover { width: 260px; }
```

**`runAt: "start"` runs before the page exists.** There is no `<body>` yet. Use
it only to patch things before YTM's scripts run, and use `ctx.waitFor` for
elements.

**Don't write the music service's name in the code.** The repository keeps it
out of the sources and the commit hook rejects it. Write "YTM" in comments,
and import `YTM_NAME` or `ytmUrl` from `@pear/sdk/util` when you need it in a
string.
