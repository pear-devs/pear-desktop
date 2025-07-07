import { createSignal } from 'solid-js';

import { render } from 'solid-js/web';

import defaultConfig from '@/config/defaults';
import { getSongMenu } from '@/providers/dom-elements';
import { getSongInfo } from '@/providers/song-info-front';
import { t } from '@/i18n';

import { DownloadButton } from './templates/download';

import type { RendererContext } from '@/types/contexts';
import type { DownloaderPluginConfig } from './index';

let menu: HTMLElement | null = null;
let download: () => void;

const [downloadButtonText, setDownloadButtonText] = createSignal<string>('');

let buttonContainer: HTMLDivElement | null = null;
let doneFirstLoad = false;

const menuObserver = new MutationObserver(() => {
  if (!menu) {
    menu = getSongMenu();
    if (!menu) {
      return;
    }
  }

  if (menu.contains(buttonContainer)) {
    return;
  }

  let menuUrl = document.querySelector<HTMLAnchorElement>(
    'tp-yt-paper-listbox [tabindex="0"] #navigation-endpoint',
  )?.href;
  if (!menuUrl?.includes('watch?')) {
    menuUrl = undefined;
    for (const it of document.querySelectorAll(
      'tp-yt-paper-listbox [tabindex="-1"] #navigation-endpoint',
    )) {
      if (it.getAttribute('href')?.includes('podcast/')) {
        menuUrl = it.getAttribute('href')!;
        break;
      }
    }
  }

  if (!menuUrl && doneFirstLoad) {
    return;
  }

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

  menu.prepend(buttonContainer);

  render(
    () => <DownloadButton onClick={download} text={downloadButtonText()} />,
    buttonContainer,
  );

  if (!doneFirstLoad) {
    setTimeout(() => (doneFirstLoad ||= true), 500);
  }
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
};

export const onPlayerApiReady = () => {
  setDownloadButtonText(t('plugins.downloader.templates.button'));
  menuObserver.observe(document.querySelector('ytmusic-popup-container')!, {
    childList: true,
    subtree: true,
  });
};
