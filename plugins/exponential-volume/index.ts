import { definePlugin } from "@pear/sdk";

// Volume exponent; 3 is what PulseAudio uses. The lowest step YTM's slider
// offers (5%) becomes 0.0125% instead of a still-loud 5%.
// https://gist.github.com/Barteks2x/a4e189a36a10c159bb1644ffca21c02a
const EXPONENT = 3;

export default definePlugin({
  id: "exponential-volume",
  name: "Exponential volume",
  description: "Makes the volume slider follow loudness perception, giving finer control at low volumes.",
  page: async (ctx) => {
    const video = await ctx.player.videoReady();
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume")!;
    // Reads return what was set, not the cube root of the real value, which
    // would drift by rounding (YTM compares volumes it wrote).
    let written: number | undefined;
    const current = native.get!.call(video) as number;

    // Shadow the prototype's accessor on this element only.
    Object.defineProperty(video, "volume", {
      configurable: true,
      get(this: HTMLMediaElement) {
        const linear = (native.get!.call(this) as number) ** (1 / EXPONENT);
        return written !== undefined && Math.abs(written - linear) < 0.01 ? written : linear;
      },
      set(this: HTMLMediaElement, volume: number) {
        written = volume;
        native.set!.call(this, volume ** EXPONENT);
      },
    });
    // Re-apply the current volume through the new curve.
    video.volume = current;

    return () => {
      const perceived = video.volume;
      delete (video as { volume?: number }).volume;
      video.volume = perceived;
    };
  },
});
