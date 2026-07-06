import { ElementFromHtml } from '@/plugins/utils/renderer';

const BLOCK_ICON = `<svg class="style-scope yt-icon" preserveAspectRatio="xMidYMid meet" style="pointer-events: none; display: block; width: 100%; height: 100%;" viewBox="0 0 24 24"><path class="style-scope yt-icon" d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4C13.85,4 15.55,4.63 16.9,5.69L5.69,16.9C4.63,15.55 4,13.85 4,12A8,8 0 0,1 12,4M12,20C10.15,20 8.45,19.37 7.1,18.31L18.31,7.1C19.37,8.45 20,10.15 20,12A8,8 0 0,1 12,20Z" fill="#aaaaaa"></path></svg>`;

/**
 * Build a single "Block <artist>" row that matches YouTube Music's native
 * context-menu items. `label` is applied via textContent so artist names are
 * never interpreted as HTML.
 */
export const createBlockButton = (
  label: string,
  onClick: () => void,
): HTMLElement => {
  const element = ElementFromHtml(
    `<div class="blocklist-injected blocklist-menu-item style-scope menu-item ytmusic-menu-popup-renderer" role="option" tabindex="-1">` +
      `<a class="yt-simple-endpoint style-scope ytmusic-menu-navigation-item-renderer" tabindex="-1">` +
      `<div class="icon ytmd-menu-item style-scope ytmusic-menu-navigation-item-renderer">${BLOCK_ICON}</div>` +
      `<div class="text style-scope ytmusic-menu-navigation-item-renderer"></div>` +
      `</a>` +
      `</div>`,
  );

  const text = element.querySelector<HTMLElement>('.text');
  if (text) text.textContent = label;

  element.querySelector('a')?.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });

  return element;
};
