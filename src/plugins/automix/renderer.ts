import Color from 'color';
import { FastAverageColor } from 'fast-average-color';
import { createSignal } from 'solid-js';

import { AiBeatTracker } from './ai';
import { defaultConfig, type AutoMixPluginConfig } from './config';
import { AI_ASSETS_CHANNEL, FETCH_AUDIO_CHANNEL } from './constants';
import { AutoMixEngine, type AutoMixStatus } from './engine';
import { mountUi } from './ui';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

const [status, setStatus] = createSignal<AutoMixStatus>({ phase: 'inactive' });
const [config, setConfig] = createSignal<AutoMixPluginConfig>(defaultConfig);

let engine: AutoMixEngine | null = null;
let unmountUi: (() => void) | null = null;
let stopAccent: (() => void) | null = null;
let aiTracker: AiBeatTracker | null = null;
let aiLoading = false;
let rendererContext: RendererContext<AutoMixPluginConfig> | null = null;

/** Load / unload the optional AI beat tracker to match the setting */
const syncAi = async () => {
  const context = rendererContext;
  if (!context || !engine) return;

  if (!config().aiBeats) {
    aiTracker?.dispose();
    aiTracker = null;
    engine.setAi(null);
    return;
  }
  if (aiTracker || aiLoading) return;

  aiLoading = true;
  engine.setAiLoading('loading');
  try {
    const assets = (await context.ipc.invoke(AI_ASSETS_CHANNEL)) as {
      model: Uint8Array;
      wasm: Uint8Array;
    } | null;
    if (!assets) throw new Error('Could not download the AI model');
    if (!config().aiBeats || !engine) return;

    const tracker = new AiBeatTracker(assets);
    const provider = await tracker.provider;
    if (!config().aiBeats || !engine) {
      tracker.dispose();
      return;
    }
    aiTracker = tracker;
    engine.setAi(tracker, provider);
    console.info('[AutoMix] AI beat tracker ready on', provider);
  } catch (error) {
    console.warn('[AutoMix] AI beat tracker unavailable', error);
    engine?.setAiLoading('failed');
  } finally {
    aiLoading = false;
  }
};

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
    // A fresh engine gets a fresh tracker (the model is cached on disk)
    aiTracker?.dispose();
    aiTracker = null;
    stopAccent = followArtworkColor(api);

    engine = new AutoMixEngine(
      {
        api,
        fetchAudio: (videoId) =>
          context.ipc.invoke(
            FETCH_AUDIO_CHANNEL,
            videoId,
          ) as Promise<Uint8Array | null>,
        onStatus: setStatus,
      },
      config(),
    );

    rendererContext = context;
    syncAi().catch(console.error);

    unmountUi = mountUi({
      status,
      config,
      onToggle: () => {
        Promise.resolve(context.setConfig({ active: !config().active })).catch(
          console.error,
        );
      },
    });
  },

  onConfigChange(newConfig: AutoMixPluginConfig) {
    setConfig(newConfig);
    engine?.setConfig(newConfig);
    syncAi().catch(console.error);
  },

  stop() {
    aiTracker?.dispose();
    aiTracker = null;
    engine?.destroy();
    engine = null;
    unmountUi?.();
    unmountUi = null;
    stopAccent?.();
    stopAccent = null;
    setStatus({ phase: 'inactive' });
  },
};
