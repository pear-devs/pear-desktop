import { createRenderer } from '@/utils';

import type { CustomOutputPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

// Anything that plays audio to an output device: AudioContexts and media
// elements both expose `sinkId` / `setSinkId`.
type AudioSink = {
  sinkId?: unknown;
  setSinkId?: (sinkId: string) => Promise<void>;
};

// Pseudo devices Chromium lists next to the real ones. They follow the
// Windows default (and default communications) device.
const isPseudoDevice = (id: string) =>
  id === '' || id === 'default' || id === 'communications';

// '' and 'default' both mean "the system default device". Anything that is not
// a string (an AudioSinkInfo for a silent sink) never matches a device.
const normalizeSinkId = (sinkId: unknown) =>
  typeof sinkId === 'string' ? (sinkId === 'default' ? '' : sinkId) : null;

const getOutputDevices = async () => {
  const devices: Record<string, string> = {};
  for (const device of await navigator.mediaDevices.enumerateDevices()) {
    if (device.kind === 'audiooutput') devices[device.deviceId] = device.label;
  }
  return devices;
};

// Map the saved output to a device that exists right now. Device IDs change
// across restarts and driver reloads, and the saved device list keeps the old
// IDs (config writes merge, so keys are never removed), so an ID picked from
// it can be stale. Fall back to the current device with the same name.
// Returns '' for the system default, undefined when the device is not present.
const resolveSinkId = (
  output: string | undefined,
  savedDevices: Record<string, string> | undefined,
  currentDevices: Record<string, string>,
) => {
  if (!output || output === 'default') return '';
  if (output in currentDevices) return output;
  const savedLabel = savedDevices?.[output];
  if (!savedLabel) return undefined;
  return Object.entries(currentDevices).find(
    ([id, label]) => label === savedLabel && !isPseudoDevice(id),
  )?.[0];
};

const sinks = new Set<AudioSink>();
// Media elements routed into an AudioContext play through that context, so
// their own sink is unused and must not be switched.
const capturedElements = new WeakSet<HTMLMediaElement>();
let options: CustomOutputPluginConfig | undefined;

// Switches run one at a time and each one reads the latest config, so a slow
// switch can never land after (and undo) a newer selection.
let queue = Promise.resolve();
const enqueue = (task: () => Promise<void>) => {
  queue = queue.then(task).catch((error) => {
    console.warn('[custom-output-device]', error);
  });
  return queue;
};

const applySinkId = async (sink: AudioSink, sinkId: string) => {
  if (typeof sink.setSinkId !== 'function') return;
  // setSinkId can resolve without the switch sticking, or reject while
  // Windows is re-enumerating devices, so check the result and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Switching reopens the output stream (an audible gap), so skip no-ops.
    if (normalizeSinkId(sink.sinkId) === sinkId) return;
    try {
      await sink.setSinkId(sinkId);
    } catch (error) {
      console.warn(
        `[custom-output-device] could not switch to output "${sinkId}"`,
        error,
      );
    }
  }
  if (normalizeSinkId(sink.sinkId) !== sinkId) {
    console.warn(
      `[custom-output-device] output is "${String(sink.sinkId)}", not "${sinkId}"`,
    );
  }
};

const applyToSinks = (targets: Iterable<AudioSink>) =>
  enqueue(async () => {
    const devices = await getOutputDevices();
    const sinkId = resolveSinkId(options?.output, options?.devices, devices);
    for (const sink of [...targets]) {
      if (
        (sink instanceof HTMLMediaElement && capturedElements.has(sink)) ||
        (sink instanceof AudioContext && sink.state === 'closed')
      ) {
        sinks.delete(sink);
        continue;
      }
      if (sinkId !== undefined) {
        await applySinkId(sink, sinkId);
        continue;
      }
      // The chosen device is not there (unplugged, driver restarting). Leave
      // the sink alone unless its own device vanished too, then use the
      // default so playback is not silent. It moves back when the device
      // reappears (devicechange runs this again).
      const current = normalizeSinkId(sink.sinkId);
      if (current !== null && current !== '' && !(current in devices)) {
        await applySinkId(sink, '');
      }
    }
  });

const trackSink = (sink: AudioSink) => {
  if (sinks.has(sink)) return;
  sinks.add(sink);
  applyToSinks([sink]);
};

const updateDeviceList = async (
  context: RendererContext<CustomOutputPluginConfig>,
) => {
  const newDevices = await getOutputDevices();
  const config = await context.getConfig();
  // Persist the remapped ID so the menu shows the right device.
  let output = config.output;
  if (output && !(output in newDevices)) {
    output = resolveSinkId(output, config.devices, newDevices) || output;
  }
  // Device change events fire often (Bluetooth, virtual cables, monitors
  // waking up). Only write the config when something actually changed, since
  // every write also runs onConfigChange below. The saved list also holds
  // devices that are gone, so only compare the current ones.
  if (
    output === config.output &&
    Object.entries(newDevices).every(
      ([id, label]) => config.devices?.[id] === label,
    )
  ) {
    return;
  }
  // Only send what changed: a full config read before a menu selection would
  // otherwise write the old output back over it.
  await context.setConfig(
    output === config.output
      ? { devices: newDevices }
      : { devices: newDevices, output },
  );
};

const NativeAudioContext = window.AudioContext;
// oxlint-disable-next-line typescript/unbound-method
const nativePlay = HTMLMediaElement.prototype.play;

export const renderer = createRenderer<
  {
    audioCanPlayHandler: (event: CustomEvent<Compressor>) => void;
  },
  CustomOutputPluginConfig
>({
  audioCanPlayHandler({ detail: { audioContext } }) {
    trackSink(audioContext as AudioSink);
  },

  async start({ getConfig }) {
    options = await getConfig();

    // Route every audio output in the page, not just the main player's
    // AudioContext: Crossfade plays the outgoing song through its own <audio>
    // elements (Howler html5), and contexts can be created later. Anything
    // left out keeps playing on the Windows default device.
    window.AudioContext = class extends NativeAudioContext {
      constructor(contextOptions?: AudioContextOptions) {
        super(contextOptions);
        trackSink(this as AudioSink);
      }

      createMediaElementSource(element: HTMLMediaElement) {
        capturedElements.add(element);
        return super.createMediaElementSource(element);
      }
    };
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      if (!capturedElements.has(this)) trackSink(this);
      return nativePlay.call(this);
    };
  },

  async onPlayerApiReady(_: MusicPlayer, context) {
    options = await context.getConfig();
    // Microphone permission is only needed so enumerateDevices() returns
    // device labels. Release the capture stream right away instead of keeping
    // the default input device open (and the OS microphone-in-use indicator
    // on) for the whole session.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      for (const track of stream.getTracks()) track.stop();
    } catch (error) {
      console.warn(
        '[custom-output-device] microphone permission denied',
        error,
      );
    }
    navigator.mediaDevices.ondevicechange = async () => {
      await updateDeviceList(context);
      // Sinks already on the chosen device are skipped, so this only acts
      // when that device came back or a sink lost its device. With "Default"
      // selected Chromium follows the Windows default on its own.
      await applyToSinks(sinks);
    };

    document.addEventListener(
      'peard:audio-can-play',
      this.audioCanPlayHandler,
      { passive: true },
    );
    await updateDeviceList(context);
    await applyToSinks(sinks);
  },

  stop() {
    document.removeEventListener(
      'peard:audio-can-play',
      this.audioCanPlayHandler,
    );
    navigator.mediaDevices.ondevicechange = null;
    window.AudioContext = NativeAudioContext;
    HTMLMediaElement.prototype.play = nativePlay;
    sinks.clear();
  },

  async onConfigChange(config) {
    options = config;
    await applyToSinks(sinks);
  },
});
