import { t } from '@/i18n';
import { ElementFromHtml } from '@/plugins/utils/renderer';

import { Popup } from '../element';
import IconKey from '../icons/key.svg?raw';
import IconTune from '../icons/tune.svg?raw';

import diagnosticsHTML from '../templates/diagnostics.html?raw';

import type {
  CheckId,
  DiagnosticCheck,
  DiagnosticResult,
  NatType,
} from '../diagnostics';

const CHECK_ORDER: CheckId[] = ['signaling', 'stun', 'turn', 'nat'];

const natLabel = (natType: NatType) =>
  t(`plugins.music-together.menu.diagnostics.nat.${natType}`);

const detailText = (check: DiagnosticCheck): string => {
  switch (check.id) {
    case 'signaling':
      return check.status === 'pass'
        ? t('plugins.music-together.menu.diagnostics.detail.signaling-ok')
        : t('plugins.music-together.menu.diagnostics.detail.signaling-fail', {
            reason: check.detail ?? 'unknown',
          });
    case 'stun':
      return check.status === 'pass'
        ? t('plugins.music-together.menu.diagnostics.detail.stun-ok')
        : t('plugins.music-together.menu.diagnostics.detail.stun-fail');
    case 'turn':
      return check.status === 'pass'
        ? t('plugins.music-together.menu.diagnostics.detail.turn-ok')
        : t('plugins.music-together.menu.diagnostics.detail.turn-fail');
    case 'nat':
      return natLabel((check.detail as NatType) ?? 'unknown');
    default:
      return '';
  }
};

/**
 * Show the public IP behind a click-to-reveal, so it stays out of casual
 * screenshots shared for support.
 */
const setupReveal = (detail: HTMLSpanElement, ip: string) => {
  const hidden = t(
    'plugins.music-together.menu.diagnostics.detail.public-ip-hidden',
  );
  const shown = t('plugins.music-together.menu.diagnostics.detail.public-ip', {
    ip,
  });

  let revealed = false;
  const toggle = () => {
    revealed = !revealed;
    detail.textContent = revealed ? shown : hidden;
    detail.setAttribute('aria-pressed', String(revealed));
  };

  detail.textContent = hidden;
  detail.classList.add('is-revealable');
  detail.title = t('plugins.music-together.menu.diagnostics.detail.reveal');
  // Expose as a real button so keyboard-only users can focus and toggle it.
  detail.setAttribute('role', 'button');
  detail.setAttribute('tabindex', '0');
  detail.setAttribute('aria-pressed', 'false');
  detail.onclick = toggle;
  detail.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  };
};

const clearReveal = (detail: HTMLSpanElement) => {
  detail.classList.remove('is-revealable');
  detail.onclick = null;
  detail.onkeydown = null;
  detail.removeAttribute('title');
  detail.removeAttribute('role');
  detail.removeAttribute('tabindex');
  detail.removeAttribute('aria-pressed');
};

const createDiagnostics = () => {
  const element = ElementFromHtml(diagnosticsHTML);
  const list = element.querySelector<HTMLDivElement>(
    '.music-together-diagnostics-list',
  )!;
  const verdictLabel = element.querySelector<HTMLDivElement>(
    '#music-together-diagnostics-verdict',
  )!;

  const rows = new Map<
    CheckId,
    { indicator: HTMLSpanElement; detail: HTMLSpanElement }
  >();

  for (const id of CHECK_ORDER) {
    const row = document.createElement('div');
    row.className = 'music-together-diagnostics-row';

    const indicator = document.createElement('span');
    indicator.className = 'music-together-diagnostics-indicator is-pending';

    const text = document.createElement('div');
    text.className = 'music-together-diagnostics-text';

    const label = document.createElement('span');
    label.className = 'music-together-diagnostics-label';
    label.textContent = t(
      `plugins.music-together.menu.diagnostics.check.${id}`,
    );

    const detail = document.createElement('span');
    detail.className = 'music-together-diagnostics-detail';

    text.append(label, detail);
    row.append(indicator, text);
    list.append(row);

    rows.set(id, { indicator, detail });
  }

  let summary = '';

  const reset = () => {
    summary = '';
    for (const { indicator, detail } of rows.values()) {
      indicator.className = 'music-together-diagnostics-indicator is-pending';
      clearReveal(detail);
      detail.textContent = '';
    }
    verdictLabel.className = 'music-together-diagnostics-verdict is-running';
    verdictLabel.textContent = t(
      'plugins.music-together.menu.diagnostics.running',
    );
  };

  const setCheck = (check: DiagnosticCheck) => {
    const row = rows.get(check.id);
    if (!row) return;
    row.indicator.className = `music-together-diagnostics-indicator is-${check.status}`;

    clearReveal(row.detail);
    if (check.id === 'stun' && check.status === 'pass' && check.detail) {
      setupReveal(row.detail, check.detail);
    } else {
      row.detail.textContent = detailText(check);
    }
  };

  const setResult = (result: DiagnosticResult) => {
    for (const check of result.checks) setCheck(check);
    summary = result.summary;
    verdictLabel.className = `music-together-diagnostics-verdict is-${result.verdict}`;
    verdictLabel.textContent = t(
      `plugins.music-together.menu.diagnostics.verdict.${result.verdict}`,
    );
  };

  return {
    element,
    reset,
    setCheck,
    setResult,
    getSummary: () => summary,
  };
};

export type DiagnosticsPopupProps = {
  onItemClick: (id: string) => void;
};

export const createDiagnosticsPopup = (props: DiagnosticsPopupProps) => {
  const diagnostics = createDiagnostics();

  const result = Popup({
    data: [
      {
        type: 'custom',
        element: diagnostics.element,
      },
      {
        type: 'divider',
      },
      {
        id: 'music-together-diagnostics-run',
        type: 'item',
        icon: ElementFromHtml(IconTune),
        text: t('plugins.music-together.menu.diagnostics.run-again'),
        onClick: () => props.onItemClick('music-together-diagnostics-run'),
      },
      {
        id: 'music-together-diagnostics-copy',
        type: 'item',
        icon: ElementFromHtml(IconKey),
        text: t('plugins.music-together.menu.diagnostics.copy'),
        onClick: () => props.onItemClick('music-together-diagnostics-copy'),
      },
    ],
    anchorAt: 'bottom-right',
    popupAt: 'top-right',
  });

  return {
    ...diagnostics,
    ...result,
  };
};
