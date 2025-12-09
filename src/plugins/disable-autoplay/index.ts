import { createPlugin } from '@/utils';

import { t } from '@/i18n';

import type { VideoDataChanged } from '@/types/video-data-changed';
import type { MusicPlayer } from '@/types/music-player';

export type DisableAutoPlayPluginConfig = {
  enabled: boolean;
  applyOnce: boolean;
};

// Global flag to track if we've already applied the pause once (persists across plugin instances)
let globalHasAppliedOnce = false;
// Track the last video ID we processed to detect new videos
let lastProcessedVideoId: string | null = null;
// Debounce timer to avoid spamming play attempts
let playAttemptTimer: NodeJS.Timeout | null = null;

export default createPlugin<
  unknown,
  unknown,
  {
    config: DisableAutoPlayPluginConfig | null;
    api: MusicPlayer | null;
    eventListener: (event: CustomEvent<VideoDataChanged>) => void;
    subsequentVideoListener: (event: CustomEvent<VideoDataChanged>) => void;
    timeUpdateListener: (e: Event) => void;
    timeUpdateHandler: ((e: Event) => void) | null;
  },
  DisableAutoPlayPluginConfig
>({
  name: () => t('plugins.disable-autoplay.name'),
  description: () => t('plugins.disable-autoplay.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    applyOnce: false,
  },
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.disable-autoplay.menu.apply-once'),
        type: 'checkbox',
        checked: config.applyOnce,
        async click() {
          const nowConfig = await getConfig();
          setConfig({
            applyOnce: !nowConfig.applyOnce,
          });
        },
      },
    ];
  },
  renderer: {
    config: null,
    api: null,
    timeUpdateHandler: null,
    eventListener(event: CustomEvent<VideoDataChanged>) {
      if (event.detail.name === 'dataloaded') {
        console.log('[disable-autoplay] dataloaded event received, globalHasAppliedOnce:', globalHasAppliedOnce, 'config:', this.config);
        
        // CRITICAL: Check global flag FIRST - if we've already applied it, do nothing
        // This check happens at the very beginning to prevent any processing
        if (globalHasAppliedOnce) {
          console.log('[disable-autoplay] Already applied once (global flag), ignoring dataloaded event');
          return;
        }
        
        // Only pause if plugin is enabled
        if (!this.config?.enabled) {
          console.log('[disable-autoplay] Plugin not enabled, returning');
          return;
        }
        
        console.log('[disable-autoplay] Plugin is enabled, applyOnce:', this.config?.applyOnce);
        
        // If applyOnce is enabled, mark that we've applied it globally IMMEDIATELY
        // This prevents any race conditions with subsequent dataloaded events
        // Do this BEFORE any other logic to ensure we don't process this event twice
        if (this.config?.applyOnce) {
          // Set flag FIRST before doing anything else
          globalHasAppliedOnce = true;
          console.log('[disable-autoplay] Setting globalHasAppliedOnce = true');
          
          // Track the first video's ID so we can detect when a new video loads
          const firstVideoId = event.detail.videoData?.videoId;
          if (firstVideoId) {
            lastProcessedVideoId = firstVideoId;
            console.log('[disable-autoplay] Tracking first video ID:', firstVideoId);
          }
          
          // Remove the pause listener IMMEDIATELY to prevent processing any more events
          try {
            document.removeEventListener('videodatachange', this.eventListener);
            console.log('[disable-autoplay] Removed pause event listener');
          } catch (err) {
            console.warn('[disable-autoplay] Error removing pause listener:', err);
          }
          
          // Add the subsequent video listener to ensure videos play after the first one
          // Remove it first to prevent duplicates
          document.removeEventListener('videodatachange', this.subsequentVideoListener);
          document.addEventListener('videodatachange', this.subsequentVideoListener);
          console.log('[disable-autoplay] Added subsequent video listener to ensure videos play');
        } else {
          console.log('[disable-autoplay] applyOnce is false, will pause every video');
        }
        
        // Get current video element
        const video = document.querySelector<HTMLVideoElement>('video');
        
        // Check if video is already paused (might have been paused by renderer.ts)
        const isAlreadyPaused = video?.paused ?? false;
        const playerState = this.api?.getPlayerState?.();
        const isPlayerPaused = playerState === 2; // 2 = paused state
        
        // If already paused, we don't need to pause again
        if (isAlreadyPaused || isPlayerPaused) {
          console.log('[disable-autoplay] Video already paused, skipping pause');
          return;
        }
        
        console.log('[disable-autoplay] Pausing video');
        
        // Pause immediately and also mute temporarily to prevent loud audio
        if (video) {
          // Mute immediately to prevent loud audio
          const wasMuted = video.muted;
          video.muted = true;
          this.api?.pauseVideo();
          
          // Unmute after a short delay to ensure pause is applied
          setTimeout(() => {
            video.muted = wasMuted;
          }, 100);
        } else {
          this.api?.pauseVideo();
        }
      }
    },
    timeUpdateListener(e: Event) {
      // This is kept for backwards compatibility but should not be used
      // The actual listener is created inline in eventListener above
      if (e.target instanceof HTMLVideoElement) {
        e.target.pause();
      }
    },
    // Separate listener to ensure subsequent videos play after the first one is paused
    subsequentVideoListener(event: CustomEvent<VideoDataChanged>) {
      console.log('[disable-autoplay] subsequentVideoListener called, event:', event.detail.name, 'globalHasAppliedOnce:', globalHasAppliedOnce);
      
      // Only handle if we've already applied the pause once
      if (!globalHasAppliedOnce) {
        console.log('[disable-autoplay] subsequentVideoListener: globalHasAppliedOnce is false, ignoring');
        return; // First video hasn't been paused yet, ignore
      }
      
      // Handle both dataloaded and dataupdated events
      if (event.detail.name === 'dataloaded' || event.detail.name === 'dataupdated') {
        // Get the current video ID from the event data, or from the API if not available
        let currentVideoId = event.detail.videoData?.videoId;
        
        // If no video ID in event, try to get it from the API
        if (!currentVideoId && this.api) {
          try {
            const videoData = this.api.getVideoData();
            currentVideoId = videoData?.video_id;
            console.log('[disable-autoplay] Got video ID from API:', currentVideoId);
          } catch (err) {
            console.warn('[disable-autoplay] Could not get video ID from API:', err);
          }
        }
        
        // Check if it's a new video (only skip if we're absolutely sure it's the same)
        if (currentVideoId && lastProcessedVideoId === currentVideoId) {
          // Same video ID - but still check if video is paused (might need to play)
          // Use debouncing to avoid spamming
          if (playAttemptTimer) {
            clearTimeout(playAttemptTimer);
          }
          
          playAttemptTimer = setTimeout(() => {
            const video = document.querySelector<HTMLVideoElement>('video');
            if (video && (video.paused || this.api?.getPlayerState?.() === 2)) {
              console.log('[disable-autoplay] Same video ID but paused, attempting to play:', currentVideoId);
              this.api?.playVideo();
            }
          }, 1000); // Debounce: only check after 1 second of no new events
          
          console.log('[disable-autoplay] Same video ID, debouncing play attempt:', currentVideoId);
          return;
        }
        
        // It's a new video (or we couldn't determine the ID) - update tracked ID and try to play
        if (currentVideoId) {
          console.log('[disable-autoplay] New video detected:', currentVideoId, '(previous:', lastProcessedVideoId, ')');
          lastProcessedVideoId = currentVideoId;
        } else {
          console.log('[disable-autoplay] Could not determine video ID, will attempt to play if paused');
        }
        
        // Clear any pending debounced play attempt
        if (playAttemptTimer) {
          clearTimeout(playAttemptTimer);
          playAttemptTimer = null;
        }
        
        console.log('[disable-autoplay] Subsequent video event (' + event.detail.name + '), ensuring it plays');
        
        // When applyOnce is enabled, we want subsequent videos to ALWAYS play
        // regardless of YouTube Music's autoplay setting
        // This ensures normal playback behavior after the first video is paused
        setTimeout(() => {
          const video = document.querySelector<HTMLVideoElement>('video');
          if (!video) {
            console.log('[disable-autoplay] No video element found, cannot play');
            return;
          }
          
          const playerState = this.api?.getPlayerState?.();
          const isPlayerPaused = playerState === 2; // 2 = paused state
          
          console.log('[disable-autoplay] Checking video state - video.paused:', video.paused, 'playerState:', playerState, 'isPlayerPaused:', isPlayerPaused, 'video.readyState:', video.readyState);
          
          // Always play if the video is paused (since applyOnce means we only pause the first video)
          if (video.paused || isPlayerPaused) {
            console.log('[disable-autoplay] Video is paused, playing video (applyOnce mode)');
            try {
              this.api?.playVideo();
              // Double-check after a short delay and retry if still paused
              setTimeout(() => {
                const stillPaused = video.paused || this.api?.getPlayerState?.() === 2;
                if (stillPaused) {
                  console.log('[disable-autoplay] Video still paused after playVideo(), retrying');
                  this.api?.playVideo();
                  // One more retry after another delay
                  setTimeout(() => {
                    const stillPaused2 = video.paused || this.api?.getPlayerState?.() === 2;
                    if (stillPaused2) {
                      console.log('[disable-autoplay] Video still paused after second retry, trying one more time');
                      this.api?.playVideo();
                    } else {
                      console.log('[disable-autoplay] Video is now playing after retry');
                    }
                  }, 300);
                } else {
                  console.log('[disable-autoplay] Video is now playing');
                }
              }, 200);
            } catch (err) {
              console.error('[disable-autoplay] Error playing video:', err);
            }
          } else {
            console.log('[disable-autoplay] Video is already playing, no action needed');
          }
        }, 500); // Delay to give YouTube Music time to process
      } else {
        console.log('[disable-autoplay] subsequentVideoListener: event name is', event.detail.name, ', ignoring');
      }
    },
    async start({ getConfig }) {
      this.config = await getConfig();
    },
    onPlayerApiReady(api) {
      this.api = api;

      // CRITICAL: If we've already applied it globally, NEVER add the pause listener again
      // This prevents re-adding the listener if onPlayerApiReady is called multiple times
      if (globalHasAppliedOnce) {
        console.log('[disable-autoplay] onPlayerApiReady called but globalHasAppliedOnce is true, skipping pause listener addition');
        // But we still need to add the subsequent video listener to ensure videos play after the first one
        // Remove it first to prevent duplicates
        document.removeEventListener('videodatachange', this.subsequentVideoListener);
        document.addEventListener('videodatachange', this.subsequentVideoListener);
        console.log('[disable-autoplay] Added subsequent video listener to ensure videos play');
        return;
      }

      // Only add event listener if we haven't already applied it
      if (!(this.config?.applyOnce && globalHasAppliedOnce)) {
        document.addEventListener('videodatachange', this.eventListener);
        console.log('[disable-autoplay] Added event listener in onPlayerApiReady, globalHasAppliedOnce:', globalHasAppliedOnce);
      } else {
        console.log('[disable-autoplay] Skipping event listener addition, already applied');
      }
    },
    stop() {
      document.removeEventListener('videodatachange', this.eventListener);
      document.removeEventListener('videodatachange', this.subsequentVideoListener);
      // Clean up timeupdate listener if it exists
      if (this.timeUpdateHandler) {
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video) {
          video.removeEventListener('timeupdate', this.timeUpdateHandler);
        }
        this.timeUpdateHandler = null;
      }
      // Clear any pending play attempt timer
      if (playAttemptTimer) {
        clearTimeout(playAttemptTimer);
        playAttemptTimer = null;
      }
      // Reset global flag and video ID tracking when plugin is stopped/disabled
      globalHasAppliedOnce = false;
      lastProcessedVideoId = null;
      console.log('[disable-autoplay] Plugin stopped, reset globalHasAppliedOnce to false and lastProcessedVideoId to null');
    },
    onConfigChange(newConfig) {
      const previousConfig = this.config;
      this.config = newConfig;
      
      // Reset global flag and video ID tracking if applyOnce is toggled off
      if (previousConfig?.applyOnce && !newConfig?.applyOnce) {
        globalHasAppliedOnce = false;
        lastProcessedVideoId = null;
        if (playAttemptTimer) {
          clearTimeout(playAttemptTimer);
          playAttemptTimer = null;
        }
        console.log('[disable-autoplay] applyOnce toggled off, reset globalHasAppliedOnce to false and lastProcessedVideoId to null');
      }
      
      // If plugin is disabled, also reset the flag and video ID tracking
      if (previousConfig?.enabled && !newConfig?.enabled) {
        globalHasAppliedOnce = false;
        lastProcessedVideoId = null;
        if (playAttemptTimer) {
          clearTimeout(playAttemptTimer);
          playAttemptTimer = null;
        }
        console.log('[disable-autoplay] Plugin disabled, reset globalHasAppliedOnce to false and lastProcessedVideoId to null');
      }
    },
  },
});
