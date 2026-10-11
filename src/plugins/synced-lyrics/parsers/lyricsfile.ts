import type { LineLyricsWord } from '../types';

interface LyricsFileWord {
  text: string;
  start_ms: number;
  end_ms?: number;
}

interface LyricsFileLine {
  text: string;
  start_ms: number;
  end_ms?: number;
  words: LyricsFileWord[];
}

export interface ParsedLyricsFileLine {
  time: string;
  timeInMs: number;
  duration: number;
  text: string;
  words: LineLyricsWord[];
}

const KEY_VALUE_REGEX = /^([A-Za-z_][\w]*)\s*:\s*(.*)$/;

const parseScalar = (
  raw: string,
): string | number | boolean | null | never[] => {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') return null;
  if (value === '[]') return [];
  if (value === 'true') return true;
  if (value === 'false') return false;

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  if (/^-?\d+$/.test(value)) return Number(value);

  return value;
};

const splitKeyValue = (content: string): [string, string] | null => {
  const match = content.match(KEY_VALUE_REGEX);
  if (!match) return null;
  return [match[1], match[2]];
};

const assignWord = (word: LyricsFileWord, key: string, value: unknown) => {
  if (key === 'text' && typeof value === 'string') word.text = value;
  if (key === 'start_ms' && typeof value === 'number') word.start_ms = value;
  if (key === 'end_ms' && typeof value === 'number') word.end_ms = value;
};

const assignLine = (line: LyricsFileLine, key: string, value: unknown) => {
  if (key === 'text' && typeof value === 'string') line.text = value;
  if (key === 'start_ms' && typeof value === 'number') line.start_ms = value;
  if (key === 'end_ms' && typeof value === 'number') line.end_ms = value;
  if (key === 'words' && Array.isArray(value)) line.words = [];
};

const parseOffset = (source: string): number => {
  const match = source.match(/^\s+offset_ms:\s*(-?\d+)\s*$/m);
  return match ? Number(match[1]) : 0;
};

const parseRawLines = (source: string): LyricsFileLine[] => {
  const lines: LyricsFileLine[] = [];
  let inLines = false;
  let inWords = false;
  let linesIndent = 0;
  let lineItemIndent = -1;
  let wordsKeyIndent = -1;
  let currentLine: LyricsFileLine | null = null;
  let currentWord: LyricsFileWord | null = null;

  const finishWord = () => {
    if (
      currentLine &&
      currentWord &&
      Number.isFinite(currentWord.start_ms) &&
      currentWord.text !== undefined
    ) {
      currentLine.words.push(currentWord);
    }
    currentWord = null;
  };

  const finishLine = () => {
    finishWord();
    inWords = false;
    wordsKeyIndent = -1;
    if (currentLine && Number.isFinite(currentLine.start_ms)) {
      lines.push(currentLine);
    }
    currentLine = null;
  };

  for (const raw of source.split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;

    const indent = raw.search(/\S/);
    const content = raw.trim();

    if (!inLines) {
      if (content === 'lines:' || content.startsWith('lines:')) {
        inLines = true;
        linesIndent = indent;
        const inline = content.slice('lines:'.length).trim();
        if (inline === '[]') break;
      }
      continue;
    }

    if (indent <= linesIndent && !content.startsWith('-')) {
      break;
    }

    const isListItem = content === '-' || content.startsWith('- ');
    if (isListItem) {
      const rest = content === '-' ? '' : content.slice(2).trim();
      const nestedWord = inWords && indent > lineItemIndent;

      if (nestedWord) {
        finishWord();
        currentWord = { text: '', start_ms: Number.NaN };
        if (rest) {
          const kv = splitKeyValue(rest);
          if (kv) assignWord(currentWord, kv[0], parseScalar(kv[1]));
        }
      } else {
        finishLine();
        lineItemIndent = indent;
        currentLine = { text: '', start_ms: Number.NaN, words: [] };
        if (rest) {
          const kv = splitKeyValue(rest);
          if (kv) assignLine(currentLine, kv[0], parseScalar(kv[1]));
        }
      }
      continue;
    }

    const kv = splitKeyValue(content);
    if (!kv || !currentLine) continue;

    const [key, rawValue] = kv;
    const value = parseScalar(rawValue);

    if (key === 'words') {
      finishWord();
      inWords = true;
      wordsKeyIndent = indent;
      if (Array.isArray(value)) {
        currentLine.words = [];
        inWords = false;
      }
      continue;
    }

    if (inWords && indent > wordsKeyIndent && currentWord) {
      assignWord(currentWord, key, value);
      continue;
    }

    finishWord();
    inWords = false;
    assignLine(currentLine, key, value);
  }

  finishLine();
  return lines;
};

const pad = (value: number) => value.toString().padStart(2, '0');

const formatTime = (timeInMs: number): string => {
  const minutes = Math.floor(timeInMs / 60000);
  const seconds = Math.floor((timeInMs % 60000) / 1000);
  const centiseconds = Math.floor((timeInMs % 1000) / 10);
  return `${pad(minutes)}:${pad(seconds)}:${pad(centiseconds)}`;
};

const toParsedLine = (
  line: LyricsFileLine,
  nextStart: number | undefined,
  offset: number,
): ParsedLyricsFileLine => {
  const timeInMs = line.start_ms + offset;
  let duration =
    line.end_ms != null ? line.end_ms + offset - timeInMs : Infinity;

  if ((!Number.isFinite(duration) || duration <= 0) && nextStart != null) {
    duration = nextStart + offset - timeInMs;
  }

  return {
    time: formatTime(timeInMs),
    timeInMs,
    duration,
    text: line.text,
    words: line.words.map((word) => ({
      timeInMs: word.start_ms + offset,
      word: word.text,
    })),
  };
};

export const LyricsFile = {
  parse: (text: string): { lines: ParsedLyricsFileLine[] } => {
    const offset = parseOffset(text);
    const rawLines = parseRawLines(text).sort(
      (a, b) => a.start_ms - b.start_ms,
    );

    const lines = rawLines.map((line, index) =>
      toParsedLine(line, rawLines[index + 1]?.start_ms, offset),
    );

    const first = lines.at(0);
    if (first && first.timeInMs > 300) {
      lines.unshift({
        time: '00:00:00',
        timeInMs: 0,
        duration: first.timeInMs,
        text: '',
        words: [],
      });
    }

    return { lines };
  },
};
