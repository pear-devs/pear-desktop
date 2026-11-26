/*
 * Outro detection from a loudness scan of the end of a song.
 *
 * The hidden player plays the current song's last TAIL_SECONDS (muted, sped
 * up) plus a stretch of its middle as a loudness reference. From that:
 *
 *  - musicEnd: the last moment louder than MUSIC_END_DB relative to the
 *    middle — the real end of the music, ignoring silent tails;
 *  - outroStart: walking back from musicEnd, the start of the continuous
 *    stretch quieter than OUTRO_DB — where a fade-out or stripped-back
 *    outro begins. If the song ends at full energy, outroStart = musicEnd.
 *
 * Section changes almost always fall on phrase boundaries, so starting a mix
 * at outroStart (snapped to a bar) mixes out on a phrase, like a DJ would.
 */

export type TailScan = {
  ok: boolean;
  length: number;
  body: number[]; // RMS samples from the middle of the song
  tail: [number, number][]; // [song time, RMS]
};

export type Outro = {
  outroStart: number;
  musicEnd: number;
  /** Loudness of the outro relative to the middle, dB (for logging). */
  outroDb: number;
  /** Smoothed level over the scanned tail, dB vs the middle (for logging). */
  profile: { t: number; db: number }[];
};

const OUTRO_DB = -5;
const MUSIC_END_DB = -30;
const SMOOTH_SECONDS = 1; // ± window

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export const findOutro = (scan: TailScan): Outro | null => {
  const body = scan.body.filter((x) => x > 1e-4);
  if (body.length < 5 || scan.tail.length < 20) return null;
  const reference = median(body);

  const points = [...scan.tail].sort((a, b) => a[0] - b[0]);
  // Smoothed level (RMS over ±1 s of song time), in dB relative to the middle.
  const level = points.map(([t]) => {
    let sum = 0;
    let count = 0;
    for (const [u, r] of points) {
      if (Math.abs(u - t) <= SMOOTH_SECONDS) {
        sum += r * r;
        count++;
      }
    }
    const rms = Math.sqrt(sum / Math.max(1, count));
    return { t, db: 20 * Math.log10(Math.max(rms, 1e-6) / reference) };
  });

  let endIndex = -1;
  for (let i = level.length - 1; i >= 0; i--) {
    if (level[i].db > MUSIC_END_DB) {
      endIndex = i;
      break;
    }
  }
  if (endIndex < 0) return null;
  const musicEnd = Math.min(scan.length, level[endIndex].t + 0.3);

  let startIndex = endIndex;
  // Only a quiet ending is an outro: a loud final hit must not be mixed over.
  if (level[endIndex].db < OUTRO_DB) {
    while (startIndex > 0 && level[startIndex - 1].db < OUTRO_DB) startIndex--;
  }
  // No quiet stretch (song ends at full energy): the outro is the end.
  const outroStart = startIndex === endIndex ? musicEnd : level[startIndex].t;

  let dbSum = 0;
  for (let i = startIndex; i <= endIndex; i++) dbSum += level[i].db;
  const outroDb = dbSum / (endIndex - startIndex + 1);

  return { outroStart, musicEnd, outroDb, profile: level };
};
