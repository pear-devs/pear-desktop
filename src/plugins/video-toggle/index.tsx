import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { moveVolumeHud as preciseVolumeMoveVolumeHud } from '@/plugins/precise-volume/renderer';
import { type ConfigOf, config } from '@/plugins/utils/common/config';
import { type ThumbnailElement } from '@/types/get-player-response';
import { createPlugin } from '@/utils';

import buttonSwitcherStyle from './button-switcher.css?inline';
import forceHideStyle from './force-hide.css?inline';
import { VideoSwitchButton } from './templates/video-switch-button';

const videoToggleConfig = {
  mode: config.select(
    'custom',
    [
      {
        value: 'custom',
        label: 'plugins.video-toggle.menu.mode.submenu.custom',
      },
      {
        value: 'native',
        label: 'plugins.video-toggle.menu.mode.submenu.native',
      },
      {
        value: 'disabled',
        label: 'plugins.video-toggle.menu.mode.submenu.disabled',
      },
    ],
    { label: 'plugins.video-toggle.menu.mode.label' },
  ),
  align: config.select(
    'left',
    [
      { value: 'left', label: 'plugins.video-toggle.menu.align.submenu.left' },
      {
        value: 'middle',
        label: 'plugins.video-toggle.menu.align.submenu.middle',
      },
      {
        value: 'right',
        label: 'plugins.video-toggle.menu.align.submenu.right',
      },
    ],
    { label: 'plugins.video-toggle.menu.align.label' },
  ),
  forceHide: config.bool(false, {
    label: 'plugins.video-toggle.menu.force-hide',
  }),
  hideVideo: config.hidden(false),
};

type VideoTogglePluginConfig = ConfigOf<typeof videoToggleConfig>;

const FORCE_HIDE_CLASS = 'video-toggle-force-hide';
const CUSTOM_MODE_CLASS = 'video-toggle-custom-mode';

const applyStyleClass = (options: VideoTogglePluginConfig) => {
  if (options.forceHide) {
    document.body.classList.add(FORCE_HIDE_CLASS);
    document.body.classList.remove(CUSTOM_MODE_CLASS);
  } else if (!options.mode || options.mode === 'custom') {
    document.body.classList.add(CUSTOM_MODE_CLASS);
    document.body.classList.remove(FORCE_HIDE_CLASS);
  }
};

export default createPlugin({
  name: () => t('plugins.video-toggle.name'),
  description: () => t('plugins.video-toggle.description'),
  restartNeeded: true,
  config: videoToggleConfig,
  stylesheets: [buttonSwitcherStyle, forceHideStyle],

  renderer(ctx) {
    const startConfig = ctx.config;
    applyStyleClass(startConfig);
    ctx.onCleanup(() =>
      document.body.classList.remove(FORCE_HIDE_CLASS, CUSTOM_MODE_CLASS),
    );

    // As before, a change only updates the style classes; the mode and
    // alignment apply on the next start.
    ctx.onConfigChange(applyStyleClass);

    // Native/disabled modes change YTM attributes: put them back on stop.
    const setAttribute = (selector: string, name: string, on: boolean) => {
      const element = document.querySelector(selector);
      if (!element) return;
      const had = element.hasAttribute(name);
      const previous = element.getAttribute(name);
      if (on) element.setAttribute(name, '');
      else element.removeAttribute(name);
      ctx.onCleanup(() => {
        if (had) element.setAttribute(name, previous ?? '');
        else element.removeAttribute(name);
      });
    };

    if (!startConfig.forceHide) {
      switch (startConfig.mode) {
        case 'native': {
          setAttribute('ytmusic-player-page', 'has-av-switcher', true);
          setAttribute('ytmusic-player', 'has-av-switcher', true);
          setAttribute('ytmusic-av-toggle', 'toggle-disabled', false);
          break;
        }

        case 'disabled': {
          setAttribute('ytmusic-player-page', 'has-av-switcher', false);
          setAttribute('ytmusic-player', 'has-av-switcher', false);
          setAttribute('ytmusic-av-toggle', 'toggle-disabled', true);
          break;
        }
      }
    }

    ctx.onPlayerApiReady(async (api) => {
      const current = ctx.config;
      const [showButton, setShowButton] = createSignal(true);

      const moveVolumeHud = (await window.mainConfig.plugins.isEnabled(
        'precise-volume',
      ))
        ? (preciseVolumeMoveVolumeHud as (_: boolean) => void)
        : () => {};

      const player = document.querySelector<
        HTMLElement & { videoMode_: boolean }
      >('ytmusic-player');
      const video = document.querySelector<HTMLVideoElement>('video');

      const switchButtonContainer = document.createElement('div');
      switchButtonContainer.id = 'ytmd-video-toggle-switch-button-container';
      switchButtonContainer.style.display = 'flex';
      const dispose = render(
        () => (
          <Show when={showButton()}>
            <VideoSwitchButton
              onChange={(e) => {
                const target = e.target as HTMLInputElement;

                setVideoState(target.checked);
              }}
              onClick={(e) => e.stopPropagation()}
              songButtonText={t('plugins.video-toggle.templates.button-song')}
              videoButtonText={t('plugins.video-toggle.templates.button-video')}
            />
          </Show>
        ),
        switchButtonContainer,
      );
      ctx.onCleanup(() => {
        dispose();
        switchButtonContainer.remove();
      });

      const forceThumbnail = (img: HTMLImageElement) => {
        const thumbnails: ThumbnailElement[] =
          api?.getPlayerResponse()?.videoDetails?.thumbnail?.thumbnails ?? [];
        if (thumbnails && thumbnails.length > 0) {
          const thumbnail = thumbnails.at(-1)?.url.split('?')[0];
          if (thumbnail) img.src = thumbnail;
        }
      };

      const setVideoState = (showVideo: boolean) => {
        ctx.setConfig({ hideVideo: !showVideo });

        const checkbox = document.querySelector<HTMLInputElement>(
          '.video-switch-button-checkbox',
        ); // custom mode
        if (checkbox) checkbox.checked = !ctx.config.hideVideo;

        if (player) {
          player.style.margin = showVideo ? '' : 'auto 0px';
          player.setAttribute(
            'playback-mode',
            showVideo ? 'OMV_PREFERRED' : 'ATV_PREFERRED',
          );

          document.querySelector<HTMLElement>(
            '#song-video.ytmusic-player',
          )!.style.display = showVideo ? 'block' : 'none';
          document.querySelector<HTMLElement>('#song-image')!.style.display =
            showVideo ? 'none' : 'block';

          if (showVideo && video && !video.style.top) {
            video.style.top = `${
              (player.clientHeight - video.clientHeight) / 2
            }px`;
          }

          moveVolumeHud(showVideo);
        }
      };

      const videoStarted = () => {
        if (
          api.getPlayerResponse().videoDetails.musicVideoType ===
          'MUSIC_VIDEO_TYPE_ATV'
        ) {
          // Video doesn't exist -> switch to song mode
          setVideoState(false);
          // Hide toggle button
          setShowButton(false);
        } else {
          const songImage = document.querySelector<HTMLImageElement>(
            '#song-image #img.style-scope.yt-img-shadow',
          );
          if (!songImage) {
            return;
          }
          // Switch to high-res thumbnail
          forceThumbnail(songImage);
          // Show toggle button
          setShowButton(true);
          // Change display to video mode if video exist & video is hidden & option.hideVideo = false
          if (
            !ctx.config.hideVideo &&
            document.querySelector<HTMLElement>('#song-video.ytmusic-player')
              ?.style.display === 'none'
          ) {
            setVideoState(true);
          } else {
            moveVolumeHud(!ctx.config.hideVideo);
          }
        }
      };

      /**
       * On load, after a delay, the page overrides the playback-mode to 'OMV_PREFERRED' which causes weird aspect ratio in the image container
       * this function fix the problem by overriding that override :)
       */
      const forcePlaybackMode = () => {
        if (player) {
          const playbackModeObserver = ctx.observe(
            player,
            { attributeFilter: ['playback-mode'] },
            (mutations) => {
              for (const mutation of mutations) {
                if (mutation.target instanceof HTMLElement) {
                  const target = mutation.target;
                  if (
                    target.getAttribute('playback-mode') !== 'ATV_PREFERRED'
                  ) {
                    playbackModeObserver.disconnect();
                    target.setAttribute('playback-mode', 'ATV_PREFERRED');
                  }
                }
              }
            },
          );
        }
      };

      const observeThumbnail = () => {
        const songImage = document.querySelector(
          '#song-image #img.style-scope.yt-img-shadow',
        );
        if (!songImage) return;
        ctx.observe(songImage, { attributeFilter: ['src'] }, (mutations) => {
          if (!player?.videoMode_) {
            return;
          }

          for (const mutation of mutations) {
            if (mutation.target instanceof HTMLImageElement) {
              const target = mutation.target;
              if (!target.src.startsWith('data:')) {
                continue;
              }

              forceThumbnail(target);
            }
          }
        });
      };

      if (current.mode !== 'native' && current.mode !== 'disabled') {
        ctx.setTimeout(() => {
          const playerSelector =
            document.querySelector<HTMLVideoElement>('#player');
          if (!playerSelector) return;

          playerSelector.prepend(switchButtonContainer);
          setVideoState(!ctx.config.hideVideo);
          forcePlaybackMode();
          if (video) {
            video.style.height = 'auto';
            ctx.listen(video, 'peard:src-changed', videoStarted);
          }
          observeThumbnail();
          videoStarted();
          switch (current.align) {
            case 'right': {
              switchButtonContainer.style.justifyContent = 'flex-end';
              return;
            }

            case 'middle': {
              switchButtonContainer.style.justifyContent = 'center';
              return;
            }

            default:
            case 'left': {
              switchButtonContainer.style.justifyContent = 'flex-start';
            }
          }
        }, 0);
      }
    });
  },
});
