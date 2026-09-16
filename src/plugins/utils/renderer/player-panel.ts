import { t } from '@/i18n';

import style from './player-panel.css?inline';

export interface PlayerPanelSection {
  id: string;
  title: string;
  root: HTMLElement;
  onDestroy?: () => void;
}

const STYLE_ID = 'peard-player-panel-style';

/**
 * The player bar is not in the DOM at app open, so poll for it until it
 * appears. A bounded retry would leave the cog unplaced - the plugin's only UI
 * entry point unreachable for the session - if the bar mounted after the cap,
 * which is worse than the cost avoided: this is a 2 Hz querySelector that only
 * exists while the bar is missing, far cheaper than the document-wide subtree
 * observer it replaced, and it stops on the tick that finds the bar (1-2 ticks
 * in the normal case, then zero idle work).
 */
const OBSERVER_RETRY_MS = 500;

/** Ordered by registration; the first section is rendered on top. */
const sections = new Map<string, PlayerPanelSection>();

let cog: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let observer: MutationObserver | null = null;
let observerTarget: Element | null = null;
let observerRetry: ReturnType<typeof setInterval> | null = null;
let outsideHandler: ((event: MouseEvent) => void) | null = null;
let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

function cogLabel(): string {
  return t('common.player-panel.cog-label');
}

function createCogButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pbg-cog';
  button.title = cogLabel();
  button.setAttribute('aria-label', cogLabel());
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.5-0.41h-3.8 c-0.27,0-0.47,0.17-0.5,0.41L9.24,5.35C8.65,5.59,8.12,5.91,7.62,6.29L5.23,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.72,8.87 c-0.11,0.21-0.06,0.48,0.12,0.61l2.03,1.58C4.82,11.36,4.8,11.68,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61 l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.5,0.41h3.8 c0.27,0,0.47-0.17,0.5-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32 c0.11-0.21,0.06-0.48-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6 S13.98,15.6,12,15.6z"/></svg>';
  button.addEventListener('click', (event: MouseEvent) => {
    event.stopPropagation();
    togglePanel();
  });
  return button;
}

function findCogAnchor(): { parent: Node; before: Node | null } | null {
  const slider = document.querySelector('#volume-slider');
  if (slider?.parentNode) {
    return { parent: slider.parentNode, before: slider.nextSibling };
  }
  const volumeButton = document.querySelector('tp-yt-paper-icon-button.volume');
  if (volumeButton?.parentNode) {
    return {
      parent: volumeButton.parentNode,
      before: volumeButton.nextSibling,
    };
  }
  const volumeContainer = document.querySelector(
    'ytmusic-player-bar .volume-container',
  );
  if (volumeContainer) {
    return { parent: volumeContainer, before: null };
  }
  const playerBar = document.querySelector('ytmusic-player-bar');
  if (playerBar) {
    return { parent: playerBar, before: null };
  }
  return null;
}

function ensureCog(): void {
  if (cog?.isConnected) return;
  const anchor = findCogAnchor();
  if (!anchor) return;
  if (!cog) {
    cog = createCogButton();
  }
  anchor.parent.insertBefore(cog, anchor.before);
}

function stopObserverRetry(): void {
  if (observerRetry === null) return;
  clearInterval(observerRetry);
  observerRetry = null;
}

function scheduleObserverRetry(): void {
  if (observerRetry !== null) return;
  observerRetry = setInterval(() => {
    ensureObserver();
    ensureCog();
  }, OBSERVER_RETRY_MS);
}

/**
 * Observes only `ytmusic-player-bar`, never `document.body`: a document-wide
 * subtree observer fires on every mutation the app makes for the rest of the
 * session. A missing bar (app open) is polled instead, and a bar that is
 * replaced is re-targeted rather than watched after it is detached.
 */
function ensureObserver(): void {
  if (!observer) {
    observer = new MutationObserver(() => {
      if (observerTarget !== null && !observerTarget.isConnected) {
        observerTarget = null;
      }
      ensureObserver();
      ensureCog();
    });
  }
  const target = document.querySelector('ytmusic-player-bar');
  if (!target) {
    if (observerTarget !== null) {
      observer.disconnect();
      observerTarget = null;
    }
    scheduleObserverRetry();
    return;
  }
  if (observerTarget === target) return;
  observer.disconnect();
  observer.observe(target, { childList: true, subtree: true });
  observerTarget = target;
  stopObserverRetry();
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const element = document.createElement('style');
  element.id = STYLE_ID;
  element.textContent = style;
  document.head.appendChild(element);
}

function renderSections(): void {
  if (!panel) return;
  panel.replaceChildren(
    ...Array.from(sections.values(), (section) => {
      const wrapper = document.createElement('section');
      wrapper.className = 'pbg-section';
      wrapper.setAttribute('aria-label', section.title);
      const title = document.createElement('div');
      title.className = 'pbg-section-title';
      title.textContent = section.title;
      wrapper.append(title, section.root);
      return wrapper;
    }),
  );
}

function openPanel(): void {
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'pbg-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', cogLabel());
  }
  renderSections();
  document.body.appendChild(panel);
  cog?.setAttribute('aria-expanded', 'true');
  if (!outsideHandler) {
    outsideHandler = (event: MouseEvent) => {
      if (!panel) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.contains(target)) return;
      if (cog && (target === cog || cog.contains(target))) return;
      closePanel();
    };
    document.addEventListener('click', outsideHandler, { capture: true });
  }
  if (!escapeHandler) {
    escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePanel();
    };
    document.addEventListener('keydown', escapeHandler, { capture: true });
  }
}

function closePanel(): void {
  if (outsideHandler) {
    document.removeEventListener('click', outsideHandler, { capture: true });
    outsideHandler = null;
  }
  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler, { capture: true });
    escapeHandler = null;
  }
  // Keep the section roots as children of the detached panel: their sync()
  // must keep working while the panel is closed.
  panel?.remove();
  cog?.setAttribute('aria-expanded', 'false');
}

function togglePanel(): void {
  if (panel?.isConnected) {
    closePanel();
    return;
  }
  openPanel();
}

function teardown(): void {
  closePanel();
  panel?.remove();
  panel = null;
  cog?.remove();
  cog = null;
  observer?.disconnect();
  observer = null;
  observerTarget = null;
  stopObserverRetry();
  document.getElementById(STYLE_ID)?.remove();
}

export function registerPlayerPanelSection(section: PlayerPanelSection): void {
  try {
    if (sections.has(section.id)) {
      unregisterPlayerPanelSection(section.id);
    }
    sections.set(section.id, section);
    ensureStyle();
    ensureObserver();
    ensureCog();
    renderSections();
  } catch (error) {
    console.error('[player-panel] failed to register section', error);
  }
}

export function unregisterPlayerPanelSection(id: string): void {
  const section = sections.get(id);
  if (!section) return;
  sections.delete(id);
  try {
    section.onDestroy?.();
  } catch (error) {
    console.error('[player-panel] failed to destroy section', error);
  }
  if (sections.size === 0) {
    teardown();
    return;
  }
  renderSections();
}
