/*
 * "Liquid glass" transition card shown while two songs are being mixed.
 *
 * A frosted-glass card rises above the player bar: the current song on the
 * left fades and blurs away while the next one on the right comes into focus,
 * and glowing liquid droplets flow between them (a gooey metaball effect: an
 * SVG blur + alpha threshold merges the blobs). Everything is timed to the
 * blend: a progress bar, a pulse on every beat when beat-matched, and a ripple
 * at the bass swap.
 *
 * Built with createElement / textContent and a constructed stylesheet, since
 * YouTube Music's Trusted Types policy blocks HTML strings.
 */

export type TrackInfo = { title: string; artist: string; art?: string };

export type TransitionVisual = {
  from: TrackInfo;
  to: TrackInfo;
  seconds: number; // length of the blend (wall time)
  label: string; // e.g. "Beat-matched · 122 → 126 BPM"
  beatSeconds?: number; // wall seconds per beat, if beat-matched
  swapAt?: number; // wall seconds into the blend when the bass swaps
};

const ROOT_CLASS = 'dj-tx';
const GOO_ID = 'dj-tx-goo';

const CSS = `
.dj-tx {
  --dj-dur: 8s;
  --dj-beat: 0.5s;
  --dj-swap: 4s;
  position: fixed;
  left: 50%;
  bottom: 96px;
  z-index: 2147483000;
  width: min(620px, calc(100vw - 48px));
  pointer-events: none;
  transform: translateX(-50%) translateY(18px) scale(0.94);
  opacity: 0;
  filter: blur(10px);
  transition:
    opacity 0.6s ease,
    filter 0.6s ease,
    transform 0.8s cubic-bezier(0.2, 0.9, 0.25, 1.15);
}
.dj-tx.show {
  opacity: 1;
  filter: none;
  transform: translateX(-50%) translateY(0) scale(1);
}
.dj-tx.hide {
  opacity: 0;
  filter: blur(12px);
  transform: translateX(-50%) translateY(8px) scale(0.97);
  transition-duration: 0.7s;
}
.dj-tx-glass {
  position: relative;
  overflow: hidden;
  padding: 16px 20px 18px;
  border-radius: 30px;
  color: #fff;
  font-family: inherit;
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(255, 255, 255, 0.24), transparent 55%),
    radial-gradient(120% 140% at 100% 100%, rgba(170, 140, 255, 0.18), transparent 60%),
    linear-gradient(140deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.04));
  -webkit-backdrop-filter: blur(30px) saturate(190%) brightness(1.06);
  backdrop-filter: blur(30px) saturate(190%) brightness(1.06);
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.6),
    inset 0 -1px 1px rgba(255, 255, 255, 0.12),
    inset 0 0 30px rgba(255, 255, 255, 0.05),
    0 28px 80px rgba(0, 0, 0, 0.5),
    0 2px 10px rgba(0, 0, 0, 0.25);
}
.dj-tx.beat .dj-tx-glass {
  animation: dj-tx-beat var(--dj-beat) cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
}
.dj-tx-glass::before {
  content: '';
  position: absolute;
  inset: -50% -70%;
  background: linear-gradient(
    105deg,
    transparent 42%,
    rgba(255, 255, 255, 0.28) 50%,
    transparent 58%
  );
  transform: translateX(-55%);
  animation: dj-tx-sheen var(--dj-dur) ease-in-out forwards;
}
.dj-tx-glass::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), transparent 38%);
  pointer-events: none;
}
.dj-tx-row {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 14px;
}
.dj-tx-side {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.dj-tx-side.to {
  flex-direction: row-reverse;
  text-align: right;
  opacity: 0.35;
  filter: blur(2px);
  transform: scale(0.94);
  animation: dj-tx-in var(--dj-dur) cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
.dj-tx-side.from {
  animation: dj-tx-out var(--dj-dur) cubic-bezier(0.4, 0, 0.6, 1) forwards;
}
.dj-tx-art {
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 16px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.12);
  box-shadow:
    0 10px 24px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.22);
}
.dj-tx-text {
  min-width: 0;
}
.dj-tx-title,
.dj-tx-artist {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.dj-tx-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.dj-tx-artist {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.7;
}
.dj-tx-center {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.dj-tx-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.75;
  white-space: nowrap;
}
/* Tinted glass: the two covers, heavily blurred, melting into each other. */
.dj-tx-tint {
  position: absolute;
  top: -40%;
  left: -20%;
  width: 140%;
  height: 180%;
  object-fit: cover;
  filter: blur(44px) saturate(175%);
  pointer-events: none;
}
.dj-tx-tint.from {
  opacity: 0.5;
  animation: dj-tx-tint-out var(--dj-dur) ease-in-out forwards;
}
.dj-tx-tint.to {
  opacity: 0;
  animation: dj-tx-tint-in var(--dj-dur) ease-in-out forwards;
}
/* The glass channel the liquid flows through. */
.dj-tx-liquid-wrap {
  position: relative;
  width: 156px;
  height: 46px;
}
.dj-tx-liquid-wrap::before {
  content: '';
  position: absolute;
  top: 9px;
  right: -4px;
  bottom: 9px;
  left: -4px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.07);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.45),
    inset 0 -1px 1px rgba(255, 255, 255, 0.2),
    0 1px 0 rgba(255, 255, 255, 0.08);
}
.dj-tx-liquid {
  --dj-travel: 122px;
  position: relative;
  width: 100%;
  height: 100%;
  filter: url(#${GOO_ID});
}
.dj-tx-blob {
  position: absolute;
  top: 50%;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #ffffff, #c4b5ff 40%, #6fd3ff 100%);
}
.dj-tx-blob.a,
.dj-tx-blob.b {
  width: 34px;
  height: 34px;
  margin-top: -17px;
}
.dj-tx-blob.a {
  left: 0;
  animation: dj-tx-shrink var(--dj-dur) cubic-bezier(0.5, 0, 0.7, 1) forwards;
}
.dj-tx-blob.b {
  right: 0;
  transform: scale(0.3);
  animation: dj-tx-grow var(--dj-dur) cubic-bezier(0.3, 0, 0.5, 1) forwards;
}
/* A steady stream: four droplets, one leaving on every beat. */
.dj-tx-blob.drop {
  left: 8px;
  width: 18px;
  height: 18px;
  margin-top: -9px;
  opacity: 0;
  animation: dj-tx-travel calc(var(--dj-beat) * 4) cubic-bezier(0.55, 0, 0.35, 1) infinite;
}
.dj-tx-blob.drop.d2 {
  width: 15px;
  height: 15px;
  margin-top: -7.5px;
  animation-delay: var(--dj-beat);
}
.dj-tx-blob.drop.d3 {
  width: 13px;
  height: 13px;
  margin-top: -6.5px;
  animation-delay: calc(var(--dj-beat) * 2);
}
.dj-tx-blob.drop.d4 {
  width: 16px;
  height: 16px;
  margin-top: -8px;
  animation-delay: calc(var(--dj-beat) * 3);
}
.dj-tx-ripple {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 46px;
  height: 46px;
  margin: -23px 0 0 -23px;
  border-radius: 50%;
  border: 2px solid rgba(200, 185, 255, 0.9);
  opacity: 0;
  animation: dj-tx-ripple 1.1s ease-out var(--dj-swap) 1 forwards;
}
.dj-tx-bar {
  position: relative;
  z-index: 1;
  height: 4px;
  margin-top: 14px;
  overflow: hidden;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.14);
}
.dj-tx-fill {
  position: absolute;
  inset: 0;
  transform: scaleX(0);
  transform-origin: left center;
  background: linear-gradient(90deg, #6fd3ff, #c4b5ff 55%, #ffb3dd);
  box-shadow: 0 0 14px rgba(190, 160, 255, 0.85);
  animation: dj-tx-fill var(--dj-dur) linear forwards;
}
@keyframes dj-tx-sheen { to { transform: translateX(55%); } }
@keyframes dj-tx-out {
  to { opacity: 0.35; filter: blur(2px); transform: scale(0.94); }
}
@keyframes dj-tx-in {
  to { opacity: 1; filter: blur(0); transform: scale(1); }
}
@keyframes dj-tx-shrink { to { transform: scale(0.3); } }
@keyframes dj-tx-grow { to { transform: scale(1); } }
@keyframes dj-tx-travel {
  0% { opacity: 0; transform: translateX(0) scale(0.6); }
  12% { opacity: 1; }
  50% { transform: translateX(calc(var(--dj-travel) / 2)) scale(1.3, 0.8); }
  88% { opacity: 1; }
  100% { opacity: 0; transform: translateX(var(--dj-travel)) scale(0.6); }
}
@keyframes dj-tx-tint-out { to { opacity: 0; } }
@keyframes dj-tx-tint-in { to { opacity: 0.5; } }
@keyframes dj-tx-ripple {
  0% { opacity: 0.95; transform: scale(0.4); }
  100% { opacity: 0; transform: scale(3.2); }
}
@keyframes dj-tx-fill { to { transform: scaleX(1); } }
@keyframes dj-tx-beat {
  0% { transform: scale(1.014); }
  100% { transform: scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .dj-tx, .dj-tx * { animation-duration: 0.01s !important; animation-iteration-count: 1 !important; }
}
`;

let sheet: CSSStyleSheet | null = null;
let current: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | undefined;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The gooey filter: blur the blobs together, then sharpen the alpha edge. */
const ensureGooFilter = () => {
  if (document.getElementById(GOO_ID)) return;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.setAttribute('id', GOO_ID);
  const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
  blur.setAttribute('in', 'SourceGraphic');
  blur.setAttribute('stdDeviation', '6');
  blur.setAttribute('result', 'blur');
  const matrix = document.createElementNS(SVG_NS, 'feColorMatrix');
  matrix.setAttribute('in', 'blur');
  matrix.setAttribute('mode', 'matrix');
  matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10');
  matrix.setAttribute('result', 'goo');
  const composite = document.createElementNS(SVG_NS, 'feComposite');
  composite.setAttribute('in', 'SourceGraphic');
  composite.setAttribute('in2', 'goo');
  composite.setAttribute('operator', 'atop');
  filter.append(blur, matrix, composite);
  svg.append(filter);
  document.body.append(svg);
};

const ensureStyles = () => {
  if (sheet) return;
  sheet = new CSSStyleSheet();
  sheet.replaceSync(CSS);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
};

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const side = (track: TrackInfo, which: 'from' | 'to') => {
  const wrap = el('div', `dj-tx-side ${which}`);
  const art = el('img', 'dj-tx-art');
  art.alt = '';
  art.decoding = 'async';
  if (track.art) art.src = track.art;
  const text = el('div', 'dj-tx-text');
  text.append(
    el('div', 'dj-tx-title', track.title),
    el('div', 'dj-tx-artist', track.artist),
  );
  wrap.append(art, text);
  return wrap;
};

/** A cover, blurred into a color wash behind the glass. */
const tint = (track: TrackInfo, which: 'from' | 'to') => {
  const img = el('img', `dj-tx-tint ${which}`);
  img.alt = '';
  img.decoding = 'async';
  if (track.art) img.src = track.art;
  else img.style.display = 'none';
  return img;
};

/** Cards fading out, each removed by its own timer (or right away). */
const fading = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

const removeFading = () => {
  for (const [node, removal] of fading) {
    clearTimeout(removal);
    node.remove();
  }
  fading.clear();
};

/**
 * Hide the card: fade it out, or remove it now (`immediately`, e.g. the plugin
 * is stopping or a new card replaces it — cards still fading go too).
 */
export const hideTransitionVisual = (immediately = false) => {
  clearTimeout(hideTimer);
  const node = current;
  current = null;
  if (immediately) {
    node?.remove();
    removeFading();
    return;
  }
  if (!node) return;
  node.classList.add('hide');
  node.classList.remove('show');
  fading.set(
    node,
    setTimeout(() => {
      node.remove();
      fading.delete(node);
    }, 800),
  );
};

export const showTransitionVisual = (visual: TransitionVisual) => {
  hideTransitionVisual(true);
  ensureStyles();
  ensureGooFilter();

  const root = el('div', ROOT_CLASS);
  root.setAttribute('role', 'status');
  root.setAttribute('aria-label', `Mixing into ${visual.to.title}`);
  root.style.setProperty('--dj-dur', `${visual.seconds}s`);
  if (visual.beatSeconds) {
    root.style.setProperty('--dj-beat', `${visual.beatSeconds}s`);
    root.classList.add('beat');
  }
  root.style.setProperty('--dj-swap', `${visual.swapAt ?? visual.seconds / 2}s`);

  const glass = el('div', 'dj-tx-glass');
  const row = el('div', 'dj-tx-row');

  const center = el('div', 'dj-tx-center');
  const liquid = el('div', 'dj-tx-liquid');
  liquid.append(
    el('div', 'dj-tx-blob a'),
    el('div', 'dj-tx-blob drop'),
    el('div', 'dj-tx-blob drop d2'),
    el('div', 'dj-tx-blob drop d3'),
    el('div', 'dj-tx-blob drop d4'),
    el('div', 'dj-tx-blob b'),
  );
  const liquidWrap = el('div', 'dj-tx-liquid-wrap');
  liquidWrap.append(liquid, el('div', 'dj-tx-ripple'));
  center.append(el('div', 'dj-tx-label', visual.label), liquidWrap);

  row.append(side(visual.from, 'from'), center, side(visual.to, 'to'));
  const bar = el('div', 'dj-tx-bar');
  bar.append(el('div', 'dj-tx-fill'));
  glass.append(tint(visual.from, 'from'), tint(visual.to, 'to'), row, bar);
  root.append(glass);
  document.body.append(root);
  current = root;

  // Next frame, so the entry transition runs.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('show')));
  hideTimer = setTimeout(() => hideTransitionVisual(), (visual.seconds + 0.6) * 1000);
};

/** Remove everything this module added (plugin disabled). */
export const destroyTransitionVisual = () => {
  hideTransitionVisual(true);
  document.getElementById(GOO_ID)?.closest('svg')?.remove();
  if (sheet) {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    sheet = null;
  }
};
