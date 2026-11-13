import prompt from 'custom-electron-prompt';
import { allPlugins } from 'virtual:plugins';

import * as config from '@/config';
import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';
import { Platform } from '@/types/plugins';
import { LoggerPrefix } from '@/utils';

import { buildConfigMenu, type MenuEnv, patchAt } from './menu-builder';

import type { ConfigShape, Label } from '@/plugins/utils/common/config';
import type { MenuContext } from '@/types/contexts';
import type { BrowserWindow, MenuItemConstructorOptions } from 'electron';

const currentPlatform = (() => {
  switch (process.platform) {
    case 'win32':
      return Platform.Windows;
    case 'darwin':
      return Platform.macOS;
    case 'freebsd':
      return Platform.Freebsd;
    default:
      return Platform.Linux;
  }
})();

export const resolveLabel = (label: Label): string => {
  if (typeof label === 'string') return t(label);
  if ('text' in label) return label.text;
  return t(label.key, label.vars);
};

/**
 * A plugin's menu items: the ones generated from its config schema, then the
 * ones its `menu` returns.
 */
export const buildPluginMenu = async (
  id: string,
  win: BrowserWindow,
  refresh: () => Promise<void> | void,
): Promise<MenuItemConstructorOptions[]> => {
  const plugin = (await allPlugins())[id];
  if (!plugin) return [];

  const state = await config.plugins.getPluginState(id);
  const setConfig = (patch: Record<string, unknown>) => {
    config.plugins.setPluginConfig(id, patch);
    return Promise.resolve();
  };

  const env: MenuEnv = {
    label: resolveLabel,
    platform: currentPlatform,
    set: (path, value) => setConfig(patchAt(path, value)),
    async prompt(field, path, current) {
      const title = field.label ? resolveLabel(field.label) : path.join('.');
      let value: unknown;
      if (field.kind === 'shortcut') {
        const output = await prompt(
          {
            title,
            label: title,
            type: 'keybind',
            keybindOptions: [
              {
                value: 'value',
                label: title,
                default: typeof current === 'string' ? current : '',
              },
            ],
            ...promptOptions(),
          },
          win,
        );
        value = output?.[0]?.accelerator ?? null;
      } else if (field.kind === 'number') {
        const output = await prompt(
          {
            title,
            label: title,
            value: current as number,
            type: 'counter',
            counterOptions: {
              minimum: field.min,
              maximum: field.max,
              multiFire: true,
            },
            width: 380,
            ...promptOptions(),
          },
          win,
        );
        value = output === null ? null : Number(output);
        if (typeof value === 'number' && !Number.isFinite(value)) value = null;
      } else {
        value = await prompt(
          {
            title,
            label: title,
            value: typeof current === 'string' ? current : '',
            type: 'input',
            inputAttrs: {
              type: field.secret ? 'password' : 'text',
              placeholder: field.placeholder ?? '',
            },
            width: 380,
            ...promptOptions(),
          },
          win,
        );
      }
      if (value === null || value === undefined) return;
      await setConfig(patchAt(path, value));
      await refresh();
    },
  };

  const schema = plugin.config as ConfigShape | undefined;
  const items: MenuItemConstructorOptions[] = schema
    ? buildConfigMenu(schema, state.config, env)
    : [];

  if (plugin.menu) {
    const ctx: MenuContext<Record<string, unknown>> = {
      id,
      config: state.config,
      setConfig,
      window: win,
      refresh,
    };
    try {
      items.push(...(await plugin.menu(ctx)));
    } catch (error) {
      console.error(
        LoggerPrefix,
        t('common.console.plugins.initialize-failed', {
          pluginName: `${id}::menu`,
        }),
        error,
      );
    }
  }

  return items;
};
