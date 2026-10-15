/**
 * Reorders the upcoming songs so each one leads well into the next: the
 * end of one song against the start of the next, the way AutoMix judges a
 * transition (tempo within reach of a time-stretch, a steady beat at both
 * ends, keys that don't clash).
 */
import { keysClash, type MusicalKey } from './key';
import { DJ_TEMPO_CONFIDENCE, tempoRatio } from './planner';
import { moveQueueItem, readUpcoming } from './queue';

import type { TempoSection, TrackAnalysis } from './analysis';

/** What reordering needs from one end of a song */
export interface EdgeSummary {
  bpm: number;
  confidence: number;
  hasBeats: boolean;
  key: MusicalKey | null;
}

/** A few numbers per song, instead of keeping its whole analysis */
export interface TrackSummary {
  start: EdgeSummary;
  end: EdgeSummary;
}

const edge = (section: TempoSection): EdgeSummary => ({
  bpm: section.bpm,
  confidence: section.tempoConfidence,
  hasBeats: section.downbeats.length > 0,
  key: section.key,
});

export const summarize = (analysis: TrackAnalysis): TrackSummary => ({
  start: edge(analysis.start),
  end: edge(analysis.end),
});

const steady = (side: EdgeSummary) =>
  side.hasBeats && side.confidence >= DJ_TEMPO_CONFIDENCE;

/**
 * Cost of going from one song into the next: below 1 when they can be
 * beat-matched (lower for less stretch), 1 or more otherwise
 */
export const transitionCost = (
  from: TrackSummary | null,
  to: TrackSummary | null,
  maxStretch: number,
) => {
  // Unknown songs are neither better nor worse anywhere
  if (!from || !to) return 1;
  const clash = keysClash(from.end.key, to.start.key) ? 0.4 : 0;
  const stretch = Math.abs(tempoRatio(from.end.bpm, to.start.bpm) - 1);
  if (steady(from.end) && steady(to.start) && stretch <= maxStretch) {
    return ((stretch / maxStretch) * 0.5) + clash;
  }
  return 1 + clash;
};

/** How a run of songs will mix, transition by transition */
export interface OrderStats {
  transitions: number;
  /** Can be beat-matched (steady beat both sides, tempo within reach) */
  matched: number;
  /** Keys that clash (AutoMix keeps those overlaps short) */
  clashes: number;
}

export const orderStats = (
  current: TrackSummary | null,
  sequence: (TrackSummary | null)[],
  maxStretch: number,
): OrderStats => {
  const stats = { transitions: sequence.length, matched: 0, clashes: 0 };
  let previous = current;
  for (const next of sequence) {
    if (previous && next) {
      if (transitionCost(previous, next, maxStretch) < 1) stats.matched++;
      if (keysClash(previous.end.key, next.start.key)) stats.clashes++;
    }
    previous = next;
  }
  return stats;
};

export interface OrderItem {
  summary: TrackSummary | null;
  /** Consecutive songs from one album stay together when this is set */
  albumId?: string;
}

/**
 * Best order (as indices into `items`) to play `items` in after `current`.
 * A greedy chain, then songs (or album runs) moved wherever that lowers
 * the total cost, until nothing improves.
 */
export const planOrder = (
  current: TrackSummary | null,
  items: OrderItem[],
  { maxStretch, keepAlbums }: { maxStretch: number; keepAlbums: boolean },
): number[] => {
  // Album runs move as one block
  const blocks: number[][] = [];
  items.forEach((item, i) => {
    const previous = blocks.at(-1);
    if (
      keepAlbums &&
      previous &&
      item.albumId &&
      items[previous.at(-1)!].albumId === item.albumId
    ) {
      previous.push(i);
    } else {
      blocks.push([i]);
    }
  });
  const startOf = (block: number[]) => items[block[0]].summary;
  const endOf = (block: number[]) => items[block.at(-1)!].summary;
  const cost = (from: TrackSummary | null, block: number[]) =>
    transitionCost(from, startOf(block), maxStretch);
  const total = (order: number[][]) =>
    order.reduce(
      (sum, block, i) =>
        sum + cost(i === 0 ? current : endOf(order[i - 1]), block),
      0,
    );

  // Greedy: always the best next block (ties keep the queue's order)
  const remaining = [...blocks];
  let order: number[][] = [];
  let last = current;
  while (remaining.length > 0) {
    let best = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (cost(last, remaining[i]) < cost(last, remaining[best]) - 1e-9) {
        best = i;
      }
    }
    const [block] = remaining.splice(best, 1);
    order.push(block);
    last = endOf(block);
  }

  // Move single blocks to better places until that stops helping
  let score = total(order);
  for (let pass = 0; pass < 50; pass++) {
    let improved = false;
    for (let from = 0; from < order.length; from++) {
      for (let to = 0; to < order.length; to++) {
        if (to === from) continue;
        const next = [...order];
        const [block] = next.splice(from, 1);
        next.splice(to, 0, block);
        const nextScore = total(next);
        if (nextScore < score - 1e-9) {
          order = next;
          score = nextScore;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return order.flat();
};

/** Where song summaries are kept between sessions, and how many */
const STORE_KEY = 'automix-summaries-v1';
const STORE_MAX = 1000;

/** Song summaries saved by earlier sessions, oldest first */
export const loadSummaries = () => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return new Map<string, TrackSummary>(
      raw ? (JSON.parse(raw) as [string, TrackSummary][]) : [],
    );
  } catch {
    return new Map<string, TrackSummary>();
  }
};

/** Keeps the most recently used summaries for the next session */
export const saveSummaries = (summaries: Map<string, TrackSummary>) => {
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify([...summaries].slice(-STORE_MAX)),
    );
  } catch {
    // Storage full or unavailable: they'll be measured again next time
  }
};

/** Most upcoming songs looked at (each one is downloaded and analysed) */
export const REORDER_LIMIT = 20;

/**
 * Puts the songs right after the playing one into `wanted` order, if they
 * are still exactly `expected` (the queue may have changed meanwhile).
 * Returns false if it changed.
 */
const applyOrder = (
  playingId: string | null,
  expected: string[],
  wanted: string[],
) => {
  const read = () =>
    readUpcoming(playingId, expected.length)?.upcoming ?? [];
  const now = read();
  if (
    now.length !== expected.length ||
    now.some((entry, i) => entry.track.videoId !== expected[i])
  ) {
    return false;
  }
  const base = now[0].index;
  for (let k = 0; k < wanted.length; k++) {
    const entries = read();
    const from = entries.findIndex(
      (entry, i) => i >= k && entry.track.videoId === wanted[k],
    );
    if (from > k) moveQueueItem(entries[from].index, base + k);
  }
  return true;
};

export interface ReorderResult {
  /** Songs that changed place */
  moved: number;
  /** How the upcoming songs mixed before, and how they mix now */
  before: OrderStats;
  after: OrderStats;
  /** Puts the queue back the way it was, if it hasn't changed since */
  undo: () => boolean;
}

/** Analyses the upcoming songs and reorders them for the best transitions */
export const reorderQueue = async ({
  playingId,
  summaryOf,
  maxStretch,
  keepAlbums,
  onProgress,
}: {
  playingId: string | null;
  summaryOf: (videoId: string) => Promise<TrackSummary | null>;
  maxStretch: number;
  keepAlbums: boolean;
  onProgress: (done: number, total: number) => void;
}): Promise<ReorderResult | null> => {
  const snapshot = readUpcoming(playingId, REORDER_LIMIT);
  if (!snapshot || snapshot.upcoming.length < 2) return null;
  const before = snapshot.upcoming.map((entry) => entry.track.videoId);
  const total = before.length + 1;

  onProgress(0, total);
  const current = await summaryOf(snapshot.current.videoId);
  onProgress(1, total);
  const summaries: (TrackSummary | null)[] = [];
  for (const id of before) {
    summaries.push(await summaryOf(id));
    onProgress(summaries.length + 1, total);
  }

  const order = planOrder(
    current,
    snapshot.upcoming.map((entry, i) => ({
      summary: summaries[i],
      albumId: entry.track.albumId,
    })),
    { maxStretch, keepAlbums },
  );
  const wanted = order.map((i) => before[i]);
  if (!applyOrder(playingId, before, wanted)) return null;

  return {
    moved: wanted.filter((id, i) => id !== before[i]).length,
    before: orderStats(current, summaries, maxStretch),
    after: orderStats(
      current,
      order.map((i) => summaries[i]),
      maxStretch,
    ),
    undo: () => applyOrder(playingId, wanted, before),
  };
};
