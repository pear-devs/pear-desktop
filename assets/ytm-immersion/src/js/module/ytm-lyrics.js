// ============================================================
// YouTube Music 内部API (InnerTube) からの行同期歌詞取得
//
// ■ なぜ background ではなく content script でやるのか
//   YouTube は未知の Origin からの youtubei 呼び出しを 403 で弾く。
//   MV3 の Service Worker から fetch すると必ず
//   Origin: chrome-extension://<id> が付き、Origin は forbidden header
//   なので fetch 側から書き換えられない。
//   content script は music.youtube.com 上で動くため同一オリジンとなり、
//   Origin: https://music.youtube.com が付いて正常に通る。
//   → background からは FETCH_YTM_LYRICS メッセージでここに委譲する。
//
// ■ 仕組み
//   1. next   (WEB_REMIX/認証あり) … videoId → 歌詞タブの browseId (MPLYt...)
//   2. browse (ANDROID_MUSIC/匿名) … browseId → 行同期歌詞
//   同期版は ANDROID_MUSIC コンテキストでのみ返る。WEB_REMIX だと
//   プレーン歌詞しか返らない。判定は context.client の中身だけで行われ、
//   User-Agent は関係ない。
//
//   next だけは SAPISIDHASH を付けてログイン状態で叩く。MV(OMV)再生時に
//   音声版へのリンク(counterpart)が返るのが認証時だけのため。
//   逆に ANDROID_MUSIC に web の認証を付けると HTTP 400 になるので、
//   browse は匿名のまま送る。
//
// ■ 実測での注意点
//   - 歌詞 browse も匿名だと空を返す曲がある。ログイン状態でしか配信されない
//     歌詞が存在するため(tryFetch 参照)。スマホアプリでだけ歌詞が見える曲の正体。
//   - UGC(歌ってみた等) は歌詞タブに unselectable が付く → browse を省略できる
//   - timedLyricsData があっても cueRange が全て 0 のことがある(約7%)
//     → 同期歌詞として使うと全行 00:00 に潰れるので必ず弾く
//   - 行単位のみ。文字カラオケは cueRange の実尺への均等配分で擬似的に作る
// ============================================================

(() => {
  const ORIGIN = 'https://music.youtube.com';
  const INNERTUBE = `${ORIGIN}/youtubei/v1`;
  const CLIENT_WEB = { clientName: 'WEB_REMIX', clientVersion: '1.20240101.01.00' };
  const CLIENT_MOBILE = { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50' };
  const TIMEOUT_MS = 5000;
  // カタログ楽曲の探索は複数リクエストを伴うので、全体の上限を別に設ける
  const RESOLVE_BUDGET_MS = 8000;

  // InnerTube 用の設定値はページの inline script 内にある。
  // documentElement.innerHTML だと DOM 全体(300KB超)を同期シリアライズしてしまうので、
  // script タグの textContent だけを走査する。
  // 取れなくても匿名で取得できるため、空のままでも機能する。
  // 失敗は恒久メモ化せず、次回また探す(初期 script が未挿入の場合があるため)。
  let cachedConfig = null;
  let lastConfigScanAt = 0;
  const CONFIG_RESCAN_MS = 3000;
  const getPageConfig = () => {
    if (cachedConfig) return cachedConfig;
    // 走査は script 全体(合計 1MB 超)を舐めるので、見つからない時に毎リクエスト
    // やり直すと純粋な無駄になる。少し間を空けてから再挑戦する。
    if (Date.now() - lastConfigScanAt < CONFIG_RESCAN_MS) return {};
    lastConfigScanAt = Date.now();
    const conf = {};
    // marker で足切りしてから正規表現をかける(script は 1MB 超のことがある)
    const FIELDS = [
      ['visitorData', 'VISITOR_DATA', /"VISITOR_DATA":"([^"]+)"/],
      ['clientVersion', 'INNERTUBE_CLIENT_VERSION', /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/],
      ['sessionIndex', 'SESSION_INDEX', /"SESSION_INDEX":"?(\d+)"?/],
      ['delegatedSessionId', 'DELEGATED_SESSION_ID', /"DELEGATED_SESSION_ID":"([^"]+)"/],
      ['hl', '"HL"', /"HL":"([^"]+)"/],
      ['gl', '"GL"', /"GL":"([^"]+)"/],
    ];
    try {
      for (const s of document.scripts) {
        const txt = s.textContent;
        if (!txt) continue;
        for (const [key, marker, re] of FIELDS) {
          if (conf[key] || txt.indexOf(marker) === -1) continue;
          const m = txt.match(re);
          if (m) conf[key] = m[1];
        }
      }
    } catch (e) { /* 取れなくても続行 */ }
    if (conf.visitorData) cachedConfig = conf;
    return conf;
  };

  const readCookie = (name) => {
    try {
      const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
      return m ? m[1] : null;
    } catch (e) {
      return null;
    }
  };

  // ■ なぜ認証が要るのか
  //   InnerTube は Cookie だけではログイン扱いにしてくれない。ウェブ版と同じ
  //   Authorization: SAPISIDHASH を付けて初めてログイン状態のレスポンスになる。
  //   実測: MV(OMV)の next で counterpart(=音声版の videoId)が返るのは認証時のみ。
  //   匿名だと counterpart が丸ごと欠落し、歌詞タブは unselectable のままになる。
  //   SAPISID は music.youtube.com 自身の JS も読んでいる非 HttpOnly Cookie で、
  //   ハッシュ計算はこのページ内で完結する(外部には一切送らない)。
  // 認証を拒否されたら一旦やめるが、永久にはやめない。
  //
  // 以前は 401/403 で無効フラグを立てたきり戻す口が無く、
  // ログインし直してもそのタブが開いている限り匿名のままだった。
  // ログイン限定の歌詞がセッション中ずっと取れなくなる。
  // Cookie が変わったら(=入り直した)すぐ、そうでなくても一定時間後に試し直す。
  const AUTH_RETRY_MS = 30 * 60 * 1000;
  let authDisabledUntil = 0;
  let authDisabledCookie = '';

  const currentAuthCookie = () => readCookie('SAPISID') || readCookie('__Secure-3PAPISID') || '';

  const isAuthDisabled = () => {
    if (!authDisabledUntil) return false;
    const resume = currentAuthCookie() !== authDisabledCookie || Date.now() >= authDisabledUntil;
    if (resume) {
      authDisabledUntil = 0;
      authDisabledCookie = '';
      return false;
    }
    return true;
  };

  const disableAuthForNow = () => {
    authDisabledCookie = currentAuthCookie();
    authDisabledUntil = Date.now() + AUTH_RETRY_MS;
  };

  const canAuthenticate = () => (
    !isAuthDisabled() &&
    !!currentAuthCookie() &&
    !!(self.crypto && self.crypto.subtle)
  );
  const buildAuthHeaders = async () => {
    if (isAuthDisabled()) return null;
    const sapisid = readCookie('SAPISID') || readCookie('__Secure-3PAPISID');
    if (!sapisid || !self.crypto || !self.crypto.subtle) return null;
    const ts = Math.floor(Date.now() / 1000);
    const buf = await crypto.subtle.digest('SHA-1',
      new TextEncoder().encode(`${ts} ${sapisid} ${ORIGIN}`));
    const hex = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const conf = getPageConfig();
    const headers = {
      'Authorization': `SAPISIDHASH ${ts}_${hex}`,
      'X-Origin': ORIGIN,
      'X-Goog-AuthUser': conf.sessionIndex || '0',
    };
    // ブランドアカウント(チャンネル切替中)はこれが無いと本人扱いにならない
    if (conf.delegatedSessionId) headers['X-Goog-PageId'] = conf.delegatedSessionId;
    return headers;
  };

  // 認証を付けるのは WEB_REMIX だけ、しかも必要な呼び出しに限る。
  //   - next            … 認証時のみ counterpart(曲⇔動画の対応)が返る
  //   - browse(歌詞)    … 認証時のみ歌詞が返る曲がある(下記 tryFetch 参照)
  //   - ANDROID_MUSIC に web の Cookie/SAPISIDHASH を付けると HTTP 400 で弾かれる
  //   - search を認証付きで撃つとユーザーの検索履歴を汚しかねない。
  //     カタログ探索の検索結果はログイン状態に依存しないので匿名で十分。
  const post = async (endpoint, client, extra, opts = {}) => {
    const { auth: authRequested = (endpoint === 'next') } = opts;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const conf = getPageConfig();
    const wantAuth = authRequested && client.clientName === 'WEB_REMIX';
    const auth = wantAuth ? await buildAuthHeaders().catch(() => null) : null;
    try {
      const res = await fetch(`${INNERTUBE}/${endpoint}?prettyPrint=false`, {
        method: 'POST',
        credentials: auth ? 'include' : 'omit',
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(conf.visitorData ? { 'X-Goog-Visitor-Id': conf.visitorData } : {}),
          ...(auth || {}),
        },
        body: JSON.stringify({
          context: {
            client: {
              ...client,
              ...(client.clientName === 'WEB_REMIX' && conf.clientVersion
                ? { clientVersion: conf.clientVersion } : {}),
              hl: conf.hl || 'ja',
              gl: conf.gl || 'JP',
            },
            user: {},
          },
          ...extra,
        }),
      });
      if (!res.ok) {
        if (auth && (res.status === 401 || res.status === 403)) {
          // 認証そのものを拒否された(ログアウト・Cookie 失効)。以後は匿名で通す。
          console.warn(`[YTM] 認証が拒否された (HTTP ${res.status})。しばらく匿名で取得する`);
          disableAuthForNow();
          clearTimeout(timer);
          return post(endpoint, client, extra, { ...opts, auth: false });
        }
        if (auth && res.status === 400) {
          // 400 はリクエスト個別の問題であることが多い。ここで認証を殺すと
          // ログイン限定の歌詞がセッション中ずっと取れなくなるので、
          // このリクエストだけ匿名で撃ち直す。
          clearTimeout(timer);
          return post(endpoint, client, extra, { ...opts, auth: false });
        }
        throw new Error(`innertube ${endpoint} HTTP ${res.status}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const formatLrcTime = (seconds) => {
    const total = Math.max(0, seconds);
    const min = Math.floor(total / 60);
    const sec = Math.floor(total - min * 60);
    const cs = Math.floor((total - min * 60 - sec) * 100);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  };

  const findLyricsTab = (nextRes) => {
    const tabs = nextRes?.contents?.singleColumnMusicWatchNextResultsRenderer
      ?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
    for (const tab of tabs) {
      const ep = tab?.tabRenderer?.endpoint?.browseEndpoint;
      const pageType = ep?.browseEndpointContextSupportedConfigs
        ?.browseEndpointContextMusicConfig?.pageType;
      if (pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS' && ep.browseId) {
        return { browseId: ep.browseId, unselectable: !!tab.tabRenderer.unselectable };
      }
    }
    return null;
  };

  const readLyrics = (browseRes) => {
    const data = browseRes?.contents?.elementRenderer?.newElement?.type
      ?.componentType?.model?.timedLyricsModel?.lyricsData;

    if (Array.isArray(data?.timedLyricsData) && data.timedLyricsData.length) {
      const lines = data.timedLyricsData.map(item => ({
        text: String(item.lyricLine || ''),
        startMs: Number(item.cueRange?.startTimeMilliseconds ?? 0) || 0,
        endMs: Number(item.cueRange?.endTimeMilliseconds ?? 0) || 0,
      })).filter(l => l.text);

      if (lines.some(l => l.endMs > l.startMs)) {
        return { kind: 'timed', source: data.sourceMessage || null, lines };
      }

      // cueRange が全て 0。本文は正常なのでプレーン歌詞に降格させる。
      // ANDROID_MUSIC のレスポンスは contents 直下が elementRenderer のみで
      // sectionListRenderer を持たないため、下のパスには落ちてこない。
      console.warn('[YTM] cueRange が全て 0 のためプレーン歌詞として扱う');
      const flattened = lines.map(l => l.text).join('\n');
      if (flattened.trim()) {
        return { kind: 'plain', source: data.sourceMessage || null, text: flattened };
      }
    }

    // YTM が「この曲に歌詞は無い」と明示的に返しているケース。
    // 実測: 歌詞未登録の新譜は全クライアントで musicMessageModel が返る
    // (WEB_REMIX では contents.messageRenderer)。
    // 空レスポンスと区別しておくと、無駄なカタログ探索を省ける。
    const model = browseRes?.contents?.elementRenderer?.newElement?.type?.componentType?.model;
    if (model && model.musicMessageModel) return { kind: 'none' };
    if (browseRes?.contents?.messageRenderer) return { kind: 'none' };

    const shelf = browseRes?.contents?.sectionListRenderer?.contents?.[0]?.musicDescriptionShelfRenderer;
    const plain = (shelf?.description?.runs || []).map(r => r.text).join('');
    if (plain.trim()) {
      return {
        kind: 'plain',
        source: (shelf?.footer?.runs || []).map(r => r.text).join('') || null,
        text: plain,
      };
    }
    return null;
  };

  const toLrc = (lines) =>
    lines.map(l => `[${formatLrcTime(l.startMs / 1000)}] ${l.text}`).join('\n');

  // ── ここから: MV動画 → カタログ楽曲 の解決 ──────────────────────────
  //
  // 同じ曲でも「MV動画(OMV)」の videoId では歌詞タブが unselectable になり、
  // 同期歌詞が取れない。歌詞を持つのは「カタログ楽曲(ATV)」の videoId だけ。
  //
  // ログイン時は next の counterpart が OMV → ATV を1発で返すので、まずそれを使う
  // (readCounterpartId)。以下のアルバム走査は、未ログイン時と counterpart を
  // 持たない曲のためのフォールバック。
  //
  // アルバムページが手がかりになるのは、行の watchEndpoint.videoId が OMV、
  // 同じ行のメニュー "View song credits" の browseId が MPTC<ATVのvideoId> になっている。
  // つまり「アルバムさえ見つかれば、行の videoId 完全一致で曖昧さゼロに解決できる」。
  //
  // 誤マッチ（別の曲の歌詞を出す）は歌詞が出ないより有害なので、
  // 解決後に必ず artist channelId で照合してから採用する。
  // channelId は MV とカタログで一致し、hl/gl を変えても不変（表示名は変わる）。

  const MARKER_RE = [
    /instrumental/i, /インスト/, /カラオケ/, /karaoke/i, /off\s*vocal/i, /オフボーカル/,
    /cover/i, /カバー/, /歌ってみた/, /弾いてみた/, /演奏してみた/, /ガイドメロディ/,
    /原曲歌手/, /オルゴール/, /music\s*box/i, /piano/i, /ピアノ/,
    /remix/i, /リミックス/, /live/i, /ライブ/, /ライヴ/, /acoustic/i, /アコースティック/,
  ];
  const markersOf = (s) => MARKER_RE.filter(re => re.test(String(s || ''))).map(re => re.source);

  const toHalfWidth = (s) => String(s || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g,
    c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  // 比較用の正規化。括弧の中身は丸ごと落とす（マーカー判定は正規化前に済ませること）
  const normTitle = (s) => toHalfWidth(s)
    .replace(/[【〔（(\[［「『].*?[】〕）)\]］」』]/g, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();

  // キュー先頭の要素を取り出す。
  // ログイン時に「曲⇔動画」の切り替えを持つ曲では、要素が
  // playlistPanelVideoWrapperRenderer(primaryRenderer + counterpart) で包まれる。
  const readQueueHead = (nextRes) => (
    nextRes?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents?.[0] || null
  );

  // ■ 「曲 ⇔ 動画」の公式リンク
  //   ログイン状態の next だけが counterpart を返す。これは YTM 自身が持っている
  //   同一トラックの対応表なので、曲名の一致判定などの推測が一切要らない。
  //   実測: これで MV 再生時の歌詞取得が 1リクエスト・数百msで確実に解決する。
  const readCounterpartId = (nextRes) => {
    const head = readQueueHead(nextRes);
    return head?.playlistPanelVideoWrapperRenderer
      ?.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer?.videoId || null;
  };

  // ■ 曲 ⇔ 動画の時刻の対応(segmentMap)
  //   counterpart には「音源の何秒が MV の何秒か」の区間の並びも入っている
  //   (YT-Immersion の music_resolver.js と同じもの。ログイン状態の時だけ)。
  //   実測(YT-Immersion, 2026-10-14): NewJeans「Ditto」MV は音源の 0 秒 = MV の 82.035 秒、
  //   BTS「Dynamite」は 23.7 秒。動画モードの歌詞の時刻合わせに使う(lyrics-ui.js)。
  //   primary が問い合わせた動画、counterpart がもう片方。どちらが MV かは
  //   問い合わせた videoId で決める: 返すのは「その videoId の時刻 → もう片方の時刻」。
  //   返す区間: { videoStart: 問い合わせた動画の秒, songStart: もう片方の秒, dur: 秒 }
  const readSegmentInfo = (nextRes, videoId) => {
    const wrapper = readQueueHead(nextRes)?.playlistPanelVideoWrapperRenderer;
    const cp = wrapper?.counterpart?.[0];
    const segs = cp?.segmentMap?.segment;
    if (!Array.isArray(segs) || !segs.length) return null;
    const primaryId = wrapper?.primaryRenderer?.playlistPanelVideoRenderer?.videoId || null;
    const counterpartId = cp?.counterpartRenderer?.playlistPanelVideoRenderer?.videoId || null;
    let swap;
    if (primaryId === videoId) swap = false;
    else if (counterpartId === videoId) swap = true;
    else return null;
    const out = segs.map((x) => {
      const p = Number(x.primaryVideoStartTimeMilliseconds) / 1000;
      const c = Number(x.counterpartVideoStartTimeMilliseconds) / 1000;
      return { videoStart: swap ? c : p, songStart: swap ? p : c, dur: Number(x.durationMilliseconds) / 1000 };
    }).filter(x => Number.isFinite(x.videoStart) && Number.isFinite(x.songStart) && x.dur > 0)
      .sort((a, b) => a.videoStart - b.videoStart);
    return out.length ? out : null;
  };

  // ■ MV に対応する音源(曲版)
  //   動画モードでも歌詞は音源の時刻で引いて、対応表で MV の時刻に直す。
  //   ところが歌詞サーバーへは MV の videoId と MV の長さを送っていたので、
  //   長さで照合する取得元(LrcLib・LyricsPlus・BuaaaBot・LiriQo 等)が
  //   「歌詞が曲の長さに足りない」と弾き、videoId で引く取得元(LRCHub・SimpMusic)は
  //   MV の登録が無くて外れていた。動画モードで同期歌詞が曲モードより少なかった原因。
  //   counterpart が音源(ATV)なら、その videoId・曲名・長さを返す。
  //   musicVideoType の読み方は YT-Immersion の music_resolver.js と同じ。
  const runsText = (t) => ((t && t.runs) || []).map(r => r.text).join('');
  const parseLengthText = (s) => {
    const parts = String(s || '').trim().split(':').map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((a, n) => a * 60 + n, 0);
  };
  const musicVideoTypeOf = (item) => (
    (JSON.stringify(item || {}).match(/"musicVideoType":"MUSIC_VIDEO_TYPE_(\w+)"/) || [])[1] || ''
  );
  const readSongCounterpart = (nextRes, videoId) => {
    const wrapper = readQueueHead(nextRes)?.playlistPanelVideoWrapperRenderer;
    const primary = wrapper?.primaryRenderer?.playlistPanelVideoRenderer;
    const song = wrapper?.counterpart?.[0]?.counterpartRenderer?.playlistPanelVideoRenderer;
    if (!primary || !song || primary.videoId !== videoId || !song.videoId || song.videoId === videoId) return null;
    // 問い合わせた側が音源なら、もう片方は MV。音源へ寄せる必要が無い
    if (musicVideoTypeOf(primary) === 'ATV' || musicVideoTypeOf(song) !== 'ATV') return null;
    const durationSec = parseLengthText(runsText(song.lengthText));
    return {
      videoId: song.videoId,
      title: runsText(song.title),
      durationSec: durationSec > 0 ? durationSec : null,
    };
  };

  // 対応表の控え。歌詞の取得(tryFetch)でついでに取れた分も入れる。
  // 値: 区間の配列 / null(対応表が無い) 。未取得は has で見分ける。
  // 音源の控え(songCache)も同じ応答から取り、同じ時に入れる。
  const SEGMENT_CACHE_LIMIT = 50;
  const segmentCache = new Map();
  const songCache = new Map();
  const segmentPending = new Map();
  const rememberSegments = (videoId, nextRes) => {
    if (!videoId || !nextRes) return;
    if (segmentCache.size >= SEGMENT_CACHE_LIMIT) {
      const oldest = segmentCache.keys().next().value;
      segmentCache.delete(oldest);
      songCache.delete(oldest);
    }
    segmentCache.set(videoId, readSegmentInfo(nextRes, videoId));
    songCache.set(videoId, readSongCounterpart(nextRes, videoId));
  };
  const fetchSegments = (videoId) => {
    if (!videoId) return Promise.resolve(null);
    if (segmentCache.has(videoId)) return Promise.resolve(segmentCache.get(videoId));
    if (segmentPending.has(videoId)) return segmentPending.get(videoId);
    const job = post('next', CLIENT_WEB, { videoId })
      .then((res) => { rememberSegments(videoId, res); return segmentCache.get(videoId) ?? null; })
      .catch(() => null)
      .finally(() => segmentPending.delete(videoId));
    segmentPending.set(videoId, job);
    return job;
  };
  globalThis.YTMSegmentMap = {
    // 取得済みなら区間の配列か null、まだなら undefined
    peek: (videoId) => (segmentCache.has(videoId) ? segmentCache.get(videoId) : undefined),
    fetch: fetchSegments,
    // MV の videoId → 音源の { videoId, title, durationSec }。音源が無い・既に音源なら null
    song: (videoId) => fetchSegments(videoId).then(() => songCache.get(videoId) ?? null),
    _readSegmentInfo: readSegmentInfo,
    _readSongCounterpart: readSongCounterpart,
  };

  // next 応答に入っているキュー全体を読む。
  // YTM のキュー DOM には videoId もサムネイル URL も残っていない
  // (実測: ytmusic-player-queue-item の中に a 要素が1つも無く、img は
  //  画面外だと 1x1 の data: プレースホルダのまま)。
  // InnerTube から取れば videoId も本物のアートワーク URL も揃う。
  const readQueuePanel = (res) => (
    res?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.musicQueueRenderer?.content?.playlistPanelRenderer
    || res?.continuationContents?.playlistPanelContinuation
    || null
  );

  // キューは1回で50件までしか返らない。続きは continuation トークンで取る。
  // ラジオは nextRadioContinuationData、再生リストは nextContinuationData。
  const readQueueContinuation = (panel) => {
    const c = panel?.continuations?.[0];
    return c?.nextRadioContinuationData?.continuation
      || c?.nextContinuationData?.continuation
      || null;
  };

  const readQueueEntries = (nextRes) => {
    const contents = readQueuePanel(nextRes)?.contents || [];
    const out = [];
    for (const c of contents) {
      const item = c?.playlistPanelVideoRenderer
        || c?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
      if (!item || !item.videoId) continue;
      const thumbs = item?.thumbnail?.thumbnails || [];
      const runs = item?.longBylineText?.runs || item?.shortBylineText?.runs || [];
      out.push({
        videoId: item.videoId,
        title: (item?.title?.runs || []).map(r => r.text).join(''),
        artist: runs[0]?.text || '',
        thumbnail: thumbs.length ? thumbs[thumbs.length - 1].url : null,
      });
    }
    return out;
  };

  // 再生中の曲の 曲名 / アーティストchannelId を next のキュー先頭から取る
  const readSourceMeta = (nextRes) => {
    const head = readQueueHead(nextRes);
    const item = head?.playlistPanelVideoRenderer
      || head?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    if (!item) return null;
    const runs = item?.longBylineText?.runs || item?.shortBylineText?.runs || [];
    const channelIds = [...new Set(runs
      .map(r => r?.navigationEndpoint?.browseEndpoint?.browseId)
      .filter(b => b && b.startsWith('UC')))];
    return {
      title: (item?.title?.runs || []).map(r => r.text).join(''),
      artistName: runs[0]?.text || '',
      channelIds,
    };
  };

  // 再生中のページに出ているアルバムリンクを読む。
  // YTM 自身が画面に出している情報なので、検索より速く確実。
  // 無関係なアルバムも混ざるが、採用判定は「行の videoId 完全一致」なので
  // 誤ったアルバムを拾っても実害はない。
  const readAlbumIdsFromDom = () => {
    try {
      const ids = new Set();
      for (const a of document.querySelectorAll('a[href*="browse/MPREb"]')) {
        const m = String(a.getAttribute('href') || '').match(/(MPREb_[A-Za-z0-9_-]+)/);
        if (m) ids.add(m[1]);
      }
      return [...ids];
    } catch (e) {
      return [];
    }
  };

  // 検索(アルバム/曲)から、関連しそうなアルバム browseId を集める
  const findAlbumCandidates = async (query) => {
    const ids = new Set();
    for (const params of ['EgWKAQIYAWoKEAoQAxAEEAkQBQ%3D%3D', 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D']) {
      try {
        const res = await post('search', CLIENT_WEB, { query, params });
        for (const m of JSON.stringify(res).matchAll(/"browseId":"(MPREb_[A-Za-z0-9_-]+)"/g)) {
          ids.add(m[1]);
          if (ids.size >= 6) break;
        }
      } catch (e) { /* 片方失敗しても続行 */ }
      if (ids.size >= 6) break;
    }
    return [...ids];
  };

  const readAlbumRows = async (browseId) => {
    const res = await post('browse', CLIENT_WEB, { browseId });
    const rows = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const r = node.musicResponsiveListItemRenderer;
      if (r) {
        let catalogId = null;
        for (const mi of (r?.menu?.menuRenderer?.items || [])) {
          const b = mi?.menuNavigationItemRenderer?.navigationEndpoint?.browseEndpoint?.browseId;
          if (b && b.startsWith('MPTC')) catalogId = b.slice(4);
        }
        rows.push({
          videoId: r?.playlistItemData?.videoId || null,
          catalogId,
          title: (r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
            .map(x => x.text).join(''),
        });
        return;
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(res?.contents);
    return rows;
  };

  // カタログ解決の結果をセッション中だけ覚えておく。
  // カタログ楽曲が存在しない曲(MV しか無い曲)では検索+アルバム走査が毎回空振りし、
  // 再生のたびに1秒以上を捨てることになるため、失敗も含めて記憶する。
  const RESOLVE_CACHE_LIMIT = 200;
  const resolveCache = new Map();

  const resolveCatalogVideoId = async (videoId, src, deadline) => {
    if (resolveCache.has(videoId)) return resolveCache.get(videoId);
    const remember = (v) => {
      resolveCache.set(videoId, v);
      trimMapToLimit(resolveCache, RESOLVE_CACHE_LIMIT, (id) => id === videoId);
      return v;
    };
    if (!src || !src.title) return null;

    // ページに出ているアルバムを先に試す。当たれば検索を1回も撃たずに済む。
    // ただし DOM のリンクにはサイドバー等の無関係なアルバムも混ざるので、
    // 外れても必ず検索へ落ちるようにし、browse の総回数に上限を設ける。
    // DOM 側で枠を使い切ると検索に到達できなくなるため、枠は別々に持つ。
    const MAX_DOM_PROBES = 2;
    const MAX_SEARCH_PROBES = 3;
    const seenAlbums = new Set();
    const fetched = [];

    const probeAlbums = async (ids, budget) => {
      let probes = 0;
      for (const bid of ids) {
        if (probes >= budget) return null;
        if (seenAlbums.has(bid)) continue;
        seenAlbums.add(bid);
        // 曲が変わっている可能性もあるので、探索は打ち切り時刻で必ず止める
        if (Date.now() > deadline) {
          YTMLog.log('[YTM] カタログ探索を時間切れで打ち切り');
          return null;
        }
        probes += 1;
        const rows = await readAlbumRows(bid).catch(() => []);
        if (rows.length) fetched.push(rows);

        // 第1段: 再生中の videoId がアルバム行そのものにある = 曖昧さゼロ
        const exact = rows.find(r => r.videoId === videoId);
        if (exact && exact.catalogId && exact.catalogId !== videoId) {
          YTMLog.log(`[YTM] カタログ楽曲を特定 (行の完全一致): ${exact.catalogId}`);
          return exact.catalogId;
        }
      }
      return null;
    };

    const fromDom = await probeAlbums(readAlbumIdsFromDom(), MAX_DOM_PROBES);
    if (fromDom) return remember(fromDom);

    if (Date.now() <= deadline) {
      const query = `${src.title.replace(/[【〔].*?[】〕]/g, ' ').slice(0, 80)} ${src.artistName}`.trim();
      const fromSearch = await probeAlbums(await findAlbumCandidates(query), MAX_SEARCH_PROBES);
      if (fromSearch) return remember(fromSearch);
    }

    if (!fetched.length) return remember(null);

    // 第2段: アルバムに載っていない別動画。曲名一致で拾う。
    // アルバムは既にアーティストで絞れているうえ、採用前に channelId で再照合するので
    // ここは緩めでよいが、instrumental/カラオケ等のマーカー差は必ず弾く。
    const srcMarkers = markersOf(src.title);
    const wanted = normTitle(src.title);
    if (!wanted) return remember(null);
    for (const rows of fetched) {
      for (const r of rows) {
        if (!r.catalogId || r.catalogId === videoId) continue;
        if (markersOf(r.title).some(m => !srcMarkers.includes(m))) continue;
        if (normTitle(r.title) !== wanted) continue;
        YTMLog.log(`[YTM] カタログ楽曲を特定 (曲名一致): ${r.catalogId}`);
        return remember(r.catalogId);
      }
    }
    YTMLog.log('[YTM] カタログ楽曲が見つからない（この曲は YTM に同期歌詞が無い可能性が高い）');
    return remember(null);
  };
// ────────────────────────────────────────────────────────────────

  // 「曲」検索の結果行から videoId / 曲名 / アーティスト channelId を集める
  const readSongSearchRows = (res) => {
    const rows = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      const r = node.musicResponsiveListItemRenderer;
      if (r) {
        const byline = r?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
        rows.push({
          videoId: r?.playlistItemData?.videoId || null,
          title: (r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
            .map(x => x.text).join(''),
          channelIds: [...new Set(byline
            .map(x => x?.navigationEndpoint?.browseEndpoint?.browseId)
            .filter(b => b && b.startsWith('UC')))],
        });
        return;
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(res?.contents);
    return rows;
  };

  // アルバム走査でも見つからない時の最後の手段。
  // 同名トラックを「曲」検索で直接引き、アーティストの channelId まで一致した
  // ものだけ採用する。アルバム走査はアルバムページに辿り着けないと何もできないが、
  // こちらはベスト盤・別エディションにしか歌詞が無い曲を拾える。
  const findSameTitleTrack = async (videoId, src, deadline) => {
    if (!src || !src.title) return null;
    const wanted = normTitle(src.title);
    if (!wanted) return null;
    if (Date.now() > deadline) return null;

    const query = `${src.title.replace(/[【〔].*?[】〕]/g, ' ').slice(0, 60)} ${src.artistName}`.trim();
    // 「曲」フィルタ付き検索。動画やUGCを最初から除外できる。
    const res = await post('search', CLIENT_WEB, { query, params: 'EgWKAQIIAWoKEAoQCRADEAQQBQ%3D%3D' })
      .catch(() => null);
    if (!res) return null;

    const srcMarkers = markersOf(src.title);
    let tried = 0;
    for (const row of readSongSearchRows(res)) {
      if (tried >= 3 || Date.now() > deadline) break;
      if (!row.videoId || row.videoId === videoId) continue;
      if (normTitle(row.title) !== wanted) continue;
      // instrumental/カラオケ等、元の曲に無い属性が付いたものは別物なので弾く
      if (markersOf(row.title).some(m => !srcMarkers.includes(m))) continue;
      // アーティスト不一致(同名異曲・カバー)は絶対に使わない
      if (src.channelIds.length && row.channelIds.length &&
        !row.channelIds.some(id => src.channelIds.includes(id))) continue;
      tried += 1;
      const alt = await tryFetch(row.videoId).catch(() => null);
      if (alt && alt.result && alt.result.kind !== 'none') {
        YTMLog.log(`[YTM] 同名トラック ${row.videoId} から歌詞を取得`);
        return alt.result;
      }
    }
    return null;
  };

  // videoId から歌詞を1回試す。取れなければ null。
  //
  // ■ 2段構えにしている理由(実測)
  //   歌詞タブが有効なのに ANDROID_MUSIC(匿名) では
  //   「現在、歌詞はご覧いただけません」しか返らない曲がかなりある
  //   (乃木坂46「サヨナラの意味」、櫻坂46「各駅停車」、KANA-BOON「シルエット」等)。
  //   これは曲に歌詞が無いのではなく、ログイン済みのリクエストにしか
  //   配信されないため。スマホアプリで歌詞が見えるのに拡張で見えない曲の正体がこれ。
  //   ログイン状態の WEB_REMIX で同じ browseId を叩くと歌詞本文が返る。
  //   (クライアントのバージョンは無関係。認証の有無だけで結果が変わる)
  //   ただし WEB_REMIX は時刻を持たないプレーン歌詞しか返さないので、
  //   同期歌詞が取れる ANDROID_MUSIC を先に試し、駄目な時だけこちらに落とす。
  const tryFetch = async (videoId) => {
    const nextRes = await post('next', CLIENT_WEB, { videoId });
    rememberSegments(videoId, nextRes);
    const tab = findLyricsTab(nextRes);
    if (!tab || tab.unselectable) return { nextRes, result: null, browseId: null };

    // 2本を直列に投げると、WEB 側の往復(実測 200〜300ms)がまるごと待ち時間に
    // 乗る。どちらが当たるかは事前に分からないので同時に投げて先に良い方を採る。
    // 未ログイン時は WEB 側が匿名になって無意味なので、その場合は投げない。
    const mobileTask = post('browse', CLIENT_MOBILE, { browseId: tab.browseId })
      .then(readLyrics).catch(() => null);
    const webTask = canAuthenticate()
      ? post('browse', CLIENT_WEB, { browseId: tab.browseId }, { auth: true })
        .then(readLyrics).catch(() => null)
      : Promise.resolve(null);

    const [mobile, web] = await Promise.all([mobileTask, webTask]);
    const usable = (r) => !!r && r.kind !== 'none';

    let result;
    if (usable(mobile)) {
      result = mobile;
    } else if (usable(web)) {
      YTMLog.log(`[YTM] ログイン状態の WEB から歌詞を取得 (${tab.browseId})`);
      result = web;
    } else {
      // どちらも空。YTM が「歌詞なし」と明示していればそれを返す
      // (呼び出し側が探索を打ち切るかの判断に使う)。
      result = mobile || web;
    }
    return { nextRes, result, browseId: tab.browseId };
  };

  // MPLYt_<アルバムトークン>-<番号> は既にカタログ楽曲そのものを指している。
  // サフィックスの無い MPLYt_<11文字> は動画スコープなので、
  // カタログ側を探しに行く価値がある。
  const isCatalogScopedBrowseId = (id) => /^MPLYt_.+-\d+$/.test(String(id || ''));

  const fetchYtmLyrics = async (videoId, runOpts = {}) => {
    if (!videoId) return null;

    const visited = new Set([videoId]);
    let { nextRes, result, browseId } = await tryFetch(videoId);

    // キューを引いておく。次の曲の歌詞の先読みと、Up Next のジャケット表示に使う。
    // キューパネルを開いていなくても動くので、曲が変わった瞬間に待ち時間ゼロで出せる。
    // 温めるために呼ばれた時は連鎖しないよう、ここでは何もしない。
    if (!runOpts.isWarm) getQueue(videoId);

    // ── counterpart チェーン ────────────────────────────────
    // 推測が入らないぶんアルバム走査より確実なので、先にこちらを辿る。
    // 実測で2ホップ必要な例がある(櫻坂46「We got your back」):
    //   アルバム収録版(歌詞タブは有効なのに中身が空)
    //     → MV(歌詞タブ unselectable)
    //       → シングル版(同期歌詞あり)
    // 同一トラックの対応表を辿るだけなので、途中に別の曲が紛れ込むことはない。
    let chainRes = nextRes;
    let sawCounterpart = false;
    for (let hop = 0; hop < 2; hop += 1) {
      if (result && result.kind === 'timed') break;
      const counterpartId = readCounterpartId(chainRes);
      if (!counterpartId || visited.has(counterpartId)) break;
      visited.add(counterpartId);
      sawCounterpart = true;
      const cp = await tryFetch(counterpartId).catch(() => null);
      if (!cp) break;
      chainRes = cp.nextRes;
      if (cp.result && cp.result.kind !== 'none') {
        YTMLog.log(`[YTM] 別バージョン ${counterpartId} から歌詞を取得 (counterpart)`);
        result = cp.result;
      }
    }

    // YTM が「歌詞なし」と明示していて、かつ既にカタログ楽曲を見ていて、
    // さらに counterpart(=YTM が知っている全バージョン)も空だったなら、
    // これ以上探しても出てこない。約1.4秒の無駄な探索を省く。
    // counterpart が無い時(未ログイン等)は、別リリースに歌詞がある可能性が
    // 残るのでアルバム走査まで進む。上の曲がまさにその形だった。
    if (result && result.kind === 'none' && isCatalogScopedBrowseId(browseId) && sawCounterpart) {
      YTMLog.log(`[YTM] この曲は YouTube Music に歌詞が登録されていない (${browseId})`);
      return null;
    }

    // ここから先(アルバム走査・同名トラック検索)は最大10リクエスト・数秒かかる。
    //   - 歌詞が1文字も無い   … 待ってでも探す価値がある。ここで待つ
    //   - 時刻なしの歌詞はある … 待たせずに一旦それを出し、同期版の探索は
    //                            裏で続けて、見つかったら差し替える(下の deepUpgrade)
    const hasText = !!result && result.kind !== 'none';
    const src = (!result || result.kind !== 'timed') ? readSourceMeta(nextRes) : null;
    const deadline = Date.now() + RESOLVE_BUDGET_MS;

    if (src && hasText && !runOpts.isWarm) {
      // 時刻なしで確定させず、裏で同期版を探し続ける
      void deepSearchTimed(videoId, src, Date.now() + RESOLVE_BUDGET_MS)
        .then(timed => { if (timed) publishUpgrade(videoId, toPayload(timed)); })
        .catch(() => { });
    }

    if (src && !hasText) {
      const deep = await deepSearchTimed(videoId, src, deadline, result).catch(() => null);
      if (deep) result = deep;
    }

    if (!result || result.kind === 'none') return null;
    return toPayload(result);
  };

  // アルバム走査 → 同名トラック検索。同期版を探す重い経路。
  // 呼び出し側が「待つ」か「裏で走らせて後から差し替える」かを選べるよう、
  // 独立した関数にしてある。
  const deepSearchTimed = async (videoId, src, deadline, current = null) => {
    let result = current;
    const catalogId = await resolveCatalogVideoId(videoId, src, deadline).catch(() => null);
    if (catalogId) {
      const alt = await tryFetch(catalogId).catch(() => null);
      const altSrc = alt ? readSourceMeta(alt.nextRes) : null;
      // 採用前の最終ゲート: アーティストが一致しないものは絶対に使わない
      const sameArtist = !!(altSrc && altSrc.channelIds.some(id => src.channelIds.includes(id)));
      if (alt && !sameArtist) {
        console.warn(`[YTM] カタログ候補 ${catalogId} はアーティスト不一致のため破棄`);
      } else if (alt && alt.result && alt.result.kind === 'timed') {
        YTMLog.log(`[YTM] カタログ楽曲 ${catalogId} から同期歌詞を取得`);
        result = alt.result;
      } else if (alt && (!result || result.kind === 'none') && alt.result && alt.result.kind !== 'none') {
        result = alt.result;
      }
    }

    // 最後の手段。同名トラックを「曲」検索で直接引く。
    // アルバム走査はアルバムに辿り着けないと何もできないが、こちらは
    // ベスト盤・別エディションだけに歌詞がある曲を拾える。
    if (!result || result.kind !== 'timed') {
      const alt = await findSameTitleTrack(videoId, src, deadline).catch(() => null);
      if (alt && (alt.kind === 'timed' || !result || result.kind === 'none')) result = alt;
    }

    if (!result || result.kind === 'none') return null;
    // 裏で走らせている場合、同期版に届かなかったなら差し替える意味がない
    if (current && result.kind !== 'timed') return null;
    return result;
  };

  const toPayload = (result) => {
    if (result.kind === 'timed') {
      // dynamicLines(文字単位カラオケ)は生成しない。
      // YTM は行単位の cueRange しか持たないため、文字ごとの時刻を作ると
      // 実際の歌唱とズレた不自然な「一文字追従」になる。
      // 行単位のハイライトに任せる方が、持っている情報に忠実。
      return {
        lyrics: toLrc(result.lines),
        dynamicLines: null,
        hasSynced: true,
        ytmSource: result.source,
        candidates: [],
      };
    }
    return {
      lyrics: result.text,
      dynamicLines: null,
      hasSynced: false,
      ytmSource: result.source,
      candidates: [],
    };
  };

  // 同じ videoId の取得結果はセッション中だけ覚えておく。
  // 曲を戻す・リピートする・キューを行き来するたびに数リクエスト撃ち直すのは
  // 待ち時間の丸損なので、2回目以降は即座に返す。
  // 同時に走った同一 videoId のリクエストも1本にまとめる。
  // 上限を超えたら古い順に落とす。丸ごと消すと、いま再生している曲のぶんまで
  // 巻き添えになって取り直しが走る。差し替え待ち(upgradeWaiters)が付いている
  // ものも残す。消すと待っている側へ届かなくなる。
  //
  // 1曲ぶんの中身は歌詞本文と srv3 の XML で、長い曲だと数十 KB になる。
  // 聴き続けたぶんだけ増えるので、上限は控えめにする。
  const LYRICS_CACHE_LIMIT = 60;
  const lyricsCache = new Map();
  const upgradeWaiters = new Map();

  // ── キュー ────────────────────────────────────────────────
  // playlistId を付けない next は再生中の1曲しか返さない(実測)。
  // 再生リストの ID は URL の list、無ければ YTM の自動ミックス RDAMVM<videoId>。
  // 応答は大きいので再生リスト単位でキャッシュし、曲ごとには引き直さない。
  const queueCache = new Map();
  const queueInFlight = new Set();
  // 1ページ約50件。再生リストは尽きるまで追い、ラジオは打ち切る。
  const QUEUE_MAX_PAGES = 20;
  const QUEUE_RADIO_PAGES = 3;
  // 1件が最大 1000 曲ぶんの配列になる。再生リストを渡り歩くと効いてくる。
  const QUEUE_CACHE_LIMIT = 8;

  const getQueue = (videoId, onReady) => {
    let listId = null;
    try { listId = new URL(location.href).searchParams.get('list'); } catch (e) { /* URL 不明 */ }
    const key = listId || (videoId ? `RDAMVM${videoId}` : null);
    if (!key) return [];
    if (queueCache.has(key)) return queueCache.get(key);
    if (!queueInFlight.has(key)) {
      queueInFlight.add(key);
      const collect = async () => {
        const first = await post('next', CLIENT_WEB, { videoId, playlistId: key });
        const firstPanel = readQueuePanel(first);
        const entries = readQueueEntries(first);

        // ラジオ(自動ミックス)は isInfinite で、終わりが存在しない。
        // いくら追ってもキリがないので数ページで打ち切る。
        // 再生リスト・アルバムは有限なので、トークンが尽きるまで全部取る。
        const maxPages = firstPanel?.isInfinite ? QUEUE_RADIO_PAGES : QUEUE_MAX_PAGES;

        const seen = new Set(entries.map(e => e.videoId));
        let token = readQueueContinuation(firstPanel);
        for (let page = 0; page < maxPages && token; page += 1) {
          const more = await post('next', CLIENT_WEB, { continuation: token }).catch(() => null);
          if (!more) break;
          const chunk = readQueueEntries(more);
          // 同じページが返り続けるとループになるので、新規が無くなったら止める
          const fresh = chunk.filter(e => !seen.has(e.videoId));
          if (!fresh.length) break;
          fresh.forEach(e => seen.add(e.videoId));
          entries.push(...fresh);
          token = readQueueContinuation(readQueuePanel(more));
        }
        return entries;
      };
      collect()
        .then(entries => {
          queueCache.set(key, entries);
          trimMapToLimit(queueCache, QUEUE_CACHE_LIMIT, (k) => k === key);
          // キューが分かった今が、次の曲を温める一番早いタイミング
          const at = entries.findIndex(e => e.videoId === videoId);
          entries.slice(at + 1, at + 3).forEach(e => {
            fetchYtmLyricsCached(e.videoId, { isWarm: true }).catch(() => { });
          });
          if (typeof onReady === 'function') onReady(entries);
        })
        .catch(() => { /* キューが引けなくても歌詞取得には影響しない */ })
        .finally(() => queueInFlight.delete(key));
    }
    return [];
  };

  // 時刻なしで返したあとに同期版が見つかった時の通知。
  // 待っている人が居なくても、次に同じ曲を再生した時は同期版が出るよう
  // キャッシュだけは差し替えておく。
  const publishUpgrade = (videoId, payload) => {
    if (!payload) return;
    YTMLog.log(`[YTM] 同期歌詞が見つかったので差し替える (${videoId})`);
    lyricsCache.set(videoId, Promise.resolve(payload));
    const waiters = upgradeWaiters.get(videoId);
    if (!waiters) return;
    upgradeWaiters.delete(videoId);
    for (const cb of waiters) {
      try { cb(payload); } catch (e) { /* 1つ失敗しても他へ通す */ }
    }
  };

  const fetchYtmLyricsCached = (videoId, opts = {}) => {
    if (!videoId) return Promise.resolve(null);
    if (typeof opts.onUpgrade === 'function') {
      if (!upgradeWaiters.has(videoId)) upgradeWaiters.set(videoId, new Set());
      upgradeWaiters.get(videoId).add(opts.onUpgrade);
    }
    if (lyricsCache.has(videoId)) {
      // 使ったものを新しい側へ回す。よく戻る曲が古い扱いで落ちないように。
      const hit = lyricsCache.get(videoId);
      lyricsCache.delete(videoId);
      lyricsCache.set(videoId, hit);
      return hit;
    }
    const task = fetchYtmLyrics(videoId, opts).catch(err => {
      console.warn('[YTM] lyrics fetch failed:', err);
      // 失敗は覚えない。次の再生でやり直せるようにする。
      lyricsCache.delete(videoId);
      return null;
    });
    lyricsCache.set(videoId, task);
    trimMapToLimit(
      lyricsCache,
      LYRICS_CACHE_LIMIT,
      (id) => id === videoId || upgradeWaiters.has(id),
    );
    return task;
  };

  // lyrics-ui.js / queue-manager.js から直接呼ぶ。
  // background を経由しないのは、Service Worker からの fetch には
  // Origin: chrome-extension://<id> が付いて YouTube に 403 で弾かれるため。
  // この content script は music.youtube.com 上で動くので同一オリジンで通る。
  window.YTMLyrics = {
    fetch: fetchYtmLyricsCached,
    // InnerTube の検索。「代替バージョンを検索」から使う。
    // 以前はあちらが API キー直書き・hl/gl 固定・タイムアウト無しの
    // 別実装を持っていた。ここを通せば、ページの設定・認証の扱い・
    // タイムアウトが 1 箇所に揃う(検索は匿名。履歴を汚さない)。
    search: (query, params) => post(
      'search',
      CLIENT_WEB,
      params ? { query, params } : { query },
      { auth: false }
    ),
    // キュー(videoId・曲名・アーティスト・アートワークURL)。
    // YTM のキュー DOM からは videoId もサムネイルも取れないため、表示側はこれを使う。
    // 同期的に「今あるぶん」を返し、未取得なら裏で引いて onReady で知らせる。
    queue: getQueue,
  };

  // ── Daily Replay 向け: アーティスト表記の問い合わせ ──────────
  // YTM は同じアーティストに複数の表記を持っている。公式音源は "aimyon"、
  // MV は「あいみょん」のように、曲ごとに別の名前が付く。再生履歴の側
  // だけでは同じ人だと判定しようがないので、YTM 自身に聞く。
  //
  // InnerTube を叩くのはこの module の責務なので、口だけここに出す
  // (ページ設定の読み取りと認証の扱いを他所へ写したくない)。
  // 「アーティスト」に絞った検索の先頭 1 件だけを返す。
  const ARTIST_SEARCH_PARAMS = 'EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D';

  globalThis.YTMArtistLookup = {
    byName: async (name) => {
      const query = String(name || '').trim();
      if (!query) return null;

      const res = await post('search', CLIENT_WEB, { query, params: ARTIST_SEARCH_PARAMS });

      let found = null;
      const walk = (node) => {
        if (found || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const r = node.musicResponsiveListItemRenderer;
        if (r) {
          const title = (r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
            .map(x => x.text).join('').trim();
          if (title) {
            found = {
              name: title,
              browseId: r?.navigationEndpoint?.browseEndpoint?.browseId || null,
            };
          }
          return;
        }
        for (const v of Object.values(node)) walk(v);
      };
      walk(res?.contents);
      return found;
    },
  };

  // ページを開いた直後、URL には既に videoId が入っている。
  // lyrics-ui が DOM の初期化とメタデータ確定を待ってから要求してくるより先に
  // 取得を始めておけば、要求された時点では手元にあり待ち時間がゼロになる。
  // (取得は videoId 単位でメモ化されるので、二重に走ることはない)
  try {
    const initialVideoId = new URL(location.href).searchParams.get('v');
    if (initialVideoId) fetchYtmLyricsCached(initialVideoId);
  } catch (e) { /* URL が読めなくても通常経路で取得される */ }

  // 曲をクリックした瞬間に取得を始める。
  // 再生が始まってから lyrics-ui が要求するまでには数百ms あるので、
  // その前に投げておけば表示待ちが実質ゼロになる。
  // pointerdown を使うのは click より早く、かつ YTM 側の処理を邪魔しないため。
  // (検索結果・再生リスト・アルバムの行は watch?v= のリンクを持っている。
  //  キューの行だけはリンクが無いが、そちらは先読み済みなので影響しない)
  //
  // yt-navigate-finish 等の SPA 遷移イベントは music.youtube.com では
  // document にも window にも飛んでこないことを実測で確認済み。
  document.addEventListener('pointerdown', (ev) => {
    try {
      const target = ev.target;
      if (!target || typeof target.closest !== 'function') return;
      const link = target.closest('a[href*="watch?v="]');
      if (!link) return;
      const m = String(link.getAttribute('href') || '').match(/[?&]v=([A-Za-z0-9_-]{11})/);
      if (m) fetchYtmLyricsCached(m[1], { isWarm: true }).catch(() => { });
    } catch (e) { /* 先回りに失敗しても通常経路で取得される */ }
  }, { capture: true, passive: true });
})();
