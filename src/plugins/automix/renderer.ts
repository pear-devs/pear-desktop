import { createSignal } from 'solid-js';

import { defaultConfig, type AutoMixPluginConfig } from './config';
import { FETCH_AUDIO_CHANNEL } from './constants';
import { AutoMixEngine, type AutoMixStatus } from './engine';
import { mountUi } from './ui';

import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

const [status, setStatus] = createSignal<AutoMixStatus>({ phase: 'inactive' });
const [config, setConfig] = createSignal<AutoMixPluginConfig>(defaultConfig);

let engine: AutoMixEngine | null = null;
let unmountUi: (() => void) | null = null;

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
  },

  stop() {
    engine?.destroy();
    engine = null;
    unmountUi?.();
    unmountUi = null;
    setStatus({ phase: 'inactive' });
  },
};
