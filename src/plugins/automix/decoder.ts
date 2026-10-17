import {
  analyzeTrack,
  analyzeWindow,
  type TrackAnalysis,
} from './analysis';

const ANALYSIS_SAMPLE_RATE = 11025;
/** Step of the loudness curve kept for lining up Apple Music's analysis */
export const LOUDNESS_HOP = 0.05;
/** How much of the end of each track we keep to play the outgoing side */
const TAIL_SECONDS = 90;
/** How much of the start we keep to play the incoming side sample-accurately */
const HEAD_SECONDS = 60;

export interface AnalyzedTrack {
  videoId: string;
  analysis: TrackAnalysis;
  /** Last part of the track, played by AutoMix while the next song starts */
  tail: AudioBuffer;
  /** Track time at which `tail` starts */
  tailStart: number;
  /** First part of the track, played by AutoMix when it comes in */
  head: AudioBuffer;
  /** Loudness of 1 s windows every LOUDNESS_HOP s in dB, to line Apple Music's analysis up with */
  loudness: Float32Array;
  /** Stream AutoMix's copy was decoded from, e.g. "opus 160 kbps" */
  quality?: string;
  /** The copy is noticeably worse than what the player streams */
  lowQuality?: boolean;
}

/**
 * Renders mono full / low / mid / high bands at a low sample rate.
 * OfflineAudioContext does the resampling and filtering natively.
 */
const renderBands = async (buffer: AudioBuffer) => {
  const length = Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE);
  const context = new OfflineAudioContext(4, length, ANALYSIS_SAMPLE_RATE);

  const source = context.createBufferSource();
  source.buffer = buffer;

  const mono = context.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  source.connect(mono);

  const filter = (type: BiquadFilterType, frequency: number) => {
    const node = context.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = Math.SQRT1_2;
    return node;
  };

  const merger = context.createChannelMerger(4);
  mono.connect(merger, 0, 0);

  const low = filter('lowpass', 150);
  mono.connect(low).connect(merger, 0, 1);

  const midHigh = filter('highpass', 150);
  const mid = filter('lowpass', 2000);
  mono.connect(midHigh).connect(mid).connect(merger, 0, 2);

  const high = filter('highpass', 2000);
  mono.connect(high).connect(merger, 0, 3);

  merger.connect(context.destination);
  source.start();

  const rendered = await context.startRendering();
  return {
    sampleRate: ANALYSIS_SAMPLE_RATE,
    full: rendered.getChannelData(0),
    low: rendered.getChannelData(1),
    mid: rendered.getChannelData(2),
    high: rendered.getChannelData(3),
  };
};

/**
 * Loudness over 1 s windows, like Apple Music's curve (which has one every
 * 0.5 s), in dB, taken every LOUDNESS_HOP seconds so the two can be lined up
 * more finely than Apple's steps
 */
const loudnessCurve = (signal: Float32Array, sampleRate: number) => {
  const window = Math.round(sampleRate);
  const hop = Math.round(sampleRate * LOUDNESS_HOP);
  // Running sum of squares, so each window is two lookups
  const sums = new Float64Array(signal.length + 1);
  for (let i = 0; i < signal.length; i++) {
    sums[i + 1] = sums[i] + (signal[i] ** 2);
  }
  const curve = new Float32Array(
    Math.max(0, Math.floor((signal.length - window) / hop) + 1),
  );
  for (let w = 0; w < curve.length; w++) {
    const start = w * hop;
    const power = (sums[start + window] - sums[start]) / window;
    curve[w] = 10 * Math.log10(power + 1e-10);
  }
  return curve;
};

const slice = (buffer: AudioBuffer, startFrame: number, endFrame: number) => {
  const part = new AudioBuffer({
    numberOfChannels: buffer.numberOfChannels,
    length: Math.max(1, endFrame - startFrame),
    sampleRate: buffer.sampleRate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    part.copyToChannel(
      buffer.getChannelData(channel).subarray(startFrame, endFrame),
      channel,
    );
  }
  return part;
};

const sliceEnds = (buffer: AudioBuffer) => {
  const tailStartFrame = Math.max(
    0,
    buffer.length - Math.round(TAIL_SECONDS * buffer.sampleRate),
  );
  const headEndFrame = Math.min(
    buffer.length,
    Math.round(HEAD_SECONDS * buffer.sampleRate),
  );
  return {
    tail: slice(buffer, tailStartFrame, buffer.length),
    tailStart: tailStartFrame / buffer.sampleRate,
    head: slice(buffer, 0, headEndFrame),
  };
};

/**
 * Decodes a track (at the player's sample rate, so the tail plays back
 * without resampling) and analyses it.
 */
export const decodeAndAnalyze = async (
  videoId: string,
  bytes: Uint8Array,
  sampleRate: number,
): Promise<AnalyzedTrack> => {
  const decoder = new OfflineAudioContext(2, 1, sampleRate);
  // decodeAudioData detaches its input, so hand it a private copy
  const buffer = await decoder.decodeAudioData(bytes.slice().buffer);
  const bands = await renderBands(buffer);
  const analysis = analyzeTrack(bands);
  const loudness = loudnessCurve(bands.full, bands.sampleRate);
  return { videoId, analysis, loudness, ...sliceEnds(buffer) };
};

/**
 * The playing song from `from` on, for a transition started by hand in the
 * middle of it: decoded again, with `seconds` of it as the part AutoMix plays
 * out and its beat grid as the "end" a transition is planned on. Apple Music's
 * song-wide marks (phrases, vocals, genre) carry over as they are.
 */
export const decodeWindow = async (
  track: AnalyzedTrack,
  bytes: Uint8Array,
  sampleRate: number,
  from: number,
  seconds: number,
): Promise<AnalyzedTrack> => {
  const decoder = new OfflineAudioContext(2, 1, sampleRate);
  const buffer = await decoder.decodeAudioData(bytes.slice().buffer);
  const to = Math.min(buffer.duration, from + seconds);
  const part = slice(
    buffer,
    Math.round(from * buffer.sampleRate),
    Math.round(to * buffer.sampleRate),
  );
  const section = analyzeWindow(await renderBands(part), from);
  // The whole song's grid and key are steadier than a short stretch's own
  // (which can lock onto the wrong tempo); the stretch adds how tonal it is
  const { analysis } = track;
  const inWindow = (time: number) => time >= from && time <= to;
  const beats = analysis.beats.filter(inWindow);
  const end =
    beats.length >= 8 && analysis.tempoConfidence > 0
      ? {
          ...section,
          key: analysis.end.key ?? section.key,
          bpm: analysis.bpm,
          beatPeriod: analysis.beatPeriod,
          tempoConfidence: analysis.tempoConfidence,
          beats,
          downbeats: analysis.downbeats.filter(inWindow),
          drift: 0,
        }
      : { ...section, key: analysis.end.key ?? section.key };
  return {
    ...track,
    tail: part,
    tailStart: from,
    analysis: {
      ...analysis,
      end,
      // The window plays like a song that's still going when it's left
      outroStart: from,
      trailingSilenceStart: to,
      decayPoint: to,
      fadesOut: false,
    },
  };
};
