import { app } from 'electron';

import { registerCallback, SongInfoEvent } from '@/providers/song-info';
import { createBackend, LoggerPrefix } from '@/utils';

import { t } from '@/i18n';
import { SlackService } from './slack-service';

import { SLACK_TIME_UPDATE_DEBOUNCE_MS } from './constants';

import type { SlackStatusConfig } from './index';

export let slackService = null as SlackService | null;

export const backend = createBackend<
  {
    config?: SlackStatusConfig;
    lastStatusUpdate: number;
  },
  SlackStatusConfig
>({
  lastStatusUpdate: 0,

  async start(ctx) {
    const config = await ctx.getConfig();
    slackService = new SlackService(ctx.window, config);
    console.log(
      LoggerPrefix,
      t('plugins.slack-status.backend.init-main'),
      config,
    );

    if (config.enabled) {
      ctx.window.once('ready-to-show', () => {
        registerCallback((songInfo, event) => {
          if (event !== SongInfoEvent.TimeChanged) {
            slackService?.updateStatus(songInfo);
            this.lastStatusUpdate = Date.now();
          } else {
            const now = Date.now();
            if (now - this.lastStatusUpdate > SLACK_TIME_UPDATE_DEBOUNCE_MS) {
              slackService?.updateStatus(songInfo);
              this.lastStatusUpdate = now;
            }
          }
        });
      });
    }

    app.on('before-quit', async () => {
      console.log(LoggerPrefix, t('plugins.slack-status.backend.before-quit'));
      await slackService?.cleanup();
    });
  },

  async stop() {
    console.log(LoggerPrefix, t('plugins.slack-status.backend.stop'));
    await slackService?.cleanup();
  },

  onConfigChange(newConfig) {
    console.log(
      LoggerPrefix,
      t('plugins.slack-status.backend.on-config-change'),
      newConfig,
    );
    slackService?.onConfigChange(newConfig);
  },
});
