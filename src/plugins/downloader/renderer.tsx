import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

import { defaultConfig } from '@/config/defaults';
import { t } from '@/i18n';
import {
  isAlbumOrPlaylist,
  isMusicOrVideoTrack,
} from '@/plugins/utils/renderer/check';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';

import { DownloadButton } from './templates/download';

import type { DownloaderIpc, downloaderConfig } from './config';

export default createRenderer<typeof downloaderConfig, DownloaderIpc>((ctx) => {
  // Options are only read by the backend.
  ctx.onConfigChange(() => {});

  const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');

  const download = () => {
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
        ctx.ipc.invoke('downloadPlaylist', videoUrl);
        return;
      }
    } else {
      videoUrl = getSongInfo().url || window.location.href;
    }

    ctx.ipc.invoke('downloadSong', videoUrl);
  };

  ctx.ipc.on('feedback', (feedback) => {
    const targetHtml = feedback || t('plugins.downloader.templates.button');
    setDownloadButtonText(targetHtml);
  });

  ctx.onPlayerApiReady(() => {
    setDownloadButtonText(t('plugins.downloader.templates.button'));

    const buttonContainer = document.createElement('div');
    buttonContainer.classList.add(
      'style-scope',
      'menu-item',
      'ytmusic-menu-popup-renderer',
    );
    buttonContainer.setAttribute('aria-disabled', 'false');
    buttonContainer.setAttribute('aria-selected', 'false');
    buttonContainer.setAttribute('role', 'option');
    buttonContainer.setAttribute('tabindex', '-1');

    const dispose = render(
      () => <DownloadButton onClick={download} text={downloadButtonText()} />,
      buttonContainer,
    );
    ctx.onCleanup(() => {
      dispose();
      buttonContainer.remove();
    });

    const popupContainer = document.querySelector('ytmusic-popup-container');
    if (!popupContainer) return;
    ctx.observe(popupContainer, { childList: true, subtree: true }, () => {
      const menu = getSongMenu();

      if (
        !menu ||
        menu.contains(buttonContainer) ||
        !(isMusicOrVideoTrack() || isAlbumOrPlaylist())
      ) {
        return;
      }

      menu.prepend(buttonContainer);
    });
  });
});
