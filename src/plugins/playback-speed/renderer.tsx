import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';
import type { PluginConfig } from '@/types/plugins';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';

import { PlaybackSpeedSlider } from './components/slider';

interface PlaybackSpeedConfig extends PluginConfig {
  varispeed: boolean;
}

const MIN_PLAYBACK_SPEED = 0.07;
const MAX_PLAYBACK_SPEED = 16;

const forcePlaybackRate = (e: Event) => {
  if (e.target instanceof HTMLVideoElement) {
    const videoElement = e.target;
    if (videoElement.playbackRate !== speed()) {
      videoElement.playbackRate = speed();
    }
  }
};

const roundToTwo = (n: number) => Math.round(n * 1e2) / 1e2;

const [speed, setSpeed] = createSignal(1);
const [varispeed, setVarispeed] = createSignal(false);
const sliderContainer = document.createElement('div');

export const linkPitch = () => {
      const videoElement = document.querySelector<HTMLVideoElement>('video');
      if (videoElement) {
        if(varispeed()){
          videoElement.preservesPitch = false;
        }else{
          videoElement.preservesPitch = true;
        }
      }
}

export const onPlayerApiReady = async (
  playerApi: MusicPlayer,
  context: RendererContext<PlaybackSpeedConfig>,
) => {
  const config = await context.getConfig();
  setVarispeed(config.varispeed);

  context.ipc.on('config-changed', (id: string, newConfig: PlaybackSpeedConfig) => {
    if (id === 'playback-speed') {
      setVarispeed(newConfig.varispeed);
      linkPitch();
    }
  });

  const observePopupContainer = () => {
    const updatePlayBackSpeed = () => {
      const videoElement = document.querySelector<HTMLVideoElement>('video');
      if (videoElement) {
        videoElement.playbackRate = speed();
        linkPitch();
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
  const video = document.querySelector<HTMLVideoElement>('video');
  if (video) {
    video.removeEventListener('ratechange', forcePlaybackRate);
    video.removeEventListener('peard:src-changed', forcePlaybackRate);
  }
  getSongMenu()?.removeChild(sliderContainer);
};
