# Emre's YouTube Music Player - Custom Features

A collection of custom features and enhancements for [th-ch/youtube-music](https://github.com/th-ch/youtube-music), focused on virtual desktop workflows, memory optimization, playback reliability, and tray UX improvements.

---

## Table of Contents

1. [Audio-Only Mode](#1-audio-only-mode) (Plugin)
2. [Playback Recovery](#2-playback-recovery) (Plugin)
3. [Virtual Desktop Awareness](#3-virtual-desktop-awareness) (Core setting)
4. [Tray Hover Mini-Player](#4-tray-hover-mini-player) (Notification plugin extension)
5. [DevTools Control](#5-devtools-control) (Core tweak)
6. [Diagnostic Tools](#6-diagnostic-tools) (External scripts)
7. [Build & Launch Scripts](#7-build--launch-scripts)

---

## 1. Audio-Only Mode

**Type:** Plugin
**Location:** `src/plugins/audio-only/index.ts`
**Toggle:** Settings > Plugins > Audio Only (requires restart)
**Default:** Off

### What it does

Forces YouTube Music to stream audio only, eliminating video decoding and buffering entirely. This cuts memory usage by roughly 300+ MB.

### How it works

1. Sets `playback-mode="ATV_PREFERRED"` on the `ytmusic-player` element (tells YouTube this is an audio-only device)
2. Calls `moviePlayer.setPlaybackQuality('tiny')` and `setPlaybackQualityRange('tiny')` via the internal player API
3. Hides the `<video>` element and the `#song-video` container, forces album art (`#song-image`) visible
4. Uses a `MutationObserver` to lock the `playback-mode` attribute — YouTube periodically tries to flip it back to `OMV_PREFERRED`; this prevents that
5. Re-applies on every song change via the `videodatachange` event

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable audio-only mode |

---

## 2. Playback Recovery

**Type:** Plugin
**Location:** `src/plugins/playback-recovery/index.ts`
**Toggle:** Settings > Plugins > Playback Recovery
**Default:** Off

### What it does

Automatically detects and recovers from stuck, stalled, or dead playback states. When YouTube Music's player freezes (which happens regularly), this plugin intervenes without user action.

### How it works

**Watchdog (runs every 3 seconds):**
- Checks if `readyState === 0` while the player reports "playing" (completely dead)
- Checks if `currentTime` hasn't advanced while not paused (frozen playback)
- Checks if buffered data is exhausted while playing

**Media event hooks:**
- `error` — immediate recovery attempt on media errors
- `stalled` — waits for the stall timeout, then recovers if unresolved
- `waiting` — monitors if buffering persists too long
- `timeupdate` — tracks healthy playback (resets failure counters)

**MutationObserver:**
- Watches for the `<video>` element being removed and recreated by YouTube's player
- Re-attaches recovery hooks to the new element automatically

**Recovery strategies (progressive):**
1. **Seek to current position** (attempts 1-2) — forces buffer reload
2. **Seek forward 1 second** (attempts 3-4) — gets past potentially corrupt segments
3. **Skip to next track** (after max retries) — gives up on the current song

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable playback recovery |
| `stallTimeoutMs` | number | `8000` | Milliseconds before a stall triggers recovery |
| `maxRetries` | number | `5` | Max recovery attempts before skipping the track |
| `logToConsole` | boolean | `true` | Log recovery events to the DevTools console |

### Menu

- **Log recovery events to console** (checkbox) — under the plugin's settings

---

## 3. Virtual Desktop Awareness

**Type:** Core setting (not a plugin)
**Location:** `src/window-utils.ts`, `src/tray.ts`, `src/index.ts`
**Toggle:** Options > Tray > "Move to current virtual desktop on show"
**Default:** Off

### What it does

When enabled, clicking the tray icon (or launching a second instance) **moves the YouTube Music window to your current virtual desktop** instead of yanking you back to the desktop where the window originally opened.

### How it works

Uses Electron's `setVisibleOnAllWorkspaces` API:
1. `win.setVisibleOnAllWorkspaces(true)` — temporarily pins the window to all desktops (makes it appear on the current one)
2. `win.show()` — shows and focuses the window
3. `win.setVisibleOnAllWorkspaces(false)` — unpins it, leaving it on the current desktop

**Applied at 3 call sites:**
- Tray icon single-click (show window)
- Tray right-click menu > "Show"
- Second-instance handler (when you double-click the app shortcut while it's already running)

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `options.trayMoveToCurrentDesktop` | boolean | `false` | Move window to current virtual desktop on show |

---

## 4. Tray Hover Mini-Player

**Type:** Notification plugin extension
**Location:** `src/plugins/notifications/hover-popup.ts`, `assets/hover-popup.html`
**Toggle:** Notifications plugin > Interactive Settings > "Show mini-player on tray hover"
**Default:** Off
**Prerequisite:** Notifications plugin must be enabled

### What it does

When you hover over the YouTube Music tray icon, a compact floating mini-player appears showing the current song's album art, title, artist, and playback controls (previous / play-pause / next). The popup stays visible as long as your mouse is on the tray icon or on the popup itself, then fades out when you move away.

This solves the problem of YouTube Music's native toast notifications disappearing after 5 seconds before you can interact with them.

### How it works

**Popup window:**
- Frameless, transparent, always-on-top `BrowserWindow` (380x85 content area)
- Dark theme matching YouTube Music's aesthetic (#282828 background)
- Positioned above the tray icon, centered
- Uses `setIgnoreMouseEvents(true, { forward: true })` for transparent areas (click-through) and toggles to `setIgnoreMouseEvents(false)` when mouse enters the popup card

**Hover tracking:**
- `tray.on('mouse-move')` detects when the cursor is over the tray icon
- When `mouse-move` stops firing for 300ms, the tray is considered "left"
- The popup's HTML tracks `mouseenter`/`mouseleave` on the card itself
- A 400ms grace period allows moving between tray and popup without dismissing
- Communication between HTML and main process uses `console.log('__IPC__:...')` messages intercepted via `webContents.on('console-message')`

**Song info:**
- Registers its own `registerCallback` for song change events
- Pushes updates to the popup via `webContents.executeJavaScript()`

### Config

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hoverControls` | boolean | `false` | Show mini-player popup on tray hover |

---

## 5. DevTools Control

**Type:** Core tweak
**Location:** `src/index.ts` (line ~315)
**Toggle:** Environment variable `OPEN_DEVTOOLS=1`
**Default:** DevTools do NOT auto-open in dev mode

### What it does

By default in the upstream repo, DevTools auto-open whenever you run in dev mode. This change gates that behind an environment variable so DevTools only open when explicitly requested.

### How to use

- **Normal dev mode:** `pnpm dev` — DevTools stay closed
- **With DevTools:** `OPEN_DEVTOOLS=1 pnpm dev`
- **Manual toggle:** Press `Ctrl+Shift+I` at any time in the running app

---

## 6. Diagnostic Tools

External scripts for debugging playback issues without modifying the app's source code. These connect via Chrome DevTools Protocol (CDP) when the app is launched with `--remote-debugging-port=9222`.

### monitor.cjs

**Location:** `monitor.cjs` (root)
**Purpose:** Real-time playback diagnostics

Connects to the running app via CDP and monitors:
- All media events (play, pause, error, stalled, waiting, ended, etc.)
- Flicker detection (rapid play/pause cycling)
- Video element recreation
- "Are you still listening?" popup detection
- Network failures on media resources
- ReadyState drops and buffer exhaustion

Output is color-coded with tags: `INFO`, `PLAY`, `PAUSE`, `WARN`, `ERROR`, `EVENT`, `DIALOG`, `NET`, `CONSOLE`.

**Usage:** `node monitor.cjs` (while app runs with debug port)

### inject-lightweight.cjs

**Location:** `inject-lightweight.cjs` (root)
**Purpose:** Runtime audio-only injection (non-permanent alternative to the Audio-Only plugin)

Injects via CDP to:
1. Block 68+ video stream URLs (itag 13-702) from googlevideo.com using `Network.setBlockedURLs`
2. Intercept `fetch()` calls and return 204 for video MIME types
3. Force `playback-mode="ATV_PREFERRED"`
4. Hide video element, show album art
5. Run periodic buffer monitoring (logs every 30s)

**Usage:** `node inject-lightweight.cjs` (while app runs with debug port)

> **Note:** The Audio-Only plugin (feature #1) is the permanent, built-in version of this. Use `inject-lightweight.cjs` only for one-off testing without rebuilding.

---

## 7. Build & Launch Scripts

### build.bat

**Location:** `build.bat` (root)

One-click rebuild: `pnpm clean` > `pnpm build` > `pnpm electron-builder --win dir:x64 -p never`

Output: `pack\win-unpacked\YouTube Music.exe`

### start.bat

**Location:** `start.bat` (root)

Launches the built exe from `pack\win-unpacked\YouTube Music.exe`.

### diagnose.bat

**Location:** `diagnose.bat` (root)

Launches the app with `--remote-debugging-port=9222` and starts `monitor.cjs` for live playback diagnostics.

### Icon & Shortcut Scripts

| Script | Purpose |
|--------|---------|
| `make-icon.ps1` | Converts `assets/icon.png` to `icon.ico` (multi-size) |
| `update-shortcut.ps1` | Creates/updates desktop shortcut pointing to the built exe with the custom icon |
| `pin-shortcut.ps1` | Old dev-mode shortcut script (obsolete) |

---

## File Map

All custom files at a glance:

```
z_youtube_player/
  EMRE-FEATURES.md              <- This file
  build.bat                      <- Build script
  start.bat                      <- Launch script
  diagnose.bat                   <- Debug launcher
  monitor.cjs                    <- CDP playback monitor
  inject-lightweight.cjs         <- CDP audio-only injector
  icon.ico                       <- Custom app icon
  make-icon.ps1                  <- Icon generator
  update-shortcut.ps1            <- Shortcut updater
  pin-shortcut.ps1               <- (obsolete)
  assets/
    hover-popup.html             <- Tray hover mini-player UI
  src/
    window-utils.ts              <- Virtual desktop helper
    plugins/
      audio-only/
        index.ts                 <- Audio-Only plugin
      playback-recovery/
        index.ts                 <- Playback Recovery plugin
      notifications/
        hover-popup.ts           <- Tray hover mini-player logic
  Modified core files:
    src/index.ts                 <- DevTools gate + virtual desktop
    src/tray.ts                  <- Virtual desktop + mouse-move support
    src/config/defaults.ts       <- trayMoveToCurrentDesktop option
    src/menu.ts                  <- Virtual desktop menu item
    src/i18n/resources/en.json   <- All new labels
    src/plugins/notifications/
      index.ts                   <- hoverControls config
      main.ts                    <- Hover popup wiring
      menu.ts                    <- Hover controls menu item
```

---

## Feature Status Summary

| # | Feature | Type | Toggle | Default |
|---|---------|------|--------|---------|
| 1 | Audio-Only Mode | Plugin | Plugin settings | Off |
| 2 | Playback Recovery | Plugin | Plugin settings | Off |
| 3 | Virtual Desktop Awareness | Core setting | Options > Tray | Off |
| 4 | Tray Hover Mini-Player | Plugin extension | Notifications > Interactive Settings | Off |
| 5 | DevTools Control | Core tweak | `OPEN_DEVTOOLS=1` env var | Off |
| 6 | Diagnostic Tools | External scripts | Run manually | N/A |
| 7 | Build Scripts | External scripts | Run manually | N/A |
