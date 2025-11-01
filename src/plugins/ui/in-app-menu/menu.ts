import is from 'electron-is';

import { t } from '@/i18n';

import type { InAppMenuConfig } from './constants';
import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

export const onMenu = async ({
  getConfig,
  setConfig,
}: MenuContext<InAppMenuConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  if (is.linux()) {
    return [
      {
        label: t('plugins.in-app-menu.menu.hide-dom-window-controls'),
        type: 'checkbox',
        checked: config.hideDOMWindowControls,
        click(item) {
          config.hideDOMWindowControls = item.checked;
          setConfig(config);
        },
      },
    ];
  }

  return [];
};
