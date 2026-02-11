import { ipcRenderer } from 'electron';

import { createPreload } from '@/utils';

export const preload = createPreload({
  start() {
    let checkCount = 0;
    const maxChecks = 20;

    const findUserInfo = async () => {
      try {
        let avatar: string | null = null;

        // Find avatar first - this is always visible
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

        // Now get the username by clicking the settings button if we don't have it
        const settingsButton =
          document.querySelector('ytmusic-settings-button button') ||
          document.querySelector(
            'ytmusic-settings-button tp-yt-paper-icon-button',
          );

        let name = 'Pear Desktop User';

        if (settingsButton) {
          // Click to open the menu
          (settingsButton as HTMLElement).click();

          // Wait for the menu to appear
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
                name;
              break;
            }
          }

          // Close the menu by pressing Escape
          document.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27 }),
          );
        }

        ipcRenderer.send('discord:youtube-info', { name, avatar });
        return true;
      } catch (e) {
        console.error('Failed to fetch YouTube user info:', e);
        return false;
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
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      // Also try immediately
      findUserInfo();
    };

    if (document.body) {
      startObserver();
    } else {
      document.addEventListener('DOMContentLoaded', startObserver);
    }
  },
});
