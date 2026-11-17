// ============================================================
// 追加の歌詞プロバイダー (NetEase / AMLL / KuGou / LiriQo / BuaaaBot)
//
// 既存の4つ(LRCHub / LrcLib / SimpMusic / LyricsPlus)のうち、単語同期を
// 返せるのは実質 SimpMusic と LyricsPlus だけ。しかも LyricsPlus は
// 無料枠の共用サーバーで、2026-09-19 時点では3ミラーとも 530 / 429 / 402 を
// 返して1件も歌詞を出せなかった。単語同期の供給元をここで増やす。
// どれもキー不要・無料。
//
// ■ 入切(戻し方)
//   EXTRA_PROVIDERS_ENABLED を false にすれば、呼び出し側を触らずに
//   どれも黙って null を返すようになる。個別に止めたい時は
//   PROVIDER_SWITCHES の該当キーだけ false。
//
// ■ 既定では動かない
//   通信先は optional_host_permissions なので、利用者が許可するまで、
//   どれも黙って null を返す。許可の画面は src/options.html で、設定パネルの
//   「追加の歌詞サーバー」に iframe で差し込んである(単体でも開ける)。
//   理由は下の PROVIDER_ORIGINS のところに書いた。
//
// ■ ヘッダーについて
//   fetch からは Referer も Cookie も付けられない(禁止ヘッダー)。
//   NetEase も KuGou も素の GET/POST で通ることを確認したうえで選んでいる。
//   curl で通っても fetch で落ちる、という取り違えを防ぐため、
//   ここでは特別なヘッダーを一切使わない。
//
// ■ 返す形
//   既存プロバイダーと同じ { lyrics, dynamicLines, animated_lyrics,
//   candidates, offset_ms }。background.js 側の組み替えは要らない。
// ============================================================

import {
  attachBackgroundVocal,
  buildLrcFromDynamic,
  makeBackgroundVocal,
  normalizeArtist,
  normalizeTrackTitle,
} from './api.js';

// ── 入切 ────────────────────────────────────────────────────
export const EXTRA_PROVIDERS_ENABLED = true;

export const PROVIDER_SWITCHES = {
  netease: true,
  amll: true,
  kugou: true,
  liriqo: true,
  buaaa: true,
};

// ── 通信先(任意の権限) ──────────────────────────────────────
// ここに並べた通信先は manifest の optional_host_permissions に置いてある。
// host_permissions に足すと、既存の利用者はアップデートのたびに
// 「権限が増えたので無効化しました」を踏むことになるため。
//
// Chrome の判定は表示文言ではなくホスト集合の差分で、既に9ホスト
// 持っていても新しいホストが1つでも増えれば privilege increase になる
// (chrome_permission_message_provider.cc の IsHostPrivilegeIncrease)。
// 任意の権限なら増加にならないので、更新は黙って通り、使いたい人だけが
// オプションページで許可する。
//
// AMLL は曲IDの割り出しに NetEase の検索を使うので music.163.com も要る。
export const PROVIDER_ORIGINS = {
  netease: ['https://music.163.com/*'],
  amll: [
    'https://music.163.com/*',
    'https://raw.githubusercontent.com/*',
    'https://cdn.jsdelivr.net/*',
  ],
  kugou: ['https://krcs.kugou.com/*', 'https://lyrics.kugou.com/*'],
  liriqo: ['https://api.liriqo-alfarrizi.workers.dev/*'],
  buaaa: ['https://buaaa.buachi.work/*'],
};

export const PROVIDER_IDS = Object.keys(PROVIDER_ORIGINS);

const isSwitchedOn = (key) => EXTRA_PROVIDERS_ENABLED && PROVIDER_SWITCHES[key] !== false;

// 曲が変わるたびに聞き直す値ではないので覚えておく。
// 許可の増減は onAdded / onRemoved で捨てる。
const permissionCache = new Map();

try {
  const drop = () => permissionCache.clear();
  chrome.permissions?.onAdded?.addListener(drop);
  chrome.permissions?.onRemoved?.addListener(drop);
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes.ytmi_pear_provider_origins) drop();
  });
} catch (e) { /* 拾えない環境ではその都度聞く */ }

const electronProviderPermission = (origins, callback) => {
  chrome.storage.local.get(['ytmi_pear_provider_origins'], (items) => {
    const granted = new Set(items?.ytmi_pear_provider_origins || []);
    callback(origins.every((origin) => granted.has(origin)));
  });
};

export const hasProviderPermission = (providerId) => new Promise(resolve => {
  const origins = PROVIDER_ORIGINS[providerId];
  if (!origins) { resolve(false); return; }
  if (permissionCache.has(providerId)) { resolve(permissionCache.get(providerId)); return; }
  try {
    if (!chrome.permissions?.contains) {
      electronProviderPermission(origins, (granted) => {
        permissionCache.set(providerId, granted);
        resolve(granted);
      });
      return;
    }
    chrome.permissions.contains({ origins }, granted => {
      // lastError を読まないと未処理エラーの警告がコンソールに出る
      void chrome.runtime.lastError;
      permissionCache.set(providerId, !!granted);
      resolve(!!granted);
    });
  } catch (e) {
    resolve(false);
  }
});

// ── 叩きすぎないための休止 ──────────────────────────────────
//
// 相手はどれも無料で開いているサーバー。429 を返されているのに曲ごとに
// 叩き続けると、一時的な絞りが IP ごとの遮断に変わる。既存の LRCHub
// (api.js のサーキットブレーカー)や LyricsPlus(ミラーごとの休止)と
// 同じ考え方で、返事を見て休ませる。
//
// 404 は数えない。「その曲を持っていない」だけで、こちらの叩きすぎではない。
// これを数えると、収録の少ない AMLL がすぐ止まってしまう。
const RATE_LIMITED_REST_MS = 10 * 60 * 1000;   // 429 / 403: 相手が明確に断っている
const UNAVAILABLE_REST_MS = 3 * 60 * 1000;     // 5xx / 通信不能: 落ちているか経路が塞がれている

const providerRestUntil = new Map();

export const isProviderResting = (providerId) => Date.now() < (providerRestUntil.get(providerId) || 0);

const restProvider = (providerId, ms, why) => {
  const until = Date.now() + ms;
  if (until <= (providerRestUntil.get(providerId) || 0)) return;
  providerRestUntil.set(providerId, until);
  console.warn(`[YTM] ${providerId} を ${Math.round(ms / 60000)} 分休ませます (${why})`);
};

// 「持っていない」と「叩きすぎ」を呼び出し側が取り違えないよう分けて返す。
export const NOT_FOUND = Symbol('not-found');

// 取得元への問い合わせは全部ここを通す。通さない fetch を書かないこと
// (1か所でも漏れると、そこだけ休まず叩き続ける)。
const askProvider = async (providerId, url, options) => {
  if (isProviderResting(providerId)) return null;
  let res;
  try {
    res = await fetch(url, { cache: 'no-store', ...options });
  } catch (e) {
    restProvider(providerId, UNAVAILABLE_REST_MS, '通信できない');
    return null;
  }
  if (res.status === 429 || res.status === 403) {
    restProvider(providerId, RATE_LIMITED_REST_MS, `HTTP ${res.status}`);
    return null;
  }
  if (res.status >= 500) {
    restProvider(providerId, UNAVAILABLE_REST_MS, `HTTP ${res.status}`);
    return null;
  }
  if (res.status === 404) return NOT_FOUND;
  if (!res.ok) return null;
  return res;
};

// 取得元を叩いてよいか。切ってある・許可が無い・休ませている間は黙って諦める。
const isOn = async (key) => (
  (isSwitchedOn(key) && !isProviderResting(key)) ? hasProviderPermission(key) : false
);

// ── デバッグログ ────────────────────────────────────────────
// api.js と同じ作り。ES モジュールなので background.js のスコープは共有しない。
const YTMLog = (() => {
  let enabled = false;
  const api = {
    log: (...a) => { if (enabled) console.log('[YTM]', ...a); },
    debug: (...a) => { if (enabled) console.debug('[YTM]', ...a); },
  };
  try {
    chrome.storage.local.get(['ytm_debug'], (res) => {
      enabled = !!res && (res.ytm_debug === '1' || res.ytm_debug === true);
    });
  } catch (e) { /* 読めなければ無効のまま */ }
  return api;
})();

const toFiniteMs = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// ── 曲の取り違え対策 ────────────────────────────────────────
// どれも「曲名で検索して1件選ぶ」経路なので、カバー・リミックス・
// ライブ版を掴む余地がある。background.js の lyricsBelongToTrack は
// 「曲の長さを大きく超える歌詞」しか弾けない(同じ長さの別テイクは通る)。
// 手前で点数を付けて、確からしいものだけ返す。
const MIN_MATCH_SCORE = 4;

export const scoreRemoteCandidate = (candidate, want) => {
  const wantTitle = normalizeTrackTitle(want?.track);
  const wantArtist = normalizeArtist(want?.artist);
  const wantSec = Number(want?.durationSec);

  const title = normalizeTrackTitle(candidate?.title);
  const artist = normalizeArtist(candidate?.artist);
  const sec = Number(candidate?.durationSec);

  if (!title) return -1;

  let score = 0;
  if (wantTitle) {
    if (title === wantTitle) score += 4;
    else if (title.includes(wantTitle) || wantTitle.includes(title)) score += 2;
    else return -1;          // 曲名がかすりもしないものは論外
  }

  if (wantArtist && artist) {
    if (artist === wantArtist) score += 3;
    else if (artist.includes(wantArtist) || wantArtist.includes(artist)) score += 2;
  }

  // 長さは版違いを見分ける唯一の手がかりなので重く見る。
  if (Number.isFinite(wantSec) && wantSec > 0 && Number.isFinite(sec) && sec > 0) {
    const diff = Math.abs(sec - wantSec);
    if (diff <= 3) score += 4;
    else if (diff <= 8) score += 1;
    else score -= 3;
  }
  return score;
};

export const pickRemoteCandidate = (candidates, want) => {
  let best = null;
  let bestScore = MIN_MATCH_SCORE - 1;
  for (const candidate of (Array.isArray(candidates) ? candidates : [])) {
    const score = scoreRemoteCandidate(candidate, want);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
};

// 行の中で時刻が巻き戻っていたら、直前の語に合わせて止める。
// 実測: KuGou の Bad Guy に1箇所だけ逆行があった(上流のデータの傷)。
// 語の並びは歌詞の並びそのものなので、時刻で並べ替えるわけにはいかない。
// 塗りが一瞬戻るのを防ぐだけに留める。
const clampMonotonic = (lines) => {
  for (const line of lines) {
    if (!Array.isArray(line.chars)) continue;
    for (let i = 1; i < line.chars.length; i++) {
      if (line.chars[i].t < line.chars[i - 1].t) line.chars[i].t = line.chars[i - 1].t;
    }
  }
  return lines;
};

// dynamicLines を結果の形にまとめる。chars は {t: 絶対ミリ秒, c: 文字列}。
// c は1文字とは限らない(api.js の LyricsPlus 変換も音節をそのまま入れている)。
// 次の行にくっつくまで伸びている「終わり」は捨てる。
//
// 取得元によっては、行の最後の語の長さを次の行が始まるまで水増ししている。
// 実測(KuGou / Bad Guy): 147.5 秒から始まる3文字の語に 13.7 秒の長さが付き、
// 行の終わりが次の行の開始とぴったり一致していた。そのまま渡すと
// lyrics-ui.js が最後の語をその間ずっと塗り続ける。
//
// 捨てておけば、あちらの見積もり(行の中の語間隔の中央値から出す)が働く。
// AMLL や LiriQo のように正直な終わりを持つ取得元はそのまま通る。
const LINE_END_GUARD_MS = 50;

// 語が1つしかない行のための保険。曲ぜんたいの語の間隔から1語ぶんの
// 長さを見積もる。行の中の間隔が使えない時の代わりなので、曲単位で採る。
const SINGLE_WORD_TAIL_MIN_MS = 300;
const SINGLE_WORD_TAIL_MAX_MS = 1500;

const typicalWordGapMs = (lines) => {
  const gaps = [];
  for (const line of lines) {
    const chars = line.chars || [];
    for (let i = 1; i < chars.length; i++) {
      const gap = chars[i].t - chars[i - 1].t;
      if (gap > 0) gaps.push(gap);
    }
  }
  if (!gaps.length) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
};

const dropPaddedLineEnds = (lines) => {
  const typical = typicalWordGapMs(lines);

  for (let i = 0; i < lines.length; i++) {
    const nextStart = Number(lines[i + 1]?.startTimeMs);
    const chars = lines[i].chars || [];
    const lastChar = chars[chars.length - 1]?.t;
    const end = Number(lines[i].endTimeMs);

    if (Number.isFinite(end)) {
      // 語より手前で終わる「終わり」は壊れている
      const broken = Number.isFinite(lastChar) && end <= lastChar;
      const padded = Number.isFinite(nextStart) && end >= nextStart - LINE_END_GUARD_MS;
      if (!broken && !padded) continue;
      lines[i].endTimeMs = undefined;
    }

    // ここから下は「終わりが無い行」。語が2つ以上ある行は lyrics-ui.js 側の
    // 見積もり(行の中の間隔の中央値)に任せられるが、語が1つの行はあちらが
    // 手を出せない(間隔が取れないため)ので、次の行まで引き延ばされる。
    // 実測(KuGou / Bad Guy): 3文字の語が1つだけの行が3秒かけて塗られていた。
    if (chars.length !== 1 || !Number.isFinite(lastChar) || typical === null) continue;
    const glyphs = Math.max(1, Array.from(String(chars[0].c ?? '')).length);
    let tail = Math.min(SINGLE_WORD_TAIL_MAX_MS, Math.max(SINGLE_WORD_TAIL_MIN_MS, typical * glyphs));
    if (Number.isFinite(nextStart)) {
      const room = nextStart - lastChar - LINE_END_GUARD_MS;
      if (room <= 0) continue;              // 空きが無い行は触らない
      tail = Math.min(tail, room);
    }
    lines[i].endTimeMs = lastChar + tail;
  }
  return lines;
};

const buildResult = (dynamicLines, want) => {
  // 本文が空の行(間奏で表示を消す行)も通す。落とすと間奏のあいだ
  // 直前の歌詞が光ったまま残る。ただし全部が空なら歌詞ではない。
  const kept = clampMonotonic((Array.isArray(dynamicLines) ? dynamicLines : []).filter(line => (
    line && typeof line.startTimeMs === 'number'
  )));
  // 見出しとクレジットは、時刻を見る前に落とす(落としたぶん次の行が
  // 変わるので、行の終わりの補正より先でないと噛み合わない)。
  const lines = stripLeadingHeaderLines(kept, want || {});
  if (!lines.some(line => String(line.text || '').length > 0)) return null;
  dropPaddedLineEnds(lines);
  const hasChars = lines.some(line => Array.isArray(line.chars) && line.chars.length > 1);
  const lyrics = buildLrcFromDynamic(lines);
  if (!lyrics.trim()) return null;
  return {
    lyrics,
    // 文字時刻が1行も無いなら行同期でしかない。空の chars を持ち回っても
    // UI 側の「文字同期あり」判定は通らない(convertLyricsPlusResponse と同じ)。
    dynamicLines: hasChars ? lines : null,
    animated_lyrics: null,
    candidates: [],
    offset_ms: 0,
  };
};

// 手元のファイルの読み込み(local-lyrics.js)も同じ後始末を通す
export const buildLyricsResult = (dynamicLines, want) => buildResult(dynamicLines, want);

// 空文字の語を残すと UI 側の語組み立てが空の span を作る。
const pushChar = (chars, t, text) => {
  const c = String(text ?? '');
  if (!c || t === null) return;
  chars.push({ t, c });
};

// 「タグ 語 タグ 語 …」を読む。yrc と krc が同じ形。
//
// タグ探しと本文の取り込みを1本の正規表現でやってはいけない。
// 後続の本文を [^(]* のように「区切り文字以外」で拾うと、歌詞そのものに
// その文字が入っていた時に丸ごと落ちる。実際 (Ah) や (x2) のような
// コーラス表記は珍しくなく、合成データで消えることを確認した。
// タグだけを探して、タグとタグの間を切り出す。
// 行の終わりは、見出しの [開始,長さ] ではなく最後の語の終わりから出す。
//
// 見出しの長さは当てにならない。実測: KuGou の Bad Guy は最終行の長さに
// 曲まるごとの長さ(194951ms)が入っていて、宣言どおりなら行が 386 秒まで
// 続くことになる(実際の歌い終わりは 193 秒)。語ごとの長さは正しいので、
// 最後の語の 開始+長さ を採る。
//
// 終わりを持たせること自体は必須。無いと lyrics-ui.js 側が行の最後の語を
// 「次の行が始まるまで」で引き延ばし、間奏に入る行で数秒かけて塗る。
const readTaggedLine = (line, tagRe) => {
  const chars = [];
  let startMs = null;
  let endMs;
  let textFrom = 0;
  let m;
  tagRe.lastIndex = 0;
  while ((m = tagRe.exec(line))) {
    if (startMs !== null) pushChar(chars, startMs, line.slice(textFrom, m.index));
    startMs = Number(m[1]);
    const dur = Number(m[2]);
    endMs = (Number.isFinite(startMs) && Number.isFinite(dur) && dur > 0) ? startMs + dur : undefined;
    textFrom = m.index + m[0].length;
  }
  if (startMs !== null) pushChar(chars, startMs, line.slice(textFrom));
  return { chars, endMs };
};

// ============================================================
// 1. NetEase Cloud Music
//    検索: POST /api/cloudsearch/pc  (/api/search/get は無関係な曲を返すので使わない)
//    歌詞: GET  /api/song/lyric/v1   yrc があれば単語同期、無ければ lrc の行同期
// ============================================================

const NETEASE_SEARCH_URL = 'https://music.163.com/api/cloudsearch/pc';
const NETEASE_LYRIC_URL = 'https://music.163.com/api/song/lyric/v1';

// yrc: [行開始,行長](語開始,語長,0)語(語開始,語長,0)語...
// 先頭に {"t":0,"c":[...]} のメタ行(作詞・作曲のクレジット)が数行入る。
export const parseYrc = (text) => {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('{')) continue;
    const head = line.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue;
    const startTimeMs = Number(head[1]);
    const { chars, endMs } = readTaggedLine(line, /\((\d+),(\d+),\d+\)/g);
    if (!chars.length) continue;
    out.push({
      startTimeMs: Number.isFinite(startTimeMs) ? startTimeMs : chars[0].t,
      endTimeMs: endMs,
      text: chars.map(ch => ch.c).join(''),
      chars,
    });
  }
  return out;
};

// 素の lrc(行同期)。yrc を持っていない曲のための受け皿。
//
// 1行に時刻が複数付くことがある(サビの使い回し)。先頭1つだけ剥がすと、
// 残りが本文に混ざって画面に出てしまう。時刻の数だけ行を起こす。
//
// 本文が空の行も捨てない。間奏で表示を消すための行で、実データにも
// 出る(NetEase の lrc で1曲あたり 7〜12 行あった)。捨てると間奏のあいだ
// 直前の歌詞が光ったまま残る。
const LRC_TIME_TAG = /^\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/;

export const parseSimpleLrc = (text) => {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    let rest = raw;
    const times = [];
    for (;;) {
      const m = rest.match(LRC_TIME_TAG);
      if (!m) break;
      let frac = m[3] || '0';
      if (frac.length === 1) frac += '00';
      else if (frac.length === 2) frac += '0';
      times.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + Number(frac.slice(0, 3)));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue;
    const body = rest.trim();
    for (const startTimeMs of times) {
      out.push({
        startTimeMs,
        text: body,
        chars: body ? [{ t: startTimeMs, c: body }] : [],
      });
    }
  }
  out.sort((a, b) => a.startTimeMs - b.startTimeMs);
  return out;
};

// 検索結果は NetEase 単体でも AMLL でも使う。曲が変わるまで使い回して、
// 1曲につき1回しか叩かないようにする(2プロバイダーで2往復させない)。
const neteaseSearchCache = new Map();
const NETEASE_SEARCH_TTL_MS = 60 * 1000;
// Service Worker は寝るまで生き続けるので、入れっぱなしだと曲を送るたびに
// 積み上がる。期限切れを掃除し、それでも増えるようなら古い順に捨てる。
const NETEASE_SEARCH_MAX = 64;

const trimNeteaseSearchCache = () => {
  const now = Date.now();
  for (const [key, entry] of neteaseSearchCache) {
    if (now - entry.at >= NETEASE_SEARCH_TTL_MS) neteaseSearchCache.delete(key);
  }
  // Map は挿入順を保つので、先頭がいちばん古い。
  while (neteaseSearchCache.size > NETEASE_SEARCH_MAX) {
    const oldest = neteaseSearchCache.keys().next().value;
    if (oldest === undefined) break;
    neteaseSearchCache.delete(oldest);
  }
};

export const searchNetease = async (params = {}) => {
  const track = String(params.track || '').trim();
  const artist = String(params.artist || '').trim();
  if (!track) return null;

  const key = [track, artist, params.durationSec || ''].join(' :: ');
  const cached = neteaseSearchCache.get(key);
  if (cached && Date.now() - cached.at < NETEASE_SEARCH_TTL_MS) return cached.value;

  const body = new URLSearchParams({
    s: artist ? `${track} ${artist}` : track,
    type: '1',
    limit: '10',
    offset: '0',
  });
  // 検索の相手は music.163.com。AMLL も曲IDの割り出しで同じ所を叩くので、
  // 休ませる時の名義も 'netease' で揃える(同じホストを二重に叩かない)。
  const res = await askProvider('netease', NETEASE_SEARCH_URL, { method: 'POST', body });
  if (!res || res === NOT_FOUND) return null;
  const json = await res.json();
  const songs = Array.isArray(json?.result?.songs) ? json.result.songs : [];
  const hit = pickRemoteCandidate(
    songs.map(song => ({
      id: song?.id,
      title: song?.name,
      artist: (Array.isArray(song?.ar) ? song.ar : []).map(a => a?.name).filter(Boolean).join(' '),
      durationSec: toFiniteMs(song?.dt) === null ? null : Number(song.dt) / 1000,
    })),
    params,
  );
  const value = (hit && hit.id) ? hit : null;
  neteaseSearchCache.set(key, { at: Date.now(), value });
  trimNeteaseSearchCache();
  return value;
};

export const fetchFromNetease = async (params = {}) => {
  if (!await isOn('netease')) return null;
  const hit = await searchNetease(params);
  if (!hit) return null;

  const url = `${NETEASE_LYRIC_URL}?id=${encodeURIComponent(hit.id)}` +
    '&cp=false&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0';
  const res = await askProvider('netease', url, { method: 'GET' });
  if (!res || res === NOT_FOUND) return null;
  const json = await res.json();

  const yrc = String(json?.yrc?.lyric || '').trim();
  if (yrc) {
    const result = buildResult(parseYrc(yrc), params);
    if (result) {
      YTMLog.log('[BG] NetEase hit (yrc):', hit.id, hit.title);
      return result;
    }
  }

  const lrc = String(json?.lrc?.lyric || '').trim();
  if (lrc) {
    const result = buildResult(parseSimpleLrc(lrc), params);
    if (result) {
      YTMLog.log('[BG] NetEase hit (lrc):', hit.id, hit.title);
      return result;
    }
  }
  return null;
};

// ============================================================
// 2. AMLL TTML Database (github.com/amll-dev/amll-ttml-db)
//    有志が手で打った単語同期。ライセンスは CC0 1.0。
//    実体は GitHub 上の静的ファイルなので、サーバーが落ちる心配がない。
//    引き当てるのに曲IDが要るので、上の NetEase 検索に相乗りする。
//    収録は ncm 3,356件(.lys) / 3,542件(.ttml)。数は多くないが当たれば質は最上。
// ============================================================

const AMLL_BASES = [
  'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main',
  // raw が詰まった時の逃げ道。jsDelivr は 404 もキャッシュするので二番手。
  'https://cdn.jsdelivr.net/gh/amll-dev/amll-ttml-db@main',
];

// .lys(Lyricify Syllable): [行属性]語(開始ms,長さms) 語(開始ms,長さms)
// 語間の空白は (0,0) で来る。時刻ゼロの語として積むと行頭へ飛ぶので、
// 直前の語の末尾にくっつける。
//
// 行属性は 0〜8。6・7・8 がハモリ(背景の声)で、本編の行のすぐ後ろに
// 別の行として来る(実物: Espresso の「[6]Yes(55655,333)」)。普通の行として
// 並べると、本編と同じ大きさの 1 行が割り込む。直前の本編の行に bg として付ける。
const LYS_BACKGROUND_PROPS = new Set([6, 7, 8]);

export const parseLys = (text) => {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^\[(\d+)\]/);
    if (!head) continue;
    const isBackground = LYS_BACKGROUND_PROPS.has(Number(head[1]));
    const rest = line.slice(head[0].length);
    const chars = [];
    // lys はタグが語の「後ろ」に付く。yrc / krc と違って前を切り出す。
    // ここも [^()]* で拾うと歌詞中の括弧が落ちるので、タグだけを探す。
    const re = /\((\d+),(\d+)\)/g;
    let m;
    let textFrom = 0;
    let endTimeMs;
    while ((m = re.exec(rest))) {
      const word = rest.slice(textFrom, m.index);
      const start = Number(m[1]);
      const dur = Number(m[2]);
      textFrom = m.index + m[0].length;
      if (start === 0 && dur === 0) {
        // 区切りの空白。直前の語に足す(行頭に来た時は捨てる)。
        if (chars.length && word) chars[chars.length - 1].c += word;
        continue;
      }
      pushChar(chars, start, word);
      // 語ごとに長さを持っているので、最後の語の終わりが行の終わり。
      if (Number.isFinite(start) && Number.isFinite(dur)) endTimeMs = start + dur;
    }
    if (!chars.length) continue;
    if (isBackground && out.length) {
      attachBackgroundVocal(out[out.length - 1], makeBackgroundVocal(chars, endTimeMs));
      continue;
    }
    out.push({
      startTimeMs: chars[0].t,
      endTimeMs,
      text: chars.map(ch => ch.c).join(''),
      chars,
    });
  }
  return out;
};

// TTML の時刻: hh:mm:ss.mmm / mm:ss.mmm / 12.5s / 120ms
export const parseTtmlTime = (value) => {
  const s = String(value || '').trim();
  if (!s) return null;
  let m = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (m) {
    const h = m[1] ? Number(m[1]) : 0;
    const min = Number(m[2]);
    const sec = Number(m[3]);
    const frac = (m[4] || '0').padEnd(3, '0').slice(0, 3);
    return ((h * 60 + min) * 60 + sec) * 1000 + Number(frac);
  }
  m = s.match(/^(\d+(?:\.\d+)?)(ms|s)?$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) return null;
    return m[2] === 'ms' ? Math.round(n) : Math.round(n * 1000);
  }
  return null;
};

export const decodeXmlEntities = (value) => String(value ?? '')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  // &amp; は最後。先に戻すと "&amp;lt;" が "<" まで解けてしまう。
  .replace(/&amp;/g, '&');

// <span> の語を拾う。入れ子の親(中に <span> を持つもの)は飛ばす。
const readTtmlSpans = (inner) => {
  const chars = [];
  let lastSpanEnd = null;
  const spanRe = /<span\b([^>]*)>([\s\S]*?)<\/span>/g;
  let sm;
  let prevEnd = 0;
  while ((sm = spanRe.exec(inner))) {
    // 語と語の間の空白は span の外に置かれる(英語の TTML)。拾わないと
    // 「Alpha beta」が「Alphabeta」になるので、直前の語の後ろに付ける。
    const gap = inner.slice(prevEnd, sm.index);
    prevEnd = sm.index + sm[0].length;
    if (/\s/.test(gap.replace(/<[^>]*>/g, '')) && chars.length && !/\s$/.test(chars[chars.length - 1].c)) {
      chars[chars.length - 1].c += ' ';
    }
    const spanAttrs = sm[1] || '';
    const body = sm[2];
    if (/<span\b/.test(body)) continue;      // 入れ子の親は飛ばす
    const t = parseTtmlTime((spanAttrs.match(/\bbegin="([^"]*)"/) || [])[1]);
    const before = chars.length;
    pushChar(chars, t, decodeXmlEntities(body));
    // 行の終わりは最後の語の終わりから採る。<p> 側の end は
    // 余韻まで含んでいることがあり、そのぶん最後の語が長く塗られる。
    if (chars.length > before) {
      const spanEnd = parseTtmlTime((spanAttrs.match(/\bend="([^"]*)"/) || [])[1]);
      if (spanEnd !== null) lastSpanEnd = spanEnd;
    }
  }
  return { chars, lastSpanEnd };
};

// ハモリ(ttm:role="x-bg")の <span> を、対応する </span> まで切り出す。
// 中に語の <span> が入れ子になっているので、正規表現の最短一致では
// 最初の語の </span> で切れてしまい、2 語目以降が本編に混ざっていた。
const splitTtmlBackground = (inner) => {
  const blocks = [];
  let main = '';
  let pos = 0;
  const openRe = /<span\b[^>]*ttm:role="x-bg"[^>]*>/g;
  let om;
  while ((om = openRe.exec(inner))) {
    if (om.index < pos) continue;
    main += inner.slice(pos, om.index);
    const tagRe = /<span\b[^>]*>|<\/span>/g;
    tagRe.lastIndex = om.index + om[0].length;
    let depth = 1;
    let tm;
    let end = inner.length;
    while ((tm = tagRe.exec(inner))) {
      depth += tm[0].startsWith('</') ? -1 : 1;
      if (depth === 0) { end = tm.index + tm[0].length; break; }
    }
    blocks.push(inner.slice(om.index + om[0].length, end));
    pos = end;
    openRe.lastIndex = end;
  }
  main += inner.slice(pos);
  return { main, blocks };
};

// Service Worker には DOMParser が無い。TTML の <p>/<span> は入れ子が浅く
// 構造も決まっているので、正規表現で拾う。
// ハモリ(x-bg)は本編と重なる別タイムライン。本編には混ぜず、行の bg にする。
export const parseTtml = (text) => {
  const out = [];
  const src = String(text || '');
  const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  let pm;
  while ((pm = pRe.exec(src))) {
    const attrs = pm[1] || '';
    const lineStart = parseTtmlTime((attrs.match(/\bbegin="([^"]*)"/) || [])[1]);
    const lineEnd = parseTtmlTime((attrs.match(/\bend="([^"]*)"/) || [])[1]);
    const { main: inner, blocks } = splitTtmlBackground(pm[2] || '');
    const { chars, lastSpanEnd } = readTtmlSpans(inner);
    const bgParts = blocks.map(readTtmlSpans);
    const bg = makeBackgroundVocal(
      bgParts.flatMap(part => part.chars).sort((a, b) => a.t - b.t),
      Math.max(...bgParts.map(part => part.lastSpanEnd ?? 0)) || undefined,
    );
    if (!chars.length && bg) {
      // ハモリだけの行は、そのまま本編として出す(下に付ける本編が無い)
      out.push({
        startTimeMs: bg.startTimeMs,
        endTimeMs: bg.endTimeMs,
        text: bg.text,
        chars: bg.chars,
      });
      continue;
    }
    if (!chars.length) {
      const plain = decodeXmlEntities(inner.replace(/<[^>]*>/g, '')).trim();
      if (!plain || lineStart === null) continue;
      out.push({
        startTimeMs: lineStart,
        endTimeMs: lineEnd ?? undefined,
        text: plain,
        chars: [{ t: lineStart, c: plain }],
      });
      continue;
    }
    const line = {
      startTimeMs: lineStart === null ? chars[0].t : lineStart,
      endTimeMs: lastSpanEnd ?? lineEnd ?? undefined,
      text: chars.map(ch => ch.c).join('').trim(),
      chars,
    };
    out.push(attachBackgroundVocal(line, bg));
  }
  return out;
};

const fetchAmllFile = async (path) => {
  for (const base of AMLL_BASES) {
    const res = await askProvider('amll', `${base}/${path}`, { method: 'GET' });
    if (res === NOT_FOUND) return null;           // 収録が無い。別ミラーでも同じ
    if (!res) {
      // 断られた・落ちている。askProvider が休止に入れているので、
      // 別ミラーを試す意味はあっても、休止中なら次も即 null で返る。
      continue;
    }
    return await res.text();
  }
  return null;
};

export const fetchFromAmll = async (params = {}) => {
  if (!await isOn('amll')) return null;
  const hit = await searchNetease(params);
  if (!hit) return null;

  // .lys は語ごとに開始と長さがミリ秒で入っていて曖昧さが無い。
  // .ttml の方が 186 件多いので、.lys が無い時だけそちらを読む。
  const lys = await fetchAmllFile(`ncm-lyrics/${encodeURIComponent(hit.id)}.lys`);
  if (lys) {
    const result = buildResult(parseLys(lys), params);
    if (result) {
      YTMLog.log('[BG] AMLL hit (lys):', hit.id, hit.title);
      return result;
    }
  }
  const ttml = await fetchAmllFile(`ncm-lyrics/${encodeURIComponent(hit.id)}.ttml`);
  if (ttml) {
    const result = buildResult(parseTtml(ttml), params);
    if (result) {
      YTMLog.log('[BG] AMLL hit (ttml):', hit.id, hit.title);
      return result;
    }
  }
  return null;
};

// ============================================================
// 3. KuGou (krc)
//    検索で id + accesskey をもらい、krc を落として復号する。
//    krc は "krc1" + 16バイト鍵の XOR + zlib。鍵は公開されている定数。
//    日本語曲も language:"日语" で普通に入っている。
// ============================================================

const KUGOU_SEARCH_URL = 'https://krcs.kugou.com/search';
const KUGOU_DOWNLOAD_URL = 'https://lyrics.kugou.com/download';

const KRC_KEY = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47,
  0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69];

export const decodeKrcBase64 = (base64) => {
  const bin = atob(String(base64 || '').replace(/\s+/g, ''));
  const raw = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
  if (raw.length <= 4) return null;
  const body = raw.subarray(4);                  // 先頭4バイトは "krc1"
  const out = new Uint8Array(body.length);
  for (let i = 0; i < body.length; i++) out[i] = body[i] ^ KRC_KEY[i % 16];
  return out;
};

// zlib 展開。pako を足さずに済むよう DecompressionStream を使う
// (MV3 の Service Worker でも Node 24 でも動く)。
export const inflateZlib = async (bytes) => {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder('utf-8').decode(buf);
};

// krc: [行開始,行長]<行頭からの差,長さ,0>語<...>語
export const parseKrc = (text) => {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = line.match(/^\[(\d+),(\d+)\]/);
    if (!head) continue;
    const lineStart = Number(head[1]);
    // krc の時刻は行頭からの差なので、絶対時刻に直す。
    const read = readTaggedLine(line, /<(\d+),(\d+),\d+>/g);
    const chars = read.chars.map(ch => ({ t: lineStart + ch.t, c: ch.c }));
    if (!chars.length) continue;
    out.push({
      startTimeMs: lineStart,
      endTimeMs: read.endMs === undefined ? undefined : lineStart + read.endMs,
      text: chars.map(ch => ch.c).join(''),
      chars,
    });
  }
  return out;
};

// クレジット行のラベル。lyrics-ui.js の LYRIC_CREDIT_LABELS と同じ役目だが、
// あちらは「词」「曲」のような1文字ラベルを持っておらず、KuGou のデータが
// 素通りしていた。表示側の一覧にも足してあるが、取得側でも落としておく。
const CREDIT_LABELS = [
  '词', '詞', '曲', '编', '編',
  '作词', '作詞', '作曲', '编曲', '編曲', '词曲', '詞曲',
  '制作', '製作', '制作人', '製作人', '监制', '監製', '出品', '发行', '發行',
  '混音', '录音', '録音', '母带', '母帶', '和声', '和聲', '策划', '企画',
  'op', 'sp', 'produced', 'producer', 'lyrics', 'lyricist', 'lyric', 'written',
  'music', 'composer', 'composed', 'arranged', 'arranger',
  'vocal', 'chorus', 'mixing', 'mastering',
];

const normalizeCreditLabel = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');

const CREDIT_LABEL_KEYS = CREDIT_LABELS.map(normalizeCreditLabel);

// 「ラベル：値」の形だけを見る。**行の長さでは切らない**。
// 以前は「行全体が24文字以内」を条件にしていたため、名前の長いクレジット
// (実測: 词：<作詞者2名> で41文字、最長74文字)がそのまま歌詞として出ていた。
//
// ラベルが短ければ、それだけでクレジットとみなす。歌詞の行が
// 「数文字＋コロン」で始まることは、まして曲の先頭ではまず無い。
// 既知の語だけに絞る手も試したが、原唱・翻唱のような想定外のラベルで
// 打ち切ってしまい(先頭から連続で見る作りなので)、その後ろの词・曲が
// 素通りした。長いラベルのときだけ既知の語で確かめる。
const CREDIT_LABEL_MAX = 8;

const isCreditLine = (text) => {
  const m = String(text || '').match(/^([^:：]{1,24})[:：]\s*\S/);
  if (!m) return false;
  const label = normalizeCreditLabel(m[1]);
  if (!label) return false;
  if (label.length <= CREDIT_LABEL_MAX) return true;
  return CREDIT_LABEL_KEYS.some(known => (
    // op / sp のような短い綴りは、stop などに紛れ込むので完全一致で見る
    (known.length <= 3 && /^[a-z]+$/.test(known)) ? label === known : label.includes(known)
  ));
};

// 先頭に入る「曲名 - 歌手」とクレジット行を落とす。
// 本物の歌詞と同じ時刻付きなので、そのまま出すとイントロの数秒間ずっと
// 曲名とクレジットがハイライトされ続ける。
//
// lyrics-ui.js 側にも見出し落とし(stripLeadingHeaderLines)はあるが、
// 実測で7曲中5曲が素通りした。あちらは「曲名がそのまま歌い出しになる曲」を
// 巻き込まないよう、次の歌詞まで10秒以上空いていることを条件にしている。
// KuGou の見出しは 0ms から 200〜800ms 間隔で詰まっているので当たらない。
// 見出しが構造として必ず入ると分かっている取得元なので、ここで落とす。
//
// 落とすのは必ず「先頭から連続する分だけ」。1行でも該当しなければ打ち切る
// (見出しを持たない曲もある。実測では Bad Guy が 1行目から歌詞だった)。
//
// コロンの無い行には手を出さない。実測(NiziU / Poppin' Shakin')でクレジットの
// 直後に ASCII だけの行が続く曲があり、英語の歌い出しと見分けが付かない。
// 歌詞を1行消す方が、クレジットが1行残るより悪い。
const MAX_HEADER_LINES = 4;
const MIN_KEPT_LINES = 6;

export const stripLeadingHeaderLines = (lines, want = {}) => {
  if (!Array.isArray(lines) || lines.length < MIN_KEPT_LINES) return lines;
  const title = normalizeTrackTitle(want.track);

  let start = 0;
  while (start < MAX_HEADER_LINES && lines.length - start > MIN_KEPT_LINES) {
    const text = String(lines[start]?.text ?? '').trim();
    if (!text) break;
    // 「曲名 - 歌手」。歌手名の表記はローマ字だったりするので曲名側で見る。
    const isTitleHeader = !!title && / - |｜| \| /.test(text) &&
      normalizeTrackTitle(text).includes(title);
    if (!isTitleHeader && !isCreditLine(text)) break;
    start += 1;
  }
  return start ? lines.slice(start) : lines;
};

export const fetchFromKugou = async (params = {}) => {
  if (!await isOn('kugou')) return null;
  const track = String(params.track || '').trim();
  const artist = String(params.artist || '').trim();
  if (!track) return null;

  // 曲名だけだと候補が空で返ってくる。「アーティスト - 曲名」と長さを渡す。
  const search = new URLSearchParams({
    ver: '1',
    man: 'yes',
    client: 'mobi',
    keyword: artist ? `${artist} - ${track}` : track,
  });
  const durationSec = Number(params.durationSec);
  if (Number.isFinite(durationSec) && durationSec > 0) {
    search.set('duration', String(Math.round(durationSec * 1000)));
  }
  const searchRes = await askProvider('kugou', `${KUGOU_SEARCH_URL}?${search.toString()}`, { method: 'GET' });
  if (!searchRes || searchRes === NOT_FOUND) return null;
  const searchJson = await searchRes.json();
  const hit = pickRemoteCandidate(
    (Array.isArray(searchJson?.candidates) ? searchJson.candidates : []).map(item => ({
      id: item?.id,
      accesskey: item?.accesskey,
      title: item?.song,
      artist: item?.singer,
      durationSec: toFiniteMs(item?.duration) === null ? null : Number(item.duration) / 1000,
    })),
    params,
  );
  if (!hit || !hit.id || !hit.accesskey) return null;

  const download = new URLSearchParams({
    ver: '1',
    client: 'pc',
    id: String(hit.id),
    accesskey: String(hit.accesskey),
    fmt: 'krc',
    charset: 'utf8',
  });
  const lyricRes = await askProvider('kugou', `${KUGOU_DOWNLOAD_URL}?${download.toString()}`, { method: 'GET' });
  if (!lyricRes || lyricRes === NOT_FOUND) return null;
  const lyricJson = await lyricRes.json();
  const content = String(lyricJson?.content || '');
  if (!content) return null;

  const bytes = decodeKrcBase64(content);
  if (!bytes) return null;
  const krc = await inflateZlib(bytes);
  const result = buildResult(parseKrc(krc), params);
  if (result) YTMLog.log('[BG] KuGou hit:', hit.id, hit.title);
  return result;
};

// ============================================================
// 4. LiriQo
//    Apple Music / QQ / KuGou / Musixmatch などを1本に束ねた無料 API。
//    videoId でそのまま引けるのが YouTube Music 向き。
//    ただし個人が動かしている Cloudflare Worker で、1曲 500KB 前後・
//    応答も数秒かかる。主力にはせず、他が空振りした時の最後の網にする。
// ============================================================

const LIRIQO_ENDPOINT = 'https://api.liriqo-alfarrizi.workers.dev/v1/lyrics';

const LIRIQO_SYNC_RANK = { syllable: 4, word: 3, line: 2, plain: 1 };

export const convertLiriqoTrack = (entry) => {
  const timed = Array.isArray(entry?.timed) ? entry.timed : [];
  if (!timed.length) return null;
  const lines = [];
  for (const row of timed) {
    const startTimeMs = toFiniteMs(row?.start);
    if (startTimeMs === null) continue;
    const chars = [];
    let lastWordEnd = null;
    for (const word of (Array.isArray(row?.words) ? row.words : [])) {
      const before = chars.length;
      pushChar(chars, toFiniteMs(word?.start), word?.text);
      if (chars.length > before) lastWordEnd = toFiniteMs(word?.end) ?? lastWordEnd;
    }
    const text = String(row?.text ?? '') || chars.map(ch => ch.c).join('');
    if (!text) continue;
    lines.push({
      startTimeMs,
      // 行の終わりは元データが持っている。捨てると UI 側が最後の語を
      // 次の行まで引き延ばす。語の終わりの方が余韻を含まないので優先する。
      endTimeMs: lastWordEnd ?? toFiniteMs(row?.end) ?? undefined,
      text,
      chars: chars.length ? chars : [{ t: startTimeMs, c: text }],
    });
  }
  return buildResult(lines);
};

// 歌詞のタイムラインが曲の長さに対して短すぎないか。
//
// 実測(2026-09-19): videoId で引いた「群青」に、別の曲(アイドル)の歌詞が
// 付いて返ってきた。向こうのメタデータは正しく「群青」と言っていたので、
// 曲名の突き合わせでは見抜けない。見抜けたのは時間軸だった。
//   正しく返った4曲 : 歌詞の終端 / 曲の長さ = 0.89 〜 0.98
//   中身が別だった1曲: 0.71 (4分35秒の曲に3分14秒ぶんの歌詞)
// 間奏や後奏が長い曲を巻き込まないよう、境目は低めに 0.75 を採る。
// background.js の lyricsBelongToTrack は「長すぎる」側しか見ていないので、
// 短すぎる側はここで落とす。
const LIRIQO_MIN_COVERAGE = 0.75;

// 判定は変換前の timed をそのまま見る。dynamicLines から測っていたときは、
// 行同期しか無い回に null が渡って(chars が無いので)素通りしていた。
// 別の曲が来るのは単語同期とは限らないので、そこも塞ぐ。
export const liriqoCoversTrack = (rows, durationSec) => {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return true;   // 長さ不明なら判断しない
  if (!Array.isArray(rows) || !rows.length) return true;
  let last = 0;
  for (const row of rows) {
    const end = toFiniteMs(row?.end) ?? toFiniteMs(row?.start);
    if (end !== null && end > last) last = end;
  }
  if (!last) return true;
  return (last / 1000) >= duration * LIRIQO_MIN_COVERAGE;
};

export const pickBestLiriqoTrack = (tracks) => {
  let best = null;
  let bestRank = 0;
  for (const track of (Array.isArray(tracks) ? tracks : [])) {
    const rank = LIRIQO_SYNC_RANK[String(track?.syncLevel || '').toLowerCase()] || 0;
    if (rank > bestRank && Array.isArray(track?.timed) && track.timed.length) {
      best = track;
      bestRank = rank;
    }
  }
  return best;
};

export const fetchFromLiriqo = async (params = {}) => {
  if (!await isOn('liriqo')) return null;
  const videoId = String(params.video_id || '').trim();
  const track = String(params.track || '').trim();
  const artist = String(params.artist || '').trim();

  const search = new URLSearchParams();
  // videoId があればそれで引く。曲名検索と違って別バージョンを掴まない。
  if (videoId) search.set('v', videoId);
  else if (track) {
    search.set('title', track);
    if (artist) search.set('artist', artist);
  } else return null;

  // LiriQo は個人が動かしている Cloudflare Worker。無料枠の1日あたりの
  // 上限は「この拡張の利用者ぜんたい」で分け合う形になるので、断られたら
  // いちばん長く休ませる相手でもある(他は各自の IP なので分散する)。
  const res = await askProvider('liriqo', `${LIRIQO_ENDPOINT}?${search.toString()}`, { method: 'GET' });
  if (!res || res === NOT_FOUND) return null;
  const json = await res.json();
  const best = pickBestLiriqoTrack(json?.tracks);
  if (!best) return null;

  // 向こうが曲を解決してから歌詞を集める作りなので、こちらの曲と違うものが
  // 返ってくる余地がある(実測: 存在しない videoId を渡すと無関係の曲が返った)。
  // 曲名がかすりもしない時だけ捨てる。数秒の表記ゆれで落とさないため、
  // ここでは長さを見ない。中身の食い違いは下の liriqoCoversTrack が見る。
  const said = {
    title: best.title || json?.metadata?.title,
    artist: best.artist || json?.metadata?.artist,
    durationSec: null,
  };
  if (track && said.title && scoreRemoteCandidate(said, { track, artist }) < 0) {
    YTMLog.log('[BG] LiriQo は別の曲を返したので捨てる:', said.title);
    return null;
  }

  const result = convertLiriqoTrack(best);
  if (!result) return null;
  if (!liriqoCoversTrack(best.timed, params.durationSec)) {
    YTMLog.log('[BG] LiriQo の歌詞は曲の長さに足りないので捨てる:', said.title);
    return null;
  }
  YTMLog.log('[BG] LiriQo hit:', best.provider, best.syncLevel);
  return result;
};

// ============================================================
// 5. BuaaaBot (https://buaaa.buachi.work/api/lyrics/docs)
//    日本語の曲を中心とした単語同期歌詞(TTML)を、
//    LyricsPlus(KPoe)互換の JSON で返す API。
//
//    引き方は2通りある。
//      id=<videoId>  : 登録してある動画IDとの完全一致。無ければ 404。
//                      カバー動画はそのカバーの時刻にずらした歌詞が返る
//                      (実測: 同じ曲の原曲とカバーで歌い出しが 900ms 違った)。
//      title/artist  : 曲名での検索。これがかなり緩い。実測で、
//                      「Lemon」をアーティスト「Nobody」で投げても米津玄師の
//                      Lemon が返り、「Lemo」でも返った。duration を渡しても
//                      絞り込みには使われない(100秒を渡しても 4分6秒の曲が返る)。
//
//    id と title を同時に渡すと、id が外れた時に黙って曲名検索に落ちるので、
//    どちらで当たったのか見分けが付かない。だから分けて投げる。
//    まず id だけで聞き、404 なら曲名で聞いて、返ってきた曲名・歌手・長さを
//    こちらで突き合わせてから使う。id で当たったものは相手が曲を特定済み
//    なので突き合わせない(カバーは歌手名が原曲と違うのが普通)。
// ============================================================

const BUAAA_ENDPOINT = 'https://buaaa.buachi.work/api/v2/lyrics/get';

// 行の並びを取り出す。ドキュメント上の成功時の形は { status, data: { lyrics } } だが、
// いまの実物はトップにも lyrics と metadata を載せている(LyricsPlus 互換)。
// どちらか片方になっても読めるようにする。
const buaaaRows = (json) => {
  if (Array.isArray(json?.lyrics)) return json.lyrics;
  if (Array.isArray(json?.data?.lyrics)) return json.data.lyrics;
  return [];
};

// LyricsPlus(KPoe)互換の JSON を行に均す。
//
// 入力の形は api.js の convertLyricsPlusResponse と同じだが、あちらとは
// 2点違う。行の終わりを持たせる(持たせないと lyrics-ui.js が最後の語を
// 次の行まで塗り続ける)のと、ハモリ(isBackground)を本編に混ぜない
// (本編と重なる別タイムラインなので、混ぜると語の時刻が行き来する)。
// 行の本文も語から組み直す。印の付いたハモリは row.text にだけ残っていることがある。
// なお 2026-09 時点の実物はハモリにも印を付けず、本編の語として並べてくる。
//
// その代わり、元の TTML(json.ttml)が一緒に付いてくることがあり、そちらには
// ハモリの印(x-bg)が残っている(実物: アイドルの「（信じてる）」)。印がある時は
// TTML から組む。印が無い時は今までどおり JSON から組む(振る舞いを変えない)。
export const convertBuaaaResponse = (json, want) => {
  const ttml = typeof json?.ttml === 'string' ? json.ttml : '';
  if (ttml.includes('ttm:role="x-bg"')) {
    const fromTtml = buildResult(parseTtml(ttml), want);
    if (fromTtml) return fromTtml;
  }
  const rows = buaaaRows(json);
  if (!rows.length) return null;
  const lines = [];
  for (const row of rows) {
    const chars = [];
    const bgChars = [];
    let bgEnd = null;
    let lastWordEnd = null;
    for (const syllable of (Array.isArray(row?.syllabus) ? row.syllabus : [])) {
      if (syllable?.isBackground) {
        const bt = toFiniteMs(syllable?.time);
        pushChar(bgChars, bt, syllable?.text);
        const dur = toFiniteMs(syllable?.duration);
        if (bt !== null && dur !== null && dur > 0) bgEnd = Math.max(bgEnd ?? 0, bt + dur);
        continue;
      }
      const t = toFiniteMs(syllable?.time);
      const before = chars.length;
      pushChar(chars, t, syllable?.text);
      if (chars.length > before) {
        const dur = toFiniteMs(syllable?.duration);
        // 長さの無い語が最後に来たら、手前の語の終わりは使わない
        // (最後の語より前で終わる「終わり」になってしまう)。
        lastWordEnd = (dur !== null && dur > 0) ? t + dur : null;
      }
    }
    const startTimeMs = toFiniteMs(row?.time) ?? (chars.length ? chars[0].t : null);
    if (startTimeMs === null) continue;
    const text = chars.length ? chars.map(ch => ch.c).join('') : String(row?.text ?? '');
    const rowDuration = toFiniteMs(row?.duration);
    lines.push(attachBackgroundVocal({
      startTimeMs,
      endTimeMs: lastWordEnd ?? ((rowDuration !== null && rowDuration > 0) ? startTimeMs + rowDuration : undefined),
      text,
      chars: chars.length ? chars : (text ? [{ t: startTimeMs, c: text }] : []),
    }, chars.length ? makeBackgroundVocal(bgChars, bgEnd) : null));
  }
  return buildResult(lines, want);
};

// 歌詞がどこで終わるか(ミリ秒)。行と語の「開始+長さ」のいちばん遅いもの。
// metadata.totalDuration も同じ値だが(実測10曲でミリ秒まで一致)、
// data の下だけの形では載ってこないので、行から出す方を先に使う。
export const buaaaLyricEndMs = (json) => {
  let end = null;
  const take = (time, duration) => {
    const t = toFiniteMs(time);
    if (t === null) return;
    const d = toFiniteMs(duration);
    const e = t + (d !== null && d > 0 ? d : 0);
    if (end === null || e > end) end = e;
  };
  for (const row of buaaaRows(json)) {
    take(row?.time, row?.duration);
    for (const syllable of (Array.isArray(row?.syllabus) ? row.syllabus : [])) {
      take(syllable?.time, syllable?.duration);
    }
  }
  return end ?? parseTtmlTime(json?.metadata?.totalDuration);
};

// 曲名検索で返ってきたものが、いま流れている曲か。
//
// 相手の検索は緩い(実測: 「Lemon」を別の歌手で投げても米津玄師の Lemon が、
// 「Overdose」を別の歌手で投げても なとり の Overdose が返る。部分一致も拾うので
// 「初恋」に「初」が返る余地もある)。いちど採るとフォールバック段の早い者勝ちで
// そのまま居座るので、次を全部満たしたものだけ使う。
//
//   曲名 : 一致か、付属物だけの違い(「千本桜」と「千本桜 (feat. 初音ミク)」)。
//          「どちらかがもう一方を含む」では広すぎる(「初恋」と「初」、
//          「Lemonade」と「Lemon」が通ってしまう)。
//   長さ : 歌詞が曲より長くないこと、かつ曲の 3/4 以上を覆っていること。
//          相手の totalDuration は曲の長さではなく最後の語の終わりなので、
//          後奏のぶん必ず曲より短い(実測: Lemon は曲 256 秒・歌詞 246.7 秒、
//          POP STAR は 283 秒・250.2 秒)。両側で「近いこと」を求めてはいけない。
//          3/4 の境目は LiriQo の別曲判定(LIRIQO_MIN_COVERAGE)と同じ実測に拠る。
//   歌手 : 一致(どちらかがもう一方を含む)。
//          ただし曲名が一致で、歌手名の文字の種類が違う時(YouTube Music が
//          ローマ字の Kenshi Yonezu、相手が漢字の 米津玄師)は突き合わせようがない。
//          その時だけ、歌詞の終わりが曲の終わりのすぐ手前(後奏 15 秒以内)で
//          あることを代わりに求める。同じ文字の種類で名前が違えば別の歌手とみなす。
const BUAAA_LYRICS_OVERRUN_SEC = 3;     // 歌詞が曲より長くてよい幅(丸めと版の揺れ)
const BUAAA_MIN_COVERAGE = 0.75;
const BUAAA_ROMANIZED_OUTRO_SEC = 15;

// NFKC・小文字・空白抜きにした曲名で、短い方の後ろに続くのが付属物か。
const BUAAA_TITLE_SUFFIX = /^(?:[(\[【「『〈《<\-–—~〜:|/]|(?:featuring|feat|ft|with)(?![a-z]))/;
const isTitleSuffixVariant = (a, b) => {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2 || long === short || !long.startsWith(short)) return false;
  return BUAAA_TITLE_SUFFIX.test(long.slice(short.length));
};

// 仮名・漢字・ハングルを含むか。ローマ字表記との食い違いを見分けるのに使う。
const CJK_SCRIPT = /[぀-ヿㇰ-ㇿ㐀-䶿一-鿿가-힯ｦ-ﾟ]/;

export const buaaaMatchesTrack = (candidate, want) => {
  const wantTitle = normalizeTrackTitle(want?.track);
  const title = normalizeTrackTitle(candidate?.title);
  if (!wantTitle || !title) return false;
  const sameTitle = title === wantTitle;
  if (!sameTitle && !isTitleSuffixVariant(title, wantTitle)) return false;

  const wantSec = Number(want?.durationSec);
  const endMs = Number(candidate?.lyricEndMs);
  const lengthKnown = Number.isFinite(wantSec) && wantSec > 0 && Number.isFinite(endMs) && endMs > 0;
  const endSec = endMs / 1000;
  if (lengthKnown) {
    if (endSec > wantSec + BUAAA_LYRICS_OVERRUN_SEC) return false;   // 歌詞が曲からはみ出す
    if (endSec < wantSec * BUAAA_MIN_COVERAGE) return false;          // 曲の途中で歌詞が尽きる
  }

  const wantArtistRaw = String(want?.artist ?? '');
  const artistRaw = String(candidate?.artist ?? '');
  const wantArtist = normalizeArtist(wantArtistRaw);
  const artist = normalizeArtist(artistRaw);
  if (wantArtist && artist && (artist.includes(wantArtist) || wantArtist.includes(artist))) return true;

  // ここから下は歌手を突き合わせられなかった回。付属物の違いまで許すと
  // 同名の別の曲を拾う余地が広がるので、曲名の一致を求める。
  if (!sameTitle || !lengthKnown) return false;
  const cannotCompare = !wantArtist || !artist || CJK_SCRIPT.test(wantArtistRaw) !== CJK_SCRIPT.test(artistRaw);
  if (!cannotCompare) return false;
  return wantSec - endSec <= BUAAA_ROMANIZED_OUTRO_SEC;
};

// 返事を JSON として読む。「見つからない」は 404 で来るが、200 で
// status: 'error' を返す形もありうるので、それも無かったことにする。
const readBuaaaJson = async (res) => {
  const json = await res.json().catch(() => null);
  return (json && typeof json === 'object' && json.status !== 'error') ? json : null;
};

const buaaaMetadata = (json) => ({
  title: json?.metadata?.title ?? json?.data?.title,
  artist: json?.metadata?.artist ?? json?.data?.artist,
});

export const fetchFromBuaaa = async (params = {}) => {
  if (!await isOn('buaaa')) return null;
  const videoId = String(params.video_id || '').trim();
  const track = String(params.track || '').trim();
  const artist = String(params.artist || '').trim();

  if (videoId) {
    const res = await askProvider('buaaa', `${BUAAA_ENDPOINT}?${new URLSearchParams({ id: videoId })}`, { method: 'GET' });
    // null は、断られた・落ちている・想定外の応答のどれか。どれでも曲名では
    // 聞き直さない(429 / 403 / 5xx は askProvider が休止にも入れている)。
    if (!res) return null;
    if (res !== NOT_FOUND) {
      // id で当たった。中身が使えなくても曲名で引き直さない。
      // カバー動画の id で当たった時に曲名で引くと、原曲の時刻が返ってずれる。
      const json = await readBuaaaJson(res);
      const result = json ? convertBuaaaResponse(json, params) : null;
      if (result) YTMLog.log('[BG] BuaaaBot hit (id):', videoId, buaaaMetadata(json).title || '');
      return result;
    }
  }

  if (!track) return null;
  const search = new URLSearchParams({ title: track });
  if (artist) search.set('artist', artist);
  const durationSec = Number(params.durationSec);
  if (Number.isFinite(durationSec) && durationSec > 0) {
    search.set('duration', String(Math.round(durationSec)));
  }
  const res = await askProvider('buaaa', `${BUAAA_ENDPOINT}?${search.toString()}`, { method: 'GET' });
  if (!res || res === NOT_FOUND) return null;
  const json = await readBuaaaJson(res);
  if (!json) return null;
  const said = { ...buaaaMetadata(json), lyricEndMs: buaaaLyricEndMs(json) };
  if (!buaaaMatchesTrack(said, params)) {
    YTMLog.log('[BG] BuaaaBot は別の曲を返したので捨てる:', said.title, '/', said.artist);
    return null;
  }
  const result = convertBuaaaResponse(json, params);
  if (result) YTMLog.log('[BG] BuaaaBot hit (title):', said.title || track);
  return result;
};
