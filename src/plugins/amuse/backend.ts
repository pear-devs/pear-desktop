import { serve } from '@hono/node-server';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { t } from 'i18next';

import { createBackend } from '@/utils';

import type { AmuseSongInfo } from './types';
import type { SongInfo } from '@/providers/song-info';

const amusePort = 9863;

const formatSongInfo = (info: SongInfo) => {
  const formattedSongInfo: AmuseSongInfo = {
    player: {
      hasSong: !!(info.artist && info.title),
      isPaused: info.isPaused ?? false,
      seekbarCurrentPosition: info.elapsedSeconds ?? 0,
    },
    track: {
      duration: info.songDuration,
      title: info.title,
      author: info.artist,
      cover: info.imageSrc ?? '',
      url: info.url ?? '',
      id: info.videoId,
      isAdvertisement: false,
    },
  };
  return formattedSongInfo;
};

export default createBackend((ctx) => {
  let currentSongInfo = {} as SongInfo;
  ctx.onSongInfo((songInfo) => {
    currentSongInfo = songInfo;
  });

  const app = new Hono();
  app.use('*', cors());
  app.get('/', (c) => c.body(t('plugins.amuse.response.query'), 200));

  const queryAndApiHandler = (c: Context) =>
    c.json(formatSongInfo(currentSongInfo), 200);

  app.get('/query', queryAndApiHandler);
  app.get('/api', queryAndApiHandler);

  try {
    const server = serve({
      fetch: app.fetch.bind(app),
      port: amusePort,
    });
    ctx.onCleanup(() => server.close());
  } catch (err) {
    console.error(err);
  }
});
