# Independent Audio Monitoring prototype

This experimental plugin copies PCM from Pear's Web Audio source before applying a separate local listening gain. External applications can receive music while controlling local listening volume independently, including local silence. It has no dependency on a game, account-sharing service or external audio driver.

Development branch: `feat/independent-audio-monitoring` in `Vlastrix/pear-desktop`. The plugin is disabled by default. This is a feasibility prototype for draft review, not an accepted upstream feature or a supported public release.

Upstream proposal: [draft pull request #4767](https://github.com/pear-devs/pear-desktop/pull/4767). It requests design feedback; it is not ready to merge.

## Implementation

- `src/plugins/independent-audio/graph.ts` branches the existing media source into an AudioWorklet capture path and a separate local GainNode. The capture worklet emits 20 ms frames of 48 kHz stereo signed 16-bit PCM. Local gain does not modify those samples.
- `backend.ts` exposes one authenticated client connection on an OS-assigned IPv4 loopback port. In-flight Electron requests and socket buffering are bounded; late data is dropped instead of accumulating indefinitely.
- `index.ts` integrates the graph with Pear's plugin lifecycle and validates the sender of renderer IPC. The graph is attached when `peard:audio-can-play` becomes available. Other sample rates are rejected explicitly.

The plugin replaces Pear's direct connection to the destination while enabled. Keep Audio Compressor, Equalizer and other graph-changing plugins disabled during this prototype. Supporting arbitrary plugin combinations and audio-context replacement needs further work.

When an authenticated client's control heartbeat expires or the client disconnects, local monitoring returns to gain 1. Disabling the plugin restores Pear's direct playback route. Gain 1 preserves Pear's own selected volume; it does not set the player's volume slider to 100%.

## Development setup

Use the ordinary repository build requirements and locked dependencies:

```powershell
npx.cmd --yes pnpm@11.21.0 install --frozen-lockfile
npx.cmd --yes pnpm@11.21.0 typecheck
npx.cmd --yes pnpm@11.21.0 build
& node_modules/electron/dist/electron.exe scripts/independent-audio-dev.cjs
```

The optional development launcher uses `.independent-audio-test/dev-profile` for settings, cookies and the instance lock. It does not import or modify an installed Pear profile. Enable **Independent Audio Monitoring** in the Plugins menu, restart this development copy and play a song. Authentication to the music service may require signing in separately in this profile. Do not commit this profile or share its contents.

If the environment defines `ELECTRON_RUN_AS_NODE`, unset it for the Electron child before launching. The development launcher is intended to run in Electron, not in Node's command-line runtime.

## Local diagnostic protocol

While the plugin backend is enabled, `<userData>/independent-audio.json` contains protocol version 1, host `127.0.0.1`, the assigned port and a random 64-character hexadecimal token. The file is removed on normal plugin shutdown. Treat this file as a local credential; do not include it in bug reports.

Connect only to that loopback address and send a UTF-8 JSON line with a `token` field. Only one client is accepted at a time. The authenticated connection receives a JSON line describing the stream:

```json
{ "protocol": 1, "rate": 48000, "channels": 2, "frame_bytes": 3840 }
```

Subsequent server data consists of a four-byte unsigned little-endian payload length followed by 3840 bytes of interleaved stereo PCM (`s16le`). Preserve partial headers and payloads across socket reads. These frames contain Pear's output before local monitoring gain; they do not bypass Pear's own playback volume or mute controls.

The client sends JSON lines such as `{"gain":0.25}` to control local gain between 0 and 1. Send an updated gain at least every 500 ms, even if unchanged. A missing heartbeat for 1500 ms restores gain 1 and disconnects the client. Invalid controls, oversized control buffers and failed authentication close the connection. PCM reception alone is not a control heartbeat. The protocol is experimental and is not an extension of Pear's API Server.

## Automated native checks

```powershell
npx.cmd --yes pnpm@11.21.0 test:independent-audio
```

The current test runner targets Windows, requires Node 24 or later and clears `ELECTRON_RUN_AS_NODE` for its Electron child. The hidden Electron test uses a silent output sink and a synthetic 440 Hz source. It checks actual captured samples and monitor samples at gains 1, 0.25, 0 and 1; it does not play a tone through speakers. It also checks real context-bridge IPC, authenticated localhost delivery, invalid authentication, gain restoration on disconnect/timeout and idempotent shutdown. The numeric report is saved to `.independent-audio-test/result.json`.

The original prototype passed these checks on Windows build 26100 using Electron 42.5.0. Synthetic audio checks are separate from the user validation below. Runtime plugin enable/disable, device changes, reloads and other operating systems remain to be validated.

## User-reported live music validation (October 21, 2026)

The tester followed the development Pear/diagnostic client walkthrough and reported that local listening control works with actual music, including changing songs and pausing playback. Screenshots show local gain at **0%** while the diagnostic receives PCM: one snapshot shows **381 frames / RMS 0.29235**, and another **1325 frames / RMS 0.22105**. These snapshots support capture continuing while local listening is silenced; the different RMS levels reflect different moments in the music, not a controlled amplitude comparison.

This is user-reported live-music evidence, in addition to the automated synthetic checks. It does not establish game integration, remote listener reception, behavior on other machines, long-session stability or all lifecycle cases. Explicit client close/reopen and plugin disable/re-enable checks remain on the validation checklist.

## Before marking the draft ready for review

- Extend the successful live-music test with explicit client reconnect, cleanup and longer-session checks.
- Agree on a general-purpose integration surface and authentication model with maintainers before promising compatibility to external clients.
- Resolve audio graph interactions, sample-rate handling, user-facing controls, translations and platform support.
- Keep the contribution focused on audio capture and local monitoring; external integrations belong in their own applications.

The current fork exists to make this work reviewable. Inclusion in official Pear and its release schedule remain maintainers' decisions.
