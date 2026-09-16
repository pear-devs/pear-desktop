import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  createSectionRepeatController,
  type SectionRepeatController,
} from './section-repeat/controller';
import { sanitizeSaved, type SavedSongs } from './section-repeat/saved';
import {
  createSlowedReverbController,
  type SlowedReverbController,
} from './slowed-reverb/controller';
import { clampIntensity, clampSlow } from './slowed-reverb/engine';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

export interface PlayerActionsConfig {
  enabled: boolean;
  slowedReverb: { slow: number; reverbIntensity: number; active: boolean };
  sectionRepeat: { active: boolean; saved: SavedSongs };
}

const DEFAULT_CONFIG: PlayerActionsConfig = {
  enabled: false,
  slowedReverb: { slow: 1, reverbIntensity: 0, active: true },
  sectionRepeat: { active: true, saved: [] },
};

interface PlayerActionsRenderer {
  ctx: RendererContext<PlayerActionsConfig> | null;
  current: PlayerActionsConfig | null;
  lifecycle: number;
  running: boolean;
  slowedReverb: SlowedReverbController;
  sectionRepeat: SectionRepeatController;
  start: (ctx: RendererContext<PlayerActionsConfig>) => Promise<void>;
  stop: () => void;
  onPlayerApiReady: (api: MusicPlayer) => void;
  onConfigChange: (newConfig: PlayerActionsConfig) => void;
  getCurrent: () => PlayerActionsConfig;
}

function normalize(raw: Partial<PlayerActionsConfig>): PlayerActionsConfig {
  const slowed = raw.slowedReverb ?? DEFAULT_CONFIG.slowedReverb;
  const repeat = raw.sectionRepeat ?? DEFAULT_CONFIG.sectionRepeat;
  return {
    enabled: raw.enabled === true,
    slowedReverb: {
      slow: clampSlow(slowed.slow),
      reverbIntensity: clampIntensity(slowed.reverbIntensity),
      active: slowed.active !== false,
    },
    sectionRepeat: {
      active: repeat.active !== false,
      saved: sanitizeSaved(repeat.saved),
    },
  };
}

export default createPlugin<
  unknown,
  unknown,
  PlayerActionsRenderer,
  PlayerActionsConfig
>({
  name: () => t('plugins.player-actions.name'),
  description: () => t('plugins.player-actions.description'),
  authors: ['nathwn12'],
  restartNeeded: false,
  config: { ...DEFAULT_CONFIG },
  renderer: {
    ctx: null,
    current: null,
    lifecycle: 0,
    running: false,
    slowedReverb: createSlowedReverbController(),
    sectionRepeat: createSectionRepeatController(),

    async start(ctx) {
      const generation = ++this.lifecycle;
      this.ctx = ctx;
      const raw = await ctx.getConfig();
      // A stop() can run while the config round-trip is pending; never
      // resurrect the features after teardown.
      if (generation !== this.lifecycle) return;
      this.running = true;
      this.current = normalize(raw);
      await this.slowedReverb.start({
        getConfig: () => this.getCurrent().slowedReverb,
        setConfig: (patch) => {
          const next = { ...this.getCurrent().slowedReverb, ...patch };
          this.current = { ...this.getCurrent(), slowedReverb: next };
          this.ctx?.setConfig({ slowedReverb: next });
        },
      });
      await this.sectionRepeat.start({
        getConfig: () => this.getCurrent().sectionRepeat,
        setConfig: (patch) => {
          const next = { ...this.getCurrent().sectionRepeat, ...patch };
          this.current = { ...this.getCurrent(), sectionRepeat: next };
          this.ctx?.setConfig({ sectionRepeat: next });
        },
      });
    },

    stop() {
      this.lifecycle += 1;
      this.running = false;
      this.slowedReverb.stop();
      this.sectionRepeat.stop();
    },

    onPlayerApiReady(api: MusicPlayer) {
      if (!this.running) return;
      this.slowedReverb.onPlayerApiReady();
      this.sectionRepeat.onPlayerApiReady(api);
    },

    onConfigChange(newConfig) {
      this.current = normalize(newConfig);
      this.slowedReverb.onConfigChange(this.current.slowedReverb);
      this.sectionRepeat.onConfigChange(this.current.sectionRepeat);
    },

    getCurrent() {
      return this.current ?? { ...DEFAULT_CONFIG };
    },
  },
});
