import { t } from '@/i18n';

import { providerNames } from './providers';

import type { MenuItemConstructorOptions } from 'electron';
import type { MenuContext } from '@/types/contexts';

export const menu = async (
  ctx: MenuContext,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();

  return [
    {
      label: t('plugins.lyrics-provider.menu.preferred-provider.label'),
      toolTip: t('plugins.lyrics-provider.menu.preferred-provider.tooltip'),
      type: 'submenu',
      submenu: [
        {
          label: t('plugins.lyrics-provider.menu.preferred-provider.none.label'),
          toolTip: t(
            'plugins.lyrics-provider.menu.preferred-provider.none.tooltip',
          ),
          type: 'radio',
          checked: config.preferredProvider === null,
          click() {
            ctx.setConfig({ preferredProvider: null });
          },
        },
        ...providerNames.map(
          (provider) =>
            ({
              label: provider,
              type: 'radio',
              checked: config.preferredProvider === provider,
              click() {
                ctx.setConfig({ preferredProvider: provider });
              },
            }) as const,
        ),
      ],
    },
  ];
};