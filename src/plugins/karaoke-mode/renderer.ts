import { t } from '@/i18n';
import { createRenderer } from '@/utils';

import type { SeparatedStems, SeparationProgress } from './backend';
import type { KaraokeModePluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; progress: SeparationProgress | null }
  // Stems are on disk for this song but not loaded (karaoke is off)
  | { kind: 'cached' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

// Restart the stems when they drift this far from the video (seconds)
const DRIFT_LIMIT = 0.08;
// Time constant for gain changes, short enough to avoid clicks
const RAMP = 0.015;
const MAX_VOCAL_VOLUME = 100;
// Below this, the gaps Demucs leaves in the instrumental become audible;
// a little vocal bleed masks them. The allowMute option lifts the limit.
const MIN_VOCAL_VOLUME = 10;

/** Plays the instrumental and vocal stems from a given media position. */
class StemPlayer {
  readonly output: GainNode;
  readonly vocalsGain: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private startOffset = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly vocals: AudioBuffer,
    private readonly instrumental: AudioBuffer,
    destination: AudioNode,
  ) {
    this.output = ctx.createGain();
    this.output.connect(destination);
    this.vocalsGain = ctx.createGain();
    this.vocalsGain.connect(this.output);
  }

  get playing() {
    return this.sources.length > 0;
  }

  /** Media time the stems are at right now. */
  position() {
    return this.startOffset + (this.ctx.currentTime - this.startedAt);
  }

  start(offset: number) {
    this.stop();
    const when = this.ctx.currentTime;
    const tracks = [
      [this.instrumental, this.output],
      [this.vocals, this.vocalsGain],
    ] as const;
    for (const [buffer, target] of tracks) {
      if (offset >= buffer.duration) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(target);
      source.start(when, offset);
      this.sources.push(source);
    }
    this.startedAt = when;
    this.startOffset = offset;
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      source.disconnect();
    }
    this.sources = [];
  }

  dispose() {
    this.stop();
    this.vocalsGain.disconnect();
    this.output.disconnect();
  }
}

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

let config: KaraokeModePluginConfig;
let ipc: RendererContext<KaraokeModePluginConfig>['ipc'];
let setConfig: RendererContext<KaraokeModePluginConfig>['setConfig'];
let api: MusicPlayer | null = null;

let video: HTMLVideoElement | null = null;
let audioContext: AudioContext | null = null;
let bus: AudioNode | null = null;
let mixGate: GainNode | null = null;

let currentId: string | null = null;
let player: StemPlayer | null = null;
let playerId: string | null = null;
let status: Status = { kind: 'idle' };
let request = 0;
let driftTimer: number | undefined;
let saveTimer: number | undefined;

const minVolume = () => (config.allowMute ? 0 : MIN_VOCAL_VOLUME);
const clampVolume = (value: number) =>
  Math.max(minVolume(), Math.min(MAX_VOCAL_VOLUME, Math.round(value)));

/** The current song's stems are decoded and ready to play. */
const stemsReady = () => player !== null && playerId === currentId;
/** Karaoke is on and actually playing the stems for this song. */
const karaokeOn = () => config.active && stemsReady();

/** Routes audio through the stems or the original mix, and keeps them in sync. */
const apply = () => {
  if (!audioContext || !mixGate || !video) return;
  const now = audioContext.currentTime;

  const usable =
    karaokeOn() &&
    !video.paused &&
    !video.seeking &&
    video.playbackRate === 1 &&
    video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA;

  if (player && usable) {
    // The stems bypass the <video> element, so apply its volume here
    player.output.gain.setTargetAtTime(
      video.muted ? 0 : video.volume,
      now,
      RAMP,
    );
    player.vocalsGain.gain.setTargetAtTime(config.vocalVolume / 100, now, RAMP);
    if (
      !player.playing ||
      Math.abs(player.position() - video.currentTime) > DRIFT_LIMIT
    ) {
      player.start(video.currentTime);
    }
    mixGate.gain.setTargetAtTime(0, now, RAMP);
  } else {
    player?.stop();
    mixGate.gain.setTargetAtTime(1, now, RAMP);
  }
};

const setStatus = (next: Status) => {
  status = next;
  updateControl();
};

/**
 * Separates the song (or reads it from the cache) and loads the stems.
 * `retry` lets a click try again after a failure; automatic triggers don't.
 */
const loadStems = async (videoId: string, retry = false) => {
  if (!audioContext || !bus) return;
  if (playerId === videoId) return;
  if (status.kind === 'working') return;
  if (status.kind === 'error' && !retry) return;

  const token = ++request;
  setStatus({ kind: 'working', progress: null });
  try {
    const stems = (await ipc.invoke(
      'karaoke-mode:separate',
      videoId,
    )) as SeparatedStems;
    if (token !== request || videoId !== currentId) return;

    const [vocals, instrumental] = await Promise.all([
      audioContext.decodeAudioData(toArrayBuffer(stems.vocals)),
      audioContext.decodeAudioData(toArrayBuffer(stems.instrumental)),
    ]);
    if (token !== request || videoId !== currentId) return;

    player?.dispose();
    player = new StemPlayer(audioContext, vocals, instrumental, bus);
    playerId = videoId;
    setStatus({ kind: 'ready' });
    apply();
  } catch (error) {
    if (token !== request) return;
    const message = error instanceof Error ? error.message : String(error);
    console.error('[karaoke-mode]', message);
    setStatus({ kind: 'error', message });
  }
};

const onSongChange = () => {
  const id = api?.getVideoData()?.video_id ?? null;
  if (!id || id === currentId) return;

  currentId = id;
  player?.dispose();
  player = null;
  playerId = null;
  request++;
  setStatus({ kind: 'idle' });
  apply();

  if (config.separateAlways) {
    loadStems(id);
    return;
  }

  // Otherwise only a click separates; but reuse stems already on disk
  (ipc.invoke('karaoke-mode:is-cached', id) as Promise<boolean>)
    .then((cached) => {
      if (!cached || id !== currentId || status.kind !== 'idle') return;
      if (config.active) loadStems(id);
      else setStatus({ kind: 'cached' });
    })
    .catch(() => {});
};

const setActive = (active: boolean) => {
  config = { ...config, active };
  setConfig({ active });
  apply();
  updateControl();
};

/** Icon click: turn karaoke on (separating if needed) or off. */
const toggleKaraoke = () => {
  if (config.active && (stemsReady() || status.kind === 'working')) {
    setActive(false);
    return;
  }
  setActive(true);
  if (!stemsReady() && currentId) loadStems(currentId, true);
};

// ------------------------------------------------------------------ UI
const SVG_NS = 'http://www.w3.org/2000/svg';
// Material "record_voice_over" icon (speaking head, like 🗣️)
const VOICE_PATH =
  'M9 13c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm6.08-7.95c.84 1.18.84 2.71 0 3.89l1.68 1.69c2.02-2.02 2.02-5.07 0-7.27l-1.68 1.69zM20.07 2l-1.63 1.63c2.77 3.02 2.77 7.56 0 10.74L20.07 16c3.9-3.89 3.91-9.95 0-14z';

let control: HTMLElement | null = null;
let slider: HTMLInputElement | null = null;
let progressLabel: HTMLElement | null = null;

/** Short text shown next to the slider while separating. */
const progressText = () => {
  if (status.kind !== 'working') return '';
  const progress = status.progress;
  if (progress?.stage !== 'separating' || progress.percent === null) return '…';
  return `${Math.round(progress.percent)}%`;
};

const statusText = () => {
  switch (status.kind) {
    case 'working': {
      const progress = status.progress;
      if (progress?.stage === 'downloading')
        return t('plugins.karaoke-mode.status.downloading');
      const percent =
        progress?.percent !== null && progress?.percent !== undefined
          ? ` ${Math.round(progress.percent)}%`
          : '';
      return t('plugins.karaoke-mode.status.separating') + percent;
    }
    case 'error':
      return t('plugins.karaoke-mode.status.error', {
        message: status.message.split('\n').at(-1) ?? '',
      });
    case 'ready':
      return t('plugins.karaoke-mode.status.ready');
    case 'cached':
      return t('plugins.karaoke-mode.status.cached');
    default:
      return t('plugins.karaoke-mode.status.idle');
  }
};

const updateControl = () => {
  if (!control || !slider) return;
  slider.min = String(minVolume());
  slider.value = String(config.vocalVolume);
  control.dataset.state = status.kind;
  // Strike-through icon: karaoke isn't playing, you hear the original mix
  control.classList.toggle('inactive', !karaokeOn());

  const on = karaokeOn();
  control.title = [
    on
      ? t('plugins.karaoke-mode.state.on', { volume: config.vocalVolume })
      : t('plugins.karaoke-mode.state.off'),
    statusText(),
    on
      ? t('plugins.karaoke-mode.hint.turn-off')
      : t('plugins.karaoke-mode.hint.turn-on'),
  ].join('\n');

  if (progressLabel) progressLabel.textContent = progressText();
};

/** Slider: only changes the level, never starts a separation. */
const setVocalVolume = (value: number) => {
  config = { ...config, vocalVolume: clampVolume(value) };
  apply();
  updateControl();

  // Save once the user stops dragging
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(
    () => setConfig({ vocalVolume: config.vocalVolume }),
    500,
  );
};

const injectControl = () => {
  const volumeSlider = document.querySelector(
    'ytmusic-player-bar #volume-slider',
  );
  if (!volumeSlider?.parentElement || document.querySelector('#karaoke-mode'))
    return;

  control = document.createElement('div');
  control.id = 'karaoke-mode';

  const button = document.createElement('button');
  button.className = 'karaoke-mode-button';
  button.ariaLabel = t('plugins.karaoke-mode.toggle');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', VOICE_PATH);
  svg.append(path);
  // Corner dot: not separated / processing / ready / failed (see style.css)
  const badge = document.createElement('span');
  badge.className = 'karaoke-mode-status';
  button.append(svg, badge);
  button.addEventListener('click', toggleKaraoke);

  slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(minVolume());
  slider.max = String(MAX_VOCAL_VOLUME);
  slider.step = '5';
  slider.className = 'karaoke-mode-slider';
  slider.ariaLabel = t('plugins.karaoke-mode.name');
  slider.addEventListener('input', () => setVocalVolume(Number(slider!.value)));
  // Keep the player's own arrow-key shortcuts from also firing
  slider.addEventListener('keydown', (e) => e.stopPropagation());
  // Double-click resets the vocals to 100%
  slider.addEventListener('dblclick', () => setVocalVolume(100));

  // Clicks that reach ytmusic-player-bar toggle the player page
  for (const event of ['click', 'dblclick'] as const) {
    control.addEventListener(event, (e) => e.stopPropagation());
  }

  progressLabel = document.createElement('span');
  progressLabel.className = 'karaoke-mode-progress';

  control.append(button, slider, progressLabel);
  volumeSlider.parentElement.insertBefore(control, volumeSlider);
  updateControl();
};

// ------------------------------------------------------------ lifecycle
const mediaEvents = [
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'ratechange',
  'waiting',
  'volumechange',
  'ended',
  'emptied',
] as const;

const onAudioCanPlay = (e: CustomEvent<Compressor>) => {
  if (audioContext) return;
  ({ audioContext, audioSource: bus, mixGate } = e.detail);
  apply();
};

const onProgress = (progress: SeparationProgress) => {
  if (progress.videoId !== currentId || status.kind !== 'working') return;
  setStatus({ kind: 'working', progress });
};

export const renderer = createRenderer<object, KaraokeModePluginConfig>({
  async start(ctx) {
    config = await ctx.getConfig();
    ipc = ctx.ipc;
    setConfig = ctx.setConfig;
    // Older configs allowed 0–150%
    config.vocalVolume = clampVolume(config.vocalVolume);

    document.addEventListener('peard:audio-can-play', onAudioCanPlay, {
      passive: true,
    });
    ipc.on('karaoke-mode:progress', onProgress);
  },

  onPlayerApiReady(playerApi) {
    api = playerApi;
    video = document.querySelector<HTMLVideoElement>('video');
    for (const event of mediaEvents) video?.addEventListener(event, apply);
    document.addEventListener('videodatachange', onSongChange);
    driftTimer = window.setInterval(apply, 500);

    injectControl();
    onSongChange();
  },

  onConfigChange(newConfig) {
    const wasAlways = config.separateAlways;
    config = newConfig;
    // e.g. "allow muting" was turned off while vocals were below 10%
    if (clampVolume(config.vocalVolume) !== config.vocalVolume) {
      setVocalVolume(config.vocalVolume);
    }
    // Turning "Separate every song" on starts with the current song
    if (config.separateAlways && !wasAlways && currentId) {
      loadStems(currentId);
    }
    apply();
    updateControl();
  },

  stop() {
    document.removeEventListener('peard:audio-can-play', onAudioCanPlay);
    document.removeEventListener('videodatachange', onSongChange);
    ipc?.removeAllListeners('karaoke-mode:progress');
    for (const event of mediaEvents) video?.removeEventListener(event, apply);
    window.clearInterval(driftTimer);
    player?.dispose();
    player = null;
    playerId = null;
    mixGate?.gain.setTargetAtTime(1, audioContext?.currentTime ?? 0, RAMP);
    control?.remove();
    control = null;
    slider = null;
    progressLabel = null;
  },
});
