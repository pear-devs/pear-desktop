<div align="center">

# :pear: Pear Desktop

[![GitHub release](https://img.shields.io/github/release/pear-devs/pear-desktop.svg?style=for-the-badge)](https://github.com/pear-devs/pear-desktop/releases/)
[![GitHub license](https://img.shields.io/github/license/pear-devs/pear-desktop.svg?style=for-the-badge)](https://github.com/pear-devs/pear-desktop/blob/master/license)
[![eslint code style](https://img.shields.io/badge/code_style-eslint-5ed9c7.svg?style=for-the-badge)](https://github.com/pear-devs/pear-desktop/blob/master/eslint.config.mjs)
[![Build status](https://img.shields.io/github/actions/workflow/status/pear-devs/pear-desktop/build.yml?branch=master&style=for-the-badge)](https://GitHub.com/pear-devs/pear-desktop/releases/)
[![GitHub All Releases](https://img.shields.io/github/downloads/pear-devs/pear-desktop/total?style=for-the-badge)](https://GitHub.com/pear-devs/pear-desktop/releases/)
<!--[![AUR](https://img.shields.io/aur/version/pear-desktop-bin?color=blueviolet&style=for-the-badge)](https://aur.archlinux.org/packages/pear-desktop-bin)-->
[![Known Vulnerabilities](https://snyk.io/test/github/pear-devs/pear-desktop/badge.svg)](https://snyk.io/test/github/pear-devs/pear-desktop)

## :warning: [Pear Desktop is NOT affiliated with YouTube Music or Google](#disclaimer-of-non-affiliation)

![Pear Desktop running](/web/screenshot.png)
</div>

## Index

- [Features](#features)
  - [Additional Settings](#additional-settings)
  - [Many Plugins](#plugins)
- [Translation](#translation)
- [Download](#download)
  - [Arch Linux](#arch-linux)
  - [MacOS](#macos)
  - [Windows](#windows)
- [Themes](#themes)
- [Development](#development)
  - [Building your own plugins](#building-your-own-plugins)
  - [Building from source](#building-from-source)
    - [PNPM Commands](#pnpm-commands)
- [License](#license)
- [FAQ](#faq)
- [Disclaimer of non-affiliation](#disclaimer-of-non-affiliation)

# Features

## Additional Settings

- Resume the last playing song on app start
- Set the default page to start the app on
- [Theming](#themes) to load custom CSS
- Tray Applet

## Plugins

<details>
  <summary>Show plugin list</summary>

- **Ad blocker**: Block ads within the application
- **Album Actions**: Perform bulk actions for all tracks in an album or playlist
- **Album Color Theme**: Applies a dynamic theme and visual effects based on the album color palette
- **Ambient Mode**: Add a soft glow around album art
- **Amuse**: (TODO, add desc)
- **API Server**: (TODO, add desc)
- **Audio Compressor**: Apply [Dynamic Range Compression](https://en.wikipedia.org/wiki/Dynamic_range_compression) to audio (Average the volume of music)
- **Auth Proxy Adapter**: (TODO, add desc)
- **Blur Navigation bar**: Add a blur affect to the navigation bar
- **Bypass Age Restrictions**: Bypass YouTube's age restriction
- **Captions Selector**: Enable Captions
- **Compact Sidebar**: Force the sidebar to always be compact
- **Crossfade**: Crossfade songs when changing tracks
- **Custom Output Device**: Specify an output device manually within the app
- **Disable Autoplay**: Stop music from autoplaying when switching to a new song
- **Discord Rich Presence**: Integrate with Discord RPC (Show currently playing in activities)
- **Downloader**: Utilities to download your music
- **Equalizer**: Add an [equalizer](https://en.wikipedia.org/wiki/Audio_equalization) to adjust the tone of audio
- **Exponential Volume**: Change volume exponentially instead of linearly
- **In-App Menu**: Add the alt menu to the top of the (in app) UI
- **Lumia Stream**: Enable [Lumia Stream](https://lumiastream.com/) integration
- **Music Together**: Share a playlist with others. When the host plays a song, everyone else will hear the same song
- **Navigation**: Add forward/back buttons to the top right corner
- **No Google Login:** Bypass the Google account requirement
- **Notifications**: Send system notifications when the track changes
- **Performance improvement**: (TODO: This shouldn't be a plugin, but natively integrated)
- **Picture-in-Picture**: Add an option to enable PiP (Show album art or the music video in its own window)
- **Playback Speed**: Change the playback speed
- **Precise Volume**: Map the in-app volume slider to keys
- **Scrobbler**: Scrobble Music to [Last.fm](https://last.fm) or [ListenBrainz](https://listenbrainz.org/)
- **Shortcuts (MPRIS)**: **[Linux Only]** Use the [MPRIS](https://specifications.freedesktop.org/mpris/latest/) specification for shortcuts
- **Skip Disliked Songs**: Force YouTube Music to skip disliked songs
- **Skip Silences**: Skip silences in tracks
- **SponsorBlock**: Automatically Skips non-music parts like intro/outro or parts of music videos where the song isn't playing
- **Synced Lyrics**: Highlight Lyrics with the current time in the song
- **Tuna OBS**: Integration with the [Tuna plugin for OBS](https://obsproject.com/forum/resources/tuna.843/)
- **Unobtrusive Player**: Prevents the player from popping up when playing a song
- **Video Quality Changer**: Add a resolution option to videos playing
- **Video Toggle**: More granular settings for tracks that have music videos available
- **Visualizer**: Replace album art with a visualizer

</details>

## Translation

You can help with translation on the [Hosted Weblate](https://hosted.weblate.org/engage/youtube-music/).

![Weblate widget](https://hosted.weblate.org/widget/youtube-music/i18n/287x66-black.png)

## Download

You can check out the [latest release](https://github.com/pear-devs/pear-desktop/releases/latest) to quickly find the
latest version.

### Arch Linux

Install the [`pear-desktop`](https://aur.archlinux.org/packages/pear-desktop) package from the AUR. For AUR installation instructions, check the [Arch Linux AUR wiki](https://wiki.archlinux.org/index.php/Arch_User_Repository#Installing_packages).

### macOS

You can install the app using Homebrew (see the [cask definition](https://github.com/pear-devs/pear-desktop-homebrew)):

```bash
brew install pear-devs/pear-desktop
```

If you install the app manually and get the error "...is damaged and can’t be opened." when launching the app, run the following in the Terminal:

```bash
/usr/bin/xattr -cr /Applications/Pear\ Desktop.app
```

### Windows

You can use the [Scoop package manager](https://scoop.sh) to install the `pear-desktop` package from
the [`extras` bucket](https://github.com/ScoopInstaller/Extras).

```powershell
scoop bucket add extras
scoop install extras/pear-desktop
```

Alternately you can use [Winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/), Windows 11's official CLI package manager to install the `pear-devs.pear-desktop` package.

*Note: Microsoft Defender SmartScreen might block the installation since it is from an "unknown publisher". This is also
true for the manual installation when trying to run the executable(.exe) after a manual download here on github (same
file).*

```powershell
winget install pear-devs.pear-desktop
```

## Themes

You can load CSS files to change the look of the application (Options > Visual Tweaks > Themes).

Some predefined themes are available in <https://github.com/kerichdev/themes-for-ytmdesktop-player>.

## Development

```bash
git clone https://github.com/pear-devs/pear-desktop
cd pear-desktop
pnpm install --frozen-lockfile
pnpm dev
```

### Building your own plugins

Using plugins, you can:

- manipulate the app - the `BrowserWindow` from electron is passed to the plugin handler
- change the front by manipulating the HTML/CSS

#### Creating a plugin

Create a folder in `src/plugins/YOUR-PLUGIN-NAME`:

- `index.ts`: the main file of the plugin

<details>
  <summary>Show example code</summary>

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

#### Common use cases

- injecting custom CSS: create a `style.css` file in the same folder then:

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

- If you want to change the HTML:

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

### Building from source

1. Clone the repo
2. Follow [this guide](https://pnpm.io/installation) to install `pnpm`
3. Run `pnpm install --frozen-lockfile` to install dependencies
4. Run `pnpm build:OS`

- `pnpm dist:win` - Windows
- `pnpm dist:linux` - Linux (amd64)
- `pnpm dist:linux:deb-arm64` - Linux (arm64 for Debian)
- `pnpm dist:linux:rpm-arm64` - Linux (arm64 for Fedora)
- `pnpm dist:mac` - macOS (amd64)
- `pnpm dist:mac:arm64` - macOS (arm64)

Builds the app for macOS, Linux, and Windows,
using [electron-builder](https://github.com/electron-userland/electron-builder).

#### PNPM Commands

- `pnpm start`: Starts the program
- `pnpm test`: Runs tests using [Playwright](https://playwright.dev/)

## License

MIT © [pear-devs](https://github.com/pear-devs/pear-desktop)

## FAQ

### Why apps menu isn't showing up?

If `Hide Menu` option is on - you can show the menu with the <kbd>alt</kbd> key (or <kbd>\`</kbd> [backtick] if using
the in-app-menu plugin)

## Disclaimer of non-affiliation

<details>
  <summary>Disclaimer of non-affiliation with YouTube Music and Google</summary>

#### NO AFFILIATION

This project, and its contributors, are not affiliated with, authorized by, endorsed by, or in any way officially connected with Google LLC, YouTube, or any of their subsidiaries or affiliates.

**This is an independent, non-profit, and unofficial extension developed by a team of volunteers with the goal of providing a desktop experience.**

#### TRADEMARKS

The names "Google" and "YouTube Music", as well as related names, marks, emblems, and images, are registered trademarks of their respective owners. Any use of these trademarks is for identification and reference purposes only and does not imply any association with the trademark holder. We have no intention of infringing upon these trademarks or causing harm to the trademark holders.

#### LIMITATION OF LIABILITY

This application (extension) is provided "AS IS", and you use it at your own risk. In no event shall the developers or contributors be liable for any claim, damages, or other liability, including any legal consequences, arising from, out of, or in connection with the software or the use or other dealings in the software. The responsibility for any and all outcomes of using this software rests entirely with the user.
</details>
