import { describe, expect, test } from "vitest";
import { flagOverrides, parseFlagOverride, withFlagOverride } from "../src/core-config.ts";

describe("parseFlagOverride", () => {
  test("types values like YTM's flags", () => {
    expect(parseFlagOverride("a_flag=true")).toEqual(["a_flag", true]);
    expect(parseFlagOverride("a_flag=false")).toEqual(["a_flag", false]);
    expect(parseFlagOverride("a_rate=0.25")).toEqual(["a_rate", 0.25]);
    expect(parseFlagOverride(" a_text = some text ")).toEqual(["a_text", "some text"]);
    expect(parseFlagOverride("an_empty=")).toEqual(["an_empty", ""]);
  });
  test("a bare name turns the flag on", () => {
    expect(parseFlagOverride("a_flag")).toEqual(["a_flag", true]);
  });
  test("rejects names that aren't flag names", () => {
    expect(parseFlagOverride("")).toBeUndefined();
    expect(parseFlagOverride("=true")).toBeUndefined();
    expect(parseFlagOverride("two words=true")).toBeUndefined();
  });
});

describe("flagOverrides and withFlagOverride", () => {
  test("later entries win, invalid ones are skipped", () => {
    expect(flagOverrides(["a=1", "bad name", "a=2", "b"])).toEqual({ a: 2, b: true });
  });
  test("sets, replaces and removes one flag", () => {
    expect(withFlagOverride(["a=1", "b=true"], "a", false)).toEqual(["b=true", "a=false"]);
    expect(withFlagOverride(["a=1", "b=true"], "c", 3)).toEqual(["a=1", "b=true", "c=3"]);
    expect(withFlagOverride(["a=1", "b=true"], "a", undefined)).toEqual(["b=true"]);
  });
});
