import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import style from './style.css?inline';

const magGlassSvg = `
<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" height="24" viewBox="0 0 24 24" width="24" focusable="false" style="pointer-events: none; display: block; width: 100%; height: 100%;">
  <path
    d="M16.296 16.996a8 8 0 11.707-.708l3.909 3.91-.707.707-3.909-3.909zM18 11a7 7 0 00-14 0 7 7 0 1014 0z"
    fill="currentColor"
    stroke="currentColor"
    stroke-width="0.5"
    fill-rule="evenodd"
    clip-rule="evenodd"
  />
</svg>`;

const templates = {
  'sidebarSearchWrapper': () => `
        <div id="ps4ytm-sidebar-wrapper" class="ps4ytm-wrapper">
            <span class="search-icon" aria-hidden="true">
                ${magGlassSvg}
            </span>
            <input type="text" class="ps4ytm-input" id="sidebar-playlist-search-input" placeholder="${t('plugins.playlist-search.templates.placeholder')}" title="${t('plugins.playlist-search.templates.title')}" autocomplete="off">
        </div>
    `,
  'sidebar-no-playlists-message': () => `
       <div id="sidebar-no-playlists-message">${t('plugins.playlist-search.templates.no-results')}</div>
    `,
  'dialogSearchWrapper': () => `
        <div id="ps4ytm-dialog-wrapper" class="ps4ytm-wrapper">
            <span class="search-icon" aria-hidden="true">
                ${magGlassSvg}
            </span>
            <input type="text" class="ps4ytm-input" id="playlist-search-input" placeholder="${t('plugins.playlist-search.templates.placeholder')}" title="${t('plugins.playlist-search.templates.title')}" autocomplete="off">
        </div>
    `,
  'dialog-no-playlists-message': () => `
        <div id="no-playlists-message">${t('plugins.playlist-search.templates.no-results')}</div>
    `,
};

/**
 * Parse an HTML template string into a DOM element.
 *
 * @param templateName - The key identifying the template generator to render.
 * @returns The parsed root HTMLElement.
 */
const loadTemplate = (templateName: keyof typeof templates): HTMLElement => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(
    templates[templateName]().trim(),
    'text/html',
  );
  return doc.body.firstElementChild as HTMLElement;
};

let isDialogVisible = false;
let sidebarObserver: MutationObserver | null = null;
let dialogObserver: MutationObserver | null = null;
let sidebarInitTimeout: ReturnType<typeof setTimeout> | null = null;
let boundFocusListener: ((e: KeyboardEvent) => void) | null = null;

/**
 * Locate YouTube Music's sidebar playlist container and inject the search input and empty-state elements.
 */
function initializeSidebarPlaylistFilter() {
  const playlistSection = document.querySelector(
    'ytmusic-guide-section-renderer:nth-of-type(2)',
  );

  if (
    !playlistSection ||
    playlistSection.querySelector('#sidebar-playlist-search-input')
  ) {
    return;
  }

  const playlistsContainer = playlistSection.querySelector('#items');
  const newPlaylistButton = playlistSection.querySelector('#buttons');
  let insertAfterElement: Element | null = null;

  if (newPlaylistButton) {
    insertAfterElement = newPlaylistButton;
  }

  if (!playlistsContainer) {
    return;
  }

  const wrapper = loadTemplate('sidebarSearchWrapper');
  const searchInput = wrapper.querySelector(
    '#sidebar-playlist-search-input',
  ) as HTMLInputElement;
  const noResultsMessage = loadTemplate('sidebar-no-playlists-message');

  if (insertAfterElement) {
    insertAfterElement.insertAdjacentElement('afterend', wrapper);
  } else {
    playlistsContainer.insertAdjacentElement('beforebegin', wrapper);
  }
  playlistsContainer.insertAdjacentElement('afterend', noResultsMessage);

  /**
   * Filter sidebar playlist items according to the query text.
   *
   * @param event - The input event from the sidebar search box.
   */
  const handleFilter = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const searchTerm = target.value.toLowerCase().trim();

    const playlistItems = playlistsContainer.querySelectorAll(
      'ytmusic-guide-entry-renderer',
    );
    let visibleCount = 0;

    playlistItems.forEach((item) => {
      const titleElement = item.querySelector('.title');

      if (titleElement) {
        const title = titleElement.textContent?.toLowerCase() || '';
        const isVisible = title.includes(searchTerm);
        (item as HTMLElement).style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
      }
    });

    if (searchTerm && visibleCount === 0) {
      noResultsMessage.style.display = 'block';
    } else {
      noResultsMessage.style.display = 'none';
    }
  };

  searchInput.addEventListener('input', handleFilter);
}

/**
 * Inject the search input and empty-state element into the 'Add to playlist' dialog.
 */
const initializePlaylistFilter = () => {
  const dialog = document.querySelector('ytmusic-add-to-playlist-renderer');
  if (!dialog || dialog.querySelector('#playlist-search-input')) {
    return;
  }

  const playlistsContainer = dialog.querySelector('#playlists');

  if (!playlistsContainer) {
    return;
  }

  const wrapper = loadTemplate('dialogSearchWrapper');
  const searchInput = wrapper.querySelector(
    '#playlist-search-input',
  ) as HTMLInputElement;
  const noResultsMessage = loadTemplate('dialog-no-playlists-message');

  playlistsContainer.insertAdjacentElement('beforebegin', wrapper);
  playlistsContainer.insertAdjacentElement('afterend', noResultsMessage);

  /**
   * Filter playlist options in the dialog according to the query text.
   *
   * @param event - The input event from the dialog search box.
   */
  const handleFilter = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const searchTerm = target.value.toLowerCase().trim();

    const playlistItems = playlistsContainer.querySelectorAll(
      'ytmusic-playlist-add-to-option-renderer',
    );
    let visibleCount = 0;

    playlistItems.forEach((item) => {
      const titleElem = item.querySelector('#title');
      if (titleElem) {
        const title = titleElem.getAttribute('title')?.toLowerCase() || '';
        const isVisible = title.includes(searchTerm);
        (item as HTMLElement).style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
      }
    });

    if (searchTerm && visibleCount === 0) {
      noResultsMessage.style.display = 'block';
    } else {
      noResultsMessage.style.display = 'none';
    }
  };

  searchInput.addEventListener('input', handleFilter);
  searchInput.focus();
};

/**
 * Monitor the visibility of the 'Add to playlist' dialog and dispatch lifecycle events.
 */
function checkDialogState() {
  const dialogElement = document.querySelector(
    'tp-yt-paper-dialog:has(ytmusic-add-to-playlist-renderer)',
  );
  const isNowVisible =
    dialogElement && (dialogElement as HTMLElement).style.display !== 'none';

  if (isNowVisible && !isDialogVisible) {
    isDialogVisible = true;
    window.dispatchEvent(new CustomEvent('playlistDialogDisplayed'));
  } else if (!isNowVisible && isDialogVisible) {
    isDialogVisible = false;
    window.dispatchEvent(new CustomEvent('playlistDialogHidden'));
  }
}

/**
 * Reset search input and show all playlist options when the dialog closes.
 */
const resetFilter = () => {
  const searchInput = document.getElementById(
    'playlist-search-input',
  ) as HTMLInputElement;
  if (searchInput) {
    searchInput.value = '';
  }
  const noResultsMessage = document.getElementById('no-playlists-message');
  if (noResultsMessage) {
    noResultsMessage.style.display = 'none';
  }
  const playlistsContainer = document.getElementById('playlists');
  if (playlistsContainer) {
    playlistsContainer.style.display = '';
  }

  const playlistItems = document.querySelectorAll(
    'ytmusic-playlist-add-to-option-renderer',
  );
  playlistItems.forEach((item) => {
    (item as HTMLElement).style.display = '';
  });
};

/**
 * Programmatically open the player action menu and click 'Save to playlist' or focus the dialog search if already open.
 */
function triggerSaveToPlaylist() {
  const dialogElement = document.querySelector(
    'tp-yt-paper-dialog:has(ytmusic-add-to-playlist-renderer)',
  );
  if (
    dialogElement &&
    (dialogElement as HTMLElement).style.display !== 'none'
  ) {
    const dialogSearchInput = document.getElementById(
      'playlist-search-input',
    ) as HTMLInputElement | null;
    dialogSearchInput?.focus();
    dialogSearchInput?.select();
    return;
  }

  const playerBar = document.querySelector('ytmusic-player-bar');
  if (!playerBar) return;

  const menuButton = playerBar.querySelector<HTMLElement>(
    'ytmusic-menu-renderer.ytmusic-player-bar #button, ytmusic-menu-renderer #button, .menu #button, ytmusic-menu-renderer tp-yt-paper-icon-button, ytmusic-menu-renderer yt-icon-button, ytmusic-menu-renderer button, [aria-label="Action menu"], [aria-label="More actions"]',
  );
  if (!menuButton) return;

  /**
   * Search menu items in the popup listbox for the 'Save to playlist' option and click it.
   *
   * @returns True if a matching option was found and clicked, false otherwise.
   */
  const clickPlaylistItem = (): boolean => {
    const listbox = document.querySelector<HTMLElement>(
      'ytmusic-menu-popup-renderer tp-yt-paper-listbox',
    );
    if (!listbox) return false;

    const items = listbox.querySelectorAll<HTMLElement>(
      'ytmusic-menu-service-item-renderer, ytmusic-menu-navigation-item-renderer, tp-yt-paper-item',
    );

    for (const item of items) {
      const data =
        (item as unknown as { data?: Record<string, unknown> }).data ||
        (
          item.querySelector('#navigation-endpoint') as unknown as {
            data?: Record<string, unknown>;
          }
        )?.data ||
        (
          item.querySelector('#service-endpoint') as unknown as {
            data?: Record<string, unknown>;
          }
        )?.data;

      const iconType = (data?.icon as { iconType?: string } | undefined)
        ?.iconType;
      const isAddToPlaylistData =
        Boolean(data?.addToPlaylistEndpoint) ||
        Boolean(
          (
            data?.serviceEndpoint as
              | { addToPlaylistEndpoint?: unknown }
              | undefined
          )?.addToPlaylistEndpoint,
        ) ||
        Boolean(
          (
            data?.defaultServiceEndpoint as
              | { addToPlaylistEndpoint?: unknown }
              | undefined
          )?.addToPlaylistEndpoint,
        ) ||
        iconType === 'ADD_TO_PLAYLIST' ||
        iconType === 'PLAYLIST_ADD';

      const hasPlaylistIcon =
        item.querySelector(
          'yt-icon[icon*="playlist"], iron-icon[icon*="playlist"]',
        ) !== null ||
        item.querySelector('path[d*="M14 10H2"]') !== null ||
        item.querySelector('path[d*="M2 16h8"]') !== null;

      const text = (item.textContent || '').trim().toLowerCase();
      const isAddToPlaylistText =
        text.includes('playlist') ||
        text.includes('speichern') ||
        text.includes('enregistrer') ||
        text.includes('guardar');

      if (isAddToPlaylistData || hasPlaylistIcon || isAddToPlaylistText) {
        item.click();
        return true;
      }
    }
    return false;
  };

  document.body.classList.add('ps4ytm-opening-save-to-playlist');

  /**
   * Remove the visual indicator class when menu interaction concludes.
   */
  const cleanup = () => {
    document.body.classList.remove('ps4ytm-opening-save-to-playlist');
  };

  let observer: MutationObserver | null = null;
  const timeoutId = setTimeout(() => {
    observer?.disconnect();
    cleanup();
  }, 1000);

  observer = new MutationObserver(() => {
    if (clickPlaylistItem()) {
      clearTimeout(timeoutId);
      observer?.disconnect();
      cleanup();
    }
  });

  const popupContainer =
    document.querySelector('ytmusic-popup-container') || document.body;
  observer.observe(popupContainer, {
    childList: true,
    subtree: true,
  });

  menuButton.click();
  if (clickPlaylistItem()) {
    clearTimeout(timeoutId);
    observer.disconnect();
    cleanup();
  }
}

export default createPlugin({
  name: () => t('plugins.playlist-search.name'),
  description: () => t('plugins.playlist-search.description'),
  restartNeeded: false,
  config: {
    enabled: false,
  },
  stylesheets: [style],
  renderer: {
    start() {
      sidebarInitTimeout = setTimeout(initializeSidebarPlaylistFilter, 1000);

      sidebarObserver = new MutationObserver(() => {
        initializeSidebarPlaylistFilter();
      });

      sidebarObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });

      window.addEventListener(
        'playlistDialogDisplayed',
        initializePlaylistFilter,
      );
      window.addEventListener('playlistDialogHidden', resetFilter);

      dialogObserver = new MutationObserver(() => {
        checkDialogState();
      });
      // A better approach is to observe ytmusic-popup-container if it exists.
      const popupContainer =
        document.querySelector('ytmusic-popup-container') || document.body;
      dialogObserver.observe(popupContainer, {
        childList: true,
        subtree: true,
        attributeFilter: ['style'],
      });

      boundFocusListener = (e: KeyboardEvent) => {
        const isModifier = e.metaKey || e.ctrlKey;
        const key = e.key.toLowerCase();

        if (isModifier && key === 'f') {
          const dialogSearchInput = document.getElementById(
            'playlist-search-input',
          ) as HTMLInputElement;
          const sidebarSearchInput = document.getElementById(
            'sidebar-playlist-search-input',
          ) as HTMLInputElement;

          if (
            isDialogVisible &&
            dialogSearchInput &&
            document.activeElement !== dialogSearchInput
          ) {
            e.preventDefault();
            dialogSearchInput.focus();
            dialogSearchInput.select();
          } else if (
            !isDialogVisible &&
            sidebarSearchInput &&
            document.activeElement !== sidebarSearchInput
          ) {
            e.preventDefault();
            sidebarSearchInput.focus();
            sidebarSearchInput.select();
          }
        } else if (isModifier && key === 'l') {
          e.preventDefault();
          triggerSaveToPlaylist();
        }
      };
      document.addEventListener('keydown', boundFocusListener);
    },
    stop() {
      if (sidebarInitTimeout) {
        clearTimeout(sidebarInitTimeout);
        sidebarInitTimeout = null;
      }

      if (sidebarObserver) sidebarObserver.disconnect();
      if (dialogObserver) dialogObserver.disconnect();

      window.removeEventListener(
        'playlistDialogDisplayed',
        initializePlaylistFilter,
      );
      window.removeEventListener('playlistDialogHidden', resetFilter);
      if (boundFocusListener) {
        document.removeEventListener('keydown', boundFocusListener);
      }

      document.body.classList.remove('ps4ytm-opening-save-to-playlist');
      document.getElementById('ps4ytm-sidebar-wrapper')?.remove();
      document.getElementById('sidebar-no-playlists-message')?.remove();
      document.getElementById('ps4ytm-dialog-wrapper')?.remove();
      document.getElementById('no-playlists-message')?.remove();

      const sidebarItems = document.querySelectorAll(
        'ytmusic-guide-entry-renderer',
      );
      sidebarItems.forEach((item) => {
        (item as HTMLElement).style.display = '';
      });

      const dialogItems = document.querySelectorAll(
        'ytmusic-playlist-add-to-option-renderer',
      );
      dialogItems.forEach((item) => {
        (item as HTMLElement).style.display = '';
      });
    },
  },
});
