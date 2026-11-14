import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';

import { PlaybackSpeedSlider } from './components/slider';

import type { PlaybackSpeedConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

// Chromium's pitch-preserving time stretcher only sounds clean inside a
// limited range. Outside of it the audio becomes noticeably choppy, so the
// extreme range is opt-in.
const SAFE_MIN_PLAYBACK_SPEED = 0.25;
const SAFE_MAX_PLAYBACK_SPEED = 2;
const EXTREME_MIN_PLAYBACK_SPEED = 0.07;
const EXTREME_MAX_PLAYBACK_SPEED = 16;

const PLAYBACK_SPEED_STEP = 0.05;

// Media events bubble to the document and let us follow <video> elements that
// YouTube Music replaces during SPA navigation without a heavy MutationObserver.
const VIDEO_EVENTS = [
  'emptied',
  'loadstart',
  'loadedmetadata',
  'play',
  'ratechange',
] as const;

const roundToTwo = (n: number) => Math.round(n * 1e2) / 1e2;

const [speed, setSpeed] = createSignal(1);
// Shown next to the slider while dragging. Kept separate from `speed` so the
// slider value itself is only committed once the user releases it.
const [displaySpeed, setDisplaySpeed] = createSignal(1);
const [minSpeed, setMinSpeed] = createSignal(SAFE_MIN_PLAYBACK_SPEED);
const [maxSpeed, setMaxSpeed] = createSignal(SAFE_MAX_PLAYBACK_SPEED);
const [preservesPitch, setPreservesPitch] = createSignal(true);

const sliderContainer = document.createElement('div');

let popupObserver: MutationObserver | null = null;
let disposeRender: (() => void) | null = null;
let isVideoObserved = false;
let loadGeneration = 0;

const getVideoElement = () =>
  document.querySelector<HTMLVideoElement>('#movie_player video') ??
  document.querySelector<HTMLVideoElement>('video');

const clampSpeed = (value: number) => {
  if (isNaN(value)) {
    return speed();
  }

  return roundToTwo(Math.min(Math.max(minSpeed(), value), maxSpeed()));
};

const LEGACY_PITCH_PROPERTIES = [
  'webkitPreservesPitch',
  'mozPreservesPitch',
] as const;

const applyPlaybackRate = (videoElement: HTMLVideoElement) => {
  const shouldPreservePitch = preservesPitch();

  // Chromium time-stretches (instead of resampling) only while this is true.
  // Pitch preservation uses a WSOLA stretcher which is the source of the
  // "choppy" audio, so it is opt-in. The YouTube player or another plugin may
  // still have changed the property, so the plugin owns it explicitly.
  if (videoElement.preservesPitch !== shouldPreservePitch) {
    videoElement.preservesPitch = shouldPreservePitch;
  }

  // Legacy aliases, still present in some Chromium/WebKit builds.
  for (const property of LEGACY_PITCH_PROPERTIES) {
    if (property in videoElement) {
      const legacyVideo = videoElement as HTMLVideoElement &
        Record<(typeof LEGACY_PITCH_PROPERTIES)[number], boolean>;
      if (legacyVideo[property] !== shouldPreservePitch) {
        legacyVideo[property] = shouldPreservePitch;
      }
    }
  }

  // Only write when the value actually changes: re-applying the same rate
  // restarts Chromium's time stretcher and results in audible crackling.
  const targetSpeed = speed();

  // `defaultPlaybackRate` is what the element falls back to when a new source
  // is loaded, so keeping it in sync prevents the player from resetting speed.
  if (videoElement.defaultPlaybackRate !== targetSpeed) {
    videoElement.defaultPlaybackRate = targetSpeed;
  }

  if (videoElement.playbackRate !== targetSpeed) {
    videoElement.playbackRate = targetSpeed;
  }
};

const updatePlaybackSpeed = () => {
  const videoElement = getVideoElement();
  if (videoElement) {
    applyPlaybackRate(videoElement);
  }
};

const handleVideoEvent = (e: Event) => {
  if (e.target instanceof HTMLVideoElement) {
    applyPlaybackRate(e.target);
  }
};

const observePopupContainer = () => {
  popupObserver?.disconnect();
  popupObserver = new MutationObserver(() => {
    const menu = getSongMenu();

    if (
      menu &&
      !menu.contains(sliderContainer) &&
      isMusicOrVideoTrack() &&
      isPlayerMenu(menu)
    ) {
      menu.prepend(sliderContainer);
    }
  });

  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (popupContainer) {
    popupObserver.observe(popupContainer, {
      childList: true,
      subtree: true,
    });
  }
};

const observeVideo = () => {
  if (isVideoObserved) {
    return;
  }

  isVideoObserved = true;
  for (const eventName of VIDEO_EVENTS) {
    document.addEventListener(eventName, handleVideoEvent, true);
  }
};

export const onConfigChange = (config: PlaybackSpeedConfig) => {
  const allowExtremeSpeeds = Boolean(config.allowExtremeSpeeds);
  setMinSpeed(
    allowExtremeSpeeds ? EXTREME_MIN_PLAYBACK_SPEED : SAFE_MIN_PLAYBACK_SPEED,
  );
  setMaxSpeed(
    allowExtremeSpeeds ? EXTREME_MAX_PLAYBACK_SPEED : SAFE_MAX_PLAYBACK_SPEED,
  );
  // Pitch follows speed by default: Chromium's pitch-preserving WSOLA
  // stretcher is what makes sped-up audio sound choppy.
  setPreservesPitch(config.pitchFollowsSpeed === false);

  const nextSpeed = clampSpeed(speed());
  setSpeed(nextSpeed);
  setDisplaySpeed(nextSpeed);

  updatePlaybackSpeed();
};

export const onPlayerApiReady = async (
  _playerApi: MusicPlayer,
  { getConfig }: RendererContext<PlaybackSpeedConfig>,
) => {
  const generation = ++loadGeneration;
  const config = await getConfig();

  // The plugin may have been disabled/unloaded while the config was loading.
  if (generation !== loadGeneration) {
    return;
  }

  onConfigChange(config);

  disposeRender?.();
  disposeRender = render(
    () => (
      <PlaybackSpeedSlider
        displaySpeed={displaySpeed()}
        max={maxSpeed()}
        min={minSpeed()}
        onChange={(value) => {
          const nextSpeed = clampSpeed(value);
          setSpeed(nextSpeed);
          setDisplaySpeed(nextSpeed);
          updatePlaybackSpeed();
        }}
        onImmediateValueChanged={(value) => {
          // Only update the label while dragging. Applying playbackRate on
          // every tick restarts Chromium's time stretcher and causes crackle.
          setDisplaySpeed(clampSpeed(value));
        }}
        onWheel={(e) => {
          e.preventDefault();

          // E.deltaY < 0 means wheel-up
          const nextSpeed = clampSpeed(
            speed() +
              (e.deltaY < 0 ? PLAYBACK_SPEED_STEP : -PLAYBACK_SPEED_STEP),
          );
          setSpeed(nextSpeed);
          setDisplaySpeed(nextSpeed);
          updatePlaybackSpeed();
        }}
        speed={speed()}
        step={PLAYBACK_SPEED_STEP}
        title={t('plugins.playback-speed.templates.button')}
      />
    ),
    sliderContainer,
  );

  observePopupContainer();
  observeVideo();
  updatePlaybackSpeed();
};

export const onUnload = () => {
  loadGeneration++;

  if (isVideoObserved) {
    isVideoObserved = false;
    for (const eventName of VIDEO_EVENTS) {
      document.removeEventListener(eventName, handleVideoEvent, true);
    }
  }

  popupObserver?.disconnect();
  popupObserver = null;

  disposeRender?.();
  disposeRender = null;
  sliderContainer.remove();

  const videoElement = getVideoElement();
  if (videoElement) {
    videoElement.preservesPitch = true;
    if (videoElement.defaultPlaybackRate !== 1) {
      videoElement.defaultPlaybackRate = 1;
    }
    if (videoElement.playbackRate !== 1) {
      videoElement.playbackRate = 1;
    }
  }

  setSpeed(1);
  setDisplaySpeed(1);
};
