import { findStream } from './audio-tap';
import { log } from './diagnostics';
import { PagedAudio } from './paged-audio';
import { Separator } from './separator';
import { SongAudio } from './song-audio';
import {
  BLOCK_SAMPLES,
  getBlockAt,
  getBlockCount,
  getOverlapWeight,
  LOOKAHEAD_SECONDS,
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

// Only blocks near the playhead are held, here and in the stem player, so memory
// stays the same however long the video is. A seek recomputes what was dropped.
const BLOCKS_KEPT_BEHIND = 2;
const BLOCKS_KEPT_AHEAD = 2;

const VOCALS_LEFT = 0;
const VOCALS_RIGHT = 1;
const WEIGHTS = 2;

const contextsWithPlayer = new WeakSet<BaseAudioContext>();

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

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
    const blockCount = getBlockCount(song.length);
    const vocals = new PagedAudio(3, BLOCK_SAMPLES, song.length);

    const isAvailable = (block: number) => {
      const blockStart = block * BLOCK_SAMPLES;
      return song.has(blockStart, blockStart + SEGMENT_SAMPLES);
    };

    while (isCurrent()) {
      this.keepWindow(song, vocals);
      song.useStream(findStream(duration) ?? stream);
      await song.update();
      if (!isCurrent()) return;

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
      const separated = await separator.getVocals(
        song.read('left', start, SEGMENT_SAMPLES),
        song.read('right', start, SEGMENT_SAMPLES),
      );
      if (!isCurrent()) return;

      const weight = (i: number) => getOverlapWeight(i, SEGMENT_SAMPLES);
      const length = Math.min(SEGMENT_SAMPLES, song.length - start);
      vocals.add(
        VOCALS_LEFT,
        start,
        separated.left.subarray(0, length),
        weight,
      );
      vocals.add(
        VOCALS_RIGHT,
        start,
        separated.right.subarray(0, length),
        weight,
      );
      vocals.add(WEIGHTS, start, new Float32Array(length).fill(1), weight);

      // The window may have moved on while the GPU worked.
      if (!vocals.holds(start, start + 1)) continue;

      this.postBlock(block, song, vocals);
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

  /** Moves the held window to the playhead and drops blocks outside it. */
  private keepWindow(song: SongAudio, vocals: PagedAudio) {
    const first = Math.max(0, getBlockAt(this.playhead) - BLOCKS_KEPT_BEHIND);
    const last =
      getBlockAt(this.playhead + LOOKAHEAD_SECONDS) + BLOCKS_KEPT_AHEAD;

    song.setWindow(first, last);
    vocals.setWindow(first, last);
    for (const block of this.doneBlocks) {
      if (block < first || block > last) this.doneBlocks.delete(block);
    }
    this.player?.port.postMessage({ type: 'keep', first, last });
  }

  private postBlock(block: number, song: SongAudio, vocals: PagedAudio) {
    const start = block * BLOCK_SAMPLES;
    const length = Math.min(BLOCK_SAMPLES, song.length - start);

    const left = song.read('left', start, length);
    const right = song.read('right', start, length);
    const vocalsLeft = vocals.read(VOCALS_LEFT, start, length);
    const vocalsRight = vocals.read(VOCALS_RIGHT, start, length);
    const weights = vocals.read(WEIGHTS, start, length);
    const instrumentalLeft = new Float32Array(length);
    const instrumentalRight = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const weight = weights[i];
      vocalsLeft[i] = weight > 0 ? vocalsLeft[i] / weight : 0;
      vocalsRight[i] = weight > 0 ? vocalsRight[i] / weight : 0;
      // Taking the vocals out of the original keeps everything else intact.
      instrumentalLeft[i] = left[i] - vocalsLeft[i];
      instrumentalRight[i] = right[i] - vocalsRight[i];
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
