import { createRenderer } from '@/utils';

import type { CustomOutputPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';

const updateDeviceList = async (
  context: RendererContext<CustomOutputPluginConfig>,
) => {
  const newDevices: Record<string, string> = {};
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const device of devices) {
    if (device.kind !== 'audiooutput') continue;

    newDevices[device.deviceId] = device.label;
  }

  // clear cause setConfig now does a merge
  context.setConfig({ devices: undefined });
  context.setConfig({ devices: newDevices });
};

const updateSinkId = async (
  audioContext?: AudioContext & {
    setSinkId?: (sinkId: string) => Promise<void>;
  },
  sinkId?: string,
) => {
  if (!audioContext || !sinkId) return;
  if (!('setSinkId' in audioContext)) return;
  if (typeof audioContext.setSinkId !== 'function') return;

  await audioContext.setSinkId(sinkId);
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

  async start(context) {
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
