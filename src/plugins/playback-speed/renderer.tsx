import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { type RendererContext } from '@/types/contexts';
import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';

import { PlaybackSpeedSlider } from './components/slider';
import type { PlaybackSpeedConfig } from './index';

const MIN_PLAYBACK_SPEED = 0.07;
const MAX_PLAYBACK_SPEED = 16;

let currentConfig: PlaybackSpeedConfig | null = null;

export const onConfigChange = (newConfig: PlaybackSpeedConfig) => {
  currentConfig = newConfig;
  const videoElement = document.querySelector<HTMLVideoElement>('video');
  if (videoElement) {
    (videoElement as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = !newConfig.noPreservesPitch;
  }
};

const forcePlaybackRate = (e: Event) => {
  if (e.target instanceof HTMLVideoElement) {
    const videoElement = e.target;
    if (videoElement.playbackRate !== speed()) {
      videoElement.playbackRate = speed();
    }
    if (currentConfig && (videoElement as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch !== !currentConfig.noPreservesPitch) {
      (videoElement as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = !currentConfig.noPreservesPitch;
    }
  }
};

const roundToTwo = (n: number) => Math.round(n * 1e2) / 1e2;

const [speed, setSpeed] = createSignal(1);
const sliderContainer = document.createElement('div');

export const onPlayerApiReady = async (
  _api: unknown,
  { getConfig }: RendererContext<PlaybackSpeedConfig>
) => {
  currentConfig = await getConfig();

  const updatePlayBackSpeed = () => {
    const videoElement = document.querySelector<HTMLVideoElement>('video');
    if (videoElement) {
      videoElement.playbackRate = speed();
      if (currentConfig) {
        (videoElement as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = !currentConfig.noPreservesPitch;
      }
    }

    setSpeed(speed());
  };

  const observePopupContainer = () => {
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

  const observeVideo = () => {
    const applyVideoEvents = (video: HTMLVideoElement) => {
      updatePlayBackSpeed();
      video.addEventListener('ratechange', forcePlaybackRate);
      video.addEventListener('peard:src-changed', forcePlaybackRate);
    };

    const video = document.querySelector<HTMLVideoElement>('video');
    if (video) {
      applyVideoEvents(video);
      video.dataset.playbackSpeedObserved = 'true';
    }

    const observer = new MutationObserver(() => {
      const v = document.querySelector<HTMLVideoElement>('video');
      if (v && !v.dataset.playbackSpeedObserved) {
        v.dataset.playbackSpeedObserved = 'true';
        applyVideoEvents(v);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  observePopupContainer();
  observeVideo();
};

export const onUnload = () => {
  const video = document.querySelector<HTMLVideoElement>('video');
  if (video) {
    video.removeEventListener('ratechange', forcePlaybackRate);
    video.removeEventListener('peard:src-changed', forcePlaybackRate);
  }
  getSongMenu()?.removeChild(sliderContainer);
};
