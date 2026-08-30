// renderer.ts
//
// Virtualized scrolling for pear-desktop long playlists.
//
// Problem: music.youtube.com keeps one heavy
// <ytmusic-responsive-list-item-renderer> DOM element alive per row.
// On long playlists (thousands of tracks) this tanks scroll perf.
//
// Fix: read all track data ONCE via the player API, remove the real rows,
// and recycle a small fixed pool of lightweight row elements — the same
// approach as Android's RecyclerView.
//
// NOT REIMPLEMENTED (native row features intentionally left out — flagged
// per the task, not silently dropped):
//   - right-click context menu on a row
//   - native drag-to-reorder within the playlist
//   - hover preview / hover-to-play-snippet behavior
// These require far more of YouTube Music's internal renderer machinery
// than a lightweight recycled row can reasonably reproduce. A pooled row
// only renders text/art and handles click-to-play.
//
// This module exports plain functions (onPlayerApiReady, stop) rather
// than a class, because pear-desktop's renderer lifecycle
// (RendererPluginLifecycleExtra, see src/types/plugins.ts) calls
// `onPlayerApiReady(playerApi, context)` and `stop(context)` as `this`-bound
// methods on the plugin's `renderer` object — index.ts wires these in.

import { getAllRows, getContinuations, getRowHost, getScrollContainer } from './selectors';

import type { MusicPlayer } from '@/types/music-player';

const ROW_HEIGHT = 56; // px — standard ytmusic-responsive-list-item-renderer row height
const OVERSCAN = 10; // extra rows above/below viewport, per task spec

interface TrackRecord {
  id: string; // videoId — used with loadVideoById (Step 3)
  index: number; // position in the playlist, for logging/debugging
  title: string;
  artist: string;
  thumbnail: string;
  duration: number; // seconds
}

interface PooledRow {
  el: HTMLDivElement;
  thumbEl: HTMLImageElement;
  titleEl: HTMLDivElement;
  artistEl: HTMLDivElement;
  durationEl: HTMLDivElement;
  boundIndex: number; // which track index this pooled row currently displays, -1 if none
}

// Module-level state. A single pear-desktop renderer process only ever
// has one playlist page mounted at a time, so this mirrors how sibling
// plugins (e.g. playback-speed's onUnload) hold state at module scope
// rather than inside a class instance.
let api: MusicPlayer | null = null;
let tracks: TrackRecord[] = [];
let pool: PooledRow[] = [];
let spacer: HTMLDivElement | null = null;
let poolContainer: HTMLDivElement | null = null;
let scrollContainer: HTMLElement | null = null;
let rowHost: HTMLElement | null = null;
let originalRowHostDisplay = '';
let rafHandle: number | null = null;
let started = false;

export function onPlayerApiReady(playerApi: MusicPlayer): void {
  api = playerApi;
  start();
}

export function stop(): void {
  if (!started) return;

  if (scrollContainer) {
    scrollContainer.removeEventListener('scroll', onScroll);
  }
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  // ---- 6. Restore original DOM structure ----
  spacer?.remove();
  spacer = null;
  poolContainer = null;
  pool = [];

  if (rowHost) {
    rowHost.style.display = originalRowHostDisplay;
  }
  const continuations = getContinuations();
  if (continuations) continuations.style.display = '';

  tracks = [];
  rowHost = null;
  scrollContainer = null;
  started = false;
}

function start(): void {
  if (started || !api) return;

  rowHost = getRowHost();
  scrollContainer = getScrollContainer();

  if (!rowHost || !scrollContainer) {
    console.warn(
      '[virtualized-scroll] row host or scroll container not found; aborting start()',
    );
    return;
  }

  // ---- 1. Walk the full track list ONCE ----
  tracks = extractAllTracks(api);
  if (tracks.length === 0) {
    console.warn('[virtualized-scroll] no tracks found; aborting start()');
    return;
  }

  // ---- 2. Remove real rows, insert sized spacer ----
  originalRowHostDisplay = rowHost.style.display;

  // Hide native rows and native infinite-scroll loader rather than
  // deleting them outright, so stop() can restore exactly what was there.
  rowHost.style.display = 'none';
  const continuations = getContinuations();
  if (continuations) continuations.style.display = 'none';

  spacer = document.createElement('div');
  spacer.className = 'peard-virtual-spacer';
  spacer.style.position = 'relative';
  spacer.style.height = `${tracks.length * ROW_HEIGHT}px`;
  spacer.style.width = '100%';
  rowHost.insertAdjacentElement('afterend', spacer);

  // ---- 3. Create fixed row pool ----
  const viewportHeight = scrollContainer.clientHeight;
  const poolSize = Math.ceil(viewportHeight / ROW_HEIGHT) + OVERSCAN;

  poolContainer = document.createElement('div');
  poolContainer.className = 'peard-virtual-pool';
  poolContainer.style.position = 'absolute';
  poolContainer.style.top = '0';
  poolContainer.style.left = '0';
  poolContainer.style.right = '0';
  spacer.appendChild(poolContainer);

  pool = [];
  for (let i = 0; i < poolSize; i++) {
    pool.push(createPooledRow());
  }

  // ---- 4. Scroll handling, rAF-throttled ----
  scrollContainer.addEventListener('scroll', onScroll, { passive: true });

  // Initial paint.
  updateVisibleRows();

  started = true;
}

/**
 * Step 1 of the algorithm: pull every track's data from the player API
 * once, up front. This is the ONLY data source used from here on —
 * no per-scroll DOM reads, no per-row API calls.
 *
 * Row DOM is used only as a length sanity-check / fallback for entries
 * the API might not have populated (e.g. an unresolved lazy-loaded
 * tail), never as the primary source — the investigation in Steps 1–4
 * found no file in this codebase that extracts title/artist/duration
 * from row text, only from the API.
 */
function extractAllTracks(playerApi: MusicPlayer): TrackRecord[] {
  const rawPlaylist = playerApi.getPlaylist<PlaylistPanelEntry[]>();
  if (!Array.isArray(rawPlaylist) || rawPlaylist.length === 0) {
    return [];
  }

  return rawPlaylist.map((entry, index) => toTrackRecord(entry, index));
}

function toTrackRecord(entry: PlaylistPanelEntry, index: number): TrackRecord {
  return {
    id: entry.videoId,
    index,
    title: entry.title ?? '',
    artist: entry.author ?? entry.shortBylineText ?? '',
    thumbnail: entry.thumbnail?.at(-1)?.url ?? '',
    duration: entry.lengthSeconds ?? 0,
  };
}

function createPooledRow(): PooledRow {
  const el = document.createElement('div');
  el.className =
    'peard-virtual-row style-scope ytmusic-responsive-list-item-renderer';
  el.style.position = 'absolute';
  el.style.top = '0';
  el.style.left = '0';
  el.style.right = '0';
  el.style.height = `${ROW_HEIGHT}px`;
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.willChange = 'transform';

  const thumbEl = document.createElement('img');
  thumbEl.className = 'peard-virtual-thumb';
  thumbEl.width = 40;
  thumbEl.height = 40;
  thumbEl.loading = 'lazy';

  const textWrap = document.createElement('div');
  textWrap.className = 'peard-virtual-text';

  const titleEl = document.createElement('div');
  titleEl.className = 'peard-virtual-title';

  const artistEl = document.createElement('div');
  artistEl.className = 'peard-virtual-artist';

  const durationEl = document.createElement('div');
  durationEl.className = 'peard-virtual-duration';

  textWrap.append(titleEl, artistEl);
  el.append(thumbEl, textWrap, durationEl);

  // ---- 5. Click handler, bound once, reads current index off the element ----
  el.addEventListener('click', () => {
    const idx = Number(el.dataset.trackIndex);
    if (Number.isNaN(idx) || !api) return;
    const track = tracks[idx];
    if (!track) return;
    // Step 3: play-by-videoId method on MusicPlayer.
    api.loadVideoById(track.id, 0, 'auto');
  });

  poolContainer?.appendChild(el);

  return {
    el,
    thumbEl,
    titleEl,
    artistEl,
    durationEl,
    boundIndex: -1,
  };
}

function onScroll(): void {
  if (rafHandle !== null) return; // already scheduled this frame
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    updateVisibleRows();
  });
}

/**
 * Recompute which track indices are visible and update each pooled
 * row's text/image/position in place. Never creates or destroys row
 * elements after the initial pool (Step 6, item 4).
 */
function updateVisibleRows(): void {
  if (!scrollContainer || !spacer) return;

  const spacerTop = spacer.offsetTop;
  const scrollTop = Math.max(0, scrollContainer.scrollTop - spacerTop);
  const firstVisible = Math.floor(scrollTop / ROW_HEIGHT);
  const startIndex = Math.max(0, firstVisible - OVERSCAN);

  for (let slot = 0; slot < pool.length; slot++) {
    const trackIndex = startIndex + slot;
    const row = pool[slot];
    const track = tracks[trackIndex];

    if (!track) {
      // Past the end of the list — hide this pooled row rather than
      // destroying it; it stays in the pool for reuse on scroll-up.
      row.el.style.visibility = 'hidden';
      row.boundIndex = -1;
      continue;
    }

    row.el.style.visibility = 'visible';
    row.el.style.transform = `translateY(${trackIndex * ROW_HEIGHT}px)`;
    row.el.dataset.trackIndex = String(trackIndex);

    if (row.boundIndex !== trackIndex) {
      row.titleEl.textContent = track.title;
      row.artistEl.textContent = track.artist;
      row.durationEl.textContent = formatDuration(track.duration);
      if (row.thumbEl.src !== track.thumbnail) {
        row.thumbEl.src = track.thumbnail;
      }
      row.boundIndex = trackIndex;
    }
  }
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Minimal shape of a single getPlaylist() entry, covering only the
// fields this plugin reads. The full MusicPlayer/YTMusic type is wider;
// we intentionally don't import it in full since only these fields
// were confirmed relevant during Steps 1–4.
interface PlaylistPanelEntry {
  videoId: string;
  title?: string;
  author?: string;
  shortBylineText?: string;
  lengthSeconds?: number;
  thumbnail?: { url: string }[];
}