import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';

export type SmoothTransitionsPluginConfig = {
  enabled: boolean;
  /**
   * Fade the volume down before pausing and back up when resuming,
   * instead of an abrupt stop/start (like Spotify does).
   *
   * @default true
   */
  fadeOnPause: boolean;
  /**
   * Duration of the pause/resume fade, in milliseconds.
   *
   * @default 250
   */
  pauseFadeDuration: number;
  /**
   * Fade the volume down briefly before switching to the next/previous
   * song (when manually skipping), and back up once the new song starts.
   *
   * @default true
   */
  fadeOnSkip: boolean;
  /**
   * Duration of the skip fade, in milliseconds.
   *
   * @default 200
   */
  skipFadeDuration: number;
};

type Teardown = () => void;

type DebugState = {
  video: HTMLVideoElement | null;
  isFading: boolean;
  pauseFadeToken: number;
  skipFadeToken: number;
  gainReady: boolean;
  disabled: boolean;
};

type AudioCanPlayDetail = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
  /** The element audioSource was created from - see the Compressor type. */
  video: HTMLVideoElement;
};

/**
 * Fades are driven exclusively by a Web Audio GainNode - never by
 * video.volume. This is deliberate: video.volume is a shared property that
 * other plugins can globally reinterpret (e.g. Exponential Volume replaces
 * HTMLMediaElement.prototype.volume's getter/setter with a cubic curve, on
 * every video element, transforming whatever anyone reads or writes there).
 * A GainNode lives one layer below that, in the Web Audio graph, so it's
 * completely unaffected by what any other plugin does to video.volume - the
 * two compose multiplicatively (video.volume x gain) without either needing
 * to know the other exists. Fading video.volume directly, as this plugin
 * used to, meant every fade was silently corrupted by whatever transform
 * another plugin applied to that property.
 *
 * The rest value is always 1 (no attenuation) - fades are relative dips on
 * top of whatever video.volume/other plugins/the user's slider already
 * dictates, never a stored "target volume" that could go stale.
 */
function createGainFader(
  gainNode: GainNode,
  audioContext: AudioContext,
  debug: DebugState,
) {
  let rampTimeout: number | null = null;

  // Gain is linear, but perceived loudness isn't, so a plain
  // linearRampToValueAtTime from 1 to 0 sounds like it stays at full volume
  // for most of the ramp and only drops at the very end (a "delayed cut").
  // The natural fix, exponentialRampToValueAtTime, overcorrects at the
  // short durations used here (~200ms): the spec forbids ramping to/from
  // exactly 0, so the target has to be approximated with a tiny value, and
  // covering that huge dB range (0 to roughly -80dB) in a couple hundred ms
  // dumps nearly all of the audible drop into the first third of the ramp -
  // it sounds like an instant cut followed by inaudible silence, not a
  // fade (measured live: gain reaches -75dB by 30% of the ramp). An
  // equal-power curve (the standard crossfade curve, built from cos/sin of
  // the same angle) spreads the perceived drop evenly across the whole
  // duration in both directions and reaches the target exactly, so no
  // near-zero approximation is needed.
  const CURVE_LENGTH = 32;

  const rampTo = (target: number, durationMs: number, onDone?: () => void) => {
    if (rampTimeout !== null) {
      window.clearTimeout(rampTimeout);
      rampTimeout = null;
    }
    const now = audioContext.currentTime;
    // Read the value first, then cancel: a fade is often re-triggered while
    // a previous curve is still running (spamming play/pause does exactly
    // that), and the new curve has to pick up from wherever the old one had
    // reached.
    //
    // It must be cancelScheduledValues here, NOT cancelAndHoldAtTime.
    // cancelAndHoldAtTime cannot cancel a setValueCurveAtTime that is
    // currently running - it throws NotSupportedError ("setValueCurveAtTime
    // ... overlaps setValueCurveAtTime ...") and the fade dies mid-curve,
    // taking play/pause with it. cancelScheduledValues does remove a curve
    // that spans the cancel time, which is what this needs.
    const startValue = gainNode.gain.value;
    gainNode.gain.cancelScheduledValues(now);
    // setValueCurveAtTime rejects a zero or negative duration, and the fade
    // durations come from stored config, so don't assume they're sane. A
    // floor of 1ms also gives "no fade" the sensible reading: effectively
    // instant, rather than a thrown error that kills play/pause.
    const safeDurationMs =
      Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1;
    const durationSec = safeDurationMs / 1000;
    // The cos/sin pair only stays within its endpoints when one of them is
    // 0. Fading between two non-zero values - resuming to 1 from a pause
    // fade that was interrupted partway, which happens constantly here -
    // bulges past both: 0.8 -> 1 peaks at about 1.28, i.e. gain above unity,
    // which amplifies and can clip. Clamping bounds that without touching
    // the 1 <-> 0 shape, where the curve never leaves its endpoints anyway.
    const lowest = Math.min(startValue, target);
    const highest = Math.max(startValue, target);
    const curve = new Float32Array(CURVE_LENGTH);
    for (let i = 0; i < CURVE_LENGTH; i++) {
      const angle = (i / (CURVE_LENGTH - 1)) * (Math.PI / 2);
      const value =
        (startValue * Math.cos(angle)) + (target * Math.sin(angle));
      curve[i] = Math.min(Math.max(value, lowest), highest);
    }
    gainNode.gain.setValueCurveAtTime(curve, now, durationSec);
    debug.isFading = true;
    rampTimeout = window.setTimeout(() => {
      rampTimeout = null;
      debug.isFading = false;
      onDone?.();
    }, safeDurationMs);
  };

  return {
    get: () => gainNode.gain.value,
    rampTo,
    dispose() {
      if (rampTimeout !== null) {
        window.clearTimeout(rampTimeout);
        rampTimeout = null;
      }
      debug.isFading = false;
    },
  };
}

type GainFader = ReturnType<typeof createGainFader>;

/**
 * Wraps video.pause()/play() directly (not the player API) since the
 * on-screen button and spacebar call the element methods, bypassing the
 * API. Skip buttons are intercepted, faded, then re-clicked with a bypass
 * flag so the app's own navigation logic still runs.
 */
function setupSmoothTransitions(
  video: HTMLVideoElement,
  api: MusicPlayer,
  getConfig: () => SmoothTransitionsPluginConfig | null,
  debug: DebugState,
  fader: GainFader,
): Teardown {
  debug.video = video;

  // --- Pause / resume ---
  const originalVideoPause = video.pause.bind(video);
  const originalVideoPlay = video.play.bind(video);
  let pauseFadeToken = 0;

  // The spec has .pause() flip `paused` to true synchronously, but our
  // fade delays the real pause() call until the fade finishes - so any
  // code reading video.paused right after calling pause() (e.g. the
  // on-screen button's own icon/state logic) would see stale "still
  // playing" for the whole fade. Under rapid clicking that desyncs the
  // button from reality until it stops responding correctly. Shadowing
  // `paused` to report intent immediately keeps external code in sync.
  let intendedPaused = video.paused;
  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => intendedPaused,
  });
  // Tracks whether the video *really* paused (a genuine native 'pause'
  // event fired), independent of `intendedPaused` above - needed because a
  // pause fade can be cancelled by a follow-up play() before its deferred
  // originalVideoPause() ever runs, leaving the element never actually
  // paused even though intendedPaused briefly said otherwise.
  //
  // Seeded from the real state, not `false`: attaching to an
  // already-paused element and then hitting play would otherwise look like
  // that cancelled-fade case, and the synthetic play/playing events below
  // would double up with the real ones originalVideoPlay() fires.
  let realPauseFired = intendedPaused;
  const onNativePause = () => {
    intendedPaused = true;
    realPauseFired = true;
  };
  const onNativePlay = () => {
    intendedPaused = false;
    realPauseFired = false;
  };
  video.addEventListener('pause', onNativePause);
  video.addEventListener('play', onNativePlay);

  // When an output device disappears (e.g. AirPods taken out), audio
  // briefly plays from whatever it falls back to (usually speakers)
  // before this app's own device-change handling pauses it. Fading that
  // pause would only stretch out the window of audio coming from the
  // wrong place, so skip the fade and cut instantly for a pause that
  // follows a device change.
  let recentDeviceChangeUntil = 0;
  const onDeviceChange = () => {
    recentDeviceChangeUntil = performance.now() + 1000;
  };
  navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);

  video.pause = () => {
    const config = getConfig();
    const isDeviceChangePause = performance.now() < recentDeviceChangeUntil;
    if (!config?.fadeOnPause || intendedPaused || isDeviceChangePause) {
      intendedPaused = true;
      return originalVideoPause();
    }

    intendedPaused = true;
    const token = ++pauseFadeToken;
    debug.pauseFadeToken = pauseFadeToken;
    fader.rampTo(0, config.pauseFadeDuration, () => {
      if (token !== pauseFadeToken) return;
      originalVideoPause();
    });
    return undefined;
  };

  video.play = () => {
    const wasIntendedPaused = intendedPaused;
    const wasReallyPaused = realPauseFired;
    intendedPaused = false;
    pauseFadeToken++; // invalidates any in-flight pause fade
    debug.pauseFadeToken = pauseFadeToken;
    // Resync to full whenever gain isn't already there: the pause fade
    // above may have been left running (invalidating it only skips the
    // final pause() call, not the gain animation), so gain could be
    // anywhere between 0 and 1 when play() is called for any reason -
    // but most play() calls (e.g. every normal song advance) don't need
    // this at all, so skip the no-op ramp when gain is already at rest.
    if (fader.get() < 1) {
      const config = getConfig();
      fader.rampTo(1, config?.pauseFadeDuration ?? 250);
    }
    const result = originalVideoPlay();
    // If a pause fade was in flight and got invalidated by this very call
    // before its deferred originalVideoPause() ever ran, the element was
    // never actually paused - calling play() on an already-playing element
    // is a spec-mandated no-op that fires no 'play'/'playing' event. Any
    // outside code that reacted to the earlier pause() call (e.g. the
    // player bar's own button, which flips its icon/title the moment
    // pause() is called, then waits for a real event to confirm resuming)
    // would otherwise be stuck showing "paused" forever despite playback
    // never having stopped - dispatch the events ourselves so it resyncs.
    if (wasIntendedPaused && !wasReallyPaused) {
      video.dispatchEvent(new Event('play'));
      video.dispatchEvent(new Event('playing'));
    }
    return result;
  };

  // Route the higher-level player API through the same patched methods,
  // in case something calls pauseVideo()/playVideo() without going
  // through video.pause()/play() directly.
  const originalApiPauseVideo = api.pauseVideo.bind(api);
  const originalApiPlayVideo = api.playVideo.bind(api);
  api.pauseVideo = () => video.pause();
  api.playVideo = () => video.play();

  // --- Manual song selection / skip (next / previous / playlist clicks) ---
  const skipTeardowns: Teardown[] = [];
  let skipFadeToken = 0;
  let tornDown = false;
  // Held so teardown can cancel it - otherwise it can fire after the plugin
  // is stopped and ramp a fader that has already been disposed.
  let skipSafetyTimer: number | null = null;
  skipTeardowns.push(() => {
    if (skipSafetyTimer !== null) window.clearTimeout(skipSafetyTimer);
    skipSafetyTimer = null;
  });

  // A skip fades out and then relies on the new song's loadstart/play to
  // fade back in. When the action doesn't actually change track - previous
  // at the start of a queue, a media key the app ignores, a click that
  // didn't navigate - none of those fire, and the gain would sit at 0 with
  // playback continuing silently. Restore it if nothing has by then.
  const scheduleFadeRestore = (token: number, durationMs: number) => {
    if (skipSafetyTimer !== null) window.clearTimeout(skipSafetyTimer);
    skipSafetyTimer = window.setTimeout(() => {
      skipSafetyTimer = null;
      if (token === skipFadeToken && fader.get() < 1 && !video.paused) {
        fader.rampTo(1, durationMs);
      }
    }, 300);
  };

  const onSongPlay = () => {
    intendedPaused = false;
    if (fader.get() < 1) {
      const config = getConfig();
      fader.rampTo(
        1,
        config?.skipFadeDuration ?? config?.pauseFadeDuration ?? 200,
      );
    }
  };
  video.addEventListener('play', onSongPlay);
  video.addEventListener('playing', onSongPlay);

  const onLoadStart = () => {
    const config = getConfig();
    if (config?.fadeOnSkip && fader.get() > 0 && !video.paused) {
      fader.rampTo(0, 100);
    }
  };
  video.addEventListener('loadstart', onLoadStart);

  const wrapTrackChange = <A extends unknown[], R>(
    fn?: (...args: A) => R,
  ): ((...args: A) => R | undefined) | undefined => {
    if (!fn) return undefined;
    return (...args: A) => {
      const config = getConfig();
      if (!config?.fadeOnSkip || video.paused || fader.get() <= 0) {
        return fn(...args);
      }

      const token = ++skipFadeToken;
      debug.skipFadeToken = skipFadeToken;
      fader.rampTo(0, config.skipFadeDuration, () => {
        if (token !== skipFadeToken) return;
        fn(...args);
        // previousVideo() at the start of a queue, or loadVideoById() for
        // the track already playing, don't actually change track and so
        // fire nothing to fade back in on.
        scheduleFadeRestore(token, config.skipFadeDuration);
      });
      return undefined;
    };
  };

  const originalNextVideo = api.nextVideo ? api.nextVideo.bind(api) : undefined;
  const originalPrevVideo = api.previousVideo
    ? api.previousVideo.bind(api)
    : undefined;
  const originalLoadByVars = api.loadVideoByPlayerVars
    ? api.loadVideoByPlayerVars.bind(api)
    : undefined;
  const originalLoadById = api.loadVideoById
    ? api.loadVideoById.bind(api)
    : undefined;
  const originalLoadByUrl = api.loadVideoByUrl
    ? api.loadVideoByUrl.bind(api)
    : undefined;
  const originalCueByVars = api.cueVideoByPlayerVars
    ? api.cueVideoByPlayerVars.bind(api)
    : undefined;
  const originalCueById = api.cueVideoById
    ? api.cueVideoById.bind(api)
    : undefined;
  const originalCueByUrl = api.cueVideoByUrl
    ? api.cueVideoByUrl.bind(api)
    : undefined;
  const originalLoadPlaylist = (
    api as unknown as { loadPlaylist?: (...args: unknown[]) => unknown }
  ).loadPlaylist
    ? (
        api as unknown as { loadPlaylist: (...args: unknown[]) => unknown }
      ).loadPlaylist.bind(api)
    : undefined;

  if (originalNextVideo) api.nextVideo = wrapTrackChange(originalNextVideo)!;
  if (originalPrevVideo)
    api.previousVideo = wrapTrackChange(originalPrevVideo)!;
  if (originalLoadByVars)
    api.loadVideoByPlayerVars = wrapTrackChange(originalLoadByVars)!;
  if (originalLoadById) api.loadVideoById = wrapTrackChange(originalLoadById)!;
  if (originalLoadByUrl)
    api.loadVideoByUrl = wrapTrackChange(originalLoadByUrl)!;
  if (originalCueByVars)
    api.cueVideoByPlayerVars = wrapTrackChange(originalCueByVars)!;
  if (originalCueById) api.cueVideoById = wrapTrackChange(originalCueById)!;
  if (originalCueByUrl) api.cueVideoByUrl = wrapTrackChange(originalCueByUrl)!;
  if (originalLoadPlaylist) {
    (
      api as unknown as { loadPlaylist: (...args: unknown[]) => unknown }
    ).loadPlaylist = wrapTrackChange(originalLoadPlaylist)!;
  }

  let isBypassing = false;
  const onDocumentClick = (event: MouseEvent) => {
    if (isBypassing) return;

    const config = getConfig();
    if (!config?.fadeOnSkip || video.paused || fader.get() <= 0) return;

    const target = event.target as HTMLElement | null;
    if (!target) return;

    // Do not intercept if clicking on menus, like buttons, sliders, channels, browse links, or controls
    if (
      target.closest(
        'ytmusic-menu-renderer, ytmusic-like-button-renderer, tp-yt-paper-slider, #volume-slider, #progress-bar, ytmusic-toggle-menu-service-item-renderer, button[aria-label*="Menu"], button[aria-label*="More"], .dropdown-trigger, a[href*="/channel/"], a[href*="/browse/"]',
      )
    ) {
      return;
    }

    // Only intercept specific, verified play triggers (play buttons, thumbnails, song title links, queue items, skip buttons)
    const playTrigger = target.closest<HTMLElement>(
      'ytmusic-play-button-renderer, .next-button.ytmusic-player-bar, .previous-button.ytmusic-player-bar, ytmusic-player-queue-item .song-info, ytmusic-player-queue-item ytmusic-thumbnail-renderer, ytmusic-responsive-list-item-renderer .title a, ytmusic-responsive-list-item-renderer ytmusic-thumbnail-renderer, a[href*="watch?v="]',
    );

    if (!playTrigger) return;

    if (
      (playTrigger as HTMLButtonElement).disabled ||
      playTrigger.getAttribute('aria-disabled') === 'true'
    ) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const token = ++skipFadeToken;
    debug.skipFadeToken = skipFadeToken;

    fader.rampTo(0, config.skipFadeDuration, () => {
      if (token !== skipFadeToken) return;
      isBypassing = true;
      try {
        // Re-dispatch on the matched trigger, not on event.target: these
        // controls are icon buttons, so the actual target is often an
        // <svg>/<path>, and SVGElement has no click() - calling it there
        // throws out of this callback and the skip never happens, leaving
        // the fade stuck down.
        playTrigger.click();
      } finally {
        isBypassing = false;
      }

      scheduleFadeRestore(token, config.skipFadeDuration);
    });
  };

  const originalSetActionHandler =
    'mediaSession' in navigator
      ? navigator.mediaSession.setActionHandler.bind(navigator.mediaSession)
      : null;

  if (originalSetActionHandler) {
    navigator.mediaSession.setActionHandler = (action, handler) => {
      if (!handler) {
        return originalSetActionHandler(action, null);
      }

      if (action === 'nexttrack' || action === 'previoustrack') {
        const wrappedHandler = (details: MediaSessionActionDetails) => {
          const config = getConfig();
          // Teardown restores the setActionHandler setter, but handlers
          // already registered through it stay registered with the app, so
          // this can still run afterwards - with the gain node no longer in
          // the graph, fading here would only delay the skip for nothing.
          if (
            tornDown ||
            !config?.fadeOnSkip ||
            video.paused ||
            fader.get() <= 0
          ) {
            return handler(details);
          }

          const token = ++skipFadeToken;
          debug.skipFadeToken = skipFadeToken;
          fader.rampTo(0, config.skipFadeDuration, () => {
            if (token !== skipFadeToken) return;
            handler(details);
            scheduleFadeRestore(token, config.skipFadeDuration);
          });
        };
        return originalSetActionHandler(action, wrappedHandler);
      }

      // pause/play deliberately aren't wrapped. Replacing them with
      // video.pause()/play() would drop whatever the app itself does on
      // those actions, and it isn't needed for the fade: api.pauseVideo and
      // api.playVideo are already patched to route through the element
      // methods, so the app's own handler reaches the fade on its own.
      return originalSetActionHandler(action, handler);
    };

    skipTeardowns.push(() => {
      navigator.mediaSession.setActionHandler = originalSetActionHandler;
    });
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.key === 'MediaTrackNext' ||
      event.key === 'MediaTrackPrevious' ||
      event.code === 'MediaTrackNext' ||
      event.code === 'MediaTrackPrevious'
    ) {
      const config = getConfig();
      if (!config?.fadeOnSkip || video.paused || fader.get() <= 0) return;

      const token = ++skipFadeToken;
      debug.skipFadeToken = skipFadeToken;
      // Scheduled from the completion callback, like the other skip paths:
      // the restore window is a fixed 300ms, so starting it up front would
      // let it fire mid-fade and ramp back up before reaching silence
      // whenever skipFadeDuration is configured above 300.
      fader.rampTo(0, config.skipFadeDuration, () => {
        scheduleFadeRestore(token, config.skipFadeDuration);
      });
    }
  };
  window.addEventListener('keydown', onKeyDown, true);
  skipTeardowns.push(() =>
    window.removeEventListener('keydown', onKeyDown, true),
  );

  document.addEventListener('click', onDocumentClick, true);
  skipTeardowns.push(() =>
    document.removeEventListener('click', onDocumentClick, true),
  );

  return () => {
    tornDown = true;
    video.removeEventListener('pause', onNativePause);
    video.removeEventListener('play', onNativePlay);
    video.removeEventListener('play', onSongPlay);
    video.removeEventListener('playing', onSongPlay);
    video.removeEventListener('loadstart', onLoadStart);
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
    delete (video as { paused?: boolean }).paused;
    video.pause = originalVideoPause;
    video.play = originalVideoPlay;
    api.pauseVideo = originalApiPauseVideo;
    api.playVideo = originalApiPlayVideo;
    if (originalNextVideo) api.nextVideo = originalNextVideo;
    if (originalPrevVideo) api.previousVideo = originalPrevVideo;
    if (originalLoadByVars) api.loadVideoByPlayerVars = originalLoadByVars;
    if (originalLoadById) api.loadVideoById = originalLoadById;
    if (originalLoadByUrl) api.loadVideoByUrl = originalLoadByUrl;
    if (originalCueByVars) api.cueVideoByPlayerVars = originalCueByVars;
    if (originalCueById) api.cueVideoById = originalCueById;
    if (originalCueByUrl) api.cueVideoByUrl = originalCueByUrl;
    if (originalLoadPlaylist) {
      (
        api as unknown as { loadPlaylist: (...args: unknown[]) => unknown }
      ).loadPlaylist = originalLoadPlaylist;
    }
    for (const teardown of skipTeardowns) teardown();
    debug.video = null;
  };
}

/**
 * Waits for the app's Web Audio graph (via peard:audio-can-play) and
 * inserts a GainNode into it, then attaches setupSmoothTransitions using
 * that gain node exclusively - no video.volume-based fallback. If the video
 * element is ever replaced (e.g. after the OS sleeps/wakes), the old gain
 * node's binding goes stale and can't follow it, so a fresh one is wired
 * straight onto the new element using the same shared AudioContext - no
 * dependency on renderer.ts redoing anything, since a media element can
 * only ever be captured by one MediaElementAudioSourceNode and nothing else
 * has claimed the new one yet. If that ever fails, fading is disabled for
 * the rest of the session rather than falling back to touching
 * video.volume directly, which would reintroduce the conflict with plugins
 * like Exponential Volume that this design avoids.
 *
 * Also exposes window.__smoothTransitionsDebug for inspection from
 * DevTools if something goes wrong.
 */
function superviseSmoothTransitions(
  api: MusicPlayer,
  getConfig: () => SmoothTransitionsPluginConfig | null,
): Teardown {
  let stopCurrent: Teardown | null = null;
  let fader: GainFader | null = null;
  let disabled = false;
  // Retained purely so a later video-element swap (e.g. after the OS
  // sleeps/wakes) can wire a fresh gain node on its own, without depending
  // on renderer.ts to redo anything - it only ever handed us this context
  // and a source bound to the *original* video once, at startup.
  let sharedAudioContext: AudioContext | null = null;
  // The gain node currently spliced into the graph, kept so teardown can
  // take it back out. Without this, disabling the plugin mid-fade (e.g.
  // while paused, so gain sits at 0) would leave the node in place at that
  // value and silence playback until the app restarts.
  let insertedGain: {
    gainNode: GainNode;
    audioSource: MediaElementAudioSourceNode;
    audioContext: AudioContext;
  } | null = null;

  const debug: DebugState = {
    video: null,
    isFading: false,
    pauseFadeToken: 0,
    skipFadeToken: 0,
    gainReady: false,
    disabled: false,
  };
  (
    window as unknown as { __smoothTransitionsDebug: DebugState }
  ).__smoothTransitionsDebug = debug;

  const attachIfPossible = () => {
    if (disabled || !fader || stopCurrent) return;
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    stopCurrent = setupSmoothTransitions(video, api, getConfig, debug, fader);
  };

  // Inserts a GainNode between `video` and speakers and wraps it in a
  // fader. Used both for the very first video (via the audioSource
  // renderer.ts already created for it) and to rebuild from scratch after
  // a video-element swap, where nothing has claimed the new element's
  // audio yet - a media element can only ever be captured by one
  // MediaElementAudioSourceNode, so this only works while that's still true
  // for `video`.
  const wireGainNode = (
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
  ): GainFader | null => {
    try {
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 0;
      // Only the very first video's audioSource is pre-connected straight
      // to destination (by renderer.ts, before this plugin ever sees it) -
      // a source created here for a swapped-in video starts unconnected,
      // so disconnecting a nonexistent edge would throw.
      try {
        audioSource.disconnect(audioContext.destination);
      } catch {
        // not connected to destination - nothing to undo
      }
      audioSource.connect(gainNode);
      gainNode.connect(audioContext.destination);
      // Drop the node from a previous wiring (a video swap makes a new one)
      // so stale gain nodes don't pile up in the graph.
      insertedGain?.gainNode.disconnect();
      insertedGain = { gainNode, audioSource, audioContext };
      return createGainFader(gainNode, audioContext, debug);
    } catch (err) {
      console.error('[smooth-transitions] failed to insert gain node', err);
      return null;
    }
  };

  const onAudioCanPlay = (event: Event) => {
    if (fader || disabled) return;
    const {
      audioContext,
      audioSource,
      video: sourceVideo,
    } = (event as CustomEvent<AudioCanPlayDetail>).detail;
    const video = document.querySelector<HTMLVideoElement>('video');
    sharedAudioContext = audioContext;

    // The event can arrive after its own element was already replaced -
    // detaching a media element doesn't remove its listeners, so the
    // dispatcher in renderer.ts can still fire from the old one. Fading a
    // source bound to a detached element would silently do nothing, so
    // capture the element that's actually on the page instead. That's safe
    // here precisely because it isn't the one renderer.ts captured.
    let source = audioSource;
    if (video && sourceVideo && sourceVideo !== video) {
      try {
        source = audioContext.createMediaElementSource(video);
      } catch (err) {
        console.error(
          '[smooth-transitions] the video was replaced before setup and the replacement could not be captured, disabling fades for this session',
          err,
        );
        disabled = true;
        debug.disabled = true;
        return;
      }
    }

    fader = wireGainNode(audioContext, source);
    if (!fader) {
      disabled = true;
      debug.disabled = true;
      return;
    }
    debug.gainReady = true;

    attachIfPossible();
    // The instance's own native 'play'-driven resync only covers *future*
    // play() calls - if playback is already underway right now, that
    // event already fired before this fader existed, so nothing else
    // will trigger the fade-in unless done here.
    if (video && !video.paused) {
      fader.rampTo(1, 150);
    }
  };
  document.addEventListener('peard:audio-can-play', onAudioCanPlay);

  // Tracks the video element across calls independently of debug.video,
  // which only reflects whether setupSmoothTransitions is *currently*
  // attached (it's null both before the very first attach and whenever
  // fading is disabled) - comparing against that directly would treat the
  // first-ever sighting of the video as a "swap" before gain is even
  // ready, permanently disabling the plugin at startup.
  let lastSeenVideo: HTMLVideoElement | null = null;

  const onDomChange = () => {
    if (disabled) return;
    // This runs for every mutation batch on the whole body subtree, and this
    // page mutates constantly, so keep the common case down to one O(1)
    // check. The only thing the observer has to catch is the <video> being
    // swapped out; while the element we're attached to is still in the
    // document, nothing here needs to change.
    if (stopCurrent && lastSeenVideo?.isConnected) return;

    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;

    if (video !== lastSeenVideo) {
      lastSeenVideo = video;
      stopCurrent?.();
      stopCurrent = null;

      if (fader) {
        // The video element was replaced (e.g. after sleep/wake, or a GPU
        // process restart). The old gain node is permanently bound to the
        // now-detached element and can't follow, but nobody has claimed
        // the *new* element's audio yet, so a fresh GainNode can be wired
        // straight onto it - same as the very first attach, just reusing
        // the shared AudioContext instead of waiting for renderer.ts to
        // hand us a new peard:audio-can-play (it never fires again for a
        // swapped element, since renderer.ts's own loadstart/canplaythrough
        // listeners are still bound to the old one).
        fader.dispose();
        fader = null;
        debug.gainReady = false;
        if (sharedAudioContext) {
          try {
            // Throws if something already captured this element's audio -
            // there can only ever be one MediaElementAudioSourceNode per
            // element, and it can't be undone once taken.
            const audioSource =
              sharedAudioContext.createMediaElementSource(video);
            fader = wireGainNode(sharedAudioContext, audioSource);
          } catch (err) {
            console.error(
              '[smooth-transitions] failed to capture the replaced video element',
              err,
            );
          }
        }
        if (!fader) {
          console.error(
            '[smooth-transitions] could not rewire gain node onto the replaced video element, disabling fades for this session',
          );
          disabled = true;
          debug.disabled = true;
          return;
        }
        debug.gainReady = true;
        // The new element's audio was just rerouted into a gain node that
        // starts silent - unlike the very first attach, playback here is
        // already underway (this element replaced one that was mid-song),
        // so snap straight to audible instead of gliding up from silence.
        fader.rampTo(1, 1);
      }
    }
    attachIfPossible();
  };
  const observer = new MutationObserver(onDomChange);
  observer.observe(document.body, { childList: true, subtree: true });
  lastSeenVideo = document.querySelector<HTMLVideoElement>('video');
  attachIfPossible();

  // Puts the audio graph back the way renderer.ts left it: source straight
  // to destination, with this plugin's gain node removed entirely.
  const restoreGraph = () => {
    if (!insertedGain) return;
    const { gainNode, audioSource, audioContext } = insertedGain;
    insertedGain = null;
    try {
      gainNode.gain.cancelScheduledValues(audioContext.currentTime);
      gainNode.gain.value = 1;
      audioSource.disconnect(gainNode);
      gainNode.disconnect();
      audioSource.connect(audioContext.destination);
    } catch (err) {
      console.error('[smooth-transitions] failed to restore audio graph', err);
    }
  };

  return () => {
    observer.disconnect();
    document.removeEventListener('peard:audio-can-play', onAudioCanPlay);
    stopCurrent?.();
    fader?.dispose();
    restoreGraph();
  };
}

export default createPlugin<
  unknown,
  unknown,
  {
    config: SmoothTransitionsPluginConfig | null;
    cleanup: Teardown | null;
    setupGeneration: number;
  },
  SmoothTransitionsPluginConfig
>({
  name: () => t('plugins.smooth-transitions.name'),
  description: () => t('plugins.smooth-transitions.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    fadeOnPause: true,
    pauseFadeDuration: 250,
    fadeOnSkip: true,
    skipFadeDuration: 200,
  },
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.smooth-transitions.menu.fade-on-pause'),
        type: 'checkbox',
        checked: config.fadeOnPause,
        async click() {
          const now = await getConfig();
          setConfig({ fadeOnPause: !now.fadeOnPause });
        },
      },
      {
        label: t('plugins.smooth-transitions.menu.fade-on-skip'),
        type: 'checkbox',
        checked: config.fadeOnSkip,
        async click() {
          const now = await getConfig();
          setConfig({ fadeOnSkip: !now.fadeOnSkip });
        },
      },
    ];
  },
  renderer: {
    config: null,
    cleanup: null,
    setupGeneration: 0,
    async start({ getConfig }) {
      this.config = await getConfig();
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
    async onPlayerApiReady(api) {
      // The isEnabled lookups below are async, and stop() can land while
      // they're in flight - it would clear this.cleanup first and then this
      // would install the patches anyway, with nothing left to remove them.
      const generation = ++this.setupGeneration;
      this.cleanup?.();
      // The crossfade plugin drives its own volume fades on the same
      // <video> element and auto-clicks the next button near the end of
      // a track. Fading here too would fight it for volume control and
      // can leave playback stuck silent, so step aside entirely.
      const crossfadeActive =
        await window.mainConfig.plugins.isEnabled('crossfade');
      if (crossfadeActive) return;
      // The audio-compressor plugin also reroutes the shared Web Audio
      // graph (source -> compressor -> destination). Inserting a gain
      // node into the same graph independently could race it and produce
      // duplicate/parallel audio paths, so step aside there too rather
      // than risk it - no fallback path exists to fall back to anymore.
      const audioCompressorActive =
        await window.mainConfig.plugins.isEnabled('audio-compressor');
      if (audioCompressorActive) return;
      // Equalizer hangs its filters off the same source
      // (source -> biquad -> destination) without removing the direct
      // source -> destination edge. Splicing a gain node into that edge
      // only attenuates one of the two parallel paths, so a "fade to
      // silence" would leave the filtered path audible. Step aside.
      const equalizerActive =
        await window.mainConfig.plugins.isEnabled('equalizer');
      if (equalizerActive) return;
      if (generation !== this.setupGeneration) return;
      this.cleanup = superviseSmoothTransitions(api, () => this.config);
    },
    stop() {
      this.setupGeneration++;
      this.cleanup?.();
      this.cleanup = null;
    },
  },
});
