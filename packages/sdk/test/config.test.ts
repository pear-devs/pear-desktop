import { expect, test } from "vitest";
import { config, onPlatform } from "../src/config.ts";
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
