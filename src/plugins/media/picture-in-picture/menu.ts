import prompt from 'custom-electron-prompt';

import promptOptions from '@/providers/prompt-options';

import { t } from '@/i18n';

import type { PictureInPicturePluginConfig } from './index';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
}: MenuContext<PictureInPicturePluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  return [
    {
      label: t('plugins.picture-in-picture.menu.always-on-top'),
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click(item) {
        setConfig({ alwaysOnTop: item.checked });
        window.setAlwaysOnTop(item.checked);
      },
    },
    {
      label: t('plugins.picture-in-picture.menu.save-window-position'),
      type: 'checkbox',
      checked: config.savePosition,
      click(item) {
        setConfig({ savePosition: item.checked });
      },
    },
    {
      label: t('plugins.picture-in-picture.menu.save-window-size'),
      type: 'checkbox',
      checked: config.saveSize,
      click(item) {
        setConfig({ saveSize: item.checked });
      },
    },
    {
      label: t('plugins.picture-in-picture.menu.hotkey.label'),
      type: 'checkbox',
      checked: !!config.hotkey,
      async click(item) {
        const output = await prompt(
          {
            title: t('plugins.picture-in-picture.menu.prompt.title'),
            label: t('plugins.picture-in-picture.menu.prompt.label'),
            type: 'keybind',
            keybindOptions: [
              {
                value: 'hotkey',
                label: t(
                  'plugins.picture-in-picture.menu.prompt.keybind-options.hotkey',
                ),
                default: config.hotkey,
              },
            ],
            ...promptOptions(),
          },
          window,
        );

        if (output) {
          const { value, accelerator } = output[0];
          setConfig({ [value]: accelerator });

          item.checked = !!accelerator;
        } else {
          // Reset checkbox if prompt was canceled
          item.checked = !item.checked;
        }
      },
    },
    {
      label: t('plugins.picture-in-picture.menu.use-native-pip'),
      type: 'checkbox',
      checked: config.useNativePiP,
      click(item) {
        setConfig({ useNativePiP: item.checked });
      },
    },
  ];
};
