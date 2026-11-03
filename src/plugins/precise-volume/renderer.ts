import { debounce } from '@/providers/decorators';

import { type PreciseVolumePluginConfig } from './index';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

function $<E extends Element = Element>(selector: string) {
  return document.querySelector<E>(selector);
}

let api: MusicPlayer;

export const moveVolumeHud = debounce((showVideo: boolean) => {
  const volumeHud = $<HTMLElement>('#volumeHud');
  if (!volumeHud) {
    return;
  }

  volumeHud.style.top = showVideo
    ? `${($('ytmusic-player')!.clientHeight - $('video')!.clientHeight) / 2}px`
    : '0';
}, 250);

let options: PreciseVolumePluginConfig;

const newSliderSelector =
  'ytmusic-miniplayer .ytMusicMiniPlayerVolumePopup input[type="range"]';

/**
 * Script that applies the saved volume as soon as the player exists.
 * Injected from the preload: YTM can start playing at its default (full)
 * volume well before the renderer plugins and onPlayerApiReady are loaded.
 */
export const restoreVolumeScript = (volume: number) => `(() => {
  const apply = () => {
    const player = document.querySelector('#movie_player');
    if (typeof player?.setVolume !== 'function') return false;
    player.setVolume(${volume});
    return true;
  };
  if (apply()) return;
  const finish = () => {
    if (!apply()) return;
    observer.disconnect();
    document.removeEventListener('play', finish, true);
  };
  // MutationObserver instead of polling: timers can be throttled during startup
  const observer = new MutationObserver(finish);
  observer.observe(document, { childList: true, subtree: true });
  // In case the player API shows up without a later DOM mutation:
  // apply when playback starts at the latest (media events don't bubble, so capture)
  document.addEventListener('play', finish, true);
})(); 0`;

let onNewSliderChange: ((event: Event) => void) | undefined;

/** Remove the new UI's slider listener (plugin disabled or re-initialized) */
export const removeNewSliderListener = () => {
  if (!onNewSliderChange) return;
  document.removeEventListener('change', onNewSliderChange, true);
  onNewSliderChange = undefined;
};

export const onPlayerApiReady = async (
  playerApi: MusicPlayer,
  context: RendererContext<PreciseVolumePluginConfig>,
) => {
  options = await context.getConfig();
  api = playerApi;

  // Without this function it would rewrite config 20 time when volume change by 20
  const writeOptions = debounce(() => {
    context.setConfig(options);
  }, 1000);

  const hideVolumeHud = debounce((volumeHud: HTMLElement) => {
    volumeHud.style.opacity = '0';
  }, 2000);

  const hideVolumeSlider = debounce((slider: HTMLElement) => {
    slider.classList.remove('on-hover');
  }, 2500);

  /** Restore saved volume and setup tooltip */
  async function firstRun() {
    if (typeof options.savedVolume === 'number') {
      // Set saved volume as tooltip
      setTooltip(options.savedVolume);

      if (api.getVolume() !== options.savedVolume) {
        setVolume(options.savedVolume);
      } else {
        // Already applied by the preload, but the new UI's slider still shows YTM's default
        updateVolumeSlider();
      }
    }

    setupPlaybar();

    setupLocalArrowShortcuts();

    // Workaround: computedStyleMap().get(string) returns CSSKeywordValue instead of CSSStyleValue
    const noVid =
      ($('#main-panel')?.computedStyleMap().get('display') as CSSKeywordValue)
        ?.value === 'none';
    injectVolumeHud(noVid);
    if (!noVid) {
      setupVideoPlayerOnwheel();
      if (!(await window.mainConfig.plugins.isEnabled('video-toggle'))) {
        // Video-toggle handles hud positioning on its own
        const videoMode = () =>
          api.getPlayerResponse().videoDetails?.musicVideoType !==
          'MUSIC_VIDEO_TYPE_ATV';
        $('video')?.addEventListener('peard:src-changed', () =>
          moveVolumeHud(videoMode()),
        );
      }
    }
  }

  function injectVolumeHud(noVid: boolean) {
    if (noVid) {
      const position = 'top: 18px; right: 60px;';
      const mainStyle = 'font-size: xx-large;';

      $('.center-content.ytmusic-nav-bar')?.insertAdjacentHTML(
        'beforeend',
        `<span id="volumeHud" style="${position + mainStyle}"></span>`,
      );
    } else {
      const position = 'top: 10px; left: 10px;';
      const mainStyle =
        'font-size: xxx-large; webkit-text-stroke: 1px black; font-weight: 600;';

      $('#song-video')?.insertAdjacentHTML(
        'afterend',
        `<span id="volumeHud" style="${position + mainStyle}"></span>`,
      );
    }
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

  /** Add onwheel event to video player */
  function setupVideoPlayerOnwheel() {
    const panel = $<HTMLElement>('#main-panel');
    if (!panel) return;

    panel.addEventListener('wheel', (event) => {
      event.preventDefault();
      // Event.deltaY < 0 means wheel-up
      changeVolume(event.deltaY < 0);
    });
  }

  function saveVolume(volume: number) {
    options.savedVolume = volume;
    writeOptions();
  }

  /** Add onwheel event to play bar and also track if play bar is hovered */
  function setupPlaybar() {
    // YTM's newer UI replaced ytmusic-player-bar with ytmusic-miniplayer
    const playerbar =
      $<HTMLElement>('ytmusic-player-bar') ??
      $<HTMLElement>('ytmusic-miniplayer');
    if (!playerbar) return;

    playerbar.addEventListener('wheel', (event) => {
      event.preventDefault();
      // Event.deltaY < 0 means wheel-up
      changeVolume(event.deltaY < 0);
    });

    // Keep track of mouse position for showVolumeSlider()
    playerbar.addEventListener('mouseenter', () => {
      playerbar.classList.add('on-hover');
    });

    playerbar.addEventListener('mouseleave', () => {
      playerbar.classList.remove('on-hover');
    });

    setupSliderObserver();
    setupNewSliderListener();
  }

  /** Save volume when the newer UI's native range slider is manually changed */
  function setupNewSliderListener() {
    // Re-enabling the plugin calls onPlayerApiReady again; don't stack listeners
    removeNewSliderListener();
    onNewSliderChange = (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.matches(newSliderSelector)) return;

      const volume = Number((target as HTMLInputElement).value);
      setTooltip(volume);
      saveVolume(volume);
    };
    // The slider is re-rendered inside a hover popup, so listen on the document.
    // Capture phase, in case YTM stops propagation on the slider itself
    document.addEventListener('change', onNewSliderChange, true);
  }

  /** Save volume + Update the volume tooltip when volume-slider is manually changed */
  function setupSliderObserver() {
    const sliderObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target.nodeName === 'TP-YT-PAPER-SLIDER') {
          // This checks that volume-slider was manually set
          const target = mutation.target as HTMLInputElement;
          const targetValueNumeric = Number(target.value);
          if (
            mutation.oldValue !== target.value &&
            (typeof options.savedVolume !== 'number' ||
              Math.abs(options.savedVolume - targetValueNumeric) > 4)
          ) {
            // Diff>4 means it was manually set
            setTooltip(targetValueNumeric);
            saveVolume(targetValueNumeric);
          }
        }
      }
    });

    const slider = $('#volume-slider');
    if (!slider) return;

    // Observing only changes in 'value' of volume-slider
    sliderObserver.observe(slider, {
      attributeFilter: ['value'],
      attributeOldValue: true,
    });
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
    const steps = Number(options.steps || 1);
    setVolume(
      toIncrease
        ? Math.min(api.getVolume() + steps, 100)
        : Math.max(api.getVolume() - steps, 0),
    );
  }

  /** Move the volume sliders (old and new UI) to the saved volume */
  function updateVolumeSlider() {
    const savedVolume = options.savedVolume ?? 0;
    // Slider value automatically rounds to multiples of 5
    for (const slider of ['#volume-slider', '#expand-volume-slider']) {
      const silderElement = $<HTMLInputElement>(slider);
      if (silderElement) {
        silderElement.value = String(
          savedVolume > 0 && savedVolume < 5 ? 5 : savedVolume,
        );
      }
    }

    // The newer UI's slider doesn't follow api.setVolume() on its own
    const newSlider = $<HTMLInputElement>(newSliderSelector);
    if (newSlider) {
      newSlider.value = String(savedVolume);
      newSlider.style.setProperty(
        '--yt-slider-shape-gradient-percent',
        `${savedVolume}%`,
      );
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
    if (options.arrowsShortcut) {
      window.addEventListener('keydown', (event) => {
        if (
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
  }

  context.ipc.on('changeVolume', (toIncrease: boolean) =>
    changeVolume(toIncrease),
  );
  context.ipc.on('setVolume', (value: number) => setVolume(value));

  await firstRun();
};

export const onConfigChange = (config: PreciseVolumePluginConfig) => {
  options = config;
};
