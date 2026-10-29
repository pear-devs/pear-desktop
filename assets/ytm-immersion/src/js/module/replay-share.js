// Daily Replay の共有画像。
//
// パネルの DOM を画像にするのではなく、canvas に描き直している。
// パネルは「読む」ための器で、共有画像は「見せる」ためのもの。寸法も
// 情報量も別物にしたいので、同じ集計結果(getStats)から別々に組む。
//
// 正方形 1080×1080 にしてあるのは、Discord でも X でもスマホの画面でも
// 切られずに収まる寸法だから。
const ReplayShare = (() => {
  const W = 1080;
  const H = 1080;
  const PAD = 56;

  const INK = '#f2efe9';
  const INK_3 = 'rgba(242, 239, 233, 0.50)';
  const BG = '#0d0d10';
  const SURFACE = 'rgba(255, 255, 255, 0.05)';
  const LINE = 'rgba(255, 255, 255, 0.10)';

  // canvas には woff2 を読ませていないので、拡張が同梱している Inter は
  // 使えない。日本語が出る前提で、OS 側の本文書体に寄せる。
  const FAMILY = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", system-ui, sans-serif';
  const font = (size, weight) => `${weight || 400} ${size}px ${FAMILY}`;

  const COLS = 4;
  const ROWS = 2;
  const GAP = 14;
  const CELL = Math.floor((W - PAD * 2 - GAP * (COLS - 1)) / COLS);

  let objectUrl = null;

  // ジャケットは CORS を許した画像だけが canvas に描ける。許していない
  // 画像を drawImage すると canvas ごと汚染され、toBlob が SecurityError で
  // 落ちる。1 枚の巻き添えで全部が失敗するので、読めたものだけ使う。
  const loadImage = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
    img.src = src;
  });

  const ellipsize = (ctx, text, maxWidth) => {
    const value = String(text ?? '');
    if (ctx.measureText(value).width <= maxWidth) return value;
    let lo = 0;
    let hi = value.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(value.slice(0, mid) + '…').width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return value.slice(0, lo) + '…';
  };

  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.closePath();
  };

  // 正方形の枠に、正方形でない画像を切らずに収める。
  const drawCover = (ctx, img, x, y, size) => {
    ctx.save();
    roundRect(ctx, x, y, size, size, 8);
    ctx.clip();
    ctx.fillStyle = SURFACE;
    ctx.fillRect(x, y, size, size);
    if (img) {
      const ratio = Math.max(size / img.naturalWidth, size / img.naturalHeight);
      const w = img.naturalWidth * ratio;
      const h = img.naturalHeight * ratio;
      ctx.drawImage(img, x + (size - w) / 2, y + (size - h) / 2, w, h);
    }
    ctx.restore();
  };

  const rangeLabel = (range) => {
    if (range === 'week') return t('replay_week');
    if (range === 'all') return t('replay_all');
    return t('replay_today');
  };

  const pad2 = (n) => String(n).padStart(2, '0');

  const dateLabel = () => {
    const d = new Date();
    return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
  };

  // 期間の添え書き。「今週」に 1 つの日付だけ添えても、いつからの
  // 1 週間なのかが伝わらない。範囲そのものを書く。
  const periodLabel = (range) => {
    if (range === 'all') return rangeLabel(range);
    if (range === 'week') {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const to = new Date();
      return `${rangeLabel(range)}　${pad2(from.getMonth() + 1)}.${pad2(from.getDate())} — ${pad2(to.getMonth() + 1)}.${pad2(to.getDate())}`;
    }
    return `${rangeLabel(range)}　${dateLabel()}`;
  };

  const drawHeader = (ctx, stats, range) => {
    ctx.textBaseline = 'alphabetic';

    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = font(30, 700);
    ctx.fillText('Daily Replay', PAD, PAD + 30);

    ctx.fillStyle = INK_3;
    ctx.font = font(17, 400);
    ctx.fillText(periodLabel(range), PAD, PAD + 62);

    ctx.textAlign = 'right';
    ctx.fillStyle = INK;
    ctx.font = font(40, 600);
    ctx.fillText(ellipsize(ctx, stats.totalTime, 420), W - PAD, PAD + 36);

    ctx.fillStyle = INK_3;
    ctx.font = font(17, 400);
    const songs = Number(stats.uniqueSongs) || (stats.topSongs || []).length;
    ctx.fillText(`${stats.totalPlays} ${t('replay_plays')}　${songs}${t('replay_unit_songs')}`, W - PAD, PAD + 66);

    ctx.textAlign = 'left';
  };

  const drawFooter = (ctx, stats) => {
    const y = H - PAD - 96;

    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y);
    ctx.lineTo(W - PAD, y);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = INK_3;
    ctx.font = font(15, 400);
    ctx.fillText(t('replay_topArtist'), PAD, y + 32);

    const names = (stats.topArtists || []).slice(0, 3)
      .map(a => `${a.name} ${Number(a.count) || 0}${t('replay_unit_count')}`)
      .join('　');
    ctx.fillStyle = INK;
    ctx.font = font(21, 600);
    ctx.fillText(ellipsize(ctx, names, W - PAD * 2 - 220), PAD, y + 64);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(242, 239, 233, 0.46)';
    ctx.font = font(14, 400);
    ctx.fillText('YTM Immersion', W - PAD, y + 64);
    ctx.textAlign = 'left';
  };

  // ジャケット主役。知っている人には見ただけで伝わる。
  const drawGrid = (ctx, songs, images) => {
    const captionH = 56;
    const rowGap = 22;
    const rows = Math.ceil(Math.min(songs.length, COLS * ROWS) / COLS) || 1;
    const blockH = rows * (CELL + captionH) + (rows - 1) * rowGap;
    const bandTop = 150;
    const bandBottom = H - PAD - 96;
    const top = Math.max(bandTop, bandTop + (bandBottom - bandTop - blockH) / 2);

    songs.slice(0, COLS * ROWS).forEach((song, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = PAD + col * (CELL + GAP);
      const y = top + row * (CELL + captionH + rowGap);

      drawCover(ctx, images[i], x, y, CELL);

      // 再生回数はジャケットの左上に小さく重ねる。別の行にすると
      // 曲名の行が窮屈になり、8 曲ぶんで効いてくる。
      const badge = `${Number(song.count) || 0}${t('replay_unit_count')}`;
      ctx.font = font(15, 600);
      const bw = ctx.measureText(badge).width + 20;
      ctx.fillStyle = 'rgba(13, 13, 16, 0.78)';
      roundRect(ctx, x, y, bw, 30, 8);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.fillText(badge, x + 10, y + 21);

      ctx.fillStyle = INK;
      ctx.font = font(17, 600);
      ctx.fillText(ellipsize(ctx, song.title, CELL), x, y + CELL + 24);

      ctx.fillStyle = INK_3;
      ctx.font = font(14, 400);
      ctx.fillText(ellipsize(ctx, song.artist, CELL), x, y + CELL + 46);
    });
  };

  // ジャケットが 1 枚も読めなかった時。無地の四角を 8 個並べても
  // 意味がないので、読める情報だけの版に切り替える。
  const drawList = (ctx, songs) => {
    const rowH = 74;
    const max = Math.min(8, songs.length);
    const best = Number(songs[0]?.count) || 1;
    const bandTop = 150;
    const bandBottom = H - PAD - 96;
    const top = Math.max(bandTop, bandTop + (bandBottom - bandTop - max * rowH) / 2);

    for (let i = 0; i < max; i++) {
      const song = songs[i];
      const y = top + i * rowH;

      ctx.fillStyle = INK_3;
      ctx.font = font(18, 400);
      ctx.textAlign = 'right';
      ctx.fillText(String(i + 1), PAD + 26, y + 30);
      ctx.textAlign = 'left';

      ctx.fillStyle = INK;
      ctx.font = font(24, 600);
      ctx.fillText(ellipsize(ctx, song.title, 560), PAD + 50, y + 26);

      ctx.fillStyle = INK_3;
      ctx.font = font(16, 400);
      ctx.fillText(ellipsize(ctx, song.artist, 560), PAD + 50, y + 52);

      const barX = PAD + 660;
      const barW = 240;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.fillRect(barX, y + 24, barW, 5);
      ctx.fillStyle = INK;
      ctx.fillRect(barX, y + 24, Math.max(4, barW * ((Number(song.count) || 0) / best)), 5);

      ctx.textAlign = 'right';
      ctx.font = font(18, 600);
      ctx.fillText(`${Number(song.count) || 0}${t('replay_unit_count')}`, W - PAD, y + 30);
      ctx.textAlign = 'left';

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD, y + rowH - 12);
      ctx.lineTo(W - PAD, y + rowH - 12);
      ctx.stroke();
    }
  };

  const render = async (stats, range) => {
    const songs = (stats.topSongs || []).slice(0, COLS * ROWS);
    const images = await Promise.all(songs.map(song => loadImage(song.src)));
    const usable = images.filter(Boolean).length;

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    drawHeader(ctx, stats, range);
    if (usable > 0) drawGrid(ctx, songs, images);
    else drawList(ctx, songs);
    drawFooter(ctx, stats);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    return { blob, usedCovers: usable };
  };

  const closeDialog = () => {
    const el = document.getElementById('ytm-replay-share');
    if (el) el.remove();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const showDialog = (blob) => {
    closeDialog();
    objectUrl = URL.createObjectURL(blob);

    const root = createEl('div', 'ytm-replay-share', 'ytm-replay-share', `
      <div class="replay-share-box">
        <div class="replay-share-head">
          <span>${t('replay_share_title')}</span>
          <button type="button" class="replay-share-close" aria-label="${t('replay_share_close')}">✕</button>
        </div>
        <img class="replay-share-img" alt="">
        <div class="replay-share-actions">
          <button type="button" class="replay-footer-btn replay-share-copy">${t('replay_share_copy')}</button>
          <button type="button" class="replay-footer-btn replay-share-save">${t('replay_share_save')}</button>
        </div>
      </div>
    `);
    root.querySelector('.replay-share-img').src = objectUrl;
    document.body.appendChild(root);

    root.querySelector('.replay-share-close').onclick = closeDialog;
    root.onclick = (e) => { if (e.target === root) closeDialog(); };

    root.querySelector('.replay-share-save').onclick = () => {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `daily_replay_${dateLabel().replace(/\./g, '')}.png`;
      a.click();
    };

    // Discord や X は画像の貼り付けを受け付けるので、保存せずに
    // クリップボード経由で渡せる方が速い。対応していない環境も
    // あるので、失敗しても保存ボタンは残す。
    const copyBtn = root.querySelector('.replay-share-copy');
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      copyBtn.remove();
    } else {
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          copyBtn.textContent = t('replay_share_copied');
          setTimeout(() => { copyBtn.textContent = t('replay_share_copy'); }, 1800);
        } catch (e) {
          console.warn('[DailyReplay Share] clipboard failed', e);
          copyBtn.textContent = t('replay_share_copy_failed');
          setTimeout(() => { copyBtn.textContent = t('replay_share_copy'); }, 1800);
        }
      };
    }
  };

  return {
    open: async function (stats, range, button) {
      if (!stats || !stats.totalPlays) return;
      const label = button ? button.textContent : '';
      if (button) {
        button.disabled = true;
        button.textContent = t('replay_share_building');
      }
      try {
        const { blob } = await render(stats, range);
        if (!blob) throw new Error('toBlob returned null');
        showDialog(blob);
      } catch (e) {
        console.error('[DailyReplay Share] build failed', e);
        if (typeof showToast === 'function') showToast(t('replay_share_failed'));
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = label;
        }
      }
    },
    close: closeDialog,
  };
})();
