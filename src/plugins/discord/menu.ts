import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import { getDiscordService, setMenuRefresh } from './main';

import type { DiscordPluginConfig } from './types';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = (ctx: MenuContext<DiscordPluginConfig>): MenuTemplate => {
  setMenuRefresh(() => ctx.refresh());
  const discordService = getDiscordService();

  return [
    {
      label: discordService?.isConnected()
        ? t('plugins.discord.menu.connected')
        : t('plugins.discord.menu.disconnected'),
      enabled: !discordService?.isConnected(),
      click: () => getDiscordService()?.connect(true),
    },
    {
      label: t('plugins.discord.menu.clear-activity'),
      click: () => getDiscordService()?.clearActivity(),
    },
    {
      label: t('plugins.discord.menu.set-inactivity-timeout'),
      click: () => setInactivityTimeout(ctx),
    },
  ];
};

async function setInactivityTimeout(ctx: MenuContext<DiscordPluginConfig>) {
  const options = ctx.config;
  const output = await prompt(
    {
      title: t('plugins.discord.prompt.set-inactivity-timeout.title'),
      label: t('plugins.discord.prompt.set-inactivity-timeout.label'),
      value: String(Math.round((options.activityTimeoutTime ?? 0) / 1e3)),
      type: 'counter',
      counterOptions: { minimum: 0, multiFire: true },
      width: 450,
      ...promptOptions(),
    },
    ctx.window,
  );

  if (output) {
    await ctx.setConfig({ activityTimeoutTime: Math.round(~~output * 1e3) });
  }
}
