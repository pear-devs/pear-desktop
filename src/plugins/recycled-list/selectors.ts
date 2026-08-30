// selectors.ts
//
// Every DOM selector this plugin depends on, in one place, sourced from
// the pear-desktop codebase investigation (Steps 1–4):
//   - ytmusic-app-layout   : confirmed scroll container
//                            (src/plugins/in-app-menu/titlebar.css:
//                             "overflow: auto scroll" +
//                             "fixes laggy list scrolling in large playlists")
//   - ytmusic-playlist-shelf-renderer : the long-playlist row host
//                            (src/plugins/album-actions/index.tsx)
//   - ytmusic-responsive-list-item-renderer : individual row tag
//                            (src/plugins/in-app-menu/titlebar.css)
//   - #continuations       : YouTube Music's own infinite-scroll loader,
//                            which we must hide while our spacer is active
//
// No other file in this plugin should hardcode a selector string.

export const SELECTORS = {
  /** The element that actually scrolls (overflow: auto scroll). */
  scrollContainer: 'ytmusic-app-layout',

  /** Host of the long-playlist row list on a playlist/album page. */
  rowHost: 'ytmusic-playlist-shelf-renderer',

  /** Fallback host, used when rowHost isn't present (per album-actions/index.tsx). */
  rowHostFallback: ':nth-last-child(1 of ytmusic-shelf-renderer)',

  /** Individual row element tag inside the row host. */
  row: 'ytmusic-responsive-list-item-renderer',

  /** YouTube Music's native infinite-scroll continuation trigger/loader. */
  continuations: '#continuations',
} as const;

export function getRowHost(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(SELECTORS.rowHost) ??
    document.querySelector<HTMLElement>(SELECTORS.rowHostFallback)
  );
}

export function getScrollContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.scrollContainer);
}

export function getAllRows(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>(SELECTORS.row));
}

export function getContinuations(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SELECTORS.continuations);
}