export const OFFSET_STEP_MS = 250;
const MAX_OFFSET_MS = 15000;

const storageKey = (videoId: string) => `ytmd-karaoke-offset-${videoId}`;

/** Positive offsets show lyrics later, negative ones show them earlier. */
export const nudgeOffset = (offsetMs: number, deltaMs: number) =>
  Math.min(MAX_OFFSET_MS, Math.max(-MAX_OFFSET_MS, offsetMs + deltaMs));

export const formatOffset = (offsetMs: number) => {
  const seconds = (offsetMs / 1000).toFixed(2);
  return `${offsetMs > 0 ? '+' : ''}${seconds} s`;
};

// The same words are timed differently across uploads of a song, so the offset
// is remembered per video. Losing it only costs a re-adjustment.
export const loadOffset = (videoId: string) => {
  try {
    const value = Number(localStorage.getItem(storageKey(videoId)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};

/** The stored offset, or null when storage could not be read. */
export const readStoredOffset = (videoId: string) => {
  try {
    const value = Number(localStorage.getItem(storageKey(videoId)));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return null;
  }
};

/** Whether the offset was stored. */
export const saveOffset = (videoId: string, offsetMs: number) => {
  try {
    if (offsetMs === 0) localStorage.removeItem(storageKey(videoId));
    else localStorage.setItem(storageKey(videoId), String(offsetMs));
    return true;
  } catch {
    // Storage can be unavailable. The offset still applies until the song ends.
    return false;
  }
};
