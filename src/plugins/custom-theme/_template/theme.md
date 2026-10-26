# Writing a custom theme

Themes are small ES modules. Each theme is a folder directly under
`src/plugins/custom-theme/` whose folder name is the theme id (like the
built-in `cli/`). There is nothing to register: the plugin discovers themes
automatically.

## Minimal structure

```
src/plugins/custom-theme/<your-theme-id>/
  index.ts        # exports the theme definition (default export)
  style.css       # your styles, imported with `?inline`
```

## index.ts

```ts
import type { PearTheme } from '../types';

import style from './style.css?inline';

const theme: PearTheme = {
  id: '<your-theme-id>', // must match the folder name
  name: 'My Theme', // shown in the Plugins > Options menu
  description: 'What it does', // optional
  author: 'You', // optional
  palette: {
    accentColor: '#ff0000',
    backgroundColor: '#030303',
    surfaceColor: '#1f1f1f',
    textColor: '#ffffff',
  },
  css: style,
  // Optional: DOM work that runs when the theme is activated.
  // context.getConfig() resolves the live config; context.applyPalette()
  // re-applies palette colors.
  // Return a cleanup function; it runs when the theme is deactivated.
  mount(context) {
    document.body.classList.add('my-theme-marker');
    const observer = new MutationObserver(() => {
      document.body.classList.add('my-theme-marker');
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.body.classList.remove('my-theme-marker');
    };
  },
  // Optional: runs on deactivate, before the mount cleanup.
  unmount() {},
};

export default theme;
```

The pointer `PearTheme` is defined in `src/plugins/custom-theme/types.ts`.

## style.css

Write plain CSS. It is injected into `<head>` only while your theme is active
and removed afterwards, so you do not need to undo anything manually. The
`custom-theme` plugin defines these CSS variables you can build on:

- `--pear-theme-accent`, `--pear-theme-bg`, `--pear-theme-surface`,
  `--pear-theme-text` (resolved from your `palette`)
- The standard YT Music palette (`--ytmusic-color-black1`,
  `--yt-spec-base-background`, ...) is remapped to the theme colors by the
  base plugin stylesheet.

Target known YT Music elements (`ytmusic-app-layout`, `ytmusic-player-bar`,
`ytmusic-guide-renderer`, etc.) — see the built-in `cli/style.css` for
examples of a full layout restyle.

## Rules

- Keep the module pure: no top-level DOM access. `index.ts` runs in the main
  process too (the menu needs the theme list), so top-level `window` or
  `document` would crash the app. Do DOM work inside `mount()` only.
- If your `index.ts` is invalid or missing an id/palette/css, the theme is
  skipped (a warning is logged in dev).

## Result

Your theme appears as a radio item under **Plugins > Custom Theme > Theme**
right after saving, with zero edits to plugin code.
