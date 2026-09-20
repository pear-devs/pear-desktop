import { setBadge } from './utils';

import {
  type DownloadState,
  type DownloadStatus,
  type DownloadTask,
  DownloaderIPC,
  isFinishedStatus,
} from '../types';

import type { BrowserWindow } from 'electron';

/** How long a finished task stays in the list before it disappears */
const FINISHED_TASK_TTL = 12_000;
/** Minimum delay between two state broadcasts, to not flood the renderer */
const BROADCAST_INTERVAL = 120;

export class DownloadCancelledError extends Error {
  constructor() {
    super('Download cancelled');
    this.name = 'DownloadCancelledError';
  }
}

let win: BrowserWindow | undefined;
let taskCounter = 0;
let broadcastTimeout: NodeJS.Timeout | undefined;

const tasks = new Map<string, DownloadTask>();
const removalTimers = new Map<string, NodeJS.Timeout>();
const cancelled = new Set<string>();

export const attachWindow = (window: BrowserWindow) => {
  win = window;
};

const isAlive = () =>
  !!win && !win.isDestroyed() && !win.webContents.isDestroyed();

const activeTasks = () =>
  [...tasks.values()].filter((task) => !isFinishedStatus(task.status));

const updateNativeProgress = () => {
  if (!isAlive()) return;

  const active = activeTasks();
  if (active.length === 0) {
    win!.setProgressBar(-1);
    setBadge(0);
    return;
  }

  const determinate = active.filter((task) => task.progress >= 0);
  win!.setProgressBar(
    determinate.length === 0
      ? 2 // indeterminate
      : determinate.reduce((sum, task) => sum + Math.min(task.progress, 1), 0) /
          active.length,
  );
  setBadge(active.length);
};

const broadcastNow = () => {
  broadcastTimeout = undefined;
  updateNativeProgress();

  if (!isAlive()) return;

  const state: DownloadState = {
    tasks: [...tasks.values()].sort((a, b) => a.createdAt - b.createdAt),
  };
  win!.webContents.send(DownloaderIPC.state, state);
};

const broadcast = (immediate = false) => {
  if (immediate) {
    if (broadcastTimeout) {
      clearTimeout(broadcastTimeout);
    }
    broadcastNow();
    return;
  }

  broadcastTimeout ??= setTimeout(broadcastNow, BROADCAST_INTERVAL);
};

/** Re-sends the current state, e.g. after the renderer was reloaded */
export const resendState = () => broadcast(true);

export const createTask = (
  init: Pick<DownloadTask, 'title'> & Partial<DownloadTask>,
): string => {
  const id = `task-${++taskCounter}`;
  tasks.set(id, {
    status: 'queued',
    progress: -1,
    automatic: false,
    retryable: false,
    createdAt: Date.now(),
    ...init,
    id,
  });
  broadcast(true);
  return id;
};

export const getTask = (id: string): DownloadTask | undefined => tasks.get(id);

export const updateTask = (id: string, patch: Partial<DownloadTask>) => {
  const task = tasks.get(id);
  if (!task) return;

  const isProgressOnly =
    Object.keys(patch).length === 1 && patch.progress !== undefined;

  Object.assign(task, patch);
  broadcast(!isProgressOnly);
};

const scheduleRemoval = (id: string) => {
  clearTimeout(removalTimers.get(id));
  removalTimers.set(
    id,
    setTimeout(() => {
      removalTimers.delete(id);
      tasks.delete(id);
      cancelled.delete(id);
      broadcast(true);
    }, FINISHED_TASK_TTL),
  );
};

export const finishTask = (
  id: string,
  status: Extract<DownloadStatus, 'done' | 'skipped' | 'cancelled' | 'error'>,
  error?: string,
) => {
  const task = tasks.get(id);
  if (!task) return;

  task.status = status;
  task.progress = status === 'done' ? 1 : task.progress;
  task.error = error;
  broadcast(true);

  // Errors stay until the user dismisses them, everything else disappears
  if (status !== 'error') {
    scheduleRemoval(id);
  }
};

export const requestCancel = (id: string) => {
  const task = tasks.get(id);
  if (!task || isFinishedStatus(task.status)) return;

  cancelled.add(id);
  if (task.status === 'queued') {
    finishTask(id, 'cancelled');
  } else {
    broadcast(true);
  }
};

export const isCancelRequested = (id: string) => cancelled.has(id);

/** Throws if the task was cancelled, used to abort long running steps */
export const throwIfCancelled = (id: string) => {
  if (cancelled.has(id)) {
    throw new DownloadCancelledError();
  }
};

export const dismissTask = (id: string) => {
  clearTimeout(removalTimers.get(id));
  removalTimers.delete(id);
  tasks.delete(id);
  cancelled.delete(id);
  broadcast(true);
};

export const clearFinishedTasks = () => {
  for (const [id, task] of tasks) {
    if (isFinishedStatus(task.status)) {
      clearTimeout(removalTimers.get(id));
      removalTimers.delete(id);
      tasks.delete(id);
      cancelled.delete(id);
    }
  }
  broadcast(true);
};
