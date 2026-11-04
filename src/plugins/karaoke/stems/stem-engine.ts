import { findStream } from './audio-tap';
import { log } from './diagnostics';
import { Separator } from './separator';
import { SongAudio } from './song-audio';
import {
  BLOCK_SAMPLES,
  getBlockAt,
  getBlockCount,
  getOverlapWeight,
  pickNextBlock,
  SEGMENT_SAMPLES,
} from './stem-math';
import workletSource from './stem-player.worklet.js?raw';

import type { KaraokePluginConfig } from '../types';
import type { RendererContext } from '@/types/contexts';

const IDLE_POLL_MS = 500;
const STREAM_TIMEOUT_MS = 20000;

// Once playback is safely covered there is no hurry, so the GPU gets long breaks
// instead of running flat out while someone may be using the computer.
const SAFE_BLOCKS_AHEAD = 2;
const RELAXED_GAP_MS = 1500;

export type StemStatus =
  | 'idle'
  | 'loading-model'
  | 'separating'
  | 'ready'
  | 'recovering'
  | 'failed';

type Ipc = RendererContext<KaraokePluginConfig>['ipc'];

const GPU_RETRY_MS = 2000;

const contextsWithPlayer = new WeakSet<BaseAudioContext>();

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const copySegment = (channel: Float32Array, start: number) => {
  const segment = new Float32Array(SEGMENT_SAMPLES);
  segment.set(channel.subarray(start, start + SEGMENT_SAMPLES));
  return segment;
};

/** Separates the current song ahead of the playhead and feeds the stem player. */
export class StemEngine {
  private separator: Promise<Separator> | null = null;
  private player: AudioWorkletNode | null = null;
  private currentJob = 0;
  private videoId: string | null = null;
  private doneBlocks = new Set<number>();
  private playhead = 0;
  private vocalGain = 0;
  private playerHasAudio = false;
  private song: SongAudio | null = null;

  constructor(
    private readonly ipc: Ipc,
    private readonly onStatus: (status: StemStatus) => void,
  ) {}

  async createPlayer(context: BaseAudioContext) {
    if (!contextsWithPlayer.has(context)) {
      const url = URL.createObjectURL(
        new Blob([workletSource], { type: 'application/javascript' }),
      );
      try {
        await context.audioWorklet.addModule(url);
        contextsWithPlayer.add(context);
      } finally {
        URL.revokeObjectURL(url);
      }
    }

    this.player = new AudioWorkletNode(context, 'karaoke-stem-player', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.player.port.onmessage = ({
      data,
    }: MessageEvent<{ hasAudio: boolean }>) => {
      this.playerHasAudio = data.hasAudio;
    };
    this.setVocalGain(this.vocalGain);
    return this.player;
  }

  /** Starts on a new song. Does nothing if this song is already in progress. */
  play(videoId: string, duration: number) {
    if (videoId === this.videoId) return;

    log(`play ${videoId} duration ${duration}`);
    this.videoId = videoId;
    this.song = null;
    this.doneBlocks = new Set();
    this.playhead = 0;
    const job = ++this.currentJob;

    this.run(job, videoId, duration).catch((error: unknown) => {
      console.error('[karaoke] AI vocals failed:', error);
      log(`failed ${videoId}: ${String(error)}`);
      if (job === this.currentJob) {
        // Lets the next try start clean, without holding on to the GPU.
        const failed = this.separator;
        this.separator = null;
        failed?.then((it) => it.release()).catch(() => null);
        this.onStatus('failed');
      }
    });
  }

  describe() {
    const done = [...this.doneBlocks].sort((a, b) => a - b).join(',');
    return `video=${this.videoId} blockNow=${getBlockAt(this.playhead)} done=${done} playerHasAudio=${this.playerHasAudio} song=${this.song?.describe() ?? 'none'}`;
  }

  setPlayhead(time: number) {
    this.playhead = time;
  }

  isCovering(videoId: string, time: number) {
    // The player's own word counts, because the filter gets turned down on the
    // strength of this. If the player is not running, it stays silent about it.
    return (
      videoId === this.videoId &&
      this.doneBlocks.has(getBlockAt(time)) &&
      this.playerHasAudio
    );
  }

  sync(time: number, isPlaying: boolean) {
    this.player?.port.postMessage({ type: 'sync', time, isPlaying });
  }

  setVocalGain(gain: number) {
    this.vocalGain = gain;
    this.player?.port.postMessage({ type: 'vocals', gain });
  }

  /** Stops all work and frees the GPU memory. */
  async dispose() {
    this.currentJob++;
    this.videoId = null;
    this.doneBlocks = new Set();
    this.player?.port.postMessage({
      type: 'sync',
      time: 0,
      isPlaying: false,
    });
    this.player?.disconnect();
    this.player = null;

    const separator = this.separator;
    this.separator = null;
    this.onStatus('idle');
    await (await separator)?.release();
  }

  private async loadSeparator() {
    const { wasm, model } = (await this.ipc.invoke('karaoke:get-runtime')) as {
      wasm: Uint8Array;
      model: Uint8Array;
    };
    try {
      return await Separator.create(wasm, model);
    } catch (error) {
      console.warn('[karaoke] Retrying AI vocals:', error);
      await sleep(GPU_RETRY_MS);
      return await Separator.create(wasm, model);
    }
  }

  private async run(job: number, videoId: string, duration: number) {
    const isCurrent = () => job === this.currentJob;

    this.onStatus('loading-model');
    this.separator ??= this.loadSeparator();
    const separator = await this.separator;
    if (!isCurrent()) return;

    this.onStatus('separating');
    const stream = await this.waitForStream(duration, isCurrent);
    if (!stream) return;

    this.player?.port.postMessage({
      type: 'reset',
      blockSamples: BLOCK_SAMPLES,
    });

    const song = new SongAudio(stream, duration);
    this.song = song;
    log(`stream found for ${videoId}: ${stream.describe()}`);
    const { left, right } = song;
    const blockCount = getBlockCount(song.length);
    const vocalsLeft = new Float32Array(song.length);
    const vocalsRight = new Float32Array(song.length);
    const weights = new Float32Array(song.length);

    const isAvailable = (block: number) => {
      const blockStart = block * BLOCK_SAMPLES;
      return song.has(blockStart, blockStart + SEGMENT_SAMPLES);
    };

    while (isCurrent()) {
      song.useStream(findStream(duration) ?? stream);
      await song.update();

      const block = pickNextBlock(
        this.doneBlocks,
        this.playhead,
        blockCount,
        isAvailable,
      );
      if (block === null) {
        await sleep(IDLE_POLL_MS);
        continue;
      }

      const start = block * BLOCK_SAMPLES;
      const vocals = await separator.getVocals(
        copySegment(left, start),
        copySegment(right, start),
      );
      if (!isCurrent()) return;

      const length = Math.min(SEGMENT_SAMPLES, left.length - start);
      for (let i = 0; i < length; i++) {
        const weight = getOverlapWeight(i, SEGMENT_SAMPLES);
        vocalsLeft[start + i] += vocals.left[i] * weight;
        vocalsRight[start + i] += vocals.right[i] * weight;
        weights[start + i] += weight;
      }

      this.postBlock(block, { left, right, vocalsLeft, vocalsRight, weights });
      this.doneBlocks.add(block);
      if (this.isCovering(videoId, this.playhead)) this.onStatus('ready');

      const isSafelyAhead =
        block >= getBlockAt(this.playhead) + SAFE_BLOCKS_AHEAD;
      await sleep(isSafelyAhead ? RELAXED_GAP_MS : 0);
    }
  }

  private async waitForStream(duration: number, isCurrent: () => boolean) {
    for (let waited = 0; waited < STREAM_TIMEOUT_MS; waited += IDLE_POLL_MS) {
      if (!isCurrent()) return null;

      const stream = findStream(duration);
      if (stream) return stream;
      await sleep(IDLE_POLL_MS);
    }
    throw new Error('The player did not provide any audio to read');
  }

  private postBlock(
    block: number,
    song: {
      left: Float32Array;
      right: Float32Array;
      vocalsLeft: Float32Array;
      vocalsRight: Float32Array;
      weights: Float32Array;
    },
  ) {
    const start = block * BLOCK_SAMPLES;
    const length = Math.min(BLOCK_SAMPLES, song.left.length - start);

    const vocalsLeft = new Float32Array(length);
    const vocalsRight = new Float32Array(length);
    const instrumentalLeft = new Float32Array(length);
    const instrumentalRight = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const index = start + i;
      const weight = song.weights[index];
      const voiceLeft = weight > 0 ? song.vocalsLeft[index] / weight : 0;
      const voiceRight = weight > 0 ? song.vocalsRight[index] / weight : 0;

      vocalsLeft[i] = voiceLeft;
      vocalsRight[i] = voiceRight;
      // Taking the vocals out of the original keeps everything else intact.
      instrumentalLeft[i] = song.left[index] - voiceLeft;
      instrumentalRight[i] = song.right[index] - voiceRight;
    }

    this.player?.port.postMessage(
      {
        type: 'block',
        block,
        vocalsLeft,
        vocalsRight,
        instrumentalLeft,
        instrumentalRight,
      },
      [
        vocalsLeft.buffer,
        vocalsRight.buffer,
        instrumentalLeft.buffer,
        instrumentalRight.buffer,
      ],
    );
  }
}
