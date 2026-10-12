import { Utils, type Innertube, type Types } from 'youtubei.js';

import { createInnertube } from '@/plugins/utils/main/innertube';

import { FETCH_AUDIO_CHANNEL } from './constants';

import type { AutoMixPluginConfig } from './config';
import type { BackendContext } from '@/types/contexts';

/** Tracks larger than this (long mixes / podcasts) aren't worth analysing */
const MAX_BYTES = 40 * 1024 * 1024;

const FORMATS: Types.FormatOptions[] = [
  // Audio-only stream: smallest and best sounding
  { type: 'audio', quality: 'best', format: 'any' },
  // Muxed fallback (audio-only can be refused for some accounts)
  { type: 'video+audio', quality: 'bestefficiency', format: 'mp4' },
];

let client: Promise<Innertube> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const download = async (yt: Innertube, videoId: string) => {
  const info = await yt.music.getInfo(videoId);
  if (info.playability_status?.status !== 'OK') return null;

  for (const options of FORMATS) {
    try {
      const format = info.chooseFormat(options);
      if ((format.content_length ?? 0) > MAX_BYTES) continue;

      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of Utils.streamToIterable(
        await info.download(options),
      )) {
        chunks.push(chunk);
        total += chunk.length;
        if (total > MAX_BYTES) throw new Error('Track too large');
      }

      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    } catch (error) {
      console.warn('[AutoMix] audio fetch failed', videoId, options, error);
    }
  }

  return null;
};

export const backend = {
  start({ window, ipc }: BackendContext<AutoMixPluginConfig>) {
    ipc.handle(FETCH_AUDIO_CHANNEL, (videoId: string) => {
      // One download at a time, so prefetching never starves playback
      const result = queue.then(async () => {
        client ??= createInnertube(window).catch((error: unknown) => {
          client = null;
          throw error;
        });
        try {
          return await download(await client, videoId);
        } catch (error) {
          console.warn('[AutoMix] could not fetch', videoId, error);
          return null;
        }
      });
      queue = result.catch(() => null);
      return result;
    });
  },
  stop({ ipc }: BackendContext<AutoMixPluginConfig>) {
    ipc.removeHandler(FETCH_AUDIO_CHANNEL);
  },
};
