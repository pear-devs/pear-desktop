import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  type Accessor,
} from 'solid-js';
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
  const parts = [describeStyle(plan)];
  if (plan.fromKey && plan.toKey) {
    parts.push(
      t('plugins.automix.ui.detail.keys', {
        from: plan.fromKey,
        to: plan.toKey,
      }),
    );
  }
  return parts.join(' · ');
};

const describeStyle = (plan: TransitionPlan) => {
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
    case 'segue':
      return t(
        plan.reason === 'cold-ending'
          ? 'plugins.automix.ui.detail.segue-cold'
          : 'plugins.automix.ui.detail.segue',
      );
    default:
      return t(
        plan.holdOutgoing
          ? 'plugins.automix.ui.detail.lead-in'
          : 'plugins.automix.ui.detail.smooth',
        { seconds: Math.round(plan.duration) },
      );
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

interface Hint {
  heading: string;
  lines: string[];
  footer: string;
}

/** What the hover card says: which method comes next, and why */
const hintFor = (status: AutoMixStatus): Hint => {
  const { plan, phase, reason, toTitle } = status;
  const footer = t(
    phase === 'inactive'
      ? 'plugins.automix.ui.hint.click-on'
      : 'plugins.automix.ui.hint.click-off',
  );

  if ((phase === 'ready' || phase === 'mixing') && plan) {
    return {
      heading: t(
        phase === 'mixing'
          ? 'plugins.automix.ui.hint.now'
          : 'plugins.automix.ui.hint.next',
        { style: styleName(plan) },
      ),
      lines: [
        t(`plugins.automix.ui.why.${plan.reason}`, {
          from: plan.fromKey ?? '?',
          to: plan.toKey ?? '?',
        }),
        ...(phase === 'ready'
          ? [
              t('plugins.automix.ui.hint.when', {
                title: toTitle ?? '',
                time: formatTime(plan.mixOut),
              }),
            ]
          : []),
        describePlan(plan),
        ...(status.lowQuality
          ? [
              t('plugins.automix.ui.low-quality', {
                quality: status.lowQuality,
              }),
            ]
          : []),
      ],
      footer,
    };
  }

  switch (phase) {
    case 'inactive':
      return {
        heading: t('plugins.automix.ui.hint.off-heading'),
        lines: [],
        footer,
      };
    case 'analyzing':
      return {
        heading: t('plugins.automix.ui.hint.analyzing-heading'),
        lines: [t('plugins.automix.ui.hint.analyzing')],
        footer,
      };
    default:
      return {
        heading: t('plugins.automix.ui.hint.waiting-heading'),
        lines: reason ? [t(`plugins.automix.ui.reason.${reason}`)] : [],
        footer,
      };
  }
};

interface PillProps extends UiProps {
  onHover: (anchor: DOMRect | null) => void;
}

const Pill = (props: PillProps) => {
  const phase = () => props.status().phase;

  const label = () => {
    switch (phase()) {
      case 'inactive':
        return t('plugins.automix.ui.off');
      case 'mixing':
        return t('plugins.automix.ui.mixing');
      default:
        return t('plugins.automix.ui.on');
    }
  };

  const hint = createMemo(() => hintFor(props.status()));
  const ariaLabel = () => [hint().heading, ...hint().lines].join('. ');

  const show = (event: Event) =>
    props.onHover((event.currentTarget as HTMLElement).getBoundingClientRect());
  const hide = () => props.onHover(null);

  return (
    <button
      aria-label={ariaLabel()}
      aria-pressed={phase() !== 'inactive'}
      class="automix-pill"
      data-phase={phase()}
      // A native listener on the button itself: the player bar stops clicks
      // from bubbling up to Solid's document-level (delegated) handlers
      on:click={(event) => {
        event.stopPropagation();
        props.onToggle();
      }}
      onBlur={hide}
      onFocus={show}
      onMouseEnter={show}
      onMouseLeave={hide}
      type="button"
    >
      <Show fallback={<AutoMixIcon />} when={phase() === 'mixing'}>
        <MixBars />
      </Show>
      <span class="automix-label">{label()}</span>
      {/* The hover card is aria-hidden, so announce phase changes here */}
      <span aria-live="polite" class="automix-sr-only">
        {hint().heading}
      </span>
    </button>
  );
};

const HoverCard = (props: {
  status: Accessor<AutoMixStatus>;
  anchor: Accessor<DOMRect | null>;
}) => {
  const hint = createMemo(() => hintFor(props.status()));
  const position = () => {
    const anchor = props.anchor();
    if (!anchor) return {};
    return {
      right: `${Math.max(8, window.innerWidth - anchor.right)}px`,
      bottom: `${window.innerHeight - anchor.top + 10}px`,
    };
  };

  return (
    <div
      aria-hidden="true"
      class="automix-hint"
      classList={{ 'automix-hint-visible': props.anchor() !== null }}
      style={position()}
    >
      <div class="automix-hint-heading">{hint().heading}</div>
      <For each={hint().lines}>
        {(line) => <div class="automix-hint-line">{line}</div>}
      </For>
      <div class="automix-hint-footer">{hint().footer}</div>
    </div>
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
      <Show when={visible() && props.status().plan}>
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

  const [anchor, setAnchor] = createSignal<DOMRect | null>(null);

  const disposers = [
    render(() => <Pill {...props} onHover={setAnchor} />, pillHost),
    render(
      () => (
        <>
          <MixCard {...props} />
          <HoverCard anchor={anchor} status={props.status} />
        </>
      ),
      cardHost,
    ),
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
