import { net } from 'electron';

import { createPlugin } from '@/utils';
import { registerCallback } from '@/providers/song-info';
import { t } from '@/i18n';

type LumiaData = {
  origin: string;
  eventType: string;
  url?: string;
  videoId?: string;
  playlistId?: string;
  cover?: string | null;
  cover_url?: string | null;
  title?: string;
  artists?: string[];
  status?: string;
  progress?: number;
  duration?: number;
  album_url?: string | null;
  album?: string | null;
  views?: number;
  isPaused?: boolean;
};

export default createPlugin({
  name: () => t('plugins.lumiastream.name'),
  description: () => t('plugins.lumiastream.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  backend({ ipc }) {
    const secToMilisec = (t?: number) =>
      t ? Math.round(Number(t) * 1e3) : undefined;
    const previousStatePaused = null;

    const data: LumiaData = {
      origin: '\u0079\u006f\u0075\u0074\u0075\u0062\u0065\u006d\u0075\u0073\u0069\u0063',
      eventType: 'switchSong',
    };

    const post = (data: LumiaData) => {
      const port = 39231;
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Origin': '*',
      } as const;
      const url = `http://127.0.0.1:${port}/api/media`;

      net
        .fetch(url, {
          method: 'POST',
          body: JSON.stringify({ token: 'lsmedia_ytmsI7812', data }),
          headers,
        })
        .catch((error: { code: number; errno: number }) => {
          console.log(
            `Error: '${
              error.code || error.errno
            }' - when trying to access lumiastream webserver at port ${port}`,
          );
        });
    };

    ipc.on('peard:player-api-loaded', () =>
      ipc.send('peard:setup-time-changed-listener'),
    );

    registerCallback((songInfo) => {
      if (!songInfo.title && !songInfo.artist) {
        return;
      }

      if (previousStatePaused === null) {
        data.eventType = 'switchSong';
      } else if (previousStatePaused !== songInfo.isPaused) {
        data.eventType = 'playPause';
      }

      data.duration = secToMilisec(songInfo.songDuration);
      data.progress = secToMilisec(songInfo.elapsedSeconds);
      data.url = songInfo.url;
      data.videoId = songInfo.videoId;
      data.playlistId = songInfo.playlistId;
      data.cover = songInfo.imageSrc;
      data.cover_url = songInfo.imageSrc;
      data.album_url = songInfo.imageSrc;
      data.title = songInfo.title;
      data.artists = [songInfo.artist];
      data.status = songInfo.isPaused ? 'stopped' : 'playing';
      data.isPaused = songInfo.isPaused;
      data.album = songInfo.album;
      data.views = songInfo.views;
      post(data);
    });
  },
});
