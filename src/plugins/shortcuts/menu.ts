import prompt, { type KeybindOptions } from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import type { SeekSecondsKey, ShortcutsPluginConfig } from './index';
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
      const global = { ...config.global };

      for (const { value, accelerator } of output) {
        global[value as keyof ShortcutsPluginConfig['global']] = accelerator;
      }

      config.global = global;
      await setConfig({ global });
      // Rebuild the menu so the prompt shows the new keybinds next time
      await refresh();
    }
    // Else -> pressed cancel
  }

  async function promptSeekSeconds(
    key: SeekSecondsKey,
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

    // The counter prompt returns a string, but seek controls need a number
    const seconds = Number(output);
    if (output && Number.isFinite(seconds) && seconds > 0) {
      config[key] = seconds;
      await setConfig({ [key]: seconds });
      await refresh();
    }
  }

  const seekSecondsItem = (
    key: SeekSecondsKey,
    menuKey: string,
    promptKey: string,
  ): MenuTemplate => [
    {
      label: t(`plugins.shortcuts.menu.${menuKey}`, { seconds: config[key] }),
      click: () =>
        promptSeekSeconds(
          key,
          t(`plugins.shortcuts.prompt.${promptKey}.title`),
          t(`plugins.shortcuts.prompt.${promptKey}.label`),
          window,
        ),
    },
  ];

  return [
    {
      label: t('plugins.shortcuts.menu.set-keybinds'),
      click: () => promptKeybind(config, window),
    },
    ...seekSecondsItem(
      'seekForwardSeconds',
      'set-seek-forward-seconds',
      'seek-forward-seconds',
    ),
    ...seekSecondsItem(
      'seekBackwardSeconds',
      'set-seek-backward-seconds',
      'seek-backward-seconds',
    ),
    ...seekSecondsItem(
      'podcastSeekForwardSeconds',
      'set-podcast-seek-forward-seconds',
      'seek-forward-seconds',
    ),
    ...seekSecondsItem(
      'podcastSeekBackwardSeconds',
      'set-podcast-seek-backward-seconds',
      'seek-backward-seconds',
    ),
    {
      label: t('plugins.shortcuts.menu.override-media-keys'),
      type: 'checkbox',
      checked: config.overrideMediaKeys,
      click: (item) => setConfig({ overrideMediaKeys: item.checked }),
    },
  ];
};
