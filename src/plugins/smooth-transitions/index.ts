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

const NEXT_BUTTON_SELECTOR = '.next-button.ytmusic-player-bar';
const PREVIOUS_BUTTON_SELECTOR = '.previous-button.ytmusic-player-bar';

type Teardown = () => void;

type DebugState = {
  video: HTMLVideoElement | null;
  isFading: boolean;
  lastKnownGoodVolume: number;
  pauseFadeToken: number;
  skipFadeToken: number;
  swapCount: number;
  usingGainNode: boolean;
};

type VolumeController = {
  get(): number;
  rampTo(target: number, durationMs: number, onDone?: () => void): void;
  dispose?(): void;
};

/**
 * Drives fades via video.volume on a requestAnimationFrame loop (~60
 * discrete steps/sec). Simple and always available, but some audio
 * hardware renders the JS-driven steps as an audible "zipper" crackle.
 */
function createVideoVolumeController(
  video: HTMLVideoElement,
  debug: DebugState,
): VolumeController {
  let fadeRAF: number | null = null;
  return {
    get: () => video.volume,
    rampTo(target, durationMs, onDone) {
      if (fadeRAF !== null) cancelAnimationFrame(fadeRAF);
      const start = video.volume;
      const startTime = performance.now();
      const step = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        const offset = (target - start) * progress;
        video.volume = start + offset;
        if (progress < 1) {
          fadeRAF = requestAnimationFrame(step);
        } else {
          fadeRAF = null;
          debug.isFading = false;
          onDone?.();
        }
      };
      debug.isFading = true;
      fadeRAF = requestAnimationFrame(step);
    },
  };
}

/**
 * Drives fades via a Web Audio GainNode's linearRampToValueAtTime, which
 * the audio engine interpolates sample-accurately instead of in ~60
 * JS-timed steps - eliminates the crackle the video-volume controller can
 * cause. video.volume itself is left untouched (stays at its native 1)
 * since actual attenuation happens in the gain node instead.
 */
function createGainVolumeController(
  gainNode: GainNode,
  audioContext: AudioContext,
  debug: DebugState,
): VolumeController {
  let rampTimeout: number | null = null;
  return {
    get: () => gainNode.gain.value,
    rampTo(target, durationMs, onDone) {
      if (rampTimeout !== null) window.clearTimeout(rampTimeout);
      const now = audioContext.currentTime;
      // Pin the actually-reached value before cancelling, otherwise
      // cancelScheduledValues can leave/jump to a stale target.
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.setValueAtTime(gainNode.gain.value, now);
      const durationSec = durationMs / 1000;
      gainNode.gain.linearRampToValueAtTime(target, now + durationSec);
      debug.isFading = true;
      rampTimeout = window.setTimeout(() => {
        rampTimeout = null;
        debug.isFading = false;
        onDone?.();
      }, durationMs);
    },
    dispose() {
      if (rampTimeout !== null) window.clearTimeout(rampTimeout);
    },
  };
}

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
  volume: VolumeController,
): Teardown {
  debug.video = video;

  let lastKnownGoodVolume = volume.get() || 1;
  let lastFadeInDuration = 250;

  const beginFadeOut = (durationMs: number, onDone?: () => void) => {
    // Only trust the current volume as the "good" restore target when
    // nothing is mid-fade - otherwise (rapid pause/play toggling, e.g.
    // holding spacebar triggers key repeat) this would capture an
    // already-dimmed, transitional value and ratchet the target toward 0
    // with every interrupted repeat.
    if (!debug.isFading && volume.get() > 0) {
      lastKnownGoodVolume = volume.get();
      debug.lastKnownGoodVolume = lastKnownGoodVolume;
    }
    lastFadeInDuration = durationMs;
    volume.rampTo(0, durationMs, onDone);
  };

  const fadeIn = () => {
    if (volume.get() === 0 && lastKnownGoodVolume > 0) {
      volume.rampTo(lastKnownGoodVolume, lastFadeInDuration);
    }
  };
  video.addEventListener('play', fadeIn);

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
  const onNativePause = () => {
    intendedPaused = true;
  };
  const onNativePlay = () => {
    intendedPaused = false;
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
    if (
      !config?.fadeOnPause ||
      intendedPaused ||
      volume.get() === 0 ||
      isDeviceChangePause
    ) {
      intendedPaused = true;
      return originalVideoPause();
    }

    intendedPaused = true;
    const token = ++pauseFadeToken;
    debug.pauseFadeToken = pauseFadeToken;
    beginFadeOut(config.pauseFadeDuration, () => {
      if (token !== pauseFadeToken) return;
      originalVideoPause();
    });
    return undefined;
  };

  video.play = () => {
    intendedPaused = false;
    pauseFadeToken++; // invalidates any in-flight pause fade
    debug.pauseFadeToken = pauseFadeToken;
    // The pause fade above may have been left running (it only skips the
    // final originalVideoPause() call on invalidation, it doesn't stop the
    // volume animation), and if the video never actually paused the native
    // 'play' event that normally triggers fadeIn won't fire either. Resync
    // back toward the last known-good volume unconditionally.
    if (volume.get() < lastKnownGoodVolume) {
      const config = getConfig();
      volume.rampTo(
        lastKnownGoodVolume,
        config?.pauseFadeDuration ?? lastFadeInDuration,
      );
    }
    return originalVideoPlay();
  };

  // Route the higher-level player API through the same patched methods,
  // in case something calls pauseVideo()/playVideo() without going
  // through video.pause()/play() directly.
  const originalApiPauseVideo = api.pauseVideo.bind(api);
  const originalApiPlayVideo = api.playVideo.bind(api);
  api.pauseVideo = () => video.pause();
  api.playVideo = () => video.play();

  // --- Manual skip (next / previous) ---
  const skipTeardowns: Teardown[] = [];
  let skipFadeToken = 0;
  const attachSkipFade = (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector);
    if (!button) return;

    let bypass = false;
    const onClick = (event: MouseEvent) => {
      if (bypass) {
        bypass = false;
        return;
      }

      const config = getConfig();
      if (
        !config?.fadeOnSkip ||
        button.disabled ||
        button.getAttribute('aria-disabled') === 'true' ||
        volume.get() === 0
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const token = ++skipFadeToken;
      debug.skipFadeToken = skipFadeToken;
      beginFadeOut(config.skipFadeDuration, () => {
        if (token !== skipFadeToken) return;
        bypass = true;
        button.click();

        window.setTimeout(() => {
          if (token !== skipFadeToken) return;
          if (!video.paused && volume.get() === 0) {
            volume.rampTo(lastKnownGoodVolume, config.skipFadeDuration);
          }
        }, config.skipFadeDuration + 400);
      });
    };

    button.addEventListener('click', onClick, true);
    skipTeardowns.push(() =>
      button.removeEventListener('click', onClick, true),
    );
  };

  attachSkipFade(NEXT_BUTTON_SELECTOR);
  attachSkipFade(PREVIOUS_BUTTON_SELECTOR);

  return () => {
    video.removeEventListener('play', fadeIn);
    video.removeEventListener('pause', onNativePause);
    video.removeEventListener('play', onNativePlay);
    navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
    delete (video as { paused?: boolean }).paused;
    video.pause = originalVideoPause;
    video.play = originalVideoPlay;
    api.pauseVideo = originalApiPauseVideo;
    api.playVideo = originalApiPlayVideo;
    for (const teardown of skipTeardowns) teardown();
    debug.video = null;
  };
}

type AudioCanPlayDetail = {
  audioContext: AudioContext;
  audioSource: MediaElementAudioSourceNode;
};

/**
 * Re-runs setupSmoothTransitions whenever the <video> element is replaced,
 * e.g. Chromium can recreate it after the OS suspends/resumes (sleep/wake)
 * or restarts the GPU process - without this, the patches stay on a dead
 * element and fading silently stops working until the app is restarted.
 *
 * Also exposes window.__smoothTransitionsDebug so state can be inspected
 * from DevTools if fading ever silently stops working again for an
 * unknown reason, without needing to catch it happening live.
 */
function superviseSmoothTransitions(
  api: MusicPlayer,
  getConfig: () => SmoothTransitionsPluginConfig | null,
  allowGainNode: boolean,
): Teardown {
  let currentVideo: HTMLVideoElement | null = null;
  let stopCurrent: Teardown | null = null;

  const debug: DebugState = {
    video: null,
    isFading: false,
    lastKnownGoodVolume: 1,
    pauseFadeToken: 0,
    skipFadeToken: 0,
    swapCount: 0,
    usingGainNode: false,
  };
  (
    window as unknown as { __smoothTransitionsDebug: DebugState }
  ).__smoothTransitionsDebug = debug;

  // The gain node is bound to whatever <video> existed when the core app
  // created its MediaElementAudioSourceNode. If the video element ever
  // gets swapped (the same sleep/wake case above), that binding goes
  // stale - so once a swap happens, permanently fall back to the
  // video.volume controller instead of silently losing volume control.
  let gainController: VolumeController | null = null;
  let videoHasSwapped = false;
  let insertedGain: {
    gainNode: GainNode;
    audioSource: MediaElementAudioSourceNode;
    audioContext: AudioContext;
  } | null = null;

  // Reverses the graph rewiring from onAudioCanPlay: without this, disabling
  // the plugin (or a video swap abandoning the gain node) leaves the node
  // permanently wired in at whatever gain it last had - if that's 0 or
  // mid-ramp-toward-0, audio stays silent with no way back short of an app
  // restart, since nothing else knows to undo it.
  const restoreAudioGraph = () => {
    gainController?.dispose?.();
    gainController = null;
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

  const onAudioCanPlay = (event: Event) => {
    if (gainController || videoHasSwapped) return;
    const { audioContext, audioSource } = (
      event as CustomEvent<AudioCanPlayDetail>
    ).detail;
    try {
      const gainNode = audioContext.createGain();
      audioSource.disconnect(audioContext.destination);
      audioSource.connect(gainNode);
      gainNode.connect(audioContext.destination);
      gainController = createGainVolumeController(
        gainNode,
        audioContext,
        debug,
      );
      insertedGain = { gainNode, audioSource, audioContext };
      debug.usingGainNode = true;
    } catch (err) {
      console.error(
        '[smooth-transitions] failed to insert gain node, falling back to video.volume',
        err,
      );
    }
  };
  if (allowGainNode) {
    document.addEventListener('peard:audio-can-play', onAudioCanPlay);
  }

  const sync = () => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video === currentVideo && (!video || video.isConnected)) return;

    // Only a transition from one real element to a different one counts as
    // a swap - the very first attach (currentVideo starts null) must not,
    // or videoHasSwapped would be true from startup and the gain node path
    // below would never be reachable.
    if (currentVideo !== null) {
      debug.swapCount++;
      videoHasSwapped = true;
      debug.usingGainNode = false;
      // The gain node is bound to the old (now stale) audioSource - if we
      // leave it wired in at its last value, raising the new video's
      // .volume can't restore audio when that value was 0 or mid-fade.
      restoreAudioGraph();
      console.log(
        '[smooth-transitions] video element changed, re-attaching (swap #' +
          debug.swapCount +
          ')',
      );
    }

    stopCurrent?.();
    stopCurrent = null;
    currentVideo = video;
    if (video) {
      const controller =
        !videoHasSwapped && gainController
          ? gainController
          : createVideoVolumeController(video, debug);
      stopCurrent = setupSmoothTransitions(
        video,
        api,
        getConfig,
        debug,
        controller,
      );
    }
  };
  sync();

  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    document.removeEventListener('peard:audio-can-play', onAudioCanPlay);
    stopCurrent?.();
    restoreAudioGraph();
  };
}

export default createPlugin<
  unknown,
  unknown,
  {
    config: SmoothTransitionsPluginConfig | null;
    cleanup: Teardown | null;
  },
  SmoothTransitionsPluginConfig
>({
  name: () => t('plugins.smooth-transitions.name'),
  description: () => t('plugins.smooth-transitions.description'),
  restartNeeded: false,
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
    async start({ getConfig }) {
      this.config = await getConfig();
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
    async onPlayerApiReady(api) {
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
      // duplicate/parallel audio paths, so only use the gain node when
      // compressor isn't in the mix.
      const audioCompressorActive =
        await window.mainConfig.plugins.isEnabled('audio-compressor');
      this.cleanup = superviseSmoothTransitions(
        api,
        () => this.config,
        !audioCompressorActive,
      );
    },
    stop() {
      this.cleanup?.();
      this.cleanup = null;
    },
  },
});
