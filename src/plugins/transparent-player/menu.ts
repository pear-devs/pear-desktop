import is from 'electron-is';

import { t } from '@/i18n';

import { MaterialType } from './types';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';
import type { TransparentPlayerConfig } from './types';

const opacityList = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

export const onMenu = async ({
  getConfig,
  setConfig,
}: MenuContext<TransparentPlayerConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();
  const typeList = is.windows()
    ? [
        MaterialType.MICA,
        MaterialType.ACRYLIC,
        MaterialType.TABBED,
        MaterialType.NONE,
      ]
    : is.macOS()
      ? [
          MaterialType.WINDOW,
          MaterialType.FULLSCREEN_UI,
          MaterialType.CONTENT,
          MaterialType.UNDER_WINDOW,
          MaterialType.UNDER_PAGE,
          MaterialType.NONE,
        ]
      : [MaterialType.NONE];

  return [
    {
      label: t('plugins.transparent-player.menu.opacity.label'),
      submenu: opacityList.map((opacity) => ({
        label: t('plugins.transparent-player.menu.opacity.submenu.percent', {
          opacity: opacity * 100,
        }),
        type: 'radio',
        checked: config.opacity === opacity,
        click() {
          setConfig({ opacity });
        },
      })),
    },
    {
      label: t('plugins.transparent-player.menu.type.label'),
      submenu: typeList.map((type) => ({
        label: t(`plugins.transparent-player.menu.type.submenu.${type}`),
        type: 'radio',
        checked: config.type === type,
        click() {
          setConfig({ type });
        },
      })),
    },
  ];
};
