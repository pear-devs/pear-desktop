import { describe, expect, test } from "vitest";
import { css, sel } from "../src/macros.ts";
import type { SelectorName } from "../src/selectors.ts";

/** A template strings array, as a tagged template passes it. */
const tsa = (...strings: string[]): TemplateStringsArray => Object.assign([...strings], { raw: strings });

describe("sel", () => {
  test("resolves registry names", () => {
    expect(sel("player_bar")).toBe("ytmusic-player-bar");
  });
  test("rejects unknown names", () => {
    expect(() => sel("nope" as SelectorName)).toThrow(/unknown selector "nope"/);
  });
});

describe("css", () => {
  test("resolves sel() and minifies", () => {
    expect(css(tsa("sel(nav_bar.divider) {\n  display: none !important;\n}"))).toBe("#nav-bar-divider{display:none!important}");
  });
  test("rejects unknown selectors", () => {
    expect(() => css("sel(bogus) { color: red }")).toThrow(/unknown selector "bogus"/);
  });
  test("rejects invalid CSS", () => {
    expect(() => css("a { color: red")).toThrow(/unclosed/);
    expect(() => css("a { color: red; } }")).toThrow(/unexpected/);
    expect(() => css("a[ { color: red }")).toThrow();
    expect(css('a::after { content: "}" }')).toBe('a:after{content:"}"}');
  });
  test("rejects interpolation", () => {
    expect(() => css(tsa("a{color:", "}"), "red")).toThrow(/interpolation/);
  });
});
