import { t } from '@/i18n';

import type { MiniPlayerPluginConfig } from './index';
import type { MenuContext } from '@/types/contexts';
import type { MenuItemConstructorOptions } from 'electron';

const lyricsColors = [
  { code: '#ffffff', name: 'White' },
  { code: '#ffd700', name: 'Gold' },
  { code: '#ffd54f', name: 'Yellow' },
  { code: '#4dd0e1', name: 'Cyan' },
  { code: '#64b5f6', name: 'Light Blue' },
  { code: '#69f0ae', name: 'Green' },
  { code: '#ff5252', name: 'Red' },
  { code: '#f48fb1', name: 'Pink' },
];

export const menu = async (
  ctx: MenuContext<MiniPlayerPluginConfig>,
): Promise<MenuItemConstructorOptions[]> => {
  const config = await ctx.getConfig();

  return [
    {
      label: t('plugins.mini-player.menu.visible.label'),
      toolTip: t('plugins.mini-player.menu.visible.tooltip'),
      type: 'checkbox',
      checked: config.visible,
      click(item) {
        ctx.setConfig({
          visible: item.checked,
        });
      },
    },
    {
      label: t('plugins.mini-player.menu.always-on-top.label'),
      toolTip: t('plugins.mini-player.menu.always-on-top.tooltip'),
      type: 'checkbox',
      checked: config.alwaysOnTop ?? true,
      click(item) {
        ctx.setConfig({
          alwaysOnTop: item.checked,
        });
      },
    },
    {
      label: t('plugins.mini-player.menu.hide-meta.label'),
      toolTip: t('plugins.mini-player.menu.hide-meta.tooltip'),
      type: 'checkbox',
      checked: config.hideMeta ?? false,
      click(item) {
        ctx.setConfig({
          hideMeta: item.checked,
        });
      },
    },
    {
      label: t('plugins.mini-player.menu.show-lyrics.label'),
      toolTip: t('plugins.mini-player.menu.show-lyrics.tooltip'),
      type: 'checkbox',
      checked: config.showLyricsArea ?? true,
      click(item) {
        ctx.setConfig({
          showLyricsArea: item.checked,
        });
      },
    },
    {
      label: t('plugins.mini-player.menu.transparent-bg.label'),
      toolTip: t('plugins.mini-player.menu.transparent-bg.tooltip'),
      type: 'checkbox',
      checked: config.transparentBg ?? false,
      click(item) {
        ctx.setConfig({
          transparentBg: item.checked,
        });
      },
    },
    {
      label: t('plugins.mini-player.menu.lyrics-emphasis.label'),
      toolTip: t('plugins.mini-player.menu.lyrics-emphasis.tooltip'),
      type: 'submenu',
      submenu: (
        [
          ['none', 'plugins.mini-player.menu.lyrics-emphasis.none'],
          ['subtle', 'plugins.mini-player.menu.lyrics-emphasis.subtle'],
          ['normal', 'plugins.mini-player.menu.lyrics-emphasis.normal'],
          ['strong', 'plugins.mini-player.menu.lyrics-emphasis.strong'],
        ] as const
      ).map(([value, key]) => ({
        label: t(key),
        type: 'radio',
        checked: (config.lyricsEmphasis ?? 'normal') === value,
        click() {
          ctx.setConfig({ lyricsEmphasis: value });
        },
      })),
    },
    {
      label: t('plugins.mini-player.menu.lyrics-color.label'),
      toolTip: t('plugins.mini-player.menu.lyrics-color.tooltip'),
      type: 'submenu',
      submenu: lyricsColors.map(({ code, name }) => ({
        label: name,
        type: 'radio',
        checked: (config.lyricsColor ?? '#ffffff') === code,
        click() {
          ctx.setConfig({ lyricsColor: code });
        },
      })),
    },
  ];
};
