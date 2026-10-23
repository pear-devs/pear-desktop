import { clamp } from "@pear/sdk/util";

export const MIN_SPEED = 0.07;
export const MAX_SPEED = 16;
export const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2];
// The slider covers the useful range; settings and the wheel reach MIN_SPEED–MAX_SPEED.
export const SLIDER_MIN = 0.25;
export const SLIDER_MAX = 2;
export const SLIDER_STEP = 0.05;
/** One wheel notch. */
export const WHEEL_STEP = 0.01;

/** Rounded to hundredths and kept within MIN_SPEED–MAX_SPEED. */
export const normalize = (speed: number) => clamp(Math.round(speed * 100) / 100, MIN_SPEED, MAX_SPEED);
export const format = (speed: number) => `${speed.toFixed(2).replace(/\.?0+$/, "")}×`;
