/**
 * Serial job queue for downloads.
 *
 * Conversion runs through a single ffmpeg.wasm instance anyway, so running
 * downloads one after another keeps memory usage low and makes the progress
 * reporting predictable. Jobs are deduplicated by key, which prevents the same
 * song from being queued twice (e.g. by a double click or by "download on
 * finish" racing with a manual download).
 */

interface QueueEntry {
  key: string;
  run: () => Promise<void>;
}

const pending: QueueEntry[] = [];
const knownKeys = new Set<string>();
let draining = false;

export const isQueued = (key: string) => knownKeys.has(key);

const drain = async () => {
  if (draining) return;
  draining = true;

  try {
    while (pending.length > 0) {
      const entry = pending.shift()!;
      try {
        await entry.run();
      } catch (error: unknown) {
        console.error('[downloader] job failed', error);
      } finally {
        knownKeys.delete(entry.key);
      }
    }
  } finally {
    draining = false;
  }
};

/**
 * Adds a job to the queue.
 * @returns false when a job with the same key is already queued or running
 */
export const enqueue = (key: string, run: () => Promise<void>): boolean => {
  if (knownKeys.has(key)) {
    return false;
  }

  knownKeys.add(key);
  pending.push({ key, run });
  drain().catch((error: unknown) =>
    console.error('[downloader] queue failed', error),
  );
  return true;
};
