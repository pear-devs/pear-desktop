export const ATTEMPT_DEBOUNCE_MS = 250;
export const CLICK_THROTTLE_MS = 1200;
export const POLL_MS = 800;

export const PLAYER_ROOT_SELECTOR = 'ytmusic-player, #movie_player';
export const SCOPED_ERROR_RENDERER_SELECTOR =
  'yt-playability-error-supported-renderers yt-player-error-message-renderer';
export const ERROR_RENDERER_SELECTOR = 'yt-player-error-message-renderer';
export const PROCEED_BUTTON_SELECTOR = '#button button';

/**
 * Needles matched against folded `#reason` + `#subreason` text.
 * Intentionally excludes age-gate / login / Premium / unavailable copy.
 */
const WARNING_NEEDLES = [
  'suicide or self-harm',
  'self-harm',
  'self harm',
  'suicid',
  'viewer discretion',
  'selbstmord',
  'selbstverletzung',
  'suizid',
  'automutilation',
  'autolesion',
  'zelfmoord',
  'zelfbeschadiging',
  'самоубий',
  'самоповрежд',
  'суицид',
  'samoboj',
  'samookalecz',
  'intihar',
  'selvmord',
  'sjalvmord',
  'itsemurh',
  'itsensa vahingoitt',
  '自杀',
  '自殺',
  '自残',
  '自殘',
  '自傷',
  '自伤',
  '자살',
  '자해',
  'انتحار',
];

export const foldText = (value: string): string =>
  value.toLowerCase().normalize('NFD').replaceAll(/\p{M}/gu, '');

export const isContentWarningText = (
  reason: string,
  subreason = '',
): boolean => {
  const haystack = foldText(`${reason}\n${subreason}`);
  if (!haystack.trim()) return false;
  return WARNING_NEEDLES.some((needle) => haystack.includes(foldText(needle)));
};

export const shouldAcknowledge = (input: {
  reason: string | null | undefined;
  subreason?: string | null;
  hasProceedButton: boolean;
}): boolean => {
  const reason = (input.reason ?? '').trim();
  if (!reason) return false;
  if (!input.hasProceedButton) return false;
  return isContentWarningText(reason, input.subreason ?? '');
};

export const warningScreenKey = (reason: string, videoKey: string): string =>
  `${videoKey}::${reason.trim()}`;

export const isVisibleElement = (el: Element): boolean => {
  const h = el as HTMLElement;
  const style = window.getComputedStyle(h);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0'
  ) {
    return false;
  }
  const rect = h.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

export const findVisibleErrorRenderer = (root: ParentNode): Element | null => {
  const scoped = root.querySelectorAll(SCOPED_ERROR_RENDERER_SELECTOR);
  const nodes =
    scoped.length > 0 ? scoped : root.querySelectorAll(ERROR_RENDERER_SELECTOR);
  for (const node of nodes) {
    if (isVisibleElement(node)) return node;
  }
  return null;
};

/** Primary proceed CTA only — never `#button` (a div) or a random `button`. */
export const findProceedButton = (renderer: Element): HTMLElement | null => {
  const btn = renderer.querySelector(PROCEED_BUTTON_SELECTOR);
  if (!btn) return null;
  if (!isVisibleElement(btn)) return null;
  return btn as HTMLElement;
};

export const readReasonText = (renderer: Element): string | null => {
  const reasonEl = renderer.querySelector('#reason');
  if (!reasonEl) return null;
  const text = (reasonEl.textContent ?? '').trim();
  return text.length > 0 ? text : null;
};

export const readSubreasonText = (renderer: Element): string =>
  (renderer.querySelector('#subreason')?.textContent ?? '').trim();
