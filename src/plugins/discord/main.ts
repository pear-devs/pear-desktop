import { app } from 'electron';

import { SongInfoEvent } from '@/providers/song-info';
import { createBackend } from '@/utils';

import { TIME_UPDATE_DEBOUNCE_MS } from './constants';
import { DiscordService } from './discord-service';

import type { discordConfig } from './types';

/**
 * The running backend's service, for the menu. Set while the backend runs,
 * cleared when it stops.
 */
let discordService: DiscordService | null = null;
/** Rebuilds the menu; set by the menu so the service can refresh it. */
let refreshMenu: (() => unknown) | undefined;

export const getDiscordService = () => discordService;
export const setMenuRefresh = (refresh: () => unknown) => {
  refreshMenu = refresh;
};

export default createBackend<typeof discordConfig>((ctx) => {
  const service = new DiscordService(ctx.window, { ...ctx.config });
  discordService = service;
  service.registerRefreshCallback(() => refreshMenu?.());
  ctx.onCleanup(() => {
    service.cleanup();
    if (discordService === service) discordService = null;
  });

  let lastTimeUpdateSent = 0;
  const connectAndListen = () => {
    service.connect(!ctx.config.autoReconnect);

    ctx.onSongInfo((songInfo, event) => {
      if (!service.isConnected()) return;

      if (event !== SongInfoEvent.TimeChanged) {
        service.updateActivity(songInfo);
        lastTimeUpdateSent = Date.now();
      } else {
        const now = Date.now();
        if (now - lastTimeUpdateSent > TIME_UPDATE_DEBOUNCE_MS) {
          service.updateActivity(songInfo);
          lastTimeUpdateSent = now; // Record the time of this debounced update
        }
      }
    });
  };

  // At app start, wait until the window is ready; when enabled later, go at once.
  const { webContents } = ctx.window;
  if (webContents.getURL() && !webContents.isLoading()) {
    connectAndListen();
  } else {
    let started = false;
    ctx.listen(ctx.window, 'ready-to-show', () => {
      if (started) return;
      started = true;
      connectAndListen();
    });
  }

  ctx.ipc.core.on('peard:player-api-loaded', () => {
    ctx.ipc.core.send('peard:setup-time-changed-listener');
  });

  ctx.listen(app, 'before-quit', () => service.cleanup());

  ctx.onConfigChange((config) => {
    service.onConfigChange({ ...config });
    if (!service.isConnected()) {
      service.connect(!config.autoReconnect);
    }
  });
});
