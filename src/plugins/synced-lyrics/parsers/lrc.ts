import {
  ensureLeadingPaddingEmptyLine,
  mergeConsecutiveEmptySyncedLines,
} from '../shared/lines';

interface LRCTag {
  tag: string;
  value: string;
}

interface LRCLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
}

interface LRC {
  tags: LRCTag[];
  lines: LRCLine[];
}

const tagRegex = /^\[(?<tag>\w+):\s*(?<value>.+?)\s*\]$/;
// prettier-ignore
const lyricRegex = /^\[(?<minutes>\d+):(?<seconds>\d+)\.(?<milliseconds>\d{1,3})\](?<text>.*)$/;

export const LRC = {
  parse: (text: string): LRC => {
    const lrc: LRC = {
      tags: [],
      lines: [],
    };

    let offset = 0;
    let previousLine: LRCLine | null = null;

    for (const line of text.split('\n')) {
      if (!line.trim().startsWith('[')) continue;

      const lyric = line.match(lyricRegex)?.groups;
      if (!lyric) {
        const tag = line.match(tagRegex)?.groups;
        if (tag) {
          if (tag.tag === 'offset') {
            offset = parseInt(tag.value);
            continue;
          }

          lrc.tags.push({
            tag: tag.tag,
            value: tag.value,
          });
        }
        continue;
      }

      const { minutes, seconds, milliseconds, text } = lyric;

      // Normalize: take first 2 digits, pad if only 1 digit
      const ms2 = milliseconds.padEnd(2, '0').slice(0, 2);

      // Convert to ms (xx → xx0)
      const minutesMs = parseInt(minutes) * 60 * 1000;
      const secondsMs = parseInt(seconds) * 1000;
      const centisMs = parseInt(ms2) * 10;
      const timeInMs = minutesMs + secondsMs + centisMs;

      const currentLine: LRCLine = {
        time: `${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}.${ms2}`,
        timeInMs,
        text: text.trim(),
        duration: Infinity,
      };

      if (previousLine) {
        previousLine.duration = timeInMs - previousLine.timeInMs;
      }

      previousLine = currentLine;
      lrc.lines.push(currentLine);
    }

    for (const line of lrc.lines) {
      line.timeInMs += offset;
    }

    // leading padding line if the first line starts late
    lrc.lines = ensureLeadingPaddingEmptyLine(lrc.lines, 300, 'span');

    // Merge consecutive empty lines into a single empty line
    lrc.lines = mergeConsecutiveEmptySyncedLines(lrc.lines);

    return lrc;
  },
};
