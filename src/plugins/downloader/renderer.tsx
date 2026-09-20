import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';

import { defaultConfig as appDefaultConfig } from '@/config/defaults';
import { t } from '@/i18n';
import {
  isAlbumOrPlaylist,
  isMusicOrVideoTrack,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';

import { DownloadButton } from './templates/download';
import { DownloadProgressPanel } from './templates/progress-panel';
import {
  type DownloadState,
  type DownloadTask,
  DownloaderIPC,
  type PlaybackProgress,
} from './types';

import type { DownloaderPluginConfig } from './index';
import type { RendererContext } from '@/types/contexts';
import type { MusicPlayer } from '@/types/music-player';

/** How often the playback position is reported to the backend */
const PLAYBACK_REPORT_INTERVAL = 1000;

let download: () => void;
let rendererIpc: RendererContext<DownloaderPluginConfig>['ipc'] | undefined;

const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');
const [tasks, setTasks] = createSignal<DownloadTask[]>([]);
const [collapsed, setCollapsed] = createSignal(false);
const [showProgress, setShowProgress] = createSignal(true);

let buttonContainer: HTMLDivElement | null = null;
let panelContainer: HTMLDivElement | null = null;

const menuObserver = new MutationObserver(() => {
  const menu = getSongMenu();

  if (
    !menu ||
    menu.contains(buttonContainer) ||
    !(isMusicOrVideoTrack() || isAlbumOrPlaylist()) ||
    !buttonContainer
  ) {
    return;
  }

  menu.prepend(buttonContainer);
});

export const onRendererLoad = async ({
  ipc,
  getConfig,
}: RendererContext<DownloaderPluginConfig>) => {
  rendererIpc = ipc;

  download = () => {
    const songMenu = getSongMenu();

    let videoUrl = songMenu
      ?.querySelector(
        'ytmusic-menu-navigation-item-renderer[tabindex="0"] #navigation-endpoint',
      )
      ?.getAttribute('href');

    if (!videoUrl && songMenu) {
      for (const it of songMenu.querySelectorAll(
        'ytmusic-menu-navigation-item-renderer[tabindex="-1"] #navigation-endpoint',
      )) {
        if (it.getAttribute('href')?.includes('podcast/')) {
          videoUrl = it.getAttribute('href');
          break;
        }
      }
    }

    if (videoUrl) {
      if (videoUrl.startsWith('watch?')) {
        videoUrl = appDefaultConfig.url + '/' + videoUrl;
      }

      if (videoUrl.startsWith('podcast/')) {
        videoUrl =
          appDefaultConfig.url + '/watch?' + videoUrl.replace('podcast/', 'v=');
      }

      if (videoUrl.includes('?playlist=')) {
        ipc.invoke('download-playlist-request', videoUrl);
        return;
      }
    } else {
      videoUrl = getSongInfo().url || window.location.href;
    }

    ipc.invoke('download-song', videoUrl);
  };

  ipc.on('downloader-feedback', (feedback: string) => {
    const targetHtml = feedback || t('plugins.downloader.templates.button');
    setDownloadButtonText(targetHtml);
  });

  ipc.on(DownloaderIPC.state, (state: DownloadState) => {
    setTasks(state.tasks ?? []);
  });

  setShowProgress((await getConfig()).showProgress ?? true);
};

export const onRendererConfigChange = (newConfig: DownloaderPluginConfig) => {
  setShowProgress(newConfig.showProgress ?? true);
};

const mountProgressPanel = () => {
  if (panelContainer) return;

  panelContainer = document.createElement('div');
  panelContainer.classList.add('ytmd-downloader-panel-host');
  document.body.append(panelContainer);

  render(
    () => (
      <Show when={showProgress() && tasks().length > 0}>
        <DownloadProgressPanel
          collapsed={collapsed()}
          onCancel={(id) => rendererIpc?.send(DownloaderIPC.cancel, id)}
          onClear={() => rendererIpc?.send(DownloaderIPC.clearFinished)}
          onDismiss={(id) => rendererIpc?.send(DownloaderIPC.dismiss, id)}
          onRetry={(id) => rendererIpc?.send(DownloaderIPC.retry, id)}
          onToggle={() => setCollapsed((value) => !value)}
          tasks={tasks()}
        />
      </Show>
    ),
    panelContainer,
  );
};

/**
 * Reports the playback position to the backend.
 *
 * "Download on finish" used to rely on the shared song-info provider, which
 * only emits time updates once another plugin asked for them. Reading the
 * player directly makes the trigger independent of that setup.
 */
const setupPlaybackReporting = (
  playerApi: MusicPlayer,
  ipc: RendererContext<DownloaderPluginConfig>['ipc'],
) => {
  // Not cached: the player swaps the element on some navigations
  const readPlayback = (): PlaybackProgress | null => {
    const video = document.querySelector('video');

    const duration =
      video && Number.isFinite(video.duration) && video.duration > 0
        ? video.duration
        : (playerApi.getDuration?.() ?? 0);
    const elapsed =
      video && Number.isFinite(video.currentTime)
        ? video.currentTime
        : (playerApi.getCurrentTime?.() ?? 0);
    // The player is the source of truth here: it changes at the same moment
    // as the position and duration above, the shared song info can lag behind
    const videoId =
      playerApi.getVideoData?.()?.video_id || getSongInfo().videoId || '';

    if (!videoId || !Number.isFinite(duration) || duration <= 0) return null;

    return { videoId, elapsed, duration, paused: video?.paused ?? false };
  };

  let lastSignature = '';
  const report = () => {
    try {
      const playback = readPlayback();
      if (!playback) return;

      // While paused the position does not move, so this also keeps the
      // channel quiet without having to skip paused playback entirely
      const signature = `${playback.videoId}:${Math.floor(playback.elapsed)}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      ipc.send(DownloaderIPC.playbackProgress, playback);
    } catch (error: unknown) {
      console.warn('[downloader] could not read playback position', error);
    }
  };

  setInterval(report, PLAYBACK_REPORT_INTERVAL);
  report();
};

export const onPlayerApiReady = (
  playerApi: MusicPlayer,
  context: RendererContext<DownloaderPluginConfig>,
) => {
  // First, so a missing DOM node further down cannot take the automatic
  // downloads and the progress panel with it
  setupPlaybackReporting(playerApi, context.ipc);
  mountProgressPanel();

  // Tell the backend that the UI is up, so it can resend running downloads
  context.ipc.send(DownloaderIPC.rendererReady);

  setDownloadButtonText(t('plugins.downloader.templates.button'));

  buttonContainer = document.createElement('div');
  buttonContainer.classList.add(
    'style-scope',
    'menu-item',
    'ytmusic-menu-popup-renderer',
  );
  buttonContainer.setAttribute('aria-disabled', 'false');
  buttonContainer.setAttribute('aria-selected', 'false');
  buttonContainer.setAttribute('role', 'option');
  buttonContainer.setAttribute('tabindex', '-1');

  render(
    () => (
      <DownloadButton onClick={() => download()} text={downloadButtonText()} />
    ),
    buttonContainer,
  );

  const popupContainer = document.querySelector('ytmusic-popup-container');
  if (popupContainer) {
    menuObserver.observe(popupContainer, {
      childList: true,
      subtree: true,
    });
  } else {
    console.warn('[downloader] no popup container, menu entry is unavailable');
  }
};
