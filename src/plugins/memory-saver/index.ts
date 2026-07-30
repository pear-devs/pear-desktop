import { app, powerMonitor } from 'electron';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';
import type { VideoDataChanged } from '@/types/video-data-changed';

const CHECK_INTERVAL_MS = 60_000;
/** Minimum spacing between reloads, anchored to the previous actual reload */
const COOLDOWN_MS = 60 * 60_000;
/** Only ask for a reload while the user has been away from the keyboard this long */
const SYSTEM_IDLE_S = 120;

const RELOAD_CHANNEL = 'memory-saver:reload-when-idle';
/** These survive the reload but not an app restart, which is exactly the lifetime needed */
const WAS_PAUSED_KEY = 'peard:memory-saver-was-paused';
const LAST_RELOAD_KEY = 'peard:memory-saver-last-reload';

export type MemorySaverPluginConfig = {
  enabled: boolean;
  /** Reload once the renderer process is above this many MB */
  thresholdMB: number;
};

const isShuffled = () =>
  (document
    .querySelector<HTMLElement>('ytmusic-player-bar')
    ?.attributes.getNamedItem('shuffle-on') ?? null) !== null;

export default createPlugin<
  {
    interval: NodeJS.Timeout | null;
    lastRequestAt: number;
  },
  unknown,
  {
    api: MusicPlayer | null;
    pending: boolean;
    resumeShuffleEnabled: boolean;
    keepPausedUntil: number;
    canReloadNow: () => boolean;
    tryReload: () => void;
    reload: () => void;
    keepPaused: () => void;
    onPause: (event: Event) => void;
    onVideoDataChange: (event: CustomEvent<VideoDataChanged>) => void;
    onTimeUpdate: (event: Event) => void;
  },
  MemorySaverPluginConfig
>({
  name: () => t('plugins.memory-saver.name'),
  description: () => t('plugins.memory-saver.description'),
  addedVersion: '3.13.X',
  restartNeeded: false,
  config: {
    enabled: false,
    thresholdMB: 1200,
  },
  backend: {
    interval: null,
    lastRequestAt: 0,
    start({ window, ipc, getConfig }) {
      // macOS keeps the app alive with the window closed; don't stack intervals
      if (this.interval) clearInterval(this.interval);
      this.interval = setInterval(async () => {
        if (window.isDestroyed()) return;
        // A reload navigates to the song page, so never ask for one while the user is at the keyboard; the renderer then picks a gap in playback
        if (powerMonitor.getSystemIdleTime() < SYSTEM_IDLE_S) return;
        if (Date.now() - this.lastRequestAt < COOLDOWN_MS) return;

        const { thresholdMB } = await getConfig();
        const pid = window.webContents.getOSProcessId();
        const usedKB = app.getAppMetrics().find((metric) => metric.pid === pid)
          ?.memory.workingSetSize;

        if (usedKB && usedKB / 1024 >= thresholdMB) {
          this.lastRequestAt = Date.now();
          ipc.send(RELOAD_CHANNEL);
        }
      }, CHECK_INTERVAL_MS);
    },
    stop() {
      if (this.interval) clearInterval(this.interval);
      this.interval = null;
    },
  },
  renderer: {
    api: null,
    pending: false,
    resumeShuffleEnabled: false,
    keepPausedUntil: 0,
    canReloadNow() {
      // The reload rebuilds the queue from the URL, which only works for playlist and radio queues; hold off on hand-built ones
      const { video_id: videoId, list } = this.api?.getVideoData() ?? {};
      if (!videoId || !list) return false;

      // The rebuilt queue always comes back unshuffled, so only reload when the resume-shuffle plugin is set up to re-apply the shuffle
      if (isShuffled()) {
        return (
          this.resumeShuffleEnabled &&
          window.mainConfig.get('options.resumeOnStart')
        );
      }

      return true;
    },
    tryReload() {
      if (this.pending && this.canReloadNow()) this.reload();
    },
    reload() {
      // Built from the player rather than `options.resumeOnStart`'s saved url, which still points at the previous song during a track change
      const { video_id: videoId, list } = this.api?.getVideoData() ?? {};
      if (!videoId) return;

      this.pending = false;

      const target = new URL('/watch', location.origin);
      target.searchParams.set('v', videoId);
      if (list) target.searchParams.set('list', list);

      // Carry the playback position over; the player honours `t` and then drops it from the address bar, so it cannot pile up across reloads
      const video = document.querySelector('video');
      const elapsed = Math.floor(video?.currentTime ?? 0);
      if (elapsed > 0) target.searchParams.set('t', `${elapsed}s`);

      // The page always autoplays after loading, so remember a paused player and put it back afterwards; pausing must not restart the music
      if (video?.paused) sessionStorage.setItem(WAS_PAUSED_KEY, '1');
      sessionStorage.setItem(LAST_RELOAD_KEY, `${Date.now()}`);

      location.replace(target.toString());
    },
    keepPaused() {
      const video = document.querySelector('video');
      this.api?.pauseVideo();
      // Autoplay can win the race, so pause again on the first frame it plays, but only briefly, so a deliberate play later isn't cancelled
      this.keepPausedUntil = Date.now() + 5_000;
      video?.addEventListener('timeupdate', this.onTimeUpdate, { once: true });
    },
    onTimeUpdate(event) {
      if (Date.now() > this.keepPausedUntil) return;
      if (event.target instanceof HTMLVideoElement) event.target.pause();
    },
    onPause(event) {
      // A track ending naturally also fires 'pause' (with `ended` set) just before the next one loads; let the track change do the reload instead
      if (event.target instanceof HTMLVideoElement && event.target.ended) {
        return;
      }
      this.tryReload();
    },
    onVideoDataChange(event) {
      // A track change is the least disruptive moment to lose a few seconds
      if (event.detail.name === 'dataloaded') this.tryReload();
    },
    onPlayerApiReady(api, { ipc }) {
      this.api = api;
      // Defensive: this can run again on plugin re-enable
      ipc.removeAllListeners(RELOAD_CHANNEL);

      if (sessionStorage.getItem(WAS_PAUSED_KEY)) {
        sessionStorage.removeItem(WAS_PAUSED_KEY);
        this.keepPaused();
      }

      ipc.on(RELOAD_CHANNEL, async () => {
        // Anchor the cooldown to the previous actual reload, not the request; a reload deferred for a long time still counts from when it happened
        const lastReloadAt = Number(sessionStorage.getItem(LAST_RELOAD_KEY));
        if (Date.now() - lastReloadAt < COOLDOWN_MS) return;

        // Resolved here rather than per attempt, so the reload gate stays synchronous
        this.resumeShuffleEnabled =
          await window.mainConfig.plugins.isEnabled('resume-shuffle');

        this.pending = true;
        // Paused is already a safe moment; otherwise wait for the next pause or track change
        if (document.querySelector('video')?.paused) this.tryReload();
      });

      document
        .querySelector('video')
        ?.addEventListener('pause', this.onPause, { passive: true });
      document.addEventListener('videodatachange', this.onVideoDataChange);
    },
    stop({ ipc }) {
      this.pending = false;
      this.resumeShuffleEnabled = false;
      this.api = null;
      // A disabled plugin should never leave a pending restore behind
      sessionStorage.removeItem(WAS_PAUSED_KEY);

      // The channel is exclusively this plugin's, so removing all listeners is safe and is the only cleanup the wrapped `ipc.on` allows
      ipc.removeAllListeners(RELOAD_CHANNEL);
      const video = document.querySelector('video');
      video?.removeEventListener('pause', this.onPause);
      video?.removeEventListener('timeupdate', this.onTimeUpdate);
      document.removeEventListener('videodatachange', this.onVideoDataChange);
    },
  },
});
