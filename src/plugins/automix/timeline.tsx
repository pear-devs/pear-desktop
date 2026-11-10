import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type Accessor,
} from 'solid-js';

import { t } from '@/i18n';

import {
  EFFECT_DEFAULTS,
  effectById,
  effectName,
  laneTimes,
  laneValue,
  withBassSwap,
  type EffectParam,
  type Lane,
} from './effects';

import type { AutoMixStatus, TransitionTimeline } from './engine';
import type { TransitionPlan } from './planner';

export interface TimelineProps {
  status: Accessor<AutoMixStatus>;
  timeline: () => TransitionTimeline | null;
  /** Where playback is on the timeline (the outgoing song's seconds) */
  position: () => number | null;
  /** Why the plan is what it is (same lines as the pill's hover card) */
  hint: Accessor<{ heading: string; lines: string[] }>;
  /** One line summing the plan up (bars, BPM, keys) */
  describe: (plan: TransitionPlan) => string;
}

/** How long the old song's final hit rings on (engine's ENDING_RING) */
const ENDING_RING = 1.5;

const BAND_COLORS = {
  low: [70, 140, 255],
  mid: [255, 168, 64],
  high: [236, 240, 255],
} as const;

const formatClock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** A lane parameter's value `time` seconds into a style's window */
const laneLevel = (
  lanes: Lane[],
  param: EffectParam,
  time: number,
  duration: number,
  neutral: number,
) => {
  const items = lanes
    .filter((item) => item.param === param)
    .map((item) => ({ item, ...laneTimes(item, 0, duration) }))
    .sort((a, b) => a.from - b.from);
  if (items.length === 0) return neutral;
  let value =
    time >= Math.min(items[0].placed, items[0].from) ? items[0].item.from : neutral;
  for (const { item, from, to } of items) {
    if (time < from) break;
    value = to <= from || time >= to ? item.to : laneValue(item, (time - from) / (to - from));
  }
  return value;
};

/** How loud each song is played at a timeline time (0..1), as the engine schedules it */
const levelsAt = (plan: TransitionPlan, time: number) => {
  const x = time - plan.mixOut;
  const d = Math.max(0.05, plan.duration);
  if (x < 0) return { out: 1, in: 0 };
  const sine = Math.sin((Math.min(1, x / d) * Math.PI) / 2);
  const cosine = Math.cos((Math.min(1, x / d) * Math.PI) / 2);
  const ring = (after: number) => Math.exp(-after / (ENDING_RING / 4));
  const style = plan.style === 'blend' ? effectById(plan.effect) : undefined;
  if (style) {
    return {
      out: x > d + 0.1 ? 0 : laneLevel(style.outgoing, 'gain', x, d, 1),
      in: laneLevel(style.incoming, 'gain', x, d, 0),
    };
  }
  switch (plan.style) {
    case 'cut':
      return { out: 0, in: 1 };
    case 'segue':
      return { out: Math.exp(-x / (d / 4)), in: 1 };
    default:
      if (plan.holdOutgoing) {
        return { out: x <= d ? 1 : ring(x - d), in: sine };
      }
      return { out: x >= d ? 0 : cosine, in: x >= d ? 1 : sine };
  }
};

type Band = 'low' | 'mid' | 'high';
/** Where each drawn band sits, for working out what a filter leaves of it */
const BAND_HZ: Record<Band, number> = { low: 90, mid: 700, high: 5000 };
const lowpassGain = (hz: number, cutoff: number) => 1 / Math.sqrt(1 + ((hz / cutoff) ** 4));
const highpassGain = (hz: number, cutoff: number) => 1 / Math.sqrt(1 + ((cutoff / hz) ** 4));
/** a -> b exponentially over [from, to] (as the engine's exponential ramps) */
const sweep = (time: number, from: number, to: number, a: number, b: number) =>
  time <= from ? a : time >= to ? b : a * ((b / a) ** ((time - from) / (to - from)));

/**
 * What the transition's filters leave of each band of one song at a timeline
 * time (amplitude, 0..1), as the engine schedules them
 */
const filterGains = (
  plan: TransitionPlan,
  side: 'out' | 'in',
  time: number,
): Record<Band, number> => {
  const x = time - plan.mixOut;
  const d = Math.max(0.05, plan.duration);
  let lowpass = 20_000;
  let highpass = 10;
  let bassDb = 0;
  const style = plan.style === 'blend' ? effectById(plan.effect) : undefined;
  const swap = plan.bassSwapAt ?? [0.45, 0.55];
  const shelf = (fromDb: number, toDb: number) =>
    x <= swap[0] * d ? fromDb : x >= swap[1] * d ? toDb
      : fromDb + ((toDb - fromDb) * ((x / d) - swap[0]) / (swap[1] - swap[0]));
  if (style) {
    const lanes = withBassSwap(style, plan.bassSwapAt)[side === 'out' ? 'outgoing' : 'incoming'];
    const at = (param: EffectParam) => laneLevel(lanes, param, Math.max(0, x), d, EFFECT_DEFAULTS[param]);
    if (x >= 0) {
      lowpass = at('lowpass');
      highpass = at('highpass');
      bassDb = at('bass');
    } else if (side === 'in') {
      bassDb = at('bass');
    }
  } else if (plan.style === 'blend') {
    if (plan.holdOutgoing) {
      const hit: [number, number] = [1 - ((plan.beat || 0.5) / 2 / d), 1];
      const ramp = (a: number, b: number) =>
        x <= hit[0] * d ? a : x >= d ? b : a + ((b - a) * ((x / d) - hit[0]) / (hit[1] - hit[0]));
      bassDb = side === 'out' ? ramp(0, -30) : ramp(-30, 0);
    } else {
      bassDb = side === 'out' ? shelf(0, -30) : shelf(-30, 0);
      if (side === 'out') highpass = sweep(x, 0.55 * d, d, 20, 400);
    }
    if (side === 'in' && plan.filterIn) {
      highpass = sweep(x, 0, plan.holdOutgoing ? d : 0.7 * d, 500, 20);
    }
  } else if (plan.style === 'smooth') {
    if (side === 'out' && !plan.holdOutgoing) lowpass = sweep(x, 0, d, 20_000, 700);
    if (side === 'in' && plan.filterIn) {
      highpass = sweep(x, 0, plan.holdOutgoing ? d : 0.7 * d, 500, 20);
    }
  } else if (plan.style === 'cut' && side === 'out') {
    highpass = sweep(x, -4 * (plan.beat || 0.5), 0, 20, 900);
  }
  const gain = (band: Band) =>
    lowpassGain(BAND_HZ[band], lowpass) *
    highpassGain(BAND_HZ[band], highpass) *
    (band === 'low' ? 10 ** (bassDb / 20) : 1);
  return { low: gain('low'), mid: gain('mid'), high: gain('high') };
};

interface Layout {
  width: number;
  height: number;
  /** Lane centre lines and half heights */
  topY: number;
  bottomY: number;
  half: number;
  axisY: number;
  x: (time: number) => number;
}

const layoutFor = (tl: TransitionTimeline, width: number, height: number): Layout => {
  const axis = 26;
  const gap = 14;
  const half = (height - axis - gap - 12) / 4;
  return {
    width,
    height,
    topY: 6 + half,
    bottomY: 6 + (half * 3) + gap,
    half,
    axisY: height - axis + 6,
    x: (time) => ((time - tl.start) / (tl.end - tl.start)) * width,
  };
};

/** Draws everything that doesn't move: waveforms, curves, bars, markers */
const drawStatic = (
  ctx: CanvasRenderingContext2D,
  tl: TransitionTimeline,
  layout: Layout,
  dpr: number,
) => {
  const { plan } = tl;
  const { width, height, x, half } = layout;
  ctx.clearRect(0, 0, width, height);

  // The overlap, softly lit
  const mixX = x(plan.mixOut);
  const endX = x(plan.mixOut + plan.duration);
  ctx.save();
  const accent = getComputedStyle(document.documentElement)
    .getPropertyValue('--automix-accent')
    .trim() || '255, 255, 255';
  const zone = ctx.createLinearGradient(0, 0, 0, layout.axisY);
  zone.addColorStop(0, `rgba(${accent}, 0.10)`);
  zone.addColorStop(0.5, `rgba(${accent}, 0.16)`);
  zone.addColorStop(1, `rgba(${accent}, 0.10)`);
  ctx.fillStyle = zone;
  ctx.fillRect(mixX, 0, Math.max(2 * dpr, endX - mixX), layout.axisY - 4 * dpr);
  ctx.restore();

  // Bass swap
  if (tl.bassSwap) {
    const [from, to] = tl.bassSwap.map(x);
    ctx.fillStyle = 'rgba(70, 140, 255, 0.10)';
    ctx.fillRect(from, 0, Math.max(2 * dpr, to - from), layout.axisY - 4 * dpr);
  }

  // Waveforms, layered like a DJ deck: bass widest, then mids, then highs.
  // Faint: the song as it is. Bright: what's heard of it, through the
  // transition's volume and filters
  const lane = (
    data: TransitionTimeline['out'] | null,
    centre: number,
    side: 'out' | 'in',
  ) => {
    if (!data) return;
    const count = data.low.length;
    const xAt = (k: number) => x(data.start + ((k + 0.5) * data.step));
    const heard = Array.from({ length: count }, (_, k) => {
      const time = data.start + ((k + 0.5) * data.step);
      const levels = levelsAt(plan, time);
      return { level: side === 'out' ? levels.out : levels.in, filters: filterGains(plan, side, time) };
    });
    const shape = (band: Band, k: number, lit: boolean) => {
      let value = data[band][k];
      if (lit) {
        const gain = heard[k].level * heard[k].filters[band];
        // The display is in dB (54 dB deep): a gain lowers it by its dB
        value = gain <= 0.0001 ? 0 : Math.max(0, value + ((20 * Math.log10(gain)) / 54));
      }
      const scale = band === 'low' ? 0.96 : band === 'mid' ? 0.7 : 0.42;
      return (value ** 1.8) * half * scale;
    };
    for (const lit of [false, true]) {
      for (const band of ['low', 'mid', 'high'] as const) {
        const [r, g, b] = BAND_COLORS[band];
        const alpha = lit ? 0.95 : 0.2;
        const fill = ctx.createLinearGradient(0, centre - half, 0, centre + half);
        fill.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha * 0.6})`);
        fill.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha})`);
        fill.addColorStop(1, `rgba(${r}, ${g}, ${b}, ${alpha * 0.6})`);
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(xAt(0), centre);
        for (let k = 0; k < count; k++) ctx.lineTo(xAt(k), centre - shape(band, k, lit));
        for (let k = count - 1; k >= 0; k--) ctx.lineTo(xAt(k), centre + shape(band, k, lit));
        ctx.closePath();
        ctx.fill();
      }
    }
  };
  lane(tl.out, layout.topY, 'out');
  lane(tl.in, layout.bottomY, 'in');

  // Downbeats: when they line up across the lanes, the beats are matched
  const bars = (times: number[], y: number, up: boolean) => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = dpr;
    ctx.beginPath();
    for (const time of times) {
      const px = Math.round(x(time)) + 0.5;
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + ((up ? -6 : 6) * dpr));
    }
    ctx.stroke();
  };
  bars(tl.outBars, layout.topY + half + (2 * dpr), false);
  bars(tl.inBars, layout.bottomY - half - (2 * dpr), true);

  // Volume curves
  const curve = (centre: number, pick: (l: { out: number; in: number }) => number, color: string) => {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * dpr;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8 * dpr;
    ctx.beginPath();
    const steps = Math.ceil(width / (2 * dpr));
    for (let i = 0; i <= steps; i++) {
      const px = (i / steps) * width;
      const time = tl.start + ((px / width) * (tl.end - tl.start));
      const y = centre + half - (pick(levelsAt(plan, time)) * half * 2);
      if (i === 0) ctx.moveTo(px, y);
      else ctx.lineTo(px, y);
    }
    ctx.stroke();
    ctx.restore();
  };
  curve(layout.topY, (l) => l.out, `rgba(${accent}, 0.95)`);
  curve(layout.bottomY, (l) => l.in, `rgba(${accent}, 0.95)`);

  // Labels inside the plot
  const label = (text: string, px: number, y: number, color: string, align: CanvasTextAlign = 'left') => {
    ctx.font = `600 ${10.5 * dpr}px 'YouTube Sans', Roboto, Arial, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(text, px, y);
  };
  ctx.strokeStyle = `rgba(${accent}, 0.7)`;
  ctx.lineWidth = dpr;
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  for (const px of [mixX, endX]) {
    ctx.beginPath();
    ctx.moveTo(Math.round(px) + 0.5, 0);
    ctx.lineTo(Math.round(px) + 0.5, layout.axisY - 4 * dpr);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  label(t('plugins.automix.ui.timeline.mix'), mixX + (5 * dpr), 4 * dpr, `rgba(${accent}, 1)`);
  if (tl.bassSwap) {
    label(
      t('plugins.automix.ui.timeline.bass'),
      x(tl.bassSwap[0]) + (4 * dpr),
      layout.bottomY - half + (4 * dpr),
      'rgba(140, 185, 255, 0.95)',
    );
  }
  if (tl.vocal !== undefined && tl.vocal > tl.start && tl.vocal < tl.end) {
    const px = x(tl.vocal);
    ctx.fillStyle = 'rgba(255, 120, 190, 0.95)';
    ctx.beginPath();
    ctx.arc(px, layout.bottomY + half - (4 * dpr), 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
    label(t('plugins.automix.ui.timeline.vocals'), px + (6 * dpr), layout.bottomY + half - (16 * dpr), 'rgba(255, 150, 205, 0.95)');
  }

  // Time axis, in seconds from the mix point
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = `500 ${10 * dpr}px 'YouTube Sans', Roboto, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const span = tl.end - tl.start;
  const every = span > 60 ? 10 : 5;
  for (
    let s = Math.ceil((tl.start - plan.mixOut) / every) * every;
    plan.mixOut + s <= tl.end;
    s += every
  ) {
    const px = x(plan.mixOut + s);
    ctx.fillRect(Math.round(px), layout.axisY - 2 * dpr, dpr, 4 * dpr);
    ctx.fillText(s === 0 ? '0' : `${s > 0 ? '+' : ''}${s}s`, px, layout.axisY + 4 * dpr);
  }
};

/** The "i" button next to Reorder / Mix now */
export const InfoButton = (props: { open: () => void; active: Accessor<boolean> }) => (
  <button
    aria-label={t('plugins.automix.ui.timeline.button')}
    aria-pressed={props.active()}
    class="automix-pill automix-info"
    onClick={() => props.open()}
    title={t('plugins.automix.ui.timeline.button')}
    type="button"
  >
    <svg aria-hidden="true" class="automix-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.01" />
    </svg>
  </button>
);

/** The transition, drawn live: both songs, what's heard of each, and where playback is */
export const TimelinePanel = (props: TimelineProps & { close: () => void }) => {
  let canvas!: HTMLCanvasElement;
  let wrap!: HTMLDivElement;
  const layer = document.createElement('canvas');
  const [timeline, setTimeline] = createSignal<TransitionTimeline | null>(props.timeline());
  const [clock, setClock] = createSignal('');
  let size = { width: 0, height: 0, dpr: 1 };
  let layout: Layout | null = null;
  let drawn: TransitionTimeline | null = null;

  const poll = window.setInterval(() => setTimeline(props.timeline()), 500);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') props.close();
  };
  document.addEventListener('keydown', onKey);

  const resize = () => {
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    size = { width: Math.round(rect.width * dpr), height: Math.round(rect.height * dpr), dpr };
    canvas.width = layer.width = size.width;
    canvas.height = layer.height = size.height;
    drawn = null;
  };

  let frame = 0;
  const render = () => {
    frame = requestAnimationFrame(render);
    const tl = timeline();
    const ctx = canvas.getContext('2d');
    if (!ctx || !size.width) return;
    ctx.clearRect(0, 0, size.width, size.height);
    if (!tl) return;
    if (drawn !== tl) {
      layout = layoutFor(tl, size.width, size.height);
      const layerCtx = layer.getContext('2d');
      if (layerCtx) drawStatic(layerCtx, tl, layout, size.dpr);
      drawn = tl;
    }
    if (!layout) return;
    ctx.drawImage(layer, 0, 0);

    const position = props.position();
    if (position === null) return;
    const { plan } = tl;
    const inside = Math.min(Math.max(position, tl.start), tl.end);
    const px = layout.x(inside);
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--automix-accent')
      .trim() || '255, 255, 255';
    // Already played: dimmed
    ctx.fillStyle = 'rgba(8, 8, 12, 0.38)';
    ctx.fillRect(0, 0, px, layout.axisY - 4 * size.dpr);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.shadowColor = `rgba(${accent}, 1)`;
    ctx.shadowBlur = 12 * size.dpr;
    ctx.lineWidth = 2 * size.dpr;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, layout.axisY - 4 * size.dpr);
    ctx.stroke();
    ctx.restore();

    const until = plan.mixOut - position;
    const after = position - (plan.mixOut + plan.duration);
    setClock(
      until > 0
        ? t('plugins.automix.ui.timeline.in', { time: formatClock(until) })
        : after < 0
          ? t('plugins.automix.ui.timeline.mixing', {
            percent: Math.round((-until / plan.duration) * 100),
          })
          : t('plugins.automix.ui.timeline.done'),
    );
  };

  onMount(() => {
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    frame = requestAnimationFrame(render);
    onCleanup(() => observer.disconnect());
  });
  onCleanup(() => {
    cancelAnimationFrame(frame);
    window.clearInterval(poll);
    document.removeEventListener('keydown', onKey);
  });
  createEffect(() => {
    // A new plan redraws the still parts
    if (timeline() !== drawn) drawn = null;
  });

  const plan = () => timeline()?.plan;
  const styleLabel = (p: TransitionPlan) => {
    const name = t(`plugins.automix.style.${p.style}`);
    const effect = p.effect === undefined ? undefined : effectName(p.effect);
    return effect ? `${name} · ${effect}` : name;
  };

  return (
    <div class="automix-tl-backdrop" onClick={(event) => event.target === event.currentTarget && props.close()}>
      <div aria-label={t('plugins.automix.ui.timeline.title')} aria-modal="true" class="automix-tl" role="dialog">
        <div
          aria-hidden="true"
          class="automix-tl-wash"
          style={{
            'background-image': [timeline()?.fromArt, timeline()?.toArt]
              .filter(Boolean)
              .map((url) => `url("${url}")`)
              .join(', '),
          }}
        />
        <header class="automix-tl-header">
          <div class="automix-tl-songs">
            <div class="automix-tl-song">
              <div class="automix-tl-art" style={{ 'background-image': timeline()?.fromArt ? `url("${timeline()?.fromArt}")` : 'none' }} />
              <div class="automix-tl-meta">
                <span class="automix-tl-kicker">{t('plugins.automix.ui.timeline.now-playing')}</span>
                <span class="automix-tl-name">{timeline()?.fromTitle ?? props.status().fromTitle ?? '—'}</span>
              </div>
            </div>
            <svg aria-hidden="true" class="automix-tl-arrow" viewBox="0 0 24 24">
              <path d="M4 12h15M14 7l5 5-5 5" />
            </svg>
            <div class="automix-tl-song">
              <div class="automix-tl-art" style={{ 'background-image': timeline()?.toArt ? `url("${timeline()?.toArt}")` : 'none' }} />
              <div class="automix-tl-meta">
                <span class="automix-tl-kicker">{t('plugins.automix.ui.timeline.up-next')}</span>
                <span class="automix-tl-name">{timeline()?.toTitle ?? props.status().toTitle ?? '—'}</span>
              </div>
            </div>
          </div>
          <button aria-label={t('plugins.automix.ui.timeline.close')} class="automix-tl-close" onClick={() => props.close()} type="button">
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <Show when={plan()}>
          {(current) => (
            <div class="automix-tl-chips">
              <span class="automix-tl-chip automix-tl-chip-style">{styleLabel(current())}</span>
              <span class="automix-tl-chip">{props.describe(current())}</span>
              <span class="automix-tl-chip automix-tl-clock">{clock()}</span>
            </div>
          )}
        </Show>
        <div class="automix-tl-plot" classList={{ 'automix-tl-plot-empty': !plan() }} ref={wrap}>
          <Show
            fallback={
              <div class="automix-tl-empty">
                <div class="automix-tl-empty-heading">{props.hint().heading}</div>
                <For each={props.hint().lines}>{(line) => <div>{line}</div>}</For>
              </div>
            }
            when={plan()}
          >
            <span class="automix-tl-lane-label automix-tl-lane-top">{t('plugins.automix.ui.timeline.now-playing')}</span>
            <span class="automix-tl-lane-label automix-tl-lane-bottom">{t('plugins.automix.ui.timeline.up-next')}</span>
          </Show>
          <canvas ref={canvas} />
        </div>
        <Show when={plan()}>
            <>
              <div class="automix-tl-legend">
                <span><i class="automix-tl-dot" style={{ background: 'rgb(70, 140, 255)' }} />{t('plugins.automix.ui.timeline.low')}</span>
                <span><i class="automix-tl-dot" style={{ background: 'rgb(255, 168, 64)' }} />{t('plugins.automix.ui.timeline.mid')}</span>
                <span><i class="automix-tl-dot" style={{ background: 'rgb(236, 240, 255)' }} />{t('plugins.automix.ui.timeline.high')}</span>
                <span><i class="automix-tl-line" />{t('plugins.automix.ui.timeline.level')}</span>
                <span><i class="automix-tl-tick" />{t('plugins.automix.ui.timeline.bars')}</span>
              </div>
              <div class="automix-tl-why">
                <For each={props.hint().lines}>{(line) => <div>{line}</div>}</For>
              </div>
            </>
        </Show>
      </div>
    </div>
  );
};
