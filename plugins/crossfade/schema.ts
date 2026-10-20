import { config, type PageContextOf } from "@pear/sdk";

export const schema = {
  fadeInDuration: config.number(1500, { label: "Fade-in", min: 0, max: 10000, step: 100, unit: " ms" }),
  fadeOutDuration: config.number(5000, { label: "Fade-out", min: 0, max: 20000, step: 100, unit: " ms" }),
  secondsBeforeEnd: config.number(10, {
    label: "Skip to the next track",
    description: "Seconds before the end; the fade-out finishes there.",
    min: 0,
    max: 30,
    step: 1,
    unit: " s before the end",
  }),
  fadeScaling: config.select(
    "linear",
    [
      { value: "linear", label: "Linear" },
      { value: "logarithmic", label: "Logarithmic (sounds even)" },
    ],
    { label: "Fade curve" },
  ),
  dynamicRange: config.number(60, { label: "Logarithmic range", min: 10, max: 120, step: 5, unit: " dB" }),
};

export interface CrossfadeCommands {
  /** A direct audio stream of the track. */
  audioUrl(videoId: string): Promise<string>;
}

export type Ctx = PageContextOf<typeof schema, CrossfadeCommands>;
