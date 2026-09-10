import { t } from '@/i18n';
import {
  claimPlaybackRate,
  getPlaybackRateOwner,
  isPlaybackRateControlledByOther,
  releasePlaybackRate,
} from '@/plugins/utils/renderer/playback-rate-owner';
import { createPlugin } from '@/utils';

import { getLatestAudioDetail, type AudioCanPlayDetail } from './audio-graph';
import {
  clampIntensity,
  clampSlow,
  computeDattorroParams,
  normalize,
} from './engine';
import {
  createCogButton,
  createPanel,
  findCogAnchor,
  type PanelHandle,
} from './panel';
import style from './style.css?inline';
import { DATTORRO_WORKLET_SOURCE } from './worklet';

import type { RendererContext } from '@/types/contexts';

export interface SlowedReverbConfig {
  enabled: boolean;
  slow: number;
  reverbIntensity: number;
  active: boolean;
}

type PitchKey = 'preservesPitch' | 'mozPreservesPitch' | 'webkitPreservesPitch';

interface SavedPitch {
  preservesPitch?: boolean;
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
}

const PITCH_KEYS: PitchKey[] = [
  'preservesPitch',
  'mozPreservesPitch',
  'webkitPreservesPitch',
];

const PLUGIN_ID = 'slowed-reverb';

const DEFAULT_CONFIG: SlowedReverbConfig = {
  enabled: false,
  slow: 1,
  reverbIntensity: 0,
  active: true,
};

function readPitch(video: HTMLVideoElement): SavedPitch {
  const record = video as unknown as Record<PitchKey, unknown>;
  const saved: SavedPitch = {};
  if (typeof record.preservesPitch === 'boolean') {
    saved.preservesPitch = record.preservesPitch;
  }
  if (typeof record.mozPreservesPitch === 'boolean') {
    saved.mozPreservesPitch = record.mozPreservesPitch;
  }
  if (typeof record.webkitPreservesPitch === 'boolean') {
    saved.webkitPreservesPitch = record.webkitPreservesPitch;
  }
  return saved;
}

function writePitchValue(
  video: HTMLVideoElement,
  key: PitchKey,
  value: boolean,
): void {
  if (!(key in video)) return;
  (video as unknown as Record<PitchKey, unknown>)[key] = value;
}

function clearPitch(video: HTMLVideoElement): void {
  for (const key of PITCH_KEYS) {
    writePitchValue(video, key, false);
  }
}

function restorePitch(video: HTMLVideoElement, saved: SavedPitch): void {
  if (saved.preservesPitch !== undefined) {
    writePitchValue(video, 'preservesPitch', saved.preservesPitch);
  }
  if (saved.mozPreservesPitch !== undefined) {
    writePitchValue(video, 'mozPreservesPitch', saved.mozPreservesPitch);
  }
  if (saved.webkitPreservesPitch !== undefined) {
    writePitchValue(video, 'webkitPreservesPitch', saved.webkitPreservesPitch);
  }
}

interface SlowedReverbRenderer {
  ctx: RendererContext<SlowedReverbConfig> | null;
  config: SlowedReverbConfig | null;
  audioContext: AudioContext | null;
  audioSource: MediaElementAudioSourceNode | null;
  wetGain: GainNode | null;
  reverbNode: AudioWorkletNode | null;
  workletReadyFor: AudioContext | null;
  workletFailed: boolean;
  workletLoad: Promise<void> | null;
  workletLoadFor: AudioContext | null;
  workletEpoch: number;
  wiredSource: MediaElementAudioSourceNode | null;
  video: HTMLVideoElement | null;
  originalRate: number;
  savedPitch: SavedPitch | null;
  watchdog: ReturnType<typeof setInterval> | null;
  observer: MutationObserver | null;
  cog: HTMLButtonElement | null;
  panel: PanelHandle | null;
  audioHandler: ((event: Event) => void) | null;
  docHandler: ((event: MouseEvent) => void) | null;
  rateHandler: ((event: Event) => void) | null;
  rateVideo: HTMLVideoElement | null;
  pitchOverridden: boolean;
  lastWetGain: number;
  start: (ctx: RendererContext<SlowedReverbConfig>) => Promise<void>;
  stop: () => void;
  onPlayerApiReady: () => void;
  onConfigChange: (newConfig: SlowedReverbConfig) => void;
  getCurrent: () => SlowedReverbConfig;
  claimRateIfEngaged: () => void;
  ensureUi: () => void;
  injectCog: () => void;
  togglePanel: () => void;
  closePanel: () => void;
  syncPanel: () => void;
  wireAudio: (
    audioContext: AudioContext,
    audioSource: MediaElementAudioSourceNode,
  ) => void;
  handleAudioEvent: (event: Event) => void;
  ensureWorklet: () => Promise<void>;
  applyReverb: () => void;
  applySlow: () => void;
  releasePitchOverride: (video: HTMLVideoElement) => void;
  attachRateListeners: () => void;
  detachRateListeners: () => void;
  startWatchdog: () => void;
  teardownAudio: () => void;
  restoreVideo: () => void;
}

export default createPlugin<
  unknown,
  unknown,
  SlowedReverbRenderer,
  SlowedReverbConfig
>({
  name: () => t('plugins.slowed-reverb.name'),
  description: () => t('plugins.slowed-reverb.description'),
  restartNeeded: false,
  config: { ...DEFAULT_CONFIG },
  stylesheets: [style],
  renderer: {
    ctx: null,
    config: null,
    audioContext: null,
    audioSource: null,
    wetGain: null,
    reverbNode: null,
    workletReadyFor: null,
    workletFailed: false,
    workletLoad: null,
    workletLoadFor: null,
    workletEpoch: 0,
    wiredSource: null,
    video: null,
    originalRate: 1,
    savedPitch: null,
    watchdog: null,
    observer: null,
    cog: null,
    panel: null,
    audioHandler: null,
    docHandler: null,
    rateHandler: null,
    rateVideo: null,
    pitchOverridden: false,
    lastWetGain: 0,

    async start(ctx) {
      this.ctx = ctx;
      const raw = await ctx.getConfig();
      const normalized = normalize(raw);
      this.config = {
        ...raw,
        slow: normalized.slow,
        reverbIntensity: normalized.reverbIntensity,
      };
      this.audioHandler = (event: Event) => {
        this.handleAudioEvent(event);
      };
      this.claimRateIfEngaged();
      document.addEventListener('peard:audio-can-play', this.audioHandler, {
        passive: true,
      });
      // Re-wire cached graph when re-enabled mid-song (nodes were torn down).
      // On the first enable mid-song the announcement already fired while the
      // plugin was unloaded: fall back to the graph cached at module scope so
      // the wet path engages for the current song instead of the next one.
      // A worklet load failure is also retried on every (re)enable instead of
      // disabling reverb for the rest of the app session.
      this.workletFailed = false;
      const announced = getLatestAudioDetail();
      const audioContext = this.audioContext ?? announced?.audioContext;
      const audioSource = this.audioSource ?? announced?.audioSource;
      if (audioContext && audioSource) {
        this.wireAudio(audioContext, audioSource);
      }
      this.ensureUi();
      this.applySlow();
      this.attachRateListeners();
      this.startWatchdog();
    },

    stop() {
      releasePlaybackRate(PLUGIN_ID);
      if (this.watchdog !== null) {
        clearInterval(this.watchdog);
        this.watchdog = null;
      }
      this.observer?.disconnect();
      this.observer = null;
      this.detachRateListeners();
      if (this.audioHandler) {
        document.removeEventListener('peard:audio-can-play', this.audioHandler);
        this.audioHandler = null;
      }
      this.closePanel();
      this.cog?.remove();
      this.cog = null;
      this.teardownAudio();
      this.restoreVideo();
    },

    onPlayerApiReady() {
      this.ensureUi();
      // applySlow() tail already attaches rate listeners; no extra call.
      this.applySlow();
    },

    onConfigChange(newConfig) {
      const normalized = normalize(newConfig);
      const previous = this.config;
      this.config = {
        ...newConfig,
        slow: normalized.slow,
        reverbIntensity: normalized.reverbIntensity,
      };
      // An external speed/activation change is an explicit intent: take the
      // rate back (reverb-only changes must not steal it from playback-speed).
      if (
        !previous ||
        previous.active !== this.config.active ||
        clampSlow(previous.slow) !== normalized.slow
      ) {
        this.claimRateIfEngaged();
      }
      this.applySlow();
      this.applyReverb();
      this.syncPanel();
    },

    getCurrent() {
      return this.config ?? { ...DEFAULT_CONFIG };
    },

    claimRateIfEngaged() {
      const current = this.getCurrent();
      if (current.active && clampSlow(current.slow) !== 1) {
        claimPlaybackRate(PLUGIN_ID);
      } else {
        releasePlaybackRate(PLUGIN_ID);
      }
    },

    ensureUi() {
      this.injectCog();
      if (!this.observer) {
        this.observer = new MutationObserver(() => {
          this.injectCog();
        });
        const target =
          document.querySelector('ytmusic-player-bar') ?? document.body;
        this.observer.observe(target, { childList: true, subtree: true });
      }
    },

    injectCog() {
      if (this.cog?.isConnected) return;
      const anchor = findCogAnchor();
      if (!anchor) return;
      if (!this.cog) {
        this.cog = createCogButton((event: MouseEvent) => {
          event.stopPropagation();
          this.togglePanel();
        });
      }
      anchor.parent.insertBefore(this.cog, anchor.before);
    },

    togglePanel() {
      if (this.panel) {
        this.closePanel();
        return;
      }
      const current = this.getCurrent();
      const handle = createPanel(
        {
          slow: clampSlow(current.slow),
          reverbIntensity: clampIntensity(current.reverbIntensity),
          active: current.active,
        },
        {
          onActiveChange: (active: boolean) => {
            this.config = { ...this.getCurrent(), active };
            this.ctx?.setConfig({ active });
            this.claimRateIfEngaged();
            this.applySlow();
            this.applyReverb();
            this.syncPanel();
          },
          onSlowLive: (value: number) => {
            this.config = { ...this.getCurrent(), slow: value };
            this.claimRateIfEngaged();
            this.applySlow();
          },
          onSlowCommit: (value: number) => {
            this.config = { ...this.getCurrent(), slow: value };
            this.ctx?.setConfig({ slow: value });
            this.claimRateIfEngaged();
            this.applySlow();
            this.syncPanel();
          },
          onReverbLive: (value: number) => {
            this.config = { ...this.getCurrent(), reverbIntensity: value };
            this.applyReverb();
          },
          onReverbCommit: (value: number) => {
            this.config = { ...this.getCurrent(), reverbIntensity: value };
            this.ctx?.setConfig({ reverbIntensity: value });
            this.applyReverb();
            this.syncPanel();
          },
          onReset: () => {
            this.config = {
              ...this.getCurrent(),
              slow: 1,
              reverbIntensity: 0,
              active: true,
            };
            this.ctx?.setConfig({
              slow: 1,
              reverbIntensity: 0,
              active: true,
            });
            this.claimRateIfEngaged();
            this.applySlow();
            this.applyReverb();
            this.syncPanel();
          },
        },
      );
      this.panel = handle;
      document.body.appendChild(handle.root);
      this.docHandler = (event: MouseEvent) => {
        if (!this.panel) return;
        const target = event.target;
        if (!(target instanceof Node)) return;
        if (this.panel.root.contains(target)) return;
        if (this.cog && (target === this.cog || this.cog.contains(target))) {
          return;
        }
        this.closePanel();
      };
      document.addEventListener('click', this.docHandler, { capture: true });
    },

    closePanel() {
      if (this.docHandler) {
        document.removeEventListener('click', this.docHandler, {
          capture: true,
        });
        this.docHandler = null;
      }
      this.panel?.destroy();
      this.panel = null;
    },

    syncPanel() {
      const handle = this.panel;
      if (!handle) return;
      const current = this.getCurrent();
      handle.sync({
        slow: clampSlow(current.slow),
        reverbIntensity: clampIntensity(current.reverbIntensity),
        active: current.active,
      });
    },

    wireAudio(audioContext, audioSource) {
      this.audioContext = audioContext;
      this.audioSource = audioSource;
      if (this.wiredSource === audioSource && this.wetGain) {
        this.applyReverb();
        return;
      }
      this.teardownAudio();
      try {
        this.wetGain = audioContext.createGain();
        // Additive only: the base audioSource -> destination path is never
        // disconnected and never duplicated here; our wet tail runs in
        // parallel with it: audioSource -> dattorroNode -> wetGain ->
        // destination. At defaults (intensity 0) the worklet outputs
        // silence, so enabling changes no loudness.
        this.wetGain.gain.value = 1;
        this.wetGain.connect(audioContext.destination);
        this.wiredSource = audioSource;
      } catch (error) {
        console.error('[slowed-reverb] wiring failed', error);
        this.teardownAudio();
        return;
      }
      this.applyReverb();
      if (this.workletFailed) return;
      this.ensureWorklet();
    },

    handleAudioEvent(event: Event) {
      const detail = (event as CustomEvent<AudioCanPlayDetail>).detail;
      if (!detail?.audioContext || !detail?.audioSource) return;
      this.wireAudio(detail.audioContext, detail.audioSource);
    },

    async ensureWorklet() {
      const audioContext = this.audioContext;
      const audioSource = this.audioSource;
      if (
        !audioContext ||
        !audioSource ||
        this.reverbNode ||
        this.workletFailed
      ) {
        return;
      }
      const epoch = this.workletEpoch;
      try {
        if (this.workletReadyFor !== audioContext) {
          // Share the in-flight module load so a re-wire mid-load awaits
          // the same promise instead of dropping reverb until next song.
          let load =
            this.workletLoadFor === audioContext ? this.workletLoad : null;
          if (!load) {
            const blob = new Blob([DATTORRO_WORKLET_SOURCE], {
              type: 'application/javascript',
            });
            const url = URL.createObjectURL(blob);
            load = (async () => {
              try {
                await audioContext.audioWorklet.addModule(url);
              } finally {
                URL.revokeObjectURL(url);
              }
            })();
            this.workletLoad = load;
            this.workletLoadFor = audioContext;
          }
          try {
            await load;
          } finally {
            if (this.workletLoad === load) {
              this.workletLoad = null;
              this.workletLoadFor = null;
            }
          }
          // Bail if stop()/teardownAudio() ran mid-flight: never connect
          // post-teardown.
          if (epoch !== this.workletEpoch) return;
          if (
            this.audioContext !== audioContext ||
            this.audioSource !== audioSource ||
            this.wetGain === null ||
            this.wiredSource !== audioSource
          ) {
            return;
          }
          this.workletReadyFor = audioContext;
        } else if (
          epoch !== this.workletEpoch ||
          this.audioContext !== audioContext ||
          this.audioSource !== audioSource ||
          this.wetGain === null ||
          this.wiredSource !== audioSource
        ) {
          // Drop stale loads: a newer graph was wired, or teardown ran,
          // while awaiting (or while skipping) the module load.
          return;
        }
        // A concurrent caller for this generation may have created the node
        // while we awaited the shared load: single node per generation.
        if (this.reverbNode) return;
        const node = new AudioWorkletNode(audioContext, 'dattorro-reverb', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        // Re-check after node creation, before any connect.
        if (
          epoch !== this.workletEpoch ||
          this.audioContext !== audioContext ||
          this.audioSource !== audioSource ||
          this.wetGain === null ||
          this.wiredSource !== audioSource ||
          this.reverbNode
        ) {
          try {
            node.disconnect();
          } catch {}
          return;
        }
        audioSource.connect(node);
        node.connect(this.wetGain);
        this.reverbNode = node;
        this.applyReverb();
      } catch (error) {
        // Slow-only fallback: rate/pitch keeps working without reverb.
        console.error(
          '[slowed-reverb] worklet load failed, slow-only fallback',
          error,
        );
        this.workletFailed = true;
        this.applyReverb();
      }
    },

    applyReverb() {
      const current = this.getCurrent();
      const intensity = current.active
        ? clampIntensity(current.reverbIntensity)
        : 0;
      const params = computeDattorroParams(intensity);
      // No dry tap: the base path carries dry at unity. The wet tail is
      // silent at intensity 0 (params.wetGain 0 inside the worklet), so
      // enabling at defaults changes no loudness. Worklet failure just
      // skips the wet path and slow keeps working.
      if (this.wetGain) {
        this.wetGain.gain.value = 1;
      }
      const prevWet = this.lastWetGain;
      this.lastWetGain = params.wetGain;
      try {
        if (prevWet === 0 && params.wetGain > 0) {
          this.reverbNode?.port.postMessage({ type: 'reset' });
        }
        this.reverbNode?.port.postMessage({ type: 'setParams', params });
      } catch {}
    },

    applySlow() {
      const current = this.getCurrent();
      const slow = current.active ? clampSlow(current.slow) : 1;
      if (slow !== 1) {
        // Engaged but unowned: take the rate. Taking it back from another
        // plugin is reserved for explicit user actions (panel callbacks), so
        // a reverb-only change cannot steal playback-speed's rate.
        if (getPlaybackRateOwner() === null) {
          claimPlaybackRate(PLUGIN_ID);
        }
      } else {
        releasePlaybackRate(PLUGIN_ID);
      }
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;
      if (this.video !== video) {
        this.video = video;
        this.originalRate = video.playbackRate || 1;
        this.savedPitch = readPitch(video);
      }
      if (isPlaybackRateControlledByOther(PLUGIN_ID)) {
        // Another plugin owns the rate: yield instead of fighting, but undo
        // our pitch override so its playback stays pitch-preserved.
        this.releasePitchOverride(video);
        this.attachRateListeners();
        return;
      }
      const target = slow !== 1 ? slow : this.originalRate || 1;
      // No-op writes fire no ratechange: never write when already at target.
      if (Math.abs(video.playbackRate - target) <= 0.001) {
        // Track <video> replacement (YouTube swaps the element on song
        // change): idempotent, moves listeners when the element changes.
        this.attachRateListeners();
        return;
      }
      try {
        if (slow !== 1) {
          clearPitch(video);
          this.pitchOverridden = true;
          video.playbackRate = slow;
        } else {
          this.releasePitchOverride(video);
          video.playbackRate = this.originalRate || 1;
        }
      } catch {}
      // Track <video> replacement (YouTube swaps the element on song
      // change): idempotent, moves listeners when the element changes.
      this.attachRateListeners();
    },

    releasePitchOverride(video) {
      if (!this.pitchOverridden) return;
      // Only restore flags we set on this element; after a <video> swap the
      // new element carries its own defaults.
      if (video === this.video && this.savedPitch) {
        restorePitch(video, this.savedPitch);
      }
      this.pitchOverridden = false;
    },

    attachRateListeners() {
      // Re-query every time: the <video> element may have been replaced.
      const video = document.querySelector<HTMLVideoElement>('video');
      if (!video) return;
      if (this.rateVideo === video) return;
      this.detachRateListeners();
      if (!this.rateHandler) {
        // YouTube resets playbackRate to 1x on every song change;
        // re-apply immediately instead of waiting for the watchdog tick.
        // Mirrors src/plugins/playback-speed/renderer.tsx convention.
        // Guarded: no-op while inactive, nothing to do at slow 1x, and
        // drift-checked so an already-correct rate never re-writes (a
        // write that changes nothing fires no ratechange). While another
        // plugin owns the rate we never touch playbackRate (answering it
        // would queue a ratechange per write for both plugins, forever),
        // but we still release our pitch override so the other plugin's
        // speed is not left with pitch-shifted timbre.
        this.rateHandler = (event: Event) => {
          const current = this.getCurrent();
          if (!current.active) return;
          const slow = clampSlow(current.slow);
          if (slow === 1) return;
          const video =
            event.target instanceof HTMLVideoElement
              ? event.target
              : document.querySelector<HTMLVideoElement>('video');
          if (!video) return;
          if (isPlaybackRateControlledByOther(PLUGIN_ID)) {
            // Ownership moved to playback-speed: its write emitted this
            // ratechange, so drop our pitch override or its speed keeps our
            // pitch-shifted timbre.
            this.releasePitchOverride(video);
            return;
          }
          if (Math.abs(video.playbackRate - slow) <= 0.001) return;
          if (
            event.type === 'peard:src-changed' ||
            Math.abs(video.playbackRate - 1) <= 0.001
          ) {
            this.applySlow();
          }
        };
      }
      video.addEventListener('ratechange', this.rateHandler);
      video.addEventListener('peard:src-changed', this.rateHandler);
      this.rateVideo = video;
    },

    detachRateListeners() {
      if (this.rateVideo && this.rateHandler) {
        this.rateVideo.removeEventListener('ratechange', this.rateHandler);
        this.rateVideo.removeEventListener(
          'peard:src-changed',
          this.rateHandler,
        );
      }
      this.rateVideo = null;
    },

    startWatchdog() {
      if (this.watchdog !== null) return;
      this.watchdog = setInterval(() => {
        // Re-track <video> replacement even when no rate drift is seen.
        this.attachRateListeners();
        const current = this.getCurrent();
        if (!current.active) return;
        const slow = clampSlow(current.slow);
        if (slow === 1) return;
        if (isPlaybackRateControlledByOther(PLUGIN_ID)) {
          const video = document.querySelector<HTMLVideoElement>('video');
          if (video) this.releasePitchOverride(video);
          return;
        }
        const video = document.querySelector<HTMLVideoElement>('video');
        if (video && Math.abs(video.playbackRate - slow) > 0.001) {
          this.applySlow();
        }
      }, 2000);
    },

    teardownAudio() {
      // Invalidate any in-flight ensureWorklet() so it never connects
      // post-teardown.
      this.workletEpoch += 1;
      // Never touch audioSource -> destination; only detach our own wet tap.
      const source = this.wiredSource ?? this.audioSource;
      try {
        if (source && this.reverbNode) source.disconnect(this.reverbNode);
      } catch {}
      try {
        this.reverbNode?.disconnect();
      } catch {}
      try {
        this.wetGain?.disconnect();
      } catch {}
      this.wetGain = null;
      this.reverbNode = null;
      this.wiredSource = null;
    },

    restoreVideo() {
      const video =
        this.video ?? document.querySelector<HTMLVideoElement>('video');
      if (!video) {
        this.video = null;
        return;
      }
      try {
        if (this.savedPitch) restorePitch(video, this.savedPitch);
        // Don't stomp a rate another plugin took over while we were loaded
        // (only relevant when we never held the rate in the first place).
        if (!isPlaybackRateControlledByOther(PLUGIN_ID)) {
          video.playbackRate = this.originalRate || 1;
        }
      } catch {}
      this.pitchOverridden = false;
      this.video = null;
    },
  },
});
