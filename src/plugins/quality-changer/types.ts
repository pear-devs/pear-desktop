export type QualityChangerIpc = {
  invoke: {
    /** Asks which quality to use; the index of the pick, or -1 if cancelled. */
    pickQuality(qualityLabels: string[], currentIndex: number): number;
  };
};
