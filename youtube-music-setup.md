# YouTube Music Desktop App - Setup Briefing

## The Problem

- Using YouTube Music in Firefox on a multi-virtual-desktop setup (6th or 8th desktop)
- To play/pause music, need to traverse back to that desktop and click buttons
- When Firefox gets bloated and needs to be closed/restarted, music dies with it

## The Solution

**th-ch/youtube-music** — a standalone desktop app that wraps YouTube Music with a plugin system.

GitHub: https://github.com/th-ch/youtube-music

### Why This Solves the Problems

1. **Global media keys** — play/pause/next/previous work from ANY virtual desktop, no need to switch
2. **Windows taskbar media controls** — system-level media overlay works with it
3. **Independent process** — not tied to Firefox. Close Firefox all you want, music keeps playing

## What It Is

- An **Electron app** (TypeScript + Electron)
- Wraps YouTube Music in a standalone desktop window
- Has a **plugin architecture** with many built-in plugins
- Fully **open source** — can be forked and modified
- Supports custom CSS theming

## Key Features

- Global hotkeys (play/pause/skip from anywhere)
- Built-in ad blocker
- SponsorBlock (auto-skip non-music parts)
- Picture-in-picture mode
- Precise volume control
- Custom themes via CSS
- Plugin system for extensibility

## Installation

```bash
winget install th-ch.youtube-music
```

Alternative: download installer from GitHub releases page.

## Custom Features Added

The app has been forked at [EmreSoyak/pear-desktop](https://github.com/EmreSoyak/pear-desktop) with custom features:

- **Audio-Only Mode** — no video streaming, saves ~300MB RAM
- **Playback Recovery** — auto-recovers from stuck/stalled playback
- **Virtual Desktop Awareness** — tray click brings window to current desktop
- **Tray Hover Mini-Player** — hover the tray icon for quick album art + controls

All features are opt-in. See `EMRE-FEATURES.md` for full docs.
PR submitted upstream: pear-devs/pear-desktop#4428
