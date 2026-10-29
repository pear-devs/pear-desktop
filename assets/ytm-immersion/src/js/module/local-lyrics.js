// ============================================================
// 手元の歌詞ファイルの読み込み(lyrics-ui.js の「歌詞を読み込む」から)
//
// 以前は中身をそのまま行同期の LRC として保存していたので、
// 語ごとの時刻を持つファイルでも行ごとの表示にしかならなかった。
//   - 拡張 LRC(A2 拡張): [00:12.00]<00:12.00>語<00:12.40>語<00:12.90>
//   - TTML(Apple Music / AMLL / BetterLyrics の書き出し)
// どちらも取得元の歌詞と同じ dynamicLines に組んで返す。
// 語の時刻が無いファイル(普通の LRC・時刻なしの文)は null を返し、
// 呼び出し側が今までどおり文字列のまま保存する。
//
// background(Service Worker)で動く。TTML の読み方は AMLL と同じもの
// (extra-providers.js の parseTtml)を使い、ハモリ(x-bg)もそのまま付く。
// ============================================================

import { formatLrcTime } from './api.js';
import { buildLyricsResult, decodeXmlEntities, parseTtml } from './extra-providers.js';

// [mm:ss.xx] と <mm:ss.xx>。小数点の代わりに : を使う書き方もある。
const TIME_RE_SRC = '(\\d{1,3}):(\\d{2})(?:[.:](\\d{1,3}))?';
const LINE_TAG_RE = new RegExp(`^\\s*\\[${TIME_RE_SRC}\\]`);
const WORD_TAG_RE = new RegExp(`<${TIME_RE_SRC}>`, 'g');

const toMs = (min, sec, frac) => {
  const f = String(frac || '0').padEnd(3, '0').slice(0, 3);
  return (Number(min) * 60 + Number(sec)) * 1000 + Number(f);
};

export const isEnhancedLrc = (text) => (
  new RegExp(`<${TIME_RE_SRC}>`).test(String(text || ''))
);

export const isTtml = (text) => /<tt[\s>]/i.test(String(text || '')) && /<p\b/i.test(String(text || ''));

// 語の前後の空白は、前の語の後ろに 1 つだけ付ける(取得元の歌詞と同じ形)。
// 「<..> When <..> the」の " When " をそのまま 1 語にすると、行頭に空白が出る。
const pushWord = (chars, t, raw) => {
  const s = String(raw ?? '');
  if (!s) return;
  if (/^\s/.test(s) && chars.length && !/\s$/.test(chars[chars.length - 1].c)) {
    chars[chars.length - 1].c += ' ';
  }
  const word = s.trim();
  if (!word) return;
  chars.push({ t, c: /\s$/.test(s) ? `${word} ` : word });
};

export const parseEnhancedLrc = (text) => {
  const out = [];
  const rows = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  for (const row of rows) {
    const lm = row.match(LINE_TAG_RE);
    if (!lm) continue;                          // [ti:…] などの見出し・時刻の無い行
    const lineMs = toMs(lm[1], lm[2], lm[3]);
    // 行頭の歌い手の印(v1: / bg:)は歌詞ではない(api.js の parseDynamicLrc と同じ)
    const rest = row.slice(lm[0].length).replace(/^\s*(?:v\d{1,4}|bg)\s*:\s*(?=<\d)/i, '');
    const chars = [];
    let endTimeMs;
    let prevMs = null;
    let prevEnd = 0;
    WORD_TAG_RE.lastIndex = 0;
    let wm;
    while ((wm = WORD_TAG_RE.exec(rest))) {
      const tagMs = toMs(wm[1], wm[2], wm[3]);
      // 最初の語タグより前の字は、行の時刻で始まる語
      pushWord(chars, prevMs ?? lineMs, rest.slice(prevEnd, wm.index));
      prevMs = tagMs;
      prevEnd = wm.index + wm[0].length;
    }
    if (prevMs === null) {
      // 語タグの無い行。行同期の 1 語として持つ(空なら間奏の空行)
      const plain = rest.trim();
      out.push({ startTimeMs: lineMs, text: plain, chars: plain ? [{ t: lineMs, c: plain }] : [] });
      continue;
    }
    const tail = rest.slice(prevEnd);
    if (tail.trim()) {
      pushWord(chars, prevMs, tail);
    } else {
      // 行末のタグは最後の語の終わり(A2 拡張の書き方)。
      // これを捨てると最後の語が次の行まで塗られ続ける。
      endTimeMs = prevMs;
    }
    if (chars.length) chars[chars.length - 1].c = chars[chars.length - 1].c.trimEnd();
    out.push({
      startTimeMs: lineMs,
      ...(endTimeMs !== undefined && chars.length && endTimeMs > chars[chars.length - 1].t ? { endTimeMs } : {}),
      text: chars.map(ch => ch.c).join(''),
      chars,
    });
  }
  out.sort((a, b) => a.startTimeMs - b.startTimeMs);
  return out;
};

// TTML に入っている訳(<translation xml:lang="en"><text for="L2">…</text>)を、
// 行の時刻を付けた LRC にする。翻訳の表示は LRC の時刻で行に合わせる。
const readTtmlTranslations = (src, startByKey) => {
  const lrcMap = {};
  const trRe = /<translation\b([^>]*)>([\s\S]*?)<\/translation>/g;
  let tm;
  while ((tm = trRe.exec(src))) {
    const lang = ((tm[1].match(/\bxml:lang="([^"]*)"/) || [])[1] || '').trim();
    if (!lang) continue;
    const rows = [];
    const textRe = /<text\b[^>]*\bfor="([^"]*)"[^>]*>([\s\S]*?)<\/text>/g;
    let xm;
    while ((xm = textRe.exec(tm[2]))) {
      const ms = startByKey.get(xm[1]);
      const body = decodeXmlEntities(xm[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
      if (ms === undefined || !body) continue;
      rows.push(`[${formatLrcTime(ms / 1000)}] ${body}`);
    }
    if (rows.length) lrcMap[lang.toLowerCase()] = rows.join('\n');
  }
  return lrcMap;
};

const parseLocalTtml = (src) => {
  const lines = [];
  const startByKey = new Map();
  const pRe = /<p\b[^>]*>[\s\S]*?<\/p>/g;
  let pm;
  // 1 行ずつ読んで、行の印(itunes:key)と読んだ行を結び付ける(訳の行合わせに使う)
  while ((pm = pRe.exec(src))) {
    const [line] = parseTtml(pm[0]);
    if (!line) continue;
    lines.push(line);
    const key = (pm[0].match(/^<p\b[^>]*\bitunes:key="([^"]*)"/) || [])[1];
    if (key) startByKey.set(key, line.startTimeMs);
  }
  return { lines, lrcMap: readTtmlTranslations(src, startByKey) };
};

// 戻り値: { format, lyrics, dynamicLines, lrcMap } / 語の時刻が無ければ null
export const parseLocalLyricsFile = (rawText) => {
  const text = String(rawText || '').replace(/^﻿/, '');
  if (isTtml(text)) {
    const { lines, lrcMap } = parseLocalTtml(text);
    const result = buildLyricsResult(lines, {});
    if (!result) return null;
    return {
      format: 'ttml',
      lyrics: result.lyrics,
      dynamicLines: result.dynamicLines,
      lrcMap: Object.keys(lrcMap).length ? lrcMap : null,
    };
  }
  if (isEnhancedLrc(text)) {
    const result = buildLyricsResult(parseEnhancedLrc(text), {});
    if (!result || !result.dynamicLines) return null;
    return { format: 'enhanced-lrc', lyrics: result.lyrics, dynamicLines: result.dynamicLines, lrcMap: null };
  }
  return null;
};
