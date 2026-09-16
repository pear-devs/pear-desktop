export interface SavedSection {
  videoId: string;
  startSeconds: number | null;
  endSeconds: number | null;
}

export type SavedSongs = SavedSection[];

/** `null` is a valid "unset" point; `undefined` marks the value invalid. */
function sanitizeTime(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function sanitizeEntry(raw: unknown): SavedSection | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const videoId = record.videoId;
  if (typeof videoId !== 'string' || videoId === '') return null;

  const startSeconds = sanitizeTime(record.startSeconds);
  const endSeconds = sanitizeTime(record.endSeconds);
  if (startSeconds === undefined || endSeconds === undefined) return null;
  if (startSeconds === null && endSeconds === null) return null;

  return { videoId, startSeconds, endSeconds };
}

/**
 * Coerces persisted data into a valid list. Malformed entries are dropped,
 * entries with both points unset are forgets and do not survive, and a
 * duplicated `videoId` keeps its last occurrence.
 */
export function sanitizeSaved(raw: unknown): SavedSongs {
  if (!Array.isArray(raw)) return [];
  const list: unknown[] = raw;
  const sanitized: SavedSongs = [];
  for (const item of list) {
    const entry = sanitizeEntry(item);
    if (entry === null) continue;
    const previous = sanitized.findIndex(
      (existing) => existing.videoId === entry.videoId,
    );
    if (previous !== -1) sanitized.splice(previous, 1);
    sanitized.push(entry);
  }
  return sanitized;
}

/** Returns the saved section for a song, or `null` when it has none. */
export function lookupSaved(
  saved: SavedSongs,
  videoId: string,
): SavedSection | null {
  for (let index = saved.length - 1; index >= 0; index -= 1) {
    if (saved[index].videoId === videoId) return saved[index];
  }
  return null;
}

/**
 * Replaces the song's entry or appends a new one. An entry with both points
 * unset is an explicit forget and removes the song's entry instead.
 */
export function upsertSaved(
  saved: SavedSongs,
  entry: SavedSection,
): SavedSongs {
  const remaining = saved.filter((item) => item.videoId !== entry.videoId);
  if (entry.startSeconds === null && entry.endSeconds === null) {
    return remaining;
  }
  return [...remaining, entry];
}
