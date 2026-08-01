import type { MenuContext } from '@/types/contexts';
import type { MenuItemConstructorOptions } from 'electron';

import type { StatusbarLyricsPluginConfig } from './index';

export const menu = async (
  ctx: MenuContext<StatusbarLyricsPluginConfig>,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();

  return [
    {
      label: 'Include pronunciation',
      toolTip: 'Include pronunciation or romanization lines in the status bar text when available.',
      type: 'checkbox',
      checked: config.includePronunciation,
      click(item) {
        ctx.setConfig({ includePronunciation: item.checked });
      },
    },
  ];
};
