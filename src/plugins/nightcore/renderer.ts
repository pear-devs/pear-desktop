import sliderHTML from './templates/slider.html?raw';

import { getSongMenu } from '@/providers/dom-elements';
import { singleton } from '@/providers/decorators';

import { defaultTrustedTypePolicy } from '@/utils/trusted-types';

import { ElementFromHtml } from '../utils/renderer';
import type { NightcorePluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

const slider = ElementFromHtml(sliderHTML);

// Rounding helper
const roundToTwo = (n: number) => Math.round(n * 1e2) / 1e2;

// Constants
const MIN_EFFECT = -75;
const MAX_EFFECT = 75;
const MIN_PLAYBACK_RATE = 0.25;
const MAX_PLAYBACK_RATE = 2.0;

// Current settings
let currentEffectValue = 0;
let config: NightcorePluginConfig;

// Convert effect value to speed rate
const getSpeedRateFromEffect = (effectValue: number): number => {
  // Convert effect value (-75 to 75) to playback rate (0.25 to 2)
  // Using the same calculation logic as the Chrome extension
  if (effectValue > 50) {
    return roundToTwo(1.5 + (effectValue - 50) / 50);
  }
  return roundToTwo(1 + effectValue / 100);
};

// Format the effect value for display
const formatEffectValue = (value: number): string => {
  const speedRate = getSpeedRateFromEffect(value);
  
  if (value === 0) return 'Normal (1.00×)';
  
  if (value > 0) {
    if (value === 50) return 'Nightcore (1.50×)';
    if (value === 75) return 'Extreme (2.00×)';
    return `+${value}% (${speedRate.toFixed(2)}×)`;
  }
  
  if (value === -50) return 'Daycore (0.50×)';
  if (value === -75) return 'Slow (0.25×)';
  return `${value}% (${speedRate.toFixed(2)}×)`;
};

// Apply effect settings
const applyEffect = () => {
  try {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) {
      console.warn('Speed Control plugin: No video element found');
      return;
    }

    const speedRate = getSpeedRateFromEffect(currentEffectValue);
    
    // Set playback rate
    video.playbackRate = speedRate;
    
    // Toggle preservesPitch on/off based on effect
    // preservesPitch = true means pitch is NOT affected by speed changes
    // For nightcore effect, we want pitch to change with speed, so set it to false
    // Only preserve pitch when playback is normal (1.0)
    video.preservesPitch = (speedRate === 1.0);
    
    // Update UI
    updateDisplayedValues();
    
    // Save settings if enabled
    if (config.rememberSettings) {
      void updateConfig();
    }
  } catch (error) {
    console.error('Speed Control plugin: Error applying effect', error);
  }
};

// Save current settings to config
const updateConfig = async () => {
  const context = await createContext(config);
  if (context && context.setConfig) {
    await context.setConfig({
      ...config,
      defaultEffectValue: currentEffectValue
    });
  }
};

// Create a context to interact with the plugin's configuration
const createContext = async (pluginConfig: NightcorePluginConfig) => {
  try {
    return {
      getConfig: async () => pluginConfig,
      setConfig: async (newConfig: NightcorePluginConfig) => {
        Object.assign(config, newConfig);
      },
    };
  } catch (error) {
    console.error('Failed to create context:', error);
    return null;
  }
};

// Event listener for effect slider
const effectSliderValueChangedListener = (e: Event) => {
  currentEffectValue = (e as CustomEvent<{ value: number }>).detail.value || 0;
  if (isNaN(currentEffectValue)) {
    currentEffectValue = 0;
  }
  
  applyEffect();
};

// Setup slider listeners
const setupSliderListeners = singleton(() => {
  document
    .querySelector('#nightcore-effect-slider')
    ?.addEventListener(
      'immediate-value-changed',
      effectSliderValueChangedListener,
    );
});

// Observer for the popup container (song menu)
const observePopupContainer = () => {
  const observer = new MutationObserver(() => {
    const menu = getSongMenu();

    if (menu && !menu.contains(slider)) {
      menu.prepend(slider);
      setupSliderListeners();
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

// Observer for the video element
const observeVideo = () => {
  const video = document.querySelector<HTMLVideoElement>('video');
  if (video) {
    video.addEventListener('ratechange', forcePlaybackRate);
    video.addEventListener('play', applyEffect);
  }
};

// Wheel event handler for fine adjustment
const wheelEventListener = (e: WheelEvent) => {
  e.preventDefault();
  
  // Adjust effect value
  currentEffectValue = Math.round(
    e.deltaY < 0
      ? Math.min(currentEffectValue + 5, MAX_EFFECT)
      : Math.max(currentEffectValue - 5, MIN_EFFECT),
  );
  
  // Update slider position
  const effectSlider = document.querySelector<
    HTMLElement & { value: number }
  >('#nightcore-effect-slider');
  
  if (effectSlider) {
    effectSlider.value = currentEffectValue;
  }
  
  applyEffect();
};

// Setup wheel listeners
const setupWheelListener = () => {
  slider.addEventListener('wheel', wheelEventListener);
};

// Force playback rate when player tries to change it
function forcePlaybackRate(e: Event) {
  if (e.target instanceof HTMLVideoElement) {
    const videoElement = e.target;
    const speedRate = getSpeedRateFromEffect(currentEffectValue);
    
    if (videoElement.playbackRate !== speedRate) {
      videoElement.playbackRate = speedRate;
      videoElement.preservesPitch = (speedRate === 1.0);
    }
  }
}

// Helper to update displayed values
const updateDisplayedValues = () => {
  const effectElement = document.querySelector('#nightcore-effect-value');
  
  if (effectElement) {
    const effectText = formatEffectValue(currentEffectValue);
    (effectElement.innerHTML as string | TrustedHTML) =
      defaultTrustedTypePolicy
        ? defaultTrustedTypePolicy.createHTML(effectText)
        : effectText;
  }
};

// Exposed functions
export const onPlayerApiReady = async (_: unknown, context: RendererContext<NightcorePluginConfig>) => {
  config = await context.getConfig();
  
  // Initialize with defaults or saved settings
  currentEffectValue = config.defaultEffectValue || 0;
  
  // Initialize control UI
  observePopupContainer();
  observeVideo();
  setupWheelListener();
  
  // Apply effect immediately for any current video
  applyEffect();
};

export const onUnload = () => {
  // Clean up event listeners
  const video = document.querySelector<HTMLVideoElement>('video');
  if (video) {
    video.removeEventListener('ratechange', forcePlaybackRate);
    video.removeEventListener('play', applyEffect);
    
    // Reset playback rate
    video.playbackRate = 1.0;
    video.preservesPitch = true;
  }
  
  // Remove slider event listeners
  slider.removeEventListener('wheel', wheelEventListener);
  getSongMenu()?.removeChild(slider);
  
  document
    .querySelector('#nightcore-effect-slider')
    ?.removeEventListener(
      'immediate-value-changed',
      effectSliderValueChangedListener,
    );
}; 