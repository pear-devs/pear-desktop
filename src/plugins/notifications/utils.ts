import fs from 'node:fs';
import path from 'node:path';

import musicPlayerIcon from '@assets/icon.png?asset&asarUnpack';
import { app, type NativeImage } from 'electron';

import { type SongInfo } from '@/providers/song-info';

import { ToastStyles, type NotificationsPluginConfig } from './types';

const userData = app.getPath('userData');
const temporaryIcon = path.join(userData, 'tempIcon.png');
const temporaryBanner = path.join(userData, 'tempBanner.png');

const nativeImageToLogo = (nativeImage: NativeImage) => {
  const temporaryImage = nativeImage.resize({ height: 256 });
  const margin = Math.max(temporaryImage.getSize().width - 256, 0);

  return temporaryImage.crop({
    x: Math.round(margin / 2),
    y: 0,
    width: 256,
    height: 256,
  });
};

export const notificationImage = (
  songInfo: SongInfo,
  config: NotificationsPluginConfig,
) => {
  if (!songInfo.image) {
    return musicPlayerIcon;
  }

  if (!config.interactive) {
    return nativeImageToLogo(songInfo.image);
  }

  switch (config.toastStyle) {
    case ToastStyles.logo:
    case ToastStyles.legacy: {
      return saveImage(nativeImageToLogo(songInfo.image), temporaryIcon);
    }

    default: {
      return saveImage(songInfo.image, temporaryBanner);
    }
  }
};

export const saveImage = (img: NativeImage, savePath: string) => {
  try {
    fs.writeFileSync(savePath, img.toPNG());
  } catch (error: unknown) {
    console.error('Error writing song icon to disk:');
    console.trace(error);
    return musicPlayerIcon;
  }

  return savePath;
};

export const secondsToMinutes = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const secondsLeft = seconds % 60;
  return `${minutes}:${secondsLeft < 10 ? '0' : ''}${secondsLeft}`;
};
