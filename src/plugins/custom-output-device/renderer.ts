import { createRenderer } from '@/utils';

import type { customOutputConfig } from './types';

type SinkableAudioContext = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

const updateSinkId = async (
  audioContext?: SinkableAudioContext,
  sinkId?: string,
) => {
  if (!audioContext || sinkId === undefined) return;
  if (typeof audioContext.setSinkId === 'function') {
    await audioContext.setSinkId(sinkId);
  }
};

export default createRenderer<typeof customOutputConfig>((ctx) => {
  let audioContext: SinkableAudioContext | undefined;

  const updateDeviceList = async () => {
    const devices = await navigator.mediaDevices
      .enumerateDevices()
      .then((devices) =>
        devices.filter((device) => device.kind === 'audiooutput'),
      );
    if (ctx.signal.aborted) return;
    const newDevices: Record<string, string> = {};
    for (const device of devices) {
      newDevices[device.deviceId] = device.label;
    }
    await ctx.setConfig({ devices: newDevices });
  };

  ctx.onConfigChange(async (config) => {
    if (config.output) await updateSinkId(audioContext, config.output);
  });

  // Back to the system's default output
  ctx.onCleanup(() => updateSinkId(audioContext, '').catch(() => {}));

  ctx.listen(
    document,
    'peard:audio-can-play',
    async ({ detail }) => {
      audioContext = detail.audioContext;
      if (ctx.config.output)
        await updateSinkId(audioContext, ctx.config.output);
    },
    { once: true, passive: true },
  );

  ctx.onPlayerApiReady(async () => {
    // Asked only so device labels are available; the stream isn't used.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    for (const track of stream.getTracks()) track.stop();
    if (ctx.signal.aborted) return;

    ctx.listen(navigator.mediaDevices, 'devicechange', updateDeviceList);
    await updateDeviceList();
  });
});
