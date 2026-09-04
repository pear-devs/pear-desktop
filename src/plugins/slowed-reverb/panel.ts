import { t } from '@/i18n';

import { clampIntensity, clampSlow, formatPercent, formatRate } from './engine';

export interface SlowedReverbPanelState {
  slow: number;
  reverbIntensity: number;
  active: boolean;
}

export interface SlowedReverbPanelCallbacks {
  onActiveChange: (active: boolean) => void;
  onSlowLive: (value: number) => void;
  onSlowCommit: (value: number) => void;
  onReverbLive: (value: number) => void;
  onReverbCommit: (value: number) => void;
  onReset: () => void;
}

export interface PanelHandle {
  root: HTMLElement;
  sync: (state: SlowedReverbPanelState) => void;
  destroy: () => void;
}

const THROTTLE_MS = 40;

function throttleLive(fn: (value: number) => void): (value: number) => void {
  let last = 0;
  return (value: number) => {
    const now = Date.now();
    if (now - last >= THROTTLE_MS) {
      last = now;
      fn(value);
    }
  };
}

export function createCogButton(
  onToggle: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'sr-cog';
  button.title = t('plugins.slowed-reverb.name');
  button.setAttribute('aria-label', t('plugins.slowed-reverb.name'));
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.5-0.41h-3.8 c-0.27,0-0.47,0.17-0.5,0.41L9.24,5.35C8.65,5.59,8.12,5.91,7.62,6.29L5.23,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.72,8.87 c-0.11,0.21-0.06,0.48,0.12,0.61l2.03,1.58C4.82,11.36,4.8,11.68,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58c-0.18,0.14-0.23,0.41-0.12,0.61 l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54c0.05,0.24,0.24,0.41,0.5,0.41h3.8 c0.27,0,0.47-0.17,0.5-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32 c0.11-0.21,0.06-0.48-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6 S13.98,15.6,12,15.6z"/></svg>';
  button.addEventListener('click', onToggle);
  return button;
}

export function findCogAnchor(): {
  parent: Node;
  before: Node | null;
} | null {
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

function makeSliderRow(labelText: string): {
  row: HTMLElement;
  value: HTMLSpanElement;
} {
  const row = document.createElement('label');
  row.className = 'sr-row';
  const label = document.createElement('span');
  label.className = 'sr-label';
  label.textContent = labelText;
  const value = document.createElement('span');
  value.className = 'sr-value';
  row.append(label, value);
  return { row, value };
}

export function createPanel(
  initial: SlowedReverbPanelState,
  callbacks: SlowedReverbPanelCallbacks,
): PanelHandle {
  const root = document.createElement('div');
  root.className = 'sr-panel';

  const title = document.createElement('div');
  title.className = 'sr-title';
  title.textContent = t('plugins.slowed-reverb.panel.title');
  root.appendChild(title);

  const activeRow = document.createElement('label');
  activeRow.className = 'sr-row';
  const activeBox = document.createElement('input');
  activeBox.type = 'checkbox';
  activeBox.className = 'sr-check';
  activeBox.checked = initial.active;
  const activeLabel = document.createElement('span');
  activeLabel.className = 'sr-label';
  activeLabel.textContent = t('plugins.slowed-reverb.panel.active');
  activeRow.append(activeBox, activeLabel);
  root.appendChild(activeRow);

  const speedRow = makeSliderRow(t('plugins.slowed-reverb.panel.speed'));
  const speed = document.createElement('input');
  speed.type = 'range';
  speed.className = 'sr-range';
  speed.min = '0.7';
  speed.max = '1.3';
  speed.step = '0.01';
  speed.value = String(clampSlow(initial.slow));
  speed.setAttribute('aria-label', t('plugins.slowed-reverb.panel.speed'));
  speedRow.row.append(speed, speedRow.value);
  root.appendChild(speedRow.row);

  const reverbRow = makeSliderRow(t('plugins.slowed-reverb.panel.reverb'));
  const reverb = document.createElement('input');
  reverb.type = 'range';
  reverb.className = 'sr-range';
  reverb.min = '0';
  reverb.max = '100';
  reverb.step = '1';
  reverb.value = String(
    Math.round(clampIntensity(initial.reverbIntensity) * 100),
  );
  reverb.setAttribute('aria-label', t('plugins.slowed-reverb.panel.reverb'));
  reverbRow.row.append(reverb, reverbRow.value);
  root.appendChild(reverbRow.row);

  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'sr-reset';
  reset.textContent = t('plugins.slowed-reverb.panel.reset');
  root.appendChild(reset);

  const paint = (state: SlowedReverbPanelState): void => {
    speedRow.value.textContent = formatRate(state.slow);
    reverbRow.value.textContent = formatPercent(state.reverbIntensity);
  };
  paint(initial);

  const slowLive = throttleLive(callbacks.onSlowLive);
  const reverbLive = throttleLive(callbacks.onReverbLive);

  activeBox.addEventListener('change', () => {
    callbacks.onActiveChange(activeBox.checked);
  });
  speed.addEventListener('input', () => {
    const next = clampSlow(Number(speed.value));
    speedRow.value.textContent = formatRate(next);
    slowLive(next);
  });
  speed.addEventListener('change', () => {
    callbacks.onSlowCommit(clampSlow(Number(speed.value)));
  });
  reverb.addEventListener('input', () => {
    const next = clampIntensity(Number(reverb.value) / 100);
    reverbRow.value.textContent = formatPercent(next);
    reverbLive(next);
  });
  reverb.addEventListener('change', () => {
    callbacks.onReverbCommit(clampIntensity(Number(reverb.value) / 100));
  });
  speed.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const next = clampSlow(
        Number(speed.value) + (e.deltaY < 0 ? 0.01 : -0.01),
      );
      speed.value = String(next);
      speedRow.value.textContent = formatRate(next);
      slowLive(next);
      callbacks.onSlowCommit(next);
    },
    { passive: false },
  );
  reverb.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      const next = clampIntensity(
        // oxlint-disable-next-line @stylistic/no-mixed-operators
        Number(reverb.value) / 100 + (e.deltaY < 0 ? 0.01 : -0.01),
      );
      reverb.value = String(Math.round(next * 100));
      reverbRow.value.textContent = formatPercent(next);
      reverbLive(next);
      callbacks.onReverbCommit(next);
    },
    { passive: false },
  );
  reset.addEventListener('click', () => {
    callbacks.onReset();
  });

  return {
    root,
    sync: (state: SlowedReverbPanelState) => {
      activeBox.checked = state.active;
      speed.value = String(clampSlow(state.slow));
      reverb.value = String(
        Math.round(clampIntensity(state.reverbIntensity) * 100),
      );
      paint(state);
    },
    destroy: () => {
      root.remove();
    },
  };
}
