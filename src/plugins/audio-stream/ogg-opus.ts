// Hand-written Ogg muxer for Opus, with chained logical streams.
//
// Each song gets its own logical stream (its own serial, BOS OpusHead +
// OpusTags carrying that track's title/artist/album, then audio pages). On a
// song change we end the current stream (EOS) and begin a new one - i.e. a
// chained Ogg stream. This puts per-song metadata in the stream itself. Players
// like mpv/VLC/ffmpeg follow chains; browser <audio> does not, which is an
// accepted trade-off here.
//
// Opus granule positions are counted in 48 kHz samples regardless of the
// original sample rate (RFC 7845).

const OGG_CRC_POLY = 0x04c11db7;

// Ogg uses a CRC-32 with the given polynomial, no input/output reflection and
// a zero initial value.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 24;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x80000000 ? (crc << 1) ^ OGG_CRC_POLY : crc << 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function oggCrc(buf: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

const HEADER_TYPE_CONTINUED = 0x01;
const HEADER_TYPE_BOS = 0x02;
const HEADER_TYPE_EOS = 0x04;

const MAX_SEGMENTS = 255; // per Ogg page
const NO_GRANULE = 0xffffffffffffffffn; // -1: page completes no packet

export type PageSink = (page: Uint8Array) => void;

// Build the OpusTags comment header payload: magic "OpusTags", vendor string,
// then a list of length-prefixed UTF-8 "NAME=value" comments.
function buildOpusTags(vendor: string, comments: string[]): Uint8Array {
  const enc = new TextEncoder();
  const vendorBytes = enc.encode(vendor);
  const commentBytes = comments.map((c) => enc.encode(c));

  let size = 8 + 4 + vendorBytes.length + 4;
  for (const c of commentBytes) size += 4 + c.length;

  const payload = new Uint8Array(size);
  const dv = new DataView(payload.buffer);
  payload.set(enc.encode('OpusTags'), 0);
  let off = 8;
  dv.setUint32(off, vendorBytes.length, true);
  off += 4;
  payload.set(vendorBytes, off);
  off += vendorBytes.length;
  dv.setUint32(off, commentBytes.length, true);
  off += 4;
  for (const c of commentBytes) {
    dv.setUint32(off, c.length, true);
    off += 4;
    payload.set(c, off);
    off += c.length;
  }
  return payload;
}

// Collapses a chained Ogg/Opus stream into a SINGLE continuous logical stream
// for clients that can't follow chains (browser <audio>/MSE: a new BOS mid-
// stream forces a reload). Relies on the muxer's granule already being
// monotonic across chains. Per-client (each holds its own page-sequence state).
//
// Keeps the first stream's OpusHead + OpusTags, drops every later chain's header
// pages, and rewrites all forwarded pages onto one serial with a continuous page
// sequence (recomputing the CRC). Clears BOS/EOS on audio pages.
export class OggDechainer {
  private serial = 0;
  private haveSerial = false;
  private seq = 0;
  private dropping = false; // dropping a chained segment's header pages

  push(page: Uint8Array): Uint8Array[] {
    const headerType = page[5];
    const granule = new DataView(
      page.buffer,
      page.byteOffset,
      page.byteLength,
    ).getBigUint64(6, true);
    const bos = (headerType & HEADER_TYPE_BOS) !== 0;

    if (bos) {
      if (!this.haveSerial) {
        // First logical stream: adopt its serial, keep OpusHead (still BOS).
        this.serial = new DataView(
          page.buffer,
          page.byteOffset,
          page.byteLength,
        ).getUint32(14, true);
        this.haveSerial = true;
        return [this.rewrite(page, headerType & ~HEADER_TYPE_EOS)];
      }
      // A later chain: drop its OpusHead and following header pages.
      this.dropping = true;
      return [];
    }

    if (this.dropping) {
      // Header pages carry granulepos 0; continuation pages carry -1.
      if (granule === 0n || granule === NO_GRANULE) return [];
      this.dropping = false; // first audio page of the new segment
    }

    // Audio page (or the first stream's OpusTags): clear BOS+EOS, keep continued.
    return [
      this.rewrite(page, headerType & ~(HEADER_TYPE_BOS | HEADER_TYPE_EOS)),
    ];
  }

  private rewrite(page: Uint8Array, headerType: number): Uint8Array {
    const out = page.slice();
    const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
    out[5] = headerType;
    dv.setUint32(14, this.serial, true);
    dv.setUint32(18, this.seq >>> 0, true);
    this.seq++;
    dv.setUint32(22, 0, true); // zero CRC before recompute
    dv.setUint32(22, oggCrc(out), true);
    return out;
  }
}

export class OggOpusMuxer {
  private serial: number;
  private seq = 0;
  private granule = 0n;
  private originalHead: Uint8Array | null = null; // first stream (real pre-skip)
  private chainHead: Uint8Array | null = null; // continuations (pre-skip 0)
  private started = false; // header pages written for the current logical stream
  // One-packet lookahead so the EOS bit can land on the real last data page.
  private held: { packet: Uint8Array; granulepos: bigint } | null = null;

  // Cached header pages (OpusHead BOS + OpusTags) of the CURRENT logical stream,
  // for late joiners.
  headerPages: Uint8Array[] = [];

  constructor(private sink: PageSink) {
    this.serial = (Math.random() * 0xffffffff) >>> 0;
  }

  get ready(): boolean {
    return this.started;
  }

  // Emit one Opus packet as one or more Ogg pages. A page holds at most 255
  // segments (<= 65025 bytes), so a larger packet spans multiple pages: the
  // first carries `firstType`, the rest the "continued" flag. Only the page on
  // which the packet ends carries the real
  // granulepos (others use -1); EOS, if requested, goes on that final page.
  private emit(
    payload: Uint8Array,
    firstType: number,
    granulepos: bigint,
    eos: boolean,
  ): void {
    // Lacing: floor(len/255) values of 255, then one final value of len%255
    // (which may be 0, signalling the packet end).
    const total = Math.floor(payload.length / 255) + 1;

    let seg = 0; // segments emitted so far
    let dataOff = 0;
    let first = true;
    do {
      const segThisPage = Math.min(MAX_SEGMENTS, total - seg);
      const segTable = new Uint8Array(segThisPage);
      let dataLen = 0;
      for (let i = 0; i < segThisPage; i++) {
        const lace = seg + i === total - 1 ? payload.length % 255 : 255;
        segTable[i] = lace;
        dataLen += lace;
      }
      const isLast = seg + segThisPage >= total;

      let headerType = first ? firstType : HEADER_TYPE_CONTINUED;
      if (isLast && eos) headerType |= HEADER_TYPE_EOS;

      const page = new Uint8Array(27 + segThisPage + dataLen);
      const dv = new DataView(page.buffer);
      page[0] = 0x4f; // 'O'
      page[1] = 0x67; // 'g'
      page[2] = 0x67; // 'g'
      page[3] = 0x53; // 'S'
      page[4] = 0; // stream structure version
      page[5] = headerType;
      dv.setBigUint64(6, isLast ? granulepos : NO_GRANULE, true);
      dv.setUint32(14, this.serial, true);
      dv.setUint32(18, this.seq >>> 0, true);
      // bytes 22-25 CRC: zeroed for the checksum computation, filled after.
      page[26] = segThisPage;
      page.set(segTable, 27);
      page.set(payload.subarray(dataOff, dataOff + dataLen), 27 + segThisPage);

      dv.setUint32(22, oggCrc(page), true);

      this.seq++;
      this.sink(page);

      seg += segThisPage;
      dataOff += dataLen;
      first = false;
    } while (seg < total);
  }

  // OpusHead identification header (RFC 7845) from WebCodecs
  // decoderConfig.description, so pre-skip etc. are correct for the FIRST stream.
  // A pre-skip-0 copy is kept for chained continuations (the encoder is not
  // restarting, so there is no priming to discard at a chain boundary).
  setHead(opusHead: Uint8Array): void {
    if (this.originalHead) return;
    this.originalHead = opusHead;
    const chain = opusHead.slice();
    if (chain.length >= 12) {
      chain[10] = 0; // pre-skip low byte
      chain[11] = 0; // pre-skip high byte
    }
    this.chainHead = chain;
  }

  private openStream(
    head: Uint8Array,
    vendor: string,
    comments: string[],
    resetGranule: boolean,
  ): void {
    // Page sequence is per logical stream, so it resets. The running granule
    // does NOT reset across chains: keeping it monotonic means a player's clock
    // (VLC's PCR) never jumps backwards at a song boundary. Header pages always
    // carry granulepos 0 by spec; the chain head uses pre-skip 0 so PTS stays
    // continuous.
    this.seq = 0;
    if (resetGranule) this.granule = 0n;
    // Capture the header pages so late joiners can be primed with the same bytes.
    const pages: Uint8Array[] = [];
    const collect = this.sink;
    this.sink = (p) => pages.push(p);
    this.emit(head, HEADER_TYPE_BOS, 0n, false);
    this.emit(buildOpusTags(vendor, comments), 0, 0n, false);
    this.sink = collect;

    this.headerPages = pages;
    this.started = true;
    for (const p of pages) this.sink(p);
  }

  // Open the first logical stream.
  start(vendor: string, comments: string[]): void {
    if (!this.originalHead || this.started) return;
    this.openStream(this.originalHead, vendor, comments, true);
  }

  // End the current logical stream and begin a new one with fresh metadata,
  // continuing the granule so playback clocks stay monotonic.
  chain(vendor: string, comments: string[]): void {
    if (!this.started || !this.chainHead) return;
    this.flushHeld(true); // EOS on the old stream's last data page
    this.serial = (Math.random() * 0xffffffff) >>> 0;
    this.openStream(this.chainHead, vendor, comments, false);
  }

  private flushHeld(eos: boolean): void {
    if (!this.held) return;
    this.emit(this.held.packet, 0, this.held.granulepos, eos);
    this.held = null;
  }

  // One Opus packet -> one Ogg audio page (held one packet behind so EOS can be
  // placed correctly at a chain boundary). granuleDelta is the packet duration
  // in 48 kHz samples.
  writePacket(packet: Uint8Array, granuleDelta: number): void {
    if (!this.started) return;
    this.flushHeld(false); // emit the previously held packet (not last)
    this.granule += BigInt(Math.round(granuleDelta));
    this.held = { packet, granulepos: this.granule };
  }
}
