import { debounce } from '@/providers/decorators';
import { createRenderer } from '@/utils';

import { overrideListener } from './override';

import type { PreciseVolumeIpc, preciseVolumeConfig } from './types';

function $<E extends Element = Element>(selector: string) {
  return document.querySelector<E>(selector);
}

// Used by video-toggle, which positions the HUD itself.
export const moveVolumeHud = debounce((showVideo: boolean) => {
  const volumeHud = $<HTMLElement>('#volumeHud');
  if (!volumeHud) {
    return;
  }

  volumeHud.style.top = showVideo
    ? `${($('ytmusic-player')!.clientHeight - $('video')!.clientHeight) / 2}px`
    : '0';
}, 250);

export default createRenderer<typeof preciseVolumeConfig, PreciseVolumeIpc>(
  (ctx) => {
    ctx.onCleanup(overrideListener());

    // Options are read when used.
    ctx.onConfigChange(() => {});

    const debounced = <A extends unknown[]>(
      fn: (...args: A) => void,
      delay: number,
    ) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      return (...args: A) => {
        ctx.clearTimeout(timer);
        timer = ctx.setTimeout(() => fn(...args), delay);
      };
    };

    ctx.onPlayerApiReady(async (api) => {
      // The volume is saved after a pause: without it, the config would be
      // written 20 times when the volume changes by 20.
      let savedVolume = ctx.config.savedVolume;
      let writePending = false;
      const writeVolume = () => {
        writePending = false;
        ctx.setConfig({ savedVolume });
      };
      const writeVolumeLater = debounced(writeVolume, 1000);
      ctx.onCleanup(() => {
        if (writePending) writeVolume();
      });

      const hideVolumeHud = debounced((volumeHud: HTMLElement) => {
        volumeHud.style.opacity = '0';
      }, 2000);

      const hideVolumeSlider = debounced((slider: HTMLElement) => {
        slider.classList.remove('on-hover');
      }, 2500);

      /** Restore saved volume and setup tooltip */
      async function firstRun() {
        if (typeof savedVolume === 'number') {
          // Set saved volume as tooltip
          setTooltip(savedVolume);

          if (api.getVolume() !== savedVolume) {
            setVolume(savedVolume);
          }
        }

        setupPlaybar();

        setupLocalArrowShortcuts();

        // Workaround: computedStyleMap().get(string) returns CSSKeywordValue instead of CSSStyleValue
        const noVid =
          (
            $('#main-panel')
              ?.computedStyleMap()
              .get('display') as CSSKeywordValue
          )?.value === 'none';
        injectVolumeHud(noVid);
        if (!noVid) {
          setupVideoPlayerOnwheel();
          if (!(await window.mainConfig.plugins.isEnabled('video-toggle'))) {
            // Video-toggle handles hud positioning on its own
            const videoMode = () =>
              api.getPlayerResponse().videoDetails?.musicVideoType !==
              'MUSIC_VIDEO_TYPE_ATV';
            const video = $('video');
            if (video) {
              ctx.listen(video, 'peard:src-changed', () =>
                moveVolumeHud(videoMode()),
              );
            }
          }
        }
      }

      function injectVolumeHud(noVid: boolean) {
        const volumeHud = document.createElement('span');
        volumeHud.id = 'volumeHud';
        if (noVid) {
          const position = 'top: 18px; right: 60px;';
          const mainStyle = 'font-size: xx-large;';
          volumeHud.setAttribute('style', position + mainStyle);

          $('.center-content.ytmusic-nav-bar')?.append(volumeHud);
        } else {
          const position = 'top: 10px; left: 10px;';
          const mainStyle =
            'font-size: xxx-large; webkit-text-stroke: 1px black; font-weight: 600;';
          volumeHud.setAttribute('style', position + mainStyle);

          $('#song-video')?.after(volumeHud);
        }
        ctx.onCleanup(() => volumeHud.remove());
      }

      function showVolumeHud(volume: number) {
        const volumeHud = $<HTMLElement>('#volumeHud');
        if (!volumeHud) {
          return;
        }

        volumeHud.textContent = `${volume}%`;
        volumeHud.style.opacity = '1';

        hideVolumeHud(volumeHud);
      }

      const onWheel = (event: WheelEvent) => {
        event.preventDefault();
        // Event.deltaY < 0 means wheel-up
        changeVolume(event.deltaY < 0);
      };

      /** Add onwheel event to video player */
      function setupVideoPlayerOnwheel() {
        const panel = $<HTMLElement>('#main-panel');
        if (!panel) return;

        ctx.listen(panel, 'wheel', onWheel);
      }

      function saveVolume(volume: number) {
        savedVolume = volume;
        writePending = true;
        writeVolumeLater();
      }

      /** Add onwheel event to play bar and also track if play bar is hovered */
      function setupPlaybar() {
        const playerbar = $<HTMLElement>('ytmusic-player-bar');
        if (!playerbar) return;

        ctx.listen(playerbar, 'wheel', onWheel);

        // Keep track of mouse position for showVolumeSlider()
        ctx.listen(playerbar, 'mouseenter', () => {
          playerbar.classList.add('on-hover');
        });

        ctx.listen(playerbar, 'mouseleave', () => {
          playerbar.classList.remove('on-hover');
        });
        ctx.onCleanup(() => playerbar.classList.remove('on-hover'));

        setupSliderObserver();
      }

      /** Save volume + Update the volume tooltip when volume-slider is manually changed */
      function setupSliderObserver() {
        const slider = $('#volume-slider');
        if (!slider) return;

        // Observing only changes in 'value' of volume-slider
        ctx.observe(
          slider,
          { attributeFilter: ['value'], attributeOldValue: true },
          (mutations) => {
            for (const mutation of mutations) {
              if (mutation.target.nodeName === 'TP-YT-PAPER-SLIDER') {
                // This checks that volume-slider was manually set
                const target = mutation.target as HTMLInputElement;
                const targetValueNumeric = Number(target.value);
                if (
                  mutation.oldValue !== target.value &&
                  (typeof savedVolume !== 'number' ||
                    Math.abs(savedVolume - targetValueNumeric) > 4)
                ) {
                  // Diff>4 means it was manually set
                  setTooltip(targetValueNumeric);
                  saveVolume(targetValueNumeric);
                }
              }
            }
          },
        );
      }

      function setVolume(value: number) {
        api.setVolume(value);
        // Save the new volume
        saveVolume(value);

        // Change slider position (important)
        updateVolumeSlider();

        // Change tooltips to new value
        setTooltip(value);
        // Show volume slider
        showVolumeSlider();
        // Show volume HUD
        showVolumeHud(value);
      }

      /** If (toIncrease = false) then volume decrease */
      function changeVolume(toIncrease: boolean) {
        // Apply volume change if valid
        const steps = Number(ctx.config.steps || 1);
        setVolume(
          toIncrease
            ? Math.min(api.getVolume() + steps, 100)
            : Math.max(api.getVolume() - steps, 0),
        );
      }

      function updateVolumeSlider() {
        const volume = savedVolume ?? 0;
        // Slider value automatically rounds to multiples of 5
        for (const slider of ['#volume-slider', '#expand-volume-slider']) {
          const silderElement = $<HTMLInputElement>(slider);
          if (silderElement) {
            silderElement.value = String(volume > 0 && volume < 5 ? 5 : volume);
          }
        }
      }

      function showVolumeSlider() {
        const slider = $<HTMLElement>('#volume-slider');
        if (!slider) return;

        // This class display the volume slider if not in minimized mode
        slider.classList.add('on-hover');

        hideVolumeSlider(slider);
      }

      // Set new volume as tooltip for volume slider and icon + expanding slider (appears when window size is small)
      const tooltipTargets = [
        '#volume-slider',
        'tp-yt-paper-icon-button.volume',
        '#expand-volume-slider',
        '#expand-volume',
      ];

      function setTooltip(volume: number) {
        for (const target of tooltipTargets) {
          const tooltipTargetElement = $<HTMLElement>(target);
          if (tooltipTargetElement) {
            tooltipTargetElement.title = `${volume}%`;
          }
        }
      }

      function setupLocalArrowShortcuts() {
        ctx.listen(window, 'keydown', (event) => {
          if (
            !ctx.config.arrowsShortcut ||
            $<HTMLElement & { opened: boolean }>('ytmusic-search-box')?.opened
          ) {
            return;
          }

          switch (event.code) {
            case 'ArrowUp': {
              event.preventDefault();
              changeVolume(true);
              break;
            }

            case 'ArrowDown': {
              event.preventDefault();
              changeVolume(false);
              break;
            }
          }
        });
      }

      ctx.ipc.on('changeVolume', (toIncrease) => changeVolume(toIncrease));
      // Sent by the shortcuts plugin (MPRIS).
      ctx.ipc.core.on('setVolume', (value: number) => setVolume(value));

      await firstRun();
    });
  },
);
