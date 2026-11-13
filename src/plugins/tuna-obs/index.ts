import { net } from 'electron';
import is from 'electron-is';

import { t } from '@/i18n';
import { createPlugin } from '@/utils';

interface Data {
  album: string | null | undefined;
  album_url: string;
  artists: string[];
  cover: string;
  cover_url: string;
  duration: number;
  progress: number;
  status: string;
  title: string;
  alternativeTitle: string;
  url: string;
  tags: string[];
}

export default createPlugin({
  name: () => t('plugins.tuna-obs.name'),
  description: () => t('plugins.tuna-obs.description'),
  restartNeeded: true,
  backend(ctx) {
    let liteMode = false;
    const secToMilisec = (t: number) => Math.round(Number(t) * 1e3);

    const post = (data: Data) => {
      const port = 1608;
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Origin': '*',
      };
      const url = `http://127.0.0.1:${port}/`;
      net
        .fetch(url, {
          method: liteMode ? 'OPTIONS' : 'POST',
          headers,
          keepalive: true,
          signal: ctx.signal,
          body: liteMode ? undefined : JSON.stringify({ data }),
        })
        .then(() => {
          if (liteMode) {
            liteMode = false;
            console.debug(
              `obs-tuna webserver at port ${port} is now accessible. disable lite mode`,
            );
            post(data);
          }
        })
        .catch((error: { code: number; errno: number }) => {
          if (!liteMode) {
            if (is.dev()) {
              console.debug(
                `Error: '${
                  error.code || error.errno
                }' - when trying to access obs-tuna webserver at port ${port}. enable lite mode`,
              );
            }
            liteMode = true;
          }
        });
    };

    ctx.ipc.core.on('peard:player-api-loaded', () =>
      ctx.ipc.core.send('peard:setup-time-changed-listener'),
    );

    ctx.onSongInfo((songInfo) => {
      if (!songInfo.title && !songInfo.artist) {
        return;
      }

      post({
        duration: secToMilisec(songInfo.songDuration),
        progress: secToMilisec(songInfo.elapsedSeconds ?? 0),
        cover: songInfo.imageSrc ?? '',
        cover_url: songInfo.imageSrc ?? '',
        album_url: songInfo.imageSrc ?? '',
        title: songInfo.title,
        alternativeTitle: songInfo.alternativeTitle ?? '',
        artists: [songInfo.artist],
        status: songInfo.isPaused ? 'stopped' : 'playing',
        album: songInfo.album,
        url: songInfo.url ?? '',
        tags: songInfo.tags ?? [],
      });
    });
  },
});
