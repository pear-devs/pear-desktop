# YouTube Music Desktop App - Setup Notes

## What This Is
A standalone YouTube Music desktop app built from [th-ch/youtube-music](https://github.com/th-ch/youtube-music), cloned locally so we can edit and customize it. It runs via Electron and lives in the Windows system tray.

**Fork:** [EmreSoyak/pear-desktop](https://github.com/EmreSoyak/pear-desktop) (branch: `emre/custom-features`)
**Upstream PR:** https://github.com/pear-devs/pear-desktop/pull/4428

## Setup History

### Session 1 — Initial Setup
- Cloned `https://github.com/th-ch/youtube-music.git` into `Z:\z_youtube_player`
- Installed Node.js 22 + pnpm + all dependencies (975 packages)
- Created multi-size `icon.ico` from `assets/icon.png` using Python Pillow
- Disabled auto DevTools in dev mode (`src/index.ts` line ~314)

### Session 2 — Production Build
- Switched from `pnpm dev` to compiled production build to fix:
  - Player dying when terminal session ends (child process issue)
  - Visible CMD window with dev logs
- Built with `electron-builder` → `pack\win-unpacked\YouTube Music.exe`
- Created `build.bat`, `start.bat`, desktop shortcut

### Session 3 — Diagnostics & Lightweight Mode
- Built `monitor.cjs` — CDP-based playback diagnostic tool
- Built `inject-lightweight.cjs` — runtime audio-only injection via CDP
- Discovered YouTube streams video even when hidden (~300MB wasted RAM)
- Created `diagnose.bat` for debug-mode launches

### Session 4 — Custom Features & Upstream PR (2026-04-15)

Built four new features, all opt-in with on/off toggles:

1. **Audio-Only Mode** (`src/plugins/audio-only/`) — permanent built-in version of inject-lightweight.cjs. Forces `ATV_PREFERRED` playback mode, locks it with MutationObserver, hides video element. Saves ~300MB RAM.

2. **Playback Recovery** (`src/plugins/playback-recovery/`) — watchdog that monitors video element health every 3 seconds. Detects dead playback, frozen progress, buffer exhaustion, media errors, and stream stalls. Progressive recovery: seek → seek-forward → skip to next track.

3. **Virtual Desktop Awareness** (`src/window-utils.ts` + tray/index changes) — clicking the tray icon moves the window to your current virtual desktop instead of yanking you back. Uses `setVisibleOnAllWorkspaces` pin/unpin technique. Toggle under Options > Tray.

4. **Tray Hover Mini-Player** (`src/plugins/notifications/hover-popup.ts` + `assets/hover-popup.html`) — hover the tray icon to see a floating dark-themed popup with album art, song info, and prev/play-pause/next buttons. Stays visible while mouse is on it (cursor polling at 150ms). Button clicks via `document.title` IPC + `page-title-updated` event. Suppresses toast notifications while visible.

**Key bugs fixed during development:**
- **Plugin-before-tray timing:** Plugins load before tray is created, so `setTrayOnMouseMove` was silently dropped. Fixed by queuing handlers and applying after tray creation.
- **Unfocused window events on Windows:** `focusable: false` kills JS events. `console.log` IPC unreliable from unfocused windows. `onclick` swallowed by window activation. Solutions: removed `focusable: false`, switched to `onmousedown` + `document.title` IPC, cursor polling for hover detection.

**Pushed to GitHub:**
- Forked to `EmreSoyak/pear-desktop`
- Branch: `emre/custom-features`
- PR opened: pear-devs/pear-desktop#4428
- Full documentation in `EMRE-FEATURES.md`

## How to Make Changes (Edit -> Build -> Launch)

1. **Edit source code** in `Z:\z_youtube_player\src\` (or plugins, assets, etc.)
2. **Run `build.bat`** — cleans, builds, and packages the exe
3. **Launch** via the desktop shortcut or `start.bat`

## Tray Support
Already built into the app. Enable via the app menu:
- **Options > Tray > "Enabled and hide app"**
- This makes the app minimize to system tray when closed
- Right-click tray icon for play/pause/next/previous/quit controls

## Common Commands
```bash
# Rebuild the app (or just double-click build.bat)
pnpm clean && pnpm build && pnpm electron-builder --win dir:x64 -p never

# Launch the built app (or just double-click start.bat)
start "" "pack\win-unpacked\YouTube Music.exe"

# Launch in dev mode with hot-reload (for active development)
pnpm dev

# Launch dev mode with DevTools
OPEN_DEVTOOLS=1 pnpm dev
```

## Key Files
- `build.bat` — one-click rebuild script (clean -> build -> package)
- `start.bat` — launches the built exe from `pack\win-unpacked\`
- `update-shortcut.ps1` — recreates the desktop shortcut pointing to the built exe
- `icon.ico` — custom app icon
- `EMRE-FEATURES.md` — full documentation of all custom features
- `src/index.ts` — main Electron entry point (DevTools patch is here)

## Tech Stack
- **Electron** + **electron-vite** + **electron-builder**
- **pnpm** package manager
- **SolidJS** for renderer UI
- **TypeScript** throughout
- 42+ plugins available (ad blocker, sponsorblock, Discord RPC, etc.)
