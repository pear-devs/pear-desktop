// 歌詞カード。
//
// 聴いている曲の歌詞から 1〜4 行を選び、Apple Music の歌詞の共有に寄せた見た目
// (ジャケットの色のグラデーション・大きなジャケットと曲名・太い白文字)の画像にして、
// コピー・X に投稿・保存をする。刺さった一節をそのまま友だちや SNS に渡すための機能。
//
// - 画像は 1600×900(16:9)。X のタイムラインでも Discord でも切れずに出る比率。
//   以前は 1080×1080 の正方形で、X では上下が切られて歌詞が欠けていた。
// - 「X に投稿」は、画像をクリップボードに入れてから、歌詞の一節・曲名・曲の
//   リンクを入れた投稿画面を新しいタブで開く(画像はそこで貼り付ける)。X の
//   投稿画面のリンクは画像を受け取れないため。Discord は「画像をコピー」して貼る。
//
// - 入口はボタン列の「歌詞カード」。押すと選ぶ状態になり、いま歌っている行
//   (無ければ直前に歌った行)が選ばれている。
// - 選んでいる間は、行を押してもシークしない。範囲の外を押すと、そこまで
//   広げる(最大 4 行。短い抜き出しにとどめる)。範囲の中を押すと、その 1 行
//   から選び直す。Esc でやめる、Enter で作る。
// - 選んでいる間は自動で歌っている行へ寄せない(選ぶ行が逃げていかない)。
//   曲が変わったらやめる。
// - 画像は手元の canvas で作り、どこにも送らない。ジャケットが読めない時は
//   ジャケットなしの暗い背景で作る。
//
// 共有画像の器(.ytm-replay-share)は Daily Replay と同じものを使う。
const LyricCard = (() => {
  const W = 1600;
  const H = 900;
  const PAD = 96;
  const MAX_LINES = 4;
  const ART = 360;
  const FAMILY = '-apple-system, "SF Pro Display", "Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", system-ui, sans-serif';
  const font = (size, weight) => `${weight || 400} ${size}px ${FAMILY}`;

  let selecting = false;
  // 選ぶ状態の世代。始める・やめるたびに進める。カードを作っている間
  // (ジャケットの読み込み待ち)に曲送りや広告でやめた場合、戻ってきた
  // 結果は前の曲のものなので捨てる。捨てないと旧曲のカードが後から開く。
  let generation = 0;
  let anchor = -1;
  let focus = -1;
  let bar = null;
  let rowObserver = null;
  let objectUrl = null;

  // ── 行の読み取り ───────────────────────────────────────
  const rows = () => (ui.lyrics ? Array.from(ui.lyrics.querySelectorAll('.lyric-line')) : []);
  const mainText = (row) => {
    const el = row && row.querySelector('.lyric-main');
    return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  };
  const translationText = (row) => {
    const el = row && row.querySelector('.lyric-translation');
    return (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  };
  // 間奏の「♪」や空行はカードにしない
  const isSelectable = (row) => {
    const text = mainText(row);
    return !!text && !/^[♪♫\s・…]+$/.test(text);
  };

  const range = () => [Math.min(anchor, focus), Math.max(anchor, focus)];

  // 範囲の外を押したらそこまで広げ、MAX_LINES を超えるぶんは押した側と
  // 反対の端から落とす。範囲の中を押したら、その行だけに戻す。
  const nextRange = (current, clicked, max) => {
    const [lo, hi] = current;
    if (clicked >= lo && clicked <= hi) return [clicked, clicked];
    if (clicked > hi) return [Math.max(lo, clicked - max + 1), clicked];
    return [clicked, Math.min(hi, clicked + max - 1)];
  };

  const selectedLines = () => {
    const rs = rows();
    const [lo, hi] = range();
    const out = [];
    for (let i = lo; i <= hi && i < rs.length; i++) {
      if (i < 0 || !isSelectable(rs[i])) continue;
      out.push({ text: mainText(rs[i]), translation: translationText(rs[i]), time: parseFloat(rs[i].dataset?.startTime) });
    }
    return out;
  };

  // ── 選ぶ状態 ─────────────────────────────────────────
  const paint = () => {
    const rs = rows();
    const [lo, hi] = range();
    rs.forEach((row, i) => row.classList.toggle('ytm-card-selected', selecting && i >= lo && i <= hi && isSelectable(row)));
    if (bar) {
      const n = selectedLines().length;
      bar.querySelector('.ytm-card-bar-count').textContent = t('lyric_card_selected').replace('{n}', String(n));
      bar.querySelector('.ytm-card-bar-make').disabled = n === 0;
    }
  };

  const startIndex = () => {
    const rs = rows();
    let i = rs.findIndex(r => r.classList.contains('active') && isSelectable(r));
    if (i < 0) {
      for (let j = rs.length - 1; j >= 0; j--) {
        if (rs[j].classList.contains('lyric-past') && isSelectable(rs[j])) { i = j; break; }
      }
    }
    if (i < 0) i = rs.findIndex(isSelectable);
    return i;
  };

  const onRowClick = (e) => {
    const row = e.target.closest && e.target.closest('.lyric-line');
    if (!row || !ui.lyrics || !ui.lyrics.contains(row)) return;
    // 選んでいる間は、行を押してもシークしない
    e.preventDefault();
    e.stopPropagation();
    if (!isSelectable(row)) return;
    const i = rows().indexOf(row);
    [anchor, focus] = nextRange(range(), i, MAX_LINES);
    paint();
  };

  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      make();
    }
  };

  const showBar = () => {
    bar = createEl('div', 'ytm-lyric-card-bar', 'ytm-lyric-card-bar', `
      <span class="ytm-card-bar-count"></span>
      <span class="ytm-card-bar-hint"></span>
      <button type="button" class="ytm-card-bar-make"></button>
      <button type="button" class="ytm-card-bar-cancel"></button>
    `);
    bar.setAttribute('role', 'toolbar');
    bar.querySelector('.ytm-card-bar-hint').textContent = t('lyric_card_hint');
    bar.querySelector('.ytm-card-bar-make').textContent = t('lyric_card_make');
    bar.querySelector('.ytm-card-bar-cancel').textContent = t('lyric_card_cancel');
    bar.querySelector('.ytm-card-bar-make').onclick = () => make();
    bar.querySelector('.ytm-card-bar-cancel').onclick = () => cancel();
    // 歌詞の列の下に置く(画面の真ん中だと左の列の曲/動画の切り替えに重なる)
    (ui.lyricsStage || document.body).appendChild(bar);
  };

  const start = () => {
    if (selecting) return;
    // 歌詞の列が画面に無い時(動画モード)も作れない。以前は見えない所で
    // 選ぶ状態に入り、Esc を押すまでキー操作を横取りしていた(実機で確認)。
    if (!ui.lyrics || !ui.lyrics.getClientRects().length ||
      document.body.classList.contains('ytm-ad-playing') || !rows().some(isSelectable)) {
      if (typeof showToast === 'function') showToast(t('lyric_card_unavailable'));
      return;
    }
    const i = startIndex();
    if (i < 0) return;
    selecting = true;
    generation += 1;
    anchor = i;
    focus = i;
    document.body.classList.add('ytm-lyric-card-selecting');
    if (typeof setLyricsAutoFollowHold === 'function') setLyricsAutoFollowHold(true);
    ui.lyrics.addEventListener('click', onRowClick, true);
    document.addEventListener('keydown', onKey, true);
    // 翻訳が遅れて届くなどで歌詞が組み直されたら、選んだ印を付け直す
    rowObserver = new MutationObserver(() => paint());
    rowObserver.observe(ui.lyrics, { childList: true });
    showBar();
    paint();
  };

  const cancel = () => {
    if (!selecting) return;
    selecting = false;
    generation += 1;
    document.body.classList.remove('ytm-lyric-card-selecting');
    if (ui.lyrics) ui.lyrics.removeEventListener('click', onRowClick, true);
    document.removeEventListener('keydown', onKey, true);
    if (rowObserver) rowObserver.disconnect();
    rowObserver = null;
    rows().forEach(row => row.classList.remove('ytm-card-selected'));
    if (bar) bar.remove();
    bar = null;
    if (typeof setLyricsAutoFollowHold === 'function') setLyricsAutoFollowHold(false);
  };

  // ── 描く ─────────────────────────────────────────────
  const loadImage = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    setTimeout(() => done(null), 6000);
    img.src = src;
  });

  const roundRectPath = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  };

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

  // 行頭に来てはいけない文字(句読点・閉じ括弧・小書き)
  const NO_LINE_START = /^[、。，．,.!?！？」』）)\]】〕〉》ー～ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/;

  const segmentsOf = (text) => {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        return Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text), s => s.segment);
      } catch (e) { /* 下へ */ }
    }
    return text.split(/(\s+)/);
  };

  // 切ってよい位置で区切った塊。日本語の行は、本体の歌詞と同じ文節の切れ目
  // (lyrics-ui.js の budouxPhraseBoundaries。BudouX と、小書き・句読点を行頭に
  // 置かない・「〜て」の後の補助動詞を離さない等の決まり)で切る。それ以外は語区切り。
  // budouxPhraseBoundaries は後から読み込まれるが、カードを作るのは利用者の操作の後。
  const chunksOf = (text) => {
    const cuts = typeof budouxPhraseBoundaries === 'function' ? budouxPhraseBoundaries(text) : null;
    if (!cuts) return segmentsOf(text);
    const out = [];
    let from = 0;
    for (const to of [...cuts, text.length]) {
      if (to > from) out.push(text.slice(from, to));
      from = to;
    }
    return out;
  };

  // 幅に収まるように前から詰める。塊の途中では切らず、1 つの塊が幅を超える時だけ字で切る。
  const fill = (ctx, chunks, maxWidth) => {
    const lines = [];
    let line = '';
    for (const seg of chunks) {
      const candidate = line + seg;
      if (ctx.measureText(candidate).width <= maxWidth || !line.trim()) {
        if (ctx.measureText(candidate).width <= maxWidth) {
          line = candidate;
          continue;
        }
        // 1 つの塊だけで幅を超える: 字で切る
        for (const ch of seg) {
          if (ctx.measureText(line + ch).width > maxWidth && line.trim()) {
            lines.push(line.trimEnd());
            line = '';
          }
          line += ch;
        }
        continue;
      }
      if (NO_LINE_START.test(seg)) {
        // 句読点は前の行にぶら下げる(少しはみ出しても行頭には置かない)
        line = candidate;
        continue;
      }
      lines.push(line.trimEnd());
      line = seg.trimStart();
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  };

  // 折り返す。前から詰めるだけだと「1 行目がいっぱいで 2 行目に数文字」になるので、
  // 同じ行数で収まるいちばん狭い幅を探して組み直し、行の長さを揃える
  // (CSS の text-wrap: balance と同じ考え。本体の歌詞もこれで折り返している)。
  const wrap = (ctx, text, maxWidth) => {
    const chunks = chunksOf(text);
    const lines = fill(ctx, chunks, maxWidth);
    if (lines.length < 2) return lines;
    // いちばん長い塊より狭くはしない(狭めると塊を字で割ってしまう。「したっ / て」)
    const widest = Math.max(...chunks.map(c => ctx.measureText(c.trim()).width));
    if (widest >= maxWidth) return lines;
    let lo = widest;
    let hi = maxWidth;
    for (let i = 0; i < 14 && hi - lo > 1; i++) {
      const mid = (lo + hi) / 2;
      if (fill(ctx, chunks, mid).length <= lines.length) hi = mid;
      else lo = mid;
    }
    return fill(ctx, chunks, hi);
  };

  // 選んだ行を、枠に収まる最大の文字サイズで組む
  const layoutLyrics = (ctx, lines, maxWidth, maxHeight) => {
    for (let size = 72; size >= 34; size -= 2) {
      const subSize = Math.round(size * 0.5);
      const blocks = [];
      let height = 0;
      for (const line of lines) {
        ctx.font = font(size, 800);
        const main = wrap(ctx, line.text, maxWidth);
        ctx.font = font(subSize, 500);
        const sub = line.translation ? wrap(ctx, line.translation, maxWidth) : [];
        const h = main.length * size * 1.22 + (sub.length ? 10 + sub.length * subSize * 1.35 : 0);
        blocks.push({ main, sub, h });
        height += h;
      }
      height += (blocks.length - 1) * size * 0.55;
      if (height <= maxHeight || size === 34) return { size, subSize, blocks, height };
    }
    return null;
  };

  const averageLuminance = (img) => {
    try {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      return sum / (d.length / 4);
    } catch (e) {
      return 0.5;
    }
  };

  // ジャケットから背景の 2 色を取る。暗すぎる色は外し、彩度の高い色を先にする
  // (試作で、暗いジャケットだとほぼ黒が選ばれて背景が真っ黒になった)。
  const paletteOf = (img) => {
    try {
      const N = 24;
      const c = document.createElement('canvas');
      c.width = N;
      c.height = N;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, N, N);
      const d = x.getImageData(0, 0, N, N).data;
      const buckets = new Map();
      for (let i = 0; i + 3 < d.length; i += 4) {
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const key = `${r >> 5},${g >> 5},${b >> 5}`;
        const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, s: 0, v: 0 };
        e.n++; e.r += r; e.g += g; e.b += b; e.s += mx ? (mx - mn) / mx : 0; e.v += mx;
        buckets.set(key, e);
      }
      const cols = [...buckets.values()]
        .filter(e => e.v / e.n > 55)
        .map(e => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, score: e.n * (0.12 + e.s / e.n) * Math.pow(e.v / e.n / 255, 0.7) }))
        .sort((a, b) => b.score - a.score);
      if (!cols.length) return null;
      const main = cols[0];
      const far = (c2) => Math.abs(c2.r - main.r) + Math.abs(c2.g - main.g) + Math.abs(c2.b - main.b) > 90;
      return { main, second: cols.find(far) || cols[1] || main };
    } catch (e) {
      return null;   // 読み出せないジャケット(CORS)
    }
  };
  const rgb = (c, k = 1) => `rgb(${Math.round(c.r * k)},${Math.round(c.g * k)},${Math.round(c.b * k)})`;

  const render = async ({ lines, title, artist, artworkSrc }) => {
    const img = await loadImage(artworkSrc);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    // 背景: ジャケットの 2 色のグラデーション。読めない時は暗い色
    const pal = img ? paletteOf(img) : null;
    ctx.fillStyle = '#16161c';
    ctx.fillRect(0, 0, W, H);
    if (pal) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, rgb(pal.main, 0.85));
      g.addColorStop(1, rgb(pal.second, 0.4));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    // 白い字が読めるように少し沈め、四隅を暗くする
    const luma = img ? averageLuminance(img) : 0.3;
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(0.55, 0.16 + luma * 0.35).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    const vignette = ctx.createRadialGradient(W * 0.5, H * 0.5, H * 0.3, W * 0.5, H * 0.5, W * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);

    // 左: 大きなジャケットと、その下に曲名・アーティスト
    const leftW = ART;
    const artY = Math.round((H - ART - 120) / 2);
    if (img) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 50;
      ctx.shadowOffsetY = 18;
      roundRectPath(ctx, PAD, artY, ART, ART, 28);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.restore();
      ctx.save();
      roundRectPath(ctx, PAD, artY, ART, ART, 28);
      ctx.clip();
      ctx.drawImage(img, PAD, artY, ART, ART);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(40, 700);
    ctx.fillText(ellipsize(ctx, title, leftW), PAD, artY + ART + 62);
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = font(32, 500);
    ctx.fillText(ellipsize(ctx, artist, leftW), PAD, artY + ART + 106);

    // 右: 歌詞(枠に収まる最大の大きさで、縦の真ん中に)
    const lx = PAD + leftW + 96;
    const top = PAD;
    const bottom = H - PAD - 40;
    const maxWidth = W - PAD - lx;
    const layout = layoutLyrics(ctx, lines, maxWidth, bottom - top);
    if (layout) {
      let y = top + Math.max(0, (bottom - top - layout.height) / 2);
      ctx.textBaseline = 'top';
      layout.blocks.forEach((block, bi) => {
        ctx.font = font(layout.size, 800);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = 18;
        block.main.forEach((text, li) => {
          if (y + layout.size > bottom + layout.size * 0.3) return;
          ctx.fillText(text, lx, y + li * layout.size * 1.22);
        });
        let yy = y + block.main.length * layout.size * 1.22;
        ctx.shadowBlur = 0;
        if (block.sub.length) {
          yy += 10;
          ctx.font = font(layout.subSize, 500);
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          block.sub.forEach((text, li) => ctx.fillText(text, lx, yy + li * layout.subSize * 1.35));
        }
        y += block.h + (bi < layout.blocks.length - 1 ? layout.size * 0.55 : 0);
      });
    }

    // 署名(右下)
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.shadowBlur = 0;
    ctx.font = font(26, 600);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('YTM Immersion', W - PAD, H - PAD + 30);
    ctx.textAlign = 'left';

    return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  };

  // ── 見せる(Daily Replay の共有画像と同じ器) ─────────────
  const closeDialog = () => {
    const el = document.getElementById('ytm-lyric-card-share');
    if (el) el.remove();
    document.removeEventListener('keydown', onDialogKey, true);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  };

  const onDialogKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDialog();
    }
  };

  const fileNameFor = (title) => {
    const safe = String(title || 'lyrics').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);
    return `lyric_card_${safe}.png`;
  };

  // カードの最初の行が始まる、今の動画の頭からの秒(切り捨て)。取れなければ null
  const startSecFor = (lines) => {
    const time = lines?.[0]?.time;
    if (!Number.isFinite(time) || typeof lyricTimeToVideoTime !== 'function') return null;
    const sec = Math.floor(lyricTimeToVideoTime(time));
    return sec >= 1 ? sec : null;
  };

  // 曲のリンク。X の投稿や Discord に貼る。startSec があれば、そこから再生が始まる。
  // 取れなければ null
  const songUrl = (startSec = null) => {
    const id = typeof getCurrentVideoId === 'function' ? getCurrentVideoId() : null;
    if (!id) return null;
    const url = `https://music.youtube.com/watch?v=${encodeURIComponent(id)}`;
    return startSec ? `${url}&t=${startSec}` : url;
  };

  // X の投稿画面に入れる文。「乃木坂46「是非に及ばず」を、この歌詞から YouTube Music で聴く」。
  // 歌詞そのものは画像に入っているので、文には入れない。この後ろにリンクが付く
  const postTextFor = ({ title, artist }, timed) => {
    if (!title) return '';
    // 曲名に $& などが入っていても崩れないよう、置き換えは関数で渡す
    const song = (artist ? t('lyric_card_post_credit').replace('{artist}', () => artist) : t('lyric_card_post_credit_title'))
      .replace('{title}', () => title);
    return t(timed ? 'lyric_card_post_listen_at' : 'lyric_card_post_listen').replace('{song}', () => song);
  };

  const copyImage = async (blob) => {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return true;
    } catch (e) {
      console.warn('[LyricCard] clipboard failed', e);
      return false;
    }
  };

  const showDialog = (blob, title, info = {}) => {
    closeDialog();
    objectUrl = URL.createObjectURL(blob);
    const root = createEl('div', 'ytm-lyric-card-share', 'ytm-replay-share', `
      <div class="replay-share-box" role="dialog" aria-modal="true">
        <div class="replay-share-head">
          <span></span>
          <button type="button" class="replay-share-close"></button>
        </div>
        <img class="replay-share-img" alt="">
        <div class="replay-share-actions">
          <button type="button" class="replay-footer-btn replay-share-copy"></button>
          <button type="button" class="replay-footer-btn replay-share-x"></button>
          <button type="button" class="replay-footer-btn replay-share-link"></button>
          <button type="button" class="replay-footer-btn replay-share-save"></button>
        </div>
      </div>
    `);
    root.querySelector('.replay-share-head span').textContent = t('lyric_card_title');
    const close = root.querySelector('.replay-share-close');
    close.textContent = '✕';
    close.setAttribute('aria-label', t('replay_share_close'));
    root.querySelector('.replay-share-img').src = objectUrl;
    root.querySelector('.replay-share-save').textContent = t('replay_share_save');
    document.body.appendChild(root);
    document.addEventListener('keydown', onDialogKey, true);

    close.onclick = closeDialog;
    root.onclick = (e) => { if (e.target === root) closeDialog(); };

    root.querySelector('.replay-share-save').onclick = () => {
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = fileNameFor(title);
      a.click();
    };

    const copyBtn = root.querySelector('.replay-share-copy');
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      copyBtn.remove();
    } else {
      copyBtn.textContent = t('replay_share_copy');
      copyBtn.onclick = async () => {
        copyBtn.textContent = (await copyImage(blob)) ? t('replay_share_copied') : t('replay_share_copy_failed');
        setTimeout(() => { copyBtn.textContent = t('replay_share_copy'); }, 1800);
      };
      copyBtn.focus();
    }

    // X に投稿: 画像をクリップボードに入れてから、文とリンクを入れた投稿画面を開く。
    // 画像は投稿画面で貼り付けてもらう(投稿画面のリンクは画像を受け取れない)。
    const startSec = startSecFor(info.lines);
    const xBtn = root.querySelector('.replay-share-x');
    xBtn.textContent = t('lyric_card_post_x');
    xBtn.onclick = async () => {
      const copied = await copyImage(blob);
      const url = songUrl(startSec);
      const params = new URLSearchParams({ text: postTextFor(info, !!(url && startSec)) });
      if (url) params.set('url', url);
      window.open(`https://x.com/intent/tweet?${params.toString()}`, '_blank', 'noopener');
      if (typeof showToast === 'function') showToast(t(copied ? 'lyric_card_x_hint' : 'lyric_card_x_hint_save'));
    };

    // リンクをコピー: Discord などで、画像と一緒に曲へ飛べるように
    const linkBtn = root.querySelector('.replay-share-link');
    const url = songUrl(startSec);
    if (!url || !navigator.clipboard) {
      linkBtn.remove();
    } else {
      linkBtn.textContent = t('lyric_card_copy_link');
      linkBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          linkBtn.textContent = t('lyric_card_link_copied');
        } catch (e) {
          linkBtn.textContent = t('replay_share_copy_failed');
        }
        setTimeout(() => { linkBtn.textContent = t('lyric_card_copy_link'); }, 1800);
      };
    }
  };

  const make = async () => {
    if (!selecting) return;
    const lines = selectedLines();
    if (!lines.length) return;
    const title = (ui.title && ui.title.textContent || '').trim();
    const artist = (ui.artist && ui.artist.textContent || '').trim();
    const artImg = ui.artwork && ui.artwork.querySelector('img');
    const artworkSrc = artImg ? (artImg.currentSrc || artImg.src) : null;
    const makeBtn = bar && bar.querySelector('.ytm-card-bar-make');
    if (makeBtn) {
      makeBtn.disabled = true;
      makeBtn.textContent = t('replay_share_building');
    }
    const myGeneration = generation;
    try {
      const blob = await render({ lines, title, artist, artworkSrc });
      // 作っている間にやめていたら(曲送り・広告・Esc)、結果は捨てる
      if (myGeneration !== generation || !selecting) return;
      if (!blob) throw new Error('toBlob returned null');
      cancel();
      showDialog(blob, title, { lines, title, artist });
    } catch (e) {
      if (myGeneration !== generation) return;
      console.error('[LyricCard] build failed', e);
      if (typeof showToast === 'function') showToast(t('lyric_card_failed'));
      if (makeBtn) {
        makeBtn.disabled = false;
        makeBtn.textContent = t('lyric_card_make');
      }
    }
  };

  return {
    start,
    cancel,
    isSelecting: () => selecting,
    // テスト用
    _nextRange: nextRange,
    _wrap: wrap,
    _render: render,
  };
})();
