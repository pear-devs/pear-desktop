// pear-desktop's icons (assets/), embedded at build time so nothing depends on
// where the assets end up at runtime.

import { nativeImage } from "electron";
import { embed } from "./macros.ts" with { type: "macro" };

const APP_ICON = embed("generated/icons/png/256x256.png");
const TRAY_ICONS = {
  playing: { other: embed("tray.png"), darwin: embed("tray-white.png") },
  paused: { other: embed("tray-paused.png"), darwin: embed("tray-paused-white.png") },
};

function bitmap(base64: string, size: number): Buffer {
  const image = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
  return image.resize({ width: size, height: size, quality: "best" }).toBitmap();
}

/** The app icon as a bitmap: `nativeImage.createFromBitmap(pearIconBitmap(32), { width: 32, height: 32 })`. */
export function pearIconBitmap(size: number): Buffer {
  return bitmap(APP_ICON, size);
}

/** The tray icon; white on macOS, whose menu bar is dark or tinted. */
export function trayIconBitmap(size: number, paused = false): Buffer {
  const icons = paused ? TRAY_ICONS.paused : TRAY_ICONS.playing;
  return bitmap(process.platform === "darwin" ? icons.darwin : icons.other, size);
}
