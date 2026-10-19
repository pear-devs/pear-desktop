import { expect, test } from "vitest";
import { matchesAccelerator } from "./accelerator.ts";

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
