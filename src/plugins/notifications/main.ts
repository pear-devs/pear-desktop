import { Notification } from 'electron';
import is from 'electron-is';

import { type SongInfo, SongInfoEvent } from '@/providers/song-info';
import { createBackend } from '@/utils';

import interactive from './interactive';
import { notificationImage } from './utils';

import type { notificationsConfig } from './types';

export default createBackend<typeof notificationsConfig>((ctx) => {
  // Settings are read when a notification is shown; `interactive` and
  // `trayControls` apply on the next start, as before.
  ctx.onConfigChange(() => {});

  if (is.windows() && ctx.config.interactive) {
    interactive(ctx);
    return;
  }

  const notify = (info: SongInfo) => {
    // Send the notification
    const currentNotification = new Notification({
      title: info.title || 'Playing',
      body: info.artist,
      icon: notificationImage(info, ctx.config),
      silent: true,
      urgency: ctx.config.urgency,
    });
    currentNotification.show();

    return currentNotification;
  };

  let oldNotification: Notification | undefined;
  let currentUrl: string | undefined;

  ctx.onSongInfo((songInfo, event) => {
    if (
      event !== SongInfoEvent.TimeChanged &&
      !songInfo.isPaused &&
      (songInfo.url !== currentUrl || ctx.config.unpauseNotification)
    ) {
      // Close the old notification
      oldNotification?.close();
      currentUrl = songInfo.url;
      // This fixes a weird bug that would cause the notification to be updated instead of showing
      ctx.setTimeout(() => {
        oldNotification = notify(songInfo);
      }, 10);
    }
  });
});
