import { Notification } from 'electron';
import is from 'electron-is';

import { t } from '@/i18n';
import {
  registerCallback,
  type SongInfo,
  SongInfoEvent,
} from '@/providers/song-info';
import { LikeType } from '@/types/datahost-get-state';

import interactive from './interactive';
import { notificationImage } from './utils';

import type { NotificationsPluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

let config: NotificationsPluginConfig;
let latestSongInfo: SongInfo | undefined;

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

const likeStatusLabel: Record<LikeType, string> = {
  [LikeType.Like]: t('plugins.notifications.like-status.liked'),
  [LikeType.Dislike]: t('plugins.notifications.like-status.disliked'),
  [LikeType.Indifferent]: t('plugins.notifications.like-status.indifferent'),
};

const setupLikeChangeNotification = (
  context: BackendContext<NotificationsPluginConfig>,
) => {
  let isInitialEvent = true;

  context.ipc.on('peard:player-api-loaded', () => {
    context.ipc.send('peard:setup-like-changed-listener');
  });
  context.ipc.on('peard:like-changed', (likeType: LikeType) => {
    if (isInitialEvent) {
      isInitialEvent = false;
      return;
    }

    if (!latestSongInfo) {
      return;
    }

    const notification = new Notification({
      title: likeStatusLabel[likeType],
      body: latestSongInfo.title || 'Playing',
      icon: notificationImage(latestSongInfo, config),
      silent: true,
      urgency: config.urgency,
    });
    notification.show();
  });
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

  registerCallback((songInfo: SongInfo) => {
    latestSongInfo = songInfo;
  });

  if (config.notifyOnLikeChange) {
    setupLikeChangeNotification(context);
  }

  // Register the callback for new song information
  if (is.windows() && config.interactive)
    interactive(context.window, () => config, context);
  else setup();
};

export const onConfigChange = (newConfig: NotificationsPluginConfig) => {
  config = newConfig;
};
