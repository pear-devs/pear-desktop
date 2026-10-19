# Pear Desktop

A from-scratch rewrite of [pear-desktop](https://github.com/pear-devs/pear-desktop):
a desktop client for YTM with a plugin system, built on Electron.

- **One Chromium everywhere** (Electron), with proprietary codecs.
- **Plugins are single files**, compiled twice: a host part for the main process
  and a page part injected into YTM before its own scripts run.
- **Build-time macros**: `sel()` and `` css`…` `` resolve and validate selectors
  and CSS while bundling, so a typo fails the build instead of a user's session.
- **One selector registry** (`packages/sdk/src/selectors.ts`): when YT
  Music changes its markup, fix it there once.
- **Live everything**: enable, disable and configure plugins from the in-page
  settings (<kbd>Ctrl</kbd>+<kbd>,</kbd>) without restarting.

## Layout

```
apps/desktop/          Electron main process, preload, e2e tests
packages/sdk/          plugin API, config schema, selector registry, macros
packages/page/         page runtime: player facade, plugin runner, audio graph
packages/ui/           settings overlay (Preact in a shadow DOM)
packages/vite-plugin-pear/  plugin discovery, host/page splitting, page bundling
plugins/<id>/          one folder per plugin
docs/plugins.md        plugin authoring guide
```

## Development

Requires [nub](https://nubjs.com) and Node 22+.

```sh
nub install
nub run dev          # launch the app with hot rebuilds
nub run typecheck
nub run test         # unit tests
nub run test:e2e     # builds, then drives the app against real YTM
```

`PEAR_USER_DATA=/tmp/profile nub run dev` runs with a separate profile.

## Notes

- Google sign-in sees Electron's honest user agent; YTM sees a Chrome
  one. Never automate sign-in in tests: Google rate-limits the whole IP.
- The EU cookie-consent screen is skipped with the "only essential cookies"
  choice (`SOCS=CAI`) unless you've chosen otherwise.
