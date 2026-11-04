import { t } from '@/i18n';

import type { KaraokePluginConfig, LyricsSize } from './types';
import type { MenuContext } from '@/types/contexts';
import type { MenuItemConstructorOptions } from 'electron';

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
