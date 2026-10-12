import { createEffect, createMemo, Show, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';

import type { AutoMixPluginConfig } from './config';
import type { AutoMixStatus } from './engine';
import type { TransitionPlan } from './planner';

interface UiProps {
  status: Accessor<AutoMixStatus>;
  config: Accessor<AutoMixPluginConfig>;
  onToggle: () => void;
}

const formatTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

const styleName = (plan: TransitionPlan) =>
  t(`plugins.automix.style.${plan.style}`);

const describePlan = (plan: TransitionPlan) => {
  const from = Math.round(plan.fromBpm);
  const to = Math.round(plan.toBpm);
  switch (plan.style) {
    case 'blend':
      return t('plugins.automix.ui.detail.blend', {
        from,
        to,
        stretch: (Math.abs(plan.rate - 1) * 100).toFixed(1),
      });
    case 'cut':
      return t('plugins.automix.ui.detail.cut', { bpm: from });
    default:
      return t('plugins.automix.ui.detail.smooth', {
        seconds: Math.round(plan.duration),
      });
  }
};

const AutoMixIcon = () => (
  <svg aria-hidden="true" class="automix-icon" viewBox="0 0 24 24">
    <path d="M3 12c0-2.5 1.9-4.5 4.3-4.5 3.4 0 6 9 9.4 9 2.4 0 4.3-2 4.3-4.5s-1.9-4.5-4.3-4.5c-3.4 0-6 9-9.4 9C4.9 16.5 3 14.5 3 12z" />
  </svg>
);

const MixBars = () => (
  <span aria-hidden="true" class="automix-bars">
    <i />
    <i />
    <i />
    <i />
  </span>
);

const Pill = (props: UiProps) => {
  const phase = () => props.status().phase;

  const label = () => {
    switch (phase()) {
      case 'inactive':
        return t('plugins.automix.ui.off');
      case 'mixing':
        return t('plugins.automix.ui.mixing');
      default:
        return t('plugins.automix.name');
    }
  };

  const tooltip = createMemo(() => {
    const { plan, toTitle } = props.status();
    switch (phase()) {
      case 'inactive':
        return t('plugins.automix.ui.tooltip.off');
      case 'analyzing':
        return t('plugins.automix.ui.tooltip.analyzing');
      case 'ready':
        return plan
          ? t('plugins.automix.ui.tooltip.ready', {
              style: styleName(plan),
              time: formatTime(plan.mixOut),
              title: toTitle ?? '',
              detail: describePlan(plan),
            })
          : t('plugins.automix.ui.tooltip.waiting');
      case 'mixing':
        return plan
          ? `${styleName(plan)} · ${describePlan(plan)}`
          : t('plugins.automix.ui.mixing');
      default:
        return t('plugins.automix.ui.tooltip.waiting');
    }
  });

  return (
    <button
      aria-label={tooltip()}
      aria-pressed={phase() !== 'inactive'}
      class="automix-pill"
      data-phase={phase()}
      onClick={(event) => {
        event.stopPropagation();
        props.onToggle();
      }}
      title={tooltip()}
      type="button"
    >
      <Show fallback={<AutoMixIcon />} when={phase() === 'mixing'}>
        <MixBars />
      </Show>
      <span class="automix-label">{label()}</span>
    </button>
  );
};

const MixCard = (props: UiProps) => {
  const visible = () =>
    props.config().showMixCard && props.status().phase === 'mixing';

  // Let the whole player bar glow while a mix is playing
  createEffect(() => {
    document
      .querySelector('ytmusic-player-bar')
      ?.classList.toggle('automix-mixing', props.status().phase === 'mixing');
  });

  return (
    <div
      aria-live="polite"
      class="automix-card"
      classList={{ 'automix-card-visible': visible() }}
      role="status"
    >
      <Show when={props.status().plan}>
        {(plan) => (
          <>
            <div class="automix-card-header">
              <MixBars />
              <span class="automix-card-title">
                {t('plugins.automix.ui.mixing')}
              </span>
              <span class="automix-card-style">{styleName(plan())}</span>
            </div>
            <div class="automix-card-tracks">
              <span class="automix-card-from">{props.status().fromTitle}</span>
              <span class="automix-card-arrow">→</span>
              <span class="automix-card-to">{props.status().toTitle}</span>
            </div>
            <div class="automix-card-detail">{describePlan(plan())}</div>
            <div class="automix-progress">
              <div
                class="automix-progress-fill"
                style={{
                  width: `${Math.round((props.status().progress ?? 0) * 100)}%`,
                }}
              />
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

/** Mounts the player bar pill and the floating mix card */
export const mountUi = (props: UiProps) => {
  const pillHost = document.createElement('div');
  pillHost.className = 'automix-pill-host';
  const cardHost = document.createElement('div');
  cardHost.className = 'automix-card-host';
  document.body.append(cardHost);

  const disposers = [
    render(() => <Pill {...props} />, pillHost),
    render(() => <MixCard {...props} />, cardHost),
  ];

  // The player bar can be re-rendered, keep the pill attached to it
  const attach = () => {
    const controls = document.querySelector(
      'ytmusic-player-bar .right-controls-buttons',
    );
    if (controls && pillHost.parentElement !== controls) {
      controls.prepend(pillHost);
    }
  };
  attach();
  const playerBar = document.querySelector('ytmusic-player-bar');
  const observer = new MutationObserver(attach);
  if (playerBar)
    observer.observe(playerBar, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    for (const dispose of disposers) dispose();
    pillHost.remove();
    cardHost.remove();
    document
      .querySelector('ytmusic-player-bar')
      ?.classList.remove('automix-mixing');
  };
};
