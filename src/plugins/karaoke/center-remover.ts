import workletSource from './center-remover.worklet.js?raw';

const PROCESSOR_NAME = 'karaoke-center-remover';

const loadedContexts = new WeakSet<BaseAudioContext>();

const loadProcessor = async (context: BaseAudioContext) => {
  if (loadedContexts.has(context)) return;

  const url = URL.createObjectURL(
    new Blob([workletSource], { type: 'application/javascript' }),
  );
  try {
    await context.audioWorklet.addModule(url);
    loadedContexts.add(context);
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const createCenterRemover = async (
  context: BaseAudioContext,
  amount: number,
  onMonoChange: (isMono: boolean) => void,
) => {
  await loadProcessor(context);

  const node = new AudioWorkletNode(context, PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    // Forces two channels so that mono sources still reach both sides.
    channelCount: 2,
    channelCountMode: 'explicit',
    channelInterpretation: 'speakers',
    parameterData: { amount },
  });

  node.port.onmessage = ({ data }: MessageEvent<{ isMono: boolean }>) => {
    onMonoChange(data.isMono);
  };

  return node;
};
