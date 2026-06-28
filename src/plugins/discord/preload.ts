import { createPreload } from '@/utils';

import type { RendererContext } from '@/types/contexts';
import type { DiscordPluginConfig } from './index';

export const preload = createPreload<object, DiscordPluginConfig>({});

export const onRendererLoad = async ({
  getConfig,
  ipc,
}: RendererContext<DiscordPluginConfig>) => {
  const config = await getConfig();
  if (!config.showApplicationUser) {
    return;
  }

  let checkCount = 0;
  const maxChecks = 20;
  let lookupInFlight = false;
  let sent = false;

  const findUserInfo = async () => {
    if (lookupInFlight || sent) {
      return false;
    }

    lookupInFlight = true;
    try {
      let avatar: string | null = null;

      const accountButton =
        document.querySelector<HTMLImageElement>(
          'ytmusic-settings-button img#img',
        ) ||
        document.querySelector<HTMLImageElement>(
          'ytmusic-settings-button yt-img-shadow img',
        ) ||
        document.querySelector<HTMLImageElement>(
          'ytmusic-settings-button img',
        );

      if (accountButton) {
        avatar = accountButton.src || accountButton.getAttribute('src');
      }

      if (!avatar || avatar.startsWith('data:')) {
        return false;
      }

      const settingsButton =
        document.querySelector('ytmusic-settings-button button') ||
        document.querySelector(
          'ytmusic-settings-button tp-yt-paper-icon-button',
        );

      let name: string | null = null;

      if (settingsButton) {
        (settingsButton as HTMLElement).click();

        for (let i = 0; i < 20; i++) {
          await new Promise((resolve) => setTimeout(resolve, 50));

          const accountNameElement =
            document.querySelector(
              'ytd-active-account-header-renderer #account-name',
            ) || document.querySelector('yt-formatted-string#account-name');

          if (accountNameElement) {
            name =
              accountNameElement.textContent?.trim() ||
              accountNameElement.getAttribute('title') ||
              null;
            break;
          }
        }

        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }),
        );
      }

      if (!name) {
        return false;
      }

      ipc.send('discord:youtube-info', { name, avatar });
      sent = true;
      return true;
    } catch (e) {
      console.error('Failed to fetch YouTube user info:', e);
      return false;
    } finally {
      lookupInFlight = false;
    }
  };

  const observer = new MutationObserver(() => {
    if (checkCount >= maxChecks) {
      observer.disconnect();
      return;
    }

    findUserInfo().then((found) => {
      if (found) {
        observer.disconnect();
      }
    });
    checkCount++;
  });

  const startObserver = () => {
    findUserInfo().then((found) => {
      if (found) {
        return;
      }

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  };

  if (document.body) {
    startObserver();
  } else {
    document.addEventListener('DOMContentLoaded', startObserver);
  }
};
