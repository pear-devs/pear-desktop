import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { type BrowserWindow } from 'electron';
import filenamify from 'filenamify';
import is from 'electron-is';

import { t } from '@/i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

export type DownloadItemStatus =
  | 'queued'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface DownloadItem {
  id: string;
  url: string;
  title: string;
  artist: string;
  status: DownloadItemStatus;
  progress: number;
  currentProvider: string;
  currentAttempt: number;
  totalProviderAttempts: number;
  error?: string;
  playlistFolder?: string;
  trackId?: string;
  isPlaylist: boolean;
  fileName?: string;
}

export interface DownloadManagerState {
  queue: DownloadItem[];
  activeCount: number;
  maxConcurrent: number;
  isPaused: boolean;
  totalCompleted: number;
  totalFailed: number;
  totalSkipped: number;
}

export type DownloadFunction = (
  item: DownloadItem,
  onProgress: (progress: number, provider: string, attempt: number) => void,
) => Promise<void>;

// ─── Providers ───────────────────────────────────────────────────────────────

const PROVIDERS = ['YTMUSIC', 'ANDROID', 'TV_EMBEDDED'] as const;
const MAX_RETRIES_PER_PROVIDER = 3;

// ─── Engine ──────────────────────────────────────────────────────────────────

export class DownloadManagerEngine {
  private queue: DownloadItem[] = [];
  private activeDownloads = 0;
  private maxConcurrent = 1;
  private isPaused = false;
  private downloadFn: DownloadFunction | null = null;
  private win: BrowserWindow | null = null;
  private completedItems: DownloadItem[] = [];
  private failedItems: DownloadItem[] = [];
  private idCounter = 0;

  // Stats
  private totalCompleted = 0;
  private totalFailed = 0;
  private totalSkipped = 0;

  setWindow(win: BrowserWindow): void {
    this.win = win;
  }

  setDownloadFunction(fn: DownloadFunction): void {
    this.downloadFn = fn;
  }

  setMaxConcurrent(max: number): void {
    this.maxConcurrent = Math.max(1, Math.min(5, max));
    this.broadcastState();
    // Try to start more downloads if we increased concurrency
    this.processQueue();
  }

  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  /**
   * Add a single song to the download queue
   */
  addToQueue(params: {
    url: string;
    title: string;
    artist: string;
    playlistFolder?: string;
    trackId?: string;
    isPlaylist?: boolean;
    downloadFolder: string;
    fileExtension: string;
  }): string {
    const { url, title, artist, playlistFolder, trackId, isPlaylist, downloadFolder, fileExtension } = params;

    const id = `dl-${++this.idCounter}-${Date.now()}`;

    const name = `${artist ? `${artist} - ` : ''}${title}`;
    let filename = filenamify(`${name}.${fileExtension}`, {
      replacement: '_',
      maxLength: 255,
    });
    if (!is.macOS()) {
      filename = filename.normalize('NFC');
    }

    const dir = playlistFolder || downloadFolder;
    const filePath = join(dir, filename);

    // Check if file already exists
    if (existsSync(filePath)) {
      const item: DownloadItem = {
        id,
        url,
        title,
        artist,
        status: 'skipped',
        progress: 100,
        currentProvider: '',
        currentAttempt: 0,
        totalProviderAttempts: 0,
        playlistFolder,
        trackId,
        isPlaylist: isPlaylist ?? false,
        fileName: filename,
      };
      this.totalSkipped++;
      this.completedItems.unshift(item);
      // Keep last 100 completed
      if (this.completedItems.length > 100) {
        this.completedItems = this.completedItems.slice(0, 100);
      }
      this.broadcastState();
      this.broadcastItemUpdate(item);
      return id;
    }

    const item: DownloadItem = {
      id,
      url,
      title,
      artist,
      status: 'queued',
      progress: 0,
      currentProvider: '',
      currentAttempt: 0,
      totalProviderAttempts: 0,
      playlistFolder,
      trackId,
      isPlaylist: isPlaylist ?? false,
      fileName: filename,
    };

    this.queue.push(item);
    this.broadcastState();
    this.broadcastItemUpdate(item);

    // Start processing
    this.processQueue();

    return id;
  }

  /**
   * Retry all failed downloads
   */
  retryFailed(): void {
    const failed = [...this.failedItems];
    this.failedItems = [];
    this.totalFailed -= failed.length;

    for (const item of failed) {
      item.status = 'queued';
      item.progress = 0;
      item.currentProvider = '';
      item.currentAttempt = 0;
      item.totalProviderAttempts = 0;
      item.error = undefined;
      this.queue.push(item);
      this.broadcastItemUpdate(item);
    }

    this.broadcastState();
    this.processQueue();
  }

  /**
   * Retry a single failed download
   */
  retrySingle(itemId: string): void {
    const idx = this.failedItems.findIndex((i) => i.id === itemId);
    if (idx === -1) return;

    const [item] = this.failedItems.splice(idx, 1);
    this.totalFailed--;

    item.status = 'queued';
    item.progress = 0;
    item.currentProvider = '';
    item.currentAttempt = 0;
    item.totalProviderAttempts = 0;
    item.error = undefined;

    this.queue.push(item);
    this.broadcastItemUpdate(item);
    this.broadcastState();
    this.processQueue();
  }

  /**
   * Remove a single item from failed list
   */
  removeFailed(itemId: string): void {
    const idx = this.failedItems.findIndex((i) => i.id === itemId);
    if (idx !== -1) {
      this.failedItems.splice(idx, 1);
      this.totalFailed--;
      this.broadcastState();
    }
  }

  /**
   * Clear all completed/skipped downloads
   */
  clearCompleted(): void {
    this.completedItems = [];
    this.broadcastState();
  }

  /**
   * Pause all downloads (finish current, don't start new)
   */
  pauseAll(): void {
    this.isPaused = true;
    this.broadcastState();
  }

  /**
   * Resume downloading from queue
   */
  resumeAll(): void {
    this.isPaused = false;
    this.broadcastState();
    this.processQueue();
  }

  /**
   * Get current state for UI
   */
  getState(): DownloadManagerState {
    return {
      queue: [
        ...this.queue,
        ...this.failedItems,
        ...this.completedItems,
      ],
      activeCount: this.activeDownloads,
      maxConcurrent: this.maxConcurrent,
      isPaused: this.isPaused,
      totalCompleted: this.totalCompleted,
      totalFailed: this.totalFailed,
      totalSkipped: this.totalSkipped,
    };
  }

  /**
   * Get queue size (pending + active)
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  getActiveCount(): number {
    return this.activeDownloads;
  }

  getFailedCount(): number {
    return this.failedItems.length;
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.isPaused) return;
    if (!this.downloadFn) return;

    while (
      this.activeDownloads < this.maxConcurrent &&
      this.queue.length > 0 &&
      !this.isPaused
    ) {
      const item = this.queue.find((i) => i.status === 'queued');
      if (!item) break;

      item.status = 'downloading';
      this.activeDownloads++;
      this.broadcastState();
      this.broadcastItemUpdate(item);

      // Start download in background (don't await)
      this.executeDownload(item).catch((err) => {
        console.error('[DownloadManager] Fatal error in download execution:', err);
      });
    }

    // Update progress bar
    this.updateProgressBar();
  }

  private async executeDownload(item: DownloadItem): Promise<void> {
    let lastError: string | undefined;

    for (const provider of PROVIDERS) {
      for (let attempt = 1; attempt <= MAX_RETRIES_PER_PROVIDER; attempt++) {
        item.currentProvider = provider;
        item.currentAttempt = attempt;
        item.totalProviderAttempts++;
        this.broadcastItemUpdate(item);

        try {
          // Clone item with provider info for the download fn
          const downloadItem = { ...item, currentProvider: provider };
          await this.downloadFn!(downloadItem, (progress, prov, att) => {
            item.progress = progress;
            item.currentProvider = prov;
            item.currentAttempt = att;
            this.broadcastItemUpdate(item);
            this.updateProgressBar();
          });

          // Success!
          item.status = 'completed';
          item.progress = 100;
          this.totalCompleted++;
          this.activeDownloads--;

          // Move from queue to completed
          this.removeFromQueue(item.id);
          this.completedItems.unshift(item);
          if (this.completedItems.length > 100) {
            this.completedItems = this.completedItems.slice(0, 100);
          }

          this.broadcastState();
          this.broadcastItemUpdate(item);
          this.processQueue();
          return;
        } catch (error) {
          lastError =
            error instanceof Error ? error.message : String(error);
          console.warn(
            `[DownloadManager] Attempt ${attempt}/${MAX_RETRIES_PER_PROVIDER} for provider ${provider} failed:`,
            lastError,
          );
        }
      }
    }

    // All providers and retries exhausted
    item.status = 'failed';
    item.error = lastError ?? t('plugins.downloader.backend.dialog.error.message');
    this.totalFailed++;
    this.activeDownloads--;

    // Move from queue to failed
    this.removeFromQueue(item.id);
    this.failedItems.push(item);

    this.broadcastState();
    this.broadcastItemUpdate(item);
    this.processQueue();
  }

  private removeFromQueue(id: string): void {
    const idx = this.queue.findIndex((i) => i.id === id);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
    }
  }

  private broadcastState(): void {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('download-manager-state', this.getState());
    } catch {
      // Window might be closed
    }
  }

  private broadcastItemUpdate(item: DownloadItem): void {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      this.win.webContents.send('download-manager-item-update', item);
    } catch {
      // Window might be closed
    }
  }

  private updateProgressBar(): void {
    if (!this.win || this.win.isDestroyed()) return;

    const downloadingItems = this.queue.filter(
      (i) => i.status === 'downloading',
    );
    if (downloadingItems.length === 0) {
      this.win.setProgressBar(-1);
      return;
    }

    const totalProgress =
      downloadingItems.reduce((sum, i) => sum + i.progress, 0) /
      downloadingItems.length /
      100;

    this.win.setProgressBar(Math.max(0, Math.min(1, totalProgress)));
  }
}

// Singleton instance
export const downloadManager = new DownloadManagerEngine();
