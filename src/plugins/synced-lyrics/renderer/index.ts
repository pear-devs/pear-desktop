import { getSongInfo } from '@/providers/song-info-front';
import { createRenderer } from '@/utils';

import { LyricsLifecycle, waitForLyricsElement } from './lifecycle';
import { disposeReactiveRoot, startReactiveRoot } from './reactive-root';
import { config, setConfig, setCurrentTime } from './renderer';
import { cancelSearch, disposeSearch, fetchLyrics } from './store';
import { selectors, startLyricsTabs, stopLyricsTabs, tabStates } from './utils';

import {
  migratePreferredProvider,
  normalizePreferredProvider,
} from '../preferences';
import { configureElectronTransport } from '../search/electron-transport';

import type { SyncedLyricsPluginConfig } from '../types';
import type { SongInfo } from '@/providers/song-info';
import type { MusicPlayer } from '@/types/music-player';

export let _ytAPI: MusicPlayer | null = null;
let lifetime: LyricsLifecycle | undefined;
let playerCleanup: (() => void) | undefined;
let headerLifetime: LyricsLifecycle | undefined;
let headerGeneration = 0;
let latestInfo: SongInfo | undefined;

export const renderer = createRenderer<
  {
    videoDataChange: () => Promise<void>;
    observer?: MutationObserver;
  },
  SyncedLyricsPluginConfig
>({
  onConfigChange(newConfig: SyncedLyricsPluginConfig) {
    const changed =
      config()?.showLyricsEvenIfInexact !== newConfig.showLyricsEvenIfInexact;
    setConfig({
      ...newConfig,
      preferredProvider: normalizePreferredProvider(
        newConfig.preferredProvider,
      ),
    });
    if (changed && lifetime && latestInfo) fetchLyrics(latestInfo);
  },
  async onPlayerApiReady(api: MusicPlayer) {
    if (!lifetime || lifetime.controller.signal.aborted) return;
    playerCleanup?.();
    _ytAPI = api;
    const change = () => {
      // Stop old work immediately, before richer song-info IPC arrives.
      if (latestInfo && api.getVideoData()?.video_id !== latestInfo.videoId) {
        cancelSearch();
        latestInfo = undefined;
      }
      this.videoDataChange().catch((error: unknown) =>
        console.error('Lyrics header setup failed', error),
      );
    };
    api.addEventListener('videodatachange', change);
    playerCleanup = () => api.removeEventListener('videodatachange', change);
    await this.videoDataChange();
  },
  async videoDataChange() {
    const active = lifetime;
    if (!active) return;
    headerLifetime?.dispose();
    const headerWork = new LyricsLifecycle();
    headerLifetime = headerWork;
    const generation = ++headerGeneration;
    const header = await waitForLyricsElement<HTMLElement>(
      selectors.head,
      headerWork.controller.signal,
    );
    if (
      !header ||
      active.controller.signal.aborted ||
      headerWork.controller.signal.aborted ||
      generation !== headerGeneration
    )
      return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'disabled')
          header.removeAttribute('disabled');
        if (mutation.attributeName === 'aria-selected')
          tabStates[header.ariaSelected ?? 'false']();
      }
    });
    // One header observer per lifetime, replace on track changes.
    this.observer?.disconnect();
    this.observer = observer;
    headerWork.add(() => observer.disconnect());
    header.removeAttribute('disabled');
    tabStates[header.ariaSelected ?? 'false']();
    observer.observe(header, { attributes: true });
  },
  observer: undefined as MutationObserver | undefined,
  async start(ctx) {
    lifetime?.dispose();
    const active = new LyricsLifecycle();
    lifetime = active;
    active.add(() => {
      playerCleanup?.();
      playerCleanup = undefined;
      _ytAPI = null;
    });
    active.add(() => {
      headerLifetime?.dispose();
      headerLifetime = undefined;
    });
    configureElectronTransport(ctx.ipc.invoke);
    active.add(() => configureElectronTransport(undefined));
    active.add(disposeSearch);
    startReactiveRoot();
    active.add(disposeReactiveRoot);
    startLyricsTabs();
    active.add(stopLyricsTabs);
    const timer = setInterval(
      () => setCurrentTime((_ytAPI?.getCurrentTime() ?? 0) * 1000),
      100,
    );
    active.add(() => clearInterval(timer));
    active.add(
      ctx.ipc.on('peard:update-song-info', (info: SongInfo) => {
        if (active.controller.signal.aborted) return;
        latestInfo = info;
        fetchLyrics(info);
      }),
    );
    const configuration = await ctx.getConfig();
    if (active.controller.signal.aborted) return;
    const preferredProvider = await migratePreferredProvider(
      configuration.preferredProvider,
      ctx.setConfig,
    );
    if (active.controller.signal.aborted) return;
    setConfig({ ...configuration, preferredProvider });
    const info = getSongInfo();
    if (info?.videoId) {
      latestInfo = info;
      fetchLyrics(info);
    }
  },
  stop() {
    lifetime?.dispose();
    lifetime = undefined;
    playerCleanup?.();
    playerCleanup = undefined;
    this.observer?.disconnect();
    this.observer = undefined;
    _ytAPI = null;
    latestInfo = undefined;
    headerGeneration++;
    setCurrentTime(-1);
  },
});
