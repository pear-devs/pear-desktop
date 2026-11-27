// プレイヤーバー。YTM は 2026-09 から一部の人に、ytmusic-player-bar の
// 代わりに作り直したバー(ytmusic-miniplayer、試験スイッチ
// music_web_enable_wiz_miniplayer)を出している。バーそのものは
// PlayerBar.get()(player-bar.js)で探す。知らない作りでも形で見つける。
// 以下は、知っている作りの中から曲名などを読むためのもの(読めなければ
// MediaSession で足りる)。
const PLAYER_BAR_TITLE_SELECTOR = 'yt-formatted-string.title.style-scope.ytmusic-player-bar, ytmusic-miniplayer .ytmusicTrackInfoTitle';
const PLAYER_BAR_BYLINE_SELECTOR = '.byline.style-scope.ytmusic-player-bar, ytmusic-miniplayer .ytmusicTrackInfoByline';
// 再生中ずっと動く所(シークバー・時刻・右側の列)。ここの変化では tick を起こさない。
// 最後の行は知らない作りのバー向け(どの作りでもシークバーはスライダー)。
const PLAYER_BAR_NOISE_SELECTOR = 'tp-yt-paper-slider, tp-yt-paper-progress, #left-controls, #right-controls, .time-info, '
  + '.ytMusicMiniPlayerProgressBarWrapper, .ytMusicMiniPlayerTimeInfo, .ytMusicMiniPlayerRightSection, '
  + '[role="slider"], input[type="range"], progress';

const resolveDeepLTargetLang = (lang) => {
  switch ((lang || '').toLowerCase()) {
    case 'en': case 'en-us': case 'en-gb': return 'EN';
    case 'ja': return 'JA';
    case 'ko': return 'KO';
    case 'fr': return 'FR';
    case 'de': return 'DE';
    case 'es': return 'ES';
    case 'zh': case 'zh-cn': case 'zh-tw': return 'ZH';
    default: return 'JA';
  }
};

const parseLRCInternal = (lrc) => {
  if (!lrc) return { lines: [], hasTs: false };
  const tagTest = /\[\s*\d{1,3}\s*:\s*\d{2}\s*(?:[.:]\s*\d{1,4}\s*)?\]/;
  // Enhanced LRC の語タグ。ここに来る時点で「行同期として読む」と決まって
  // いるので(語同期は isDynamicLrcFormat 側で先に分岐する)、表示する文字列
  // からは落とす。残すと画面に <00:12.34> がそのまま並ぶ。
  const LRC_WORD_TAG = /<\s*\d{1,3}\s*:\s*\d{2}\s*(?:[.:]\s*\d{1,3}\s*)?>/g;

  // タイムスタンプがない場合
  if (!tagTest.test(lrc)) {
    // 空行も保持して、翻訳時に行が詰まらないようにする
    const lines = lrc.split(/\r?\n/).map((line, sourceIndex) => {
      const text = (line ?? '').replace(LRC_WORD_TAG, '').replace(/^\s+|\s+$/g, '');
      return { time: null, text, source_index: sourceIndex };
    });
    return { lines, hasTs: false };
  }

  const lines = lrc.split(/\r?\n/);
  const result = [];
  const tagExp = /\[\s*(\d{1,3})\s*:\s*(\d{2})\s*(?:[.:]\s*(\d{1,4})\s*)?\]/g;

  let sourceIndex = 0;
  lines.forEach(lineStr => {
    const line = (lineStr ?? '').trim();
    if (!line) return;

    // Extract all tags on this line
    const tags = [];
    let match;
    tagExp.lastIndex = 0;
    while ((match = tagExp.exec(line)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracStr = match[3] || '0';
      const frac = parseFloat('0.' + fracStr);
      const time = min * 60 + sec + frac;
      tags.push(time);
    }

    if (tags.length > 0) {
      const currentSourceIndex = sourceIndex++;
      // Strip all tags to get the line text
      const text = line
        .replace(/\[\s*\d{1,3}\s*:\s*\d{2}\s*(?:[.:]\s*\d{1,4}\s*)?\]/g, '')
        .replace(LRC_WORD_TAG, '')
        .trim();
      tags.forEach(time => {
        result.push({ time, text, source_index: currentSourceIndex });
      });
    }
  });

  result.sort((a, b) => (a.time || 0) - (b.time || 0));
  return { lines: result, hasTs: true };
};


const parseBaseLRC = (lrc) => {
  const { lines, hasTs } = parseLRCInternal(lrc);
  hasTimestamp = hasTs;
  return lines;
};

// ── 先頭に紛れ込む見出し行 ──────────────────────────────────
// 取得元によっては、1行目に曲そのものではない行が入っている。
//
//   - QQ音楽由来の同期データ: 「制作人：〜」「作詞：〜」のクレジット行
//   - SimpMusic の richsync : 「曲名 - アーティスト (…)」の見出し行
//
// どちらも本物の歌詞と同じタイムスタンプ付きなので、そのまま出すと
// イントロの間ずっと曲名がハイライトされ続ける。上流のデータは直せない
// ので、表示する行からだけ落とす。
//
// 落とすのは必ず「先頭から連続する分だけ」。1行でも該当しない行が来たら
// そこで打ち切るので、曲中の歌詞を巻き込むことはない。
// 元データ側は触らない。歌手の色分けは行番号で歌詞に対応づけられていて、
// データから消すと1行ずれるため。
const LYRIC_CREDIT_LABELS = [
  '制作人', '製作人', '制作', '製作', '出品', '监制', '監製',
  '作詞', '作词', '作曲', '编曲', '編曲', '词曲', '詞曲',
  // 1文字のラベル。KuGou のデータは「词：〜」「曲：〜」で来るので、
  // 「作词」だけを持っていても当たらない(包含判定は逆向きには効かない)。
  '词', '詞', '曲', '编', '編',
  // 歌い手・収録元のクレジット。実データで「原唱：〜」が来ていた。
  '原唱', '翻唱', '演唱', '主唱', '歌手', '专辑', '專輯',
  '混音', '録音', '录音', '母带', '母帶', '和声', '和聲',
  'produced by', 'producer', 'lyrics', 'lyricist', 'lyric',
  'music', 'composer', 'composed by', 'arranged by', 'arranger',
  'vocal', 'chorus', 'mixing', 'mastering', 'op', 'sp',
];

// 全角・大文字・語中の空白を潰してから突き合わせる。
// 「Produced by」と「producedby」を別物として扱わないため、
// 既知ラベル側も同じ形に均しておく。
const normalizeCreditLabel = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');

const LYRIC_CREDIT_LABEL_KEYS = LYRIC_CREDIT_LABELS.map(normalizeCreditLabel);

const isLyricCreditLine = (text) => {
  const raw = String(text ?? '').trim();
  if (!raw) return false;
  // 「ラベル：値」の形だけを見る。コロンが無ければクレジット行ではない。
  const m = raw.match(/^([^:：]{1,24})[:：]/);
  if (!m) return false;
  const label = normalizeCreditLabel(m[1]);
  if (!label) return false;
  // 「作詞作曲」のような連結にも当たるよう包含で見る
  return LYRIC_CREDIT_LABEL_KEYS.some(known => label.includes(known));
};

const normalizeLyricHeaderText = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');

// 曲名を含む見出し行。曲名がそのまま歌い出しになる曲を巻き込まないよう、
// 「曲の頭に置かれている」「次の歌詞まで大きく空いている」「その空きが
// 他の行間隔と比べて明らかに異常」の3つが揃った時だけ見出しとみなす。
const isLyricTitleHeaderLine = (line, nextLine, medianGapSec, trackTitle) => {
  const title = normalizeLyricHeaderText(trackTitle);
  const text = normalizeLyricHeaderText(line?.text);
  if (!title || !text || title.length < 2) return false;
  if (!text.includes(title)) return false;
  if (typeof line?.time !== 'number' || line.time > 5) return false;
  if (typeof nextLine?.time !== 'number') return false;
  const gap = nextLine.time - line.time;
  if (gap < 10) return false;
  if (!(medianGapSec > 0) || gap < medianGapSec * 4) return false;
  return true;
};

const MAX_STRIPPED_HEADER_LINES = 6;

const stripLeadingHeaderLines = (lines, trackTitle) => {
  if (!Array.isArray(lines) || lines.length < 3) return lines;

  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]?.time;
    const cur = lines[i]?.time;
    if (typeof prev === 'number' && typeof cur === 'number') gaps.push(cur - prev);
  }
  gaps.sort((a, b) => a - b);
  const medianGapSec = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  let start = 0;
  while (start < lines.length - 1 && start < MAX_STRIPPED_HEADER_LINES) {
    const line = lines[start];
    if (isLyricCreditLine(line?.text)) { start += 1; continue; }
    if (isLyricTitleHeaderLine(line, lines[start + 1], medianGapSec, trackTitle)) {
      start += 1;
      continue;
    }
    break;
  }

  if (!start) return lines;
  return lines.slice(start);
};

const MAX_SINGER_NUMBER = 32;

const normalizeSingerNumber = (value) => {
  if (typeof value === 'boolean') return 1;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= MAX_SINGER_NUMBER ? number : 1;
};

const normalizeSingerColor = (value) => {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : '';
};

const normalizeSingerLineText = (line) => String(line?.text ?? line ?? '')
  .normalize('NFKC')
  .replace(/\s+/g, ' ')
  .trim();

const singerMetadataSource = (metadata) => (
  metadata?.effective && typeof metadata.effective === 'object'
    ? { ...metadata, ...metadata.effective }
    : metadata
);

const hasSingerDisplayMetadata = (metadata, canonicalLines = null) => {
  const source = singerMetadataSource(metadata);
  if (!source || typeof source !== 'object') return false;
  if (
    Array.isArray(canonicalLines) &&
    !singerMetadataMatchesCanonicalLines(source, canonicalLines)
  ) return false;
  const assignments = Array.isArray(source.line_singers) ? source.line_singers : [];
  if (assignments.some(number => normalizeSingerNumber(number) !== 1)) return true;
  const singers = source.singers && typeof source.singers === 'object' && !Array.isArray(source.singers)
    ? source.singers
    : {};
  return Object.values(singers).some(profile => (
    profile && typeof profile === 'object' && (
      String(profile.artist_name || profile.artist || '').trim() ||
      normalizeSingerColor(profile.color)
    )
  ));
};

const countCanonicalSingerLines = (canonicalLines) => {
  if (!Array.isArray(canonicalLines)) return null;
  const indexes = new Set();
  canonicalLines.forEach((line, index) => {
    const rawSourceIndex = Number(line?.source_index);
    indexes.add(Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : index);
  });
  return indexes.size;
};

const singerMetadataMatchesCanonicalLines = (metadata, canonicalLines) => {
  const source = singerMetadataSource(metadata);
  const declaredLineCount = Number(source?.line_count);
  if (!Number.isInteger(declaredLineCount) || declaredLineCount < 0) return true;
  return countCanonicalSingerLines(canonicalLines) === declaredLineCount;
};

const clearSingerFields = (line) => {
  if (!line || typeof line !== 'object') return line;
  const next = { ...line };
  delete next.singerNumber;
  delete next.singerArtistName;
  delete next.singerColor;
  delete next.showSingerName;
  return next;
};

const applySingerMetadataToLines = (lines, metadata, options = {}) => {
  if (!Array.isArray(lines)) return [];
  const source = singerMetadataSource(metadata);
  if (!source || typeof source !== 'object') return lines.map(clearSingerFields);

  const assignments = Array.isArray(source.line_singers)
    ? source.line_singers.map(normalizeSingerNumber)
    : [];
  const singers = source.singers && typeof source.singers === 'object' && !Array.isArray(source.singers)
    ? source.singers
    : {};
  const hasCanonicalLineContract = Array.isArray(options.canonicalLines);
  const canonicalLines = hasCanonicalLineContract ? options.canonicalLines : [];
  const sameSource = options.sameSource !== false;
  if (
    hasCanonicalLineContract &&
    !singerMetadataMatchesCanonicalLines(source, canonicalLines)
  ) return lines.map(clearSingerFields);
  const resolvedAssignments = new Array(lines.length).fill(null);

  if (sameSource || !canonicalLines.length) {
    lines.forEach((line, index) => {
      if (line?.duetSide === 'right') return;
      const rawSourceIndex = Number(line?.source_index);
      const sourceIndex = Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : index;
      resolvedAssignments[index] = normalizeSingerNumber(assignments[sourceIndex]);
    });
  } else {
    const queues = new Map();
    const seenSourceIndexes = new Set();
    canonicalLines.forEach((line, index) => {
      const rawSourceIndex = Number(line?.source_index);
      const sourceIndex = Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : index;
      if (seenSourceIndexes.has(sourceIndex)) return;
      seenSourceIndexes.add(sourceIndex);
      const key = normalizeSingerLineText(line);
      if (!queues.has(key)) queues.set(key, []);
      queues.get(key).push({ sourceIndex, number: normalizeSingerNumber(assignments[sourceIndex]) });
    });

    const usedCanonicalIndexes = new Set();
    lines.forEach((line, displayIndex) => {
      if (line?.duetSide === 'right') return;
      const queue = queues.get(normalizeSingerLineText(line));
      while (queue?.length && usedCanonicalIndexes.has(queue[0].sourceIndex)) queue.shift();
      if (!queue?.length) return;
      const match = queue.shift();
      usedCanonicalIndexes.add(match.sourceIndex);
      resolvedAssignments[displayIndex] = match.number;
    });

    lines.forEach((line, displayIndex) => {
      if (line?.duetSide === 'right' || resolvedAssignments[displayIndex] !== null) return;
      const rawSourceIndex = Number(line?.source_index);
      const sourceIndex = Number.isInteger(rawSourceIndex) && rawSourceIndex >= 0 ? rawSourceIndex : displayIndex;
      resolvedAssignments[displayIndex] = normalizeSingerNumber(assignments[sourceIndex]);
    });
  }

  let previousDisplaySingerNumber = null;
  return lines.map((line, index) => {
    const next = clearSingerFields(line);
    const number = resolvedAssignments[index];
    if (!next || number === null) return next;
    const profile = singers[String(number)] && typeof singers[String(number)] === 'object'
      ? singers[String(number)]
      : {};
    const artistName = String(profile.artist_name || profile.artist || '').trim().slice(0, 200);
    const hasDisplayText = !!normalizeSingerLineText(next);
    const showSingerName = hasDisplayText && !!artistName && previousDisplaySingerNumber !== number;
    if (hasDisplayText) previousDisplaySingerNumber = number;
    return {
      ...next,
      singerNumber: number,
      singerArtistName: artistName,
      singerColor: normalizeSingerColor(profile.color),
      showSingerName,
    };
  });
};

const applySingerMetadataToRow = (row, line, metadata) => {
  if (!row || !line || line.singerNumber === null || line.singerNumber === undefined) return;
  const number = normalizeSingerNumber(line.singerNumber);
  const isEven = number % 2 === 0;
  row.dataset.singerNumber = String(number);
  row.classList.toggle('singer-odd', !isEven);
  row.classList.toggle('singer-even', isEven);

  const artistName = String(line.singerArtistName || '').trim();
  row.dataset.singerLabel = artistName || `Singer ${number}`;
  const color = normalizeSingerColor(line.singerColor);
  if (color) {
    row.dataset.singerColor = color;
    row.style.setProperty('--ytm-singer-color', color);
  } else {
    delete row.dataset.singerColor;
    row.style.removeProperty('--ytm-singer-color');
  }

  if (artistName && line.showSingerName) {
    const label = (row.ownerDocument || document).createElement('span');
    label.className = 'lyric-singer-name';
    label.textContent = artistName;
    row.appendChild(label);
  }
};

// ===== duet helpers =====
const DUET_TIME_TOLERANCE = 0.15;
const DUET_DUPLICATE_TOLERANCE = 1.0;
const SAME_TIMESTAMP_TOLERANCE = 0.05;
const DYNAMIC_ACTIVE_TAIL_SEC = 0.2;
const DYNAMIC_OVERLAP_TOLERANCE = 0.05;

const normalizeLyricCompareText = (text) => String(text || '')
  .replace(/\u00A0/g, ' ')
  .replace(/\s+/g, '')
  .replace(/[.,，。!！?？:：;；'"\-‐‑‒–—―~〜()（）\[\]{}<>「」『』【】]/g, '')
  .toLowerCase()
  .trim();

const normalizeLyricCompareTextStrict = (text) => String(text || '')
  .normalize('NFKC')
  .replace(/<[^>]*>/g, '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/\u00A0/g, ' ')
  .replace(/\s+/g, '')
  .replace(/[\p{P}\p{S}\p{C}]/gu, '')
  .toLowerCase()
  .trim();

const extractDynamicLineText = (line) => {
  if (typeof line?.text === 'string' && line.text.length) return line.text;
  if (Array.isArray(line?.chars)) {
    return line.chars.map(c => c?.c || c?.text || c?.caption || '').join('');
  }
  return '';
};

const toFiniteDynamicTime = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getDynamicLineStartSec = (line) => {
  for (const value of [line?.startTimeMs, line?.start_ms, line?.startMs]) {
    const milliseconds = toFiniteDynamicTime(value);
    if (milliseconds !== null) return milliseconds / 1000;
  }
  const seconds = toFiniteDynamicTime(line?.time);
  if (seconds !== null) return seconds;
  if (Array.isArray(line?.chars) && line.chars.length) {
    const ts = line.chars
      .map(char => [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
        .map(toFiniteDynamicTime)
        .find(value => value !== null) ?? null)
      .filter(v => v != null);
    if (ts.length) return Math.min(...ts) / 1000;
  }
  return null;
};

const getDynamicLineEndSec = (line) => {
  if (!line) return null;
  if (typeof line.__ytmEndSec === 'number' && Number.isFinite(line.__ytmEndSec)) {
    return line.__ytmEndSec;
  }

  const startSec = getDynamicLineStartSec(line);
  let endSec = null;

  for (const value of [line?.endTimeMs, line?.end_ms, line?.endMs, line?.endTime]) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) continue;
    const milliseconds = Number(value);
    if (Number.isFinite(milliseconds)) {
      endSec = milliseconds / 1000;
      break;
    }
  }

  if (Array.isArray(line?.chars) && line.chars.length) {
    const lastCharMs = line.chars
      .map(char => [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
        .map(toFiniteDynamicTime)
        .find(value => value !== null) ?? null)
      .filter(v => v != null)
      .reduce((max, v) => Math.max(max, v), Number.NEGATIVE_INFINITY);

    if (Number.isFinite(lastCharMs)) {
      const charTailSec = (lastCharMs / 1000) + DYNAMIC_ACTIVE_TAIL_SEC;
      endSec = (typeof endSec === 'number') ? Math.max(endSec, charTailSec) : charTailSec;
    }
  }

  if (!(typeof endSec === 'number') && typeof startSec === 'number') {
    endSec = startSec + 1.5;
  }

  if (typeof startSec === 'number' && typeof endSec === 'number' && endSec <= startSec) {
    endSec = startSec + DYNAMIC_ACTIVE_TAIL_SEC;
  }

  if (typeof endSec === 'number' && Number.isFinite(endSec)) {
    line.__ytmEndSec = endSec;
    return endSec;
  }
  return null;
};

const isLineDynamicallyActiveAtTime = (line, timeSec, tolerance = DYNAMIC_OVERLAP_TOLERANCE) => {
  const startSec = (typeof line?._dynamicRenderStartSec === 'number' && Number.isFinite(line._dynamicRenderStartSec))
    ? line._dynamicRenderStartSec
    : null;
  const endSec = (typeof line?._dynamicRenderEndSec === 'number' && Number.isFinite(line._dynamicRenderEndSec))
    ? line._dynamicRenderEndSec
    : null;

  return typeof startSec === 'number' &&
    typeof endSec === 'number' &&
    (timeSec + tolerance) >= startSec &&
    timeSec <= (endSec + tolerance);
};

// 画面で「いまの行」を、次の行が始まるまで明るいまま残す。
//
// 終わり時刻を持つのは文字同期の行だけで、そこで active を外すと
// 色が #fff → rgba(255,255,255,0.3)、大きさが 1.05 → 0.95 に落ち、
// さらに .ytm-word-sync:not(.active) で塗りのグラデーションごと消える。
// 行間が空く曲では、その状態が数秒続く。実測: Dear (Mrs. GREEN APPLE) は
// 歌 166秒 に対して行間の空きが 101秒あり、点いて消えて点いて消えて、
// に見えていた。行同期の歌詞は終わり時刻を持たないのでこうならず、
// 「同期が細かい曲ほど見え方が悪くなる」という逆転になっていた。
//
// 他に本当に歌っている行があるならそちらに譲る(デュエット・重なり)。
//
// 譲るのは「自分が終わったあとに、他の行が歌っていた」なら、その行が
// 終わった後もずっと。以前は「いま歌っている行があるか」だけを見ていたので、
// 重なった行が先に終わると消え、残りの行が終わった所で点き直していた。
// 歌い終わった行がもう一度光る(3行が重なる所で実機の指摘)。
const isPrimaryRowLitAtTime = (lines, primaryIndex, timeSec) => {
  const primary = Array.isArray(lines) ? lines[primaryIndex] : null;
  if (!primary) return false;
  const hasRange = Number.isFinite(primary._dynamicRenderStartSec) &&
    Number.isFinite(primary._dynamicRenderEndSec);
  if (!hasRange) return true;
  if (isLineDynamicallyActiveAtTime(primary, timeSec)) return true;
  if (timeSec < primary._dynamicRenderStartSec) return false;
  const endSec = primary._dynamicRenderEndSec;
  return !lines.some((line, i) => (
    i !== primaryIndex &&
    Number.isFinite(line?._dynamicRenderStartSec) &&
    Number.isFinite(line?._dynamicRenderEndSec) &&
    line._dynamicRenderStartSec <= timeSec + DYNAMIC_OVERLAP_TOLERANCE &&
    line._dynamicRenderEndSec > endSec + DYNAMIC_OVERLAP_TOLERANCE
  ));
};

const isSameTimestamp = (a, b, tolerance = SAME_TIMESTAMP_TOLERANCE) =>
  typeof a === 'number' &&
  typeof b === 'number' &&
  Math.abs(a - b) <= tolerance;

const scoreLyricTextMatch = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 60;
  return 0;
};

const findCrossSideDuplicateIndex = (lines, line) => {
  if (!Array.isArray(lines) || !lines.length || !line) return -1;

  const lineText = normalizeLyricCompareTextStrict(line?.text);
  if (!lineText) return -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const existing = lines[i];
    if (!isSameTimestamp(existing?.time, line?.time, DUET_DUPLICATE_TOLERANCE)) {
      if (typeof existing?.time === 'number' && typeof line?.time === 'number' && existing.time < line.time - DUET_DUPLICATE_TOLERANCE) {
        break;
      }
      continue;
    }

    const isCrossSideDuplicate = existing?.duetSide && line?.duetSide && existing.duetSide !== line.duetSide;
    if (!isCrossSideDuplicate) continue;

    const existingText = normalizeLyricCompareTextStrict(existing?.text);
    if (existingText && scoreLyricTextMatch(existingText, lineText) >= 100) {
      return i;
    }
  }

  return -1;
};

const preferDuplicateMainLine = (existingLine, incomingLine) => {
  if (!existingLine) return incomingLine || null;
  if (!incomingLine) return existingLine;
  if (existingLine.duetSide === incomingLine.duetSide) return existingLine;
  if (incomingLine.duetSide === 'left') return incomingLine;
  if (existingLine.duetSide === 'left') return existingLine;
  return existingLine;
};

const findDynamicLineForRender = (line, sourceLines, usedIndexes) => {
  if (!line || typeof line.time !== 'number') return null;
  if (!Array.isArray(sourceLines) || !sourceLines.length) return null;

  const wantedText = normalizeLyricCompareTextStrict(line.text);
  const candidates = [];

  sourceLines.forEach((dynLine, idx) => {
    const startSec = getDynamicLineStartSec(dynLine);
    if (typeof startSec !== 'number') return;

    const timeDiff = Math.abs(startSec - line.time);
    if (timeDiff > DUET_TIME_TOLERANCE) return;

    const dynText = normalizeLyricCompareTextStrict(extractDynamicLineText(dynLine));
    const textScore = scoreLyricTextMatch(wantedText, dynText);

    candidates.push({
      idx,
      dynLine,
      timeDiff,
      textScore,
      used: !!(usedIndexes && usedIndexes.has(idx)),
    });
  });

  if (!candidates.length) return null;

  candidates.sort((a, b) =>
    Number(a.used) - Number(b.used) ||
    b.textScore - a.textScore ||
    a.timeDiff - b.timeDiff ||
    a.idx - b.idx
  );

  const picked = candidates[0];
  if (usedIndexes) usedIndexes.add(picked.idx);
  return picked.dynLine;
};

// コンテンツマッチでDynamic LRC行を探す（時間が大きくずれている場合の1文字同期対応用）
// timeTolerance: 秒単位の許容幅。1文字同期の場合は5.0秒推奨。
const findDynamicLineByContent = (line, sourceLines, timeTolerance = 5.0) => {
  if (!line || !Array.isArray(sourceLines) || !sourceLines.length) return null;
  const wantedText = normalizeLyricCompareTextStrict(line.text);
  if (!wantedText) return null;

  let bestMatch = null;
  let bestScore = 0;
  let bestTimeDiff = Infinity;

  sourceLines.forEach(dynLine => {
    const startSec = getDynamicLineStartSec(dynLine);
    if (typeof startSec !== 'number') return;
    if (typeof line.time === 'number' && Math.abs(startSec - line.time) > timeTolerance) return;

    const dynText = normalizeLyricCompareTextStrict(extractDynamicLineText(dynLine));
    const score = scoreLyricTextMatch(wantedText, dynText);
    if (score <= 0) return;

    const timeDiff = typeof line.time === 'number' ? Math.abs(startSec - line.time) : 0;
    // 同スコアなら時間が近い方を優先
    if (score > bestScore || (score === bestScore && timeDiff < bestTimeDiff)) {
      bestScore = score;
      bestTimeDiff = timeDiff;
      bestMatch = dynLine;
    }
  });

  // 完全一致(100)のみ採用: 部分一致(60)だと文字数・内容が違うデータが当たり誤表示の原因になる
  return bestScore >= 100 ? bestMatch : null;
};

// Dynamic.lrc形式のパーサー（sub.txt用）
const parseDynamicLrcForSub = (text) => {
  const out = [];
  if (!text) return out;

  const rows = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const parseLrcTimeToMsSub = (ts) => {
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

  // 1st pass: parse lines
  const parsed = [];
  for (const raw of rows) {
    const line = raw.trimEnd();
    if (!line) continue;

    const m = line.match(/^\[(\d+:\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/);
    if (!m) continue;

    parsed.push({
      lineMs: parseLrcTimeToMsSub(m[1]),
      rest: m[2] || '',
    });
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

    for (let i = 0; i < n; i++) {
      const t = s + Math.floor(step * i);
      chars.push({ t, c: arr[i] });
    }
  };

  for (let li = 0; li < parsed.length; li++) {
    const { lineMs, rest } = parsed[li];
    const nextLineMs = (li + 1 < parsed.length && typeof parsed[li + 1].lineMs === 'number')
      ? parsed[li + 1].lineMs
      : null;

    const tagRe = /<(\d+:\d{2}(?:\.\d{1,3})?)>/g;
    const chars = [];

    let prevMs = null;
    let prevEnd = 0;

    while (true) {
      const mm = tagRe.exec(rest);
      if (!mm) break;

      const tagMs = parseLrcTimeToMsSub(mm[1]);

      if (prevMs == null && tagMs != null && mm.index > prevEnd) {
        const chunk0 = rest.slice(prevEnd, mm.index);
        pushDistributed(chars, chunk0, tagMs, tagMs);
      }

      if (prevMs != null) {
        const chunk = rest.slice(prevEnd, mm.index);
        pushDistributed(chars, chunk, prevMs, tagMs);
      }

      prevMs = tagMs;
      prevEnd = mm.index + mm[0].length;
    }

    if (prevMs != null) {
      const chunk = rest.slice(prevEnd);
      let endMs = nextLineMs;
      if (typeof endMs !== 'number') endMs = prevMs + 1500;
      if (endMs <= prevMs) endMs = prevMs + 200;
      // 行末の文字を「次の行が始まるまで」で割ると、間奏に入る行で破綻する。
      // 最後の 1〜2 文字が数秒後の時刻を持ち、歌い終わってだいぶ経ってから点く。
      // メイン側(api.js の parseDynamicLrc)は同じ補正を持っているのに、
      // ここ(sub = デュエットの右側)だけ抜けていた。右側の行末だけ遅れて点く。
      const tailCount = Math.max(1, Array.from(chunk).length);
      endMs = Math.min(endMs, prevMs + estimateCharDurationMs(chars) * tailCount);
      pushDistributed(chars, chunk, prevMs, endMs);
    }

    const textLine = chars.map(c => c.c).join('');

    out.push({
      startTimeMs: (typeof lineMs === 'number' ? lineMs : (chars.length ? chars[0].t : 0)),
      text: textLine,
      chars,
    });
  }

  return out;
};

// Dynamic.lrc形式かどうかを判定
const isDynamicLrcFormat = (text) => {
  if (!text) return false;
  // <00:00.00>形式のタグが含まれていればDynamic.lrc形式
  return /<\d+:\d{2}(?:\.\d{1,3})?>/.test(text);
};

const parseSubLRC = (lrc) => {
  // Dynamic.lrc形式の場合は専用パーサーを使用
  if (isDynamicLrcFormat(lrc)) {
    const dynLines = parseDynamicLrcForSub(lrc);
    if (dynLines && dynLines.length) {
      // dynamicLinesからLRC形式のlinesに変換
      const lines = dynLines.map(dl => ({
        time: (typeof dl.startTimeMs === 'number') ? dl.startTimeMs / 1000 : null,
        text: dl.text || '',
      }));
      // サブ用のdynamicLinesを保存
      duetSubDynamicLines = dynLines;
      return { lines, hasTs: true, dynamicLines: dynLines };
    }
  }

  // 通常のLRC形式
  duetSubDynamicLines = null;
  const { lines, hasTs } = parseLRCInternal(lrc);
  return { lines: Array.isArray(lines) ? lines : [], hasTs: !!hasTs, dynamicLines: null };
};

const mergeDuetLinesWithSimultaneousSupport = (mainLines, subLines) => {
  const subLinesWithTime = (subLines || []).filter(l => typeof l?.time === 'number');
  const excludedMainTimes = new Set();

  // Dynamic LRC（1文字同期）がある場合は5秒の許容幅+内容一致で重複判定
  // 通常LRCはタイムスタンプが精確なので完全一致（SAME_TIMESTAMP_TOLERANCE=0.05s）のみ重複とみなす
  const hasDynamicLrc = Array.isArray(dynamicLines) && dynamicLines.length > 0;
  const dedupeTimeTolerance = hasDynamicLrc ? 5.0 : SAME_TIMESTAMP_TOLERANCE;

  const filteredMain = (mainLines || []).filter((mainLine) => {
    if (typeof mainLine?.time !== 'number') return true;

    const mainText = normalizeLyricCompareTextStrict(mainLine.text);
    if (!mainText) return true;

    // dedupeTimeTolerance以内のタイムスタンプ差かつ同一テキストのサブ行があれば重複とみなしてメイン行を除外
    const duplicateSub = subLinesWithTime.find((subLine) => {
      if (!isSameTimestamp(mainLine.time, subLine.time, dedupeTimeTolerance)) return false;
      const subText = normalizeLyricCompareTextStrict(subLine.text);
      return !!subText && scoreLyricTextMatch(mainText, subText) >= 100;
    });
    if (duplicateSub) {
      excludedMainTimes.add(Math.round(mainLine.time * 1000));
      return false;
    }
    return true;
  });

  const merged = [];
  filteredMain.forEach(l => merged.push({ ...l, duetSide: 'left' }));
  (subLines || []).forEach(l => merged.push({ ...l, duetSide: 'right' }));

  merged.sort((a, b) => {
    const at = (typeof a.time === 'number') ? a.time : Number.POSITIVE_INFINITY;
    const bt = (typeof b.time === 'number') ? b.time : Number.POSITIVE_INFINITY;

    if (isSameTimestamp(at, bt)) {
      const ap = a.duetSide === 'right' ? 1 : 0;
      const bp = b.duetSide === 'right' ? 1 : 0;
      return ap - bp;
    }
    return at - bt;
  });

  const deduped = [];
  for (const line of merged) {
    const duplicateIdx = findCrossSideDuplicateIndex(deduped, line);
    const prev = duplicateIdx >= 0 ? deduped[duplicateIdx] : null;
    // 同内容の重複だけ落とす。別歌詞の同時進行は残す。
    if (duplicateIdx >= 0) {
      deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
      continue;
    }

    deduped.push(line);
  }

  return deduped;
};

const collapseCrossSideDuplicateLyrics = (lines) => {
  if (!Array.isArray(lines) || !lines.length) return Array.isArray(lines) ? lines : [];

  const deduped = [];
  for (const line of lines) {
    const duplicateIdx = findCrossSideDuplicateIndex(deduped, line);
    const prev = duplicateIdx >= 0 ? deduped[duplicateIdx] : null;

    if (duplicateIdx >= 0) {
      deduped[duplicateIdx] = preferDuplicateMainLine(prev, line);
      continue;
    }

    deduped.push(line);
  }

  return deduped;
};

// 歌詞ソースの優先設定。'ytm' か 'lrchub' の2択で、どちらも他ソースへフォールバックする。
// 旧バージョンの 'standard' / 'ytm_only' / 'lrclib' もここで吸収する。
// 歌詞ソース設定は「YTM優先 / LRCHub優先」の2択になった。
// それ以前の保存値をどう引き継ぐかの対応表:
//   ytm / ytm_only … そのまま YTM優先
//   lrchub         … 明示的に LRCHub を選んだ意思とみなして尊重する
//   standard       … 旧デフォルト。特に選んでいないので、新しい既定値へ
//   lrclib         … 旧「LRCLIB優先」。その選択肢自体が無くなったので既定値へ
//   未設定 / 不明   … 既定値
// 既定値を YTM優先 にしているのは、videoId で曲を一意に特定できる YTM の方が
// 誤マッチが起きず、タイミングも配信元のデータそのままで正確なため。
// 背景の明るさの既定値。CSS 側の var() のフォールバックとも揃えること。
const DEFAULT_BG_BRIGHTNESS = 0.65;
// 保存値・CSS 変数・スライダーの値(文字列)を 0〜1 の数にする。0 は「真っ黒」で
// 正しい値。以前は `値 || 既定値` と書いていた所があり、0 が既定値(65%)に化けた。
const normalizeBgBrightness = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : DEFAULT_BG_BRIGHTNESS;
};

// 歌詞ソースは「YTM 優先 / LRCHub 優先」の2択。どちらも他方(と残りの
// 取得元)へ自動で落ちるので、選んだせいで歌詞が出なくなることはない。
//
// 以前あった 'external'(SimpMusic / LyricsPlus のみ)は撤去した。
// あれは「優先」ではなく「他を全部禁止」という別種のつまみで、空振りすると
// 歌詞が出ない。新しい取得元を単体で評価するための一時的な項目だったが、
// その評価は終わり、両者とも通常の競走に参加している。
const normalizeSourceMode = (value) => (
  (value === 'ytm' || value === 'ytm_only') ? 'ytm'
    : (value === 'lrchub') ? 'lrchub'
      // どのサーバーでもいいから単語同期を持っている方を採る。
      // 上の2つが「どこに先に聞くか」なのに対し、これだけ軸が違う。
      : (value === 'wordsync') ? 'wordsync'
        : 'ytm'
);

// 設定の「歌詞ソース」タブでオフにした標準の取得元。本体は
// lyric-sources.js(ES module なのでここからは import できない)。
// キー名と ID の並びはあちらと揃えること。
// YTM だけはここで止める。取得が content script でしかできないため。
// 残りは background が同じキーを読んで止める。
const DISABLED_LYRIC_SOURCES_KEY = 'ytm_disabled_lyric_sources';
const BUILTIN_LYRIC_SOURCE_IDS = ['ytm', 'lrchub', 'lrclib', 'simpmusic', 'lyricsplus'];
const normalizeDisabledLyricSources = (value) => (
  Array.isArray(value)
    ? [...new Set(value.map(v => String(v || '').trim().toLowerCase()).filter(id => BUILTIN_LYRIC_SOURCE_IDS.includes(id)))]
    : []
);
const isLyricSourceOn = (id) => !normalizeDisabledLyricSources(config.disabledLyricSources).includes(id);

// 追加の取得元(extra-providers.js の PROVIDER_IDS と揃えること)。
// 入切は Chrome の許可なので、ここからは見えない。background に聞く。
const EXTRA_LYRIC_SOURCE_IDS = ['netease', 'amll', 'kugou', 'liriqo', 'buaaa'];

// キャッシュに残っている歌詞の取得元が、いまは切られているか。
// 切った取得元の歌詞をキャッシュから出し続けると、設定を変えても
// 画面が変わらない(単語同期優先で、崩れた歌詞の取得元を切っても
// その歌詞が残り続けていた)。
const isCachedLyricSourceOff = async (source) => {
  const id = String(source || '').trim().toLowerCase();
  if (!id) return false;
  if (BUILTIN_LYRIC_SOURCE_IDS.includes(id)) return !isLyricSourceOn(id);
  if (!EXTRA_LYRIC_SOURCE_IDS.includes(id)) return false;
  const res = await safeRuntimeSendMessage({ type: 'GET_OFF_LYRIC_SOURCES' });
  return !!(res && res.success && Array.isArray(res.off) && res.off.includes(id));
};

// Apple Music 風の同期表示は body のクラスで切り替える。
// 軽量モードでも動かす。
//
// 以前はここで一緒に止めていたが、止める根拠が無かった。
// 持ち上がり・膨らみ(transform)は Web Animations のキーフレームで合成側に
// 渡してあり、塗りも毎フレーム書き換わるのは先端がいる語だけ。
// 軽量モードが本当に止めたいのは backdrop-filter のぼかしと背景ドリフトで、
// あちらは「ドリフトの毎フレーム、ビューポート全面のブラーを再計算」する
// (style.css の同名ブロックの注釈を参照)。桁が違う。
// 設定の文言も「背景アニメーション停止」であって、歌詞の話ではない。
//
// 毎フレーム書くもののうち塗り以外は光(.lyric-glow の濃さ)だけなので、
// 軽量モードではそこだけ落とす(measureLyricLineSweep の _glow)。
const applyAppleSyncClass = () => {
  if (typeof document === 'undefined' || !document.body) return;
  document.body.classList.toggle('ytm-apple-sync', !!config.appleSyncStyle);
};

// YTM の取得を待つ上限。next → browse の2段直列で各段 5 秒あるので、
// 待ち切ると最大10秒ほど白紙になる。ここで切って先に他の歌詞を出し、
// 遅れて届いた YTM は applyLateLyricsUpgrade に差し替えを任せる。
const YTM_EARLY_WAIT_MS = 1500;

// いま表示している歌詞が「YTM優先」設定によって選ばれたものか。
// 通常の別ソースでは差し替えないが、アニメーション表示を有効にしている
// ときの LRCHub srv3 は表示モードそのものなので、後着でも受け付ける。
let currentLyricsFromPreferredYtm = false;
// Immersion が開いていて再生位置を継続的に追えていたか。
// 連続再生の offset 補正を適用してよいかの判断に使う。
let _wasTrackingPlayback = false;

let animatedCaptionData = null;
let animatedCaptionFrameKey = '';

const isTimedTextXml = (text) => (
  typeof text === 'string' &&
  /<timedtext\b/i.test(text) &&
  /<body\b/i.test(text) &&
  /<p\b/i.test(text)
);

const timedTextNumberAttr = (el, name, fallback = null) => {
  const raw = el ? el.getAttribute(name) : null;
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const normalizeTimedTextCaption = (text) => (
  String(text || '')
    .replace(/\u200B/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
);

const parseTimedTextStyleMap = (root, tagName) => {
  const out = new Map();
  root.querySelectorAll(tagName).forEach((el) => {
    const id = el.getAttribute('id');
    if (!id) return;
    const attrs = {};
    Array.from(el.attributes || []).forEach(attr => {
      attrs[attr.name] = attr.value;
    });
    out.set(String(id), attrs);
  });
  return out;
};

const extractTimedTextSegments = (node, inheritedPenId = '') => {
  const segments = [];
  const walk = (current, penId) => {
    Array.from(current.childNodes || []).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = String(child.nodeValue || '').replace(/\u200B/g, '').replace(/\uFEFF/g, '');
        if (text.trim()) segments.push({ text, penId });
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const nextPenId = child.getAttribute('p') || penId;
      walk(child, nextPenId);
    });
  };
  walk(node, inheritedPenId);
  return segments;
};

const getTimedTextPenOpacity = (pen) => {
  if (pen?.fo === undefined) return 1;
  const value = Number(pen.fo);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value / 254)) : 1;
};

const hasTimedTextVisibleEdge = (pen) => (
  !!pen &&
  String(pen.et || '0') !== '0' &&
  /^#[0-9a-f]{6}$/i.test(String(pen.ec || ''))
);

const isTimedTextPenVisible = (pen) => (
  getTimedTextPenOpacity(pen) > 0 || hasTimedTextVisibleEdge(pen)
);

const getTimedTextVisibleText = (segments, cuePenId, cuePen, pens) => {
  if (!isTimedTextPenVisible(cuePen)) return '';
  const normalizedCuePenId = String(cuePenId || '');
  const visible = (Array.isArray(segments) ? segments : []).filter((segment) => {
    const segmentPenId = String(segment?.penId || '');
    if (!segmentPenId || segmentPenId === normalizedCuePenId) return true;
    return isTimedTextPenVisible(pens?.get?.(segmentPenId) || {});
  });
  return normalizeTimedTextCaption(visible.map(segment => segment.text).join(''));
};

const buildTimedTextPlainLines = (events) => {
  const lines = [];
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  events.forEach((event) => {
    const sourceText = typeof event?.visibleText === 'string' ? event.visibleText : event?.text;
    const text = normalizeTimedTextCaption(sourceText);
    const norm = normalize(text);
    if (!norm) return;

    const last = lines[lines.length - 1];
    if (last && event.time <= (last.endTime || last.time) + 0.35) {
      const lastNorm = normalize(last.text);
      if (norm === lastNorm) {
        last.endTime = Math.max(last.endTime || last.time, event.endTime || event.time);
        return;
      }
      if (norm.includes(lastNorm) || lastNorm.includes(norm)) {
        if (norm.length >= lastNorm.length) {
          last.endTime = event.endTime;
          last.text = text;
        }
        return;
      }
    }

    lines.push({
      time: event.time,
      endTime: event.endTime,
      text,
    });
  });

  return lines.map(({ time, text }) => ({ time, text }));
};

// srv3 の短い <p> は、それ自体がアニメーションの1フレーム。
// 前後に許容時間を足すと、次の位置/透明度フレームまで同時表示されて
// 残像になるため、開始を含み終了を含まない区間で厳密に選ぶ。
const getActiveTimedTextEvents = (events, timeMs, limit = 24) => (
  (Array.isArray(events) ? events : [])
    .filter(event => (
      Number.isFinite(event?.startMs) &&
      Number.isFinite(event?.endMs) &&
      timeMs >= event.startMs &&
      timeMs < event.endMs
    ))
    .slice(-Math.max(1, Number(limit) || 24))
);

const parseTimedTextAnimation = (xmlText) => {
  if (!isTimedTextXml(xmlText) || typeof DOMParser === 'undefined') return null;
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) return null;
    const root = doc.querySelector('timedtext');
    if (!root) return null;

    const pens = parseTimedTextStyleMap(root, 'pen');
    const windows = parseTimedTextStyleMap(root, 'wp');
    const windowStyles = parseTimedTextStyleMap(root, 'ws');
    const events = [];

    root.querySelectorAll('body > p').forEach((p, index) => {
      const startMs = timedTextNumberAttr(p, 't', null);
      const durationMs = timedTextNumberAttr(p, 'd', 0);
      if (startMs === null) return;

      const penId = p.getAttribute('p') || '';
      const wpId = p.getAttribute('wp') || '';
      const wsId = p.getAttribute('ws') || '';
      const segments = extractTimedTextSegments(p, penId);
      const text = normalizeTimedTextCaption(segments.map(s => s.text).join(''));
      if (!text) return;
      const pen = pens.get(String(penId)) || {};
      const visibleText = getTimedTextVisibleText(segments, penId, pen, pens);
      // d が明示された srv3 の <p> は、その長さ自体がアニメーションの
      // 1フレーム。33ms/34ms の正規フレームを60msへ延ばすと、次の
      // フレームと重なって残像になる。欠落または0のときだけ補完する。
      const frameDurationMs = durationMs > 0 ? durationMs : 60;

      events.push({
        id: index,
        time: startMs / 1000,
        endTime: (startMs + frameDurationMs) / 1000,
        startMs,
        endMs: startMs + frameDurationMs,
        durationMs,
        text,
        visibleText,
        segments: segments.length ? segments : [{ text, penId }],
        penId,
        wpId,
        wsId,
        pen,
        window: windows.get(String(wpId)) || {},
        windowStyle: windowStyles.get(String(wsId)) || {},
      });
    });

    if (!events.length) return null;
    events.sort((a, b) => a.startMs - b.startMs || a.id - b.id);
    return {
      pens,
      windows,
      windowStyles,
      events,
      plainLines: buildTimedTextPlainLines(events),
    };
  } catch (e) {
    console.warn('TimedText parse failed', e);
    return null;
  }
};

const getTimedTextAnchorTransform = (anchorPoint) => {
  const ap = Number(anchorPoint);
  const map = {
    0: 'translate(0, 0)',
    1: 'translate(-50%, 0)',
    2: 'translate(-100%, 0)',
    3: 'translate(0, -50%)',
    4: 'translate(-50%, -50%)',
    5: 'translate(-100%, -50%)',
    6: 'translate(0, -100%)',
    7: 'translate(-50%, -100%)',
    8: 'translate(-100%, -100%)',
  };
  return map[ap] || 'translate(-50%, -50%)';
};

const getTimedTextAlign = (windowStyle) => {
  const ju = Number(windowStyle?.ju);
  if (ju === 0) return 'left';
  if (ju === 1) return 'right';
  return 'center'; // srv3: ju=2
};

const getTimedTextScaledFontSize = (rawSize, fallback = 140) => {
  const numeric = Number(rawSize);
  const sourceSize = Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  return Math.max(20, Math.min(98, sourceSize * 0.30));
};

const getTimedTextForegroundColor = (pen, fallback = '#FEFEFE') => {
  const color = /^#[0-9a-f]{6}$/i.test(String(pen?.fc || '')) ? pen.fc : fallback;
  const alpha = getTimedTextPenOpacity(pen);
  if (alpha >= 0.999) return color;
  const red = parseInt(color.slice(1, 3), 16);
  const green = parseInt(color.slice(3, 5), 16);
  const blue = parseInt(color.slice(5, 7), 16);
  return `rgba(${red},${green},${blue},${alpha.toFixed(3)})`;
};

const getTimedTextShadow = (pen) => {
  if (hasTimedTextVisibleEdge(pen)) {
    return `0 0 2px ${pen.ec}, 0 2px 8px rgba(0,0,0,.72)`;
  }
  return getTimedTextPenOpacity(pen) > 0
    ? '0 2px 10px rgba(0,0,0,.72)'
    : 'none';
};

const getAnimatedCaptionFontScale = () => {
  const fallback = 3.4;
  try {
    if (!ui?.lyrics || typeof getComputedStyle !== 'function') return fallback;
    const raw = getComputedStyle(ui.lyrics).getPropertyValue('--ytm-animated-font-scale');
    const value = Number(String(raw || '').trim());
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return value;
  } catch {
    return fallback;
  }
};

const getTimedTextCueStyle = (event) => {
  const pen = event.pen || {};
  const win = event.window || {};
  const left = timedTextNumberAttr({ getAttribute: n => win[n] }, 'ah', 50);
  const top = timedTextNumberAttr({ getAttribute: n => win[n] }, 'av', 80);
  const scale = getAnimatedCaptionFontScale();
  const baseFontSize = getTimedTextScaledFontSize(pen.sz, 140);
  const fontSize = baseFontSize * scale;
  const color = getTimedTextForegroundColor(pen);
  const textShadow = getTimedTextShadow(pen);

  return [
    `left:${left}%`,
    `top:${top}%`,
    `transform:${getTimedTextAnchorTransform(win.ap)}`,
    `--ytm-animated-base-font-size:${baseFontSize}px`,
    `font-size:${fontSize}px`,
    `color:${color}`,
    `text-shadow:${textShadow}`,
    `text-align:${getTimedTextAlign(event.windowStyle)}`,
    pen.i === '1' ? 'font-style:italic' : '',
  ].filter(Boolean).join(';');
};

const shouldApplyTimedTextSegmentPen = (segment, event) => {
  const segmentPenId = String(segment?.penId || '');
  const cuePenId = String(event?.penId || '');
  // p の pen は親要素ですでに適用済み。同じ pen を span にも適用すると
  // fo (opacity) が二重に掛かり、フェードフレームがほぼ見えなくなる。
  return !!segmentPenId && segmentPenId !== cuePenId;
};

const getTimedTextSegmentHtml = (event) => (
  ((segments, scale) => segments.map(segment => {
    if (!shouldApplyTimedTextSegmentPen(segment, event)) return escapeHtml(segment.text);
    const pen = animatedCaptionData?.pens?.get(String(segment.penId || event.penId)) || event.pen || {};
    const color = getTimedTextForegroundColor(pen, '#FEFEFE');
    const size = Number(pen.sz || 0);
    const style = [
      `color:${color}`,
      `text-shadow:${getTimedTextShadow(pen)}`,
      size ? `font-size:${(getTimedTextScaledFontSize(size, size) * scale).toFixed(2)}px` : '',
      pen.i === '1' ? 'font-style:italic' : '',
    ].filter(Boolean).join(';');
    return `<span${style ? ` style="${style}"` : ''}>${escapeHtml(segment.text)}</span>`;
  }).join(''))(event.segments || [{ text: event.text, penId: event.penId }], getAnimatedCaptionFontScale())
);

const syncTimedTextStage = (stage, activeEvents) => {
  if (!stage) return;
  const existing = new Map(
    Array.from(stage.children || []).map(node => [String(node.dataset?.srv3EventId || ''), node])
  );
  const activeIds = new Set();
  const ownerDocument = stage.ownerDocument || document;

  activeEvents.forEach((event) => {
    const eventId = String(event.id);
    activeIds.add(eventId);
    let cue = existing.get(eventId);
    if (!cue) {
      cue = ownerDocument.createElement('div');
      cue.className = 'ytm-animated-caption-cue';
      cue.dataset.srv3EventId = eventId;
      cue.style.cssText = getTimedTextCueStyle(event);
      cue.innerHTML = getTimedTextSegmentHtml(event);
    }
    // appendChild は既存nodeを破棄せず、srv3の重なり順だけを揃える。
    stage.appendChild(cue);
  });

  existing.forEach((cue, eventId) => {
    if (!activeIds.has(eventId)) cue.remove();
  });
};

function renderAnimatedTimedText(captionData) {
  if (!ui.lyrics || !captionData) return;
  animatedCaptionData = captionData;
  animatedCaptionFrameKey = '';
  // innerHTML差し替えによるscrollイベントをユーザースクロール扱いにしない
  suppressUserScrollDetection(500);
  hasTimestamp = true;
  document.body.classList.remove('ytm-no-lyrics', 'ytm-no-timestamp');
  document.body.classList.add('ytm-has-timestamp', 'ytm-animated-caption-mode');
  ui.lyrics.innerHTML = '<div class="ytm-animated-caption-stage" aria-live="off"></div>';
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
    const pipBody = PipManager.pipWindow.document?.body;
    if (pipBody) {
      pipBody.classList.remove('ytm-no-lyrics', 'ytm-no-timestamp');
      pipBody.classList.add('ytm-animated-caption-mode');
      pipBody.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
    }
  }
  const now = getCurrentPlaybackTimeSec();
  updateAnimatedCaptionStage(typeof now === 'number' ? now : 0, true);
}

// 字幕の受け皿は毎フレーム同じ要素。入れ替わるのは歌詞を組み直した時だけなので、
// container に覚えさせて querySelector を毎フレーム走らせない。
const findAnimatedCaptionStage = (container) => {
  if (!container) return null;
  const cached = container._ytmCaptionStage;
  if (cached && cached.isConnected && container.contains(cached)) return cached;
  const found = container.querySelector('.ytm-animated-caption-stage');
  container._ytmCaptionStage = found;
  return found;
};

function updateAnimatedCaptionStage(currentTime, force = false) {
  if (!animatedCaptionData || !ui.lyrics) return;
  const stages = [findAnimatedCaptionStage(ui.lyrics)];
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    stages.push(findAnimatedCaptionStage(PipManager.pipLyricsContainer));
  }
  const availableStages = stages.filter(Boolean);
  if (!availableStages.length) return;
  const tMs = Math.max(0, currentTime * 1000);
  const active = getActiveTimedTextEvents(animatedCaptionData.events, tMs);
  const key = active.map(event => `${event.id}:${event.startMs}:${event.endMs}`).join('|');
  if (!force && key === animatedCaptionFrameKey) return;
  animatedCaptionFrameKey = key;
  availableStages.forEach(stage => {
    syncTimedTextStage(stage, active);
  });
}

// 器の大きさが変わったら、YTM のプレイヤーに映像の大きさを合わせ直させる
// (窓の resize を送ると測り直す)。要るのは映像を器へ移している動画モードだけ。
// 以前は曲モードでも、器の余白が動く間(バーを自動で隠す・出す時の
// 0.5 秒の変化)に毎フレーム送っていて、1 回の出し入れで 60 回、歌詞の
// 寄せ直しやジャケットの背景の描き直しまで毎フレーム走らせていた(実測)。
// 変わり始めと落ち着いた所の 2 回だけ送る。
const MOVIE_RESIZE_SETTLE_MS = 120;
// 動画モードの映像は、YTM の置いた場所のまま CSS で見せる(器へは移さない)。
//
// 以前は ytmusic-player を Immersion の器へ移していた。YTM は横長用と狭い窓用で
// 別の ytmusic-player を持ち、窓の幅が切り替わりの幅をまたぐと入れ替えて映像
// (#movie_player)だけを移す。器に移した方はこの入れ替えから外れ、古い
// ytmusic-player が溜まって曲モードの並びを崩し、最後は映像そのものが消えた
// (実機: 縦長と横長を行き来して曲へ戻すと、曲名が下へ寄って歌詞が出ず、
// 横長に戻すと video 要素が無くなった)。
// プレイヤーバーと同じやり方にする: 映像の入った ytmusic-player に印を付け、
// その祖先(Immersion が隠している YTM の画面)の「透明・変形」だけを外す。
// 隠すのは visibility なので、中身は映像以外見えないまま。印は YTM が
// 入れ替えるたびに付け直す(大きさが落ち着いた後と、曲の監視のついで)。
const MOVIE_PLAYER_ATTR = 'data-ytmi-movie-player';
const MOVIE_PATH_ATTR = 'data-ytmi-video-path';
const MOVIE_PLAYER_RECHECK_MS = 600;
const markMoviePlayerPath = () => {
  const on = moviemode === true && document.body.classList.contains('ytm-custom-layout');
  const live = on ? liveYtmPlayer() : null;
  // 前の版で器へ移した ytmusic-player が残っていたら、元の場所へ返す
  returnStaleYtmPlayers(null);
  const path = new Set();
  if (live) for (let p = live.parentElement; p && p !== document.body; p = p.parentElement) path.add(p);
  let changed = false;
  for (const el of document.querySelectorAll(`[${MOVIE_PATH_ATTR}]`)) {
    if (!path.has(el)) { el.removeAttribute(MOVIE_PATH_ATTR); changed = true; }
  }
  for (const el of path) {
    if (!el.hasAttribute(MOVIE_PATH_ATTR)) { el.setAttribute(MOVIE_PATH_ATTR, ''); changed = true; }
  }
  for (const el of document.querySelectorAll(`[${MOVIE_PLAYER_ATTR}]`)) {
    if (el !== live) { el.removeAttribute(MOVIE_PLAYER_ATTR); changed = true; }
  }
  if (live && !live.hasAttribute(MOVIE_PLAYER_ATTR)) { live.setAttribute(MOVIE_PLAYER_ATTR, ''); changed = true; }
  // 映像の大きさを新しい枠に合わせ直させる
  if (changed) window.dispatchEvent(new Event('resize'));
  return changed;
};
function setupMovieMode() {
  let settleTimer = null;
  let recheckTimer = null;
  const resizeObserver = new ResizeObserver(() => {
    if (moviemode !== true) return;
    if (!settleTimer) window.dispatchEvent(new Event('resize'));
    clearTimeout(settleTimer);
    clearTimeout(recheckTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!markMoviePlayerPath()) window.dispatchEvent(new Event('resize'));
      recheckTimer = setTimeout(markMoviePlayerPath, MOVIE_PLAYER_RECHECK_MS);
    }, MOVIE_RESIZE_SETTLE_MS);
  });
  const targetWrapper = document.getElementById("ytm-custom-wrapper");
  if (targetWrapper) {
    resizeObserver.observe(targetWrapper);
  } else {
    resizeObserver.observe(document.body);
  }

  const check = () => {
    const video = document.querySelector("ytmusic-player#player.style-scope.ytmusic-player-page");
    const target = document.querySelector("#ytm-custom-wrapper");
    const switcher = document.querySelector("ytmusic-av-toggle");
    const switcherTarget = document.querySelector("#ytm-custom-info-area");

    if (!video || !target || !switcher || !switcherTarget) {
      setTimeout(check, 300);
      return;
    }

    movieObserver = observerMovieModeSetup();
  };
  check();
};
// 「曲 / 動画」の切り替え(ytmusic-av-toggle)は Immersion の見出しへ移して使う。
// 以前ここに「Immersion ON だと切り替えが効かない」という未解決のメモがあった。
// 実際の原因は、切り替え直後に曲のキーが変わったのを曲替わりと見なして
// 「曲」へ押し戻していたこと(preferLyricsDefault と _userPlaybackModeUntil)。
// 映像は器へ移さず、YTM の置いた場所のまま見せる(markMoviePlayerPath)。
// 映像(ytmusic-player)と曲/動画の切り替えを Immersion の器へ移す前の居場所。
// 以前は戻す先を「#main-panel の 2 番目の子の前」「1 番目の子の中」と番号で
// 決めていたが、YTM の作りが変わって番号の先は別物になっていた(1 番目は
// 右上のメニューのボタン)。しかも映像の居場所は窓の幅で変わる(狭いと
// #music-player-wrapper の中)。縦長の窓にした後で曲へ戻すと、映像が YTM の
// 想定しない所に置かれて崩れていた(実機)。移す直前の場所を覚えて、そこへ戻す。
const _ytmHomes = new WeakMap();
const rememberYtmHome = (el) => {
  const parent = el && el.parentElement;
  if (!parent || parent.closest('#ytm-custom-wrapper')) return;
  _ytmHomes.set(el, { parent, next: el.nextSibling });
};
const returnYtmHome = (el, fallbackParent, fallbackBefore) => {
  if (!el) return;
  const home = _ytmHomes.get(el);
  if (home && home.parent.isConnected) {
    if (el.parentElement === home.parent) return;
    home.parent.insertBefore(el, home.next && home.next.parentNode === home.parent ? home.next : null);
    return;
  }
  if (fallbackParent && !fallbackParent.contains(el)) fallbackParent.insertBefore(el, fallbackBefore || null);
};
// 映像の入った ytmusic-player。YTM は窓の幅が切り替わりの幅をまたぐたびに
// ytmusic-player を作り直し、映像(#movie_player)を新しい方へ移す(実機: 縦長と
// 横長を行き来すると 3 つになった)。「ページの最初の ytmusic-player」を掴むと
// 古い空の方を掴むので、映像の入っている方を探す。
const liveYtmPlayer = () => document.getElementById('movie_player')?.closest('ytmusic-player')
  || document.querySelector('ytmusic-player#player');
// Immersion の器に残った古い ytmusic-player を元の場所へ返す。残すと曲モードの
// 並び(格子)の段を取り、曲名が下へ押し出されて歌詞の高さが 0 になっていた(実機)
const returnStaleYtmPlayers = (live) => {
  const wrapper = document.getElementById('ytm-custom-wrapper');
  if (!wrapper) return;
  const fallback = document.querySelector('ytmusic-player-page #main-panel');
  for (const el of wrapper.querySelectorAll(':scope > ytmusic-player')) {
    if (el === live) continue;
    el.classList.remove('moviemode');
    returnYtmHome(el, fallback);
  }
};
function bringSwitcherOnly() {
  const switcher = document.querySelector("ytmusic-av-toggle");
  const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
  rememberYtmHome(switcher);
  customSwitcherParent.appendChild(switcher);
}
function changeIModeUIWithMovieMode(mode) {
  if (!mode) {
    moviemode = null;
    document.body.classList.remove('ytm-movie-mode');
    if (typeof VideoQuality !== 'undefined') VideoQuality.sync(false);
    ui.qualityMenu?.classList.remove('visible');
    if (movieObserver) movieObserver.stop();
    movieObserver = null;
    const switcher = document.querySelector("ytmusic-av-toggle");
    const originParent = document.querySelector("div#main-panel");
    markMoviePlayerPath();
    returnYtmHome(switcher, originParent);
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 300);
  }
  else {
    if (movieObserver) movieObserver.stop();
    movieObserver = null;
    movieObserver = observerMovieModeSetup();
  }
}
const observerMovieModeSetup = () => {
  const switcher = document.querySelector("ytmusic-av-toggle");
  if (!switcher) return null;

  if (movieObserver) {
    movieObserver.stop();
    movieObserver = null;
  }

  let changed;
  let classTargets = [];

  const handleMutation = () => {
    const mode = switcher.getAttribute("playback-mode");
    const newMoviemode = (mode === "OMV_PREFERRED") ? true : false;

    if (moviemode !== newMoviemode) {
      changed = true;
    } else {
      changed = false;
    }

    moviemode = newMoviemode;
    if (changed) refreshShownTitle();
    // 背景(#ytm-custom-bg)は body の直下にあり、wrapper の moviemode クラスが
    // 届かない。CSS から動画モードを見分けられるよう body にも付ける
    document.body.classList.toggle('ytm-movie-mode', !!moviemode);
    // 動画モードは映像が背景を覆うので、Apple Music 風の背景を止める
    syncFluidBg();
    // 開いている PiP も、MV を映す形と歌詞の形を切り替える
    if (typeof PipManager !== 'undefined') PipManager.syncVideoMode();
    // 選んだ画質は動画モードの間だけ当てる
    if (typeof VideoQuality !== 'undefined') VideoQuality.sync(!!moviemode);
    if (!moviemode) ui.qualityMenu?.classList.remove('visible');

    classTargets = [];
    const wrapper = document.querySelector("#ytm-custom-wrapper");
    if (wrapper instanceof Element) {
      classTargets.push(...wrapper.querySelectorAll("*"));
    }
    const pusher = (element) => {
      if (element instanceof Element) classTargets.push(element);
    };
    const playerBar = PlayerBar.get();
    pusher(playerBar);
    pusher(switcher);
    const video = liveYtmPlayer();
    pusher(video);
    const navBar = document.querySelector("ytmusic-nav-bar");
    pusher(navBar);

    classTargets.forEach(element => {
      if (moviemode) {
        element.classList.add("moviemode");
      } else {
        element.classList.remove("moviemode");
      }
    });

    changeUIWithMovieMode(changed);
  };

  handleMutation();
  bringSwitcherOnly();
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.attributeName === "playback-mode") {
        handleMutation();
      }
    });
  });

  observer.observe(switcher, { attributes: true });

  movieObserver = {
    stop: () => {
      observer.disconnect();
      movieObserver = null;
    }
  };

  return movieObserver;
};
function changeUIWithMovieMode(changed) {
  if (!changed || changed === null) return;
  const customSwitcherParent = document.querySelector("#ytm-custom-info-area");
  const switcher = document.querySelector("ytmusic-av-toggle");
  if (moviemode && switcher && customSwitcherParent) {
    rememberYtmHome(switcher);
    customSwitcherParent.appendChild(switcher);
  }
  markMoviePlayerPath();
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 100);
  setTimeout(() => {
    window.dispatchEvent(new Event('resize'));
  }, 300);
}
// 動画/曲の切り替えが使える状態か。
//
// 以前はサイドガイドの項目数(childNodes.length >= 4)で非 Premium と
// 判断していた。YTM の UI が変わるだけで判定が裏返り、動画モードの
// セットアップが走らなくなったり、走るべきでない時に走ったりする。
//
// 判断材料は切り替えトグルそのものにする。存在して playback-mode を
// 持っていれば、実際に切り替えられる。
function isYTMPremiumUser() {
  const switcher = document.querySelector("ytmusic-av-toggle");
  const canSwitch = !!switcher && switcher.hasAttribute('playback-mode');
  if (switcher) switcher.classList.toggle('notpremium', !canSwitch);
  return canSwitch;
}

// ページを読み込んだ直後は、トグルが在っても playback-mode がしばらく
// "NONE" で、0.1〜0.5 秒ほどしてから OMV_PREFERRED / ATV_PREFERRED に決まる
// (実機)。以前は "NONE" を見た時点で諦めていたので、リンクから開いたり
// 読み込み直したりすると動画のまま残った。広告が挟まると tick が待つ間に
// 決まるので、広告の出ない(Premium の)人ほど起きていた。決まるまで待つ。
const PREFER_SONG_MAX_ATTEMPTS = 20;
// 利用者が自分で「曲 / 動画」を押した曲。その曲ではもう「曲」へ寄せない。
//
// 曲が変わった直後は切り替えの準備ができるまで最大 6 秒ほど待って寄せるので、
// その間に「動画」を押すと、押した直後に「曲」へ押し戻されていた(実機)。
// 拡張自身が押すクリックは isTrusted が false なので、ここには入らない。
let _userPlaybackModeKey = null;
// 押した直後に曲のキーが変わったら、それは切り替えた先(MV と曲版)。
// MV は曲名・アーティストの書き方が曲版と違うことがあり(例: 日向坂46「君はハニーデュー」)、
// 別の曲に変わったと見なして「曲」へ押し戻していた(実機)。
// しかもキーは 1 回では落ち着かない。切り替えの間にアーティスト名が
// MediaSession の英字とプレイヤーバーの日本語の間を行き来する
// (Hinatazaka46 → 日向坂46 → Hinatazaka46、実機)。最初の 1 回だけ許すと
// 2 回目で押し戻され、何度も押さないと動画に入れなかった。
//  ・押してから少しの間に変わったキーは、何回変わっても利用者が選んだもの
//  ・その後も、曲名が同じならアーティスト名の書き方が変わっただけと見なす
const USER_PLAYBACK_MODE_GRACE_MS = 4000;
let _userPlaybackModeUntil = 0;
const playbackModeKeyTitle = (key) => String(key || '').split('///')[0].trim().toLowerCase();
// MV の無い曲。YTM は切り替えに toggle-disabled を付け、MV がある時だけ
// selected-item-has-video を付ける(実機、未ログインでも同じ)。Immersion では
// 切り替えを自分の場所へ移して色も付け直しているので、押せないことが見えず、
// 「動画」を押せてしまっていた。押しても受け付けない(style.css で薄くもする)
const avToggleHasNoVideo = (toggle) => !!toggle
  && toggle.hasAttribute('toggle-disabled') && !toggle.hasAttribute('selected-item-has-video');
document.addEventListener('click', (e) => {
  const t = e.target;
  const btn = t && t.closest && t.closest('ytmusic-av-toggle .video-button');
  if (!btn || !avToggleHasNoVideo(btn.closest('ytmusic-av-toggle'))) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
document.addEventListener('click', (e) => {
  if (!e.isTrusted) return;
  const t = e.target;
  if (!(t && t.closest && t.closest('ytmusic-av-toggle'))) return;
  _userPlaybackModeKey = currentKey;
  _userPlaybackModeUntil = Date.now() + USER_PLAYBACK_MODE_GRACE_MS;
}, true);

function preferLyricsDefault(targetKey, attempt = 0) {
  if (!targetKey || currentKey !== targetKey) return;
  // 設定で切れるようにした。以前は曲が変わるたびに必ず「曲」へ寄せていたので、
  // 「動画」を選んでいても毎曲戻され、動画モードに留まる手段が無かった。
  if (!config.preferSongMode) return;
  if (_userPlaybackModeKey && (Date.now() < _userPlaybackModeUntil
    || playbackModeKeyTitle(_userPlaybackModeKey) === playbackModeKeyTitle(targetKey))) {
    _userPlaybackModeKey = targetKey;
  }
  if (_userPlaybackModeKey === targetKey) return;

  const retry = () => {
    if (attempt < PREFER_SONG_MAX_ATTEMPTS) setTimeout(() => preferLyricsDefault(targetKey, attempt + 1), 300);
  };
  const switcher = document.querySelector("ytmusic-av-toggle");
  if (!switcher) {
    retry();
    return;
  }

  const mode = switcher.getAttribute("playback-mode");
  if (mode === "ATV_PREFERRED") return;
  if (mode !== "OMV_PREFERRED") {
    retry();
    return;
  }

  const songBtn = switcher.querySelector('.song-button.ytmusic-av-toggle, .song-button');
  if (!songBtn) {
    retry();
    return;
  }

  try {
    songBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
    if (typeof songBtn.click === 'function') songBtn.click();
  } catch (e) {
    console.warn('Failed to switch default playback mode to lyrics', e);
  }

  if (attempt < PREFER_SONG_MAX_ATTEMPTS) {
    setTimeout(() => {
      if (currentKey !== targetKey) return;
      const latestMode = switcher.getAttribute("playback-mode");
      if (latestMode !== "ATV_PREFERRED") {
        preferLyricsDefault(targetKey, attempt + 1);
      }
    }, 250);
  }
}
// 目当ての要素が現れるまで待つ。
// 1 秒ごとの setInterval で探し続けると、見つかるまでの数十秒ずっと
// 空振りのクエリを回すことになる。DOM が動いた時だけ見に行く。
const waitForDomCondition = (check, timeoutMs) => new Promise((resolve) => {
  const first = check();
  if (first) { resolve(first); return; }

  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    observer.disconnect();
    clearTimeout(timer);
    resolve(value);
  };
  const observer = new MutationObserver(() => {
    const value = check();
    if (value) finish(value);
  });
  const timer = setTimeout(() => finish(null), timeoutMs);
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

const hoverTimeInfoSetup = () => {
  // "m:ss" と "h:mm:ss" の両方を受ける。1 時間を超える曲(ライブ音源・
  // ミックス)で後ろの2つしか見ていなかったため、ホバーの時刻が NaN になっていた。
  const timeToSeconds = (str) => {
    const parts = String(str || '').split(':').map(Number);
    if (!parts.length || parts.some(n => !Number.isFinite(n))) return 0;
    return parts.reduce((total, n) => total * 60 + n, 0);
  };
  const formatHoverTime = (totalSeconds) => {
    const sec = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };
  const removeHoverTimeInfo = () => {
    void waitForDomCondition(
      () => document.querySelector('#hover-time-info'),
      30000
    ).then(info => { if (info) info.remove(); });
  };
  const createHoverTimeInfo = () => {
    let info = document.querySelector('#hover-time-info-new');
    if (!info) {
      info = document.createElement('span');
      info.id = 'hover-time-info-new';
      info.style.display = 'none';
      info.textContent = '0:00';
      document.body.appendChild(info);
    }
  };
  const adjustHoverTimeInfoPosition = () => {
    const findParts = () => {
      const progresshandle = document.querySelector('tp-yt-paper-slider#progress-bar #sliderKnob');
      const info = document.querySelector('#hover-time-info-new');
      const sliderBar = document.querySelector(
        'tp-yt-paper-slider#progress-bar tp-yt-paper-progress#sliderBar #primaryProgress'
      );
      const slider = sliderBar?.parentElement?.parentElement;
      const playerBar = document.querySelector('ytmusic-player-bar');
      if (!(slider && info && progresshandle && playerBar)) return null;
      return { progresshandle, info, slider, playerBar };
    };

    void waitForDomCondition(findParts, 60000).then((parts) => {
      if (!parts) return;
      const { progresshandle, info, slider, playerBar } = parts;
      const onMove = (e) => {
        const marginLeft = (playerBar.parentElement.offsetWidth - playerBar.offsetWidth) / 2;
        const infoLeft = e.clientX;
        const relativeMouseX = e.clientX - marginLeft;
        const timeinfo = document.querySelector('#left-controls > span');
        if (!timeinfo) return;
        const songLengthSeconds = timeToSeconds(timeinfo.textContent.replace(/^[^/]+\/\s*/, ""));
        const relativePosition = Math.round((Math.min(1, Math.max(0, (relativeMouseX / slider.offsetWidth)))) * 1000) / 1000;
        const hoverTimeSeconds = Math.floor(songLengthSeconds * relativePosition);
        info.style.display = 'block';
        info.style.left = `${infoLeft}px`;
        info.textContent = formatHoverTime(hoverTimeSeconds);
      };
      const hide = () => {
        info.style.display = 'none';
      };
      slider.addEventListener('mousemove', onMove);
      slider.addEventListener('mouseout', hide);
      progresshandle.addEventListener('mousemove', onMove);
      progresshandle.addEventListener('mouseout', hide);
    });
  };
  removeHoverTimeInfo();
  createHoverTimeInfo();
  adjustHoverTimeInfoPosition();
};

const parseLRCNoFlag = (lrc) => {
  return parseLRCInternal(lrc).lines;
};

const normalizeStr = (s) => (s || '').replace(/\s+/g, '').trim();

const isMixedLang = (s) => {
  if (!s) return false;
  const hasLatin = /[A-Za-z]/.test(s);
  const hasCJK = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
  const hasHangul = /[\uAC00-\uD7AF]/.test(s);
  let kinds = 0;
  if (hasLatin) kinds++;
  if (hasCJK) kinds++;
  if (hasHangul) kinds++;
  return kinds >= 2;
};

const detectCharScript = (ch) => {
  if (!ch) return 'OTHER';
  if (/[A-Za-z]/.test(ch)) return 'LATIN';
  if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(ch)) return 'CJK';
  if (/[\uAC00-\uD7AF]/.test(ch)) return 'HANGUL';
  return 'OTHER';
};

const segmentByScript = (s) => {
  const result = [];
  if (!s) return result;
  let currentScript = null;
  let buf = '';
  for (const ch of s) {
    const script = detectCharScript(ch);
    if (currentScript === null) {
      currentScript = script;
      buf = ch;
    } else if (script === currentScript) {
      buf += ch;
    } else {
      result.push({ script: currentScript, text: buf });
      currentScript = script;
      buf = ch;
    }
  }
  if (buf) {
    result.push({ script: currentScript, text: buf });
  }
  return result;
};

const shouldTranslateSegment = (script, langCode) => {
  const lang = (langCode || '').toLowerCase();
  if (script === 'OTHER') return false;
  switch (lang) {
    case 'ja': return script === 'LATIN' || script === 'HANGUL';
    case 'en': return script === 'CJK' || script === 'HANGUL';
    case 'ko': return script === 'LATIN' || script === 'CJK';
    default: return script !== 'LATIN';
  }
};

const translateMixedSegments = async (lines, indexes, langCode, targetLang) => {
  if (!config.deepLKey) return null;
  try {
    const segmentsToTranslate = [];
    const perLineSegments = {};
    indexes.forEach(idx => {
      const line = lines[idx];
      const text = (line && line.text) || '';
      const segs = segmentByScript(text);
      const segMeta = [];
      segs.forEach(seg => {
        if (shouldTranslateSegment(seg.script, langCode)) {
          const translateIndex = segmentsToTranslate.length;
          segmentsToTranslate.push(seg.text);
          segMeta.push({ original: seg.text, translateIndex });
        } else {
          segMeta.push({ original: seg.text, translateIndex: null });
        }
      });
      perLineSegments[idx] = segMeta;
    });
    if (!segmentsToTranslate.length) return null;
    const res = await safeRuntimeSendMessage(
      { type: 'TRANSLATE', payload: { text: segmentsToTranslate, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: false } }
    );
    if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== segmentsToTranslate.length) {
      return null;
    }
    const segTranslations = res.translations.map(t => t.text || '');
    const result = {};
    Object.keys(perLineSegments).forEach(key => {
      const lineIdx = Number(key);
      const segMeta = perLineSegments[lineIdx];
      let rebuilt = '';
      segMeta.forEach(seg => {
        if (seg.translateIndex == null) {
          rebuilt += seg.original;
        } else {
          rebuilt += segTranslations[seg.translateIndex] ?? seg.original;
        }
      });
      result[lineIdx] = rebuilt;
    });
    return result;
  } catch (e) {
    console.error('DeepL mixed-line fallback failed', e);
    return null;
  }
};

const dedupePrimarySecondary = (lines) => {
  if (!Array.isArray(lines)) return lines;
  lines.forEach(l => {
    if (!l.translation) return;
    const src = normalizeStr(l.text);
    const trn = normalizeStr(l.translation);
    if (src === trn && !isMixedLang(l.text)) {
      delete l.translation;
    }
  });
  return lines;
};

// DeepL の結果置き場。曲(currentKey)と言語と歌詞本文が同じなら叩き直さない。
// 歌詞本文まで見るのは、取得元が差し替わって行が変わることがあるため。
const DEEPL_CACHE_MAX = 8;
const deepLTranslationCache = new Map();

const deepLCacheKey = (lines, langCode) => {
  const body = lines.map(l => (l && l.text !== undefined && l.text !== null) ? String(l.text) : '').join('\n');
  return `${currentKey || ''}///${langCode}///${body}`;
};

const translateWithDeepLCached = async (lines, langCode) => {
  const key = deepLCacheKey(lines, langCode);
  if (deepLTranslationCache.has(key)) return deepLTranslationCache.get(key);
  const translated = await translateTo(lines, langCode);
  if (!translated) return null;
  // 古いものから落とす。曲を跨いで無制限に溜めない。
  if (deepLTranslationCache.size >= DEEPL_CACHE_MAX) {
    deepLTranslationCache.delete(deepLTranslationCache.keys().next().value);
  }
  deepLTranslationCache.set(key, translated);
  return translated;
};

const translateTo = async (lines, langCode) => {
  if (!config.deepLKey || !lines.length) return null;
  const targetLang = resolveDeepLTargetLang(langCode);
  try {
    const baseTexts = lines.map(l => (l && l.text !== undefined && l.text !== null) ? String(l.text) : '');
    // 空行は翻訳APIへ送らず、行数だけ保持してタイムスタンプのズレを防ぐ
    const mapIdx = [];
    const requestTexts = [];
    for (let i = 0; i < baseTexts.length; i++) {
      const t = baseTexts[i];
      if ((t || '').trim()) {
        mapIdx.push(i);
        requestTexts.push(t);
      }
    }

    let translated = new Array(lines.length).fill('');

    if (requestTexts.length) {
      const res = await safeRuntimeSendMessage(
        { type: 'TRANSLATE', payload: { text: requestTexts, apiKey: config.deepLKey, targetLang, useSharedTranslateApi: false } }
      );

      if (!res?.success || !Array.isArray(res.translations) || res.translations.length !== requestTexts.length) {
        return null;
      }

      for (let i = 0; i < mapIdx.length; i++) {
        const tr = res.translations[i];
        translated[mapIdx[i]] = (tr && tr.text) ? tr.text : '';
      }
    }
    const fallbackIndexes = [];
    for (let i = 0; i < lines.length; i++) {
      const src = baseTexts[i];
      const trn = translated[i];
      if (!src) continue;
      if (normalizeStr(src) === normalizeStr(trn) && isMixedLang(src)) {
        fallbackIndexes.push(i);
      }
    }
    if (fallbackIndexes.length) {
      const mixedFallback = await translateMixedSegments(lines, fallbackIndexes, langCode, targetLang);
      if (mixedFallback) {
        fallbackIndexes.forEach(i => {
          if (mixedFallback[i]) translated[i] = mixedFallback[i];
        });
      }
    }
    return translated;
  } catch (e) {
    console.error('DeepL failed', e);
  }
  return null;
};


// ジャケットの画像。ふだんは MediaSession のものを使う。
// 「動画」から「曲」へ戻した時、MediaSession の画像が MV のサムネイル
// (i.ytimg.com/vi/<MV の ID>/…)のまま残ることがある(実機)。画像の ID が
// 今の動画 ID と違えば古いものなので、プレイヤーバーに出ている今の曲の
// ジャケット(googleusercontent なら大きいサイズに)を使う。
const thumbVideoId = (src) => {
  const m = /^https:\/\/i\d*\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//.exec(src || '');
  return m ? m[1] : null;
};
const pickArtworkSrc = (sessionSrc) => {
  const mode = document.querySelector('ytmusic-av-toggle')?.getAttribute('playback-mode');
  if (mode !== 'ATV_PREFERRED') return sessionSrc;
  const shownId = thumbVideoId(sessionSrc);
  const currentId = getCurrentVideoId();
  if (!shownId || !currentId || shownId === currentId) return sessionSrc;
  // バーの中だけを見る。PlayerBar.query はバーに無いとページ全体から探すので、
  // ホームや検索結果に並ぶ別の曲のジャケット(img.image)を拾うことがある
  const barSrc = PlayerBar.get()?.querySelector('img.image, ytmusic-track-info img')?.src || '';
  if (/googleusercontent\.com\//.test(barSrc)) return barSrc.replace(/=w\d+-h\d+[^/?#]*$/, '=w544-h544-l90-rj');
  if (thumbVideoId(barSrc) === currentId) return barSrc;
  return sessionSrc;
};

const getMetadata = () => {
  // Prefer MediaSession metadata (most accurate)
  if (navigator.mediaSession?.metadata) {
    const { title, artist, album, artwork } = navigator.mediaSession.metadata;
    return {
      title: (title || '').toString(),
      artist: (artist || '').toString(),
      album: (album || '').toString(),
      src: pickArtworkSrc(Array.isArray(artwork) && artwork.length ? artwork[artwork.length - 1].src : null)
    };
  }

  // Fallback: read from player bar
  const tEl = document.querySelector(PLAYER_BAR_TITLE_SELECTOR);
  const aEl = document.querySelector(PLAYER_BAR_BYLINE_SELECTOR);
  if (!(tEl && aEl)) return null;

  const parts = splitBylineParts(aEl.textContent);

  return {
    title: (tEl.textContent || '').trim(),
    artist: parts[0] || '',
    album: parts[1] || '',
    src: null
  };
};


// 画面に出ているアーティスト名のうち、MediaSession と表記だけが違うもの。
// YTM の MediaSession のアーティスト名は曲(リリース)ごとに英字だったり
// 日本語だったりする。同じ日本語の画面でも、花鋏キョウの「Starry」は
// 「花鋏キョウ」、「Starry (night Remix)」は「Kyo Hanabasami」だった(実機)。
// LRCHub の曲名検索はアーティスト名も照合するので、登録が画面の表記だと
// 当たらない。その時に引き直す名前として、LRCHub の検索にだけ渡す。
//  ・プレイヤーバーの曲名が MediaSession と同じ曲の時だけ読む(曲送りの
//    直後は、バーに前の曲が残っていることがある)
//  ・片方だけが日本語・中国語・韓国語の文字を含む組み合わせに限る。両方が
//    同じ文字なら、表記ゆれではなく別の名義(feat. の有無など)の場合がある
//    (replay-manager の _looksSameArtist と同じ考え)
const ARTIST_SCRIPT_RE = /[぀-ヿ㐀-鿿豈-﫿가-힯]/;
const readShownArtistVariant = (meta) => {
  const title = String(meta?.title || '').trim();
  const artist = String(meta?.artist || '').trim();
  if (!title || !artist) return '';
  const barTitle = String(document.querySelector(PLAYER_BAR_TITLE_SELECTOR)?.textContent || '').trim();
  if (!barTitle || normalizeTitleForSettle(barTitle) !== normalizeTitleForSettle(title)) return '';
  const shown = parseBylineArtist(document.querySelector(PLAYER_BAR_BYLINE_SELECTOR)?.textContent || '').trim();
  if (!shown || shown === artist || shown.length > 60) return '';
  return ARTIST_SCRIPT_RE.test(shown) !== ARTIST_SCRIPT_RE.test(artist) ? shown : '';
};

const extractVideoIdFromHref = (href) => {
  if (!href) return null;
  try {
    const url = new URL(href, location.origin);
    const vid = url.searchParams.get('v');
    if (vid) return vid;
    if (url.hostname.includes('youtu.be')) {
      return (url.pathname || '').split('/').filter(Boolean)[0] || null;
    }
  } catch (e) { }
  return null;
};

const getCurrentVideoIdFromDom = () => {
  const selectors = [
    'ytmusic-player-bar yt-formatted-string.title a[href*="watch"]',
    'ytmusic-player-bar a[href*="watch?v="]',
    'ytmusic-miniplayer .ytmusicTrackInfoTitle a[href*="watch"]',
    'ytmusic-miniplayer a[href*="watch?v="]'
  ];

  for (const selector of selectors) {
    const link = document.querySelector(selector);
    const vid = extractVideoIdFromHref(link && (link.href || link.getAttribute('href')));
    if (vid) return vid;
  }
  return null;
};

// プレイヤーページを閉じて(ミニプレイヤーで)ホームや検索を見ている間は、
// URL から v= が消え、プレイヤーバーにも watch へのリンクが無い(実機で確認)。
// その間も埋め込みプレイヤーのタイトルリンクは再生中の曲を指していて、
// 曲送りから 250ms 以内に書き換わる。最後の手がかりとしてここを読む。
// これが無いと videoId が取れず、Daily Replay がブラウズ中の再生を一切
// 数えず、PiP も曲の切り替わりを追えなかった。
const getVideoIdFromEmbeddedPlayer = () => {
  const link = document.querySelector('#movie_player a.ytp-title-link, a.ytp-title-link');
  return extractVideoIdFromHref(link && (link.getAttribute('href') || link.href));
};

const getCurrentVideoUrl = () => {
  try {
    const domVid = getCurrentVideoIdFromDom();
    if (domVid) return `https://youtu.be/${domVid}`;

    const url = new URL(location.href);
    const vid = url.searchParams.get('v') || getVideoIdFromEmbeddedPlayer();
    return vid ? `https://youtu.be/${vid}` : location.href;
  } catch (e) {
    console.warn('Failed to get current video url', e);
    return '';
  }
};

const getCurrentVideoId = () => {
  try {
    const domVid = getCurrentVideoIdFromDom();
    if (domVid) return domVid;

    const url = new URL(location.href);
    return url.searchParams.get('v') || getVideoIdFromEmbeddedPlayer();
  } catch (e) {
    return null;
  }
};

// === BG からの後追いメタ更新（遅い方待ちをやめた時用）===
// Metadata can arrive after lyrics; refresh related UI when it does.
chrome.runtime.onMessage.addListener((msg) => {
  try {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'LYRICS_DATA_UPDATE') {
      void applyLateLyricsUpgrade(msg.payload || {}).catch((error) => {
        console.warn('[YTM] Failed to apply late LRCHub lyrics:', error);
      });
      return;
    }
    if (msg.type !== 'LYRICS_META_UPDATE') return;
    const p = msg.payload || {};
    const curVid = getCurrentVideoId();
    if (p.video_id && curVid && p.video_id !== curVid) return;

    if (Array.isArray(p.candidates)) lyricsCandidates = p.candidates;
    mergeLyricsCandidates(p.mergeCandidates);
    if (p.config !== undefined) lyricsConfig = p.config;
    if (Array.isArray(p.requests)) lyricsRequests = p.requests;
    syncLyricsLockState();

    // duet: sub lyrics can arrive later
    if (typeof p.subLyrics === 'string') {
      duetSubLyricsRaw = p.subLyrics;
      // re-render with same raw lyrics to avoid showing duplicate left+right lines
      if (lastRawLyricsText && typeof lastRawLyricsText === 'string') {
        applyLyricsText(lastRawLyricsText);
      }
    }

    // dynamic: char-timed lines can arrive later even if lyrics came from API
    if (Array.isArray(p.dynamicLines) && p.dynamicLines.length) {
      const keepAnimatedStage = !!(
        config.useAnimatedCaptions &&
        animatedCaptionData &&
        document.body.classList.contains('ytm-animated-caption-mode')
      );
      // srv3 is the selected top-level display mode. A late DynamicLRC metadata
      // packet is an alternative representation, not permission to tear down
      // the animated stage and restore ordinary lyric rows.
      if (!keepAnimatedStage) {
        dynamicLines = p.dynamicLines;
        // re-render to attach per-char spans while keeping current lines/translations
        if (Array.isArray(lyricsData) && lyricsData.length) {
          renderLyrics(lyricsData);
        }
      }
    }

    // candidates/config が更新されたらメニューを再描画
    const incomingMeaningData = normalizeMeaningPayloadLocal(p);
    if (incomingMeaningData) {
      setLyricsMeaningData(incomingMeaningData);
      persistMeaningDataToCurrentCache().catch(() => { });
      if (meaningPanelVisible) syncMeaningPanelToPlayback(true);
    }

    refreshCandidateMenu();
    refreshLockMenu();
  } catch (e) {
    // ignore
  }
});

const createEl = (tag, id, cls, html) => {
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (cls) el.className = cls;
  if (html !== undefined && html !== null) el.innerHTML = html;
  return el;
};

const showToast = (text) => {
  if (!text) return;
  let el = document.getElementById('ytm-toast');
  if (!el) {
    el = createEl('div', 'ytm-toast', '', '');
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
  }, 5000);
};

let lyricsCacheWriteQueue = Promise.resolve();

function enqueueLyricsCacheWrite(key, createValue, isCurrent) {
  const task = lyricsCacheWriteQueue
    .catch(() => undefined)
    .then(async () => {
      if (typeof isCurrent === 'function' && !isCurrent()) return false;
      const value = typeof createValue === 'function' ? await createValue() : createValue;
      if (typeof isCurrent === 'function' && !isCurrent()) return false;
      await storage.set(key, value);
      return true;
    });
  lyricsCacheWriteQueue = task.then(() => undefined, () => undefined);
  return task;
}

// ── 取得元の表示 ──────────────────────────────────────────
// 歌詞の出どころは LRCHub / YouTube Music / SimpMusic / LyricsPlus / LRCLIB と
// 増えたうえ、同じ曲でも「先に返した方が勝つ」ので実行のたびに変わりうる。
// 出し方はひと通りだけ: 手を動かした時に出て、止まれば引っ込む
// (body.ytm-pointer-active)。設定は置かない。
// 以前は「いまの取得元を画面に表示する」という設定があったが、手を動かした
// 時だけ出す方式にした時点で、OFF でも出るのに名前は「表示する」のままという
// 嘘になっていた。聴いている間は出ず、触れば出るなら、切りたい理由が無い。
// 選ばせる必要のない物を設定に並べない。
// デバッグ(ytm_debug)で増えるのはコンソールへの記録だけ。画面には出さない。
// フラグを立てた人が欲しいのは記録であって、消せない常設表示ではない。
const LYRICS_SOURCE_LABELS = {
  lrchub: 'LRCHub',
  lrclib: 'LRCLIB',
  ytm: 'YouTube Music',
  simpmusic: 'SimpMusic',
  lyricsplus: 'LyricsPlus',
};

// 並びは selectLyricsPayload の quality と対応させること。
// 統合時に上流が 3(単語同期) と 4(srv3 字幕) を入れ替えたので、
// ここも入れ替えてある。片方だけ直すと表示が嘘になる。
const LYRICS_QUALITY_LABELS = ['', '時刻なし', '行同期', '単語同期', '字幕同期'];
// 取得元の表示(ボタン列の下)に出す時は表示言語に合わせる。並びは上と同じ。
const LYRICS_QUALITY_LABEL_KEYS = ['', 'lyrics_quality_none', 'lyrics_quality_line', 'lyrics_quality_word', 'lyrics_quality_caption'];

// ── 手を動かしている間だけ出すもの ──────────────────────
// 聴いているだけの間は画面に何も足さない。没入が主眼なので、常設の
// 表示は置かない。ただし「歌詞がずれている」と気づいた人は必ず何か
// 操作しようとしてマウスを動かすので、その瞬間に出す。
// 動画プレイヤーの操作盤と同じ作法。
//
// 「歌詞にホバーしたら」にはしない。バッジは左下、歌詞は右側なので、
// 手を伸ばす途中で条件が切れて消えてしまう。
const POINTER_IDLE_HIDE_MS = 2600;
let pointerIdleTimer = null;
// 手を置いたままでも届く mousemove がある。Chrome は scrollTop が動くと、
// カーソルの下にある物が変わったかを取り直すために、同じ座標の mousemove を
// 投げてくる。歌詞は行が変わるたびに scrollTop を書くので、画面の
// 上にカーソルを置いたままにしていると、曲が続くかぎりそれが届き続け、
// 「ずっと手を動かしている」ことになってバッジが引っ込まなかった。
// 座標が動いた時だけ本物の操作として扱う。
let lastPointerX = null;
let lastPointerY = null;

const notePointerActivity = (ev) => {
  if (typeof document === 'undefined' || !document.body) return;
  if (ev && ev.type === 'mousemove') {
    if (ev.clientX === lastPointerX && ev.clientY === lastPointerY) return;
    lastPointerX = ev.clientX;
    lastPointerY = ev.clientY;
  }
  document.body.classList.add('ytm-pointer-active');
  if (pointerIdleTimer) clearTimeout(pointerIdleTimer);
  pointerIdleTimer = setTimeout(() => {
    pointerIdleTimer = null;
    document.body.classList.remove('ytm-pointer-active');
  }, POINTER_IDLE_HIDE_MS);
};

const setupPointerActivityWatch = () => {
  if (typeof document === 'undefined') return;
  // 毎フレーム走るので、やるのはクラス付与とタイマー再設定だけに留める
  document.addEventListener('mousemove', notePointerActivity, { passive: true });
  document.addEventListener('mousedown', notePointerActivity, { passive: true });
};

// ── ズレ直し ────────────────────────────────────────────
// 歌詞のズレは、気づくのが歌詞を見ている時なのに、直すつまみは設定パネルの
// 奥にあった。同じ問題への答え(取得元を替える / ズレを直す)は同じ場所に
// 置く。値そのものは前からある config.syncOffset で、ここは入口だけ。
//
// 既定では曲が変わるとリセットされる(設定「曲が切り替わったときに
// オフセットをリセットしない」で変えられる)。曲ごとの手当てなので、
// 引きずらない方が既定として妥当。
const LYRIC_OFFSET_STEP_MS = 100;
const LYRIC_OFFSET_MAX_MS = 10000;

const formatLyricOffset = (ms) => {
  const sec = (Number(ms) || 0) / 1000;
  return `${sec > 0 ? '+' : ''}${sec.toFixed(1)}s`;
};

const refreshLyricOffsetUi = () => {
  if (!ui.uploadMenu) return;
  const el = ui.uploadMenu.querySelector('[data-role="offset-value"]');
  if (el) el.textContent = formatLyricOffset(config.syncOffset);
};

const applyLyricOffsetMs = (ms) => {
  const clamped = Math.max(-LYRIC_OFFSET_MAX_MS, Math.min(LYRIC_OFFSET_MAX_MS, Math.round(Number(ms) || 0)));
  config.syncOffset = clamped;
  refreshLyricOffsetUi();
  // 設定パネルを開いている時は、そちらの数値も合わせる
  const input = document.getElementById('sync-offset-input');
  if (input) input.valueAsNumber = clamped;
  void storage.set('ytm_sync_offset', clamped);
};

// 取得元バッジから歌詞メニューを開く。
// メニューは Lyrics ボタンにぶら下がっているので、その場で出すだけでよい。
const openLyricsMenu = () => {
  if (!ui.uploadMenu) return;
  refreshCandidateMenu();
  refreshLockMenu();
  refreshLyricOffsetUi();
  ui.uploadMenu.classList.add('visible');
};

// バッジは「⌄」を出している以上、押して開いたものは押して閉じられないと
// おかしい。開いている時に押しても閉じないのは、外側クリックで閉じる係が
// 捕捉段階(capture)で先に閉じ、その直後にここが開き直していたため。
// 閉じる係の方でバッジを除外し、開け閉ては全部ここが持つ。
const toggleLyricsMenu = () => {
  if (!ui.uploadMenu) return;
  if (ui.uploadMenu.classList.contains('visible')) {
    ui.uploadMenu.classList.remove('visible');
    hideCandidateHoverPreview();
    return;
  }
  openLyricsMenu();
};

function updateLyricsSourceDebugBadge(payload) {
  // この関数はテストで updateLyricsSourceState だけ切り出して実行されることがあり、
  // その文脈には YTMLog も document も無い。存在確認してから触る。
  if (typeof document === 'undefined' || !document.body) return;

  if (typeof YTMLog !== 'undefined' && YTMLog.enabled) {
    YTMLog.log('[CS] 歌詞ソース:', currentLyricsSource, payload?.sourceLabel || '');
  }
  // 取得元が分からない間は置かない
  if (!currentLyricsSource) {
    document.getElementById('ytm-lyrics-source-debug')?.remove();
    return;
  }

  let el = document.getElementById('ytm-lyrics-source-debug');
  if (!el) {
    el = createEl('div', 'ytm-lyrics-source-debug', '', '');
    // 押せるものになったので、読み上げからも隠さない
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    const open = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleLyricsMenu();
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') open(ev);
    });
    // ボタン列の真下に置く。押すと開くメニューもそこにぶら下がっているので、
    // 見つける場所と操作する場所が揃う。画面の隅だと歌詞からも操作系からも
    // 離れた孤立した位置になり、気づかれない。
    // ボタン列がまだ無い時は body に置いて、下の CSS で隅に固定する。
    if (ui.btnArea && ui.btnArea.parentNode) {
      el.classList.add('ytm-source-inline');
      ui.btnArea.insertAdjacentElement('afterend', el);
    } else {
      document.body.appendChild(el);
    }
  }
  // sourceLabel は background が付ける実際に当たった経路名
  // (例: 'LRCHub search' / 'LRCHub retry')。無ければ ID から引く。
  const label = (typeof payload?.sourceLabel === 'string' && payload.sourceLabel.trim())
    ? payload.sourceLabel.trim()
    : (LYRICS_SOURCE_LABELS[currentLyricsSource] || currentLyricsSource);

  let quality = 0;
  try {
    quality = selectLyricsPayload(payload).quality;
  } catch (e) { /* 品質が読めなくても取得元は出す */ }
  const qualityKey = LYRICS_QUALITY_LABEL_KEYS[quality] || '';

  el.dataset.sourceLabel = label;
  el.dataset.qualityKey = qualityKey;
  applyLyricsSourceBadgeText(el);
}

// 取得元の表示の文言。以前は「歌詞ソース:」と同期の粒度が日本語で固定だった。
// 表示言語を保存した時にも呼ぶ(取得元の名前と粒度は要素に持たせてある)。
function applyLyricsSourceBadgeText(el = document.getElementById('ytm-lyrics-source-debug')) {
  if (!el || !el.dataset.sourceLabel) return;
  const parts = [el.dataset.sourceLabel];
  if (el.dataset.qualityKey) parts.push(t(el.dataset.qualityKey));
  // 訳の出どころ(共有翻訳 / DeepL / Chrome 翻訳)。翻訳を出していない時は空。
  if (config.useTrans && el.dataset.translationEngines) {
    el.dataset.translationEngines.split(',').forEach(e => parts.push(t(`lyrics_trans_${e}`)));
  }
  el.textContent = `${t('lyrics_source_prefix')}: ${parts.join(' / ')}`;
  el.title = t('lyrics_source_hint');
}

function updateLyricsSourceState(payload, notify = true) {
  currentLyricsSource = String(payload?.lyricsSource || payload?.source || '').trim().toLowerCase() || null;
  if (typeof updateLyricsSourceDebugBadge === 'function') {
    updateLyricsSourceDebugBadge(payload);
  }
}

const hasCharacterSyncedLines = (value) => (
  Array.isArray(value) && value.some(line => (
    Array.isArray(line?.chars) &&
    line.chars.some(char => {
      const hasText = [char?.c, char?.char, char?.text, char?.caption, char?.value]
        .some(text => String(text ?? '').length > 0);
      const hasTime = [char?.t, char?.startTimeMs, char?.start_ms, char?.startMs, char?.time]
        .some(time => time !== null && time !== undefined &&
          !(typeof time === 'string' && !time.trim()) && Number.isFinite(Number(time)));
      return hasText && hasTime;
    })
  ))
);

// ── 歌詞どうしの突き合わせ(lyrics-agreement.js の写し) ─────────────
// 本体は background が使う ES module。ここは classic script なので import
// できない。中身は tests/lyrics-agreement.test.mjs が突き合わせている。
const LYRICS_AGREE_MIN = 0.7;
const COMPARE_CREDIT_LABELS = [
  '作詞', '作词', '作曲', '編曲', '编曲', '词曲', '詞曲', '词', '詞', '曲', '编', '編',
  '制作', '製作', '监制', '監製', '出品', '发行', '發行', '混音', '録音', '录音', '母带', '母帶',
  '和声', '和聲', '原唱', '翻唱', '演唱', '主唱', '歌手', '专辑', '專輯',
  'lyrics', 'lyricist', 'lyric', 'written', 'writer', 'music', 'composer', 'composed',
  'arranged', 'arranger', 'producer', 'produced', 'vocal', 'chorus', 'mixing', 'mastering',
];
const isCompareCreditLine = (line) => {
  const m = line.match(/^([^:：]{1,24})[:：]/);
  if (!m) return false;
  const label = m[1].normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return COMPARE_CREDIT_LABELS.some(known => label.includes(known));
};
const lyricTextForCompare = (lyrics) => String(lyrics ?? '')
  .split(/\r?\n/)
  .map(line => line.replace(/\[[^\]]*\]/g, '').replace(/<[^>]*>/g, '').trim()
    .replace(/^(?:v\d{1,4}|bg)\s*:\s*/i, ''))
  .filter(line => !isCompareCreditLine(line))
  .join('\n')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');
const lyricBigrams = (text) => {
  const chars = Array.from(text).slice(0, 20000);
  const set = new Set();
  for (let i = 0; i < chars.length - 1; i++) set.add(chars[i] + chars[i + 1]);
  return set;
};
const lyricsAgreement = (a, b) => {
  const A = lyricBigrams(lyricTextForCompare(a));
  const B = lyricBigrams(lyricTextForCompare(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return (2 * shared) / (A.size + B.size);
};

// 表示中の歌詞が、届いた歌詞と中身が違うか(別の曲・ローマ字・切れ端など)。
// background が他の取得元と突き合わせて「合っている」と判定した歌詞
// (agreement: 'confirmed')と食い違うなら、表示中の方が外れ。
// srv3 は本文の形が違うので比べない。
const displayedLyricsDisagreeWith = (selected) => {
  const shown = typeof lastRawLyricsText === 'string' ? lastRawLyricsText : '';
  if (!shown.trim() || !selected || selected.mode === 'animated') return false;
  if (document.body.classList.contains('ytm-animated-caption-mode')) return false;
  return lyricsAgreement(shown, selected.lyrics || selected.text) < LYRICS_AGREE_MIN;
};

const selectLyricsPayload = (payload) => {
  const lyrics = typeof payload?.lyrics === 'string' ? payload.lyrics : '';
  const animatedLyrics = typeof payload?.animated_lyrics === 'string' ? payload.animated_lyrics : '';
  const availableDynamicLines = hasCharacterSyncedLines(payload?.dynamicLines)
    ? payload.dynamicLines
    : null;
  // 「アニメーション歌詞」は LRCHub の srv3 (animated_lyrics)。設定が ON の
  // ときは同じレコードに DynamicLRC があっても srv3 を明示的に選ぶ。
  const useAnimated = !!config.useAnimatedCaptions && !!animatedLyrics.trim();
  const nextDynamicLines = useAnimated ? null : availableDynamicLines;
  const mode = useAnimated
    ? 'animated'
    : (nextDynamicLines
      ? 'dynamic'
      : (/\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics) ? 'synced' : (lyrics.trim() ? 'plain' : 'none')));
  const quality = useAnimated
    ? 4
    : (nextDynamicLines
      ? 3
      : (/\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics) ? 2 : (lyrics.trim() ? 1 : 0)));
  return {
    text: useAnimated ? animatedLyrics : lyrics,
    lyrics,
    animatedLyrics,
    dynamicLines: nextDynamicLines,
    mode,
    quality,
  };
};

async function applyLateLyricsUpgrade(payload) {
  // 'ytm' も受ける。YouTube Music 側は時刻なしの歌詞を先に返しておいて、
  // 裏で同期版を探し当てたらここで差し替えにくる。
  // 差し替えてよいのは単語同期を返せる取得元だけ。LrcLib は入れない。
  // 行同期止まりなので、暫定表示を格上げする側ではなく常に格下げされる側だから。
  // (配列をここに直書きしているのは、この関数がテストで単体切り出しされ、
  //  外側の定数が存在しない文脈で実行されるため)
  const lateSource = payload && payload.lyricsSource;
  // background が「表示中の歌詞は他の取得元と合わない」と判断して送ってきた訂正。
  // 品質が下がっても(単語同期 → 行同期でも)替える。間違った歌詞より正しい
  // 行同期の方がいい。訂正の相手が、いま表示している取得元の時だけ受ける
  // (YouTube Music を出している時に、background が出した別の歌詞の訂正で
  //  上書きしないため)。LrcLib への訂正もここだけは受ける。
  const shownSource = typeof currentLyricsSource !== 'undefined' ? currentLyricsSource : null;
  const isCorrection = !!(payload && payload.correction === true &&
    (!payload.replaces || payload.replaces === shownSource));
  const upgradableSources = [
    'lrchub', 'ytm', 'simpmusic', 'lyricsplus',
    // extra-providers.js の取得元。ここに足し忘れると、background が
    // 単語同期を届けても UI 側が黙って捨てる。
    'amll', 'netease', 'kugou', 'liriqo', 'buaaa',
  ];
  if (!payload || !payload.success) return;
  if (!upgradableSources.includes(lateSource) && !(isCorrection && lateSource === 'lrclib')) return;
  if (!currentKey || payload.track_key !== currentKey) return;
  if (!activeLyricsRequestId || payload.request_id !== activeLyricsRequestId) return;
  if (payload.video_id && currentLyricsVideoId && payload.video_id !== currentLyricsVideoId) return;
  // A manual candidate choice is an explicit user decision; never replace it
  // with a request that started before that choice.
  if (selectedCandidateId || currentLyricsResultPriority >= 3) return;
  const selected = selectLyricsPayload(payload);
  if (!selected.text || !selected.text.trim()) return;
  // YTM優先で選ばれた通常歌詞へ別ソースを割り込ませない。ただし設定で
  // 要求された srv3 は通常の行同期とは異なる表示モードなので差し替える。
  // typeof は、この関数を単体切り出しするテスト環境向け。
  if (
    typeof currentLyricsFromPreferredYtm !== 'undefined' &&
    currentLyricsFromPreferredYtm &&
    selected.mode !== 'animated'
  ) return;
  // 他の取得元が裏付けた歌詞が、表示中のものと中身が違う時も訂正として扱う
  // (表示中のものがキャッシュや、以前の取得で出た外れのことがある)。
  const replacesWrong = isCorrection || (
    payload.agreement === 'confirmed' &&
    typeof displayedLyricsDisagreeWith === 'function' && displayedLyricsDisagreeWith(selected)
  );
  if (currentLyricsResultPriority === 2 && selected.quality <= currentLyricsQuality && !replacesWrong) return;
  const requestId = activeLyricsRequestId;
  const targetKey = currentKey;
  const targetVideoId = currentLyricsVideoId;
  currentLyricsResultPriority = 2;
  currentLyricsQuality = selected.quality;

  // 遅れて届いた差し替え(特に YouTube Music)には候補一覧・requests・config・
  // 翻訳が入っていない。無条件に代入すると、LrcLib で暫定表示していた時の
  // 候補メニューが丸ごと消える。loadLyrics と同じく「あれば更新」に揃える。
  if (Array.isArray(payload.candidates) && payload.candidates.length) lyricsCandidates = payload.candidates;
  if (Array.isArray(payload.requests)) lyricsRequests = payload.requests;
  if (payload.config) lyricsConfig = payload.config;
  lyricsTranslationMap = {
    ...(lyricsTranslationMap || {}),
    ...normalizeTranslationsToLrcMapLocal(payload.translations),
    ...normalizeTranslationsToLrcMapLocal(payload.lrcMap),
  };
  dynamicLines = selected.dynamicLines;
  duetSubLyricsRaw = typeof payload.subLyrics === 'string' ? payload.subLyrics : '';
  duetSubDynamicLines = null;
  _duetExcludedTimes = new Set();
  selectedCandidateId = null;
  setLyricsMeaningData(payload);
  syncLyricsLockState();
  refreshCandidateMenu();
  refreshLockMenu();

  const isCurrent = () => (
    requestId === activeLyricsRequestId &&
    targetKey === currentKey &&
    targetVideoId === currentLyricsVideoId &&
    currentLyricsResultPriority === 2 &&
    currentLyricsQuality === selected.quality
  );
  void requestSingerMetadataForLyrics(
    payload.record_id,
    selected.lyrics || selected.text,
    { trackKey: targetKey, videoId: targetVideoId }
  );
  await applyLyricsText(selected.text);
  if (!isCurrent()) return;
  updateLyricsSourceState(payload, false);
  clearLyricsLateRetry(targetKey);

  // Cache writes from the initial fallback callback and the late LRCHub event
  // share one queue, so the higher-priority LRCHub record always lands last.
  try {
    await enqueueLyricsCacheWrite(
      targetKey,
      async () => {
        const existing = await storage.get(targetKey);
        const existingRecord = existing && typeof existing === 'object' ? existing : {};
        return {
          ...existingRecord,
          cacheVersion: LYRICS_CACHE_VERSION,
          video_id: targetVideoId || payload.video_id || null,
          record_id: payload.record_id || null,
          lyrics: selected.lyrics || selected.text,
          animated_lyrics: selected.animatedLyrics || null,
          dynamicLines: selected.dynamicLines || null,
          noLyrics: false,
          subLyrics: duetSubLyricsRaw,
          meaningData: lyricsMeaning || null,
          candidates: LyricsCache.stripCandidateLyrics(lyricsCandidates) || null,
          lrcMap: lyricsTranslationMap || null,
          requests: lyricsRequests || null,
          config: lyricsConfig || null,
          lockState: lyricsLockState || null,
          lyricsSource: lateSource,
          sourceLabel: payload.sourceLabel || null,
          fetchedAt: Date.now(),
          fallbackUsed: false,
          lyricsQuality: selected.quality,
          offset_ms: Number.isFinite(Number(payload.offset_ms)) ? Number(payload.offset_ms) : 0,
        };
      },
      isCurrent
    );
  } catch (error) {
    console.warn('[YTM] Failed to cache late LRCHub lyrics:', error);
  }
}

const parseMeaningTimeToSecLocal = (value) => {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value > 10000 ? value / 1000 : value;
  }
  const s = String(value || '').trim();
  const m = s.match(/^(\d+):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!m) return null;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  let frac = m[3] || '0';
  if (frac.length === 1) frac += '00';
  else if (frac.length === 2) frac += '0';
  const ms = Number(frac.slice(0, 3));
  if (!Number.isFinite(min) || !Number.isFinite(sec) || !Number.isFinite(ms)) return null;
  return (min * 60) + sec + (ms / 1000);
};

const formatMeaningTimeLocal = (seconds) => {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '';
  const total = Math.max(0, seconds);
  const min = Math.floor(total / 60);
  const sec = Math.floor(total - min * 60);
  const cs = Math.floor((total - min * 60 - sec) * 100);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
};

const normalizeMeaningStringListLocal = (value) => {
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,\n]/).map(v => v.trim()).filter(Boolean);
  return [];
};

const normalizeMeaningSourceLocal = (payload) => {
  if (!payload) return null;
  if (Array.isArray(payload)) return { explanations: payload };
  if (typeof payload !== 'object') return null;

  const rawMeaningData = payload.meaningData;
  if (!rawMeaningData) return payload;

  const meaningData = Array.isArray(rawMeaningData)
    ? { explanations: rawMeaningData }
    : (typeof rawMeaningData === 'object' ? rawMeaningData : {});

  return {
    ...payload,
    ...meaningData,
    explanations: Array.isArray(meaningData.explanations)
      ? meaningData.explanations
      : (Array.isArray(payload.explanations) ? payload.explanations : []),
    timeline_meanings: Array.isArray(meaningData.timeline_meanings)
      ? meaningData.timeline_meanings
      : (Array.isArray(payload.timeline_meanings) ? payload.timeline_meanings : []),
    song_summary: meaningData.song_summary || meaningData.songSummary || payload.song_summary || payload.songSummary || null,
    final_summary: meaningData.final_summary || payload.final_summary || null,
    comments: Array.isArray(meaningData.comments) ? meaningData.comments : (Array.isArray(payload.comments) ? payload.comments : []),
    rating: meaningData.rating || payload.rating || null,
  };
};

const normalizeMeaningCommentsLocal = (comments) => {
  if (!Array.isArray(comments)) return [];
  return comments
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const body = String(item.body || item.comment || item.text || '').trim();
      if (!body) return null;
      return {
        body,
        contributorName: String(item.contributor_name || item.contributorName || item.user || item.name || '').trim(),
        createdAt: String(item.created_at || item.createdAt || '').trim(),
      };
    })
    .filter(Boolean);
};

const normalizeMeaningRatingLocal = (rating) => {
  if (!rating || typeof rating !== 'object') return null;
  const average = Number(rating.average ?? rating.avg ?? rating.score);
  const count = Number(rating.count ?? rating.total ?? rating.votes);
  const hasAverage = Number.isFinite(average);
  const hasCount = Number.isFinite(count);
  if (!hasAverage && !hasCount) return null;
  return {
    average: hasAverage ? average : null,
    count: hasCount ? count : null,
  };
};

const normalizeMeaningPayloadLocal = (payload) => {
  const source = normalizeMeaningSourceLocal(payload);
  if (!source || typeof source !== 'object') return null;

  // Handle new LRCHub "explanations" format
  const rawTimeline = Array.isArray(source.explanations) ? source.explanations : (Array.isArray(source.timeline_meanings) ? source.timeline_meanings : []);

  const timeline = rawTimeline
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      // Map from either new LRCHub spec or old spec
      const startRaw = String(item.start_time || item.start || '').trim();
      const endRaw = String(item.end_time || item.end || '').trim();

      const startSec = (typeof item.start_ms === 'number') ? item.start_ms / 1000 : parseMeaningTimeToSecLocal(item.start_sec ?? item.startSec ?? startRaw);
      const endSec = (typeof item.end_ms === 'number') ? item.end_ms / 1000 : parseMeaningTimeToSecLocal(item.end_sec ?? item.endSec ?? endRaw);
      const start = startRaw || formatMeaningTimeLocal(startSec);
      const end = endRaw || formatMeaningTimeLocal(endSec);

      return {
        start,
        end,
        startSec,
        endSec,
        label: String(item.lyrics || item.label || item.text || '').trim(),
        summary: String(item.summary || item.synopsis || '').trim(),
        detail: String(item.meaning || item.detail || item.explanation || item.description || '').trim(),
        emotion: normalizeMeaningStringListLocal(item.emotion || item.emotions || item.mood),
        keywords: normalizeMeaningStringListLocal(item.keywords || item.keyword),
      };
    })
    .filter(item => item && (item.label || item.summary || item.detail));

  const songSummaryRaw = source.song_summary && typeof source.song_summary === 'object'
    ? source.song_summary
    : (source.songSummary && typeof source.songSummary === 'object' ? source.songSummary : {});
  const finalSummaryRaw = source.final_summary && typeof source.final_summary === 'object'
    ? source.final_summary
    : {};
  const synopsis = String(songSummaryRaw.synopsis || finalSummaryRaw.synopsis || '').trim();
  const message = String(songSummaryRaw.message || finalSummaryRaw.message || '').trim();
  const summaryText = String(songSummaryRaw.summary || finalSummaryRaw.summary || '').trim();
  const longSummaryParts = [synopsis, message, summaryText].filter(Boolean);
  const finalSummary = {
    short: String(finalSummaryRaw.short || synopsis || message || summaryText || '').trim(),
    long: String(finalSummaryRaw.long || longSummaryParts.join('\n\n') || finalSummaryRaw.short || '').trim(),
  };
  const comments = normalizeMeaningCommentsLocal(source.comments);
  const rating = normalizeMeaningRatingLocal(source.rating);

  if (!timeline.length && !finalSummary.short && !finalSummary.long && !comments.length && !rating) return null;

  return {
    title: String(source.display_name || source.title || source.track || '').trim(),
    timeline_meanings: timeline,
    final_summary: finalSummary,
    song_summary: { synopsis, message, summary: summaryText },
    comments,
    rating,
  };
};

const parseMeaningPayloadTextLocal = (text) => {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  if (!raw) return null;

  const candidates = [raw];
  const fenced = raw.match(/```(?:json|txt|text)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) candidates.push(fenced[1].trim());
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1).trim());
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate);
      const normalized = normalizeMeaningPayloadLocal(parsed);
      if (normalized) return normalized;
    } catch (e) {
    }
  }

  return null;
};

const getMeaningSegments = () => (
  lyricsMeaning && Array.isArray(lyricsMeaning.timeline_meanings)
    ? lyricsMeaning.timeline_meanings
    : []
);

// video の時刻を曲内ローカル時間に直す。
//
// timeOffset(この曲が始まった video 時間)を書き換えるのは
//   ・曲が変わった時の tick
//   ・巻き戻りを見つけた rAF ループ
//   ・シーク(seeked)
// の 3 箇所だけ。表示のために時刻を読むだけの経路がついでに書き換えると、
// どこで値が変わったのか追えなくなる。ここでは読むだけ。
const toLocalPlaybackTime = (rawTime) => {
  // offset を下回っているなら、その曲は頭から掛け直されている
  const offset = (timeOffset > 0 && rawTime < timeOffset) ? 0 : timeOffset;
  return Math.max(0, rawTime - offset);
};

// ── 動画モードの時刻合わせ(MV ⇔ 音源) ─────────────────────
// 歌詞の時刻は音源(曲)の時刻。MV はイントロや途中の映像パートの分だけずれる
// (NewJeans「Ditto」は 82 秒)。ログイン中は YTM が「音源の何秒が MV の何秒か」の
// 対応表を持っているので(ytm-lyrics.js の YTMSegmentMap)、動画モードの間はそれで
// 直す。表が無い時(未ログイン・対応の無い動画)は今まで通り直さない。
// 表のどの区間にも入らない MV の時刻は、歌以外の場面(ドラマのパート等)。
const MOVIE_SEGMENT_EDGE = 0.05;
const MOVIE_ID_RECHECK_MS = 500;
let _movieSegState = { at: 0, videoId: null, segments: null };
const currentMovieSegments = () => {
  if (typeof YTMSegmentMap === 'undefined' || moviemode !== true) return null;
  const now = performance.now();
  const st = _movieSegState;
  if (now - st.at >= MOVIE_ID_RECHECK_MS || (st.videoId && st.segments === undefined)) {
    st.at = now;
    const id = getCurrentVideoId();
    if (id !== st.videoId) { st.videoId = id; st.segments = undefined; _movieSkipTarget = -1; }
    if (id && st.segments === undefined) {
      const known = YTMSegmentMap.peek(id);
      if (known !== undefined) st.segments = known;
      else YTMSegmentMap.fetch(id);
    }
  }
  return st.segments || null;
};
// MV の時刻 → 音源の時刻。cut は歌以外の場面、next はその後の最初の区間
const movieToSongTime = (tv, segs) => {
  for (const s of segs) {
    if (tv >= s.videoStart - MOVIE_SEGMENT_EDGE && tv < s.videoStart + s.dur + MOVIE_SEGMENT_EDGE) {
      return { time: Math.max(0, s.songStart + (tv - s.videoStart)), cut: false, next: null };
    }
  }
  const next = segs.find(s => s.videoStart > tv) || null;
  const last = segs[segs.length - 1];
  // 歌以外の場面では、その後に歌い出す所の手前で止めておく(行は光らせない)
  const time = next ? Math.max(0, next.songStart - 0.01) : last.songStart + last.dur;
  return { time, cut: true, next };
};
// 動画モードの歌詞は、MV ではなく音源(曲版)で引く。歌詞サーバーに MV の videoId と
// MV の長さを送ると、長さで照合する取得元は「歌詞が曲の長さに足りない」と弾き、
// videoId で引く取得元は MV の登録が無くて外れ、曲モードより同期歌詞がずっと少なかった。
// 音源の時刻の歌詞は上の対応表で MV の時刻に直して出すので、表がある時だけ寄せる
// (表が無いと音源の時刻のまま MV に当たってずれる)。返すのは { videoId, title, durationSec }。
const MOVIE_SONG_WAIT_MS = 1500;
const isMoviePlaybackNow = () => moviemode === true
  || document.querySelector('ytmusic-av-toggle')?.getAttribute('playback-mode') === 'OMV_PREFERRED';
const resolveMovieLookupSong = async (videoId) => {
  if (!videoId || typeof YTMSegmentMap === 'undefined' || !YTMSegmentMap.song || !isMoviePlaybackNow()) return null;
  const song = await Promise.race([
    YTMSegmentMap.song(videoId).catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), MOVIE_SONG_WAIT_MS)),
  ]);
  return song && YTMSegmentMap.peek(videoId) ? song : null;
};
// 音源の時刻 → MV の時刻(歌詞の行を押してシークする時)
const songToMovieTime = (ts, segs) => {
  let best = segs[0];
  let bestDist = Infinity;
  for (const s of segs) {
    if (ts >= s.songStart && ts < s.songStart + s.dur) return s.videoStart + (ts - s.songStart);
    const d = ts < s.songStart ? s.songStart - ts : ts - (s.songStart + s.dur);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return best.videoStart + (ts - best.songStart);
};
// 歌以外の場面を飛ばす(設定、既定 切)。同じ場面で何度も飛ばさないよう、飛んだ先を覚える
let _movieSkipTarget = -1;
const applyMovieTime = (tv, v) => {
  const segs = currentMovieSegments();
  if (!segs) {
    document.body.classList.remove('ytm-movie-cut');
    return tv;
  }
  const m = movieToSongTime(tv, segs);
  document.body.classList.toggle('ytm-movie-cut', m.cut);
  if (m.cut && config.movieSkipScenes && v && !v.paused && m.next && _movieSkipTarget !== m.next.videoStart) {
    _movieSkipTarget = m.next.videoStart;
    try { v.currentTime = m.next.videoStart; } catch (e) { /* 飛ばせなければそのまま見る */ }
  }
  return m.time;
};

const getCurrentPlaybackTimeSec = () => {
  const v = document.querySelector('video');
  if (!v || typeof v.currentTime !== 'number' || Number.isNaN(v.currentTime)) return null;
  let t = toLocalPlaybackTime(v.currentTime);
  const segs = currentMovieSegments();
  if (segs) t = movieToSongTime(t, segs).time;
  const duration = Number.isFinite(v.duration) ? v.duration : null;
  t = Math.max(0, t + (config.syncOffset / 1000));
  if (typeof duration === 'number' && duration > 0) {
    t = Math.min(t, duration);
  }
  return t;
};

// 歌詞の時刻(曲内)へシークする。歌詞は「曲内の時刻 + ズレ直し」で
// 光らせている(getCurrentPlaybackTimeSec)ので、押した行がちょうど光る
// 位置へ飛ぶには、ズレ直しのぶんを引いて video の時刻に戻す。
// 以前は引いていなかったので、ズレ直しをした後に行を押すと、直す前の
// タイムスタンプへ飛んでいた(+1.0s なら押した行より 1 秒先が光る)。
// 歌詞の時刻 → 今の動画(videoId)の頭からの秒。歌詞カードの共有リンク(&t=)にも使う
const lyricTimeToVideoTime = (lyricTime) => {
  let local = Math.max(0, lyricTime - (Number(config.syncOffset) || 0) / 1000);
  // 動画モードで対応表がある時は、音源の時刻を MV の時刻に直す
  const segs = currentMovieSegments();
  if (segs) local = songToMovieTime(local, segs);
  return local;
};
const seekToLyricTime = (lyricTime) => {
  const v = document.querySelector('video');
  if (!v || !Number.isFinite(lyricTime)) return;
  // 連続再生では video の時刻が曲の頭で 0 に戻らないので、曲の始まり(timeOffset)を足す
  v.currentTime = lyricTimeToVideoTime(lyricTime) + timeOffset;
};

const findMeaningIndexByTime = (timeSec) => {
  const segments = getMeaningSegments();
  if (!segments.length) return -1;
  if (typeof timeSec !== 'number' || Number.isNaN(timeSec)) return 0;

  let fallbackIndex = 0;
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const startSec = typeof segment.startSec === 'number' ? segment.startSec : null;
    const endSec = typeof segment.endSec === 'number' ? segment.endSec : null;

    if (startSec != null && timeSec + 0.12 >= startSec) {
      fallbackIndex = i;
    }
    if ((startSec == null || timeSec + 0.12 >= startSec) &&
      (endSec == null || timeSec <= endSec + 0.12)) {
      return i;
    }
    if (startSec != null && timeSec < startSec) {
      break;
    }
  }

  return fallbackIndex;
};

const resolveMeaningIndex = (preferredTime = null) => {
  const segments = getMeaningSegments();
  if (!segments.length) return -1;
  if (typeof preferredTime === 'number' && !Number.isNaN(preferredTime)) {
    return findMeaningIndexByTime(preferredTime);
  }
  if (lastActiveIndex >= 0 && lyricsData[lastActiveIndex] && typeof lyricsData[lastActiveIndex].time === 'number') {
    return findMeaningIndexByTime(lyricsData[lastActiveIndex].time);
  }
  const now = getCurrentPlaybackTimeSec();
  if (typeof now === 'number') return findMeaningIndexByTime(now);
  return 0;
};

const buildMeaningChipGroup = (label, values, kind) => {
  if (!Array.isArray(values) || !values.length) return '';
  const chips = values.map((value) => `<span class="ytm-meaning-chip ${kind}">${escapeHtml(value)}</span>`).join('');
  return `<div class="ytm-meaning-chip-group"><div class="ytm-meaning-chip-label">${escapeHtml(label)}</div><div class="ytm-meaning-chip-list">${chips}</div></div>`;
};

const buildMeaningRatingHtml = () => {
  const rating = lyricsMeaning && lyricsMeaning.rating;
  if (!rating) return '';
  const average = typeof rating.average === 'number' ? rating.average.toFixed(1) : '--';
  const count = typeof rating.count === 'number' ? `${rating.count}件` : '';
  return `<div class="ytm-meaning-rating"><span>★ ${escapeHtml(average)}</span>${count ? `<span>${escapeHtml(count)}</span>` : ''}</div>`;
};

const buildMeaningSummarySectionsHtml = () => {
  const summary = (lyricsMeaning && lyricsMeaning.song_summary) || {};
  const sections = [
    ['あらすじ', summary.synopsis],
    ['メッセージ', summary.message],
    ['まとめ', summary.summary],
  ].filter(([, text]) => String(text || '').trim());

  return sections.map(([label, text]) => `
      <section class="ytm-meaning-summary-section">
        <div class="ytm-meaning-summary-section-label">${escapeHtml(label)}</div>
        <p>${escapeHtml(text)}</p>
      </section>
    `).join('');
};

const buildMeaningCommentsHtml = () => {
  const comments = lyricsMeaning && Array.isArray(lyricsMeaning.comments) ? lyricsMeaning.comments : [];
  if (!comments.length) return '';
  const items = comments.slice(0, 5).map((comment) => {
    const meta = [comment.contributorName, comment.createdAt].filter(Boolean).join(' / ');
    return `
        <div class="ytm-meaning-comment">
          <p>${escapeHtml(comment.body)}</p>
          ${meta ? `<div class="ytm-meaning-comment-meta">${escapeHtml(meta)}</div>` : ''}
        </div>
      `;
  }).join('');
  return `
      <section class="ytm-meaning-comments">
        <div class="ytm-meaning-summary-section-label">コメント</div>
        ${items}
      </section>
    `;
};

const getMeaningDisplayTitle = () => {
  const raw = (lyricsMeaning && lyricsMeaning.title) || ui.title?.textContent || 'Song Meaning';
  return String(raw || 'Song Meaning').trim();
};

function hideMeaningSummaryPopup() {
  if (ui.meaningSummaryBackdrop) ui.meaningSummaryBackdrop.classList.remove('visible');
  if (ui.meaningSummaryDialog) ui.meaningSummaryDialog.classList.remove('visible');
}

let summaryButtonAttentionTimer = null;
let summaryButtonAttentionKey = null;
const MEANING_ALWAYS_SHOW_KEY = 'ytm_meaning_always_show';
// 「設定をリセット」で消すキー。ここに挙げたものだけを消す。
// 再生履歴(ytm_local_history)・歌詞キャッシュ("曲名///アーティスト")・
// クラウドの復活の呪文・解説のピン留めは設定ではないので入れない。
const SETTINGS_STORAGE_KEYS = [
  'ytm_deepl_key',
  'ytm_trans_enabled',
  'ytm_shared_trans_enabled',
  'ytm_left_align',
  'ytm_keep_past_lyrics',
  'ytm_lyric_stagger',
  'ytm_fade_past_lyrics',
  'ytm_prefer_song_mode',
  'ytm_level_volume',
  'ytm_video_quality',
  'ytm_movie_lyrics',
  'ytm_movie_skip_scenes',
  'ytm_movie_letterbox', // 廃止した「黒帯を光で埋める」。残っている値をリセットで消す
  'ytm_apple_bg',
  'ytm_low_cpu_mode',
  'ytm_apple_sync_style',
  'ytm_animated_captions_enabled',
  'ytm_singer_colors_enabled',
  'ytm_lrclib_fallback',
  'ytm_meaning_always_show',
  'ytm_main_lang',
  'ytm_sub_lang',
  'ytm_ui_lang',
  'ytm_lyric_weight',
  'ytm_bg_brightness',
  'ytm_ui_scale',
  'ytm_sync_offset',
  'ytm_save_sync_offset',
  'ytm_lyric_source_mode',
  'ytm_disabled_lyric_sources',
  'ytm_queue_pinned',
  'ytm_pip_auto_open',
  'ytm_bar_autohide',
  'ytm_korean_ruby',
];
const MEANING_PINNED_SONGS_KEY = 'ytm_meaning_pinned_songs';
let meaningPinnedSongs = new Set();
let meaningPreferencesPromise = null;
let meaningHoverTimer = null;
let meaningHoverHideTimer = null;
let meaningHoverVisible = false;
let meaningHoverIndex = -1;
let meaningVisibleBeforeHover = false;

function emphasizeSummaryButtonAfterLyricsLoad() {
  if (!ui.summaryBtn || !lyricsMeaning || !currentKey || summaryButtonAttentionKey === currentKey) return;
  summaryButtonAttentionKey = currentKey;
  if (summaryButtonAttentionTimer) clearTimeout(summaryButtonAttentionTimer);
  ui.summaryBtn.classList.add('ytm-summary-attention');
  summaryButtonAttentionTimer = setTimeout(() => {
    summaryButtonAttentionTimer = null;
    if (ui.summaryBtn) ui.summaryBtn.classList.remove('ytm-summary-attention');
  }, 3000);
}

function getMeaningPinMode() {
  if (config.alwaysShowMeaning) return 'global';
  if (currentKey && meaningPinnedSongs.has(currentKey)) return 'song';
  return 'off';
}

function isMeaningPersistentlyVisible() {
  return getMeaningPinMode() !== 'off';
}

async function ensureMeaningDisplayPreferences() {
  if (meaningPreferencesPromise) return meaningPreferencesPromise;
  meaningPreferencesPromise = Promise.all([
    storage.get(MEANING_ALWAYS_SHOW_KEY),
    storage.get(MEANING_PINNED_SONGS_KEY)
  ]).then(([alwaysShow, pinnedSongs]) => {
    config.alwaysShowMeaning = !!alwaysShow;
    meaningPinnedSongs = new Set(
      Array.isArray(pinnedSongs) ? pinnedSongs.filter(key => typeof key === 'string' && key) : []
    );
  });
  return meaningPreferencesPromise;
}

async function persistMeaningDisplayPreferences() {
  await Promise.all([
    storage.set(MEANING_ALWAYS_SHOW_KEY, !!config.alwaysShowMeaning),
    storage.set(MEANING_PINNED_SONGS_KEY, Array.from(meaningPinnedSongs))
  ]);
}

function clearMeaningHoverTimers() {
  if (meaningHoverTimer) clearTimeout(meaningHoverTimer);
  if (meaningHoverHideTimer) clearTimeout(meaningHoverHideTimer);
  meaningHoverTimer = null;
  meaningHoverHideTimer = null;
}

function hideTransientMeaningPanel() {
  if (!meaningHoverVisible) return;
  meaningHoverVisible = false;
  meaningHoverIndex = -1;
  if (isMeaningPersistentlyVisible() || meaningVisibleBeforeHover) {
    meaningPanelVisible = true;
    syncMeaningPanelToPlayback(true);
  } else {
    meaningPanelVisible = false;
    if (ui.meaningPanel) ui.meaningPanel.classList.remove('active');
    if (ui.meaningBtn) ui.meaningBtn.classList.remove('active');
  }
  meaningVisibleBeforeHover = false;
}

function scheduleMeaningHoverHide() {
  if (meaningHoverHideTimer) clearTimeout(meaningHoverHideTimer);
  meaningHoverHideTimer = setTimeout(() => {
    meaningHoverHideTimer = null;
    if (ui.meaningPanel?.matches(':hover')) return;
    hideTransientMeaningPanel();
  }, 900);
}

function startMeaningHover(line) {
  clearMeaningHoverTimers();
  if (!lyricsMeaning || !line || typeof line.time !== 'number') return;
  const nextIndex = findMeaningIndexByTime(line.time);
  if (nextIndex < 0) return;
  meaningHoverTimer = setTimeout(() => {
    meaningHoverTimer = null;
    meaningVisibleBeforeHover = meaningPanelVisible;
    meaningHoverVisible = true;
    meaningHoverIndex = nextIndex;
    meaningPanelVisible = true;
    if (ui.meaningPanel) ui.meaningPanel.classList.add('active');
    if (ui.meaningBtn) ui.meaningBtn.classList.add('active');
    renderMeaningPanel(nextIndex);
  }, 1000);
}

function setupMeaningPanelHoverEvents() {
  if (!ui.meaningPanel || ui.meaningPanel.dataset.hoverMeaningSetup === '1') return;
  ui.meaningPanel.dataset.hoverMeaningSetup = '1';
  ui.meaningPanel.addEventListener('mouseenter', () => {
    if (meaningHoverHideTimer) clearTimeout(meaningHoverHideTimer);
    meaningHoverHideTimer = null;
  });
  ui.meaningPanel.addEventListener('mouseleave', () => {
    if (meaningHoverVisible) scheduleMeaningHoverHide();
  });
}

async function cycleMeaningPinMode() {
  if (!lyricsMeaning || !currentKey) return;
  const currentMode = getMeaningPinMode();
  let nextMode = 'off';

  if (currentMode === 'off') {
    meaningPinnedSongs.add(currentKey);
    config.alwaysShowMeaning = false;
    nextMode = 'song';
  } else if (currentMode === 'song') {
    meaningPinnedSongs.delete(currentKey);
    config.alwaysShowMeaning = true;
    nextMode = 'global';
  } else {
    config.alwaysShowMeaning = false;
    meaningPinnedSongs.delete(currentKey);
  }

  await persistMeaningDisplayPreferences();
  const alwaysToggle = document.getElementById('meaning-always-toggle');
  if (alwaysToggle) alwaysToggle.checked = !!config.alwaysShowMeaning;
  clearMeaningHoverTimers();
  meaningHoverVisible = false;
  meaningHoverIndex = -1;
  meaningVisibleBeforeHover = false;

  if (nextMode === 'off') {
    toggleMeaningPanel(false);
    showToast('解説を非表示にしました');
    return;
  }

  meaningPanelVisible = true;
  if (ui.meaningPanel) ui.meaningPanel.classList.add('active');
  renderMeaningPanel(resolveMeaningIndex());
  if (ui.meaningBtn) ui.meaningBtn.classList.add('active');
  showToast(nextMode === 'song' ? 'この曲で解説を固定表示します' : '対応曲すべてで解説を表示します');
}

function ensureMeaningSummaryDialog() {
  if (ui.meaningSummaryBackdrop && ui.meaningSummaryDialog) return;

  const backdrop = createEl('div', 'ytm-meaning-summary-backdrop', 'ytm-meaning-summary-backdrop');
  const dialog = createEl('div', 'ytm-meaning-summary-dialog', 'ytm-meaning-summary-dialog');
  backdrop.appendChild(dialog);
  backdrop.addEventListener('click', (ev) => {
    if (ev.target === backdrop) hideMeaningSummaryPopup();
  });
  document.body.appendChild(backdrop);
  ui.meaningSummaryBackdrop = backdrop;
  ui.meaningSummaryDialog = dialog;

  if (!meaningSummaryGlobalSetup) {
    meaningSummaryGlobalSetup = true;
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') hideMeaningSummaryPopup();
    });
  }
}

function buildMeaningPanelActionsHtml() {
  const pinMode = getMeaningPinMode();
  const pinLabel = pinMode === 'off'
    ? 'この曲で表示'
    : (pinMode === 'song' ? 'すべての対応曲で表示' : '固定を解除して非表示');
  return `
    <div class="ytm-meaning-panel-actions">
      <button class="ytm-meaning-pin-btn is-${pinMode}" type="button" aria-label="${pinLabel}" title="${pinLabel}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v2l1.5 5 3 3v2H13v6l-1 1-1-1v-6H5.5v-2l3-3L10 5V3h4Z"/></svg>
      </button>
      <button class="ytm-meaning-close-btn ytm-unified-close-btn size-36" type="button" aria-label="Close"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
  `;
}

function renderMeaningPanel(index = null) {
  if (!ui.meaningPanel) return;

  const normalizedIndex = typeof index === 'number' ? index : resolveMeaningIndex();
  const segments = getMeaningSegments();
  const segment = normalizedIndex >= 0 ? segments[normalizedIndex] : null;
  const summary = lyricsMeaning && lyricsMeaning.final_summary ? lyricsMeaning.final_summary : { short: '', long: '' };

  if (!lyricsMeaning) {
    ui.meaningPanel.innerHTML = '';
    ui.meaningPanel.classList.remove('active');
    activeMeaningIndex = -1;
    return;
  }

  if (!segment) {
    const fallbackText = summary.long || summary.short || 'この曲の解説データはまだありません。';
    ui.meaningPanel.innerHTML = `
        <div class="ytm-meaning-panel-head">
          <div>
            <div class="ytm-meaning-panel-eyebrow">歌詞解説</div>
          </div>
          ${buildMeaningPanelActionsHtml()}
        </div>
        <div class="ytm-meaning-panel-body">
          <p class="ytm-meaning-panel-text">${escapeHtml(fallbackText)}</p>
          ${buildMeaningSummarySectionsHtml()}
          ${buildMeaningRatingHtml()}
          ${buildMeaningCommentsHtml()}
        </div>
      `;
    activeMeaningIndex = -1;
  } else {
    ui.meaningPanel.innerHTML = `
        <div class="ytm-meaning-panel-head">
          <div>
            <div class="ytm-meaning-panel-eyebrow">歌詞解説</div>
            <div class="ytm-meaning-panel-range">${escapeHtml(segment.start || '--:--')} - ${escapeHtml(segment.end || '--:--')}</div>
          </div>
          ${buildMeaningPanelActionsHtml()}
        </div>
        <div class="ytm-meaning-panel-body">
          ${segment.summary ? `<p class="ytm-meaning-panel-summary">${escapeHtml(segment.summary)}</p>` : ''}
          ${segment.detail ? `<p class="ytm-meaning-panel-text">${escapeHtml(segment.detail)}</p>` : ''}
          ${buildMeaningChipGroup('感情', segment.emotion, 'emotion')}
          ${buildMeaningChipGroup('キーワード', segment.keywords, 'keyword')}
          ${buildMeaningRatingHtml()}
        </div>
      `;
    activeMeaningIndex = normalizedIndex;
  }

  const closeBtn = ui.meaningPanel.querySelector('.ytm-meaning-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (ev) => {
      ev.stopPropagation();
      toggleMeaningPanel(false);
    };
  }
  const pinBtn = ui.meaningPanel.querySelector('.ytm-meaning-pin-btn');
  if (pinBtn) {
    pinBtn.onclick = (ev) => {
      ev.stopPropagation();
      cycleMeaningPinMode();
    };
  }
}

function syncMeaningPanelToPlayback(force = false, preferredTime = null) {
  if (!meaningPanelVisible || !ui.meaningPanel || !lyricsMeaning) return;
  if (meaningHoverVisible && meaningHoverIndex >= 0) return;
  const nextIndex = resolveMeaningIndex(preferredTime);
  if (!force && nextIndex === activeMeaningIndex) return;
  renderMeaningPanel(nextIndex);
}

function refreshMeaningUi() {
  const hasMeaning = !!lyricsMeaning;
  if (hasMeaning && isMeaningPersistentlyVisible()) {
    meaningPanelVisible = true;
  }

  if (ui.meaningBtn) {
    ui.meaningBtn.hidden = !hasMeaning;
    ui.meaningBtn.classList.toggle('active', !!(hasMeaning && meaningPanelVisible));
  }
  if (ui.summaryBtn) {
    ui.summaryBtn.hidden = !hasMeaning;
  }

  if (!hasMeaning) {
    clearMeaningHoverTimers();
    meaningHoverVisible = false;
    meaningHoverIndex = -1;
    meaningVisibleBeforeHover = false;
    meaningPanelVisible = false;
    activeMeaningIndex = -1;
    if (ui.meaningPanel) {
      ui.meaningPanel.classList.remove('active');
      ui.meaningPanel.innerHTML = '';
    }
    hideMeaningSummaryPopup();
    return;
  }

  if (ui.meaningPanel) {
    ui.meaningPanel.classList.toggle('active', !!meaningPanelVisible);
    if (meaningPanelVisible) renderMeaningPanel(resolveMeaningIndex());
  }
}

function setLyricsMeaningData(data) {
  lyricsMeaning = normalizeMeaningPayloadLocal(data);
  activeMeaningIndex = -1;
  refreshMeaningUi();
  if (lyricsMeaning && lyricsData.length) emphasizeSummaryButtonAfterLyricsLoad();
}

async function persistMeaningDataToCurrentCache() {
  if (!currentKey || !lyricsMeaning) return;
  const cached = await storage.get(currentKey);
  if (cached === NO_LYRICS_SENTINEL) return;

  const base = (cached && typeof cached === 'object')
    ? cached
    : ((typeof lastRawLyricsText === 'string' && lastRawLyricsText.trim()) ? { lyrics: lastRawLyricsText } : null);

  if (!base) return;
  await storage.set(currentKey, { ...base, meaningData: lyricsMeaning });
}


function toggleMeaningPanel(force) {
  if (!lyricsMeaning) {
    showToast('解説データがまだありません');
    return;
  }

  clearMeaningHoverTimers();
  meaningHoverVisible = false;
  meaningHoverIndex = -1;
  meaningVisibleBeforeHover = false;
  meaningPanelVisible = typeof force === 'boolean' ? force : !meaningPanelVisible;
  if (ui.meaningPanel) {
    ui.meaningPanel.classList.toggle('active', meaningPanelVisible);
  }
  if (ui.meaningBtn) {
    ui.meaningBtn.classList.toggle('active', meaningPanelVisible);
  }
  if (meaningPanelVisible) {
    syncMeaningPanelToPlayback(true);
  }
}

function showMeaningSummaryPopup() {
  if (!lyricsMeaning) {
    showToast('要約データがまだありません');
    return;
  }

  ensureMeaningSummaryDialog();
  const summary = lyricsMeaning.final_summary || {};
  const shortText = summary.short || '';
  const longText = summary.long || shortText || 'この曲の要約データはまだありません。';
  const structuredSummaryHtml = buildMeaningSummarySectionsHtml();

  ui.meaningSummaryDialog.innerHTML = `
      <button class="ytm-meaning-summary-close ytm-unified-close-btn size-36" type="button" aria-label="Close"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="ytm-meaning-summary-eyebrow">要約</div>
      <div class="ytm-meaning-summary-title">${escapeHtml(getMeaningDisplayTitle())}</div>
      ${buildMeaningRatingHtml()}
      ${shortText ? `<p class="ytm-meaning-summary-short">${escapeHtml(shortText)}</p>` : ''}
      ${structuredSummaryHtml || `<p class="ytm-meaning-summary-long">${escapeHtml(longText)}</p>`}
      ${buildMeaningCommentsHtml()}
    `;

  const closeBtn = ui.meaningSummaryDialog.querySelector('.ytm-meaning-summary-close');
  if (closeBtn) closeBtn.onclick = () => hideMeaningSummaryPopup();

  ui.meaningSummaryBackdrop.classList.add('visible');
  ui.meaningSummaryDialog.classList.add('visible');
}

function setupAutoHideEvents() {
  if (document.body.dataset.autohideSetup) return;
  // mousemove は 1 フレームに 1 回へ間引く。
  // 高ポーリングレートのマウスでは毎秒数百回発火し、その都度
  // handleInteraction() の querySelector / classList 操作 / setTimeout 再設定が
  // 走って無視できないCPUコストになるため。
  let _interactionRafId = null;
  const onMouseMove = () => {
    if (_interactionRafId) return;
    _interactionRafId = requestAnimationFrame(() => {
      _interactionRafId = null;
      handleInteraction();
    });
  };
  document.addEventListener('mousemove', onMouseMove, { passive: true });
  ['click', 'keydown'].forEach(ev => document.addEventListener(ev, handleInteraction));
  document.body.dataset.autohideSetup = 'true';
  handleInteraction();
}

// 完了時刻を一度だけ並べ、毎フレームは境界を越えた行だけ更新する。
// 行のハイライトとは別に扱うため、デュエットの重なりや最後の行も消せる。
const buildLyricCompletionSchedule = (data, duration) => {
  const schedule = [];
  let nextTime = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  for (let i = data.length - 1; i >= 0;) {
    const time = data[i]?.time;
    if (!Number.isFinite(time)) { i -= 1; continue; }
    let first = i;
    while (first > 0 && Number.isFinite(data[first - 1]?.time) &&
      Math.abs(data[first - 1].time - time) <= 0.05) first -= 1;
    for (let j = first; j <= i; j++) {
      const line = data[j];
      const dynamicEnd = line._dynamicRenderEndSec;
      const start = Number.isFinite(line._dynamicRenderStartSec) ? line._dynamicRenderStartSec : line.time;
      const end = Number.isFinite(dynamicEnd) && dynamicEnd >= start ? dynamicEnd : nextTime;
      if (Number.isFinite(end) && end >= line.time) schedule.push({ index: j, end });
    }
    nextTime = data[first].time;
    i = first - 1;
  }
  return schedule.sort((a, b) => a.end - b.end || a.index - b.index);
};

const syncCompletedLyricRows = (container, schedule, time) => {
  if (!container || !Number.isFinite(time)) return;
  const rows = container.children;
  const setCompleted = (index, completed) => {
    const row = rows[index];
    if (!row || !row.classList.contains('lyric-line')) return;
    if (row._ytmIsCompleted === completed) return;
    row._ytmIsCompleted = completed;
    row.classList.toggle('lyric-completed', completed);
  };
  if (container._ytmCompletionSchedule !== schedule || container._ytmCompletionFirstRow !== rows[0]) {
    container._ytmCompletionSchedule = schedule;
    container._ytmCompletionFirstRow = rows[0];
    let cursor = 0;
    const completed = new Set();
    while (cursor < schedule.length && schedule[cursor].end <= time) completed.add(schedule[cursor++].index);
    for (let i = 0; i < rows.length; i++) {
      rows[i]._ytmIsCompleted = undefined;
      setCompleted(i, completed.has(i));
    }
    container._ytmCompletionCursor = cursor;
    return;
  }
  let cursor = container._ytmCompletionCursor;
  while (cursor > 0 && schedule[cursor - 1].end > time) setCompleted(schedule[--cursor].index, false);
  while (cursor < schedule.length && schedule[cursor].end <= time) setCompleted(schedule[cursor++].index, true);
  container._ytmCompletionCursor = cursor;
};

let _lyricCompletionData = null;
let _lyricCompletionDuration = null;
let _lyricCompletionSchedule = [];
const refreshCompletedLyrics = (time, duration) => {
  if (!config.fadePastLyrics || !hasTimestamp || animatedCaptionData || !Number.isFinite(time)) return;
  const end = Number.isFinite(duration) ? duration : null;
  if (_lyricCompletionData !== lyricsData || _lyricCompletionDuration !== end) {
    _lyricCompletionData = lyricsData;
    _lyricCompletionDuration = end;
    _lyricCompletionSchedule = buildLyricCompletionSchedule(lyricsData, end);
  }
  syncCompletedLyricRows(ui.lyrics, _lyricCompletionSchedule, time);
  if (PipManager.pipWindow) syncCompletedLyricRows(PipManager.pipLyricsContainer, _lyricCompletionSchedule, time);
};

const applyLyricEffectsSettings = () => {
  document.body.classList.toggle('ytm-fade-past-lyrics', !!config.fadePastLyrics);
  PipManager.pipWindow?.document?.body.classList.toggle('ytm-fade-past-lyrics', !!config.fadePastLyrics);
  if (!config.lyricStagger || config.lowCpuMode) {
    for (const container of [ui.lyrics, PipManager.pipLyricsContainer]) {
      const hadMotion = !!container?._ytmRowMotion;
      resetLyricRowMotion(container);
      if (hadMotion) finishLyricBrowseReturn(container);
    }
  }
  refreshCompletedLyrics(getCurrentPlaybackTimeSec(), document.querySelector('video')?.duration);
};

function setupScrollResumeEvents() {
  if (!ui.lyrics) return;

  const handleUserScroll = (event) => {
    // 曲切替・再描画など拡張側の操作で発生したscrollイベントは
    // ユーザースクロールとして扱わない（自動スクロールが止まる原因になる）
    const directInput = event?.type !== 'scroll';
    if (!directInput && performance.now() < _suppressUserScrollUntil) return;

    if (!directInput && isProgrammaticScrolling) {
      // プログラムスクロール中は、完了までタイムアウトを延長
      clearTimeout(programmaticScrollTimeout);
      programmaticScrollTimeout = setTimeout(() => {
        isProgrammaticScrolling = false;
      }, 150);
      return;
    }

    isUserScrolling = true;
    isProgrammaticScrolling = false;
    // 動いている途中の行は止めずに着地させる。止めると残りの距離を一度に跳ぶ。
    ui.lyrics._ytmResumeFadeAfterScroll = false;
    ui.lyrics.classList.add('ytm-user-browsing-lyrics');
    clearTimeout(userScrollTimeout);
    userScrollTimeout = setTimeout(() => {
      isUserScrolling = false;
      if (ui.lyrics) {
        ui.lyrics._ytmResumeFadeAfterScroll = true;
        ui.lyrics._lastScrolledIndex = -1; // 復帰時に強制スクロールさせるためリセット
      }
    }, 3000);
  };

  ui.lyrics.addEventListener('scroll', handleUserScroll, { passive: true });
  ui.lyrics.addEventListener('wheel', handleUserScroll, { passive: true });
  ui.lyrics.addEventListener('touchmove', handleUserScroll, { passive: true });
  ui.lyrics.addEventListener('keydown', (event) => {
    if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) handleUserScroll(event);
  });
}


// ===================== 歌詞＋翻訳適用 =====================

let lyricsTranslationMap = {};

const normalizeTranslationLangKey = (lang) => {
  const key = String(lang || '').trim().toLowerCase();
  if (key === 'jp') return 'ja';
  if (key === 'kr') return 'ko';
  if (key === 'cn' || key === 'zh-cn' || key === 'zh-tw') return 'zh';
  return key;
};

const toLrchubTranslateLang = (lang) => {
  const key = normalizeTranslationLangKey(lang);
  if (!key || key === 'original') return '';
  if (key === 'ja') return 'JA';
  if (key === 'en') return 'EN';
  if (key === 'ko') return 'KO';
  if (key === 'zh') return 'CN';
  return key.toUpperCase();
};

const extractTranslationLyricsLocal = (value) => {
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

const normalizeTranslationsToLrcMapLocal = (input) => {
  const out = {};
  if (!input) return out;

  if (input.lrc_map && typeof input.lrc_map === 'object') {
    Object.entries(input.lrc_map).forEach(([lang, value]) => {
      const key = normalizeTranslationLangKey(lang);
      const lyrics = extractTranslationLyricsLocal(value);
      if (key && lyrics) out[key] = lyrics;
    });
  }

  if (Array.isArray(input)) {
    input.forEach(item => {
      if (!item) return;
      const key = normalizeTranslationLangKey(item.language || item.lang || item.target_lang || item.targetLang);
      const lyrics = extractTranslationLyricsLocal(item);
      if (key && lyrics) out[key] = lyrics;
    });
    return out;
  }

  if (typeof input === 'object') {
    Object.entries(input).forEach(([lang, value]) => {
      if (lang === 'lrc_map') return;
      const key = normalizeTranslationLangKey(value?.language || value?.lang || lang);
      const lyrics = extractTranslationLyricsLocal(value);
      if (key && lyrics) out[key] = lyrics;
    });
  }

  return out;
};

// 「自動」は表示言語へ訳す。表示言語の既定はブラウザの言語(namespace.js)。
const resolveTranslationLang = (lang) => {
  const key = normalizeTranslationLangKey(lang);
  if (key !== 'auto') return key;
  const ui = normalizeTranslationLangKey(config.uiLang);
  return ['ja', 'en', 'ko', 'zh'].includes(ui) ? ui : 'en';
};

const getRequestedTranslationLangs = () => {
  if (!config.useTrans) return [];
  const mainLang = resolveTranslationLang(config.mainLang || 'original');
  const subLang = resolveTranslationLang(config.subLang || '');
  const langs = [];
  if (mainLang && mainLang !== 'original') langs.push(mainLang);
  if (subLang && subLang !== 'original' && subLang !== mainLang) langs.push(subLang);
  return [...new Set(langs.filter(Boolean))];
};

const getRequestedLrchubTranslateLangs = () => (
  config.useSharedTranslateApi
    ? getRequestedTranslationLangs().map(toLrchubTranslateLang).filter(Boolean)
    : []
);

async function applyTranslations(baseLines, youtubeUrl) {
  if (!config.useTrans || !Array.isArray(baseLines) || !baseLines.length) return baseLines;
  const mainLangStored = await storage.get('ytm_main_lang');
  const subLangStored = await storage.get('ytm_sub_lang');
  if (mainLangStored) config.mainLang = mainLangStored;
  if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
  const mainLang = resolveTranslationLang(config.mainLang || 'original');
  const subLang = resolveTranslationLang(config.subLang || '');
  const langsToFetch = getRequestedTranslationLangs();
  if (!langsToFetch.length) return baseLines;

  let lrcMap = config.useSharedTranslateApi ? { ...(lyricsTranslationMap || {}) } : {};
  if (config.useSharedTranslateApi) {
    try {
      const missingLangs = langsToFetch.filter(lang => !lrcMap[normalizeTranslationLangKey(lang)]);
      if (missingLangs.length) {
        const metaNow = getMetadata();
        const artist = metaNow?.artist || '';
        const track = normalizeSearchTrackTitle(metaNow?.title, artist);
        const res = await safeRuntimeSendMessage({
          type: 'GET_TRANSLATION',
          payload: {
            track,
            artist,
            youtube_url: youtubeUrl,
            video_id: getCurrentVideoId(),
            langs: missingLangs
          }
        });
        if (res?.success) {
          lrcMap = {
            ...lrcMap,
            ...normalizeTranslationsToLrcMapLocal(res.translations),
            ...normalizeTranslationsToLrcMapLocal(res.lrcMap)
          };
        }
      }
      lyricsTranslationMap = { ...(lyricsTranslationMap || {}), ...lrcMap };
    } catch (e) {
      console.warn('GET_TRANSLATION failed', e);
    }
  }

  const transLinesByLang = {};
  const needDeepL = [];

  langsToFetch.forEach(lang => {
    const langKey = normalizeTranslationLangKey(lang);
    const lrc = (lrcMap && lrcMap[langKey]) || '';
    if (lrc) {
      const parsed = parseLRCNoFlag(lrc);
      transLinesByLang[langKey] = parsed;
    } else {
      // 共有翻訳に無い言語は機械翻訳で埋める(DeepL のキーがあれば DeepL、
      // 無ければ Chrome 内蔵)。共有翻訳が後から届けば描き直しでそちらが勝つ。
      needDeepL.push(langKey);
    }
  });
  const engines = new Set();
  if (Object.keys(transLinesByLang).length) engines.add('shared');
  let builtinPromptWant = null;

  if (needDeepL.length && config.deepLKey) {
    for (const lang of needDeepL) {
      // applyTranslations は遅着の差し替え・sub 歌詞の到着・設定保存でも
      // 走る。毎回 DeepL を叩くと同じ曲で何度も API 枠を消費するので、
      // 同じ歌詞・同じ言語なら前の結果を使い回す。
      const translatedTexts = await translateWithDeepLCached(baseLines, lang);
      if (translatedTexts && translatedTexts.length === baseLines.length) {
        const lines = baseLines.map((l, i) => ({
          time: l.time,
          text: translatedTexts[i]
        }));
        transLinesByLang[lang] = lines;
        engines.add('deepl');
      }
    }
  } else if (needDeepL.length && hasBuiltinTranslate()) {
    // Chrome 内蔵の翻訳は 1 曲 2〜3 秒かかる。歌詞はまず原文だけで出し、
    // 訳し終わったら描き直す(requestBuiltinTranslation)。
    const texts = baseLines.map(l => String(l?.text ?? ''));
    for (const lang of needDeepL) {
      const done = BuiltinTranslate.peek(texts, lang);
      // stale = 言語データが増えたので訳し直す。訳し終わるまでは前の訳を出す。
      if (!done || done.stale) requestBuiltinTranslation(texts, lang);
      if (!done) continue;
      if (done.missing.length && !done.stale && !builtinPromptWant) builtinPromptWant = { missing: done.missing };
      if (done.lines.some(Boolean)) {
        transLinesByLang[lang] = baseLines.map((l, i) => ({ time: l.time, text: done.lines[i] ?? l.text }));
        engines.add('builtin');
      }
    }
  }
  syncBuiltinDownloadPrompt(builtinPromptWant);
  setTranslationEngineBadge(engines);

  const alignedMap = buildAlignedTranslations(baseLines, transLinesByLang);
  const final = baseLines.map(l => ({ ...l }));
  const getLangTextAt = (langCode, index, baseText) => {
    if (!langCode || langCode === 'original') return baseText;
    const arr = alignedMap[langCode];
    if (!arr) return baseText;
    const v = arr[index];
    return (v === null || v === undefined) ? baseText : v;
  };

  for (let i = 0; i < final.length; i++) {
    const baseText = final[i].text;
    let primary = getLangTextAt(mainLang, i, baseText);
    let secondary = null;
    if (subLang && subLang !== mainLang) {
      secondary = getLangTextAt(subLang, i, baseText);
    } else if (!subLang && mainLang !== 'original') {
      if (normalizeStr(primary) !== normalizeStr(baseText)) {
        secondary = baseText;
      }
    }
    if (secondary && normalizeStr(primary) === normalizeStr(secondary)) {
      if (!isMixedLang(baseText)) secondary = null;
    }
    final[i].text = primary;
    if (secondary) final[i].translation = secondary;
    else delete final[i].translation;
  }
  dedupePrimarySecondary(final);
  return final;
}

// ── Chrome 内蔵の翻訳(builtin-translate.js) ─────────────────
const hasBuiltinTranslate = () => typeof BuiltinTranslate !== 'undefined' && BuiltinTranslate.isSupported();
// 進み具合は利用者が落とし始めた時だけ出す。落とし済みのデータを読み込む時も
// Chrome は進み具合(0→1)を知らせてくるので、それで「ダウンロード中」と出さない。
const builtinProgress = () => (
  builtinDownloadStarted && typeof BuiltinTranslate !== 'undefined' ? BuiltinTranslate.progress() : null
);

// 訳し終わったら、同じ曲のままなら描き直す。2 回目は peek で結果が取れる。
function requestBuiltinTranslation(texts, lang) {
  const keyAtStart = currentKey;
  const rawAtStart = lastRawLyricsText;
  BuiltinTranslate.translateLines(texts, lang).then((res) => {
    if (!config.useTrans || keyAtStart !== currentKey || rawAtStart !== lastRawLyricsText) return;
    if (res.lines.some(Boolean) || res.missing.length) applyLyricsText(rawAtStart);
  }).catch((e) => console.warn('Chrome translation failed', e));
}

// 初めての言語は Chrome が言語データを落とす。落とし始めはクリックの中でしか
// できないので、訳せない言語がある時は歌詞の下にボタンを出す。
let builtinPromptMissing = null;
let builtinDownloadStarted = false;

function syncBuiltinDownloadPrompt(want) {
  builtinPromptMissing = want ? want.missing : null;
  let el = document.getElementById('ytm-trans-dl');
  const progress = builtinProgress();
  if (!builtinPromptMissing && progress === null) {
    el?.classList.remove('visible');
    return;
  }
  if (!el) {
    el = createEl('div', 'ytm-trans-dl', '', '');
    el.setAttribute('role', 'status');
    const text = createEl('span', '', 'ytm-trans-dl-text', '');
    const btn = createEl('button', '', 'ytm-trans-dl-btn', '');
    btn.type = 'button';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      startBuiltinDownload(builtinPromptMissing);
    });
    el.append(text, btn);
    document.body.appendChild(el);
  }
  const text = el.querySelector('.ytm-trans-dl-text');
  const btn = el.querySelector('.ytm-trans-dl-btn');
  if (progress !== null) {
    text.textContent = t('trans_dl_progress').replace('{p}', String(Math.floor(progress * 100)));
    btn.hidden = true;
  } else {
    text.textContent = t('trans_dl_prompt');
    btn.textContent = t('trans_dl_button');
    btn.hidden = false;
  }
  el.classList.add('visible');
}

// クリックの中で呼ぶ。終わったら(失敗も含めて)今の曲を描き直す。
function startBuiltinDownload(pairs) {
  if (!Array.isArray(pairs) || !pairs.length) return;
  builtinDownloadStarted = true;
  BuiltinTranslate.download(pairs).then((made) => {
    if (made.some(m => !m || m === 'unavailable')) showToast(t('trans_dl_failed'));
  });
  syncBuiltinDownloadPrompt({ missing: pairs });
}

if (typeof BuiltinTranslate !== 'undefined') BuiltinTranslate.onChange(() => {
  if (!builtinDownloadStarted) return;
  updateTransEngineDesc();
  if (builtinProgress() !== null) {
    syncBuiltinDownloadPrompt(builtinPromptMissing ? { missing: builtinPromptMissing } : null);
    return;
  }
  builtinDownloadStarted = false;
  updateTransEngineDesc();
  syncBuiltinDownloadPrompt(null);
  if (config.useTrans && lastRawLyricsText) applyLyricsText(lastRawLyricsText);
});

// 取得元の表示に、訳がどこから来たかを添える(機械翻訳だと分かるように)。
function setTranslationEngineBadge(engines) {
  const el = document.getElementById('ytm-lyrics-source-debug');
  if (!el) return;
  const order = ['shared', 'deepl', 'builtin'];
  const list = order.filter(e => engines && engines.has(e));
  if (list.join(',') === (el.dataset.translationEngines || '')) return;
  el.dataset.translationEngines = list.join(',');
  applyLyricsSourceBadgeText(el);
}

const buildAlignedTranslations = (baseLines, transLinesByLang) => {
  const alignedMap = {};
  const TOL = 0.15;
  Object.keys(transLinesByLang).forEach(lang => {
    const arr = transLinesByLang[lang];
    const res = new Array(baseLines.length).fill(null);
    if (!Array.isArray(arr) || !arr.length) {
      alignedMap[lang] = res;
      return;
    }
    const hasAnyTime = arr.some(x => x && typeof x.time === 'number');
    if (!hasAnyTime) {
      // Untimed translations use blank rows only as section separators. Match
      // non-empty translations to non-empty base lines so timestamp sorting
      // cannot turn a separator into a translated lyric line.
      const contentLines = arr.filter(item => (
        item && typeof item.text === 'string' && item.text.trim() !== ''
      ));
      let k = 0;
      for (let i = 0; i < baseLines.length; i++) {
        const baseTextRaw = (baseLines[i]?.text ?? '');
        const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
        if (isEmptyBaseLine) { res[i] = ''; continue; }
        const cand = contentLines[k];
        if (cand && typeof cand.text === 'string') {
          const trimmed = cand.text.trim();
          res[i] = trimmed === '' ? '' : trimmed;
        } else {
          res[i] = '';
        }
        k++;
      }
      alignedMap[lang] = res;
      return;
    }
    let j = 0;
    for (let i = 0; i < baseLines.length; i++) {
      const baseLine = baseLines[i] || {};
      const tBase = baseLine.time;
      const baseTextRaw = (baseLine.text ?? '');
      const isEmptyBaseLine = typeof baseTextRaw === 'string' && baseTextRaw.trim() === '';
      if (isEmptyBaseLine) {
        res[i] = '';
        continue;
      }
      if (typeof tBase !== 'number') {
        const cand = arr[i];
        if (cand && typeof cand.text === 'string') {
          const raw = cand.text;
          const trimmed = raw.trim();
          res[i] = trimmed === '' ? '' : trimmed;
        }
        continue;
      }
      while (j < arr.length && typeof arr[j].time === 'number' && arr[j].time < tBase - TOL) {
        j++;
      }
      if (j < arr.length && typeof arr[j].time === 'number' && Math.abs(arr[j].time - tBase) <= TOL) {
        const raw = (arr[j].text ?? '');
        const trimmed = raw.trim();
        res[i] = trimmed === '' ? '' : trimmed;
        j++;
      }
    }
    alignedMap[lang] = res;
  });
  return alignedMap;
};


// ===================== Apple Music 風の文字同期 =====================
// Apple Music の歌詞が美しく見えるのは、次が同時に起きているため:
//   1. 塗りの先端が行を「ひと続きに」流れていく。境目はぼけている
//   2. 歌い終わった語はわずかに持ち上がったまま残る
//   3. 伸ばした音だけが膨らんで光り、また戻る。速い語は光らない
//
// ■ 描画の単位を「文字」ではなく「語」にしている理由
//   1文字ずつ span に切って inline-block にすると、文字の間で字形の詰め
//   (カーニング)が効かない。同じ英文で実測 3.3px 横に伸び、字の間が空く。
//   語単位なら 1.4px まで縮む。さらに1文字ずつ独立に持ち上げ・拡大すると
//   語がバラバラに動いてガタついて見える。
//   日本語のように空白で切れない言語は1字ずつに切る。全角どうしは
//   字形の詰めがほぼ効かないので、切っても隙間は出ない。
//
// ■ 塗りは行ぜんたいで1本の勾配として扱う
//   語ごとに 0→1 の勾配を持たせると、語の変わり目でぼかしが途切れて
//   境目が見える。そこで「行の先頭から何 px 進んだか」を行に1本持ち、
//   各語には自分の開始位置を引いた値(--wsweep)を渡して自分の
//   ところだけを描く。先端は語をまたいでひと続きに流れる。
//
// ■ 光と拡大は伸ばした音だけ
//   全部の語を光らせると、行がのっぺり明るくなって「いま歌っている所」が
//   分からなくなる。長さで強さを決め、短い語はほぼ素通しにする。
//   曲線は applemusic-like-lyrics が Apple Music を参照して置いたものに合わせた。

// 塗りの境目のぼかし半幅(px)。ぼかしの幅はこの2倍。style.css の
// @property --feather の initial-value と同じ値にすること。
//
// ここを広げすぎると、ぼかしが1文字まるごとを覆ってしまう。すると
// 先端が字を「横切る」のではなく、字が丸ごとフェードインすることになり、
// それが1文字ずつ順に起きて、かくんかくんと点いていくように見える。
// 全角の字は 1em あるので、ぼかしの幅は 1em より狭くないといけない。
// applemusic-like-lyrics は行の高さの半分(≒0.6em)を既定にしている。
// (以前は文字サイズの 0.3em を行に書いていたが、語の CSS が 10px で
// 上書きしていて効いていなかった。見た目はずっと 10px)
const SWEEP_FEATHER_PX = 10;
// 伸ばした音がふくらむ時に持ち上がる量。歌い終わっても残さない。
//
// 以前は「歌い終わった語は持ち上がったまま残る」ようにしていたが、
// これだと語ごとに高さが違う階段ができる。歌った語は上、まだの語は下、
// その境目に段差が残るので、語と語の間に区切りがあるように見えてしまう。
// Apple Music の行は平らで、流れているのは塗りだけ。
// 動くのは伸ばした音だけにして、しかも元の高さへ戻す。
const WORD_LIFT_EM = 0.05;
// ふくらみの最短時間。速い語がパッと跳ねないようにする。
const WORD_LIFT_MIN_SEC = 1.0;
// 強調(拡大+光)の前倒し。声が当たる前から膨らみ始める。
const WORD_EMPHASIS_PREROLL_SEC = 0.4;
// 強調の全体の長さ。音の長さの 1.4 倍。
const WORD_EMPHASIS_STRETCH = 1.4;
// 次の語が無い時に1語へ割り当てる長さ
const WORD_DEFAULT_SEC = 0.4;
// 書き込みの量子化。粗いと長く伸ばす音で動きが飛び飛びになる。
const WORD_STEP = 512;
// 塗りの先端の px を刻む細かさ。粗いと、1フレームの進み幅が
// 刻み幅に丸められて速度が数%ずつ揺れる。動いている間はどのみち
// 毎フレーム書くので、細かくしても書き込み回数は増えない。
const SWEEP_STEP = 32;

// 端で微分が 0 になるので、増減の切り替わりで折れ線にならない
const smoothstep = (x) => (x <= 0 ? 0 : (x >= 1 ? 1 : x * x * (3 - 2 * x)));
// 両端が 0、中央が 1 の滑らかな山(ハン窓)。強調の立ち上がりと戻りに使う。
const bellCurve = (x) => (x <= 0 || x >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * x));

// 音の長さ → 強調の強さ。短い音はほぼ素通し、伸ばすほど急に強くなって頭打ち。
// 全部の語を光らせないのが肝。光らせると行がのっぺり明るくなり、
// 「いま歌っている所」が読み取れなくなる。
// 形は applemusic-like-lyrics のものに倣い、指数だけ緩めた。
// あちらは 1 秒未満をほぼ完全に落とすが、それだと速い曲で
// 一度も膨らまないまま終わってしまう。
const emphasisCurve = (durSec, scale) => {
  const x = durSec / scale;
  return x > 1 ? Math.sqrt(x) : Math.pow(x, 1.8);
};
const emphasisScaleAmount = (durSec) => Math.min(1.2, emphasisCurve(durSec, 1.8) * 0.7);
const emphasisGlowAmount = (durSec) => Math.min(0.7, emphasisCurve(durSec, 2.4) * 0.45);

const isSpaceGlyph = (c) => c === ' ' || c === ' ' || c === '\t' || c === '　';

// 日本語・中国語・韓国語は語の区切りに空白が無い。空白だけで切ると
// 行まるごとが1単位になってしまい、光と持ち上げが行全体に一様に掛かる
// (歌っている位置を光が追いかけなくなる)。
//
// かといって1字ずつ切ると、箱が字の数だけ増える。全角は字形の詰めが
// ほぼ効かないので総幅は変わらないのだが、箱が増えるほど字の間の見え方が
// 揃わなくなる。ブラウザの語区切りで切って、語の中はひと続きに組ませる。
// 塗りの位置は行ぜんたいの先端が持っているので、単位が語に粗くなっても
// 同期の細かさは落ちない。
const lyricUnitSegmenter = (() => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return new Intl.Segmenter('ja', { granularity: 'word' });
    }
  } catch (e) { /* 使えなければ下の簡易規則に落とす */ }
  return null;
})();

// 語区切りが使えない環境用の保険。全角は1字ずつに切る。
const CJK_GLYPH_RE = /[⺀-〾ぁ-㏿㐀-䶿一-鿿豈-﫿＀-ﾟ￠-￦가-힯]/;
// ハングル(音節と字母)。韓国語は空白で語を分けるので、空白を書式として捨てない。
const HANGUL_GLYPH_RE = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/;
// 拗音・促音・長音・濁点や閉じ括弧は、単独では1拍にならない。
// 前の字にぶら下げて「ちゃ」「きゅう」を一息で扱う。
// 英語の句読点(, . ; : …)も前の語に付ける。語ごとに inline-block なので、
// 別の単位のままだと語と句読点の間で折り返せてしまい、実機で
// 「(Oh, my savior」「, oh, my saving」のように行頭にカンマが来ていた。
const CJK_TAIL_RE = /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーｰ゛゜々〆、。，．！？!?)）」』】〕》〉”’,.;:\]}…]/;

// dynamicLines の chars を「1文字 + 開始秒」の並びに均す。
// chars は基本 1 文字ずつだが、プロバイダーによっては "Maybe " のような
// 語の塊で来る。塊のままだと語の切れ目が取れないので、次の時刻までを
// 文字数で割って配る。
const flattenLyricGlyphs = (chars, lineEndSec) => {
  const flat = [];
  if (!Array.isArray(chars)) return flat;

  const timeAt = (i) => {
    const v = Number(chars[i]?.t);
    return Number.isFinite(v) ? v / 1000 : null;
  };

  for (let i = 0; i < chars.length; i++) {
    const raw = String(chars[i]?.c ?? '');
    if (!raw) continue;
    const start = timeAt(i);

    let next = null;
    for (let j = i + 1; j < chars.length; j++) {
      const t = timeAt(j);
      if (t !== null) { next = t; break; }
    }
    if (next === null) {
      next = Number.isFinite(lineEndSec)
        ? lineEndSec
        : (start === null ? null : start + WORD_DEFAULT_SEC);
    }

    const glyphs = Array.from(raw);
    const step = (start !== null && next !== null && next > start)
      ? (next - start) / glyphs.length
      : 0;
    glyphs.forEach((g, k) => {
      flat.push({ c: g, t: start === null ? null : start + step * k });
    });
  }
  return flat;
};

// 空白で区切って語にまとめる。空白は語に含めず、素のテキストとして
// 語と語の間に置く(inline-block の中に入れると折り返せなくなる)。
const buildLyricWordUnits = (chars, lineEndSec) => {
  const flat = flattenLyricGlyphs(chars, lineEndSec);

  // ── 1文字ごとに空白を挟んだデータ ──────────────────────
  // 日本語の同期データには、文字と文字の間すべてに空白を入れたものがある。
  // 実測では、語タグの 83〜92% が空白で終わる曲が複数あった(滑らかに
  // 見える曲は 20%)。
  //
  // これをそのまま語の区切りとして扱うと、全部の文字が独立した単位になる。
  // 膨らみ・光・持ち上げは単位ごとに掛かって戻るので、1文字ずつ点いては
  // 止まって見える。行の幅も倍近くになり、折り返しも増える。
  //
  // 前後がどちらも CJK の空白は、語の区切りではなく書式。語を切らせない。
  // 英語のように本当に空白で語が分かれる言語は対象外(下の判定で外れる)。
  // 韓国語も空白で語を分ける(分かち書き)。ハングルに挟まれた空白まで
  // 書式とみなすと「울 것 같을 때」が「울것같을때」に詰まる(実機: OMG)。
  // 書式とみなすのは日本語・中国語の字(ハングル以外)に挟まれた時だけ。
  const isFormattingSpace = new Array(flat.length).fill(false);
  {
    let spaces = 0;
    let betweenCjk = 0;
    for (let i = 0; i < flat.length; i++) {
      if (!isSpaceGlyph(flat[i].c)) continue;
      spaces += 1;
      const prev = flat[i - 1];
      const next = flat[i + 1];
      if (prev && next && CJK_GLYPH_RE.test(prev.c) && CJK_GLYPH_RE.test(next.c)
        && !HANGUL_GLYPH_RE.test(prev.c) && !HANGUL_GLYPH_RE.test(next.c)) {
        isFormattingSpace[i] = true;
        betweenCjk += 1;
      }
    }
    // 半分を超えていなければ、ふつうに語を分けている空白とみなす
    if (!spaces || betweenCjk / spaces <= 0.5) isFormattingSpace.fill(false);
  }

  // 語の頭になる位置を先に出す。Intl の語区切りは英語も日本語も
  // 同じ呼び方で扱えるので、言語で分岐しない。
  // 書式の空白を外した文字列で切ることで、本来の語のまとまりが出る。
  const boundaries = new Set();
  if (flat.length && lyricUnitSegmenter) {
    try {
      let text = '';
      const flatIndexAt = new Map();
      for (let i = 0; i < flat.length; i++) {
        if (isFormattingSpace[i]) continue;
        flatIndexAt.set(text.length, i);
        text += flat[i].c;
      }
      for (const seg of lyricUnitSegmenter.segment(text)) {
        const index = flatIndexAt.get(seg.index);
        if (index !== undefined) boundaries.add(index);
      }
    } catch (e) { /* 落ちたら下の簡易規則へ */ }
  }
  const useSegmenter = boundaries.size > 0;

  const units = [];
  let current = null;
  let currentIsCjk = false;

  flat.forEach((glyph, index) => {
    if (isSpaceGlyph(glyph.c)) {
      // 書式の空白は歌詞の一部ではないので、まるごと捨てる。
      //
      // 残すと二つの困りごとが出る。ひとつは単純に、字と字の間が
      // 空いて見えること。もうひとつは塗りの速さで、こちらの方が重い。
      // データは「<時刻>文字+空白」で区切られているため、区間の時間が
      // 文字と空白で等分される。つまり塗りは各区間の半分を、目に見えない
      // 空白の上で使う。文字の上だけ倍速で通り、空白の上で止まって見える。
      //
      // 捨てれば、その文字が区間の時間をまるごと使う。速さが揃う。
      if (isFormattingSpace[index]) return;
      const last = units[units.length - 1];
      if (last && last.type === 'space') last.text += glyph.c;
      else units.push({ type: 'space', text: glyph.c });
      current = null;
      return;
    }

    const isTail = CJK_TAIL_RE.test(glyph.c);
    let needsNewUnit;
    if (useSegmenter) {
      // 拗音・長音は語区切りに関わらず前へぶら下げる
      needsNewUnit = !current || (!isTail && boundaries.has(index));
    } else {
      const isCjk = CJK_GLYPH_RE.test(glyph.c);
      needsNewUnit = !current || (!isTail && (isCjk || currentIsCjk));
      if (needsNewUnit) currentIsCjk = isCjk;
    }

    if (needsNewUnit) {
      current = { type: 'word', text: '', times: [], offsets: [], endIndex: index };
      units.push(current);
    }
    current.offsets.push(current.text.length);
    current.text += glyph.c;
    current.times.push(glyph.t);
    current.endIndex = index;
  });

  // 各語の終わりは「その語の最後の文字の次に来るもの」の時刻。
  // 次の語の頭を使うと、語と語の間の無音ぶんまで塗りが伸びてしまう。
  for (const unit of units) {
    if (unit.type !== 'word') continue;
    let end = null;
    for (let i = unit.endIndex + 1; i < flat.length; i++) {
      // 捨てた書式空白の時刻は拾わない。データは「文字+空白」で1区間
      // なので、空白は区間の中点の時刻を持つ。これを語の終わりにすると、
      // そこから次の語の頭(区間の終わり)まで、進む px がゼロの区間が
      // できる。buildMonotoneTangents は進みがゼロの区間を見つけると
      // その両端の接線を 0 にするので、塗りが文字ごとに完全に止まる。
      // 実測では行の時間の 24〜29% が停止だった(滑らかな曲は 0%)。
      if (isFormattingSpace[i]) continue;
      if (flat[i].t !== null) { end = flat[i].t; break; }
    }
    const start = unit.times.find(t => t !== null) ?? null;
    if (end === null) end = Number.isFinite(lineEndSec) ? lineEndSec : null;
    unit.start = start;
    unit.end = (end !== null && start !== null && end > start)
      ? end
      : (start === null ? null : start + WORD_DEFAULT_SEC);
  }

  return units;
};

// ── 行ぜんたいの「時刻 → 進んだ px」表を作る ────────────────
// 語の横位置(offsetLeft)は変形の影響を受けない素の値。語の中の文字境界は
// Range で測る。こちらは変形が乗るが、使うのは語の中での比だけなので影響しない。
// 折り返した行では、2行目以降の語を1行目の右へ continue させた座標に直す
// (読む順に一本の帯として扱うため)。
// 読む(offsetLeft・Range の幅・文字サイズ)と書く(--wx などの CSS 変数)を
// 分けてある。以前は語ごとに「読む → --wx を書く」を繰り返していて、書いた
// 直後の次の語の offsetLeft が、そのたびにスタイルの再計算をその場で走らせた。
// 歌詞が単語同期に切り替わった直後は、全行をまとめて測るので
// (prefetchLyricLineSweeps)、1 フレームが 50〜67ms に伸び、
// 最初の数行のスクロールがカクついていた(実機、再計算 760 回 / 0.9 秒)。
// 何行かまとめて測る時は、全部読んでから全部書く。
const readLyricLineSweep = (row) => {
  // PIP は別ウィンドウ・別文書。Range はその文書のものを使わないと、
  // 取れる値が別の窓のものになる。
  const doc = row.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const spans = row._ytmWordSpans;
  if (!doc) return { row, done: true };
  if (!Array.isArray(spans) || !spans.length) return { row, done: true };
  // 歌詞パネルを開く前など、まだ場所を持っていない時に測ると
  // 全部 0 になる。済んだ印を付けずに帰って、あとで測り直させる。
  if (!row.offsetWidth && !row.offsetHeight) return null;

  try {
    const geo = spans.map(span => ({ top: span.offsetTop, left: span.offsetLeft, width: span.offsetWidth, fractions: null }));
    const range = doc.createRange();
    spans.forEach((span, k) => {
      const node = span.firstChild;
      const offsets = span._offsets;
      if (!(node && node.nodeType === 3 && Array.isArray(offsets) && offsets.length > 1)) return;
      const len = node.data.length;
      const raw = [];
      for (const offset of offsets) {
        range.setStart(node, 0);
        range.setEnd(node, Math.min(offset, len));
        raw.push(range.getBoundingClientRect().width);
      }
      range.setStart(node, 0);
      range.setEnd(node, len);
      const last = range.getBoundingClientRect().width;
      if (last > 0) geo[k].fractions = raw.map(w => w / last);
    });
    return { row, spans, geo };
  } catch (e) {
    return { row, failed: true };
  }
};

const applyLyricLineSweep = (plan) => {
  if (!plan) return;
  const { row } = plan;
  row._sweepReady = true;
  if (plan.done) return;
  if (plan.failed) {
    row._sweepT = null;
    row._sweepX = null;
    return;
  }
  const { spans, geo } = plan;
  try {
    // 1. 語を表示上の行ごとにまとめ、行の幅を出す
    const rowsByTop = new Map();
    for (const g of geo) {
      let bucket = rowsByTop.get(g.top);
      if (!bucket) rowsByTop.set(g.top, (bucket = { right: 0 }));
      bucket.right = Math.max(bucket.right, g.left + g.width);
    }
    const tops = Array.from(rowsByTop.keys()).sort((a, b) => a - b);
    let carry = 0;
    for (const top of tops) {
      rowsByTop.get(top).origin = carry;
      carry += rowsByTop.get(top).right;
    }

    // 2. 語の開始位置と幅を覚え、文字ごとの位置表を作る
    //    (塗りの位置は毎フレーム語ごとに引き算して渡す: writeLyricWordSweep)
    const times = [];
    const xs = [];
    spans.forEach((span, k) => {
      const g = geo[k];
      const origin = rowsByTop.get(g.top)?.origin || 0;
      const wordX = origin + g.left;
      const width = g.width;
      span._wx = wordX;
      span._ww = width;
      const fractions = g.fractions;

      span._times.forEach((t, i) => {
        if (t === null) return;
        const frac = fractions ? (fractions[i] ?? (i / span._times.length)) : (i / span._times.length);
        times.push(t);
        xs.push(wordX + width * frac);
      });

      // 語の終わりも節目として入れる。入れないと最後の文字が
      // 語の右端まで塗り切るタイミングを表せない。
      if (Number.isFinite(span._end)) {
        times.push(span._end);
        xs.push(wordX + width);
      }
    });

    // 3. 時刻で並べ、単調にする(同時刻の重複はあとの方を残す)
    const order = times.map((t, i) => i).sort((a, b) => times[a] - times[b] || xs[a] - xs[b]);
    const st = [];
    const sx = [];
    for (const i of order) {
      if (st.length && times[i] <= st[st.length - 1]) {
        sx[sx.length - 1] = Math.max(sx[sx.length - 1], xs[i]);
        continue;
      }
      st.push(times[i]);
      sx.push(Math.max(xs[i], sx.length ? sx[sx.length - 1] : 0));
    }
    row._sweepT = st;
    row._sweepX = sx;
    row._sweepM = buildMonotoneTangents(st, sx);
    row._sweepEnd = carry;
    row._sweepIndex = 0;

    // 4. 語ごとの強調の強さ。長さで決まるので毎フレーム計算しない。
    for (const span of spans) {
      const dur = (Number.isFinite(span._end) && Number.isFinite(span._start) && span._end > span._start)
        ? span._end - span._start
        : WORD_DEFAULT_SEC;
      const scaleAmount = emphasisScaleAmount(dur);
      const glowAmount = emphasisGlowAmount(dur);
      // ここが小さい語は、膨らみも光も目に見えない。前倒しの窓を
      // 広げて毎フレーム光の濃さを書くだけ無駄になるので外す。
      // この閾値だと 0.4 秒より短い語は素通しになる。
      span._emp = scaleAmount > 0.05 || glowAmount > 0.05;
      span._empStart = span._start - WORD_EMPHASIS_PREROLL_SEC;
      span._empDur = Math.max(WORD_LIFT_MIN_SEC, dur) * WORD_EMPHASIS_STRETCH;
      span._amp = scaleAmount;
      // 光は持ち上がりと分ける。持ち上がりは合成側のキーフレームなので
      // 毎フレームの費用が無いが、光は濃さ(opacity)をメインスレッドから
      // 毎フレーム書く。軽量モードで落とすのはこちらだけ。
      // typeof で見ているのは、この関数がテストで単体切り出しされ、
      // 外側の config が存在しない文脈で実行されることがあるため。
      // ここで例外を出すと上の try/catch に落ちて塗りの表ごと消える。
      span._glow = span._emp &&
        !(typeof config !== 'undefined' && config && config.lowCpuMode);
      if (span._glow) span._glowEl = ensureLyricGlowEl(span, glowAmount);
    }
  } catch (e) {
    row._sweepT = null;
    row._sweepX = null;
  }
};

const measureLyricLineSweep = (row) => applyLyricLineSweep(readLyricLineSweep(row));

// ── 塗りの先端をなめらかに動かす ──────────────────────────
// 節目(文字の開始時刻とその横位置)の間を直線で結ぶと、節目ごとに
// 速度が段で変わる。文字は幅がまちまちなのに時間はほぼ等分なので、
// 細い字は速く、太い字は遅く進む。これが「カクカク」の見え方になる。
//
// 節目は必ず通しつつ、間を3次で結んで速度を連続にする。
// 接線は Fritsch-Carlson の重み付き調和平均で、単調性が壊れない
// (行き過ぎて戻る、が起きない)ものを選ぶ。
const buildMonotoneTangents = (ts, xs) => {
  const n = ts.length;
  const m = new Array(n).fill(0);
  if (n < 2) return m;

  const h = new Array(n - 1);
  const d = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    h[i] = ts[i + 1] - ts[i];
    d[i] = h[i] > 0 ? (xs[i + 1] - xs[i]) / h[i] : 0;
  }

  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] === 0 || d[i] === 0 || (d[i - 1] < 0) !== (d[i] < 0)) {
      m[i] = 0;
      continue;
    }
    const w1 = 2 * h[i] + h[i - 1];
    const w2 = h[i] + 2 * h[i - 1];
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return m;
};

// 時刻 → 行の先頭から進んだ px
const lyricSweepAt = (row, t) => {
  const st = row._sweepT;
  const sx = row._sweepX;
  if (!st || st.length === 0) return 0;
  if (t <= st[0]) return 0;
  if (t >= st[st.length - 1]) return row._sweepEnd || sx[sx.length - 1];

  // 再生は基本前進する。前フレームの位置から続け、巻き戻った時だけ探し直す。
  let i = row._sweepIndex || 0;
  if (i >= st.length - 1) i = st.length - 2;
  if (t < st[i]) i = 0;
  while (i + 1 < st.length - 1 && t >= st[i + 1]) i++;
  row._sweepIndex = i;

  const t0 = st[i];
  const t1 = st[i + 1];
  const x0 = sx[i];
  const x1 = sx[i + 1];
  if (!(t1 > t0)) return x1;

  const h = t1 - t0;
  const u = (t - t0) / h;
  const sm = row._sweepM;
  if (!sm) return x0 + (x1 - x0) * u;

  // Hermite。節目では必ず x0 / x1 を通るので、声とのずれは増えない。
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * x0
    + (u3 - 2 * u2 + u) * h * sm[i]
    + (-2 * u3 + 3 * u2) * x1
    + (u3 - u2) * h * sm[i + 1];
};

// ── 文字の動き(持ち上がり・膨らみ) ────────────────────────
// 動きだけは毎フレーム JS で transform を書いてはいけない。
// Chrome はテキストの縦位置を整数ピクセルに丸める(横は小数対応、縦は非対応)。
// 持ち上がりは 0.05em = 32px なら 1.6px しかないので、丸められると
// 1〜2回のジャンプになる。これがカクカクの正体だった。
//
// キーフレームを先に作って Web Animations に渡すと、合成側で小数のまま
// 動かしてくれる。文字は一度だけ描かれ、あとは GPU が変形するだけになる。
// 時計合わせは行ごとに1回。ずれた時(シーク・一時停止)だけ直す。
//
// 塗り(--wsweep)と光(.lyric-glow の濃さ)は位置を動かさないので丸めの問題が無く、
// ループで書いたままで良い。塗りは合成できないプロパティなので、
// 同じアニメーションに混ぜると transform まで合成から外れてしまう。

// キーフレームの粗さ。間はブラウザが直線で埋めるので、
// 40ms も刻めば 0.05em の移動では差が見えない。
const MOTION_FRAME_MS = 40;
const MOTION_MIN_FRAMES = 8;
const MOTION_MAX_FRAMES = 40;

const MOTION_RESYNC_SEC = 0.08;

// 動きを持っている行。一時停止の時にまとめて止めるために覚えておく。
//
// 画面から外れた行は必ず外す(forgetDetachedLyricMotionRows)。以前は足すだけで
// 一度も外さず、曲が変わって消えた行が動き(Web Animations)ごと残り続けた。
// PiP の行も入るので、PiP を閉じるたびに閉じた窓の文書がまるごと残り、
// 「タブを離れた時に PiP を開く」ではタブを切り替えるたびに 1 つずつ溜まって
// いた(実測: 開閉 1 回で文書 +1・ノード +86。何 GB にもなるという報告の原因)。
const _lyricMotionRows = new Set();

const dropLyricWordMotion = (row) => {
  const motions = row._motions;
  if (motions) {
    for (const animation of motions) {
      try { animation.cancel(); } catch (e) { /* 破棄済み */ }
    }
  }
  row._motions = null;
  row._motionReady = false;
  _lyricMotionRows.delete(row);
};

// 外す行: 文書から外れた行と、今の画面でも今開いている PiP でもない文書の行。
// 閉じた PiP の行は、閉じた窓の文書の中では繋がったまま(isConnected が true)
// なので、文書で見分ける。
const forgetDetachedLyricMotionRows = () => {
  const pipWin = typeof PipManager !== 'undefined' ? PipManager.pipWindow : null;
  const pipDoc = pipWin && !pipWin.closed ? pipWin.document : null;
  for (const row of _lyricMotionRows) {
    const doc = row.ownerDocument;
    if (!row.isConnected || (doc !== document && doc !== pipDoc)) dropLyricWordMotion(row);
  }
};

// 動くのは伸ばした音だけ。ふくらんで、元の高さと大きさへ戻る。
const buildLyricWordKeyframes = (span, origin) => {
  const from = span._empStart;
  const dur = span._empDur;
  if (!Number.isFinite(from) || !(dur > 0)) return null;

  const amp = span._amp || 0;
  const count = Math.max(
    MOTION_MIN_FRAMES,
    Math.min(MOTION_MAX_FRAMES, Math.round((dur * 1000) / MOTION_FRAME_MS)),
  );

  const frames = [];
  for (let i = 0; i <= count; i++) {
    const env = bellCurve(i / count);
    frames.push({
      offset: i / count,
      transform: `translateY(${(-WORD_LIFT_EM * env).toFixed(4)}em)`
        + ` scale(${(1 + env * amp * 0.085).toFixed(4)})`,
    });
  }

  return { frames, delay: (from - origin) * 1000, duration: dur * 1000 };
};

const createLyricWordMotion = (row) => {
  row._motionReady = true;
  // 動画モードでは語を持ち上げない。合成側のアニメーションでも、動いている間は
  // 画面の書き換えのたびに(120Hz なら 1 秒 120 回)映像ごと全面を合成し直す。
  // 映像そのものは 30 コマ前後なので、歌詞を出すだけで GPU が倍以上になっていた
  // (実測: 歌詞を隠すと GPU の使用率が 42% → 23%)。塗りと光は残す。
  row._motionMovie = typeof moviemode !== 'undefined' && moviemode === true;
  if (row._motionMovie) return;
  const spans = row._ytmWordSpans;
  if (!spans || !spans.length) return;
  if (typeof spans[0].animate !== 'function') return;   // 使えない環境では動かさない

  const origin = spans.map(sp => sp._start).find(v => Number.isFinite(v));
  if (!Number.isFinite(origin)) return;
  row._motionOrigin = origin;

  const animations = [];

  // 塗り(--wsweep)はアニメーションにしない。ループが lyricSweepAt で書く。
  // 以前はキーフレームで渡していたが、CSS 変数のアニメーションは合成側で
  // 走れず、画面の書き換えの回数(120Hz の画面なら 1 秒 120 回)だけ
  // メインスレッドで行のスタイルを計算し直して描き直していた。ループで
  // 書けば回数を決められる(動画モードは 30 回。scheduleNextFrame)。
  // 曲線は同じ(lyricSweepAt とキーフレームはどちらも同じエルミート曲線)。

  for (const span of spans) {
    // 速い語はまったく動かさない。動かすとその語だけ高さがずれて、
    // 語と語の間に段差ができる。
    if (!span._emp || !Number.isFinite(span._start)) continue;
    const built = buildLyricWordKeyframes(span, origin);
    if (!built) continue;
    const { frames, delay, duration } = built;
    try {
      const animation = span.animate(frames, {
        duration,
        delay,
        fill: 'both',
        easing: 'linear',   // 形はキーフレームに焼いてある
      });
      animation.pause();
      animations.push(animation);
    } catch (e) { /* 作れなくても塗りは動く */ }
  }
  row._motions = animations;
  if (animations.length) {
    forgetDetachedLyricMotionRows();
    _lyricMotionRows.add(row);
  }
};

const syncLyricWordMotion = (row, t, rate) => {
  const motions = row._motions;
  if (!motions || !motions.length) return;
  const local = (t - row._motionOrigin) * 1000;
  const now = performance.now();

  // 最初の語より前は止めたまま待たせる。負の時刻に合わせて play() すると、
  // ブラウザは 0 に巻き戻して始めてしまい、塗りがその差だけ早く走る。
  // 行が最初の語より前に光るのは、先に歌われるハモリがある時
  // (実機: OMG はハモリが 1.6 秒先に始まり、本編がそのぶん先に塗られた)。
  if (local < 0) {
    for (const animation of motions) {
      try {
        if (animation.playState !== 'paused') animation.pause();
        animation.currentTime = local;
      } catch (e) { /* 破棄済み */ }
    }
    row._motionSyncedAt = undefined;   // 0 を過ぎたら合わせ直して走らせる
    return;
  }

  // 合わせ直しの要否は、アニメーション側の currentTime ではなく
  // 自前の記録で判断する。語ごとに長さが違うので、終わったものは
  // それぞれ別の時刻で止まってしまい、比較の相手にならない。
  //
  // 前回合わせた時から実時間ぶん進んだはずの位置と、曲の位置がずれて
  // いたら、シークか一時停止があったということ。
  if (row._motionSyncedAt !== undefined) {
    const predicted = row._motionSyncedLocal + (now - row._motionSyncedAt) * rate;
    if (Math.abs(predicted - local) <= MOTION_RESYNC_SEC * 1000) return;
  }

  for (const animation of motions) {
    try {
      animation.currentTime = local;
      if (animation.playbackRate !== rate) animation.playbackRate = rate;
      animation.play();
    } catch (e) { /* 破棄済み */ }
  }
  row._motionSyncedLocal = local;
  row._motionSyncedAt = now;
};

const stopLyricWordMotion = (row) => {
  const motions = row._motions;
  if (!motions) return;
  row._motionSyncedAt = undefined;
  for (const animation of motions) {
    try { animation.pause(); animation.currentTime = 0; } catch (e) { /* 破棄済み */ }
  }
};

// 一時停止でループが止まる時。走らせたままだと歌詞だけ動き続ける。
const pauseAllLyricWordMotion = () => {
  forgetDetachedLyricMotionRows();
  for (const row of _lyricMotionRows) {
    const motions = row._motions;
    if (!motions) continue;
    // 次に描く時、実時間とのずれで合わせ直される
    row._motionSyncedAt = undefined;
    for (const animation of motions) {
      try { if (animation.playState === 'running') animation.pause(); } catch (e) { /* 破棄済み */ }
    }
  }
};

const writeLyricVar = (el, key, cacheKey, value, step) => {
  const q = Math.round(value * step) / step;
  if (el[cacheKey] === q) return;
  el[cacheKey] = q;
  el.style.setProperty(key, String(q));
};

// 語の塗りの位置(語の左端から先端までの px)を語に書く。
//
// 以前は行に 1 つだけ --sweep(inherits: true)を書き、語は CSS で自分の
// 開始位置を引いていた。書き込みは 1 回でも、受け継ぐ変数が変わるので行の中の
// 全部の語を計算し直し、YTM のページが受け継がせてくる 1,500 個ほどの
// CSS 変数の表をそのたびに作り直していた(毎分 1GB 近いゴミ、2026-10 実測)。
// 語ごとに inherits: false の変数へ書けば、計算し直すのはその語だけになる。
//
// 語の外(語の幅 ± ぼかし半幅の外)では、先端がどこにあっても見た目が
// 変わらない(全部塗れているか、全部まだか)。そこで値を止めておくと、
// 毎フレーム書き換わるのは先端がいる語だけになる。
const writeLyricWordSweep = (span, sweep) => {
  const wx = span._wx;
  if (!Number.isFinite(wx)) return;
  const width = Number.isFinite(span._ww) ? span._ww : 0;
  const local = Math.min(Math.max(sweep - wx, -SWEEP_FEATHER_PX), width + SWEEP_FEATHER_PX);
  writeLyricVar(span, '--wsweep', '_wsweep', local, SWEEP_STEP);
};

// 光る語(伸ばした音)の上に重ねる光の層。字は透明で影だけを描き、
// 濃さは opacity で変える(writeLyricGlow)。影の色と半径は語ごとに固定なので、
// ここで一度だけ書く。
//
// 以前は語の text-shadow の濃さを毎フレーム変えていた。text-shadow が変わると
// 字のはみ出し(影の範囲)を測り直すためにレイアウトが毎フレーム走る。
// opacity なら描き直しだけで済む。
// 字は data-t に写して ::before で出す(DOM の文字にすると、歌詞カードや
// Discord に渡す本文・韓国語の読みの元になる textContent に混ざる)。
// PIP は innerHTML で複製するので、向こうで測り直した時は複製された層を使う。
const ensureLyricGlowEl = (span, glowAmount) => {
  let el = null;
  for (const child of span.children || []) {
    if (child.classList?.contains('lyric-glow')) { el = child; break; }
  }
  if (!el) {
    el = span.ownerDocument.createElement('i');
    el.className = 'lyric-glow';
    el.setAttribute('aria-hidden', 'true');
    span.appendChild(el);
  }
  span.classList.add('lyric-word-glow');
  const text = span.firstChild && span.firstChild.nodeType === 3 ? span.firstChild.data : '';
  if (el.dataset.t !== text) el.dataset.t = text;
  // 濃さの最大(wglowa)と半径(em)。色は白で固定せず、行の色(色分け)に寄せる。
  const alpha = Number(glowAmount.toFixed(3)) * 100;
  const radius = Math.min(0.3, glowAmount * 0.3).toFixed(3);
  el.style.textShadow = `0 0 ${radius}em color-mix(in srgb, color-mix(in srgb, currentColor 55%, #fff) ${alpha}%, transparent)`;
  return el;
};

// 光の濃さ(0〜1)。値が変わった時だけ書く。
const writeLyricGlow = (span, env) => {
  const el = span._glowEl;
  if (!el) return;
  const q = Math.round(env * WORD_STEP) / WORD_STEP;
  if (span._wg === q) return;
  span._wg = q;
  el.style.opacity = String(q);
};

// PIP へは innerHTML で複製するので、span に持たせた JS のプロパティは
// 消える。data 属性に書いておいた時刻から組み直す。
const rehydrateLyricWordRow = (row) => {
  row._ytmRehydrated = true;
  // 行の語は本編(.lyric-main)の中だけ。ハモリ(.lyric-bg)は自分で 1 本の行になる。
  const spans = Array.from(row.querySelectorAll(
    row.classList?.contains('lyric-bg') ? '.lyric-word' : '.lyric-main .lyric-word',
  ));
  if (!spans.length) return null;

  for (const span of spans) {
    const times = String(span.dataset.wt || '')
      .split(',')
      .map(v => (v === '' ? null : Number(v)))
      .map(v => (v !== null && Number.isFinite(v) ? v : null));
    const glyphs = Array.from(span.textContent || '');
    const offsets = [];
    let at = 0;
    for (const g of glyphs) {
      offsets.push(at);
      at += g.length;
    }
    span._times = times.length ? times : [null];
    span._offsets = offsets;
    span._start = times.find(v => v !== null) ?? null;
    const end = Number(span.dataset.we);
    span._end = Number.isFinite(end) ? end : null;
    span._emp = false;
  }

  row._ytmWordSpans = spans;
  return spans;
};

const paintLyricWordRow = (row, t, rate = 1) => {
  let spans = row._ytmWordSpans;
  if (!spans && !row._ytmRehydrated) spans = rehydrateLyricWordRow(row);
  if (!spans || !spans.length) return;
  if (!row._sweepReady) measureLyricLineSweep(row);

  // 持ち上がりと膨らみは合成側に任せる。ここで transform を毎フレーム
  // 書くと、縦位置が整数ピクセルに丸められて 1〜2 回のジャンプになる。
  if (row._motionReady && row._motionMovie !== (typeof moviemode !== 'undefined' && moviemode === true)) dropLyricWordMotion(row);
  if (!row._motionReady) createLyricWordMotion(row);
  syncLyricWordMotion(row, t, rate);

  // 塗り。語ごとに書くが、値が変わるのは先端がいる語だけ(writeLyricWordSweep)
  const sweep = lyricSweepAt(row, t);
  for (let i = 0; i < spans.length; i++) writeLyricWordSweep(spans[i], sweep);

  // 光は位置を動かさないので丸めの問題が無い。濃さ(opacity)を毎フレーム書く。
  // 合成側のアニメーションにはしない: 動画モードでは合成側で動くものがあると
  // 画面の書き換えのたびに映像ごと合成し直す(createLyricWordMotion の注釈)。
  // ループで書けば回数を決められる(曲 60・動画 30)。
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i];
    if (!span._glow || !Number.isFinite(span._start)) continue;
    const env = bellCurve((t - span._empStart) / span._empDur);
    writeLyricGlow(span, env);
  }
};

// 文字同期(Apple Music 風)の語の span を target に並べる。
// 本編(.lyric-main)とハモリ(.lyric-bg)で同じ組み方をする。
const appendLyricWordSpans = (target, chars, lineEndSec) => {
  const wordSpans = [];
  const units = buildLyricWordUnits(chars, lineEndSec);
  for (const group of groupLyricUnitsIntoPhrases(units)) {
    // まとまりの頭と末尾の空白は包まずに外へ出す。inline-block の端の空白は
    // 潰れて幅が 0 になり、語と語の間が詰まって見える(実機: 韓国語の行が
    // 「멀리든언제든지달려와」、英語のハモリが「me,"Who」になっていた)。
    // 外に置けば、そこで折り返せる空白として残る。
    let from = 0;
    let to = group.length;
    while (from < to && group[from].type === 'space') from += 1;
    while (to > from && group[to - 1].type === 'space') to -= 1;
    const lead = group.slice(0, from).map(unit => unit.text).join('');
    const tail = group.slice(to).map(unit => unit.text).join('');
    const phrase = group.slice(from, to);
    if (lead) target.appendChild(document.createTextNode(lead));
    if (!phrase.length) {
      if (tail) target.appendChild(document.createTextNode(tail));
      continue;
    }
    // まとまりごとに inline-block で包む。折り返せるのはこの外側だけ。
    const phraseSpan = createEl('span', '', 'lyric-phrase lyric-phrase-sync');
    for (const unit of phrase) {
      if (unit.type === 'space') {
        phraseSpan.appendChild(document.createTextNode(unit.text));
        continue;
      }
      if (!unit.text) continue;
      const wordSpan = createEl('span', '', 'lyric-word');
      wordSpan.textContent = unit.text;
      wordSpan._times = unit.times;
      wordSpan._offsets = unit.offsets;
      wordSpan._start = unit.start;
      wordSpan._end = unit.end;
      wordSpan._emp = false;
      // PIP は innerHTML で複製するので JS のプロパティが消える。
      // 向こうで組み直せるように、時刻は属性にも書いておく。
      wordSpan.dataset.wt = unit.times
        .map(t => (t === null ? '' : t.toFixed(3))).join(',');
      if (Number.isFinite(unit.end)) wordSpan.dataset.we = unit.end.toFixed(3);
      phraseSpan.appendChild(wordSpan);
      wordSpans.push(wordSpan);
    }
    if (phraseSpan.childNodes.length) target.appendChild(phraseSpan);
    if (tail) target.appendChild(document.createTextNode(tail));
  }
  return wordSpans;
};

// ── ハモリ(バックボーカル)の行 ─────────────────────────────
// 取得元が印を付けたハモリ(api.js の makeBackgroundVocal)を、本編の下に
// 小さく薄い字で出す。文字同期なら本編と同じ塗りを、ハモリ自身の時刻で
// 走らせる(.lyric-bg を 1 本の「行」として扱い、塗りの先端を自分で持つ)。
// 文字同期でない表示では、字だけを出して行と一緒に点ける。
// 本編の外(.lyric-main の後ろ)に置くので、歌詞カードや Discord に渡す
// 本編の文字には混ざらない。
const buildLyricBackgroundRow = (bg, useWordSync) => {
  if (!bg || !Array.isArray(bg.chars) || !bg.chars.length) return null;
  const el = createEl('span', '', 'lyric-bg');
  if (useWordSync) {
    const endSec = getDynamicLineEndSec(bg);
    const spans = appendLyricWordSpans(el, bg.chars, typeof endSec === 'number' ? endSec : null);
    if (spans.length) {
      el._ytmWordSpans = spans;
      el.classList.add('ytm-bg-sync');
      return el;
    }
    el.textContent = '';
  }
  el.textContent = String(bg.text || bg.chars.map(ch => ch.c).join(''));
  return el;
};

// 行の中のハモリの塗り場所(PIP の複製は JS のプロパティを持たないのでクラスで拾う)
const lyricBackgroundHost = (row) => {
  if (row._ytmBgHost !== undefined) return row._ytmBgHost;
  row._ytmBgHost = row.querySelector('.lyric-bg.ytm-bg-sync') || null;
  return row._ytmBgHost;
};

// 計測は offsetLeft などを読むので、その場でレイアウトを1回確定させる。
// 行が主役になった瞬間にやると、ちょうど自動スクロールが走り出す所と
// 重なって一瞬つっかえる。描画が済んだ直後に、少しずつ先に済ませておく。
const prefetchLyricLineSweeps = (rows) => {
  const pending = rows.filter(r => r && !r._sweepReady);
  if (!pending.length) return;
  let index = 0;
  const step = () => {
    // 1フレームに詰め込みすぎると、そのフレームだけ伸びる
    const end = Math.min(index + 8, pending.length);
    const batch = [];
    for (; index < end; index++) {
      const row = pending[index];
      if (!row.isConnected || !row.offsetWidth) continue;
      // 複製されてきた行は語の情報を持っていないので、まず組み直す
      if (!row._ytmWordSpans && !row._ytmRehydrated) rehydrateLyricWordRow(row);
      if (!row._ytmWordSpans) continue;
      batch.push(row);
    }
    // 全部読んでから全部書く(書いた後に読むと、そのたびに再計算が走る)
    batch.map(readLyricLineSweep).forEach(applyLyricLineSweep);
    if (index < pending.length) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
};

// 窓の幅や UI サイズが変わると語の横位置が動く。測り直さないと
// 塗りの位置が字とずれたままになる。
const invalidateLyricLineSweeps = () => {
  for (const container of [ui.lyrics, PipManager.pipLyricsContainer]) {
    if (!container) continue;
    container.querySelectorAll('.lyric-line.ytm-word-sync, .lyric-bg.ytm-bg-sync')
      .forEach(row => { row._sweepReady = false; });
  }
};

const resetLyricWordRow = (row) => {
  const spans = row._ytmWordSpans;
  if (!spans || !spans.length) return;
  stopLyricWordMotion(row);
  row._sweepIndex = 0;
  for (let i = 0; i < spans.length; i++) {
    writeLyricWordSweep(spans[i], 0);
    if (spans[i]._emp) writeLyricGlow(spans[i], 0);
  }
};

// ── 従来式(1文字ずつ点灯)の表示 ──────────────────────────
// Apple Music 風を切った時と、低負荷モードの時に使う。
// 次の文字が無い(行末)ときに1文字へ割り当てる長さ
const CHAR_DEFAULT_SPAN_SEC = 0.35;

// ===================== Dynamic line post-processing =====================
// Some providers return Dynamic lyrics in "word chunks" (e.g. each char item is a whole word).
// We normalize them into true character-level timings by distributing each chunk's duration
// across its characters (1 char at a time).
function normalizeDynamicLinesToCharLevel(dynLines) {
  if (!Array.isArray(dynLines) || dynLines.length === 0) return dynLines;

  const toMs = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      if (!v.trim()) return null;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };

  const getLineStartMs = (line) => {
    if (!line) return null;
    return toMs(line.startTimeMs) ?? toMs(line.start_ms) ?? toMs(line.startMs) ?? toMs(line.time) ?? null;
  };

  const getCharStartMs = (ch) => {
    if (!ch) return null;
    return toMs(ch.t) ?? toMs(ch.startTimeMs) ?? toMs(ch.start_ms) ?? toMs(ch.startMs) ?? toMs(ch.time) ?? null;
  };

  const getCharText = (ch) => {
    if (!ch || typeof ch !== 'object') return '';
    const raw = [ch.c, ch.char, ch.text, ch.caption, ch.value]
      .find(value => value !== null && value !== undefined && String(value).length > 0) ?? '';
    return String(raw);
  };

  const isWordChunk = (s) => {
    if (typeof s !== 'string') return false;
    // Use Array.from to be Unicode-safe (emoji etc.)
    return Array.from(s).length > 1;
  };

  const expandChunk = (chunkText, startMs, endMs) => {
    const arr = Array.from(String(chunkText ?? ''));
    const n = arr.length;
    if (!n) return [];
    const s = (typeof startMs === 'number' && Number.isFinite(startMs)) ? startMs : null;
    const e = (typeof endMs === 'number' && Number.isFinite(endMs)) ? endMs : null;

    // If we can't determine timing, emit all at 0 (will appear immediately when line becomes active)
    if (s == null) return arr.map(c => ({ t: 0, c }));

    if (e == null || e <= s) return arr.map(c => ({ t: s, c }));

    const dur = Math.max(1, e - s);
    const step = dur / n;
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({ t: s + Math.floor(step * i), c: arr[i] });
    }
    return out;
  };

  for (let li = 0; li < dynLines.length; li++) {
    const line = dynLines[li];
    if (!line || !Array.isArray(line.chars) || line.chars.length === 0) continue;

    const rawLineStartMs = getLineStartMs(line) ?? getCharStartMs(line.chars[0]) ?? 0;
    line.chars = line.chars.map(ch => ({
      ...(ch || {}),
      c: getCharText(ch),
      t: getCharStartMs(ch) ?? rawLineStartMs,
    }));
    if (typeof line.text !== 'string' || !line.text) {
      line.text = line.chars.map(ch => ch.c).join('');
    }
    if (toMs(line.startTimeMs) === null) line.startTimeMs = rawLineStartMs;

    // detect if any "char" item is actually a multi-character chunk (word)
    const hasChunk = line.chars.some(ch => isWordChunk(ch?.c));
    if (!hasChunk) continue;

    const nextLineStartMs = (li + 1 < dynLines.length) ? getLineStartMs(dynLines[li + 1]) : null;
    const lineStartMs = getLineStartMs(line) ?? getCharStartMs(line.chars[0]) ?? 0;

    // Build expanded character list
    const expanded = [];
    for (let i = 0; i < line.chars.length; i++) {
      const seg = line.chars[i];
      const segText = (seg && typeof seg.c === 'string') ? seg.c : '';
      const segStart = getCharStartMs(seg) ?? lineStartMs;

      // End bound is next segment's start, else next line, else a small fallback window
      let segEnd = (i + 1 < line.chars.length) ? getCharStartMs(line.chars[i + 1]) : null;
      if (segEnd == null) segEnd = toMs(line.endTimeMs) ?? nextLineStartMs ?? (segStart + 1500);
      if (typeof segEnd === 'number' && segEnd <= segStart) segEnd = segStart + 200;

      // Even if segText is already single "character", keep it as-is
      const segArr = Array.from(String(segText));
      if (segArr.length <= 1) {
        if (segArr.length === 1) expanded.push({ t: segStart, c: segArr[0] });
        continue;
      }

      expanded.push(...expandChunk(segText, segStart, segEnd));
    }

    // Replace with normalized chars
    line.chars = expanded;
    // Update line text if missing or mismatched
    try {
      const rebuilt = expanded.map(x => x.c).join('');
      if (typeof line.text !== 'string' || line.text.length === 0) line.text = rebuilt;
    } catch (e) { }

    // Ensure startTimeMs exists
    if (typeof line.startTimeMs !== 'number' || !Number.isFinite(line.startTimeMs)) {
      const firstT = expanded.length ? expanded[0].t : lineStartMs;
      line.startTimeMs = firstT;
    }
  }

  return dynLines;
}

// ── 行の終わり時刻を持たないデータの補完 ──────────────────
// 終わり時刻が無い時、これまでは一律「最後の文字 + 0.2 秒」を行の終わりに
// していた。伸ばして歌っている最後の音が0.2秒で塗り終わってしまい、
// 間奏に入る行ほど不自然に見える。かといって次の行頭まで伸ばすと、
// 間奏の長さぶん塗り続けることになる。行と行の間の空きは無音であって、
// そのぶん歌が伸びているわけではない。
//
// その行自身の文字の進み方から1文字ぶんの長さを見積もり、
// 次の行に食い込まない範囲に収める。
const DYNAMIC_TAIL_MIN_MS = 200;
const DYNAMIC_TAIL_MAX_MS = 900;
const DYNAMIC_TAIL_GUARD_MS = 50;

// 正規化は行をその場で書き換えるので、必ず複製に対して行う。
const deepCopyDynamicLines = (lines) => {
  if (!Array.isArray(lines)) return lines;
  try {
    return structuredClone(lines);
  } catch (e) {
    try { return JSON.parse(JSON.stringify(lines)); } catch (e2) { return lines; }
  }
};

const dynamicLineCharTimes = (line) => (
  (Array.isArray(line?.chars) ? line.chars : [])
    .map(char => (typeof char?.t === 'number' && Number.isFinite(char.t) ? char.t : null))
    .filter(t => t !== null)
    .sort((a, b) => a - b)
);

const fillDynamicLineEnds = (lines) => {
  if (!Array.isArray(lines)) return lines;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || typeof line !== 'object') continue;
    // もともと終わりを持っているデータには触らない
    const declared = [line.endTimeMs, line.end_ms, line.endMs, line.endTime]
      .map(v => Number(v))
      .find(v => Number.isFinite(v));
    if (Number.isFinite(declared)) continue;

    const times = dynamicLineCharTimes(line);
    if (times.length < 2) continue;
    const last = times[times.length - 1];

    const gaps = [];
    for (let k = 1; k < times.length; k++) {
      if (times[k] > times[k - 1]) gaps.push(times[k] - times[k - 1]);
    }
    if (!gaps.length) continue;
    gaps.sort((a, b) => a - b);
    // 中央値なので、行の中に伸ばした音が1つあっても引きずられない
    const typical = gaps[Math.floor(gaps.length / 2)];

    let tail = Math.min(DYNAMIC_TAIL_MAX_MS, Math.max(DYNAMIC_TAIL_MIN_MS, typical));

    const nextTimes = dynamicLineCharTimes(lines[i + 1]);
    const nextStart = nextTimes.length ? nextTimes[0] : null;
    if (typeof nextStart === 'number') {
      // 隙間より下限を優先すると次の行に食い込む。空きが無い行は触らない。
      const room = nextStart - last - DYNAMIC_TAIL_GUARD_MS;
      if (room <= 0) continue;
      tail = Math.min(tail, room);
    }

    line.endTimeMs = last + tail;
    // getDynamicLineEndSec がキャッシュしているので落としておく
    if (typeof line.__ytmEndSec === 'number') delete line.__ytmEndSec;
  }

  return lines;
};

async function applyLyricsText(rawLyrics) {
  const keyAtStart = currentKey;
  const videoIdAtStart = currentLyricsVideoId;
  const applyEpoch = ++lyricsApplyEpoch;
  if (!rawLyrics || typeof rawLyrics !== 'string' || !rawLyrics.trim()) {
    if (keyAtStart !== currentKey || videoIdAtStart !== currentLyricsVideoId || applyEpoch !== lyricsApplyEpoch) return;
    lyricsData = [];
    hasTimestamp = false;
    animatedCaptionData = null;
    renderLyrics([]);
    refreshMeaningUi();
    return;
  }
  lastRawLyricsText = rawLyrics;
  const timedTextData = parseTimedTextAnimation(rawLyrics);
  let parsed = null;
  if (timedTextData) {
    if (config.useAnimatedCaptions && !hasCharacterSyncedLines(dynamicLines)) {
      const canonicalLyrics = String(currentSingerCanonicalLyrics || '');
      const canonicalSingerLines = canonicalLyrics.trim()
        ? parseLRCInternal(canonicalLyrics).lines
        : [];
      // 歌手メタデータはsrv3とは別APIから遅れて到着する。以前はその時点で
      // canonical LRCへ描画を切り替えていたため、Animated TimedTextが一瞬だけ
      // 表示されて通常歌詞へ戻っていた。自由配置のsrv3を表示ソースとして維持し、
      // 行メタデータだけをplainLinesへ対応付ける。
      lyricsData = applySingerMetadataToLines(
        timedTextData.plainLines || [],
        currentSingerMetadata,
        {
          canonicalLines: canonicalSingerLines,
          sameSource: !canonicalLyrics.trim() || canonicalLyrics.trim() === rawLyrics.trim(),
        }
      );
      timedTextData.plainLines = lyricsData;
      dynamicLines = null;
      duetSubDynamicLines = null;
      renderAnimatedTimedText(timedTextData);
      if (lyricsData.length) emphasizeSummaryButtonAfterLyricsLoad();
      refreshMeaningUi();
      if (meaningPanelVisible) syncMeaningPanelToPlayback(true);
      return;
    }
    animatedCaptionData = null;
    hasTimestamp = true;
    parsed = timedTextData.plainLines || [];
  } else {
    animatedCaptionData = null;
    parsed = parseBaseLRC(rawLyrics);
  }
  // 歌手メタデータの照合はパース直後の行番号を前提にしているので、
  // 見出し行を落とす前の並びを別に取っておく。
  const parsedWithHeaders = parsed;
  parsed = stripLeadingHeaderLines(parsed, String(keyAtStart || '').split('///')[0]);
  const videoUrl = getCurrentVideoUrl();

  // duet: if sub.txt exists, hide (filter) the normal lines that match sub timestamps,
  // and render the sub lines on the right.
  let baseLines = parsed;
  let hasDuetSub = false;

  // デュエットモードのリセット（sub.txtがない場合は除外タイムスタンプもクリア）
  _duetExcludedTimes = new Set();

  if (typeof duetSubLyricsRaw === 'string' && duetSubLyricsRaw.trim()) {
    const subObj = parseSubLRC(duetSubLyricsRaw);
    const subLines = subObj.lines || [];
    hasDuetSub = !!subObj.hasTs && subLines.some(l => typeof l?.time === 'number');
    if (hasDuetSub) {
      // even if the main lyrics didn't have tags, duet sub implies timestamp mode
      hasTimestamp = true;
      baseLines = mergeDuetLinesWithSimultaneousSupport(parsed, subLines);
    }
  }
  document.body.classList.toggle('ytm-duet-mode', hasDuetSub);

  let finalLines = baseLines;
  if (!config.useTrans) {
    syncBuiltinDownloadPrompt(null);
    setTranslationEngineBadge(null);
  }
  if (config.useTrans) {
    const translated = await applyTranslations(baseLines, videoUrl);
    // applyTranslations rebuilds objects, so re-attach duetSide by index
    if (Array.isArray(translated) && Array.isArray(baseLines) && translated.length === baseLines.length) {
      finalLines = translated.map((l, i) => ({ ...l, duetSide: baseLines[i]?.duetSide }));
    } else {
      finalLines = translated;
    }
  }
  if (
    keyAtStart !== currentKey ||
    videoIdAtStart !== currentLyricsVideoId ||
    applyEpoch !== lyricsApplyEpoch
  ) return;

  const canonicalLyrics = String(currentSingerCanonicalLyrics || '');
  const canonicalLines = canonicalLyrics.trim()
    ? parseLRCInternal(canonicalLyrics).lines
    : parsedWithHeaders;
  finalLines = applySingerMetadataToLines(finalLines, currentSingerMetadata, {
    canonicalLines,
    sameSource: !canonicalLyrics.trim() || canonicalLyrics.trim() === rawLyrics.trim(),
  });
  finalLines = collapseCrossSideDuplicateLyrics(finalLines);

  // Normalize Dynamic lyrics: expand "word chunks" into character-level timings
  //
  // 正規化は行オブジェクトをその場で書き換える。生データのまま持っておかないと、
  // あとから届いたレスポンスと JSON.stringify で比べた時に必ず不一致になり、
  // 同じ歌詞でも毎回 renderLyrics が走ってスクロール位置が飛ぶ。
  // キャッシュに入る中身も「正規化前/後」のどちらか不定になっていた。
  try {
    if (Array.isArray(dynamicLines) && dynamicLines.length) {
      dynamicLinesRaw = dynamicLines;
      // 行の終わりを埋めるのは「語を字に割る前」。
      //
      // 割る側は、行の最後の語の終端が分からないと「次の行が始まるまで」で
      // 引き延ばす。あとから埋めても手遅れで、間奏に入る行では最後の語が
      // 数秒かけて塗られていた(実測: KuGou の英語曲で最大 9.1 秒、
      // 14 行が1秒超)。割る前に埋めておけば、その終端が使われる。
      //
      // 割ったあとにもう一度呼ぶのは、語がひとつしか無くて前半で
      // 埋められなかった行を拾うため。既に終わりを持つ行には触らない。
      dynamicLines = fillDynamicLineEnds(
        normalizeDynamicLinesToCharLevel(fillDynamicLineEnds(deepCopyDynamicLines(dynamicLines))),
      );
    } else {
      dynamicLinesRaw = dynamicLines;
    }
  } catch (e) { }

  // 注意: ここで timeOffset を 0 にリセットしてはいけない。
  // 連続再生（currentTime がリセットされない）対応のため、曲開始オフセットは
  // tick() で設定された値を保持する。リセット再生の場合は RAF ループ側で
  // currentTime が offset を下回った時点で自動的に 0 に補正される。

  lyricsData = finalLines;
  renderLyrics(finalLines);
  if (finalLines.length) emphasizeSummaryButtonAfterLyricsLoad();
  refreshMeaningUi();
  if (meaningPanelVisible) syncMeaningPanelToPlayback(true);
}

// ===================== 歌詞候補・ロック関連 =====================

const getCandidateId = (cand, idx = 0) => {
  if (!cand || typeof cand !== 'object') return String(idx);
  return String(cand.id || cand.candidate_id || cand.path || cand.file || cand.filename || cand.name || cand.title || idx);
};

// 取得元をまたいだ候補の合流。「足す」だけで、今出ている候補や
// 選択状態には触らない。追加できた件数を返す。
const mergeLyricsCandidates = (incoming) => {
  if (!Array.isArray(incoming) || !incoming.length) return 0;
  const merged = Array.isArray(lyricsCandidates) ? lyricsCandidates.slice() : [];
  const knownIds = new Set(merged.map((cand, idx) => getCandidateId(cand, idx)));
  let added = 0;
  incoming.forEach(cand => {
    const id = cand && cand.id ? String(cand.id) : '';
    if (!id || knownIds.has(id)) return;
    knownIds.add(id);
    merged.push(cand);
    added += 1;
  });
  if (added) lyricsCandidates = merged;
  return added;
};

// YouTube Music は background を通らない(Service Worker の fetch は
// Origin: chrome-extension:// が付いて 403 で弾かれるため、content script が
// 直接叩いている)。そのぶん background が組む候補一覧にも入らないので、
// ここで他の取得元と同じ形に均して合流させる。
// これが無いと、取得だけして捨てているのにメニューには出てこない、という
// 状態になる(LRCHub優先では結果を見てすらいなかった)。
const YTM_CANDIDATE_ID = 'provider_ytm';

const buildYtmCandidate = (res) => {
  const lyrics = typeof res?.lyrics === 'string' ? res.lyrics.trim() : '';
  if (!lyrics) return null;
  // background の buildProviderCandidate と同じ形に揃える。
  // record_id は持たない = LRCHub のレコードではないので、選んでも
  // 追加取得も「この候補を選んだ」報告も走らない。
  return {
    id: YTM_CANDIDATE_ID,
    label: LYRICS_SOURCE_LABELS.ytm,
    providerCandidate: true,
    lyricsSource: 'ytm',
    lyrics,
    dynamicLines: null,
    animated_lyrics: null,
    record_id: null,
    lyricsComplete: true,
    has_synced: !!res.hasSynced,
    offset_ms: 0,
  };
};

// 時刻なしで出したあとから同期版が見つかることがある(別リリース探索)。
// 同じものを2つ並べず、同期版で置き換える。
const offerYtmCandidate = (res) => {
  const cand = buildYtmCandidate(res);
  if (!cand) return false;
  const list = Array.isArray(lyricsCandidates) ? lyricsCandidates : [];
  const at = list.findIndex((c, i) => getCandidateId(c, i) === YTM_CANDIDATE_ID);
  if (at < 0) return mergeLyricsCandidates([cand]) > 0;
  if (!cand.has_synced || list[at].has_synced) return false;
  const next = list.slice();
  next[at] = cand;
  lyricsCandidates = next;
  return true;
};

const getCandidateRecordId = (candidate) => {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = candidate.record_id || candidate.recordId ||
    candidate.provider_meta?.record_id || candidate.provider_meta?.recordId ||
    candidate.providerMeta?.record_id || candidate.providerMeta?.recordId ||
    candidate.candidate_id ||
    candidate.lyrics_id || candidate.lyric_id || candidate.record?.record_id ||
    candidate.record?.recordId || candidate.record?.id || null;
  return id === null || id === undefined || id === '' ? null : String(id);
};

// 候補が持っている同期の粒度。selectLyricsPayload と違って表示設定には
// 依らせない。見せたいのは「この候補が何を持っているか」なので。
// 中身がまだ読み込まれていない候補(LRCHub の検索結果など)は null を返す。
const describeCandidateSync = (cand) => {
  if (!cand || typeof cand !== 'object') return null;
  const animated = cand.animated_lyrics || cand.timedtext || cand.timed_text;
  if (typeof animated === 'string' && animated.trim()) return '字幕同期';
  if (hasCharacterSyncedLines(cand.dynamicLines)) return '単語同期';
  const lyrics = typeof cand.lyrics === 'string' ? cand.lyrics : '';
  if (lyrics.trim()) {
    return /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(lyrics) ? '行同期' : '時刻なし';
  }
  // 歌詞本体をまだ持っていない候補。has_synced だけは分かることがある
  if (cand.lyricsComplete !== true) {
    return cand.has_synced === true ? '行同期以上' : null;
  }
  return null;
};

const buildCandidateLabel = (cand, idx = 0) => {
  if (!cand || typeof cand !== 'object') return `候補${idx + 1}`;

  // 取得元をまたいだ候補は表示名をそのまま使う。
  // 下のファイル名処理はパス区切りで切り詰めるので通せない。
  if (typeof cand.label === 'string' && cand.label.trim()) return cand.label.trim();

  const rawName = (
    cand.file ||
    cand.filename ||
    cand.name ||
    cand.path ||
    cand.select ||
    cand.list ||
    cand.candidate_id ||
    cand.id ||
    ''
  );

  const normalized = String(rawName || '').trim().replace(/\\/g, '/');
  const labelText = normalized ? normalized.split('/').pop() : `候補${idx + 1}`;
  return labelText;
};

const safeRuntimeSendMessage = (message) => {
  return new Promise((resolve) => {
    try {
      if (!EXT || !EXT.runtime || typeof EXT.runtime.sendMessage !== 'function') {
        resolve(null);
        return;
      }
      EXT.runtime.sendMessage(message, (resp) => {
        const err = EXT.runtime && EXT.runtime.lastError ? EXT.runtime.lastError : null;
        if (err) {
          console.warn('[CS] runtime.sendMessage failed:', err.message || err);
          resolve({ success: false, error: err.message || String(err) });
          return;
        }
        resolve(resp || null);
      });
    } catch (e) {
      console.warn('[CS] runtime.sendMessage exception:', e);
      resolve({ success: false, error: String(e) });
    }
  });
};

const refreshRenderedSingerMetadata = async () => {
  const canonicalLyrics = String(currentSingerCanonicalLyrics || '');
  const renderedLyrics = String(lastRawLyricsText || '');
  const canonicalLines = canonicalLyrics.trim()
    ? parseLRCInternal(canonicalLyrics).lines
    : [];

  // Animated captions own their free-positioned stage. Singer metadata arrives
  // asynchronously, so update only the semantic line mapping and leave that
  // stage intact; renderLyrics() would remove ytm-animated-caption-mode.
  if (
    animatedCaptionData &&
    document.body.classList.contains('ytm-animated-caption-mode')
  ) {
    const animatedLines = Array.isArray(animatedCaptionData.plainLines)
      ? animatedCaptionData.plainLines
      : (Array.isArray(lyricsData) ? lyricsData : []);
    lyricsData = applySingerMetadataToLines(animatedLines, currentSingerMetadata, {
      canonicalLines,
      sameSource: !canonicalLyrics.trim() || canonicalLyrics.trim() === renderedLyrics.trim(),
    });
    animatedCaptionData.plainLines = lyricsData;
    return;
  }

  if (!Array.isArray(lyricsData) || !lyricsData.length) return;
  const sameSource = !canonicalLyrics.trim() || canonicalLyrics.trim() === renderedLyrics.trim();
  lyricsData = applySingerMetadataToLines(lyricsData, currentSingerMetadata, {
    canonicalLines,
    sameSource,
  });
  renderLyrics(lyricsData);
};

const requestSingerMetadataForLyrics = async (recordId, canonicalLyrics, identity = {}) => {
  const normalizedRecordId = String(recordId || '').trim();
  const targetKey = identity.trackKey || currentKey;
  const targetVideoId = String(identity.videoId ?? currentLyricsVideoId ?? getCurrentVideoId() ?? '');
  const nextCanonicalLyrics = typeof canonicalLyrics === 'string' ? canonicalLyrics : '';
  if (
    targetKey !== currentKey ||
    targetVideoId !== String(currentLyricsVideoId || '')
  ) return null;

  const requestKey = normalizedRecordId
    ? `${targetKey || ''}///${targetVideoId}///${normalizedRecordId}`
    : '';
  const canonicalChanged = nextCanonicalLyrics !== currentSingerCanonicalLyrics;
  const metadataContextChanged = requestKey !== currentSingerMetadataKey;

  currentLyricsRecordId = normalizedRecordId || null;
  currentSingerCanonicalLyrics = nextCanonicalLyrics;
  if (metadataContextChanged) currentSingerMetadata = null;

  if (!normalizedRecordId) {
    singerMetadataRequestSequence += 1;
    singerMetadataRequestKey = '';
    currentSingerMetadataKey = '';
    currentSingerMetadata = null;
    await refreshRenderedSingerMetadata();
    return null;
  }
  if (!metadataContextChanged && currentSingerMetadata) {
    if (canonicalChanged) await refreshRenderedSingerMetadata();
    return currentSingerMetadata;
  }

  if (singerMetadataRequestKey === requestKey) return null;
  singerMetadataRequestKey = requestKey;
  const requestSequence = ++singerMetadataRequestSequence;
  const response = await safeRuntimeSendMessage({
    type: 'GET_LYRIC_SINGERS',
    payload: {
      record_id: normalizedRecordId,
      video_id: targetVideoId || null,
      youtube_url: getCurrentVideoUrl(),
    },
  });

  if (requestSequence !== singerMetadataRequestSequence) return null;
  singerMetadataRequestKey = '';
  if (
    targetKey !== currentKey ||
    targetVideoId !== String(currentLyricsVideoId || '') ||
    normalizedRecordId !== String(currentLyricsRecordId || '')
  ) return null;

  const metadata = response?.success && response.singerMetadata && typeof response.singerMetadata === 'object'
    ? response.singerMetadata
    : null;
  if (metadata?.record_id && String(metadata.record_id) !== normalizedRecordId) return null;
  if (metadata) {
    currentSingerMetadata = metadata;
    currentSingerMetadataKey = requestKey;
  } else if (currentSingerMetadataKey !== requestKey) {
    currentSingerMetadata = null;
  }
  await refreshRenderedSingerMetadata();
  return currentSingerMetadata;
};

const formatPreviewTime = (seconds) => {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

const getCurrentPlaybackSeconds = () => {
  try {
    const v = document.querySelector('video');
    if (v && Number.isFinite(v.currentTime)) {
      // 連続再生対応: 曲開始オフセットを引いて曲内ローカル時間で返す
      return toLocalPlaybackTime(v.currentTime);
    }
  } catch (e) { }
  return null;
};

const getCurrentRenderedLyricText = () => {
  if (lastActiveIndex >= 0 && Array.isArray(lyricsData) && lyricsData[lastActiveIndex]) {
    const line = lyricsData[lastActiveIndex];
    const txt = String(line.text || line.rawLine || '').trim();
    if (txt) return txt;
  }
  try {
    const activeRow = ui.lyrics ? ui.lyrics.querySelector('.lyric-line.active .lyric-main, .lyric-line.active') : null;
    return activeRow && activeRow.textContent ? activeRow.textContent.trim() : '';
  } catch (e) {
    return '';
  }
};

const getCurrentRenderedLyricIndex = () => {
  if (!Array.isArray(lyricsData) || !lyricsData.length) return -1;
  if (Number.isInteger(lastActiveIndex) && lastActiveIndex >= 0) {
    let nonEmptyIndex = -1;
    for (let i = 0; i <= Math.min(lastActiveIndex, lyricsData.length - 1); i++) {
      const txt = String(lyricsData[i]?.text || lyricsData[i]?.rawLine || '').trim();
      if (txt) nonEmptyIndex += 1;
    }
    return nonEmptyIndex;
  }
  return -1;
};

const pickPreviewInfoFromLyrics = (rawLyrics) => {
  const txt = typeof rawLyrics === 'string' ? rawLyrics.trim() : '';
  if (!txt) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };

  const parsed = parseLRCNoFlag(txt);
  const nonEmpty = Array.isArray(parsed)
    ? parsed.filter(line => line && typeof line.text === 'string' && line.text.trim())
    : [];

  if (!nonEmpty.length) {
    const plain = txt.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!plain.length) return { line: '', mode: 'empty', lineIndex: -1, total: 0 };
    return { line: plain[0], mode: 'plain-first', lineIndex: 0, total: plain.length };
  }

  const currentSeconds = getCurrentPlaybackSeconds();
  const hasTs = nonEmpty.some(line => typeof line.time === 'number' && Number.isFinite(line.time));

  if (hasTs && typeof currentSeconds === 'number') {
    let foundIndex = 0;
    for (let i = 0; i < nonEmpty.length; i++) {
      const t = nonEmpty[i] && typeof nonEmpty[i].time === 'number' ? nonEmpty[i].time : null;
      if (t == null) continue;
      if (t > currentSeconds) break;
      foundIndex = i;
    }
    return {
      line: String(nonEmpty[foundIndex].text || '').trim(),
      mode: 'timestamp',
      lineIndex: foundIndex,
      total: nonEmpty.length
    };
  }

  const currentLineIndex = getCurrentRenderedLyricIndex();
  if (currentLineIndex >= 0) {
    const idx = Math.max(0, Math.min(currentLineIndex, nonEmpty.length - 1));
    return {
      line: String(nonEmpty[idx].text || '').trim(),
      mode: 'current-line-index',
      lineIndex: idx,
      total: nonEmpty.length
    };
  }

  try {
    const v = document.querySelector('video');
    if (v && Number.isFinite(v.currentTime) && Number.isFinite(v.duration) && v.duration > 0) {
      // 連続再生対応: 曲内ローカル時間で進捗比率を計算
      const localTime = toLocalPlaybackTime(v.currentTime);
      const ratio = Math.max(0, Math.min(1, localTime / v.duration));
      const idx = Math.max(0, Math.min(nonEmpty.length - 1, Math.round((nonEmpty.length - 1) * ratio)));
      return {
        line: String(nonEmpty[idx].text || '').trim(),
        mode: 'progress-ratio',
        lineIndex: idx,
        total: nonEmpty.length
      };
    }
  } catch (e) { }

  return {
    line: String(nonEmpty[0].text || '').trim(),
    mode: 'plain-first',
    lineIndex: 0,
    total: nonEmpty.length
  };
};

async function ensureCandidateLyricsLoaded(candId) {
  if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return null;
  const candidateListAtStart = lyricsCandidates;
  const candidateKeyAtStart = currentKey;
  const candidateVideoAtStart = currentLyricsVideoId || getCurrentVideoId() || '';
  const idx = lyricsCandidates.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
  if (idx < 0) return null;
  const cand = lyricsCandidates[idx];
  const candidateHasLyrics = cand && typeof cand.lyrics === 'string' && cand.lyrics.trim();
  const candidateHasRecordReference = !!(
    cand?.record_id || cand?.recordId || cand?.candidate_id || cand?.lyrics_id ||
    cand?.lyric_id || cand?.record?.id || cand?.record?.record_id || cand?.record?.recordId
  );
  const candidateNeedsFullRecord = candidateHasRecordReference && cand?.lyricsComplete !== true;
  const candidateAdvertisesDynamic = !!(
    cand?.has_dynamic ||
    cand?.hasDynamic ||
    cand?.dynamic_lrc ||
    cand?.dynamic_lyrics ||
    cand?.dynamicLrc ||
    cand?.dynamicLyrics
  );
  const candidateNeedsDynamic = candidateAdvertisesDynamic && !hasCharacterSyncedLines(cand?.dynamicLines);
  if (candidateHasLyrics && !candidateNeedsDynamic && !candidateNeedsFullRecord) return cand;

  const payload = {
    youtube_url: getCurrentVideoUrl(),
    video_id: candidateVideoAtStart,
    translate_to: getRequestedLrchubTranslateLangs(),
    candidate_id: getCandidateId(cand, idx),
    candidate: cand || null
  };
  YTMLog.log('[CS] GET_CANDIDATE_LYRICS request:', payload);
  const res = await safeRuntimeSendMessage({ type: 'GET_CANDIDATE_LYRICS', payload });
  YTMLog.log('[CS] GET_CANDIDATE_LYRICS response:', res);
  if (
    currentKey !== candidateKeyAtStart ||
    (currentLyricsVideoId || getCurrentVideoId() || '') !== candidateVideoAtStart ||
    lyricsCandidates !== candidateListAtStart
  ) return null;
  const hasResponseLyrics = typeof res?.lyrics === 'string' && res.lyrics.trim();
  const hasResponseAnimatedLyrics = typeof res?.animated_lyrics === 'string' && res.animated_lyrics.trim();
  if (res && res.success && (hasResponseLyrics || hasResponseAnimatedLyrics)) {
    const next = {
      ...(cand || {}),
      record_id: res.record_id || cand?.record_id || cand?.recordId || null,
      lyrics: res.lyrics || cand?.lyrics || '',
      lyricsComplete: res.lyricsComplete === true,
      animated_lyrics: res.animated_lyrics || cand?.animated_lyrics || null,
      dynamicLines: hasCharacterSyncedLines(res.dynamicLines) ? res.dynamicLines : null,
      offset_ms: Number.isFinite(Number(res.offset_ms)) ? Number(res.offset_ms) : 0,
      lyricsSource: res.lyricsSource || 'lrchub',
      fallbackUsed: false,
      meaningData: res.meaningData || cand?.meaningData || null,
      songSummary: res.songSummary || cand?.songSummary || null,
      comments: Array.isArray(res.comments) ? res.comments : (Array.isArray(cand?.comments) ? cand.comments : []),
      rating: res.rating || cand?.rating || null,
      translations: res.translations || cand?.translations || null,
      lrcMap: res.lrcMap || cand?.lrcMap || null,
      has_synced: typeof res.has_synced === 'boolean' ? res.has_synced : !!/\[\d+:\d{2}(?:\.\d{1,3})?\]/.test(res.lyrics)
    };
    lyricsCandidates[idx] = next;
    return next;
  }
  return cand || null;
}

function ensureCandidateHoverPreview() {
  let el = document.getElementById('ytm-candidate-hover-preview');
  const parent = ui.uploadMenu || document.body;
  if (!el) {
    el = document.createElement('div');
    el.id = 'ytm-candidate-hover-preview';
    el.innerHTML = `
        <div class="ytm-candidate-hover-preview-title"></div>
        <div class="ytm-candidate-hover-preview-line"></div>
        <div class="ytm-candidate-hover-preview-meta"></div>
        <div class="ytm-candidate-hover-preview-current"></div>
      `;
    parent.appendChild(el);
  } else if (el.parentElement !== parent) {
    parent.appendChild(el);
  }
  return el;
}

function updateCandidateHoverPreviewPosition(clientX, clientY, anchorEl) {
  const el = ensureCandidateHoverPreview();
  if (!el) return;
  if (ui.uploadMenu && el.parentElement === ui.uploadMenu) {
    const menuRect = ui.uploadMenu.getBoundingClientRect();
    const anchorRect = (anchorEl || hoverPreviewAnchorEl || ui.uploadMenu).getBoundingClientRect();
    const height = el.offsetHeight || 180;
    const maxTop = Math.max(8, ui.uploadMenu.offsetHeight - height - 8);
    const desiredTop = Math.max(8, Math.min(maxTop, anchorRect.top - menuRect.top - 8));
    el.style.top = `${desiredTop}px`;
    el.style.left = 'auto';
    el.style.right = `calc(100% + 12px)`;
    return;
  }
  const pad = 18;
  const width = el.offsetWidth || 360;
  const height = el.offsetHeight || 160;
  let left = clientX + pad;
  let top = clientY + pad;
  if (left + width > window.innerWidth - 12) left = Math.max(12, clientX - width - pad);
  if (top + height > window.innerHeight - 12) top = Math.max(12, clientY - height - pad);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function renderCandidateHoverPreview(candId) {
  const el = ensureCandidateHoverPreview();
  if (!el || !candId) return;
  const list = Array.isArray(lyricsCandidates) ? lyricsCandidates : [];
  const idx = list.findIndex((cand, i) => getCandidateId(cand, i) === String(candId));
  if (idx < 0) return;
  const cand = list[idx];
  const titleEl = el.querySelector('.ytm-candidate-hover-preview-title');
  const lineEl = el.querySelector('.ytm-candidate-hover-preview-line');
  const metaEl = el.querySelector('.ytm-candidate-hover-preview-meta');
  const currentEl = el.querySelector('.ytm-candidate-hover-preview-current');
  const info = pickPreviewInfoFromLyrics(cand && cand.lyrics ? cand.lyrics : '');
  const currentLine = getCurrentRenderedLyricText();
  const currentSeconds = getCurrentPlaybackSeconds();

  if (titleEl) titleEl.textContent = buildCandidateLabel(cand, idx);

  if (lineEl) {
    if (info.line) lineEl.textContent = info.line;
    else if (hoverPreviewLoading) lineEl.textContent = '候補の歌詞データを読み込み中...';
    else lineEl.textContent = 'この候補の歌詞データを表示できませんでした';
  }

  if (metaEl) {
    const parts = [];
    if (typeof currentSeconds === 'number') parts.push(`再生位置 ${formatPreviewTime(currentSeconds)}`);
    if (info.total > 0 && info.lineIndex >= 0) parts.push(`行 ${info.lineIndex + 1}/${info.total}`);
    if (info.mode === 'timestamp') parts.push('候補自身の同期位置');
    else if (info.mode === 'current-line-index') parts.push('現在の表示行に追従');
    else if (info.mode === 'progress-ratio') parts.push('再生率から推定');
    else if (info.mode === 'plain-first') parts.push('先頭行を表示');
    metaEl.textContent = parts.join(' / ');
  }

  if (currentEl) {
    currentEl.textContent = currentLine ? `現在表示中: ${currentLine}` : '';
  }

  updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY);
  el.classList.add('visible');
}

function startCandidateHoverPreviewLoop() {
  if (hoverPreviewRafId) return;
  const tick = () => {
    if (!hoverPreviewCandidateId) {
      hoverPreviewRafId = null;
      return;
    }
    renderCandidateHoverPreview(hoverPreviewCandidateId);
    hoverPreviewRafId = requestAnimationFrame(tick);
  };
  hoverPreviewRafId = requestAnimationFrame(tick);
}

async function showCandidateHoverPreview(candId, ev) {
  if (!candId) return;
  hoverPreviewCandidateId = candId;
  hoverPreviewAnchorEl = ev?.currentTarget || ev?.target?.closest?.('.ytm-upload-menu-item-candidate') || hoverPreviewAnchorEl;
  hoverPreviewMouseX = ev?.clientX ?? hoverPreviewMouseX;
  hoverPreviewMouseY = ev?.clientY ?? hoverPreviewMouseY;
  hoverPreviewLoading = true;
  YTMLog.log('[CS] hover preview start:', candId);
  const el = ensureCandidateHoverPreview();
  if (el) {
    renderCandidateHoverPreview(candId);
    updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
    el.classList.add('visible');
  }
  startCandidateHoverPreviewLoop();
  const cand = await ensureCandidateLyricsLoaded(candId);
  if (hoverPreviewCandidateId !== candId) return;
  hoverPreviewLoading = false;
  renderCandidateHoverPreview(candId);
}

function hideCandidateHoverPreview() {
  hoverPreviewCandidateId = null;
  hoverPreviewLoading = false;
  hoverPreviewAnchorEl = null;
  if (hoverPreviewRafId) {
    cancelAnimationFrame(hoverPreviewRafId);
    hoverPreviewRafId = null;
  }
  const el = document.getElementById('ytm-candidate-hover-preview');
  if (el) el.classList.remove('visible');
}

// ── 他の取得元をその場で探す ──────────────────────────────
// 通常の取得は LRCHub が答えた時点で他へ問い合わせずに切り上げる。
// おかげで無駄な通信は無いが、その歌詞が曲に合っていなかった時に
// 乗り換え先が1件も無い状態になる。ここはユーザーが明示的に頼んだ時
// だけ走る道で、自動では絶対に呼ばない。
let alternateLookupInFlight = false;
async function findAlternateLyricSources() {
  if (alternateLookupInFlight) return;
  const meta = getMetadata();
  if (!meta || !meta.title) {
    showToast('曲の情報が取れませんでした');
    return;
  }

  const requestKey = currentKey;
  const requestVideoId = currentLyricsVideoId || getCurrentVideoId() || '';

  // すでに手元にある取得元は聞き直さない
  const known = new Set(
    (Array.isArray(lyricsCandidates) ? lyricsCandidates : [])
      .filter(cand => cand && cand.providerCandidate)
      .map(cand => String(cand.lyricsSource || '').trim().toLowerCase())
      .filter(Boolean)
  );
  if (currentLyricsSource) known.add(currentLyricsSource);

  alternateLookupInFlight = true;
  showToast('他の取得元を探しています...');
  try {
    // 動画モードでは音源で引く(GET_LYRICS と同じ。resolveMovieLookupSong)
    const movieSong = await resolveMovieLookupSong(requestVideoId);
    const videoEl = document.querySelector('video');
    const durationSec = (movieSong && movieSong.durationSec)
      || ((videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0)
        ? Math.round(videoEl.duration)
        : null);
    const res = await safeRuntimeSendMessage({
      type: 'FIND_ALTERNATE_LYRICS',
      payload: {
        track: (movieSong && movieSong.title) || meta.title,
        artist: meta.artist || '',
        album: meta.album || '',
        duration_sec: durationSec,
        youtube_url: movieSong ? `https://youtu.be/${movieSong.videoId}` : getCurrentVideoUrl(),
        video_id: movieSong ? movieSong.videoId : requestVideoId,
        exclude: [...known],
      },
    });

    // 探している間に曲が変わっていたら、その結果はもう別の曲のもの
    if (
      requestKey !== currentKey ||
      requestVideoId !== (currentLyricsVideoId || getCurrentVideoId() || '')
    ) return;

    const added = mergeLyricsCandidates(res?.candidates);
    if (!added) {
      showToast('他の取得元には歌詞がありませんでした');
      return;
    }

    refreshCandidateMenu();
    showToast(`他の取得元を ${added} 件見つけました`);
    // 押した直後にメニューを閉じているので、結果を見せるために開き直す
    if (ui.uploadMenu) ui.uploadMenu.classList.add('visible');
  } finally {
    alternateLookupInFlight = false;
  }
}

async function selectCandidateById(candId) {
  if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) return;
  const selectionKey = currentKey;
  const selectionVideoId = currentLyricsVideoId || getCurrentVideoId() || '';
  let cand = lyricsCandidates.find((c, idx) => getCandidateId(c, idx) === String(candId));
  if (!cand) return;
  // A search result can already contain line-synced lyrics while its
  // character timings still need to be fetched from /api/record.
  cand = await ensureCandidateLyricsLoaded(candId);
  if (
    currentKey !== selectionKey ||
    (currentLyricsVideoId || getCurrentVideoId() || '') !== selectionVideoId
  ) return;
  const hasCandidateLyrics = typeof cand?.lyrics === 'string' && cand.lyrics.trim();
  const hasCandidateAnimatedLyrics = typeof cand?.animated_lyrics === 'string' && cand.animated_lyrics.trim();
  if (!cand || (!hasCandidateLyrics && !hasCandidateAnimatedLyrics)) {
    showToast('この候補の歌詞データを読み込めませんでした');
    return;
  }
  const selectedPayload = selectLyricsPayload(cand);
  const nextLyricsText = selectedPayload.text;
  selectedCandidateId = candId;
  currentLyricsFromPreferredYtm = false;  // 手動選択が最優先
  // Cancel any automatic late upgrade which belongs to the pre-selection
  // request. A manual candidate choice must remain authoritative.
  activeLyricsRequestId = null;
  currentLyricsResultPriority = 3;
  currentLyricsQuality = selectedPayload.quality;
  dynamicLines = selectedPayload.dynamicLines;
  lyricsTranslationMap = {
    ...normalizeTranslationsToLrcMapLocal(cand.translations),
    ...normalizeTranslationsToLrcMapLocal(cand.lrcMap)
  };
  setLyricsMeaningData(cand);
  // 取得元をまたいだ候補を選べるようになったので、ここを 'lrchub' 固定にはできない。
  // 「歌詞ソース」表示とキャッシュに嘘が入る。
  const candidateSource = String(cand.lyricsSource || '').trim().toLowerCase() || 'lrchub';
  updateLyricsSourceState({ lyricsSource: candidateSource, fallbackUsed: false }, false);
  duetSubDynamicLines = null;
  _duetExcludedTimes = new Set();
  const candidateRecordId = getCandidateRecordId(cand);
  void requestSingerMetadataForLyrics(
    candidateRecordId,
    selectedPayload.lyrics || nextLyricsText,
    { trackKey: selectionKey, videoId: selectionVideoId }
  );
  if (currentKey) {
    storage.set(currentKey, {
      cacheVersion: LYRICS_CACHE_VERSION,
      video_id: currentLyricsVideoId || getCurrentVideoId() || null,
      record_id: candidateRecordId,
      lyrics: cand.lyrics,
      animated_lyrics: cand.animated_lyrics || null,
      dynamicLines: dynamicLines || null,
      noLyrics: false,
      lrcMap: lyricsTranslationMap || null,
      meaningData: lyricsMeaning || null,
      candidateId: cand.id || candId || null,
      // 本人が選んだ取得元であることを残す。これが無いと次に同じ曲を
      // かけた時、キャッシュの優先度が 2 のままになり、裏で走った取得の
      // 結果(同じく 2)に上書きされる。選んだ歌詞が一瞬出てから
      // 差し替わるので、選んだこと自体が無かったことになっていた。
      // 手動アップロード(manualLyrics)と同じ重みで扱う。
      manualChoice: true,
      // 候補一覧も持たせる。次に開いた時、裏の取得が返ってくる前でも
      // メニューから選び直せるようにするため。
      candidates: Array.isArray(lyricsCandidates) ? LyricsCache.stripCandidateLyrics(lyricsCandidates) : null,
      lyricsSource: candidateSource,
      fetchedAt: Date.now(),
      fallbackUsed: false,
      lyricsQuality: selectedPayload.quality,
      offset_ms: Number.isFinite(Number(cand.offset_ms)) ? Number(cand.offset_ms) : 0,
    });
  }
  await applyLyricsText(nextLyricsText);
  // 「この候補を選んだ」の報告はしない。LRCHub 側に匿名で受け取る API が無く
  // (/api/record/lock はログイン必須、他は 404)、送っても届かないため。
  // 以前はここから 10 秒後にキャッシュを消して取り直していたが、報告が
  // 届かない以上、選んだ記録を捨てて最初から引き直すだけの動きだった。
}

let lyricsLockState = null;

function normalizeLockRequestId(req) {
  return String(req?.request || req?.id || '').trim().toLowerCase();
}

function inferLockRequestTarget(req) {
  if (!req || typeof req !== 'object') return null;

  const explicit = String(req.target || '').trim().toLowerCase();
  if (explicit === 'sync' || explicit === 'dynamic') return explicit;

  const key = normalizeLockRequestId(req);
  if (key === 'lock_current_sync') return 'sync';
  if (key === 'lock_current_dynamic') return 'dynamic';

  const label = String(req.label || '').toLowerCase();
  if (label.includes('lock dynamic') || label.includes('dynamic') || label.includes('動く')) return 'dynamic';
  if (label.includes('lock sync') || label.includes('sync') || label.includes('同期') || label.includes('readme')) return 'sync';

  return null;
}

function buildLyricsLockState(requests, config, prevState) {
  const prevByRequest = prevState && prevState.byRequest && typeof prevState.byRequest === 'object'
    ? prevState.byRequest
    : {};

  const next = {
    sync: false,
    dynamic: false,
    byRequest: { ...prevByRequest }
  };

  if (Array.isArray(requests)) {
    requests.forEach((req) => {
      if (!req || typeof req !== 'object') return;

      const requestId = normalizeLockRequestId(req);
      const target = inferLockRequestTarget(req);
      const locked = req.locked === true || req.available === false || req.state === 'locked';

      if (requestId) next.byRequest[requestId] = locked;
      if (target && locked) next[target] = true;
    });
  }

  // Default lock states removed as per user request

  next.sync = !!next.byRequest.lock_current_sync || !!next.sync;
  next.dynamic = !!next.byRequest.lock_current_dynamic || !!next.dynamic;

  return next;
}

function syncLyricsLockState() {
  lyricsLockState = buildLyricsLockState(lyricsRequests, lyricsConfig, lyricsLockState);
  return lyricsLockState;
}

function refreshCandidateMenu() {
  if (!ui.uploadMenu) {
    if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
    return;
  }
  const section = ui.uploadMenu.querySelector('.ytm-upload-menu-candidates');
  const list = section ? section.querySelector('.ytm-upload-menu-candidate-list') : null;
  if (!section || !list) return;
  list.innerHTML = '';
  if (!Array.isArray(lyricsCandidates) || !lyricsCandidates.length) {
    section.style.display = 'none';
    if (ui.lyricsBtn) ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
    return;
  }
  section.style.display = 'block';

  const appendCandidateButton = (cand, idx) => {
    const id = getCandidateId(cand, idx);
    const btn = document.createElement('button');
    btn.className = 'ytm-upload-menu-item ytm-upload-menu-item-candidate';
    btn.dataset.action = 'candidate';
    btn.dataset.candidateId = id;
    btn.textContent = buildCandidateLabel(cand, idx);
    // 同期の粒度を添える。どれを選べば単語単位で光るのかが、
    // 選ぶ前に分かるようにするため。
    const syncLabel = describeCandidateSync(cand);
    if (syncLabel) {
      const tag = document.createElement('span');
      tag.className = 'ytm-candidate-sync';
      tag.textContent = syncLabel;
      btn.appendChild(tag);
    }
    if (String(selectedCandidateId || '') === id) {
      btn.classList.add('is-selected');
    }
    btn.addEventListener('mouseenter', (ev) => {
      showCandidateHoverPreview(id, ev);
    });
    btn.addEventListener('mousemove', (ev) => {
      hoverPreviewMouseX = ev.clientX;
      hoverPreviewMouseY = ev.clientY;
      hoverPreviewAnchorEl = ev.currentTarget || hoverPreviewAnchorEl;
      updateCandidateHoverPreviewPosition(hoverPreviewMouseX, hoverPreviewMouseY, hoverPreviewAnchorEl);
    });
    btn.addEventListener('mouseleave', () => {
      hideCandidateHoverPreview();
    });
    list.appendChild(btn);
  };

  // 取得元をまたいだ候補は別枠。いま画面に出ている取得元そのものは、
  // 同じものを2回並べても選ぶ意味が無いので伏せる。
  const ownCandidates = [];
  const providerCandidates = [];
  lyricsCandidates.forEach((cand, idx) => {
    if (!cand || !cand.providerCandidate) {
      ownCandidates.push({ cand, idx });
      return;
    }
    const id = getCandidateId(cand, idx);
    const isSelected = String(selectedCandidateId || '') === id;
    const source = String(cand.lyricsSource || '').trim().toLowerCase();
    if (!isSelected && source && source === currentLyricsSource) return;
    providerCandidates.push({ cand, idx });
  });

  ownCandidates.forEach(({ cand, idx }) => appendCandidateButton(cand, idx));

  if (providerCandidates.length) {
    if (ownCandidates.length) {
      const subtitle = document.createElement('div');
      subtitle.className = 'ytm-upload-menu-subtitle';
      subtitle.textContent = '他の取得元';
      list.appendChild(subtitle);
    }
    providerCandidates.forEach(({ cand, idx }) => appendCandidateButton(cand, idx));
  }

  if (!ownCandidates.length && !providerCandidates.length) {
    section.style.display = 'none';
  }

  // ボタンを跳ねさせるのは今までどおり「その歌詞自身の候補」がある時だけ。
  // 他の取得元は毎曲ぶら下がるので、ここで光らせると常時鳴るベルになる。
  if (ui.lyricsBtn) {
    ui.lyricsBtn.classList.remove('ytm-lyrics-has-candidates');
    if (ownCandidates.length) {
      void ui.lyricsBtn.offsetWidth;
      ui.lyricsBtn.classList.add('ytm-lyrics-has-candidates');
    }
  }
}

// 「歌詞を確定」ボタンは削除した。LRCHub 側に匿名で受け取る API が無く
// (/api/record/lock はログイン必須)、押しても必ず失敗していたため。
// 確定済みかどうかの状態は「歌詞同期を追加」の可否にだけ使う。
function refreshLockMenu() {
  if (!ui.uploadMenu) return;
  const addSyncBtn = ui.uploadMenu.querySelector('.ytm-upload-menu-item[data-action="add-sync"]');
  if (!addSyncBtn) return;
  const lockState = syncLyricsLockState();
  const shouldDisableAddSync = !!lockState?.sync && !!lockState?.dynamic;
  addSyncBtn.classList.toggle('ytm-upload-menu-item-disabled', shouldDisableAddSync);
  if (shouldDisableAddSync) {
    addSyncBtn.dataset.disabledMessage = 'すでに確定された歌詞です';
    addSyncBtn.title = 'すでに確定された歌詞です';
  } else {
    delete addSyncBtn.dataset.disabledMessage;
    addSyncBtn.title = '';
  }
}


function setupUploadMenu(uploadBtn) {
  if (!ui.btnArea || ui.uploadMenu) return;
  ui.btnArea.style.position = 'relative';
  const menu = createEl('div', 'ytm-upload-menu', 'ytm-upload-menu');
  menu.innerHTML = `
      <div class="ytm-upload-menu-title" data-ytm-text="menu_lyrics_title">${t('menu_lyrics_title')}</div>
      <button class="ytm-upload-menu-item" data-action="local">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z"/></svg></span>
        <span data-ytm-text="menu_read_local">${t('menu_read_local')}</span>
      </button>
      <button class="ytm-upload-menu-item" data-action="add-sync">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg></span>
        <span data-ytm-text="menu_add_sync">${t('menu_add_sync')}</span>
      </button>
      <button class="ytm-upload-menu-item" data-action="find-alternates">
        <span class="ytm-upload-menu-item-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="vertical-align: -0.15em; margin-right: 6px;"><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg></span>
        <span data-ytm-text="menu_other_sources">${t('menu_other_sources')}</span>
      </button>
      <div class="ytm-upload-menu-offset">
        <div class="ytm-upload-menu-subtitle" data-ytm-text="menu_timing">${t('menu_timing')}</div>
        <div class="ytm-offset-row">
          <button class="ytm-offset-btn" data-action="offset-minus" data-ytm-title="menu_offset_earlier" title="${t('menu_offset_earlier')}">−</button>
          <span class="ytm-offset-value" data-role="offset-value">0.0s</span>
          <button class="ytm-offset-btn" data-action="offset-plus" data-ytm-title="menu_offset_later" title="${t('menu_offset_later')}">＋</button>
          <button class="ytm-offset-btn ytm-offset-reset" data-action="offset-reset" data-ytm-title="menu_offset_reset" title="${t('menu_offset_reset')}">⟲</button>
        </div>
      </div>
      <div class="ytm-upload-menu-candidates" style="display:none;">
        <div class="ytm-upload-menu-subtitle" data-ytm-text="menu_pick_other">${t('menu_pick_other')}</div>
        <div class="ytm-upload-menu-candidate-list"></div>
      </div>
    `;
  ui.btnArea.appendChild(menu);
  ui.uploadMenu = menu;
  const toggleMenu = (show) => {
    if (!ui.uploadMenu) return;
    const cl = ui.uploadMenu.classList;
    if (show === undefined) cl.toggle('visible');
    else if (show) cl.add('visible');
    else { cl.remove('visible'); hideCandidateHoverPreview(); }
  };
  uploadBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleMenu();
  });
  ui.uploadMenu.addEventListener('click', (ev) => {
    // ズレ直しはメニューを閉じない。合うまで何度も押すものなので。
    const offsetBtn = ev.target.closest('.ytm-offset-btn');
    if (offsetBtn) {
      ev.stopPropagation();
      const step = offsetBtn.dataset.action === 'offset-minus' ? -LYRIC_OFFSET_STEP_MS
        : offsetBtn.dataset.action === 'offset-plus' ? LYRIC_OFFSET_STEP_MS
          : null;
      const next = step === null ? 0 : (Number(config.syncOffset) || 0) + step;
      applyLyricOffsetMs(next);
      return;
    }

    const target = ev.target.closest('.ytm-upload-menu-item');
    if (!target) return;
    if (target.classList.contains('ytm-upload-menu-item-disabled')) {
      const msg = target.dataset.disabledMessage || 'この操作は現在利用できません';
      showToast(msg);
      return;
    }
    const action = target.dataset.action;
    const candId = target.dataset.candidateId || null;
    toggleMenu(false);
    hideCandidateHoverPreview();
    if (action === 'local') {
      ui.input?.click();
    } else if (action === 'add-sync') {
      const videoUrl = getCurrentVideoUrl();
      const base = 'https://lrchub.coreone.work';
      const lrchubUrl = videoUrl ? `${base}/manual?video_url=${encodeURIComponent(videoUrl)}` : base;
      window.open(lrchubUrl, '_blank');
    } else if (action === 'find-alternates') {
      void findAlternateLyricSources();
    } else if (action === 'candidate' && candId) {
      selectCandidateById(candId);
    }
  });

  if (!uploadMenuGlobalSetup) {
    uploadMenuGlobalSetup = true;
    document.addEventListener('click', (ev) => {
      if (!ui.uploadMenu) return;
      if (!ui.uploadMenu.classList.contains('visible')) return;
      if (ui.uploadMenu.contains(ev.target) || uploadBtn.contains(ev.target)) return;
      // 取得元バッジは自分で開け閉てする。ここで先に閉じると、直後に
      // バッジ側が開き直して二度と閉じられなくなる。
      if (ev.target?.closest?.('#ytm-lyrics-source-debug')) return;
      ui.uploadMenu.classList.remove('visible');
    }, true);
  }
  refreshCandidateMenu();
  refreshLockMenu();
}

// 画質のメニュー。YouTube と同じく、選べる画質を高い順に並べ、先頭に「自動」。
// 自動の時は今の画質を添える(何が選ばれているのか分かるように)。
// 開くたびに作り直す(動画ごとに選べる画質が違う)。
function setupQualityMenu(qualityBtn) {
  if (!ui.btnArea || ui.qualityMenu) return;
  ui.btnArea.style.position = 'relative';
  const menu = createEl('div', 'ytm-quality-menu', 'ytm-upload-menu ytm-quality-menu');
  menu.setAttribute('role', 'menu');
  ui.btnArea.appendChild(menu);
  ui.qualityMenu = menu;

  const render = () => {
    const { current, label, levels } = VideoQuality.read();
    const choice = VideoQuality.getChoice();
    menu.replaceChildren();
    const title = createEl('div', '', 'ytm-upload-menu-title', t('btn_video_quality'));
    menu.appendChild(title);
    const items = [{ quality: 'auto', text: label ? `${t('quality_auto')} (${label})` : t('quality_auto') }]
      .concat(levels.map(l => ({ quality: l.quality, text: l.label })));
    // 選んだ画質がこの動画に無い時(1440p を選んで 1080p までの動画)は、
    // 実際に当たっている一番近い画質に印を付ける
    const available = new Set(items.map(i => i.quality));
    const marked = available.has(choice) ? choice : current;
    items.forEach((item) => {
      const btn = createEl('button', '', 'ytm-upload-menu-item ytm-quality-item');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitemradio');
      btn.dataset.quality = item.quality;
      const selected = item.quality === marked;
      btn.setAttribute('aria-checked', selected ? 'true' : 'false');
      if (selected) btn.classList.add('is-selected');
      const check = createEl('span', '', 'ytm-upload-menu-item-icon', selected ? '✓' : '');
      const text = createEl('span', '', '', '');
      text.textContent = item.text;
      btn.append(check, text);
      menu.appendChild(btn);
    });
  };

  const close = () => menu.classList.remove('visible');
  qualityBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (menu.classList.contains('visible')) { close(); return; }
    ui.uploadMenu?.classList.remove('visible');
    render();
    menu.classList.add('visible');
  });
  menu.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const item = ev.target.closest('.ytm-quality-item');
    if (!item) return;
    VideoQuality.setChoice(item.dataset.quality);
    close();
  });
  document.addEventListener('click', (ev) => {
    if (!menu.classList.contains('visible')) return;
    if (menu.contains(ev.target) || qualityBtn.contains(ev.target)) return;
    close();
  }, true);
}

function setupDeleteDialog(trashBtn) {
  if (!ui.btnArea || ui.deleteDialog) return;
  ui.btnArea.style.position = 'relative';
  const dialog = createEl('div', 'ytm-delete-dialog', 'ytm-confirm-dialog', `
      <div class="ytm-confirm-title">歌詞を削除</div>
      <div class="ytm-confirm-message">
        この曲の保存済み歌詞を削除しますか？<br>
        <span style="font-size:11px;opacity:0.7;">ローカルキャッシュのみ削除されます。</span>
      </div>
      <div class="ytm-confirm-buttons">
        <button class="ytm-confirm-btn cancel">キャンセル</button>
        <button class="ytm-confirm-btn danger">削除</button>
      </div>
    `);
  ui.btnArea.appendChild(dialog);
  ui.deleteDialog = dialog;
  const toggleDialog = (show) => {
    if (!ui.deleteDialog) return;
    const cl = ui.deleteDialog.classList;
    if (show === undefined) cl.toggle('visible');
    else if (show) cl.add('visible');
    else cl.remove('visible');
  };
  trashBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleDialog();
  });
  const cancelBtn = dialog.querySelector('.ytm-confirm-btn.cancel');
  const dangerBtn = dialog.querySelector('.ytm-confirm-btn.danger');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDialog(false);
    });
  }
  if (dangerBtn) {
    dangerBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (currentKey) {
        storage.remove(currentKey);
        lyricsData = [];
        dynamicLines = null;
        duetSubDynamicLines = null;
        _duetExcludedTimes = new Set();
        lyricsCandidates = null;
        selectedCandidateId = null;
        lyricsRequests = null;
        lyricsConfig = null;
        lyricsLockState = null;
        setLyricsMeaningData(null);
        hideMeaningSummaryPopup();
        renderLyrics([]);
        refreshCandidateMenu();
        refreshLockMenu();
        refreshMeaningUi();
      }
      toggleDialog(false);
    });
  }
  if (!deleteDialogGlobalSetup) {
    deleteDialogGlobalSetup = true;
    document.addEventListener('click', (ev) => {
      if (!ui.deleteDialog) return;
      if (!ui.deleteDialog.classList.contains('visible')) return;
      if (ui.deleteDialog.contains(ev.target) || trashBtn.contains(ev.target)) return;
      ui.deleteDialog.classList.remove('visible');
    }, true);
  }
}

function setupLangPills(groupId, currentValue, onChange) {
  const group = document.getElementById(groupId);
  if (!group) return;
  const pills = Array.from(group.querySelectorAll('.ytm-lang-pill'));
  const apply = () => {
    pills.forEach(p => {
      p.classList.toggle('active', p.dataset.value === currentValue);
    });
  };
  apply();
  pills.forEach(p => {
    p.onclick = (e) => {
      e.stopPropagation();
      currentValue = p.dataset.value;
      apply();
      onChange(currentValue);
    };
  });
}

// ===================== UIサイズ =====================
// Immersion UI の寸法は CSS 側で calc(<基準px> * var(--ytm-ui-scale)) として
// 定義してあるので、この変数を書き換えるだけで全体が拡大縮小する。
const UI_SCALE_MIN = 0.7;
const UI_SCALE_MAX = 1.5;

function normalizeUiScale(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, num));
}

function applyUiScale(value) {
  const scale = normalizeUiScale(value);
  config.uiScale = scale;
  document.documentElement.style.setProperty('--ytm-ui-scale', String(scale));
  // 歌詞エリアの高さ・行高が変わると中央位置もずれるので、
  // 次のハイライト更新で中央スクロールをやり直させる。
  if (ui.lyrics) ui.lyrics._lastScrolledIndex = -1;
  if (PipManager && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer._lastScrolledIndex = -1;
  }
  // 上記のレイアウト変化で出る scroll イベントをユーザー操作と誤検出させない
  suppressUserScrollDetection(400);
  // 文字サイズが変わると語の横位置も変わる
  invalidateLyricLineSweeps();
  return scale;
}

async function restoreLyricEffectsPreferences() {
  const [savedStagger, savedFade, legacyKeepPast] = await Promise.all([
    storage.get('ytm_lyric_stagger'),
    storage.get('ytm_fade_past_lyrics'),
    storage.get('ytm_keep_past_lyrics'),
  ]);
  if (typeof savedStagger === 'boolean') config.lyricStagger = savedStagger;
  if (typeof savedFade === 'boolean') config.fadePastLyrics = savedFade;
  else if (typeof legacyKeepPast === 'boolean') config.fadePastLyrics = !legacyKeepPast;
  config.keepPastLyrics = !config.fadePastLyrics;
}

// PiP の設定(タブを離れたら自動で開く)。
// 起動時と設定パネルを初めて開いた時に読む。登録しておかないと
// Chrome が呼んでくれないので、読んだらすぐ反映する。
async function restorePipPreferences() {
  const savedAutoOpen = await storage.get('ytm_pip_auto_open');
  if (typeof savedAutoOpen === 'boolean') config.pipAutoOpen = savedAutoOpen;
  PipManager.setAutoOpen(!!config.pipAutoOpen);
}

async function initSettings() {
  if (ui.settings) return;
  ui.settings = createEl('div', 'ytm-settings-panel', '', ``);
  document.body.appendChild(ui.settings);
  await ensureMeaningDisplayPreferences();

  if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
  const cachedTrans = await storage.get('ytm_trans_enabled');
  if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;

  const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
  if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;

  const mainLangStored = await storage.get('ytm_main_lang');
  if (mainLangStored) config.mainLang = mainLangStored;
  const subLangStored = await storage.get('ytm_sub_lang');
  if (subLangStored !== null) config.subLang = subLangStored;
  const uiLangStored = await storage.get('ytm_ui_lang');
  if (uiLangStored) config.uiLang = uiLangStored;

  const offsetStored = await storage.get('ytm_sync_offset');
  if (offsetStored !== null) config.syncOffset = offsetStored;
  const saveOffsetStored = await storage.get('ytm_save_sync_offset');
  if (saveOffsetStored !== null) config.saveSyncOffset = saveOffsetStored;
  const lrclibFallbackStored = await storage.get('ytm_lrclib_fallback');
  config.useLrcLibFallback = true;  // 歌詞ソース設定は廃止。常に全ソースを使う
  const animatedCaptionStored = await storage.get('ytm_animated_captions_enabled');
  if (animatedCaptionStored !== null) config.useAnimatedCaptions = !!animatedCaptionStored;
  const appleSyncStored = await storage.get('ytm_apple_sync_style');
  if (appleSyncStored !== null) config.appleSyncStyle = !!appleSyncStored;
  const singerColorsStored = await storage.get('ytm_singer_colors_enabled');
  if (singerColorsStored !== null) config.useSingerColors = !!singerColorsStored;
  const sourceModeStored = await storage.get('ytm_lyric_source_mode');
  config.lyricSourceMode = normalizeSourceMode(sourceModeStored);
  config.disabledLyricSources = normalizeDisabledLyricSources(await storage.get(DISABLED_LYRIC_SOURCES_KEY));

  const lowCpuStored = await storage.get('ytm_low_cpu_mode');
  if (lowCpuStored !== null) config.lowCpuMode = !!lowCpuStored;
  await restoreLyricEffectsPreferences();
  applyLyricEffectsSettings();
  await restorePipPreferences();

  // ★スライダー初期値反映
  const weightStored = await storage.get('ytm_lyric_weight');
  if (weightStored) config.lyricWeight = weightStored;
  const brightStored = await storage.get('ytm_bg_brightness');
  if (brightStored !== null && brightStored !== undefined && brightStored !== '') {
    config.bgBrightness = normalizeBgBrightness(brightStored);
  }
  const uiScaleStored = await storage.get('ytm_ui_scale');
  if (uiScaleStored !== null) config.uiScale = normalizeUiScale(uiScaleStored);

  if (!settingsOutsideClickSetup) {
    settingsOutsideClickSetup = true;
    // スライダーをつまんだままパネルの外で離しても、click は外側に届く
    // (押した所と離した所の共通の親に出る)。UI サイズを大きく動かしただけで
    // パネルが閉じていた。押し始めがパネルの中なら外側のクリックとみなさない。
    let pointerDownInSettings = false;
    document.addEventListener('pointerdown', (ev) => {
      pointerDownInSettings = isInsideSettingsUi(ev.target);
    }, true);
    document.addEventListener('click', (ev) => {
      if (!ui.settings) return;
      if (!ui.settings.classList.contains('active')) return;
      if (pointerDownInSettings || isInsideSettingsUi(ev.target)) return;
      if (ui.settingsBtn && ui.settingsBtn.contains(ev.target)) return;
      closeSettings();
    }, true);

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && ui.settings && ui.settings.classList.contains('active')) {
        closeSettings();
      }
    });
  }
}

// パネルの一部とみなす所。表示言語の「etc...」の一覧は body の直下に出る。
function isInsideSettingsUi(target) {
  if (!target || !ui.settings) return false;
  if (ui.settings.contains(target)) return true;
  const etcMenu = document.getElementById('ui-lang-etc-menu');
  return !!(etcMenu && etcMenu.contains(target));
}

// ── 設定パネルを開く・閉じる ───────────────────────────────
// 「保存」で確定する。それ以外の閉じ方(×・Esc・外側のクリック・歯車を
// もう一度)は、保存していない変更を捨てて開いた時の状態に戻す。
//
// 以前は閉じ方で結果が違った。UI サイズ・歌詞の太さ・背景の明るさは
// 動かした時点で画面に反映され、保存せずに閉じても戻らず、再読み込みで
// 初めて元に戻った。言語のピル(翻訳のメイン/サブ・歌詞ソースの優先・
// 表示言語)は保存前から config を書き換えていたので、保存していない
// 翻訳の言語が次の曲から使われた。トグルは閉じても画面に残り、次に開くと
// 保存したかのように見え、後で別の項目を保存した時に一緒に保存された。
//
// 取得元ごとのオン・オフ(差し込んだ許可ページ)だけは例外で、Chrome の
// 許可と同じくその場で保存される。こちらは閉じ方によらず、閉じた時に
// 今の曲へ反映する(以前は親の「保存」を押した時だけ取り直していた)。
//
// 保存前に書き換わる config の項目。閉じた時にここへ戻す。
const SETTINGS_LIVE_KEYS = ['uiScale', 'lyricWeight', 'bgBrightness', 'mainLang', 'subLang', 'lyricSourceMode', 'uiLang'];
let settingsSession = null;

// 自動保存。設定を変えたら少し待って保存する(続けて動かした時は 1 回にまとめる)。
// 保存中にまた変わったら、終わってからもう一度保存する。
const SETTINGS_AUTOSAVE_MS = 300;
let settingsAutosaveTimer = null;
let settingsCommitInFlight = null;
let settingsCommitAgain = false;
function runSettingsAutosave() {
  settingsAutosaveTimer = null;
  const commit = ui.settings && ui.settings._commitSettings;
  if (!commit || !settingsSession) return;
  if (settingsCommitInFlight) { settingsCommitAgain = true; return; }
  settingsCommitInFlight = Promise.resolve(commit({ close: false }))
    .catch((e) => console.warn('[YTM] 設定の自動保存に失敗', e))
    .finally(() => {
      settingsCommitInFlight = null;
      if (settingsCommitAgain) { settingsCommitAgain = false; runSettingsAutosave(); }
    });
}
function scheduleSettingsAutosave() {
  clearTimeout(settingsAutosaveTimer);
  settingsAutosaveTimer = setTimeout(runSettingsAutosave, SETTINGS_AUTOSAVE_MS);
}
let settingsActiveTab = 'visuals';

const disabledSourcesKey = (list) => normalizeDisabledLyricSources(list).sort().join(',');

function setOrClearRootVar(name, value) {
  // 0 は値として残す(背景の明るさ 0 = 真っ黒)
  if (value !== null && value !== undefined && value !== '') document.documentElement.style.setProperty(name, String(value));
  else document.documentElement.style.removeProperty(name);
}

let settingsInitPromise = null;

async function openSettings() {
  // 最初の 1 回は保存値の読み込みを待つ。素早く 2 回押されても読み込みは 1 回
  settingsInitPromise ||= initSettings();
  await settingsInitPromise;
  if (ui.settings.classList.contains('active')) return;
  settingsSession = {
    snapshot: Object.fromEntries(SETTINGS_LIVE_KEYS.map(key => [key, config[key]])),
    disabledSources: disabledSourcesKey(config.disabledLyricSources),
    // 差し込んだ許可ページから「切り替えた」と知らせが来たら立てる。
    // 追加の取得元は Chrome の許可なので、storage を見比べても分からない。
    sourcesChanged: false,
  };
  // 開くたびに保存済みの値から描き直す(前に閉じた時の書きかけを残さない)
  renderSettingsPanel();
  ui.settings.classList.add('active');
}

function closeSettings({ saved = false } = {}) {
  if (!ui.settings || !ui.settings.classList.contains('active')) return;
  // 変えた直後(自動保存の待ち)や保存の途中に閉じられたら、捨てずに保存してから閉じる
  const commit = ui.settings._commitSettings;
  if (!saved && commit) {
    const pending = !!settingsAutosaveTimer;
    if (pending) {
      clearTimeout(settingsAutosaveTimer);
      settingsAutosaveTimer = null;
    }
    const finish = () => (pending ? commit({ close: true }) : closeSettings({ saved: true }));
    if (settingsCommitInFlight) {
      settingsCommitInFlight.then(finish);
      return;
    }
    if (pending) {
      settingsCommitInFlight = Promise.resolve(finish())
        .catch((e) => console.warn('[YTM] 設定の保存に失敗', e))
        .finally(() => { settingsCommitInFlight = null; });
      return;
    }
  }
  ui.settings.classList.remove('active');
  document.getElementById('ui-lang-etc-menu')?.style.setProperty('display', 'none');
  const session = settingsSession;
  settingsSession = null;
  if (!session || saved) return;

  const uiLangChanged = config.uiLang !== session.snapshot.uiLang;
  Object.assign(config, session.snapshot);
  applyUiScale(config.uiScale);
  setOrClearRootVar('--ytm-lyric-weight', config.lyricWeight);
  setOrClearRootVar('--ytm-bg-brightness', config.bgBrightness);
  PipManager.syncBackgroundBrightness();
  if (uiLangChanged) renderSettingsPanel();
  void applySourceChangesAfterClose(session);
}

// 取得元のオン・オフは保存済み。変わっていたら今の曲を取り直す。
async function applySourceChangesAfterClose(session) {
  const storedDisabled = normalizeDisabledLyricSources(await storage.get(DISABLED_LYRIC_SOURCES_KEY));
  const changed = session.sourcesChanged || session.disabledSources !== disabledSourcesKey(storedDisabled);
  config.disabledLyricSources = storedDisabled;
  if (!changed) return;
  const metaNow = getMetadata();
  if (metaNow?.title && metaNow?.artist) await loadLyrics(metaNow);
}


// ── 追加の歌詞サーバー(許可の切り替え) ───────────────────────
// 通信先は optional_host_permissions なので、許可は
// chrome.permissions.request() で取るしかない。あれはユーザー操作を起点に、
// かつ拡張のページからしか呼べない。ここは YouTube Music に差し込んだ
// content script なので呼べない。
//
// 以前は background に許可ページ(options.html)を別タブで開いてもらっていたが、
// 許可して戻ってくるまで設定の続きが途切れる。そこで許可ページそのものを
// iframe で差し込む。iframe の中は拡張のページなので、押したその場で
// 許可のダイアログが出せる。
//
// 高さは中身に合わせる。別オリジンなのでこちらからは測れず、中身の側が
// postMessage で知らせてくる(options.js)。受け取るのは、差し込んだ iframe
// そのものから、拡張のオリジンで届いたものだけ。
//
// 何も言ってこなければ読み込めなかったとみなし、別タブで開くボタンに戻す
// (拡張とはつながっているのに iframe だけが読めない時。web_accessible_resources
// の書き換えや、ページ側の妨害など)。
//
// 拡張が更新・再読み込みされて、この content script が切り離された時は
// 別タブのボタンも効かない(background への送信ごと失敗する)。その時は
// ページの再読み込みを促す文だけを出す。
//
// なお options.html を web_accessible にしたので、YouTube Music のページ自身も
// あのページを枠に入れられる。見えない枠を重ねてトグルを押させれば、許可の
// 取り消しはダイアログ無しで通ってしまう。見えている時だけ受ける仕組み
// (IntersectionObserver v2)は、中身がパネルの表示域より高くて iframe が常に
// 一部切れているため、正規の操作まで弾いてしまい使えなかった(実測)。
// ページ側はこの設定パネル自体も書き換えられるので、ここだけ塞いでも意味が薄い。
// 付与には必ず Chrome 自身のダイアログが要り、取り消されても任意の取得元が
// 1つ止まるだけなので、受け入れている。
const EXTRA_PROVIDERS_MESSAGE_TYPE = 'ytm-immersion:extra-providers';
const EXTRA_PROVIDERS_FRAME_TIMEOUT_MS = 5000;
const EXTRA_PROVIDERS_FRAME_MAX_HEIGHT = 2000;
let extraProvidersFrameState = null;
let extraProvidersMessageSetup = false;
// 描き直し(保存・表示言語の切り替え)のたびに iframe を作り直す。高さを 0 から
// 始めると、中身が高さを知らせてくるまでの一瞬パネルが縮んでスクロールが跳ねる。
// 直前の高さから始める。
let extraProvidersLastHeight = 0;

function showExtraProvidersFallback(state) {
  clearTimeout(state.timer);
  state.host.hidden = true;
  if (state.fallback) state.fallback.hidden = false;
}

// content script が拡張から切り離されたか。切り離されると runtime.id が消える。
function isExtensionContextAlive() {
  try {
    return !!(EXT && EXT.runtime && EXT.runtime.id);
  } catch (e) {
    return false;
  }
}

function showExtraProvidersReloadNotice() {
  if (extraProvidersFrameState) clearTimeout(extraProvidersFrameState.timer);
  const host = document.getElementById('extra-providers-embed');
  const fallback = document.getElementById('extra-providers-fallback');
  const notice = document.getElementById('extra-providers-reload');
  if (host) host.hidden = true;
  if (fallback) fallback.hidden = true;
  if (notice) notice.hidden = false;
}

function onExtraProvidersFrameMessage(ev) {
  const state = extraProvidersFrameState;
  if (!state || ev.origin !== state.origin || ev.source !== state.frame.contentWindow) return;
  const data = ev.data;
  if (!data || typeof data !== 'object' || data.type !== EXTRA_PROVIDERS_MESSAGE_TYPE) return;

  if (data.kind === 'ready') {
    // 遅れて届いても、いったん出した逃げ道のボタンを引っ込めて差し込みに戻す
    state.ready = true;
    clearTimeout(state.timer);
    state.host.hidden = false;
    if (state.fallback) state.fallback.hidden = true;
    return;
  }
  if (data.kind === 'size') {
    const height = Number(data.height);
    if (!Number.isFinite(height) || height <= 0) return;
    // 横幅が決まる前に測った高さ(とても大きい)を捨てる。受けて広げると、
    // iframe がパネルの見えない位置まではみ出して描画を止められ、正しい高さの
    // 知らせが届かなくなる(options.js の reportHeightToParent)。
    const width = Number(data.width);
    if (Number.isFinite(width) && Math.abs(width - state.frame.clientWidth) > 2) return;
    extraProvidersLastHeight = Math.min(Math.ceil(height), EXTRA_PROVIDERS_FRAME_MAX_HEIGHT);
    state.frame.style.height = `${extraProvidersLastHeight}px`;
    return;
  }
  if (data.kind === 'sources-changed') {
    // 取得元を切り替えた(その場で保存済み)。閉じた時に今の曲へ反映する。
    if (settingsSession) settingsSession.sourcesChanged = true;
    return;
  }
  if (data.kind === 'escape') {
    // iframe の中にいる間は、下の keydown(Esc で閉じる)が届かない
    closeSettings();
    // フォーカスを親へ戻す。残すと隠れた iframe がキーを受け続け、Space などの
    // YouTube Music のショートカットが効かなくなる(実測。押すのが早いと、
    // 隠れたトグルが切り替わって許可のダイアログまで出た)。
    // 歯車のボタンには移さない。そこで Space を押すと設定が開き直す。
    state.frame.blur();
  }
}

function mountExtraProvidersFrame() {
  const host = document.getElementById('extra-providers-embed');
  if (!host) return;
  const fallback = document.getElementById('extra-providers-fallback');
  if (extraProvidersFrameState) clearTimeout(extraProvidersFrameState.timer);
  extraProvidersFrameState = null;

  let url = null;
  try {
    url = isExtensionContextAlive() ? new URL(EXT.runtime.getURL('src/options.html')) : null;
  } catch (e) {
    url = null;
  }
  if (!url) {
    // 拡張が更新・再読み込みされ、この content script が切り離されている。
    // 別タブのボタンも効かないので、再読み込みを促す。
    showExtraProvidersReloadNotice();
    return;
  }
  url.searchParams.set('embed', '1');
  // パネルでは保存前に表示言語を切り替えられる。中身もそれに合わせる。
  url.searchParams.set('lang', config.uiLang || 'ja');

  const frame = document.createElement('iframe');
  frame.className = 'ytm-extra-providers-frame';
  frame.title = t('settings_extra_providers');
  if (extraProvidersLastHeight > 0) frame.style.height = `${extraProvidersLastHeight}px`;
  frame.src = url.href;
  host.replaceChildren(frame);

  // url.origin は使わない。URL の仕様では chrome-extension: は「特別な
  // スキーム」ではないのでオリジンが 'null' になりうる(Chrome は独自に
  // 組み立てるが、それに寄りかからない)。届くメッセージの origin は
  // 'chrome-extension://<拡張ID>' なので、同じ形をここで組む。
  // ホストも getURL の戻り値からは採らない。web_accessible_resources に
  // use_dynamic_url を付けると getURL は使い捨ての ID を返すが、読み込まれた
  // ページのオリジンは本物の拡張 ID のまま(リダイレクトされる)。
  const origin = `${url.protocol}//${EXT.runtime.id || url.host}`;
  const state = { frame, origin, host, fallback, ready: false, timer: 0 };
  state.timer = setTimeout(() => {
    if (!state.ready) showExtraProvidersFallback(state);
  }, EXTRA_PROVIDERS_FRAME_TIMEOUT_MS);
  extraProvidersFrameState = state;

  if (!extraProvidersMessageSetup) {
    extraProvidersMessageSetup = true;
    window.addEventListener('message', onExtraProvidersFrameMessage);
  }
}


// 設定パネルの書きかけ(保存前の入力)。id の付いた input だけを見る。
// 差し込んだ許可ページ(iframe)の中はその場で保存されるので含めない。
// 翻訳の説明。どこで訳すかを書く(DeepL / Chrome / どちらも無い)。
function updateTransEngineDesc() {
  const el = document.getElementById('trans-engine-desc');
  if (!el) return;
  const key = (document.getElementById('deepl-key-input')?.value || '').trim();
  const progress = builtinProgress();
  if (progress !== null) {
    el.textContent = t('trans_dl_progress').replace('{p}', String(Math.floor(progress * 100)));
  } else if (key) {
    el.textContent = t('settings_trans_desc_deepl');
  } else if (hasBuiltinTranslate()) {
    el.textContent = t('settings_trans_desc_builtin');
  } else {
    el.textContent = t('settings_trans_desc_none');
  }
}

// 設定で翻訳を入れた時(クリックの中)に、今の曲を訳すのに要る言語データを落とし始める。
// DeepL のキーがある時や、曲がまだ無い時は何もしない(曲の画面のボタンで落とせる)。
function prepareBuiltinTranslation() {
  if (!hasBuiltinTranslate()) return;
  if ((document.getElementById('deepl-key-input')?.value || '').trim()) return;
  const texts = (Array.isArray(lyricsData) ? lyricsData : []).map(l => String(l?.text ?? ''));
  if (!texts.some(s => s.trim())) return;
  const mainLang = resolveTranslationLang(config.mainLang || 'original');
  const subLang = resolveTranslationLang(config.subLang || '');
  const targets = [...new Set([mainLang, subLang].filter(l => l && l !== 'original'))];
  targets.forEach(async (lang) => {
    const pairs = await BuiltinTranslate.missingPairs(texts, lang);
    startBuiltinDownload(pairs);
  });
}

// 設定の検索。全タブの行から、名前・説明に当てはまるものだけを出す。
// 当てはまる行が無いカード・見出し・タブは隠し、「詳細設定」の中で当たれば開く。
// 項目が多く、どのタブにあるか分からないという声への答え(項目は減らさない)。
const normalizeSearchText = (text) => String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function applySettingsSearch(query) {
  if (!ui.settings) return;
  const q = normalizeSearchText(query);
  ui.settings.classList.toggle('settings-searching', !!q);
  let anyHit = false;
  ui.settings.querySelectorAll('.settings-panel').forEach((panel) => {
    let panelHit = false;
    panel.querySelectorAll('.settings-group-card').forEach((card) => {
      let cardHit = false;
      card.querySelectorAll(':scope > .setting-row').forEach((row) => {
        const hit = !q || normalizeSearchText(row.textContent).includes(q);
        row.classList.toggle('settings-search-miss', !hit);
        if (hit) cardHit = true;
      });
      card.classList.toggle('settings-search-miss', !cardHit);
      const details = card.closest('details');
      if (details) {
        details.classList.toggle('settings-search-miss', !cardHit);
        if (q && cardHit) details.open = true;
      }
      if (cardHit) panelHit = true;
    });
    // 見出しは、すぐ後のカード(か詳細設定)が残っている時だけ出す
    panel.querySelectorAll('.settings-section-title').forEach((title) => {
      const next = title.nextElementSibling;
      title.classList.toggle('settings-search-miss', !!q && (!next || next.classList.contains('settings-search-miss')));
    });
    panel.classList.toggle('settings-search-hit', !!q && panelHit);
    if (q && panelHit) anyHit = true;
  });
  const empty = document.getElementById('settings-search-empty');
  if (empty) empty.hidden = !q || anyHit;
}

function readSettingsDraft() {
  const draft = {};
  ui.settings.querySelectorAll('input[id]').forEach((input) => {
    draft[input.id] = input.type === 'checkbox' ? input.checked : input.value;
  });
  return draft;
}

function writeSettingsDraft(draft) {
  Object.entries(draft).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (!input || !ui.settings.contains(input)) return;
    if (input.type === 'checkbox') input.checked = !!value;
    else input.value = value;
    // スライダーは数値の表示と塗りを合わせる(画面への反映は同じ値なので変わらない)
    if (input.type === 'range') input.dispatchEvent(new Event('input'));
  });
}

function updateLyricMotionSettingsState() {
  const lowCpuToggle = document.getElementById('low-cpu-toggle');
  const staggerToggle = document.getElementById('lyric-stagger-toggle');
  if (staggerToggle) staggerToggle.disabled = !!lowCpuToggle?.checked;
}

function renderSettingsPanel() {
  if (!ui.settings) return;

  // 現在の曲IDがあるか確認（キャッシュ削除ボタンの制御用）
  const hasCurrentSong = !!currentKey;

  // 開いたまま描き直す時(表示言語の切り替え)は、書きかけの値を引き継ぐ。
  // 以前は描き直しでトグルや入力欄が保存済みの値に戻っていた。
  const draft = ui.settings.classList.contains('active') ? readSettingsDraft() : null;

  // --- SVG Icons ---
  const ICONS = {
    visuals: `<svg viewBox="0 0 24 24"><path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5 11 5.67 11 6.5 10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5S18.33 12 17.5 12z"/></svg>`,
    trans: `<svg viewBox="0 0 24 24"><path d="M12.87 15.07l-2.54-2.51.03-.03c1.74-1.94 2.98-4.17 3.71-6.53H17V4h-7V2H8v2H1v1.99h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/></svg>`,
    sources: `<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>`,
    bg: `<svg viewBox="0 0 24 24"><path d="M21 19V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5l2.5 3 3.5-4.5 4.5 6H5l3.5-4.5z"/></svg>`,
    lyrics: `<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/></svg>`,
    video: `<svg viewBox="0 0 24 24"><path d="M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V4h-4z"/></svg>`,
    data: `<svg viewBox="0 0 24 24"><path d="M12 2C7.58 2 4 3.79 4 6s3.58 4 8 4 8-1.79 8-4-3.58-4-8-4zM4 8.55V12c0 2.21 3.58 4 8 4s8-1.79 8-4V8.55C18.83 9.99 15.72 11 12 11S5.17 9.99 4 8.55zM4 14.55V18c0 2.21 3.58 4 8 4s8-1.79 8-4v-3.45C18.83 15.99 15.72 17 12 17s-6.83-1.01-8-2.45z"/></svg>`,
    save: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`,
    discord: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19.27 5.33A18.6 18.6 0 0 0 14.9 4l-.25.45c1.4.33 2.7.9 3.9 1.65a13.3 13.3 0 0 0-4.55-1.45 13.9 13.9 0 0 0-4 0A13.3 13.3 0 0 0 5.45 6.1c1.2-.75 2.5-1.32 3.9-1.65L9.1 4a18.6 18.6 0 0 0-4.37 1.33C2.14 9.2 1.44 12.97 1.79 16.69a18.7 18.7 0 0 0 5.6 2.83l1.2-1.66c-.66-.25-1.28-.55-1.87-.92l.46-.34a13.3 13.3 0 0 0 11.64 0l.46.34c-.59.37-1.21.67-1.87.92l1.2 1.66a18.7 18.7 0 0 0 5.6-2.83c.42-4.3-.7-8.03-2.94-11.36zM8.52 14.46c-.9 0-1.63-.82-1.63-1.83 0-1 .72-1.83 1.63-1.83.92 0 1.65.83 1.63 1.83 0 1.01-.72 1.83-1.63 1.83zm6.96 0c-.9 0-1.63-.82-1.63-1.83 0-1 .72-1.83 1.63-1.83.92 0 1.65.83 1.63 1.83 0 1.01-.71 1.83-1.63 1.83z"/></svg>`,
    github: `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.72c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.570 2.34 1.12 2.91.86.09-.66.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.05.36.32.68.94.68 1.9l-.01 2.82c0 .27.18.6.69.49A10.06 10.06 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`
  };

  let extVersion = '';
  try { extVersion = (EXT && EXT.runtime && EXT.runtime.getManifest) ? (EXT.runtime.getManifest().version || '') : ''; } catch (_) { }

  ui.settings.innerHTML = `
      <div class="settings-tabs">
        <div class="settings-tabs-header">
          <span class="settings-app-name">YTM Immersion</span>
          <span class="settings-app-caption">${t('settings_title')}</span>
        </div>
        <input type="search" id="settings-search" class="settings-search" placeholder="${t('settings_search_placeholder')}" aria-label="${t('settings_search_placeholder')}" autocomplete="off" spellcheck="false">
        <button class="settings-tab-btn" data-tab="visuals">
          ${ICONS.visuals}<span>${t('settings_tab_visuals')}</span>
        </button>
        <button class="settings-tab-btn" data-tab="bg">
          ${ICONS.bg}<span>${t('settings_tab_bg')}</span>
        </button>
        <button class="settings-tab-btn" data-tab="lyrics">
          ${ICONS.lyrics}<span>${t('settings_tab_lyrics')}</span>
        </button>
        <button class="settings-tab-btn" data-tab="video">
          ${ICONS.video}<span>${t('settings_tab_video')}</span>
        </button>
        <button class="settings-tab-btn" data-tab="sources">
          ${ICONS.sources}<span>${t('settings_tab_sources')}</span>
        </button>
        <button class="settings-tab-btn" data-tab="translation">
          ${ICONS.trans}<span>${t('settings_tab_translation')}</span>
        </button>
        <button class="settings-tab-btn" data-tab="data">
          ${ICONS.data}<span>${escapeHtml(t('settings_tab_data'))}</span>
        </button>

        <div class="settings-tabs-footer">
           <div class="settings-links">
             <a class="settings-link-btn" href="https://discord.gg/cpBCACpt6j"
                target="_blank" rel="noopener noreferrer" title="Discord" aria-label="Discord">
               ${ICONS.discord}
             </a>
             <a class="settings-link-btn" href="https://github.com/naikaku1/YTM_Immersion"
                target="_blank" rel="noopener noreferrer" title="GitHub" aria-label="GitHub">
               ${ICONS.github}
             </a>
           </div>
           ${extVersion ? `<div class="settings-version">v${extVersion}</div>` : ''}
        </div>
      </div>

      <div class="settings-panels">
        <div class="settings-panels-header">
          <h3>${t('settings_title')}</h3>
          <button id="ytm-settings-close-btn" class="ytm-unified-close-btn size-32" title="${t('settings_close')}" aria-label="${t('settings_close')}"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>

        <div class="settings-scroll-area">
          <div class="settings-search-empty" id="settings-search-empty" hidden>${t('settings_search_empty')}</div>

          <div class="settings-panel" id="panel-visuals">
            <div class="settings-section-title">${t('settings_sec_display')}</div>
            <div class="settings-group-card">
              <div class="setting-row">
                <span class="setting-name">${t('settings_ui_lang')}</span>
                <div class="ytm-lang-group" id="ui-lang-group"></div>
              </div>
              <div class="setting-row stacked">
                <div class="setting-row-top">
                  <span class="setting-name">${t('settings_ui_scale')}</span>
                  <span class="setting-value-badge" id="ui-scale-val">${Math.round((config.uiScale || 1) * 100)}%</span>
                </div>
                <input type="range" id="ui-scale-slider" min="0.7" max="1.5" step="0.05" value="${config.uiScale || 1}">
              </div>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_left_align')}</span>
                <input type="checkbox" id="left-align-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_bar_autohide')}</span>
                  <span class="setting-desc" id="bar-autohide-desc">${t('settings_bar_autohide_desc')}</span>
                </span>
                <input type="checkbox" id="bar-autohide-toggle" aria-describedby="bar-autohide-desc">
              </label>
            </div>
          </div>

          <div class="settings-panel" id="panel-bg">
            <div class="settings-section-title">${t('settings_sec_bg')}</div>
            <div class="settings-group-card">
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_apple_bg')}</span>
                <input type="checkbox" id="apple-bg-toggle">
              </label>
              <div class="setting-row stacked">
                <div class="setting-row-top">
                  <span class="setting-name">${t('settings_bg_brightness')}</span>
                  <span class="setting-value-badge" id="bright-val">${Math.round(normalizeBgBrightness(config.bgBrightness) * 100)}%</span>
                </div>
                <input type="range" id="bright-slider" min="0" max="1.0" step="0.05" value="${normalizeBgBrightness(config.bgBrightness)}">
              </div>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_low_cpu_mode')}</span>
                <input type="checkbox" id="low-cpu-toggle">
              </label>
            </div>
          </div>

          <div class="settings-panel" id="panel-lyrics">
            <div class="settings-section-title">${t('settings_sec_lyrics')}</div>
            <div class="settings-group-card">
              <div class="setting-row stacked">
                <div class="setting-row-top">
                  <span class="setting-name">${t('settings_lyric_weight')}</span>
                  <span class="setting-value-badge" id="weight-val">${config.lyricWeight || 800}</span>
                </div>
                <input type="range" id="weight-slider" min="100" max="900" step="100" value="${config.lyricWeight || 800}">
              </div>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_apple_sync')}</span>
                <input type="checkbox" id="apple-sync-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_lyric_stagger')}</span>
                  <span class="setting-desc" id="lyric-stagger-desc">${t('settings_lyric_stagger_desc')}</span>
                </span>
                <input type="checkbox" id="lyric-stagger-toggle" aria-describedby="lyric-stagger-desc">
              </label>
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_fade_past_lyrics')}</span>
                  <span class="setting-desc" id="fade-past-lyrics-desc">${t('settings_fade_past_lyrics_desc')}</span>
                </span>
                <input type="checkbox" id="fade-past-lyrics-toggle" aria-describedby="fade-past-lyrics-desc">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_animated_captions')}</span>
                <input type="checkbox" id="animated-caption-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_singer_colors')}</span>
                <input type="checkbox" id="singer-colors-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_meaning_always')}</span>
                <input type="checkbox" id="meaning-always-toggle">
              </label>
            </div>

            <div class="settings-section-title">${t('settings_sec_timing')}</div>
            <div class="settings-group-card">
              <div class="setting-row">
                 <span class="setting-name">${t('settings_sync_offset')}</span>
                 <div class="setting-number-wrap">
                   <input type="number" id="sync-offset-input" class="setting-input-number" placeholder="0">
                   <span class="setting-unit">ms</span>
                 </div>
              </div>
              <label class="setting-row toggle-label">
                <span class="setting-name secondary">${t('settings_sync_offset_save')}</span>
                <input type="checkbox" id="sync-offset-save-toggle">
              </label>
            </div>

            <div class="settings-section-title">${t('settings_sec_reading')}</div>
            <div class="settings-group-card">
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_korean_ruby')}</span>
                  <span class="setting-desc" id="korean-ruby-desc">${t('settings_korean_ruby_desc')}</span>
                </span>
                <input type="checkbox" id="korean-ruby-toggle" aria-describedby="korean-ruby-desc">
              </label>
            </div>
          </div>

          <div class="settings-panel" id="panel-video">
            <div class="settings-section-title">${t('settings_sec_movie')}</div>
            <div class="settings-group-card">
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_prefer_song_mode')}</span>
                <input type="checkbox" id="prefer-song-mode-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span class="setting-name">${t('settings_level_volume')}</span>
                <input type="checkbox" id="level-volume-toggle">
              </label>
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_movie_lyrics')}</span>
                  <span class="setting-desc" id="movie-lyrics-desc">${t('settings_movie_lyrics_desc')}</span>
                </span>
                <input type="checkbox" id="movie-lyrics-toggle" aria-describedby="movie-lyrics-desc">
              </label>
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_movie_skip_scenes')}</span>
                  <span class="setting-desc" id="movie-skip-desc">${t('settings_movie_skip_scenes_desc')}</span>
                </span>
                <input type="checkbox" id="movie-skip-toggle" aria-describedby="movie-skip-desc">
              </label>
            </div>

            <div class="settings-section-title">${t('settings_sec_pip')}</div>
            <div class="settings-group-card">
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_pip_auto_open')}</span>
                  <span class="setting-desc" id="pip-auto-open-desc">${t('settings_pip_auto_open_desc')}</span>
                </span>
                <input type="checkbox" id="pip-auto-open-toggle" aria-describedby="pip-auto-open-desc">
              </label>
            </div>
          </div>

          <div class="settings-panel" id="panel-sources">
            <div class="settings-section-title">${t('settings_sec_source_priority')}</div>
            <div class="settings-group-card">
              <div class="setting-row stacked">
                <span class="setting-name">${t('settings_source_auto_title')}</span>
                <span class="setting-desc">${t('settings_source_auto_desc')}</span>
                <div class="ytm-lang-group" id="lyric-source-group">
                  <button class="ytm-lang-pill" data-value="ytm">${t('settings_source_ytm')}</button>
                  <button class="ytm-lang-pill" data-value="lrchub">${t('settings_source_lrchub')}</button>
                  <button class="ytm-lang-pill" data-value="wordsync">${t('settings_source_wordsync')}</button>
                </div>
              </div>
            </div>

            <div class="settings-section-title">${t('settings_sec_source_list')}</div>
            <div class="settings-group-card">
              <div class="setting-row stacked">
                <span class="setting-name">${t('settings_extra_providers')}</span>
                <span class="setting-desc">${t('settings_extra_providers_desc')}</span>
                <div class="ytm-extra-providers-embed" id="extra-providers-embed"></div>
                <div class="ytm-lang-group" id="extra-providers-fallback" hidden>
                  <button class="ytm-lang-pill" id="extra-providers-btn">${t('settings_extra_providers_open')}</button>
                </div>
                <span class="setting-desc" id="extra-providers-reload" hidden>${t('settings_extra_providers_reload')}</span>
              </div>
            </div>
          </div>

          <div class="settings-panel" id="panel-translation">
            <div class="settings-section-title">${t('settings_sec_translation')}</div>
            <div class="settings-group-card">
              <label class="setting-row toggle-label">
                <span>
                  <span class="setting-name">${t('settings_trans')}</span>
                  <span class="setting-desc" id="trans-engine-desc"></span>
                </span>
                <input type="checkbox" id="trans-toggle" aria-describedby="trans-engine-desc">
              </label>
              <div class="setting-row stacked">
                <span class="setting-name">${t('settings_target_lang')}</span>
                <div class="ytm-lang-group" id="sub-lang-group">
                  <button class="ytm-lang-pill" data-value="auto">${t('settings_lang_auto')}</button>
                  <button class="ytm-lang-pill" data-value="ja">日本語</button>
                  <button class="ytm-lang-pill" data-value="en">English</button>
                  <button class="ytm-lang-pill" data-value="ko">한국어</button>
                  <button class="ytm-lang-pill" data-value="zh">中文</button>
                  <button class="ytm-lang-pill" data-value="original">${t('settings_lang_original')}</button>
                </div>
              </div>
            </div>

            <details class="settings-advanced" id="trans-advanced">
              <summary class="settings-advanced-summary">${t('settings_trans_advanced')}</summary>
              <div class="settings-group-card">
                <label class="setting-row toggle-label">
                  <span>
                    <span class="setting-name">${t('settings_shared_trans')}</span>
                    <span class="setting-desc" id="shared-trans-desc">${t('settings_shared_trans_desc')}</span>
                  </span>
                  <input type="checkbox" id="shared-trans-toggle" aria-describedby="shared-trans-desc">
                </label>
                <div class="setting-row stacked">
                  <span class="setting-name">${t('settings_main_lang')}</span>
                  <div class="ytm-lang-group" id="main-lang-group">
                    <button class="ytm-lang-pill" data-value="original">${t('settings_lang_original')}</button>
                    <button class="ytm-lang-pill" data-value="ja">日本語</button>
                    <button class="ytm-lang-pill" data-value="en">English</button>
                    <button class="ytm-lang-pill" data-value="ko">한국어</button>
                  </div>
                </div>
                <div class="setting-row stacked">
                  <span class="setting-name">DeepL API Key <span class="setting-tag">${t('settings_optional')}</span></span>
                  <span class="setting-desc">${t('settings_deepl_desc')}</span>
                  <input type="password" id="deepl-key-input" class="setting-input-text" placeholder="${t('settings_deepl_placeholder')}" autocomplete="off">
                </div>
              </div>
            </details>

          </div>

          <div class="settings-panel" id="panel-data">
            <div class="settings-section-title">${t('settings_sec_data')}</div>
            <div class="settings-group-card">
              <div class="setting-row action-row">
                <div class="setting-info">
                  <span class="setting-name">${t('settings_delete_current')}</span>
                  <span class="setting-desc">${t('settings_delete_current_desc')}</span>
                </div>
                <button id="delete-current-cache-btn" class="settings-action-btn btn-danger" ${hasCurrentSong ? '' : 'disabled'}>
                  ${ICONS.trash}<span>${t('settings_delete')}</span>
                </button>
              </div>
              <div class="setting-row action-row">
                <div class="setting-info">
                  <span class="setting-name">${t('settings_delete_all')}</span>
                  <span class="setting-desc">${t('settings_delete_all_desc')}</span>
                </div>
                <button id="clear-all-lyrics-cache-btn" class="settings-action-btn btn-danger strong">
                  ${ICONS.trash}<span>${t('settings_delete_all_btn')}</span>
                </button>
              </div>
            </div>

            <div class="settings-section-title">${t('settings_sec_reset')}</div>
            <div class="settings-group-card">
              <div class="setting-row action-row">
                <div class="setting-info">
                  <span class="setting-name">${t('settings_reset_all')}</span>
                  <span class="setting-desc">${t('settings_reset_all_desc')}</span>
                </div>
                <button id="clear-all-btn" class="settings-action-btn btn-neutral">${t('settings_reset')}</button>
              </div>
            </div>

          </div>

        </div>
      </div>
    `;
  // 設定を変えたら自動保存(ui.settings は描き直しても同じ要素なので、つなぐのは 1 回)。
  // トグル・スライダー・入力欄は change、言語やソースのピルはクリックで知る。
  if (!ui.settings._autosaveBound) {
    ui.settings._autosaveBound = true;
    ui.settings.addEventListener('change', (e) => {
      const el = e.target;
      if (el && el.matches && el.matches('.settings-panel input') && el.id !== 'settings-search') scheduleSettingsAutosave();
    });
    ui.settings.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('.settings-panel .ytm-lang-pill:not(#extra-providers-btn)')) scheduleSettingsAutosave();
    }, true);
    // 表示言語の「etc...」のメニューは body の直下に出る
    document.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('.ytm-lang-etc-item') && ui.settings.classList.contains('active')) scheduleSettingsAutosave();
    }, true);
  }

  // --- Tab Switching Logic ---
  const tabs = ui.settings.querySelectorAll('.settings-tab-btn');
  const panels = ui.settings.querySelectorAll('.settings-panel');

  // 開き直しても、描き直しても、最後に見ていたタブのまま
  const showTab = (tabId) => {
    const target = ui.settings.querySelector(`#panel-${tabId}`) ? tabId : 'visuals';
    settingsActiveTab = target;
    tabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === target));
    panels.forEach(p => p.classList.toggle('active', p.id === `panel-${target}`));
  };
  showTab(settingsActiveTab);
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // 検索中にタブを押したら、検索をやめてそのタブを開く
      const search = document.getElementById('settings-search');
      if (search && search.value) { search.value = ''; applySettingsSearch(''); }
      showTab(tab.getAttribute('data-tab'));
    });
  });
  // 検索中に、どのタブの項目かが分かるようにタブ名を控えておく
  panels.forEach(panel => {
    const tab = ui.settings.querySelector(`.settings-tab-btn[data-tab="${panel.id.replace(/^panel-/, '')}"]`);
    if (tab) panel.dataset.searchTitle = tab.textContent.trim();
  });
  const searchInput = document.getElementById('settings-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => applySettingsSearch(searchInput.value));
    // 描き直し(表示言語の切り替え)で残った検索語をそのまま効かせる
    if (searchInput.value) applySettingsSearch(searchInput.value);
  }


  // 値の反映
  document.getElementById('deepl-key-input').value = config.deepLKey || '';
  document.getElementById('trans-toggle').checked = config.useTrans;
  document.getElementById('shared-trans-toggle').checked = !!config.useSharedTranslateApi;
  document.getElementById('left-align-toggle').checked = !!config.leftAlignInfo;
  const barAutoHideToggle = document.getElementById('bar-autohide-toggle');
  if (barAutoHideToggle) barAutoHideToggle.checked = typeof BarAutoHide !== 'undefined' && BarAutoHide.isEnabled();
  document.getElementById('lyric-stagger-toggle').checked = config.lyricStagger !== false;
  document.getElementById('fade-past-lyrics-toggle').checked = !!config.fadePastLyrics;
  document.getElementById('prefer-song-mode-toggle').checked = !!config.preferSongMode;
  document.getElementById('level-volume-toggle').checked = config.levelVolume !== false;
  document.getElementById('movie-lyrics-toggle').checked = config.movieLyrics !== false;
  document.getElementById('movie-skip-toggle').checked = !!config.movieSkipScenes;
  document.getElementById('apple-bg-toggle').checked = !!config.appleBg;
  document.getElementById('low-cpu-toggle').checked = !!config.lowCpuMode;
  document.getElementById('apple-sync-toggle').checked = !!config.appleSyncStyle;
  const koreanRubyToggle = document.getElementById('korean-ruby-toggle');
  if (koreanRubyToggle) koreanRubyToggle.checked = typeof KoreanRuby !== 'undefined' && KoreanRuby.isEnabled();
  document.getElementById('animated-caption-toggle').checked = !!config.useAnimatedCaptions;
  document.getElementById('singer-colors-toggle').checked = !!config.useSingerColors;
  document.getElementById('meaning-always-toggle').checked = !!config.alwaysShowMeaning;
  document.getElementById('pip-auto-open-toggle').checked = !!config.pipAutoOpen;

  document.getElementById('sync-offset-input').valueAsNumber = config.syncOffset || 0;
  document.getElementById('sync-offset-save-toggle').checked = config.saveSyncOffset;

  // スライダーイベント設定
  // トラックの進捗フィル（CSS変数 --fill）を現在値に合わせて更新する
  const updateSliderFill = (slider) => {
    if (!slider) return;
    const min = parseFloat(slider.min || '0');
    const max = parseFloat(slider.max || '100');
    const val = parseFloat(slider.value || '0');
    const pct = (max > min) ? ((val - min) / (max - min)) * 100 : 0;
    slider.style.setProperty('--fill', pct.toFixed(1) + '%');
  };

  const wSlider = document.getElementById('weight-slider');
  const bSlider = document.getElementById('bright-slider');
  const sSlider = document.getElementById('ui-scale-slider');
  updateSliderFill(wSlider);
  updateSliderFill(bSlider);
  updateSliderFill(sSlider);
  if (sSlider) {
    sSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('ui-scale-val').textContent = Math.round(val * 100) + '%';
      applyUiScale(val);
      updateSliderFill(e.target);
    });
  }
  if (wSlider) {
    wSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('weight-val').textContent = val;
      config.lyricWeight = val;
      document.documentElement.style.setProperty('--ytm-lyric-weight', val);
      updateSliderFill(e.target);
    });
  }
  if (bSlider) {
    bSlider.addEventListener('input', (e) => {
      const val = e.target.value;
      document.getElementById('bright-val').textContent = Math.round(val * 100) + '%';
      document.documentElement.style.setProperty('--ytm-bg-brightness', val);
      PipManager.syncBackgroundBrightness();
      if (typeof FluidBg !== 'undefined') FluidBg.redraw();
      updateSliderFill(e.target);
    });
  }

  // 言語ピル設定
  setupLangPills('main-lang-group', config.mainLang, v => { config.mainLang = v; });
  // 翻訳を入れたクリックで、今の曲に要る言語データを落とし始める
  // (落とし始めはクリックの中でしかできない)。訳す先を変えた時も同じ。
  const transToggle = document.getElementById('trans-toggle');
  setupLangPills('sub-lang-group', config.subLang, v => {
    config.subLang = v;
    if (transToggle.checked) prepareBuiltinTranslation();
  });
  transToggle.addEventListener('change', () => {
    if (transToggle.checked) prepareBuiltinTranslation();
    updateTransEngineDesc();
  });
  document.getElementById('deepl-key-input')?.addEventListener('input', updateTransEngineDesc);
  updateTransEngineDesc();
  setupLangPills('lyric-source-group', config.lyricSourceMode || 'ytm', v => { config.lyricSourceMode = v; });
  refreshUiLangGroup();

  if (draft) writeSettingsDraft(draft);
  updateLyricMotionSettingsState();
  document.getElementById('low-cpu-toggle').addEventListener('change', updateLyricMotionSettingsState);

  // 閉じるボタン(保存していない変更は捨てる)
  const closeBtn = document.getElementById('ytm-settings-close-btn');
  if (closeBtn) {
    closeBtn.onclick = (ev) => {
      ev.stopPropagation();
      closeSettings();
    };
  }

  // 追加の歌詞サーバーの許可は、このパネルの中で切り替える。
  // 差し込めなかった時だけ、従来どおり別タブの許可ページを開くボタンを出す。
  mountExtraProvidersFrame();
  const extraProvidersBtn = document.getElementById('extra-providers-btn');
  if (extraProvidersBtn) {
    extraProvidersBtn.onclick = () => {
      // ボタンを出したあとで切り離されることもある。送っても黙って失敗するだけ
      if (!isExtensionContextAlive()) {
        showExtraProvidersReloadNotice();
        return;
      }
      safeRuntimeSendMessage({ type: 'OPEN_EXTRA_PROVIDERS_SETUP' });
    };
  }

  // 保存ボタンの処理
  // 設定を読み取って保存し、画面に反映する。設定を変えるたびに、閉じずに呼ぶ
  // (scheduleSettingsAutosave)。以前は「保存」を押さないと確定せず、押し忘れて
  // 閉じると変更が消えていた(どう保存するのか分かりにくいという声があった)。
  const commitSettings = async ({ close = false } = {}) => {
    const session = settingsSession;
    const prevAlwaysShowMeaning = !!config.alwaysShowMeaning;
    const [
      savedDeepLKey,
      savedMainLang,
      savedSubLang,
      savedUseTrans,
      savedSharedTrans,
      savedUiLang,
      savedAnimatedCaptions,
      savedLrcLibFallback,
      savedSourceMode,
      savedAppleSyncStyle,
      savedLowCpuMode,
      savedDisabledSources
    ] = await Promise.all([
      storage.get('ytm_deepl_key'),
      storage.get('ytm_main_lang'),
      storage.get('ytm_sub_lang'),
      storage.get('ytm_trans_enabled'),
      storage.get('ytm_shared_trans_enabled'),
      storage.get('ytm_ui_lang'),
      storage.get('ytm_animated_captions_enabled'),
      storage.get('ytm_lrclib_fallback'),
      storage.get('ytm_lyric_source_mode'),
      storage.get('ytm_apple_sync_style'),
      storage.get('ytm_low_cpu_mode'),
      storage.get(DISABLED_LYRIC_SOURCES_KEY)
    ]);

    const prevDeepLKey = savedDeepLKey || '';
    const prevMainLang = savedMainLang || 'original';
    const prevSubLang = savedSubLang !== null ? savedSubLang : 'auto';
    const prevUseTrans = savedUseTrans !== null ? savedUseTrans : false;
    const prevUseSharedTrans = savedSharedTrans !== null ? savedSharedTrans : true;
    const prevUiLang = savedUiLang || DEFAULT_UI_LANG;
    const prevAnimatedCaptions = savedAnimatedCaptions !== null ? !!savedAnimatedCaptions : false;
    const prevUseLrcLibFallback = savedLrcLibFallback !== null ? !!savedLrcLibFallback : true;
    const prevSourceMode = normalizeSourceMode(savedSourceMode);
    const prevAppleSync = savedAppleSyncStyle !== null ? !!savedAppleSyncStyle : true;
    const prevLowCpu = savedLowCpuMode !== null ? !!savedLowCpuMode : false;
    config.disabledLyricSources = normalizeDisabledLyricSources(savedDisabledSources);
    // 取得元のオン・オフは差し込んだ許可ページの中でその場で保存される。
    // 開いた時から変わっていれば今の曲を取り直す。
    const disabledSourcesChanged = !!session && (
      session.sourcesChanged ||
      session.disabledSources !== disabledSourcesKey(config.disabledLyricSources)
    );

    // 画面から値を取得
    config.deepLKey = document.getElementById('deepl-key-input').value.trim();
    config.useTrans = document.getElementById('trans-toggle').checked;
    config.useSharedTranslateApi = document.getElementById('shared-trans-toggle').checked;
    config.leftAlignInfo = document.getElementById('left-align-toggle').checked;
    const nextBarAutoHide = !!document.getElementById('bar-autohide-toggle')?.checked;
    if (typeof BarAutoHide !== 'undefined' && BarAutoHide.isEnabled() !== nextBarAutoHide) BarAutoHide.setEnabled(nextBarAutoHide);
    config.lyricStagger = document.getElementById('lyric-stagger-toggle').checked;
    config.fadePastLyrics = document.getElementById('fade-past-lyrics-toggle').checked;
    config.keepPastLyrics = !config.fadePastLyrics;
    config.preferSongMode = document.getElementById('prefer-song-mode-toggle').checked;
    config.levelVolume = document.getElementById('level-volume-toggle').checked;
    VolumeLeveler.setEnabled(config.levelVolume);
    config.movieLyrics = document.getElementById('movie-lyrics-toggle').checked;
    config.movieSkipScenes = document.getElementById('movie-skip-toggle').checked;
    document.body.classList.toggle('ytm-movie-lyrics', !!config.movieLyrics);
    config.appleBg = document.getElementById('apple-bg-toggle').checked;
    config.lowCpuMode = document.getElementById('low-cpu-toggle').checked;
    config.appleSyncStyle = document.getElementById('apple-sync-toggle').checked;
    // 試作: 韓国語の読み(korean-ruby.js)。切り替えたら下で描き直す
    const prevKoreanRuby = typeof KoreanRuby !== 'undefined' && KoreanRuby.isEnabled();
    const nextKoreanRuby = !!document.getElementById('korean-ruby-toggle')?.checked;
    if (typeof KoreanRuby !== 'undefined' && prevKoreanRuby !== nextKoreanRuby) KoreanRuby.setEnabled(nextKoreanRuby);
    config.useAnimatedCaptions = document.getElementById('animated-caption-toggle').checked;
    config.useSingerColors = document.getElementById('singer-colors-toggle').checked;
    config.alwaysShowMeaning = document.getElementById('meaning-always-toggle').checked;
    config.pipAutoOpen = document.getElementById('pip-auto-open-toggle').checked;
    config.lyricWeight = document.getElementById('weight-slider').value;
    config.bgBrightness = document.getElementById('bright-slider').value;
    config.uiScale = normalizeUiScale(document.getElementById('ui-scale-slider')?.value);

    const offsetVal = document.getElementById('sync-offset-input').valueAsNumber;
    config.syncOffset = isNaN(offsetVal) ? 0 : offsetVal;
    config.saveSyncOffset = document.getElementById('sync-offset-save-toggle').checked;

    // Persist every value before re-rendering. applyLyricsText/loadLyrics read some
    // settings back from storage, so fire-and-forget writes can restore stale values.
    await Promise.all([
      storage.set('ytm_deepl_key', config.deepLKey),
      storage.set('ytm_trans_enabled', config.useTrans),
      storage.set('ytm_shared_trans_enabled', config.useSharedTranslateApi),
      storage.set('ytm_left_align', config.leftAlignInfo),
      storage.set('ytm_lyric_stagger', config.lyricStagger),
      storage.set('ytm_fade_past_lyrics', config.fadePastLyrics),
      storage.set('ytm_prefer_song_mode', config.preferSongMode),
      storage.set('ytm_level_volume', config.levelVolume !== false),
      storage.set('ytm_movie_lyrics', !!config.movieLyrics),
      storage.set('ytm_movie_skip_scenes', !!config.movieSkipScenes),
      storage.set('ytm_bar_autohide', nextBarAutoHide),
      storage.set('ytm_apple_bg', config.appleBg),
      storage.set('ytm_low_cpu_mode', config.lowCpuMode),
      storage.set('ytm_apple_sync_style', config.appleSyncStyle),
      storage.set('ytm_animated_captions_enabled', config.useAnimatedCaptions),
      storage.set('ytm_singer_colors_enabled', config.useSingerColors),
      storage.set('ytm_lrclib_fallback', config.useLrcLibFallback),
      storage.set(MEANING_ALWAYS_SHOW_KEY, config.alwaysShowMeaning),
      storage.set('ytm_pip_auto_open', config.pipAutoOpen),
      storage.set('ytm_main_lang', config.mainLang),
      storage.set('ytm_sub_lang', config.subLang),
      storage.set('ytm_ui_lang', config.uiLang),
      storage.set('ytm_lyric_weight', config.lyricWeight),
      storage.set('ytm_bg_brightness', config.bgBrightness),
      storage.set('ytm_ui_scale', config.uiScale),
      storage.set('ytm_sync_offset', config.syncOffset),
      storage.set('ytm_save_sync_offset', config.saveSyncOffset),
      storage.set('ytm_lyric_source_mode', config.lyricSourceMode)
    ]);

    document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);
    document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
    document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);
    document.body.classList.toggle('ytm-lightweight-mode', !!config.lowCpuMode);
    document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
    syncFluidBg();
    applyAppleSyncClass();
    applyLyricEffectsSettings();
    if (PipManager.pipWindow?.document) {
      PipManager.pipWindow.document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
      PipManager.pipWindow.document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
    }
    document.documentElement.style.setProperty('--ytm-lyric-weight', config.lyricWeight);
    document.documentElement.style.setProperty('--ytm-bg-brightness', config.bgBrightness);
    PipManager.syncBackgroundBrightness();
    PipManager.setAutoOpen(!!config.pipAutoOpen);
    applyUiScale(config.uiScale);

    // 訳す先が「自動」なら、表示言語を変えると訳す言語も変わる
    const autoTargetChanged = prevUiLang !== config.uiLang &&
      [config.mainLang, config.subLang].includes('auto');
    const translationChanged = (
      autoTargetChanged ||
      prevDeepLKey !== config.deepLKey ||
      prevMainLang !== config.mainLang ||
      prevSubLang !== config.subLang ||
      prevUseTrans !== config.useTrans ||
      prevUseSharedTrans !== config.useSharedTranslateApi
    );
    const animatedCaptionsChanged = prevAnimatedCaptions !== config.useAnimatedCaptions;
    // Apple Music 風と従来式では DOM の作りが違う(語ごとの span か
    // 1文字ずつの span か)。切り替えたら描き直さないと反映されない。
    const wordSyncChanged = prevAppleSync !== config.appleSyncStyle ||
      prevLowCpu !== config.lowCpuMode;
    const lyricsSourceChanged = (
      disabledSourcesChanged ||
      prevSourceMode !== config.lyricSourceMode ||
      prevUseLrcLibFallback !== config.useLrcLibFallback
    );
    const uiLanguageChanged = prevUiLang !== config.uiLang;
    const meaningAlwaysChanged = prevAlwaysShowMeaning !== config.alwaysShowMeaning;
    // 読みは表示言語でカナとローマ字が変わるので、言語を変えた時も描き直す
    const koreanRubyChanged = prevKoreanRuby !== nextKoreanRuby || (nextKoreanRuby && uiLanguageChanged);

    if (close) {
      closeSettings({ saved: true });
    } else if (settingsSession) {
      // 開いたまま保存した。閉じた時に戻す基準を、いま保存した値にそろえる
      settingsSession.snapshot = Object.fromEntries(SETTINGS_LIVE_KEYS.map(key => [key, config[key]]));
      settingsSession.disabledSources = disabledSourcesKey(config.disabledLyricSources);
      settingsSession.sourcesChanged = false;
    }

    if (animatedCaptionsChanged || lyricsSourceChanged || wordSyncChanged) {
      const metaNow = getMetadata();
      if (metaNow?.title && metaNow?.artist) {
        await loadLyrics(metaNow);
      } else if (lastRawLyricsText) {
        await applyLyricsText(lastRawLyricsText);
      }
    } else if (translationChanged) {
      if (lastRawLyricsText) {
        await applyLyricsText(lastRawLyricsText);
      } else {
        const metaNow = getMetadata();
        if (metaNow?.title && metaNow?.artist) await loadLyrics(metaNow);
      }
    } else if (koreanRubyChanged && Array.isArray(lyricsData) && lyricsData.length) {
      renderLyrics(lyricsData);
    }

    if (meaningAlwaysChanged) {
      if (config.alwaysShowMeaning && lyricsMeaning) {
        meaningPanelVisible = true;
        meaningHoverVisible = false;
        meaningHoverIndex = -1;
      } else if (!isMeaningPersistentlyVisible()) {
        meaningPanelVisible = false;
      }
      refreshMeaningUi();
    }

    if (uiLanguageChanged) {
      applyButtonLabels();
      applyLyricsSourceBadgeText();
      PlayerBar.refresh();
      const replayWasActive = !!ui.replayPanel?.classList.contains('active');
      const replayRange = ui.replayPanel?.dataset?.range || 'day';
      if (ui.replayPanel) {
        ui.replayPanel.remove();
        ui.replayPanel = null;
        createReplayPanel();
        ui.replayPanel.dataset.range = replayRange;
        ui.replayPanel.querySelectorAll('.ytm-lang-pill').forEach(pill => {
          pill.classList.toggle('active', pill.dataset.range === replayRange);
        });
        if (replayWasActive) {
          ui.replayPanel.classList.add('active');
          ReplayManager.renderUI();
        }
      }
      renderSettingsPanel();
    }
  };
  ui.settings._commitSettings = commitSettings;

  // リセットボタン
  //
  // 以前は storage.clear で全部消していた。説明文は「設定を初期状態に戻す」と
  // しか書いていないのに、再生履歴も歌詞キャッシュもクラウドの復活の呪文も
  // 巻き添えで消えていた。消すのは設定のキーだけにする。
  document.getElementById('clear-all-btn').onclick = async () => {
    if (!confirm(t('settings_reset_confirm'))) return;
    await Promise.all(SETTINGS_STORAGE_KEYS.map(key => storage.remove(key)));
    location.reload();
  };

  // すべての歌詞データを削除ボタンの処理
  const clearLyricsBtn = document.getElementById('clear-all-lyrics-cache-btn');
  if (clearLyricsBtn) {
    clearLyricsBtn.onclick = async () => {
      if (confirm(t('settings_delete_all_confirm'))) {
        if (!chrome?.storage?.local) return;
        chrome.storage.local.get(null, async (items) => {
          const keysToDelete = Object.keys(items).filter(k => k.includes('///'));
          if (keysToDelete.length > 0) {
            await new Promise(resolve => chrome.storage.local.remove(keysToDelete, resolve));
          }
          showToast(t('settings_deleted_all'));
          location.reload();
        });
      }
    };
  }

  // キャッシュ削除ボタンの処理
  const delBtn = document.getElementById('delete-current-cache-btn');
  if (delBtn) {
    delBtn.onclick = async () => {
      if (!currentKey) return;
      if (confirm(t('settings_delete_current_confirm'))) {
        await storage.remove(currentKey);

        lyricsData = [];
        dynamicLines = null;
        duetSubDynamicLines = null;
        _duetExcludedTimes = new Set();
        lyricsCandidates = null;
        selectedCandidateId = null;
        lyricsRequests = null;
        lyricsConfig = null;
        lyricsLockState = null;

        renderLyrics([]);
        refreshCandidateMenu();
        refreshLockMenu();

        showToast(t('settings_deleted_current'));
      }
    };
  }
}

function createReplayPanel() {
  ui.replayPanel = createEl('div', 'ytm-replay-panel', '', `
      <div class="replay-head">
        <h3>Daily Replay</h3>
        <div class="replay-head-right">
          <div class="ytm-lang-group">
            <button class="ytm-lang-pill active" data-range="day">${t('replay_today')}</button>
            <button class="ytm-lang-pill" data-range="week">${t('replay_week')}</button>
            <button class="ytm-lang-pill" data-range="all">${t('replay_all')}</button>
          </div>
          <button class="replay-share-btn replay-icon-btn" aria-label="${t('replay_share_image')}" title="${t('replay_share_image')}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.5 13.4l7 4.1M15.5 6.5l-7 4.1"/></svg></button>
          <button class="replay-close-btn ytm-unified-close-btn size-40"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      </div>

      <div class="ytm-replay-content">
        <div class="lyric-loading">Calculating...</div>
      </div>

    `);

  document.body.appendChild(ui.replayPanel);

  ui.replayPanel.querySelector('.replay-close-btn').onclick = () => {
    ui.replayPanel.classList.remove('active');
  };

  // 共有はフッターの管理用ボタンの列から出して、見出しの隣に置く。
  // いちばん使うものが Restore / Backup / Cloud / リセット に埋もれていた。
  ui.replayPanel.querySelector('.replay-share-btn').onclick = async (ev) => {
    const btn = ev.currentTarget;
    // 押した時点の期間で作る。パネルを開いたまま期間を切り替えられる。
    const range = ui.replayPanel.dataset.range || 'day';
    const stats = await ReplayManager.getStats(range);
    if (!stats.totalPlays) return;
    btn.disabled = true;
    try {
      await ReplayShare.open(stats, range);
    } finally {
      btn.disabled = false;
    }
  };

  const pills = ui.replayPanel.querySelectorAll('.ytm-lang-pill');
  pills.forEach(p => {
    p.onclick = (e) => {
      pills.forEach(x => x.classList.remove('active'));
      e.target.classList.add('active');
      ui.replayPanel.dataset.range = e.target.dataset.range;
      ReplayManager.renderUI();
    };
  });
}

// ===================== Artist Seamless Switch =====================
const SWITCH_NOISE_KEYWORDS = [
  '歌ってみた', '弾いてみた', '弾いてみたけど', '踊ってみた', '叩いてみた',
  '歌われてみた', '演奏してみた', '演奏動画',
  'cover', 'covered', 'karaoke', 'カラオケ',
  'acoustic', 'live', 'remix', 'piano',
  'arrange', 'off vocal', 'instrumental', 'full chorus', 'short ver'
];

function _switchQueryForMeta(meta) {
  // Search title only — not title+artist, so we get all versions
  return (meta?.title || '').trim();
}

function _filterSwitchResults(items, meta) {
  const titleLower = (meta?.title || '').toLowerCase();
  return items.filter(item => {
    const t = (item.title || '').toLowerCase();
    const ch = (item.channel || '').toLowerCase();
    // Keep items whose title shares words with the song title (looser check)
    const titleWords = titleLower.split(/\s+/).filter(w => w.length > 1);
    const hasTitle = titleWords.some(w => t.includes(w));
    if (!hasTitle) return false;
    // Exclude noise keywords
    for (const kw of SWITCH_NOISE_KEYWORDS) {
      if (t.includes(kw) || ch.includes(kw)) return false;
    }
    return true;
  });
}

async function searchYTMAlternatives(meta) {
  const q = _switchQueryForMeta(meta);
  if (!q) return [];
  // InnerTube の検索は ytm-lyrics.js の post に任せる。
  //
  // 以前はここに API キー直書き・hl/gl を 'ja'/'JP' 固定・タイムアウト無しの
  // 別実装を置いていた。同じ InnerTube を二重に実装していたので、
  // 片方だけ直すと食い違う。あちらはページの設定(言語・地域・
  // clientVersion・visitorData)を使い、タイムアウトも持っている。
  if (!window.YTMLyrics || typeof window.YTMLyrics.search !== 'function') {
    console.warn('[Switch] YTMLyrics.search が使えない');
    return [];
  }
  try {
    // params 無し = 曲・動画・アルバムなど全種類を返す
    const data = await window.YTMLyrics.search(q);
    if (!data) return [];

    const results = [];
    const walk = (obj, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 30) return;
      if (obj.musicResponsiveListItemRenderer) {
        const r = obj.musicResponsiveListItemRenderer;
        const videoId =
          r.playlistItemData?.videoId ||
          r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
          r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.find(x => x.navigationEndpoint?.watchEndpoint)?.navigationEndpoint?.watchEndpoint?.videoId;
        const title = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || '';
        const subtitle = (r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []).map(x => x.text).join('');
        const thumbs = r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const thumb = thumbs.length ? thumbs[thumbs.length - 1].url : '';
        if (videoId && title) results.push({ videoId, title, channel: subtitle, thumb });
        return; // don't descend into an item we already parsed
      }
      for (const key of Object.keys(obj)) {
        const val = obj[key];
        if (Array.isArray(val)) val.forEach(v => walk(v, depth + 1));
        else if (val && typeof val === 'object') walk(val, depth + 1);
      }
    };
    walk(data);
    const seen = new Set();
    return results.filter(r => { if (seen.has(r.videoId)) return false; seen.add(r.videoId); return true; });
  } catch (e) {
    console.error('[Switch] Search failed:', e);
    return [];
  }
}


function setupSwitchPanel(triggerBtn) {
  // Toggle: close if already open
  const existing = document.getElementById('ytm-switch-panel');
  if (existing) { existing.remove(); return; }

  const meta = getMetadata();
  if (!meta || !meta.title) { showToast('曲名情報を取得できませんでした'); return; }

  const panel = document.createElement('div');
  panel.id = 'ytm-switch-panel';
  panel.className = 'ytm-switch-panel';
  panel.innerHTML = `
      <div class="ytm-switch-header">
        <span>🔄 代替バージョンを検索: ${escapeHtml(meta.title)}</span>
        <button class="ytm-switch-close ytm-unified-close-btn size-26" id="ytm-switch-close"><svg viewBox="0 0 12 12" fill="none" stroke="currentColor"><path d="M1.5 1.5L10.5 10.5M10.5 1.5L1.5 10.5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
      <div class="ytm-switch-list" id="ytm-switch-list">
        <div class="ytm-switch-loading">検索中…</div>
      </div>
    `;
  document.body.appendChild(panel);

  // Position panel ABOVE the trigger button
  if (triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect();
    const panelWidth = 360;
    const isMoviemode = triggerBtn.classList.contains("moviemode");
    let left = rect.left + rect.width / 2 - panelWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    panel.style.position = 'fixed';
    panel.style.left = `${left}px`;
    panel.style.bottom = isMoviemode ? 'auto' : `${(window.innerHeight - rect.top + 10)}px`;
    panel.style.top = isMoviemode ? `${rect.top - 10 + 65}px` : 'auto';// 65pxはちょうどいい高さオフセット
    panel.style.right = 'auto';
  }

  document.getElementById('ytm-switch-close').onclick = () => panel.remove();
  setTimeout(() => {
    document.addEventListener('click', function outsideClick(ev) {
      if (!panel.contains(ev.target) && !ev.target.closest('#ytm-switch-btn')) {
        panel.remove();
        document.removeEventListener('click', outsideClick, true);
      }
    }, true);
  }, 100);

  searchYTMAlternatives(meta).then(rawResults => {
    const results = _filterSwitchResults(rawResults, meta);
    const listEl = document.getElementById('ytm-switch-list');
    if (!listEl) return;

    if (!results.length) {
      // Show all unfiltered results if filter removed everything
      const fallback = rawResults.slice(0, 10);
      if (!fallback.length) {
        listEl.innerHTML = '<div class="ytm-switch-loading">候補が見つかりませんでした</div>';
        return;
      }
      listEl.innerHTML = '<div class="ytm-switch-loading" style="font-size:10px;opacity:0.6;padding:6px 10px">フィルターを緩めて表示しています</div>';
      renderSwitchItems(listEl, fallback, false);
      return;
    }
    listEl.innerHTML = '';
    renderSwitchItems(listEl, results, true);
  });
}

function renderSwitchItems(listEl, items, clearFirst) {
  if (clearFirst) listEl.innerHTML = '';
  const video = document.querySelector('video');
  // 連続再生対応: 曲開始オフセットを引いて曲内ローカル位置で別バージョンに飛ばす
  const currentTime = video && Number.isFinite(video.currentTime) ? toLocalPlaybackTime(video.currentTime) : 0;

  items.forEach(item => {
    const row = document.createElement('button');
    row.className = 'ytm-switch-item';
    row.innerHTML = `
        ${item.thumb ? `<img class="ytm-switch-thumb" src="${escapeHtml(item.thumb)}" alt="">` : '<div class="ytm-switch-thumb"></div>'}
        <div class="ytm-switch-info">
          <div class="ytm-switch-title">${escapeHtml(item.title)}</div>
          <div class="ytm-switch-channel">${escapeHtml(item.channel)}</div>
        </div>
      `;
    row.onclick = () => {
      document.getElementById('ytm-switch-panel')?.remove();
      const t = Math.floor(currentTime);
      const url = `https://music.youtube.com/watch?v=${item.videoId}&t=${t}s`;
      location.href = url;
    };
    listEl.appendChild(row);
  });
}

function initLayout() {
  // 既に組んだ UI がそのまま画面に居るなら、参照を取り直す必要は無い。
  // この関数は tick から毎回呼ばれるので、下の拾い直し(getElementById を
  // 十数回)が player-bar が動くたびに走っていた。
  // YTM が作り直した時は id で引いた結果が別物になるので、そこで通す。
  if (
    ui.wrapper && ui.wrapper.isConnected &&
    ui.lyrics && ui.lyrics.isConnected &&
    document.getElementById('ytm-custom-wrapper') === ui.wrapper
  ) {
    return;
  }

  const existingWrapper = document.getElementById('ytm-custom-wrapper');
  if (existingWrapper && !ui.wrapper) {
    existingWrapper.remove();
    document.getElementById('ytm-custom-bg')?.remove();
  }

  if (document.getElementById('ytm-custom-wrapper')) {
    ui.wrapper = document.getElementById('ytm-custom-wrapper');
    ui.bg = document.getElementById('ytm-custom-bg');
    ui.lyricsStage = document.getElementById('ytm-lyrics-stage');
    ui.lyrics = document.getElementById('my-lyrics-container');
    ui.meaningPanel = document.getElementById('ytm-meaning-panel');
    ui.title = document.getElementById('ytm-custom-title');
    ui.artist = document.getElementById('ytm-custom-artist');
    ui.artwork = document.getElementById('ytm-artwork-container');
    ui.btnArea = document.getElementById('ytm-btn-area');
    ui.appBtnArea = document.getElementById('ytm-app-btn-area');
    document.getElementById('ytm-meaning-btn')?.remove();
    ui.meaningBtn = null;
    ui.summaryBtn = document.getElementById('ytm-meaning-summary-btn');
    ui.meaningSummaryBackdrop = document.getElementById('ytm-meaning-summary-backdrop');
    ui.meaningSummaryDialog = document.getElementById('ytm-meaning-summary-dialog');
    ui.lyricsBtn = ui.btnArea ? ui.btnArea.querySelector('.lyrics-btn') : null;
    ui.settingsBtn = document.getElementById('ytm-settings-btn');
    ui.uploadMenu = document.getElementById('ytm-upload-menu');
    ui.deleteDialog = document.getElementById('ytm-delete-dialog');
    setupAutoHideEvents();
    setupMeaningPanelHoverEvents();
    // ここで refreshMeaningUi() は呼ばない。
    //
    // initLayout は tick から毎回通る(player-bar の属性が動くたび)。
    // 既存の UI を拾い直すだけのこの経路で解説パネルを作り直すと、
    // 開いている間ずっと、ホバー中もスクロール中も中身が innerHTML ごと
    // 組み直される。中身の更新は初回生成時と setLyricsMeaningData に任せる。
    return;
  }
  ui.bg = createEl('div', 'ytm-custom-bg');
  document.body.appendChild(ui.bg);
  ui.wrapper = createEl('div', 'ytm-custom-wrapper');
  const leftCol = createEl('div', 'ytm-custom-left-col');
  ui.artwork = createEl('div', 'ytm-artwork-container');
  const info = createEl('div', 'ytm-custom-info-area');
  ui.title = createEl('div', 'ytm-custom-title');
  ui.artist = createEl('div', 'ytm-custom-artist');
  ui.btnArea = createEl('div', 'ytm-btn-area');

  const btns = [];
  // 歌詞メニュー(取得元の切り替え・ズレ直し・読み込み)。
  // 以前は「Lyrics」「PIP」の 2 つだけが文字のボタンで、ほかの絵のボタンと
  // 形も大きさも揃わず、英語のまま表示言語にも従わず、UI サイズを上げると
  // 「Lyrics」だけが横に伸びて列がはみ出す一因になっていた。
  // 名前はホバーの説明と読み上げに付く(applyButtonLabels)。取得元の表示
  // (ボタン列の下)からも同じメニューが開くので、文字が無くても辿り着ける。
  const lyricsBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h10M4 11h10M4 15.5h5.5"/><path d="M19.5 7v9"/><circle cx="17.3" cy="16.4" r="2.2"/></svg>',
    cls: 'icon-btn lyrics-btn',
    label: 'btn_lyrics_menu',
    click: () => { }
  };

  //  PiPボタン
  const pipBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1" fill="currentColor" stroke="none"/></svg>',
    cls: 'icon-btn',
    label: 'btn_pip',
    click: () => PipManager.toggle()
  };

  const replayBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z"/></svg>',
    cls: 'icon-btn',
    label: 'btn_replay',
    group: 'app',
    click: () => {
      if (!ui.replayPanel) {
        createReplayPanel();
      }
      ui.replayPanel.classList.add('active');
      ReplayManager.renderUI();
    }
  };


  const settingsBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.73 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .43-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.49-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
    cls: 'icon-btn',
    label: 'settings_title',
    group: 'app',
    click: async () => {
      if (ui.settings?.classList.contains('active')) closeSettings();
      else await openSettings();
    }
  };

  const switchBtnConfig = {
    txt: '',
    cls: 'icon-btn ytm-switch-icon-btn',
    label: 'btn_switch_version',
    click: (ev) => setupSwitchPanel(ev.currentTarget)
  };

  // 動画の画質(動画モードの時だけ出る。本体は video-quality.js)
  const qualityBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20"><rect x="2" y="5" width="20" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.9"/><text x="12" y="15.3" text-anchor="middle" font-size="8.4" font-weight="800" fill="currentColor" font-family="system-ui, -apple-system, sans-serif">HD</text></svg>',
    cls: 'icon-btn ytm-quality-btn',
    label: 'btn_video_quality',
    click: () => { }
  };

  // 歌詞カード(選んだ行を画像にする。本体は lyric-card.js)
  const lyricCardBtnConfig = {
    txt: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7.5 10.5h2.8v2.3c0 1.2-.7 2.1-1.9 2.4M13.7 10.5h2.8v2.3c0 1.2-.7 2.1-1.9 2.4"/></svg>',
    cls: 'icon-btn ytm-lyric-card-btn',
    label: 'btn_lyric_card',
    click: () => { if (typeof LyricCard !== 'undefined') LyricCard.start(); }
  };

  // ボタン配列に追加
  // 前半は今の曲と歌詞に対する操作、後半(group: 'app')は曲に関係しない
  // アプリ全体の操作(Daily Replay・設定)。以前は統計が歌詞カードと
  // 別バージョンの間に挟まり、6 つが同じ重みで並んでいた。
  // 後半は同じ列の末尾に区切って置く。画面の隅へ分ける案も実機で試したが、
  // 上端は YTM の検索バー(ホバーで出る)、右端は Up Next を開く帯、
  // 狭い画面と動画モードの隅は曲/動画の切り替えが使っていて、
  // どこに置いてもホバーやクリックを取り合った。
  btns.push(lyricsBtnConfig, pipBtnConfig, qualityBtnConfig, lyricCardBtnConfig, switchBtnConfig, replayBtnConfig, settingsBtnConfig);
  ui.appBtnArea = createEl('div', 'ytm-app-btn-area');
  ui.appBtnArea.setAttribute('role', 'group');

  btns.forEach(b => {
    const btn = createEl('button', '', `ytm-glass-btn ${b.cls || ''}`, b.txt);
    btn.onclick = b.click;
    // 絵だけのボタンは、何のボタンか分からず読み上げもされなかった
    if (b.label) btn.dataset.ytmLabel = b.label;
    (b.group === 'app' ? ui.appBtnArea : ui.btnArea).appendChild(btn);
    if (b === lyricsBtnConfig) {
      ui.lyricsBtn = btn;
      setupUploadMenu(btn);
    }
    if (b === qualityBtnConfig) setupQualityMenu(btn);
    if (b === switchBtnConfig) {
      btn.id = 'ytm-switch-btn';
      // Use the custom icon image
      try {
        const iconUrl = chrome.runtime.getURL('src/assets/icons/ArtistChange.png');
        btn.innerHTML = `<img src="${iconUrl}" style="width:18px;height:18px;object-fit:contain;vertical-align:middle;" alt="">`;
      } catch (_) { btn.textContent = '🔄'; }
    }
    if (b === settingsBtnConfig) {
      btn.id = 'ytm-settings-btn';
      ui.settingsBtn = btn;
    }
  });
  ui.btnArea.appendChild(ui.appBtnArea);
  applyButtonLabels();

  ui.input = createEl('input');
  ui.input.type = 'file';
  ui.input.accept = '.lrc,.txt,.ttml,.xml';
  ui.input.style.display = 'none';
  ui.input.onchange = handleUpload;
  document.body.appendChild(ui.input);
  info.append(ui.title, ui.artist, ui.btnArea);
  leftCol.append(ui.artwork, info);
  ui.lyricsStage = createEl('div', 'ytm-lyrics-stage');
  ui.lyrics = createEl('div', 'my-lyrics-container');
  ui.summaryBtn = createEl(
    'button',
    'ytm-meaning-summary-btn',
    'ytm-lyrics-summary-trigger',
    '<span aria-hidden="true">i</span>'
  );
  ui.summaryBtn.type = 'button';
  ui.summaryBtn.title = '要約';
  ui.summaryBtn.setAttribute('aria-label', '曲の要約を表示');
  ui.summaryBtn.onclick = () => showMeaningSummaryPopup();
  ui.artwork.appendChild(ui.summaryBtn);
  // ジャケットを押すと再生/一時停止(中の要約ボタンは除く)
  ui.artwork.addEventListener('click', (ev) => {
    if (ev.target.closest('#ytm-meaning-summary-btn')) return;
    PlayerBar.controls.togglePlay();
  });
  ui.meaningPanel = createEl('aside', 'ytm-meaning-panel', 'ytm-meaning-panel');
  ui.lyricsStage.append(ui.lyrics, ui.meaningPanel);
  ui.wrapper.append(leftCol, ui.lyricsStage);
  document.body.appendChild(ui.wrapper);
  ensureMeaningSummaryDialog();
  refreshMeaningUi();
  setupMeaningPanelHoverEvents();
  setupAutoHideEvents();
  setupScrollResumeEvents();
  if (isYTMPremiumUser()) setupMovieMode(); //moviemode setup

  // ここまで来たのは、器を新しく組んだ時だけ(既にあるならもっと上で帰っている)。
  // 組み直した直後の器は空なので、いま出していた歌詞をそのまま出し直す。
  // これが無いと、YTM 側の作り直しに巻き込まれて器ごと入れ替わった時、
  // 曲は鳴っているのに次の曲まで歌詞が出ないままになる。
  // applyLyricsText を通すのは、srv3(アニメーション字幕)とふつうの歌詞で
  // 組み方が違うため。あちらが今の設定に合わせて出し分ける。
  if (typeof lastRawLyricsText === 'string' && lastRawLyricsText.trim()) {
    void applyLyricsText(lastRawLyricsText);
  }
}

let lyricsLateRetryTimer = null;
let lyricsLateRetryKey = null;
const LYRICS_LATE_RETRY_DELAYS_MS = [15000, 30000];
const LYRICS_CACHE_VERSION = 2;

function clearLyricsLateRetry(targetKey = null) {
  if (targetKey && lyricsLateRetryKey && lyricsLateRetryKey !== targetKey) return;
  if (lyricsLateRetryTimer) {
    clearTimeout(lyricsLateRetryTimer);
    lyricsLateRetryTimer = null;
  }
  lyricsLateRetryKey = null;
}

function scheduleLyricsLateRetry(meta, targetKey, attempt = 0) {
  if (!targetKey || currentKey !== targetKey) return;
  const targetVideoId = currentLyricsVideoId || getCurrentVideoId() || '';
  if (lyricsLateRetryTimer) return;
  if (attempt >= LYRICS_LATE_RETRY_DELAYS_MS.length) return;

  const delayMs = LYRICS_LATE_RETRY_DELAYS_MS[attempt];
  lyricsLateRetryKey = targetKey;
  lyricsLateRetryTimer = setTimeout(() => {
    lyricsLateRetryTimer = null;
    lyricsLateRetryKey = null;
    if (currentKey !== targetKey) return;
    if (
      (currentLyricsVideoId || '') !== targetVideoId ||
      (getCurrentVideoId() || '') !== targetVideoId
    ) return;

    const metaNow = getMetadata() || meta;
    if (!metaNow) return;
    const keyNow = `${metaNow.title}///${metaNow.artist}`;
    if (keyNow !== targetKey) return;

    loadLyrics(metaNow, { lateRetryAttempt: attempt + 1 });
  }, delayMs);
}

async function loadLyrics(meta, options = {}) {
  await Promise.all([ensureMeaningDisplayPreferences(), runtimeSettingsReady]);
  if (!config.deepLKey) config.deepLKey = await storage.get('ytm_deepl_key');
  const cachedTrans = await storage.get('ytm_trans_enabled');
  if (cachedTrans !== null && cachedTrans !== undefined) config.useTrans = cachedTrans;

  const cachedSharedTrans = await storage.get('ytm_shared_trans_enabled');
  if (cachedSharedTrans !== null && cachedSharedTrans !== undefined) config.useSharedTranslateApi = cachedSharedTrans;
  const mainLangStored = await storage.get('ytm_main_lang');
  const subLangStored = await storage.get('ytm_sub_lang');
  if (mainLangStored) config.mainLang = mainLangStored;
  if (subLangStored !== null && subLangStored !== undefined) config.subLang = subLangStored;
  const uiLangStored = await storage.get('ytm_ui_lang');
  if (uiLangStored) config.uiLang = uiLangStored;
  const lrclibFallbackStored = await storage.get('ytm_lrclib_fallback');
  config.useLrcLibFallback = true;  // 歌詞ソース設定は廃止。常に全ソースを使う
  const animatedCaptionStored = await storage.get('ytm_animated_captions_enabled');
  if (animatedCaptionStored !== null && animatedCaptionStored !== undefined) config.useAnimatedCaptions = !!animatedCaptionStored;
  const appleSyncStored = await storage.get('ytm_apple_sync_style');
  if (appleSyncStored !== null && appleSyncStored !== undefined) config.appleSyncStyle = !!appleSyncStored;
  applyAppleSyncClass();
  const sourceModeStored = await storage.get('ytm_lyric_source_mode');
  config.lyricSourceMode = normalizeSourceMode(sourceModeStored);
  config.disabledLyricSources = normalizeDisabledLyricSources(await storage.get(DISABLED_LYRIC_SOURCES_KEY));

  const thisKey = `${meta.title}///${meta.artist}`;
  const requestVideoId = getCurrentVideoId() || '';
  if (thisKey !== currentKey || requestVideoId !== (currentLyricsVideoId || '')) return;
  const requestId = `lyrics-${Date.now()}-${++lyricsRequestSequence}`;
  activeLyricsRequestId = requestId;
  currentLyricsResultPriority = 0;
  currentLyricsQuality = 0;
  // Invalidate an older applyLyricsText() call for the same track/video while
  // this newer request is being resolved.
  lyricsApplyEpoch += 1;
  let cached = await storage.get(thisKey);
  // 取得元を切った後は、その取得元のキャッシュを使わずに引き直す。
  // 利用者が自分で読み込んだ歌詞(取得元を持たない)はそのまま使う。
  if (
    cached && typeof cached === 'object' && !cached.manualLyrics &&
    await isCachedLyricSourceOff(cached.lyricsSource || cached.source)
  ) {
    cached = null;
  }
  if (
    thisKey !== currentKey ||
    requestVideoId !== (currentLyricsVideoId || '') ||
    requestId !== activeLyricsRequestId
  ) return;
  dynamicLines = null;
  dynamicLinesRaw = null;
  duetSubDynamicLines = null;
  _duetExcludedTimes = new Set();
  singerMetadataRequestSequence += 1;
  singerMetadataRequestKey = '';
  currentSingerMetadataKey = '';
  currentLyricsRecordId = null;
  currentSingerMetadata = null;
  currentSingerCanonicalLyrics = '';
  duetSubLyricsRaw = '';
  lyricsCandidates = null;
  selectedCandidateId = null;
  // 曲ごとに必ず倒す。倒し忘れると、次の曲で YTM が取れなかったときも
  // LRCHub の差し替えを止め続けてしまう。
  currentLyricsFromPreferredYtm = false;
  lyricsRequests = null;
  lyricsConfig = null;
  lyricsLockState = null;
  lyricsTranslationMap = {};
  setLyricsMeaningData(null);
  let data = null;
  let dataPriority = 0;
  let dataQuality = 0;
  let noLyricsCached = false;
  let cachedSingerRecordId = null;
  let cachedCanonicalLyrics = '';
  // キャッシュの歌詞が LRCHub のどの経路から来たか(background の sourceLabel)
  let cachedSourceLabel = '';
  if (cached !== null && cached !== undefined) {
    if (cached === NO_LYRICS_SENTINEL) {
      noLyricsCached = true;
    } else if (typeof cached === 'string') {
      // Legacy string entries may be old line-only network caches. Display
      // them immediately, but keep them provisional so fresh DynamicLRC can
      // upgrade them. New manual uploads are stored with manualLyrics=true.
      data = cached;
      dataPriority = 0;
      dataQuality = /\[\d+:\d{2}(?:[.:]\d{1,3})?\]/.test(cached) ? 2 : 1;
      currentLyricsResultPriority = 0;
      currentLyricsQuality = dataQuality;
    } else if (typeof cached === 'object') {
      const cachedVideoId = String(cached.video_id || cached.videoId || '');
      const cacheMatchesVideo = cached.cacheVersion === LYRICS_CACHE_VERSION &&
        cachedVideoId === requestVideoId;
      const cachedSource = String(cached.lyricsSource || cached.source || '').trim().toLowerCase();
      // 「新ソースのみ」は取得元を確かめるためのモード。前に別の取得元で
      // 拾ってキャッシュした歌詞をそのまま出すと、画面に何が出ているのか
      // 分からなくなるので、そのキャッシュは使わずに引き直す。
      if (cacheMatchesVideo) {
        const cachedSelection = selectLyricsPayload(cached);
        data = cachedSelection.text;
        cachedSingerRecordId = String(cached.record_id || cached.recordId || '').trim() || null;
        cachedSourceLabel = String(cached.sourceLabel || '');
        cachedCanonicalLyrics = cachedSelection.lyrics || data || '';
        dynamicLines = cachedSelection.dynamicLines;
        if (typeof cached.subLyrics === 'string') duetSubLyricsRaw = cached.subLyrics;
        if (cached.noLyrics) noLyricsCached = true;
        if (Array.isArray(cached.candidates)) lyricsCandidates = cached.candidates;
        if (Array.isArray(cached.requests)) lyricsRequests = cached.requests;
        if (cached.config) lyricsConfig = cached.config;
        if (cached.lockState && typeof cached.lockState === 'object') lyricsLockState = cached.lockState;
        if (cached.lrcMap || cached.translations) {
          lyricsTranslationMap = {
            ...normalizeTranslationsToLrcMapLocal(cached.translations),
            ...normalizeTranslationsToLrcMapLocal(cached.lrcMap)
          };
        }
        if (cached.meaningData) setLyricsMeaningData(cached.meaningData);
        // 本人の決定(手動アップロード / 候補の選択)は最優先で据え置く。
        // 裏で走った取得に上書きさせない。
        const cachedIsUserChoice = !!(cached.manualLyrics || cached.manualChoice);
        if (cached.manualChoice && cached.candidateId) {
          // 選択中の印をメニューに戻し、遅れて届く差し替えも止める
          selectedCandidateId = String(cached.candidateId);
        }
        currentLyricsResultPriority = cachedIsUserChoice ? 3 : 2;
        dataPriority = currentLyricsResultPriority;
        currentLyricsQuality = cachedSelection.quality;
        dataQuality = cachedSelection.quality;
        updateLyricsSourceState({ ...cached, fallbackUsed: false }, !!data);
      }
    }
  }
  syncLyricsLockState();
  refreshCandidateMenu();
  refreshLockMenu();

  if (data && cachedSingerRecordId) {
    void requestSingerMetadataForLyrics(cachedSingerRecordId, cachedCanonicalLyrics, {
      trackKey: thisKey,
      videoId: requestVideoId,
    });
  }

  let renderedFromCache = false;
  if (
    data &&
    thisKey === currentKey &&
    requestVideoId === (currentLyricsVideoId || '') &&
    requestId === activeLyricsRequestId
  ) {
    applyLyricsText(data).then(() => {
      if (
        thisKey === currentKey &&
        requestVideoId === (currentLyricsVideoId || '') &&
        requestId === activeLyricsRequestId
      ) {
        refreshMeaningUi();
      }
    });
    renderedFromCache = true;
  }
  let needsRendering = !renderedFromCache;

  // Always fetch fresh data from URL as requested
  let gotLyrics = false;
  try {
    const artist = meta.artist;
    const youtube_url = getCurrentVideoUrl();
    const video_id = requestVideoId;
    const translate_to = getRequestedLrchubTranslateLangs();
    // 動画モードでは音源の曲名・長さ・videoId で引く(resolveMovieLookupSong)。
    // video_id は「どの動画への答えか」の照合に使うので MV のまま送り、
    // 引く先だけ lookup_video_id で渡す。
    const movieSong = await resolveMovieLookupSong(video_id);
    if (movieSong) YTMLog.log(`[CS] 動画モード: 歌詞は音源 ${movieSong.videoId} で引く`);
    const lookupTitle = (movieSong && movieSong.title) || meta.title;
    const track = normalizeSearchTrackTitle(lookupTitle, artist);
    // LyricsPlus はアルバム名と尺で候補を絞る。無ければ無いで動くが、
    // 同名異曲・別リリースを掴む確率がはっきり下がる。
    const videoEl = document.querySelector('video');
    const durationSec = (movieSong && movieSong.durationSec)
      || ((videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0)
        ? Math.round(videoEl.duration)
        : null);
    const payload = {
      track,
      artist,
      album: (meta && meta.album) || '',
      duration_sec: durationSec,
      youtube_url,
      video_id,
      use_lrclib: config.useLrcLibFallback,
      lyric_source_mode: config.lyricSourceMode || 'ytm',
      request_id: requestId,
      track_key: thisKey,
      // LRCHub の曲名検索が 0 件だった時の引き直し用(readShownArtistVariant)。
      // 引き直しで採るのは曲名が title_full と同じレコードだけ
      artist_alt: readShownArtistVariant(meta),
      title_full: lookupTitle || '',
    };
    if (movieSong) payload.lookup_video_id = movieSong.videoId;
    if (translate_to.length) payload.translate_to = translate_to;

    // YouTube Music の行同期歌詞は content script からしか取れない
    // (Service Worker の fetch は Origin: chrome-extension:// が付いて YouTube に 403 で弾かれる)。
    // background への問い合わせと並列に走らせるので、待ち時間は増えない。
    // 優先設定に関わらず必ず走らせる。LRCHub優先でも、乗り換え先として
    // 候補メニューに並べるため。

    // 取ってきた歌詞を候補メニューへ流す。
    // background が組む候補一覧には YTM が入らない(あちらからは叩けない)ので、
    // ここで合流させないとメニューに出てこない。表示に使うかどうかとは
    // 無関係に、届いたら必ず並べる。
    // LRCHub優先では下の分岐(preferYtm || !backgroundHasLyrics)が結果を
    // 見てすらいなかったため、取得だけして捨てている状態になっていた。
    const noteYtmCandidate = (res) => {
      if (!res) return;
      // 待っている間に曲が変わっていたら、それは別の曲の歌詞
      if (thisKey !== currentKey || video_id !== (currentLyricsVideoId || '')) return;
      if (offerYtmCandidate(res)) refreshCandidateMenu();
    };

    // 設定でオフにされていたら YTM には聞かない(候補メニューにも出さない)
    const ytmPromise = (window.YTMLyrics && video_id && isLyricSourceOn('ytm'))
      ? window.YTMLyrics.fetch(video_id, {
        // YTM が時刻なしの歌詞しか持っていない曲では、別リリースに同期版が
        // あることがある。その探索は数秒かかるので待たずに先へ進み、
        // 見つかった時だけここで差し替える。
        onUpgrade: (upgraded) => {
          if (!upgraded || !upgraded.hasSynced) return;
          // 候補の方も同期版に差し替える(時刻なしのまま残さない)
          noteYtmCandidate(upgraded);
          sendYtmReference(upgraded);
          void applyLateLyricsUpgrade({
            success: true,
            lyricsSource: 'ytm',
            lyrics: upgraded.lyrics,
            animated_lyrics: null,
            dynamicLines: null,
            track_key: thisKey,
            request_id: requestId,
            video_id,
          });
        },
      })
      : Promise.resolve(null);

    // YouTube Music の歌詞は、他の取得元の歌詞が合っているかを確かめる票として
    // background へ渡す(background からは YouTube Music を叩けない)。
    const sendYtmReference = (ytmRes) => {
      if (!ytmRes || typeof ytmRes.lyrics !== 'string' || !ytmRes.lyrics.trim()) return;
      if (requestId !== activeLyricsRequestId) return;
      void safeRuntimeSendMessage({
        type: 'LYRICS_REFERENCE',
        payload: { request_id: requestId, lyrics: ytmRes.lyrics },
      });
    };
    void ytmPromise.then(sendYtmReference).catch(() => { });

    void ytmPromise
      .then(noteYtmCandidate)
      .catch(() => { /* 候補に出せないだけ。表示には影響しない */ });

    // 上限で打ち切った YTM を、届いた時に差し替える予約。
    // 曲が変わっていたら捨てる。差し替えてよいかの判断は
    // applyLateLyricsUpgrade 側(品質・手動選択・同一曲の確認)に任せる。
    const scheduleYtmLateUpgrade = () => {
      const lateKey = thisKey;
      const lateVideoId = video_id;
      const lateRequestId = requestId;
      void ytmPromise.then(late => {
        if (!late || !late.hasSynced || !late.lyrics) return;
        if (lateKey !== currentKey || lateVideoId !== (currentLyricsVideoId || '')) return;
        if (lateRequestId !== activeLyricsRequestId) return;
        YTMLog.log('[CS] YouTube Music が遅れて届いたので差し替えを試みる');
        return applyLateLyricsUpgrade({
          success: true,
          lyricsSource: 'ytm',
          lyrics: late.lyrics,
          animated_lyrics: null,
          dynamicLines: null,
          track_key: lateKey,
          request_id: lateRequestId,
          video_id: lateVideoId,
        });
      }).catch(() => { /* 遅れて届く方の失敗は表示に影響しない */ });
    };

    const backgroundPromise = safeRuntimeSendMessage({ type: 'GET_LYRICS', payload });

    // YTM優先で YTM が同期歌詞を持っているなら、LRCHub の完了を待つ意味はない。
    // 以前はここで background を無条件に await していたため、YTM が 250ms で
    // 返っていても LRCHub のレース(1.5秒)とフォールバック(各8秒)が終わるまで
    // 描画されず、並列に走らせた意味が消えていた。
    const preferYtmSource = (config.lyricSourceMode || 'ytm') === 'ytm';

    // YTM の待ちには上限を置く。
    //
    // YTM の取得は next → browse の2段直列で、各段のタイムアウトが 5 秒。
    // 別リリースや counterpart の探索に入るとさらに伸びる。ここで完了を
    // 待ち切ると、LRCHub が 300ms で答えていても最大10秒ほど白紙になる。
    // 並列に走らせている意味がこの一行で消えていた。
    //
    // 間に合わなければ先に他の歌詞を出し、YTM は届いた時に差し替える。
    // 差し替えの可否は applyLateLyricsUpgrade の判断に委ねる。あちらは
    // 品質が下がる差し替えを拒むので、同期の粗い YTM が単語同期を
    // 上書きすることはない。「YTM優先」が完全に通るのは YTM が間に合った
    // 回だけになるが、10秒の白紙を避ける方を採る。
    const ytmWaitMarker = {};
    const ytmRaced = preferYtmSource
      ? await Promise.race([
        ytmPromise,
        new Promise(resolve => setTimeout(() => resolve(ytmWaitMarker), YTM_EARLY_WAIT_MS)),
      ])
      : null;
    const ytmWaitTimedOut = ytmRaced === ytmWaitMarker;
    const ytmEarly = ytmWaitTimedOut ? null : ytmRaced;
    const skipWaitingBackground = !!(ytmEarly && ytmEarly.hasSynced);

    let res = skipWaitingBackground
      // 既に返っていればメタデータ(候補・翻訳・解説)ごと使えるので、短時間だけ待つ
      ? await Promise.race([
        backgroundPromise,
        new Promise(resolve => setTimeout(() => resolve(null), 400)),
      ])
      : await backgroundPromise;

    if (skipWaitingBackground && res === null) {
      // 間に合わなかった分のメタデータを反映する。通常歌詞は YTM を
      // 維持するが、アニメーション表示が有効な srv3 は後着でも差し替える。
      const metaKey = thisKey, metaVideoId = video_id, metaRequestId = requestId;
      backgroundPromise.then(late => {
        if (!late || !late.success) return;
        if (metaKey !== currentKey || metaVideoId !== (currentLyricsVideoId || '')) return;
        if (metaRequestId !== activeLyricsRequestId) return;
        if (Array.isArray(late.requests)) lyricsRequests = late.requests;
        if (late.config) lyricsConfig = late.config;
        if (Array.isArray(late.candidates) && late.candidates.length) lyricsCandidates = late.candidates;
        lyricsTranslationMap = {
          ...(lyricsTranslationMap || {}),
          ...normalizeTranslationsToLrcMapLocal(late.translations),
          ...normalizeTranslationsToLrcMapLocal(late.lrcMap),
        };
        const lateMeaning = normalizeMeaningPayloadLocal(late);
        if (lateMeaning) setLyricsMeaningData(lateMeaning);
        syncLyricsLockState();
        refreshCandidateMenu();
        refreshLockMenu();
        refreshMeaningUi();
        if (selectLyricsPayload(late).mode === 'animated') {
          void applyLateLyricsUpgrade(late).catch((error) => {
            console.warn('[YTM] Failed to apply late srv3 lyrics:', error);
          });
        }
      }).catch(() => { });
    }
    if (
      thisKey !== currentKey ||
      video_id !== (currentLyricsVideoId || '') ||
      requestId !== activeLyricsRequestId
    ) return;
    YTMLog.log('[CS] GET_LYRICS response:', res);

    // 歌詞ソースの優先設定は 'ytm' / 'lrchub' の2択。どちらも他方へフォールバックする。
    //   YTM優先   … YTM に同期歌詞があればそれ。無ければ LRCHub / LrcLib
    //   LRCHub優先 … LRCHub / LrcLib が歌詞を返せばそれ。無ければ YTM
    // 品質スコアによる自動判定はしない。設定した側が確実に優先される方が予測しやすい。
    try {
      const preferYtm = preferYtmSource;
      const backgroundSelection = selectLyricsPayload(res);
      const backgroundHasLyrics = !!res?.success && !!backgroundSelection.text.trim();
      const backgroundHasSrv3 = backgroundHasLyrics && backgroundSelection.mode === 'animated';

      // LRCHub優先で、しかも LRCHub 側が既に歌詞を返しているなら YTM の結果は使わない。
      // ここで待つと、表示が YTM の完了まで丸ごと遅れてしまう
      // (カタログ解決が走る曲では1秒以上かかる)。走らせたままにして待たない。
      if (preferYtm || !backgroundHasLyrics) {
        // 上限で打ち切った回にここで待ち直すと、上の上限が無意味になる。
        // 他に歌詞があるならそれを出して、YTM は届いた時に差し替える。
        // 逆にどこからも歌詞が来ていないなら、YTM だけが頼りなので待つ。
        if (ytmWaitTimedOut && backgroundHasLyrics) {
          scheduleYtmLateUpgrade();
        } else {
          const ytmRes = ytmEarly || await ytmPromise;
          const stillCurrent =
            thisKey === currentKey &&
            video_id === (currentLyricsVideoId || '') &&
            requestId === activeLyricsRequestId;

          // YTM が同期歌詞を持たない曲でも、歌詞テキスト自体は持っていることがある
          // (実測: 曲の約2割は cueRange を持たない = モバイルでも時刻なしで表示される)。
          // 以前はこれを丸ごと捨てていたため、「モバイルには歌詞があるのに
          // 拡張では何も出ない」曲が生まれていた。他にどこからも歌詞が来ない
          // ときの最後の受け皿として採用する。
          const ytmHasPlain = !!(ytmRes && !ytmRes.hasSynced &&
            typeof ytmRes.lyrics === 'string' && ytmRes.lyrics.trim());
          const useYtm = !!ytmRes && stillCurrent && !backgroundHasSrv3 &&
            (ytmRes.hasSynced || (ytmHasPlain && !backgroundHasLyrics));

          if (useYtm) {
            const synced = !!ytmRes.hasSynced;
            YTMLog.log(`[CS] YouTube Music を採用 (${synced ? '同期' : '時刻なし'} / ${preferYtm ? 'YTM優先' : 'LRCHubが空のためフォールバック'})`);
            // フォールバックで採った場合は、あとから LRCHub が届いたら差し替えてよい。
            // 時刻なしの歌詞は同期歌詞に劣るので、YTM優先設定でも差し替えを許す。
            currentLyricsFromPreferredYtm = preferYtm && synced;
            res = {
              ...res,
              success: true,
              lyrics: ytmRes.lyrics,
              animated_lyrics: null,
              dynamicLines: null,
              lyricsSource: 'ytm',
              fallbackUsed: !preferYtm || !synced,
              // background の突き合わせと経路名は background が出した歌詞のもの。
              // 経路名を残すと、YouTube Music を出しているのに「LRCHub」と表示していた。
              agreement: undefined,
              sourceLabel: undefined,
            };
          }
        }
      }
    } catch (e) {
      console.warn('[CS] YouTube Music の取り込みに失敗:', e);
    }

    const selectedResponse = selectLyricsPayload(res);
    const responseLyrics = selectedResponse.lyrics;
    const responseAnimatedLyrics = selectedResponse.animatedLyrics;
    const preferredLyrics = selectedResponse.text;
    const hasResponseLyrics = !!res?.success && !!preferredLyrics.trim();
    const responsePriority = hasResponseLyrics ? (res?.fallbackUsed ? 1 : 2) : 0;
    // 先に出したキャッシュが外れ(他の取得元が裏付けた歌詞と中身が違う)なら、
    // 品質が下がっても替える。本人が選んだ歌詞(優先度 3)は替えない。
    // LRCHub の曲名検索で出してキャッシュした歌詞は推測なので、動画 ID で
    // 引けた歌詞(手動登録はここに来る)と中身が違えば、品質が下がっても替える
    // (background の pushHubUpgrade と同じ考え。星野源のライブ映像で、検索が
    // 当てた別の曲の歌詞がキャッシュに残り続けていた)
    const responseFromVideo = res?.lyricsSource === 'lrchub' &&
      (res?.sourceLabel === 'LRCHub' || res?.sourceLabel === 'LRCHub retry');
    const cachedFromTitleSearch = cachedSourceLabel === 'LRCHub search';
    const responseReplacesWrong = hasResponseLyrics &&
      (res?.agreement === 'confirmed' || (responseFromVideo && cachedFromTitleSearch)) &&
      currentLyricsResultPriority < 3 && selectedResponse.mode !== 'animated' &&
      typeof data === 'string' && data.trim() &&
      lyricsAgreement(data, responseLyrics || preferredLyrics) < LYRICS_AGREE_MIN;
    if (responseReplacesWrong) {
      YTMLog.log('[CS] キャッシュの歌詞は他の取得元と合わないので替える');
      currentLyricsResultPriority = responsePriority;
      currentLyricsQuality = selectedResponse.quality;
    }
    // A late LRCHub event can overtake the original callback. Reject the
    // lower-priority fallback/failure before it mutates any LRCHub state.
    if (responsePriority < currentLyricsResultPriority) return;
    if (
      responsePriority === currentLyricsResultPriority &&
      responsePriority === 2 &&
      selectedResponse.quality < currentLyricsQuality
    ) return;

    // LRCHub 以外の軽量ソース(YTM / LrcLib)が勝ったレスポンスには
    // requests / config / candidates が入っていない。無条件に代入すると
    // それらを null で潰したうえで下のキャッシュ書き込みが永続化してしまう。
    if (Array.isArray(res?.requests)) lyricsRequests = res.requests;
    if (res?.config) lyricsConfig = res.config;
    syncLyricsLockState();
    if (Array.isArray(res?.candidates) && res.candidates.length) lyricsCandidates = res.candidates;
    lyricsTranslationMap = {
      ...(lyricsTranslationMap || {}),
      ...normalizeTranslationsToLrcMapLocal(res?.translations),
      ...normalizeTranslationsToLrcMapLocal(res?.lrcMap)
    };
    refreshCandidateMenu();
    refreshLockMenu();
    const nextMeaningData = normalizeMeaningPayloadLocal(res);
    if (nextMeaningData) setLyricsMeaningData(nextMeaningData);
    if (typeof res?.subLyrics === 'string' && res.subLyrics.trim()) duetSubLyricsRaw = res.subLyrics;

    if (hasResponseLyrics) {
      // 比べるのは生データ同士。描画用に正規化した dynamicLines と比べると
      // 中身が同じでも必ず不一致になり、毎回描き直しになる。
      const shownDynamicLines = dynamicLinesRaw !== null ? dynamicLinesRaw : dynamicLines;
      const isDifferent = (preferredLyrics !== data) ||
        (JSON.stringify(selectedResponse.dynamicLines) !== JSON.stringify(shownDynamicLines)) ||
        (res.subLyrics && res.subLyrics !== duetSubLyricsRaw);

      currentLyricsResultPriority = responsePriority;
      currentLyricsQuality = selectedResponse.quality;
      dataPriority = responsePriority;
      dataQuality = selectedResponse.quality;
      data = preferredLyrics;
      gotLyrics = true;
      dynamicLines = selectedResponse.dynamicLines;
      void requestSingerMetadataForLyrics(
        res.record_id,
        responseLyrics || preferredLyrics,
        { trackKey: thisKey, videoId: video_id }
      );
      updateLyricsSourceState(res, true);
      if (
        thisKey === currentKey &&
        video_id === (currentLyricsVideoId || '') &&
        requestId === activeLyricsRequestId &&
        responsePriority === currentLyricsResultPriority &&
        selectedResponse.quality === currentLyricsQuality
      ) {
        clearLyricsLateRetry(thisKey);
        const cacheRecord = {
          cacheVersion: LYRICS_CACHE_VERSION,
          video_id,
          record_id: res.record_id || null,
          lyrics: responseLyrics || data,
          animated_lyrics: responseAnimatedLyrics || null,
          dynamicLines: dynamicLines || null,
          noLyrics: false,
          subLyrics: (typeof duetSubLyricsRaw === 'string' ? duetSubLyricsRaw : ''),
          meaningData: lyricsMeaning || null,
          candidates: LyricsCache.stripCandidateLyrics(lyricsCandidates) || null,
          lrcMap: lyricsTranslationMap || null,
          requests: lyricsRequests || null,
          config: lyricsConfig || null,
          lockState: lyricsLockState || null,
          lyricsSource: res.lyricsSource || null,
          sourceLabel: res.sourceLabel || null,
          fetchedAt: Date.now(),
          fallbackUsed: !!res.fallbackUsed,
          lyricsQuality: selectedResponse.quality,
          offset_ms: Number.isFinite(Number(res.offset_ms)) ? Number(res.offset_ms) : 0,
        };
        const isResponseCurrent = () => (
          thisKey === currentKey &&
          video_id === (currentLyricsVideoId || '') &&
          requestId === activeLyricsRequestId &&
          responsePriority === currentLyricsResultPriority &&
          selectedResponse.quality === currentLyricsQuality
        );
        const wroteCache = await enqueueLyricsCacheWrite(
          thisKey,
          cacheRecord,
          isResponseCurrent
        );
        if (wroteCache && isResponseCurrent() && (isDifferent || !renderedFromCache)) {
          needsRendering = true;
        }
      }
    } else {

    }
  } catch (e) {
    console.error('GET_LYRICS failed', e);
  }
  if (
    !gotLyrics &&
    !data &&
    thisKey === currentKey &&
    requestVideoId === (currentLyricsVideoId || '') &&
    requestId === activeLyricsRequestId &&
    currentLyricsResultPriority === 0 &&
    currentLyricsQuality === 0
  ) {
    const noLyricsIsCurrent = () => (
      thisKey === currentKey &&
      requestVideoId === (currentLyricsVideoId || '') &&
      requestId === activeLyricsRequestId &&
      currentLyricsResultPriority === 0 &&
      currentLyricsQuality === 0
    );
    try {
      const wroteNoLyrics = await enqueueLyricsCacheWrite(
        thisKey,
        NO_LYRICS_SENTINEL,
        noLyricsIsCurrent
      );
      if (!wroteNoLyrics) return;
    } catch (error) {
      console.warn('[YTM] Failed to cache the no-lyrics result:', error);
    }
    if (!noLyricsIsCurrent()) return;
    noLyricsCached = true;
    scheduleLyricsLateRetry(meta, thisKey, options.lateRetryAttempt || 0);
  }
  if (
    thisKey !== currentKey ||
    requestVideoId !== (currentLyricsVideoId || '') ||
    requestId !== activeLyricsRequestId
  ) return;
  if (!data && currentLyricsResultPriority === 0 && currentLyricsQuality === 0) {
    renderLyrics([]);
    refreshCandidateMenu();
    refreshLockMenu();
    refreshMeaningUi();
    return;
  }
  if (dataPriority !== currentLyricsResultPriority || dataQuality !== currentLyricsQuality) return;
  if (needsRendering) {
    await applyLyricsText(data);
  }
}

// Segmenter の生成は重いため1回だけ作って使い回す。
// 無防備に new すると、Intl.Segmenter が無い環境ではこのファイル全体の
// 読み込みが落ちて拡張が起動しない。lyricUnitSegmenter と同じ守り方にする。
const _jaWordSegmenter = (() => {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return new Intl.Segmenter('ja', { granularity: 'word' });
    }
  } catch (e) { /* 使えなければ折り返しのまとめを諦める */ }
  return null;
})();

// ── 行の折り返し位置 ────────────────────────────────────────
// 「を」「の」で行が始まったり、拗音が行頭に落ちたりしないように、
// くっつけて良い所を判定する。同期ありの行と無しの行で判定が違うと
// 同じ曲の中で折り返し方が変わってしまうので、両方ここを通す。
const LYRIC_PHRASE_RULES = {
  suffixes: new Set([
    'て', 'に', 'を', 'は', 'が', 'の', 'へ', 'と', 'も', 'で', 'や', 'し', 'から', 'より', 'だけ', 'まで', 'こそ', 'さえ', 'でも', 'など', 'なら', 'くらい', 'ぐらい', 'ばかり',
    'ね', 'よ', 'な', 'さ', 'わ', 'ぞ', 'ぜ', 'かしら', 'かな', 'かも', 'だし', 'もん', 'もの',
    'って', 'けど', 'けれど', 'のに', 'ので', 'から', 'ため', 'よう', 'こと', 'もの', 'わけ', 'ほう', 'ところ', 'とおり',
    'た', 'だ', 'ない', 'たい', 'ます', 'ません', 'う', 'よう', 'れる', 'られる', 'せる', 'させる', 'ん', 'ず',
    'てた', 'てる', 'ちゃう', 'じゃん', 'なきゃ', 'なくちゃ', 'く', 'き', 'けれ', 'れば',
    'った', 'たら', 'たり',
    'か', 'かい', 'だい', 'いる', 'ある', 'くる', 'いく', 'みる', 'おく', 'しまう', 'ほしい', 'あげる', 'くれる', 'もらう',
    '、', '。', '，', '．', '…', '・', '！', '？', '!', '?', '~', '～', '“', '”', '‘', '’', ')', ']', '}', '」', '』', '】', '）'
  ]),
  isEnglish: (w) => /^[a-zA-Z0-9'\-\.,!?:;]+$/.test(w),
  isSpace: (w) => /^\s+$/.test(w),
  isOpenParen: (w) => /^[\(\[\{「『（【]$/.test(w),
  hasKanji: (w) => /[一-鿿]/.test(w),
  isHiragana: (w) => /^[぀-ゟー]+$/.test(w),
  isKatakana: (w) => /^[゠-ヿー]+$/.test(w),
  startsWithSmallKana: (w) => /^[ぁぃぅぇぉっゃゅょゎゕゖ]/.test(w),
};

const shouldMergeLyricSegments = (word, nextWord) => {
  if (!nextWord) return false;
  const r = LYRIC_PHRASE_RULES;
  // 開き括弧は次の語に付く。閉じ括弧は suffixes にあって前の語に付くが、
  // 開き括弧には相棒が無く、単独のまとまりとして行末に取り残されていた。
  // 「君を知りたい(」で折り返して次の行が「君を知りたい)」になる。
  if (r.isOpenParen(word)) return true;
  if (r.startsWithSmallKana(nextWord)) return true;
  if (r.suffixes.has(nextWord)) return !r.isOpenParen(nextWord);
  if (r.hasKanji(word) && r.isHiragana(nextWord)) return true;
  if (r.isKatakana(word) && r.isKatakana(nextWord)) return true;
  if ((r.isEnglish(word) || r.isSpace(word)) &&
    (r.isEnglish(nextWord) || r.isSpace(nextWord))) return true;
  return false;
};

// ── 日本語の行は BudouX で文節に切る ─────────────────────────
// 上の規則は語区切り(Intl.Segmenter)を繋ぎ直す方式で、語区切りが
// 細かすぎる所を追いかけきれない。「何 / 度でも」「笑って / み / せた」
// 「溶けて / しま / い / そう」のように、語の途中に切れ目が残っていた。
// BudouX は文節の切れ目を直接当てにいくので、語の途中ではほぼ切らない。
//
// 使うのは仮名を含む行だけ。英語・中国語・韓国語の行は上の規則のまま
// (ja モデルは日本語向けで、それ以外の行を良くする根拠が無い)。
const LYRIC_KANA_RE = /[ぁ-ゖァ-ヺ]/;
// 英字の塊。塊の中では切らない(従来と同じ)
const LYRIC_LATIN_RE = /[A-Za-z0-9'’\-.,!?:;&]/;
const LYRIC_SPACE_RE = /\s/;
// 行頭に来てはいけない字。語ごとに inline-block なので CSS の
// line-break: strict は効かず、ここで止めるしかない。
const LYRIC_LOOSE_HEAD_RE = /[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶーｰ゛゜々〆ゝゞヽヾ、。，．！？!?,.;:…‥・)）\]｝}」』】〕》〉”’〜～]/;
const LYRIC_OPEN_BRACKET_RE = /[(（[［{｛「『【〔《〈“‘]/;
// これより長い塊は、行幅を超えた時に語の途中で割れる。
// BudouX の次点の位置で割っておく。
const LYRIC_MAX_PHRASE = 10;
// 「〜て」の後に続く補助動詞の書き出し
const LYRIC_TE_AUX_RE = /^(?:ゆ[かきくけこっ]|い[かきくけこったてなるれ]|く[るれ]|き[たて]|しま[うっいわえお]|ちゃ|じゃ|み[たてるせ]|お[いくけ]|ほし|あげ|くれ|もら)/;

// 切れ目の文字位置を昇順で返す。BudouX が使えない行は null。
const budouxPhraseBoundaries = (text) => {
  if (typeof BudouxJa === 'undefined' || !text || !LYRIC_KANA_RE.test(text)) return null;
  let scores;
  try {
    scores = BudouxJa.scores(text);
  } catch (e) {
    return null;
  }

  const kindAt = (i) => {
    const c = text[i];
    if (LYRIC_SPACE_RE.test(c)) return 'space';
    if (LYRIC_LATIN_RE.test(c)) return 'latin';
    return 'cjk';
  };
  // 規則上どうしても切れない所
  const forbidden = (i) => LYRIC_LOOSE_HEAD_RE.test(text[i])
    || LYRIC_OPEN_BRACKET_RE.test(text[i - 1])
    || kindAt(i) === 'space';

  // BudouX は辞書を持たないので、「笑 / 顔」「唯一無 / 二」「生まれ / 変わり」の
  // ように語の途中で切ることがある。語区切り(辞書あり)で1語とされた中で、
  // 切れ目の左右どちらにも漢字かカタカナがある所は切らない。
  // 仮名の側は語区切りを信じない。仮名が続く所では「いままでいる」の
  // ような辞書に無い塊を作るし、「もう一度」は「もう / 一度」で切って良い。
  // 「はいはい」「ないないない」のように同じ語が並ぶ所だけは、仮名でも
  // 語区切りを信じる(BudouX は「はいは / い」と割る)。
  const KANJI_KATA_RE = /[一-鿿々〆゠-ヿ]/;
  const insideWord = new Set();
  if (_jaWordSegmenter) {
    try {
      const segs = Array.from(_jaWordSegmenter.segment(text));
      segs.forEach((seg, k) => {
        const word = seg.segment;
        const repeated = segs[k - 1]?.segment === word || segs[k + 1]?.segment === word;
        for (let j = 1; j < word.length; j++) {
          if (repeated || (KANJI_KATA_RE.test(word.slice(0, j)) && KANJI_KATA_RE.test(word.slice(j)))) {
            insideWord.add(seg.index + j);
          }
        }
      });
    } catch (e) { /* 語区切りが使えなければ BudouX の切れ目をそのまま使う */ }
  }
  const isSegmenterEdge = (i) => !insideWord.has(i);

  const cuts = new Set();
  for (let i = 1; i < text.length; i++) {
    if (forbidden(i)) continue;
    const before = kindAt(i - 1);
    const after = kindAt(i);
    if (before === 'space') {
      // 空白の手前が英字で、後ろも英字なら英字の塊の中。それ以外は切る
      let j = i - 1;
      while (j > 0 && kindAt(j) === 'space') j--;
      if (kindAt(j) === 'latin' && after === 'latin') continue;
      cuts.add(i);
    } else if (before === 'latin') {
      // 「face で」の「で」のように、英字の直後の仮名は前に付ける
      continue;
    } else if (after === 'latin' || LYRIC_OPEN_BRACKET_RE.test(text[i])) {
      cuts.add(i);
    } else if (scores[i] > 0 && isSegmenterEdge(i)) {
      cuts.add(i);
    }
  }

  // 「answer は」「face to face で」の助詞は英字の側に付ける
  for (const cut of [...cuts]) {
    let j = cut - 1;
    if (kindAt(j) !== 'space') continue;
    while (j > 0 && kindAt(j) === 'space') j--;
    if (kindAt(j) !== 'latin') continue;
    let next = cut + 1;
    while (next < text.length && !cuts.has(next)) next++;
    if (LYRIC_PHRASE_RULES.suffixes.has(text.slice(cut, next))) cuts.delete(cut);
  }

  // 「〜て」「〜で」の後の補助動詞(ゆく・いく・いた・しまう・みせる…)は
  // 前に付ける。BudouX は て の直後で切りがちで、「落ちて / ゆく前に」
  // 「溶けて / ゆくように」と一続きの動きが二行に割れていた。
  for (const cut of [...cuts]) {
    if (/[てで]/.test(text[cut - 1]) && LYRIC_TE_AUX_RE.test(text.slice(cut, cut + 3))) {
      cuts.delete(cut);
    }
  }

  // 1字だけの塊は、日本語ではほぼ誤り(「片 / 思いの」「一 / 人きりの」)。
  // 次の塊が日本語で続くなら繋げる。
  {
    const sorted = [0, ...[...cuts].sort((a, b) => a - b)];
    for (let k = 1; k < sorted.length; k++) {
      const cut = sorted[k];
      const head = sorted[k - 1];
      if (cut - head !== 1 || kindAt(head) !== 'cjk') continue;
      if (kindAt(cut) !== 'cjk' || LYRIC_OPEN_BRACKET_RE.test(text[cut])) continue;
      cuts.delete(cut);
    }
    // 行末の1字は前へ(「君の / 姿」「した / 時」)
    const last = Math.max(0, ...cuts);
    if (last && text.length - last === 1 && kindAt(last) === 'cjk' && kindAt(last - 1) === 'cjk'
      && !LYRIC_OPEN_BRACKET_RE.test(text[last - 1])) {
      cuts.delete(last);
    }
  }

  // 複合動詞(「差し / 伸べた」「振り / 払う」)。漢字+い段の2字の塊に
  // 漢字が続く所は、BudouX がよく切るが、一語なので繋げる。
  {
    const sorted = [0, ...[...cuts].sort((a, b) => a - b)];
    for (let k = 1; k < sorted.length; k++) {
      const cut = sorted[k];
      if (cut - sorted[k - 1] !== 2) continue;
      if (/^[一-鿿][いきしちにひみりぎじびぴ]$/.test(text.slice(cut - 2, cut)) && /[一-鿿]/.test(text[cut])) {
        cuts.delete(cut);
      }
    }
  }

  // 長すぎる塊を、両端2字より内側で割る。BudouX が切りたかった所か
  // 語区切りでも切れ目になる所を優先し、その中で素点がいちばん高い所を
  // 選ぶ。素点だけで選ぶと「ちょっと / だけ笑ってみせた」のように語の
  // まとまりを外し、語区切りだけで選ぶと「やり / 直せたら」を拾う。
  let wordEdges = null;
  const isWordEdge = (j) => {
    if (!wordEdges) {
      wordEdges = new Set();
      if (_jaWordSegmenter) {
        const segments = Array.from(_jaWordSegmenter.segment(text), s => s.segment);
        let offset = 0;
        for (let k = 0; k < segments.length - 1; k++) {
          offset += segments[k].length;
          if (!shouldMergeLyricSegments(segments[k], segments[k + 1])) wordEdges.add(offset);
        }
      }
    }
    return wordEdges.has(j);
  };
  for (;;) {
    const edges = [0, ...[...cuts].sort((a, b) => a - b), text.length];
    let split = null;
    for (let k = 0; k < edges.length - 1 && split === null; k++) {
      const from = edges[k];
      const to = edges[k + 1];
      if (to - from <= LYRIC_MAX_PHRASE) continue;
      let best = null;
      let bestPreferred = null;
      for (let j = from + 2; j <= to - 2; j++) {
        if (forbidden(j) || kindAt(j - 1) !== 'cjk' || kindAt(j) !== 'cjk') continue;
        if (best === null || scores[j] > scores[best]) best = j;
        if (((scores[j] > 0 && isSegmenterEdge(j)) || isWordEdge(j)) && (bestPreferred === null || scores[j] > scores[bestPreferred])) {
          bestPreferred = j;
        }
      }
      split = bestPreferred ?? best;
    }
    if (split === null) break;
    cuts.add(split);
  }

  return [...cuts].sort((a, b) => a - b);
};

// 同期ありの行は語ごとの span に分かれている。そのままだと語と語の
// どこでも折り返せてしまい、「を」だけが行頭に落ちる。
// 同じ規則でまとめて、まとまりの中では折り返させない。
const groupLyricUnitsIntoPhrases = (units) => {
  // 日本語の行は、行ぜんたいを BudouX で切った切れ目に沿ってまとめる。
  // 同期なしの行(optimizeLineBreaks)と同じ切れ目になる。
  // 語の途中に来た切れ目は使わない(語の span は割れない)。
  const cuts = budouxPhraseBoundaries(units.map(u => u.text).join(''));
  if (cuts) {
    const cutSet = new Set(cuts);
    const grouped = [];
    let offset = 0;
    for (const unit of units) {
      if (!grouped.length || cutSet.has(offset)) grouped.push([]);
      grouped[grouped.length - 1].push(unit);
      offset += unit.text.length;
    }
    return grouped;
  }

  const phrases = [];
  let current = null;

  for (let i = 0; i < units.length; i++) {
    if (!current) {
      current = [];
      phrases.push(current);
    }
    current.push(units[i]);

    const next = units[i + 1];
    if (!next) break;
    if (shouldMergeLyricSegments(units[i].text, next.text)) continue;
    current = null;
  }

  return phrases;
};

const optimizeLineBreaks = (text) => {
  if (!text) return '';

  const cuts = budouxPhraseBoundaries(text);
  if (cuts) {
    let html = '';
    let from = 0;
    for (const to of [...cuts, text.length]) {
      const buffer = text.slice(from, to);
      html += `<span class="lyric-phrase">${escapeHtml(buffer)}</span>`;
      from = to;
    }
    return html;
  }

  // 語区切りが使えない環境では、まとめずに1行を1つの span にする。
  // 折り返しの見た目は落ちるが、歌詞は出る。
  if (!_jaWordSegmenter) return `<span class="lyric-phrase">${escapeHtml(text)}</span>`;

  const segments = Array.from(_jaWordSegmenter.segment(text));

  let html = '';
  let buffer = '';

  for (let i = 0; i < segments.length; i++) {
    const word = segments[i].segment;
    const next = segments[i + 1];

    buffer += word;

    if (!next) {
      html += `<span class="lyric-phrase">${escapeHtml(buffer)}</span>`;
      break;
    }

    if (shouldMergeLyricSegments(word, next.segment)) continue;

    html += `<span class="lyric-phrase">${escapeHtml(buffer)}</span>`;
    buffer = '';
  }

  return html;
};
function renderLyrics(data) {
  if (!ui.lyrics) return;
  _lyricCompletionData = null;
  document.body.classList.remove('ytm-animated-caption-mode');
  ui.lyrics.classList.remove('ytm-user-browsing-lyrics');
  animatedCaptionFrameKey = '';
  // 再描画によるscrollイベントをユーザースクロール扱いにしない
  suppressUserScrollDetection(500);
  ui.lyrics.innerHTML = '';
  resetLyricScrollState(ui.lyrics);
  // 再描画後は前回のハイライト/スクロール状態が無効になるためリセットし、
  // 次回の自動スクロールは現在の再生位置へ「即時」ジャンプさせる
  // （曲の途中で歌詞が再描画された際、0秒位置のまま止まる問題の修正）
  ui.lyrics._lastScrolledIndex = -1;
  ui.lyrics._instantNextScroll = true;
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    resetLyricRowMotion(PipManager.pipLyricsContainer);
    PipManager.pipLyricsContainer._lastScrolledIndex = -1;
    PipManager.pipLyricsContainer._instantNextScroll = true;
  }
  _previousActiveIndices.clear();
  _hasDynamicRenderRanges = false;
  _activeRowsHaveCharSpans = true;
  const hasData = Array.isArray(data) && data.length > 0;
  document.body.classList.toggle('ytm-no-lyrics', !hasData);
  document.body.classList.toggle('ytm-has-timestamp', hasTimestamp);
  document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);

  const fragment = document.createDocumentFragment();
  const usedMainDynamicIndices = new Set();
  const usedSubDynamicIndices = new Set();

  // Apple Music 風は語ごとの span、従来式は1文字ずつの span。
  // DOM の作りが違うので、設定が変わったら描き直す必要がある
  // (設定保存側で applyLyricsText を呼び直している)。
  // 低負荷モードでは従来式に落とす。毎フレームの塗り替えは
  // そもそも負荷を削りたい人向けではない。
  // 軽量モードでも文字同期を動かす。合成側に載っているので負荷の主因ではない
  // (applyAppleSyncClass の注釈を参照)。軽くするのは光だけ。
  const useWordSync = !!config.appleSyncStyle;

  data.forEach((line, index) => {
    const row = createEl('div', '', 'lyric-line');

    if (line && line.duetSide === 'right') {
      row.classList.add('sub-vocal');
    } else if (line && line.duetSide === 'left') {
      row.classList.add('main-vocal');
    }
    applySingerMetadataToRow(row, line, currentSingerMetadata);

    if (line && typeof line === 'object') {
      line._dynamicRenderStartSec = null;
      line._dynamicRenderEndSec = null;
    }

    if (typeof line.time === 'number') {
      row.dataset.startTime = String(line.time);
    }

    const mainSpan = createEl('span', '', 'lyric-main');

    // dynamic lyrics highlighting
    let dyn = null;

    // サブボーカル(right)にはduetSubDynamicLinesを使用、メインにはdynamicLinesを使用
    if (line && line.duetSide === 'right') {
      // サブボーカル用のdynamic lines（sub.txtがDynamic LRC形式の場合）
      if (duetSubDynamicLines && Array.isArray(duetSubDynamicLines) && duetSubDynamicLines.length) {
        if (typeof line.time === 'number') {
          dyn = findDynamicLineForRender(line, duetSubDynamicLines, usedSubDynamicIndices);
        }
      } else if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
        // sub.txtが通常LRC形式の場合、メインのDynamic LRCからコンテンツマッチで1文字同期データを取得
        // → サブボーカル右側も1文字ハイライトに対応（5秒の許容幅+内容一致で検索）
        if (typeof line.time === 'number') {
          dyn = findDynamicLineByContent(line, dynamicLines);
        }
      }
    } else {
      // メインボーカル用のdynamic lines
      if (dynamicLines && Array.isArray(dynamicLines) && dynamicLines.length) {
        if (typeof line.time === 'number') {
          // 時間で検索
          dyn = findDynamicLineForRender(line, dynamicLines, usedMainDynamicIndices);
        } else {
          // デュエットモード以外のみインデックスフォールバックを使用
          const isDuetMode = document.body.classList.contains('ytm-duet-mode');
          if (!isDuetMode) {
            dyn = dynamicLines[index];
          }
        }
      }
    }

    // 本編の最後の語の塗りに使う終わり(ハモリの終わりではない)
    let mainEndSec = null;
    if (line && typeof line === 'object' && dyn) {
      const dynStartSec = getDynamicLineStartSec(dyn);
      const dynEndSec = getDynamicLineEndSec(dyn);
      mainEndSec = typeof dynEndSec === 'number' ? dynEndSec : null;
      line._dynamicRenderStartSec = typeof dynStartSec === 'number' ? dynStartSec : (
        typeof line.time === 'number' ? line.time : null
      );
      line._dynamicRenderEndSec = mainEndSec;
      // ハモリが本編より先に始まる・後まで続く時は、その間も行を点けておく
      if (dyn.bg && Array.isArray(dyn.bg.chars) && dyn.bg.chars.length) {
        const bgStartSec = getDynamicLineStartSec(dyn.bg);
        const bgEndSec = getDynamicLineEndSec(dyn.bg);
        if (typeof bgStartSec === 'number' && typeof line._dynamicRenderStartSec === 'number') {
          line._dynamicRenderStartSec = Math.min(line._dynamicRenderStartSec, bgStartSec);
        }
        if (typeof bgEndSec === 'number' && typeof line._dynamicRenderEndSec === 'number') {
          line._dynamicRenderEndSec = Math.max(line._dynamicRenderEndSec, bgEndSec);
        }
      }

      if (typeof line._dynamicRenderStartSec === 'number') {
        row.dataset.dynamicStartTime = String(line._dynamicRenderStartSec);
      }
      if (typeof line._dynamicRenderEndSec === 'number') {
        row.dataset.dynamicEndTime = String(line._dynamicRenderEndSec);
      }
      if (typeof line._dynamicRenderStartSec === 'number' && typeof line._dynamicRenderEndSec === 'number') {
        _hasDynamicRenderRanges = true;
      }
    }

    const lineEndSec = mainEndSec;

    if (dyn && Array.isArray(dyn.chars) && dyn.chars.length && useWordSync) {
      // Apple Music 風: 語ごとに span を立てる。語の中の字形はブラウザに
      // そのまま組ませるので、字の間に隙間が出ない。
      const wordSpans = appendLyricWordSpans(mainSpan, dyn.chars, lineEndSec);
      if (wordSpans.length) {
        row._ytmWordSpans = wordSpans;
        row.classList.add('ytm-word-sync');
      } else {
        mainSpan.textContent = '';
        mainSpan.innerHTML = optimizeLineBreaks(line ? line.text : '');
      }
    } else if (dyn && Array.isArray(dyn.chars) && dyn.chars.length) {
      const charSpans = [];
      dyn.chars.forEach((ch, ci) => {
        const chSpan = createEl('span', '', 'lyric-char');
        // Preserve spaces
        const cc = (ch.c === '\t') ? ' ' : ch.c;
        chSpan.textContent = (cc === ' ') ? '\u00A0' : cc;
        chSpan.dataset.charIndex = String(ci);
        if (typeof ch.t === 'number') {
          chSpan.dataset.time = String(ch.t / 1000);
        }
        // \u6BCE\u30D5\u30EC\u30FC\u30E0\u306E dataset \u53C2\u7167 + parseFloat \u3092\u907F\u3051\u308B\u305F\u3081\u6570\u5024\u3092\u30AD\u30E3\u30C3\u30B7\u30E5
        chSpan._ytmTime = (typeof ch.t === 'number') ? (ch.t / 1000) : 0;
        chSpan.classList.add('char-pending');
        mainSpan.appendChild(chSpan);
        charSpans.push(chSpan);
      });
      charSpans.forEach((sp, ci) => {
        const next = charSpans[ci + 1];
        const end = next ? next._ytmTime : lineEndSec;
        sp._ytmEnd = (Number.isFinite(end) && end > sp._ytmTime)
          ? end
          : sp._ytmTime + CHAR_DEFAULT_SPAN_SEC;
      });
      row._ytmCharSpans = charSpans;
    } else {
      const rawText = line ? line.text : '';
      mainSpan.innerHTML = optimizeLineBreaks(rawText);
    }
    if (typeof KoreanRuby !== 'undefined') KoreanRuby.decorate(mainSpan);
    row.appendChild(mainSpan);

    const bgEl = dyn ? buildLyricBackgroundRow(dyn.bg, useWordSync) : null;
    if (bgEl) {
      row.appendChild(bgEl);
      row.classList.add('has-bg-vocal');
      row._ytmBgHost = bgEl._ytmWordSpans ? bgEl : null;
    }

    if (line && line.translation) {
      // 翻訳文はそのまま innerHTML に入れない。"<" を含むと以降が消える。
      const subSpan = createEl('span', '', 'lyric-translation');
      subSpan.textContent = line.translation;
      row.appendChild(subSpan);
      row.classList.add('has-translation');
    }

    row.addEventListener('mouseenter', () => startMeaningHover(line));
    row.addEventListener('mouseleave', () => {
      if (meaningHoverTimer) clearTimeout(meaningHoverTimer);
      meaningHoverTimer = null;
      if (meaningHoverVisible) scheduleMeaningHoverHide();
    });

    row.onclick = () => {
      if (meaningPanelVisible && line && typeof line.time === 'number') {
        syncMeaningPanelToPlayback(true, line.time);
      }
      if (!hasTimestamp || !line || line.time == null) return;
      seekToLyricTime(line.time);
    };
    fragment.appendChild(row);
  });

  ui.lyrics.appendChild(fragment);
  if (useWordSync) {
    prefetchLyricLineSweeps(Array.from(ui.lyrics.querySelectorAll('.lyric-line.ytm-word-sync, .lyric-bg.ytm-bg-sync')));
  }

  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    PipManager.pipLyricsContainer.innerHTML = ui.lyrics.innerHTML;
    if (useWordSync) {
      // PIP は幅が違うので語の横位置も違う。向こうの文書で測り直す。
      prefetchLyricLineSweeps(
        Array.from(PipManager.pipLyricsContainer.querySelectorAll('.lyric-line.ytm-word-sync, .lyric-bg.ytm-bg-sync')),
      );
    }
    if (PipManager.pipWindow.document) {
      // 歌詞が無い曲は PIP でも歌詞エリアごと畳む（通常ウィンドウと同じ扱い）
      PipManager.pipWindow.document.body.classList.toggle('ytm-no-lyrics', !hasData);
      PipManager.pipWindow.document.body.classList.toggle('ytm-no-timestamp', !hasTimestamp);
      PipManager.pipWindow.document.body.classList.remove('ytm-animated-caption-mode');
      PipManager.pipWindow.document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
      PipManager.pipWindow.document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
    }
  }
  refreshCompletedLyrics(getCurrentPlaybackTimeSec(), document.querySelector('video')?.duration);
}

const handleUpload = (e) => {
  const file = e.target.files[0];
  if (!file || !currentKey) return;
  const uploadKey = currentKey;
  const r = new FileReader();
  r.onload = async (ev) => {
    const text = String(ev.target.result || '').replace(/^\uFEFF/, '');
    // 語の時刻を持つファイル(拡張 LRC の A2 形式・TTML)は語同期に組む。
    // 以前は中身を行同期の LRC としてしか読まず、語の時刻を捨てていた。
    const isTtmlFile = /<tt[\s>]/i.test(text);
    let parsed = null;
    if (isTtmlFile || isDynamicLrcFormat(text)) {
      const res = await safeRuntimeSendMessage({ type: 'PARSE_LOCAL_LYRICS', payload: { text } });
      parsed = res?.success && res.parsed ? res.parsed : null;
    }
    // 読めなかった TTML を文字列のまま出すと、XML がそのまま歌詞に並ぶ
    if (isTtmlFile && !parsed) {
      console.warn('[CS] local TTML could not be parsed');
      return;
    }
    await storage.set(uploadKey, {
      cacheVersion: LYRICS_CACHE_VERSION,
      video_id: currentLyricsVideoId || getCurrentVideoId() || null,
      lyrics: parsed ? parsed.lyrics : text,
      dynamicLines: parsed?.dynamicLines || null,
      ...(parsed?.lrcMap ? { lrcMap: parsed.lrcMap } : {}),
      manualLyrics: true,
      lyricsSource: 'manual',
      fallbackUsed: false,
      noLyrics: false,
    });
    // 読み込んだ曲のままなら、そのまま出す。
    //
    // 以前は currentKey を潰して「曲が変わった」ことにし、tick に任せていた。
    // だが tick は player-bar の DOM が動いた時だけ走るので、何も触らないと
    // 読み込んだ歌詞がいつまでも出ない。走ったら走ったで初回ロード扱いになり、
    // 連続再生オフセットと同期オフセットが 0 に戻って歌詞がずれる。
    if (currentKey !== uploadKey) return;
    const metaNow = getMetadata();
    if (!metaNow) return;
    // manualLyrics はキャッシュ優先度 3。裏の取得で上書きされることはない。
    loadLyrics(metaNow);
  };
  r.readAsText(file);
  e.target.value = '';
};


let isRafLoopRunning = false;
// 時刻付きの歌詞が無い時は毎フレーム回さず、この間隔で回す(広告・一時停止の印だけ見る)
const LYRIC_IDLE_TICK_MS = 250;
let lyricIdleTimer = null;

// ループを回す意味があるのは、歌詞が見えている時(Immersion を開いている・PiP)だけ。
// 閉じている間も毎フレーム rAF を頼んでいたので、歌詞の無い曲でもページ全体の
// フレームの組み立てと描画が 1 秒 60 回走り、拡張を入れただけで YTM の CPU が
// 拡張なしの 2.5 倍になっていた(実測、2026-10)。開いた時・PiP を開いた時・
// 再生が始まった時に startLyricRafLoop で再開する。
const lyricLoopVisible = () => !!PipManager.pipWindow ||
  !!document.body?.classList.contains('ytm-custom-layout');
// 毎フレーム見る必要があるのは、時刻で行や文字を塗る時だけ
const lyricLoopNeedsEveryFrame = () => (
  (!!animatedCaptionData && !!config.useAnimatedCaptions) ||
  (!animatedCaptionData && lyricsData.length > 0 && !!hasTimestamp)
);

// 行ごとの同期(LRC)の歌詞は、行が変わる時にしか画面が変わらない。それでも
// 毎フレーム rAF を頼んでいたので、ページ全体のフレームの組み立て(スタイルの
// 再計算・IntersectionObserver の判定)が 1 秒 60 回走り、描くものが無いのに
// メインスレッドが拡張なしの 2 倍になっていた(実測、2026-10: 曲モードで
// 9.2 秒/分、拡張なし 4.4 秒/分。描いたのは 5 回に 1 回)。
// 塗る文字(語・1 文字同期)が無い間は、次に何かが変わる時刻の少し前まで寝る。
// シークや一時停止に気付くのが遅れないよう、寝るのは最長でも LYRIC_IDLE_TICK_MS。
const LYRIC_WAKE_EARLY_MS = 80;
const LYRIC_FRAME_MS = 1000 / 60;
const LYRIC_MOVIE_FRAME_MS = 1000 / 30;
// 軽量モードは曲モードでも 1 秒 30 回まで。YTM のページはフレームを 1 枚作るだけで
// 1 ms 近くかかり、塗りの回数がそのまま重さになる(実測、2026-10: ゴミ 95 → 68 MB/分、
// メインスレッド 80 → 70 ms/秒)。先端の進みは 1 回に 10px ほどになる。
const LYRIC_LIGHT_FRAME_MS = 1000 / 30;
// タイマーは少し遅れて来ることがある。その分早めに起きて、rAF で画面に合わせる
const LYRIC_FRAME_SLACK_MS = 4;
let _lyricLoopRanAt = 0;
const nextLyricEventSec = (t) => {
  let next = Infinity;
  const consider = (x) => { if (Number.isFinite(x) && x > t && x < next) next = x; };
  for (const line of lyricsData) {
    consider(line?.time);
    consider(line?._dynamicRenderStartSec);
    consider(line?._dynamicRenderEndSec);
  }
  if (config.fadePastLyrics) for (const item of _lyricCompletionSchedule) consider(item?.end);
  return next;
};
const lyricLoopSleepMs = () => {
  if (_activeRowsHaveCharSpans || (animatedCaptionData && config.useAnimatedCaptions)) return 0;
  if (!(_lastRafPlaybackTime >= 0)) return 0;
  const next = nextLyricEventSec(_lastRafPlaybackTime);
  const rate = _playbackRateForMotion > 0 ? _playbackRateForMotion : 1;
  const ms = Number.isFinite(next) ? ((next - _lastRafPlaybackTime) * 1000) / rate : Infinity;
  return ms - LYRIC_WAKE_EARLY_MS > 16 ? Math.min(ms - LYRIC_WAKE_EARLY_MS, LYRIC_IDLE_TICK_MS) : 0;
};

// rAF の ID はそれを発行したウィンドウでしか解除できない。
// PIP ウィンドウで予約した ID をメインの cancelAnimationFrame に渡しても効かないので、
// どちらで発行したかを覚えておく。
let lyricRafWindow = null;

// 寝る時のタイマーも、PiP を開いている間は PiP の窓で頼む。タブが裏に
// 回ると本体の窓のタイマーは 1 秒以上に間引かれ、PiP の行が遅れて変わる。
let lyricIdleTimerWindow = null;
let lyricVfcId = null;
let lyricVfcVideo = null;
const cancelLyricVfc = () => {
  if (lyricVfcId === null) return;
  try { lyricVfcVideo?.cancelVideoFrameCallback(lyricVfcId); } catch (e) { }
  lyricVfcId = null;
  lyricVfcVideo = null;
};
const cancelLyricRaf = () => {
  cancelLyricVfc();
  if (lyricIdleTimer) {
    try { (lyricIdleTimerWindow || window).clearTimeout(lyricIdleTimer); } catch (e) { }
    lyricIdleTimer = null;
    lyricIdleTimerWindow = null;
  }
  if (!lyricRafId) return;
  try { (lyricRafWindow || window).cancelAnimationFrame(lyricRafId); } catch (e) { }
  lyricRafId = null;
  lyricRafWindow = null;
};

// PIP の開閉時に呼ぶ。ループは走り続けているので startLyricRafLoop() だけでは
// ガードで弾かれ、コールバックが旧ウィンドウに予約されたまま残る。
// PIP を開くとメイン側は rAF が絞られて次フレームが来ず、ハイライトが止まる。
const restartLyricRafLoop = () => {
  cancelLyricRaf();
  isRafLoopRunning = false;
  startLyricRafLoop();
};
window.restartLyricRafLoop = restartLyricRafLoop;

// ── 行送りのスクロール ──────────────────────────────────
// 行が変わったら scrollTop はその場で行き先へ飛ばし、見た目の動きは
// 各行の translate で「さっきまでいた所」から 0 へ戻していく。
// その動きは Web Animations に渡すので、合成スレッドが画面の更新に合わせて進める。
//
// 以前は rAF で毎フレーム scrollTop と各行の translate を書いていた。
// ・ばねを performance.now() で進めていたので、コールバックが呼ばれる時刻の
//   ぶれ(フレーム内で前に何が走ったか次第で数 ms)がそのまま移動量のぶれになった
// ・scrollTop は画面の画素単位(Retina で 0.5px、等倍で 1px)に丸められるので、
//   止まり際が段々になった
// ・YTM 側が重いフレームでは歌詞も一緒に止まった
// ・動いている間、毎フレーム 10〜30 行ぶんのスタイルを書き換えていた
// 合成側で動かせばどれも起きない。メインスレッドの仕事は行が変わった時の1回だけ。
//
// ばねの形は以前のまま。ブラウザ内蔵の smooth スクロールは、動いている途中で
// 次の行が来ると動きを打ち切って速度が跳ねるので使わない。こちらは目標が
// 変わっても、式から出したその時点の位置と速度のまま繋ぐ。
// 外側は行き過ぎて戻らないよう臨界減衰(damping = 2√stiffness)にしてある。
const SCROLL_STIFFNESS = 120;
const SCROLL_DAMPING = 2 * Math.sqrt(SCROLL_STIFFNESS);
// これ以下になったら止める。残りコンマ数 px を延々と詰めない。
const SCROLL_SETTLE_PX = 0.5;
const SCROLL_SETTLE_VEL = 8;
// 自分が書いた位置からこれ以上ずれていたら、誰かが動かしたとみなす
const SCROLL_HANDOVER_PX = 4;

// 行ごとの時間差。上の行から順に少しずつ遅れて動き出す。
const LYRIC_STAGGER_DELAY = 0.032;
const LYRIC_STAGGER_MAX_ROWS = 32;
const LYRIC_STAGGER_STIFFNESS = 145;
const LYRIC_STAGGER_DAMPING = 19;

// キーフレームの間隔。間は合成側が直線で埋める。1/60 秒刻みなら
// 120Hz の画面で間を埋めても、曲線との差は 0.1px に届かない。
const LYRIC_MOTION_FRAME_SEC = 1 / 60;
const LYRIC_MOTION_MAX_SEC = 3;
// 画面の外でも、この距離までに入る行は動かす
const LYRIC_MOTION_MARGIN_PX = 80;

const isLyricRowMotionEnabled = () => typeof config !== 'undefined' &&
  config.lyricStagger !== false && !config.lowCpuMode;

// 減衰ばね(質量 1)の t 秒後の変位 y と速度 v。y0 は行き先からのずれ。
const sampleLyricSpring = (k, c, y0, v0, t) => {
  const w0 = Math.sqrt(k);
  const zeta = c / (2 * w0);
  if (zeta < 1 - 1e-6) {
    const a = zeta * w0;
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    const b = (v0 + a * y0) / wd;
    const e = Math.exp(-a * t);
    const cos = Math.cos(wd * t);
    const sin = Math.sin(wd * t);
    return {
      y: e * (y0 * cos + b * sin),
      v: e * ((b * wd - a * y0) * cos - (y0 * wd + a * b) * sin),
    };
  }
  if (zeta <= 1 + 1e-6) {
    const b = v0 + w0 * y0;
    const e = Math.exp(-w0 * t);
    return { y: (y0 + b * t) * e, v: (v0 - w0 * b * t) * e };
  }
  const s = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + s;
  const r2 = -zeta * w0 - s;
  const c1 = (v0 - r2 * y0) / (r1 - r2);
  const c2 = y0 - c1;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  return { y: c1 * e1 + c2 * e2, v: c1 * r1 * e1 + c2 * r2 * e2 };
};

// 着地するまでの変位を等間隔に並べる。最後は必ず 0。
const buildLyricRowMotionPath = (k, c, y0, v0) => {
  const path = [y0];
  for (let i = 1; ; i++) {
    const t = i * LYRIC_MOTION_FRAME_SEC;
    const { y, v } = sampleLyricSpring(k, c, y0, v0, t);
    if ((Math.abs(y) < SCROLL_SETTLE_PX && Math.abs(v) < SCROLL_SETTLE_VEL) || t >= LYRIC_MOTION_MAX_SEC) {
      path.push(0);
      return path;
    }
    path.push(y);
  }
};

// 行がいま行き先からどれだけずれているか(scrollTop と同じ向き)と速度、
// それに残りの待ち時間。アニメーションの経過時間から式で出す。
const readLyricRowMotion = (state) => {
  let elapsed = 0;
  try { elapsed = (Number(state.anim.currentTime) || 0) / 1000; } catch (e) { /* 破棄済み */ }
  const t = elapsed - state.delay;
  if (t >= state.duration) return { y: 0, v: 0, wait: 0 };
  if (t <= 0) return { y: state.y0, v: state.v0, wait: -t };
  const { y, v } = sampleLyricSpring(state.k, state.c, state.y0, state.v0, t);
  return { y, v, wait: 0 };
};

// その行の見た目が、本来の位置から何 px ずれているか。
// 行の位置を getBoundingClientRect で測る所は、これを引いて本来の位置に戻す。
const lyricRowScrollOffset = (row) => {
  const state = row?._ytmMotion;
  return state ? -readLyricRowMotion(state).y : 0;
};

// 自動追従へ戻る途中は、読んでいた過去行をまだ消さない。
// 復帰タイマーだけでは呼ばず、行の動きが着いた時に呼ぶ。
const finishLyricBrowseReturn = (container) => {
  if (!container?._ytmResumeFadeAfterScroll || container._ytmRowMotion) return;
  container._ytmResumeFadeAfterScroll = false;
  container.classList?.remove('ytm-user-browsing-lyrics');
};

const dropLyricRowMotion = (state) => {
  try { state.anim.cancel(); } catch (e) { /* 破棄済み */ }
  if (state.row._ytmMotion === state) state.row._ytmMotion = undefined;
};

// 動きを止めて、行を本来の位置に置く。再描画・シーク・窓の大きさの変更など、
// いまの動きがもう意味を持たない時に使う。
const resetLyricRowMotion = (container) => {
  const motion = container?._ytmRowMotion;
  if (!motion) return;
  container._ytmRowMotion = undefined;
  for (const state of motion.values()) dropLyricRowMotion(state);
};

const onLyricRowMotionFinished = (container, state) => {
  const motion = container._ytmRowMotion;
  if (!motion || motion.get(state.row) !== state) return;
  motion.delete(state.row);
  dropLyricRowMotion(state);
  if (motion.size) return;
  container._ytmRowMotion = undefined;
  finishLyricBrowseReturn(container);
};

const writeLyricScrollTop = (container, top) => {
  container.scrollTop = top;
  // 書いた値ではなく、丸められた実際の値を覚える。
  // scrollTop は 0〜(scrollHeight - clientHeight) に丸められる。中央合わせの
  // 行き先は曲頭と曲末で範囲の外に出る(上下の余白 30vh に対し中央は
  // clientHeight/2 = 32.5vh。行が 5vh より低いと、1行目の行き先が負になる)。
  // ここで丸める前の値を覚えると、以後 onLyricContainerScroll の「誰かが動かした」
  // 判定が毎回成立して、追従が二度と落ち着かなくなる。
  container._scrollLastWritten = container.scrollTop;
  return container._scrollLastWritten;
};

// 行が変わった時に1回だけ呼ぶ。scrollTop を行き先へ飛ばし、飛ばしたぶんを
// 見えている行の translate で打ち消してから、ばねで 0 へ戻す。
const startLyricRowMotion = (container, target, primaryIndex) => {
  const from = container.scrollTop;
  // いま動いている行の、この瞬間の位置と速度を先に控える(止めると読めない)
  const previous = container._ytmRowMotion;
  const carried = new Map();
  if (previous) {
    for (const state of previous.values()) carried.set(state.row, readLyricRowMotion(state));
    resetLyricRowMotion(container);
  }

  const to = writeLyricScrollTop(container, target);
  const rows = container.children;
  const height = container.clientHeight;
  if (!rows?.length || !height || typeof rows[0].animate !== 'function') {
    finishLyricBrowseReturn(container);
    return;
  }

  const jump = to - from;
  // 遠くへ飛ぶ時(手で読みに行った所から戻る等)は時間差を付けない。
  // 付けると画面何枚ぶんもの行が順に遅れて、戻り切るまでが長くなる。
  const stagger = isLyricRowMotionEnabled() && Math.abs(jump) <= height * 1.5;
  const k = stagger ? LYRIC_STAGGER_STIFFNESS : SCROLL_STIFFNESS;
  const c = stagger ? LYRIC_STAGGER_DAMPING : SCROLL_DAMPING;
  // 行き過ぎるぶんも画面に入りうるので、遠いほど広めに見る
  const margin = LYRIC_MOTION_MARGIN_PX + Math.abs(jump) * 0.05;
  const viewTop = container.getBoundingClientRect().top;

  // 動いている間に画面に入る行だけを拾う。行は上から順に並んでいるので、
  // 歌っている行から上下へたどり、画面の外に出きった所で打ち切る。
  // 測るのは行が変わった時だけ。
  const picked = [];
  // 動き出しの位置から着地までの間に、器の中に入るか。上に外れていれば -1、下なら 1
  const placeOf = (row, y0) => {
    const rect = row.getBoundingClientRect();
    if (!rect.height) return null;
    const endTop = rect.top - viewTop;
    const startTop = endTop - y0;
    if (Math.max(startTop, endTop) + rect.height < -margin) return -1;
    if (Math.min(startTop, endTop) > height + margin) return 1;
    return 0;
  };
  // 戻り値 false で、その向きへの走査をやめる
  const visit = (i, dir) => {
    const row = rows[i];
    if (!row.classList.contains('lyric-line')) return true;
    const prior = carried.get(row);
    const y0 = from + (prior ? prior.y : 0) - to;
    const place = placeOf(row, y0);
    if (place === null) return true;
    if (place < 0) return dir > 0;
    if (place > 0) return dir < 0;
    picked.push({ index: i, row, y0, v0: prior ? prior.v : 0, wait: prior ? prior.wait : null, inView: true });
    return true;
  };
  const center = Number.isInteger(primaryIndex)
    ? Math.min(Math.max(primaryIndex, 0), rows.length - 1)
    : 0;
  for (let i = center; i < rows.length; i++) if (!visit(i, 1)) break;
  for (let i = center - 1; i >= 0; i--) if (!visit(i, -1)) break;
  // 打ち切った先でまだ動いている行も、器の中に入るなら途中で放すと跳ぶので最後まで動かす。
  // 動き出しから着地まで器の外にいる行は、本来の位置に置いて終わりにする(見えないので跳ばない)。
  // 以前は外れた行も全部動かし直していた。行が次々に変わる速い曲では、上へ流れ去った行が
  // 行のたびに新しい距離を足されて止まらず、動いている行が 1 行ごとに増え続けた
  // (実測: 0.15 秒ごとの行で 237 行)。しかもそれが時間差の順番に数えられ、見えている行の
  // 待ち時間が上限(1 秒)近くまで伸びて、今の行の下の行が遅れ、後から拾われた下の行に
  // 追い越されて重なった。
  for (const row of carried.keys()) {
    if (picked.some(p => p.row === row) || row.parentNode !== container) continue;
    const prior = carried.get(row);
    const y0 = from + prior.y - to;
    if (placeOf(row, y0) !== 0) continue;
    picked.push({ index: Array.prototype.indexOf.call(rows, row), row, y0, v0: prior.v, wait: prior.wait, inView: false });
  }
  picked.sort((a, b) => a.index - b.index);

  const motion = new Map();
  // 新しく動き出す行はみな同じ距離・速度 0 なので、キーフレームを使い回す
  const shared = new Map();
  // 時間差の順番は、画面の中で拾った行だけで数える(上の行から 0, 1, 2…)
  let order = -1;
  picked.forEach(({ row, y0, v0, wait, inView }) => {
    if (inView) order += 1;
    if (Math.abs(y0) < SCROLL_SETTLE_PX && Math.abs(v0) < SCROLL_SETTLE_VEL) return;
    const fresh = stagger ? Math.min(Math.max(order, 0), LYRIC_STAGGER_MAX_ROWS - 1) * LYRIC_STAGGER_DELAY : 0;
    // まだ待っている行は、残りの待ちと今回の順番の短い方。待ちを持ち越すだけだと、
    // 行が来るたびに距離だけ足されて、動き出しが前の行の順番のまま遅れていく。
    const delay = wait !== null ? Math.min(wait, fresh) : fresh;
    const key = `${y0.toFixed(2)}|${v0.toFixed(1)}`;
    let built = shared.get(key);
    if (!built) {
      const path = buildLyricRowMotionPath(k, c, y0, v0);
      built = {
        frames: path.map(y => ({ translate: `0 ${(-y).toFixed(2)}px` })),
        duration: (path.length - 1) * LYRIC_MOTION_FRAME_SEC,
      };
      shared.set(key, built);
    }
    let anim;
    try {
      anim = row.animate(built.frames, {
        duration: built.duration * 1000,
        delay: delay * 1000,
        // 待っている間は元いた所に留まる。終われば何も残さない。
        fill: 'backwards',
        easing: 'linear',
      });
    } catch (e) {
      return;
    }
    const state = { row, anim, k, c, y0, v0, delay, duration: built.duration };
    row._ytmMotion = state;
    motion.set(row, state);
    anim.onfinish = () => onLyricRowMotionFinished(container, state);
  });

  if (motion.size) container._ytmRowMotion = motion;
  else finishLyricBrowseReturn(container);
};

// 先頭へ戻す時など、動きの外から scrollTop を書く場合はこれを通す。
// 記録を残したまま書き換えると、次のフレームで「誰かが動かした」と
// 誤判定して寄せ直しが走る。
const resetLyricScrollState = (container, top = 0) => {
  if (!container) return;
  container._ytmResumeFadeAfterScroll = false;
  resetLyricRowMotion(container);
  writeLyricScrollTop(container, top);
};

// ── 歌っている行を止める位置 ────────────────────────────────
// 既定は器の中央。狭い画面(縦積み)では、中央に置くと上半分が歌い終わった行で
// 埋まってしまい、これから来る歌詞の見える量が半分になる。CSS 側で
//   --ytm-lyrics-anchor-top-lines: 0.5
// のように「上から何行ぶん下げた所に置くか」を指定できるようにして、
// 画面の形ごとの判断は CSS(メディアクエリ)に持たせる。
//
// 行の高さを単位にしているので、文字サイズや UI サイズを変えても
// 上に残る余白の見た目が変わらない。
const LYRICS_ANCHOR_VAR = '--ytm-lyrics-anchor-top-lines';

const readLyricAnchorTopLines = (container) => {
  if (container._ytmAnchorLines !== undefined) return container._ytmAnchorLines;
  let value = null;
  try {
    const raw = container.ownerDocument.defaultView
      .getComputedStyle(container)
      .getPropertyValue(LYRICS_ANCHOR_VAR)
      .trim();
    const n = Number(raw);
    if (raw && Number.isFinite(n) && n >= 0) value = n;
  } catch (e) { /* 読めなければ中央に置く */ }
  container._ytmAnchorLines = value;
  return value;
};

// 止める位置を決める時の行の高さ。ハモリ(.lyric-bg)のぶんは数えない。
// ハモリは光った行で下に開くので、開いた高さまで含めて真ん中に置くと、
// その行だけ本編が上にずれて止まる(他の行と止まる位置が揃わない)。
// 開く途中でも、いま開いているぶんを引けば本編だけの高さになる。
const lyricRowAnchorHeight = (row, rowRect) => {
  const height = rowRect.height;
  if (!row.classList?.contains('has-bg-vocal')) return height;
  const bg = row.querySelector('.lyric-bg');
  if (!bg) return height;
  let margin = 0;
  try {
    margin = parseFloat(row.ownerDocument.defaultView.getComputedStyle(bg).marginTop) || 0;
  } catch (e) { /* 読めなければ余白は 0 とみなす */ }
  return Math.max(0, height - bg.getBoundingClientRect().height - margin);
};

// 器の上端から、その行の上端までの距離
const lyricAnchorOffset = (container, rowHeight) => {
  const lines = readLyricAnchorTopLines(container);
  if (lines === null) return (container.clientHeight / 2) - (rowHeight / 2);
  return lines * rowHeight;
};

const requestLyricScroll = (container, target, instant, primaryIndex) => {
  if (!container) return;
  // ブラウザが到達できる位置を目標にする。
  if (Number.isFinite(container.scrollHeight) && Number.isFinite(container.clientHeight)) {
    target = Math.max(0, Math.min(target, container.scrollHeight - container.clientHeight));
  }
  if (instant) {
    resetLyricRowMotion(container);
    writeLyricScrollTop(container, target);
    finishLyricBrowseReturn(container);
    return;
  }
  // 自分で書いた scrollTop の scroll イベントを、ユーザー操作と
  // 取り違えられないようにしておく(どちらの判定もこれを最初に見る)。
  container._suppressUserScrollUntil = performance.now() + 220;
  if (container === ui.lyrics) suppressUserScrollDetection(220);
  watchLyricContainerScroll(container);
  startLyricRowMotion(container, target, primaryIndex);
};

// 行が動いている間に、scrollTop を誰かが動かしたか。
// 翻訳の到着で行の高さが変わった、利用者がホイールで動かした、など。
// 寄せた位置はもう合っていないので、「スクロール済み」の印を戻して次のフレームで
// 出し直させる(利用者が掴んでいる間は isUserScrolling の側で見送られ、
// 手を離して 3 秒すればどのみち印は戻る)。
// 動いている行はそのまま着地させる。止めると残りの距離を一度に跳ぶ。
//
// 毎フレーム scrollTop を読んで確かめてはいけない。文字の塗りが毎フレーム
// スタイルを汚すので、読むたびにその場でスタイルとレイアウトを確定させる
// ことになる(実測でこれだけで 8ms/秒)。scroll イベントが来た時だけ見る。
const onLyricContainerScroll = (event) => {
  const container = event.currentTarget;
  if (!container?._ytmRowMotion) return;
  const written = container._scrollLastWritten;
  if (written !== undefined && Math.abs(container.scrollTop - written) <= SCROLL_HANDOVER_PX) return;
  container._scrollLastWritten = container.scrollTop;
  container._lastScrolledIndex = -1;
};

const watchLyricContainerScroll = (container) => {
  if (container._ytmScrollWatched || typeof container.addEventListener !== 'function') return;
  container._ytmScrollWatched = true;
  container.addEventListener('scroll', onLyricContainerScroll, { passive: true });
};

// ── 広告の間 ────────────────────────────────────────────
// 広告は同じ <video> で流れる。そのまま時刻を読むと、前の曲の歌詞が広告の
// 再生位置に合わせて頭から流れ直す。以前は曲の切り替えが広告の直前で
// 止まり、前の曲の題名・次の曲のアーティスト名・Loading... が並んでいた。
// 広告の間は歌詞を塗らず、歌詞の場所に「広告のあとで戻る」とだけ出す。
let _cachedMoviePlayer = null;
let _adPlayingState = false;
const isAdPlayingNow = () => {
  let mp = _cachedMoviePlayer;
  if (!mp || !mp.isConnected) mp = _cachedMoviePlayer = document.getElementById('movie_player');
  return !!mp && (mp.classList.contains('ad-showing') || mp.classList.contains('ad-interrupting'));
};
const setAdPlayingState = (on) => {
  on = !!on;
  if (on === _adPlayingState) return;
  _adPlayingState = on;
  document.body.classList.toggle('ytm-ad-playing', on);
  if (!on) return;
  // 文字の動きは合成側の時計で走っているので、明示的に止める
  pauseAllLyricWordMotion();
  // 歌詞を隠すので、歌詞カードの行選びも閉じる
  if (typeof LyricCard !== 'undefined') LyricCard.cancel();
  if (!ui.lyricsStage) return;
  let notice = ui.lyricsStage.querySelector('.ytm-ad-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'ytm-ad-notice';
    notice.setAttribute('role', 'status');
    const label = document.createElement('div');
    label.className = 'ytm-ad-notice-label';
    const sub = document.createElement('div');
    sub.className = 'ytm-ad-notice-sub';
    notice.append(label, sub);
    ui.lyricsStage.appendChild(notice);
  }
  // 表示言語は途中で変わり得るので、出すたびに入れ直す
  notice.querySelector('.ytm-ad-notice-label').textContent = t('ad_notice_title');
  notice.querySelector('.ytm-ad-notice-sub').textContent = t('ad_notice_sub');
};

function startLyricRafLoop() {
  if (isRafLoopRunning) return;
  isRafLoopRunning = true;
  cancelLyricRaf();
  _cachedVideoEl = null;
  // 停止中に曲が変わっている可能性があるため、巻き戻り検出の基準をリセット
  _lastRafPlaybackTime = -1;
  // 一時停止をまたぐと「止まっていた間の実時間」が補間に乗ってしまう
  resetPlaybackClock();

  const scheduleNextFrame = () => {
    if (!lyricLoopVisible()) {
      isRafLoopRunning = false;
      return;
    }
    const sleepMs = lyricLoopNeedsEveryFrame() ? lyricLoopSleepMs() : LYRIC_IDLE_TICK_MS;
    if (sleepMs > 0) {
      lyricIdleTimerWindow = PipManager.pipWindow || window;
      lyricIdleTimer = lyricIdleTimerWindow.setTimeout(() => {
        lyricIdleTimer = null;
        lyricIdleTimerWindow = null;
        loop();
      }, sleepMs);
      return;
    }
    // 塗る文字がある間も、回数に上限を付ける。曲モードは 1 秒 60 回、
    // 動画モードは 30 回(映像そのものが 30 コマ前後なので、それより細かく
    // 塗っても見た目は変わらない)。120Hz の画面では rAF が 1 秒 120 回来る。
    // 次の 1 枚の少し前まではタイマーで待つ(rAF を頼むとその時点で
    // ページ全体のフレームが立つ)。
    // 動画モードは映像のコマに合わせて塗る(requestVideoFrameCallback)。別々の
    // 時計で塗ると、映像のコマと歌詞の塗りで合成の回数が足し算になる。
    // 映像のコマに乗せれば、映像が描くついでに歌詞も描ける。
    // PiP を開いている・タブが裏の時は、映像のコマが本体の画面に出ないので使わない。
    // 一時停止・読み込み待ちでコマが来ない時に止まらないよう、タイマーでも起こす。
    if (moviemode === true && !PipManager.pipWindow && !document.hidden) {
      const video = _cachedVideoEl || document.querySelector('video');
      if (video && typeof video.requestVideoFrameCallback === 'function') {
        const onFrame = () => {
          lyricVfcId = null;
          lyricVfcVideo = null;
          if (performance.now() - _lyricLoopRanAt < LYRIC_MOVIE_FRAME_MS - LYRIC_FRAME_SLACK_MS) {
            // 60 コマの映像。1 つおきに塗る
            lyricVfcVideo = video;
            lyricVfcId = video.requestVideoFrameCallback(onFrame);
            return;
          }
          if (lyricIdleTimer) { clearTimeout(lyricIdleTimer); lyricIdleTimer = null; lyricIdleTimerWindow = null; }
          loop();
        };
        lyricVfcVideo = video;
        lyricVfcId = video.requestVideoFrameCallback(onFrame);
        lyricIdleTimerWindow = window;
        lyricIdleTimer = setTimeout(() => {
          lyricIdleTimer = null;
          lyricIdleTimerWindow = null;
          cancelLyricVfc();
          loop();
        }, LYRIC_IDLE_TICK_MS);
        return;
      }
    }
    const frameMs = moviemode === true
      ? LYRIC_MOVIE_FRAME_MS
      : (config.lowCpuMode ? LYRIC_LIGHT_FRAME_MS : LYRIC_FRAME_MS);
    const wait = frameMs - (performance.now() - _lyricLoopRanAt) - LYRIC_FRAME_SLACK_MS;
    if (wait > 1) {
      lyricIdleTimerWindow = PipManager.pipWindow || window;
      lyricIdleTimer = lyricIdleTimerWindow.setTimeout(() => {
        lyricIdleTimer = null;
        lyricIdleTimerWindow = null;
        requestLoopFrame();
      }, wait);
      return;
    }
    requestLoopFrame();
  };
  const requestLoopFrame = () => {
    if (PipManager.pipWindow) {
      lyricRafWindow = PipManager.pipWindow;
      lyricRafId = PipManager.pipWindow.requestAnimationFrame(loop);
    } else {
      lyricRafWindow = window;
      lyricRafId = requestAnimationFrame(loop);
    }
  };

  const loop = () => {
    _lyricLoopRanAt = performance.now();
    const v = _cachedVideoEl || (_cachedVideoEl = document.querySelector('video'));

    if (v) {
      if (PipManager.pipWindow) {
        PipManager.updatePlayState(v.paused);
      }

      const isPlaying = v.readyState > 0 && !v.paused && !v.ended;
      // 毎フレーム書かない。値が同じでも classList への代入は
      // スタイルの再計算対象になるので、変わった時だけ触る。
      if (isPlaying !== _lastPlayingStateForBodyClass) {
        _lastPlayingStateForBodyClass = isPlaying;
        document.body.classList.toggle('ytm-music-paused', !isPlaying);
      }

      if (isPlaying && isAdPlayingNow()) {
        // 広告の時刻で歌詞を塗らない。終われば次のフレームから元どおり。
        setAdPlayingState(true);
        scheduleNextFrame();
        return;
      }
      if (_adPlayingState) setAdPlayingState(false);

      if (isPlaying) {
        _playbackRateForMotion = (Number.isFinite(v.playbackRate) && v.playbackRate > 0)
          ? v.playbackRate
          : 1;
        let t = readSmoothPlaybackTime(v);
        const duration = v.duration || 1;

        // 連続再生（曲が変わっても currentTime がリセットされない）対応:
        // 現在の曲が始まった video 時間(timeOffset)を引いて曲内ローカル時間にする。
        // currentTime が offset を下回ったら曲がリセットされたとみなし offset を解除。
        if (timeOffset > 0 && t < timeOffset) timeOffset = 0;
        t = toLocalPlaybackTime(t);
        // 動画モードで対応表がある時は、MV の時刻を音源の時刻に直す
        t = applyMovieTime(t, v);
        // v.duration は曲ごとの長さ。ローカル時間はそれを超えないのでそのままクランプ
        t = Math.min(Math.max(0, t + (config.syncOffset / 1000)), v.duration);

        // 再生時間が大幅に巻き戻った場合（曲切替 or 後方シーク）の検出。
        // 次のスクロールを即時ジャンプにして、0秒位置からのゆっくりスクロールを防ぐ。
        // （曲切替時の歌詞リセットは tick() が currentKey 変更を検出して
        //   lyricsData を空にするため、ここでは凍結せず即時ジャンプのみで十分）
        if (_lastRafPlaybackTime >= 0 && t < _lastRafPlaybackTime - 1.5) {
          if (ui.lyrics) ui.lyrics._instantNextScroll = true;
          if (PipManager.pipLyricsContainer) PipManager.pipLyricsContainer._instantNextScroll = true;
        }
        _lastRafPlaybackTime = t;

        // ハイライト更新で例外が出てもRAFループを止めないようにする
        // （止まると isRafLoopRunning が true のまま再開せず、ハイライトが永久停止するため）
        try {
          if (animatedCaptionData && config.useAnimatedCaptions) {
            updateAnimatedCaptionStage(t);
          }
          if (!animatedCaptionData && lyricsData.length && hasTimestamp) {
            refreshCompletedLyrics(t, v.duration);
            updateLyricHighlight(t);
          }
        } catch (err) {
          console.warn('[YTM] lyric highlight update failed:', err);
        }

        // PipManager.progressRing を更新する処理がここにあったが、
        // その要素はどこでも生成されていないので毎フレーム空振りしていた。

        scheduleNextFrame();
      } else {
        if (!animatedCaptionData) refreshCompletedLyrics(v.ended ? v.duration : getCurrentPlaybackTimeSec(), v.duration);
        // 文字の動きは合成側の時計で走っているので、明示的に止めないと
        // 一時停止中も歌詞だけ動き続ける。
        pauseAllLyricWordMotion();
        isRafLoopRunning = false;
      }
    } else {
      pauseAllLyricWordMotion();
      isRafLoopRunning = false;
    }
  };

  scheduleNextFrame();
}

// 窓の大きさが変わったら、いまの行へ寄せ直す。
//
// 行を画面の真ん中に置く量は、その時の器の高さと行の位置から px で出している。
// 窓の幅が変わると縦積み↔横並びでレイアウトごと変わるので、前の大きさで
// 出した位置は意味を失う。それでも「この行へはもう寄せた」という印
// (_lastScrolledIndex)が残っているせいで、次の行が始まるまで誰も直さない。
// 実際、幅を変えて戻すと歌詞が画面の下に取り残されて消えたように見えた。
const recenterLyricsAfterResize = () => {
  for (const container of [ui.lyrics, PipManager.pipLyricsContainer]) {
    if (!container) continue;
    // 画面の形が変わるとメディアクエリごと変わる。止める位置も読み直す。
    container._ytmAnchorLines = undefined;
    // 印を戻すと次のフレームで今の行へ寄せ直す。
    container._lastScrolledIndex = -1;
    // 直前の位置から流すと、変わったあとの見当違いな所から動き出す。
    container._instantNextScroll = true;
    // 動いている途中の行も、前の大きさで出した px なので捨てる。
    resetLyricRowMotion(container);
  }
};

// 窓の大きさが変わると語の横位置が動く。次に主役になった時に測り直させる。
let _sweepResizeTimer = null;
window.addEventListener('resize', () => {
  if (_sweepResizeTimer) clearTimeout(_sweepResizeTimer);
  _sweepResizeTimer = setTimeout(() => {
    _sweepResizeTimer = null;
    invalidateLyricLineSweeps();
    recenterLyricsAfterResize();
    // YTM が窓の幅でバーの並べ方(grid / flex)を変えるので、控えを取り直す
    PlayerBar.rememberDisplay(PlayerBar.current(), true);
    balanceWizBar();
  }, 200);
});

document.addEventListener('play', (e) => {
  if (e.target.tagName === 'VIDEO') {
    startLyricRafLoop();
  }
}, true);

document.addEventListener('playing', (e) => {
  if (e.target.tagName === 'VIDEO') {
    startLyricRafLoop();
  }
}, true);

// シークで offset を下回ったら、その曲は頭から掛け直されている。
// rAF ループは再生中しか回らないので、止めたままシークした時はここで直す。
document.addEventListener('seeked', (e) => {
  if (e.target.tagName !== 'VIDEO') return;
  const t = e.target.currentTime;
  if (typeof t === 'number' && timeOffset > 0 && t < timeOffset) timeOffset = 0;
  for (const container of [ui.lyrics, PipManager.pipLyricsContainer]) {
    if (!container) continue;
    resetLyricRowMotion(container);
    container._instantNextScroll = true;
    container._lastScrolledIndex = -1;
  }
  refreshCompletedLyrics(getCurrentPlaybackTimeSec(), e.target.duration);
}, true);



let isUserScrolling = false;
let userScrollTimeout = null;
let isProgrammaticScrolling = false;
let programmaticScrollTimeout = null;
let programmaticScrollMaxTimeout = null;
let _previousActiveIndices = new Set();
// Daily Replay の「累計行数」に数えた最後の行。数えるのは行が進んだ時だけにする。
// 以前はスクロールを頼むたびに数えていて、寄せ直し(手で動かした後・窓の
// 大きさの変更・再描画)のたびに同じ行を数え直していた。
let _lastCountedLyricIndex = -1;
// 歌詞カードで行を選んでいる間は、歌っている行へ寄せない(選ぶ行が逃げる)。
let _lyricsAutoFollowHold = false;
function setLyricsAutoFollowHold(on) {
  _lyricsAutoFollowHold = !!on;
  // 放したら、いま歌っている行へ寄せ直す
  if (!_lyricsAutoFollowHold && ui.lyrics) ui.lyrics._lastScrolledIndex = -1;
}
let _cachedVideoEl = null;
let _slidersPatched = false;
let _lastLikeCheckTime = 0;
// 拡張側の操作(再描画・scrollTopリセット等)によるscrollイベントを
// ユーザースクロールと誤検出しないための抑制ウィンドウ
let _suppressUserScrollUntil = 0;
// 再生時間の大幅な巻き戻り（曲切替/シーク）検出用
let _lastRafPlaybackTime = -1;

// ── 再生位置の補間 ────────────────────────────────────────
// video.currentTime は毎フレーム進むわけではない。YouTube Music が流すのは
// 実質音声だけのストリームで、currentTime は音声バッファのコールバック単位に
// まとめて進む(実測で数十 ms おき)。rAF は 60fps で回るので、そのまま使うと
// 同じ値が数フレーム続いたあと一段飛ぶ = 階段状の時間になる。
//
// 従来の「時刻を過ぎたら点灯」ではこの段差は見えなかった。1文字が数十 ms
// 遅れて点いても分からないため。塗りを連続にした途端に段差がそのまま
// 目に見えるようになった。
//
// やっていること:
//   1. 自前の時計をフレーム間の実経過時間ぶんだけ進める(ここが滑らかさの本体)
//   2. currentTime から作った推定値へ、毎フレームごくわずかだけ引き寄せる
// 2 を一気にやると段差が戻ってくる。currentTime 由来の推定値は
// 「更新されるまで古い値のまま」なので、それ自体がノコギリ状に揺れていて、
// そのまま採用すると 10ms 前後の凸凹が残る。少しずつ吸収して均す。
let _clockRawTime = -1;   // 最後に観測した currentTime そのもの
let _clockRawAt = 0;      // それを観測した performance.now()
let _clockOutTime = -1;   // 直前に返した推定値
let _clockOutAt = 0;      // それを返した performance.now()

// currentTime が止まっている間に推定値を進めてよい上限。
// バッファ切れ等で本当に止まった時、時計だけ走り続けるのを防ぐ。
const CLOCK_MAX_EXTRAPOLATION_SEC = 0.2;
// 推定値とのズレがこれを超えたらシーク・曲送りとみなして合わせ直す
const CLOCK_RESYNC_SEC = 0.35;
// 1フレームで吸収するズレの割合。小さいほど滑らかで、追従は遅くなる。
const CLOCK_CORRECTION = 0.12;
// 推定値からどこまで離れることを許すか。先走りは音より先に光るので厳しめ。
const CLOCK_MAX_LEAD_SEC = 0.08;
const CLOCK_MAX_LAG_SEC = 0.15;

const resetPlaybackClock = () => {
  _clockRawTime = -1;
  _clockRawAt = 0;
  _clockOutTime = -1;
  _clockOutAt = 0;
};

const readSmoothPlaybackTime = (v) => {
  const raw = v.currentTime;
  if (!Number.isFinite(raw)) return raw;

  const now = (typeof performance !== 'undefined' && performance.now)
    ? performance.now()
    : Date.now();
  const rate = (Number.isFinite(v.playbackRate) && v.playbackRate > 0) ? v.playbackRate : 1;

  if (raw !== _clockRawTime) {
    _clockRawTime = raw;
    _clockRawAt = now;
  }

  // currentTime は「最後に更新された時点では正確」。そこからの実経過を足す。
  const target = raw + Math.min(
    (now - _clockRawAt) / 1000 * rate,
    CLOCK_MAX_EXTRAPOLATION_SEC,
  );

  if (_clockOutTime < 0 || Math.abs(target - _clockOutTime) > CLOCK_RESYNC_SEC) {
    // 初回・シーク・曲送り・タブが止まっていた後。素直に合わせ直す。
    _clockOutTime = target;
    _clockOutAt = now;
    return _clockOutTime;
  }

  const predicted = _clockOutTime + (now - _clockOutAt) / 1000 * rate;
  let out = predicted + (target - predicted) * CLOCK_CORRECTION;
  if (out > target + CLOCK_MAX_LEAD_SEC) out = target + CLOCK_MAX_LEAD_SEC;
  if (out < target - CLOCK_MAX_LAG_SEC) out = target - CLOCK_MAX_LAG_SEC;

  _clockOutTime = out;
  _clockOutAt = now;
  return out;
};

let _hasDynamicRenderRanges = false;
// アクティブ行に1文字同期スパンが含まれるか。trueの間のみ毎フレームのDOM更新が必要。
// 安全側に倒して初期値はtrue（次のフレームで実態に合わせて更新される）
let _activeRowsHaveCharSpans = true;

function suppressUserScrollDetection(ms = 500) {
  _suppressUserScrollUntil = performance.now() + ms;
}

// 動きは合成側の時計で走るので、倍速再生に付いていくために
// 再生速度を渡す必要がある。毎フレーム video を読み直さずに済むよう、
// rAF ループが更新した値をここで使う。
let _playbackRateForMotion = 1;

// body のクラスを毎フレーム書き直さないための控え。
// null は「まだ一度も書いていない」= 次は必ず書く。
let _lastPlayingStateForBodyClass = null;

// 一時停止中のループは 250ms おきにしか回らないので、再生/一時停止の
// 瞬間はイベントで書く(ジャケットの縮み・戻りが遅れて始まらないように)
const syncPausedClassFromEvent = (e) => {
  const v = e.target;
  if (v !== document.querySelector('video')) return;
  const isPlaying = v.readyState > 0 && !v.paused && !v.ended;
  if (isPlaying === _lastPlayingStateForBodyClass) return;
  _lastPlayingStateForBodyClass = isPlaying;
  document.body.classList.toggle('ytm-music-paused', !isPlaying);
};
['play', 'pause', 'ended'].forEach((type) => document.addEventListener(type, syncPausedClassFromEvent, true));

// アクティブ行の塗り(文字・語の進み)を1行ぶん更新する。
// 毎フレーム必要なのはここだけなので、行の状態が変わっていないフレームは
// この関数をアクティブ行にだけ当てる(全行の走査をしない)。
// 戻り値は「この行が文字単位の塗りを持っていたか」。
function paintActiveLyricRow(r, t) {
  // 行要素にキャッシュした配列を使う（毎フレームの querySelectorAll を回避）
  // PIP の行は複製なので _ytmWordSpans を持たない。クラスで見分けて
  // 一度だけ組み直す(rehydrate は paintLyricWordRow の中でやる)。
  const isWordSync = r._ytmWordSpans
    ? r._ytmWordSpans.length > 0
    : r.classList.contains('ytm-word-sync');
  if (isWordSync) {
    paintLyricWordRow(r, t, _playbackRateForMotion);
    const bgHost = lyricBackgroundHost(r);
    if (bgHost) paintLyricWordRow(bgHost, t, _playbackRateForMotion);
    return true;
  }

  let charSpans = r._ytmCharSpans;
  if (!charSpans) charSpans = r._ytmCharSpans = Array.from(r.querySelectorAll('.lyric-char'));
  if (charSpans.length === 0) return false;

  charSpans.forEach(sp => {
    if (sp._ytmTime === undefined) sp._ytmTime = parseFloat(sp.dataset.time || '0');
    const tt = sp._ytmTime;
    if (Number.isFinite(tt) && tt <= t) {
      if (!sp.classList.contains('char-active')) {
        sp.classList.add('char-active');
        sp.classList.remove('char-pending');
      }
    } else {
      if (!sp.classList.contains('char-pending')) {
        sp.classList.remove('char-active');
        sp.classList.add('char-pending');
      }
    }
  });
  return true;
}

// 行どうしの突き合わせに使う文字列。NFKC 正規化と記号落としを毎フレーム
// やり直していた(アクティブ行と 1 つ前の行で毎フレーム 2 回)。
// 元の text が変わらない限り結果も変わらないので、行に覚えさせる。
const lyricCompareText = (line) => {
  if (!line || typeof line !== 'object') return normalizeLyricCompareTextStrict(line?.text);
  const raw = line.text;
  if (line._ytmCmpSrc === raw && typeof line._ytmCmpText === 'string') return line._ytmCmpText;
  const value = normalizeLyricCompareTextStrict(raw);
  line._ytmCmpSrc = raw;
  line._ytmCmpText = value;
  return value;
};

function updateLyricHighlight(currentTime) {
  if (!lyricsData.length) return;
  if (!hasTimestamp) return;
  // 再生時間が不正（NaN/Infinity）な場合は処理しない。
  // 曲切替直後などに NaN が来ると idx が最終行になり、歌詞が一番下まで
  // スクロールしてしまうため。
  if (!Number.isFinite(currentTime)) return;

  const t = currentTime;

  let idx = -1;
  let startSearch = Math.max(0, lastActiveIndex);

  // 再生時間が前回の位置より大幅に戻っている場合は最初から検索
  if (startSearch >= lyricsData.length || (startSearch > 0 && lyricsData[startSearch].time > t + 0.5)) {
    startSearch = 0;
  }

  for (let i = startSearch; i < lyricsData.length; i++) {
    if (lyricsData[i].time > t) {
      idx = i - 1;
      break;
    }
    if (i === lyricsData.length - 1) idx = i;
  }



  const targets = [];
  if (ui.lyrics) targets.push(ui.lyrics);
  if (PipManager.pipWindow && PipManager.pipLyricsContainer) {
    targets.push(PipManager.pipLyricsContainer);
  }

  const activeIndices = new Set();
  if (idx >= 0 && idx < lyricsData.length) {
    const primaryLine = lyricsData[idx];
    const primaryHasDynamicRange = Number.isFinite(primaryLine?._dynamicRenderStartSec) &&
      Number.isFinite(primaryLine?._dynamicRenderEndSec);
    const primaryIsActive = isPrimaryRowLitAtTime(lyricsData, idx, t);
    if (primaryIsActive) activeIndices.add(idx);

    const currentLineTime = lyricsData[idx]?.time;
    if (primaryIsActive && typeof currentLineTime === 'number') {
      for (let i = idx - 1; i >= 0; i--) {
        if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
        activeIndices.add(i);
      }
      for (let i = idx + 1; i < lyricsData.length; i++) {
        if (!isSameTimestamp(lyricsData[i]?.time, currentLineTime)) break;
        activeIndices.add(i);
      }
    }

    if (primaryIsActive && activeIndices.size === 1) {
      const prevIdx = (idx > 0 && idx < lyricsData.length &&
        typeof lyricsData[idx]?.time === 'number' &&
        typeof lyricsData[idx - 1]?.time === 'number' &&
        (lyricsData[idx].time - lyricsData[idx - 1].time) <= 1.0
      ) ? (idx - 1) : -1;

      // 前の行が終わり時刻を持っているなら、光らせるかは下の
      // 「いま歌っているか」だけで決める。ここで足すと、この規則が
      // 効くのは他に光っている行が無い時だけなので、3行が重なる所で
      // 歌い終わった前の行が、他の行が終わった瞬間にもう一度光っていた。
      const prevLine = prevIdx >= 0 ? lyricsData[prevIdx] : null;
      const prevHasRange = Number.isFinite(prevLine?._dynamicRenderStartSec) &&
        Number.isFinite(prevLine?._dynamicRenderEndSec);
      if (prevIdx >= 0 && !prevHasRange) {
        // デュエットモードでduetSideが異なる行（メイン⇔サブ）は追加しない
        // （1文字追跡タイムスタンプ時にサブボーカルがダブる原因になるため）
        const currentSide = lyricsData[idx]?.duetSide;
        const prevSide = lyricsData[prevIdx]?.duetSide;
        const isDifferentDuetSide = currentSide && prevSide && currentSide !== prevSide;
        if (!isDifferentDuetSide) {
          const currentText = lyricCompareText(lyricsData[idx]);
          const prevText = lyricCompareText(lyricsData[prevIdx]);
          const sameDisplayedLyric = !!currentText && !!prevText && scoreLyricTextMatch(currentText, prevText) >= 100;
          if (!sameDisplayedLyric) activeIndices.add(prevIdx);
        }
      }
    }

    if (_hasDynamicRenderRanges) {
      lyricsData.forEach((line, lineIndex) => {
        if (activeIndices.has(lineIndex)) return;
        if (!isLineDynamicallyActiveAtTime(line, t)) return;
        activeIndices.add(lineIndex);
      });
    }

    if (activeIndices.size > 1) {
      const activeList = Array.from(activeIndices).sort((a, b) => a - b);
      activeList.forEach((activeIdx) => {
        const activeLine = lyricsData[activeIdx];
        if (activeLine?.duetSide !== 'right') return;

        const activeText = lyricCompareText(activeLine);
        if (!activeText) return;

        const hasMatchingLeft = activeList.some((otherIdx) => {
          if (otherIdx === activeIdx) return false;
          const otherLine = lyricsData[otherIdx];
          if (otherLine?.duetSide !== 'left') return false;
          // Dynamic LRC（1文字同期）の場合は行の開始時刻が最大5秒ずれる可能性があるため
          // 許容幅を動的に切り替える（通常LRCはDUET_DUPLICATE_TOLERANCE=1.0sのまま）
          const dedupeTol = (Array.isArray(dynamicLines) && dynamicLines.length > 0)
            ? 5.0
            : DUET_DUPLICATE_TOLERANCE;
          if (!isSameTimestamp(otherLine?.time, activeLine?.time, dedupeTol)) return false;

          const otherText = lyricCompareText(otherLine);
          return !!otherText && scoreLyricTextMatch(otherText, activeText) >= 100;
        });

        if (hasMatchingLeft) {
          activeIndices.delete(activeIdx);
        }
      });
    }
  }

  // 差分検出: 前回と同じアクティブ行セットなら、char更新以外をスキップ
  const activeChanged = activeIndices.size !== _previousActiveIndices.size ||
    [...activeIndices].some(i => !_previousActiveIndices.has(i));

  // 完全に変化のないフレームは行ループ自体をスキップ
  // （アクティブ行に1文字同期がある場合のみ毎フレームの更新が必要）
  const scrollPending = targets.some(c => idx !== (c._lastScrolledIndex ?? -1));
  if (!activeChanged && !scrollPending && !_activeRowsHaveCharSpans) {
    lastActiveIndex = idx;
    if (meaningPanelVisible) {
      syncMeaningPanelToPlayback(false, t);
    }
    return;
  }

  let sawActiveCharSpans = false;

  // 行の状態が変わっていないフレームでやることは、アクティブ行の塗り直しだけ。
  //
  // それでも今までは毎フレーム全行を走査していた。1曲 60〜100 行として
  // 秒 60 回、行ごとにクラス判定と past 判定が走る。歌詞が長い曲ほど重い。
  //
  // active の集合が変わらず、スクロールの追従も済んでいるなら、
  // 「どの行が past か」も前のフレームから変わらない(idx が動けば
  //  _lastScrolledIndex とずれて scrollPending が立つ)。塗る行だけ見る。
  const needsFullRowPass = activeChanged || scrollPending;

  targets.forEach(container => {
    const rows = container.children;
    if (rows.length === 0) return;

    if (!needsFullRowPass) {
      activeIndices.forEach(i => {
        const r = rows[i];
        if (!r || !r.classList.contains('lyric-line')) return;
        if (paintActiveLyricRow(r, t)) sawActiveCharSpans = true;
      });
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.classList.contains('lyric-line')) continue;
      const isActive = activeIndices.has(i);
      const isPrimary = (i === idx);
      // 歌い終わった行は active を外す(歌っていないのに光っていたら嘘)。
      // ただし past にはしない。past は不可視なので、次の行が始まるまでの
      // 間ずっと画面から歌詞が消える。
      //
      // 終わり時刻を持つのは文字同期の行だけなので、この差は「同期が細かい
      // 曲ほど画面が空になる」という逆転になっていた。実測: Dear
      // (Mrs. GREEN APPLE) は行間の空きが歌っている時間の6割あり
      // (歌 166秒 / 空き 101秒)、点いて消えて点いて消えて、に見えた。
      //
      // 次の行が始まれば idx が進み、この行は i < idx で past になる。
      // 消える時機が「自分が終わった時」から「次が始まる時」に変わるだけ。
      const isPast = idx >= 0 && !isActive && i < idx;
      // 値が同じでも classList への代入はスタイルの再計算対象になる。
      // 行数ぶん毎フレーム書いていたので、変わった時だけ触る。
      if (r._ytmIsPast !== isPast) {
        r._ytmIsPast = isPast;
        r.classList.toggle('lyric-past', isPast);
      }

      if (isActive) {
        // 状態遷移時のみクラス操作（active でなかった→active になった）
        if (activeChanged && !_previousActiveIndices.has(i)) {
          r.classList.add('active');
          if (r.classList.contains('has-translation')) {
            r.classList.add('show-translation');
          }
        }

        if (isPrimary && idx !== (container._lastScrolledIndex ?? -1)) {
          // 再描画直後・大幅シーク後は現在位置へ即時ジャンプ（0秒位置からの
          // ゆっくりスクロールを防ぐ）
          const scrollBehavior = container._instantNextScroll ? 'auto' : 'smooth';

          if (container === ui.lyrics) {
            // 見送る回で _instantNextScroll を消さない。消すと、次に動ける
            // ようになった時に 0 秒位置からゆっくり流れてしまう。
            if (isUserScrolling || _lyricsAutoFollowHold) continue;
            container._instantNextScroll = false;
            // 【通常再生画面】
            // getBoundingClientRect を使って要素の絶対位置から確実なスクロール量を計算
            const containerRect = container.getBoundingClientRect();
            const rRect = r.getBoundingClientRect();
            const targetScroll = container.scrollTop + rRect.top - lyricRowScrollOffset(r) - containerRect.top
              - lyricAnchorOffset(container, lyricRowAnchorHeight(r, rRect));

            isProgrammaticScrolling = true;
            clearTimeout(programmaticScrollTimeout);
            clearTimeout(programmaticScrollMaxTimeout);
            programmaticScrollTimeout = setTimeout(() => { isProgrammaticScrolling = false; }, 150);
            programmaticScrollMaxTimeout = setTimeout(() => { isProgrammaticScrolling = false; }, 1200);
            if (scrollBehavior === 'auto') suppressUserScrollDetection(300);

            requestLyricScroll(container, targetScroll, scrollBehavior === 'auto', idx);

            container._lastScrolledIndex = idx;
            if (idx !== _lastCountedLyricIndex) {
              _lastCountedLyricIndex = idx;
              ReplayManager.incrementLyricCount();
            }
          } else {
            // 【PIP（小窓）】
            if (container._isUserScrolling) continue;
            container._instantNextScroll = false;

            const containerRect = container.getBoundingClientRect();
            const rRect = r.getBoundingClientRect();
            // 止める位置は、行の真ん中を器の上から 35% の所。CSS で
            // --ytm-lyrics-anchor-top-lines を決めた形(動画モードの 2 行の帯)はそれに従う
            const anchorHeight = lyricRowAnchorHeight(r, rRect);
            const anchor = readLyricAnchorTopLines(container) === null
              ? (container.clientHeight * 0.35) - (anchorHeight / 2)
              : lyricAnchorOffset(container, anchorHeight);
            const targetScroll = container.scrollTop + rRect.top - lyricRowScrollOffset(r) - containerRect.top - anchor;

            container._isProgrammaticScrolling = true;
            requestLyricScroll(container, targetScroll, scrollBehavior === 'auto', idx);

            container._lastScrolledIndex = idx;
          }
        }

        if (paintActiveLyricRow(r, t)) sawActiveCharSpans = true;
      } else if (activeChanged && _previousActiveIndices.has(i)) {
        // 状態遷移: active→非active になった行のみリセット
        r.classList.remove('active');
        r.classList.remove('show-translation');

        if (r.classList.contains('ytm-word-sync')) {
          resetLyricWordRow(r);
          const bgHost = lyricBackgroundHost(r);
          if (bgHost) resetLyricWordRow(bgHost);
        } else {
          let charSpans = r._ytmCharSpans;
          if (!charSpans) charSpans = r._ytmCharSpans = Array.from(r.querySelectorAll('.lyric-char'));
          if (charSpans.length > 0) {
            charSpans.forEach(sp => {
              sp.classList.remove('char-active');
              sp.classList.add('char-pending');
            });
          }
        }
      }
    }
  });

  if (activeChanged) {
    _previousActiveIndices = new Set(activeIndices);
  }
  _activeRowsHaveCharSpans = sawActiveCharSpans;

  lastActiveIndex = idx;
  if (meaningPanelVisible) {
    syncMeaningPanelToPlayback(false, t);
  }
}

function setupPlayerBarBlankClickGuard() {
  const bar = PlayerBar.get();
  if (!bar || bar.dataset.ytmBlankClickGuard === '1') return;
  bar.dataset.ytmBlankClickGuard = '1';

  // 余白クリックがプレイヤーの開閉に繋がるのを防ぐ（ボタン/スライダー等は通常通り動かす）
  bar.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;

    // インタラクティブ要素は通す（閉じるボタンの逆三角もここに含まれる想定）
    if (
      t.closest('button, a, input, textarea, select, tp-yt-paper-icon-button, tp-yt-paper-button, tp-yt-paper-slider, ytmusic-like-button-renderer, ytmusic-toggle-button-renderer')
    ) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// ── 曲送り直後のメタデータの食い違い ─────────────────────────
// 曲送りを 1 フレームずつ追うと(実機)、URL とプレイヤーバーの曲名が先に
// 新しい曲になり、MediaSession(getMetadata が優先して読む)は 80ms 前後
// 遅れて追いつく。その間に tick が走ると「新しい videoId + 前の曲の題名・
// ジャケット」で曲の切り替えを 1 回やり、追いついた所でもう 1 回やって
// いた。1 回目で前の曲のジャケットを読み直して空白になり、歌詞の取得も
// 2 回目から数え直しになる。広告が挟まると 1 回目のまま止まり、前の曲の
// 題名に次の曲のアーティスト名が並んでいた。
// videoId が変わったのにプレイヤーバーと MediaSession の曲名が噛み合わない
// 間は、切り替えを少し待つ。バー側は「（feat. …）」を付けることがあるので
// 包含で見る。噛み合わないまま 1.5 秒たったら、従来どおり先へ進む。
const META_SETTLE_MAX_MS = 1500;
const LYRICS_LOAD_DEBOUNCE_MS = 250;
const META_SETTLE_RETRY_MS = 90;
let _metaSettleVideoId = '';
let _metaSettleSince = 0;
let _metaSettleTimer = null;
const normalizeTitleForSettle = (value) => String(value || '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/\s+/g, '');
const titlesAgree = (a, b) => {
  const x = normalizeTitleForSettle(a);
  const y = normalizeTitleForSettle(b);
  if (!x || !y) return true; // 片方が読めない時は判断しない
  return x.includes(y) || y.includes(x);
};
// 曲名もアーティスト名も空の MediaSession(広告の切り替わりで一瞬そうなる。
// 実機)も、まだ追いついていないとみなして同じだけ待つ。進めると空のまま
// 歌詞を問い合わせ、LRCHub は動画 ID が正しくても REQUIRED_TRACK_ARTIST で
// 断り、結果は「///」というキーでキャッシュに残っていた。
// 1.5 秒たっても空なら、従来どおり先へ進む。
const metadataIsBlank = (meta) => !String(meta?.title || '').trim() && !String(meta?.artist || '').trim();
const shouldWaitForSettledMetadata = (meta, videoId) => {
  if (metadataIsBlank(meta)) {
    const now = performance.now();
    // 曲名で待つ方(下)とは数え始めを分ける
    const settleId = `blank:${videoId || ''}`;
    if (_metaSettleVideoId !== settleId) {
      _metaSettleVideoId = settleId;
      _metaSettleSince = now;
    }
    if (now - _metaSettleSince >= META_SETTLE_MAX_MS) return false;
    clearTimeout(_metaSettleTimer);
    _metaSettleTimer = setTimeout(() => requestImmersionTick(), META_SETTLE_RETRY_MS);
    return true;
  }
  if (!videoId || videoId === (currentLyricsVideoId || '')) {
    _metaSettleVideoId = '';
    return false;
  }
  const barTitle = document.querySelector(PLAYER_BAR_TITLE_SELECTOR)?.textContent;
  if (titlesAgree(barTitle, meta.title)) {
    _metaSettleVideoId = '';
    return false;
  }
  const now = performance.now();
  if (_metaSettleVideoId !== videoId) {
    _metaSettleVideoId = videoId;
    _metaSettleSince = now;
  }
  if (now - _metaSettleSince >= META_SETTLE_MAX_MS) return false;
  // MediaSession が追いついてもプレイヤーバーは動かないので、自分で見直す
  clearTimeout(_metaSettleTimer);
  _metaSettleTimer = setTimeout(() => requestImmersionTick(), META_SETTLE_RETRY_MS);
  return true;
};

let _cachedLayoutEl = null;
// 監視(setupObserver)が組まれたら、その予約関数に差し替わる。
let requestImmersionTick = () => { void tick(); };

// IMMERSION ボタンの置き場所。YTM がプレイヤーバーの作りを変えても
// 入口が消えないよう、前から順に「画面に見えている」最初の所へ入れる。
// 以前は .right-controls-buttons 決め打ちで、これが無くなると
// ボタンが出ず、Immersion を開く手段がまるごと無くなっていた。
// 先頭は自前のバー(YTM のバーが押せない時だけ出る。出ていない間は
// 見えないので選ばれない)。
const MODE_TOGGLE_HOSTS = [
  ['#ytmi-fallback-bar .ytmi-fb-toggle-slot', 'append'],
  ['ytmusic-player-bar .right-controls-buttons', 'prepend'],
  ['.right-controls-buttons', 'prepend'],
  // 新バーは右の列の一番端(⋮ メニューの右)。PR #114 で neco222 さんが
  // 「IMMERSION の位置が悪いので一番右に寄せた」と提案した並び
  ['ytmusic-miniplayer .ytMusicMiniPlayerRightSection', 'append'],
  // 新バーは窓が狭いと、右の列の無い小さな作り(ジャケット・曲名・再生・次へ)
  // に変わる。その時は操作の並びの右端
  ['ytmusic-miniplayer .ytMusicSmallViewportMiniplayerControls', 'append'],
  ['ytmusic-player-bar .right-controls', 'prepend'],
  ['ytmusic-player-bar #right-controls', 'prepend'],
];
const MODE_TOGGLE_FLOATING_CLASS = 'ytm-mode-toggle-floating';
// 本来の置き場所(自前のバー、旧バーの .right-controls-buttons、
// 新バーの右側の列・狭い窓の操作の並び)以外にいる間は、見張りが
// 毎回選び直して、戻れる時に戻す。
const MODE_TOGGLE_PRIMARY_HOSTS = 5;
let _modeToggleAway = false;
// 場所を取っていても、YTM が visibility:hidden で隠していれば見えない
// (窓が狭いとプレイヤーページを開いている間、旧バーは 2 つとも visibility で
// 隠れる。場所だけで見ていたので、ボタンが隠れたバーの中に残って押せなかった)
const isShownOnScreen = (el) => !!el && el.isConnected && el.getClientRects().length > 0
  && getComputedStyle(el).visibility !== 'hidden';
// 見えていても、上に何かが被さっていれば押せない(Immersion の全面の層の
// 下に潜ったバー等)。その位置を押した時に当たるものが中にあるかで見る。
// 置き場所を調べる時、上に浮いている IMMERSION ボタンが被さっているのは数えない。
const isHitTestable = (el) => {
  if (typeof el.getBoundingClientRect !== 'function' || typeof document.elementsFromPoint !== 'function') return true;
  const r = el.getBoundingClientRect();
  // 空の置き場所(ボタンを入れる前の自前のバーの右端など)は測りようがない
  if (!r.width || !r.height) return true;
  const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2));
  const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
  const hit = document.elementsFromPoint(x, y).find(h => el.contains(h) || !h.closest('#my-mode-toggle'));
  if (!hit) return false;
  if (el.contains(hit)) return true;
  // 置き場所そのものが押下を下へ通す作り(新バーの右の列。空いた所は
  // シークバーへ通す)では、空いた所を測ると自分の親(バー)に当たる。
  // 外の層に覆われているのではないので押せるとみなす(以前はここで
  // 「押せない」と判定し、IMMERSION ボタンがバーから外れて浮いていた)
  return getComputedStyle(el).pointerEvents === 'none'
    && hit !== document.documentElement && hit !== document.body && hit.contains(el);
};
// 動画モードでは、YTM が操作の無い間バーをわざと隠して押せなくする。
// 設定「操作バーを自動で隠す」(bar-autohide.js)でも、マウスが下に無い間は隠す。
// その間に当たり判定をすると、ボタンが浮いて出ては戻るを繰り返すので測らない。
const barMayBeAutoHidden = () => !!moviemode || document.body.classList.contains('ytm-bar-autohide');
// 今まさにバーを隠している(動画モード、または自動で隠していてマウスが下に無い)。
// 自前のバーに切り替えるかの判断はこの間はしない。隠れたバーは押せないので、
// 当たり判定が続けて外れ、自前のバーが出ていた(動画から戻った後など、実機)
const barHiddenOnPurpose = () => !!moviemode
  || (document.body.classList.contains('ytm-bar-autohide') && !document.body.classList.contains('ytm-bar-peek'));
// 置き場所として使えるか。わざと隠れている間は visibility が hidden なので、
// 並んでいる(大きさがある)ことだけを見る。見えるかで見ていたので、隠れている
// 間に置き直すと、置き場所が無いことになって IMMERSION ボタンだけが浮いていた
const isUsableToggleSpot = (el) => (barMayBeAutoHidden()
  ? !!el && el.isConnected && el.getClientRects().length > 0
  : isShownOnScreen(el));

// 置く所を決める。見える候補が無い時は:
//  ・プレイヤーバーごと隠れている(まだ何も再生していない等) → 在る候補へ
//    (無ければ置かない)。誰も使えない時にボタンだけ浮いて出ないように。
//  ・プレイヤーバーは見えているのに置き場所が見えない/無い → 画面の隅に浮かせる。
//    バーへ直に足すのはやめた: バーの並べ方次第で見切れたり重なったりする。
//  ・プレイヤーバーが見つからない(要素名が変わった等) → 再生中なら浮かせる。
const pickModeToggleHost = () => {
  let firstExisting = null;
  for (let i = 0; i < MODE_TOGGLE_HOSTS.length; i++) {
    const [selector, how] = MODE_TOGGLE_HOSTS[i];
    // 使っているバーの中から。狭い窓の新バーのように同じ作りのバーが
    // 2 つ在ると、ページ全体で先に見つかるのは隠れている方になる
    const el = PlayerBar.query(selector);
    if (!el) continue;
    const primary = i < MODE_TOGGLE_PRIMARY_HOSTS;
    if (isUsableToggleSpot(el) && (barMayBeAutoHidden() || isHitTestable(el))) return { el, how, primary };
    if (!firstExisting) firstExisting = { el, how, primary };
  }
  // まだ何も再生していなければ、バーが隠れているのは普通なので浮かせない。
  // 再生中なのにバーが見えない(狭い窓のプレイヤーページ等)なら浮かせる
  const bar = PlayerBar.get();
  if (!isPlayingSomething() && (!bar || !isUsableToggleSpot(bar))) return firstExisting;
  return { el: document.body, how: 'float', primary: false };
};
const isPlayingSomething = () => {
  const v = document.querySelector('video');
  return !!(v && (v.currentSrc || v.src));
};

const placeModeToggle = (btn, host) => {
  const floating = host.how === 'float';
  _modeToggleAway = !host.primary;
  btn.classList.toggle(MODE_TOGGLE_FLOATING_CLASS, floating);
  if (floating) {
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
  } else if (btn.parentElement !== host.el) {
    if (host.how === 'prepend') host.el.prepend(btn);
    else host.el.appendChild(btn);
  }
};

// Immersion 中のナビバー(検索欄)を出すきっかけ。ナビバーは隠れている間
// 押下を通す(下の Immersion のボタンや歌詞を塞がない)ので、:hover では
// 出せない。カーソルがナビバーの高さ(上から NAV_PEEK_ZONE_PX)に入ったら
// 出す。ただし入った所が押せるもの(Immersion のボタン・曲 / 動画・歌詞の行)
// の上なら出さず、そのまま押せるようにする。以前は画面の一番上の細い帯に
// 乗せた時だけ出していて、際まで持っていかないと出ないと言われた。
// 出ている間はナビバー自身が押下を受け、:hover で出たままになる。
// 下へ NAV_PEEK_RELEASE_PX を越えたら引っ込める(CSS で一拍置いて消える)。
const NAV_PEEK_CLASS = 'ytmi-nav-peek';
const NAV_PEEK_ZONE_PX = 72;
const NAV_PEEK_RELEASE_PX = 96;
const NAV_PEEK_SKIP_SELECTOR = 'button, a[href], input, select, textarea, [role="button"], [role="slider"], ytmusic-av-toggle, .lyric-line';
let _navPeek = false;
const setNavPeek = (on) => {
  if (_navPeek === on) return;
  _navPeek = on;
  document.body.classList.toggle(NAV_PEEK_CLASS, on);
};
// 上の帯には Immersion のボタン(曲/動画の切り替え・動画モードのボタン列・
// 狭い窓の見出し)もある。そこへ向かう途中で帯を通っただけでナビバーが出て、
// ボタンの上に被さって押せなかった(実機: 縦長の窓で「動画」が押せない)。
//  ・帯に少し留まった時だけ出す(通り過ぎただけでは出さない)
//  ・出ている間も、ナビバーの下に Immersion のボタンがある所へ来たら引っ込める
const NAV_PEEK_DWELL_MS = 250;
let _navPeekTimer = null;
let _navPeekX = 0;
let _navPeekY = 0;
const clearNavPeekTimer = () => {
  if (_navPeekTimer) clearTimeout(_navPeekTimer);
  _navPeekTimer = null;
};
const immersionControlAt = (x, y) => document.elementsFromPoint(x, y)
  .some(el => !el.closest('ytmusic-nav-bar') && el.closest(NAV_PEEK_SKIP_SELECTOR));
// ナビバーは乗っている間(:hover)も出たままになる。狭い窓ではナビバーの
// 真下に曲/動画の切り替えがあり、引っ込めても乗ったままなので消えず、押すと
// ナビバーの「ログイン」に当たっていた(実機)。Immersion のボタンの上に来たら、
// ナビバーを透明・素通しにする(ytmi-nav-yield、style.css)。
const NAV_YIELD_CLASS = 'ytmi-nav-yield';
let _navYield = false;
const setNavYield = (on) => {
  if (_navYield === on) return;
  _navYield = on;
  document.body.classList.toggle(NAV_YIELD_CLASS, on);
};
const onNavPeekMove = (e) => {
  _navPeekX = e.clientX;
  _navPeekY = e.clientY;
  if (!document.body.classList.contains('ytm-custom-layout') || e.clientY > NAV_PEEK_RELEASE_PX) {
    clearNavPeekTimer();
    setNavPeek(false);
    setNavYield(false);
    return;
  }
  const overControl = immersionControlAt(e.clientX, e.clientY);
  setNavYield(overControl);
  if (_navPeek) {
    if (overControl) setNavPeek(false);
    return;
  }
  if (e.clientY > NAV_PEEK_ZONE_PX) {
    clearNavPeekTimer();
    return;
  }
  const target = e.target;
  if (target instanceof Element && !target.closest('ytmusic-nav-bar') && target.closest(NAV_PEEK_SKIP_SELECTOR)) {
    clearNavPeekTimer();
    return;
  }
  if (_navPeekTimer) return;
  _navPeekTimer = setTimeout(() => {
    _navPeekTimer = null;
    if (_navPeekY > NAV_PEEK_ZONE_PX || immersionControlAt(_navPeekX, _navPeekY)) return;
    setNavPeek(true);
  }, NAV_PEEK_DWELL_MS);
};
document.addEventListener('mousemove', onNavPeekMove, { passive: true });
// 窓の外へ出た(上のタブ等へ)ら引っ込める
document.documentElement.addEventListener('mouseleave', () => {
  clearNavPeekTimer();
  setNavPeek(false);
  setNavYield(false);
});

// ── Immersion を出すかどうか ──────────────────────────────
// config.mode は「プレイヤーページを Immersion で置き換える」の入切。
// 以前は「config.mode かつ ytmusic-app-layout に player-page-open が在る」の
// 時だけ出していた。YTM がこの属性をやめると、どの入口から押しても
// 何も起きなくなる。そこで
//  ・プレイヤーページが開いているか は、属性に加えて URL(/watch)でも見る。
//    URL は共有リンクにもなる公開の約束なので、画面の作り直しでは変わらない
//    (実機: 開くと /watch、畳むと元の閲覧ページの URL に戻る)
//  ・利用者がはっきり「開く」と押した時(ボタン・ツールバーのアイコン・
//    ショートカット)は、プレイヤーページの状態に関係なく出す
//  ・プレイヤーページを畳んだ(開→閉に変わった)時と、閲覧ページの上で
//    開いたまま別のページへ移った時は、明示の「開く」を取り消す。
//    状態そのものではなく変わり目で見るので、属性が無い作りでも
//    勝手に閉じたりしない
let _immersionManualOpen = false;
let _immersionManualHref = '';
let _lastPlayerPageOpen = null;
const readPlayerPageOpen = () => {
  const layout = _cachedLayoutEl && _cachedLayoutEl.isConnected
    ? _cachedLayoutEl
    : (_cachedLayoutEl = document.querySelector('ytmusic-app-layout'));
  if (layout && layout.hasAttribute('player-page-open')) return true;
  return location.pathname === '/watch';
};
const shouldShowImmersion = () => {
  const open = readPlayerPageOpen();
  if (_lastPlayerPageOpen === true && !open) _immersionManualOpen = false;
  _lastPlayerPageOpen = open;
  if (!config.mode) return false;
  if (open) return true;
  if (!_immersionManualOpen) return false;
  if (location.pathname + location.search !== _immersionManualHref) {
    _immersionManualOpen = false;
    return false;
  }
  return true;
};

// Immersion を出している印。html にも付ける(下のページのスクロールバーを消す)。
// CSS の :has() で body を見ると、文字同期の塗りを書くたびに HTML ごと
// 計算し直しになる(style.css の html.ytm-custom-layout-root)。
const setCustomLayoutClass = (shown) => {
  document.body.classList.toggle('ytm-custom-layout', shown);
  document.documentElement.classList.toggle('ytm-custom-layout-root', shown);
};

const applyImmersionShown = (shown) => {
  setCustomLayoutClass(shown);
  PlayerBar.check({ shown, skip: true });
  syncBarPlayerButton();
  // 操作バーを自動で隠す設定の時、開いた瞬間はバーの場所が分かるように少し出す
  if (typeof BarAutoHide !== 'undefined') BarAutoHide.syncImmersionShown(shown);
  // 閉じている間は歌詞のループを止めている(lyricLoopVisible)ので、開いたら回し直す
  if (shown) startLyricRafLoop();
  syncFluidBg();
  // 新バーの幅合わせ(右の列が収まる幅・時刻を隠すか)は、開いた時点で済ませる。
  // 見張り(0.6 秒後)まで待つと、閉じた時に外した幅のまま一度出てから
  // 広がり直し、閉じる/戻る・IMMERSION の二度押しで戻るたびにバーが組み替わって見えた
  balanceWizBar();
};

const setImmersionOpen = (open) => {
  config.mode = !!open;
  _immersionManualOpen = !!open;
  _immersionManualHref = open ? location.pathname + location.search : '';
  // ボタンの見た目(太字で幅が少し広がる)を先に変える。後にすると、
  // 下の幅合わせ(balanceWizBar)が変わる前の幅で測り、少し後の見張りで
  // バーがもう一度広がり直していた
  const btn = document.getElementById('my-mode-toggle');
  if (btn) btn.classList.toggle('active', config.mode);
  applyImmersionShown(shouldShowImmersion());
  // 動画モードの組み替えは #main-panel 等の YTM の作りに頼っている。
  // そこで失敗しても、開閉そのものは止めない。
  try {
    if (isYTMPremiumUser()) changeIModeUIWithMovieMode(config.mode);
  } catch (e) {
    console.warn('[YTM] 動画モードの切り替えに失敗', e);
  }
  // 動画モードではバーの幅の上限が変わるので、組み替えた後で測り直す
  balanceWizBar();
  // 閉じている間に曲が変わっていたら、開いた瞬間に今の曲へ合わせる。
  // このボタンは監視の対象外(#right-controls)なので、自分で頼まないと
  // 次にプレイヤーバーが動くまで(たいてい次の曲まで)前の曲が出ていた。
  requestImmersionTick();
  scheduleImmersionBarCheck();
};

// 出ていれば閉じ、出ていなければ開く。config.mode が入のまま
// プレイヤーページを畳んで隠れている時に押されたら、切るのではなく開く
// (以前は切れるだけで画面は何も変わらず、もう一度押す必要があった)。
const toggleImmersionMode = () => {
  setImmersionOpen(!document.body.classList.contains('ytm-custom-layout'));
};

// 自前のバーの ▼(プレイヤーを畳む)。Immersion を出している間はいつも
// 出し、押されたら使える中で一番よい方法で畳む。YTM の ▼ と同じく、
// Immersion の入切(config.mode)は残したまま隠す。
//  1. 閲覧ページの上で開いている → 明示の「開く」を取り消すだけ
//  2. YTM の「プレイヤーを畳む」ボタンを押す。見えていなくてもプログラム
//     からは押せる(実機: 旧バーの ▼、新バー(wiz)ではプレイヤーページの
//     「ミニプレーヤーを開く」。どちらも押すと畳まれ、再生は続く)
//  3. 押しても畳まれない・ボタンが無い → YTM の中に戻り先(/watch 以外の
//     ページ)があり、読み込み直さずに戻れるなら「戻る」。YTM はプレイヤー
//     ページを開く時に履歴を積み、戻ると畳む。曲のリンクから直接開いた時に
//     戻ると、YTM の外や読み込み直しになって再生が止まるので使わない
//  4. どれもできない → Immersion を閉じる
// 新バーの畳むボタンはプレイヤー(ytmusic-player)の中。動画モードの
// Immersion はプレイヤーを自分の入れ物(#ytm-custom-wrapper)へ移し、閉じた
// 後もそこに残るので、ytmusic-player-page の中だけを探すと見つからない。
// 窓が狭い時は、プレイヤーページの左上の「プレーヤー ページを最小化」
// (#collapse-button)で畳む作りで、ほかのボタンは描かれず押しても効かない
// (広い窓ではその逆)。描かれているものを先に使う
const YTM_COLLAPSE_SELECTORS = [
  'ytmusic-player-page #collapse-button',
  'ytmusic-player-bar[data-ytmi-bar] .toggle-player-page-button',
  'ytmusic-player-bar .toggle-player-page-button',
  'ytmusic-player#player .player-minimize-button',
];
const findYtmCollapseButton = () => {
  let fallback = null;
  for (const selector of YTM_COLLAPSE_SELECTORS) {
    const host = document.querySelector(selector);
    if (!host) continue;
    const btn = host.querySelector('button') || host;
    if (host.getClientRects().length) return btn;
    if (!fallback) fallback = btn;
  }
  return fallback;
};
const canGoBackInApp = () => {
  const nav = window.navigation;
  const entry = nav && nav.currentEntry;
  if (!entry || !nav.canGoBack || typeof nav.entries !== 'function') return false;
  const prev = nav.entries()[entry.index - 1];
  // ページごと読み込み直す戻り方だと、再生が止まる
  if (!prev || !prev.url || prev.sameDocument === false) return false;
  try {
    const url = new URL(prev.url);
    return url.origin === location.origin && url.pathname !== '/watch';
  } catch (e) {
    return false;
  }
};
const canMinimizeImmersion = () => document.body.classList.contains('ytm-custom-layout');
const MINIMIZE_CONFIRM_MS = 700;
// Immersion を切ってプレイヤーページを開いている時も、バーの ▼ から畳む
// (新バーには YTM の畳むボタンがバーに無い。下の syncBarMinimize)
const minimizeImmersion = () => {
  const shown = canMinimizeImmersion();
  const open = readPlayerPageOpen();
  if (!shown && !open) return;
  if (!open) {
    _immersionManualOpen = false;
    applyImmersionShown(shouldShowImmersion());
    requestImmersionTick();
    return;
  }
  const fallback = () => {
    if (!readPlayerPageOpen()) return;
    if (canGoBackInApp()) history.back();
    else if (canMinimizeImmersion()) setImmersionOpen(false);
  };
  const btn = findYtmCollapseButton();
  if (!btn) {
    fallback();
    return;
  }
  btn.click();
  requestImmersionTick();
  setTimeout(fallback, MINIMIZE_CONFIRM_MS);
};

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type !== 'YTMI_IMMERSION') return;
  if (msg.action === 'open') setImmersionOpen(true);
  else toggleImmersionMode();
});

// 開いた直後にバーが本当に押せるかを確かめる。整える CSS の切り替わりと
// YTM 側の描き直しを待ってから、2 回続けて押せなければ自前のバーを出す。
let _barCheckTimers = [];
const scheduleImmersionBarCheck = () => {
  _barCheckTimers.forEach(clearTimeout);
  _barCheckTimers = [600, 1400].map(ms => setTimeout(runImmersionBarCheck, ms));
};
const runImmersionBarCheck = () => {
  if (document.hidden) return;
  const shown = document.body.classList.contains('ytm-custom-layout');
  // 動画モード・自動で隠す設定では、バーをわざと隠している。その間は判断しない
  const changed = PlayerBar.check({ shown, skip: barHiddenOnPurpose() });
  if (changed) ensureModeToggle(true);
  if (PlayerBar.isFallbackOn()) PlayerBar.syncMinimize();
  balanceWizBar();
};

// 置き場所が CSS で隠された(要素は残っている)ことは、見張りでは測らず
// ブラウザに知らせてもらう。見えなくなった時だけ置き場所を選び直す。
// プレイヤーバーごと隠れた時も知らせは来るが、その時は選び直しても
// 同じ所に留まる(pickModeToggleHost)。
let _modeToggleVisibilityObserver = null;
const watchModeToggleVisibility = (btn) => {
  if (typeof IntersectionObserver !== 'function') return;
  _modeToggleVisibilityObserver?.disconnect();
  _modeToggleVisibilityObserver = new IntersectionObserver((entries) => {
    if (entries.some(e => !e.isIntersecting)) ensureModeToggle(true);
  });
  _modeToggleVisibilityObserver.observe(btn);
};

// tick からは recheck=false で呼ぶ(ボタンが在れば状態を合わせるだけ。
// 変化のたびに位置を測ると重い)。置き場所の見直しは見張り(recheck=true)が行う。
const ensureModeToggle = (recheck) => {
  let btn = document.getElementById('my-mode-toggle');
  if (btn && btn.isConnected && !recheck) {
    const isActive = btn.classList.contains('active');
    if (config.mode !== isActive) btn.classList.toggle('active', config.mode);
    syncBarMinimize(btn);
    return btn;
  }
  const host = pickModeToggleHost();
  if (!host) return btn;
  if (!btn) {
    btn = createEl('button', 'my-mode-toggle', '', 'IMMERSION');
    btn.type = 'button';
    btn.onclick = toggleImmersionMode;
    watchModeToggleVisibility(btn);
  }
  btn.classList.toggle('active', !!config.mode);
  // 見える置き場所に収まっていれば、より前の候補が現れた時だけ移す。
  // 浮いている・外れている・置き場所ごと隠れた時は、選んだ所へ置き直す。
  const parent = btn.parentElement;
  const settled = btn.isConnected && !btn.classList.contains(MODE_TOGGLE_FLOATING_CLASS)
    && isUsableToggleSpot(parent);
  if (!settled || (host.how !== 'float' && host.el !== parent)) placeModeToggle(btn, host);
  syncBarMinimize(btn);
  return btn;
};

// YTM のバーに並べる ▼(プレイヤーを閉じる)/ ▲(プレイヤーを開く)。
// 旧バーには YTM の「プレーヤー ページを閉じる/開く」がバーの中に在るが、
// 新バー(ytmusic-miniplayer)には無い。新バーで畳むボタン(ミニプレーヤーを
// 開く)はプレイヤーの上端に在り、Immersion の下に隠れるので、Immersion を
// 開くと閉じる手段が見えなくなっていた。開くボタン(プレーヤー ページを開く)
// は右下の小さな動画に乗せた時だけ出るので、閉じた後に戻る手段が見つからない
// と報告があった。YTM の開閉ボタンが無いバーでは IMMERSION の右に出す:
//  ・Immersion を出している間 → ▼。押すと畳む(minimizeImmersion)
//  ・プレイヤーページを畳んで何か再生している間 → ▲。押すと開く
// 自前のバーは自分の ▼ を持ち、浮いている IMMERSION には並べない。
const BAR_MINIMIZE_ID = 'ytmi-bar-minimize';
const BAR_PLAYER_ICONS = {
  close: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 10 5 5 5-5"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 14 5-5 5 5"/></svg>',
};
const BAR_PLAYER_LABELS = { close: 'fb_minimize', open: 'fb_open_player' };
// YTM の「プレーヤー ページを開く」。見えていなくてもプログラムからは押せる
// (右下の小さな動画に乗せた時だけ出るボタン)。畳むボタンと同じく、
// プレイヤーが Immersion の入れ物に移っていても見つかるように探す
const findYtmExpandButton = () => {
  const host = document.querySelector('ytmusic-player#player .player-maximize-button');
  return host ? (host.querySelector('button') || host) : null;
};
// ▲: YTM の開くボタンを押す。押しても開かなければ、Immersion が入なら
// 閲覧ページの上に出す(IMMERSION ボタンと同じ)
const openPlayerFromBar = () => {
  const btn = findYtmExpandButton();
  if (btn) btn.click();
  requestImmersionTick();
  setTimeout(() => {
    if (readPlayerPageOpen() || document.body.classList.contains('ytm-custom-layout')) return;
    if (config.mode) setImmersionOpen(true);
  }, btn ? MINIMIZE_CONFIRM_MS : 0);
};
const barPlayerAction = (toggle) => {
  if (!toggle.isConnected || toggle.classList.contains(MODE_TOGGLE_FLOATING_CLASS)
    || toggle.closest('#ytmi-fallback-bar')) return null;
  const bar = PlayerBar.get();
  if (!bar || !bar.contains(toggle) || bar.querySelector('.toggle-player-page-button')) return null;
  // Immersion を切ってプレイヤーページを開いている時も ▼ を出す。新バーの
  // YTM の畳むボタンは動画の上に乗せた時だけ出るので、曲を大きく出して
  // いる間に閉じる手段が見当たらない、と報告があった
  if (canMinimizeImmersion() || readPlayerPageOpen()) return 'close';
  if (isPlayingSomething()) return 'open';
  return null;
};
const syncBarMinimize = (toggle) => {
  let el = document.getElementById(BAR_MINIMIZE_ID);
  const act = barPlayerAction(toggle);
  if (!act) {
    if (el) {
      el.remove();
      balanceWizBar();
    }
    return;
  }
  if (!el) {
    el = createEl('button', BAR_MINIMIZE_ID, '', '');
    el.type = 'button';
    el.onclick = () => {
      if (el.dataset.act === 'open') openPlayerFromBar();
      else minimizeImmersion();
    };
  }
  if (el.dataset.act !== act) {
    el.dataset.act = act;
    el.innerHTML = BAR_PLAYER_ICONS[act];
  }
  const text = t(BAR_PLAYER_LABELS[act]);
  if (el.title !== text) {
    el.title = text;
    el.setAttribute('aria-label', text);
  }
  if (toggle.nextElementSibling !== el) {
    toggle.after(el);
    balanceWizBar();
  }
};
// ▼▲ を今の状態にすぐ合わせる。Immersion の出し入れとプレイヤーページの
// 開閉の時に呼ぶ。tick の中では ▼▲ を合わせた後に Immersion の出し入れが
// 変わるので、それだけでは開閉の直後に前の状態のまま残り、次のきっかけ
// (見張りなら最大 1.5 秒後)まで ▼ が出ない・閉じた後も ▼ が残っていた
function syncBarPlayerButton() {
  const toggle = document.getElementById('my-mode-toggle');
  if (toggle) syncBarMinimize(toggle);
}

// ── 新バーの再生ボタンを真ん中に保つ ──
// 新バーは「左 1fr・中 auto・右 1fr」の 3 列で、右の列は中身より狭くしない
// (style.css)。Immersion では右の列に時刻・字幕・音量・⋮ と IMMERSION・▼ が
// 並び、幅 1000px のバーの 1 列分(約 290px)に収まらない。溢れた分だけ右の
// 列が広がり、再生ボタンが左へずれていた(1440px 幅で 14px、900px 幅で 86px)。
// 中身は曲で変わる(字幕ボタンの有無・時刻の桁)ので、測って決める:
//  1. 右の列が左右どちらの列にも収まる幅まで、バーを広げる(画面の 95% まで)
//  2. それでも足りなければ時刻を隠す(YTM も狭い窓では隠している)
//  3. まだ足りなければ、バーの左右の余白と列の間を詰める(style.css の
//     data-ytmi-bar-tight。詰めた分は WIZ_TIGHT_* と同じ値)
//  窓がもっと狭いと、それでも少しずれる(以前の半分ほど)
// 左の列は Immersion では何も出さないので、どちらの列も 1fr のまま同じ幅になる
const WIZ_TIGHT_GAP = 8;
const WIZ_TIGHT_PADDING = 16;
let _wizTimeWidth = 92;
// 詰める前の余白と列の間(詰めている間は測れないので、最後に測った値)
let _wizLooseSpacing = null;
const balanceWizBar = () => {
  const bar = PlayerBar.current();
  if (!bar) return;
  const clear = () => {
    if (bar.style.getPropertyValue('--ytmi-bar-need')) bar.style.removeProperty('--ytmi-bar-need');
    if (bar.hasAttribute('data-ytmi-hide-time')) bar.removeAttribute('data-ytmi-hide-time');
    if (bar.hasAttribute('data-ytmi-bar-tight')) bar.removeAttribute('data-ytmi-bar-tight');
  };
  const shown = document.body.classList.contains('ytm-custom-layout');
  const right = shown && PlayerBar.variant() === 'wiz' && bar.querySelector(':scope > .ytMusicMiniPlayerRightSection');
  const mid = right && bar.querySelector(':scope > .ytMusicMiniPlayerMiddleSection');
  if (!mid || !mid.getClientRects().length || !right.getClientRects().length) {
    clear();
    return;
  }
  const outer = (el) => {
    const cs = getComputedStyle(el);
    return el.getBoundingClientRect().width + (parseFloat(cs.marginLeft) || 0) + (parseFloat(cs.marginRight) || 0);
  };
  const time = right.querySelector(':scope > .ytMusicMiniPlayerTimeInfo');
  // こちらが隠した時刻は、最後に見えていた時の幅で数える。狭い窓の
  // 決まり(style.css の @media)で隠れている時刻は、無いものとして数える
  const hiddenByUs = bar.hasAttribute('data-ytmi-hide-time');
  const rowGap = parseFloat(getComputedStyle(right).columnGap) || 0;
  let rest = 0;
  let count = 0;
  let timeAvailable = false;
  for (const el of right.children) {
    if (el === time) {
      if (el.getClientRects().length) {
        _wizTimeWidth = outer(el);
        timeAvailable = true;
      } else if (hiddenByUs) {
        timeAvailable = true;
      }
      continue;
    }
    if (!el.getClientRects().length) continue;
    rest += outer(el);
    count++;
  }
  rest += rowGap * Math.max(0, count - 1);
  const withTime = rest + (count ? rowGap : 0) + _wizTimeWidth;
  const bcs = getComputedStyle(bar);
  const tightNow = bar.hasAttribute('data-ytmi-bar-tight');
  if (!tightNow || !_wizLooseSpacing) {
    _wizLooseSpacing = {
      padding: (parseFloat(bcs.paddingLeft) || 0) + (parseFloat(bcs.paddingRight) || 0),
      gap: parseFloat(bcs.columnGap) || 0,
    };
  }
  const border = (parseFloat(bcs.borderLeftWidth) || 0) + (parseFloat(bcs.borderRightWidth) || 0);
  const core = border + mid.getBoundingClientRect().width;
  const loose = core + _wizLooseSpacing.padding + _wizLooseSpacing.gap * 2;
  const tight = core + Math.min(_wizLooseSpacing.padding, WIZ_TIGHT_PADDING * 2)
    + Math.min(_wizLooseSpacing.gap, WIZ_TIGHT_GAP) * 2;
  const cap = window.innerWidth * (bar.classList.contains('moviemode') ? 0.98 : 0.95);
  const hideTime = timeAvailable && loose + withTime * 2 > cap;
  const side = timeAvailable && !hideTime ? withTime : rest;
  const useTight = loose + side * 2 > cap;
  const need = `${Math.ceil((useTight ? tight : loose) + side * 2) + 2}px`;
  if (bar.style.getPropertyValue('--ytmi-bar-need') !== need) bar.style.setProperty('--ytmi-bar-need', need);
  if (hideTime !== hiddenByUs) bar.toggleAttribute('data-ytmi-hide-time', hideTime);
  if (useTight !== tightNow) bar.toggleAttribute('data-ytmi-bar-tight', useTight);
};

const tick = async () => {
  // Update PIP window state (throttled to once per second)
  if (PipManager && PipManager.pipWindow) {
    const now = performance.now();
    if (now - _lastLikeCheckTime > 1000) {
      _lastLikeCheckTime = now;
      PipManager.updateLikeState();
    }
  }

  const adPlaying = isAdPlayingNow() || !!document.querySelector('.ad-interrupting, .ad-showing');
  setAdPlayingState(adPlaying);
  if (adPlaying) return;

  ensureModeToggle(false);
  markMoviePlayerPath();

  const wasShown = document.body.classList.contains('ytm-custom-layout');
  const immersionShown = shouldShowImmersion();
  if (immersionShown !== wasShown) scheduleImmersionBarCheck();
  // PiP は Immersion の外でも見え続ける。Immersion を閉じたりプレイヤーを
  // 畳んだりした後も、曲の切り替わりと歌詞の取得だけはここで続ける。
  // 以前はこの先へ進まなかったので、PiP に前の曲の題名と歌詞が残り、
  // 前の曲の歌詞を新しい曲の再生位置で光らせていた。
  // 器(ui.*)は PiP を開いた時点で組まれている。
  const followForPip = !immersionShown && !!(PipManager && PipManager.pipWindow) && !!ui.lyrics;
  if (!immersionShown) {
    if (wasShown) applyImmersionShown(false);
    if (typeof LyricCard !== 'undefined') LyricCard.cancel();
    if (!followForPip) {
      // Immersion を閉じている間は再生位置を追えていない。
      // 次に開いた時、曲の切り替わりを見ていたことにしてはいけない。
      _wasTrackingPlayback = false;
      return;
    }
  } else {
    if (!wasShown) applyImmersionShown(true);
    initLayout();
    setupPlayerBarBlankClickGuard();
  }
  if (immersionShown && !_slidersPatched) {
    const sliders = document.querySelectorAll('ytmusic-player-bar .middle-controls tp-yt-paper-slider');
    if (sliders.length > 0) {
      sliders.forEach(s => {
        try {
          s.style.boxSizing = 'border-box';
          s.style.paddingLeft = '20px';
          s.style.paddingRight = '20px';
          s.style.minWidth = '0';
          s.style.cursor = 'pointer';
        } catch (e) { }
      });
      _slidersPatched = true;
    }
  }

  const meta = getMetadata();
  if (!meta) return;
  if (shouldWaitForSettledMetadata(meta, getCurrentVideoId() || '')) return;
  // 「直前の tick でも追えていたか」を、フラグを更新する前に控える
  const wasTrackingBefore = _wasTrackingPlayback;
  _wasTrackingPlayback = true;
  const key = `${meta.title}///${meta.artist}`;
  const videoId = getCurrentVideoId() || '';

  if (currentKey !== key || (currentLyricsVideoId || '') !== videoId) {
    // 初回ロード（曲の途中から開いた場合など）は再生位置のリセットを待たない
    const isInitialLoad = (currentKey === null);

    // クラウド同期。曲が変わるたびに全履歴を送ると通信量が跳ねるので、
    // 前回から一定時間空いた時だけ走らせる(間隔は CloudSync 側)。
    if (currentKey !== null && CloudSync && typeof CloudSync.syncIfDue === 'function') {
      CloudSync.syncIfDue();
    }

    const v = document.querySelector('video');
    const currentTime = v ? v.currentTime : 0;
    const duration = v ? v.duration : 0;


    // timeOffset = 現在の曲が始まった video 時間（曲内ローカル時間 = currentTime - timeOffset）。
    // YTM の連続再生では曲が変わっても video の currentTime が 0 にリセットされず
    // そのまま進み続けることがある。その場合、新曲が始まった時点の currentTime を
    // offset として引くことで曲内の正しい再生位置を得る。
    //  ・初回ロード（最初の曲 / 途中再生）は offset 不要（currentTime がそのまま曲内時間）
    //  ・リセット再生（currentTime が 0 に戻る）の場合は RAF ループ側で offset を自動解除
    //  ・Immersion を曲の途中で開いた場合は、この時点の currentTime は
    //    「新しい曲が始まった video 時間」ではなく「今聴いている位置」。
    //    これを offset にすると曲内時間が 0 に潰れ、歌詞が頭から流れてしまう
    //    (シークしてから Immersion を開くとズレる、という不具合の原因)。
    //    直前まで実際に再生を追えていた時だけ、連続再生の補正を適用する。
    const sawTransition = wasTrackingBefore && !isInitialLoad;
    if (!sawTransition) {
      timeOffset = 0;
    } else if (Number.isFinite(currentTime) && currentTime >= 5) {
      timeOffset = currentTime;
    } else {
      timeOffset = 0;
    }

    if (!config.saveSyncOffset) {
      if (isFirstSongDetected) {
        isFirstSongDetected = false;
      } else {
        const offsetInput = document.getElementById('sync-offset-input');
        if (offsetInput) {
          offsetInput.value = 0;
        }
        config.syncOffset = 0;
        storage.set('ytm_sync_offset', 0);
      }
    } else {
      isFirstSongDetected = false;
    }

    clearLyricsLateRetry();

    // 歌詞カードで前の曲の行を選んでいたら、やめる
    if (typeof LyricCard !== 'undefined') LyricCard.cancel();
    currentKey = key;
    currentLyricsVideoId = videoId;
    activeLyricsRequestId = null;
    currentLyricsResultPriority = 0;
    currentLyricsQuality = 0;
    currentLyricsSource = null;
    lyricsApplyEpoch += 1;
    summaryButtonAttentionKey = null;
    lyricsData = [];
    animatedCaptionData = null;
    animatedCaptionFrameKey = '';
    document.body.classList.remove('ytm-animated-caption-mode');
    dynamicLines = null;
    duetSubDynamicLines = null;
    _duetExcludedTimes = new Set();
    singerMetadataRequestSequence += 1;
    singerMetadataRequestKey = '';
    currentSingerMetadataKey = '';
    currentLyricsRecordId = null;
    currentSingerMetadata = null;
    currentSingerCanonicalLyrics = '';
    lyricsCandidates = null;
    selectedCandidateId = null;
    lyricsRequests = null;
    lyricsConfig = null;
    lyricsLockState = null;
    lyricsTranslationMap = {};
    setLyricsMeaningData(null);
    hideMeaningSummaryPopup();
    lastActiveIndex = -1;
    _previousActiveIndices.clear();
    _lastCountedLyricIndex = -1;
    if (ui.lyrics) ui.lyrics._lastScrolledIndex = -1;
    if (PipManager && PipManager.pipLyricsContainer) {
      PipManager.pipLyricsContainer._lastScrolledIndex = -1;
    }
    isUserScrolling = false;
    if (userScrollTimeout) clearTimeout(userScrollTimeout);
    if (ui.lyrics) ui.lyrics.classList.remove('ytm-user-browsing-lyrics');
    isProgrammaticScrolling = false;
    if (programmaticScrollTimeout) clearTimeout(programmaticScrollTimeout);
    if (programmaticScrollMaxTimeout) clearTimeout(programmaticScrollMaxTimeout);
    // 曲切替処理が走ったので巻き戻り検出の基準をリセットし、
    // この後の scrollTop=0 / innerHTML 差し替えによる scroll イベントを
    // ユーザースクロールとして誤検出しないようにする
    _lastRafPlaybackTime = -1;
    // YTM が video 要素を差し替えた場合に古い参照を使い続けないようにする
    _cachedVideoEl = null;
    suppressUserScrollDetection(900);

    if (ui.queuePanel && ui.queuePanel.classList.contains('visible')) {
      QueueManager.onSongChanged();
    }

    updateMetaUI(meta);
    preferLyricsDefault(key);

    // PIPウィンドウのメタデータと歌詞表示をリセット
    if (PipManager) {
      // アーティスト名は Immersion と同じ表記にする(updateMetaUI が直前に置いた名前)
      PipManager.updateMeta(shownTitleFor(meta), (ui.artist && ui.artist.textContent) || meta.artist);
      PipManager.syncVideoMode();
      PipManager.resetLyrics(); // ここで歌詞を一旦消す
      // Schedule a delayed update check to ensure player bar DOM is fully updated by YTM
      setTimeout(() => {
        if (PipManager && PipManager.pipWindow) {
          PipManager.updateLikeState();
        }
      }, 1000);
    }

    refreshCandidateMenu();
    refreshLockMenu();
    resetLyricScrollState(ui.lyrics);
    setTimeout(() => {
      // この間に次の曲の切り替えを済ませていたら、そちらに任せる
      if (currentKey !== key || (currentLyricsVideoId || '') !== videoId) return;
      const metaNow = getMetadata() || meta;
      const keyNow = `${metaNow.title}///${metaNow.artist}`;
      if ((getCurrentVideoId() || '') !== videoId || keyNow !== key) {
        // 待つ間に曲名か動画が変わった。読み込み直した直後に広告が始まると、
        // 曲名がこの 250ms の間に広告のものに変わる(実機)。ここでやめるだけ
        // だと、広告が終わって曲名が元に戻った時に tick は「同じ曲のまま」と
        // 見て取り直さず、歌詞が Loading... のまま止まっていた。
        // 切り替えを済ませていないことにして、次の tick で改めて扱わせる
        // (広告の間は tick が待つので、終わってから取りに行く)。
        currentLyricsVideoId = null;
        requestImmersionTick();
        return;
      }
      loadLyrics(metaNow);
      startLyricRafLoop();
      // 以前は 800ms 待っていた。メタデータの食い違いは上で待つようにしたので、
      // ここは連打で途中の曲をいちいち取りに行かないための間だけでよい。
      // 先読み済みの曲でも毎回 1.5 秒ほど歌詞が空になっていた(実機)。
    }, LYRICS_LOAD_DEBOUNCE_MS);
  } else {
    if (meta.src && meta.src !== _artworkSrcShown) {
      // 同じ曲のままジャケットだけ変わった(動画→曲で MV のサムネイルが残っていた)
      updateArtworkUI(meta);
    }
    // 縦長の窓で名前だけになっていたアーティスト名を、リンクに戻す
    if (_artistLinkPendingKey === currentKey && barHasArtistLinks()) updateArtistLink(meta);
  }
};

// 背景に使う画像の読み込み世代。
// 曲が変わっても前の画像の読み込みは止まらない(DOM から外しても onload は
// 発火する)。前の画像が遅れて読み終わると、新しい背景を古いもので塗り潰す。
// アートワーク本体は replaceChildren で即座に入れ替わるので、
// 「背景だけ前の曲のまま」になる。世代を持たせて古い分を捨てる。
let _bgLoadToken = 0;

// ── 明るいジャケットでも歌詞を読めるようにする ─────────────────
// 背景はジャケットをぼかして一律に暗くしている(--ytm-bg-brightness)。
// 一律なので、明るいジャケットほど背景が明るく残り、白い歌詞が沈む。
// 実機で測った背景の輝度と、白文字とのコントラスト比:
//   アイドル(暗い)   背景 0.026 → いまの行 13.8:1、次の行(不透明度 0.3) 4.8:1
//   夜に駆ける(淡い桃) 背景 0.196 → いまの行 4.3:1、 次の行 2.0:1
// ジャケットの平均輝度を測り、既定の明るさで背景がこの目安を超える時だけ
// さらに暗くする。暗いジャケットは今までどおり。設定の明るさはこの上から
// 掛かるので、利用者が明るくすればそのぶん明るくなる。
const BG_TARGET_LUMINANCE = 0.07;
const BG_MIN_ART_DIM = 0.45;
const srgbChannelToLinear = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const measureArtworkLuminance = (ctx, size) => {
  const data = ctx.getImageData(0, 0, size, size).data;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum += 0.2126 * srgbChannelToLinear(data[i])
      + 0.7152 * srgbChannelToLinear(data[i + 1])
      + 0.0722 * srgbChannelToLinear(data[i + 2]);
  }
  return sum / (data.length / 4);
};
// brightness() は色の値(sRGB)に掛かるので、輝度では約 2.2 乗で効く。
const artworkDimFor = (luminance) => {
  if (!Number.isFinite(luminance) || luminance <= 0) return 1;
  const expected = luminance * Math.pow(DEFAULT_BG_BRIGHTNESS, 2.2);
  if (expected <= BG_TARGET_LUMINANCE) return 1;
  return Math.max(BG_MIN_ART_DIM, Math.pow(BG_TARGET_LUMINANCE / expected, 1 / 2.2));
};
const applyArtworkDim = (luminance) => {
  document.documentElement.style.setProperty('--ytm-bg-art-dim', artworkDimFor(luminance).toFixed(3));
  PipManager.syncBackgroundBrightness();
  if (typeof FluidBg !== 'undefined') FluidBg.redraw();
};
const ARTWORK_SWAP_MAX_WAIT_MS = 1500;

// ボタン列の名前(ホバーで出る説明と読み上げ用の名前)。表示言語を
// 変えたら付け直す。
function applyButtonLabels() {
  // 作った後で表示言語が変わる文字(歌詞のメニュー・Daily Replay の下のボタン)
  document.querySelectorAll('[data-ytm-text]').forEach((el) => { el.textContent = t(el.dataset.ytmText); });
  document.querySelectorAll('[data-ytm-title]').forEach((el) => {
    const label = t(el.dataset.ytmTitle);
    el.title = label;
    el.setAttribute('aria-label', label);
  });
  if (!ui.btnArea) return;
  ui.btnArea.querySelectorAll('[data-ytm-label]').forEach((btn) => {
    const label = t(btn.dataset.ytmLabel);
    btn.title = label;
    btn.setAttribute('aria-label', label);
  });
  if (ui.appBtnArea) ui.appBtnArea.setAttribute('aria-label', t('btn_group_app'));
}

// 曲名も歌詞と同じ切れ目で折り返す。「最後に階段を駆け上がったのは
// いつだ？」のような長い曲名は、字の単位で折り返すと語の途中で2行目に
// 落ちる。歌詞のような inline-block の塊にすると、狭い画面の1行表示で
// 省略記号(…)が効かなくなるので、切ってよい所に <wbr> を置き、
// それ以外は keep-all で折り返させない。1行表示では <wbr> は効かない。
function setTitleText(el, title) {
  const text = String(title ?? '');
  const cuts = budouxPhraseBoundaries(text);
  el.classList.toggle('ytm-title-phrased', !!cuts);
  if (!cuts) {
    el.textContent = text;
    return;
  }
  el.textContent = '';
  let from = 0;
  for (const to of [...cuts, text.length]) {
    if (from) el.appendChild(document.createElement('wbr'));
    el.appendChild(document.createTextNode(text.slice(from, to)));
    from = to;
  }
}

// アーティスト名の出どころ。旧バーは「アーティスト • アルバム • 年」の
// yt-formatted-string、新バーは ytmusic-track-info の ytmusicTrackInfoByline。
// 新バーの窓が狭い時は同じバーが 2 つになるので、使っている方から探す
const ARTIST_BYLINE_SELECTOR = 'yt-formatted-string.byline.complex-string, .ytmusicTrackInfoByline';
// バーの byline。PlayerBar.query はバーに無ければ文書全体から探すので、
// キューの行(ytmusic-player-queue-item の byline も同じ class)を拾うことが
// ある。それは別の曲のアーティスト名なので使わない
const queryBarByline = () => {
  const el = PlayerBar.query(ARTIST_BYLINE_SELECTOR);
  return el && !(typeof el.closest === 'function' && el.closest('ytmusic-player-queue-item')) ? el : null;
};
// 新バーのリンクは href を持たない <a role="button"> で、押すと YTM が中で
// 移動する(実機)。旧バーのように href(channel/…)で拾うと何も拾えず、
// Immersion のアーティスト名がただの文字になって押しても飛ばなかった。
// アルバム名も同じ形のリンクなので、最初の「•」より前のリンクだけを
// アーティストとして取る(例: 「A、B、C • アルバム • 2013年」)
const readWizArtistLinks = (byline) => {
  if (!byline || !byline.classList.contains('ytmusicTrackInfoByline')) return [];
  const host = byline.querySelector('.ytAttributedStringHost') || byline;
  const links = [];
  for (const node of host.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE && node.matches('a.ytAttributedStringLink')) {
      links.push(node);
    } else if ((node.textContent || '').includes('•')) {
      break;
    }
  }
  return links;
};
// 押された時に、今のバーの同じリンクを押す。曲が変わるとバーの中身は
// 作り直されるので、控えた要素ではなく名前(無ければ順番)で探し直す。
// YTM のバーで押した時と同じく、プレイヤーを畳んでアーティストのページへ移る
const openWizArtist = (name, index) => {
  const links = readWizArtistLinks(queryBarByline());
  const link = links.find(a => a.textContent.trim() === name) || links[index];
  if (link) link.click();
};

// 今出しているジャケットの元の URL。曲が同じままジャケットだけ変わった時
// (動画と曲の切り替え・MediaSession が後から追いついた時)に見直すため
let _artworkSrcShown = null;

// 画面のバーに出ているアーティスト名(リンクにならない時の表示用)。
// MediaSession のアーティスト名は曲(リリース)ごとに英字のことがあり、
// 日向坂46 の曲版は「Hinatazaka46」だった(実機)。バーは表示言語の表記で
// 出すので、バーの曲名が同じ曲の時だけこちらを使う(曲送りの直後は、
// バーに前の曲が残っていることがある)
const readShownArtistName = (meta) => {
  const title = String(meta?.title || '').trim();
  if (!title) return '';
  const barTitle = String(document.querySelector(PLAYER_BAR_TITLE_SELECTOR)?.textContent || '').trim();
  if (!barTitle || normalizeTitleForSettle(barTitle) !== normalizeTitleForSettle(title)) return '';
  const byline = queryBarByline();
  const shown = parseBylineArtist(byline?.textContent || '').trim();
  return shown.length <= 200 ? shown : '';
};

// アーティスト名をリンクにできないまま、名前だけ出している曲のキー。
// 窓が狭い(縦長)時の YTM のバーはアーティスト名をリンクにしない(実機)。
// その間に曲が変わるとリンクを組めず、窓を広げてバーにリンクが戻っても
// 組み直していなかった。tick でバーにリンクが戻ったのを見て組み直す。
let _artistLinkPendingKey = null;
const barHasArtistLinks = () => {
  const byline = queryBarByline();
  if (!byline) return false;
  if (readWizArtistLinks(byline).length) return true;
  return [...byline.querySelectorAll('a.yt-simple-endpoint, a.ytAttributedStringLink')]
    .some(a => (a.href || '').includes('channel/'));
};
const showArtistNameOnly = (meta) => {
  ui.artist.innerText = readShownArtistName(meta) || meta.artist;
};

// 動画モードでは、動画のタイトル(「乃木坂46 『ごめんね ずっと･･･』Short Ver.」)を
// 曲名だけに整えて出す(video-title.js)。歌詞を探す時の曲名は元のまま使う
let _titleMeta = null;
const shownTitleFor = (meta) => {
  const title = String(meta?.title || '');
  if (typeof moviemode === 'undefined' || moviemode !== true || typeof VideoTitle === 'undefined') return title;
  return VideoTitle.formatTitle(title, meta.artist);
};
// 動画と曲を切り替えた時に、出している曲名を見直す
const refreshShownTitle = () => {
  if (!_titleMeta || !ui.title) return;
  const title = shownTitleFor(_titleMeta);
  setTitleText(ui.title, title);
  if (typeof PipManager !== 'undefined' && PipManager.pipWindow) {
    PipManager.updateMeta(title, (ui.artist && ui.artist.textContent) || _titleMeta.artist);
  }
};

function updateMetaUI(meta) {
  _titleMeta = meta;
  setTitleText(ui.title, shownTitleFor(meta));
  showArtistNameOnly(meta);
  updateArtworkUI(meta);
  ui.lyrics.innerHTML = '<div class="lyric-loading" style="opacity:0.5; padding:20px;">Loading...</div>';
  updateArtistLink(meta);
}

function updateArtworkUI(meta) {
  if (meta.src) {
    _artworkSrcShown = meta.src;
    const bgToken = ++_bgLoadToken;
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    if (meta.src.startsWith('data:') || meta.src.startsWith('blob:')) {
      img.src = meta.src;
    } else {
      try {
        // 目印は固定値にする。YTM 自身が CORS なしで読んだ同じ画像のキャッシュと
        // 分けるための印なので、毎回変える必要は無い。毎回変えていたので、
        // 同じ曲へ戻っても毎回取り直していた。
        const url = new URL(meta.src);
        url.searchParams.set('ytm_cors', '1');
        img.src = url.toString();
      } catch (e) {
        img.src = meta.src + (meta.src.includes('?') ? '&' : '?') + 'ytm_cors=1';
      }
    }
    // 新しいジャケットが読み終わるまでは、前のジャケットを出したままにする。
    // 先に差し替えると、読み込みの間(実機で 150〜570ms)ジャケットの枠が
    // 空になり、曲送りのたびに点滅して見えていた。遅い回線でいつまでも前の
    // 曲のジャケットを出し続けないよう、待つのは ARTWORK_SWAP_MAX_WAIT_MS まで。
    let artworkPlaced = false;
    const placeArtwork = () => {
      if (artworkPlaced || bgToken !== _bgLoadToken) return;
      artworkPlaced = true;
      ui.artwork.replaceChildren(img);
      if (ui.summaryBtn) ui.artwork.appendChild(ui.summaryBtn);
      // PiP も同じ時に差し替える(曲が変わった瞬間に写すと前の曲の画像になる)
      PipManager.updateArtwork(img.src);
    };
    img.onload = () => {
      if (bgToken !== _bgLoadToken) return;   // もう次の曲になっている
      placeArtwork();
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        // 明るさとバーの色で 2 回読み出すので、最初から読み出し向けにしておく
        // (無いと Chrome が willReadFrequently を付けるよう警告を出す)
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.filter = 'blur(4px)';
        ctx.drawImage(img, 0, 0, 64, 64);
        const blurredDataUrl = canvas.toDataURL();
        ui.bg.style.backgroundImage = `url(${blurredDataUrl})`;
        // Apple Music 風の背景(fluid-bg.js)にも同じぼかしたジャケットを渡す
        if (typeof FluidBg !== 'undefined') FluidBg.setArtwork(canvas);
        applyArtworkDim(measureArtworkLuminance(ctx, 64));
        // 自前のプレイヤーバーを満たす色
        PlayerBar.setTint(PlayerBar.tintFromPixels(ctx.getImageData(0, 0, 64, 64).data, 64));
      } catch (e) {
        console.warn("Failed to generate pre-blurred background via canvas:", e);
        ui.bg.style.backgroundImage = `url(${meta.src})`;
        applyArtworkDim(null);
        PlayerBar.setTint(null);
      }
    };
    img.onerror = () => {
      if (bgToken !== _bgLoadToken) return;
      placeArtwork();
      ui.bg.style.backgroundImage = `url(${meta.src})`;
      applyArtworkDim(null);
      PlayerBar.setTint(null);
    };
    if (!ui.artwork.querySelector('img')) placeArtwork();
    else setTimeout(placeArtwork, ARTWORK_SWAP_MAX_WAIT_MS);
  }
}

function updateArtistLink(meta) {
  // アーティストページのURLを取得
  let retryCount = 0;
  const maxRetries = 5;
  const keyAtStart = currentKey;
  _artistLinkPendingKey = null;
  const giveUp = () => {
    showArtistNameOnly(meta);
    _artistLinkPendingKey = keyAtStart;
  };
  const trySetArtistLink = () => {
    // 待っている間に次の曲へ進んでいたら、その曲の分は向こうに任せる。
    // 続けると、新しい曲のアーティスト名を前の曲の題名の下に書いてしまう。
    if (currentKey !== keyAtStart) return;
    const bylineWrapper = queryBarByline();
    if (!bylineWrapper) {
      retryCount++;
      if (retryCount < maxRetries) {
        setTimeout(trySetArtistLink, 300);
      } else {
        giveUp();
      }
      return;
    }

    const wizLinks = readWizArtistLinks(bylineWrapper);
    if (wizLinks.length > 0) {
      const frag = document.createDocumentFragment();
      wizLinks.forEach((link, index) => {
        const name = link.textContent.trim();
        const a = document.createElement('a');
        a.setAttribute('role', 'link');
        a.tabIndex = 0;
        a.style.color = 'inherit';
        a.style.textDecoration = 'none';
        a.style.cursor = 'pointer';
        a.textContent = name;
        const go = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openWizArtist(name, index);
        };
        a.addEventListener('click', go);
        a.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
        frag.appendChild(a);
        if (index < wizLinks.length - 1) {
          frag.appendChild(document.createTextNode(' • '));
        }
      });
      ui.artist.replaceChildren(frag);
      return;
    }

    const artistLinks = Array.from(
      bylineWrapper.querySelectorAll('a.yt-simple-endpoint, a.ytAttributedStringLink')
    ).filter(a => {
      const href = a.href || '';
      return href.includes('channel/') || href.includes('/channel/');
    });

    if (artistLinks.length > 0) {
      // アーティスト名も URL も YTM の DOM から来る文字列なので、
      // innerHTML に埋め込まず要素として組む。名前に "<" が入るだけで
      // 以降が消えたり、href に細工が入ったりする。
      const frag = document.createDocumentFragment();

      artistLinks.forEach((link, index) => {
        const a = document.createElement('a');
        a.href = link.href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.color = 'inherit';
        a.style.textDecoration = 'none';
        a.textContent = link.textContent.trim();
        frag.appendChild(a);
        if (index < artistLinks.length - 1) {
          frag.appendChild(document.createTextNode(' • '));
        }
      });
      ui.artist.replaceChildren(frag);
      return;
    }

    retryCount++;
    if (retryCount < maxRetries) {
      setTimeout(trySetArtistLink, 300);
    } else {
      giveUp();
    }
  };

  trySetArtistLink();
}

const runtimeSettingsReady = (async function applySavedRuntimeSettings() {
  const [
    savedOffset,
    savedOffsetEnabled,
    savedFallbackEnabled,
    savedSourceMode,
    savedAnimatedCaptions,
    savedSingerColors,
    savedAppleSync,
  ] = await Promise.all([
    storage.get('ytm_sync_offset'),
    storage.get('ytm_save_sync_offset'),
    storage.get('ytm_lrclib_fallback'),
    storage.get('ytm_lyric_source_mode'),
    storage.get('ytm_animated_captions_enabled'),
    storage.get('ytm_singer_colors_enabled'),
    storage.get('ytm_apple_sync_style'),
  ]);
  if (savedOffset !== null && Number.isFinite(Number(savedOffset))) config.syncOffset = Number(savedOffset);
  if (savedOffsetEnabled !== null) config.saveSyncOffset = !!savedOffsetEnabled;
  config.useLrcLibFallback = true;
  config.lyricSourceMode = normalizeSourceMode(savedSourceMode);
  config.disabledLyricSources = normalizeDisabledLyricSources(await storage.get(DISABLED_LYRIC_SOURCES_KEY));
  if (savedAnimatedCaptions !== null) config.useAnimatedCaptions = !!savedAnimatedCaptions;
  if (savedAppleSync !== null) config.appleSyncStyle = !!savedAppleSync;
  // 試作: 韓国語の読み(korean-ruby.js)。歌詞を描く前に入り切りを読んでおく
  if (typeof KoreanRuby !== 'undefined') await KoreanRuby.load();
  // 操作バーを自動で隠す(bar-autohide.js)
  if (typeof BarAutoHide !== 'undefined') await BarAutoHide.load();
  if (savedSingerColors !== null) config.useSingerColors = !!savedSingerColors;
  document.body.classList.toggle('ytm-singer-colors-enabled', !!config.useSingerColors);
  applyAppleSyncClass();
  setupPointerActivityWatch();

  // 1. 歌詞の太さ
  const savedWeight = await storage.get('ytm_lyric_weight');
  if (savedWeight) {
    config.lyricWeight = savedWeight;
    document.documentElement.style.setProperty('--ytm-lyric-weight', savedWeight);
  }

  // 2. 背景の明るさ
  //
  // 既定値を引き上げた。以前の 0.4 はアートワークの色がほとんど出ず、
  // この拡張の見どころを一つ潰していたため。
  // 自分でスライダーを動かした人は保存値がそのまま使われる。
  // 一度も触っていない人は、既存ユーザーも含めて新しい既定値になる。
  const savedBright = await storage.get('ytm_bg_brightness');
  if (savedBright !== null && savedBright !== undefined && savedBright !== '') {
    config.bgBrightness = normalizeBgBrightness(savedBright);
    document.documentElement.style.setProperty('--ytm-bg-brightness', String(config.bgBrightness));
  }

  // 2-b. UIサイズ
  const savedUiScale = await storage.get('ytm_ui_scale');
  if (savedUiScale !== null) applyUiScale(savedUiScale);

  // 3. 左揃えオプション
  const leftAlignStored = await storage.get('ytm_left_align');
  if (leftAlignStored !== null) config.leftAlignInfo = leftAlignStored;
  document.body.classList.toggle('ytm-align-left', !!config.leftAlignInfo);
  await restoreLyricEffectsPreferences();
  document.body.classList.toggle('ytm-keep-past-lyrics', !!config.keepPastLyrics);
  const preferSongModeStored = await storage.get('ytm_prefer_song_mode');
  if (preferSongModeStored !== null && preferSongModeStored !== undefined) {
    config.preferSongMode = !!preferSongModeStored;
  }
  const levelVolumeStored = await storage.get('ytm_level_volume');
  if (levelVolumeStored !== null && levelVolumeStored !== undefined) config.levelVolume = !!levelVolumeStored;
  VolumeLeveler.setEnabled(config.levelVolume !== false);
  // 動画モードの画質(選んだ画質を覚えている)
  void VideoQuality.init();
  // 動画モードで歌詞を映像に重ねるか(既定 入)
  const movieLyricsStored = await storage.get('ytm_movie_lyrics');
  if (movieLyricsStored !== null && movieLyricsStored !== undefined) config.movieLyrics = !!movieLyricsStored;
  document.body.classList.toggle('ytm-movie-lyrics', config.movieLyrics !== false);
  config.movieSkipScenes = (await storage.get('ytm_movie_skip_scenes')) === true;

  // 4. Apple Music風背景オプション
  const appleBgStored = await storage.get('ytm_apple_bg');
  if (appleBgStored !== null) config.appleBg = appleBgStored;
  document.body.classList.toggle('ytm-apple-bg', !!config.appleBg);

  // 5. 軽量モードオプション
  const lowCpuStored = await storage.get('ytm_low_cpu_mode');
  if (lowCpuStored !== null) config.lowCpuMode = !!lowCpuStored;
  document.body.classList.toggle('ytm-lightweight-mode', !!config.lowCpuMode);
  applyLyricEffectsSettings();

  // 6. PiP(背景の明るさ・タブを離れたら自動で開く)
  await restorePipPreferences();
})().catch((error) => {
  console.warn('[YTM] Failed to restore saved runtime settings:', error);
});


// ===================== 初期化 =====================

// Windows は日本語が Yu Gothic UI 等にフォールバックし、macOS の Hiragino Sans より
// 同じ font-weight でも太く見える。CSS 側で補正するための目印を付ける。
try {
  const platform = (navigator.userAgentData && navigator.userAgentData.platform)
    || navigator.platform || '';
  if (/win/i.test(platform)) document.body.classList.add('ytm-win');
} catch (e) { /* 判定できなければ補正しないだけ */ }

// 背景アニメーションを、見えていない間は止める。
// 動かし続けると、上に乗っている backdrop-filter の要素が毎フレーム
// 裏側のぼかしを計算し直すことになり、そのぶん無駄に電力と CPU を使う。
const updateAmbientAnimationState = () => {
  const video = document.querySelector('video');
  const idle = document.hidden || !!(video && video.paused);
  document.body.classList.toggle('ytm-anim-idle', idle);
  syncFluidBg();
};

// Apple Music 風の背景(fluid-bg.js)を描くかどうか。描かない時は以前の背景
// (CSS)が出る。動画モードは映像が背景を覆うので描かない。
function syncFluidBg() {
  if (typeof FluidBg === 'undefined' || !ui.bg) return;
  const body = document.body;
  const video = document.querySelector('video');
  const show = !!config.appleBg &&
    !body.classList.contains('ytm-lightweight-mode') &&
    body.classList.contains('ytm-custom-layout') &&
    moviemode !== true;
  const animate = show && !document.hidden && !(video && video.paused);
  FluidBg.update({ show, animate, host: ui.bg });
}
document.addEventListener('visibilitychange', updateAmbientAnimationState);
document.addEventListener('play', updateAmbientAnimationState, true);
document.addEventListener('pause', updateAmbientAnimationState, true);
updateAmbientAnimationState();

// ── 背景のアニメーションは 1 秒に 10 回だけ描き直す ─────────────────
// 背景(ジャケットをぼかしたもの)の漂いと回転は CSS アニメーションで、
// そのままだと毎秒 60 回、画面全体が描き直しになる。隔離した Chrome で
// この拡張のページが使う GPU 時間を測ると(macOS の GPU プロセスの累計)、
// 再生中 226ms/秒のうち 94% がこれだった(背景を止めると 15ms/秒)。
// 背景はぼかしてあるので、100ms ぶん進めても色の差は 255 段階の最大 2 段。
//
// 以前は CSS で止めておき、JS が 100ms ごとに currentTime を進めていた。
// これだと背景の動きが合成スレッドから外れ、メインスレッドが毎回ページ全体の
// アニメーション(歌詞の語の動きを含めて曲の後半で 90 個ほど)を列挙して
// 書き換える。この版から Windows の利用者に重くなったという声が出た。
//
// いまは動かすのは合成スレッドのまま(この版より前と同じ)、進み方だけを
// 100ms 刻みの階段にする(効果全体の easing に steps を入れる)。
// キーフレームごとのイージング(animation-timing-function)はそのまま残るので、
// 動きの形も速さも変わらない。値が変わらないフレームは描き直しが起きない。
// JS は、アニメーションが作り直された時に1回ずつ刻みを入れるだけ。
//
// 隔離 Chrome(M1・同じ曲の同じ位置から 4 秒 ×3 巡)の GPU プロセス:
// 刻まない CSS 40〜51ms/秒、JS で進める 8〜12、steps 16〜26。
// 合成スレッドも 26〜28 / 13〜17 / 15〜19。GPU の軽さは JS 版とほぼ同じ。
const BG_ANIMATION_NAMES = new Set(['ytmBgDrift', 'amFluid1', 'amFluid2']);
const BG_ANIMATION_STEP_MS = 100;

// 呼ぶのはアニメーションが作り直された時だけなので、ページ全体から探してよい。
// (背景の要素の getAnimations は、窓が隠れている間は空を返すことがあった)
const quantizeBackgroundAnimations = () => {
  if (typeof document.getAnimations !== 'function') return;
  for (const animation of document.getAnimations()) {
    if (!BG_ANIMATION_NAMES.has(animation.animationName)) continue;
    const effect = animation.effect;
    if (!effect || typeof effect.getTiming !== 'function') continue;
    const timing = effect.getTiming();
    const duration = Number(timing.duration);
    if (!(duration > 0)) continue;
    // jump-none は両端の値も1段ずつ持つので、往復の折り返しで止まらない
    const steps = Math.max(2, Math.round(duration / BG_ANIMATION_STEP_MS));
    const easing = `steps(${steps}, jump-none)`;
    if (timing.easing === easing) continue;
    try { effect.updateTiming({ easing }); } catch (e) { /* 刻めなければ滑らかなまま */ }
  }
};

// 背景の CSS アニメーションは、Immersion の入切・背景の種類・軽量モードの
// 切り替えのたびに作り直される。作り直されたら刻みを入れ直す。
document.addEventListener('animationstart', (event) => {
  if (BG_ANIMATION_NAMES.has(event.animationName)) quantizeBackgroundAnimations();
}, true);
quantizeBackgroundAnimations();

ReplayManager.init();
QueueManager.init();
CloudSync.init();

YTMLog.log('YTM Immersion loaded.');


// IMMERSION ボタンと監視の見張り。YTM がプレイヤーバーを作り直したり
// ボタンを消したりしても、次の見張りで元に戻す。
// Immersion を閉じている間は「ページから外れていないか」と曲・ページの
// 変わり目(URL と MediaSession の文字列)を読むだけで、位置を測ったり
// (レイアウトの計算を起こす)はしない。それをするのは、ボタンが消えた・
// 本来の置き場所の外にいる、という異常な時と、Immersion を開いている間
// (歌詞が毎フレーム動いていて、測る手間は埋もれる)だけ。
const MODE_TOGGLE_WATCH_MS = 1500;
let _modeToggleWatchTimer = null;
let _barObserver = null;
let _observedBar = null;
let _watchSignature = '';
// 曲・ページの変わり目。プレイヤーバーを監視できない作りでも曲の
// 切り替わりに追いつくよう、標準の MediaSession と URL で見る。
const readTrackSignature = () => {
  const md = navigator.mediaSession && navigator.mediaSession.metadata;
  return [
    location.pathname + location.search,
    readPlayerPageOpen() ? 1 : 0,
    md ? md.title : '',
    md ? md.artist : '',
  ].join('\u0001');
};
const watchModeToggle = () => {
  if (document.hidden) return;
  const shown = document.body.classList.contains('ytm-custom-layout');
  const btn = document.getElementById('my-mode-toggle');
  if (!btn || !btn.isConnected || _modeToggleAway) {
    ensureModeToggle(true);
  } else if (shown && !barMayBeAutoHidden() && isShownOnScreen(btn) && !isHitTestable(btn)) {
    // 見えているのに何かの下に潜っている(Immersion の層の下のバー等)
    ensureModeToggle(true);
  } else if (!shown && !isShownOnScreen(btn)) {
    // 閉じている間に、YTM が置き場所ごと隠した(窓を狭くした等)
    ensureModeToggle(true);
  }
  if (_observedBar && (!_observedBar.isConnected || _observedBar !== PlayerBar.current())) {
    // 監視していたプレイヤーバーが差し替わった。古い方はもう何も知らせない。
    _barObserver?.disconnect();
    _barObserver = null;
    _observedBar = null;
    setupObserver();
  }
  const signature = readTrackSignature();
  if (signature !== _watchSignature) {
    _watchSignature = signature;
    requestImmersionTick();
  } else if (!_observedBar && config.mode) {
    // プレイヤーバーが見つからず監視を組めない間も、開いていれば追い続ける
    requestImmersionTick();
  }
  if (shown) {
    runImmersionBarCheck();
  } else {
    PlayerBar.rememberDisplay(_observedBar);
    // 閉じている間に YTM がバーを作り直した(旧バーが空のまま残り、別の
    // バーが現れた等)ことには、探し直さないと気づけない。位置を測るので、
    // 何回かに 1 回だけ。
    if (++_barResolveCount >= BAR_RESOLVE_EVERY) {
      _barResolveCount = 0;
      const bar = PlayerBar.get();
      if (bar && bar !== _observedBar) {
        _barObserver?.disconnect();
        _barObserver = null;
        _observedBar = null;
        setupObserver();
      }
    }
  }
};
const BAR_RESOLVE_EVERY = 4;
let _barResolveCount = 0;

// tick の予約。同じフレームに何度頼まれても 1 回にまとめる。
let _tickScheduled = false;
let _tickRafId = null;
let _tickFallbackTimer = null;
const runScheduledTick = () => {
  if (!_tickScheduled) return;
  _tickScheduled = false;
  if (_tickRafId !== null) {
    cancelAnimationFrame(_tickRafId);
    _tickRafId = null;
  }
  if (_tickFallbackTimer !== null) {
    clearTimeout(_tickFallbackTimer);
    _tickFallbackTimer = null;
  }
  tick();
};
const scheduleTick = () => {
  if (_tickScheduled) return;
  _tickScheduled = true;
  if (!document.hidden) {
    _tickRafId = requestAnimationFrame(runScheduledTick);
  }
  _tickFallbackTimer = setTimeout(
    runScheduledTick,
    document.hidden ? 0 : 250
  );
};

// プレイヤーバーに頼らない tick のきっかけ。一度だけ組む。
//  ・<video> の読み込み・再生の知らせ(曲が変わると必ず来る)。メディアの
//    イベントは泡立たないが、document の捕捉なら video が差し替わっても届く
//  ・プレイヤーページの開閉(属性が在る作りなら、すぐ気づける)
// 見つからない・来ない分は見張り(readTrackSignature)が拾う。
let _tickDriversReady = false;
let _layoutObserver = null;
const setupTickDrivers = () => {
  if (!_tickDriversReady) {
    _tickDriversReady = true;
    requestImmersionTick = scheduleTick;
    PlayerBar.configure({ offset: () => timeOffset, canMinimize: canMinimizeImmersion, minimize: minimizeImmersion });
    ['loadedmetadata', 'emptied', 'play', 'durationchange'].forEach(type => {
      document.addEventListener(type, (e) => {
        if (e.target instanceof HTMLMediaElement) scheduleTick();
      }, true);
    });
  }
  const layout = document.querySelector('ytmusic-app-layout');
  if (layout && (!_layoutObserver || _layoutObserver._target !== layout)) {
    _layoutObserver?.disconnect();
    _layoutObserver = new MutationObserver(() => {
      // 広告中は tick が ▼▲ まで進まないので、ここで合わせる
      syncBarPlayerButton();
      scheduleTick();
    });
    _layoutObserver._target = layout;
    _layoutObserver.observe(layout, { attributes: true, attributeFilter: ['player-page-open'] });
  }
};

let _barRetryTimer = null;
const setupObserver = () => {
  if (_modeToggleWatchTimer === null) {
    _modeToggleWatchTimer = setInterval(watchModeToggle, MODE_TOGGLE_WATCH_MS);
  }
  setupTickDrivers();

  const targetNode = PlayerBar.get();

  if (!targetNode) {
    // バーが見つからなくても tick は回す(曲の切り替わりは上のきっかけで拾う)。
    // バーは後から現れることがあるので、探し続ける。
    if (_barRetryTimer === null) {
      _barRetryTimer = setTimeout(() => {
        _barRetryTimer = null;
        if (!_observedBar) setupObserver();
      }, 1000);
    }
    scheduleTick();
    return;
  }

  const observer = new MutationObserver((mutations) => {
    // 既に次の tick を予約済みなら、中身を見る意味が無い。
    // 再生中はシークバーの属性変化が絶えず届くので、その回ぶんの
    // closest() をまるごと省ける。
    if (_tickScheduled) return;
    const hasRelevantMutation = mutations.some(mutation => {
      const target = mutation.target;
      if (!target) return false;
      if (target.closest && target.closest(PLAYER_BAR_NOISE_SELECTOR)) {
        return false;
      }
      return true;
    });

    if (hasRelevantMutation) {
      scheduleTick();
    }
  });

  _barObserver?.disconnect();
  _barObserver = observer;
  _observedBar = targetNode;
  observer.observe(targetNode, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true
  });

  YTMLog.log('YTM Immersion: Zero-delay observer started.', PlayerBar.variant());
  // バーが替わったら、ボタンも新しいバーへ(古いバーの中に取り残さない)
  ensureModeToggle(true);

  tick();
};
