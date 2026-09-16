import { t } from '@/i18n';

import { formatTime, parseTimeInput, type LoopState } from './engine';

export interface SectionPoints {
  startSeconds: number | null;
  endSeconds: number | null;
}

export interface SectionCallbacks {
  onActiveChange: (active: boolean) => void;
  onPointsChange: (points: SectionPoints) => void;
  getCurrentTime: () => number | null;
}

export interface SectionHandle {
  root: HTMLElement;
  sync: (state: LoopState) => void;
  destroy: () => void;
}

const STATUS_ERROR_CLASS = 'pbg-status-error';

function createRow(labelText: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'pbg-row';
  const label = document.createElement('span');
  label.className = 'pbg-label';
  label.textContent = labelText;
  row.appendChild(label);
  return row;
}

function createNowButton(ariaLabel: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'pbg-now';
  button.textContent = t('plugins.section-repeat.panel.now');
  button.setAttribute('aria-label', ariaLabel);
  return button;
}

function setInputInvalid(input: HTMLInputElement, invalid: boolean): void {
  if (invalid) {
    input.setAttribute('aria-invalid', 'true');
  } else {
    input.removeAttribute('aria-invalid');
  }
}

export function createSection(
  initial: LoopState,
  callbacks: SectionCallbacks,
): SectionHandle {
  const root = document.createElement('div');
  root.className = 'pbg-body';

  const activeRow = document.createElement('label');
  activeRow.className = 'pbg-row';
  const activeBox = document.createElement('input');
  activeBox.type = 'checkbox';
  activeBox.className = 'pbg-check';
  activeBox.checked = initial.active;
  activeBox.setAttribute(
    'aria-label',
    t('plugins.section-repeat.panel.active'),
  );
  const activeLabel = document.createElement('span');
  activeLabel.className = 'pbg-label';
  activeLabel.textContent = t('plugins.section-repeat.panel.active');
  activeRow.append(activeBox, activeLabel);
  root.appendChild(activeRow);

  const fromRow = createRow(t('plugins.section-repeat.panel.from'));
  const fromInput = document.createElement('input');
  fromInput.type = 'text';
  fromInput.className = 'pbg-input';
  fromInput.placeholder = '0:00';
  fromInput.setAttribute('aria-label', t('plugins.section-repeat.panel.from'));
  const fromNow = createNowButton(
    t('plugins.section-repeat.panel.set-from-now'),
  );
  fromRow.append(fromInput, fromNow);
  root.appendChild(fromRow);

  const toRow = createRow(t('plugins.section-repeat.panel.to'));
  const toInput = document.createElement('input');
  toInput.type = 'text';
  toInput.className = 'pbg-input';
  toInput.placeholder = t('plugins.section-repeat.panel.to-placeholder');
  toInput.setAttribute('aria-label', t('plugins.section-repeat.panel.to'));
  const toNow = createNowButton(t('plugins.section-repeat.panel.set-to-now'));
  toRow.append(toInput, toNow);
  root.appendChild(toRow);

  const status = document.createElement('div');
  status.className = 'pbg-status';
  status.setAttribute('role', 'status');
  root.appendChild(status);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'pbg-button';
  clear.textContent = t('plugins.section-repeat.panel.clear');
  clear.setAttribute('aria-label', t('plugins.section-repeat.panel.clear'));
  root.appendChild(clear);

  let active = initial.active;
  let startSeconds = initial.startSeconds;
  let endSeconds = initial.endSeconds;

  const currentState = (): LoopState => ({
    active,
    startSeconds,
    endSeconds,
  });

  /**
   * Parses both fields for display. Returns null when a field is malformed
   * or the range is reversed; marks the offending fields with
   * `aria-invalid` in either case.
   */
  const readInputPoints = (): SectionPoints | null => {
    const parsedFrom = parseTimeInput(fromInput.value);
    const parsedTo = parseTimeInput(toInput.value);
    const fromInvalid = parsedFrom.kind === 'invalid';
    const toInvalid = parsedTo.kind === 'invalid';
    setInputInvalid(fromInput, fromInvalid);
    setInputInvalid(toInput, toInvalid);
    if (fromInvalid || toInvalid) return null;

    const nextStart = parsedFrom.kind === 'time' ? parsedFrom.seconds : null;
    const nextEnd = parsedTo.kind === 'time' ? parsedTo.seconds : null;
    if (nextStart !== null && nextEnd !== null && nextEnd <= nextStart) {
      setInputInvalid(fromInput, true);
      setInputInvalid(toInput, true);
      return null;
    }
    return { startSeconds: nextStart, endSeconds: nextEnd };
  };

  const paintStatus = (state: LoopState, invalid: boolean): void => {
    status.classList.toggle(STATUS_ERROR_CLASS, invalid);
    if (invalid) {
      status.textContent = t('plugins.section-repeat.panel.status-invalid');
      return;
    }
    if (!state.active) {
      status.textContent = t('plugins.section-repeat.panel.status-off');
      return;
    }
    if (state.startSeconds === null) {
      status.textContent = t('plugins.section-repeat.panel.status-need-start');
      return;
    }
    if (state.endSeconds === null) {
      status.textContent = t('plugins.section-repeat.panel.status-to-end', {
        start: formatTime(state.startSeconds),
      });
      return;
    }
    status.textContent = t('plugins.section-repeat.panel.status-loop', {
      start: formatTime(state.startSeconds),
      end: formatTime(state.endSeconds),
    });
  };

  const paintFromState = (): void => {
    const live = readInputPoints();
    paintStatus(currentState(), live === null);
  };

  /** Live preview of pending edits: never commits them. */
  const paintLive = (): void => {
    const live = readInputPoints();
    if (live === null) {
      paintStatus(currentState(), true);
      return;
    }
    paintStatus(
      {
        active,
        startSeconds: live.startSeconds,
        endSeconds: live.endSeconds,
      },
      false,
    );
  };

  const commit = (): void => {
    const live = readInputPoints();
    if (live === null) {
      paintStatus(currentState(), true);
      return;
    }
    startSeconds = live.startSeconds;
    endSeconds = live.endSeconds;
    fromInput.value = startSeconds === null ? '' : formatTime(startSeconds);
    toInput.value = endSeconds === null ? '' : formatTime(endSeconds);
    callbacks.onPointsChange({
      startSeconds,
      endSeconds,
    });
    paintFromState();
  };

  activeBox.addEventListener('change', () => {
    active = activeBox.checked;
    callbacks.onActiveChange(active);
    paintFromState();
  });
  fromInput.addEventListener('input', paintLive);
  toInput.addEventListener('input', paintLive);
  fromInput.addEventListener('change', commit);
  toInput.addEventListener('change', commit);
  fromInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') commit();
  });
  toInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') commit();
  });
  fromNow.addEventListener('click', () => {
    const time = callbacks.getCurrentTime();
    if (time === null || !Number.isFinite(time)) return;
    fromInput.value = formatTime(time);
    commit();
  });
  toNow.addEventListener('click', () => {
    const time = callbacks.getCurrentTime();
    if (time === null || !Number.isFinite(time)) return;
    toInput.value = formatTime(time);
    commit();
  });
  clear.addEventListener('click', () => {
    fromInput.value = '';
    toInput.value = '';
    commit();
  });

  const sync = (state: LoopState): void => {
    active = state.active;
    startSeconds = state.startSeconds;
    endSeconds = state.endSeconds;
    activeBox.checked = active;
    // Never clobber a field the user is currently editing.
    if (document.activeElement !== fromInput) {
      fromInput.value = startSeconds === null ? '' : formatTime(startSeconds);
    }
    if (document.activeElement !== toInput) {
      toInput.value = endSeconds === null ? '' : formatTime(endSeconds);
    }
    paintFromState();
  };

  sync(initial);

  return {
    root,
    sync,
    destroy: () => {
      root.remove();
    },
  };
}
