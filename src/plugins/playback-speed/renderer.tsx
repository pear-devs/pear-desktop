import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import {
  claimPlaybackRate,
  isPlaybackRateOwner,
  releasePlaybackRate,
} from '@/plugins/utils/renderer/playback-rate-owner';
import { getSongMenu } from '@/providers/dom-elements';

import { PlaybackSpeedSlider } from './components/slider';

const MIN_PLAYBACK_SPEED = 0.07;
const MAX_PLAYBACK_SPEED = 16;
const PLUGIN_ID = 'playback-speed';

const forcePlaybackRate = (e: Event) => {
  // While another plugin owns the rate (e.g. slowed-reverb is engaged), it
  // re-applies its own value, so answering here would make both plugins
  // overwrite each other on every ratechange forever.
  if (!isPlaybackRateOwner(PLUGIN_ID)) return;
  if (e.target instanceof HTMLVideoElement) {
    const videoElement = e.target;
    if (videoElement.playbackRate !== speed()) {
      videoElement.playbackRate = speed();
    }
  }
};

const roundToTwo = (n: number) => Math.round(n * 1e2) / 1e2;

const [speed, setSpeed] = createSignal(1);
const sliderContainer = document.createElement('div');

export const onPlayerApiReady = () => {
  const observePopupContainer = () => {
    const updatePlayBackSpeed = () => {
      const videoElement = document.querySelector<HTMLVideoElement>('video');
      if (videoElement) {
        videoElement.playbackRate = speed();
      }

      setSpeed(speed());
    };

    render(
      () => (
        <PlaybackSpeedSlider
          onImmediateValueChanged={(e) => {
            let targetSpeed = Number(e.detail.value ?? MIN_PLAYBACK_SPEED);

            if (isNaN(targetSpeed)) {
              targetSpeed = 1;
            }

            targetSpeed = Math.min(
              Math.max(MIN_PLAYBACK_SPEED, targetSpeed),
              MAX_PLAYBACK_SPEED,
            );

            // Programmatic value echoes carry the current speed; only an
            // actual change is an explicit choice that takes ownership.
            if (targetSpeed !== speed()) {
              claimPlaybackRate(PLUGIN_ID);
            }

            setSpeed(targetSpeed);
            updatePlayBackSpeed();
          }}
          onWheel={(e) => {
            e.preventDefault();

            if (isNaN(speed())) {
              setSpeed(1);
            }

            // Wheel is always a user gesture: take the rate from any other
            // plugin controlling it.
            claimPlaybackRate(PLUGIN_ID);

            // E.deltaY < 0 means wheel-up
            setSpeed((prev) =>
              roundToTwo(
                e.deltaY < 0
                  ? Math.min(prev + 0.01, MAX_PLAYBACK_SPEED)
                  : Math.max(prev - 0.01, MIN_PLAYBACK_SPEED),
              ),
            );

            updatePlayBackSpeed();
          }}
          speed={speed()}
          title={t('plugins.playback-speed.templates.button')}
        />
      ),
      sliderContainer,
    );

    const observer = new MutationObserver(() => {
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
      observer.observe(popupContainer, {
        childList: true,
        subtree: true,
      });
    }
  };

  const observeVideo = () => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (video) {
      video.addEventListener('ratechange', forcePlaybackRate);
      video.addEventListener('peard:src-changed', forcePlaybackRate);
    }
  };

  observePopupContainer();
  observeVideo();
};

export const onUnload = () => {
  releasePlaybackRate(PLUGIN_ID);
  const video = document.querySelector<HTMLVideoElement>('video');
  if (video) {
    video.removeEventListener('ratechange', forcePlaybackRate);
    video.removeEventListener('peard:src-changed', forcePlaybackRate);
  }
  getSongMenu()?.removeChild(sliderContainer);
};
