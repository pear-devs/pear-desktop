import { createSignal, untrack } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  isMusicOrVideoTrack,
  isPlayerMenu,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';

import { PitchSlider } from './components/slider';
import { clampSemitones } from './constants';
import { PROCESSOR_NAME, registerPitchShifterProcessor } from './processor';

import type { PitchShifterPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

const [semitones, setSemitones] = createSignal(0);

let enabled = false;
let saveSemitones: ((value: number) => void) | undefined;

// Other plugins (Equalizer, Audio Compressor, visualizers) connect their nodes
// straight to `audioContext.destination`. If the shifter only sat between the
// media source and the destination, those paths would still carry the song
// in its original key on top of the shifted one. So the shifter takes over
// the destination instead: `input` replaces `audioContext.destination` on the
// context, and everything that reaches it is shifted on its way to the real
// output. When the plugin is off, `input` connects straight to the output.
let graph:
  | {
      context: AudioContext;
      input: GainNode;
      output: AudioDestinationNode;
      shifter?: AudioWorkletNode;
    }
  | undefined;

const loadProcessor = (context: AudioContext) => {
  const source = `(${registerPitchShifterProcessor.toString()})(${JSON.stringify(PROCESSOR_NAME)});`;
  const url = URL.createObjectURL(
    new Blob([source], { type: 'text/javascript' }),
  );
  return context.audioWorklet
    .addModule(url)
    .finally(() => URL.revokeObjectURL(url));
};

const applySemitones = () => {
  if (!graph?.shifter) return;
  graph.shifter.parameters
    .get('semitones')
    ?.setValueAtTime(untrack(semitones), graph.context.currentTime);
};

const route = () => {
  if (!graph) return;
  const { input, output, shifter } = graph;
  input.disconnect();
  if (enabled && shifter) {
    input.connect(shifter);
  } else {
    input.connect(output);
  }
};

const installGraph = (
  source: MediaElementAudioSourceNode,
  context: AudioContext,
) => {
  const output = context.destination;
  const input = context.createGain();
  Object.defineProperty(context, 'destination', {
    configurable: true,
    value: input,
  });
  try {
    source.disconnect(output);
  } catch {}
  source.connect(input);
  input.connect(output);
  graph = { context, input, output };

  loadProcessor(context)
    .then(() => {
      if (graph?.context !== context) return;
      const shifter = new AudioWorkletNode(context, PROCESSOR_NAME, {
        outputChannelCount: [2],
      });
      shifter.connect(output);
      graph.shifter = shifter;
      applySemitones();
      route();
    })
    .catch((error) => {
      console.error('[pitch-shifter] failed to load the processor', error);
    });
};

// Runs in the capture phase on window, so the destination is replaced before
// any other plugin's listener on document connects to it.
const audioCanPlayHandler = (event: Event) => {
  const { audioSource, audioContext } = (event as CustomEvent<Compressor>)
    .detail;
  if (graph?.context !== audioContext) installGraph(audioSource, audioContext);
};

const changeSemitones = (value: number) => {
  const next = clampSemitones(value);
  if (next === semitones()) return;
  setSemitones(next);
  applySemitones();
  saveSemitones?.(next);
};

const sliderContainer = document.createElement('div');
let popupObserver: MutationObserver | undefined;
let disposeSlider: (() => void) | undefined;

const mountSlider = () => {
  disposeSlider = render(
    () => (
      <PitchSlider
        onChange={changeSemitones}
        onWheel={(e) => {
          e.preventDefault();
          changeSemitones(semitones() + (e.deltaY < 0 ? 1 : -1));
        }}
        semitones={semitones()}
        title={t('plugins.pitch-shifter.templates.button')}
      />
    ),
    sliderContainer,
  );

  popupObserver = new MutationObserver(() => {
    const menu = getSongMenu();
    if (
      menu &&
      !menu.contains(sliderContainer) &&
      isMusicOrVideoTrack() &&
      isPlayerMenu(menu)
    ) {
      menu.prepend(sliderContainer);
    }
  });

  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (popupContainer) {
    popupObserver.observe(popupContainer, { childList: true, subtree: true });
  }
};

// The audio graph only exists once a track has loaded. When the plugin is
// enabled mid-song, reload the current track in place to receive it.
const ensureAudioContextLoad = (playerApi: MusicPlayer) => {
  if (playerApi.getPlayerState() !== 1 || graph) return;

  playerApi.loadVideoById(
    playerApi.getPlayerResponse().videoDetails.videoId,
    playerApi.getCurrentTime(),
    playerApi.getUserPlaybackQualityPreference(),
  );
};

export const start = async ({
  getConfig,
  setConfig,
}: RendererContext<PitchShifterPluginConfig>) => {
  enabled = true;
  saveSemitones = (value) => setConfig({ semitones: value });
  // Listen before awaiting anything, so the first track is not missed.
  window.addEventListener('peard:audio-can-play', audioCanPlayHandler, {
    capture: true,
    passive: true,
  });

  setSemitones(clampSemitones((await getConfig()).semitones));
  applySemitones();
  route();
};

export const onPlayerApiReady = (playerApi: MusicPlayer) => {
  ensureAudioContextLoad(playerApi);
  if (!disposeSlider) mountSlider();
};

export const onConfigChange = (config: PitchShifterPluginConfig) => {
  setSemitones(clampSemitones(config.semitones));
  applySemitones();
};

export const stop = () => {
  enabled = false;
  saveSemitones = undefined;
  window.removeEventListener('peard:audio-can-play', audioCanPlayHandler, {
    capture: true,
  });
  route();

  popupObserver?.disconnect();
  popupObserver = undefined;
  disposeSlider?.();
  disposeSlider = undefined;
  sliderContainer.remove();
};
