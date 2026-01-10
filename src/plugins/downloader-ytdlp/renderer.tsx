import { createSignal, Show } from 'solid-js';

import { render } from 'solid-js/web';

import { defaultConfig } from '@/config/defaults';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';
import { t } from '@/i18n';
import {
  isAlbumOrPlaylist,
  isMusicOrVideoTrack,
} from '@/plugins/utils/renderer/check';

import { DownloadButton } from './templates/download';

import type { RendererContext } from '@/types/contexts';
import type { DownloaderPluginConfig } from './index';

let download: () => void;

// Toast notification state
const [toast, setToast] = createSignal<{
  message: string;
  title?: string;
} | null>(null);
let toastTimeout: number | undefined;

const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');

let buttonContainer: HTMLDivElement | null = null;

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

export const onRendererLoad = ({
  ipc,
}: RendererContext<DownloaderPluginConfig>) => {
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
        videoUrl = defaultConfig.url + '/' + videoUrl;
      }

      if (videoUrl.startsWith('podcast/')) {
        videoUrl =
          defaultConfig.url + '/watch?' + videoUrl.replace('podcast/', 'v=');
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

  // Listen for error toasts from backend
  ipc.on(
    'downloader-error-toast',
    (data: { message: string; title?: string }) => {
      setToast(data);
      if (toastTimeout) clearTimeout(toastTimeout);
      toastTimeout = window.setTimeout(() => setToast(null), 10000); // Auto-hide after 10s
    },
  );
};

export const onPlayerApiReady = () => {
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
    () => <DownloadButton onClick={download} text={downloadButtonText()} />,
    buttonContainer,
  );

  menuObserver.observe(document.querySelector('ytmusic-popup-container')!, {
    childList: true,
    subtree: true,
  });

  // Render toast container
  let toastDiv = document.getElementById('ytmd-toast-container');
  if (!toastDiv) {
    toastDiv = document.createElement('div');
    toastDiv.id = 'ytmd-toast-container';
    document.body.appendChild(toastDiv);
  }
  render(
    () => (
      <Show when={toast()}>
        <div
          class="ytmd-toast"
          onClick={() => {
            navigator.clipboard.writeText(toast()?.message || '');
            setToast(null);
          }}
          style={{
            'position': 'fixed',
            'bottom': '32px',
            'left': '50%',
            'transform': 'translateX(-50%)',
            'background': '#222',
            'color': '#fff',
            'padding': '16px 24px',
            'border-radius': '8px',
            'box-shadow': '0 2px 8px #0008',
            'z-index': '9999',
            'max-width': '80vw',
            'font-size': '15px',
            'cursor': 'pointer',
          }}
          title="Click to copy error message and dismiss"
        >
          <strong>{toast()?.title || 'Error'}</strong>
          <br />
          <span style={{ 'white-space': 'pre-wrap' }}>{toast()?.message}</span>
          <div
            style={{ 'font-size': '12px', 'margin-top': '8px', 'opacity': 0.7 }}
          >
            Click to copy & dismiss
          </div>
        </div>
      </Show>
    ),
    toastDiv,
  );
};
