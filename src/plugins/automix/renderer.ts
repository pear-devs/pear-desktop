import Color from 'color';
import { FastAverageColor } from 'fast-average-color';
import { createSignal } from 'solid-js';

import { defaultConfig, type AutoMixPluginConfig } from './config';
import {
  APPLE_ANALYSIS_CHANNEL,
  FETCH_AUDIO_CHANNEL,
  type AppleAnalysis,
  type FetchedAudio,
} from './constants';
import { AutoMixEngine, type AutoMixStatus } from './engine';
import { reorderQueue } from './reorder';
import { mountUi } from './ui';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

const [status, setStatus] = createSignal<AutoMixStatus>({ phase: 'inactive' });
const [config, setConfig] = createSignal<AutoMixPluginConfig>(defaultConfig);

let engine: AutoMixEngine | null = null;
let unmountUi: (() => void) | null = null;
let stopAccent: (() => void) | null = null;
const ACCENT_KEY = '--automix-accent';

/**
 * Takes AutoMix's accent colour from the playing song's artwork, toned down
 * (low saturation, light enough to read on the dark player bar).
 */
const followArtworkColor = (api: MusicPlayer) => {
  const averageColor = new FastAverageColor();
  let latest = 0;

  const update = async () => {
    const request = ++latest;
    const thumbnail = api
      .getPlayerResponse?.()
      ?.videoDetails?.thumbnail?.thumbnails?.at(0)?.url;
    const average = thumbnail
      ? await averageColor.getColorAsync(thumbnail).catch(() => null)
      : null;
    if (request !== latest) return;

    if (!average) {
      document.documentElement.style.removeProperty(ACCENT_KEY);
      return;
    }
    const hsl = Color(average.hex).hsl();
    const accent = hsl
      .saturationl(Math.min(hsl.saturationl(), 38))
      .lightness(Math.min(Math.max(hsl.lightness(), 64), 74))
      .rgb();
    document.documentElement.style.setProperty(
      ACCENT_KEY,
      `${Math.round(accent.red())}, ${Math.round(accent.green())}, ${Math.round(accent.blue())}`,
    );
  };

  const onVideoData = (event: CustomEvent<{ name: string }>) => {
    if (event.detail.name === 'dataloaded') update().catch(console.error);
  };
  document.addEventListener('videodatachange', onVideoData);
  update().catch(console.error);

  return () => {
    document.removeEventListener('videodatachange', onVideoData);
    document.documentElement.style.removeProperty(ACCENT_KEY);
    averageColor.destroy();
  };
};

export const renderer = {
  async start({ getConfig }: RendererContext<AutoMixPluginConfig>) {
    setConfig(await getConfig());
  },

  onPlayerApiReady(
    api: MusicPlayer,
    context: RendererContext<AutoMixPluginConfig>,
  ) {
    engine?.destroy();
    unmountUi?.();
    stopAccent?.();
    stopAccent = followArtworkColor(api);

    engine = new AutoMixEngine(
      {
        api,
        fetchAudio: (videoId) =>
          context.ipc.invoke(
            FETCH_AUDIO_CHANNEL,
            videoId,
          ) as Promise<FetchedAudio | null>,
        fetchApple: (lookup) =>
          context.ipc.invoke(
            APPLE_ANALYSIS_CHANNEL,
            lookup,
          ) as Promise<AppleAnalysis | null>,
        onStatus: setStatus,
      },
      config(),
    );

    unmountUi = mountUi({
      status,
      config,
      onToggle: () => {
        Promise.resolve(context.setConfig({ active: !config().active })).catch(
          console.error,
        );
      },
      mixNow: async () => (await engine?.mixNow()) ?? false,
      timeline: () => engine?.timeline() ?? null,
      timelinePosition: () => engine?.timelinePosition() ?? null,
      reorder: async (onProgress) => {
        const current = engine;
        if (!current) return null;
        return reorderQueue({
          playingId: current.playingVideoId(),
          summaryOf: (track) => current.summaryOf(track),
          maxStretch: current.stretchRange(config().maxStretch),
          keepAlbums: config().respectAlbums,
          shape: config().reorderShape,
          onProgress,
        });
      },
    });
  },

  onConfigChange(newConfig: AutoMixPluginConfig) {
    setConfig(newConfig);
    engine?.setConfig(newConfig);
  },

  stop() {
    engine?.destroy();
    engine = null;
    unmountUi?.();
    unmountUi = null;
    stopAccent?.();
    stopAccent = null;
    setStatus({ phase: 'inactive' });
  },
};
