import { normalizeLines } from '../domain';

import type { LyricLine, LyricSegment, SyncLevel } from '../types';

interface LRCTag {
  tag: string;
  value: string;
}

interface ParsedLRC {
  tags: LRCTag[];
  lines: LyricLine[];
  syncLevel: SyncLevel;
}

// LRC fractions are decimal seconds: .1 / .12 / .123, not integer millis.
const timestamp = String.raw`(\d+):([0-5]?\d)(?:\.(\d{1,3}))?`;
const lineTimestamp = new RegExp(`^\\[${timestamp}\\]`);
const segmentTimestamp = new RegExp(`<${timestamp}>`, 'g');
const tagRegex = /^\[([a-z]+):\s*(.*?)\s*\]$/i;
const millis = (match: RegExpMatchArray) => {
  const minutesMs = Number(match[1]) * 60000;
  const secondsMs = Number(match[2]) * 1000;
  return minutesMs + secondsMs + Number((match[3] ?? '').padEnd(3, '0'));
};

const parseLine = (text: string, startMs: number): LyricLine => {
  const markers = [...text.matchAll(segmentTimestamp)].filter((match) =>
    Number.isFinite(millis(match)),
  );
  if (!markers.length) return { text, startMs };

  const segments: LyricSegment[] = [];
  const prefix = text.slice(0, markers[0].index);
  if (prefix) segments.push({ text: prefix, startMs });
  let endMs: number | undefined;
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    const time = millis(marker);
    const next = markers[index + 1];
    const fragment = text.slice(marker.index + marker[0].length, next?.index);
    const previous = segments.at(-1);
    if (previous && time >= previous.startMs) previous.endMs = time;
    if (fragment) segments.push({ text: fragment, startMs: time });
    // A trailing timestamp explicitly ends the line/last segment.
    else if (!next && time >= startMs) endMs = time;
  }
  return {
    text: segments.map((segment) => segment.text).join(''),
    startMs,
    ...(endMs === undefined ? {} : { endMs }),
    segments,
  };
};

export const LRC = {
  parse(text: string, trackDurationMs?: number): ParsedLRC {
    const tags: LRCTag[] = [];
    const lines: LyricLine[] = [];
    let offset = 0;
    let enhanced = false;

    for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
      // Ignore indentation before syntax, never trim lyric content.
      let remaining = raw.trimStart();
      const timestamps: number[] = [];
      let match: RegExpMatchArray | null;
      while ((match = remaining.match(lineTimestamp))) {
        const time = millis(match);
        if (Number.isFinite(time)) timestamps.push(time);
        remaining = remaining.slice(match[0].length);
      }
      if (!timestamps.length) {
        const tag = remaining.match(tagRegex);
        if (tag) {
          if (tag[1].toLowerCase() === 'offset') {
            if (/^[+-]?\d+$/.test(tag[2]) && Number.isFinite(Number(tag[2]))) {
              offset = Number(tag[2]);
            }
          } else tags.push({ tag: tag[1], value: tag[2] });
        }
        continue;
      }

      const parsed = parseLine(remaining, timestamps[0]);
      enhanced ||= parsed.segments !== undefined;
      for (const startMs of timestamps) {
        // Repeated timestamps repeat the whole line, including relative segments.
        const shift = startMs - parsed.startMs;
        lines.push({
          ...parsed,
          startMs,
          ...(parsed.endMs === undefined
            ? {}
            : { endMs: parsed.endMs + shift }),
          ...(parsed.segments === undefined
            ? {}
            : {
                segments: parsed.segments.map((segment) => ({
                  ...segment,
                  startMs: segment.startMs + shift,
                  ...(segment.endMs === undefined
                    ? {}
                    : { endMs: segment.endMs + shift }),
                })),
              }),
        });
      }
    }

    // Shift all source times before inferring any intervals. Negative times stay
    // negative: clamping would change intervals and desynchronize segments.
    for (const line of lines) {
      line.startMs += offset;
      if (line.endMs !== undefined) line.endMs += offset;
      for (const segment of line.segments ?? []) {
        segment.startMs += offset;
        if (segment.endMs !== undefined) segment.endMs += offset;
      }
    }
    return {
      tags,
      lines: normalizeLines(lines, trackDurationMs),
      // Enhanced LRC supplies segment boundaries, not reliable word/syllable labels.
      syncLevel: enhanced ? 'word' : 'line',
    };
  },
};
