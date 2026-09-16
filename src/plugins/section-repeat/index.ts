import { t } from '@/i18n';
import {
  registerPlayerPanelSection,
  unregisterPlayerPanelSection,
} from '@/plugins/utils/renderer/player-panel';
import { createPlugin } from '@/utils';

import {
  resolveEndSeekTarget,
  resolveSeekTarget,
  type LoopState,
} from './engine';
import {
  createSection,
  type CommitSource,
  type SectionHandle,
  type SectionPoints,
} from './section';

import type { RendererContext } from '@/types/contexts';

export interface SectionRepeatConfig {
  enabled: boolean;
  active: boolean;
}

const PLUGIN_ID = 'section-repeat';
const TICK_MS = 100;

const DEFAULT_CONFIG: SectionRepeatConfig = {
  enabled: false,
  active: true,
};

interface SectionRepeatRenderer {
  ctx: RendererContext<SectionRepeatConfig> | null;
  state: LoopState;
  section: SectionHandle | null;
  tick: ReturnType<typeof setInterval> | null;
  video: HTMLVideoElement | null;
  sourceHandler: (() => void) | null;
  endedHandler: (() => void) | null;
  start: (ctx: RendererContext<SectionRepeatConfig>) => Promise<void>;
  stop: () => void;
  onConfigChange: (newConfig: SectionRepeatConfig) => void;
  ensureSection: () => void;
  syncSection: () => void;
  handleTick: () => void;
  attachVideo: (video: HTMLVideoElement) => void;
  detachVideo: () => void;
}

export default createPlugin<
  unknown,
  unknown,
  SectionRepeatRenderer,
  SectionRepeatConfig
>({
  name: () => t('plugins.section-repeat.name'),
  description: () => t('plugins.section-repeat.description'),
  authors: ['nathwn12'],
  restartNeeded: false,
  config: { ...DEFAULT_CONFIG },
  renderer: {
    ctx: null,
    state: { active: true, startSeconds: null, endSeconds: null },
    section: null,
    tick: null,
    video: null,
    sourceHandler: null,
    endedHandler: null,

    async start(ctx) {
      this.ctx = ctx;
      const raw = await ctx.getConfig();
      // Points are per song and never persisted: only `active` is restored.
      this.state = {
        active: raw.active !== false,
        startSeconds: null,
        endSeconds: null,
      };
      this.ensureSection();
      if (this.tick === null) {
        this.tick = setInterval(() => {
          this.handleTick();
        }, TICK_MS);
      }
    },

    stop() {
      if (this.tick !== null) {
        clearInterval(this.tick);
        this.tick = null;
      }
      this.detachVideo();
      unregisterPlayerPanelSection(PLUGIN_ID);
      this.section = null;
    },

    onConfigChange(newConfig) {
      this.state = {
        ...this.state,
        active: newConfig.active !== false,
      };
      this.syncSection();
    },

    ensureSection() {
      if (this.section) return;
      const handle = createSection(this.state, {
        onActiveChange: (active: boolean) => {
          this.state = { ...this.state, active };
          this.ctx?.setConfig({ active });
          this.syncSection();
        },
        onPointsChange: (points: SectionPoints, source: CommitSource) => {
          this.state = {
            ...this.state,
            startSeconds: points.startSeconds,
            endSeconds: points.endSeconds,
          };
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
      this.detachVideo();
      this.video = video;
      this.sourceHandler = () => {
        // New song: drop the loop points but keep Repeat enabled.
        this.state = {
          ...this.state,
          startSeconds: null,
          endSeconds: null,
        };
        this.syncSection();
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
  },
});
