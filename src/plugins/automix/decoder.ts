import { analyzeTrack, type TrackAnalysis } from './analysis';

const ANALYSIS_SAMPLE_RATE = 11025;
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
  const analysis = analyzeTrack(await renderBands(buffer));
  return { videoId, analysis, ...sliceEnds(buffer) };
};
