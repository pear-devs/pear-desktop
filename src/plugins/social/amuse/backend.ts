import { t } from 'i18next';

import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';

import { registerCallback, type SongInfo } from '@/providers/song-info';
import { createBackend } from '@/utils';

import type { AmuseSongInfo } from './types';

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

export default createBackend({
  currentSongInfo: {} as SongInfo,
  app: null as Hono | null,
  server: null as ReturnType<typeof serve> | null,
  start() {
    registerCallback((songInfo) => {
      this.currentSongInfo = songInfo;
    });

    this.app = new Hono();
    this.app.use('*', cors());
    this.app.get('/', (ctx) =>
      ctx.body(t('plugins.amuse.response.query'), 200),
    );

    const queryAndApiHandler = (ctx: Context) => {
      return ctx.json(formatSongInfo(this.currentSongInfo), 200);
    };

    this.app.get('/query', queryAndApiHandler);
    this.app.get('/api', queryAndApiHandler);

    try {
      this.server = serve({
        fetch: this.app.fetch.bind(this.app),
        port: amusePort,
      });
    } catch (err) {
      console.error(err);
    }
  },

  stop() {
    if (this.server) {
      this.server?.close();
    }
  },
});
