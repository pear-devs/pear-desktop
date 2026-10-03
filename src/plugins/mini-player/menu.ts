import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { defaultConfig, type MiniPlayerPluginConfig } from './index';
import { isMiniPlayerOpen, toggle } from './main';

import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

const opacityList = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1];

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
}: MenuContext<MiniPlayerPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: isMiniPlayerOpen()
        ? t('plugins.mini-player.menu.close')
        : t('plugins.mini-player.menu.open'),
      click: () => toggle(),
    },
    { type: 'separator' },
    {
      label: t('plugins.mini-player.menu.opacity.label'),
      submenu: opacityList.map((opacity) => ({
        label: t('plugins.mini-player.menu.opacity.submenu.percent', {
          opacity: Math.round(opacity * 100),
        }),
        type: 'radio',
        checked: config.opacity === opacity,
        click() {
          setConfig({ opacity });
        },
      })),
    },
    {
      label: t('plugins.mini-player.menu.opaque-on-hover'),
      type: 'checkbox',
      checked: config.opaqueOnHover,
      click(item) {
        setConfig({ opaqueOnHover: item.checked });
      },
    },
    {
      label: t('plugins.mini-player.menu.always-on-top'),
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click(item) {
        setConfig({ alwaysOnTop: item.checked });
      },
    },
    {
      label: t('plugins.mini-player.menu.hide-main-window'),
      type: 'checkbox',
      checked: config.hideMainWindow,
      click(item) {
        setConfig({ hideMainWindow: item.checked });
      },
    },
    {
      label: t('plugins.mini-player.menu.open-on-start'),
      type: 'checkbox',
      checked: config.openOnStart,
      click(item) {
        setConfig({ openOnStart: item.checked });
      },
    },
    {
      label: t('plugins.mini-player.menu.hotkey.label'),
      type: 'checkbox',
      checked: !!config.hotkey,
      async click(item) {
        const output = await prompt(
          {
            title: t('plugins.mini-player.menu.hotkey.prompt.title'),
            label: t('plugins.mini-player.menu.hotkey.prompt.label'),
            type: 'keybind',
            keybindOptions: [
              {
                value: 'hotkey',
                label: t(
                  'plugins.mini-player.menu.hotkey.prompt.keybind-options.hotkey',
                ),
                default: config.hotkey,
              },
            ],
            ...promptOptions(),
          },
          window,
        );

        if (output) {
          const { accelerator } = output[0];
          setConfig({ hotkey: accelerator });
          item.checked = !!accelerator;
        } else {
          // Reset checkbox if prompt was canceled
          item.checked = !item.checked;
        }
      },
    },
    {
      label: t('plugins.mini-player.menu.reset-position'),
      click() {
        setConfig({
          position: defaultConfig.position,
          size: [...defaultConfig.size],
        });
      },
    },
  ];
};
