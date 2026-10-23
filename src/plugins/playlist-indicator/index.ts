import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  fetchLibraryPlaylists,
  fetchPlaylistVideoIds,
  type PlaylistRef,
  setPlaylistMembership,
} from './innertube';
import style from './style.css?inline';

const CACHE_KEY = 'ytmd-playlist-indicator-cache-v1';
const CACHE_TTL_MS = 30 * 60 * 1000;
const RETRY_DELAY_MS = 2 * 60 * 1000;
const BADGE_CLASS = 'ytmd-playlist-indicator';
const POPUP_CLASS = 'ytmd-playlist-indicator-popup';
const ROW_SELECTOR = 'ytmusic-responsive-list-item-renderer';
const PLAYER_BAR_SELECTOR = 'ytmusic-player-bar';
const ICON_IN =
  '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="10" fill="#e53935"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_OUT =
  '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/></svg>';

type Index = Map<string, PlaylistRef[]>;

interface Cache {
  time: number;
  /** Some playlists failed to load: a retry is scheduled */
  partial?: boolean;
  playlists: PlaylistRef[];
  tracks: Record<string, string[]>; // videoId -> playlist ids
}

const loadCache = (): Cache | undefined => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return undefined;
    const c = JSON.parse(raw) as Partial<Cache> | null;
    return c &&
      typeof c.time === 'number' &&
      Array.isArray(c.playlists) &&
      c.tracks &&
      typeof c.tracks === 'object'
      ? (c as Cache)
      : undefined;
  } catch {
    return undefined;
  }
};

const saveCache = (cache: Cache) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota / storage errors
  }
};

const indexFromCache = (cache: Cache): Index => {
  const byId = new Map(cache.playlists.map((p) => [p.id, p]));
  const index: Index = new Map();
  for (const [videoId, ids] of Object.entries(cache.tracks)) {
    const refs = ids.map((id) => byId.get(id)).filter((p) => !!p);
    if (refs.length) index.set(videoId, refs);
  }
  return index;
};

const applyMembership = (
  cache: Cache,
  videoId: string,
  playlistId: string,
  member: boolean,
) => {
  const ids = new Set(cache.tracks[videoId] ?? []);
  if (member) ids.add(playlistId);
  else ids.delete(playlistId);
  if (ids.size) cache.tracks[videoId] = [...ids];
  else delete cache.tracks[videoId];
};

const buildCache = async (): Promise<Cache> => {
  const playlists = await fetchLibraryPlaylists();
  const tracks: Record<string, string[]> = {};

  const queue = [...playlists];
  let failures = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try {
        for (const videoId of await fetchPlaylistVideoIds(p.id)) {
          (tracks[videoId] ??= []).push(p.id);
        }
      } catch (error) {
        failures++;
        console.warn('[playlist-indicator] failed for', p.title, error);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  // Keep the previous cache rather than replacing it with nothing
  if (playlists.length && failures === playlists.length) {
    throw new Error('all playlist fetches failed');
  }
  // Partial result: back-date it so the next refresh retries soon
  const time =
    failures > 0 ? Date.now() - CACHE_TTL_MS + RETRY_DELAY_MS : Date.now();

  return { time, playlists, tracks, partial: failures > 0 };
};

const getVideoId = (row: HTMLElement): string | undefined => {
  const data = (
    row as unknown as { data?: { playlistItemData?: { videoId?: string } } }
  ).data;
  const fromData = data?.playlistItemData?.videoId;
  if (fromData) return fromData;
  const href = row
    .querySelector<HTMLAnchorElement>('a[href*="watch?v="]')
    ?.getAttribute('href');
  return href
    ? (new URL(href, location.origin).searchParams.get('v') ?? undefined)
    : undefined;
};

/** Video id of the song currently playing (player bar), if any. */
const getPlayingVideoId = (): string | undefined => {
  const player = document.querySelector<
    HTMLElement & { getVideoData?: () => { video_id?: string } | undefined }
  >('#movie_player');
  const fromPlayer = player?.getVideoData?.()?.video_id;
  if (fromPlayer) return fromPlayer;
  return new URLSearchParams(location.search).get('v') ?? undefined;
};

const clearDecorations = () => {
  for (const el of document.querySelectorAll(`.${BADGE_CLASS}`)) el.remove();
  for (const el of document.querySelectorAll('[data-ytmd-pi-id]')) {
    el.removeAttribute('data-ytmd-pi-id');
  }
};

export default createPlugin<
  unknown,
  unknown,
  {
    index: Index;
    cache?: Cache;
    observer?: MutationObserver;
    styleEl?: HTMLStyleElement;
    popup?: HTMLElement;
    refreshTimer?: number;
    retryTimer?: number;
    playerTimer?: number;
    scanTimer?: number;
    refreshing: boolean;
    dirty: boolean;
    epoch: number;
    pendingEdits: [videoId: string, playlistId: string, member: boolean][];
    refresh(force?: boolean): Promise<void>;
    armRetry(partial?: boolean): void;
    setMembership(videoId: string, playlistId: string, member: boolean): void;
    scan(): void;
    popupAnchor?: HTMLElement;
    decorate(row: HTMLElement, isPlayerBar?: boolean): void;
    openPopup(anchor: HTMLElement, videoId: string): void;
    closePopup(): void;
    onDocClick?: (e: MouseEvent) => void;
    start(): void;
    stop(): void;
  }
>({
  name: () => t('plugins.playlist-indicator.name'),
  description: () => t('plugins.playlist-indicator.description'),
  restartNeeded: false,
  addedVersion: '3.12.X',
  config: {
    enabled: false,
  },
  renderer: {
    index: new Map(),
    refreshing: false,
    dirty: false,
    epoch: 0,
    pendingEdits: [],

    start() {
      this.styleEl = document.createElement('style');
      this.styleEl.textContent = style;
      document.head.appendChild(this.styleEl);

      this.cache = loadCache();
      if (this.cache) this.index = indexFromCache(this.cache);

      const onDocClick = (e: MouseEvent) => {
        const target = e.target as Element | null;
        if (
          this.popup &&
          !target?.closest(`.${BADGE_CLASS}`) &&
          !target?.closest(`.${POPUP_CLASS}`)
        ) {
          this.closePopup();
        }
      };
      this.onDocClick = onDocClick;
      document.addEventListener('click', onDocClick, true);

      this.observer = new MutationObserver(() => {
        if (this.scanTimer) return;
        this.scanTimer = window.setTimeout(() => {
          this.scanTimer = undefined;
          this.scan();
        }, 200);
      });
      this.observer.observe(document.body, { childList: true, subtree: true });

      // The player's video data can lag behind DOM mutations on song change
      // (also catches rows whose data arrives without any DOM mutation)
      this.playerTimer = window.setInterval(() => this.scan(), 2000);

      // A partial cache loaded from storage would otherwise wait for the next interval
      this.armRetry(this.cache?.partial);
      this.refresh().catch(() => {});
      this.refreshTimer = window.setInterval(() => {
        this.refresh().catch(() => {});
      }, CACHE_TTL_MS);
      this.scan();
    },

    stop() {
      // Invalidate any in-flight refresh so it cannot touch state or re-arm a retry
      this.epoch++;
      this.refreshing = false;
      this.observer?.disconnect();
      clearTimeout(this.scanTimer);
      this.scanTimer = undefined;
      clearInterval(this.refreshTimer);
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      clearInterval(this.playerTimer);
      if (this.onDocClick) {
        document.removeEventListener('click', this.onDocClick, true);
      }
      this.closePopup();
      this.styleEl?.remove();
      clearDecorations();
    },

    async refresh(force = false) {
      if (this.refreshing) return;
      if (!force && this.cache && Date.now() - this.cache.time < CACHE_TTL_MS) {
        return;
      }
      this.refreshing = true;
      this.pendingEdits = [];
      const epoch = this.epoch;
      try {
        const cache = await buildCache();
        // The plugin was stopped (or restarted) meanwhile: drop this result
        if (epoch !== this.epoch) return;
        for (const edit of this.pendingEdits) applyMembership(cache, ...edit);
        this.cache = cache;
        saveCache(cache);
        this.index = indexFromCache(cache);
        clearDecorations();
        this.scan();
        this.armRetry(cache.partial);
      } catch (error) {
        console.warn('[playlist-indicator] refresh failed', error);
        // A failed retry of a partial cache must try again
        if (epoch === this.epoch) this.armRetry(this.cache?.partial);
      } finally {
        if (epoch === this.epoch) this.refreshing = false;
      }
    },

    armRetry(partial) {
      clearTimeout(this.retryTimer);
      this.retryTimer = partial
        ? window.setTimeout(() => {
            this.refresh(true).catch(() => {});
          }, RETRY_DELAY_MS)
        : undefined;
    },

    scan() {
      for (const row of document.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
        this.decorate(row);
      }
      const playerBar =
        document.querySelector<HTMLElement>(PLAYER_BAR_SELECTOR);
      if (playerBar) this.decorate(playerBar, true);
    },

    decorate(row, isPlayerBar = false) {
      const videoId = isPlayerBar ? getPlayingVideoId() : getVideoId(row);
      const existing = row.querySelector(`.${BADGE_CLASS}`);
      if (!videoId) {
        existing?.remove();
        delete row.dataset.ytmdPiId;
        return;
      }

      const count = this.index.get(videoId)?.length ?? 0;

      // Rows are recycled by the page: rebuild when the song or its state changed
      if (
        existing &&
        row.dataset.ytmdPiId === videoId &&
        (existing as HTMLElement).dataset.count === String(count)
      ) {
        return;
      }
      existing?.remove();
      row.dataset.ytmdPiId = videoId;

      const badge = document.createElement('button');
      badge.className = BADGE_CLASS;
      badge.dataset.count = String(count);
      badge.title = count
        ? t('plugins.playlist-indicator.tooltip', { count })
        : t('plugins.playlist-indicator.tooltip-none');
      badge.innerHTML = count ? ICON_IN : ICON_OUT;
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.openPopup(badge, videoId);
      });

      if (isPlayerBar) {
        (row.querySelector('.middle-controls-buttons') ?? row).appendChild(
          badge,
        );
        return;
      }
      const menu = row.querySelector('.menu');
      if (menu) menu.parentElement?.insertBefore(badge, menu);
      else row.appendChild(badge);
    },

    openPopup(anchor, videoId) {
      const wasSame =
        this.popup?.dataset.videoId === videoId && this.popupAnchor === anchor;
      this.closePopup();
      if (wasSame) return;
      this.popupAnchor = anchor;

      const memberOf = this.index.get(videoId) ?? [];
      // Every playlist, those containing the song first, so it can be added to others
      const memberIds = new Set(memberOf.map((m) => m.id));
      const playlists = [
        ...memberOf,
        ...(this.cache?.playlists ?? []).filter((p) => !memberIds.has(p.id)),
      ];

      const popup = document.createElement('div');
      popup.className = POPUP_CLASS;
      popup.dataset.videoId = videoId;

      const header = document.createElement('div');
      header.className = 'ytmd-pi-header';
      header.textContent = t('plugins.playlist-indicator.popup-title');
      popup.appendChild(header);

      for (const p of playlists) {
        const row = document.createElement('div');
        row.className = 'ytmd-pi-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ytmd-pi-check';
        checkbox.checked = memberOf.some((m) => m.id === p.id);
        checkbox.title = t('plugins.playlist-indicator.toggle-tooltip');
        checkbox.addEventListener('change', () => {
          const member = checkbox.checked;
          checkbox.disabled = true;
          row.classList.remove('ytmd-pi-error');
          setPlaylistMembership(p.id, videoId, member)
            .then(() => {
              this.setMembership(videoId, p.id, member);
              row.classList.toggle('ytmd-pi-removed', !member);
            })
            .catch((error) => {
              console.warn(
                '[playlist-indicator] edit failed for',
                p.title,
                error,
              );
              checkbox.checked = !member;
              row.classList.add('ytmd-pi-error');
              row.title = t('plugins.playlist-indicator.edit-failed');
            })
            .finally(() => {
              checkbox.disabled = false;
            });
        });
        row.appendChild(checkbox);

        const a = document.createElement('a');
        a.className = 'ytmd-pi-item';
        a.textContent = p.title;
        a.href = `/playlist?list=${encodeURIComponent(p.id)}`;
        row.appendChild(a);

        popup.appendChild(row);
      }

      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'ytmd-pi-refresh';
      refreshBtn.textContent = t('plugins.playlist-indicator.refresh');
      refreshBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePopup();
        this.refresh(true).catch(() => {});
      });
      popup.appendChild(refreshBtn);

      document.body.appendChild(popup);
      const rect = anchor.getBoundingClientRect();
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - popup.offsetWidth - 8),
      );
      const top =
        rect.bottom + popup.offsetHeight + 8 > window.innerHeight
          ? Math.max(8, rect.top - popup.offsetHeight - 4)
          : rect.bottom + 4;
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      this.popup = popup;
    },

    setMembership(videoId, playlistId, member) {
      // An in-flight refresh may have fetched stale data: replay the edit on it
      if (this.refreshing)
        this.pendingEdits.push([videoId, playlistId, member]);
      if (!this.cache) return;
      applyMembership(this.cache, videoId, playlistId, member);
      saveCache(this.cache);
      this.index = indexFromCache(this.cache);
      this.dirty = true;
    },

    closePopup() {
      this.popup?.remove();
      this.popup = undefined;
      if (this.dirty) {
        this.dirty = false;
        clearDecorations();
        this.scan();
      }
    },
  },
});
