import { dialog, type MenuItemConstructorOptions } from 'electron';

import { t } from '@/i18n';

import { showPhoneQr } from './phone-qr';
import { getPhoneLink, isPhoneServerRunning } from './phone-server';

import type { KaraokePluginConfig, LyricsSize } from './types';
import type { MenuContext } from '@/types/contexts';

const lyricsSizes: LyricsSize[] = ['small', 'medium', 'large'];

export const menu = async (
  ctx: MenuContext<KaraokePluginConfig>,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();

  return [
    {
      label: t('plugins.karaoke.menu.ai-vocals.label'),
      toolTip: t('plugins.karaoke.menu.ai-vocals.tooltip'),
      type: 'checkbox',
      checked: config.aiVocals,
      click(item) {
        ctx.setConfig({ aiVocals: item.checked });
      },
    },
    {
      label: t('plugins.karaoke.menu.phone-remote.label'),
      toolTip: t('plugins.karaoke.menu.phone-remote.tooltip'),
      type: 'checkbox',
      checked: config.phoneRemote,
      async click(item) {
        await ctx.setConfig({ phoneRemote: item.checked });
        await ctx.refresh();
      },
    },
    {
      label: t('plugins.karaoke.menu.phone-link.label'),
      enabled: config.phoneRemote,
      async click() {
        const link = getPhoneLink();
        if (link && isPhoneServerRunning()) {
          showPhoneQr(ctx.window, link);
          return;
        }

        await dialog.showMessageBox(ctx.window, {
          type: link ? 'error' : 'info',
          title: t('plugins.karaoke.menu.phone-link.label'),
          message: link
            ? t('plugins.karaoke.menu.phone-link.not-running')
            : t('plugins.karaoke.menu.phone-link.no-network'),
        });
      },
    },
    {
      label: t('plugins.karaoke.menu.lyrics-size.label'),
      type: 'submenu',
      submenu: lyricsSizes.map((size) => ({
        label: t(`plugins.karaoke.menu.lyrics-size.${size}`),
        type: 'radio',
        checked: config.lyricsSize === size,
        click() {
          ctx.setConfig({ lyricsSize: size });
        },
      })),
    },
  ];
};
