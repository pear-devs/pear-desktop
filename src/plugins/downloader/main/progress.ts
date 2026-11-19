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

/** Binds the window that receives the state broadcasts */
export const attachWindow = (window: BrowserWindow) => {
  win = window;
};

/** Guards against sending to a window that is already gone */
const isAlive = () =>
  !!win && !win.isDestroyed() && !win.webContents.isDestroyed();

/** Every task that has not reached a final status yet */
const activeTasks = () =>
  [...tasks.values()].filter((task) => !isFinishedStatus(task.status));

/** Mirrors the combined progress onto the taskbar or dock icon */
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

/** Sends the current task list to the renderer right away */
const broadcastNow = () => {
  broadcastTimeout = undefined;
  updateNativeProgress();

  if (!isAlive()) return;

  const state: DownloadState = {
    tasks: [...tasks.values()].sort((a, b) => a.createdAt - b.createdAt),
  };
  win!.webContents.send(DownloaderIPC.state, state);
};

/** Sends the state, coalescing the frequent progress updates */
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

/** Registers a task in the panel and returns its id */
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

/** Looks up a task, as long as it is still in the list */
export const getTask = (id: string): DownloadTask | undefined => tasks.get(id);

/** Patches a task, a pure progress change is broadcast with a delay */
export const updateTask = (id: string, patch: Partial<DownloadTask>) => {
  const task = tasks.get(id);
  if (!task) return;

  const isProgressOnly =
    Object.keys(patch).length === 1 && patch.progress !== undefined;

  Object.assign(task, patch);
  broadcast(!isProgressOnly);
};

/** Drops a finished task from the list once its TTL is over */
const scheduleRemoval = (id: string) => {
  clearTimeout(removalTimers.get(id));
  removalTimers.set(
    id,
    setTimeout(() => {
      removalTimers.delete(id);
      tasks.delete(id);
      broadcast(true);
    }, FINISHED_TASK_TTL),
  );
};

/** Moves a task to its final status, errors stay until they are dismissed */
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

/** Marks a task as cancelled, a task that never started ends right away */
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

/** True once a cancel was requested for this task */
export const isCancelRequested = (id: string) => cancelled.has(id);

/** Drops the cancel marker of a finished job so it cannot pile up */
export const releaseCancel = (id: string) => {
  cancelled.delete(id);
};

/** Throws if the task was cancelled, used to abort long running steps */
export const throwIfCancelled = (id: string) => {
  if (cancelled.has(id)) {
    throw new DownloadCancelledError();
  }
};

/** Removes a task from the list, e.g. when the user closes it */
export const dismissTask = (id: string) => {
  clearTimeout(removalTimers.get(id));
  removalTimers.delete(id);
  tasks.delete(id);
  broadcast(true);
};

/** Removes every task that already reached a final status */
export const clearFinishedTasks = () => {
  for (const [id, task] of tasks) {
    if (isFinishedStatus(task.status)) {
      clearTimeout(removalTimers.get(id));
      removalTimers.delete(id);
      tasks.delete(id);
    }
  }
  broadcast(true);
};
