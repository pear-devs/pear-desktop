import type { RendererContext } from '@/types/contexts';

import type { StatsData, StatsRange } from './types';

let ipc: RendererContext<{ enabled: boolean }>['ipc'] | null = null;
let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

const OVERLAY_LOCK_CLASS = 'music-stats-overlay-open';

const isVideoId = (id?: string | null) =>
  !!id && /^[a-zA-Z0-9_-]{11}$/.test(id);

// ─── Lifecycle ─────────────────────────────────────────────────────────
// All playback tracking happens in the main process via the song-info
// provider; the renderer is purely UI.

export function start(context: RendererContext<{ enabled: boolean }>) {
  ipc = context.ipc;
  setupIpcListeners();
}

export function stop() {
  teardownIpcListeners();
  closeOverlay();
  ipc = null;
}

export default start;

function setupIpcListeners() {
  ipc?.on('music-stats:show-wrapped', () => {
    showWrapped().catch(console.error);
  });

  ipc?.on('music-stats:show-dashboard', () => {
    showDashboard().catch(console.error);
  });

  ipc?.on('music-stats:export', async () => {
    try {
      const data = await ipc?.invoke('music-stats:export-data');
      if (!data) {
        showNotification('Nothing to export yet');
        return;
      }
      const saved = await ipc?.invoke('music-stats:save-export-file', data);
      if (saved) showNotification('Stats exported successfully');
    } catch (error) {
      console.error('[Music Stats] Export failed:', error);
      showNotification('Failed to export stats');
    }
  });

  ipc?.on('music-stats:import', async () => {
    try {
      const data = await ipc?.invoke('music-stats:load-import-file');
      if (data) {
        const result = (await ipc?.invoke('music-stats:import-data', data)) as {
          added: number;
        } | null;
        showNotification(
          result
            ? `Imported ${result.added} new play${result.added === 1 ? '' : 's'}`
            : 'Import failed',
        );
      }
    } catch (error) {
      console.error('[Music Stats] Import failed:', error);
      showNotification('Failed to import stats');
    }
  });

  ipc?.on('music-stats:notify', (message: string) => {
    showNotification(String(message));
  });

  ipc?.on('music-stats:history-sync', async () => {
    try {
      showNotification('Syncing plays from other devices…');
      const result = (await ipc?.invoke('music-stats:history-sync')) as {
        message?: string;
      } | null;
      if (result?.message) showNotification(result.message);
    } catch (error) {
      console.error('[Music Stats] Device sync failed:', error);
      showNotification('Device sync failed');
    }
  });

  ipc?.on('music-stats:import-takeout', async () => {
    try {
      const data = await ipc?.invoke('music-stats:load-import-file');
      if (!data) return;
      showNotification('Importing Takeout history…');
      const result = (await ipc?.invoke(
        'music-stats:import-takeout',
        data,
      )) as { message?: string } | null;
      if (result?.message) showNotification(result.message);
    } catch (error) {
      console.error('[Music Stats] Takeout import failed:', error);
      showNotification('Takeout import failed');
    }
  });

  for (const action of ['connect', 'sync', 'disconnect'] as const) {
    ipc?.on(`music-stats:drive-${action}`, async () => {
      try {
        const result = (await ipc?.invoke(`music-stats:drive-${action}`)) as {
          message?: string;
        } | null;
        if (result?.message) showNotification(result.message);
      } catch (error) {
        console.error(`[Music Stats] Drive ${action} failed:`, error);
        showNotification(`Google Drive ${action} failed`);
      }
    });
  }
}

function teardownIpcListeners() {
  for (const channel of [
    'music-stats:show-wrapped',
    'music-stats:show-dashboard',
    'music-stats:export',
    'music-stats:import',
    'music-stats:notify',
    'music-stats:history-sync',
    'music-stats:import-takeout',
    'music-stats:drive-connect',
    'music-stats:drive-sync',
    'music-stats:drive-disconnect',
  ]) {
    ipc?.removeAllListeners(channel);
  }
}

// ─── Overlay management ────────────────────────────────────────────────

function lockScroll() {
  document.documentElement.classList.add(OVERLAY_LOCK_CLASS);
  document.body.classList.add(OVERLAY_LOCK_CLASS);
}

function unlockScroll() {
  document.documentElement.classList.remove(OVERLAY_LOCK_CLASS);
  document.body.classList.remove(OVERLAY_LOCK_CLASS);
}

function closeOverlay() {
  document.getElementById('music-stats-overlay')?.remove();
  unlockScroll();
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
}

function openOverlay(viewClass: string): HTMLElement {
  closeOverlay();
  const overlay = document.createElement('div');
  overlay.id = 'music-stats-overlay';
  overlay.className = `music-stats-overlay ${viewClass}`;
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeOverlay();
  });
  lockScroll();
  document.body.appendChild(overlay);
  return overlay;
}

function bindOverlayKeys(handler: (event: KeyboardEvent) => void) {
  keydownHandler = handler;
  document.addEventListener('keydown', handler);
}

// ─── Shared helpers ────────────────────────────────────────────────────

async function fetchStats(range: StatsRange): Promise<StatsData | null> {
  if (!ipc) return null;
  try {
    return (await ipc.invoke('music-stats:get-stats', range)) as StatsData;
  } catch (error) {
    console.error('[Music Stats] Failed to fetch stats:', error);
    return null;
  }
}

/** Escapes text for safe use in both HTML content and attribute values. */
function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch],
  );
}

/** Only allow https images from YouTube/Google CDNs — anything else is dropped. */
function safeImageUrl(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname;
    const allowed =
      host === 'i.ytimg.com' ||
      host === 'music.youtube.com' ||
      host === 'www.gstatic.com' ||
      host.endsWith('.ggpht.com') ||
      host.endsWith('.googleusercontent.com');
    return allowed ? url : '';
  } catch {
    return '';
  }
}

/** Cover/avatar cell: image when we have a safe URL, initial letter otherwise. */
function thumbHtml(imageUrl: string | undefined, name: string): string {
  const safe = safeImageUrl(imageUrl);
  if (safe) {
    return `<img src="${escapeHtml(safe)}" alt="" loading="lazy" />`;
  }
  return `<span>${escapeHtml((name || '?').charAt(0).toUpperCase())}</span>`;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

/** Format a local YYYY-MM-DD key without UTC parsing (which shifts days). */
function formatDateKey(key: string, withYear = true): string {
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
}

function formatMinutes(minutes: number): string {
  if (minutes >= 600) {
    return `${(minutes / 60).toFixed(0)} h`;
  }
  if (minutes >= 100) {
    return `${(minutes / 60).toFixed(1)} h`;
  }
  return `${minutes} min`;
}

async function playSong(videoId: string) {
  if (!ipc || !isVideoId(videoId)) return;
  try {
    const ok = await ipc.invoke('music-stats:play-song', videoId);
    showNotification(ok ? 'Playing next' : 'Could not queue this song');
  } catch {
    showNotification('Could not queue this song');
  }
}

function bindPlayButtons(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-play-id]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const id = btn.dataset.playId;
      if (id) playSong(id).catch(console.error);
    });
  });
}

function showNotification(message: string) {
  const notification = document.createElement('div');
  notification.className = 'music-stats-notification';
  notification.textContent = message;
  document.body.appendChild(notification);

  requestAnimationFrame(() => notification.classList.add('show'));

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// ─── Charts ────────────────────────────────────────────────────────────
// Single-series marks in one accent hue; identity comes from the card
// title, values from the hover tooltip. Grid and axes stay recessive.

interface ChartPoint {
  x: number;
  y: number;
  tip: string;
}

function chartShell(inner: string, width: number, height: number): string {
  return `
    <div class="msd-chart">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">
        ${inner}
      </svg>
      <div class="msd-tooltip" aria-hidden="true"></div>
    </div>
  `;
}

function gridLines(
  width: number,
  height: number,
  pad: { t: number; r: number; b: number; l: number },
  maxValue: number,
): string {
  const lines: string[] = [];
  for (const frac of [0, 0.5, 1]) {
    const y = pad.t + (1 - frac) * (height - pad.t - pad.b);
    lines.push(
      `<line class="msd-grid" x1="${pad.l}" y1="${y.toFixed(1)}" x2="${width - pad.r}" y2="${y.toFixed(1)}" />`,
      `<text class="msd-axis-label" x="${pad.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${Math.round(maxValue * frac)}</text>`,
    );
  }
  return lines.join('');
}

/** Hourly listening: a 2px line with a soft area fill and hover dots. */
function createClockChart(hourlyData: number[]): string {
  const hasActivity = hourlyData.some((m) => m > 0);
  if (!hasActivity) {
    return '<div class="msd-chart-empty">No listening activity in this period yet</div>';
  }

  const width = 640;
  const height = 220;
  const pad = { t: 16, r: 12, b: 28, l: 40 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const max = Math.max(...hourlyData, 1);

  const points: ChartPoint[] = hourlyData.map((minutes, hour) => ({
    x: pad.l + (hour / 23) * plotW,
    y: pad.t + (1 - minutes / max) * plotH,
    tip: `${`${hour}`.padStart(2, '0')}:00 – ${`${(hour + 1) % 24}`.padStart(2, '0')}:00 · ${Math.round(minutes)} min`,
  }));

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');
  const baseline = height - pad.b;
  const area = `${line} L ${points[points.length - 1].x.toFixed(1)} ${baseline} L ${points[0].x.toFixed(1)} ${baseline} Z`;

  const dots = points
    .map(
      (p, hour) => `
        <circle class="msd-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"
          style="display:${hourlyData[hour] > 0 ? '' : 'none'}"></circle>
        <circle class="msd-hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12"
          data-tip="${escapeHtml(p.tip)}"
          data-x="${(p.x / width).toFixed(4)}" data-y="${(p.y / height).toFixed(4)}"></circle>
      `,
    )
    .join('');

  const ticks = [0, 6, 12, 18, 23]
    .map((hour) => {
      const x = pad.l + (hour / 23) * plotW;
      return `<text class="msd-axis-label" x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle">${`${hour}`.padStart(2, '0')}:00</text>`;
    })
    .join('');

  return chartShell(
    `
      <defs>
        <linearGradient id="msd-area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--msd-accent)" stop-opacity="0.28" />
          <stop offset="100%" stop-color="var(--msd-accent)" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      ${gridLines(width, height, pad, max)}
      <path class="msd-area" d="${area}" fill="url(#msd-area-fill)" />
      <path class="msd-line" d="${line}" />
      ${dots}
      ${ticks}
    `,
    width,
    height,
  );
}

/** Daily listening: thin bars, rounded data-ends, 2px gaps, hover tooltips. */
function createTrendChart(trend: StatsData['dailyTrend']): string {
  if (!trend.length || trend.every((d) => d.minutes === 0)) {
    return '<div class="msd-chart-empty">No listening activity in this period yet</div>';
  }

  const width = 640;
  const height = 220;
  const pad = { t: 16, r: 12, b: 28, l: 40 };
  const plotW = width - pad.l - pad.r;
  const plotH = height - pad.t - pad.b;
  const max = Math.max(...trend.map((d) => d.minutes), 1);
  const n = trend.length;
  const gap = 2;
  const barW = Math.max(2, plotW / n - gap);
  const radius = Math.min(4, barW / 2);
  const baseline = height - pad.b;

  const bars = trend
    .map((day, i) => {
      const x = pad.l + (i / n) * plotW + gap / 2;
      const h = (day.minutes / max) * plotH;
      const y = baseline - h;
      const tip = `${formatDateKey(day.date, false)} · ${day.minutes} min`;
      const centerX = x + barW / 2;
      // Bars are anchored flat on the baseline with rounded data-ends on top.
      const bar =
        day.minutes > 0
          ? `<path class="msd-bar" d="M ${x.toFixed(1)} ${baseline}
               V ${(y + radius).toFixed(1)}
               Q ${x.toFixed(1)} ${y.toFixed(1)} ${(x + radius).toFixed(1)} ${y.toFixed(1)}
               H ${(x + barW - radius).toFixed(1)}
               Q ${(x + barW).toFixed(1)} ${y.toFixed(1)} ${(x + barW).toFixed(1)} ${(y + radius).toFixed(1)}
               V ${baseline} Z" />`
          : `<rect class="msd-bar-zero" x="${x.toFixed(1)}" y="${baseline - 2}" width="${barW.toFixed(1)}" height="2" />`;
      return `
        ${bar}
        <rect class="msd-hit" x="${x.toFixed(1)}" y="${pad.t}" width="${barW.toFixed(1)}" height="${plotH}"
          data-tip="${escapeHtml(tip)}"
          data-x="${(centerX / width).toFixed(4)}" data-y="${(Math.max(y, pad.t) / height).toFixed(4)}"></rect>
      `;
    })
    .join('');

  const tickEvery = n > 10 ? 7 : 1;
  const ticks = trend
    .map((day, i) => {
      const isLast = i === n - 1;
      if (i % tickEvery !== 0 && !isLast) return '';
      const x = pad.l + (i / n) * plotW + gap / 2 + barW / 2;
      return `<text class="msd-axis-label" x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle">${escapeHtml(formatDateKey(day.date, false))}</text>`;
    })
    .join('');

  return chartShell(
    `${gridLines(width, height, pad, max)}${bars}${ticks}`,
    width,
    height,
  );
}

function bindChartTooltips(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.msd-chart').forEach((chart) => {
    const svg = chart.querySelector<SVGSVGElement>('svg');
    const tooltip = chart.querySelector<HTMLElement>('.msd-tooltip');
    if (!svg || !tooltip) return;

    svg.addEventListener('mousemove', (event) => {
      const target = (event.target as Element | null)?.closest<SVGElement>(
        '.msd-hit',
      );
      if (!target) {
        tooltip.classList.remove('show');
        return;
      }
      const rect = svg.getBoundingClientRect();
      tooltip.textContent = target.dataset.tip ?? '';
      tooltip.style.left = `${rect.width * Number(target.dataset.x || 0)}px`;
      tooltip.style.top = `${rect.height * Number(target.dataset.y || 0) - 10}px`;
      tooltip.classList.add('show');
    });

    svg.addEventListener('mouseleave', () => {
      tooltip.classList.remove('show');
    });
  });
}

// ─── Dashboard ─────────────────────────────────────────────────────────

const RANGE_LABELS: Record<StatsRange, string> = {
  week: '7 days',
  month: '30 days',
  year: 'This year',
  all: 'All time',
};

async function showDashboard() {
  const initialRange: StatsRange = 'month';
  const stats = await fetchStats(initialRange);
  if (!stats) {
    showNotification('Stats are not ready yet — try again in a moment');
    return;
  }

  const overlay = openOverlay('dashboard-view');
  overlay.innerHTML = `
    <div class="dashboard-container">
      <header class="dashboard-header">
        <div>
          <div class="dashboard-eyebrow">Music Stats</div>
          <h1 class="dashboard-title">Your listening</h1>
        </div>
        <div class="dashboard-controls">
          <div class="range-tabs" role="tablist" aria-label="Time range">
            ${(Object.keys(RANGE_LABELS) as StatsRange[])
              .map(
                (range) => `
                  <button class="range-tab${range === initialRange ? ' active' : ''}"
                    role="tab" aria-selected="${range === initialRange}"
                    data-range="${range}">${RANGE_LABELS[range]}</button>
                `,
              )
              .join('')}
          </div>
          <button class="overlay-close" aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
      </header>
      <main class="dashboard-body"></main>
    </div>
  `;

  const body = overlay.querySelector<HTMLElement>('.dashboard-body');
  const renderBody = (data: StatsData) => {
    body.innerHTML = renderDashboardBody(data);
    bindChartTooltips(body);
    bindPlayButtons(body);
  };
  renderBody(stats);

  overlay
    .querySelector('.overlay-close')
    ?.addEventListener('click', closeOverlay);

  overlay.querySelectorAll<HTMLElement>('.range-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      const range = tab.dataset.range as StatsRange;
      const next = await fetchStats(range);
      if (!next) return;
      overlay.querySelectorAll('.range-tab').forEach((t) => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      renderBody(next);
    });
  });

  bindOverlayKeys((event) => {
    if (event.key === 'Escape') closeOverlay();
  });
}

function renderDashboardBody(stats: StatsData): string {
  if (stats.totalMinutes === 0 && stats.totalPlays === 0) {
    return `
      <div class="msd-empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
        <h2>Nothing here yet</h2>
        <p>Play some music and your stats will start filling in.
        Songs count after 30 seconds of listening.</p>
      </div>
    `;
  }

  const streakLabel =
    stats.currentStreak === 1 ? '1 day' : `${stats.currentStreak} days`;

  const tiles = [
    { label: 'Minutes', value: formatNumber(stats.totalMinutes) },
    { label: 'Plays', value: formatNumber(stats.totalPlays) },
    { label: 'Songs', value: formatNumber(stats.uniqueSongs) },
    { label: 'Artists', value: formatNumber(stats.uniqueArtists) },
    { label: 'Streak', value: streakLabel },
    ...(stats.peakListeningDay
      ? [
          {
            label: 'Peak day',
            value: formatMinutes(stats.peakListeningDay.minutes),
            sub: formatDateKey(stats.peakListeningDay.date),
          },
        ]
      : []),
  ];

  const songRows = stats.topSongs
    .map(
      (song, idx) => `
        <li class="list-row">
          <span class="list-rank">${idx + 1}</span>
          <span class="list-thumb square">${thumbHtml(song.imageUrl, song.title)}</span>
          <span class="list-text">
            <span class="list-title">${escapeHtml(song.title)}</span>
            <span class="list-sub">${escapeHtml(song.artist)}</span>
          </span>
          <span class="list-stat">
            <span class="list-stat-strong">${formatNumber(song.plays)} plays</span>
            <span class="list-stat-sub">${formatMinutes(song.minutes)}</span>
          </span>
          ${
            isVideoId(song.id)
              ? `<button class="list-play" data-play-id="${escapeHtml(song.id)}" aria-label="Play ${escapeHtml(song.title)}">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>`
              : ''
          }
        </li>
      `,
    )
    .join('');

  const artistRows = stats.topArtists
    .map(
      (artist, idx) => `
        <li class="list-row">
          <span class="list-rank">${idx + 1}</span>
          <span class="list-thumb round">${thumbHtml(artist.imageUrl, artist.name)}</span>
          <span class="list-text">
            <span class="list-title">${escapeHtml(artist.name)}</span>
            <span class="list-sub">${formatNumber(artist.plays)} plays</span>
          </span>
          <span class="list-stat">
            <span class="list-stat-strong">${formatMinutes(artist.minutes)}</span>
          </span>
        </li>
      `,
    )
    .join('');

  const skippedRows = stats.skipStats
    .slice(0, 5)
    .map(
      (song) => `
        <li class="list-row">
          <span class="list-thumb square">${thumbHtml(song.imageUrl, song.title)}</span>
          <span class="list-text">
            <span class="list-title">${escapeHtml(song.title)}</span>
            <span class="list-sub">${escapeHtml(song.artist)}</span>
          </span>
          <span class="list-stat">
            <span class="list-stat-strong">${formatNumber(song.skips)} skip${song.skips === 1 ? '' : 's'}</span>
            <span class="list-stat-sub">${formatNumber(song.plays)} full play${song.plays === 1 ? '' : 's'}</span>
          </span>
        </li>
      `,
    )
    .join('');

  return `
    <section class="stat-tiles">
      ${tiles
        .map(
          (tile) => `
            <div class="stat-tile">
              <div class="stat-tile-label">${escapeHtml(tile.label)}</div>
              <div class="stat-tile-value">${escapeHtml(tile.value)}</div>
              ${'sub' in tile && tile.sub ? `<div class="stat-tile-sub">${escapeHtml(tile.sub)}</div>` : ''}
            </div>
          `,
        )
        .join('')}
    </section>

    <section class="dashboard-grid">
      <div class="dashboard-card span-2">
        <h3 class="card-title">Daily listening <span class="card-title-sub">minutes per day</span></h3>
        ${createTrendChart(stats.dailyTrend)}
      </div>

      <div class="dashboard-card">
        <h3 class="card-title">Top songs</h3>
        ${songRows ? `<ol class="msd-list">${songRows}</ol>` : '<div class="msd-chart-empty">No plays in this period</div>'}
      </div>

      <div class="dashboard-card">
        <h3 class="card-title">Top artists</h3>
        ${artistRows ? `<ol class="msd-list">${artistRows}</ol>` : '<div class="msd-chart-empty">No plays in this period</div>'}
      </div>

      <div class="dashboard-card span-2">
        <h3 class="card-title">Time of day <span class="card-title-sub">minutes per hour</span></h3>
        ${createClockChart(stats.listeningClock)}
      </div>

      ${
        skippedRows
          ? `
        <div class="dashboard-card span-2">
          <h3 class="card-title">Most skipped</h3>
          <ol class="msd-list two-col">${skippedRows}</ol>
        </div>
      `
          : ''
      }
    </section>
  `;
}

// ─── Wrapped ───────────────────────────────────────────────────────────

async function showWrapped() {
  const stats = await fetchStats('year');
  if (!stats) {
    showNotification('Stats are not ready yet — try again in a moment');
    return;
  }
  if (stats.totalPlays === 0) {
    showNotification('Not enough listening this year for a Wrapped yet');
    return;
  }
  createWrappedView(stats);
}

function createWrappedView(stats: StatsData) {
  const overlay = openOverlay('wrapped-view');
  const slides = createWrappedSlides(stats);
  let currentSlide = 0;

  function renderSlide(index: number) {
    currentSlide = Math.max(0, Math.min(slides.length - 1, index));
    overlay.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'wrapped-container';
    container.innerHTML = slides[currentSlide];

    const navigation = document.createElement('nav');
    navigation.className = 'wrapped-navigation';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'wrapped-nav-btn';
    prevBtn.textContent = '← Back';
    prevBtn.disabled = currentSlide === 0;
    prevBtn.onclick = () => renderSlide(currentSlide - 1);
    navigation.appendChild(prevBtn);

    const dots = document.createElement('div');
    dots.className = 'wrapped-dots';
    slides.forEach((_, idx) => {
      const dot = document.createElement('span');
      dot.className = `wrapped-dot${idx === currentSlide ? ' active' : ''}`;
      dots.appendChild(dot);
    });
    navigation.appendChild(dots);

    if (currentSlide < slides.length - 1) {
      const nextBtn = document.createElement('button');
      nextBtn.className = 'wrapped-nav-btn primary';
      nextBtn.textContent = 'Next →';
      nextBtn.onclick = () => renderSlide(currentSlide + 1);
      navigation.appendChild(nextBtn);
    } else {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'wrapped-nav-btn primary';
      closeBtn.textContent = 'Close';
      closeBtn.onclick = closeOverlay;
      navigation.appendChild(closeBtn);
    }

    const closeIcon = document.createElement('button');
    closeIcon.className = 'overlay-close wrapped-close';
    closeIcon.setAttribute('aria-label', 'Close');
    closeIcon.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    closeIcon.onclick = closeOverlay;

    overlay.appendChild(closeIcon);
    overlay.appendChild(container);
    overlay.appendChild(navigation);

    bindPlayButtons(container);
    bindObsessionsCarousel(container);

    requestAnimationFrame(() => container.classList.add('slide-in'));
  }

  bindOverlayKeys((event) => {
    if (event.key === 'Escape') closeOverlay();
    else if (event.key === 'ArrowRight') renderSlide(currentSlide + 1);
    else if (event.key === 'ArrowLeft') renderSlide(currentSlide - 1);
  });

  renderSlide(0);
}

function bindObsessionsCarousel(container: HTMLElement) {
  const obsessions = container.querySelector<HTMLElement>(
    '.wrapped-obsessions',
  );
  if (!obsessions) return;

  const totalMonths = Number(obsessions.dataset.totalMonths || 0);
  const flips = Array.from(
    container.querySelectorAll<HTMLElement>('.wrapped-flip'),
  );
  const prevBtn = container.querySelector<HTMLButtonElement>(
    '.obsessions-nav.prev',
  );
  const nextBtn = container.querySelector<HTMLButtonElement>(
    '.obsessions-nav.next',
  );

  let index = totalMonths - 1; // Start on the most recent month.

  const setActiveMonth = (next: number) => {
    index = Math.max(0, Math.min(totalMonths - 1, next));
    flips.forEach((flip, idx) => {
      flip.classList.toggle('active', idx === index);
    });
    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) nextBtn.disabled = index >= totalMonths - 1;
  };

  setActiveMonth(index);
  prevBtn?.addEventListener('click', () => setActiveMonth(index - 1));
  nextBtn?.addEventListener('click', () => setActiveMonth(index + 1));
}

function createWrappedSlides(stats: StatsData): string[] {
  const slides: string[] = [];
  const now = new Date();
  const year = now.getFullYear();
  const totalDays = (stats.totalMinutes / 60 / 24).toFixed(1);
  const topSong = stats.topSongs[0];
  const runnerUps = stats.topSongs.slice(1, 5);
  const topArtists = stats.topArtists;

  // Chronotype
  const listeningClock = stats.listeningClock ?? new Array(24).fill(0);
  const hasClock = listeningClock.some((m) => m > 0);
  const peakHour = hasClock
    ? listeningClock.indexOf(Math.max(...listeningClock))
    : -1;
  const chronotype =
    peakHour < 0
      ? 'Mystery'
      : peakHour >= 22 || peakHour <= 4
        ? 'Night Owl'
        : peakHour <= 10
          ? 'Early Bird'
          : 'Day Groover';

  // Archetype — real unique counts from the backend, not the top-5 list.
  const totalPlays = Math.max(1, stats.totalPlays);
  const varietyScore = Math.round((stats.uniqueSongs / totalPlays) * 100);
  const topFivePlays = topArtists.reduce((sum, a) => sum + a.plays, 0);
  const obsessionScore = Math.round((topFivePlays / totalPlays) * 100);
  const topArtistName = topArtists[0]?.name ?? 'your favorites';
  const archetype =
    varietyScore >= 70
      ? 'Trailblazer'
      : varietyScore >= 55
        ? 'Wanderer'
        : obsessionScore >= 55
          ? 'Superfan'
          : obsessionScore >= 35
            ? 'Loyalist'
            : 'Balancer';
  const auraClass =
    varietyScore >= 55
      ? 'aura-explorer'
      : obsessionScore >= 35
        ? 'aura-superfan'
        : 'aura-drifter';

  const monthly = stats.monthlyObsessions.filter((m) =>
    m.yearMonth.startsWith(`${year}-`),
  );

  const peakDay = stats.peakListeningDay;
  const firstSongYear = stats.firstSongThisYear;
  const monthName = now.toLocaleDateString('en-US', { month: 'long' });
  const isDecember = now.getMonth() === 11;

  // 1. Intro
  slides.push(`
    <div class="wrapped-slide wrapped-intro">
      <div class="wrapped-eyebrow">Music Stats · Wrapped</div>
      <h1 class="wrapped-title">${year} sounded<br/>like this.</h1>
      <p class="wrapped-subtitle">${isDecember ? 'Your year in music.' : `January through ${monthName} — your ${year} in music, so far.`}</p>
    </div>
  `);

  // 2. Timekeeper
  slides.push(`
    <div class="wrapped-slide">
      <div class="wrapped-eyebrow">The Timekeeper</div>
      <div class="wrapped-stat-large">${formatNumber(stats.totalMinutes)}</div>
      <div class="wrapped-label">minutes this year</div>
      <p class="wrapped-text">That's <strong>${totalDays} days</strong> of non-stop music across
      <strong>${formatNumber(stats.uniqueSongs)}</strong> different songs.</p>
    </div>
  `);

  // 3. Chronotype
  if (hasClock) {
    slides.push(`
      <div class="wrapped-slide">
        <div class="wrapped-eyebrow">The Chronotype</div>
        <h2 class="wrapped-heading">${chronotype}</h2>
        <p class="wrapped-text">Your music peaks around <strong>${`${peakHour}`.padStart(2, '0')}:00</strong>.</p>
        <div class="wrapped-chronotype">${createChronotypeTimeline(listeningClock, peakHour)}</div>
      </div>
    `);
  }

  // 4. Listening Aura
  slides.push(`
    <div class="wrapped-slide">
      <div class="wrapped-eyebrow">The Listening Aura</div>
      <div class="wrapped-aura ${auraClass}"><div class="aura-orb"></div></div>
      <h2 class="wrapped-heading">You're a ${archetype}.</h2>
      <p class="wrapped-text">
        ${
          varietyScore >= 55
            ? `You wandered across <strong>${formatNumber(stats.uniqueSongs)}</strong> unique songs — always hunting something new.`
            : `${obsessionScore}% of your plays came from your top artists, led by <strong>${escapeHtml(topArtistName)}</strong>.`
        }
      </p>
    </div>
  `);

  // 5. Obsessions
  if (monthly.length > 0) {
    slides.push(`
      <div class="wrapped-slide">
        <div class="wrapped-eyebrow">The Obsessions</div>
        <h2 class="wrapped-heading">One artist ruled each month</h2>
        <div class="wrapped-obsessions" data-total-months="${monthly.length}">
          <button class="obsessions-nav prev" aria-label="Previous month">←</button>
          <div class="wrapped-flips">
            ${monthly
              .map((m, idx) => {
                const [yy, mm] = m.yearMonth.split('-').map(Number);
                const label = new Date(yy, mm - 1, 1).toLocaleDateString(
                  'en-US',
                  { month: 'long' },
                );
                return `
                  <div class="wrapped-flip" data-month-index="${idx}">
                    <div class="flip-front">${escapeHtml(label)}</div>
                    <div class="flip-back">${escapeHtml(m.artist)}</div>
                    <div class="flip-sub">${formatMinutes(m.minutes)} that month</div>
                  </div>
                `;
              })
              .join('')}
          </div>
          <button class="obsessions-nav next" aria-label="Next month">→</button>
        </div>
        ${peakDay ? createPeakCalendar(peakDay) : ''}
      </div>
    `);
  }

  // 6. Honest stats
  slides.push(`
    <div class="wrapped-slide">
      <div class="wrapped-eyebrow">The Honest Stats</div>
      <div class="wrapped-honest">
        ${
          firstSongYear
            ? `
          <div class="honest-card">
            <div class="honest-label">First song of ${year}</div>
            <div class="honest-value">${escapeHtml(firstSongYear.title)}</div>
            <div class="honest-sub">${escapeHtml(firstSongYear.artist)} · ${formatDateKey(firstSongYear.date, false)}</div>
          </div>
        `
            : ''
        }
        <div class="honest-card">
          <div class="honest-label">Skip rate</div>
          <div class="honest-value">${stats.skipRate}%</div>
          <div class="honest-sub">of songs didn't make the cut</div>
        </div>
        ${
          stats.currentStreak > 1
            ? `
          <div class="honest-card">
            <div class="honest-label">Current streak</div>
            <div class="honest-value">${stats.currentStreak} days</div>
            <div class="honest-sub">of listening in a row</div>
          </div>
        `
            : ''
        }
      </div>
    </div>
  `);

  // 7. Hall of Fame
  if (topArtists.length > 0) {
    slides.push(`
      <div class="wrapped-slide">
        <div class="wrapped-eyebrow">Hall of Fame</div>
        <h2 class="wrapped-heading">Your top artists</h2>
        <div class="wrapped-artist-grid">
          ${topArtists
            .map(
              (artist, idx) => `
                <div class="artist-card${idx === 0 ? ' first' : ''}">
                  <div class="artist-rank">#${idx + 1}</div>
                  <div class="artist-avatar">${thumbHtml(artist.imageUrl, artist.name)}</div>
                  <div class="artist-name">${escapeHtml(artist.name)}</div>
                  <div class="artist-minutes">${formatMinutes(artist.minutes)}</div>
                </div>
              `,
            )
            .join('')}
        </div>
      </div>
    `);
  }

  // 8. Soundtrack (runner-ups — #1 gets its own reveal)
  if (runnerUps.length > 0) {
    slides.push(`
      <div class="wrapped-slide">
        <div class="wrapped-eyebrow">The Soundtrack</div>
        <h2 class="wrapped-heading">Almost your anthem</h2>
        <div class="wrapped-songlist">
          ${runnerUps
            .map(
              (song, idx) => `
                <div class="song-row">
                  <div class="song-rank">#${idx + 2}</div>
                  <div class="song-art">${thumbHtml(song.imageUrl, song.title)}</div>
                  <div class="song-meta">
                    <div class="song-title">${escapeHtml(song.title)}</div>
                    <div class="song-artist">${escapeHtml(song.artist)}</div>
                  </div>
                  <div class="song-plays">${formatNumber(song.plays)} plays</div>
                  ${
                    isVideoId(song.id)
                      ? `<button class="song-play" data-play-id="${escapeHtml(song.id)}">Play</button>`
                      : ''
                  }
                </div>
              `,
            )
            .join('')}
        </div>
      </div>
    `);
  }

  // 9. Anthem
  if (topSong) {
    const anthemArt = safeImageUrl(
      topSong.imageUrl ||
        (isVideoId(topSong.id)
          ? `https://i.ytimg.com/vi/${topSong.id}/hqdefault.jpg`
          : ''),
    );
    slides.push(`
      <div class="wrapped-slide wrapped-anthem-final">
        <div class="anthem-art">
          ${
            anthemArt
              ? `<img src="${escapeHtml(anthemArt)}" alt="" />`
              : '<div class="anthem-placeholder"></div>'
          }
        </div>
        <div class="anthem-content">
          <div class="wrapped-eyebrow">Your #1 song</div>
          <div class="anthem-title">${escapeHtml(topSong.title)}</div>
          <div class="anthem-artist">${escapeHtml(topSong.artist)}</div>
          <div class="anthem-stats">
            <div class="anthem-stat"><strong>${formatNumber(topSong.plays)}</strong> plays</div>
            <div class="anthem-stat"><strong>${formatMinutes(topSong.minutes)}</strong> together</div>
          </div>
          ${
            isVideoId(topSong.id)
              ? `<button class="wrapped-btn primary" data-play-id="${escapeHtml(topSong.id)}">Play it again</button>`
              : ''
          }
        </div>
      </div>
    `);
  }

  return slides;
}

function createPeakCalendar(peakDay: {
  date: string;
  minutes: number;
}): string {
  const [y, m, d] = peakDay.date.split('-').map(Number);
  if (!y || !m || !d) return '';
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstWeekday = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday-first

  const cells: string[] = [];
  for (let i = 0; i < firstWeekday; i++) {
    cells.push('<div class="calendar-day blank"></div>');
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(
      `<div class="calendar-day${day === d ? ' peak' : ''}">${day}</div>`,
    );
  }

  return `
    <div class="wrapped-calendar-block">
      <div class="wrapped-calendar-title">Biggest day: ${formatDateKey(peakDay.date)}</div>
      <div class="wrapped-calendar-sub">${formatMinutes(peakDay.minutes)} of music</div>
      <div class="wrapped-calendar">${cells.join('')}</div>
    </div>
  `;
}

function createChronotypeTimeline(
  hourlyData: number[],
  peakHour: number,
): string {
  const maxMinutes = Math.max(...hourlyData, 1);
  const bars = hourlyData
    .map((minutes, hour) => {
      const height = Math.max(4, (minutes / maxMinutes) * 72);
      const label = `${hour}`.padStart(2, '0');
      return `
        <div class="chronotype-bar${hour === peakHour ? ' peak' : ''}"
          style="--h:${height.toFixed(0)}px" title="${label}:00 · ${Math.round(minutes)} min">
          <span class="chronotype-bar-inner"></span>
          ${hour % 6 === 0 || hour === 23 ? `<span class="chronotype-label">${label}</span>` : '<span class="chronotype-label"></span>'}
        </div>
      `;
    })
    .join('');

  return `<div class="chronotype-timeline">${bars}</div>`;
}
