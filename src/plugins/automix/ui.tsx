import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
  type Accessor,
} from 'solid-js';
import { render } from 'solid-js/web';

import { t } from '@/i18n';
import {
  albumColors,
  COLOR_KEY,
  DARK_COLOR_KEY,
} from '@/plugins/album-color-theme/colors';

import { effectById, effectName } from './effects';
import { InfoButton, TimelinePanel } from './timeline';

import type { AutoMixPluginConfig } from './config';
import type { AutoMixStatus, TransitionTimeline } from './engine';
import type { TransitionPlan } from './planner';
import type { ReorderResult } from './reorder';

interface UiProps {
  status: Accessor<AutoMixStatus>;
  config: Accessor<AutoMixPluginConfig>;
  onToggle: () => void;
  /** Reorders the upcoming songs for the best transitions */
  reorder: (
    onProgress: (done: number, total: number) => void,
  ) => Promise<ReorderResult | null>;
  /** Mixes into the next song as soon as it can; false if it can't yet */
  mixNow: () => Promise<boolean>;
  /** The planned transition laid out for drawing */
  timeline: () => TransitionTimeline | null;
  /** Where playback is on that timeline */
  timelinePosition: () => number | null;
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
        bars: Math.max(1, Math.round(plan.duration / (plan.beat * 4))),
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

const ReorderIcon = () => (
  <svg aria-hidden="true" class="automix-icon" viewBox="0 0 24 24">
    <path d="M7 4v15M4 16l3 3 3-3M17 20V5M14 8l3-3 3 3" />
  </svg>
);

const MixNowIcon = () => (
  <svg aria-hidden="true" class="automix-icon" viewBox="0 0 24 24">
    <path d="M4 6l7 6-7 6M13 6l7 6-7 6" />
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
        plan.landsOnVocal === undefined
          ? t('plugins.automix.ui.detail.entry', {
              time: formatTime(plan.mixIn),
            })
          : t('plugins.automix.ui.detail.entry-vocal', {
              time: formatTime(plan.mixIn),
              vocal: formatTime(plan.landsOnVocal),
            }),
        ...(effectName(plan.effect)
          ? [
              t(
                effectById(plan.effect)?.family === 'spotify'
                  ? 'plugins.automix.ui.detail.spotify-effect'
                  : 'plugins.automix.ui.detail.effect',
                { name: effectName(plan.effect) },
              ),
            ]
          : []),
        ...(plan.appleAnalysis
          ? [t('plugins.automix.ui.detail.apple')]
          : []),
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

type ReorderState =
  | { kind: 'idle' }
  | { kind: 'busy'; done: number; total: number }
  | { kind: 'undo'; result: ReorderResult }
  | { kind: 'note'; text: string };

/** Next to the pill: reorder the upcoming songs, then offer to undo it */
const ReorderButton = (props: UiProps) => {
  const [state, setState] = createSignal<ReorderState>({ kind: 'idle' });
  let timer: number | undefined;
  const settle = (next: ReorderState, ms: number) => {
    setState(next);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setState({ kind: 'idle' }), ms);
  };
  onCleanup(() => window.clearTimeout(timer));

  // Moving songs mid-transition would pull the incoming one away
  const mixing = () => props.status().phase === 'mixing';

  const run = async () => {
    const current = state();
    if (current.kind === 'busy' || mixing()) return;
    if (current.kind === 'undo') {
      settle(
        {
          kind: 'note',
          text: current.result.undo()
            ? t('plugins.automix.ui.reorder.undone')
            : t('plugins.automix.ui.reorder.changed'),
        },
        3000,
      );
      return;
    }
    window.clearTimeout(timer);
    setState({ kind: 'busy', done: 0, total: 0 });
    try {
      const result = await props.reorder((done, total) =>
        setState({ kind: 'busy', done, total }),
      );
      if (!result) {
        settle(
          { kind: 'note', text: t('plugins.automix.ui.reorder.nothing') },
          3000,
        );
      } else if (result.moved === 0) {
        settle(
          { kind: 'note', text: t('plugins.automix.ui.reorder.already') },
          3000,
        );
      } else {
        settle({ kind: 'undo', result }, 60_000);
      }
    } catch {
      settle(
        { kind: 'note', text: t('plugins.automix.ui.reorder.failed') },
        3000,
      );
    }
  };

  const label = () => {
    const current = state();
    switch (current.kind) {
      case 'busy':
        return current.total
          ? t('plugins.automix.ui.reorder.busy', {
              done: current.done,
              total: current.total,
            })
          : t('plugins.automix.ui.reorder.label');
      case 'undo':
        return t('plugins.automix.ui.reorder.undo');
      case 'note':
        return current.text;
      default:
        return t('plugins.automix.ui.reorder.label');
    }
  };
  const title = () => {
    const current = state();
    if (mixing()) return t('plugins.automix.ui.reorder.mixing');
    if (current.kind === 'undo') {
      const { moved, before, after } = current.result;
      return t('plugins.automix.ui.reorder.undo-title', {
        moved,
        matched: after.matched,
        transitions: after.transitions,
        was: before.matched,
        clashes: after.clashes,
      });
    }
    return t('plugins.automix.ui.reorder.title');
  };

  return (
    <button
      aria-busy={state().kind === 'busy'}
      aria-disabled={mixing()}
      aria-label={`${label()}. ${title()}`}
      class="automix-pill automix-reorder"
      data-state={state().kind}
      // Own listener: the player bar stops clicks reaching delegated ones
      on:click={(event) => {
        event.stopPropagation();
        run().catch(console.error);
      }}
      title={title()}
      type="button"
    >
      <ReorderIcon />
      <span class="automix-label">{label()}</span>
    </button>
  );
};

type MixNowState = 'idle' | 'busy' | 'armed' | 'unavailable';

/** Next to Reorder: start the transition into the next song now */
const MixNowButton = (props: UiProps) => {
  const [state, setState] = createSignal<MixNowState>('idle');
  let timer: number | undefined;
  onCleanup(() => window.clearTimeout(timer));

  // Only once the next transition is planned, and not during one
  const ready = () => props.status().phase === 'ready';
  createEffect(() => {
    // An armed mix-now is done once its transition starts (or is dropped)
    if (state() === 'armed' && props.status().phase !== 'ready') {
      setState('idle');
    }
  });

  const run = async () => {
    if (state() !== 'idle' || !ready()) return;
    setState('busy');
    const started = await props.mixNow().catch(() => false);
    if (started) {
      setState('armed');
      return;
    }
    setState('unavailable');
    window.clearTimeout(timer);
    timer = window.setTimeout(() => setState('idle'), 3000);
  };

  const label = () => t(`plugins.automix.ui.mix-now.${state()}`);

  return (
    <button
      aria-busy={state() === 'busy'}
      aria-disabled={!ready() || state() !== 'idle'}
      aria-label={`${label()}. ${t('plugins.automix.ui.mix-now.title')}`}
      class="automix-pill automix-mix-now"
      data-state={state()}
      // Own listener: the player bar stops clicks reaching delegated ones
      on:click={(event) => {
        event.stopPropagation();
        run().catch(console.error);
      }}
      title={t('plugins.automix.ui.mix-now.title')}
      type="button"
    >
      <MixNowIcon />
      <span class="automix-label">{label()}</span>
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
    const right = `${Math.max(8, window.innerWidth - anchor.right)}px`;
    // Open away from the window edge the button sits at
    return anchor.top < window.innerHeight / 2
      ? { right, top: `${anchor.bottom + 10}px` }
      : { right, bottom: `${window.innerHeight - anchor.top + 10}px` };
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

/** Eases the blend's progress so artwork and colour start and settle gently */
const calm = (progress: number) => {
  const x = Math.min(1, Math.max(0, progress));
  return x * x * (3 - (2 * x));
};

const cssUrl = (url: string | undefined) =>
  url ? `url("${url.replaceAll('"', '%22')}")` : 'none';

/** The old song's artwork with the new one sweeping in over it */
const ArtPair = (props: {
  from?: string;
  to?: string;
  reveal: number;
  class?: string;
}) => (
  <div
    aria-hidden="true"
    class={`automix-art ${props.class ?? ''}`}
    style={{ '--automix-reveal': String(props.reveal) }}
  >
    <div
      class="automix-art-from"
      style={{ 'background-image': cssUrl(props.from) }}
    />
    <div
      class="automix-art-to"
      style={{ 'background-image': cssUrl(props.to) }}
    />
  </div>
);

/** Where the player shows the playing song's artwork */
const ART_HOSTS = [
  'ytmusic-player #song-image',
  'ytmusic-player-bar .thumbnail-image-wrapper',
];
/** How long the overlay takes to melt away once the new song is playing */
const ART_SETTLE_MS = 1600;

/**
 * Cross-fades the player's own artwork (big image and player bar thumbnail)
 * from the old song to the new one along the blend, so the cover doesn't
 * snap over when the player switches songs. The overlay melts away once the
 * player shows the new cover itself.
 */
const followArtwork = (props: { status: Accessor<AutoMixStatus> }) => {
  let overlays: HTMLElement[] = [];
  let key = '';
  /** Overlays melting away, each batch on its own timer */
  const leaving = new Map<number, HTMLElement[]>();

  const build = (from: string | undefined, to: string) => {
    for (const selector of ART_HOSTS) {
      const host = document.querySelector<HTMLElement>(selector);
      if (!host) continue;
      host.classList.add('automix-art-host');
      const overlay = document.createElement('div');
      overlay.className = 'automix-art automix-art-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      const fromLayer = document.createElement('div');
      fromLayer.className = 'automix-art-from';
      fromLayer.style.backgroundImage = cssUrl(from);
      const toLayer = document.createElement('div');
      toLayer.className = 'automix-art-to';
      toLayer.style.backgroundImage = cssUrl(to);
      overlay.append(fromLayer, toLayer);
      host.append(overlay);
      overlays.push(overlay);
    }
  };
  const clear = () => {
    const batch = overlays;
    overlays = [];
    key = '';
    for (const overlay of batch) overlay.classList.add('automix-art-leaving');
    const timer = window.setTimeout(() => {
      leaving.delete(timer);
      for (const overlay of batch) overlay.remove();
    }, ART_SETTLE_MS);
    leaving.set(timer, batch);
  };

  createEffect(() => {
    const current = props.status();
    if (current.phase !== 'mixing' || !current.toArt) {
      if (overlays.length) clear();
      return;
    }
    const next = `${current.fromArt}|${current.toArt}`;
    if (next !== key) {
      if (overlays.length) clear();
      key = next;
      build(current.fromArt, current.toArt);
    }
    const reveal = String(calm(current.progress ?? 0));
    for (const overlay of overlays) {
      overlay.style.setProperty('--automix-reveal', reveal);
    }
  });

  onCleanup(() => {
    for (const [timer, batch] of leaving) {
      window.clearTimeout(timer);
      for (const overlay of batch) overlay.remove();
    }
    leaving.clear();
    for (const overlay of overlays) overlay.remove();
    for (const selector of ART_HOSTS) {
      document.querySelector(selector)?.classList.remove('automix-art-host');
    }
  });
};

const THEME_KEYS = [COLOR_KEY, DARK_COLOR_KEY];
type Rgb = number[];

const parseRgb = (value: string): Rgb | null => {
  const parts = value.split(',').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts : null;
};

/**
 * Moves the album colour theme's colours from the old song's artwork to the
 * new one's along the blend, instead of them jumping when the player
 * switches songs. Does nothing when that theme isn't on (no colours set).
 */
const followThemeColor = (props: { status: Accessor<AutoMixStatus> }) => {
  const root = document.documentElement;
  const read = () =>
    THEME_KEYS.map((name) => root.style.getPropertyValue(name).trim());
  let key = '';
  let from: Rgb[] | null = null;
  let to: Rgb[] | null = null;
  /** The theme has set the new song's colours itself */
  let themed = false;
  let reveal = 0;
  let written: string[] = [];

  const apply = () => {
    if (!from || !to) return;
    const start = from;
    const end = to;
    written = THEME_KEYS.map((name, i) => {
      const value = start[i]
        .map((channel, c) => Math.round(channel + ((end[i][c] - channel) * reveal)))
        .join(', ');
      root.style.setProperty(name, value);
      return value;
    });
  };

  // The theme sets the new song's colours as soon as the player switches:
  // they become the target, and the blend is put back before it's painted
  const observer = new MutationObserver(() => {
    if (!from) return;
    const now = read();
    if (now.every((value, i) => value === written[i])) return;
    const theirs = now.map(parseRgb);
    if (theirs.every((rgb) => rgb !== null)) {
      to = theirs;
      themed = true;
    }
    apply();
  });
  observer.observe(root, { attributes: true, attributeFilter: ['style'] });

  const finish = () => {
    if (from) {
      // Done: the new song's colours. Called off: the old song's again
      if (!themed) to = from;
      reveal = 1;
      apply();
    }
    key = '';
    from = null;
    to = null;
    themed = false;
  };

  createEffect(() => {
    const current = props.status();
    if (current.phase !== 'mixing' || !current.toArt) {
      finish();
      return;
    }
    const next = `${current.fromArt}|${current.toArt}`;
    if (next !== key) {
      finish();
      key = next;
      const start = read().map(parseRgb);
      if (!start.every((rgb) => rgb !== null)) return;
      from = start;
      written = read();
      const mine = key;
      void albumColors(current.toArt).then((colors) => {
        if (key !== mine || !from || themed || !colors) return;
        const end = [parseRgb(colors.color), parseRgb(colors.dark)];
        if (end.every((rgb) => rgb !== null)) {
          to = end;
          apply();
        }
      });
    }
    reveal = calm(current.progress ?? 0);
    apply();
  });

  onCleanup(() => {
    finish();
    observer.disconnect();
  });
};

/** Renders nothing: drives the player artwork's and theme colour's cross-fade */
const ArtworkFade = (props: { status: Accessor<AutoMixStatus> }) => {
  followArtwork(props);
  followThemeColor(props);
  return null;
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
            <Show when={props.config().artworkFade}>
              <ArtPair
                class="automix-card-wash"
                from={props.status().fromArt}
                reveal={calm(props.status().progress ?? 0)}
                to={props.status().toArt}
              />
            </Show>
            <div class="automix-card-header">
              <MixBars />
              <span class="automix-card-title">
                {t('plugins.automix.ui.mixing')}
              </span>
              <span class="automix-card-style">{styleName(plan())}</span>
            </div>
            <div class="automix-card-body">
              <Show
                when={props.config().artworkFade && props.status().toArt}
              >
                <ArtPair
                  class="automix-card-cover"
                  from={props.status().fromArt}
                  reveal={calm(props.status().progress ?? 0)}
                  to={props.status().toArt}
                />
              </Show>
              <div class="automix-card-text">
                <div class="automix-card-tracks">
                  <span class="automix-card-from">
                    {props.status().fromTitle}
                  </span>
                  <span class="automix-card-arrow">→</span>
                  <span class="automix-card-to">{props.status().toTitle}</span>
                </div>
                <div class="automix-card-detail">{describePlan(plan())}</div>
              </div>
            </div>
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

/** Mounts the AutoMix and Reorder buttons (top bar) and the floating cards */
export const mountUi = (props: UiProps) => {
  const pillHost = document.createElement('div');
  pillHost.className = 'automix-pill-host';
  const cardHost = document.createElement('div');
  cardHost.className = 'automix-card-host';
  document.body.append(cardHost);

  const [anchor, setAnchor] = createSignal<DOMRect | null>(null);
  const [details, setDetails] = createSignal(false);

  const disposers = [
    render(
      () => (
        <>
          <Pill {...props} onHover={setAnchor} />
          <ReorderButton {...props} />
          <MixNowButton {...props} />
          <InfoButton active={details} open={() => setDetails(!details())} />
        </>
      ),
      pillHost,
    ),
    render(
      () => (
        <>
          <Show when={props.config().artworkFade}>
            <ArtworkFade status={props.status} />
          </Show>
          <MixCard {...props} />
          <HoverCard anchor={anchor} status={props.status} />
          <Show when={details()}>
            <TimelinePanel
              close={() => setDetails(false)}
              describe={describePlan}
              hint={() => hintFor(props.status())}
              position={props.timelinePosition}
              status={props.status}
              timeline={props.timeline}
            />
          </Show>
        </>
      ),
      cardHost,
    ),
  ];

  // Top right, just left of the account picture. The top bar can be
  // re-rendered, so keep the buttons attached to it
  const attach = () => {
    const right = document.querySelector('ytmusic-nav-bar .right-content');
    if (!right) return;
    const account = right.querySelector(':scope > ytmusic-settings-button');
    if (account) {
      if (account.previousElementSibling !== pillHost) {
        right.insertBefore(pillHost, account);
      }
    } else if (pillHost.parentElement !== right) {
      right.append(pillHost);
    }
  };
  attach();
  const navBar = document.querySelector('ytmusic-nav-bar');
  const observer = new MutationObserver(attach);
  if (navBar) observer.observe(navBar, { childList: true, subtree: true });

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
