// プレイヤーバーの受け持ち。
//
// Immersion は YTM のプレイヤーバーを浮いた角丸のバーに整えて、操作に使う。
// ところが YTM はバーを時々作り直す(2026-09 には ytmusic-player-bar と別に
// ytmusic-miniplayer が一部の人に出た)。要素名で決め打ちしていると、
// 作り直されるたびに「ボタンが出ない」「Immersion に入るとバーが消える」になる。
//
// ここでは次の順に、直さなくても使える所まで落ちるようにする。
//  1. 知っている作りのバー(classic / wiz)を探す
//  2. 無ければ「画面の下に固定され、シークバーを持つ横長の要素」を形で探す
//     (generic)。見つけたバーと祖先には印(data-ytmi-*)を付け、CSS は印に当てる
//  3. 見つけたバーが Immersion の中で実際に押せるかを当たり判定で確かめ、
//     押せなければ自前の最小限のバー(前へ・再生・次へ・シーク)を出す。
//     自前のバーは <video> と YTM のキー操作だけで動き、YTM の DOM に頼らない
//
// 今どの段で動いているかは <html data-ytmi-bar-status="classic|wiz|generic|none">
// と data-ytmi-fallback に出す。問い合わせを受けた時に開発者ツールで見られる。
const PlayerBar = (() => {
  const KNOWN = [
    ['ytmusic-player-bar', 'classic'],
    ['ytmusic-miniplayer', 'wiz'],
  ];
  // 自前の要素。形で探す時に拾わない
  const OWN_SELECTOR = '#ytm-custom-wrapper, #ytm-custom-bg, #my-mode-toggle, #ytmi-fallback-bar';
  // バーの中の「再生位置」。どの作りでもシークバーは必ずある
  const SLIDER_SELECTOR = '[role="slider"], input[type="range"], progress';
  // 知っている作りのシークバー(旧バー / 新バー)
  const KNOWN_SEEK_SELECTOR = 'tp-yt-paper-slider#progress-bar, input.ytMusicMiniPlayerProgressBar';
  const CONTROL_SELECTOR = 'button, [role="button"], a[href], input';
  // 形で探すのは重いので、知っている作りが見つからない時だけ、間を空けて
  const GENERIC_SCAN_INTERVAL_MS = 3000;
  const GENERIC_SCAN_DEPTH = 6;

  let adopted = null;
  let adoptedVariant = 'none';
  let lastGenericScan = -Infinity;

  const setStatus = (key, value) => {
    try { document.documentElement.dataset[key] = value; } catch (e) { /* 出せなくても動作には関係ない */ }
  };

  // 画面の下に固定された横長の要素で、再生位置のスライダーと操作を持つもの
  const looksLikePlayerBar = (el, vw, vh) => {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    if (el.closest && el.closest(OWN_SELECTOR)) return false;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
    const r = el.getBoundingClientRect();
    if (r.width < vw * 0.5 || r.height < 40 || r.height > 200) return false;
    if (r.bottom < vh - 48 || r.top > vh) return false;
    if (!el.querySelector(SLIDER_SELECTOR)) return false;
    return el.querySelectorAll(CONTROL_SELECTOR).length >= 3;
  };

  const findGeneric = () => {
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (!vw || !vh || !document.body) return null;
    // 浅い所から広げる。YTM のバーはどちらの作りも body から 3 段目にいる
    let level = [...document.body.children];
    for (let depth = 0; depth < GENERIC_SCAN_DEPTH && level.length; depth++) {
      const next = [];
      for (const el of level) {
        if (el.matches && el.matches(OWN_SELECTOR)) continue;
        if (looksLikePlayerBar(el, vw, vh)) return el;
        next.push(...el.children);
      }
      level = next;
    }
    return null;
  };

  function clearMarks() {
    document.querySelectorAll('[data-ytmi-bar]').forEach(el => el.removeAttribute('data-ytmi-bar'));
    document.querySelectorAll('[data-ytmi-bar-path]').forEach(el => el.removeAttribute('data-ytmi-bar-path'));
  }

  // 印を付ける。祖先の印は、CSS で「祖先ごと隠す・重なりの下に閉じ込める」
  // を打ち消すのに使う(未知の作りでは、バーがどこにいるか分からない)
  const adopt = (el, variant) => {
    // 同じバーでも、YTM が別の親へ移していたら祖先の印を付け直す
    const parent = el.parentElement;
    const pathMarked = !parent || parent === document.body || parent.hasAttribute('data-ytmi-bar-path');
    if (adopted === el && el.getAttribute('data-ytmi-bar') === variant && pathMarked) return;
    clearMarks();
    adopted = el;
    adoptedVariant = variant;
    el.setAttribute('data-ytmi-bar', variant);
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      p.setAttribute('data-ytmi-bar-path', '');
    }
    setStatus('ytmiBarStatus', variant);
    if (variant === 'generic') {
      YTMLog.log('YTM Immersion: 知らない作りのプレイヤーバーを形で見つけた', el.tagName.toLowerCase());
    }
  };

  const release = () => {
    if (adopted) clearMarks();
    adopted = null;
    adoptedVariant = 'none';
    setStatus('ytmiBarStatus', 'none');
  };

  const isRendered = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const isPlayingSomething = () => {
    const v = document.querySelector('video');
    return !!(v && (v.currentSrc || v.src));
  };

  // 知っている作りのバーが幾つも在る時に、どれを使うか。
  // 新バーは窓を狭くすると、プレイヤーページの中にもう 1 つ(シークバーの
  // 無い上端用)を作り、広げてもそちらを display:none で残す。先に見つかった
  // 方を取ると、狭い窓ではシークできない方を、広い窓では描かれていない方を
  // 掴み、自前のバーや「形で探す」に落ちていた(実機)。旧バーも窓を狭くすると
  // 2 つになり、どちらもシークバーを持つ。隠す方には YTM が style 属性で
  // display:none / visibility:hidden を付ける(広い窓ではプレイヤーページの中の方、
  // 狭い窓では下の方)。
  // シークバーを持っている > YTM が隠していない > 描かれている > 先に在る、の順で選ぶ。
  // 描かれているかは Immersion の CSS が出し直すので当てにならない。style 属性は
  // こちらからは --ytmi-bar-display しか触らないので、YTM の意図がそのまま読める。
  // 旧バーの上端用(top-player-bar)はシークバーの要素を持つが、YTM の CSS で
  // シークバー自体を display:none にしている。要素が在るだけで数えると、狭い
  // 窓で下のバーと同点になり、シークバーも IMMERSION も見えない上端用を
  // Immersion の下に浮かせていた(実機)。知っている作りなのでシークバーそのもの
  // (音量のスライダーは数えない。旧バーはどちらにも出ている)を探し、それ自身が
  // 消されていないかで見る(祖先のバーごと隠れていても、自身の display は変わらない)。
  const hiddenByYtm = (el) => !!el.style && (el.style.display === 'none' || el.style.visibility === 'hidden');
  const hasSeekBar = (el) => [...el.querySelectorAll(KNOWN_SEEK_SELECTOR)].some(s => getComputedStyle(s).display !== 'none');
  const rankKnown = (el) => (hasSeekBar(el) ? 4 : 0)
    + (hiddenByYtm(el) ? 0 : 2)
    + (isRendered(el) ? 1 : 0);

  // 今のバー。見つからなければ null。
  // 呼ばれる回数が多い(tick ごと)ので、少しの間は前の答えを使う。
  const CACHE_MS = 500;
  let lastResolved = -Infinity;
  const get = () => {
    const now = performance.now();
    if (adopted && adopted.isConnected && now - lastResolved < CACHE_MS) return adopted;
    lastResolved = now;
    // 知っている作りのうち一番使えそうなもの(rankKnown)。作り直しの途中で
    // 古いバーが空のまま残る作りもありうるので、在るだけでは決めない。
    let best = null;
    let bestVariant = 'none';
    let bestRank = -1;
    for (const [selector, v] of KNOWN) {
      for (const el of document.querySelectorAll(selector)) {
        const rank = rankKnown(el);
        if (rank > bestRank) {
          best = el;
          bestVariant = v;
          bestRank = rank;
        }
      }
    }
    if (best && isRendered(best)) {
      adopt(best, bestVariant);
      return best;
    }
    // 形で拾ったバーは、YTM が一時的に隠していても(プレイヤーページを
    // 開いている間だけ消す作りなど)手放さない。CSS が出し直す。
    if (adopted && adopted.isConnected && adoptedVariant === 'generic') return adopted;
    // 知っている作りが見当たらない、または在るのに再生中なのに描かれていない
    if (!best || isPlayingSomething()) {
      if (now - lastGenericScan >= GENERIC_SCAN_INTERVAL_MS) {
        lastGenericScan = now;
        const el = findGeneric();
        if (el) {
          adopt(el, 'generic');
          return el;
        }
      }
    }
    // まだ何も再生していない間は、知っている作りのバーが隠れているのが普通
    if (best) {
      adopt(best, bestVariant);
      return best;
    }
    release();
    return null;
  };

  const variant = () => (adopted && adopted.isConnected ? adoptedVariant : 'none');

  // ── 高評価 ──
  // PiP の ☆ が使う。以前は ytmusic-player-bar の中だけを見ていたので、
  // 新バーでは何も見つからず押しても効かず、旧バーが残っている作りでは
  // 更新の止まった方を読んで前の曲の状態のままになっていた。
  // 使っているバーの中から探す。狭い窓の新バーのように同じ作りのバーが
  // もう 1 つ在れば、そちらも見る(同じ曲の状態を映している)。
  //  ・旧バー: ytmusic-like-button-renderer(like-status 属性も持つ)
  //  ・新バー: 右の列の yt-video-action-bar-view-model の like-button-view-model
  //    (ログインしていないと出ない)
  const LIKE_BUTTON_SELECTOR = [
    'ytmusic-like-button-renderer #button-shape-like button',
    'ytmusic-like-button-renderer .like button',
    'like-button-view-model button',
  ].join(', ');
  const likeScopes = () => {
    const bar = get();
    if (!bar) return [document];
    const known = KNOWN.find(([, v]) => v === adoptedVariant);
    const twins = known ? [...document.querySelectorAll(known[0])].filter(el => el !== bar) : [];
    return [bar, ...twins];
  };
  const findLikeButton = () => {
    for (const scope of likeScopes()) {
      const btn = scope.querySelector(LIKE_BUTTON_SELECTOR);
      if (btn) return btn;
    }
    return null;
  };
  // true / false / null(分からない: ボタンが無い)
  const readLiked = () => {
    for (const scope of likeScopes()) {
      const btn = scope.querySelector(LIKE_BUTTON_SELECTOR);
      if (btn && btn.hasAttribute('aria-pressed')) return btn.getAttribute('aria-pressed') === 'true';
      const renderer = scope.querySelector('[like-status]');
      if (renderer) return renderer.getAttribute('like-status') === 'LIKE';
    }
    return null;
  };
  const toggleLike = () => {
    const btn = findLikeButton();
    if (!btn) return false;
    btn.click();
    return true;
  };

  // YTM が「プレイヤーページを開いている間はバーを display:none にする」
  // ような作りに変えても出せるよう、見えていた時の display を控えておく。
  // CSS は Immersion 中だけ、控えた値で出す。
  // YTM は窓の幅でも並べ方を変える(新バーは狭い時の小さな作りだけ flex、
  // ふだんは 3 列の grid)。Immersion を開いたまま窓を広げると、控えた flex が
  // 残って 3 列が崩れ、右の列が再生ボタンに重なっていた。窓の大きさが
  // 変わった時は probe で、控えた値の上書きを一瞬外して YTM 本来の値を読む
  // (同じ処理の中で戻すので描かれない)。
  const rememberDisplay = (el, probe = false) => {
    if (!el || !el.isConnected) return;
    let d;
    if (probe) {
      const prev = el.style.getPropertyValue('--ytmi-bar-display');
      if (prev) el.style.removeProperty('--ytmi-bar-display');
      d = getComputedStyle(el).display;
      if (prev) el.style.setProperty('--ytmi-bar-display', prev);
    } else {
      d = getComputedStyle(el).display;
    }
    if (!d || d === 'none' || d === 'contents') return;
    if (el.style.getPropertyValue('--ytmi-bar-display') !== d) {
      el.style.setProperty('--ytmi-bar-display', d);
    }
  };

  // ── 押せるかどうか ──────────────────────────────────────
  // 見えている(getClientRects が在る)だけでは足りない。Immersion の
  // 全面の層の下に潜っていたり、祖先ごと透明にされていたりすると、
  // 画面に何も無いのに「在る」ことになる。実際にその位置を押した時に
  // 何に当たるかで判断する。
  // 戻り値: true(押せる)/ false(押せない)/ null(一時的に覆われていて判断しない)
  // 窓の形のダイアログ(︙ の「曲のクレジットを表示」など)は、開いている間
  // 画面全体を覆う幕(tp-yt-iron-overlay-backdrop)を body の直下に敷く。
  // ダイアログの外の当たり判定はこの幕に当たるので、幕も一時的な覆いに数える。
  // 数えないと、クレジットを見ている間だけ自前のバーに切り替わり、
  // ダイアログの手前に出ていた(実機)
  const TRANSIENT_COVER_SELECTOR = [
    'ytmusic-popup-container', 'tp-yt-iron-dropdown', 'tp-yt-paper-dialog', 'ytmusic-dialog',
    'tp-yt-iron-overlay-backdrop', 'iron-overlay-backdrop',
    '[role="dialog"]', '[role="menu"]', '[role="listbox"]', '[role="tooltip"]',
  ].join(', ');
  const isOwnOverlay = (el) => {
    if (!el || !el.closest) return false;
    // Immersion の全面の層そのもの・その中身に当たるのは「バーが下に潜っている」
    if (el.closest('#ytm-custom-wrapper, #ytm-custom-bg')) return false;
    // それ以外の自前の浮いた部品(設定・歌詞カードなど)は一時的な覆い
    const own = el.closest('[id^="ytm-"], [class*="ytm-"]');
    return !!own && own !== document.body && own !== document.documentElement;
  };
  const probeUsable = (target, ignore) => {
    if (!target || !target.isConnected || typeof document.elementsFromPoint !== 'function') return false;
    const r = target.getBoundingClientRect();
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    if (r.width < 24 || r.height < 16) return false;
    if (r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw) return false;
    const y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
    let hits = 0;
    let transient = 0;
    const fractions = r.width > 200 ? [0.2, 0.5, 0.8] : [0.5];
    for (const fx of fractions) {
      const x = Math.min(vw - 1, Math.max(0, r.left + r.width * fx));
      const stack = document.elementsFromPoint(x, y);
      const top = stack.find(el => !(ignore && ignore.some(i => i && i.contains(el))));
      if (!top) continue;
      if (target.contains(top)) hits++;
      else if (top.closest(TRANSIENT_COVER_SELECTOR) || isOwnOverlay(top)) transient++;
    }
    const need = fractions.length > 1 ? 2 : 1;
    if (hits >= need) return true;
    if (transient > 0) return null;
    return false;
  };

  // ── 自前のバー ─────────────────────────────────────────
  // YTM のバーが押せない時だけ出す。飾り(光・光沢・白い丸・浮いた吹き出し)
  // は付けず、平らな面と文字とアイコンだけで作る。その代わり、バーそのもの
  // を進み具合にする: ジャケットの色が再生に合わせて左からバーを満たし、
  // 色の境目が今の位置になる。ボタン以外の所を押せば、そこへ飛ぶ。
  //  ・並び: [前へ 再生 次へ] [経過 / 長さ] … [音量 シャッフル IMMERSION ▼]
  //  ・GPU を無駄に使わない: 背景のすりガラス(動く背景を毎フレームぼかし
  //    直す)は使わない。進み具合は transform のアニメーションで合成スレッド
  //    に任せ、JS は毎フレーム何もしない
  //
  // 操作は YTM の DOM に頼らない:
  //  ・再生/一時停止・シーク・状態の表示 … 標準の <video>
  //  ・曲送り・シャッフル・音量・ミュート … YTM の公開ショートカット
  //    (j/k/s/=/-/m。実機で新旧どちらのバーでも効くことを確かめた)。
  //    音量を <video> へ直に入れると YTM の音量と食い違うので、キーで動かし、
  //    表示は結果の <video> から読む。キーが効かなくなっていたら <video> を直に動かす
  // 高評価・リピートは置かない。今どうなっているかを YTM の画面なしでは
  // 読めず、押すたびに入れ替わるので、表示できないまま置くと誤って取り消す。
  const pressYtmKey = (key, code) => {
    const init = { key, code, bubbles: true, cancelable: true, composed: true };
    document.body.dispatchEvent(new KeyboardEvent('keydown', init));
    document.body.dispatchEvent(new KeyboardEvent('keyup', init));
  };
  const getVideo = () => document.querySelector('video');

  // YTM の音量は 1 段ごとに約 0.73 倍(実機: 1 → 0.74 → 0.55 → 0.4 → 0.29 …)。
  // つまみの位置は耳の感じ方に近い段の数で表す。10 段で 0.043 まで下がる。
  const VOLUME_SPAN = 3.15;
  const volumeToLevel = (v) => (v > 0 ? Math.min(1, Math.max(0, 1 + Math.log(v) / VOLUME_SPAN)) : 0);
  const levelToVolume = (p) => (p <= 0 ? 0 : Math.min(1, Math.exp((p - 1) * VOLUME_SPAN)));

  const controls = {
    next: () => pressYtmKey('j', 'KeyJ'),
    prev: () => pressYtmKey('k', 'KeyK'),
    shuffle: () => pressYtmKey('s', 'KeyS'),
    togglePlay: () => {
      const v = getVideo();
      if (!v) return;
      if (v.paused) {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => { });
      } else {
        v.pause();
      }
    },
    toggleMute: () => {
      const v = getVideo();
      if (!v) return;
      const before = v.muted;
      pressYtmKey('m', 'KeyM');
      if (v.muted === before) v.muted = !before;
    },
    // 目標の段まで =/- を送る。1 回ごとに結果を読んで止める
    setVolumeLevel: (level) => {
      const v = getVideo();
      if (!v) return;
      if (level <= 0.02) {
        if (!v.muted) controls.toggleMute();
        return;
      }
      if (v.muted) controls.toggleMute();
      // 右端まで寄せたら、上がらなくなるまで上げる(近い所で止めると 98 などで止まる)
      if (level >= 0.97) {
        for (let i = 0; i < 12 && v.volume < 1; i++) {
          const cur = v.volume;
          pressYtmKey('=', 'Equal');
          if (v.volume === cur) {
            v.volume = 1;
            break;
          }
        }
        return;
      }
      const target = levelToVolume(level);
      for (let i = 0; i < 30; i++) {
        const cur = v.volume;
        let key = null;
        if (cur < target / 1.17) key = ['=', 'Equal'];
        else if (cur > target * 1.17) key = ['-', 'Minus'];
        if (!key) return;
        pressYtmKey(key[0], key[1]);
        if (v.volume === cur) {
          v.volume = target;
          return;
        }
      }
    },
    stepVolume: (dir) => {
      const v = getVideo();
      if (!v) return;
      if (v.muted && dir > 0) controls.toggleMute();
      const cur = v.volume;
      pressYtmKey(dir > 0 ? '=' : '-', dir > 0 ? 'Equal' : 'Minus');
      if (v.volume === cur) v.volume = Math.min(1, Math.max(0, cur * (dir > 0 ? 1 / 0.73 : 0.73)));
    },
  };


  const svg = (inner, filled) => filled
    ? `<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${inner}</svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const ICONS = {
    prev: svg('<rect x="5" y="5.5" width="2.2" height="13" rx="1.1"/><path d="M9.6 12.9a1.05 1.05 0 0 1 0-1.8l7.8-5.2A1.05 1.05 0 0 1 19 6.8v10.4a1.05 1.05 0 0 1-1.6.9z"/>', true),
    next: svg('<rect x="16.8" y="5.5" width="2.2" height="13" rx="1.1"/><path d="M14.4 12.9a1.05 1.05 0 0 0 0-1.8L6.6 5.9A1.05 1.05 0 0 0 5 6.8v10.4a1.05 1.05 0 0 0 1.6.9z"/>', true),
    play: svg('<path d="M7.5 5.2v13.6a1 1 0 0 0 1.5.86l10.7-6.8a1 1 0 0 0 0-1.72L9 4.34a1 1 0 0 0-1.5.86z"/>', true),
    pause: svg('<rect x="6" y="4.5" width="4" height="15" rx="1.2"/><rect x="14" y="4.5" width="4" height="15" rx="1.2"/>', true),
    volHigh: svg('<path d="M4.5 9.6v4.8h3.2l4.3 3.6V6L7.7 9.6z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6"/><path d="M18 6.6a7.6 7.6 0 0 1 0 10.8"/>'),
    volLow: svg('<path d="M4.5 9.6v4.8h3.2l4.3 3.6V6L7.7 9.6z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6"/>'),
    volMute: svg('<path d="M4.5 9.6v4.8h3.2l4.3 3.6V6L7.7 9.6z"/><path d="m16 10 4 4m0-4-4 4"/>'),
    shuffle: svg('<path d="M4 7.5h2.6c1.5 0 2.9.8 3.7 2l3.4 5c.8 1.2 2.2 2 3.7 2H20"/><path d="M4 16.5h2.6c1.5 0 2.9-.8 3.7-2l.3-.5m3-4.5.4-.5c.8-1.2 2.2-2 3.7-2H20"/><path d="m17.6 5.2 2.4 2.3-2.4 2.3M17.6 14.2l2.4 2.3-2.4 2.3"/>'),
    minimize: svg('<path d="m7 10 5 5 5-5"/>'),
  };

  const label = (key, fallbackText) => {
    try {
      if (typeof t === 'function') {
        const s = t(key);
        if (s && s !== key) return s;
      }
    } catch (e) { /* 文言が引けなければ英語で */ }
    return fallbackText;
  };

  const formatTime = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const s = Math.floor(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  };

  // ── 曲の色 ──
  // バーを満たす色は、ジャケットを見た人が「この色」と思う色でなければ
  // ならない。鮮やかな所を重く見ると、背景の一部(実機: 紫の卓の上の
  // 青いカーテン)が選ばれて「どこから来た色か分からない」になった。
  // そこで、ジャケットの主役が居る真ん中ほど重く数え、似た色をまとめた
  // 箱のうち一番大きいものを取る。取れた色は、白いアイコンが読める深さに
  // 沈める(色味は変えない)。ほぼ灰色なら null(色を付けない)。
  const rgbToHsl = (r, g, b) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h / 6, s, l];
  };
  const hslToRgb = (h, s, l) => {
    const f = (n) => {
      const k = (n + h * 12) % 12;
      const a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
  };
  const tintFromPixels = (data, size = Math.round(Math.sqrt((data && data.length) / 4))) => {
    if (!data || !data.length || !size) return null;
    const buckets = new Map();
    const sigma2 = 2 * 0.22 * 0.22;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const sat = max ? (max - Math.min(r, g, b)) / max : 0;
      const p = i / 4;
      const dx = ((p % size) + 0.5) / size - 0.5;
      const dy = (Math.floor(p / size) + 0.5) / size - 0.5;
      const weight = (1 + sat * 0.5) * Math.exp(-(dx * dx + dy * dy) / sigma2);
      const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
      let e = buckets.get(key);
      if (!e) buckets.set(key, (e = { w: 0, n: 0, r: 0, g: 0, b: 0 }));
      e.w += weight; e.n++; e.r += r; e.g += g; e.b += b;
    }
    let best = null;
    for (const e of buckets.values()) if (!best || e.w > best.w) best = e;
    const [h, s, l] = rgbToHsl(best.r / best.n, best.g / best.n, best.b / best.n);
    if (s < 0.08 || l < 0.04 || l > 0.97) return null;
    return hslToRgb(h, Math.min(0.6, s), Math.min(0.4, Math.max(0.3, l * 0.6)));
  };
  const setTint = (rgb) => {
    const root = document.documentElement;
    if (Array.isArray(rgb) && rgb.length === 3) root.style.setProperty('--ytmi-tint', rgb.join(', '));
    else root.style.removeProperty('--ytmi-tint');
  };

  // lyrics-ui から受け取るもの(configure)
  //  offset      … 曲の始まった video 時刻。YTM は連続再生で video の時刻を
  //                0 に戻さないことがあるので、曲内の時刻はこれを引いて出す
  //  canMinimize … ▼(プレイヤーを畳む)を出せるか
  //  minimize    … ▼ を押した時
  const hooks = {
    offset: () => 0,
    canMinimize: () => false,
    minimize: () => { },
  };

  let fallbackEl = null;
  let fallbackOn = false;
  const parts = {};
  // バーを押さえている間の、曲内の時刻(離すまで video は動かさない)
  let dragTime = null;

  const currentOffset = () => {
    const v = getVideo();
    const off = Number(hooks.offset()) || 0;
    // 頭から掛け直されていれば、offset はもう当てはまらない
    return (v && off > 0 && v.currentTime < off) ? 0 : off;
  };
  const readTimes = () => {
    const v = getVideo();
    const off = currentOffset();
    const dur = v && Number.isFinite(v.duration) ? Math.max(0, v.duration - off) : 0;
    const cur = v ? Math.min(dur || Infinity, Math.max(0, v.currentTime - off)) : 0;
    return { v, off, dur, cur };
  };

  const btn = (act, cls = '', inner = '') => `<button type="button" class="ytmi-fb-btn ${cls}" data-act="${act}">${inner}</button>`;

  // 重なり: 色の層(一番下)→ シークの層(ボタン以外の所を受ける)→ ボタン類
  const buildFallback = () => {
    if (fallbackEl && fallbackEl.isConnected) return fallbackEl;
    const bar = document.createElement('div');
    bar.id = 'ytmi-fallback-bar';
    bar.setAttribute('role', 'toolbar');
    bar.innerHTML = `
      <div class="ytmi-fb-clip" aria-hidden="true"><div class="ytmi-fb-fill"></div></div>
      <div class="ytmi-fb-scrub" role="slider" tabindex="0" aria-valuemin="0">
        <div class="ytmi-fb-hover"></div>
        <div class="ytmi-fb-tip"></div>
      </div>
      <div class="ytmi-fb-row">
        <div class="ytmi-fb-transport">
          ${btn('prev', '', ICONS.prev)}${btn('play', 'ytmi-fb-play')}${btn('next', '', ICONS.next)}
        </div>
        <div class="ytmi-fb-center">
          <span class="ytmi-fb-time"></span>
        </div>
        <div class="ytmi-fb-right">
          <div class="ytmi-fb-volume">
            <div class="ytmi-fb-volslider" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100">
              <div class="ytmi-fb-voltrack"><div class="ytmi-fb-volfill"></div></div>
            </div>
            ${btn('mute', 'ytmi-fb-mute')}
          </div>
          ${btn('shuffle', '', ICONS.shuffle)}
          <span class="ytmi-fb-toggle-slot"></span>
          ${btn('minimize', 'ytmi-fb-minimize', ICONS.minimize)}
        </div>
      </div>`;
    for (const [key, sel] of Object.entries({
      fill: '.ytmi-fb-fill', scrub: '.ytmi-fb-scrub', hover: '.ytmi-fb-hover', tip: '.ytmi-fb-tip',
      time: '.ytmi-fb-time',
      play: '.ytmi-fb-play', mute: '.ytmi-fb-mute', volslider: '.ytmi-fb-volslider',
      volfill: '.ytmi-fb-volfill', minimize: '.ytmi-fb-minimize',
    })) parts[key] = bar.querySelector(sel);
    applyLabels(bar);

    bar.addEventListener('click', (e) => {
      const b = e.target.closest && e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'prev') controls.prev();
      else if (act === 'next') controls.next();
      else if (act === 'play') controls.togglePlay();
      else if (act === 'mute') controls.toggleMute();
      else if (act === 'minimize') hooks.minimize();
      else if (act === 'shuffle') controls.shuffle();
    });
    setupScrub(parts.scrub);
    setupVolume(bar.querySelector('.ytmi-fb-volume'));

    document.body.appendChild(bar);
    fallbackEl = bar;
    return bar;
  };

  const applyLabels = (bar) => {
    const set = (el, text) => {
      if (!el) return;
      el.setAttribute('aria-label', text);
      el.setAttribute('title', text);
    };
    bar.setAttribute('aria-label', 'YTM Immersion');
    set(bar.querySelector('[data-act="prev"]'), label('fb_prev', 'Previous'));
    set(bar.querySelector('[data-act="next"]'), label('fb_next', 'Next'));
    set(bar.querySelector('[data-act="shuffle"]'), label('fb_shuffle', 'Shuffle'));
    set(bar.querySelector('[data-act="minimize"]'), label('fb_minimize', 'Close player'));
    parts.scrub.setAttribute('aria-label', label('fb_seek', 'Seek'));
    parts.volslider.setAttribute('aria-label', label('fb_volume', 'Volume'));
  };

  // ── 進み具合(バー全体) ──
  // 曲の色の層を、バーと同じ幅のまま左へずらしておき、再生に合わせて
  // 右へ戻す。右端が今の位置になる。
  // 毎フレーム JS で幅を書き換えるとレイアウトが毎回走るので、transform の
  // アニメーションを「残り時間 ÷ 再生速度」の長さで 1 本だけ組み、合成
  // スレッドに任せる。組み直すのは再生・停止・シーク・速度や長さが変わった
  // 時だけ。ずれは時刻の知らせのたびに確かめ、0.25 秒を超えたら組み直す。
  let fillAnim = null;
  const fillTransform = (ratio) => `translateX(${((Math.min(1, Math.max(0, ratio)) - 1) * 100).toFixed(4)}%)`;
  const stopFill = () => {
    if (fillAnim) {
      fillAnim.cancel();
      fillAnim = null;
    }
  };
  const syncFill = () => {
    if (!fallbackEl) return;
    const { v, dur, cur } = readTimes();
    const shown = dragTime !== null ? dragTime : cur;
    const ratio = dur ? shown / dur : 0;
    stopFill();
    parts.fill.style.transform = fillTransform(ratio);
    const rate = v ? v.playbackRate || 1 : 1;
    const running = v && !v.paused && !v.ended && v.readyState > 2 && dur > 0 && dragTime === null && !document.hidden;
    if (!running || typeof parts.fill.animate !== 'function') return;
    const remainingMs = Math.max(0, (dur - cur) / rate) * 1000;
    if (remainingMs < 50) return;
    fillAnim = parts.fill.animate(
      [{ transform: fillTransform(ratio) }, { transform: fillTransform(1) }],
      { duration: remainingMs, easing: 'linear', fill: 'forwards' },
    );
    fillAnim.__start = { cur, rate, at: performance.now() };
  };
  // 走っているアニメーションが、今の再生位置からずれていないか
  const fillDrifted = () => {
    if (!fillAnim || !fillAnim.__start) return true;
    const { cur } = readTimes();
    const s = fillAnim.__start;
    const expected = s.cur + ((performance.now() - s.at) / 1000) * s.rate;
    return Math.abs(expected - cur) > 0.25;
  };

  // ── バーのどこでもシーク ──
  // ボタン以外の所に乗せると細い縦線と時刻が出て、押す・ドラッグでそこへ
  // 飛ぶ。押さえている間は色の層だけ動かし、離した時に 1 回だけ飛ぶ。
  const ratioAt = (clientX) => {
    const r = fallbackEl.getBoundingClientRect();
    return r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
  };
  const setupScrub = (el) => {
    const point = (clientX) => {
      const r = fallbackEl.getBoundingClientRect();
      const x = Math.min(r.width, Math.max(0, clientX - r.left));
      const { dur } = readTimes();
      parts.hover.style.transform = `translateX(${x}px)`;
      parts.tip.style.transform = `translateX(${x}px) translateX(-50%)`;
      parts.tip.textContent = formatTime((x / (r.width || 1)) * dur);
    };
    el.addEventListener('pointermove', (e) => {
      point(e.clientX);
      if (dragTime !== null) {
        dragTime = ratioAt(e.clientX) * readTimes().dur;
        paintTime();
        syncFill();
      }
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const { dur } = readTimes();
      if (!dur) return;
      el.setPointerCapture(e.pointerId);
      fallbackEl.classList.add('is-scrubbing');
      dragTime = ratioAt(e.clientX) * dur;
      point(e.clientX);
      paintTime();
      syncFill();
    });
    const release = (commit) => {
      if (dragTime === null) return;
      const v = getVideo();
      if (commit && v) v.currentTime = dragTime + currentOffset();
      dragTime = null;
      fallbackEl.classList.remove('is-scrubbing');
      paintTime();
      syncFill();
    };
    el.addEventListener('pointerup', () => release(true));
    el.addEventListener('pointercancel', () => release(false));
    el.addEventListener('keydown', (e) => {
      const v = getVideo();
      const { dur, cur, off } = readTimes();
      if (!v || !dur) return;
      let next = null;
      if (e.key === 'ArrowLeft') next = cur - 5;
      else if (e.key === 'ArrowRight') next = cur + 5;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = dur - 1;
      if (next === null) return;
      e.preventDefault();
      e.stopPropagation();
      v.currentTime = Math.min(dur, Math.max(0, next)) + off;
    });
  };

  // ── 音量 ──
  // アイコンに乗せると左へスライダーが伸びる。ホイールでも上げ下げできる。
  const setupVolume = (wrap) => {
    const slider = parts.volslider;
    let dragging = false;
    const levelAt = (clientX) => {
      const r = slider.querySelector('.ytmi-fb-voltrack').getBoundingClientRect();
      return r.width ? Math.min(1, Math.max(0, (clientX - r.left) / r.width)) : 0;
    };
    slider.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      slider.setPointerCapture(e.pointerId);
      wrap.classList.add('is-dragging');
      controls.setVolumeLevel(levelAt(e.clientX));
    });
    slider.addEventListener('pointermove', (e) => {
      if (dragging) controls.setVolumeLevel(levelAt(e.clientX));
    });
    const end = () => {
      dragging = false;
      wrap.classList.remove('is-dragging');
    };
    slider.addEventListener('pointerup', end);
    slider.addEventListener('pointercancel', end);
    slider.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation();
      controls.stepVolume(e.key === 'ArrowRight' ? 1 : -1);
    });
    wrap.addEventListener('wheel', (e) => {
      e.preventDefault();
      controls.stepVolume(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  };

  // ── 描く ──
  // 文字は 1 秒に 1 回だけ書き換える(timeupdate は 1 秒に 4 回来る)
  let lastTimeText = '';
  const paintTime = () => {
    if (!fallbackEl) return;
    const { dur, cur } = readTimes();
    const shown = dragTime !== null ? dragTime : cur;
    const text = `${formatTime(shown)} / ${formatTime(dur)}`;
    fallbackEl.classList.toggle('ytmi-fb-no-duration', !dur);
    if (text === lastTimeText) return;
    lastTimeText = text;
    parts.time.textContent = text;
    parts.scrub.setAttribute('aria-valuemax', String(Math.round(dur)));
    parts.scrub.setAttribute('aria-valuenow', String(Math.floor(shown)));
    parts.scrub.setAttribute('aria-valuetext', text);
  };

  const paintPlayState = () => {
    if (!fallbackEl) return;
    const v = getVideo();
    const icon = v && !v.paused ? 'pause' : 'play';
    if (parts.play.dataset.icon === icon) return;
    parts.play.dataset.icon = icon;
    parts.play.innerHTML = ICONS[icon];
    const text = icon === 'pause' ? label('fb_pause', 'Pause') : label('fb_play', 'Play');
    parts.play.setAttribute('aria-label', text);
    parts.play.setAttribute('title', text);
  };

  const paintVolume = () => {
    if (!fallbackEl) return;
    const v = getVideo();
    const muted = !v || v.muted || v.volume === 0;
    const level = muted ? 0 : volumeToLevel(v.volume);
    const icon = muted ? 'volMute' : (level < 0.5 ? 'volLow' : 'volHigh');
    if (parts.mute.dataset.icon !== icon) {
      parts.mute.dataset.icon = icon;
      parts.mute.innerHTML = ICONS[icon];
      const text = muted ? label('fb_unmute', 'Unmute') : label('fb_mute', 'Mute');
      parts.mute.setAttribute('aria-label', text);
      parts.mute.setAttribute('title', text);
    }
    parts.volfill.style.transform = `scaleX(${level})`;
    parts.volslider.setAttribute('aria-valuenow', String(Math.round(level * 100)));
  };

  const paintMinimize = () => {
    if (!fallbackEl) return;
    let can = false;
    try { can = !!hooks.canMinimize(); } catch (e) { can = false; }
    parts.minimize.hidden = !can;
  };

  const paintAll = () => {
    paintTime();
    paintPlayState();
    paintVolume();
    paintMinimize();
    syncFill();
  };

  // 再生の知らせは video が差し替わっても届くよう、document の捕捉で受ける
  // (メディアのイベントは泡立たないが、捕捉なら祖先に届く)
  const onMediaEvent = (e) => {
    if (!fallbackOn || !(e.target instanceof HTMLMediaElement)) return;
    switch (e.type) {
      case 'timeupdate':
        paintTime();
        if (fillDrifted() && !getVideo()?.paused) syncFill();
        break;
      case 'volumechange': paintVolume(); break;
      case 'play': case 'pause': paintPlayState(); syncFill(); break;
      default: paintTime(); syncFill();
    }
  };
  const onVisibility = () => { if (fallbackOn) syncFill(); };
  let mediaListening = false;
  const listenMedia = (on) => {
    if (on === mediaListening) return;
    mediaListening = on;
    const method = on ? 'addEventListener' : 'removeEventListener';
    ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked', 'ratechange', 'play', 'pause', 'playing', 'waiting', 'ended', 'emptied', 'volumechange']
      .forEach(type => document[method](type, onMediaEvent, true));
    document[method]('visibilitychange', onVisibility);
  };

  const setFallback = (on) => {
    on = !!on;
    if (on === fallbackOn && (!on || (fallbackEl && fallbackEl.isConnected))) return false;
    fallbackOn = on;
    if (on) {
      buildFallback();
      paintAll();
      YTMLog.log('YTM Immersion: プレイヤーバーが押せないので、自前のバーを出す');
    } else {
      stopFill();
    }
    document.body.classList.toggle('ytmi-fallback-bar-on', on);
    listenMedia(on);
    setStatus('ytmiFallback', on ? '1' : '0');
    return true;
  };

  // ── Immersion 中の見張り ────────────────────────────────
  // 一瞬覆われた(メニューが開いた等)だけで切り替えないよう、続けて
  // 押せなかった時だけ自前のバーを出す。押せるようになれば戻す。
  const FAIL_THRESHOLD = 2;
  let failCount = 0;
  // YTM がシークバーを押せなくしている(disabled)。狭い窓の旧バーは、
  // プレイヤーページを開いている間ミニ表示に変わり、シークバーを disabled に
  // して並びも変える(シークはプレイヤーページの中で行う作り)。Immersion は
  // そのプレイヤーページを覆うので、シークする手段が無くなっていた(実機)。
  // ボタンは押せるので当たり判定では見分けられない。広告中は数えない
  // (広告の間はシークできないのが普通)。
  const seekDisabledByYtm = (bar) => {
    const seek = bar && bar.querySelector(KNOWN_SEEK_SELECTOR);
    if (!seek || !(seek.hasAttribute('disabled') || seek.getAttribute('aria-disabled') === 'true')) return false;
    return !document.querySelector('.ad-showing, .ad-interrupting');
  };
  let fallbackForSeek = false;
  let seekFailCount = 0;
  // この理由で自前のバーを出している間は、YTM のバーを隠す(見えたままだと
  // 自前のバーの後ろに透けて重なる)。押せない(潜っている)理由で出す時は
  // 隠さない。隠すと、押せるように戻ったかを当たり判定で確かめられない
  const setFallbackForSeek = (on) => {
    fallbackForSeek = on;
    document.body.classList.toggle('ytmi-fallback-seek', on);
  };
  // 戻り値: 自前のバーの出し入れが変わったか
  const check = ({ shown, skip }) => {
    if (!shown) {
      failCount = 0;
      seekFailCount = 0;
      setFallbackForSeek(false);
      return setFallback(false);
    }
    // 動画モードでバーが隠れていても判断できる(当たり判定を使わない)ので先に見る。
    // 曲の切り替わりの一瞬だけ押せないこともあるので、続けて押せない時だけ
    const bar = get();
    if (seekDisabledByYtm(bar)) {
      if (++seekFailCount < FAIL_THRESHOLD) return false;
      setFallbackForSeek(true);
      return setFallback(true);
    }
    seekFailCount = 0;
    if (fallbackForSeek) {
      // シークできるように戻った(窓を広げた等)。押せるかは改めて当たり判定で見る
      setFallbackForSeek(false);
      failCount = 0;
      return setFallback(false);
    }
    if (skip) return false;
    const usable = bar ? probeUsable(bar, [fallbackEl, document.getElementById('my-mode-toggle')]) : false;
    if (usable === null) return false;
    if (usable) {
      failCount = 0;
      return setFallback(false);
    }
    failCount++;
    if (failCount >= FAIL_THRESHOLD) return setFallback(true);
    return false;
  };

  const configure = (opts) => {
    if (!opts) return;
    for (const key of ['offset', 'canMinimize', 'minimize']) {
      if (typeof opts[key] === 'function') hooks[key] = opts[key];
    }
  };

  return {
    get,
    // 探し直さずに、いま受け持っているバーを返す(見張り用。位置を測らない)
    current: () => (adopted && adopted.isConnected ? adopted : null),
    variant,
    rememberDisplay,
    probeUsable,
    check,
    configure,
    controls,
    isFallbackOn: () => fallbackOn,
    // バーの中の部品を、使っているバーの中から探す(無ければページ全体から)。
    // 同じ作りのバーが 2 つ在る時に、隠れている方を掴まないため
    query: (selector) => {
      const bar = get();
      return (bar && bar.querySelector(selector)) || document.querySelector(selector);
    },
    readLiked,
    toggleLike,
    // ▼ を出せるかは、プレイヤーページの開閉や履歴で変わる(見張りから呼ぶ)
    syncMinimize: () => paintMinimize(),
    // 表示言語が変わった時に描き直す
    refresh: () => {
      if (!fallbackEl) return;
      applyLabels(fallbackEl);
      parts.play.dataset.icon = '';
      parts.mute.dataset.icon = '';
      lastTimeText = '';
      paintAll();
    },
    // テスト用
    _looksLikePlayerBar: looksLikePlayerBar,
    _findGeneric: findGeneric,
    _formatTime: formatTime,
    // 曲の色。lyrics-ui がジャケットを測った時に渡す
    tintFromPixels,
    setTint,
    _volumeToLevel: volumeToLevel,
    _levelToVolume: levelToVolume,
  };
})();
