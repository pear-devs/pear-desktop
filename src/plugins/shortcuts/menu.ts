import prompt, { type KeybindOptions } from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import type { ShortcutsPluginConfig } from './index';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';
import type { BrowserWindow } from 'electron';

export const onMenu = async ({
  window,
  getConfig,
  setConfig,
  refresh,
}: MenuContext<ShortcutsPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  /**
   * Helper function for keybind prompt
   */
  const kb = (
    label_: string,
    value_: string,
    default_?: string,
  ): KeybindOptions => ({ value: value_, label: label_, default: default_ });

  async function promptKeybind(
    config: ShortcutsPluginConfig,
    win: BrowserWindow,
  ) {
    const output = await prompt(
      {
        title: t('plugins.shortcuts.prompt.keybind.title'),
        label: t('plugins.shortcuts.prompt.keybind.label'),
        type: 'keybind',
        keybindOptions: [
          // If default=undefined then no default is used
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.previous'),
            'previous',
            config.global?.previous,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.play-pause'),
            'playPause',
            config.global?.playPause,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.next'),
            'next',
            config.global?.next,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.seek-forward'),
            'seekForward',
            config.global?.seekForward,
          ),
          kb(
            t('plugins.shortcuts.prompt.keybind.keybind-options.seek-backward'),
            'seekBackward',
            config.global?.seekBackward,
          ),
        ],
        height: 370,
        ...promptOptions(),
      },
      win,
    );

    if (output) {
      const newConfig = { ...config };

      for (const { value, accelerator } of output) {
        newConfig.global[value as keyof ShortcutsPluginConfig['global']] =
          accelerator;
      }

      setConfig(config);
    }
    // Else -> pressed cancel
  }

  async function promptSeekSeconds(
    key: 'seekForwardSeconds' | 'seekBackwardSeconds',
    title: string,
    label: string,
    win: BrowserWindow,
  ) {
    const output = await prompt(
      {
        title,
        label,
        value: config[key],
        type: 'counter',
        counterOptions: { minimum: 1, maximum: 600, multiFire: true },
        width: 380,
        ...promptOptions(),
      },
      win,
    );

    if (output) {
      config[key] = output;
      await setConfig({ [key]: output });
      await refresh();
    }
  }

  return [
    {
      label: t('plugins.shortcuts.menu.set-keybinds'),
      click: () => promptKeybind(config, window),
    },
    {
      label: t('plugins.shortcuts.menu.set-seek-forward-seconds', {
        seconds: config.seekForwardSeconds,
      }),
      click: () =>
        promptSeekSeconds(
          'seekForwardSeconds',
          t('plugins.shortcuts.prompt.seek-forward-seconds.title'),
          t('plugins.shortcuts.prompt.seek-forward-seconds.label'),
          window,
        ),
    },
    {
      label: t('plugins.shortcuts.menu.set-seek-backward-seconds', {
        seconds: config.seekBackwardSeconds,
      }),
      click: () =>
        promptSeekSeconds(
          'seekBackwardSeconds',
          t('plugins.shortcuts.prompt.seek-backward-seconds.title'),
          t('plugins.shortcuts.prompt.seek-backward-seconds.label'),
          window,
        ),
    },
    {
      label: t('plugins.shortcuts.menu.override-media-keys'),
      type: 'checkbox',
      checked: config.overrideMediaKeys,
      click: (item) => setConfig({ overrideMediaKeys: item.checked }),
    },
  ];
};
