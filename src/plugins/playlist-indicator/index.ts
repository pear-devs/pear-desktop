import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import {
  fetchLibraryPlaylists,
  fetchPlaylistVideoIds,
  type PlaylistRef,
} from './innertube';
import style from './style.css?inline';

const CACHE_KEY = 'ytmd-playlist-indicator-cache-v1';
const CACHE_TTL_MS = 30 * 60 * 1000;
const BADGE_CLASS = 'ytmd-playlist-indicator';
const POPUP_CLASS = 'ytmd-playlist-indicator-popup';
const ROW_SELECTOR = 'ytmusic-responsive-list-item-renderer';

type Index = Map<string, PlaylistRef[]>;

interface Cache {
  time: number;
  playlists: PlaylistRef[];
  tracks: Record<string, string[]>; // videoId -> playlist ids
}

const loadCache = (): Cache | undefined => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Cache) : undefined;
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

const buildCache = async (): Promise<Cache> => {
  const playlists = await fetchLibraryPlaylists();
  const tracks: Record<string, string[]> = {};

  const queue = [...playlists];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      try {
        for (const videoId of await fetchPlaylistVideoIds(p.id)) {
          (tracks[videoId] ??= []).push(p.id);
        }
      } catch (error) {
        console.warn('[playlist-indicator] failed for', p.title, error);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  return { time: Date.now(), playlists, tracks };
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

/** Playlist id of the page being viewed, if any (its tracks trivially belong to it). */
const getCurrentPlaylistId = () => {
  const list = new URLSearchParams(location.search).get('list');
  if (location.pathname === '/playlist' && list) return list;
  return location.pathname.match(/^\/browse\/VL(.+)$/)?.[1];
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
    scanTimer?: number;
    refreshing: boolean;
    refresh(force?: boolean): Promise<void>;
    scan(): void;
    decorate(row: HTMLElement): void;
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

      this.refresh().catch(() => {});
      this.refreshTimer = window.setInterval(() => {
        this.refresh().catch(() => {});
      }, CACHE_TTL_MS);
      this.scan();
    },

    stop() {
      this.observer?.disconnect();
      clearTimeout(this.scanTimer);
      this.scanTimer = undefined;
      clearInterval(this.refreshTimer);
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
      try {
        this.cache = await buildCache();
        saveCache(this.cache);
        this.index = indexFromCache(this.cache);
        clearDecorations();
        this.scan();
      } catch (error) {
        console.warn('[playlist-indicator] refresh failed', error);
      } finally {
        this.refreshing = false;
      }
    },

    scan() {
      for (const row of document.querySelectorAll<HTMLElement>(ROW_SELECTOR)) {
        this.decorate(row);
      }
    },

    decorate(row) {
      const videoId = getVideoId(row);
      // Rows are recycled by the browse page: re-check when the song changed
      if (row.dataset.ytmdPiId === (videoId ?? '')) return;
      row.dataset.ytmdPiId = videoId ?? '';
      row.querySelector(`.${BADGE_CLASS}`)?.remove();
      if (!videoId) return;

      const current = getCurrentPlaylistId();
      const playlists = (this.index.get(videoId) ?? []).filter(
        (p) => p.id !== current,
      );
      if (!playlists.length) return;

      const badge = document.createElement('button');
      badge.className = BADGE_CLASS;
      badge.title = t('plugins.playlist-indicator.tooltip', {
        count: playlists.length,
      });
      badge.innerHTML =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M3 10h11v2H3v-2zm0-4h11v2H3V6zm0 8h7v2H3v-2zm13-1v8l6-4-6-4z"/></svg>';
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.openPopup(badge, videoId);
      });

      const menu = row.querySelector('.menu');
      if (menu) menu.parentElement?.insertBefore(badge, menu);
      else row.appendChild(badge);
    },

    openPopup(anchor, videoId) {
      const wasSame = this.popup?.dataset.videoId === videoId;
      this.closePopup();
      if (wasSame) return;

      const current = getCurrentPlaylistId();
      const playlists = (this.index.get(videoId) ?? []).filter(
        (p) => p.id !== current,
      );

      const popup = document.createElement('div');
      popup.className = POPUP_CLASS;
      popup.dataset.videoId = videoId;

      const header = document.createElement('div');
      header.className = 'ytmd-pi-header';
      header.textContent = t('plugins.playlist-indicator.popup-title');
      popup.appendChild(header);

      for (const p of playlists) {
        const a = document.createElement('a');
        a.className = 'ytmd-pi-item';
        a.textContent = p.title;
        a.href = `/playlist?list=${encodeURIComponent(p.id)}`;
        popup.appendChild(a);
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

    closePopup() {
      this.popup?.remove();
      this.popup = undefined;
    },
  },
});
