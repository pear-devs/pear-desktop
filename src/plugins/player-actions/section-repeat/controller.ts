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
import type { VideoDataChanged } from '@/types/video-data-changed';

export interface SectionRepeatConfig {
  active: boolean;
  saved: SavedSongs;
}

const PLUGIN_ID = 'section-repeat';
const TICK_MS = 100;
/** Grace after a song change before correcting a restore the player overrode. */
const SETTLE_MS = 1200;
/** Drift past this is treated as a lost seek worth re-applying once. */
const SETTLE_TOLERANCE_SECONDS = 0.5;

/**
 * The song id carried by `videodatachange`. Unlike `getPlayerResponse()` /
 * `getSongInfo()`, the event payload is the player's own id for the song that
 * just changed to, so it is authoritative the moment the change fires.
 */
function videoIdFromEvent(event: Event): string | null {
  const detail = (event as CustomEvent<VideoDataChanged>).detail;
  const videoId = detail?.videoData?.videoId;
  if (typeof videoId !== 'string' || videoId === '') return null;
  return videoId;
}

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
  configLoaded: boolean;
  latestVideoId: string | null;
  restoredVideoId: string | null;
  settleTimer: ReturnType<typeof setTimeout> | null;
  lastUserSeekAt: number;
  section: SectionHandle | null;
  tick: ReturnType<typeof setInterval> | null;
  video: HTMLVideoElement | null;
  sourceHandler: (() => void) | null;
  endedHandler: (() => void) | null;
  videoChangeHandler: ((event: Event) => void) | null;
  start: (ctx: FeatureContext<SectionRepeatConfig>) => Promise<void>;
  stop: () => void;
  onConfigChange: (newConfig: SectionRepeatConfig) => void;
  onPlayerApiReady: (api: MusicPlayer) => void;
  currentVideoId: () => string | null;
  onSave: () => void;
  restoreForCurrentSong: () => void;
  armSettleCheck: () => void;
  runSettleCheck: (
    armedId: string | null,
    armedRestoredId: string | null,
    armedUserSeekAt: number,
    armedAt: number,
  ) => void;
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
    configLoaded: false,
    latestVideoId: null,
    restoredVideoId: null,
    settleTimer: null,
    lastUserSeekAt: 0,
    section: null,
    tick: null,
    video: null,
    sourceHandler: null,
    endedHandler: null,
    videoChangeHandler: null,

    async start(ctx) {
      this.ctx = ctx;
      this.configLoaded = false;
      const raw = await ctx.getConfig();
      // Points are per song: only `active` and the saved sections are
      // restored, and playback points come back when the song does.
      this.state = {
        active: raw.active !== false,
        startSeconds: null,
        endSeconds: null,
      };
      this.saved = raw.saved;
      // Only now is a lookup definitive: before the list arrives a miss is
      // indistinguishable from a cold start, so it must not pin an id.
      this.configLoaded = true;
      // Song-change detection is independent of the seek-loop tick: the 100 ms
      // interval only exists while a loop is armed, so tick-coupled discovery
      // would miss a <video> swap whenever no points are set, and a song with a
      // saved section would never be restored. `videodatachange` is dispatched
      // on `document`; song-info-front then dispatches `peard:src-changed` on
      // the <video>, which the listener attachVideo() installs here still
      // receives (and the already-attached listener fires when it is not).
      //
      // Restore is driven from here, off the event's own `videoData.videoId`:
      // `peard:src-changed` only fires for `dataloaded`, while a natural
      // autoplay advance can surface first (or only) as `dataupdated`. The id
      // in the payload is also authoritative earlier than
      // `getPlayerResponse()` / `getSongInfo()`, which trail the change.
      this.videoChangeHandler = (event) => {
        const videoId = videoIdFromEvent(event);
        if (videoId === null) {
          // Song changed but the payload carried no id (the synthetic
          // payload-less event the renderer emits). Both latches describe the
          // song we just left, so drop them: a stale id would seek the next
          // restore onto the previous song's saved start. With no id every
          // restore path below defers instead; a deferred miss is acceptable,
          // a wrong seek is not.
          this.latestVideoId = null;
          this.restoredVideoId = null;
        } else {
          this.latestVideoId = videoId;
        }
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video) this.attachVideo(video);
        if (videoId === null) {
          // No id, no lookup: defer until an authoritative id arrives.
          this.restoreForCurrentSong();
          return;
        }
        if (videoId === this.restoredVideoId) return;
        this.restoreForCurrentSong();
      };
      document.addEventListener('videodatachange', this.videoChangeHandler);
      this.ensureSection();
      this.syncTick();
      this.restoreForCurrentSong();
    },

    stop() {
      if (this.tick !== null) {
        clearInterval(this.tick);
        this.tick = null;
      }
      if (this.settleTimer !== null) {
        clearTimeout(this.settleTimer);
        this.settleTimer = null;
      }
      this.pendingRestoreSeek = false;
      if (this.videoChangeHandler) {
        document.removeEventListener(
          'videodatachange',
          this.videoChangeHandler,
        );
        this.videoChangeHandler = null;
      }
      this.detachVideo();
      unregisterPlayerPanelSection(PLUGIN_ID);
      this.section = null;
      this.latestVideoId = null;
      this.restoredVideoId = null;
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
      // The id from the latest `videodatachange` is the player's own id for the
      // song that just changed to, so it is authoritative the moment the change
      // fires. `getPlayerResponse()` and especially `getSongInfo()` can trail a
      // song change, which would restore/clear against the previous song.
      if (this.latestVideoId !== null) return this.latestVideoId;
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
      const videoId = this.latestVideoId;
      // The `videodatachange` id is authoritative the moment it fires;
      // `getPlayerResponse()` / `getSongInfo()` trail a change, so seeking off
      // them can land on the previous song. Defer until the real id arrives.
      if (videoId === null) {
        this.pendingRestoreSeek = true;
        this.armSettleCheck();
        return;
      }
      // Before the save list has loaded, a miss cannot be told from a cold
      // start. Defer without pinning so the later real restore is not deduped.
      if (!this.configLoaded) {
        this.pendingRestoreSeek = true;
        this.armSettleCheck();
        return;
      }
      // One restore per song id: the event, source, attach and API-ready paths
      // all funnel here. A repeat call is coalesced unless an intermediate
      // clear (source/replace) left the points unset and they must be re-applied.
      if (videoId === this.restoredVideoId) {
        const current = lookupSaved(this.saved, videoId);
        const matches =
          current === null
            ? this.state.startSeconds === null && this.state.endSeconds === null
            : this.state.startSeconds === current.startSeconds &&
              this.state.endSeconds === current.endSeconds;
        if (matches) return;
      }
      this.restoredVideoId = videoId;
      this.pendingRestoreSeek = false;
      const entry = lookupSaved(this.saved, videoId);
      if (entry === null) {
        this.state = { ...this.state, startSeconds: null, endSeconds: null };
        this.syncTick();
        this.syncSection();
        this.armSettleCheck();
        return;
      }

      this.state = {
        ...this.state,
        startSeconds: entry.startSeconds,
        endSeconds: entry.endSeconds,
      };
      this.syncTick();
      this.syncSection();
      this.armSettleCheck();

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

    /**
     * Schedules one late correction for the song that just changed in. The
     * player can ignore the restore seek or resolve the duration late, so the
     * id is re-resolved after a grace period; any later song change or a
     * deliberate user seek disowns this pass.
     */
    armSettleCheck() {
      if (this.settleTimer !== null) clearTimeout(this.settleTimer);
      const armedId = this.latestVideoId;
      const armedRestoredId = this.restoredVideoId;
      const armedUserSeekAt = this.lastUserSeekAt;
      const armedAt = Date.now();
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.runSettleCheck(armedId, armedRestoredId, armedUserSeekAt, armedAt);
      }, SETTLE_MS);
    },

    runSettleCheck(armedId, armedRestoredId, armedUserSeekAt, armedAt) {
      // A newer song change, a newer restore, or a user seek now owns the
      // position; never fight any of them.
      if (armedId === null || this.latestVideoId !== armedId) return;
      if (this.restoredVideoId !== armedRestoredId) return;
      if (this.lastUserSeekAt !== armedUserSeekAt) return;
      // A pending restore belongs to the tick; do not race it.
      if (this.pendingRestoreSeek) return;
      // Unsaved songs stay untouched: zero currentTime writes.
      if (lookupSaved(this.saved, armedId) === null) return;

      const video =
        this.video ?? document.querySelector<HTMLVideoElement>('video');
      if (video === null || video.paused || video.seeking) return;
      const target = resolveEndSeekTarget(this.state, video.duration);
      if (target === null || !Number.isFinite(video.currentTime)) return;
      // While a loop is engaged the 100 ms tick owns every position that has
      // reached the restore target; never fight it. A position still short of
      // the target means the restore never landed, so fall through and let the
      // directional window below correct it once.
      if (isLoopEngaged(this.state) && video.currentTime >= target) return;
      // A seek that worked leaves playback at the target and then plays on for
      // the settle grace, so accept that whole band and only correct a position
      // outside it: one that fell back to the song start, or landed on another
      // song's position. Derive the upper bound from the ACTUAL elapsed time,
      // not the nominal delay: a late-firing timer must not shrink the band
      // below the drift a successful restore has already accumulated, or the
      // pass would re-seek and reintroduce the audible rewind it removes.
      const elapsedSeconds = (Date.now() - armedAt) / 1000;
      const settleGraceSeconds =
        Number.isFinite(elapsedSeconds) && elapsedSeconds >= 0
          ? elapsedSeconds
          : SETTLE_MS / 1000;
      const windowEnd = target + settleGraceSeconds + SETTLE_TOLERANCE_SECONDS;
      if (
        video.currentTime >= target - SETTLE_TOLERANCE_SECONDS &&
        video.currentTime <= windowEnd
      ) {
        return;
      }
      try {
        video.currentTime = target;
      } catch {}
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
            // A committed From is a deliberate user seek: disown any settle
            // pass armed for this song.
            this.lastUserSeekAt = Date.now();
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
        // Without an authoritative id for the current song the points could
        // belong to the previous one; defer rather than seek onto it.
        if (this.latestVideoId === null) return;
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
