import { Notification } from 'electron';

import is from 'electron-is';

import { notificationImage } from './utils';
import interactive from './interactive';

import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';

import type { NotificationsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

let config: NotificationsPluginConfig;

const notify = (info: SongInfo) => {
  // Send the notification
  const currentNotification = new Notification({
    title: info.title || 'Playing',
    body: info.artist,
    icon: notificationImage(info, config),
    silent: true,
    urgency: config.urgency,
  });
  currentNotification.show();

  return currentNotification;
};

const setup = () => {
  let oldNotification: Notification;
  let currentUrl: string | undefined;

  registerCallback((songInfo: SongInfo, event) => {
    if (
      event !== SongInfoEvent.TimeChanged &&
      !songInfo.isPaused &&
      (songInfo.url !== currentUrl || config.unpauseNotification)
    ) {
      // Close the old notification
      oldNotification?.close();
      currentUrl = songInfo.url;
      // This fixes a weird bug that would cause the notification to be updated instead of showing
      setTimeout(() => {
        oldNotification = notify(songInfo);
      }, 10);
    }
  });
};

export const onMainLoad = async (
  context: BackendContext<NotificationsPluginConfig>,
) => {
  config = await context.getConfig();

  // Register the callback for new song information
  if (is.windows() && config.interactive)
    interactive(context.window, () => config, context);
  else setup();
};

export const onConfigChange = (newConfig: NotificationsPluginConfig) => {
  config = newConfig;
};
