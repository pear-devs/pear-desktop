import { expect, test } from "vitest";
import { config, numberVariant, onPlatform, selectVariant } from "../src/config.ts";
import { flatten, groupKey } from "../src/i18n.ts";

test("builders keep the kind, default and metadata", () => {
  expect(config.number(5, { label: "Size", min: 1 })).toEqual({ kind: "number", default: 5, label: "Size", min: 1 });
  const options = [{ value: "a", label: "A" }] as const;
  expect(config.select("a", options, { label: "Pick" })).toEqual({ kind: "select", default: "a", options, label: "Pick" });
});

test("onPlatform: no list means every platform", () => {
  expect(onPlatform(undefined, "linux")).toBe(true);
  expect(onPlatform(["win32", "darwin"], "linux")).toBe(false);
  expect(onPlatform(["linux"], "linux")).toBe(true);
});

test("group keys are slugs of the heading", () => {
  expect(groupKey("Window & Tray")).toBe("settings-ui.groups.window-tray");
  expect(groupKey(" HTTPS ")).toBe("settings-ui.groups.https");
});

test("flatten joins nested keys with dots", () => {
  expect(flatten({ a: { b: "x", c: { d: "y" } }, e: "z" })).toEqual({ "a.b": "x", "a.c.d": "y", e: "z" });
});

test("numbers: sliders for bounded ranges of at most 1000 steps", () => {
  expect(numberVariant(config.number(1, { label: "", min: 0, max: 10 }))).toBe("slider");
  expect(numberVariant(config.number(1, { label: "", min: 0, max: 10, step: 0.001 }))).toBe("stepper");
  expect(numberVariant(config.number(1, { label: "", min: 0, max: 10, variant: "stepper" }))).toBe("stepper");
  expect(numberVariant(config.number(1, { label: "", min: 0, max: 1e6, variant: "slider" }))).toBe("slider");
  // A slider needs both ends.
  expect(numberVariant(config.number(1, { label: "", min: 0, variant: "slider" }))).toBe("stepper");
});

test("selects: chips for up to 8 options", () => {
  const options = (n: number) => Array.from({ length: n }, (_, i) => ({ value: String(i), label: String(i) }));
  expect(selectVariant(config.select("0", options(8), { label: "" }))).toBe("chips");
  expect(selectVariant(config.select("0", options(9), { label: "" }))).toBe("dropdown");
  expect(selectVariant(config.select("0", options(2), { label: "", variant: "dropdown" }))).toBe("dropdown");
});
