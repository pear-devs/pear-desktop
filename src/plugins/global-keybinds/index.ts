import { globalShortcut, ipcMain } from 'electron';
import prompt, { type KeybindOptions } from 'custom-electron-prompt';

import { eventRace } from './utils';
import { createPlugin } from '@/utils';

import promptOptions from '@/providers/prompt-options';
import { onPlayerApiReady } from './renderer';
import { t } from '@/i18n';
import type { BackendContext } from '@/types/contexts';

export type GlobalKeybindsPluginConfig = {
  enabled: boolean;
  dubleTapToogleWindowVisibility: boolean;
  volumeUp: KeybindsOptions;
  volumeDown: KeybindsOptions;
  tooglePlay: KeybindsOptions;
  nextTrack: KeybindsOptions;
  previousTrack: KeybindsOptions;
  likeTrack: KeybindsOptions;
  dislikeTrack: KeybindsOptions;
};

export type KeybindsOptions = {
  value: string;
  dobleTap?: boolean;
};

const KeybindsOptionsFactory = (value = ''): KeybindsOptions => ({
  value: value,
  dobleTap: false,
});

const defaultConfig: GlobalKeybindsPluginConfig = {
  enabled: false,
  dubleTapToogleWindowVisibility: true,
  volumeUp: KeybindsOptionsFactory('Shift+Ctrl+Up'),
  volumeDown: KeybindsOptionsFactory('Shift+Ctrl+Down'),
  tooglePlay: KeybindsOptionsFactory('Shift+Ctrl+Space'),
  nextTrack: KeybindsOptionsFactory('Shift+Ctrl+Right'),
  previousTrack: KeybindsOptionsFactory('Shift+Ctrl+Left'),
  likeTrack: KeybindsOptionsFactory('Shift+Ctrl+='),
  dislikeTrack: KeybindsOptionsFactory('Shift+Ctrl+-'),
};

const fields: Record<string, string> = {
  volumeUp: 'volume-up',
  volumeDown: 'volume-down',
  tooglePlay: 'toogle-play',
  nextTrack: 'next-track',
  previousTrack: 'previous-track',
  likeTrack: 'like-track',
  dislikeTrack: 'dislike-track',
};

export default createPlugin({
  name: () => t('plugins.global-keybinds.name'),
  description: () => t('plugins.global-keybinds.description'),
  addedVersion: '3.12.x',
  restartNeeded: false,
  config: Object.assign({}, defaultConfig),
  menu: async ({ setConfig, getConfig, window }) => {
    const config = await getConfig();

    function changeOptions(
      changedOptions: Partial<GlobalKeybindsPluginConfig>,
      options: GlobalKeybindsPluginConfig,
    ) {
      for (const option in changedOptions) {
        // HACK: Weird TypeScript error
        (options as Record<string, unknown>)[option] = (
          changedOptions as Record<string, unknown>
        )[option];
      }

      setConfig(options);
    }

    // Helper function for globalShortcuts prompt
    const kb = (
      label_: string,
      value_: string,
      default_: string,
    ): KeybindOptions => ({
      value: value_,
      label: label_,
      default: default_ || undefined,
    });

    async function promptGlobalShortcuts(options: GlobalKeybindsPluginConfig) {
      ipcMain.emit('global-keybinds:disable-all');
      const output = await prompt(
        {
          width: 500,
          title: t('plugins.global-keybinds.prompt.title'),
          label: t('plugins.global-keybinds.prompt.label'),
          type: 'keybind',
          keybindOptions: Object.entries(fields).map(([key, field]) =>
            kb(
              t(`plugins.global-keybinds.prompt.${field}`),
              key,
              (
                options[
                  key as keyof GlobalKeybindsPluginConfig
                ] as KeybindsOptions
              )?.value || '',
            ),
          ),
          ...promptOptions(),
        },
        window,
      );

      if (output) {
        const newGlobalShortcuts: Partial<GlobalKeybindsPluginConfig> =
          Object.assign({}, defaultConfig, options);
        for (const { value, accelerator } of output) {
          if (!value) continue;
          const key = value as keyof GlobalKeybindsPluginConfig;
          if (key !== 'enabled') {
            (newGlobalShortcuts[key] as KeybindsOptions).value = accelerator;
          }
        }
        changeOptions({ ...newGlobalShortcuts }, options);
      }
      if (config.enabled) {
        console.log('Global Keybinds Plugin: Re-registering shortcuts');
        ipcMain.emit('global-keybinds:refresh');
      }
    }

    return [
      {
        label: t(
          'plugins.global-keybinds.dubleTapToogleWindowVisibility.label',
        ),
        toolTip: t(
          'plugins.global-keybinds.dubleTapToogleWindowVisibility.tooltip',
        ),
        checked: config.dubleTapToogleWindowVisibility,
        type: 'checkbox',
        click: (item) => {
          setConfig({
            dubleTapToogleWindowVisibility: item.checked,
          });
          ipcMain.emit('global-keybinds:refresh');
        },
      },
      {
        label: t('plugins.global-keybinds.management'),
        click: () => promptGlobalShortcuts(config),
      },
    ];
  },

  backend: {
    async start({ ipc, getConfig, window }) {
      async function registerShortcuts({
        getConfig,
        ipc,
        window,
      }: BackendContext<GlobalKeybindsPluginConfig>) {
        globalShortcut.unregisterAll();
        const config = await getConfig();

        if (!config.enabled) {
          console.log(
            'Global Keybinds Plugin: Plugin is disabled, skipping shortcut registration',
          );
          return;
        }

        function parseAcelerator(accelerator: string) {
          return accelerator.replace(/'(.)'/g, '$1');
        }

        Object.entries(config).forEach(([key, value]) => {
          if (key === 'enabled' || key === 'dubleTapToogleWindowVisibility')
            return;
          const keybind = value as KeybindsOptions;

          try {
            if (!keybind?.value) return;
            if (key === 'tooglePlay' && config.dubleTapToogleWindowVisibility) {
              globalShortcut.register(
                parseAcelerator(keybind.value),
                eventRace({
                  single: () => {
                    ipc.send(key, true);
                  },
                  double: () => {
                    if (window.isVisible()) window.hide();
                    else window.show();
                  },
                }),
              );
              return;
            }

            globalShortcut.register(parseAcelerator(keybind.value), () => {
              console.log(
                `Global Keybinds Plugin: Triggered shortcut for ${key}`,
              );
              ipc.send(key, true);
            });
          } catch (error) {
            console.error(
              `Global Keybinds Plugin: Error registering shortcut ${keybind.value}:`,
              error,
            );
          }
        });
      }

      ipcMain.on('global-keybinds:disable-all', () => {
        globalShortcut.unregisterAll();
      });

      ipcMain.on('global-keybinds:refresh', () => {
        registerShortcuts({
          getConfig,
          ipc,
          window,
        } as BackendContext<GlobalKeybindsPluginConfig>);
      });

      await registerShortcuts({
        getConfig,
        ipc,
        window,
      } as BackendContext<GlobalKeybindsPluginConfig>);
    },
    stop() {
      globalShortcut.unregisterAll();
    },
  },

  renderer: {
    onPlayerApiReady,
  },
});
