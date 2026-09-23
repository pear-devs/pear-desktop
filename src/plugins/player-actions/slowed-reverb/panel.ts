import { t } from '@/i18n';

import { clampIntensity, clampSlow, formatPercent, formatRate } from './engine';

export interface SlowedReverbSectionState {
  slow: number;
  reverbIntensity: number;
  active: boolean;
}

export interface SlowedReverbSectionCallbacks {
  onActiveChange: (active: boolean) => void;
  onSlowLive: (value: number) => void;
  onSlowCommit: (value: number) => void;
  onReverbLive: (value: number) => void;
  onReverbCommit: (value: number) => void;
  onReset: () => void;
}

export interface SlowedReverbSectionHandle {
  root: HTMLElement;
  sync: (state: SlowedReverbSectionState) => void;
  destroy: () => void;
}

const THROTTLE_MS = 40;
const WHEEL_COMMIT_MS = 200;

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

function debounceTrailing(
  fn: (value: number) => void,
  ms: number,
): ((value: number) => void) & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = 0;
  const wrapped = ((value: number) => {
    latest = value;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(latest);
    }, ms);
  }) as ((value: number) => void) & { cancel: () => void; flush: () => void };
  wrapped.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  wrapped.flush = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
      fn(latest);
    }
  };
  return wrapped;
}

function makeSliderRow(labelText: string): {
  row: HTMLElement;
  value: HTMLSpanElement;
} {
  const row = document.createElement('label');
  row.className = 'pbg-row';
  const label = document.createElement('span');
  label.className = 'pbg-label';
  label.textContent = labelText;
  const value = document.createElement('span');
  value.className = 'pbg-value';
  row.append(label, value);
  return { row, value };
}

export function createSlowedReverbSection(
  initial: SlowedReverbSectionState,
  callbacks: SlowedReverbSectionCallbacks,
): SlowedReverbSectionHandle {
  const root = document.createElement('div');
  root.className = 'pbg-body';

  const activeRow = document.createElement('label');
  activeRow.className = 'pbg-row';
  const activeBox = document.createElement('input');
  activeBox.type = 'checkbox';
  activeBox.className = 'pbg-check';
  activeBox.checked = initial.active;
  const activeLabel = document.createElement('span');
  activeLabel.className = 'pbg-label';
  activeLabel.textContent = t('plugins.slowed-reverb.panel.active');
  activeRow.append(activeBox, activeLabel);
  root.appendChild(activeRow);

  const speedRow = makeSliderRow(t('plugins.slowed-reverb.panel.speed'));
  const speed = document.createElement('input');
  speed.type = 'range';
  speed.className = 'pbg-range';
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
  reverb.className = 'pbg-range';
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
  reset.className = 'pbg-button';
  reset.textContent = t('plugins.slowed-reverb.panel.reset');
  root.appendChild(reset);

  const paint = (state: SlowedReverbSectionState): void => {
    speedRow.value.textContent = formatRate(state.slow);
    reverbRow.value.textContent = formatPercent(state.reverbIntensity);
  };
  paint(initial);

  const slowLive = throttleLive(callbacks.onSlowLive);
  const reverbLive = throttleLive(callbacks.onReverbLive);
  const slowWheelCommit = debounceTrailing(
    callbacks.onSlowCommit,
    WHEEL_COMMIT_MS,
  );
  const reverbWheelCommit = debounceTrailing(
    callbacks.onReverbCommit,
    WHEEL_COMMIT_MS,
  );

  activeBox.addEventListener('change', () => {
    callbacks.onActiveChange(activeBox.checked);
  });
  speed.addEventListener('input', () => {
    slowWheelCommit.cancel();
    const next = clampSlow(Number(speed.value));
    speedRow.value.textContent = formatRate(next);
    slowLive(next);
  });
  speed.addEventListener('change', () => {
    slowWheelCommit.cancel();
    callbacks.onSlowCommit(clampSlow(Number(speed.value)));
  });
  reverb.addEventListener('input', () => {
    reverbWheelCommit.cancel();
    const next = clampIntensity(Number(reverb.value) / 100);
    reverbRow.value.textContent = formatPercent(next);
    reverbLive(next);
  });
  reverb.addEventListener('change', () => {
    reverbWheelCommit.cancel();
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
      slowWheelCommit(next);
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
      reverbWheelCommit(next);
    },
    { passive: false },
  );
  reset.addEventListener('click', () => {
    slowWheelCommit.cancel();
    reverbWheelCommit.cancel();
    callbacks.onReset();
  });

  return {
    root,
    sync: (state: SlowedReverbSectionState) => {
      activeBox.checked = state.active;
      speed.value = String(clampSlow(state.slow));
      reverb.value = String(
        Math.round(clampIntensity(state.reverbIntensity) * 100),
      );
      paint(state);
    },
    destroy: () => {
      // Persist a wheel adjustment that is still inside the debounce window:
      // the live rate was applied, keep config in sync with it.
      slowWheelCommit.flush();
      reverbWheelCommit.flush();
      root.remove();
    },
  };
}
