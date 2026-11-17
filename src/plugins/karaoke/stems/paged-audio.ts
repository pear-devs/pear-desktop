/**
 * Audio channels stored in fixed-size pages, keeping only a window of pages.
 * A whole song would cost about 635 MB per channel for an hour of video, so
 * only the part around the playhead is ever held.
 */
export class PagedAudio {
  private readonly pages = new Map<number, Float32Array[]>();
  private first = 0;
  private last = Number.POSITIVE_INFINITY;

  constructor(
    private readonly channels: number,
    private readonly pageSamples: number,
    readonly length: number,
  ) {}

  /** Keeps pages first..last, dropping the rest. Writes outside it are skipped. */
  setWindow(first: number, last: number) {
    this.first = first;
    this.last = last;
    for (const page of this.pages.keys()) {
      if (page < first || page > last) this.pages.delete(page);
    }
  }

  private getPage(page: number) {
    let channels = this.pages.get(page);
    if (!channels) {
      channels = Array.from(
        { length: this.channels },
        () => new Float32Array(this.pageSamples),
      );
      this.pages.set(page, channels);
    }
    return channels;
  }

  private forEachSpan(
    start: number,
    length: number,
    visit: (page: number, offset: number, from: number, count: number) => void,
  ) {
    const end = Math.min(this.length, start + length);
    let index = Math.max(0, start);
    while (index < end) {
      const page = Math.floor(index / this.pageSamples);
      const offset = index % this.pageSamples;
      const count = Math.min(this.pageSamples - offset, end - index);
      visit(page, offset, index - start, count);
      index += count;
    }
  }

  private isKept(page: number) {
    return page >= this.first && page <= this.last;
  }

  /** Copies data in at start, replacing what was there. */
  write(channel: number, start: number, data: Float32Array) {
    this.forEachSpan(start, data.length, (page, offset, from, count) => {
      if (!this.isKept(page)) return;
      this.getPage(page)[channel].set(
        data.subarray(from, from + count),
        offset,
      );
    });
  }

  /** Adds data in at start, each sample multiplied by weight(i). */
  add(
    channel: number,
    start: number,
    data: Float32Array,
    weight: (index: number) => number = () => 1,
  ) {
    this.forEachSpan(start, data.length, (page, offset, from, count) => {
      if (!this.isKept(page)) return;
      const target = this.getPage(page)[channel];
      for (let i = 0; i < count; i++) {
        target[offset + i] += data[from + i] * weight(from + i);
      }
    });
  }

  /** A copy of length samples from start. Missing pages read as silence. */
  read(channel: number, start: number, length: number) {
    const result = new Float32Array(length);
    this.forEachSpan(start, length, (page, offset, from, count) => {
      const channels = this.pages.get(page);
      if (channels) {
        result.set(channels[channel].subarray(offset, offset + count), from);
      }
    });
    return result;
  }

  /** Whether every page covering start..end is held. */
  holds(start: number, end: number) {
    const last = Math.floor(
      (Math.min(end, this.length) - 1) / this.pageSamples,
    );
    for (
      let page = Math.floor(start / this.pageSamples);
      page <= last;
      page++
    ) {
      if (!this.pages.has(page)) return false;
    }
    return true;
  }

  get pageCount() {
    return this.pages.size;
  }

  clear() {
    this.pages.clear();
  }
}
