export interface SyncedLineCore {
  text: string;
  timeInMs: number;
  duration: number;
}

export function mergeConsecutiveEmptySyncedLines<T extends SyncedLineCore>(
  input: T[],
): T[] {
  const merged: T[] = [];
  for (const line of input) {
    const isEmpty = !line.text || !line.text.trim();
    if (isEmpty && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const prevEmpty = !prev.text || !prev.text.trim();
      if (prevEmpty) {
        // extend previous duration to cover this line
        const prevEnd = prev.timeInMs + prev.duration;
        const thisEnd = line.timeInMs + line.duration;
        const newEnd = Math.max(prevEnd, thisEnd);
        prev.duration = newEnd - prev.timeInMs;
        continue; // skip adding this line
      }
    }
    merged.push(line);
  }
  return merged;
}

// adds a leading empty line if the first line starts after the threshold
// - 'span': spans the initial silence (duration = first.timeInMs)
// - 'zero': creates a zero-duration line at the start
export function ensureLeadingPaddingEmptyLine<T extends SyncedLineCore>(
  input: T[],
  thresholdMs = 300,
  mode: 'span' | 'zero' = 'span',
): T[] {
  if (input.length === 0) return input;
  const first = input[0];
  if (first.timeInMs <= thresholdMs) return input;

  const leading: T = Object.assign({}, first, {
    timeInMs: 0,
    duration: mode === 'span' ? first.timeInMs : 0,
    text: '',
  });

  // update the time string if it exists in the object
  if ((leading as unknown as { time?: unknown }).time !== undefined) {
    (leading as unknown as { time: string }).time = toLrcTime(leading.timeInMs);
  }

  return [leading, ...input];
}

// ensures a trailing empty line with two strategies:
// - 'lastEnd': adds a zero-duration line at the last end time
// - 'midpoint': adds a line at the midpoint between the last line and song end
export function ensureTrailingEmptyLine<T extends SyncedLineCore>(
  input: T[],
  strategy: 'lastEnd' | 'midpoint',
  songEndMs?: number,
): T[] {
  if (input.length === 0) return input;
  const out = input.slice();
  const last = out[out.length - 1];

  const isLastEmpty = !last.text || !last.text.trim();
  if (isLastEmpty) return out; // already has an empty line at the end

  const lastEndCandidate = Number.isFinite(last.duration)
    ? last.timeInMs + last.duration
    : last.timeInMs;

  if (strategy === 'lastEnd') {
    const trailing: T = Object.assign({}, last, {
      timeInMs: lastEndCandidate,
      duration: 0,
      text: '',
    });
    if ((trailing as unknown as { time?: unknown }).time !== undefined) {
      (trailing as unknown as { time: string }).time = toLrcTime(
        trailing.timeInMs,
      );
    }
    out.push(trailing);
    return out;
  }

  // handle the midpoint strategy
  if (typeof songEndMs !== 'number') return out;
  if (lastEndCandidate >= songEndMs) return out;

  const midpoint = Math.floor((lastEndCandidate + songEndMs) / 2);

  // adjust the last line to end at the calculated midpoint
  last.duration = midpoint - last.timeInMs;

  const trailing: T = Object.assign({}, last, {
    timeInMs: midpoint,
    duration: songEndMs - midpoint,
    text: '',
  });
  if ((trailing as unknown as { time?: unknown }).time !== undefined) {
    (trailing as unknown as { time: string }).time = toLrcTime(
      trailing.timeInMs,
    );
  }
  out.push(trailing);
  return out;
}

function toLrcTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes.toString().padStart(2, '0')}:${seconds
    .toString()
    .padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}
