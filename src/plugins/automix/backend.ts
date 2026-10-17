import { Utils, type Innertube, type Types } from 'youtubei.js';

import { createInnertube } from '@/plugins/utils/main/innertube';

import { appleAnalysis } from './apple';
import {
  APPLE_ANALYSIS_CHANNEL,
  FETCH_AUDIO_CHANNEL,
  type AppleLookup,
  type FetchedAudio,
} from './constants';

import type { AutoMixPluginConfig } from './config';
import type { BackendContext } from '@/types/contexts';

/** Tracks larger than this (long mixes / podcasts) aren't worth analysing */
const MAX_BYTES = 40 * 1024 * 1024;

const AUDIO_ONLY: Types.FormatOptions = {
  type: 'audio',
  quality: 'best',
  format: 'any',
};
// Last resort: the 360p muxed stream, whose audio is only ~96 kbps AAC
const MUXED: Types.FormatOptions = {
  type: 'video+audio',
  quality: 'bestefficiency',
  format: 'mp4',
};
/** Below this the copy AutoMix mixes with sounds noticeably duller */
const LOW_BITRATE = 100_000;

type Info =
  | Awaited<ReturnType<Innertube['getBasicInfo']>>
  | Awaited<ReturnType<Innertube['music']['getInfo']>>;

/** Longest one queued download may take before the queue moves on */
const FETCH_TIMEOUT_MS = 60_000;

/** The track is over MAX_BYTES, the same on every client */
class TooLargeError extends Error {}

let client: Promise<Innertube> | null = null;
let queue: Promise<unknown> = Promise.resolve();

const fetchFormat = async (info: Info, options: Types.FormatOptions) => {
  const format = info.chooseFormat(options);
  if ((format.content_length ?? 0) > MAX_BYTES) throw new TooLargeError('Too large');

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of Utils.streamToIterable(
    await info.download(options),
  )) {
    chunks.push(chunk);
    total += chunk.length;
    if (total > MAX_BYTES) throw new TooLargeError('Track too large');
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  const codec = /codecs="([^".]+)/.exec(format.mime_type)?.[1] ?? 'audio';
  const bitrate = format.average_bitrate ?? format.bitrate ?? 0;
  return {
    bytes,
    quality: `${codec} ${Math.round(bitrate / 1000)} kbps`,
    lowQuality: options === MUXED || bitrate < LOW_BITRATE,
  };
};

/**
 * Downloads the best audio-only stream it can get. Some accounts are
 * refused audio-only streams on the music client, so other clients are
 * tried before falling back to the much worse muxed video stream.
 */
const download = async (
  yt: Innertube,
  videoId: string,
): Promise<FetchedAudio | null> => {
  const clients: [string, () => Promise<Info>][] = [
    ['music', () => yt.music.getInfo(videoId)],
    ['ios', () => yt.getBasicInfo(videoId, { client: 'IOS' })],
    ['android', () => yt.getBasicInfo(videoId, { client: 'ANDROID' })],
    ['tv', () => yt.getBasicInfo(videoId, { client: 'TV' })],
  ];

  let musicInfo: Info | null = null;
  for (const [name, getInfo] of clients) {
    try {
      const info = await getInfo();
      if (info.playability_status?.status !== 'OK') continue;
      if (name === 'music') musicInfo = info;
      return await fetchFormat(info, AUDIO_ONLY);
    } catch (error) {
      if (error instanceof TooLargeError) return null;
    }
  }

  if (!musicInfo) return null;
  try {
    return await fetchFormat(musicInfo, MUXED);
  } catch {
    return null;
  }
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
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          // A stalled stream must not hold up every later download
          return await Promise.race([
            client.then((yt) => download(yt, videoId)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error('Timed out')),
                FETCH_TIMEOUT_MS,
              );
            }),
          ]);
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      });
      queue = result.catch(() => null);
      return result;
    });
    ipc.handle(APPLE_ANALYSIS_CHANNEL, (lookup: AppleLookup) =>
      appleAnalysis(lookup),
    );
  },
  stop({ ipc }: BackendContext<AutoMixPluginConfig>) {
    ipc.removeHandler(FETCH_AUDIO_CHANNEL);
    ipc.removeHandler(APPLE_ANALYSIS_CHANNEL);
  },
};
