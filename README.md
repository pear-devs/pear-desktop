<div align="center">

# :pear: Pearum Desktop

**English** | [Русский](README.ru.md)

[![GitHub release](https://img.shields.io/github/release/maseckt/pearum-desktop.svg?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/releases/)
[![GitHub license](https://img.shields.io/github/license/maseckt/pearum-desktop.svg?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/blob/master/license)
[![Oxlint code style](https://img.shields.io/badge/code_style-Oxlint-5ed9c7.svg?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/blob/dev/.oxlintrc.json)
[![Build status](https://img.shields.io/github/actions/workflow/status/maseckt/pearum-desktop/build.yml?branch=master&style=for-the-badge)](https://github.com/maseckt/pearum-desktop/actions/workflows/build.yml)
[![GitHub All Releases](https://img.shields.io/github/downloads/maseckt/pearum-desktop/total?style=for-the-badge)](https://github.com/maseckt/pearum-desktop/releases/)

</div>

<!--![Screenshot](web/screenshot.png "Screenshot")-->

An independent fork of [Pear Desktop](https://github.com/pear-devs/pear-desktop),
focused on privacy, synced lyrics, and targeted stability improvements while retaining the familiar interface and plugin system.

Development happens on [`dev`](https://github.com/maseckt/pearum-desktop/tree/dev).
Development changes may not yet be available in published releases.

> [!IMPORTANT]
> ⚠️ Disclaimer
>
> **No Affiliation**
>
> This project, and its contributors, are not affiliated with, authorized by, endorsed by, or in any way officially connected with Google LLC, YouTube, or any of their subsidiaries or affiliates. **This is an independent, non-profit, and unofficial extension developed by a team of volunteers with the goal of providing a desktop experience.**
>
> **Trademarks**
>
> The names "Google" and "YouTube Music", as well as related names, marks, emblems, and images, are registered trademarks of their respective owners. Any use of these trademarks is for identification and reference purposes only and does not imply any association with the trademark holder. We have no intention of infringing upon these trademarks or causing harm to the trademark holders.
>
> **Limitation of Liability**
>
> This application (extension) is provided "AS IS", and you use it at your own risk. In no event shall the developers or contributors be liable for any claim, damages, or other liability, including any legal consequences, arising from, out of, or in connection with the software or the use or other dealings in the software. The responsibility for any and all outcomes of using this software rests entirely with the user.

## Content

- [Features](#features)
- [Translation](#translation)
- [Download](#download)
  - [Linux](#linux)
  - [MacOS](#macos)
  - [Windows](#windows)
    - [How to install without a network connection? (in Windows)](#how-to-install-without-a-network-connection-in-windows)
- [Themes](#themes)
- [Dev](#dev)
- [Build your own plugins](#build-your-own-plugins)
  - [Creating a plugin](#creating-a-plugin)
  - [Common use cases](#common-use-cases)
- [Build](#build)
- [Production Preview](#production-preview)
- [Tests](#tests)
- [License](#license)
- [FAQ](#faq)

## Features

- Native desktop integration and the existing Pear Desktop plugin system.
- Synced lyrics improvements: multi-source candidate matching, bounded searches, caching, and stable source selection with the original picker controls.
- Enhanced Do Not Track profiles: Lite, Balanced, Strict, and optional custom filter lists.

The application retains upstream branding in some menus and package names.

## Translation

Upstream translations are maintained on [Hosted Weblate](https://bit.ly/48n5YF7).
For fork-specific text, submit changes to this repository's `src/i18n/resources/`.

<a href="https://bit.ly/48n5YF7">
  <img src="https://bit.ly/4q83L6S" alt="translation status" />
  <img src="https://bit.ly/4h3zBxo" alt="translation status 2" />
</a>

## Download

Download Pearum Desktop only from this project's [GitHub Releases](https://github.com/maseckt/pearum-desktop/releases/).
Choose an asset for your operating system and device architecture. If no build is available for your platform, follow the [build instructions](#build).

### Linux

Download a Linux build from [GitHub Releases](https://github.com/maseckt/pearum-desktop/releases/) and choose a format supported by your distribution from the available assets.

### macOS

Download a macOS build for your device architecture from [GitHub Releases](https://github.com/maseckt/pearum-desktop/releases/).

If you install the app manually and get an error "is damaged and can’t be opened." when launching the app, run the following in the Terminal:

```bash
/usr/bin/xattr -cr /Applications/Pear\ Desktop.app
```

### Windows

Download a Windows installer for your device architecture from [GitHub Releases](https://github.com/maseckt/pearum-desktop/releases/) and run it.

*Note: Microsoft Defender SmartScreen may flag the installer as coming from an "unknown publisher".*

#### How to install without a network connection? (in Windows)

- Download the `*.nsis.7z` file for _your device architecture_ from this fork's [release page](https://github.com/maseckt/pearum-desktop/releases/), if provided.
  - `x64` for 64-bit Windows
  - `ia32` for 32-bit Windows
  - `arm64` for ARM64 Windows
- Download installer in release page. (`*-Setup.exe`)
- Place them in the **same directory**.
- Run the installer.

## Themes

You can load CSS files to change the look of the application (Options > Visual Tweaks > Themes).

Some predefined themes are available in https://github.com/kerichdev/themes-for-ytmdesktop-player.

## Dev

```bash
git clone --branch dev https://github.com/maseckt/pearum-desktop.git
cd pearum-desktop
pnpm install --frozen-lockfile
pnpm dev
```

Instead of installing pnpm on your system, you can also use [devcontainers](https://containers.dev/). You can use devcontainers either as a development environment in VS Code, or as a way to easily build the project without installing dependencies on your host system.

Note that this has it's own limitations (for example, GUI doesn't work on, at least some, Linux hosts).

## Build your own plugins

Using plugins, you can:

- manipulate the app - the `BrowserWindow` from electron is passed to the plugin handler
- change the front by manipulating the HTML/CSS

### Creating a plugin

Create a folder in `src/plugins/YOUR-PLUGIN-NAME`:

- `index.ts`: the main file of the plugin

<details>
<summary>Plugin example</summary>

```typescript
import style from './style.css?inline'; // import style as inline

import { createPlugin } from '@/utils';

export default createPlugin({
  name: 'Plugin Label',
  restartNeeded: true, // if value is true, ytmusic show restart dialog
  config: {
    enabled: false,
  }, // your custom config
  stylesheets: [style], // your custom style,
  menu: async ({ getConfig, setConfig }) => {
    // All *Config methods are wrapped Promise<T>
    const config = await getConfig();
    return [
      {
        label: 'menu',
        submenu: [1, 2, 3].map((value) => ({
          label: `value ${value}`,
          type: 'radio',
          checked: config.value === value,
          click() {
            setConfig({ value });
          },
        })),
      },
    ];
  },
  backend: {
    start({ window, ipc }) {
      window.maximize();

      // you can communicate with renderer plugin
      ipc.handle('some-event', () => {
        return 'hello';
      });
    },
    // it fired when config changed
    onConfigChange(newConfig) { /* ... */ },
    // it fired when plugin disabled
    stop(context) { /* ... */ },
  },
  renderer: {
    async start(context) {
      console.log(await context.ipc.invoke('some-event'));
    },
    // Only renderer available hook
    onPlayerApiReady(api, context) {
      // set plugin config easily
      context.setConfig({ myConfig: api.getVolume() });
    },
    onConfigChange(newConfig) { /* ... */ },
    stop(_context) { /* ... */ },
  },
  preload: {
    async start({ getConfig }) {
      const config = await getConfig();
    },
    onConfigChange(newConfig) {},
    stop(_context) {},
  },
});
```

</details>

### Common use cases

- injecting custom CSS: create a `style.css` file in the same folder then:

<details>
<summary>Custom CSS example</summary>

```typescript
// index.ts
import style from './style.css?inline'; // import style as inline

import { createPlugin } from '@/utils';

export default createPlugin({
  name: 'Plugin Label',
  restartNeeded: true, // if value is true, pear-desktop will show a restart dialog
  config: {
    enabled: false,
  }, // your custom config
  stylesheets: [style], // your custom style
  renderer() {} // define renderer hook
});
```

</details>

- If you want to change the HTML:

<details>
<summary>Renderer example</summary>

```typescript
import { createPlugin } from '@/utils';

export default createPlugin({
  name: 'Plugin Label',
  restartNeeded: true, // if value is true, ytmusic will show the restart dialog
  config: {
    enabled: false,
  }, // your custom config
  renderer() {
    console.log('hello from renderer');
  } // define renderer hook
});
```

</details>

- communicating between the front and back: can be done using the ipcMain module from electron. See `index.ts` file and
  example in `sponsorblock` plugin.

## Build

1. Clone the repo
2. Follow [this guide](https://pnpm.io/installation) to install `pnpm`
3. Run `pnpm install --frozen-lockfile` to install dependencies
4. Run the appropriate `pnpm dist:*` command below

- `pnpm dist:win` - Windows
- `pnpm dist:linux` - Linux (amd64)
- `pnpm dist:linux:deb-arm64` - Linux (arm64 for Debian)
- `pnpm dist:linux:rpm-arm64` - Linux (arm64 for Fedora)
- `pnpm dist:mac` - macOS (amd64)
- `pnpm dist:mac:arm64` - macOS (arm64)

Builds the app for macOS, Linux, and Windows,
using [electron-builder](https://github.com/electron-userland/electron-builder).

### Building in devcontainer

1. Clone the repo;
2. Open the folder in VS Code;
3. Reopen in container when prompted;
4. Run the appropriate `pnpm dist:*` command above;
5. Collect the packaged files from the `pack` folder (`dist` contains the compiled application).

Since devcontainer uses a mount for the workspace, the built files will be available on the host system as well.

## Production Preview

```bash
pnpm start
```

## Tests

```bash
pnpm test
```

Uses [Playwright](https://playwright.dev/) to test the app.

Run `pnpm check` for lint, formatting, and TypeScript checks. Run `pnpm audit` to
inspect dependency advisories; security updates do not imply an advisory-free dependency tree.

## License

MIT © [pear-devs](https://github.com/pear-devs/pear-desktop)

## FAQ

### Why apps menu isn't showing up?

If `Hide Menu` option is on - you can show the menu with the <kbd>alt</kbd> key (or <kbd>\`</kbd> [backtick] if using
the in-app-menu plugin)
