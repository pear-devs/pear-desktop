import { createRenderer } from '@/utils';

import type { MusicPlayer } from '@/types/music-player';
import type { RendererContext } from '@/types/contexts';
import type { CustomOutputPluginConfig } from './index';

const updateDeviceList = async (
  context: RendererContext<CustomOutputPluginConfig>,
) => {
  const newDevices: Record<string, string> = {};
  const devices = await navigator.mediaDevices
    .enumerateDevices()
    .then((devices) =>
      devices.filter((device) => device.kind === 'audiooutput'),
    );
  for (const device of devices) {
    newDevices[device.deviceId] = device.label;
  }
  const options = await context.getConfig();
  options.devices = newDevices;
  context.setConfig(options);
};

const updateSinkId = async (
  audioContext?: AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>;
  },
  sinkId?: string,
) => {
  if (!audioContext || !sinkId) return;
  if (!('setSinkId' in audioContext)) return;

  if (typeof audioContext.setSinkId === 'function') {
    await audioContext.setSinkId(sinkId);
  }
};

export const renderer = createRenderer<
  {
    options?: CustomOutputPluginConfig;
    audioContext?: AudioContext;
    audioCanPlayHandler: (event: CustomEvent<Compressor>) => Promise<void>;
  },
  CustomOutputPluginConfig
>({
  async audioCanPlayHandler({ detail: { audioContext } }) {
    this.audioContext = audioContext;
    await updateSinkId(audioContext, this.options!.output);
  },

  async onPlayerApiReady(_: MusicPlayer, context) {
    this.options = await context.getConfig();
    await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    navigator.mediaDevices.ondevicechange = async () =>
      await updateDeviceList(context);

    document.addEventListener(
      'peard:audio-can-play',
      this.audioCanPlayHandler,
      {
        once: true,
        passive: true,
      },
    );
    await updateDeviceList(context);
  },

  stop() {
    document.removeEventListener(
      'peard:audio-can-play',
      this.audioCanPlayHandler,
    );
    navigator.mediaDevices.ondevicechange = null;
  },

  async onConfigChange(config) {
    this.options = config;
    await updateSinkId(this.audioContext, config.output);
  },
});
