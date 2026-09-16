import { t } from '@/i18n';
import {
  registerPlayerPanelSection,
  unregisterPlayerPanelSection,
} from '@/plugins/utils/renderer/player-panel';
import { getSongInfo } from '@/providers/song-info-front';

import {
  isLoopEngaged,
  resolveEndSeekTarget,
  resolveSeekTarget,
  type LoopState,
} from './engine';
import { lookupSaved, upsertSaved, type SavedSongs } from './saved';
import {
  createSection,
  type CommitSource,
  type SectionHandle,
  type SectionPoints,
} from './section';

import type { MusicPlayer } from '@/types/music-player';

export interface SectionRepeatConfig {
  active: boolean;
  saved: SavedSongs;
}

const PLUGIN_ID = 'section-repeat';
const TICK_MS = 100;

/**
 * Minimal host surface this controller needs from the merged player-actions
 * entry; the entry adapts its aggregate config slices onto it.
 */
interface FeatureContext<Slice> {
  getConfig: () => Slice | Promise<Slice>;
  setConfig: (patch: Partial<Slice>) => void;
}

export interface SectionRepeatController {
  ctx: FeatureContext<SectionRepeatConfig> | null;
  state: LoopState;
  saved: SavedSongs;
  api: MusicPlayer | null;
  pendingRestoreSeek: boolean;
  section: SectionHandle | null;
  tick: ReturnType<typeof setInterval> | null;
  video: HTMLVideoElement | null;
  sourceHandler: (() => void) | null;
  endedHandler: (() => void) | null;
  start: (ctx: FeatureContext<SectionRepeatConfig>) => Promise<void>;
  stop: () => void;
  onConfigChange: (newConfig: SectionRepeatConfig) => void;
  onPlayerApiReady: (api: MusicPlayer) => void;
  currentVideoId: () => string | null;
  onSave: () => void;
  restoreForCurrentSong: () => void;
  ensureSection: () => void;
  syncSection: () => void;
  handleTick: () => void;
  attachVideo: (video: HTMLVideoElement) => void;
  detachVideo: () => void;
  syncTick: () => void;
}

export function createSectionRepeatController(): SectionRepeatController {
  return {
    ctx: null,
    state: { active: true, startSeconds: null, endSeconds: null },
    saved: [],
    api: null,
    pendingRestoreSeek: false,
    section: null,
    tick: null,
    video: null,
    sourceHandler: null,
    endedHandler: null,

    async start(ctx) {
      this.ctx = ctx;
      const raw = await ctx.getConfig();
      // Points are per song: only `active` and the saved sections are
      // restored, and playback points come back when the song does.
      this.state = {
        active: raw.active !== false,
        startSeconds: null,
        endSeconds: null,
      };
      this.saved = raw.saved;
      this.ensureSection();
      this.syncTick();
      this.restoreForCurrentSong();
    },

    stop() {
      if (this.tick !== null) {
        clearInterval(this.tick);
        this.tick = null;
      }
      this.pendingRestoreSeek = false;
      this.detachVideo();
      unregisterPlayerPanelSection(PLUGIN_ID);
      this.section = null;
    },

    /**
     * The 100 ms tick only exists while the loop is engaged: no points and
     * Repeat off both mean there is nothing to watch, and the interval never
     * outlives the engagement that asked for it.
     */
    syncTick() {
      if (isLoopEngaged(this.state)) {
        if (this.tick === null) {
          this.tick = setInterval(() => {
            this.handleTick();
          }, TICK_MS);
        }
        return;
      }
      if (this.tick !== null) {
        clearInterval(this.tick);
        this.tick = null;
      }
    },

    onConfigChange(newConfig) {
      this.state = {
        ...this.state,
        active: newConfig.active !== false,
      };
      // Adopt persisted saves; restoring here would fight the user's edits.
      this.saved = newConfig.saved;
      this.syncTick();
      this.syncSection();
    },

    onPlayerApiReady(api) {
      this.api = api;
      this.restoreForCurrentSong();
    },

    currentVideoId() {
      // `getSongInfo()` can trail a song change by ~1.5 s; before the player API
      // is set, the fallback could restore the previous song's saved section.
      // `onPlayerApiReady` drives the first restore instead.
      if (!this.api) return null;
      try {
        const videoId = this.api?.getPlayerResponse().videoDetails.videoId;
        if (typeof videoId === 'string' && videoId !== '') return videoId;
      } catch {}
      const videoId = getSongInfo().videoId;
      if (typeof videoId === 'string' && videoId !== '') return videoId;
      return null;
    },

    onSave() {
      const videoId = this.currentVideoId();
      if (videoId === null) return;
      const entry = {
        videoId,
        startSeconds: this.state.startSeconds,
        endSeconds: this.state.endSeconds,
      };
      const removed = entry.startSeconds === null && entry.endSeconds === null;
      const existing = lookupSaved(this.saved, videoId);
      const unchanged = removed
        ? existing === null
        : existing !== null &&
          existing.startSeconds === entry.startSeconds &&
          existing.endSeconds === entry.endSeconds;
      if (unchanged) return;

      this.saved = upsertSaved(this.saved, entry);
      this.ctx?.setConfig({ saved: this.saved });
      this.section?.notify(removed ? 'removed' : 'saved');
    },

    restoreForCurrentSong() {
      const videoId = this.currentVideoId();
      this.pendingRestoreSeek = false;
      if (videoId === null) return;
      const entry = lookupSaved(this.saved, videoId);
      if (entry === null) {
        this.state = { ...this.state, startSeconds: null, endSeconds: null };
        this.syncTick();
        this.syncSection();
        return;
      }

      this.state = {
        ...this.state,
        startSeconds: entry.startSeconds,
        endSeconds: entry.endSeconds,
      };
      this.syncTick();
      this.syncSection();

      const video =
        this.video ?? document.querySelector<HTMLVideoElement>('video');
      const target = resolveEndSeekTarget(this.state, video?.duration ?? NaN);
      if (video !== null && target !== null) {
        try {
          video.currentTime = target;
          return;
        } catch {}
      }
      // No duration yet (a to-end loop), no video, or a failed seek: retry on
      // the first tick that resolves, unless the points change first.
      this.pendingRestoreSeek = true;
    },

    ensureSection() {
      if (this.section) return;
      const handle = createSection(this.state, {
        onActiveChange: (active: boolean) => {
          this.state = { ...this.state, active };
          this.ctx?.setConfig({ active });
          this.syncTick();
          this.syncSection();
        },
        onPointsChange: (points: SectionPoints, source: CommitSource) => {
          this.pendingRestoreSeek = false;
          this.state = {
            ...this.state,
            startSeconds: points.startSeconds,
            endSeconds: points.endSeconds,
          };
          this.syncTick();
          // A committed From jumps playback there at once; To/clear never seek.
          if (source !== 'from') return;
          const video = document.querySelector<HTMLVideoElement>('video');
          if (!video) return;
          const target = resolveEndSeekTarget(this.state, video.duration);
          if (target === null) return;
          try {
            video.currentTime = target;
          } catch {}
        },
        onSave: () => {
          this.onSave();
        },
        getCurrentTime: () => {
          const video = document.querySelector<HTMLVideoElement>('video');
          if (!video || !Number.isFinite(video.currentTime)) return null;
          return video.currentTime;
        },
      });
      this.section = handle;
      registerPlayerPanelSection({
        id: PLUGIN_ID,
        title: t('plugins.section-repeat.panel.title'),
        root: handle.root,
        onDestroy: () => handle.destroy(),
      });
    },

    syncSection() {
      this.section?.sync(this.state);
    },

    handleTick() {
      // Fresh query every tick: YouTube replaces the <video> element.
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;
      this.attachVideo(video);
      if (this.pendingRestoreSeek) {
        const restoreTarget = resolveEndSeekTarget(this.state, video.duration);
        if (restoreTarget !== null) {
          try {
            video.currentTime = restoreTarget;
            this.pendingRestoreSeek = false;
            return;
          } catch {}
        }
      }
      const target = resolveSeekTarget(this.state, {
        currentTime: video.currentTime,
        duration: video.duration,
        paused: video.paused,
        seeking: video.seeking,
      });
      if (target === null) return;
      try {
        video.currentTime = target;
      } catch {}
    },

    attachVideo(video) {
      if (this.video === video) return;
      const replaced = this.video !== null;
      this.detachVideo();
      this.video = video;
      this.sourceHandler = () => {
        // New song: drop the loop points but keep Repeat enabled.
        this.state = {
          ...this.state,
          startSeconds: null,
          endSeconds: null,
        };
        this.pendingRestoreSeek = false;
        this.syncTick();
        this.syncSection();
        this.section?.notify(null);
        this.restoreForCurrentSong();
      };
      this.endedHandler = () => {
        // Backstop for an end-of-song loop the tick missed.
        const target = resolveEndSeekTarget(this.state, video.duration);
        if (target === null) return;
        try {
          video.currentTime = target;
          video.play().catch(() => {});
        } catch {}
      };
      video.addEventListener('peard:src-changed', this.sourceHandler);
      video.addEventListener('ended', this.endedHandler);
      if (replaced) {
        // Element replacement = new song context.
        this.state = {
          ...this.state,
          startSeconds: null,
          endSeconds: null,
        };
        this.pendingRestoreSeek = false;
        this.syncTick();
        this.syncSection();
        this.section?.notify(null);
        this.restoreForCurrentSong();
      }
    },

    detachVideo() {
      if (this.video && this.sourceHandler) {
        this.video.removeEventListener('peard:src-changed', this.sourceHandler);
      }
      if (this.video && this.endedHandler) {
        this.video.removeEventListener('ended', this.endedHandler);
      }
      this.video = null;
      this.sourceHandler = null;
      this.endedHandler = null;
    },
  };
}
