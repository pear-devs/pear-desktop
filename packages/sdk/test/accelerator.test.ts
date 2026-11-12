import { expect, test } from "vitest";
import { ACCELERATOR_KEYS, fromInput, matchesAccelerator } from "../src/accelerator.ts";

const key = (key: string, init: Partial<KeyboardEvent> = {}) =>
  ({ key, code: init.code ?? "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }) as KeyboardEvent;

test("plain keys ignore case but not modifiers", () => {
  expect(matchesAccelerator(key("p"), "P")).toBe(true);
  expect(matchesAccelerator(key("P", { shiftKey: true }), "P")).toBe(false);
  expect(matchesAccelerator(key("P", { shiftKey: true }), "Shift+P")).toBe(true);
});

test("CmdOrCtrl maps per platform", () => {
  expect(matchesAccelerator(key("p", { ctrlKey: true }), "CmdOrCtrl+P")).toBe(true);
  expect(matchesAccelerator(key("p", { metaKey: true }), "CmdOrCtrl+P", true)).toBe(true);
  expect(matchesAccelerator(key("p", { ctrlKey: true }), "CmdOrCtrl+P", true)).toBe(false);
});

test("uses the physical key when the layout produces another character", () => {
  expect(matchesAccelerator(key("π", { altKey: true, code: "KeyP" }), "Alt+P")).toBe(true);
});

test("named keys and plus", () => {
  expect(matchesAccelerator(key("Escape"), "Esc")).toBe(true);
  expect(matchesAccelerator(key("+", { ctrlKey: true }), "Ctrl+Plus")).toBe(true);
  expect(matchesAccelerator(key("x"), "")).toBe(false);
});

test("media keys and Electron inputs", () => {
  expect(matchesAccelerator(key("MediaTrackNext"), "MediaNextTrack")).toBe(true);
  expect(matchesAccelerator(key("MediaPlayPause"), "MediaPlayPause")).toBe(true);
  const input = { key: "k", code: "KeyK", control: true, alt: false, shift: true, meta: false };
  expect(matchesAccelerator(fromInput(input), "Ctrl+Shift+K")).toBe(true);
  expect(matchesAccelerator(fromInput(input), "Ctrl+K")).toBe(false);
});

test("every named key matches the keydown it names", () => {
  for (const [name, eventKey] of Object.entries(ACCELERATOR_KEYS)) {
    expect(matchesAccelerator(key(eventKey), name)).toBe(true);
  }
});
