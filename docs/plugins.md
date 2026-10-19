# Writing Pear Desktop plugins

A plugin is a folder `plugins/<id>/` with an `index.ts` that default-exports
`definePlugin({...})`. Scaffold one with:

```sh
nub scripts/new-plugin.ts my-plugin [npm-dependency@range ...]
nub install
```

The build discovers every plugin automatically. Each plugin file is compiled
**twice**:

| bundle | keeps | runs in |
|---|---|---|
| host | everything except `page` and `style` | Electron main process (Node) |
| page | everything except `host` | YTM's main world, before YTM's own scripts |

Afterwards, imports and top-level helpers that are no longer referenced are
pruned, so `import { Tray } from "electron"` used only inside `host` never
reaches the page, and vice versa. Rules of thumb:

- Keep host-only code inside `host` (or in helpers only `host` uses). Same for `page`.
- Top-level code with side effects (`const x = sideEffect()`) is kept in both
  bundles, so avoid it; put it inside `start`.
- Side-effect imports (`import "./x"`) are kept in both bundles.

## Anatomy

```ts
import { config, definePlugin } from "@pear/sdk";
import { css, sel } from "@pear/sdk/macros" with { type: "macro" };

export default definePlugin({
  id: "my-plugin",              // must equal the folder name
  name: "My plugin",
  description: "One sentence shown in settings.",
  platforms: ["linux"],          // optional; default all
  enabledByDefault: false,
  config: {                      // generates the settings UI and the config type
    amount: config.number(5, { label: "Amount", min: 0, max: 10, unit: "dB" }),
    mode: config.select("a", [{ value: "a", label: "A" }, { value: "b", label: "B" }], { label: "Mode" }),
    token: config.string("", { label: "API token", secret: true }),
    enabled: config.bool(true, { label: "Thing" }),
    key: config.shortcut("", { label: "Shortcut" }),
  },
  host: {
    beforeReady(ctx) {},         // before app ready: ctx.disableFeatures("X")
    windowOptions(config) { return {}; }, // merged into the main BrowserWindow options
    start(ctx) { return () => {} },       // may return a cleanup
    onConfigChange(config, ctx) {},       // default: restart the host part
    commands: {                  // typed RPC for the page: ctx.host.invoke("hello", "x")
      hello(name: string) { return `hi ${name} from ${this.id}`; },
    },
  },
  page: {                        // or just a function (= start)
    runAt: "idle",               // "start" = before YTM's scripts (no <html>/<body> yet!)
    start(ctx) {},
    onConfigChange(config, ctx) {}, // default: restart the page part
  },
  style: css`sel(nav_bar.divider) { display: none !important; }`,
});
```

### Macros (build time)

- `sel("name")` resolves a selector from `@pear/sdk/selectors` and fails the
  build (and type check) for unknown names. **All YTM DOM knowledge lives in
  that registry**; add entries there instead of hard-coding selectors.
- ``css`…` `` validates and minifies CSS with lightningcss; `sel(name)` inside
  the text is replaced by the registry selector. No `${}` interpolation: pass
  dynamic values through CSS custom properties (see `plugins/blur-nav-bar`).

### Host context (`ctx` in `host.start`, `this` in commands)

`config` (live), `setConfig`, `app`, `window`, `session`, `webRequest`
(scoped: composes with other plugins, removed on stop), `player` (`state`,
`on("change" | "trackChange")`, `control(action)`), `emit(event, payload)` to
the page part, `request(event, payload)` to ask the page part, `openSettings()`,
`onCleanup(fn)`, `log`.

### Page context

`config`, `setConfig`, `player` (`state`, `api` = YTM's `#movie_player`,
`video()`, `ready()`, `on("trackLoading" | "trackChange" | "statusChange" |
"timeUpdate" | "volumeChange" | "adChange" | "change")`, `control(action)`),
`host` (`invoke`, `on`, `handle`), `sel`, `$`, `$$`, `waitFor(name)`,
`listen(target, type, fn)`, `addStyle(css)` → handle, `audio()` → the shared
Web Audio graph (`insert(input, output?, order?)`, `tap(node)`), `onCleanup`,
`signal`, `log`.

Everything registered through `ctx` is cleaned up automatically when the plugin
is disabled, so enabling and disabling never needs a restart.

### Player actions

`play`, `pause`, `toggle`, `next`, `previous`, `seek {seconds}`,
`seekBy {seconds}`, `volume {value 0–100}`, `mute {muted?}`, `like`,
`dislike`, `shuffle`, `repeat`.

## Testing

- `nub run typecheck` and `nub run test` (unit tests) from the repo root.
- `nub run test:e2e` builds the app and runs Playwright against real YT
  Music. Use `launchApp({ plugins: { id: { enabled: true, config } } })` from
  `apps/desktop/e2e/launch.ts`. Never automate Google sign-in.
