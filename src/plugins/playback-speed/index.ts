import prompt, { type KeybindOptions } from 'custom-electron-prompt';
import { globalShortcut } from 'electron';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { createPlugin } from '@/utils';

import { onPlayerApiReady, onUnload } from './renderer';

export type PlaybackSpeedPluginConfig = {
  enabled: boolean;
  step: number;
  globalShortcuts: {
    speedUp: string;
    speedDown: string;
  };
};

export default createPlugin({
  name: () => t('plugins.playback-speed.name'),
  description: () => t('plugins.playback-speed.description'),
  restartNeeded: false,
  config: {
    enabled: false,
    step: 0.1,
    globalShortcuts: {
      speedUp: '',
      speedDown: '',
    },
  } as PlaybackSpeedPluginConfig,
  renderer: {
    stop: onUnload,
    onPlayerApiReady,
  },

  menu: async ({ getConfig, setConfig, window }) => {
    const config = await getConfig();

    const kb = (
      label_: string,
      value_: string,
      default_: string,
    ): KeybindOptions => ({
      value: value_,
      label: label_,
      default: default_ || undefined,
    });

    async function promptGlobalShortcuts() {
      const output = await prompt(
        {
          title: t('plugins.playback-speed.prompt.global-shortcuts.title'),
          label: t('plugins.playback-speed.prompt.global-shortcuts.label'),
          type: 'keybind',
          keybindOptions: [
            kb(
              t(
                'plugins.playback-speed.prompt.global-shortcuts.keybind-options.increase',
              ),
              'speedUp',
              config.globalShortcuts?.speedUp,
            ),
            kb(
              t(
                'plugins.playback-speed.prompt.global-shortcuts.keybind-options.decrease',
              ),
              'speedDown',
              config.globalShortcuts?.speedDown,
            ),
          ],
          ...promptOptions(),
        },
        window,
      );

      if (output) {
        const newGlobalShortcuts = { speedUp: '', speedDown: '' };
        for (const { value, accelerator } of output) {
          newGlobalShortcuts[value as keyof typeof newGlobalShortcuts] =
            accelerator;
        }

        setConfig({ globalShortcuts: newGlobalShortcuts });
      }
    }

    return [
      {
        label: t('plugins.playback-speed.menu.global-shortcuts'),
        click: () => promptGlobalShortcuts(),
      },
    ];
  },

  async backend({ getConfig, ipc }) {
    const config = await getConfig();

    const register = (shortcut: string, delta: number) => {
      try {
        globalShortcut.register(shortcut, () =>
          ipc.send('changePlaybackSpeed', delta),
        );
      } catch (error) {
        console.warn(`Failed to register global shortcut "${shortcut}"`, error);
      }
    };

    if (config.globalShortcuts?.speedUp) {
      register(config.globalShortcuts.speedUp, config.step);
    }

    if (config.globalShortcuts?.speedDown) {
      register(config.globalShortcuts.speedDown, -config.step);
    }
  },
});
