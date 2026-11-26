import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { app } from 'electron';

import { createBackend } from '@/utils';

import type { KaraokeModePluginConfig } from './index';
import type { BackendContext } from '@/types/contexts';

export type SeparationStage = 'downloading' | 'separating';

export type SeparationProgress = {
  videoId: string;
  stage: SeparationStage;
  /** 0–100, or null when the tool doesn't report it */
  percent: number | null;
};

export type SeparatedStems = {
  vocals: Uint8Array;
  instrumental: Uint8Array;
};

const VIDEO_ID = /^[\w-]{11}$/;
// demucs models are named like htdemucs, htdemucs_ft, mdx_extra_q
const MODEL_NAME = /^[\w-]+$/;

const cacheRoot = () => path.join(app.getPath('userData'), 'karaoke-stems');

const stemPaths = (model: string, videoId: string) => {
  const dir = path.join(cacheRoot(), model);
  return {
    dir,
    vocals: path.join(dir, `${videoId}.vocals.flac`),
    instrumental: path.join(dir, `${videoId}.instrumental.flac`),
  };
};

export const clearCache = () =>
  fs.rm(cacheRoot(), { recursive: true, force: true });

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  );

/** Runs a command, reporting each progress percentage it prints. */
const run = (
  command: string,
  args: string[],
  onPercent?: (percent: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      // Make demucs/yt-dlp print progress line by line instead of buffering
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let tail = '';
    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      tail = (tail + text).slice(-2000);
      if (!onPercent) return;
      // demucs: " 42%|████" (tqdm), yt-dlp: "[download]  42.0% of ..."
      const matches = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)%/g)];
      const last = matches.at(-1);
      if (last) onPercent(Math.min(100, Number(last[1])));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    child.on('error', (error) =>
      reject(
        new Error(
          `Could not start "${command}". Is it installed and on PATH? (${error.message})`,
        ),
      ),
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(`"${command}" exited with code ${code}:\n${tail.trim()}`),
        );
    });
  });

const separate = async (
  videoId: string,
  config: KaraokeModePluginConfig,
  report: (progress: SeparationProgress) => void,
) => {
  const { model } = config;
  const stems = stemPaths(model, videoId);
  if ((await exists(stems.vocals)) && (await exists(stems.instrumental))) {
    return stems;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ytm-vocal-'));
  try {
    report({ videoId, stage: 'downloading', percent: null });
    await run(
      config.ytDlpCommand,
      [
        '--format',
        'bestaudio',
        '--no-playlist',
        '--newline',
        '--output',
        path.join(tmp, 'audio.%(ext)s'),
        '--',
        `https://music.youtube.com/watch?v=${videoId}`,
      ],
      (percent) => report({ videoId, stage: 'downloading', percent }),
    );

    const audio = (await fs.readdir(tmp)).find((f) => f.startsWith('audio.'));
    if (!audio) throw new Error('yt-dlp finished but wrote no audio file');

    report({ videoId, stage: 'separating', percent: 0 });
    const out = path.join(tmp, 'out');
    await run(
      config.demucsCommand,
      [
        '--name',
        model,
        '--two-stems',
        'vocals',
        '--flac',
        '--out',
        out,
        path.join(tmp, audio),
      ],
      (percent) => report({ videoId, stage: 'separating', percent }),
    );

    // demucs writes <out>/<model>/<input name without extension>/<stem>.flac
    const result = path.join(out, model, path.parse(audio).name);
    await fs.mkdir(stems.dir, { recursive: true });
    await fs.copyFile(path.join(result, 'vocals.flac'), stems.vocals);
    await fs.copyFile(path.join(result, 'no_vocals.flac'), stems.instrumental);
    return stems;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
};

let config: KaraokeModePluginConfig;
// One GPU job at a time; jobs for the same song are shared.
let queue: Promise<unknown> = Promise.resolve();
const jobs = new Map<string, Promise<ReturnType<typeof stemPaths>>>();

const getStems = (
  videoId: string,
  ipc: BackendContext<KaraokeModePluginConfig>['ipc'],
) => {
  const key = `${config.model}/${videoId}`;
  let job = jobs.get(key);
  if (!job) {
    const snapshot = { ...config };
    job = queue.then(() =>
      separate(videoId, snapshot, (progress) =>
        ipc.send('karaoke-mode:progress', progress),
      ),
    );
    queue = job.catch(() => {});
    jobs.set(key, job);
    // Keep only the in-flight job; finished ones are on disk
    job.then(
      () => jobs.delete(key),
      () => jobs.delete(key),
    );
  }
  return job;
};

export const backend = createBackend<object, KaraokeModePluginConfig>({
  async start(ctx) {
    config = await ctx.getConfig();

    ctx.ipc.handle(
      'karaoke-mode:separate',
      async (videoId: string): Promise<SeparatedStems> => {
        if (!VIDEO_ID.test(videoId)) throw new Error('Invalid video id');
        if (!MODEL_NAME.test(config.model)) throw new Error('Invalid model');

        const stems = await getStems(videoId, ctx.ipc);
        const [vocals, instrumental] = await Promise.all([
          fs.readFile(stems.vocals),
          fs.readFile(stems.instrumental),
        ]);
        return { vocals, instrumental };
      },
    );

    // Whether this song was already separated with the current model
    ctx.ipc.handle('karaoke-mode:is-cached', async (videoId: string) => {
      if (!VIDEO_ID.test(videoId) || !MODEL_NAME.test(config.model))
        return false;
      const stems = stemPaths(config.model, videoId);
      return (await exists(stems.vocals)) && (await exists(stems.instrumental));
    });
  },
  onConfigChange(newConfig) {
    config = newConfig;
  },
  stop(ctx) {
    ctx.ipc.removeHandler('karaoke-mode:separate');
    ctx.ipc.removeHandler('karaoke-mode:is-cached');
  },
});
