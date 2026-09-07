<div align="center" markdown="1">
   <sup>Special thanks to:</sup>
   <br>
   <br>
   <a href="https://go.warp.dev/pear-desktop">
      <img alt="Warp sponsorship" width="400" src="https://github.com/user-attachments/assets/8307ea56-e872-494a-8a9c-de0e296a06ed" />
   </a>

### [Warp, built for coding with multiple AI agents](https://go.warp.dev/pear-desktop)
[Available for macOS, Linux, & Windows](https://go.warp.dev/pear-desktop)<br>

</div>
<hr>

<div align="center">

# :pear: Pear Desktop

[![GitHub release](https://img.shields.io/github/release/pear-devs/pear-desktop.svg?style=for-the-badge)](https://github.com/pear-devs/pear-desktop/releases/)
[![GitHub license](https://img.shields.io/github/license/pear-devs/pear-desktop.svg?style=for-the-badge)](https://github.com/pear-devs/pear-desktop/blob/master/license)
[![eslint code style](https://img.shields.io/badge/code_style-eslint-5ed9c7.svg?style=for-the-badge)](https://github.com/pear-devs/pear-desktop/blob/master/eslint.config.mjs)
[![Build status](https://img.shields.io/github/actions/workflow/status/pear-devs/pear-desktop/build.yml?branch=master&style=for-the-badge)](https://GitHub.com/pear-devs/pear-desktop/releases/)
[![GitHub All Releases](https://img.shields.io/github/downloads/pear-devs/pear-desktop/total?style=for-the-badge)](https://GitHub.com/pear-devs/pear-desktop/releases/)
<!--[![AUR](https://img.shields.io/aur/version/pear-desktop-bin?color=blueviolet&style=for-the-badge)](https://aur.archlinux.org/packages/pear-desktop-bin)-->
[![Known Vulnerabilities](https://snyk.io/test/github/pear-devs/pear-desktop/badge.svg)](https://snyk.io/test/github/pear-devs/pear-desktop)

</div>

<!--![Screenshot](web/screenshot.png "Screenshot")-->

- Native look & feel extension

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
  - [Arch Linux](#arch-linux)
  - [Solus](#solus)
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

## Translation

You can help with translation on [Hosted Weblate](https://bit.ly/48n5YF7).

<a href="https://bit.ly/48n5YF7">
  <img src="https://bit.ly/4q83L6S" alt="translation status" />
  <img src="https://bit.ly/4h3zBxo" alt="translation status 2" />
</a>

## Download

You can check out the [latest release](https://github.com/pear-devs/pear-desktop/releases/latest) to quickly find the
latest version.

### Arch Linux

Install the [`pear-desktop`](https://aur.archlinux.org/packages/pear-desktop) package from the AUR. For AUR installation instructions, take a look at
this [wiki page](https://wiki.archlinux.org/index.php/Arch_User_Repository#Installing_packages).

### [Solus](https://getsol.us/)

```bash
sudo eopkg install pear-desktop
```

### macOS

You can install the app using Homebrew (see the [cask definition](https://github.com/pear-devs/homebrew-pear)):

```bash
brew install pear-devs/pear/pear-desktop
```

If you install the app manually and get an error "is damaged and can’t be opened." when launching the app, run the following in the Terminal:

```bash
/usr/bin/xattr -cr /Applications/Pear\ Desktop.app
```

### Windows

You can use the [Scoop package manager](https://scoop.sh) to install the `pear-desktop` package from
the [`extras` bucket](https://github.com/ScoopInstaller/Extras).

```bash
scoop bucket add extras
scoop install extras/pear-desktop
```

Alternately you can use [Winget](https://learn.microsoft.com/en-us/windows/package-manager/winget/), Windows 11s
official CLI package manager to install the `pear-devs.pear-desktop` package.

*Note: Microsoft Defender SmartScreen might block the installation since it is from an "unknown publisher". This is also
true for the manual installation when trying to run the executable(.exe) after a manual download here on github (same
file).*

```bash
winget install pear-devs.pear-desktop
```

#### How to install without a network connection? (in Windows)

- Download the `*.nsis.7z` file for _your device architecture_ in [release page](https://github.com/pear-devs/pear-desktop/releases/latest).
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
git clone https://github.com/pear-devs/pear-desktop
cd pear-desktop
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

### Common use cases

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

- communicating between the front and back: can be done using the ipcMain module from electron. See `index.ts` file and
  example in `sponsorblock` plugin.

## Build

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

### Building in devcontainer

1. Clone the repo;
2. Open the folder in VS Code;
3. Reopen in container when prompted;
4. Run `pnpm build` as above (choosing the desired target);
5. Collect the built files from the `dist` folder.

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

## License

MIT © [pear-devs](https://github.com/pear-devs/pear-desktop)

## FAQ

### Why apps menu isn't showing up?

If `Hide Menu` option is on - you can show the menu with the <kbd>alt</kbd> key (or <kbd>\`</kbd> [backtick] if using
the in-app-menu plugin)


## 🌐 Web Resources & Interactive Index
- [PLANET EVOLUTION IDLE CLICKER](https://learnaction.netlify.app/planet-evolution-idle-clicker.html)
- [INDEX9](https://learnaction.netlify.app/index9.html)
- [RACE IT CAR RACING](https://learnaction.github.io/race-it-car-racing.html)
- [BACKROOMS](https://learnaction.netlify.app/backrooms.html)
- [CATEGORY STICKMAN 2](https://learnaction.netlify.app/category-stickman-2.html)
- [ISOMETRIC ESCAPE 2](https://learnaction.netlify.app/isometric-escape-2.html)
- [BUBBLE SHOOTER GO](https://learnaction.netlify.app/bubble-shooter-go.html)
- [CATEGORY MAKEUP CATEGORY](https://learnaction.netlify.app/category-makeup-category.html)
- [GIRL RESCUE DRAGON OUT](https://welearnaction.onrender.com/girl-rescue-dragon-out.html)
- [BLACKRIVER MYSTERY HIDDEN OBJECTS](https://welearnaction.onrender.com/blackriver-mystery-hidden-objects.html)
- [MOVE THE RUBBER BANDS LOGIC PUZZLE](https://learnaction.netlify.app/move-the-rubber-bands-logic-puzzle.html)
- [DOGGO DROP](https://learnaction.netlify.app/doggo-drop.html)
- [CAILLOU CHEF](https://welearnaction.onrender.com/caillou-chef.html)
- [COMBINATIONS DAILY](https://welearnaction.onrender.com/combinations-daily.html)
- [MUTANT ASSASSIN 3D](https://learnaction.netlify.app/mutant-assassin-3d.html)
- [ANTISTRESS RELAXATION BOX](https://welearnaction.onrender.com/antistress-relaxation-box.html)
- [EAT AND GROW FISH](https://welearnaction.onrender.com/eat-and-grow-fish.html)
- [BILLIARD DIAMOND CHALLENGE](https://learnaction.netlify.app/billiard-diamond-challenge.html)
- [THATS NOT MY NEIGHBOR](https://welearnaction.onrender.com/thats-not-my-neighbor.html)
- [ABOUT A FROG](https://welearnaction.onrender.com/about-a-frog.html)
- [BOUNCEPOP QUEST](https://welearnaction.onrender.com/bouncepop-quest.html)
- [FAST BALL JUMP](https://learnaction.netlify.app/fast-ball-jump.html)
- [CATEGORY HERO72](https://learnaction.netlify.app/category-hero72.html)
- [DTA 2 MANIAC](https://learnaction.netlify.app/dta-2-maniac.html)
- [PRIVACY](https://iskillquest.pages.dev/privacy.html)
- [SWEEPER CURLING](https://learnaction.netlify.app/sweeper-curling.html)
- [BRAINROT CLICKER](https://welearnaction.onrender.com/brainrot-clicker.html)
- [CATEGORY MOUSE1 697](https://learnaction.netlify.app/category-mouse1-697.html)
- [POCKET CAR MASTER](https://welearnaction.onrender.com/pocket-car-master.html)
- [BURGER HERE](https://welearnaction.onrender.com/burger-here.html)
- [IDLE BARBER SHOP](https://learnaction.netlify.app/idle-barber-shop.html)
- [FASHION HEROES ACADEMY](https://learnaction.netlify.app/fashion-heroes-academy.html)
- [HIT BALL](https://welearnaction.onrender.com/hit-ball.html)
- [IMAGE CROSSWORD](https://learnaction.netlify.app/image-crossword.html)
- [PRIVACY](https://studyplayings.web.app/privacy.html)
- [BABY PIANO CHILDREN SONG](https://welearnaction.onrender.com/baby-piano-children-song.html)
- [ARROW WAVE](https://learnaction.netlify.app/arrow-wave.html)
- [TERMS](https://iskillplay.web.app/terms.html)
- [NINJA TIME](https://welearnaction.onrender.com/ninja-time.html)
- [CATEGORY FOOTBALL](https://learnaction.netlify.app/category-football.html)
- [DICE PUZZLE](https://welearnaction.onrender.com/dice-puzzle.html)
- [TROPICAL MERGE](https://welearnaction.onrender.com/tropical-merge.html)
- [WOODY HEXA](https://learnaction.netlify.app/woody-hexa.html)
- [CATEGORY MERGE](https://welearnaction.onrender.com/category-merge.html)
- [CATEGORY FARMING87](https://learnaction.netlify.app/category-farming87.html)
- [PET SALON](https://welearnaction.onrender.com/pet-salon.html)
- [SURVIVAL ISLAND EVO](https://welearnaction.onrender.com/survival-island-evo.html)
- [CATEGORY PENALTY16](https://welearnaction.onrender.com/category-penalty16.html)
- [PRIVACY](https://studyplayings.pages.dev/privacy.html)
- [FRUIT PARTY](https://welearnaction.onrender.com/fruit-party.html)
- [HELIX CRUSH](https://welearnaction.onrender.com/helix-crush.html)
- [CHECKERS DRAUGHTS MULTIPLAYER](https://learnaction.netlify.app/checkers-draughts-multiplayer.html)
- [MERGE GALAXY](https://learnaction.netlify.app/merge-galaxy.html)
- [DOGGO DROP](https://welearnaction.onrender.com/doggo-drop.html)
- [SIEGE BREAK](https://welearnaction.onrender.com/siege-break.html)
- [INDEX21](https://welearnaction.onrender.com/index21.html)
- [SAND BLAST](https://welearnaction.onrender.com/sand-blast.html)
- [TANKS RACE FOR SURVIVAL](https://learnaction.netlify.app/tanks-race-for-survival.html)
- [SPACE SHOOTER SPEED TYPING CHALLENGE](https://welearnaction.onrender.com/space-shooter-speed-typing-challenge.html)
- [MAGIC SOLITAIRE](https://welearnaction.onrender.com/magic-solitaire.html)
- [SUPER ROCK CLIMBER](https://learnaction.netlify.app/super-rock-climber.html)
- [SQUARE WORLD 3D](https://welearnaction.onrender.com/square-world-3d.html)
- [TERMS](https://ilearnworldpt.pages.dev/terms.html)
- [ZIP ZAP](https://learnaction.netlify.app/zip-zap.html)
- [CATEGORY MAGIC46](https://learnaction.github.io/category-magic46.html)
- [CATEGORY MERGE](https://learnaction.netlify.app/category-merge.html)
- [SITEMAP](https://themindplay.github.io/sitemap.html)
- [INDEX14](https://learnaction.github.io/index14.html)
- [GEAR WARS](https://learnaction.netlify.app/gear-wars.html)
- [HIDE AND BUILD A BRIDGE](https://learnaction.netlify.app/hide-and-build-a-bridge.html)
- [HOTEL FEVER TYCOON](https://welearnaction.onrender.com/hotel-fever-tycoon.html)
- [SUPER NINJA BALLOON](https://welearnaction.onrender.com/super-ninja-balloon.html)
- [CATEGORY FPS GAMES](https://learnaction.netlify.app/category-fps-games.html)
- [MAHJONG TILE CLUB](https://welearnaction.onrender.com/mahjong-tile-club.html)
- [CATEGORY BUILDING182](https://learnaction.netlify.app/category-building182.html)
- [DREAMY HOME](https://learnaction.netlify.app/dreamy-home.html)
- [RAGDOLL JUMP](https://welearnaction.onrender.com/ragdoll-jump.html)
- [CATEGORY DEEP IMMERSIVE24](https://welearnaction.onrender.com/category-deep-immersive24.html)
- [CATEGORY DRESS UP](https://learnaction.netlify.app/category-dress-up.html)
- [PETS VS BEES](https://welearnaction.onrender.com/pets-vs-bees.html)
- [STYLISH NAIL ART](https://welearnaction.onrender.com/stylish-nail-art.html)
- [GEM DEEP DIGGER](https://welearnaction.onrender.com/gem-deep-digger.html)
- [GROW WARSIO](https://welearnaction.onrender.com/grow-warsio.html)
- [FAT CAT LIFE](https://learnaction.netlify.app/fat-cat-life.html)
- [BLOCK MINE FUSE TNT](https://welearnaction.onrender.com/block-mine-fuse-tnt.html)
- [ASMR BEAUTY TREATMENT](https://welearnaction.onrender.com/asmr-beauty-treatment.html)
- [SNAKE OUT](https://learnaction.netlify.app/snake-out.html)
- [SLINGSHOT MASTER](https://learnaction.netlify.app/slingshot-master.html)
- [CARS MERGE](https://welearnaction.onrender.com/cars-merge.html)
- [SITEMAP](https://themindzone.pages.dev/sitemap.html)
- [INDEX18](https://learnaction.netlify.app/index18.html)
- [BEAUTY WORLD AND FASHION STYLIST](https://learnaction.netlify.app/beauty-world-and-fashion-stylist.html)
- [OPENGUESSR](https://learnaction.netlify.app/openguessr.html)
- [VSCO GIRL AESTHETIC](https://learnaction.netlify.app/vsco-girl-aesthetic.html)
- [CATEGORY IDLE448](https://learnaction.netlify.app/category-idle448.html)
- [SHAPE SHIFTING](https://welearnaction.onrender.com/shape-shifting.html)
- [CATEGORY AGILITY](https://learnaction.github.io/category-agility.html)
- [CANNONS BLAST 3D](https://welearnaction.onrender.com/cannons-blast-3d.html)
- [COLOR SAND PUZZLE](https://welearnaction.onrender.com/color-sand-puzzle.html)
- [CATEGORY ADVENTURE 3](https://learnaction.netlify.app/category-adventure-3.html)
- [WAVE DASH GEOMETRY ARROW](https://learnaction.netlify.app/wave-dash-geometry-arrow.html)
- [CAKE LINK MASTER](https://learnaction.netlify.app/cake-link-master.html)
- [TERMS](https://themindplay.pages.dev/terms.html)
- [CATEGORY ESCAPE 2](https://welearnaction.onrender.com/category-escape-2.html)
- [CATEGORY CLASSIC98](https://welearnaction.onrender.com/category-classic98.html)
- [CATEGORY BRAIN260](https://learnaction.github.io/category-brain260.html)
- [IDLE SUPERMARKET TYCOON](https://welearnaction.onrender.com/idle-supermarket-tycoon.html)
- [INDEX6](https://welearnaction.onrender.com/index6.html)
- [PRIVACY](https://thcskq.github.io/privacy.html)
- [VISUAL MEMORY DRAG DROP](https://learnaction.netlify.app/visual-memory-drag-drop.html)
- [CHEERFUL PLUMBER](https://learnaction.netlify.app/cheerful-plumber.html)
- [CATEGORY FPS 2](https://learnaction.netlify.app/category-fps-2.html)
- [PUSHIO](https://welearnaction.onrender.com/pushio.html)
- [ARCHER LEGEND](https://learnaction.netlify.app/archer-legend.html)
- [SPACE SHIFT](https://welearnaction.onrender.com/space-shift.html)
- [CATEGORY CASUAL 3](https://welearnaction.onrender.com/category-casual-3.html)
- [MONSTER ARENA](https://learnaction.netlify.app/monster-arena.html)
- [ONLINE PORTAL](https://ilearnworlds.web.app/)
- [CATEGORY FPS](https://welearnaction.onrender.com/category-fps.html)
- [CONTACT](https://learnaction.github.io/contact.html)
- [BLOCK PUZZLE KING](https://welearnaction.onrender.com/block-puzzle-king.html)
- [TERMS](https://learnquester.pages.dev/terms.html)
- [CATEGORY IDLE448](https://learnaction.github.io/category-idle448.html)
- [GUESS WORD](https://welearnaction.onrender.com/guess-word.html)
- [CATEGORY BATTLE523](https://learnaction.github.io/category-battle523.html)
- [BOLT CLIMB TAP TO THE TOP](https://welearnaction.onrender.com/bolt-climb-tap-to-the-top.html)
- [CATEGORY CONTROLLER](https://welearnaction.onrender.com/category-controller.html)
- [GUINEA PIGGY MATCHING](https://welearnaction.onrender.com/guinea-piggy-matching.html)
- [ONLINE PORTAL](https://ilearnworldpt.pages.dev/)
- [ONLINE PORTAL](https://learnquesters.pages.dev/)
