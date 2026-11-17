import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';
import { waitForElement } from '@/utils/wait-for-element';

import { AudioRoute } from './audio-route';
import { KaraokeButton } from './components/KaraokeButton';
import { KaraokeOverlay } from './components/KaraokeOverlay';
import { loadOffset, nudgeOffset, saveOffset } from './lyric-offset';
import { getLyricsState } from './lyrics';
import { describeStreams, hasStreams, setCapturing } from './stems/audio-tap';
import { log, setLogSink } from './stems/diagnostics';
import { StemEngine, type StemStatus } from './stems/stem-engine';

import type { KaraokePluginConfig, LyricsSize } from './types';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

const FLOATING_BUTTON_DELAY_MS = 6000;
const SYNC_INTERVAL_MS = 100;

// Playback time without AI vocals before starting them over. Seeking and new
// songs normally take up to about 8 s to be covered, and a known failure does
// not need to wait for that.
const RECOVERY_DELAY_MS = 10000;
const FAILED_RECOVERY_DELAY_MS = 1500;
const NO_RECOVERY_NEAR_END_SECONDS = 15;
const LOG_INTERVAL_MS = 10000;
const PHONE_INTERVAL_MS = 500;

// The classic player bar, and the redesigned one some sessions are served.
const PLAYER_CONTROLS =
  '.right-controls-buttons, .ytMusicMiniPlayerRightSection';

const [isActive, setIsActive] = createSignal(false);
const [lyricsSize, setLyricsSize] = createSignal<LyricsSize>('medium');
const [notice, setNotice] = createSignal<string | null>(null);
const [isMono, setIsMono] = createSignal(false);
const [vocalLevel, setVocalLevel] = createSignal(0);
const [stemStatus, setStemStatus] = createSignal<StemStatus>('idle');
const [modelProgress, setModelProgress] = createSignal<number | null>(null);

const route = new AudioRoute(setIsMono);

let playerApi: MusicPlayer | null = null;
let audio: Compressor | null = null;
let vocalReduction = 1;
let aiVocals = false;
let currentRun = 0;
let context: RendererContext<KaraokePluginConfig> | null = null;
let engine: StemEngine | null = null;
let isStartingStems = false;
let stemSession = 0;
let phoneTimer: ReturnType<typeof setInterval> | null = null;
let phoneLinesKey = '';
let lastCoveredAt = 0;
let lastLoggedAt = 0;
let recoveredVideoId: string | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let unmountButton: (() => void) | null = null;
let unmountFloatingButton: (() => void) | null = null;
let unmountOverlay: (() => void) | null = null;

// Enabling the plugin mid-song misses that song's `peard:audio-can-play` event.
// Reloading the video at the same position fires it again.
const requestAudioNodes = () => {
  const videoId = playerApi?.getPlayerResponse()?.videoDetails.videoId;
  if (!playerApi || !videoId) return;

  playerApi.loadVideoById(
    videoId,
    playerApi.getCurrentTime(),
    playerApi.getUserPlaybackQualityPreference(),
  );
};

const getAiStatusText = () => {
  const status = stemStatus();
  const progress = modelProgress();

  if (status === 'idle') return null;
  if (status === 'loading-model' && progress !== null && progress < 100) {
    return t('plugins.karaoke.ai.model-progress', { percent: progress });
  }
  return t(`plugins.karaoke.ai.${status}`);
};

const stopStems = () => {
  stemSession++;
  route.setStemMix(false, 0);
  engine?.dispose().catch(console.error);
  engine = null;
};

const applyVocalLevel = (level: number) => {
  vocalReduction = 1 - level;
  setVocalLevel(level);
  route.setAmount(vocalReduction);
  engine?.setVocalGain(level);
};

const sendPhoneState = () => {
  const video = document.querySelector('video');
  if (!(context && video)) return;

  const { title, alternativeTitle, artist, videoId } = getSongInfo();
  const lyrics = getLyricsState();
  const lines = lyrics.status === 'ready' ? lyrics.lines : [];
  const linesKey = `${videoId}:${lines.length}`;

  if (linesKey !== phoneLinesKey) {
    phoneLinesKey = linesKey;
    context.ipc.send(
      'karaoke:phone-lines',
      lines.map((line) => ({
        t: line.timeInMs,
        d: line.duration ?? 0,
        x: line.text.trim(),
      })),
    );
  }

  context.ipc.send('karaoke:phone-state', {
    title: alternativeTitle ?? title,
    artist,
    time: video.currentTime,
    duration: video.duration || 0,
    paused: video.paused,
    ad: Boolean(document.querySelector('.ad-showing')),
    karaoke: isActive(),
    vocalLevel: vocalLevel(),
    offsetMs: loadOffset(videoId),
    linesKey,
    lyricsMessage:
      lyrics.status === 'searching'
        ? t('plugins.karaoke.lyrics.searching')
        : t('plugins.karaoke.lyrics.not-found'),
  });
};

const applyPhoneRemote = (isOn: boolean) => {
  if (isOn) {
    phoneLinesKey = '';
    phoneTimer ??= setInterval(sendPhoneState, PHONE_INTERVAL_MS);
  } else {
    if (phoneTimer !== null) clearInterval(phoneTimer);
    phoneTimer = null;
  }
};

const applyConfig = (config: KaraokePluginConfig) => {
  const wasOn = aiVocals;
  aiVocals = config.aiVocals;
  setCapturing(aiVocals);
  applyPhoneRemote(config.phoneRemote);
  setLyricsSize(config.lyricsSize);
  applyVocalLevel(1 - config.vocalReduction);
  if (!aiVocals) stopStems();
  // Audio is only read as it arrives, so the current song has to load again.
  if (aiVocals && !wasOn && isActive()) requestAudioNodes();
};

const startStems = async (audioContext: AudioContext) => {
  if (!context || engine || isStartingStems) return;

  isStartingStems = true;
  const session = stemSession;
  try {
    const stems = new StemEngine(context.ipc, setStemStatus);
    const player = await stems.createPlayer(audioContext);

    // Karaoke mode may have been turned off while the player was starting. It
    // must not be kept, because it would be wired to an output that has gone.
    if (session !== stemSession || !route.connectStems(player)) {
      await stems.dispose();
      return;
    }

    stems.setVocalGain(vocalLevel());
    engine = stems;
    lastCoveredAt = Date.now();
  } finally {
    isStartingStems = false;
  }
};

const describeState = () => {
  const video = document.querySelector('video');
  const buffered = video
    ? Array.from({ length: video.buffered.length }, (_, index) => {
        const start = video.buffered.start(index).toFixed(0);
        return `${start}-${video.buffered.end(index).toFixed(0)}`;
      }).join(',')
    : '';
  return `t=${video?.currentTime.toFixed(1)} dur=${video?.duration.toFixed(1)} ready=${video?.readyState} volume=${video?.volume.toFixed(2)} muted=${video?.muted} paused=${video?.paused} src=${video?.src.slice(0, 12)} buffered=${buffered} ad=${Boolean(document.querySelector('.ad-showing'))} status=${stemStatus()} engine={${engine?.describe() ?? 'none'}} streams=${describeStreams()}`;
};

// Does what turning the AI option off and on does: starts capture and the model
// over, and loads the song again so that all of its audio arrives. Once per song,
// because a song that cannot work should not keep interrupting playback.
const recoverStems = (videoId: string) => {
  console.warn('[karaoke] AI vocals stopped, starting them over');
  log(`RECOVERY ${describeState()}`);
  recoveredVideoId = videoId;
  stopStems();
  setStemStatus('recovering');
  setCapturing(false);
  setCapturing(aiVocals);
  requestAudioNodes();
};

// Keeps the stems on the video's clock, and decides which audio is heard.
const syncStems = () => {
  const video = document.querySelector('video');
  if (!(video && audio && playerApi && aiVocals)) return;

  if (!engine) {
    startStems(audio.audioContext).catch((error: unknown) => {
      console.error('[karaoke] AI vocals failed:', error);
      setStemStatus('failed');
    });
    return;
  }

  const time = video.currentTime;
  // An ad plays in the same video element, so its clock is not the song's.
  const isAdPlaying = Boolean(document.querySelector('.ad-showing'));
  const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;

  if (videoId && !isAdPlaying && Number.isFinite(video.duration)) {
    engine.play(videoId, video.duration);
    engine.setPlayhead(time);
  }

  const useStems =
    videoId !== undefined &&
    !isAdPlaying &&
    // The stems can only play at normal speed.
    video.playbackRate === 1 &&
    engine.isCovering(videoId, time);

  // A stalled video keeps reporting that it is not paused, so check it is moving.
  const isAdvancing =
    !video.paused &&
    !video.seeking &&
    video.readyState >= video.HAVE_FUTURE_DATA;

  engine.sync(time, useStems && isAdvancing);
  route.setStemMix(useStems, video.muted ? 0 : video.volume);

  const isDueStems =
    isAdvancing &&
    !isAdPlaying &&
    video.playbackRate === 1 &&
    stemStatus() !== 'loading-model' &&
    video.duration - time > NO_RECOVERY_NEAR_END_SECONDS;

  if (Date.now() - lastLoggedAt > LOG_INTERVAL_MS) {
    lastLoggedAt = Date.now();
    log(`state useStems=${useStems} ${describeState()}`);
  }

  if (useStems || !isDueStems) {
    lastCoveredAt = Date.now();
  } else if (
    videoId &&
    videoId !== recoveredVideoId &&
    Date.now() - lastCoveredAt >
      (stemStatus() === 'failed' ? FAILED_RECOVERY_DELAY_MS : RECOVERY_DELAY_MS)
  ) {
    recoverStems(videoId);
  }
};

const onAudioCanPlay = ({ detail }: CustomEvent<Compressor>) => {
  audio = detail;
  if (isActive()) route.engage(detail, vocalReduction).catch(console.error);
};

const findNotice = async () => {
  const { isEnabled } = window.mainConfig.plugins;

  if (!(await isEnabled('synced-lyrics'))) {
    return t('plugins.karaoke.overlay.needs-synced-lyrics');
  }
  // These keep their own connection to the player, which bypasses the filter.
  if ((await isEnabled('audio-compressor')) || (await isEnabled('equalizer'))) {
    return t('plugins.karaoke.overlay.vocals-may-leak');
  }
  return null;
};

// Bumped by every enter and exit, so an entry that was cancelled while it
// waited for the audio route stops instead of finishing its setup.
let entryGeneration = 0;

const enter = async () => {
  const generation = ++entryGeneration;
  setIsActive(true);

  if (audio) await route.engage(audio, vocalReduction);
  if (generation !== entryGeneration) {
    // Exit ran during the await, and the late engage undid its disengage.
    if (!isActive()) route.disengage();
    return;
  }

  // Without any captured audio, loading the song again provides some.
  if (!audio || (aiVocals && !hasStreams())) requestAudioNodes();

  syncTimer ??= setInterval(syncStems, SYNC_INTERVAL_MS);
  setNotice(await findNotice());
};

const exit = () => {
  entryGeneration++;
  setIsActive(false);
  if (syncTimer !== null) clearInterval(syncTimer);
  syncTimer = null;
  stopStems();
  route.disengage();
};

const changeVocalLevel = (level: number) => {
  applyVocalLevel(level);
  Promise.resolve(context?.setConfig({ vocalReduction: 1 - level })).catch(
    console.error,
  );
};

const toggle = () => {
  if (isActive()) exit();
  else enter().catch(console.error);
};

const onPhoneCommand = (action: string, value: unknown) => {
  const video = document.querySelector('video');
  const number = typeof value === 'number' ? value : 0;

  switch (action) {
    case 'toggle-play': {
      if (video?.paused) playerApi?.playVideo();
      else playerApi?.pauseVideo();
      break;
    }
    case 'previous': {
      playerApi?.previousVideo();
      break;
    }
    case 'next': {
      playerApi?.nextVideo();
      break;
    }
    case 'seek': {
      playerApi?.seekTo(number);
      break;
    }
    case 'vocals': {
      changeVocalLevel(Math.min(1, Math.max(0, number)));
      break;
    }
    case 'nudge-lyrics': {
      const { videoId } = getSongInfo();
      saveOffset(videoId, nudgeOffset(loadOffset(videoId), number));
      break;
    }
    case 'toggle-karaoke': {
      toggle();
      break;
    }
  }
};

const mount = (parent: Element, content: () => unknown) => {
  const host = document.createElement('div');
  host.style.display = 'contents';
  parent.append(host);

  const dispose = render(content as () => Element, host);
  return () => {
    dispose();
    host.remove();
  };
};

export const renderer = createRenderer<object, KaraokePluginConfig>({
  async start(ctx) {
    currentRun++;
    context = ctx;
    setLogSink((line) => ctx.ipc.send('karaoke:log', line));
    ctx.ipc.on('karaoke:model-progress', setModelProgress);
    ctx.ipc.on('karaoke:phone-command', onPhoneCommand);
    applyConfig(await ctx.getConfig());
    document.addEventListener('peard:audio-can-play', onAudioCanPlay, {
      passive: true,
    });
  },

  async onPlayerApiReady(api) {
    playerApi = api;

    unmountOverlay = mount(document.body, () => (
      <Show when={isActive()}>
        <KaraokeOverlay
          aiStatus={getAiStatusText()}
          notice={isMono() ? t('plugins.karaoke.overlay.mono') : notice()}
          onExit={exit}
          onVocalLevel={changeVocalLevel}
          size={lyricsSize()}
          vocalLevel={vocalLevel()}
        />
      </Show>
    ));

    const button = () => (
      <KaraokeButton
        active={isActive()}
        label={t('plugins.karaoke.button')}
        onClick={toggle}
      />
    );

    // The player bar builds its controls late, and YouTube Music may ship another
    // layout. The floating button keeps karaoke reachable either way.
    const run = currentRun;
    const floatingButtonTimer = setTimeout(() => {
      if (run !== currentRun) return;
      unmountFloatingButton = mount(document.body, () => (
        <div class="karaoke-floating-button">{button()}</div>
      ));
    }, FLOATING_BUTTON_DELAY_MS);

    const controls = await waitForElement(PLAYER_CONTROLS);
    clearTimeout(floatingButtonTimer);
    if (run !== currentRun) return;

    unmountFloatingButton?.();
    unmountFloatingButton = null;
    unmountButton = mount(controls, button);
  },

  onConfigChange(config) {
    applyConfig(config);
  },

  stop() {
    currentRun++;
    exit();
    setCapturing(false);
    setLogSink(null);
    applyPhoneRemote(false);
    context?.ipc.removeAllListeners('karaoke:model-progress');
    context?.ipc.removeAllListeners('karaoke:phone-command');
    context = null;
    document.removeEventListener('peard:audio-can-play', onAudioCanPlay);
    unmountButton?.();
    unmountFloatingButton?.();
    unmountOverlay?.();
    unmountButton = null;
    unmountFloatingButton = null;
    unmountOverlay = null;
  },
});
