import { serve, type ServerType } from '@hono/node-server';
import { Hono } from 'hono';
import { stream } from 'hono/streaming';

import { registerCallback, type SongInfo } from '@/providers/song-info';
import { createBackend } from '@/utils';

import { BroadcastStream } from './BroadcastStream';
import { type AudioStreamConfig } from './config';
import { OggOpusMuxer, OggDechainer } from './ogg-opus';

const VENDOR = 'Pear Desktop';

let config: AudioStreamConfig;
const broadcast = new BroadcastStream();

// Current track metadata (no ffprobe - comes straight from the player).
let currentSong: SongInfo | null = null;

// Chained Ogg/Opus stream: one logical stream per song. Pages go straight to
// every subscriber; the muxer caches the current stream's header pages for late
// joiners.
const muxer = new OggOpusMuxer((page) => broadcast.write(page));

// OpusTags comments for the current track (text only).
function currentComments(): string[] {
  const comments: string[] = [];
  if (currentSong?.title) comments.push(`TITLE=${currentSong.title}`);
  if (currentSong?.artist) comments.push(`ARTIST=${currentSong.artist}`);
  if (currentSong?.album) comments.push(`ALBUM=${currentSong.album}`);
  return comments.length ? comments : ['TITLE=Pear Desktop'];
}

export const backend = createBackend<
  {
    app: Hono;
    server?: ServerType;
  },
  AudioStreamConfig
>({
  app: new Hono().get('/stream', (ctx) => {
    // Per-song TEXT metadata is carried in-band via chained Ogg logical streams
    // (OpusTags per track). Some clients can't follow chains - browsers
    // (<audio>/MSE) reload on a new BOS, and VLC's clock chokes on it - so they
    // get a de-chained single logical stream instead.
    const ua = ctx.req.header('User-Agent') ?? '';
    const needsDechain = /Mozilla|VLC/i.test(ua);

    ctx.header('Content-Type', 'audio/ogg');
    ctx.header('Transfer-Encoding', 'chunked');
    ctx.header('Access-Control-Allow-Origin', '*');

    if (!needsDechain) {
      ctx.header('icy-name', 'Pear Desktop');
      ctx.header('icy-url', 'https://github.com/pear-devs/pear-desktop');
      ctx.header(
        'icy-audio-info',
        `ice-channels=${config.channels};ice-samplerate=48000;ice-bitrate=${Math.round(
          config.bitrate / 1000,
        )}`,
      );
      ctx.header('icy-pub', '1');
    }

    ctx.header('Server', 'Pear Desktop');

    return stream(ctx, async (stream) => {
      // New subscriber gets the cached OpusHead + OpusTags pages first, so the
      // decoder can initialise before any audio page arrives.
      let readable = broadcast.subscribe(muxer.headerPages);

      if (needsDechain) {
        const dechainer = new OggDechainer();
        readable = readable.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(page, controller) {
              for (const out of dechainer.push(page)) controller.enqueue(out);
            },
          }),
        );
      }

      return await stream.pipe(readable);
    });
  }),

  async start({ getConfig, ipc }) {
    config = await getConfig();

    this.server = serve(
      {
        fetch: this.app.fetch.bind(this.app),
        hostname: config.hostname,
        port: config.port,
      },
      ({ address, port }) => console.log('Listening on', { address, port }),
    );

    // Track metadata (no ffprobe needed). On an actual song change, start a new
    // logical stream so the new title/artist/album are embedded in-band.
    // SongInfo also fires for play/pause and time updates, so gate on videoId.
    let lastVideoId = '';
    registerCallback((songInfo: SongInfo) => {
      currentSong = songInfo;
      if (songInfo.videoId && songInfo.videoId !== lastVideoId) {
        lastVideoId = songInfo.videoId;
        if (muxer.ready) muxer.chain(VENDOR, currentComments());
      }
    });

    // OpusHead (from WebCodecs decoderConfig.description) opens the first stream.
    ipc.on('audio-stream:opus-head', (head: Uint8Array) => {
      muxer.setHead(head);
      muxer.start(VENDOR, currentComments());
    });

    // Each Opus packet → one Ogg audio page. durationUs is the packet length;
    // Opus granule positions are counted in 48 kHz samples.
    ipc.on(
      'audio-stream:opus',
      (packet: { bytes: Uint8Array; durationUs: number }) => {
        const samples = (packet.durationUs * 48000) / 1_000_000;
        muxer.writePacket(packet.bytes, samples);
      },
    );
  },
  async stop() {
    if (!this.server) return;

    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  },
  onConfigChange(newConfig) {
    config = newConfig;
  },
});
