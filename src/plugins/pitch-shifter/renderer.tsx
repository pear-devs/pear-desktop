import { createSignal, onCleanup, createEffect } from "solid-js";
import { render } from "solid-js/web";
import * as Tone from "tone";
import type { RendererContext } from "@/types/contexts";
import type { PitchShifterPluginConfig } from "./index";

/**
 * 🎵 Pitch Shifter Plugin (Tone.js + Solid.js Edition)
 * ✅ Real-time pitch updates
 * ✅ Single slider instance
 * ✅ Clean removal on disable
 * ✅ Dynamic slider color (cool → neutral → warm)
 * ✅ Glassmorphism-ready UI
 * Author: TheSakyo
 */
export const onPlayerApiReady = async (
  _,
  { getConfig, setConfig }: RendererContext<PitchShifterPluginConfig>
) => {
  console.log("[pitch-shifter] Renderer (Solid) initialized ✅");

  const userConfig = await getConfig();
  const [enabled, setEnabled] = createSignal(userConfig.enabled);
  const [semitones, setSemitones] = createSignal(userConfig.semitones ?? 0);

  let media: HTMLMediaElement | null = null;
  let pitchShift: Tone.PitchShift | null = null;
  let nativeSource: MediaStreamAudioSourceNode | null = null;
  let mount: HTMLDivElement | null = null;

  /** 🎧 Wait for <video> element */
  const waitForMedia = (): Promise<HTMLMediaElement> =>
    new Promise((resolve) => {
      const check = () => {
        const el =
          document.querySelector("video") ||
          document.querySelector("audio") ||
          document.querySelector("ytmusic-player video");
        if (el) resolve(el as HTMLMediaElement);
        else setTimeout(check, 400);
      };
      check();
    });

  media = await waitForMedia();
  console.log("[pitch-shifter] Media found 🎧", media);

  await Tone.start();
  const toneCtx = Tone.getContext();
  const stream =
    (media as any).captureStream?.() || (media as any).mozCaptureStream?.();
  if (!stream) {
    console.error("[pitch-shifter] ❌ captureStream() unavailable");
    return;
  }

  /** 🎚️ Setup pitch shifting (only once) */
  const setupPitchShift = () => {
    if (pitchShift) return;
    pitchShift = new Tone.PitchShift({
      pitch: semitones(),
      windowSize: 0.1,
    }).toDestination();
    nativeSource = toneCtx.createMediaStreamSource(stream);
    Tone.connect(nativeSource, pitchShift);
    media!.muted = true;
    console.log("[pitch-shifter] Pitch processor active 🎶");
  };

  /** 📴 Teardown cleanly */
  const teardownPitchShift = () => {
    pitchShift?.dispose();
    pitchShift = null;
    nativeSource?.disconnect();
    nativeSource = null;
    media!.muted = false;
    console.log("[pitch-shifter] Pitch processor stopped 📴");
  };

  /** 🎨 Solid component for slider UI */
  const PitchUI = () => {
    /** 💡 Utility: compute slider gradient based on pitch */
    const getSliderGradient = (value: number) => {
      // Map -12 → 0, 0 → 0.5, 12 → 1
      const normalized = (value + 12) / 24;
      const cold = [77, 166, 255]; // blue
      const neutral = [255, 77, 77]; // red
      const warm = [255, 170, 51]; // orange

      let color: number[];
      if (value < 0) {
        // blend blue → red
        const t = normalized * 2;
        color = cold.map((c, i) => Math.round(c + (neutral[i] - c) * t));
      } else {
        // blend red → orange
        const t = (normalized - 0.5) * 2;
        color = neutral.map((c, i) => Math.round(c + (warm[i] - c) * t));
      }
      return `linear-gradient(90deg, rgb(${color.join(",")}) 0%, #fff 100%)`;
    };

    /** 🎚️ Update slider color when pitch changes */
    const updateSliderColor = (slider: HTMLInputElement, value: number) => {
      slider.style.background = getSliderGradient(value);
    };

    return (
      <div class="pitch-wrapper">
        <input
          type="range"
          min="-12"
          max="12"
          step="1"
          value={semitones()}
          class="pitch-slider"
          onInput={(e) => {
            const slider = e.target as HTMLInputElement;
            const v = parseInt(slider.value);
            setSemitones(v);
            setConfig({ semitones: v });
            if (pitchShift) pitchShift.pitch = v;
            updateSliderColor(slider, v);

            const labelEl = document.querySelector(".pitch-label");
            if (labelEl) {
              labelEl.classList.add("active");
              setTimeout(() => labelEl.classList.remove("active"), 200);
            }
          }}
          ref={(el) => updateSliderColor(el, semitones())}
        />
        <span class="pitch-label">
          {semitones() >= 0 ? "+" : ""}
          {semitones()} semitones
        </span>
        <button
          class="pitch-reset"
          title="Reset pitch"
          onClick={() => {
            setSemitones(0);
            setConfig({ semitones: 0 });
            if (pitchShift) pitchShift.pitch = 0;
            const slider = document.querySelector(
              ".pitch-slider"
            ) as HTMLInputElement;
            if (slider) updateSliderColor(slider, 0);

            const labelEl = document.querySelector(".pitch-label");
            if (labelEl) {
              labelEl.classList.add("active");
              setTimeout(() => labelEl.classList.remove("active"), 200);
            }
          }}
        >
          🔄
        </button>
      </div>
    );
  };

  /** 🧱 Mount UI (only once) */
  const injectUI = () => {
    const tabs = document.querySelector("tp-yt-paper-tabs.tab-header-container");
    if (tabs && tabs.parentElement && !document.querySelector(".pitch-wrapper")) {
      mount = document.createElement("div");
      tabs.parentElement.insertBefore(mount, tabs);
      render(() => <PitchUI />, mount);
      console.log("[pitch-shifter] UI injected via Solid ✅");
    }
  };

  /** 🧹 Remove UI on disable */
  const removeUI = () => {
    const existing = document.querySelector(".pitch-wrapper");
    if (existing) {
      existing.remove();
      mount = null;
      console.log("[pitch-shifter] UI removed ❌");
    }
  };

  /** 🔁 React to plugin state */
  createEffect(() => {
    if (enabled()) {
      setupPitchShift();
      injectUI();
    } else {
      teardownPitchShift();
      removeUI();
    }
  });

  /** ⏱️ Periodically sync config */
  const interval = setInterval(async () => {
    const conf = await getConfig();
    if (conf.enabled !== enabled()) setEnabled(conf.enabled);
    if (conf.semitones !== semitones()) setSemitones(conf.semitones);
  }, 1000);

  onCleanup(() => {
    clearInterval(interval);
    teardownPitchShift();
    removeUI();
  });
};
