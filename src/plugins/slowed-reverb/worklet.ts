// Exact port of slowed-reverb-audio/dattorro-worklet.js, loaded via Blob URL
// into audioContext.audioWorklet. Keep in sync with the extension source.
export const DATTORRO_WORKLET_SOURCE: string = `class DelayLine {
  constructor(maxDelay) {
    let size = 1;
    while (size < maxDelay) size <<= 1;
    this.buf = new Float32Array(size);
    this.mask = size - 1;
    this.offset = size - maxDelay;
    this.taps = {};
  }

  setTap(name, delay) {
    this.taps[name] = this.mask + 1 - delay;
  }

  write(t, v) {
    this.buf[t & this.mask] = v;
  }

  read(t) {
    return this.buf[(t + this.offset) & this.mask];
  }

  readTap(t, name) {
    const off = this.taps[name];
    return off !== undefined ? this.buf[(t + off) & this.mask] : 0;
  }
}

class DattorroReverbProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = (e) => this.handleMessage(e.data);
    this.init();
  }

  handleMessage(data) {
    if (data.type === 'reset') {
      this.init();
      return;
    }
    if (data.type === 'setParams') {
      const p = data.params;
      if (p.preDelay !== undefined) this.predelay = p.preDelay;
      if (p.preFilter !== undefined) this.preFilterAmt = p.preFilter;
      if (p.inputDiff1 !== undefined) this.inputDiff1Amt = p.inputDiff1;
      if (p.inputDiff2 !== undefined) this.inputDiff2Amt = p.inputDiff2;
      if (p.decayDiff1 !== undefined) this.decayDiff1Amt = p.decayDiff1;
      if (p.decay !== undefined) {
        this.decayAmt = p.decay;
        this.decayDiff2Amt = Math.min(Math.max(p.decay + 0.15, 0.25), 0.50);
      }
      if (p.damping !== undefined) this.dampingAmt = p.damping;
      if (p.wetGain !== undefined) this.wetGain = p.wetGain;
    }
  }

  np2(x) {
    let s = 1;
    while (s < x) s <<= 1;
    return s;
  }

  init() {
    this.t = 0;
    this.sr = sampleRate;
    this.predelay = 0.1;
    this.preFilterAmt = 0.85;
    this.inputDiff1Amt = 0.75;
    this.inputDiff2Amt = 0.625;
    this.decayDiff1Amt = 0.70;
    this.decayAmt = 0.75;
    this.decayDiff2Amt = 0.50;
    this.dampingAmt = 0.95;
    this.wetGain = 0;
    this.preFilter = 0;
    this.damping = [0, 0];
    this.hpf = 0;
    this.wetLpf = [0, 0];
    this.preBuf = new Float32Array(Math.ceil(sampleRate * 0.1));
    this.preIdx = 0;

    this.inDiff = [
      { buf: new Float32Array(this.np2(142)), mask: this.np2(142) - 1, off: this.np2(142) - 142 },
      { buf: new Float32Array(this.np2(107)), mask: this.np2(107) - 1, off: this.np2(107) - 107 },
      { buf: new Float32Array(this.np2(379)), mask: this.np2(379) - 1, off: this.np2(379) - 379 },
      { buf: new Float32Array(this.np2(277)), mask: this.np2(277) - 1, off: this.np2(277) - 277 },
    ];

    this.modDelay1 = new DelayLine(672);
    this.modDelay2 = new DelayLine(908);
    // Base offsets for the delay-line modulation triangle (samples).
    this.modDelay1.base = this.modDelay1.offset;
    this.modDelay2.base = this.modDelay2.offset;
    this.modDepth = 8;
    this.modPhase = 0;
    this.modDir = 1;

    this.preDampDL = [new DelayLine(4453), new DelayLine(4217)];
    this.preDampDL[0].setTap('out1', 353);
    this.preDampDL[0].setTap('out2', 3627);
    this.preDampDL[0].setTap('out3', 1990);
    this.preDampDL[1].setTap('out1', 266);
    this.preDampDL[1].setTap('out2', 2974);
    this.preDampDL[1].setTap('out3', 2111);

    this.decayDiff2 = [new DelayLine(1800), new DelayLine(2656)];
    this.decayDiff2[0].setTap('out1', 187);
    this.decayDiff2[0].setTap('out2', 1228);
    this.decayDiff2[1].setTap('out1', 335);
    this.decayDiff2[1].setTap('out2', 1913);

    this.postDampDL = [new DelayLine(3720), new DelayLine(3163)];
    this.postDampDL[0].setTap('out1', 1066);
    this.postDampDL[0].setTap('out2', 2673);
    this.postDampDL[1].setTap('out1', 121);
    this.postDampDL[1].setTap('out2', 1996);
  }

  allpassAp(buf, mask, off, gain, x) {
    const idx = this.t & mask;
    const delayed = buf[(this.t + off) & mask];
    const temp = x - gain * delayed;
    buf[idx] = temp;
    return delayed + gain * temp;
  }

  allpassDL(dl, gain, x) {
    const delayed = dl.read(this.t);
    const temp = x - gain * delayed;
    dl.write(this.t, temp);
    return delayed + gain * temp;
  }

  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (!inp || !inp.length || !out || !out.length) return true;

    const L = inp[0];
    const R = inp.length > 1 ? inp[1] : inp[0];
    const n = L.length;
    const outL = out[0];
    const outR = out.length > 1 ? out[1] : out[0];
    const sr = this.sr;

    for (let i = 0; i < n; i++) {
      let x = (L[i] + R[i]) * 0.5;

      this.preBuf[this.preIdx] = x;
      this.preIdx = (this.preIdx + 1) % this.preBuf.length;
      const pdSamps = Math.floor(this.predelay * sr * 0.1);
      const rdIdx = (this.preIdx - pdSamps + this.preBuf.length) % this.preBuf.length;
      x = this.preBuf[rdIdx];

      this.preFilter += (x - this.preFilter) * this.preFilterAmt;
      x = this.preFilter;

      const hpfCoeff = 0.025;
      this.hpf += hpfCoeff * (x - this.hpf);
      x = x - this.hpf;

      for (let j = 0; j < 4; j++) {
        const d = this.inDiff[j];
        const g = j < 2 ? this.inputDiff1Amt : this.inputDiff2Amt;
        x = this.allpassAp(d.buf, d.mask, d.off, g, x);
      }

      if ((this.t & 0x7ff) === 0) {
        // Slow triangle LFO: sweep the modulated-delay read offsets a few
        // samples each way so the reverb tail stays shimmering, not metallic.
        if (this.modPhase >= this.modDepth) this.modDir = -1;
        if (this.modPhase <= -this.modDepth) this.modDir = 1;
        this.modPhase += this.modDir;
        this.modDelay1.offset = this.modDelay1.base + this.modPhase;
        this.modDelay2.offset = this.modDelay2.base + this.modPhase;
      }

      let x1 = x + this.postDampDL[1].read(this.t) * this.decayAmt;
      x1 = this.allpassDL(this.modDelay1, -this.decayDiff1Amt, x1);
      this.preDampDL[0].write(this.t, x1);
      x1 = this.preDampDL[0].read(this.t);
      this.damping[0] += (x1 - this.damping[0]) * this.dampingAmt;
      x1 = this.damping[0];
      x1 *= this.decayAmt;
      x1 = this.allpassDL(this.decayDiff2[0], this.decayDiff2Amt, x1);
      this.postDampDL[0].write(this.t, x1);

      let x2 = x + this.postDampDL[0].read(this.t) * this.decayAmt;
      x2 = this.allpassDL(this.modDelay2, -this.decayDiff1Amt, x2);
      this.preDampDL[1].write(this.t, x2);
      x2 = this.preDampDL[1].read(this.t);
      this.damping[1] += (x2 - this.damping[1]) * this.dampingAmt;
      x2 = this.damping[1];
      x2 *= this.decayAmt;
      x2 = this.allpassDL(this.decayDiff2[1], this.decayDiff2Amt, x2);
      this.postDampDL[1].write(this.t, x2);

      const lpfCoeff = 0.5;
      const wL = (this.preDampDL[1].readTap(this.t, 'out1')
            + this.preDampDL[1].readTap(this.t, 'out2')
            - this.decayDiff2[1].readTap(this.t, 'out2')
            + this.postDampDL[1].readTap(this.t, 'out2')
            - this.preDampDL[0].readTap(this.t, 'out3')
            - this.decayDiff2[0].readTap(this.t, 'out1')
            + this.postDampDL[0].readTap(this.t, 'out1'));
      const wR = (this.preDampDL[0].readTap(this.t, 'out1')
            + this.preDampDL[0].readTap(this.t, 'out2')
            - this.decayDiff2[0].readTap(this.t, 'out2')
            + this.postDampDL[0].readTap(this.t, 'out2')
            - this.preDampDL[1].readTap(this.t, 'out3')
            - this.decayDiff2[1].readTap(this.t, 'out1')
            + this.postDampDL[1].readTap(this.t, 'out1'));

      this.wetLpf[0] += lpfCoeff * (wL - this.wetLpf[0]);
      this.wetLpf[1] += lpfCoeff * (wR - this.wetLpf[1]);

      outL[i] = this.wetGain * (this.wetLpf[0] / (1 + Math.abs(this.wetLpf[0])));
      outR[i] = this.wetGain * (this.wetLpf[1] / (1 + Math.abs(this.wetLpf[1])));

      this.t++;
    }

    return true;
  }
}

registerProcessor('dattorro-reverb', DattorroReverbProcessor);
`;
