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
        ],
        height: 270,
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

  async function promptSeekKeybind(
    config: ShortcutsPluginConfig,
    win: BrowserWindow,
  ) {
    const output = await prompt(
      {
        title: t('plugins.shortcuts.prompt.seek-keybind.title'),
        label: t('plugins.shortcuts.prompt.seek-keybind.label'),
        type: 'keybind',
        keybindOptions: [
          kb(
            t('plugins.shortcuts.prompt.seek-keybind.keybind-options.forward'),
            'forward',
            config.seekGlobalShortcuts?.forward,
          ),
          kb(
            t('plugins.shortcuts.prompt.seek-keybind.keybind-options.backward'),
            'backward',
            config.seekGlobalShortcuts?.backward,
          ),
        ],
        ...promptOptions(),
      },
      win,
    );

    if (output) {
      const newSeekGlobalShortcuts = { forward: '', backward: '' };
      for (const { value, accelerator } of output) {
        newSeekGlobalShortcuts[value as keyof typeof newSeekGlobalShortcuts] =
          accelerator;
      }

      setConfig({ seekGlobalShortcuts: newSeekGlobalShortcuts });
    }
  }

  async function promptSeekSeconds(config: ShortcutsPluginConfig) {
    const output = await prompt(
      {
        title: t('plugins.shortcuts.prompt.seek-seconds.title'),
        label: t('plugins.shortcuts.prompt.seek-seconds.label'),
        value: config.seekSeconds || 10,
        type: 'counter',
        counterOptions: { minimum: 1, maximum: 120, multiFire: true },
        width: 380,
        ...promptOptions(),
      },
      window,
    );

    if (output || output === 0) {
      setConfig({ seekSeconds: Number(output) });
    }
  }

  return [
    {
      label: t('plugins.shortcuts.menu.set-keybinds'),
      click: () => promptKeybind(config, window),
    },
    {
      label: t('plugins.shortcuts.menu.override-media-keys'),
      type: 'checkbox',
      checked: config.overrideMediaKeys,
      click: (item) => setConfig({ overrideMediaKeys: item.checked }),
    },
    {
      label: t('plugins.shortcuts.menu.focus-window-on-double-play-pause'),
      type: 'checkbox',
      checked: config.focusWindowOnDoublePlayPause,
      click: (item) =>
        setConfig({ focusWindowOnDoublePlayPause: item.checked }),
    },
    {
      label: t('plugins.shortcuts.menu.set-seek-keybinds'),
      click: () => promptSeekKeybind(config, window),
    },
    {
      label: t('plugins.shortcuts.menu.set-seek-seconds'),
      click: () => promptSeekSeconds(config),
    },
  ];
};
