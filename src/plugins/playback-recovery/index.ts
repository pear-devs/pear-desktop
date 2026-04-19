import { createPlugin } from '@/utils';
import { t } from '@/i18n';

import type { MusicPlayer } from '@/types/music-player';

export type PlaybackRecoveryConfig = {
  enabled: boolean;
  stallTimeoutMs: number;
  maxRetries: number;
  logToConsole: boolean;
};

export default createPlugin<
  unknown,
  unknown,
  {
    config: PlaybackRecoveryConfig | null;
    api: MusicPlayer | null;
    watchdog: ReturnType<typeof setInterval> | null;
    videoObserver: MutationObserver | null;
    consecutiveFailures: number;
    lastGoodTime: number;
    lastGoodTimestamp: number;
    recovering: boolean;
  },
  PlaybackRecoveryConfig
>({
  name: () => t('plugins.playback-recovery.name'),
  description: () => t('plugins.playback-recovery.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    stallTimeoutMs: 8000,
    maxRetries: 5,
    logToConsole: true,
  },
  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();

    return [
      {
        label: t('plugins.playback-recovery.menu.log-to-console'),
        type: 'checkbox',
        checked: config.logToConsole,
        async click() {
          const nowConfig = await getConfig();
          setConfig({ logToConsole: !nowConfig.logToConsole });
        },
      },
    ];
  },
  renderer: {
    config: null,
    api: null,
    watchdog: null,
    videoObserver: null,
    consecutiveFailures: 0,
    lastGoodTime: 0,
    lastGoodTimestamp: 0,
    recovering: false,

    async start({ getConfig }) {
      this.config = await getConfig();
    },

    onPlayerApiReady(api) {
      this.api = api;
      this.log('Playback recovery active');
      this.startWatchdog();
      this.watchVideoElement();
      this.hookMediaEvents();
    },

    stop() {
      if (this.watchdog) {
        clearInterval(this.watchdog);
        this.watchdog = null;
      }
      if (this.videoObserver) {
        this.videoObserver.disconnect();
        this.videoObserver = null;
      }
    },

    onConfigChange(newConfig) {
      this.config = newConfig;
    },

    // --- Internal methods attached as properties ---

    log(msg: string) {
      if (this.config?.logToConsole) {
        console.log(`[playback-recovery] ${msg}`);
      }
    },

    getVideo(): HTMLVideoElement | null {
      return document.querySelector('video');
    },

    hookMediaEvents() {
      const attachTo = (video: HTMLVideoElement) => {
        if ((video as any).__pbRecovery) return;
        (video as any).__pbRecovery = true;

        // Track healthy playback progress
        video.addEventListener('timeupdate', () => {
          if (video.currentTime > 0 && !video.paused) {
            this.lastGoodTime = video.currentTime;
            this.lastGoodTimestamp = Date.now();
            this.consecutiveFailures = 0;
            this.recovering = false;
          }
        });

        // On error, attempt immediate recovery
        video.addEventListener('error', () => {
          const code = video.error?.code ?? 0;
          const msg = video.error?.message ?? '';
          this.log(`Media error: code=${code} msg="${msg}"`);
          this.attemptRecovery('media-error');
        });

        // On stall, start a short timer — if it doesn't resolve, recover
        video.addEventListener('stalled', () => {
          this.log('Stream stalled, waiting for recovery...');
          setTimeout(() => {
            const v = this.getVideo();
            if (v && !v.paused && v.readyState < 3) {
              this.log('Stall did not resolve');
              this.attemptRecovery('stall-timeout');
            }
          }, this.config?.stallTimeoutMs ?? 8000);
        });

        // On waiting (buffering), monitor if it persists too long
        video.addEventListener('waiting', () => {
          setTimeout(() => {
            const v = this.getVideo();
            if (v && !v.paused && v.readyState < 2) {
              this.log('Buffering did not resolve');
              this.attemptRecovery('buffer-timeout');
            }
          }, this.config?.stallTimeoutMs ?? 8000);
        });
      };

      const video = this.getVideo();
      if (video) attachTo(video);

      // Also re-attach on video element recreation (MutationObserver in watchVideoElement handles this)
      (this as any)._attachMediaEvents = attachTo;
    },

    watchVideoElement() {
      // Watch for video element being destroyed and recreated
      this.videoObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.removedNodes) {
            if (
              node instanceof HTMLElement &&
              (node.tagName === 'VIDEO' || node.tagName === 'AUDIO')
            ) {
              this.log('Video element removed from DOM');
            }
          }
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLVideoElement) {
              this.log('New video element detected — re-attaching recovery hooks');
              (this as any)._attachMediaEvents?.(node);
            }
          }
        }
      });
      this.videoObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },

    startWatchdog() {
      // Core watchdog: every 3 seconds, check if playback is healthy
      this.watchdog = setInterval(() => {
        if (this.recovering) return;

        const video = this.getVideo();
        if (!video) return;

        // Only check if the player thinks it's playing
        const playerState = this.api?.getPlayerState?.();
        const isPlaying = playerState === 1; // 1 = playing
        if (!isPlaying) return;

        const now = Date.now();

        // Case 1: readyState 0 while "playing" — completely stuck
        if (video.readyState === 0 && !video.paused) {
          const elapsed = now - this.lastGoodTimestamp;
          if (elapsed > (this.config?.stallTimeoutMs ?? 8000)) {
            this.log(
              `Dead playback: readyState=0, no progress for ${elapsed}ms`,
            );
            this.attemptRecovery('dead-playback');
            return;
          }
        }

        // Case 2: currentTime not advancing while not paused
        if (!video.paused && video.currentTime > 0) {
          const timeSinceGood = now - this.lastGoodTimestamp;
          if (
            timeSinceGood > (this.config?.stallTimeoutMs ?? 8000) &&
            this.lastGoodTimestamp > 0
          ) {
            this.log(
              `Playback frozen: currentTime=${video.currentTime.toFixed(1)}, no progress for ${timeSinceGood}ms`,
            );
            this.attemptRecovery('frozen-playback');
            return;
          }
        }

        // Case 3: buffered data exhausted while playing
        if (!video.paused && video.buffered.length > 0) {
          const bufferEnd = video.buffered.end(video.buffered.length - 1);
          const ahead = bufferEnd - video.currentTime;
          if (ahead <= 0 && video.readyState < 3) {
            this.log(`Buffer exhausted: ahead=${ahead.toFixed(1)}s, readyState=${video.readyState}`);
            this.attemptRecovery('buffer-exhausted');
          }
        }
      }, 3000);
    },

    attemptRecovery(reason: string) {
      if (this.recovering) return;

      const maxRetries = this.config?.maxRetries ?? 5;
      this.consecutiveFailures++;

      if (this.consecutiveFailures > maxRetries) {
        this.log(
          `Max retries (${maxRetries}) exceeded — skipping to next track`,
        );
        this.recovering = true;
        this.consecutiveFailures = 0;
        try {
          this.api?.nextVideo();
          this.log('Skipped to next track');
        } catch (e) {
          this.log('Failed to skip: ' + String(e));
        }
        // Give the next track time to load before watchdog kicks in
        setTimeout(() => {
          this.recovering = false;
          this.lastGoodTimestamp = Date.now();
        }, 5000);
        return;
      }

      this.log(
        `Recovery attempt ${this.consecutiveFailures}/${maxRetries} — reason: ${reason}`,
      );
      this.recovering = true;

      const video = this.getVideo();
      const currentTime = video?.currentTime ?? 0;

      // Strategy 1: Try seeking to current position (forces buffer reload)
      if (this.consecutiveFailures <= 2) {
        this.log('Strategy: seek-to-current');
        try {
          if (this.api && currentTime > 0) {
            this.api.seekTo(currentTime);
            this.api.playVideo();
          } else if (this.api) {
            this.api.playVideo();
          }
        } catch (e) {
          this.log('Seek failed: ' + String(e));
        }
      }
      // Strategy 2: Reload the video by seeking slightly forward
      else if (this.consecutiveFailures <= 4) {
        this.log('Strategy: seek-forward');
        try {
          if (this.api && currentTime > 0) {
            this.api.seekTo(currentTime + 1);
            this.api.playVideo();
          } else if (this.api) {
            // If currentTime is 0, try loading the video data fresh
            this.api.playVideo();
          }
        } catch (e) {
          this.log('Seek-forward failed: ' + String(e));
        }
      }

      // Allow recovery to settle before checking again
      setTimeout(() => {
        this.recovering = false;
        this.lastGoodTimestamp = Date.now();
      }, 4000);
    },
  },
});
