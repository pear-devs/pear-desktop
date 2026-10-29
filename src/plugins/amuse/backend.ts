import { serve } from '@hono/node-server';
import { type Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { t } from 'i18next';

import { registerCallback, type SongInfo } from '@/providers/song-info';
import { createBackend } from '@/utils';

import type { AmuseSongInfo } from './types';

const amusePort = 9863;

const formatSongInfo = (
  info: SongInfo,
  isAdvertisement: boolean,
  positionUpdatedAt: number,
) => {
  const formattedSongInfo: AmuseSongInfo = {
    apiVersion: 2,
    player: {
      hasSong: !!(info.artist && info.title),
      isPaused: info.isPaused ?? false,
      seekbarCurrentPosition: info.elapsedSeconds ?? 0,
      positionUpdatedAt,
    },
    track: {
      duration: info.songDuration,
      title: info.title,
      author: info.artist,
      cover: info.imageSrc ?? '',
      url: info.url ?? '',
      id: info.videoId,
      isAdvertisement,
      album: info.album ?? null,
      mediaType: info.mediaType,
      playlistId: info.playlistId ?? null,
    },
  };
  return formattedSongInfo;
};

export default createBackend({
  currentSongInfo: {} as SongInfo,
  // Reported by the renderer, the song info itself doesn't know about ads
  isAdvertisement: false,
  // When elapsedSeconds last changed, so clients can extrapolate the position
  positionUpdatedAt: 0,
  app: null as Hono | null,
  server: null as ReturnType<typeof serve> | null,
  start({ ipc }) {
    ipc.on('peard:amuse-ad-state', (isAd: boolean) => {
      this.isAdvertisement = isAd;
    });
    // Without this the song info only gets a new elapsed time on play, pause
    // or seek, so seekbarCurrentPosition stood still while a song played
    ipc.on('peard:player-api-loaded', () =>
      ipc.send('peard:setup-time-changed-listener'),
    );

    registerCallback((songInfo) => {
      if (
        songInfo.elapsedSeconds !== this.currentSongInfo.elapsedSeconds ||
        songInfo.videoId !== this.currentSongInfo.videoId ||
        songInfo.isPaused !== this.currentSongInfo.isPaused
      ) {
        this.positionUpdatedAt = Date.now();
      }
      // The provider reuses one object, keep a copy to compare against
      this.currentSongInfo = { ...songInfo };
    });

    this.app = new Hono();
    this.app.use('*', cors());
    this.app.get('/', (ctx) =>
      ctx.body(t('plugins.amuse.response.query'), 200),
    );

    const queryAndApiHandler = (ctx: Context) => {
      return ctx.json(
        formatSongInfo(
          this.currentSongInfo,
          this.isAdvertisement,
          this.positionUpdatedAt,
        ),
        200,
      );
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
