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
  settings (<kbd>Ctrl</kbd>+<kbd>,</kbd> or *Settings* in the sidebar) without
  restarting. The same settings open in their own window from the tray or with
  `pear --settings`, even when YTM doesn't load.
- **Built-in API server** (off by default): the pear-desktop v1 REST + WebSocket
  API for remotes and overlays, plus RPC methods that plugins expose with
  `host.rpc` (validated with valibot, documented at `/swagger`).

## Plugins

| id | name | what it does |
|---|---|---|
| `album-actions` | Album actions | Like or dislike every track of an album or playlist at once. |
| `album-color-theme` | Album color theme | Tints the interface with the colors of the current track's artwork. |
| `ambient-mode` | Ambient mode | Surrounds the video or cover art with a soft glow of its own colors. |
| `amuse` | Amuse | Show the current song in the Amuse now-playing widget by 6K Labs. |
| `audio-compressor` | Audio compressor | Evens out loud and quiet parts with a dynamics compressor. |
| `auth-proxy-adapter` | Proxy | Sends all traffic through an HTTP or SOCKS proxy, including ones that need a username and password. |
| `blur-nav-bar` | Blur navigation bar | Makes the top bar translucent with a blur behind it. |
| `captions-selector` | Captions selector | Pick the captions language from the player bar, and optionally load it automatically. |
| `clock` | Clock | Shows the current time in the top bar. |
| `crossfade` | Crossfade | Fades out the end of a track and fades the next one in. |
| `custom-output-device` | Custom output device | Play through a chosen audio device instead of the system default. |
| `disable-autoplay` | Disable autoplay | Starts every track paused instead of playing it automatically. |
| `discord` | Discord Rich Presence | Show your friends what you're listening to in your Discord status. |
| `do-not-track` | Do Not Track | pear-desktop's ad and tracker blocker: strips ads and tracking data from the player, or filters requests with blocklists, and skips ads that still play. |
| `downloader` | Downloader | Saves songs, albums and playlists as tagged audio files with cover art, using yt-dlp. |
| `equalizer` | Equalizer | A 10-band equalizer with presets. |
| `exponential-volume` | Exponential volume | Makes the volume slider follow loudness perception, giving finer control at low volumes. |
| `in-app-menu` | In-app menu | Replaces the system title bar: the top bar moves the window and holds the app menu. |
| `lumiastream` | Lumia Stream | Let Lumia Stream react to the songs you play. |
| `media-controls` | Media controls | Control playback from your desktop's media widgets and keys (MPRIS). (linux only) |
| `music-together` | Music Together | Listen in sync with friends: host a session, share the code, and everyone hears the same thing. |
| `navigation` | Navigation buttons | Back and forward buttons in the top bar. |
| `notifications` | Notifications | Show a desktop notification when a new song starts. |
| `performance-improvement` | Performance improvement | Lowers CPU use with CY Fung's scripts: batches the page's timers onto animation frames and reuses YTM's list elements. Takes effect after a restart. |
| `picture-in-picture` | Picture in picture | Watch in a small floating window, from the track menu or a hotkey. |
| `playback-speed` | Playback speed | Adds a speed control to the player bar (scroll over it for fine steps). |
| `precise-volume` | Precise volume | Change the volume in fine steps with the scroll wheel or arrow keys, with a volume readout. |
| `quality-changer` | Video quality changer | Adds a quality picker to the top of the video player. |
| `scrobbler` | Scrobbler | Scrobble what you listen to to Last.fm and ListenBrainz. |
| `shortcuts` | Global shortcuts | System-wide keyboard shortcuts that work while the window is in the background. |
| `skip-disliked-songs` | Skip disliked songs | Skips a track as soon as you dislike it, and whenever a disliked track comes up. |
| `skip-silences` | Skip silences | Skips over silent parts of tracks. |
| `sponsorblock` | SponsorBlock | Skips non-music parts of music videos, using segments crowdsourced by SponsorBlock. |
| `synced-lyrics` | Synced lyrics | Time-synced lyrics in the Lyrics tab, with word-by-word highlighting, click-to-seek and romanization. |
| `taskbar-mediacontrol` | Taskbar media controls | Previous, play/pause and next buttons in the window's taskbar thumbnail. (win32 only) |
| `touchbar` | Touch Bar | The current track and playback controls on the MacBook Touch Bar. (darwin only) |
| `transparent-player` | Transparent player | Makes the window see-through, with a blurred material behind it on Windows 11 and macOS. |
| `tray` | Tray icon | Playback controls and the current track in the system tray. |
| `tuna-obs` | Tuna OBS | Show the current song in OBS through the Tuna plugin. |
| `unobtrusive-player` | Unobtrusive player | Starting a song from a list keeps you where you are instead of opening the full player. |
| `video-toggle` | Video toggle | Switch between a track's music video and its cover art, or hide the video entirely. |
| `visualizer` | Visualizer | Shows a music visualizer in place of the album art on the player page. |

Musixmatch lyrics (synced-lyrics) need a Musixmatch user token in the
settings: Musixmatch answers anonymous apps with an all-zero token that only
gets decoy lyrics.

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
nub run dist:linux   # packages with electron-builder into pack/ (also dist:mac, dist:win, dist)
nub run i18n         # adds new English texts to src/i18n/resources/en.json (Weblate's source)
```

`PEAR_USER_DATA=/tmp/profile nub run dev` runs with a separate profile. Without
it, the app uses the same data folder as an installed pear-desktop, so it picks
up that session.

`nub install` also installs a pre-commit hook (`.githooks/`) that keeps the
trademarked app name out of the sources, like pear-desktop always has: it
escapes it in JSON files and rejects plain uses in code and docs (write it as
unicode escapes in strings, or "YTM" in prose). CI checks the same.

## Notes

- Google sign-in sees Electron's honest user agent; YTM sees a Chrome
  one. Never automate sign-in in tests: Google rate-limits the whole IP.
- The EU cookie-consent screen is skipped with the "only essential cookies"
  choice (`SOCS=CAI`) unless you've chosen otherwise.
