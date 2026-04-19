# Feature Pack: Desktop Workflow Enhancements

A set of four opt-in features for power users who run YouTube Music as a background audio companion on desktop — particularly those who use virtual desktops, minimize to tray, and want quick playback control without opening the full window.

Every feature defaults to **off** and is toggled from the existing settings/plugin menu. No existing behavior is changed unless the user explicitly enables a feature.

---

## 1. Audio-Only Mode

**Plugin** | Settings > Plugins > Audio Only | Requires restart

### The problem

YouTube Music streams video even when the window is minimized or hidden in the tray. On a desktop app used purely for music, this wastes ~300 MB of RAM on video decoding and buffering that nobody is watching.

### The solution

A renderer plugin that forces YouTube Music into its audio-only playback path — the same mode the mobile app uses on audio-only plans. Video decoding stops entirely, album art is shown instead, and memory usage drops significantly.

### How it works

- Sets `playback-mode="ATV_PREFERRED"` on the player element, telling YouTube's player this is an audio-only surface
- Calls `setPlaybackQuality('tiny')` via the internal player API to prevent video stream selection
- Hides the `<video>` element and shows album art (`#song-image`) instead
- A `MutationObserver` locks the `playback-mode` attribute — YouTube periodically tries to flip it back to video mode; this prevents that
- Re-applies on every song change via the `videodatachange` event

### Files

| File | Role |
|------|------|
| `src/plugins/audio-only/index.ts` | Full plugin (renderer-side) |

---

## 2. Playback Recovery

**Plugin** | Settings > Plugins > Playback Recovery

### The problem

YouTube Music's web player occasionally enters a stuck state — the progress bar stops, audio cuts out, but the UI still shows "playing." This happens more frequently during long listening sessions, on flaky connections, or after the system wakes from sleep. The only fix is to manually skip the track or reload the app.

### The solution

A watchdog plugin that monitors the `<video>` element's health every 3 seconds and applies progressive recovery strategies when playback stalls. It handles dead playback, frozen progress, buffer exhaustion, media errors, and stream stalls — all without user intervention.

### How it works

**Detection (watchdog runs every 3 seconds):**

| Condition | Meaning |
|-----------|---------|
| `readyState === 0` while player state is "playing" | Completely dead — no media data loaded |
| `currentTime` not advancing while not paused | Frozen — player thinks it's playing but nothing moves |
| Buffer end <= current time while `readyState < 3` | Buffer exhausted — nothing left to play |

**Recovery strategies (progressive):**

| Attempt | Strategy | What it does |
|---------|----------|-------------|
| 1-2 | Seek to current position | Forces the player to re-request the current buffer segment |
| 3-4 | Seek forward 1 second | Jumps past a potentially corrupt segment |
| 5+ | Skip to next track | Gives up on the current song and moves on |

**Event hooks:** Also listens for `error`, `stalled`, and `waiting` events for immediate detection. A `MutationObserver` watches for the `<video>` element being destroyed and recreated by YouTube's player, automatically re-attaching hooks to the new element.

### Config

| Option | Default | Description |
|--------|---------|-------------|
| `stallTimeoutMs` | `8000` | How long to wait before a stall triggers recovery |
| `maxRetries` | `5` | Max recovery attempts before skipping to next track |
| `logToConsole` | `true` | Log recovery events to DevTools console for debugging |

### Files

| File | Role |
|------|------|
| `src/plugins/playback-recovery/index.ts` | Full plugin (renderer-side, watchdog + event hooks) |

---

## 3. Virtual Desktop Awareness

**Core setting** | Options > Tray > "Move to current virtual desktop on show"

### The problem

On Windows 10/11 (and macOS/Linux with workspaces), if YouTube Music is open on Desktop 1 and you're working on Desktop 3, clicking the tray icon or launching a second instance **yanks you back to Desktop 1** instead of bringing the window to you. This breaks the flow for anyone who uses virtual desktops to organize their work.

### The solution

When this setting is enabled, showing the YouTube Music window — whether by tray click, the "Show" context menu, or launching a second instance — **moves the window to your current desktop** instead of switching desktops.

### How it works

Uses Electron's `setVisibleOnAllWorkspaces` API with a pin/unpin technique:

```
win.setVisibleOnAllWorkspaces(true)   // Pin to all desktops (appears on current)
win.show()                             // Show and focus
win.setVisibleOnAllWorkspaces(false)  // Unpin (stays on current desktop)
```

Applied at all 3 places where the window is shown:
1. Tray icon click (show window)
2. Tray right-click > "Show" menu item
3. Second-instance handler (launching the app while it's already running)

Cross-platform: works on Windows virtual desktops, macOS Spaces, and Linux workspaces.

### Files

| File | Role |
|------|------|
| `src/window-utils.ts` | `showOnCurrentDesktop()` helper (new file) |
| `src/tray.ts` | Uses helper in click + "Show" menu handlers |
| `src/index.ts` | Uses helper in second-instance handler |
| `src/config/defaults.ts` | `trayMoveToCurrentDesktop` option |
| `src/menu.ts` | Toggle in Options > Tray submenu |

---

## 4. Tray Hover Mini-Player

**Notification plugin extension** | Interactive Settings > "Show mini-player on tray hover"

### The problem

The existing interactive toast notification shows song info and controls when a song changes, but it auto-dismisses after 5 seconds. If you miss it or want to skip a track 30 seconds later, your only options are:

- **Double-click the tray icon** — opens the full window (overkill for just pressing "next")
- **Right-click the tray** — opens a basic text menu (functional but no album art, no visual feedback)

There's no quick, on-demand way to see what's playing and control it without opening the full app.

### The solution

Hovering over the tray icon shows a compact floating mini-player with album art, song title, artist, and previous/play-pause/next buttons. It stays visible as long as your mouse is on the tray icon or the popup, and fades out when you move away.

This gives users three tiers of tray interaction:
1. **Hover** — Quick glance + controls via the mini-player
2. **Single click** — Toggle the toast notification (existing behavior)
3. **Double click** — Open the full window (existing behavior)

### How it works

**Popup window:**
- Frameless, transparent, always-on-top `BrowserWindow` positioned above the tray icon
- Dark theme (#282828) matching YouTube Music's aesthetic
- Shows album art (56x56), song title, artist, and SVG icon buttons

**Hover tracking (main process cursor polling):**
- `tray.on('mouse-move')` triggers the popup to appear
- A 150ms `setInterval` polls `screen.getCursorScreenPoint()` and checks if the cursor is over the popup bounds or the tray icon bounds
- If the cursor is on neither for a full cycle, the popup fades out
- This approach is more reliable on Windows than HTML-based mouseenter/mouseleave events

**Button clicks (`document.title` IPC):**
- Buttons use `onmousedown` (fires before window activation) and set `document.title` to signal the action
- Main process listens via `BrowserWindow.on('page-title-updated')` — reliable regardless of window focus state
- A counter is appended to ensure repeated clicks on the same button always trigger

**Toast suppression:**
- When the hover popup is visible, the interactive toast notification is suppressed to prevent both from appearing simultaneously
- The popup exports `isHoverPopupVisible()` which `interactive.ts` checks before showing a toast

### Infrastructure fix: Deferred tray event handlers

Plugins load (`loadAllMainPlugins`) before the tray is created (`setUpTray`). Any `setTrayOnClick`, `setTrayOnDoubleClick`, or `setTrayOnMouseMove` calls from plugins were silently dropped because the tray didn't exist yet.

Fixed by queuing handlers registered before the tray exists and applying them at the end of `setUpTray`. This fix also benefits the existing notification plugin's `trayControls` feature, which had the same latent timing bug.

### Files

| File | Role |
|------|------|
| `src/plugins/notifications/hover-popup.ts` | Popup window management, cursor tracking, IPC (new file) |
| `assets/hover-popup.html` | Mini-player UI: HTML, CSS, button handlers (new file) |
| `src/plugins/notifications/index.ts` | `hoverControls` config option |
| `src/plugins/notifications/main.ts` | Wires up `setupHoverPopup()` |
| `src/plugins/notifications/menu.ts` | Menu toggle |
| `src/plugins/notifications/interactive.ts` | Toast suppression check |
| `src/tray.ts` | `setTrayOnMouseMove()`, `getTrayBounds()`, deferred handler queue |

---

## Summary

| Feature | Type | Toggle | Default | Platform |
|---------|------|--------|---------|----------|
| Audio-Only Mode | Plugin | Plugin settings | Off | All |
| Playback Recovery | Plugin | Plugin settings | Off | All |
| Virtual Desktop Awareness | Core setting | Options > Tray | Off | Windows, macOS, Linux |
| Tray Hover Mini-Player | Plugin extension | Notifications > Interactive Settings | Off | Windows, macOS |

All features are:
- **Opt-in** — disabled by default, no impact on existing users
- **Independent** — can be enabled in any combination
- **Consistent** — follow existing plugin/config/menu/i18n patterns
- **Reversible** — toggle off and restart to fully revert
