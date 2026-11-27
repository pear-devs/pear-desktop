// ── デバッグログ ────────────────────────────────────────────
// このファイルは ES モジュールなので background.js のスコープを共有しない。
// 既定は無効。chrome.storage の ytm_debug で有効化する。
const YTMLog = (() => {
  let enabled = false;
  const api = {
    log: (...a) => { if (enabled) console.log('[YTM]', ...a); },
    info: (...a) => { if (enabled) console.info('[YTM]', ...a); },
    debug: (...a) => { if (enabled) console.debug('[YTM]', ...a); },
  };
  try {
    chrome.storage.local.get(['ytm_debug'], (res) => {
      enabled = !!res && (res.ytm_debug === '1' || res.ytm_debug === true);
    });
  } catch (e) { /* 読めなければ無効のまま */ }
  return api;
})();

export const normalizeArtist = (s) =>
  (s || '').toLowerCase().replace(/\s+/g, '').trim();

// ── LRCHub のサーキットブレーカー ──────────────────────────────
// サーバーが落ちている(または経路が塞がっている)時、曲を再生するたびに
// タイムアウトを待つと歌詞の表示がまるごとそのぶん遅れる。1曲につき
// primary / search / retry の3回叩くので、待ち時間は積み上がる。
// 通信そのものに連続で失敗したら一定時間だけ問い合わせを止め、
// LrcLib など他のソースへ即座に回す。
//
// 「見つからなかった(HTTPは返ってきた)」は失敗に数えない。
// 数えると、単に LRCHub に無いだけの曲が続いた時に止めてしまう。
const LRCHUB_FAIL_THRESHOLD = 3;
const LRCHUB_COOLDOWN_MS = 3 * 60 * 1000;
let lrchubFailStreak = 0;
let lrchubSkipUntil = 0;

export const isLrchubReachable = () => Date.now() >= lrchubSkipUntil;

const noteLrchubTransport = (ok) => {
  if (ok) {
    lrchubFailStreak = 0;
    lrchubSkipUntil = 0;
    return;
  }
  lrchubFailStreak += 1;
  if (lrchubFailStreak >= LRCHUB_FAIL_THRESHOLD && Date.now() >= lrchubSkipUntil) {
    lrchubSkipUntil = Date.now() + LRCHUB_COOLDOWN_MS;
    console.warn(`[BG] LRCHub に接続できないため ${LRCHUB_COOLDOWN_MS / 60000} 分間スキップします`);
  }
};

export const normalizeTrackTitle = (s) => String(s || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '')
  .trim();

const lrcLibDurationSec = (item) => {
  const n = Number(item?.duration ?? item?.durationSec ?? item?.duration_sec);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// 同じ絞り込み段の中から1件選ぶ。曲名と尺で点を付けるだけで、
// ここで候補を捨てはしない。決め手が無ければ元の「最初の1件」に落ちる。
//
// アーティスト名しか見ずに先頭を取っていた頃は、同じ曲の別テイク
// (「曲名」と「曲名 - From THE FIRST TAKE」など)が並んでいると、
// 再生中の動画と無関係な方を掴んで最初から最後までずれ続けていた。
const rankLrcLibTier = (items, track, durationSec) => {
  if (!items.length) return null;
  const targetTitle = normalizeTrackTitle(track);
  const targetDuration = Number.isFinite(Number(durationSec)) && Number(durationSec) > 0
    ? Number(durationSec)
    : null;
  // 手掛かりが何も無ければ従来どおり先頭
  if (!targetTitle && targetDuration === null) return items[0];

  let best = null;
  let bestScore = -Infinity;
  for (const item of items) {
    let score = 0;

    const title = normalizeTrackTitle(item?.trackName || item?.track_name || item?.name);
    if (targetTitle && title) {
      if (title === targetTitle) score += 100;
      // 部分一致は向きで重みを変える。再生中が「曲名 - 別テイク」の時に
      // 素の「曲名」で妥協するのは有りだが、その逆は避けたい。
      else if (targetTitle.includes(title)) score += 40;
      else if (title.includes(targetTitle)) score += 10;
    }

    if (targetDuration !== null) {
      const duration = lrcLibDurationSec(item);
      if (duration !== null) {
        const diff = Math.abs(duration - targetDuration);
        if (diff <= 2) score += 30;
        else if (diff <= 5) score += 15;
        else if (diff <= 10) score += 5;
        // 尺が大きく違うものは別音源。ただし曲名の完全一致は覆さない。
        else score -= Math.min(30, diff);
      }
    }

    // 同点なら先に出てきた方を残す = 従来の「最初の1件」と同じ結果
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  return best || items[0];
};

export const pickBestLrcLibHit = (items, artist, options = {}) => {
  if (!Array.isArray(items) || !items.length) return null;
  const target = normalizeArtist(artist);
  const { track = '', durationSec = null } = options || {};
  const getArtistName = (it) =>
    it.artistName || it.artist || it.artist_name || '';

  // アーティスト名が取れない曲(MediaSession 未設定・UGC など)がある。
  // 以前はここで諦めていたので、検索結果があっても歌詞が採用されず、
  // 候補は並ぶのに何も出ない状態になっていた。曲名と尺だけで選ぶ。
  if (!target) {
    const synced = items.filter(it => !!(it.syncedLyrics || it.synced_lyrics));
    const plain = items.filter(it => !!(it.plainLyrics || it.plain_lyrics));
    if (synced.length) return rankLrcLibTier(synced, track, durationSec);
    if (plain.length) return rankLrcLibTier(plain, track, durationSec);
    return null;
  }

  const exactArtist = (it) => {
    const a = normalizeArtist(getArtistName(it));
    return !!a && a === target;
  };
  const partialArtist = (it) => {
    const a = normalizeArtist(getArtistName(it));
    return !!a && (a.includes(target) || target.includes(a));
  };
  const hasSynced = (it) => !!(it.syncedLyrics || it.synced_lyrics);
  const hasPlain = (it) => !!(it.plainLyrics || it.plain_lyrics);

  // 段の順番は従来のまま。変えたのは「段の中でどれを取るか」だけなので、
  // 今まで歌詞が出ていた曲でここが空振りになることはない。
  const tiers = [
    (it) => exactArtist(it) && hasSynced(it),
    (it) => exactArtist(it) && hasPlain(it),
    (it) => partialArtist(it) && hasSynced(it),
    (it) => partialArtist(it) && hasPlain(it),
  ];

  for (const matches of tiers) {
    const tier = items.filter(matches);
    if (tier.length) return rankLrcLibTier(tier, track, durationSec);
  }

  return null;
};

export const fetchFromLrcLib = (track, artist, durationSec = null) => {
  if (!track) return Promise.resolve({ lyrics: '', candidates: [] });

  // 曲名だけで引くと結果が最大20件で打ち切られ、同名異曲に押し出されて
  // 目当てのアーティストの行が入ってこないことがある。
  // artist_name まで渡して絞り、0件だった時だけ曲名だけの検索に落とす。
  const searchUrl = (withArtist) => {
    const params = new URLSearchParams({ track_name: track });
    if (withArtist && artist) params.set('artist_name', artist);
    return `https://lrclib.net/api/search?${params.toString()}`;
  };
  const search = (withArtist) => fetch(searchUrl(withArtist))
    .then(r => (r.ok ? r.json() : Promise.reject(r.statusText)));

  YTMLog.log('[BG] LrcLib search:', track, '/', artist || '(artist未指定)');

  return (artist ? search(true).then(list => (
    Array.isArray(list) && list.length ? list : search(false)
  )) : search(false))
    .then(list => {
      YTMLog.log('[BG] LrcLib search result count:', Array.isArray(list) ? list.length : 'N/A');
      const items = Array.isArray(list) ? list : [];
      
      const hit = pickBestLrcLibHit(items, artist, { track, durationSec });

      let bestLyrics = '';
      if (hit) {
        const synced = hit.syncedLyrics || hit.synced_lyrics || '';
        const plain = hit.plainLyrics || hit.plain_lyrics || hit.plain_lyrics_text || '';
        bestLyrics = (synced || plain || '').trim();
      }

      const candidates = items.map(item => {
        const synced = item.syncedLyrics || item.synced_lyrics || '';
        const plain = item.plainLyrics || item.plain_lyrics || item.plain_lyrics_text || '';
        const txt = (synced || plain || '').trim();
        if (!txt) return null;

        return {
          id: `lrclib_${item.id}`,
          artist: item.artistName || item.artist,
          title: item.trackName || item.track_name || item.name || '',
          duration: lrcLibDurationSec(item),
          source: 'LrcLib',
          has_synced: !!synced,
          lyrics: txt
        };
      }).filter(Boolean);

      return { lyrics: bestLyrics, candidates: candidates };
    })
    .catch(err => {
      console.error('[BG] LrcLib error:', err);
      return { lyrics: '', candidates: [] };
    });
};

export const formatLrcTime = (seconds) => {
  const total = Math.max(0, seconds);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total - min * 60);
  const cs = Math.floor((total - min * 60 - sec) * 100);
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  const cc = String(cs).padStart(2, '0');
  return `${mm}:${ss}.${cc}`;
};

export const getCacheBuster = () => {
  return Math.floor(1000 + Math.random() * 9000).toString();
};

export const toLrchubTranslateLang = (lang) => {
  const key = String(lang || '').trim().toLowerCase();
  if (!key || key === 'original') return '';
  if (key === 'ja' || key === 'jp') return 'JA';
  if (key === 'en' || key === 'en-us' || key === 'en-gb') return 'EN';
  if (key === 'ko' || key === 'kr') return 'KO';
  if (key === 'zh' || key === 'cn' || key === 'zh-cn' || key === 'zh-tw') return 'CN';
  return key.toUpperCase();
};

export const toUiLangKey = (lang) => {
  const key = String(lang || '').trim().toLowerCase();
  if (key === 'jp') return 'ja';
  if (key === 'kr') return 'ko';
  if (key === 'cn' || key === 'zh-cn' || key === 'zh-tw') return 'zh';
  return key;
};

export const extractTranslationLyrics = (value) => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';

  const fields = [
    value.lyrics,
    value.synced_lyrics,
    value.syncedLyrics,
    value.lrc,
    value.plain_lyrics,
    value.plainLyrics,
    value.text
  ];

  for (const field of fields) {
    if (typeof field === 'string' && field.trim()) return field.trim();
  }
  return '';
};

export const normalizeLrchubTranslations = (translations) => {
  const lrcMap = {};
  if (!translations) return lrcMap;

  if (translations.lrc_map && typeof translations.lrc_map === 'object') {
    Object.entries(translations.lrc_map).forEach(([lang, lyrics]) => {
      const key = toUiLangKey(lang);
      const text = extractTranslationLyrics(lyrics);
      if (key && text) lrcMap[key] = text;
    });
  }

  if (Array.isArray(translations)) {
    translations.forEach((item) => {
      if (!item) return;
      const lang = item.language || item.lang || item.target_lang || item.targetLang;
      const key = toUiLangKey(lang);
      const text = extractTranslationLyrics(item);
      if (key && text) lrcMap[key] = text;
    });
    return lrcMap;
  }

  if (typeof translations === 'object') {
    Object.entries(translations).forEach(([lang, value]) => {
      if (lang === 'lrc_map') return;
      const key = toUiLangKey(value?.language || value?.lang || lang);
      const text = extractTranslationLyrics(value);
      if (key && text) lrcMap[key] = text;
    });
  }

  return lrcMap;
};

export const normalizeLrchubMeaningPayload = (res) => {
  if (!res || typeof res !== 'object') return null;

  const explanations = Array.isArray(res.explanations)
    ? res.explanations
    : (Array.isArray(res.timeline_meanings) ? res.timeline_meanings : []);
  const songSummary = (
    (res.song_summary && typeof res.song_summary === 'object') ? res.song_summary :
    (res.songSummary && typeof res.songSummary === 'object') ? res.songSummary :
    null
  );
  const finalSummary = (res.final_summary && typeof res.final_summary === 'object') ? res.final_summary : null;
  const comments = Array.isArray(res.comments) ? res.comments : [];
  const rating = (res.rating && typeof res.rating === 'object') ? res.rating : null;

  if (!explanations.length && !songSummary && !finalSummary && !comments.length && !rating) {
    return null;
  }

  return {
    title: res.display_name || res.title || res.track || '',
    track: res.track || res.title || '',
    artist: res.artist || res.artist_name || '',
    explanations,
    song_summary: songSummary,
    final_summary: finalSummary,
    comments,
    rating,
  };
};

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    const numeric = toFiniteNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
};

const unwrapLrchubRecord = (res) => {
  if (!res || typeof res !== 'object' || Array.isArray(res)) return res;
  if (!res.record || typeof res.record !== 'object' || Array.isArray(res.record)) return res;
  return {
    ...res,
    ...res.record,
  };
};

const getLrchubVideoLinks = (res) => {
  if (!res || typeof res !== 'object') return [];
  const record = unwrapLrchubRecord(res) || {};
  const lists = [
    record.video_links,
    record.videoLinks,
    record.provider_meta?.video_links,
    record.providerMeta?.videoLinks,
    res.video_links,
    res.videoLinks,
    res.provider_meta?.video_links,
    res.providerMeta?.videoLinks,
  ];
  const normalizeList = (list) => {
    if (Array.isArray(list)) return list;
    if (!list || typeof list !== 'object') return [];
    return Object.entries(list).map(([mappedVideoId, value]) => (
      value && typeof value === 'object'
        ? { video_id: mappedVideoId, ...value }
        : { video_id: mappedVideoId, offset_ms: value }
    ));
  };
  return lists.flatMap(normalizeList);
};

export const getLrchubVideoOffsetMs = (res, videoId = '') => {
  if (!res || typeof res !== 'object') return 0;
  const record = unwrapLrchubRecord(res) || {};
  const explicitVideoId = String(videoId || '').trim();
  const responseVideoId = String(
    record.video_id || record.videoId || res.video_id || res.videoId || ''
  ).trim();
  const requestedVideoId = String(
    explicitVideoId || responseVideoId
  ).trim();
  const links = getLrchubVideoLinks(res);

  if (requestedVideoId) {
    const exact = links.find(link => (
      String(link?.video_id || link?.videoId || '').trim() === requestedVideoId
    ));
    const exactOffset = toFiniteNumber(exact?.offset_ms ?? exact?.offsetMs);
    if (exactOffset !== null) return exactOffset;
    // Never borrow an offset registered for another video of the same song.
    if (links.length) return 0;
    // A direct offset is only exact when the response identifies the same
    // video. Identity-free record/search offsets must not leak across videos.
    if (explicitVideoId && responseVideoId !== explicitVideoId) return 0;
    if (responseVideoId && responseVideoId !== requestedVideoId) return 0;
  }

  const directOffset = [
    record.offset_ms,
    record.offsetMs,
    res.offset_ms,
    res.offsetMs,
  ].map(toFiniteNumber).find(value => value !== null);
  return directOffset ?? 0;
};

export const shiftLrcTimestamps = (text, offsetMs) => {
  if (typeof text !== 'string' || !text || !Number.isFinite(Number(offsetMs)) || Number(offsetMs) === 0) {
    return text;
  }
  const deltaMs = Number(offsetMs);
  const timestampPattern = /([\[<])(\d+):(\d{2})(?:([.:])(\d{1,3}))?([\]>])/g;

  return text.replace(timestampPattern, (full, open, minuteRaw, secondRaw, separator, fractionRaw, close) => {
    const minutes = Number(minuteRaw);
    const seconds = Number(secondRaw);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return full;

    const fraction = String(fractionRaw || '');
    const fractionMs = fraction
      ? Number(fraction.padEnd(3, '0').slice(0, 3))
      : 0;
    const shiftedMs = Math.max(0, ((minutes * 60 + seconds) * 1000) + fractionMs + deltaMs);
    const shiftedMinutes = Math.floor(shiftedMs / 60000);
    const shiftedSeconds = Math.floor((shiftedMs % 60000) / 1000);
    const shiftedFractionMs = Math.floor(shiftedMs % 1000);
    const minuteText = String(shiftedMinutes).padStart(Math.max(2, minuteRaw.length), '0');
    const secondText = String(shiftedSeconds).padStart(2, '0');

    let fractionLength = fraction.length;
    if (!fractionLength && shiftedFractionMs !== 0) fractionLength = 3;
    let fractionText = '';
    if (fractionLength) {
      fractionText = String(shiftedFractionMs).padStart(3, '0').slice(0, fractionLength);
    }
    const fractionPart = fractionLength ? `${separator || '.'}${fractionText}` : '';
    return `${open}${minuteText}:${secondText}${fractionPart}${close}`;
  });
};

const normalizeDynamicLineObjects = (value) => {
  const sourceLines = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' && Array.isArray(value.lines) ? value.lines : null);
  if (!sourceLines) return value;

  const normalizedLines = sourceLines.map(line => {
    const startTimeMs = firstFiniteNumber(
      line?.startTimeMs, line?.start_ms, line?.startMs, line?.time
    );
    const endTimeMs = firstFiniteNumber(
      line?.endTimeMs, line?.end_ms, line?.endMs, line?.endTime
    );
    const chars = Array.isArray(line?.chars)
      ? line.chars.map(char => {
        const t = firstFiniteNumber(
          char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time
        );
        const c = char?.c ?? char?.char ?? char?.text ?? char?.caption ?? char?.value;
        return {
          ...char,
          ...(t === null ? {} : { t }),
          ...(c === undefined || c === null ? {} : { c: String(c) }),
        };
      })
      : line?.chars;
    return {
      ...line,
      ...(startTimeMs === null ? {} : { startTimeMs }),
      ...(endTimeMs === null ? {} : { endTimeMs }),
      chars,
    };
  });

  return Array.isArray(value) ? normalizedLines : { ...value, lines: normalizedLines };
};

const shiftDynamicLineObjects = (value, offsetMs) => {
  const normalized = normalizeDynamicLineObjects(value);
  const sourceLines = Array.isArray(normalized) ? normalized : normalized?.lines;
  if (!Array.isArray(sourceLines)) return normalized;
  const deltaMs = Number(offsetMs);
  if (!Number.isFinite(deltaMs) || deltaMs === 0) return normalized;

  const shiftNumeric = (raw) => {
    const numeric = toFiniteNumber(raw);
    return numeric === null ? raw : Math.max(0, numeric + deltaMs);
  };

  const shiftedLines = sourceLines.map(line => ({
      ...line,
      startTimeMs: shiftNumeric(line?.startTimeMs),
      endTimeMs: shiftNumeric(line?.endTimeMs),
      chars: Array.isArray(line?.chars)
        ? line.chars.map(char => ({
          ...char,
          t: shiftNumeric(char?.t),
          startTimeMs: shiftNumeric(char?.startTimeMs),
        }))
        : line?.chars,
    }));
  return Array.isArray(normalized) ? shiftedLines : { ...normalized, lines: shiftedLines };
};

const shiftTimedTranslationPayload = (value, offsetMs) => {
  if (typeof value === 'string') {
    return /[\[<]\d+:\d{2}/.test(value) ? shiftLrcTimestamps(value, offsetMs) : value;
  }
  if (Array.isArray(value)) return value.map(item => shiftTimedTranslationPayload(item, offsetMs));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, shiftTimedTranslationPayload(nested, offsetMs)])
  );
};

const ANIMATED_LYRICS_FIELDS = [
  'animated_lyrics',
  'timedtext',
  'timed_text',
  'youtube_timedtext',
  'caption_xml',
  'captionXml',
];
const isSrv3TimedText = (value) => (
  typeof value === 'string' &&
  /<timedtext\b/i.test(value) &&
  /<body\b/i.test(value) &&
  /<p\b/i.test(value)
);
const ANIMATED_JSON_MS_KEYS = new Set(['t', 'time_ms', 'start_ms', 'end_ms', 'timestamp_ms']);
const ANIMATED_JSON_SECOND_KEYS = new Set(['start', 'end', 'time', 'timestamp', 'begin']);

const getAnimatedLyricsEntry = (value) => {
  if (!value || typeof value !== 'object') return null;
  for (const key of ANIMATED_LYRICS_FIELDS) {
    if (typeof value[key] === 'string' && value[key].trim()) {
      return { key, text: value[key] };
    }
  }
  for (const key of ['dynamic_lrc', 'dynamic_lyrics', 'dynamicLrc', 'dynamicLyrics', 'lyrics']) {
    if (isSrv3TimedText(value[key])) return { key, text: value[key] };
  }
  return null;
};

const formatAnimatedSeconds = (value) => {
  const text = Number(value).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return text || '0';
};

const shiftAnimatedMsValue = (value, offsetMs) => {
  if (typeof value === 'boolean') return value;
  const numeric = toFiniteNumber(value);
  if (numeric === null) return value;
  const shifted = Math.max(0, Math.round(numeric + offsetMs));
  return typeof value === 'string' ? String(shifted) : shifted;
};

const shiftAnimatedSecondsValue = (value, offsetMs) => {
  if (typeof value === 'boolean') return value;
  const numeric = toFiniteNumber(value);
  if (numeric === null) return value;
  const shifted = Math.max(0, numeric + (offsetMs / 1000));
  return typeof value === 'string' ? formatAnimatedSeconds(shifted) : shifted;
};

const shiftAnimatedJsonTimes = (value, offsetMs) => {
  if (Array.isArray(value)) return value.map(item => shiftAnimatedJsonTimes(item, offsetMs));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    const normalizedKey = String(key).toLowerCase();
    if (ANIMATED_JSON_MS_KEYS.has(normalizedKey)) {
      return [key, shiftAnimatedMsValue(nested, offsetMs)];
    }
    if (ANIMATED_JSON_SECOND_KEYS.has(normalizedKey)) {
      return [key, shiftAnimatedSecondsValue(nested, offsetMs)];
    }
    return [key, shiftAnimatedJsonTimes(nested, offsetMs)];
  }));
};

const shiftAnimatedTimedText = (text, offsetMs) => {
  const paragraphPattern = /(<p\b[^>]*?\bt\s*=\s*)(["'])(-?\d+(?:\.\d+)?)(\2)/gi;
  const textPattern = /(<text\b[^>]*?\bstart\s*=\s*)(["'])(-?\d+(?:\.\d+)?)(\2)/gi;
  const shiftedParagraphs = text.replace(
    paragraphPattern,
    (full, prefix, quote, raw, suffix) => (
      `${prefix}${quote}${shiftAnimatedMsValue(raw, offsetMs)}${suffix}`
    ),
  );
  return shiftedParagraphs.replace(
    textPattern,
    (full, prefix, quote, raw, suffix) => (
      `${prefix}${quote}${shiftAnimatedSecondsValue(raw, offsetMs)}${suffix}`
    ),
  );
};

const shiftAnimatedLyricsPayload = (animatedLyrics, offsetMs) => {
  if (typeof animatedLyrics !== 'string' || !animatedLyrics || !Number.isFinite(Number(offsetMs)) || Number(offsetMs) === 0) {
    return animatedLyrics;
  }
  const text = String(animatedLyrics);
  const stripped = text.trimStart();
  if (stripped.startsWith('{') || stripped.startsWith('[')) {
    try {
      return JSON.stringify(shiftAnimatedJsonTimes(JSON.parse(text), Number(offsetMs)));
    } catch (e) {
      // Continue with TimedText/LRC detection when a JSON-looking payload is malformed.
    }
  }
  const shiftedTimedText = shiftAnimatedTimedText(text, Number(offsetMs));
  if (shiftedTimedText !== text) return shiftedTimedText;
  if (/[\[<]\d{1,3}:\d{2}(?:[.:]\d{1,3})?[\]>]/.test(text)) {
    return shiftLrcTimestamps(text, Number(offsetMs));
  }
  return text;
};

const sha256Hex = async (text) => {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle || typeof subtle.digest !== 'function' || typeof TextEncoder !== 'function') return null;
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
    return Array.from(
      new Uint8Array(digest),
      byte => byte.toString(16).padStart(2, '0'),
    ).join('');
  } catch (e) {
    return null;
  }
};

const applyVerifiedAnimatedOffset = async (raw, normalized, videoId) => {
  if (!raw || !normalized || typeof normalized !== 'object') return normalized;
  const source = unwrapLrchubRecord(raw);
  if (!source || typeof source !== 'object') return normalized;
  const animated = getAnimatedLyricsEntry(source);
  if (!animated) return normalized;

  const requestedVideoId = String(videoId || source.video_id || source.videoId || '').trim();
  if (!requestedVideoId) return normalized;
  const offsetMs = getLrchubVideoOffsetMs(raw, requestedVideoId);
  if (!offsetMs) return normalized;

  const appliedVideoId = String(source._ytmAnimatedOffsetAppliedForVideoId || '').trim();
  const appliedOffsetMs = toFiniteNumber(source._ytmAnimatedOffsetAppliedMs);
  if (appliedVideoId === requestedVideoId && appliedOffsetMs === offsetMs) return normalized;

  const providerMeta = source.provider_meta || source.providerMeta;
  if (!providerMeta || providerMeta.animated_lyrics_offset_normalized !== true) return normalized;
  const expectedHash = String(providerMeta.animated_lyrics_offset_normalized_hash || '').trim();
  if (expectedHash) {
    const actualHash = await sha256Hex(animated.text);
    if (!actualHash || actualHash !== expectedHash) return normalized;
  }

  const shiftedAnimated = shiftAnimatedLyricsPayload(animated.text, offsetMs);
  const aliases = {};
  for (const key of ANIMATED_LYRICS_FIELDS) {
    if (source[key] === animated.text) aliases[key] = shiftedAnimated;
  }
  const normalizedLyricsMatchesAnimated = (
    typeof normalized.lyrics === 'string' &&
    normalized.lyrics.trim() === animated.text.trim()
  );
  return {
    ...normalized,
    ...aliases,
    animated_lyrics: shiftedAnimated,
    ...(normalizedLyricsMatchesAnimated ? { lyrics: shiftedAnimated } : {}),
    _ytmAnimatedOffsetAppliedForVideoId: requestedVideoId,
    _ytmAnimatedOffsetAppliedMs: offsetMs,
  };
};

const applyLrchubVideoOffset = (res, videoId) => {
  const record = unwrapLrchubRecord(res);
  if (!record || typeof record !== 'object') return record;
  const requestedVideoId = String(videoId || record.video_id || record.videoId || '').trim();
  if (requestedVideoId && record.offsetAppliedForVideoId === requestedVideoId) return record;
  const offsetMs = getLrchubVideoOffsetMs(res, videoId);
  if (!offsetMs) {
    return {
      ...record,
      offset_ms: 0,
      video_id: requestedVideoId,
      offsetAppliedForVideoId: requestedVideoId || null,
    };
  }

  const shifted = {
    ...record,
    offset_ms: offsetMs,
    video_id: requestedVideoId,
    offsetAppliedForVideoId: requestedVideoId || null,
  };
  ['dynamic_lrc', 'dynamic_lyrics', 'dynamicLrc', 'dynamicLyrics', 'synced_lyrics', 'syncedLyrics', 'lrc'].forEach(key => {
    if (typeof shifted[key] === 'string') shifted[key] = shiftLrcTimestamps(shifted[key], offsetMs);
  });
  const rawAnimated = getAnimatedLyricsEntry(record);
  const lyricsDuplicatesAnimated = !!rawAnimated &&
    typeof record.lyrics === 'string' &&
    record.lyrics.trim() === rawAnimated.text.trim();
  if (!lyricsDuplicatesAnimated && typeof shifted.lyrics === 'string' && /[\[<]\d+:\d{2}/.test(shifted.lyrics)) {
    shifted.lyrics = shiftLrcTimestamps(shifted.lyrics, offsetMs);
  }
  // Raw animated captions are not necessarily canonicalized to the song
  // timeline. LRCHub only shifts them after a flag + payload-hash check, so the
  // conservative client path leaves them untouched.
  ['dynamic_lrc', 'dynamic_lyrics', 'dynamicLrc', 'dynamicLyrics'].forEach(key => {
    if (shifted[key] && typeof shifted[key] === 'object') {
      shifted[key] = shiftDynamicLineObjects(shifted[key], offsetMs);
    }
  });
  ['lrc_map', 'lrcMap', 'translations'].forEach(key => {
    if (shifted[key]) shifted[key] = shiftTimedTranslationPayload(shifted[key], offsetMs);
  });
  return shifted;
};

export const normalizeLrchubLyricsResponse = (res, options = {}) => {
  if (!res || typeof res !== 'object') return null;
  const normalizedOptions = typeof options === 'string' ? { videoId: options } : (options || {});
  const videoId = normalizedOptions.videoId || '';
  const source = normalizedOptions.applyVideoOffset
    ? applyLrchubVideoOffset(res, videoId)
    : unwrapLrchubRecord(res);
  if (!source || typeof source !== 'object') return null;
  const translationOffsetMs = normalizedOptions.applyVideoOffsetToTranslations
    ? getLrchubVideoOffsetMs(source, videoId)
    : 0;
  const translationPayload = (value) => (
    translationOffsetMs ? shiftTimedTranslationPayload(value, translationOffsetMs) : value
  );

  let lyrics = '';
  let dynamicLines = null;
  const explicitAnimatedLyrics = [
    source.animated_lyrics,
    source.timedtext,
    source.timed_text,
    source.youtube_timedtext,
    source.caption_xml,
    source.captionXml
  ].find(value => typeof value === 'string' && value.trim()) || '';
  // 古い/互換APIでは srv3 XML が DynamicLRC 用の別名や lyrics 本体へ
  // 入ることがある。内容で判定して animated_lyrics へ正規化し、
  // DynamicLRC parserへ誤投入されたまま描画経路を失わないようにする。
  const aliasedSrv3Lyrics = [
    source.dynamic_lrc,
    source.dynamic_lyrics,
    source.dynamicLrc,
    source.dynamicLyrics,
    source.lyrics,
  ].find(isSrv3TimedText) || '';
  const animatedLyricsXml = explicitAnimatedLyrics || aliasedSrv3Lyrics;

  const dynText = source.dynamic_lrc || source.dynamic_lyrics || source.dynamicLrc || source.dynamicLyrics;
  if (dynText) {
    if (typeof dynText === 'string') {
      dynamicLines = parseDynamicLrc(dynText);
      lyrics = buildLrcFromDynamic(dynamicLines);
    } else if (typeof dynText === 'object') {
      const normalizedDynamic = normalizeDynamicLineObjects(dynText);
      dynamicLines = Array.isArray(normalizedDynamic) ? normalizedDynamic : normalizedDynamic?.lines;
      lyrics = buildLrcFromDynamic(dynamicLines);
    }
  }

  if (!lyrics) {
    const fields = [
      source.synced_lyrics,
      source.syncedLyrics,
      source.lyrics,
      source.lrc,
      source.plain_lyrics,
      source.plainLyrics,
      source.text,
      animatedLyricsXml
    ];

    for (const value of fields) {
      if (typeof value === 'string' && value.trim()) {
        lyrics = value;
        break;
      }
    }
  }

  return {
    ...source,
    // Keep physical outer blank lines. /api/record/singers indexes plain
    // lyrics by the original split("\\n") order, including those rows.
    lyrics: String(lyrics || ''),
    animated_lyrics: String(animatedLyricsXml || '').trim(),
    dynamicLines,
    offset_ms: getLrchubVideoOffsetMs(source, videoId),
    meaningData: normalizeLrchubMeaningPayload(source),
    songSummary: source.song_summary || source.songSummary || source.final_summary || null,
    lrcMap: {
      ...normalizeLrchubTranslations(translationPayload(source.lrc_map)),
      ...normalizeLrchubTranslations(translationPayload(source.lrcMap)),
      ...normalizeLrchubTranslations(translationPayload(source.translations))
    }
  };
};

export const normalizeRawLrchubLyricsForVideo = async (res, videoId = '') => {
  const normalized = normalizeLrchubLyricsResponse(res, {
    videoId,
    applyVideoOffset: true,
  });
  return applyVerifiedAnimatedOffset(res, normalized, videoId);
};

export const getLrchubSearchCandidates = (res) => {
  if (Array.isArray(res)) return res.filter(Boolean);
  if (!res || typeof res !== 'object') return [];

  const candidates = [];
  ['candidates', 'results', 'items'].forEach((key) => {
    if (Array.isArray(res[key])) {
      res[key].forEach(item => {
        if (item) candidates.push(item);
      });
    }
  });
  return candidates;
};

// 文字(語)単位の時刻を実際に持っているか。
// background.js が同じものを持っていたので、こちらに寄せた。
export const hasCharacterSyncedLines = (value) => (
  Array.isArray(value) && value.some(line => (
    Array.isArray(line?.chars) && line.chars.some(char => {
      const hasText = [char?.c, char?.char, char?.text, char?.caption, char?.value]
        .some(text => String(text ?? '').length > 0);
      const hasTime = [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
        .some(time => time !== null && time !== undefined &&
          !(typeof time === 'string' && !time.trim()) && Number.isFinite(Number(time)));
      return hasText && hasTime;
    })
  ))
);

export const getLrchubRecordId = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = (
    candidate.record_id ||
    candidate.recordId ||
    (candidate.provider_meta && candidate.provider_meta.record_id) ||
    (candidate.provider_meta && candidate.provider_meta.recordId) ||
    (candidate.providerMeta && candidate.providerMeta.record_id) ||
    (candidate.providerMeta && candidate.providerMeta.recordId) ||
    candidate.candidate_id ||
    candidate.lyrics_id ||
    candidate.lyric_id ||
    (candidate.record && candidate.record.id) ||
    (candidate.record && candidate.record.record_id) ||
    (candidate.record && candidate.record.recordId) ||
    candidate.id
  );
  return id === undefined || id === null || id === '' ? null : String(id);
};

const LRCHUB_MAX_SINGER_NUMBER = 32;

const normalizeLrchubSingerNumber = (value, fallback = 1) => {
  if (typeof value === 'boolean') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > LRCHUB_MAX_SINGER_NUMBER) {
    return fallback;
  }
  return number;
};

const normalizeLrchubSingerColor = (value) => {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : '';
};

export const normalizeLrchubSingerMetadata = (res) => {
  if (!res || typeof res !== 'object' || Array.isArray(res) || res.ok === false) return null;

  const rawAssignments = Array.isArray(res.line_singers)
    ? res.line_singers
    : (Array.isArray(res.assignments) ? res.assignments : []);
  const declaredLineCount = Number(res.line_count);
  const lineCount = Number.isInteger(declaredLineCount) && declaredLineCount >= 0
    ? declaredLineCount
    : rawAssignments.length;
  const line_singers = Array.from(
    { length: lineCount },
    (_, index) => normalizeLrchubSingerNumber(rawAssignments[index], 1),
  );

  const singers = {};
  const rawSingers = res.singers && typeof res.singers === 'object' && !Array.isArray(res.singers)
    ? res.singers
    : {};
  Object.entries(rawSingers).forEach(([rawNumber, rawProfile]) => {
    const number = normalizeLrchubSingerNumber(rawNumber, 0);
    if (!number || !rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) return;
    singers[String(number)] = {
      artist_name: String(rawProfile.artist_name || rawProfile.artist || '').trim().slice(0, 200),
      color: normalizeLrchubSingerColor(rawProfile.color),
    };
  });

  const singer_numbers = [...new Set(line_singers.length ? line_singers : [1])].sort((a, b) => a - b);
  singer_numbers.forEach((number) => {
    const key = String(number);
    if (!singers[key]) singers[key] = { artist_name: '', color: '' };
  });
  if (!singers['1']) singers['1'] = { artist_name: '', color: '' };

  return {
    ...res,
    ok: true,
    record_id: getLrchubRecordId(res),
    video_id: String(res.video_id || res.videoId || '').trim(),
    line_count: lineCount,
    line_singers,
    singers,
    singer_numbers,
    singer_count: singer_numbers.length || 1,
    lyrics_revision: String(res.lyrics_revision || '').trim(),
    effective_scope: ['song', 'video', 'default'].includes(String(res.effective_scope || '').toLowerCase())
      ? String(res.effective_scope).toLowerCase()
      : 'default',
    inherited: !!res.inherited,
    has_song_config: !!res.has_song_config,
    has_video_override: !!res.has_video_override,
    song_config: res.song_config && typeof res.song_config === 'object' ? res.song_config : null,
    video_override: res.video_override && typeof res.video_override === 'object' ? res.video_override : null,
  };
};

export const fetchLrchubSingerMetadata = (params = {}) => {
  const recordId = String(params.record_id || params.recordId || '').trim();
  if (!recordId) return Promise.resolve(null);

  const endpoint = new URL(`https://lrchub.coreone.work/api/record/singers?_=${getCacheBuster()}`);
  endpoint.searchParams.set('record_id', recordId);
  const videoId = String(params.video_id || params.videoId || '').trim();
  const videoUrl = String(params.url || params.youtube_url || params.youtubeUrl || '').trim();
  if (videoId) endpoint.searchParams.set('video_id', videoId);
  else if (videoUrl) endpoint.searchParams.set('url', videoUrl);

  return fetch(endpoint.toString(), { method: 'GET', cache: 'no-store' })
    .then(async response => {
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(`LRCHub singers failed: ${response.status} ${message}`);
      }
      return response.json();
    })
    .then(normalizeLrchubSingerMetadata)
    .catch(err => {
      console.warn('[BG] LRCHub singers error:', err);
      return null;
    });
};

export const fetchFromLrchub = (params) => {
  // 接続不能が続いている間は即座に諦める。ここで待つと表示がそのぶん遅れる。
  if (!isLrchubReachable()) return Promise.resolve(null);
  const { track, artist, youtube_url, video_id, offset_ms, translate_to, translation_source, method = 'POST' } = params;
  const normalizedTranslateTo = Array.isArray(translate_to)
    ? translate_to.map(toLrchubTranslateLang).filter(Boolean)
    : toLrchubTranslateLang(translate_to);

  if (String(method || '').toUpperCase() === 'GET') {
    const url = new URL(`https://lrchub.coreone.work/api/lyrics?_=${getCacheBuster()}`);
    if (track) url.searchParams.set('track', track);
    if (artist) url.searchParams.set('artist', artist);
    if (youtube_url) url.searchParams.set('youtube_url', youtube_url);
    if (video_id) url.searchParams.set('video_id', video_id);
    if (offset_ms !== undefined && offset_ms !== null && offset_ms !== '') url.searchParams.set('offset_ms', offset_ms);
    if (translation_source) url.searchParams.set('translation_source', translation_source);
    if (Array.isArray(normalizedTranslateTo)) {
      normalizedTranslateTo.forEach(lang => url.searchParams.append('translate_to', lang));
    } else if (normalizedTranslateTo) {
      url.searchParams.set('translate_to', normalizedTranslateTo);
    }

    return fetch(url.toString(), { method: 'GET', cache: 'no-store' })
      .then(r => { noteLrchubTransport(true); return r.json(); })
      // /api/lyrics already applies the selected video's offset server-side.
      .then(res => normalizeLrchubLyricsResponse(res, {
        videoId: video_id,
        applyVideoOffsetToTranslations: true,
      }))
      .catch(err => {
        noteLrchubTransport(false);
        console.error('[BG] LRCHub GET error:', err);
        return null;
      });
  }

  const body = {
    track,
    artist,
    youtube_url,
    video_id,
    offset_ms,
    translation_source
  };
  if (Array.isArray(normalizedTranslateTo) ? normalizedTranslateTo.length : normalizedTranslateTo) {
    body.translate_to = normalizedTranslateTo;
  }

  return fetch(`https://lrchub.coreone.work/api/lyrics?_=${getCacheBuster()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => { noteLrchubTransport(true); return r.json(); })
    // /api/lyrics already applies the selected video's offset server-side.
    .then(res => normalizeLrchubLyricsResponse(res, {
      videoId: video_id,
      applyVideoOffsetToTranslations: true,
    }))
    .catch(err => {
      noteLrchubTransport(false);
      console.error('[BG] LRCHub error:', err);
      return null;
    });
};

export const searchLrchub = (track, artist, limit = 30) => {
  if (!isLrchubReachable()) return Promise.resolve([]);
  const url = new URL(`https://lrchub.coreone.work/api/search?_=${getCacheBuster()}`);
  url.searchParams.set('track', track);
  if (artist) url.searchParams.set('artist', artist);
  if (limit) url.searchParams.set('limit', limit);

  return fetch(url.toString())
    .then(r => { noteLrchubTransport(true); return r.json(); })
    .catch(err => {
      noteLrchubTransport(false);
      console.error('[BG] LRCHub search error:', err);
      return [];
    });
};

// 検索でぶら下がった候補を1件ずつ /api/record で引き直す時の上限。
// 以前は最大 30 件を直列に引いていた。1曲あたり 30 往復で、しかも
// 選定のタイムアウトが明けたあとも最後まで走り続ける。
// 検索結果は妥当な順に並んでいるので、前の数件で当たらなければ
// そのあとも当たらない。
const LRCHUB_CANDIDATE_LOOKUP_LIMIT = 3;

// 曲名の突き合わせ用。大小・字形・空白の違いだけを無視する
const exactTitleKey = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

export const fetchFromLrchubSearch = async (params = {}) => {
  const { track, artist, artist_alt, title_full, limit = 30, translate_to, video_id } = params;
  if (!track) return null;

  let searchRes = await searchLrchub(track, artist, limit);
  let candidates = getLrchubSearchCandidates(searchRes);

  // 0 件なら、画面に出ている表記のアーティスト名で一度だけ引き直す。
  // YTM の MediaSession は曲によってアーティスト名が英字(Kyo Hanabasami)で、
  // LRCHub の登録が画面の表記(花鋏キョウ)だと検索が当たらなかった(実機)。
  // 検索の曲名は括弧を落としているので、「Starry (night Remix)」でも
  // 「Starry」で探す。別の版(原曲)を掴まないよう、引き直しで採るのは
  // 曲名が YTM の曲名そのもの(title_full)と同じレコードだけにする。
  const altArtist = String(artist_alt || '').trim();
  const fullTitleKey = exactTitleKey(title_full);
  if (!candidates.length && altArtist && fullTitleKey && altArtist !== String(artist || '').trim()) {
    const altRes = await searchLrchub(track, altArtist, limit);
    const altCandidates = getLrchubSearchCandidates(altRes)
      .filter(cand => exactTitleKey(cand?.track || cand?.title) === fullTitleKey);
    if (altCandidates.length) {
      // 外した候補が results / items の側から戻ってこないよう、候補は candidates だけに置く
      const { results, items, ...altMeta } = (altRes && typeof altRes === 'object' && !Array.isArray(altRes)) ? altRes : {};
      searchRes = { ...altMeta, candidates: altCandidates };
      candidates = altCandidates;
    }
  }

  const direct = await normalizeRawLrchubLyricsForVideo(searchRes, video_id);
  if (direct && direct.lyrics && direct.lyrics.trim()) {
    return {
      ...direct,
      candidates
    };
  }

  const lookupCount = Math.min(candidates.length, LRCHUB_CANDIDATE_LOOKUP_LIMIT);
  for (let i = 0; i < lookupCount; i++) {
    const cand = candidates[i];
    const normalized = await fetchLrchubCandidateLyrics(cand, translate_to, video_id);
    if (normalized && normalized.lyrics && normalized.lyrics.trim()) {
      const nextCandidates = candidates.map((item, idx) => (
        idx === i ? {
          ...item,
          lyrics: normalized.lyrics,
          dynamicLines: normalized.dynamicLines || null,
          lyricsComplete: true,
        } : item
      ));
      return {
        ...normalized,
        candidates: nextCandidates
      };
    }
  }

  return {
    ...(direct || (searchRes && typeof searchRes === 'object' ? searchRes : {})),
    lyrics: '',
    dynamicLines: null,
    candidates
  };
};

export const fetchLrchubCandidateLyrics = async (candidate, translate_to, video_id = '') => {
  // Search/record responses contain canonical timestamps. Apply only the
  // offset belonging to the current video before parsing them.
  const direct = await normalizeRawLrchubLyricsForVideo(candidate, video_id);
  const recordId = getLrchubRecordId(candidate);
  if (!recordId) {
    return direct && direct.lyrics && direct.lyrics.trim() ? direct : null;
  }

  // /api/search lyric fields are previews and may be truncated mid-line.
  // Prefer the complete record whenever an id is available, falling back to
  // the preview only when the detail request fails or contains no lyrics.
  const recordRes = await fetchLrchubRecord(recordId, translate_to);
  const complete = await normalizeRawLrchubLyricsForVideo(recordRes, video_id);
  if (complete && complete.lyrics && complete.lyrics.trim()) return complete;
  return direct && direct.lyrics && direct.lyrics.trim() ? direct : null;
};

export const fetchLrchubRecord = (record_id, translate_to) => {
  const url = new URL(`https://lrchub.coreone.work/api/record?_=${getCacheBuster()}`);
  url.searchParams.set('record_id', record_id);
  if (translate_to) {
    if (Array.isArray(translate_to)) {
      translate_to.map(toLrchubTranslateLang).filter(Boolean).forEach(lang => url.searchParams.append('translate_to', lang));
    } else {
      const normalized = toLrchubTranslateLang(translate_to);
      if (normalized) url.searchParams.set('translate_to', normalized);
    }
  }

  return fetch(url.toString())
    .then(r => r.json())
    .catch(err => {
      console.error('[BG] LRCHub record error:', err);
      return null;
    });
};

export const parseLrcTimeToMs = (ts) => {
  const s = String(ts || '').trim();
  const m = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const ss = parseInt(m[2], 10);
  let frac = m[3] || '0';
  if (frac.length === 1) frac = frac + '00';
  else if (frac.length === 2) frac = frac + '0';
  const ms = parseInt(frac.slice(0, 3), 10);
  if (!Number.isFinite(mm) || !Number.isFinite(ss) || !Number.isFinite(ms)) return null;
  return (mm * 60 + ss) * 1000 + ms;
};

// その行の文字が実際どれくらいの間隔で進んでいるかを見て、
// 1文字ぶんの妥当な長さを出す。行末の文字を「次の行まで」で
// 引き伸ばさないための上限に使う。
const CHAR_DURATION_FALLBACK_MS = 300;
const CHAR_DURATION_MIN_MS = 120;
const CHAR_DURATION_MAX_MS = 900;

export const estimateCharDurationMs = (chars) => {
  if (!Array.isArray(chars) || chars.length < 2) return CHAR_DURATION_FALLBACK_MS;
  const gaps = [];
  for (let i = 1; i < chars.length; i++) {
    const prev = chars[i - 1]?.t;
    const cur = chars[i]?.t;
    if (typeof prev === 'number' && typeof cur === 'number' && cur > prev) gaps.push(cur - prev);
  }
  if (!gaps.length) return CHAR_DURATION_FALLBACK_MS;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  // 中央値なので、行の中に伸ばした音が1つあっても引きずられない。
  return Math.min(CHAR_DURATION_MAX_MS, Math.max(CHAR_DURATION_MIN_MS, median));
};

export const parseDynamicLrc = (text) => {
  const out = [];
  if (!text) return out;
  const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const parsed = [];
  for (const raw of rows) {
    const line = raw.trimEnd();
    if (!line) continue;
    const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
    if (!m) continue;
    // 行頭の歌い手の印(v1: / v2: / bg:)は歌詞ではない。SimpMusic の単語同期
    // (Apple Music 由来)に付いていて、落とさないと「v1:아파트」のように
    // 画面にそのまま出ていた(実測: APT.)。語の時刻の前にある時だけ落とす。
    const rest = (m[2] || '').replace(/^(?:v\d{1,4}|bg)\s*:\s*(?=<\d)/i, '');
    parsed.push({ lineMs: parseLrcTimeToMs(m[1]), rest });
  }

  const pushDistributed = (chars, chunk, startMs, endMs) => {
    if (!chunk) return;
    const arr = Array.from(chunk);
    const n = arr.length;
    if (!n) return;
    const s = (typeof startMs === 'number') ? startMs : null;
    const e = (typeof endMs === 'number') ? endMs : null;
    if (s == null) {
      for (const ch of arr) chars.push({ t: 0, c: ch });
      return;
    }
    if (e == null || e <= s) {
      for (const ch of arr) chars.push({ t: s, c: ch });
      return;
    }
    const dur = Math.max(1, e - s);
    const step = dur / n;
    for (let i = 0; i < n; i++) chars.push({ t: s + Math.floor(step * i), c: arr[i] });
  };

  for (let li = 0; li < parsed.length; li++) {
    const { lineMs, rest } = parsed[li];
    const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number') ? parsed[li + 1].lineMs : null;
    const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;
    const chars = [];
    let prevMs = null;
    let prevEnd = 0;

    while (true) {
      const mm = tagRe.exec(rest);
      if (!mm) break;
      const tagMs = parseLrcTimeToMs(mm[1]);
      if (prevMs == null && tagMs != null && mm.index > prevEnd) {
        pushDistributed(chars, rest.slice(prevEnd, mm.index), tagMs, tagMs);
      }
      if (prevMs != null) {
        pushDistributed(chars, rest.slice(prevEnd, mm.index), prevMs, tagMs);
      }
      prevMs = tagMs;
      prevEnd = mm.index + mm[0].length;
    }

    if (prevMs != null) {
      const tail = rest.slice(prevEnd);
      let endMs = nextLineMs;
      if (typeof endMs !== 'number') endMs = prevMs + 1500;
      if (endMs <= prevMs) endMs = prevMs + 200;
      // 行末の文字を「次の行が始まるまで」で割ると、間奏に入る行で
      // 破綻する。最後の1〜2文字が数秒後の時刻を持ってしまい、歌い終わって
      // だいぶ経ってから点灯する。次の行までの空きは無音であって、
      // そのぶん歌が伸びているわけではない。
      // その行自身の文字の進み方から妥当な上限を作り、短い方を採る。
      const tailCount = Math.max(1, Array.from(tail).length);
      endMs = Math.min(endMs, prevMs + estimateCharDurationMs(chars) * tailCount);
      pushDistributed(chars, tail, prevMs, endMs);
    }

    out.push({
      startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
      text: chars.map(c => c.c).join(''),
      chars,
    });
  }

  return out;
};

export const buildLrcFromDynamic = (lines) => {
  if (!Array.isArray(lines) || !lines.length) return '';
  return lines.map((line) => {
    let ms = null;
    if (typeof line.startTimeMs === 'number') ms = line.startTimeMs;
    else if (typeof line.startTimeMs === 'string') {
      const n = Number(line.startTimeMs);
      if (!Number.isNaN(n)) ms = n;
    } else if (Array.isArray(line.chars) && line.chars.length) {
      const ts = line.chars.map(c => (typeof c.t === 'number' ? c.t : null)).filter(v => v != null);
      if (ts.length) ms = Math.min(...ts);
    }
    if (ms == null) return null;

    let textLine = '';
    if (typeof line.text === 'string' && line.text.length) textLine = line.text;
    else if (Array.isArray(line.chars)) textLine = line.chars.map(c => c.c || c.text || c.caption || '').join('');
    textLine = String(textLine ?? '');
    const timeTag = `[${formatLrcTime(ms / 1000)}]`;
    return textLine ? `${timeTag} ${textLine}` : timeTag;
  }).filter(Boolean).join('\n').trimEnd();
};
;

export const extractVideoIdFromUrl = (youtube_url) => {
  if (!youtube_url) return null;
  try {
    const u = new URL(youtube_url);
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      return id || null;
    }
    const v = u.searchParams.get('v');
    return v || null;
  } catch (e) {
    return null;
  }
};

export const withTimeout = (promise, ms, label) => {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || 'timeout')), ms);
    }),
  ]).finally(() => {
    // 解除しないと GET_LYRICS 1回につき数本のタイマーが満了まで居座る
    if (timer !== null) clearTimeout(timer);
  });
};

export const delay = (ms) => new Promise(resolve => {
  setTimeout(resolve, Math.max(0, ms || 0));
});

// ============================================================
// 追加の歌詞プロバイダー (SimpMusic / LyricsPlus)
//
// LRCHub / LrcLib だけだと、次の穴が残る:
//   - LRCHub に登録が無い曲(特に新譜・海外曲)は行同期すら出ない
//   - LrcLib は行同期止まりで、単語カラオケにならない
// この2つはどちらも無料・キー不要で、単語(音節)単位の同期を返す。
//
// ■ SimpMusic (https://api-lyrics.simpmusic.org)
//   YouTube の videoId をそのまま引ける。曲名検索と違って別バージョンを
//   掴む事故が無いので、当たった時の信頼度が最も高い。
//   richSyncLyrics は拡張LRC(<mm:ss.xx>語)なので parseDynamicLrc がそのまま使える。
//
// ■ LyricsPlus (ibratabian17/lyricsplus)
//   Apple Music / QQ Music / Musixmatch などを束ねたサーバー。
//   音節単位の JSON を返す。ホスティングが無料枠なので落ちていることが多く、
//   ミラーを同時に叩いて最初に返したものを採用する。
//
// ■ BetterLyrics について
//   同種のサービスだが、現在は API 全体が Bearer トークン必須になっており、
//   トークンは Cloudflare Turnstile を通さないと発行されない。
//   ボット判定の回避になるためここでは組み込まない。
// ============================================================

const decodeHtmlEntities = (value) => String(value ?? '')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    const code = parseInt(hex, 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  })
  .replace(/&#(\d+);/g, (_, dec) => {
    const code = parseInt(dec, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : _;
  })
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  // &amp; は最後。先に戻すと "&amp;lt;" が "<" まで解けてしまう。
  .replace(/&amp;/g, '&');

const toFiniteMs = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// ── SimpMusic ────────────────────────────────────────────────
export const SIMPMUSIC_ENDPOINT = 'https://api-lyrics.simpmusic.org/v1';

export const pickBestSimpMusicEntry = (items) => {
  if (!Array.isArray(items) || !items.length) return null;
  const rank = (item) => {
    if (!item || typeof item !== 'object') return -1;
    let score = 0;
    if (typeof item.richSyncLyrics === 'string' && item.richSyncLyrics.trim()) score += 100;
    else if (typeof item.syncedLyrics === 'string' && item.syncedLyrics.trim()) score += 50;
    else if (typeof item.plainLyric === 'string' && item.plainLyric.trim()) score += 10;
    else return -1;
    // 投票は僅差の決選投票としてだけ使う。同期の質を逆転させない。
    const vote = Number(item.vote);
    if (Number.isFinite(vote)) score += Math.max(-9, Math.min(9, vote));
    return score;
  };
  let best = null;
  let bestScore = -1;
  for (const item of items) {
    const score = rank(item);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore >= 0 ? best : null;
};

export const convertSimpMusicEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;

  const rich = decodeHtmlEntities(entry.richSyncLyrics || '').trim();
  if (rich) {
    const dynamicLines = parseDynamicLrc(rich);
    if (dynamicLines.length) {
      const lrc = buildLrcFromDynamic(dynamicLines);
      if (lrc.trim()) {
        return { lyrics: lrc, dynamicLines, animated_lyrics: null, candidates: [], offset_ms: 0 };
      }
    }
  }

  const synced = decodeHtmlEntities(entry.syncedLyrics || '').trim();
  if (synced) {
    return { lyrics: synced, dynamicLines: null, animated_lyrics: null, candidates: [], offset_ms: 0 };
  }

  const plain = decodeHtmlEntities(entry.plainLyric || '').trim();
  if (plain) {
    return { lyrics: plain, dynamicLines: null, animated_lyrics: null, candidates: [], offset_ms: 0 };
  }

  return null;
};

export const fetchFromSimpMusic = async (params = {}) => {
  const videoId = String(params.video_id || '').trim();
  // videoId でしか引けない。曲名しか無い場面では黙って諦める。
  if (!videoId) return null;

  const res = await fetch(`${SIMPMUSIC_ENDPOINT}/${encodeURIComponent(videoId)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  // 404 は「この動画の歌詞は登録が無い」。異常ではないので警告も出さない。
  if (!res.ok) return null;

  const json = await res.json();
  const items = Array.isArray(json?.data) ? json.data : [];
  const best = pickBestSimpMusicEntry(items);
  const converted = convertSimpMusicEntry(best);
  if (converted) YTMLog.log('[BG] SimpMusic hit:', videoId, best?.songTitle || '');
  return converted;
};

// ── LyricsPlus ───────────────────────────────────────────────
// 無料ホスティングの上限に当たって 429 / 402 を返すミラーが常時いる。
// 一斉に投げて最初に歌詞を返したものを採る。
export const LYRICSPLUS_MIRRORS = [
  'https://lyricsplus.prjktla.my.id',
  'https://lyricsplus.prjktla.workers.dev',
  'https://lyricsplus-seven.vercel.app',
];

const LYRICSPLUS_COOLDOWN_MS = 5 * 60 * 1000;
const lyricsPlusSkipUntil = new Map();

// ── ハモリ(バックボーカル) ──────────────────────────────
// Apple Music 由来の歌詞は、本編と重なって歌われるハモリに印を付けてくる
// (LyricsPlus の isBackground、TTML の ttm:role="x-bg"、.lys の [6]〜[8])。
// 本編に混ぜると「(Yes)I know I Mountain Dew…」のように 1 行に並び、
// 語の時刻も行き来する。本編の行に bg として別に持たせ、画面では行の下に
// 小さく出す(lyrics-ui.js)。
//   bg = { startTimeMs, endTimeMs, text, chars: [{ t, c }] }
// 印が付いている時点でハモリなので、表記の括弧 "(Yes)" は外す
// (Apple Music の表示も括弧を付けない。小さく薄い字で区別が付く)。
export const makeBackgroundVocal = (chars, endTimeMs) => {
  const kept = (Array.isArray(chars) ? chars : [])
    .filter(ch => ch && Number.isFinite(ch.t) && String(ch.c ?? '').length)
    .map(ch => ({ t: ch.t, c: String(ch.c) }));
  if (!kept.length) return null;
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (/^\s*[(（]/.test(first.c) && /[)）]\s*$/.test(last.c)) {
    first.c = first.c.replace(/^\s*[(（]/, '');
    last.c = last.c.replace(/[)）]\s*$/, '');
  }
  const cleaned = kept.filter(ch => ch.c.length);
  const text = cleaned.map(ch => ch.c).join('').trim();
  if (!text) return null;
  const startTimeMs = Math.min(...cleaned.map(ch => ch.t));
  const end = Number(endTimeMs);
  return {
    startTimeMs,
    endTimeMs: Number.isFinite(end) && end > startTimeMs ? end : undefined,
    text,
    chars: cleaned,
  };
};

// 行にハモリを足す。行の始まりはハモリの方が早ければそちらに合わせる
// (行が光り始めるのが遅れ、先に歌われたハモリを塗りそびれる)。
// 行の終わり(endTimeMs)は本編のものを残す。本編の最後の語の塗りに使うため。
// 行が光っている区間はハモリの終わりまで伸ばす(lyrics-ui.js が bg を見る)。
export const attachBackgroundVocal = (line, bg) => {
  if (!line || !bg) return line;
  if (line.bg) {
    // 1 行に複数のハモリ(本編の前後など)は時刻順に 1 本へつなぐ
    const merged = makeBackgroundVocal(
      [...line.bg.chars, ...bg.chars].sort((a, b) => a.t - b.t),
      Math.max(Number(line.bg.endTimeMs) || 0, Number(bg.endTimeMs) || 0) || undefined,
    );
    line.bg = merged || line.bg;
  } else {
    line.bg = bg;
  }
  if (typeof line.startTimeMs === 'number' && line.bg.startTimeMs < line.startTimeMs) {
    line.startTimeMs = line.bg.startTimeMs;
  }
  return line;
};

export const convertLyricsPlusResponse = (json) => {
  const rows = Array.isArray(json?.lyrics) ? json.lyrics : [];
  if (!rows.length) return null;

  const dynamicLines = [];
  let hasSyllables = false;

  for (const row of rows) {
    const chars = [];
    const bgChars = [];
    let bgEnd = null;
    const syllabus = Array.isArray(row?.syllabus) ? row.syllabus : [];
    for (const syllable of syllabus) {
      const t = toFiniteMs(syllable?.time);
      const c = String(syllable?.text ?? '');
      if (t === null || !c) continue;
      if (syllable?.isBackground) {
        bgChars.push({ t, c });
        const dur = toFiniteMs(syllable?.duration);
        if (dur !== null && dur > 0) bgEnd = Math.max(bgEnd ?? 0, t + dur);
        continue;
      }
      chars.push({ t, c });
    }
    // ハモリだけの行は、そのまま本編として出す(下に付ける本編が無い)
    if (!chars.length && bgChars.length) chars.push(...bgChars.splice(0));
    if (chars.length) hasSyllables = true;

    const startTimeMs = toFiniteMs(row?.time) ?? (chars.length ? chars[0].t : null);
    if (startTimeMs === null) continue;

    // row.text はハモリまで含んだ文字列なので、ハモリがある時は本編の語から組む
    const text = (bgChars.length ? '' : String(row?.text ?? '')) || chars.map(ch => ch.c).join('');
    const line = { startTimeMs, text, chars };
    attachBackgroundVocal(line, makeBackgroundVocal(bgChars, bgEnd));
    dynamicLines.push(line);
  }

  if (!dynamicLines.length) return null;

  const lyrics = buildLrcFromDynamic(dynamicLines);
  if (!lyrics.trim()) return null;

  return {
    lyrics,
    // 音節が1つも無ければ行同期でしかない。chars 空の配列を渡すと
    // UI 側の「文字同期あり」判定を通らないまま無駄に持ち回ることになる。
    dynamicLines: hasSyllables ? dynamicLines : null,
    animated_lyrics: null,
    candidates: [],
    offset_ms: 0,
  };
};

const fetchLyricsPlusFromMirror = async (base, query) => {
  if (Date.now() < (lyricsPlusSkipUntil.get(base) || 0)) return null;
  try {
    const res = await fetch(`${base}/v2/lyrics/get?${query}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (res.status === 404) return null;          // 単に持っていない
    if (!res.ok) {
      // 402(Vercel の停止) / 429(Workers の上限) は当面ずっと同じ。
      // 曲が変わるたびに叩き直しても待たされるだけなので少し休ませる。
      lyricsPlusSkipUntil.set(base, Date.now() + LYRICSPLUS_COOLDOWN_MS);
      return null;
    }
    const json = await res.json();
    if (json?.error) return null;
    const converted = convertLyricsPlusResponse(json);
    if (converted) {
      // どこの歌詞か(聞き直すかどうかの判断に使う。返す前に外す)
      converted._lyricsPlusMeta = {
        source: String(json?.metadata?.source || ''),
        type: String(json?.type || ''),
        endMs: lyricsPlusEndMs(json),
      };
    }
    return converted;
  } catch (e) {
    lyricsPlusSkipUntil.set(base, Date.now() + LYRICSPLUS_COOLDOWN_MS);
    return null;
  }
};

// 歌詞がどこで終わるか(ミリ秒)。行の「開始+長さ」のいちばん遅いもの。
const lyricsPlusEndMs = (json) => {
  let end = null;
  for (const row of (Array.isArray(json?.lyrics) ? json.lyrics : [])) {
    const t = toFiniteMs(row?.time);
    if (t === null) continue;
    const d = toFiniteMs(row?.duration);
    const e = t + (d !== null && d > 0 ? d : 0);
    if (end === null || e > end) end = e;
  }
  return end;
};

// Apple Music の単語同期か。ハモリの印(isBackground)が付いてくるのはこれだけ。
const isAppleSyllableLyrics = (result) => {
  const meta = result?._lyricsPlusMeta;
  return !!meta && meta.source.toLowerCase() === 'apple' && meta.type.toLowerCase() !== 'line'
    && hasDynamicChars(result.dynamicLines);
};
const hasDynamicChars = (lines) => Array.isArray(lines) && lines.some(line => Array.isArray(line?.chars) && line.chars.length > 1);

// 長さ無しで聞き直した歌詞を、いま流れている曲に使ってよいか。
// 長さを外すと別バージョン(MV・ライブ・リミックス)を掴む余地があるので、
// 歌詞の終わりが曲の終わりのすぐ手前(後奏 20 秒以内)にあることを求める
// (BuaaaBot の曲名検索と同じ考え方。あちらは 15 秒)。
// 実測: Espresso の MV(201 秒)に音源の歌詞(終わり 約 170 秒)は通らない。
const LYRICSPLUS_RETRY_OUTRO_SEC = 20;
export const lyricsPlusFitsTrack = (endMs, durationSec) => {
  const end = Number(endMs) / 1000;
  const duration = Number(durationSec);
  if (!Number.isFinite(end) || !Number.isFinite(duration) || duration <= 0) return false;
  return end <= duration + 1 && duration - end <= LYRICSPLUS_RETRY_OUTRO_SEC;
};

// 全ミラーを同時に投げ、最初に歌詞を返したものを採用する。
const fetchLyricsPlusFromMirrors = (query) => new Promise(resolve => {
  let pending = LYRICSPLUS_MIRRORS.length;
  let settled = false;
  if (!pending) { resolve(null); return; }
  for (const base of LYRICSPLUS_MIRRORS) {
    fetchLyricsPlusFromMirror(base, query)
      .then(value => {
        pending -= 1;
        if (value && !settled) {
          settled = true;
          YTMLog.log('[BG] LyricsPlus hit:', base);
          resolve(value);
        } else if (pending === 0 && !settled) {
          settled = true;
          resolve(null);
        }
      })
      .catch(() => {
        pending -= 1;
        if (pending === 0 && !settled) {
          settled = true;
          resolve(null);
        }
      });
  }
});

const stripLyricsPlusMeta = (result) => {
  if (result) delete result._lyricsPlusMeta;
  return result;
};

// LyricsPlus のサーバーは「曲名・歌手・長さ」の組ごとに、最初に取れた結果を
// 覚えて返し続ける。その組で Apple Music の取得がたまたま遅れて QQ Music や
// Musixmatch が覚えられると、その長さで聞く限りずっとそちらが返る。
// 実測(2026-10-08, OMG / NewJeans): 長さ 206・207・209・213〜216 は Apple、
// 205・208・210〜212 は QQ Music(何度聞いても同じ)。長さ無しは Apple。
// Apple の単語同期でなければ、長さ無しでも聞き直し、曲に合えばそちらを採る。
// Apple の歌詞は語の時刻が細かく、ハモリの印も付いている。
export const fetchFromLyricsPlus = async (params = {}) => {
  const title = String(params.track || '').trim();
  const artist = String(params.artist || '').trim();
  if (!title || !artist) return null;

  const search = new URLSearchParams({ title, artist });
  const album = String(params.album || '').trim();
  if (album) search.set('album', album);
  const duration = Number(params.duration);
  const hasDuration = Number.isFinite(duration) && duration > 0;
  if (hasDuration) search.set('duration', String(Math.round(duration)));

  const first = await fetchLyricsPlusFromMirrors(search.toString());
  if (!hasDuration || isAppleSyllableLyrics(first)) return stripLyricsPlusMeta(first);

  search.delete('duration');
  const retry = await fetchLyricsPlusFromMirrors(search.toString());
  if (isAppleSyllableLyrics(retry) && lyricsPlusFitsTrack(retry._lyricsPlusMeta.endMs, duration)) {
    YTMLog.log('[BG] LyricsPlus: 長さ無しで Apple の歌詞を採る');
    return stripLyricsPlusMeta(retry);
  }
  return stripLyricsPlusMeta(first);
};
