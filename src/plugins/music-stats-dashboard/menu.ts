import prompt from 'custom-electron-prompt';

import promptOptions from '@/providers/prompt-options';
import { t } from '@/i18n';

import type { MenuContext } from '@/types/contexts';
import type { MenuTemplate } from '@/menu';
import type { StatsConfig } from './types';

export default async (ctx: MenuContext<StatsConfig>): Promise<MenuTemplate> => {
  const config = await ctx.getConfig();
  const lastSyncLabel = config.cloudSyncLastSyncTime
    ? `Last sync: ${new Date(config.cloudSyncLastSyncTime).toLocaleString()}`
    : 'Last sync: never';
  const lastErrorLabel = config.cloudSyncLastError
    ? `Last error: ${config.cloudSyncLastError}`
    : 'Last error: none';
  const lastDeviceSyncLabel = config.remoteSyncLastTime
    ? `Last sync: ${new Date(config.remoteSyncLastTime).toLocaleString()}`
    : 'Last sync: never';
  const lastDeviceErrorLabel = config.remoteSyncLastError
    ? `Last error: ${config.remoteSyncLastError}`
    : 'Last error: none';

  return [
    {
      label: t(
        'plugins.music-stats-dashboard.menu.title',
        'Music Stats Dashboard',
      ),
      submenu: [
        {
          label: t(
            'plugins.music-stats-dashboard.menu.dashboard',
            'View Dashboard',
          ),
          click: () => {
            ctx.window.webContents.send('music-stats:show-dashboard');
          },
        },
        {
          label: t(
            'plugins.music-stats-dashboard.menu.wrapped',
            'View Wrapped',
          ),
          click: () => {
            ctx.window.webContents.send('music-stats:show-wrapped');
          },
        },
        {
          type: 'separator',
        },
        {
          label: t(
            'plugins.music-stats-dashboard.menu.other-devices',
            'Phone & Other Devices',
          ),
          submenu: [
            {
              label: t(
                'plugins.music-stats-dashboard.menu.remote-sync-toggle',
                'Include plays from other devices',
              ),
              type: 'checkbox',
              checked: !!config.remoteSyncEnabled,
              click: async () => {
                await ctx.setConfig({
                  remoteSyncEnabled: !config.remoteSyncEnabled,
                });
                ctx.refresh?.();
              },
            },
            {
              label: t(
                'plugins.music-stats-dashboard.menu.remote-sync-now',
                'Sync Device Plays Now',
              ),
              enabled: !!config.remoteSyncEnabled,
              click: () => {
                ctx.window.webContents.send('music-stats:history-sync');
              },
            },
            {
              label: lastDeviceSyncLabel,
              enabled: false,
            },
            {
              label: lastDeviceErrorLabel,
              enabled: false,
            },
          ],
        },
        {
          label: t(
            'plugins.music-stats-dashboard.menu.drive-sync',
            'Google Drive Sync',
          ),
          submenu: [
            {
              label: t(
                'plugins.music-stats-dashboard.menu.enable-sync',
                'Enable Sync',
              ),
              type: 'checkbox',
              checked: !!config.cloudSyncEnabled,
              click: async () => {
                await ctx.setConfig({
                  cloudSyncEnabled: !config.cloudSyncEnabled,
                });
                ctx.refresh?.();
              },
            },
            {
              label: 'Set Google Client ID (Desktop)…',
              click: async () => {
                const clientId = await prompt(
                  {
                    title: 'Google Drive Client ID (Desktop)',
                    label: 'Paste your OAuth Client ID (Desktop app):',
                    type: 'input',
                    value: config.cloudSyncClientId || '',
                    ...promptOptions(),
                  },
                  ctx.window,
                );

                if (clientId && clientId.trim()) {
                  await ctx.setConfig({ cloudSyncClientId: clientId.trim() });
                  ctx.refresh?.();
                }
              },
            },
            {
              label: 'Set Google Client Secret…',
              click: async () => {
                const clientSecret = await prompt(
                  {
                    title: 'Google Client Secret',
                    label: 'Paste your OAuth Client Secret:',
                    type: 'input',
                    value: config.cloudSyncClientSecret || '',
                    ...promptOptions(),
                  },
                  ctx.window,
                );

                if (clientSecret && clientSecret.trim()) {
                  await ctx.setConfig({
                    cloudSyncClientSecret: clientSecret.trim(),
                  });
                  ctx.refresh?.();
                }
              },
            },
            {
              label: t(
                'plugins.music-stats-dashboard.menu.drive-connect',
                'Connect Google Drive…',
              ),
              click: () => {
                ctx.window.webContents.send('music-stats:drive-connect');
              },
            },
            {
              label: t(
                'plugins.music-stats-dashboard.menu.drive-sync-now',
                'Sync Now',
              ),
              enabled: !!config.cloudSyncEnabled,
              click: () => {
                ctx.window.webContents.send('music-stats:drive-sync');
              },
            },
            {
              label: lastSyncLabel,
              enabled: false,
            },
            {
              label: lastErrorLabel,
              enabled: false,
            },
            {
              label: t(
                'plugins.music-stats-dashboard.menu.drive-disconnect',
                'Disconnect Google Drive',
              ),
              enabled: !!config.cloudSyncEnabled,
              click: () => {
                ctx.window.webContents.send('music-stats:drive-disconnect');
              },
            },
          ],
        },
        {
          type: 'separator',
        },
        {
          label: t('plugins.music-stats-dashboard.menu.export', 'Export Stats'),
          click: async () => {
            ctx.window.webContents.send('music-stats:export');
          },
        },
        {
          label: t('plugins.music-stats-dashboard.menu.import', 'Import Stats'),
          click: async () => {
            ctx.window.webContents.send('music-stats:import');
          },
        },
        {
          label: t(
            'plugins.music-stats-dashboard.menu.import-takeout',
            'Import Google Takeout…',
          ),
          click: () => {
            ctx.window.webContents.send('music-stats:import-takeout');
          },
        },
      ],
    },
  ];
};
