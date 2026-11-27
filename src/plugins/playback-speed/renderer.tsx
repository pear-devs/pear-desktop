import { render } from 'solid-js/web';

import { createSignal } from 'solid-js';

import { getSongMenu } from '@/providers/dom-elements';
import { listenToPlayerVideo } from '@/providers/player';

import { PlaybackSpeedSlider } from './components/slider';
import { t } from '@/i18n';

import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';

const MIN_PLAYBACK_SPEED = 0.07;
const MAX_PLAYBACK_SPEED = 16;

const forcePlaybackRate = (video: HTMLVideoElement) => {
  if (video.playbackRate !== speed()) {
    video.playbackRate = speed();
  }
};

const roundToTwo = (n: number) => Math.round(n * 1e2) / 1e2;

const [speed, setSpeed] = createSignal(1);
const sliderContainer = document.createElement('div');
let removeVideoListeners: (() => void) | undefined;

export const onPlayerApiReady = () => {
  removeVideoListeners?.();
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

            setSpeed(targetSpeed);
            updatePlayBackSpeed();
          }}
          onWheel={(e) => {
            e.preventDefault();

            if (isNaN(speed())) {
              setSpeed(1);
            }

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

  observePopupContainer();
  const removePlaybackRateListener = listenToPlayerVideo(
    'ratechange',
    forcePlaybackRate,
  );
  const removeSourceListener = listenToPlayerVideo(
    'peard:src-changed',
    forcePlaybackRate,
  );

  removeVideoListeners = () => {
    removePlaybackRateListener();
    removeSourceListener();
  };
};

export const onUnload = () => {
  removeVideoListeners?.();
  removeVideoListeners = undefined;
  getSongMenu()?.removeChild(sliderContainer);
};
