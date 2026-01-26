interface LRCTag {
  tag: string;
  value: string;
}

interface LRCLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
  words: { timeInMs: number; word: string }[];
}

interface LRC {
  tags: LRCTag[];
  lines: LRCLine[];
}

const tagRegex = /^\[(?<tag>\w+):\s*(?<value>.+?)\s*\]$/;
// prettier-ignore
const timestampRegex = /^\[(?<minutes>\d+):(?<seconds>\d+)\.(?<milliseconds>\d+)\]/m;

// prettier-ignore
const wordRegex = /<(?<minutes>\d+):(?<seconds>\d+)\.(?<milliseconds>\d+)> *(?<word>\w+)/g;

export const LRC = {
  parse: (text: string): LRC => {
    const lrc: LRC = {
      tags: [],
      lines: [],
    };

    let offset = 0;

    for (let line of text.split('\n')) {
      line = line.trim();
      if (!line.startsWith('[')) continue;

      const timestamps = [];
      let match: Record<string, string> | undefined;
      while ((match = line.match(timestampRegex)?.groups)) {
        const { minutes, seconds, milliseconds } = match;
        const timeInMs =
          parseInt(minutes) * 60 * 1000 +
          parseInt(seconds) * 1000 +
          parseInt(milliseconds);

        timestamps.push({
          time: `${minutes}:${seconds}:${milliseconds}`,
          timeInMs,
        });

        line = line.replace(timestampRegex, '');
      }

      if (!timestamps.length) {
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

      let text = line.trim();
      const words = Array.from(text.matchAll(wordRegex), ({ groups }) => {
        const { minutes, seconds, milliseconds, word } = groups!;
        const timeInMs =
          parseInt(minutes) * 60 * 1000 +
          parseInt(seconds) * 1000 +
          parseInt(milliseconds);

        return { timeInMs, word };
      });

      if (words.length) {
        text = words.map(({ word }) => word).join(' ');
      }

      for (const { time, timeInMs } of timestamps) {
        lrc.lines.push({
          time,
          timeInMs,
          text,
          words,
          duration: Infinity,
        });
      }
    }

    lrc.lines.sort(({ timeInMs: timeA }, { timeInMs: timeB }) => timeA - timeB);
    for (let i = 0; i < lrc.lines.length; i++) {
      const current = lrc.lines[i];
      const next = lrc.lines[i + 1];

      current.timeInMs += offset;

      if (next) {
        current.duration = next.timeInMs - current.timeInMs;
      }
    }

    const first = lrc.lines.at(0);
    if (first && first.timeInMs > 300) {
      lrc.lines.unshift({
        time: '00:00:00',
        timeInMs: 0,
        duration: first.timeInMs,
        text: '',
        words: [],
      });
    }

    return lrc;
  },
};
